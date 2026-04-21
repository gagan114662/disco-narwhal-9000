import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { spawn } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { getKairosStateDir, getKairosStatusPath, getKairosStdoutLogPath } from './paths.js'
import { runKairosWorker } from './worker.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-daemon-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

async function waitForPath(path: string, timeoutMs = 3_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      readFileSync(path)
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

  test('daemon main exits with code 0 on SIGTERM', async () => {
    const configDir = makeTempConfigDir()
    const daemonRoot = join(process.cwd(), 'daemon')
    const child = spawn(
      process.execPath,
      [
        '--eval',
        'import { daemonMain } from "./daemon/main.ts"; await daemonMain(["kairos"]);',
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
