# Canonical Wide Events

`src 2/services/analytics/wideEvents.ts` is the source of truth for canonical wide events.

Use the canonical events when you need durable answers about work-unit outcomes:

- task creation and terminal outcomes
- subagent start and stop outcomes
- tool execution completion, denial, failure, or interruption
- diagnostics regressions introduced by edits

Use ad hoc analytics when you need short-lived product instrumentation, experiment reads, or UI interaction metrics that do not need long-term schema stability.

## Current Canonical Events

- `tengu_wide_task_lifecycle`
  Required fields: `lifecycle`, `task_family`, `execution_mode`, `has_tool_use_id`
- `tengu_wide_agent_lifecycle`
  Required fields: `lifecycle`, `execution_mode`, `agent_family`, `model_family`, `is_built_in_agent`
- `tengu_wide_tool_execution`
  Required fields: `result`, `tool_family`, `tool_transport`, `is_read_only`
- `tengu_wide_diagnostics_regression`
  Required fields: `change`, `tracked_file_count`, `affected_file_count`, `diagnostic_count`, `error_count`, `warning_count`, `info_count`, `hint_count`, `has_linter_diagnostics`

## Cardinality Rules

- Keep string fields bounded and enumerable. Prefer buckets like `foreground`, `background`, `remote`, `custom`, and `mcp`.
- Do not log raw prompts, file paths, commands, tool inputs, transcript text, or user-authored freeform strings.
- If you need a new canonical field, add it in `wideEvents.ts`, document it here, and make sure it is stable enough for dashboards and alerts.
- If a value can grow without bound across repos, users, or sessions, it does not belong in a canonical wide event.
