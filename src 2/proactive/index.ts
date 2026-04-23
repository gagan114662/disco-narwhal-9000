export function isProactiveActive(): boolean {
  return false
}

export function subscribeToProactiveChanges(
  _listener: () => void,
): () => void {
  return () => {}
}

export function pauseProactive(): void {}

export function resumeProactive(): void {}

export function setContextBlocked(_blocked: boolean): void {}

export function getNextTickAt(): number | null {
  return null
}
