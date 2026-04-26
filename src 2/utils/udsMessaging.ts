/**
 * Stub for #68 burndown — Unix domain socket inbox server.
 * Real impl behind `UDS_INBOX` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function startUdsMessaging(..._args: any[]): Promise<any> {
  return undefined as any
}

export function getDefaultUdsSocketPath(..._args: any[]): string {
  return ''
}

export function setOnEnqueue(..._args: any[]): void {}
