import assert from 'node:assert/strict';
import test from 'node:test';
import { comparablePath, directoryLabel, groupColorId, parseUriListEntries, statusBadge, statusColorId, statusLabel } from '../src/presentation';

test('statusBadge renders the Source Control letter for each status', () => {
  assert.equal(statusBadge(0), 'M');
  assert.equal(statusBadge(1), 'A');
  assert.equal(statusBadge(5), 'M');
  assert.equal(statusBadge(6), 'D');
  assert.equal(statusBadge(7), 'U');
  assert.equal(statusBadge(10), 'R');
  assert.equal(statusBadge(18), 'C');
});

test('statusBadge falls back to Modified for unknown statuses', () => {
  assert.equal(statusBadge(99), 'M');
  assert.equal(statusLabel(99), 'Changed');
});

test('statusColorId separates untracked, added, and modified files', () => {
  assert.equal(statusColorId(7), 'gitDecoration.untrackedResourceForeground');
  assert.equal(statusColorId(1), 'gitDecoration.addedResourceForeground');
  assert.equal(statusColorId(5), 'gitDecoration.modifiedResourceForeground');
  assert.equal(statusColorId(6), 'gitDecoration.deletedResourceForeground');
  assert.equal(statusColorId(12), 'gitDecoration.conflictingResourceForeground');
});

test('groupColorId points at a contributed palette color', () => {
  assert.equal(groupColorId('purple'), 'localChangeGroups.purple');
});

test('directoryLabel is empty for repository-root files', () => {
  assert.equal(directoryLabel('package.json', '\\'), '');
});

test('directoryLabel renders the parent folder with the platform separator', () => {
  assert.equal(directoryLabel('src/pages/The Codex/lib.js', '\\'), 'src\\pages\\The Codex');
  assert.equal(directoryLabel('src/pages/lib.js', '/'), 'src/pages');
});

test('directoryLabel rejects an empty path', () => {
  assert.throws(() => directoryLabel('   '), /relative path/);
});

test('parseUriListEntries drops blank lines and comments', () => {
  const entries = parseUriListEntries('# comment\r\nfile:///c%3A/repo/a.ts\r\n\r\n  file:///c%3A/repo/b.ts  ');
  assert.deepEqual(entries, ['file:///c%3A/repo/a.ts', 'file:///c%3A/repo/b.ts']);
});

test('comparablePath ignores separator and case differences on Windows', () => {
  assert.equal(
    comparablePath('C:\\Repo\\Src\\File.ts', 'win32'),
    comparablePath('c:/repo/src/file.ts', 'win32')
  );
});

test('comparablePath preserves case on Linux', () => {
  assert.notEqual(comparablePath('/repo/File.ts', 'linux'), comparablePath('/repo/file.ts', 'linux'));
});
