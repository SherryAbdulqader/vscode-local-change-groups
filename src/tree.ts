import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { GitApi, GitRepository } from './git';
import { LocalGroup } from './model';
import { assignedGroupId, collectChanges, CollectedChange } from './path';
import { GroupStore } from './store';

export { collectChanges } from './path';

export type TreeNode = RepositoryNode | GroupNode | FileNode;

export class RepositoryNode {
  public readonly kind = 'repository';
  public constructor(public readonly repository: GitRepository) {}
}

export class GroupNode {
  public readonly kind = 'group';
  public constructor(
    public readonly repository: GitRepository,
    public readonly group: LocalGroup | undefined
  ) {}
}

export type DisplayChange = CollectedChange;

export class FileNode {
  public readonly kind = 'file';
  public constructor(
    public readonly displayChange: DisplayChange,
    public readonly groupId: string | undefined,
    public readonly groupColor: LocalGroup['color'] | undefined
  ) {}
}

/** Provides a read-only, locally grouped view of Git changes. */
export class ChangeGroupsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  private readonly repositorySubscriptions = new Map<GitRepository, vscode.Disposable>();
  private readonly apiSubscriptions: vscode.Disposable[] = [];
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
    this.changedEmitter.dispose();
    for (const subscription of this.repositorySubscriptions.values()) {
      subscription.dispose();
    }
    for (const subscription of this.apiSubscriptions) {
      subscription.dispose();
    }
  }

  /** Rebuilds the visible tree from current Git state. */
  public refresh(): void {
    this.changedEmitter.fire();
  }

  /** Returns the VS Code presentation for a tree node. */
  public getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element instanceof RepositoryNode) {
      const label = nodePath.basename(element.repository.rootUri.fsPath) || element.repository.rootUri.fsPath;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'localChangeGroups.repository';
      item.iconPath = new vscode.ThemeIcon('repo');
      item.description = element.repository.rootUri.fsPath;
      return item;
    }

    if (element instanceof GroupNode) {
      const name = element.group?.name ?? 'Ungrouped';
      const count = this.changesForGroup(element.repository, element.group?.id).length;
      const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(count);
      item.contextValue = element.group ? 'localChangeGroups.group' : 'localChangeGroups.ungrouped';
      item.iconPath = new vscode.ThemeIcon(
        element.group ? 'folder' : 'folder-opened',
        element.group ? groupThemeColor(element.group.color) : undefined
      );
      return item;
    }

    const { displayChange } = element;
    const item = new vscode.TreeItem(nodePath.basename(displayChange.relativePath), vscode.TreeItemCollapsibleState.None);
    item.description = `${displayChange.area} · ${statusLabel(displayChange.change.status)}`;
    item.tooltip = `${displayChange.relativePath}\n${item.description}`;
    item.resourceUri = displayChange.change.uri;
    item.contextValue = element.groupId ? 'localChangeGroups.file.grouped' : 'localChangeGroups.file.ungrouped';
    item.iconPath = element.groupColor
      ? new vscode.ThemeIcon(statusIconName(displayChange.change.status), groupThemeColor(element.groupColor))
      : statusIcon(displayChange.change.status);
    item.command = {
      command: 'localChangeGroups.openChange',
      title: 'Open Change',
      arguments: [element]
    };
    return item;
  }

  /** Returns repository, group, or file children. */
  public getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return (this.gitApi?.repositories ?? []).map(repository => new RepositoryNode(repository));
    }
    if (element instanceof RepositoryNode) {
      return [
        ...this.store.getGroups().map(group => new GroupNode(element.repository, group)),
        new GroupNode(element.repository, undefined)
      ];
    }
    if (element instanceof GroupNode) {
      return this.changesForGroup(element.repository, element.group?.id)
        .map(change => new FileNode(change, element.group?.id, element.group?.color));
    }
    return [];
  }

  /** Returns every changed file currently known across repositories. */
  public getAllChanges(): DisplayChange[] {
    return (this.gitApi?.repositories ?? []).flatMap(repository => collectChanges(repository));
  }

  /** Returns the currently visible changes assigned to a repository-scoped group. */
  public getGroupChanges(node: GroupNode): DisplayChange[] {
    if (!node.group) throw new Error('Select a named group.');
    return this.changesForGroup(node.repository, node.group.id);
  }

  /** Watches one repository for status changes. */
  private watchRepository(repository: GitRepository): void {
    if (!this.repositorySubscriptions.has(repository)) {
      this.repositorySubscriptions.set(repository, repository.state.onDidChange(() => this.refresh()));
    }
  }

  /** Filters repository changes by their private group assignment. */
  private changesForGroup(repository: GitRepository, groupId: string | undefined): DisplayChange[] {
    return collectChanges(repository)
      .filter(change => assignedGroupId(change, key => this.store.getAssignment(key)) === groupId)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }
}

/** Returns a concise user-facing label for a Git status value. */
export function statusLabel(status: number): string {
  const labels: Record<number, string> = {
    0: 'Modified', 1: 'Added', 2: 'Deleted', 3: 'Renamed', 4: 'Copied',
    5: 'Modified', 6: 'Deleted', 7: 'Untracked', 8: 'Ignored', 9: 'Added',
    10: 'Renamed', 11: 'Type changed', 12: 'Conflict', 13: 'Conflict',
    14: 'Conflict', 15: 'Conflict', 16: 'Conflict', 17: 'Conflict', 18: 'Conflict'
  };
  return labels[status] ?? 'Changed';
}

/** Returns a themed icon without defining custom colors. */
function statusIcon(status: number): vscode.ThemeIcon {
  if ([2, 6].includes(status)) {
    return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
  }
  if ([1, 7, 9].includes(status)) {
    return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
  }
  if ([3, 10].includes(status)) {
    return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
  }
  if (status >= 12) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'));
  }
  return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
}

/** Returns the status-specific icon name used by colored group members. */
function statusIconName(status: number): string {
  if ([2, 6].includes(status)) return 'diff-removed';
  if ([1, 7, 9].includes(status)) return 'diff-added';
  if ([3, 10].includes(status)) return 'diff-renamed';
  if (status >= 12) return 'warning';
  return 'diff-modified';
}

/** Maps a stored palette key to its contributed theme color. */
function groupThemeColor(color: LocalGroup['color']): vscode.ThemeColor {
  return new vscode.ThemeColor(`localChangeGroups.${color}`);
}
