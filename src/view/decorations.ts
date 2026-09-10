import * as vscode from 'vscode';
import { GroupColor, isGroupColor } from '../core/groups';
import { CHANGE_SCHEME, groupColorId, statusBadge, statusColorId, statusLabel } from '../core/changeLabels';

export { CHANGE_SCHEME } from '../core/changeLabels';

const STATUS_QUERY_KEY = 's';
const COLOR_QUERY_KEY = 'c';
const ALARM_QUERY_KEY = 'alarm';

/**
 * Builds the fake URI a row wears so it can get a badge.
 *
 * The status rides along in the query string, which means a decoration is a pure
 * function of the URI and never needs invalidating when Git moves on.
 */
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

/**
 * The URI a protected group row wears when its files have reached the index.
 *
 * Protection stops this extension's own commands, but nothing stops "git add"
 * in a terminal. When that happens the row has to be impossible to miss, and a
 * decoration is the only way to get red text onto a tree row.
 *
 * The group id is in the path only to keep each row's URI distinct. Nothing
 * reads it back.
 */
export function protectedAlarmUri(groupId: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: CHANGE_SCHEME,
    path: `/group/${encodeURIComponent(groupId)}`,
    query: new URLSearchParams({ [ALARM_QUERY_KEY]: '1' }).toString()
  });
}

/**
 * Paints the M / A / D / U badges on the right of each row.
 *
 * Decoration providers are global, so decorating real file URIs would put our
 * badges in the Explorer too, arguing with Git's. Hence the private scheme in
 * changeLabels.ts: same visual result, confined to our tree. The file icon still
 * resolves correctly because icon themes match on the path, not the scheme.
 */
export class ChangeDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];
  public readonly onDidChangeFileDecorations = this.changedEmitter.event;

  /** Watches the one setting that changes how rows are colored. */
  public constructor() {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('localChangeGroups.fileColors')) {
          this.changedEmitter.fire(undefined);
        }
      })
    );
  }

  /** Lets go of the event and the settings listener. */
  public dispose(): void {
    this.changedEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Asks VS Code to repaint every row. */
  public refresh(): void {
    this.changedEmitter.fire(undefined);
  }

  /** Ignores anything that is not one of our rows. */
  public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== CHANGE_SCHEME) {
      return undefined;
    }
    const query = new URLSearchParams(uri.query);
    if (query.get(ALARM_QUERY_KEY)) {
      const alarm = new vscode.FileDecoration(
        '!',
        'Protected, but staged. An ordinary commit would include it.',
        new vscode.ThemeColor('errorForeground')
      );
      alarm.propagate = false;
      return alarm;
    }
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

  /** Git's colors by default; the group's color if the user asked for that. */
  private foreground(status: number, groupColor: string | null): vscode.ThemeColor {
    const preference = vscode.workspace.getConfiguration('localChangeGroups').get<string>('fileColors', 'status');
    return preference === 'group' && isGroupColor(groupColor)
      ? new vscode.ThemeColor(groupColorId(groupColor))
      : new vscode.ThemeColor(statusColorId(status));
  }
}
