import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_ICONS, normalizeGroupIcon, normalizeGroupName, suggestedBranchName } from '../../src/core/groups';

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

test('a branch name is suggested from the group name', () => {
  assert.equal(suggestedBranchName('Auth rewrite'), 'auth-rewrite');
  assert.equal(suggestedBranchName('Fix #123: the login bug!'), 'fix-123-the-login-bug');
});

test('a suggested branch name never ends or starts with a dash', () => {
  // Git rejects both, and the whole point is to offer something that works.
  assert.equal(suggestedBranchName('  spaced  '), 'spaced');
  assert.equal(suggestedBranchName('!!!leading'), 'leading');
});

test('a group name with nothing usable in it still gets a suggestion', () => {
  assert.equal(suggestedBranchName('🚀🚀🚀'), 'change-group');
});

test('a very long group name is trimmed to something workable', () => {
  const suggestion = suggestedBranchName('a'.repeat(80));

  assert.ok(suggestion.length <= 40);
  assert.ok(!suggestion.endsWith('-'));
});
