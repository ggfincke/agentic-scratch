// packages/edit/src/dispatch/group-f-dispatchers.ts
// dispatch exact costume & sound record, order, payload, & current-costume operations

import type { ProjectIR } from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  applyMediaOperationV1,
  applyTargetAddSpriteV1,
  buildSemanticReferenceIndex,
  currentCostumeStateV1,
  expectedStringIdentityV1,
  groupFCreationContentFingerprintForResultV1,
  mediaBoundedLocationProjectionV1,
  mediaDomainOrderPolicyV1,
  mediaLineageRawIdentityV1,
  mediaNameActivationEvidenceV1,
  mediaCollectionPathV1,
  mediaOrderEvidenceV1,
  mediaReachabilityEvidenceV1,
  mediaRecordEntityEvidenceSetV1,
  mediaReferenceEvidenceV1,
  reconciledCurrentCostumeStateV1,
  resolveMediaRefV1,
  semanticHashV1,
  shiftedOrdinalV1,
  targetEntityEvidenceSetV1,
  targetProspectiveNameActivationV1,
  SEMANTIC_LINEAGE_VERSION_V1,
  validateSemanticLineageSnapshot,
  type AppliedMediaOperationV1,
  type ContractEntityRefV1,
  type ContractScopeV1,
  type CostumeSelectionPreconditionV1,
  type GroupFCreationOperationV1,
  type GroupFCreationResultRoleV1,
  type MediaRecordEntityEvidenceV1,
  type MediaRefV1,
  type MediaSlotV1,
  type ResolvedCostumeSelectionV1,
  type ResolvedMediaOperationV1,
  type SemanticEditOperationMediaAddCostumeV1,
  type SemanticEditOperationMediaAddSoundV1,
  type SemanticEditOperationMediaRemoveCostumeV1,
  type SemanticEditOperationMediaRemoveSoundV1,
  type SemanticEditOperationMediaRenameCostumeV1,
  type SemanticEditOperationMediaRenameSoundV1,
  type SemanticEditOperationMediaReorderCostumeV1,
  type SemanticEditOperationMediaReorderSoundV1,
  type SemanticEditOperationMediaReplaceCostumeV1,
  type SemanticEditOperationMediaReplaceSoundV1,
  type SemanticEditOperationMediaSetCurrentCostumeV1,
  type SemanticEditOperationGoalV1,
  type SemanticEditOperationV1,
  type SemanticLineageSnapshot,
  type TargetCreationOperationV1,
  type TargetEntityEvidenceV1,
  type TargetRefV1,
} from '@scratch-agent/ir/edit'

import {
  assetMaterializationUsageDeltaV1,
  EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1,
  type AdmittedEditAssetV1,
} from '../assets/asset-admission.js'
import {
  bindingRealizationCandidatesV1 as bindingRealizationCandidates,
  cloneDispatcherProjectV1 as cloneProject,
  completedPlanningFactV1 as groupFCompletedFactV1,
  createProductionLineageV1,
  exactContractRefV1 as resolveExactContractRef,
  futureBindingAlreadyRealizedV1 as futureBindingAlreadyRealized,
  productionOperationResultV1,
  targetPlanningProjectionV1 as planningTarget,
} from './dispatcher-primitives.js'
import { futureBindingKeySha256V1 } from '../lineage/future-binding-ledger.js'
import type { FutureContractBindingV1 } from '../lineage/future-binding-ledger.js'
import { editJsonPointerPartV1 as pointerPart } from '../support/internal-values.js'
import type { CreatedSemanticLineageV1 } from '../lineage/lineage.js'
import {
  exactTargetRef,
  mediaBindingKeys,
  mediaLineageAt,
  planningContext,
  resolveTargetSelection,
  resolverAdapters,
  targetBindingKeys,
  targetLineageAt,
  tombstoneLineage,
  uniqueSorted,
  type GroupCPlanningEntityProjectionV1,
  type GroupCProductionResultSlotV1,
} from './group-c-dispatchers.js'
import type {
  EditOperationPlanningFactV1,
  EditOperationPlanningResultV1,
} from '../transaction/transaction.js'
import type {
  ProductionOperationContextV1,
  ProductionOperationDispatcherV1,
  ProductionOperationDispatchResultV1,
  ProductionStructuralAuthorizationV1,
} from '../transaction/production-transaction.js'

type CostumeOperationV1 =
  | SemanticEditOperationMediaAddCostumeV1
  | SemanticEditOperationMediaRenameCostumeV1
  | SemanticEditOperationMediaReorderCostumeV1
  | SemanticEditOperationMediaReplaceCostumeV1
  | SemanticEditOperationMediaRemoveCostumeV1
  | SemanticEditOperationMediaSetCurrentCostumeV1

type SoundOperationV1 =
  | SemanticEditOperationMediaAddSoundV1
  | SemanticEditOperationMediaRenameSoundV1
  | SemanticEditOperationMediaReorderSoundV1
  | SemanticEditOperationMediaReplaceSoundV1
  | SemanticEditOperationMediaRemoveSoundV1

type GroupFOperationV1 = CostumeOperationV1 | SoundOperationV1

type MediaFutureContractBindingV1 = Extract<
  FutureContractBindingV1,
  { entityKind: 'media' }
>

// Group F creates exactly one kind of result & it is always fixed, so there is
// no dynamic slot type here at all
interface GroupFProductionOperationResultV1
{
  readonly opId: string
  readonly operationKind: SemanticEditOperationV1['kind']
  readonly selectedLineageIds: readonly string[]
  readonly fixedSlots: readonly GroupCProductionResultSlotV1[]
  readonly postconditionSha256: string
}

interface GroupFPlanningFactProjectionV1
{
  readonly kind: 'group-f-media-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: GroupFOperationV1['kind']
  readonly opId: string
  readonly selectedEntities: readonly GroupCPlanningEntityProjectionV1[]
  readonly selectedLineageIds: readonly string[]
  readonly facts: unknown
}

interface ResolvedMediaSelectionV1
{
  readonly canonical: MediaRecordEntityEvidenceV1
  readonly current: MediaRecordEntityEvidenceV1
  readonly lineageId: string
}

interface ResolvedGroupFDispatchV1
{
  readonly operation: GroupFOperationV1
  readonly canonicalOperation: GroupFOperationV1
  readonly mediaKind: 'costume' | 'sound'
  readonly targetIndex: number
  readonly targetLineageId: string
  readonly selectedMedia: ResolvedMediaSelectionV1 | null
  readonly currentSelection: ResolvedCostumeSelectionV1 | null
  readonly currentSelectionLineageId: string | null
  readonly asset: AdmittedEditAssetV1 | null
  readonly selectedLineageIds: readonly string[]
  readonly planningEntities: readonly GroupCPlanningEntityProjectionV1[]
  readonly facts: unknown
}

interface ReconciledGroupFLineageV1
{
  readonly activeLineage: SemanticLineageSnapshot
  readonly createdMediaLineageId: string | null
  readonly collisionNonce: number | null
  readonly creationKey: string | null
  readonly selectedLineageIds: readonly string[]
}

interface ResultBindingMatchV1
{
  readonly binding: MediaFutureContractBindingV1
  readonly slot: GroupCProductionResultSlotV1
  readonly collisionNonce: number
  readonly creationKey: string
}

const COSTUME_KINDS: ReadonlySet<string> = Object.freeze(
  new Set([
    'media.addCostume',
    'media.renameCostume',
    'media.reorderCostume',
    'media.replaceCostume',
    'media.removeCostume',
    'media.setCurrentCostume',
  ])
)

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {}
): never
{
  throw Object.assign(new Error(message), { code, context })
}

function mediaKindOf(operation: GroupFOperationV1): 'costume' | 'sound'
{
  return COSTUME_KINDS.has(operation.kind) ? 'costume' : 'sound'
}

function mediaLocationArtifactId(
  evidence: MediaRecordEntityEvidenceV1
): string
{
  return `media-location-${evidence.semanticLocationSha256.slice(0, 32)}`
}

