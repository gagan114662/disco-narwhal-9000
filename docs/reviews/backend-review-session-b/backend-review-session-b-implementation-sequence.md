# Backend Review Session B Proposed Implementation Sequence

This sequence assumes the fixes happen on a dedicated merge/fix branch after the open decisions are settled.

## Commit 1: Lock Signature Verification

Scope:
- `src 2/daemon/kairos/buildAudit.ts`
- `src 2/daemon/kairos/buildAudit.test.ts`

Changes:
- Reject unsigned audit signature metadata when `KAIROS_AUDIT_SIGNING_KEY` is configured.
- Validate signed metadata shape, hex encoding, and signature length.
- Use `crypto.timingSafeEqual` for HMAC comparison after length checks.

Tests:
- Unsigned downgrade with configured signing key.
- Non-hex signature.
- Wrong-length signature.
- Same-length mismatched signature.

## Commit 2: Make Standalone Audit Verification Semantic

Scope:
- `src 2/commands/kairos.ts`
- `src 2/commands/kairos.test.ts`

Changes:
- Reuse strict signature metadata validation for standalone export and anchor verification.
- Validate `eventCount`, `lastHash`, `merkleRoot`, event numbering, redaction policy, and erasure summary.
- Keep tenant archive and standalone verification behavior aligned.

Tests:
- Recomputed `exportHash` with mismatched `eventCount` fails.
- Malformed/extra unsigned signature metadata fails.
- Anchor signature metadata tampering fails.

## Commit 3: Align Tenant Archive Build ID Validation

Scope:
- `src 2/commands/kairos.ts`
- `src 2/daemon/kairos/paths.ts` if validator export changes are needed
- `src 2/commands/kairos.test.ts`

Changes:
- Export or reuse the path-layer build ID validator in tenant archive verification.
- Reject unsafe build IDs during verify.
- Convert import-time path validation failures into invalid-archive messages.

Tests:
- `../outside`, `.`, `..`, empty, and path separator cases fail archive verification.
- Import of unsafe archive returns invalid output and writes nothing.

## Commit 4: Harden Software Factory Path Trust

Scope:
- `src 2/daemon/kairos/softwareFactory.ts`
- `src 2/daemon/kairos/paths.ts`
- `src 2/daemon/kairos/softwareFactory.test.ts`

Changes:
- Add safe tenant ID validation before Software Factory path joins.
- Validate `appManifest.appDir` against expected tenant/app directory.
- Ensure compliance export reads only from the expected generated app directory.

Tests:
- Unsafe tenant IDs fail before write.
- Tampered `appDir` fails verification.
- Tampered `appDir` cannot redirect compliance export.

## Commit 5: Resolve Command Namespace

Scope:
- `src 2/commands/kairos.ts`
- `src 2/commands/kairos.test.ts`

Changes:
- Keep bare `/kairos build [projectDir] <brief>` for KAIROS draft builds.
- Move Software Factory routing to `/kairos software-factory ...`, or explicitly choose the lower-effort `/kairos build run ...` alternative.
- Update `HELP_TEXT`, `Subcommand`, `SUBCOMMANDS`, `runKairosCommand`, and `argumentHint`.

Tests:
- Help text includes both command families.
- Command metadata advertises final command surface.
- Existing KAIROS build and Software Factory command tests pass under final namespace.

## Commit 6: Reconcile Audit Schema

Scope:
- `src 2/daemon/kairos/buildAudit.ts`
- `src 2/daemon/kairos/buildState.ts`
- `src 2/daemon/kairos/softwareFactory.ts`
- `src 2/commands/kairos.ts`
- related tests

Changes:
- Introduce a canonical audit envelope, or explicit adapters from both existing schemas.
- Avoid leaking two incompatible export formats into long-term user-facing artifacts.
- Preserve backward compatibility only if old artifacts already need support.

Tests:
- KAIROS build audit exports canonical/adapter envelope.
- Software Factory audit exports canonical/adapter envelope.
- Verifiers reject mixed or malformed schema fields.

## Commit 7: Portability and Anchor Readback

Scope:
- `src 2/daemon/kairos/softwareFactory.ts`
- `src 2/commands/kairos.ts`
- related tests

Changes:
- Remove/redact absolute paths from portable Software Factory artifacts.
- Add persisted Software Factory audit anchor readback verification.
- Increase Software Factory build ID entropy or add collision retry.

Tests:
- Portable export contains no absolute local paths.
- Tampered persisted anchor fails verification.
- Forced build ID collision fails or retries without artifact blending.

## Commit 8: Final Combined Verification

Run:

```text
bun test './daemon/kairos/softwareFactory.test.ts' './commands/kairos.test.ts'
bun test './daemon/kairos/buildAudit.test.ts' './daemon/kairos/stateWriter.test.ts' './daemon/kairos/draftBuild.test.ts' './daemon/kairos/paths.test.ts' './commands/kairos.test.ts'
```

Then inspect:
- Help text and `argumentHint`.
- Export artifact samples.
- Tenant import/export round trip.
- Software Factory build/export/audit flow.
