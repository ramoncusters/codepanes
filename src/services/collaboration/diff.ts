import type { DiffFile, DiffHunk, DiffLine, PullRequestDiff } from "./types.js";

export function parseUnifiedDiff(input: string): PullRequestDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (!match) continue;
      current = { path: match[2], oldPath: match[1], additions: 0, deletions: 0, hunks: [] };
      files.push(current);
      hunk = undefined;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@ ")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) continue;
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk || line.startsWith("\\ No newline")) continue;
    const kind = line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : "context";
    const content = kind === "context" ? line.slice(1) : line.slice(1);
    const diffLine: DiffLine = {
      content,
      kind,
      oldLine: kind === "addition" ? undefined : oldLine,
      newLine: kind === "deletion" ? undefined : newLine,
    };
    hunk.lines.push(diffLine);
    if (kind === "addition") {
      current.additions += 1;
      newLine += 1;
    } else if (kind === "deletion") {
      current.deletions += 1;
      oldLine += 1;
    } else {
      oldLine += 1;
      newLine += 1;
    }
  }

  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}
