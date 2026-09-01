import * as vscode from 'vscode';
import { comparablePath, parseUriListEntries } from './presentation';
import { GroupStore } from './store';
import { ChangeGroupsTreeProvider, DisplayChange, FileNode, GroupNode, TreeNode } from './tree';

/** Payload identifier used when files are dragged inside this view. */
export const TREE_MIME_TYPE = 'application/vnd.code.tree.localchangegroups.view';

interface DraggedChange {
  fileKey: string;
  assignmentKeys: string[];
}

/** The group a drop targets, where an absent id means Ungrouped. */
interface DropTarget {
  groupId: string | undefined;
}

/** Moves changed files between local groups by dragging rows. */
export class ChangeGroupsDragAndDropController implements vscode.TreeDragAndDropController<TreeNode> {
  public readonly dragMimeTypes = ['text/uri-list'];
  public readonly dropMimeTypes = [TREE_MIME_TYPE, 'text/uri-list'];

  /** Wires the controller to the view it reorders. */
  public constructor(
    private readonly provider: ChangeGroupsTreeProvider,
    private readonly store: GroupStore,
    private readonly log: (message: string) => void
  ) {
    if (!provider || !store || typeof log !== 'function') {
      throw new Error('A provider, store, and logger are required.');
    }
  }

  /** Publishes the dragged file rows for this view and for editors. */
  public handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const files = source.filter((node): node is FileNode => node instanceof FileNode);
    if (files.length === 0) {
      return;
    }
    const dragged: DraggedChange[] = files.map(node => ({
      fileKey: node.displayChange.fileKey,
      assignmentKeys: node.displayChange.assignmentKeys
    }));
    dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem(dragged));
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(
      files.map(node => node.displayChange.change.uri.toString()).join('\r\n')
    ));
  }

  /** Assigns every dropped file to the group under the cursor. */
  public async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      const destination = resolveDropTarget(target);
      if (!destination) {
        return;
      }
      const changes = await this.resolveDroppedChanges(dataTransfer);
      const moved = changes.filter(change => currentGroupId(change, this.store) !== destination.groupId);
      if (moved.length === 0) {
        return;
      }
      for (const change of moved) {
        if (destination.groupId) {
          await this.store.moveAssignment(change.assignmentKeys, change.fileKey, destination.groupId);
        } else {
          await this.store.unassignAll(change.assignmentKeys);
        }
      }
      this.provider.refresh();
      const name = destination.groupId
        ? this.store.getGroups().find(group => group.id === destination.groupId)?.name ?? 'group'
        : 'Ungrouped';
      this.log(`Moved ${moved.length} file${moved.length === 1 ? '' : 's'} to ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Drop failed: ${message}`);
      void vscode.window.showErrorMessage(`Local Change Groups: ${message}`);
    }
  }

  /** Reads dropped rows from this view, falling back to dropped file paths. */
  private async resolveDroppedChanges(dataTransfer: vscode.DataTransfer): Promise<DisplayChange[]> {
    const all = this.provider.getAllChanges();
    const internal = dataTransfer.get(TREE_MIME_TYPE)?.value as DraggedChange[] | undefined;
    if (Array.isArray(internal)) {
      const keys = new Set(internal.map(entry => entry?.fileKey).filter((key): key is string => typeof key === 'string'));
      return all.filter(change => keys.has(change.fileKey));
    }

    const uriList = await dataTransfer.get('text/uri-list')?.asString();
    if (!uriList) {
      return [];
    }
    const paths = new Set(parseUriList(uriList).map(uri => comparablePath(uri.fsPath)));
    return all.filter(change =>
      paths.has(comparablePath(change.change.uri.fsPath)) ||
      (change.change.originalUri ? paths.has(comparablePath(change.change.originalUri.fsPath)) : false)
    );
  }
}

/** Returns the group a drop lands on, or nothing when the target is not droppable. */
export function resolveDropTarget(target: TreeNode | undefined): DropTarget | undefined {
  if (target instanceof GroupNode) {
    return { groupId: target.group?.id };
  }
  if (target instanceof FileNode) {
    return { groupId: target.groupId };
  }
  return undefined;
}

/** Parses the standard newline-separated uri-list payload. */
export function parseUriList(value: string): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const entry of parseUriListEntries(value)) {
    try {
      uris.push(vscode.Uri.parse(entry, true));
    } catch {
      // Entries that are not valid URIs cannot name a tracked change.
    }
  }
  return uris;
}

/** Returns the group currently owning a change, if any. */
function currentGroupId(change: DisplayChange, store: GroupStore): string | undefined {
  for (const key of change.assignmentKeys) {
    const groupId = store.getAssignment(key);
    if (groupId) {
      return groupId;
    }
  }
  return undefined;
}
