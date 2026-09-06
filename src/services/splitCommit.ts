import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { FrozenFile } from '../core/frozen';
import { describeFileCount } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { SnapshotFiles } from '../data/snapshotFiles';
import { GitRunner } from '../git/runner';
import { acquireRepositoryLock } from '../git/groupOperations';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { GroupNode } from '../view/nodes';

/**
 * Committing only the work done *since* a freeze.
 *
 * The situation this exists for: you fixed problem A in a file, froze it, then
 * fixed problem B in the same file. Both edits live in one file on disk, so an
 * ordinary commit takes both. This takes only B, and leaves A sitting in your
 * working tree exactly where it was.
 *
 * How, for each file that has a freeze behind it:
 *
 *     HEAD version  ──┐
 *     frozen copy   ──┼─ git merge-file ──▶  HEAD + B
 *     current file  ──┘
 *
 * The result is committed and A never enters the commit. If A and B touched the
 * same lines, merge-file cannot separate them and the whole thing is refused —
 * guessing there would silently commit something nobody wrote.
 *
 * **Nothing is staged and nothing on disk is touched.** The commit is assembled
 * in a throwaway index and written with `commit-tree`, then the branch is moved
 * with a compare-and-swap on the old tip. Your real index, and every file you
 * have open, are left alone from start to finish.
 */

/** Git status for an untracked file, which has no committed side. */
const UNTRACKED = 7;

export interface SplitCommitContext {
  store: GroupStore;
  provider: ChangeGroupsTreeProvider;
  snapshots: SnapshotFiles;
  output: vscode.OutputChannel;
  gitPath: string;
}

/** One path, resolved to the exact bytes the new commit should hold. */
interface ResolvedPath {
  relativePath: string;
  /** Absent when the file should be removed in the commit. */
  content?: string;
  /** Whether a freeze was subtracted, for the confirmation wording. */
  split: boolean;
}

/** What actually went into the commit, so the real index can be caught up. */
interface CommittedEntry {
  relativePath: string;
  mode: string;
  /** Absent when the path was removed. */
  sha?: string;
}

/**
 * Commits a group, subtracting any frozen baseline from the files that have one.
 */
