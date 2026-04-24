/**
 * Stub for #68 burndown — `/buddy` command.
 * Real impl loaded behind `BUDDY` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const buddy: any = {
  type: 'local',
  name: 'buddy',
  description: 'Buddy command (stub)',
  isEnabled: () => false,
  isHidden: true,
  userFacingName: () => 'buddy',
  async call(): Promise<string> {
    return ''
  },
}

export default buddy
