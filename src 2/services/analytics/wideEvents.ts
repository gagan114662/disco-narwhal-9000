/** Authority for canonical wide event shapes; add new event families here instead of emitting ad-hoc payloads from callsites. */
import type { DiagnosticFile } from '../diagnosticTracking.js'
import { logEvent } from './index.js'

type WideEventPrimitive = boolean | number | string | undefined

export type WideTaskLifecycle = 'created' | 'completed' | 'failed' | 'interrupted'
export type WideExecutionMode = 'foreground' | 'background' | 'remote'
export type WideAgentLifecycle = 'started' | 'stopped'
export type WideAgentResult = 'completed' | 'failed' | 'interrupted'
export type WideToolResult =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'interrupted'
export type WideModelFamily = 'sonnet' | 'opus' | 'haiku' | 'other'
export type WidePermissionSource =
  | 'config'
  | 'hook'
  | 'user_permanent'
  | 'user_reject'
  | 'user_temporary'
  | 'unknown'

export type WideTaskLifecycleEvent = {
  lifecycle: WideTaskLifecycle
  task_family: string
  execution_mode: WideExecutionMode
  has_tool_use_id: boolean
  duration_ms?: number
  is_long_running?: boolean
  is_remote_review?: boolean
  is_ultraplan?: boolean
}

export type WideAgentLifecycleEvent = {
  lifecycle: WideAgentLifecycle
  execution_mode: WideExecutionMode
  agent_family: string
  model_family: WideModelFamily
  is_built_in_agent: boolean
  duration_ms?: number
  result?: WideAgentResult
}

export type WideToolExecutionEvent = {
  result: WideToolResult
  tool_family: string
  tool_transport: 'local' | 'mcp'
  is_read_only: boolean
  duration_ms?: number
  permission_source?: WidePermissionSource
  tool_result_size_bytes?: number
}

export type WideDiagnosticsRegressionEvent = {
  change: 'worsened_after_edit'
  tracked_file_count: number
  affected_file_count: number
  diagnostic_count: number
  error_count: number
  warning_count: number
  info_count: number
  hint_count: number
  has_linter_diagnostics: boolean
}

type WideEventMetadataMap = {
  taskLifecycle: WideTaskLifecycleEvent
  agentLifecycle: WideAgentLifecycleEvent
  toolExecution: WideToolExecutionEvent
  diagnosticsRegression: WideDiagnosticsRegressionEvent
}

type WideEventDefinition<K extends keyof WideEventMetadataMap> = {
  description: string
  eventName: string
  requiredFields: readonly (keyof WideEventMetadataMap[K])[]
}

export const wideEventDefinitions = {
  taskLifecycle: {
    eventName: 'tengu_wide_task_lifecycle',
    description:
      'Canonical task lifecycle event for work-unit creation and terminal outcomes.',
    requiredFields: [
      'lifecycle',
      'task_family',
      'execution_mode',
      'has_tool_use_id',
    ],
  },
  agentLifecycle: {
    eventName: 'tengu_wide_agent_lifecycle',
    description:
      'Canonical subagent lifecycle event for launch and stop outcomes.',
    requiredFields: [
      'lifecycle',
      'execution_mode',
      'agent_family',
      'model_family',
      'is_built_in_agent',
    ],
  },
  toolExecution: {
    eventName: 'tengu_wide_tool_execution',
    description:
      'Canonical tool execution event for completed, denied, failed, and interrupted calls.',
    requiredFields: ['result', 'tool_family', 'tool_transport', 'is_read_only'],
  },
  diagnosticsRegression: {
    eventName: 'tengu_wide_diagnostics_regression',
    description:
      'Canonical diagnostics regression event emitted when edits introduce new diagnostics.',
    requiredFields: [
      'change',
      'tracked_file_count',
      'affected_file_count',
      'diagnostic_count',
      'error_count',
      'warning_count',
      'info_count',
      'hint_count',
      'has_linter_diagnostics',
    ],
  },
} satisfies {
  [K in keyof WideEventMetadataMap]: WideEventDefinition<K>
}

function emitWideEvent<K extends keyof WideEventMetadataMap>(
  key: K,
  metadata: WideEventMetadataMap[K],
): void {
  validateWideEvent(key, metadata)
  logEvent(
    wideEventDefinitions[key].eventName,
    metadata as unknown as Record<string, number | boolean | undefined>,
  )
}

