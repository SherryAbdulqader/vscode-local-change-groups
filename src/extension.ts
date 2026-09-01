import * as vscode from 'vscode';
import { CommitPanelProvider, PanelAction } from './commitPanel';
import { ChangeDecorationProvider } from './decoration';
import { ChangeGroupsDragAndDropController } from './dragAndDrop';
import { getGitApi } from './git';
import { GroupStore } from './store';
import { ChangeGroupsTreeProvider, DisplayChange, FileNode, GroupNode } from './tree';
import { DEFAULT_GROUP_ICON, GROUP_COLORS, GROUP_ICONS, GroupColor, LocalGroup, normalizeGroupIcon } from './model';
import { acquireRepositoryLock, buildOperationPlan, executeGroupOperation } from './operations';
import { isInSection, partitionForDiscard } from './presentation';

/** Activates the local grouping view and guarded Git actions. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Local Change Groups');
  try {
    const store = new GroupStore(context.workspaceState);
    const gitApi = await getGitApi();
    const provider = new ChangeGroupsTreeProvider(gitApi, store);
    const decorations = new ChangeDecorationProvider();
    const dragAndDrop = new ChangeGroupsDragAndDropController(provider, store, message => output.appendLine(message));
    const view = vscode.window.createTreeView('localChangeGroups.view', {
      treeDataProvider: provider,
      dragAndDropController: dragAndDrop,
      canSelectMany: true,
      showCollapseAll: true
    });

    const commitPanel = new CommitPanelProvider(
      () => ({
        branch: gitApi?.repositories[0]?.state.HEAD?.name,
        groups: store.getGroups().map(group => ({
          id: group.id,
          name: group.name,
          color: group.color,
          count: countGroupFiles(provider, gitApi, group.id)
        }))
      }),
      (action, groupId, message) => runCommand(output, async () => {
        const selected = groupNodeById(groupId, store, gitApi);
        await runPanelAction(action, selected, provider, gitApi!.git.path, message, output);
      })
    );

    context.subscriptions.push(output, provider, decorations, view, commitPanel);
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorations));
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(CommitPanelProvider.viewId, commitPanel),
      provider.onDidChangeTreeData(() => {
        commitPanel.refresh();
        view.badge = changeBadge(provider);
      }),
      view.onDidChangeSelection(event => commitPanel.setSelectedGroup(selectedGroupId(event.selection)))
    );
    view.badge = changeBadge(provider);
    context.subscriptions.push(
      vscode.commands.registerCommand('localChangeGroups.refresh', () => provider.refresh()),
      vscode.commands.registerCommand('localChangeGroups.createGroup', () => runCommand(output, async () => {
        const name = await vscode.window.showInputBox({
          title: 'Create Local Change Group',
          prompt: 'Group name (stored only in this workspace)',
          validateInput: value => value.trim() ? undefined : 'Enter a group name.'
        });
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
        const group = await pickGroup(store, `Assign or move ${describeCount(changes.length)}`);
        if (!group) return;
        await store.moveAssignments(changes, group.id);
        provider.refresh();
        output.appendLine(`Assigned ${describeCount(changes.length)} to ${group.name}`);
      })),
      vscode.commands.registerCommand('localChangeGroups.removeFromGroup', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
        const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files');
        if (changes.length === 0) return;
        await store.unassignAll(changes.flatMap(change => change.assignmentKeys));
        provider.refresh();
        output.appendLine(`Returned ${describeCount(changes.length)} to Ungrouped`);
      })),
      vscode.commands.registerCommand('localChangeGroups.createGroupFromSelection', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
        const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select files for the new group');
        if (changes.length === 0) return;
        const name = await vscode.window.showInputBox({
          title: 'New Group from Selection',
          prompt: `Name for a group holding ${describeCount(changes.length)} (stored only in this workspace)`,
          validateInput: value => value.trim() ? undefined : 'Enter a group name.'
        });
        if (name === undefined) return;
        const color = await pickColor();
        if (!color) return;
        const group = await store.createGroup(name, color, changes);
        provider.refresh();
        output.appendLine(`Created ${group.name} holding ${describeCount(changes.length)}`);
      })),
      vscode.commands.registerCommand('localChangeGroups.unstageChanges', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
        const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select files to unstage');
        if (changes.length === 0) return;
        await unstageChanges(changes, provider, output);
      })),
      vscode.commands.registerCommand('localChangeGroups.unstageGroup', (node?: GroupNode) => runCommand(output, async () => {
        const selected = await requireGroupNode(node, store, gitApi, 'Select a group to unstage');
        if (!selected) return;
        await unstageChanges(provider.getGroupChanges(selected), provider, output, selected.group!.name);
      })),
      vscode.commands.registerCommand('localChangeGroups.discardChanges', (node?: FileNode, nodes?: FileNode[]) => runCommand(output, async () => {
        const changes = selectedChanges(node, nodes, view) ?? await pickChanges(provider, 'Select changed files to discard');
        if (changes.length === 0) return;
        await discardChanges(changes, provider, output);
      })),
      vscode.commands.registerCommand('localChangeGroups.discardGroupChanges', (node?: GroupNode) => runCommand(output, async () => {
        const selected = await requireGroupNode(node, store, gitApi, 'Select a group to discard');
        if (!selected) return;
        await discardChanges(provider.getGroupChanges(selected), provider, output, selected.group!.name);
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
      })),
      vscode.commands.registerCommand('localChangeGroups.stageGroup', (node?: GroupNode) => runCommand(output, async () => {
        const selected = await requireGroupNode(node, store, gitApi, 'Select a group to stage');
        if (!selected) return;
        await stageGroupNode(selected, provider, gitApi!.git.path);
      })),
      vscode.commands.registerCommand('localChangeGroups.commitGroup', (node?: GroupNode) => runCommand(output, async () => {
        const selected = await requireGroupNode(node, store, gitApi, 'Select a group to commit');
        if (!selected) return;
        const message = await promptCommitMessage(selected.group!);
        if (!message) return;
        await commitGroupNode(selected, provider, gitApi!.git.path, message);
      })),
      vscode.commands.registerCommand('localChangeGroups.commitAndPushGroup', (node?: GroupNode) => runCommand(output, async () => {
        const selected = await requireGroupNode(node, store, gitApi, 'Select a group to commit and push');
        if (!selected) return;
        const message = await promptCommitMessage(selected.group!);
        if (!message) return;
        await pushGroupNode(selected, provider, gitApi!.git.path, message);
      }))
    );

    if (!gitApi) {
      void vscode.window.showInformationMessage('Local Change Groups requires VS Code\'s built-in Git extension.');
    }
    output.appendLine('Local Change Groups activated with guarded group Git actions.');
  } catch (error) {
    output.appendLine(`Activation failed: ${errorMessage(error)}`);
    void vscode.window.showErrorMessage(`Local Change Groups: ${errorMessage(error)}`);
  }
}

/** Runs the action a commit panel button asked for. */
async function runPanelAction(
  action: PanelAction,
  selected: GroupNode,
  provider: ChangeGroupsTreeProvider,
  gitPath: string,
  message: string,
  output: vscode.OutputChannel
): Promise<void> {
  if (action === 'stage') {
    await stageGroupNode(selected, provider, gitPath);
    return;
  }
  if (action === 'unstage') {
    await unstageChanges(provider.getGroupChanges(selected), provider, output, selected.group!.name);
    return;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Enter a commit message.');
  }
  if (action === 'commit') {
    await commitGroupNode(selected, provider, gitPath, trimmed);
  } else {
    await pushGroupNode(selected, provider, gitPath, trimmed);
  }
}

