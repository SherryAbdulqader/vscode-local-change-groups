# Architecture

Six layers. Dependencies flow one way only, and there are no import cycles.

```
core/  ──▶  data/  ──▶  view/  ──▶  services/  ──▶  commands/  ──▶  extension.ts
  └────────▶ git/  ─────────┘                │                 │
                                             └── uses view ────┘
```

## The rule that matters

**`core/` and `data/` never import `vscode`.**

That is not a style preference — it is what makes the test suite possible. Tests
run under plain `node --test` with no VS Code host, so every module those tests
touch must load without one. Anything placed in `core/` is therefore directly
testable, and the pressure to keep logic there is deliberate.

`core/changes.ts` does reference `GitRepository`, but through `import type`,
which TypeScript erases. Verify at any time:

```bash
npm run compile
grep -r 'require(' out/src/core out/src/data     # only ./siblings and node: builtins
```

## Layers

### `core/` — pure domain, no VS Code

| Module | Responsibility |
| --- | --- |
| `groups.ts` | What a group is: colors, icons, name and icon validation |
| `persistence.ts` | The stored shape, and the guard that re-validates it on load |
| `repositoryPaths.ts` | Absolute paths → stable assignment keys (Windows casing lives here) |
| `changes.ts` | Reads Git's four change lists into one deduplicated view |
| `sections.ts` | The Staged Changes / Changes split |
| `changeLabels.ts` | Status letters, labels, and theme color **ids** |
| `discardPlan.ts` | What a discard would restore, delete, or skip |
| `text.ts` | Shared counting, error, and uri-list helpers |

Colors are returned as theme *ids* rather than `vscode.ThemeColor` objects
specifically so this layer stays host-free; the view wraps them.

### `data/` — persistence

`groupStore.ts` owns group metadata in `workspaceState`. Writes are serialized
through one queue and only published to memory after storage succeeds, so a
failed write cannot leave the UI showing state that was never saved. Bulk methods
exist so assigning fifty files is one persisted write, not fifty.

### `git/` — the repository

`api.ts` is the typed surface of VS Code's built-in Git extension.
`runner.ts` executes the Git binary with argument arrays, no shell, and inherited
`GIT_*` variables stripped. `groupOperations.ts` holds the guarded stage / commit /
push logic, its index snapshotting, and the per-repository lock.

### `view/` — what the user sees

`nodes.ts` defines the four row kinds. `treeItems.ts` renders a node into a
`TreeItem` and nothing else. `changeTree.ts` supplies contents and owns the two
performance measures: Git events are debounced, and changes are bucketed by group
once per repaint and cached. `decorations.ts` paints status badges on a private
URI scheme so they never leak into the Explorer. `commitPanel/` splits into
`protocol.ts` (the validated message contract), `document.ts` (the page), and
`provider.ts` (the plumbing).

### `services/` — the Git actions

`changeActions.ts` is the only place repository state changes. It owns the
confirmations, the repository lock, and the result messages. Both the menus and
the commit panel call these same functions, so an action behaves identically no
matter how it started — the panel cannot reach a shortened path.

### `commands/` — user-facing flows

Each command resolves *what* to act on, gathers any input, and delegates.
`prompts.ts` holds every quick pick and input box. `selection.ts` works out which
rows an invocation targets. `context.ts` carries the shared objects and wraps
every registration so a failure is always logged and shown — VS Code discards
rejected command promises silently.

### `extension.ts` — composition root

Builds the pieces, wires them, registers them for disposal. No behavior.

## Where to add things

| Change | Goes in |
| --- | --- |
| A rule, a format, a calculation | `core/` — and write a test |
| A new stored field | `core/groups.ts` + `core/persistence.ts` + `data/groupStore.ts` |
| A new row kind or row styling | `view/nodes.ts`, `view/treeItems.ts` |
| A new Git operation | `services/changeActions.ts`, called from `commands/` |
| A new menu entry | `commands/` + the `package.json` contribution |

Tests mirror `src/`: `test/core/`, `test/data/`, `test/git/`.
