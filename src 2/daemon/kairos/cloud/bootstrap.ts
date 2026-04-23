import { cp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { daemonMain } from '../../main.js'
import {
  applyKairosCloudStateBundle,
  type KairosCloudStateBundle,
} from '../cloudSync.js'
import { jsonStringify } from '../../../utils/slowOperations.js'

const DEFAULT_RUNTIME_ROOT = '/var/lib/kairos-cloud/runtime'
const DEFAULT_BUNDLE_PATH = '/opt/kairos-deploy/bundle.json'
const DEFAULT_LIVE_CONFIG_DIR = '/var/lib/kairos-cloud/live-config'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function syncManagedConfig(
  runtimeRoot: string,
  liveConfigDir: string,
): Promise<void> {
  const sourceConfigDir = join(runtimeRoot, 'source', 'config', '.claude')
  await mkdir(liveConfigDir, { recursive: true })

  for (const managedDir of ['skills', 'memory']) {
    const sourcePath = join(sourceConfigDir, managedDir)
    const targetPath = join(liveConfigDir, managedDir)
    await rm(targetPath, { recursive: true, force: true })
    if (await pathExists(sourcePath)) {
      await cp(sourcePath, targetPath, { recursive: true })
    }
  }
}

async function writeProjectRegistry(
  bundle: KairosCloudStateBundle,
  runtimeRoot: string,
  liveConfigDir: string,
): Promise<void> {
  const projectDirs = bundle.projects.map(project =>
    join(runtimeRoot, 'source', 'project-sync', project.id),
  )

  for (const projectDir of projectDirs) {
    await mkdir(join(projectDir, '.claude'), { recursive: true })
  }

  const kairosStateDir = join(liveConfigDir, 'kairos')
  await mkdir(kairosStateDir, { recursive: true })
  await writeFile(
    join(kairosStateDir, 'projects.json'),
    `${jsonStringify({ projects: projectDirs }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    join(kairosStateDir, 'cloud-runtime.json'),
    `${jsonStringify(
      {
        syncedAt: bundle.createdAt,
        projectCount: bundle.projects.length,
        runtimeRoot,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function bootstrap(): Promise<void> {
  const runtimeRoot = process.env.KAIROS_CLOUD_RUNTIME_ROOT ?? DEFAULT_RUNTIME_ROOT
  const bundlePath = process.env.KAIROS_CLOUD_BUNDLE_PATH ?? DEFAULT_BUNDLE_PATH
  const liveConfigDir = process.env.CLAUDE_CONFIG_DIR ?? DEFAULT_LIVE_CONFIG_DIR

  const rawBundle = await readFile(bundlePath, 'utf8')
  const bundle = JSON.parse(rawBundle) as KairosCloudStateBundle
  await applyKairosCloudStateBundle(bundle, { runtimeRoot })
  await syncManagedConfig(runtimeRoot, liveConfigDir)
  await writeProjectRegistry(bundle, runtimeRoot, liveConfigDir)
  await daemonMain(['kairos'])
}

void bootstrap()
