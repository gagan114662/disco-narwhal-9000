import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from '../../types/command.js'
import { findRepoResolverMatches } from './repoSkillResolver.js'

const TEMP_DIRS: string[] = []
const REPO_ROOT = join(process.cwd(), '..')

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-skill-resolver-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function createPromptCommand(name: string, description: string): Command {
  return {
    type: 'prompt',
    name,
    description,
    hasUserSpecifiedDescription: true,
    loadedFrom: 'skills',
    source: 'bundled',
    progressMessage: '',
    contentLength: 0,
    getPromptForCommand: async () => [],
  }
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('findRepoResolverMatches', () => {
  test('matches the checked-in permanent structural fix skill', async () => {
    const matches = await findRepoResolverMatches(
      'Turn this failure into a permanent fix with a skill, tests, evals, and a resolver trigger.',
      [
        createPromptCommand(
          'permanent-structural-fix',
          'Codifies repeated failures into a permanent structural fix.',
        ),
      ],
      REPO_ROOT,
    )

    expect(matches).not.toHaveLength(0)
    expect(matches[0]).toMatchObject({
      name: 'permanent-structural-fix',
    })
  })

  test('does not match unrelated requests', async () => {
    const matches = await findRepoResolverMatches(
      'Add a remind command that schedules a cron task.',
      [
        createPromptCommand(
          'permanent-structural-fix',
          'Codifies repeated failures into a permanent structural fix.',
        ),
      ],
      REPO_ROOT,
    )

    expect(matches).toEqual([])
  })

  test('loads generic resolver triggers from any project root', async () => {
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

    const matches = await findRepoResolverMatches(
      'Please ship this today with the release checklist.',
      [createPromptCommand('ship-it', 'Runs the deploy checklist.')],
      projectDir,
    )

    expect(matches).toEqual([
      {
        name: 'ship-it',
        description: 'Runs the deploy checklist.',
        ruleId: 'deploy-phrase',
        score: 4,
      },
    ])
  })
})
