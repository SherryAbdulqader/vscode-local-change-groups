import * as vscode from 'vscode';
import { partitionForDiscard } from '../core/discardPlan';
import { isInSection } from '../core/sections';
import { describeFileCount, errorMessage } from '../core/text';
import { acquireRepositoryLock, buildOperationPlan, executeGroupOperation } from '../git/groupOperations';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { DisplayChange, GroupNode } from '../view/nodes';

/**
 * Everything that touches Git, in one file.
 *
 * These assume the caller has already worked out *what* to act on. What they own
 * is the part you do not want duplicated: the confirmations, the repository
 * lock, and the messages afterwards.
 *
 * The menus and the commit panel both come through here, which is the point —
 * two entry points, one implementation, so the panel cannot quietly acquire a
 * shortcut past a confirmation that the menu route still shows.
 *
 * Each one refreshes the tree itself rather than waiting for Git's own event,
 * so the view moves the instant the work is done.
 */

/** The bits of the host an action needs to do its job and say so. */
export interface ActionContext {
  provider: ChangeGroupsTreeProvider;
  output: vscode.OutputChannel;
  gitPath: string;
}

/** Stages one group. Nothing else in the repository is touched. */
export async function stageGroup(context: ActionContext, selected: GroupNode): Promise<void> {
  const changes = context.provider.getGroupChanges(selected);
  const plan = buildOperationPlan(selected.repository, changes.map(item => item.change), 'stage');
  await executeGroupOperation(selected.repository, plan, context.gitPath);
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Staged only group "${selected.group!.name}".`);
}

/** Commits one group. The message has already been collected by this point. */
export async function commitGroup(context: ActionContext, selected: GroupNode, message: string): Promise<void> {
  const plan = buildOperationPlan(selected.repository, context.provider.getGroupChanges(selected).map(item => item.change), 'commit');
  await executeGroupOperation(selected.repository, plan, context.gitPath, message);
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Committed only group "${selected.group!.name}".`);
}

/** Commits one group and pushes it, after asking whether you meant it. */
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
    // This might have been the push failing rather than the commit, and that
    // distinction matters a lot to whoever is reading the error: the work is not
    // gone, it is sitting in a perfectly good local commit.
    throw new Error(`${errorMessage(error)} If the commit succeeded, it remains local and can be pushed after resolving the problem.`);
  }
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Pushed only group "${selected.group!.name}".`);
}

/**
 * Takes files back out of the index. Your working tree is not touched.
 *
 * Files in the selection that were not staged are simply skipped — unstaging a
 * half-staged group should do the obvious thing, not refuse the whole batch over
 * the files that were never staged to begin with.
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
 * Throws away working-tree changes, after being very clear about what that means.
 *
 * The confirmation counts reverts and deletions separately because only one of
 * them is recoverable, and the difference is worth a sentence.
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
 * One batched Git call per repository, each under that repository's lock.
 *
 * The lock is what stops this from interleaving with a group stage or commit
 * that is halfway through rearranging the index.
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
