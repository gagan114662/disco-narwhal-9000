# Add deterministic requirement, design, and work-order scaffolds

Artifact Type: work order
Artifact ID: WO-ADD-DETERMINISTIC-REQUIRE-001
Coverage ID: COV-WO-ADD-DETERMINISTIC-REQUIRE-001
Stage Summary: Translate approved requirements and design into the smallest independently shippable implementation slice.
Transformation Rule: Preserve upstream REQ, AC, and DES IDs verbatim. Do not renumber or reinterpret upstream constraints inside the execution plan.

## Summary
- Add a requirement-stage template plus stricter design and work-order scaffolds so issue intake behaves more like a typed artifact pipeline than a loose markdown note.
- This is the smallest reviewable slice because it only changes the issue command, the GitHub forms, and one example document.

## In Scope
- `src 2/commands/issue/`
- `.github/ISSUE_TEMPLATE/`
- `docs/issue-scaffold-example.md`

## Out of Scope
- GitHub API issue creation from inside the app
- Planner-style phase management
- Automatic synchronization between issues and code

## Requirements
- Required upstream IDs: `REQ-ISSUE-DETERMINISM-001`, `AC-REQ-ISSUE-DETERMINISM-001.1`, `AC-REQ-ISSUE-DETERMINISM-001.2`
- Copy the upstream requirement text verbatim here before implementation begins.
- Do not renumber or paraphrase inherited IDs.

## Blueprints / Design References
- Required design IDs: `DES-ISSUE-DETERMINISM-001`
- Code / docs / tests to inspect first:
- `src 2/commands/issue/scaffold.ts`
- `.github/ISSUE_TEMPLATE/`

## Acceptance Criteria
- [ ] `AC-WO-ADD-DETERMINISTIC-REQUIRE-001.1`: The issue scaffolder emits stable artifact IDs and coverage IDs for each stage.
- [ ] `AC-WO-ADD-DETERMINISTIC-REQUIRE-001.2`: Requirement, design, work-order, and bug templates require upstream references and structured verification fields.
- [ ] `AC-WO-ADD-DETERMINISTIC-REQUIRE-001.3`: Reviewers can verify the new schema without inferring missing context.

## Suggested Entry Points
- `src 2/commands/issue/index.ts`
- `src 2/commands/issue/scaffold.ts`
- `.github/ISSUE_TEMPLATE/requirement-definition.yml`

## E2E Acceptance Tests
### COV-WO-ADD-DETERMINISTIC-REQUIRE-001
- Test command: `bun test ./commands/issue/issue.test.ts`
- Manual flow: Run `/issue requirement Define checkout fulfillment holds` and `/issue work-order Add retry budget logging to the RPC client`.
- Assertions mapped to the AC IDs above:
- Work-order output includes `Artifact ID`, `AC-WO-...`, and `COV-WO-...`.
- Requirement output includes `REQ-...`, `AC-REQ-...`, and `COV-REQ-...`.
- Known gaps / deferred coverage: no live GitHub UI check is automated in-repo.

## Trunk Expectations
- Preferred: trunk-safe
- Escalate to trunk-touch only if trunk ownership or shared infrastructure makes isolation impossible.
