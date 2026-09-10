# Local Change Groups

Sort your changed files into named, colored groups. Then commit one group at a time, and leave the rest of your work alone.

It lives in its own icon in the Activity Bar. Nothing it does is written into your repository.

---

## The problem it solves

You sat down to fix one bug. Four hours later you have changed eleven files: the actual fix, two experiments, a typo you spotted, and some debug logging you definitely do not want to push.

Git shows you one flat list. This shows you your list.

```
LOCAL CHANGE GROUPS
├─ Frozen
│  └─ 🔒 Login fix               3   ← reviewed and parked, out of the way
├─ Staged Changes                2
│  └─ 🚀 Ready to ship           2
└─ Changes                       6
   ├─ 🧪 Tests                   2   ← auto-filed by a rule
   ├─ 🔒 Local only              3   ← debug logging, never leaves your machine
   └─ Ungrouped                  1
```

---

## Getting started

1. Click the **Local Change Groups** icon in the Activity Bar.
2. Press **+** to make a group. Give it a name and a color.
3. Drag files onto it. Or right-click a file and choose **Assign or Move Files**.
4. Right-click the group and choose **Commit Group**.

Only that group gets committed. Everything else stays exactly as it was.

---

## Features

### Groups

| What | How |
| --- | --- |
| Make a group | **+** in the view title |
| Rename, recolor, change icon | Right-click the group |
| Delete a group | Right-click the group. Its files go back to Ungrouped; nothing on disk changes |
| Reorder groups | Drag a group onto another one, or right-click → **Move Group Up** / **Move Group Down** |
| Sort groups A–Z | View title menu → **Sort Groups by Name** |

Pick from **eight theme-aware colors** and **sixteen icons** — a beaker for Tests, a lock for Local Only, a rocket for what is ready to ship. Or type any VS Code codicon id. Emoji work too: just put one in the group name.

### Filing files

| What | How |
| --- | --- |
| One file, or a selection | Drag it, or right-click → **Assign or Move Files** |
| Everything at once | Click the **→** on the **Ungrouped** row |
| Straight into a new group | Select some files → right-click → **New Group from Selection** |
| Take a file back out | Right-click → **Remove Files from Group**, or drag it onto Ungrouped |

Select many files with `Ctrl` or `Shift` and every one of these acts on the whole selection. You can also drag files in from the Explorer or from the built-in **Changes** list.

### Auto-assign by path

Tell it once where things go, and stop filing them by hand. Put this in your settings:

```json
"localChangeGroups.autoAssign": {
  "test/**": "Tests",
  "**/*.test.ts": "Tests",
  "docs/**": "Docs",
  "**/*.{css,scss}": "Styling"
}
```

Now every test file you touch lands in **Tests** on its own. Groups named in the rules are created for you if they do not exist yet.

**How patterns match:**

| Pattern | Means | Matches |
| --- | --- | --- |
| `*.md` | no slash → the **file name**, anywhere | `readme.md`, `docs/deep/readme.md` |
| `docs/*.md` | has a slash → the **whole path** from the repo root | `docs/readme.md` but not `other/readme.md` |
| `test/**` | `**` is any number of folders | `test/a.ts`, `test/deep/b.ts` |
| `**/*.test.ts` | `**/` also matches **no** folder at all | `a.test.ts` and `src/a.test.ts` |
| `src/*.ts` | one `*` stays inside one folder | `src/a.ts` but not `src/deep/a.ts` |
| `**/*.{css,scss}` | `{a,b}` is either one | `a.css`, `src/a.scss` |

The **first** matching rule wins, reading top to bottom in your settings file. No specificity contest to work out in your head — if you want `src/api/**` to beat `src/**`, put it above it.

**Two things it will never do:**

- **Overrule you.** Only files that are not in a group get picked up.
- **Fight you.** Take a file back out of the group a rule chose, and it stays out. It is not filed again on the next save.

Changed your rules and want them applied to what is already on screen? View title menu → **Apply Auto-Assign Rules Now**.

### Freeze a group

Freezing parks a change. It behaves like a stash, except nothing moves on disk and you can still read it.

