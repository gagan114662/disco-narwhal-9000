import { randomBytes } from 'crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import type { AdditionalWorkingDirectory, PermissionMode } from '../../types/permissions.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

type SerializableToolPermissionContext = {
  mode: PermissionMode
  additionalWorkingDirectories: AdditionalWorkingDirectory[]
  alwaysAllowRules: ToolPermissionContext['alwaysAllowRules']
  alwaysDenyRules: ToolPermissionContext['alwaysDenyRules']
  alwaysAskRules: ToolPermissionContext['alwaysAskRules']
  isBypassPermissionsModeAvailable: boolean
  isAutoModeAvailable?: boolean
  strippedDangerousRules?: ToolPermissionContext['strippedDangerousRules']
  shouldAvoidPermissionPrompts?: boolean
  awaitAutomatedChecksBeforeDialog?: boolean
  prePlanMode?: PermissionMode
}

export type RpcGrant = {
  token: string
  createdAt: string
  expiresAt: string
  projectDir: string
  allowedTools: string[]
  permissionContext: SerializableToolPermissionContext
  maxCalls: number
}

function getGrantsDir(): string {
  return join(getClaudeConfigHomeDir(), 'kairos', 'rpc-grants')
}

export function getRpcGrantPath(token: string): string {
  return join(getGrantsDir(), `${token}.json`)
}

export function createAuthToken(): string {
  return randomBytes(24).toString('hex')
}

export function serializeToolPermissionContext(
  context: ToolPermissionContext,
): SerializableToolPermissionContext {
  return {
    mode: context.mode,
    additionalWorkingDirectories: [...context.additionalWorkingDirectories.values()],
    alwaysAllowRules: context.alwaysAllowRules,
    alwaysDenyRules: context.alwaysDenyRules,
    alwaysAskRules: context.alwaysAskRules,
    isBypassPermissionsModeAvailable:
      context.isBypassPermissionsModeAvailable,
    isAutoModeAvailable: context.isAutoModeAvailable,
    strippedDangerousRules: context.strippedDangerousRules,
    shouldAvoidPermissionPrompts: context.shouldAvoidPermissionPrompts,
    awaitAutomatedChecksBeforeDialog:
      context.awaitAutomatedChecksBeforeDialog,
    prePlanMode: context.prePlanMode,
  }
}

export function deserializeToolPermissionContext(
  context: SerializableToolPermissionContext,
): ToolPermissionContext {
  return {
    mode: context.mode,
    additionalWorkingDirectories: new Map(
      context.additionalWorkingDirectories.map(item => [item.path, item]),
    ),
    alwaysAllowRules: context.alwaysAllowRules,
    alwaysDenyRules: context.alwaysDenyRules,
    alwaysAskRules: context.alwaysAskRules,
    isBypassPermissionsModeAvailable:
      context.isBypassPermissionsModeAvailable,
    ...(context.isAutoModeAvailable !== undefined
      ? { isAutoModeAvailable: context.isAutoModeAvailable }
      : {}),
    ...(context.strippedDangerousRules !== undefined
      ? { strippedDangerousRules: context.strippedDangerousRules }
      : {}),
    ...(context.shouldAvoidPermissionPrompts !== undefined
      ? { shouldAvoidPermissionPrompts: context.shouldAvoidPermissionPrompts }
      : {}),
    ...(context.awaitAutomatedChecksBeforeDialog !== undefined
      ? {
          awaitAutomatedChecksBeforeDialog:
            context.awaitAutomatedChecksBeforeDialog,
        }
      : {}),
    ...(context.prePlanMode !== undefined
      ? { prePlanMode: context.prePlanMode }
      : {}),
  }
}

export async function writeRpcGrant(grant: RpcGrant): Promise<void> {
  await mkdir(getGrantsDir(), { recursive: true })
  const path = getRpcGrantPath(grant.token)
  await writeFile(path, `${JSON.stringify(grant, null, 2)}\n`, {
    mode: 0o600,
  })
}

export async function readRpcGrant(token: string): Promise<RpcGrant | null> {
  try {
    const raw = await readFile(getRpcGrantPath(token), 'utf8')
    const parsed = JSON.parse(raw) as RpcGrant
    if (!parsed || parsed.token !== token) {
      return null
    }
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      await deleteRpcGrant(token)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function deleteRpcGrant(token: string): Promise<void> {
  await rm(getRpcGrantPath(token), { force: true })
}

export async function cleanupExpiredRpcGrants(now = Date.now()): Promise<void> {
  await mkdir(getGrantsDir(), { recursive: true })
  for (const entry of await readdir(getGrantsDir())) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const fullPath = join(getGrantsDir(), entry)
    try {
      const raw = await readFile(fullPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<RpcGrant>
      if (
        typeof parsed.expiresAt !== 'string' ||
        Date.parse(parsed.expiresAt) <= now
      ) {
        await rm(fullPath, { force: true })
      }
    } catch {
      await rm(fullPath, { force: true })
    }
  }
}

export async function createRpcGrant(params: {
  projectDir: string
  allowedTools: string[]
  permissionContext: ToolPermissionContext
  maxCalls: number
  expiresAt: Date
}): Promise<RpcGrant> {
  const grant: RpcGrant = {
    token: createAuthToken(),
    createdAt: new Date().toISOString(),
    expiresAt: params.expiresAt.toISOString(),
    projectDir: params.projectDir,
    allowedTools: [...params.allowedTools],
    permissionContext: serializeToolPermissionContext(params.permissionContext),
    maxCalls: params.maxCalls,
  }
  await writeRpcGrant(grant)
  return grant
}

export async function ensureRpcGrantDir(): Promise<void> {
  await mkdir(dirname(getRpcGrantPath('placeholder')), { recursive: true })
}
