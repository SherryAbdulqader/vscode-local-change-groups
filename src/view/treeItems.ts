import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { directoryLabel, groupColorId, statusLabel } from '../core/changeLabels';
import { frozenLabel } from '../core/frozen';
import { DEFAULT_GROUP_ICON, GroupColor } from '../core/groups';
import { sectionLabel } from '../core/sections';
import { changeDecorationUri, protectedAlarmUri } from './decorations';
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
 * Three states can be true at once here — frozen, protected, and "protected but
 * somebody staged it anyway" — so the description, icon, tooltip, and context
 * value are each worked out by their own small function below rather than in one
 * pile of nested conditionals.
 */
export function groupItem(node: GroupNode, count: number, stagedWhileProtected = false): vscode.TreeItem {
  const name = node.group?.name ?? 'Ungrouped';
  const frozen = node.frozenAt !== undefined;
  const guarded = node.group?.protected === true;
  const item = new vscode.TreeItem(name, count
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed);
  item.id = `group:${node.repository.rootUri.toString()}:${node.section ?? 'all'}:${node.group?.id ?? 'ungrouped'}`;
  item.description = groupDescription(count, frozen, guarded, stagedWhileProtected);
  item.tooltip = groupTooltip(node, name, count, frozen, guarded, stagedWhileProtected);
  item.contextValue = groupContextValue(node, count, frozen, guarded);
  item.iconPath = groupIcon(node, frozen, guarded, stagedWhileProtected);
  if (stagedWhileProtected) {
    // A decoration is the only way to get red text onto a tree row.
    item.resourceUri = protectedAlarmUri(node.group!.id);
  }
  return item;
}

/** The dim text after the name: the count, plus anything unusual. */
function groupDescription(count: number, frozen: boolean, guarded: boolean, alarm: boolean): string {
  // Nothing else is worth reading while this is true.
  if (alarm) {
    return `${count} · staged, will be committed`;
  }
  const notes = [frozen ? 'frozen' : '', guarded ? 'protected' : ''].filter(Boolean);
  return notes.length > 0 ? `${count} · ${notes.join(' · ')}` : String(count);
}

/**
 * One icon, three competing claims on it.
 *
 * The alarm wins, because it is the only one that needs doing something about.
 * Frozen beats protected because it is temporary and you want to spot it at a
 * glance. The group's own icon comes back as soon as neither applies.
 */
function groupIcon(node: GroupNode, frozen: boolean, guarded: boolean, alarm: boolean): vscode.ThemeIcon {
  if (!node.group) {
    return new vscode.ThemeIcon('circle-outline');
  }
  if (alarm) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
  }
  return new vscode.ThemeIcon(
    frozen ? 'lock' : guarded ? 'shield' : node.group.icon ?? DEFAULT_GROUP_ICON,
    groupThemeColor(node.group.color)
  );
}

/**
 * What the menus match on.
 *
 * Built from tokens, because a group really can be frozen and protected at once.
 * The order is fixed so a `when` clause can anchor on `.frozen$` and still find
 * `.protected` in the middle.
 */
function groupContextValue(node: GroupNode, count: number, frozen: boolean, guarded: boolean): string {
  if (!node.group) {
    // Whether the row holds anything rides along too, so package.json can keep
    // "Assign All Ungrouped to Group" off an empty row.
    return count ? 'localChangeGroups.ungrouped' : 'localChangeGroups.ungrouped.empty';
  }
  return `localChangeGroups.group${guarded ? '.protected' : ''}${frozen ? '.frozen' : ''}`;
}

/** The hover text, built up from whatever happens to be true. */
function groupTooltip(
  node: GroupNode,
  name: string,
  count: number,
  frozen: boolean,
  guarded: boolean,
  alarm: boolean
): string {
  if (!node.group) {
    return [
      'Changes that belong to no group',
      'Drop files here to remove them from their group, or use Assign All to file the lot at once.'
    ].join('\n');
  }

  const lines = [`${name} — ${count} file${count === 1 ? '' : 's'}`];
  if (alarm) {
    lines.push('This group is protected, but some of its files are staged.');
    lines.push('An ordinary commit would include them. Unstage the group to put it right.');
  } else if (guarded) {
    lines.push('Protected: it will not be staged, committed, or pushed.');
  }
  if (frozen) {
    lines.push(`Frozen ${frozenLabel(node.frozenAt!)}. Showing the snapshot, so later edits will not appear here.`);
  }
  if (!alarm && !guarded && !frozen) {
    lines.push('Drop files here to assign them.');
  }
  return lines.join('\n');
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
