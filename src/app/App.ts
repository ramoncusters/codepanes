import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
  type TerminalColors,
} from "@opentui/core";
import { configPath, loadConfig, projectName, saveConfig } from "../services/config.js";
import { bareRoot, getWorktrees, gitRoot } from "../services/git.js";
import { spawnPty } from "../services/pty.js";
import { applyEmbeddedTerminalPalette } from "../services/terminalPalette.js";
import { TerminalPanel } from "../components/TerminalPanel.js";
import { WorktreesPanel } from "../components/WorktreesPanel.js";
import { Prompt } from "../components/Prompt.js";
import { KeybindingsHelp } from "../components/KeybindingsHelp.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { createTabs } from "../components/Tabs.js";
import { Footer } from "../components/Footer.js";
import { ThemeSwitcher } from "../components/ThemeSwitcher.js";
import { runInteractiveCommand } from "../services/commands.js";
import { getTheme, loadThemes, type Theme } from "../services/themes.js";
import type { Action, TabName, Worktree } from "../types.js";
import type { IPty } from "node-pty";
import { createKeybindingResolver, ensureDefaultKeybindings } from "./keybindings.js";
import { createAppState } from "./state.js";

const execFileAsync = promisify(execFile);

type KeyInputEvents = {
  addListener(event: "keypress", handler: (key: KeyEvent) => void): void;
  removeListener(event: "keypress", handler: (key: KeyEvent) => void): void;
};

