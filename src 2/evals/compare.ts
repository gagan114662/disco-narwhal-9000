import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deserializeTrace } from './serialize.js'
import type { DiffEntry, IgnoredFieldPath, Trace } from './types.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_IGNORED_FIELDS_PATH = resolve(MODULE_DIR, 'ignored-fields.json')

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldIgnorePath(
  path: string[],
  ignoredPaths: IgnoredFieldPath[],
): boolean {
  return ignoredPaths.some(ignoredPath => {
    if (ignoredPath.length > path.length) {
      return false
    }

    return ignoredPath.every((segment, index) => segment === path[index])
  })
}

export function loadIgnoredFieldPaths(
  ignoredFieldsPath = DEFAULT_IGNORED_FIELDS_PATH,
): IgnoredFieldPath[] {
  if (!existsSync(ignoredFieldsPath)) {
    return []
  }

  const parsed = JSON.parse(readFileSync(ignoredFieldsPath, 'utf8')) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('ignored-fields.json must be an array of path arrays')
  }

  return parsed.map((entry, index) => {
    if (!Array.isArray(entry) || !entry.every(segment => typeof segment === 'string')) {
      throw new Error(
        `ignored-fields.json entry ${index} must be an array of strings`,
      )
    }
    return entry
  })
}

function compareValues(
  expected: unknown,
  actual: unknown,
  path: string[],
  ignoredPaths: IgnoredFieldPath[],
  diffs: DiffEntry[],
): void {
  if (shouldIgnorePath(path, ignoredPaths)) {
    return
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const maxLength = Math.max(expected.length, actual.length)
    for (let index = 0; index < maxLength; index += 1) {
      const nextPath = [...path, String(index)]
      if (index >= expected.length) {
        if (!shouldIgnorePath(nextPath, ignoredPaths)) {
          diffs.push({
            path: nextPath,
            kind: 'extra',
            actual: actual[index],
          })
        }
        continue
      }
      if (index >= actual.length) {
        if (!shouldIgnorePath(nextPath, ignoredPaths)) {
          diffs.push({
            path: nextPath,
            kind: 'missing',
            expected: expected[index],
          })
        }
        continue
      }
      compareValues(expected[index], actual[index], nextPath, ignoredPaths, diffs)
    }
    return
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of Array.from(keys).sort()) {
      const nextPath = [...path, key]
      if (!(key in actual)) {
        if (!shouldIgnorePath(nextPath, ignoredPaths)) {
          diffs.push({
            path: nextPath,
            kind: 'missing',
            expected: expected[key],
          })
        }
        continue
      }
      if (!(key in expected)) {
        if (!shouldIgnorePath(nextPath, ignoredPaths)) {
          diffs.push({
            path: nextPath,
            kind: 'extra',
            actual: actual[key],
          })
        }
        continue
      }
      compareValues(expected[key], actual[key], nextPath, ignoredPaths, diffs)
    }
    return
  }

  if (expected !== actual) {
    diffs.push({
      path,
      kind: 'changed',
      expected,
      actual,
    })
  }
}

export function compareTraces(
  expected: Trace,
  actual: Trace,
  options?: {
    ignoredPaths?: IgnoredFieldPath[]
    ignoredFieldsPath?: string
  },
): DiffEntry[] {
  const ignoredPaths =
    options?.ignoredPaths ?? loadIgnoredFieldPaths(options?.ignoredFieldsPath)
  const diffs: DiffEntry[] = []
  compareValues(expected, actual, [], ignoredPaths, diffs)
  return diffs
}

export function compareSerializedTraces(
  expected: string,
  actual: string,
  options?: {
    ignoredPaths?: IgnoredFieldPath[]
    ignoredFieldsPath?: string
  },
): DiffEntry[] {
  return compareTraces(
    deserializeTrace(expected),
    deserializeTrace(actual),
    options,
  )
}