export function exactMediaRefV1(
  evidence: MediaRecordEntityEvidenceV1
): MediaRefV1
{
  return {
    entityKind: 'media',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: mediaBoundedLocationProjectionV1(
      evidence,
      mediaLocationArtifactId(evidence)
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

// a same-batch created ref has no exact location in the predecessor revision, so
// canonicalizing it away makes the retained batch unreplayable
function canonicalMediaRef(
  reference: MediaRefV1,
  evidence: MediaRecordEntityEvidenceV1
): MediaRefV1
{
  return reference.refKind === 'created' ? reference : exactMediaRefV1(evidence)
}

function planningMedia(
  evidence: MediaRecordEntityEvidenceV1
): GroupCPlanningEntityProjectionV1
{
  return {
    entityKind: 'media',
    entitySubtype: evidence.mediaKind,
    boundedLocation: mediaBoundedLocationProjectionV1(
      evidence,
      mediaLocationArtifactId(evidence)
    ),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

function exactCurrentTarget(
  project: ProjectIR,
  targetIndex: number
): TargetEntityEvidenceV1
{
  const evidence = targetEntityEvidenceSetV1(project.json)[targetIndex]
  if (!evidence)
    return fail('edit.internal_invariant', 'target evidence is absent')
  return evidence
}

// ---------------------------------------------------------------------------
// media lineage addressing
// ---------------------------------------------------------------------------

function mediaOrdinalForLineage(
  lineage: SemanticLineageSnapshot,
  mediaKind: 'costume' | 'sound',
  ownerLineageId: string,
  lineageId: string
): number
{
  const ordered = activeOrderedSemanticLineages(
    lineage,
    mediaKind,
    ownerLineageId
  )
  const ordinal = ordered.findIndex((record) => record.lineageId === lineageId)
  if (ordinal < 0)
    return fail(
      'edit.invalid_owner',
      'selected media record was detached before use'
    )
  return ordinal
}

function targetIndexForLineage(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  targetLineageId: string
): number
{
  const ordered = activeOrderedSemanticLineages(lineage, 'target', null)
  const targetIndex = ordered.findIndex(
    (record) => record.lineageId === targetLineageId
  )
  if (ordered.length !== project.json.targets.length || targetIndex < 0)
    return fail(
      'edit.internal_invariant',
      'target lineage does not correspond to the candidate'
    )
  return targetIndex
}

// an order change rewrites `canonicalOrdinal` for the whole owned collection at
// once; rebuilding the record array in a single pass is what keeps the
// duplicate-identity invariant true at every intermediate step
function reindexMediaLineageOrder(
  active: SemanticLineageSnapshot,
  mediaKind: 'costume' | 'sound',
  ownerLineageId: string,
  orderedLineageIds: readonly string[]
): SemanticLineageSnapshot
{
  const ordinalByLineageId = new Map(
    orderedLineageIds.map((lineageId, ordinal) => [lineageId, ordinal])
  )
  const siblings = active.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === mediaKind &&
      record.ownerLineageId === ownerLineageId
  )
  if (
    siblings.length !== orderedLineageIds.length ||
    siblings.some((record) => !ordinalByLineageId.has(record.lineageId))
  )
    return fail(
      'edit.internal_invariant',
      `active ${mediaKind} lineage does not match post-operation evidence`
    )
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: active.records.map((record) =>
      ordinalByLineageId.has(record.lineageId) && record.status === 'active'
        ? {
            ...record,
            canonicalOrdinal: ordinalByLineageId.get(record.lineageId)!,
          }
        : record
    ),
  })
}

function createLineage(
  context: ProductionOperationContextV1,
  operationId: string,
  mediaKind: 'costume' | 'sound' | 'target',
  ownerLineageId: string | null,
  rawIdentity: string,
  canonicalOrdinal: number,
  creationKey: string,
  activeLineage: SemanticLineageSnapshot
): CreatedSemanticLineageV1
{
  return createProductionLineageV1(
    context,
    operationId,
    mediaKind,
    ownerLineageId,
    rawIdentity,
    canonicalOrdinal,
    creationKey,
    activeLineage
  )
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

function mediaEvidenceAt(
  project: ProjectIR,
  mediaKind: 'costume' | 'sound',
  targetIndex: number,
  ordinal: number
): MediaRecordEntityEvidenceV1
{
  const evidence = mediaRecordEntityEvidenceSetV1(project).find(
    (candidate) =>
      candidate.mediaKind === mediaKind &&
      candidate.targetIndex === targetIndex &&
      candidate.ordinal === ordinal
  )
  if (!evidence)
    return fail(
      'edit.selector_no_match',
      `${mediaKind} ordinal ${ordinal} is absent from target ${targetIndex}`
    )
  return evidence
}

// the created media slot names its own subtype, so a created reference never
// has to be told whether it points at a costume or a sound
function priorResultMediaSlot(
  context: ProductionOperationContextV1,
  opId: string
): { readonly lineageId: string; readonly mediaKind: 'costume' | 'sound' }
{
  const prior = context.operationResultsById.get(opId) as
    { readonly fixedSlots?: readonly Record<string, unknown>[] } | undefined
  const slots = (prior?.fixedSlots ?? []).filter(
    (slot) =>
      slot['slotKind'] === 'fixed' &&
      slot['name'] === 'media' &&
      slot['entityKind'] === 'media'
  )
  const slot = slots.length === 1 ? slots[0]! : undefined
  const lineageId = slot?.['lineageId']
  const mediaKind = slot?.['entitySubtype']
  if (
    typeof lineageId !== 'string' ||
    (mediaKind !== 'costume' && mediaKind !== 'sound')
  )
    return fail(
      'edit.created_result_invalid',
      `media created ref does not name one media result of ${opId}`
    )
  return { lineageId, mediaKind }
}

// the canonical selection is resolved against the pre-batch revision & then
// followed through the running lineage, so an earlier operation in the same
// batch may have moved the record without invalidating the reference
export function resolveMediaReferenceV1(
  context: ProductionOperationContextV1,
  reference: MediaRefV1
): ResolvedMediaSelectionV1
{
  if (reference.refKind === 'created')
  {
    const created = priorResultMediaSlot(context, reference.opId)
    const lineageId = created.lineageId
    const mediaKind = created.mediaKind
    const owner = context.activeLineage.records.find(
      (record) => record.lineageId === lineageId
    )
    if (!owner || owner.ownerLineageId === null || owner.status !== 'active')
      return fail(
        'edit.created_result_invalid',
        'created media result is absent from the running lineage'
      )
    const targetIndex = targetIndexForLineage(
      context.candidate,
      context.activeLineage,
      owner.ownerLineageId
    )
    const current = mediaEvidenceAt(
      context.candidate,
      mediaKind,
      targetIndex,
      mediaOrdinalForLineage(
        context.activeLineage,
        mediaKind,
        owner.ownerLineageId,
        lineageId
      )
    )
    return { canonical: current, current, lineageId }
  }
  const canonical = resolveMediaRefV1(
    context.preBatch,
    reference,
    resolverAdapters(context)
  )
  const mediaKind = canonical.mediaKind
  const targetLineage = targetLineageAt(
    context.preBatchLineage,
    context.preBatch.json.targets.length,
    canonical.targetIndex
  )
  const lineageId = mediaLineageAt(
    context.preBatchLineage,
    mediaKind,
    targetLineage.lineageId,
    canonical.ordinal
  ).lineageId
  const currentTargetIndex = targetIndexForLineage(
    context.candidate,
    context.activeLineage,
    targetLineage.lineageId
  )
  const current = mediaEvidenceAt(
    context.candidate,
    mediaKind,
    currentTargetIndex,
    mediaOrdinalForLineage(
      context.activeLineage,
      mediaKind,
      targetLineage.lineageId,
      lineageId
    )
  )
  return { canonical, current, lineageId }
}

function resolveMediaSelection(
  context: ProductionOperationContextV1,
  reference: MediaRefV1,
  mediaKind: 'costume' | 'sound'
): ResolvedMediaSelectionV1
{
  const selection = resolveMediaReferenceV1(context, reference)
  if (selection.current.mediaKind !== mediaKind)
    return fail(
      'edit.invalid_shape',
      `selected media is a ${selection.current.mediaKind}, not a ${mediaKind}`
    )
  return selection
}

function resolvedSlot(selection: ResolvedMediaSelectionV1): MediaSlotV1
{
  return {
    targetIndex: selection.current.targetIndex,
    mediaKind: selection.current.mediaKind,
    ordinal: selection.current.ordinal,
  }
}

// planning facts are projected against the pre-batch view, so they must read the
// canonical evidence even when the record has since moved inside this batch
function canonicalSelection(
  selection: ResolvedMediaSelectionV1
): ResolvedMediaSelectionV1
{
  return {
    canonical: selection.canonical,
    current: selection.canonical,
    lineageId: selection.lineageId,
  }
}

// the caller pre-declares the effective current costume as its own media
// reference; resolving it here is what lets the IR prove the declared ordinal,
// raw state, & fingerprint all still describe the same record
function resolveCurrentSelection(
  context: ProductionOperationContextV1,
  precondition: CostumeSelectionPreconditionV1
): {
  readonly resolved: ResolvedCostumeSelectionV1
  readonly lineageId: string | null
  readonly evidence: MediaRecordEntityEvidenceV1 | null
  readonly canonicalEvidence: MediaRecordEntityEvidenceV1 | null
}
{
  if (precondition.selectionState === 'uninitializedCreatedTarget')
    return {
      resolved: { selectionState: 'uninitializedCreatedTarget' },
      lineageId: null,
      evidence: null,
      canonicalEvidence: null,
    }
  const selection = resolveMediaSelection(
    context,
    precondition.expectedEffectiveCurrentCostume,
    'costume'
  )
  return {
    resolved: { selectionState: 'selected', slot: resolvedSlot(selection) },
    lineageId: selection.lineageId,
    evidence: selection.current,
    canonicalEvidence: selection.canonical,
  }
}

function resolveAdmittedAsset(
  context: ProductionOperationContextV1,
  asset: {
    readonly assetToken: string
    readonly expectedPayloadSha256: string
    readonly expectedMetadataSha256: string
  },
  mediaKind: 'costume' | 'sound'
): AdmittedEditAssetV1
{
  const resolve = context.input.resolveAdmittedAsset
  if (!resolve)
    return fail(
      'edit.unsupported_operation',
      'no admitted asset store is configured for media authoring'
    )
  const admitted = resolve(asset.assetToken)
  if (!admitted)
    return fail(
      'edit.stale_handle',
      'asset token names no admitted session record'
    )
  if (admitted.mediaKind !== mediaKind)
    return fail(
      'edit.unsupported_media',
      `admitted asset is a ${admitted.mediaKind}, not a ${mediaKind}`
    )
  if (admitted.payloadSha256 !== asset.expectedPayloadSha256)
    return fail(
      'edit.asset_digest_mismatch',
      'admitted payload digest differs from the declared asset digest'
    )
  // the metadata digest is the parsed-identity proof; the IR never recomputes it
  // because the canonical hash authority lives in this package
  if (admitted.metadataSha256 !== asset.expectedMetadataSha256)
    return fail(
      'edit.asset_metadata_mismatch',
      'admitted metadata digest differs from the declared asset digest'
    )
  return admitted
}

// ---------------------------------------------------------------------------
// planning facts
// ---------------------------------------------------------------------------

function domainFacts(
  project: ProjectIR,
  targetIndex: number,
  mediaKind: 'costume' | 'sound'
): unknown
{
  const target = project.json.targets[targetIndex]
  if (!target)
    return fail('edit.internal_invariant', 'planning target is absent')
  const order = mediaOrderEvidenceV1(target, mediaKind)
  return {
    mediaKind,
    order,
    orderPolicy: mediaDomainOrderPolicyV1(project, targetIndex, mediaKind),
    currentCostume:
      mediaKind === 'costume' ? currentCostumeStateV1(target) : null,
  }
}

function selectedMediaFacts(
  project: ProjectIR,
  selection: ResolvedMediaSelectionV1 | null
): unknown
{
  if (!selection) return null
  return {
    media: planningMedia(selection.current),
    references: mediaReferenceEvidenceV1(project, resolvedSlot(selection)),
  }
}

function assetFacts(asset: AdmittedEditAssetV1 | null): unknown
{
  if (!asset) return null
  return {
    mediaKind: asset.mediaKind,
    payloadSha256: asset.payloadSha256,
    metadataSha256: asset.metadataSha256,
    identity: asset.identity,
  }
}

function groupFPlanningFactProjection(
  resolved: ResolvedGroupFDispatchV1
): GroupFPlanningFactProjectionV1
{
  return {
    kind: 'group-f-media-planning-fact-set',
    schemaVersion: 1,
    operationKind: resolved.operation.kind,
    opId: resolved.operation.opId,
    selectedEntities: resolved.planningEntities,
    selectedLineageIds: resolved.selectedLineageIds,
    facts: resolved.facts,
  }
}

function productionGroupFPlanningFactProjectionV1(
  context: ProductionOperationContextV1,
  operation: GroupFOperationV1
): GroupFPlanningFactProjectionV1
{
  return groupFPlanningFactProjection(resolveGroupFDispatch(context, operation))
}

export function productionGroupFPlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: GroupFOperationV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionGroupFPlanningFactProjectionV1(context, operation)
  )
}

interface GroupFPlanningCompletionV1<
  Operation extends SemanticEditOperationV1,
>
{
  readonly operation: Operation
  readonly planningFactSetSha256: string
}

// planner completion shares the exact projection later verified by execution.
export function productionGroupFAddCostumePlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: 'media.addCostume' }
  >
): GroupFPlanningCompletionV1<SemanticEditOperationMediaAddCostumeV1>
{
  const target = resolveTargetSelection(context, goal.target)
  const targetRecord =
    context.candidate.json.targets[target.current.targetIndex]
  if (!targetRecord)
    return fail('edit.selector_no_match', 'planning target is absent')
  const before = currentCostumeStateV1(targetRecord)
  const currentSelection: CostumeSelectionPreconditionV1 = (() =>
  {
    if (goal.target.refKind === 'created')
    {
      if (before.costumeCount !== 0)
        return fail(
          'edit.cardinality_mismatch',
          'a created target already carries a costume',
          { matchCount: before.costumeCount }
        )
      return {
        selectionState: 'uninitializedCreatedTarget',
        expectedCostumeCount: 0,
      }
    }
    if (before.effectiveIndex === null)
      return fail(
        'edit.cardinality_mismatch',
        'an existing target has no effective current costume',
        { matchCount: before.costumeCount }
      )
    const selected = mediaRecordEntityEvidenceSetV1(context.candidate).find(
      (entry) =>
        entry.targetIndex === target.current.targetIndex &&
        entry.mediaKind === 'costume' &&
        entry.ordinal === before.effectiveIndex
    )
    if (!selected)
      return fail(
        'edit.internal_invariant',
        'effective current costume evidence is absent'
      )
    return {
      selectionState: 'selected',
      expectedEffectiveCurrentCostume: exactMediaRefV1(selected),
      expectedEffectiveCurrentCostumeFingerprint:
        selected.semanticFingerprintSha256,
      expectedEffectiveCurrentCostumeIndex: before.effectiveIndex,
      expectedRawCurrentCostume: before.rawState,
    }
  })()
  const reconciledIndex =
    before.effectiveIndex === null
      ? 0
      : shiftedOrdinalV1(
          before.costumeCount,
          { kind: 'insert', at: goal.order },
          before.effectiveIndex
        )
  if (reconciledIndex === null)
    return fail(
      'edit.internal_invariant',
      'costume insertion lost the current selection'
    )
  const activation = mediaNameActivationEvidenceV1(
    context.candidate,
    { targetIndex: target.current.targetIndex, mediaKind: 'costume' },
    goal.name
  )
  const operation: SemanticEditOperationMediaAddCostumeV1 = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    nameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedCostumeOrderSha256: mediaOrderEvidenceV1(targetRecord, 'costume')
      .orderSha256,
    currentSelection,
    expectedFinalCurrentCostumeState: reconciledCurrentCostumeStateV1(
      before,
      reconciledIndex
    ),
  }
  const planningFactSetSha256 = productionGroupFPlanningFactSetSha256V1(
    context,
    operation
  )
  return Object.freeze({
    operation: Object.freeze({
      ...operation,
      expectedPlanningFactSetSha256: planningFactSetSha256,
    }),
    planningFactSetSha256,
  })
}

