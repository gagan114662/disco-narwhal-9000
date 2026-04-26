/**
 * Stub for #68 burndown — server-side session lifecycle manager.
 * Real impl loaded only when the serve subcommand is invoked.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export class SessionManager {
  constructor(..._args: any[]) {}
  async destroyAll(): Promise<any> {
    return undefined as any
  }
}
