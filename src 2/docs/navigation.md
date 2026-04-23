# MAGIC DOC: Repo navigation
_Keep this doc terse. Send readers to `./subsystems.yaml` first, then to the listed entry files and verification commands._

This repo's checked-in subsystem map lives in [subsystems.yaml](./subsystems.yaml).

Use it in this order:

1. Match the file you want to touch against the most specific `owned_paths` entry.
2. Read the subsystem's `entry_files` before scanning neighboring modules.
3. Check `high_risk_paths` and `change_expectation` to decide whether the change is likely `trunk-safe` or `trunk-touch`.
4. Run the subsystem's listed verification commands or tests before widening the diff.

Governance anchors:

- [CODEOWNERS](../../.github/CODEOWNERS)
- [trunk-guard workflow](../../.github/workflows/trunk-guard.yml)

The subsystem manifest is intentionally partial. It covers the core runtime slices that are easiest to break with broad edits:

- CLI / session loop
- AgentTool / subagents
- MCP / IDE bridge
- daemon / KAIROS surfaces
- state persistence
- telemetry / diagnostics
