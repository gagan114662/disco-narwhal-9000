import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import {
  buildKairosCloudStateBundle,
  type KairosCloudStateBundle,
} from './cloudSync.js'
import { getKairosCloudDeployStatePath } from './paths.js'
import { shouldUseClaudeAIAuth } from '../../services/oauth/client.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const DEFAULT_SERVICE_NAME = 'kairos-cloud'
const DEFAULT_RUNTIME_ROOT = '/opt/kairos-cloud'
const DEFAULT_SSH_PORT = 22
const DEFAULT_HEALTH_TIMEOUT_SEC = 180
const STATE_VERSION = 1
const SOURCE_CONTEXT_DIR = 'src 2'

const USAGE_TEXT = `Usage:
/kairos cloud deploy --ssh-host <user@host> [--use-subscription | --anthropic-api-key-env <ENV_NAME>] [--runtime-root /opt/kairos-cloud] [--service-name kairos-cloud] [--ssh-port 22] [--ssh-identity-file ~/.ssh/id_ed25519]
/kairos cloud upgrade [--ssh-host <user@host>] [--use-subscription | --anthropic-api-key-env <ENV_NAME>] [--runtime-root /opt/kairos-cloud] [--service-name kairos-cloud] [--ssh-port 22] [--ssh-identity-file ~/.ssh/id_ed25519]
/kairos cloud destroy [--ssh-host <user@host>] [--runtime-root /opt/kairos-cloud] [--service-name kairos-cloud] [--ssh-port 22] [--ssh-identity-file ~/.ssh/id_ed25519] --confirm`

type CloudAction = 'deploy' | 'upgrade' | 'destroy'
type CloudAuthMode = 'api-key' | 'subscription'

type CloudFlags = {
  sshHost?: string
  sshPort?: number
  sshIdentityFile?: string
  runtimeRoot?: string
  serviceName?: string
  anthropicApiKeyEnv?: string
  useSubscription?: boolean
  confirm?: boolean
}

type ParsedCloudCommand =
  | { ok: true; action: CloudAction; flags: CloudFlags }
  | { ok: false; message: string }

type DeployState = {
  version: 1
  sshHost: string
  sshPort: number
  sshIdentityFile?: string
  runtimeRoot: string
  serviceName: string
  authMode: CloudAuthMode
  updatedAt: string
}

type ExecResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

type CloudLifecycleDeps = {
  buildBundle: () => Promise<KairosCloudStateBundle>
  exec: (file: string, args: string[]) => Promise<ExecResult>
  getSubscriptionCredentials: () => string | null
  now: () => Date
}

function getSubscriptionCredentialsFromLocalAuth(): string | null {
  const tokens = getClaudeAIOAuthTokens()
  if (
    !tokens?.accessToken ||
    !tokens.refreshToken ||
    !tokens.expiresAt ||
    !shouldUseClaudeAIAuth(tokens.scopes)
  ) {
    return null
  }

  return `${jsonStringify(
    {
      claudeAiOauth: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        subscriptionType: tokens.subscriptionType ?? null,
        rateLimitTier: tokens.rateLimitTier ?? null,
      },
    },
    null,
    2,
  )}\n`
}

let cloudLifecycleDeps: CloudLifecycleDeps = {
  buildBundle: () => buildKairosCloudStateBundle(),
  exec: (file, args) => execFileNoThrow(file, args),
  getSubscriptionCredentials: () => getSubscriptionCredentialsFromLocalAuth(),
  now: () => new Date(),
}

export function __setKairosCloudLifecycleDepsForTesting(
  overrides: Partial<CloudLifecycleDeps>,
): void {
  cloudLifecycleDeps = {
    ...cloudLifecycleDeps,
    ...overrides,
  }
}

export function __resetKairosCloudLifecycleDepsForTesting(): void {
  cloudLifecycleDeps = {
    buildBundle: () => buildKairosCloudStateBundle(),
    exec: (file, args) => execFileNoThrow(file, args),
    getSubscriptionCredentials: () => getSubscriptionCredentialsFromLocalAuth(),
    now: () => new Date(),
  }
}

