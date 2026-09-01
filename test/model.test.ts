import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGroupName, normalizePersistedState } from '../src/model';

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
    groups: [{ id: 'one', name: 'Local' }],
    assignments: { valid: 'one' }
  });
});
