import { randomBytes } from 'node:crypto';
import { groupColorId } from '../../core/changeLabels';
import type { GroupColor } from '../../core/groups';

/**
 * The commit panel's HTML document.
 *
 * Isolated from the provider so the markup, styles, and page script can be read
 * as one page rather than buried in class methods.
 *
 * Two rules hold this together:
 *
 * - **Nothing loads from outside.** The CSP is `default-src 'none'` with a
 *   per-render nonce for the one inline style and one inline script, and the
 *   provider declares no `localResourceRoots`. There is no bundler step and no
 *   asset to ship.
 * - **Every color comes from VS Code.** Styling uses `--vscode-*` custom
 *   properties, including the extension's own contributed group colors, so the
 *   panel tracks the active theme exactly instead of approximating it.
 */

/** Returns the CSS color expression for a group's contributed theme color. */
export function panelColorVariable(color: GroupColor): string {
  const variable = `--vscode-${groupColorId(color).replace(/\./g, '-')}`;
  return `var(${variable}, var(--vscode-descriptionForeground))`;
}

/** Builds the panel document with a fresh script nonce. */
export function commitPanelHtml(): string {
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
  .row button, .secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  .row button:hover:enabled, .secondary:hover:enabled { background: var(--vscode-button-secondaryHoverBackground); }
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
      <button id="unstage">Unstage</button>
    </div>
    <button id="push" class="secondary">Commit &amp; Push</button>
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
  const unstageButton = document.getElementById('unstage');
  const pushButton = document.getElementById('push');

  let branch = '';

  // Drafts live in webview state rather than the host: VS Code tears the page
  // down whenever the section is hidden, and retainContextWhenHidden would keep
  // a whole hidden webview alive just to hold a string.
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
    unstageButton.disabled = !enabled;
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
  unstageButton.addEventListener('click', function () { submit('unstage'); });
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
