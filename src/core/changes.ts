import type { GitChange, GitRepository } from '../git/api';
import { assignmentKey, relativeChangePath } from './repositoryPaths';

/**
 * Reads the Git extension's four change lists into one deduplicated view.
 *
 * Git reports the same file more than once when it is both staged and edited
 * again, and reports a rename under two paths. Both are collapsed here so the
 * rest of the extension can treat one file as exactly one entry, while keeping
 * enough information to place it in the right section and to follow renames.
 *
 * Only the `GitRepository` *type* is imported, so this module still carries no
 * runtime dependency on VS Code.
 */

export type ChangeArea = 'Working Tree' | 'Staged' | 'Working Tree + Staged' | 'Merge';

export interface CollectedChange {
  repository: GitRepository;
  change: GitChange;
  relativePath: string;
  /** The key for the file's current path, which an assignment is written to. */
  fileKey: string;
  /** The current key plus any rename alias, all of which a move must clear. */
  assignmentKeys: string[];
  area: ChangeArea;
}

/** Resolves a current or original rename key to its local group. */
export function assignedGroupId(change: CollectedChange, lookup: (key: string) => string | undefined): string | undefined {
  for (const key of change.assignmentKeys) {
    const groupId = lookup(key);
    if (groupId) return groupId;
  }
  return undefined;
}

/** Collects and deduplicates changes exposed by the Git API. */
export function collectChanges(repository: GitRepository): CollectedChange[] {
  if (!repository?.rootUri?.fsPath) {
    throw new Error('A valid Git repository is required.');
  }
  const byPath = new Map<string, CollectedChange>();
  const add = (changes: GitChange[], area: ChangeArea): void => {
    for (const change of changes) {
      try {
        const relativePath = relativeChangePath(repository.rootUri.fsPath, change.uri.fsPath);
        const fileKey = assignmentKey(repository.rootUri.fsPath, relativePath);
        const assignmentKeys = [fileKey];
        if (change.originalUri) {
          const originalPath = relativeChangePath(repository.rootUri.fsPath, change.originalUri.fsPath);
          assignmentKeys.push(assignmentKey(repository.rootUri.fsPath, originalPath));
        }
        const existing = byPath.get(fileKey);
        byPath.set(fileKey, existing
          ? { ...existing, assignmentKeys: [...new Set([...existing.assignmentKeys, ...assignmentKeys])], area: mergeChangeArea(existing.area, area) }
          : { repository, change, relativePath, fileKey, assignmentKeys: [...new Set(assignmentKeys)], area });
      } catch {
        // Git API entries outside the repository are not valid group candidates.
      }
    }
  };
  add(repository.state.workingTreeChanges, 'Working Tree');
  add(repository.state.untrackedChanges ?? [], 'Working Tree');
  add(repository.state.indexChanges, 'Staged');
  add(repository.state.mergeChanges, 'Merge');
  return [...byPath.values()];
}

/** Combines Git areas while giving merge conflicts precedence. */
function mergeChangeArea(existing: ChangeArea, incoming: ChangeArea): ChangeArea {
  if (existing === 'Merge' || incoming === 'Merge') {
    return 'Merge';
  }
  if (existing !== incoming) {
    return 'Working Tree + Staged';
  }
  return existing;
}
