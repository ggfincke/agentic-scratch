// tests/eval/candidate/candidate.test.ts
// candidate gate classification, exact-byte execution, & preflight isolation

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { ProjectIR, buildClicker } from '@scratch-agent/ir'
import type { Block, BlockEntry } from '@scratch-agent/sb3'

import {
  evaluateBaseline,
  evaluateCandidate,
  type TestExecutor,
} from '@scratch-agent/eval'
import {
  DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
  type RepairTestSpec,
} from '@scratch-agent/eval'
import { runTest } from '@scratch-agent/eval'
import {
  inspectBaselineArtifact,
  preflightCandidateArtifact,
} from '../../../packages/eval/src/artifacts/artifact-preflight.js'

function block(entry: BlockEntry | undefined): Block | null
{
  return entry && !Array.isArray(entry) ? entry : null
}

function clone(project: ProjectIR): ProjectIR
{
  return ProjectIR.fromProjectJson(
    structuredClone(project.toProjectJson()),
    project.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    }))
  )
}

function brokenClicker(): ProjectIR
{
  const project = clone(buildClicker())
  const sprite = project.json.targets.find(
    (target) => target.name === 'Sprite1'
  )
  assert.ok(sprite)
  const change = Object.values(sprite.blocks)
    .map(block)
    .find((entry) => entry?.opcode === 'data_changevariableby')
  assert.ok(change?.inputs?.VALUE)
  change.inputs.VALUE[1] = [4, '0']
  return project
}

function graphInvalidClicker(): ProjectIR
{
  const project = clone(buildClicker())
  const sprite = project.json.targets.find(
    (target) => target.name === 'Sprite1'
  )
  assert.ok(sprite)
  sprite.isStage = true
  return project
}

