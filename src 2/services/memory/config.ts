import { getInitialSettings } from '../../utils/settings/settings.js'
import { DEFAULT_SESSION_MEMORY_RETENTION_DAYS } from './paths.js'

type KairosMemorySettings = {
  kairos?: {
    memory?: {
      index?: {
        enabled?: boolean
      }
      curation?: {
        enabled?: boolean
      }
      retentionDays?: number
      scoreFloor?: number
    }
  }
}

function getKairosMemorySettings(): KairosMemorySettings['kairos']['memory'] {
  return (getInitialSettings() as KairosMemorySettings).kairos?.memory
}

export function isKairosMemoryIndexEnabled(): boolean {
  return getKairosMemorySettings()?.index?.enabled ?? true
}

export function isKairosMemoryCurationEnabled(): boolean {
  return getKairosMemorySettings()?.curation?.enabled ?? false
}

export function getKairosMemoryRetentionDays(): number {
  const raw = getKairosMemorySettings()?.retentionDays
  return typeof raw === 'number' && raw > 0
    ? Math.floor(raw)
    : DEFAULT_SESSION_MEMORY_RETENTION_DAYS
}

export function getKairosMemoryScoreFloor(): number {
  const raw = getKairosMemorySettings()?.scoreFloor
  return typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : 0.18
}
