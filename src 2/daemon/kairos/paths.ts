import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function getKairosStateDir(): string {
  return join(getClaudeConfigHomeDir(), 'kairos')
}

export function getKairosStatusPath(): string {
  return join(getKairosStateDir(), 'status.json')
}

export function getKairosStdoutLogPath(): string {
  return join(getKairosStateDir(), 'daemon.out.log')
}

export function getKairosToolsSocketPath(): string {
  return join(getKairosStateDir(), 'tools.sock')
}

export function getKairosGlobalEventsPath(): string {
  return join(getKairosStateDir(), 'events.jsonl')
}

export function getKairosGlobalCostsPath(): string {
  return join(getKairosStateDir(), 'costs.json')
}

export function getKairosPausePath(): string {
  return join(getKairosStateDir(), 'pause.json')
}

export function getKairosCloudDeployStatePath(): string {
  return join(getKairosStateDir(), 'cloud-deploy.json')
}

export function getProjectKairosDir(projectDir: string): string {
  return join(projectDir, '.claude', 'kairos')
}

export function getProjectKairosStatusPath(projectDir: string): string {
  return join(getProjectKairosDir(projectDir), 'status.json')
}

export function getProjectKairosLogPath(projectDir: string): string {
  return join(getProjectKairosDir(projectDir), 'log.jsonl')
}

export function getProjectKairosEventsPath(projectDir: string): string {
  return join(getProjectKairosDir(projectDir), 'events.jsonl')
}

export function getProjectKairosCostsPath(projectDir: string): string {
  return join(getProjectKairosDir(projectDir), 'costs.json')
}

export function assertKairosBuildId(buildId: string): void {
  if (
    !BUILD_ID_PATTERN.test(buildId) ||
    buildId === '.' ||
    buildId === '..'
  ) {
    throw new Error(`Invalid KAIROS build id: ${buildId || '(empty)'}`)
  }
}

export function getProjectKairosBuildsDir(projectDir: string): string {
  return join(getProjectKairosDir(projectDir), 'builds')
}

export function getProjectKairosBuildDir(
  projectDir: string,
  buildId: string,
): string {
  assertKairosBuildId(buildId)
  return join(getProjectKairosBuildsDir(projectDir), buildId)
}

export function getProjectKairosBuildManifestPath(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'manifest.json')
}

export function getProjectKairosBuildSpecPath(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'spec.md')
}

export function getProjectKairosBuildEventsPath(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'events.jsonl')
}

export function getProjectKairosBuildAuditAnchorPath(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'audit-anchor.json')
}

export function getProjectKairosBuildResultPath(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'result.json')
}

export function getProjectKairosBuildEvidenceDir(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'evidence')
}

export function getProjectKairosBuildTranscriptPointerPath(
  projectDir: string,
  buildId: string,
): string {
  return join(getProjectKairosBuildDir(projectDir, buildId), 'transcript-pointer.txt')
}
