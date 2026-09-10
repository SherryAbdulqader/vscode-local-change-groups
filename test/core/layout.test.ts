import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalGroup } from '../../src/core/groups';
import { buildLayout, layoutGroupNames, readLayout } from '../../src/core/layout';

const groups: LocalGroup[] = [
  { id: 'id-tests', name: 'Tests', color: 'green', icon: 'beaker' },
  { id: 'id-docs', name: 'Docs', color: 'blue' }
];

test('an exported layout names groups rather than using local ids', () => {
  const layout = buildLayout(groups, new Map([['test/a.ts', 'id-tests']]));

  // Ids are UUIDs made on this machine, and mean nothing on anyone else's.
  assert.deepEqual(layout.files, { 'test/a.ts': 'Tests' });
  assert.deepEqual(layout.groups, [
    { name: 'Tests', color: 'green', icon: 'beaker' },
    { name: 'Docs', color: 'blue' }
  ]);
});

test('an export keeps the order the groups are shown in', () => {
  const layout = buildLayout(groups, new Map());

  assert.deepEqual(layout.groups.map(group => group.name), ['Tests', 'Docs']);
});

test('a file pointing at a group that is gone is left out', () => {
  const layout = buildLayout(groups, new Map([['a.ts', 'id-deleted']]));

  assert.deepEqual(layout.files, {});
});

test('a layout survives a round trip', () => {
  const layout = buildLayout(groups, new Map([['test/a.ts', 'id-tests']]));

  assert.deepEqual(readLayout(JSON.parse(JSON.stringify(layout))), layout);
});

test('a file from a future version is refused rather than half read', () => {
  assert.throws(() => readLayout({ version: 99, groups: [], files: {} }), /version/);
});

test('something that is not a layout at all is refused', () => {
  assert.throws(() => readLayout('nope'), /does not contain a group layout/);
  assert.throws(() => readLayout({ version: 1, groups: [], files: {} }), /no groups and no files/);
});

test('a group with a colour we do not have falls back instead of being dropped', () => {
  const layout = readLayout({ version: 1, groups: [{ name: 'Tests', color: 'chartreuse' }], files: {} });

  assert.deepEqual(layout.groups, [{ name: 'Tests', color: 'blue' }]);
});

test('two groups with one name are collapsed to the first', () => {
  const layout = readLayout({
    version: 1,
    groups: [{ name: 'Tests', color: 'green' }, { name: 'tests', color: 'red' }],
    files: {}
  });

  // Otherwise both would race to own the same files.
  assert.deepEqual(layout.groups, [{ name: 'Tests', color: 'green' }]);
});

test('imported paths are normalized to forward slashes', () => {
  const layout = readLayout({ version: 1, groups: [], files: { './src\\a.ts': 'Tests' } });

  assert.deepEqual(Object.keys(layout.files), ['src/a.ts']);
});

test('group names come from both the group list and the files', () => {
  const layout = readLayout({
    version: 1,
    groups: [{ name: 'Tests', color: 'green' }],
    files: { 'a.md': 'Docs', 'b.md': 'docs' }
  });

  // "Docs" was never declared as a group, but files point at it, so it still
  // has to be created on import. The second spelling is the same group.
  assert.deepEqual(layoutGroupNames(layout), ['Tests', 'Docs']);
});
