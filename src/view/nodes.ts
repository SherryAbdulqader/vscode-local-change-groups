import type { CollectedChange } from '../core/changes';
import type { FrozenFile } from '../core/frozen';
import type { LocalGroup } from '../core/groups';
import type { ChangeSection } from '../core/sections';
import type { GitRepository } from '../git/api';

/**
 * The four kinds of row this tree can hold.
 *
 * Classes rather than plain interfaces because the drag-and-drop controller and
 * the command layer both identify rows with `instanceof`, and that needs a real
 * constructor. The `kind` field is there for exhaustive switches.
 *
 * These are throwaway value objects — a fresh set is built on every repaint. If
 * you need a row to stay the same row across repaints, that comes from the
 * stable `TreeItem.id` in treeItems.ts, never from object identity.
 */

export type TreeNode = RepositoryNode | SectionNode | GroupNode | FileNode;

export type DisplayChange = CollectedChange;

/** Only appears when more than one repository is open. */
export class RepositoryNode {
  public readonly kind = 'repository';
  public constructor(public readonly repository: GitRepository) {}
}

/** A section header. Only exists once something is actually staged. */
export class SectionNode {
  public readonly kind = 'section';
  public constructor(
    public readonly repository: GitRepository,
    public readonly section: ChangeSection
  ) {}
}

/** One group — or the Ungrouped bucket, when `group` is missing. */
export class GroupNode {
  public readonly kind = 'group';
  public constructor(
    public readonly repository: GitRepository,
    public readonly group: LocalGroup | undefined,
    /** Set when this row lives under a section, which narrows what it lists. */
    public readonly section?: ChangeSection,
    /** When the freeze time is set, this row is showing a snapshot. */
    public readonly frozenAt?: number
  ) {}
}

/** One changed file. */
export class FileNode {
  public readonly kind = 'file';
  public constructor(
    public readonly displayChange: DisplayChange,
    public readonly groupId: string | undefined,
    public readonly groupColor: LocalGroup['color'] | undefined,
    public readonly section?: ChangeSection,
    /**
     * Present when the row belongs to a frozen group. Carries the two blob
     * hashes its diff is built from, so opening it never has to ask Git.
     */
    public readonly frozen?: FrozenFile,
    /**
     * Present on a *live* row whose file was frozen elsewhere.
     *
     * The freeze becomes this row's baseline, so its diff shows only what
     * changed after the freeze rather than replaying the frozen change too.
     */
    public readonly pinnedBase?: FrozenFile
  ) {}
}
