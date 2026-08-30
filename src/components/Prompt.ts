import { BoxRenderable, InputRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

export class Prompt {
  readonly panel: BoxRenderable;
  readonly label: TextRenderable;
  readonly input: InputRenderable;

  constructor(renderer: CliRenderer) {
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "25%",
      left: "15%",
      width: "70%",
      height: 7,
      border: true,
      borderStyle: "rounded",
      borderColor: "#8be9fd",
      backgroundColor: "#111a33",
      padding: 1,
      visible: false,
      zIndex: 10,
    });
    this.label = new TextRenderable(renderer, { content: "" });
    this.input = new InputRenderable(renderer, {
      width: "100%",
      backgroundColor: "#0b1020",
      focusedBackgroundColor: "#18264a",
    });
    this.panel.add(this.label);
    this.panel.add(this.input);
  }
}
