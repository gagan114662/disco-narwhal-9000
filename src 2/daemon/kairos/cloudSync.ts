import { createHash, randomUUID } from 'crypto'
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, relative, resolve, sep } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { gitExe, normalizeGitRemoteUrl } from '../../utils/git.js'
import { parseGitRemote } from '../../utils/detectRepository.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { createProjectRegistry } from './projectRegistry.js'

const CLOUD_SYNC_VERSION = 1
const SOURCE_DIRNAME = 'source'
const OVERLAY_DIRNAME = 'overlay'
const MANIFEST_RELATIVE_PATH = 'manifest.json'
const REGISTRY_RELATIVE_PATH = join('registry', 'projects.json')
const CONFIG_ROOT_RELATIVE_PATH = join('config', '.claude')
const PROJECT_SYNC_ROOT_RELATIVE_PATH = 'project-sync'
const READONLY_MODE = 0o444
const OVERLAY_DIR_MODE = 0o700
const GIT_PROBE_TIMEOUT_MS = 30_000
const SKILL_JUNK_DIRS = new Set(['.git', 'node_modules'])

export class KairosCloudSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KairosCloudSyncError'
  }
}

export type KairosCloudBundleFile = {
  relativePath: string
  sizeBytes: number
  sha256: string
  contentBase64: string
}

export type KairosCloudBundleProject = {
  id: string
  remoteUrl: string
  normalizedRemoteUrl: string
  headRef: string
  headCommit: string
  defaultBranch?: string
  repoHost?: string
  repoOwner?: string
  repoName?: string
  scheduledTasksSyncPath?: string
}

export type KairosCloudStateBundle = {
  version: 1
  createdAt: string
  files: KairosCloudBundleFile[]
  projects: KairosCloudBundleProject[]
}

type AppliedManifest = {
  version: 1
  appliedAt: string
  bundleCreatedAt: string
  managedPaths: string[]
  fileChecksums: Record<string, string>
  projects: KairosCloudBundleProject[]
}

export type ApplyKairosCloudStateBundleResult = {
  sourceDir: string
  overlayDir: string
  manifestPath: string
  registryPath: string
  managedPaths: string[]
}

export type BuildKairosCloudStateBundleOptions = {
  now?: () => Date
  readProjects?: () => Promise<string[]>
  resolveProjectMetadata?: (
    projectDir: string,
  ) => Promise<KairosCloudBundleProject>
}

export type ApplyKairosCloudStateBundleOptions = {
  runtimeRoot: string
  now?: () => Date
}

function toPortableRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function createSha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function isSubpath(candidatePath: string, rootPath: string): boolean {
  const rel = relative(rootPath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

async function getKnownSyncRoots(): Promise<string[]> {
  const home = process.env.HOME || homedir()
  const roots = [
    join(home, 'Dropbox'),
    join(home, 'Dropbox (Personal)'),
    join(home, 'Dropbox (Business)'),
    join(home, 'Google Drive'),
    join(home, 'GoogleDrive'),
    join(home, 'OneDrive'),
    join(home, 'Library', 'Mobile Documents'),
  ]

  const iCloudDesktopSignal = join(
    home,
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs',
    'Desktop',
  )
  if (await pathExists(iCloudDesktopSignal)) {
    roots.push(join(home, 'Documents'))
  }

  return roots
}

export async function assertRuntimeRootOutsideSyncRoots(
  runtimeRoot: string,
): Promise<void> {
  const requestedRoot = resolve(runtimeRoot)
  let resolvedRoot: string
  try {
    resolvedRoot = await realpath(requestedRoot)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new KairosCloudSyncError(
      `Cloud sync runtime root must exist before applying state: ${requestedRoot} (${message})`,
    )
  }

  const knownSyncRoots = await getKnownSyncRoots()
  for (const syncRoot of knownSyncRoots) {
    if (!(await pathExists(syncRoot))) {
      continue
    }
    const resolvedSyncRoot = await realpath(syncRoot).catch(() => null)
    if (!resolvedSyncRoot) {
      continue
    }
    if (isSubpath(resolvedRoot, resolvedSyncRoot)) {
      throw new KairosCloudSyncError(
        `Refusing to apply KAIROS cloud sync inside a user-synced directory. runtimeRoot=${resolvedRoot} is under sync root ${resolvedSyncRoot}. Choose a runtime root outside Dropbox, Google Drive, OneDrive, and iCloud-managed paths.`,
      )
    }
  }
}

async function collectDirectoryFiles(
  sourceDir: string,
  targetRoot: string,
  options: { ignoredDirNames?: Set<string> } = {},
): Promise<KairosCloudBundleFile[]> {
  if (!(await pathExists(sourceDir))) {
    return []
  }

  const out: KairosCloudBundleFile[] = []
  const stack = [sourceDir]

  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (options.ignoredDirNames?.has(entry.name)) {
          continue
        }
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }

      const raw = await readFile(fullPath)
      const rel = relative(sourceDir, fullPath)
      out.push({
        relativePath: toPortableRelativePath(join(targetRoot, rel)),
        sizeBytes: raw.byteLength,
        sha256: createSha256(raw),
        contentBase64: raw.toString('base64'),
      })
    }
  }

  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return out
}

