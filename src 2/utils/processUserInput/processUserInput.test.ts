import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../../bootstrap/state.js'
import type { Command } from '../../types/command.js'
import { getContentText } from '../messages.js'
import { createFileStateCacheWithSizeLimit } from '../fileStateCache.js'
import { processUserInput, type ProcessUserInputContext } from './processUserInput.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-user-input-test-'))
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
    getPromptForCommand: async () => [
      {
        type: 'text',
        text: 'Run the deploy checklist before you answer the user.',
      },
    ],
  }
}

function createContext(commands: Command[]): ProcessUserInputContext {
  let appState = getDefaultAppState()

  return {
    options: {
      commands,
      debug: false,
      mainLoopModel: 'sonnet',
      tools: [{ name: 'Skill' }] as any,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [] } as any,
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(16),
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ProcessUserInputContext
}

afterEach(() => {
  setProjectRoot(originalProjectRoot)
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

beforeEach(() => {
  originalProjectRoot = getProjectRoot()
})

describe('processUserInput repo skill autoload', () => {
  test('prepends auto-loaded skill messages before the user prompt', async () => {
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
    setProjectRoot(projectDir)

    const input =
      'Please ship this today with the release checklist and production checks.'
    const result = await processUserInput({
      input,
      mode: 'prompt',
      setToolJSX: () => {},
      context: createContext([
        createPromptCommand('ship-it', 'Runs the deploy checklist.'),
      ]),
      messages: [],
      setUserInputOnProcessing: () => {},
      querySource: 'repl_main_thread',
    })

    expect(result.shouldQuery).toBe(true)

    const texts = result.messages
      .filter(message => message.type === 'user')
      .map(message => getContentText(message.message.content) ?? '')

    const metadataIndex = texts.findIndex(text =>
      text.includes('<command-name>/ship-it</command-name>'),
    )
    const skillPromptIndex = texts.findIndex(text =>
      text.includes('Run the deploy checklist before you answer the user.'),
    )
    const userPromptIndex = texts.findIndex(text => text === input)

    expect(metadataIndex).toBeGreaterThanOrEqual(0)
    expect(skillPromptIndex).toBeGreaterThan(metadataIndex)
    expect(userPromptIndex).toBeGreaterThan(skillPromptIndex)

    expect(
      result.messages.some(
        message =>
          message.type === 'attachment' &&
          message.attachment.type === 'command_permissions',
      ),
    ).toBe(true)

    expect(
      result.messages.some(
        message =>
          message.type === 'attachment' &&
          message.attachment.type === 'repo_skill_resolver',
      ),
    ).toBe(false)
  })
})
