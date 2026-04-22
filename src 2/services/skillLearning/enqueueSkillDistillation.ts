// Called by the daemon after a successful child run that invoked at least
// one skill. Enqueues a durable one-shot cron task per skill for the next
// daemon tick, subject to:
//
//   - feature flag: settings.kairos.skillLearning.enabled
//   - rate limit: one active (pending/applied) patch per skill per 24h
//   - de-dupe: we never enqueue a distillation task if one is already
//     pending in scheduled_tasks.json for the same skill
//
// The resulting cron task's prompt carries SKILL_LEARNING_MARKER; when the
// daemon fires it, the child writes its patch to the pending-improvements
// directory. Applying a patch to the live skill is a separate, user-gated
// step (see reviewQueue.ts + applyPatch.ts).

import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import type { ChildRunResult } from '../../daemon/kairos/childRunner.js'
import { addCronTask, readCronTasks } from '../../utils/cronTasks.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  buildDistillationPrompt,
  SKILL_LEARNING_MARKER,
} from './distillationPrompt.js'
import {
  getPendingImprovementsDir,
  getPendingPatchPath,
  getSkillFilePath,
} from './paths.js'
import {
  archiveOldAppliedPatches,
  checkSkillRateLimit,
} from './rateLimiter.js'
import { readSkillLearningConfig } from './skillLearningConfig.js'
import type { SkillsUsedMarker } from './skillUseObserver.js'
import { getSkillsUsedPath } from './skillUseObserver.js'

const ONE_SHOT_CRON = '* * * * *'

/**
 * Structural discriminator stamped on the CronTask so the worker can skip
 * re-entrant observation without reading the prompt. User-authored cron
 * tasks leave `kind` undefined, so a docs copy-paste of the sentinel
 * comment at the top of a prompt can never look like a daemon-internal
 * distillation task.
 */
export const SKILL_DISTILLATION_KIND = 'skill_distillation'

export type EnqueueSkillDistillationInputs = {
  projectDir: string
  runResult: Pick<ChildRunResult, 'runId' | 'ok'>
  skillsUsed: SkillsUsedMarker
  /** Optional override so tests can pin task IDs and timestamps. */
  now?: () => Date
  /** Override for tests that don't want to hit the real cron file. */
  addCronTask?: typeof addCronTask
}

export type EnqueueOutcome =
  | { status: 'disabled' }
  | { status: 'run_failed' }
  | { status: 'no_skills' }
  | {
      status: 'enqueued' | 'rate_limited' | 'duplicate'
      perSkill: PerSkillOutcome[]
    }

export type PerSkillOutcome =
  | { skill: string; status: 'enqueued'; taskId: string; patchId: string }
  | {
      skill: string
      status: 'rate_limited'
      nextAllowedAt: number
    }
  | { skill: string; status: 'duplicate' }

/**
 * Return the list of per-skill distillation marker sentinels we'd look for
 * in scheduled_tasks.json. One per skill.
 */
function perSkillSentinel(skill: string): string {
  return `${SKILL_LEARNING_MARKER} skill=${skill}`
}

/**
 * Has a distillation task for this skill already been enqueued (and not yet
 * fired)? Authoritative check is the structural `kind` field; the per-skill
 * sentinel in the prompt is only used to narrow by which skill.
 */
async function hasPendingDistillation(
  projectDir: string,
  skill: string,
): Promise<boolean> {
  const tasks = await readCronTasks(projectDir)
  const marker = perSkillSentinel(skill)
  return tasks.some(
    t => t.kind === SKILL_DISTILLATION_KIND && t.prompt.startsWith(marker),
  )
}

/**
 * In-process chain of in-flight enqueue calls keyed by projectDir. Two
 * near-simultaneous successful child runs on the same project that both
 * invoked the same skill would otherwise race the read-modify-write between
 * `hasPendingDistillation` / `checkSkillRateLimit` and `addCronTask`, and
 * produce two duplicate cron tasks. Serializing enqueue per project keeps
 * the compound check-then-write atomic from the daemon's perspective.
 *
 * Cross-project calls fan out freely — they target different files.
 */
const projectEnqueueChains = new Map<string, Promise<unknown>>()

async function withProjectLock<T>(
  projectDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = projectEnqueueChains.get(projectDir) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  projectEnqueueChains.set(projectDir, next)
  try {
    return await next
  } finally {
    if (projectEnqueueChains.get(projectDir) === next) {
      projectEnqueueChains.delete(projectDir)
    }
  }
}

export async function enqueueSkillDistillation(
  inputs: EnqueueSkillDistillationInputs,
): Promise<EnqueueOutcome> {
  const now = inputs.now ?? (() => new Date())
  const adder = inputs.addCronTask ?? addCronTask

  const config = readSkillLearningConfig(inputs.projectDir)
  if (!config.enabled) return { status: 'disabled' }
  if (!inputs.runResult.ok) return { status: 'run_failed' }
  if (inputs.skillsUsed.skills.length === 0) return { status: 'no_skills' }

  return withProjectLock(inputs.projectDir, async () => {
    // Ensure the pending directory exists before any child references it.
    await mkdir(getPendingImprovementsDir(), { recursive: true })

    // Opportunistic prune: move applied patches older than 2× the rate-limit
    // window out of the hot path so `listActivePatches` stays small. We use
    // a generous multiplier so anything still plausibly affecting a rate
    // limit decision is preserved in-place.
    if (config.rateLimitMs > 0) {
      await archiveOldAppliedPatches(now().getTime() - config.rateLimitMs * 2)
    }

    const perSkill: PerSkillOutcome[] = []
    let anyEnqueued = false

    for (const record of inputs.skillsUsed.skills) {
      const skill = record.name

      if (await hasPendingDistillation(inputs.projectDir, skill)) {
        perSkill.push({ skill, status: 'duplicate' })
        continue
      }

      const limit = await checkSkillRateLimit(
        skill,
        now().getTime(),
        config.rateLimitMs,
      )
      if (!limit.ok) {
        perSkill.push({
          skill,
          status: 'rate_limited',
          nextAllowedAt: limit.nextAllowedAt,
        })
        continue
      }

      const patchId = randomUUID().slice(0, 8)
      const sentinel = perSkillSentinel(skill)
      const body = buildDistillationPrompt({
        skill,
        skillFilePath: getSkillFilePath(skill),
        skillsUsedPath: getSkillsUsedPath(
          inputs.projectDir,
          inputs.runResult.runId,
        ),
        patchOutputPath: getPendingPatchPath(patchId),
        enqueuedAt: now().toISOString(),
      })
      const prompt = `${sentinel}\n${body}`

      const taskId = await adder(
        ONE_SHOT_CRON,
        prompt,
        false,
        true,
        undefined,
        SKILL_DISTILLATION_KIND,
      )
      perSkill.push({ skill, status: 'enqueued', taskId, patchId })
      anyEnqueued = true
      logForDebugging(
        `[skillLearning] enqueued distillation task=${taskId} skill=${skill} patchId=${patchId}`,
      )
    }

    if (anyEnqueued) return { status: 'enqueued', perSkill }
    if (perSkill.every(p => p.status === 'rate_limited')) {
      return { status: 'rate_limited', perSkill }
    }
    return { status: 'duplicate', perSkill }
  })
}
