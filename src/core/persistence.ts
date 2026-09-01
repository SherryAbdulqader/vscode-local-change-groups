import { DEFAULT_GROUP_COLOR, isGroupColor, isGroupIcon, LocalGroup } from './groups';

/**
 * The shape written to workspace storage, and the guard that reads it back.
 *
 * Stored state is untrusted input: it may predate a feature, or have been
 * hand-edited. Everything is re-validated on load, and anything unusable is
 * dropped rather than surfaced to the UI, so a bad value can never render as an
 * invisible icon or an assignment pointing at a group that no longer exists.
 */
export interface PersistedState {
  groups: LocalGroup[];
  assignments: Record<string, string>;
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

  // An assignment naming a group that did not survive validation would strand
  // its file in no visible section at all, so those are discarded here.
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
