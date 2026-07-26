// tests/eval/fragility-check/fragility-check.test.ts
// fragility lane gating, durable envelopes, path hygiene, & inert Markdown

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  FRAGILITY_CHECK_ISSUE_CODES,
  MAX_COUNTER_EVIDENCE_PER_FINDING,
  MAX_EVIDENCE_PER_FINDING,
  MAX_FRAGILITY_REPORT_ARTIFACT_BYTES,
  MAX_REPORT_ADVISORIES,
  MAX_REPORT_FINDINGS,
  MAX_REPORT_TEXT_VALUE_BYTES,
  ProjectArtifactStore,
  fragilityCheckReportJson,
  fragilityCheckReportMarkdown,
  runFragilityCheck,
  writeFragilityCheckCheckpoint,
  type FragilityCheckReport,
} from '@scratch-agent/eval'
import { mdCode } from '@scratch-agent/runner'
import {
  buildFixtureSb3,
  createScratchRecord,
  defineScratchRecordValue,
  packSb3,
  type BlockEntry,
  type BlockField,
  type BlockInput,
} from '@scratch-agent/sb3'

const PROBE_PATH = resolve('scripts/project/fragility-probe.ts')

class FailJsonInstallOnceStore extends ProjectArtifactStore
{
  private failed = false

  protected override installPreparedArtifact(
    temporaryPath: string,
    finalPath: string
  ): void
  {
    if (!this.failed && finalPath.endsWith('fragility-check.json'))
    {
      this.failed = true
      throw new Error('injected JSON install failure')
    }
    super.installPreparedArtifact(temporaryPath, finalPath)
  }
}

