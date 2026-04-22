import { getCommandName, type Command } from '../../types/command.js'
import { findRepoResolverMatches } from './repoSkillResolver.js'

export type RepoSkillAutoloadDecision = {
  commandName: string
  displayName: string
  description: string
  ruleId: string
}

type RepoSkillAutoloadOptions = {
  alreadyLoadedSkillNames?: ReadonlySet<string>
}

export async function resolveRepoSkillAutoload(
  input: string,
  commands: Command[],
  projectRoot: string,
  options: RepoSkillAutoloadOptions = {},
): Promise<RepoSkillAutoloadDecision | null> {
  const alreadyLoadedSkillNames = options.alreadyLoadedSkillNames ?? new Set()
  const matches = await findRepoResolverMatches(input, commands, projectRoot)

  for (const match of matches) {
    const command =
      commands.find(candidate => candidate.name === match.name) ??
      commands.find(candidate => getCommandName(candidate) === match.name)

    if (!command || command.type !== 'prompt') {
      continue
    }

    if (alreadyLoadedSkillNames.has(command.name)) {
      continue
    }

    return {
      commandName: command.name,
      displayName: getCommandName(command),
      description: command.description,
      ruleId: match.ruleId,
    }
  }

  return null
}
