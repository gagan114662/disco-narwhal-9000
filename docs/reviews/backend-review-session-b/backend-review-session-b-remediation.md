# Backend Review Session B Remediation Checklist

## Before Merge

- [ ] Reconcile audit schemas.
  - Choose one versioned envelope for build audit events and Software Factory audit events, or add explicit adapters.
  - Decide canonical field names for previous hash, current hash, head hash, merkle root, export hash, and signature metadata.

- [ ] Resolve command ownership.
  - Keep bare `/kairos build [projectDir] <brief>` for PRD/draft builds, or explicitly choose the Software Factory meaning.
  - Keep Software Factory under a distinct command family such as `/kairos build run ...` or `/kairos software-factory ...`.
  - Avoid having `/kairos audit verify` and `/kairos build-audit-*` look like they verify the same artifact type.

- [ ] Fix `verifyKairosAuditExportSignature()`.
  - Reject unsigned metadata when `KAIROS_AUDIT_SIGNING_KEY` is configured.
  - Validate signed signature as fixed-length SHA-256 hex.
  - Use `crypto.timingSafeEqual` after length validation.
  - Add downgrade and malformed-signature tests.

- [ ] Make standalone audit export/anchor verification semantically equivalent to tenant archive verification.
  - Validate signature metadata exact keys.
  - Validate `eventCount`, `lastHash`, `merkleRoot`, event numbering, redaction policy, and erasure summary.
  - Add recomputed-hash semantic tampering tests.

- [ ] Validate tenant archive build IDs before import.
  - Use the same build ID validator as `getProjectKairosBuildDir()`.
  - Return an invalid-archive message instead of throwing path-layer errors during import.

- [ ] Validate Software Factory tenant IDs and app directories.
  - Validate `tenantId` before any path join.
  - Derive expected app directory from trusted build/spec data.
  - Reject `app-manifest.json` if `appDir` differs from the expected directory.

## Should Fix Before Shipping

- [ ] Remove or redact absolute local paths from portable audit/compliance artifacts.
  - Keep local paths in CLI output or local-only debug files if needed.
  - Use relative paths or stable hashes in exported artifacts.

- [ ] Increase Software Factory build ID entropy and handle collisions.
  - Use full UUIDs or a retry loop around existing build directory checks.
  - Add a forced-collision test.

- [ ] Add persisted Software Factory audit anchor verification.
  - Read back `audit-root.json` and the project anchor.
  - Validate build ID, tenant ID, event count, head hash, merkle root, and anchor path.
  - Add stale/tampered anchor tests.

## Follow-Up

- [ ] Replace deterministic Software Factory builder/reviewer with real LLM-backed generation and semantic review.
  - Keep deterministic mode only as a test fixture or explicit local fallback.
  - Record model ID, prompt hash, and review evidence in the shared audit envelope.

- [ ] Run merged targeted suites after conflict resolution.
  - `bun test './daemon/kairos/softwareFactory.test.ts' './commands/kairos.test.ts'`
  - `bun test './daemon/kairos/buildAudit.test.ts' './daemon/kairos/stateWriter.test.ts' './daemon/kairos/draftBuild.test.ts' './daemon/kairos/paths.test.ts' './commands/kairos.test.ts'`
