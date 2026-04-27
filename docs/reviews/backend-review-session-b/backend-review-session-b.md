# Backend Review Session B

Repo: https://github.com/gagan114662/disco-narwhal-9000

Reviewed branches:
- `gagan114662/finish-prd-implementation` / PR #129
- `gagan114662/check-witty-squid-plan` / no PR found for exact head

PRD note:
- `.context/attachments/pasted_text_2026-04-25_17-20-19.txt` was not present in this workspace.
- Review used branch diffs plus the supplied review concerns.

## Confirmed Findings

### finish-prd-implementation

1. `appManifest.appDir` is trusted during verification/export/change workflows.
   - Repro: tamper `app-manifest.json` to point at a different local directory with `kairos:clause=` markers.
   - Observed: `verifySoftwareFactoryBuild()` returned `ok: true`; `exportSoftwareFactoryCompliancePack()` exported redirected files with `verified: true`.
   - Key code:
     - `src 2/daemon/kairos/softwareFactory.ts:1189`
     - `src 2/daemon/kairos/softwareFactory.ts:1194`
     - `src 2/daemon/kairos/softwareFactory.ts:1819`
     - `src 2/daemon/kairos/softwareFactory.ts:1822`
   - Fix direction: validate `manifest.appDir` equals the resolved expected app dir from `spec.tenantId` + `spec.appId`, or reject if it is outside that directory.

2. `tenantId` is used directly as a path segment.
   - Repro: `KAIROS_TENANT_ID='../../escaped-tenant'`.
   - Observed: generated app wrote under `kairos/escaped-tenant/apps/...`, outside `kairos/software-factory/tenants/...`.
   - Key code:
     - `src 2/daemon/kairos/softwareFactory.ts:1992`
     - `src 2/daemon/kairos/softwareFactory.ts:1997`
     - `src 2/daemon/kairos/paths.ts:44`
   - Fix direction: validate tenant IDs with a safe slug/segment pattern before using them in paths.

3. Software Factory audit/compliance artifacts include local absolute paths.
   - Examples: `projectDir`, `specPath`, `ipTermsPath`, `evalPackPath`, `appDir`, `auditPath`, `proposalPath`.
   - This conflicts with the portable/redacted audit model in `check-witty-squid-plan`.

4. Builder/reviewer remains deterministic.
   - `model_id` is `kairos-deterministic-local-v1`.
   - Reviewer passes by finding `kairos:clause=` markers, not semantic review.

5. Software Factory build IDs use only 32 bits of UUID entropy and are not collision-checked.
   - Default ID generator is `randomUUID().slice(0, 8)`, producing `sf-<8 hex chars>`.
   - On collision, `runSoftwareFactoryBuild()` reuses the existing build directory and appends a new in-memory audit chain to the old `audit.jsonl`, because `appendAuditEvent()` bases `prevHash` only on the current `auditEvents` array.
   - Key code:
     - `src 2/daemon/kairos/softwareFactory.ts:985`
     - `src 2/daemon/kairos/softwareFactory.ts:1987`
     - `src 2/daemon/kairos/softwareFactory.ts:2001`
   - Fix direction: use a full UUID or check that the generated build directory does not already exist before writing.

6. Audit root anchoring writes anchors but does not verify persisted anchors.
   - `/kairos audit verify <buildId> --anchor` recomputes the current audit chain and writes `audit-root.json` plus the project anchor path. There is no corresponding read/verify path for an existing anchor, so a tampered or stale anchor is not detected by the current command surface.
   - Key code:
     - `src 2/commands/kairos.ts:548`
     - `src 2/daemon/kairos/softwareFactory.ts:1317`
     - `src 2/daemon/kairos/softwareFactory.ts:1339`
   - Test evidence: current anchor test only asserts anchor files were emitted and fields match the immediate verification result.
   - Fix direction: add an anchor verification mode that reads persisted anchors and validates build ID, tenant ID, event count, head hash, merkle root, and project anchor path against the audit chain.

### check-witty-squid-plan

1. Audit signature verifier permits signed-to-unsigned downgrade.
   - Repro: set `KAIROS_AUDIT_SIGNING_KEY` and verify `{ version: 1, status: 'unsigned', reason: 'KAIROS_AUDIT_SIGNING_KEY not configured' }`.
   - Observed: `verifyKairosAuditExportSignature()` returned `{ valid: true, status: 'unsigned' }`.
   - Key code:
     - `src 2/daemon/kairos/buildAudit.ts:176`
     - `src 2/daemon/kairos/buildAudit.ts:209`
   - Fix direction: reject unsigned signatures when verifier has a signing key configured; validate signed hex/length and compare using `timingSafeEqual`.

