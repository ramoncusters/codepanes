import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import { applyEmbeddedTerminalPalette } from "../services/terminalPalette.js";

export class CommandOutputPanel {
  readonly panel: BoxRenderable;
  readonly terminal: EmbeddedTerminalRenderable;

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
    this.terminal.write(data);
  }

  setBackgroundColor(backgroundColor: string): void {
    this.panel.backgroundColor = backgroundColor;
  }
}