Finish a piece of work, drop those files in a group, and freeze it. The files leave **Changes** and **Ungrouped** and sit in their own **Frozen** section. Click any frozen row and you see exactly the diff you reviewed, served from the snapshot rather than from Git.

**Keep editing a frozen file** and the new part comes back into **Changes**, marked *since freeze* and diffed against the frozen copy. The reviewed change stays parked above; only the new work shows up below.

Two things always stay visible, on purpose:

- Files you have **staged**
- Files in **conflict**

That is what your next commit contains. Hiding it would be a good way to commit something you did not mean to.

| Command | What it does |
| --- | --- |
| **Freeze Group** | Captures the group as it is now |
| **Unfreeze Group** | Releases it, and names every file that changed while it was parked |
| **Update Freeze to Current** | Re-captures in place, for when one more fix belongs with it |
| **Compare Frozen with Current** | Diffs the snapshot against the live file |
| **Commit Group Since Freeze** | Commits only what changed after the freeze |
| **Unfreeze All Groups** | Appears in the view title menu only while something is frozen |

Snapshots are stored as content-addressed blobs in the extension's own storage folder, never inside `.git`. Binary files are skipped, since there is nothing to show in a diff.

### Share a layout

Grouping is private to your machine, which is the right default. But sometimes a layout is worth sharing — a review split, or a house convention for where things go.

| Command | What it does |
| --- | --- |
| **Export Group Layout...** | Writes your groups and their files to a JSON file |
| **Import Group Layout...** | Reads one back in |

The file is small, readable, and safe to commit:

```json
{
  "version": 1,
  "groups": [
    { "name": "Tests", "color": "green", "icon": "beaker" }
  ],
  "files": {
    "test/login.test.ts": "Tests"
  }
}
```

It records **repository-relative paths** and refers to groups **by name**, because absolute paths and local group ids mean nothing on anyone else's machine.

On import:

- Groups you already have are **reused by name**, keeping their own color and icon.
- Groups you do not have are **created**.
- Files listed in the file **move** into the group it names.
- Anything not listed **keeps** the group it is in now.
- **No files on disk are touched.** Ever.

Frozen snapshots are deliberately not exported. They are megabytes of your file contents, and they are about your afternoon rather than about how your team organises work.

### Commit one group

| Command | What it does |
| --- | --- |
| **Stage Group** | Stages only that group |
| **Unstage Group** | Takes it back out of the index, working tree untouched |
| **Commit Group** | Commits only that group |
| **Commit & Push Group** | Commits and pushes it, behind a confirmation naming the group and branch |
| **Discard All Changes in Group** | Throws the group's working-tree changes away, behind a modal |

There is also a commit box at the top of the view, like the one in Source Control: pick a group, type a message, press `Ctrl+Enter`. Unsent messages are kept per group.

### Reading the tree

- File rows look like the built-in **Changes** list: file icon, name, dim folder path, and a status letter (`M`, `A`, `D`, `R`, `U`, `C`) in the usual Git color.
- The Activity Bar icon carries a count of changed files.
- **Staged Changes** and **Changes** split apart the moment anything is staged, with your groups under each. The split disappears again when the index is clean.
- Every open repository keeps its own assignments.

