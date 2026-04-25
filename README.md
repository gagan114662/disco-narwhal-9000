# KAIROS

KAIROS is a Claude-Code-native personal automation platform under active development in this repository.

Today the repo is a Bun-based CLI/daemon codebase with KAIROS-specific work layered into it: a local background worker, a browser dashboard, reminders, Telegram gateway codepaths, skill import/export, diagnostics, and agent-oriented tooling.

## Current Status

- The main application currently lives under `src 2/`, not `src/`.
- The root of the repo is intentionally thin: GitHub/workspace metadata at the top level, product code under `src 2/`.
- KAIROS daemon/dashboard work is present, test-covered, and reachable through direct CLI entry points.
- Optional native/package integrations are loaded lazily so the core CLI can start without developer-only packages installed.

If you are new to the repo, start in:

- `src 2/package.json`
- `src 2/entrypoints/cli.tsx`
- `src 2/daemon/main.ts`
- `src 2/commands/kairos.ts`
- `src 2/daemon/dashboard/`
- `src 2/daemon/kairos/`

## Prerequisites

- Bun `1.3.11`
- macOS or Linux-like shell environment

## Quickstart

```bash
cd 'src 2'
bun install --frozen-lockfile
bun run smoke:cli
bun ./entrypoints/cli.tsx kairos status
```

Useful validation commands:

```bash
cd 'src 2'
bun run pipeline
bun run structural-fix:daily
bun test
```

For faster local iteration on KAIROS-specific work:

```bash
cd 'src 2'
bun run smoke:kairos
bun test ./commands/kairos.test.ts
bun test ./entrypoints/cli.test.ts
bun test ./daemon/dashboard/server.test.ts
```

## Running KAIROS

Start the daemon:

```bash
cd 'src 2'
bun ./entrypoints/cli.tsx daemon kairos
```

Check daemon status and available KAIROS commands:

```bash
cd 'src 2'
bun ./entrypoints/cli.tsx kairos status
bun ./entrypoints/cli.tsx kairos
```

The KAIROS dashboard server starts with the daemon and defaults to:

- `http://127.0.0.1:7777/`

Runtime state is file-backed:

- global daemon state: `~/.claude/kairos/`
- per-project KAIROS state: `<project>/.claude/kairos/`
- scheduled tasks: `<project>/.claude/scheduled_tasks.json`

Relevant implementation entry points:

- daemon supervisor: `src 2/daemon/main.ts`
- KAIROS worker: `src 2/daemon/kairos/worker.ts`
- dashboard server: `src 2/daemon/dashboard/server.ts`
- terminal command surface: `src 2/commands/kairos.ts`
- Telegram gateway: `src 2/daemon/gateway/telegram/`

## Repo Layout

- `.github/` — workflows, CODEOWNERS, trunk guard
- `evals/` — evaluation-related workspace files
- `src 2/commands/` — command handlers and command UI
- `src 2/daemon/` — KAIROS daemon, dashboard, gateway, worker state
- `src 2/services/` — reminders, analytics, MCP, diagnostics, skill learning, API clients
- `src 2/tools/` — tool implementations exposed to the agent runtime
- `src 2/tasks/` — task execution surfaces
- `src 2/entrypoints/` — CLI and SDK entrypoints

## Quality Gates

Main branch protections and checks already present in the repo include:

- CI workflow in `.github/workflows/ci.yml` running install, pipeline, and tests
- CODEOWNERS on trunk paths in `.github/CODEOWNERS`
- trunk guard workflow in `.github/workflows/trunk-guard.yml`
- daily structural-fix workflow in `.github/workflows/permanent-structural-fix-daily.yml`
- Dependabot version updates in `.github/dependabot.yml` for Bun dependencies and GitHub Actions, with Dependabot security updates enabled at the repository level.
- Local proof command: `cd "src 2" && bun run proof:production`. This runs frozen-lockfile install verification, supply-chain audit, the production pipeline, the full test suite, non-running-test modifier scanning, clean-worktree verification, GitHub main workflow and hosted-step receipt checks, main branch protection checks, repository Actions default permission checks, repository security setting checks, Dependabot update-policy checks, open-PR check rollups, Node 24-ready checkout pinning, GitHub workflow frozen-install/audit/static-proof gate verification, least-privilege workflow token permission checks, incomplete-marker scanning, and bounded SDK/command-stub checks.
- Proof notes and current receipt in `docs/production-proof.md`

If you are changing guarded architecture paths, expect extra review friction and explicit approval requirements.

## Known Quirks

- The source root is currently `src 2/`; the rename to `src/` is tracked separately because it is broad path churn.
- Some KAIROS surfaces are intentionally implemented before full trunk registration so the codepaths can be iterated on safely.
- The Agent SDK compatibility facade is partial. Tool/server helpers, `getSessionMessages`, `forkSession`, session listing/info, rename/tag, and missed-task formatting are wired; query/session creation/prompting, `watchScheduledTasks`, and `connectRemoteControl` fail explicitly with a rebuild-specific unsupported message.
