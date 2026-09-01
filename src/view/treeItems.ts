import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { directoryLabel, groupColorId, statusLabel } from '../core/changeLabels';
import { DEFAULT_GROUP_ICON, GroupColor } from '../core/groups';
import { sectionLabel } from '../core/sections';
import { changeDecorationUri } from './decorations';
import { DisplayChange, FileNode, GroupNode, RepositoryNode, SectionNode } from './nodes';

/**
 * Turns nodes into the rows VS Code draws.
 *
 * Kept apart from the provider so that *what the tree contains* (grouping,
 * caching, Git events) stays separate from *how a row looks*. Every function
 * here is a pure node-to-TreeItem mapping; counts arrive as arguments rather
 * than being recomputed, since the provider already has them cached.
 *
 * Row ids must be unique and stable: a group and its files can appear under both
 * sections at once, so the section is part of every id.
 */

/** Builds the repository row shown when several repositories are open. */
export function repositoryItem(node: RepositoryNode): vscode.TreeItem {
  const label = nodePath.basename(node.repository.rootUri.fsPath) || node.repository.rootUri.fsPath;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.id = `repository:${node.repository.rootUri.toString()}`;
  item.contextValue = 'localChangeGroups.repository';
  item.iconPath = new vscode.ThemeIcon('repo');
  item.description = node.repository.rootUri.fsPath;
  return item;
}

/** Builds a Staged Changes or Changes header row. */
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

/** Builds a group header row styled after the Source Control section headers. */
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
 * Builds a file row that mirrors the Source Control changes list: the icon
 * theme's own file icon, the name, its folder dimmed beside it, and a status
 * badge supplied by the decoration provider through `resourceUri`.
 *
 * `contextValue` encodes both group membership and section so `when` clauses can
 * offer Unstage only on rows that are actually staged.
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

/** Maps a stored palette key to its contributed theme color. */
function groupThemeColor(color: GroupColor): vscode.ThemeColor {
  return new vscode.ThemeColor(groupColorId(color));
}

export type { DisplayChange };
