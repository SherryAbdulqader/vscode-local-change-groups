import * as vscode from 'vscode';
import { assignedGroupId, collectChanges } from '../core/changes';
import { ChangeSection, isInSection } from '../core/sections';
import { GroupStore } from '../data/groupStore';
import { GitApi, GitRepository } from '../git/api';
import { DisplayChange, FileNode, GroupNode, RepositoryNode, SectionNode, TreeNode } from './nodes';
import { fileItem, groupItem, repositoryItem, sectionItem } from './treeItems';

/** Collapses bursts of Git status events into one repaint. */
const REFRESH_DEBOUNCE_MS = 120;

/** Bucket key standing in for the Ungrouped section, never a real group id. */
const UNGROUPED_KEY = '';

/**
 * Supplies the tree's contents and keeps them in step with Git.
 *
 * Two things here exist purely for responsiveness on large repositories:
 *
 * - Git status events are debounced, because the Git extension fires them on
 *   every save and every internal poll, and each one would otherwise rebuild the
 *   whole tree.
 * - Changes are bucketed by group **once per repaint** and cached. Every group
 *   header needs a count and every group body needs a list; without the cache
 *   `collectChanges` — which normalizes a path per file — would run roughly
 *   twice per group, so a repository with many groups and many changed files
 *   would re-derive the same keys thousands of times for one repaint.
 *
 * The cache is invalidated by `refresh()`, which every mutation already calls.
 */
export class ChangeGroupsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  private readonly repositorySubscriptions = new Map<GitRepository, vscode.Disposable>();
  private readonly apiSubscriptions: vscode.Disposable[] = [];
  private readonly groupingCache = new Map<GitRepository, Map<string, DisplayChange[]>>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  public readonly onDidChangeTreeData = this.changedEmitter.event;

  /** Creates the provider and subscribes to public Git change events. */
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

  /** Releases Git and tree event subscriptions. */
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

  /** Discards cached grouping and rebuilds the visible tree from Git state. */
  public refresh(): void {
    this.cancelScheduledRefresh();
    this.groupingCache.clear();
    this.changedEmitter.fire();
  }

  /** Returns the VS Code presentation for a tree node. */
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

  /** Returns repository, section, group, or file children. */
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
      return this.visibleChanges(element)
        .map(change => new FileNode(change, element.group?.id, element.group?.color, element.section));
    }
    return [];
  }

  /** Returns the parent node so the view can reveal a file row. */
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

  /** Returns every changed file currently known across repositories. */
  public getAllChanges(): DisplayChange[] {
    return (this.gitApi?.repositories ?? [])
      .flatMap(repository => [...this.grouping(repository).values()])
      .flat();
  }

  /**
   * Returns every change assigned to a group, ignoring sections.
   *
   * Git actions must always act on a group as a whole, so this deliberately does
   * not narrow by section even when invoked from a row inside one.
   */
  public getGroupChanges(node: GroupNode): DisplayChange[] {
    if (!node.group) throw new Error('Select a named group.');
    return this.changesForGroup(node.repository, node.group.id);
  }

  /**
   * Splits into Staged Changes and Changes once anything is staged, matching the
   * Source Control view. With a clean index the split is noise, so groups sit at
   * the top level instead.
   */
  private topLevelNodes(repository: GitRepository): TreeNode[] {
    return this.hasStagedChanges(repository)
      ? [new SectionNode(repository, 'staged'), new SectionNode(repository, 'unstaged')]
      : this.groupNodes(repository, undefined);
  }

  /** Builds the group rows shown under one repository or section. */
  private groupNodes(repository: GitRepository, section: ChangeSection | undefined): GroupNode[] {
    return [
      ...this.store.getGroups().map(group => new GroupNode(repository, group, section)),
      new GroupNode(repository, undefined, section)
    ];
  }

  /** Returns a group row's files, narrowed to its section when it has one. */
  private visibleChanges(node: GroupNode): DisplayChange[] {
    const changes = this.changesForGroup(node.repository, node.group?.id);
    return node.section ? changes.filter(change => isInSection(change.area, node.section!)) : changes;
  }

  /** Totals one section across every group, for its header count. */
  private sectionCount(node: SectionNode): number {
    return this.groupNodes(node.repository, node.section)
      .reduce((total, group) => total + this.visibleChanges(group).length, 0);
  }

  /** Reports whether the index holds anything this view would show. */
  private hasStagedChanges(repository: GitRepository): boolean {
    for (const bucket of this.grouping(repository).values()) {
      if (bucket.some(change => isInSection(change.area, 'staged'))) {
        return true;
      }
    }
    return false;
  }

  /** Returns the repository row above a top-level node, if one is rendered. */
  private rootParent(repository: GitRepository): TreeNode | undefined {
    const repositories = this.gitApi?.repositories ?? [];
    return repositories.length === 1 ? undefined : new RepositoryNode(repository);
  }

  /** Watches one repository for status changes. */
  private watchRepository(repository: GitRepository): void {
    if (!this.repositorySubscriptions.has(repository)) {
      this.repositorySubscriptions.set(repository, repository.state.onDidChange(() => this.scheduleRefresh()));
    }
  }

  /** Coalesces rapid Git status events into a single delayed repaint. */
  private scheduleRefresh(): void {
    this.cancelScheduledRefresh();
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  /** Drops a pending repaint so it cannot fire after a newer one. */
  private cancelScheduledRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /** Returns the changes assigned to one group, from the per-repaint grouping. */
  private changesForGroup(repository: GitRepository, groupId: string | undefined): DisplayChange[] {
    return this.grouping(repository).get(groupId ?? UNGROUPED_KEY) ?? [];
  }

  /** Buckets a repository's changes by group, once per repaint. See the class note. */
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
