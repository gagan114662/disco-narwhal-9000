import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { BrowserHarnessTool } from './BrowserHarnessTool.js'
import {
  BrowserHarnessError,
  DEFAULT_BROWSER_HARNESS_COMMAND,
  getBrowserHarnessSettings,
  resolveBrowserHarnessCommand,
  runBrowserHarnessScript,
} from './adapter.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeSettingsDir(settings: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'browser-harness-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}

describe('browser-harness adapter', () => {
  test('throws a clear error when integration is disabled', () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({})

    expect(() => getBrowserHarnessSettings()).toThrow(
      'Browser Harness integration is not enabled. Set `browserHarness.enabled` to `true` in your settings after installing https://github.com/browser-use/browser-harness.',
    )
  })

  test('throws when the browser-harness executable cannot be located', () => {
    const whichImpl = mock((_: string) => null)

    expect(() =>
      resolveBrowserHarnessCommand(
        { enabled: true },
        { whichSync: whichImpl },
      ),
    ).toThrow(BrowserHarnessError)
    expect(whichImpl).toHaveBeenCalledWith(DEFAULT_BROWSER_HARNESS_COMMAND)
  })

  test('uses configured command when overridden in settings', () => {
    const whichImpl = mock((cmd: string) =>
      cmd === '/opt/bin/my-harness' ? '/opt/bin/my-harness' : null,
    )

    const resolved = resolveBrowserHarnessCommand(
      { enabled: true, command: '/opt/bin/my-harness' },
      { whichSync: whichImpl },
    )

    expect(resolved).toBe('/opt/bin/my-harness')
    expect(whichImpl).toHaveBeenCalledWith('/opt/bin/my-harness')
  })

  test('spawns browser-harness with the script on stdin on the happy path', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({
      browserHarness: {
        enabled: true,
        env: { BU_NAME: 'test-session' },
        timeoutMs: 30_000,
      },
    })

    const execImpl = mock(
      async (
        file: string,
        args: string[],
        options: {
          useCwd?: boolean
          timeout?: number
          stdin?: string
          input?: string
          env?: NodeJS.ProcessEnv
        },
      ) => {
        expect(file).toBe('/usr/local/bin/browser-harness')
        expect(args).toEqual([])
        expect(options.useCwd).toBe(false)
        expect(options.timeout).toBe(30_000)
        expect(options.stdin).toBe('pipe')
        expect(options.input).toBe('print(page_info())\n')
        expect(options.env?.BU_NAME).toBe('test-session')
        return {
          stdout: '{"url": "https://example.com"}',
          stderr: '',
          code: 0,
        }
      },
    )

    const result = await runBrowserHarnessScript(
      { script: 'print(page_info())\n' },
      {
        whichSync: () => '/usr/local/bin/browser-harness',
        execFileNoThrow: execImpl,
      },
    )

    expect(execImpl).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"url": "https://example.com"}')
    expect(result.command).toBe('/usr/local/bin/browser-harness')
  })

  test('reports failure details when the harness exits non-zero', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({
      browserHarness: { enabled: true },
    })

    const execImpl = mock(async () => ({
      stdout: '',
      stderr: 'Traceback: harness daemon not attached',
      code: 1,
    }))

    const result = await runBrowserHarnessScript(
      { script: 'goto("https://example.com")\n' },
      {
        whichSync: () => '/usr/local/bin/browser-harness',
        execFileNoThrow: execImpl,
      },
    )

    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('harness daemon not attached')
    expect(result.error).toContain('exited with code 1')
  })

  test('rejects an empty script before invoking the CLI', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({
      browserHarness: { enabled: true },
    })

    const execImpl = mock(async () => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))

    await expect(
      runBrowserHarnessScript(
        { script: '   ' },
        {
          whichSync: () => '/usr/local/bin/browser-harness',
          execFileNoThrow: execImpl,
        },
      ),
    ).rejects.toThrow('`script` must be a non-empty Python payload')
    expect(execImpl).not.toHaveBeenCalled()
  })
})

describe('BrowserHarnessTool', () => {
  test('returns a failure result with setup guidance when disabled', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({})

    const result = await BrowserHarnessTool.call(
      { script: 'print(page_info())' },
      // BuildTool.call accepts an optional context; tests pass undefined via cast.
      // @ts-expect-error — test-only invocation without tool context
      undefined,
    )

    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain(
      'Browser Harness integration is not enabled',
    )
    expect(result.data.message).toContain(
      'Browser Harness integration is not enabled',
    )
  })

  test('rejects an empty script via validateInput', async () => {
    const validation = await BrowserHarnessTool.validateInput!(
      { script: '   ' },
      // @ts-expect-error — test-only invocation without tool context
      undefined,
    )

    expect(validation.result).toBe(false)
    if (validation.result === false) {
      expect(validation.message).toContain('non-empty')
    }
  })
})
