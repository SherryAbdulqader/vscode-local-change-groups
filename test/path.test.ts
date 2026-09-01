import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedGroupId, assignmentKey, collectChanges, relativeChangePath } from '../src/path';
import type { GitChange, GitRepository } from '../src/git';

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
