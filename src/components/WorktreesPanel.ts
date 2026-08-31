import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  TextRenderable,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import { getWorktrees } from "../services/git.js";
import type { Worktree } from "../types.js";
import { CommandOutputPanel } from "./CommandOutputPanel.js";

export class WorktreesPanel {
  readonly panel: BoxRenderable;
  readonly output: CommandOutputPanel;
  readonly select: SelectRenderable;
  readonly searchBar: BoxRenderable;
  readonly searchInput: InputRenderable;
  readonly selectedWorktrees = new Set<string>();
  private worktrees: Worktree[];

  constructor(
    renderer: CliRenderer,
    initialWorktrees: Worktree[],
    backgroundColor: string,
  ) {
    this.worktrees = initialWorktrees;
    this.panel = new BoxRenderable(renderer, {
      paddingTop: 1,
      flexGrow: 1,
      flexDirection: "row",
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      backgroundColor,
    });
    const listPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: "column",
      padding: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      title: "overview",
      titleColor: "#7dd3fc",
      backgroundColor,
    });
    this.searchBar = new BoxRenderable(renderer, {
      height: 1,
      width: "100%",
      paddingLeft: 1,
      flexDirection: "row",
      flexShrink: 0,
      backgroundColor,
      visible: false,
    });
    this.searchInput = new InputRenderable(renderer, {
      flexGrow: 1,
      backgroundColor: "#0b1020",
      focusedBackgroundColor: "#18264a",
    });
    this.searchBar.add(new TextRenderable(renderer, { content: "Filter: ", fg: "#aab7d8" }));
    this.searchBar.add(this.searchInput);
    this.select = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      backgroundColor,
      focusedBackgroundColor: backgroundColor,
      options: [],
      showDescription: true,
      selectedTextColor: "#ffffff",
    });
    listPanel.add(this.select);
    listPanel.add(this.searchBar);
    this.output = new CommandOutputPanel(renderer, backgroundColor);
    this.panel.add(listPanel);
    this.panel.add(this.output.panel);
    this.searchInput.on(InputRenderableEvents.INPUT, () => {
      void this.refresh();
    });
    this.updateOptions();
  }

  get items(): Worktree[] {
    return this.worktrees.filter((worktree) => worktree.branch !== "(detached)");
  }

  async refresh(): Promise<void> {
    this.worktrees = await getWorktrees(process.cwd());
    this.updateOptions();
  }

  selectedTarget(): Worktree | undefined {
    return this.select.getSelectedOption()?.value as Worktree | undefined;
  }

  setBackgroundColor(backgroundColor: string): void {
    this.panel.backgroundColor = backgroundColor;
    this.output.setBackgroundColor(backgroundColor);
    this.searchBar.backgroundColor = backgroundColor;
    this.select.backgroundColor = backgroundColor;
    this.select.focusedBackgroundColor = backgroundColor;
  }

  applyPalette(palette: TerminalColors): void {
    this.output.applyPalette(palette);
  }

  private updateOptions(): void {
    const query = this.searchInput.value.toLowerCase();
    this.select.options = this.items
      .filter((worktree) => `${worktree.branch} ${worktree.path}`.toLowerCase().includes(query))
      .map((worktree) => ({
        name: `${this.selectedWorktrees.has(worktree.path) ? "[x] " : ""}${worktree.branch}`,
        description: worktree.path,
        value: worktree,
      }));
  }
}
