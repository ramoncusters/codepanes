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
    this.panel = new BoxRenderable(renderer, { height: 1, width: "100%", flexDirection: "row" });
    this.cursor = new TextRenderable(renderer, { width: 2 });
    this.indicator = new TextRenderable(renderer, { width: 2 });
    this.name = new TextRenderable(renderer, { flexGrow: 2, flexBasis: 18, flexShrink: 1 });
    const nameSeparator = new TextRenderable(renderer, { content: "│ ", width: 2 });
    this.branch = new TextRenderable(renderer, { flexGrow: 2, flexBasis: 18, flexShrink: 1 });
    const branchSeparator = new TextRenderable(renderer, { content: "│ ", width: 2 });
    this.remote = new TextRenderable(renderer, { width: 18, flexGrow: 1, flexShrink: 1 });
    this.panel.add(this.cursor);
    this.panel.add(this.indicator);
    this.panel.add(this.name);
    this.panel.add(nameSeparator);
    this.panel.add(this.branch);
    this.panel.add(branchSeparator);
    this.panel.add(this.remote);
    this.panel.onSizeChange = () => {
      this.renderColumns();
      this.renderRemote();
    };
    this.update(worktree, state);
  }

  update(worktree: Worktree, state: WorktreeRowState): void {
    this.worktree = worktree;
    this.cursor.content = state.cursorSelected ? "› " : "  ";
    this.indicator.content = `${state.selected ? "✓" : state.active ? "●" : " "} `;
    this.renderColumns();
    this.renderRemote();
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

  private renderRemote(): void {
    if (!this.worktree.remote) {
      this.remote.content = "○";
      return;
    }
    this.remote.content = this.panel.width >= 72 ? `● ${this.worktree.remote}` : "●";
  }

  private renderColumns(): void {
    const name = this.worktree.name ?? path.basename(this.worktree.path);
    const nameWidth = this.name.width > 0 ? this.name.width : 18;
    const branchWidth = this.branch.width > 0 ? this.branch.width : 18;
    this.name.content = this.truncateColumn(name, Math.max(3, nameWidth));
    this.branch.content = this.truncateColumn(this.worktree.branch, Math.max(3, branchWidth));
  }

  private truncateColumn(value: string, width: number): string {
    if (value.length <= width) return value.padEnd(width, " ");
    return `${value.slice(0, width - 3)}...`;
  }
}
