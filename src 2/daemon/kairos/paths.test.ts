import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  getProjectKairosBuildDir,
  getProjectKairosBuildEventsPath,
  getProjectKairosBuildEvidenceDir,
  getProjectKairosBuildManifestPath,
  getProjectKairosBuildResultPath,
  getProjectKairosBuildSpecPath,
  getProjectKairosBuildTranscriptPointerPath,
  getProjectKairosBuildsDir,
} from './paths.js'

describe('Kairos build paths', () => {
  test('resolves deterministic per-build paths under the project kairos dir', () => {
    const projectDir = '/repo/app'
    const buildId = 'build-123'
    const buildDir = join(projectDir, '.claude', 'kairos', 'builds', buildId)

    expect(getProjectKairosBuildsDir(projectDir)).toBe(
      join(projectDir, '.claude', 'kairos', 'builds'),
    )
    expect(getProjectKairosBuildDir(projectDir, buildId)).toBe(buildDir)
    expect(getProjectKairosBuildManifestPath(projectDir, buildId)).toBe(
      join(buildDir, 'manifest.json'),
    )
    expect(getProjectKairosBuildSpecPath(projectDir, buildId)).toBe(
      join(buildDir, 'spec.md'),
    )
    expect(getProjectKairosBuildEventsPath(projectDir, buildId)).toBe(
      join(buildDir, 'events.jsonl'),
    )
    expect(getProjectKairosBuildResultPath(projectDir, buildId)).toBe(
      join(buildDir, 'result.json'),
    )
    expect(getProjectKairosBuildEvidenceDir(projectDir, buildId)).toBe(
      join(buildDir, 'evidence'),
    )
    expect(getProjectKairosBuildTranscriptPointerPath(projectDir, buildId)).toBe(
      join(buildDir, 'transcript-pointer.txt'),
    )
  })

  test('rejects build ids that can escape the build root', () => {
    expect(() => getProjectKairosBuildDir('/repo/app', '../outside')).toThrow(
      'Invalid KAIROS build id',
    )
    expect(() => getProjectKairosBuildDir('/repo/app', 'nested/build')).toThrow(
      'Invalid KAIROS build id',
    )
    expect(() => getProjectKairosBuildDir('/repo/app', '')).toThrow(
      'Invalid KAIROS build id',
    )
  })
})
