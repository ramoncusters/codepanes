import path from "node:path";
import { spawnPty } from "./pty.js";

export type CommandOutput = (data: string) => void;

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
