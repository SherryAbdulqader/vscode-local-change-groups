import * as vscode from 'vscode';
import { referencedHashes } from '../core/frozen';
import { moveInOrder } from '../core/groups';
import { describeFileCount } from '../core/text';
import { DisplayChange, FileNode, GroupNode } from '../view/nodes';
import { CommandContext, runCommand } from './context';
import { pickAssignTarget, pickChanges, pickColor, pickGroup, pickIcon, promptGroupName, requireRepository } from './prompts';
import { selectedChanges } from './selection';

/**
 * Commands that rearrange your groups and nothing else.
 *
 * Not one of these can touch the repository, which is why only deleting a group
 * bothers to confirm — everything else here is trivially undoable by doing it
 * again. Each command writes through a single store call, so dropping forty
 * files into a group is one save rather than forty.
 */
export function registerGroupCommands(context: CommandContext): vscode.Disposable[] {
  const { store, provider, view, gitApi, snapshots, output } = context;

  /**
   * Asks where a batch of files should go, and puts them there.
   *
   * Both assignment commands come through here so they offer the same choices.
   * Frozen groups are not among them — the store refuses files while a group is
   * frozen, so listing one could only ever end in an error message — and making
   * a new group is offered instead, which is also the way out when there are no
   * groups yet.
   *
   * `what` is the phrase for the batch, so the prompts and the log read as
   * sentences: "Add all 12 files to group".
   */
  const fileIntoGroup = async (changes: DisplayChange[], what: string): Promise<void> => {
    const target = await pickAssignTarget(store, `Add ${what} to group`);
    if (!target) return;

    if (target.kind === 'existing') {
      await store.moveAssignments(changes, target.group.id);
      provider.refresh();
      output.appendLine(`Assigned ${what} to ${target.group.name}`);
      return;
    }

    const name = await promptGroupName('New Group', `Name for a group holding ${what} (stored only in this workspace)`);
    if (name === undefined) return;
    const color = await pickColor();
    if (!color) return;
    // Created and filled in one write, so a rejected duplicate name cannot leave
    // an empty group sitting there.
    const group = await store.createGroup(name, color, changes);
    provider.refresh();
    output.appendLine(`Created ${group.name} holding ${what}`);
  };

  /**
   * Moves one group a step up or down the list.
   *
   * The stored order is the display order, so this just rewrites it. Nudging the
   * top group up does nothing rather than wrapping it round to the bottom, which
   * is why the menu entries can stay enabled at the ends.
   */
  const shiftGroup = async (node: GroupNode | undefined, step: number): Promise<void> => {
    const group = node?.group ?? await pickGroup(store, step < 0 ? 'Select a group to move up' : 'Select a group to move down');
    if (!group) return;
    await store.reorderGroups(moveInOrder(store.getGroups().map(item => item.id), group.id, step));
    provider.refresh();
  };

  return [
    vscode.commands.registerCommand('localChangeGroups.createGroup', () => runCommand(output, async () => {
      const name = await promptGroupName('Create Local Change Group', 'Group name (stored only in this workspace)');
      if (name === undefined) return;
      const color = await pickColor();
      if (!color) return;
      await store.createGroup(name, color);
      provider.refresh();
      output.appendLine(`Created local group: ${name.trim()}`);
    })),

    vscode.commands.registerCommand('localChangeGroups.renameGroup', (node?: GroupNode) => runCommand(output, async () => {
      const group = node?.group ?? await pickGroup(store, 'Select a group to rename');
      if (!group) return;
      const name = await vscode.window.showInputBox({ title: 'Rename Local Change Group', value: group.name });
      if (name === undefined) return;
      await store.renameGroup(group.id, name);
      provider.refresh();
      output.appendLine(`Renamed local group to: ${name.trim()}`);
    })),

    vscode.commands.registerCommand('localChangeGroups.changeColor', (node?: GroupNode) => runCommand(output, async () => {
      const group = node?.group ?? await pickGroup(store, 'Select a group to recolor');
      if (!group) return;
      const color = await pickColor(group.color);
      if (!color) return;
      await store.setGroupColor(group.id, color);
      provider.refresh();
      output.appendLine(`Changed ${group.name} color to ${color}`);
    })),

    vscode.commands.registerCommand('localChangeGroups.changeIcon', (node?: GroupNode) => runCommand(output, async () => {
      const group = node?.group ?? await pickGroup(store, 'Select a group to change its icon');
      if (!group) return;
      const icon = await pickIcon(group.icon);
      if (!icon) return;
      await store.setGroupIcon(group.id, icon);
      provider.refresh();
      output.appendLine(`Changed ${group.name} icon to ${icon}`);
    })),

    vscode.commands.registerCommand('localChangeGroups.deleteGroup', (node?: GroupNode) => runCommand(output, async () => {
      const group = node?.group ?? await pickGroup(store, 'Select a group to delete');
      if (!group) return;
      const answer = await vscode.window.showWarningMessage(
        `Delete local group "${group.name}"? Files will return to Ungrouped.`,
        { modal: true },
        'Delete'
      );
      if (answer !== 'Delete') return;
      await store.deleteGroup(group.id);
      provider.refresh();
      output.appendLine(`Deleted local group: ${group.name}`);
      // If it was frozen, its snapshot went with it and nobody references those
      // blobs any more. Only the freeze commands prune, so without this they
      // would sit in storage until the next unfreeze happened to sweep them up.
      await snapshots.prune(referencedHashes(store.getAllFrozen()));
    })),

    vscode.commands.registerCommand('localChangeGroups.assignToGroup', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files');
      if (changes.length === 0) return;
      await fileIntoGroup(changes, describeFileCount(changes.length));
    })),

    vscode.commands.registerCommand('localChangeGroups.removeFromGroup', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files');
      if (changes.length === 0) return;
      await store.unassignAll(changes.flatMap(change => change.assignmentKeys));
      provider.refresh();
      output.appendLine(`Returned ${describeFileCount(changes.length)} to Ungrouped`);
    })),

    /**
     * Empty the Ungrouped row into one group in a single move.
     *
     * The row can easily hold a hundred files after a branch switch, and filing
     * them by hand — or even by selecting them all first — is the tedious part
     * this whole view exists to remove. So this takes whatever the row is
     * showing, all sections at once, and asks only where to put it.
     *
     * No confirmation, deliberately: nothing here touches the repository, and
     * the way to undo it is to do it again with a different answer.
     */
    vscode.commands.registerCommand('localChangeGroups.assignAllUngrouped', (node?: GroupNode) => runCommand(output, async () => {
      const repository = requireRepository(node, gitApi);
      const changes = provider.getUngroupedChanges(repository);
      if (changes.length === 0) {
        void vscode.window.showInformationMessage('Nothing is ungrouped.');
        return;
      }

      await fileIntoGroup(changes, `all ${describeFileCount(changes.length)}`);
    })),

    vscode.commands.registerCommand('localChangeGroups.moveGroupUp', (node?: GroupNode) => runCommand(output, () => shiftGroup(node, -1))),

    vscode.commands.registerCommand('localChangeGroups.moveGroupDown', (node?: GroupNode) => runCommand(output, () => shiftGroup(node, 1))),

    vscode.commands.registerCommand('localChangeGroups.sortGroups', () => runCommand(output, async () => {
      const groups = store.getGroups();
      if (groups.length < 2) {
        void vscode.window.showInformationMessage('There is nothing to sort yet.');
        return;
      }
      const sorted = [...groups].sort((left, right) => left.name.localeCompare(right.name));
      await store.reorderGroups(sorted.map(group => group.id));
      provider.refresh();
      output.appendLine(`Sorted ${groups.length} groups by name`);
    })),

    vscode.commands.registerCommand('localChangeGroups.createGroupFromSelection', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select files for the new group');
      if (changes.length === 0) return;
      const name = await promptGroupName(
        'New Group from Selection',
        `Name for a group holding ${describeFileCount(changes.length)} (stored only in this workspace)`
      );
      if (name === undefined) return;
      const color = await pickColor();
      if (!color) return;
      // Create and fill in one call, so a rejected duplicate name does not leave
      // a sad empty group sitting there.
      const group = await store.createGroup(name, color, changes);
      provider.refresh();
      output.appendLine(`Created ${group.name} holding ${describeFileCount(changes.length)}`);
    }))
  ];
}
