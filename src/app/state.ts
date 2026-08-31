import type { Worktree } from "../types.js";

import type { Theme } from "../services/themes.js";

export type PromptMode = "create" | "delete" | "delete-branches" | "apply-theme" | null;

export type AppState = {
  activeTab: number;
  terminalFocused: boolean;
  searchActive: boolean;
  promptActive: boolean;
  keybindingsActive: boolean;
  configEditorActive: boolean;
  configInstructionsActive: boolean;
  promptMode: PromptMode;
  pendingDeleteTargets: Worktree[];
  pendingTheme: Theme | null;
  worktreeOperationActive: boolean;
};

export function createAppState(): AppState {
  return {
    activeTab: 0,
    terminalFocused: false,
    searchActive: false,
    promptActive: false,
    keybindingsActive: false,
    configEditorActive: false,
    configInstructionsActive: false,
    promptMode: null,
    pendingDeleteTargets: [],
    pendingTheme: null,
    worktreeOperationActive: false,
  };
}
