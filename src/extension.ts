import * as vscode from 'vscode';
import { getGitApi } from './git';
import { GroupStore } from './store';
import { ChangeGroupsTreeProvider, DisplayChange, FileNode, GroupNode } from './tree';

/** Activates the local-only, read-only change grouping view. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Local Change Groups');
  try {
    const store = new GroupStore(context.workspaceState);
    const gitApi = await getGitApi();
    const provider = new ChangeGroupsTreeProvider(gitApi, store);
    const view = vscode.window.createTreeView('localChangeGroups.view', { treeDataProvider: provider, showCollapseAll: true });

    context.subscriptions.push(output, provider, view);
    context.subscriptions.push(
      vscode.commands.registerCommand('localChangeGroups.refresh', () => provider.refresh()),
      vscode.commands.registerCommand('localChangeGroups.createGroup', () => runCommand(output, async () => {
        const name = await vscode.window.showInputBox({
          title: 'Create Local Change Group',
          prompt: 'Group name (stored only in this workspace)',
          validateInput: value => value.trim() ? undefined : 'Enter a group name.'
        });
        if (name === undefined) return;
        await store.createGroup(name);
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
      vscode.commands.registerCommand('localChangeGroups.assignToGroup', (node?: FileNode) => runCommand(output, async () => {
        const change = node?.displayChange ?? await pickChange(provider, 'Select a changed file');
        if (!change) return;
        const group = await pickGroup(store, 'Assign or move to group');
        if (!group) return;
        await store.assign(change.fileKey, group.id);
        provider.refresh();
        output.appendLine(`Assigned ${change.relativePath} to ${group.name}`);
      })),
      vscode.commands.registerCommand('localChangeGroups.removeFromGroup', (node?: FileNode) => runCommand(output, async () => {
        const change = node?.displayChange ?? await pickChange(provider, 'Select a changed file');
        if (!change) return;
        await store.unassign(change.fileKey);
        provider.refresh();
        output.appendLine(`Returned ${change.relativePath} to Ungrouped`);
      })),
      vscode.commands.registerCommand('localChangeGroups.openChange', (node?: FileNode) => runCommand(output, async () => {
        if (!node?.displayChange) {
          throw new Error('Select a changed file to open.');
        }
        const { change } = node.displayChange;
        if (change.status === 7) {
          await vscode.commands.executeCommand('vscode.open', change.uri);
        } else {
          await vscode.commands.executeCommand('git.openChange', change.uri);
        }
      }))
    );

    if (!gitApi) {
      void vscode.window.showInformationMessage('Local Change Groups requires VS Code\'s built-in Git extension.');
    }
    output.appendLine('Local Change Groups activated in read-only Git mode.');
  } catch (error) {
    output.appendLine(`Activation failed: ${errorMessage(error)}`);
    void vscode.window.showErrorMessage(`Local Change Groups: ${errorMessage(error)}`);
  }
}

/** Performs a command with consistent user-visible error handling. */
async function runCommand(output: vscode.OutputChannel, action: () => Promise<void>): Promise<void> {
  if (!output || typeof action !== 'function') {
    throw new Error('A valid command action is required.');
  }
  try {
    await action();
  } catch (error) {
    const message = errorMessage(error);
    output.appendLine(`Command failed: ${message}`);
    void vscode.window.showErrorMessage(`Local Change Groups: ${message}`);
  }
}

/** Prompts for one configured local group. */
async function pickGroup(store: GroupStore, placeHolder: string) {
  if (!placeHolder.trim()) {
    throw new Error('A picker prompt is required.');
  }
  const groups = store.getGroups();
  if (groups.length === 0) {
    void vscode.window.showInformationMessage('Create a local change group first.');
    return undefined;
  }
  const selection = await vscode.window.showQuickPick(
    groups.map(group => ({ label: group.name, group })),
    { placeHolder }
  );
  return selection?.group;
}

/** Prompts for one changed file across all open repositories. */
async function pickChange(provider: ChangeGroupsTreeProvider, placeHolder: string): Promise<DisplayChange | undefined> {
  if (!placeHolder.trim()) {
    throw new Error('A picker prompt is required.');
  }
  const changes = provider.getAllChanges();
  if (changes.length === 0) {
    void vscode.window.showInformationMessage('No Git changes are available.');
    return undefined;
  }
  const selection = await vscode.window.showQuickPick(
    changes.map(change => ({
      label: change.relativePath,
      description: `${change.area} · ${change.repository.rootUri.fsPath}`,
      change
    })),
    { placeHolder, matchOnDescription: true }
  );
  return selection?.change;
}

/** Converts unknown thrown values into concise messages. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Performs no work because activation owns disposable resources. */
export function deactivate(): void {}
