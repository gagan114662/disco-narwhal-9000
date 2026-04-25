import { readFileSync } from 'fs'
import { join } from 'path'

export type TrunkPatternsFile = {
  patterns: string[]
  fixtures: {
    must_match: string[]
    must_not_match: string[]
  }
}

export const TRUNK_PATTERNS_PATH = join(
  import.meta.dir,
  '..',
  '..',
  '.github',
  'trunk-patterns.json',
)

export function loadTrunkPatterns(path: string = TRUNK_PATTERNS_PATH): TrunkPatternsFile {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as TrunkPatternsFile
  if (!Array.isArray(parsed.patterns)) {
    throw new Error(`trunk-patterns.json missing "patterns" array`)
  }
  return parsed
}

export function compileTrunkPatterns(patterns: string[]): RegExp[] {
  return patterns.map(p => new RegExp(p))
}

export function pathMatchesTrunk(path: string, regexes: RegExp[]): boolean {
  return regexes.some(re => re.test(path))
}

export function findTrunkHits(paths: string[], regexes: RegExp[]): string[] {
  return paths.filter(p => pathMatchesTrunk(p, regexes))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const command = args[0]
  if (command === 'emit-grep-patterns') {
    const { patterns } = loadTrunkPatterns()
    process.stdout.write(patterns.join('\n') + '\n')
    process.exit(0)
  }
  if (command === 'check') {
    const file = args[1]
    if (!file) {
      console.error('usage: trunkPatterns.ts check <changed-files-file>')
      process.exit(2)
    }
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    const { patterns } = loadTrunkPatterns()
    const hits = findTrunkHits(lines, compileTrunkPatterns(patterns))
    if (hits.length > 0) {
      for (const h of hits) console.log(h)
      process.exit(1)
    }
    process.exit(0)
  }
  console.error('usage: trunkPatterns.ts {emit-grep-patterns | check <file>}')
  process.exit(2)
}
