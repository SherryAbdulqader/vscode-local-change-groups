import type { ChangeArea } from './changes';

/**
 * The Staged Changes / Changes split, mirroring the built-in Source Control view.
 */

export type ChangeSection = 'staged' | 'unstaged';

/**
 * Decides which section a change belongs to.
 *
 * Membership is deliberately not exclusive: a file that is staged and then
 * edited again is genuinely present in both the index and the working tree, and
 * the built-in Changes list shows it twice for exactly that reason.
 */
export function isInSection(area: ChangeArea, section: ChangeSection): boolean {
  return section === 'staged'
    ? area === 'Staged' || area === 'Working Tree + Staged'
    : area !== 'Staged';
}

/** Returns the header shown for one section. */
export function sectionLabel(section: ChangeSection): string {
  return section === 'staged' ? 'Staged Changes' : 'Changes';
}
