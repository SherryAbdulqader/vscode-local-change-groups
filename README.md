# Local Change Groups

Local Change Groups adds a private tree to VS Code's Source Control sidebar. It organizes changed files into named, colored groups such as **Local Only**, **Ready for GitHub**, or **Tests**, while keeping an **Ungrouped** section.

## Features

- Create, rename, recolor, and delete private groups.
- Assign, move, and remove changed files through tree menus or the Command Palette.
- Choose from eight theme-aware icon colors. A group's folder and member-file icons use the same color.
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

Group names, colors, and assignments are stored only in VS Code `workspaceState`. The extension does not add metadata files to the repository or change `.gitignore` or `.git/info`. It has no telemetry, webview, shell execution, runtime dependencies, or direct network client. Guarded group actions run only the Git executable path supplied by VS Code, using argument arrays and no shell; inherited `GIT_*` environment variables are removed. Network access occurs only when the user explicitly requests a push, which is performed by VS Code's built-in Git extension.

It is disabled in untrusted and virtual workspaces.

## Limitations

- This is a separate view; VS Code does not let extensions rearrange or color rows in the built-in **Changes** list.
- VS Code does not expose arbitrary tree-row background highlighting. Colors apply to group and member-file icons.
- A group is metadata, not a permanent Git staging area. Every Git action re-checks live repository state.
- Another process or Git hook can still edit repository state in the tiny interval between checks. Post-commit verification blocks push when the result differs and asks you to inspect it.
- Partially staged group files are blocked because their hunks cannot be safely reconstructed. Unrelated partial staging is allowed and preserved byte-for-byte in the index.
- **Commit & Push Group** supports only an already-configured upstream that is fully synchronized. It does not create branches, pull, resolve divergence, set upstreams, or force-push.
- Assignments are local to the current VS Code workspace and are not shared with teammates.
- Renames retain their group when the Git API reports the old path; unrelated moves may need reassignment.

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
npm test                     # 26 tests
npm run package              # -> dist/local-change-groups-<version>.vsix
npm run install-extension    # package, then install into VS Code
```

`npm run install-extension` runs `code --install-extension ... --force`, so it also
upgrades an already-installed copy. Reload the window afterwards, then open the
Source Control sidebar to find the **Local Change Groups** view. To remove it:

```text
npm run uninstall-extension
```

### What ships in the .vsix

`vscode:prepublish` compiles TypeScript first, and `.vscodeignore` restricts the
archive to runtime files only — the compiled `out/src/**` output, `package.json`,
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
