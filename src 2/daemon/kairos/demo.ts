/**
 * Phase 3 visual-proof demo.
 *
 * Runs the full fired-task → child-run → cost-record → cap-hit flow against a
 * fake child launcher, using throwaway temp directories for the global kairos
 * state and one project. Prints every state file the acceptance checklist
 * asks to see, so you can screenshot the terminal output for the PR.
 *
 * Usage (from `src 2/`):
 *   bun run ./daemon/kairos/demo.ts
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CronTask } from '../../utils/cronTasks.js'
import type { ChildLauncher, ChildStreamMessage } from './childRunner.js'
import { createCostTracker } from './costTracker.js'
import {
  getKairosGlobalCostsPath,
  getKairosGlobalEventsPath,
  getKairosPausePath,
  getProjectKairosCostsPath,
  getProjectKairosEventsPath,
} from './paths.js'
import { createStateWriter } from './stateWriter.js'
import { makeCapHitHandler, makeRunFiredTask } from './worker.js'

function banner(title: string): void {
  const bar = '='.repeat(Math.max(8, 72 - title.length - 2))
  console.log(`\n== ${title} ${bar}`)
}

function printFile(label: string, path: string): void {
  banner(label)
  console.log(`path: ${path}`)
  if (!existsSync(path)) {
    console.log('(file not present)')
    return
  }
  console.log(readFileSync(path, 'utf8').trimEnd())
}

function makeTask(id: string, prompt: string): CronTask {
  return { id, cron: '* * * * *', prompt, createdAt: Date.now() }
}

function fakeLauncher(messages: ChildStreamMessage[]): {
  launcher: ChildLauncher
  callCount: () => number
} {
  let calls = 0
  const launcher: ChildLauncher = async function* () {
    calls += 1
    for (const msg of messages) yield msg
  }
  return { launcher, callCount: () => calls }
}

async function main(): Promise<void> {
  const configDir = mkdtempSync(join(tmpdir(), 'kairos-demo-config-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'kairos-demo-project-'))
  process.env.CLAUDE_CONFIG_DIR = configDir

  console.log(`kairos state dir:  ${configDir}/kairos`)
  console.log(`project dir:       ${projectDir}`)

  try {
    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    // Tiny global cap so even one successful run trips it.
    const costTracker = createCostTracker({
      caps: { globalUSD: 0.05 },
      stateWriter,
    })

    const now = () => new Date('2026-04-22T12:00:00.000Z')
    const handleCapHit = makeCapHitHandler(stateWriter, now)

    // ---- Run 1: under cap, happy path -----------------------------------
    const run1 = fakeLauncher([
      { type: 'system', subtype: 'init', tools: ['Read'], session_id: 's1' },
      { type: 'assistant', session_id: 's1' },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        duration_ms: 420,
        total_cost_usd: 0.02,
        session_id: 's1',
      },
    ])

    const runFiredTask1 = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker,
      launcher: run1.launcher,
      defaultAllowedTools: ['Read'],
      maxTurns: 1,
      timeoutMs: 5_000,
      handleCapHit,
      now,
    })

    banner('run 1: under cap (0.02 USD vs 0.05 cap)')
    const outcome1 = await runFiredTask1(
      makeTask('demo-1', 'summarize README'),
      'event',
    )
    console.log('outcome:', JSON.stringify(outcome1, null, 2))
    console.log('launcher calls:', run1.callCount())

    // ---- Run 2: trips the cap -------------------------------------------
    const run2 = fakeLauncher([
      { type: 'system', subtype: 'init', tools: ['Read'], session_id: 's2' },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 2,
        duration_ms: 800,
        total_cost_usd: 0.1,
        session_id: 's2',
      },
    ])

    const runFiredTask2 = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker,
      launcher: run2.launcher,
      defaultAllowedTools: ['Read'],
      maxTurns: 1,
      timeoutMs: 5_000,
      handleCapHit,
      now,
    })

    banner('run 2: trips cap (+0.10 USD → total 0.12 ≥ 0.05)')
    const outcome2 = await runFiredTask2(
      makeTask('demo-2', 'expensive task'),
      'event',
    )
    console.log('outcome:', JSON.stringify(outcome2, null, 2))
    console.log(
      'launcher calls for run 2 (must be 1 — no recursive notification):',
      run2.callCount(),
    )

    // ---- State files ----------------------------------------------------
    printFile('per-project events.jsonl', getProjectKairosEventsPath(projectDir))
    printFile('per-project costs.json', getProjectKairosCostsPath(projectDir))
    printFile('global events.jsonl', getKairosGlobalEventsPath())
    printFile('global costs.json', getKairosGlobalCostsPath())
    printFile('pause.json (daemon-originated)', getKairosPausePath())

    banner('done')
    console.log('All state files written under:')
    console.log(`  ${configDir}/kairos/`)
    console.log(`  ${projectDir}/.claude/kairos/`)
    console.log(
      'Leave as-is to inspect further, or delete manually when finished.',
    )
  } catch (err) {
    // Only clean up on failure — success leaves files around for screenshots.
    rmSync(configDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
    throw err
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
