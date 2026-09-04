import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";
import type { BranchOption } from "../types.js";

export class BranchSelector {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly hint: TextRenderable;

  constructor(
    renderer: CliRenderer,
    private readonly onSelect: (branch: BranchOption) => void,
  ) {
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "15%",
      left: "20%",
      width: "60%",
      height: "70%",
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
      wrapSelection: true,
      selectedBackgroundColor: "#18264a",
    });
    this.hint = new TextRenderable(renderer, { content: "j/k choose   Enter select   Esc cancel", fg: "#aab7d8" });
    this.panel.add(this.select);
    this.panel.add(this.hint);
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const option = this.select.options[index]?.value as BranchOption | undefined;
      if (option) this.onSelect(option);
    });
  }

  open(branches: BranchOption[], theme: Theme): void {
    this.select.options = branches.map((branch) => ({
      name: branch.remote ? `remote  ${branch.name}` : `local   ${branch.name}`,
      description: branch.ref,
      value: branch,
    }));
    const mainIndex = branches.findIndex((branch) => branch.name === "main" && !branch.remote);
    this.select.setSelectedIndex(mainIndex >= 0 ? mainIndex : 0);
    this.applyTheme(theme);
    this.panel.visible = true;
    this.select.focus();
  }

  close(): void {
    this.panel.visible = false;
    this.select.blur();
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.panelBackground;
    this.panel.borderColor = theme.accent;
    this.panel.titleColor = theme.accent;
    this.select.backgroundColor = theme.panelBackground;
    this.select.focusedBackgroundColor = theme.focusedBackground;
    this.select.selectedTextColor = theme.text;
    this.hint.fg = theme.muted;
  }
}
