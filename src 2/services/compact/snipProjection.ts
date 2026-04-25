/**
 * Stub for #68 burndown — snip-history projection (history-snip read view).
 * Real impl loaded behind `HISTORY_SNIP` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function isSnipBoundaryMessage(_message: any): boolean {
  return false
}

export function projectSnippedView<T = any>(messages: T[]): T[] {
  return messages
}
