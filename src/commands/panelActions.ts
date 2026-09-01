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
 * Turns a commit panel button press into the same action a menu would run.
 *
 * The panel only ever sends a group id and a message, never a resolved node, so
 * the id gets looked up against live state right here. A collapsed panel can sit
 * around for a long time while groups get renamed and deleted underneath it —
 * this is what stops a stale page from acting on a group that no longer exists.
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

  // The page greys out the commit buttons for an empty group, but the message
  // box is free text and the page is not the authority on anything. Check again.
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
