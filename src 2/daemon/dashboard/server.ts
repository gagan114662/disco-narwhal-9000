import type { FSWatcher } from 'chokidar'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { safeParseJSON } from '../../utils/json.js'
import {
  enqueueDemoTask,
  getDashboardWatchPaths,
  optInProject,
  optOutProject,
  readDashboardSnapshot,
  setPauseState,
  type DashboardSnapshot,
} from './model.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 7777
const WATCH_STABILITY_MS = 150
const BROADCAST_DEBOUNCE_MS = 75
const SSE_KEEPALIVE_MS = 15_000
const SNAPSHOT_POLL_MS = 500
const ASSET_DIR = dirname(fileURLToPath(import.meta.url))

type StaticAsset = {
  body: Buffer
  contentType: string
}

export type KairosDashboardServerOptions = {
  host?: string
  port?: number
  now?: () => Date
}

export type KairosDashboardServer = {
  url: string
  stop(): Promise<void>
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body, null, 2)}\n`)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += String(chunk)
  }
  if (raw.trim() === '') return {}
  const parsed = safeParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object body.')
  }
  return parsed as Record<string, unknown>
}

async function loadStaticAsset(
  filename: string,
  contentType: string,
): Promise<StaticAsset> {
  return {
    body: await readFile(join(ASSET_DIR, filename)),
    contentType,
  }
}

function writeSse(
  res: ServerResponse,
  event: string,
  payload: Record<string, unknown> | DashboardSnapshot,
): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function startKairosDashboardServer(
  options: KairosDashboardServerOptions = {},
): Promise<KairosDashboardServer> {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const now = options.now ?? (() => new Date())
  const clients = new Set<ServerResponse>()
  let watcher: FSWatcher | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let snapshotPoll: ReturnType<typeof setInterval> | null = null
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null
  let lastSnapshotJson: string | null = null

  const [indexHtml, appJs, stylesCss] = await Promise.all([
    loadStaticAsset('index.html', 'text/html; charset=utf-8'),
    loadStaticAsset('app.js', 'application/javascript; charset=utf-8'),
    loadStaticAsset('styles.css', 'text/css; charset=utf-8'),
  ])

  async function refreshWatcher(): Promise<void> {
    const watchPaths = await getDashboardWatchPaths()
    if (!watcher) return
    watcher.add(watchPaths)
  }

  async function broadcastSnapshot(): Promise<void> {
    if (clients.size === 0) return
    try {
      const snapshot = await readDashboardSnapshot(now)
      const nextJson = JSON.stringify(snapshot)
      if (nextJson === lastSnapshotJson) {
        return
      }
      lastSnapshotJson = nextJson
      for (const client of clients) {
        writeSse(client, 'snapshot', snapshot)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown dashboard error'
      for (const client of clients) {
        writeSse(client, 'error', {
          generatedAt: now().toISOString(),
          message,
        })
      }
    }
  }

  function scheduleBroadcast(): void {
    if (broadcastTimer) return
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null
      void broadcastSnapshot()
    }, BROADCAST_DEBOUNCE_MS)
    broadcastTimer.unref?.()
  }

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)

    try {
      if (method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': indexHtml.contentType })
        res.end(indexHtml.body)
        return
      }
      if (method === 'GET' && url.pathname === '/app.js') {
        res.writeHead(200, { 'content-type': appJs.contentType })
        res.end(appJs.body)
        return
      }
      if (method === 'GET' && url.pathname === '/styles.css') {
        res.writeHead(200, { 'content-type': stylesCss.contentType })
        res.end(stylesCss.body)
        return
      }
      if (method === 'GET' && url.pathname === '/api/state') {
        sendJson(res, 200, await readDashboardSnapshot(now))
        return
      }
      if (method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        })
        res.write(': connected\n\n')
        clients.add(res)
        const snapshot = await readDashboardSnapshot(now)
        lastSnapshotJson = JSON.stringify(snapshot)
        writeSse(res, 'snapshot', snapshot)
        req.on('close', () => {
          clients.delete(res)
          res.end()
        })
        return
      }
      if (method === 'POST' && url.pathname === '/api/projects/opt-in') {
        const body = await readJsonBody(req)
        const projectDir = String(body.projectDir ?? '').trim()
        if (!projectDir) {
          sendJson(res, 400, { error: 'projectDir is required.' })
          return
        }
        await optInProject(projectDir)
        await refreshWatcher()
        sendJson(res, 200, await readDashboardSnapshot(now))
        scheduleBroadcast()
        return
      }
      if (method === 'POST' && url.pathname === '/api/projects/opt-out') {
        const body = await readJsonBody(req)
        const projectDir = String(body.projectDir ?? '').trim()
        if (!projectDir) {
          sendJson(res, 400, { error: 'projectDir is required.' })
          return
        }
        await optOutProject(projectDir)
        await refreshWatcher()
        sendJson(res, 200, await readDashboardSnapshot(now))
        scheduleBroadcast()
        return
      }
      if (method === 'POST' && url.pathname === '/api/projects/demo') {
        const body = await readJsonBody(req)
        const projectDir = String(body.projectDir ?? '').trim()
        if (!projectDir) {
          sendJson(res, 400, { error: 'projectDir is required.' })
          return
        }
        const taskId = await enqueueDemoTask(projectDir, now)
        sendJson(res, 200, {
          taskId,
          snapshot: await readDashboardSnapshot(now),
        })
        scheduleBroadcast()
        return
      }
      if (method === 'POST' && url.pathname === '/api/pause') {
        await setPauseState(true, now)
        sendJson(res, 200, await readDashboardSnapshot(now))
        scheduleBroadcast()
        return
      }
      if (method === 'POST' && url.pathname === '/api/resume') {
        await setPauseState(false, now)
        sendJson(res, 200, await readDashboardSnapshot(now))
        scheduleBroadcast()
        return
      }
      sendJson(res, 404, { error: `No route for ${method} ${url.pathname}` })
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Unknown server error',
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  const address = server.address()
  const boundPort =
    typeof address === 'object' && address ? address.port : DEFAULT_PORT

  const { default: chokidar } = await import('chokidar')
  watcher = chokidar.watch(await getDashboardWatchPaths(), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: WATCH_STABILITY_MS,
    },
  })
  watcher.on('add', scheduleBroadcast)
  watcher.on('change', scheduleBroadcast)
  watcher.on('unlink', scheduleBroadcast)
  watcher.on('addDir', scheduleBroadcast)
  watcher.on('unlinkDir', scheduleBroadcast)
  await new Promise<void>((resolve, reject) => {
    watcher?.once('ready', () => resolve())
    watcher?.once('error', reject)
  })

  keepAlive = setInterval(() => {
    for (const client of clients) {
      client.write(': keepalive\n\n')
    }
  }, SSE_KEEPALIVE_MS)
  keepAlive.unref?.()
  snapshotPoll = setInterval(() => {
    void broadcastSnapshot()
  }, SNAPSHOT_POLL_MS)
  snapshotPoll.unref?.()

  return {
    url: `http://${host}:${boundPort}`,
    async stop() {
      if (broadcastTimer) {
        clearTimeout(broadcastTimer)
        broadcastTimer = null
      }
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
      if (snapshotPoll) {
        clearInterval(snapshotPoll)
        snapshotPoll = null
      }
      for (const client of clients) {
        client.end()
      }
      clients.clear()
      await watcher?.close()
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
