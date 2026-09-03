import { TabSelectRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

export function createTabs(renderer: CliRenderer): TabSelectRenderable {
  return new TabSelectRenderable(renderer, {
    position: "absolute",
    left: 28,
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

export function createWorktreeChip(renderer: CliRenderer, backgroundColor: string): {
  panel: TextRenderable;
  text: TextRenderable;
} {
  const text = new TextRenderable(renderer, {
    position: "absolute",
    left: 3,
    top: 0,
    width: 24,
    height: 1,
    paddingLeft: 1,
    bg: backgroundColor,
    content: "-",
    zIndex: 6,
  });
  return { panel: text, text };
}
