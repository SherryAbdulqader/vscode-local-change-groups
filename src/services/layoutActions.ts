import * as vscode from 'vscode';
import { buildLayout, Layout, layoutGroupNames, readLayout } from '../core/layout';
import { DEFAULT_GROUP_COLOR, LocalGroup } from '../core/groups';
import { assignmentKey, relativePathFromKey } from '../core/repositoryPaths';
import { describeFileCount } from '../core/text';
import { AssignmentTarget, GroupStore } from '../data/groupStore';
import { GitRepository } from '../git/api';
import { ChangeGroupsTreeProvider } from '../view/changeTree';

/**
 * Writing a group layout to a file, and reading one back.
 *
 * Grouping lives in workspace storage, which is private to your machine. That is
 * the right default — nobody wants their half-finished organising in the repo —
 * but it also means a layout worth sharing has nowhere to go. These two commands
 * are the way out and the way back in.
 *
 * The file is meant to be committed if you want it to be. It is small, readable
 * JSON, and it contains paths and group names, nothing else.
 */

/** What these need from the host. */
export interface LayoutContext {
  store: GroupStore;
  provider: ChangeGroupsTreeProvider;
  output: vscode.OutputChannel;
}

/** The name offered in the save dialog, and the one Import looks for first. */
export const LAYOUT_FILE_NAME = 'change-groups.json';

/** Asks where to put the layout, then writes it. */
export async function exportLayout(context: LayoutContext, repository: GitRepository): Promise<void> {
  const root = repository.rootUri.fsPath;
  const groups = context.store.getGroups();
  const files = assignmentsIn(context.store, root);

  if (groups.length === 0) {
    throw new Error('There are no groups to export yet.');
  }

  const target = await vscode.window.showSaveDialog({
    title: 'Export Group Layout',
    defaultUri: vscode.Uri.joinPath(repository.rootUri, LAYOUT_FILE_NAME),
    filters: { JSON: ['json'] }
  });
  if (!target) return;

  const layout = buildLayout(groups, files);
  // Trailing newline and two-space indent: this is a file people will read in a
  // pull request, not a blob.
  const text = `${JSON.stringify(layout, undefined, 2)}\n`;
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));

  context.output.appendLine(`Exported ${groups.length} group${groups.length === 1 ? '' : 's'} and ${describeFileCount(files.size)} to ${target.fsPath}`);
  void vscode.window.showInformationMessage(
    `Exported ${groups.length} group${groups.length === 1 ? '' : 's'} and ${describeFileCount(files.size)}.`
  );
}

/** Asks for a layout file, confirms what it would do, then applies it. */
export async function importLayout(context: LayoutContext, repository: GitRepository): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Import Group Layout',
    defaultUri: vscode.Uri.joinPath(repository.rootUri, LAYOUT_FILE_NAME),
    filters: { JSON: ['json'] },
    canSelectMany: false
  });
  if (!picked?.length) return;

  const layout = readLayout(await parseJson(picked[0]));
  const fileCount = Object.keys(layout.files).length;

  const confirmation = await vscode.window.showWarningMessage(
    'Import this group layout?',
    {
      modal: true,
      detail: [
        `${layout.groups.length} group${layout.groups.length === 1 ? '' : 's'} and ${describeFileCount(fileCount)}.`,
        'Groups you already have are reused by name, and files listed here move into the group the file names.',
        'Anything not listed keeps the group it is in now. No files on disk are touched.'
      ].join('\n')
    },
    'Import'
  );
  if (confirmation !== 'Import') return;

  const groupsByName = await ensureGroups(context.store, layout);
  const filed = await applyFiles(context.store, repository, layout, groupsByName);

  context.provider.refresh();
  context.output.appendLine(`Imported ${groupsByName.size} group${groupsByName.size === 1 ? '' : 's'} and filed ${describeFileCount(filed)}`);
  void vscode.window.showInformationMessage(`Imported the layout: ${describeFileCount(filed)} filed.`);
}

/** Every assignment belonging to this repository, as relative path to group id. */
function assignmentsIn(store: GroupStore, repositoryRoot: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const [key, groupId] of Object.entries(store.getAssignments())) {
    const relativePath = relativePathFromKey(key, repositoryRoot);
    if (relativePath) {
      files.set(relativePath, groupId);
    }
  }
  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Makes sure every group the layout mentions exists, and hands back a lookup.
 *
 * Matching is by name, ignoring case, because that is the only handle the file
 * has. A group you already have keeps its own color and icon — the import is
 * about which files go where, and silently repainting your groups would be a
 * rude way to find that out.
 */
async function ensureGroups(store: GroupStore, layout: Layout): Promise<Map<string, LocalGroup>> {
  const wanted = layoutGroupNames(layout);
  const byName = new Map<string, LocalGroup>();

  for (const name of wanted) {
    const existing = store.getGroups().find(group => group.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      byName.set(name.toLowerCase(), existing);
      continue;
    }
    const described = layout.groups.find(group => group.name.toLowerCase() === name.toLowerCase());
    const created = await store.createGroup(name, described?.color ?? DEFAULT_GROUP_COLOR);
    if (described?.icon) {
      await store.setGroupIcon(created.id, described.icon);
    }
    byName.set(name.toLowerCase(), created);
  }
  return byName;
}

/** Files the layout's paths, one write per group. */
async function applyFiles(
  store: GroupStore,
  repository: GitRepository,
  layout: Layout,
  groupsByName: Map<string, LocalGroup>
): Promise<number> {
  const batches = new Map<string, AssignmentTarget[]>();
  for (const [relativePath, groupName] of Object.entries(layout.files)) {
    const group = groupsByName.get(groupName.toLowerCase());
    if (!group) continue;
    const key = assignmentKey(repository.rootUri.fsPath, relativePath);
    const batch = batches.get(group.id);
    // No aliases: a path out of a file has no rename history for us to clear.
    const target: AssignmentTarget = { fileKey: key, assignmentKeys: [key] };
    if (batch) {
      batch.push(target);
    } else {
      batches.set(group.id, [target]);
    }
  }

  let filed = 0;
  for (const [groupId, targets] of batches) {
    if (store.getFrozen(groupId)) {
      // A frozen group will not take files. Skip rather than abandon the import.
      continue;
    }
    await store.moveAssignments(targets, groupId);
    filed += targets.length;
  }
  return filed;
}

/** Reads a file as JSON, with a message that says which file went wrong. */
async function parseJson(uri: vscode.Uri): Promise<unknown> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error(`${uri.fsPath} is not valid JSON.`);
  }
}
