import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { access, constants, readFile, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import pty from "node-pty";
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
} from "@opentui/core";

const execFileAsync = promisify(execFile);

type Worktree = { path: string; branch: string };
type TabName = "Worktrees" | "Lazygit" | "Global";
type Keybinding = { name: string; action: Action };
type Action = "select-worktrees" | "search-worktrees" | "create-worktree" | "delete-worktrees" | "edit-config";
type TabKeybindings = Partial<Record<TabName, Record<string, Keybinding>>>;
type Config = {
  globalKeybindings?: TabKeybindings;
  repositories?: Record<string, { keybindings?: TabKeybindings; postCreateActions?: string[] }>;
};
type KeyInputEvents = {
  addListener(event: "keypress", handler: (key: KeyEvent) => void): void;
  removeListener(event: "keypress", handler: (key: KeyEvent) => void): void;
};

async function getWorktrees(cwd: string): Promise<Worktree[]> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> = {};

    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)" });
        current = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("branch ") && current.path) {
        current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }

    }
    if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)" });
    return worktrees.length > 0 ? worktrees : [{ path: cwd, branch: path.basename(cwd) }];
  } catch {
    return [{ path: cwd, branch: path.basename(cwd) }];
  }
}

const configPath = path.join(homedir(), ".config", "codepanes", "config.json");

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as Config;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function saveConfig(config: Config): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function gitRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

async function bareRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  const commonDir = stdout.trim();
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
}

async function findLazygit(): Promise<string> {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (process.platform === "darwin") {
    pathEntries.push("/opt/homebrew/bin", "/usr/local/bin");
  }
  const candidates = [...new Set(pathEntries)].map((entry) => path.join(entry, "lazygit"));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }

  throw new Error("lazygit was not found in PATH. Install it with `brew install lazygit` or add it to PATH.");
}

