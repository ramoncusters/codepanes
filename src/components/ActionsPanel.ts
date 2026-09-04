import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import type { IPty } from "node-pty";
import { expandWorktreeCommand } from "../services/commands.js";
import { spawnPty } from "../services/pty.js";
import type { ProjectAction, Worktree } from "../types.js";
import type { Theme } from "../services/themes.js";
import { CommandOutputPanel } from "./CommandOutputPanel.js";
import { ActionRow, type ActionRowStatus } from "./ActionRow.js";

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
  private readonly rowsPanel: BoxRenderable;
  private readonly statuses = new Map<number, ActionRowStatus>();
  private readonly stopping = new Set<number>();
  private outputFocused = false;
  private pulse = false;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private readonly handleResize = (width: number): void => {
    const stacked = width < 100;
    this.panel.flexDirection = stacked ? "column" : "row";
    this.listPanel.flexShrink = stacked ? 0 : 1;
    this.listPanel.minHeight = stacked ? Math.max(6, this.actions.length * 3 + 2) : null;
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
    this.rowsPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
      gap: 1,
    });
    this.listPanel.add(this.rowsPanel);
    this.select.visible = false;
    this.output = new CommandOutputPanel(renderer, backgroundColor);
    this.output.panel.visible = this.actions.length === 0;
    this.listPanel.add(this.select);
    this.panel.add(this.listPanel);
    this.panel.add(this.output.panel);
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
    renderer.on("resize", this.handleResize);
    this.handleResize(renderer.width);
    this.updateOptions();
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
  }

  focusActions(): void {
    this.outputFocused = false;
    this.selectedOutput().blur();
    this.select.focus();
  }

  focusOutput(): void {
    this.outputFocused = true;
    this.select.blur();
    this.selectedOutput().focus();
  }

  isOutputFocused(): boolean {
    return this.outputFocused;
  }

  scrollOutput(lines: number): void {
    this.selectedOutput().scrollBy(lines);
  }

  applyPalette(palette: TerminalColors): void {
    this.output.applyPalette(palette);
    for (const output of this.outputs.values()) output.applyPalette(palette);
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.border;
    this.output.applyTheme(theme);
    for (const output of this.outputs.values()) output.applyTheme(theme);
    this.updateOptions();
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
      actionPty = spawnPty(this.shell, ["-i"], {
        cwd: worktree.path,
        cols: Math.max(20, output.terminal.width),
        rows: Math.max(8, output.terminal.height),
        name: "xterm-256color",
        env: { SHELL: this.shell, TERM: "xterm-256color" },
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
    for (const row of this.rows) {
      this.rowsPanel.remove(row.panel);
      row.panel.destroy();
    }
    this.rows.length = 0;
    for (const [index, action] of this.actions.entries()) {
      const row = new ActionRow(
        this.renderer,
        action.name,
        action.command,
        this.statuses.get(index) ?? "idle",
        index === this.select.getSelectedIndex(),
        this.pulse,
        this.theme,
      );
      this.rows.push(row);
      this.rowsPanel.add(row.panel);
    }
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
}

function pathShellExit(shell: string): string {
  return shell.toLowerCase().endsWith("fish")
    ? "set code $status; exit $code"
    : "code=$?; exit $code";
}
