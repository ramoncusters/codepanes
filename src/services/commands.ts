import path from "node:path";
import { spawn } from "node:child_process";
import { spawnPty } from "./pty.js";

export type CommandOutput = (data: string) => void;

export function expandWorktreeCommand(command: string, worktreeDir: string, worktreeName: string): string {
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  return command
    .replaceAll("{{worktreeDir}}", quote(worktreeDir))
    .replaceAll("{{worktreeName}}", quote(worktreeName));
}

export function runExternalCommand(shell: string, command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-ic", command], {
      cwd,
      env: { ...process.env, SHELL: shell, TERM: "xterm-256color" },
      stdio: "ignore",
      detached: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function runDetachedCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: "ignore",
      detached: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function runAuthenticationCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
    const spawnDetached = (program: string, programArgs: string[]): void => {
      const child = spawn(program, programArgs, {
        cwd,
        env: { ...process.env },
        stdio: "ignore",
        detached: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    };
    if (isWsl) {
      const child = spawn("wt.exe", [
        "wsl.exe",
        "-d",
        process.env.WSL_DISTRO_NAME ?? "Ubuntu",
        "--",
        command,
        ...args,
      ], {
        cwd,
        env: { ...process.env },
        stdio: "ignore",
        detached: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      return;
    }
    if (process.platform === "win32") {
      spawnDetached("wt.exe", ["new-tab", command, ...args]);
      return;
    }
    if (process.platform === "darwin") {
      const script = `${command} ${args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`;
      spawnDetached("osascript", [
        "-e",
        `tell application "Terminal" to do script "${script.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
      ]);
      return;
    }
    spawnDetached("x-terminal-emulator", ["-e", command, ...args]);
  });
}

export function runInteractiveCommand(
  shell: string,
  command: string,
  options: { cwd: string; cols: number; rows: number },
  onOutput: CommandOutput,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const shellName = path.basename(shell).toLowerCase();
    const exitCommand = shellName === "fish" ? "set code $status; exit $code" : "code=$?; exit $code";
    const child = spawnPty(shell, ["-i"], {
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      name: "xterm-256color",
      env: { SHELL: shell, TERM: "xterm-256color" },
    });
    child.onData(onOutput);
    child.onExit(({ exitCode, signal }) => {
      if (signal) reject(new Error(`${shell} terminated by ${signal}`));
      else if (exitCode !== 0) reject(new Error(`${shell} exited with code ${exitCode}`));
      else resolve();
    });
    child.write(`${command}\n${exitCommand}\n`);
  });
}
