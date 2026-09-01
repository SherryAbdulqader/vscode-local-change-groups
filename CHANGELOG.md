# Changelog

All notable changes to the Local Change Groups extension are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added
- Theme-aware group colors (blue, green, yellow, orange, purple, pink, red, gray)
  contributed as VS Code color tokens, plus a **Change Group Color** command.
- Scoped publishing: **Stage Group**, **Commit Group**, and **Commit & Push Group**
  act on exactly the files assigned to one group and leave every other change
  in the working tree and index untouched.
- Modal confirmation before a push, showing the group and target branch.
- Rollback of extension-owned paths only when a Git hook rejects a group commit.

## [0.1.0]

### Added
- Local change groups persisted per workspace in `workspaceState`, so grouping
  never touches the repository or its history.
- SCM view listing working-tree, staged, partially staged, and merge changes,
  grouped by assignment with an **Ungrouped** bucket.
- Create, rename, and delete groups; assign, move, and remove files.
- Open a change as a diff (or as a file for untracked changes).
- Rename tracking, so an assignment survives a file being renamed.
