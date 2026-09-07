import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  MouseEvent,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import { applyEmbeddedTerminalPalette } from "../services/terminalPalette.js";
import type { Theme } from "../services/themes.js";

export class CommandOutputPanel {
  readonly panel: BoxRenderable;
  readonly terminal: EmbeddedTerminalRenderable;
  private pendingIconSequence = "";
  private pendingModeSequence = "";
  private theme: Theme;
  private focused = false;

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
    this.theme = {
      id: "initial",
      name: "Initial",
      mode: "dark",
      background: backgroundColor,
      panelBackground: backgroundColor,
      inputBackground: backgroundColor,
      focusedBackground: backgroundColor,
      border: "#2b3c68",
      accent: "#7dd3fc",
      text: "#ffffff",
      muted: "#aab7d8",
    };
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
    const iconFiltered = this.filterIconSequence(`${this.pendingIconSequence}${data}`);
    this.pendingIconSequence = iconFiltered.pending;
    const modeFiltered = this.filterModeSequence(`${this.pendingModeSequence}${iconFiltered.output}`);
    this.pendingModeSequence = modeFiltered.pending;
    if (modeFiltered.output.length > 0) this.terminal.write(modeFiltered.output);
    if (this.pendingIconSequence.length > 0) return;
  }

  clear(): void {
    this.terminal.write("\x1b[2J\x1b[3J\x1b[H");
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
    this.theme = theme;
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = this.focused ? theme.accent : theme.border;
    this.panel.titleColor = theme.accent;
  }

  focus(): void {
    this.focused = true;
    this.panel.borderColor = this.theme.accent;
    this.terminal.focus();
  }

  blur(): void {
    this.focused = false;
    this.panel.borderColor = this.theme.border;
    this.terminal.blur();
  }

  scrollBy(lines: number): void {
    const direction = lines < 0 ? "up" : "down";
    const event = new MouseEvent(this.terminal, {
      type: "scroll",
      button: direction === "up" ? 4 : 5,
      x: this.terminal.x,
      y: this.terminal.y,
      modifiers: { shift: false, alt: false, ctrl: false },
      scroll: { direction, delta: Math.abs(lines) },
    });
    this.terminal.processMouseEvent(event);
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

  private filterModeSequence(data: string): { output: string; pending: string } {
    let output = "";
    let cursor = 0;
    while (cursor < data.length) {
      const start = data.indexOf("\x1b[?1034", cursor);
      if (start === -1) return { output: output + data.slice(cursor), pending: "" };
      output += data.slice(cursor, start);
      const terminator = data.slice(start + "\x1b[?1034".length).search(/[hl]/);
      if (terminator === -1) return { output, pending: data.slice(start) };
      cursor = start + "\x1b[?1034".length + terminator + 1;
    }
    return { output, pending: "" };
  }
}
