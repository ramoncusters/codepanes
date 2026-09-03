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

type ActionProcess = {
  actionIndex: number;
  action: ProjectAction;
  worktree: Worktree;
  pty: IPty;
};

export class ActionsPanel {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly output: CommandOutputPanel;
  private actions: ProjectAction[];
  private currentWorktree: Worktree | undefined;
  private readonly processes = new Map<number, ActionProcess>();
  private readonly outputs = new Map<number, CommandOutputPanel>();
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
    const listPanel = new BoxRenderable(renderer, {
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
    this.output = new CommandOutputPanel(renderer, backgroundColor);
    this.output.panel.visible = this.actions.length === 0;
    listPanel.add(this.select);
    this.panel.add(listPanel);
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
    });
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
    this.updateOptions();
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
    let actionPty: IPty;
    try {
      actionPty = spawnPty(this.shell, ["-i"], {
        cwd: worktree.path,
        cols: Math.max(20, this.output.terminal.width),
        rows: Math.max(8, this.output.terminal.height),
        name: "xterm-256color",
        env: { SHELL: this.shell, TERM: "xterm-256color" },
      });
    } catch (error) {
      this.selectedOutput().writeMessage(`[failed] ${action.name}: ${String(error)}`, this.theme.error ?? this.theme.accent);
      return;
    }
    const process: ActionProcess = { actionIndex, action, worktree, pty: actionPty };
    this.processes.set(actionIndex, process);
    this.updateOptions();
    this.outputFor(actionIndex).writeMessage(
      `[started] ${action.name} (${worktree.branch})${action.persistent ? " [persistent]" : ""}`,
      this.theme.success ?? this.theme.accent,
    );
    actionPty.onData((data) => this.outputFor(actionIndex).write(data));
    actionPty.onExit(({ exitCode, signal }) => {
      if (this.processes.get(actionIndex)?.pty !== actionPty) return;
      this.processes.delete(actionIndex);
      this.updateOptions();
      const result = signal ? `terminated by ${signal}` : `exited with code ${exitCode}`;
      const succeeded = !signal && exitCode === 0;
      this.outputFor(actionIndex).writeMessage(`[${succeeded ? "completed" : "failed"}] ${action.name}: ${result}`, succeeded
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
    process.pty.kill();
  }

  stopAll(): void {
    for (const process of this.processes.values()) process.pty.kill();
  }

  dispose(): void {
    this.stopAll();
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
    }
  }
}

function pathShellExit(shell: string): string {
  return shell.toLowerCase().endsWith("fish")
    ? "set code $status; exit $code"
    : "code=$?; exit $code";
}