/** Resolves a stored group id to exactly one repository's group row. */
function groupNodeById(
  groupId: string,
  store: GroupStore,
  gitApi: Awaited<ReturnType<typeof getGitApi>>
): GroupNode {
  const group = store.getGroups().find(candidate => candidate.id === groupId);
  if (!group) throw new Error('Group not found.');
  const repositories = gitApi?.repositories ?? [];
  if (repositories.length !== 1) {
    throw new Error('Run this action from a group row when multiple repositories are open.');
  }
  return new GroupNode(repositories[0], group);
}

/** Counts the files a group currently holds, across open repositories. */
function countGroupFiles(
  provider: ChangeGroupsTreeProvider,
  gitApi: Awaited<ReturnType<typeof getGitApi>>,
  groupId: string
): number {
  const group = { id: groupId, name: '', color: 'blue' as const };
  return (gitApi?.repositories ?? [])
    .reduce((total, repository) => total + provider.getGroupChanges(new GroupNode(repository, group)).length, 0);
}

/** Returns the Activity Bar badge counting every changed file, or none when clean. */
function changeBadge(provider: ChangeGroupsTreeProvider): vscode.ViewBadge | undefined {
  const count = provider.getAllChanges().length;
  return count > 0 ? { value: count, tooltip: `${describeCount(count)} changed` } : undefined;
}

/** Returns the group a tree selection points at, if any. */
function selectedGroupId(selection: readonly unknown[]): string | undefined {
  for (const node of selection) {
    if (node instanceof GroupNode && node.group) return node.group.id;
    if (node instanceof FileNode && node.groupId) return node.groupId;
  }
  return undefined;
}

/**
 * Removes files from the index without touching the working tree. Entries that
 * are not staged are ignored rather than treated as an error for the whole batch.
 */
