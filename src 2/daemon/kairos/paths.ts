import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export function getKairosStateDir(): string {
  return join(getClaudeConfigHomeDir(), 'kairos')
}

export function getKairosStatusPath(): string {
  return join(getKairosStateDir(), 'status.json')
}

export function getKairosStdoutLogPath(): string {
  return join(getKairosStateDir(), 'daemon.out.log')
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
