/**
 * Reproducibility check: build twice from a frozen lockfile, hash the bundle,
 * and fail if the hashes differ. Catches nondeterministic build steps.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'

const BUNDLE = join(import.meta.dir, '..', 'dist', 'cli.js')

function runBun(args: string[]): void {
  // Hardcoded executable name avoids the
  // javascript.lang.security.detect-child-process semgrep finding (which
  // triggers when spawnSync's command argument is parameterized). All call
  // sites here only ever shell out to `bun run build`.
  const r = spawnSync('bun', args, {
    cwd: join(import.meta.dir, '..'),
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    throw new Error(`bun ${args.join(' ')} exited ${r.status}`)
  }
}

function hashBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(`bundle missing at ${BUNDLE} after build`)
  }
  const buf = readFileSync(BUNDLE)
  const sha = createHash('sha256').update(buf).digest('hex')
  console.log(`bundle ${BUNDLE} size=${statSync(BUNDLE).size} sha256=${sha}`)
  return sha
}

async function main(): Promise<void> {
  console.log('--- build #1 ---')
  runBun(['run', 'build'])
  const sha1 = hashBundle()

  console.log('--- build #2 ---')
  runBun(['run', 'build'])
  const sha2 = hashBundle()

  if (sha1 !== sha2) {
    console.error(`reproducibility FAIL:\n  build1 sha256=${sha1}\n  build2 sha256=${sha2}`)
    process.exit(1)
  }
  console.log('reproducibility: OK (identical bundle hashes)')
}

if (import.meta.main) {
  await main()
}
