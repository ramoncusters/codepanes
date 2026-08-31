export type Worktree = { path: string; branch: string };
export type TabName = "Worktrees" | "Lazygit" | "Global";
export type Keybinding = { name: string; action: Action };
export type Action =
  | "select-worktrees"
  | "search-worktrees"
  | "create-worktree"
  | "delete-worktrees"
  | "edit-config"
  | "switch-theme";
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
