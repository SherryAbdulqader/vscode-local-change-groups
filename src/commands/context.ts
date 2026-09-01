import * as vscode from 'vscode';
import { errorMessage } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { GitApi } from '../git/api';
import { ActionContext } from '../services/changeActions';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { TreeNode } from '../view/nodes';

/**
 * The handful of long-lived objects every command needs, passed as one value
 * instead of five parameters threaded through each registration.
 */
export interface CommandContext {
  store: GroupStore;
  provider: ChangeGroupsTreeProvider;
  view: vscode.TreeView<TreeNode>;
  gitApi: GitApi | undefined;
  output: vscode.OutputChannel;
}

/**
 * Narrows the context to what a Git action needs, failing loudly if the Git
 * extension is unavailable. Commands that touch Git call this instead of
 * asserting on `gitApi` themselves.
 */
export function actionContext(context: CommandContext): ActionContext {
  if (!context.gitApi) {
    throw new Error('The built-in Git extension is unavailable.');
  }
  return { provider: context.provider, output: context.output, gitPath: context.gitApi.git.path };
}

/**
 * Performs a command with consistent user-visible error handling.
 *
 * Command callbacks are invoked by VS Code, which discards rejections silently,
 * so every registration is wrapped here to guarantee a failure is both logged
 * and shown.
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
