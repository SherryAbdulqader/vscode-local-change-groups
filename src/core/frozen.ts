import type { ChangeArea } from './changes';

/**
 * Freezing: a snapshot layer that sits between your working tree and the index.
 *
 * You finish a piece of work, drop those files in a group, and freeze it. From
 * then on the group shows you *that* change and only that change. Carry on
 * editing the same files for the next problem — the frozen group does not budge,
 * because what it displays comes from the snapshot below rather than from
 * whatever Git currently thinks.
 *
 * Two things a freeze pins:
 *   - **What it shows.** Clicking a file diffs the two frozen blobs, so later
 *     edits never leak into a diff you already reviewed.
 *   - **What can join.** A frozen group stops accepting new files. That is the
 *     whole point of parking it.
 *
 * What a freeze does *not* do is stop you staging or committing the group. It is
 * a viewing and organising layer, not a lock on Git.
 *
 * Contents live as content-addressed blobs in extension storage, never inside
 * `.git` — so a freeze still cannot touch your repository.
 */

/** One file, as it looked the moment the group was frozen. */
export interface FrozenFile {
  fileKey: string;
  relativePath: string;
  /** Git status at freeze time, so the row keeps its original badge. */
  status: number;
  area: ChangeArea;
  /** Blob of the committed side. Absent for a file that was untracked. */
  baseHash?: string;
  /** Blob of the working-tree side: the bytes you actually froze. */
  frozenHash: string;
}

export interface FrozenSnapshot {
  /** Epoch milliseconds, shown in the diff title so you know which freeze this is. */
  frozenAt: number;
  repositoryRoot: string;
  files: FrozenFile[];
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Is this a sha256 we could have written? */
export function isBlobHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

/**
 * Re-validates snapshots coming out of storage, dropping anything unusable.
 *
 * A snapshot whose blobs went missing would render as an empty diff with no
 * explanation, so a malformed entry is discarded here and the group simply comes
 * back unfrozen — visibly wrong in a way you can act on, rather than subtly wrong.
 */
export function normalizeFrozenSnapshots(value: unknown, validGroupIds: ReadonlySet<string>): Record<string, FrozenSnapshot> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result: Record<string, FrozenSnapshot> = {};
  for (const [groupId, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!validGroupIds.has(groupId)) {
      continue;
    }
    const snapshot = normalizeSnapshot(candidate);
    if (snapshot) {
      result[groupId] = snapshot;
    }
  }
  return result;
}

/** Every blob hash a set of snapshots still needs, for pruning storage. */
export function referencedHashes(snapshots: Record<string, FrozenSnapshot>): Set<string> {
  const hashes = new Set<string>();
  for (const snapshot of Object.values(snapshots)) {
    for (const file of snapshot.files) {
      hashes.add(file.frozenHash);
      if (file.baseHash) hashes.add(file.baseHash);
    }
  }
  return hashes;
}

/** Renders a freeze time the way it appears in a diff tab title. */
export function frozenLabel(frozenAt: number): string {
  const when = new Date(frozenAt);
  return Number.isFinite(when.getTime())
    ? when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'frozen';
}

function normalizeSnapshot(value: unknown): FrozenSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<FrozenSnapshot>;
  if (typeof candidate.repositoryRoot !== 'string' || !candidate.repositoryRoot.trim()) {
    return undefined;
  }
  if (typeof candidate.frozenAt !== 'number' || !Number.isFinite(candidate.frozenAt)) {
    return undefined;
  }
  if (!Array.isArray(candidate.files)) {
    return undefined;
  }
  const files = candidate.files.filter(isFrozenFile).map(file => ({
    fileKey: file.fileKey,
    relativePath: file.relativePath,
    status: file.status,
    area: file.area,
    frozenHash: file.frozenHash,
    ...(isBlobHash(file.baseHash) ? { baseHash: file.baseHash } : {})
  }));
  // A snapshot with nothing left in it is not a freeze, it is a stale key.
  return files.length > 0
    ? { frozenAt: candidate.frozenAt, repositoryRoot: candidate.repositoryRoot, files }
    : undefined;
}

function isFrozenFile(value: unknown): value is FrozenFile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const file = value as Partial<FrozenFile>;
  return typeof file.fileKey === 'string' && file.fileKey.length > 0 &&
    typeof file.relativePath === 'string' && file.relativePath.length > 0 &&
    typeof file.status === 'number' && Number.isInteger(file.status) &&
    typeof file.area === 'string' &&
    isBlobHash(file.frozenHash);
}