async function findShell(): Promise<string> {
  const candidates = [process.env.SHELL, process.platform === "darwin" ? "/bin/zsh" : "/bin/sh"].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next shell candidate.
    }
  }
  throw new Error("No executable shell was found.");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig();
  const defaultKeybindings: Record<string, Keybinding> = {
    spacebar: { name: "Select worktrees", action: "select-worktrees" },
    "/": { name: "Filter worktrees", action: "search-worktrees" },
    n: { name: "Create worktree", action: "create-worktree" },
    d: { name: "Delete worktrees", action: "delete-worktrees" },
  };
  const defaultGlobalKeybindings: Record<string, Keybinding> = {
    C: { name: "Edit configuration", action: "edit-config" },
  };
  if (!config.globalKeybindings?.Global) {
    config.globalKeybindings = {
      ...config.globalKeybindings,
      Global: defaultGlobalKeybindings,
      Worktrees: config.globalKeybindings?.Worktrees ?? defaultKeybindings,
    };
    await saveConfig(config);
  }
  const repositoryRoot = await gitRoot(cwd);
  const repositoryConfig = config.repositories?.[repositoryRoot] ?? {};
  const getKeybindings = (tabName: TabName): Record<string, Keybinding> => ({
    ...defaultGlobalKeybindings,
    ...config.globalKeybindings?.Global,
    ...(tabName === "Worktrees" ? defaultKeybindings : {}),
    ...config.globalKeybindings?.[tabName],
    ...repositoryConfig.keybindings?.[tabName],
  });
  let worktrees = await getWorktrees(cwd);
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: "#0b1020",
    useMouse: true,
    clearOnShutdown: true,
    consoleMode: "disabled",
    openConsoleOnError: false,
  });

  const root = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: "#0b1020",
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

  const tabs = new TabSelectRenderable(renderer, {
    position: "absolute",
    // top: 1,
    left: 2,
    height: 1,
    width: 38,
    tabWidth: 18,
    options: [
      { name: "worktrees", description: "Choose a Git worktree" },
      { name: "lazygit", description: "Review the active worktree" },
    ],
    showDescription: false,
    showUnderline: true,
    selectedBackgroundColor: "transparent",
    selectedTextColor: "#ffffff",
    focusedBackgroundColor: "transparent",
    focusedTextColor: "#ffffff",
    zIndex: 5,
  });

  const body = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
  });
  const worktreePanel = new BoxRenderable(renderer, {
    paddingTop: 1,
    flexGrow: 1,
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: "#2b3c68",
  });
  const terminalPanel = new BoxRenderable(renderer, {
    paddingTop: 1,
    flexGrow: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: "#2b3c68",
    // title: " lazygit ",
  });
  const footer = new BoxRenderable(renderer, {
    height: 1,
    paddingLeft: 1,
    backgroundColor: "#111a33",
  });
  const footerText = new TextRenderable(renderer, {
    content: "↑/↓ move   Space select   / filter   n new   d delete   Enter open   Tab switch tabs   ? Keybindings   Q quit",
    fg: "#aab7d8",
  });
  footer.add(footerText);
  let configPty: pty.IPty | null = null;

  const promptPanel = new BoxRenderable(renderer, {
    position: "absolute",
    top: "25%",
    left: "15%",
    width: "70%",
    height: 7,
    border: true,
    borderStyle: "rounded",
    borderColor: "#8be9fd",
    backgroundColor: "#111a33",
    padding: 1,
    visible: false,
    zIndex: 10,
  });
  const promptLabel = new TextRenderable(renderer, { content: "" });
  const promptInput = new InputRenderable(renderer, {
    width: "100%",
    backgroundColor: "#0b1020",
    focusedBackgroundColor: "#18264a",
  });
  promptPanel.add(promptLabel);
  promptPanel.add(promptInput);
  root.add(promptPanel);

  const searchBar = new BoxRenderable(renderer, {
    height: 1,
    width: "100%",
    paddingLeft: 1,
    flexDirection: "row",
    flexShrink: 0,
    backgroundColor: "#111a33",
    visible: false,
  });
  const filterLabel = new TextRenderable(renderer, {
    content: "Filter: ",
    fg: "#aab7d8",
  });
  const searchInput = new InputRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: "#0b1020",
    focusedBackgroundColor: "#18264a",
  });
  searchBar.add(filterLabel);
  searchBar.add(searchInput);

  const keybindingsPanel = new BoxRenderable(renderer, {
    position: "absolute",
    top: "15%",
    left: "15%",
    width: "70%",
    height: "70%",
    border: true,
    borderStyle: "rounded",
    borderColor: "#8be9fd",
    backgroundColor: "#111a33",
    padding: 1,
    visible: false,
    zIndex: 20,
  });
  const keybindingsText = new TextRenderable(renderer, { content: "" });
  keybindingsPanel.add(keybindingsText);
  root.add(keybindingsPanel);

  const configEditorPanel = new BoxRenderable(renderer, {
    position: "absolute",
    top: "10%",
    left: "10%",
    width: "80%",
    height: "80%",
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: "#8be9fd",
    backgroundColor: "#111a33",
    padding: 1,
    visible: false,
    zIndex: 30,
  });
  const configInstructionsPanel = new BoxRenderable(renderer, {
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
  const configInstructionsText = new TextRenderable(renderer, {
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
      "repositories",
      "  Add a repository path to override bindings for that repository.",
      "  Repository keybindings use the same Global/Worktrees/Lazygit structure.",
      "  postCreateActions is a repository-only list of shell commands run in a new worktree.",
      "",
      "Available actions",
      "  select-worktrees, search-worktrees, create-worktree, delete-worktrees",
      "  edit-config",
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
  configInstructionsPanel.add(configInstructionsText);
  const configEditor = new EmbeddedTerminalRenderable(renderer, {
    flexGrow: 1,
    width: "100%",
    height: "100%",
    selectable: true,
    onData: (data, source) => {
      if (source === "input" && configPty) configPty.write(Buffer.from(data).toString());
    },
    onTerminalResize: (cols, rows) => {
      if (configPty) configPty.resize(Math.max(20, cols), Math.max(8, rows));
    },
  });
  configEditorPanel.add(configInstructionsPanel);
  configEditorPanel.add(configEditor);
  root.add(configEditorPanel);

  const select = new SelectRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    options: worktrees.map((worktree) => ({
      name: worktree.branch,
      description: worktree.path,
      value: worktree,
    })),
    showDescription: true,
    // selectedBackgroundColor: "#24365f",
    selectedTextColor: "#ffffff",
  });
  worktreePanel.add(select);
  worktreePanel.add(searchBar);
  const selectedWorktrees = new Set<string>();
  let searchActive = false;
  let promptActive = false;
  let keybindingsActive = false;
  let configEditorActive = false;
  let configInstructionsActive = false;
  let promptMode: "create" | "delete" | "delete-branches" | null = null;
  let pendingDeleteTargets: Worktree[] = [];

  const refreshWorktrees = async (): Promise<void> => {
    worktrees = await getWorktrees(cwd);
    const query = searchInput.value.toLowerCase();
    select.options = worktrees
      .filter((worktree) => `${worktree.branch} ${worktree.path}`.toLowerCase().includes(query))
      .map((worktree) => ({
        name: `${selectedWorktrees.has(worktree.path) ? "[x] " : ""}${worktree.branch}`,
        description: worktree.path,
        value: worktree,
      }));
  };

  const closePrompt = (): void => {
    promptActive = false;
    promptMode = null;
    promptPanel.visible = false;
    promptInput.blur();
    select.focus();
  };

  const closeKeybindings = (): void => {
    keybindingsActive = false;
    keybindingsPanel.visible = false;
    if (activeTab === 0) select.focus();
    else terminal.focus();
  };

  const closeConfigEditor = (): void => {
    if (configPty) {
      configPty.kill();
      configPty = null;
    }
    configEditorActive = false;
    configInstructionsActive = false;
    configInstructionsPanel.visible = false;
    configEditorPanel.visible = false;
    if (activeTab === 0) select.focus();
    else terminal.focus();
  };

  const openConfigEditor = async (): Promise<void> => {
    if (configEditorActive) return;
    configEditorActive = true;
    configInstructionsActive = false;
    configInstructionsPanel.visible = false;
    keybindingsPanel.visible = false;
    keybindingsActive = false;
    configEditorPanel.visible = true;
    select.blur();
    terminal.blur();
    configEditor.focus();
    await renderer.idle();
    if (renderer.isDestroyed || !configEditorActive) return;
    configEditor.write("\x1b[2J\x1b[3J\x1b[H");
    configPty = pty.spawn("vim", [configPath], {
      name: "vt100",
      cols: Math.max(20, configEditor.width),
      rows: Math.max(8, configEditor.height),
      cwd: repositoryRoot,
      env: { ...process.env, TERM: "vt100", COLORTERM: "" },
    });
    configPty.onData((data) => configEditor.write(data));
    configPty.onExit(() => {
      configPty = null;
      if (configEditorActive) closeConfigEditor();
    });
  };

  const showKeybindings = (tabName: TabName): void => {
    const bindings = { ...getKeybindings("Global"), ...getKeybindings(tabName) };
    const lines = Object.entries(bindings).map(([key, binding]) => {
      const displayKey = key === "spacebar" ? "Space" : key;
      return `${displayKey.padEnd(10)} ${binding.name}`;
    });
    keybindingsText.content = `${tabName} keybindings\n\n${lines.length > 0 ? lines.join("\n") : "No configured keybindings"}\n\nPress ? or Esc to close`;
    keybindingsActive = true;
    keybindingsPanel.visible = true;
    select.blur();
    terminal.blur();
  };

  const toggleConfigInstructions = (): void => {
    configInstructionsActive = !configInstructionsActive;
    configInstructionsPanel.visible = configInstructionsActive;
    if (configInstructionsActive) configEditor.blur();
    else configEditor.focus();
  };

  const openPrompt = (mode: "create" | "delete" | "delete-branches", label: string): void => {
    promptMode = mode;
    promptActive = true;
    promptLabel.content = label;
    promptInput.value = "";
    promptPanel.visible = true;
    select.blur();
    promptInput.focus();
  };

  let currentPty: pty.IPty | null = null;
  let terminalFocused = false;

  const focusTerminal = async (): Promise<void> => {
    if (renderer.isDestroyed || activeTab !== 1 || configEditorActive || keybindingsActive || promptActive || searchActive) {
      return;
    }
    await renderer.idle();
    terminal.focus();
    terminalFocused = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!renderer.isDestroyed && activeTab === 1 && !configEditorActive && !keybindingsActive && !promptActive && !searchActive) {
      terminal.focus();
      terminalFocused = true;
    }
  };

  const terminal = new EmbeddedTerminalRenderable(renderer, {
    width: "100%",
    height: "100%",
    selectable: true,
    onTerminalResize: (cols, rows) => {
      if (currentPty) currentPty.resize(Math.max(20, cols), Math.max(8, rows));
    },
    onData: (data, source) => {
      if (source === "input" && currentPty) {
        currentPty.write(Buffer.from(data).toString());
      }
    },
  });
  terminalPanel.add(terminal);
  body.add(worktreePanel);
  body.add(terminalPanel);
  // root.add(header);
  root.add(tabs);
  root.add(body);
  root.add(footer);
  renderer.root.add(root);

  const stopPty = (): void => {
    if (currentPty) {
      currentPty.kill();
      currentPty = null;
    }
  };

  const runPostCreateActions = async (worktreePath: string): Promise<void> => {
    for (const action of repositoryConfig.postCreateActions ?? []) {
      await execFileAsync("sh", ["-c", action], { cwd: worktreePath });
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
    await execFileAsync("git", args, { cwd: root });
    await runPostCreateActions(target);
    await refreshWorktrees();
    footerText.content = `Created ${branchName}`;
  };

  const deleteWorktrees = async (targets: Worktree[], deleteBranches: boolean): Promise<void> => {
    const root = await bareRoot(cwd);
    for (let index = 0; index < targets.length; index += 1) {
      footerText.content = `Deleting ${index + 1}/${targets.length}: ${targets[index].branch}`;
      await execFileAsync("git", ["worktree", "remove", "--force", targets[index].path], { cwd: root });
      if (deleteBranches && targets[index].branch !== "(detached)") {
        await execFileAsync("git", ["branch", "-D", targets[index].branch], { cwd: root });
      }
      selectedWorktrees.delete(targets[index].path);
    }
    await refreshWorktrees();
    footerText.content = `Deleted ${targets.length} worktree${targets.length === 1 ? "" : "s"}`;
  };

  let activeTab = 0;

  const updateTab = (index: number): void => {
    activeTab = index;
    worktreePanel.visible = index === 0;
    terminalPanel.visible = index === 1;

    if (index === 0) {
      terminalFocused = false;
      terminal.blur();
      if (!keybindingsActive) select.focus();
      footerText.content = "↑/↓ move   Space select   / filter   n new   d delete   C config   Enter open   Tab switch tabs   ? Keybindings   Q quit";
    } else {
      terminalFocused = true;
      select.blur();
      if (!keybindingsActive && !configEditorActive) {
        void focusTerminal();
      }
      footerText.content = "Lazygit focused   C config   Tab switch tabs   ? Keybindings   Q quit";
    }
  };

  const openWorktree = async (worktree: Worktree): Promise<void> => {
    stopPty();
    terminal.write("\x1b[2J\x1b[3J\x1b[H");
    await renderer.idle();
    if (renderer.isDestroyed) return;

    try {
      const lazygitPath = await findLazygit();
      const shellPath = await findShell();
      await access(worktree.path, constants.R_OK | constants.X_OK);
      try {
        await execFileAsync(lazygitPath, ["--version"], {
          cwd: worktree.path,
          env: { ...process.env, PATH: path.dirname(lazygitPath) + path.delimiter + (process.env.PATH ?? "") },
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(`lazygit preflight failed (${lazygitPath}, cwd ${worktree.path}): ${details}`);
      }
      currentPty = pty.spawn(shellPath, ["-lc", `exec ${shellQuote(lazygitPath)}`], {
        name: "xterm-256color",
        cols: Math.max(20, terminal.width),
        rows: Math.max(8, terminal.height),
        cwd: worktree.path,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      currentPty.onData((data) => {
        terminal.write(data);
      });
      currentPty.onExit(({ exitCode }) => {
        currentPty = null;
        terminalFocused = false;
        terminal.write(`\n[lazygit exited with code ${exitCode}]`);
      });
      terminalFocused = true;
      await renderer.idle();
      terminal.focus();
      await new Promise((resolve) => setTimeout(resolve, 25));
      terminal.focus();
    } catch (error) {
      terminalFocused = false;
      const details = String(error);
      const message = `Unable to start lazygit: ${details}`;
      footerText.content = message;
      terminal.write(`\n${message}\n`);
    }
  };

  select.on(SelectRenderableEvents.ITEM_SELECTED, async (_index, option) => {
    select.blur();
    tabs.setSelectedIndex(1);
    activeTab = 1;
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

  searchInput.on(InputRenderableEvents.INPUT, () => {
    void refreshWorktrees();
  });
  searchInput.on(InputRenderableEvents.ENTER, () => {
    searchActive = false;
    searchBar.visible = true;
    searchInput.blur();
    select.focus();
    void refreshWorktrees();
  });
  promptInput.on(InputRenderableEvents.ENTER, () => {
    const value = promptInput.value.trim();
    const mode = promptMode;
    closePrompt();
    if (mode === "create") {
      void createWorktree(value).catch((error: unknown) => {
        footerText.content = `Unable to create worktree: ${String(error)}`;
      });
    } else if (mode === "delete") {
      if (value.toLowerCase() !== "y") return;
      pendingDeleteTargets = worktrees.filter((worktree) => selectedWorktrees.has(worktree.path));
      openPrompt(
        "delete-branches",
        `Delete related branches too? Type y or n: ${pendingDeleteTargets.map((item) => item.branch).join(", ")}`,
      );
    } else if (mode === "delete-branches") {
      if (value.toLowerCase() !== "y" && value.toLowerCase() !== "n") {
        footerText.content = "Please type y or n to choose whether to delete related branches.";
        openPrompt(
          "delete-branches",
          `Delete related branches too? Type y or n: ${pendingDeleteTargets.map((item) => item.branch).join(", ")}`,
        );
        return;
      }
      const deleteBranches = value.toLowerCase() === "y";
      const targets = pendingDeleteTargets;
      pendingDeleteTargets = [];
      void deleteWorktrees(targets, deleteBranches).catch((error: unknown) => {
        footerText.content = `Unable to delete worktrees: ${String(error)}`;
      });
    }
  });

  const selectedTarget = (): Worktree | undefined =>
    (select.getSelectedOption()?.value as Worktree | undefined);

  const performAction = (action: Action): void => {
    if (promptActive || keybindingsActive) return;
    if (action === "edit-config") {
      void openConfigEditor().catch((error: unknown) => {
        configEditorActive = false;
        configEditorPanel.visible = false;
        footerText.content = `Unable to edit configuration: ${String(error)}`;
        if (activeTab === 0) select.focus();
        else terminal.focus();
      });
      return;
    }
    if (activeTab !== 0) return;
    if (action === "select-worktrees") {
      const target = selectedTarget();
      if (target) {
        if (selectedWorktrees.has(target.path)) selectedWorktrees.delete(target.path);
        else selectedWorktrees.add(target.path);
        void refreshWorktrees();
      }
    } else if (action === "search-worktrees") {
      searchActive = true;
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
        pendingDeleteTargets = targets;
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
    if (configEditorActive) {
      if (key.name === "?" || (configInstructionsActive && key.name === "escape")) {
        key.preventDefault();
        toggleConfigInstructions();
      }
      return;
    }
    if (!configEditorActive && key.name === "q" && !key.ctrl && !key.meta) {
      renderer.destroy();
      return;
    }
    if (!configEditorActive && key.name === "tab") {
      key.preventDefault();
      const nextTab = activeTab === 0 ? 1 : 0;
      tabs.setSelectedIndex(nextTab);
      updateTab(nextTab);
      return;
    }
    const globalBinding = !configEditorActive
      ? getKeybindings("Global")[key.shift ? key.name.toUpperCase() : key.name]
      : undefined;
    if (globalBinding && !key.ctrl && !key.meta) {
      key.preventDefault();
      performAction(globalBinding.action);
      return;
    }
    if (key.name === "?" && !key.ctrl && !key.meta) {
      key.preventDefault();
      if (keybindingsActive) closeKeybindings();
      else showKeybindings(activeTab === 0 ? "Worktrees" : "Lazygit");
      return;
    }
    if (keybindingsActive && key.name === "escape") {
      key.preventDefault();
      closeKeybindings();
      return;
    }
    if (activeTab === 0 && !promptActive && !searchActive && !key.ctrl && !key.meta) {
      const keybindings = getKeybindings("Worktrees");
      const binding = keybindings[key.name] ?? (key.name === "space" ? keybindings.spacebar : undefined);
      if (binding) {
        key.preventDefault();
        performAction(binding.action);
        return;
      }
    }
    if (searchActive && key.name === "escape") {
      key.preventDefault();
      searchActive = false;
      searchBar.visible = true;
      searchInput.blur();
      select.focus();
      void refreshWorktrees();
      return;
    }
    if (promptActive && key.name === "escape") {
      key.preventDefault();
      closePrompt();
      return;
    }
  };
  const keyInput = renderer.keyInput as unknown as KeyInputEvents;
  keyInput.addListener("keypress", onKeyPress);
  renderer.once("destroy", () => {
    keyInput.removeListener("keypress", onKeyPress);
    stopPty();
    if (configPty) configPty.kill();
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    renderer.destroy();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  updateTab(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
