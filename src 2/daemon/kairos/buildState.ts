import { z } from 'zod'

export const KAIROS_BUILD_STATE_VERSION = 1

export const kairosBuildStatusSchema = z.enum([
  'draft',
  'queued',
  'running',
  'needs_review',
  'succeeded',
  'failed',
  'cancelled',
])

export const kairosBuildTracerSliceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  testFirst: z.string().min(1),
  implement: z.string().min(1),
})

export const kairosBuildManifestSchema = z.object({
  version: z.literal(KAIROS_BUILD_STATE_VERSION),
  buildId: z.string().min(1),
  projectDir: z.string().min(1),
  tenantId: z.string().min(1),
  title: z.string().min(1).optional(),
  brief: z.string().min(1).optional(),
  tracerSlices: z.array(kairosBuildTracerSliceSchema).optional(),
  selectedSliceId: z.string().min(1).optional(),
  status: kairosBuildStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  specPath: z.string().min(1).optional(),
  resultPath: z.string().min(1).optional(),
  transcriptPointerPath: z.string().min(1).optional(),
})

const kairosBuildEventBaseSchema = {
  version: z.literal(KAIROS_BUILD_STATE_VERSION),
  buildId: z.string().min(1),
  tenantId: z.string().min(1),
  t: z.string().min(1),
}

export const kairosBuildEventSchema = z.discriminatedUnion('kind', [
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('build_created'),
    status: kairosBuildStatusSchema,
  }),
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('build_status_changed'),
    from: kairosBuildStatusSchema,
    to: kairosBuildStatusSchema,
  }),
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('spec_written'),
    specPath: z.string().min(1),
  }),
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('slice_selected'),
    sliceId: z.string().min(1),
    title: z.string().min(1),
  }),
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('agent_event_recorded'),
    runId: z.string().min(1),
    eventKind: z.string().min(1),
  }),
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('build_result_written'),
    status: kairosBuildStatusSchema,
    resultPath: z.string().min(1),
  }),
  z.object({
    ...kairosBuildEventBaseSchema,
    kind: z.literal('build_failed'),
    errorMessage: z.string().min(1),
  }),
])

export const kairosBuildResultSchema = z.object({
  version: z.literal(KAIROS_BUILD_STATE_VERSION),
  buildId: z.string().min(1),
  tenantId: z.string().min(1),
  status: kairosBuildStatusSchema,
  completedAt: z.string().min(1),
  summary: z.string().min(1),
  appDir: z.string().min(1).optional(),
  auditPath: z.string().min(1).optional(),
})

export type KairosBuildStatus = z.infer<typeof kairosBuildStatusSchema>
export type KairosBuildTracerSlice = z.infer<typeof kairosBuildTracerSliceSchema>
export type KairosBuildManifest = z.infer<typeof kairosBuildManifestSchema>
export type KairosBuildEvent = z.infer<typeof kairosBuildEventSchema>
export type KairosBuildResult = z.infer<typeof kairosBuildResultSchema>

export function parseKairosBuildManifest(value: unknown): KairosBuildManifest {
  try {
    return kairosBuildManifestSchema.parse(value)
  } catch (error) {
    throw new Error('Invalid KAIROS build manifest', { cause: error })
  }
}

export function parseKairosBuildEvent(value: unknown): KairosBuildEvent {
  try {
    return kairosBuildEventSchema.parse(value)
  } catch (error) {
    throw new Error('Invalid KAIROS build event', { cause: error })
  }
}

export function parseKairosBuildResult(value: unknown): KairosBuildResult {
  try {
    return kairosBuildResultSchema.parse(value)
  } catch (error) {
    throw new Error('Invalid KAIROS build result', { cause: error })
  }
}
