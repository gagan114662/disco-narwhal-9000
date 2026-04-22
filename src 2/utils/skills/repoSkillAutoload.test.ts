import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from '../../types/command.js'
import { resolveRepoSkillAutoload } from './repoSkillAutoload.js'

const TEMP_DIRS: string[] = []
const REPO_ROOT = join(process.cwd(), '..')

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-skill-autoload-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function createPromptCommand(
  name: string,
  description: string,
  context: 'inline' | 'fork' = 'inline',
): Command {
  return {
    type: 'prompt',
    name,
    description,
    hasUserSpecifiedDescription: true,
    loadedFrom: 'skills',
    source: 'bundled',
    progressMessage: '',
    contentLength: 0,
    context,
    getPromptForCommand: async () => [],
  }
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveRepoSkillAutoload', () => {
  test('selects the checked-in permanent structural fix skill', async () => {
    const decision = await resolveRepoSkillAutoload(
      'Turn this failure into a permanent fix with a skill, tests, evals, and a resolver trigger.',
      [
        createPromptCommand(
          'permanent-structural-fix',
          'Codifies repeated failures into a permanent structural fix.',
        ),
      ],
      REPO_ROOT,
    )

    expect(decision).toMatchObject({
      commandName: 'permanent-structural-fix',
      displayName: 'permanent-structural-fix',
    })
  })

  test('skips skills that are already loaded for the current agent', async () => {
    const decision = await resolveRepoSkillAutoload(
      'Turn this failure into a permanent fix with a skill, tests, evals, and a resolver trigger.',
      [
        createPromptCommand(
          'permanent-structural-fix',
          'Codifies repeated failures into a permanent structural fix.',
        ),
      ],
      REPO_ROOT,
      {
        alreadyLoadedSkillNames: new Set(['permanent-structural-fix']),
      },
    )

    expect(decision).toBeNull()
  })

  test('skips forked skills during auto-load resolution', async () => {
    const projectDir = makeProjectDir()
    const skillDir = join(projectDir, '.claude', 'skills', 'ship-it')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'resolver-trigger.json'),
      JSON.stringify({
        skill: 'ship-it',
        description: 'Routes deploy requests to the ship-it skill.',
        rules: [
          {
            id: 'deploy-phrase',
            anyPhrases: ['ship this today'],
          },
        ],
      }),
    )

    const decision = await resolveRepoSkillAutoload(
      'Please ship this today with the release checklist.',
      [createPromptCommand('ship-it', 'Runs the deploy checklist.', 'fork')],
      projectDir,
    )

    expect(decision).toBeNull()
  })
})
