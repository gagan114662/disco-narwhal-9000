# Branch Protection

The required-status-checks list and admin settings on `main` are not stored
in this repo (GitHub holds them server-side). This file documents the
expected state. The `proof:production` script verifies many of these via the
GitHub REST API; see `src 2/scripts/proveProductionReadiness.ts`.

## Currently enforced settings on `main`

- **Require status checks to pass before merging**: enabled.
- **Require branches to be up to date before merging**: enabled.
- **Allow force pushes**: disabled.
- **Allow deletions**: disabled.
- **Enforce on administrators**: enabled.

## Future hardening targets

These are desirable, but are not currently enforced by GitHub branch
protection and are therefore not claimed as active gates by
`proof:production`:

- Pull request reviews: 1 minimum.
- Require review from CODEOWNERS.
- Dismiss stale reviews on new commits.
- Require linear history.
- Require signed commits.
- Restrict direct pushes to `main`.

## Required status checks (contexts)

These are the workflow job names that must succeed before a PR can merge.
Add or remove from this list whenever the workflow grows; keep this doc and
the live settings in sync.

- `ci / verify` — umbrella job whose name matches the existing `verify`
  required context. It fans-in the `verify-matrix (...)` sub-jobs so the
  branch-protection rule can stay configured against a single, stable
  name even as the matrix grows.
- `trunk-guard / block-trunk-changes`

The following checks also run on PRs, but are not currently required by branch
protection:

- `codeql / analyze (javascript-typescript)`
- `secret-scan / trufflehog`
- `secret-scan / semgrep`
- `pr-hygiene / commitlint`
- `pr-hygiene / no-merge-commits`
- `pr-hygiene / codeowners-required`
- `pr-hygiene / conventional-pr-title`
- `container-scan / build-and-scan`

## Repository-level security settings

- Dependabot **alerts**: enabled.
- Dependabot **security updates**: enabled.
- Secret **scanning**: enabled.
- Secret scanning **push protection**: enabled.
- Code **scanning** (CodeQL): enabled (configured by `.github/workflows/codeql.yml`).
- Private vulnerability reporting: enabled.

## Verifying

```bash
cd "src 2"
bun run proof:production
```

This calls `proveProductionReadiness.ts`, which reads:

- `GET /repos/:owner/:repo` (security_and_analysis block)
- `GET /repos/:owner/:repo/branches/main/protection`
- `GET /repos/:owner/:repo/actions/permissions/workflow`

Anything missing is reported as a blocker before release.
