import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  __resetKairosCloudLifecycleDepsForTesting,
  __setKairosCloudLifecycleDepsForTesting,
  runKairosCloudLifecycleCommand,
} from './cloudLifecycle.js'
import { getKairosCloudDeployStatePath } from './paths.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeDeployStateFile(body: object): void {
  const path = getKairosCloudDeployStatePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(body))
}

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = makeTempDir('kairos-cloud-lifecycle-config-')
})

afterEach(() => {
  __resetKairosCloudLifecycleDepsForTesting()
  delete process.env.CLAUDE_CONFIG_DIR
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY
  }
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('KAIROS cloud lifecycle command', () => {
  test('deploy stages the source bundle and persists target state', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const calls: Array<{ file: string; args: string[] }> = []

    __setKairosCloudLifecycleDepsForTesting({
      buildBundle: async () => ({
        version: 1,
        createdAt: '2026-04-22T12:00:00.000Z',
        files: [],
        projects: [],
      }),
      exec: async (file, args) => {
        calls.push({ file, args })
        return { stdout: '', stderr: '', code: 0 }
      },
      now: () => new Date('2026-04-22T12:05:00.000Z'),
    })

    const out = await runKairosCloudLifecycleCommand([
      'deploy',
      '--ssh-host',
      'root@example.com',
      '--anthropic-api-key-env',
      'ANTHROPIC_API_KEY',
      '--runtime-root',
      '/srv/kairos-cloud',
      '--service-name',
      'kairos-vps',
    ])

    expect(out).toContain('Cloud deploy complete.')
    expect(out).toContain('/etc/kairos-vps/kairos.env')
    expect(calls.map(call => call.file)).toEqual([
      'tar',
      'ssh',
      'scp',
      'ssh',
      'ssh',
    ])

    expect(readJson(getKairosCloudDeployStatePath())).toEqual({
      version: 1,
      sshHost: 'root@example.com',
      sshPort: 22,
      runtimeRoot: '/srv/kairos-cloud',
      serviceName: 'kairos-vps',
      authMode: 'api-key',
      updatedAt: '2026-04-22T12:05:00.000Z',
    })
  })

  test('deploy can use local Claude subscription auth without an API key env var', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    __setKairosCloudLifecycleDepsForTesting({
      buildBundle: async () => ({
        version: 1,
        createdAt: '2026-04-22T12:00:00.000Z',
        files: [],
        projects: [],
      }),
      exec: async (file, args) => {
        calls.push({ file, args })
        return { stdout: '', stderr: '', code: 0 }
      },
      getSubscriptionCredentials: () =>
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            expiresAt: 123,
            scopes: ['user:profile', 'user:inference'],
            subscriptionType: 'pro',
            rateLimitTier: 'pro',
          },
        }),
      now: () => new Date('2026-04-22T12:05:00.000Z'),
    })

    const out = await runKairosCloudLifecycleCommand([
      'deploy',
      '--ssh-host',
      'root@example.com',
    ])

    expect(out).toContain('Cloud deploy complete.')
    expect(out).toContain('Claude subscription OAuth')
    expect(readJson(getKairosCloudDeployStatePath())).toEqual({
      version: 1,
      sshHost: 'root@example.com',
      sshPort: 22,
      runtimeRoot: '/opt/kairos-cloud',
      serviceName: 'kairos-cloud',
      authMode: 'subscription',
      updatedAt: '2026-04-22T12:05:00.000Z',
    })
    expect(calls.map(call => call.file)).toEqual([
      'tar',
      'ssh',
      'scp',
      'ssh',
      'ssh',
    ])
  })

  test('upgrade can reuse the saved target without repeating ssh flags', async () => {
    writeDeployStateFile({
      version: 1,
      sshHost: 'root@example.com',
      sshPort: 2222,
      runtimeRoot: '/srv/kairos-cloud',
      serviceName: 'kairos-vps',
      authMode: 'api-key',
      updatedAt: '2026-04-22T12:05:00.000Z',
    })

    const calls: Array<{ file: string; args: string[] }> = []
    __setKairosCloudLifecycleDepsForTesting({
      buildBundle: async () => ({
        version: 1,
        createdAt: '2026-04-22T12:10:00.000Z',
        files: [],
        projects: [],
      }),
      exec: async (file, args) => {
        calls.push({ file, args })
        return { stdout: '', stderr: '', code: 0 }
      },
      now: () => new Date('2026-04-22T12:15:00.000Z'),
    })

    const out = await runKairosCloudLifecycleCommand(['upgrade'])
    expect(out).toContain('Cloud upgrade complete.')
    expect(out).toContain('host: root@example.com')
    expect(calls[1]?.args).toContain('2222')
  })

  test('destroy requires an explicit confirm flag', async () => {
    const out = await runKairosCloudLifecycleCommand(['destroy'])
    expect(out).toContain('Destroy requires --confirm.')
  })

  test('destroy removes saved target state and returns revocation guidance', async () => {
    writeDeployStateFile({
      version: 1,
      sshHost: 'root@example.com',
      sshPort: 22,
      runtimeRoot: '/srv/kairos-cloud',
      serviceName: 'kairos-vps',
      authMode: 'api-key',
      updatedAt: '2026-04-22T12:05:00.000Z',
    })

    __setKairosCloudLifecycleDepsForTesting({
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    })

    const out = await runKairosCloudLifecycleCommand(['destroy', '--confirm'])
    expect(out).toContain('Cloud destroy complete.')
    expect(out).toContain('credential revocation')
    expect(() => readFileSync(getKairosCloudDeployStatePath(), 'utf8')).toThrow()
  })
})
