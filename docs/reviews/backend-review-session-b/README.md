# Backend Review Session B Index

Review scope:
- `gagan114662/finish-prd-implementation`
- `gagan114662/check-witty-squid-plan`

Primary report:
- `backend-review-session-b-one-page.md`
  - Shortest summary of merge status, highest-risk findings, and next files to read.
- `backend-review-session-b.md`
  - Full findings, test gaps, merge readiness, and verification summary.

Actionable follow-up:
- `backend-review-session-b-remediation.md`
  - Ordered checklist for merge blockers, pre-ship fixes, and follow-up work.
- `backend-review-session-b-severity-matrix.md`
  - Severity, likelihood, and merge-gate table for each finding.
- `backend-review-session-b-test-plan.md`
  - Focused regression tests that should fail before fixes and pass after fixes.
- `backend-review-session-b-merge-sketch.md`
  - Suggested command namespace, conflict-resolution order, and audit schema options.
- `backend-review-session-b-open-decisions.md`
  - Product/API choices that should be settled before implementation.
- `backend-review-session-b-implementation-sequence.md`
  - Suggested commit order for applying the fixes on a merge/fix branch.
- `backend-review-session-b-branch-checklists.md`
  - Branch-owner checklists for required fixes, tests, and shared merge work.

PR/comment material:
- `backend-review-session-b-comment-drafts.md`
  - Concise review comments grouped by branch and severity.
- `backend-review-session-b-github-comments.md`
  - GitHub-ready comments with branch-pinned line links.

Evidence:
- `backend-review-session-b-command-log.md`
  - Important commands, probes, and observed outcomes from the review session.
- `backend-review-session-b-repros.md`
  - Repro steps and observed outputs for the proof cases.
- `backend-review-session-b-line-refs.md`
  - Branch-pinned GitHub line links for the key code references.

Most important merge blockers:
- Reconcile the Software Factory audit schema with the KAIROS build audit schema.
- Fix `verifyKairosAuditExportSignature()` downgrade behavior and timing-safe comparison.
- Align tenant archive verification with path-layer build ID validation.
- Resolve ownership of bare `/kairos build`.
- Validate Software Factory `tenantId` and `appManifest.appDir` before using them as trust/path boundaries.
