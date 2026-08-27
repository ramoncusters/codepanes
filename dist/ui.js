import { BoxRenderable, TextRenderable } from "@opentui/core";
export function createPanel(renderer, options) {
    return new BoxRenderable(renderer, options);
}
export function createText(renderer, content, options = {}) {
    return new TextRenderable(renderer, { ...options, content });
}
export function setText(text, content) {
    text.content = content;
}
