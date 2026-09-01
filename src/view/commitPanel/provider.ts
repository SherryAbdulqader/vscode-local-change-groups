import * as vscode from 'vscode';
import { commitPanelHtml, panelColorVariable } from './document';
import { PanelRunner, PanelState, parseRequest } from './protocol';

/**
 * Hosts the commit panel and keeps it pointed at the right group.
 *
 * A TreeView flatly cannot contain a text input, so the commit box is a small
 * webview sitting above the tree in the same container. This class is only
 * plumbing: state down, validated requests up, and the actual Git work handed
 * off to the runner it was built with. It has never heard of Git.
 */
export class CommitPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'localChangeGroups.commitPanel';

  private view: vscode.WebviewView | undefined;
  private selectedGroupId: string | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  /** Takes a way to read current state and a way to act on it. */
  public constructor(
    private readonly readState: () => Omit<PanelState, 'selectedGroupId'>,
    private readonly run: PanelRunner
  ) {
    if (typeof readState !== 'function' || typeof run !== 'function') {
      throw new Error('A state reader and an action runner are required.');
    }
  }

  /** Unhooks the message listener. */
  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Called the first time the section becomes visible. */
  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // Empty localResourceRoots. The page is entirely self-contained, so it gets
    // no read access to the extension folder or the workspace whatsoever.
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = commitPanelHtml();
    this.subscriptions.push(
      view.webview.onDidReceiveMessage(async (incoming: unknown) => {
        const request = parseRequest(incoming);
        if (!request) {
          return;
        }
        if (request.type === 'ready') {
          this.publish();
          return;
        }
        await this.run(request.action, request.groupId, request.message);
      })
    );
    view.onDidDispose(() => { this.view = undefined; }, undefined, this.subscriptions);
    this.publish();
  }

  /** Follows the tree selection, so clicking a group aims the panel at it. */
  public setSelectedGroup(groupId: string | undefined): void {
    if (this.selectedGroupId === groupId) {
      return;
    }
    this.selectedGroupId = groupId;
    this.publish();
  }

  /** Push fresh state at the page. */
  public refresh(): void {
    this.publish();
  }

  /**
   * Sends groups, counts, and the branch name down to the page.
   *
   * The remembered selection gets checked against live groups first — delete the
   * group a hidden panel was pointing at and it would otherwise come back aimed
   * at a ghost. Palette keys are turned into real CSS here too, since the page
   * has no way to resolve one of our contributed theme color ids by itself.
   */
  private publish(): void {
    if (!this.view) {
      return;
    }
    const state = this.readState();
    const selectedGroupId = state.groups.some(group => group.id === this.selectedGroupId)
      ? this.selectedGroupId
      : state.groups[0]?.id;
    void this.view.webview.postMessage({
      type: 'state',
      branch: state.branch,
      selectedGroupId,
      groups: state.groups.map(group => ({ ...group, color: panelColorVariable(group.color) }))
    });
  }
}
