import * as vscode from 'vscode';
import { errorMessage } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { GitApi } from '../git/api';
import { ActionContext } from '../services/changeActions';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { TreeNode } from '../view/nodes';

/**
 * The handful of long-lived things every command needs, bundled up so each
 * registration takes one argument instead of five.
 */
export interface CommandContext {
  store: GroupStore;
  provider: ChangeGroupsTreeProvider;
  view: vscode.TreeView<TreeNode>;
  gitApi: GitApi | undefined;
  output: vscode.OutputChannel;
}

/**
 * Narrows the context down to what a Git action needs, and complains properly if
 * the Git extension is not there. Beats scattering `gitApi!` around and hoping.
 */
export function actionContext(context: CommandContext): ActionContext {
  if (!context.gitApi) {
    throw new Error('The built-in Git extension is unavailable.');
  }
  return { provider: context.provider, output: context.output, gitPath: context.gitApi.git.path };
}

/**
 * Runs a command body and makes sure any failure is actually seen.
 *
 * VS Code invokes command callbacks and then ignores whatever they return. Reject
 * a promise in there and it nods politely and drops it on the floor, leaving the
 * user staring at a button that did nothing. So everything gets wrapped: log it,
 * show it, move on.
 */
export async function runCommand(output: vscode.OutputChannel, action: () => Promise<void>): Promise<void> {
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
