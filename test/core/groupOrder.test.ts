import assert from 'node:assert/strict';
import test from 'node:test';
import { moveBefore, moveInOrder } from '../../src/core/groups';

const order = ['a', 'b', 'c', 'd'];

test('a group moves one step up', () => {
  assert.deepEqual(moveInOrder(order, 'c', -1), ['a', 'c', 'b', 'd']);
});

test('a group moves one step down', () => {
  assert.deepEqual(moveInOrder(order, 'b', 1), ['a', 'c', 'b', 'd']);
});

test('nudging past either end does nothing', () => {
  // No wrapping around. A list that teleports its top item to the bottom is not
  // what anyone means by "up".
  assert.deepEqual(moveInOrder(order, 'a', -1), order);
  assert.deepEqual(moveInOrder(order, 'd', 1), order);
});

test('moving a group nobody has heard of leaves the order alone', () => {
  assert.deepEqual(moveInOrder(order, 'zz', 1), order);
});

test('a dragged group lands above the one it was dropped on', () => {
  assert.deepEqual(moveBefore(order, ['d'], 'b'), ['a', 'd', 'b', 'c']);
});

test('dragging downwards ends up where it was dropped, not one short', () => {
  // The moving ids come out first and the insertion point is found afterwards.
  // Doing it the other way round puts it one place too high.
  assert.deepEqual(moveBefore(order, ['a'], 'd'), ['b', 'c', 'a', 'd']);
});

test('several groups keep their own order when dragged together', () => {
  assert.deepEqual(moveBefore(order, ['a', 'b'], 'd'), ['c', 'a', 'b', 'd']);
});

test('dropping a group onto itself changes nothing', () => {
  assert.deepEqual(moveBefore(order, ['b'], 'b'), order);
});

test('dropping onto a group that is gone changes nothing', () => {
  assert.deepEqual(moveBefore(order, ['a'], 'zz'), order);
});
