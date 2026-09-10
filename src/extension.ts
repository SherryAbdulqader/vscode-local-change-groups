import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { registerFreezeCommands } from './commands/freezeCommands';
import { registerGitCommands } from './commands/gitCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { CommandContext, runCommand } from './commands/context';
import { runPanelAction } from './commands/panelActions';
import { selectedGroupId } from './commands/selection';
import { referencedHashes } from './core/frozen';
import { describeFileCount, errorMessage } from './core/text';
import { FrozenDrift } from './data/frozenDrift';
import { GroupStore } from './data/groupStore';
import { SnapshotFiles } from './data/snapshotFiles';
import { getGitApi, GitApi } from './git/api';
import { FreezeContext } from './services/freezeActions';
import { ChangeGroupsTreeProvider } from './view/changeTree';
import { FROZEN_SCHEME, FrozenContentProvider } from './view/frozenContent';
import { CommitPanelProvider } from './view/commitPanel/provider';
import { ChangeDecorationProvider } from './view/decorations';
import { ChangeGroupsDragAndDropController } from './view/dragAndDrop';
import { GroupNode, TreeNode } from './view/nodes';

/**
 * Where everything gets plugged together.
 *
 * Deliberately boring: build the pieces, wire them up, hand them to VS Code for
 * disposal. If you are looking for behavior, it is one directory down.
 *
 *   core/      the actual rules — no vscode import, tested directly
 *   data/      groups, saved in workspace state
 *   git/       the Git extension API and the careful group operations
 *   services/  the Git actions, shared by every way of starting one
 *   view/      the tree, its rows, badges, drag and drop, commit panel
 *   commands/  the user-facing flows: figure out the target, ask, delegate
 *
 * Dependencies point one way. Nothing in core or data has heard of the view, and
 * that is what keeps the test suite runnable without an editor. See
 * ARCHITECTURE.md before moving anything between layers.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Local Change Groups');
  try {
    const store = new GroupStore(context.workspaceState);
    const gitApi = await getGitApi();
    // Frozen contents live beside the extension's other workspace state, never
    // inside .git. storageUri is only absent without a workspace, where there is
    // no repository to freeze anyway.
    const snapshots = new SnapshotFiles(nodePath.join(context.storageUri?.fsPath ?? context.globalStorageUri.fsPath, 'frozen'));
    // Built before the tree because the tree asks it whether a frozen file has
    // been touched since. The callback is what lets a finished check repaint.
    const drift = new FrozenDrift(snapshots, () => provider.repaint());
    const provider = new ChangeGroupsTreeProvider(gitApi, store, drift);
    const decorations = new ChangeDecorationProvider();
    const dragAndDrop = new ChangeGroupsDragAndDropController(provider, store, message => output.appendLine(message));

    const view = vscode.window.createTreeView<TreeNode>('localChangeGroups.view', {
      treeDataProvider: provider,
      dragAndDropController: dragAndDrop,
      canSelectMany: true,
      showCollapseAll: true
    });

    const commands: CommandContext = { store, provider, view, gitApi, snapshots, output };
    const commitPanel = buildCommitPanel(commands);
    const freezeContext = (): FreezeContext => {
      if (!gitApi) throw new Error('The built-in Git extension is unavailable.');
      return { store, provider, snapshots, output, gitPath: gitApi.git.path };
    };

    context.subscriptions.push(
      output,
      provider,
      decorations,
      view,
      commitPanel,
      vscode.window.registerFileDecorationProvider(decorations),
      vscode.window.registerWebviewViewProvider(CommitPanelProvider.viewId, commitPanel),
      // One tree change feeds everything downstream of it — the panel's counts
      // and the badge on the Activity Bar icon.
      provider.onDidChangeTreeData(() => {
        commitPanel.refresh();
        view.badge = changeBadge(provider);
        void vscode.commands.executeCommand(
          'setContext',
          'localChangeGroups.hasFrozen',
          Object.keys(store.getAllFrozen()).length > 0
        );
      }),
      view.onDidChangeSelection(event => commitPanel.setSelectedGroup(selectedGroupId(event.selection))),
      vscode.workspace.registerTextDocumentContentProvider(FROZEN_SCHEME, new FrozenContentProvider(snapshots)),
      ...registerGroupCommands(commands),
      ...registerGitCommands(commands),
      ...registerFreezeCommands(commands, freezeContext)
    );

    view.badge = changeBadge(provider);
    void vscode.commands.executeCommand(
      'setContext',
      'localChangeGroups.hasFrozen',
      Object.keys(store.getAllFrozen()).length > 0
    );

    if (!gitApi) {
      void vscode.window.showInformationMessage('Local Change Groups requires VS Code\'s built-in Git extension.');
    }
    // Loading already dropped snapshots for groups that no longer exist, so this
    // is the moment we know exactly which blobs are still wanted. Clears anything
    // left behind by an earlier session. Not awaited: it is housekeeping.
    void snapshots.prune(referencedHashes(store.getAllFrozen()));
    output.appendLine('Local Change Groups activated with guarded group Git actions.');
  } catch (error) {
    output.appendLine(`Activation failed: ${errorMessage(error)}`);
    void vscode.window.showErrorMessage(`Local Change Groups: ${errorMessage(error)}`);
  }
}

/** Builds the commit panel and tells it how to read state and how to act. */
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

/** How many files are in this group right now, across every repository. */
function countGroupFiles(commands: CommandContext, groupId: string): number {
  // Nothing downstream reads anything but the id, so a stand-in saves a lookup.
  const group = { id: groupId, name: '', color: 'blue' as const };
  return repositoriesOf(commands.gitApi).reduce(
    (total, repository) => total + commands.provider.getGroupChanges(new GroupNode(repository, group)).length,
    0
  );
}

/** The number on the Activity Bar icon. Undefined when there is nothing to show. */
function changeBadge(provider: ChangeGroupsTreeProvider): vscode.ViewBadge | undefined {
  const count = provider.getAllChanges().length;
  return count > 0 ? { value: count, tooltip: `${describeFileCount(count)} changed` } : undefined;
}

/** Open repositories, or an empty list if Git never showed up. */
function repositoriesOf(gitApi: GitApi | undefined) {
  return gitApi?.repositories ?? [];
}

/** Nothing to do here — activation handed everything to context.subscriptions. */
export function deactivate(): void {}
