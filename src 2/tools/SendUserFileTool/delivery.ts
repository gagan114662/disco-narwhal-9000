import { mkdir, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, sep } from 'path'
import { homedir } from 'os'
import { openPath } from '../../utils/browser.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { pathExists } from '../../utils/file.js'
import { expandPath } from '../../utils/path.js'
import { getPlatform, type Platform } from '../../utils/platform.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

const DEFAULT_MIME_TYPE = 'text/plain'
export const MAX_SEND_USER_FILE_BYTES = 10 * 1024 * 1024

export type SendUserFileInput = {
  filename: string
  content: string
  mimeType?: string
  isBase64?: boolean
  openAfter?: boolean
}

export type SendUserFileSettings = {
  outputDir?: string
}

type SettingsShape = {
  sendUserFile?: SendUserFileSettings
}

type ExecResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

export type DeliveryDependencies = {
  homeDir?: string
  platform?: Platform
  pathExists?: typeof pathExists
  mkdir?: (path: string) => Promise<void>
  writeFile?: (path: string, data: string | Uint8Array) => Promise<void>
  execFileNoThrow?: (
    file: string,
    args: string[],
    options?: { useCwd?: boolean },
  ) => Promise<ExecResult>
  openPath?: typeof openPath
}

export type SendUserFileDelivery = {
  path: string
  displayPath: string
  outputDir: string
  bytesWritten: number
  mimeType: string
  revealed: boolean
  opened: boolean
}

export class SendUserFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendUserFileError'
  }
}

function getSettings(): SettingsShape {
  return (getSettings_DEPRECATED() || {}) as SettingsShape
}

export function validateSendUserFilename(filename: string): void {
  const trimmed = filename.trim()
  if (!trimmed) {
    throw new SendUserFileError('Filename is required.')
  }
  if (trimmed !== basename(trimmed)) {
    throw new SendUserFileError(
      'Filename must be a bare name like `report.md`, not a path.',
    )
  }
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    isAbsolute(trimmed) ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    throw new SendUserFileError(
      'Filename must be a bare name like `report.md`, not a path.',
    )
  }
}

export function decodeSendUserFileContent(
  content: string,
  isBase64: boolean,
): Uint8Array {
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(content, 'base64'))
    : Uint8Array.from(Buffer.from(content, 'utf8'))

  if (bytes.byteLength > MAX_SEND_USER_FILE_BYTES) {
    throw new SendUserFileError(
      `File content exceeds the 10 MB limit (${bytes.byteLength} bytes).`,
    )
  }

  return bytes
}

export async function getSendUserFileOutputDir(
  {
    homeDir = homedir(),
    pathExists: pathExistsImpl = pathExists,
  }: Pick<DeliveryDependencies, 'homeDir' | 'pathExists'> = {},
): Promise<string> {
  const configuredDir = getSettings().sendUserFile?.outputDir?.trim()
  if (configuredDir) {
    return expandPath(configuredDir)
  }

  const downloadsDir = join(homeDir, 'Downloads')
  if (await pathExistsImpl(downloadsDir)) {
    return downloadsDir
  }

  return homeDir
}

export async function getUniqueOutputPath(
  outputDir: string,
  filename: string,
  pathExistsImpl: typeof pathExists = pathExists,
): Promise<string> {
  const extension = extname(filename)
  const baseName =
    extension.length > 0 ? filename.slice(0, -extension.length) : filename

  let attempt = 1
  while (true) {
    const candidate =
      attempt === 1
        ? filename
        : `${baseName}-${attempt}${extension || ''}`
    const candidatePath = join(outputDir, candidate)
    if (!(await pathExistsImpl(candidatePath))) {
      return candidatePath
    }
    attempt += 1
  }
}

function toDisplayPath(filePath: string, homeDir: string): string {
  return filePath.startsWith(homeDir + sep)
    ? `~${filePath.slice(homeDir.length)}`
    : filePath
}

export async function revealWrittenFile(
  filePath: string,
  {
    platform = getPlatform(),
    execFileNoThrow: execImpl = execFileNoThrow,
  }: Pick<DeliveryDependencies, 'platform' | 'execFileNoThrow'> = {},
): Promise<boolean> {
  if (platform === 'unknown') {
    return false
  }

  const command =
    platform === 'macos'
      ? { file: 'open', args: ['-R', filePath] }
      : platform === 'windows'
        ? { file: 'explorer', args: [`/select,${filePath}`] }
        : { file: 'xdg-open', args: [dirname(filePath)] }

  const result = await execImpl(command.file, command.args, { useCwd: false })
  return result.code === 0
}

export async function openWrittenFile(
  filePath: string,
  {
    openPath: openPathImpl = openPath,
  }: Pick<DeliveryDependencies, 'openPath'> = {},
): Promise<boolean> {
  return openPathImpl(filePath)
}

export async function sendUserFile(
  input: SendUserFileInput,
  deps: DeliveryDependencies = {},
): Promise<SendUserFileDelivery> {
  validateSendUserFilename(input.filename)

  const bytes = decodeSendUserFileContent(input.content, input.isBase64 ?? false)
  const homeDir = deps.homeDir ?? homedir()
  const outputDir = await getSendUserFileOutputDir({
    homeDir,
    pathExists: deps.pathExists,
  })
  const writePath = await getUniqueOutputPath(
    outputDir,
    input.filename.trim(),
    deps.pathExists,
  )

  const mkdirImpl = deps.mkdir ?? (path => mkdir(path, { recursive: true }))
  const writeFileImpl = deps.writeFile ?? ((path, data) => writeFile(path, data))

  await mkdirImpl(outputDir)
  await writeFileImpl(writePath, bytes)

  const revealed = await revealWrittenFile(writePath, deps)
  const openAfter = input.openAfter ?? true
  const opened = openAfter ? await openWrittenFile(writePath, deps) : false

  return {
    path: writePath,
    displayPath: toDisplayPath(writePath, homeDir),
    outputDir,
    bytesWritten: bytes.byteLength,
    mimeType: input.mimeType || DEFAULT_MIME_TYPE,
    revealed,
    opened,
  }
}
