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
import type { Theme } from "../services/themes.js";
import type { Worktree } from "../types.js";
import { CommandOutputPanel } from "./CommandOutputPanel.js";

type OperationStatus = "creating" | "deleting" | "failed";
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class WorktreesPanel {
  readonly panel: BoxRenderable;
  readonly output: CommandOutputPanel;
  readonly select: SelectRenderable;
  readonly searchBar: BoxRenderable;
  readonly searchInput: InputRenderable;
  readonly searchLabel: TextRenderable;
  readonly selectedWorktrees = new Set<string>();
  private worktrees: Worktree[];
  private readonly listPanel: BoxRenderable;
  private readonly operations = new Map<string, OperationStatus>();
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;

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
    this.listPanel = new BoxRenderable(renderer, {
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
    this.searchLabel = new TextRenderable(renderer, { content: "Filter: ", fg: "#aab7d8" });
    this.searchBar.add(this.searchLabel);
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
    this.listPanel.add(this.select);
    this.listPanel.add(this.searchBar);
    this.output = new CommandOutputPanel(renderer, backgroundColor);
    this.panel.add(this.listPanel);
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

  beginCreating(worktree: Worktree): void {
    if (!this.worktrees.some((item) => item.path === worktree.path)) this.worktrees.push(worktree);
    this.operations.set(worktree.path, "creating");
    this.startSpinner();
    this.updateOptions();
  }

  setOperation(path: string, status: OperationStatus): void {
    this.operations.set(path, status);
    if (status !== "failed") this.startSpinner();
    else if (![...this.operations.values()].some((operation) => operation !== "failed")) this.stopSpinner();
    this.updateOptions();
  }

  removeOperation(path: string): void {
    this.operations.delete(path);
    this.worktrees = this.worktrees.filter((worktree) => worktree.path !== path);
    this.updateOptions();
    if (this.operations.size === 0) this.stopSpinner();
  }

  clearOperation(path: string): void {
    this.operations.delete(path);
    this.updateOptions();
    if (this.operations.size === 0) this.stopSpinner();
  }

  dispose(): void {
    this.stopSpinner();
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

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.border;
    this.listPanel.backgroundColor = theme.panelBackground;
    this.listPanel.borderColor = theme.border;
    this.listPanel.titleColor = theme.accent;
    this.searchBar.backgroundColor = theme.panelBackground;
    this.select.backgroundColor = theme.panelBackground;
    this.select.focusedBackgroundColor = theme.focusedBackground;
    this.select.selectedTextColor = theme.text;
    this.searchLabel.fg = theme.muted;
    this.searchInput.backgroundColor = theme.inputBackground;
    this.searchInput.focusedBackgroundColor = theme.focusedBackground;
    this.output.applyTheme(theme);
  }

  applyPalette(palette: TerminalColors): void {
    this.output.applyPalette(palette);
  }

  private updateOptions(): void {
    const query = this.searchInput.value.toLowerCase();
    this.select.options = this.items
      .filter((worktree) => `${worktree.branch} ${worktree.path}`.toLowerCase().includes(query))
      .map((worktree) => ({
        name: `${this.operationPrefix(worktree.path)}${this.selectedWorktrees.has(worktree.path) ? "[x] " : ""}${worktree.branch}`,
        description: worktree.path,
        value: worktree,
      }));
  }

  private operationPrefix(path: string): string {
    const status = this.operations.get(path);
    if (status === "failed") return "✖ ";
    if (status === "creating" || status === "deleting") return `${spinnerFrames[this.spinnerFrame]} `;
    return "";
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % spinnerFrames.length;
      this.updateOptions();
    }, 100);
  }

  private stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    this.spinnerFrame = 0;
  }
}
