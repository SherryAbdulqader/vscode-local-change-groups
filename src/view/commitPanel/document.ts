import { randomBytes } from 'node:crypto';
import { groupColorId } from '../../core/changeLabels';
import type { GroupColor } from '../../core/groups';

/**
 * The commit panel, as one page.
 *
 * Kept out of the provider so the markup, styles, and script read as a document
 * instead of being buried in class methods.
 *
 * Two rules keep it honest:
 *
 * **Nothing loads from anywhere.** CSP is `default-src 'none'` with a per-render
 * nonce for the single inline style and single inline script, and the provider
 * hands it no localResourceRoots at all. No bundler, no CDN, no asset to ship,
 * nothing to audit at 2am.
 *
 * **Every color comes from VS Code.** All `--vscode-*` custom properties,
 * including our own contributed group colors, so the panel actually tracks the
 * user's theme rather than doing a passable impression of it.
 */

/** Our group color as something CSS will accept, with a sensible fallback. */
export function panelColorVariable(color: GroupColor): string {
  const variable = `--vscode-${groupColorId(color).replace(/\./g, '-')}`;
  return `var(${variable}, var(--vscode-descriptionForeground))`;
}

/** Builds the page. New nonce every time. */
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
  <div id="note" class="empty" hidden></div>
  <div id="empty" class="empty" hidden>Create a group to commit it on its own.</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const panel = document.getElementById('panel');
  const empty = document.getElementById('empty');
  const dot = document.getElementById('dot');
  const groupSelect = document.getElementById('group');
  const note = document.getElementById('note');
  const message = document.getElementById('message');
  const commitButton = document.getElementById('commit');
  const stageButton = document.getElementById('stage');
  const unstageButton = document.getElementById('unstage');
  const pushButton = document.getElementById('push');

  let branch = '';

  // Drafts live here rather than in the extension host because VS Code destroys
  // this page whenever the section is collapsed. The alternative,
  // retainContextWhenHidden, keeps an entire invisible webview in memory for the
  // sake of remembering a string, which seems a poor trade.
  const drafts = Object.assign({}, (vscode.getState() || {}).drafts);

  /** Remember what was typed, per group, so collapsing the panel is not costly. */
  function persist() {
    vscode.setState({ drafts: drafts, selected: groupSelect.value });
  }

  /** Redraws everything that depends on which group is selected. */
  function applySelection() {
    const option = groupSelect.selectedOptions[0];
    if (!option) return;
    dot.style.background = option.dataset.color || 'var(--vscode-descriptionForeground)';
    const count = Number(option.dataset.count || '0');
    message.placeholder = branch
      ? 'Message (Ctrl+Enter to commit on "' + branch + '")'
      : 'Message (Ctrl+Enter to commit)';
    commitButton.textContent = '\\u2713 Commit ' + count + (count === 1 ? ' file' : ' files');
    const guarded = option.dataset.protected === 'true';
    // Unstage stays available even when protected: it is the way to put a
    // mistake right, not a way to make one.
    const enabled = count > 0 && !guarded;
    commitButton.disabled = !enabled;
    stageButton.disabled = !enabled;
    unstageButton.disabled = !enabled;
    pushButton.disabled = !enabled;
    unstageButton.disabled = count === 0;
    note.hidden = !guarded;
    note.textContent = guarded
      ? 'Protected. It will not be staged, committed, or pushed.'
      : '';
    message.value = drafts[groupSelect.value] || '';
  }

  /** Fires a request at the host, which will check it properly. */
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
      option.textContent = group.name + ' (' + group.count + ')' + (group.protected ? ' — protected' : '');
      option.dataset.color = group.color;
      option.dataset.count = String(group.count);
      option.dataset.protected = group.protected ? 'true' : 'false';
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
