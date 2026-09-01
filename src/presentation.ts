import * as nodePath from 'node:path';
import { GroupColor } from './model';

/** Scheme used by tree rows so decorations never leak into other views. */
export const CHANGE_SCHEME = 'local-change-groups';

/** Renders the single-letter status badge shown by the Source Control view. */
export function statusBadge(status: number): string {
  const badges: Record<number, string> = {
    0: 'M', 1: 'A', 2: 'D', 3: 'R', 4: 'C', 5: 'M', 6: 'D', 7: 'U', 8: 'I', 9: 'A',
    10: 'R', 11: 'T', 12: 'C', 13: 'C', 14: 'C', 15: 'C', 16: 'C', 17: 'C', 18: 'C'
  };
  return badges[status] ?? 'M';
}

/** Returns a concise user-facing label for a Git status value. */
export function statusLabel(status: number): string {
  const labels: Record<number, string> = {
    0: 'Modified', 1: 'Added', 2: 'Deleted', 3: 'Renamed', 4: 'Copied',
    5: 'Modified', 6: 'Deleted', 7: 'Untracked', 8: 'Ignored', 9: 'Added',
    10: 'Renamed', 11: 'Type changed', 12: 'Conflict', 13: 'Conflict',
    14: 'Conflict', 15: 'Conflict', 16: 'Conflict', 17: 'Conflict', 18: 'Conflict'
  };
  return labels[status] ?? 'Changed';
}

/** Returns the Source Control theme color id that matches a Git status. */
export function statusColorId(status: number): string {
  if (status === 7) return 'gitDecoration.untrackedResourceForeground';
  if (status === 8) return 'gitDecoration.ignoredResourceForeground';
  if ([2, 6].includes(status)) return 'gitDecoration.deletedResourceForeground';
  if ([1, 9].includes(status)) return 'gitDecoration.addedResourceForeground';
  if ([3, 4, 10].includes(status)) return 'gitDecoration.renamedResourceForeground';
  if (status >= 12) return 'gitDecoration.conflictingResourceForeground';
  return 'gitDecoration.modifiedResourceForeground';
}

/** Maps a stored palette key to its contributed theme color id. */
export function groupColorId(color: GroupColor): string {
  return `localChangeGroups.${color}`;
}

/** Returns the folder shown beside a file name, empty at the repository root. */
export function directoryLabel(relativePath: string, separator: string = nodePath.sep): string {
  if (!relativePath.trim()) {
    throw new Error('A relative path is required.');
  }
  const directory = nodePath.posix.dirname(relativePath.replace(/\\/g, '/'));
  return directory === '.' || directory === '/' ? '' : directory.split('/').join(separator);
}

/** Parses the standard newline-separated uri-list payload into raw entries. */
export function parseUriListEntries(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

/** Normalizes a file system path so Windows comparisons ignore case and separators. */
export function comparablePath(value: string, platform: NodeJS.Platform = process.platform): string {
  if (!value.trim()) {
    throw new Error('A file path is required.');
  }
  const normalized = value.replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}
