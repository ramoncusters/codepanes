import type { CliRenderer } from "@opentui/core";
import type { Theme } from "../services/themes.js";
import { ListItemRow, type ListItemRowStatus } from "./ListItemRow.js";

export type ActionRowStatus = "idle" | "running" | "success" | "failed";

export class ActionRow {
  readonly panel;
  private readonly row: ListItemRow;
  private theme: Theme;

  constructor(
    renderer: CliRenderer,
    name: string,
    command: string,
    status: ActionRowStatus,
    selected: boolean,
    pulse: boolean,
    theme: Theme,
  ) {
    this.theme = theme;
    this.row = new ListItemRow(renderer, name, [command], this.status(status, pulse), selected, theme);
    this.panel = this.row.panel;
  }

  update(name: string, command: string, status: ActionRowStatus, selected: boolean, pulse: boolean): void {
    this.row.update(name, [command], this.status(status, pulse), selected);
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.row.applyTheme(theme);
  }

  private status(status: ActionRowStatus, pulse: boolean): ListItemRowStatus {
    const icon = status === "running"
      ? (pulse ? "●" : "◉")
      : status === "failed" || status === "success" ? "●" : "○";
    return {
      text: `${icon} ${status === "success" ? "successful" : status}`,
      color: status === "running" || status === "success"
        ? this.theme.success ?? this.theme.accent
        : status === "failed" ? this.theme.error ?? this.theme.accent : this.theme.muted,
    };
  }
}
