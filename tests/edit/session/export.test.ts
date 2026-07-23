// tests/edit/session/export.test.ts
// Group G output policy, publication recovery, & replay completeness

import assert from 'node:assert/strict'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
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
  buildSemanticReferenceIndex,
  boundedDisplayStringV1,
  parseSemanticChangeContractV1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
  targetBoundedLocationProjectionV1,
  targetEntityEvidenceSetV1,
  targetExpectedStringIdentityV1,
  targetInboundReferenceSetV1,
  targetProspectiveNameActivationV1,
  type EditChangeContractRegistrationV1,
  type EditExportRequestV1,
  type EditScenarioPolicyV1,
  type OutputNamePolicyV1,
  type RunnerAvailabilityV1,
  type SemanticEditOperationV1,
} from '@scratch-agent/ir/edit'
import { buildFixtureSb3, packSb3 } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { inspectSemanticEditArtifact } from '../../../packages/eval/src/artifacts/artifact-preflight.js'
import { type EditProductionPolicyDecoderV1 } from '../../../packages/eval/src/edit-evaluation/edit-production-evaluation.js'
import { DEFAULT_RUNTIME_OBSERVATION_CAPS, defaultObservationPlan } from '../../../packages/runner/src/observation/observation.js'

import { EditChangeContractRegistryV1, type BoundChangeContractV1 } from '../../../packages/edit/src/contracts/change-contracts.js'
import { editCanonicalBytesV1, editCanonicalSha256V1 } from '../../../packages/edit/src/support/canonical.js'
import type { EditDeterministicEvaluationExecutionV1, EditDeterministicEvaluationPort, EditDeterministicEvaluationRequestV1 } from '../../../packages/edit/src/evaluation/evaluation-ports.js'
import { EVALUATION_LANE_ORDER_V1 } from '../../../packages/edit/src/evaluation/evaluation-plans.js'
import { buildSourceLineageV1 } from '../../../packages/edit/src/lineage/lineage.js'
import { editSessionLayoutV1 } from '../../../packages/edit/src/session/layout.js'
import { ProductionEditDeterministicEvaluationPortV1 } from '../../../packages/edit/src/evaluation/production-evaluation.js'
import { EditPublicationDenialError, assertExportDestinationAllowedV1, assertOutputBasenameAllowedV1, editExportSourcePreservationSha256V1, editSemanticExportReceiptSha256V1, isEditPublicationCapabilityReadyV1, isPreparedPublicationBoundV1, isPublicationCommitBoundV1, isPublicationDestinationBoundV1, isPublicationInspectionBoundV1, isPublicationReservationBoundV1, isPublicationVerificationBoundV1 } from '../../../packages/edit/src/assets/publication.js'
import { ProductionTransactionExecutorV1, TargetProductionOperationDispatcherV1, productionContractScopeSha256V1, productionOperationChangeFingerprintV1, productionTargetPlanningFactSetSha256V1 } from '../../../packages/edit/src/transaction/production-transaction.js'
import { verifyEditSessionReplayV1 } from '../../../packages/edit/src/replay/replay.js'
import { semanticReportProjectionV1 } from '../../../packages/edit/src/session/revision.js'
import { EditSessionErrorV1, createEditSessionRegistryForExecutorV1, type EditInspectDomainItemV1, type EditSessionV1 } from '../../../packages/edit/src/session/session.js'
import type { EditSourceProvenanceV1 } from '../../../packages/edit/src/session/source-intake.js'
import type { EditArtifactStorePort, EditClockPort, EditEntropyPort, HostInvocationContextV1 } from '../../../packages/edit/src/transaction/ports.js'
import { createEditArtifactStoreHostAdapter } from '../../../packages/eval/src/artifacts/durable-artifacts.js'
import {
  configureEditPublicationDirectory,
  EditPublicationDirectoryPort,
  type EditPublicationFaultPoint,
} from '@scratch-agent/mcp'
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

