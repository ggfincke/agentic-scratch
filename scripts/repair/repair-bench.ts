// scripts/repair/repair-bench.ts
// run the deterministic R1-R5 repair gate & retain aggregate evidence

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  assertRepairBenchmarkCorpus,
  canonicalRepairBenchmarks,
  REPAIR_BENCHMARK_IDS,
  repairCaseHash,
  repairProject,
  ScriptedRepairAgent,
  type RepairBenchmarkDefinition,
  type RepairReport,
} from '@scratch-agent/repair'
import {
  collectVersions,
  newRunId,
  sha256,
  type RunVersions,
} from '@scratch-agent/runner'

import { portableRelativePath } from '../lib/path.js'

interface BenchmarkCaseResult
{
  id: string
  repairCaseId: string
  ok: boolean
  errors: string[]
  sessionId: string
  runPath: string
  reportPath: string
  acceptedPath: string | null
  status: string | null
  attempts: number
  operationKinds: string[]
  evidenceLevel: number | null
  browserEnabled: boolean | null
  localizationTopThree: boolean | null
  gateOrder: string[]
  input: { sha256: string; byteLength: number } | null
  accepted: { sha256: string; byteLength: number } | null
  hashes: {
    repairCase: string | null
    report: string | null
  }
  preservation: {
    assets: boolean | null
    existingEditorLayout: boolean | null
    acceptedCopyVerified: boolean | null
  }
  sourceRevision: string | null
}

interface RepairBenchmarkReport
{
  schemaVersion: 1
  runId: string
  createdAt: string
  completedAt: string
  durationMs: number
  ok: boolean
  versions: RunVersions
  totals: { cases: number; passed: number; failed: number }
  cases: BenchmarkCaseResult[]
}

const root = resolve(import.meta.dirname, '../..')

function portable(rootPath: string, path: string): string
{
  return portableRelativePath(rootPath, path)
}

function check(condition: boolean, message: string, errors: string[]): void
{
  if (!condition) errors.push(message)
}

function sameScript(
  actual: NonNullable<
    RepairReport['baseline']['localization']
  >['candidates'][number],
  definition: RepairBenchmarkDefinition
): boolean
{
  const expected = definition.expectedLocalization
  const script = actual.script
  return (
    script.target.targetIndex === expected.script.target.targetIndex &&
    script.target.name === expected.script.target.name &&
    script.target.isStage === expected.script.target.isStage &&
    script.topBlockId === expected.script.topBlockId
  )
}

function localizationMatches(
  report: RepairReport,
  definition: RepairBenchmarkDefinition
): boolean
{
  return (
    report.baseline.localization?.candidates.slice(0, 3).some((candidate) =>
    {
      if (!sameScript(candidate, definition)) return false
      if (definition.id !== 'R1' && definition.id !== 'R3') return true
      return (
        candidate.implicatedBlock?.blockId ===
        definition.expectedLocalization.block?.blockId
      )
    }) ?? false
  )
}

function objectStatus(value: unknown): string | null
{
  if (value === null || typeof value !== 'object') return null
  const status = (value as { status?: unknown }).status
  return typeof status === 'string' ? status : null
}

function baselineStatus(report: RepairReport): string | null
{
  const evaluation = report.baseline.evaluation as { status?: unknown }
  return typeof evaluation.status === 'string' ? evaluation.status : null
}

