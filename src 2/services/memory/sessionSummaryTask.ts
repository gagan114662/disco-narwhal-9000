import { logForDebugging } from '../../utils/debug.js'
import { addCronTask, readCronTasks } from '../../utils/cronTasks.js'
import { isKairosMemoryIndexEnabled } from './config.js'
import { buildSessionSummaryPrompt } from './summarizeSession.js'
import { getSessionSummaryPath } from './paths.js'

export const KAIROS_SESSION_MEMORY_MARKER = '<!-- kairos-session-memory -->'

const ONE_SHOT_CRON = '* * * * *'

export type KairosSessionMemoryTaskInputs = {
  sessionIds: string[]
  transcriptDir: string
}

export function buildKairosSessionMemoryPrompt(
  inputs: KairosSessionMemoryTaskInputs,
): string {
  const perSession = inputs.sessionIds
    .map(sessionId =>
      buildSessionSummaryPrompt({
        sessionId,
        transcriptPath: `${inputs.transcriptDir}/${sessionId}.jsonl`,
        summaryPath: getSessionSummaryPath(sessionId),
      }),
    )
    .join('\n\n')
  return `${KAIROS_SESSION_MEMORY_MARKER}\n${perSession}`
}

export async function hasPendingKairosSessionMemoryTask(
  dir?: string,
): Promise<boolean> {
  const tasks = await readCronTasks(dir)
  return tasks.some(task =>
    task.prompt.startsWith(KAIROS_SESSION_MEMORY_MARKER),
  )
}

export async function scheduleKairosSessionMemoryTask(
  inputs: KairosSessionMemoryTaskInputs,
): Promise<{ scheduled: true; id: string } | { scheduled: false; reason: 'disabled' | 'duplicate' }> {
  if (!isKairosMemoryIndexEnabled()) {
    return { scheduled: false, reason: 'disabled' }
  }
  if (await hasPendingKairosSessionMemoryTask()) {
    logForDebugging('[memory] KAIROS session-memory task already pending')
    return { scheduled: false, reason: 'duplicate' }
  }
  const prompt = buildKairosSessionMemoryPrompt(inputs)
  const id = await addCronTask(ONE_SHOT_CRON, prompt, false, true)
  logForDebugging(
    `[memory] scheduled KAIROS session-memory task ${id} (${inputs.sessionIds.length} sessions)`,
  )
  return { scheduled: true, id }
}
