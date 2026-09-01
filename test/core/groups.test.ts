import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_ICONS, normalizeGroupIcon, normalizeGroupName } from '../../src/core/groups';

test('normalizeGroupName trims and collapses spaces', () => {
  assert.equal(normalizeGroupName('  Ready   for GitHub  '), 'Ready for GitHub');
});

test('normalizeGroupName rejects empty names', () => {
  assert.throws(() => normalizeGroupName('   '), /required/);
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
