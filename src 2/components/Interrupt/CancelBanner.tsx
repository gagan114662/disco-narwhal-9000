import { Text } from '../../ink.js'
import {
  getCancelAcknowledgementLabel,
  getCancelFollowUpLabel,
  type CancelAcknowledgementScope,
} from '../../services/interrupt/presentation.js'

type Props = {
  scope: CancelAcknowledgementScope
}

export function CancelBanner({ scope }: Props) {
  return (
    <>
      <Text dimColor>{getCancelAcknowledgementLabel(scope)}</Text>
      <Text dimColor>{` · ${getCancelFollowUpLabel()}`}</Text>
    </>
  )
}
