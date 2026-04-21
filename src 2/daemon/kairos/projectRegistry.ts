import type { FSWatcher } from 'chokidar'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { safeParseJSON } from '../../utils/json.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getKairosStateDir } from './paths.js'

const PROJECTS_FILE = 'projects.json'
const WATCH_STABILITY_MS = 300

const registrySchema = lazySchema(() =>
  z.object({
    projects: z.array(z.string()),
  }),
)

type RegistryFile = z.infer<ReturnType<typeof registrySchema>>

export type ProjectsChange = {
  added: string[]
  removed: string[]
  projects: string[]
}

export type ProjectRegistry = {
  path: string
  read(): Promise<string[]>
  write(projects: string[]): Promise<void>
  watch(onChange: (change: ProjectsChange) => void): Promise<() => Promise<void>>
}

function normalizeProjects(projects: string[]): string[] {
  return [...new Set(projects.map(project => project.normalize('NFC')).sort())]
}

async function readProjectsFile(path: string): Promise<string[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  const parsed = safeParseJSON(raw, false)
  const result = registrySchema().safeParse(parsed)
  if (!result.success) return []
  return normalizeProjects(result.data.projects)
}

export async function createProjectRegistry(): Promise<ProjectRegistry> {
  const dir = getKairosStateDir()
  const path = join(dir, PROJECTS_FILE)

  await mkdir(dir, { recursive: true })

  return {
    path,
    read() {
      return readProjectsFile(path)
    },
    async write(projects: string[]) {
      const body: RegistryFile = { projects: normalizeProjects(projects) }
      await writeFile(path, `${jsonStringify(body, null, 2)}\n`, 'utf8')
    },
    async watch(onChange) {
      const { default: chokidar } = await import('chokidar')
      let previous = await readProjectsFile(path)

      const emitDiff = async () => {
        const next = await readProjectsFile(path)
        const previousSet = new Set(previous)
        const nextSet = new Set(next)
        const added = next.filter(project => !previousSet.has(project))
        const removed = previous.filter(project => !nextSet.has(project))
        previous = next
        if (added.length === 0 && removed.length === 0) return
        onChange({ added, removed, projects: next })
      }

      const watcher: FSWatcher = chokidar.watch(path, {
        persistent: false,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: WATCH_STABILITY_MS,
        },
      })

      watcher.on('add', () => void emitDiff())
      watcher.on('change', () => void emitDiff())
      watcher.on('unlink', () =>
        void (async () => {
          const removed = previous
          previous = []
          if (removed.length === 0) return
          onChange({ added: [], removed, projects: [] })
        })(),
      )

      return async () => {
        await watcher.close()
      }
    },
  }
}