async function unstageChanges(
  changes: readonly DisplayChange[],
  provider: ChangeGroupsTreeProvider,
  output: vscode.OutputChannel,
  groupName?: string
): Promise<void> {
  const staged = changes.filter(item => isInSection(item.area, 'staged'));
  if (staged.length === 0) {
    throw new Error('Nothing to unstage: none of those files are staged.');
  }
  for (const repository of new Set(staged.map(item => item.repository))) {
    const release = acquireRepositoryLock(repository.rootUri.fsPath);
    try {
      const paths = staged.filter(item => item.repository === repository).map(item => item.change.uri.fsPath);
      await repository.revert(paths);
    } finally {
      release();
    }
  }
  provider.refresh();
  const scope = groupName ? ` in group "${groupName}"` : '';
  output.appendLine(`Unstaged ${describeCount(staged.length)}${scope}`);
  void vscode.window.showInformationMessage(`Unstaged ${describeCount(staged.length)}${scope}.`);
}

/**
 * Discards working-tree changes after a modal that states deletions separately
 * from reverts. Staged-only entries are left alone rather than being unstaged.
 */
async function discardChanges(
  changes: readonly DisplayChange[],
  provider: ChangeGroupsTreeProvider,
  output: vscode.OutputChannel,
  groupName?: string
): Promise<void> {
  const { restore, remove, skip } = partitionForDiscard(changes, item => item.area, item => item.change.status);
  const affected = [...restore, ...remove];
  if (affected.length === 0) {
    throw new Error('Nothing to discard: the selection has no working-tree changes.');
  }

  const detail = [
    restore.length ? `${describeCount(restore.length)} will be restored to the last committed state.` : '',
    remove.length ? `${describeCount(remove.length)} untracked will be permanently deleted from disk.` : '',
    skip.length ? `${describeCount(skip.length)} staged with no further edit will be left alone.` : ''
  ].filter(Boolean).join('\n');

  const confirmation = await vscode.window.showWarningMessage(
    groupName
      ? `Discard working-tree changes in group "${groupName}"? This cannot be undone.`
      : `Discard working-tree changes in ${describeCount(affected.length)}? This cannot be undone.`,
    { modal: true, detail },
    'Discard Changes'
  );
  if (confirmation !== 'Discard Changes') return;

  for (const repository of new Set(affected.map(item => item.repository))) {
    const release = acquireRepositoryLock(repository.rootUri.fsPath);
    try {
      const paths = affected.filter(item => item.repository === repository).map(item => item.change.uri.fsPath);
      await repository.clean(paths);
    } finally {
      release();
    }
  }
  provider.refresh();
  output.appendLine(`Discarded ${describeCount(affected.length)}${groupName ? ` in ${groupName}` : ''}`);
}

/** Stages exactly one group's files. */
async function stageGroupNode(selected: GroupNode, provider: ChangeGroupsTreeProvider, gitPath: string): Promise<void> {
  const changes = provider.getGroupChanges(selected);
  const plan = buildOperationPlan(selected.repository, changes.map(item => item.change), 'stage');
  await executeGroupOperation(selected.repository, plan, gitPath);
  provider.refresh();
  void vscode.window.showInformationMessage(`Staged only group "${selected.group!.name}".`);
}

/** Commits exactly one group's files with an already-resolved message. */
async function commitGroupNode(selected: GroupNode, provider: ChangeGroupsTreeProvider, gitPath: string, message: string): Promise<void> {
  const plan = buildOperationPlan(selected.repository, provider.getGroupChanges(selected).map(item => item.change), 'commit');
  await executeGroupOperation(selected.repository, plan, gitPath, message);
  provider.refresh();
  void vscode.window.showInformationMessage(`Committed only group "${selected.group!.name}".`);
}

