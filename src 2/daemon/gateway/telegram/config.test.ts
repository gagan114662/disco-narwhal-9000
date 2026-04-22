import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readTelegramConfig, writeTelegramConfig } from './config.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tg-config-'))
  TEMP_DIRS.push(dir)
  return dir
}

describe('telegram config', () => {
  test('read returns null when the file does not exist', async () => {
    const dir = makeTempDir()
    const path = join(dir, 'telegram.json')
    expect(await readTelegramConfig(path)).toBeNull()
  })

  test('write + read round-trips token and pairedChatIds', async () => {
    const dir = makeTempDir()
    const path = join(dir, 'telegram.json')
    await writeTelegramConfig(
      { token: 'abc', botUsername: 'bot', pairedChatIds: [1, 2] },
      path,
    )

    const read = await readTelegramConfig(path)
    expect(read).toEqual({ token: 'abc', botUsername: 'bot', pairedChatIds: [1, 2] })
  })

  test('write sets mode 0600', async () => {
    const dir = makeTempDir()
    const path = join(dir, 'telegram.json')
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, path)

    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test('read drops garbage / non-integer chat ids instead of throwing', async () => {
    const dir = makeTempDir()
    const path = join(dir, 'telegram.json')
    await writeTelegramConfig(
      { token: 't', pairedChatIds: [1, 2] },
      path,
    )
    // Now overwrite with hand-crafted JSON that includes bad ids
    const { writeFile } = await import('fs/promises')
    await writeFile(
      path,
      JSON.stringify({ token: 't', pairedChatIds: [1, 'bad', -2, 3.5, 4] }),
    )

    const read = await readTelegramConfig(path)
    expect(read).toEqual({ token: 't', pairedChatIds: [1, 4] })
  })

  test('read returns null for missing token (invalid config)', async () => {
    const dir = makeTempDir()
    const path = join(dir, 'telegram.json')
    const { writeFile } = await import('fs/promises')
    await writeFile(path, JSON.stringify({ pairedChatIds: [1] }))

    expect(await readTelegramConfig(path)).toBeNull()
  })
})