function clickerSpecs(): RepairTestSpec[]
{
  const probe = { on: 'var' as const, name: 'score', sprite: 'Sprite1' }
  const matcher = { kind: 'equals' as const, value: 1 }
  return [
    {
      id: 'increment',
      name: 'click increments score',
      role: 'repair-target',
      baseline: {
        outcome: 'fail',
        failures: [
          {
            kind: 'assertion',
            snapshot: 'after-click',
            probe,
            matcher,
          },
        ],
        allowAdditionalProjectFailures: false,
      },
      scenario: {
        steps: [
          { do: 'greenFlag' },
          { do: 'wait', ticks: 1 },
          { do: 'clickSprite', sprite: 'Sprite1' },
          { do: 'wait', ticks: 1 },
          { do: 'snapshot', label: 'after-click' },
        ],
      },
      asserts: [{ at: 'after-click', probe, match: matcher }],
    },
    {
      id: 'reset',
      name: 'flag resets score',
      role: 'regression',
      baseline: { outcome: 'pass' },
      scenario: {
        steps: [
          { do: 'greenFlag' },
          { do: 'wait', ticks: 1 },
          { do: 'snapshot', label: 'after-flag' },
        ],
      },
      asserts: [
        {
          at: 'after-flag',
          probe,
          match: { kind: 'equals', value: 0 },
        },
      ],
    },
  ]
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function diagnosticProject(unusedVariables: number): ProjectIR
{
  const project = buildClicker()
  const stage = project.stage
  assert.ok(stage)
  for (let index = 0; index < unusedVariables; index++)
    stage.addVariable(`unused-${index}`, 0)
  return project
}

test('candidate gate classifies repair, infrastructure, preflight, & diagnostic cardinality', async () =>
{
  const specs = clickerSpecs()
  const healthyBytes = await buildClicker().toSb3()
  const healthyHash = sha256(healthyBytes)
  let healthyExecutions = 0
  const healthy = await evaluateBaseline(
    healthyBytes,
    specs,
    {},
    async (testCase, options) =>
    {
      healthyExecutions++
      assert.equal(options?.artifactBytes, healthyBytes)
      return runTest(testCase, options)
    }
  )
  assert.equal(healthy.status, 'already-passing')
  assert.equal(healthy.ok, true)
  assert.equal(healthyExecutions, 2)
  assert.equal(sha256(healthyBytes), healthyHash)

  const brokenBytes = await brokenClicker().toSb3()
  const brokenHash = sha256(brokenBytes)
  let brokenExecutions = 0
  const baseline = await evaluateBaseline(
    brokenBytes,
    specs,
    {},
    async (testCase, options) =>
    {
      brokenExecutions++
      assert.equal(options?.artifactBytes, brokenBytes)
      return runTest(testCase, options)
    }
  )
  assert.equal(baseline.status, 'awaiting-proposal')
  assert.equal(baseline.ok, true)
  assert.equal(brokenExecutions, 2)
  assert.deepEqual(baseline.failingTestIds, ['increment'])
  assert.deepEqual(
    baseline.tests.map((entry) => [entry.id, entry.ok]),
    [
      ['increment', false],
      ['reset', true],
    ]
  )
  assert.equal(baseline.failures.length, 1)
  assert.equal(baseline.failures[0]?.kind, 'assertion')
  assert.equal(baseline.mismatches.length, 0)
  assert.equal(sha256(brokenBytes), brokenHash)
  assert.ok(baseline.preflight.diagnosticBaseline)

  const acceptedOrder: string[] = []
  const accepted = await evaluateCandidate(
    healthyBytes,
    baseline.preflight.diagnosticBaseline,
    {
      tests: specs,
      diagnostics: DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
      run: { recordVideo: false },
    },
    async (testCase, options) =>
    {
      acceptedOrder.push(testCase.name.split('--', 1)[0]!)
      assert.equal(options?.artifactBytes, healthyBytes)
      return runTest(testCase, options)
    }
  )
  assert.equal(accepted.status, 'passed')
  assert.deepEqual(acceptedOrder, ['increment', 'reset'])
  assert.deepEqual(
    accepted.targeted?.tests.map((entry) => entry.id),
    ['increment']
  )
  assert.deepEqual(
    accepted.regression?.tests.map((entry) => entry.id),
    ['increment', 'reset']
  )
  assert.deepEqual(accepted.regression?.tests[0], accepted.targeted?.tests[0])

  let infrastructureExecutions = 0
  const infrastructureExecutor: TestExecutor = async () =>
  {
    infrastructureExecutions++
    throw new Error('injected infrastructure failure')
  }
  const infrastructure = await evaluateBaseline(
    brokenBytes,
    specs,
    {},
    infrastructureExecutor
  )
  assert.equal(infrastructure.status, 'stopped-infrastructure')
  assert.equal(infrastructureExecutions, 1)
  assert.deepEqual(infrastructure.failingTestIds, [])
  assert.deepEqual(infrastructure.failures, [])
  assert.deepEqual(infrastructure.tests[0]?.failures, [])
  assert.deepEqual(infrastructure.tests[0]?.evidenceFailures, [])
  assert.equal(infrastructure.issues[0]?.code, 'eval.test.executor-threw')

  const invalidBytes = await graphInvalidClicker().toSb3()
  let invalidExecutions = 0
  const invalid = await evaluateCandidate(
    invalidBytes,
    baseline.preflight.diagnosticBaseline,
    {
      tests: specs,
      diagnostics: DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
    },
    async () =>
    {
      invalidExecutions++
      throw new Error('preflight must skip runtime execution')
    }
  )
  assert.equal(invalid.status, 'preflight-failed')
  assert.equal(invalidExecutions, 0)
  assert.equal(invalid.targeted, null)
  assert.equal(invalid.regression, null)
  assert.ok(invalid.preflight.failures.length > 0)
  assert.ok(
    invalid.preflight.schema.length > 0 ||
      invalid.preflight.graph.some((failure) => failure.severity === 'error')
  )

  let invalidPolicyExecutions = 0
  const invalidPolicy = await evaluateCandidate(
    healthyBytes,
    baseline.preflight.diagnosticBaseline,
    {
      tests: specs,
      diagnostics: {
        ...DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
        rejectNewStaticAtOrAbove: 'bogus' as never,
      },
    },
    async () =>
    {
      invalidPolicyExecutions++
      throw new Error('invalid policy must skip candidate inspection')
    }
  )
  assert.equal(invalidPolicy.status, 'case-invalid')
  assert.equal(invalidPolicyExecutions, 0)
  assert.equal(invalidPolicy.preflight.project, null)
  assert.equal(
    invalidPolicy.issues[0]?.code,
    'eval.case.invalid-diagnostic-threshold'
  )

  const oneDiagnosticBytes = await diagnosticProject(1).toSb3()
  const oneDiagnostic = await inspectBaselineArtifact(oneDiagnosticBytes)
  assert.equal(oneDiagnostic.ok, true)
  assert.ok(oneDiagnostic.diagnosticBaseline)
  assert.equal(
    oneDiagnostic.static.filter((failure) => failure.code === 'unused-variable')
      .length,
    1
  )
  const unchanged = await preflightCandidateArtifact(
    oneDiagnosticBytes,
    oneDiagnostic.diagnosticBaseline,
    DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS
  )
  assert.equal(unchanged.ok, true)
  assert.equal(unchanged.diagnosticChanges.newStatic.length, 0)

  const twoDiagnosticBytes = await diagnosticProject(2).toSb3()
  const duplicate = await preflightCandidateArtifact(
    twoDiagnosticBytes,
    oneDiagnostic.diagnosticBaseline,
    DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS
  )
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.diagnosticChanges.newStatic.length, 1)
  assert.equal(duplicate.diagnosticChanges.rejectedStatic.length, 1)
  assert.equal(
    duplicate.diagnosticChanges.rejectedStatic[0]?.code,
    'unused-variable'
  )

  const belowThreshold = await preflightCandidateArtifact(
    twoDiagnosticBytes,
    oneDiagnostic.diagnosticBaseline,
    {
      ...DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
      rejectNewStaticAtOrAbove: 'warning',
    }
  )
  assert.equal(belowThreshold.ok, true)
  assert.equal(belowThreshold.diagnosticChanges.allowedStatic.length, 1)
  const allowlisted = await preflightCandidateArtifact(
    twoDiagnosticBytes,
    oneDiagnostic.diagnosticBaseline,
    {
      ...DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
      allowedNewStaticCodes: ['unused-variable'],
    }
  )
  assert.equal(allowlisted.ok, true)
  assert.equal(allowlisted.diagnosticChanges.allowedStatic.length, 1)

  const diagnosticTarget = clone(brokenClicker())
  diagnosticTarget.stage!.addVariable('declared-oracle', 0)
  const diagnosticSpecs = clickerSpecs()
  assert.equal(diagnosticSpecs[0]!.baseline.outcome, 'fail')
  if (diagnosticSpecs[0]!.baseline.outcome === 'fail')
  {
    diagnosticSpecs[0]!.baseline.failures.push({
      kind: 'diagnostic',
      source: 'static',
      code: 'unused-variable',
    })
  }
  const diagnosticTargetBytes = await diagnosticTarget.toSb3()
  const diagnosticBaseline = await evaluateBaseline(
    diagnosticTargetBytes,
    diagnosticSpecs
  )
  assert.equal(diagnosticBaseline.status, 'awaiting-proposal')
  assert.ok(diagnosticBaseline.preflight.diagnosticBaseline)
  assert.deepEqual(
    diagnosticBaseline.failures.map((failure) => failure.kind).sort(),
    ['assertion', 'diagnostic']
  )

  const behaviorOnly = clone(diagnosticTarget)
  const behaviorSprite = behaviorOnly.json.targets.find(
    (target) => target.name === 'Sprite1'
  )!
  const behaviorChange = Object.values(behaviorSprite.blocks)
    .map(block)
    .find((entry) => entry?.opcode === 'data_changevariableby')!
  behaviorChange.inputs!.VALUE![1] = [4, '1']
  const behaviorOnlyResult = await evaluateCandidate(
    await behaviorOnly.toSb3(),
    diagnosticBaseline.preflight.diagnosticBaseline,
    {
      tests: diagnosticSpecs,
      diagnostics: DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
    }
  )
  assert.equal(behaviorOnlyResult.status, 'targeted-failed')
  assert.equal(behaviorOnlyResult.failures[0]?.kind, 'diagnostic')
})
