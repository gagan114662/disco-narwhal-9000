import { describe, expect, test } from 'bun:test'
import { resolveCanonicalClaude } from './install.js'

describe('resolveCanonicalClaude', () => {
  test('prefers CLAUDE_BIN env override', async () => {
    const result = await resolveCanonicalClaude({
      env: { CLAUDE_BIN: '/opt/claude/bin/claude' },
      which: async () => '/usr/local/bin/claude',
    })
    expect(result.program).toBe('/opt/claude/bin/claude')
    expect(result.args).toEqual(['daemon', 'kairos'])
  })

  test('falls back to which(claude) when no env override', async () => {
    const result = await resolveCanonicalClaude({
      env: {},
      which: async name => (name === 'claude' ? '/usr/local/bin/claude' : null),
    })
    expect(result.program).toBe('/usr/local/bin/claude')
    expect(result.args).toEqual(['daemon', 'kairos'])
  })

  test('falls back to current runtime when claude is not on PATH', async () => {
    const result = await resolveCanonicalClaude({
      env: {},
      which: async () => null,
    })
    expect(result.program).toBe(process.execPath)
    // args[0] should be the currently-running entrypoint (or empty shape).
    expect(result.args[result.args.length - 2]).toBe('daemon')
    expect(result.args[result.args.length - 1]).toBe('kairos')
  })
})
