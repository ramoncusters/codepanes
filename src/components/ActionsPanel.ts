import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import type { IPty } from "node-pty";
import {
  expandWorktreeCommand,
  interactiveShellArgs,
  interactiveShellEnvironment,
} from "../services/commands.js";
import { spawnPty } from "../services/pty.js";
import type { ProjectAction, Worktree } from "../types.js";
import type { Theme } from "../services/themes.js";
import { CommandOutputPanel } from "./CommandOutputPanel.js";
import { ActionRow, type ActionRowStatus } from "./ActionRow.js";
import { ListItemRow } from "./ListItemRow.js";
import { keyHints } from "./keyHints.js";
import { findActionProcesses, stopProcess, type ProcessMatch } from "../services/processes.js";

const processSpinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type ActionProcess = {
  actionIndex: number;
  action: ProjectAction;
  worktree: Worktree;
  pty: IPty;
};

export class ActionsPanel {
  readonly panel: BoxRenderable;
  private readonly listPanel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly output: CommandOutputPanel;
  private actions: ProjectAction[];
  private currentWorktree: Worktree | undefined;
  private readonly processes = new Map<number, ActionProcess>();
  private readonly outputs = new Map<number, CommandOutputPanel>();
  private readonly rows: ActionRow[] = [];
  private readonly rowsPanel: ScrollBoxRenderable;
  private readonly statuses = new Map<number, ActionRowStatus>();
  private readonly otherProcessCounts = new Map<number, number>();
  private readonly stopping = new Set<number>();
  private readonly processPanel: BoxRenderable;
  private readonly processSelect: SelectRenderable;
  private readonly processRowsPanel: BoxRenderable;
  private readonly processRows: ListItemRow[] = [];
  private readonly processInfo: TextRenderable;
  private readonly processOperationsPanel: BoxRenderable;
  private readonly processOperationRowsPanel: BoxRenderable;
  private readonly processOperationRows: TextRenderable[] = [];
  private readonly processOperationSpacer: TextRenderable;
  private readonly processOperationHint: TextRenderable;
  private processMatches: ProcessMatch[] = [];
  private processView = false;
  private processSpinnerTimer: ReturnType<typeof setInterval> | null = null;
  private processSpinnerFrame = 0;
  private outputFocused = false;
  private pulse = false;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private processHintTimer: ReturnType<typeof setInterval> | null = null;
  private readonly handleResize = (width: number): void => {
    const stacked = width < 100;
    this.panel.flexDirection = stacked ? "column" : "row";
    this.panel.border = true;
    this.panel.paddingTop = stacked ? 4 : 1;
    this.listPanel.flexShrink = stacked ? 0 : 1;
    this.listPanel.minHeight = stacked ? 6 : null;
    this.output.panel.flexShrink = 1;
    this.output.panel.minHeight = stacked ? 3 : null;
    for (const output of this.outputs.values()) {
      output.panel.flexShrink = 1;
      output.panel.minHeight = stacked ? 3 : null;
    }
  };
  private theme: Theme;

