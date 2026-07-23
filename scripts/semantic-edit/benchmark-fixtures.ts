// scripts/semantic-edit/benchmark-fixtures.ts
// deterministic generic Group F/G contracts, policies, & operation goals

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { inspectSemanticEditArtifact } from '@scratch-agent/eval'
import {
  ProjectIR,
  captureProjectOrderedHeadEvidence,
  computeProjectDelta,
  type ProjectOrderedCorrespondence,
  type UidSnapshot,
} from '@scratch-agent/ir'
import {
  EVALUATION_LANE_ORDER_V1,
  GREENFIELD_TEMPLATE_ID_V1,
  GREENFIELD_TEMPLATE_VERSION_V1,
  PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
  advanceProductionFutureBindingLedgerV1,
  buildGreenfieldTemplateProjectJsonV1,
  buildSourceLineageV1,
  editCanonicalSha256V1,
  editOperationOccurrenceIdV1,
  emptyFutureBindingLedgerV1,
  exactTargetRef,
  greenfieldTemplateAssetsV1,
  groupFProductionOperationDispatchersV1,
  mergeProductionLineageHistoryV1,
  productionCanonicalValueSha256V1,
  productionComputeCorrespondedDeltaV1,
  productionContractScopeSha256V1,
  productionGroupFAddCostumePlanningCompletionV1,
  productionGroupFSpritePlanningCompletionV1,
  productionOperationChangeFingerprintV1,
  productionProjectCorrespondenceV1,
  productionTargetPlanningFactSetSha256V1,
  type AdmittedEditAssetV1,
  type ProductionOperationContextV1,
  type ProductionOperationDispatchResultV1,
} from '@scratch-agent/edit'
import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  activeOrderedSemanticLineages,
  applyTargetOperationV1,
  boundedDisplayStringV1,
  buildSemanticReferenceIndex,
  groupFCreationContentFingerprintForResultV1,
  parseSemanticChangeContractV1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
  targetEntityEvidenceSetV1,
  targetExpectedStringIdentityV1,
  targetInboundReferenceSetV1,
  targetProspectiveNameActivationV1,
  type ContractScopeV1,
  type EditChangeContractRegistrationV1,
  type EditEvaluationPlanV1,
  type EditScenarioPolicyV1,
  type EditSemanticChangeContractV1,
  type GroupFCreationBindingDescriptorV1,
  type LaneRequirementV1,
  type SemanticEditOperationMediaAddCostumeV1,
  type SemanticEditOperationGoalMediaAddCostumeV1,
  type SemanticEditOperationGoalTargetAddSpriteV1,
  type SemanticEditOperationGoalTargetRenameSpriteV1,
  type SemanticEditOperationV1,
  type TargetRefV1,
} from '@scratch-agent/ir/edit'
import {
  DEFAULT_RUNTIME_OBSERVATION_CAPS,
  defaultObservationPlan,
} from '@scratch-agent/runner'
import {
  deriveAuthoringMediaIdentity,
  resolveEditAdmissionLimits,
} from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import {
  canonicalSha256,
  ensurePrivateDirectory,
  writeExclusive,
  writeJsonExclusive,
  type SemanticEditGeneratedInputsV1,
  type SemanticEditHostBootstrapDescriptorV1,
} from './harness.js'

interface RetainedPolicyBundleV1
{
  readonly scenario: Uint8Array
  readonly runtime: Uint8Array
  readonly lens: Uint8Array
  readonly scenarioSemanticSha256: string
  readonly runtimeSemanticSha256: string
  readonly lensSemanticSha256: string
}

type MutableContractV1 = {
  -readonly [
    Key in keyof EditSemanticChangeContractV1
  ]: EditSemanticChangeContractV1[Key]
}

export interface SemanticEditBenchmarkFixtureV1
{
  readonly registryPath: string
  readonly behaviorContract: SemanticEditHostBootstrapDescriptorV1['behaviorContract']
  readonly mediaContract: SemanticEditHostBootstrapDescriptorV1['mediaContract']
  readonly behavior: {
    readonly targetOrdinal: number
    readonly newName: string
    readonly ambiguousTarget: TargetRefV1
    readonly semanticChangeFingerprint: string
    readonly goal: Omit<SemanticEditOperationGoalTargetRenameSpriteV1, 'target'>
    readonly outputBasename: string
  }
  readonly media: {
    readonly addSpriteGoal: SemanticEditOperationGoalTargetAddSpriteV1
    readonly addCostumeGoal: (
      asset: SemanticEditOperationMediaAddCostumeV1['asset']
    ) => SemanticEditOperationGoalMediaAddCostumeV1
    readonly expectedPayloadSha256: string
    readonly expectedMetadataSha256: string
    readonly spriteChangeFingerprint: string
    readonly costumeChangeFingerprint: string
    readonly outputBasename: string
  }
}

const FIXED_DATE_MS = 1_753_056_000_000
const BEHAVIOR_NEW_NAME = 'Renamed Actor'
const CREATED_SPRITE_NAME = 'Created Actor'
const CREATED_COSTUME_NAME = 'Added Costume'
const BEHAVIOR_OUTPUT = 'behavior-edited.sb3'
const MEDIA_OUTPUT = 'media-edited.sb3'

