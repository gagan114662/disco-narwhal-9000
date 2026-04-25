import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BROWSER_HARNESS_ENABLE_ENV,
  BROWSER_HARNESS_PATH_ENV,
  resolveBrowserHarnessCommand,
  shouldEnableBrowserHarness,
} from './browserHarness.js'

const ORIGINAL_ENABLE = process.env[BROWSER_HARNESS_ENABLE_ENV]
const ORIGINAL_PATH = process.env[BROWSER_HARNESS_PATH_ENV]
const ORIGINAL_SYSTEM_PATH = process.env.PATH
const TEMP_DIRS: string[] = []

afterEach(() => {
  process.env[BROWSER_HARNESS_ENABLE_ENV] = ORIGINAL_ENABLE
  process.env[BROWSER_HARNESS_PATH_ENV] = ORIGINAL_PATH
  process.env.PATH = ORIGINAL_SYSTEM_PATH

  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'browser-harness-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function makeExecutable(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n', 'utf8')
  chmodSync(path, 0o755)
  return path
}

describe('shouldEnableBrowserHarness', () => {
  test('defaults to disabled', () => {
    delete process.env[BROWSER_HARNESS_ENABLE_ENV]
    expect(shouldEnableBrowserHarness()).toBe(false)
  })

  test('accepts truthy env values', () => {
    process.env[BROWSER_HARNESS_ENABLE_ENV] = '1'
    expect(shouldEnableBrowserHarness()).toBe(true)
  })

  test('accepts explicit falsy env values', () => {
    process.env[BROWSER_HARNESS_ENABLE_ENV] = 'false'
    expect(shouldEnableBrowserHarness()).toBe(false)
  })
})

describe('resolveBrowserHarnessCommand', () => {
  test('prefers an explicit executable path override', async () => {
    const dir = makeTempDir()
    const executable = makeExecutable(dir, 'browser-harness')
    process.env[BROWSER_HARNESS_PATH_ENV] = executable

    await expect(resolveBrowserHarnessCommand()).resolves.toBe(executable)
  })

  test('returns null when the explicit path override is missing', async () => {
    process.env[BROWSER_HARNESS_PATH_ENV] = '/tmp/does-not-exist-browser-harness'

    await expect(resolveBrowserHarnessCommand()).resolves.toBeNull()
  })

  test('falls back to PATH lookup when no override is configured', async () => {
    const dir = makeTempDir()
    makeExecutable(dir, 'browser-harness')
    delete process.env[BROWSER_HARNESS_PATH_ENV]
    process.env.PATH = [dir, ORIGINAL_SYSTEM_PATH].filter(Boolean).join(':')

    const resolved = await resolveBrowserHarnessCommand()
    expect(resolved).not.toBeNull()
    expect(resolved!.endsWith('/browser-harness')).toBe(true)
  })
})
