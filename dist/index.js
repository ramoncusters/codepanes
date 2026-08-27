import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import pty from "node-pty";
import { BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable, createCliRenderer, } from "@opentui/core";
const execFileAsync = promisify(execFile);
const MAX_TRANSCRIPT_LINES = 400;
async function getWorktrees(cwd) {
    try {
        const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
        const worktrees = [];
        let current = {};
        for (const line of stdout.split(/\r?\n/)) {
            if (line.startsWith("worktree ")) {
                if (current.path)
                    worktrees.push({ path: current.path, branch: current.branch ?? "(detached)" });
                current = { path: line.slice("worktree ".length) };
            }
            else if (line.startsWith("branch ") && current.path) {
                current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
            }
        }
        if (current.path)
            worktrees.push({ path: current.path, branch: current.branch ?? "(detached)" });
        return worktrees.length > 0 ? worktrees : [{ path: cwd, branch: path.basename(cwd) }];
    }
    catch {
        return [{ path: cwd, branch: path.basename(cwd) }];
    }
}
function stripAnsi(value) {
    return value
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\x1b[()][0-2A-Z]/g, "")
        .replace(/\r/g, "");
}
class Transcript {
    lines = [];
    pending = "";
    append(data) {
        this.pending += stripAnsi(data);
        const chunks = this.pending.split("\n");
        this.pending = chunks.pop() ?? "";
        this.lines.push(...chunks);
        if (this.lines.length > MAX_TRANSCRIPT_LINES) {
            this.lines = this.lines.slice(-MAX_TRANSCRIPT_LINES);
        }
        return this.lines.join("\n");
    }
    reset(message) {
        this.lines = [message];
        this.pending = "";
        return message;
    }
}
async function main() {
    const cwd = process.cwd();
    const worktrees = await getWorktrees(cwd);
    const renderer = await createCliRenderer({
        exitOnCtrlC: true,
        backgroundColor: "#0b1020",
        useMouse: true,
        clearOnShutdown: true,
    });
    const root = new BoxRenderable(renderer, {
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: "#0b1020",
    });
    const header = new BoxRenderable(renderer, {
        height: 3,
        padding: 1,
        backgroundColor: "#111a33",
        border: true,
        borderColor: "#2b3c68",
    });
    header.add(new TextRenderable(renderer, {
        content: " CODEPANES  |  worktrees + lazygit",
        fg: "#8be9fd",
    }));
    const body = new BoxRenderable(renderer, {
        flexGrow: 1,
        flexDirection: "row",
        gap: 1,
        padding: 1,
    });
    const sidebar = new BoxRenderable(renderer, {
        width: "32%",
        border: true,
        borderStyle: "rounded",
        borderColor: "#2b3c68",
        title: " Worktrees ",
        padding: 1,
    });
    const terminalPanel = new BoxRenderable(renderer, {
        flexGrow: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: "#2b3c68",
        title: " lazygit ",
        padding: 1,
    });
    const footer = new BoxRenderable(renderer, {
        height: 2,
        padding: 1,
        backgroundColor: "#111a33",
    });
    const footerText = new TextRenderable(renderer, {
        content: "↑/↓ select   Enter open   Tab focus terminal   Ctrl+W focus worktrees   Q quit",
        fg: "#aab7d8",
    });
    footer.add(footerText);
    const select = new SelectRenderable(renderer, {
        width: "100%",
        height: "100%",
        options: worktrees.map((worktree) => ({
            name: worktree.branch,
            description: worktree.path,
            value: worktree,
        })),
        showDescription: true,
        selectedBackgroundColor: "#24365f",
        selectedTextColor: "#ffffff",
    });
    sidebar.add(select);
    const transcript = new TextRenderable(renderer, {
        content: "Select a worktree and press Enter to start lazygit.",
        fg: "#d6deff",
        width: "100%",
        height: "100%",
        wrapMode: "none",
    });
    terminalPanel.add(transcript);
    body.add(sidebar);
    body.add(terminalPanel);
    root.add(header);
    root.add(body);
    root.add(footer);
    renderer.root.add(root);
    let currentPty = null;
    let terminalFocused = false;
    const transcriptState = new Transcript();
    const stopPty = () => {
        if (currentPty) {
            currentPty.kill();
            currentPty = null;
        }
    };
    const openWorktree = (worktree) => {
        stopPty();
        terminalFocused = true;
        transcript.content = transcriptState.reset(`Starting lazygit in ${worktree.path}...`);
        try {
            currentPty = pty.spawn("lazygit", [], {
                name: "xterm-256color",
                cols: Math.max(20, renderer.width - 34),
                rows: Math.max(8, renderer.height - 7),
                cwd: worktree.path,
                env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
            });
            currentPty.onData((data) => {
                transcript.content = transcriptState.append(data);
            });
            currentPty.onExit(({ exitCode }) => {
                currentPty = null;
                terminalFocused = false;
                transcript.content = transcriptState.append(`\n[lazygit exited with code ${exitCode}]`);
            });
        }
        catch (error) {
            terminalFocused = false;
            transcript.content = transcriptState.append(`\nUnable to start lazygit: ${String(error)}`);
        }
    };
    const focusWorktrees = () => {
        terminalFocused = false;
        select.focus();
        footerText.content = "↑/↓ select   Enter open   Tab focus terminal   Ctrl+W focus worktrees   Q quit";
    };
    const focusTerminal = () => {
        terminalFocused = true;
        footerText.content = "Terminal focused   Tab/Ctrl+W focus worktrees   Q quit";
    };
    select.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
        openWorktree(option.value);
        focusTerminal();
    });
    const onKeyPress = (key) => {
        if (key.name === "q" && !key.ctrl && !key.meta) {
            renderer.destroy();
            return;
        }
        if (key.name === "tab" || (key.name === "w" && key.ctrl)) {
            key.preventDefault();
            if (terminalFocused)
                focusWorktrees();
            else
                focusTerminal();
            return;
        }
        if (terminalFocused && currentPty && key.name !== "q") {
            currentPty.write(key.raw || key.sequence);
        }
    };
    const keyInput = renderer.keyInput;
    keyInput.addListener("keypress", onKeyPress);
    renderer.once("destroy", () => {
        keyInput.removeListener("keypress", onKeyPress);
        stopPty();
    });
    select.focus();
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
