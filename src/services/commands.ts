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