function inspectCase(
  aggregateRoot: string,
  definition: RepairBenchmarkDefinition,
  sessionId: string,
  reportPath: string,
  expectedInput: Uint8Array
): BenchmarkCaseResult
{
  const rawReport = readFileSync(reportPath)
  const report = JSON.parse(rawReport.toString('utf8')) as RepairReport
  const errors: string[] = []
  const attempt = report.attempts[0]
  const operationKinds =
    attempt?.record.proposal?.operations.map((operation) => operation.kind) ??
    []
  const delta = report.accepted?.delta?.summary ?? null
  const policy = definition.repairCase.policy
  const expectedLevel = definition.id === 'R5' ? 3 : 1
  const caseRoot = dirname(reportPath)
  const inputRelative = report.artifacts.input
  const inputPath = join(caseRoot, 'input.sb3')
  const inputBytes = readFileSync(inputPath)
  const acceptedRelative = report.artifacts.acceptedCandidate
  const acceptedPath = acceptedRelative
    ? join(caseRoot, acceptedRelative)
    : null
  const acceptedBytes = acceptedPath ? readFileSync(acceptedPath) : null
  const accepted = report.accepted?.artifact ?? null

  check(report.status === 'repaired', 'terminal status is not repaired', errors)
  check(
    baselineStatus(report) === 'awaiting-proposal',
    'baseline contract did not request repair',
    errors
  )
  check(
    report.attempts.length === 1,
    'repair did not use exactly one attempt',
    errors
  )
  check(
    attempt?.record.status === 'repaired',
    'accepted attempt is not repaired',
    errors
  )
  check(
    objectStatus(attempt?.record.evaluation) === 'passed',
    'accepted evaluation did not pass',
    errors
  )
  check(
    operationKinds.length === 1,
    'repair did not use exactly one operation',
    errors
  )
  check(
    operationKinds.every((kind) =>
      policy.intentBudget.allowedOpKinds.includes(
        kind as (typeof policy.intentBudget.allowedOpKinds)[number]
      )
    ),
    'repair used a disallowed operation kind',
    errors
  )
  check(
    JSON.stringify(attempt?.gateOrder ?? []) ===
      JSON.stringify(['preflight', 'targeted', 'regression']),
    'accepted gate order is not preflight -> targeted -> regression',
    errors
  )
  check(
    localizationMatches(report, definition),
    'expected localization is not in the top three',
    errors
  )
  check(
    attempt?.record.request.evidence.level === expectedLevel,
    'evidence level does not match the case',
    errors
  )
  check(
    report.execution.browser.enabled === (definition.id === 'R5'),
    'browser escalation does not match the case',
    errors
  )
  check(
    report.accepted?.proof.acceptedCopyVerified === true,
    'accepted copy was not verified',
    errors
  )
  check(
    report.accepted?.proof.assetsPreserved === true,
    'assets were not preserved',
    errors
  )
  check(
    report.accepted?.proof.existingEditorLayoutPreserved === true,
    'existing editor layout was not preserved',
    errors
  )
  check(
    delta?.touchedTargets === 1,
    'repair did not touch exactly one target',
    errors
  )
  check(
    delta?.touchedScripts === 1,
    'repair did not touch exactly one script',
    errors
  )
  check(
    (delta?.changedAuthoredBlocks ?? Number.POSITIVE_INFINITY) <=
      policy.impactBudget.maxChangedAuthoredBlocks,
    'changed authored blocks exceeded the case budget',
    errors
  )
  check(
    (delta?.changedBlockRecords ?? Number.POSITIVE_INFINITY) <=
      policy.impactBudget.maxChangedBlockRecords,
    'changed block records exceeded the case budget',
    errors
  )
  check(
    report.repairCase.id === definition.repairCase.id,
    'repair case ID drifted',
    errors
  )
  check(
    report.repairCase.hash === repairCaseHash(definition.repairCase),
    'repair case hash drifted',
    errors
  )
  check(
    report.hashes.repairCase === report.repairCase.hash,
    'report case hashes disagree',
    errors
  )
  check(
    inputRelative === 'input.sb3' &&
      report.input.artifact.path === inputRelative,
    'input artifact paths disagree',
    errors
  )
  check(
    sha256(inputBytes) === sha256(expectedInput),
    'retained input artifact differs from the canonical input',
    errors
  )
  check(
    sha256(inputBytes) === report.input.artifact.sha256,
    'input artifact hash drifted',
    errors
  )
  check(
    inputBytes.byteLength === expectedInput.byteLength &&
      inputBytes.byteLength === report.input.artifact.byteLength,
    'input artifact size drifted',
    errors
  )
  check(
    attempt?.record.request.baseline.artifactSha256 ===
      report.input.artifact.sha256,
    'request baseline hash drifted',
    errors
  )
  check(
    attempt?.record.agent.descriptor?.adapter === 'scripted',
    'deterministic adapter identity is missing',
    errors
  )
  check(
    report.gates.every(
      (gate) => gate.status !== 'failed' && gate.status !== 'stopped'
    ),
    'report contains a failed or stopped gate',
    errors
  )
  check(
    accepted !== null && acceptedBytes !== null,
    'accepted artifact is missing',
    errors
  )
  if (accepted && acceptedBytes)
  {
    check(
      sha256(acceptedBytes) === accepted.sha256,
      'accepted artifact hash does not match',
      errors
    )
    check(
      acceptedBytes.byteLength === accepted.byteLength,
      'accepted artifact size does not match',
      errors
    )
  }

  return {
    id: definition.id,
    repairCaseId: definition.repairCase.id,
    ok: errors.length === 0,
    errors,
    sessionId,
    runPath: portable(aggregateRoot, caseRoot),
    reportPath: portable(aggregateRoot, reportPath),
    acceptedPath: acceptedPath ? portable(aggregateRoot, acceptedPath) : null,
    status: report.status,
    attempts: report.attempts.length,
    operationKinds,
    evidenceLevel: attempt?.record.request.evidence.level ?? null,
    browserEnabled: report.execution.browser.enabled,
    localizationTopThree: localizationMatches(report, definition),
    gateOrder: attempt?.gateOrder ?? [],
    input: {
      sha256: report.input.artifact.sha256,
      byteLength: report.input.artifact.byteLength,
    },
    accepted: accepted
      ? { sha256: accepted.sha256, byteLength: accepted.byteLength }
      : null,
    hashes: {
      repairCase: report.repairCase.hash,
      report: sha256(rawReport),
    },
    preservation: {
      assets: report.accepted?.proof.assetsPreserved ?? null,
      existingEditorLayout:
        report.accepted?.proof.existingEditorLayoutPreserved ?? null,
      acceptedCopyVerified: report.accepted?.proof.acceptedCopyVerified ?? null,
    },
    sourceRevision: report.sourceRevision,
  }
}

