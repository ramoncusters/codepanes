import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

export function createPanel(
  renderer: CliRenderer,
  options: ConstructorParameters<typeof BoxRenderable>[1],
): BoxRenderable {
  return new BoxRenderable(renderer, options);
}

export function createText(
  renderer: CliRenderer,
  content: string,
  options: Omit<ConstructorParameters<typeof TextRenderable>[1], "content"> = {},
): TextRenderable {
  return new TextRenderable(renderer, { ...options, content });
}

export function setText(text: TextRenderable, content: string): void {
  text.content = content;
}
