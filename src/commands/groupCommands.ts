import * as vscode from 'vscode';
import { describeFileCount } from '../core/text';
import { FileNode, GroupNode } from '../view/nodes';
import { CommandContext, runCommand } from './context';
import { pickChanges, pickColor, pickGroup, pickIcon, promptGroupName } from './prompts';
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
  const { store, provider, view, output } = context;

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
    })),

    vscode.commands.registerCommand('localChangeGroups.assignToGroup', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files');
      if (changes.length === 0) return;
      const group = await pickGroup(store, `Assign or move ${describeFileCount(changes.length)}`);
      if (!group) return;
      await store.moveAssignments(changes, group.id);
      provider.refresh();
      output.appendLine(`Assigned ${describeFileCount(changes.length)} to ${group.name}`);
    })),

    vscode.commands.registerCommand('localChangeGroups.removeFromGroup', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files');
      if (changes.length === 0) return;
      await store.unassignAll(changes.flatMap(change => change.assignmentKeys));
      provider.refresh();
      output.appendLine(`Returned ${describeFileCount(changes.length)} to Ungrouped`);
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
