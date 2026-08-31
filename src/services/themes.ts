import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Theme = {
  id: string;
  name: string;
  background: string;
  panelBackground: string;
  inputBackground: string;
  focusedBackground: string;
  border: string;
  accent: string;
  text: string;
  muted: string;
};

export const themesPath = path.join(homedir(), ".config", "codepanes", "themes");
const bundledThemesPath = fileURLToPath(new URL("../../src/themes", import.meta.url));
const themeFields: (keyof Theme)[] = [
  "id",
  "name",
  "background",
  "panelBackground",
  "inputBackground",
  "focusedBackground",
  "border",
  "accent",
  "text",
  "muted",
];

function parseTheme(value: unknown, filePath: string): Theme {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid theme file: ${filePath}`);
  }
  const record = value as Record<string, unknown>;
  if (themeFields.some((field) => typeof record[field] !== "string")) {
    throw new Error(`Invalid theme file: ${filePath}`);
  }
  return record as Theme;
}

export async function loadThemes(): Promise<Theme[]> {
  await mkdir(themesPath, { recursive: true });
  const bundledEntries = (await readdir(bundledThemesPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of bundledEntries) {
    const destination = path.join(themesPath, fileName);
    try {
      await readFile(destination);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(destination, await readFile(path.join(bundledThemesPath, fileName)), "utf8");
    }
  }

  const entries = (await readdir(themesPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const loaded = await Promise.all(
    entries.map(async (fileName) => {
      const filePath = path.join(themesPath, fileName);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      } catch (error: unknown) {
        throw new Error(`Unable to load theme file ${filePath}: ${String(error)}`);
      }
      return parseTheme(parsed, filePath);
    }),
  );
  if (loaded.length === 0) throw new Error(`No theme files found in ${themesPath}`);
  return loaded;
}

export function getTheme(availableThemes: Theme[], id: string | undefined): Theme {
  return availableThemes.find((theme) => theme.id === id) ?? availableThemes[0];
}
