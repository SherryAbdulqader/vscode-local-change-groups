import * as nodePath from 'node:path';

/**
 * Turns absolute file paths into the stable keys that group assignments are
 * stored under.
 *
 * Assignments must survive a file being closed, the workspace reopening, and on
 * Windows the same repository being referenced with different drive-letter case,
 * so the key is deliberately derived from normalized text rather than any
 * VS Code or Git object identity.
 */

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

/**
 * Builds the private assignment key for one changed file.
 *
 * The platform is a parameter so the Windows casing rule can be tested from any
 * host, and so a repository root's case never splits one file into two keys.
 */
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

/** Normalizes a file system path so Windows comparisons ignore case and separators. */
export function comparablePath(value: string, platform: NodeJS.Platform = process.platform): string {
  if (!value.trim()) {
    throw new Error('A file path is required.');
  }
  const normalized = value.replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}
