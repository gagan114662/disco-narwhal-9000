/**
 * Stub for #68 burndown — server logger factory.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function createServerLogger(..._args: any[]): any {
  return {
    info(..._a: any[]): void {},
    warn(..._a: any[]): void {},
    error(..._a: any[]): void {},
    debug(..._a: any[]): void {},
  } as any
}
