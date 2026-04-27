# Backend Review Session B Branch Checklists

## `gagan114662/finish-prd-implementation`

Must fix before merge:
- [ ] Validate Software Factory `tenantId` before path joins.
- [ ] Validate `app-manifest.json` `appDir` against the expected generated app directory.
- [ ] Prevent compliance export from reading redirected manifest paths.
- [ ] Decide how Software Factory commands should coexist with `/kairos build`.
- [ ] Reconcile Software Factory audit event/export fields with the KAIROS build audit model.

Should fix before shipping:
- [ ] Remove or redact absolute local paths from portable compliance/audit artifacts.
- [ ] Increase build ID entropy or add collision retry/check.
- [ ] Add persisted audit anchor verification.

Follow-up:
- [ ] Replace deterministic builder/reviewer with real LLM-backed generation and semantic review.
- [ ] Keep deterministic mode only as a test fixture or explicit local fallback.

Regression tests to add:
- [ ] Tampered manifest `appDir` fails verification.
- [ ] Tampered manifest `appDir` cannot redirect compliance export.
- [ ] Unsafe tenant IDs fail before write.
- [ ] Forced build ID collision fails or retries.
- [ ] Tampered persisted audit anchor fails verification.

## `gagan114662/check-witty-squid-plan`

Must fix before merge:
- [ ] Reject unsigned audit signature metadata when `KAIROS_AUDIT_SIGNING_KEY` is configured.
- [ ] Use fixed-length validation plus `crypto.timingSafeEqual` for signature comparison.
- [ ] Make standalone audit export verification validate semantic fields, not just recomputed envelope hash.
- [ ] Make standalone audit anchor verification use strict signature metadata validation.
- [ ] Validate tenant archive build IDs with the same rules as the path layer.
- [ ] Convert unsafe import build IDs into invalid-archive output instead of path-layer throws.
- [ ] Reconcile KAIROS build audit fields with the Software Factory audit model.

Regression tests to add:
- [ ] Signed-to-unsigned downgrade fails.
- [ ] Malformed signature fields fail.
- [ ] Same-length mismatched signed signature fails.
- [ ] Recomputed-hash `eventCount` tampering fails standalone export verification.
- [ ] Extra/non-canonical unsigned signature metadata fails standalone export and anchor verification.
- [ ] Tenant archive with `../outside` build ID fails verify and import.

## Shared Merge Branch

Decisions to settle first:
- [ ] Final command namespace for Software Factory.
- [ ] Canonical audit schema vs adapter layer.
- [ ] Whether unsigned exports are ever acceptable in signed verification environments.
- [ ] Portable artifact path policy.

Conflict files:
- [ ] `src 2/commands/kairos.ts`
- [ ] `src 2/commands/kairos.test.ts`
- [ ] `src 2/daemon/kairos/paths.ts` semantic review after auto-merge

Final verification:
- [ ] Run both targeted Bun test sets.
- [ ] Manually inspect help text and `argumentHint`.
- [ ] Exercise tenant export/verify/import.
- [ ] Exercise Software Factory build/verify/export/audit flow.
