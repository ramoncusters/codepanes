import type { Config, Keybinding, TabName } from "../types.js";

const defaultKeybindings: Record<string, Keybinding> = {
  spacebar: { name: "Select worktrees", action: "select-worktrees" },
  "/": { name: "Filter worktrees", action: "search-worktrees" },
  n: { name: "Create worktree", action: "create-worktree" },
  d: { name: "Delete worktrees", action: "delete-worktrees" },
};

const defaultGlobalKeybindings: Record<string, Keybinding> = {
  C: { name: "Edit configuration", action: "edit-config" },
};

export function ensureDefaultKeybindings(config: Config): void {
  if (!config.globalKeybindings?.Global) {
    config.globalKeybindings = {
      ...config.globalKeybindings,
      Global: defaultGlobalKeybindings,
      Worktrees: config.globalKeybindings?.Worktrees ?? defaultKeybindings,
    };
  }
}

export function createKeybindingResolver(
  config: Config,
  repositoryRoot: string,
): (tabName: TabName) => Record<string, Keybinding> {
  const repositoryConfig = config.repositories?.[repositoryRoot] ?? {};
  return (tabName: TabName): Record<string, Keybinding> => ({
    ...defaultGlobalKeybindings,
    ...config.globalKeybindings?.Global,
    ...(tabName === "Worktrees" ? defaultKeybindings : {}),
    ...config.globalKeybindings?.[tabName],
    ...repositoryConfig.keybindings?.[tabName],
  });
}