async function fragilityFixture(
  targetName = 'Sprite1',
  meta: { semver?: string; vm?: string } = {}
): Promise<Uint8Array>
{
  const fixture = await buildFixtureSb3()
  Object.assign(fixture.project.meta, meta)
  const target = fixture.project.targets.find((entry) => !entry.isStage)!
  target.name = targetName
  target.blocks = createScratchRecord<BlockEntry>(Object.entries(target.blocks))
  defineScratchRecordValue<BlockEntry>(target.blocks, 'fragility-definition', {
    opcode: 'procedures_definition',
    next: 'fragility-say',
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['custom_block', [1, 'fragility-prototype']],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 300,
    y: 100,
  })
  defineScratchRecordValue<BlockEntry>(target.blocks, 'fragility-prototype', {
    opcode: 'procedures_prototype',
    next: null,
    parent: 'fragility-definition',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: true,
    topLevel: false,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'fragility `probe`',
      argumentids: '[]',
      argumentnames: '[]',
      argumentdefaults: '[]',
      warp: true,
    },
  })
  defineScratchRecordValue<BlockEntry>(target.blocks, 'fragility-say', {
    opcode: 'looks_sayforsecs',
    next: null,
    parent: 'fragility-definition',
    inputs: createScratchRecord<BlockInput>([
      ['MESSAGE', [1, [10, 'fragility']]],
      ['SECS', [1, [4, 1]]],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  return packSb3(JSON.stringify(fixture.project), [])
}

test('fragility check retains reports & gates findings only when requested', async () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-check-'))
  try
  {
    const bytes = await fragilityFixture()
    const successRoot = join(temp, 'success')
    const success = await runFragilityCheck({
      input: { bytes, displayName: 'fragility.sb3' },
      runRoot: successRoot,
      runId: 'fragility-success',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    assert.ok(success.report.findings.length >= 1)
    assert.equal(success.report.overall.status, 'passed')
    const persisted = JSON.parse(
      readFileSync(join(successRoot, 'fragility-check.json'), 'utf-8')
    ) as typeof success.report
    assert.deepEqual(persisted, success.report)
    assert.notEqual(persisted.completedAt, null)
    const repeated = await runFragilityCheck({
      input: { bytes, displayName: 'fragility.sb3' },
      runRoot: successRoot,
      runId: 'fragility-repeated',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    assert.equal(repeated.report.overall.status, 'failed')
    assert.equal(
      repeated.report.issues[0]?.code,
      FRAGILITY_CHECK_ISSUE_CODES.internalFailed
    )
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(successRoot, 'fragility-check.json'), 'utf-8')
      ),
      persisted
    )
    const reportJson = JSON.stringify(success.report)
    assert.doesNotMatch(
      reportJson,
      new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )
    assert.doesNotMatch(
      reportJson,
      new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )

    const gated = await runFragilityCheck({
      input: { bytes, displayName: 'fragility.sb3' },
      runRoot: join(temp, 'gated'),
      runId: 'fragility-gated',
      failOn: 'high',
      probeScriptPath: PROBE_PATH,
    })
    assert.equal(gated.report.overall.status, 'failed')
    assert.ok(gated.report.overall.gatedFindingCount >= 1)

    const unreadableRoot = join(temp, 'unreadable')
    const unreadable = await runFragilityCheck({
      input: {
        bytes: null,
        displayName: 'missing.sb3',
        readFailure: 'unavailable',
      },
      runRoot: unreadableRoot,
      runId: 'fragility-unreadable',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    assert.equal(unreadable.report.overall.status, 'failed')
    assert.equal(
      unreadable.report.issues[0]?.code,
      FRAGILITY_CHECK_ISSUE_CODES.inputReadFailed
    )
    assert.doesNotThrow(() =>
      JSON.parse(
        readFileSync(join(unreadableRoot, 'fragility-check.json'), 'utf-8')
      )
    )
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility Markdown keeps project-controlled text inert', async () =>
{
  const injected =
    '[x](https://e.t)<img src=x>`code`\n## forged\r\n| forged |\u0000'
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-md-'))
  try
  {
    const runRoot = join(temp, 'run')
    const result = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture(injected),
        displayName: 'markdown.sb3',
      },
      runRoot,
      runId: 'fragility-markdown',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    const markdown = readFileSync(join(runRoot, 'fragility-check.md'), 'utf-8')
    const projectedName = result.report.findings[0]?.targetName
    assert.ok(projectedName)
    assert.ok(markdown.includes(mdCode(projectedName)))
    for (const control of ['\r', '\n', '\u0000'])
      assert.equal(projectedName.includes(control), false)
    assert.match(projectedName, /\\n/)
    assert.doesNotMatch(markdown, /^## forged$/m)
    assert.doesNotMatch(markdown, /^\| forged \|$/m)
    assert.doesNotMatch(
      markdown,
      new RegExp(`\\| ${injected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`)
    )
    assert.equal(result.report.overall.status, 'passed')
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility provenance classifies meta.vm rather than project semver', async () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-vm-'))
  try
  {
    const converted = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture('converted', {
          semver: '3.0.0',
          vm: '0.1.0',
        }),
        displayName: 'converted.sb3',
      },
      runRoot: join(temp, 'converted'),
      runId: 'fragility-converted',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    assert.equal(
      converted.report.conversionProvenance.inference,
      'consistent-with-conversion'
    )

    const native = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture('native', {
          semver: '0.1.0',
          vm: '14.1.0',
        }),
        displayName: 'native.sb3',
      },
      runRoot: join(temp, 'native'),
      runId: 'fragility-native',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    assert.equal(
      native.report.conversionProvenance.inference,
      'consistent-with-native-authoring'
    )
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility report projects long scalars within the aggregate artifact quota', async () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-bound-'))
  try
  {
    const hostileName = `${'\\'.repeat(10_000)}\n## forged`
    const runRoot = join(temp, 'run')
    const result = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture(hostileName),
        displayName: hostileName,
      },
      runRoot,
      runId: hostileName,
      sourceRevision: hostileName,
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    const projected = [
      result.report.runId,
      result.report.sourceRevision,
      result.report.input.displayName,
      ...result.report.findings.flatMap((finding) => [
        finding.targetName,
        finding.topBlockId ?? '',
        finding.message,
        ...finding.evidence.flatMap((entry) => [
          entry.targetName,
          entry.blockId,
          entry.opcode,
          entry.role,
          entry.detail,
        ]),
        ...finding.counterEvidence,
      ]),
    ]
    for (const value of projected)
      assert.ok(
        Buffer.byteLength(value, 'utf-8') <= MAX_REPORT_TEXT_VALUE_BYTES
      )
    assert.ok(result.report.truncation.textValuesTruncated > 0)
    assert.ok(result.report.truncation.textBytesOmitted > 0)
    const totalBytes =
      readFileSync(join(runRoot, 'fragility-check.json')).byteLength +
      readFileSync(join(runRoot, 'fragility-check.md')).byteLength
    assert.ok(totalBytes <= MAX_FRAGILITY_REPORT_ARTIFACT_BYTES)
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility renderers keep direct hostile report scalars inert', async () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-render-'))
  try
  {
    const result = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture(),
        displayName: 'renderer.sb3',
      },
      runRoot: join(temp, 'seed'),
      runId: 'fragility-renderer',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    const hostile =
      'safe\r\n## forged\u0000\u000b\t\u0085\u2028\u2029| forged |'
    result.report.runId = hostile
    result.report.input.displayName = hostile
    result.report.findings[0]!.targetName = hostile
    result.report.findings[0]!.message = hostile
    result.report.findings[0]!.evidence[0]!.detail = hostile
    result.report.findings[0]!.counterEvidence = [hostile]

    const markdown = fragilityCheckReportMarkdown(result.report)
    assert.doesNotMatch(markdown, /^## forged$/m)
    assert.doesNotMatch(markdown, /^\| forged \|$/m)
    for (const control of [
      '\r',
      '\u0000',
      '\u000b',
      '\t',
      '\u0085',
      '\u2028',
      '\u2029',
    ])
      assert.equal(markdown.includes(control), false)
    assert.match(markdown, /\\r\\n/)
    assert.match(markdown, /\\u\{85\}/)
    const hostileRow = markdown
      .split('\n')
      .find((line) => line.includes('\\u{7c} forged'))
    assert.ok(hostileRow)
    assert.equal(hostileRow.split('|').length, 8)
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility maximum report envelope remains within its paired quota', async () =>
{
  const temp = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-fragility-envelope-')
  )
  try
  {
    const result = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture(),
        displayName: 'envelope.sb3',
      },
      runRoot: join(temp, 'seed'),
      runId: 'fragility-envelope',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    const scalar = '`'.repeat(MAX_REPORT_TEXT_VALUE_BYTES)
    const seed = result.report.findings[0]!
    const evidence = seed.evidence[0]!
    const finding = {
      ...seed,
      targetName: scalar,
      topBlockId: scalar,
      message: scalar,
      evidence: Array.from({ length: MAX_EVIDENCE_PER_FINDING }, () => ({
        ...evidence,
        targetName: scalar,
        blockId: scalar,
        opcode: scalar,
        role: scalar,
        detail: scalar,
      })),
      counterEvidence: Array.from(
        { length: MAX_COUNTER_EVIDENCE_PER_FINDING },
        () => scalar
      ),
    }
    const report: FragilityCheckReport = {
      ...result.report,
      findings: Array.from({ length: MAX_REPORT_FINDINGS }, () =>
        structuredClone(finding)
      ),
      advisories: Array.from({ length: MAX_REPORT_ADVISORIES }, () =>
        structuredClone(finding)
      ),
    }
    const json = fragilityCheckReportJson(report)
    const markdown = fragilityCheckReportMarkdown(report)
    const totalBytes =
      Buffer.byteLength(json, 'utf-8') + Buffer.byteLength(markdown, 'utf-8')
    assert.ok(totalBytes <= MAX_FRAGILITY_REPORT_ARTIFACT_BYTES)

    const store = new ProjectArtifactStore(join(temp, 'envelope'), {
      maxBytes: MAX_FRAGILITY_REPORT_ARTIFACT_BYTES,
    })
    assert.doesNotThrow(() => writeFragilityCheckCheckpoint(store, report))
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility checkpoint rejects nonterminal or inconsistent PASS reports', async () =>
{
  const temp = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-fragility-terminal-')
  )
  try
  {
    const result = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture(),
        displayName: 'terminal.sb3',
      },
      runRoot: join(temp, 'seed'),
      runId: 'fragility-terminal',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    const nonterminal: FragilityCheckReport = {
      ...result.report,
      completedAt: null,
    }
    const nonterminalRoot = join(temp, 'nonterminal')
    const nonterminalStore = new ProjectArtifactStore(nonterminalRoot)
    assert.throws(() =>
      writeFragilityCheckCheckpoint(nonterminalStore, nonterminal)
    )
    assert.equal(
      existsSync(join(nonterminalRoot, 'fragility-check.json')),
      false
    )
    assert.equal(existsSync(join(nonterminalRoot, 'fragility-check.md')), false)

    const inconsistent: FragilityCheckReport = {
      ...result.report,
      issues: [
        {
          code: FRAGILITY_CHECK_ISSUE_CODES.internalFailed,
          message: 'inconsistent PASS',
        },
      ],
    }
    const inconsistentRoot = join(temp, 'inconsistent')
    const inconsistentStore = new ProjectArtifactStore(inconsistentRoot)
    assert.throws(() =>
      writeFragilityCheckCheckpoint(inconsistentStore, inconsistent)
    )
    assert.equal(
      existsSync(join(inconsistentRoot, 'fragility-check.json')),
      false
    )
    assert.equal(
      existsSync(join(inconsistentRoot, 'fragility-check.md')),
      false
    )
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility checkpoint failure cannot expose a new authoritative PASS', async () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-commit-'))
  try
  {
    const result = await runFragilityCheck({
      input: {
        bytes: await fragilityFixture(),
        displayName: 'commit.sb3',
      },
      runRoot: join(temp, 'seed'),
      runId: 'fragility-commit',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })
    const store = new FailJsonInstallOnceStore(join(temp, 'failed-install'))
    assert.throws(() => writeFragilityCheckCheckpoint(store, result.report))
    assert.equal(existsSync(join(store.root, 'fragility-check.json')), false)
    assert.equal(existsSync(join(store.root, 'fragility-check.md')), false)

    const failed: FragilityCheckReport = {
      ...result.report,
      issues: [
        {
          code: FRAGILITY_CHECK_ISSUE_CODES.internalFailed,
          stage: 'report',
          message: 'fragility report checkpoint could not be written',
        },
      ],
      overall: {
        ...result.report.overall,
        status: 'failed',
      },
    }
    assert.doesNotThrow(() => writeFragilityCheckCheckpoint(store, failed))
    const json = JSON.parse(
      readFileSync(join(store.root, 'fragility-check.json'), 'utf-8')
    ) as FragilityCheckReport
    const markdown = readFileSync(
      join(store.root, 'fragility-check.md'),
      'utf-8'
    )
    assert.deepEqual(json, failed)
    assert.match(markdown, /\*\*FAIL\*\*/)
    assert.doesNotMatch(markdown, /\*\*PASS\*\*/)
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})
