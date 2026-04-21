import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { SendUserFileTool } from './SendUserFileTool.js'
import {
  MAX_SEND_USER_FILE_BYTES,
  getUniqueOutputPath,
  sendUserFile,
} from './delivery.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function makeSettingsDir(settings: unknown): string {
  const dir = makeTempDir('send-user-file-settings-')
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}

describe('SendUserFile delivery', () => {
  test('writes a text file and reveals + opens it', async () => {
    const outputDir = makeTempDir('send-user-file-output-')
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({
      sendUserFile: {
        outputDir,
      },
    })

    const execImpl = mock(async () => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const openImpl = mock(async () => true)

    const result = await sendUserFile(
      {
        filename: 'greeting.md',
        content: '# Hello Gagan\n\nIt works!',
      },
      {
        platform: 'macos',
        execFileNoThrow: execImpl,
        openPath: openImpl,
      },
    )

    expect(result.displayPath).toBe(result.path)
    expect(result.path).toBe(join(outputDir, 'greeting.md'))
    expect(readFileSync(result.path, 'utf8')).toBe('# Hello Gagan\n\nIt works!')
    expect(execImpl).toHaveBeenCalledWith(
      'open',
      ['-R', join(outputDir, 'greeting.md')],
      { useCwd: false },
    )
    expect(openImpl).toHaveBeenCalledWith(join(outputDir, 'greeting.md'))
  })

  test('adds numeric suffixes instead of overwriting', async () => {
    const outputDir = makeTempDir('send-user-file-overwrite-')
    writeFileSync(join(outputDir, 'greeting.md'), 'first')
    writeFileSync(join(outputDir, 'greeting-2.md'), 'second')

    const candidate = await getUniqueOutputPath(outputDir, 'greeting.md')

    expect(candidate).toBe(join(outputDir, 'greeting-3.md'))
  })

  test('rejects traversal filenames with a clear error', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({})

    const result = await SendUserFileTool.call({
      filename: '../../etc/hosts',
      content: 'bad',
      openAfter: false,
    })

    expect(result.data).toEqual({
      success: false,
      filename: '../../etc/hosts',
      mimeType: 'text/plain',
      isBase64: false,
      openAfter: false,
      message: 'Filename must be a bare name like `report.md`, not a path.',
      error: 'Filename must be a bare name like `report.md`, not a path.',
    })
  })

  test('writes binary files from base64 content', async () => {
    const outputDir = makeTempDir('send-user-file-binary-')
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({
      sendUserFile: {
        outputDir,
      },
    })

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

    const result = await sendUserFile(
      {
        filename: 'test.png',
        content: pngBase64,
        isBase64: true,
        openAfter: false,
      },
      {
        execFileNoThrow: async () => ({
          stdout: '',
          stderr: '',
          code: 0,
        }),
      },
    )

    expect(result.bytesWritten).toBe(Buffer.from(pngBase64, 'base64').length)
    expect(readFileSync(result.path).toString('base64')).toBe(pngBase64)
  })

  test('rejects files larger than 10 MB', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeSettingsDir({})

    const oversized = 'a'.repeat(MAX_SEND_USER_FILE_BYTES + 1)
    const result = await SendUserFileTool.call({
      filename: 'huge.txt',
      content: oversized,
      openAfter: false,
    })

    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain('10 MB limit')
  })
})
