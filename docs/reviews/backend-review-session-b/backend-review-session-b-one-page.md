# Backend Review Session B One-Page Handoff

Reviewed:
- `gagan114662/finish-prd-implementation` / PR #129
- `gagan114662/check-witty-squid-plan` / no exact-head PR found

Context:
- The PRD attachment named in the brief was not present in this workspace.
- Review used branch diffs, targeted tests, executable repros, and the supplied watch items.

## Bottom Line

Do not merge these branches together as-is.

The main blockers are:
- Two incompatible audit-chain schemas.
- `verifyKairosAuditExportSignature()` allows signed-to-unsigned downgrade and lacks timing-safe compare.
- Tenant archive verification accepts build IDs that import/path code rejects.
- Software Factory trusts `tenantId` and `appManifest.appDir` across path and verification boundaries.
- `/kairos build` has conflicting product meaning across the two branches.

## Highest-Risk Findings

1. `check-witty-squid-plan`: unsigned audit signature metadata verifies as valid even when a signing key is configured.
2. `check-witty-squid-plan`: standalone audit export verification can be made valid after semantic tampering by recomputing `exportHash`.
3. `check-witty-squid-plan`: tenant archive verification accepts `../outside` build IDs if dependent hashes are recomputed; import later throws.
4. `finish-prd-implementation`: tampering `app-manifest.json` `appDir` can redirect verification/export to unrelated local files.
5. `finish-prd-implementation`: `KAIROS_TENANT_ID='../../escaped-tenant'` writes outside the Software Factory tenant tree.

## Merge Direction

Recommended command shape:
- Keep `/kairos build [projectDir] <brief>` for PRD/draft builds.
- Move Software Factory to `/kairos software-factory ...`.
- Keep Software Factory audit commands visibly distinct from `/kairos build-audit-*`.

Recommended audit shape:
- Prefer a shared canonical audit envelope before merge.
- If time-constrained, use explicit adapters as a temporary bridge.

## Verification Already Run

- `finish-prd-implementation`: targeted tests passed, 56 tests.
- `check-witty-squid-plan`: targeted tests passed, 238 tests.
- Fresh merge attempt produced conflicts in `src 2/commands/kairos.ts` and `src 2/commands/kairos.test.ts`.

## Read Next

- Start with `backend-review-session-b-severity-matrix.md`.
- Use `backend-review-session-b-remediation.md` as the implementation checklist.
- Use `backend-review-session-b-test-plan.md` for regression coverage.
- Use `backend-review-session-b-line-refs.md` for PR comments.
