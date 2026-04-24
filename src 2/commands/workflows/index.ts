/**
 * Stub for #68 burndown — `/workflows` command.
 * Real impl loaded behind `WORKFLOW_SCRIPTS` feature flag.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const workflows: any = {
  type: 'local',
  name: 'workflows',
  description: 'Workflows command (stub)',
  isEnabled: () => false,
  isHidden: true,
  userFacingName: () => 'workflows',
  async call(): Promise<string> {
    return ''
  },
}

export default workflows
