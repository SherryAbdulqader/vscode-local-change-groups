import { PanelAction } from '../view/commitPanel/protocol';
import {
  commitAndPushGroup,
  commitGroup,
  discardChanges,
  stageGroup,
  unstageChanges
} from '../services/changeActions';
import { GroupNode } from '../view/nodes';
import { actionContext, CommandContext } from './context';
import { groupNodeById } from './prompts';

/**
 * Translates a commit panel button press into the same action a menu command
 * would run.
 *
 * The panel sends a group id and a message, never a resolved node, so the id is
 * looked up against live state here. That is what stops a stale page — one whose
 * group was renamed or deleted while it sat hidden — from acting on anything.
 */
export async function runPanelAction(
  context: CommandContext,
  action: PanelAction,
  groupId: string,
  message: string
): Promise<void> {
  const selected: GroupNode = groupNodeById(groupId, context.store, context.gitApi);
  const actions = actionContext(context);

  if (action === 'stage') {
    await stageGroup(actions, selected);
    return;
  }
  if (action === 'unstage') {
    await unstageChanges(actions, context.provider.getGroupChanges(selected), selected.group!.name);
    return;
  }

  // The page disables the commit buttons on an empty group, but the message box
  // is free text, so emptiness is re-checked rather than assumed.
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Enter a commit message.');
  }
  if (action === 'commit') {
    await commitGroup(actions, selected, trimmed);
  } else {
    await commitAndPushGroup(actions, selected, trimmed);
  }
}

export { discardChanges };
