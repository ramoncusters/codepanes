import type { Config, Keybinding, TabName } from "../types.js";

const defaultKeybindings: Record<string, Keybinding> = {
  spacebar: { name: "Select worktrees", action: "select-worktrees" },
  "/": { name: "Filter worktrees", action: "search-worktrees" },
  n: { name: "Create worktree", action: "create-worktree" },
  d: { name: "Delete worktrees", action: "delete-worktrees" },
  x: { name: "Clear operations", action: "clear-operations" },
};

const defaultGlobalKeybindings: Record<string, Keybinding> = {
  C: { name: "Edit configuration", action: "edit-config" },
  t: { name: "Switch theme", action: "switch-theme" },
};

export function ensureDefaultKeybindings(config: Config): void {
  config.globalKeybindings = {
    ...config.globalKeybindings,
    Global: {
      ...defaultGlobalKeybindings,
      ...config.globalKeybindings?.Global,
    },
    Worktrees: {
      ...defaultKeybindings,
      ...config.globalKeybindings?.Worktrees,
    },
  };
}

export function createKeybindingResolver(
  config: Config,
  projectName: string,
): (tabName: TabName) => Record<string, Keybinding> {
  const projectConfig = config.projects?.[projectName] ?? {};
  return (tabName: TabName): Record<string, Keybinding> => ({
    ...defaultGlobalKeybindings,
    ...config.globalKeybindings?.Global,
    ...(tabName === "Worktrees" ? defaultKeybindings : {}),
    ...config.globalKeybindings?.[tabName],
    ...projectConfig.keybindings?.[tabName],
  });
}
