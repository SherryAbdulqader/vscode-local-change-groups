import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { GitChange, GitRepository } from './api';
import { GitRunner } from './runner';

/**
 * The careful part.
 *
 * Committing "just this group" means running Git against a subset of paths while
 * everything else in the index stays exactly as the user left it — including
 * hunks they staged by hand in files we are not touching. Git is perfectly
 * capable of doing that. What it will not do is notice when the world moved
 * underneath us halfway through.
 *
 * So the shape of every operation here is: take a snapshot, check the snapshot
 * still matches the plan the user confirmed, do one step, check again. If a
 * check fails we stop and say so rather than pressing on and hoping. It is more
 * paranoid than it looks, and it is that way because the failure mode is
 * somebody's uncommitted work.
 *
 * Two rules worth stating outright:
 *   - Unrelated index records are compared byte for byte, before and after.
 *   - A rollback only ever unstages paths *this* operation staged, and only
 *     while the branch and HEAD are still where we found them.
 */

export type OperationKind = 'stage' | 'commit' | 'push';
export interface GroupOperationPlan {
  kind: OperationKind;
  repositoryRoot: string;
  paths: string[];
  baseCommit?: string;
  branch?: string;
  remote?: string;
  upstreamBranch?: string;
  ahead?: number;
  behind?: number;
}

interface IndexRecord { raw: Buffer; path: string; }
interface GitSnapshot {
  branch: string;
  head: string;
  remote?: string;
  upstreamBranch?: string;
  ahead?: number;
  behind?: number;
  index: IndexRecord[];
}

const busyRepositories = new Set<string>();

/**
 * Claims a repository so two group actions cannot run at once.
 *
 * Returns the release, which is safe to call twice — it lives in a `finally`,
 * and those have a way of running more often than you planned.
 */
export function acquireRepositoryLock(repositoryRoot: string): () => void {
  const key = normalizedRoot(repositoryRoot);
  if (busyRepositories.has(key)) throw new Error('Another group action is already running for this repository.');
  busyRepositories.add(key);
  let released = false;
  return () => {
    if (!released) busyRepositories.delete(key);
    released = true;
  };
}

/**
 * Works out what an operation *would* do, and refuses early if it should not.
 *
 * Nothing here writes anything. The result gets shown to the user, and then
 * checked again against live state before any Git command runs — because they
 * might have taken a while to read it.
 */
export function buildOperationPlan(repository: GitRepository, changes: GitChange[], kind: OperationKind): GroupOperationPlan {
  if (!repository?.rootUri?.fsPath) throw new Error('A Git repository is required.');
  if (!changes?.length) throw new Error('The selected group has no changes in this repository.');
  assertApiOperationState(repository);
  if (changes.some(change => change.status >= 12)) throw new Error('Resolve all conflicts before running a group action.');
  const paths = expandChangePaths(repository.rootUri.fsPath, changes);
  assertNoGroupedPartialStaging(repository, paths);
  const head = repository.state.HEAD;
  if (kind !== 'stage' && !head?.name) throw new Error('Check out a named branch before committing or pushing.');
  if (kind === 'push') {
    if (!head?.upstream?.remote || !head.upstream.name) throw new Error('The current branch needs a configured upstream first.');
    assertSynchronized(head.ahead, head.behind, 0, 'before commit');
  }
  return {
    kind,
    repositoryRoot: normalizedRoot(repository.rootUri.fsPath),
    paths,
    baseCommit: head?.commit,
    branch: head?.name,
    remote: head?.upstream?.remote,
    upstreamBranch: head?.upstream?.name,
    ahead: head?.ahead,
    behind: head?.behind
  };
}

/**
 * Does the thing, re-checking reality at every step.
 *
 * Reads as a lot of assertions for one `git commit`, and that is the point.
 * Between the user confirming and the commit landing, a watcher, a hook, another
 * editor window, or a rebase in a terminal can all move the ground. Each check
 * is here because pressing on regardless could quietly commit or push something
 * nobody chose.
 *
 * The rollback only touches paths this operation staged itself, and only if the
 * branch and HEAD have not moved. Undoing someone else's staging while trying to
 * be helpful would be a genuinely terrible outcome.
 */
