/**
 * Stub for #68 burndown — `/fork` command.
 * Real impl loaded behind `FORK_SUBAGENT` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const fork: any = {
  type: 'local',
  name: 'fork',
  description: 'Fork command (stub)',
  isEnabled: () => false,
  isHidden: true,
  userFacingName: () => 'fork',
  async call(): Promise<string> {
    return ''
  },
}

export default fork
