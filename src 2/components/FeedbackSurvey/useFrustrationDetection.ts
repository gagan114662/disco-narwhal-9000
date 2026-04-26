/**
 * Stub for #68 burndown — frustration-detection hook.
 * Real impl is ant-only (dogfooding).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useFrustrationDetection(..._args: any[]): any {
  return {
    state: 'closed',
    handleTranscriptSelect: () => {},
  } as any
}