function validateWideEvent<K extends keyof WideEventMetadataMap>(
  key: K,
  metadata: WideEventMetadataMap[K],
): void {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  const missingFields = wideEventDefinitions[key].requiredFields.filter(
    field => metadata[field] === undefined,
  )

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required wide-event fields for ${String(key)}: ${missingFields.join(', ')}`,
    )
  }
}

export function emitWideTaskLifecycleEvent(
  metadata: WideTaskLifecycleEvent,
): void {
  emitWideEvent('taskLifecycle', metadata)
}

export function emitWideAgentLifecycleEvent(
  metadata: WideAgentLifecycleEvent,
): void {
  emitWideEvent('agentLifecycle', metadata)
}

export function emitWideToolExecutionEvent(
  metadata: WideToolExecutionEvent,
): void {
  emitWideEvent('toolExecution', metadata)
}

export function emitWideDiagnosticsRegressionEvent(
  metadata: WideDiagnosticsRegressionEvent,
): void {
  emitWideEvent('diagnosticsRegression', metadata)
}

export function getWideEventAgentFamily(
  agentType: string,
  isBuiltInAgent: boolean,
): string {
  return isBuiltInAgent ? agentType : 'custom'
}

export function getWideEventModelFamily(
  model: string | undefined,
): WideModelFamily {
  const normalizedModel = model?.toLowerCase()
  if (!normalizedModel) {
    return 'other'
  }
  if (normalizedModel.includes('sonnet')) {
    return 'sonnet'
  }
  if (normalizedModel.includes('opus')) {
    return 'opus'
  }
  if (normalizedModel.includes('haiku')) {
    return 'haiku'
  }
  return 'other'
}

export function getWideEventToolFamily(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    return 'mcp'
  }
  return toolName
}

export function getWideEventToolTransport(toolName: string): 'local' | 'mcp' {
  return toolName.startsWith('mcp__') ? 'mcp' : 'local'
}

export function normalizeWidePermissionSource(
  source: string | undefined,
): WidePermissionSource {
  switch (source) {
    case 'config':
    case 'hook':
    case 'user_permanent':
    case 'user_reject':
    case 'user_temporary':
      return source
    default:
      return 'unknown'
  }
}

export function summarizeDiagnosticRegression(
  files: DiagnosticFile[],
  trackedFileCount: number,
): WideDiagnosticsRegressionEvent {
  let errorCount = 0
  let warningCount = 0
  let infoCount = 0
  let hintCount = 0
  let hasLinterDiagnostics = false

  for (const file of files) {
    for (const diagnostic of file.diagnostics) {
      switch (diagnostic.severity) {
        case 'Error':
          errorCount++
          break
        case 'Warning':
          warningCount++
          break
        case 'Info':
          infoCount++
          break
        case 'Hint':
          hintCount++
          break
      }

      if (isLinterDiagnosticSource(diagnostic.source)) {
        hasLinterDiagnostics = true
      }
    }
  }

  return {
    change: 'worsened_after_edit',
    tracked_file_count: trackedFileCount,
    affected_file_count: files.length,
    diagnostic_count: errorCount + warningCount + infoCount + hintCount,
    error_count: errorCount,
    warning_count: warningCount,
    info_count: infoCount,
    hint_count: hintCount,
    has_linter_diagnostics: hasLinterDiagnostics,
  }
}

function isLinterDiagnosticSource(source: string | undefined): boolean {
  if (!source) {
    return false
  }

  const normalizedSource = source.toLowerCase()
  return [
    'biome',
    'black',
    'clippy',
    'deno-lint',
    'detekt',
    'eslint',
    'flake8',
    'gofmt',
    'golangci-lint',
    'jshint',
    'ktlint',
    'prettier',
    'pylint',
    'rome',
    'rubocop',
    'ruff',
    'standardjs',
    'stylelint',
    'swiftlint',
    'tslint',
    'xo',
  ].some(linterName => normalizedSource.includes(linterName))
}

export function _validateWideEventForTesting<K extends keyof WideEventMetadataMap>(
  key: K,
  metadata: WideEventMetadataMap[K],
): void {
  validateWideEvent(key, metadata)
}
