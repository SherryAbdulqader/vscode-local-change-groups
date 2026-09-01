import { randomUUID } from 'node:crypto';
import { LocalGroup, normalizeGroupName, normalizePersistedState, PersistedState } from './model';

const STORAGE_KEY = 'localChangeGroups.state.v1';

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** Manages private group metadata in VS Code workspace state. */
export class GroupStore {
  private state: PersistedState;

  /** Loads group metadata from the provided workspace memento. */
  public constructor(private readonly memento: MementoLike) {
    if (!memento || typeof memento.get !== 'function' || typeof memento.update !== 'function') {
      throw new Error('A valid workspace memento is required.');
    }
    this.state = normalizePersistedState(memento.get<unknown>(STORAGE_KEY));
  }

  /** Returns a copy of all configured groups. */
  public getGroups(): LocalGroup[] {
    return this.state.groups.map(group => ({ ...group }));
  }

  /** Returns the assigned group ID for a file key. */
  public getAssignment(fileKey: string): string | undefined {
    if (!fileKey.trim()) {
      throw new Error('A file key is required.');
    }
    return this.state.assignments[fileKey];
  }

  /** Creates and persists a uniquely named group. */
  public async createGroup(name: string): Promise<LocalGroup> {
    const normalized = this.validateUniqueName(name);
    const group = { id: randomUUID(), name: normalized };
    this.state.groups.push(group);
    await this.persist();
    return { ...group };
  }

  /** Renames and persists an existing group. */
  public async renameGroup(groupId: string, name: string): Promise<void> {
    const group = this.requireGroup(groupId);
    group.name = this.validateUniqueName(name, groupId);
    await this.persist();
  }

  /** Deletes a group and returns its files to Ungrouped. */
  public async deleteGroup(groupId: string): Promise<void> {
    this.requireGroup(groupId);
    this.state.groups = this.state.groups.filter(group => group.id !== groupId);
    for (const [key, assignedGroupId] of Object.entries(this.state.assignments)) {
      if (assignedGroupId === groupId) {
        delete this.state.assignments[key];
      }
    }
    await this.persist();
  }

  /** Assigns or moves a file to an existing group. */
  public async assign(fileKey: string, groupId: string): Promise<void> {
    if (!fileKey.trim()) {
      throw new Error('A file key is required.');
    }
    this.requireGroup(groupId);
    this.state.assignments[fileKey] = groupId;
    await this.persist();
  }

  /** Removes a file assignment without changing the file. */
  public async unassign(fileKey: string): Promise<void> {
    if (!fileKey.trim()) {
      throw new Error('A file key is required.');
    }
    delete this.state.assignments[fileKey];
    await this.persist();
  }

  /** Finds an existing group or rejects invalid IDs. */
  private requireGroup(groupId: string): LocalGroup {
    if (!groupId.trim()) {
      throw new Error('A group ID is required.');
    }
    const group = this.state.groups.find(candidate => candidate.id === groupId);
    if (!group) {
      throw new Error('Group not found.');
    }
    return group;
  }

  /** Validates a name and rejects case-insensitive duplicates. */
  private validateUniqueName(name: string, exceptGroupId?: string): string {
    const normalized = normalizeGroupName(name);
    const duplicate = this.state.groups.some(group =>
      group.id !== exceptGroupId && group.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0
    );
    if (duplicate) {
      throw new Error('A group with that name already exists.');
    }
    return normalized;
  }

  /** Persists an immutable snapshot to workspace state. */
  private async persist(): Promise<void> {
    const snapshot: PersistedState = {
      groups: this.state.groups.map(group => ({ ...group })),
      assignments: { ...this.state.assignments }
    };
    await this.memento.update(STORAGE_KEY, snapshot);
  }
}
