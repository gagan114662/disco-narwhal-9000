import { Box, Text } from '../../ink.js'
import {
  getRedirectedMarkerLabel,
  shouldShowRedirectedMarker,
} from '../../services/interrupt/presentation.js'

type Props = {
  commandMode?: string
  isMeta?: boolean
  origin?: { kind: string } | undefined
}

export function RedirectedMarker({ commandMode, isMeta, origin }: Props) {
  if (!shouldShowRedirectedMarker({ mode: commandMode, isMeta, origin })) {
    return null
  }

  return (
    <Box marginBottom={1}>
      <Text dimColor>{getRedirectedMarkerLabel()}</Text>
    </Box>
  )
}
