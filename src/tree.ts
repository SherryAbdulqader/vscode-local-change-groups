import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { changeDecorationUri } from './decoration';
import { GitApi, GitRepository } from './git';
import { LocalGroup } from './model';
import { assignedGroupId, collectChanges, CollectedChange } from './path';
import { ChangeSection, directoryLabel, groupColorId, isInSection, sectionLabel, statusLabel } from './presentation';
import { GroupStore } from './store';

export { collectChanges } from './path';
export { directoryLabel, statusLabel } from './presentation';
export type { ChangeSection } from './presentation';

/** Collapses bursts of Git status events into one repaint. */
const REFRESH_DEBOUNCE_MS = 120;

/** Bucket key standing in for the Ungrouped section, never a real group id. */
const UNGROUPED_KEY = '';

export type TreeNode = RepositoryNode | SectionNode | GroupNode | FileNode;

export class RepositoryNode {
  public readonly kind = 'repository';
  public constructor(public readonly repository: GitRepository) {}
}

export class SectionNode {
  public readonly kind = 'section';
  public constructor(
    public readonly repository: GitRepository,
    public readonly section: ChangeSection
  ) {}
}

export class GroupNode {
  public readonly kind = 'group';
  public constructor(
    public readonly repository: GitRepository,
    public readonly group: LocalGroup | undefined,
    public readonly section?: ChangeSection
  ) {}
}

export type DisplayChange = CollectedChange;

export class FileNode {
  public readonly kind = 'file';
  public constructor(
    public readonly displayChange: DisplayChange,
    public readonly groupId: string | undefined,
    public readonly groupColor: LocalGroup['color'] | undefined,
    public readonly section?: ChangeSection
  ) {}
}

/** Provides a read-only, locally grouped view of Git changes. */
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
      return this.repositoryItem(element);
    }
    if (element instanceof SectionNode) {
      return this.sectionItem(element);
    }
    if (element instanceof GroupNode) {
      return this.groupItem(element);
    }
    return this.fileItem(element);
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

  /** Returns the repository row above a top-level node, if one is rendered. */
  private rootParent(repository: GitRepository): TreeNode | undefined {
    const repositories = this.gitApi?.repositories ?? [];
    return repositories.length === 1 ? undefined : new RepositoryNode(repository);
  }

  /** Returns every changed file currently known across repositories. */
  public getAllChanges(): DisplayChange[] {
    return (this.gitApi?.repositories ?? [])
      .flatMap(repository => [...this.grouping(repository).values()])
      .flat();
  }

  /** Returns the currently visible changes assigned to a repository-scoped group. */
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

  /** Reports whether the index holds anything this view would show. */
  private hasStagedChanges(repository: GitRepository): boolean {
    for (const bucket of this.grouping(repository).values()) {
      if (bucket.some(change => isInSection(change.area, 'staged'))) {
        return true;
      }
    }
    return false;
  }

  /** Builds the repository row shown when several repositories are open. */
  private repositoryItem(element: RepositoryNode): vscode.TreeItem {
    const label = nodePath.basename(element.repository.rootUri.fsPath) || element.repository.rootUri.fsPath;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `repository:${element.repository.rootUri.toString()}`;
    item.contextValue = 'localChangeGroups.repository';
    item.iconPath = new vscode.ThemeIcon('repo');
    item.description = element.repository.rootUri.fsPath;
    return item;
  }

  /** Builds a Staged Changes or Changes header row. */
  private sectionItem(element: SectionNode): vscode.TreeItem {
    const count = this.groupNodes(element.repository, element.section)
      .reduce((total, node) => total + this.visibleChanges(node).length, 0);
    const item = new vscode.TreeItem(sectionLabel(element.section), vscode.TreeItemCollapsibleState.Expanded);
    item.id = `section:${element.repository.rootUri.toString()}:${element.section}`;
    item.description = String(count);
    item.contextValue = `localChangeGroups.section.${element.section}`;
    item.iconPath = new vscode.ThemeIcon(element.section === 'staged' ? 'check' : 'edit');
    item.tooltip = element.section === 'staged'
      ? 'Files staged in the Git index, grouped the same way'
      : 'Files changed in the working tree, grouped the same way';
    return item;
  }

  /** Builds a group header row styled after the Source Control section headers. */
  private groupItem(element: GroupNode): vscode.TreeItem {
    const changes = this.visibleChanges(element);
    const name = element.group?.name ?? 'Ungrouped';
    const item = new vscode.TreeItem(name, changes.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `group:${element.repository.rootUri.toString()}:${element.section ?? 'all'}:${element.group?.id ?? 'ungrouped'}`;
    item.description = String(changes.length);
    item.tooltip = element.group
      ? `${name} — ${changes.length} change${changes.length === 1 ? '' : 's'}\nDrop files here to assign them.`
      : 'Changes that belong to no group\nDrop files here to remove them from their group.';
    item.contextValue = element.group ? 'localChangeGroups.group' : 'localChangeGroups.ungrouped';
    item.iconPath = new vscode.ThemeIcon(
      element.group ? 'circle-filled' : 'circle-outline',
      element.group ? groupThemeColor(element.group.color) : undefined
    );
    return item;
  }

  /** Builds a file row that mirrors the Source Control changes list. */
  private fileItem(element: FileNode): vscode.TreeItem {
    const { displayChange } = element;
    const item = new vscode.TreeItem(nodePath.basename(displayChange.relativePath), vscode.TreeItemCollapsibleState.None);
    item.id = `file:${element.section ?? 'all'}:${element.groupId ?? 'ungrouped'}:${displayChange.fileKey}`;
    item.description = directoryLabel(displayChange.relativePath);
    item.tooltip = `${displayChange.relativePath}\n${statusLabel(displayChange.change.status)} · ${displayChange.area}`;
    item.resourceUri = changeDecorationUri(displayChange.change.uri, displayChange.change.status, element.groupColor);
    const membership = element.groupId ? 'grouped' : 'ungrouped';
    item.contextValue = `localChangeGroups.file.${membership}${element.section ? `.${element.section}` : ''}`;
    item.command = {
      command: 'localChangeGroups.openChange',
      title: 'Open Change',
      arguments: [element]
    };
    return item;
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

  /**
   * Buckets a repository's changes by group once per repaint. Every row of the
   * tree reads this, so scanning and normalizing paths happens a single time
   * instead of once per group header and again per group body.
   */
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

/** Maps a stored palette key to its contributed theme color. */
function groupThemeColor(color: LocalGroup['color']): vscode.ThemeColor {
  return new vscode.ThemeColor(groupColorId(color));
}
