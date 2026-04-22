# Add model-executable issue templates and revive the /issue scaffolder

Type: leaf build
Summary: Focused implementation slice that should be independently shippable.

## Problem
- This repo had no checked-in GitHub issue templates, and `/issue` resolved to a hidden disabled stub.
- That made it easy to write backlog items that were fine for humans but underspecified for autonomous contributors.

## User/Developer Impact
- Contributors can now start from a consistent work-order format instead of hand-writing issue bodies from scratch.
- The issue intake path becomes stricter about scope, acceptance criteria, and suggested entry points.

## Scope
- Add structured GitHub issue forms under `.github/ISSUE_TEMPLATE/`.
- Replace the stubbed `src 2/commands/issue/index.js` path with a working scaffold generator.
- Add a focused automated test for the scaffold generator and a concrete example draft in docs.

## Out of Scope
- Creating GitHub issues directly from inside the app.
- Automated triage, prioritization, or assignee selection.

## Acceptance Criteria
- [ ] GitHub offers at least three structured issue templates in the repo.
- [ ] `/issue` returns a usable markdown scaffold instead of resolving to a hidden disabled stub.
- [ ] The scaffold includes problem, impact, scope, out-of-scope, acceptance criteria, entry points, verification, and trunk expectations.

## Suggested Entry Points
- `src 2/commands/issue/index.ts`
- `src 2/commands/issue/scaffold.ts`
- `.github/ISSUE_TEMPLATE/`

## Verification / Test Plan
- [ ] Run `bun test ./commands/issue/issue.test.ts` from `src 2`.
- [ ] Invoke `/issue leaf Add model-executable issue templates and revive the /issue scaffolder` and confirm the returned body contains the canonical sections.
- [ ] Confirm GitHub shows the three new templates in the issue picker.

## Trunk Expectations
- Preferred: trunk-safe
- Escalate to trunk-touch only if the issue must cross guarded files or shared infra.
