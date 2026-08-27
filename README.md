# CodePanes

CodePanes is a terminal workspace for switching between Git worktrees and opening
the matching `lazygit` session without leaving the keyboard.

Quickstart:

1. cd codepanes
2. npm install
3. npm run dev

Codepanes uses Node.js 26.4 or later. `npm run dev` builds the TypeScript
source and starts the compiled OpenTUI application with Node.js.

`lazygit` must be installed and available in `PATH`.

Controls: use `Up`/`Down` and `Enter` to open a worktree, `Tab` or `Ctrl+W` to
switch focus, and `Q` to quit.
