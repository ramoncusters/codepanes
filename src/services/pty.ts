import pty, { type IPty } from "node-pty";

export type PtyOptions = {
  cwd: string;
  cols: number;
  rows: number;
  name?: string;
  env?: Record<string, string | undefined>;
};

export function spawnPty(command: string, args: string[], options: PtyOptions): IPty {
  return pty.spawn(command, args, {
    name: options.name ?? (command === "lazygit" ? "xterm-256color" : "vt100"),
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
}
