import { createHash } from 'crypto'
import { diffLines } from 'diff'
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getProjectRoot } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { safeParseJSON } from '../../utils/json.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
  MAX_SKILL_BODY_BYTES,
  SKILL_NAME_REGEX,
  type DiscoveryManifest,
  discoveryManifestSchema,
} from './manifestSchema.js'

export type SkillInteropViolation = {
  path: string
  message: string
}

export type SkillDocument = {
  markdown: string
  rawBytes: Buffer
  name: string
  description: string
  body: string
}

export type ResolvedSkillSource = {
  sourceKind: 'url' | 'file' | 'json-blob'
  sourceDisplay: string
  sourceHost: string
  manifestSchema: string | null
  manifestUrl: string | null
  artifactUrl: string | null
  checksum: string
  skill: SkillDocument
}

export type ImportTelemetryEvent = {
  event: 'kairos_skill_import'
  timestamp: string
  outcome: 'imported' | 'overwritten'
  source_kind: ResolvedSkillSource['sourceKind']
  source: string
  source_host: string
  manifest_schema: string | null
  manifest_url: string | null
  artifact_url: string | null
  skill_name: string
  checksum: string
  suspicious_pattern_ids: string[]
  suspicious_pattern_count: number
  destination: string
}

type ResolveOptions = {
  fetchImpl?: typeof fetch
  allowRemoteArtifacts?: boolean
}

type ArtifactLoadContext = {
  baseUrl?: string | null
  baseFilePath?: string | null
  allowRemoteArtifacts: boolean
  fetchImpl?: typeof fetch
}

type LoadedArtifact = {
  bytes: Buffer
  resolvedLocation: string
}

export function computeSkillChecksum(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function parseSkillDocument(
  markdown: string,
  rawBytes: Buffer,
  sourceLabel: string,
): SkillDocument {
  const { frontmatter, content } = parseFrontmatter(markdown, sourceLabel)
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
  const description =
    typeof frontmatter.description === 'string'
      ? frontmatter.description.trim()
      : ''

  return {
    markdown,
    rawBytes,
    name,
    description,
    body: content,
  }
}

export function validateSkillDocument(doc: SkillDocument): SkillInteropViolation[] {
  const violations: SkillInteropViolation[] = []

  if (!doc.name) {
    violations.push({
      path: 'frontmatter.name',
      message: 'Missing required `name` field in SKILL.md frontmatter.',
    })
  } else if (!SKILL_NAME_REGEX.test(doc.name)) {
    violations.push({
      path: 'frontmatter.name',
      message:
        'Invalid skill name. Use 1-64 lowercase letters, numbers, or hyphens with no leading, trailing, or consecutive hyphens.',
    })
  }

  if (!doc.description) {
    violations.push({
      path: 'frontmatter.description',
      message: 'Missing required `description` field in SKILL.md frontmatter.',
    })
  }

  if (doc.rawBytes.byteLength > MAX_SKILL_BODY_BYTES) {
    violations.push({
      path: 'body',
      message: `Skill body is ${doc.rawBytes.byteLength} bytes; the KAIROS interop limit is ${MAX_SKILL_BODY_BYTES} bytes.`,
    })
  }

  return violations
}

export function validateDiscoveryManifestObject(
  raw: unknown,
): { manifest: DiscoveryManifest | null; violations: SkillInteropViolation[] } {
  const violations: SkillInteropViolation[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      manifest: null,
      violations: [
        { path: '$', message: 'Manifest must be a JSON object.' },
      ],
    }
  }

  const schemaValue =
    '$schema' in raw && typeof raw.$schema === 'string' ? raw.$schema : null
  if (schemaValue !== AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0) {
    violations.push({
      path: '$schema',
      message: `Unsupported manifest schema. Expected ${AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0}.`,
    })
  }

  const parsed = discoveryManifestSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push({
        path: issue.path.join('.') || '$',
        message: issue.message,
      })
    }
    return { manifest: null, violations }
  }

  if (parsed.data.skills.length !== 1) {
    violations.push({
      path: 'skills',
      message: 'KAIROS v1 only supports manifests with exactly one skill entry.',
    })
  }

  if (parsed.data.skills[0]?.type !== 'skill-md') {
    violations.push({
      path: 'skills.0.type',
      message:
        'KAIROS v1 only supports `skill-md` artifact entries. Archive support is a follow-up.',
    })
  }

  return { manifest: parsed.data, violations }
}

