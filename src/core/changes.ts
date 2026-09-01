import type { GitChange, GitRepository } from '../git/api';
import { assignmentKey, relativeChangePath } from './repositoryPaths';

/**
 * Flattens Git's four change lists into one entry per file.
 *
 * Git will happily mention the same file twice — once staged, once edited again
 * since — and reports a rename under both its old and new path. Everything
 * downstream gets much simpler if one file means one row, so the merging happens
 * here, once, keeping enough detail to still place the file in the right section
 * and follow it through a rename.
 *
 * Note the `import type`: TypeScript erases it, so this file carries no runtime
 * dependency on VS Code and stays testable.
 */

export type ChangeArea = 'Working Tree' | 'Staged' | 'Working Tree + Staged' | 'Merge';

export interface CollectedChange {
  repository: GitRepository;
  change: GitChange;
  relativePath: string;
  /** Where the file lives now. This is the key an assignment gets written to. */
  fileKey: string;
  /** Current key plus any old-path alias. A move has to clear every one. */
  assignmentKeys: string[];
  area: ChangeArea;
}

/** Finds the file's group, trying its old path too in case it was renamed. */
export function assignedGroupId(change: CollectedChange, lookup: (key: string) => string | undefined): string | undefined {
  for (const key of change.assignmentKeys) {
    const groupId = lookup(key);
    if (groupId) return groupId;
  }
  return undefined;
}

/** Reads every change Git knows about, one entry per file. */
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
        // Git occasionally mentions paths outside the repo. Not ours to group.
      }
    }
  };
  add(repository.state.workingTreeChanges, 'Working Tree');
  add(repository.state.untrackedChanges ?? [], 'Working Tree');
  add(repository.state.indexChanges, 'Staged');
  add(repository.state.mergeChanges, 'Merge');
  return [...byPath.values()];
}

/** Folds two areas together. A conflict outranks everything else. */
function mergeChangeArea(existing: ChangeArea, incoming: ChangeArea): ChangeArea {
  if (existing === 'Merge' || incoming === 'Merge') {
    return 'Merge';
  }
  if (existing !== incoming) {
    return 'Working Tree + Staged';
  }
  return existing;
}
