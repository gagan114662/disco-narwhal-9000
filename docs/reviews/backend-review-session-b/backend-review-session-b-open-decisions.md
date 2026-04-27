# Backend Review Session B Open Decisions

These are the decisions that should be made before implementation work starts on the merge/fix branch.

## Command Surface

Decision needed:
- Should Software Factory remain under `/kairos build run ...`, or move to `/kairos software-factory ...`?

Recommendation:
- Move Software Factory to `/kairos software-factory ...`.

Reason:
- `check-witty-squid-plan` uses bare `/kairos build [projectDir] <brief>` for PRD/draft build creation.
- Software Factory and KAIROS draft builds create different artifact families with different audit schemas and storage locations.

## Audit Schema

Decision needed:
- Should the merge introduce one canonical audit schema immediately, or land an adapter layer first?

Recommendation:
- If there is time before merge, introduce a canonical envelope now.
- If merge pressure is high, land explicit adapters but treat them as temporary.

Reason:
- Both branches already expose audit export/verification behavior.
- Letting both schemas leak into user-facing export formats will make future compatibility harder.

## Signature Policy

Decision needed:
- Should unsigned audit exports be accepted when a verifier has a signing key configured?

Recommendation:
- No. Treat unsigned metadata as invalid when `KAIROS_AUDIT_SIGNING_KEY` is configured.

Reason:
- A configured signing key means the verifier expects signed artifacts.
- Accepting unsigned metadata creates a downgrade path.

## Build ID Policy

Decision needed:
- Should tenant archive verification use the exact same build ID pattern as local path creation?

Recommendation:
- Yes.

Reason:
- Verification should never certify an archive that import cannot store safely.

## Portable Artifact Paths

Decision needed:
- Should portable audit/compliance artifacts contain local absolute paths?

Recommendation:
- No. Use relative paths, stable IDs, or hashes in portable artifacts.

Reason:
- Absolute paths leak local environment details and make exported artifacts machine-specific.

## Software Factory Builder Mode

Decision needed:
- Is deterministic Software Factory generation acceptable for the next merge?

Recommendation:
- Accept only as an explicitly labeled local/prototype mode.
- Track the real LLM builder/reviewer swap as the next required implementation step.

Reason:
- The deterministic implementation is useful for tests, but it does not satisfy semantic generation/review expectations.
