---
applyTo: "src/**/*.ts"
---

## Architecture

Keep concerns separated:

- `src/components/` contains OpenTUI renderables and UI controllers.
- `src/services/` contains Git, filesystem, PTY, and terminal integration.
- `src/app/` contains application state, composition, and event coordination.
- Keep `src/main.ts` limited to startup, renderer creation, and shutdown.
- Prefer OpenTUI Core's imperative retained-renderable API.
- Create renderables once and mutate their state instead of rebuilding the tree.
- Components that own PTYs, listeners, or timers must own their cleanup.
- Keep `EmbeddedTerminalRenderable` integration in Core components; do not assume
  React or Solid support.