function unchangedTargetCorrespondence(
  beforeRevisionIdentity: string,
  afterRevisionIdentity: string,
  semanticSourceSha256: string,
  lineage: ReturnType<typeof buildSourceLineageV1>['active']
): ProjectOrderedCorrespondence
{
  const lineageIds = activeOrderedSemanticLineages(lineage, 'target', null).map(
    (record) => record.lineageId
  )
  return Object.freeze({
    beforeRevisionIdentity,
    afterRevisionIdentity,
    beforeSemanticSourceSha256: semanticSourceSha256,
    afterSemanticSourceSha256: semanticSourceSha256,
    targets: {
      collectionKind: 'targets',
      collectionPath: '/targets',
      beforeCollectionPath: '/targets',
      afterCollectionPath: '/targets',
      ownerLineageId: null,
      targetOwnerLineageId: null,
      containerLineageId: null,
      beforeLineageIds: lineageIds,
      afterLineageIds: lineageIds,
      members: lineageIds.map((lineageId, index) => ({
        lineageId,
        beforeIndex: index,
        afterIndex: index,
      })),
    },
  }) as ProjectOrderedCorrespondence
}

async function deriveBehaviorChangeFingerprint(input: {
  readonly project: ProjectIR
  readonly sourceArtifactSha256: string
  readonly targetOrdinal: number
}): Promise<string>
{
  const sourceBytes = await input.project.toSb3()
  const preflight = await inspectSemanticEditArtifact(sourceBytes)
  if (
    sha256Hex(sourceBytes) !== input.sourceArtifactSha256 ||
    !preflight.ok ||
    !preflight.semanticSourceIdentity
  )
    throw new Error(
      'behavior fingerprint lacks exact semantic source authority'
    )
  const semanticSourceSha256 = semanticHashV1(
    'semantic-source',
    preflight.semanticSourceIdentity
  )
  const lineage = buildSourceLineageV1(
    input.project,
    semanticSourceSha256
  ).active
  const evidence = targetEntityEvidenceSetV1(input.project.json).find(
    (candidate) => candidate.targetIndex === input.targetOrdinal
  )
  const target = input.project.json.targets[input.targetOrdinal]
  if (!evidence || !target || target.isStage)
    throw new Error('behavior fingerprint target is absent')
  const index = buildSemanticReferenceIndex(input.project)
  const inbound = targetInboundReferenceSetV1(
    input.project,
    index,
    input.targetOrdinal
  )
  const activation = targetProspectiveNameActivationV1(
    input.project,
    index,
    BEHAVIOR_NEW_NAME
  )
  const provisional = {
    kind: 'target.renameSprite' as const,
    opId: 'rename-generated-sprite',
    target: exactTargetRef(evidence),
    expectedName: targetExpectedStringIdentityV1(target.name),
    newName: BEHAVIOR_NEW_NAME,
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0 as const,
    },
    expectedPlanningFactSetSha256: '0'.repeat(64),
  }
  const operation = Object.freeze({
    ...provisional,
    expectedPlanningFactSetSha256: productionTargetPlanningFactSetSha256V1(
      input.project,
      provisional,
      input.targetOrdinal,
      lineage
    ),
  })
  const candidate = ProjectIR.fromProjectJsonWithUidSnapshot(
    structuredClone(input.project.toProjectJson()),
    input.project.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    })),
    input.project.uids.snapshot() as UidSnapshot
  )
  const applied = applyTargetOperationV1(candidate, {
    operation,
    targetIndex: input.targetOrdinal,
    activeLineage: lineage,
  })
  const candidateBytes = await candidate.toSb3()
  const correspondence = unchangedTargetCorrespondence(
    input.sourceArtifactSha256,
    sha256Hex(candidateBytes),
    semanticSourceSha256,
    lineage
  )
  const delta = computeProjectDelta(
    input.project,
    candidate,
    [applied.attribution],
    {
      correspondence,
      correspondenceEvidence: {
        before: captureProjectOrderedHeadEvidence(
          input.project,
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
  return productionOperationChangeFingerprintV1(
    'parent-child',
    delta,
    operation.opId
  )
}

async function deriveMediaChangeFingerprints(input: {
  readonly project: ProjectIR
  readonly contract: EditSemanticChangeContractV1
  readonly addSpriteGoal: SemanticEditOperationGoalTargetAddSpriteV1
  readonly addCostumeGoal: SemanticEditOperationGoalMediaAddCostumeV1
  readonly admittedAsset: AdmittedEditAssetV1
}): Promise<{
  readonly sprite: string
  readonly costume: string
}>
{
  const sourceBytes = await input.project.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const preflight = await inspectSemanticEditArtifact(sourceBytes)
  if (
    sourceArtifactSha256 !== PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1 ||
    !preflight.ok ||
    !preflight.semanticSourceIdentity
  )
    throw new Error('media fingerprint lacks exact template source authority')
  const semanticSourceSha256 = semanticHashV1('semantic-source', {
    ...preflight.semanticSourceIdentity,
    sourceKind: 'registeredTemplate',
    templateArtifactSha256: PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
    templateId: GREENFIELD_TEMPLATE_ID_V1,
    templateVersion: GREENFIELD_TEMPLATE_VERSION_V1,
  })
  const sourceLineage = buildSourceLineageV1(
    input.project,
    semanticSourceSha256
  )
  const candidate = ProjectIR.fromProjectJsonWithUidSnapshot(
    structuredClone(input.project.toProjectJson()),
    input.project.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    })),
    input.project.uids.snapshot() as UidSnapshot
  )
  let changeContractSha256 = semanticHashV1('change-contract', input.contract)
  const acceptedHistorySha256 = 'f'.repeat(64)
  const transactionInput = {
    sessionId: 'dry-production-media-session',
    sourceBytes,
    currentBytes: sourceBytes,
    semanticSourceSha256,
    sourceArtifactSha256,
    currentHead: {
      sourceArtifactSha256,
      revisionNumber: 0,
      revisionId: sourceArtifactSha256,
      candidateSha256: sourceArtifactSha256,
      assetManifestSha256: '1'.repeat(64),
      changeContractSha256,
      capabilityProfileSha256: '2'.repeat(64),
      capabilitySnapshotSha256: '3'.repeat(64),
    },
    currentRevision: {
      lineageHistory: sourceLineage.history,
    },
    acceptedHistorySha256,
    changeContractSha256,
    changeContract: input.contract,
    canonicalTransaction: null,
    resolveAdmittedAsset: (assetToken: string) =>
      assetToken === input.admittedAsset.assetToken
        ? input.admittedAsset
        : null,
  } as unknown as ProductionOperationContextV1['input']
  const resolveOwnerLineageId = (): undefined => undefined
  let activeLineage = sourceLineage.active
  let lineageHistory = sourceLineage.history
  let futureBindingLedger = emptyFutureBindingLedgerV1(changeContractSha256)
  const resultsById = new Map<string, unknown>()
  const attributions: Array<
    ReturnType<
      ReturnType<
        typeof groupFProductionOperationDispatchersV1
      >[number]['execute']
    >['attribution']
  > = []
  const dispatchers = new Map(
    groupFProductionOperationDispatchersV1().flatMap((dispatcher) =>
      dispatcher.operationKinds.map((kind) => [kind, dispatcher] as const)
    )
  )
  const context = (): ProductionOperationContextV1 => ({
    input: transactionInput,
    source: input.project,
    preBatch: input.project,
    candidate,
    contract: input.contract,
    operationResultsById: resultsById,
    preBatchLineage: sourceLineage.active,
    activeLineage,
    futureBindingLedger,
  })
  const apply = (
    operation: SemanticEditOperationV1,
    beforeLedgerAdvance?: (
      dispatched: ProductionOperationDispatchResultV1
    ) => void
  ): void =>
  {
    const dispatcher = dispatchers.get(operation.kind)
    if (!dispatcher)
      throw new Error(
        `production media dispatcher is absent for ${operation.kind}`
      )
    const dispatched = dispatcher.execute(context(), operation)
    beforeLedgerAdvance?.(dispatched)
    const priorLineageHistory = lineageHistory
    activeLineage = dispatched.activeLineage
    lineageHistory = mergeProductionLineageHistoryV1(
      lineageHistory,
      activeLineage
    )
    futureBindingLedger = advanceProductionFutureBindingLedgerV1({
      ledger: futureBindingLedger,
      changeContractSha256,
      contract: input.contract,
      priorLineageHistory,
      lineageHistory,
      creatorOperationOccurrenceId: editOperationOccurrenceIdV1(
        acceptedHistorySha256,
        operation.opId
      ),
      predecessorAcceptedHistorySha256: acceptedHistorySha256,
      creatorOperationId: operation.opId,
      creatorOperationKind: operation.kind,
      candidates: dispatched.futureBindingRealizationCandidates ?? [],
      resolveOwnerLineageId,
    })
    resultsById.set(operation.opId, dispatched.result)
    attributions.push(dispatched.attribution)
  }
  const addSprite = productionGroupFSpritePlanningCompletionV1(
    context(),
    input.addSpriteGoal
  ).operation
  apply(addSprite, (dispatched) =>
  {
    const partialDelta = computeProjectDelta(input.project, candidate, [
      dispatched.attribution,
    ])
    const mutableContract = input.contract as MutableContractV1
    mutableContract.requiredStructuralChanges = [
      {
        objectiveId: 'dry-created-sprite-delta-required',
        kind: 'deltaContains',
        direction: 'parent-child',
        operationKind: 'target.addSprite',
        semanticScopeSha256: productionContractScopeSha256V1(
          dispatched.selectedScope
        ),
        semanticChangeFingerprint: productionOperationChangeFingerprintV1(
          'parent-child',
          partialDelta,
          addSprite.opId
        ),
      },
      ...mutableContract.requiredStructuralChanges,
    ]
    changeContractSha256 = semanticHashV1('change-contract', mutableContract)
    ;(
      transactionInput as unknown as { changeContractSha256: string }
    ).changeContractSha256 = changeContractSha256
    futureBindingLedger = emptyFutureBindingLedgerV1(changeContractSha256)
  })
  const addCostume = productionGroupFAddCostumePlanningCompletionV1(
    context(),
    input.addCostumeGoal
  ).operation
  apply(addCostume)
  const candidateBytes = await candidate.toSb3()
  const correspondence = productionProjectCorrespondenceV1(
    sourceArtifactSha256,
    sha256Hex(candidateBytes),
    semanticSourceSha256,
    input.project,
    candidate,
    sourceLineage.active,
    activeLineage
  )
  const delta = productionComputeCorrespondedDeltaV1(
    input.project,
    candidate,
    attributions,
    correspondence,
    sourceLineage.active,
    activeLineage
  )
  const serialized = JSON.stringify(delta)
  for (const operation of [addSprite, addCostume])
    if (!serialized.includes(operation.opId))
      throw new Error(
        `dry media delta has no attribution for ${operation.kind}`
      )
  return Object.freeze({
    sprite: productionOperationChangeFingerprintV1(
      'parent-child',
      delta,
      addSprite.opId
    ),
    costume: productionOperationChangeFingerprintV1(
      'parent-child',
      delta,
      addCostume.opId
    ),
  })
}

