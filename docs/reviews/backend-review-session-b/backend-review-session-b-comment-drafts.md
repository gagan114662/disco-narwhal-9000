# Backend Review Comment Drafts

## finish-prd-implementation

### Blocker: manifest appDir is trusted during verification/export

`verifySoftwareFactoryBuild()` and `exportSoftwareFactoryCompliancePack()` trust `app-manifest.json`'s `appDir`. I was able to tamper that manifest to point at a different local directory containing `kairos:clause=` markers; verification still returned `ok: true`, and the compliance export included files from the redirected directory with `verified: true`.

Suggested fix: derive the expected app directory from the trusted build/spec fields and reject manifests whose `appDir` does not resolve to that exact directory or a permitted child.

### Blocker: tenantId can escape the Software Factory tenant tree

`tenantId` is used directly as a path segment when building the tenant app dir. With `KAIROS_TENANT_ID='../../escaped-tenant'`, the generated app writes outside `kairos/software-factory/tenants/...`.

Suggested fix: validate tenant IDs with a safe segment pattern before calling path builders. Apply the same validation to any branch-supplied tenant ID.

### High: Software Factory audit artifacts leak absolute local paths

The audit/compliance artifacts include local absolute paths such as `projectDir`, `specPath`, `ipTermsPath`, `evalPackPath`, `appDir`, `auditPath`, and `proposalPath`. This conflicts with the portable/redacted audit model being added on the other backend branch.

Suggested fix: emit relative paths or hashes in portable artifacts, and keep absolute paths only in local debug output.

### Medium: generated build IDs have low entropy and no collision handling

Software Factory build IDs use `randomUUID().slice(0, 8)`, giving 32 bits of entropy, and `runSoftwareFactoryBuild()` does not check for an existing build directory before writing. A collision would reuse the old directory and append a new in-memory audit chain to an existing `audit.jsonl`.

Suggested fix: use a full UUID or loop until the generated build directory does not exist.

### Medium: audit anchors are write-only

`/kairos audit verify <buildId> --anchor` writes `audit-root.json` and a project anchor, but there is no command path that reads back and verifies persisted anchors. A stale or tampered anchor is not currently detected by the command surface.

Suggested fix: add an anchor verification mode that reads the persisted anchor and validates build ID, tenant ID, event count, head hash, merkle root, and project anchor path against the current audit chain.

## check-witty-squid-plan

### Blocker: audit signature verification permits signed-to-unsigned downgrade

`verifyKairosAuditExportSignature()` accepts unsigned signature metadata even when `KAIROS_AUDIT_SIGNING_KEY` is configured. A signed export can be downgraded to `{ version: 1, status: 'unsigned', reason: 'KAIROS_AUDIT_SIGNING_KEY not configured' }` and still verify as valid.

Suggested fix: reject unsigned signatures when a verifier signing key is configured; validate signed signature hex/length and compare with `timingSafeEqual`.

### High: standalone audit export verification is weaker than tenant archive verification

Tenant archive verification applies strict signature metadata validation and semantic checks. Standalone `build-audit-export-verify` and `build-audit-anchor-verify` only verify the hash/signature helper path. I confirmed a standalone export with `eventCount` changed to `99` and `exportHash` recomputed still reports valid.

Suggested fix: use the same signature metadata validator and semantic checks for standalone audit export/anchor verification: event count, last hash, merkle root, event numbering, redaction policy, and erasure summary.

### High: tenant archive verifier accepts build IDs import rejects

Tenant archive verification only checks that `buildId` is a non-empty string. I was able to replace a valid build ID with `../outside`, recompute dependent hashes/events, and get `Tenant archive valid`; import then throws `Invalid KAIROS build id: ../outside` from the path layer.

Suggested fix: tenant archive verification should call the same build ID validation as `getProjectKairosBuildDir()`, and import should return an invalid-archive message instead of surfacing the path-layer exception.

### Merge blocker: audit chain schemas are incompatible

The two branches introduce different audit schemas: KAIROS build audit uses `auditPrevHash`, `auditHash`, `exportHash`, and `auditSignature`; Software Factory audit uses `prevHash`, `hash`, `headHash`, and `merkleRoot`.

Suggested fix: define a shared versioned audit envelope or an explicit conversion layer before merging.

## Merge Resolution

The command conflict should be resolved by assigning clear ownership of bare `/kairos build`. Recommended shape: keep `check-witty-squid-plan`'s `/kairos build [projectDir] <brief>` for PRD/draft builds, and keep Software Factory under `/kairos build run ...` or move it to `/kairos software-factory ...`. Keep Software Factory `/kairos audit verify` distinct from KAIROS `/kairos build-audit-*`.
