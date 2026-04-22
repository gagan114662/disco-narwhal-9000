// Schema for the structured patch the distillation child emits.
//
// Intentionally narrow. v1 only accepts additive edits (note, example, step
// refinement) — no whole-file replacements, no deletes. That keeps the
// review diff scannable and matches the issue's "additive learning" rule.

import { z } from 'zod/v4'

export const MAX_CONTENT_CHARS = 2000
export const MAX_EDITS = 6

export const SkillEditSchema = z
  .object({
    type: z.enum(['add_note', 'refine_step', 'add_example']),
    content: z.string().trim().min(1).max(MAX_CONTENT_CHARS),
    /** Optional human-readable anchor the reviewer can scan. */
    rationale: z.string().trim().min(1).max(500).optional(),
    /**
     * Optional heading or line the edit targets. The apply step uses this
     * for `refine_step` — if absent, the edit is appended at end-of-file.
     */
    anchor: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

export type SkillEdit = z.infer<typeof SkillEditSchema>

export const SkillPatchSchema = z
  .object({
    skill: z
      .string()
      .trim()
      .min(1)
      .max(200)
      // Match the skill directory-name convention: lowercase, digits, dashes,
      // colons (plugin namespaces). Rejects path traversal outright.
      .regex(/^[a-z0-9][a-z0-9:\-_]*$/),
    edits: z.array(SkillEditSchema).min(1).max(MAX_EDITS),
    summary: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

export type SkillPatch = z.infer<typeof SkillPatchSchema>
