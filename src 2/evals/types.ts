export type TraceDurationBucket = '<100ms' | '100-1000ms' | '>1s'

export type TraceMeta = {
  caseId: string
  commitSha: string
  harnessVersion: number
}

export type TraceToolCall = {
  tool: string
  inputSha: string
  outputSha: string
  durationMs: TraceDurationBucket
}

export type TraceWideEvent = {
  name: string
  phase: string
  keysPresent: string[]
}

export type Trace = {
  meta: TraceMeta
  toolCalls: TraceToolCall[]
  wideEvents: TraceWideEvent[]
  finalResponseSha: string
  exitCode: number
}

export type DiffKind = 'missing' | 'extra' | 'changed'

export type DiffEntry = {
  path: string[]
  kind: DiffKind
  expected?: unknown
  actual?: unknown
}

export type IgnoredFieldPath = string[]
