import type { ChangeArea } from './changes';
import { isInSection } from './sections';

/**
 * Works out what a discard would destroy, before it destroys it.
 *
 * "Discard" covers two very different fates. A tracked edit goes back to the
 * last commit, so at worst you lose an afternoon. An untracked file is deleted
 * from disk and is simply gone. Rolling both into a single number in the
 * confirmation would be technically accurate and genuinely misleading, so they
 * get counted separately and said out loud separately.
 */

/** The three fates awaiting a selection. */
export interface DiscardPartition<T> {
  /** Tracked edits. These come back from the last commit. */
  restore: T[];
  /** Untracked files. These are gone. Actually gone. */
  remove: T[];
  /** Staged with nothing else pending, so a working-tree discard leaves them be. */
  skip: T[];
}

/**
 * Sorts a selection into those three buckets.
 *
 * A file that is staged with no further edits gets skipped rather than unstaged.
 * Whoever clicked Discard did not ask us to rearrange their index, and quietly
 * doing it anyway is how a button loses people's trust.
 *
 * The accessor arguments mean this never has to know about our change type, so
 * the tests can call it with plain objects.
 */
export function partitionForDiscard<T>(
  items: readonly T[],
  area: (item: T) => ChangeArea,
  status: (item: T) => number
): DiscardPartition<T> {
  const partition: DiscardPartition<T> = { restore: [], remove: [], skip: [] };
  for (const item of items) {
    if (!isInSection(area(item), 'unstaged')) {
      partition.skip.push(item);
    } else if (status(item) === 7) {
      partition.remove.push(item);
    } else {
      partition.restore.push(item);
    }
  }
  return partition;
}