export function productionGroupFSpritePlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: 'target.addSprite' }
  >
): GroupFPlanningCompletionV1<
  Extract<SemanticEditOperationV1, { readonly kind: 'target.addSprite' }>
>
{
  const activation = targetProspectiveNameActivationV1(
    context.candidate,
    buildSemanticReferenceIndex(context.candidate),
    goal.name
  )
  const operation = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    nameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0 as const,
    },
  } satisfies Extract<
    SemanticEditOperationV1,
    { readonly kind: 'target.addSprite' }
  >
  const planningFactSetSha256 = productionGroupFSpritePlanningFactSetSha256V1(
    context,
    operation
  )
  return Object.freeze({
    operation: Object.freeze({
      ...operation,
      expectedPlanningFactSetSha256: planningFactSetSha256,
    }),
    planningFactSetSha256,
  })
}

function existingCostumeSelectionV1(
  context: ProductionOperationContextV1,
  targetIndex: number
): {
  readonly before: ReturnType<typeof currentCostumeStateV1>
  readonly selection: CostumeSelectionPreconditionV1
}
{
  const target = context.candidate.json.targets[targetIndex]
  if (!target) return fail('edit.selector_no_match', 'media owner is absent')
  const before = currentCostumeStateV1(target)
  if (before.effectiveIndex === null)
    return fail(
      'edit.cardinality_mismatch',
      'an existing target has no effective current costume',
      { matchCount: before.costumeCount }
    )
  const selected = mediaRecordEntityEvidenceSetV1(context.candidate).find(
    (entry) =>
      entry.targetIndex === targetIndex &&
      entry.mediaKind === 'costume' &&
      entry.ordinal === before.effectiveIndex
  )
  if (!selected)
    return fail(
      'edit.internal_invariant',
      'effective current costume evidence is absent'
    )
  return {
    before,
    selection: {
      selectionState: 'selected',
      expectedEffectiveCurrentCostume: exactMediaRefV1(selected),
      expectedEffectiveCurrentCostumeFingerprint:
        selected.semanticFingerprintSha256,
      expectedEffectiveCurrentCostumeIndex: before.effectiveIndex,
      expectedRawCurrentCostume: before.rawState,
    },
  }
}

