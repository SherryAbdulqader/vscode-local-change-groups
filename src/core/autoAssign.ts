import { normalizeGroupName } from './groups';

/**
 * Filing changes into groups automatically, by path.
 *
 * You say "anything under test/ goes in Tests" once, in settings, and stop
 * filing test files by hand. Nothing here guesses: if you wrote no rules, this
 * does nothing at all.
 *
 * Two limits, both on purpose:
 *
 *   - **Only unfiled changes are touched.** A file you put somewhere yourself
 *     stays where you put it, and a rule never overrules you.
 *   - **A file is only auto-filed once.** Take it back out of the group and it
 *     stays out. Without that, Remove would look broken — the file would hop
 *     straight back on the next refresh.
 *
 * The matcher is small and deliberate. Everyone knows VS Code globs, so it reads
 * the same ones, and anything it cannot parse is treated as plain text rather
 * than silently matching more than you meant.
 */

/** One line of the setting: a pattern, and the group it files into. */
export interface AutoAssignRule {
  pattern: string;
  groupName: string;
}

/**
 * Reads the `autoAssign` setting into rules.
 *
 * Settings are user-editable JSON, so half of this is refusing rubbish. A bad
 * entry is skipped on its own rather than throwing the whole setting away —
 * one typo should not turn the feature off.
 *
 * Order is kept, because the first matching rule wins and that order is the
 * order you wrote them in.
 */
export function readAutoAssignRules(value: unknown): AutoAssignRule[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const rules: AutoAssignRule[] = [];
  for (const [pattern, groupName] of Object.entries(value as Record<string, unknown>)) {
    if (!pattern.trim() || typeof groupName !== 'string') {
      continue;
    }
    try {
      rules.push({ pattern: pattern.trim(), groupName: normalizeGroupName(groupName) });
    } catch {
      // An empty or over-long group name. Skip the rule, keep the rest.
    }
  }
  return rules;
}

/**
 * The first rule matching this path, if any.
 *
 * First match rather than best match, so the behaviour is the order you can see
 * in your settings file instead of a specificity contest you have to work out.
 */
export function matchAutoAssignRule(
  rules: readonly AutoAssignRule[],
  relativePath: string,
  platform: NodeJS.Platform = process.platform
): AutoAssignRule | undefined {
  const path = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path) {
    return undefined;
  }
  const basename = path.slice(path.lastIndexOf('/') + 1);
  for (const rule of rules) {
    // A pattern with no slash is about the file name, wherever it sits — so
    // "*.md" catches docs/readme.md, the way .gitignore would. Put a slash in it
    // and it is about the whole path from the repository root.
    const subject = rule.pattern.includes('/') ? path : basename;
    if (globToRegExp(rule.pattern, platform).test(subject)) {
      return rule;
    }
  }
  return undefined;
}

/**
 * Turns a VS Code style glob into a regular expression.
 *
 * Supported, and nothing else:
 *
 *   `**`      any number of path segments, including none
 *   `*`       anything within one segment
 *   `?`       one character within one segment
 *   `{a,b}`   either alternative
 *
 * A `**` followed by a slash also matches nothing at all, which is what lets a
 * pattern like "any folder, then a .ts file" find one sitting at the repository
 * root rather than insisting on at least one folder above it.
 *
 * Matching ignores case on Windows, to agree with the way assignment keys are
 * already built there.
 */
export function globToRegExp(pattern: string, platform: NodeJS.Platform = process.platform): RegExp {
  // Unbalanced braces mean the author did not intend alternation, so the braces
  // are treated as ordinary characters instead of producing a broken expression.
  const braces = balancedBraces(pattern);
  let source = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 3;
        } else {
          source += '.*';
          index += 2;
        }
      } else {
        source += '[^/]*';
        index += 1;
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
    } else if (braces && char === '{') {
      source += '(?:';
    } else if (braces && char === '}') {
      source += ')';
    } else if (braces && char === ',') {
      source += '|';
    } else {
      source += escapeForRegExp(char);
    }
    index += 1;
  }

  return new RegExp(`^${source}$`, platform === 'win32' ? 'i' : '');
}

/** Are the braces paired up, and never nested? Nesting is not supported. */
function balancedBraces(pattern: string): boolean {
  let depth = 0;
  for (const char of pattern) {
    if (char === '{') {
      depth += 1;
      if (depth > 1) return false;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Characters a regular expression would otherwise read as instructions. */
const REGEXP_SPECIAL = new Set(['.', '+', '^', '$', '(', ')', '|', '[', ']', '{', '}', '\\']);

function escapeForRegExp(char: string): string {
  return REGEXP_SPECIAL.has(char) ? `\\${char}` : char;
}
