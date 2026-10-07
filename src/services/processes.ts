import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProcessMatch = {
  pid: number;
  parentPid: number;
  command: string;
  elapsed: string;
  cwd?: string;
  parentCommand?: string;
  source: "attached" | "unverified";
};

type ProcessInfo = ProcessMatch;

function normalized(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

async function listUnixProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,etime=,args="], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      elapsed: match[3],
      command: match[4].trim(),
      source: "unverified" as const,
    }];
  });
}

async function listWindowsProcesses(): Promise<ProcessInfo[]> {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.trim() || "[]") as
    | { ProcessId?: number; ParentProcessId?: number; CommandLine?: string }
    | Array<{ ProcessId?: number; ParentProcessId?: number; CommandLine?: string }>;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.flatMap((row) => row.ProcessId && row.CommandLine ? [{
    pid: row.ProcessId,
    parentPid: row.ParentProcessId ?? 0,
    elapsed: "",
    command: row.CommandLine,
    source: "unverified" as const,
  }] : []);
}

async function listProcesses(): Promise<ProcessInfo[]> {
  return process.platform === "win32" ? listWindowsProcesses() : listUnixProcesses();
}

async function processCwd(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") return await readlink(`/proc/${pid}/cwd`);
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
      return stdout.split(/\r?\n/).find((line) => line.startsWith("n"))?.slice(1);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function findActionProcesses(
  command: string,
  currentPid: number | undefined,
  currentCwd?: string,
): Promise<ProcessMatch[]> {
  const expected = normalized(command);
  if (!expected) return [];
  const processes = await listProcesses();
  const attachedPids = new Set<number>();
  if (currentPid !== undefined) {
    attachedPids.add(currentPid);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of processes) {
        if (attachedPids.has(candidate.parentPid) && !attachedPids.has(candidate.pid)) {
          attachedPids.add(candidate.pid);
          changed = true;
        }
      }
    }
  }
  const parentCommands = new Map(processes.map((candidate) => [candidate.pid, candidate.command]));
  const matches = await Promise.all(processes
    .filter((candidate) => candidate.pid !== process.pid)
    .filter((candidate) => normalized(candidate.command).includes(expected))
    .map(async (candidate) => ({
      ...candidate,
      cwd: attachedPids.has(candidate.pid) && currentCwd
        ? currentCwd
        : await processCwd(candidate.pid),
      parentCommand: parentCommands.get(candidate.parentPid),
      source: attachedPids.has(candidate.pid) ? "attached" as const : "unverified" as const,
    }))
  );
  return matches.sort((left, right) => left.pid - right.pid);
}

export async function stopProcess(pid: number, tree: boolean): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), ...(tree ? ["/T"] : []), "/F"]);
    return;
  }
  const processes = await listUnixProcesses();
  const descendants = new Set<number>([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of processes) {
      if (descendants.has(candidate.parentPid) && !descendants.has(candidate.pid)) {
        descendants.add(candidate.pid);
        changed = true;
      }
    }
  }
  for (const descendant of [...descendants].reverse()) {
    try {
      process.kill(descendant, "SIGTERM");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}
