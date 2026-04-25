/**
 * License/policy gate. Walks node_modules, reads each package.json, and fails
 * the build if any direct or transitive dependency's license is on the deny
 * list (or unknown and not explicitly approved).
 *
 * License strings are SPDX-ish; we normalize and compare against allow / deny.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

type PolicyConfig = {
  allow: string[]
  deny: string[]
  exceptions: Record<string, string>
}

const POLICY_PATH = join(import.meta.dir, '..', '.license-policy.json')
const NODE_MODULES = join(import.meta.dir, '..', 'node_modules')

function loadPolicy(): PolicyConfig {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as PolicyConfig
}

type Pkg = {
  name?: string
  version?: string
  license?: string | { type?: string }
  licenses?: Array<string | { type?: string }>
}

function normalizeLicense(p: Pkg): string {
  if (typeof p.license === 'string') return p.license
  if (p.license && typeof p.license === 'object' && p.license.type) {
    return String(p.license.type)
  }
  if (Array.isArray(p.licenses)) {
    const types = p.licenses
      .map(l => (typeof l === 'string' ? l : l?.type ?? ''))
      .filter(Boolean)
    if (types.length > 0) return types.join(' OR ')
  }
  return 'UNKNOWN'
}

function* walkPackageJsons(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e === '.bin' || e === '.cache') continue
    const full = join(dir, e)
    let s
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (!s.isDirectory()) continue
    if (e.startsWith('@')) {
      yield* walkPackageJsons(full)
      continue
    }
    const pj = join(full, 'package.json')
    if (existsSync(pj)) yield pj
    const nested = join(full, 'node_modules')
    if (existsSync(nested)) yield* walkPackageJsons(nested)
  }
}

function classify(license: string, policy: PolicyConfig): 'allow' | 'deny' | 'unknown' {
  const upper = license.toUpperCase()
  for (const d of policy.deny) {
    if (upper.includes(d.toUpperCase())) return 'deny'
  }
  // Multi-license OR expressions: allow if ANY listed license is allowed.
  const parts = license
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+|\/|,/i)
    .map(s => s.trim())
    .filter(Boolean)
  for (const p of parts) {
    if (policy.allow.some(a => p.toUpperCase() === a.toUpperCase())) return 'allow'
  }
  return 'unknown'
}

async function main(): Promise<void> {
  if (!existsSync(NODE_MODULES)) {
    console.error('node_modules missing - run `bun install --frozen-lockfile` first')
    process.exit(2)
  }
  const policy = loadPolicy()

  const denied: Array<{ name: string; version: string; license: string }> = []
  const unknown: Array<{ name: string; version: string; license: string }> = []
  let scanned = 0

  for (const pjPath of walkPackageJsons(NODE_MODULES)) {
    let pkg: Pkg
    try {
      pkg = JSON.parse(readFileSync(pjPath, 'utf8')) as Pkg
    } catch {
      continue
    }
    scanned++
    const name = pkg.name ?? 'unknown'
    const version = pkg.version ?? '0.0.0'
    const license = normalizeLicense(pkg)
    const exceptionLicense = policy.exceptions[name]
    const effective = exceptionLicense ?? license
    const verdict = classify(effective, policy)
    if (verdict === 'deny') denied.push({ name, version, license: effective })
    else if (verdict === 'unknown')
      unknown.push({ name, version, license: effective })
  }

  console.log(`scanned ${scanned} packages`)
  console.log(`denied: ${denied.length}, unknown: ${unknown.length}`)
  if (denied.length > 0) {
    console.error('DENIED LICENSES:')
    for (const d of denied) console.error(`  ${d.name}@${d.version}: ${d.license}`)
  }
  if (unknown.length > 0) {
    console.error('UNKNOWN LICENSES (add to allow list or exceptions):')
    for (const u of unknown.slice(0, 50))
      console.error(`  ${u.name}@${u.version}: ${u.license}`)
    if (unknown.length > 50) console.error(`  ...${unknown.length - 50} more`)
  }
  if (denied.length > 0 || unknown.length > 0) {
    process.exit(1)
  }
  console.log('license check: OK')
}

if (import.meta.main) {
  await main()
}
