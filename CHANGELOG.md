# Changelog

All notable changes to the Local Change Groups extension are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- With more than one repository open, a frozen group appeared under every one of
  them, and its file rows pointed at whichever repository the row happened to
  live under. A freeze captures files from one repository, so it now only counts
  as frozen in that one; elsewhere the group is an ordinary live group. Frozen
  rows also build their paths from the snapshot rather than from the row.
- Deleting a frozen group left its captured file contents in extension storage.
  Only the freeze commands pruned, so those blobs sat there until the next
  unfreeze happened to sweep them up. Deleting a group now prunes, and so does
  startup, which clears anything an earlier session left behind.
- Dragging a file out of the **Frozen** section moved its group but left the
  snapshot still listing it, so it showed up under Frozen and under its new
  group at the same time. Frozen rows are no longer draggable — unfreeze the
  group to rearrange it. Live rows for frozen files still are, since that work
  happened after the freeze and grouping it is the point.
- **Assign or Move Files** listed frozen groups and then refused them with an
  error. Both assignment commands now share one picker, which lists only groups
  that can actually take files and offers a new group instead.
- `npm run package` and `npm run install-extension` had the version written into
  them by hand, in three places, so bumping it meant silently installing a stale
  build. They read it from `package.json` now.
- Freezing a group no longer leaves its files showing in **Ungrouped** at the
  same time as the **Frozen** section. A freeze is meant to park a change, and it
  now does: while a file still matches its snapshot it drops out of the live
  lists entirely, so the list you are working through holds only what you are
  actually working on. Edit a frozen file again and the new part comes back into
  **Changes**, marked *since freeze*, because that part is not parked.

  Two things stay visible whatever happens: files you have staged, and files in
  conflict. That is what the next commit contains, so hiding it would be a good
  way to commit something you did not mean to. A file the freeze skipped (a
  binary, say) also stays listed, since no frozen row is showing it.

### Added
- **Assign All Ungrouped to Group**, on the **Ungrouped** row and in the Command
  Palette. Takes every ungrouped change in one move rather than a file at a time,
  and offers creating a group inline so it still works with no groups yet. Frozen
  groups are omitted from the picker because they refuse new files until unfrozen.
  The action is hidden on an empty Ungrouped row.

### Changed
- The rule for what counts as ungrouped — the plain bucket plus any change whose
  group has since been frozen — now lives in one place, shared by the tree and the
  new bulk action, so the two cannot disagree about which files are included.

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
- Per-group icons. **Change Group Icon** offers sixteen codicons, each previewed
  in the picker, plus a Custom entry accepting any codicon id. The group color
  still tints whichever icon is chosen, and groups without one keep the dot.
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
- **Freeze Group**: a snapshot layer between the working tree and the index.
  A frozen group shows the files as they were at freeze time and stops accepting
  new ones, so later edits to the same files never appear in a change you have
  already reviewed. Staging and committing still work and still act on current
  content. **Compare Frozen with Current** shows the drift,
  **Update Freeze to Current** re-captures in place, and **Unfreeze All Groups**
  clears the lot. Unfreezing names every file that drifted while parked. Contents are stored as content-addressed
  blobs in extension storage, never inside `.git`.

### Fixed
- Editing a file after freezing its group made that edit disappear: the group
  rendered from its snapshot, so the live change had nowhere to go. Frozen groups
  now sit in their own **Frozen** section and their files fall back to Ungrouped
  in the live sections, so the ongoing work stays visible.
- A group action involving a staged rename could abort with a fatal pathspec
  error, because the rename’s old path exists in neither the index nor the
  working tree. Those paths are now dropped before `git add`, while
  `git commit --only` still receives them so the delete side is recorded.
- Git failures now name the subcommand that failed, and the full argv and stderr
  are written to the Local Change Groups output channel.

### Changed
- Restructured the source into layers — `core`, `data`, `git`, `view`, `services`,
  `commands` — with no import cycles and no `vscode` import below the view layer.
  Behavior is unchanged; see ARCHITECTURE.md. Git actions now live in one module
  shared by the menus and the commit panel, so both take an identical path.
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
