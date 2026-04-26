/**
 * Stub for #68 burndown — `claude ssh <host>` session factory.
 *
 * Real impl deploys the binary, opens an SSH child process with a
 * unix-socket auth proxy reverse-tunnel, and hands the REPL an SSHSession
 * object. This stub satisfies the typechecker for builds where the file
 * is missing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SSHSession = any

export async function createSSHSession(..._args: any[]): Promise<any> {
  return undefined as any
}

export function createLocalSSHSession(..._args: any[]): any {
  return undefined as any
}

export class SSHSessionError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}
