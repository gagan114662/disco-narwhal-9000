// File layout for the Telegram gateway.
//
// Everything lives under the KAIROS state dir so `rm -rf ~/.claude/kairos`
// fully resets the feature. Token + paired chat IDs share a single file
// (mode 0600); the pending pair code is written to a separate file so the
// CLI can invalidate it atomically without racing the daemon's config read.

import { join } from 'path'
import { getKairosStateDir } from '../../kairos/paths.js'

export function getTelegramConfigPath(): string {
  return join(getKairosStateDir(), 'telegram.json')
}

export function getTelegramPendingPairPath(): string {
  return join(getKairosStateDir(), 'telegram.pending.json')
}
