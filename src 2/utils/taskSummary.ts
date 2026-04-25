/**
 * Stub for #68 burndown — periodic task summary (for `claude ps`).
 * Real impl loaded behind `BG_SESSIONS` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function shouldGenerateTaskSummary(..._args: any[]): boolean {
  return false
}

export function maybeGenerateTaskSummary(..._args: any[]): any {
  return undefined as any
}
