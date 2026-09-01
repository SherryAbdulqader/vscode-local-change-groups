/** Small shared text helpers used across layers. */

/** Describes a file count for log lines, prompts, and badges. */
export function describeFileCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

/** Converts unknown thrown values into concise messages. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses the standard newline-separated uri-list payload into raw entries. */
export function parseUriListEntries(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
