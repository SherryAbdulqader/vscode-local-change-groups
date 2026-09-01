import * as vscode from 'vscode';
import { comparablePath } from '../core/repositoryPaths';
import { parseUriListEntries } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { ChangeGroupsTreeProvider } from './changeTree';
import { DisplayChange, FileNode, GroupNode, TreeNode } from './nodes';

/** VS Code insists this be exactly application/vnd.code.tree.<view id, lowercased>. */
export const TREE_MIME_TYPE = 'application/vnd.code.tree.localchangegroups.view';

interface DraggedChange {
  fileKey: string;
  assignmentKeys: string[];
}

/** Where a drop landed. No id means the Ungrouped bucket. */
interface DropTarget {
  groupId: string | undefined;
}

/**
 * Drag files onto a group to assign them.
 *
 * Also accepts drops from outside — the Explorer, the built-in Changes list —
 * by falling back to text/uri-list and matching the paths against changes we
 * already know about. Anything we do not recognise is ignored rather than
 * guessed at.
 */
export class ChangeGroupsDragAndDropController implements vscode.TreeDragAndDropController<TreeNode> {
  public readonly dragMimeTypes = ['text/uri-list'];
  public readonly dropMimeTypes = [TREE_MIME_TYPE, 'text/uri-list'];

  /** Needs the tree to read from, the store to write to, and somewhere to log. */
  public constructor(
    private readonly provider: ChangeGroupsTreeProvider,
    private readonly store: GroupStore,
    private readonly log: (message: string) => void
  ) {
    if (!provider || !store || typeof log !== 'function') {
      throw new Error('A provider, store, and logger are required.');
    }
  }

  /** Packs up the dragged rows: our own payload, plus URIs for everyone else. */
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

  /** Works out where the drop landed and moves the files there. */
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
      if (destination.groupId) {
        await this.store.moveAssignments(moved, destination.groupId);
      } else {
        await this.store.unassignAll(moved.flatMap(change => change.assignmentKeys));
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

  /** Our own payload if this came from inside the tree, otherwise raw paths. */
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

/**
 * Which group did this land on?
 *
 * Dropping on a file row means "join that row's group", which is usually what
 * someone aiming at a crowded tree actually meant. Section and repository
 * headers are not targets.
 */
export function resolveDropTarget(target: TreeNode | undefined): DropTarget | undefined {
  if (target instanceof GroupNode) {
    return { groupId: target.group?.id };
  }
  if (target instanceof FileNode) {
    return { groupId: target.groupId };
  }
  return undefined;
}

/** Turns a uri-list payload into URIs, skipping anything unparseable. */
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

/** The group a file is already in, so we can skip no-op moves. */
function currentGroupId(change: DisplayChange, store: GroupStore): string | undefined {
  for (const key of change.assignmentKeys) {
    const groupId = store.getAssignment(key);
    if (groupId) {
      return groupId;
    }
  }
  return undefined;
}