  constructor(
    private readonly renderer: CliRenderer,
    actions: ProjectAction[],
    private readonly shell: string,
    backgroundColor: string,
  ) {
    this.actions = actions;
    this.theme = {
      id: "initial",
      name: "Initial",
      mode: "dark",
      background: backgroundColor,
      panelBackground: backgroundColor,
      inputBackground: backgroundColor,
      focusedBackground: backgroundColor,
      border: "#2b3c68",
      accent: "#7dd3fc",
      text: "#ffffff",
      muted: "#aab7d8",
    };
    this.panel = new BoxRenderable(renderer, {
      paddingTop: 1,
      flexGrow: 1,
      flexDirection: "row",
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      backgroundColor: "transparent",
    });
    this.listPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: "column",
      padding: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      title: "actions",
      titleColor: "#7dd3fc",
      backgroundColor,
    });
    this.select = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      backgroundColor,
      focusedBackgroundColor: backgroundColor,
      options: [],
      showDescription: true,
      showSelectionIndicator: true,
      wrapSelection: true,
      selectedBackgroundColor: "#18264a",
      focusedTextColor: "#ffffff",
      descriptionColor: "#aab7d8",
      selectedDescriptionColor: "#ffffff",
      selectedTextColor: "#ffffff",
    });
    this.rowsPanel = new ScrollBoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      scrollY: true,
      viewportCulling: true,
      contentOptions: {
        flexDirection: "column",
        gap: 1,
      },
    });
    this.listPanel.add(this.rowsPanel);
    this.select.visible = false;
    this.output = new CommandOutputPanel(renderer, backgroundColor);
    this.output.panel.visible = this.actions.length === 0;
    this.listPanel.add(this.select);
    this.panel.add(this.listPanel);
    this.panel.add(this.output.panel);
    this.processPanel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "10%",
      left: "10%",
      width: "80%",
      height: "70%",
      flexDirection: "column",
      padding: 1,
      border: true,
      borderStyle: "rounded",
      title: "processes",
      borderColor: "#2b3c68",
      backgroundColor,
      titleColor: "#7dd3fc",
      zIndex: 20,
      visible: false,
    });
    this.processSelect = new SelectRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      options: [],
      showDescription: true,
      showSelectionIndicator: true,
      backgroundColor,
      focusedBackgroundColor: backgroundColor,
      selectedBackgroundColor: "#18264a",
      focusedTextColor: "#ffffff",
      selectedTextColor: "#ffffff",
      descriptionColor: "#aab7d8",
      selectedDescriptionColor: "#ffffff",
    });
    this.processRowsPanel = new BoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
      gap: 1,
    });
    this.processSelect.visible = false;
    this.processInfo = new TextRenderable(renderer, { content: "", fg: "#aab7d8" });
    this.processOperationsPanel = new BoxRenderable(renderer, {
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
    this.processOperationRowsPanel = new BoxRenderable(renderer, {
      flexDirection: "column",
      flexGrow: 1,
    });
    this.processOperationSpacer = new TextRenderable(renderer, { content: " ", height: 1 });
    this.processOperationHint = new TextRenderable(renderer, {
      content: keyHints(this.theme, [["x", "clear operations"]]),
      fg: "#aab7d8",
    });
    this.processPanel.add(this.processRowsPanel);
    this.processPanel.add(this.processSelect);
    this.processPanel.add(this.processInfo);
    this.processOperationsPanel.add(this.processOperationRowsPanel);
    this.processOperationsPanel.add(this.processOperationSpacer);
    this.processOperationsPanel.add(this.processOperationHint);
    this.processPanel.add(this.processOperationsPanel);
    this.panel.add(this.processPanel);
    for (const [index, action] of this.actions.entries()) {
      const output = new CommandOutputPanel(renderer, backgroundColor);
      output.panel.title = action.name;
      output.panel.visible = index === 0;
      this.outputs.set(index, output);
      this.panel.add(output.panel);
    }
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      this.showSelectedOutput();
      this.renderRows();
    });
    this.processSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      this.updateProcessInfo();
      this.renderProcessRows();
    });
    renderer.on("resize", this.handleResize);
    this.handleResize(renderer.width);
    this.updateOptions();
    this.processHintTimer = setInterval(() => {
      void this.refreshProcessHints();
    }, 5000);
  }

  get activeCount(): number {
    return this.processes.size;
  }

  hasActiveProcesses(): boolean {
    return this.processes.size > 0;
  }

  setWorktree(worktree: Worktree | undefined): void {
    this.currentWorktree = worktree;
    this.listPanel.title = "actions";
    this.updateOptions();
    void this.refreshProcessHints();
  }

  focusActions(): void {
    this.outputFocused = false;
    this.selectedOutput().blur();
    this.listPanel.borderColor = this.theme.accent;
    this.select.focus();
  }

  focusOutput(): void {
    this.outputFocused = true;
    this.select.blur();
    this.listPanel.borderColor = this.theme.border;
    this.selectedOutput().focus();
  }

  isOutputFocused(): boolean {
    return this.outputFocused;
  }

  scrollOutput(lines: number): void {
    this.selectedOutput().scrollBy(lines);
  }

  isProcessView(): boolean {
    return this.processView;
  }

  openProcessView(): void {
    const action = this.actions[this.select.getSelectedIndex()];
    if (action) this.processPanel.title = `processes: ${action.name}`;
    this.processView = true;
    this.processPanel.visible = true;
    this.select.blur();
    this.processSelect.focus();
    void this.refreshProcesses();
  }

  closeProcessView(): void {
    this.processView = false;
    this.processPanel.visible = false;
    this.processSelect.blur();
    this.focusActions();
  }

  async refreshProcesses(): Promise<void> {
    const actionIndex = this.select.getSelectedIndex();
    const action = this.actions[actionIndex];
    if (!action) return;
    const command = expandWorktreeCommand(
      action.command,
      this.currentWorktree?.path ?? "",
      this.currentWorktree?.branch ?? "",
    );
    try {
      this.processMatches = await findActionProcesses(
        command,
        this.processes.get(actionIndex)?.pty.pid,
        this.currentWorktree?.path,
      );
      this.processSelect.options = this.processMatches.map((match) => ({
        name: `PID ${match.pid}`,
        description: `${match.elapsed} · ${match.command}`,
        value: match,
      }));
      this.updateProcessInfo();
      this.renderProcessRows();
    } catch (error: unknown) {
      this.processMatches = [];
      this.processSelect.options = [];
      this.processInfo.content = `Unable to inspect processes: ${String(error)}`;
      this.renderProcessRows();
    }
  }

  selectedProcess(): ProcessMatch | undefined {
    return this.processMatches[this.processSelect.getSelectedIndex()];
  }

  async stopSelectedProcess(tree: boolean): Promise<void> {
    const process = this.selectedProcess();
    if (!process) return;
    const operation = new TextRenderable(this.renderer, { content: "", fg: this.theme.text });
    this.processOperationRows.push(operation);
    this.processOperationRowsPanel.add(operation);
    this.processOperationsPanel.visible = true;
    this.startProcessSpinner(process.pid, operation);
    try {
      await stopProcess(process.pid, tree);
      const deadline = Date.now() + 10_000;
      let stopped = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await this.refreshProcesses();
        stopped = !this.processMatches.some((match) => match.pid === process.pid);
        if (stopped) break;
      }

      operation.content = stopped
        ? `✓ stopped PID ${process.pid}`
        : `⚠ PID ${process.pid} is still running`;
    } catch (error: unknown) {
      operation.content = `✖ unable to stop PID ${process.pid}: ${String(error)}`;
      await this.refreshProcesses();
    } finally {
      this.stopProcessSpinner();
      if (this.processView) this.processSelect.focus();
    }
  }

  clearProcessOperations(): void {
    for (const operation of this.processOperationRows) {
      this.processOperationRowsPanel.remove(operation);
      operation.destroy();
    }
    this.processOperationRows.length = 0;
    this.processOperationsPanel.visible = false;
  }

  applyPalette(palette: TerminalColors): void {
    this.output.applyPalette(palette);
    for (const output of this.outputs.values()) output.applyPalette(palette);
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.panel.backgroundColor = "transparent";
    this.listPanel.backgroundColor = theme.background;
    this.panel.borderColor = theme.border;
    this.listPanel.borderColor = this.outputFocused ? theme.border : theme.accent;
    this.listPanel.titleColor = theme.accent;
    this.processPanel.backgroundColor = theme.background;
    this.processPanel.borderColor = theme.accent;
    this.processPanel.titleColor = theme.accent;
    this.processOperationsPanel.backgroundColor = theme.panelBackground;
    this.processOperationsPanel.borderColor = theme.border;
    this.processOperationsPanel.titleColor = theme.accent;
    this.processOperationHint.fg = theme.muted;
    this.processOperationHint.content = keyHints(theme, [["x", "clear operations"]]);
    for (const operation of this.processOperationRows) operation.fg = theme.text;
    this.processSelect.backgroundColor = theme.background;
    this.processSelect.focusedBackgroundColor = theme.background;
    this.processSelect.selectedBackgroundColor = theme.focusedBackground;
    this.processSelect.textColor = theme.text;
    this.processSelect.focusedTextColor = theme.text;
    this.processSelect.selectedTextColor = theme.text;
    this.processSelect.descriptionColor = theme.muted;
    this.processSelect.selectedDescriptionColor = theme.text;
    this.processInfo.fg = theme.muted;
    this.output.applyTheme(theme);
    for (const output of this.outputs.values()) output.applyTheme(theme);
    for (const row of this.rows) row.applyTheme(theme);
    this.updateOptions();
    this.renderProcessRows();
  }

  runSelected(worktree = this.currentWorktree): void {
    const actionIndex = this.select.getSelectedIndex();
    const action = this.actions[actionIndex];
    if (!action || !worktree) {
      this.selectedOutput().writeMessage(
        worktree ? "No configured action is available." : "No worktree is selected.",
        this.theme.error ?? this.theme.accent,
      );
      return;
    }
    if (this.processes.has(actionIndex)) {
      this.selectedOutput().writeMessage(`${action.name} is already running.`, this.theme.accent);
      return;
    }

    const command = expandWorktreeCommand(action.command, worktree.path, worktree.branch);
    const output = this.outputFor(actionIndex);
    output.clear();
    let actionPty: IPty;
    try {
      actionPty = spawnPty(this.shell, interactiveShellArgs(this.shell), {
        cwd: worktree.path,
        cols: Math.max(20, output.terminal.width),
        rows: Math.max(8, output.terminal.height),
        name: "xterm-256color",
        env: {
          SHELL: this.shell,
          TERM: "xterm-256color",
          ...interactiveShellEnvironment(this.shell),
        },
      });
    } catch (error) {
      this.statuses.set(actionIndex, "failed");
      this.selectedOutput().writeMessage(`[failed] ${action.name}: ${String(error)}`, this.theme.error ?? this.theme.accent);
      this.renderRows();
      return;
    }
    const process: ActionProcess = { actionIndex, action, worktree, pty: actionPty };
    this.statuses.set(actionIndex, "running");
    this.processes.set(actionIndex, process);
    this.updateOptions();
    output.writeMessage(
      `[started] ${action.name} (${worktree.branch})${action.persistent ? " [persistent]" : ""}`,
      this.theme.success ?? this.theme.accent,
    );
    actionPty.onData((data) => this.outputFor(actionIndex).write(data));
    actionPty.onExit(({ exitCode, signal }) => {
      if (this.processes.get(actionIndex)?.pty !== actionPty) return;
      this.processes.delete(actionIndex);
      const wasStopped = this.stopping.delete(actionIndex);
      const result = signal ? `terminated by ${signal}` : `exited with code ${exitCode}`;
      const succeeded = !signal && exitCode === 0;
      this.statuses.set(actionIndex, wasStopped ? "idle" : succeeded ? "success" : "failed");
      this.updateOptions();
      const label = wasStopped ? "stopped" : succeeded ? "completed" : "failed";
      this.outputFor(actionIndex).writeMessage(`[${label}] ${action.name}: ${wasStopped ? "stopped by user" : result}`, wasStopped
        ? this.theme.muted
        : succeeded
        ? this.theme.success ?? this.theme.accent
        : this.theme.error ?? this.theme.accent);
    });
    const exitCommand = pathShellExit(this.shell);
    actionPty.write(`${command}\n${exitCommand}\n`);
  }

  stopSelected(): void {
    const actionIndex = this.select.getSelectedIndex();
    const process = this.processes.get(actionIndex);
    if (!process) {
      this.output.writeMessage("The selected action is not running.", this.theme.muted);
      return;
    }
    this.stopping.add(actionIndex);
    process.pty.kill();
  }

  stopAll(): void {
    for (const [actionIndex, process] of this.processes) {
      this.stopping.add(actionIndex);
      process.pty.kill();
    }
  }

  dispose(): void {
    this.stopAll();
    this.renderer.off("resize", this.handleResize);
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    if (this.processHintTimer) clearInterval(this.processHintTimer);
    this.processes.clear();
  }

  private updateOptions(): void {
    this.select.options = this.actions.map((action, index) => {
      const process = this.processes.get(index);
      const status = process ? `running in ${process.worktree.branch}` : "idle";
      return {
        name: `${action.persistent ? "↻ " : ""}${action.name}`,
        description: `${status} · ${action.command}`,
        value: action,
      };
    });
    this.renderRows();
    if (this.processes.size > 0 && !this.pulseTimer) {
      this.pulseTimer = setInterval(() => {
        this.pulse = !this.pulse;
        this.renderRows();
      }, 500);
    } else if (this.processes.size === 0 && this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  private renderRows(): void {
    for (const [index, action] of this.actions.entries()) {
      const status = this.statuses.get(index) ?? "idle";
      const selected = index === this.select.getSelectedIndex();
      const row = this.rows[index];
      if (row) {
        row.update(action.name, action.command, status, selected, this.pulse, this.otherProcessCounts.get(index) ?? 0);
        if (selected) this.rowsPanel.scrollChildIntoView(row.panel.id);
      } else {
        const newRow = new ActionRow(
          this.renderer,
          action.name,
          action.command,
          status,
          selected,
          this.pulse,
          this.otherProcessCounts.get(index) ?? 0,
          this.theme,
        );
        this.rows.push(newRow);
        this.rowsPanel.add(newRow.panel);
      }
    }
    while (this.rows.length > this.actions.length) {
      const row = this.rows.pop();
      if (!row) continue;
      this.rowsPanel.remove(row.panel);
      row.panel.destroy();
    }
  }

  private renderProcessRows(): void {
    for (const [index, process] of this.processMatches.entries()) {
      const selected = index === this.processSelect.getSelectedIndex();
      const status = process.source === "attached"
        ? { text: "● Attached", color: this.theme.success ?? this.theme.accent }
        : { text: "⚠ Unverified source", color: this.theme.accent };
      const existing = this.processRows[index];
      if (existing) {
        existing.update(`PID ${process.pid}`, [`${process.elapsed} · ${process.command}`], status, selected);
      } else {
        const row = new ListItemRow(
          this.renderer,
          `PID ${process.pid}`,
          [`${process.elapsed} · ${process.command}`],
          status,
          selected,
          this.theme,
          24,
        );
        this.processRows.push(row);
        this.processRowsPanel.add(row.panel);
      }
    }
    while (this.processRows.length > this.processMatches.length) {
      const row = this.processRows.pop();
      if (!row) continue;
      this.processRowsPanel.remove(row.panel);
      row.panel.destroy();
    }
  }

  private startProcessSpinner(pid: number, operation: TextRenderable): void {
    this.stopProcessSpinner();
    this.processSpinnerFrame = 0;
    operation.content = `${processSpinnerFrames[0]} stopping PID ${pid}`;
    this.processSpinnerTimer = setInterval(() => {
      this.processSpinnerFrame = (this.processSpinnerFrame + 1) % processSpinnerFrames.length;
      operation.content = `${processSpinnerFrames[this.processSpinnerFrame]} stopping PID ${pid}`;
    }, 100);
  }

  private stopProcessSpinner(): void {
    if (this.processSpinnerTimer) clearInterval(this.processSpinnerTimer);
    this.processSpinnerTimer = null;
    this.processSpinnerFrame = 0;
  }

  private outputFor(actionIndex: number): CommandOutputPanel {
    return this.outputs.get(actionIndex) ?? this.output;
  }

  private selectedOutput(): CommandOutputPanel {
    return this.outputFor(this.select.getSelectedIndex());
  }

  private showSelectedOutput(): void {
    const selectedIndex = this.select.getSelectedIndex();
    this.output.panel.visible = this.actions.length === 0;
    for (const [index, output] of this.outputs) {
      output.panel.visible = index === selectedIndex;
      if (index !== selectedIndex) output.blur();
    }
    if (this.outputFocused) this.selectedOutput().focus();
  }

  private updateProcessInfo(): void {
    const process = this.selectedProcess();
    this.processInfo.content = process
      ? [
        `PID ${process.pid} · ${process.source}`,
        `Command: ${process.command}`,
        `Directory: ${process.cwd ?? "unavailable"}`,
        `Parent: ${process.parentPid}${process.parentCommand ? ` · ${process.parentCommand}` : ""}`,
      ].join("\n")
      : "No matching processes found.";
  }

  private async refreshProcessHints(): Promise<void> {
    if (!this.currentWorktree) return;
    const counts = await Promise.all(this.actions.map(async (action, index) => {
      const command = expandWorktreeCommand(action.command, this.currentWorktree!.path, this.currentWorktree!.branch);
      const matches = await findActionProcesses(command, this.processes.get(index)?.pty.pid, this.currentWorktree!.path);
      return [index, matches.filter((match) => match.source !== "attached").length] as const;
    }));
    this.otherProcessCounts.clear();
    for (const [index, count] of counts) {
      if (count > 0) this.otherProcessCounts.set(index, count);
    }
    this.renderRows();
  }
}

function pathShellExit(shell: string): string {
  return shell.toLowerCase().endsWith("fish")
    ? "set code $status; exit $code"
    : "code=$?; exit $code";
}
