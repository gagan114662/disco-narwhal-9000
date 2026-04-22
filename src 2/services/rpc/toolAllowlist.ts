import type { Tool, ToolPermissionContext, Tools } from '../../Tool.js'

const RPC_SAFE_TOOL_NAMES = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TaskList',
  'TaskGet',
])

const LEGACY_TOOL_NAME_ALIASES: Record<string, string> = {
  ReadFile: 'Read',
}

export function normalizeRpcToolName(name: string): string {
  return LEGACY_TOOL_NAME_ALIASES[name] ?? name
}

export function applyLegacyRpcInputAliases(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === 'Read' && typeof args.path === 'string' && args.file_path === undefined) {
    return {
      ...args,
      file_path: args.path,
    }
  }
  return args
}

export function filterRpcTools(
  tools: Tools,
  parentAllowedTools: readonly string[],
): Tool[] {
  const allowed = new Set(parentAllowedTools.map(normalizeRpcToolName))
  return tools.filter(
    tool => RPC_SAFE_TOOL_NAMES.has(tool.name) && allowed.has(tool.name),
  )
}

export function getRpcAllowedToolNames(
  tools: Tools,
  permissionContext: ToolPermissionContext,
): string[] {
  const denied = new Set(
    Object.values(permissionContext.alwaysDenyRules)
      .flat()
      .filter(rule => !rule.includes('(')),
  )
  return tools
    .filter(tool => RPC_SAFE_TOOL_NAMES.has(tool.name) && !denied.has(tool.name))
    .map(tool => tool.name)
}

