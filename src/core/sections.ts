import type { ChangeArea } from './changes';

/** The Staged Changes / Changes split, borrowed from the built-in view. */

export type ChangeSection = 'staged' | 'unstaged';

/**
 * Which section does this change belong in?
 *
 * A file can answer yes to both, and that is not a bug. Stage a file, edit it
 * again, and it really does exist in two places at once: the index holds one
 * version, your disk holds another. The built-in view lists it twice for exactly
 * this reason, so we do too.
 */
export function isInSection(area: ChangeArea, section: ChangeSection): boolean {
  return section === 'staged'
    ? area === 'Staged' || area === 'Working Tree + Staged'
    : area !== 'Staged';
}

/** The header text for a section. */
export function sectionLabel(section: ChangeSection): string {
  return section === 'staged' ? 'Staged Changes' : 'Changes';
}
