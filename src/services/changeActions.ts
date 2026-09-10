import * as vscode from 'vscode';
import { partitionForDiscard } from '../core/discardPlan';
import { LocalGroup } from '../core/groups';
import { isInSection } from '../core/sections';
import { describeFileCount, errorMessage } from '../core/text';
import { acquireRepositoryLock, buildOperationPlan, commitGroupOnNewBranch, executeGroupOperation } from '../git/groupOperations';
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
  assertNotProtected(selected.group);
  const changes = context.provider.getGroupChanges(selected);
  const plan = buildOperationPlan(selected.repository, changes.map(item => item.change), 'stage');
  await executeGroupOperation(selected.repository, plan, context.gitPath, undefined, false, line => context.output.appendLine(line));
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Staged only group "${selected.group!.name}".`);
}

/** Commits one group. The message has already been collected by this point. */
export async function commitGroup(context: ActionContext, selected: GroupNode, message: string): Promise<void> {
  assertNotProtected(selected.group);
  const plan = buildOperationPlan(selected.repository, context.provider.getGroupChanges(selected).map(item => item.change), 'commit');
  await executeGroupOperation(selected.repository, plan, context.gitPath, message, false, line => context.output.appendLine(line));
  context.provider.refresh();
  void vscode.window.showInformationMessage(`Committed only group "${selected.group!.name}".`);
}

/** Commits one group and pushes it, after asking whether you meant it. */
export async function commitAndPushGroup(context: ActionContext, selected: GroupNode, message: string): Promise<void> {
  assertNotProtected(selected.group);
  const plan = buildOperationPlan(selected.repository, context.provider.getGroupChanges(selected).map(item => item.change), 'push');
  const confirmation = await vscode.window.showWarningMessage(
    `Commit and push exactly group "${selected.group!.name}" on branch "${plan.branch}"?`,
    { modal: true },
    'Commit & Push'
  );
  if (confirmation !== 'Commit & Push') return;
  try {
    await executeGroupOperation(selected.repository, plan, context.gitPath, message, true, line => context.output.appendLine(line));
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
 * Moves one group onto a new branch and puts you back where you were.
 *
 * Confirmed first, and in detail, because unlike the other actions here this one
 * moves HEAD twice and ends with the group's files no longer changed on the
 * branch you started on. That is the point of it, but it is not something to
 * discover afterwards.
 */
export async function moveGroupToBranch(
  context: ActionContext,
  selected: GroupNode,
  branchName: string,
  message: string
): Promise<void> {
  assertNotProtected(selected.group);
  const changes = context.provider.getGroupChanges(selected);
  const plan = buildOperationPlan(selected.repository, changes.map(item => item.change), 'commit');

  const confirmation = await vscode.window.showWarningMessage(
    `Move group "${selected.group!.name}" to a new branch?`,
    {
      modal: true,
      detail: [
        `${describeFileCount(changes.length)} will be committed on a new branch "${branchName}".`,
        `You end up back on "${plan.branch}", where those files are no longer changed — the change lives in the new commit.`,
        'Everything outside the group stays exactly as it is.'
      ].join('\n')
    },
    'Move to Branch'
  );
  if (confirmation !== 'Move to Branch') return;

  const branch = await commitGroupOnNewBranch(
    selected.repository,
    plan,
    context.gitPath,
    branchName,
    message,
    line => context.output.appendLine(line)
  );
  context.provider.refresh();
  context.output.appendLine(`Moved group "${selected.group!.name}" to ${branch}, back on ${plan.branch}`);
  void vscode.window.showInformationMessage(
    `Moved "${selected.group!.name}" to "${branch}". You are back on "${plan.branch}".`
  );
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
 * Refuses anything that would hand a protected group to Git.
 *
 * This is the whole feature. A group marked "never commit" holds the debug
 * logging and the local config you must not push, so the refusal lives here —
 * the one place the menus, the commit panel, and the keyboard all pass through.
 * Put it in the commands instead and the panel would quietly have its own way in.
 *
 * Unstaging is deliberately still allowed. It is the fix, not the danger.
 */
function assertNotProtected(group: LocalGroup | undefined): void {
  if (group?.protected) {
    throw new Error(
      `"${group.name}" is protected, so it will not be staged, committed, or pushed. ` +
      'Unprotect the group first if you really mean to.'
    );
  }
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
