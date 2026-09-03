import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import path from "node:path";
import { getWorktrees } from "../services/git.js";
import type { Theme } from "../services/themes.js";
import type { Worktree } from "../types.js";
import { CommandOutputPanel } from "./CommandOutputPanel.js";
import { WorktreeRow } from "./WorktreeRow.js";

type OperationStatus = "creating" | "deleting" | "failed";
type OperationKind = "create" | "delete";
type OperationRecord = {
  name: string;
  kind: OperationKind;
  status: "active" | "failed" | "completed";
};
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class WorktreesPanel {
  readonly panel: BoxRenderable;
  readonly output: CommandOutputPanel;
  readonly select: SelectRenderable;
  readonly searchBar: BoxRenderable;
  readonly searchInput: InputRenderable;
  readonly searchLabel: TextRenderable;
  readonly listHeader: TextRenderable;
  readonly operationsPanel: BoxRenderable;
  readonly selectedWorktrees = new Set<string>();
  private worktrees: Worktree[];
  private readonly listPanel: BoxRenderable;
  private readonly rowsPanel: BoxRenderable;
  private readonly rows: WorktreeRow[] = [];
  private readonly operationRows: TextRenderable[] = [];
  private readonly operationRowsPanel: BoxRenderable;
  private readonly operationSpacer: TextRenderable;
  private readonly operationHint: TextRenderable;
  private readonly renderer: CliRenderer;
  private updatingOptions = false;
  private theme: Theme;
  private readonly operations = new Map<string, OperationStatus>();
  private readonly operationRecords = new Map<string, OperationRecord>();
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private outputFocused = false;
  private activeWorktreePath: string | undefined;
  private readonly handleResize = (width: number): void => {
    const stacked = width < 100;
    this.panel.flexDirection = stacked ? "column" : "row";
    this.listPanel.flexShrink = stacked ? 0 : 1;
    this.listPanel.minHeight = stacked ? this.minimumOverviewHeight() : null;
    this.rowsPanel.flexShrink = stacked ? 0 : 1;
    this.rowsPanel.minHeight = stacked ? this.rows.length + 1 : null;
    this.output.panel.flexShrink = stacked ? 1 : 1;
    this.output.panel.minHeight = stacked ? 3 : null;
  };

  constructor(
    renderer: CliRenderer,
    initialWorktrees: Worktree[],
    backgroundColor: string,
  ) {
    this.renderer = renderer;
    this.theme = {
      id: "initial",
      name: "Initial",
      background: backgroundColor,
      panelBackground: backgroundColor,
      inputBackground: backgroundColor,
      focusedBackground: backgroundColor,
      border: "#2b3c68",
      accent: "#7dd3fc",
      text: "#ffffff",
      muted: "#aab7d8",
    };
    this.worktrees = initialWorktrees;
    this.activeWorktreePath = this.items[0]?.path;
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
      showDescription: false,
      showSelectionIndicator: false,
      wrapSelection: true,
      selectedBackgroundColor: "#18264a",
      focusedTextColor: "#ffffff",
      descriptionColor: "#aab7d8",
      selectedDescriptionColor: "#ffffff",
      selectedTextColor: "#ffffff",
    });
    this.listHeader = new TextRenderable(renderer, {
      content: `${"".padEnd(4)}${"WORKTREE".padEnd(18)}│ ${"BRANCH".padEnd(18)}│ REMOTE`,
      fg: "#aab7d8",
      flexShrink: 0,
    });
    this.listPanel.add(this.listHeader);
    this.rowsPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
      paddingTop: 1,
    });
    this.listPanel.add(this.rowsPanel);
    this.operationsPanel = new BoxRenderable(renderer, {
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      title: "operations",
      titleColor: "#7dd3fc",
      backgroundColor,
      padding: 1,
      visible: false,
      flexShrink: 0,
    });
    this.operationRowsPanel = new BoxRenderable(renderer, {
      flexDirection: "column",
      flexGrow: 1,
    });
    this.operationHint = new TextRenderable(renderer, {
      content: "press x to clear operations",
      fg: "#aab7d8",
    });
    this.operationSpacer = new TextRenderable(renderer, { content: " ", height: 1 });
    this.operationsPanel.add(this.operationRowsPanel);
    this.operationsPanel.add(this.operationSpacer);
    this.operationsPanel.add(this.operationHint);
    this.listPanel.add(this.operationsPanel);
    this.listPanel.add(this.select);
    this.listPanel.add(this.searchBar);
    this.output = new CommandOutputPanel(renderer, backgroundColor);
    this.panel.add(this.listPanel);
    this.panel.add(this.output.panel);
    renderer.on("resize", this.handleResize);
    this.handleResize(renderer.width);
    this.searchInput.on(InputRenderableEvents.INPUT, () => {
      void this.refresh();
    });
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      if (this.updatingOptions) return;
      this.updateOptions();
    });
    this.select.visible = false;
    this.updateOptions();
  }

  get items(): Worktree[] {
    return this.worktrees.filter((worktree) => worktree.branch !== "(detached)");
  }

  get activeWorktree(): Worktree | undefined {
    return this.items.find((worktree) => worktree.path === this.activeWorktreePath);
  }

  setActiveWorktree(worktree: Worktree | undefined): void {
    this.activeWorktreePath = worktree?.path;
    this.updateOptions();
  }

  async refresh(): Promise<void> {
    this.worktrees = await getWorktrees(process.cwd());
    this.updateOptions();
  }

  beginCreating(worktree: Worktree): void {
    this.operations.set(worktree.path, "creating");
    this.operationRecords.set(worktree.path, { name: worktree.name ?? worktree.branch, kind: "create", status: "active" });
    this.startSpinner();
    this.updateOptions();
  }

  setOperation(path: string, status: OperationStatus, kind?: OperationKind, name?: string): void {
    this.operations.set(path, status);
    const record = this.operationRecords.get(path);
    this.operationRecords.set(path, {
      name: name ?? record?.name ?? path,
      kind: kind ?? record?.kind ?? "delete",
      status: status === "failed" ? "failed" : "active",
    });
    if (status !== "failed") this.startSpinner();
    else if (![...this.operations.values()].some((operation) => operation !== "failed")) this.stopSpinner();
    this.updateOptions();
  }

  removeOperation(path: string): void {
    this.operations.delete(path);
    this.updateOptions();
    if (this.operations.size === 0) this.stopSpinner();
  }

  clearOperation(path: string): void {
    this.operations.delete(path);
    const record = this.operationRecords.get(path);
    if (record) record.status = "completed";
    this.updateOptions();
    if (this.operations.size === 0) this.stopSpinner();
  }

  clearOperations(): void {
    this.operationRecords.clear();
    this.updateOptions();
    if (this.operations.size === 0) this.stopSpinner();
  }

  dispose(): void {
    this.stopSpinner();
    this.renderer.off("resize", this.handleResize);
  }

  selectedTarget(): Worktree | undefined {
    return this.select.getSelectedOption()?.value as Worktree | undefined;
  }

  formatTable(worktrees: Worktree[]): string {
    const header = `${"".padEnd(4)}${"WORKTREE".padEnd(18)}│ ${"BRANCH".padEnd(18)}│ REMOTE`;
    const rows = worktrees.map((worktree) => {
      const name = (worktree.name ?? path.basename(worktree.path)).padEnd(18, " ").slice(0, 18);
      const branch = worktree.branch.padEnd(18, " ").slice(0, 18);
      const remote = worktree.remote ? `● ${worktree.remote}` : "○ local only";
      return `    ${name}│ ${branch}│ ${remote}`;
    });
    return [header, ...rows].join("\n");
  }

  setBackgroundColor(backgroundColor: string): void {
    this.panel.backgroundColor = backgroundColor;
    this.output.setBackgroundColor(backgroundColor);
    this.searchBar.backgroundColor = backgroundColor;
    this.select.backgroundColor = backgroundColor;
    this.select.focusedBackgroundColor = backgroundColor;
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.border;
    this.listPanel.backgroundColor = theme.panelBackground;
    this.listPanel.borderColor = theme.border;
    this.listPanel.titleColor = theme.accent;
    this.searchBar.backgroundColor = theme.panelBackground;
    this.select.backgroundColor = theme.panelBackground;
    this.select.focusedBackgroundColor = theme.focusedBackground;
    this.select.selectedBackgroundColor = theme.focusedBackground;
    this.select.textColor = theme.text;
    this.select.focusedTextColor = theme.text;
    this.select.descriptionColor = theme.muted;
    this.select.selectedDescriptionColor = theme.text;
    this.select.selectedTextColor = theme.text;
    this.searchLabel.fg = theme.muted;
    this.listHeader.fg = theme.muted;
    this.operationsPanel.backgroundColor = theme.panelBackground;
    this.operationsPanel.borderColor = theme.border;
    this.operationsPanel.titleColor = theme.accent;
    this.operationHint.fg = theme.muted;
    this.searchInput.backgroundColor = theme.inputBackground;
    this.searchInput.focusedBackgroundColor = theme.focusedBackground;
    this.output.applyTheme(theme);
    this.updateOptions();
  }

  applyPalette(palette: TerminalColors): void {
    this.output.applyPalette(palette);
  }

  focusOverview(): void {
    this.outputFocused = false;
    this.output.blur();
    this.select.focus();
  }

  focusOutput(): void {
    this.outputFocused = true;
    this.select.blur();
    this.output.focus();
  }

  isOutputFocused(): boolean {
    return this.outputFocused;
  }

  scrollOutput(lines: number): void {
    this.output.scrollBy(lines);
  }

  private updateOptions(): void {
    const query = this.searchInput.value.toLowerCase();
    const filtered = this.items.filter((worktree) =>
      `${worktree.name ?? path.basename(worktree.path)} ${worktree.branch} ${worktree.path}`.toLowerCase().includes(query),
    );
    const options = filtered
      .map((worktree, index) => ({
        name: worktree.branch,
        description: worktree.path,
        value: worktree,
      }));
    this.updatingOptions = true;
    try {
      this.select.options = options;
      for (const row of this.rows) {
        this.rowsPanel.remove(row.panel);
        row.panel.destroy();
      }
      this.rows.length = 0;
      for (const [index, worktree] of filtered.entries()) {
        const row = new WorktreeRow(this.renderer, worktree, {
          cursorSelected: index === this.select.getSelectedIndex(),
          selected: this.selectedWorktrees.has(worktree.path),
          active: worktree.path === this.activeWorktreePath,
        }, this.theme);
        this.rows.push(row);
        this.rowsPanel.add(row.panel);
      }
      this.renderOperations();
      this.handleResize(this.renderer.width);
    } finally {
      this.updatingOptions = false;
    }
  }

  private operationPrefix(path: string): string {
    const status = this.operations.get(path);
    if (status === "failed") return "✖";
    if (status === "creating" || status === "deleting") return spinnerFrames[this.spinnerFrame];
    return "";
  }

  private renderOperations(): void {
    for (const row of this.operationRows) {
      this.operationRowsPanel.remove(row);
      row.destroy();
    }
    this.operationRows.length = 0;
    for (const record of this.operationRecords.values()) {
      const verb = record.kind === "create" ? "creating new worktree" : "deleting worktree";
      const prefix = record.status === "active"
        ? spinnerFrames[this.spinnerFrame]
        : record.status === "failed"
          ? "×"
          : "✓";
      const text = record.status === "failed"
        ? `${prefix} failed to ${record.kind === "create" ? "create" : "delete"} ${record.name}`
        : record.status === "completed"
          ? `${prefix} successfully ${record.kind === "create" ? "created" : "deleted"} ${record.name}`
          : `${prefix} ${verb} ${record.name}`;
      const row = new TextRenderable(this.renderer, { content: text, fg: this.theme.text });
      this.operationRows.push(row);
      this.operationRowsPanel.add(row);
    }
    this.operationsPanel.visible = this.operationRecords.size > 0;
    this.operationsPanel.height = this.operationRecords.size > 0 ? this.operationRecords.size + 6 : 1;
  }

  private minimumOverviewHeight(): number {
    const operationsHeight = this.operationRecords.size > 0 ? this.operationRecords.size + 6 : 0;
    return Math.max(8, this.rows.length + operationsHeight + 7);
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
