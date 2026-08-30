import type { Worktree } from "../types.js";

export type PromptMode = "create" | "delete" | "delete-branches" | null;

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
  };
}
