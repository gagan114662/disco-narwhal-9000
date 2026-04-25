/**
 * Stub for #68 burndown — inter-Claude session message bus (`claude://`).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function postInterClaudeMessage(
  ..._args: any[]
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'peerSessions stub' } as any
}
