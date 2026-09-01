# Local Change Groups

Local Change Groups adds a read-only tree to VS Code's Source Control sidebar. It lets you privately organize changed files into named groups such as **Local Only**, **Ready for GitHub**, or **Tests** while keeping an **Ungrouped** section.

## Features

- Creates, renames, and deletes private groups.
- Assigns, moves, and removes changed files through tree menus or the Command Palette.
- Shows working-tree, staged, merge, and status labels with VS Code theme colors.
- Opens tracked changes in VS Code's Git diff and untracked files in the editor.
- Refreshes when VS Code's built-in Git extension reports a repository change.
- Supports multiple open Git repositories.

## Privacy and safety

Group names and assignments are stored only in VS Code `workspaceState`. The extension does not create repository files or modify `.gitignore`, `.git/info`, the index, commits, branches, or remotes.

The extension has:

- no Git mutation commands;
- no filesystem writes;
- no shell or child processes;
- no network requests or telemetry;
- no webviews;
- no runtime dependencies.

It is disabled in untrusted and virtual workspaces.

## Limitations

- This is a separate view; VS Code does not allow extensions to rearrange the built-in **Changes** list.
- Groups are organizational labels, not Git staging areas. Use VS Code's built-in Git controls to stage and commit.
- Assignments are local to the current VS Code workspace and are not shared with teammates.
- A renamed or moved file may need to be assigned again because assignments use its repository-relative path.

## Development

```text
npm install
npm test
```

Press `F5` in VS Code after compiling to open an Extension Development Host.
