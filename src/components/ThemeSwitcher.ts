import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";
import { keyHints } from "./keyHints.js";

export class ThemeSwitcher {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly hint: TextRenderable;
  readonly hintSpacer: TextRenderable;

  constructor(
    renderer: CliRenderer,
    availableThemes: Theme[],
    onPreview: (theme: Theme) => void,
    onSelect: (theme: Theme) => void,
  ) {
    const sortedThemes = [...availableThemes].sort((left, right) => {
      const modeOrder = left.mode === right.mode ? 0 : left.mode === "light" ? -1 : 1;
      return modeOrder || left.name.localeCompare(right.name);
    });
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "20%",
      left: "30%",
      width: "40%",
      height: 15,
      border: true,
      borderStyle: "rounded",
      borderColor: "#2b3c68",
      title: "themes",
      titleColor: "#7dd3fc",
      backgroundColor: "#111a33",
      padding: 1,
      visible: false,
      zIndex: 25,
      flexDirection: "column",
    });
    this.select = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      options: sortedThemes.map((theme) => ({
        name: `${theme.name.padEnd(24)} | ${theme.mode}`,
        description: "",
        value: theme,
      })),
      showDescription: false,
      selectedTextColor: "#ffffff",
      backgroundColor: "#111a33",
      focusedBackgroundColor: "#18264a",
    });
    this.hint = new TextRenderable(renderer, {
      content: keyHints({
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
      }, [["j/k", "preview"], ["Enter", "apply"], ["Esc", "close"]]),
      fg: "#aab7d8",
    });
    this.hintSpacer = new TextRenderable(renderer, { content: " ", height: 1 });
    this.panel.add(this.select);
    this.panel.add(this.hintSpacer);
    this.panel.add(this.hint);
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, (index) => {
      const theme = sortedThemes[index];
      if (theme) onPreview(theme);
    });
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const theme = sortedThemes[index];
      if (theme) onSelect(theme);
    });
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.panelBackground;
    this.panel.borderColor = theme.border;
    this.panel.titleColor = theme.accent;
    this.select.backgroundColor = theme.panelBackground;
    this.select.focusedBackgroundColor = theme.focusedBackground;
    this.select.selectedBackgroundColor = theme.focusedBackground;
    this.select.textColor = theme.text;
    this.select.focusedTextColor = theme.text;
    this.select.selectedTextColor = theme.text;
    this.select.descriptionColor = theme.muted;
    this.select.selectedDescriptionColor = theme.text;
    this.hint.fg = theme.muted;
    this.hint.content = keyHints(theme, [["j/k", "preview"], ["Enter", "apply"], ["Esc", "close"]]);
  }
}
