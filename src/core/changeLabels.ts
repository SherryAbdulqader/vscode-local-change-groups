import * as nodePath from 'node:path';
import type { GroupColor } from './groups';

/**
 * Turning Git's status numbers into letters, words, and colors.
 *
 * Git hands us an integer. The tables below map it to exactly what the built-in
 * Changes list shows, so a row here reads the same as a row there — which is the
 * entire point, since people already know what a green U means.
 *
 * These return theme color *ids* rather than ThemeColor objects. That is what
 * keeps this file free of VS Code, and therefore testable; the view wraps them.
 */

/** Our own URI scheme, so our badges stay in our tree. See decorations.ts. */
export const CHANGE_SCHEME = 'local-change-groups';

/** The single letter on the right of a row: M, A, D, U, and friends. */
export function statusBadge(status: number): string {
  const badges: Record<number, string> = {
    0: 'M', 1: 'A', 2: 'D', 3: 'R', 4: 'C', 5: 'M', 6: 'D', 7: 'U', 8: 'I', 9: 'A',
    10: 'R', 11: 'T', 12: 'C', 13: 'C', 14: 'C', 15: 'C', 16: 'C', 17: 'C', 18: 'C'
  };
  return badges[status] ?? 'M';
}

/** The same status, in a word, for tooltips. */
export function statusLabel(status: number): string {
  const labels: Record<number, string> = {
    0: 'Modified', 1: 'Added', 2: 'Deleted', 3: 'Renamed', 4: 'Copied',
    5: 'Modified', 6: 'Deleted', 7: 'Untracked', 8: 'Ignored', 9: 'Added',
    10: 'Renamed', 11: 'Type changed', 12: 'Conflict', 13: 'Conflict',
    14: 'Conflict', 15: 'Conflict', 16: 'Conflict', 17: 'Conflict', 18: 'Conflict'
  };
  return labels[status] ?? 'Changed';
}

/** The color Git itself would paint this status. */
export function statusColorId(status: number): string {
  if (status === 7) return 'gitDecoration.untrackedResourceForeground';
  if (status === 8) return 'gitDecoration.ignoredResourceForeground';
  if ([2, 6].includes(status)) return 'gitDecoration.deletedResourceForeground';
  if ([1, 9].includes(status)) return 'gitDecoration.addedResourceForeground';
  if ([3, 4, 10].includes(status)) return 'gitDecoration.renamedResourceForeground';
  if (status >= 12) return 'gitDecoration.conflictingResourceForeground';
  return 'gitDecoration.modifiedResourceForeground';
}

/** Our palette key to the theme color id we contribute in package.json. */
export function groupColorId(color: GroupColor): string {
  return `localChangeGroups.${color}`;
}

/** The dim folder text beside a file name. Empty for files at the repo root. */
export function directoryLabel(relativePath: string, separator: string = nodePath.sep): string {
  if (!relativePath.trim()) {
    throw new Error('A relative path is required.');
  }
  const directory = nodePath.posix.dirname(relativePath.replace(/\\/g, '/'));
  return directory === '.' || directory === '/' ? '' : directory.split('/').join(separator);
}
