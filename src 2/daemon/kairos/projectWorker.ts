import { randomUUID } from 'crypto'
import { createCronScheduler, type CronScheduler } from '../../utils/cronScheduler.js'
import { readCronTasks, writeCronTasks } from '../../utils/cronTasks.js'
import type { CronTask } from '../../utils/cronTasks.js'
import type { ProjectStatus } from './stateWriter.js'

export type ProjectWorkerDeps = {
  stateWriter: {
    writeProjectStatus(status: ProjectStatus): Promise<void>
    appendProjectLog(
      projectDir: string,
      event: Record<string, unknown>,
    ): Promise<void>
  }
  createScheduler?: (options: ConstructorParameters<typeof createCronScheduler>[0]) => CronScheduler
  now?: () => Date
}

export type ProjectWorker = {
  start(): void
  stop(): Promise<void>
  onFireTask(task: CronTask): void
  onMissed(tasks: CronTask[]): void
  getSnapshot(): {
    running: boolean
    dirty: boolean
    pendingCount: number
    nextFireAt: number | null
  }
}

export function createProjectWorker(
  projectDir: string,
  deps: ProjectWorkerDeps,
): ProjectWorker {
  const now = deps.now ?? (() => new Date())
  const lockIdentity = randomUUID()
  const createSchedulerImpl = deps.createScheduler ?? createCronScheduler

  let running = false
  let dirty = false
  let pendingCount = 0
  let stopped = false
  let currentRun: Promise<void> | null = null
  const completedOneShots = new Set<string>()
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null
  let cleanupRun: Promise<void> | null = null

  const flushCompletedOneShots = async (): Promise<void> => {
    if (completedOneShots.size === 0) return
    const ids = new Set(completedOneShots)
    completedOneShots.clear()
    const tasks = await readCronTasks(projectDir)
    const remaining = tasks.filter(task => !ids.has(task.id))
    await writeCronTasks(remaining, projectDir)
  }

  const scheduleOneShotCleanup = (): void => {
    if (cleanupTimer || stopped) return
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null
      cleanupRun = flushCompletedOneShots().finally(() => {
        cleanupRun = null
        if (completedOneShots.size > 0) {
          scheduleOneShotCleanup()
        }
      })
    }, 50)
    cleanupTimer.unref?.()
  }

  const writeStatus = async (lastEvent: string): Promise<void> => {
    await deps.stateWriter.writeProjectStatus({
      projectDir,
      running,
      dirty,
      pendingCount,
      lastEvent,
      updatedAt: now().toISOString(),
      nextFireAt: scheduler.getNextFireTime(),
      ...(lastEvent === 'finished' ? { lastRunAt: now().toISOString() } : {}),
    })
  }

  const runCycle = async (source: 'event' | 'catchup'): Promise<void> => {
    if (source === 'catchup') {
      await deps.stateWriter.appendProjectLog(projectDir, {
        kind: 'catchup_started',
        t: now().toISOString(),
      })
    }
    await writeStatus(source === 'catchup' ? 'catchup_started' : 'fired')
    await deps.stateWriter.appendProjectLog(projectDir, {
      kind: 'finished',
      source,
      t: now().toISOString(),
    })
    await writeStatus('finished')
  }

  const drain = async (): Promise<void> => {
    if (running || stopped) return
    running = true
    currentRun = (async () => {
      try {
        await runCycle('event')
        while (dirty && !stopped) {
          dirty = false
          pendingCount = 1
          await runCycle('catchup')
        }
      } finally {
        running = false
        pendingCount = dirty ? 1 : 0
        await writeStatus('finished')
      }
    })()
    await currentRun
    currentRun = null
  }

  const scheduler = createSchedulerImpl({
    dir: projectDir,
    lockIdentity,
    isLoading: () => false,
    onFire: () => {},
    onFireTask(task) {
      void worker.onFireTask(task)
    },
    onMissed(tasks) {
      void worker.onMissed(tasks)
    },
  })

  const worker: ProjectWorker = {
    start() {
      void deps.stateWriter.appendProjectLog(projectDir, {
        kind: 'worker_started',
        t: now().toISOString(),
        nextFireAt: scheduler.getNextFireTime(),
      })
      void writeStatus('worker_started')
      scheduler.start()
    },
    async stop() {
      stopped = true
      if (cleanupTimer) {
        clearTimeout(cleanupTimer)
        cleanupTimer = null
      }
      scheduler.stop()
      await currentRun
      await cleanupRun
      await flushCompletedOneShots()
      await deps.stateWriter.appendProjectLog(projectDir, {
        kind: 'worker_stopped',
        t: now().toISOString(),
      })
      await writeStatus('worker_stopped')
    },
    onFireTask(task) {
      if (!task.recurring) {
        completedOneShots.add(task.id)
        scheduleOneShotCleanup()
      }
      void deps.stateWriter.appendProjectLog(projectDir, {
        kind: 'fired',
        t: now().toISOString(),
        taskId: task.id,
        cron: task.cron,
      })
      if (running) {
        dirty = true
        pendingCount = 1
        void deps.stateWriter.appendProjectLog(projectDir, {
          kind: 'overlap_coalesced',
          t: now().toISOString(),
          taskId: task.id,
        })
        void writeStatus('overlap_coalesced')
        return
      }
      pendingCount = 1
      void drain()
    },
    onMissed(tasks) {
      void deps.stateWriter.appendProjectLog(projectDir, {
        kind: 'missed',
        t: now().toISOString(),
        count: tasks.length,
      })
      void writeStatus('missed')
    },
    getSnapshot() {
      return {
        running,
        dirty,
        pendingCount,
        nextFireAt: scheduler.getNextFireTime(),
      }
    },
  }

  return worker
}
