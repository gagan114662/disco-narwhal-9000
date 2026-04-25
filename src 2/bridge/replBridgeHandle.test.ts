import { afterEach, describe, expect, test } from 'bun:test'
import {
  getReplBridgeHandle,
  isReplBridgeActive,
  setReplBridgeHandle,
} from './replBridgeHandle.js'
import type { ReplBridgeHandle } from './replBridge.js'

afterEach(() => {
  setReplBridgeHandle(null)
})

function makeHandle(): ReplBridgeHandle {
  return {
    bridgeSessionId: 'sess_test',
    environmentId: 'env_test',
    sessionIngressUrl: 'https://example.invalid/ingress',
    writeMessages: () => {},
    writeSdkMessages: () => {},
    sendControlRequest: () => {},
    sendControlResponse: () => {},
    sendControlCancelRequest: () => {},
    sendResult: () => {},
    teardown: async () => {},
  }
}

describe('replBridgeHandle', () => {
  test('isReplBridgeActive() returns false when no handle is registered', () => {
    setReplBridgeHandle(null)
    expect(getReplBridgeHandle()).toBeNull()
    expect(isReplBridgeActive()).toBe(false)
  })

  test('isReplBridgeActive() returns true after a handle is registered', () => {
    setReplBridgeHandle(makeHandle())
    expect(getReplBridgeHandle()).not.toBeNull()
    expect(isReplBridgeActive()).toBe(true)
  })

  test('isReplBridgeActive() flips back to false on teardown', () => {
    setReplBridgeHandle(makeHandle())
    expect(isReplBridgeActive()).toBe(true)
    setReplBridgeHandle(null)
    expect(isReplBridgeActive()).toBe(false)
  })

  // Regression for the import-graph bug discovered by `bun test --coverage`.
  // SendMessageTool.ts and ToolSearchTool/prompt.ts had been importing
  // isReplBridgeActive from bootstrap/state.js, which never exported it.
  // Plain bun test tolerated the unresolved name because the symbol was
  // never accessed at runtime in the test suite; coverage instrumentation
  // resolved it eagerly and threw `Export named 'isReplBridgeActive' not
  // found in module .../bootstrap/state.ts`. This test pulls both call
  // sites' modules into the import graph so that a regression (re-pointing
  // the import at the wrong module, or removing the export) blocks plain
  // `bun test` too — not just coverage runs.
  test('regression: callers can resolve isReplBridgeActive from this module', async () => {
    const sendMessageTool = await import(
      '../tools/SendMessageTool/SendMessageTool.js'
    )
    expect(sendMessageTool).toBeDefined()
    const toolSearchPrompt = await import('../tools/ToolSearchTool/prompt.js')
    expect(toolSearchPrompt).toBeDefined()
  })
})
