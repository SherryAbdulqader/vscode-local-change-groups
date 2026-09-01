import type { CollectedChange } from '../core/changes';
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
    public readonly section?: ChangeSection
  ) {}
}

/** One changed file. */
export class FileNode {
  public readonly kind = 'file';
  public constructor(
    public readonly displayChange: DisplayChange,
    public readonly groupId: string | undefined,
    public readonly groupColor: LocalGroup['color'] | undefined,
    public readonly section?: ChangeSection
  ) {}
}
