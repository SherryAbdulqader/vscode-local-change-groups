import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_ICONS, normalizeGroupIcon, normalizeGroupName, normalizePersistedState } from '../src/model';

test('normalizeGroupName trims and collapses spaces', () => {
  assert.equal(normalizeGroupName('  Ready   for GitHub  '), 'Ready for GitHub');
});

test('normalizeGroupName rejects empty names', () => {
  assert.throws(() => normalizeGroupName('   '), /required/);
});

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

test('normalizeGroupIcon accepts codicon ids and lowercases them', () => {
  assert.equal(normalizeGroupIcon('beaker'), 'beaker');
  assert.equal(normalizeGroupIcon('  Symbol-Color  '), 'symbol-color');
  assert.equal(normalizeGroupIcon('star-full'), 'star-full');
});

test('normalizeGroupIcon rejects decorated or malformed ids', () => {
  assert.throws(() => normalizeGroupIcon('$(beaker)'), /codicon id/);
  assert.throws(() => normalizeGroupIcon('two words'), /codicon id/);
  assert.throws(() => normalizeGroupIcon('trailing-'), /codicon id/);
  assert.throws(() => normalizeGroupIcon(''), /codicon id/);
  assert.throws(() => normalizeGroupIcon('a'.repeat(41)), /40 characters/);
});

test('every offered group icon is a valid id', () => {
  for (const icon of GROUP_ICONS) {
    assert.equal(normalizeGroupIcon(icon.id), icon.id);
    assert.ok(icon.hint.trim().length > 0);
  }
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
