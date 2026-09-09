import path from "node:path";
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
import { bareRoot, getBranches, getCommitRefs, getRemoteUrl, getTagRefs, getWorktrees, gitRoot } from "../services/git.js";
import { spawnPty } from "../services/pty.js";
import { applyEmbeddedTerminalPalette } from "../services/terminalPalette.js";
import { TerminalPanel } from "../components/TerminalPanel.js";
import { WorktreesPanel } from "../components/WorktreesPanel.js";
import { Prompt } from "../components/Prompt.js";
import { KeybindingsHelp } from "../components/KeybindingsHelp.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { createTabs, createWorktreeChip } from "../components/Tabs.js";
import { Footer } from "../components/Footer.js";
import { ThemeSwitcher } from "../components/ThemeSwitcher.js";
import { keyBindingsHelp, keyHints } from "../components/keyHints.js";
import { ActionsPanel } from "../components/ActionsPanel.js";
import { CollaborationPanel, type CollaborationPromptRequest } from "../components/CollaborationPanel.js";
import { BranchSelector } from "../components/BranchSelector.js";
import { CreationModeSelector } from "../components/CreationModeSelector.js";
import { DetachedRefSelector } from "../components/DetachedRefSelector.js";
import { expandWorktreeCommand, runAuthenticationCommand, runExternalCommand, runInteractiveCommand } from "../services/commands.js";
import { getTheme, loadThemes, type Theme } from "../services/themes.js";
import type { Action, BranchOption, DetachedRef, TabName, Worktree, WorktreeCreationMode } from "../types.js";
import type { PullRequestCommentInput } from "../services/collaboration/types.js";
import type { IPty } from "node-pty";
import { createKeybindingResolver, ensureDefaultKeybindings } from "./keybindings.js";
import { createAppState } from "./state.js";
import { createCollaborationProvider } from "../services/collaboration/factory.js";

type KeyInputEvents = {
  addListener(event: "keypress", handler: (key: KeyEvent) => void): void;
  removeListener(event: "keypress", handler: (key: KeyEvent) => void): void;
};

