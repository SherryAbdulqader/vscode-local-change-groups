import * as vscode from 'vscode';
import {
  DEFAULT_GROUP_ICON,
  GROUP_COLORS,
  GROUP_ICONS,
  GroupColor,
  LocalGroup,
  normalizeGroupIcon
} from '../core/groups';
import { errorMessage } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { GitApi } from '../git/api';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { DisplayChange, GroupNode } from '../view/nodes';

/**
 * Every quick pick and input box in the extension, in one place.
 *
 * Two reasons: the command modules stay readable as flow rather than as walls of
 * prompt construction, and the wording stays consistent when it is all sitting
 * next to itself.
 *
 * They all return undefined when dismissed. Pressing Escape is not an error, and
 * callers should quietly do nothing rather than complain about it.
 */

/** Pick a group. Nudges you to make one first if there are none. */
export async function pickGroup(store: GroupStore, placeHolder: string): Promise<LocalGroup | undefined> {
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

/** Pick some files, from anywhere across the open repositories. */
export async function pickChanges(provider: ChangeGroupsTreeProvider, placeHolder: string): Promise<DisplayChange[]> {
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

/** Ask for a group name. */
export async function promptGroupName(title: string, prompt: string, value?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    prompt,
    value,
    validateInput: input => input.trim() ? undefined : 'Enter a group name.'
  });
}

/** Pick one of the eight colors. */
export async function pickColor(current?: GroupColor): Promise<GroupColor | undefined> {
  const selection = await vscode.window.showQuickPick(
    GROUP_COLORS.map(color => ({
      label: color[0].toUpperCase() + color.slice(1),
      description: color === current ? 'Current' : undefined,
      color
    })),
    { placeHolder: 'Choose a group color' }
  );
  return selection?.color;
}

/**
 * Pick an icon.
 *
 * Quick pick labels render `$(id)` as the icon itself, so every row previews
 * what you are about to choose. The last row lets you type any codicon id, for
 * when none of the sixteen is quite right.
 */
export async function pickIcon(current?: string): Promise<string | undefined> {
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
    // Live validation, mostly to catch someone typing "$(beaker)" — an easy
    // mistake, and one that otherwise stores fine and then renders as nothing.
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

/** Ask for a commit message. Refuses to accept an empty one. */
export async function promptCommitMessage(group: LocalGroup): Promise<string | undefined> {
  const message = await vscode.window.showInputBox({
    title: `Commit Group: ${group.name}`,
    prompt: 'Commit message',
    validateInput: value => value.trim() ? undefined : 'Enter a commit message.'
  });
  return message?.trim() || undefined;
}

/**
 * Works out which group, in which repository, a command should act on.
 *
 * From a group row this is obvious. From the Command Palette it is not, so with
 * several repositories open we ask the user to go via a row rather than guessing
 * and doing Git things to the wrong project.
 */
export async function requireGroupNode(
  node: GroupNode | undefined,
  store: GroupStore,
  gitApi: GitApi | undefined,
  prompt: string
): Promise<GroupNode | undefined> {
  if (node?.group) return node;
  const group = await pickGroup(store, prompt);
  if (!group) return undefined;
  const repositories = gitApi?.repositories ?? [];
  if (repositories.length !== 1) throw new Error('Run this command from a group row when multiple repositories are open.');
  return new GroupNode(repositories[0], group);
}

/** Same idea, but starting from an id the commit panel sent us. */
export function groupNodeById(groupId: string, store: GroupStore, gitApi: GitApi | undefined): GroupNode {
  const group = store.getGroups().find(candidate => candidate.id === groupId);
  if (!group) throw new Error('Group not found.');
  const repositories = gitApi?.repositories ?? [];
  if (repositories.length !== 1) {
    throw new Error('Run this action from a group row when multiple repositories are open.');
  }
  return new GroupNode(repositories[0], group);
}
