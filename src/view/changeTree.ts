import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { assignedGroupId, collectChanges } from '../core/changes';
import { FrozenFile, FrozenSnapshot } from '../core/frozen';
import { ChangeSection, isInSection, isLiveSection } from '../core/sections';
import { GroupStore } from '../data/groupStore';
import { GitApi, GitRepository } from '../git/api';
import { DisplayChange, FileNode, GroupNode, RepositoryNode, SectionNode, TreeNode } from './nodes';
import { fileItem, groupItem, repositoryItem, sectionItem } from './treeItems';

/** Long enough to swallow a burst of Git events, short enough to feel instant. */
const REFRESH_DEBOUNCE_MS = 120;

/** Stands in for Ungrouped. Safe because a real group id is always a UUID. */
const UNGROUPED_KEY = '';

/**
 * Decides what is in the tree, and keeps it in step with Git.
 *
 * Two things in here exist purely so this stays pleasant on a big repository.
 * Please do not tidy them away.
 *
 * **The debounce.** The Git extension fires status events on every save, every
 * internal poll, and generally whenever the mood takes it. Rebuilding the tree
 * on each one turns a branch switch into a flicker show.
 *
 * **The grouping cache.** Every group header wants a count and every group body
 * wants a list, so without this, `collectChanges` — which normalizes a path per
 * file — runs about twice per group. Eight groups and three hundred changed
 * files means several thousand path resolutions to draw one tree, which you can
 * feel. Now it runs once and everything reads the result.
 *
 * The cache is cleared by `refresh()`, which every mutation already calls, so
 * there is no separate invalidation to keep in sync.
 */
export class ChangeGroupsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  private readonly repositorySubscriptions = new Map<GitRepository, vscode.Disposable>();
  private readonly apiSubscriptions: vscode.Disposable[] = [];
  private readonly groupingCache = new Map<GitRepository, Map<string, DisplayChange[]>>();
  private baselineCache: Map<string, FrozenFile> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  public readonly onDidChangeTreeData = this.changedEmitter.event;

  /** Subscribes to every open repository, and to repositories opening later. */
  public constructor(private readonly gitApi: GitApi | undefined, private readonly store: GroupStore) {
    if (!store) {
      throw new Error('A group store is required.');
    }
    if (gitApi) {
      for (const repository of gitApi.repositories) {
        this.watchRepository(repository);
      }
      this.apiSubscriptions.push(
        gitApi.onDidOpenRepository(repository => {
          this.watchRepository(repository);
          this.refresh();
        }),
        gitApi.onDidCloseRepository(repository => {
          this.repositorySubscriptions.get(repository)?.dispose();
          this.repositorySubscriptions.delete(repository);
          this.refresh();
        })
      );
    }
  }

  /** Drops every subscription and any repaint still pending. */
  public dispose(): void {
    this.cancelScheduledRefresh();
    this.groupingCache.clear();
    this.changedEmitter.dispose();
    for (const subscription of this.repositorySubscriptions.values()) {
      subscription.dispose();
    }
    for (const subscription of this.apiSubscriptions) {
      subscription.dispose();
    }
  }

  /** Throws away the cache and redraws. */
  public refresh(): void {
    this.cancelScheduledRefresh();
    this.groupingCache.clear();
    this.baselineCache = undefined;
    this.changedEmitter.fire();
  }

  /** Hands a node to treeItems.ts, with any count it needs. */
  public getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element instanceof RepositoryNode) {
      return repositoryItem(element);
    }
    if (element instanceof SectionNode) {
      return sectionItem(element, this.sectionCount(element));
    }
    if (element instanceof GroupNode) {
      return groupItem(element, this.visibleChanges(element).length);
    }
    return fileItem(element);
  }

  /** The children of a row — or the top level, when asked for nothing. */
  public getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const repositories = this.gitApi?.repositories ?? [];
      return repositories.length === 1
        ? this.topLevelNodes(repositories[0])
        : repositories.map(repository => new RepositoryNode(repository));
    }
    if (element instanceof RepositoryNode) {
      return this.topLevelNodes(element.repository);
    }
    if (element instanceof SectionNode) {
      return this.groupNodes(element.repository, element.section)
        .filter(node => this.visibleChanges(node).length > 0);
    }
    if (element instanceof GroupNode) {
      const frozenRow = element.section === 'frozen';
      return this.visibleChanges(element).map(change => new FileNode(
        change,
        element.group?.id,
        element.group?.color,
        element.section,
        frozenRow ? this.frozenFile(element.group?.id, change.fileKey) : undefined,
        frozenRow ? undefined : this.frozenBaseline(change.fileKey)
      ));
    }
    return [];
  }

  /** Walks back up the tree. VS Code needs this to reveal a row. */
  public getParent(element: TreeNode): TreeNode | undefined {
    if (element instanceof FileNode) {
      const group = element.groupId
        ? this.store.getGroups().find(candidate => candidate.id === element.groupId)
        : undefined;
      return new GroupNode(element.displayChange.repository, group, element.section);
    }
    if (element instanceof GroupNode) {
      return element.section ? new SectionNode(element.repository, element.section) : this.rootParent(element.repository);
    }
    if (element instanceof SectionNode) {
      return this.rootParent(element.repository);
    }
    return undefined;
  }

  /** Every changed file we know about, across every open repository. */
  public getAllChanges(): DisplayChange[] {
    return (this.gitApi?.repositories ?? [])
      .flatMap(repository => [...this.grouping(repository).values()])
      .flat();
  }

  /**
   * Every change in a group, sections ignored.
   *
   * Deliberate: a Git action on a group should always mean the whole group, even
   * when you started it from a row sitting under Staged Changes. Staging half a
   * group because of where you right-clicked would be a nasty surprise.
   *
   * Note this returns *live* changes even for a frozen group. Freezing pins what
   * the tree shows; it does not pin what Git would do, and staging a synthesised
   * row for a file Git no longer considers changed would simply fail.
   */
  public getGroupChanges(node: GroupNode): DisplayChange[] {
    if (!node.group) throw new Error('Select a named group.');
    return this.changesForGroup(node.repository, node.group.id);
  }

