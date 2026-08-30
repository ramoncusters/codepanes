export type Worktree = { path: string; branch: string };
export type TabName = "Worktrees" | "Lazygit" | "Global";
export type Keybinding = { name: string; action: Action };
export type Action =
  | "select-worktrees"
  | "search-worktrees"
  | "create-worktree"
  | "delete-worktrees"
  | "edit-config";
export type TabKeybindings = Partial<Record<TabName, Record<string, Keybinding>>>;
export type Config = {
  globalKeybindings?: TabKeybindings;
  repositories?: Record<string, { keybindings?: TabKeybindings; postCreateActions?: string[] }>;
};
