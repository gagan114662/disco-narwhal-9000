/**
 * Ambient declarations for bundler `--external` packages.
 *
 * These modules are NOT installed via npm — they're injected at runtime by
 * the Claude Code host environment. The bundler's `--external` flag in
 * `package.json` keeps them as live `require()` calls in `dist/cli.js`,
 * resolved against the host's node_modules at runtime.
 *
 * Until each package publishes a proper `.d.ts`, this file declares them
 * with permissive `any` types so `tsc --noEmit` can succeed. The narrow
 * types are intentional (`type Foo = any` rather than `type Foo = unknown`)
 * — narrowing will happen as upstream packages ship real types.
 *
 * To add a new external: confirm it appears in `--external` in
 * `package.json`'s build script, then add a `declare module` block here
 * with the names you import.
 */

// ─── @ant/computer-use-mcp ────────────────────────────────────────────────
declare module '@ant/computer-use-mcp' {
  export const bindSessionContext: any
  export type ComputerUseSessionContext = any
  export type CuCallToolResult = any
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export const DEFAULT_GRANT_FLAGS: any
  export type ScreenshotDims = any
  export const buildComputerUseTools: any
  export const createComputerUseMcpServer: any
  export type ComputerExecutor = any
  export type DisplayGeometry = any
  export type FrontmostApp = any
  export type InstalledApp = any
  export type ResolvePrepareCaptureResult = any
  export type RunningApp = any
  export type ScreenshotResult = any
  export const API_RESIZE_PARAMS: any
  export const targetImageSize: any
}

declare module '@ant/computer-use-mcp/types' {
  export const DEFAULT_GRANT_FLAGS: any
  export type CoordinateMode = any
  export const CuSubGates: any
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
}

declare module '@ant/computer-use-mcp/sentinelApps' {
  export const getSentinelCategory: any
}

// ─── @ant/computer-use-swift / @ant/computer-use-input ────────────────────
declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = any
  const _default: any
  export default _default
}

declare module '@ant/computer-use-input' {
  const _default: any
  export = _default
}

// ─── @anthropic-ai/mcpb / @anthropic-ai/sandbox-runtime ───────────────────
declare module '@anthropic-ai/mcpb' {
  export type McpbManifest = any
  const _default: any
  export default _default
}

declare module '@anthropic-ai/sandbox-runtime' {
  export const SandboxManager: any
  export const SandboxRuntimeConfigSchema: any
  export const SandboxViolationStore: any
}

// ─── *-napi native add-ons ────────────────────────────────────────────────
declare module 'audio-capture-napi' {
  const _default: any
  export = _default
}

declare module 'color-diff-napi' {
  export const ColorDiff: any
  export const ColorFile: any
  export const getSyntaxTheme: any
}

declare module 'image-processor-napi' {
  const _default: any
  export = _default
}

declare module 'url-handler-napi' {
  const _default: any
  export = _default
}

// ─── *.md text imports ────────────────────────────────────────────────────
// Bundler loads .md files as inlined text strings.
declare module '*.md' {
  const content: string
  export default content
}
