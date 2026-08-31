import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import { applyEmbeddedTerminalPalette } from "../services/terminalPalette.js";
import type { Theme } from "../services/themes.js";

export class CommandOutputPanel {
  readonly panel: BoxRenderable;
  readonly terminal: EmbeddedTerminalRenderable;
  private pendingIconSequence = "";

  constructor(renderer: CliRenderer, backgroundColor: string) {
    this.panel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexBasis: 0,
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      title: "output",
      titleColor: "#7dd3fc",
      backgroundColor,
    });
    this.terminal = new EmbeddedTerminalRenderable(renderer, {
      width: "100%",
      height: "100%",
      selectable: false,
    });
    this.panel.add(this.terminal);
  }

  applyPalette(palette: TerminalColors): void {
    applyEmbeddedTerminalPalette(this.terminal, palette);
  }

  write(data: string): void {
    const filtered = this.filterIconSequence(`${this.pendingIconSequence}${data}`);
    this.pendingIconSequence = filtered.pending;
    if (filtered.output.length > 0) this.terminal.write(filtered.output);
  }

  writeMessage(data: string, color: string): void {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    if (!match) {
      this.write(`\r\n${data}\r\n`);
      return;
    }
    this.write(
      `\r\n\x1b[38;2;${Number.parseInt(match[1], 16)};${Number.parseInt(match[2], 16)};${Number.parseInt(match[3], 16)}m${data}\x1b[39m\r\n`,
    );
  }

  setBackgroundColor(backgroundColor: string): void {
    this.panel.backgroundColor = backgroundColor;
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.border;
    this.panel.titleColor = theme.accent;
  }

  private filterIconSequence(data: string): { output: string; pending: string } {
    let output = "";
    let cursor = 0;
    while (cursor < data.length) {
      const start = data.indexOf("\x1b]1;", cursor);
      if (start === -1) {
        return { output: output + data.slice(cursor), pending: "" };
      }
      output += data.slice(cursor, start);
      const bell = data.indexOf("\x07", start + 3);
      const terminator = data.indexOf("\x1b\\", start + 3);
      const end = bell === -1 ? terminator : terminator === -1 ? bell : Math.min(bell, terminator);
      if (end === -1) return { output, pending: data.slice(start) };
      cursor = end + (end === bell ? 1 : 2);
    }
    return { output, pending: "" };
  }
}
