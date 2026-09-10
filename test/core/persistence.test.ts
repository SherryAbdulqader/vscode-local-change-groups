import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotBelongsTo } from '../../src/core/frozen';
import { normalizePersistedState } from '../../src/core/persistence';

test('normalizePersistedState removes dangling assignments', () => {
  assert.deepEqual(normalizePersistedState({
    groups: [{ id: 'one', name: 'Local' }],
    assignments: { valid: 'one', dangling: 'two' }
  }), {
    groups: [{ id: 'one', name: 'Local', color: 'blue' }],
    assignments: { valid: 'one' },
    frozen: {},
    autoAssigned: []
  });
});

test('normalizePersistedState preserves valid colors and migrates missing colors', () => {
  assert.deepEqual(normalizePersistedState({
    groups: [{ id: 'old', name: 'Old' }, { id: 'new', name: 'New', color: 'purple' }],
    assignments: {}
  }).groups, [
    { id: 'old', name: 'Old', color: 'blue' },
    { id: 'new', name: 'New', color: 'purple' }
  ]);
});

test('persisted state keeps a valid icon and drops a malformed one', () => {
  const state = normalizePersistedState({
    groups: [
      { id: 'a', name: 'Tests', color: 'green', icon: 'beaker' },
      { id: 'b', name: 'Fixes', color: 'red', icon: '$(bug)' },
      { id: 'c', name: 'Plain', color: 'blue' }
    ],
    assignments: {}
  });
  assert.equal(state.groups[0].icon, 'beaker');
  assert.equal(state.groups[1].icon, undefined);
  assert.equal(state.groups[2].icon, undefined);
});

/** A snapshot the guard should accept, used as the baseline below. */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    frozenAt: 1_700_000_000_000,
    repositoryRoot: 'C:\repo',
    files: [{
      fileKey: 'c:/repo::src/a.ts',
      relativePath: 'src/a.ts',
      status: 5,
      area: 'Working Tree',
      frozenHash: 'a'.repeat(64),
      baseHash: 'b'.repeat(64)
    }],
    ...overrides
  };
}

test('a valid snapshot survives a round trip through storage', () => {
  const state = normalizePersistedState({
    groups: [{ id: 'one', name: 'Problem 1', color: 'blue' }],
    assignments: {},
    frozen: { one: snapshot() }
  });
  assert.equal(state.frozen.one.files.length, 1);
  assert.equal(state.frozen.one.files[0].frozenHash, 'a'.repeat(64));
  assert.equal(state.frozen.one.files[0].baseHash, 'b'.repeat(64));
});

test('a snapshot for a group that no longer exists is dropped', () => {
  const state = normalizePersistedState({
    groups: [{ id: 'one', name: 'Problem 1', color: 'blue' }],
    assignments: {},
    frozen: { gone: snapshot() }
  });
  assert.deepEqual(state.frozen, {});
});

test('a snapshot with an unusable hash is dropped rather than half-loaded', () => {
  const bad = snapshot({ files: [{ ...snapshot().files[0], frozenHash: 'not-a-hash' }] });
  const state = normalizePersistedState({
    groups: [{ id: 'one', name: 'Problem 1', color: 'blue' }],
    assignments: {},
    frozen: { one: bad }
  });
  assert.equal(state.frozen.one, undefined);
});

test('a malformed base hash only costs the base side, not the whole entry', () => {
  const partial = snapshot({ files: [{ ...snapshot().files[0], baseHash: 'nope' }] });
  const state = normalizePersistedState({
    groups: [{ id: 'one', name: 'Problem 1', color: 'blue' }],
    assignments: {},
    frozen: { one: partial }
  });
  assert.equal(state.frozen.one.files[0].baseHash, undefined);
  assert.equal(state.frozen.one.files[0].frozenHash, 'a'.repeat(64));
});

test('a snapshot belongs to the repository it was taken in', () => {
  const snapshot = { frozenAt: 1, repositoryRoot: '/work/api', files: [] };

  assert.equal(snapshotBelongsTo(snapshot, '/work/api', 'linux'), true);
  assert.equal(snapshotBelongsTo(snapshot, '/work/web', 'linux'), false);
});

test('a snapshot matches its repository however Windows spells the path', () => {
  const snapshot = { frozenAt: 1, repositoryRoot: 'C:/Work/Api', files: [] };

  assert.equal(snapshotBelongsTo(snapshot, 'c:/work/api', 'win32'), true);
});

test('a snapshot does not match a sibling repository with a similar name', () => {
  const snapshot = { frozenAt: 1, repositoryRoot: '/work/api', files: [] };

  // Prefix matching would call this a hit, and the second repository would then
  // show a frozen group whose files are nowhere under its root.
  assert.equal(snapshotBelongsTo(snapshot, '/work/api-client', 'linux'), false);
});
