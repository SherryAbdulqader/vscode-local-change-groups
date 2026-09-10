import assert from 'node:assert/strict';
import test from 'node:test';
import { MementoLike, GroupStore } from '../../src/data/groupStore';

class MemoryMemento implements MementoLike {
  public value: unknown;

  /** Returns the stored test value. */
  public get<T>(_key: string): T | undefined {
    return this.value as T | undefined;
  }

  /** Saves the test value in memory. */
  public async update(_key: string, value: unknown): Promise<void> {
    this.value = value;
  }
}

class ControlledMemento extends MemoryMemento {
  public calls = 0;
  public failNext = false;
  public release?: () => void;

  public override async update(_key: string, value: unknown): Promise<void> {
    this.calls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('storage failed');
    }
    if (this.calls === 1) await new Promise<void>(resolve => { this.release = resolve; });
    this.value = value;
  }
}

class CountingMemento extends MemoryMemento {
  public calls = 0;

  /** Counts persisted writes without blocking any of them. */
  public override async update(key: string, value: unknown): Promise<void> {
    this.calls += 1;
    await super.update(key, value);
  }
}

test('store creates, assigns, and unassigns groups', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Local Only');
  await store.assign('repo::file', group.id);
  assert.equal(store.getAssignment('repo::file'), group.id);
  await store.unassign('repo::file');
  assert.equal(store.getAssignment('repo::file'), undefined);
});

test('deleting a group removes its assignments', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Tests');
  await store.assign('repo::test', group.id);
  await store.deleteGroup(group.id);
  assert.equal(store.getAssignment('repo::test'), undefined);
});

test('store rejects duplicate group names', async () => {
  const store = new GroupStore(new MemoryMemento());
  await store.createGroup('Ready');
  await assert.rejects(() => store.createGroup('ready'), /already exists/);
});

test('store creates and changes a group color', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Ready', 'green');
  assert.equal(group.color, 'green');
  await store.setGroupColor(group.id, 'orange');
  assert.equal(store.getGroups()[0].color, 'orange');
});

test('failed persistence does not change in-memory state', async () => {
  const memory = new ControlledMemento();
  memory.calls = 1;
  memory.failNext = true;
  const store = new GroupStore(memory);
  await assert.rejects(() => store.createGroup('Not Saved'), /storage failed/);
  assert.deepEqual(store.getGroups(), []);
});

test('concurrent writes are serialized and retain both changes', async () => {
  const memory = new ControlledMemento();
  const store = new GroupStore(memory);
  const first = store.createGroup('First');
  const second = store.createGroup('Second');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(memory.calls, 1);
  memory.release!();
  await Promise.all([first, second]);
  assert.deepEqual(store.getGroups().map(group => group.name), ['First', 'Second']);
  assert.equal(memory.calls, 2);
});

test('rename move and remove clear every alias atomically', async () => {
  const store = new GroupStore(new MemoryMemento());
  const first = await store.createGroup('First');
  const second = await store.createGroup('Second');
  await store.assign('old', first.id);
  await store.moveAssignment(['new', 'old'], 'new', second.id);
  assert.equal(store.getAssignment('old'), undefined);
  assert.equal(store.getAssignment('new'), second.id);
  await store.unassignAll(['new', 'old']);
  assert.equal(store.getAssignment('new'), undefined);
});

test('createGroup fills the new group in a single write', async () => {
  const memory = new CountingMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Tests', 'green', [
    { fileKey: 'repo::a.ts', assignmentKeys: ['repo::a.ts'] },
    { fileKey: 'repo::b.ts', assignmentKeys: ['repo::old.ts', 'repo::b.ts'] }
  ]);
  assert.equal(memory.calls, 1);
  assert.equal(store.getAssignment('repo::a.ts'), group.id);
  assert.equal(store.getAssignment('repo::b.ts'), group.id);
  assert.equal(store.getAssignment('repo::old.ts'), undefined);
});

test('createGroup rejects a duplicate name without assigning any file', async () => {
  const store = new GroupStore(new MemoryMemento());
  await store.createGroup('Tests');
  await assert.rejects(
    store.createGroup('Tests', 'red', [{ fileKey: 'repo::a.ts', assignmentKeys: ['repo::a.ts'] }]),
    /already exists/
  );
  assert.equal(store.getAssignment('repo::a.ts'), undefined);
});

