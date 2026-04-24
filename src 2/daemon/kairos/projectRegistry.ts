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
      let previous = await readProjectsFile(path)
      let running = false

      const emitDiff = async () => {
        if (running) return
        running = true
        try {
          const next = await readProjectsFile(path)
          const previousSet = new Set(previous)
          const nextSet = new Set(next)
          const added = next.filter(project => !previousSet.has(project))
          const removed = previous.filter(project => !nextSet.has(project))
          previous = next
          if (added.length === 0 && removed.length === 0) return
          onChange({ added, removed, projects: next })
        } finally {
          running = false
        }
      }

      const interval = setInterval(() => void emitDiff(), WATCH_STABILITY_MS)

      return async () => {
        clearInterval(interval)
      }
    },
  }
}
