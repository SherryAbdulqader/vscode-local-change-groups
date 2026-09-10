/**
 * What a group is, and what counts as a legal one.
 *
 * Colors and icons live here rather than next to the tree because they get
 * validated on the way into storage and again on the way out, and both of those
 * happen a long way from any rendering code.
 *
 * No VS Code import, no file system. You can call anything in here from a test
 * without standing up an editor first.
 */

export interface LocalGroup {
  id: string;
  name: string;
  color: GroupColor;
  /** A VS Code codicon id; absent means the plain colored dot. */
  icon?: string;
}

export const GROUP_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'red', 'gray'] as const;
export type GroupColor = typeof GROUP_COLORS[number];
export const DEFAULT_GROUP_COLOR: GroupColor = 'blue';

export const DEFAULT_GROUP_ICON = 'circle-filled';

/** The shortlist the icon picker shows. Add to it freely, it is just a list. */
export const GROUP_ICONS: readonly { id: string; hint: string }[] = [
  { id: 'circle-filled', hint: 'Dot' },
  { id: 'beaker', hint: 'Tests' },
  { id: 'bug', hint: 'Fixes' },
  { id: 'rocket', hint: 'Ready to ship' },
  { id: 'lock', hint: 'Local only' },
  { id: 'tools', hint: 'Chores' },
  { id: 'paintcan', hint: 'Styling' },
  { id: 'book', hint: 'Docs' },
  { id: 'database', hint: 'Data and migrations' },
  { id: 'shield', hint: 'Security' },
  { id: 'flame', hint: 'Hotfix' },
  { id: 'lightbulb', hint: 'Experiments' },
  { id: 'eye', hint: 'Needs review' },
  { id: 'package', hint: 'Build and packaging' },
  { id: 'gear', hint: 'Configuration' },
  { id: 'star-full', hint: 'Favourites' }
];

const ICON_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Trims a name down to something sane, or refuses it outright. */
export function normalizeGroupName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('Group name is required.');
  }
  if (normalized.length > 60) {
    throw new Error('Group names cannot exceed 60 characters.');
  }
  return normalized;
}

/**
 * Cleans up a codicon id. Rejects "$(beaker)" on purpose: that is the label
 * syntax, not the id, and VS Code responds to a bad id by drawing nothing at
 * all, which is a miserable thing to debug.
 */
export function normalizeGroupIcon(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!ICON_PATTERN.test(normalized)) {
    throw new Error('Use a codicon id such as "beaker": lowercase letters, numbers, and dashes only.');
  }
  if (normalized.length > 40) {
    throw new Error('Icon ids cannot exceed 40 characters.');
  }
  return normalized;
}

/** Is this one of our eight colors? */
export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === 'string' && (GROUP_COLORS as readonly string[]).includes(value);
}

/** Is this something ThemeIcon will actually draw? */
export function isGroupIcon(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && ICON_PATTERN.test(value);
}

/**
 * The order with one group shifted a step up or down.
 *
 * Nudging the top item up, or the bottom one down, gives the order back
 * unchanged. That is what makes the menu entries safe to leave enabled: the
 * ends simply do nothing rather than wrapping around, which nobody expects a
 * list to do.
 */
export function moveInOrder(ids: readonly string[], id: string, step: number): string[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) {
    return [...ids];
  }
  const reordered = [...ids];
  reordered.splice(from, 1);
  reordered.splice(to, 0, id);
  return reordered;
}

/**
 * The order with some groups lifted out and dropped back in above another one.
 *
 * This is what a drag lands on. The moving ids are removed first and the
 * insertion point is found afterwards, so dragging something downwards past
 * its own old position still ends up where you dropped it.
 *
 * Dropping a group onto itself changes nothing.
 */
export function moveBefore(ids: readonly string[], moving: readonly string[], beforeId: string): string[] {
  const lifted = moving.filter(id => ids.includes(id) && id !== beforeId);
  if (lifted.length === 0) {
    return [...ids];
  }
  const rest = ids.filter(id => !lifted.includes(id));
  const at = rest.indexOf(beforeId);
  if (at < 0) {
    return [...ids];
  }
  return [...rest.slice(0, at), ...lifted, ...rest.slice(at)];
}
