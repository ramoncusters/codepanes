import type { CliRenderer } from "@opentui/core";
import path from "node:path";
import type { Theme } from "../services/themes.js";
import type { Worktree } from "../types.js";
import { ListItemRow } from "./ListItemRow.js";

export type WorktreeRowState = {
  cursorSelected: boolean;
  marked: boolean;
  active: boolean;
};

export class WorktreeRow {
  readonly panel;
  private readonly row: ListItemRow;
  private theme: Theme;

  constructor(
    renderer: CliRenderer,
    worktree: Worktree,
    state: WorktreeRowState,
    theme: Theme,
  ) {
    this.theme = theme;
    this.row = new ListItemRow(
      renderer,
      worktree.name ?? path.basename(worktree.path),
      [`branch: ${worktree.branch}`, worktree.remote ? `remote: ${worktree.remote}` : "remote:"],
      this.status(state),
      state.cursorSelected,
      theme,
    );
    this.panel = this.row.panel;
  }

  update(worktree: Worktree, state: WorktreeRowState): void {
    this.row.update(
      worktree.name ?? path.basename(worktree.path),
      [`branch: ${worktree.branch}`, worktree.remote ? `remote: ${worktree.remote}` : "remote:"],
      this.status(state),
      state.cursorSelected,
    );
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.row.applyTheme(theme);
  }

  private status(state: WorktreeRowState): { text: string; color: string }[] {
    return [{
      text: state.marked ? "✓ selected" : "",
      color: this.theme.accent,
    }, {
      text: state.active ? "● active" : "",
      color: this.theme.success ?? this.theme.accent,
    },
    { text: "", color: this.theme.muted },
    ];
  }
}
