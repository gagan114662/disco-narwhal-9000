import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
import type { ReplBridgeHandle } from './replBridge.js'
import { toCompatSessionId } from './sessionIdCompat.js'

/**
 * Global pointer to the active REPL bridge handle, so callers outside
 * useReplBridge's React tree (tools, slash commands) can invoke handle methods
 * like subscribePR. Same one-bridge-per-process justification as bridgeDebug.ts
 * — the handle's closure captures the sessionId and getAccessToken that created
 * the session, and re-deriving those independently (BriefTool/upload.ts pattern)
 * risks staging/prod token divergence.
 *
 * Set from useReplBridge.tsx when init completes; cleared on teardown.
 */

let handle: ReplBridgeHandle | null = null

export function setReplBridgeHandle(h: ReplBridgeHandle | null): void {
  handle = h
  // Publish (or clear) our bridge session ID in the session record so other
  // local peers can dedup us out of their bridge list — local is preferred.
  void updateSessionBridgeId(getSelfBridgeCompatId() ?? null).catch(() => {})
}

export function getReplBridgeHandle(): ReplBridgeHandle | null {
  return handle
}

/**
 * True when a REPL bridge handle is registered. SendMessageTool and
 * ToolSearchTool use this to gate inter-Claude messaging on a live bridge.
 *
 * Historically the two callers imported this name from bootstrap/state.js
 * but the export never existed there, so plain `bun test` silently tolerated
 * the unresolved name. Coverage instrumentation walks the import graph
 * eagerly and surfaced the missing export as a SyntaxError. This is the
 * canonical home for the function — the handle lives in this module, so
 * keeping the predicate next to it removes a cross-module surprise.
 *
 * Outbound-only (CCR mirror) rejection is NOT enforced here yet; the comment
 * at the call sites describes the intent, but ReplBridgeHandle does not
 * currently expose the mode. Wiring that through is a follow-up.
 */
export function isReplBridgeActive(): boolean {
  return handle !== null
}

/**
 * Our own bridge session ID in the session_* compat format the API returns
 * in /v1/sessions responses — or undefined if bridge isn't connected.
 */
export function getSelfBridgeCompatId(): string | undefined {
  const h = getReplBridgeHandle()
  return h ? toCompatSessionId(h.bridgeSessionId) : undefined
}
