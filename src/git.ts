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
    untrackedChanges?: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
    rebaseCommit?: unknown;
    HEAD?: {
      name?: string;
      commit?: string;
      ahead?: number;
      behind?: number;
      upstream?: { remote: string; name: string };
    };
    onDidChange: vscode.Event<void>;
  };
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  /** Discards working-tree changes, deleting untracked files outright. */
  clean(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: number): Promise<void>;
  status(): Promise<void>;
}

export interface GitApi {
  git: { path: string };
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
