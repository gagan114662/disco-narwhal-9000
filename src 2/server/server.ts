/**
 * Stub for #68 burndown — `claude serve` HTTP/Unix server entrypoint.
 * Real impl loaded only when the serve subcommand is invoked.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function startServer(...args: any[]): any {
  return {
    port: 0,
    stop(_force?: boolean): void {},
  } as any
}
