# Backend Review Session B Severity Matrix

| Finding | Branch | Severity | Likelihood | Merge Gate | Rationale |
| --- | --- | --- | --- | --- | --- |
| Audit schemas conflict (`prevHash`/`hash` vs `auditPrevHash`/`auditHash`, different export/anchor envelopes) | Both | Blocker | Certain | Yes | The two branches cannot safely converge without a shared audit contract or adapter layer. |
| `verifyKairosAuditExportSignature()` accepts unsigned metadata when a signing key is configured | `check-witty-squid-plan` | Blocker | High | Yes | Allows signed-to-unsigned downgrade and undermines the audit authenticity model. |
| Missing timing-safe signature comparison | `check-witty-squid-plan` | High | Medium | Yes | Signature verification should not use direct string comparison for keyed HMAC verification. |
| Standalone audit export verification accepts recomputed semantic tampering | `check-witty-squid-plan` | High | High | Yes | The verifier can report valid when envelope fields like `eventCount` no longer match event data. |
| Tenant archive verifier accepts path-like build IDs that import rejects | `check-witty-squid-plan` | High | Medium | Yes | Verification and import disagree; archives can be certified valid then fail with path-layer errors. |
| `appManifest.appDir` trusted during Software Factory verify/export | `finish-prd-implementation` | High | High | Yes | Manifest tampering can redirect verification/export to unrelated local files. |
| Raw Software Factory `tenantId` used in path joins | `finish-prd-implementation` | High | Medium | Yes | Tenant ID can escape the intended Software Factory tenant directory. |
| Bare `/kairos build` command ownership conflict | Both | High | Certain | Yes | Both branches add user-facing build flows with incompatible command semantics. |
| Absolute local paths in portable Software Factory audit/compliance artifacts | `finish-prd-implementation` | Medium | High | Prefer before merge | Conflicts with the portable/redacted audit model and leaks local environment details. |
| Software Factory build IDs use 32 bits of entropy and no collision check | `finish-prd-implementation` | Medium | Low/Medium | Prefer before merge | Collision probability is avoidable; collision behavior can corrupt or blend build artifacts. |
| Software Factory persisted audit anchors are write-only | `finish-prd-implementation` | Medium | Medium | Prefer before ship | Anchors are emitted but stale/tampered anchors are not verified by the command surface. |
| Software Factory builder/reviewer is deterministic | `finish-prd-implementation` | Medium | Certain | Follow-up | Acceptable as an interim prototype only if called out; real LLM-backed generation/review remains next step. |

## Recommended Gate Order

1. Define the shared audit schema or conversion layer.
2. Fix signature verification downgrade behavior and timing-safe compare.
3. Align tenant archive verification with path-layer validation.
4. Validate Software Factory `tenantId` and `appManifest.appDir`.
5. Resolve command namespace ownership.
6. Add regression tests from `backend-review-session-b-test-plan.md`.
7. Address portability and anchor-readback gaps before shipping.
