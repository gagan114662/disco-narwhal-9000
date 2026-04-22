import { join } from 'path'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type KairosRpcConfig = {
  enabled: boolean
  socketPath: string
  maxCallsPerInvocation: number
  defaultTimeoutSec: number
  maxTimeoutSec: number
  stdoutCapBytes: number
}

const DEFAULT_TIMEOUT_SEC = 60
const MAX_TIMEOUT_SEC = 300
const DEFAULT_MAX_CALLS = 500
const DEFAULT_STDOUT_CAP_BYTES = 16 * 1024

function getDefaultSocketPath(): string {
  return join(getClaudeConfigHomeDir(), 'kairos', 'tools.sock')
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function readKairosRpcRecord(settings: unknown): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object') {
    return null
  }

  const kairos = (settings as Record<string, unknown>).kairos
  if (!kairos || typeof kairos !== 'object') {
    return null
  }

  const rpc = (kairos as Record<string, unknown>).rpc
  if (!rpc || typeof rpc !== 'object') {
    return null
  }

  return rpc as Record<string, unknown>
}

export function getKairosRpcConfig(settings = getInitialSettings()): KairosRpcConfig {
  const rpc = readKairosRpcRecord(settings)

  return {
    enabled: rpc?.enabled === true,
    socketPath:
      typeof rpc?.socketPath === 'string' && rpc.socketPath.length > 0
        ? rpc.socketPath
        : getDefaultSocketPath(),
    maxCallsPerInvocation: clampNumber(
      rpc?.maxCallsPerInvocation,
      DEFAULT_MAX_CALLS,
      1,
      10_000,
    ),
    defaultTimeoutSec: clampNumber(
      rpc?.defaultTimeoutSec,
      DEFAULT_TIMEOUT_SEC,
      1,
      MAX_TIMEOUT_SEC,
    ),
    maxTimeoutSec: clampNumber(
      rpc?.maxTimeoutSec,
      MAX_TIMEOUT_SEC,
      1,
      MAX_TIMEOUT_SEC,
    ),
    stdoutCapBytes: clampNumber(
      rpc?.stdoutCapBytes,
      DEFAULT_STDOUT_CAP_BYTES,
      1024,
      1024 * 1024,
    ),
  }
}