export async function runApp(): Promise<void> {
  const cwd = process.cwd();
  const remoteUrl = await getRemoteUrl(cwd).catch(() => undefined);
  const collaborationProvider = remoteUrl ? createCollaborationProvider(remoteUrl) : undefined;
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
  const worktreeChip = createWorktreeChip(renderer, terminalBackground);

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
  const actionsPanel = new ActionsPanel(
    renderer,
    projectConfig.actions ?? [],
    commandShell,
    terminalBackground,
  );
  let pendingCollaborationPrompt: CollaborationPromptRequest | null = null;
  const collaborationPanel = new CollaborationPanel(
    renderer,
    terminalBackground,
    collaborationProvider,
    projectConfig.pipelines,
    (provider) => openAuthenticationPrompt(provider),
    (request) => {
      pendingCollaborationPrompt = request;
      if (request.kind === "comment") {
        const format = request.commentType === "line" ? "path:line | comment" : "path | comment";
        openPrompt("collaboration-comment", `Add ${request.commentType} comment (${format}):`);
      } else if (request.kind === "resolve-comment") {
        openPrompt("collaboration-action", "Resolve this comment? Type y or n:");
      } else if (request.kind === "pipeline-action") {
        openPrompt("collaboration-action", `${request.action} this pipeline? Type y or n:`);
      } else {
        openPrompt("collaboration-action", `${request.action} this pull request? Type y or n:`);
      }
    },
  );
  const worktreePanel = worktreesPanel.panel;
  const select = worktreesPanel.select;
  const searchBar = worktreesPanel.searchBar;
  const searchInput = worktreesPanel.searchInput;
  const selectedWorktrees = worktreesPanel.selectedWorktrees;
  const state = createAppState();
  let revertingWorktreeSelection = false;
  const updateWorktreeChip = (worktree: Worktree | undefined): void => {
    const name = worktree?.name ?? worktree?.branch ?? "-";
    const label = name.slice(0, 19);
    const chipWidth = label.length + 2;
    worktreeChip.panel.width = chipWidth;
    worktreeChip.text.width = chipWidth;
    worktreeChip.text.content = ` ${label} `;
    tabs.left = chipWidth + 5;
  };
  const updateTerminalTitle = (worktree: Worktree | undefined): void => {
    const name = (worktree?.name ?? worktree?.branch ?? "-").replaceAll(/[\u0000-\u001f\u007f]/g, "");
    renderer.setTerminalTitle(`CodePanes: ${name}`);
  };
  actionsPanel.setWorktree(worktreesPanel.selectedTarget());
  updateWorktreeChip(worktreesPanel.activeWorktree);
  updateTerminalTitle(worktreesPanel.activeWorktree);
  const prompt = new Prompt(renderer);
  const promptPanel = prompt.panel;
  const promptLabel = prompt.label;
  const promptInput = prompt.input;
  const keybindingsHelp = new KeybindingsHelp(renderer);
  const keybindingsPanel = keybindingsHelp.panel;
  const keybindingsText = keybindingsHelp.text;
  root.add(promptPanel);
  const branchSelector = new BranchSelector(renderer, (branch: BranchOption) => {
    branchSelector.close();
    state.pendingCreationBranch = branch;
    if (state.pendingCreationMode === "new-branch") {
      state.pendingBaseBranch = branch.ref;
      openPrompt("create", `New worktree name (base: ${branch.ref}):`);
    } else if (state.pendingCreationMode === "existing-local") {
      openPrompt("create", `Worktree directory name (branch: ${branch.name}):`);
    } else if (state.pendingCreationMode === "existing-remote") {
      openPrompt("create", `Local branch name (remote: ${branch.ref}):`);
    } else if (state.pendingCreationMode === "detached-commit") {
      void getCommitRefs(cwd, branch.ref).then((refs) => {
        if (refs.length === 0) {
          footerText.content = `No commits found for ${branch.name}.`;
          return;
        }
        detachedRefSelector.open(refs, branch.name, appliedTheme);
      }).catch((error: unknown) => {
        footerText.content = `Unable to load commits: ${String(error)}`;
      });
    }
  });
  root.add(branchSelector.panel);
  const detachedRefSelector = new DetachedRefSelector(renderer, (ref) => {
    detachedRefSelector.close();
    state.pendingDetachedRef = ref;
    const branch = state.pendingCreationBranch;
    openPrompt("create", `Worktree directory name (detached: ${ref.name}):`);
    if (!branch) footerText.content = "No detached branch is selected.";
  });
  root.add(detachedRefSelector.panel);
  const creationModeSelector = new CreationModeSelector(renderer, (mode) => {
    creationModeSelector.close();
    state.pendingCreationMode = mode;
    if (mode === "detached-tag") {
      state.pendingCreationBranch = { name: "tags", ref: "", remote: false };
      void getTagRefs(cwd).then((refs) => {
        if (refs.length === 0) {
          footerText.content = "No tags are available.";
          return;
        }
        detachedRefSelector.open(refs, "all tags", appliedTheme);
      }).catch((error: unknown) => {
        footerText.content = `Unable to load tags: ${String(error)}`;
      });
      return;
    }
    void getBranches(cwd).then((branches) => {
      const filtered = mode === "existing-local"
        ? branches.filter((branch) => !branch.remote)
        : mode === "existing-remote"
        ? branches.filter((branch) => branch.remote)
        : branches;
      if (filtered.length === 0) {
        footerText.content = `No ${mode === "existing-local" ? "local" : "remote"} branches are available.`;
        return;
      }
      branchSelector.open(filtered, appliedTheme);
    }).catch((error: unknown) => {
      footerText.content = `Unable to load branches: ${String(error)}`;
    });
  });
  root.add(creationModeSelector.panel);
  root.add(keybindingsPanel);
  const themeSwitcher = new ThemeSwitcher(renderer, availableThemes, (theme) => {
    appliedTheme = theme;
    renderTheme(theme);
  }, (theme) => beginThemeConfirmation(theme));
  root.add(themeSwitcher.panel);

  const refreshWorktrees = async (): Promise<void> => {
    await worktreesPanel.refresh();
    worktrees = worktreesPanel.items;
    const target = worktreesPanel.selectedTarget();
    actionsPanel.setWorktree(worktreesPanel.activeWorktree ?? target);
    updateWorktreeChip(worktreesPanel.activeWorktree ?? target);
    updateTerminalTitle(worktreesPanel.activeWorktree ?? target);
  };

  const closePrompt = (): void => {
    state.promptActive = false;
    state.promptMode = null;
    state.pendingWorktreeSelection = null;
    promptPanel.visible = false;
    promptInput.blur();
    if (state.activeTab === 0) worktreesPanel.focusOverview();
    else if (state.activeTab === 2) collaborationPanel.focusResource();
    else if (state.activeTab === 3) actionsPanel.select.focus();
    else terminal.focus();
  };

  const closeThemeSwitcher = (restore = true): void => {
    if (restore) {
      appliedTheme = committedTheme;
      renderTheme(committedTheme);
    }
    state.pendingTheme = null;
    themeSwitcher.panel.visible = false;
    themeSwitcher.select.blur();
    if (state.activeTab === 0) worktreesPanel.focusOverview();
    else if (state.activeTab === 2) collaborationPanel.focusResource();
    else if (state.activeTab === 3) actionsPanel.select.focus();
    else terminal.focus();
  };

  function renderTheme(theme: Theme): void {
    root.backgroundColor = theme.background;
    worktreesPanel.applyTheme(theme);
    lazygitTerminal.applyTheme(theme);
    actionsPanel.applyTheme(theme);
    collaborationPanel.applyTheme(theme);
    configEditor.applyTheme(theme);
    footer.applyTheme(theme);
    prompt.applyTheme(theme);
    keybindingsHelp.applyTheme(theme);
    themeSwitcher.applyTheme(theme);
    branchSelector.applyTheme(theme);
    creationModeSelector.applyTheme(theme);
    detachedRefSelector.applyTheme(theme);
    tabs.applyTheme({
      text: theme.muted,
      accent: theme.accent,
      background: theme.background,
      focusedBackground: theme.focusedBackground,
    });
    worktreeChip.panel.bg = theme.focusedBackground;
    worktreeChip.text.fg = theme.text;
  }

  const closeKeybindings = (): void => {
    state.keybindingsActive = false;
    keybindingsPanel.visible = false;
    if (state.activeTab === 0) worktreesPanel.focusOverview();
    else if (state.activeTab === 2) collaborationPanel.focusResource();
    else if (state.activeTab === 3) actionsPanel.select.focus();
    else terminal.focus();
  };

  const closeConfigEditor = (): void => {
    configEditor.close();
    state.configEditorActive = false;
    state.configInstructionsActive = false;
    configInstructionsPanel.visible = false;
    configEditorPanel.visible = false;
    if (state.activeTab === 0) worktreesPanel.focusOverview();
    else if (state.activeTab === 2) collaborationPanel.focusResource();
    else if (state.activeTab === 3) actionsPanel.select.focus();
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
    actionsPanel.select.blur();
    configEditorRenderable.focus();
    await configEditor.open();
  };

  const showKeybindings = (tabName: TabName): void => {
    const bindings = { ...getKeybindings("Global"), ...getKeybindings(tabName) };
    const lines = Object.entries(bindings).map(([key, binding]) => {
      const displayKey = key === "spacebar" ? "Space" : key;
      return [displayKey, binding.name] as [string, string];
    });
    keybindingsText.content = lines.length > 0
      ? keyBindingsHelp(appliedTheme, tabName, lines)
      : keyBindingsHelp(appliedTheme, tabName, [["-", "No configured keybindings"]]);
    state.keybindingsActive = true;
    keybindingsPanel.visible = true;
    select.blur();
    terminal.blur();
    actionsPanel.select.blur();
  };

  const toggleConfigInstructions = (): void => {
    state.configInstructionsActive = !state.configInstructionsActive;
    configInstructionsPanel.visible = state.configInstructionsActive;
    configEditor.toggleInstructions(state.configInstructionsActive);
  };

  const openPrompt = (
    mode:
      | "create"
      | "delete"
      | "delete-branches"
      | "delete-remote"
      | "authenticate"
      | "switch-actions"
      | "collaboration-comment"
      | "collaboration-action",
    label: string,
  ): void => {
    if (mode === "create") promptPanel.height = 7;
    prompt.setInputSpacing(mode !== "create");
    state.promptMode = mode;
    state.promptActive = true;
    promptLabel.content = label;
    promptInput.value = "";
    promptPanel.visible = true;
    select.blur();
    actionsPanel.select.blur();
    promptInput.focus();
  };

  const openAuthenticationPrompt = (provider: "github" | "azure"): void => {
    const command = provider === "github"
      ? { name: "gh", args: ["auth", "login", "--web"] }
      : { name: "az", args: ["login"] };
    void runAuthenticationCommand(command.name, command.args, cwd).catch((error: unknown) => {
      footerText.content = `Unable to start browser authentication: ${String(error)}`;
    });
    openPrompt("authenticate", `Complete ${provider} authentication in the new window, then type y to retry:`);
  };

  const deletePromptLabel = (targets: Worktree[]): string =>
    `Delete these worktrees? Type y to confirm:\n\n${worktreesPanel.formatTable(targets)}\n\n`;

  const openThemeSwitcher = (): void => {
    if (state.configEditorActive || state.keybindingsActive || state.promptActive) return;
    themeSwitcher.panel.visible = true;
    themeSwitcher.select.setSelectedIndex(
      Math.max(0, availableThemes.findIndex((theme) => theme.id === committedTheme.id)),
    );
    themeSwitcher.select.focus();
    select.blur();
    terminal.blur();
    actionsPanel.select.blur();
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
  actionsPanel.applyPalette(terminalPalette);
  body.add(worktreePanel);
  body.add(terminalPanel);
  body.add(collaborationPanel.panel);
  body.add(actionsPanel.panel);
  // root.add(header);
  root.add(tabs);
  root.add(worktreeChip.panel);
  root.add(body);
  root.add(footerPanel);
  renderer.root.add(root);
  renderTheme(appliedTheme);

  const syncTerminalBackground = (palette: TerminalColors): void => {
    root.backgroundColor = appliedTheme.background;
    applyEmbeddedTerminalPalette(configEditorRenderable, palette);
    lazygitTerminal.applyPalette(palette);
    worktreesPanel.applyPalette(palette);
    actionsPanel.applyPalette(palette);
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

  const createWorktree = async (
    mode: WorktreeCreationMode,
    name: string,
    branch: BranchOption,
    detachedRef?: DetachedRef,
  ): Promise<void> => {
    if (!name || path.isAbsolute(name) || path.win32.isAbsolute(name) || name.split(/[\\/]/).includes("..")) {
      footerText.content = "Invalid worktree directory or branch name.";
      return;
    }
    if (mode === "new-branch" && (!/^[^/]+\/[^/]+$/.test(name) || name.includes(".."))) {
      footerText.content = "Invalid name. Use <type>/<name> for a new branch.";
      return;
    }
    const root = await bareRoot(cwd);
    const branchName = mode === "new-branch" || mode === "existing-remote" ? name : branch.name;
    const target = path.join(root, name);
    state.worktreeOperationActive = true;
    worktreesPanel.beginCreating({ path: target, branch: branchName });
    try {
      const args = mode === "new-branch"
        ? ["worktree", "add", "-b", branchName, target, branch.ref]
        : mode === "existing-local"
        ? ["worktree", "add", target, branch.ref]
        : mode === "existing-remote"
        ? ["worktree", "add", "--track", "-b", branchName, target, branch.ref]
        : ["worktree", "add", "--detach", target, detachedRef?.ref ?? branch.ref];
      await runLoggedGitCommand(args, root);
      await runPostCreateActions(target);
      worktreesPanel.clearOperation(target);
      await refreshWorktrees();
      footerText.content = `Created ${name}`;
    } catch (error) {
      worktreesPanel.setOperation(target, "failed");
      setTimeout(() => worktreesPanel.removeOperation(target), 3000);
      throw error;
    } finally {
      state.worktreeOperationActive = false;
    }
  };

  const deleteWorktrees = async (
    targets: Worktree[],
    deleteBranches: boolean,
    deleteRemotes: boolean,
  ): Promise<void> => {
    const root = await bareRoot(cwd);
    state.worktreeOperationActive = true;
    for (const target of targets) {
      worktreesPanel.setOperation(target.path, "deleting", "delete", target.name ?? path.basename(target.path));
    }
    try {
      for (let index = 0; index < targets.length; index += 1) {
        try {
          footerText.content = `Deleting ${index + 1}/${targets.length}: ${targets[index].branch}`;
          await runLoggedGitCommand(["worktree", "remove", "--force", targets[index].path], root);
          if (deleteBranches && targets[index].branch !== "(detached)") {
            await runLoggedGitCommand(["branch", "-D", targets[index].branch], root);
          }
          const remote = targets[index].remote;
          if (deleteRemotes && remote && targets[index].branch !== "(detached)") {
            const separator = remote.indexOf("/");
            const remoteName = separator >= 0 ? remote.slice(0, separator) : remote;
            await runLoggedGitCommand(["push", remoteName, "--delete", targets[index].branch], root);
          }
          worktreesPanel.clearOperation(targets[index].path);
          selectedWorktrees.delete(targets[index].path);
          await refreshWorktrees();
        } catch (error) {
          worktreesPanel.setOperation(targets[index].path, "failed");
          for (const remaining of targets.slice(index + 1)) worktreesPanel.clearOperation(remaining.path);
          throw error;
        }
      }
      await refreshWorktrees();
      footerText.content = `Deleted ${targets.length} worktree${targets.length === 1 ? "" : "s"}`;
    } finally {
      state.worktreeOperationActive = false;
    }
  };

  const updateTab = (index: number): void => {
    state.activeTab = index;
    worktreePanel.visible = index === 0;
    terminalPanel.visible = index === 1;
    collaborationPanel.panel.visible = index === 2;
    actionsPanel.panel.visible = index === 3;

    if (index === 0) {
      state.terminalFocused = false;
      terminal.blur();
      if (!state.keybindingsActive) worktreesPanel.focusOverview();
      footerText.content = keyHints(appliedTheme, [
        ["j/k", "move"],
        ["Space", "select"],
        ["/", "filter"],
        ["n", "new"],
        ["d", "delete"],
        ["x", "clear operations"],
        ["C", "config"],
        ["Enter", "open"],
        ["Tab", "switch tabs"],
        ["?", "keybindings"],
        ["Q", "quit"],
      ]);
    } else if (index === 1) {
      state.terminalFocused = true;
      select.blur();
      if (!state.keybindingsActive && !state.configEditorActive) {
        void focusTerminal();
      }
      footerText.content = keyHints(appliedTheme, [
        ["j/k", "navigate"],
        ["C", "config"],
        ["Tab", "switch tabs"],
        ["Q", "quit"],
      ]);
    } else if (index === 2) {
      state.terminalFocused = false;
      select.blur();
      terminal.blur();
      if (!state.keybindingsActive && !state.configEditorActive) collaborationPanel.focusResource();
      footerText.content = keyHints(appliedTheme, [
        ["j/k", "navigate"],
        ["h/l", "change pane"],
        ["r", "refresh"],
        ["Enter", "select"],
        ["Tab", "switch tabs"],
        ["?", "keybindings"],
        ["Q", "quit"],
      ]);
    } else {
      state.terminalFocused = false;
      select.blur();
      terminal.blur();
      if (!state.keybindingsActive && !state.configEditorActive) actionsPanel.focusActions();
      footerText.content = keyHints(appliedTheme, [
        ["j/k", "choose action"],
        ["Enter", "run"],
        ["x", "stop"],
        ["X", "stop all"],
        ["C", "config"],
        ["Tab", "switch tabs"],
        ["?", "keybindings"],
        ["Q", "quit"],
      ]);
    }
  };

  const openWorktree = (worktree: Worktree, focus = true): Promise<void> => lazygitTerminal.open(worktree, focus);

  select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    if (revertingWorktreeSelection) {
      revertingWorktreeSelection = false;
      return;
    }
  });

  select.on(SelectRenderableEvents.ITEM_SELECTED, async (_index, option) => {
    if (state.worktreeOperationActive) return;
    const target = option.value as Worktree;
    const active = worktreesPanel.activeWorktree;
    if (active?.path !== target.path && actionsPanel.hasActiveProcesses()) {
      state.pendingWorktreeSelection = { index: select.getSelectedIndex(), path: target.path };
      openPrompt(
        "switch-actions",
        `Actions are running for ${active?.branch ?? "another worktree"}. Stop them before switching? Type y or n:\n\n`
          + `y = stop ${actionsPanel.activeCount} action${actionsPanel.activeCount === 1 ? "" : "s"}\n`
          + "n = keep them running\n\n",
      );
      return;
    }
    worktreesPanel.setActiveWorktree(target);
    updateWorktreeChip(target);
    updateTerminalTitle(target);
    actionsPanel.setWorktree(target);
    void openWorktree(target, false).catch((error: unknown) => {
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
    if (mode === "switch-actions") {
      const answer = value.toLowerCase();
      if (answer !== "y" && answer !== "n") {
        footerText.content = "Please type y to stop actions or n to keep them running.";
        return;
      }
      if (answer === "y") actionsPanel.stopAll();
      const pending = state.pendingWorktreeSelection;
      state.pendingWorktreeSelection = null;
      if (pending) {
        revertingWorktreeSelection = true;
        select.setSelectedIndex(pending.index);
        const target = worktreesPanel.selectedTarget();
        worktreesPanel.setActiveWorktree(target);
        updateWorktreeChip(target);
        updateTerminalTitle(target);
        actionsPanel.setWorktree(target);
        if (target) {
          void openWorktree(target, false).catch((error: unknown) => {
            footerText.content = `Unable to start lazygit: ${String(error)}`;
          });
        }
      }
      closePrompt();
      return;
    }
    if (mode === "collaboration-comment") {
      const request = pendingCollaborationPrompt;
      if (!request || request.kind !== "comment") {
        closePrompt();
        return;
      }
      const lineMatch = value.match(/^(.+):(\d+)\s*\|\s*(.+)$/);
      const fileMatch = value.match(/^(.+?)\s*\|\s*(.+)$/);
      const match = request.commentType === "line" ? lineMatch : fileMatch;
      if (!match) {
        footerText.content = request.commentType === "line"
          ? "Use path:line | comment."
          : "Use path | comment.";
        return;
      }
      if (request.commentType === "line" && Number(match[2]) < 1) {
        footerText.content = "Line numbers start at 1.";
        return;
      }
      const comment: PullRequestCommentInput = {
        filePath: match[1].trim(),
        body: match[request.commentType === "line" ? 3 : 2].trim(),
        ...(request.commentType === "line" ? { line: Number(match[2]) } : {}),
      };
      pendingCollaborationPrompt = null;
      closePrompt();
      void collaborationPanel.createPullRequestComment(comment).then(() => {
        footerText.content = "Comment created.";
      }).catch((error: unknown) => {
        footerText.content = `Unable to create comment: ${String(error)}`;
      });
      return;
    }
    if (mode === "collaboration-action") {
      const request = pendingCollaborationPrompt;
      const answer = value.toLowerCase();
      if (answer !== "y" && answer !== "n") {
        footerText.content = "Please type y or n.";
        return;
      }
      pendingCollaborationPrompt = null;
      closePrompt();
      if (answer !== "y" || !request) return;
      const operation = request.kind === "resolve-comment"
        ? collaborationPanel.updateSelectedCommentStatus()
        : request.kind === "action"
          ? collaborationPanel.executePullRequestAction(request.action)
          : request.kind === "pipeline-action"
            ? collaborationPanel.executePipelineAction(request.action)
          : Promise.resolve();
      void operation.then(() => {
        footerText.content = "Collaboration action completed.";
      }).catch((error: unknown) => {
        footerText.content = `Unable to complete collaboration action: ${String(error)}`;
      });
      return;
    }
    if (mode === "authenticate") {
      const answer = value.toLowerCase();
      if (answer !== "y" && answer !== "n") {
        footerText.content = "Please type y after authentication or n to cancel.";
        return;
      }
      closePrompt();
      if (answer === "y") collaborationPanel.retryCurrentResource();
      return;
    }
    closePrompt();
    if (mode === "create") {
      const creationMode = state.pendingCreationMode;
      const creationBranch = state.pendingCreationBranch;
      const detachedRef = state.pendingDetachedRef;
      state.pendingCreationMode = null;
      state.pendingCreationBranch = null;
      state.pendingDetachedRef = null;
      state.pendingBaseBranch = null;
      if (!creationMode || (!creationBranch && creationMode !== "detached-tag")) {
        footerText.content = "No worktree creation mode is selected.";
        return;
      }
      void createWorktree(
        creationMode,
        value,
        creationBranch ?? { name: "tags", ref: "", remote: false },
        detachedRef ?? undefined,
      ).catch((error: unknown) => {
        footerText.content = `Unable to create worktree: ${String(error)}`;
      });
    } else if (mode === "delete") {
      if (value.toLowerCase() !== "y") return;
      state.pendingDeleteTargets = worktrees.filter((worktree) => selectedWorktrees.has(worktree.path));
      openPrompt(
        "delete-branches",
        `Delete related branches too? Type y or n:\n\n${worktreesPanel.formatTable(state.pendingDeleteTargets)}\n\n`,
      );
    } else if (mode === "delete-branches") {
      if (value.toLowerCase() !== "y" && value.toLowerCase() !== "n") {
        footerText.content = "Please type y or n to choose whether to delete related branches.";
        openPrompt(
          "delete-branches",
          `Delete related branches too? Type y or n:\n\n${worktreesPanel.formatTable(state.pendingDeleteTargets)}\n\n`,
        );
        return;
      }
      const deleteBranches = value.toLowerCase() === "y";
      const targets = state.pendingDeleteTargets;
      const remoteTargets = targets.filter((target) => target.remote && target.branch !== "(detached)");
      state.pendingDeleteBranches = deleteBranches;
      if (remoteTargets.length > 0) {
        promptPanel.height = Math.min(9 + remoteTargets.length, 70);
        openPrompt(
          "delete-remote",
          `Delete related remote branches too? Type y or n:\n\n${worktreesPanel.formatTable(remoteTargets)}\n\n`,
        );
        return;
      }
      state.pendingDeleteTargets = [];
      void deleteWorktrees(targets, deleteBranches, false).catch((error: unknown) => {
        footerText.content = `Unable to delete worktrees: ${String(error)}`;
      });
    } else if (mode === "delete-remote") {
      if (value.toLowerCase() !== "y" && value.toLowerCase() !== "n") {
        footerText.content = "Please type y or n to choose whether to delete related remote branches.";
        const remoteTargets = state.pendingDeleteTargets.filter(
          (target) => target.remote && target.branch !== "(detached)",
        );
        promptPanel.height = Math.min(9 + remoteTargets.length, 70);
        openPrompt(
          "delete-remote",
          `Delete related remote branches too? Type y or n:\n\n${worktreesPanel.formatTable(remoteTargets)}\n\n`,
        );
        return;
      }
      const targets = state.pendingDeleteTargets;
      const deleteBranches = state.pendingDeleteBranches;
      state.pendingDeleteTargets = [];
      state.pendingDeleteBranches = false;
      void deleteWorktrees(targets, deleteBranches, value.toLowerCase() === "y").catch((error: unknown) => {
        footerText.content = `Unable to delete worktrees: ${String(error)}`;
      });
    }
  });

  const selectedTarget = (): Worktree | undefined => worktreesPanel.selectedTarget();

  const runConfiguredCommand = (
    binding?: { command?: string; target?: "embedded" | "external" | "external-terminal" },
  ): void => {
    if (state.activeTab !== 0 || !binding?.command) return;
    const target = selectedTarget();
    if (!target) {
      footerText.content = "No worktree is selected.";
      return;
    }
    const command = expandWorktreeCommand(binding.command, target.path, target.branch);
    const run = binding.target === "embedded"
      ? runInteractiveCommand(
          commandShell,
          command,
          {
            cwd: target.path,
            cols: Math.max(20, worktreesPanel.output.terminal.width),
            rows: Math.max(8, worktreesPanel.output.terminal.height),
          },
          (data) => worktreesPanel.output.write(data),
        )
      : runExternalCommand(commandShell, command, target.path);
    void run.then(
      () => {
        worktreesPanel.output.writeMessage(`[completed] ${command}`, appliedTheme.success ?? appliedTheme.accent);
      },
      (error: unknown) => {
        worktreesPanel.output.writeMessage(`[failed] ${command}: ${String(error)}`, appliedTheme.error ?? appliedTheme.accent);
        footerText.content = `Unable to run command: ${String(error)}`;
      },
    );
  };

  const performAction = (action: Action, binding?: { command?: string; target?: "embedded" | "external" | "external-terminal" }): void => {
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
    if (action === "run-command") {
      runConfiguredCommand(binding);
      return;
    }
    if (action === "run-action") {
      if (state.activeTab !== 3) return;
      actionsPanel.runSelected(selectedTarget());
      return;
    }
    if (action === "stop-action") {
      if (state.activeTab !== 3) return;
      actionsPanel.stopSelected();
      return;
    }
    if (action === "stop-actions") {
      if (state.activeTab !== 3) return;
      actionsPanel.stopAll();
      return;
    }
    if (action === "clear-operations") {
      worktreesPanel.clearOperations();
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
      creationModeSelector.open(appliedTheme);
    } else if (action === "delete-worktrees") {
      const targets = worktrees.filter((worktree) => selectedWorktrees.has(worktree.path));
      if (targets.length === 0) {
        footerText.content = "No worktrees selected for deletion.";
      } else {
        state.pendingDeleteTargets = targets;
        promptPanel.height = Math.min(9 + targets.length, 70);
        openPrompt(
          "delete",
          deletePromptLabel(targets),
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
    if (branchSelector.panel.visible) {
      if (key.name === "escape") {
        key.preventDefault();
        branchSelector.close();
      }
      return;
    }
    if (detachedRefSelector.panel.visible) {
      if (key.name === "escape") {
        key.preventDefault();
        detachedRefSelector.close();
      }
      return;
    }
    if (creationModeSelector.panel.visible) {
      if (key.name === "escape") {
        key.preventDefault();
        creationModeSelector.close();
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
      const nextTab = key.shift ? (state.activeTab + 3) % 4 : (state.activeTab + 1) % 4;
      tabs.setSelectedIndex(nextTab);
      updateTab(nextTab);
      return;
    }
    if (state.activeTab === 1) {
      return;
    }
    if (state.activeTab === 2 && key.name === "return") {
      key.preventDefault();
      collaborationPanel.activateSelectedPullRequest();
      return;
    }
    if (state.activeTab === 2 && !state.promptActive && !state.keybindingsActive && !state.configEditorActive) {
      if (key.name === "r") {
        key.preventDefault();
        collaborationPanel.retryCurrentResource();
        return;
      }
      if (key.name === "l") {
        key.preventDefault();
        collaborationPanel.focusNext();
        return;
      }
      if (key.name === "h") {
        key.preventDefault();
        collaborationPanel.focusPrevious();
        return;
      }
    }
    if (state.activeTab === 3 && !state.promptActive && !state.keybindingsActive && !state.configEditorActive) {
      if (key.name === "h") {
        key.preventDefault();
        actionsPanel.focusActions();
        return;
      }
      if (key.name === "l") {
        key.preventDefault();
        actionsPanel.focusOutput();
        return;
      }
      if (actionsPanel.isOutputFocused() && (key.name === "j" || key.name === "k")) {
        key.preventDefault();
        actionsPanel.scrollOutput(key.name === "j" ? 3 : -3);
        return;
      }
    }
    if (state.activeTab === 0 && !state.promptActive && !state.keybindingsActive && !state.configEditorActive && !state.searchActive) {
      if (key.name === "h") {
        key.preventDefault();
        worktreesPanel.focusOverview();
        return;
      }
      if (key.name === "l") {
        key.preventDefault();
        worktreesPanel.focusOutput();
        return;
      }
      if (worktreesPanel.isOutputFocused() && (key.name === "j" || key.name === "k")) {
        key.preventDefault();
        worktreesPanel.scrollOutput(key.name === "j" ? 3 : -3);
        return;
      }
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
      performAction(globalBinding.action, globalBinding);
      return;
    }
    if (state.activeTab === 0 && key.name === "?" && !key.ctrl && !key.meta) {
      key.preventDefault();
      if (state.keybindingsActive) closeKeybindings();
      else showKeybindings("Worktrees");
      return;
    }
    if (state.activeTab === 3 && key.name === "?" && !key.ctrl && !key.meta) {
      key.preventDefault();
      if (state.keybindingsActive) closeKeybindings();
      else showKeybindings("Actions");
      return;
    }
    if (state.activeTab === 2 && key.name === "?" && !key.ctrl && !key.meta) {
      key.preventDefault();
      if (state.keybindingsActive) closeKeybindings();
      else showKeybindings("Collaboration");
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
        performAction(binding.action, binding);
        return;
      }
    }
    if (state.activeTab === 3 && !state.promptActive && !key.ctrl && !key.meta) {
      const keybindings = getKeybindings("Actions");
      const binding = keybindings[key.shift ? key.name.toUpperCase() : key.name]
        ?? (key.name === "return" ? keybindings.enter : undefined);
      if (binding) {
        key.preventDefault();
        performAction(binding.action, binding);
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
    worktreesPanel.dispose();
    actionsPanel.dispose();
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    renderer.destroy();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  updateTab(0);
}
