# Backend Review Session B Repro Notebook

This file captures the executable proof cases from the review. Temporary worktrees used for these checks were removed after use.

## finish-prd-implementation

### Manifest `appDir` Redirect

Setup:
- Create a Software Factory build with accepted IP terms.
- Write a separate local directory containing source files with `kairos:clause=` markers.
- Tamper the build's `app-manifest.json` so `appDir` points to that separate directory and `files` lists the redirected files.

Observed:
- `verifySoftwareFactoryBuild(buildId)` returned `ok: true`.
- `exportSoftwareFactoryCompliancePack(buildId)` returned `verified: true`.
- The exported generated files came from the redirected directory, not the originally generated app directory.

Security implication:
- A local manifest edit can redirect verification/export to arbitrary local source content, as long as the redirected source has the expected markers.

Expected fix proof:
- The same tampered manifest should fail verification before source scanning or export.

### Unsafe `tenantId` Path Segment

Setup:
- Run Software Factory build with `KAIROS_TENANT_ID='../../escaped-tenant'`.

Observed:
- The generated app was written under `kairos/escaped-tenant/apps/...`.
- It was not constrained under `kairos/software-factory/tenants/...`.

Security implication:
- Tenant ID is a path traversal primitive in Software Factory app output paths.

Expected fix proof:
- Unsafe tenant IDs should be rejected before `mkdir(appDir)`.

### Build ID Collision

Setup:
- Force Software Factory ID generation to return the same short ID for multiple builds.

Observed code behavior:
- `buildId` uses `sf-${randomUUID().slice(0, 8)}` by default.
- `mkdir(buildDir, { recursive: true })` does not fail on an existing build directory.
- Audit append uses the current in-memory `auditEvents` array to compute `prevHash`, not any existing `audit.jsonl`.

Risk:
- A collision can append a fresh audit chain to an existing audit file and overwrite/merge build artifacts.

Expected fix proof:
- A forced duplicate ID should either retry to a new ID or fail before any artifact write.

## check-witty-squid-plan

### Signed-to-Unsigned Downgrade

Setup:
- Configure `KAIROS_AUDIT_SIGNING_KEY`.
- Verify an export hash with signature metadata:

```json
{
  "version": 1,
  "status": "unsigned",
  "reason": "KAIROS_AUDIT_SIGNING_KEY not configured"
}
```

Observed:

```json
{
  "valid": true,
  "status": "unsigned"
}
```

Security implication:
- A signed environment accepts unsigned metadata, so a signed export can be downgraded.

Expected fix proof:
- With `KAIROS_AUDIT_SIGNING_KEY` configured, unsigned metadata should verify as invalid.
- Signed signature comparison should use fixed-length buffer comparison with `timingSafeEqual`.

### Standalone Audit Export Semantic Tampering

Setup:
- Create a standalone audit export.
- Change `eventCount` to `99`.
- Recompute `exportHash`.
- Leave unsigned signature metadata unchanged.

Observed command output:

```text
Audit export valid for standalone-export-semantic-tamper.
export hash: valid
audit signature: unsigned reason=KAIROS_AUDIT_SIGNING_KEY not configured
```

Security implication:
- Standalone verification proves only hash/signature consistency over the edited envelope, not semantic consistency between envelope fields and event data.

Expected fix proof:
- The same edited export should fail with an event count, last hash, or merkle root mismatch.

### Tenant Archive Path-Like Build ID

Setup:
- Export a valid tenant archive.
- Replace the build ID everywhere with `../outside`.
- Recompute the dependent restore event audit chain, audit events, merkle root, audit `exportHash`, and archive hash.

Observed verify output:

```text
Tenant archive valid.
archive hash: valid
builds: 1
- ../outside: audit=valid signature=unsigned merkle=valid
```

Observed import output:

```text
THREW: Invalid KAIROS build id: ../outside
```

Security implication:
- Tenant archive verification and import/path validation disagree. Verification can certify an archive that import cannot handle cleanly.

Expected fix proof:
- Tenant archive verification should reject the unsafe build ID before import.
- Import should return a user-facing invalid archive message, not throw from the path layer.

## Shared/Merge Proofs

### Targeted Test Baseline

`finish-prd-implementation` targeted tests:

```text
bun test './daemon/kairos/softwareFactory.test.ts' './commands/kairos.test.ts'
56 pass
```

`check-witty-squid-plan` targeted tests:

```text
bun test './daemon/kairos/buildAudit.test.ts' './daemon/kairos/stateWriter.test.ts' './daemon/kairos/draftBuild.test.ts' './daemon/kairos/paths.test.ts' './commands/kairos.test.ts'
238 pass
```

### Merge Conflict Shape

Temp merge attempted:

```text
git worktree add --detach .context/wt-merge-extra origin/gagan114662/finish-prd-implementation
git merge --no-commit --no-ff origin/gagan114662/check-witty-squid-plan
```

Observed conflicts:

```text
CONFLICT (content): Merge conflict in src 2/commands/kairos.test.ts
CONFLICT (content): Merge conflict in src 2/commands/kairos.ts
Automatic merge failed; fix conflicts and then commit the result.
```

Conflict details:
- `src 2/commands/kairos.ts`: help text, `Subcommand`, `SUBCOMMANDS`, build argument parsing, `handleBuild`, `runKairosCommand`, and `argumentHint`.
- `src 2/commands/kairos.test.ts`: shared help expectations plus large appended command-test blocks.
- `src 2/daemon/kairos/paths.ts`: auto-merged in the fresh direction, but still contains separate Software Factory and KAIROS build path models that need semantic reconciliation.
