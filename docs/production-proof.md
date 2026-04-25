# Production Proof

Date: 2026-04-25

This is the practical receipt for the project being production-gated rather
than vibe-coded. The source of truth is the executable proof command:

```bash
cd "src 2"
bun run proof:production
```

## What The Proof Command Verifies

- Local production pipeline: typecheck, lint, builds, CLI smoke, bundle smoke,
  KAIROS smoke, and employee smoke.
- Dependency reproducibility: `bun install --frozen-lockfile` completes without
  modifying dependency resolution.
- Supply-chain health: `bun audit` reports no known vulnerabilities.
- Full local test suite: 411 tests across 65 files.
- Test hygiene: no focused, skipped, pending, or expected-failing test
  modifiers across tracked test files.
- Tracked worktree cleanliness before and after the proof run.
- Latest `origin/main` `ci` workflow is completed and successful for the exact
  main commit.
- Latest `origin/main` `permanent-structural-fix-daily` workflow is completed
  and successful for the exact main commit.
- Hosted GitHub job receipts include successful required steps for frozen
  install, dependency audit, production pipeline/tests or daily structural fix,
  and static production proof.
- Main branch protection requires up-to-date `block-trunk-changes` and `verify`
  status checks, includes administrators, and blocks force pushes/deletions.
- Repository Actions defaults grant read-only workflow tokens and forbid
  workflow tokens from approving pull requests.
- Repository security settings keep Dependabot security updates, secret
  scanning, and secret scanning push protection enabled.
- Dependabot version-update policy watches Bun dependencies under `src 2/` and
  GitHub Actions weekly, with a bounded open-PR limit and known-breaking major
  lines ignored until deliberate upgrade work lands.
- Current open PR check rollups have no red latest checks.
- Workflow checkout actions stay pinned to Node 24-ready `actions/checkout@v5`.
- GitHub `ci` and `permanent-structural-fix-daily` workflows keep
  frozen-lockfile install, supply-chain audit, and static proof gates enabled.
- GitHub workflows declare least-privilege `GITHUB_TOKEN` permissions and do
  not request write-scoped or broad read/write-all permissions.
- Live incomplete markers are absent across tracked source files.
- Disabled command stubs are explicit and bounded.
- Disabled command stubs are not exposed by runtime command loading.
- SDK unsupported surfaces are explicit and bounded.

## Capture The Current Receipt

Do not hard-code a "current main" SHA in this document. Merging the receipt
itself creates a newer merge commit, so a committed SHA can go stale
immediately. Capture the live receipt instead:

```bash
git switch main
git pull --ff-only
git rev-parse HEAD
gh run list --branch main --limit 4 \
  --json databaseId,workflowName,headSha,status,conclusion,url,createdAt
cd "src 2"
bun run proof:production
```

The local proof result must include the hosted-step receipt lines and end with:

```text
411 pass
0 fail
No vulnerabilities found
No focused, skipped, pending, or expected-failing tests found across 65 test files
ci hosted steps verified
permanent-structural-fix-daily hosted steps verified
Main branch protection verified
Workflow token permissions verified
Repository Actions default workflow permissions verified
Repository security settings verified
Dependabot update policy verified
Disabled command stubs hidden at runtime
PRODUCTION PROOF PASSED
```

GitHub workflows also run:

```bash
bun run proof:static
```

That CI-friendly proof mode verifies test hygiene, workflow pins, workflow
supply-chain/static-proof gates, least-privilege token permissions,
Dependabot update-policy config, incomplete-marker scanning, disabled command
stub bounds, disabled-stub runtime hiding, and SDK unsupported-surface bounds
without requiring GitHub API access.

## 8090 Comparison Boundary

8090's public Software Factory positioning emphasizes an AI-native SDLC control
plane with intent definition, execution coordination, control, visibility,
auditability, living documentation, requirements, blueprints, work orders,
tests, and feedback:

- https://www.8090.ai/
- https://www.8090.ai/software-factory

This repo can now make a strong deterministic engineering-readiness claim:
the main branch has executable proof for local quality gates, remote CI,
scheduled structural checks, source incomplete-marker scanning, and bounded
stub surfaces.

This repo should not claim full product parity with 8090 from CI alone. Product
parity still requires a live workflow comparison for requirements, blueprints,
work orders, feedback capture, collaboration UX, knowledge graph behavior,
hosting, compliance, and customer-facing audit trails.

## Stub Boundary

The proof command currently permits exactly 17 disabled command shims. They are
hidden and disabled, and the proof fails if that list grows without updating
the explicit allowlist.

The SDK facade currently permits exactly these unsupported surfaces:

- `query`
- `unstable_v2_createSession`
- `unstable_v2_resumeSession`
- `unstable_v2_prompt`
- `watchScheduledTasks`
- `connectRemoteControl`

Any new live incomplete marker, focused/skipped/pending/expected-failing test,
unbounded or runtime-exposed disabled command stub, or unexpected SDK
unsupported surface should fail `bun run proof:production`.
