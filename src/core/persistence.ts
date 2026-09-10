import { FrozenSnapshot, normalizeFrozenSnapshots } from './frozen';
import { DEFAULT_GROUP_COLOR, isGroupColor, isGroupIcon, LocalGroup } from './groups';

/**
 * What we write to workspace storage, and the bouncer that reads it back.
 *
 * Treat whatever comes out of storage as a rumour rather than a fact. It may
 * have been written by a version of this extension that predates half these
 * fields, or hand-edited by someone having a curious afternoon. So everything is
 * re-checked on load and anything dubious is quietly dropped — the alternative
 * is an invisible icon or a file assigned to a group that no longer exists, and
 * good luck spotting either of those from a bug report.
 */
export interface PersistedState {
  /** Order matters: this is the order the groups appear in the tree. */
  groups: LocalGroup[];
  assignments: Record<string, string>;
  /** Snapshots, keyed by group id. A group with no entry here is live. */
  frozen: Record<string, FrozenSnapshot>;
  /**
   * File keys auto-assign has already filed.
   *
   * Kept so that removing a file from the group a rule put it in actually
   * sticks, instead of the rule filing it again on the next refresh.
   */
  autoAssigned: string[];
}

/** Reads stored state, or hands back an empty slate if it is unusable. */
export function normalizePersistedState(value: unknown): PersistedState {
  if (!value || typeof value !== 'object') {
    return { groups: [], assignments: {}, frozen: {}, autoAssigned: [] };
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

  // Drop assignments pointing at groups that did not survive the check above.
  // A file assigned to a group that no longer exists renders nowhere at all,
  // which from the outside looks exactly like the file vanishing.
  const validIds = new Set(groups.map(group => group.id));
  const assignments: Record<string, string> = {};
  if (candidate.assignments && typeof candidate.assignments === 'object') {
    for (const [key, groupId] of Object.entries(candidate.assignments)) {
      if (key && typeof groupId === 'string' && validIds.has(groupId)) {
        assignments[key] = groupId;
      }
    }
  }
  const autoAssigned = Array.isArray(candidate.autoAssigned)
    ? [...new Set(candidate.autoAssigned.filter(key => typeof key === 'string' && key.length > 0))]
    : [];

  return {
    groups,
    assignments,
    frozen: normalizeFrozenSnapshots(candidate.frozen, validIds),
    autoAssigned
  };
}

/** The bare minimum for something to pass as a group. */
function isLocalGroup(value: unknown): value is LocalGroup {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const group = value as Partial<LocalGroup>;
  return typeof group.id === 'string' && group.id.length > 0 &&
    typeof group.name === 'string' && group.name.trim().length > 0;
}