export async function commitSinceFreeze(
  context: SplitCommitContext,
  node: GroupNode,
  message: string
): Promise<void> {
  const group = node.group;
  if (!group) throw new Error('Select a named group to commit.');
  if (context.store.getFrozen(group.id)) {
    throw new Error(`"${group.name}" is frozen. This commits work done since a freeze, so unfreeze it first.`);
  }

  const changes = context.provider.getGroupChanges(node);
  if (changes.length === 0) throw new Error(`"${group.name}" has no changes to commit.`);

  const baselines = frozenBaselines(context.store);
  if (!changes.some(change => baselines.has(change.fileKey))) {
    throw new Error('No file in this group has a freeze behind it. Use Commit Group instead.');
  }

  const root = node.repository.rootUri.fsPath;
  const release = acquireRepositoryLock(root);
  const scratch = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'lcg-split-'));
  try {
    const runner = new GitRunner(context.gitPath, root, line => context.output.appendLine(line));
    const branch = text(await runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD']));
    const head = text(await runner.run(['rev-parse', '--verify', 'HEAD^{commit}']));
    if (!branch || !head) throw new Error('Unborn and detached branches are not supported.');

    const resolved: ResolvedPath[] = [];
    for (const change of changes) {
      resolved.push(await resolvePath(context, runner, scratch, change.relativePath, change.change.status, baselines.get(change.fileKey)));
    }

    const effective = await withoutUnchanged(runner, head, resolved);
    if (effective.length === 0) {
      throw new Error('Nothing has changed since the freeze, so there is nothing to commit.');
    }

    // Anything already staged for these paths would be clobbered when the real
    // index is caught up below, so refuse rather than quietly discard it.
    const staged = names(await runner.run(['--literal-pathspecs', 'diff', '--cached', '--name-only', '-z', '--', ...effective.map(entry => entry.relativePath)]));
    if (staged.length > 0) {
      throw new Error(`Unstage ${staged.join(', ')} first: committing since a freeze rewrites the index entry for each file it touches.`);
    }

    const split = effective.filter(entry => entry.split).length;
    const confirmation = await vscode.window.showWarningMessage(
      `Commit ${describeFileCount(effective.length)} from "${group.name}" on "${branch}"?`,
      {
        modal: true,
        detail: `${describeFileCount(split)} will be committed without the frozen change, which stays in your working tree.`
      },
      'Commit'
    );
    if (confirmation !== 'Commit') return;

    const { commit, entries } = await buildCommit(runner, scratch, head, message, effective);
    // Compare-and-swap on the old tip: if anything moved the branch while we
    // were working, Git refuses and nothing is lost.
    await runner.run(['update-ref', `refs/heads/${branch}`, commit, head]);
    // The real index still describes the old HEAD for these paths. Left alone it
    // would read as staged changes that nobody made, so each entry is caught up
    // to what was just committed — the state an ordinary commit leaves behind.
    await syncIndex(runner, entries);
    await node.repository.status();
    context.provider.refresh();

    context.output.appendLine(`Committed ${describeFileCount(effective.length)} from ${group.name} since the freeze (${commit.slice(0, 8)})`);
    void vscode.window.showInformationMessage(
      `Committed ${describeFileCount(effective.length)} from "${group.name}". The frozen change is still in your working tree.`
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    release();
  }
}

/** Every frozen file, keyed for lookup by the live rows that share its path. */
function frozenBaselines(store: GroupStore): Map<string, FrozenFile> {
  const baselines = new Map<string, FrozenFile>();
  for (const snapshot of Object.values(store.getAllFrozen())) {
    for (const file of snapshot.files) {
      baselines.set(file.fileKey, file);
    }
  }
  return baselines;
}

/**
 * Works out the bytes one path should contribute.
 *
 * With no freeze behind it, that is simply the current file. With a freeze, it
 * is the committed version plus whatever changed after the freeze.
 */
async function resolvePath(
  context: SplitCommitContext,
  runner: GitRunner,
  scratch: string,
  relativePath: string,
  status: number,
  baseline: FrozenFile | undefined
): Promise<ResolvedPath> {
  const current = await readText(nodePath.join(runner.root, relativePath));
  if (!baseline) {
    return { relativePath, content: current, split: false };
  }
  if (current === undefined) {
    // Deleted since the freeze. Deleting it is the honest reading of "changed
    // since", and the frozen copy is still safe in storage.
    return { relativePath, split: true };
  }

  const frozen = await context.snapshots.read(baseline.frozenHash);
  if (frozen === undefined) {
    throw new Error(`The frozen copy of ${relativePath} is missing from storage. Unfreeze that group and freeze it again.`);
  }
  if (frozen === current) {
    return { relativePath, content: current, split: true };
  }

  const committed = status === UNTRACKED ? '' : await showAtHead(runner, relativePath);
  const merged = await mergeFile(runner, scratch, relativePath, committed, frozen, current);
  return { relativePath, content: merged, split: true };
}

/**
 * Replays the post-freeze edit onto the committed version.
 *
 * `git merge-file ours base theirs` applies base → theirs onto ours, which with
 * ours = HEAD, base = frozen and theirs = current means "HEAD plus only what
 * happened after the freeze".
 */
async function mergeFile(
  runner: GitRunner,
  scratch: string,
  relativePath: string,
  committed: string,
  frozen: string,
  current: string
): Promise<string> {
  const safe = relativePath.replace(/[\\/]/g, '_');
  const ours = nodePath.join(scratch, `${safe}.head`);
  const base = nodePath.join(scratch, `${safe}.frozen`);
  const theirs = nodePath.join(scratch, `${safe}.current`);
  await fs.writeFile(ours, committed, 'utf8');
  await fs.writeFile(base, frozen, 'utf8');
  await fs.writeFile(theirs, current, 'utf8');

  const result = await runner.run(['merge-file', '-p', '--diff3', ours, base, theirs], true);
  const merged = result.stdout.toString('utf8');
  // merge-file exits with the conflict count, and marks them in the output.
  if (result.code !== 0 || merged.includes('<<<<<<<')) {
    throw new Error(
      `${relativePath}: the frozen change and the later edit touch the same lines, so they cannot be committed apart. ` +
      'Commit the frozen group first, or unfreeze and commit them together.'
    );
  }
  return merged;
}

/** Drops paths whose resolved content already matches HEAD. */
async function withoutUnchanged(runner: GitRunner, head: string, resolved: ResolvedPath[]): Promise<ResolvedPath[]> {
  const kept: ResolvedPath[] = [];
  for (const entry of resolved) {
    const committed = await showAtCommit(runner, head, entry.relativePath);
    if (entry.content === undefined) {
      if (committed !== undefined) kept.push(entry);
    } else if (committed !== entry.content) {
      kept.push(entry);
    }
  }
  return kept;
}

/**
 * Assembles the commit in a scratch index and returns its id.
 *
 * `GIT_INDEX_FILE` points Git at a throwaway file, so the real index is never
 * opened, let alone written. This is the one place the extension sets a `GIT_*`
 * variable, and it sets exactly one, to a path it just created itself.
 */
async function buildCommit(
  runner: GitRunner,
  scratch: string,
  head: string,
  message: string,
  resolved: readonly ResolvedPath[]
): Promise<{ commit: string; entries: CommittedEntry[] }> {
  const indexFile = nodePath.join(scratch, 'index');
  const env = { GIT_INDEX_FILE: indexFile };
  await runner.run(['read-tree', head], false, env);

  const entries: CommittedEntry[] = [];
  for (const [position, entry] of resolved.entries()) {
    const mode = await fileMode(runner, head, entry.relativePath);
    if (entry.content === undefined) {
      await runner.run(['--literal-pathspecs', 'update-index', '--force-remove', '--', entry.relativePath], false, env);
      entries.push({ relativePath: entry.relativePath, mode });
      continue;
    }
    const blobFile = nodePath.join(scratch, `blob-${position}`);
    await fs.writeFile(blobFile, entry.content, 'utf8');
    const sha = text(await runner.run(['hash-object', '-w', '--path', entry.relativePath, '--', blobFile]));
    await runner.run(['update-index', '--add', '--cacheinfo', `${mode},${sha},${entry.relativePath}`], false, env);
    entries.push({ relativePath: entry.relativePath, mode, sha });
  }

  const tree = text(await runner.run(['write-tree'], false, env));
  const commit = text(await runner.run(['commit-tree', tree, '-p', head, '-m', message]));
  return { commit, entries };
}

/**
 * Points the real index at what was just committed, for these paths only.
 *
 * Every other entry is left exactly as it was, so staged work elsewhere in the
 * repository survives untouched.
 */
async function syncIndex(runner: GitRunner, entries: readonly CommittedEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.sha) {
      await runner.run(['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.sha},${entry.relativePath}`]);
    } else {
      await runner.run(['--literal-pathspecs', 'update-index', '--force-remove', '--', entry.relativePath]);
    }
  }
}

/** Splits a NUL-separated name list. */
function names(result: { stdout: Buffer }): string[] {
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

/** The file's mode at HEAD, so an executable bit is not quietly dropped. */
async function fileMode(runner: GitRunner, head: string, relativePath: string): Promise<string> {
  const entry = text(await runner.run(['--literal-pathspecs', 'ls-tree', head, '--', relativePath], true));
  const mode = entry.split(/\s+/)[0];
  return /^\d{6}$/.test(mode) ? mode : '100644';
}

/** The file's content at HEAD, or empty when it is not there. */
async function showAtHead(runner: GitRunner, relativePath: string): Promise<string> {
  return await showAtCommit(runner, 'HEAD', relativePath) ?? '';
}

/** The file's content at one commit, or undefined when absent. */
async function showAtCommit(runner: GitRunner, commit: string, relativePath: string): Promise<string | undefined> {
  const result = await runner.run(['--literal-pathspecs', 'show', `${commit}:${relativePath}`], true);
  return result.code === 0 ? result.stdout.toString('utf8') : undefined;
}

/** Reads a working-tree file as text, or undefined if missing or binary. */
async function readText(path: string): Promise<string | undefined> {
  try {
    const buffer = await fs.readFile(path);
    return buffer.includes(0) ? undefined : buffer.toString('utf8');
  } catch {
    return undefined;
  }
}

function text(result: { stdout: Buffer }): string {
  return result.stdout.toString('utf8').trim();
}
