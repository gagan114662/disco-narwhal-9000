# 100% Confidence CI: Map of Gates

This file maps each "100% confidence" gap (from the audit) to the concrete
artifact that closes it, plus how to verify the gate locally and in CI.

| #  | Gap                                                | Where it lives                                                            | How to verify locally                                                       |
|----|----------------------------------------------------|---------------------------------------------------------------------------|------------------------------------------------------------------------------|
| 1  | Full lint + typecheck with baseline                | `src 2/scripts/{lint,typecheck}Baseline.ts`, `tsconfig.full.json`         | `cd "src 2" && bun run typecheck:full && bun run lint:full`                  |
| 2  | Coverage gate                                      | `package.json` script `test:coverage`, ci.yml step                        | `cd "src 2" && bun run test:coverage`                                        |
| 3  | Mutation testing nightly                           | `src 2/stryker.conf.json`, `.github/workflows/mutation-test.yml`          | `cd "src 2" && bun run stryker` (slow; scoped to self-contained modules)     |
| 4  | OS x Bun matrix                                    | `.github/workflows/ci.yml`                                                | inspect strategy.matrix in ci.yml                                            |
| 5  | SAST + secret scanning                             | `.github/workflows/{codeql,secret-scan}.yml`                              | trigger workflow_dispatch                                                    |
| 6  | Supply-chain hardening (SHA pin, Scorecard, SBOM)  | All workflows pin by SHA; `.github/workflows/{scorecard,sbom}.yml`        | `grep -E '^\s*uses:' .github/workflows/*.yml \| grep -v '@[0-9a-f]\{40\}'`   |
| 7  | Network egress audit                               | `step-security/harden-runner` step in every workflow                       | grep `harden-runner` in `.github/workflows/`                                 |
| 8  | Daemon + dashboard E2E                             | `src 2/scripts/daemonDashboardE2E.ts`                                     | `cd "src 2" && bun run e2e:dashboard`                                        |
| 9  | Bundle artifact verification                       | `src 2/scripts/bundleBudget.ts`, `src 2/.bundle-budget.json`              | `cd "src 2" && bun run build && bun run bundle:budget`                       |
| 10 | Reproducibility check                              | `src 2/scripts/reproducibilityCheck.ts`                                   | `cd "src 2" && bun run bundle:reproducibility`                               |
| 11 | Nightly proof:production                           | `.github/workflows/proof-production-nightly.yml`                          | `cd "src 2" && bun run proof:production`                                     |
| 12 | Release artifact gate (sign + attest)              | `.github/workflows/release.yml` (cosign + attest-build-provenance)        | tag a `vX.Y.Z` and watch the release workflow                                |
| 13 | Branch protection                                  | `docs/BRANCH_PROTECTION.md` + `proof:production` gate                     | `cd "src 2" && bun run proof:production`                                     |
| 14 | Trunk-guard pattern test + JSON source             | `.github/trunk-patterns.json`, `src 2/scripts/trunkPatterns{,.test}.ts`   | `cd "src 2" && bun test ./scripts/trunkPatterns.test.ts`                     |
| 15 | Flake detection                                    | `.github/workflows/flake-detection.yml`                                   | trigger workflow_dispatch                                                    |
| 16 | Performance regression check                       | `src 2/scripts/perfBench.ts`, `src 2/.perf-budget.json`                   | `cd "src 2" && bun run perf:bench`                                           |
| 17 | License/policy check                               | `src 2/scripts/licenseCheck.ts`, `src 2/.license-policy.json`             | `cd "src 2" && bun run license:check`                                        |
| 18 | PR hygiene (commitlint, PR title, no-merge, owner) | `.github/workflows/pr-hygiene.yml`, `.commitlintrc.json`                  | inspect job list in pr-hygiene.yml                                           |
| 19 | Container/runtime hardening                        | `Dockerfile`, `.dockerignore`, `.github/workflows/container-scan.yml`     | `docker build -t kairos-cli:local -f Dockerfile .`                           |
| 20 | Disabled SDK surface tests                         | `src 2/entrypoints/agentSdkTypes.test.ts` (do-not-silently-re-enable)     | `cd "src 2" && bun test ./entrypoints/agentSdkTypes.test.ts`                 |

## Advisory Gates

- **Trivy container/filesystem scanning is advisory.** SARIF uploads to GitHub
  code scanning, but `.github/workflows/container-scan.yml` keeps
  `exit-code: '0'` until the first vulnerability baseline is triaged.
- **Scorecard is telemetry.** It publishes SARIF and artifacts, but it is not a
  branch-protection required check.

## Local "run everything you can" command

```bash
cd "src 2" && \
  bun install --frozen-lockfile && \
  bun run pipeline && \
  bun run typecheck:full && \
  bun run lint:full && \
  bun run test:coverage && \
  bun run bundle:budget && \
  bun run bundle:reproducibility && \
  bun run perf:bench && \
  bun run e2e:dashboard && \
  bun run license:check && \
  bun run proof:static && \
  bun test ./scripts/trunkPatterns.test.ts ./entrypoints/agentSdkTypes.test.ts
```

Anything that can only run on a GitHub-hosted runner (CodeQL, Scorecard,
TruffleHog, Trivy, attestations) ships as a workflow under
`.github/workflows/`. `gh workflow run <name>` triggers them on demand once
the branch is pushed.
