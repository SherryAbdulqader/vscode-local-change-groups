import * as vscode from 'vscode';

/**
 * Our own typing of the bits of VS Code's built-in Git extension we use.
 *
 * The Git extension ships a full .d.ts, but taking a hard dependency on it drags
 * a lot of surface we never touch into the build. This is the subset we actually
 * call, written down so a change in their API shows up here as a type error
 * rather than as a runtime surprise in front of a user.
 *
 * The three verbs that matter, since the names are not obvious:
 *   add    -> stage
 *   revert -> unstage  (git reset)
 *   clean  -> discard  (and delete, if untracked)
 */

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
  /** Throws away working-tree changes. Untracked files are deleted outright. */
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

/**
 * Wakes up the built-in Git extension and borrows its API.
 *
 * Returns undefined rather than throwing when it is missing, so the rest of the
 * extension can degrade to a read-only view instead of failing to activate.
 */
export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1);
}
