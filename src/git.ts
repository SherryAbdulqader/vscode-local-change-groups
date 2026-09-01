import * as vscode from 'vscode';

export interface GitChange {
  uri: vscode.Uri;
  status: number;
  originalUri?: vscode.Uri;
  renameUri?: vscode.Uri;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
    onDidChange: vscode.Event<void>;
  };
}

export interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/** Activates VS Code's built-in Git extension and returns its public API. */
export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1);
}
