import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { FrozenFile, FrozenSnapshot, referencedHashes } from '../core/frozen';
import { describeFileCount } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { SnapshotFiles } from '../data/snapshotFiles';
import { GitRunner } from '../git/runner';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { DisplayChange, GroupNode } from '../view/nodes';

/** Git status for an untracked file, which has no committed side to capture. */
const UNTRACKED = 7;

/** What freezing and unfreezing need from the host. */
export interface FreezeContext {
  store: GroupStore;
  provider: ChangeGroupsTreeProvider;
  snapshots: SnapshotFiles;
  output: vscode.OutputChannel;
  gitPath: string;
}

/**
 * Freezing and unfreezing a group.
 *
 * A freeze reads two versions of every file in the group — the committed side
 * and what is on disk right now — and stores both. From then on the group shows
 * those bytes rather than asking Git, which is what lets you keep editing the
 * same files without disturbing a change you have already reviewed.
 *
 * Nothing here writes to the working tree or the index. The worst a freeze can
 * do is take up a little disk space.
 */

/** Captures the group's current contents and pins it to them. */
export async function freezeGroup(context: FreezeContext, node: GroupNode): Promise<void> {
  const group = node.group;
  if (!group) throw new Error('Select a named group to freeze.');
  if (context.store.getFrozen(group.id)) {
    throw new Error(`"${group.name}" is already frozen. Use Update Freeze to Current to capture it again.`);
  }

  const changes = context.provider.getGroupChanges(node);
  if (changes.length === 0) throw new Error(`"${group.name}" has no changes to freeze.`);

  const runner = new GitRunner(context.gitPath, node.repository.rootUri.fsPath, line => context.output.appendLine(line));
  const files: FrozenFile[] = [];
  const unreadable: string[] = [];

  for (const change of changes) {
    const captured = await captureFile(context, runner, change);
    if (captured) {
      files.push(captured);
    } else {
      unreadable.push(change.relativePath);
    }
  }

  if (files.length === 0) {
    throw new Error('Nothing could be frozen: none of those files could be read as text.');
  }

  const snapshot: FrozenSnapshot = {
    frozenAt: Date.now(),
    repositoryRoot: node.repository.rootUri.fsPath,
    files
  };
  await context.store.freezeGroup(group.id, snapshot);
  context.provider.refresh();

  context.output.appendLine(`Froze ${describeFileCount(files.length)} in ${group.name}`);
  if (unreadable.length > 0) {
    // Binary files and files deleted between listing and reading. Worth saying
    // out loud, since they will not be in the frozen group afterwards.
    context.output.appendLine(`  skipped (not readable as text): ${unreadable.join(', ')}`);
    void vscode.window.showWarningMessage(
      `Froze ${describeFileCount(files.length)} in "${group.name}". Skipped ${describeFileCount(unreadable.length)} that could not be read as text.`
    );
  } else {
    void vscode.window.showInformationMessage(`Froze ${describeFileCount(files.length)} in "${group.name}".`);
  }
}

/**
 * Re-captures a group that is already frozen.
 *
 * The alternative is unfreeze-then-freeze, which works but throws away the pin
 * for a moment and makes you find the command twice. This is for the common
 * case: you froze a change, spotted one more fix that belongs with it, and want
 * the snapshot to include it.
 */
export async function refreezeGroup(context: FreezeContext, node: GroupNode): Promise<void> {
  const group = node.group;
  if (!group) throw new Error('Select a named group.');
  if (!context.store.getFrozen(group.id)) throw new Error(`"${group.name}" is not frozen.`);
  await context.store.unfreezeGroup(group.id);
  await freezeGroup(context, node);
  // Blobs from the previous snapshot are now unreferenced unless another group
  // happens to hold identical content.
  await context.snapshots.prune(referencedHashes(context.store.getAllFrozen()));
}

/**
 * Releases a group back to live Git state.
 *
 * The interesting part is not the unfreeze, it is the answer to "did anything
 * move while this was parked?". Files that drifted are named in the output and
 * summarised in the notification, because the moment you take the pin out is
 * exactly when that matters.
 */
