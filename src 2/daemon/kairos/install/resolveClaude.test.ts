import { describe, expect, test } from 'bun:test'
import { resolveCanonicalClaude } from './install.js'

const noopAssert = async () => {}

describe('resolveCanonicalClaude', () => {
  test('prefers CLAUDE_BIN env override', async () => {
    const result = await resolveCanonicalClaude({
      env: { CLAUDE_BIN: '/opt/claude/bin/claude' },
      which: async () => '/usr/local/bin/claude',
      assertExecutable: noopAssert,
    })
    expect(result.program).toBe('/opt/claude/bin/claude')
    expect(result.args).toEqual(['daemon', 'kairos'])
  })

  test('falls back to which(claude) when no env override', async () => {
    const result = await resolveCanonicalClaude({
      env: {},
      which: async name => (name === 'claude' ? '/usr/local/bin/claude' : null),
      assertExecutable: noopAssert,
    })
    expect(result.program).toBe('/usr/local/bin/claude')
    expect(result.args).toEqual(['daemon', 'kairos'])
  })

  test('falls back to current runtime when claude is not on PATH', async () => {
    const result = await resolveCanonicalClaude({
      env: {},
      which: async () => null,
      assertExecutable: noopAssert,
    })
    expect(result.program).toBe(process.execPath)
    // args[0] should be the currently-running entrypoint (or empty shape).
    expect(result.args[result.args.length - 2]).toBe('daemon')
    expect(result.args[result.args.length - 1]).toBe('kairos')
  })

  test('throws a clear error when CLAUDE_BIN points at a non-executable path', async () => {
    // Fails fast before the launchd agent crash-loops through
    // ThrottleInterval on a typo'd CLAUDE_BIN.
    await expect(
      resolveCanonicalClaude({
        env: { CLAUDE_BIN: '/opt/does/not/exist/claude' },
        which: async () => '/usr/local/bin/claude',
        assertExecutable: async path => {
          throw new Error(`not executable: ${path}`)
        },
      }),
    ).rejects.toThrow(/not executable/)
  })

  test('does NOT validate the which(claude) result (trusts PATH)', async () => {
    // Only CLAUDE_BIN is validated — paths from `which` are already an
    // OS-level existence signal.
    const calls: string[] = []
    const result = await resolveCanonicalClaude({
      env: {},
      which: async () => '/usr/local/bin/claude',
      assertExecutable: async path => {
        calls.push(path)
      },
    })
    expect(result.program).toBe('/usr/local/bin/claude')
    expect(calls).toEqual([])
  })
})