2. Standalone audit export/anchor verification is weaker than tenant archive verification.
   - Tenant archive verification applies `isKairosAuditSignatureMetadata()` and rejects malformed/extra signature metadata.
   - `build-audit-export-verify` and `build-audit-anchor-verify` only call `verifyKairosAuditExportSignature()`, so they accept unsigned reason strings that tenant import rejects and do not reject extra signature metadata.
   - Repro: change standalone audit export `eventCount` to `99`, recompute `exportHash`, leave unsigned signature unchanged. `build-audit-export-verify` still reports the export valid.
   - Key code:
     - `src 2/commands/kairos.ts:1519`
     - `src 2/commands/kairos.ts:2295`
     - `src 2/commands/kairos.ts:2509`
   - Fix direction: reuse the exact signature metadata validator for all audit verification entrypoints and validate event count, last hash, merkle root, event numbering, redaction policy, and erasure summary the same way tenant archive import does.

3. Build audit schema conflicts with Software Factory audit schema.
   - KAIROS build audit uses `auditPrevHash`, `auditHash`, `exportHash`, `auditSignature`.
   - Software Factory audit uses `prevHash`, `hash`, `headHash`, `merkleRoot`.
   - Needs a shared versioned envelope or explicit conversion layer before merge.

4. Tenant archive verification accepts path-like build IDs that import later rejects.
   - Repro: export a valid tenant archive, replace the build ID everywhere with `../outside`, and recompute the dependent restore event, audit chain, merkle root, audit `exportHash`, and archive hash.
   - Observed: tenant archive verification reported the archive valid with `- ../outside: audit=valid signature=unsigned merkle=valid`; tenant import then threw `Invalid KAIROS build id: ../outside` from the path layer.
   - Key code:
     - `src 2/commands/kairos.ts:1919`
     - `src 2/commands/kairos.ts:2250`
     - `src 2/daemon/kairos/paths.ts:58`
   - Fix direction: tenant archive verification should use the same build ID validation as the path layer, and import should surface this as an invalid archive rather than an uncaught path validation error.

## Test Gaps

- `finish-prd-implementation`: add tests for tampered `appManifest.appDir` and unsafe `KAIROS_TENANT_ID` / `tenantId` path segments.
- `finish-prd-implementation`: add a collision test that forces duplicate generated build IDs and asserts the second build fails or picks a new ID.
- `finish-prd-implementation`: add tests that persisted audit anchors are read back and stale/tampered anchor fields fail verification.
- `check-witty-squid-plan`: add tests for signed-to-unsigned downgrade while `KAIROS_AUDIT_SIGNING_KEY` is configured.
- `check-witty-squid-plan`: add tests that standalone `build-audit-export-verify` and `build-audit-anchor-verify` reject malformed or extra `auditSignature` metadata, matching tenant archive import.
- `check-witty-squid-plan`: add tests that standalone `build-audit-export-verify` rejects recomputed-hash semantic tampering such as mismatched `eventCount`, `lastHash`, and `merkleRoot`.
- `check-witty-squid-plan`: add tests that tenant archive verification rejects unsafe build IDs before import reaches path creation.

## Merge Readiness

Actual two-branch merge has conflicts in:
- `src 2/commands/kairos.ts`
- `src 2/commands/kairos.test.ts`
- `src 2/daemon/kairos/paths.ts` in a three-way conflict check from the original review; in a fresh merge from `finish-prd-implementation` to `check-witty-squid-plan`, this file auto-merged structurally but still carries the semantic split between Software Factory tenant paths and KAIROS build paths.

Command-surface conflict:
- `finish-prd-implementation` owns `/kairos build run|list|show|verify|...` and `/kairos audit verify`.
- `check-witty-squid-plan` owns `/kairos build`, `/kairos builds`, `/kairos build-*`, `/kairos export tenant`, `/kairos import tenant`.

Recommended reconciliation:
- Do not let both branches keep ownership of bare `/kairos build`.
- Prefer preserving `check-witty-squid-plan`'s bare `/kairos build [projectDir] <brief>` for PRD/draft build creation, because the rest of its command family is built around `buildId` state under `.claude/kairos/builds`.
- Move or keep Software Factory under an explicit namespace such as `/kairos build run ...` or `/kairos software-factory ...`, but ensure help text and `argumentHint` make the distinction clear.
- Keep `/kairos audit verify <buildId> [--anchor]` for Software Factory only if it is clearly named as Software Factory audit, because `check-witty-squid-plan` also adds `/kairos build-audit-*` for KAIROS build audit chains.
- After resolving, run both targeted suites together because the merged `commands/kairos.ts` imports compose cleanly, but the tests conflict in shared help/metadata assertions and then append two large command suites.

Fresh conflict pass:
- `src 2/commands/kairos.ts`: conflicts in `HELP_TEXT`, `Subcommand`, `SUBCOMMANDS`, build argument parsing, `handleBuild`, `runKairosCommand`, and command `argumentHint`.
- `src 2/commands/kairos.test.ts`: conflicts in help expectations and then a large block where both branches add command tests.
- `src 2/daemon/kairos/paths.ts`: no textual conflict in the fresh merge direction; both path families are present after auto-merge.

## Verification Run

- `finish-prd-implementation`: targeted tests passed, 56 tests across `daemon/kairos/softwareFactory.test.ts` and `commands/kairos.test.ts`.
- `check-witty-squid-plan`: targeted tests passed, 238 tests across build audit/state/draft/path/command tests.
- GitHub PR #129 for `finish-prd-implementation`: mergeable, checks green when inspected.
