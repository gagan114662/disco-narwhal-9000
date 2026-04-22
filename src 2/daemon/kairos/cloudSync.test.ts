import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyKairosCloudStateBundle,
  buildKairosCloudStateBundle,
  getKairosCloudManifestPath,
  getKairosCloudOverlayDir,
  getKairosCloudOverlayStateDir,
  getKairosCloudProjectOverlayDir,
  getKairosCloudRegistryPath,
  getKairosCloudSourceDir,
  KairosCloudSyncError,
  type KairosCloudBundleProject,
} from './cloudSync.js'
import { createProjectRegistry } from './projectRegistry.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

describe('Kairos cloud state sync', () => {
  test('builds a bundle from supported KAIROS state and scheduled task data', async () => {
    const configDir = makeTempDir('kairos-cloud-config-')
    const projectDir = makeTempDir('kairos-cloud-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    mkdirSync(join(configDir, 'skills', 'daily-review'), { recursive: true })
    writeFileSync(
      join(configDir, 'skills', 'daily-review', 'SKILL.md'),
      '---\nname: daily-review\ndescription: review things\n---\n# Skill\n',
    )
    mkdirSync(join(configDir, 'skills', 'daily-review', 'assets'), {
      recursive: true,
    })
    writeFileSync(
      join(configDir, 'skills', 'daily-review', 'assets', 'notes.txt'),
      'keep sibling assets under a real skill dir',
    )
    mkdirSync(join(configDir, 'skills', 'daily-review', 'node_modules'), {
      recursive: true,
    })
    writeFileSync(
      join(configDir, 'skills', 'daily-review', 'node_modules', 'junk.js'),
      'do not sync node_modules',
    )
    mkdirSync(join(configDir, 'skills', '.backup-skill', 'demo'), {
      recursive: true,
    })
    writeFileSync(
      join(configDir, 'skills', '.backup-skill', 'demo', 'SKILL.md'),
      '---\nname: backup\ndescription: should be ignored\n---\n',
    )
    mkdirSync(join(configDir, 'memory'), { recursive: true })
    writeFileSync(
      join(configDir, 'memory', 'sessions.db'),
      Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]),
    )
    mkdirSync(join(configDir, 'memory', '.pending-proposals'), {
      recursive: true,
    })
    writeFileSync(
      join(configDir, 'memory', '.pending-proposals', 'prop-1.json'),
      JSON.stringify({ id: 'prop-1', content: 'keep this' }),
    )
    mkdirSync(join(configDir, 'memory', '.archived-proposals'), {
      recursive: true,
    })
    writeFileSync(
      join(configDir, 'memory', '.archived-proposals', 'prop-old.json'),
      JSON.stringify({ id: 'prop-old', status: 'accepted' }),
    )
    mkdirSync(join(configDir, 'memory', 'backups'), { recursive: true })
    writeFileSync(
      join(configDir, 'memory', 'backups', 'old.md.bak'),
      'do not sync backups',
    )
    mkdirSync(join(configDir, 'sessions', '.summaries'), { recursive: true })
    writeFileSync(
      join(configDir, 'sessions', '.summaries', 'sess-1.json'),
      JSON.stringify({ id: 'sess-1', summary: 'done' }),
    )

    mkdirSync(join(projectDir, '.claude'), { recursive: true })
    writeFileSync(
      join(projectDir, '.claude', 'scheduled_tasks.json'),
      JSON.stringify(
        {
          tasks: [{ id: 'abcd1234', cron: '* * * * *', prompt: 'check in', createdAt: 1 }],
        },
        null,
        2,
      ),
    )

    const registry = await createProjectRegistry()
    await registry.write([projectDir])

    const bundle = await buildKairosCloudStateBundle({
      now: () => new Date('2026-04-22T12:00:00.000Z'),
      resolveProjectMetadata: async (): Promise<KairosCloudBundleProject> => ({
        id: 'proj1234abcd',
        remoteUrl: 'https://github.com/example/project.git',
        normalizedRemoteUrl: 'github.com/example/project',
        headRef: 'main',
        headCommit: '0123456789abcdef',
        defaultBranch: 'main',
        repoHost: 'github.com',
        repoOwner: 'example',
        repoName: 'project',
      }),
    })

    expect(bundle).toMatchObject({
      version: 1,
      createdAt: '2026-04-22T12:00:00.000Z',
      projects: [
        {
          id: 'proj1234abcd',
          remoteUrl: 'https://github.com/example/project.git',
          scheduledTasksSyncPath:
            'project-sync/proj1234abcd/.claude/scheduled_tasks.json',
        },
      ],
    })

    expect(bundle.files.map(file => file.relativePath)).toEqual([
      'config/.claude/memory/.archived-proposals/prop-old.json',
      'config/.claude/memory/.pending-proposals/prop-1.json',
      'config/.claude/memory/sessions.db',
      'config/.claude/skills/daily-review/assets/notes.txt',
      'config/.claude/skills/daily-review/SKILL.md',
      'project-sync/proj1234abcd/.claude/scheduled_tasks.json',
    ])

    const skillFile = bundle.files.find(
      file => file.relativePath === 'config/.claude/skills/daily-review/SKILL.md',
    )
    expect(
      Buffer.from(skillFile!.contentBase64, 'base64').toString('utf8'),
    ).toContain('daily-review')

    const memoryFile = bundle.files.find(
      file => file.relativePath === 'config/.claude/memory/sessions.db',
    )
    expect(Buffer.from(memoryFile!.contentBase64, 'base64')).toEqual(
      Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]),
    )
    expect(
      bundle.files.some(
        file =>
          file.relativePath === 'config/.claude/sessions/.summaries/sess-1.json',
      ),
    ).toBe(false)
    expect(
      bundle.files.some(
        file =>
          file.relativePath === 'config/.claude/memory/backups/old.md.bak',
      ),
    ).toBe(false)
    expect(
      bundle.files.some(
        file =>
          file.relativePath ===
          'config/.claude/skills/daily-review/node_modules/junk.js',
      ),
    ).toBe(false)
    expect(
      bundle.files.some(
        file =>
          file.relativePath === 'config/.claude/skills/.backup-skill/demo/SKILL.md',
      ),
    ).toBe(false)
  })

  test('rejects a project when cloud sync cannot resolve a reachable git remote', async () => {
    const configDir = makeTempDir('kairos-cloud-config-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    await expect(
      buildKairosCloudStateBundle({
        readProjects: async () => ['/tmp/no-remote'],
        resolveProjectMetadata: async projectDir => {
          throw new KairosCloudSyncError(
            `Project ${projectDir} has no reachable git remote: origin`,
          )
        },
      }),
    ).rejects.toThrow('has no reachable git remote')
  })

  test('applies a bundle into a read-only source tree and preserves overlay state across re-syncs', async () => {
    const runtimeRoot = makeTempDir('kairos-cloud-runtime-')

    const firstBundle = {
      version: 1 as const,
      createdAt: '2026-04-22T12:00:00.000Z',
      projects: [
        {
          id: 'proj1234abcd',
          remoteUrl: 'https://github.com/example/project.git',
          normalizedRemoteUrl: 'github.com/example/project',
          headRef: 'main',
          headCommit: '0123456789abcdef',
          defaultBranch: 'main',
          scheduledTasksSyncPath:
            'project-sync/proj1234abcd/.claude/scheduled_tasks.json',
        },
      ],
      files: [
        {
          relativePath: 'config/.claude/skills/daily-review/SKILL.md',
          sizeBytes: 5,
          sha256: 'skill-v1',
          contentBase64: Buffer.from('v1\n', 'utf8').toString('base64'),
        },
        {
          relativePath: 'config/.claude/memory/sessions.db',
          sizeBytes: 6,
          sha256: 'memory-v1',
          contentBase64: Buffer.from('mem-v1', 'utf8').toString('base64'),
        },
        {
          relativePath: 'project-sync/proj1234abcd/.claude/scheduled_tasks.json',
          sizeBytes: 11,
          sha256: 'tasks-v1',
          contentBase64: Buffer.from('{"tasks":[]}', 'utf8').toString('base64'),
        },
      ],
    }

    await applyKairosCloudStateBundle(firstBundle, {
      runtimeRoot,
      now: () => new Date('2026-04-22T12:05:00.000Z'),
    })

    const sourceDir = getKairosCloudSourceDir(runtimeRoot)
    const overlayDir = getKairosCloudOverlayDir(runtimeRoot)
    const skillPath = join(
      sourceDir,
      'config',
      '.claude',
      'skills',
      'daily-review',
      'SKILL.md',
    )
    const scheduledTasksPath = join(
      sourceDir,
      'project-sync',
      'proj1234abcd',
      '.claude',
      'scheduled_tasks.json',
    )
    const overlayMarker = join(
      getKairosCloudProjectOverlayDir(runtimeRoot, 'proj1234abcd'),
      'events.jsonl',
    )

    expect(readFileSync(skillPath, 'utf8')).toBe('v1\n')
    expect(modeOf(skillPath)).toBe(0o444)
    expect(modeOf(scheduledTasksPath)).toBe(0o444)
    expect(modeOf(getKairosCloudRegistryPath(runtimeRoot))).toBe(0o444)
    expect(modeOf(getKairosCloudManifestPath(runtimeRoot))).toBe(0o444)
    expect(existsSync(getKairosCloudOverlayStateDir(runtimeRoot))).toBe(true)
    expect(existsSync(overlayDir)).toBe(true)

    writeFileSync(overlayMarker, '{"kind":"runtime_event"}\n')

    const secondBundle = {
      version: 1 as const,
      createdAt: '2026-04-22T12:10:00.000Z',
      projects: firstBundle.projects,
      files: [
        {
          relativePath: 'config/.claude/memory/sessions.db',
          sizeBytes: 6,
          sha256: 'memory-v2',
          contentBase64: Buffer.from('mem-v2', 'utf8').toString('base64'),
        },
        {
          relativePath: 'project-sync/proj1234abcd/.claude/scheduled_tasks.json',
          sizeBytes: 24,
          sha256: 'tasks-v2',
          contentBase64: Buffer.from(
            '{"tasks":[{"id":"next"}]}',
            'utf8',
          ).toString('base64'),
        },
      ],
    }

    await applyKairosCloudStateBundle(secondBundle, {
      runtimeRoot,
      now: () => new Date('2026-04-22T12:15:00.000Z'),
    })

    expect(existsSync(skillPath)).toBe(false)
    expect(readFileSync(join(sourceDir, 'config', '.claude', 'memory', 'sessions.db'), 'utf8')).toBe(
      'mem-v2',
    )
    expect(readFileSync(scheduledTasksPath, 'utf8')).toContain('"next"')
    expect(readFileSync(overlayMarker, 'utf8')).toContain('runtime_event')

    const registry = readJson(getKairosCloudRegistryPath(runtimeRoot)) as {
      syncedAt: string
      projects: Array<{ id: string }>
    }
    expect(registry.syncedAt).toBe('2026-04-22T12:10:00.000Z')
    expect(registry.projects).toHaveLength(1)

    const manifest = readJson(getKairosCloudManifestPath(runtimeRoot)) as {
      managedPaths: string[]
      bundleCreatedAt: string
    }
    expect(manifest.bundleCreatedAt).toBe('2026-04-22T12:10:00.000Z')
    expect(manifest.managedPaths).not.toContain(
      'config/.claude/skills/daily-review/SKILL.md',
    )
  })
})
