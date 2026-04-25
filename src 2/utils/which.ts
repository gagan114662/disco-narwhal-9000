import { execa } from 'execa'
import {
  accessSync,
  constants as fsConstants,
} from 'fs'
import { access } from 'fs/promises'
import { delimiter, join } from 'path'
import { execSync_DEPRECATED } from './execSyncWrapper.js'

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com']

function getPathCandidates(command: string): string[] {
  if (command.includes('/') || command.includes('\\')) {
    return [command]
  }

  const pathDirs = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
  const baseCandidates = pathDirs.map(dir => join(dir, command))

  if (process.platform !== 'win32' || /\.[^\\/]+$/.test(command)) {
    return baseCandidates
  }

  return baseCandidates.flatMap(candidate => [
    candidate,
    ...WINDOWS_EXECUTABLE_EXTENSIONS.map(ext => `${candidate}${ext}`),
  ])
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function isExecutableSync(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function whichFromCurrentPath(command: string): Promise<string | null> {
  for (const candidate of getPathCandidates(command)) {
    if (await isExecutable(candidate)) {
      return candidate
    }
  }
  return null
}

function whichFromCurrentPathSync(command: string): string | null {
  for (const candidate of getPathCandidates(command)) {
    if (isExecutableSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function whichNodeAsync(command: string): Promise<string | null> {
  if (process.platform === 'win32') {
    // On Windows, use where.exe and return the first result
    const result = await execa(`where.exe ${command}`, {
      shell: true,
      stderr: 'ignore',
      reject: false,
    })
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    // where.exe returns multiple paths separated by newlines, return the first
    return result.stdout.trim().split(/\r?\n/)[0] || null
  }

  // On POSIX systems (macOS, Linux, WSL), use which
  // Cross-platform safe: Windows is handled above
  // eslint-disable-next-line custom-rules/no-cross-platform-process-issues
  const result = await execa(`which ${command}`, {
    shell: true,
    stderr: 'ignore',
    reject: false,
  })
  if (result.exitCode !== 0 || !result.stdout) {
    return null
  }
  return result.stdout.trim()
}

function whichNodeSync(command: string): string | null {
  if (process.platform === 'win32') {
    try {
      const result = execSync_DEPRECATED(`where.exe ${command}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const output = result.toString().trim()
      return output.split(/\r?\n/)[0] || null
    } catch {
      return null
    }
  }

  try {
    const result = execSync_DEPRECATED(`which ${command}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return result.toString().trim() || null
  } catch {
    return null
  }
}

const bunWhich =
  typeof Bun !== 'undefined' && typeof Bun.which === 'function'
    ? Bun.which
    : null

/**
 * Finds the full path to a command executable.
 * Uses Bun.which when running in Bun (fast, no process spawn),
 * otherwise spawns the platform-appropriate command.
 *
 * @param command - The command name to look up
 * @returns The full path to the command, or null if not found
 */
export const which: (command: string) => Promise<string | null> = bunWhich
  ? async command => (await whichFromCurrentPath(command)) ?? bunWhich(command)
  : whichNodeAsync

/**
 * Synchronous version of `which`.
 *
 * @param command - The command name to look up
 * @returns The full path to the command, or null if not found
 */
export const whichSync: (command: string) => string | null =
  bunWhich
    ? command => whichFromCurrentPathSync(command) ?? bunWhich(command)
    : whichNodeSync
