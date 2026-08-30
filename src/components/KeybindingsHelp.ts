import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

export class KeybindingsHelp {
  readonly panel: BoxRenderable;
  readonly text: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "15%",
      left: "15%",
      width: "70%",
      height: "70%",
      border: true,
      borderStyle: "rounded",
      borderColor: "#8be9fd",
      backgroundColor: "#111a33",
      padding: 1,
      visible: false,
      zIndex: 20,
    });
    this.text = new TextRenderable(renderer, { content: "" });
    this.panel.add(this.text);
  }
}
