import { TabSelectRenderable, type CliRenderer } from "@opentui/core";

export function createTabs(renderer: CliRenderer): TabSelectRenderable {
  return new TabSelectRenderable(renderer, {
    position: "absolute",
    left: 2,
    height: 1,
    width: 56,
    tabWidth: 18,
    options: [
      { name: "worktrees", description: "Choose a Git worktree" },
      { name: "lazygit", description: "Review the active worktree" },
      { name: "actions", description: "Run project actions" },
    ],
    showDescription: false,
    showUnderline: true,
    selectedBackgroundColor: "transparent",
    selectedTextColor: "#ffffff",
    focusedBackgroundColor: "transparent",
    focusedTextColor: "#ffffff",
    zIndex: 5,
  });
}