export async function executeGroupOperation(
  repository: GitRepository,
  preview: GroupOperationPlan,
  gitExecutable: string,
  message?: string,
  push = false
): Promise<void> {
  const requestedKind: OperationKind = message === undefined ? 'stage' : push ? 'push' : 'commit';
  if (preview.kind !== requestedKind) throw new Error('The confirmed group action does not match the requested operation.');
  if (message !== undefined && Buffer.byteLength(message, 'utf8') > 10_000) throw new Error('Commit messages cannot exceed 10,000 bytes.');
  const lockKey = normalizedRoot(repository.rootUri.fsPath);
  const release = acquireRepositoryLock(lockKey);
  const runner = new GitRunner(gitExecutable, repository.rootUri.fsPath);
  try {
    await repository.status();
    const live = buildOperationPlan(repository, findPlanChanges(repository, preview.paths), preview.kind);
    assertPlanUnchanged(preview, live);
    const before = await captureSnapshot(runner, repository, preview.kind === 'push');
    assertSnapshotMatchesPlan(before, preview);
    if (preview.kind === 'push') assertSynchronized(before.ahead, before.behind, 0, 'before commit');
    const group = new Set(preview.paths);
    const unrelated = recordsOutside(before.index, group);
    const initiallyStaged = new Set(expandChangePaths(repository.rootUri.fsPath, repository.state.indexChanges));
    const owned = preview.paths.filter(path => !initiallyStaged.has(path));
    let committed = false;
    try {
      await runner.run(['--literal-pathspecs', 'add', '-A', '--', ...preview.paths]);
      await assertUnrelatedIndex(runner, unrelated, group);
      if (message === undefined) return;

      await repository.status();
      assertApiOperationState(repository);
      const preCommit = await captureSnapshot(runner, repository, preview.kind === 'push');
      assertSameBranchAndHead(before, preCommit);
      assertSameUpstream(before, preCommit);
      await assertUnrelatedIndex(runner, unrelated, group);
      await runner.run(['--literal-pathspecs', 'commit', '--only', '-m', message, '--', ...preview.paths]);
      committed = true;
    } catch (error) {
      if (!committed) await rollbackOwned(runner, before, owned, error);
      throw error;
    }

    const after = await captureSnapshot(runner, repository, false);
    assertSameBranch(before, after);
    const parents = words((await runner.run(['rev-list', '--parents', '-n', '1', after.head])).stdout);
    if (parents.length !== 2 || parents[0] !== after.head || parents[1] !== before.head) {
      throw new Error('The new commit is not exactly one direct child of the captured HEAD. Push was blocked; inspect the repository.');
    }
    const committedPaths = nulPaths((await runner.run(['--literal-pathspecs', 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', after.head])).stdout);
    assertPathSet(committedPaths, preview.paths, 'The commit contains paths outside the selected group. Push was blocked; inspect the repository.');
    await assertUnrelatedIndex(runner, unrelated, group);
    if (!push) return;

    await repository.status();
    assertApiOperationState(repository);
    const pushSnapshot = await captureSnapshot(runner, repository, true);
    assertSameBranch(after, pushSnapshot);
    if (pushSnapshot.head !== after.head) throw new Error('HEAD changed after commit. Push was blocked; inspect the repository.');
    assertSameUpstream(before, pushSnapshot);
    assertSynchronized(repository.state.HEAD?.ahead, repository.state.HEAD?.behind, 1, 'before push');
    assertSynchronized(pushSnapshot.ahead, pushSnapshot.behind, 1, 'before push');
    await assertUnrelatedIndex(runner, unrelated, group);
    await repository.push(before.remote!, `${before.branch}:${before.upstreamBranch}`, false);
    await repository.status();
  } finally {
    release();
  }
}

/** Turns changes into repo-relative paths, keeping both sides of a rename. */
export function expandChangePaths(repositoryRoot: string, changes: GitChange[]): string[] {
  const result = new Set<string>();
  for (const change of changes) {
    for (const uri of [change.originalUri, change.renameUri, change.uri].filter(Boolean) as Array<{ fsPath: string }>) {
      result.add(safeRelativePath(repositoryRoot, uri.fsPath));
    }
  }
  return [...result].sort();
}

function assertApiOperationState(repository: GitRepository): void {
  if (repository.state.mergeChanges.length || repository.state.rebaseCommit) throw new Error('Finish or abort the current Git operation first.');
}

function assertNoGroupedPartialStaging(repository: GitRepository, paths: string[]): void {
  const group = new Set(paths);
  const index = new Set(expandChangePaths(repository.rootUri.fsPath, repository.state.indexChanges));
  const working = new Set(expandChangePaths(repository.rootUri.fsPath, repository.state.workingTreeChanges));
  const partial = [...group].filter(path => index.has(path) && working.has(path));
  if (partial.length) throw new Error(`Grouped files are partially staged: ${partial.join(', ')}. Commit or unstage their hunks first.`);
}

async function captureSnapshot(runner: GitRunner, repository: GitRepository, requireUpstream: boolean): Promise<GitSnapshot> {
  const actualRoot = line((await runner.run(['rev-parse', '--show-toplevel'])).stdout);
  if (normalizedRoot(actualRoot) !== normalizedRoot(runner.root)) throw new Error('Git resolved a different repository root.');
  const branch = line((await runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout);
  const head = line((await runner.run(['rev-parse', '--verify', 'HEAD^{commit}'])).stdout);
  if (!branch || !head) throw new Error('Unborn and detached branches are not supported.');
  await assertNoGitOperation(runner);
  if ((await runner.run(['ls-files', '--unmerged', '-z'])).stdout.length) throw new Error('Resolve all conflicts before running a group action.');
  const upstream = line((await runner.run(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', `refs/heads/${branch}`])).stdout);
  const [remote, remoteRef] = upstream.split('\0');
  const upstreamBranch = remoteRef?.startsWith('refs/heads/') ? remoteRef.slice('refs/heads/'.length) : undefined;
  if (requireUpstream && (!remote || !upstreamBranch)) throw new Error('The current branch needs a configured upstream first.');
  let ahead: number | undefined;
  let behind: number | undefined;
  if (remote && upstreamBranch) {
    const counts = words((await runner.run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).stdout).map(Number);
    [ahead, behind] = counts;
  }
  return { branch, head, remote: remote || undefined, upstreamBranch, ahead, behind, index: parseIndex((await runner.run(['ls-files', '--stage', '-z'])).stdout) };
}

async function assertNoGitOperation(runner: GitRunner): Promise<void> {
  for (const ref of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if ((await runner.run(['rev-parse', '--quiet', '--verify', ref], true)).stdout.length) throw new Error('Finish or abort the current Git operation first.');
  }
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const path = line((await runner.run(['rev-parse', '--git-path', name])).stdout);
    if (path && await exists(nodePath.isAbsolute(path) ? path : nodePath.join(runner.root, path))) throw new Error('Finish or abort the current rebase first.');
  }
}

async function rollbackOwned(runner: GitRunner, before: GitSnapshot, owned: string[], primary: unknown): Promise<never> {
  if (!owned.length) throw primary;
  try {
    const branch = line((await runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout);
    const head = line((await runner.run(['rev-parse', '--verify', 'HEAD^{commit}'])).stdout);
    if (branch !== before.branch || head !== before.head) throw new Error('branch or HEAD changed; no rollback was attempted');
    await runner.run(['--literal-pathspecs', 'restore', '--staged', `--source=${before.head}`, '--', ...owned]);
  } catch (rollback) {
    throw new Error(`${errorMessage(primary)} Rollback also failed: ${errorMessage(rollback)}`);
  }
  throw primary;
}

async function assertUnrelatedIndex(runner: GitRunner, expected: IndexRecord[], group: Set<string>): Promise<void> {
  const actual = recordsOutside(parseIndex((await runner.run(['ls-files', '--stage', '-z'])).stdout), group);
  if (!Buffer.concat(actual.map(record => record.raw)).equals(Buffer.concat(expected.map(record => record.raw)))) {
    throw new Error('Unrelated staged index records changed. The action was stopped.');
  }
}

function parseIndex(output: Buffer): IndexRecord[] {
  const records: IndexRecord[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    const value = output.subarray(start, index);
    start = index + 1;
    if (!value.length) continue;
    const tab = value.indexOf(9);
    if (tab < 0) throw new Error('Git returned an invalid index record.');
    records.push({ raw: output.subarray(index - value.length, index + 1), path: value.subarray(tab + 1).toString('utf8') });
  }
  if (start !== output.length) throw new Error('Git returned an unterminated index record.');
  return records;
}

function recordsOutside(records: IndexRecord[], group: Set<string>): IndexRecord[] { return records.filter(record => !group.has(record.path)); }
function nulPaths(output: Buffer): string[] { return output.toString('utf8').split('\0').filter(Boolean).sort(); }
function words(output: Buffer): string[] { return output.toString('utf8').trim().split(/\s+/).filter(Boolean); }
function line(output: Buffer): string { return output.toString('utf8').trim(); }
async function exists(path: string): Promise<boolean> { try { await fs.stat(path); return true; } catch { return false; } }

function assertSameBranch(left: GitSnapshot, right: GitSnapshot): void {
  if (left.branch !== right.branch) throw new Error('The current branch changed. The action was stopped.');
}
function assertSameBranchAndHead(left: GitSnapshot, right: GitSnapshot): void {
  assertSameBranch(left, right);
  if (left.head !== right.head) throw new Error('HEAD changed before commit. The action was stopped.');
}
function assertSameUpstream(left: GitSnapshot, right: GitSnapshot): void {
  if (left.remote !== right.remote || left.upstreamBranch !== right.upstreamBranch) throw new Error('The upstream changed. The action was stopped.');
}
function assertSnapshotMatchesPlan(snapshot: GitSnapshot, plan: GroupOperationPlan): void {
  if (snapshot.branch !== plan.branch || snapshot.head !== plan.baseCommit) throw new Error('Branch or HEAD changed after confirmation.');
  if (plan.kind === 'push' && (snapshot.remote !== plan.remote || snapshot.upstreamBranch !== plan.upstreamBranch)) throw new Error('The upstream changed after confirmation.');
}
function assertSynchronized(ahead: number | undefined, behind: number | undefined, expectedAhead: number, when: string): void {
  if (ahead === undefined || behind === undefined) throw new Error(`Branch synchronization is unknown ${when}.`);
  if (ahead !== expectedAhead || behind !== 0) throw new Error(`Branch must be exactly ${expectedAhead} ahead and 0 behind ${when}.`);
}
function assertPathSet(actual: string[], expected: string[], message: string): void {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) throw new Error(message);
}

function findPlanChanges(repository: GitRepository, paths: string[]): GitChange[] {
  const expected = new Set(paths);
  const all = [...repository.state.workingTreeChanges, ...(repository.state.untrackedChanges ?? []), ...repository.state.indexChanges, ...repository.state.mergeChanges];
  const selected = all.filter(change => expandChangePaths(repository.rootUri.fsPath, [change]).some(path => expected.has(path)));
  assertPathSet(expandChangePaths(repository.rootUri.fsPath, selected), paths, 'The selected group changed before the action started.');
  return selected;
}

function assertPlanUnchanged(preview: GroupOperationPlan, live: GroupOperationPlan): void {
  for (const field of ['kind', 'repositoryRoot', 'baseCommit', 'branch', 'remote', 'upstreamBranch', 'ahead', 'behind'] as const) {
    if (preview[field] !== live[field]) throw new Error('Repository state changed. Review and confirm again.');
  }
  assertPathSet(live.paths, preview.paths, 'The selected group changed before the action started.');
}

function normalizedRoot(root: string): string { const value = nodePath.resolve(root).replace(/\\/g, '/'); return process.platform === 'win32' ? value.toLowerCase() : value; }
function safeRelativePath(root: string, file: string): string {
  if (!root?.trim() || !file?.trim() || file.includes('\0')) throw new Error('A grouped change contains an unsafe path.');
  const relative = nodePath.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) throw new Error('A grouped change contains a path outside the repository.');
  return relative.split(nodePath.sep).join('/');
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