async function collectSkillFiles(configDir: string): Promise<KairosCloudBundleFile[]> {
  const skillsRoot = join(configDir, 'skills')
  if (!(await pathExists(skillsRoot))) {
    return []
  }

  const out: KairosCloudBundleFile[] = []
  const stack = [skillsRoot]

  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKILL_JUNK_DIRS.has(entry.name)) {
          continue
        }
        if (current === skillsRoot && entry.name.startsWith('.')) {
          continue
        }
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile() || entry.name !== 'SKILL.md') {
        continue
      }

      const skillDir = current
      out.push(
        ...(await collectDirectoryFiles(
          skillDir,
          join(CONFIG_ROOT_RELATIVE_PATH, 'skills', relative(skillsRoot, skillDir)),
          { ignoredDirNames: SKILL_JUNK_DIRS },
        )),
      )
    }
  }

  const deduped = new Map<string, KairosCloudBundleFile>()
  for (const file of out) {
    deduped.set(file.relativePath, file)
  }
  return [...deduped.values()].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  )
}

async function collectKairosMemoryFiles(
  configDir: string,
): Promise<KairosCloudBundleFile[]> {
  const files: KairosCloudBundleFile[] = []

  files.push(
    ...(await maybeCollectSingleFile(
      join(configDir, 'memory', 'sessions.db'),
      join(CONFIG_ROOT_RELATIVE_PATH, 'memory', 'sessions.db'),
    )),
  )
  files.push(
    ...(await collectDirectoryFiles(
      join(configDir, 'memory', '.pending-proposals'),
      join(CONFIG_ROOT_RELATIVE_PATH, 'memory', '.pending-proposals'),
    )),
  )
  files.push(
    ...(await collectDirectoryFiles(
      join(configDir, 'memory', '.archived-proposals'),
      join(CONFIG_ROOT_RELATIVE_PATH, 'memory', '.archived-proposals'),
    )),
  )

  return files
}

async function maybeCollectSingleFile(
  sourcePath: string,
  relativePath: string,
): Promise<KairosCloudBundleFile[]> {
  if (!(await pathExists(sourcePath))) {
    return []
  }
  const raw = await readFile(sourcePath)
  return [
    {
      relativePath: toPortableRelativePath(relativePath),
      sizeBytes: raw.byteLength,
      sha256: createSha256(raw),
      contentBase64: raw.toString('base64'),
    },
  ]
}

async function readProjectsFromRegistry(): Promise<string[]> {
  const registry = await createProjectRegistry()
  return registry.read()
}

async function gitString(
  projectDir: string,
  args: string[],
  errorContext: string,
): Promise<string> {
  const result = await execFileNoThrowWithCwd(gitExe(), args, {
    cwd: projectDir,
    timeout: GIT_PROBE_TIMEOUT_MS,
    preserveOutputOnError: true,
  })
  if (result.code !== 0) {
    throw new KairosCloudSyncError(
      `Project ${projectDir} ${errorContext}: ${result.stderr.trim() || result.error || 'git command failed'}`,
    )
  }
  const value = result.stdout.trim()
  if (!value) {
    throw new KairosCloudSyncError(
      `Project ${projectDir} ${errorContext}: empty git output`,
    )
  }
  return value
}

