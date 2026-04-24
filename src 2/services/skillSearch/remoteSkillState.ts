/**
 * Stub for #68 burndown — remote skill discovery session state.
 * Real impl loaded behind `EXPERIMENTAL_SKILL_SEARCH`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getDiscoveredRemoteSkill(_slug: string): any {
  return undefined as any
}

export function stripCanonicalPrefix(name: string): string {
  return name
}

export function isSkillSearchEnabled(): boolean {
  return false
}