export function productionGroupFMediaPlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: `media.${string}` }
  >
): EditOperationPlanningResultV1
{
  if (goal.kind === 'media.addCostume')
  {
    const completed = productionGroupFAddCostumePlanningCompletionV1(
      context,
      goal
    )
    return Object.freeze({
      operationKind: goal.kind,
      planningFactSetSha256: completed.planningFactSetSha256,
      facts: Object.freeze([
        groupFCompletedFactV1(
          '/expectedPlanningFactSetSha256',
          'sha256',
          completed.planningFactSetSha256
        ),
        groupFCompletedFactV1(
          '/nameActivation',
          'nameActivation',
          completed.operation.nameActivation
        ),
        groupFCompletedFactV1(
          '/expectedCostumeOrderSha256',
          'sha256',
          completed.operation.expectedCostumeOrderSha256
        ),
        groupFCompletedFactV1(
          '/currentSelection',
          'costumeSelection',
          completed.operation.currentSelection
        ),
        groupFCompletedFactV1(
          '/expectedFinalCurrentCostumeState',
          'existingOptionalNumber',
          completed.operation.expectedFinalCurrentCostumeState
        ),
      ]),
    })
  }
  let operation: GroupFOperationV1
  let facts: readonly EditOperationPlanningFactV1[]
  if (goal.kind === 'media.addSound')
  {
    const target = resolveTargetSelection(context, goal.target)
    const activation = mediaNameActivationEvidenceV1(
      context.candidate,
      { targetIndex: target.current.targetIndex, mediaKind: 'sound' },
      goal.name
    )
    const nameActivation = {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0 as const,
    }
    operation = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      nameActivation,
    }
    facts = Object.freeze([
      groupFCompletedFactV1(
        '/nameActivation',
        'nameActivation',
        nameActivation
      ),
    ])
  }
  else
  {
    const mediaKind = goal.kind.endsWith('Sound') ? 'sound' : 'costume'
    const selected = resolveMediaSelection(context, goal.media, mediaKind)
    const target = context.candidate.json.targets[selected.current.targetIndex]
    if (!target) return fail('edit.invalid_owner', 'media owner is absent')
    const slot = resolvedSlot(selected)
    if (
      goal.kind === 'media.renameCostume' ||
      goal.kind === 'media.renameSound'
    )
    {
      const references = mediaReferenceEvidenceV1(
        context.candidate,
        slot,
        buildSemanticReferenceIndex(context.candidate)
      )
      const activation = mediaNameActivationEvidenceV1(
        context.candidate,
        slot,
        goal.newName
      )
      const newNameActivation = {
        expectedActivationSetSha256: activation.activationSetSha256,
        requireProspectiveActivationCount: 0 as const,
      }
      const expectedName = expectedStringIdentityV1(selected.current.name)
      const expectedReferenceSetSha256 = references.referenceSetSha256
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedName,
        expectedReferenceSetSha256,
        newNameActivation,
      } as GroupFOperationV1
      facts = Object.freeze([
        groupFCompletedFactV1('/expectedName', 'stringIdentity', expectedName),
        groupFCompletedFactV1(
          '/expectedReferenceSetSha256',
          'sha256',
          expectedReferenceSetSha256
        ),
        groupFCompletedFactV1(
          '/newNameActivation',
          'nameActivation',
          newNameActivation
        ),
      ])
    }
    else if (
      goal.kind === 'media.reorderCostume' ||
      goal.kind === 'media.reorderSound'
    )
    {
      const expectedIndex = selected.current.ordinal
      const expectedMediaOrderSha256 = mediaOrderEvidenceV1(
        target,
        mediaKind
      ).orderSha256
      if (goal.kind === 'media.reorderCostume')
      {
        const current = existingCostumeSelectionV1(
          context,
          selected.current.targetIndex
        )
        const finalIndex = shiftedOrdinalV1(
          current.before.costumeCount,
          {
            kind: 'move',
            from: selected.current.ordinal,
            to: goal.newIndex,
          },
          current.before.effectiveIndex!
        )
        if (finalIndex === null)
          return fail(
            'edit.internal_invariant',
            'costume reorder lost the current selection'
          )
        const expectedFinalCurrentCostumeState =
          reconciledCurrentCostumeStateV1(current.before, finalIndex)
        operation = {
          ...goal,
          expectedPlanningFactSetSha256: '0'.repeat(64),
          expectedIndex,
          expectedMediaOrderSha256,
          currentSelection: current.selection,
          expectedFinalCurrentCostumeState,
        }
        facts = Object.freeze([
          groupFCompletedFactV1('/expectedIndex', 'integer', expectedIndex),
          groupFCompletedFactV1(
            '/expectedMediaOrderSha256',
            'sha256',
            expectedMediaOrderSha256
          ),
          groupFCompletedFactV1(
            '/currentSelection',
            'costumeSelection',
            current.selection
          ),
          groupFCompletedFactV1(
            '/expectedFinalCurrentCostumeState',
            'existingOptionalNumber',
            expectedFinalCurrentCostumeState
          ),
        ])
      }
      else
      {
        operation = {
          ...goal,
          expectedPlanningFactSetSha256: '0'.repeat(64),
          expectedIndex,
          expectedMediaOrderSha256,
        }
        facts = Object.freeze([
          groupFCompletedFactV1('/expectedIndex', 'integer', expectedIndex),
          groupFCompletedFactV1(
            '/expectedMediaOrderSha256',
            'sha256',
            expectedMediaOrderSha256
          ),
        ])
      }
    }
    else if (
      goal.kind === 'media.replaceCostume' ||
      goal.kind === 'media.replaceSound'
    )
    {
      if (selected.current.payloadSha256 === null)
        return fail(
          'edit.selector_no_match',
          'selected media payload is unavailable'
        )
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedPayloadSha256: selected.current.payloadSha256,
      } as GroupFOperationV1
      facts = Object.freeze([
        groupFCompletedFactV1(
          '/expectedPayloadSha256',
          'sha256',
          selected.current.payloadSha256
        ),
      ])
    }
    else if (
      goal.kind === 'media.removeCostume' ||
      goal.kind === 'media.removeSound'
    )
    {
      const references = mediaReferenceEvidenceV1(
        context.candidate,
        slot,
        buildSemanticReferenceIndex(context.candidate)
      )
      const reachability = mediaReachabilityEvidenceV1(context.candidate)
      if (goal.kind === 'media.removeCostume')
      {
        const current = existingCostumeSelectionV1(
          context,
          selected.current.targetIndex
        )
        if (current.before.effectiveIndex === selected.current.ordinal)
          return fail(
            'edit.protected_change',
            'the currently selected costume cannot be removed'
          )
        const finalIndex = shiftedOrdinalV1(
          current.before.costumeCount,
          { kind: 'remove', at: selected.current.ordinal },
          current.before.effectiveIndex!
        )
        if (finalIndex === null)
          return fail(
            'edit.internal_invariant',
            'costume removal lost the retained current selection'
          )
        const expectedFinalCurrentCostumeState =
          reconciledCurrentCostumeStateV1(current.before, finalIndex)
        operation = {
          ...goal,
          expectedPlanningFactSetSha256: '0'.repeat(64),
          expectedReferenceSetSha256: references.referenceSetSha256,
          requireFinalReferenceCount: 0,
          expectedCurrentCostume: false,
          expectedCostumeCount: target.costumes.length,
          requireFinalCostumeCountAtLeast: 1,
          currentSelection: current.selection,
          expectedFinalCurrentCostumeState,
          expectedReachabilitySha256: reachability.reachabilitySha256,
        }
        facts = Object.freeze([
          groupFCompletedFactV1(
            '/expectedReferenceSetSha256',
            'sha256',
            references.referenceSetSha256
          ),
          groupFCompletedFactV1('/requireFinalReferenceCount', 'integer', 0),
          groupFCompletedFactV1('/expectedCurrentCostume', 'boolean', false),
          groupFCompletedFactV1(
            '/expectedCostumeCount',
            'integer',
            target.costumes.length
          ),
          groupFCompletedFactV1(
            '/requireFinalCostumeCountAtLeast',
            'integer',
            1
          ),
          groupFCompletedFactV1(
            '/currentSelection',
            'costumeSelection',
            current.selection
          ),
          groupFCompletedFactV1(
            '/expectedFinalCurrentCostumeState',
            'existingOptionalNumber',
            expectedFinalCurrentCostumeState
          ),
          groupFCompletedFactV1(
            '/expectedReachabilitySha256',
            'sha256',
            reachability.reachabilitySha256
          ),
        ])
      }
      else
      {
        operation = {
          ...goal,
          expectedPlanningFactSetSha256: '0'.repeat(64),
          expectedReferenceSetSha256: references.referenceSetSha256,
          requireFinalReferenceCount: 0,
          expectedReachabilitySha256: reachability.reachabilitySha256,
        }
        facts = Object.freeze([
          groupFCompletedFactV1(
            '/expectedReferenceSetSha256',
            'sha256',
            references.referenceSetSha256
          ),
          groupFCompletedFactV1('/requireFinalReferenceCount', 'integer', 0),
          groupFCompletedFactV1(
            '/expectedReachabilitySha256',
            'sha256',
            reachability.reachabilitySha256
          ),
        ])
      }
    }
    else
    {
      const owner = resolveTargetSelection(context, goal.target)
      if (owner.current.targetIndex !== selected.current.targetIndex)
        return fail(
          'edit.invalid_owner',
          'selected costume belongs to another target'
        )
      const current = existingCostumeSelectionV1(
        context,
        selected.current.targetIndex
      )
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        currentSelection: current.selection,
        expectedFinalCurrentCostumeIndex: selected.current.ordinal,
      }
      facts = Object.freeze([
        groupFCompletedFactV1(
          '/currentSelection',
          'costumeSelection',
          current.selection
        ),
        groupFCompletedFactV1(
          '/expectedFinalCurrentCostumeIndex',
          'integer',
          selected.current.ordinal
        ),
      ])
    }
  }
  const planningFactSetSha256 = productionGroupFPlanningFactSetSha256V1(
    context,
    operation
  )
  return Object.freeze({
    operationKind: goal.kind,
    planningFactSetSha256,
    facts: Object.freeze([
      groupFCompletedFactV1(
        '/expectedPlanningFactSetSha256',
        'sha256',
        planningFactSetSha256
      ),
      ...facts,
    ]),
  })
}

// ---------------------------------------------------------------------------
// per-operation resolution
// ---------------------------------------------------------------------------

function resolveAddDispatch(
  context: ProductionOperationContextV1,
  operation:
    | SemanticEditOperationMediaAddCostumeV1
    | SemanticEditOperationMediaAddSoundV1
): ResolvedGroupFDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the record; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const mediaKind = mediaKindOf(operation)
  const target = resolveTargetSelection(context, operation.target)
  const asset = resolveAdmittedAsset(context, operation.asset, mediaKind)
  const current =
    operation.kind === 'media.addCostume'
      ? resolveCurrentSelection(context, operation.currentSelection)
      : {
          resolved: null,
          lineageId: null,
          evidence: null,
          canonicalEvidence: null,
        }
  const canonicalTargetIndex = target.canonical.targetIndex
  const canonicalOperation = {
    ...operation,
    target: canonicalTargetRef(operation.target, target),
    ...(operation.kind === 'media.addCostume' &&
    current.canonicalEvidence !== null &&
    operation.currentSelection.selectionState === 'selected'
      ? {
          currentSelection: {
            ...operation.currentSelection,
            expectedEffectiveCurrentCostume: canonicalMediaRef(
              operation.currentSelection.expectedEffectiveCurrentCostume,
              current.canonicalEvidence
            ),
          },
        }
      : {}),
  } as GroupFOperationV1
  return {
    operation,
    canonicalOperation,
    mediaKind,
    targetIndex: target.current.targetIndex,
    targetLineageId: target.lineageId,
    selectedMedia: null,
    currentSelection: current.resolved,
    currentSelectionLineageId: current.lineageId,
    asset,
    selectedLineageIds: uniqueSorted([
      target.lineageId,
      ...(current.lineageId === null ? [] : [current.lineageId]),
    ]),
    planningEntities: Object.freeze([
      planningTarget(target.canonical),
      ...(current.canonicalEvidence === null
        ? []
        : [planningMedia(current.canonicalEvidence)]),
    ]),
    facts: {
      ownerTarget: planningTarget(target.canonical),
      domain: domainFacts(planning.candidate, canonicalTargetIndex, mediaKind),
      asset: assetFacts(asset),
      name: operation.name,
      order: operation.order,
      activation: mediaNameActivationEvidenceV1(
        planning.candidate,
        { targetIndex: canonicalTargetIndex, mediaKind },
        operation.name
      ),
      ...(operation.kind === 'media.addCostume'
        ? { placement: operation.placement }
        : {}),
    },
  }
}