export async function runApp(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig();
  const availableThemes = await loadThemes();
  if (!config.globalKeybindings?.Global) {
    ensureDefaultKeybindings(config);
    await saveConfig(config);
  }
  const repositoryRoot = await gitRoot(cwd);
  const projectRoot = await bareRoot(cwd);
  const currentProjectName = projectName(projectRoot);
  const projectConfig = config.projects?.[currentProjectName] ?? {};
  const commandShell = projectConfig.shell ?? config.shell ?? "sh";
  const getKeybindings = createKeybindingResolver(config, currentProjectName);
  let worktrees = await getWorktrees(cwd);
  const fallbackTerminalBackground = "#0b1020";
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: fallbackTerminalBackground,
    useMouse: true,
    clearOnShutdown: true,
    consoleMode: "disabled",
    openConsoleOnError: false,
  });
  const terminalPalette = await renderer.getPalette();
  const terminalBackground = terminalPalette.defaultBackground ?? fallbackTerminalBackground;
  let appliedTheme = getTheme(availableThemes, config.theme);
  let committedTheme = appliedTheme;

  const root = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: terminalBackground,
    // border: true,
    // borderStyle: "rounded",
    // borderColor: "#2b3c68",
  });
  // const header = new BoxRenderable(renderer, {
  //   height: 3,
  //   padding: 1,
  //   backgroundColor: "#111a33",
  //   border: true,
  //   borderColor: "#2b3c68",
  // });
  // header.add(new TextRenderable(renderer, {
  //   content: " CODEPANES  |  worktrees + lazygit",
  //   fg: "#8be9fd",
  // }));

  const tabs = createTabs(renderer);

  const body = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
  });
  const footer = new Footer(renderer);
  const footerPanel = footer.panel;
  const footerText = footer.text;
  const configEditor = new ConfigEditor(
    renderer,
    configPath,
    repositoryRoot,
    () => {
      if (state.configEditorActive) closeConfigEditor();
    },
    commandShell,
    terminalBackground,
  );
  const configEditorPanel = configEditor.panel;
  const configInstructionsPanel = configEditor.instructionsPanel;
  const configEditorRenderable = configEditor.editor;
  root.add(configEditorPanel);

  const worktreesPanel = new WorktreesPanel(renderer, worktrees, terminalBackground);
  const worktreePanel = worktreesPanel.panel;
  const select = worktreesPanel.select;
  const searchBar = worktreesPanel.searchBar;
  const searchInput = worktreesPanel.searchInput;
  const selectedWorktrees = worktreesPanel.selectedWorktrees;
  const state = createAppState();
  const prompt = new Prompt(renderer);
  const promptPanel = prompt.panel;
  const promptLabel = prompt.label;
  const promptInput = prompt.input;
  const keybindingsHelp = new KeybindingsHelp(renderer);
  const keybindingsPanel = keybindingsHelp.panel;
  const keybindingsText = keybindingsHelp.text;
  root.add(promptPanel);
  root.add(keybindingsPanel);
  const themeSwitcher = new ThemeSwitcher(renderer, availableThemes, (theme) => {
    appliedTheme = theme;
    renderTheme(theme);
  }, (theme) => beginThemeConfirmation(theme));
  root.add(themeSwitcher.panel);

  const refreshWorktrees = async (): Promise<void> => {
    await worktreesPanel.refresh();
    worktrees = worktreesPanel.items;
  };

  const closePrompt = (): void => {
    state.promptActive = false;
    state.promptMode = null;
    promptPanel.visible = false;
    promptInput.blur();
    select.focus();
  };

  const closeThemeSwitcher = (restore = true): void => {
    if (restore) {
      appliedTheme = committedTheme;
      renderTheme(committedTheme);
    }
    state.pendingTheme = null;
    themeSwitcher.panel.visible = false;
    themeSwitcher.select.blur();
    if (state.activeTab === 0) select.focus();
    else terminal.focus();
  };

  function renderTheme(theme: Theme): void {
    root.backgroundColor = theme.background;
    worktreesPanel.applyTheme(theme);
    lazygitTerminal.applyTheme(theme);
    configEditor.applyTheme(theme);
    footer.applyTheme(theme);
    prompt.applyTheme(theme);
    keybindingsHelp.applyTheme(theme);
    themeSwitcher.applyTheme(theme);
    tabs.selectedTextColor = theme.text;
    tabs.focusedTextColor = theme.text;
  }

  const closeKeybindings = (): void => {
    state.keybindingsActive = false;
    keybindingsPanel.visible = false;
    if (state.activeTab === 0) select.focus();
    else terminal.focus();
  };

  const closeConfigEditor = (): void => {
    configEditor.close();
    state.configEditorActive = false;
    state.configInstructionsActive = false;
    configInstructionsPanel.visible = false;
    configEditorPanel.visible = false;
    if (state.activeTab === 0) select.focus();
    else terminal.focus();
  };

  const openConfigEditor = async (): Promise<void> => {
    if (state.configEditorActive) return;
    state.configEditorActive = true;
    state.configInstructionsActive = false;
    configInstructionsPanel.visible = false;
    keybindingsPanel.visible = false;
    state.keybindingsActive = false;
    configEditorPanel.visible = true;
    select.blur();
    terminal.blur();
    configEditorRenderable.focus();
    await configEditor.open();
  };

  const showKeybindings = (tabName: TabName): void => {
    const bindings = { ...getKeybindings("Global"), ...getKeybindings(tabName) };
    const lines = Object.entries(bindings).map(([key, binding]) => {
      const displayKey = key === "spacebar" ? "Space" : key;
      return `${displayKey.padEnd(10)} ${binding.name}`;
    });
    keybindingsText.content = `${tabName} keybindings\n\n${lines.length > 0 ? lines.join("\n") : "No configured keybindings"}\n\nPress ? or Esc to close`;
    state.keybindingsActive = true;
    keybindingsPanel.visible = true;
    select.blur();
    terminal.blur();
  };

  const toggleConfigInstructions = (): void => {
    state.configInstructionsActive = !state.configInstructionsActive;
    configInstructionsPanel.visible = state.configInstructionsActive;
    configEditor.toggleInstructions(state.configInstructionsActive);
  };

  const openPrompt = (mode: "create" | "delete" | "delete-branches", label: string): void => {
    state.promptMode = mode;
    state.promptActive = true;
    promptLabel.content = label;
    promptInput.value = "";
    promptPanel.visible = true;
    select.blur();
    promptInput.focus();
  };

  const openThemeSwitcher = (): void => {
    if (state.configEditorActive || state.keybindingsActive || state.promptActive) return;
    themeSwitcher.panel.visible = true;
    themeSwitcher.select.setSelectedIndex(
      Math.max(0, availableThemes.findIndex((theme) => theme.id === committedTheme.id)),
    );
    themeSwitcher.select.focus();
    select.blur();
    terminal.blur();
  };

  function beginThemeConfirmation(theme: Theme): void {
    appliedTheme = theme;
    state.pendingTheme = theme;
    state.promptMode = "apply-theme";
    state.promptActive = true;
    promptLabel.content = `Apply the ${theme.name} theme? Type y or n:`;
    promptInput.value = "";
    promptPanel.visible = true;
    themeSwitcher.select.blur();
    promptInput.focus();
  }

  const focusTerminal = async (): Promise<void> => {
    if (renderer.isDestroyed || state.activeTab !== 1 || state.configEditorActive || state.keybindingsActive || state.promptActive || state.searchActive) {
      return;
    }
    await renderer.idle();
    terminal.focus();
    state.terminalFocused = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!renderer.isDestroyed && state.activeTab === 1 && !state.configEditorActive && !state.keybindingsActive && !state.promptActive && !state.searchActive) {
      terminal.focus();
      state.terminalFocused = true;
    }
  };

  const lazygitTerminal = new TerminalPanel(
    renderer,
    (focused) => {
      state.terminalFocused = focused;
    },
    commandShell,
  );
  const terminalPanel = lazygitTerminal.panel;
  const terminal = lazygitTerminal.terminal;
  applyEmbeddedTerminalPalette(configEditorRenderable, terminalPalette);
  lazygitTerminal.applyPalette(terminalPalette);
  worktreesPanel.applyPalette(terminalPalette);
  body.add(worktreePanel);
  body.add(terminalPanel);
  // root.add(header);
  root.add(tabs);
  root.add(body);
  root.add(footerPanel);
  renderer.root.add(root);
  renderTheme(appliedTheme);

  const syncTerminalBackground = (palette: TerminalColors): void => {
    root.backgroundColor = appliedTheme.background;
    applyEmbeddedTerminalPalette(configEditorRenderable, palette);
    lazygitTerminal.applyPalette(palette);
    worktreesPanel.applyPalette(palette);
  };
  renderer.on("palette", syncTerminalBackground);

  const stopPty = (): void => lazygitTerminal.stop();

  const runLoggedGitCommand = async (args: string[], cwd: string): Promise<void> => {
    const quote = (arg: string): string => `'${arg.replaceAll("'", "'\\''")}'`;
    const command = `git ${args.map(quote).join(" ")}`;
    try {
      await runInteractiveCommand(
        commandShell,
        command,
        {
          cwd,
          cols: Math.max(20, worktreesPanel.output.terminal.width),
          rows: Math.max(8, worktreesPanel.output.terminal.height),
        },
        (data) => worktreesPanel.output.write(data),
      );
      worktreesPanel.output.writeMessage(`[completed] ${command}`, appliedTheme.success ?? appliedTheme.accent);
    } catch (error) {
      worktreesPanel.output.writeMessage(
        `[failed] ${command}: ${String(error)}`,
        appliedTheme.error ?? appliedTheme.accent,
      );
      throw error;
    }
  };

  const runPostCreateActions = async (worktreePath: string): Promise<void> => {
    for (const action of projectConfig.postCreateActions ?? []) {
      try {
        await runInteractiveCommand(
          commandShell,
          action,
          {
            cwd: worktreePath,
            cols: Math.max(20, worktreesPanel.output.terminal.width),
            rows: Math.max(8, worktreesPanel.output.terminal.height),
          },
          (data) => worktreesPanel.output.write(data),
        );
        worktreesPanel.output.writeMessage(`[completed] ${action}`, appliedTheme.success ?? appliedTheme.accent);
      } catch (error) {
        worktreesPanel.output.writeMessage(`[failed] ${String(error)}`, appliedTheme.error ?? appliedTheme.accent);
        throw error;
      }
    }
  };

  const createWorktree = async (branchName: string): Promise<void> => {
    if (!/^[^/]+\/[^/]+$/.test(branchName) || branchName.includes("..")) {
      footerText.content = "Invalid name. Use <type>/<name>.";
      return;
    }
    const root = await bareRoot(cwd);
    const selectedPath = [...selectedWorktrees][0];
    const base = selectedPath ? worktrees.find((worktree) => worktree.path === selectedPath)?.branch : "main";
    const target = path.join(root, branchName);
    let branchExists = false;
    try {
      await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd: root });
      branchExists = true;
    } catch {
      branchExists = false;
    }
    const args = branchExists
      ? ["worktree", "add", target, branchName]
      : ["worktree", "add", "-b", branchName, target, base ?? "main"];
    await runLoggedGitCommand(args, root);
    await runPostCreateActions(target);
    await refreshWorktrees();
    footerText.content = `Created ${branchName}`;
  };

  const deleteWorktrees = async (targets: Worktree[], deleteBranches: boolean): Promise<void> => {
    const root = await bareRoot(cwd);
    for (let index = 0; index < targets.length; index += 1) {
      footerText.content = `Deleting ${index + 1}/${targets.length}: ${targets[index].branch}`;
      await runLoggedGitCommand(["worktree", "remove", "--force", targets[index].path], root);
      if (deleteBranches && targets[index].branch !== "(detached)") {
        await runLoggedGitCommand(["branch", "-D", targets[index].branch], root);
      }
      selectedWorktrees.delete(targets[index].path);
    }
    await refreshWorktrees();
    footerText.content = `Deleted ${targets.length} worktree${targets.length === 1 ? "" : "s"}`;
  };

  const updateTab = (index: number): void => {
    state.activeTab = index;
    worktreePanel.visible = index === 0;
    terminalPanel.visible = index === 1;

    if (index === 0) {
      state.terminalFocused = false;
      terminal.blur();
      if (!state.keybindingsActive) select.focus();
      footerText.content = "↑/↓ move   Space select   / filter   n new   d delete   C config   Enter open   Tab switch tabs   ? Keybindings   Q quit";
    } else {
      state.terminalFocused = true;
      select.blur();
      if (!state.keybindingsActive && !state.configEditorActive) {
        void focusTerminal();
      }
      footerText.content = "Lazygit focused   C config   Tab switch tabs   Q quit";
    }
  };

  const openWorktree = (worktree: Worktree): Promise<void> => lazygitTerminal.open(worktree);

  select.on(SelectRenderableEvents.ITEM_SELECTED, async (_index, option) => {
    select.blur();
    tabs.setSelectedIndex(1);
    state.activeTab = 1;
    worktreePanel.visible = false;
    terminalPanel.visible = true;
    await renderer.idle();
    terminal.blur();
    terminal.focus();
    await renderer.idle();
    terminal.focus();
    void openWorktree(option.value as Worktree).catch((error: unknown) => {
      footerText.content = `Unable to start lazygit: ${String(error)}`;
    });
  });

  searchInput.on(InputRenderableEvents.ENTER, () => {
    state.searchActive = false;
    searchBar.visible = true;
    searchInput.blur();
    select.focus();
    void refreshWorktrees();
  });
  promptInput.on(InputRenderableEvents.ENTER, () => {
    const value = promptInput.value.trim();
    const mode = state.promptMode;
    if (mode === "apply-theme") {
      const answer = value.toLowerCase();
      if (answer !== "y" && answer !== "n") {
        footerText.content = "Please type y or n to choose whether to apply the theme.";
        return;
      }
      const accepted = answer === "y";
      state.promptActive = false;
      state.promptMode = null;
      state.pendingTheme = null;
      promptPanel.visible = false;
      promptInput.blur();
      if (accepted) {
        committedTheme = appliedTheme;
        config.theme = committedTheme.id;
        void saveConfig(config).catch((error: unknown) => {
          footerText.content = `Unable to save theme: ${String(error)}`;
        });
        themeSwitcher.panel.visible = false;
        if (state.activeTab === 0) select.focus();
        else terminal.focus();
      } else {
        closeThemeSwitcher();
      }
      return;
    }
    closePrompt();
    if (mode === "create") {
      void createWorktree(value).catch((error: unknown) => {
        footerText.content = `Unable to create worktree: ${String(error)}`;
      });
    } else if (mode === "delete") {
      if (value.toLowerCase() !== "y") return;
      state.pendingDeleteTargets = worktrees.filter((worktree) => selectedWorktrees.has(worktree.path));
      openPrompt(
        "delete-branches",
        `Delete related branches too? Type y or n: ${state.pendingDeleteTargets.map((item) => item.branch).join(", ")}`,
      );
    } else if (mode === "delete-branches") {
      if (value.toLowerCase() !== "y" && value.toLowerCase() !== "n") {
        footerText.content = "Please type y or n to choose whether to delete related branches.";
        openPrompt(
          "delete-branches",
          `Delete related branches too? Type y or n: ${state.pendingDeleteTargets.map((item) => item.branch).join(", ")}`,
        );
        return;
      }
      const deleteBranches = value.toLowerCase() === "y";
      const targets = state.pendingDeleteTargets;
      state.pendingDeleteTargets = [];
      void deleteWorktrees(targets, deleteBranches).catch((error: unknown) => {
        footerText.content = `Unable to delete worktrees: ${String(error)}`;
      });
    }
  });

  const selectedTarget = (): Worktree | undefined => worktreesPanel.selectedTarget();

  const performAction = (action: Action): void => {
    if (state.promptActive || state.keybindingsActive) return;
    if (action === "edit-config") {
      void openConfigEditor().catch((error: unknown) => {
        state.configEditorActive = false;
        configEditorPanel.visible = false;
        footerText.content = `Unable to edit configuration: ${String(error)}`;
        if (state.activeTab === 0) select.focus();
        else terminal.focus();
      });
      return;
    }
    if (action === "switch-theme") {
      openThemeSwitcher();
      return;
    }
    if (state.activeTab !== 0) return;
    if (action === "select-worktrees") {
      const target = selectedTarget();
      if (target) {
        if (selectedWorktrees.has(target.path)) selectedWorktrees.delete(target.path);
        else selectedWorktrees.add(target.path);
        void refreshWorktrees();
      }
    } else if (action === "search-worktrees") {
      state.searchActive = true;
      searchInput.value = "";
      searchBar.visible = true;
      searchInput.focus();
      select.blur();
      void refreshWorktrees();
    } else if (action === "create-worktree") {
      openPrompt("create", "New worktree (<type>/<name>):");
    } else if (action === "delete-worktrees") {
      const targets = worktrees.filter((worktree) => selectedWorktrees.has(worktree.path));
      if (targets.length === 0) {
        footerText.content = "No worktrees selected for deletion.";
      } else {
        state.pendingDeleteTargets = targets;
        openPrompt(
          "delete",
          `Delete ${targets.length} worktree(s)? Type y to confirm: ${targets.map((item) => item.branch).join(", ")}`,
        );
      }
    }
  };

  tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (index) => {
    updateTab(index);
  });
  tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index) => {
    updateTab(index);
  });

  const onKeyPress = (key: KeyEvent): void => {
    if (state.configEditorActive) {
      if (key.name === "?" || (state.configInstructionsActive && key.name === "escape")) {
        key.preventDefault();
        toggleConfigInstructions();
      }
      return;
    }
    if (state.promptActive && state.promptMode === "apply-theme") {
      if (key.name === "escape") {
        key.preventDefault();
        closePrompt();
        closeThemeSwitcher();
      }
      return;
    }
    if (state.promptActive) {
      if (key.name === "escape") {
        key.preventDefault();
        closePrompt();
      }
      return;
    }
    if (themeSwitcher.panel.visible) {
      if (key.name === "escape") {
        key.preventDefault();
        closeThemeSwitcher();
      }
      return;
    }
    if (!state.configEditorActive && key.name === "tab") {
      key.preventDefault();
      const nextTab = state.activeTab === 0 ? 1 : 0;
      tabs.setSelectedIndex(nextTab);
      updateTab(nextTab);
      return;
    }
    if (state.activeTab === 1) {
      return;
    }
    if (!state.configEditorActive && key.name === "q" && !key.ctrl && !key.meta) {
      renderer.destroy();
      return;
    }
    const globalBinding = !state.configEditorActive
      ? getKeybindings("Global")[key.shift ? key.name.toUpperCase() : key.name]
      : undefined;
    if (globalBinding && !key.ctrl && !key.meta) {
      key.preventDefault();
      performAction(globalBinding.action);
      return;
    }
    if (state.activeTab === 0 && key.name === "?" && !key.ctrl && !key.meta) {
      key.preventDefault();
      if (state.keybindingsActive) closeKeybindings();
      else showKeybindings("Worktrees");
      return;
    }
    if (state.keybindingsActive && key.name === "escape") {
      key.preventDefault();
      closeKeybindings();
      return;
    }
    if (state.activeTab === 0 && !state.promptActive && !state.searchActive && !key.ctrl && !key.meta) {
      const keybindings = getKeybindings("Worktrees");
      const binding = keybindings[key.name] ?? (key.name === "space" ? keybindings.spacebar : undefined);
      if (binding) {
        key.preventDefault();
        performAction(binding.action);
        return;
      }
    }
    if (state.searchActive && key.name === "escape") {
      key.preventDefault();
      state.searchActive = false;
      searchBar.visible = true;
      searchInput.blur();
      select.focus();
      void refreshWorktrees();
      return;
    }
    if (state.promptActive && key.name === "escape") {
      key.preventDefault();
      closePrompt();
      return;
    }
  };
  const keyInput = renderer.keyInput as unknown as KeyInputEvents;
  keyInput.addListener("keypress", onKeyPress);
  renderer.once("destroy", () => {
    keyInput.removeListener("keypress", onKeyPress);
    renderer.off("palette", syncTerminalBackground);
    stopPty();
    configEditor.close();
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    renderer.destroy();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  updateTab(0);
}
