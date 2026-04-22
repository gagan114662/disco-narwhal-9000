// KAIROS-mode AutoDream scheduling.
//
// When AutoDream's time + session gates pass inside a KAIROS session, we
// don't run the consolidation fork in-process — the whole point of KAIROS
// is that work keeps flowing when the REPL is closed. Instead we hand the
// job off to the daemon by writing a durable one-shot cron task into
// `<project>/.claude/scheduled_tasks.json`.
//
// Idempotency: the daemon deletes one-shot tasks after firing, so "pending"
// means "sitting in the file, not yet fired". We detect that by matching
// a sentinel at the top of the prompt — prompts are the only user-visible
// field on a CronTask we can tag without extending the on-disk schema.
//
// The cron string is `* * * * *` (every minute). As a one-shot, the daemon
// picks it up on the next scheduler tick and auto-deletes it.

import { logForDebugging } from '../../utils/debug.js'
import { addCronTask, readCronTasks } from '../../utils/cronTasks.js'
import { buildConsolidationPrompt } from './consolidationPrompt.js'

/**
 * Sentinel placed at the very start of the scheduled prompt so we can
 * recognize pending AutoDream tasks without adding a new field to the
 * cron-task schema. Kept short + mechanical — humans reading the file
 * will see it; the model firing the task ignores it as an HTML comment.
 */
export const KAIROS_AUTO_DREAM_MARKER = '<!-- kairos-auto-dream -->'

const ONE_SHOT_CRON = '* * * * *'

export type KairosDreamTaskInputs = {
  memoryRoot: string
  transcriptDir: string
  sessionIds: string[]
}

export function buildKairosDreamPrompt(inputs: KairosDreamTaskInputs): string {
  const { memoryRoot, transcriptDir, sessionIds } = inputs
  const extra = `This is an AutoDream consolidation run scheduled by KAIROS. Sessions since last consolidation (${sessionIds.length}):
${sessionIds.map(id => `- ${id}`).join('\n')}`
  const body = buildConsolidationPrompt(memoryRoot, transcriptDir, extra)
  return `${KAIROS_AUTO_DREAM_MARKER}\n${body}`
}

/**
 * True when the project's cron file already holds an unfired AutoDream
 * task. Identified by the sentinel at the top of the prompt.
 */
export async function hasPendingKairosDreamTask(
  dir?: string,
): Promise<boolean> {
  const tasks = await readCronTasks(dir)
  return tasks.some(t => t.prompt.startsWith(KAIROS_AUTO_DREAM_MARKER))
}

export type ScheduleResult =
  | { scheduled: true; id: string }
  | { scheduled: false; reason: 'duplicate' }

/**
 * Enqueue the durable one-shot cron task unless one is already pending
 * for this project. Safe to call on every gate-pass — extra calls no-op.
 */
export async function scheduleKairosDreamTask(
  inputs: KairosDreamTaskInputs,
): Promise<ScheduleResult> {
  if (await hasPendingKairosDreamTask()) {
    logForDebugging(
      '[autoDream] KAIROS dream task already pending — skip scheduling',
    )
    return { scheduled: false, reason: 'duplicate' }
  }
  const prompt = buildKairosDreamPrompt(inputs)
  const id = await addCronTask(ONE_SHOT_CRON, prompt, false, true)
  logForDebugging(
    `[autoDream] scheduled KAIROS dream task ${id} (${inputs.sessionIds.length} sessions)`,
  )
  return { scheduled: true, id }
}
