import { basename, relative } from 'node:path'
import type { Diagnostic, DiagnosticFile } from './diagnosticTracking.js'
import { getCwd } from '../utils/cwd.js'
import { normalizePathForComparison } from '../utils/file.js'

const DIAGNOSTIC_PROTOCOL_PREFIXES = [
  'file://',
  '_claude_fs_right:',
  '_claude_fs_left:',
] as const

const SEVERITY_ORDER: Record<Diagnostic['severity'], number> = {
  Error: 0,
  Warning: 1,
  Info: 2,
  Hint: 3,
}

export type DiagnosticCluster = {
  key: string
  filePath: string
  displayPath: string
  code?: string
  source?: string
  severity: Diagnostic['severity']
  rawMessage: string
  normalizedMessage: string
  count: number
  exampleLocations: Array<{
    line: number
    character: number
  }>
}

export type DiagnosticBacklogReport = {
  totalDiagnostics: number
  totalFiles: number
  clusters: DiagnosticCluster[]
}

function stripDiagnosticUriPrefix(uri: string): string {
  for (const prefix of DIAGNOSTIC_PROTOCOL_PREFIXES) {
    if (uri.startsWith(prefix)) {
      return uri.slice(prefix.length)
    }
  }

  return uri
}

function getDisplayPath(filePath: string): string {
  const cwd = getCwd()
  const relativePath = relative(cwd, filePath)
  if (
    relativePath &&
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    relativePath !== '.'
  ) {
    return relativePath
  }

  return filePath
}

function formatLocation(location: {
  line: number
  character: number
}): string {
  return `${location.line + 1}:${location.character + 1}`
}

function summarizeMessage(message: string, maxLength = 88): string {
  const compact = message.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}

export function normalizeDiagnosticMessage(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/`[^`]+`/g, '`…`')
    .replace(/"[^"]+"/g, '"…"')
    .replace(/'[^']+'/g, "'…'")
    .trim()
}

export function clusterDiagnostics(
  files: DiagnosticFile[],
): DiagnosticBacklogReport {
  const clusters = new Map<string, DiagnosticCluster>()
  let totalDiagnostics = 0
  const touchedFiles = new Set<string>()

  for (const file of files) {
    const filePath = stripDiagnosticUriPrefix(file.uri)
    const normalizedFilePath = normalizePathForComparison(filePath)
    const displayPath = getDisplayPath(filePath)

    if (file.diagnostics.length > 0) {
      touchedFiles.add(normalizedFilePath)
    }

    for (const diagnostic of file.diagnostics) {
      totalDiagnostics += 1
      const normalizedMessage = normalizeDiagnosticMessage(diagnostic.message)
      const clusterKey = [
        normalizedFilePath,
        diagnostic.code ?? '',
        normalizedMessage,
      ].join('::')

      const existing = clusters.get(clusterKey)
      if (existing) {
        existing.count += 1

        const alreadyTracked = existing.exampleLocations.some(
          location =>
            location.line === diagnostic.range.start.line &&
            location.character === diagnostic.range.start.character,
        )
        if (!alreadyTracked && existing.exampleLocations.length < 3) {
          existing.exampleLocations.push({
            line: diagnostic.range.start.line,
            character: diagnostic.range.start.character,
          })
        }
        continue
      }

      clusters.set(clusterKey, {
        key: clusterKey,
        filePath,
        displayPath,
        code: diagnostic.code,
        source: diagnostic.source,
        severity: diagnostic.severity,
        rawMessage: diagnostic.message.trim(),
        normalizedMessage,
        count: 1,
        exampleLocations: [
          {
            line: diagnostic.range.start.line,
            character: diagnostic.range.start.character,
          },
        ],
      })
    }
  }

  const sortedClusters = [...clusters.values()].sort((left, right) => {
    const severityDelta =
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    if (severityDelta !== 0) {
      return severityDelta
    }

    if (right.count !== left.count) {
      return right.count - left.count
    }

    const fileDelta = left.displayPath.localeCompare(right.displayPath)
    if (fileDelta !== 0) {
      return fileDelta
    }

    return (left.code ?? '').localeCompare(right.code ?? '')
  })

  return {
    totalDiagnostics,
    totalFiles: touchedFiles.size,
    clusters: sortedClusters,
  }
}

function buildTitleSuggestion(cluster: DiagnosticCluster): string {
  const codeSegment = cluster.code ? `${cluster.code} in ` : ''
  const fileSegment = basename(cluster.displayPath)
  return `Reduce ${codeSegment}${fileSegment}: ${summarizeMessage(cluster.normalizedMessage, 72)}`
}

function buildProblemSummary(cluster: DiagnosticCluster): string {
  const sourceSuffix = cluster.source ? ` from ${cluster.source}` : ''
  const codeSuffix = cluster.code ? ` (${cluster.code})` : ''
  return `${cluster.count} ${cluster.severity.toLowerCase()} diagnostic${cluster.count === 1 ? '' : 's'} in \`${cluster.displayPath}\`${codeSuffix}${sourceSuffix} share the same normalized message: "${cluster.normalizedMessage}".`
}

function buildLeafBuildAssessment(cluster: DiagnosticCluster): string {
  return `Yes, this cluster is isolated to \`${cluster.displayPath}\`.`
}

export function formatDiagnosticsBacklogMarkdown(
  files: DiagnosticFile[],
  options?: {
    scope?: 'current' | 'new'
    commandName?: string
  },
): string {
  const scope = options?.scope ?? 'current'
  const commandName =
    options?.commandName ??
    `/diagnostics-backlog ${scope === 'new' ? 'new' : 'current'}`
  const report = clusterDiagnostics(files)

  if (report.clusters.length === 0) {
    if (scope === 'new') {
      return 'No new diagnostic clusters since the last `/diagnostics-backlog snapshot` baseline.'
    }

    return 'No current diagnostics were reported by the connected IDE.'
  }

  const heading =
    scope === 'new' ? '# New Diagnostic Repair Backlog' : '# Diagnostic Repair Backlog'

  const lines = [
    heading,
    '',
    `Generated from ${report.totalDiagnostics} diagnostics across ${report.totalFiles} files. Duplicates are grouped by file, code, and normalized message.`,
    '',
  ]

  report.clusters.forEach((cluster, index) => {
    const entryPoints = cluster.exampleLocations
      .map(location => `\`${cluster.displayPath}:${formatLocation(location)}\``)
      .join(', ')
    const verificationCluster =
      cluster.code ?? summarizeMessage(cluster.normalizedMessage, 40)

    lines.push(`## Cluster ${index + 1}: ${cluster.displayPath}`)
    lines.push('')
    lines.push(`- Title suggestion: ${buildTitleSuggestion(cluster)}`)
    lines.push(`- Problem summary: ${buildProblemSummary(cluster)}`)
    lines.push(`- Likely entry points: ${entryPoints}`)
    lines.push(
      `- Acceptance target: The ${verificationCluster} cluster is reduced to zero in \`${cluster.displayPath}\`.`,
    )
    lines.push('- Verification steps:')
    lines.push(`  1. Re-run \`${commandName}\`.`)
    lines.push(
      `  2. Confirm the ${verificationCluster} cluster for \`${cluster.displayPath}\` no longer appears.`,
    )
    lines.push(`- Leaf-build candidate: ${buildLeafBuildAssessment(cluster)}`)
    lines.push('')
  })

  return lines.join('\n').trimEnd()
}
