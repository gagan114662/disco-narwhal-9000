/**
 * Stub for #68 burndown — reactive compaction (413/media-too-large recovery).
 * Real impl loaded behind `REACTIVE_COMPACT` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function tryReactiveCompact(
  ..._args: any[]
): Promise<any | null> {
  return null
}

export function isWithheldPromptTooLong(..._args: any[]): boolean {
  return false
}
