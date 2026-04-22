// Wraps the child-run onEvent callback, watches for tool_use of the Skill
// tool, and writes a per-run marker file listing the skills the child
// actually invoked. The marker is the authoritative source for later
// distillation — no transcript parsing, no heuristics.
//
// Marker path: `<projectDir>/.claude/kairos/runs/<runId>/skills-used.json`
// Shape:       { runId, taskId, skills: [{ name, firstAt, count }] }
//
// File is only written if at least one Skill invocation was seen. A run with
// no skill use leaves the directory empty, which the enqueue step interprets
// as "nothing to distill."

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { ChildEvent } from '../../daemon/kairos/childRunner.js'

export type SkillUseRecord = {
  /** Canonical skill identifier passed to the Skill tool (e.g. "investigate"). */
  name: string
  /** ISO timestamp of the first invocation in this run. */
  firstAt: string
  /** Number of times the skill was invoked in this run. */
  count: number
}

export type SkillsUsedMarker = {
  runId: string
  taskId: string
  skills: SkillUseRecord[]
}

export type SkillUseObserverDeps = {
  /** Optional existing onEvent to chain into (e.g. the stateWriter sink). */
  onEvent?: (event: ChildEvent) => Promise<void> | void
  /** Override for tests. */
  writeMarker?: (path: string, body: string) => Promise<void>
}

export type SkillUseObserver = {
  /** Wrapped event handler — pass this to `runChild`'s deps.onEvent. */
  onEvent: (event: ChildEvent) => Promise<void>
  /** True if the observer saw at least one Skill invocation. */
  hasSkillUse(): boolean
  /** Snapshot of recorded skills (ordered by first-seen). */
  getSkills(): SkillUseRecord[]
}

const SKILL_TOOL_NAME = 'Skill'

export function getSkillsUsedPath(projectDir: string, runId: string): string {
  return join(projectDir, '.claude', 'kairos', 'runs', runId, 'skills-used.json')
}

/**
 * Extract the skill identifier from a Skill tool_use input. Accepts either
 * `{ skill }` (claude-agent-sdk shape) or `{ skill_name }` (Claude.ai shape)
 * — defensive because the exact SDK convention isn't stable across versions.
 * Returns null for anything else so we don't pollute the marker with junk.
 */
export function extractSkillName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const rec = input as Record<string, unknown>
  const candidate =
    (typeof rec.skill === 'string' ? rec.skill : null) ??
    (typeof rec.skill_name === 'string' ? rec.skill_name : null) ??
    (typeof rec.name === 'string' ? rec.name : null)
  if (!candidate) return null
  const trimmed = candidate.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function createSkillUseObserver(
  _taskId: string,
  deps: SkillUseObserverDeps = {},
): SkillUseObserver {
  const seen = new Map<string, SkillUseRecord>()
  return {
    async onEvent(event: ChildEvent) {
      if (event.kind === 'tool_used' && event.toolName === SKILL_TOOL_NAME) {
        const name = extractSkillName(event.toolInput)
        if (name) {
          const existing = seen.get(name)
          if (existing) {
            existing.count += 1
          } else {
            seen.set(name, { name, firstAt: event.t, count: 1 })
          }
        }
      }
      if (deps.onEvent) await deps.onEvent(event)
    },
    hasSkillUse() {
      return seen.size > 0
    },
    getSkills() {
      return [...seen.values()]
    },
  }
}

/**
 * Bind a runId to an observer for a single child run. Returns a `finalize`
 * callback that writes the marker file (if any skill was invoked) and yields
 * the path.
 */
export function createRunSkillUseObserver(
  taskId: string,
  runId: string,
  deps: SkillUseObserverDeps = {},
): SkillUseObserver & {
  finalize: (projectDir: string) => Promise<string | null>
} {
  const observer = createSkillUseObserver(taskId, deps)
  const writeImpl =
    deps.writeMarker ??
    (async (path: string, body: string) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body, 'utf-8')
    })
  return {
    ...observer,
    async finalize(projectDir: string) {
      if (!observer.hasSkillUse()) return null
      const path = getSkillsUsedPath(projectDir, runId)
      const body: SkillsUsedMarker = {
        runId,
        taskId,
        skills: observer.getSkills(),
      }
      await writeImpl(path, `${JSON.stringify(body, null, 2)}\n`)
      return path
    },
  }
}