test('moveAssignments moves many files and clears aliases in one write', async () => {
  const memory = new CountingMemento();
  const store = new GroupStore(memory);
  const first = await store.createGroup('Local Only');
  const second = await store.createGroup('Ready');
  await store.assign('repo::a.ts', first.id);
  const before = memory.calls;
  await store.moveAssignments([
    { fileKey: 'repo::a.ts', assignmentKeys: ['repo::a.ts'] },
    { fileKey: 'repo::b.ts', assignmentKeys: ['repo::renamed.ts', 'repo::b.ts'] }
  ], second.id);
  assert.equal(memory.calls - before, 1);
  assert.equal(store.getAssignment('repo::a.ts'), second.id);
  assert.equal(store.getAssignment('repo::b.ts'), second.id);
  assert.equal(store.getAssignment('repo::renamed.ts'), undefined);
});

test('moveAssignments rejects an empty batch and an unknown group', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Local Only');
  await assert.rejects(store.moveAssignments([], group.id), /At least one file/);
  await assert.rejects(
    store.moveAssignments([{ fileKey: ' ', assignmentKeys: ['repo::a.ts'] }], group.id),
    /Valid file keys/
  );
  await assert.rejects(
    store.moveAssignments([{ fileKey: 'repo::a.ts', assignmentKeys: ['repo::a.ts'] }], 'missing'),
    /Group not found/
  );
  assert.equal(store.getAssignment('repo::a.ts'), undefined);
});

test('store sets and persists a group icon', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Tests', 'green');
  assert.equal(store.getGroups()[0].icon, undefined);
  await store.setGroupIcon(group.id, 'Beaker');
  assert.equal(store.getGroups()[0].icon, 'beaker');
  assert.equal(new GroupStore(memory).getGroups()[0].icon, 'beaker');
});

test('store rejects a malformed icon and an unknown group', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Tests');
  await assert.rejects(store.setGroupIcon(group.id, '$(beaker)'), /codicon id/);
  await assert.rejects(store.setGroupIcon('missing', 'beaker'), /Group not found/);
  assert.equal(store.getGroups()[0].icon, undefined);
});

/** A minimal snapshot; the store only cares that it has files. */
function frozenSnapshot() {
  return {
    frozenAt: 1_700_000_000_000,
    repositoryRoot: 'C:\repo',
    files: [{
      fileKey: 'c:/repo::src/a.ts',
      relativePath: 'src/a.ts',
      status: 5,
      area: 'Working Tree' as const,
      frozenHash: 'a'.repeat(64)
    }]
  };
}

test('freezing and unfreezing a group round trips through storage', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Problem 1');
  assert.equal(store.getFrozen(group.id), undefined);

  await store.freezeGroup(group.id, frozenSnapshot());
  assert.equal(store.getFrozen(group.id)?.files.length, 1);
  assert.equal(new GroupStore(memory).getFrozen(group.id)?.files.length, 1);

  await store.unfreezeGroup(group.id);
  assert.equal(store.getFrozen(group.id), undefined);
  assert.equal(new GroupStore(memory).getFrozen(group.id), undefined);
});

test('a frozen group refuses new files', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Problem 1');
  await store.freezeGroup(group.id, frozenSnapshot());
  await assert.rejects(
    store.moveAssignments([{ fileKey: 'repo::b.ts', assignmentKeys: ['repo::b.ts'] }], group.id),
    /is frozen/
  );
  assert.equal(store.getAssignment('repo::b.ts'), undefined);
});

test('an unfrozen group accepts files again', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Problem 1');
  await store.freezeGroup(group.id, frozenSnapshot());
  await store.unfreezeGroup(group.id);
  await store.moveAssignments([{ fileKey: 'repo::b.ts', assignmentKeys: ['repo::b.ts'] }], group.id);
  assert.equal(store.getAssignment('repo::b.ts'), group.id);
});

test('deleting a group takes its snapshot with it', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Problem 1');
  await store.freezeGroup(group.id, frozenSnapshot());
  await store.deleteGroup(group.id);
  assert.deepEqual(store.getAllFrozen(), {});
  assert.deepEqual(new GroupStore(memory).getAllFrozen(), {});
});

