import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { directoryLabel, groupColorId, statusLabel } from '../core/changeLabels';
import { frozenLabel } from '../core/frozen';
import { DEFAULT_GROUP_ICON, GroupColor } from '../core/groups';
import { sectionLabel } from '../core/sections';
import { changeDecorationUri } from './decorations';
import { DisplayChange, FileNode, GroupNode, RepositoryNode, SectionNode } from './nodes';

/**
 * Nodes in, rows out. Nothing else.
 *
 * Split from the provider so "what is in the tree" and "what a row looks like"
 * stop sharing a file. Counts arrive as arguments rather than being recomputed
 * here — the provider already has them cached and would rather not do it twice.
 *
 * One rule worth respecting: ids must be unique and stable. A group and its
 * files can legitimately appear under both sections at once, which is why the
 * section is baked into every id.
 */

/** The repository row, which only shows up in multi-root workspaces. */
export function repositoryItem(node: RepositoryNode): vscode.TreeItem {
  const label = nodePath.basename(node.repository.rootUri.fsPath) || node.repository.rootUri.fsPath;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.id = `repository:${node.repository.rootUri.toString()}`;
  item.contextValue = 'localChangeGroups.repository';
  item.iconPath = new vscode.ThemeIcon('repo');
  item.description = node.repository.rootUri.fsPath;
  return item;
}

/** A section header. */
export function sectionItem(node: SectionNode, count: number): vscode.TreeItem {
  const item = new vscode.TreeItem(sectionLabel(node.section), vscode.TreeItemCollapsibleState.Expanded);
  item.id = `section:${node.repository.rootUri.toString()}:${node.section}`;
  item.description = String(count);
  item.contextValue = `localChangeGroups.section.${node.section}`;
  item.iconPath = new vscode.ThemeIcon(SECTION_ICONS[node.section]);
  item.tooltip = SECTION_TOOLTIPS[node.section];
  return item;
}

const SECTION_ICONS: Record<SectionNode['section'], string> = {
  frozen: 'lock',
  staged: 'check',
  unstaged: 'edit'
};

const SECTION_TOOLTIPS: Record<SectionNode['section'], string> = {
  frozen: 'Snapshots pinned by a freeze.\nThese show the files as they were, so later edits appear in Changes instead.',
  staged: 'Files staged in the Git index, grouped the same way',
  unstaged: 'Files changed in the working tree, grouped the same way'
};

/**
 * A group header, dressed to look like the built-in section headers.
 *
 * A frozen group says so in its description and swaps its icon for a lock. The
 * lock wins over the group's chosen icon on purpose — frozen is a state you want
 * to notice at a glance, and it is temporary, so the icon comes back on unfreeze.
 */
export function groupItem(node: GroupNode, count: number): vscode.TreeItem {
  const name = node.group?.name ?? 'Ungrouped';
  const frozen = node.frozenAt !== undefined;
  const item = new vscode.TreeItem(name, count
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed);
  item.id = `group:${node.repository.rootUri.toString()}:${node.section ?? 'all'}:${node.group?.id ?? 'ungrouped'}`;
  item.description = frozen ? `${count} · frozen` : String(count);
  item.tooltip = node.group
    ? frozen
      ? `${name} — ${count} file${count === 1 ? '' : 's'} frozen ${frozenLabel(node.frozenAt!)}\nShowing the snapshot. Later edits to these files will not appear here.`
      : `${name} — ${count} change${count === 1 ? '' : 's'}\nDrop files here to assign them.`
    : 'Changes that belong to no group\nDrop files here to remove them from their group, or use Assign All to file the lot at once.';
  item.contextValue = node.group
    ? frozen ? 'localChangeGroups.group.frozen' : 'localChangeGroups.group'
    // Whether the row has anything in it rides along in the context value, so
    // package.json can keep "Assign All Ungrouped to Group" off an empty row
    // instead of offering an action with nothing to act on.
    : count ? 'localChangeGroups.ungrouped' : 'localChangeGroups.ungrouped.empty';
  item.iconPath = new vscode.ThemeIcon(
    node.group ? frozen ? 'lock' : node.group.icon ?? DEFAULT_GROUP_ICON : 'circle-outline',
    node.group ? groupThemeColor(node.group.color) : undefined
  );
  return item;
}

/**
 * A file row, made to look exactly like one in the built-in Changes list: the
 * icon theme's own file icon, the name, the folder dimmed beside it, and a
 * status badge that decorations.ts paints via `resourceUri`.
 *
 * The contextValue carries both group membership and section, which is what lets
 * package.json offer Unstage only on rows that are genuinely staged.
 */
export function fileItem(node: FileNode): vscode.TreeItem {
  const { displayChange } = node;
  const item = new vscode.TreeItem(nodePath.basename(displayChange.relativePath), vscode.TreeItemCollapsibleState.None);
  item.id = `file:${node.section ?? 'all'}:${node.groupId ?? 'ungrouped'}:${displayChange.fileKey}`;
  const folder = directoryLabel(displayChange.relativePath);
  item.description = node.pinnedBase ? `${folder}${folder ? ' ' : ''}· since freeze` : folder;
  item.tooltip = node.frozen
    ? `${displayChange.relativePath}\n${statusLabel(displayChange.change.status)} · frozen\nOpens the snapshot, not the current file.`
    : node.pinnedBase
      ? `${displayChange.relativePath}\n${statusLabel(displayChange.change.status)} · changed since the freeze\nDiffs against the frozen copy, so the frozen change is not shown again.`
      : `${displayChange.relativePath}\n${statusLabel(displayChange.change.status)} · ${displayChange.area}`;
  item.resourceUri = changeDecorationUri(displayChange.change.uri, displayChange.change.status, node.groupColor);
  const membership = node.groupId ? 'grouped' : 'ungrouped';
  const state = node.frozen ? '.frozen' : node.section ? `.${node.section}` : '';
  item.contextValue = `localChangeGroups.file.${membership}${state}`;
  item.command = {
    command: 'localChangeGroups.openChange',
    title: 'Open Change',
    arguments: [node]
  };
  return item;
}

/** Palette key to an actual ThemeColor. */
function groupThemeColor(color: GroupColor): vscode.ThemeColor {
  return new vscode.ThemeColor(groupColorId(color));
}

export type { DisplayChange };
