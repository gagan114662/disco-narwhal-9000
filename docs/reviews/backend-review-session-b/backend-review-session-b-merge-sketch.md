# Backend Review Session B Merge Resolution Sketch

This is a suggested shape for resolving the command and audit merge conflicts. It is intentionally a sketch, not a patch.

## Command Namespace

Recommended command ownership:

```text
/kairos build [projectDir] <brief>
/kairos builds [projectDir]
/kairos build-show [projectDir] <buildId>
/kairos build-events [projectDir] <buildId> [lines] [--kind <kind>]
/kairos build-* ...
/kairos build-audit-* ...
/kairos export tenant ...
/kairos import tenant ...

/kairos software-factory templates
/kairos software-factory run --accept-ip-terms [--template <id>] [projectDir] <brief>
/kairos software-factory list
/kairos software-factory show <buildId>
/kairos software-factory verify <buildId>
/kairos software-factory change <buildId> <change>
/kairos software-factory accept-change <buildId>
/kairos software-factory scan <buildId>
/kairos software-factory reconcile <buildId>
/kairos software-factory accept-reconciliation <buildId>
/kairos software-factory export <buildId>
/kairos software-factory audit verify <buildId> [--anchor]
```

Why this shape:
- It preserves `check-witty-squid-plan`'s bare `/kairos build` workflow for PRD/draft builds.
- It prevents Software Factory from overloading `build` with a second artifact model.
- It makes Software Factory audit verification visibly different from KAIROS build audit verification.
- It keeps all existing Software Factory actions available with mostly mechanical routing changes.

Lower-effort alternative:

```text
/kairos build [projectDir] <brief>
/kairos build run --accept-ip-terms ...
```

This is workable but weaker: the help text must be very explicit that bare `/kairos build` and `/kairos build run` create different artifact families.

## `commands/kairos.ts` Conflict Strategy

Resolve in this order:

1. Keep imports from both branches, then group them by artifact family.
2. Keep `check-witty-squid-plan`'s `parseBuildArgs`, `parseBuildShowArgs`, and KAIROS build handlers unchanged except for security fixes.
3. Rename `finish-prd-implementation`'s `handleBuild` to `handleSoftwareFactory`.
4. Rename `parseBuildRunArgs` to `parseSoftwareFactoryRunArgs`.
5. Rename `requireBuildId` to `requireSoftwareFactoryBuildId` if its usage remains Software Factory-specific.
6. Add `software-factory` to `Subcommand` and `SUBCOMMANDS`.
7. Route `case 'software-factory': return handleSoftwareFactory(rest)`.
8. Keep `case 'build': return handleBuild(rest)` for PRD/draft builds.
9. Update `HELP_TEXT` and `argumentHint` with both command families.

## Test Conflict Strategy

Resolve tests in this order:

1. Keep both branches' helper setup.
2. Merge the help-text assertions into one test that checks both families.
3. Move Software Factory command tests under a `describe('/kairos software-factory')`.
4. Keep KAIROS PRD/build audit tests under the existing `/kairos build` and `/kairos build-audit-*` describes.
5. Add regression tests from `backend-review-session-b-test-plan.md` before declaring the merge done.

## Audit Schema Strategy

Pick one of these before merging:

### Option A: Shared Canonical Audit Event

Use one event shape across both artifact families:

```ts
type KairosAuditEventV1 = {
  version: 1
  artifactType: 'kairos_build' | 'software_factory'
  artifactId: string
  tenantId: string
  t: string
  kind: string
  details: Record<string, unknown>
  prevHash: string | null
  hash: string
}
```

Then use a shared export envelope:

```ts
type KairosAuditExportV1 = {
  version: 1
  artifactType: 'kairos_build' | 'software_factory'
  artifactId: string
  tenantId: string
  eventCount: number
  headHash: string | null
  merkleRoot: string | null
  redactionPolicy?: unknown
  erasureSummary?: unknown
  events: KairosAuditEventV1[]
  exportHash: string
  auditSignature: KairosAuditExportSignature
}
```

### Option B: Adapter Layer

Keep branch-local event shapes, but add explicit adapters:

```ts
toCanonicalAuditEventFromKairosBuild(event)
toCanonicalAuditEventFromSoftwareFactory(event)
toCanonicalAuditExport(...)
```

This is safer if the branches need to land with minimal churn, but it should be treated as an intermediate step.

## Security Fix Placement

Apply security fixes before or during conflict resolution:

- `verifyKairosAuditExportSignature()` should reject unsigned metadata when a signing key exists and use `timingSafeEqual`.
- Tenant archive verification should call the same build ID validator as path creation.
- Software Factory should validate tenant IDs before path joins.
- Software Factory should validate manifest `appDir` against expected app dir before verification/export.

## Final Verification

After conflict resolution:

```text
bun test './daemon/kairos/softwareFactory.test.ts' './commands/kairos.test.ts'
bun test './daemon/kairos/buildAudit.test.ts' './daemon/kairos/stateWriter.test.ts' './daemon/kairos/draftBuild.test.ts' './daemon/kairos/paths.test.ts' './commands/kairos.test.ts'
```
