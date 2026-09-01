/** Odds and ends that everything needs and nothing wants to own. */

/** "1 file" / "12 files". Pluralisation, the eternal chore. */
export function describeFileCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

/** Gets a message out of whatever was thrown. People throw strings. It happens. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pulls the URIs out of a dropped text/uri-list payload. */
export function parseUriListEntries(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
