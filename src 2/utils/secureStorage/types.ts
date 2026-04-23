/**
 * Shared types for the secure-storage subsystem.
 *
 * These were re-derived from the existing implementations in
 * macOsKeychainStorage.ts, plainTextStorage.ts, fallbackStorage.ts, and
 * keychainPrefetch.ts after the original types.ts went missing. The shape
 * matches all `satisfies SecureStorage` sites in those files.
 */

/**
 * Opaque JSON-shaped credential blob that storage backends round-trip.
 * The plaintext storage backend reads/writes this via JSON.parse/stringify,
 * so the value space is "anything JSON". Callers (auth.ts, OAuth client)
 * own the precise shape; this module only owns transport.
 */
export type SecureStorageData = Record<string, unknown>

/**
 * Storage backend interface. All four implementations
 * (`macOsKeychainStorage`, `plainTextStorage`, `createFallbackStorage`,
 * and any callers via `getSecureStorage()`) conform to this shape.
 */
export type SecureStorage = {
  /** Human-readable backend name, e.g. "keychain", "plaintext",
   *  or "keychain-with-plaintext-fallback". */
  name: string
  /**
   * Sync read. Returns null when the backend has no entry. The fallback
   * implementation may return an empty object instead of null when the
   * primary errors and the secondary has no value either — see
   * fallbackStorage.ts for the rationale.
   */
  read(): SecureStorageData | null
  /** Async equivalent of `read()`. Same null semantics. */
  readAsync(): Promise<SecureStorageData | null>
  /**
   * Persist a credential blob. Returns success=false on backend error;
   * a non-empty `warning` is shown to the user (e.g. "Storing credentials
   * in plaintext" for the plaintext backend).
   */
  update(data: SecureStorageData): { success: boolean; warning?: string }
  /** Remove the stored entry. Returns true on success or if entry was absent. */
  delete(): boolean
}