/**
   * Decides which sections exist right now.
   *
   * With nothing staged and nothing frozen there is nothing to split, so groups
   * sit at the top level and the headers stay out of the way. Freezing a group,
   * or staging anything, brings the relevant headers in.
   *
   * Frozen comes first deliberately: it is the layer furthest from Git, and
   * reading top to bottom then goes frozen -> staged -> working tree.
   */
  private topLevelNodes(repository: GitRepository): TreeNode[] {
    const sections: ChangeSection[] = [];
    if (this.frozenGroupCount() > 0) sections.push('frozen');
    if (this.hasStagedChanges(repository)) sections.push('staged');
    if (sections.length === 0) {
      return this.groupNodes(repository, undefined);
    }
    sections.push('unstaged');
    return sections.map(section => new SectionNode(repository, section));
  }

  /**
   * The group rows under a repository, or under one section of it.
   *
   * The Frozen section holds only frozen groups; the live sections hold only
   * unfrozen ones plus Ungrouped. A group therefore appears in exactly one
   * place, which is what keeps the two layers from arguing about who owns a file.
   */
  private groupNodes(repository: GitRepository, section: ChangeSection | undefined): GroupNode[] {
    const groups = this.store.getGroups();
    if (section === 'frozen') {
      return groups
        .filter(group => this.store.getFrozen(group.id))
        .map(group => new GroupNode(repository, group, section, this.store.getFrozen(group.id)!.frozenAt));
    }
    return [
      ...groups.filter(group => !this.store.getFrozen(group.id)).map(group => new GroupNode(repository, group, section)),
      new GroupNode(repository, undefined, section)
    ];
  }

  /** How many groups are currently frozen, deciding whether the section exists. */
  private frozenGroupCount(): number {
    return Object.keys(this.store.getAllFrozen()).length;
  }

  /**
   * What one group row lists.
   *
   * A row in the Frozen section answers from its snapshot and never consults
   * Git. Everywhere else answers from live state.
   */
  private visibleChanges(node: GroupNode): DisplayChange[] {
    if (node.section === 'frozen') {
      const snapshot = node.group ? this.store.getFrozen(node.group.id) : undefined;
      return snapshot ? this.frozenChanges(node.repository, snapshot) : [];
    }
    const changes = this.liveChanges(node);
    // Hoisted so the narrowing survives into the closure below.
    const section = node.section;
    return section && isLiveSection(section)
      ? changes.filter(change => isInSection(change.area, section))
      : changes;
  }

  /**
   * Live changes for a row outside the Frozen section.
   *
   * Ungrouped absorbs anything whose group is frozen. Without this, editing a
   * file *after* freezing its group would make that edit vanish: the frozen
   * group renders from its snapshot, so the live change would sit in a bucket
   * nothing draws. Now the snapshot stays pinned under Frozen and the new work
   * shows up in Changes, ready to be grouped again.
   */
  private liveChanges(node: GroupNode): DisplayChange[] {
    const grouped = this.grouping(node.repository);
    if (node.group) {
      return grouped.get(node.group.id) ?? [];
    }
    const frozenIds = new Set(Object.keys(this.store.getAllFrozen()));
    const orphaned = [...grouped.entries()]
      .filter(([groupId]) => frozenIds.has(groupId))
      .flatMap(([, bucket]) => bucket);
    if (orphaned.length === 0) {
      return grouped.get(UNGROUPED_KEY) ?? [];
    }
    return [...(grouped.get(UNGROUPED_KEY) ?? []), ...orphaned]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  /**
   * Turns snapshot entries into rows.
   *
   * Frozen files are shown whether or not Git still reports them as changed, so
   * these are synthesised rather than looked up. That is the point of a freeze:
   * revert the file afterwards and the group still shows what you captured.
   */
  private frozenChanges(repository: GitRepository, snapshot: FrozenSnapshot): DisplayChange[] {
    return snapshot.files.map(file => ({
      repository,
      change: {
        uri: vscode.Uri.file(nodePath.join(repository.rootUri.fsPath, file.relativePath)),
        status: file.status
      },
      relativePath: file.relativePath,
      fileKey: file.fileKey,
      assignmentKeys: [file.fileKey],
      area: file.area
    }));
  }

  /** The snapshot entry behind a row, so the file node can carry its blobs. */
  private frozenFile(groupId: string | undefined, fileKey: string): FrozenFile | undefined {
    if (!groupId) return undefined;
    return this.store.getFrozen(groupId)?.files.find(file => file.fileKey === fileKey);
  }

  /**
   * The freeze that should act as a live row's baseline, if there is one.
   *
   * Built once per repaint: a file can only be frozen in one group, so a flat
   * lookup by key is enough, and scanning every snapshot for every row would be
   * wasteful for something that changes only when a group is frozen.
   */
  private frozenBaseline(fileKey: string): FrozenFile | undefined {
    if (!this.baselineCache) {
      this.baselineCache = new Map();
      for (const snapshot of Object.values(this.store.getAllFrozen())) {
        for (const file of snapshot.files) {
          this.baselineCache.set(file.fileKey, file);
        }
      }
    }
    return this.baselineCache.get(fileKey);
  }

  /** Adds up a section across all its groups, for the number in the header. */
  private sectionCount(node: SectionNode): number {
    return this.groupNodes(node.repository, node.section)
      .reduce((total, group) => total + this.visibleChanges(group).length, 0);
  }

  /** Is anything staged? Decides whether the sections appear at all. */
  private hasStagedChanges(repository: GitRepository): boolean {
    for (const bucket of this.grouping(repository).values()) {
      if (bucket.some(change => isInSection(change.area, 'staged'))) {
        return true;
      }
    }
    return false;
  }

  /** The repository row above a top-level node, if we are drawing one. */
  private rootParent(repository: GitRepository): TreeNode | undefined {
    const repositories = this.gitApi?.repositories ?? [];
    return repositories.length === 1 ? undefined : new RepositoryNode(repository);
  }

  /** Starts listening to one repository, if we are not already. */
  private watchRepository(repository: GitRepository): void {
    if (!this.repositorySubscriptions.has(repository)) {
      this.repositorySubscriptions.set(repository, repository.state.onDidChange(() => this.scheduleRefresh()));
    }
  }

  /** Restarts the clock. A burst of events ends up as one repaint. */
  private scheduleRefresh(): void {
    this.cancelScheduledRefresh();
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  /** Cancels a pending repaint so a stale one cannot land after a fresh one. */
  private cancelScheduledRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /** One group's changes, straight out of the cache. */
  private changesForGroup(repository: GitRepository, groupId: string | undefined): DisplayChange[] {
    return this.grouping(repository).get(groupId ?? UNGROUPED_KEY) ?? [];
  }

  /** Buckets a repository's changes by group. Once per repaint — see the class note. */
  private grouping(repository: GitRepository): Map<string, DisplayChange[]> {
    const cached = this.groupingCache.get(repository);
    if (cached) {
      return cached;
    }
    const grouped = new Map<string, DisplayChange[]>();
    for (const change of collectChanges(repository)) {
      const key = assignedGroupId(change, assignment => this.store.getAssignment(assignment)) ?? UNGROUPED_KEY;
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(change);
      } else {
        grouped.set(key, [change]);
      }
    }
    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    }
    this.groupingCache.set(repository, grouped);
    return grouped;
  }
}
