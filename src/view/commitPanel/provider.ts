import * as vscode from 'vscode';
import { commitPanelHtml, panelColorVariable } from './document';
import { PanelRunner, PanelState, parseRequest } from './protocol';

/**
 * Hosts the commit panel and keeps it in step with the tree.
 *
 * A TreeView cannot contain a text input, so the Source Control style commit box
 * is a small webview sharing the container above the tree. This class owns only
 * the plumbing: it publishes state down, validates requests coming back up, and
 * delegates the actual Git work to the runner it was constructed with.
 */
export class CommitPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'localChangeGroups.commitPanel';

  private view: vscode.WebviewView | undefined;
  private selectedGroupId: string | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  /** Wires the panel to the state it renders and the actions it runs. */
  public constructor(
    private readonly readState: () => Omit<PanelState, 'selectedGroupId'>,
    private readonly run: PanelRunner
  ) {
    if (typeof readState !== 'function' || typeof run !== 'function') {
      throw new Error('A state reader and an action runner are required.');
    }
  }

  /** Releases the webview message subscription. */
  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Builds the panel the first time its section becomes visible. */
  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // No local resource roots: the document is fully self-contained, so the
    // webview is given no read access to the extension or workspace at all.
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

  /** Targets a group chosen elsewhere, such as by selecting a tree row. */
  public setSelectedGroup(groupId: string | undefined): void {
    if (this.selectedGroupId === groupId) {
      return;
    }
    this.selectedGroupId = groupId;
    this.publish();
  }

  /** Repaints the panel from current group state. */
  public refresh(): void {
    this.publish();
  }

  /**
   * Sends the current groups, counts, and branch to the webview.
   *
   * The remembered selection is re-checked against live groups so a deleted
   * group cannot leave the panel pointing at something that no longer exists.
   * Palette keys become concrete CSS expressions here, since the page has no way
   * to resolve a contributed theme color id on its own.
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
