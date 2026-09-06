import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

/**
 * Where frozen file contents actually live.
 *
 * A plain content-addressed blob store under the extension's own storage folder.
 * Deliberately *not* inside `.git` — writing objects there would work, and would
 * also quietly break the promise this extension makes about never touching your
 * repository. Freeze the same unchanged file into three groups and it costs one
 * blob, since the name is the hash of the contents.
 *
 * Blobs are read back as text. Freezing a binary is not useful anyway: there is
 * nothing to show in a diff.
 */
export class SnapshotFiles {
  /** Takes the directory to keep blobs in, usually the extension storage path. */
  public constructor(private readonly directory: string) {
    if (!directory?.trim()) {
      throw new Error('A snapshot storage directory is required.');
    }
  }

  /** Stores content and returns its hash, skipping the write if we already have it. */
  public async write(content: string): Promise<string> {
    const hash = createHash('sha256').update(content, 'utf8').digest('hex');
    const target = this.pathFor(hash);
    try {
      await fs.access(target);
      return hash;
    } catch {
      // Not stored yet, which is the normal path on a first freeze.
    }
    await fs.mkdir(nodePath.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return hash;
  }

  /** Reads a blob back, or undefined if it is gone. */
  public async read(hash: string): Promise<string | undefined> {
    try {
      return await fs.readFile(this.pathFor(hash), 'utf8');
    } catch {
      return undefined;
    }
  }

  /**
   * Deletes every blob no snapshot still references.
   *
   * Called after an unfreeze. Failures are swallowed on purpose: an orphaned
   * blob is a few kilobytes of clutter, and is not worth interrupting the user
   * over when the thing they actually asked for has already succeeded.
   */
  public async prune(keep: ReadonlySet<string>): Promise<void> {
    let buckets: string[];
    try {
      buckets = await fs.readdir(this.directory);
    } catch {
      return;
    }
    for (const bucket of buckets) {
      const bucketPath = nodePath.join(this.directory, bucket);
      let names: string[];
      try {
        names = await fs.readdir(bucketPath);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!keep.has(bucket + name)) {
          await fs.rm(nodePath.join(bucketPath, name), { force: true }).catch(() => undefined);
        }
      }
      await fs.rmdir(bucketPath).catch(() => undefined);
    }
  }

  /** Two-character fan-out, so a busy workspace does not pile up one flat directory. */
  private pathFor(hash: string): string {
    return nodePath.join(this.directory, hash.slice(0, 2), hash.slice(2));
  }
}
