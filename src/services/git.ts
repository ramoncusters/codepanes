import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BranchOption, DetachedRef, Worktree } from "../types.js";

const execFileAsync = promisify(execFile);

export async function getWorktrees(cwd: string): Promise<Worktree[]> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
    const commonRoot = await bareRoot(cwd);
    let remoteRefs = "";
    try {
      ({ stdout: remoteRefs } = await execFileAsync(
        "git",
        ["for-each-ref", "--format=%(refname:strip=2)", "refs/remotes"],
        { cwd },
      ));
    } catch {
      remoteRefs = "";
    }

    const remotes = remoteRefs.split(/\r?\n/).filter(Boolean);
    const createWorktree = (worktreePath: string, branch: string): Worktree => ({
      path: worktreePath,
      branch,
      name: path.relative(commonRoot, worktreePath) || path.basename(commonRoot),
      remote: remotes.find((remote) => remote.slice(remote.indexOf("/") + 1) === branch),
    });
    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> = {};

    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push(createWorktree(current.path, current.branch ?? "(detached)"));
        current = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("branch ") && current.path) {
        current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }

    }
    if (current.path) worktrees.push(createWorktree(current.path, current.branch ?? "(detached)"));
    return worktrees.length > 0 ? worktrees : [createWorktree(cwd, path.basename(cwd))];
  } catch {
    return [{ path: cwd, branch: path.basename(cwd) }];
  }
}

export async function getBranches(cwd: string): Promise<BranchOption[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["for-each-ref", "--format=%(refname) %(refname:short)", "refs/heads", "refs/remotes"],
    { cwd },
  );
  const branches: BranchOption[] = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf(" ");
    const ref = line.slice(0, separator);
    const name = line.slice(separator + 1);
    if (name.endsWith("/HEAD")) continue;
    branches.push({ name, ref: name, remote: ref.startsWith("refs/remotes/") });
  }

  return branches.sort((left, right) =>
    Number(left.remote) - Number(right.remote) || left.name.localeCompare(right.name));
}

export async function getCommitRefs(cwd: string, branch: string): Promise<DetachedRef[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--date=short", "--format=%H%x09%h%x09%ad%x09%an%x09%s", "-n", "100", branch],
    { cwd },
  );
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [ref, short, date, author, ...subject] = line.split("\t");
    return {
      name: subject.join("\t"),
      ref,
      kind: "commit" as const,
      description: `${short}  ${date}  ${author}`,
    };
  });
}

export async function getTagRefs(cwd: string): Promise<DetachedRef[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)", "refs/tags"],
    { cwd },
  );
  return stdout.split(/\r?\n/).filter(Boolean).map((tag) => ({
    name: tag,
    ref: tag,
    kind: "tag" as const,
  }));
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
