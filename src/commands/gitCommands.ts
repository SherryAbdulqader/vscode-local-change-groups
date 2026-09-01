import * as vscode from 'vscode';
import {
  commitAndPushGroup,
  commitGroup,
  discardChanges,
  stageGroup,
  unstageChanges
} from '../services/changeActions';
import { FileNode, GroupNode } from '../view/nodes';
import { actionContext, CommandContext, runCommand } from './context';
import { pickChanges, promptCommitMessage, requireGroupNode } from './prompts';
import { selectedChanges } from './selection';

/** Git's status number for untracked. There is nothing to diff it against. */
const UNTRACKED = 7;

/**
 * Commands that reach Git.
 *
 * Each one works out *what* to act on, collects any input, and then gets out of
 * the way. The confirmations and the repository lock live in
 * services/changeActions, which is what lets the commit panel share this
 * behavior exactly rather than growing its own slightly different version.
 */
export function registerGitCommands(context: CommandContext): vscode.Disposable[] {
  const { store, provider, view, gitApi, output } = context;

  return [
    vscode.commands.registerCommand('localChangeGroups.openChange', (node?: FileNode) => runCommand(output, async () => {
      if (!node?.displayChange) {
        throw new Error('Select a changed file to open.');
      }
      const { change } = node.displayChange;
      // Nothing committed to compare against, so just open the file.
      if (change.status === UNTRACKED) {
        await vscode.commands.executeCommand('vscode.open', change.uri);
      } else {
        await vscode.commands.executeCommand('git.openChange', change.uri);
      }
    })),

    vscode.commands.registerCommand('localChangeGroups.stageGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireGroupNode(node, store, gitApi, 'Select a group to stage');
      if (!selected) return;
      await stageGroup(actionContext(context), selected);
    })),

    vscode.commands.registerCommand('localChangeGroups.commitGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireGroupNode(node, store, gitApi, 'Select a group to commit');
      if (!selected) return;
      const message = await promptCommitMessage(selected.group!);
      if (!message) return;
      await commitGroup(actionContext(context), selected, message);
    })),

    vscode.commands.registerCommand('localChangeGroups.commitAndPushGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireGroupNode(node, store, gitApi, 'Select a group to commit and push');
      if (!selected) return;
      const message = await promptCommitMessage(selected.group!);
      if (!message) return;
      await commitAndPushGroup(actionContext(context), selected, message);
    })),

    vscode.commands.registerCommand('localChangeGroups.unstageGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireGroupNode(node, store, gitApi, 'Select a group to unstage');
      if (!selected) return;
      await unstageChanges(actionContext(context), provider.getGroupChanges(selected), selected.group!.name);
    })),

    vscode.commands.registerCommand('localChangeGroups.unstageChanges', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select files to unstage');
      if (changes.length === 0) return;
      await unstageChanges(actionContext(context), changes);
    })),

    vscode.commands.registerCommand('localChangeGroups.discardGroupChanges', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireGroupNode(node, store, gitApi, 'Select a group to discard');
      if (!selected) return;
      await discardChanges(actionContext(context), provider.getGroupChanges(selected), selected.group!.name);
    })),

    vscode.commands.registerCommand('localChangeGroups.discardChanges', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
      const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files to discard');
      if (changes.length === 0) return;
      await discardChanges(actionContext(context), changes);
    })),

    vscode.commands.registerCommand('localChangeGroups.refresh', () => provider.refresh())
  ];
}
