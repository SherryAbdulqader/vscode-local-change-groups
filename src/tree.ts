import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { changeDecorationUri } from './decoration';
import { GitApi, GitRepository } from './git';
import { LocalGroup } from './model';
import { assignedGroupId, collectChanges, CollectedChange } from './path';
import { directoryLabel, groupColorId, statusLabel } from './presentation';
import { GroupStore } from './store';

export { collectChanges } from './path';
export { directoryLabel, statusLabel } from './presentation';

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
      return this.repositoryItem(element);
    }
    if (element instanceof GroupNode) {
      return this.groupItem(element);
    }
    return this.fileItem(element);
  }

  /** Returns repository, group, or file children. */
  public getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const repositories = this.gitApi?.repositories ?? [];
      return repositories.length === 1
        ? this.groupNodes(repositories[0])
        : repositories.map(repository => new RepositoryNode(repository));
    }
    if (element instanceof RepositoryNode) {
      return this.groupNodes(element.repository);
    }
    if (element instanceof GroupNode) {
      return this.changesForGroup(element.repository, element.group?.id)
        .map(change => new FileNode(change, element.group?.id, element.group?.color));
    }
    return [];
  }

  /** Returns the parent node so the view can reveal a file row. */
  public getParent(element: TreeNode): TreeNode | undefined {
    if (element instanceof FileNode) {
      const group = element.groupId
        ? this.store.getGroups().find(candidate => candidate.id === element.groupId)
        : undefined;
      return new GroupNode(element.displayChange.repository, group);
    }
    if (element instanceof GroupNode) {
      const repositories = this.gitApi?.repositories ?? [];
      return repositories.length === 1 ? undefined : new RepositoryNode(element.repository);
    }
    return undefined;
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

  /** Builds the group rows shown under one repository. */
  private groupNodes(repository: GitRepository): TreeNode[] {
    return [
      ...this.store.getGroups().map(group => new GroupNode(repository, group)),
      new GroupNode(repository, undefined)
    ];
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

  /** Builds a group header row styled after the Source Control section headers. */
  private groupItem(element: GroupNode): vscode.TreeItem {
    const changes = this.changesForGroup(element.repository, element.group?.id);
    const name = element.group?.name ?? 'Ungrouped';
    const item = new vscode.TreeItem(name, changes.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `group:${element.repository.rootUri.toString()}:${element.group?.id ?? 'ungrouped'}`;
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
    item.id = `file:${element.groupId ?? 'ungrouped'}:${displayChange.fileKey}`;
    item.description = directoryLabel(displayChange.relativePath);
    item.tooltip = `${displayChange.relativePath}\n${statusLabel(displayChange.change.status)} · ${displayChange.area}`;
    item.resourceUri = changeDecorationUri(displayChange.change.uri, displayChange.change.status, element.groupColor);
    item.contextValue = element.groupId ? 'localChangeGroups.file.grouped' : 'localChangeGroups.file.ungrouped';
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

/** Maps a stored palette key to its contributed theme color. */
function groupThemeColor(color: LocalGroup['color']): vscode.ThemeColor {
  return new vscode.ThemeColor(groupColorId(color));
}