export async function resolveKairosCloudProjectMetadata(
  projectDir: string,
): Promise<KairosCloudBundleProject> {
  const remoteUrl = await gitString(
    projectDir,
    ['remote', 'get-url', 'origin'],
    'has no git remote configured',
  )

  const probe = await execFileNoThrowWithCwd(
    gitExe(),
    ['ls-remote', '--exit-code', remoteUrl, 'HEAD'],
    {
      cwd: projectDir,
      timeout: GIT_PROBE_TIMEOUT_MS,
      preserveOutputOnError: true,
    },
  )
  if (probe.code !== 0) {
    throw new KairosCloudSyncError(
      `Project ${projectDir} has no reachable git remote: ${remoteUrl}`,
    )
  }

  const headRef = await gitString(
    projectDir,
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    'could not resolve the current branch',
  )
  const headCommit = await gitString(
    projectDir,
    ['rev-parse', 'HEAD'],
    'could not resolve HEAD',
  )

  const defaultBranchResult = await execFileNoThrowWithCwd(
    gitExe(),
    ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
    {
      cwd: projectDir,
      timeout: GIT_PROBE_TIMEOUT_MS,
      preserveOutputOnError: true,
    },
  )
  const defaultBranch =
    defaultBranchResult.code === 0
      ? defaultBranchResult.stdout.trim().split('/').pop()
      : undefined

  const normalizedRemoteUrl = normalizeGitRemoteUrl(remoteUrl) ?? remoteUrl
  const parsedRemote = parseGitRemote(remoteUrl)
  const id = createHash('sha256')
    .update(`${normalizedRemoteUrl}\n${headRef === 'HEAD' ? headCommit : headRef}`)
    .digest('hex')
    .slice(0, 16)

  return {
    id,
    remoteUrl,
    normalizedRemoteUrl,
    headRef,
    headCommit,
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(parsedRemote
      ? {
          repoHost: parsedRemote.host,
          repoOwner: parsedRemote.owner,
          repoName: parsedRemote.name,
        }
      : {}),
  }
}

