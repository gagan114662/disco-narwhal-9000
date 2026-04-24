import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const TEMP_DIRS: string[] = []
const CLI_PATH = fileURLToPath(new URL('./cli.tsx', import.meta.url))
const SRC_ROOT = dirname(dirname(CLI_PATH))

function makeTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-cli-entrypoint-'))
  TEMP_DIRS.push(dir)
  return dir
}

async function runCli(args: string[]): Promise<{
  exitCode: number | null
  stdout: string
  stderr: string
}> {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    cwd: SRC_ROOT,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: makeTempConfigDir(),
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += String(chunk)
  })
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code))
  })

  return { exitCode, stdout, stderr }
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('CLI entrypoint', () => {
  test('routes the documented kairos status command', async () => {
    const result = await runCli(['kairos', 'status'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('daemon: not running')
    expect(result.stdout).toContain('paused: no')
    expect(result.stdout).toContain('projects: 0')
  })

  test('prints KAIROS help from the direct kairos command', async () => {
    const result = await runCli(['kairos'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('/kairos status')
    expect(result.stdout).toContain('/kairos cloud deploy')
  })

  test('reports daemon argument errors without a stack trace', async () => {
    const result = await runCli(['daemon'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown daemon subcommand: (none)')
    expect(result.stderr).not.toContain('\n    at ')
  })
})
