/**
 * Memory-shape telemetry stubs.
 *
 * The original module was lost; this is a no-op shim that satisfies the
 * two consumers below so `tsc --noEmit` passes. Both call sites are gated
 * on `feature('MEMORY_SHAPE_TELEMETRY')`, so the no-op implementation is
 * a safe default — telemetry simply doesn't fire — and re-introducing the
 * real implementation later is purely additive.
 *
 * Consumers (loaded via dynamic require behind the feature flag):
 *   - utils/sessionFileAccessHooks.ts → logMemoryWriteShape
 *   - memdir/findRelevantMemories.ts  → logMemoryRecallShape
 *
 * If MEMORY_SHAPE_TELEMETRY needs to actually report data, restore the
 * original implementation from git history (it was tracked at this path).
 */

export function logMemoryWriteShape(
  _toolName: string,
  _toolInput: unknown,
  _filePath: string,
  _scope: unknown,
): void {
  // no-op — see file header
}

export function logMemoryRecallShape(
  _memories: unknown,
  _selected: unknown,
): void {
  // no-op — see file header
}
