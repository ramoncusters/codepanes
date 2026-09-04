import { bg, fg, StyledText, stringToStyledText, type TextChunk } from "@opentui/core";
import type { Theme } from "../services/themes.js";

export function keyHints(theme: Theme, entries: Array<[string, string]>): StyledText {
  const chunks: TextChunk[] = [];
  for (const [index, [key, label]] of entries.entries()) {
    if (index > 0) chunks.push(...stringToStyledText("   ").chunks);
    chunks.push(bg(theme.focusedBackground)(fg(theme.text)(` ${key} `)));
    chunks.push(...stringToStyledText(` ${label}`).chunks);
  }
  return new StyledText(chunks);
}
