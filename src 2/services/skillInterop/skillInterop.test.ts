import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { computeSkillChecksum } from './shared.js'
import { exportSkill, publishSkill } from './exportSkill.js'
import { importSkill } from './importSkill.js'
import { lintSkill } from './lintSkill.js'
import {
  AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
  MAX_SKILL_BODY_BYTES,
} from './manifestSchema.js'
import { getProjectRoot, setProjectRoot } from '../../bootstrap/state.js'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function writeSkill(
  rootDir: string,
  name: string,
  description: string,
  body: string,
): string {
  const skillDir = join(rootDir, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  )
  return skillDir
}

beforeEach(() => {
  originalProjectRoot = getProjectRoot()
  process.env.CLAUDE_CONFIG_DIR = makeTempDir('kairos-skill-config-')
})

afterEach(() => {
  setProjectRoot(originalProjectRoot)
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('skill interop services', () => {
  test('export emits a self-contained discovery manifest that passes lint', async () => {
    const projectDir = makeTempDir('kairos-skill-project-')
    setProjectRoot(projectDir)
    writeSkill(
      join(projectDir, '.claude', 'skills'),
      'example-skill',
      'Example exported skill.',
      'Use this skill to verify export round trips.',
    )

    const manifestText = await exportSkill('example-skill')
    const manifest = JSON.parse(manifestText) as {
      $schema: string
      skills: Array<{ url: string }>
    }

    expect(manifest.$schema).toBe(AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0)
    expect(manifest.skills[0]?.url.startsWith('data:text/markdown;base64,')).toBe(
      true,
    )

    const lintResult = await lintSkill(manifestText)
    expect(lintResult.ok).toBe(true)
  })

  test('publish writes a local discovery manifest artifact', async () => {
    const projectDir = makeTempDir('kairos-skill-publish-')
    setProjectRoot(projectDir)
    writeSkill(
      join(projectDir, '.claude', 'skills'),
      'publish-me',
      'Skill to publish into the local discovery directory.',
      'Use this skill to verify deterministic local publication.',
    )

    const result = await publishSkill('publish-me', {
      now: new Date('2026-04-24T12:00:00Z'),
    })

    const publishDir = join(
      process.env.CLAUDE_CONFIG_DIR as string,
      'kairos',
      'skill-publications',
      'publish-me',
    )
    const manifestPath = join(publishDir, 'discovery.json')
    const publicationPath = join(publishDir, 'publication.json')
    expect(result).toContain(manifestPath)
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(publicationPath)).toBe(true)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      $schema: string
      skills: Array<{ name: string }>
    }
    expect(manifest.$schema).toBe(AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0)
    expect(manifest.skills[0]?.name).toBe('publish-me')

    const publication = JSON.parse(readFileSync(publicationPath, 'utf8')) as {
      publishedAt: string
      skill: string
    }
    expect(publication.publishedAt).toBe('2026-04-24T12:00:00.000Z')
    expect(publication.skill).toBe('publish-me')
  })

  test('local import previews suspicious patterns, then writes provenance and telemetry on confirmation', async () => {
    const sourceRoot = makeTempDir('kairos-skill-source-')
    const skillDir = writeSkill(
      sourceRoot,
      'danger-skill',
      'Demonstrates suspicious pattern warnings.',
      'Run `sudo ls` before checking files.',
    )

    const preview = await importSkill(skillDir)
    expect(preview).toContain('Import preview')
    expect(preview).toContain('Contains `sudo`')

    const importedDir = join(
      process.env.CLAUDE_CONFIG_DIR as string,
      'skills',
      'imported',
      'local',
      'danger-skill',
    )
    expect(existsSync(join(importedDir, 'SKILL.md'))).toBe(false)

    const result = await importSkill(skillDir, {
      confirm: true,
      now: new Date('2026-04-22T15:00:00Z'),
    })
    expect(result).toContain('Imported skill')
    expect(existsSync(join(importedDir, 'SKILL.md'))).toBe(true)

    const provenance = JSON.parse(
      readFileSync(join(importedDir, '.provenance.json'), 'utf8'),
    ) as {
      checksum: string
      importedAt: string
      source: string
    }
    expect(provenance.checksum).toMatch(/^sha256:/)
    expect(provenance.importedAt).toBe('2026-04-22T15:00:00.000Z')
    expect(provenance.source).toContain(skillDir)

    const telemetry = readFileSync(
      join(
        process.env.CLAUDE_CONFIG_DIR as string,
        'kairos',
        'skill-interop-events.jsonl',
      ),
      'utf8',
    )
    expect(telemetry).toContain('"event":"kairos_skill_import"')
    expect(telemetry).toContain('"skill_name":"danger-skill"')
  })

  test('re-import with changed content errors until overwrite is requested', async () => {
    const sourceRoot = makeTempDir('kairos-skill-overwrite-')
    const skillDir = writeSkill(
      sourceRoot,
      'replace-me',
      'Skill to exercise overwrite flow.',
      'Initial content.',
    )

    await importSkill(skillDir, {
      confirm: true,
      now: new Date('2026-04-22T15:00:00Z'),
    })

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: replace-me',
        'description: Skill to exercise overwrite flow.',
        '---',
        '',
        'Updated content with a different body.',
        '',
      ].join('\n'),
    )

    await expect(
      importSkill(skillDir, {
        confirm: true,
      }),
    ).rejects.toThrow('checksum mismatch')

    const preview = await importSkill(skillDir, { overwrite: true })
    expect(preview).toContain('mode: overwrite')
    expect(preview).toContain('Updated content with a different body.')

    const confirmed = await importSkill(skillDir, {
      confirm: true,
      overwrite: true,
      now: new Date('2026-04-22T15:10:00Z'),
    })
    expect(confirmed).toContain('Overwrote')

    const importedSkill = readFileSync(
      join(
        process.env.CLAUDE_CONFIG_DIR as string,
        'skills',
        'imported',
        'local',
        'replace-me',
        'SKILL.md',
      ),
      'utf8',
    )
    expect(importedSkill).toContain('Updated content with a different body.')
  })

  test('remote manifest import supports stubbed http fetches', async () => {
    const markdown = [
      '---',
      'name: example',
      'description: Example remote skill.',
      '---',
      '',
      'Use this skill when testing URL imports.',
      '',
    ].join('\n')
    const manifestUrl = 'https://agentskills.io/skills/example.json'
    const artifactUrl = 'https://agentskills.io/skills/example/SKILL.md'
    const manifest = JSON.stringify({
      $schema: AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
      skills: [
        {
          name: 'example',
          type: 'skill-md',
          description: 'Example remote skill.',
          url: '/skills/example/SKILL.md',
          digest: computeSkillChecksum(Buffer.from(markdown)),
        },
      ],
    })

    const fetchImpl: typeof fetch = async input => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      if (url === manifestUrl) {
        return new Response(manifest, { status: 200 })
      }
      if (url === artifactUrl) {
        return new Response(markdown, { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }

    const preview = await importSkill(manifestUrl, { fetchImpl })
    expect(preview).toContain(`source: ${manifestUrl}`)
    expect(preview).toContain(`manifest: ${AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0}`)

    const result = await importSkill(manifestUrl, {
      confirm: true,
      fetchImpl,
      now: new Date('2026-04-22T15:15:00Z'),
    })
    expect(result).toContain('Imported skill')

    const importedPath = join(
      process.env.CLAUDE_CONFIG_DIR as string,
      'skills',
      'imported',
      'agentskills.io',
      'example',
      'SKILL.md',
    )
    expect(existsSync(importedPath)).toBe(true)
  })

  test('lint reports invalid local skill metadata and oversized bodies', async () => {
    const sourceRoot = makeTempDir('kairos-skill-lint-')
    const skillDir = join(sourceRoot, 'broken-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: Bad Name\n---\n\n${'x'.repeat(MAX_SKILL_BODY_BYTES + 1)}\n`,
    )

    const result = await lintSkill(skillDir)
    expect(result.ok).toBe(false)
    const messages = result.violations.map(v => v.message).join('\n')
    expect(messages).toContain('Invalid skill name')
    expect(messages).toContain('Missing required `description` field')
    expect(messages).toContain('interop limit')
  })

  test('lint rejects unsupported manifest schema versions', async () => {
    const result = await lintSkill(
      JSON.stringify({
        $schema: 'https://schemas.agentskills.io/discovery/9.9.9/schema.json',
        skills: [],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.violations.map(v => v.message).join('\n')).toContain(
      'Unsupported manifest schema',
    )
  })
})
