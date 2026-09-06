import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { GitChange, GitRepository } from '../../src/git/api';
import { acquireRepositoryLock, buildOperationPlan, executeGroupOperation, expandChangePaths } from '../../src/git/groupOperations';

const git = process.env.LOCAL_CHANGE_GROUPS_TEST_GIT || 'git';

test('repository lock rejects overlap and releases cleanly', () => {
  const release = acquireRepositoryLock(path.resolve('lock-repository'));
  assert.throws(() => acquireRepositoryLock(path.resolve('lock-repository')), /already running/);
  release();
  assert.doesNotThrow(() => acquireRepositoryLock(path.resolve('lock-repository'))());
});

test('path-scoped commit preserves unrelated full staged index records', async t => {
  const root = await repo(t, { 'group.txt': 'one\n', 'other.txt': 'base\n' });
  await fs.writeFile(path.join(root, 'group.txt'), 'two\n');
  await fs.writeFile(path.join(root, 'other.txt'), 'staged\n');
  await run(root, ['add', '--', 'other.txt']);
  const before = await indexRecords(root, ['other.txt']);
  const repository = mockRepository(root, [change(root, 'group.txt', 0)]);
  await repository.status();
  const plan = buildOperationPlan(repository, repository.state.workingTreeChanges, 'commit');
  await executeGroupOperation(repository, plan, git, 'group only');
  assert.deepEqual(await indexRecords(root, ['other.txt']), before);
  assert.deepEqual(await commitPaths(root), ['group.txt']);
});

test('path-scoped commit preserves unrelated partially staged index records', async t => {
  const root = await repo(t, { 'group.txt': 'one\n', 'other.txt': 'a\nb\n' });
  await fs.writeFile(path.join(root, 'other.txt'), 'A\nb\n');
  await run(root, ['add', '--', 'other.txt']);
  await fs.writeFile(path.join(root, 'other.txt'), 'A\nB\n');
  await fs.writeFile(path.join(root, 'group.txt'), 'two\n');
  const before = await indexRecords(root, ['other.txt']);
  const repository = mockRepository(root, [change(root, 'group.txt', 0)], [change(root, 'other.txt', 0)]);
  repository.state.indexChanges = [change(root, 'other.txt', 0)];
  await repository.status();
  const plan = buildOperationPlan(repository, repository.state.workingTreeChanges.filter(item => item.uri.fsPath.endsWith('group.txt')), 'commit');
  await executeGroupOperation(repository, plan, git, 'preserve partial');
  assert.deepEqual(await indexRecords(root, ['other.txt']), before);
  assert.deepEqual(await commitPaths(root), ['group.txt']);
});

test('commits grouped modified, untracked, deleted, and renamed paths only', async t => {
  const root = await repo(t, { 'modified.txt': 'old\n', 'deleted.txt': 'old\n', 'old.txt': 'old\n', 'outside.txt': 'old\n' });
  await fs.writeFile(path.join(root, 'modified.txt'), 'new\n');
  await fs.writeFile(path.join(root, 'new file [x].txt'), 'new\n');
  await fs.rm(path.join(root, 'deleted.txt'));
  await fs.rename(path.join(root, 'old.txt'), path.join(root, 'renamed.txt'));
  await fs.writeFile(path.join(root, 'outside.txt'), 'outside\n');
  const renamed = change(root, 'renamed.txt', 3);
  renamed.originalUri = uri(path.join(root, 'old.txt'));
  const changes = [change(root, 'modified.txt', 0), change(root, 'new file [x].txt', 7), change(root, 'deleted.txt', 2), renamed];
  const repository = mockRepository(root, [...changes, change(root, 'outside.txt', 0)]);
  await repository.status();
  const plan = buildOperationPlan(repository, changes, 'commit');
  await executeGroupOperation(repository, plan, git, 'special ! $ [message]');
  assert.deepEqual(await commitPaths(root), ['deleted.txt', 'modified.txt', 'new file [x].txt', 'old.txt', 'renamed.txt']);
  assert.equal((await run(root, ['status', '--porcelain=v1', '--', 'outside.txt'])).toString().trim(), 'M outside.txt');
});