function retainedPolicies(
  id: string,
  scenarioId: string
): RetainedPolicyBundleV1
{
  const scenario = Object.freeze({
    scenarioId,
    applicability: 'baselineAndCandidate',
    seed: 7,
    fixedDateMs: FIXED_DATE_MS,
    maxTicks: 20,
    steps: Object.freeze([
      { do: 'greenFlag' as const },
      { do: 'wait' as const, ticks: 5 },
      { do: 'snapshot' as const, label: 'settled' },
    ]),
  }) satisfies EditScenarioPolicyV1
  const runtime = Object.freeze({
    schemaVersion: 1,
    cells: Object.freeze([
      Object.freeze({
        lane: 'officialHeadless',
        scenarioId,
        observationPlan: defaultObservationPlan(),
        observationCaps: DEFAULT_RUNTIME_OBSERVATION_CAPS,
      }),
    ]),
    allowedNewDiagnosticFingerprints: Object.freeze([]),
  })
  const lens = Object.freeze({
    schemaVersion: 1,
    id: `${id}-final-state`,
    required: true,
    appliesTo: 'baseline-candidate',
    kind: 'final-state',
    absoluteNumericTolerance: 0,
  })
  const scenarioBytes = canonicalJsonBytesV1(scenario)
  const runtimeBytes = canonicalJsonBytesV1(runtime)
  const lensBytes = canonicalJsonBytesV1(lens)
  return Object.freeze({
    scenario: scenarioBytes,
    runtime: runtimeBytes,
    lens: lensBytes,
    scenarioSemanticSha256: scenarioPolicyValueSemanticSha256V1(scenario),
    runtimeSemanticSha256: semanticHashV1('evidence-content', {
      kind: 'benchmark-runtime-policy',
      id,
      artifactSha256: sha256Hex(runtimeBytes),
    }),
    lensSemanticSha256: semanticHashV1('evidence-content', {
      kind: 'benchmark-lens-policy',
      id,
      artifactSha256: sha256Hex(lensBytes),
    }),
  })
}

