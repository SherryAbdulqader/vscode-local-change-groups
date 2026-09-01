import * as vscode from 'vscode';
import { partitionForDiscard } from '../core/discardPlan';
import { isInSection } from '../core/sections';
import { describeFileCount, errorMessage } from '../core/text';
import { acquireRepositoryLock, buildOperationPlan, executeGroupOperation } from '../git/groupOperations';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { DisplayChange, GroupNode } from '../view/nodes';

/**
 * Everything that changes Git state, in one place.
 *
 * These are the operations themselves: they assume the caller has already
 * decided *what* to act on, and they own the confirmations, the repository lock,
 * and the result messages. Both the command palette / menus and the commit panel
 * call in here, so a given action behaves identically no matter how it was
 * started — the panel cannot reach a shortened path.
 *
 * Every function refreshes the tree on success rather than relying on the Git
 * extension's own event, so the view updates immediately.
 */

/** What an action needs from the host to report itself. */
export interface ActionContext {
  provider: ChangeGroupsTreeProvider;
  output: vscode.OutputChannel;
  gitPath: string;
}

/** Stages exactly one group's files. */
export async function stageGroup(context: ActionContext, selected: GroupNode): Promise<void> {
  const changes = context.provider.getGroupChanges(selected);
  const plan = buildOperationPlan(selected.repository, changes.map(item => item.change), 'stage');
  await executeGroupOperation(selected.repository, plan, context.gitPath);
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Staged only group "${selected.group!.name}".`);
}

/** Commits exactly one group's files with an already-resolved message. */
export async function commitGroup(context: ActionContext, selected: GroupNode, message: string): Promise<void> {
  const plan = buildOperationPlan(selected.repository, context.provider.getGroupChanges(selected).map(item => item.change), 'commit');
  await executeGroupOperation(selected.repository, plan, context.gitPath, message);
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Committed only group "${selected.group!.name}".`);
}

/** Confirms, then commits and pushes exactly one group's files. */
export async function commitAndPushGroup(context: ActionContext, selected: GroupNode, message: string): Promise<void> {
  const plan = buildOperationPlan(selected.repository, context.provider.getGroupChanges(selected).map(item => item.change), 'push');
  const confirmation = await vscode.window.showWarningMessage(
    `Commit and push exactly group "${selected.group!.name}" on branch "${plan.branch}"?`,
    { modal: true },
    'Commit & Push'
  );
  if (confirmation !== 'Commit & Push') return;
  try {
    await executeGroupOperation(selected.repository, plan, context.gitPath, message, true);
  } catch (error) {
    // A failure here may be the push rather than the commit, and the difference
    // matters: the work is not lost, it is sitting in a local commit.
    throw new Error(`${errorMessage(error)} If the commit succeeded, it remains local and can be pushed after resolving the problem.`);
  }
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Pushed only group "${selected.group!.name}".`);
}

/**
 * Removes files from the index without touching the working tree. Entries that
 * are not staged are ignored rather than treated as an error for the whole batch.
 */
export async function unstageChanges(
  context: ActionContext,
  changes: readonly DisplayChange[],
  groupName?: string
): Promise<void> {
  const staged = changes.filter(item => isInSection(item.area, 'staged'));
  if (staged.length === 0) {
    throw new Error('Nothing to unstage: none of those files are staged.');
  }
  await forEachRepository(staged, (repository, paths) => repository.revert(paths));
  context.provider.refresh();
  const scope = groupName ? ` in group "${groupName}"` : '';
  context.output.appendLine(`Unstaged ${describeFileCount(staged.length)}${scope}`);
  void vscode.window.showInformationMessage(`Unstaged ${describeFileCount(staged.length)}${scope}.`);
}

/**
 * Discards working-tree changes after a modal that states deletions separately
 * from reverts, because only one of the two is recoverable.
 */
export async function discardChanges(
  context: ActionContext,
  changes: readonly DisplayChange[],
  groupName?: string
): Promise<void> {
  const { restore, remove, skip } = partitionForDiscard(changes, item => item.area, item => item.change.status);
  const affected = [...restore, ...remove];
  if (affected.length === 0) {
    throw new Error('Nothing to discard: the selection has no working-tree changes.');
  }

  const detail = [
    restore.length ? `${describeFileCount(restore.length)} will be restored to the last committed state.` : '',
    remove.length ? `${describeFileCount(remove.length)} untracked will be permanently deleted from disk.` : '',
    skip.length ? `${describeFileCount(skip.length)} staged with no further edit will be left alone.` : ''
  ].filter(Boolean).join('\n');

  const confirmation = await vscode.window.showWarningMessage(
    groupName
      ? `Discard working-tree changes in group "${groupName}"? This cannot be undone.`
      : `Discard working-tree changes in ${describeFileCount(affected.length)}? This cannot be undone.`,
    { modal: true, detail },
    'Discard Changes'
  );
  if (confirmation !== 'Discard Changes') return;

  await forEachRepository(affected, (repository, paths) => repository.clean(paths));
  context.provider.refresh();
  context.output.appendLine(`Discarded ${describeFileCount(affected.length)}${groupName ? ` in ${groupName}` : ''}`);
}

/**
 * Groups a selection by repository and runs one batched Git call per repository,
 * holding that repository's lock so the call cannot interleave with a group
 * stage, commit, or push.
 */
async function forEachRepository(
  changes: readonly DisplayChange[],
  run: (repository: DisplayChange['repository'], paths: string[]) => Promise<void>
): Promise<void> {
  for (const repository of new Set(changes.map(item => item.repository))) {
    const release = acquireRepositoryLock(repository.rootUri.fsPath);
    try {
      const paths = changes.filter(item => item.repository === repository).map(item => item.change.uri.fsPath);
      await run(repository, paths);
    } finally {
      release();
    }
  }
}
