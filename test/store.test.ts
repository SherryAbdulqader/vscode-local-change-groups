import assert from 'node:assert/strict';
import test from 'node:test';
import { MementoLike, GroupStore } from '../src/store';

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
