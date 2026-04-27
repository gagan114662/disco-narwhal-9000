# Backend Review Session B Line References

Repo: `https://github.com/gagan114662/disco-narwhal-9000`

Branch SHAs used:
- `gagan114662/finish-prd-implementation`: `19739e3f56a4f513668beac45fcb5f34fe0dce6a`
- `gagan114662/check-witty-squid-plan`: `4c064849cce9ce2479911cdd7099e3df35997928`

## finish-prd-implementation

### Deterministic builder/reviewer provenance

- `model_id: 'kairos-deterministic-local-v1'` is added to every audit event:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L969-L982

### `appManifest.appDir` trust boundary

- Verification scans source files from `manifest.appDir`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1189-L1195
- Compliance export reads generated files from `appManifest.appDir`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1818-L1823

### Unsafe tenant path segment

- Software Factory tenant path builders accept raw `tenantId`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/paths.ts#L40-L52
- `runSoftwareFactoryBuild()` reads `tenantId` from options/env and immediately joins it into `appDir`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1990-L2002

### Low-entropy build ID and collision behavior

- Build ID uses `randomUUID().slice(0, 8)`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1986-L1991
- The build directory is created with `recursive: true` and no existing-build check:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1996-L2002
- Audit append bases `prevHash` only on the in-memory `events` array:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L969-L990

### Write-only audit anchors

- Anchor write is gated by `writeAnchor`, but there is no matching persisted-anchor read/verify command:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L1314-L1340
- Command entrypoint only calls `verifySoftwareFactoryAudit(..., { writeAnchor })`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/commands/kairos.ts#L548-L555

### Software Factory audit schema

- Software Factory events use `prevHash` / `hash`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L135-L155
- Software Factory anchors use `headHash` / `merkleRoot` and include `auditPath`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/19739e3f56a4f513668beac45fcb5f34fe0dce6a/src%202/daemon/kairos/softwareFactory.ts#L222-L231

## check-witty-squid-plan

### Signature downgrade and non-timing-safe comparison

- Unsigned signatures are accepted before checking whether a signing key exists:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/buildAudit.ts#L167-L184
- Signed signatures are compared with string inequality instead of `timingSafeEqual`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/buildAudit.ts#L199-L213

### Standalone audit verifier weaker than tenant verifier

- Strict signature metadata validator exists:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L1519-L1538
- Tenant archive verification uses both signature verification and strict metadata validation:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2082-L2094
- Standalone export verifier enters at `handleBuildAuditExportVerify()` and relies on envelope hash/signature checks rather than the tenant semantic checks:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2295-L2310
- Standalone anchor verifier calls the signature helper directly:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2509-L2519

### Tenant archive build ID validation mismatch

- Tenant archive verification only checks that `buildId` is a non-empty string:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L1916-L1921
- Import later calls `writer.ensureBuildDir(projectDir, buildId)`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/commands/kairos.ts#L2249-L2256
- Path layer has the stricter build ID validator:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/paths.ts#L58-L77

### KAIROS build audit schema

- KAIROS build events use `auditPrevHash` / `auditHash`:
  - https://github.com/gagan114662/disco-narwhal-9000/blob/4c064849cce9ce2479911cdd7099e3df35997928/src%202/daemon/kairos/buildState.ts#L59-L65