function tempDirectory(t: test.TestContext, label: string): string
{
  const root = mkdtempSync(join(tmpdir(), `phase-8-group-g-${label}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
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

class CountingProductionPortV1 implements EditDeterministicEvaluationPort
{
  readonly #delegate = new ProductionEditDeterministicEvaluationPortV1({
    decoder: GROUP_G_EXPORT_POLICY_DECODER_V1,
    runnerAvailabilityProbe: { runnerAvailabilityV1: runnerAvailability },
  })
  calls = 0

  runnerAvailabilityV1(): readonly RunnerAvailabilityV1[]
  {
    return this.#delegate.runnerAvailabilityV1()
  }

  async evaluate(
    request: EditDeterministicEvaluationRequestV1
  ): Promise<EditDeterministicEvaluationExecutionV1>
  {
    this.calls += 1
    return this.#delegate.evaluate(request)
  }
}

const GROUP_G_EXPORT_POLICY_DECODER_V1 =
  Object.freeze<EditProductionPolicyDecoderV1>({
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
  })

async function exportAuthority(input: {
  sourceBytes: Uint8Array
  sourceProject: ProjectIR
  outputNamePolicy: OutputNamePolicyV1
}): Promise<{
  registry: EditChangeContractRegistryV1
  bound: BoundChangeContractV1
  targetIndex: number
  beforeReferenceSetSha256: string
  activationSetSha256: string
}>
{
  const sourceArtifactSha256 = sha256Hex(input.sourceBytes)
  const preflight = await inspectSemanticEditArtifact(input.sourceBytes)
  assert.ok(preflight.ok && preflight.semanticSourceSha256)
  const semanticSourceSha256 = preflight.semanticSourceSha256
  const lineage = buildSourceLineageV1(
    input.sourceProject,
    semanticSourceSha256
  ).active
  const targetIndex = 1
  const targetEvidence = targetEntityEvidenceSetV1(
    input.sourceProject.json
  ).find((entry) => entry.targetIndex === targetIndex)
  const sprite = input.sourceProject.json.targets[targetIndex]
  assert.ok(targetEvidence?.targetKind === 'sprite')
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
  const index = buildSemanticReferenceIndex(input.sourceProject)
  const inbound = targetInboundReferenceSetV1(
    input.sourceProject,
    index,
    targetIndex
  )
  const activation = targetProspectiveNameActivationV1(
    input.sourceProject,
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
  const operation: SemanticEditOperationV1 = {
    ...provisional,
    expectedPlanningFactSetSha256: productionTargetPlanningFactSetSha256V1(
      input.sourceProject,
      provisional,
      targetIndex,
      lineage
    ),
  }
  const candidate = ProjectIR.fromProjectJson(
    structuredClone(input.sourceProject.toProjectJson()),
    input.sourceProject.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    }))
  )
  candidate.uids.restoreMonotonic(input.sourceProject.uids.snapshot())
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
    input.sourceProject,
    candidate,
    [applied.attribution],
    {
      correspondence,
      correspondenceEvidence: {
        before: captureProjectOrderedHeadEvidence(
          input.sourceProject,
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
  const scenarioSha256 = scenarioPolicyValueSemanticSha256V1(scenario)
  const runtimeSha256 = semanticHashV1('evidence-content', {
    kind: 'group-g-runtime-policy',
  })
  const lensSha256 = semanticHashV1('evidence-content', {
    kind: 'group-g-lens-policy',
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
  ]
  contract.evaluationPlans = [
    {
      planId: 'export-plan',
      planClass: 'behavioralEdit',
      requiredForExport: true,
      scenarioPolicySha256s: [scenarioSha256],
      runtimePolicySha256: runtimeSha256,
      requiredRuntimeChanges: [
        {
          objectiveId: 'candidate-x-postcondition',
          kind: 'stateAtLabel',
          scenarioId: scenario.scenarioId,
          lane: 'officialHeadless',
          label: 'done',
          path: {
            pathKind: 'targetProperty',
            target: bindingRef,
            property: 'x',
          },
          assertion: {
            comparator: 'equals',
            expected: { valueKind: 'scalar', value: 10 },
          },
        },
      ],
      preservationLenses: [
        {
          lensKind: 'finalState',
          scenarioId: scenario.scenarioId,
          lane: 'officialHeadless',
          lensPolicySha256: lensSha256,
          required: true,
        },
      ],
      laneRequirements: EVALUATION_LANE_ORDER_V1.map((lane) =>
        lane === 'projectPreflight' || lane === 'officialHeadless'
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
  contract.outputNamePolicy = input.outputNamePolicy
  const parsed = parseSemanticChangeContractV1(contract)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) assert.fail('Group G export contract is invalid')
  const provenance = {
    authorityId: 'phase-8-group-g-export-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-21T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'prove exact-byte no-replace export and replay'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const registrationWithoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId: `phase-8-group-g-export-${semanticHashV1(
      'evidence-content',
      input.outputNamePolicy
    ).slice(0, 16)}`,
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  const registration: EditChangeContractRegistrationV1 = {
    ...registrationWithoutDisplayHash,
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

interface ExportHarnessV1
{
  readonly root: string
  readonly outputDirectory: string
  readonly store: EditArtifactStorePort
  readonly authority: Awaited<ReturnType<typeof exportAuthority>>
  readonly executor: ProductionTransactionExecutorV1
  readonly port: CountingProductionPortV1
  readonly publication: EditPublicationDirectoryPort
  readonly session: EditSessionV1
  readonly certificateSha256: string
  readonly outputName: string
}

async function createExportHarness(
  t: test.TestContext,
  options: {
    outputName?: string
    outputNamePolicy?: OutputNamePolicyV1
    publicationFaultPoint?: EditPublicationFaultPoint
    publicationFaultAction?: (outputDirectory: string) => void
    publicationFaultThrows?: boolean
    protectedSourceName?: string
    evaluationConfigured?: boolean
    publicationConfigured?: boolean
  } = {}
): Promise<ExportHarnessV1>
{
  const root = tempDirectory(t, 'export')
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  sourceProject.json.targets[0]!.variables['stageWitnessId'] = [
    'stage witness',
    1,
  ]
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const outputName = options.outputName ?? 'evaluated.sb3'
  const authority = await exportAuthority({
    sourceBytes,
    sourceProject,
    outputNamePolicy: options.outputNamePolicy ?? {
      kind: 'exact',
      basename: outputName,
    },
  })
  const outputRoot = join(root, 'outputs')
  mkdirSync(outputRoot, { mode: 0o700 })
  chmodSync(outputRoot, 0o700)
  const outputDirectory = configureEditPublicationDirectory(
    outputRoot,
    'session-output'
  )
  let faultUsed = false
  const publication = new EditPublicationDirectoryPort(outputDirectory, {
    faultHook: options.publicationFaultPoint
      ? ({ point }) =>
        {
          if (faultUsed || point !== options.publicationFaultPoint) return
          faultUsed = true
          options.publicationFaultAction?.(outputDirectory)
          if (options.publicationFaultThrows !== false)
            throw new Error(`injected publication fault at ${point}`)
        }
      : undefined,
  })
  const store = createEditArtifactStoreHostAdapter(join(root, 'store'))
  const port = new CountingProductionPortV1()
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
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(31),
      handleSecret: new Uint8Array(32).fill(0x53),
      ...(options.evaluationConfigured === false
        ? {}
        : { evaluationPorts: { deterministic: port } }),
      ...(options.publicationConfigured === false
        ? {}
        : { publicationPort: publication }),
    },
    executor
  )
  const protectedSourcePath =
    options.protectedSourceName === undefined
      ? null
      : join(outputDirectory, options.protectedSourceName)
  if (protectedSourcePath !== null)
    writeFileSync(protectedSourcePath, sourceBytes)
  const protectedSourceStat =
    protectedSourcePath === null
      ? null
      : statSync(protectedSourcePath, { bigint: true })
  const provenance: EditSourceProvenanceV1 = {
    kind: 'projectSession' as const,
    projectSessionId: 'group-g-export-project',
    selectedDisplayName: 'group-g-export-source.sb3',
    canonicalRealpath:
      protectedSourcePath === null
        ? '/virtual/group-g-export-source.sb3'
        : realpathSync(protectedSourcePath),
    device: protectedSourceStat?.dev.toString() ?? 'source-device',
    inode: protectedSourceStat?.ino.toString() ?? 'source-inode',
    byteLength: sourceBytes.byteLength,
    modifiedAtNanoseconds:
      protectedSourceStat?.mtimeNs.toString() ?? '1753056000000000000',
    sourceInspectionPolicySha256: HASH_A,
    diagnosticPolicySha256: HASH_B,
    runtimePolicySha256: HASH_C,
    provenanceRegistrationSha256: HASH_D,
  }
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-g-export',
      baseline: {
        kind: 'projectSession',
        projectSessionId: 'group-g-export-project',
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: authority.bound.registration.registrationId,
      expectedSemanticContractSha256:
        authority.bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'group-g-export-source.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance,
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId) as EditSessionV1
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
      requestId: 'preview-group-g-export',
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
      requestId: 'apply-group-g-export',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  const certificateSha256 =
    options.evaluationConfigured === false
      ? HASH_A
      : await (async () =>
        {
          const evaluation = await session.evaluate(
            {
              schemaVersion: 1,
              action: 'start',
              sessionId: session.sessionId,
              requestId: 'evaluate-group-g-export',
              evaluationPlanId: 'export-plan',
              ...expectedHeadRequest(session.head),
            },
            invocation(4)
          )
          assert.equal(evaluation.phase, 'completed')
          assert.equal(evaluation.certificate.state, 'present')
          if (evaluation.certificate.state !== 'present')
            assert.fail('Group G export harness did not retain a certificate')
          assert.equal(evaluation.certificate.status, 'passed')
          return evaluation.certificate.certificateSha256
        })()
  return {
    root,
    outputDirectory,
    store,
    authority,
    executor,
    port,
    publication,
    session,
    certificateSha256,
    outputName,
  }
}

function exportRequest(
  harness: ExportHarnessV1,
  requestId: string,
  output:
    | { kind: 'basename'; basename: string }
    | {
        kind: 'reservation'
        reservationId: string
        expectedReservationSha256: string
      }
): EditExportRequestV1
{
  return {
    schemaVersion: 1,
    sessionId: harness.session.sessionId,
    requestId,
    certificateSha256: harness.certificateSha256,
    ...expectedHeadRequest(harness.session.head),
    output,
  }
}

async function exportArtifactV1<T>(
  harness: ExportHarnessV1,
  basename: string
): Promise<T>
{
  const entry = (
    await harness.store.listImmutable(
      `sessions/${harness.session.manifest.sessionKey}/exports`
    )
  ).find((candidate) => candidate.key.endsWith(`/${basename}`))
  assert.ok(entry, `missing retained export artifact ${basename}`)
  return JSON.parse(
    new TextDecoder().decode(await harness.store.readImmutable(entry.key))
  ) as T
}

function adversarialReplayStore(
  store: EditArtifactStorePort,
  options: {
    hiddenSuffix?: string
    tamperKey?: string
    tamper?: (bytes: Uint8Array) => Uint8Array
  }
): EditArtifactStorePort
{
  return new Proxy(store, {
    get(target, property, receiver)
    {
      if (property === 'listImmutable')
        return async (prefix: string) =>
          (await target.listImmutable(prefix)).filter(
            (entry) =>
              options.hiddenSuffix === undefined ||
              !entry.key.endsWith(options.hiddenSuffix)
          )
      if (property === 'readImmutable')
        return async (key: string) =>
        {
          if (
            options.hiddenSuffix !== undefined &&
            key.endsWith(options.hiddenSuffix)
          )
            throw new Error(`adversarial replay hid ${options.hiddenSuffix}`)
          const bytes = await target.readImmutable(key)
          return key === options.tamperKey && options.tamper !== undefined
            ? options.tamper(bytes)
            : bytes
        }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function expectEditSessionError(
  operation: Promise<unknown>,
  code: string
): Promise<void>
{
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof EditSessionErrorV1 && error.code === code
  )
}

test('Group G output policies preserve the semantic basename boundary', () =>
{
  const exact = { kind: 'exact', basename: 'only-this.sb3' } as const
  assert.doesNotThrow(() =>
    assertOutputBasenameAllowedV1(exact, 'only-this.sb3')
  )
  assert.throws(
    () => assertOutputBasenameAllowedV1(exact, 'other.sb3'),
    (error: unknown) =>
      error instanceof EditPublicationDenialError &&
      error.code === 'edit.output_invalid'
  )
  const bounded = {
    kind: 'boundedStem',
    alphabet: 'ascii-alnum-space-dot-dash-underscore',
    requiredPrefix: 'result-',
    requiredSuffix: '.sb3',
    minStemBytes: 3,
    maxStemBytes: 24,
  } as const
  assert.doesNotThrow(() =>
    assertOutputBasenameAllowedV1(bounded, 'result-one .. two.sb3')
  )
  for (const invalid of [
    'wrong-one.sb3',
    'result-one.txt',
    'result-a.sb3',
    'result-no/slash.sb3',
    `result-${'é'.repeat(13)}.sb3`,
  ])
    assert.throws(() => assertOutputBasenameAllowedV1(bounded, invalid))
  const preservation = {
    schemaVersion: 1 as const,
    provenanceKind: 'projectSession' as const,
    sourceArtifactSha256: HASH_A,
    revisionZeroCandidateSha256: HASH_A,
    preLinkRecheckOk: true,
    postLinkRecheckOk: true,
    deniedDestinationSetSha256: HASH_B,
  }
  assert.equal(
    editExportSourcePreservationSha256V1(preservation),
    editExportSourcePreservationSha256V1({
      ...preservation,
      deniedDestinationSetSha256: HASH_C,
    })
  )
})

test('Group G publication binders reject incomplete and cross-wired host responses', async (t) =>
{
  const outputRoot = tempDirectory(t, 'publication-binders')
  const outputDirectory = configureEditPublicationDirectory(
    outputRoot,
    'bound-output'
  )
  const publication = new EditPublicationDirectoryPort(outputDirectory)
  const capability = await publication.capability()
  assert.equal(isEditPublicationCapabilityReadyV1(capability), true)
  for (const key of [
    'writable',
    'rejectsSymlinkComponents',
    'enforcesRealPathContainment',
    'noReplaceLink',
    'durableFileSync',
    'durableDirectorySync',
    'reopensNoFollow',
  ] as const)
    assert.equal(
      isEditPublicationCapabilityReadyV1({ ...capability, [key]: false }),
      false,
      `capability ${key} was not required`
    )
  assert.equal(
    isEditPublicationCapabilityReadyV1({
      ...capability,
      maximumOutputByteLength: 0,
    }),
    false
  )

  const destination = await publication.resolveDestination({
    kind: 'basename',
    basename: 'bound.sb3',
  })
  const reservation = await publication.revalidateReservation({
    kind: 'basename',
    basename: 'bound.sb3',
  })
  assert.equal(isPublicationDestinationBoundV1(destination), true)
  assert.equal(isPublicationReservationBoundV1(reservation), true)
  const escapedFinalPath = join(outputDirectory, '..', 'escaped.sb3')
  assert.equal(
    isPublicationDestinationBoundV1({
      ...destination,
      basename: '../escaped.sb3',
      finalCanonicalPath: escapedFinalPath,
    }),
    false
  )
  assert.equal(
    isPublicationReservationBoundV1({
      ...reservation,
      basename: '../escaped.sb3',
      finalCanonicalPath: escapedFinalPath,
    }),
    false
  )
  assert.equal(
    isPublicationReservationBoundV1({
      ...reservation,
      finalCanonicalPath: join(outputDirectory, 'cross-wired.sb3'),
    }),
    false
  )

  const bytes = new Uint8Array([1, 2, 3, 4])
  const recoveryAuthority = `.edit-publication-tmp-${'a'.repeat(32)}`
  const prepared = await publication.prepare(
    reservation.reservationId,
    bytes,
    recoveryAuthority
  )
  const preparedBinding = {
    prepared,
    reservation,
    recoveryAuthority,
    candidateSha256: sha256Hex(bytes),
    candidateByteLength: bytes.byteLength,
  }
  assert.equal(isPreparedPublicationBoundV1(preparedBinding), true)
  assert.equal(
    isPreparedPublicationBoundV1({
      ...preparedBinding,
      prepared: { ...prepared, reservationId: 'cross-wired' },
    }),
    false
  )
  const absent = await publication.inspectPublicationNames(
    prepared.preparationId
  )
  assert.equal(isPublicationInspectionBoundV1(prepared, absent), true)
  assert.equal(
    isPublicationInspectionBoundV1(prepared, {
      ...absent,
      finalMatchesProof: true,
    }),
    false
  )
  const commit = await publication.commit(prepared.preparationId)
  assert.equal(isPublicationCommitBoundV1(prepared, commit), true)
  assert.equal(
    isPublicationCommitBoundV1(prepared, {
      ...commit,
      finalCanonicalPath: join(outputDirectory, 'cross-wired.sb3'),
    }),
    false
  )
  const verification = await publication.verifyCommitted(prepared.preparationId)
  assert.equal(
    isPublicationVerificationBoundV1(prepared, commit, verification),
    true
  )
  assert.equal(
    isPublicationVerificationBoundV1(prepared, commit, {
      ...verification,
      preparationId: 'cross-wired',
    }),
    false
  )
  await publication.releasePrepared(prepared.preparationId)
})

test('Group G permanently denies source and template paths and inode aliases', () =>
{
  const project: EditSourceProvenanceV1 = {
    kind: 'projectSession',
    projectSessionId: 'project',
    selectedDisplayName: 'source.sb3',
    canonicalRealpath: '/private/source.sb3',
    device: '8',
    inode: '13',
    byteLength: 100,
    modifiedAtNanoseconds: '1',
    sourceInspectionPolicySha256: HASH_A,
    diagnosticPolicySha256: HASH_B,
    runtimePolicySha256: HASH_C,
    provenanceRegistrationSha256: HASH_D,
  }
  for (const destination of [
    { canonicalRealpath: '/private/source.sb3', identity: null },
    {
      canonicalRealpath: '/private/non-realpath-alias.sb3',
      identity: { device: '8', inode: '13' },
    },
  ])
    assert.throws(
      () => assertExportDestinationAllowedV1(project, destination),
      (error: unknown) =>
        error instanceof EditPublicationDenialError &&
        error.code === 'edit.source_overwrite_denied'
    )
  const template: EditSourceProvenanceV1 = {
    kind: 'registeredTemplate',
    registryProfileSha256: HASH_A,
    registryEntryId: 'template-entry',
    templateId: 'template',
    templateVersion: 1,
    templateArtifactSha256: HASH_B,
    registryResolutionProofSha256: HASH_C,
    sourceInspectionPolicySha256: HASH_A,
    diagnosticPolicySha256: HASH_B,
    runtimePolicySha256: HASH_C,
    provenanceRegistrationSha256: HASH_D,
    backingFileIdentity: {
      canonicalRealpath: '/private/template.sb3',
      device: '21',
      inode: '34',
      byteLength: 100,
      modifiedAtNanoseconds: '2',
    },
  }
  for (const destination of [
    { canonicalRealpath: '/private/template.sb3', identity: null },
    {
      canonicalRealpath: '/private/template-hardlink.sb3',
      identity: { device: '21', inode: '34' },
    },
  ])
    assert.throws(
      () => assertExportDestinationAllowedV1(template, destination),
      (error: unknown) =>
        error instanceof EditPublicationDenialError &&
        error.code === 'edit.source_overwrite_denied'
    )
})

test('Group G rechecks direct and reserved names before creating publication state', async (t) =>
{
  const policy: OutputNamePolicyV1 = {
    kind: 'boundedStem',
    alphabet: 'ascii-alnum-space-dot-dash-underscore',
    requiredPrefix: 'result-',
    requiredSuffix: '.sb3',
    minStemBytes: 3,
    maxStemBytes: 24,
  }
  const harness = await createExportHarness(t, {
    outputName: 'result-one .. two.sb3',
    outputNamePolicy: policy,
  })
  await expectEditSessionError(
    harness.session.export(
      exportRequest(harness, 'export-off-policy-direct', {
        kind: 'basename',
        basename: 'outside.sb3',
      }),
      invocation(5)
    ),
    'edit.output_invalid'
  )
  const offPolicyReservation = await harness.publication.revalidateReservation({
    kind: 'basename',
    basename: 'outside-reserved.sb3',
  })
  await expectEditSessionError(
    harness.session.export(
      exportRequest(harness, 'export-off-policy-reserved', {
        kind: 'reservation',
        reservationId: offPolicyReservation.reservationId,
        expectedReservationSha256: offPolicyReservation.reservationSha256,
      }),
      invocation(6)
    ),
    'edit.output_invalid'
  )
  assert.deepEqual(
    readdirSync(harness.outputDirectory).sort(),
    [],
    'off-policy requests must not create a temp or publication artifact'
  )
  const result = await harness.session.export(
    exportRequest(harness, 'export-bounded-positive', {
      kind: 'basename',
      basename: harness.outputName,
    }),
    invocation(7)
  )
  assert.equal(result.terminalState, 'closed-exported')
})

test('Group G missing evaluation and publication ports stay explicitly unavailable', async (t) =>
{
  const withoutEvaluation = await createExportHarness(t, {
    evaluationConfigured: false,
  })
  await expectEditSessionError(
    withoutEvaluation.session.evaluate(
      {
        schemaVersion: 1,
        action: 'start',
        sessionId: withoutEvaluation.session.sessionId,
        requestId: 'evaluate-without-port',
        evaluationPlanId: 'export-plan',
        ...expectedHeadRequest(withoutEvaluation.session.head),
      },
      invocation(5)
    ),
    'edit.evaluation_unavailable'
  )
  assert.equal(
    withoutEvaluation.session.reports[0]!.limitations.includes(
      'evaluation is unavailable because no deterministic evaluation port is configured, so no certificate can authorize export'
    ),
    true
  )
  assert.equal(withoutEvaluation.port.calls, 0)

  const withoutPublication = await createExportHarness(t, {
    publicationConfigured: false,
  })
  await expectEditSessionError(
    withoutPublication.session.export(
      exportRequest(withoutPublication, 'export-without-port', {
        kind: 'basename',
        basename: withoutPublication.outputName,
      }),
      invocation(5)
    ),
    'edit.publication_unavailable'
  )
  assert.equal(
    withoutPublication.session.reports[0]!.limitations.includes(
      'export is unavailable because no publication port is configured'
    ),
    true
  )
})

test('Group G source denial survives hard links and source-path deletion', async (t) =>
{
  const sourceName = 'result-source.sb3'
  const aliasName = 'result-alias.sb3'
  const policy: OutputNamePolicyV1 = {
    kind: 'boundedStem',
    alphabet: 'ascii-alnum-space-dot-dash-underscore',
    requiredPrefix: 'result-',
    requiredSuffix: '.sb3',
    minStemBytes: 3,
    maxStemBytes: 24,
  }
  const harness = await createExportHarness(t, {
    outputName: aliasName,
    outputNamePolicy: policy,
    protectedSourceName: sourceName,
  })
  const sourcePath = join(harness.outputDirectory, sourceName)
  const aliasPath = join(harness.outputDirectory, aliasName)
  const sourceBefore = statSync(sourcePath, { bigint: true })
  const sourceBytesBefore = readFileSync(sourcePath)
  linkSync(sourcePath, aliasPath)
  await expectEditSessionError(
    harness.session.export(
      exportRequest(harness, 'export-protected-source-path', {
        kind: 'basename',
        basename: sourceName,
      }),
      invocation(5)
    ),
    'edit.source_overwrite_denied'
  )
  await expectEditSessionError(
    harness.session.export(
      exportRequest(harness, 'export-protected-source-inode-alias', {
        kind: 'basename',
        basename: aliasName,
      }),
      invocation(6)
    ),
    'edit.source_overwrite_denied'
  )
  unlinkSync(sourcePath)
  await expectEditSessionError(
    harness.session.export(
      exportRequest(harness, 'export-protected-source-path-after-delete', {
        kind: 'basename',
        basename: sourceName,
      }),
      invocation(7)
    ),
    'edit.source_overwrite_denied'
  )
  const aliasAfter = statSync(aliasPath, { bigint: true })
  assert.equal(aliasAfter.dev, sourceBefore.dev)
  assert.equal(aliasAfter.ino, sourceBefore.ino)
  assert.deepEqual(readFileSync(aliasPath), sourceBytesBefore)
})

test('Group G publication faults remain complete-or-absent and roll forward safely', async (t) =>
{
  await t.test(
    'pre-link failure remains active with bounded failure evidence',
    async (t) =>
    {
      const harness = await createExportHarness(t, {
        publicationFaultPoint: 'prepare.beforeWrite',
      })
      await expectEditSessionError(
        harness.session.export(
          exportRequest(harness, 'export-pre-link-fault', {
            kind: 'basename',
            basename: harness.outputName,
          }),
          invocation(5)
        ),
        'edit.export_write_failed'
      )
      assert.equal(harness.session.state, 'active')
      assert.equal(
        readdirSync(harness.outputDirectory).includes(harness.outputName),
        false
      )
      assert.equal(
        readdirSync(harness.outputDirectory).some((name) =>
          name.startsWith('.edit-publication-tmp-')
        ),
        false
      )
      const failure = await exportArtifactV1<{
        publicationCommitted: boolean
        preparationExisted: boolean
        recoveryRequired: boolean
      }>(harness, '000002-failed-before-publish.json')
      assert.deepEqual(failure, {
        ...failure,
        publicationCommitted: false,
        preparationExisted: false,
        recoveryRequired: false,
      })
    }
  )

  await t.test('a file racing into place is never replaced', async (t) =>
  {
    const raced = Buffer.from('raced-file-must-survive')
    const harness = await createExportHarness(t, {
      publicationFaultPoint: 'commit.beforeLink',
      publicationFaultThrows: false,
      publicationFaultAction: (directory) =>
        writeFileSync(join(directory, 'evaluated.sb3'), raced),
    })
    await expectEditSessionError(
      harness.session.export(
        exportRequest(harness, 'export-link-race', {
          kind: 'basename',
          basename: harness.outputName,
        }),
        invocation(5)
      ),
      'edit.output_exists'
    )
    assert.equal(harness.session.state, 'active')
    assert.deepEqual(
      readFileSync(join(harness.outputDirectory, harness.outputName)),
      raced
    )
    assert.equal(
      readdirSync(harness.outputDirectory).some((name) =>
        name.startsWith('.edit-publication-tmp-')
      ),
      false
    )
    const failedEntry = (
      await harness.store.listImmutable(
        `sessions/${harness.session.manifest.sessionKey}/exports`
      )
    ).find((entry) => entry.key.endsWith('/000002-failed-before-publish.json'))
    assert.ok(failedEntry)
    const forgedReplay = await verifyEditSessionReplayV1({
      artifactStore: adversarialReplayStore(harness.store, {
        tamperKey: failedEntry.key,
        tamper: (bytes) =>
        {
          const record = JSON.parse(new TextDecoder().decode(bytes)) as Record<
            string,
            unknown
          >
          for (const key of ['finalObservation', 'cleanupObservation'])
          {
            const observation = record[key] as Record<string, unknown>
            observation['finalPresent'] = false
            observation['finalMatchesProof'] = false
            observation['finalDevice'] = null
            observation['finalInode'] = null
            observation['finalByteLength'] = null
          }
          return canonicalJsonBytesV1(record)
        },
      }),
      sessionKey: harness.session.manifest.sessionKey,
      boundChangeContract: harness.authority.bound,
      transactionExecutor: harness.executor,
    })
    assert.equal(forgedReplay.ok, false)
    assert.match(
      forgedReplay.failures.join('\n'),
      /failed-before-publish|output_exists|internally inconsistent/u
    )
  })

  await t.test(
    'matching final recovery is re-entrant with one terminal event',
    async (t) =>
    {
      const harness = await createExportHarness(t, {
        publicationFaultPoint: 'commit.beforeDirectorySync',
      })
      await expectEditSessionError(
        harness.session.export(
          exportRequest(harness, 'export-link-sync-window', {
            kind: 'basename',
            basename: harness.outputName,
          }),
          invocation(5)
        ),
        'edit.recovery_required'
      )
      assert.equal(harness.session.state, 'recovery-required')
      assert.equal(
        (
          await harness.store.listImmutable(
            `sessions/${harness.session.manifest.sessionKey}/exports`
          )
        ).some((entry) => entry.key.endsWith('/semantic-receipt.json')),
        false
      )
      const recovered = await harness.session.recoverExport(invocation(6))
      assert.equal(recovered.terminalState, 'closed-exported')
      assert.equal(harness.session.state, 'closed-exported')
      await expectEditSessionError(
        harness.session.recoverExport(invocation(7)),
        'edit.internal_invariant'
      )
      assert.equal(
        harness.session.events.filter(
          (event) => event.projection.eventKind === 'session-closed'
        ).length,
        1
      )
    }
  )

  await t.test(
    'absent final recovery relinks the retained candidate',
    async (t) =>
    {
      const harness = await createExportHarness(t, {
        publicationFaultPoint: 'commit.beforeDirectorySync',
      })
      await expectEditSessionError(
        harness.session.export(
          exportRequest(harness, 'export-absent-final-window', {
            kind: 'basename',
            basename: harness.outputName,
          }),
          invocation(5)
        ),
        'edit.recovery_required'
      )
      unlinkSync(join(harness.outputDirectory, harness.outputName))
      const recovered = await harness.session.recoverExport(invocation(6))
      assert.equal(recovered.terminalState, 'closed-exported')
      assert.equal(
        sha256Hex(
          readFileSync(join(harness.outputDirectory, harness.outputName))
        ),
        recovered.publishedSha256
      )
      const recoveryPrepared = await exportArtifactV1<{
        temporaryRecreated: boolean
      }>(harness, 'recovery-000001-prepared.json')
      assert.equal(recoveryPrepared.temporaryRecreated, false)
    }
  )

  await t.test(
    'conflicting final recovery preserves the unknown file',
    async (t) =>
    {
      const conflict = Buffer.from('external-conflict')
      const harness = await createExportHarness(t, {
        publicationFaultPoint: 'commit.beforeDirectorySync',
      })
      await expectEditSessionError(
        harness.session.export(
          exportRequest(harness, 'export-conflicting-final-window', {
            kind: 'basename',
            basename: harness.outputName,
          }),
          invocation(5)
        ),
        'edit.recovery_required'
      )
      const finalPath = join(harness.outputDirectory, harness.outputName)
      unlinkSync(finalPath)
      writeFileSync(finalPath, conflict)
      await expectEditSessionError(
        harness.session.recoverExport(invocation(6)),
        'edit.publication_interference'
      )
      assert.equal(harness.session.state, 'closed-abandoned')
      assert.deepEqual(readFileSync(finalPath), conflict)
      const terminal = await exportArtifactV1<{
        disposition: string
        receiptIssued: boolean
      }>(harness, '000003-external-interference.json')
      assert.equal(terminal.disposition, 'unexpectedFinalIdentity')
      assert.equal(terminal.receiptIssued, false)
    }
  )

  await t.test(
    'post-commit evidence failure terminalizes without a receipt',
    async (t) =>
    {
      const harness = await createExportHarness(t, {
        publicationFaultPoint: 'verify.afterIdentityCheck',
      })
      await expectEditSessionError(
        harness.session.export(
          exportRequest(harness, 'export-post-commit-evidence-window', {
            kind: 'basename',
            basename: harness.outputName,
          }),
          invocation(5)
        ),
        'edit.publication_interference'
      )
      const published = readFileSync(
        join(harness.outputDirectory, harness.outputName)
      )
      assert.equal(sha256Hex(published), harness.session.head.candidateSha256)
      assert.equal(harness.session.state, 'closed-abandoned')
      assert.equal(
        (
          await harness.store.listImmutable(
            `sessions/${harness.session.manifest.sessionKey}/exports`
          )
        ).some((entry) => entry.key.endsWith('/semantic-receipt.json')),
        false
      )
      const terminal = await exportArtifactV1<{
        disposition: string
        receiptIssued: boolean
      }>(harness, '000003-external-interference.json')
      assert.equal(terminal.disposition, 'committedCandidateUnattested')
      assert.equal(terminal.receiptIssued, false)
    }
  )
})

test('Group G publishes exact candidate bytes and replays receipt semantics without live ports', async (t) =>
{
  const harness = await createExportHarness(t)
  const writesBeforeReplay = { count: 0 }
  const result = await harness.session.export(
    exportRequest(harness, 'export-group-g-success', {
      kind: 'basename',
      basename: harness.outputName,
    }),
    invocation(3)
  )
  assert.equal(result.terminalState, 'closed-exported')
  const published = readFileSync(
    join(harness.outputDirectory, harness.outputName)
  )
  assert.equal(sha256Hex(published), result.publishedSha256)
  const retainedReceipt = await exportArtifactV1<{
    receipt: Parameters<typeof editSemanticExportReceiptSha256V1>[0]
    receiptSha256: string
  }>(harness, 'semantic-receipt.json')
  assert.equal(
    editSemanticExportReceiptSha256V1(retainedReceipt.receipt),
    retainedReceipt.receiptSha256
  )
  const store = new Proxy(harness.store, {
    get(target, property, receiver)
    {
      const value = Reflect.get(target, property, receiver)
      if (
        typeof value === 'function' &&
        [
          'createImmutable',
          'createOrVerifyImmutable',
          'compareAndSwapPointer',
          'reserveQuota',
          'releaseQuota',
          'settleQuota',
          'cleanupProvenTemp',
          'removeEvictable',
        ].includes(String(property))
      )
        return (...args: unknown[]) =>
        {
          writesBeforeReplay.count += 1
          return Reflect.apply(value, target, args)
        }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: harness.session.manifest.sessionKey,
    boundChangeContract: harness.authority.bound,
    transactionExecutor: harness.executor,
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedCertificateCount, 1)
  assert.equal(replay.verifiedExportCount, 1)
  assert.equal(replay.publishedSha256, result.publishedSha256)
  assert.equal(replay.exportReceiptSha256, retainedReceipt.receiptSha256)
  assert.equal(replay.reconstructedExternalObservations, 0)
  assert.equal(writesBeforeReplay.count, 0)
  assert.equal(harness.port.calls, 1)
  assert.equal(
    harness.session.reports
      .at(-1)!
      .limitations.includes(
        'publication is complete-or-absent under non-adversarial concurrency only; hostile same-user filesystem races are out of scope'
      ),
    true
  )
  const capabilityEnvelope = JSON.parse(
    new TextDecoder().decode(
      await harness.store.readImmutable(
        `sessions/${harness.session.manifest.sessionKey}/authority/capability-profile.json`
      )
    )
  ) as {
    profile: {
      familyAssessments: readonly {
        family: string
        availability: string
        refusalCodes: readonly string[]
        boundedExplanation: unknown
      }[]
    }
  }
  const expectedCapabilityFamilies = {
    evaluation: {
      refusalCodes: [
        'edit.evaluation_unavailable',
        'edit.evaluation_inconclusive',
        'edit.evaluation_failed',
      ],
      explanation: 'exact-byte evaluation',
    },
    export: {
      refusalCodes: [
        'edit.publication_unavailable',
        'edit.evaluation_unavailable',
        'edit.evaluation_inconclusive',
        'edit.stale_certificate',
      ],
      explanation: 'Complete-or-absent',
    },
  } as const
  for (const family of ['evaluation', 'export'] as const)
  {
    const assessment = capabilityEnvelope.profile.familyAssessments.find(
      (entry) => entry.family === family
    )
    assert.equal(assessment?.availability, 'supported')
    assert.deepEqual(
      assessment?.refusalCodes,
      expectedCapabilityFamilies[family].refusalCodes
    )
    assert.equal(
      JSON.stringify(assessment?.boundedExplanation).includes(
        expectedCapabilityFamilies[family].explanation
      ),
      true
    )
    assert.equal(
      JSON.stringify(assessment?.boundedExplanation).includes('until Group G'),
      false
    )
  }

  const secondHarness = await createExportHarness(t)
  const secondResult = await secondHarness.session.export(
    exportRequest(secondHarness, 'export-group-g-second-root', {
      kind: 'basename',
      basename: secondHarness.outputName,
    }),
    invocation(3)
  )
  assert.equal(secondResult.publishedSha256, result.publishedSha256)
  const secondRetainedReceipt = await exportArtifactV1<{
    receipt: Parameters<typeof editSemanticExportReceiptSha256V1>[0]
    receiptSha256: string
  }>(secondHarness, 'semantic-receipt.json')
  assert.deepEqual(secondRetainedReceipt.receipt, retainedReceipt.receipt)
  assert.equal(
    secondRetainedReceipt.receiptSha256,
    retainedReceipt.receiptSha256
  )
  const firstProvenance = await exportArtifactV1<{
    provenance: {
      directoryCanonicalRealpath: string
      directoryDevice: string
      directoryInode: string
    }
  }>(harness, 'provenance.json')
  const secondProvenance = await exportArtifactV1<{
    provenance: {
      directoryCanonicalRealpath: string
      directoryDevice: string
      directoryInode: string
    }
  }>(secondHarness, 'provenance.json')
  assert.notEqual(
    secondProvenance.provenance.directoryCanonicalRealpath,
    firstProvenance.provenance.directoryCanonicalRealpath
  )
  assert.notEqual(
    secondProvenance.provenance.directoryInode,
    firstProvenance.provenance.directoryInode
  )
  assert.notDeepEqual(secondProvenance.provenance, firstProvenance.provenance)
})

test('Group G replay refuses missing, changed, and omitted export authority', async (t) =>
{
  const harness = await createExportHarness(t)
  await harness.session.export(
    exportRequest(harness, 'export-group-g-replay-forgery', {
      kind: 'basename',
      basename: harness.outputName,
    }),
    invocation(5)
  )
  const replayWith = (store: EditArtifactStorePort) =>
    verifyEditSessionReplayV1({
      artifactStore: store,
      sessionKey: harness.session.manifest.sessionKey,
      boundChangeContract: harness.authority.bound,
      transactionExecutor: harness.executor,
    })
  for (const [hiddenSuffix, expected] of [
    ['/certified-input.json', /certified[- ]input|completed/u],
    ['/000003-published.json', /receipt|published/u],
    ['/000001-prepared.json', /prepared/u],
    ['/000002-link-observed.json', /link-observed|receipt/u],
    ['/provenance.json', /provenance|receipt/u],
  ] as const)
  {
    const replay = await replayWith(
      adversarialReplayStore(harness.store, { hiddenSuffix })
    )
    assert.equal(replay.ok, false)
    assert.match(replay.failures.join('\n'), expected)
  }
  const candidateReplay = await replayWith(
    adversarialReplayStore(harness.store, {
      tamperKey: harness.session.revisions.at(-1)!.candidateKey,
      tamper: (bytes) => Uint8Array.from([...bytes, 0]),
    })
  )
  assert.equal(candidateReplay.ok, false)
  assert.match(candidateReplay.failures.join('\n'), /candidate|revision/u)

  const exportEntries = await harness.store.listImmutable(
    `sessions/${harness.session.manifest.sessionKey}/exports`
  )
  for (const [suffix, identityField, expected] of [
    [
      '/000001-prepared.json',
      'tempInode',
      /stage records|provenance|publication/u,
    ],
    [
      '/000002-link-observed.json',
      'finalInode',
      /stage records|provenance|publication/u,
    ],
  ] as const)
  {
    const entry = exportEntries.find((candidate) =>
      candidate.key.endsWith(suffix)
    )
    assert.ok(entry)
    const replay = await replayWith(
      adversarialReplayStore(harness.store, {
        tamperKey: entry.key,
        tamper: (bytes) =>
        {
          const record = JSON.parse(new TextDecoder().decode(bytes)) as Record<
            string,
            unknown
          >
          record[identityField] = '0'
          return canonicalJsonBytesV1(record)
        },
      })
    )
    assert.equal(replay.ok, false)
    assert.match(replay.failures.join('\n'), expected)
  }

  const provenanceEntry = exportEntries.find((entry) =>
    entry.key.endsWith('/provenance.json')
  )
  assert.ok(provenanceEntry)
  for (const mutate of [
    (record: Record<string, unknown>) =>
    {
      const provenance = record['provenance'] as Record<string, unknown>
      provenance['tempReleased'] = false
    },
    (record: Record<string, unknown>) =>
    {
      const provenance = record['provenance'] as Record<string, unknown>
      provenance['reportSha256'] = '0'.repeat(64)
    },
    (record: Record<string, unknown>) =>
    {
      const provenance = record['provenance'] as Record<string, unknown>
      provenance['auditRecordSha256'] = '0'.repeat(64)
    },
  ])
  {
    const replay = await replayWith(
      adversarialReplayStore(harness.store, {
        tamperKey: provenanceEntry.key,
        tamper: (bytes) =>
        {
          const record = JSON.parse(new TextDecoder().decode(bytes)) as Record<
            string,
            unknown
          >
          mutate(record)
          return canonicalJsonBytesV1(record)
        },
      })
    )
    assert.equal(replay.ok, false)
    assert.match(replay.failures.join('\n'), /provenance|publication|report/u)
  }

  const layout = editSessionLayoutV1(harness.session.manifest.sessionKey)
  const terminalReport = harness.session.reports.at(-1)!
  const forgedSemantic = semanticReportProjectionV1(
    harness.session.manifest.semanticSourceSha256,
    harness.session.manifest.changeContractSha256,
    harness.session.manifest.capabilityProfileSha256,
    harness.session.revisions
  )
  const forgedReport = {
    ...structuredClone(terminalReport),
    semanticProjection: forgedSemantic.projection,
    semanticProjectionSha256: forgedSemantic.sha256,
    reportArtifactSha256: editCanonicalSha256V1(forgedSemantic.projection),
    certificateCount: 0,
    evaluationState: 'none' as const,
  }
  const forgedReportBytes = editCanonicalBytesV1(forgedReport)
  const forgedReportJsonSha256 = sha256Hex(forgedReportBytes)
  await harness.store.createImmutable(
    layout.report(forgedReportJsonSha256, 'report.json'),
    forgedReportBytes
  )
  await harness.store.createImmutable(
    layout.report(forgedReportJsonSha256, 'semantic-projection.json'),
    editCanonicalBytesV1(forgedReport.semanticProjection)
  )
  await harness.store.createImmutable(
    layout.report(forgedReportJsonSha256, 'report.md'),
    new TextEncoder().encode(
      [
        '# Phase 8 Edit Session Report',
        '',
        `- state: ${forgedReport.state}`,
        `- revision count: ${forgedReport.revisionCount}`,
        `- semantic report: ${forgedReport.semanticProjectionSha256}`,
        `- event head: ${forgedReport.eventHeadSha256}`,
        '',
      ].join('\n')
    )
  )
  const forgedManifest = await harness.store.createImmutable(
    layout.report(forgedReportJsonSha256, 'manifest.json'),
    editCanonicalBytesV1({
      schemaVersion: 1,
      reportJsonSha256: forgedReportJsonSha256,
      reportByteLength: forgedReportBytes.byteLength,
      semanticProjectionSha256: forgedReport.semanticProjectionSha256,
    })
  )
  const currentPointerBytes = await harness.store.readImmutable(
    layout.currentReport
  )
  await harness.store.compareAndSwapPointer(
    layout.currentReport,
    sha256Hex(currentPointerBytes),
    editCanonicalBytesV1({
      schemaVersion: 1,
      reportJsonSha256: forgedReportJsonSha256,
      reportManifestSha256: forgedManifest.sha256,
    })
  )
  const completenessReplay = await replayWith(harness.store)
  assert.equal(completenessReplay.ok, false)
  assert.equal(completenessReplay.reportComplete, false)
  assert.deepEqual(completenessReplay.failures, [
    'the current report accounts for 0 of 1 retained certificates',
  ])
})
