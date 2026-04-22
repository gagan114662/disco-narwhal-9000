// Uninstall the KAIROS LaunchAgent — bootout from launchd, then remove the
// plist. Safe to call when the agent isn't currently loaded.
//
// Usage from the workspace root:
//   bun run ./daemon/kairos/install/uninstall.ts

import { rm } from 'fs/promises'
import { promisify } from 'util'
import { execFile as execFileCb } from 'child_process'
import { userInfo } from 'os'
import {
  getKairosPlistPath,
  getLaunchctlServiceTarget,
  KAIROS_LAUNCH_AGENT_LABEL,
} from './plist.js'
import type { LaunchctlRunner } from './install.js'

const execFile = promisify(execFileCb)

const defaultRunner: LaunchctlRunner = async args => {
  const { stdout, stderr } = await execFile('launchctl', [...args])
  return { stdout, stderr }
}

export type UninstallKairosOptions = {
  plistPath?: string
  uid?: number
  launchctl?: LaunchctlRunner
}

export async function uninstallKairosLaunchAgent(
  options: UninstallKairosOptions = {},
): Promise<{ plistPath: string; target: string; removed: boolean }> {
  const plistPath = options.plistPath ?? getKairosPlistPath()
  const uid = options.uid ?? userInfo().uid
  const runner = options.launchctl ?? defaultRunner
  const target = getLaunchctlServiceTarget(uid)

  // bootout is idempotent enough in practice, but still throws when the
  // service isn't loaded. Swallow that and fall through to file removal
  // so a half-installed state (plist on disk, service never loaded) also
  // cleans up cleanly.
  try {
    await runner(['bootout', target])
  } catch {
    // ignore — service may not be loaded
  }

  let removed = false
  try {
    await rm(plistPath, { force: false })
    removed = true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code
    if (code !== 'ENOENT') throw err
    // plist already gone — still treat as successful cleanup
  }

  return { plistPath, target, removed }
}

const isMainModule =
  typeof process !== 'undefined' &&
  typeof import.meta !== 'undefined' &&
  typeof import.meta.url === 'string' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  uninstallKairosLaunchAgent()
    .then(({ plistPath, target, removed }) => {
      console.log(`Uninstalled ${KAIROS_LAUNCH_AGENT_LABEL}`)
      console.log(`  target:  ${target}`)
      console.log(`  plist:   ${plistPath}${removed ? '' : ' (already absent)'}`)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`kairos uninstall failed: ${message}`)
      process.exit(1)
    })
}
