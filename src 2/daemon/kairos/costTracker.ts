import type { CostsFile } from './stateWriter.js'

export type CostCaps = {
  perProjectUSD?: number
  globalUSD?: number
}

export type CostRecordInput = {
  projectDir: string
  taskId: string
  runId: string
  costUSD: number
  numTurns: number
  durationMs: number
}

export type CapHit = {
  scope: 'project' | 'global'
  cap: number
  current: number
}

export type CostRecordResult = {
  capHit: CapHit | null
  projectTotal: number
  globalTotal: number
}

export type CostTracker = {
  record(input: CostRecordInput): Promise<CostRecordResult>
  getCaps(): CostCaps
}

type CostTrackerDeps = {
  caps: CostCaps
  now?: () => Date
  stateWriter: {
    readGlobalCosts(): Promise<CostsFile | null>
    writeGlobalCosts(costs: CostsFile): Promise<void>
    readProjectCosts(projectDir: string): Promise<CostsFile | null>
    writeProjectCosts(projectDir: string, costs: CostsFile): Promise<void>
  }
}

function emptyCosts(updatedAt: string): CostsFile {
  return {
    totalUSD: 0,
    totalTurns: 0,
    runs: 0,
    updatedAt,
  }
}

function accumulate(
  prior: CostsFile | null,
  runUSD: number,
  runTurns: number,
  updatedAt: string,
): CostsFile {
  const base = prior ?? emptyCosts(updatedAt)
  return {
    totalUSD: base.totalUSD + runUSD,
    totalTurns: base.totalTurns + runTurns,
    runs: base.runs + 1,
    lastRunUSD: runUSD,
    lastRunAt: updatedAt,
    updatedAt,
  }
}

// Serialize record() calls so read/modify/write of the cost files is atomic
// against itself. Cap checks must observe the updated totals produced by the
// same call that wrote them, not a stale snapshot from a concurrent record().
function serialize<T>(fn: () => Promise<T>, queueRef: { q: Promise<unknown> }): Promise<T> {
  const next = queueRef.q.then(fn, fn)
  queueRef.q = next.catch(() => {})
  return next
}

export function createCostTracker(deps: CostTrackerDeps): CostTracker {
  const now = deps.now ?? (() => new Date())
  const queueRef = { q: Promise.resolve() as Promise<unknown> }

  return {
    getCaps() {
      return { ...deps.caps }
    },
    record(input: CostRecordInput): Promise<CostRecordResult> {
      return serialize(async () => {
        const updatedAt = now().toISOString()

        const [priorGlobal, priorProject] = await Promise.all([
          deps.stateWriter.readGlobalCosts(),
          deps.stateWriter.readProjectCosts(input.projectDir),
        ])

        const nextGlobal = accumulate(
          priorGlobal,
          input.costUSD,
          input.numTurns,
          updatedAt,
        )
        const nextProject = accumulate(
          priorProject,
          input.costUSD,
          input.numTurns,
          updatedAt,
        )

        await Promise.all([
          deps.stateWriter.writeGlobalCosts(nextGlobal),
          deps.stateWriter.writeProjectCosts(input.projectDir, nextProject),
        ])

        let capHit: CapHit | null = null

        if (
          deps.caps.perProjectUSD !== undefined &&
          nextProject.totalUSD >= deps.caps.perProjectUSD
        ) {
          capHit = {
            scope: 'project',
            cap: deps.caps.perProjectUSD,
            current: nextProject.totalUSD,
          }
        }

        if (
          deps.caps.globalUSD !== undefined &&
          nextGlobal.totalUSD >= deps.caps.globalUSD
        ) {
          // Global cap takes precedence — if both are hit, global is the
          // one that should pause the whole daemon.
          capHit = {
            scope: 'global',
            cap: deps.caps.globalUSD,
            current: nextGlobal.totalUSD,
          }
        }

        return {
          capHit,
          projectTotal: nextProject.totalUSD,
          globalTotal: nextGlobal.totalUSD,
        }
      }, queueRef)
    },
  }
}
