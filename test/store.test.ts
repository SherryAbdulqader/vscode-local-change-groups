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
