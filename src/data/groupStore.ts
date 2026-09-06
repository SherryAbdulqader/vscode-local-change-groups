import { randomUUID } from 'node:crypto';
import { FrozenSnapshot } from '../core/frozen';
import { DEFAULT_GROUP_COLOR, GroupColor, isGroupColor, LocalGroup, normalizeGroupIcon, normalizeGroupName } from '../core/groups';
import { normalizePersistedState, PersistedState } from '../core/persistence';

const STORAGE_KEY = 'localChangeGroups.state.v1';

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** A file's current key, plus any old-path aliases a move needs to clear. */
export interface AssignmentTarget {
  fileKey: string;
  assignmentKeys: readonly string[];
}

/**
 * Group metadata, kept in workspace state and nowhere near your repository.
 *
 * Two rules hold this together. Writes go through one queue, so two commands
 * racing cannot interleave and lose each other's changes. And memory is only
 * updated *after* storage says yes — if the write fails, the UI keeps showing
 * the truth rather than something that was never saved.
 *
 * The bulk methods are not premature optimisation: dropping fifty files on a
 * group used to be fifty separate persisted writes.
 */
export class GroupStore {
  private state: PersistedState;
  private writeQueue: Promise<void> = Promise.resolve();

  /** Loads whatever is in storage, re-validated on the way in. */
  public constructor(private readonly memento: MementoLike) {
    if (!memento || typeof memento.get !== 'function' || typeof memento.update !== 'function') throw new Error('A valid workspace memento is required.');
    this.state = normalizePersistedState(memento.get<unknown>(STORAGE_KEY));
  }

  /** Copies, not references — callers have been known to mutate. */
  public getGroups(): LocalGroup[] { return this.state.groups.map(group => ({ ...group })); }

  /** Which group owns this file, if any. */
  public getAssignment(fileKey: string): string | undefined {
    if (!fileKey.trim()) throw new Error('A file key is required.');
    return this.state.assignments[fileKey];
  }

  /** The snapshot pinning a group, or undefined when it is live. */
  public getFrozen(groupId: string): FrozenSnapshot | undefined {
    if (!groupId.trim()) throw new Error('A group ID is required.');
    return this.state.frozen[groupId];
  }

  /** Every snapshot currently held, for pruning stored blobs. */
  public getAllFrozen(): Record<string, FrozenSnapshot> {
    return { ...this.state.frozen };
  }

