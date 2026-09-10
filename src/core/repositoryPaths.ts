import * as nodePath from 'node:path';

/**
 * Turns file paths into the keys we file assignments under.
 *
 * These keys have to survive closing a file, reopening the workspace, and — the
 * fun one — Windows handing you "C:\repo" and "c:\repo" for the same folder on
 * different days and considering the matter settled. So a key is built from
 * normalized text, never from a VS Code or Git object; those are far too
 * short-lived to trust with something that has to outlive a restart.
 */

/** Repo-relative, forward slashes, same answer on every platform. */
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

/**
 * Builds the key one changed file is stored under.
 *
 * Platform is a parameter so the Windows casing rule can be tested from a Mac,
 * and so a repo root's capitalisation never splits one file into two keys that
 * then quietly disagree about which group it belongs to.
 */
export function assignmentKey(
  repositoryRoot: string,
  relativePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (!repositoryRoot.trim() || !relativePath.trim()) {
    throw new Error('Repository and relative paths are required.');
  }

  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return assignmentKeyPrefix(repositoryRoot, platform) + normalizedPath;
}

/**
 * The part of a key that names the repository, trailing separator included.
 *
 * Having this on its own is what makes a key reversible: given the repository,
 * strip the prefix and what is left is the path you started with. Exporting a
 * layout needs exactly that.
 */
export function assignmentKeyPrefix(
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (!repositoryRoot.trim()) {
    throw new Error('A repository path is required.');
  }
  const pathApi = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const resolved = pathApi.resolve(repositoryRoot).replace(/\\/g, '/');
  return `${platform === 'win32' ? resolved.toLowerCase() : resolved}::`;
}

/**
 * The repository-relative path inside a key, if the key belongs to this
 * repository. Keys from another repository come back as undefined.
 */
export function relativePathFromKey(
  key: string,
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const prefix = assignmentKeyPrefix(repositoryRoot, platform);
  return key.startsWith(prefix) ? key.slice(prefix.length) || undefined : undefined;
}

/** Squashes a path so two spellings of the same file compare equal on Windows. */
export function comparablePath(value: string, platform: NodeJS.Platform = process.platform): string {
  if (!value.trim()) {
    throw new Error('A file path is required.');
  }
  const normalized = value.replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}
