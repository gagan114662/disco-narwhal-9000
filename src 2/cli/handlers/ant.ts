/**
 * Stub for #68 burndown — ant CLI handlers.
 *
 * Real handlers are loaded only in ant builds; this stub satisfies the
 * typechecker for external builds where the file is missing.
 *
 * Each handler is a permissive async function returning any. Do not import
 * from this module at runtime in non-ant code paths — the actual file is
 * code-split via dynamic import() and only loaded when feature('ANT_*') is
 * true.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function logHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function errorHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function exportHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function taskCreateHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function taskListHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function taskGetHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function taskUpdateHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function taskDirHandler(...args: any[]): Promise<any> {
  return undefined as any
}

export async function completionHandler(...args: any[]): Promise<any> {
  return undefined as any
}
