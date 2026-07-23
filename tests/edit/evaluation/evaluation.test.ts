// tests/edit/evaluation/evaluation.test.ts
// exact-byte Group G evaluation, certificate lifecycle, & external evidence recovery

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ProjectIR,
  captureProjectOrderedHeadEvidence,
  computeProjectDelta,
} from '@scratch-agent/ir'
import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  applyTargetOperationV1,
  boundedDisplayStringV1,
  buildSemanticReferenceIndex,
  parseSemanticChangeContractV1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
  targetBoundedLocationProjectionV1,
  targetEntityEvidenceSetV1,
  targetExpectedStringIdentityV1,
  targetInboundReferenceSetV1,
  targetProspectiveNameActivationV1,
  type EditChangeContractRegistrationV1,
  type EditScenarioPolicyV1,
  type RuntimePredicateV1,
  type RunnerAvailabilityV1,
  type SemanticEditOperationV1,
} from '@scratch-agent/ir/edit'
import { buildFixtureSb3, packSb3 } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { inspectSemanticEditArtifact } from '../../../packages/eval/src/artifacts/artifact-preflight.js'
import { aggregateAllowedChangeV1, aggregateEditEvaluationV1, aggregatePreservationV1, aggregateRequiredChangeV1, editEvaluationGateDispositionSetSha256V1, editEvaluationLimitationSetSha256V1 } from '../../../packages/eval/src/edit-evaluation/edit-evaluation-aggregate.js'
import { reserveEditEvaluationMatrixV1 } from '../../../packages/eval/src/edit-evaluation/edit-evaluation-matrix.js'
import { type EditProductionPolicyDecoderV1 } from '../../../packages/eval/src/edit-evaluation/edit-production-evaluation.js'
import { DEFAULT_RUNTIME_OBSERVATION_CAPS, defaultObservationPlan } from '../../../packages/runner/src/observation/observation.js'

import { EditChangeContractRegistryV1, type BoundChangeContractV1 } from '../../../packages/edit/src/contracts/change-contracts.js'
import { evaluateExportabilityV1 } from '../../../packages/edit/src/evaluation/evaluation-certificate.js'
import { EVALUATION_LANE_ORDER_V1 } from '../../../packages/edit/src/evaluation/evaluation-plans.js'
import { structuralObjectiveObservationsV1 } from '../../../packages/edit/src/evaluation/evaluation-structural.js'
import { ProductionEditDeterministicEvaluationPortV1 } from '../../../packages/edit/src/evaluation/production-evaluation.js'
import { ProductionTransactionExecutorV1, TargetProductionOperationDispatcherV1, productionContractScopeSha256V1, productionOperationChangeFingerprintV1, productionTargetPlanningFactSetSha256V1 } from '../../../packages/edit/src/transaction/production-transaction.js'
import { buildSourceLineageV1 } from '../../../packages/edit/src/lineage/lineage.js'
import { verifyEditSessionReplayV1 } from '../../../packages/edit/src/replay/replay.js'
import { EditSessionErrorV1, createEditSessionRegistryForExecutorV1, type EditInspectDomainItemV1, type EditSessionV1 } from '../../../packages/edit/src/session/session.js'
import type { EditArtifactStorePort, EditClockPort, EditEntropyPort, HostInvocationContextV1 } from '../../../packages/edit/src/transaction/ports.js'
import type { EditDeterministicEvaluationExecutionV1, EditDeterministicEvaluationPort, EditDeterministicEvaluationRequestV1, EditExternalEvidenceNotificationV1, EditStagedExternalEvidenceRecordV1 } from '../../../packages/edit/src/evaluation/evaluation-ports.js'
import { assertExternalEvidenceDeadlineV1, editStagedExternalEvidenceResultSha256V1, EXTERNAL_EVIDENCE_DEADLINE_MAXIMUM_MS, evaluationProvenanceChainSha256V1 } from '../../../packages/edit/src/evaluation/evaluation-ports.js'
import { createEditArtifactStoreHostAdapter } from '../../../packages/eval/src/artifacts/durable-artifacts.js'
import {
  HOST_DEFAULT_LIMITS,
  HOST_HARD_LIMITS,
  expectedHeadRequest,
  planningHead,
  unchangedTargetCorrespondence,
} from '../../helpers/edit-host.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const RENAMED_SPRITE = 'Evaluated Hero'

