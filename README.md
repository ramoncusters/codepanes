# CodePanes

CodePanes is a terminal workspace for switching between Git worktrees and opening
the matching `lazygit` session without leaving the keyboard.

Quickstart:

1. cd codepanes
2. npm install
3. npm run dev

Codepanes uses Node.js 26.4 or later. `npm run dev` builds the TypeScript
source and starts the compiled OpenTUI application with Node.js. In development,
it watches `src/`, rebuilds after changes, and restarts the TUI process. This is
process-level hot reload rather than in-process HMR; the terminal and child PTYs
are cleaned up before each restart.

`lazygit` must be installed and available in `PATH`.

Controls: use `Up`/`Down` and `Enter` to open a worktree, `Tab` to switch
between the Worktrees and Lazygit tabs, and `Q` to quit.

User configuration is stored in `~/.config/codepanes/config.json`. Keybindings
are nested by tab name, can be global or scoped to a repository, and each
binding has a display `name`. Press `?` on the Worktrees tab to view its bindings.
The `Global` bindings apply on every tab. On the Lazygit tab, `?` is passed
through to Lazygit rather than opening CodePanes keybinding help.

The Lazygit and configuration-editor panes configure their embedded terminal
emulators with the host terminal's detected 16-color ANSI palette and default
foreground/background. This keeps embedded programs aligned with the terminal
emulator's theme. Lazygit runs in indexed 256-color mode so its colors honor
that palette instead of using fixed truecolor values. If the emulator does not
support palette queries, CodePanes falls back to its built-in dark background.

Repository-specific commands can run after creating a worktree:

```json
{
  "globalKeybindings": {
    "Global": {
      "C": { "name": "Edit configuration", "action": "edit-config" }
    },
    "Worktrees": {
      "spacebar": { "name": "Select worktrees", "action": "select-worktrees" },
      "/": { "name": "Filter worktrees", "action": "search-worktrees" },
      "n": { "name": "Create worktree", "action": "create-worktree" },
      "d": { "name": "Delete worktrees", "action": "delete-worktrees" }
    },
    "Lazygit": {}
  },
  "repositories": {
    "/path/to/repository": {
      "keybindings": {
        "Worktrees": {},
        "Lazygit": {}
      },
      "postCreateActions": ["npm install"]
    }
  }
}
```

Creating a worktree accepts names in the `<type>/<name>` format. Selected
worktrees are used as the base branch; when none are selected, `main` is used.