function attachPolicies(
  contract: MutableContractV1,
  bundle: RetainedPolicyBundleV1,
  plan: (hashes: {
    readonly scenario: string
    readonly runtime: string
    readonly lens: string
  }) => EditEvaluationPlanV1
): void
{
  contract.policyBindings = [
    {
      bindingId: 'scenario-policy',
      kind: 'scenario',
      schemaVersion: 1,
      semanticSha256: bundle.scenarioSemanticSha256,
      retainedArtifactSha256: sha256Hex(bundle.scenario),
    },
    {
      bindingId: 'runtime-policy',
      kind: 'runtime',
      schemaVersion: 1,
      semanticSha256: bundle.runtimeSemanticSha256,
      retainedArtifactSha256: sha256Hex(bundle.runtime),
    },
    {
      bindingId: 'lens-policy',
      kind: 'lens',
      schemaVersion: 1,
      semanticSha256: bundle.lensSemanticSha256,
      retainedArtifactSha256: sha256Hex(bundle.lens),
    },
  ]
  contract.evaluationPlans = [
    plan({
      scenario: bundle.scenarioSemanticSha256,
      runtime: bundle.runtimeSemanticSha256,
      lens: bundle.lensSemanticSha256,
    }),
  ]
  contract.exportRequiredPlanId = contract.evaluationPlans[0]!.planId
}

function laneRequirements(): readonly LaneRequirementV1[]
{
  return EVALUATION_LANE_ORDER_V1.map((lane) =>
    lane === 'projectPreflight' || lane === 'officialHeadless'
      ? {
          lane,
          disposition: 'required' as const,
          requiredUnavailableResult: 'unavailable' as const,
        }
      : { lane, disposition: 'forbidden' as const }
  )
}

