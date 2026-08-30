import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { getWorktrees } from "../services/git.js";
import type { Worktree } from "../types.js";

export class WorktreesPanel {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly searchBar: BoxRenderable;
  readonly searchInput: InputRenderable;
  readonly selectedWorktrees = new Set<string>();
  private worktrees: Worktree[];

  constructor(
    renderer: CliRenderer,
    initialWorktrees: Worktree[],
  ) {
    this.worktrees = initialWorktrees;
    this.panel = new BoxRenderable(renderer, {
      paddingTop: 1,
      flexGrow: 1,
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      backgroundColor: "#111a33",
    });
    this.searchBar = new BoxRenderable(renderer, {
      height: 1,
      width: "100%",
      paddingLeft: 1,
      flexDirection: "row",
      flexShrink: 0,
      backgroundColor: "#111a33",
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
      backgroundColor: "#111a33",
      focusedBackgroundColor: "#111a33",
      options: [],
      showDescription: true,
      selectedTextColor: "#ffffff",
    });
    this.panel.add(this.select);
    this.panel.add(this.searchBar);
    this.searchInput.on(InputRenderableEvents.INPUT, () => {
      void this.refresh();
    });
    this.updateOptions();
  }

  get items(): Worktree[] {
    return this.worktrees;
  }

  async refresh(): Promise<void> {
    this.worktrees = await getWorktrees(process.cwd());
    this.updateOptions();
  }

  selectedTarget(): Worktree | undefined {
    return this.select.getSelectedOption()?.value as Worktree | undefined;
  }

  private updateOptions(): void {
    const query = this.searchInput.value.toLowerCase();
    this.select.options = this.worktrees
      .filter((worktree) => `${worktree.branch} ${worktree.path}`.toLowerCase().includes(query))
      .map((worktree) => ({
        name: `${this.selectedWorktrees.has(worktree.path) ? "[x] " : ""}${worktree.branch}`,
        description: worktree.path,
        value: worktree,
      }));
  }
}
