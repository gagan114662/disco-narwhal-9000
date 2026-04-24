import { exportSkill, publishSkill } from '../services/skillInterop/exportSkill.js'
import { importSkill } from '../services/skillInterop/importSkill.js'
import { lintSkill } from '../services/skillInterop/lintSkill.js'
import { formatViolations } from '../services/skillInterop/shared.js'

const HELP_TEXT = `Usage:
/kairos skills lint <path|skill-name|manifest-json>
/kairos skills import <url|path|manifest-json> [--yes] [--overwrite]
/kairos skills export <path|skill-name>
/kairos skills export <path|skill-name> --publish`

export async function runKairosSkillsInteropCommand(args: string): Promise<string> {
  const trimmed = args.trim()
  if (!trimmed) {
    return HELP_TEXT
  }

  const [subcommand, ...restTokens] = trimmed.split(/\s+/)
  const restRaw = trimmed.slice(subcommand.length).trim()

  switch (subcommand) {
    case 'lint': {
      if (!restRaw) return HELP_TEXT
      const result = await lintSkill(restRaw)
      return result.ok ? 'valid' : formatViolations(result.violations)
    }
    case 'import': {
      const parsed = parseImportArgs(restRaw)
      if (!parsed.source) return HELP_TEXT
      return importSkill(parsed.source, {
        confirm: parsed.confirm,
        overwrite: parsed.overwrite,
      })
    }
    case 'export': {
      const parsed = parseExportArgs(restTokens)
      if (!parsed.reference) return HELP_TEXT
      if (parsed.publish) {
        return publishSkill(parsed.reference)
      }
      return exportSkill(parsed.reference)
    }
    default:
      return HELP_TEXT
  }
}

export function parseImportArgs(raw: string): {
  source: string
  confirm: boolean
  overwrite: boolean
} {
  let working = raw.trim()
  if (!working) {
    return { source: '', confirm: false, overwrite: false }
  }

  let confirm = false
  let overwrite = false

  while (working.startsWith('--')) {
    if (working === '--yes' || working.startsWith('--yes ')) {
      confirm = true
      working = working.slice('--yes'.length).trim()
      continue
    }
    if (working === '--overwrite' || working.startsWith('--overwrite ')) {
      overwrite = true
      working = working.slice('--overwrite'.length).trim()
      continue
    }
    break
  }

  if (working.startsWith('{')) {
    return { source: working, confirm, overwrite }
  }

  const tokens = working.split(/\s+/).filter(Boolean)
  confirm = confirm || tokens.includes('--yes')
  overwrite = overwrite || tokens.includes('--overwrite')
  const source = tokens
    .filter(token => token !== '--yes' && token !== '--overwrite')
    .join(' ')

  return { source, confirm, overwrite }
}

function parseExportArgs(tokens: string[]): {
  reference: string
  publish: boolean
} {
  const publish = tokens.includes('--publish')
  const reference = tokens
    .filter(token => token !== '--publish')
    .join(' ')

  return { reference, publish }
}
