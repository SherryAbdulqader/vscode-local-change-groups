import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePersistedState } from '../../src/core/persistence';

test('normalizePersistedState removes dangling assignments', () => {
  assert.deepEqual(normalizePersistedState({
    groups: [{ id: 'one', name: 'Local' }],
    assignments: { valid: 'one', dangling: 'two' }
  }), {
    groups: [{ id: 'one', name: 'Local', color: 'blue' }],
    assignments: { valid: 'one' }
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
