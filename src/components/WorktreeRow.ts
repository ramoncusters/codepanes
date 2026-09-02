import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import path from "node:path";
import type { Theme } from "../services/themes.js";
import type { Worktree } from "../types.js";

export type WorktreeRowState = {
  cursorSelected: boolean;
  selected: boolean;
};

export class WorktreeRow {
  readonly panel: BoxRenderable;
  private readonly cursor: TextRenderable;
  private readonly indicator: TextRenderable;
  private readonly name: TextRenderable;
  private readonly branch: TextRenderable;
  private readonly remote: TextRenderable;
  private theme: Theme;

  constructor(
    renderer: CliRenderer,
    worktree: Worktree,
    state: WorktreeRowState,
    theme: Theme,
  ) {
    this.theme = theme;
    this.panel = new BoxRenderable(renderer, { height: 1, width: "100%", flexDirection: "row" });
    this.cursor = new TextRenderable(renderer, { width: 2 });
    this.indicator = new TextRenderable(renderer, { width: 2 });
    this.name = new TextRenderable(renderer, { width: 18 });
    const nameSeparator = new TextRenderable(renderer, { content: "│ ", width: 2 });
    this.branch = new TextRenderable(renderer, { width: 18 });
    const branchSeparator = new TextRenderable(renderer, { content: "│ ", width: 2 });
    this.remote = new TextRenderable(renderer, { flexGrow: 1 });
    this.panel.add(this.cursor);
    this.panel.add(this.indicator);
    this.panel.add(this.name);
    this.panel.add(nameSeparator);
    this.panel.add(this.branch);
    this.panel.add(branchSeparator);
    this.panel.add(this.remote);
    this.update(worktree, state);
  }

  update(worktree: Worktree, state: WorktreeRowState): void {
    this.cursor.content = state.cursorSelected ? "› " : "  ";
    this.indicator.content = `${state.selected ? "✓" : " "} `;
    this.name.content = (worktree.name ?? path.basename(worktree.path)).padEnd(18, " ").slice(0, 18);
    this.branch.content = worktree.branch.padEnd(18, " ").slice(0, 18);
    this.remote.content = worktree.remote ? `● ${worktree.remote}` : "○ local only";
    this.panel.backgroundColor = state.cursorSelected ? this.theme.focusedBackground : this.theme.panelBackground;
    this.cursor.fg = this.theme.accent;
    this.indicator.fg = this.theme.success ?? this.theme.accent;
    this.name.fg = this.theme.text;
    this.branch.fg = this.theme.accent;
    this.remote.fg = worktree.remote ? this.theme.success ?? this.theme.accent : this.theme.muted;
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
  }
}
