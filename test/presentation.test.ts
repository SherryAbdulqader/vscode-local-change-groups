import assert from 'node:assert/strict';
import test from 'node:test';
import { comparablePath, directoryLabel, groupColorId, isInSection, parseUriListEntries, partitionForDiscard, sectionLabel, statusBadge, statusColorId, statusLabel } from '../src/presentation';

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

test('a partially staged file belongs to both sections', () => {
  assert.equal(isInSection('Working Tree + Staged', 'staged'), true);
  assert.equal(isInSection('Working Tree + Staged', 'unstaged'), true);
});

test('a purely staged file is absent from the working-tree section', () => {
  assert.equal(isInSection('Staged', 'staged'), true);
  assert.equal(isInSection('Staged', 'unstaged'), false);
});

test('working-tree and merge changes stay out of the staged section', () => {
  assert.equal(isInSection('Working Tree', 'staged'), false);
  assert.equal(isInSection('Working Tree', 'unstaged'), true);
  assert.equal(isInSection('Merge', 'staged'), false);
  assert.equal(isInSection('Merge', 'unstaged'), true);
});

test('sectionLabel matches the Source Control headers', () => {
  assert.equal(sectionLabel('staged'), 'Staged Changes');
  assert.equal(sectionLabel('unstaged'), 'Changes');
});

test('partitionForDiscard separates deletions from reverts and skips staged-only files', () => {
  const items = [
    { area: 'Working Tree' as const, status: 5 },
    { area: 'Working Tree' as const, status: 7 },
    { area: 'Staged' as const, status: 0 },
    { area: 'Working Tree + Staged' as const, status: 5 }
  ];
  const result = partitionForDiscard(items, item => item.area, item => item.status);
  assert.deepEqual(result.restore, [items[0], items[3]]);
  assert.deepEqual(result.remove, [items[1]]);
  assert.deepEqual(result.skip, [items[2]]);
});

test('partitionForDiscard returns empty buckets for an empty selection', () => {
  const result = partitionForDiscard([], () => 'Working Tree', () => 5);
  assert.deepEqual(result, { restore: [], remove: [], skip: [] });
});
