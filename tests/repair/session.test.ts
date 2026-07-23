// tests/repair/session.test.ts
// major controller promotion & canonical scripted-repair flows

import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ProjectIR } from '@scratch-agent/ir'

import { RepairArtifactStore } from '../../packages/repair/src/policy/artifacts.js'
import { buildRepairBenchmark, canonicalRepairBenchmarks } from '../../packages/repair/src/benchmark/benchmark.js'
import { type RepairAgent, type RepairProposal, type RepairRequest } from '../../packages/repair/src/policy/contracts.js'
import { repairProject } from '../../packages/repair/src/session/controller.js'
import { validateRepairPolicy } from '../../packages/repair/src/policy/policy.js'
import { repairCaseHash, type RepairCase } from '../../packages/repair/src/benchmark/repair-case.js'
import { type RepairReport } from '../../packages/repair/src/policy/report.js'
import { ScriptedRepairAgent } from '../../packages/repair/src/session/scripted-agent.js'
import { startRepair } from '../../packages/repair/src/session/session.js'

function tempRoot(t: test.TestContext, label: string): string
{
  const root = mkdtempSync(join(tmpdir(), `${label}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function reportAt(root: string, sessionId: string): RepairReport
{
  return JSON.parse(
    readFileSync(join(root, `repair-${sessionId}`, 'report.json'), 'utf8')
  ) as RepairReport
}

function replaceLiteralValue(proposal: RepairProposal, value: number): void
{
  const operation = proposal.operations[0]
  assert.equal(operation?.kind, 'replaceLiteral')
  if (operation?.kind !== 'replaceLiteral') return
  assert.equal(operation.from.kind, 'number')
  assert.equal(operation.from.value, 0)
  operation.to.value = value
}

function expectedFailureCount(request: RepairRequest): number
{
  return request.acceptance.tests.reduce((count, test) =>
  {
    const registered = request.failures.filter((failure) =>
      'testId' in failure ? failure.testId === test.id : true
    )
    return count + registered.length
  }, 0)
}

test('controller retains failed candidates and promotes only a full-suite pass', async (t) =>
{
  const root = tempRoot(t, 'repair-promotion')
  const benchmark = buildRepairBenchmark('R1')
  const baselineBytes = await benchmark.broken.toSb3()
  let firstProposal: RepairProposal | null = null
  const agent = new ScriptedRepairAgent([
    (request) =>
    {
      assert.ok(Object.isFrozen(request))
      assert.ok(Object.isFrozen(request.policy))
      assert.ok(Object.isFrozen(request.evidence.level0.failures))
      benchmark.repairCase.tests = benchmark.repairCase.tests.filter(
        (test) => test.id !== 'state-win'
      )
      const proposal = benchmark.referenceProposal(request)
      replaceLiteralValue(proposal, 2)
      firstProposal = proposal
      return proposal
    },
    (request) =>
    {
      assert.equal(request.evidence.level, 2)
      assert.ok((request.evidence.level2?.snapshotDeltas.length ?? 0) > 0)
      assert.equal(
        request.priorAttempts[0]?.evaluationStatus,
        'targeted-failed'
      )
      assert.equal(request.priorAttempts[0]?.status, 'candidate-rejected')
      assert.ok(firstProposal)
      replaceLiteralValue(firstProposal, 999)
      return benchmark.referenceProposal(request)
    },
  ])

  const result = await repairProject(
    {
      artifactBytes: baselineBytes,
      repairCase: benchmark.repairCase,
      artifactRoot: root,
      sessionId: 'promotion-safety',
      recordVideo: false,
    },
    agent
  )

  assert.equal(result.status, 'repaired')
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ['candidate-rejected', 'repaired']
  )
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.evaluationStatus),
    ['targeted-failed', 'passed']
  )
  assert.deepEqual(await benchmark.broken.toSb3(), baselineBytes)
  const report = reportAt(root, 'promotion-safety')
  assert.equal(report.status, 'repaired')
  assert.equal(
    report.attempts[0]?.record.proposal?.operations[0]?.kind,
    'replaceLiteral'
  )
  const retainedFirst = report.attempts[0]!.record.proposal!.operations[0]!
  assert.equal(retainedFirst.kind, 'replaceLiteral')
  if (retainedFirst.kind === 'replaceLiteral')
    assert.equal(retainedFirst.to.value, 2)
  assert.deepEqual(report.attempts[0]?.gateOrder, ['preflight', 'targeted'])
  assert.deepEqual(report.attempts[1]?.gateOrder, [
    'preflight',
    'targeted',
    'regression',
  ])
  assert.deepEqual(
    report.attempts.map((attempt) => attempt.record.number),
    [1, 2]
  )
  assert.ok(report.completedAt)
  assert.ok(report.completedAt >= report.attempts[1]!.record.completedAt)
  assert.ok('status' in report)
  assert.ok('attempts' in report)
  assert.ok('accepted' in report)
  assert.ok('artifacts' in report)
  assert.ok('hashes' in report)
  assert.deepEqual(report.attempts[0]?.artifacts, {
    request: 'attempts/001/request.json',
    proposal: 'attempts/001/proposal.json',
    candidate: 'attempts/001/candidate.sb3',
    delta: 'attempts/001/delta.json',
    evaluation: 'attempts/001/evaluation.json',
    preservation: 'attempts/001/preservation.json',
    screenshots: 'attempts/001/screenshots',
  })
  assert.deepEqual(report.attempts[1]?.artifacts, {
    request: 'attempts/002/request.json',
    proposal: 'attempts/002/proposal.json',
    candidate: 'attempts/002/candidate.sb3',
    delta: 'attempts/002/delta.json',
    evaluation: 'attempts/002/evaluation.json',
    preservation: 'attempts/002/preservation.json',
    screenshots: 'attempts/002/screenshots',
  })
  assert.equal(report.budget.attemptsCompleted, 2)
  assert.equal(report.budget.attemptsRemaining, 2)
  assert.equal(report.attempts[0]?.record.delta?.summary.touchedTargets, 1)
  assert.equal(report.attempts[1]?.record.delta?.summary.touchedScripts, 1)
  assert.notEqual(
    report.attempts[0]?.record.candidate?.sha256,
    report.accepted?.artifact.sha256
  )
  assert.equal(
    report.attempts[1]?.record.candidate?.sha256,
    report.accepted?.artifact.sha256
  )
  assert.equal(report.accepted?.proof.acceptedCopyVerified, true)
  assert.equal(
    report.accepted?.proof.acceptedCopySha256,
    report.accepted?.artifact.sha256
  )
  assert.equal(report.accepted?.proof.assetsPreserved, true)
  assert.equal(report.accepted?.proof.existingEditorLayoutPreserved, true)
  assert.deepEqual(report.accepted?.exports, [])
  assert.deepEqual(report.artifacts, {
    input: 'input.sb3',
    baselineEvaluation: 'baseline/evaluation.json',
    acceptedCandidate: 'accepted/candidate.sb3',
    semanticPatch: 'diffs/semantic-patch.json',
    projectDelta: 'diffs/project-delta.json',
    reportJson: 'report.json',
    reportMarkdown: 'report.md',
  })
  assert.notEqual(report.hashes.operationSchema, report.hashes.proposalSchema)
  assert.ok(report.sourceRevision)
  assert.ok(report.execution.tests.every((entry) => entry.seed === 0))
  assert.ok(
    report.execution.tests.every(
      (entry) => typeof entry.maxTicks === 'number' && entry.maxTicks > 0
    )
  )
  const runRoot = join(root, 'repair-promotion-safety')
  assert.ok(existsSync(join(runRoot, 'attempts/001/candidate.sb3')))
  assert.ok(existsSync(join(runRoot, 'attempts/002/candidate.sb3')))
  assert.ok(existsSync(join(runRoot, 'accepted/candidate.sb3')))
  assert.ok(existsSync(join(runRoot, 'diffs/semantic-patch.json')))
  assert.ok(existsSync(join(runRoot, 'diffs/project-delta.json')))
  assert.ok(existsSync(join(runRoot, 'report.md')))
  assert.ok(!readFileSync(join(runRoot, 'report.json'), 'utf8').includes(root))
  await assert.rejects(
    startRepair({
      artifactBytes: baselineBytes,
      repairCase: benchmark.repairCase,
      artifactRoot: root,
      sessionId: 'promotion-safety',
    }),
    /artifact root already exists/
  )

  const semanticHashBenchmark = buildRepairBenchmark('R1')
  const semanticCase = structuredClone(semanticHashBenchmark.repairCase)
  const modelSet = semanticCase.tests[0]?.model
  const model = modelSet
    ? [
        ...modelSet.programModels,
        ...modelSet.endModels,
        ...modelSet.userModels,
      ][0]
    : undefined
  assert.ok(model)
  model.maxDurationTicks = (model.maxDurationTicks ?? 0) + 1
  assert.notEqual(
    repairCaseHash(semanticCase),
    repairCaseHash(semanticHashBenchmark.repairCase)
  )

  const invalidBaselineRoot = tempRoot(t, 'repair-invalid-precedence')
  const invalidCase = structuredClone(benchmark.repairCase)
  invalidCase.id = 'INVALID CASE'
  const invalidBaseline = await startRepair({
    artifactBytes: new TextEncoder().encode('not an sb3'),
    repairCase: invalidCase,
    artifactRoot: invalidBaselineRoot,
    sessionId: 'invalid-precedence',
  })
  assert.equal(invalidBaseline.result().status, 'case-invalid')

  const trustedBenchmark = buildRepairBenchmark('R1')
  const trustedRoot = tempRoot(t, 'repair-trusted-metadata')
  const trusted = await startRepair({
    artifactBytes: await trustedBenchmark.broken.toSb3(),
    repairCase: trustedBenchmark.repairCase,
    artifactRoot: trustedRoot,
    sessionId: 'trusted-metadata',
    sourceRevision:
      'rev,/edge/private/key;ENOENT:/colon/private/key;ghp_abcdefghijklmnopqrstuvwxyz1234567890',
  })
  const trustedRequest = trusted.nextRequest()
  assert.ok('requestId' in trustedRequest)
  const trustedProposal = trustedBenchmark.referenceProposal(trustedRequest)
  trustedProposal.rationale =
    'Bearer topsecret sk-proj-abcdef1234567890 /custom/private/path'
  trustedProposal.expectedEffect = 'AKIAIOSFODNN7EXAMPLE /nix/store/key'
  await assert.rejects(
    trusted.submitProposal(trustedProposal, {
      usage: { inputTokens: 1n },
    } as unknown as Parameters<typeof trusted.submitProposal>[1]),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'session.invalid-submission-metadata'
  )
  assert.equal(trusted.snapshot().state, 'awaiting-proposal')
  assert.equal(trusted.snapshot().pendingRequestId, trustedRequest.requestId)
  const trustedAttempt = await trusted.submitProposal(trustedProposal)
  assert.equal(trustedAttempt.state, 'repaired')
  const trustedArtifacts = [
    join(trustedRoot, 'repair-trusted-metadata/attempts/001/proposal.json'),
    join(trustedRoot, 'repair-trusted-metadata/report.json'),
  ].map((path) => readFileSync(path, 'utf8'))
  for (const artifact of trustedArtifacts)
  {
    assert.ok(!artifact.includes('topsecret'))
    assert.ok(!artifact.includes('sk-proj-abcdef1234567890'))
    assert.ok(!artifact.includes('AKIAIOSFODNN7EXAMPLE'))
    assert.ok(!artifact.includes('/custom/private/path'))
    assert.ok(!artifact.includes('/nix/store/key'))
    assert.ok(!artifact.includes('/edge/private/key'))
    assert.ok(!artifact.includes('/colon/private/key'))
    assert.ok(!artifact.includes('ghp_abcdefghijklmnopqrstuvwxyz1234567890'))
  }
  const trustedReportBeforeExport = reportAt(trustedRoot, 'trusted-metadata')
  assert.deepEqual(trustedReportBeforeExport.accepted?.exports, [])
  const trustedStore = (trusted as unknown as { store: RepairArtifactStore })
    .store
  const writeTrustedReports = trustedStore.writeReports.bind(trustedStore)
  let failNextTrustedReport = true
  trustedStore.writeReports = (nextReport) =>
  {
    if (failNextTrustedReport)
    {
      failNextTrustedReport = false
      throw Object.assign(new Error('simulated export report failure'), {
        code: 'EACCES',
      })
    }
    return writeTrustedReports(nextReport)
  }
  const failedExportPath = join(trustedRoot, 'failed-export.sb3')
  assert.throws(
    () => trusted.exportAccepted(failedExportPath),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'session.export-report-failed'
  )
  assert.ok(!existsSync(failedExportPath))
  assert.equal(trusted.snapshot().state, 'repaired')
  assert.ok(trusted.acceptedArtifact())
  assert.deepEqual(
    reportAt(trustedRoot, 'trusted-metadata').accepted?.exports,
    []
  )
  trustedStore.writeReports = writeTrustedReports
  const exportPath = join(trustedRoot, 'verified-export.sb3')
  const exportProof = trusted.exportAccepted(exportPath)
  assert.equal(exportProof.sha256, trusted.acceptedArtifact()?.identity.sha256)
  assert.deepEqual(
    Uint8Array.from(readFileSync(exportPath)),
    trusted.acceptedArtifact()?.bytes
  )
  assert.equal(
    reportAt(trustedRoot, 'trusted-metadata').accepted?.exports.length,
    1
  )

  const schema = trustedRequest.proposalSchema as {
    properties: { operations: { items: { oneOf: object[] } } }
    $defs: {
      targetRef: { properties: { targetIndex: { maximum: number } } }
      blockSpec: {
        properties: {
          inputs: { propertyNames: { minLength: number } }
          fields: { propertyNames: { minLength: number } }
        }
      }
    }
  }
  assert.equal(
    schema.$defs.targetRef.properties.targetIndex.maximum,
    Number.MAX_SAFE_INTEGER
  )
  assert.equal(
    schema.$defs.blockSpec.properties.inputs.propertyNames.minLength,
    1
  )
  assert.equal(
    schema.$defs.blockSpec.properties.fields.propertyNames.minLength,
    1
  )
  assert.ok(
    JSON.stringify(schema.properties.operations.items.oneOf).includes(
      '^(?:\\\\S|\\\\S[\\\\s\\\\S]*\\\\S)$'
    )
  )

  const symlinkBenchmark = buildRepairBenchmark('R1')
  const symlinkRoot = tempRoot(t, 'repair-symlink')
  const symlinkOutside = tempRoot(t, 'repair-symlink-outside')
  const symlinkSession = await startRepair({
    artifactBytes: await symlinkBenchmark.broken.toSb3(),
    repairCase: symlinkBenchmark.repairCase,
    artifactRoot: symlinkRoot,
    sessionId: 'symlink',
  })
  const symlinkRequest = symlinkSession.nextRequest()
  assert.ok('requestId' in symlinkRequest)
  const acceptedDirectory = join(symlinkRoot, 'repair-symlink/accepted')
  rmSync(acceptedDirectory, { recursive: true })
  symlinkSync(symlinkOutside, acceptedDirectory, 'dir')
  const symlinkAttempt = await symlinkSession.submitProposal(
    symlinkBenchmark.referenceProposal(symlinkRequest)
  )
  assert.equal(symlinkAttempt.state, 'stopped-infrastructure')
  assert.equal(symlinkAttempt.attempt.status, 'stopped-infrastructure')
  assert.ok(!existsSync(join(symlinkOutside, 'candidate.sb3')))

  const evaluationBenchmark = buildRepairBenchmark('R1')
  const evaluationRoot = tempRoot(t, 'repair-evaluation-retention')
  const evaluationSession = await startRepair({
    artifactBytes: await evaluationBenchmark.broken.toSb3(),
    repairCase: evaluationBenchmark.repairCase,
    artifactRoot: evaluationRoot,
    sessionId: 'evaluation-retention',
  })
  const evaluationRequest = evaluationSession.nextRequest()
  assert.ok('requestId' in evaluationRequest)
  const evaluationInternal = evaluationSession as unknown as {
    store: { writeAttemptEvaluation(): never }
  }
  evaluationInternal.store.writeAttemptEvaluation = () =>
  {
    throw Object.assign(new Error('simulated evaluation write failure'), {
      code: 'EACCES',
    })
  }
  const evaluationAttempt = await evaluationSession.submitProposal(
    evaluationBenchmark.referenceProposal(evaluationRequest)
  )
  assert.equal(evaluationAttempt.state, 'stopped-infrastructure')
  const evaluationReport = reportAt(evaluationRoot, 'evaluation-retention')
  assert.equal(evaluationReport.attempts[0]?.record.transactionStatus, 'passed')
  assert.equal(
    evaluationReport.attempts[0]?.record.proposal?.operations[0]?.kind,
    'replaceLiteral'
  )
  assert.ok(evaluationReport.attempts[0]?.record.candidate)
  assert.ok(evaluationReport.attempts[0]?.record.delta)
  assert.ok(evaluationReport.attempts[0]?.record.preservation)
  assert.ok(evaluationReport.attempts[0]?.artifacts.candidate)
  assert.ok(evaluationReport.attempts[0]?.artifacts.delta)
  assert.ok(evaluationReport.attempts[0]?.artifacts.preservation)
  assert.equal(evaluationReport.attempts[0]?.artifacts.evaluation, null)
  assert.equal(
    (
      evaluationReport.attempts[0]?.record.evaluation as {
        status?: string
      } | null
    )?.status,
    'passed'
  )
  assert.equal(
    evaluationReport.gates.find(
      (gate) => gate.name === 'semantic-patch-and-policy'
    )?.status,
    'passed'
  )
  assert.equal(
    evaluationReport.gates.find((gate) => gate.name === 'artifact-retention')
      ?.status,
    'stopped'
  )

  const alreadyBenchmark = buildRepairBenchmark('R1')
  const alreadyPassingRoot = tempRoot(t, 'repair-already-passing')
  const alreadyPassing = await startRepair({
    artifactBytes: await alreadyBenchmark.healthy.toSb3(),
    repairCase: alreadyBenchmark.repairCase,
    artifactRoot: alreadyPassingRoot,
    sessionId: 'already-passing',
  })
  assert.equal(alreadyPassing.result().status, 'already-passing')
  assert.deepEqual(reportAt(alreadyPassingRoot, 'already-passing').artifacts, {
    input: 'input.sb3',
    baselineEvaluation: 'baseline/evaluation.json',
    acceptedCandidate: 'accepted/candidate.sb3',
    semanticPatch: null,
    projectDelta: null,
    reportJson: 'report.json',
    reportMarkdown: 'report.md',
  })
  const alreadyRoot = tempRoot(t, 'repair-already-passing-failure')
  const originalPromoteInput = RepairArtifactStore.prototype.promoteInput
  RepairArtifactStore.prototype.promoteInput = () =>
  {
    throw Object.assign(new Error('simulated promotion failure'), {
      code: 'EACCES',
    })
  }
  let alreadySession: Awaited<ReturnType<typeof startRepair>>
  try
  {
    alreadySession = await startRepair({
      artifactBytes: await alreadyBenchmark.healthy.toSb3(),
      repairCase: alreadyBenchmark.repairCase,
      artifactRoot: alreadyRoot,
      sessionId: 'already-passing-failure',
    })
  }
  finally
  {
    RepairArtifactStore.prototype.promoteInput = originalPromoteInput
  }
  assert.equal(alreadySession.result().status, 'stopped-infrastructure')
  assert.equal(alreadySession.acceptedArtifact(), null)

  const invalidAgentBenchmark = buildRepairBenchmark('R1')
  const invalidAgentRoot = tempRoot(t, 'repair-invalid-agent')
  let invalidAgentProposed = false
  const invalidAgentResult = await repairProject(
    {
      artifactBytes: await invalidAgentBenchmark.broken.toSb3(),
      repairCase: invalidAgentBenchmark.repairCase,
      artifactRoot: invalidAgentRoot,
      sessionId: 'invalid-agent',
    },
    {
      descriptor: { adapter: 'test', provider: 1 },
      async propose(request: RepairRequest)
      {
        invalidAgentProposed = true
        return invalidAgentBenchmark.referenceProposal(request)
      },
    } as unknown as RepairAgent
  )
  assert.equal(invalidAgentProposed, false)
  assert.equal(invalidAgentResult.status, 'stopped-agent')
  assert.equal(
    reportAt(invalidAgentRoot, 'invalid-agent').attempts[0]?.record.agent
      .descriptor,
    null
  )

  const malformedBenchmark = buildRepairBenchmark('R1')
  const malformedRoot = tempRoot(t, 'repair-malformed-artifact')
  const malformed = await startRepair({
    artifactBytes: await malformedBenchmark.broken.toSb3(),
    repairCase: malformedBenchmark.repairCase,
    artifactRoot: malformedRoot,
    sessionId: 'malformed-artifact',
  })
  const malformedRequest = malformed.nextRequest()
  assert.ok('requestId' in malformedRequest)
  await malformed.submitProposal({
    authorization: 'Bearer topsecret',
    note: '/mnt/private/key',
  })
  const malformedArtifact = readFileSync(
    join(malformedRoot, 'repair-malformed-artifact/attempts/001/proposal.json'),
    'utf8'
  )
  assert.ok(!malformedArtifact.includes('topsecret'))
  assert.ok(!malformedArtifact.includes('/mnt/private/key'))
  assert.equal(JSON.parse(malformedArtifact).rawResponse.retained, false)

  const infrastructureBenchmark = buildRepairBenchmark('R1')
  const infrastructureRoot = tempRoot(t, 'repair-report-failure')
  const infrastructure = await startRepair({
    artifactBytes: await infrastructureBenchmark.broken.toSb3(),
    repairCase: infrastructureBenchmark.repairCase,
    artifactRoot: infrastructureRoot,
    sessionId: 'report-failure',
  })
  const infrastructureRequest = infrastructure.nextRequest()
  assert.ok('requestId' in infrastructureRequest)
  const internal = infrastructure as unknown as {
    store: { writeReports(): never }
  }
  internal.store.writeReports = () =>
  {
    throw Object.assign(new Error('simulated report failure'), {
      code: 'EACCES',
    })
  }
  const infrastructureAttempt = await infrastructure.submitProposal(
    infrastructureBenchmark.referenceProposal(infrastructureRequest)
  )
  assert.equal(infrastructureAttempt.state, 'stopped-infrastructure')
  assert.equal(infrastructureAttempt.terminal?.accepted, null)
  assert.equal(infrastructureAttempt.attempt.status, 'stopped-infrastructure')
  assert.equal(infrastructure.acceptedArtifact(), null)
  const infrastructureResult = infrastructure.result()
  assert.equal(infrastructureResult.accepted, null)
  assert.equal(infrastructureResult.report.json, null)
  assert.equal(infrastructureResult.report.markdown, null)
  assert.equal(infrastructureResult.report.errorCode, 'EACCES')
  assert.ok(
    !existsSync(
      join(infrastructureRoot, 'repair-report-failure/accepted/candidate.sb3')
    )
  )
  assert.ok(
    !existsSync(
      join(
        infrastructureRoot,
        'repair-report-failure/diffs/semantic-patch.json'
      )
    )
  )
  assert.equal(reportAt(infrastructureRoot, 'report-failure').status, 'running')
})

test('malformed repair cases fail closed before baseline or agent work', async (t) =>
{
  const benchmark = buildRepairBenchmark('R1')
  const zeroCapPolicy = structuredClone(benchmark.repairCase.policy)
  zeroCapPolicy.intentBudget.maxNewBlocksPerProposal = 0
  zeroCapPolicy.impactBudget.maxTouchedTargets = 0
  zeroCapPolicy.impactBudget.maxTouchedScripts = 0
  zeroCapPolicy.impactBudget.maxChangedAuthoredBlocks = 0
  zeroCapPolicy.impactBudget.maxChangedBlockRecords = 0
  assert.deepEqual(validateRepairPolicy(zeroCapPolicy), [])
  zeroCapPolicy.intentBudget.maxOpsPerProposal = 0
  assert.ok(
    validateRepairPolicy(zeroCapPolicy).some(
      (entry) => entry.code === 'policy.maxOpsPerProposal'
    )
  )
  const malformedCases: Array<{
    name: string
    build(repairCase: RepairCase): unknown
  }> = [
    {
      name: 'missing-policy-subobject',
      build(repairCase)
      {
        delete (repairCase.policy as Partial<typeof repairCase.policy>)
          .intentBudget
        return repairCase
      },
    },
    {
      name: 'invalid-policy-domains',
      build(repairCase)
      {
        repairCase.policy.diagnostics.rejectNewGraphAtOrAbove =
          'bogus' as typeof repairCase.policy.diagnostics.rejectNewGraphAtOrAbove
        repairCase.policy.preservation.allowAssetChanges =
          'false' as unknown as boolean
        repairCase.policy.preservation.allowedTargetProperties = [
          'unsupported',
        ] as unknown as typeof repairCase.policy.preservation.allowedTargetProperties
        repairCase.policy.evidence.escalateAfterRepeatedFailure =
          'true' as unknown as boolean
        return repairCase
      },
    },
    {
      name: 'incomplete-loaded-model',
      build(repairCase)
      {
        repairCase.tests[0]!.model = {
          programModels: [{ id: 'm', edges: [] }],
          endModels: [],
          userModels: [],
        } as unknown as NonNullable<RepairCase['tests'][number]['model']>
        return repairCase
      },
    },
    {
      name: 'incoherent-loaded-model-graph',
      build(repairCase)
      {
        const loaded = repairCase.tests[0]!.model!
        const model = [...loaded.programModels, ...loaded.endModels][0]!
        model.nodes.delete(model.startNodeId)
        return repairCase
      },
    },
    {
      name: 'non-object-case',
      build()
      {
        return null
      },
    },
  ]

  for (const malformedCase of malformedCases)
  {
    const root = tempRoot(t, `repair-${malformedCase.name}`)
    const repairCase = malformedCase.build(
      structuredClone(benchmark.repairCase)
    )
    const session = await startRepair({
      artifactBytes: new TextEncoder().encode('baseline must not be inspected'),
      repairCase: repairCase as RepairCase,
      artifactRoot: root,
      sessionId: malformedCase.name,
    })
    const result = session.result()
    assert.equal(result.status, 'case-invalid', malformedCase.name)
    assert.equal(result.attemptsUsed, 0, malformedCase.name)
    assert.deepEqual(result.attempts, [], malformedCase.name)
    assert.equal(session.snapshot().attemptsReserved, 0, malformedCase.name)
    const nextRequest = session.nextRequest()
    assert.ok('status' in nextRequest)
    if (!('status' in nextRequest)) throw new Error('terminal result missing')
    assert.equal(nextRequest.status, 'case-invalid')
    const baseline = result.baseline as {
      status: string
      issues: Array<{ responsibility: string }>
    }
    assert.equal(baseline.status, 'case-invalid', malformedCase.name)
    assert.ok(baseline.issues.length > 0, malformedCase.name)
    assert.ok(
      baseline.issues.every((entry) => entry.responsibility === 'repair-case'),
      malformedCase.name
    )
    assert.equal(
      reportAt(root, malformedCase.name).repairCase.id,
      'invalid-repair-case',
      malformedCase.name
    )
  }
})

test('canonical scripted agent repairs R1-R5 through the real pipeline', async (t) =>
{
  const root = tempRoot(t, 'repair-canonical')
  for (const benchmark of canonicalRepairBenchmarks())
  {
    const sessionId = `canonical-${benchmark.id.toLowerCase()}`
    const agent = new ScriptedRepairAgent([
      (request) => benchmark.referenceProposal(request),
    ])
    const result = await repairProject(
      {
        artifactBytes: await benchmark.broken.toSb3(),
        repairCase: benchmark.repairCase,
        artifactRoot: root,
        sessionId,
        recordVideo: false,
      },
      agent
    )
    assert.equal(result.status, 'repaired', benchmark.id)
    assert.equal(result.attempts.length, 1, benchmark.id)
    assert.equal(result.attempts[0]?.evaluationStatus, 'passed', benchmark.id)
    assert.equal(result.attempts[0]?.operationKinds.length, 1, benchmark.id)
    const request = agent.requests[0]!
    const declaredCount = benchmark.repairCase.tests.reduce(
      (count, spec) =>
        count +
        (spec.baseline.outcome === 'fail' ? spec.baseline.failures.length : 0),
      0
    )
    assert.equal(request.failures.length, declaredCount, benchmark.id)
    assert.equal(expectedFailureCount(request), declaredCount, benchmark.id)
    assert.equal(
      request.evidence.level,
      benchmark.id === 'R5' ? 3 : 1,
      benchmark.id
    )
    if (benchmark.id === 'R5')
      assert.deepEqual(
        request.evidence.level3?.screenshots.map((entry) => entry.label),
        ['caught', 'start']
      )
    else assert.equal(request.evidence.level3, null)
    const topThree = request.localization.candidates.slice(0, 3)
    const expected = benchmark.expectedLocalization
    const localized = topThree.some((candidate) =>
    {
      const sameScript =
        candidate.script.target.targetIndex ===
          expected.script.target.targetIndex &&
        candidate.script.target.name === expected.script.target.name &&
        candidate.script.target.isStage === expected.script.target.isStage &&
        candidate.script.topBlockId === expected.script.topBlockId
      if (!sameScript) return false
      if (benchmark.id !== 'R1' && benchmark.id !== 'R3') return true
      return candidate.implicatedBlock?.blockId === expected.block?.blockId
    })
    assert.equal(localized, true, benchmark.id)
    assert.ok(!JSON.stringify(request).includes('restore-score-increment'))
    const report = reportAt(root, sessionId)
    const baselineEvaluation = report.baseline.evaluation as {
      status?: unknown
    }
    assert.equal(baselineEvaluation.status, 'awaiting-proposal')
    assert.deepEqual(report.attempts[0]?.gateOrder, [
      'preflight',
      'targeted',
      'regression',
    ])
    assert.equal(report.accepted?.proof.assetsPreserved, true)
    assert.equal(report.accepted?.proof.existingEditorLayoutPreserved, true)
    assert.equal(report.accepted?.delta?.summary.touchedTargets, 1)
    assert.ok(existsSync(join(root, `repair-${sessionId}`, 'input.sb3')))
    assert.ok(
      existsSync(join(root, `repair-${sessionId}`, 'accepted/candidate.sb3'))
    )
    assert.ok(existsSync(join(root, `repair-${sessionId}`, 'report.md')))
    assert.ok(
      !readFileSync(
        join(root, `repair-${sessionId}`, 'report.json'),
        'utf8'
      ).includes(root)
    )
    if (benchmark.id === 'R3')
    {
      const accepted = await ProjectIR.fromSb3(
        readFileSync(
          join(root, `repair-${sessionId}`, 'accepted/candidate.sb3')
        )
      )
      assert.ok(
        Object.values(accepted.stage!.raw.broadcasts ?? {}).includes('wrong')
      )
    }
  }
})
