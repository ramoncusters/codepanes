import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  type CliRenderer,
  type TerminalColors,
} from "@opentui/core";
import type { IPty } from "node-pty";
import { applyEmbeddedTerminalPalette } from "../services/terminalPalette.js";
import { spawnPty } from "../services/pty.js";
import type { Worktree } from "../types.js";
import type { Theme } from "../services/themes.js";

export class TerminalPanel {
  readonly panel: BoxRenderable;
  readonly terminal: EmbeddedTerminalRenderable;
  private currentPty: IPty | null = null;
  private terminalFocused = false;

  constructor(
    private readonly renderer: CliRenderer,
    private readonly onFocusChange: (focused: boolean) => void,
    private readonly shell: string,
  ) {
    this.panel = new BoxRenderable(renderer, {
      paddingTop: 1,
      flexGrow: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
    });
    this.terminal = new EmbeddedTerminalRenderable(renderer, {
      width: "100%",
      height: "100%",
      selectable: true,
      onTerminalResize: (cols, rows) => {
        if (this.currentPty) this.currentPty.resize(Math.max(20, cols), Math.max(8, rows));
      },
      onData: (data, source) => {
        if (source === "input" && this.currentPty) {
          this.currentPty.write(Buffer.from(data).toString());
        }
      },
    });
    this.panel.add(this.terminal);
  }

  applyPalette(palette: TerminalColors): void {
    applyEmbeddedTerminalPalette(this.terminal, palette);
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.border;
  }

  stop(): void {
    if (this.currentPty) {
      this.currentPty.kill();
      this.currentPty = null;
    }
  }

  async open(worktree: Worktree): Promise<void> {
    this.stop();
    this.terminal.write("\x1b[2J\x1b[3J\x1b[H");
    await this.renderer.idle();
    if (this.renderer.isDestroyed) return;

    try {
      this.currentPty = spawnPty("lazygit", [], {
        cols: Math.max(20, this.terminal.width),
        rows: Math.max(8, this.terminal.height),
        cwd: worktree.path,
        env: { TERM: "xterm-256color", COLORTERM: "", SHELL: this.shell },
      });
      this.currentPty.onData((data) => {
        this.terminal.write(data);
      });
      this.currentPty.onExit(({ exitCode }) => {
        this.currentPty = null;
        this.terminalFocused = false;
        this.onFocusChange(false);
        this.terminal.write(`\n[lazygit exited with code ${exitCode}]`);
      });
      this.terminalFocused = true;
      this.onFocusChange(true);
      await this.renderer.idle();
      this.terminal.focus();
      await new Promise((resolve) => setTimeout(resolve, 25));
      this.terminal.focus();
    } catch (error) {
      this.terminalFocused = false;
      this.onFocusChange(false);
      this.terminal.write(`\nUnable to start lazygit: ${String(error)}`);
    }
  }
}
