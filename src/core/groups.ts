/**
 * The group vocabulary: what a group is, the palettes and icons it may use, and
 * the rules every stored value must satisfy. Nothing here touches VS Code or the
 * file system, so it is directly unit-testable.
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

/** Codicon ids offered by the icon picker, with what each one suggests. */
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

/** Validates and normalizes a user-facing group name. */
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

/** Validates and normalizes a codicon id used as a group icon. */
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

/** Checks whether an unknown value names a supported group color. */
export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === 'string' && (GROUP_COLORS as readonly string[]).includes(value);
}

/** Checks whether an unknown value is a usable codicon id. */
export function isGroupIcon(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && ICON_PATTERN.test(value);
}
