# Changelog

All notable changes to the Local Change Groups extension are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0]

### Added
- A dedicated Activity Bar container with its own icon, so the view no longer
  shares the Source Control sidebar with the built-in **Changes** list. The view
  can still be dragged back into Source Control, or into the secondary side bar
  or panel, and VS Code remembers where you put it.
- Drag and drop: drag one or more files onto a group to assign them, onto
  **Ungrouped** to remove them, or onto any file row to join that row's group.
  Files dragged in from the Explorer or the built-in **Changes** list are matched
  against known changes and assigned the same way.
- Multi-select: the view enables `canSelectMany`, and **Assign or Move Files** and
  **Remove Files from Group** act on the whole selection. Choosing the command from
  a row outside the selection still acts on that row alone.
- `localChangeGroups.fileColors` setting, choosing whether file rows are tinted by
  Git status (default) or by their group color.
- **New Group from Selection**, which names, colors, and fills a group from the
  selected rows in one step and one persisted write.
- A commit panel above the tree with a group picker, a message box, and Stage,
  Commit, and Commit & Push buttons, mirroring the Source Control commit box.
  `Ctrl+Enter` commits, and unsent messages are kept per group. It is a webview
  locked to `default-src 'none'` with a per-render nonce and no local resource
  roots; every action it requests is re-validated in the extension host.
- A count of changed files as a badge on the Activity Bar icon.
- **Staged Changes** and **Changes** sections, appearing only once the index holds
  something, with groups nested under each. A partially staged file appears in
  both, matching the built-in Changes list.
- **Unstage Changes** for staged files and **Unstage Group**, plus an Unstage button
  in the commit panel. Unstaging leaves the working tree untouched, and the file
  action appears only on rows in the Staged Changes section.
- **Discard Changes** for a selection of files and **Discard All Changes in Group**.
  The modal counts reverts and permanent deletions separately, and staged-only
  entries are skipped rather than silently unstaged.

### Changed
- Changes are now bucketed by group once per repaint instead of being re-scanned
  for every group header and again for every group body. Path normalization used
  to run roughly `2 × groups × files` times per render; it now runs once per file.
- Git status events are debounced by 120 ms, so a save or a branch switch causes
  one repaint rather than a burst of them.
- Assigning, removing, or dropping many files persists a single write instead of
  one write per file.
- File rows now mirror the built-in **Changes** list: the file-icon theme's icon,
  the file name, its folder as dim description text, and a single-letter status
  badge (`M`, `A`, `D`, `R`, `U`, `C`, …) in the matching Git decoration color.
  Badges are drawn on a private URI scheme, so they never appear in other views.
- Group rows show a colored dot instead of a folder icon, and empty groups start
  collapsed.
- A single open repository no longer renders a redundant repository row.

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