export async function resolveSkillSource(
  input: string,
  options: ResolveOptions = {},
): Promise<ResolvedSkillSource> {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Missing import source.')
  }

  if (isHttpUrl(trimmed)) {
    return resolveUrlSource(trimmed, options.fetchImpl)
  }

  if (looksLikeJson(trimmed)) {
    return resolveJsonBlobSource(trimmed)
  }

  return resolveFileSource(trimmed)
}

async function resolveUrlSource(
  url: string,
  fetchImpl: typeof fetch | undefined,
): Promise<ResolvedSkillSource> {
  const response = await getFetch(fetchImpl)(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const text = bytes.toString('utf8')
  if (looksLikeJson(text)) {
    return resolveManifestText(text, {
      sourceKind: 'url',
      sourceDisplay: url,
      sourceHost: getUrlHost(url),
      baseUrl: url,
      allowRemoteArtifacts: true,
      fetchImpl,
    })
  }

  return buildDirectSkillSource({
    sourceKind: 'url',
    sourceDisplay: url,
    sourceHost: getUrlHost(url),
    artifactLocation: url,
    rawBytes: bytes,
    markdown: text,
  })
}

async function resolveJsonBlobSource(input: string): Promise<ResolvedSkillSource> {
  return resolveManifestText(input, {
    sourceKind: 'json-blob',
    sourceDisplay: '<json-blob>',
    sourceHost: 'inline',
    baseUrl: null,
    allowRemoteArtifacts: false,
  })
}

async function resolveFileSource(input: string): Promise<ResolvedSkillSource> {
  const resolved = resolve(input)
  const stats = await stat(resolved).catch(() => null)
  if (!stats) {
    throw new Error(`Local path not found: ${input}`)
  }

  if (stats.isDirectory()) {
    const skillPath = join(resolved, 'SKILL.md')
    const bytes = await readFile(skillPath)
    return buildDirectSkillSource({
      sourceKind: 'file',
      sourceDisplay: resolved,
      sourceHost: 'local',
      artifactLocation: skillPath,
      rawBytes: bytes,
      markdown: bytes.toString('utf8'),
    })
  }

  const bytes = await readFile(resolved)
  const text = bytes.toString('utf8')
  if (looksLikeJson(text)) {
    return resolveManifestText(text, {
      sourceKind: 'file',
      sourceDisplay: resolved,
      sourceHost: 'local',
      baseFilePath: resolved,
      allowRemoteArtifacts: false,
    })
  }

  return buildDirectSkillSource({
    sourceKind: 'file',
    sourceDisplay: resolved,
    sourceHost: 'local',
    artifactLocation: resolved,
    rawBytes: bytes,
    markdown: text,
  })
}

async function resolveManifestText(
  text: string,
  context: {
    sourceKind: ResolvedSkillSource['sourceKind']
    sourceDisplay: string
    sourceHost: string
    baseUrl?: string | null
    baseFilePath?: string | null
    allowRemoteArtifacts: boolean
    fetchImpl?: typeof fetch
  },
): Promise<ResolvedSkillSource> {
  const parsedJson = safeParseJSON(text, false)
  const validation = validateDiscoveryManifestObject(parsedJson)
  if (validation.violations.length > 0 || validation.manifest === null) {
    const details = validation.violations.map(v => `${v.path}: ${v.message}`).join('\n')
    throw new Error(`Manifest validation failed:\n${details}`)
  }

  const entry = validation.manifest.skills[0]
  if (!entry) {
    throw new Error('Manifest contained no skill entries.')
  }

  const artifact = await loadArtifactBytes(entry.url, {
    baseUrl: context.baseUrl,
    baseFilePath: context.baseFilePath,
    allowRemoteArtifacts: context.allowRemoteArtifacts,
    fetchImpl: context.fetchImpl,
  })

  const checksum = computeSkillChecksum(artifact.bytes)
  if (checksum !== entry.digest) {
    throw new Error(
      `Manifest digest mismatch for ${entry.name}. Expected ${entry.digest}, got ${checksum}.`,
    )
  }

  const skill = parseSkillDocument(
    artifact.bytes.toString('utf8'),
    artifact.bytes,
    artifact.resolvedLocation,
  )
  const skillViolations = validateSkillDocument(skill)
  if (skillViolations.length > 0) {
    const details = skillViolations
      .map(v => `${v.path}: ${v.message}`)
      .join('\n')
    throw new Error(`Skill validation failed:\n${details}`)
  }

  if (skill.name !== entry.name) {
    throw new Error(
      `Manifest name ${entry.name} does not match SKILL.md frontmatter name ${skill.name}.`,
    )
  }

  if (skill.description !== entry.description) {
    throw new Error(
      'Manifest description does not match SKILL.md frontmatter description.',
    )
  }

  return {
    sourceKind: context.sourceKind,
    sourceDisplay: context.sourceDisplay,
    sourceHost:
      resolveSourceHostFromArtifact(artifact.resolvedLocation) ?? context.sourceHost,
    manifestSchema: validation.manifest.$schema,
    manifestUrl: context.baseUrl ?? context.baseFilePath ?? null,
    artifactUrl: artifact.resolvedLocation,
    checksum,
    skill,
  }
}

function buildDirectSkillSource(input: {
  sourceKind: ResolvedSkillSource['sourceKind']
  sourceDisplay: string
  sourceHost: string
  artifactLocation: string
  rawBytes: Buffer
  markdown: string
}): ResolvedSkillSource {
  const skill = parseSkillDocument(input.markdown, input.rawBytes, input.artifactLocation)
  const skillViolations = validateSkillDocument(skill)
  if (skillViolations.length > 0) {
    const details = skillViolations.map(v => `${v.path}: ${v.message}`).join('\n')
    throw new Error(`Skill validation failed:\n${details}`)
  }

  return {
    sourceKind: input.sourceKind,
    sourceDisplay: input.sourceDisplay,
    sourceHost: input.sourceHost,
    manifestSchema: null,
    manifestUrl: null,
    artifactUrl: input.artifactLocation,
    checksum: computeSkillChecksum(input.rawBytes),
    skill,
  }
}

async function loadArtifactBytes(
  location: string,
  context: ArtifactLoadContext,
): Promise<LoadedArtifact> {
  if (location.startsWith('data:')) {
    return decodeDataUrl(location)
  }

  if (location.startsWith('file://')) {
    const path = fileURLToPath(location)
    return {
      bytes: await readFile(path),
      resolvedLocation: location,
    }
  }

  if (isHttpUrl(location)) {
    if (!context.allowRemoteArtifacts) {
      throw new Error(
        'Remote artifact URLs are only allowed when the top-level import source is an http(s) URL.',
      )
    }
    const response = await getFetch(context.fetchImpl)(location)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch artifact ${location}: ${response.status} ${response.statusText}`,
      )
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      resolvedLocation: location,
    }
  }

  if (context.baseUrl) {
    const resolvedUrl = new URL(location, context.baseUrl).toString()
    return loadArtifactBytes(resolvedUrl, context)
  }

  if (context.baseFilePath) {
    const resolvedPath = isAbsolute(location)
      ? location
      : resolve(dirname(context.baseFilePath), location)
    return {
      bytes: await readFile(resolvedPath),
      resolvedLocation: resolvedPath,
    }
  }

  if (isAbsolute(location)) {
    return {
      bytes: await readFile(location),
      resolvedLocation: location,
    }
  }

  throw new Error(
    `Cannot resolve artifact URL ${location} without a base file path or base URL.`,
  )
}

function decodeDataUrl(url: string): LoadedArtifact {
  const match = url.match(/^data:([^,]*?),(.*)$/s)
  if (!match) {
    throw new Error('Invalid data: URL in manifest.')
  }
  const metadata = match[1] ?? ''
  const payload = match[2] ?? ''
  const isBase64 = metadata.includes(';base64')
  const bytes = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return {
    bytes,
    resolvedLocation: url,
  }
}

export function buildDiffPreview(
  existingContent: string,
  nextContent: string,
  maxLines: number = 160,
): string {
  const diff = diffLines(existingContent, nextContent)
  const lines = ['--- existing/SKILL.md', '+++ incoming/SKILL.md']
  let emitted = 0

  for (const part of diff) {
    const prefix = part.added ? '+' : part.removed ? '-' : ' '
    const chunkLines = part.value.split('\n')
    for (const line of chunkLines) {
      if (line === '' && emitted > 0 && emitted >= maxLines) {
        continue
      }
      if (emitted >= maxLines) {
        lines.push('... diff truncated ...')
        return lines.join('\n')
      }
      lines.push(`${prefix}${line}`)
      emitted++
    }
  }

  return lines.join('\n')
}

export function formatViolations(violations: SkillInteropViolation[]): string {
  if (violations.length === 0) {
    return 'valid'
  }
  return violations.map(v => `- ${v.path}: ${v.message}`).join('\n')
}

export function getImportedSkillDir(sourceHost: string, skillName: string): string {
  return join(
    getClaudeConfigHomeDir(),
    'skills',
    'imported',
    sanitizePathSegment(sourceHost),
    skillName,
  )
}

export function getImportedSkillPaths(sourceHost: string, skillName: string): {
  dir: string
  skillFile: string
  provenanceFile: string
} {
  const dir = getImportedSkillDir(sourceHost, skillName)
  return {
    dir,
    skillFile: join(dir, 'SKILL.md'),
    provenanceFile: join(dir, '.provenance.json'),
  }
}

export async function readExistingImport(
  sourceHost: string,
  skillName: string,
): Promise<{
  markdown: string | null
  checksum: string | null
}> {
  const { skillFile, provenanceFile } = getImportedSkillPaths(sourceHost, skillName)
  const [markdown, provenance] = await Promise.all([
    readFile(skillFile, 'utf8').catch(() => null),
    readFile(provenanceFile, 'utf8')
      .then(raw => safeParseJSON(raw, false))
      .catch(() => null),
  ])

  const checksum =
    provenance &&
    typeof provenance === 'object' &&
    provenance !== null &&
    'checksum' in provenance &&
    typeof provenance.checksum === 'string'
      ? provenance.checksum
      : markdown
        ? computeSkillChecksum(Buffer.from(markdown, 'utf8'))
        : null

  return { markdown, checksum }
}

export async function writeImportedSkill(
  resolved: ResolvedSkillSource,
  provenance: Record<string, unknown>,
): Promise<void> {
  const paths = getImportedSkillPaths(resolved.sourceHost, resolved.skill.name)
  await mkdir(paths.dir, { recursive: true })
  await writeFile(paths.skillFile, resolved.skill.rawBytes)
  await writeFile(paths.provenanceFile, jsonStringify(provenance, null, 2) + '\n')
}

export async function appendImportTelemetryEvent(
  event: ImportTelemetryEvent,
): Promise<void> {
  const dir = join(getClaudeConfigHomeDir(), 'kairos')
  await mkdir(dir, { recursive: true })
  await appendFile(
    join(dir, 'skill-interop-events.jsonl'),
    `${jsonStringify(event)}\n`,
  )
}

export async function resolveLocalSkillFile(reference: string): Promise<string> {
  const trimmed = reference.trim()
  if (!trimmed) {
    throw new Error('Missing local skill reference.')
  }

  const directPath = resolve(trimmed)
  if (await pathExists(directPath)) {
    const stats = await stat(directPath)
    if (stats.isDirectory()) {
      const skillPath = join(directPath, 'SKILL.md')
      if (await pathExists(skillPath)) {
        return skillPath
      }
      throw new Error(`Directory does not contain SKILL.md: ${trimmed}`)
    }
    return directPath
  }

  const projectCandidate = join(getProjectRoot(), '.claude', 'skills', trimmed, 'SKILL.md')
  if (await pathExists(projectCandidate)) {
    return projectCandidate
  }

  const userCandidate = join(getClaudeConfigHomeDir(), 'skills', trimmed, 'SKILL.md')
  if (await pathExists(userCandidate)) {
    return userCandidate
  }

  const importedRoot = join(getClaudeConfigHomeDir(), 'skills', 'imported')
  const hostDirs = await readdir(importedRoot, { withFileTypes: true }).catch(() => [])
  for (const hostDir of hostDirs) {
    if (!hostDir.isDirectory()) continue
    const candidate = join(importedRoot, hostDir.name, trimmed, 'SKILL.md')
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  throw new Error(`Unable to resolve local skill reference: ${reference}`)
}

export async function readLocalSkillDocument(reference: string): Promise<SkillDocument> {
  const file = await resolveLocalSkillFile(reference)
  const bytes = await readFile(file)
  const doc = parseSkillDocument(bytes.toString('utf8'), bytes, file)
  return doc
}

export async function readManifestArtifactForLint(
  input: string,
): Promise<{
  manifest: DiscoveryManifest | null
  manifestViolations: SkillInteropViolation[]
  skill: SkillDocument | null
  skillViolations: SkillInteropViolation[]
}> {
  const raw = safeParseJSON(input, false)
  const validation = validateDiscoveryManifestObject(raw)
  if (validation.manifest === null) {
    return {
      manifest: null,
      manifestViolations: validation.violations,
      skill: null,
      skillViolations: [],
    }
  }

  const entry = validation.manifest.skills[0]
  if (!entry) {
    return {
      manifest: validation.manifest,
      manifestViolations: validation.violations,
      skill: null,
      skillViolations: [],
    }
  }

  if (entry.type !== 'skill-md') {
    return {
      manifest: validation.manifest,
      manifestViolations: validation.violations,
      skill: null,
      skillViolations: [],
    }
  }

  try {
    const artifact = await loadArtifactBytes(entry.url, {
      allowRemoteArtifacts: false,
      baseFilePath: null,
      baseUrl: null,
    })
    const checksum = computeSkillChecksum(artifact.bytes)
    const manifestViolations = [...validation.violations]
    if (checksum !== entry.digest) {
      manifestViolations.push({
        path: 'skills.0.digest',
        message: `Digest mismatch. Expected ${entry.digest}, got ${checksum}.`,
      })
    }

    const skill = parseSkillDocument(
      artifact.bytes.toString('utf8'),
      artifact.bytes,
      artifact.resolvedLocation,
    )
    const skillViolations = validateSkillDocument(skill)
    if (skill.name && skill.name !== entry.name) {
      skillViolations.push({
        path: 'frontmatter.name',
        message: `SKILL.md name ${skill.name} does not match manifest name ${entry.name}.`,
      })
    }
    if (skill.description && skill.description !== entry.description) {
      skillViolations.push({
        path: 'frontmatter.description',
        message: 'SKILL.md description does not match manifest description.',
      })
    }

    return {
      manifest: validation.manifest,
      manifestViolations,
      skill,
      skillViolations,
    }
  } catch (error) {
    return {
      manifest: validation.manifest,
      manifestViolations: [
        ...validation.violations,
        {
          path: 'skills.0.url',
          message:
            error instanceof Error ? error.message : 'Unable to resolve manifest artifact.',
        },
      ],
      skill: null,
      skillViolations: [],
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function looksLikeJson(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.startsWith('{')
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input)
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch
  if (!resolved) {
    throw new Error('fetch is not available in this runtime.')
  }
  return resolved
}

function getUrlHost(url: string): string {
  return new URL(url).host || 'remote'
}

function resolveSourceHostFromArtifact(location: string): string | null {
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return getUrlHost(location)
  }
  return null
}

function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
}
