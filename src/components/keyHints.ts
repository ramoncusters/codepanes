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

export function keyHintsWithBlankLine(theme: Theme, entries: Array<[string, string]>): StyledText {
  return new StyledText([
    ...stringToStyledText("\n").chunks,
    ...keyHints(theme, entries).chunks,
  ]);
}

export function keyBindingsHelp(
  theme: Theme,
  tabName: string,
  entries: Array<[string, string]>,
): StyledText {
  const chunks: TextChunk[] = [];
  chunks.push(...stringToStyledText(`${tabName} keybindings\n\n`).chunks);
  for (const [key, label] of entries) {
    chunks.push(bg(theme.focusedBackground)(fg(theme.text)(` ${key.padEnd(8)} `)));
    chunks.push(...stringToStyledText(`  ${label}\n`).chunks);
  }
  chunks.push(...stringToStyledText("\n").chunks);
  chunks.push(...keyHints(theme, [["?", "or Esc  close"]]).chunks);
  return new StyledText(chunks);
}
