import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { FrozenSnapshot } from '../../src/core/frozen';
import { driftedFrozenFiles, FrozenDrift, readWorkingFile } from '../../src/data/frozenDrift';
import { SnapshotFiles } from '../../src/data/snapshotFiles';

test('a file that still matches its snapshot has not drifted', async t => {
  const { snapshots, snapshot } = await frozen(t, 'parked\n');

  assert.deepEqual(await driftedFrozenFiles(snapshots, snapshot), []);
});

test('a file edited after the freeze has drifted', async t => {
  const { snapshots, snapshot, root } = await frozen(t, 'parked\n');
  await fs.writeFile(path.join(root, 'a.txt'), 'parked\nand more\n');

  const drifted = await driftedFrozenFiles(snapshots, snapshot);

  assert.deepEqual(drifted.map(file => file.relativePath), ['a.txt']);
});

test('a file deleted after the freeze counts as drifted', async t => {
  const { snapshots, snapshot, root } = await frozen(t, 'parked\n');
  await fs.rm(path.join(root, 'a.txt'));

  const drifted = await driftedFrozenFiles(snapshots, snapshot);

  assert.deepEqual(drifted.map(file => file.relativePath), ['a.txt']);
});

test('readWorkingFile refuses binary content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-drift-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'bin'), Buffer.from([1, 2, 0, 3]));

  assert.equal(await readWorkingFile(root, 'bin'), undefined);
});

test('the tracker reports drift once its check finishes, and only then', async t => {
  const { snapshots, snapshot, root } = await frozen(t, 'parked\n');
  let repaints = 0;
  const drift = new FrozenDrift(snapshots, () => { repaints += 1; });

  drift.recheck({ 'group-1': snapshot });
  await settle();
  // Nothing has moved, so there is nothing to tell the tree about.
  assert.equal(drift.has(snapshot.files[0].fileKey), false);
  assert.equal(repaints, 0);

  await fs.writeFile(path.join(root, 'a.txt'), 'edited\n');
  drift.recheck({ 'group-1': snapshot });
  await settle();
  assert.equal(drift.has(snapshot.files[0].fileKey), true);
  assert.equal(repaints, 1);
});

test('rechecking with the same answer does not keep repainting', async t => {
  const { snapshots, snapshot, root } = await frozen(t, 'parked\n');
  await fs.writeFile(path.join(root, 'a.txt'), 'edited\n');
  let repaints = 0;
  const drift = new FrozenDrift(snapshots, () => { repaints += 1; });

  for (let i = 0; i < 5; i += 1) {
    drift.recheck({ 'group-1': snapshot });
    await settle();
  }

  // One repaint for the change from "clean" to "drifted", and nothing after.
  assert.equal(repaints, 1);
});

test('overlapping rechecks still end on the latest answer', async t => {
  const { snapshots, snapshot, root } = await frozen(t, 'parked\n');
  const drift = new FrozenDrift(snapshots, () => {});

  // Fired back to back with no await between them, which is what a burst of Git
  // events looks like. The second must not be swallowed by the first.
  drift.recheck({ 'group-1': snapshot });
  await fs.writeFile(path.join(root, 'a.txt'), 'edited\n');
  drift.recheck({ 'group-1': snapshot });
  await settle();

  assert.equal(drift.has(snapshot.files[0].fileKey), true);
});

test('an empty set of snapshots clears whatever was remembered', async t => {
  const { snapshots, snapshot, root } = await frozen(t, 'parked\n');
  await fs.writeFile(path.join(root, 'a.txt'), 'edited\n');
  const drift = new FrozenDrift(snapshots, () => {});

  drift.recheck({ 'group-1': snapshot });
  await settle();
  assert.equal(drift.has(snapshot.files[0].fileKey), true);

  drift.recheck({});
  await settle();
  assert.equal(drift.has(snapshot.files[0].fileKey), false);
});

/** A repository holding one file, already frozen at the given contents. */
async function frozen(t: test.TestContext, contents: string): Promise<{
  root: string;
  snapshots: SnapshotFiles;
  snapshot: FrozenSnapshot;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lcg-drift-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'a.txt'), contents);

  const snapshots = new SnapshotFiles(path.join(root, '.store'));
  const snapshot: FrozenSnapshot = {
    frozenAt: Date.now(),
    repositoryRoot: root,
    files: [{
      fileKey: 'a.txt',
      relativePath: 'a.txt',
      status: 0,
      area: 'Working Tree',
      frozenHash: await snapshots.write(contents)
    }]
  };
  return { root, snapshots, snapshot };
}

/** Lets the background check run to completion. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 25));
}
