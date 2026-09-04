import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import path from "node:path";
import type { Theme } from "../services/themes.js";
import type { Worktree } from "../types.js";

export type WorktreeRowState = {
  cursorSelected: boolean;
  selected: boolean;
  active: boolean;
};

export class WorktreeRow {
  readonly panel: BoxRenderable;
  private readonly cursor: TextRenderable;
  private readonly indicator: TextRenderable;
  private readonly name: TextRenderable;
  private readonly branch: TextRenderable;
  private readonly remote: TextRenderable;
  private worktree: Worktree;
  private theme: Theme;

  constructor(
    renderer: CliRenderer,
    worktree: Worktree,
    state: WorktreeRowState,
    theme: Theme,
  ) {
    this.theme = theme;
    this.worktree = worktree;
    this.panel = new BoxRenderable(renderer, { height: 3, width: "100%", flexDirection: "row" });
    this.cursor = new TextRenderable(renderer, { width: 2 });
    this.indicator = new TextRenderable(renderer, { width: 2 });
    this.name = new TextRenderable(renderer, { content: "", flexGrow: 1 });
    this.branch = new TextRenderable(renderer, { content: "", fg: theme.muted });
    this.remote = new TextRenderable(renderer, { content: "", fg: theme.muted });
    const details = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
    });
    details.add(this.name);
    details.add(this.branch);
    details.add(this.remote);
    this.panel.add(this.cursor);
    this.panel.add(this.indicator);
    this.panel.add(details);
    this.update(worktree, state);
  }

  update(worktree: Worktree, state: WorktreeRowState): void {
    this.worktree = worktree;
    this.cursor.content = state.cursorSelected ? "› " : "  ";
    this.indicator.content = `${state.selected ? "✓" : state.active ? "●" : " "} `;
    this.name.content = worktree.name ?? path.basename(worktree.path);
    this.branch.content = `branch: ${worktree.branch}`;
    this.remote.content = worktree.remote ? `remote: ${worktree.remote}` : "remote:";
    this.panel.backgroundColor = state.cursorSelected ? this.theme.focusedBackground : "transparent";
    this.cursor.fg = this.theme.accent;
    this.indicator.fg = this.theme.success ?? this.theme.accent;
    this.name.fg = this.theme.accent;
    this.branch.fg = this.theme.muted;
    this.remote.fg = this.theme.muted;
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
  }

}
