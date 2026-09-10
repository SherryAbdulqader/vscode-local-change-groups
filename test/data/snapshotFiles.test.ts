import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { SnapshotFiles } from '../../src/data/snapshotFiles';

test('the same content is only stored once', async t => {
  const snapshots = await store(t);

  const first = await snapshots.write('hello\n');
  const second = await snapshots.write('hello\n');

  assert.equal(first, second);
});

test('a blob reads back exactly as it went in', async t => {
  const snapshots = await store(t);

  const hash = await snapshots.write('line one\nline two\n');

  assert.equal(await snapshots.read(hash), 'line one\nline two\n');
});

test('reading a hash that was never stored gives nothing', async t => {
  const snapshots = await store(t);

  assert.equal(await snapshots.read('a'.repeat(64)), undefined);
});

test('prune keeps what is still referenced and deletes the rest', async t => {
  const snapshots = await store(t);
  const keep = await snapshots.write('still in a frozen group\n');
  const orphan = await snapshots.write('left behind by a deleted group\n');

  await snapshots.prune(new Set([keep]));

  assert.equal(await snapshots.read(keep), 'still in a frozen group\n');
  assert.equal(await snapshots.read(orphan), undefined);
});

test('prune with nothing referenced empties the store', async t => {
  const snapshots = await store(t);
  const hash = await snapshots.write('nothing points here any more\n');

  await snapshots.prune(new Set());

  assert.equal(await snapshots.read(hash), undefined);
});

test('prune on a store that was never written to is not an error', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-blobs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.doesNotReject(new SnapshotFiles(path.join(root, 'never-created')).prune(new Set()));
});

async function store(t: test.TestContext): Promise<SnapshotFiles> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-blobs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new SnapshotFiles(path.join(root, 'frozen'));
}
