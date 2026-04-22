import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { CronTask } from '../../utils/cronTasks.js'
import { readCronTasks, writeCronTasks } from '../../utils/cronTasks.js'
import { safeParseJSON } from '../../utils/json.js'
import { createProjectRegistry } from '../kairos/projectRegistry.js'
import {
  getKairosGlobalCostsPath,
  getKairosGlobalEventsPath,
  getKairosPausePath,
  getKairosStateDir,
  getKairosStatusPath,
  getKairosStdoutLogPath,
  getProjectKairosCostsPath,
  getProjectKairosEventsPath,
  getProjectKairosLogPath,
  getProjectKairosStatusPath,
} from '../kairos/paths.js'
import { createStateWriter } from '../kairos/stateWriter.js'
import type {
  CostsFile,
  GlobalStatus,
  PauseState,
  ProjectStatus,
} from '../kairos/stateWriter.js'

const DEFAULT_TAIL_LIMIT = 50
const DEMO_PROMPT =
  'KAIROS dashboard demo: inspect the current repository state and report one concrete next step in 2 short sentences.'

export type DashboardEvent = Record<string, unknown>

export type DashboardProjectSnapshot = {
  projectDir: string
  status: ProjectStatus | null
  costs: CostsFile | null
  log: DashboardEvent[]
  events: DashboardEvent[]
  tasks: CronTask[]
}

export type DashboardSnapshot = {
  generatedAt: string
  global: {
    status: GlobalStatus | null
    costs: CostsFile | null
    pause: PauseState | null
    events: DashboardEvent[]
    stdoutLog: string[]
    projects: string[]
  }
  projects: DashboardProjectSnapshot[]
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = safeParseJSON(raw, false)
    return parsed === null ? null : (parsed as T)
  } catch {
    return null
  }
}

async function readJsonLines(
  path: string,
  limit = DEFAULT_TAIL_LIMIT,
): Promise<DashboardEvent[]> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map(line => safeParseJSON(line, false))
      .filter((value): value is DashboardEvent => !!value && typeof value === 'object')
  } catch {
    return []
  }
}

async function readTailLines(
  path: string,
  limit = DEFAULT_TAIL_LIMIT,
): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
  } catch {
    return []
  }
}

function buildOneShotCron(now: Date): string {
  const fireAt = new Date(now)
  fireAt.setSeconds(0, 0)
  fireAt.setMinutes(fireAt.getMinutes() + 1)
  return `${fireAt.getMinutes()} ${fireAt.getHours()} ${fireAt.getDate()} ${fireAt.getMonth() + 1} *`
}

export async function readDashboardSnapshot(
  now: () => Date = () => new Date(),
): Promise<DashboardSnapshot> {
  const registry = await createProjectRegistry()
  const projects = await registry.read()

  const [status, costs, pause, events, stdoutLog, projectSnapshots] =
    await Promise.all([
      readJsonFile<GlobalStatus>(getKairosStatusPath()),
      readJsonFile<CostsFile>(getKairosGlobalCostsPath()),
      readJsonFile<PauseState>(getKairosPausePath()),
      readJsonLines(getKairosGlobalEventsPath()),
      readTailLines(getKairosStdoutLogPath()),
      Promise.all(
        projects.map(async projectDir => ({
          projectDir,
          status: await readJsonFile<ProjectStatus>(
            getProjectKairosStatusPath(projectDir),
          ),
          costs: await readJsonFile<CostsFile>(
            getProjectKairosCostsPath(projectDir),
          ),
          log: await readJsonLines(getProjectKairosLogPath(projectDir)),
          events: await readJsonLines(getProjectKairosEventsPath(projectDir)),
          tasks: await readCronTasks(projectDir),
        })),
      ),
    ])

  return {
    generatedAt: now().toISOString(),
    global: {
      status,
      costs,
      pause,
      events,
      stdoutLog,
      projects,
    },
    projects: projectSnapshots,
  }
}

export async function getDashboardWatchPaths(): Promise<string[]> {
  const registry = await createProjectRegistry()
  const projects = await registry.read()
  return [
    getKairosStateDir(),
    ...projects.flatMap(projectDir => [
      join(projectDir, '.claude', 'kairos'),
      join(projectDir, '.claude', 'scheduled_tasks.json'),
    ]),
  ]
}

export async function optInProject(projectDir: string): Promise<void> {
  const registry = await createProjectRegistry()
  const projects = await registry.read()
  await registry.write([...projects, projectDir])
}

export async function optOutProject(projectDir: string): Promise<void> {
  const registry = await createProjectRegistry()
  const projects = await registry.read()
  await registry.write(projects.filter(entry => entry !== projectDir))
}

export async function enqueueDemoTask(
  projectDir: string,
  now: () => Date = () => new Date(),
): Promise<string> {
  const stateWriter = await createStateWriter()
  await stateWriter.ensureProjectDir(projectDir)

  const tasks = await readCronTasks(projectDir)
  const taskId = randomUUID().slice(0, 8)
  tasks.push({
    id: taskId,
    cron: buildOneShotCron(now()),
    prompt: DEMO_PROMPT,
    createdAt: now().getTime(),
  })
  await writeCronTasks(tasks, projectDir)

  const t = now().toISOString()
  await stateWriter.appendProjectLog(projectDir, {
    kind: 'dashboard_demo_enqueued',
    t,
    taskId,
  })
  await stateWriter.appendProjectEvent(projectDir, {
    kind: 'dashboard_demo_enqueued',
    t,
    taskId,
    source: 'dashboard',
  })

  return taskId
}

export async function setPauseState(
  paused: boolean,
  now: () => Date = () => new Date(),
): Promise<void> {
  const stateWriter = await createStateWriter()
  await stateWriter.writePauseState({
    paused,
    source: 'user',
    ...(paused
      ? {
          scope: 'global' as const,
          setAt: now().toISOString(),
        }
      : {}),
  })
}
