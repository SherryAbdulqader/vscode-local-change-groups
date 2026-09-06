import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { frozenLabel } from '../core/frozen';
import { FreezeContext, freezeGroup, refreezeGroup, unfreezeAll, unfreezeGroup } from '../services/freezeActions';
import { frozenUri } from '../view/frozenContent';
import { FileNode, GroupNode } from '../view/nodes';
import { CommandContext, runCommand } from './context';
import { requireFrozenGroupNode, requireGroupNode } from './prompts';

/**
 * Freeze, unfreeze, and the two ways of looking at a frozen file.
 *
 * Everything here is about *viewing*. Freezing never writes to your working tree
 * or the index, so none of these commands confirm anything — the worst outcome
 * of a misclick is a group that needs unfreezing again.
 */
export function registerFreezeCommands(
  context: CommandContext,
  freezeContext: () => FreezeContext
): vscode.Disposable[] {
  const { store, gitApi, output } = context;

  return [
    vscode.commands.registerCommand('localChangeGroups.freezeGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireGroupNode(node, store, gitApi, 'Select a group to freeze');
      if (!selected) return;
      await freezeGroup(freezeContext(), selected);
    })),

    vscode.commands.registerCommand('localChangeGroups.unfreezeGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireFrozenGroupNode(node, store, gitApi, 'Select a group to unfreeze');
      if (!selected) return;
      await unfreezeGroup(freezeContext(), selected);
    })),

    vscode.commands.registerCommand('localChangeGroups.refreezeGroup', (node?: GroupNode) => runCommand(output, async () => {
      const selected = await requireFrozenGroupNode(node, store, gitApi, 'Select a group to re-capture');
      if (!selected) return;
      await refreezeGroup(freezeContext(), selected);
    })),

    vscode.commands.registerCommand('localChangeGroups.unfreezeAllGroups', () => runCommand(output, async () => {
      await unfreezeAll(freezeContext());
    })),

    /**
     * The diff a frozen row opens: the committed side against the bytes you
     * froze. Both come from storage, so it shows the same thing today as it did
     * the moment you froze it, no matter what has happened to the file since.
     */
    vscode.commands.registerCommand('localChangeGroups.openFrozenChange', (node?: FileNode) => runCommand(output, async () => {
      if (!node?.frozen) {
        throw new Error('Select a file in a frozen group.');
      }
      const { frozen, displayChange } = node;
      const when = node.groupId ? store.getFrozen(node.groupId)?.frozenAt : undefined;
      const name = nodePath.basename(frozen.relativePath);
      await vscode.commands.executeCommand(
        'vscode.diff',
        frozenUri(frozen.relativePath, frozen.baseHash, 'base'),
        frozenUri(frozen.relativePath, frozen.frozenHash, 'frozen'),
        `${name} (frozen${when ? ` ${frozenLabel(when)}` : ''})`,
        { preview: true }
      );
      output.appendLine(`Opened frozen diff for ${displayChange.relativePath}`);
    })),

    /**
     * The other useful diff: what you froze against what the file says now. This
     * is the one that answers "have I broken this since I parked it?".
     */
    vscode.commands.registerCommand('localChangeGroups.compareFrozenWithCurrent', (node?: FileNode) => runCommand(output, async () => {
      if (!node?.frozen) {
        throw new Error('Select a file in a frozen group.');
      }
      const { frozen } = node;
      const name = nodePath.basename(frozen.relativePath);
      await vscode.commands.executeCommand(
        'vscode.diff',
        frozenUri(frozen.relativePath, frozen.frozenHash, 'frozen'),
        node.displayChange.change.uri,
        `${name} (frozen ↔ current)`,
        { preview: true }
      );
    }))
  ];
}
