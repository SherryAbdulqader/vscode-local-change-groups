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
 * Every quick pick and input box the extension shows.
 *
 * Collected here so the command modules read as flow rather than as prompt
 * construction, and so wording stays consistent. Each returns `undefined` when
 * the user dismisses the prompt; callers treat that as "do nothing", never as an
 * error.
 */

/** Prompts for one configured local group. */
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

/** Prompts for one or more changed files across all open repositories. */
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

/** Prompts for a group name, returning undefined when dismissed. */
export async function promptGroupName(title: string, prompt: string, value?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    prompt,
    value,
    validateInput: input => input.trim() ? undefined : 'Enter a group name.'
  });
}

/** Prompts for a predefined theme-aware group color. */
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
 * Prompts for a group codicon. Each row previews the icon itself through the
 * `$(id)` label syntax, and the last row accepts any codicon id by hand.
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
    // Validating live catches the likely mistake — typing "$(beaker)" — before
    // it can be stored as an id that would silently render as nothing.
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

/** Prompts for a non-empty commit message tied to a selected group. */
export async function promptCommitMessage(group: LocalGroup): Promise<string | undefined> {
  const message = await vscode.window.showInputBox({
    title: `Commit Group: ${group.name}`,
    prompt: 'Commit message',
    validateInput: value => value.trim() ? undefined : 'Enter a commit message.'
  });
  return message?.trim() || undefined;
}

/**
 * Resolves an explicit or picked named group to exactly one repository.
 *
 * Invoked from a group row the repository is unambiguous. Invoked from the
 * Command Palette it is not, so with several repositories open this refuses
 * rather than guessing which one the user meant.
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

/** Resolves a stored group id to exactly one repository's group row. */
export function groupNodeById(groupId: string, store: GroupStore, gitApi: GitApi | undefined): GroupNode {
  const group = store.getGroups().find(candidate => candidate.id === groupId);
  if (!group) throw new Error('Group not found.');
  const repositories = gitApi?.repositories ?? [];
  if (repositories.length !== 1) {
    throw new Error('Run this action from a group row when multiple repositories are open.');
  }
  return new GroupNode(repositories[0], group);
}
