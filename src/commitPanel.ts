import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { LocalGroup } from './model';
import { groupColorId } from './presentation';

/** The Git action a panel button asks for. */
export type PanelAction = 'stage' | 'commit' | 'push';

/** One group as presented by the commit panel. */
export interface PanelGroup {
  id: string;
  name: string;
  color: LocalGroup['color'];
  count: number;
}

/** State the panel needs to render itself. */
export interface PanelState {
  groups: PanelGroup[];
  selectedGroupId?: string;
  branch?: string;
}

/** Runs one panel action, reporting failures to the caller's handler. */
export type PanelRunner = (action: PanelAction, groupId: string, message: string) => Promise<void>;

/** Renders a Source Control style commit box above the change tree. */
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
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = this.html(view.webview);
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

  /** Sends the current groups, counts, and branch to the webview. */
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

  /** Returns the panel document, locked down to its own inline script. */
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
  }
  .picker { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--vscode-descriptionForeground); }
  select {
    flex: 1 1 auto;
    min-width: 0;
    padding: 2px 4px;
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border, transparent);
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
  }
  textarea {
    width: 100%;
    min-height: 52px;
    resize: vertical;
    padding: 4px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
  }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  select:focus, textarea:focus, button:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  button {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 4px 8px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
  }
  button:hover:enabled { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.4; cursor: default; }
  .row { display: flex; gap: 6px; }
  .row button {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  .row button:hover:enabled { background: var(--vscode-button-secondaryHoverBackground); }
  .empty { color: var(--vscode-descriptionForeground); padding: 4px 0; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <div id="panel" hidden>
    <div class="picker">
      <span class="dot" id="dot"></span>
      <select id="group" aria-label="Group to commit"></select>
    </div>
    <textarea id="message" aria-label="Commit message"></textarea>
    <button id="commit">&#10003; Commit Group</button>
    <div class="row">
      <button id="stage">Stage</button>
      <button id="push">Commit &amp; Push</button>
    </div>
  </div>
  <div id="empty" class="empty" hidden>Create a group to commit it on its own.</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const panel = document.getElementById('panel');
  const empty = document.getElementById('empty');
  const dot = document.getElementById('dot');
  const groupSelect = document.getElementById('group');
  const message = document.getElementById('message');
  const commitButton = document.getElementById('commit');
  const stageButton = document.getElementById('stage');
  const pushButton = document.getElementById('push');

  let branch = '';
  const drafts = Object.assign({}, (vscode.getState() || {}).drafts);

  /** Keeps typed messages per group across visibility changes. */
  function persist() {
    vscode.setState({ drafts: drafts, selected: groupSelect.value });
  }

  /** Reflects the selected group's color, count, and saved draft. */
  function applySelection() {
    const option = groupSelect.selectedOptions[0];
    if (!option) return;
    dot.style.background = option.dataset.color || 'var(--vscode-descriptionForeground)';
    const count = Number(option.dataset.count || '0');
    message.placeholder = branch
      ? 'Message (Ctrl+Enter to commit on "' + branch + '")'
      : 'Message (Ctrl+Enter to commit)';
    commitButton.textContent = '\\u2713 Commit ' + count + (count === 1 ? ' file' : ' files');
    const enabled = count > 0;
    commitButton.disabled = !enabled;
    stageButton.disabled = !enabled;
    pushButton.disabled = !enabled;
    message.value = drafts[groupSelect.value] || '';
  }

  /** Sends one action, letting the extension host validate it. */
  function submit(action) {
    const groupId = groupSelect.value;
    if (!groupId) return;
    vscode.postMessage({ type: 'run', action: action, groupId: groupId, message: message.value });
  }

  groupSelect.addEventListener('change', function () { applySelection(); persist(); });
  message.addEventListener('input', function () { drafts[groupSelect.value] = message.value; persist(); });
  message.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !commitButton.disabled) {
      event.preventDefault();
      submit('commit');
    }
  });
  commitButton.addEventListener('click', function () { submit('commit'); });
  stageButton.addEventListener('click', function () { submit('stage'); });
  pushButton.addEventListener('click', function () { submit('push'); });

  window.addEventListener('message', function (event) {
    const state = event.data;
    if (!state || state.type !== 'state') return;
    branch = state.branch || '';
    const groups = state.groups || [];
    panel.hidden = groups.length === 0;
    empty.hidden = groups.length !== 0;
    groupSelect.textContent = '';
    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name + ' (' + group.count + ')';
      option.dataset.color = group.color;
      option.dataset.count = String(group.count);
      groupSelect.appendChild(option);
    }
    if (state.selectedGroupId) groupSelect.value = state.selectedGroupId;
    applySelection();
  });

  vscode.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;
  }
}

/** Returns the CSS color expression for a group's contributed theme color. */
export function panelColorVariable(color: LocalGroup['color']): string {
  const variable = `--vscode-${groupColorId(color).replace(/\./g, '-')}`;
  return `var(${variable}, var(--vscode-descriptionForeground))`;
}

type PanelRequest =
  | { type: 'ready' }
  | { type: 'run'; action: PanelAction; groupId: string; message: string };

/** Validates a message posted by the panel before acting on it. */
function parseRequest(value: unknown): PanelRequest | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'ready') {
    return { type: 'ready' };
  }
  if (candidate.type !== 'run') {
    return undefined;
  }
  const action = candidate.action;
  if (action !== 'stage' && action !== 'commit' && action !== 'push') {
    return undefined;
  }
  if (typeof candidate.groupId !== 'string' || !candidate.groupId.trim()) {
    return undefined;
  }
  return {
    type: 'run',
    action,
    groupId: candidate.groupId,
    message: typeof candidate.message === 'string' ? candidate.message : ''
  };
}
