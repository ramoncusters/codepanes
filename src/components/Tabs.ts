import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

type TabTheme = {
  text: string;
  accent: string;
  background: string;
  focusedBackground: string;
};

const tabNames = ["worktrees", "lazygit", "collaboration", "actions"];

export class VariableTabs extends BoxRenderable {
  private readonly items: BoxRenderable[] = [];
  private selectedIndex = 0;
  private theme: TabTheme = {
    text: "#aab7d8",
    accent: "#7dd3fc",
    background: "transparent",
    focusedBackground: "#18264a",
  };

  constructor(renderer: CliRenderer) {
    super(renderer, {
      position: "absolute",
      left: 28,
      top: 0,
      height: 2,
      flexDirection: "row",
      backgroundColor: "transparent",
      zIndex: 5,
    });
    for (const [index, name] of tabNames.entries()) {
      const item = new BoxRenderable(renderer, {
        width: name.length + 2,
        height: 2,
        flexDirection: "column",
        alignItems: "stretch",
        border: [],
        backgroundColor: "transparent",
        onMouseDown: () => {
          this.setSelectedIndex(index);
          this.emit("itemSelected", index);
        },
      });
      item.add(new TextRenderable(renderer, {
        width: name.length + 2,
        height: 1,
        content: ` ${name} `,
        fg: this.theme.accent,
        bg: this.theme.focusedBackground,
      }));
      this.items.push(item);
      this.add(item);
    }
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(index: number): void {
    if (index < 0 || index >= tabNames.length || index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.renderItems();
    this.emit("selectionChanged", index);
  }

  itemLeft(index: number): number {
    return tabNames.slice(0, index).reduce((total, name) => total + name.length + 2, 0);
  }

  totalWidth(): number {
    return this.itemLeft(tabNames.length);
  }

  applyTheme(theme: TabTheme): void {
    this.theme = theme;
    this.renderItems();
  }

  private renderItems(): void {
    for (const [index, item] of this.items.entries()) {
      const selected = index === this.selectedIndex;
      item.border = [];
      item.backgroundColor = "transparent";
      const text = item.getChildren()[0] as TextRenderable;
      text.fg = selected ? this.theme.accent : this.theme.text;
      text.bg = selected ? this.theme.focusedBackground : this.theme.background;
    }
  }
}

export function createTabs(renderer: CliRenderer): VariableTabs {
  return new VariableTabs(renderer);
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
