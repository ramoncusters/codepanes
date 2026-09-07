import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";
import type { DetachedRef } from "../types.js";
import { keyHintsWithBlankLine } from "./keyHints.js";

export class DetachedRefSelector {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly hint: TextRenderable;
  readonly indicator: TextRenderable;
  private readonly renderer: CliRenderer;
  private itemCount = 0;
  private readonly handleResize = (): void => {
    this.updateLayout();
  };

  constructor(
    renderer: CliRenderer,
    private readonly onSelect: (ref: DetachedRef) => void,
  ) {
    this.renderer = renderer;
    renderer.on("resize", this.handleResize);
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: 0,
      left: "5%",
      width: "90%",
      height: 10,
      border: true,
      borderStyle: "rounded",
      title: "detached reference",
      padding: 1,
      visible: false,
      zIndex: 36,
      flexDirection: "column",
    });
    this.select = new SelectRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      options: [],
      showDescription: true,
      showSelectionIndicator: false,
      itemSpacing: 1,
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
    this.panel.add(this.select);
    this.panel.add(this.indicator);
    this.panel.add(this.hint);
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const ref = this.select.options[index]?.value as DetachedRef | undefined;
      if (ref) this.onSelect(ref);
    });
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, () => this.updateIndicator());
  }

  open(refs: DetachedRef[], branchName: string, theme: Theme): void {
    this.itemCount = refs.length;
    this.updateLayout();
    this.panel.title = `detached reference: ${branchName}`;
    this.select.options = refs.map((ref) => ({
      name: `  ${ref.kind}  ${ref.name}`,
      description: `  ${ref.description ?? ref.ref}`,
      value: ref,
    }));
    this.applyTheme(theme);
    this.panel.visible = true;
    this.select.focus();
    this.updateIndicator();
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
    this.select.descriptionColor = theme.muted;
    this.select.selectedDescriptionColor = theme.text;
    this.hint.fg = theme.muted;
    this.hint.content = keyHintsWithBlankLine(theme, [["j/k", "choose"], ["Enter", "select"], ["Esc", "cancel"]]);
    this.indicator.fg = theme.accent;
  }

  private updateIndicator(): void {
    this.indicator.top = 1 + this.select.getSelectedIndex() * 3;
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
    this.panel.left = "5%";
    this.panel.width = "90%";
    const contentHeight = this.itemCount * 3 + 6;
    const panelHeight = Math.min(contentHeight, Math.max(8, Math.floor(this.renderer.height * 0.9)));
    this.panel.height = panelHeight;
    this.panel.top = Math.max(0, Math.floor((this.renderer.height - panelHeight) / 2));
    this.panel.translateY = 0;
  }
}
