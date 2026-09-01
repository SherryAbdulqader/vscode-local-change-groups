import * as vscode from 'vscode';
import { GroupColor, isGroupColor } from '../core/groups';
import { CHANGE_SCHEME, groupColorId, statusBadge, statusColorId, statusLabel } from '../core/changeLabels';

export { CHANGE_SCHEME } from '../core/changeLabels';

const STATUS_QUERY_KEY = 's';
const COLOR_QUERY_KEY = 'c';

/** Builds the decoration-carrying URI for one changed file row. */
export function changeDecorationUri(fileUri: vscode.Uri, status: number, groupColor?: GroupColor): vscode.Uri {
  if (!Number.isInteger(status)) {
    throw new Error('A numeric Git status is required.');
  }
  const query = new URLSearchParams({ [STATUS_QUERY_KEY]: String(status) });
  if (groupColor) {
    query.set(COLOR_QUERY_KEY, groupColor);
  }
  return vscode.Uri.from({ scheme: CHANGE_SCHEME, path: fileUri.path, query: query.toString() });
}

/** Paints Source Control style status badges on grouped change rows. */
export class ChangeDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];
  public readonly onDidChangeFileDecorations = this.changedEmitter.event;

  /** Repaints every row when the color source preference changes. */
  public constructor() {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('localChangeGroups.fileColors')) {
          this.changedEmitter.fire(undefined);
        }
      })
    );
  }

  /** Releases the decoration event and configuration listener. */
  public dispose(): void {
    this.changedEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Requests a repaint of every decorated row. */
  public refresh(): void {
    this.changedEmitter.fire(undefined);
  }

  /** Decorates only this extension's own rows. */
  public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== CHANGE_SCHEME) {
      return undefined;
    }
    const query = new URLSearchParams(uri.query);
    const status = Number(query.get(STATUS_QUERY_KEY));
    if (!Number.isInteger(status)) {
      return undefined;
    }
    const decoration = new vscode.FileDecoration(
      statusBadge(status),
      statusLabel(status),
      this.foreground(status, query.get(COLOR_QUERY_KEY))
    );
    decoration.propagate = false;
    return decoration;
  }

  /** Chooses between Git status colors and the owning group's color. */
  private foreground(status: number, groupColor: string | null): vscode.ThemeColor {
    const preference = vscode.workspace.getConfiguration('localChangeGroups').get<string>('fileColors', 'status');
    return preference === 'group' && isGroupColor(groupColor)
      ? new vscode.ThemeColor(groupColorId(groupColor))
      : new vscode.ThemeColor(statusColorId(status));
  }
}