export async function unfreezeGroup(context: FreezeContext, node: GroupNode): Promise<void> {
  const group = node.group;
  if (!group) throw new Error('Select a named group to unfreeze.');
  const snapshot = context.store.getFrozen(group.id);
  if (!snapshot) throw new Error(`"${group.name}" is not frozen.`);

  const drifted = await driftedFiles(context, snapshot);
  await context.store.unfreezeGroup(group.id);
  await context.snapshots.prune(referencedHashes(context.store.getAllFrozen()));
  context.provider.refresh();
  reportUnfreeze(context, group.name, drifted);
}

/** Unfreezes every frozen group at once, reporting the total drift. */
export async function unfreezeAll(context: FreezeContext): Promise<void> {
  const frozen = context.store.getAllFrozen();
  const groups = context.store.getGroups().filter(group => frozen[group.id]);
  if (groups.length === 0) throw new Error('No groups are frozen.');

  const drifted: string[] = [];
  for (const group of groups) {
    drifted.push(...await driftedFiles(context, frozen[group.id]));
    await context.store.unfreezeGroup(group.id);
  }
  await context.snapshots.prune(referencedHashes(context.store.getAllFrozen()));
  context.provider.refresh();
  reportUnfreeze(context, `${groups.length} group${groups.length === 1 ? '' : 's'}`, drifted);
}

/**
 * Says what happened, and makes the detail reachable without shouting.
 *
 * A plain notification for the quiet case; a "Show Details" button when files
 * drifted, since the full list belongs in the output rather than in a toast.
 */
function reportUnfreeze(context: FreezeContext, subject: string, drifted: readonly string[]): void {
  context.output.appendLine(`Unfroze ${subject}.`);
  if (drifted.length === 0) {
    void vscode.window.showInformationMessage(`Unfroze ${subject}. Nothing changed while it was frozen.`);
    return;
  }
  for (const path of drifted) {
    context.output.appendLine(`  changed since the freeze: ${path}`);
  }
  void vscode.window
    .showInformationMessage(
      `Unfroze ${subject}. ${describeFileCount(drifted.length)} changed since the freeze.`,
      'Show Details'
    )
    .then(choice => {
      if (choice === 'Show Details') context.output.show(true);
    });
}

/** Which frozen files no longer match what is on disk. */
export async function driftedFiles(context: FreezeContext, snapshot: FrozenSnapshot): Promise<string[]> {
  const drifted: string[] = [];
  for (const file of snapshot.files) {
    const current = await readWorkingFile(snapshot.repositoryRoot, file.relativePath);
    // A file that is gone counts as drift: it certainly does not match.
    if (current === undefined || await context.snapshots.read(file.frozenHash) !== current) {
      drifted.push(file.relativePath);
    }
  }
  return drifted;
}

/** Reads both sides of one file, or nothing if it is not usable text. */
async function captureFile(
  context: FreezeContext,
  runner: GitRunner,
  change: DisplayChange
): Promise<FrozenFile | undefined> {
  const working = await readWorkingFile(change.repository.rootUri.fsPath, change.relativePath);
  if (working === undefined) {
    return undefined;
  }

  // An untracked file has no committed side; a tracked one might still fail to
  // resolve if it was only just added, so a miss is treated as "no base".
  let base: string | undefined;
  if (change.change.status !== UNTRACKED) {
    const result = await runner.run(['--literal-pathspecs', 'show', `HEAD:${change.relativePath}`], true);
    base = result.stderr.length > 0 && result.stdout.length === 0 ? undefined : result.stdout.toString('utf8');
  }

  return {
    fileKey: change.fileKey,
    relativePath: change.relativePath,
    status: change.change.status,
    area: change.area,
    frozenHash: await context.snapshots.write(working),
    ...(base !== undefined ? { baseHash: await context.snapshots.write(base) } : {})
  };
}

/** Reads a working-tree file as text, or undefined if it is missing or binary. */
async function readWorkingFile(repositoryRoot: string, relativePath: string): Promise<string | undefined> {
  try {
    const buffer = await fs.readFile(nodePath.join(repositoryRoot, relativePath));
    // A NUL byte is the same cheap heuristic Git uses to call something binary.
    return buffer.includes(0) ? undefined : buffer.toString('utf8');
  } catch {
    return undefined;
  }
}