---

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `localChangeGroups.autoAssign` | `{}` | Globs to group names. See [Auto-assign by path](#auto-assign-by-path) |
| `localChangeGroups.fileColors` | `status` | `status` colors file rows by Git status; `group` colors them by their group |

---

## How the Git actions stay safe

Every Git action goes through the public `vscode.git` API and leaves everything outside the chosen group alone. Before staging, it insists on:

- a named, non-empty group in **one** repository;
- no conflict, merge, or rebase in progress;
- no partially staged files **inside** the group — unrelated staged hunks are preserved;
- every path resolving inside that repository.

A few specifics worth knowing:

- **Renames** stage both paths and keep their group through the old path.
- **Unrelated staged work** is snapshotted exactly and checked afterwards to confirm it did not move.
- **If a pre-commit hook fails**, only the group paths this action newly staged are unstaged — and only while the branch and HEAD are still where they were.
- **Commit Group** uses Git's own `commit --only`, so staged files and staged hunks outside the group stay in the index untouched, rather than being unstaged and rebuilt.
- **Commit & Push Group** needs an upstream that is neither ahead nor behind. It re-checks after you confirm, requires exactly one child commit containing exactly the group's paths, and pushes an explicit local-to-upstream refspec. It never force-pushes and never sets an upstream.
- **If a push fails**, the commit is still there locally, and the message says so.

---

## Privacy

**Nothing goes into your repository.** Group names, colors, icons, order, and assignments live in VS Code's `workspaceState`. No metadata files, no changes to `.gitignore` or `.git/info`.

- No telemetry.
- No shell execution — Git runs with argument arrays, and inherited `GIT_*` variables are stripped.
- No runtime dependencies.
- No network client. The only network access is a push you explicitly asked for, performed by VS Code's own Git extension.

The commit box is the extension's only webview. Its Content Security Policy is `default-src 'none'` with a per-render nonce, and it declares no `localResourceRoots`, so it can load nothing from disk or the network. It exchanges only group names, colors, file counts, the branch name, and the message you type — and every action it asks for is re-validated in the extension host before any Git command runs.

The extension is disabled in untrusted and virtual workspaces.

---

## Limitations

**Things VS Code does not let an extension do:**

- Rearrange or color rows in the built-in **Changes** list. That is why this is a separate view.
- Set arbitrary row backgrounds. Color applies to the group icon and, with `fileColors` set to `group`, to file rows.
- Give a row two click targets, so the group's color dot cannot be clicked on its own. Recolor from the palette button on the row instead.

**Things about the design:**

- A group is metadata, not a permanent staging area. Every Git action re-checks live repository state.
- Another process or a Git hook can still change the repository in the moment between checks. Post-commit verification blocks the push when the result differs and asks you to look.
- Partially staged files inside a group are refused, because their hunks cannot be safely rebuilt. Unrelated partial staging is fine and is preserved byte for byte.
- **Commit & Push Group** works only with an upstream that is already set up and in sync. It will not create branches, pull, resolve divergence, set upstreams, or force-push.
- **Discard** touches working-tree changes only. A file staged with no further edit is left alone rather than being unstaged.
- Renames keep their group when the Git API reports the old path. Unrelated moves may need refiling.
- A freeze belongs to the repository it was taken in. With several open, the same group is an ordinary live group in the others.

---

## Development

```text
npm install
npm test
```

Press `F5` in VS Code to open an Extension Development Host.

The source is layered — see [ARCHITECTURE.md](ARCHITECTURE.md). The short version: `core/` and `data/` never import `vscode`, which is what lets the whole test suite run under plain `node --test` with no editor.

## Packaging and local installation

Built with Microsoft's official [`@vscode/vsce`](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), pinned as a dev dependency so it is reproducible from a clean checkout:

```text
npm install
npm test                     # 128 tests
npm run package              # -> dist/local-change-groups-<version>.vsix
npm run install-extension    # package, then install into VS Code
npm run uninstall-extension  # remove it again
```

`install-extension` passes `--force`, so it upgrades a copy you already have. **Reload the window afterwards**, then click the **Local Change Groups** icon in the Activity Bar.

### What ships in the .vsix

`vscode:prepublish` compiles first, and `.vscodeignore` cuts the archive down to runtime files only: the compiled `out/src/**`, `resources/`, `package.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`.

Left out: sources, tests, compiled tests, source maps, `tsconfig.json`, `node_modules/`, `package-lock.json`, build scripts, and repository metadata. The extension declares no runtime dependencies, so nothing is bundled from `node_modules/`. Check any build with:

```text
npx vsce ls
```

### Publishing to the Marketplace

Deliberately not automated. It needs an Azure DevOps publisher account for `sherryabdulqader` and a Personal Access Token with **Marketplace → Manage** scope. With that in place, `npx vsce publish` — or upload the `.vsix` through the publisher portal. Never commit the token.
