import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { FrozenFile, FrozenSnapshot } from '../core/frozen';
import type { SnapshotFiles } from './snapshotFiles';

/**
 * Answering one question: has a frozen file been edited since it was frozen?
 *
 * It matters because a freeze is meant to park a change. While a file still
 * matches its snapshot, the frozen group is already showing it and the live
 * lists should leave it alone. Edit it again and that new work is real, so it
 * has to reappear.
 *
 * Comparing means reading the file off disk and the snapshot out of storage, so
 * the answer cannot be had synchronously. Hence the tracker below.
 */

/** Reads a working-tree file as text, or undefined if it is missing or binary. */
export async function readWorkingFile(repositoryRoot: string, relativePath: string): Promise<string | undefined> {
  try {
    const buffer = await fs.readFile(nodePath.join(repositoryRoot, relativePath));
    // A NUL byte is the same cheap heuristic Git uses to call something binary.
    return buffer.includes(0) ? undefined : buffer.toString('utf8');
  } catch {
    return undefined;
  }
}

/**
 * Which of a snapshot's files no longer match what is on disk.
 *
 * A file that has been deleted counts as drifted. It certainly does not match,
 * and it is something you would want to see.
 */
export async function driftedFrozenFiles(
  snapshots: SnapshotFiles,
  snapshot: FrozenSnapshot
): Promise<FrozenFile[]> {
  const drifted: FrozenFile[] = [];
  for (const file of snapshot.files) {
    const current = await readWorkingFile(snapshot.repositoryRoot, file.relativePath);
    if (current === undefined || await snapshots.read(file.frozenHash) !== current) {
      drifted.push(file);
    }
  }
  return drifted;
}

/**
 * Keeps a note of which frozen files have drifted, so the tree can ask cheaply.
 *
 * The tree is drawn synchronously and the real check is not, so the check runs
 * in the background and the tree reads whatever the last run found. When the
 * answer changes, `onChange` asks for a repaint.
 *
 * Being briefly out of date is fine here. Right after a freeze nothing has
 * drifted, which is already the answer an empty set gives.
 */
export class FrozenDrift {
  private drifted = new Set<string>();
  private queued: Record<string, FrozenSnapshot> | undefined;
  private running = false;

  public constructor(
    private readonly snapshots: SnapshotFiles,
    private readonly onChange: () => void
  ) {
    if (!snapshots || typeof onChange !== 'function') {
      throw new Error('A snapshot store and a change callback are required.');
    }
  }

  /** Has this file been edited since its group was frozen? */
  public has(fileKey: string): boolean {
    return this.drifted.has(fileKey);
  }

  /**
   * Asks for a fresh check.
   *
   * Call it as often as you like. Only one check runs at a time, and whatever
   * arrived while it was running is checked straight afterwards, so the last
   * call is never the one that gets dropped.
   */
  public recheck(snapshots: Record<string, FrozenSnapshot>): void {
    this.queued = snapshots;
    if (!this.running) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.queued) {
        const snapshots = this.queued;
        this.queued = undefined;
        await this.check(snapshots);
      }
    } finally {
      this.running = false;
    }
  }

  private async check(snapshots: Record<string, FrozenSnapshot>): Promise<void> {
    const found = new Set<string>();
    for (const snapshot of Object.values(snapshots)) {
      for (const file of await driftedFrozenFiles(this.snapshots, snapshot)) {
        found.add(file.fileKey);
      }
    }
    // Only repaint when the answer actually moved, otherwise every Git event
    // would bounce the tree for nothing.
    if (!sameKeys(found, this.drifted)) {
      this.drifted = found;
      this.onChange();
    }
  }
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}
