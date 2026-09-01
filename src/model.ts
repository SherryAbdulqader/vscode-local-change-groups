export interface LocalGroup {
  id: string;
  name: string;
  color: GroupColor;
  /** A VS Code codicon id; absent means the plain colored dot. */
  icon?: string;
}

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

/** Checks whether an unknown value is a usable codicon id. */
export function isGroupIcon(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && ICON_PATTERN.test(value);
}

export const GROUP_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'red', 'gray'] as const;
export type GroupColor = typeof GROUP_COLORS[number];
export const DEFAULT_GROUP_COLOR: GroupColor = 'blue';

export interface PersistedState {
  groups: LocalGroup[];
  assignments: Record<string, string>;
}

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

/** Returns safe persisted state when stored data is absent or malformed. */
export function normalizePersistedState(value: unknown): PersistedState {
  if (!value || typeof value !== 'object') {
    return { groups: [], assignments: {} };
  }

  const candidate = value as Partial<PersistedState>;
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups.filter(isLocalGroup).map(group => ({
        id: group.id,
        name: group.name,
        color: isGroupColor(group.color) ? group.color : DEFAULT_GROUP_COLOR,
        ...(isGroupIcon(group.icon) ? { icon: group.icon } : {})
      }))
    : [];
  const validIds = new Set(groups.map(group => group.id));
  const assignments: Record<string, string> = {};
  if (candidate.assignments && typeof candidate.assignments === 'object') {
    for (const [key, groupId] of Object.entries(candidate.assignments)) {
      if (key && typeof groupId === 'string' && validIds.has(groupId)) {
        assignments[key] = groupId;
      }
    }
  }
  return { groups, assignments };
}

/** Checks whether an unknown value is a valid local group. */
function isLocalGroup(value: unknown): value is LocalGroup {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const group = value as Partial<LocalGroup>;
  return typeof group.id === 'string' && group.id.length > 0 &&
    typeof group.name === 'string' && group.name.trim().length > 0;
}

/** Checks whether an unknown value names a supported group color. */
export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === 'string' && (GROUP_COLORS as readonly string[]).includes(value);
}
