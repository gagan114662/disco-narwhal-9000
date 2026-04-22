import { runKairosWorker } from './kairos/worker.js'
import {
  startKairosDashboardServer,
  type KairosDashboardServerOptions,
} from './dashboard/server.js'

type SignalHandler = () => void

export type DaemonMainOptions = {
  registerSignalHandlers?: (
    handler: SignalHandler,
  ) => (() => void) | Promise<() => void>
  dashboard?: KairosDashboardServerOptions
}

async function defaultRegisterSignalHandlers(
  handler: SignalHandler,
): Promise<() => void> {
  process.once('SIGINT', handler)
  process.once('SIGTERM', handler)
  return () => {
    process.off('SIGINT', handler)
    process.off('SIGTERM', handler)
  }
}

export async function daemonMain(
  args: string[],
  options: DaemonMainOptions = {},
): Promise<void> {
  const subcommand = args[0]
  if (subcommand !== 'kairos') {
    throw new Error(
      `Unknown daemon subcommand: ${subcommand ?? '(none)'}. Expected \`kairos\`.`,
    )
  }

  const controller = new AbortController()
  const register =
    options.registerSignalHandlers ?? defaultRegisterSignalHandlers
  const unregister = await register(() => controller.abort())
  const dashboard = await startKairosDashboardServer(options.dashboard)

  try {
    const exitCode = await runKairosWorker({ signal: controller.signal })
    process.exitCode = exitCode
  } finally {
    await dashboard.stop()
    unregister()
  }
}
