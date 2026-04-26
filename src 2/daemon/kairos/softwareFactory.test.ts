import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  acceptSoftwareFactoryChange,
  acceptSoftwareFactoryReconciliation,
  exportSoftwareFactoryCompliancePack,
  listSoftwareFactoryBuilds,
  proposeSoftwareFactoryReconciliation,
  proposeSoftwareFactoryChange,
  readSoftwareFactoryBuild,
  runSoftwareFactoryBuild,
  scanSoftwareFactoryTraceability,
  verifySoftwareFactoryBuild,
} from './softwareFactory.js'

const TEMP_DIRS: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.KAIROS_TENANT_ID
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('software factory build', () => {
  test('rejects path-like build IDs before reading artifacts', async () => {
    await expect(
      verifySoftwareFactoryBuild('sf-../outside'),
    ).rejects.toThrow('Invalid Software Factory build ID')
  })

  test('writes a traceable generated app, eval pack, review, smoke result, and audit chain', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    let nextId = 0
    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief:
        'Build a leave request app. Managers approve pending requests. Audit every approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => `id${++nextId}`,
    })

    expect(result.status).toBe('succeeded')
    expect(result.buildId).toBe('sf-id1')
    expect(result.appId).toContain('leave-request-app')
    expect(existsSync(result.specPath)).toBe(true)
    expect(existsSync(result.projectSpecPath)).toBe(true)
    expect(existsSync(result.projectSpecMarkdownPath)).toBe(true)
    expect(existsSync(result.evalPackPath)).toBe(true)
    expect(existsSync(result.projectEvalPackPath)).toBe(true)
    expect(existsSync(join(result.appDir, 'src', 'server.ts'))).toBe(true)

    const spec = readJson(result.specPath) as {
      clauses: Array<{ id: string; text: string }>
    }
    const evalPack = readJson(result.evalPackPath) as {
      cases: Array<{ clauseId: string; gates: string[] }>
    }
    const review = readJson(result.reviewPath) as {
      status: string
      verdicts: Array<{ clauseId: string; status: string }>
    }
    const smoke = readJson(result.smokePath) as { status: string }
    const server = readFileSync(join(result.appDir, 'src', 'server.ts'), 'utf8')

    expect(spec.clauses.length).toBeGreaterThanOrEqual(3)
    expect(evalPack.cases).toHaveLength(spec.clauses.length)
    expect(
      evalPack.cases.every(testCase =>
        testCase.gates.includes('traceability'),
      ),
    ).toBe(true)
    expect(review.status).toBe('passed')
    expect(review.verdicts.every(verdict => verdict.status === 'satisfied')).toBe(true)
    expect(smoke.status).toBe('passed')
    for (const clause of spec.clauses) {
      expect(server).toContain(`kairos:clause=${clause.id}`)
    }

    const auditLines = readFileSync(result.auditPath, 'utf8').trim().split('\n')
    expect(auditLines).toHaveLength(7)
    const auditEvents = auditLines.map(line => JSON.parse(line)) as Array<{
      kind: string
      details: Record<string, unknown>
      prevHash: string | null
      hash: string
    }>
    expect(auditEvents[0]?.prevHash).toBeNull()
    expect(auditEvents[0]?.details.prompt_sha).toBeString()
    expect(auditEvents[0]?.details.model_id).toBe(
      'kairos-deterministic-local-v1',
    )
    expect(auditEvents[0]?.details.cost_usd).toBe(0)
    expect(
      auditEvents.every(
        event =>
          typeof event.details.prompt_sha === 'string' &&
          event.details.model_id === 'kairos-deterministic-local-v1' &&
          event.details.cost_usd === 0,
      ),
    ).toBe(true)
    for (let index = 1; index < auditEvents.length; index++) {
      expect(auditEvents[index]?.prevHash).toBe(auditEvents[index - 1]?.hash)
    }
    expect(auditEvents.map(event => event.kind)).toEqual([
      'build.started',
      'spec.confirmed',
      'eval_pack.generated',
      'builder.scaffold_written',
      'reviewer.verdict_recorded',
      'smoke.completed',
      'build.completed',
    ])

    const summary = await readSoftwareFactoryBuild(result.buildId)
    expect(summary.title).toBe('Leave Request App')
    expect(summary.status).toBe('succeeded')

    const listed = await listSoftwareFactoryBuilds()
    expect(listed.map(build => build.buildId)).toEqual([result.buildId])

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(true)
    expect(verification.checks.map(check => check.id)).toEqual([
      'artifact-build-ids',
      'eval-pack',
      'manifest-files',
      'project-spec',
      'project-eval-pack',
      'manifest-traceability',
      'code-markers',
      'untraceable-code',
      'review',
      'smoke',
      'audit-chain',
    ])

    const exported = await exportSoftwareFactoryCompliancePack(result.buildId, {
      now: () => new Date('2026-04-26T12:02:00.000Z'),
    })
    expect(exported.verified).toBe(true)
    expect(exported.fileCount).toBe(5)
    expect(exported.auditEventCount).toBe(7)
    expect(existsSync(exported.exportPath)).toBe(true)
    const compliancePack = readJson(exported.exportPath) as {
      exportHash: string
      generatedFiles: Array<{ path: string; sha256: string; content: string }>
      verification: { ok: boolean }
    }
    expect(compliancePack.exportHash).toBe(exported.exportHash)
    expect(compliancePack.generatedFiles.map(file => file.path)).toContain(
      'README.md',
    )
    expect(compliancePack.verification.ok).toBe(true)
  })

  test('verification catches stale repo-local project specs', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a purchase approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'project-spec',
    })
    const projectSpec = readJson(result.projectSpecPath) as {
      clauses: Array<{ id: string; text: string }>
    }
    if (projectSpec.clauses[0]) {
      projectSpec.clauses[0].text = 'Stale repo-local clause'
    }
    writeFileSync(result.projectSpecPath, `${JSON.stringify(projectSpec)}\n`)

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(false)
    expect(
      verification.checks.find(check => check.id === 'project-spec')?.ok,
    ).toBe(false)
  })

  test('verification catches stale repo-local eval packs', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a vendor approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'project-eval',
    })
    const projectEvalPack = readJson(result.projectEvalPackPath) as {
      cases: Array<{ clauseId: string }>
    }
    if (projectEvalPack.cases[0]) {
      projectEvalPack.cases[0].clauseId = 'CL-999'
    }
    writeFileSync(
      result.projectEvalPackPath,
      `${JSON.stringify(projectEvalPack)}\n`,
    )

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(false)
    expect(
      verification.checks.find(check => check.id === 'project-eval-pack')?.ok,
    ).toBe(false)
  })

  test('verification and export reject unsafe manifest file paths', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a vendor approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'manifest-path',
    })
    const manifest = readJson(result.appManifestPath) as {
      files: string[]
    }
    manifest.files.push('../secret.txt')
    writeFileSync(result.appManifestPath, `${JSON.stringify(manifest)}\n`)

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(false)
    expect(
      verification.checks.find(check => check.id === 'manifest-files')?.ok,
    ).toBe(false)
    await expect(
      exportSoftwareFactoryCompliancePack(result.buildId),
    ).rejects.toThrow('Unsafe Software Factory app-relative path')
  })

  test('generated app shell escapes user-provided spec text', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const scriptPayload = ['<', 'script', '>alert("x")</', 'script', '>'].join('')
    const imagePayload = '<img src=x onerror=alert(1)>'

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief:
        `Build ${scriptPayload} app. Show vendor notes ${imagePayload}.`,
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'html',
    })

    const appSource = readFileSync(join(result.appDir, 'src', 'app.ts'), 'utf8')
    expect(appSource).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(appSource).toContain(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
    expect(appSource).not.toContain(scriptPayload)
    expect(appSource).not.toContain(imagePayload)

    const appModule = (await import(
      pathToFileURL(join(result.appDir, 'src', 'app.ts')).href
    )) as {
      renderAppShell: (
        records: Array<{ id: string; title: string; status: string }>,
      ) => string
    }
    const rendered = appModule.renderAppShell([
      { id: 'rec-1', title: imagePayload, status: 'pending' },
    ])
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(rendered).not.toContain(imagePayload)
  })

  test('traceability scan records untraceable code drift in the audit chain', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a purchasing workflow app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'drift',
    })

    writeFileSync(
      join(result.appDir, 'src', 'backdoor.ts'),
      'export function bypassApproval(): boolean { return true }\n',
    )

    const scan = await scanSoftwareFactoryTraceability(result.buildId, {
      now: () => new Date('2026-04-26T12:01:00.000Z'),
    })
    expect(scan.ok).toBe(false)
    expect(scan.untraceableFiles).toEqual(['src/backdoor.ts'])
    expect(scan.auditEventAppended).toBe(true)

    const auditEvents = readFileSync(result.auditPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)) as Array<{ kind: string }>
    expect(auditEvents.at(-1)?.kind).toBe('code.drift_detected')

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(false)
    expect(
      verification.checks.find(check => check.id === 'untraceable-code')
        ?.detail,
    ).toContain('missing kairos:clause markers')
  })

  test('reconciliation proposal turns untraceable files into proposed spec deltas', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a contract review app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'reconcile',
    })
    writeFileSync(
      join(result.appDir, 'src', 'contract-upload.ts'),
      'export function uploadContract(): string { return "ok" }\n',
    )

    const reconciliation = await proposeSoftwareFactoryReconciliation(
      result.buildId,
      {
        now: () => new Date('2026-04-26T12:03:00.000Z'),
      },
    )
    expect(reconciliation.status).toBe('proposed')
    expect(reconciliation.deltaCount).toBe(1)
    expect(reconciliation.auditEventAppended).toBe(true)

    const proposal = readJson(reconciliation.proposalPath) as {
      deltas: Array<{ sourceFile: string; proposedClauseText: string }>
    }
    expect(proposal.deltas[0]?.sourceFile).toBe('src/contract-upload.ts')
    expect(proposal.deltas[0]?.proposedClauseText).toContain(
      'Contract Upload',
    )

    const auditEvents = readFileSync(result.auditPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)) as Array<{ kind: string }>
    expect(auditEvents.at(-1)?.kind).toBe('reconciliation.proposed')
  })

  test('accepting reconciliation rejects proposals for a different build', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a contract approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'wrong-reconcile',
    })
    writeFileSync(
      join(result.appDir, 'src', 'contract-risk.ts'),
      'export function contractRisk(): number { return 7 }\n',
    )
    const proposed = await proposeSoftwareFactoryReconciliation(result.buildId)
    const proposal = readJson(proposed.proposalPath) as { buildId: string }
    proposal.buildId = 'sf-other-build'
    writeFileSync(proposed.proposalPath, `${JSON.stringify(proposal)}\n`)

    await expect(
      acceptSoftwareFactoryReconciliation(result.buildId),
    ).rejects.toThrow('Cannot accept reconciliation proposal')
  })

  test('accepting reconciliation revises spec, eval pack, trace markers, and audit', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a supplier review app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'accept',
    })
    writeFileSync(
      join(result.appDir, 'src', 'supplier-risk.ts'),
      'export function supplierRisk(): number { return 42 }\n',
    )
    await proposeSoftwareFactoryReconciliation(result.buildId, {
      now: () => new Date('2026-04-26T12:03:00.000Z'),
    })

    const accepted = await acceptSoftwareFactoryReconciliation(result.buildId, {
      now: () => new Date('2026-04-26T12:04:00.000Z'),
    })
    expect(accepted.accepted).toBe(true)
    expect(accepted.acceptedClauseIds).toEqual(['CL-004'])
    expect(accepted.auditEventAppended).toBe(true)

    const spec = readJson(result.specPath) as {
      clauses: Array<{ id: string; text: string }>
    }
    const projectSpec = readJson(result.projectSpecPath) as {
      clauses: Array<{ id: string; text: string }>
    }
    const evalPack = readJson(result.evalPackPath) as {
      cases: Array<{ clauseId: string }>
    }
    const source = readFileSync(
      join(result.appDir, 'src', 'supplier-risk.ts'),
      'utf8',
    )
    expect(spec.clauses.map(clause => clause.id)).toContain('CL-004')
    expect(evalPack.cases.map(testCase => testCase.clauseId)).toContain(
      'CL-004',
    )
    expect(source).toContain('kairos:clause=CL-004')
    expect(projectSpec.clauses.map(clause => clause.id)).toContain('CL-004')

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(true)
    const auditEvents = readFileSync(result.auditPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)) as Array<{ kind: string }>
    expect(auditEvents.at(-1)?.kind).toBe('reconciliation.accepted')
  })

  test('change proposal applies a new spec clause and traceable generated file', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build an invoice review app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'change',
    })
    const proposal = await proposeSoftwareFactoryChange(
      result.buildId,
      'Add CSV export for approved invoices.',
      {
        now: () => new Date('2026-04-26T12:05:00.000Z'),
      },
    )
    expect(proposal.proposedClauseId).toBe('CL-004')
    expect(proposal.generatedFilePath).toContain('change-cl-004')

    const accepted = await acceptSoftwareFactoryChange(result.buildId, {
      now: () => new Date('2026-04-26T12:06:00.000Z'),
    })
    expect(accepted.accepted).toBe(true)
    expect(accepted.acceptedClauseId).toBe('CL-004')
    expect(accepted.generatedFilePath).toBe(proposal.generatedFilePath)

    const spec = readJson(result.specPath) as {
      clauses: Array<{ id: string; text: string }>
    }
    const projectSpec = readJson(result.projectSpecPath) as {
      clauses: Array<{ id: string; text: string }>
    }
    const evalPack = readJson(result.evalPackPath) as {
      cases: Array<{ clauseId: string }>
    }
    const changeSource = readFileSync(
      join(result.appDir, proposal.generatedFilePath),
      'utf8',
    )
    expect(spec.clauses.map(clause => clause.id)).toContain('CL-004')
    expect(evalPack.cases.map(testCase => testCase.clauseId)).toContain(
      'CL-004',
    )
    expect(changeSource).toContain('kairos:clause=CL-004')
    expect(projectSpec.clauses.map(clause => clause.id)).toContain('CL-004')

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(true)
    const auditEvents = readFileSync(result.auditPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)) as Array<{ kind: string }>
    expect(auditEvents.at(-2)?.kind).toBe('change.proposed')
    expect(auditEvents.at(-1)?.kind).toBe('change.applied')
  })

  test('accepting change rejects unsafe generated file paths', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build an invoice approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'unsafe-change',
    })
    const proposed = await proposeSoftwareFactoryChange(
      result.buildId,
      'Add printable approval summary.',
    )
    const proposal = readJson(proposed.proposalPath) as {
      generatedFile: { path: string }
    }
    proposal.generatedFile.path = '../escape.ts'
    writeFileSync(proposed.proposalPath, `${JSON.stringify(proposal)}\n`)

    await expect(acceptSoftwareFactoryChange(result.buildId)).rejects.toThrow(
      'Unsafe Software Factory app-relative path',
    )
  })

  test('accepting change rejects generated files without clause markers', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a staffing approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'marker-change',
    })
    const proposed = await proposeSoftwareFactoryChange(
      result.buildId,
      'Add printable approval summary.',
    )
    const proposal = readJson(proposed.proposalPath) as {
      generatedFile: { content: string }
    }
    proposal.generatedFile.content =
      'export function untraceableChange(): boolean { return true }\n'
    writeFileSync(proposed.proposalPath, `${JSON.stringify(proposal)}\n`)

    await expect(acceptSoftwareFactoryChange(result.buildId)).rejects.toThrow(
      'generated file is missing kairos:clause=',
    )
  })

  test('accepting change rejects builds with unresolved traceability drift', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build a travel approval app with reviewer approval.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'drift-change',
    })
    await proposeSoftwareFactoryChange(
      result.buildId,
      'Add printable approval summary.',
    )
    writeFileSync(
      join(result.appDir, 'src', 'unreviewed.ts'),
      'export function unreviewed(): boolean { return true }\n',
    )

    await expect(acceptSoftwareFactoryChange(result.buildId)).rejects.toThrow(
      'Cannot accept change while build verification is failing',
    )
  })

  test('verification catches a tampered audit chain', async () => {
    const configDir = makeTempDir('kairos-sf-config-')
    const projectDir = makeTempDir('kairos-sf-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const result = await runSoftwareFactoryBuild({
      projectDir,
      brief: 'Build an expense approval app with manager review.',
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      generateId: () => 'fixed',
    })

    const lines = readFileSync(result.auditPath, 'utf8').trim().split('\n')
    const tampered = JSON.parse(lines[1] as string) as { kind: string }
    tampered.kind = 'build.completed'
    lines[1] = JSON.stringify(tampered)
    writeFileSync(result.auditPath, `${lines.join('\n')}\n`)

    const verification = await verifySoftwareFactoryBuild(result.buildId)
    expect(verification.ok).toBe(false)
    expect(
      verification.checks.find(check => check.id === 'audit-chain')?.detail,
    ).toContain('hash mismatch')
  })
})
