import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { Theme } from "../services/themes.js";

export type ListItemRowStatus = {
  text: string;
  color: string;
};

export class ListItemRow {
  readonly panel: BoxRenderable;
  private readonly cursor: TextRenderable;
  private readonly details: TextRenderable[] = [];
  private readonly statuses: TextRenderable[] = [];
  private theme: Theme;

  constructor(
    renderer: CliRenderer,
    name: string,
    detailLines: string[],
    status: ListItemRowStatus | ListItemRowStatus[],
    selected: boolean,
    theme: Theme,
  ) {
    this.theme = theme;
    this.panel = new BoxRenderable(renderer, {
      width: "100%",
      height: Math.max(2, detailLines.length + 1),
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.cursor = new TextRenderable(renderer, { width: 2 });
    const detailPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
    });
    this.details.push(new TextRenderable(renderer, { flexGrow: 1, content: name }));
    for (const line of detailLines) {
      this.details.push(new TextRenderable(renderer, { flexGrow: 1, content: line }));
    }
    for (const detail of this.details) detailPanel.add(detail);
    const statusPanel = new BoxRenderable(renderer, {
      width: 18,
      height: "100%",
      flexDirection: "column",
      justifyContent: "center",
    });
    for (let index = 0; index < Math.max(1, detailLines.length + 1); index += 1) {
      const status = new TextRenderable(renderer, { width: "100%" });
      this.statuses.push(status);
      statusPanel.add(status);
    }
    this.panel.add(this.cursor);
    this.panel.add(detailPanel);
    this.panel.add(statusPanel);
    this.update(name, detailLines, status, selected);
  }

  update(
    name: string,
    detailLines: string[],
    status: ListItemRowStatus | ListItemRowStatus[],
    selected: boolean,
  ): void {
    this.cursor.content = selected ? "› " : "  ";
    this.details[0].content = name;
    for (const [index, line] of detailLines.entries()) {
      const detail = this.details[index + 1];
      if (detail) detail.content = line;
    }
    const statusLines = Array.isArray(status) ? status : [status];
    for (const [index, statusLine] of this.statuses.entries()) {
      const value = statusLines[index] ?? { text: "", color: this.theme.muted };
      statusLine.content = value.text;
      statusLine.fg = value.color;
    }
    this.panel.backgroundColor = selected ? this.theme.focusedBackground : "transparent";
    this.cursor.fg = this.theme.accent;
    this.details[0].fg = this.theme.text;
    for (const detail of this.details.slice(1)) detail.fg = this.theme.muted;
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
  }
}
