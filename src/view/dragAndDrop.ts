import * as vscode from 'vscode';
import { moveBefore } from '../core/groups';
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

/**
 * What is in flight.
 *
 * Dragging files means "put these in that group". Dragging group rows means
 * "put these groups there in the list". One mime type covers both, because VS
 * Code has to be told about every one up front and there is no need for two.
 */
type DraggedRows =
  | { kind: 'files'; files: DraggedChange[] }
  | { kind: 'groups'; groupIds: string[] };

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

  /**
   * Packs up the dragged rows: our own payload, plus URIs for everyone else.
   *
   * Rows in the Frozen section are left out. A frozen group refuses new files,
   * and it should not lose them either — the snapshot would keep listing a file
   * that now belongs to another group, so it would show up in both places at
   * once. Unfreeze the group if you want to rearrange it.
   *
   * A live row for a frozen file is still fair game. That is work done since the
   * freeze, and grouping it somewhere else is the point of it being listed.
   */
  public handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const files = source.filter((node): node is FileNode => node instanceof FileNode && !node.frozen);
    if (files.length === 0) {
      // No file rows in the selection, so this might be group rows being put in
      // a different order.
      this.packGroups(source, dataTransfer);
      return;
    }
    const dragged: DraggedChange[] = files.map(node => ({
      fileKey: node.displayChange.fileKey,
      assignmentKeys: node.displayChange.assignmentKeys
    }));
    dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem({ kind: 'files', files: dragged } satisfies DraggedRows));
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(
      files.map(node => node.displayChange.change.uri.toString()).join('\r\n')
    ));
  }

  /**
   * Packs up dragged group rows, so groups can be put in the order you want.
   *
   * Ungrouped is not a group and cannot be moved: it always sits last.
   */
  private packGroups(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const groupIds = source
      .filter((node): node is GroupNode => node instanceof GroupNode && node.group !== undefined)
      .map(node => node.group!.id);
    if (groupIds.length > 0) {
      dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem({ kind: 'groups', groupIds } satisfies DraggedRows));
    }
  }

  /** Works out where the drop landed and moves the files there. */
  public async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      const dragged = dataTransfer.get(TREE_MIME_TYPE)?.value as DraggedRows | undefined;
      if (dragged?.kind === 'groups') {
        await this.reorderGroups(dragged.groupIds, target);
        return;
      }

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

  /**
   * Puts the dragged groups where they were dropped.
   *
   * Dropping onto a group inserts above it. Dropping onto Ungrouped means the
   * end of the list — Ungrouped always sits below every group, so it is the
   * natural gesture, and without it last place would be unreachable.
   */
  private async reorderGroups(groupIds: readonly string[], target: TreeNode | undefined): Promise<void> {
    if (!(target instanceof GroupNode)) {
      return;
    }
    const order = this.store.getGroups().map(group => group.id);
    const moved = target.group
      ? moveBefore(order, groupIds, target.group.id)
      : [...order.filter(id => !groupIds.includes(id)), ...groupIds.filter(id => order.includes(id))];
    if (moved.join() === order.join()) {
      return;
    }
    await this.store.reorderGroups(moved);
    this.provider.refresh();
    this.log(`Reordered ${groupIds.length} group${groupIds.length === 1 ? '' : 's'}`);
  }

  /** Our own payload if this came from inside the tree, otherwise raw paths. */
  private async resolveDroppedChanges(dataTransfer: vscode.DataTransfer): Promise<DisplayChange[]> {
    const all = this.provider.getAllChanges();
    const internal = dataTransfer.get(TREE_MIME_TYPE)?.value as DraggedRows | undefined;
    if (internal?.kind === 'files') {
      const keys = new Set(internal.files.map(entry => entry?.fileKey).filter((key): key is string => typeof key === 'string'));
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
