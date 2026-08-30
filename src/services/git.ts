import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Worktree } from "../types.js";

const execFileAsync = promisify(execFile);

export async function getWorktrees(cwd: string): Promise<Worktree[]> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> = {};

    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)" });
        current = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("branch ") && current.path) {
        current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
    if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)" });
    return worktrees.length > 0 ? worktrees : [{ path: cwd, branch: path.basename(cwd) }];
  } catch {
    return [{ path: cwd, branch: path.basename(cwd) }];
  }
}

export async function gitRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

export async function bareRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  const commonDir = stdout.trim();
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
}
