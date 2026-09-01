import * as vscode from 'vscode';
import { registerGitCommands } from './commands/gitCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { CommandContext, runCommand } from './commands/context';
import { runPanelAction } from './commands/panelActions';
import { selectedGroupId } from './commands/selection';
import { describeFileCount, errorMessage } from './core/text';
import { GroupStore } from './data/groupStore';
import { getGitApi, GitApi } from './git/api';
import { ChangeGroupsTreeProvider } from './view/changeTree';
import { CommitPanelProvider } from './view/commitPanel/provider';
import { ChangeDecorationProvider } from './view/decorations';
import { ChangeGroupsDragAndDropController } from './view/dragAndDrop';
import { GroupNode, TreeNode } from './view/nodes';

/**
 * Composition root.
 *
 * This file only builds the pieces, wires them together, and registers them for
 * disposal. All behavior lives in the layers below it:
 *
 *   core/      pure domain — no vscode import, unit-tested directly
 *   data/      group metadata persisted in workspace state
 *   git/       the Git extension API and guarded group operations
 *   services/  the Git actions themselves, shared by every entry point
 *   view/      the tree, its rows, decorations, drag and drop, commit panel
 *   commands/  user-facing flows: resolve a target, prompt, delegate
 *
 * Dependencies point downward only; nothing in core or data knows the view exists.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Local Change Groups');
  try {
    const store = new GroupStore(context.workspaceState);
    const gitApi = await getGitApi();
    const provider = new ChangeGroupsTreeProvider(gitApi, store);
    const decorations = new ChangeDecorationProvider();
    const dragAndDrop = new ChangeGroupsDragAndDropController(provider, store, message => output.appendLine(message));

    const view = vscode.window.createTreeView<TreeNode>('localChangeGroups.view', {
      treeDataProvider: provider,
      dragAndDropController: dragAndDrop,
      canSelectMany: true,
      showCollapseAll: true
    });

    const commands: CommandContext = { store, provider, view, gitApi, output };
    const commitPanel = buildCommitPanel(commands);

    context.subscriptions.push(
      output,
      provider,
      decorations,
      view,
      commitPanel,
      vscode.window.registerFileDecorationProvider(decorations),
      vscode.window.registerWebviewViewProvider(CommitPanelProvider.viewId, commitPanel),
      // One tree change drives everything derived from it: the panel's counts
      // and the Activity Bar badge.
      provider.onDidChangeTreeData(() => {
        commitPanel.refresh();
        view.badge = changeBadge(provider);
      }),
      view.onDidChangeSelection(event => commitPanel.setSelectedGroup(selectedGroupId(event.selection))),
      ...registerGroupCommands(commands),
      ...registerGitCommands(commands)
    );

    view.badge = changeBadge(provider);

    if (!gitApi) {
      void vscode.window.showInformationMessage('Local Change Groups requires VS Code\'s built-in Git extension.');
    }
    output.appendLine('Local Change Groups activated with guarded group Git actions.');
  } catch (error) {
    output.appendLine(`Activation failed: ${errorMessage(error)}`);
    void vscode.window.showErrorMessage(`Local Change Groups: ${errorMessage(error)}`);
  }
}

/** Builds the commit panel, reading live group state and running panel actions. */
function buildCommitPanel(commands: CommandContext): CommitPanelProvider {
  return new CommitPanelProvider(
    () => ({
      branch: commands.gitApi?.repositories[0]?.state.HEAD?.name,
      groups: commands.store.getGroups().map(group => ({
        id: group.id,
        name: group.name,
        color: group.color,
        count: countGroupFiles(commands, group.id)
      }))
    }),
    (action, groupId, message) => runCommand(
      commands.output,
      () => runPanelAction(commands, action, groupId, message)
    )
  );
}

/** Counts the files a group currently holds, across open repositories. */
function countGroupFiles(commands: CommandContext, groupId: string): number {
  // Only the id is read downstream, so a minimal stand-in group avoids a lookup.
  const group = { id: groupId, name: '', color: 'blue' as const };
  return repositoriesOf(commands.gitApi).reduce(
    (total, repository) => total + commands.provider.getGroupChanges(new GroupNode(repository, group)).length,
    0
  );
}

/** Returns the Activity Bar badge counting every changed file, or none when clean. */
function changeBadge(provider: ChangeGroupsTreeProvider): vscode.ViewBadge | undefined {
  const count = provider.getAllChanges().length;
  return count > 0 ? { value: count, tooltip: `${describeFileCount(count)} changed` } : undefined;
}

/** Returns open repositories, tolerating an unavailable Git extension. */
function repositoriesOf(gitApi: GitApi | undefined) {
  return gitApi?.repositories ?? [];
}

/** Performs no work because activation owns disposable resources. */
export function deactivate(): void {}