function registration(
  label: string,
  contractValue: unknown
): EditChangeContractRegistrationV1
{
  const parsed = parseSemanticChangeContractV1(contractValue)
  if (!parsed.ok)
    throw new Error(
      `${label} contract is invalid: ${JSON.stringify(parsed.issues)}`
    )
  const semanticContractSha256 = semanticHashV1('change-contract', parsed.value)
  const provenance = Object.freeze({
    authorityId: `benchmark-authority-${semanticContractSha256.slice(0, 24)}`,
    hostConfigurationSha256: canonicalSha256({ schemaVersion: 1, label }),
    provenanceArtifactSha256: canonicalSha256({
      schemaVersion: 1,
      label,
      semanticContractSha256,
    }),
    registeredAt: '2026-07-21T00:00:00.000Z',
  })
  const displayObjective = boundedDisplayStringV1(
    label === 'behavior'
      ? 'rename one generated sprite while preserving runtime behavior'
      : 'create one sprite with one admitted costume from the pinned template'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const registrationId = `benchmark-${label}-${semanticContractSha256.slice(0, 24)}`
  return Object.freeze({
    schemaVersion: 1,
    registrationId,
    semanticContract: parsed.value,
    semanticContractSha256,
    bindingDisplayEvidence: Object.freeze([]),
    displayObjective,
    provenance,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  })
}

async function behaviorContract(
  project: ProjectIR,
  sourceArtifactSha256: string
): Promise<{
  readonly registration: EditChangeContractRegistrationV1
  readonly targetOrdinal: number
  readonly ambiguousTarget: TargetRefV1
  readonly goal: Omit<SemanticEditOperationGoalTargetRenameSpriteV1, 'target'>
  readonly policies: RetainedPolicyBundleV1
}>
{
  const target = targetEntityEvidenceSetV1(project.json).find(
    (entry) => entry.targetKind === 'sprite'
  )
  if (!target) throw new Error('generated behavior project has no sprite')
  const sourceTarget = project.json.targets[target.targetIndex]
  if (!sourceTarget || sourceTarget.isStage)
    throw new Error('generated behavior target is not a sprite')
  const spriteEvidence = targetEntityEvidenceSetV1(project.json).filter(
    (entry) => entry.targetKind === 'sprite'
  )
  if (spriteEvidence.length < 2)
    throw new Error('generated behavior project needs two sprite targets')
  const ambiguousTarget = Object.freeze({
    entityKind: 'target' as const,
    refKind: 'structural' as const,
    selectorKind: 'matchSet' as const,
    scope: { scopeKind: 'project' as const },
    criteria: {
      conjunction: [
        {
          criterionKind: 'property' as const,
          semanticSurface: 'target',
          property: 'x',
        },
      ],
    },
    expectedMatchCount: spriteEvidence.length,
    expectedOrderedMatchSetSha256: semanticHashV1('evidence-content', {
      kind: 'target-ordered-match-set',
      schemaVersion: 1,
      matches: spriteEvidence.map((entry) => ({
        fullLocationSha256: entry.semanticLocationSha256,
        semanticFingerprintSha256: entry.semanticFingerprintSha256,
        contextFingerprintSha256: entry.contextFingerprintSha256,
      })),
    }),
    selection: { kind: 'exactlyOne' as const },
    expectedSelectedFullLocationSha256: target.semanticLocationSha256,
    expectedSelectedSemanticFingerprint: target.semanticFingerprintSha256,
    expectedSelectedContextFingerprint: target.contextFingerprintSha256,
  }) satisfies TargetRefV1
  const binding = Object.freeze({
    contractRefKind: 'existing' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    bindingKey: 'behavior-sprite',
  })
  const scope = Object.freeze({
    scopeSubjectKind: 'entity' as const,
    operationKind: 'target.renameSprite' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    locationScope: Object.freeze({
      scopeKind: 'exactEntity' as const,
      entity: binding,
    }),
    allowedPropertyPaths: Object.freeze([
      Object.freeze({ surface: 'target' as const, property: 'name' as const }),
    ]),
  })
  const contract = structuredClone(
    SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
  ) as MutableContractV1
  contract.sourceConstraint = {
    kind: 'exactArtifact',
    sourceArtifactSha256,
  }
  contract.entityBindings = [
    {
      bindingKey: binding.bindingKey,
      bindingKind: 'existing',
      entityKind: 'target',
      entitySubtype: 'sprite',
      expectedMatchCount: 1,
      sourceLocationSha256: target.semanticLocationSha256,
      expectedSourceSemanticFingerprint: target.semanticFingerprintSha256,
      expectedSourceContextFingerprint: target.contextFingerprintSha256,
    },
  ]
  contract.allowedOperationKinds = ['target.renameSprite']
  contract.allowedSemanticScopes = [scope]
  contract.allowedStructuralChanges = [
    {
      allowanceId: 'behavior-name-transition',
      kind: 'propertyTransition',
      entity: binding,
      property: { surface: 'target', property: 'name' },
      beforeValueSha256: productionCanonicalValueSha256V1(sourceTarget.name),
      afterValueSha256: productionCanonicalValueSha256V1(BEHAVIOR_NEW_NAME),
    },
  ]
  const requiredName = Object.freeze({
    objectiveId: 'behavior-name-required',
    kind: 'propertyEquals' as const,
    entity: binding,
    property: { surface: 'target' as const, property: 'name' as const },
    canonicalValueSha256: productionCanonicalValueSha256V1(BEHAVIOR_NEW_NAME),
  })
  contract.requiredStructuralChanges = [requiredName]
  contract.stateProjectionMasks = []
  contract.cloneProjectionMasks = []
  contract.visualProjectionMasks = []
  contract.outputNamePolicy = { kind: 'exact', basename: BEHAVIOR_OUTPUT }
  const policies = retainedPolicies('behavior', 'behavior-scenario')
  attachPolicies(contract, policies, (hashes) => ({
    planId: 'behavior-evaluation',
    planClass: 'behavioralEdit',
    requiredForExport: true,
    scenarioPolicySha256s: [hashes.scenario],
    runtimePolicySha256: hashes.runtime,
    requiredRuntimeChanges: [
      {
        objectiveId: 'behavior-runtime',
        kind: 'stateAtLabel',
        scenarioId: 'behavior-scenario',
        lane: 'officialHeadless',
        label: 'settled',
        path: {
          pathKind: 'targetProperty',
          target: binding,
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
        scenarioId: 'behavior-scenario',
        lane: 'officialHeadless',
        lensPolicySha256: hashes.lens,
        required: true,
      },
    ],
    laneRequirements: laneRequirements(),
  }))
  const semanticChangeFingerprint = await deriveBehaviorChangeFingerprint({
    project,
    sourceArtifactSha256,
    targetOrdinal: target.targetIndex,
  })
  contract.requiredStructuralChanges = [
    {
      objectiveId: 'behavior-delta-required',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'target.renameSprite',
      semanticScopeSha256: productionContractScopeSha256V1(scope),
      semanticChangeFingerprint,
    },
    requiredName,
  ]
  const finalRegistration = registration('behavior', contract)
  return Object.freeze({
    registration: finalRegistration,
    targetOrdinal: target.targetIndex,
    ambiguousTarget,
    goal: Object.freeze({
      kind: 'target.renameSprite',
      opId: 'rename-generated-sprite',
      newName: BEHAVIOR_NEW_NAME,
    }),
    policies,
  })
}

async function mediaContract(mediaBytes: Uint8Array): Promise<{
  readonly registration: EditChangeContractRegistrationV1
  readonly addSpriteGoal: SemanticEditOperationGoalTargetAddSpriteV1
  readonly addCostumeGoal: SemanticEditBenchmarkFixtureV1['media']['addCostumeGoal']
  readonly expectedPayloadSha256: string
  readonly expectedMetadataSha256: string
  readonly policies: RetainedPolicyBundleV1
}>
{
  const project = ProjectIR.fromProjectJson(
    buildGreenfieldTemplateProjectJsonV1(),
    greenfieldTemplateAssetsV1().map((asset) => ({
      path: asset.path,
      bytes: Uint8Array.from(asset.bytes),
    }))
  )
  const identity = await deriveAuthoringMediaIdentity(
    mediaBytes,
    'costume',
    resolveEditAdmissionLimits()
  )
  const asset = Object.freeze({
    assetToken: 'asset_benchmark_unadmitted',
    expectedPayloadSha256: identity.sha256,
    expectedMetadataSha256: editCanonicalSha256V1(identity),
  }) as SemanticEditOperationMediaAddCostumeV1['asset']
  const spriteRef = Object.freeze({
    contractRefKind: 'future' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    bindingKey: 'created-sprite',
  })
  const addSpriteGoal = Object.freeze({
    kind: 'target.addSprite' as const,
    opId: 'add-generated-sprite',
    name: CREATED_SPRITE_NAME,
    visualLayerOrdinal: 1,
    properties: Object.freeze({
      x: 12,
      y: -34,
      direction: 90,
      size: 100,
      visible: true,
      draggable: false,
      rotationStyle: 'all around' as const,
      volume: 100,
    }),
  })
  const targetDescriptor = Object.freeze({
    bindingKind: 'future' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    expectedCreatorOperationKind: 'target.addSprite' as const,
    expectedCreationRole: Object.freeze({
      roleKind: 'fixed' as const,
      name: 'target' as const,
      entityKind: 'target' as const,
      entitySubtype: 'sprite' as const,
    }),
    expectedCreationScope: Object.freeze({
      scopeKind: 'projectEntityCollection' as const,
      collection: 'targets' as const,
    }),
  }) satisfies GroupFCreationBindingDescriptorV1
  const costumeDescriptor = Object.freeze({
    bindingKind: 'future' as const,
    entityKind: 'media' as const,
    entitySubtype: 'costume' as const,
    expectedCreatorOperationKind: 'media.addCostume' as const,
    expectedCreationRole: Object.freeze({
      roleKind: 'fixed' as const,
      name: 'media' as const,
      entityKind: 'media' as const,
      entitySubtype: 'costume' as const,
    }),
    expectedCreationScope: Object.freeze({
      scopeKind: 'targetAndOwnedDescendants' as const,
      target: spriteRef,
    }),
  }) satisfies GroupFCreationBindingDescriptorV1
  const targetContentSha256 = groupFCreationContentFingerprintForResultV1({
    project,
    targetIndex: 1,
    operation: {
      ...addSpriteGoal,
      expectedPlanningFactSetSha256: 'a'.repeat(64),
    } as Extract<SemanticEditOperationV1, { kind: 'target.addSprite' }>,
    descriptor: targetDescriptor,
    resultRole: { roleKind: 'fixed', name: 'target' },
    resolveContractEntityRef: () => spriteRef,
  })
  const unplannedCostume: Omit<
    SemanticEditOperationMediaAddCostumeV1,
    'expectedPlanningFactSetSha256'
  > = {
    kind: 'media.addCostume' as const,
    opId: 'add-generated-costume',
    target: {
      entityKind: 'target' as const,
      refKind: 'created' as const,
      opId: addSpriteGoal.opId,
      slot: { slotKind: 'fixed' as const, name: 'target' as const },
    },
    asset,
    name: CREATED_COSTUME_NAME,
    order: 0,
    placement: { kind: 'derivedImageCenter' as const },
    nameActivation: {
      expectedActivationSetSha256: 'b'.repeat(64),
      requireProspectiveActivationCount: 0 as const,
    },
    currentSelection: {
      selectionState: 'uninitializedCreatedTarget' as const,
      expectedCostumeCount: 0,
    },
    expectedCostumeOrderSha256: 'c'.repeat(64),
    expectedFinalCurrentCostumeState: { state: 'missing' as const },
  }
  const costumeContentSha256 = groupFCreationContentFingerprintForResultV1({
    project,
    targetIndex: 1,
    operation: {
      ...unplannedCostume,
      expectedPlanningFactSetSha256: 'd'.repeat(64),
    },
    descriptor: costumeDescriptor,
    resultRole: { roleKind: 'fixed', name: 'media' },
    resolveContractEntityRef: () => spriteRef,
  })
  const spriteScope = Object.freeze({
    scopeSubjectKind: 'entity' as const,
    operationKind: 'target.addSprite' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    locationScope: Object.freeze({
      scopeKind: 'projectEntityCollection' as const,
      collection: 'targets' as const,
    }),
    allowedPropertyPaths: Object.freeze([
      { surface: 'target' as const, property: 'name' as const },
      { surface: 'target' as const, property: 'layerOrder' as const },
    ]),
  }) satisfies ContractScopeV1
  const costumeScope = Object.freeze({
    scopeSubjectKind: 'entity' as const,
    operationKind: 'media.addCostume' as const,
    entityKind: 'media' as const,
    entitySubtype: 'costume' as const,
    locationScope: Object.freeze({
      scopeKind: 'targetAndOwnedDescendants' as const,
      target: spriteRef,
    }),
    allowedPropertyPaths: Object.freeze([
      { surface: 'media' as const, property: 'name' as const },
    ]),
  }) satisfies ContractScopeV1
  const contract = structuredClone(
    SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
  ) as MutableContractV1
  contract.sourceConstraint = {
    kind: 'template',
    templateId: GREENFIELD_TEMPLATE_ID_V1,
    version: String(GREENFIELD_TEMPLATE_VERSION_V1),
    artifactSha256: PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
  }
  contract.entityBindings = [
    {
      bindingKey: spriteRef.bindingKey,
      ...targetDescriptor,
      expectedCreationContentFingerprintSha256: targetContentSha256,
    },
    {
      bindingKey: 'created-costume',
      ...costumeDescriptor,
      expectedCreationContentFingerprintSha256: costumeContentSha256,
    },
  ]
  contract.allowedOperationKinds = ['target.addSprite', 'media.addCostume']
  contract.allowedSemanticScopes = [spriteScope, costumeScope]
  contract.allowedStructuralChanges = [
    {
      allowanceId: 'created-sprite-allowance',
      kind: 'entityAddition',
      candidate: spriteRef,
      expectedAddedContentSha256: targetContentSha256,
    },
    {
      allowanceId: 'created-costume-allowance',
      kind: 'entityAddition',
      candidate: {
        contractRefKind: 'future',
        entityKind: 'media',
        entitySubtype: 'costume',
        bindingKey: 'created-costume',
      },
      expectedAddedContentSha256: costumeContentSha256,
    },
  ]
  const requiredSprite = Object.freeze({
    objectiveId: 'created-sprite-required',
    kind: 'entityExists' as const,
    candidate: spriteRef,
  })
  contract.requiredStructuralChanges = [requiredSprite]
  contract.stateProjectionMasks = [
    {
      maskId: 'created-sprite-final-state',
      maskKind: 'oneSidedTarget',
      scenarioId: 'media-scenario',
      side: 'candidate',
      labels: 'final',
      target: spriteRef,
      expectedTargetMatchesPerObservation: 1,
      expectedTargetPaneOrderMatchesPerObservation: 1,
      expectedExecutableOrderMatchesPerObservation: 1,
    },
  ]
  contract.cloneProjectionMasks = []
  contract.visualProjectionMasks = []
  contract.outputNamePolicy = { kind: 'exact', basename: MEDIA_OUTPUT }
  const policies = retainedPolicies('media', 'media-scenario')
  attachPolicies(contract, policies, (hashes) => ({
    planId: 'media-evaluation',
    planClass: 'behavioralEdit',
    requiredForExport: true,
    scenarioPolicySha256s: [hashes.scenario],
    runtimePolicySha256: hashes.runtime,
    requiredRuntimeChanges: [
      {
        objectiveId: 'created-sprite-runtime',
        kind: 'stateAtLabel',
        scenarioId: 'media-scenario',
        lane: 'officialHeadless',
        label: 'settled',
        path: {
          pathKind: 'targetProperty',
          target: spriteRef,
          property: 'x',
        },
        assertion: {
          comparator: 'equals',
          expected: { valueKind: 'scalar', value: 12 },
        },
      },
    ],
    preservationLenses: [
      {
        lensKind: 'finalState',
        scenarioId: 'media-scenario',
        lane: 'officialHeadless',
        lensPolicySha256: hashes.lens,
        required: true,
        stateMaskIds: ['created-sprite-final-state'],
      },
    ],
    laneRequirements: laneRequirements(),
  }))
  const addCostumeGoal = {
    kind: 'media.addCostume' as const,
    opId: 'add-generated-costume',
    target: unplannedCostume.target,
    asset,
    name: CREATED_COSTUME_NAME,
    order: 0,
    placement: { kind: 'derivedImageCenter' as const },
  }
  const derivedFingerprints = await deriveMediaChangeFingerprints({
    project,
    contract,
    addSpriteGoal,
    addCostumeGoal,
    admittedAsset: {
      assetToken: asset.assetToken,
      mediaKind: 'costume',
      payloadSha256: identity.sha256,
      metadataSha256: editCanonicalSha256V1(identity),
      bytes: Uint8Array.from(mediaBytes),
      identity,
    },
  })
  contract.requiredStructuralChanges = [
    {
      objectiveId: 'created-sprite-delta-required',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'target.addSprite',
      semanticScopeSha256: productionContractScopeSha256V1(spriteScope),
      semanticChangeFingerprint: derivedFingerprints.sprite,
    },
    {
      objectiveId: 'created-costume-delta-required',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'media.addCostume',
      semanticScopeSha256: productionContractScopeSha256V1(costumeScope),
      semanticChangeFingerprint: derivedFingerprints.costume,
    },
    requiredSprite,
  ]
  const finalRegistration = registration('media', contract)
  return Object.freeze({
    registration: finalRegistration,
    addSpriteGoal,
    addCostumeGoal: (
      admittedAsset: SemanticEditOperationMediaAddCostumeV1['asset']
    ) =>
      Object.freeze({
        kind: 'media.addCostume' as const,
        opId: 'add-generated-costume',
        target: unplannedCostume.target,
        asset: admittedAsset,
        name: CREATED_COSTUME_NAME,
        order: 0,
        placement: { kind: 'derivedImageCenter' as const },
      }),
    expectedPayloadSha256: identity.sha256,
    expectedMetadataSha256: editCanonicalSha256V1(identity),
    policies,
  })
}

function writeRegistrationBundle(
  root: string,
  label: 'behavior' | 'media',
  registrationValue: EditChangeContractRegistrationV1,
  policies: RetainedPolicyBundleV1
): {
  readonly registrationRelativePath: string
  readonly retainedPolicyRelativePaths: readonly string[]
}
{
  const registrationRelativePath = `registrations/${label}.json`
  const retainedPolicyRelativePaths = [
    `policies/${label}-scenario.json`,
    `policies/${label}-runtime.json`,
    `policies/${label}-lens.json`,
  ]
  ensurePrivateDirectory(join(root, 'registrations'))
  ensurePrivateDirectory(join(root, 'policies'))
  writeExclusive(
    join(root, registrationRelativePath),
    canonicalJsonBytesV1(registrationValue)
  )
  for (const [path, bytes] of retainedPolicyRelativePaths.map(
    (path, index) =>
      [
        path,
        [policies.scenario, policies.runtime, policies.lens][index]!,
      ] as const
  ))
    writeExclusive(join(root, path), bytes)
  return Object.freeze({
    registrationRelativePath,
    retainedPolicyRelativePaths: Object.freeze(retainedPolicyRelativePaths),
  })
}

export async function writeSemanticEditBenchmarkFixtureV1(input: {
  readonly root: string
  readonly inputs: SemanticEditGeneratedInputsV1
}): Promise<SemanticEditBenchmarkFixtureV1>
{
  ensurePrivateDirectory(input.root)
  const behaviorBytes = readFileSync(input.inputs.behaviorProject.path)
  const mediaBytes = readFileSync(input.inputs.mediaAsset.path)
  const behaviorProject = await ProjectIR.fromSb3(behaviorBytes)
  const behavior = await behaviorContract(
    behaviorProject,
    input.inputs.behaviorProject.sha256
  )
  const media = await mediaContract(mediaBytes)
  const rows = [
    writeRegistrationBundle(
      input.root,
      'behavior',
      behavior.registration,
      behavior.policies
    ),
    writeRegistrationBundle(
      input.root,
      'media',
      media.registration,
      media.policies
    ),
  ]
  const registryPath = join(input.root, 'contract-registry.json')
  writeJsonExclusive(registryPath, {
    schemaVersion: 1,
    kind: 'production-edit-contract-registry-v1',
    registrations: rows,
  })
  return Object.freeze({
    registryPath,
    behaviorContract: Object.freeze({
      registrationId: behavior.registration.registrationId,
      semanticContractSha256: behavior.registration.semanticContractSha256,
      evaluationPlanId: 'behavior-evaluation',
    }),
    mediaContract: Object.freeze({
      registrationId: media.registration.registrationId,
      semanticContractSha256: media.registration.semanticContractSha256,
      evaluationPlanId: 'media-evaluation',
      templateId: GREENFIELD_TEMPLATE_ID_V1,
      templateVersion: String(GREENFIELD_TEMPLATE_VERSION_V1),
      templateArtifactSha256: PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
    }),
    behavior: Object.freeze({
      targetOrdinal: behavior.targetOrdinal,
      newName: BEHAVIOR_NEW_NAME,
      ambiguousTarget: behavior.ambiguousTarget,
      semanticChangeFingerprint:
        behavior.registration.semanticContract.requiredStructuralChanges
          .flatMap((predicate) =>
            predicate.kind === 'deltaContains'
              ? [predicate.semanticChangeFingerprint]
              : []
          )
          .at(0)!,
      goal: behavior.goal,
      outputBasename: BEHAVIOR_OUTPUT,
    }),
    media: Object.freeze({
      addSpriteGoal: media.addSpriteGoal,
      addCostumeGoal: media.addCostumeGoal,
      expectedPayloadSha256: media.expectedPayloadSha256,
      expectedMetadataSha256: media.expectedMetadataSha256,
      spriteChangeFingerprint:
        media.registration.semanticContract.requiredStructuralChanges
          .flatMap((predicate) =>
            predicate.kind === 'deltaContains' &&
            predicate.operationKind === 'target.addSprite'
              ? [predicate.semanticChangeFingerprint]
              : []
          )
          .at(0)!,
      costumeChangeFingerprint:
        media.registration.semanticContract.requiredStructuralChanges
          .flatMap((predicate) =>
            predicate.kind === 'deltaContains' &&
            predicate.operationKind === 'media.addCostume'
              ? [predicate.semanticChangeFingerprint]
              : []
          )
          .at(0)!,
      outputBasename: MEDIA_OUTPUT,
    }),
  })
}