test('freezing rejects an empty snapshot and an unknown group', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Problem 1');
  await assert.rejects(store.freezeGroup(group.id, { ...frozenSnapshot(), files: [] }), /at least one file/i);
  await assert.rejects(store.freezeGroup('missing', frozenSnapshot()), /Group not found/);
});

test('auto-assign files a batch and remembers that it did', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Tests');

  await store.autoAssign([target('test/a.ts')], group.id);

  assert.equal(store.getAssignment('test/a.ts'), group.id);
  assert.equal(store.wasAutoAssigned('test/a.ts'), true);
  assert.equal(new GroupStore(memory).wasAutoAssigned('test/a.ts'), true);
});

test('a file taken back out of its group is not filed again', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Tests');
  await store.autoAssign([target('test/a.ts')], group.id);

  await store.unassignAll(['test/a.ts']);

  // The assignment is gone but the note stays, which is what stops the rule
  // from putting the file straight back on the next refresh.
  assert.equal(store.getAssignment('test/a.ts'), undefined);
  assert.equal(store.wasAutoAssigned('test/a.ts'), true);
});

test('auto-assign refuses a frozen group like any other write', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Tests');
  await store.freezeGroup(group.id, frozenSnapshot());

  await assert.rejects(store.autoAssign([target('test/a.ts')], group.id), /frozen/i);
});

test('notes are dropped once a file stops being changed', async () => {
  const store = new GroupStore(new MemoryMemento());
  const group = await store.createGroup('Tests');
  await store.autoAssign([target('kept.ts'), target('committed.ts')], group.id);

  await store.pruneAutoAssigned(new Set(['kept.ts']));

  assert.equal(store.wasAutoAssigned('kept.ts'), true);
  // Committed, so the rules get another go at it if it changes again later.
  assert.equal(store.wasAutoAssigned('committed.ts'), false);
});

test('pruning writes nothing when there is nothing to drop', async () => {
  const memory = new CountingMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Tests');
  await store.autoAssign([target('a.ts')], group.id);
  const before = memory.calls;

  await store.pruneAutoAssigned(new Set(['a.ts']));

  // Called on every refresh, so it has to be free when nothing has changed.
  assert.equal(memory.calls, before);
});

test('reordering groups changes the order they come back in', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const first = await store.createGroup('First');
  const second = await store.createGroup('Second');

  await store.reorderGroups([second.id, first.id]);

  assert.deepEqual(store.getGroups().map(group => group.name), ['Second', 'First']);
  assert.deepEqual(new GroupStore(memory).getGroups().map(group => group.name), ['Second', 'First']);
});

test('a partial order keeps the groups it did not mention', async () => {
  const store = new GroupStore(new MemoryMemento());
  const first = await store.createGroup('First');
  await store.createGroup('Second');
  const third = await store.createGroup('Third');

  await store.reorderGroups([third.id, first.id]);

  // Anything left out goes on the end, keeping its own relative order, so a
  // caller can hand over a partial order without losing a group.
  assert.deepEqual(store.getGroups().map(group => group.name), ['Third', 'First', 'Second']);
});

test('an order full of unknown ids leaves the groups alone', async () => {
  const store = new GroupStore(new MemoryMemento());
  await store.createGroup('First');
  await store.createGroup('Second');

  await store.reorderGroups(['nope', 'also-nope']);

  assert.deepEqual(store.getGroups().map(group => group.name), ['First', 'Second']);
});

/** A file key with no rename aliases, which is all these tests need. */
function target(fileKey: string) {
  return { fileKey, assignmentKeys: [fileKey] };
}

test('a group can be marked protected, and it survives a reload', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Local only');

  await store.setGroupProtected(group.id, true);

  assert.equal(store.getGroups()[0].protected, true);
  assert.equal(new GroupStore(memory).getGroups()[0].protected, true);
});

test('unprotecting removes the flag rather than storing false', async () => {
  const memory = new MemoryMemento();
  const store = new GroupStore(memory);
  const group = await store.createGroup('Local only');
  await store.setGroupProtected(group.id, true);

  await store.setGroupProtected(group.id, false);

  // An ordinary group stays an ordinary object, with nothing to misread later.
  assert.equal('protected' in store.getGroups()[0], false);
});

test('protecting a group that is not there is refused', async () => {
  const store = new GroupStore(new MemoryMemento());

  await assert.rejects(store.setGroupProtected('missing', true), /Group not found/);
});
