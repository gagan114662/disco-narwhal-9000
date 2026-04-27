# Backend Review Session B Regression Test Plan

Use these as focused regression tests when fixing the reviewed branches. The intent is that each test fails on the current branch tip and passes after the corresponding fix.

## finish-prd-implementation

### `softwareFactory.test.ts`

- Reject tampered `app-manifest.json` `appDir`.
  - Build a valid Software Factory app.
  - Create a second local directory with valid-looking `kairos:clause=` source markers.
  - Rewrite the manifest `appDir` to the second directory.
  - Assert `verifySoftwareFactoryBuild(buildId).ok === false`.
  - Assert the failed check names the manifest/app directory mismatch.

- Do not export redirected generated files.
  - Reuse the tampered manifest setup.
  - Call `exportSoftwareFactoryCompliancePack(buildId)`.
  - Assert it fails, or returns `verified: false` and does not include redirected file contents.

- Reject unsafe tenant IDs.
  - Run with `tenantId: '../../escaped-tenant'` and with `KAIROS_TENANT_ID='../../escaped-tenant'`.
  - Assert `runSoftwareFactoryBuild()` throws before creating `appDir`.
  - Assert no directory is created outside `software-factory/tenants`.

- Handle generated build ID collisions.
  - Inject `generateId` that returns the same value for two builds.
  - Assert the second build retries to a distinct ID or throws before writing.
  - Assert existing `audit.jsonl` is not appended by a fresh in-memory chain.

- Verify persisted audit anchors.
  - Create an anchor with `verifySoftwareFactoryAudit(buildId, { writeAnchor: true })`.
  - Tamper `eventCount`, `headHash`, `merkleRoot`, and `tenantId` in separate cases.
  - Assert the new anchor-verify path rejects each tampered anchor.

## check-witty-squid-plan

### `buildAudit.test.ts`

- Reject unsigned signature metadata when signing key is configured.
  - Set `KAIROS_AUDIT_SIGNING_KEY`.
  - Call `verifyKairosAuditExportSignature(exportHash, unsignedMetadata)`.
  - Assert `valid === false`.

- Validate signature shape before comparing.
  - Test non-hex, wrong length, and missing signature fields.
  - Assert each returns `malformed signature` or a similarly explicit invalid result.

- Use timing-safe compare.
  - This is partly implementation review, but add a regression around mismatched signatures with same length and different length.
  - Assert both are invalid without throwing.

### `commands/kairos.test.ts`

- Standalone audit export verify rejects semantic tampering.
  - Create a build audit export.
  - Change `eventCount`, recompute `exportHash`, leave unsigned signature metadata unchanged.
  - Assert `/kairos build-audit-export-verify` reports invalid.

- Standalone audit export verify rejects malformed signature metadata.
  - Add extra fields to unsigned metadata.
  - Change unsigned reason to a non-canonical string.
  - Assert both fail, matching tenant archive validation.

- Standalone audit anchor verify rejects malformed signature metadata.
  - Create an anchor.
  - Tamper `auditSignature` with extra fields or non-canonical unsigned reason.
  - Recompute `anchorHash` if needed.
  - Assert `/kairos build-audit-anchor-verify` reports invalid.

- Tenant archive verify rejects unsafe build IDs.
  - Export a tenant archive.
  - Rewrite build ID to `../outside`.
  - Recompute dependent audit/restore/archive hashes.
  - Assert `/kairos export tenant-verify` reports invalid.

- Tenant archive import returns invalid-archive output instead of throwing.
  - Use the same unsafe build ID archive.
  - Assert `/kairos import tenant <path>` returns a user-facing invalid message.
  - Assert no directory is written outside `.claude/kairos/builds`.

## Merged Branch

### `commands/kairos.test.ts`

- Help text includes both command families without ambiguity.
  - Assert bare `/kairos build` help/behavior belongs to the chosen PRD/draft or Software Factory namespace.
  - Assert Software Factory commands are discoverable under their final namespace.
  - Assert KAIROS audit commands and Software Factory audit commands name distinct artifact types.

- Command metadata `argumentHint` includes the final command surface.
  - Include tenant portability commands.
  - Include Software Factory commands under their final namespace.
  - Include KAIROS build audit commands.

### Combined targeted run

After resolving conflicts and applying fixes, run:

```text
bun test './daemon/kairos/softwareFactory.test.ts' './commands/kairos.test.ts'
bun test './daemon/kairos/buildAudit.test.ts' './daemon/kairos/stateWriter.test.ts' './daemon/kairos/draftBuild.test.ts' './daemon/kairos/paths.test.ts' './commands/kairos.test.ts'
```
