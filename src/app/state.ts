import type { BranchOption, DetachedRef, Worktree, WorktreeCreationMode } from "../types.js";

import type { Theme } from "../services/themes.js";

export type PromptMode =
  | "create"
  | "delete"
  | "delete-branches"
  | "delete-remote"
  | "apply-theme"
  | "switch-actions"
  | "select-base"
  | null;

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
  pendingDeleteBranches: boolean;
  pendingTheme: Theme | null;
  worktreeOperationActive: boolean;
  pendingWorktreeSelection: { index: number; path: string } | null;
  pendingBaseBranch: string | null;
  pendingCreationMode: WorktreeCreationMode | null;
  pendingCreationBranch: BranchOption | null;
  pendingDetachedRef: DetachedRef | null;
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
    pendingDeleteBranches: false,
    pendingTheme: null,
    worktreeOperationActive: false,
    pendingWorktreeSelection: null,
    pendingBaseBranch: null,
    pendingCreationMode: null,
    pendingCreationBranch: null,
    pendingDetachedRef: null,
  };
}
