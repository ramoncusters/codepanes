import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

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
      content: "↑/↓ move   Space select   / filter   n new   d delete   Enter open   Tab switch tabs   ? Keybindings   Q quit",
      fg: "#aab7d8",
    });
    this.panel.add(this.text);
  }
}