/** Confirms, then commits and pushes exactly one group's files. */
async function pushGroupNode(selected: GroupNode, provider: ChangeGroupsTreeProvider, gitPath: string, message: string): Promise<void> {
  const plan = buildOperationPlan(selected.repository, provider.getGroupChanges(selected).map(item => item.change), 'push');
  const confirmation = await vscode.window.showWarningMessage(
    `Commit and push exactly group "${selected.group!.name}" on branch "${plan.branch}"?`,
    { modal: true },
    'Commit & Push'
  );
  if (confirmation !== 'Commit & Push') return;
  try {
    await executeGroupOperation(selected.repository, plan, gitPath, message, true);
  } catch (error) {
    throw new Error(`${errorMessage(error)} If the commit succeeded, it remains local and can be pushed after resolving the problem.`);
  }
  provider.refresh();
  void vscode.window.showInformationMessage(`Pushed only group "${selected.group!.name}".`);
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

/**
 * Resolves the file rows a command should act on, preferring the whole
 * multi-selection whenever the invoked row is part of it.
 */
export function selectedChanges(
  node: FileNode | undefined,
  nodes: readonly (FileNode | unknown)[] | undefined,
  view: Pick<vscode.TreeView<unknown>, 'selection'>
): DisplayChange[] | undefined {
  const fromArgument = (nodes ?? []).filter((candidate): candidate is FileNode => candidate instanceof FileNode);
  const candidates = fromArgument.length > 0
    ? fromArgument
    : (view.selection ?? []).filter((candidate): candidate is FileNode => candidate instanceof FileNode);
  const includesInvoked = !node || candidates.some(candidate => candidate.displayChange.fileKey === node.displayChange.fileKey);
  const chosen = includesInvoked && candidates.length > 0 ? candidates : node ? [node] : [];
  if (chosen.length === 0) {
    return undefined;
  }
  const byKey = new Map(chosen.map(item => [item.displayChange.fileKey, item.displayChange]));
  return [...byKey.values()];
}

/** Describes a file count for log lines and prompts. */
function describeCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
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

/** Prompts for one or more changed files across all open repositories. */
async function pickChanges(provider: ChangeGroupsTreeProvider, placeHolder: string): Promise<DisplayChange[]> {
  if (!placeHolder.trim()) {
    throw new Error('A picker prompt is required.');
  }
  const changes = provider.getAllChanges();
  if (changes.length === 0) {
    void vscode.window.showInformationMessage('No Git changes are available.');
    return [];
  }
  const selection = await vscode.window.showQuickPick(
    changes.map(change => ({
      label: change.relativePath,
      description: `${change.area} · ${change.repository.rootUri.fsPath}`,
      change
    })),
    { placeHolder, matchOnDescription: true, canPickMany: true }
  );
  return (selection ?? []).map(item => item.change);
}

/** Prompts for a predefined theme-aware group color. */
async function pickColor(current?: GroupColor): Promise<GroupColor | undefined> {
  const selection = await vscode.window.showQuickPick(
    GROUP_COLORS.map(color => ({ label: color[0].toUpperCase() + color.slice(1), description: color === current ? 'Current' : undefined, color })),
    { placeHolder: 'Choose a group color' }
  );
  return selection?.color;
}

/**
 * Prompts for a group codicon. Each row previews the icon itself through the
 * `$(id)` label syntax, and the last row accepts any codicon id by hand.
 */
async function pickIcon(current?: string): Promise<string | undefined> {
  const active = current ?? DEFAULT_GROUP_ICON;
  const selection = await vscode.window.showQuickPick(
    [
      ...GROUP_ICONS.map(icon => ({
        label: `$(${icon.id}) ${icon.hint}`,
        description: icon.id === active ? `${icon.id} · Current` : icon.id,
        icon: icon.id as string | undefined
      })),
      { label: '$(edit) Custom…', description: 'Enter any VS Code codicon id', icon: undefined }
    ],
    { placeHolder: 'Choose a group icon', matchOnDescription: true }
  );
  if (!selection) return undefined;
  if (selection.icon) return selection.icon;

  const typed = await vscode.window.showInputBox({
    title: 'Custom Group Icon',
    prompt: 'A VS Code codicon id, such as "beaker" or "symbol-event"',
    value: current,
    validateInput: value => {
      try {
        normalizeGroupIcon(value);
        return undefined;
      } catch (error) {
        return errorMessage(error);
      }
    }
  });
  return typed ? normalizeGroupIcon(typed) : undefined;
}

/** Resolves an explicit or picked named group to exactly one repository. */
async function requireGroupNode(
  node: GroupNode | undefined,
  store: GroupStore,
  gitApi: Awaited<ReturnType<typeof getGitApi>>,
  prompt: string
): Promise<GroupNode | undefined> {
  if (node?.group) return node;
  const group = await pickGroup(store, prompt);
  if (!group) return undefined;
  const repositories = gitApi?.repositories ?? [];
  if (repositories.length !== 1) throw new Error('Run this command from a group row when multiple repositories are open.');
  return new GroupNode(repositories[0], group);
}

/** Prompts for a non-empty commit message tied to a selected group. */
async function promptCommitMessage(group: LocalGroup): Promise<string | undefined> {
  const message = await vscode.window.showInputBox({
    title: `Commit Group: ${group.name}`,
    prompt: 'Commit message',
    validateInput: value => value.trim() ? undefined : 'Enter a commit message.'
  });
  return message?.trim() || undefined;
}

/** Converts unknown thrown values into concise messages. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Performs no work because activation owns disposable resources. */
export function deactivate(): void {}
