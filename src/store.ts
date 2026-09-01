import { randomUUID } from 'node:crypto';
import { DEFAULT_GROUP_COLOR, GroupColor, isGroupColor, LocalGroup, normalizeGroupName, normalizePersistedState, PersistedState } from './model';

const STORAGE_KEY = 'localChangeGroups.state.v1';

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** Manages private group metadata in VS Code workspace state. */
export class GroupStore {
  private state: PersistedState;
  private writeQueue: Promise<void> = Promise.resolve();

  /** Loads group metadata from the provided workspace memento. */
  public constructor(private readonly memento: MementoLike) {
    if (!memento || typeof memento.get !== 'function' || typeof memento.update !== 'function') throw new Error('A valid workspace memento is required.');
    this.state = normalizePersistedState(memento.get<unknown>(STORAGE_KEY));
  }

  /** Returns a copy of all configured groups. */
  public getGroups(): LocalGroup[] { return this.state.groups.map(group => ({ ...group })); }

  /** Returns the assigned group ID for a file key. */
  public getAssignment(fileKey: string): string | undefined {
    if (!fileKey.trim()) throw new Error('A file key is required.');
    return this.state.assignments[fileKey];
  }

  /** Creates and persists a uniquely named group. */
  public async createGroup(name: string, color: GroupColor = DEFAULT_GROUP_COLOR): Promise<LocalGroup> {
    if (!isGroupColor(color)) throw new Error('Select a supported group color.');
    const group = { id: randomUUID(), name: normalizeGroupName(name), color };
    return this.mutate(next => {
      this.validateUniqueName(next, group.name);
      next.groups.push(group);
      return { ...group };
    });
  }

  /** Renames and persists an existing group. */
  public async renameGroup(groupId: string, name: string): Promise<void> {
    const normalized = normalizeGroupName(name);
    await this.mutate(next => {
      const group = this.requireGroup(next, groupId);
      this.validateUniqueName(next, normalized, groupId);
      group.name = normalized;
    });
  }

  /** Changes and persists an existing group's theme-aware color. */
  public async setGroupColor(groupId: string, color: GroupColor): Promise<void> {
    if (!isGroupColor(color)) throw new Error('Select a supported group color.');
    await this.mutate(next => { this.requireGroup(next, groupId).color = color; });
  }

  /** Deletes a group and returns its files to Ungrouped. */
  public async deleteGroup(groupId: string): Promise<void> {
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      next.groups = next.groups.filter(group => group.id !== groupId);
      for (const [key, assigned] of Object.entries(next.assignments)) if (assigned === groupId) delete next.assignments[key];
    });
  }

  /** Assigns or moves a file to an existing group. */
  public async assign(fileKey: string, groupId: string): Promise<void> {
    if (!fileKey.trim()) throw new Error('A file key is required.');
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      next.assignments[fileKey] = groupId;
    });
  }

  /** Clears rename aliases and assigns only the current path in one write. */
  public async moveAssignment(fileKeys: string[], currentKey: string, groupId: string): Promise<void> {
    if (!fileKeys.length || fileKeys.some(key => !key.trim()) || !currentKey.trim()) throw new Error('Valid file keys are required.');
    await this.mutate(next => {
      this.requireGroup(next, groupId);
      for (const key of fileKeys) delete next.assignments[key];
      next.assignments[currentKey] = groupId;
    });
  }

  /** Removes a file assignment without changing the file. */
  public async unassign(fileKey: string): Promise<void> {
    if (!fileKey.trim()) throw new Error('A file key is required.');
    await this.mutate(next => { delete next.assignments[fileKey]; });
  }

  /** Removes current and rename-alias assignments in one write. */
  public async unassignAll(fileKeys: string[]): Promise<void> {
    if (!fileKeys.length || fileKeys.some(key => !key.trim())) throw new Error('Valid file keys are required.');
    await this.mutate(next => { for (const key of fileKeys) delete next.assignments[key]; });
  }

  /** Serializes immutable writes and publishes memory only after persistence succeeds. */
  private mutate<T>(change: (next: PersistedState) => T): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const next: PersistedState = { groups: this.state.groups.map(group => ({ ...group })), assignments: { ...this.state.assignments } };
      try {
        const value = change(next);
        const snapshot: PersistedState = { groups: next.groups.map(group => ({ ...group })), assignments: { ...next.assignments } };
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
