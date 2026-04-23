import type { Trace } from './types.js'

type StableJsonValue =
  | null
  | boolean
  | number
  | string
  | StableJsonValue[]
  | { [key: string]: StableJsonValue }

function toStableJsonValue(value: unknown): StableJsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value as StableJsonValue
  }

  if (Array.isArray(value)) {
    return value.map(item => toStableJsonValue(item))
  }

  if (typeof value === 'object') {
    const result: { [key: string]: StableJsonValue } = {}
    for (const key of Object.keys(value).sort()) {
      result[key] = toStableJsonValue((value as Record<string, unknown>)[key])
    }
    return result
  }

  throw new Error(`Unsupported value in trace serialization: ${typeof value}`)
}

export function normalizeTrace(trace: Trace): Trace {
  return toStableJsonValue(trace) as Trace
}

export function serializeTrace(trace: Trace): string {
  return `${JSON.stringify(normalizeTrace(trace), null, 2)}\n`
}

export function deserializeTrace(raw: string): Trace {
  return normalizeTrace(JSON.parse(raw) as Trace)
}
