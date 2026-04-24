/**
 * Stub for #68 burndown — `/peers` command.
 * Real impl loaded behind `UDS_INBOX` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const peers: any = {
  type: 'local',
  name: 'peers',
  description: 'Peers command (stub)',
  isEnabled: () => false,
  isHidden: true,
  userFacingName: () => 'peers',
  async call(): Promise<string> {
    return ''
  },
}

export default peers