function parseCloudCommand(args: string[]): ParsedCloudCommand {
  const [actionToken, ...rest] = args
  if (
    actionToken !== 'deploy' &&
    actionToken !== 'upgrade' &&
    actionToken !== 'destroy'
  ) {
    return { ok: false, message: USAGE_TEXT }
  }

  const flags: CloudFlags = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) {
      return {
        ok: false,
        message: `Unexpected positional argument: ${token}\n\n${USAGE_TEXT}`,
      }
    }

    const [rawKey, inlineValue] = token.slice(2).split('=', 2)
    const key = rawKey.trim()
    const takesValue = key !== 'confirm' && key !== 'use-subscription'

    const value =
      inlineValue ??
      (takesValue ? rest[i + 1] : undefined)

    if (takesValue && (!value || value.startsWith('--'))) {
      return {
        ok: false,
        message: `Missing value for --${key}\n\n${USAGE_TEXT}`,
      }
    }

    switch (key) {
      case 'ssh-host':
        flags.sshHost = value
        break
      case 'ssh-port': {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return {
            ok: false,
            message: `Invalid --ssh-port: ${value}\n\n${USAGE_TEXT}`,
          }
        }
        flags.sshPort = parsed
        break
      }
      case 'ssh-identity-file':
        flags.sshIdentityFile = value
        break
      case 'runtime-root':
        flags.runtimeRoot = value
        break
      case 'service-name':
        flags.serviceName = value
        break
      case 'anthropic-api-key-env':
        flags.anthropicApiKeyEnv = value
        break
      case 'use-subscription':
        flags.useSubscription = true
        break
      case 'confirm':
        flags.confirm = true
        break
      default:
        return {
          ok: false,
          message: `Unknown flag: --${key}\n\n${USAGE_TEXT}`,
        }
    }

    if (takesValue && inlineValue === undefined) {
      i += 1
    }
  }

  return { ok: true, action: actionToken, flags }
}

function expandHomePath(input: string | undefined): string | undefined {
  if (!input) return undefined
  if (input === '~') return homedir()
  if (input.startsWith('~/')) {
    return join(homedir(), input.slice(2))
  }
  return input
}

async function readDeployState(): Promise<DeployState | null> {
  try {
    const raw = await readFile(getKairosCloudDeployStatePath(), 'utf8')
    const parsed = safeParseJSON(raw, false)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const candidate = parsed as Partial<DeployState>
    if (
      candidate.version !== STATE_VERSION ||
      typeof candidate.sshHost !== 'string' ||
      typeof candidate.sshPort !== 'number' ||
      typeof candidate.runtimeRoot !== 'string' ||
      typeof candidate.serviceName !== 'string' ||
      (candidate.authMode !== 'api-key' &&
        candidate.authMode !== 'subscription') ||
      typeof candidate.updatedAt !== 'string'
    ) {
      return null
    }
    return {
      version: STATE_VERSION,
      sshHost: candidate.sshHost,
      sshPort: candidate.sshPort,
      sshIdentityFile:
        typeof candidate.sshIdentityFile === 'string'
          ? candidate.sshIdentityFile
          : undefined,
      runtimeRoot: candidate.runtimeRoot,
      serviceName: candidate.serviceName,
      authMode: candidate.authMode,
      updatedAt: candidate.updatedAt,
    }
  } catch {
    return null
  }
}

