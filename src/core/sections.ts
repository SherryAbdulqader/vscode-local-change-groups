import type { ChangeArea } from './changes';

/**
 * The sections the tree splits into.
 *
 * Two of them are Git's own halves — the index and the working tree — and are
 * borrowed straight from the built-in view. The third is ours: frozen groups get
 * lifted out of the normal flow entirely.
 *
 * That separation matters. A file in a frozen group can still be edited, and
 * those new edits are live working-tree changes that belong in **Changes** like
 * any other. Keeping Frozen as its own section is what lets one file appear
 * twice — pinned in its frozen group, and live in Changes — instead of the
 * snapshot swallowing the ongoing work.
 */

/** The two halves Git actually knows about. */
export type LiveSection = 'staged' | 'unstaged';

/** Every section the tree can show, including our own. */
export type ChangeSection = LiveSection | 'frozen';

/**
 * Which live section does this change belong in?
 *
 * A file can answer yes to both, and that is not a bug. Stage a file, edit it
 * again, and it really does exist in two places at once: the index holds one
 * version, your disk holds another. The built-in view lists it twice for exactly
 * this reason, so we do too.
 *
 * Frozen is deliberately not a possible argument — those rows come from a
 * snapshot rather than from anything Git currently reports.
 */
export function isInSection(area: ChangeArea, section: LiveSection): boolean {
  return section === 'staged'
    ? area === 'Staged' || area === 'Working Tree + Staged'
    : area !== 'Staged';
}

/** The header text for a section. */
export function sectionLabel(section: ChangeSection): string {
  if (section === 'frozen') return 'Frozen';
  return section === 'staged' ? 'Staged Changes' : 'Changes';
}

/** Frozen rows come from storage, so they never consult Git's live state. */
export function isLiveSection(section: ChangeSection): section is LiveSection {
  return section !== 'frozen';
}
