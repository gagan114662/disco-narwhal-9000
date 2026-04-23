import { Box, Text } from '../../ink.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  extractQueuedCommandText,
  getQueuedMessageBadgeLabel,
  shouldShowQueuedMessageBadge,
} from '../../services/interrupt/presentation.js'

type Props = {
  command: QueuedCommand
}

export function QueuedMessageBadge({ command }: Props) {
  if (!shouldShowQueuedMessageBadge(command)) {
    return null
  }

  return (
    <Box marginBottom={1}>
      <Text dimColor>{getQueuedMessageBadgeLabel(extractQueuedCommandText(command.value))}</Text>
    </Box>
  )
}
