import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { directoryLabel, groupColorId, statusLabel } from '../core/changeLabels';
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
  item.iconPath = new vscode.ThemeIcon(node.section === 'staged' ? 'check' : 'edit');
  item.tooltip = node.section === 'staged'
    ? 'Files staged in the Git index, grouped the same way'
    : 'Files changed in the working tree, grouped the same way';
  return item;
}

/** A group header, dressed to look like the built-in section headers. */
export function groupItem(node: GroupNode, count: number): vscode.TreeItem {
  const name = node.group?.name ?? 'Ungrouped';
  const item = new vscode.TreeItem(name, count
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed);
  item.id = `group:${node.repository.rootUri.toString()}:${node.section ?? 'all'}:${node.group?.id ?? 'ungrouped'}`;
  item.description = String(count);
  item.tooltip = node.group
    ? `${name} — ${count} change${count === 1 ? '' : 's'}\nDrop files here to assign them.`
    : 'Changes that belong to no group\nDrop files here to remove them from their group.';
  item.contextValue = node.group ? 'localChangeGroups.group' : 'localChangeGroups.ungrouped';
  item.iconPath = new vscode.ThemeIcon(
    node.group ? node.group.icon ?? DEFAULT_GROUP_ICON : 'circle-outline',
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
  item.description = directoryLabel(displayChange.relativePath);
  item.tooltip = `${displayChange.relativePath}\n${statusLabel(displayChange.change.status)} · ${displayChange.area}`;
  item.resourceUri = changeDecorationUri(displayChange.change.uri, displayChange.change.status, node.groupColor);
  const membership = node.groupId ? 'grouped' : 'ungrouped';
  item.contextValue = `localChangeGroups.file.${membership}${node.section ? `.${node.section}` : ''}`;
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
