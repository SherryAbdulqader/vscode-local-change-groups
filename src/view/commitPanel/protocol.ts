import type { LocalGroup } from '../../core/groups';

/**
 * What the commit panel and the extension host are allowed to say to each other.
 *
 * A webview is a separate scriptable document, so treat anything coming back
 * from it as input from a stranger. `parseRequest` is the only door: nothing
 * reaches a Git action without going through it, and even then the host looks
 * the group id up again rather than believing whatever the page thinks it is
 * holding.
 */

/** Which button was pressed. */
export type PanelAction = 'stage' | 'unstage' | 'commit' | 'push';

/** A group, as the panel needs to draw it. */
export interface PanelGroup {
  id: string;
  name: string;
  color: LocalGroup['color'];
  count: number;
}

/** Everything the panel needs to render one frame. */
export interface PanelState {
  groups: PanelGroup[];
  selectedGroupId?: string;
  branch?: string;
}

/** Does the actual work. Supplied by the host; the panel never sees Git. */
export type PanelRunner = (action: PanelAction, groupId: string, message: string) => Promise<void>;

/** A message that has been checked and can be trusted. */
export type PanelRequest =
  | { type: 'ready' }
  | { type: 'run'; action: PanelAction; groupId: string; message: string };

/** The door. Anything that does not fit exactly gets dropped on the floor. */
export function parseRequest(value: unknown): PanelRequest | undefined {
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
  if (action !== 'stage' && action !== 'unstage' && action !== 'commit' && action !== 'push') {
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