test('grouped partial staging is rejected while unrelated partial staging is allowed', async t => {
  const root = await repo(t, { 'group.txt': 'base\n', 'other.txt': 'base\n' });
  const grouped = change(root, 'group.txt', 0);
  const repository = mockRepository(root, [grouped, change(root, 'other.txt', 0)]);
  repository.state.indexChanges = [change(root, 'group.txt', 0), change(root, 'other.txt', 0)];
  assert.throws(() => buildOperationPlan(repository, [grouped], 'commit'), /partially staged/);
  repository.state.indexChanges = [change(root, 'other.txt', 0)];
  assert.doesNotThrow(() => buildOperationPlan(repository, [grouped], 'commit'));
});

test('hook failure rolls back only extension-owned group paths', async t => {
  const root = await repo(t, { 'group.txt': 'base\n', 'other.txt': 'base\n' });
  await fs.writeFile(path.join(root, 'group.txt'), 'changed\n');
  await fs.writeFile(path.join(root, 'other.txt'), 'staged\n');
  await run(root, ['add', '--', 'other.txt']);
  const unrelated = await indexRecords(root, ['other.txt']);
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  await fs.writeFile(hook, process.platform === 'win32' ? '#!/bin/sh\nexit 1\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const repository = mockRepository(root, [change(root, 'group.txt', 0)]);
  await repository.status();
  const plan = buildOperationPlan(repository, repository.state.workingTreeChanges, 'commit');
  await assert.rejects(() => executeGroupOperation(repository, plan, git, 'blocked'));
  assert.deepEqual(await indexRecords(root, ['other.txt']), unrelated);
  assert.equal((await run(root, ['diff', '--cached', '--name-only', '--', 'group.txt'])).length, 0);
});

test('push uses explicit remote and local-to-upstream ref with no set-upstream', async t => {
  const root = await repo(t, { 'group.txt': 'base\n' });
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-remote-'));
  t.after(() => fs.rm(bare, { recursive: true, force: true }));
  await run(bare, ['init', '--bare']);
  await run(root, ['remote', 'add', 'origin', bare]);
  await run(root, ['push', '-u', 'origin', 'main']);
  await fs.writeFile(path.join(root, 'group.txt'), 'changed\n');
  const calls: string[] = [];
  const repository = mockRepository(root, [change(root, 'group.txt', 0)], [], calls);
  await repository.status();
  const plan = buildOperationPlan(repository, repository.state.workingTreeChanges, 'push');
  await executeGroupOperation(repository, plan, git, 'push group', true);
  assert.ok(calls.includes('push:origin:main:main:false'));
});


/**
 * A rename that is already staged has no old path left anywhere: git mv removed
 * it from both the index and the working tree. Git still reports the change with
 * both sides, and passing the vanished one as a pathspec used to abort the whole
 * action with a fatal error.
 */
test('a staged rename does not abort on its vanished old path', async t => {
  const root = await repo(t, { 'old.txt': 'one\n', 'other.txt': 'base\n' });
  await run(root, ['mv', 'old.txt', 'new.txt']);

  // Exactly what the Git extension reports for a staged rename: status 3, with
  // originalUri pointing at a path that no longer exists on disk or in the index.
  const renamed: GitChange = {
    uri: uri(path.join(root, 'new.txt')),
    originalUri: uri(path.join(root, 'old.txt')),
    status: 3
  };
  const repository = mockRepository(root, [], [renamed]);
  await repository.status();

  const plan = buildOperationPlan(repository, repository.state.indexChanges, 'commit');
  assert.ok(plan.paths.includes('old.txt'), 'both sides of the rename are planned');

  await executeGroupOperation(repository, plan, git, 'rename only');
  assert.deepEqual(await commitPaths(root), ['new.txt', 'old.txt']);
});

test('a group whose paths have all vanished fails with a clear message', async t => {
  const root = await repo(t, { 'gone.txt': 'one\n' });
  const repository = mockRepository(root, [change(root, 'gone.txt', 0)]);
  await repository.status();
  const plan = buildOperationPlan(repository, repository.state.workingTreeChanges, 'stage');
  await fs.rm(path.join(root, 'gone.txt'));
  await run(root, ['rm', '--cached', '--', 'gone.txt']);
  await assert.rejects(executeGroupOperation(repository, plan, git), /no longer exist|still exist/i);
});


/**
 * The heart of the split commit, exercised through git itself rather than a
 * mock: HEAD + A is frozen, B is added on top, and committing "since the
 * freeze" must produce HEAD + B while leaving A in the working tree.
 */
test('committing since a freeze leaves the frozen change uncommitted', async t => {
  const root = await repo(t, { 'auth.ts': 'one\ntwo\nthree\nfour\nfive\n' });
  const head = 'one\ntwo\nthree\nfour\nfive\n';
  const frozen = 'one\nA\nthree\nfour\nfive\n';        // edit A, near the top
  const current = 'one\nA\nthree\nfour\nB\n';          // edit B, near the bottom
  await fs.writeFile(path.join(root, 'auth.ts'), current);

  // What splitCommit does, in the same order, using the same git binary.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-split-test-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const ours = path.join(scratch, 'head');
  const base = path.join(scratch, 'frozen');
  const theirs = path.join(scratch, 'current');
  await fs.writeFile(ours, head);
  await fs.writeFile(base, frozen);
  await fs.writeFile(theirs, current);
  const merged = (await run(root, ['merge-file', '-p', '--diff3', ours, base, theirs])).toString();

  // HEAD + B: B applied, A absent.
  assert.equal(merged, 'one\ntwo\nthree\nfour\nB\n');
  assert.ok(!merged.includes('A'), 'the frozen edit is not in the commit content');

  const blob = path.join(scratch, 'blob');
  await fs.writeFile(blob, merged);
  const sha = (await run(root, ['hash-object', '-w', '--path', 'auth.ts', '--', blob])).toString().trim();
  const indexFile = path.join(scratch, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  await runEnv(root, ['read-tree', 'HEAD'], env);
  await runEnv(root, ['update-index', '--add', '--cacheinfo', `100644,${sha},auth.ts`], env);
  const tree = (await runEnv(root, ['write-tree'], env)).toString().trim();
  const headSha = (await run(root, ['rev-parse', 'HEAD'])).toString().trim();
  const commit = (await run(root, ['commit-tree', tree, '-p', headSha, '-m', 'edit B only'])).toString().trim();
  await run(root, ['update-ref', 'refs/heads/main', commit, headSha]);
  // Catch the real index up, exactly as splitCommit does. Skip this and git
  // reports phantom staged changes against the new HEAD.
  await run(root, ['update-index', '--add', '--cacheinfo', `100644,${sha},auth.ts`]);

  // The commit holds B and not A.
  const committed = (await run(root, ['show', 'HEAD:auth.ts'])).toString();
  assert.equal(committed, 'one\ntwo\nthree\nfour\nB\n');

  // The working tree is untouched, so A is still there, still uncommitted.
  assert.equal(await fs.readFile(path.join(root, 'auth.ts'), 'utf8'), current);
  const remaining = (await run(root, ['diff', '--', 'auth.ts'])).toString();
  assert.ok(remaining.includes('+A'), 'edit A remains as an uncommitted change');
  assert.ok(!remaining.includes('+B'), 'edit B is committed and no longer pending');
});

test('overlapping edits refuse to be split', async t => {
  const root = await repo(t, { 'auth.ts': 'one\ntwo\nthree\n' });
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-split-test-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  // A and B both rewrite line two, so no separation is possible.
  await fs.writeFile(path.join(scratch, 'head'), 'one\ntwo\nthree\n');
  await fs.writeFile(path.join(scratch, 'frozen'), 'one\nA\nthree\n');
  await fs.writeFile(path.join(scratch, 'current'), 'one\nB\nthree\n');
  const merged = (await runConflicting(root, ['merge-file', '-p', '--diff3',
    path.join(scratch, 'head'), path.join(scratch, 'frozen'), path.join(scratch, 'current')])).toString();
  assert.ok(merged.includes('<<<<<<<'), 'a conflict is reported rather than a silent guess');
});

function mockRepository(root: string, working: GitChange[], index: GitChange[] = [], calls: string[] = []): GitRepository {
  const repository: GitRepository = {
    rootUri: uri(root),
    state: {
      workingTreeChanges: working,
      indexChanges: index,
      mergeChanges: [],
      HEAD: { name: 'main', commit: '', ahead: 0, behind: 0 },
      onDidChange: (() => ({ dispose() {} })) as GitRepository['state']['onDidChange']
    },
    add: async () => {}, revert: async () => {}, clean: async () => {}, commit: async () => {},
    push: async (remote, branch, setUpstream) => { calls.push(`push:${remote}:${branch}:${setUpstream}`); },
    status: async () => {
      repository.state.HEAD!.commit = (await run(root, ['rev-parse', 'HEAD'])).toString().trim();
      const upstream = await runMaybe(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
      if (upstream.length) {
        const [remote, ...parts] = upstream.toString().trim().split('/');
        repository.state.HEAD!.upstream = { remote, name: parts.join('/') };
        const counts = (await run(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).toString().trim().split(/\s+/).map(Number);
        repository.state.HEAD!.ahead = counts[0];
        repository.state.HEAD!.behind = counts[1];
      }
    }
  };
  repository.state.HEAD!.commit = '';
  return repository;
}

async function repo(t: test.TestContext, files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await run(root, ['init', '-b', 'main']);
  await run(root, ['config', 'user.name', 'Local Change Groups Test']);
  await run(root, ['config', 'user.email', 'test@example.invalid']);
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(root, name), contents);
  await run(root, ['add', '.']);
  await run(root, ['commit', '-m', 'base']);
  return root;
}

async function run(root: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => execFile(git, args, { cwd: root, encoding: 'buffer', windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(Buffer.from(stderr).toString() || error.message)) : resolve(Buffer.from(stdout))));
}
async function runMaybe(root: string, args: string[]): Promise<Buffer> { try { return await run(root, args); } catch { return Buffer.alloc(0); } }
async function indexRecords(root: string, paths: string[]): Promise<Buffer> { return run(root, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths]); }
async function commitPaths(root: string): Promise<string[]> { return (await run(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'])).toString().split('\0').filter(Boolean).sort(); }
function uri(fsPath: string): GitChange['uri'] { return { fsPath } as GitChange['uri']; }
function change(root: string, name: string, status: number): GitChange { return { uri: uri(path.join(root, name)), status }; }

/** Like run, but with an explicit environment, for the scratch-index commands. */
async function runEnv(root: string, args: string[], env: NodeJS.ProcessEnv): Promise<Buffer> {
  return new Promise((resolve, reject) => execFile(git, args, { cwd: root, env, encoding: 'buffer', windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(Buffer.from(stderr).toString() || error.message)) : resolve(Buffer.from(stdout))));
}

/** Returns stdout even when git exits non-zero, as merge-file does on a conflict. */
async function runConflicting(root: string, args: string[]): Promise<Buffer> {
  return new Promise(resolve => execFile(git, args, { cwd: root, encoding: 'buffer', windowsHide: true }, (_error, stdout) => resolve(Buffer.from(stdout ?? ''))));
}