export async function buildKairosCloudStateBundle(
  options: BuildKairosCloudStateBundleOptions = {},
): Promise<KairosCloudStateBundle> {
  const now = options.now ?? (() => new Date())
  const configDir = getClaudeConfigHomeDir()
  const readProjects = options.readProjects ?? readProjectsFromRegistry
  const resolveProjectMetadata =
    options.resolveProjectMetadata ?? resolveKairosCloudProjectMetadata

  const files: KairosCloudBundleFile[] = []
  files.push(...(await collectSkillFiles(configDir)))
  files.push(...(await collectKairosMemoryFiles(configDir)))

  const projects = await readProjects()
  const resolvedProjects: KairosCloudBundleProject[] = []
  for (const projectDir of [...projects].sort()) {
    const project = await resolveProjectMetadata(projectDir)
    const scheduledTasksSyncPath = toPortableRelativePath(
      join(PROJECT_SYNC_ROOT_RELATIVE_PATH, project.id, '.claude', 'scheduled_tasks.json'),
    )
    files.push(
      ...(await maybeCollectSingleFile(
        join(projectDir, '.claude', 'scheduled_tasks.json'),
        scheduledTasksSyncPath,
      )),
    )
    resolvedProjects.push({
      ...project,
      ...(await pathExists(join(projectDir, '.claude', 'scheduled_tasks.json'))
        ? { scheduledTasksSyncPath }
        : {}),
    })
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  resolvedProjects.sort((a, b) => a.id.localeCompare(b.id))

  return {
    version: CLOUD_SYNC_VERSION,
    createdAt: now().toISOString(),
    files,
    projects: resolvedProjects,
  }
}

export function getKairosCloudSourceDir(runtimeRoot: string): string {
  return join(runtimeRoot, SOURCE_DIRNAME)
}

export function getKairosCloudOverlayDir(runtimeRoot: string): string {
  return join(runtimeRoot, OVERLAY_DIRNAME)
}

export function getKairosCloudRegistryPath(runtimeRoot: string): string {
  return join(getKairosCloudSourceDir(runtimeRoot), REGISTRY_RELATIVE_PATH)
}

export function getKairosCloudManifestPath(runtimeRoot: string): string {
  return join(getKairosCloudSourceDir(runtimeRoot), MANIFEST_RELATIVE_PATH)
}

export function getKairosCloudOverlayStateDir(runtimeRoot: string): string {
  return join(getKairosCloudOverlayDir(runtimeRoot), 'config', '.claude', 'kairos')
}

export function getKairosCloudProjectOverlayDir(
  runtimeRoot: string,
  projectId: string,
): string {
  return join(
    getKairosCloudOverlayDir(runtimeRoot),
    'projects',
    projectId,
    '.claude',
    'kairos',
  )
}

function createRegistryContent(bundle: KairosCloudStateBundle): Buffer {
  return Buffer.from(
    `${jsonStringify(
      {
        version: CLOUD_SYNC_VERSION,
        syncedAt: bundle.createdAt,
        projects: bundle.projects,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function createManifestContent(
  appliedAt: string,
  bundle: KairosCloudStateBundle,
  managedPaths: string[],
): Buffer {
  const fileChecksums: Record<string, string> = {}
  for (const file of bundle.files) {
    fileChecksums[file.relativePath] = file.sha256
  }
  fileChecksums[REGISTRY_RELATIVE_PATH] = createSha256(createRegistryContent(bundle))

  const manifest: AppliedManifest = {
    version: CLOUD_SYNC_VERSION,
    appliedAt,
    bundleCreatedAt: bundle.createdAt,
    managedPaths,
    fileChecksums,
    projects: bundle.projects,
  }

  return Buffer.from(`${jsonStringify(manifest, null, 2)}\n`, 'utf8')
}

async function readAppliedManifest(
  manifestPath: string,
): Promise<AppliedManifest | null> {
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppliedManifest>
    if (
      parsed.version !== CLOUD_SYNC_VERSION ||
      !Array.isArray(parsed.managedPaths) ||
      typeof parsed.bundleCreatedAt !== 'string' ||
      typeof parsed.appliedAt !== 'string'
    ) {
      return null
    }
    return {
      version: CLOUD_SYNC_VERSION,
      appliedAt: parsed.appliedAt,
      bundleCreatedAt: parsed.bundleCreatedAt,
      managedPaths: parsed.managedPaths.filter(
        value => typeof value === 'string',
      ),
      fileChecksums:
        parsed.fileChecksums && typeof parsed.fileChecksums === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.fileChecksums).filter(
                ([key, value]) =>
                  typeof key === 'string' && typeof value === 'string',
              ),
            )
          : {},
      projects: Array.isArray(parsed.projects)
        ? (parsed.projects as KairosCloudBundleProject[])
        : [],
    }
  } catch {
    return null
  }
}

async function pruneEmptyParents(
  startDir: string,
  stopDir: string,
): Promise<void> {
  let current = startDir
  while (current.startsWith(stopDir) && current !== stopDir) {
    const entries = await readdir(current).catch(() => null)
    if (!entries || entries.length > 0) {
      return
    }
    await rm(current, { recursive: false, force: true }).catch(() => {})
    current = dirname(current)
  }
}

async function writeManagedFile(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${randomUUID()}.tmp`
  await writeFile(tempPath, content)
  await rename(tempPath, path)
  await chmod(path, READONLY_MODE)
}

export async function applyKairosCloudStateBundle(
  bundle: KairosCloudStateBundle,
  options: ApplyKairosCloudStateBundleOptions,
): Promise<ApplyKairosCloudStateBundleResult> {
  const now = options.now ?? (() => new Date())
  await assertRuntimeRootOutsideSyncRoots(options.runtimeRoot)
  const sourceDir = getKairosCloudSourceDir(options.runtimeRoot)
  const overlayDir = getKairosCloudOverlayDir(options.runtimeRoot)
  const manifestPath = getKairosCloudManifestPath(options.runtimeRoot)
  const registryPath = getKairosCloudRegistryPath(options.runtimeRoot)

  await mkdir(sourceDir, { recursive: true })
  await mkdir(getKairosCloudOverlayStateDir(options.runtimeRoot), {
    recursive: true,
    mode: OVERLAY_DIR_MODE,
  })
  for (const project of bundle.projects) {
    await mkdir(getKairosCloudProjectOverlayDir(options.runtimeRoot, project.id), {
      recursive: true,
      mode: OVERLAY_DIR_MODE,
    })
  }

  const managedFiles = new Map<string, Buffer>()
  for (const file of bundle.files) {
    managedFiles.set(file.relativePath, Buffer.from(file.contentBase64, 'base64'))
  }
  managedFiles.set(REGISTRY_RELATIVE_PATH, createRegistryContent(bundle))

  const managedPaths = [...managedFiles.keys(), MANIFEST_RELATIVE_PATH].sort()
  const appliedAt = now().toISOString()
  managedFiles.set(
    MANIFEST_RELATIVE_PATH,
    createManifestContent(appliedAt, bundle, managedPaths),
  )

  const previousManifest = await readAppliedManifest(manifestPath)
  const nextPaths = new Set(managedFiles.keys())
  for (const previousPath of previousManifest?.managedPaths ?? []) {
    if (nextPaths.has(previousPath)) {
      continue
    }
    const fullPath = join(sourceDir, previousPath)
    await rm(fullPath, { force: true })
    await pruneEmptyParents(dirname(fullPath), sourceDir)
  }

  for (const relativePath of [...managedFiles.keys()].sort()) {
    await writeManagedFile(join(sourceDir, relativePath), managedFiles.get(relativePath)!)
  }

  return {
    sourceDir,
    overlayDir,
    manifestPath,
    registryPath,
    managedPaths,
  }
}
