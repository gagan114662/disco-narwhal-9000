# KAIROS

KAIROS is a Claude-Code-native personal automation platform under active development in this repository.

Today the repo is a Bun-based CLI/daemon codebase with KAIROS-specific work layered into it: a local background worker, a browser dashboard, reminders, Telegram gateway codepaths, skill import/export, diagnostics, and agent-oriented tooling.

## Current Status

- The main application currently lives under `src 2/`, not `src/`.
- The root of the repo is intentionally thin: GitHub/workspace metadata at the top level, product code under `src 2/`.
- KAIROS daemon/dashboard work is present and test-covered, but some command registration and packaging paths are still in progress.

If you are new to the repo, start in:

- `src 2/package.json`
- `src 2/entrypoints/cli.tsx`
- `src 2/daemon/main.ts`
- `src 2/commands/kairos.ts`
- `src 2/daemon/dashboard/`
- `src 2/daemon/kairos/`

## Prerequisites

- Bun `1.2.23`
- macOS or Linux-like shell environment

## Quickstart

```bash
cd 'src 2'
bun install --frozen-lockfile
bun run smoke:cli
```

Useful validation commands:

```bash
cd 'src 2'
bun test
bun run pipeline
```

For faster local iteration on KAIROS-specific work:

```bash
cd 'src 2'
bun test ./commands/kairos.test.ts
bun test ./daemon/dashboard/server.test.ts
```

## Running KAIROS

Start the daemon:

```bash
cd 'src 2'
bun ./entrypoints/cli.tsx daemon kairos
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

- CODEOWNERS on trunk paths in `.github/CODEOWNERS`
- trunk guard workflow in `.github/workflows/trunk-guard.yml`
- daily structural-fix workflow in `.github/workflows/permanent-structural-fix-daily.yml`

If you are changing guarded architecture paths, expect extra review friction and explicit approval requirements.

## Known Quirks

- The source root is currently `src 2/`; the rename to `src/` is tracked separately because it is broad path churn.
- There is a `tmp-recover-cli.js` artifact in `src 2/`; do not treat it as a primary source file.
- Some KAIROS surfaces are intentionally implemented before full trunk registration so the codepaths can be iterated on safely.
