import type { CollectedChange } from '../core/changes';
import type { LocalGroup } from '../core/groups';
import type { ChangeSection } from '../core/sections';
import type { GitRepository } from '../git/api';

/**
 * The four row kinds the tree can hold.
 *
 * These are plain classes rather than a tagged union of interfaces because both
 * the drag-and-drop controller and the command layer identify rows with
 * `instanceof`, which needs a real constructor. Each also carries a `kind` for
 * exhaustive switches.
 *
 * Nodes are rebuilt on every repaint and are therefore disposable value objects;
 * row identity across repaints comes from the stable `TreeItem.id` assigned in
 * `treeItems.ts`, never from object identity.
 */

export type TreeNode = RepositoryNode | SectionNode | GroupNode | FileNode;

export type DisplayChange = CollectedChange;

/** Shown only when more than one repository is open. */
export class RepositoryNode {
  public readonly kind = 'repository';
  public constructor(public readonly repository: GitRepository) {}
}

/** A Staged Changes or Changes header, present only once the index is dirty. */
export class SectionNode {
  public readonly kind = 'section';
  public constructor(
    public readonly repository: GitRepository,
    public readonly section: ChangeSection
  ) {}
}

/** One group, or the Ungrouped bucket when `group` is absent. */
export class GroupNode {
  public readonly kind = 'group';
  public constructor(
    public readonly repository: GitRepository,
    public readonly group: LocalGroup | undefined,
    /** Set when the row sits inside a section, narrowing which files it lists. */
    public readonly section?: ChangeSection
  ) {}
}

/** One changed file inside a group. */
export class FileNode {
  public readonly kind = 'file';
  public constructor(
    public readonly displayChange: DisplayChange,
    public readonly groupId: string | undefined,
    public readonly groupColor: LocalGroup['color'] | undefined,
    public readonly section?: ChangeSection
  ) {}
}
