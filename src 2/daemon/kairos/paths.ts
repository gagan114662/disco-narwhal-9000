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
