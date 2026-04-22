// Build the prompt for the short-lived child Claude run that produces a
// single structured patch for one skill.
//
// Guidance baked in:
// - additive only (add_note / refine_step / add_example)
// - at most MAX_EDITS edits per patch
// - output must be one JSON object, nothing else
//
// Sentinel marker at the top of the prompt so the daemon can identify a
// pending distillation task without extending scheduled_tasks.json's schema.

import { MAX_EDITS } from './patchSchema.js'

export const SKILL_LEARNING_MARKER = '<!-- kairos-skill-learning -->'

export type DistillationPromptInputs = {
  skill: string
  /** Path to the live SKILL.md file the distillation should read. */
  skillFilePath: string
  /**
   * Path to the skills-used.json marker for the run that triggered this
   * distillation. The child reads invocation context from here.
   */
  skillsUsedPath: string
  /**
   * Path where the daemon expects the child to write its patch.
   * Must live inside `~/.claude/skills/.pending-improvements/`.
   */
  patchOutputPath: string
  /** ISO timestamp at which the task was enqueued. */
  enqueuedAt: string
}

export function buildDistillationPrompt(inputs: DistillationPromptInputs): string {
  const {
    skill,
    skillFilePath,
    skillsUsedPath,
    patchOutputPath,
    enqueuedAt,
  } = inputs
  return [
    SKILL_LEARNING_MARKER,
    '',
    'You are the KAIROS skill-learning distiller.',
    `Target skill: ${skill}`,
    `Enqueued: ${enqueuedAt}`,
    '',
    'Your job: compare what the skill file currently instructs vs. what happened in the most recent run that used this skill. Emit at most a few tiny additive edits — notes, one-line step refinements, or small concrete examples — that would make the skill slightly more effective next time.',
    '',
    'Read these files:',
    `- Skill file (read-only): ${skillFilePath}`,
    `- Recent run invocation marker: ${skillsUsedPath}`,
    '',
    'Rules:',
    '- Additive only. Do NOT rewrite, reorder, or delete existing guidance.',
    `- At most ${MAX_EDITS} edits. Prefer 1–3. Fewer is better.`,
    '- Each edit is one of: add_note, refine_step, add_example.',
    '- Each edit\'s `content` is plain markdown. No frontmatter, no headings larger than H3.',
    '- If you cannot produce a high-confidence improvement, emit zero edits by returning { "skill": "<name>", "edits": [{ "type": "add_note", "content": "(no improvement identified)" }] } — the reviewer will reject it.',
    '- Do NOT write to any file. Do NOT invoke any tools beyond Read/Glob/Grep.',
    '',
    'Output: write a single JSON object to this exact path using the Write tool:',
    `  ${patchOutputPath}`,
    '',
    'JSON shape (strict):',
    '```json',
    '{',
    `  "skill": "${skill}",`,
    '  "edits": [',
    '    { "type": "add_note", "content": "..." }',
    '  ],',
    '  "summary": "optional one-line description"',
    '}',
    '```',
    '',
    'Return nothing else. Do not emit commentary outside the JSON object. The daemon discards any patch that fails schema validation.',
  ].join('\n')
}
