# Local Change Groups

Local Change Groups adds a private tree in its own Activity Bar container. It organizes changed files into named, colored groups such as **Local Only**, **Ready for GitHub**, or **Tests**, while keeping an **Ungrouped** section.

Prefer it beside the built-in **Changes** list? Drag the view's title onto the Source Control icon — VS Code remembers view placement per workspace, so it stays there.

## Features

- Create, rename, recolor, and delete private groups.
- Drag files onto a group to assign them, onto **Ungrouped** to remove them, or onto a file row to join that row's group. Files dragged in from the Explorer or the built-in **Changes** list work too.
- Select many files with `Ctrl`/`Shift` and assign, move, or remove them in one action, or turn the selection straight into a new group.
- Read file rows the way you read the built-in **Changes** list: file-theme icon, file name, dim folder path, and a single-letter status badge (`M`, `A`, `D`, `R`, `U`, `C`) in the matching Git color.
- Assign, move, and remove changed files through tree menus or the Command Palette.
- Choose from eight theme-aware colors for group dots. Set `localChangeGroups.fileColors` to `group` to tint file rows by their group instead of by Git status.
- Commit from a Source Control style box at the top of the view: pick a group, type a message, press `Ctrl+Enter`. Drafts are kept per group.
- See a count of changed files on the Activity Bar icon.
- Split into **Staged Changes** and **Changes** the moment anything is staged, with your groups nested under each; the split disappears again when the index is clean.
- Discard a whole group or any selection of files, behind a modal that states reverts and permanent deletions separately.
- Stage one group, commit one group, or commit and push one group with safety checks.
- Open tracked changes in VS Code's Git diff and untracked files in the editor.
- Refresh automatically from VS Code's built-in Git extension.
- Keep independent assignments for files in multiple open repositories.

## Safe group Git actions

Git actions use the public `vscode.git` API and preserve working-tree changes outside the selected group. Before staging, the extension requires:

- a named, non-empty group scoped to one repository;
- no conflicts, merge, or rebase in progress;
- no partially staged files inside the selected group; unrelated staged hunks are preserved;
- every path to resolve inside that repository.

Renames stage both paths and keep their group through the old-path assignment. The extension snapshots exact unrelated index records and verifies that they remain unchanged. If a pre-commit step fails, it unstages only group paths newly staged by this action, and only while the captured branch and HEAD are unchanged.

**Commit Group** uses Git's path-scoped `commit --only` behavior, so staged files and staged hunks outside the group stay in the index without being unstaged or reconstructed. **Commit & Push Group** additionally requires a configured upstream and a branch known to be neither ahead nor behind. It revalidates after confirmation, requires exactly one direct child commit containing exactly the group paths, and pushes an explicit local-to-upstream refspec. It never force-pushes or sets an upstream.

If a push fails, the commit remains local. The extension reports this clearly so it can be pushed after the remote problem is resolved.

## Privacy

Group names, colors, and assignments are stored only in VS Code `workspaceState`. The extension does not add metadata files to the repository or change `.gitignore` or `.git/info`. It has no telemetry, shell execution, runtime dependencies, or direct network client.

The commit panel is the extension's only webview. Its Content Security Policy is `default-src 'none'` with a per-render nonce for its own inline style and script, and it declares no `localResourceRoots`, so it cannot load anything from disk or the network. It exchanges only group names, colors, file counts, the current branch name, and the message you type; every action it requests is re-validated in the extension host before any Git command runs. Guarded group actions run only the Git executable path supplied by VS Code, using argument arrays and no shell; inherited `GIT_*` environment variables are removed. Network access occurs only when the user explicitly requests a push, which is performed by VS Code's built-in Git extension.

It is disabled in untrusted and virtual workspaces.

## Limitations

- This is a separate view; VS Code does not let extensions rearrange or color rows in the built-in **Changes** list.
- VS Code does not expose arbitrary tree-row background highlighting. Colors apply to the group dot and, when `localChangeGroups.fileColors` is `group`, to file rows.
- A group is metadata, not a permanent Git staging area. Every Git action re-checks live repository state.
- Another process or Git hook can still edit repository state in the tiny interval between checks. Post-commit verification blocks push when the result differs and asks you to inspect it.
- Partially staged group files are blocked because their hunks cannot be safely reconstructed. Unrelated partial staging is allowed and preserved byte-for-byte in the index.
- **Commit & Push Group** supports only an already-configured upstream that is fully synchronized. It does not create branches, pull, resolve divergence, set upstreams, or force-push.
- Assignments are local to the current VS Code workspace and are not shared with teammates.
- Renames retain their group when the Git API reports the old path; unrelated moves may need reassignment.
- VS Code gives a tree row one click target, so the group color dot cannot be clicked on its own. Recolor from the palette button on the row or the context menu.
- Discard acts on working-tree changes only. A file staged with no further edit is left alone rather than being unstaged.

## Development

```text
npm install
npm test
```

Press `F5` in VS Code after compiling to open an Extension Development Host.

## Packaging and local installation

The build is reproducible from a clean checkout with Microsoft's official
[`@vscode/vsce`](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) tool,
which is pinned as a dev dependency:

```text
npm install
npm test                     # 46 tests
npm run package              # -> dist/local-change-groups-<version>.vsix
npm run install-extension    # package, then install into VS Code
```

`npm run install-extension` runs `code --install-extension ... --force`, so it also
upgrades an already-installed copy. Reload the window afterwards, then click the
**Local Change Groups** icon in the Activity Bar. To remove it:

```text
npm run uninstall-extension
```

### What ships in the .vsix

`vscode:prepublish` compiles TypeScript first, and `.vscodeignore` restricts the
archive to runtime files only — the compiled `out/src/**` output, `resources/`, `package.json`,
`README.md`, `CHANGELOG.md`, and `LICENSE`. Sources, tests, compiled tests, source
maps, `tsconfig.json`, `node_modules/`, `package-lock.json`, and repository metadata
are all excluded. The extension declares no runtime dependencies, so nothing from
`node_modules/` is bundled. Verify a build with:

```text
npx vsce ls
```

### Publishing to the Marketplace

Publishing is a separate step and is intentionally not automated here: it requires an
Azure DevOps publisher account for `sherryabdulqader` and a Personal Access Token with
**Marketplace → Manage** scope. With that token available, publish with
`npx vsce publish` (or upload `dist/local-change-groups-<version>.vsix` through the
Marketplace publisher portal). Never commit the token.