// a canonical operation is re-executed against the pre-batch view during replay,
// so its refs must stay resolvable there. a created ref names its producing
// operation rather than a location, so it is kept verbatim
function canonicalTargetRef(
  reference: TargetRefV1,
  canonical:
    TargetEntityEvidenceV1 | { readonly canonical: TargetEntityEvidenceV1 }
): TargetRefV1
{
  if (reference.refKind === 'created') return reference
  return exactTargetRef(
    'canonical' in canonical ? canonical.canonical : canonical
  )
}

function resolveSelectedDispatch(
  context: ProductionOperationContextV1,
  operation: Exclude<
    GroupFOperationV1,
    | SemanticEditOperationMediaAddCostumeV1
    | SemanticEditOperationMediaAddSoundV1
  >
): ResolvedGroupFDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the record; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const mediaKind = mediaKindOf(operation)
  const selection = resolveMediaSelection(context, operation.media, mediaKind)
  const targetIndex = selection.current.targetIndex
  const canonicalTargetIndex = selection.canonical.targetIndex
  const targetLineageId = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    targetIndex
  ).lineageId
  const asset =
    operation.kind === 'media.replaceCostume' ||
    operation.kind === 'media.replaceSound'
      ? resolveAdmittedAsset(context, operation.asset, mediaKind)
      : null
  const current =
    'currentSelection' in operation
      ? resolveCurrentSelection(context, operation.currentSelection)
      : {
          resolved: null,
          lineageId: null,
          evidence: null,
          canonicalEvidence: null,
        }
  const canonicalOperation = {
    ...operation,
    media: canonicalMediaRef(operation.media, selection.canonical),
    ...('target' in operation
      ? {
          target: canonicalTargetRef(
            operation.target,
            exactCurrentTarget(context.preBatch, canonicalTargetIndex)
          ),
        }
      : {}),
    ...(current.canonicalEvidence !== null &&
    'currentSelection' in operation &&
    operation.currentSelection.selectionState === 'selected'
      ? {
          currentSelection: {
            ...operation.currentSelection,
            expectedEffectiveCurrentCostume: canonicalMediaRef(
              operation.currentSelection.expectedEffectiveCurrentCostume,
              current.canonicalEvidence
            ),
          },
        }
      : {}),
  } as GroupFOperationV1
  return {
    operation,
    canonicalOperation,
    mediaKind,
    targetIndex,
    targetLineageId,
    selectedMedia: selection,
    currentSelection: current.resolved,
    currentSelectionLineageId: current.lineageId,
    asset,
    selectedLineageIds: uniqueSorted([
      targetLineageId,
      selection.lineageId,
      ...(current.lineageId === null ? [] : [current.lineageId]),
    ]),
    planningEntities: Object.freeze([
      planningTarget(
        exactCurrentTarget(planning.candidate, canonicalTargetIndex)
      ),
      planningMedia(selection.canonical),
      ...(current.canonicalEvidence === null
        ? []
        : [planningMedia(current.canonicalEvidence)]),
    ]),
    facts: {
      domain: domainFacts(planning.candidate, canonicalTargetIndex, mediaKind),
      selected: selectedMediaFacts(
        planning.candidate,
        canonicalSelection(selection)
      ),
      asset: assetFacts(asset),
      reachability: mediaReachabilityEvidenceV1(planning.candidate),
      ...('newName' in operation
        ? {
            newName: operation.newName,
            activation: mediaNameActivationEvidenceV1(
              planning.candidate,
              { targetIndex: canonicalTargetIndex, mediaKind },
              operation.newName
            ),
          }
        : {}),
      ...('newIndex' in operation ? { newIndex: operation.newIndex } : {}),
      ...('placement' in operation ? { placement: operation.placement } : {}),
      ...(operation.kind === 'media.setCurrentCostume'
        ? {
            expectedFinalCurrentCostumeIndex:
              operation.expectedFinalCurrentCostumeIndex,
          }
        : {}),
    },
  }
}

function resolveGroupFDispatch(
  context: ProductionOperationContextV1,
  operation: GroupFOperationV1
): ResolvedGroupFDispatchV1
{
  if (
    operation.kind === 'media.addCostume' ||
    operation.kind === 'media.addSound'
  )
    return resolveAddDispatch(context, operation)
  return resolveSelectedDispatch(context, operation)
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function resolvedMediaOperation(
  resolved: ResolvedGroupFDispatchV1
): ResolvedMediaOperationV1
{
  const operation = resolved.canonicalOperation
  if (operation.kind === 'media.addCostume')
    return {
      operation,
      targetIndex: resolved.targetIndex,
      identity: resolved.asset!.identity as Extract<
        AdmittedEditAssetV1['identity'],
        { mediaKind: 'costume' }
      >,
      payload: resolved.asset!.bytes,
      currentSelection: resolved.currentSelection!,
    }
  if (operation.kind === 'media.addSound')
    return {
      operation,
      targetIndex: resolved.targetIndex,
      identity: resolved.asset!.identity as Extract<
        AdmittedEditAssetV1['identity'],
        { mediaKind: 'sound' }
      >,
      payload: resolved.asset!.bytes,
    }
  const slot = resolvedSlot(resolved.selectedMedia!)
  if (operation.kind === 'media.replaceCostume')
    return {
      operation,
      slot,
      identity: resolved.asset!.identity as Extract<
        AdmittedEditAssetV1['identity'],
        { mediaKind: 'costume' }
      >,
      payload: resolved.asset!.bytes,
    }
  if (operation.kind === 'media.replaceSound')
    return {
      operation,
      slot,
      identity: resolved.asset!.identity as Extract<
        AdmittedEditAssetV1['identity'],
        { mediaKind: 'sound' }
      >,
      payload: resolved.asset!.bytes,
    }
  if (operation.kind === 'media.reorderCostume')
    return { operation, slot, currentSelection: resolved.currentSelection! }
  if (operation.kind === 'media.removeCostume')
    return { operation, slot, currentSelection: resolved.currentSelection! }
  if (operation.kind === 'media.setCurrentCostume')
    return {
      operation,
      targetIndex: resolved.targetIndex,
      slot,
      currentSelection: resolved.currentSelection!,
    }
  if (operation.kind === 'media.renameCostume') return { operation, slot }
  if (operation.kind === 'media.renameSound') return { operation, slot }
  if (operation.kind === 'media.reorderSound') return { operation, slot }
  return { operation, slot }
}

// the post-operation ordering is derived from the lineage itself rather than
// from raw identities, because a created row already names its new ordinal while
// every retained row still names the one it was minted at
function reconcileGroupFLineage(
  context: ProductionOperationContextV1,
  resolved: ResolvedGroupFDispatchV1,
  applied: AppliedMediaOperationV1
): ReconciledGroupFLineageV1
{
  const mediaKind = resolved.mediaKind
  const ownerLineageId = resolved.targetLineageId
  let active = context.activeLineage
  const beforeIds = activeOrderedSemanticLineages(
    active,
    mediaKind,
    ownerLineageId
  ).map((record) => record.lineageId)
  if (applied.createdMediaOrdinal !== null)
  {
    const target = context.candidate.json.targets[applied.targetIndex]!
    const records = mediaKind === 'costume' ? target.costumes : target.sounds
    const created = createLineage(
      context,
      resolved.operation.opId,
      mediaKind,
      ownerLineageId,
      mediaLineageRawIdentityV1(
        records[applied.createdMediaOrdinal]!,
        mediaKind,
        applied.createdMediaOrdinal
      ),
      applied.createdMediaOrdinal,
      'fixed:media',
      active
    )
    const afterIds = [...beforeIds]
    afterIds.splice(applied.createdMediaOrdinal, 0, created.record.lineageId)
    active = reindexMediaLineageOrder(
      created.activeLineage,
      mediaKind,
      ownerLineageId,
      afterIds
    )
    return {
      activeLineage: active,
      createdMediaLineageId: created.record.lineageId,
      collisionNonce: created.collisionNonce,
      creationKey: created.creationKey,
      selectedLineageIds: Object.freeze([created.record.lineageId]),
    }
  }
  if (applied.detachedMediaOrdinal !== null)
  {
    const detached = beforeIds[applied.detachedMediaOrdinal]
    if (detached === undefined)
      return fail(
        'edit.internal_invariant',
        'detached media ordinal is absent from the running lineage'
      )
    const afterIds = beforeIds.filter((lineageId) => lineageId !== detached)
    active = reindexMediaLineageOrder(
      tombstoneLineage(active, detached),
      mediaKind,
      ownerLineageId,
      afterIds
    )
    return {
      activeLineage: active,
      createdMediaLineageId: null,
      collisionNonce: null,
      creationKey: null,
      selectedLineageIds: Object.freeze([detached]),
    }
  }
  if (
    resolved.operation.kind === 'media.reorderCostume' ||
    resolved.operation.kind === 'media.reorderSound'
  )
  {
    const from = resolved.selectedMedia!.current.ordinal
    const afterIds = [...beforeIds]
    const [moved] = afterIds.splice(from, 1)
    afterIds.splice(resolved.operation.newIndex, 0, moved!)
    active = reindexMediaLineageOrder(
      active,
      mediaKind,
      ownerLineageId,
      afterIds
    )
  }
  return {
    activeLineage: active,
    createdMediaLineageId: null,
    collisionNonce: null,
    creationKey: null,
    selectedLineageIds: Object.freeze(
      resolved.selectedMedia === null ? [] : [resolved.selectedMedia.lineageId]
    ),
  }
}

// ---------------------------------------------------------------------------
// result slots & future bindings
// ---------------------------------------------------------------------------

function groupFCreationRoleForSlot(
  slot: GroupCProductionResultSlotV1
): GroupFCreationResultRoleV1
{
  if (slot.slotKind !== 'fixed' || slot.name !== 'media')
    return fail(
      'edit.internal_invariant',
      `Group F does not create a ${slot.name} result`
    )
  return { roleKind: 'fixed', name: 'media' }
}

function matchResultBindings(
  context: ProductionOperationContextV1,
  operation: GroupFOperationV1,
  slots: readonly GroupCProductionResultSlotV1[],
  targetBindingKeysForCreation: readonly string[],
  creationContentFingerprint: (
    binding: MediaFutureContractBindingV1,
    slot: GroupCProductionResultSlotV1
  ) => string,
  collisionNonce: number | null,
  creationKey: string | null
): readonly ResultBindingMatchV1[]
{
  return Object.freeze(
    slots.map((slot) =>
    {
      const role = groupFCreationRoleForSlot(slot)
      const matches = context.contract.entityBindings
        .filter(
          (binding): binding is MediaFutureContractBindingV1 =>
            binding.bindingKind === 'future' && binding.entityKind === 'media'
        )
        .filter((binding) =>
        {
          if (
            binding.entitySubtype !== slot.entitySubtype ||
            binding.expectedCreatorOperationKind !== operation.kind ||
            binding.expectedCreationRole.roleKind !== role.roleKind ||
            binding.expectedCreationRole.name !== role.name ||
            futureBindingAlreadyRealized(
              context.input.changeContractSha256,
              context.futureBindingLedger,
              binding.bindingKey
            ) ||
            binding.expectedCreationScope.scopeKind !==
              'targetAndOwnedDescendants' ||
            !targetBindingKeysForCreation.includes(
              binding.expectedCreationScope.target.bindingKey
            )
          )
            return false
          return (
            binding.expectedCreationContentFingerprintSha256 ===
            creationContentFingerprint(binding, slot)
          )
        })
      if (matches.length !== 1)
        return fail(
          'edit.unauthorized_change',
          matches.length === 0
            ? `${operation.kind} result media has no exact future binding`
            : `${operation.kind} result media ambiguously matches future bindings`
        )
      if (collisionNonce === null || creationKey === null)
        return fail(
          'edit.internal_invariant',
          `${operation.kind} result lineage lacks creation provenance`
        )
      return { binding: matches[0]!, slot, collisionNonce, creationKey }
    })
  )
}

function creationContentFingerprint(
  context: ProductionOperationContextV1,
  sourceProject: ProjectIR,
  resolved: ResolvedGroupFDispatchV1,
  binding: MediaFutureContractBindingV1,
  slot: GroupCProductionResultSlotV1
): string
{
  const sourceContext: ProductionOperationContextV1 = {
    ...context,
    candidate: sourceProject,
  }
  return groupFCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex: resolved.targetIndex,
    operation: resolved.canonicalOperation as GroupFCreationOperationV1,
    descriptor: binding,
    resultRole: groupFCreationRoleForSlot(slot),
    resolveContractEntityRef: (request) =>
      resolveGroupFContractEntityReference(sourceContext, request),
  })
}

