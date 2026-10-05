import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";
import type { BranchOption } from "../types.js";
import { keyHintsWithBlankLine } from "./keyHints.js";

type BranchSelectorOption = BranchOption | { kind: "merged-toggle" };

export class BranchSelector {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly hint: TextRenderable;
  readonly indicator: TextRenderable;
  private readonly renderer: CliRenderer;
  private itemCount = 0;
  private branches: BranchOption[] = [];
  private mergedBranches: BranchOption[] = [];
  private mergedExpanded = false;
  private readonly handleResize = (): void => {
    this.updateLayout();
  };

  constructor(
    renderer: CliRenderer,
    private readonly onSelect: (branch: BranchOption) => void,
  ) {
    this.renderer = renderer;
    renderer.on("resize", this.handleResize);
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: 0,
      left: "20%",
      width: "60%",
      height: 10,
      border: true,
      borderStyle: "rounded",
      backgroundColor: "#111a33",
      title: "base branch",
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
      selectedBackgroundColor: "#18264a",
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
      const option = this.select.options[index]?.value as BranchSelectorOption | undefined;
      if (!option) return;
      if ("kind" in option) {
        const selectedIndex = this.select.getSelectedIndex();
        this.mergedExpanded = !this.mergedExpanded;
        this.setOptions();
        this.select.setSelectedIndex(Math.min(selectedIndex, this.select.options.length - 1));
        this.updateIndicator();
        this.updateLayout();
        return;
      }
      this.onSelect(option);
    });
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, () => this.updateIndicator());
  }

  open(branches: BranchOption[], theme: Theme): void {
    this.branches = branches;
    this.mergedBranches = branches.filter((branch) => branch.merged);
    this.mergedExpanded = false;
    this.setOptions();
    const mainIndex = this.select.options.findIndex((option) => {
      const branch = option.value as BranchSelectorOption;
      return !("kind" in branch) && branch.name === "main" && !branch.remote;
    });
    this.select.setSelectedIndex(mainIndex >= 0 ? mainIndex : 0);
    this.updateIndicator();
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
    this.select.descriptionColor = theme.muted;
    this.select.selectedDescriptionColor = theme.text;
    this.hint.fg = theme.muted;
    this.hint.content = keyHintsWithBlankLine(theme, [["j/k", "choose"], ["Enter", "select"], ["Esc", "cancel"]]);
    this.indicator.fg = theme.accent;
  }

  private updateIndicator(): void {
    this.indicator.top = 1 + this.select.getSelectedIndex() * 3;
  }

  private setOptions(): void {
    const visibleBranches = this.branches.filter((branch) => !branch.merged);
    const options: BranchSelectorOption[] = [...visibleBranches];
    if (this.mergedBranches.length > 0) {
      options.push({ kind: "merged-toggle" });
      if (this.mergedExpanded) options.push(...this.mergedBranches);
    }
    this.itemCount = options.length;
    this.updateLayout();
    this.select.options = options.map((option) => {
      if ("kind" in option) {
        return {
          name: `  Merged (${this.mergedBranches.length})${this.mergedExpanded ? " ▲" : " ▼"}`,
          description: this.mergedExpanded ? "  collapse merged branches" : "  expand merged branches",
          value: option,
        };
      }
      return {
        name: `  ${option.remote ? `remote  ${option.name}` : `local   ${option.name}`}`,
        description: `  ${option.ref}`,
        value: option,
      };
    });
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
    this.panel.left = "20%";
    this.panel.width = "60%";
    const contentHeight = this.itemCount * 3 + 6;
    const panelHeight = Math.min(contentHeight, Math.max(8, Math.floor(this.renderer.height * 0.9)));
    this.panel.height = panelHeight;
    this.panel.top = Math.max(0, Math.floor((this.renderer.height - panelHeight) / 2));
    this.panel.translateY = 0;
  }
}
