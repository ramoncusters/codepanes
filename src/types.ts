export type Worktree = { path: string; branch: string; name?: string; remote?: string };
export type BranchOption = { name: string; ref: string; remote: boolean };
export type TabName = "Worktrees" | "Lazygit" | "Actions" | "Global";
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
  | "clear-operations"
  | "run-action"
  | "stop-action"
  | "stop-actions";
export type TabKeybindings = Partial<Record<TabName, Record<string, Keybinding>>>;
export type ProjectAction = {
  name: string;
  command: string;
  persistent?: boolean;
};
export type Config = {
  theme?: string;
  shell?: string;
  globalKeybindings?: TabKeybindings;
  projects?: Record<
    string,
    {
      shell?: string;
      keybindings?: TabKeybindings;
      postCreateActions?: string[];
      actions?: ProjectAction[];
    }
  >;
};
