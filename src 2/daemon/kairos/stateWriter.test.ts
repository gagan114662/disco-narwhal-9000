import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { calculateKairosBuildEventAuditHash } from './buildAudit.js'
import { createStateWriter } from './stateWriter.js'

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

describe('Kairos state writer build state', () => {
  test('persists manifest, spec, events, transcript pointer, and result for a build', async () => {
    const configDir = makeTempDir('kairos-build-state-config-')
    const projectDir = makeTempDir('kairos-build-state-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const writer = await createStateWriter()
    const buildId = 'build-123'
    const buildDir = join(projectDir, '.claude', 'kairos', 'builds', buildId)

    await writer.writeBuildManifest(projectDir, {
      version: 1,
      buildId,
      projectDir,
      tenantId: 'tenant-local',
      status: 'draft',
      createdAt: '2026-04-25T18:00:00.000Z',
      updatedAt: '2026-04-25T18:00:00.000Z',
    })
    await writer.writeBuildSpec(projectDir, buildId, '# Leave Request App\n')
    await writer.writeBuildTranscriptPointer(projectDir, buildId, 'session-abc')
    await writer.appendBuildEvent(projectDir, buildId, {
      version: 1,
      kind: 'build_created',
      buildId,
      tenantId: 'tenant-local',
      t: '2026-04-25T18:00:00.000Z',
      status: 'draft',
    })
    await writer.writeBuildResult(projectDir, buildId, {
      version: 1,
      buildId,
      tenantId: 'tenant-local',
      status: 'succeeded',
      completedAt: '2026-04-25T18:05:00.000Z',
      summary: 'Generated CRUD scaffold',
    })

    expect(readJson(join(buildDir, 'manifest.json'))).toMatchObject({
      buildId,
      tenantId: 'tenant-local',
      status: 'draft',
    })
    expect(await writer.readBuildManifest(projectDir, buildId)).toMatchObject({
      buildId,
      tenantId: 'tenant-local',
      status: 'draft',
    })
    expect(readFileSync(join(buildDir, 'spec.md'), 'utf8')).toBe(
      '# Leave Request App\n',
    )
    expect(await writer.readBuildSpec(projectDir, buildId)).toBe(
      '# Leave Request App\n',
    )
    expect(readFileSync(join(buildDir, 'transcript-pointer.txt'), 'utf8')).toBe(
      'session-abc\n',
    )
    expect(readFileSync(join(buildDir, 'events.jsonl'), 'utf8')).toContain(
      '"kind":"build_created"',
    )
    const events = await writer.readBuildEvents(projectDir, buildId)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      version: 1,
      kind: 'build_created',
      buildId,
      tenantId: 'tenant-local',
      t: '2026-04-25T18:00:00.000Z',
      status: 'draft',
      auditPrevHash: null,
    })
    expect(events[0]?.auditHash).toBe(
      calculateKairosBuildEventAuditHash({
        version: 1,
        kind: 'build_created',
        buildId,
        tenantId: 'tenant-local',
        t: '2026-04-25T18:00:00.000Z',
        status: 'draft',
        auditPrevHash: null,
      }),
    )
    expect(readJson(join(buildDir, 'result.json'))).toMatchObject({
      buildId,
      status: 'succeeded',
      summary: 'Generated CRUD scaffold',
    })
  })

  test('hash-links appended build events', async () => {
    const configDir = makeTempDir('kairos-build-events-config-')
    const projectDir = makeTempDir('kairos-build-events-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const writer = await createStateWriter()
    const buildId = 'hash-build'

    await writer.appendBuildEvent(projectDir, buildId, {
      version: 1,
      kind: 'build_created',
      buildId,
      tenantId: 'tenant-local',
      t: '2026-04-25T18:00:00.000Z',
      status: 'draft',
    })
    await writer.appendBuildEvent(projectDir, buildId, {
      version: 1,
      kind: 'spec_written',
      buildId,
      tenantId: 'tenant-local',
      t: '2026-04-25T18:01:00.000Z',
      specPath: '/tmp/spec.md',
    })
    await writer.appendBuildEvent(projectDir, buildId, {
      version: 1,
      kind: 'build_result_written',
      buildId,
      tenantId: 'tenant-local',
      t: '2026-04-25T18:02:00.000Z',
      status: 'succeeded',
      resultPath: '/tmp/result.json',
    })

    const events = await writer.readBuildEvents(projectDir, buildId)
    expect(events).toHaveLength(3)
    expect(events[0]?.auditPrevHash).toBeNull()
    expect(events[0]?.auditHash).toBe(
      calculateKairosBuildEventAuditHash({
        version: 1,
        kind: 'build_created',
        buildId,
        tenantId: 'tenant-local',
        t: '2026-04-25T18:00:00.000Z',
        status: 'draft',
        auditPrevHash: null,
      }),
    )
    expect(events[1]?.auditPrevHash).toBe(events[0]?.auditHash)
    expect(events[1]).toMatchObject({
      kind: 'spec_written',
      specPath: '[redacted]',
    })
    expect(events[1]?.auditHash).toBe(
      calculateKairosBuildEventAuditHash({
        version: 1,
        kind: 'spec_written',
        buildId,
        tenantId: 'tenant-local',
        t: '2026-04-25T18:01:00.000Z',
        specPath: '[redacted]',
        auditPrevHash: events[0]?.auditHash,
      }),
    )
    expect(events[2]?.auditPrevHash).toBe(events[1]?.auditHash)
    expect(events[2]).toMatchObject({
      kind: 'build_result_written',
      resultPath: '[redacted]',
    })
    expect(events[2]?.auditHash).toBe(
      calculateKairosBuildEventAuditHash({
        version: 1,
        kind: 'build_result_written',
        buildId,
        tenantId: 'tenant-local',
        t: '2026-04-25T18:02:00.000Z',
        status: 'succeeded',
        resultPath: '[redacted]',
        auditPrevHash: events[1]?.auditHash,
      }),
    )
  })

  test('rejects invalid build state before writing it', async () => {
    const configDir = makeTempDir('kairos-build-state-invalid-config-')
    const projectDir = makeTempDir('kairos-build-state-invalid-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const writer = await createStateWriter()

    await expect(
      writer.writeBuildManifest(projectDir, {
        version: 1,
        buildId: 'build-123',
        projectDir,
        tenantId: '',
        status: 'draft',
        createdAt: '2026-04-25T18:00:00.000Z',
        updatedAt: '2026-04-25T18:00:00.000Z',
      }),
    ).rejects.toThrow('Invalid KAIROS build manifest')

    await expect(
      writer.appendBuildEvent(projectDir, 'build-123', {
        version: 1,
        kind: 'build_created',
        buildId: 'different-build',
        tenantId: 'tenant-local',
        t: '2026-04-25T18:00:00.000Z',
        status: 'draft',
      }),
    ).rejects.toThrow('does not match path build id')
  })

  test('lists build manifests newest first and ignores malformed build dirs', async () => {
    const configDir = makeTempDir('kairos-build-list-config-')
    const projectDir = makeTempDir('kairos-build-list-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const writer = await createStateWriter()
    await writer.writeBuildManifest(projectDir, {
      version: 1,
      buildId: 'old-build',
      projectDir,
      tenantId: 'tenant-local',
      status: 'draft',
      createdAt: '2026-04-25T18:00:00.000Z',
      updatedAt: '2026-04-25T18:00:00.000Z',
    })
    await writer.writeBuildManifest(projectDir, {
      version: 1,
      buildId: 'new-build',
      projectDir,
      tenantId: 'tenant-local',
      status: 'succeeded',
      createdAt: '2026-04-25T18:10:00.000Z',
      updatedAt: '2026-04-25T18:15:00.000Z',
    })

    const builds = await writer.listBuildManifests(projectDir)
    expect(builds.map(build => build.buildId)).toEqual(['new-build', 'old-build'])
  })
})