function failedCase(
  aggregateRoot: string,
  definition: RepairBenchmarkDefinition,
  sessionId: string,
  error: unknown
): BenchmarkCaseResult
{
  const message = error instanceof Error ? error.message : 'unknown failure'
  return {
    id: definition.id,
    repairCaseId: definition.repairCase.id,
    ok: false,
    errors: [
      message
        .replaceAll(aggregateRoot, '<run-root>')
        .replaceAll(root, '<repo-root>'),
    ],
    sessionId,
    runPath: `cases/repair-${sessionId}`,
    reportPath: `cases/repair-${sessionId}/report.json`,
    acceptedPath: null,
    status: null,
    attempts: 0,
    operationKinds: [],
    evidenceLevel: null,
    browserEnabled: null,
    localizationTopThree: null,
    gateOrder: [],
    input: null,
    accepted: null,
    hashes: { repairCase: null, report: null },
    preservation: {
      assets: null,
      existingEditorLayout: null,
      acceptedCopyVerified: null,
    },
    sourceRevision: null,
  }
}

function reportMarkdown(report: RepairBenchmarkReport): string
{
  const lines = [
    '# Phase 6 deterministic repair benchmark',
    '',
    `**run:** \`${report.runId}\``,
    `**result:** ${report.ok ? 'PASS' : 'FAIL'}`,
    `**cases:** ${report.totals.passed}/${report.totals.cases} passed`,
    '',
    '| Case | Result | Attempts | Operation | Evidence | Browser | Accepted SHA-256 |',
    '| --- | --- | ---: | --- | ---: | --- | --- |',
    ...report.cases.map(
      (entry) =>
        `| ${[
          entry.id,
          entry.ok ? 'PASS' : 'FAIL',
          String(entry.attempts),
          entry.operationKinds.join(', ') || '-',
          entry.evidenceLevel === null ? '-' : String(entry.evidenceLevel),
          entry.browserEnabled === null
            ? '-'
            : entry.browserEnabled
              ? 'yes'
              : 'no',
          entry.accepted?.sha256 ?? '-',
        ].join(' | ')} |`
    ),
  ]
  const failures = report.cases.flatMap((entry) =>
    entry.errors.map(
      (error) => `- ${entry.id}: ${error.replaceAll('|', '\\|')}`
    )
  )
  if (failures.length > 0)
  {
    lines.push('', '## Failures', '', ...failures)
  }
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void>
{
  const started = performance.now()
  const createdAt = new Date().toISOString()
  const definitions = canonicalRepairBenchmarks()
  const actualCaseIds = definitions.map((definition) => definition.id)
  assertRepairBenchmarkCorpus(actualCaseIds, REPAIR_BENCHMARK_IDS)
  const runId = `repair-bench-${newRunId()}`
  const runRoot = join(root, 'runs', runId)
  const casesRoot = join(runRoot, 'cases')
  mkdirSync(casesRoot, { recursive: true, mode: 0o700 })

  const cases: BenchmarkCaseResult[] = []
  for (const definition of definitions)
  {
    const sessionId = definition.id.toLowerCase()
    const input = await definition.broken.toSb3()
    try
    {
      const agent = new ScriptedRepairAgent([
        (request) => definition.referenceProposal(request),
      ])
      await repairProject(
        {
          artifactBytes: input,
          repairCase: definition.repairCase,
          artifactRoot: casesRoot,
          sessionId,
          recordVideo: false,
        },
        agent
      )
      cases.push(
        inspectCase(
          runRoot,
          definition,
          sessionId,
          join(casesRoot, `repair-${sessionId}`, 'report.json'),
          input
        )
      )
    }
    catch (error)
    {
      cases.push(failedCase(runRoot, definition, sessionId, error))
    }
    const result = cases.at(-1)!
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${definition.id}`)
    for (const error of result.errors) console.log(`      ${error}`)
  }

  const passed = cases.filter((entry) => entry.ok).length
  const report: RepairBenchmarkReport = {
    schemaVersion: 1,
    runId,
    createdAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, performance.now() - started),
    ok: passed === cases.length,
    versions: collectVersions(),
    totals: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
    },
    cases,
  }
  writeFileSync(
    join(runRoot, 'repair-bench.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 }
  )
  writeFileSync(join(runRoot, 'repair-bench.md'), reportMarkdown(report), {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(
    `\n${passed}/${cases.length} passed -> ${join(runRoot, 'repair-bench.md')}`
  )
  if (!report.ok) process.exitCode = 1
}

main().catch((error: unknown) =>
{
  console.error(
    error instanceof Error ? error.message : 'repair benchmark failed'
  )
  process.exitCode = 1
})