async function writeDeployState(state: DeployState): Promise<void> {
  const path = getKairosCloudDeployStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${jsonStringify(state, null, 2)}\n`, 'utf8')
}

async function removeDeployState(): Promise<void> {
  await rm(getKairosCloudDeployStatePath(), { force: true })
}

function resolveTargetConfig(
  flags: CloudFlags,
  saved: DeployState | null,
): {
  sshHost: string
  sshPort: number
  sshIdentityFile?: string
  runtimeRoot: string
  serviceName: string
} | null {
  const sshHost = flags.sshHost ?? saved?.sshHost
  if (!sshHost) return null
  return {
    sshHost,
    sshPort: flags.sshPort ?? saved?.sshPort ?? DEFAULT_SSH_PORT,
    sshIdentityFile:
      expandHomePath(flags.sshIdentityFile) ??
      expandHomePath(saved?.sshIdentityFile),
    runtimeRoot: flags.runtimeRoot ?? saved?.runtimeRoot ?? DEFAULT_RUNTIME_ROOT,
    serviceName: flags.serviceName ?? saved?.serviceName ?? DEFAULT_SERVICE_NAME,
  }
}

function resolveAuthMode(
  action: CloudAction,
  flags: CloudFlags,
  saved: DeployState | null,
  hasLocalSubscription: boolean,
): CloudAuthMode | null {
  if (flags.useSubscription) return 'subscription'
  if (flags.anthropicApiKeyEnv) return 'api-key'
  if (saved?.authMode) return saved.authMode
  if (action === 'deploy' && hasLocalSubscription) return 'subscription'
  return null
}

function validateTargetConfig(target: {
  sshHost: string
  sshPort: number
  sshIdentityFile?: string
  runtimeRoot: string
  serviceName: string
}): string | null {
  if (/\s/.test(target.sshHost)) {
    return `Invalid --ssh-host: ${target.sshHost}`
  }
  if (!target.runtimeRoot.startsWith('/')) {
    return `--runtime-root must be an absolute path: ${target.runtimeRoot}`
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(target.serviceName)) {
    return `Invalid --service-name: ${target.serviceName}. Use lowercase letters, numbers, and hyphens only.`
  }
  return null
}

function buildSshBaseArgs(target: {
  sshHost: string
  sshPort: number
  sshIdentityFile?: string
}): string[] {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-p',
    String(target.sshPort),
  ]
  if (target.sshIdentityFile) {
    args.push('-i', target.sshIdentityFile)
  }
  return args
}

function buildScpBaseArgs(target: {
  sshPort: number
  sshIdentityFile?: string
}): string[] {
  const args = ['-rq', '-P', String(target.sshPort)]
  if (target.sshIdentityFile) {
    args.push('-i', target.sshIdentityFile)
  }
  args.push('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
  return args
}

async function runChecked(file: string, args: string[], label: string): Promise<string> {
  const result = await cloudLifecycleDeps.exec(file, args)
  if (result.code !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      result.error ||
      `${file} exited with code ${result.code}`
    throw new Error(`${label} failed: ${detail}`)
  }
  return result.stdout.trim()
}

function buildRemoteSecretFile(apiKey: string): string {
  return [
    `ANTHROPIC_API_KEY=${apiKey}`,
    'CLAUDE_CODE_REMOTE=true',
    '',
  ].join('\n')
}

function buildBlankRemoteSecretFile(): string {
  return ''
}

function buildComposeFile(target: {
  runtimeRoot: string
  serviceName: string
}): string {
  const composeDir = target.runtimeRoot
  const dataDir = `${composeDir}/data`
  const bundlePath = `${composeDir}/deploy/bundle.json`
  const buildDir = `${composeDir}/build/current`
  return [
    'services:',
    '  kairos:',
    `    container_name: ${target.serviceName}`,
    '    build:',
    `      context: ${buildDir}`,
    '      dockerfile: daemon/kairos/cloud/Dockerfile',
    '    restart: unless-stopped',
    '    env_file:',
    `      - /etc/${target.serviceName}/kairos.env`,
    '    environment:',
    '      CLAUDE_CODE_REMOTE: "true"',
    '      CLAUDE_CONFIG_DIR: /var/lib/kairos-cloud/live-config',
    '      KAIROS_CLOUD_RUNTIME_ROOT: /var/lib/kairos-cloud/runtime',
    '      KAIROS_CLOUD_BUNDLE_PATH: /opt/kairos-deploy/bundle.json',
    '    volumes:',
    `      - ${dataDir}:/var/lib/kairos-cloud`,
    `      - ${bundlePath}:/opt/kairos-deploy/bundle.json:ro`,
    '    healthcheck:',
    '      test: ["CMD-SHELL", "test -s /var/lib/kairos-cloud/live-config/kairos/status.json"]',
    '      interval: 10s',
    '      timeout: 5s',
    '      retries: 18',
    '      start_period: 20s',
    '',
  ].join('\n')
}

function buildSystemdUnit(target: {
  runtimeRoot: string
  serviceName: string
}): string {
  const composePath = `${target.runtimeRoot}/compose.yaml`
  return [
    '[Unit]',
    `Description=KAIROS cloud Docker service (${target.serviceName})`,
    'Requires=docker.service',
    'After=docker.service network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=oneshot',
    'RemainAfterExit=yes',
    `WorkingDirectory=${target.runtimeRoot}`,
    `ExecStart=/usr/bin/env docker compose -f ${composePath} up -d --build --remove-orphans`,
    `ExecStop=/usr/bin/env docker compose -f ${composePath} down --volumes --remove-orphans`,
    'TimeoutStartSec=0',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

function buildRemoteScript(target: {
  runtimeRoot: string
  serviceName: string
  healthTimeoutSec: number
  authMode: CloudAuthMode
}): string {
  const secretDir = `/etc/${target.serviceName}`
  const secretPath = `${secretDir}/kairos.env`
  const unitPath = `/etc/systemd/system/${target.serviceName}.service`
  const liveConfigDir = `${target.runtimeRoot}/data/live-config`
  const credentialsPath = `${liveConfigDir}/.credentials.json`
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'ACTION="${1:?missing action}"',
    'STAGE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `SERVICE_NAME=${JSON.stringify(target.serviceName)}`,
    `RUNTIME_ROOT=${JSON.stringify(target.runtimeRoot)}`,
    `SECRET_DIR=${JSON.stringify(secretDir)}`,
    `SECRET_PATH=${JSON.stringify(secretPath)}`,
    `UNIT_PATH=${JSON.stringify(unitPath)}`,
    `AUTH_MODE=${JSON.stringify(target.authMode)}`,
    `LIVE_CONFIG_DIR=${JSON.stringify(liveConfigDir)}`,
    `CREDENTIALS_PATH=${JSON.stringify(credentialsPath)}`,
    `HEALTH_TIMEOUT_SEC=${String(target.healthTimeoutSec)}`,
    'BUILD_ROOT="$RUNTIME_ROOT/build"',
    'DEPLOY_ROOT="$RUNTIME_ROOT/deploy"',
    'DATA_ROOT="$RUNTIME_ROOT/data"',
    'COMPOSE_PATH="$RUNTIME_ROOT/compose.yaml"',
    '',
    'install_docker() {',
    '  if command -v docker >/dev/null 2>&1; then',
    '    return',
    '  fi',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    apt-get update',
    '    apt-get install -y ca-certificates curl gnupg lsb-release',
    '    curl -fsSL https://get.docker.com | sh',
    '    return',
    '  fi',
    '  if command -v dnf >/dev/null 2>&1; then',
    '    dnf install -y docker docker-compose-plugin',
    '    systemctl enable --now docker',
    '    return',
    '  fi',
    '  if command -v yum >/dev/null 2>&1; then',
    '    yum install -y docker docker-compose-plugin',
    '    systemctl enable --now docker',
    '    return',
    '  fi',
    '  echo "Unsupported host: could not install Docker automatically" >&2',
    '  exit 1',
    '}',
    '',
    'ensure_compose() {',
    '  if docker compose version >/dev/null 2>&1; then',
    '    return',
    '  fi',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    apt-get update',
    '    apt-get install -y docker-compose-plugin',
    '    return',
    '  fi',
    '  if command -v dnf >/dev/null 2>&1; then',
    '    dnf install -y docker-compose-plugin',
    '    return',
    '  fi',
    '  if command -v yum >/dev/null 2>&1; then',
    '    yum install -y docker-compose-plugin',
    '    return',
    '  fi',
    '  echo "docker compose plugin is missing and could not be installed automatically" >&2',
    '  exit 1',
    '}',
    '',
    'wait_for_healthy() {',
    '  local deadline shell_now status',
    '  deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))',
    '  while [ "$SECONDS" -lt "$deadline" ]; do',
    '    status="$(docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" "$SERVICE_NAME" 2>/dev/null || true)"',
    '    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then',
    '      return',
    '    fi',
    '    sleep 3',
    '  done',
    '  echo "Container $SERVICE_NAME did not become healthy in time" >&2',
    '  docker ps --all >&2 || true',
    '  docker logs "$SERVICE_NAME" >&2 || true',
    '  exit 1',
    '}',
    '',
    'case "$ACTION" in',
    '  deploy|upgrade)',
    '    install_docker',
    '    ensure_compose',
    '    systemctl enable --now docker',
    '    install -d -m 0755 "$RUNTIME_ROOT" "$BUILD_ROOT" "$DEPLOY_ROOT" "$DATA_ROOT" "$SECRET_DIR"',
    '    rm -rf "$BUILD_ROOT/current"',
    '    install -d -m 0755 "$BUILD_ROOT/current"',
    '    tar -xzf "$STAGE_DIR/source.tgz" -C "$BUILD_ROOT/current"',
    '    install -m 0644 "$STAGE_DIR/compose.yaml" "$COMPOSE_PATH"',
    '    install -m 0644 "$STAGE_DIR/bundle.json" "$DEPLOY_ROOT/bundle.json"',
    '    install -d -m 0700 "$LIVE_CONFIG_DIR"',
    '    if [ "$AUTH_MODE" = "api-key" ]; then',
    '      if [ -s "$STAGE_DIR/kairos.env" ]; then',
    '        install -m 0600 "$STAGE_DIR/kairos.env" "$SECRET_PATH"',
    '      elif [ ! -f "$SECRET_PATH" ]; then',
    '        echo "Secret env file is missing. Pass --anthropic-api-key-env on first deploy." >&2',
    '        exit 1',
    '      fi',
    '      rm -f "$CREDENTIALS_PATH"',
    '    else',
    '      install -m 0600 "$STAGE_DIR/kairos.env" "$SECRET_PATH"',
    '      if [ -s "$STAGE_DIR/credentials.json" ]; then',
    '        install -m 0600 "$STAGE_DIR/credentials.json" "$CREDENTIALS_PATH"',
    '      elif [ ! -f "$CREDENTIALS_PATH" ]; then',
    '        echo "Subscription credentials are missing. Log in locally first or pass --anthropic-api-key-env instead." >&2',
    '        exit 1',
    '      fi',
    '    fi',
    '    install -m 0644 "$STAGE_DIR/service.unit" "$UNIT_PATH"',
    '    systemctl daemon-reload',
    '    systemctl enable --now "$SERVICE_NAME"',
    '    systemctl restart "$SERVICE_NAME"',
    '    wait_for_healthy',
    '    ;;',
    '  destroy)',
    '    if [ -f "$COMPOSE_PATH" ]; then',
    '      docker compose -f "$COMPOSE_PATH" down --volumes --remove-orphans || true',
    '    fi',
    '    systemctl disable --now "$SERVICE_NAME" || true',
    '    rm -f "$UNIT_PATH"',
    '    systemctl daemon-reload || true',
    '    rm -rf "$RUNTIME_ROOT"',
    '    rm -f "$SECRET_PATH"',
    '    rmdir "$SECRET_DIR" 2>/dev/null || true',
    '    ;;',
    '  *)',
    '    echo "Unknown action: $ACTION" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n')
}

async function createSourceArchive(stageDir: string): Promise<void> {
  const contextDir = resolve(SOURCE_CONTEXT_DIR)
  const archivePath = join(stageDir, 'source.tgz')
  await runChecked(
    'tar',
    [
      '-czf',
      archivePath,
      '--exclude=node_modules',
      '--exclude=dist',
      '-C',
      contextDir,
      '.',
    ],
    'Build source archive',
  )
}

async function createStageDir(params: {
  action: CloudAction
  target: {
    sshHost: string
    sshPort: number
    sshIdentityFile?: string
    runtimeRoot: string
    serviceName: string
  }
  authMode: CloudAuthMode
  apiKey?: string
  subscriptionCredentials?: string | null
}): Promise<{
  localStageDir: string
  remoteStageDir: string
}> {
  const stageDir = await mkdtemp(join(tmpdir(), 'kairos-cloud-stage-'))
  const remoteStageDir = `/tmp/${params.target.serviceName}-${Date.now()}`
  const remoteScript = buildRemoteScript({
    runtimeRoot: params.target.runtimeRoot,
    serviceName: params.target.serviceName,
    healthTimeoutSec: DEFAULT_HEALTH_TIMEOUT_SEC,
    authMode: params.authMode,
  })

  await writeFile(
    join(stageDir, 'compose.yaml'),
    buildComposeFile(params.target),
    'utf8',
  )
  await writeFile(
    join(stageDir, 'service.unit'),
    buildSystemdUnit(params.target),
    'utf8',
  )
  await writeFile(join(stageDir, 'remote-control.sh'), remoteScript, 'utf8')
  await chmod(join(stageDir, 'remote-control.sh'), 0o755)

  if (params.action !== 'destroy') {
    const bundle = await cloudLifecycleDeps.buildBundle()
    await writeFile(
      join(stageDir, 'bundle.json'),
      `${jsonStringify(bundle, null, 2)}\n`,
      'utf8',
    )
    await createSourceArchive(stageDir)
    await writeFile(
      join(stageDir, 'kairos.env'),
      params.authMode === 'api-key' && params.apiKey
        ? buildRemoteSecretFile(params.apiKey)
        : buildBlankRemoteSecretFile(),
      'utf8',
    )
    await chmod(join(stageDir, 'kairos.env'), 0o600)
    await writeFile(
      join(stageDir, 'credentials.json'),
      params.authMode === 'subscription' && params.subscriptionCredentials
        ? params.subscriptionCredentials
        : '',
      'utf8',
    )
    await chmod(join(stageDir, 'credentials.json'), 0o600)
  } else {
    await writeFile(join(stageDir, 'bundle.json'), '{}\n', 'utf8')
    await writeFile(join(stageDir, 'kairos.env'), '\n', 'utf8')
    await writeFile(join(stageDir, 'source.tgz'), '', 'utf8')
    await writeFile(join(stageDir, 'credentials.json'), '', 'utf8')
  }

  return {
    localStageDir: stageDir,
    remoteStageDir,
  }
}

async function uploadStageDir(
  localStageDir: string,
  remoteStageDir: string,
  target: {
    sshHost: string
    sshPort: number
    sshIdentityFile?: string
  },
): Promise<void> {
  const sshArgs = [
    ...buildSshBaseArgs(target),
    target.sshHost,
    'mkdir',
    '-p',
    remoteStageDir,
  ]
  await runChecked('ssh', sshArgs, 'Prepare remote stage directory')

  const scpArgs = [
    ...buildScpBaseArgs(target),
    `${localStageDir}/.`,
    `${target.sshHost}:${remoteStageDir}`,
  ]
  await runChecked('scp', scpArgs, 'Upload deployment stage')
}

async function runRemoteLifecycleAction(
  action: CloudAction,
  remoteStageDir: string,
  target: {
    sshHost: string
    sshPort: number
    sshIdentityFile?: string
  },
): Promise<void> {
  await runChecked(
    'ssh',
    [
      ...buildSshBaseArgs(target),
      target.sshHost,
      'sudo',
      'bash',
      `${remoteStageDir}/remote-control.sh`,
      action,
    ],
    `Remote ${action}`,
  )
}

async function cleanupRemoteStageDir(
  remoteStageDir: string,
  target: {
    sshHost: string
    sshPort: number
    sshIdentityFile?: string
  },
): Promise<void> {
  await cloudLifecycleDeps.exec('ssh', [
    ...buildSshBaseArgs(target),
    target.sshHost,
    'rm',
    '-rf',
    remoteStageDir,
  ])
}

export async function runKairosCloudLifecycleCommand(
  args: string[],
): Promise<string> {
  const parsed = parseCloudCommand(args)
  if (parsed.ok === false) {
    return parsed.message
  }

  if (parsed.action === 'destroy' && !parsed.flags.confirm) {
    return `Destroy requires --confirm.\n\n${USAGE_TEXT}`
  }

  const savedState = await readDeployState()
  const localSubscriptionCredentials =
    cloudLifecycleDeps.getSubscriptionCredentials()
  const target = resolveTargetConfig(parsed.flags, savedState)
  if (!target) {
    return `Missing --ssh-host and no prior cloud deploy state was found.\n\n${USAGE_TEXT}`
  }
  const targetError = validateTargetConfig(target)
  if (targetError) {
    return `${targetError}\n\n${USAGE_TEXT}`
  }
  const authMode = resolveAuthMode(
    parsed.action,
    parsed.flags,
    savedState,
    localSubscriptionCredentials !== null,
  )
  if (!authMode) {
    return `Deploy requires either local Claude subscription auth or --anthropic-api-key-env <ENV_NAME>.\n\n${USAGE_TEXT}`
  }
  if (
    parsed.action === 'deploy' &&
    authMode === 'subscription' &&
    localSubscriptionCredentials === null
  ) {
    return 'No local Claude subscription login was found. Run `/login` locally first, or deploy with --anthropic-api-key-env <ENV_NAME>.'
  }

  const apiKey =
    parsed.flags.anthropicApiKeyEnv !== undefined
      ? process.env[parsed.flags.anthropicApiKeyEnv]
      : undefined
  if (
    parsed.flags.anthropicApiKeyEnv !== undefined &&
    (!apiKey || apiKey.trim().length === 0)
  ) {
    return `Local environment variable ${parsed.flags.anthropicApiKeyEnv} is empty or unset.`
  }
  if (parsed.action === 'deploy' && authMode === 'api-key' && !apiKey) {
    return `Deploy requires --anthropic-api-key-env <ENV_NAME> when using API-key auth.\n\n${USAGE_TEXT}`
  }

  const { localStageDir, remoteStageDir } = await createStageDir({
    action: parsed.action,
    target,
    authMode,
    apiKey,
    subscriptionCredentials:
      authMode === 'subscription' ? localSubscriptionCredentials : null,
  })

  try {
    await uploadStageDir(localStageDir, remoteStageDir, target)
    await runRemoteLifecycleAction(parsed.action, remoteStageDir, target)
    await cleanupRemoteStageDir(remoteStageDir, target)
  } finally {
    await rm(localStageDir, { recursive: true, force: true })
  }

  if (parsed.action === 'destroy') {
    await removeDeployState()
    return [
      'Cloud destroy complete.',
      `host: ${target.sshHost}`,
      `service: ${target.serviceName}`,
      `removed: ${target.runtimeRoot}, /etc/${target.serviceName}/kairos.env, and /etc/systemd/system/${target.serviceName}.service`,
      'credential revocation: revoke the Anthropic API key you provisioned for this host if you do not plan to redeploy it.',
    ].join('\n')
  }

  await writeDeployState({
    version: STATE_VERSION,
    sshHost: target.sshHost,
      sshPort: target.sshPort,
      ...(target.sshIdentityFile ? { sshIdentityFile: target.sshIdentityFile } : {}),
      runtimeRoot: target.runtimeRoot,
      serviceName: target.serviceName,
      authMode,
      updatedAt: cloudLifecycleDeps.now().toISOString(),
    })

  const verb = parsed.action === 'deploy' ? 'deploy' : 'upgrade'
  return [
    `Cloud ${verb} complete.`,
    `host: ${target.sshHost}`,
    `service: ${target.serviceName}`,
    `runtime root: ${target.runtimeRoot}`,
    `auth mode: ${authMode === 'subscription' ? 'Claude subscription OAuth' : 'Anthropic API key'}`,
    `secret file: /etc/${target.serviceName}/kairos.env (root-owned 0600)`,
    ...(authMode === 'subscription'
      ? ['oauth store: persisted under the runtime live-config as .credentials.json (0600)']
      : []),
    'health check: docker container reached a healthy/running state before the command returned.',
  ].join('\n')
}
