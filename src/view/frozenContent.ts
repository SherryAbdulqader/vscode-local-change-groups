import * as vscode from 'vscode';
import { SnapshotFiles } from '../data/snapshotFiles';

/** Scheme for the read-only documents a frozen diff is built from. */
export const FROZEN_SCHEME = 'local-change-groups-frozen';

/**
 * Serves frozen file contents to the diff editor.
 *
 * VS Code will happily diff any two URIs as long as something can produce text
 * for them, which is all this does. The blob hash rides in the query string, so
 * a frozen document is a pure function of its URI — no lookup table to keep in
 * sync, and an old diff tab left open keeps showing exactly what it always did.
 *
 * The path segment is cosmetic but load-bearing in one way: VS Code names the
 * tab and picks syntax highlighting from it, so a frozen TypeScript file still
 * arrives coloured.
 */
export class FrozenContentProvider implements vscode.TextDocumentContentProvider {
  public constructor(private readonly snapshots: SnapshotFiles) {
    if (!snapshots) {
      throw new Error('A snapshot store is required.');
    }
  }

  /** Returns the blob named in the URI, or empty text when it is missing. */
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const hash = new URLSearchParams(uri.query).get('h');
    if (!hash) {
      return '';
    }
    // A missing blob renders as an empty side rather than an error, which is
    // also exactly what we want for the base side of a newly added file.
    return await this.snapshots.read(hash) ?? '';
  }
}

/**
 * Builds the URI for one side of a frozen diff.
 *
 * An absent hash still produces a valid URI, which is how an added file gets an
 * empty left-hand side for free.
 */
export function frozenUri(relativePath: string, hash: string | undefined, side: 'base' | 'frozen'): vscode.Uri {
  const query = new URLSearchParams({ side });
  if (hash) {
    query.set('h', hash);
  }
  return vscode.Uri.from({
    scheme: FROZEN_SCHEME,
    path: `/${relativePath.replace(/^\/+/, '')}`,
    query: query.toString()
  });
}
