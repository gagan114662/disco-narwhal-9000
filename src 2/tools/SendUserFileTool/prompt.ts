export const SEND_USER_FILE_TOOL_NAME = 'SendUserFile'

export const DESCRIPTION =
  'Deliver a file to the user by writing it to a visible folder on their machine'

export const SEND_USER_FILE_TOOL_PROMPT = `Write a file the user should receive locally.

\`filename\` must be a bare filename like \`report.md\` or \`image.png\`, not a path.
\`content\` is the full file contents. For binary files, pass base64 and set \`isBase64: true\`.
\`mimeType\` is optional metadata; \`openAfter\` defaults to true and opens the file after writing it.

The tool writes to a user-visible directory, never silently overwrites an existing file, and rejects path traversal attempts.`