// ---------------------------------------------------------------------------
// contract scope & authorization
// ---------------------------------------------------------------------------

function exactContractRef(
  context: ProductionOperationContextV1,
  bindingKeys: readonly string[],
  expectedEntityKind: ContractEntityRefV1['entityKind'],
  expectedEntitySubtype: ContractEntityRefV1['entitySubtype'],
  semanticPath: string
): ContractEntityRefV1
{
  return resolveExactContractRef(
    context.contract.entityBindings,
    bindingKeys,
    expectedEntityKind,
    expectedEntitySubtype,
    () =>
      fail(
        'edit.unauthorized_change',
        `${semanticPath} does not resolve one exact contract binding`
      ),
    () =>
      fail(
        'edit.unauthorized_change',
        `${semanticPath} contract binding kind or subtype differs`
      )
  )
}

// the exact contract binding one media reference resolves to; Group D & E call
// this for the curated media selectors their own operations carry
export function mediaContractEntityRefV1(
  context: ProductionOperationContextV1,
  reference: MediaRefV1,
  expectedEntitySubtype: string,
  semanticPath: string
): ContractEntityRefV1
{
  const selection = resolveMediaReferenceV1(context, reference)
  const evidence = selection.current
  if (evidence.mediaKind !== expectedEntitySubtype)
    return fail(
      'edit.invalid_shape',
      `${semanticPath} media subtype differs from its descriptor`
    )
  const bindingKeys = mediaContractBindingKeys(
    context,
    evidence,
    selection.lineageId
  )
  return exactContractRef(
    context,
    bindingKeys,
    'media',
    evidence.mediaKind,
    semanticPath
  )
}

// the curated-builder view of a media record; every other group reaches media
// through this so the lineage & fingerprint derivation stays in one place
export function curatedMediaEntityV1(
  context: ProductionOperationContextV1,
  reference: MediaRefV1,
  expectedEntitySubtype: string,
  semanticPath: string
): {
  readonly entityKind: 'media'
  readonly entitySubtype: string
  readonly displayName: string
  readonly serializedId: string
  readonly ownerTargetIndex: number
  readonly semanticLineageSha256: string
  readonly semanticFingerprintSha256: string
}
{
  const selection = resolveMediaReferenceV1(context, reference)
  const evidence = selection.current
  if (evidence.mediaKind !== expectedEntitySubtype)
    return fail(
      'edit.invalid_shape',
      `${semanticPath} media subtype differs from its descriptor`
    )
  return {
    entityKind: 'media',
    entitySubtype: evidence.mediaKind,
    displayName: evidence.name,
    serializedId: evidence.archivePath,
    ownerTargetIndex: evidence.targetIndex,
    semanticLineageSha256: selection.lineageId,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
  }
}

// the binding keys a media record carries: its exact source binding plus any
// future binding this batch already realized onto its lineage
function mediaContractBindingKeys(
  context: ProductionOperationContextV1,
  evidence: MediaRecordEntityEvidenceV1,
  lineageId: string
): readonly string[]
{
  const record = context.activeLineage.records.find(
    (candidate) => candidate.lineageId === lineageId
  )
  const owner = context.activeLineage.records.find(
    (candidate) => candidate.lineageId === record?.ownerLineageId
  )
  const sourceTargetMatch = /^target:(0|[1-9][0-9]*)$/u.exec(
    owner?.rawIdentity ?? ''
  )
  const source =
    sourceTargetMatch === null || record === undefined
      ? null
      : (mediaRecordEntityEvidenceSetV1(context.source).find(
          (candidate) =>
            candidate.targetIndex === Number(sourceTargetMatch[1]) &&
            candidate.mediaKind === evidence.mediaKind &&
            mediaLineageRawIdentityV1(
              candidate,
              candidate.mediaKind,
              candidate.ordinal
            ) === record.rawIdentity
        ) ?? null)
  const future = uniqueSorted(
    context.contract.entityBindings.flatMap((binding) =>
      binding.bindingKind === 'future' &&
      context.futureBindingLedger.realizations.some(
        (realization) =>
          realization.resultLineageId === lineageId &&
          realization.bindingKeySha256 ===
            futureBindingKeySha256V1(
              context.input.changeContractSha256,
              binding.bindingKey
            )
      )
        ? [binding.bindingKey]
        : []
    )
  )
  return uniqueSorted([
    ...mediaBindingKeys(context, source, evidence.mediaKind),
    ...future,
  ])
}

// the frozen media scope admits an existing media entity, an owning target, or a
// created-sprite target; only the first two can exist in this slice

// the contract keys a target lineage this batch created, read back off the
// realizations its creating operation already recorded
function createdTargetBindingKeys(
  context: ProductionOperationContextV1,
  lineageId: string
): readonly string[]
{
  const realized = context.futureBindingLedger.realizations.filter(
    (realization) => realization.resultLineageId === lineageId
  )
  if (realized.length === 0) return Object.freeze([])
  const keys = new Set(realized.map((entry) => entry.bindingKeySha256))
  return uniqueSorted(
    context.contract.entityBindings.flatMap((binding) =>
      binding.bindingKind === 'future' &&
      binding.entityKind === 'target' &&
      keys.has(
        futureBindingKeySha256V1(
          context.input.changeContractSha256,
          binding.bindingKey
        )
      )
        ? [binding.bindingKey]
        : []
    )
  )
}

