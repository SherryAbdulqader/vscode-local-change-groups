import type { LocalGroup } from '../../core/groups';

/**
 * The contract between the commit panel webview and the extension host.
 *
 * A webview is a separate, scriptable document, so everything arriving from it
 * is untrusted input. `parseRequest` is the single gate: nothing reaches a Git
 * action without passing it, and the host re-resolves the group id afterwards
 * rather than trusting any state the page believes it holds.
 */

/** The Git action a panel button asks for. */
export type PanelAction = 'stage' | 'unstage' | 'commit' | 'push';

/** One group as presented by the commit panel. */
export interface PanelGroup {
  id: string;
  name: string;
  color: LocalGroup['color'];
  count: number;
}

/** State the panel needs to render itself. */
export interface PanelState {
  groups: PanelGroup[];
  selectedGroupId?: string;
  branch?: string;
}

/** Runs one panel action, reporting failures to the caller's handler. */
export type PanelRunner = (action: PanelAction, groupId: string, message: string) => Promise<void>;

/** A validated message from the webview. */
export type PanelRequest =
  | { type: 'ready' }
  | { type: 'run'; action: PanelAction; groupId: string; message: string };

/** Validates a message posted by the panel before acting on it. */
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
