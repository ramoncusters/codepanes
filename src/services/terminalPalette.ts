import { EmbeddedTerminalRenderable, type TerminalColors } from "@opentui/core";

function toOscColor(color: string | null): string | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? "");
  return match ? `rgb:${match[1]}/${match[2]}/${match[3]}` : null;
}

export function applyEmbeddedTerminalPalette(
  terminal: EmbeddedTerminalRenderable,
  palette: TerminalColors,
): void {
  const sequences = palette.palette
    .slice(0, 16)
    .map((color, index) => {
      const oscColor = toOscColor(color);
      return oscColor ? `\x1b]4;${index};${oscColor}\x07` : "";
    });
  const foreground = toOscColor(palette.defaultForeground);
  const background = toOscColor(palette.defaultBackground);

  if (foreground) sequences.push(`\x1b]10;${foreground}\x07`);
  if (background) sequences.push(`\x1b]11;${background}\x07`);
  if (sequences.length > 0) terminal.write(sequences.join(""));
}
