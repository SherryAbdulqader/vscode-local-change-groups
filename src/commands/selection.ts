import * as vscode from 'vscode';
import { DisplayChange, FileNode, GroupNode } from '../view/nodes';

/**
 * Working out which rows a command actually meant.
 *
 * VS Code hands context-menu commands the clicked item *and* the selection, but
 * hands inline hover-toolbar commands only the clicked item. Without the
 * fallback to the live view selection below, selecting twelve files and clicking
 * the inline button would act on exactly one of them, which is maddening.
 */

/**
 * The rows to act on: the whole selection, as long as the clicked row is part of
 * it.
 *
 * Click a row *outside* the selection and you get just that row — which sounds
 * fussy written down, but is exactly what the built-in Source Control view does
 * and what your hands already expect.
 *
 * Undefined means nothing was selected at all, so the caller can offer a picker.
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
  // A file can be selected under both sections at once. Act on it once.
  const byKey = new Map(chosen.map(item => [item.displayChange.fileKey, item.displayChange]));
  return [...byKey.values()];
}

/** Which group is the selection pointing at? Used to aim the commit panel. */
export function selectedGroupId(selection: readonly unknown[]): string | undefined {
  for (const node of selection) {
    if (node instanceof GroupNode && node.group) return node.group.id;
    if (node instanceof FileNode && node.groupId) return node.groupId;
  }
  return undefined;
}