function tempRoot(t: test.TestContext): string
{
  const root = mkdtempSync(join(tmpdir(), 'phase-8-group-g-evaluation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return join(root, 'store')
}

function deterministicClock(start: number): EditClockPort
{
  let now = start
  return { nowEpochMs: () => ++now }
}

function deterministicEntropy(seed: number): EditEntropyPort
{
  let sequence = seed
  return {
    randomBytes(byteLength: number): Uint8Array
    {
      const bytes = new Uint8Array(byteLength)
      for (let index = 0; index < byteLength; index++)
        bytes[index] = (sequence + index * 31) & 0xff
      sequence += byteLength + 11
      return bytes
    },
  }
}

function invocation(sequence: number): HostInvocationContextV1
{
  return {
    boundaryKind: 'directHost',
    invocationSha256: sequence.toString(16).padStart(64, '0'),
    principalSha256: HASH_E,
  }
}

test('Group G rejects invalid external evidence deadlines at host-port acceptance', () =>
{
  const deterministic = {
    runnerAvailabilityV1: () => [],
    evaluate: async () => assert.fail('deadline validation executed a lane'),
  } as unknown as EditDeterministicEvaluationPort
  assert.doesNotThrow(() =>
    assertExternalEvidenceDeadlineV1({
      deterministic,
      externalEvidenceDeadlineMs: 1,
    })
  )
  assert.doesNotThrow(() =>
    assertExternalEvidenceDeadlineV1({
      deterministic,
      externalEvidenceDeadlineMs: EXTERNAL_EVIDENCE_DEADLINE_MAXIMUM_MS,
    })
  )
  for (const externalEvidenceDeadlineMs of [
    0,
    1.5,
    EXTERNAL_EVIDENCE_DEADLINE_MAXIMUM_MS + 1,
  ])
    assert.throws(() =>
      assertExternalEvidenceDeadlineV1({
        deterministic,
        externalEvidenceDeadlineMs,
      })
    )
})

function targetHandle(item: EditInspectDomainItemV1)
{
  assert.equal(item.entityKind, 'target')
  assert.ok(item.handle)
  return {
    entityKind: 'target' as const,
    expectedSemanticFingerprint: item.semanticFingerprintSha256,
    refKind: 'handle' as const,
    token: item.handle,
  }
}

interface RenameAuthority
{
  readonly registry: EditChangeContractRegistryV1
  readonly bound: BoundChangeContractV1
  readonly targetIndex: number
  readonly beforeReferenceSetSha256: string
  readonly activationSetSha256: string
}

interface RenameAuthorityOptions
{
  readonly externalPredicateCount?: 0 | 1 | 2
}

async function renameAuthority(
  sourceBytes: Uint8Array,
  sourceProject: ProjectIR,
  options: RenameAuthorityOptions = {}
): Promise<RenameAuthority>
{
  const externalPredicateCount = options.externalPredicateCount ?? 0
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const preflight = await inspectSemanticEditArtifact(sourceBytes)
  assert.ok(
    preflight.ok && preflight.semanticSourceSha256,
    JSON.stringify(preflight)
  )
  const semanticSourceSha256 = preflight.semanticSourceSha256
  const lineage = buildSourceLineageV1(
    sourceProject,
    semanticSourceSha256
  ).active
  const targetIndex = 1
  const targetEvidence = targetEntityEvidenceSetV1(sourceProject.json).find(
    (entry) => entry.targetIndex === targetIndex
  )
  const sprite = sourceProject.json.targets[targetIndex]
  assert.ok(targetEvidence && targetEvidence.targetKind === 'sprite')
  assert.ok(sprite && !sprite.isStage)
  const targetRef = {
    entityKind: 'target' as const,
    refKind: 'structural' as const,
    selectorKind: 'exactLocation' as const,
    location: targetBoundedLocationProjectionV1(
      targetEvidence,
      `group-g-target-${targetEvidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: targetEvidence.semanticLocationSha256,
    expectedSemanticFingerprint: targetEvidence.semanticFingerprintSha256,
    expectedContextFingerprint: targetEvidence.contextFingerprintSha256,
  }
  const index = buildSemanticReferenceIndex(sourceProject)
  const inbound = targetInboundReferenceSetV1(sourceProject, index, targetIndex)
  const activation = targetProspectiveNameActivationV1(
    sourceProject,
    index,
    RENAMED_SPRITE
  )
  const provisional = {
    kind: 'target.renameSprite' as const,
    opId: 'rename-evaluated-sprite',
    target: targetRef,
    expectedName: targetExpectedStringIdentityV1(sprite.name),
    newName: RENAMED_SPRITE,
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0 as const,
    },
    expectedPlanningFactSetSha256: HASH_A,
  }
  const operation = {
    ...provisional,
    expectedPlanningFactSetSha256: productionTargetPlanningFactSetSha256V1(
      sourceProject,
      provisional,
      targetIndex,
      lineage
    ),
  }
  const candidate = ProjectIR.fromProjectJson(
    structuredClone(sourceProject.toProjectJson()),
    sourceProject.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    }))
  )
  candidate.uids.restoreMonotonic(sourceProject.uids.snapshot())
  const applied = applyTargetOperationV1(candidate, {
    operation,
    targetIndex,
    activeLineage: lineage,
  })
  const candidateBytes = await packSb3(
    JSON.stringify(candidate.toProjectJson()),
    candidate.assets
  )
  const correspondence = unchangedTargetCorrespondence(
    sourceArtifactSha256,
    sha256Hex(candidateBytes),
    semanticSourceSha256,
    lineage
  )
  const delta = computeProjectDelta(
    sourceProject,
    candidate,
    [applied.attribution],
    {
      correspondence,
      correspondenceEvidence: {
        before: captureProjectOrderedHeadEvidence(
          sourceProject,
          correspondence,
          'before',
          {
            revisionIdentity: correspondence.beforeRevisionIdentity,
            semanticSourceSha256,
            lineageSnapshot: lineage,
          }
        ),
        after: captureProjectOrderedHeadEvidence(
          candidate,
          correspondence,
          'after',
          {
            revisionIdentity: correspondence.afterRevisionIdentity,
            semanticSourceSha256,
            lineageSnapshot: applied.activeLineage,
          }
        ),
      },
    }
  )
  const bindingRef = {
    contractRefKind: 'existing' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    bindingKey: 'sprite-binding',
  }
  const scope = {
    scopeSubjectKind: 'entity' as const,
    operationKind: 'target.renameSprite' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    locationScope: { scopeKind: 'exactEntity' as const, entity: bindingRef },
    allowedPropertyPaths: [
      { surface: 'target' as const, property: 'name' as const },
    ],
  }
  const scenario = Object.freeze({
    scenarioId: 'rename-scenario',
    applicability: 'baselineAndCandidate',
    seed: 7,
    fixedDateMs: 1_753_056_000_000,
    maxTicks: 20,
    steps: Object.freeze([
      { do: 'greenFlag' as const },
      { do: 'wait' as const, ticks: 5 },
      { do: 'snapshot' as const, label: 'done' },
    ]),
  }) satisfies EditScenarioPolicyV1
  const scenarioBytes = canonicalJsonBytesV1(scenario)
  const runtimeBytes = canonicalJsonBytesV1({
    policyKind: 'runtime',
    schemaVersion: 1,
  })
  const lensBytes = canonicalJsonBytesV1({
    policyKind: 'lens',
    schemaVersion: 1,
  })
  const criterionBytes = canonicalJsonBytesV1({
    policyKind: 'visualCriterion',
    schemaVersion: 1,
  })
  const confidenceBytes = canonicalJsonBytesV1({
    policyKind: 'confidence',
    schemaVersion: 1,
  })
  const scenarioSha256 = scenarioPolicyValueSemanticSha256V1(scenario)
  const runtimeSha256 = semanticHashV1('evidence-content', {
    kind: 'group-g-runtime-policy',
  })
  const lensSha256 = semanticHashV1('evidence-content', {
    kind: 'group-g-lens-policy',
  })
  const criterionSha256 = semanticHashV1('evidence-content', {
    kind: 'group-g-criterion-policy',
  })
  const confidenceSha256 = semanticHashV1('evidence-content', {
    kind: 'group-g-confidence-policy',
  })
  const contract = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  contract.sourceConstraint = { kind: 'exactArtifact', sourceArtifactSha256 }
  contract.entityBindings = [
    {
      bindingKey: bindingRef.bindingKey,
      bindingKind: 'existing',
      entityKind: 'target',
      entitySubtype: 'sprite',
      expectedMatchCount: 1,
      sourceLocationSha256: targetEvidence.semanticLocationSha256,
      expectedSourceSemanticFingerprint:
        targetEvidence.semanticFingerprintSha256,
      expectedSourceContextFingerprint: targetEvidence.contextFingerprintSha256,
    },
  ]
  contract.allowedOperationKinds = ['target.renameSprite']
  contract.allowedSemanticScopes = [scope]
  contract.requiredStructuralChanges = [
    {
      objectiveId: 'rename-required',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'target.renameSprite',
      semanticScopeSha256: productionContractScopeSha256V1(scope),
      semanticChangeFingerprint: productionOperationChangeFingerprintV1(
        'parent-child',
        delta,
        operation.opId
      ),
    },
  ]
  contract.allowedStructuralChanges = [
    {
      allowanceId: 'rename-reference-propagation',
      kind: 'referencePropagation',
      owner: bindingRef,
      beforeReferenceSetSha256: inbound.referenceSetSha256,
      afterReferenceSetSha256: applied.postcondition.inboundReferenceSetSha256!,
    },
  ]
  contract.stateProjectionMasks = []
  contract.cloneProjectionMasks = []
  contract.visualProjectionMasks = []
  contract.policyBindings = [
    {
      bindingId: 'scenario-policy',
      kind: 'scenario',
      schemaVersion: 1,
      semanticSha256: scenarioSha256,
      retainedArtifactSha256: sha256Hex(scenarioBytes),
    },
    {
      bindingId: 'runtime-policy',
      kind: 'runtime',
      schemaVersion: 1,
      semanticSha256: runtimeSha256,
      retainedArtifactSha256: sha256Hex(runtimeBytes),
    },
    {
      bindingId: 'lens-policy',
      kind: 'lens',
      schemaVersion: 1,
      semanticSha256: lensSha256,
      retainedArtifactSha256: sha256Hex(lensBytes),
    },
    ...(externalPredicateCount === 0
      ? []
      : [
          {
            bindingId: 'criterion-policy',
            kind: 'visualCriterion' as const,
            schemaVersion: 1 as const,
            semanticSha256: criterionSha256,
            retainedArtifactSha256: sha256Hex(criterionBytes),
          },
          {
            bindingId: 'confidence-policy',
            kind: 'confidence' as const,
            schemaVersion: 1 as const,
            semanticSha256: confidenceSha256,
            retainedArtifactSha256: sha256Hex(confidenceBytes),
          },
        ]),
  ]
  const externalPredicates = Array.from(
    { length: externalPredicateCount },
    (_, index): Extract<RuntimePredicateV1, { kind: 'visualCriterion' }> => ({
      objectiveId: `native-visual-${index + 1}`,
      kind: 'visualCriterion',
      scenarioId: scenario.scenarioId,
      lane: 'nativeVisual',
      evidenceWindow: { windowKind: 'tickRange', firstTick: 0, lastTick: 20 },
      criterionPolicySha256: criterionSha256,
      confidencePolicySha256: confidenceSha256,
    })
  )
  contract.evaluationPlans = [
    {
      planId: 'export-plan',
      planClass: 'behavioralEdit',
      requiredForExport: true,
      scenarioPolicySha256s: [scenarioSha256],
      runtimePolicySha256: runtimeSha256,
      requiredRuntimeChanges:
        externalPredicateCount === 0
          ? [
              {
                objectiveId: 'candidate-x-postcondition',
                kind: 'stateAtLabel' as const,
                scenarioId: scenario.scenarioId,
                lane: 'officialHeadless' as const,
                label: 'done',
                path: {
                  pathKind: 'targetProperty' as const,
                  target: bindingRef,
                  property: 'x' as const,
                },
                assertion: {
                  comparator: 'equals' as const,
                  expected: { valueKind: 'scalar' as const, value: 10 },
                },
              },
            ]
          : externalPredicates,
      preservationLenses: [
        {
          lensKind: 'finalState',
          scenarioId: scenario.scenarioId,
          lane:
            externalPredicateCount === 0
              ? ('officialHeadless' as const)
              : ('officialBrowser' as const),
          lensPolicySha256: lensSha256,
          required: true,
        },
      ],
      laneRequirements: EVALUATION_LANE_ORDER_V1.map((lane) =>
        lane === 'projectPreflight' ||
        (externalPredicateCount === 0
          ? lane === 'officialHeadless'
          : lane === 'officialBrowser' || lane === 'nativeVisual')
          ? {
              lane,
              disposition: 'required' as const,
              requiredUnavailableResult: 'unavailable' as const,
            }
          : { lane, disposition: 'forbidden' as const }
      ),
    },
  ]
  contract.exportRequiredPlanId = 'export-plan'
  contract.outputNamePolicy = { kind: 'exact', basename: 'evaluated.sb3' }
  const parsed = parseSemanticChangeContractV1(contract)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) assert.fail('Group G change contract is invalid')
  const provenance = {
    authorityId: 'phase-8-group-g-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-21T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'prove exact-byte evaluation of one behavior-preserving sprite rename'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const withoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId: 'phase-8-group-g-rename',
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  const registration: EditChangeContractRegistrationV1 = {
    ...withoutDisplayHash,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  }
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  registry.registerBytes(canonicalJsonBytesV1(registration), [
    scenarioBytes,
    runtimeBytes,
    lensBytes,
    ...(externalPredicateCount === 0 ? [] : [criterionBytes, confidenceBytes]),
  ])
  registry.seal()
  return {
    registry,
    bound: registry.bind({
      registrationId: registration.registrationId,
      expectedSemanticContractSha256: registration.semanticContractSha256,
      source: { kind: 'exactArtifact', sourceArtifactSha256 },
      existingBindings: [
        {
          bindingKey: bindingRef.bindingKey,
          entityKind: 'target',
          sourceLocationSha256: targetEvidence.semanticLocationSha256,
        },
      ],
    }),
    targetIndex,
    beforeReferenceSetSha256: inbound.referenceSetSha256,
    activationSetSha256: activation.activationSetSha256,
  }
}

function runnerAvailability(): readonly RunnerAvailabilityV1[]
{
  return EVALUATION_LANE_ORDER_V1.map((lane) => ({
    lane,
    availability:
      lane === 'projectPreflight' || lane === 'officialHeadless'
        ? ('available' as const)
        : ('unavailable' as const),
    availabilityEpoch: 1,
  }))
}

const GROUP_G_POLICY_DECODER_V1 = Object.freeze({
  decodeRuntimePolicy: (artifact) =>
  {
    assert.equal(artifact.binding.kind, 'runtime')
    return {
      cells: [
        {
          lane: 'officialHeadless',
          scenarioId: 'rename-scenario',
          observationPlan: defaultObservationPlan(),
          observationCaps: DEFAULT_RUNTIME_OBSERVATION_CAPS,
        },
      ],
      allowedNewDiagnosticFingerprints: [],
    }
  },
  decodeLensPolicy: (artifact, lens) =>
  {
    assert.equal(artifact.binding.kind, 'lens')
    assert.equal(lens.lensKind, 'finalState')
    return {
      schemaVersion: 1,
      id: 'group-g-final-state',
      required: true,
      appliesTo: 'baseline-candidate',
      kind: 'final-state',
      absoluteNumericTolerance: 0,
    }
  },
} satisfies EditProductionPolicyDecoderV1)

class RecordingProductionPortV1 implements EditDeterministicEvaluationPort
{
  readonly #delegate = new ProductionEditDeterministicEvaluationPortV1({
    decoder: GROUP_G_POLICY_DECODER_V1,
    runnerAvailabilityProbe: { runnerAvailabilityV1: runnerAvailability },
  })
  requests: EditDeterministicEvaluationRequestV1[] = []
  executions: EditDeterministicEvaluationExecutionV1[] = []

  runnerAvailabilityV1(): readonly RunnerAvailabilityV1[]
  {
    return this.#delegate.runnerAvailabilityV1()
  }

  async evaluate(
    request: EditDeterministicEvaluationRequestV1
  ): Promise<EditDeterministicEvaluationExecutionV1>
  {
    this.requests.push(structuredClone(request))
    const execution = await this.#delegate.evaluate(request)
    this.executions.push(structuredClone(execution))
    return execution
  }
}

test('Group G evaluates an exact behavior-preserving rename and replays its certificate without a port', async (t) =>
{
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  sourceProject.json.targets[0]!.variables['stageWitnessId'] = [
    'stage witness',
    1,
  ]
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const authority = await renameAuthority(sourceBytes, sourceProject)
  const store = createEditArtifactStoreHostAdapter(tempRoot(t))
  const port = new RecordingProductionPortV1()
  const dispatcher = new TargetProductionOperationDispatcherV1()
  const executor = new ProductionTransactionExecutorV1([dispatcher])
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: authority.registry,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(17),
      handleSecret: new Uint8Array(32).fill(0x47),
      evaluationPorts: { deterministic: port },
    },
    executor
  )
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-g-evaluation',
      baseline: {
        kind: 'projectSession',
        projectSessionId: 'group-g-evaluation-project',
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: authority.bound.registration.registrationId,
      expectedSemanticContractSha256:
        authority.bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'group-g-evaluation.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId: 'group-g-evaluation-project',
        selectedDisplayName: 'group-g-evaluation.sb3',
        canonicalRealpath: '/virtual/group-g-evaluation.sb3',
        device: 'test-device',
        inode: 'group-g-evaluation-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056000000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const target = inspection.items.find(
    (item) =>
      item.entityKind === 'target' &&
      item.serializedTargetOrdinal === authority.targetIndex
  )
  assert.ok(target)
  const index = buildSemanticReferenceIndex(sourceProject)
  const inbound = targetInboundReferenceSetV1(
    sourceProject,
    index,
    authority.targetIndex
  )
  const activation = targetProspectiveNameActivationV1(
    sourceProject,
    index,
    RENAMED_SPRITE
  )
  assert.equal(inbound.referenceSetSha256, authority.beforeReferenceSetSha256)
  assert.equal(activation.activationSetSha256, authority.activationSetSha256)
  const provisional: SemanticEditOperationV1 = {
    kind: 'target.renameSprite',
    opId: 'rename-evaluated-sprite',
    target: targetHandle(target),
    expectedName: targetExpectedStringIdentityV1('Sprite1'),
    newName: RENAMED_SPRITE,
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedPlanningFactSetSha256: HASH_A,
  }
  const operation: SemanticEditOperationV1 = {
    ...provisional,
    expectedPlanningFactSetSha256: productionTargetPlanningFactSetSha256V1(
      sourceProject,
      provisional,
      authority.targetIndex,
      session.revisions[0]!.activeLineage as never
    ),
  }
  const preview = await session.preview(
    {
      requestId: 'preview-group-g-rename',
      expectedHead: session.head,
      canonicalTransaction: {
        schemaVersion: 1,
        expected: planningHead(session.head, session.sessionId),
        operations: [operation],
      },
    },
    invocation(2)
  )
  await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-g-rename',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  const evaluatedHead = session.head
  const candidateBytes = await store.readImmutable(
    session.revisions.at(-1)!.candidateKey
  )
  const candidateProject = await ProjectIR.fromSb3(candidateBytes)
  const expectedCandidateJson = structuredClone(sourceProject.json)
  expectedCandidateJson.targets[authority.targetIndex]!.name = RENAMED_SPRITE
  assert.deepEqual(candidateProject.json, expectedCandidateJson)
  assert.deepEqual(candidateProject.assets, sourceProject.assets)
  const evaluation = await session.evaluate(
    {
      schemaVersion: 1,
      action: 'start',
      sessionId: session.sessionId,
      requestId: 'evaluate-group-g-rename',
      evaluationPlanId: 'export-plan',
      ...expectedHeadRequest(evaluatedHead),
    },
    invocation(4)
  )
  const evaluationEntries = await store.listImmutable('sessions')
  const deterministicEntry = evaluationEntries.find((entry) =>
    entry.key.endsWith('/deterministic-results.json')
  )
  assert.ok(
    deterministicEntry,
    JSON.stringify(evaluationEntries.map((entry) => entry.key))
  )
  const deterministicArtifact = JSON.parse(
    new TextDecoder().decode(await store.readImmutable(deterministicEntry.key))
  ) as unknown
  const retainedEvidence = await Promise.all(
    evaluationEntries
      .filter((entry) => entry.key.includes('/evaluation-evidence/'))
      .map(
        async (entry) =>
          JSON.parse(
            new TextDecoder().decode(await store.readImmutable(entry.key))
          ) as unknown
      )
  )
  assert.equal(
    evaluation.phase,
    'completed',
    JSON.stringify({ deterministicArtifact, retainedEvidence })
  )
  assert.equal(evaluation.certificate.state, 'present')
  if (evaluation.certificate.state !== 'present')
    assert.fail('evaluation retained no certificate')
  assert.equal(evaluation.certificate.status, 'passed')
  assert.equal(port.requests.length, 1)
  assert.equal(port.executions.length, 1)
  assert.deepEqual(port.requests[0]!.candidateBytes, candidateBytes)
  assert.equal(
    port.requests[0]!.revision.candidateSha256,
    sha256Hex(candidateBytes)
  )
  assert.equal(port.requests[0]!.revision.revisionId, evaluatedHead.revisionId)
  assert.equal(
    port.requests[0]!.policies.find(
      (artifact) => artifact.binding.kind === 'scenario'
    )?.scenarioPolicy?.scenarioId,
    'rename-scenario'
  )
  const execution = port.executions[0]!
  const runtimeTraces = execution.evidencePayloads
    .filter((payload) => payload.evidenceKind === 'runtimeTrace')
    .map(
      (payload) =>
        JSON.parse(new TextDecoder().decode(payload.bytes)) as Record<
          string,
          unknown
        >
    )
  const baselineTrace = runtimeTraces.find(
    (trace) =>
      (trace['matrix'] as Record<string, unknown>)['side'] === 'baseline'
  )
  const candidateTrace = runtimeTraces.find(
    (trace) =>
      (trace['matrix'] as Record<string, unknown>)['side'] === 'candidate'
  )
  assert.ok(baselineTrace)
  assert.ok(candidateTrace)
  assert.equal(baselineTrace['traceOk'], true)
  assert.equal(candidateTrace['traceOk'], true)
  assert.deepEqual(candidateTrace['issues'], baselineTrace['issues'])
  assert.deepEqual(candidateTrace['actions'], baselineTrace['actions'])
  const baselineSnapshot = baselineTrace['finalSnapshot'] as Record<
    string,
    unknown
  >
  const candidateSnapshot = candidateTrace['finalSnapshot'] as Record<
    string,
    unknown
  >
  assert.deepEqual(candidateSnapshot['stage'], baselineSnapshot['stage'])
  const baselineTargets = baselineSnapshot['targets'] as Record<
    string,
    Record<string, unknown>
  >
  const candidateTargets = candidateSnapshot['targets'] as Record<
    string,
    Record<string, unknown>
  >
  assert.deepEqual(candidateTargets['Stage'], baselineTargets['Stage'])
  const baselineSprite = baselineTargets['Sprite1']!
  const candidateSprite = candidateTargets[RENAMED_SPRITE]!
  assert.deepEqual(candidateSprite, {
    ...baselineSprite,
    id: candidateSprite['id'],
    name: RENAMED_SPRITE,
  })
  assert.equal(
    execution.result.candidateObservations.find(
      (entry) => entry.objectiveId === 'candidate-x-postcondition'
    )?.status,
    'observed'
  )
  assert.equal(execution.result.preservationObservations[0]?.outcome, 'agreed')
  const retained = session.certificates[0]!
  assert.equal(
    retained.certificate.certificateSha256,
    evaluation.certificate.certificateSha256
  )
  const request = port.requests[0]!
  const activatedPlan = request.plan
  const evaluatedRevision = session.revisions.find(
    (revision) =>
      revision.head.revisionId === request.revision.revisionId &&
      revision.head.revisionNumber === request.revision.revisionNumber
  )
  assert.ok(evaluatedRevision)
  const required = aggregateRequiredChangeV1({
    predicates: activatedPlan.requiredRuntimeChanges,
    observations: execution.result.candidateObservations,
    structuralObjectives: structuralObjectiveObservationsV1(
      authority.bound.registration.semanticContract,
      evaluatedRevision.authorization
    ),
    planClass: activatedPlan.planClass,
  })
  const allowed = aggregateAllowedChangeV1({
    baselineDiagnostics: execution.result.baselineDiagnostics,
    candidateDiagnostics: execution.result.candidateDiagnostics,
    allowedNewDiagnosticFingerprints:
      execution.result.allowedNewDiagnosticFingerprints,
    boundedResourceIssueCodes: execution.result.boundedResourceIssueCodes,
    laneStatuses: execution.result.laneStatuses,
  })
  const preservation = aggregatePreservationV1({
    lenses: activatedPlan.preservationLenses,
    observations: execution.result.preservationObservations,
  })
  const aggregate = aggregateEditEvaluationV1({
    required,
    allowed,
    preservation,
    laneStatuses: execution.result.laneStatuses,
    extraLimitations: execution.result.limitations,
  })
  const expectedHashProjection = {
    schemaVersion: 1 as const,
    status: aggregate.status,
    evaluationPlanId: activatedPlan.planId,
    evaluationPlanSha256: activatedPlan.evaluationPlanSha256,
    evaluatedRevision: request.revision,
    evaluatedCandidateByteLength: candidateBytes.byteLength,
    semanticSourceSha256: request.semanticSourceSha256,
    historySha256: request.historySha256,
    changeContractSha256: request.revision.changeContractSha256,
    projectJsonSha256: execution.result.projectJsonSha256,
    requiredChangeResultSha256: required.resultSha256,
    allowedChangeResultSha256: allowed.resultSha256,
    preservationResultSha256: preservation.resultSha256,
    scenarioSetSha256: activatedPlan.scenarioSetSha256,
    seedSetSha256: execution.result.seedSetSha256,
    fixedTimePolicySha256: execution.result.fixedTimePolicySha256,
    observationPlanSetSha256: activatedPlan.observationPlanSetSha256,
    rubricSetSha256: activatedPlan.rubricSetSha256,
    lensPolicySetSha256: activatedPlan.lensPolicySetSha256,
    vmIdentitySha256: execution.result.identity.vmIdentitySha256,
    browserIdentitySha256: execution.result.identity.browserIdentitySha256,
    runtimeIdentitySha256: execution.result.identity.runtimeIdentitySha256,
    pinnedScratchIdentitySha256:
      execution.result.identity.pinnedScratchIdentitySha256,
    buildIdentitySha256: execution.result.identity.buildIdentitySha256,
    executableIdentitySha256:
      execution.result.identity.executableIdentitySha256,
    evidence: execution.result.evidence.map((entry) => entry.binding),
    limitationSetSha256: editEvaluationLimitationSetSha256V1(
      aggregate.limitations
    ),
    gateDispositionSetSha256: editEvaluationGateDispositionSetSha256V1(
      execution.result.laneStatuses
    ),
  }
  assert.deepEqual(retained.certificate.hashProjection, expectedHashProjection)
  assert.equal(
    retained.certificate.certificateSha256,
    semanticHashV1('certificate', expectedHashProjection)
  )
  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-group-g-evaluation',
      reason: 'exact evaluation and replay evidence retained',
      ...expectedHeadRequest(session.head),
    },
    invocation(5)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: authority.bound,
    transactionExecutor: executor,
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedCertificateCount, 1)
  assert.equal(replay.reconstructedExternalObservations, 0)
})

class ControlledClockV1 implements EditClockPort
{
  #now: number

  constructor(now: number)
  {
    this.#now = now
  }

  nowEpochMs(): number
  {
    return this.#now
  }

  advance(milliseconds: number): void
  {
    this.#now += milliseconds
  }
}

class RecordingExternalEvidencePortV1
{
  readonly notifications: EditExternalEvidenceNotificationV1[] = []
  readonly cancellations: Array<{
    readonly evaluationId: string
    readonly reason: string
  }> = []

  async enqueue(
    notification: EditExternalEvidenceNotificationV1
  ): Promise<void>
  {
    this.notifications.push(structuredClone(notification))
  }

  async cancel(evaluationId: string, reason: string): Promise<void>
  {
    this.cancellations.push({ evaluationId, reason })
  }
}

class MutableExternalEvidenceInboxV1
{
  records: EditStagedExternalEvidenceRecordV1[] = []

  async staged(
    evaluationId: string
  ): Promise<readonly EditStagedExternalEvidenceRecordV1[]>
  {
    return structuredClone(
      this.records.filter((record) => record.evaluationId === evaluationId)
    )
  }
}

interface ConfigurableProductionPortOptionsV1
{
  readonly lane: 'officialHeadless' | 'officialBrowser'
  readonly observationCaps?: typeof DEFAULT_RUNTIME_OBSERVATION_CAPS
  readonly beforeDispatch?: (
    request: EditDeterministicEvaluationRequestV1
  ) => Promise<void>
  readonly hardFailure?: Error
  readonly retainedExecution?: EditDeterministicEvaluationExecutionV1
}

class ConfigurableProductionPortV1 implements EditDeterministicEvaluationPort
{
  readonly #delegate: ProductionEditDeterministicEvaluationPortV1
  readonly #beforeDispatch:
    | ((request: EditDeterministicEvaluationRequestV1) => Promise<void>)
    | undefined
  readonly #hardFailure: Error | undefined
  readonly #retainedExecution:
    EditDeterministicEvaluationExecutionV1 | undefined
  readonly requests: EditDeterministicEvaluationRequestV1[] = []
  readonly executions: EditDeterministicEvaluationExecutionV1[] = []

  constructor(options: ConfigurableProductionPortOptionsV1)
  {
    const decoder = Object.freeze({
      decodeRuntimePolicy: () => ({
        cells: [
          {
            lane: options.lane,
            scenarioId: 'rename-scenario',
            observationPlan:
              options.lane === 'officialBrowser'
                ? {
                    schemaVersion: 1 as const,
                    temporal: {
                      firstTick: 0,
                      lastTick: 0,
                      everyTicks: 6,
                      playbackFps: 10,
                      maxFrames: 1,
                      maxBytes: 5 * 1024 * 1024,
                      derivedVideo: false,
                    },
                    cloneCounts: 'none' as const,
                  }
                : defaultObservationPlan(),
            observationCaps:
              options.observationCaps ?? DEFAULT_RUNTIME_OBSERVATION_CAPS,
          },
        ],
        allowedNewDiagnosticFingerprints: [],
      }),
      decodeLensPolicy: () => ({
        schemaVersion: 1 as const,
        id: 'group-g-configurable-final-state',
        required: true,
        appliesTo: 'baseline-candidate' as const,
        kind: 'final-state' as const,
        absoluteNumericTolerance: 0,
      }),
    }) satisfies EditProductionPolicyDecoderV1
    this.#delegate = new ProductionEditDeterministicEvaluationPortV1({
      decoder,
      runnerAvailabilityProbe: {
        runnerAvailabilityV1: () =>
          EVALUATION_LANE_ORDER_V1.map((lane) => ({
            lane,
            availability:
              lane === 'projectPreflight' || lane === options.lane
                ? ('available' as const)
                : ('unavailable' as const),
            availabilityEpoch: 1,
          })),
      },
    })
    this.#beforeDispatch = options.beforeDispatch
    this.#hardFailure = options.hardFailure
    this.#retainedExecution = options.retainedExecution
  }

  runnerAvailabilityV1(): readonly RunnerAvailabilityV1[]
  {
    return this.#delegate.runnerAvailabilityV1()
  }

  async evaluate(
    request: EditDeterministicEvaluationRequestV1
  ): Promise<EditDeterministicEvaluationExecutionV1>
  {
    this.requests.push(structuredClone(request))
    await this.#beforeDispatch?.(request)
    if (this.#hardFailure !== undefined) throw this.#hardFailure
    const execution =
      this.#retainedExecution === undefined
        ? await this.#delegate.evaluate(request)
        : structuredClone(this.#retainedExecution)
    this.executions.push(structuredClone(execution))
    return execution
  }
}

interface PreparedRenameSessionV1
{
  readonly authority: RenameAuthority
  readonly executor: ProductionTransactionExecutorV1
  readonly external: RecordingExternalEvidencePortV1 | undefined
  readonly inbox: MutableExternalEvidenceInboxV1 | undefined
  readonly port: ConfigurableProductionPortV1
  readonly quotaReleases: string[]
  readonly quotaReservations: Array<{
    readonly reservationId: string
    readonly byteLength: number
  }>
  readonly quotaSettlements: Array<{
    readonly reservationId: string
    readonly actualByteLength: number
  }>
  readonly session: EditSessionV1
  readonly sourceBytes: Uint8Array
  readonly sourceProject: ProjectIR
  readonly store: EditArtifactStorePort
}

interface PrepareRenameOptionsV1
{
  readonly externalPredicateCount?: 0 | 1 | 2
  readonly entropySeed?: number
  readonly clock?: EditClockPort
  readonly requestSuffix?: string
  readonly hostTag?: string
  readonly evaluationRunLimit?: number
  readonly observationCaps?: typeof DEFAULT_RUNTIME_OBSERVATION_CAPS
  readonly beforeDispatch?: ConfigurableProductionPortOptionsV1['beforeDispatch']
  readonly hardFailure?: Error
  readonly retainedExecution?: EditDeterministicEvaluationExecutionV1
  readonly listItemCount?: number
  readonly failPreparedWrite?: boolean
  readonly failQuotaAfterPersist?: boolean
  readonly quotaResponseMismatch?: 'reservationId' | 'reservedBytes'
}

async function prepareRenameSessionV1(
  t: test.TestContext,
  options: PrepareRenameOptionsV1 = {}
): Promise<PreparedRenameSessionV1>
{
  const suffix = options.requestSuffix ?? 'default'
  const hostTag = options.hostTag ?? suffix
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
      '<rect width="20" height="20" fill="#4c97ff"></rect></svg>',
    'utf8'
  )
  const assetId = createHash('md5').update(svg).digest('hex')
  const assetPath = `${assetId}.svg`
  sourceProject.assets.splice(0, sourceProject.assets.length, {
    path: assetPath,
    bytes: svg,
  })
  for (const target of sourceProject.json.targets)
    for (const costume of target.costumes)
    {
      costume.assetId = assetId
      costume.md5ext = assetPath
    }
  sourceProject.json.targets[0]!.variables['stageWitnessId'] = [
    'stage witness',
    1,
  ]
  const listItemCount = options.listItemCount ?? 0
  if (listItemCount > 0)
  {
    const stage = sourceProject.json.targets[0]!
    stage.lists ??= {}
    stage.lists['boundedListId'] = [
      'bounded list',
      Array.from({ length: listItemCount }, (_, index) => index),
    ]
  }
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const authority = await renameAuthority(sourceBytes, sourceProject, {
    externalPredicateCount: options.externalPredicateCount,
  })
  let evaluationQuotaFaultArmed = false
  let evaluationQuotaMismatchArmed = false
  const store = createEditArtifactStoreHostAdapter(tempRoot(t), {
    maxBytes: 2 * 1024 * 1024 * 1024,
    faultHook: (() =>
    {
      return (context) =>
      {
        if (
          options.failPreparedWrite === true &&
          context.point === 'immutable.beforeTempOpen' &&
          context.key?.endsWith('/000000-prepared.json')
        )
          throw new Error('injected pre-preparation persistence failure')
        if (
          evaluationQuotaFaultArmed &&
          context.point === 'quota.afterPersist'
        )
        {
          evaluationQuotaFaultArmed = false
          throw new Error('injected persisted quota response loss')
        }
      }
    })(),
  })
  const quotaReservations: Array<{
    readonly reservationId: string
    readonly byteLength: number
  }> = []
  const quotaReleases: string[] = []
  const quotaSettlements: Array<{
    readonly reservationId: string
    readonly actualByteLength: number
  }> = []
  const reserveQuota = store.reserveQuota.bind(store)
  const releaseQuota = store.releaseQuota.bind(store)
  const settleQuota = store.settleQuota.bind(store)
  store.reserveQuota = async (reservationId, byteLength) =>
  {
    quotaReservations.push({ reservationId, byteLength })
    const reservation = await reserveQuota(reservationId, byteLength)
    const mismatch = evaluationQuotaMismatchArmed
      ? options.quotaResponseMismatch
      : undefined
    evaluationQuotaMismatchArmed = false
    return mismatch === 'reservationId'
      ? {
          ...reservation,
          reservationId: `${reservation.reservationId}-mismatch`,
        }
      : mismatch === 'reservedBytes'
        ? { ...reservation, reservedBytes: reservation.reservedBytes + 1 }
        : reservation
  }
  store.releaseQuota = async (reservationId) =>
  {
    quotaReleases.push(reservationId)
    return releaseQuota(reservationId)
  }
  store.settleQuota = async (reservationId, actualByteLength) =>
  {
    quotaSettlements.push({ reservationId, actualByteLength })
    return settleQuota(reservationId, actualByteLength)
  }
  const external =
    options.externalPredicateCount === undefined ||
    options.externalPredicateCount === 0
      ? undefined
      : new RecordingExternalEvidencePortV1()
  const inbox =
    external === undefined ? undefined : new MutableExternalEvidenceInboxV1()
  const port = new ConfigurableProductionPortV1({
    lane: external === undefined ? 'officialHeadless' : 'officialBrowser',
    observationCaps: options.observationCaps,
    beforeDispatch: options.beforeDispatch,
    hardFailure: options.hardFailure,
    retainedExecution: options.retainedExecution,
  })
  const executor = new ProductionTransactionExecutorV1([
    new TargetProductionOperationDispatcherV1(),
  ])
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: authority.registry,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: options.clock ?? deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(options.entropySeed ?? 37),
      handleSecret: new Uint8Array(32).fill(0x59),
      ...(options.evaluationRunLimit === undefined
        ? {}
        : { policy: { evaluationRunLimit: options.evaluationRunLimit } }),
      evaluationPorts: {
        deterministic: port,
        ...(external === undefined ? {} : { external, inbox }),
        externalEvidenceDeadlineMs: 100,
      },
    },
    executor
  )
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: `begin-${suffix}`,
      baseline: {
        kind: 'projectSession',
        projectSessionId: `group-g-${suffix}`,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: authority.bound.registration.registrationId,
      expectedSemanticContractSha256:
        authority.bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: `${hostTag}.sb3`,
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId: `group-g-${suffix}`,
        selectedDisplayName: `${hostTag}.sb3`,
        canonicalRealpath: `/virtual/${hostTag}.sb3`,
        device: `device-${hostTag}`,
        inode: `inode-${hostTag}`,
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: String(1_753_056_000_000_000_000n),
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(100 + (options.entropySeed ?? 0))
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const target = inspection.items.find(
    (item) =>
      item.entityKind === 'target' &&
      item.serializedTargetOrdinal === authority.targetIndex
  )
  assert.ok(target)
  const index = buildSemanticReferenceIndex(sourceProject)
  const inbound = targetInboundReferenceSetV1(
    sourceProject,
    index,
    authority.targetIndex
  )
  const activation = targetProspectiveNameActivationV1(
    sourceProject,
    index,
    RENAMED_SPRITE
  )
  const provisional: SemanticEditOperationV1 = {
    kind: 'target.renameSprite',
    opId: 'rename-evaluated-sprite',
    target: targetHandle(target),
    expectedName: targetExpectedStringIdentityV1('Sprite1'),
    newName: RENAMED_SPRITE,
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedPlanningFactSetSha256: HASH_A,
  }
  const operation: SemanticEditOperationV1 = {
    ...provisional,
    expectedPlanningFactSetSha256: productionTargetPlanningFactSetSha256V1(
      sourceProject,
      provisional,
      authority.targetIndex,
      session.revisions[0]!.activeLineage as never
    ),
  }
  const preview = await session.preview(
    {
      requestId: `preview-${suffix}`,
      expectedHead: session.head,
      canonicalTransaction: {
        schemaVersion: 1,
        expected: planningHead(session.head, session.sessionId),
        operations: [operation],
      },
    },
    invocation(200 + (options.entropySeed ?? 0))
  )
  await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: `apply-${suffix}`,
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(300 + (options.entropySeed ?? 0))
  )
  evaluationQuotaFaultArmed = options.failQuotaAfterPersist === true
  evaluationQuotaMismatchArmed = options.quotaResponseMismatch !== undefined
  return {
    authority,
    executor,
    external,
    inbox,
    port,
    quotaReleases,
    quotaReservations,
    quotaSettlements,
    session,
    sourceBytes,
    sourceProject,
    store,
  }
}

function startEvaluationRequestV1(session: EditSessionV1, requestId: string)
{
  return {
    schemaVersion: 1 as const,
    action: 'start' as const,
    sessionId: session.sessionId,
    requestId,
    evaluationPlanId: 'export-plan',
    ...expectedHeadRequest(session.head),
  }
}

function finalizeEvaluationRequestV1(
  session: EditSessionV1,
  awaiting: Awaited<ReturnType<EditSessionV1['evaluate']>>,
  requestId: string
)
{
  return {
    schemaVersion: 1 as const,
    action: 'finalize' as const,
    sessionId: session.sessionId,
    requestId,
    evaluationId: awaiting.evaluationId,
    expectedEvaluationAttemptSha256: awaiting.evaluationAttemptSha256,
    evaluatedRevision: awaiting.evaluatedRevision,
    expectedCurrentHead: {
      revisionId: session.head.revisionId,
      revisionNumber: session.head.revisionNumber,
      candidateSha256: session.head.candidateSha256,
    },
  }
}

function stagedRecordV1(input: {
  readonly evaluationId: string
  readonly request: EditDeterministicEvaluationExecutionV1['result']['externalRequests'][number]
  readonly recordId: string
  readonly satisfied?: boolean
  readonly contentSha256?: string
  readonly judgmentSha256?: string
  readonly locator?: string
  readonly capturedAtEpochMs?: number
}): EditStagedExternalEvidenceRecordV1
{
  const satisfied = input.satisfied ?? true
  const contentSha256 = input.contentSha256 ?? HASH_C
  const judgmentSha256 = input.judgmentSha256 ?? HASH_D
  const resultSha256 = editStagedExternalEvidenceResultSha256V1({
    evaluationId: input.evaluationId,
    requestArtifactId: input.request.requestArtifactId,
    objectiveId: input.request.objectiveId,
    lane: input.request.lane,
    requestSha256: input.request.requestSha256,
    contentSha256,
    satisfied,
    judgmentSha256,
  })
  return {
    recordId: input.recordId,
    evaluationId: input.evaluationId,
    requestArtifactId: input.request.requestArtifactId,
    objectiveId: input.request.objectiveId,
    lane: input.request.lane,
    requestSha256: input.request.requestSha256,
    resultSha256,
    contentSha256,
    satisfied,
    judgmentSha256,
    provenance: {
      schemaVersion: 1,
      evaluationId: input.evaluationId,
      hostRecordId: input.recordId,
      taskId: `task-${input.recordId}`,
      contentSha256,
      requestSha256: input.request.requestSha256,
      resultSha256,
      absoluteLocator: input.locator ?? `/runs/${input.recordId}.json`,
      capturedAtEpochMs: input.capturedAtEpochMs ?? 1_753_056_000_500,
      auditRecordSha256: HASH_E,
    },
  }
}

async function retainedEvaluationArtifactV1(
  store: EditArtifactStorePort,
  suffix: string
): Promise<Record<string, unknown>>
{
  const entries = await store.listImmutable('sessions')
  const entry = entries.find((candidate) => candidate.key.endsWith(suffix))
  assert.ok(entry, `retained evaluation artifact ${suffix} is missing`)
  return JSON.parse(
    new TextDecoder().decode(await store.readImmutable(entry.key))
  ) as Record<string, unknown>
}

async function retainedReleasedQuotaProofV1(
  store: EditArtifactStorePort
): Promise<Record<string, unknown> | undefined>
{
  const entries = (await store.listImmutable('sessions')).filter((entry) =>
    entry.key.endsWith('/result.json')
  )
  const retained = await Promise.all(
    entries.map(
      async (entry) =>
        JSON.parse(
          new TextDecoder().decode(await store.readImmutable(entry.key))
        ) as Record<string, unknown>
    )
  )
  return retained
    .map((entry) => entry['result'] as Record<string, unknown> | undefined)
    .find((result) => result?.['releasedEvaluationQuota'] !== undefined)?.[
    'releasedEvaluationQuota'
  ] as Record<string, unknown> | undefined
}

async function evaluatePreparedRenameV1(
  prepared: PreparedRenameSessionV1,
  requestId: string,
  invocationSequence: number
)
{
  return prepared.session.evaluate(
    startEvaluationRequestV1(prepared.session, requestId),
    invocation(invocationSequence)
  )
}

test('Group G certificate semantics ignore host IDs while stale and non-passed certificates block export', async (t) =>
{
  const first = await prepareRenameSessionV1(t, {
    entropySeed: 41,
    requestSuffix: 'semantic-first',
    clock: deterministicClock(1_753_056_100_000),
  })
  const firstResult = await evaluatePreparedRenameV1(
    first,
    'evaluate-semantic-first',
    401
  )
  const second = await prepareRenameSessionV1(t, {
    entropySeed: 97,
    requestSuffix: 'semantic-second',
    clock: deterministicClock(1_753_056_900_000),
    retainedExecution: first.port.executions[0],
  })
  const secondResult = await evaluatePreparedRenameV1(
    second,
    'evaluate-semantic-second',
    402
  )
  assert.equal(firstResult.certificate.state, 'present')
  assert.equal(secondResult.certificate.state, 'present')
  if (
    firstResult.certificate.state !== 'present' ||
    secondResult.certificate.state !== 'present'
  )
    assert.fail('deterministic evaluations retained no certificate')
  assert.equal(firstResult.certificate.status, 'passed')
  assert.equal(secondResult.certificate.status, 'passed')
  assert.deepEqual(
    first.session.certificates[0]!.certificate.hashProjection,
    second.session.certificates[0]!.certificate.hashProjection
  )
  assert.equal(
    firstResult.certificate.certificateSha256,
    secondResult.certificate.certificateSha256
  )
  assert.notEqual(firstResult.evaluationId, secondResult.evaluationId)
  assert.notEqual(first.session.sessionId, second.session.sessionId)
  assert.equal(first.port.requests.length, 1)
  assert.equal(second.port.requests.length, 1)
  assert.deepEqual(
    first.port.requests[0]!.candidateBytes,
    second.port.requests[0]!.candidateBytes
  )

  const passed = first.session.certificates[0]!
  const refusalByStatus = {
    failed: 'edit.evaluation_failed',
    inconclusive: 'edit.evaluation_inconclusive',
    unavailable: 'edit.evaluation_unavailable',
  } as const
  for (const [status, refusalCode] of Object.entries(refusalByStatus))
  {
    const retained = {
      ...passed,
      certificate: {
        ...passed.certificate,
        hashProjection: {
          ...passed.certificate.hashProjection,
          status,
        },
      },
    } as typeof passed
    const exportability = evaluateExportabilityV1({
      retained: [retained],
      head: first.session.head,
      exportRequiredPlanId: 'export-plan',
    })
    assert.equal(exportability.exportable, false)
    assert.equal(exportability.refusalCode, refusalCode)
  }

  const appliedRevisionId = first.session.revisions[1]!.head.revisionId
  await first.session.undo(
    {
      schemaVersion: 1,
      sessionId: first.session.sessionId,
      requestId: 'undo-after-certificate',
      ...expectedHeadRequest(first.session.head),
      expectedUndoableApplyRevisionId: appliedRevisionId,
    },
    invocation(403)
  )
  assert.equal(first.session.certificates.length, 1)
  assert.equal(first.session.exportability().exportable, false)
  assert.equal(
    first.session.exportability().refusalCode,
    'edit.stale_certificate'
  )
  const reevaluated = await evaluatePreparedRenameV1(
    first,
    'reevaluate-after-head-change',
    404
  )
  assert.equal(reevaluated.certificate.state, 'present')
  if (reevaluated.certificate.state !== 'present')
    assert.fail('re-evaluation retained no certificate')
  assert.notEqual(reevaluated.certificate.status, 'passed')
  assert.equal(first.session.certificates.length, 2)
  assert.equal(first.session.exportability().exportable, false)
})

test('Group G prepares and reserves before dispatch, charges one run, and reconciles quota for replay', async (t) =>
{
  const prePrepared = await prepareRenameSessionV1(t, {
    entropySeed: 47,
    requestSuffix: 'quota-pre-prepared-failure',
    failPreparedWrite: true,
  })
  const reservationCountBeforeFailure = prePrepared.quotaReservations.length
  const releaseCountBeforeFailure = prePrepared.quotaReleases.length
  const settlementCountBeforeFailure = prePrepared.quotaSettlements.length
  await assert.rejects(
    evaluatePreparedRenameV1(prePrepared, 'evaluate-pre-prepared-failure', 500),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.internal_invariant'
  )
  assert.equal(prePrepared.port.requests.length, 0)
  assert.equal(
    prePrepared.quotaReservations.length,
    reservationCountBeforeFailure + 1
  )
  const failedReservation = prePrepared.quotaReservations.at(-1)!
  assert.deepEqual(prePrepared.quotaReleases.slice(releaseCountBeforeFailure), [
    failedReservation.reservationId,
  ])
  assert.deepEqual(
    prePrepared.quotaSettlements.slice(settlementCountBeforeFailure),
    []
  )
  assert.equal(
    (await prePrepared.store.quotaOutcome(failedReservation.reservationId))
      .state,
    'released'
  )
  const releasedQuotaProof = await retainedReleasedQuotaProofV1(
    prePrepared.store
  )
  assert.deepEqual(releasedQuotaProof, {
    schemaVersion: 1,
    evaluationSequence: 0,
    evaluationAttemptSha256: releasedQuotaProof?.['evaluationAttemptSha256'],
    reservationId: failedReservation.reservationId,
    reservedBytes: failedReservation.byteLength,
  })
  assert.equal(typeof releasedQuotaProof?.['evaluationAttemptSha256'], 'string')
  await prePrepared.session.close(
    {
      schemaVersion: 1,
      sessionId: prePrepared.session.sessionId,
      requestId: 'close-pre-prepared-failure',
      reason: 'retain released pre-prepared quota proof',
      ...expectedHeadRequest(prePrepared.session.head),
    },
    invocation(500)
  )
  const prePreparedReplay = await verifyEditSessionReplayV1({
    artifactStore: prePrepared.store,
    sessionKey: prePrepared.session.manifest.sessionKey,
    boundChangeContract: prePrepared.authority.bound,
    transactionExecutor: prePrepared.executor,
  })
  assert.equal(
    prePreparedReplay.ok,
    true,
    JSON.stringify(prePreparedReplay.failures)
  )

  const persistedQuotaFault = await prepareRenameSessionV1(t, {
    entropySeed: 49,
    requestSuffix: 'quota-persisted-response-loss',
    failQuotaAfterPersist: true,
  })
  const persistedReservationsBefore =
    persistedQuotaFault.quotaReservations.length
  await assert.rejects(
    evaluatePreparedRenameV1(
      persistedQuotaFault,
      'evaluate-persisted-response-loss',
      506
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.internal_invariant'
  )
  assert.equal(persistedQuotaFault.port.requests.length, 0)
  assert.equal(
    persistedQuotaFault.quotaReservations.length,
    persistedReservationsBefore + 1
  )
  const persistedReservation = persistedQuotaFault.quotaReservations.at(-1)!
  assert.deepEqual(
    await persistedQuotaFault.store.quotaOutcome(
      persistedReservation.reservationId
    ),
    {
      state: 'released',
      reservationId: persistedReservation.reservationId,
      reservedBytes: persistedReservation.byteLength,
      actualBytes: 0,
    }
  )
  assert.equal(
    (await persistedQuotaFault.store.listImmutable('sessions')).some((entry) =>
      entry.key.endsWith('/000000-prepared.json')
    ),
    false
  )
  assert.equal(
    (await retainedReleasedQuotaProofV1(persistedQuotaFault.store))?.[
      'reservationId'
    ],
    persistedReservation.reservationId
  )
  await persistedQuotaFault.session.close(
    {
      schemaVersion: 1,
      sessionId: persistedQuotaFault.session.sessionId,
      requestId: 'close-persisted-response-loss',
      reason: 'retain persisted quota response-loss proof',
      ...expectedHeadRequest(persistedQuotaFault.session.head),
    },
    invocation(507)
  )
  const persistedQuotaReplay = await verifyEditSessionReplayV1({
    artifactStore: persistedQuotaFault.store,
    sessionKey: persistedQuotaFault.session.manifest.sessionKey,
    boundChangeContract: persistedQuotaFault.authority.bound,
    transactionExecutor: persistedQuotaFault.executor,
  })
  assert.equal(
    persistedQuotaReplay.ok,
    true,
    JSON.stringify(persistedQuotaReplay.failures)
  )

  for (const [index, mismatch] of (
    ['reservationId', 'reservedBytes'] as const
  ).entries())
  {
    const mismatchedQuota = await prepareRenameSessionV1(t, {
      entropySeed: 50 + index,
      requestSuffix: `quota-response-${mismatch}-mismatch`,
      quotaResponseMismatch: mismatch,
    })
    const mismatchedReservationsBefore =
      mismatchedQuota.quotaReservations.length
    await assert.rejects(
      evaluatePreparedRenameV1(
        mismatchedQuota,
        `evaluate-quota-response-${mismatch}-mismatch`,
        508 + index
      ),
      (error) =>
        error instanceof EditSessionErrorV1 &&
        error.code === 'edit.internal_invariant'
    )
    assert.equal(mismatchedQuota.port.requests.length, 0)
    assert.equal(
      mismatchedQuota.quotaReservations.length,
      mismatchedReservationsBefore + 1
    )
    const exact = mismatchedQuota.quotaReservations.at(-1)!
    assert.deepEqual(
      await mismatchedQuota.store.quotaOutcome(exact.reservationId),
      {
        state: 'released',
        reservationId: exact.reservationId,
        reservedBytes: exact.byteLength,
        actualBytes: 0,
      }
    )
    assert.equal(
      (await mismatchedQuota.store.listImmutable('sessions')).some((entry) =>
        entry.key.endsWith('/000000-prepared.json')
      ),
      false
    )
    assert.equal(
      (await retainedReleasedQuotaProofV1(mismatchedQuota.store))?.[
        'reservationId'
      ],
      exact.reservationId
    )
    await mismatchedQuota.session.close(
      {
        schemaVersion: 1,
        sessionId: mismatchedQuota.session.sessionId,
        requestId: `close-quota-response-${mismatch}-mismatch`,
        reason: 'retain mismatched quota response proof',
        ...expectedHeadRequest(mismatchedQuota.session.head),
      },
      invocation(510 + index)
    )
    const mismatchedReplay = await verifyEditSessionReplayV1({
      artifactStore: mismatchedQuota.store,
      sessionKey: mismatchedQuota.session.manifest.sessionKey,
      boundChangeContract: mismatchedQuota.authority.bound,
      transactionExecutor: mismatchedQuota.executor,
    })
    assert.equal(
      mismatchedReplay.ok,
      true,
      JSON.stringify(mismatchedReplay.failures)
    )
  }

  let preparation: Record<string, unknown> | undefined
  let activeQuota:
    Awaited<ReturnType<EditArtifactStorePort['quotaOutcome']>> | undefined
  const prepared = await prepareRenameSessionV1(t, {
    entropySeed: 53,
    requestSuffix: 'quota-success',
    evaluationRunLimit: 1,
    beforeDispatch: async (request) =>
    {
      assert.ok(prepared)
      preparation = await retainedEvaluationArtifactV1(
        prepared.store,
        '/000000-prepared.json'
      )
      assert.equal(typeof preparation['evaluationPlanSha256'], 'string')
      assert.equal(typeof preparation['matrixSha256'], 'string')
      assert.equal(preparation['sequence'], 0)
      assert.equal(typeof preparation['reservedBytes'], 'number')
      const reservation = reserveEditEvaluationMatrixV1({
        laneRequirements: request.plan.plan.laneRequirements,
        scenarios: request.plan.scenarioPolicySha256s.map(
          (semanticPolicySha256) =>
          {
            const scenario = request.policies.find(
              (policy) => policy.binding.semanticSha256 === semanticPolicySha256
            )?.scenarioPolicy
            assert.ok(scenario)
            return {
              scenarioId: scenario.scenarioId,
              applicability: scenario.applicability,
              semanticPolicySha256,
            }
          }
        ),
        artifactSides: ['baseline', 'candidate'],
        limitOverrides: { ...request.plan.resourceLimitOverrides },
      })
      assert.equal(reservation.status, 'reserved')
      if (reservation.status !== 'reserved')
        assert.fail('prospective matrix reservation was refused')
      assert.equal(
        preparation['reservedBytes'],
        reservation.reservedArtifactBytesTotal
      )
      assert.equal(preparation['matrixSha256'], reservation.matrixSha256)
      activeQuota = await prepared.store.quotaOutcome(
        preparation['reservationId'] as string
      )
      assert.equal(activeQuota.state, 'active')
      assert.equal(
        activeQuota.state === 'active' ? activeQuota.reservedBytes : -1,
        preparation['reservedBytes']
      )
    },
  })
  const request = startEvaluationRequestV1(
    prepared.session,
    'evaluate-one-run-slot'
  )
  const result = await prepared.session.evaluate(request, invocation(501))
  assert.equal(result.certificate.state, 'present')
  assert.ok(preparation)
  const reservationId = preparation['reservationId'] as string
  const terminalQuota = await prepared.store.quotaOutcome(reservationId)
  assert.equal(terminalQuota.state, 'settled')
  if (terminalQuota.state !== 'settled') assert.fail('quota was not settled')
  assert.equal(
    terminalQuota.reservedBytes,
    activeQuota?.state === 'active' ? activeQuota.reservedBytes : -1
  )
  assert.ok(terminalQuota.actualBytes > 0)
  assert.ok(terminalQuota.actualBytes <= terminalQuota.reservedBytes)

  const retry = await prepared.session.evaluate(request, invocation(502))
  assert.deepEqual(retry, result)
  assert.equal(prepared.port.requests.length, 1)
  const rediscovered = prepared.session.lookupIdempotentOutcomeV1({
    toolName: 'edit_evaluate',
    requestId: request.requestId,
    principalSha256: HASH_E,
  })
  assert.ok(rediscovered)
  assert.equal(rediscovered.classification, 'completed')
  assert.match(rediscovered.retainedOutcomeSha256 ?? '', /^[0-9a-f]{64}$/u)
  assert.equal(rediscovered.requestId, request.requestId)
  assert.equal(rediscovered.toolName, 'edit_evaluate')
  await assert.rejects(
    prepared.session.evaluate(
      startEvaluationRequestV1(prepared.session, 'evaluate-second-run-slot'),
      invocation(503)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.session_budget_exceeded'
  )
  assert.equal(prepared.port.requests.length, 1)
  await prepared.session.close(
    {
      schemaVersion: 1,
      sessionId: prepared.session.sessionId,
      requestId: 'close-after-quota-success',
      reason: 'retain quota and replay proof',
      ...expectedHeadRequest(prepared.session.head),
    },
    invocation(504)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: prepared.store,
    sessionKey: prepared.session.manifest.sessionKey,
    boundChangeContract: prepared.authority.bound,
    transactionExecutor: prepared.executor,
  })
  assert.equal(replay.ok, true, JSON.stringify(replay.failures))
  assert.deepEqual(
    await prepared.store.quotaOutcome(reservationId),
    terminalQuota
  )

  const failed = await prepareRenameSessionV1(t, {
    entropySeed: 59,
    requestSuffix: 'quota-hard-failure',
    hardFailure: new Error('injected deterministic lane crash'),
    beforeDispatch: async () =>
    {
      assert.ok(failed)
      const retained = await retainedEvaluationArtifactV1(
        failed.store,
        '/000000-prepared.json'
      )
      assert.equal(retained['sequence'], 0)
    },
  })
  await assert.rejects(
    evaluatePreparedRenameV1(failed, 'evaluate-hard-failure', 505),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.recovery_required' &&
      error.committed
  )
  assert.equal(failed.port.requests.length, 1)
  assert.equal(failed.session.status().state, 'recovery-required')
  const failedPreparation = await retainedEvaluationArtifactV1(
    failed.store,
    '/000000-prepared.json'
  )
  const reconciled = await failed.store.quotaOutcome(
    failedPreparation['reservationId'] as string
  )
  assert.equal(reconciled.state, 'active')
})

test('Group G observation overflow remains bounded, localized, and non-authorizing', async (t) =>
{
  const caps = Object.freeze({
    ...DEFAULT_RUNTIME_OBSERVATION_CAPS,
    listItemsPerList: 1,
    scalarSlotsPerSnapshot: 64,
  })
  const prepared = await prepareRenameSessionV1(t, {
    entropySeed: 61,
    requestSuffix: 'bounded-observation',
    listItemCount: 2,
    observationCaps: caps,
  })
  const result = await evaluatePreparedRenameV1(
    prepared,
    'evaluate-bounded-observation',
    601
  )
  assert.equal(result.certificate.state, 'present')
  if (result.certificate.state !== 'present')
    assert.fail('bounded evaluation retained no certificate')
  const execution = prepared.port.executions[0]!
  assert.equal(
    result.certificate.status,
    'inconclusive',
    JSON.stringify({
      laneStatuses: execution.result.laneStatuses,
      candidateObservations: execution.result.candidateObservations,
      preservationObservations: execution.result.preservationObservations,
      boundedResourceIssueCodes: execution.result.boundedResourceIssueCodes,
      limitations: execution.result.limitations,
    })
  )
  assert.equal(prepared.session.exportability().exportable, false)
  assert.equal(
    prepared.session.exportability().refusalCode,
    'edit.evaluation_inconclusive'
  )
  assert.deepEqual(execution.result.boundedResourceIssueCodes, [
    'runner.observation_resource_exceeded',
  ])
  assert.equal(
    execution.result.candidateObservations.find(
      (entry) => entry.objectiveId === 'candidate-x-postcondition'
    )?.status,
    'inconclusive'
  )
  assert.equal(
    execution.result.preservationObservations[0]?.outcome,
    'inconclusive'
  )
  assert.ok(
    execution.result.evidence.some(
      (entry) => entry.binding.evidenceKind === 'projectPreflight'
    )
  )
  const refusedTraces = execution.evidencePayloads.filter(
    (entry) => entry.evidenceKind === 'runtimeTrace'
  )
  assert.ok(refusedTraces.length > 0)
  for (const trace of refusedTraces)
  {
    const retained = new TextDecoder().decode(trace.bytes)
    assert.equal(
      retained.includes('runner.observation_resource_exceeded'),
      true,
      retained
    )
    assert.equal(retained.includes('"status":"observed"'), false, retained)
  }
})

test('Group G external evidence is a durable two-action lifecycle with exact binding and replay', async (t) =>
{
  const clock = new ControlledClockV1(1_753_057_000_000)
  const prepared = await prepareRenameSessionV1(t, {
    externalPredicateCount: 1,
    entropySeed: 71,
    requestSuffix: 'external-lifecycle',
    clock,
  })
  assert.ok(prepared.external)
  assert.ok(prepared.inbox)
  const startRequest = startEvaluationRequestV1(
    prepared.session,
    'start-external-lifecycle'
  )
  const eventsBefore = prepared.session.events.length
  const awaiting = await prepared.session.evaluate(
    startRequest,
    invocation(701)
  )
  assert.equal(awaiting.phase, 'awaitingExternalEvidence')
  assert.deepEqual(awaiting.certificate, { state: 'absent' })
  assert.equal(awaiting.requiredHostAction.kind, 'stageExternalEvidence')
  assert.equal(prepared.port.requests.length, 1)
  assert.equal(prepared.port.executions.length, 1)
  assert.equal(prepared.session.events.length, eventsBefore + 1)
  assert.equal(
    prepared.session.events.at(-1)?.projection.eventKind,
    'evaluation-recorded'
  )
  const stableRetry = await prepared.session.evaluate(
    startRequest,
    invocation(702)
  )
  assert.deepEqual(stableRetry, awaiting)
  assert.equal(prepared.port.requests.length, 1)

  const status = prepared.session.status()
  assert.equal(status.awaitingEvaluations.length, 1)
  assert.deepEqual(
    status.awaitingEvaluations[0]?.requiredHostAction,
    awaiting.requiredHostAction
  )
  assert.equal(status.exportReady, false)
  assert.equal(
    status.awaitingEvaluations[0]?.evaluationAttemptSha256,
    awaiting.evaluationAttemptSha256
  )
  const preparation = await retainedEvaluationArtifactV1(
    prepared.store,
    '/000000-prepared.json'
  )
  const reservationId = preparation['reservationId'] as string
  assert.equal(
    (await prepared.store.quotaOutcome(reservationId)).state,
    'active'
  )
  await assert.rejects(
    prepared.session.evaluate(
      finalizeEvaluationRequestV1(
        prepared.session,
        awaiting,
        'finalize-before-staging'
      ),
      invocation(703)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.pending_external_evidence'
  )
  assert.equal(prepared.session.status().awaitingEvaluations.length, 1)

  const issued = prepared.port.executions[0]!.result.externalRequests
  assert.equal(issued.length, 1)
  const valid = stagedRecordV1({
    evaluationId: awaiting.evaluationId,
    request: issued[0]!,
    recordId: 'external-valid',
  })
  const mismatchedResult = structuredClone(valid)
  ;(mismatchedResult as { resultSha256: string }).resultSha256 = HASH_A
  ;(mismatchedResult.provenance as { resultSha256: string }).resultSha256 =
    HASH_A
  prepared.inbox.records = [mismatchedResult]
  await assert.rejects(
    prepared.session.evaluate(
      finalizeEvaluationRequestV1(
        prepared.session,
        awaiting,
        'finalize-mismatched-result'
      ),
      invocation(704)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.fingerprint_mismatch'
  )

  const changedContent = structuredClone(valid)
  ;(changedContent as { contentSha256: string }).contentSha256 = HASH_B
  prepared.inbox.records = [changedContent]
  await assert.rejects(
    prepared.session.evaluate(
      finalizeEvaluationRequestV1(
        prepared.session,
        awaiting,
        'finalize-changed-content'
      ),
      invocation(705)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.fingerprint_mismatch'
  )

  const wrongPredicate = structuredClone(valid)
  ;(wrongPredicate as { objectiveId: string }).objectiveId = 'wrong-predicate'
  ;(wrongPredicate as { resultSha256: string }).resultSha256 =
    editStagedExternalEvidenceResultSha256V1(wrongPredicate)
  ;(wrongPredicate.provenance as { resultSha256: string }).resultSha256 =
    wrongPredicate.resultSha256
  prepared.inbox.records = [wrongPredicate]
  await assert.rejects(
    prepared.session.evaluate(
      finalizeEvaluationRequestV1(
        prepared.session,
        awaiting,
        'finalize-wrong-predicate'
      ),
      invocation(706)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.fingerprint_mismatch'
  )

  const duplicate = structuredClone(valid)
  ;(duplicate as { recordId: string }).recordId = 'external-duplicate'
  ;(duplicate.provenance as { hostRecordId: string }).hostRecordId =
    duplicate.recordId
  prepared.inbox.records = [valid, duplicate]
  await assert.rejects(
    prepared.session.evaluate(
      finalizeEvaluationRequestV1(
        prepared.session,
        awaiting,
        'finalize-duplicate-record'
      ),
      invocation(707)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.fingerprint_mismatch'
  )

  prepared.inbox.records = [valid]
  const terminalEventsBefore = prepared.session.events.length
  const completed = await prepared.session.evaluate(
    finalizeEvaluationRequestV1(
      prepared.session,
      awaiting,
      'finalize-external-valid'
    ),
    invocation(708)
  )
  const runtimeTraceRows = prepared.port.executions[0]!.evidencePayloads.filter(
    (payload) => payload.evidenceKind === 'runtimeTrace'
  ).map((payload) =>
  {
    const projection = JSON.parse(new TextDecoder().decode(payload.bytes))
    return {
      matrix: projection['matrix'],
      traceOk: projection['traceOk'],
      issues: projection['issues'],
      drive: projection['drive'],
      lineage: projection['lineage'],
      runtimeIdentityFacet: projection['runtimeIdentityFacet'],
    }
  })
  assert.equal(
    completed.phase,
    'completed',
    JSON.stringify({
      laneStatuses: prepared.port.executions[0]!.result.laneStatuses,
      preservation:
        prepared.port.executions[0]!.result.preservationObservations,
      limitations: prepared.port.executions[0]!.result.limitations,
      runtimeTraceRows,
    })
  )
  assert.equal(completed.certificate.state, 'present')
  if (completed.certificate.state !== 'present')
    assert.fail('external evidence produced no certificate')
  assert.equal(completed.certificate.status, 'passed')
  assert.equal(prepared.session.events.length, terminalEventsBefore + 1)
  assert.equal(prepared.session.status().awaitingEvaluations.length, 0)
  assert.equal(prepared.session.exportability().exportable, true)
  const terminalQuota = await prepared.store.quotaOutcome(reservationId)
  assert.equal(terminalQuota.state, 'settled')
  assert.ok(completed.evidenceContent.hashes.includes(valid.contentSha256))
  const binding =
    prepared.session.certificates[0]!.certificate.hashProjection.evidence.find(
      (entry) => entry.evidenceKind === 'nativeAgent'
    )
  assert.deepEqual(binding, {
    evidenceKind: 'nativeAgent',
    lane: valid.lane,
    requestSha256: valid.requestSha256,
    resultSha256: valid.resultSha256,
    contentSha256: valid.contentSha256,
  })
  const provenanceArtifact = await retainedEvaluationArtifactV1(
    prepared.store,
    '/external-evidence-provenance.json'
  )
  assert.equal(
    provenanceArtifact['chainSha256'],
    evaluationProvenanceChainSha256V1([valid.provenance])
  )
  const currentHeadWait = await evaluatePreparedRenameV1(
    prepared,
    'start-current-head-after-passed-certificate',
    709
  )
  const secondCurrentHeadWait = await evaluatePreparedRenameV1(
    prepared,
    'start-second-current-head-wait',
    710
  )
  assert.equal(currentHeadWait.phase, 'awaitingExternalEvidence')
  assert.equal(secondCurrentHeadWait.phase, 'awaitingExternalEvidence')
  assert.equal(prepared.session.status().exportability.exportable, true)
  assert.equal(prepared.session.status().exportReady, false)
  assert.equal(prepared.session.status().awaitingEvaluations.length, 2)
  await prepared.session.close(
    {
      schemaVersion: 1,
      sessionId: prepared.session.sessionId,
      requestId: 'close-external-lifecycle',
      reason: 'retain external evidence replay proof',
      ...expectedHeadRequest(prepared.session.head),
    },
    invocation(711)
  )
  assert.deepEqual(prepared.external.cancellations, [
    {
      evaluationId: currentHeadWait.evaluationId,
      reason: 'edit.session_closed',
    },
    {
      evaluationId: secondCurrentHeadWait.evaluationId,
      reason: 'edit.session_closed',
    },
  ])
  const replay = await verifyEditSessionReplayV1({
    artifactStore: prepared.store,
    sessionKey: prepared.session.manifest.sessionKey,
    boundChangeContract: prepared.authority.bound,
    transactionExecutor: prepared.executor,
  })
  assert.equal(replay.ok, true, JSON.stringify(replay.failures))
  assert.equal(replay.reconstructedExternalObservations, 1)
})

test('Group G deadline and close cancellation prevent late evidence resurrection', async (t) =>
{
  const clock = new ControlledClockV1(1_753_058_000_000)
  const expired = await prepareRenameSessionV1(t, {
    externalPredicateCount: 1,
    entropySeed: 73,
    requestSuffix: 'external-expiry',
    clock,
  })
  assert.ok(expired.external)
  assert.ok(expired.inbox)
  const awaiting = await evaluatePreparedRenameV1(
    expired,
    'start-external-expiry',
    801
  )
  const issued = expired.port.executions[0]!.result.externalRequests[0]!
  clock.advance(101)
  const swept = await expired.session.pollStatusV1(invocation(802))
  assert.equal(swept.awaitingEvaluations.length, 0)
  assert.equal(swept.evaluationState, 'inconclusive')
  assert.deepEqual(expired.external.cancellations, [
    {
      evaluationId: awaiting.evaluationId,
      reason: 'edit.external_evidence_expired',
    },
  ])
  expired.inbox.records = [
    stagedRecordV1({
      evaluationId: awaiting.evaluationId,
      request: issued,
      recordId: 'late-after-expiry',
    }),
  ]
  await assert.rejects(
    expired.session.evaluate(
      finalizeEvaluationRequestV1(
        expired.session,
        awaiting,
        'finalize-after-expiry'
      ),
      invocation(803)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.evaluation_inconclusive'
  )
  assert.equal(expired.session.certificates.length, 0)

  const closing = await prepareRenameSessionV1(t, {
    externalPredicateCount: 1,
    entropySeed: 79,
    requestSuffix: 'external-close',
    clock: new ControlledClockV1(1_753_059_000_000),
  })
  assert.ok(closing.external)
  assert.ok(closing.inbox)
  const closingAwaiting = await evaluatePreparedRenameV1(
    closing,
    'start-external-close',
    804
  )
  const appliedRevisionId = closing.session.revisions[1]!.head.revisionId
  await closing.session.undo(
    {
      schemaVersion: 1,
      sessionId: closing.session.sessionId,
      requestId: 'move-head-with-historical-external-wait',
      ...expectedHeadRequest(closing.session.head),
      expectedUndoableApplyRevisionId: appliedRevisionId,
    },
    invocation(805)
  )
  const historicalStatus = closing.session.status()
  assert.equal(historicalStatus.awaitingEvaluations.length, 1)
  assert.notEqual(
    historicalStatus.awaitingEvaluations[0]?.evaluatedRevision.revisionId,
    historicalStatus.head.revisionId
  )
  await closing.session.close(
    {
      schemaVersion: 1,
      sessionId: closing.session.sessionId,
      requestId: 'close-with-live-external-task',
      reason: 'cancel live external task',
      ...expectedHeadRequest(closing.session.head),
    },
    invocation(806)
  )
  assert.deepEqual(closing.external.cancellations, [
    {
      evaluationId: closingAwaiting.evaluationId,
      reason: 'edit.session_closed',
    },
  ])
  closing.inbox.records = [
    stagedRecordV1({
      evaluationId: closingAwaiting.evaluationId,
      request: closing.port.executions[0]!.result.externalRequests[0]!,
      recordId: 'late-after-close',
    }),
  ]
  await assert.rejects(
    closing.session.evaluate(
      finalizeEvaluationRequestV1(
        closing.session,
        closingAwaiting,
        'finalize-after-close'
      ),
      invocation(807)
    ),
    (error) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.session_closed'
  )
  assert.equal(closing.session.certificates.length, 0)
})

async function completeTwoExternalPredicatesV1(
  prepared: PreparedRenameSessionV1,
  hostTag: string,
  reverse: boolean,
  satisfied = true
)
{
  assert.ok(prepared.inbox)
  const awaiting = await evaluatePreparedRenameV1(
    prepared,
    'start-two-external-predicates',
    901
  )
  assert.equal(awaiting.phase, 'awaitingExternalEvidence')
  const issued = prepared.port.executions[0]!.result.externalRequests
  assert.equal(issued.length, 2)
  const records = issued.map((request, index) =>
    stagedRecordV1({
      evaluationId: awaiting.evaluationId,
      request,
      recordId: `${hostTag}-record-${index}`,
      satisfied,
      contentSha256: (index + 1).toString(16).repeat(64),
      judgmentSha256: (index + 3).toString(16).repeat(64),
      locator: `/host/${hostTag}/record-${index}.json`,
      capturedAtEpochMs: 1_753_060_000_000 + index,
    })
  )
  prepared.inbox.records = reverse ? [...records].reverse() : records
  const completed = await prepared.session.evaluate(
    finalizeEvaluationRequestV1(
      prepared.session,
      awaiting,
      'finalize-two-external-predicates'
    ),
    invocation(902)
  )
  assert.equal(completed.certificate.state, 'present')
  return { awaiting, completed, issued, records }
}

test('Group G external inbox order and host provenance do not change semantic evidence', async (t) =>
{
  const first = await prepareRenameSessionV1(t, {
    externalPredicateCount: 2,
    entropySeed: 83,
    requestSuffix: 'stable-external-semantic-run',
    hostTag: 'host-first',
    clock: deterministicClock(1_753_060_100_000),
  })
  const firstCompleted = await completeTwoExternalPredicatesV1(
    first,
    'first',
    false
  )
  assert.equal(firstCompleted.completed.certificate.state, 'present')
  if (firstCompleted.completed.certificate.state !== 'present')
    assert.fail('first external run retained no certificate')
  assert.equal(firstCompleted.completed.certificate.status, 'passed')
  const firstProvenance = await retainedEvaluationArtifactV1(
    first.store,
    '/external-evidence-provenance.json'
  )

  const second = await prepareRenameSessionV1(t, {
    externalPredicateCount: 2,
    entropySeed: 89,
    requestSuffix: 'fresh-external-semantic-run',
    hostTag: 'host-second',
    clock: deterministicClock(1_753_060_900_000),
  })
  const secondCompleted = await completeTwoExternalPredicatesV1(
    second,
    'second',
    true
  )
  assert.equal(secondCompleted.completed.certificate.state, 'present')
  if (secondCompleted.completed.certificate.state !== 'present')
    assert.fail('second external run retained no certificate')
  assert.equal(secondCompleted.completed.certificate.status, 'passed')
  assert.notEqual(
    firstCompleted.awaiting.evaluationId,
    secondCompleted.awaiting.evaluationId
  )
  assert.notDeepEqual(
    firstCompleted.issued.map((entry) => entry.requestArtifactId),
    secondCompleted.issued.map((entry) => entry.requestArtifactId)
  )
  assert.deepEqual(
    firstCompleted.issued.map((entry) => entry.requestSha256),
    secondCompleted.issued.map((entry) => entry.requestSha256)
  )
  assert.deepEqual(
    firstCompleted.records.map((entry) => entry.resultSha256),
    secondCompleted.records.map((entry) => entry.resultSha256)
  )
  assert.equal(
    firstCompleted.completed.certificate.certificateSha256,
    secondCompleted.completed.certificate.certificateSha256
  )
  const secondProvenance = await retainedEvaluationArtifactV1(
    second.store,
    '/external-evidence-provenance.json'
  )
  assert.notEqual(
    firstProvenance['chainSha256'],
    secondProvenance['chainSha256']
  )

  const failed = await prepareRenameSessionV1(t, {
    externalPredicateCount: 2,
    entropySeed: 83,
    requestSuffix: 'stable-external-semantic-run',
    hostTag: 'host-failed-judgment',
    clock: deterministicClock(1_753_061_500_000),
  })
  const failedCompleted = await completeTwoExternalPredicatesV1(
    failed,
    'failed',
    true,
    false
  )
  assert.equal(failedCompleted.completed.certificate.state, 'present')
  if (failedCompleted.completed.certificate.state !== 'present')
    assert.fail('failed external judgment retained no certificate')
  assert.equal(failedCompleted.completed.certificate.status, 'failed')
  assert.equal(failed.session.exportability().exportable, false)
  assert.equal(
    failed.session.exportability().refusalCode,
    'edit.evaluation_failed'
  )
})
