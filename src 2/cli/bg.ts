/**
 * Stub for #68 burndown — `claude ps|logs|attach|kill` background session
 * management. Real impl is feature-gated behind `BG_SESSIONS`; this stub
 * satisfies the typechecker for external builds where the file is missing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function psHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function logsHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function attachHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function killHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function handleBgFlag(...args: any[]): Promise<any> {
  return undefined as any
}
