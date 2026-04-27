# Backend Review Session B GitHub-Ready Comments

## `gagan114662/finish-prd-implementation`

### Blocker: `appManifest.appDir` is a trust boundary bypass

`verifySoftwareFactoryBuild()` and `exportSoftwareFactoryCompliancePack()` trust `app-manifest.json`'s `appDir`. I was able to tamper the manifest to point at a different local directory containing valid-looking `kairos:clause=` markers; verification still returned `ok: true`, and compliance export read files from the redirected directory.

Relevant lines:
- https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1189-L1195
- https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1818-L1823

Suggested fix: derive the expected app dir from trusted build/spec fields and reject manifests whose `appDir` differs from that expected directory before scanning or exporting source files.

### Blocker: raw `tenantId` can escape the Software Factory tenant tree

`tenantId` is read from options/env and used directly in path builders. With `KAIROS_TENANT_ID='../../escaped-tenant'`, the generated app writes outside `kairos/software-factory/tenants/...`.

Relevant lines:
- https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/paths.ts#L40-L52
- https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1990-L2002

Suggested fix: validate tenant IDs with a strict safe-segment pattern before any path join.

### High: Software Factory build IDs are short and collision handling is missing

The default build ID uses only `randomUUID().slice(0, 8)` and `mkdir(buildDir, { recursive: true })` does not detect an existing build directory. Since audit append uses only the current in-memory event array for `prevHash`, a collision can blend a fresh audit chain into an existing `audit.jsonl`.

Relevant lines:
- https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1986-L2002
- https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L969-L990

Suggested fix: use a full UUID or retry/fail if the generated build directory already exists.

## `gagan114662/check-witty-squid-plan`

### Blocker: audit signature verification allows signed-to-unsigned downgrade

`verifyKairosAuditExportSignature()` accepts unsigned metadata before checking whether `KAIROS_AUDIT_SIGNING_KEY` is configured. In a signed verification environment, unsigned metadata should not verify as valid. The signed comparison also uses direct string inequality instead of `timingSafeEqual`.

Relevant lines:
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/buildAudit.ts#L167-L184
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/buildAudit.ts#L199-L213

Suggested fix: reject unsigned metadata when a signing key is configured, validate fixed-length hex signatures, and compare HMACs with `crypto.timingSafeEqual`.

### High: standalone audit export verification accepts semantic tampering

Standalone audit export verification can report valid after envelope fields are edited and `exportHash` is recomputed. I changed `eventCount` to `99`, recomputed `exportHash`, left unsigned signature metadata unchanged, and `/kairos build-audit-export-verify` still reported the export valid.

Relevant lines:
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2295-L2310
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2082-L2104

Suggested fix: make standalone export/anchor verification apply the same semantic checks as tenant archive verification: `eventCount`, `lastHash`, `merkleRoot`, event numbering, redaction policy, erasure summary, and strict signature metadata.

### High: tenant archive verification accepts build IDs that import rejects

Tenant archive verification only requires `buildId` to be a non-empty string, while import later calls the path layer, which rejects values like `../outside`. I was able to recompute dependent hashes for an archive using `../outside`; verify reported the archive valid, then import threw `Invalid KAIROS build id: ../outside`.

Relevant lines:
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L1916-L1921
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2249-L2256
- https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/paths.ts#L58-L77

Suggested fix: tenant archive verification should call the same build ID validator as the path layer, and import should return an invalid-archive message instead of surfacing a path-layer throw.

## Shared Merge Comment

These branches should not merge as-is. They introduce two incompatible audit schemas and overlapping `/kairos build` command ownership.

Recommended direction:
- Keep `/kairos build [projectDir] <brief>` for KAIROS PRD/draft builds.
- Move Software Factory under `/kairos software-factory ...` or another explicit namespace.
- Define a canonical audit envelope, or add explicit adapters before exposing both audit formats as long-term user-facing artifacts.
