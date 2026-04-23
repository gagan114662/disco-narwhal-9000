import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod/v4'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, '../..')
const DEFAULT_MANIFEST_PATH = resolve(
  DEFAULT_REPO_ROOT,
  'src 2/docs/subsystems.yaml',
)

const testsSchema = z.object({
  files: z.array(z.string().min(1)),
  commands: z.array(z.string().min(1)),
})

const exerciseSchema = z.object({
  commands: z.array(z.string().min(1)),
  tools: z.array(z.string().min(1)),
})

const subsystemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1),
  reviewer_expectation: z.string().min(1),
  change_expectation: z.enum(['trunk-safe', 'trunk-touch']),
  owned_paths: z.array(z.string().min(1)).min(1),
  high_risk_paths: z.array(z.string().min(1)).min(1),
  entry_files: z.array(z.string().min(1)).min(1),
  neighboring_modules: z.array(z.string().min(1)).min(1),
  tests: testsSchema,
  exercise: exerciseSchema,
  common_failure_modes: z.array(z.string().min(1)).min(1),
})

const manifestSchema = z.object({
  schema_version: z.literal(1),
  manifest_owner: z.string().min(1),
  matching_rule: z.string().min(1),
  governance_files: z.array(z.string().min(1)).min(1),
  magic_docs: z.array(z.string().min(1)).min(1),
  subsystems: z.array(subsystemSchema).min(1),
})

type SubsystemManifest = z.infer<typeof manifestSchema>

function resolveFromRepoRoot(repoRoot: string, value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value)
}

function validateExistingPath(
  repoRoot: string,
  value: string,
  label: string,
  errors: string[],
): void {
  const resolvedPath = resolveFromRepoRoot(repoRoot, value)
  if (!existsSync(resolvedPath)) {
    errors.push(`${label} does not exist: ${value}`)
  }
}

function validateUniqueStrings(
  values: string[],
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`Duplicate ${label}: ${value}`)
      continue
    }
    seen.add(value)
  }
}

export function parseSubsystemManifest(rawManifest: string): SubsystemManifest {
  return manifestSchema.parse(parseYaml(rawManifest))
}

export function validateSubsystemManifest(params?: {
  manifestPath?: string
  repoRoot?: string
}): {
  manifest: SubsystemManifest
  manifestPath: string
  repoRoot: string
  checkedPathCount: number
} {
  const repoRoot = params?.repoRoot
    ? resolve(params.repoRoot)
    : DEFAULT_REPO_ROOT
  const manifestPath = params?.manifestPath
    ? resolve(params.manifestPath)
    : DEFAULT_MANIFEST_PATH
  const manifest = parseSubsystemManifest(readFileSync(manifestPath, 'utf8'))
  const errors: string[] = []

  const topLevelPaths = [...manifest.governance_files, ...manifest.magic_docs]
  validateUniqueStrings(
    manifest.subsystems.map(subsystem => subsystem.id),
    'subsystem id',
    errors,
  )
  validateUniqueStrings(topLevelPaths, 'top-level path reference', errors)

  for (const topLevelPath of topLevelPaths) {
    validateExistingPath(repoRoot, topLevelPath, 'Referenced path', errors)
  }

  const ownedPathRegistry = new Map<string, string>()
  let checkedPathCount = topLevelPaths.length

  for (const subsystem of manifest.subsystems) {
    const subsystemPathGroups = [
      ...subsystem.owned_paths,
      ...subsystem.high_risk_paths,
      ...subsystem.entry_files,
      ...subsystem.neighboring_modules,
      ...subsystem.tests.files,
    ]

    validateUniqueStrings(
      subsystem.owned_paths,
      `${subsystem.id} owned_path`,
      errors,
    )
    validateUniqueStrings(
      subsystem.high_risk_paths,
      `${subsystem.id} high_risk_path`,
      errors,
    )
    validateUniqueStrings(
      subsystem.entry_files,
      `${subsystem.id} entry_file`,
      errors,
    )
    validateUniqueStrings(
      subsystem.neighboring_modules,
      `${subsystem.id} neighboring_module`,
      errors,
    )
    validateUniqueStrings(
      subsystem.tests.files,
      `${subsystem.id} test file`,
      errors,
    )

    for (const ownedPath of subsystem.owned_paths) {
      const existingOwner = ownedPathRegistry.get(ownedPath)
      if (existingOwner) {
        errors.push(
          `owned_path ${ownedPath} is claimed by both ${existingOwner} and ${subsystem.id}`,
        )
      } else {
        ownedPathRegistry.set(ownedPath, subsystem.id)
      }
    }

    for (const pathValue of subsystemPathGroups) {
      checkedPathCount += 1
      validateExistingPath(
        repoRoot,
        pathValue,
        `${subsystem.id} path reference`,
        errors,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  return {
    manifest,
    manifestPath,
    repoRoot,
    checkedPathCount,
  }
}

function main(): void {
  const manifestArg = process.argv[2]
  const result = validateSubsystemManifest({
    manifestPath: manifestArg,
  })
  console.log(
    `Validated ${result.manifest.subsystems.length} subsystems and ${result.checkedPathCount} referenced paths in ${result.manifestPath}`,
  )
  console.log('Covered subsystems:')
  for (const subsystem of result.manifest.subsystems) {
    console.log(`- ${subsystem.id}: ${subsystem.name}`)
  }
}

if (import.meta.main) {
  main()
}
