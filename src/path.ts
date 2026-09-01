import * as nodePath from 'node:path';
import type { GitChange, GitRepository } from './git';

export type ChangeArea = 'Working Tree' | 'Staged' | 'Working Tree + Staged' | 'Merge';

export interface CollectedChange {
  repository: GitRepository;
  change: GitChange;
  relativePath: string;
  fileKey: string;
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

/** Returns a stable slash-separated repository-relative path. */
export function relativeChangePath(repositoryRoot: string, filePath: string): string {
  if (!repositoryRoot.trim() || !filePath.trim()) {
    throw new Error('Repository and file paths are required.');
  }

  const relative = nodePath.relative(repositoryRoot, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
    throw new Error('The file must be inside the repository.');
  }

  return relative.split(nodePath.sep).join('/');
}

/** Builds the private assignment key for one changed file. */
export function assignmentKey(
  repositoryRoot: string,
  relativePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (!repositoryRoot.trim() || !relativePath.trim()) {
    throw new Error('Repository and relative paths are required.');
  }

  const pathApi = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const resolvedRoot = pathApi.resolve(repositoryRoot).replace(/\\/g, '/');
  const normalizedRoot = platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return `${normalizedRoot}::${normalizedPath}`;
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
