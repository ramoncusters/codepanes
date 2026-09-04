import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { Theme } from "../services/themes.js";
import { keyHints } from "./keyHints.js";

export class Footer {
  readonly panel: BoxRenderable;
  readonly text: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.panel = new BoxRenderable(renderer, {
      height: 1,
      paddingLeft: 1,
      backgroundColor: "#111a33",
    });
    this.text = new TextRenderable(renderer, {
      content: keyHints(this.initialTheme(), [
        ["j/k", "move"],
        ["Space", "select"],
        ["/", "filter"],
        ["n", "new"],
        ["d", "delete"],
        ["Enter", "open"],
        ["Tab", "switch tabs"],
        ["?", "keybindings"],
        ["Q", "quit"],
      ]),
      fg: "#aab7d8",
    });
    this.panel.add(this.text);
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.panelBackground;
    this.text.fg = theme.muted;
    this.text.content = keyHints(theme, [
      ["j/k", "move"],
      ["Space", "select"],
      ["/", "filter"],
      ["n", "new"],
      ["d", "delete"],
      ["Enter", "open"],
      ["Tab", "switch tabs"],
      ["?", "keybindings"],
      ["Q", "quit"],
    ]);
  }

  private initialTheme(): Theme {
    return {
      id: "initial",
      name: "Initial",
      background: "#111a33",
      panelBackground: "#111a33",
      inputBackground: "#111a33",
      focusedBackground: "#18264a",
      border: "#2b3c68",
      accent: "#7dd3fc",
      text: "#ffffff",
      muted: "#aab7d8",
    };
  }
}
