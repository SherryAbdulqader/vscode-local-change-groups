import { DEFAULT_GROUP_COLOR, GroupColor, isGroupColor, isGroupIcon, LocalGroup, normalizeGroupName } from './groups';

/**
 * A group layout in a form you can hand to somebody else.
 *
 * Two things stop the stored state itself from being shareable. Assignments are
 * filed under absolute paths, which mean nothing on another machine. And groups
 * are identified by a UUID generated locally, which means nothing anywhere else.
 *
 * So the file records repository-relative paths, and refers to groups by name.
 * Both survive the trip. Frozen snapshots are deliberately left out: they are
 * megabytes of your file contents, and they are about your afternoon rather than
 * about how the team organises work.
 */

/** One group, as it appears in an exported file. */
export interface LayoutGroup {
  name: string;
  color: GroupColor;
  icon?: string;
}

/** The whole file. */
export interface Layout {
  version: 1;
  groups: LayoutGroup[];
  /** Repository-relative path, to the name of the group it belongs in. */
  files: Record<string, string>;
}

export const LAYOUT_VERSION = 1;

/** Packs groups and their files into the shareable shape. */
export function buildLayout(
  groups: readonly LocalGroup[],
  files: ReadonlyMap<string, string>
): Layout {
  const byId = new Map(groups.map(group => [group.id, group]));
  const packed: Record<string, string> = {};
  for (const [relativePath, groupId] of files) {
    const group = byId.get(groupId);
    if (group) {
      packed[relativePath] = group.name;
    }
  }
  return {
    version: LAYOUT_VERSION,
    // Order is kept, because it is the order the groups appear in the tree and
    // whoever imports this should see the same arrangement.
    groups: groups.map(group => ({
      name: group.name,
      color: group.color,
      ...(group.icon ? { icon: group.icon } : {})
    })),
    files: packed
  };
}

/**
 * Reads a layout file back, refusing anything it cannot trust.
 *
 * This is a file from somewhere else, so it gets the same treatment as stored
 * state: check every field, drop what does not hold up. The difference is that a
 * completely unusable file throws, because someone just picked it in a dialog
 * and deserves to be told it was the wrong one.
 */
export function readLayout(value: unknown): Layout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('That file does not contain a group layout.');
  }
  const candidate = value as Partial<Layout>;
  if (candidate.version !== LAYOUT_VERSION) {
    throw new Error(`This layout is version ${String(candidate.version)}; this version of the extension reads version ${LAYOUT_VERSION}.`);
  }

  const groups: LayoutGroup[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(candidate.groups) ? candidate.groups : []) {
    const group = readGroup(entry);
    // Two groups with one name would race to own the same files.
    if (group && !seen.has(group.name.toLowerCase())) {
      seen.add(group.name.toLowerCase());
      groups.push(group);
    }
  }

  const files: Record<string, string> = {};
  if (candidate.files && typeof candidate.files === 'object' && !Array.isArray(candidate.files)) {
    for (const [path, groupName] of Object.entries(candidate.files as Record<string, unknown>)) {
      if (path.trim() && typeof groupName === 'string' && groupName.trim()) {
        files[normalizeLayoutPath(path)] = groupName.trim();
      }
    }
  }

  if (groups.length === 0 && Object.keys(files).length === 0) {
    throw new Error('That layout file has no groups and no files in it.');
  }
  return { version: LAYOUT_VERSION, groups, files };
}

/** Every group name a layout mentions, in the order they should be created. */
export function layoutGroupNames(layout: Layout): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of [...layout.groups.map(group => group.name), ...Object.values(layout.files)]) {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/** Forward slashes, no leading "./" — the same shape a change key expects. */
function normalizeLayoutPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function readGroup(value: unknown): LayoutGroup | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<LayoutGroup>;
  if (typeof candidate.name !== 'string') {
    return undefined;
  }
  try {
    return {
      name: normalizeGroupName(candidate.name),
      color: isGroupColor(candidate.color) ? candidate.color : DEFAULT_GROUP_COLOR,
      ...(isGroupIcon(candidate.icon) ? { icon: candidate.icon } : {})
    };
  } catch {
    // An empty or over-long name. Skip this group, keep the others.
    return undefined;
  }
}
