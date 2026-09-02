import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { IPty } from "node-pty";
import { spawnPty } from "../services/pty.js";
import type { Theme } from "../services/themes.js";

export class ConfigEditor {
  readonly panel: BoxRenderable;
  readonly instructionsPanel: BoxRenderable;
  readonly instructionsText: TextRenderable;
  readonly editor: EmbeddedTerminalRenderable;
  private configPty: IPty | null = null;

  constructor(
    private readonly renderer: CliRenderer,
    private readonly configPath: string,
    private readonly repositoryRoot: string,
    private readonly onExit: () => void,
    private readonly shell: string,
    backgroundColor: string,
  ) {
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "10%",
      left: "10%",
      width: "80%",
      height: "80%",
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: "#8be9fd",
      backgroundColor,
      padding: 1,
      visible: false,
      zIndex: 30,
    });
    this.instructionsPanel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "5%",
      left: "5%",
      width: "90%",
      height: "90%",
      border: true,
      borderStyle: "rounded",
      borderColor: "#8be9fd",
      backgroundColor: "#111a33",
      padding: 1,
      visible: false,
      zIndex: 40,
    });
    this.instructionsText = new TextRenderable(renderer, {
      content: [
        "Configuration file",
        "",
        "The file is JSON and is stored at ~/.config/codepanes/config.json.",
        "Keybindings use: { \"key\": { \"name\": \"Label\", \"action\": \"action-id\" } }",
        "",
        "globalKeybindings",
        "  Global bindings are available on every tab.",
        "  Worktrees and Lazygit contain bindings specific to that tab.",
        "",
        "projects",
        "  Project settings are keyed by the repository root directory name.",
        "  Project keybindings use the same Global/Worktrees/Lazygit structure.",
        "  shell selects the executable used for postCreateActions (default: sh).",
        "  postCreateActions is a project-only list of shell commands run in a new worktree.",
        "  run-command bindings support target, {{worktreeDir}}, and {{worktreeName}} substitution.",
        "",
        "Available actions",
        "  select-worktrees, search-worktrees, create-worktree, delete-worktrees, clear-operations",
        "  edit-config, switch-theme",
        "",
        "Example:",
        "  \"Worktrees\": {",
        "    \"spacebar\": { \"name\": \"Select worktrees\", \"action\": \"select-worktrees\" }",
        "  }",
        "",
        "Press ? or Esc to close these instructions.",
      ].join("\n"),
      fg: "#d7e3ff",
    });
    this.instructionsPanel.add(this.instructionsText);
    this.editor = new EmbeddedTerminalRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      height: "100%",
      selectable: true,
      onData: (data, source) => {
        if (source === "input" && this.configPty) this.configPty.write(Buffer.from(data).toString());
      },
      onTerminalResize: (cols, rows) => {
        if (this.configPty) this.configPty.resize(Math.max(20, cols), Math.max(8, rows));
      },
    });
    this.panel.add(this.instructionsPanel);
    this.panel.add(this.editor);
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.accent;
    this.instructionsPanel.backgroundColor = theme.panelBackground;
    this.instructionsPanel.borderColor = theme.accent;
    this.instructionsText.fg = theme.text;
  }

  async open(): Promise<void> {
    this.editor.write("\x1b[2J\x1b[3J\x1b[H");
    await this.renderer.idle();
    if (this.renderer.isDestroyed) return;
    this.configPty = spawnPty("vim", [this.configPath], {
      cols: Math.max(20, this.editor.width),
      rows: Math.max(8, this.editor.height),
      cwd: this.repositoryRoot,
      env: { TERM: "vt100", COLORTERM: "", SHELL: this.shell },
    });
    this.configPty.onData((data) => this.editor.write(data));
    this.configPty.onExit(() => {
      this.configPty = null;
      this.onExit();
    });
  }

  close(): void {
    if (this.configPty) {
      this.configPty.kill();
      this.configPty = null;
    }
    this.instructionsPanel.visible = false;
    this.panel.visible = false;
  }

  toggleInstructions(visible: boolean): void {
    this.instructionsPanel.visible = visible;
    if (visible) this.editor.blur();
    else this.editor.focus();
  }
}
