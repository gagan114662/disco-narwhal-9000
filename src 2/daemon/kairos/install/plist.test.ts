import { describe, expect, test } from 'bun:test'
import {
  buildKairosPlist,
  FORBIDDEN_PLIST_ENV_KEYS,
  getKairosPlistPath,
  getLaunchctlServiceTarget,
  KAIROS_LAUNCH_AGENT_LABEL,
  sanitizePlistEnv,
} from './plist.js'

describe('buildKairosPlist', () => {
  test('emits a valid plist header + required keys', () => {
    const xml = buildKairosPlist({
      program: '/usr/local/bin/claude',
      args: ['daemon', 'kairos'],
      stdoutPath: '/tmp/kairos.out',
      stderrPath: '/tmp/kairos.err',
      workingDirectory: '/Users/tester',
    })
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true)
    expect(xml).toContain('<!DOCTYPE plist PUBLIC')
    expect(xml).toContain('<plist version="1.0">')
    expect(xml).toContain(
      `<string>${KAIROS_LAUNCH_AGENT_LABEL}</string>`,
    )
    expect(xml).toContain('<string>/usr/local/bin/claude</string>')
    expect(xml).toContain('<string>daemon</string>')
    expect(xml).toContain('<string>kairos</string>')
    expect(xml).toContain('<key>RunAtLoad</key>')
    expect(xml).toContain('<key>KeepAlive</key>')
    expect(xml).toContain('<true/>')
    expect(xml).toContain('<key>ThrottleInterval</key>')
    // Keychain access requires a graphical (Aqua) session — pin it so
    // launchd won't start the agent in a background/ssh context where the
    // Keychain is locked.
    expect(xml).toContain('<key>LimitLoadToSessionType</key>')
    expect(xml).toContain('<string>Aqua</string>')
  })

  test('escapes XML metacharacters in program arguments', () => {
    const xml = buildKairosPlist({
      program: '/bin/echo',
      args: ['<script>', 'a&b', 'q"x'],
    })
    expect(xml).toContain('&lt;script&gt;')
    expect(xml).toContain('a&amp;b')
    expect(xml).toContain('q&quot;x')
    expect(xml).not.toContain('<script>')
  })

  test('always includes HOME and USER so child claude reads user Keychain', () => {
    const xml = buildKairosPlist({ program: '/bin/claude', args: [] })
    expect(xml).toContain('<key>EnvironmentVariables</key>')
    expect(xml).toContain('<key>HOME</key>')
    expect(xml).toContain('<key>USER</key>')
  })

  test('merges user-supplied env on top of HOME/USER defaults', () => {
    const xml = buildKairosPlist({
      program: '/bin/claude',
      args: [],
      env: { KAIROS_DEBUG: '1' },
    })
    expect(xml).toContain('<key>HOME</key>')
    expect(xml).toContain('<key>KAIROS_DEBUG</key>')
    expect(xml).toContain('<string>1</string>')
  })

  test('refuses to inline ANTHROPIC_API_KEY even when caller passes one', () => {
    const xml = buildKairosPlist({
      program: '/bin/claude',
      args: [],
      env: { ANTHROPIC_API_KEY: 'sk-leak-me', KAIROS_DEBUG: '1' },
    })
    expect(xml).not.toContain('ANTHROPIC_API_KEY')
    expect(xml).not.toContain('sk-leak-me')
    // Unrelated user env still lands in the plist.
    expect(xml).toContain('<key>KAIROS_DEBUG</key>')
  })

  test('runAtLoad=false emits <false/>', () => {
    const xml = buildKairosPlist({
      program: '/bin/claude',
      args: [],
      runAtLoad: false,
    })
    expect(xml).toContain('<key>RunAtLoad</key>\n    <false/>')
  })
})

describe('sanitizePlistEnv', () => {
  test('drops every forbidden auth key', () => {
    const input: Record<string, string> = { KEEP: 'ok' }
    for (const key of FORBIDDEN_PLIST_ENV_KEYS) {
      input[key] = 'SHOULD_BE_DROPPED'
    }
    const out = sanitizePlistEnv(input)
    for (const key of FORBIDDEN_PLIST_ENV_KEYS) {
      expect(out[key]).toBeUndefined()
    }
    expect(out.KEEP).toBe('ok')
  })
})

describe('paths', () => {
  test('getKairosPlistPath lives under ~/Library/LaunchAgents', () => {
    const plistPath = getKairosPlistPath('/Users/tester')
    expect(plistPath).toBe(
      `/Users/tester/Library/LaunchAgents/${KAIROS_LAUNCH_AGENT_LABEL}.plist`,
    )
  })

  test('getLaunchctlServiceTarget follows gui/<uid>/<label>', () => {
    expect(getLaunchctlServiceTarget(501)).toBe(
      `gui/501/${KAIROS_LAUNCH_AGENT_LABEL}`,
    )
  })
})