  /** Pins a group to a snapshot. */
  public async freezeGroup(groupId: string, snapshot: FrozenSnapshot): Promise<void> {
    if (!snapshot?.files?.length) throw new Error('A freeze needs at least one file.');
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      next.frozen[groupId] = snapshot;
    });
  }

  /** Releases a group back to live Git state. */
  public async unfreezeGroup(groupId: string): Promise<void> {
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      delete next.frozen[groupId];
    });
  }

  /**
   * Makes a group, optionally filling it in the same write.
   *
   * Doing both at once is what stops a rejected duplicate name from leaving an
   * empty group lying around.
   */
  public async createGroup(
    name: string,
    color: GroupColor = DEFAULT_GROUP_COLOR,
    assign: readonly AssignmentTarget[] = []
  ): Promise<LocalGroup> {
    if (!isGroupColor(color)) throw new Error('Select a supported group color.');
    validateTargets(assign);
    const group = { id: randomUUID(), name: normalizeGroupName(name), color };
    return this.mutate(next => {
      this.validateUniqueName(next, group.name);
      next.groups.push(group);
      applyAssignments(next, assign, group.id);
      return { ...group };
    });
  }

  /** Renames a group, refusing a name another group already has. */
  public async renameGroup(groupId: string, name: string): Promise<void> {
    const normalized = normalizeGroupName(name);
    await this.mutate(next => {
      const group = this.requireGroup(next, groupId);
      this.validateUniqueName(next, normalized, groupId);
      group.name = normalized;
    });
  }

  /** Repaints a group. */
  public async setGroupColor(groupId: string, color: GroupColor): Promise<void> {
    if (!isGroupColor(color)) throw new Error('Select a supported group color.');
    await this.mutate(next => { this.requireGroup(next, groupId).color = color; });
  }

  /** Swaps a group's icon. */
  public async setGroupIcon(groupId: string, icon: string): Promise<void> {
    const normalized = normalizeGroupIcon(icon);
    await this.mutate(next => { this.requireGroup(next, groupId).icon = normalized; });
  }

  /** Deletes a group. Its files fall back to Ungrouped; nothing on disk moves. */
  public async deleteGroup(groupId: string): Promise<void> {
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      next.groups = next.groups.filter(group => group.id !== groupId);
      for (const [key, assigned] of Object.entries(next.assignments)) if (assigned === groupId) delete next.assignments[key];
      delete next.frozen[groupId];
    });
  }

  /** Puts one file in a group. */
  public async assign(fileKey: string, groupId: string): Promise<void> {
    if (!fileKey.trim()) throw new Error('A file key is required.');
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      next.assignments[fileKey] = groupId;
    });
  }

  /** One file, aliases cleared, one write. Thin wrapper over the bulk version. */
  public async moveAssignment(fileKeys: string[], currentKey: string, groupId: string): Promise<void> {
    await this.moveAssignments([{ fileKey: currentKey, assignmentKeys: fileKeys }], groupId);
  }

  /**
   * Moves a whole batch of files in a single persisted write.
   *
   * Refuses if the destination is frozen. A frozen group is showing a snapshot,
   * so a file dropped into it would sit there with nothing to display — the
   * guard lives here rather than in the commands so drag-and-drop gets it too.
   */
  public async moveAssignments(targets: readonly AssignmentTarget[], groupId: string): Promise<void> {
    if (!targets.length) throw new Error('At least one file is required.');
    validateTargets(targets);
    await this.mutate(next => {
      const group = this.requireGroup(next, groupId);
      if (next.frozen[groupId]) {
        throw new Error(`"${group.name}" is frozen. Unfreeze it before adding files.`);
      }
      applyAssignments(next, targets, groupId);
    });
  }

  /** Forgets one assignment. The file itself is untouched. */
  public async unassign(fileKey: string): Promise<void> {
    if (!fileKey.trim()) throw new Error('A file key is required.');
    await this.mutate(next => { delete next.assignments[fileKey]; });
  }

  /** Forgets a batch of assignments, aliases included, in one write. */
  public async unassignAll(fileKeys: string[]): Promise<void> {
    if (!fileKeys.length || fileKeys.some(key => !key.trim())) throw new Error('Valid file keys are required.');
    await this.mutate(next => { for (const key of fileKeys) delete next.assignments[key]; });
  }

  /**
   * The one place state actually changes.
   *
   * Every mutation is queued behind the last, applied to a copy, and only
   * published to memory once storage has confirmed. That ordering is the whole
   * trick: if the write throws, the caller hears about it and in-memory state
   * never drifted from what is on disk.
   */
  private mutate<T>(change: (next: PersistedState) => T): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const next: PersistedState = { groups: this.state.groups.map(group => ({ ...group })), assignments: { ...this.state.assignments }, frozen: { ...this.state.frozen } };
      try {
        const value = change(next);
        const snapshot: PersistedState = { groups: next.groups.map(group => ({ ...group })), assignments: { ...next.assignments }, frozen: { ...next.frozen } };
        await this.memento.update(STORAGE_KEY, snapshot);
        this.state = snapshot;
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
    return result;
  }

  private requireGroup(state: PersistedState, groupId: string): LocalGroup {
    if (!groupId.trim()) throw new Error('A group ID is required.');
    const group = state.groups.find(candidate => candidate.id === groupId);
    if (!group) throw new Error('Group not found.');
    return group;
  }

  private validateUniqueName(state: PersistedState, name: string, exceptGroupId?: string): void {
    const duplicate = state.groups.some(group => group.id !== exceptGroupId && group.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    if (duplicate) throw new Error('A group with that name already exists.');
  }
}

/** Catches empty or blank keys before they reach the assignment map. */
function validateTargets(targets: readonly AssignmentTarget[]): void {
  for (const target of targets) {
    if (!target?.fileKey?.trim() || !target.assignmentKeys?.length || target.assignmentKeys.some(key => !key.trim())) {
      throw new Error('Valid file keys are required.');
    }
  }
}

/** Clears each file's old aliases, then points its current path at the group. */
function applyAssignments(state: PersistedState, targets: readonly AssignmentTarget[], groupId: string): void {
  for (const target of targets) {
    for (const key of target.assignmentKeys) delete state.assignments[key];
    state.assignments[target.fileKey] = groupId;
  }
}
