import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSubsystemManifest } from './validateSubsystems.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(MODULE_DIR, '../..')

function writeFileEnsuringDir(path: string, contents = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

describe('validateSubsystemManifest', () => {
  test('accepts the checked-in subsystem manifest', () => {
    const result = validateSubsystemManifest({
      repoRoot: REPO_ROOT,
      manifestPath: join(REPO_ROOT, 'src 2/docs/subsystems.yaml'),
    })
    expect(result.manifest.subsystems.length).toBeGreaterThanOrEqual(6)
    expect(result.checkedPathCount).toBeGreaterThan(0)
  })

  test('rejects a manifest with a missing referenced path', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'subsystems-fixture-'))
    try {
      writeFileEnsuringDir(join(repoRoot, '.github/CODEOWNERS'))
      writeFileEnsuringDir(join(repoRoot, 'docs/navigation.md'), '# MAGIC DOC: Nav\n')
      writeFileEnsuringDir(join(repoRoot, 'src/entry.ts'))

      const manifestPath = join(repoRoot, 'docs/subsystems.yaml')
      writeFileSync(
        manifestPath,
        `schema_version: 1
manifest_owner: "@owner"
matching_rule: "most specific prefix wins"
governance_files:
  - ".github/CODEOWNERS"
magic_docs:
  - "docs/navigation.md"
subsystems:
  - id: "fixture"
    name: "Fixture"
    owner: "@owner"
    reviewer_expectation: "Test fixture."
    change_expectation: "trunk-safe"
    owned_paths:
      - "src/"
    high_risk_paths:
      - "src/missing.ts"
    entry_files:
      - "src/entry.ts"
    neighboring_modules:
      - "src/entry.ts"
    tests:
      files: []
      commands:
        - "bun test"
    exercise:
      commands:
        - "bun run fixture"
      tools: []
    common_failure_modes:
      - "Fixture failure."
`,
      )

      expect(() =>
        validateSubsystemManifest({
          repoRoot,
          manifestPath,
        }),
      ).toThrow(/src\/missing\.ts/)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
