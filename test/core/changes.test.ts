import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedGroupId, collectChanges, UNGROUPED_KEY, ungroupedChanges } from '../../src/core/changes';
import type { CollectedChange } from '../../src/core/changes';
import { assignmentKey, relativeChangePath } from '../../src/core/repositoryPaths';
import type { GitChange, GitRepository } from '../../src/git/api';

test('relativeChangePath returns slash-separated paths', () => {
  const result = relativeChangePath('C:\\repo', 'C:\\repo\\src\\file.ts');
  assert.equal(result, 'src/file.ts');
});

test('relativeChangePath rejects files outside the repository', () => {
  assert.throws(() => relativeChangePath('C:\\repo', 'C:\\other\\file.ts'), /inside/);
});

test('relativeChangePath accepts filenames beginning with two dots', () => {
  assert.equal(relativeChangePath('C:\\repo', 'C:\\repo\\..config'), '..config');
});

test('assignmentKey is case-insensitive for Windows repository roots', () => {
  assert.equal(
    assignmentKey('C:\\Repo', 'src\\file.ts', 'win32'),
    assignmentKey('c:\\repo', 'src/file.ts', 'win32')
  );
});

test('assignmentKey preserves repository-root case on Linux', () => {
  assert.notEqual(
    assignmentKey('/Repo', 'src/file.ts', 'linux'),
    assignmentKey('/repo', 'src/file.ts', 'linux')
  );
});

test('collectChanges labels partially staged files and retains the working change', () => {
  const working = change('C:\\repo\\src\\file.ts', 0);
  const staged = change('C:\\repo\\src\\file.ts', 1);
  const [result] = collectChanges(repository([working], [staged], []));

  assert.equal(result.area, 'Working Tree + Staged');
  assert.equal(result.change, working);
});

test('collectChanges gives merge changes precedence over combined states', () => {
  const working = change('C:\\repo\\src\\file.ts', 0);
  const staged = change('C:\\repo\\src\\file.ts', 1);
  const merge = change('C:\\repo\\src\\file.ts', 12);
  const [result] = collectChanges(repository([working], [staged], [merge]));

  assert.equal(result.area, 'Merge');
  assert.equal(result.change, working);
});

test('collectChanges retains the original assignment key for a rename', () => {
  const renamed = change('C:\\repo\\src\\new.ts', 3);
  renamed.originalUri = { fsPath: 'C:\\repo\\src\\old.ts' } as GitChange['uri'];
  const [result] = collectChanges(repository([renamed], [], []));
  assert.deepEqual(result.assignmentKeys, [
    assignmentKey('C:\\repo', 'src/new.ts'),
    assignmentKey('C:\\repo', 'src/old.ts')
  ]);
  const oldKey = assignmentKey('C:\\repo', 'src/old.ts');
  assert.equal(assignedGroupId(result, key => key === oldKey ? 'local-only' : undefined), 'local-only');
});

test('ungroupedChanges returns just the Ungrouped bucket when nothing is frozen', () => {
  const grouped = new Map([
    [UNGROUPED_KEY, [collected('src/a.ts')]],
    ['group-1', [collected('src/b.ts')]]
  ]);

  assert.deepEqual(paths(ungroupedChanges(grouped, new Set(), never)), ['src/a.ts']);
});

test('a frozen file stays out of Ungrouped while it is still parked', () => {
  const grouped = new Map([
    [UNGROUPED_KEY, [collected('src/a.ts')]],
    ['frozen-group', [collected('src/parked.ts')]]
  ]);

  const result = ungroupedChanges(grouped, new Set(['frozen-group']), never);

  // The whole point of a freeze. The frozen group is already showing this file,
  // so listing it here too would put the same change on screen twice.
  assert.deepEqual(paths(result), ['src/a.ts']);
});

test('a frozen file comes back into Ungrouped once there is something new in it', () => {
  const grouped = new Map([
    [UNGROUPED_KEY, [collected('src/b.ts')]],
    ['frozen-group', [collected('src/a.ts'), collected('src/parked.ts')]],
    ['live-group', [collected('src/c.ts')]]
  ]);

  const result = ungroupedChanges(
    grouped,
    new Set(['frozen-group']),
    change => change.relativePath === 'src/a.ts'
  );

  // Only the edited one returns, sorted in with the rest. The still-parked file
  // and the live group are both left alone.
  assert.deepEqual(paths(result), ['src/a.ts', 'src/b.ts']);
});

test('ungroupedChanges does not double-count if the sentinel is marked frozen', () => {
  const grouped = new Map([[UNGROUPED_KEY, [collected('src/a.ts')]]]);

  const result = ungroupedChanges(grouped, new Set([UNGROUPED_KEY]), always);

  assert.deepEqual(paths(result), ['src/a.ts']);
});

test('ungroupedChanges never hands back the array it was given', () => {
  const bucket = [collected('src/a.ts')];
  const grouped = new Map([[UNGROUPED_KEY, bucket]]);

  const result = ungroupedChanges(grouped, new Set(), never);
  result.push(collected('src/b.ts'));

  // The tree hands over its cached grouping, so a caller that sorts or splices
  // the result must not be quietly editing what the next repaint will draw.
  assert.equal(bucket.length, 1);
});

/** Nothing has been touched since it was frozen. */
const never = () => false;

/** Everything has. */
const always = () => true;

/** Only relativePath matters to the grouping rules under test. */
function collected(relativePath: string): CollectedChange {
  return { relativePath } as CollectedChange;
}

function paths(changes: CollectedChange[]): string[] {
  return changes.map(item => item.relativePath);
}

function change(fsPath: string, status: number): GitChange {
  return { uri: { fsPath } as GitChange['uri'], status };
}

function repository(
  workingTreeChanges: GitChange[],
  indexChanges: GitChange[],
  mergeChanges: GitChange[]
): GitRepository {
  return {
    rootUri: { fsPath: 'C:\\repo' } as GitRepository['rootUri'],
    state: {
      workingTreeChanges,
      indexChanges,
      mergeChanges,
      onDidChange: (() => ({ dispose() {} })) as GitRepository['state']['onDidChange']
    },
    add: async () => {},
    revert: async () => {},
    clean: async () => {},
    commit: async () => {},
    push: async () => {},
    status: async () => {}
  };
}
