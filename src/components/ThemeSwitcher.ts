import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";

export class ThemeSwitcher {
  readonly panel: BoxRenderable;
  readonly select: SelectRenderable;
  readonly hint: TextRenderable;

  constructor(
    renderer: CliRenderer,
    availableThemes: Theme[],
    onPreview: (theme: Theme) => void,
    onSelect: (theme: Theme) => void,
  ) {
    this.panel = new BoxRenderable(renderer, {
      position: "absolute",
      top: "20%",
      left: "30%",
      width: "40%",
      height: 14,
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
      options: availableThemes.map((theme) => ({
        name: theme.name,
        description: theme.id,
        value: theme,
      })),
      showDescription: true,
      selectedTextColor: "#ffffff",
      backgroundColor: "#111a33",
      focusedBackgroundColor: "#18264a",
    });
    this.hint = new TextRenderable(renderer, {
      content: "↑/↓ preview   Enter apply   Esc close",
      fg: "#aab7d8",
    });
    this.panel.add(this.select);
    this.panel.add(this.hint);
    this.select.on(SelectRenderableEvents.SELECTION_CHANGED, (index) => {
      const theme = availableThemes[index];
      if (theme) onPreview(theme);
    });
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const theme = availableThemes[index];
      if (theme) onSelect(theme);
    });
  }

  applyTheme(theme: Theme): void {
    this.panel.backgroundColor = theme.panelBackground;
    this.panel.borderColor = theme.border;
    this.panel.titleColor = theme.accent;
    this.select.backgroundColor = theme.panelBackground;
    this.select.focusedBackgroundColor = theme.focusedBackground;
    this.select.selectedTextColor = theme.text;
    this.hint.fg = theme.muted;
  }
}
