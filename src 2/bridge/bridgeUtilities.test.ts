import { describe, expect, test } from 'bun:test'
import { validateBridgeId } from './bridgeApi.js'
import {
  abbreviateActivity,
  computeShimmerSegments,
  getBridgeStatus,
} from './bridgeStatusUtil.js'
import { safeFilenameId } from './sessionRunner.js'

describe('bridge utilities', () => {
  test('rejects unsafe bridge ids and sanitizes file-safe ids', () => {
    expect(validateBridgeId('env_123-abc', 'environmentId')).toBe('env_123-abc')
    expect(() => validateBridgeId('../oops', 'environmentId')).toThrow(
      /unsafe characters/,
    )
    expect(() => validateBridgeId('bad/slash', 'environmentId')).toThrow(
      /unsafe characters/,
    )

    expect(safeFilenameId('../session/one')).toBe('___session_one')
    expect(safeFilenameId('session:prod?42')).toBe('session_prod_42')
  })

  test('derives bridge status with the expected priority order', () => {
    expect(
      getBridgeStatus({
        error: 'boom',
        connected: true,
        sessionActive: true,
        reconnecting: true,
      }),
    ).toEqual({ label: 'Remote Control failed', color: 'error' })

    expect(
      getBridgeStatus({
        error: undefined,
        connected: true,
        sessionActive: false,
        reconnecting: true,
      }),
    ).toEqual({ label: 'Remote Control reconnecting', color: 'warning' })

    expect(
      getBridgeStatus({
        error: undefined,
        connected: false,
        sessionActive: true,
        reconnecting: false,
      }),
    ).toEqual({ label: 'Remote Control active', color: 'success' })
  })

  test('splits shimmer segments without losing the original text', () => {
    const text = 'Read file 😀 done'
    const segments = computeShimmerSegments(text, 5)

    expect(segments.before + segments.shimmer + segments.after).toBe(text)
    expect(segments.shimmer.length).toBeGreaterThan(0)
  })

  test('abbreviates long activity summaries for the bridge trail', () => {
    const abbreviated = abbreviateActivity(
      'Running a very long command that should be shortened for the footer',
    )

    expect(abbreviated.length).toBeLessThanOrEqual(30)
    expect(abbreviated).toContain('Running')
  })
})
