import * as vscode from 'vscode';
import { DisplayChange, FileNode, GroupNode } from '../view/nodes';

/**
 * Works out which rows a command should act on.
 *
 * VS Code passes context-menu commands the invoked item plus the selection, but
 * passes inline (hover toolbar) commands only the invoked item — so the live
 * view selection is consulted as a fallback, which is what makes an inline
 * button act on a whole multi-selection.
 */

/**
 * Returns the file rows a command should act on, preferring the whole
 * multi-selection whenever the invoked row is part of it.
 *
 * Invoking a command on a row *outside* the current selection deliberately acts
 * on that row alone, matching how the built-in Source Control view behaves.
 * Returns undefined when nothing is selected, so the caller can fall back to a
 * quick pick.
 */
export function selectedChanges(
  node: FileNode | undefined,
  nodes: readonly (FileNode | unknown)[] | undefined,
  view: Pick<vscode.TreeView<unknown>, 'selection'>
): DisplayChange[] | undefined {
  const fromArgument = (nodes ?? []).filter((candidate): candidate is FileNode => candidate instanceof FileNode);
  const candidates = fromArgument.length > 0
    ? fromArgument
    : (view.selection ?? []).filter((candidate): candidate is FileNode => candidate instanceof FileNode);
  const includesInvoked = !node || candidates.some(candidate => candidate.displayChange.fileKey === node.displayChange.fileKey);
  const chosen = includesInvoked && candidates.length > 0 ? candidates : node ? [node] : [];
  if (chosen.length === 0) {
    return undefined;
  }
  // The same file can be selected under both sections; act on it once.
  const byKey = new Map(chosen.map(item => [item.displayChange.fileKey, item.displayChange]));
  return [...byKey.values()];
}

/** Returns the group a tree selection points at, used to retarget the commit panel. */
export function selectedGroupId(selection: readonly unknown[]): string | undefined {
  for (const node of selection) {
    if (node instanceof GroupNode && node.group) return node.group.id;
    if (node instanceof FileNode && node.groupId) return node.groupId;
  }
  return undefined;
}
