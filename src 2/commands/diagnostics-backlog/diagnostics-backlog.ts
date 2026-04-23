import type { ToolUseContext } from '../../Tool.js'
import { formatDiagnosticsBacklogMarkdown } from '../../services/diagnosticBacklog.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import type { LocalCommandResult } from '../../types/command.js'
import { getConnectedIdeClient } from '../../utils/ide.js'

type DiagnosticsBacklogMode = 'current' | 'snapshot' | 'new'

const USAGE =
  'Usage: /diagnostics-backlog [current|snapshot|new]\n' +
  '- current: group all currently reported IDE diagnostics into issue-ready backlog entries\n' +
  '- snapshot: capture the current diagnostics as the baseline for later /diagnostics-backlog new runs\n' +
  '- new: show only diagnostics introduced after the most recent snapshot baseline in this session'

export function parseDiagnosticsBacklogMode(
  rawArgs: string,
): DiagnosticsBacklogMode | null {
  const normalized = rawArgs.trim().toLowerCase()
  if (normalized === '' || normalized === 'current') {
    return 'current'
  }
  if (normalized === 'snapshot') {
    return 'snapshot'
  }
  if (normalized === 'new') {
    return 'new'
  }
  return null
}

function noIdeResult(): LocalCommandResult {
  return {
    type: 'text',
    value:
      'No connected IDE diagnostics client is available for this session. Connect an IDE extension, then rerun `/diagnostics-backlog`.',
  }
}

export async function call(
  args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  const mode = parseDiagnosticsBacklogMode(args)
  if (!mode) {
    return {
      type: 'text',
      value: USAGE,
    }
  }

  const ideClient = getConnectedIdeClient(context.options.mcpClients)
  if (!ideClient) {
    return noIdeResult()
  }

  diagnosticTracker.initialize(ideClient)

  if (mode === 'snapshot') {
    const snapshot = await diagnosticTracker.snapshotCurrentDiagnostics()
    return {
      type: 'text',
      value:
        `Captured diagnostics baseline for ${snapshot.diagnosticCount} diagnostics across ${snapshot.fileCount} files.\n` +
        'Use `/diagnostics-backlog new` later in this session to summarize only newly introduced clusters.',
    }
  }

  if (mode === 'new' && !diagnosticTracker.hasSnapshotCurrentDiagnostics()) {
    return {
      type: 'text',
      value:
        'No diagnostics snapshot baseline exists for this session yet. Run `/diagnostics-backlog snapshot` first, then rerun `/diagnostics-backlog new` after making changes.',
    }
  }

  const diagnostics =
    mode === 'new'
      ? await diagnosticTracker.getNewDiagnosticsSinceSnapshot()
      : await diagnosticTracker.getCurrentDiagnostics()

  return {
    type: 'text',
    value: formatDiagnosticsBacklogMarkdown(diagnostics, {
      scope: mode,
    }),
  }
}
