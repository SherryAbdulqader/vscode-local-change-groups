import * as vscode from 'vscode';
import { AutoAssignRule, matchAutoAssignRule, readAutoAssignRules } from '../core/autoAssign';
import { assignedGroupId } from '../core/changes';
import { GROUP_COLORS, GroupColor, LocalGroup } from '../core/groups';
import { describeFileCount, errorMessage } from '../core/text';
import { GroupStore } from '../data/groupStore';
import { ChangeGroupsTreeProvider } from '../view/changeTree';
import { DisplayChange } from '../view/nodes';

/**
 * Running the auto-assign rules.
 *
 * The rules themselves live in core and know nothing about VS Code. This is the
 * part that reads your settings, works out which files nobody has claimed, and
 * files them.
 */

/** What a pass needs: somewhere to read, somewhere to write, somewhere to say so. */
export interface AutoAssignContext {
  store: GroupStore;
  provider: ChangeGroupsTreeProvider;
  output: vscode.OutputChannel;
}

/** The rules as they stand in settings right now. */
export function currentAutoAssignRules(): AutoAssignRule[] {
  return readAutoAssignRules(vscode.workspace.getConfiguration('localChangeGroups').get('autoAssign'));
}

/**
 * Files everything the rules can claim, and says how many that was.
 *
 * `force` is for the command that asks for this on purpose. Normally a file that
 * has already been auto-filed once is left alone forever, so that taking it back
 * out of the group sticks; running the command says "no, do it again".
 */
export async function applyAutoAssign(
  context: AutoAssignContext,
  options: { force?: boolean } = {}
): Promise<number> {
  const changes = context.provider.getAllChanges();

  // Notes about files that are no longer changed are dead weight. Clearing them
  // also means the rules get another go if the file is edited again next week.
  await context.store.pruneAutoAssigned(new Set(changes.map(change => change.fileKey)));

  const rules = currentAutoAssignRules();
  if (rules.length === 0) {
    return 0;
  }

  const batches = new Map<string, DisplayChange[]>();
  for (const change of changes) {
    // A file you filed yourself is yours. Rules only ever pick up strays.
    if (assignedGroupId(change, key => context.store.getAssignment(key))) {
      continue;
    }
    // Filed once already, and evidently taken back out. Leave it be.
    if (!options.force && context.store.wasAutoAssigned(change.fileKey)) {
      continue;
    }
    const rule = matchAutoAssignRule(rules, change.relativePath);
    if (!rule) {
      continue;
    }
    const batch = batches.get(rule.groupName);
    if (batch) {
      batch.push(change);
    } else {
      batches.set(rule.groupName, [change]);
    }
  }

  let filed = 0;
  for (const [groupName, batch] of batches) {
    const group = await groupNamed(context.store, groupName);
    if (context.store.getFrozen(group.id)) {
      // Frozen groups refuse new files. Saying so in the log beats throwing an
      // error at someone who only saved a file.
      context.output.appendLine(`Auto-assign skipped ${describeFileCount(batch.length)}: "${group.name}" is frozen.`);
      continue;
    }
    await context.store.autoAssign(batch, group.id);
    filed += batch.length;
    context.output.appendLine(`Auto-assign filed ${describeFileCount(batch.length)} into ${group.name}`);
  }

  if (filed > 0) {
    context.provider.refresh();
  }
  return filed;
}

/**
 * Runs a pass whenever the tree changes, without tripping over itself.
 *
 * Filing a file changes the tree, which lands us right back here. That settles
 * down on its own, because the second pass finds nothing left to file and writes
 * nothing, but only one pass may be in flight at a time or a burst of Git events
 * would start a pile of them.
 */
export class AutoAssigner {
  private running = false;
  private again = false;

  public constructor(private readonly context: AutoAssignContext) {
    if (!context?.store || !context.provider || !context.output) {
      throw new Error('A store, a provider, and an output channel are required.');
    }
  }

  /** Asks for a pass. Cheap to call, and safe to call repeatedly. */
  public schedule(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      do {
        this.again = false;
        try {
          await applyAutoAssign(this.context);
        } catch (error) {
          // A pass failing must not take the editor with it. Saving a file is
          // not the moment for a dialog about a settings typo.
          this.context.output.appendLine(`Auto-assign failed: ${errorMessage(error)}`);
        }
      } while (this.again);
    } finally {
      this.running = false;
    }
  }
}

/**
 * The group a rule names, created if it is not there yet.
 *
 * Creating it is the point. Otherwise a rule would sit doing nothing until you
 * happened to make a group whose name matched exactly, which is a puzzle nobody
 * needs. The color comes from the name, so a group looks the same every time and
 * two rules rarely collide on one color.
 */
async function groupNamed(store: GroupStore, name: string): Promise<LocalGroup> {
  const existing = store.getGroups()
    .find(group => group.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
  return existing ?? await store.createGroup(name, colorFromName(name));
}

function colorFromName(name: string): GroupColor {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1000003;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}
