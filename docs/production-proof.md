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
- Full local test suite: 411 tests across 65 files.
- Tracked worktree cleanliness after the proof run.
- Latest `origin/main` `ci` workflow is completed and successful for the exact
  main commit.
- Latest `origin/main` `permanent-structural-fix-daily` workflow is completed
  and successful for the exact main commit.
- Current open PR check rollups have no red latest checks.
- Workflow checkout actions stay pinned to Node 24-ready `actions/checkout@v5`.
- Live incomplete markers are absent across tracked source files.
- Disabled command stubs are explicit and bounded.
- SDK unsupported surfaces are explicit and bounded.

## Current Receipt

Latest proven main:

```text
0c197c304295b031b0131c6427bb4a53590e8f19
```

Passing remote runs:

- CI: https://github.com/gagan114662/disco-narwhal-9000/actions/runs/24931296063
- Daily structural workflow: https://github.com/gagan114662/disco-narwhal-9000/actions/runs/24931308173

Local proof result:

```text
411 pass
0 fail
PRODUCTION PROOF PASSED
```

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

Any new live incomplete marker, unbounded disabled command stub, or unexpected
SDK unsupported surface should fail `bun run proof:production`.
