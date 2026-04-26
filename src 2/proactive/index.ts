export function isProactiveActive(): boolean {
  return false
}

export function isProactivePaused(): boolean {
  return false
}

export function activateProactive(_reason: string): void {}

export function deactivateProactive(): void {}

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
