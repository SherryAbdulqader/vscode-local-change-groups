import type { ChangeArea } from './changes';
import { isInSection } from './sections';

/**
 * Works out what discarding a selection would actually do, before anything is
 * destroyed.
 *
 * Discard has two very different outcomes — a tracked edit is recoverable from
 * the last commit, an untracked file is gone for good — so they are counted
 * separately and stated separately in the confirmation. Reporting one number
 * would understate the risk.
 */

/** What a discard would do to each selected change. */
export interface DiscardPartition<T> {
  /** Tracked edits that revert to the last committed content. */
  restore: T[];
  /** Untracked files that are deleted from disk outright. */
  remove: T[];
  /** Staged-only entries a working-tree discard must not touch. */
  skip: T[];
}

/**
 * Splits changes by what discarding does to them. A file staged with no further
 * working-tree edit is skipped rather than silently unstaged, because unstaging
 * is not what "discard" promises.
 *
 * The accessors keep this free of any concrete change type, so it is testable
 * with plain objects.
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
