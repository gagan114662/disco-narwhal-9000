---
name: permanent-structural-fix
description: Turn a failure, regression, or repeated manual workaround into a permanent repo fix by codifying a skill, deterministic code, tests, evals, resolver triggers, duplicate audits, and a daily enforcement loop.
when_to_use: Use when a bug, incident, or repeated manual fix should become a durable repo capability instead of another one-off patch. Trigger phrases include "turn this into a permanent fix", "codify this failure", "make sure this never happens again", "write a skill with tests and evals", and "add a resolver trigger".
argument-hint: "<failure summary>"
arguments:
  - failure_summary
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash(bun:*)
  - Bash(git:*)
---

# Permanent Structural Fix

Turn a concrete failure into a permanent repo asset.

## Input

- `$failure_summary`: Short description of the failure, regression, or repeated workaround.

## Goal

Ship the smallest complete loop that prevents the same class of failure from silently returning:
- a repo-local skill
- deterministic code for the non-LLM pieces
- unit tests
- LLM eval fixtures
- a resolver trigger plus resolver eval
- duplicate audits
- a smoke path
- a daily enforcement loop

## Steps

### 1. Capture the failure shape

Map the failure into one sentence, the missing asset, and the ongoing enforcement needed.

**Success criteria**:
- The failure is named precisely.
- The missing permanent asset is explicit.
- The enforcement loop is defined before editing code.

### 2. Codify the workflow as a skill

Write or update `.claude/skills/permanent-structural-fix/SKILL.md` so the repo has a reusable operator manual for this failure class.

**Success criteria**:
- The skill says when to fire.
- The skill names the required artifacts.
- The skill points to the deterministic scripts and smoke path.

### 3. Move fragile logic into deterministic code

Put the repeatable, judgeable parts in `src 2/services/structuralFix/structuralFix.ts`:
- resolver matching
- resolver scoring
- duplicate audits
- smoke orchestration
- daily schedule installation

**Success criteria**:
- The non-LLM steps run without interpretation.
- Inputs and outputs are machine-checkable.

### 4. Add tests and eval fixtures

Update the checked-in JSON fixtures and unit tests so the behavior is enforced even if the skill text changes.

**Success criteria**:
- Unit tests cover the deterministic logic.
- Resolver eval cases cover both positive and negative examples.
- LLM eval cases ask whether the response produced all structural artifacts instead of stopping at a patch.

### 5. Wire the resolver trigger

Update `.claude/skills/RESOLVER.md` and `.claude/skills/permanent-structural-fix/resolver-trigger.json` so requests matching this failure class route to this skill.

**Success criteria**:
- Trigger phrases are explicit.
- The deterministic resolver passes its eval cases.

### 6. Audit for drift and duplicates

Run:
- `bun run structural-fix:resolver-eval`
- `bun run structural-fix:smoke`

These checks must reject duplicate trigger phrases, duplicate eval ids, missing artifacts, and resolver misses.

**Success criteria**:
- Duplicate audit is clean.
- Smoke succeeds.
- The daily schedule is installed or confirmed as already present.

### 7. Keep it alive every day

Use the daily workflow in `.github/workflows/permanent-structural-fix-daily.yml` and the project cron task installed by the smoke script.

**Success criteria**:
- The workflow runs on a daily schedule.
- The project cron task exists or is re-installed idempotently.
- The repo no longer depends on memory of the incident.
