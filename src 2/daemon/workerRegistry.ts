import { runKairosWorker } from './kairos/worker.js'

export async function runDaemonWorker(kind: string | undefined): Promise<void> {
  if (kind === 'kairos') {
    const exitCode = await runKairosWorker()
    process.exitCode = exitCode
    return
  }

  throw new Error(
    `Unknown daemon worker: ${kind ?? '(none)'}. Expected \`kairos\`.`,
  )
}
