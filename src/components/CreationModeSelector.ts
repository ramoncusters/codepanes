import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";
import type { WorktreeCreationMode } from "../types.js";
import { keyHintsWithBlankLine } from "./keyHints.js";

export class CreationModeSelector {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly hint: TextRenderable;
  readonly indicator: TextRenderable;
  private readonly renderer: CliRenderer;
  private readonly handleResize = (): void => {
    this.updateLayout();
  };

  constructor(
    renderer: CliRenderer,
    private readonly onSelect: (mode: WorktreeCreationMode) => void,
  ) {
    this.renderer = renderer;
    renderer.on("resize", this.handleResize);
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: 0,
      left: "25%",
      width: "50%",
      height: 10,
      border: true,
      borderStyle: "rounded",
      title: "create worktree",
      padding: 1,
      visible: false,
      zIndex: 34,
      flexDirection: "column",
    });
    this.select = new SelectRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      options: [
        {
          name: "  New branch from existing branch",
          description: "",
          value: "new-branch" as WorktreeCreationMode,
        },
        { name: "  Existing local branch", description: "", value: "existing-local" as WorktreeCreationMode },
        { name: "  Existing remote branch", description: "", value: "existing-remote" as WorktreeCreationMode },
        { name: "  Detached from commit", description: "", value: "detached-commit" as WorktreeCreationMode },
        { name: "  Detached from tag", description: "", value: "detached-tag" as WorktreeCreationMode },
      ],
      showDescription: false,
      showSelectionIndicator: false,
      itemSpacing: 0,
      wrapSelection: true,
    });
    this.indicator = new TextRenderable(renderer, {
      position: "absolute",
      left: 2,
      top: 1,
      content: "› ",
      fg: "#7dd3fc",
      zIndex: 1,
    });
    this.panel.add(this.select);
    this.panel.add(this.indicator);
    this.hint = new TextRenderable(renderer, {
      content: keyHintsWithBlankLine({
        id: "initial",
        name: "Initial",
        mode: "dark",
        background: "#111a33",
        panelBackground: "#111a33",
        inputBackground: "#111a33",
        focusedBackground: "#18264a",
        border: "#2b3c68",
        accent: "#7dd3fc",
        text: "#ffffff",
        muted: "#aab7d8",
      }, [["j/k", "choose"], ["Enter", "select"], ["Esc", "cancel"]]),
      fg: "#aab7d8",
    });
    this.panel.add(this.hint);
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const mode = this.select.options[index]?.value as WorktreeCreationMode | undefined;
      if (mode) this.onSelect(mode);
    });
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, () => this.updateIndicator());
  }

  open(theme: Theme): void {
    this.updateLayout();
    this.applyTheme(theme);
    this.panel.visible = true;
    this.select.focus();
  }

  close(): void {
    this.panel.visible = false;
    this.select.blur();
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.background;
    this.panel.borderColor = theme.accent;
    this.panel.titleColor = theme.accent;
    this.select.backgroundColor = theme.background;
    this.select.focusedBackgroundColor = theme.background;
    this.select.selectedBackgroundColor = theme.focusedBackground;
    this.select.textColor = theme.text;
    this.select.focusedTextColor = theme.text;
    this.select.selectedTextColor = theme.text;
    this.hint.fg = theme.muted;
    this.hint.content = keyHintsWithBlankLine(theme, [["j/k", "choose"], ["Enter", "select"], ["Esc", "cancel"]]);
    this.indicator.fg = theme.accent;
    this.updateIndicator();
  }

  private updateIndicator(): void {
    this.indicator.top = 1 + this.select.getSelectedIndex();
  }

  private updateLayout(): void {
    if (this.renderer.width < 100) {
      this.panel.left = 0;
      this.panel.top = 0;
      this.panel.width = "100%";
      this.panel.height = this.renderer.height;
      this.panel.translateY = 0;
      return;
    }
    this.panel.left = "25%";
    this.panel.width = "50%";
    const contentHeight = this.select.options.length + 6;
    const panelHeight = Math.min(contentHeight, Math.max(8, Math.floor(this.renderer.height * 0.8)));
    this.panel.height = panelHeight;
    this.panel.top = Math.max(0, Math.floor((this.renderer.height - panelHeight) / 2));
    this.panel.translateY = 0;
  }
}