function resolveGroupFContractEntityReference(
  context: ProductionOperationContextV1,
  request: {
    readonly sourceKind: string
    readonly reference?: unknown
    readonly expectedEntityKind: string
    readonly expectedEntitySubtype: string
    readonly ownerTargetIndex?: number
    readonly semanticPath: string
  }
): ContractEntityRefV1
{
  if (
    request.sourceKind !== 'semanticReference' ||
    request.expectedEntityKind !== 'target'
  )
    return fail(
      'edit.unsupported_operation',
      `${request.semanticPath} is not a Group F contract reference`
    )
  const evidence = resolveTargetSelection(
    context,
    request.reference as Parameters<typeof resolveTargetSelection>[1]
  ).current
  if (evidence.targetKind !== request.expectedEntitySubtype)
    return fail(
      'edit.invalid_shape',
      `${request.semanticPath} target subtype differs from its descriptor`
    )
  const selection = resolveTargetSelection(
    context,
    request.reference as Parameters<typeof resolveTargetSelection>[1]
  )
  // a sprite this same batch created has no source evidence to bind against, so
  // its key comes from the future binding its creation already realized. this is
  // what lets a first costume scope onto a target that did not exist pre-batch
  const bindingKeys =
    targetBindingKeys(context, evidence).length > 0
      ? targetBindingKeys(context, evidence)
      : createdTargetBindingKeys(context, selection.lineageId)
  return exactContractRef(
    context,
    bindingKeys,
    'target',
    request.expectedEntitySubtype,
    request.semanticPath
  )
}

// only the operations that rewrite a named media property need one; membership
// & selection changes are authorized structurally, exactly as Group E does
function groupFPropertyAllowed(
  scope: ContractScopeV1,
  operation: GroupFOperationV1
): boolean
{
  if (scope.scopeSubjectKind !== 'entity') return false
  const required: readonly string[] =
    operation.kind === 'media.renameCostume' ||
    operation.kind === 'media.renameSound'
      ? ['name']
      : operation.kind === 'media.reorderCostume' ||
          operation.kind === 'media.reorderSound'
        ? ['order']
        : operation.kind === 'media.replaceSound'
          ? ['payload']
          : operation.kind === 'media.replaceCostume'
            ? operation.placement.kind === 'preserveExistingCenter'
              ? ['payload']
              : ['payload', 'rotationCenter']
            : []
  return required.every((property) =>
    scope.allowedPropertyPaths.some(
      (path) =>
        path.surface === 'media' &&
        'property' in path &&
        path.property === property
    )
  )
}

function selectGroupFScope(
  context: ProductionOperationContextV1,
  operation: GroupFOperationV1,
  mediaKind: 'costume' | 'sound',
  entityBindingKeys: readonly string[],
  targetScopeBindingKeys: readonly string[]
): ContractScopeV1
{
  if (!context.contract.allowedOperationKinds.includes(operation.kind))
    return fail(
      'edit.unauthorized_change',
      `change contract does not allow ${operation.kind}`
    )
  const exactKeys = new Set(entityBindingKeys)
  const targetKeys = new Set(targetScopeBindingKeys)
  const matches = context.contract.allowedSemanticScopes.filter((scope) =>
  {
    if (
      scope.operationKind !== operation.kind ||
      scope.scopeSubjectKind !== 'entity' ||
      scope.entityKind !== 'media' ||
      scope.entitySubtype !== mediaKind ||
      !groupFPropertyAllowed(scope, operation)
    )
      return false
    if (scope.locationScope.scopeKind === 'exactEntity')
      return exactKeys.has(scope.locationScope.entity.bindingKey)
    if (scope.locationScope.scopeKind === 'targetAndOwnedDescendants')
      return targetKeys.has(scope.locationScope.target.bindingKey)
    return false
  })
  if (matches.length !== 1)
    return fail(
      'edit.unauthorized_change',
      matches.length === 0
        ? `change contract has no exact Group F scope for ${operation.kind}`
        : `change contract has ambiguous Group F scopes for ${operation.kind}`
    )
  return matches[0]!
}

function scopeBindingKey(scope: ContractScopeV1): string | null
{
  if (scope.scopeSubjectKind !== 'entity') return null
  if (scope.locationScope.scopeKind === 'exactEntity')
    return scope.locationScope.entity.bindingKey
  if (scope.locationScope.scopeKind === 'targetAndOwnedDescendants')
    return scope.locationScope.target.bindingKey
  return null
}

// an admitted payload becomes a new archive entry, so the asset observation path
// is authorized alongside the project-JSON paths the record itself moved
function structuralAuthorization(
  applied: AppliedMediaOperationV1
): ProductionStructuralAuthorizationV1
{
  const paths = uniqueSorted([
    ...applied.exactPaths,
    ...applied.admittedArchivePaths.map(
      (path) => `/assets/${pointerPart(path)}`
    ),
  ])
  return { exactPaths: paths, pathPrefixes: paths }
}

function groupFOperationResult(
  operation: SemanticEditOperationV1,
  selectedLineageIds: readonly string[],
  fixedSlots: readonly GroupCProductionResultSlotV1[],
  effectEvidence: unknown
): GroupFProductionOperationResultV1
{
  return productionOperationResultV1(
    operation,
    selectedLineageIds,
    fixedSlots,
    effectEvidence,
    []
  )
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

function executeResolvedGroupFOperation(
  context: ProductionOperationContextV1,
  resolved: ResolvedGroupFDispatchV1,
  planningFactProjection: GroupFPlanningFactProjectionV1
): ProductionOperationDispatchResultV1
{
  const operation = resolved.operation
  if (
    operation.expectedPlanningFactSetSha256 !==
    semanticHashV1('resolved-plan', planningFactProjection)
  )
    return fail(
      'edit.planning_facts_mismatch',
      `planning facts changed for ${operation.opId}`
    )
  const creationSourceProject = cloneProject(context.candidate)
  const targetEvidence = exactCurrentTarget(
    context.candidate,
    resolved.targetIndex
  )
  // a target created earlier in this same batch binds through its realized
  // future binding rather than through pre-batch source evidence
  const existingTargetKeys = targetBindingKeys(context, targetEvidence)
  const targetKeys =
    existingTargetKeys.length > 0
      ? existingTargetKeys
      : createdTargetBindingKeys(context, resolved.targetLineageId)
  const priorMediaKeys =
    resolved.selectedMedia === null
      ? Object.freeze([])
      : mediaContractBindingKeys(
          context,
          resolved.selectedMedia.current,
          resolved.selectedMedia.lineageId
        )
  // every state precondition the frozen contract carries is enforced inside
  // `applyMediaOperationV1`, which refuses before it mutates anything
  const applied = applyMediaOperationV1(
    context.candidate,
    resolvedMediaOperation(resolved)
  )
  const lineage = reconcileGroupFLineage(context, resolved, applied)
  const fixedSlots: GroupCProductionResultSlotV1[] = []
  if (lineage.createdMediaLineageId !== null)
  {
    const evidence = mediaEvidenceAt(
      context.candidate,
      resolved.mediaKind,
      applied.targetIndex,
      applied.createdMediaOrdinal!
    )
    fixedSlots.push({
      slotKind: 'fixed',
      name: 'media',
      entityKind: 'media',
      entitySubtype: resolved.mediaKind,
      lineageId: lineage.createdMediaLineageId,
      ownerLineageId: resolved.targetLineageId,
      semanticLocationSha256: evidence.semanticLocationSha256,
      semanticFingerprintSha256: evidence.semanticFingerprintSha256,
      contextFingerprintSha256: evidence.contextFingerprintSha256,
    })
  }
  const bindingMatches = matchResultBindings(
    context,
    operation,
    fixedSlots,
    targetKeys,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        resolved,
        binding,
        slot
      ),
    lineage.collisionNonce,
    lineage.creationKey
  )
  const createdBindingKeys = bindingMatches.map(
    (match) => match.binding.bindingKey
  )
  const selectedScope = selectGroupFScope(
    context,
    operation,
    resolved.mediaKind,
    uniqueSorted([...priorMediaKeys, ...createdBindingKeys]),
    targetKeys
  )
  const selectedLineageIds = uniqueSorted([
    ...resolved.selectedLineageIds,
    ...lineage.selectedLineageIds,
    ...fixedSlots.map((slot) => slot.lineageId),
  ])
  const effectEvidence = {
    applied,
    postMediaOrderSha256: semanticHashV1('evidence-content', {
      targetIndex: applied.targetIndex,
      mediaKind: resolved.mediaKind,
      order: mediaOrderEvidenceV1(
        context.candidate.json.targets[applied.targetIndex]!,
        resolved.mediaKind
      ),
    }),
    reachability: mediaReachabilityEvidenceV1(context.candidate),
  }
  return {
    canonicalOperation: resolved.canonicalOperation,
    selectedScope,
    result: groupFOperationResult(
      resolved.canonicalOperation,
      selectedLineageIds,
      fixedSlots,
      effectEvidence
    ),
    attribution: {
      operationId: operation.opId,
      blocks: Object.freeze([]),
      // corresponded media leaves are attributed at collection granularity, so
      // an operation rewriting one member still names the collection, while the
      // prefix envelope stays at the member so authorization does not widen
      projectPaths: uniqueSorted([
        ...applied.exactPaths,
        ...(applied.exactPaths.some((path) =>
          path.startsWith(
            `${mediaCollectionPathV1(applied.targetIndex, applied.mediaKind)}/`
          )
        )
          ? [mediaCollectionPathV1(applied.targetIndex, applied.mediaKind)]
          : []),
      ]),
      pathPrefixes: uniqueSorted(applied.exactPaths),
      // the admitted payload lands as its own archive entry, & the archive delta
      // is a separate effect domain from the project tree
      assetPaths: uniqueSorted(applied.admittedArchivePaths),
    },
    activeLineage: lineage.activeLineage,
    planningFactProjection,
    matchedContractBindingKeys: uniqueSorted([
      ...priorMediaKeys,
      ...targetKeys,
      ...createdBindingKeys,
      ...(scopeBindingKey(selectedScope)
        ? [scopeBindingKey(selectedScope)!]
        : []),
    ]),
    selectedEntityLineageIds: selectedLineageIds,
    structuralAuthorization: structuralAuthorization(applied),
    assetMaterializationUsage:
      resolved.mediaKind === 'costume' && resolved.asset !== null
        ? assetMaterializationUsageDeltaV1([resolved.asset])
        : EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1,
    ...(bindingMatches.length > 0
      ? {
          futureBindingRealizationCandidates:
            bindingRealizationCandidates(bindingMatches),
        }
      : {}),
  }
}

class CostumeMediaProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'media.addCostume',
    'media.renameCostume',
    'media.reorderCostume',
    'media.replaceCostume',
    'media.removeCostume',
    'media.setCurrentCostume',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `costume dispatcher does not support ${operation.kind}`
      )
    const resolved = resolveGroupFDispatch(
      context,
      operation as CostumeOperationV1
    )
    return executeResolvedGroupFOperation(
      context,
      resolved,
      groupFPlanningFactProjection(resolved)
    )
  }
}

class SoundMediaProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'media.addSound',
    'media.renameSound',
    'media.reorderSound',
    'media.replaceSound',
    'media.removeSound',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `sound dispatcher does not support ${operation.kind}`
      )
    const resolved = resolveGroupFDispatch(
      context,
      operation as SoundOperationV1
    )
    return executeResolvedGroupFOperation(
      context,
      resolved,
      groupFPlanningFactProjection(resolved)
    )
  }
}

// ---------------------------------------------------------------------------
// sprite creation
// ---------------------------------------------------------------------------

type TargetFutureContractBindingV1 = Extract<
  FutureContractBindingV1,
  { entityKind: 'target' }
>

// creation reads no existing entity, so its planning facts are the two orders it
// appends to plus the name domain it must stay exact-unique within
interface GroupFSpritePlanningFactProjectionV1
{
  readonly kind: 'group-f-sprite-planning-facts'
  readonly schemaVersion: 1
  readonly operationKind: 'target.addSprite'
  readonly opId: string
  readonly facts: unknown
}

function spritePlanningFactProjection(
  context: ProductionOperationContextV1,
  operation: TargetCreationOperationV1
): GroupFSpritePlanningFactProjectionV1
{
  const evidence = targetEntityEvidenceSetV1(context.candidate.json)
  return {
    kind: 'group-f-sprite-planning-facts',
    schemaVersion: 1,
    operationKind: 'target.addSprite',
    opId: operation.opId,
    facts: {
      name: operation.name,
      visualLayerOrdinal: operation.visualLayerOrdinal,
      properties: operation.properties,
      serializedTargetCount: context.candidate.json.targets.length,
      spriteNames: evidence
        .filter((item) => item.targetKind === 'sprite')
        .map((item) => item.name),
      visualLayerOrdinals: evidence
        .filter((item) => item.targetKind === 'sprite')
        .map((item) => item.visualLayerOrdinal ?? null),
    },
  }
}

export function productionGroupFSpritePlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: TargetCreationOperationV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    spritePlanningFactProjection(context, operation)
  )
}

// a created sprite is owned by the project, not by a target, so its binding scope
// is the project target collection rather than a target-plus-descendants scope
function matchSpriteResultBinding(
  context: ProductionOperationContextV1,
  operation: TargetCreationOperationV1,
  slot: GroupCProductionResultSlotV1,
  contentFingerprint: (binding: TargetFutureContractBindingV1) => string
): TargetFutureContractBindingV1
{
  const matches = context.contract.entityBindings
    .filter(
      (binding): binding is TargetFutureContractBindingV1 =>
        binding.bindingKind === 'future' && binding.entityKind === 'target'
    )
    .filter((binding) =>
    {
      if (
        binding.entitySubtype !== slot.entitySubtype ||
        binding.expectedCreatorOperationKind !== operation.kind ||
        binding.expectedCreationRole.roleKind !== 'fixed' ||
        binding.expectedCreationRole.name !== 'target' ||
        futureBindingAlreadyRealized(
          context.input.changeContractSha256,
          context.futureBindingLedger,
          binding.bindingKey
        ) ||
        binding.expectedCreationScope.scopeKind !== 'projectEntityCollection' ||
        binding.expectedCreationScope.collection !== 'targets'
      )
        return false
      return (
        binding.expectedCreationContentFingerprintSha256 ===
        contentFingerprint(binding)
      )
    })
  if (matches.length !== 1)
    return fail(
      'edit.unauthorized_change',
      matches.length === 0
        ? 'target.addSprite result has no exact future binding'
        : 'target.addSprite result ambiguously matches future bindings'
    )
  return matches[0]!
}

// creation names no entity to scope onto, so authorization is structural: the
// contract has to allow the kind & carry a project-collection scope for it
function selectSpriteScope(
  context: ProductionOperationContextV1,
  operation: TargetCreationOperationV1
): ContractScopeV1
{
  if (!context.contract.allowedOperationKinds.includes(operation.kind))
    return fail(
      'edit.unauthorized_change',
      `change contract does not allow ${operation.kind}`
    )
  const matches = context.contract.allowedSemanticScopes.filter(
    (scope) =>
      scope.operationKind === operation.kind &&
      scope.scopeSubjectKind === 'entity' &&
      scope.entityKind === 'target' &&
      scope.entitySubtype === 'sprite' &&
      scope.locationScope.scopeKind === 'projectEntityCollection' &&
      scope.locationScope.collection === 'targets'
  )
  if (matches.length !== 1)
    return fail(
      'edit.unauthorized_change',
      matches.length === 0
        ? 'change contract has no exact Group F scope for target.addSprite'
        : 'change contract has ambiguous Group F scopes for target.addSprite'
    )
  return matches[0]!
}

class SpriteCreationProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze(['target.addSprite'] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (operation.kind !== 'target.addSprite')
      return fail(
        'edit.unsupported_operation',
        `sprite dispatcher does not support ${operation.kind}`
      )
    const planningFactProjection = spritePlanningFactProjection(
      context,
      operation
    )
    if (
      operation.expectedPlanningFactSetSha256 !==
      semanticHashV1('resolved-plan', planningFactProjection)
    )
      return fail(
        'edit.planning_facts_mismatch',
        `planning facts changed for ${operation.opId}`
      )
    const creationSourceProject = cloneProject(context.candidate)
    // every state precondition is enforced inside `applyTargetAddSpriteV1`, which
    // refuses before it mutates anything
    const applied = applyTargetAddSpriteV1(context.candidate, {
      operation,
      activeLineage: context.activeLineage,
    })
    // a target lineage is owned by the project itself, so its owner is null & its
    // canonical ordinal is the serialized position the append just took
    const created = createLineage(
      context,
      operation.opId,
      'target',
      null,
      `target:${operation.name}`,
      applied.createdTargetIndex,
      'fixed:target',
      context.activeLineage
    )
    const evidence = exactCurrentTarget(
      context.candidate,
      applied.createdTargetIndex
    )
    const slot: GroupCProductionResultSlotV1 = {
      slotKind: 'fixed',
      name: 'target',
      entityKind: 'target',
      entitySubtype: 'sprite',
      lineageId: created.record.lineageId,
      ownerLineageId: null,
      semanticLocationSha256: evidence.semanticLocationSha256,
      semanticFingerprintSha256: evidence.semanticFingerprintSha256,
      contextFingerprintSha256: evidence.contextFingerprintSha256,
    }
    const binding = matchSpriteResultBinding(
      context,
      operation,
      slot,
      (candidate) =>
        groupFCreationContentFingerprintForResultV1({
          project: creationSourceProject,
          targetIndex: applied.createdTargetIndex,
          operation: operation as GroupFCreationOperationV1,
          descriptor: candidate,
          resultRole: { roleKind: 'fixed', name: 'target' },
          resolveContractEntityRef: (request) =>
            resolveGroupFContractEntityReference(
              { ...context, candidate: creationSourceProject },
              request
            ),
        })
    )
    const selectedScope = selectSpriteScope(context, operation)
    const authorizedPaths = uniqueSorted(applied.exactPaths)
    return {
      canonicalOperation: operation,
      selectedScope,
      result: groupFOperationResult(
        operation,
        [created.record.lineageId],
        [slot],
        { applied }
      ),
      attribution: applied.attribution,
      activeLineage: created.activeLineage,
      planningFactProjection,
      matchedContractBindingKeys: uniqueSorted([binding.bindingKey]),
      selectedEntityLineageIds: Object.freeze([created.record.lineageId]),
      structuralAuthorization: {
        exactPaths: authorizedPaths,
        pathPrefixes: authorizedPaths,
      },
      futureBindingRealizationCandidates: Object.freeze([
        {
          bindingKey: binding.bindingKey,
          createdEntityKind: binding.entityKind,
          createdEntitySubtype: binding.entitySubtype,
          collisionNonce: created.collisionNonce,
          creationKey: created.creationKey,
          resultLineageId: slot.lineageId,
          ownerLineageId: slot.ownerLineageId,
        },
      ]),
    }
  }
}

export function groupFProductionOperationDispatchersV1(): readonly ProductionOperationDispatcherV1[]
{
  return Object.freeze([
    new CostumeMediaProductionOperationDispatcherV1(),
    new SoundMediaProductionOperationDispatcherV1(),
    new SpriteCreationProductionOperationDispatcherV1(),
  ])
}
