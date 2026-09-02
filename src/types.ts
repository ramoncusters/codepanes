export type Worktree = { path: string; branch: string; name?: string; remote?: string };
export type TabName = "Worktrees" | "Lazygit" | "Global";
export type CommandTarget = "embedded" | "external" | "external-terminal";
export type Keybinding = {
  name: string;
  action: Action;
  command?: string;
  target?: CommandTarget;
};
export type Action =
  | "select-worktrees"
  | "search-worktrees"
  | "create-worktree"
  | "delete-worktrees"
  | "edit-config"
  | "switch-theme"
  | "run-command"
  | "clear-operations";
export type TabKeybindings = Partial<Record<TabName, Record<string, Keybinding>>>;
export type Config = {
  theme?: string;
  shell?: string;
  globalKeybindings?: TabKeybindings;
  projects?: Record<
    string,
    { shell?: string; keybindings?: TabKeybindings; postCreateActions?: string[] }
  >;
};
