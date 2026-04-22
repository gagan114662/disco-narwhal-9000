import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installKairosLaunchAgent } from './install.js'
import { uninstallKairosLaunchAgent } from './uninstall.js'
import {
  KAIROS_LAUNCH_AGENT_LABEL,
  getLaunchctlServiceTarget,
} from './plist.js'

const TEMP_DIRS: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-install-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('installKairosLaunchAgent', () => {
  test('writes a plist and invokes bootstrap + enable', async () => {
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)
    const calls: string[][] = []

    const result = await installKairosLaunchAgent({
      plistPath,
      uid: 501,
      plistInputs: {
        program: '/usr/local/bin/claude',
        args: ['daemon', 'kairos'],
      },
      launchctl: async args => {
        calls.push([...args])
        return { stdout: '', stderr: '' }
      },
    })

    expect(result.plistPath).toBe(plistPath)
    expect(result.target).toBe(getLaunchctlServiceTarget(501))
    expect(existsSync(plistPath)).toBe(true)

    const xml = readFileSync(plistPath, 'utf8')
    expect(xml).toContain(`<string>${KAIROS_LAUNCH_AGENT_LABEL}</string>`)
    expect(xml).toContain('<string>/usr/local/bin/claude</string>')

    expect(calls[0]).toEqual(['bootout', `gui/501/${KAIROS_LAUNCH_AGENT_LABEL}`])
    expect(calls[1]).toEqual([
      'bootstrap',
      'gui/501',
      plistPath,
    ])
    expect(calls[2]).toEqual(['enable', `gui/501/${KAIROS_LAUNCH_AGENT_LABEL}`])
  })

  test('ignores bootout errors on first install (idempotent re-install)', async () => {
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)
    const calls: string[][] = []

    await installKairosLaunchAgent({
      plistPath,
      uid: 501,
      plistInputs: {
        program: '/usr/local/bin/claude',
        args: ['daemon', 'kairos'],
      },
      launchctl: async args => {
        calls.push([...args])
        if (args[0] === 'bootout') {
          throw new Error('Service not loaded')
        }
        return { stdout: '', stderr: '' }
      },
    })

    expect(calls.map(c => c[0])).toEqual(['bootout', 'bootstrap', 'enable'])
    expect(existsSync(plistPath)).toBe(true)
  })

  test('bootstrap failure leaves plist on disk (converges on retry)', async () => {
    // If the sequence is bootout → write → bootstrap and bootstrap throws,
    // the plist written to disk should reflect the NEW intent so that a
    // subsequent install retry picks up where we left off without the
    // caller having to re-specify the arguments.
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)

    await expect(
      installKairosLaunchAgent({
        plistPath,
        uid: 501,
        plistInputs: {
          program: '/usr/local/bin/claude',
          args: ['daemon', 'kairos'],
        },
        launchctl: async args => {
          if (args[0] === 'bootstrap') {
            throw new Error('bootstrap: permission denied')
          }
          return { stdout: '', stderr: '' }
        },
      }),
    ).rejects.toThrow(/bootstrap/)

    // Plist MUST be on disk with the new config so a retry works.
    expect(existsSync(plistPath)).toBe(true)
    const xml = readFileSync(plistPath, 'utf8')
    expect(xml).toContain('<string>/usr/local/bin/claude</string>')
  })
})

describe('uninstallKairosLaunchAgent', () => {
  test('boots out and removes the plist', async () => {
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)
    writeFileSync(plistPath, '<plist/>')
    const calls: string[][] = []

    const result = await uninstallKairosLaunchAgent({
      plistPath,
      uid: 501,
      launchctl: async args => {
        calls.push([...args])
        return { stdout: '', stderr: '' }
      },
    })

    expect(result.removed).toBe(true)
    expect(existsSync(plistPath)).toBe(false)
    expect(calls[0]).toEqual(['bootout', `gui/501/${KAIROS_LAUNCH_AGENT_LABEL}`])
  })

  test('is safe to run when plist does not exist', async () => {
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)

    const result = await uninstallKairosLaunchAgent({
      plistPath,
      uid: 501,
      launchctl: async () => ({ stdout: '', stderr: '' }),
    })

    expect(result.removed).toBe(false)
    expect(existsSync(plistPath)).toBe(false)
  })

  test('ignores bootout failures', async () => {
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)
    writeFileSync(plistPath, '<plist/>')

    const result = await uninstallKairosLaunchAgent({
      plistPath,
      uid: 501,
      launchctl: async () => {
        throw new Error('Service not loaded')
      },
    })

    expect(result.removed).toBe(true)
    expect(existsSync(plistPath)).toBe(false)
  })
})

describe('install + uninstall round trip', () => {
  test('install, then uninstall leaves no plist behind', async () => {
    const dir = makeTempDir()
    const plistPath = join(dir, `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)
    mkdirSync(dir, { recursive: true })
    const runner = async () => ({ stdout: '', stderr: '' })

    await installKairosLaunchAgent({
      plistPath,
      uid: 501,
      plistInputs: {
        program: '/usr/local/bin/claude',
        args: ['daemon', 'kairos'],
      },
      launchctl: runner,
    })
    expect(existsSync(plistPath)).toBe(true)

    const result = await uninstallKairosLaunchAgent({
      plistPath,
      uid: 501,
      launchctl: runner,
    })
    expect(result.removed).toBe(true)
    expect(existsSync(plistPath)).toBe(false)
  })
})
