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
const defaultActionsKeybindings: Record<string, Keybinding> = {
  enter: { name: "Run action", action: "run-action" },
  x: { name: "Stop selected action", action: "stop-action" },
  X: { name: "Stop all actions", action: "stop-actions" },
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
    Actions: {
      ...defaultActionsKeybindings,
      ...config.globalKeybindings?.Actions,
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
    ...(tabName === "Actions" ? defaultActionsKeybindings : {}),
    ...config.globalKeybindings?.[tabName],
    ...projectConfig.keybindings?.[tabName],
  });
}
