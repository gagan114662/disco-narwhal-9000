import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { getKairosStateDir, getKairosStatusPath, getKairosStdoutLogPath, getKairosToolsSocketPath } from './paths.js'
import { runKairosWorker } from './worker.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

const TEMP_DIRS: string[] = []
const DAEMON_MAIN_URL = new URL('../main.ts', import.meta.url).href

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-daemon-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

async function waitForPath(path: string, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      statSync(path)
      return
    } catch {
      await Bun.sleep(50)
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

describe('Kairos daemon worker', () => {
  test('writes state files and shuts down cleanly when aborted', async () => {
    const configDir = makeTempConfigDir()
    process.env.CLAUDE_CONFIG_DIR = configDir

    const controller = new AbortController()
    const stdoutChunks: string[] = []

    const running = runKairosWorker({
      signal: controller.signal,
      stdout: {
        write(chunk: string) {
          stdoutChunks.push(chunk)
          return true
        },
      },
      pid: 12345,
      now: (() => {
        let tick = 0
        return () => new Date(Date.UTC(2026, 3, 21, 12, 0, tick++))
      })(),
    })

    await waitForPath(getKairosStatusPath())
    controller.abort()

    const exitCode = await running
    expect(exitCode).toBe(0)
    expect(getKairosStateDir()).toBe(join(configDir, 'kairos'))

    const status = JSON.parse(readFileSync(getKairosStatusPath(), 'utf8'))
    expect(status).toMatchObject({
      kind: 'kairos',
      state: 'stopped',
      pid: 12345,
    })

    const log = readFileSync(getKairosStdoutLogPath(), 'utf8')
    expect(log).toContain('startup complete; entering idle loop')
    expect(log).toContain('shutdown requested; exiting cleanly')
    expect(stdoutChunks.join('')).toContain('startup complete; entering idle loop')
  })

  test('creates the rpc socket when kairos.rpc.enabled is true', async () => {
    const configDir = makeTempConfigDir()
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const controller = new AbortController()
    const running = runKairosWorker({ signal: controller.signal })

    await waitForPath(getKairosToolsSocketPath())
    controller.abort()
    expect(await running).toBe(0)
  })

  test('daemon main exits with code 0 on SIGTERM', async () => {
    const configDir = makeTempConfigDir()
    const child = spawn(
      process.execPath,
      [
        '--eval',
        `import { daemonMain } from ${JSON.stringify(DAEMON_MAIN_URL)}; await daemonMain(["kairos"], { dashboard: { port: 0 } });`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: configDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })

    await waitForPath(join(configDir, 'kairos', 'status.json'))
    child.kill('SIGTERM')

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code))
    })

    expect(exitCode).toBe(0)
    expect(stdout).toContain('startup complete; entering idle loop')

    const log = readFileSync(join(configDir, 'kairos', 'daemon.out.log'), 'utf8')
    expect(log).toContain('shutdown requested; exiting cleanly')
  })
})
