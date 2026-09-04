import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { Theme } from "../services/themes.js";

export type ActionRowStatus = "idle" | "running" | "success" | "failed";

export class ActionRow {
  readonly panel: BoxRenderable;
  private readonly cursor: TextRenderable;
  private readonly name: TextRenderable;
  private readonly command: TextRenderable;
  private readonly status: TextRenderable;
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
    this.panel = new BoxRenderable(renderer, {
      width: "100%",
      height: 2,
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.cursor = new TextRenderable(renderer, { width: 2 });
    this.name = new TextRenderable(renderer, { flexGrow: 1, content: name });
    this.command = new TextRenderable(renderer, { flexGrow: 1, content: command, fg: theme.muted });
    this.status = new TextRenderable(renderer, { width: 18 });
    const details = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
    });
    details.add(this.name);
    details.add(this.command);
    this.panel.add(this.cursor);
    this.panel.add(details);
    this.panel.add(this.status);
    this.update(name, command, status, selected, pulse);
  }

  update(name: string, command: string, status: ActionRowStatus, selected: boolean, pulse: boolean): void {
    this.name.content = name;
    this.command.content = command;
    this.cursor.content = selected ? "› " : "  ";
    const icon = status === "running"
      ? (pulse ? "●" : "◉")
      : status === "failed" || status === "success"
        ? "●"
        : "○";
    const label = status === "success" ? "successful" : status;
    this.status.content = `${icon} ${label}`;
    this.status.fg = status === "running" || status === "success"
      ? this.theme.success ?? this.theme.accent
      : status === "failed"
        ? this.theme.error ?? this.theme.accent
        : this.theme.muted;
    this.name.fg = this.theme.text;
    this.command.fg = this.theme.muted;
    this.cursor.fg = this.theme.accent;
    this.panel.backgroundColor = selected ? this.theme.focusedBackground : "transparent";
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
  }
}
