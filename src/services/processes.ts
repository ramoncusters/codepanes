import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProcessMatch = {
  pid: number;
  parentPid: number;
  command: string;
  elapsed: string;
  source: "managed" | "possible";
};

type ProcessInfo = ProcessMatch & { cwd?: string };

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
      source: "possible" as const,
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
    source: "possible" as const,
  }] : []);
}

async function listProcesses(): Promise<ProcessInfo[]> {
  return process.platform === "win32" ? listWindowsProcesses() : listUnixProcesses();
}

export async function findActionProcesses(
  command: string,
  currentPid: number | undefined,
): Promise<ProcessMatch[]> {
  const expected = normalized(command);
  if (!expected) return [];
  const processes = await listProcesses();
  const managedPids = new Set<number>();
  if (currentPid !== undefined) {
    managedPids.add(currentPid);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of processes) {
        if (managedPids.has(candidate.parentPid) && !managedPids.has(candidate.pid)) {
          managedPids.add(candidate.pid);
          changed = true;
        }
      }
    }
  }
  return processes
    .filter((candidate) => candidate.pid !== process.pid)
    .filter((candidate) => normalized(candidate.command).includes(expected))
    .map((candidate) => ({
      ...candidate,
      source: managedPids.has(candidate.pid) ? "managed" as const : "possible" as const,
    }))
    .sort((left, right) => left.pid - right.pid);
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
