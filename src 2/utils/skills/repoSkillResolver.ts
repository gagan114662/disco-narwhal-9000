import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCommandName, type Command } from '../../types/command.js'
import { safeParseJSON } from '../json.js'

export type RepoSkillResolverRule = {
  id: string
  anyPhrases?: string[]
  allTerms?: string[]
  pattern?: string
}

type RepoSkillResolverConfig = {
  skill: string
  description?: string
  rules: RepoSkillResolverRule[]
}

export type RepoSkillResolverMatch = {
  name: string
  description: string
  ruleId: string
  score: number
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function matchesRule(input: string, rule: RepoSkillResolverRule): boolean {
  const hasPhraseMatch =
    rule.anyPhrases?.some(phrase => input.includes(normalizeText(phrase))) ??
    false
  const hasAllTermsMatch =
    rule.allTerms?.every(term => input.includes(normalizeText(term))) ?? false
  const hasPatternMatch = (() => {
    if (!rule.pattern) {
      return false
    }
    try {
      return new RegExp(rule.pattern, 'i').test(input)
    } catch {
      return false
    }
  })()

  return hasPhraseMatch || hasAllTermsMatch || hasPatternMatch
}

function ruleScore(rule: RepoSkillResolverRule): number {
  if (rule.anyPhrases?.length) {
    return 4
  }
  if (rule.allTerms?.length) {
    return Math.max(3, rule.allTerms.length)
  }
  if (rule.pattern) {
    return 2
  }
  return 1
}

async function readResolverConfigs(
  projectRoot: string,
): Promise<RepoSkillResolverConfig[]> {
  const skillsDir = join(projectRoot, '.claude', 'skills')
  let entries: Awaited<ReturnType<typeof readdir>>

  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const configs = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async entry => {
        try {
          const raw = await readFile(
            join(skillsDir, entry.name, 'resolver-trigger.json'),
            'utf8',
          )
          const parsed = safeParseJSON(raw, false)
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            !('skill' in parsed) ||
            typeof parsed.skill !== 'string' ||
            !('rules' in parsed) ||
            !Array.isArray(parsed.rules)
          ) {
            return null
          }

          const rules = parsed.rules.filter(
            (rule): rule is RepoSkillResolverRule =>
              !!rule &&
              typeof rule === 'object' &&
              'id' in rule &&
              typeof rule.id === 'string',
          )

          if (rules.length === 0) {
            return null
          }

          return {
            skill: parsed.skill,
            description:
              'description' in parsed && typeof parsed.description === 'string'
                ? parsed.description
                : undefined,
            rules,
          } satisfies RepoSkillResolverConfig
        } catch {
          return null
        }
      }),
  )

  return configs.filter(config => config !== null)
}

function findCommandBySkillName(
  commands: Command[],
  skillName: string,
): Command | null {
  return (
    commands.find(command => {
      const commandName = getCommandName(command)
      return command.name === skillName || commandName === skillName
    }) ?? null
  )
}

export async function findRepoResolverMatches(
  input: string,
  commands: Command[],
  projectRoot: string,
): Promise<RepoSkillResolverMatch[]> {
  const normalizedInput = normalizeText(input)
  if (!normalizedInput) {
    return []
  }

  const configs = await readResolverConfigs(projectRoot)
  const matches: RepoSkillResolverMatch[] = []

  for (const config of configs) {
    const command = findCommandBySkillName(commands, config.skill)
    if (!command) {
      continue
    }

    for (const rule of config.rules) {
      if (!matchesRule(normalizedInput, rule)) {
        continue
      }

      matches.push({
        name: getCommandName(command),
        description: command.description || config.description || config.skill,
        ruleId: rule.id,
        score: ruleScore(rule),
      })
    }
  }

  return matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    const nameCmp = left.name.localeCompare(right.name)
    if (nameCmp !== 0) {
      return nameCmp
    }
    return left.ruleId.localeCompare(right.ruleId)
  })
}
