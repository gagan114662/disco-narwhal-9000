export * from '@anthropic-ai/claude-agent-sdk/entrypoints/sdk/controlTypes.js'

// ─── Manual type bridges (re-derive until generator runs) ─────────────────
//
// `bun scripts/generate-sdk-types.ts` is what normally produces these types
// from controlSchemas.ts. Until that runs, callers (e.g. cli/print.ts) break
// on the missing exports. The z.infer bridge below mirrors the schema —
// safe to delete after the generator updates the SDK package's .d.ts.
import type { z } from 'zod/v4'
import type { SDKControlReloadPluginsResponseSchema } from './controlSchemas.js'

export type SDKControlReloadPluginsResponse = z.infer<
  ReturnType<typeof SDKControlReloadPluginsResponseSchema>
>
