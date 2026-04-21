import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  type SendUserFileInput,
  decodeSendUserFileContent,
  sendUserFile,
  validateSendUserFilename,
} from './delivery.js'
import {
  DESCRIPTION,
  SEND_USER_FILE_TOOL_NAME,
  SEND_USER_FILE_TOOL_PROMPT,
} from './prompt.js'

const DEFAULT_MIME_TYPE = 'text/plain'

const inputSchema = lazySchema(() =>
  z.strictObject({
    filename: z
      .string()
      .describe('Bare filename like `report.md` or `image.png`, not a path'),
    content: z
      .string()
      .describe('Full file contents as text, or base64 when `isBase64` is true'),
    mimeType: z
      .string()
      .optional()
      .describe('Optional MIME type metadata. Defaults to text/plain.'),
    isBase64: z
      .boolean()
      .optional()
      .describe('Set true when `content` is base64-encoded binary data.'),
    openAfter: z
      .boolean()
      .optional()
      .describe('Defaults to true. Opens the written file in the default app.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    filename: z.string(),
    path: z.string().optional(),
    displayPath: z.string().optional(),
    mimeType: z.string(),
    isBase64: z.boolean(),
    openAfter: z.boolean(),
    opened: z.boolean().optional(),
    revealed: z.boolean().optional(),
    bytesWritten: z.number().optional(),
    message: z.string(),
    sentAt: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function formatUseMessage(input: { filename?: string }): string {
  return input.filename
    ? `Sending file "${input.filename}"`
    : 'Sending file to the user'
}

function formatSuccessMessage({
  displayPath,
  openAfter,
  opened,
  revealed,
}: {
  displayPath: string
  openAfter: boolean
  opened: boolean
  revealed: boolean
}): string {
  const warnings: string[] = []
  if (!revealed) {
    warnings.push('could not reveal it automatically')
  }
  if (openAfter && !opened) {
    warnings.push('could not open it automatically')
  }
  if (warnings.length === 0) {
    return `📁 Sent file: ${displayPath}`
  }
  return `📁 Sent file: ${displayPath} (${warnings.join('; ')})`
}

function validateInputOrError(input: SendUserFileInput): ValidationResult {
  try {
    validateSendUserFilename(input.filename)
    decodeSendUserFileContent(input.content, input.isBase64 ?? false)
    return { result: true }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid file delivery request.'
    return { result: false, message, errorCode: 1 }
  }
}

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'deliver a file to the user on their local machine',
  maxResultSizeChars: 20_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SEND_USER_FILE_TOOL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.filename}\n${input.content}`
  },
  async validateInput(input) {
    return validateInputOrError(input)
  },
  renderToolUseMessage(input) {
    return formatUseMessage(input)
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
    }
  },
  async call({
    filename,
    content,
    mimeType = DEFAULT_MIME_TYPE,
    isBase64 = false,
    openAfter = true,
  }) {
    try {
      const delivery = await sendUserFile({
        filename,
        content,
        mimeType,
        isBase64,
        openAfter,
      })
      return {
        data: {
          success: true,
          filename,
          path: delivery.path,
          displayPath: delivery.displayPath,
          mimeType: delivery.mimeType,
          isBase64,
          openAfter,
          opened: delivery.opened,
          revealed: delivery.revealed,
          bytesWritten: delivery.bytesWritten,
          message: formatSuccessMessage({
            displayPath: delivery.displayPath,
            openAfter,
            opened: delivery.opened,
            revealed: delivery.revealed,
          }),
          sentAt: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'File delivery failed.'
      return {
        data: {
          success: false,
          filename,
          mimeType,
          isBase64,
          openAfter,
          message,
          error: message,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
