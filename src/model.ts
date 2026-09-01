export interface LocalGroup {
  id: string;
  name: string;
}

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
    ? candidate.groups.filter(isLocalGroup).map(group => ({ id: group.id, name: group.name }))
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
