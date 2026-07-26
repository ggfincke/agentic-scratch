// packages/edit/src/transaction/production-transaction.ts
// production semantic transaction foundation w/ target-family dispatch

import {
  inspectSemanticEditArtifact,
  type DiagnosticEvidenceLocation,
  type DiagnosticFailure,
} from '@scratch-agent/eval'
import {
  ProjectIR,
  Uids,
  authorizeEditDelta,
  captureProjectOrderedHeadEvidence,
  checkPreservation,
  computeProjectDelta,
  createPreservationManifest,
  ownRecordKeys,
  ownRecordValue,
  type DeltaChangeKind,
  type DeltaOperationAttribution,
  type EditAuthorizationEnvelope,
  type ProjectDelta,
  type ProtectedChangeClass,
  type UidSnapshot,
  type ValueDelta,
} from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  applyTargetOperationV1,
  assertCreatedTargetsAreCostumedV1,
  blockBoundedLocationProjectionV1,
  boundedDisplayStringV1,
  blockEntityEvidenceSetV1,
  buildSemanticReferenceIndex,
  commentBoundedLocationProjectionV1,
  commentEntityEvidenceSetV1,
  declarationBoundedLocationProjectionV1,
  declarationEntityEvidenceSetV1,
  mediaBoundedLocationProjectionV1,
  mediaRecordEntityEvidenceSetV1,
  nonAuthorableProcedureSurfaceSha256V1,
  parameterEntityEvidenceSetV1,
  procedureEntityEvidenceSetV1,
  REFUSAL_REVIEW_ROWS,
  optionalCollectionContainerStateV1,
  parseContractDefinitionV1,
  parseSemanticChangeContractV1,
  resolveTargetRefV1,
  scriptBoundedLocationProjectionV1,
  scriptEntityEvidenceSetV1,
  semanticHashV1,
  targetBoundedLocationProjectionV1,
  targetDualOrderSnapshotV1,
  targetEntityEvidenceSetV1,
  targetExpectedStringIdentityV1,
  targetInboundReferenceSetV1,
  targetOwnedSurfaceSha256V1,
  targetProspectiveNameActivationV1,
  SEMANTIC_LINEAGE_VERSION_V1,
  validateSemanticLineageSnapshot,
  type BoundedDisplayStringV1,
  type BoundedSemanticLocationProjectionV1,
  type OperationResultSummaryV1,
  type OperationPlanningFactValueV1,
  type BlockEntityEvidenceV1,
  type ParameterEntityEvidenceV1,
  type ProcedureEntityEvidenceV1,
  type CommentEntityEvidenceV1,
  type ContractEntityBindingV1,
  type ContractScopeV1,
  type EditSemanticChangeContractV1,
  type HeadProjectionV1,
  type DeclarationEntityEvidenceV1,
  type OrderedCollectionCorrespondence,
  type OrderedCollectionMemberCorrespondence,
  type ProjectOrderedCorrespondence,
  type RefusalContextV1,
  type RefusalCode,
  type ScriptEntityEvidenceV1,
  type SemanticEditBatchV1,
  type SemanticEditOperationGoalV1,
  type SemanticEditOperationV1,
  type SemanticLineageSnapshot,
  type SemanticReferenceIndex,
  type StructuralAllowanceV1,
  type StructuralPredicateV1,
  type MediaRecordEntityEvidenceV1,
  type TargetEntityEvidenceV1,
  type TargetOperationV1,
  type TargetOperationResultV1,
  type TargetDualOrderSnapshotV1,
  type TargetRefV1,
} from '@scratch-agent/ir/edit'
import { isBlockEntry, packSb3 } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { editCanonicalSha256V1, exactRevisionFromHeadV1 } from '../support/canonical.js'
import {
  targetProductionOperationDispatchersV1,
  productionCommentPlanningCompletionV1,
  productionDeclarationPlanningCompletionV1,
  productionConflictProofWithIndexV1,
  productionScriptWorkspacePlanningCompletionV1,
  type ProductionOperationResultV1,
  type ProductionResultSlotV1,
  type ProductionDynamicBlockResultSlotV1,
  uniqueSorted,
} from '../dispatch/target-dispatchers.js'
import {
  scriptBlockProductionOperationDispatchersV1,
  productionScriptBlockChoicePlanningCompletionV1,
  productionScriptBlockPlanningCompletionV1,
} from '../dispatch/script-block-dispatchers.js'
import {
  procedureProductionOperationDispatchersV1,
  productionProcedureSimplePlanningCompletionV1,
  productionProcedureUpdateSignatureChoiceSlotsV1,
  productionProcedureUpdateSignaturePlanningCompletionV1,
  type ProcedureProductionDynamicResultSlotV1,
} from '../dispatch/procedure-dispatchers.js'
import { editJsonPointerPartV1 as pointerPart } from '../support/internal-values.js'
import {
  mediaTargetProductionOperationDispatchersV1,
  productionMediaTargetAddCostumePlanningCompletionV1,
  productionMediaTargetMediaPlanningCompletionV1,
  productionMediaTargetSpritePlanningCompletionV1,
} from '../dispatch/media-target-dispatchers.js'
import {
  combineAssetMaterializationUsageDeltasV1,
  EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1,
  type AssetMaterializationUsageDeltaV1,
} from '../assets/asset-admission.js'
import {
  composeCumulativeProjectDeltaAttributionV1,
  editOperationOccurrenceIdV1,
} from '../lineage/cumulative-attribution.js'
import {
  appendFutureBindingRealizationsV1,
  existingBindingOwnerLineageResolverV1,
  futureBindingDescriptorSha256V1,
  futureBindingKeySha256V1,
  futureBindingLedgerSha256V1,
  validateFutureBindingLedgerV1,
  FutureBindingLedgerV1,
  type FutureContractBindingV1,
  type FutureBindingOwnerLineageResolverV1,
  type FutureBindingRealizationV1,
} from '../lineage/future-binding-ledger.js'
import { buildSourceLineageV1 } from '../lineage/lineage.js'
import { compileEditRuntimeProjectionAuthorizationsV1 } from '../evaluation/runtime-projection-authority.js'
import type {
  EditOperationPlanningFactV1,
  EditOperationPlanningRequestV1,
  EditOperationPlanningResultV1,
  EditTransactionExecutionPlanV1,
  EditTransactionExecutorV1,
  EditTransactionInputV1,
} from './transaction.js'

export interface ProductionStaticRegressionEvidenceV1
{
  readonly schemaVersion: 1
  readonly kind: 'edit-static-regression-evidence-v1'
  readonly sessionId: string
  readonly currentHead: HeadProjectionV1
  readonly rejectedCandidateSha256: string
  readonly rejectedCandidateByteLength: number
  readonly newStaticSha256: string
  readonly newStatic: readonly DiagnosticFailure[]
}

interface ProductionOperationRefusalEvidenceV1
{
  readonly schemaVersion: 1
  readonly kind: 'edit-operation-refusal-evidence-v1'
  readonly refusalCode:
    | 'edit.postcondition_failed'
    | 'edit.protected_change'
    | 'edit.unauthorized_change'
  readonly sessionId: string
  readonly currentHead: HeadProjectionV1
  readonly rejectedCandidateSha256: string
  readonly rejectedCandidateByteLength: number
  readonly opId: string
  readonly semanticSurface: SemanticSurfaceV1
  readonly witnessSha256: string
  readonly witness: unknown
}

type ProductionTransactionRefusalEvidenceV1 =
  ProductionOperationRefusalEvidenceV1 | ProductionStaticRegressionEvidenceV1

type SemanticSurfaceV1 =
  | 'target'
  | 'declaration'
  | 'script'
  | 'blockField'
  | 'blockInput'
  | 'comment'
  | 'procedure'
  | 'media'
  | 'project'

const SEMANTIC_SURFACES_V1: ReadonlySet<string> = new Set([
  'target',
  'declaration',
  'script',
  'blockField',
  'blockInput',
  'comment',
  'procedure',
  'media',
  'project',
])

export class ProductionTransactionErrorV1 extends Error
{
  constructor(
    readonly code: string,
    message: string,
    readonly context: RefusalContextV1 = {},
    readonly evidence: ProductionTransactionRefusalEvidenceV1 | null = null
  )
  {
    super(message)
    this.name = 'ProductionTransactionErrorV1'
  }
}

interface ProductionPlanningFactProjectionV1
{
  readonly kind: 'group-c-target-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: TargetOperationV1['kind']
  readonly opId: string
  readonly targetLineageId: string
  readonly selectedTarget: TargetEntityEvidenceV1
  readonly facts: unknown
}

export interface ProductionOperationContextV1
{
  readonly input: EditTransactionInputV1
  readonly source: ProjectIR
  readonly preBatch: ProjectIR
  readonly candidate: ProjectIR
  readonly contract: EditSemanticChangeContractV1
  readonly operationResultsById: ReadonlyMap<string, unknown>
  readonly preBatchLineage: SemanticLineageSnapshot
  readonly activeLineage: SemanticLineageSnapshot
  readonly futureBindingLedger: FutureBindingLedgerV1
}

const preBatchReferenceIndexKey = Symbol('preBatchReferenceIndex')

interface IndexedProductionOperationContextV1 extends ProductionOperationContextV1
{
  readonly [preBatchReferenceIndexKey]: SemanticReferenceIndex
}

export interface ProductionFutureBindingRealizationCandidateV1
{
  readonly bindingKey: string
  readonly createdEntityKind: FutureContractBindingV1['entityKind']
  readonly createdEntitySubtype: FutureContractBindingV1['entitySubtype']
  readonly collisionNonce: number
  readonly creationKey: string
  readonly resultLineageId: string
  readonly ownerLineageId: string | null
}

export interface ProductionOperationDispatchResultV1
{
  readonly canonicalOperation: SemanticEditOperationV1
  readonly selectedScope: ContractScopeV1
  readonly result: unknown
  readonly attribution: DeltaOperationAttribution
  readonly activeLineage: SemanticLineageSnapshot
  readonly correspondence?: OrderedCollectionCorrespondence
  readonly planningFactProjection: unknown
  readonly matchedContractBindingKeys: readonly string[]
  readonly selectedEntityLineageIds: readonly string[]
  readonly structuralAuthorization: ProductionStructuralAuthorizationV1
  readonly assetMaterializationUsage?: AssetMaterializationUsageDeltaV1
  readonly futureBindingRealizationCandidates?: readonly ProductionFutureBindingRealizationCandidateV1[]
  readonly authorizationEvidence?: ProductionOperationAuthorizationEvidenceV1
}

interface ProductionOperationAuthorizationEvidenceV1
{
  readonly targetOperationResult?: TargetOperationResultV1
  readonly entityMove?: {
    readonly collection: 'scriptWorkspace' | 'commentWorkspace'
    readonly beforePositionSha256: string
    readonly afterPositionSha256: string
  }
  readonly referencePropagation?: {
    readonly beforeReferenceSetSha256: string
    readonly afterReferenceSetSha256: string
  }
  readonly groupDGraph?: {
    readonly publicRemovalPaths: readonly string[]
  }
}

export interface ProductionStructuralAuthorizationV1
{
  readonly exactPaths: readonly string[]
  readonly pathPrefixes: readonly string[]
}

interface ProductionDeltaObservationV1
{
  readonly observationKind: 'leaf' | 'asset' | 'ordered' | 'protected'
  readonly path: string
  readonly kind: string
  readonly operationIds: readonly string[]
  readonly entityLineageIds: readonly string[]
  readonly beforeState?: unknown
  readonly afterState?: unknown
  readonly protectedClass?: ProtectedChangeClass
  readonly mandatory?: boolean
}

export interface ProductionOperationDispatcherV1
{
  readonly operationKinds: readonly SemanticEditOperationV1['kind'][]
  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
}

interface AppliedProductionOperationV1 extends ProductionOperationDispatchResultV1
{
  readonly operation: SemanticEditOperationV1
  readonly occurrenceId: string
}

interface AppliedProductionPrefixV1
{
  readonly sourceLineage: SemanticLineageSnapshot
  readonly resolveOwnerLineageId: FutureBindingOwnerLineageResolverV1
  readonly beforeActiveLineage: SemanticLineageSnapshot
  readonly activeLineage: SemanticLineageSnapshot
  readonly lineageHistory: SemanticLineageSnapshot
  readonly beforeFutureBindingLedger: FutureBindingLedgerV1
  readonly futureBindingLedger: FutureBindingLedgerV1
  readonly addedFutureBindingRealizations: readonly FutureBindingRealizationV1[]
  readonly candidate: ProjectIR
  readonly allocator: Uids
  readonly operationResultsById: ReadonlyMap<string, unknown>
  readonly applied: readonly AppliedProductionOperationV1[]
}

interface AdvanceProductionFutureBindingLedgerInputV1
{
  readonly ledger: FutureBindingLedgerV1
  readonly changeContractSha256: string
  readonly contract: EditSemanticChangeContractV1
  readonly priorLineageHistory: SemanticLineageSnapshot
  readonly lineageHistory: SemanticLineageSnapshot
  readonly creatorOperationOccurrenceId: string
  readonly predecessorAcceptedHistorySha256: string
  readonly creatorOperationId: string
  readonly creatorOperationKind: SemanticEditOperationV1['kind']
  readonly candidates: readonly ProductionFutureBindingRealizationCandidateV1[]
  readonly resolveOwnerLineageId: FutureBindingOwnerLineageResolverV1
}

interface MutableAuthorizationEnvelopeV1
{
  readonly operationId: string
  readonly exactPaths: Set<string>
  readonly changeKinds: Set<DeltaChangeKind>
  readonly protectedClasses: Set<ProtectedChangeClass>
  readonly entityLineageIds: Set<string>
  allowMandatoryProtectedChange: boolean
}

function fail(
  code: string,
  message: string,
  context: RefusalContextV1 = {},
  evidence: ProductionTransactionRefusalEvidenceV1 | null = null
): never
{
  throw new ProductionTransactionErrorV1(code, message, context, evidence)
}

function operationSemanticSurfaceV1(
  operation: SemanticEditOperationV1
): SemanticSurfaceV1 | null
{
  if (operation.kind.startsWith('target.')) return 'target'
  if (operation.kind.startsWith('declaration.')) return 'declaration'
  if (operation.kind.startsWith('script.')) return 'script'
  if (operation.kind === 'block.setField') return 'blockField'
  if (operation.kind === 'block.setInput') return 'blockInput'
  // structural block edits can fail on a script, input, field, comment, or
  // declaration edge; the operation prefix alone does not own that surface
  if (operation.kind.startsWith('block.')) return null
  if (operation.kind.startsWith('comment.')) return 'comment'
  if (operation.kind.startsWith('procedure.')) return 'procedure'
  if (operation.kind.startsWith('media.')) return 'media'
  return null
}

function exactRefusalMatchCountV1(
  code: RefusalCode,
  error: Record<string, unknown>,
  operation: SemanticEditOperationV1
): number | null
{
  const context =
    error['context'] !== null && typeof error['context'] === 'object'
      ? (error['context'] as Record<string, unknown>)
      : null
  const value = context?.['matchCount'] ?? error['matchCount']
  if (Number.isSafeInteger(value) && (value as number) >= 0)
    return value as number
  // the media authority checks this retained count immediately before refusing
  // removal, so it remains exact even though its error omits the field
  if (
    code === 'edit.last_costume' &&
    operation.kind === 'media.removeCostume' &&
    Number.isSafeInteger(operation.expectedCostumeCount) &&
    operation.expectedCostumeCount >= 0
  )
    return operation.expectedCostumeCount
  // an empty selector result is the definition of this refusal, rather than a
  // default standing in for an authority-owned candidate set
  return code === 'edit.selector_no_match' ? 0 : null
}

function failOperationRefusalV1(
  error: unknown,
  operation: SemanticEditOperationV1
): never
{
  const record =
    error !== null && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null
  const code = record?.['code']
  const row =
    typeof code === 'string'
      ? REFUSAL_REVIEW_ROWS.find((candidate) => candidate.code === code)
      : undefined
  if (!row) throw error
  const context: Record<string, unknown> = {}
  const carriedContext =
    record?.['context'] !== null && typeof record?.['context'] === 'object'
      ? (record['context'] as Record<string, unknown>)
      : null
  for (const field of row.contextFields)
  {
    if (field === 'opId') context[field] = operation.opId
    else if (field === 'semanticSurface')
    {
      const carriedSurface = carriedContext?.['semanticSurface']
      const semanticSurface =
        typeof carriedSurface === 'string' &&
        SEMANTIC_SURFACES_V1.has(carriedSurface)
          ? (carriedSurface as SemanticSurfaceV1)
          : operationSemanticSurfaceV1(operation)
      if (semanticSurface === null)
        return fail(
          'edit.internal_invariant',
          `operation refusal ${row.code} has no exact semantic surface`
        )
      context[field] = semanticSurface
    }
    else if (field === 'matchCount')
    {
      const matchCount = exactRefusalMatchCountV1(row.code, record!, operation)
      if (matchCount === null)
        return fail(
          'edit.internal_invariant',
          `operation refusal ${row.code} has no exact match cardinality`
        )
      context[field] = matchCount
    }
    else if (carriedContext !== null && Object.hasOwn(carriedContext, field))
      context[field] = structuredClone(carriedContext[field])
    else
      return fail(
        'edit.internal_invariant',
        `operation refusal ${row.code} has no retained authority for ${field}`
      )
  }
  throw new ProductionTransactionErrorV1(
    row.code,
    error instanceof Error ? error.message : String(error),
    context as RefusalContextV1
  )
}

function finalResultEvidenceForSlot(
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  slot:
    | ProductionResultSlotV1
    | ProductionDynamicBlockResultSlotV1
    | ProcedureProductionDynamicResultSlotV1
):
  | DeclarationEntityEvidenceV1
  | CommentEntityEvidenceV1
  | ScriptEntityEvidenceV1
  | BlockEntityEvidenceV1
  | ProcedureEntityEvidenceV1
  | ParameterEntityEvidenceV1
  | MediaRecordEntityEvidenceV1
  | TargetEntityEvidenceV1
  {
  const resultRecords = activeLineage.records.filter(
    (record) => record.lineageId === slot.lineageId
  )
  if (resultRecords.length !== 1 || resultRecords[0]!.status !== 'active')
    return fail(
      'edit.created_result_invalid',
      `fixed result lineage is absent from the final head: ${slot.lineageId}`
    )
  const resultRecord = resultRecords[0]!
  // a media lineage row is filed under its own subtype rather than the umbrella
  // 'media' kind the slot names, so the record kind is compared against the
  // subtype for that one family
  const expectedRecordKind =
    slot.entityKind === 'media' ? slot.entitySubtype : slot.entityKind
  // a created sprite is owned by the project, so it is the one result whose
  // absent owner is correct rather than a lineage regression
  const ownerIsProject = slot.entityKind === 'target'
  if (
    resultRecord.kind !== expectedRecordKind ||
    (!ownerIsProject && resultRecord.ownerLineageId === null) ||
    resultRecord.ownerLineageId !== slot.ownerLineageId
  )
    return fail(
      'edit.created_result_invalid',
      `fixed result lineage kind or owner changed: ${slot.lineageId}`
    )
  if (slot.entityKind === 'target')
  {
    const ordered = activeOrderedSemanticLineages(activeLineage, 'target', null)
    const createdIndex = ordered.findIndex(
      (record) => record.lineageId === slot.lineageId
    )
    const evidence = targetEntityEvidenceSetV1(project.json)[createdIndex]
    if (createdIndex < 0 || !evidence || evidence.targetKind !== 'sprite')
      return fail(
        'edit.created_result_invalid',
        `fixed target result is absent from the final head: ${slot.lineageId}`
      )
    return evidence
  }
  // a parameter is the one result whose owner is not the target: it hangs off
  // its procedure, so the owning target is one hop further up
  const ownerProcedure =
    slot.entityKind === 'parameter'
      ? activeLineage.records.find(
          (record) =>
            record.lineageId === resultRecord.ownerLineageId &&
            record.status === 'active' &&
            record.kind === 'procedure'
        )
      : undefined
  if (slot.entityKind === 'parameter' && !ownerProcedure)
    return fail(
      'edit.created_result_invalid',
      `parameter result owner procedure is absent from the final head: ${slot.lineageId}`
    )
  const ownerTargetLineageId =
    ownerProcedure === undefined
      ? resultRecord.ownerLineageId
      : ownerProcedure.ownerLineageId
  const targetLineages = activeOrderedSemanticLineages(
    activeLineage,
    'target',
    null
  )
  if (targetLineages.length !== project.json.targets.length)
    return fail(
      'edit.internal_invariant',
      'final target lineage does not correspond to the candidate'
    )
  const targetIndex = targetLineages.findIndex(
    (record) => record.lineageId === ownerTargetLineageId
  )
  if (targetIndex < 0)
    return fail(
      'edit.created_result_invalid',
      `fixed result owner is absent from the final head: ${slot.lineageId}`
    )
  // a media record is addressed positionally within its owning collection, so
  // its ordinal is read back off the running lineage rather than off the stale
  // ordinal the slot minted before later operations shifted it
  if (slot.entityKind === 'media')
  {
    const mediaKind = slot.entitySubtype === 'sound' ? 'sound' : 'costume'
    const ordered = activeOrderedSemanticLineages(
      activeLineage,
      mediaKind,
      resultRecord.ownerLineageId
    )
    const ordinal = ordered.findIndex(
      (record) => record.lineageId === slot.lineageId
    )
    const evidence = mediaRecordEntityEvidenceSetV1(project).find(
      (candidate) =>
        candidate.mediaKind === mediaKind &&
        candidate.targetIndex === targetIndex &&
        candidate.ordinal === ordinal
    )
    if (ordinal < 0 || !evidence)
      return fail(
        'edit.created_result_invalid',
        `fixed media result is absent from the final head: ${slot.lineageId}`
      )
    return evidence
  }
  if (slot.entityKind === 'procedure')
  {
    const matches = procedureEntityEvidenceSetV1(project).filter(
      (evidence) =>
        evidence.targetIndex === targetIndex &&
        `procedure:${evidence.proccode}` === resultRecord.rawIdentity
    )
    if (matches.length !== 1 || slot.entitySubtype !== 'unspecialized')
      return fail(
        'edit.created_result_invalid',
        `fixed procedure result is absent from the final head: ${slot.lineageId}`
      )
    return matches[0]!
  }
  if (slot.entityKind === 'parameter')
  {
    const proccode = /^procedure:(.*)$/su.exec(ownerProcedure!.rawIdentity)?.[1]
    const matches = parameterEntityEvidenceSetV1(project).filter(
      (evidence) =>
        evidence.targetIndex === targetIndex &&
        evidence.proccode === proccode &&
        `parameter:${evidence.argumentId}` === resultRecord.rawIdentity
    )
    if (matches.length !== 1 || slot.entitySubtype !== 'unspecialized')
      return fail(
        'edit.created_result_invalid',
        `parameter result is absent from the final head: ${slot.lineageId}`
      )
    return matches[0]!
  }
  if (slot.entityKind === 'declaration')
  {
    const matches = declarationEntityEvidenceSetV1(project).filter(
      (evidence) =>
        evidence.targetIndex === targetIndex &&
        `${evidence.declarationKind}:${evidence.declarationId}` ===
          resultRecord.rawIdentity
    )
    if (
      matches.length !== 1 ||
      matches[0]!.declarationKind !== slot.entitySubtype
    )
      return fail(
        'edit.created_result_invalid',
        `fixed declaration result is absent from the final head: ${slot.lineageId}`
      )
    return matches[0]!
  }
  if (slot.entityKind === 'comment')
  {
    const matches = commentEntityEvidenceSetV1(project).filter(
      (evidence) =>
        evidence.targetIndex === targetIndex &&
        `comment:${evidence.commentId}` === resultRecord.rawIdentity
    )
    if (matches.length !== 1 || slot.entitySubtype !== 'unspecialized')
      return fail(
        'edit.created_result_invalid',
        `fixed comment result is absent from the final head: ${slot.lineageId}`
      )
    return matches[0]!
  }
  if (slot.entityKind === 'script')
  {
    const matches = scriptEntityEvidenceSetV1(project).filter(
      (evidence) =>
        evidence.targetIndex === targetIndex &&
        `script:${evidence.topBlockId}` === resultRecord.rawIdentity
    )
    if (matches.length !== 1 || slot.entitySubtype !== 'unspecialized')
      return fail(
        'edit.created_result_invalid',
        `fixed script result is absent from the final head: ${slot.lineageId}`
      )
    return matches[0]!
  }
  const matches = blockEntityEvidenceSetV1(project).filter(
    (evidence) =>
      evidence.targetIndex === targetIndex &&
      `block:${evidence.blockId}` === resultRecord.rawIdentity
  )
  if (matches.length !== 1 || slot.entitySubtype !== 'unspecialized')
    return fail(
      'edit.created_result_invalid',
      `fixed block result is absent from the final head: ${slot.lineageId}`
    )
  return matches[0]!
}

function reconcileOperationResultWithFinalHead(
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  value: unknown
): unknown
{
  if (value === null || typeof value !== 'object') return value
  const result = value as Partial<ProductionOperationResultV1>
  if (!Array.isArray(result.fixedSlots)) return value
  const fixedSlots = result.fixedSlots.map((slot) =>
  {
    const evidence = finalResultEvidenceForSlot(project, activeLineage, slot)
    return Object.freeze({
      ...slot,
      semanticLocationSha256: evidence.semanticLocationSha256,
      semanticFingerprintSha256: evidence.semanticFingerprintSha256,
      contextFingerprintSha256: evidence.contextFingerprintSha256,
    })
  })
  const dynamicSlots = (result.dynamicSlots ?? []).map((slot) =>
  {
    const evidence = finalResultEvidenceForSlot(project, activeLineage, slot)
    return Object.freeze({
      ...slot,
      semanticLocationSha256: evidence.semanticLocationSha256,
      semanticFingerprintSha256: evidence.semanticFingerprintSha256,
      contextFingerprintSha256: evidence.contextFingerprintSha256,
    })
  })
  if (fixedSlots.length === 0 && dynamicSlots.length === 0) return value
  return Object.freeze({
    ...result,
    fixedSlots: Object.freeze(fixedSlots),
    ...(dynamicSlots.length > 0
      ? { dynamicSlots: Object.freeze(dynamicSlots) }
      : {}),
  })
}

type ResultSlotEvidenceV1 = ReturnType<typeof finalResultEvidenceForSlot>

// the contract's bounded location for one result slot. Every entity family the
// result-slot table names is covered, so a slot can never project without one
function resultSlotLocationProjectionV1(
  entityKind: string,
  evidence: ResultSlotEvidenceV1
): BoundedSemanticLocationProjectionV1
{
  const artifactId = `${entityKind}-location-${evidence.semanticLocationSha256.slice(0, 32)}`
  if (entityKind === 'target')
  {
    return targetBoundedLocationProjectionV1(
      evidence as TargetEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'declaration')
  {
    return declarationBoundedLocationProjectionV1(
      evidence as DeclarationEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'script')
  {
    return scriptBoundedLocationProjectionV1(
      evidence as ScriptEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'block')
  {
    return blockBoundedLocationProjectionV1(
      evidence as BlockEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'comment')
  {
    return commentBoundedLocationProjectionV1(
      evidence as CommentEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'media')
  {
    return mediaBoundedLocationProjectionV1(
      evidence as MediaRecordEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'procedure')
  {
    return procedureResultLocationV1(
      evidence as ProcedureEntityEvidenceV1,
      artifactId
    )
  }
  if (entityKind === 'parameter')
  {
    return parameterResultLocationV1(
      evidence as ParameterEntityEvidenceV1,
      artifactId
    )
  }
  return fail(
    'edit.created_result_invalid',
    `result slot has no bounded location projection: ${entityKind}`
  )
}

function procedureResultLocationV1(
  evidence: ProcedureEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedSemanticLocationProjectionV1
{
  return {
    kind: 'procedure',
    targetLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.target
    ),
    canonicalSignature: boundedResultDisplayStringV1(
      evidence.location.canonicalSignature
    ),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

function parameterResultLocationV1(
  evidence: ParameterEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedSemanticLocationProjectionV1
{
  return {
    kind: 'parameter',
    name: boundedResultDisplayStringV1(evidence.location.name),
    ordinal: evidence.ordinal,
    parameterType: evidence.parameterType,
    procedureLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.procedure
    ),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

// project strings are untrusted data, so a display value goes through the same
// bounded inline/hash-only projection every other location surface uses
function boundedResultDisplayStringV1(value: string): BoundedDisplayStringV1
{
  return boundedDisplayStringV1(value) as unknown as BoundedDisplayStringV1
}

// one result slot in the shape OperationResultSummaryV1 declares, rather than
// the kernel's internal slot record
function projectResultSlotV1(
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  slot:
    | ProductionResultSlotV1
    | ProductionDynamicBlockResultSlotV1
    | ProcedureProductionDynamicResultSlotV1
): Record<string, unknown>
{
  const evidence = finalResultEvidenceForSlot(project, activeLineage, slot)
  // an alias slot names itself by alias, a parameter slot by local key, & a
  // fixed slot by its frozen slot name
  const identity =
    slot.slotKind === 'fixed'
      ? { slotKind: 'fixed', name: slot.name }
      : slot.slotKind === 'parameter'
        ? { slotKind: 'parameter', localKey: slot.alias }
        : { slotKind: slot.slotKind, alias: slot.alias }
  return {
    slot: identity,
    entityKind: slot.entityKind,
    lineageSha256: slot.lineageId,
    semanticFingerprint: slot.semanticFingerprintSha256,
    contextFingerprint: slot.contextFingerprintSha256,
    location: resultSlotLocationProjectionV1(slot.entityKind, evidence),
  }
}

// the effects the parent delta attributes to exactly this operation occurrence
function attributedEffectsV1(
  delta: ProjectDelta,
  occurrenceId: string
): readonly unknown[]
{
  return [
    ...allDeltaChanges(delta).filter((change) =>
      change.operationIds.includes(occurrenceId)
    ),
    ...delta.assets.filter((asset) =>
      asset.operationIds.includes(occurrenceId)
    ),
    ...(delta.orderedCollectionChanges ?? []).filter((change) =>
      change.operationIds.includes(occurrenceId)
    ),
  ]
}

// * the frozen contract declares OperationResultSummaryV1 as the projection a
// * tool answers w/, so the kernel's internal result record is projected into
// * it here rather than the internal record being widened onto the wire
function projectOperationResultSummariesV1(
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  delta: ProjectDelta,
  applied: readonly AppliedProductionOperationV1[]
): readonly OperationResultSummaryV1[]
{
  const summaries = Object.freeze(
    applied.map((entry) =>
    {
      const result = entry.result as Partial<ProductionOperationResultV1>
      const fixedSlots = result.fixedSlots ?? []
      const dynamicSlots = result.dynamicSlots ?? []
      const fixed: Record<string, unknown> = {}
      for (const slot of fixedSlots)
      {
        fixed[slot.name] = projectResultSlotV1(project, activeLineage, slot)
      }
      const dynamic = dynamicSlots.map((slot) =>
        projectResultSlotV1(project, activeLineage, slot)
      )
      const effects = attributedEffectsV1(delta, entry.occurrenceId)
      const evidenceIds = uniqueSorted([
        entry.occurrenceId,
        ...(result.postconditionSha256 ? [result.postconditionSha256] : []),
      ])
      return Object.freeze({
        itemKind: 'operationResult',
        opId: entry.operation.opId,
        operationKind: entry.operation.kind,
        attributedEffectSha256: editCanonicalSha256V1({
          kind: 'operation-attributed-effects',
          schemaVersion: 1,
          occurrenceId: entry.occurrenceId,
          effects,
        }),
        attributedEffectCount: effects.length,
        evidenceIds: Object.freeze(evidenceIds),
        outcome: 'accepted',
        resultSlots: Object.freeze({
          fixed: Object.freeze(fixed),
          dynamic: Object.freeze(dynamic),
          orderedSlotSetSha256: editCanonicalSha256V1({
            kind: 'operation-result-ordered-slot-set',
            schemaVersion: 1,
            fixed: fixedSlots.map((slot) => [slot.name, slot.lineageId]),
            dynamic: dynamicSlots.map((slot) => [
              slot.alias ?? slot.name,
              slot.lineageId,
            ]),
          }),
        }),
      }) as OperationResultSummaryV1
    })
  )
  return summaries
}

function parsedBatch(value: unknown): SemanticEditBatchV1
{
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['descriptorKind'] ===
      'phase8-group-b-kernel-test-v1'
  )
  {
    const operations = (value as Record<string, unknown>)['operations']
    const first = Array.isArray(operations) ? operations[0] : null
    const opId =
      first !== null &&
      typeof first === 'object' &&
      typeof (first as Record<string, unknown>)['opId'] === 'string'
        ? ((first as Record<string, unknown>)['opId'] as string)
        : 'private-descriptor'
    return fail(
      'edit.unsupported_operation',
      'the production executor does not admit the private kernel test descriptor',
      { opId }
    )
  }
  const parsed = parseContractDefinitionV1<SemanticEditBatchV1>(
    'SemanticEditBatchV1',
    value
  )
  if (!parsed.ok)
    return fail(
      'edit.schema_failed',
      `semantic edit batch failed ${parsed.issues.length} exact schema check(s)`
    )
  return parsed.value
}

function parsedContract(value: unknown): EditSemanticChangeContractV1
{
  const parsed = parseSemanticChangeContractV1(value)
  if (!parsed.ok)
    return fail(
      'edit.stale_contract',
      `semantic change contract failed ${parsed.issues.length} exact schema check(s)`
    )
  return parsed.value
}

function authorizationFutureBindingLedgerV1(
  value: unknown
): FutureBindingLedgerV1
{
  if (value === null || typeof value !== 'object')
    return fail(
      'edit.internal_invariant',
      'current revision authorization is absent'
    )
  const ledger = (value as Record<string, unknown>)['futureBindingLedger']
  if (ledger === null || typeof ledger !== 'object')
    return fail(
      'edit.internal_invariant',
      'current revision future-binding ledger is absent'
    )
  return ledger as FutureBindingLedgerV1
}

export function productionFutureBindingLedgerV1(
  input: EditTransactionInputV1,
  contract: EditSemanticChangeContractV1,
  resolveOwnerLineageId: FutureBindingOwnerLineageResolverV1
): FutureBindingLedgerV1
{
  return validateFutureBindingLedgerV1(
    authorizationFutureBindingLedgerV1(input.currentRevision.authorization),
    contract,
    input.currentRevision.lineageHistory as SemanticLineageSnapshot,
    resolveOwnerLineageId
  )
}

export function advanceProductionFutureBindingLedgerV1(
  input: AdvanceProductionFutureBindingLedgerInputV1
): FutureBindingLedgerV1
{
  if (input.ledger.changeContractSha256 !== input.changeContractSha256)
    return fail(
      'edit.internal_invariant',
      'future-binding ledger contract identity changed'
    )
  const realizations = input.candidates.map((candidate) =>
  {
    const bindings = input.contract.entityBindings.filter(
      (binding) =>
        binding.bindingKind === 'future' &&
        binding.bindingKey === candidate.bindingKey
    )
    if (bindings.length !== 1 || bindings[0]!.bindingKind !== 'future')
      return fail(
        'edit.unauthorized_change',
        'future-binding realization does not resolve one exact descriptor'
      )
    return {
      binding: bindings[0]!,
      creatorOperationOccurrenceId: input.creatorOperationOccurrenceId,
      predecessorAcceptedHistorySha256: input.predecessorAcceptedHistorySha256,
      creatorOperationId: input.creatorOperationId,
      creatorOperationKind: input.creatorOperationKind,
      createdEntityKind: candidate.createdEntityKind,
      createdEntitySubtype: candidate.createdEntitySubtype,
      collisionNonce: candidate.collisionNonce,
      creationKey: candidate.creationKey,
      resultLineageId: candidate.resultLineageId,
      ownerLineageId: candidate.ownerLineageId,
    }
  })
  return appendFutureBindingRealizationsV1(
    input.ledger,
    input.contract,
    input.priorLineageHistory,
    input.lineageHistory,
    realizations,
    input.resolveOwnerLineageId
  )
}

function assertExactHead(
  input: EditTransactionInputV1,
  batch: SemanticEditBatchV1
): void
{
  const expected = batch.expected
  const current = input.currentHead
  if (expected.sessionId !== input.sessionId)
    fail('edit.source_identity_mismatch', 'planning head session is wrong')
  if (
    expected.expectedRevisionNumber !== current.revisionNumber ||
    expected.expectedRevisionId !== current.revisionId
  )
    fail('edit.stale_revision', 'planning head revision is stale', {
      expectedRevisionId: expected.expectedRevisionId,
      currentRevisionId: current.revisionId,
    })
  if (expected.expectedCandidateSha256 !== current.candidateSha256)
    fail('edit.stale_candidate', 'planning head candidate is stale', {
      expectedCandidateSha256: expected.expectedCandidateSha256,
      currentCandidateSha256: current.candidateSha256,
    })
  if (expected.expectedSourceArtifactSha256 !== current.sourceArtifactSha256)
    fail(
      'edit.source_identity_mismatch',
      'planning head source artifact is wrong'
    )
  if (expected.expectedAssetManifestSha256 !== current.assetManifestSha256)
    fail('edit.source_identity_mismatch', 'planning head assets are stale')
  if (expected.expectedChangeContractSha256 !== current.changeContractSha256)
    fail('edit.stale_contract', 'planning head change contract is stale')
  if (
    expected.expectedCapabilityProfileSha256 !== current.capabilityProfileSha256
  )
    fail(
      'edit.stale_capability_profile',
      'planning head capability profile is stale'
    )
  if (
    expected.expectedCapabilitySnapshotSha256 !==
    current.capabilitySnapshotSha256
  )
    fail(
      'edit.stale_capability_snapshot',
      'planning head capability snapshot is stale'
    )
}

function dependencyIds(value: unknown): readonly string[]
{
  const dependencies = new Set<string>()
  const visit = (entry: unknown): void =>
  {
    if (entry === null || typeof entry !== 'object') return
    if (Array.isArray(entry))
    {
      for (const child of entry) visit(child)
      return
    }
    const record = entry as Record<string, unknown>
    if (record.refKind === 'created' && typeof record.opId === 'string')
      dependencies.add(record.opId)
    for (const key of Object.keys(record)) visit(record[key])
  }
  visit(value)
  return Object.freeze([...dependencies].sort())
}

function assertOperationOrder(
  operations: readonly SemanticEditOperationV1[]
): void
{
  const allIds = new Set<string>()
  const completedIds = new Set<string>()
  for (const operation of operations)
  {
    if (allIds.has(operation.opId))
      fail('edit.duplicate_op_id', `duplicate operation ID ${operation.opId}`, {
        opId: operation.opId,
      })
    allIds.add(operation.opId)
    for (const dependencyId of dependencyIds(operation))
    {
      if (dependencyId === operation.opId)
        fail(
          'edit.graph_cycle',
          `operation ${operation.opId} depends on itself`
        )
      if (!completedIds.has(dependencyId))
        fail(
          'edit.created_result_invalid',
          `operation ${operation.opId} has a missing or forward dependency ${dependencyId}`,
          { opId: operation.opId }
        )
    }
    completedIds.add(operation.opId)
  }
}

function asProject(
  preflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>,
  label: string
): ProjectIR
{
  if (!preflight.ok || !preflight.project || !preflight.admission)
    return fail(
      'edit.graph_failed',
      `${label} semantic edit admission failed${
        preflight.refusal ? `: ${preflight.refusal.message}` : ''
      }`
    )
  return preflight.project
}

function assertInputIdentities(
  input: EditTransactionInputV1,
  sourcePreflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>,
  currentPreflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>,
  contract: EditSemanticChangeContractV1
): void
{
  if (sha256Hex(input.sourceBytes) !== input.sourceArtifactSha256)
    fail('edit.source_identity_mismatch', 'source artifact bytes changed')
  if (sha256Hex(input.currentBytes) !== input.currentHead.candidateSha256)
    fail('edit.stale_candidate', 'current candidate bytes changed', {
      expectedCandidateSha256: input.currentHead.candidateSha256,
      currentCandidateSha256: sha256Hex(input.currentBytes),
    })
  const semanticSourceIdentity =
    input.semanticSourceIdentity?.sourceKind === 'registeredTemplate' &&
    sourcePreflight.semanticSourceIdentity
      ? {
          ...sourcePreflight.semanticSourceIdentity,
          sourceKind: 'registeredTemplate' as const,
          templateArtifactSha256:
            input.semanticSourceIdentity.templateArtifactSha256,
          templateId: input.semanticSourceIdentity.templateId,
          templateVersion: input.semanticSourceIdentity.templateVersion,
        }
      : sourcePreflight.semanticSourceIdentity
  if (
    !semanticSourceIdentity ||
    semanticHashV1('semantic-source', semanticSourceIdentity) !==
      input.semanticSourceSha256
  )
    fail('edit.source_identity_mismatch', 'semantic source identity changed')
  if (
    editCanonicalSha256V1(input.currentRevision.head) !==
    editCanonicalSha256V1(input.currentHead)
  )
    fail('edit.stale_revision', 'current revision record is not the head', {
      expectedRevisionId: input.currentRevision.head.revisionId,
      currentRevisionId: input.currentHead.revisionId,
    })
  if (
    input.changeContractSha256 !== input.currentHead.changeContractSha256 ||
    semanticHashV1('change-contract', contract) !== input.changeContractSha256
  )
    fail('edit.stale_contract', 'change contract identity changed')
  if (
    contract.sourceConstraint.kind === 'exactArtifact' &&
    contract.sourceConstraint.sourceArtifactSha256 !==
      input.sourceArtifactSha256
  )
    fail('edit.stale_contract', 'change contract belongs to another source')
  if (!currentPreflight.semanticSourceIdentity)
    fail('edit.internal_invariant', 'current admission identity is absent')
  if (
    currentPreflight.semanticSourceIdentity.assetManifestSha256 !==
    input.currentHead.assetManifestSha256
  )
    fail(
      'edit.internal_invariant',
      'candidate admission asset identity differs from its retained head'
    )
}

function cloneCandidate(
  current: ProjectIR,
  allocatorState: unknown
): { project: ProjectIR; allocator: Uids }
{
  const snapshot = structuredClone(allocatorState) as UidSnapshot
  const project = ProjectIR.fromProjectJsonWithUidSnapshot(
    structuredClone(current.toProjectJson()),
    current.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    })),
    snapshot
  )
  return { project, allocator: project.uids }
}

function targetLineageId(
  lineage: SemanticLineageSnapshot,
  targetCount: number,
  targetIndex: number
): string
{
  const targets = activeOrderedSemanticLineages(lineage, 'target', null)
  if (targets.length !== targetCount || !targets[targetIndex])
    return fail(
      'edit.internal_invariant',
      'target lineage does not correspond to the current project'
    )
  return targets[targetIndex]!.lineageId
}

function propertyState(target: object, property: string): unknown
{
  const descriptor = Object.getOwnPropertyDescriptor(target, property)
  if (descriptor?.enumerable !== true || !('value' in descriptor))
    return { state: 'missing' }
  if (descriptor.value === null) return { state: 'null' }
  return { state: 'value', value: descriptor.value }
}

// the self-hash is excluded; only current selected-state facts enter this projection
function productionTargetPlanningFactProjectionIndexedV1(
  project: ProjectIR,
  operation: TargetOperationV1,
  targetIndex: number,
  activeLineage: SemanticLineageSnapshot,
  suppliedIndex?: SemanticReferenceIndex
): ProductionPlanningFactProjectionV1
{
  const selectedTarget = targetEntityEvidenceSetV1(project.json)[targetIndex]
  const target = project.json.targets[targetIndex]
  if (!selectedTarget || !target)
    return fail('edit.selector_no_match', 'planning target is absent')
  const lineageId = targetLineageId(
    activeLineage,
    project.json.targets.length,
    targetIndex
  )
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  let facts: unknown
  if (operation.kind === 'target.renameSprite')
  {
    const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
    const activation = targetProspectiveNameActivationV1(
      project,
      index,
      operation.newName
    )
    facts = {
      currentName: targetExpectedStringIdentityV1(target.name),
      inboundReferenceSetSha256: inbound.referenceSetSha256,
      prospectiveNameActivationSetSha256: activation.activationSetSha256,
      prospectiveNameActivationCount: activation.activations.length,
    }
  }
  else if (operation.kind === 'target.reorderSprite')
  {
    const order = targetDualOrderSnapshotV1(project.json, activeLineage)
    facts = {
      visualLayerOrdinal: target.isStage ? null : target.layerOrder,
      visualLayerOrderSha256: order.visualLayerOrderSha256,
      runtimeExecutableTargetOrderSha256:
        order.runtimeExecutableTargetOrderSha256,
    }
  }
  else if (operation.kind === 'target.removeSprite')
  {
    const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
    const order = targetDualOrderSnapshotV1(project.json, activeLineage)
    facts = {
      inboundReferenceSetSha256: inbound.referenceSetSha256,
      inboundReferenceCount: inbound.references.length,
      ownedSurfaceSha256: targetOwnedSurfaceSha256V1(target),
      serializedTargetOrderSha256: order.serializedTargetOrderSha256,
      visualLayerOrderSha256: order.visualLayerOrderSha256,
      runtimeExecutableTargetOrderSha256:
        order.runtimeExecutableTargetOrderSha256,
    }
  }
  else
  {
    facts = {
      properties: operation.edits.map((edit) => ({
        property: edit.property,
        current: propertyState(target, edit.property),
      })),
    }
  }
  return {
    kind: 'group-c-target-planning-fact-set',
    schemaVersion: 1,
    operationKind: operation.kind,
    opId: operation.opId,
    targetLineageId: lineageId,
    selectedTarget,
    facts,
  }
}

function productionTargetPlanningFactSetSha256IndexedV1(
  project: ProjectIR,
  operation: TargetOperationV1,
  targetIndex: number,
  activeLineage: SemanticLineageSnapshot,
  index: SemanticReferenceIndex
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionTargetPlanningFactProjectionIndexedV1(
      project,
      operation,
      targetIndex,
      activeLineage,
      index
    )
  )
}

export function productionTargetPlanningFactSetSha256V1(
  project: ProjectIR,
  operation: TargetOperationV1,
  targetIndex: number,
  activeLineage: SemanticLineageSnapshot
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionTargetPlanningFactProjectionIndexedV1(
      project,
      operation,
      targetIndex,
      activeLineage
    )
  )
}

function resolveHandleTarget(
  input: EditTransactionInputV1,
  reference: Extract<TargetRefV1, { refKind: 'handle' }>,
  evidence: readonly TargetEntityEvidenceV1[],
  lineage: SemanticLineageSnapshot,
  targetCount: number
): number | null
{
  if (!input.verifyHandle) return null
  const matches = evidence.filter((candidate) =>
    input.verifyHandle!({
      token: reference.token,
      entityKind: 'target',
      entitySubtype: candidate.targetKind,
      lineageSha256: targetLineageId(
        lineage,
        targetCount,
        candidate.targetIndex
      ),
      semanticLocationSha256: candidate.semanticLocationSha256,
      semanticFingerprintSha256: candidate.semanticFingerprintSha256,
    })
  )
  if (matches.length > 1)
    return fail(
      'edit.internal_invariant',
      'target handle matched more than once'
    )
  return matches[0]?.targetIndex ?? null
}

function exactTargetRef(evidence: TargetEntityEvidenceV1): TargetRefV1
{
  const canonicalNameBytes = canonicalJsonBytesV1(evidence.name)
  const nameIdentity = {
    canonicalJsonStringByteLength: canonicalNameBytes.byteLength,
    valueSha256: sha256Hex(canonicalNameBytes),
  }
  const name =
    canonicalNameBytes.byteLength <= 256
      ? {
          displayKind: 'inline' as const,
          value: evidence.name,
          ...nameIdentity,
        }
      : { displayKind: 'hashOnly' as const, ...nameIdentity }
  const location = {
    kind: 'target' as const,
    targetKind: evidence.targetKind,
    name: name as BoundedDisplayStringV1,
    serializedTargetOrdinal: evidence.targetIndex,
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId: `target-location-${evidence.semanticLocationSha256.slice(0, 32)}`,
    ...(evidence.visualLayerOrdinal === undefined
      ? {}
      : { visualLayerOrdinal: evidence.visualLayerOrdinal }),
  }
  return {
    entityKind: 'target',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location,
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

function existingTargetBinding(
  contract: EditSemanticChangeContractV1,
  bindingKey: string,
  sourceEvidence: TargetEntityEvidenceV1
): ContractEntityBindingV1 | null
{
  const binding = contract.entityBindings.find(
    (candidate) => candidate.bindingKey === bindingKey
  )
  if (
    !binding ||
    binding.bindingKind !== 'existing' ||
    binding.entityKind !== 'target' ||
    binding.entitySubtype !== sourceEvidence.targetKind ||
    binding.expectedMatchCount !== 1 ||
    binding.sourceLocationSha256 !== sourceEvidence.semanticLocationSha256 ||
    binding.expectedSourceSemanticFingerprint !==
      sourceEvidence.semanticFingerprintSha256 ||
    binding.expectedSourceContextFingerprint !==
      sourceEvidence.contextFingerprintSha256
  )
    return null
  return binding
}

function sourceEvidenceForCurrentTarget(
  context: ProductionOperationContextV1,
  selected: TargetEntityEvidenceV1
): TargetEntityEvidenceV1
{
  const records = activeOrderedSemanticLineages(
    context.preBatchLineage,
    'target',
    null
  )
  const record = records[selected.targetIndex]
  const match = /^target:(\d+)$/u.exec(record?.rawIdentity ?? '')
  if (!match)
    return fail(
      'edit.invalid_owner',
      'target does not have an existing source binding'
    )
  const sourceTargetIndex = Number(match[1])
  const sourceEvidence = targetEntityEvidenceSetV1(context.source.json)[
    sourceTargetIndex
  ]
  if (!sourceEvidence)
    return fail('edit.invalid_owner', 'source target binding is absent')
  return sourceEvidence
}

function candidateTargetIndexForLineage(
  context: ProductionOperationContextV1,
  lineageId: string
): number
{
  const targetIndex = activeOrderedSemanticLineages(
    context.activeLineage,
    'target',
    null
  ).findIndex((record) => record.lineageId === lineageId)
  if (targetIndex < 0)
    return fail(
      'edit.project_constraint',
      'a prior operation deleted the selected target'
    )
  return targetIndex
}

function scopeTargetBindingKey(scope: ContractScopeV1): string | null
{
  if (scope.locationScope.scopeKind === 'exactEntity')
  {
    const entity = scope.locationScope.entity
    return entity.entityKind === 'target' &&
      entity.contractRefKind === 'existing'
      ? entity.bindingKey
      : null
  }
  if (scope.locationScope.scopeKind === 'targetAndOwnedDescendants')
  {
    const target = scope.locationScope.target
    return target.contractRefKind === 'existing' ? target.bindingKey : null
  }
  return null
}

function requiredTargetProperties(
  operation: TargetOperationV1
): readonly string[]
{
  if (operation.kind === 'target.renameSprite') return ['name']
  if (operation.kind === 'target.reorderSprite') return ['layerOrder']
  if (operation.kind === 'target.removeSprite') return []
  return Object.freeze([
    ...new Set(operation.edits.map((edit) => edit.property)),
  ])
}

function selectTargetContractScope(
  context: ProductionOperationContextV1,
  operation: TargetOperationV1,
  selected: TargetEntityEvidenceV1
): ContractScopeV1
{
  if (!context.contract.allowedOperationKinds.includes(operation.kind))
    return fail(
      'edit.unauthorized_change',
      `change contract does not allow ${operation.kind}`
    )
  const sourceEvidence = sourceEvidenceForCurrentTarget(context, selected)
  const properties = requiredTargetProperties(operation)
  const matches = context.contract.allowedSemanticScopes.filter((scope) =>
  {
    if (
      scope.operationKind !== operation.kind ||
      scope.scopeSubjectKind !== 'entity' ||
      scope.entityKind !== 'target' ||
      scope.entitySubtype !== selected.targetKind ||
      properties.some(
        (property) =>
          !scope.allowedPropertyPaths.some(
            (path) => path.surface === 'target' && path.property === property
          )
      )
    )
      return false
    if (scope.locationScope.scopeKind === 'projectEntityCollection')
      return scope.locationScope.collection === 'targets'
    const bindingKey = scopeTargetBindingKey(scope)
    return (
      bindingKey !== null &&
      existingTargetBinding(context.contract, bindingKey, sourceEvidence) !==
        null
    )
  })
  if (matches.length !== 1)
    return fail(
      'edit.unauthorized_change',
      `change contract must have one exact scope for ${operation.kind}; found ${matches.length}`
    )
  return matches[0]!
}

function matchingTargetBindingKeys(
  context: ProductionOperationContextV1,
  selected: TargetEntityEvidenceV1
): readonly string[]
{
  const sourceEvidence = sourceEvidenceForCurrentTarget(context, selected)
  return Object.freeze(
    context.contract.entityBindings
      .filter(
        (binding) =>
          existingTargetBinding(
            context.contract,
            binding.bindingKey,
            sourceEvidence
          ) !== null
      )
      .map((binding) => binding.bindingKey)
      .sort()
  )
}

function semanticTargetPath(
  path: string,
  lineage: SemanticLineageSnapshot
): string | null
{
  const match = /^\/targets\/(0|[1-9][0-9]*)(\/.*)?$/u.exec(path)
  if (!match) return null
  const records = activeOrderedSemanticLineages(lineage, 'target', null)
  const record = records[Number(match[1])]
  if (!record) return null
  return `/targets/$members/${pointerPart(record.lineageId)}${match[2] ?? ''}`
}

function exactTargetPaths(
  paths: readonly string[],
  lineage: SemanticLineageSnapshot
): readonly string[]
{
  return Object.freeze(
    [
      ...paths,
      ...paths
        .map((path) => semanticTargetPath(path, lineage))
        .filter((path): path is string => path !== null),
    ]
      .filter((path, index, all) => all.indexOf(path) === index)
      .sort()
  )
}

function changedVisualLayerIndexes(
  project: ProjectIR,
  targetIndex: number,
  newLayer: number
): readonly number[]
{
  const target = project.json.targets[targetIndex]
  if (!target || target.isStage) return []
  const oldLayer = target.layerOrder!
  return Object.freeze(
    project.json.targets.flatMap((candidate, candidateIndex) =>
    {
      if (candidate.isStage) return []
      const layer = candidate.layerOrder!
      const shiftsDown =
        oldLayer < newLayer && layer > oldLayer && layer <= newLayer
      const shiftsUp =
        oldLayer > newLayer && layer >= newLayer && layer < oldLayer
      return candidateIndex === targetIndex || shiftsDown || shiftsUp
        ? [candidateIndex]
        : []
    })
  )
}

function targetStructuralAuthorization(
  project: ProjectIR,
  operation: TargetOperationV1,
  targetIndex: number,
  lineage: SemanticLineageSnapshot,
  index: SemanticReferenceIndex
): ProductionStructuralAuthorizationV1
{
  if (operation.kind === 'target.renameSprite')
  {
    const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
    return {
      exactPaths: exactTargetPaths(
        inbound.references.map((reference) => reference.path),
        lineage
      ),
      pathPrefixes: Object.freeze([]),
    }
  }
  if (operation.kind === 'target.reorderSprite')
  {
    const paths = changedVisualLayerIndexes(
      project,
      targetIndex,
      operation.newVisualLayerOrdinal
    ).map((index) => `/targets/${index}/layerOrder`)
    return {
      exactPaths: Object.freeze(
        [
          ...exactTargetPaths(paths, lineage),
          '/visualTargetOrder',
          '/runtimeExecutableTargetOrder',
        ].sort()
      ),
      pathPrefixes: Object.freeze([]),
    }
  }
  if (operation.kind === 'target.removeSprite')
  {
    const target = project.json.targets[targetIndex]
    if (!target || target.isStage)
      return fail('edit.invalid_owner', 'remove requires a sprite target')
    const targetLineages = activeOrderedSemanticLineages(
      lineage,
      'target',
      null
    )
    const shiftedPaths = project.json.targets.flatMap(
      (candidate, beforeIndex) =>
      {
        if (
          candidate.isStage ||
          beforeIndex === targetIndex ||
          candidate.layerOrder! <= target.layerOrder!
        )
          return []
        const afterIndex =
          beforeIndex > targetIndex ? beforeIndex - 1 : beforeIndex
        const shiftedLineage = targetLineages[beforeIndex]
        return [
          `/targets/${afterIndex}/layerOrder`,
          ...(shiftedLineage
            ? [
                `/targets/$members/${pointerPart(shiftedLineage.lineageId)}/layerOrder`,
              ]
            : []),
        ]
      }
    )
    const selectedLineage = targetLineageId(
      lineage,
      project.json.targets.length,
      targetIndex
    )
    return {
      exactPaths: Object.freeze(
        [
          ...new Set([
            ...shiftedPaths,
            '/targets',
            '/serializedTargetOrder',
            '/visualTargetOrder',
            '/runtimeExecutableTargetOrder',
          ]),
        ].sort()
      ),
      pathPrefixes: Object.freeze(
        [
          `/targets/${targetIndex}`,
          `/targets/$members/${pointerPart(selectedLineage)}`,
        ].sort()
      ),
    }
  }
  return {
    exactPaths: Object.freeze([]),
    pathPrefixes: Object.freeze([]),
  }
}

export class TargetProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'target.renameSprite',
    'target.reorderSprite',
    'target.removeSprite',
    'target.setSpriteProperties',
    'target.setStageProperties',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `target dispatcher does not support ${operation.kind}`
      )
    const suppliedReferenceIndex =
      preBatchReferenceIndexKey in context
        ? (context as IndexedProductionOperationContextV1)[
            preBatchReferenceIndexKey
          ]
        : undefined
    const targetOperation = operation as TargetOperationV1
    const selected = resolveTargetRefV1(
      context.preBatch,
      targetOperation.target,
      {
        activeMatchCandidateLimit:
          context.input.resourceLimits.activeMatchCandidates,
        resolveHandle: (reference, evidence) =>
          resolveHandleTarget(
            context.input,
            reference,
            evidence,
            context.preBatchLineage,
            context.preBatch.json.targets.length
          ),
        resolveCreated: () => null,
      }
    )
    const selectedScope = selectTargetContractScope(
      context,
      targetOperation,
      selected
    )
    const referenceIndex =
      suppliedReferenceIndex ?? buildSemanticReferenceIndex(context.preBatch)
    const planningFactProjection =
      productionTargetPlanningFactProjectionIndexedV1(
        context.preBatch,
        targetOperation,
        selected.targetIndex,
        context.preBatchLineage,
        referenceIndex
      )
    const planningFactSetSha256 = semanticHashV1(
      'resolved-plan',
      planningFactProjection
    )
    if (targetOperation.expectedPlanningFactSetSha256 !== planningFactSetSha256)
      return fail(
        'edit.planning_facts_mismatch',
        `planning facts changed for ${targetOperation.opId}`
      )
    const selectedLineageId = targetLineageId(
      context.preBatchLineage,
      context.preBatch.json.targets.length,
      selected.targetIndex
    )
    const matchedContractBindingKeys = matchingTargetBindingKeys(
      context,
      selected
    )
    const structuralAuthorization = targetStructuralAuthorization(
      context.preBatch,
      targetOperation,
      selected.targetIndex,
      context.preBatchLineage,
      referenceIndex
    )
    const canonicalOperation = {
      ...targetOperation,
      target: exactTargetRef(selected),
    } as SemanticEditOperationV1
    const targetOperationResult = applyTargetOperationV1(context.candidate, {
      operation: canonicalOperation as TargetOperationV1,
      targetIndex: candidateTargetIndexForLineage(context, selectedLineageId),
      activeLineage: context.activeLineage,
    })
    const result = Object.freeze({
      opId: targetOperation.opId,
      operationKind: targetOperation.kind,
      selectedLineageIds: Object.freeze([
        targetOperationResult.targetLineageId,
      ]),
      fixedSlots: Object.freeze([]),
      postconditionSha256:
        targetOperationResult.postcondition.postconditionSha256,
    })
    return {
      canonicalOperation,
      selectedScope,
      result,
      attribution: targetOperationResult.attribution,
      activeLineage: targetOperationResult.activeLineage,
      correspondence: targetOperationResult.targetCorrespondence,
      planningFactProjection,
      matchedContractBindingKeys,
      selectedEntityLineageIds: Object.freeze([selectedLineageId]),
      structuralAuthorization,
      authorizationEvidence: { targetOperationResult },
    }
  }
}

function targetCorrespondence(
  before: SemanticLineageSnapshot,
  after: SemanticLineageSnapshot
): OrderedCollectionCorrespondence
{
  const beforeIds = activeOrderedSemanticLineages(before, 'target', null).map(
    (record) => record.lineageId
  )
  const afterIds = activeOrderedSemanticLineages(after, 'target', null).map(
    (record) => record.lineageId
  )
  const beforeIndexes = new Map(
    beforeIds.map((lineageId, index) => [lineageId, index])
  )
  const afterIndexes = new Map(
    afterIds.map((lineageId, index) => [lineageId, index])
  )
  const allIds = [
    ...beforeIds,
    ...afterIds.filter((lineageId) => !beforeIndexes.has(lineageId)),
  ]
  return {
    collectionKind: 'targets',
    collectionPath: '/targets',
    beforeCollectionPath: '/targets',
    afterCollectionPath: '/targets',
    ownerLineageId: null,
    targetOwnerLineageId: null,
    containerLineageId: null,
    beforeLineageIds: Object.freeze(beforeIds),
    afterLineageIds: Object.freeze(afterIds),
    members: Object.freeze(
      allIds.map((lineageId) => ({
        lineageId,
        beforeIndex: beforeIndexes.get(lineageId) ?? null,
        afterIndex: afterIndexes.get(lineageId) ?? null,
      }))
    ),
  }
}

function ownedOrderedLineageIds(
  lineage: SemanticLineageSnapshot,
  kind: 'costume' | 'sound' | 'parameter',
  ownerLineageId: string
): readonly string[]
{
  return Object.freeze(
    lineage.records
      .filter(
        (record) =>
          record.status === 'active' &&
          record.kind === kind &&
          record.ownerLineageId === ownerLineageId
      )
      .sort(
        (left, right) =>
          (left.canonicalOrdinal ?? Number.MAX_SAFE_INTEGER) -
            (right.canonicalOrdinal ?? Number.MAX_SAFE_INTEGER) ||
          left.lineageId.localeCompare(right.lineageId)
      )
      .map((record) => record.lineageId)
  )
}

function mediaCorrespondences(
  before: ProjectIR,
  after: ProjectIR,
  targets: OrderedCollectionCorrespondence,
  beforeLineage: SemanticLineageSnapshot,
  afterLineage: SemanticLineageSnapshot
): readonly OrderedCollectionCorrespondence[]
{
  const output: OrderedCollectionCorrespondence[] = []
  for (const member of targets.members)
  {
    const beforeTarget =
      member.beforeIndex === null
        ? undefined
        : before.json.targets[member.beforeIndex]
    const afterTarget =
      member.afterIndex === null
        ? undefined
        : after.json.targets[member.afterIndex]
    for (const [field, kind] of [
      ['costumes', 'costume'],
      ['sounds', 'sound'],
    ] as const)
    {
      const beforeMembers = beforeTarget?.[field] ?? []
      const afterMembers = afterTarget?.[field] ?? []
      if (
        editCanonicalSha256V1(beforeMembers) ===
        editCanonicalSha256V1(afterMembers)
      )
        continue
      const beforeLineageIds = ownedOrderedLineageIds(
        beforeLineage,
        kind,
        member.lineageId
      )
      const afterLineageIds = ownedOrderedLineageIds(
        afterLineage,
        kind,
        member.lineageId
      )
      const beforeIndexes = new Map(
        beforeLineageIds.map((lineageId, index) => [lineageId, index])
      )
      const afterIndexes = new Map(
        afterLineageIds.map((lineageId, index) => [lineageId, index])
      )
      const allIds = [
        ...beforeLineageIds,
        ...afterLineageIds.filter((lineageId) => !beforeIndexes.has(lineageId)),
      ]
      const beforePath =
        member.beforeIndex === null
          ? null
          : `/targets/${member.beforeIndex}/${field}`
      const afterPath =
        member.afterIndex === null
          ? null
          : `/targets/${member.afterIndex}/${field}`
      output.push({
        collectionKind: field,
        collectionPath: afterPath ?? beforePath!,
        beforeCollectionPath: beforePath,
        afterCollectionPath: afterPath,
        ownerLineageId: member.lineageId,
        targetOwnerLineageId: member.lineageId,
        containerLineageId: member.lineageId,
        beforeLineageIds,
        afterLineageIds,
        members: Object.freeze(
          allIds.map((lineageId) => ({
            lineageId,
            beforeIndex: beforeIndexes.get(lineageId) ?? null,
            afterIndex: afterIndexes.get(lineageId) ?? null,
          }))
        ),
      })
    }
  }
  return Object.freeze(output)
}

function procedureCollectionPath(targetIndex: number, blockId: string): string
{
  return `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/mutation/argumentids`
}

function blockLineageId(
  lineage: SemanticLineageSnapshot,
  targetLineageId: string,
  blockId: string
): string | null
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === 'block' &&
      record.ownerLineageId === targetLineageId &&
      record.rawIdentity === `block:${blockId}`
  )
  return matches.length === 1 ? matches[0]!.lineageId : null
}

function procedureLineageIdForProccode(
  lineage: SemanticLineageSnapshot,
  targetLineageId: string,
  proccode: string
): string | null
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === 'procedure' &&
      record.ownerLineageId === targetLineageId &&
      record.rawIdentity === `procedure:${proccode}`
  )
  return matches.length === 1 ? matches[0]!.lineageId : null
}

function orderedMembers(
  beforeLineageIds: readonly string[],
  afterLineageIds: readonly string[]
): readonly OrderedCollectionMemberCorrespondence[]
{
  const beforeIndexes = new Map(
    beforeLineageIds.map((lineageId, index) => [lineageId, index])
  )
  const afterIndexes = new Map(
    afterLineageIds.map((lineageId, index) => [lineageId, index])
  )
  return Object.freeze(
    [
      ...beforeLineageIds,
      ...afterLineageIds.filter((lineageId) => !beforeIndexes.has(lineageId)),
    ].map((lineageId) => ({
      lineageId,
      beforeIndex: beforeIndexes.get(lineageId) ?? null,
      afterIndex: afterIndexes.get(lineageId) ?? null,
    }))
  )
}

// a prototype or call block whose mutation surface moved needs its ordered
// parameter membership stated as lineage movement on both heads
function procedureCorrespondences(
  before: ProjectIR,
  after: ProjectIR,
  targets: OrderedCollectionCorrespondence,
  beforeLineage: SemanticLineageSnapshot,
  afterLineage: SemanticLineageSnapshot
): {
  readonly parameters: readonly OrderedCollectionCorrespondence[]
  readonly callArguments: readonly OrderedCollectionCorrespondence[]
}
{
  const parameters: OrderedCollectionCorrespondence[] = []
  const callArguments: OrderedCollectionCorrespondence[] = []
  for (const member of targets.members)
  {
    const beforeTarget =
      member.beforeIndex === null
        ? undefined
        : before.json.targets[member.beforeIndex]
    const afterTarget =
      member.afterIndex === null
        ? undefined
        : after.json.targets[member.afterIndex]
    const blockIds = uniqueSorted([
      ...ownRecordKeys(beforeTarget?.blocks),
      ...ownRecordKeys(afterTarget?.blocks),
    ])
    for (const blockId of blockIds)
    {
      const beforeBlock = ownRecordValue(beforeTarget?.blocks, blockId)
      const afterBlock = ownRecordValue(afterTarget?.blocks, blockId)
      const beforeEntry = isBlockEntry(beforeBlock) ? beforeBlock : undefined
      const afterEntry = isBlockEntry(afterBlock) ? afterBlock : undefined
      const opcode = afterEntry?.opcode ?? beforeEntry?.opcode
      const prototype = opcode === 'procedures_prototype'
      if (!prototype && opcode !== 'procedures_call') continue
      const beforeSurface = prototype
        ? beforeEntry?.mutation
        : beforeEntry && {
            mutation: beforeEntry.mutation,
            inputs: beforeEntry.inputs,
          }
      const afterSurface = prototype
        ? afterEntry?.mutation
        : afterEntry && {
            mutation: afterEntry.mutation,
            inputs: afterEntry.inputs,
          }
      if (
        editCanonicalSha256V1(beforeSurface ?? null) ===
        editCanonicalSha256V1(afterSurface ?? null)
      )
        continue
      const afterProccode = afterEntry?.mutation?.proccode
      const beforeProccode = beforeEntry?.mutation?.proccode
      const ownerLineageId =
        (afterProccode === undefined
          ? null
          : procedureLineageIdForProccode(
              afterLineage,
              member.lineageId,
              afterProccode
            )) ??
        (beforeProccode === undefined
          ? null
          : procedureLineageIdForProccode(
              beforeLineage,
              member.lineageId,
              beforeProccode
            ))
      if (ownerLineageId === null) continue
      const containerLineageId =
        blockLineageId(afterLineage, member.lineageId, blockId) ??
        blockLineageId(beforeLineage, member.lineageId, blockId)
      if (containerLineageId === null) continue
      const beforeLineageIds =
        beforeEntry === undefined
          ? Object.freeze([])
          : ownedOrderedLineageIds(beforeLineage, 'parameter', ownerLineageId)
      const afterLineageIds =
        afterEntry === undefined
          ? Object.freeze([])
          : ownedOrderedLineageIds(afterLineage, 'parameter', ownerLineageId)
      const beforePath =
        member.beforeIndex === null || beforeEntry === undefined
          ? null
          : procedureCollectionPath(member.beforeIndex, blockId)
      const afterPath =
        member.afterIndex === null || afterEntry === undefined
          ? null
          : procedureCollectionPath(member.afterIndex, blockId)
      if (beforePath === null && afterPath === null) continue
      const collection: OrderedCollectionCorrespondence = {
        collectionKind: prototype
          ? 'procedure-parameters'
          : 'procedure-call-arguments',
        collectionPath: afterPath ?? beforePath!,
        beforeCollectionPath: beforePath,
        afterCollectionPath: afterPath,
        ownerLineageId,
        targetOwnerLineageId: member.lineageId,
        containerLineageId,
        beforeLineageIds,
        afterLineageIds,
        members: orderedMembers(beforeLineageIds, afterLineageIds),
      }
      if (prototype) parameters.push(collection)
      else callArguments.push(collection)
    }
  }
  return {
    parameters: Object.freeze(parameters),
    callArguments: Object.freeze(callArguments),
  }
}

export function productionProjectCorrespondenceV1(
  beforeRevisionIdentity: string,
  afterRevisionIdentity: string,
  semanticSourceSha256: string,
  before: ProjectIR,
  after: ProjectIR,
  beforeLineage: SemanticLineageSnapshot,
  afterLineage: SemanticLineageSnapshot
): ProjectOrderedCorrespondence
{
  const targets = targetCorrespondence(beforeLineage, afterLineage)
  const media = mediaCorrespondences(
    before,
    after,
    targets,
    beforeLineage,
    afterLineage
  )
  const procedures = procedureCorrespondences(
    before,
    after,
    targets,
    beforeLineage,
    afterLineage
  )
  return {
    beforeRevisionIdentity,
    afterRevisionIdentity,
    beforeSemanticSourceSha256: semanticSourceSha256,
    afterSemanticSourceSha256: semanticSourceSha256,
    targets,
    ...(media.length > 0 ? { media } : {}),
    ...(procedures.parameters.length > 0
      ? { procedureParameters: procedures.parameters }
      : {}),
    ...(procedures.callArguments.length > 0
      ? { procedureCallArguments: procedures.callArguments }
      : {}),
  }
}

export function productionComputeCorrespondedDeltaV1(
  before: ProjectIR,
  after: ProjectIR,
  attribution: readonly DeltaOperationAttribution[],
  correspondence: ProjectOrderedCorrespondence,
  beforeLineage: SemanticLineageSnapshot,
  afterLineage: SemanticLineageSnapshot
): ProjectDelta
{
  return computeProjectDelta(before, after, attribution, {
    correspondence,
    correspondenceEvidence: {
      before: captureProjectOrderedHeadEvidence(
        before,
        correspondence,
        'before',
        {
          revisionIdentity: correspondence.beforeRevisionIdentity,
          semanticSourceSha256: correspondence.beforeSemanticSourceSha256,
          lineageSnapshot: beforeLineage,
        }
      ),
      after: captureProjectOrderedHeadEvidence(after, correspondence, 'after', {
        revisionIdentity: correspondence.afterRevisionIdentity,
        semanticSourceSha256: correspondence.afterSemanticSourceSha256,
        lineageSnapshot: afterLineage,
      }),
    },
  })
}

function allDeltaChanges(delta: ProjectDelta)
{
  return [
    ...delta.targets.flatMap((target) => [
      ...target.blockChanges.flatMap((block) => block.changes),
      ...target.declarationChanges,
      ...target.gameplayPropertyChanges,
      ...target.assetMetadataChanges,
      ...target.existingEditorLayoutChanges,
      ...target.structureChanges,
      ...target.unknownChanges,
    ]),
    ...delta.projectChanges.map((entry) => entry.change),
    ...(delta.derivedProjectChanges ?? []),
    ...(delta.correspondedEntityChanges?.flatMap((entry) => entry.changes) ??
      []),
  ]
}

function assertEveryOperationHasAttributedEffect(
  delta: ProjectDelta,
  applied: readonly AppliedProductionOperationV1[]
): void
{
  const attributed = new Set([
    ...allDeltaChanges(delta).flatMap((change) => change.operationIds),
    ...delta.assets.flatMap((asset) => asset.operationIds),
    ...(delta.orderedCollectionChanges ?? []).flatMap(
      (change) => change.operationIds
    ),
  ])
  const missing = applied.filter(
    (operation) => !attributed.has(operation.occurrenceId)
  )
  if (missing.length > 0)
    fail(
      'edit.unauthorized_change',
      `accepted operation has no attributed effect: ${missing
        .map((operation) => operation.operation.opId)
        .join(', ')}`
    )
}

function optionalDeltaState(
  change: ValueDelta,
  side: 'before' | 'after'
): unknown
{
  return Object.prototype.hasOwnProperty.call(change, side)
    ? { state: 'value', value: change[side] }
    : { state: 'missing' }
}

export function productionCanonicalValueSha256V1(value: unknown): string
{
  return editCanonicalSha256V1({
    kind: 'production-contract-canonical-value',
    schemaVersion: 1,
    value,
  })
}

export function productionEntityDeltaContentSha256V1(state: unknown): string
{
  return semanticHashV1('evidence-content', {
    kind: 'production-entity-delta-content',
    schemaVersion: 1,
    state,
  })
}

export function productionContractScopeSha256V1(
  scope: ContractScopeV1
): string
{
  return editCanonicalSha256V1({
    kind: 'production-contract-scope',
    schemaVersion: 1,
    scope,
  })
}

function canonicallySortedValuesV1<T>(values: readonly T[]): T[]
{
  return values
    .map((value, sourceIndex) => ({
      value,
      sourceIndex,
      canonicalSha256: editCanonicalSha256V1(value),
    }))
    .sort((left, right) =>
    {
      if (left.canonicalSha256 !== right.canonicalSha256)
        return left.canonicalSha256 < right.canonicalSha256 ? -1 : 1
      return left.sourceIndex - right.sourceIndex
    })
    .map((entry) => entry.value)
}

function productionDeltaObservationsV1(
  delta: ProjectDelta
): readonly ProductionDeltaObservationV1[]
{
  const leaves = allDeltaChanges(delta).map((change) => ({
    observationKind: 'leaf' as const,
    path: change.path,
    kind: change.kind,
    operationIds: Object.freeze([...change.operationIds].sort()),
    entityLineageIds: Object.freeze(
      [...(change.entityLineageIds ?? [])].sort()
    ),
    beforeState: optionalDeltaState(change, 'before'),
    afterState: optionalDeltaState(change, 'after'),
  }))
  const assets = delta.assets.map((asset) => ({
    observationKind: 'asset' as const,
    path: `/assets/${pointerPart(asset.path)}/${asset.occurrence}`,
    kind: asset.kind,
    operationIds: Object.freeze([...asset.operationIds].sort()),
    entityLineageIds: Object.freeze([]),
    beforeState:
      asset.before === undefined
        ? { state: 'missing' }
        : { state: 'value', value: asset.before },
    afterState:
      asset.after === undefined
        ? { state: 'missing' }
        : { state: 'value', value: asset.after },
  }))
  const ordered = (delta.orderedCollectionChanges ?? []).map((change) => ({
    observationKind: 'ordered' as const,
    path: change.collectionPath,
    kind: change.kind,
    operationIds: Object.freeze([...change.operationIds].sort()),
    entityLineageIds: Object.freeze([change.lineageId]),
    beforeState:
      change.beforeIndex === undefined
        ? { state: 'missing' }
        : { state: 'value', value: change.beforeIndex },
    afterState:
      change.afterIndex === undefined
        ? { state: 'missing' }
        : { state: 'value', value: change.afterIndex },
  }))
  const protectedObservations = delta.protectedChanges.map((change) => ({
    observationKind: 'protected' as const,
    path: change.path,
    kind: 'protected',
    operationIds: Object.freeze([...change.operationIds].sort()),
    entityLineageIds: Object.freeze(
      [...(change.entityLineageIds ?? [])].sort()
    ),
    protectedClass: change.class,
    mandatory: change.mandatory,
  }))
  return Object.freeze(
    canonicallySortedValuesV1([
      ...leaves,
      ...assets,
      ...ordered,
      ...protectedObservations,
    ])
  )
}

// ordered additions expose contract-independent coordinates; a parameter may
// share one lineage across its signature & call-site projections
function operationFingerprintLineageAliasesV1(
  delta: ProjectDelta
): ReadonlyMap<string, string>
{
  const descriptors: {
    readonly lineageId: string
    readonly path: string
    readonly at: number
    readonly collectionKind: string
    readonly ownerLineageId: string | null
  }[] = []
  for (const change of delta.orderedCollectionChanges ?? [])
  {
    if (change.kind !== 'added' || change.afterIndex === undefined) continue
    descriptors.push({
      lineageId: change.lineageId,
      path: change.collectionPath,
      at: change.afterIndex,
      collectionKind: change.collectionKind,
      ownerLineageId: change.ownerLineageId,
    })
  }
  const descriptorGroups = new Map<string, typeof descriptors>()
  for (const descriptor of descriptors)
  {
    const group = descriptorGroups.get(descriptor.lineageId) ?? []
    group.push(descriptor)
    descriptorGroups.set(descriptor.lineageId, group)
  }
  const aliases = new Map<string, string>()
  const coordinates = new Set<string>()
  const groups = [...descriptorGroups.entries()].sort((left, right) =>
  {
    const leftPath = [...left[1]].sort((a, b) =>
      a.path.localeCompare(b.path)
    )[0]!.path
    const rightPath = [...right[1]].sort((a, b) =>
      a.path.localeCompare(b.path)
    )[0]!.path
    const depth = leftPath.split('/').length - rightPath.split('/').length
    if (depth !== 0) return depth
    const path = leftPath.localeCompare(rightPath)
    if (path !== 0) return path
    return left[0].localeCompare(right[0])
  })
  for (const [lineageId, group] of groups)
  {
    const normalized = group
      .map((descriptor) => ({
        ...descriptor,
        collectionPath: operationFingerprintPathV1(descriptor.path, aliases),
      }))
      .sort((left, right) =>
      {
        const path = left.collectionPath.localeCompare(right.collectionPath)
        if (path !== 0) return path
        return left.at - right.at
      })
    for (const descriptor of normalized)
    {
      const coordinate = editCanonicalSha256V1({
        kind: 'production-contract-created-lineage-coordinate',
        schemaVersion: 1,
        collectionPath: descriptor.collectionPath,
        insertionOrdinal: descriptor.at,
      })
      if (coordinates.has(coordinate))
        return fail(
          'edit.internal_invariant',
          'operation fingerprint has duplicate created-lineage coordinates'
        )
      coordinates.add(coordinate)
    }
    if (normalized.length > 1)
    {
      const parameterCount = normalized.filter(
        (descriptor) => descriptor.collectionKind === 'procedure-parameters'
      ).length
      const callCount = normalized.filter(
        (descriptor) => descriptor.collectionKind === 'procedure-call-arguments'
      ).length
      const ownerLineageIds = new Set(
        normalized.map((descriptor) => descriptor.ownerLineageId)
      )
      const insertionOrdinals = new Set(
        normalized.map((descriptor) => descriptor.at)
      )
      if (
        parameterCount !== 1 ||
        callCount !== normalized.length - 1 ||
        ownerLineageIds.size !== 1 ||
        ownerLineageIds.has(null) ||
        insertionOrdinals.size !== 1
      )
        return fail(
          'edit.internal_invariant',
          'operation fingerprint has duplicate created-lineage coordinates'
        )
    }
    if (aliases.has(lineageId))
      return fail(
        'edit.internal_invariant',
        'operation fingerprint has duplicate created-lineage coordinates'
      )
    aliases.set(
      lineageId,
      normalized.length === 1
        ? semanticHashV1('resolved-plan', {
            kind: 'production-contract-created-lineage-alias',
            schemaVersion: 1,
            collectionPath: normalized[0]!.collectionPath,
            insertionOrdinal: normalized[0]!.at,
          })
        : semanticHashV1('resolved-plan', {
            kind: 'production-contract-shared-parameter-lineage-alias',
            schemaVersion: 1,
            coordinates: normalized.map((descriptor) => ({
              collectionKind: descriptor.collectionKind,
              collectionPath: descriptor.collectionPath,
              insertionOrdinal: descriptor.at,
            })),
          })
    )
  }
  return aliases
}

function operationFingerprintPathV1(
  path: string,
  aliases: ReadonlyMap<string, string>
): string
{
  const parts = path.split('/')
  for (let index = 1; index < parts.length; index += 1)
    if (parts[index - 1] === '$members')
      parts[index] = aliases.get(parts[index]!) ?? parts[index]!
  return parts.join('/')
}

function operationFingerprintOrderStateV1(
  path: string,
  state: unknown,
  aliases: ReadonlyMap<string, string>
): unknown
{
  if (
    ![
      '/serializedTargetOrder',
      '/visualTargetOrder',
      '/runtimeExecutableTargetOrder',
    ].includes(path) ||
    state === null ||
    typeof state !== 'object'
  )
    return state
  const record = state as Record<string, unknown>
  if (record['state'] !== 'value' || !Array.isArray(record['value']))
    return state
  const order = record['value']
  if (
    !order.every(
      (entry) => typeof entry === 'string' && /^[0-9a-f]{64}$/u.test(entry)
    )
  )
    return state
  return {
    ...record,
    value: order.map((entry) => aliases.get(entry as string) ?? entry),
  }
}

type ProductionFingerprintObservationV1 = Omit<
  ProductionDeltaObservationV1,
  'operationIds'
>

interface ProductionDeltaFingerprintContextV1
{
  readonly direction: 'parent-child' | 'source-head'
  readonly delta: ProjectDelta
  observations: readonly ProductionDeltaObservationV1[] | null
  deltaProjectionObservations:
    readonly ProductionFingerprintObservationV1[] | null
  deltaFingerprintSha256: string | null
  lineageAliases: ReadonlyMap<string, string> | null
  readonly operationProjections: Map<string, unknown>
  readonly operationFingerprints: Map<string, string>
}

function createProductionDeltaFingerprintContextV1(
  direction: 'parent-child' | 'source-head',
  delta: ProjectDelta
): ProductionDeltaFingerprintContextV1
{
  return {
    direction,
    delta,
    observations: null,
    deltaProjectionObservations: null,
    deltaFingerprintSha256: null,
    lineageAliases: null,
    operationProjections: new Map(),
    operationFingerprints: new Map(),
  }
}

function productionDeltaObservationsFromContextV1(
  context: ProductionDeltaFingerprintContextV1
): readonly ProductionDeltaObservationV1[]
{
  context.observations ??= productionDeltaObservationsV1(context.delta)
  return context.observations
}

function productionDeltaFingerprintFromContextV1(
  context: ProductionDeltaFingerprintContextV1
): string
{
  if (context.deltaFingerprintSha256 !== null)
    return context.deltaFingerprintSha256
  context.deltaProjectionObservations = canonicallySortedValuesV1(
    productionDeltaObservationsFromContextV1(context).map(
      ({ operationIds: _operationIds, ...observation }) => observation
    )
  )
  context.deltaFingerprintSha256 = editCanonicalSha256V1({
    kind: 'production-contract-delta',
    schemaVersion: 1,
    direction: context.direction,
    observations: context.deltaProjectionObservations,
  })
  return context.deltaFingerprintSha256
}

function productionOperationChangeFingerprintProjectionFromContextV1(
  context: ProductionDeltaFingerprintContextV1,
  operationId: string
): unknown
{
  if (context.operationProjections.has(operationId))
    return context.operationProjections.get(operationId)!
  const allObservations = productionDeltaObservationsFromContextV1(context)
  const lineageAliases = (context.lineageAliases ??=
    operationFingerprintLineageAliasesV1(context.delta))
  const observations = canonicallySortedValuesV1(
    allObservations
      .filter((observation) => observation.operationIds.includes(operationId))
      .map(({ operationIds: _operationIds, ...observation }) => ({
        ...observation,
        path: operationFingerprintPathV1(observation.path, lineageAliases),
        entityLineageIds: observation.entityLineageIds
          .map((lineageId) => lineageAliases.get(lineageId) ?? lineageId)
          .sort(),
        ...(observation.beforeState === undefined
          ? {}
          : {
              beforeState: operationFingerprintOrderStateV1(
                observation.path,
                observation.beforeState,
                lineageAliases
              ),
            }),
        ...(observation.afterState === undefined
          ? {}
          : {
              afterState: operationFingerprintOrderStateV1(
                observation.path,
                observation.afterState,
                lineageAliases
              ),
            }),
      }))
  )
  const projection = Object.freeze({
    kind: 'production-contract-operation-change',
    schemaVersion: 1,
    direction: context.direction,
    observations,
  })
  context.operationProjections.set(operationId, projection)
  return projection
}

export function productionOperationChangeFingerprintV1(
  direction: 'parent-child' | 'source-head',
  delta: ProjectDelta,
  operationId: string
): string
{
  return productionOperationChangeFingerprintFromContextV1(
    createProductionDeltaFingerprintContextV1(direction, delta),
    operationId
  )
}

function productionOperationChangeFingerprintFromContextV1(
  context: ProductionDeltaFingerprintContextV1,
  operationId: string
): string
{
  const retained = context.operationFingerprints.get(operationId)
  if (retained !== undefined) return retained
  const fingerprint = editCanonicalSha256V1(
    productionOperationChangeFingerprintProjectionFromContextV1(
      context,
      operationId
    )
  )
  context.operationFingerprints.set(operationId, fingerprint)
  return fingerprint
}

export function productionTargetVisualPositionSha256V1(
  order: TargetDualOrderSnapshotV1,
  targetLineageId: string
): string
{
  const zeroBasedIndex = order.visualSpriteLineageIds.indexOf(targetLineageId)
  if (zeroBasedIndex < 0)
    return fail(
      'edit.internal_invariant',
      'target lineage is absent from visual layer order'
    )
  return editCanonicalSha256V1({
    kind: 'production-target-visual-position',
    schemaVersion: 1,
    targetLineageId,
    visualLayerOrdinal: zeroBasedIndex + 1,
    visualLayerOrderSha256: order.visualLayerOrderSha256,
  })
}

function targetResult(
  applied: AppliedProductionOperationV1
): TargetOperationResultV1 | null
{
  if (!applied.operation.kind.startsWith('target.')) return null
  const result = applied.authorizationEvidence?.targetOperationResult
  if (!result) return null
  return typeof result.targetLineageId === 'string' &&
    typeof result.beforeTargetIndex === 'number' &&
    result.beforeOrder !== undefined &&
    result.afterOrder !== undefined &&
    result.postcondition !== undefined
    ? result
    : null
}

function targetPropertyObservation(observation: ProductionDeltaObservationV1): {
  property: string
  targetIndex: number | null
  lineageId: string | null
} | null
{
  const raw = /^\/targets\/(0|[1-9][0-9]*)\/([^/]+)$/u.exec(observation.path)
  if (raw)
    return {
      property: raw[2]!,
      targetIndex: Number(raw[1]),
      lineageId: observation.entityLineageIds[0] ?? null,
    }
  const semantic = /^\/targets\/\$members\/([^/]+)\/([^/]+)$/u.exec(
    observation.path
  )
  if (!semantic) return null
  return {
    property: semantic[2]!,
    targetIndex: null,
    lineageId: semantic[1]!.replaceAll('~1', '/').replaceAll('~0', '~'),
  }
}

function observationSelectsAppliedTarget(
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1
): boolean
{
  const property = targetPropertyObservation(observation)
  const result = targetResult(applied)
  if (!property || !result) return false
  if (
    property.lineageId === result.targetLineageId ||
    observation.entityLineageIds.includes(result.targetLineageId)
  )
    return true
  return (
    property.targetIndex === result.beforeTargetIndex ||
    property.targetIndex === result.afterTargetIndex
  )
}

function targetSemanticPropertyObservation(
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1
): {
  surface: 'declaration' | 'comment' | 'script' | 'blockField' | 'blockInput'
  properties: readonly string[]
} | null
{
  const collapsedAddedEntity =
    observation.kind === 'added' &&
    [
      ...applied.structuralAuthorization.exactPaths,
      ...applied.structuralAuthorization.pathPrefixes,
    ].some((path) => path.startsWith(`${observation.path}/`))
  if (
    !observationHasStructuralPath(observation, applied) &&
    !collapsedAddedEntity
  )
    return null
  const path = observation.path
  if (applied.operation.kind === 'declaration.rename')
  {
    const isTupleName = /^\/targets\/\d+\/(?:variables|lists)\/[^/]+\/0$/u.test(
      path
    )
    const isBroadcastName = /^\/targets\/\d+\/broadcasts\/[^/]+$/u.test(path)
    return collapsedAddedEntity || isTupleName || isBroadcastName
      ? { surface: 'declaration', properties: ['name'] }
      : null
  }
  if (applied.operation.kind === 'declaration.setVariableInitialValue')
    return collapsedAddedEntity ||
      /^\/targets\/\d+\/variables\/[^/]+\/1$/u.test(path)
      ? { surface: 'declaration', properties: ['initialValue'] }
      : null
  if (applied.operation.kind === 'declaration.setListInitialItems')
    return collapsedAddedEntity ||
      /^\/targets\/\d+\/lists\/[^/]+\/1(?:\/.*)?$/u.test(path)
      ? { surface: 'declaration', properties: ['initialItems'] }
      : null
  if (applied.operation.kind === 'comment.updateText')
    return collapsedAddedEntity || /\/comments\/[^/]+\/text$/u.test(path)
      ? { surface: 'comment', properties: ['text'] }
      : null
  if (applied.operation.kind === 'comment.move')
  {
    if (collapsedAddedEntity)
    {
      return {
        surface: 'comment',
        properties: Object.freeze(
          [
            ...new Set(applied.operation.edits.map((edit) => edit.property)),
          ].sort()
        ),
      }
    }
    const match = /\/comments\/[^/]+\/(x|y|width|height|minimized)$/u.exec(path)
    return match ? { surface: 'comment', properties: [match[1]!] } : null
  }
  if (
    applied.operation.kind === 'comment.add' ||
    applied.operation.kind === 'comment.remove'
  )
    return /\/blocks\/[^/]+\/comment$/u.test(path)
      ? { surface: 'comment', properties: ['attachment'] }
      : null
  if (
    applied.operation.kind === 'comment.attach' ||
    applied.operation.kind === 'comment.detach'
  )
    return collapsedAddedEntity ||
      /\/comments\/[^/]+\/blockId$/u.test(path) ||
      /\/blocks\/[^/]+\/comment$/u.test(path)
      ? { surface: 'comment', properties: ['attachment'] }
      : null
  if (applied.operation.kind === 'script.moveWorkspace')
  {
    const match = /\/blocks\/[^/]+\/(x|y)$/u.exec(path)
    return match
      ? {
          surface: 'script',
          properties: [match[1] === 'x' ? 'workspaceX' : 'workspaceY'],
        }
      : null
  }
  if (applied.operation.kind === 'block.setField')
  {
    const match = /\/blocks\/[^/]+\/fields\/([^/]+)(?:\/.*)?$/u.exec(path)
    return match &&
      decodedPointerPart(match[1]!) === applied.operation.fieldName
      ? { surface: 'blockField', properties: [applied.operation.fieldName] }
      : null
  }
  if (applied.operation.kind === 'block.setInput')
  {
    const match = /\/blocks\/[^/]+\/inputs\/([^/]+)(?:\/.*)?$/u.exec(path)
    return match &&
      decodedPointerPart(match[1]!) === applied.operation.inputName
      ? { surface: 'blockInput', properties: [applied.operation.inputName] }
      : null
  }
  return null
}

// the media operations that restructure the ordered collection itself rather
// than writing a named property of one record
const MEDIA_MEMBERSHIP_KINDS: ReadonlySet<string> = Object.freeze(
  new Set([
    'media.addCostume',
    'media.addSound',
    'media.reorderCostume',
    'media.reorderSound',
    'media.removeCostume',
    'media.removeSound',
  ])
)

// the costume operations whose membership or selection change moves the raw
// currentCostume index as a consequence rather than as a caller-named property
const MEDIA_SELECTION_RECONCILING_KINDS: ReadonlySet<string> = Object.freeze(
  new Set([
    'media.addCostume',
    'media.reorderCostume',
    'media.removeCostume',
    'media.setCurrentCostume',
  ])
)

function scopeCoversObservation(
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  matchingLeafObservations: MatchingLeafObservationIndexV1,
  activeLineage: SemanticLineageSnapshot
): boolean
{
  const selectedScope = applied.selectedScope
  if (
    !observation.operationIds.includes(applied.occurrenceId) ||
    selectedScope.scopeSubjectKind !== 'entity'
  )
    return false
  const evidence = matchingLeafObservation(
    observation,
    applied.occurrenceId,
    matchingLeafObservations
  )
  if (applied.operation.kind.startsWith('target.'))
  {
    // a creation names no existing target, so it cannot select one; the sprites
    // whose layer it renumbered are instead the exact paths it declared
    const shiftedBySpriteCreation =
      applied.operation.kind === 'target.addSprite' &&
      observationHasStructuralPath(evidence, applied)
    if (
      !shiftedBySpriteCreation &&
      !observationSelectsAppliedTarget(evidence, applied)
    )
      return false
    const property = targetPropertyObservation(evidence)?.property
    return (
      property !== undefined &&
      selectedScope.allowedPropertyPaths.some(
        (path) =>
          path.surface === 'target' &&
          'property' in path &&
          path.property === property
      )
    )
  }
  const property = targetSemanticPropertyObservation(evidence, applied)
  // a procedure operation rewrites raw prototype, reporter, & call structure the
  // property surfaces do not name, so it is authorized structurally like a graph
  // edit; its scope still had to declare the procedure signature property path

  // a media membership change rewrites whole ordered slots that no property
  // surface names, so it is authorized structurally too. rename & replace stay
  // on property matching, which is what constrains them to their declared paths
  const structuralFamily =
    applied.operation.kind.startsWith('procedure.') ||
    MEDIA_MEMBERSHIP_KINDS.has(applied.operation.kind) ||
    (applied.operation.kind !== 'script.moveWorkspace' &&
      (applied.operation.kind.startsWith('script.') ||
        applied.operation.kind.startsWith('block.')))
  if (
    property === null &&
    structuralFamily &&
    observationHasStructuralPath(evidence, applied)
  )
  {
    const location = selectedScope.locationScope
    const scopeBindingKey =
      location.scopeKind === 'exactEntity'
        ? location.entity.bindingKey
        : location.scopeKind === 'targetAndOwnedDescendants'
          ? location.target.bindingKey
          : location.scopeKind === 'scriptClosure'
            ? location.script.bindingKey
            : location.scopeKind === 'procedureOwnedClosure'
              ? location.procedure.bindingKey
              : null
    if (
      scopeBindingKey === null ||
      !applied.matchedContractBindingKeys.includes(scopeBindingKey)
    )
      return false
    if (
      (evidence.kind === 'added' || evidence.kind === 'changed') &&
      applied.futureBindingRealizationCandidates?.some(
        (candidate) =>
          (candidate.createdEntityKind === 'script' ||
            candidate.createdEntityKind === 'block') &&
          scriptBlockResultBindingOwnsObservation(
            candidate.bindingKey,
            candidate.createdEntityKind,
            evidence,
            applied,
            activeLineage
          )
      )
    )
      return false
    if (
      evidence.kind === 'removed' &&
      applied.authorizationEvidence?.groupDGraph?.publicRemovalPaths.includes(
        evidence.path
      )
    )
      return false
    return true
  }
  // inserting, moving, or removing a costume shifts the raw selection index no
  // caller named, so exactly the reconciling operations own that one target
  // property; rename & replace stay on property matching & gain nothing here
  if (
    property === null &&
    MEDIA_SELECTION_RECONCILING_KINDS.has(applied.operation.kind) &&
    /^\/targets\/\d+\/currentCostume$/u.test(evidence.path) &&
    observationHasStructuralPath(evidence, applied)
  )
    return true
  return (
    property !== null &&
    property.properties.length > 0 &&
    property.properties.every((propertyName) =>
      selectedScope.allowedPropertyPaths.some((path) =>
        property.surface === 'blockField' || property.surface === 'blockInput'
          ? path.surface === property.surface &&
            'descriptorName' in path &&
            path.descriptorName === propertyName
          : path.surface === property.surface &&
            'property' in path &&
            path.property === propertyName
      )
    )
  )
}

function observationHasStructuralPath(
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1
): boolean
{
  return (
    applied.structuralAuthorization.exactPaths.includes(observation.path) ||
    applied.structuralAuthorization.pathPrefixes.some(
      (prefix) =>
        observation.path === prefix || observation.path.startsWith(`${prefix}/`)
    )
  )
}

function decodedPointerPart(value: string): string
{
  return value.replaceAll('~1', '/').replaceAll('~0', '~')
}

function entityObservationLineageId(
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  activeLineage: SemanticLineageSnapshot
): string | null
{
  const match =
    /^\/targets\/\d+\/(variables|lists|broadcasts|comments|blocks)\/([^/]+)$/u.exec(
      observation.path
    )
  if (!match) return null
  const collection = match[1]!
  const identityKind =
    collection === 'variables'
      ? 'variable'
      : collection === 'lists'
        ? 'list'
        : collection === 'broadcasts'
          ? 'broadcast'
          : collection === 'comments'
            ? 'comment'
            : 'block'
  const recordKind =
    collection === 'comments'
      ? 'comment'
      : collection === 'blocks'
        ? 'block'
        : 'declaration'
  const rawIdentity = `${identityKind}:${decodedPointerPart(match[2]!)}`
  const matches = activeLineage.records.filter(
    (record) =>
      record.kind === recordKind &&
      record.rawIdentity === rawIdentity &&
      (record.ownerLineageId === null ||
        observation.entityLineageIds.includes(record.ownerLineageId))
  )
  if (matches.length !== 1) return null
  const lineageId = matches[0]!.lineageId
  if (
    applied.operation.kind === 'declaration.addVariable' ||
    applied.operation.kind === 'declaration.addList' ||
    applied.operation.kind === 'declaration.addBroadcast' ||
    applied.operation.kind === 'comment.add' ||
    applied.operation.kind === 'script.add' ||
    applied.operation.kind === 'script.duplicate' ||
    applied.operation.kind === 'block.insertBefore' ||
    applied.operation.kind === 'block.insertAfter' ||
    applied.operation.kind === 'block.insertSubstack' ||
    applied.operation.kind === 'block.replace' ||
    applied.operation.kind === 'block.move' ||
    applied.operation.kind === 'block.remove' ||
    applied.operation.kind === 'block.setInput'
  )
  {
    const result = applied.result as {
      fixedSlots?: readonly { lineageId?: string }[]
      dynamicSlots?: readonly { lineageId?: string }[]
    }
    return [...(result.fixedSlots ?? []), ...(result.dynamicSlots ?? [])].some(
      (slot) => slot.lineageId === lineageId
    )
      ? lineageId
      : null
  }
  return applied.selectedEntityLineageIds.includes(lineageId) ? lineageId : null
}

function addedEntityContentMatches(
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  appliedOperations: readonly AppliedProductionOperationV1[]
): boolean
{
  const after = observation.afterState as
    { state: 'missing' } | { state: 'value'; value: unknown } | undefined
  if (after?.state !== 'value') return false
  const actual = after.value
  const operation = applied.operation
  const result = applied.result as {
    fixedSlots?: readonly { lineageId?: string }[]
  }
  const createdLineageIds = new Set(
    result.fixedSlots?.flatMap((slot) =>
      typeof slot.lineageId === 'string' ? [slot.lineageId] : []
    ) ?? []
  )
  const creatorIndex = appliedOperations.findIndex(
    (candidate) => candidate.occurrenceId === applied.occurrenceId
  )
  if (creatorIndex < 0 || createdLineageIds.size === 0) return false
  const laterWriters = appliedOperations
    .slice(creatorIndex + 1)
    .filter(
      (candidate) =>
        observation.operationIds.includes(candidate.occurrenceId) &&
        candidate.selectedEntityLineageIds.some((lineageId) =>
          createdLineageIds.has(lineageId)
        )
    )
  if (
    operation.kind === 'script.add' ||
    operation.kind === 'script.duplicate' ||
    operation.kind === 'block.insertBefore' ||
    operation.kind === 'block.insertAfter' ||
    operation.kind === 'block.insertSubstack' ||
    operation.kind === 'block.replace' ||
    operation.kind === 'block.move' ||
    operation.kind === 'block.remove' ||
    operation.kind === 'block.setInput' ||
    // a media record's content is bound by the creation-content fingerprint the
    // allowance already compares, which covers the parsed payload identity the
    // caller could not have forged
    operation.kind === 'media.addCostume' ||
    operation.kind === 'media.addSound' ||
    operation.kind === 'target.addSprite'
  )
    return true
  if (operation.kind === 'declaration.addVariable')
  {
    let expectedName = operation.name
    let expectedValue = operation.initialValue
    for (const writer of laterWriters)
    {
      if (writer.operation.kind === 'declaration.rename')
        expectedName = writer.operation.newName
      else if (writer.operation.kind === 'declaration.setVariableInitialValue')
        expectedValue = writer.operation.newValue
    }
    return (
      Array.isArray(actual) &&
      actual.length === 2 &&
      actual[0] === expectedName &&
      Object.is(actual[1], expectedValue)
    )
  }
  if (operation.kind === 'declaration.addList')
  {
    let expectedName = operation.name
    let expectedItems: readonly unknown[] = operation.initialItems
    for (const writer of laterWriters)
    {
      if (writer.operation.kind === 'declaration.rename')
        expectedName = writer.operation.newName
      else if (writer.operation.kind === 'declaration.setListInitialItems')
        expectedItems = writer.operation.newItems
    }
    return (
      Array.isArray(actual) &&
      actual.length === 2 &&
      actual[0] === expectedName &&
      Array.isArray(actual[1]) &&
      editCanonicalSha256V1(actual[1]) === editCanonicalSha256V1(expectedItems)
    )
  }
  if (operation.kind === 'declaration.addBroadcast')
  {
    let expectedName = operation.name
    for (const writer of laterWriters)
      if (writer.operation.kind === 'declaration.rename')
        expectedName = writer.operation.newName
    return typeof actual === 'string' && actual === expectedName
  }
  if (
    operation.kind !== 'comment.add' ||
    actual === null ||
    typeof actual !== 'object' ||
    Array.isArray(actual)
  )
    return false
  const comment = actual as Record<string, unknown>
  if (
    Object.keys(comment).sort().join('\0') !==
    ['blockId', 'height', 'minimized', 'text', 'width', 'x', 'y'].join('\0')
  )
    return false
  let expectedText = operation.text
  const expectedLayout = { ...operation.layout }
  let expectedAttachment: 'attached' | 'detached' = operation.attachment.kind
  for (const writer of laterWriters)
  {
    if (writer.operation.kind === 'comment.updateText')
      expectedText = writer.operation.text
    else if (writer.operation.kind === 'comment.move')
      for (const edit of writer.operation.edits)
        Object.assign(expectedLayout, { [edit.property]: edit.value })
    else if (writer.operation.kind === 'comment.attach')
      expectedAttachment = 'attached'
    else if (writer.operation.kind === 'comment.detach')
      expectedAttachment = 'detached'
  }
  return (
    comment['text'] === expectedText &&
    comment['x'] === expectedLayout.x &&
    comment['y'] === expectedLayout.y &&
    comment['width'] === expectedLayout.width &&
    comment['height'] === expectedLayout.height &&
    comment['minimized'] === expectedLayout.minimized &&
    (expectedAttachment === 'detached'
      ? comment['blockId'] === null
      : typeof comment['blockId'] === 'string')
  )
}

// a media addition writes three shapes the created record owns: the collection
// it joined, its own member slot, & the archive entry its payload landed at.
// ordinal addressing means member ownership is proven against running order
function mediaTargetResultBindingOwnsObservation(
  bindingKey: string,
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  activeLineage: SemanticLineageSnapshot
): boolean
{
  const candidates = applied.futureBindingRealizationCandidates?.filter(
    (candidate) =>
      candidate.bindingKey === bindingKey &&
      candidate.createdEntityKind === 'media'
  )
  if (candidates?.length !== 1) return false
  const created = activeLineage.records.find(
    (record) =>
      record.lineageId === candidates[0]!.resultLineageId &&
      record.status === 'active' &&
      (record.kind === 'costume' || record.kind === 'sound')
  )
  if (!created || created.ownerLineageId === null) return false
  const mediaKind = created.kind === 'sound' ? 'sound' : 'costume'
  const collection = mediaKind === 'sound' ? 'sounds' : 'costumes'
  const targets = activeOrderedSemanticLineages(activeLineage, 'target', null)
  const targetIndex = targets.findIndex(
    (record) => record.lineageId === created.ownerLineageId
  )
  if (targetIndex < 0) return false
  // the archive entry is the payload's own effect domain, admitted by the same
  // creation the allowance names
  if (/^\/assets\/[^/]+(?:\/.*)?$/u.test(observation.path)) return true
  const collectionPath = `/targets/${targetIndex}/${collection}`
  if (observation.path === collectionPath) return true
  // the correspondence path names the created lineage outright, so it is the
  // one member shape that needs no ordinal arithmetic
  if (
    observation.path.startsWith(`${collectionPath}/$members/`) ||
    observation.path === `${collectionPath}/$members`
  )
    return (
      observation.path === `${collectionPath}/$members` ||
      observation.path ===
        `${collectionPath}/$members/${pointerPart(created.lineageId)}`
    )
  const member = new RegExp(`^${collectionPath}/(\\d+)(?:/.*)?$`, 'u').exec(
    observation.path
  )
  if (!member) return false
  const ordered = activeOrderedSemanticLineages(
    activeLineage,
    mediaKind,
    created.ownerLineageId
  )
  return ordered[Number(member[1]!)]?.lineageId === created.lineageId
}

// a created sprite owns its whole subtree plus the collection & derived order
// projections its append necessarily moved
function mediaTargetTargetCreationOwnsObservation(
  bindingKey: string,
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  activeLineage: SemanticLineageSnapshot
): boolean
{
  const candidates = applied.futureBindingRealizationCandidates?.filter(
    (candidate) =>
      candidate.bindingKey === bindingKey &&
      candidate.createdEntityKind === 'target'
  )
  if (candidates?.length !== 1) return false
  const ordered = activeOrderedSemanticLineages(activeLineage, 'target', null)
  const createdIndex = ordered.findIndex(
    (record) => record.lineageId === candidates[0]!.resultLineageId
  )
  if (createdIndex < 0) return false
  if (
    observation.path === '/targets' ||
    observation.path === '/serializedTargetOrder' ||
    observation.path === '/visualTargetOrder' ||
    observation.path === '/runtimeExecutableTargetOrder' ||
    observation.path ===
      `/targets/$members/${pointerPart(candidates[0]!.resultLineageId)}`
  )
    return true
  const subtree = `/targets/${createdIndex}`
  return (
    observation.path === subtree || observation.path.startsWith(`${subtree}/`)
  )
}

function scriptBlockResultBindingOwnsObservation(
  bindingKey: string,
  entityKind: 'script' | 'block',
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  activeLineage: SemanticLineageSnapshot
): boolean
{
  const candidates = applied.futureBindingRealizationCandidates?.filter(
    (candidate) =>
      candidate.bindingKey === bindingKey &&
      candidate.createdEntityKind === entityKind
  )
  if (candidates?.length !== 1) return false
  const candidate = candidates[0]!
  if (entityKind === 'block')
    return (
      entityObservationLineageId(observation, applied, activeLineage) ===
      candidate.resultLineageId
    )
  const match = /^\/targets\/\d+\/blocks\/([^/]+)(?:\/.*)?$/u.exec(
    observation.path
  )
  if (!match) return false
  const rawIdentity = `script:${decodedPointerPart(match[1]!)}`
  return activeLineage.records.some(
    (record) =>
      record.lineageId === candidate.resultLineageId &&
      record.status === 'active' &&
      record.kind === 'script' &&
      record.rawIdentity === rawIdentity
  )
}

function allowanceRefMatches(
  reference: unknown,
  applied: AppliedProductionOperationV1
): boolean
{
  if (reference === null || typeof reference !== 'object') return false
  const value = reference as Record<string, unknown>
  if (
    (value.contractRefKind !== 'existing' &&
      value.contractRefKind !== 'future') ||
    typeof value.entityKind !== 'string' ||
    typeof value.bindingKey !== 'string'
  )
    return false
  if (applied.matchedContractBindingKeys.includes(value.bindingKey)) return true
  const scope = applied.selectedScope
  if (scope.scopeSubjectKind !== 'entity') return false
  if (
    scope.locationScope.scopeKind === 'targetAndOwnedDescendants' &&
    value.entityKind === 'target'
  )
    return scope.locationScope.target.bindingKey === value.bindingKey
  if (
    scope.locationScope.scopeKind === 'exactEntity' &&
    value.entityKind === scope.entityKind
  )
    return scope.locationScope.entity.bindingKey === value.bindingKey
  return false
}

function matchingLeafObservation(
  observation: ProductionDeltaObservationV1,
  operationId: string,
  matchingLeafObservations: MatchingLeafObservationIndexV1
): ProductionDeltaObservationV1
{
  if (observation.observationKind !== 'protected') return observation
  return (
    matchingLeafObservations.get(observation.path)?.get(operationId) ??
    observation
  )
}

type MatchingLeafObservationIndexV1 = ReadonlyMap<
  string,
  ReadonlyMap<string, ProductionDeltaObservationV1>
>

function matchingLeafObservationIndexV1(
  observations: readonly ProductionDeltaObservationV1[]
): MatchingLeafObservationIndexV1
{
  const indexed = new Map<string, Map<string, ProductionDeltaObservationV1>>()
  for (const observation of observations)
  {
    if (observation.observationKind === 'protected') continue
    let byOperationId = indexed.get(observation.path)
    if (!byOperationId)
    {
      byOperationId = new Map()
      indexed.set(observation.path, byOperationId)
    }
    for (const operationId of observation.operationIds)
      if (!byOperationId.has(operationId))
        byOperationId.set(operationId, observation)
  }
  return indexed
}

function specificAllowanceCovers(
  allowance: StructuralAllowanceV1,
  observation: ProductionDeltaObservationV1,
  applied: AppliedProductionOperationV1,
  matchingLeafObservations: MatchingLeafObservationIndexV1,
  contract: EditSemanticChangeContractV1,
  activeLineage: SemanticLineageSnapshot,
  appliedOperations: readonly AppliedProductionOperationV1[]
): boolean
{
  if (!observation.operationIds.includes(applied.occurrenceId)) return false
  const evidence = matchingLeafObservation(
    observation,
    applied.occurrenceId,
    matchingLeafObservations
  )
  if (allowance.kind === 'propertyTransition')
  {
    const property = targetPropertyObservation(evidence)
    const targetSemanticProperty = targetSemanticPropertyObservation(
      evidence,
      applied
    )
    return (
      ((allowance.property.surface === 'target' &&
        property?.property === allowance.property.property &&
        observationSelectsAppliedTarget(evidence, applied)) ||
        (targetSemanticProperty !== null &&
          targetSemanticProperty.properties.length === 1 &&
          allowance.property.surface === targetSemanticProperty.surface &&
          (allowance.property.surface === 'blockField' ||
          allowance.property.surface === 'blockInput'
            ? allowance.property.descriptorName ===
              targetSemanticProperty.properties[0]
            : allowance.property.property ===
              targetSemanticProperty.properties[0]))) &&
      allowanceRefMatches(allowance.entity, applied) &&
      allowance.beforeValueSha256 ===
        productionCanonicalValueSha256V1(evidence.beforeState) &&
      allowance.afterValueSha256 ===
        productionCanonicalValueSha256V1(evidence.afterState)
    )
  }
  if (allowance.kind === 'entityAddition')
  {
    const futureBinding = contract.entityBindings.find(
      (binding) =>
        binding.bindingKey === allowance.candidate.bindingKey &&
        binding.bindingKind === 'future'
    )
    const scriptBlockAddition =
      futureBinding?.bindingKind === 'future' &&
      (futureBinding.entityKind === 'script' ||
        futureBinding.entityKind === 'block') &&
      scriptBlockResultBindingOwnsObservation(
        allowance.candidate.bindingKey,
        futureBinding.entityKind,
        evidence,
        applied,
        activeLineage
      )
    const scriptBlockSemanticAddition =
      scriptBlockAddition &&
      (evidence.kind === 'added' ||
        (evidence.kind === 'changed' &&
          futureBinding?.bindingKind === 'future' &&
          futureBinding.entityKind === 'script' &&
          futureBinding.expectedCreationRole.roleKind === 'fixed' &&
          futureBinding.expectedCreationRole.name === 'destinationScript'))
    // a created media record owns the collection it joined as well as its own
    // slot, so an addition legitimately shows up as a change to the collection
    const mediaTargetAddition =
      futureBinding?.bindingKind === 'future' &&
      ((futureBinding.entityKind === 'media' &&
        (applied.operation.kind === 'media.addCostume' ||
          applied.operation.kind === 'media.addSound') &&
        mediaTargetResultBindingOwnsObservation(
          allowance.candidate.bindingKey,
          evidence,
          applied,
          activeLineage
        )) ||
        (futureBinding.entityKind === 'target' &&
          applied.operation.kind === 'target.addSprite' &&
          mediaTargetTargetCreationOwnsObservation(
            allowance.candidate.bindingKey,
            evidence,
            applied,
            activeLineage
          )))
    return (
      (scriptBlockSemanticAddition ||
        mediaTargetAddition ||
        applied.operation.kind === 'declaration.addVariable' ||
        applied.operation.kind === 'declaration.addList' ||
        applied.operation.kind === 'declaration.addBroadcast' ||
        applied.operation.kind === 'comment.add') &&
      (scriptBlockSemanticAddition ||
        mediaTargetAddition ||
        evidence.kind === 'added') &&
      (scriptBlockSemanticAddition ||
        mediaTargetAddition ||
        entityObservationLineageId(evidence, applied, activeLineage) !==
          null) &&
      addedEntityContentMatches(evidence, applied, appliedOperations) &&
      observationHasStructuralPath(evidence, applied) &&
      allowanceRefMatches(allowance.candidate, applied) &&
      allowance.expectedAddedContentSha256 ===
        (futureBinding?.bindingKind === 'future'
          ? futureBinding.expectedCreationContentFingerprintSha256
          : undefined)
    )
  }
  if (allowance.kind === 'entityRemoval')
  {
    const result = targetResult(applied)
    if (
      (applied.operation.kind === 'declaration.remove' ||
        applied.operation.kind === 'comment.remove') &&
      evidence.kind === 'removed'
    )
      return (
        entityObservationLineageId(evidence, applied, activeLineage) !== null &&
        observationHasStructuralPath(evidence, applied) &&
        allowanceRefMatches(allowance.source, applied) &&
        allowance.expectedRemovedContentSha256 ===
          productionEntityDeltaContentSha256V1(evidence.beforeState)
      )
    if (
      (applied.operation.kind === 'script.remove' ||
        applied.operation.kind === 'block.replace' ||
        applied.operation.kind === 'block.remove' ||
        applied.operation.kind === 'block.setInput') &&
      evidence.kind === 'removed'
    )
    {
      const source = allowance.source
      const publicRemovalPaths =
        applied.authorizationEvidence?.groupDGraph?.publicRemovalPaths ?? []
      const expectedEntityKind =
        applied.operation.kind === 'script.remove' ? 'script' : 'block'
      return (
        publicRemovalPaths.includes(evidence.path) &&
        source.entityKind === expectedEntityKind &&
        observationHasStructuralPath(evidence, applied) &&
        allowanceRefMatches(source, applied) &&
        allowance.expectedRemovedContentSha256 ===
          productionEntityDeltaContentSha256V1(evidence.beforeState)
      )
    }
    return (
      applied.operation.kind === 'target.removeSprite' &&
      observationHasStructuralPath(observation, applied) &&
      allowanceRefMatches(allowance.source, applied) &&
      allowance.expectedRemovedContentSha256 ===
        result?.postcondition.ownedSurfaceSha256
    )
  }
  if (allowance.kind === 'collectionContainerTransition')
  {
    const collectionMatch = new RegExp(
      `^/targets/\\d+/${allowance.collection}$`,
      'u'
    ).test(evidence.path)
    const before = evidence.beforeState as
      { state: 'missing' } | { state: 'value'; value: unknown } | undefined
    const after = evidence.afterState as
      { state: 'missing' } | { state: 'value'; value: unknown } | undefined
    if (
      !collectionMatch ||
      !before ||
      !after ||
      (before.state === 'value' &&
        (before.value === null ||
          typeof before.value !== 'object' ||
          Array.isArray(before.value))) ||
      after.state !== 'value' ||
      after.value === null ||
      typeof after.value !== 'object' ||
      Array.isArray(after.value)
    )
      return false
    const beforeState = optionalCollectionContainerStateV1(
      before.state === 'missing'
        ? undefined
        : (before.value as Record<string, unknown>)
    )
    const afterState = optionalCollectionContainerStateV1(
      after.value as Record<string, unknown>
    )
    return (
      observationHasStructuralPath(evidence, applied) &&
      allowanceRefMatches(allowance.owner, applied) &&
      editCanonicalSha256V1(beforeState) ===
        editCanonicalSha256V1(allowance.beforeState) &&
      editCanonicalSha256V1(afterState) ===
        editCanonicalSha256V1(allowance.afterState)
    )
  }
  if (allowance.kind === 'entityMove')
  {
    const result = targetResult(applied)
    const evidence = applied.authorizationEvidence?.entityMove
    if (
      (applied.operation.kind === 'script.moveWorkspace' ||
        applied.operation.kind === 'comment.move') &&
      evidence !== undefined
    )
      return (
        allowance.collection === evidence.collection &&
        observationHasStructuralPath(observation, applied) &&
        allowanceRefMatches(allowance.entity, applied) &&
        allowance.beforePositionSha256 === evidence.beforePositionSha256 &&
        allowance.afterPositionSha256 === evidence.afterPositionSha256
      )
    return (
      applied.operation.kind === 'target.reorderSprite' &&
      allowance.collection === 'visualLayers' &&
      observationHasStructuralPath(observation, applied) &&
      allowanceRefMatches(allowance.entity, applied) &&
      result !== null &&
      allowance.beforePositionSha256 ===
        productionTargetVisualPositionSha256V1(
          result.beforeOrder,
          result.targetLineageId
        ) &&
      allowance.afterPositionSha256 ===
        productionTargetVisualPositionSha256V1(
          result.afterOrder,
          result.targetLineageId
        )
    )
  }
  if (allowance.kind === 'referencePropagation')
  {
    const result = targetResult(applied)
    const evidence = applied.authorizationEvidence?.referencePropagation
    if (
      applied.operation.kind === 'declaration.rename' &&
      evidence !== undefined
    )
      return (
        observationHasStructuralPath(observation, applied) &&
        allowanceRefMatches(allowance.owner, applied) &&
        allowance.beforeReferenceSetSha256 ===
          evidence.beforeReferenceSetSha256 &&
        allowance.afterReferenceSetSha256 === evidence.afterReferenceSetSha256
      )
    return (
      applied.operation.kind === 'target.renameSprite' &&
      observationHasStructuralPath(observation, applied) &&
      allowanceRefMatches(allowance.owner, applied) &&
      allowance.beforeReferenceSetSha256 ===
        applied.operation.expectedInboundReferenceSetSha256 &&
      allowance.afterReferenceSetSha256 ===
        result?.postcondition.inboundReferenceSetSha256
    )
  }
  if (allowance.kind === 'projectPropertyTransition')
  {
    const propertyPath =
      allowance.property.property === 'serializedTargetOrder'
        ? '/serializedTargetOrder'
        : '/runtimeExecutableTargetOrder'
    return (
      observation.path === propertyPath &&
      allowance.beforeValueSha256 ===
        productionCanonicalValueSha256V1(evidence.beforeState) &&
      allowance.afterValueSha256 ===
        productionCanonicalValueSha256V1(evidence.afterState)
    )
  }
  return false
}

function exactDeltaAllowanceMatches(
  contract: EditSemanticChangeContractV1,
  parentFingerprintContext: ProductionDeltaFingerprintContextV1,
  cumulativeFingerprintContext: ProductionDeltaFingerprintContextV1
): readonly string[]
{
  const parentFingerprint = productionDeltaFingerprintFromContextV1(
    parentFingerprintContext
  )
  const cumulativeFingerprint = productionDeltaFingerprintFromContextV1(
    cumulativeFingerprintContext
  )
  return Object.freeze(
    contract.allowedStructuralChanges.flatMap((allowance) =>
      allowance.kind === 'deltaFingerprint' &&
      ((allowance.direction === 'parent-child' &&
        allowance.semanticChangeFingerprint === parentFingerprint) ||
        (allowance.direction === 'source-head' &&
          allowance.semanticChangeFingerprint === cumulativeFingerprint))
        ? [allowance.allowanceId]
        : []
    )
  )
}

function targetForExistingBinding(
  contract: EditSemanticChangeContractV1,
  reference: unknown,
  source: ProjectIR,
  candidate: ProjectIR,
  activeLineage: SemanticLineageSnapshot
): { target: ProjectIR['json']['targets'][number]; lineageId: string } | null
{
  if (reference === null || typeof reference !== 'object') return null
  const ref = reference as Record<string, unknown>
  if (
    ref.contractRefKind !== 'existing' ||
    ref.entityKind !== 'target' ||
    typeof ref.bindingKey !== 'string'
  )
    return null
  const sourceEvidence = targetEntityEvidenceSetV1(source.json).find(
    (evidence) =>
      existingTargetBinding(contract, ref.bindingKey as string, evidence) !==
      null
  )
  if (!sourceEvidence) return null
  const lineage = activeLineage.records.find(
    (record) =>
      record.kind === 'target' &&
      record.ownerLineageId === null &&
      record.rawIdentity === `target:${sourceEvidence.targetIndex}`
  )
  if (!lineage || lineage.status !== 'active') return null
  const activeTargets = activeOrderedSemanticLineages(
    activeLineage,
    'target',
    null
  )
  const targetIndex = activeTargets.findIndex(
    (record) => record.lineageId === lineage.lineageId
  )
  const target = candidate.json.targets[targetIndex]
  return target ? { target, lineageId: lineage.lineageId } : null
}

function targetForFutureBinding(
  contract: EditSemanticChangeContractV1,
  reference: unknown,
  candidate: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  futureBindingLedger: FutureBindingLedgerV1
): { target: ProjectIR['json']['targets'][number]; lineageId: string } | null
{
  if (reference === null || typeof reference !== 'object') return null
  const ref = reference as Record<string, unknown>
  if (
    ref.contractRefKind !== 'future' ||
    ref.entityKind !== 'target' ||
    ref.entitySubtype !== 'sprite' ||
    typeof ref.bindingKey !== 'string'
  )
    return null
  const bindings = contract.entityBindings.filter(
    (binding) =>
      binding.bindingKind === 'future' &&
      binding.bindingKey === ref.bindingKey &&
      binding.entityKind === ref.entityKind &&
      binding.entitySubtype === ref.entitySubtype
  )
  if (bindings.length !== 1 || bindings[0]!.bindingKind !== 'future')
    return null
  const binding = bindings[0]!
  const bindingKeySha256 = futureBindingKeySha256V1(
    futureBindingLedger.changeContractSha256,
    binding.bindingKey
  )
  const rows = futureBindingLedger.realizations.filter(
    (row) =>
      row.bindingKeySha256 === bindingKeySha256 &&
      row.bindingDescriptorSha256 === futureBindingDescriptorSha256V1(binding)
  )
  if (rows.length !== 1) return null
  const lineageMatches = activeLineage.records.filter(
    (record) =>
      record.lineageId === rows[0]!.resultLineageId &&
      record.kind === 'target' &&
      record.ownerLineageId === null &&
      record.status === 'active'
  )
  if (lineageMatches.length !== 1) return null
  const ordered = activeOrderedSemanticLineages(activeLineage, 'target', null)
  const orderedMatches = ordered
    .map((record, targetIndex) => ({ record, targetIndex }))
    .filter((entry) => entry.record.lineageId === rows[0]!.resultLineageId)
  if (orderedMatches.length !== 1) return null
  const target = candidate.json.targets[orderedMatches[0]!.targetIndex]
  if (target === undefined || target.isStage) return null
  return { target, lineageId: rows[0]!.resultLineageId }
}

function targetForContractBinding(
  contract: EditSemanticChangeContractV1,
  reference: unknown,
  source: ProjectIR,
  candidate: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  futureBindingLedger: FutureBindingLedgerV1
): { target: ProjectIR['json']['targets'][number]; lineageId: string } | null
{
  if (
    reference !== null &&
    typeof reference === 'object' &&
    (reference as Record<string, unknown>).contractRefKind === 'future'
  )
    return targetForFutureBinding(
      contract,
      reference,
      candidate,
      activeLineage,
      futureBindingLedger
    )
  return targetForExistingBinding(
    contract,
    reference,
    source,
    candidate,
    activeLineage
  )
}

function targetPropertyValue(
  target: ProjectIR['json']['targets'][number],
  property: string
): unknown
{
  if (property === 'selectedCostume') return target.currentCostume
  return (target as unknown as Record<string, unknown>)[property]
}

function requiredStructuralPredicateSatisfied(
  predicate: StructuralPredicateV1,
  contract: EditSemanticChangeContractV1,
  source: ProjectIR,
  candidate: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  futureBindingLedger: FutureBindingLedgerV1,
  parentFingerprintContext: ProductionDeltaFingerprintContextV1,
  cumulativeFingerprintContext: ProductionDeltaFingerprintContextV1,
  operationScopeEvidence: readonly ProductionOperationScopeEvidenceV1[]
): boolean
{
  if (predicate.kind === 'deltaContains')
  {
    const fingerprintContext =
      predicate.direction === 'parent-child'
        ? parentFingerprintContext
        : cumulativeFingerprintContext
    return operationScopeEvidence.some(
      (entry) =>
        entry.operationKind === predicate.operationKind &&
        entry.semanticScopeSha256 === predicate.semanticScopeSha256 &&
        productionOperationChangeFingerprintFromContextV1(
          fingerprintContext,
          entry.occurrenceId
        ) === predicate.semanticChangeFingerprint
    )
  }
  if (predicate.kind === 'entityExists')
    return (
      targetForContractBinding(
        contract,
        predicate.candidate,
        source,
        candidate,
        activeLineage,
        futureBindingLedger
      ) !== null
    )
  if (predicate.kind === 'entityAbsent')
    return (
      targetForExistingBinding(
        contract,
        predicate.source,
        source,
        candidate,
        activeLineage
      ) === null
    )
  if (
    predicate.kind === 'propertyEquals' &&
    predicate.property.surface === 'target'
  )
  {
    const selected = targetForContractBinding(
      contract,
      predicate.entity,
      source,
      candidate,
      activeLineage,
      futureBindingLedger
    )
    return (
      selected !== null &&
      productionCanonicalValueSha256V1(
        targetPropertyValue(selected.target, predicate.property.property)
      ) === predicate.canonicalValueSha256
    )
  }
  if (predicate.kind === 'projectPropertyEquals')
  {
    const order = targetDualOrderSnapshotV1(candidate.json, activeLineage)
    const value =
      predicate.property.property === 'serializedTargetOrder'
        ? order.serializedTargetLineageIds
        : order.runtimeExecutableTargetLineageIds
    return (
      productionCanonicalValueSha256V1(value) === predicate.canonicalValueSha256
    )
  }
  return false
}

interface ProductionContractAuthorizationV1
{
  readonly authorized: true
  readonly exactDeltaAllowanceIds: readonly string[]
  readonly matchedStructuralAllowanceIds: readonly string[]
  readonly satisfiedObjectiveIds: readonly string[]
  readonly pendingObjectiveIds: readonly string[]
  readonly requiredObjectiveEvidence: readonly {
    readonly objectiveId: string
    readonly status: 'satisfied' | 'pending'
    readonly predicateSha256: string
  }[]
  readonly operationScopeEvidence: readonly ProductionOperationScopeEvidenceV1[]
  readonly parentObservationSetSha256: string
  readonly cumulativeObservationSetSha256: string
}

interface ProductionOperationScopeEvidenceV1
{
  readonly opId: string
  readonly occurrenceId: string
  readonly operationKind: SemanticEditOperationV1['kind']
  readonly semanticScopeSha256: string
}

function retainedOperationScopeEvidence(
  value: unknown
): readonly ProductionOperationScopeEvidenceV1[]
{
  if (value === null || typeof value !== 'object') return Object.freeze([])
  const contractAuthorization = (value as Record<string, unknown>)[
    'contractAuthorization'
  ]
  if (
    contractAuthorization === null ||
    typeof contractAuthorization !== 'object'
  )
    return Object.freeze([])
  const evidence = (contractAuthorization as Record<string, unknown>)[
    'operationScopeEvidence'
  ]
  if (!Array.isArray(evidence)) return Object.freeze([])
  return Object.freeze(
    evidence.flatMap((entry) =>
    {
      if (entry === null || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      return typeof record['opId'] === 'string' &&
        typeof record['occurrenceId'] === 'string' &&
        typeof record['operationKind'] === 'string' &&
        typeof record['semanticScopeSha256'] === 'string'
        ? [
            {
              opId: record['opId'],
              occurrenceId: record['occurrenceId'],
              operationKind: record[
                'operationKind'
              ] as SemanticEditOperationV1['kind'],
              semanticScopeSha256: record['semanticScopeSha256'],
            },
          ]
        : []
    })
  )
}

function retainedSatisfiedObjectivePredicateHashes(
  value: unknown
): ReadonlySet<string>
{
  if (value === null || typeof value !== 'object') return new Set()
  const contractAuthorization = (value as Record<string, unknown>)[
    'contractAuthorization'
  ]
  if (
    contractAuthorization === null ||
    typeof contractAuthorization !== 'object'
  )
    return new Set()
  const evidence = (contractAuthorization as Record<string, unknown>)[
    'requiredObjectiveEvidence'
  ]
  if (!Array.isArray(evidence)) return new Set()
  return new Set(
    evidence.flatMap((entry) =>
    {
      if (entry === null || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      return record['status'] === 'satisfied' &&
        typeof record['predicateSha256'] === 'string'
        ? [record['predicateSha256']]
        : []
    })
  )
}

function assertContractDeltaAuthorization(
  contract: EditSemanticChangeContractV1,
  source: ProjectIR,
  candidate: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  futureBindingLedger: FutureBindingLedgerV1,
  parentDelta: ProjectDelta,
  cumulativeDelta: ProjectDelta,
  applied: readonly AppliedProductionOperationV1[],
  retainedAuthorization: unknown
): ProductionContractAuthorizationV1
{
  const parentFingerprintContext = createProductionDeltaFingerprintContextV1(
    'parent-child',
    parentDelta
  )
  const cumulativeFingerprintContext =
    createProductionDeltaFingerprintContextV1('source-head', cumulativeDelta)
  const observations = productionDeltaObservationsFromContextV1(
    parentFingerprintContext
  )
  const appliedByOccurrenceId = new Map<string, AppliedProductionOperationV1>()
  for (const entry of applied)
    if (!appliedByOccurrenceId.has(entry.occurrenceId))
      appliedByOccurrenceId.set(entry.occurrenceId, entry)
  const matchingLeafObservations = matchingLeafObservationIndexV1(observations)
  const exactDeltaAllowanceIds = exactDeltaAllowanceMatches(
    contract,
    parentFingerprintContext,
    cumulativeFingerprintContext
  )
  const matchedStructuralAllowanceIds = new Set<string>()
  const operationScopeEvidenceById = new Map(
    retainedOperationScopeEvidence(retainedAuthorization).map((entry) => [
      entry.occurrenceId,
      entry,
    ])
  )
  for (const entry of applied)
    operationScopeEvidenceById.set(entry.occurrenceId, {
      opId: entry.operation.opId,
      occurrenceId: entry.occurrenceId,
      operationKind: entry.operation.kind,
      semanticScopeSha256: productionContractScopeSha256V1(entry.selectedScope),
    })
  const operationScopeEvidence = [...operationScopeEvidenceById.values()].sort(
    (left, right) => left.occurrenceId.localeCompare(right.occurrenceId)
  )
  const retainedSatisfiedPredicateHashes =
    retainedSatisfiedObjectivePredicateHashes(retainedAuthorization)
  for (const observation of observations)
  {
    if (observation.operationIds.length === 0)
      return fail(
        'edit.unauthorized_change',
        `change contract does not authorize unattributed path ${observation.path}`
      )
    const attributed = observation.operationIds.map((operationId) =>
      appliedByOccurrenceId.get(operationId)
    )
    if (attributed.some((entry) => entry === undefined))
      return fail(
        'edit.unauthorized_change',
        `change contract does not recognize attribution at ${observation.path}`
      )
    for (const entry of attributed as AppliedProductionOperationV1[])
    {
      let covered = exactDeltaAllowanceIds.length > 0
      if (
        !covered &&
        scopeCoversObservation(
          observation,
          entry,
          matchingLeafObservations,
          activeLineage
        )
      )
        covered = true
      if (!covered)
      {
        for (const allowance of contract.allowedStructuralChanges)
        {
          if (
            specificAllowanceCovers(
              allowance,
              observation,
              entry,
              matchingLeafObservations,
              contract,
              activeLineage,
              applied
            )
          )
          {
            matchedStructuralAllowanceIds.add(allowance.allowanceId)
            covered = true
            break
          }
        }
      }
      if (!covered)
        return fail(
          'edit.unauthorized_change',
          `change contract does not authorize ${entry.operation.kind} occurrence at ${observation.path}`
        )
    }
  }
  const requiredObjectiveEvidence = contract.requiredStructuralChanges
    .map((predicate) =>
    {
      const predicateSha256 = editCanonicalSha256V1(predicate)
      const satisfied =
        (predicate.kind === 'deltaContains' &&
          predicate.direction === 'parent-child' &&
          retainedSatisfiedPredicateHashes.has(predicateSha256)) ||
        requiredStructuralPredicateSatisfied(
          predicate,
          contract,
          source,
          candidate,
          activeLineage,
          futureBindingLedger,
          parentFingerprintContext,
          cumulativeFingerprintContext,
          operationScopeEvidence
        )
      return {
        objectiveId: predicate.objectiveId,
        status: satisfied ? ('satisfied' as const) : ('pending' as const),
        predicateSha256,
      }
    })
    .sort((left, right) => left.objectiveId.localeCompare(right.objectiveId))
  return {
    authorized: true,
    exactDeltaAllowanceIds,
    matchedStructuralAllowanceIds: Object.freeze(
      [...matchedStructuralAllowanceIds].sort()
    ),
    satisfiedObjectiveIds: Object.freeze(
      requiredObjectiveEvidence
        .filter((entry) => entry.status === 'satisfied')
        .map((entry) => entry.objectiveId)
    ),
    pendingObjectiveIds: Object.freeze(
      requiredObjectiveEvidence
        .filter((entry) => entry.status === 'pending')
        .map((entry) => entry.objectiveId)
    ),
    requiredObjectiveEvidence: Object.freeze(requiredObjectiveEvidence),
    operationScopeEvidence: Object.freeze(operationScopeEvidence),
    parentObservationSetSha256: editCanonicalSha256V1(observations),
    cumulativeObservationSetSha256: editCanonicalSha256V1(
      productionDeltaObservationsFromContextV1(cumulativeFingerprintContext)
    ),
  }
}

function authorizationEnvelopes(
  delta: ProjectDelta,
  operations: readonly AppliedProductionOperationV1[]
): readonly EditAuthorizationEnvelope[]
{
  const mutable = new Map<string, MutableAuthorizationEnvelopeV1>()
  for (const operation of operations)
  {
    mutable.set(operation.occurrenceId, {
      operationId: operation.occurrenceId,
      exactPaths: new Set(),
      changeKinds: new Set(),
      protectedClasses: new Set(),
      entityLineageIds: new Set(),
      allowMandatoryProtectedChange:
        operation.operation.kind === 'target.removeSprite',
    })
  }
  const add = (
    operationIds: readonly string[],
    path: string,
    kind: DeltaChangeKind,
    lineages: readonly string[] = []
  ): void =>
  {
    for (const operationId of operationIds)
    {
      const envelope = mutable.get(operationId)
      if (!envelope) continue
      envelope.exactPaths.add(path)
      envelope.changeKinds.add(kind)
      for (const lineage of lineages) envelope.entityLineageIds.add(lineage)
    }
  }
  for (const change of allDeltaChanges(delta))
    add(change.operationIds, change.path, change.kind, change.entityLineageIds)
  for (const asset of delta.assets)
    add(
      asset.operationIds,
      `/assets/${asset.path}/${asset.occurrence}`,
      asset.kind
    )
  for (const ordered of delta.orderedCollectionChanges ?? [])
    add(
      ordered.operationIds,
      ordered.collectionPath,
      ordered.kind === 'added'
        ? 'added'
        : ordered.kind === 'removed'
          ? 'removed'
          : 'changed',
      [ordered.lineageId]
    )
  for (const change of delta.protectedChanges)
  {
    for (const operationId of change.operationIds)
    {
      const envelope = mutable.get(operationId)
      if (!envelope) continue
      envelope.protectedClasses.add(change.class)
      for (const lineage of change.entityLineageIds ?? [])
        envelope.entityLineageIds.add(lineage)
    }
  }
  return Object.freeze(
    [...mutable.values()].map((envelope) => ({
      operationId: envelope.operationId,
      exactPaths: Object.freeze([...envelope.exactPaths].sort()),
      pathPrefixes: Object.freeze([]),
      changeKinds: Object.freeze([...envelope.changeKinds].sort()),
      protectedClasses: Object.freeze([...envelope.protectedClasses].sort()),
      entityLineageIds: Object.freeze([...envelope.entityLineageIds].sort()),
      allowMandatoryProtectedChange: envelope.allowMandatoryProtectedChange,
    }))
  )
}

function assertMeaningfulDelta(delta: ProjectDelta): void
{
  const total = Object.values(delta.summary).reduce(
    (sum, value) => sum + value,
    0
  )
  if (total === 0)
    fail(
      'edit.internal_invariant',
      'applied operation batch produced no attributable semantic delta'
    )
  if (!delta.complete)
    fail('edit.internal_invariant', 'project delta is incomplete')
}

function preservationResult(
  current: ProjectIR,
  candidate: ProjectIR,
  operations: readonly AppliedProductionOperationV1[],
  parentDelta: ProjectDelta
): unknown
{
  const allowsStructure = operations.some(
    (operation) =>
      operation.operation.kind === 'target.addSprite' ||
      operation.operation.kind === 'target.renameSprite' ||
      operation.operation.kind === 'target.reorderSprite' ||
      operation.operation.kind === 'target.removeSprite'
  )
  const allowedTargetProperties = operations.flatMap((operation) =>
    operation.operation.kind === 'target.setSpriteProperties' ||
    operation.operation.kind === 'target.setStageProperties'
      ? operation.operation.edits.map((edit) =>
        {
          const target = (operation.canonicalOperation as TargetOperationV1)
            .target
          if (
            target.refKind !== 'structural' ||
            target.selectorKind !== 'exactLocation'
          )
            return fail(
              'edit.internal_invariant',
              'canonical target property ref is not exact structural'
            )
          return {
            targetIndex: target.location.serializedTargetOrdinal,
            property: edit.property,
          }
        })
      : []
  )
  const checked = checkPreservation(
    createPreservationManifest(current),
    candidate,
    {
      allowTargetStructureChanges: allowsStructure,
      allowedTargetProperties,
    }
  )
  const hasRename = operations.some(
    (operation) => operation.operation.kind === 'target.renameSprite'
  )
  const hasRemove = operations.some(
    (operation) => operation.operation.kind === 'target.removeSprite'
  )
  // a created sprite arrives w/ its own empty declaration, comment, & media
  // maps, which the manifest reads as changes to those surfaces
  const hasSpriteCreation = operations.some(
    (operation) => operation.operation.kind === 'target.addSprite'
  )
  const operationByOccurrence = new Map(
    operations.map((operation) => [operation.occurrenceId, operation])
  )
  const familyOwnsChange = (
    change: ValueDelta,
    family: 'declaration' | 'comment' | 'script' | 'scriptBlock'
  ): boolean =>
    change.operationIds.length > 0 &&
    change.operationIds.every((operationId) =>
    {
      const operation = operationByOccurrence.get(operationId)
      const observation = {
        observationKind: 'leaf' as const,
        path: change.path,
        kind: change.kind,
        operationIds: change.operationIds,
        entityLineageIds: change.entityLineageIds ?? [],
        beforeState: optionalDeltaState(change, 'before'),
        afterState: optionalDeltaState(change, 'after'),
      }
      return (
        operation !== undefined &&
        (family === 'scriptBlock'
          ? operation.operation.kind !== 'script.moveWorkspace' &&
            (operation.operation.kind.startsWith('script.') ||
              operation.operation.kind.startsWith('block.'))
          : operation.operation.kind.startsWith(`${family}.`)) &&
        (observationHasStructuralPath(observation, operation) ||
          targetSemanticPropertyObservation(observation, operation) !== null)
      )
    })
  const declarationChanges = parentDelta.targets.flatMap(
    (target) => target.declarationChanges
  )
  const commentChanges = parentDelta.targets.flatMap((target) => [
    ...target.existingEditorLayoutChanges.filter(
      (change) =>
        change.path.includes('/comments/') || change.path.endsWith('/comments')
    ),
    ...target.blockChanges.flatMap((block) =>
      block.changes.filter((change) => change.path.endsWith('/comment'))
    ),
  ])
  const scriptLayoutChanges = parentDelta.targets.flatMap((target) =>
    target.blockChanges.flatMap((block) =>
      block.changes.filter(
        (change) => change.path.endsWith('/x') || change.path.endsWith('/y')
      )
    )
  )
  const monitorChanges = parentDelta.projectChanges
    .map((entry) => entry.change)
    .filter(
      (change) =>
        change.path === '/monitors' || change.path.startsWith('/monitors/')
    )
  const allowsDeclarations =
    declarationChanges.length > 0 &&
    declarationChanges.every((change) =>
      familyOwnsChange(change, 'declaration')
    )
  const allowsComments =
    commentChanges.length > 0 &&
    commentChanges.every((change) => familyOwnsChange(change, 'comment'))
  const allowsScriptLayout =
    scriptLayoutChanges.length > 0 &&
    scriptLayoutChanges.every((change) => familyOwnsChange(change, 'script'))
  const allowsDeclarationMonitors =
    monitorChanges.length > 0 &&
    monitorChanges.every((change) => familyOwnsChange(change, 'declaration'))
  const allowsScriptBlockComments =
    commentChanges.length > 0 &&
    commentChanges.every((change) => familyOwnsChange(change, 'scriptBlock'))
  const scriptBlockOwnsExactScriptViolation = (path: string): boolean =>
  {
    const match = /^\/targets\/(\d+)\/blocks\/([^/]+)$/u.exec(path)
    if (!match) return false
    const targetIndex = Number(match[1])
    const blockId = decodedPointerPart(match[2]!)
    const blockDelta = parentDelta.targets
      .find((target) => target.targetIndex === targetIndex)
      ?.blockChanges.find((block) => block.blockId === blockId)
    return (
      blockDelta !== undefined &&
      blockDelta.operationIds.length > 0 &&
      blockDelta.operationIds.every((operationId) =>
      {
        const operation = operationByOccurrence.get(operationId)
        return (
          operation !== undefined &&
          operation.operation.kind !== 'script.moveWorkspace' &&
          (operation.operation.kind.startsWith('script.') ||
            operation.operation.kind.startsWith('block.')) &&
          observationHasStructuralPath(
            {
              observationKind: 'leaf',
              path,
              kind: blockDelta.kind,
              operationIds: blockDelta.operationIds,
              entityLineageIds: [],
            },
            operation
          )
        )
      })
    )
  }
  // an authorized media operation necessarily rewrites the media collection, &
  // one that admits a payload necessarily grows the archive. both were already
  // proven against the contract, so they are consequences rather than breaches
  const mediaOperationKinds = operations
    .map((operation) => operation.operation.kind)
    .filter((kind) => kind.startsWith('media.'))
  const admitsPayload = operations.some(
    (operation) =>
      operation.operation.kind === 'media.addCostume' ||
      operation.operation.kind === 'media.addSound' ||
      operation.operation.kind === 'media.replaceCostume' ||
      operation.operation.kind === 'media.replaceSound' ||
      operation.operation.kind === 'target.addSprite'
  )
  const reconcilesSelection = operations.some((operation) =>
    MEDIA_SELECTION_RECONCILING_KINDS.has(operation.operation.kind)
  )
  const allowedCodes = new Set<string>([
    ...(hasSpriteCreation
      ? [
          'target-structure-changed',
          'declarations-changed',
          'comments-changed',
          'asset-metadata-changed',
          'gameplay-property-changed',
          'unknown-fields-changed',
        ]
      : []),
    ...(admitsPayload ? ['asset-changed'] : []),
    ...(mediaOperationKinds.length > 0 || admitsPayload
      ? ['asset-metadata-changed']
      : []),
    ...(hasRename || allowsDeclarationMonitors ? ['monitors-changed'] : []),
    ...(allowsDeclarations ? ['declarations-changed'] : []),
    ...(allowsComments ? ['comments-changed'] : []),
    ...(allowsScriptLayout ? ['existing-script-layout-changed'] : []),
    ...(hasRemove
      ? [
          'asset-metadata-changed',
          'declarations-changed',
          'existing-script-missing',
          'comments-changed',
          'gameplay-property-changed',
          'unknown-fields-changed',
        ]
      : []),
  ])
  const allowedViolation = (
    violation: (typeof checked.violations)[number]
  ): boolean =>
  {
    if (
      (violation.code === 'existing-script-missing' ||
        violation.code === 'existing-script-layout-changed') &&
      scriptBlockOwnsExactScriptViolation(violation.path)
    )
      return true
    if (violation.code === 'comments-changed' && allowsScriptBlockComments)
      return true
    // the selection index is the one gameplay property a media operation may
    // move, & only at the exact target path it reconciled
    if (
      violation.code === 'gameplay-property-changed' &&
      reconcilesSelection &&
      /^\/targets\/\d+\/currentCostume$/u.test(violation.path)
    )
      return true
    return allowedCodes.has(violation.code)
  }
  const allowedViolations: (typeof checked.violations)[number][] = []
  const violations: (typeof checked.violations)[number][] = []
  for (const violation of checked.violations)
  {
    if (allowedViolation(violation)) allowedViolations.push(violation)
    else violations.push(violation)
  }
  return {
    preserved: violations.length === 0,
    violations: jsonSafeProjection(violations),
    allowedConsequences: jsonSafeProjection(allowedViolations),
  }
}

function jsonSafeProjection(value: unknown): unknown
{
  if (Array.isArray(value))
    return value.map((entry) => jsonSafeProjection(entry))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, jsonSafeProjection(entry)])
    )
  return value
}

function diagnosticLocationIdentity(
  location: DiagnosticEvidenceLocation,
  lineage: SemanticLineageSnapshot
): unknown
{
  const targetLineages = activeOrderedSemanticLineages(lineage, 'target', null)
  const targetLineage = (targetIndex: number): string | null =>
    targetLineages[targetIndex]?.lineageId ?? null
  if (location.kind === 'project') return { kind: 'project' }
  if (location.kind === 'target')
  {
    const lineageId = targetLineage(location.target.targetIndex)
    return lineageId
      ? { kind: 'target', lineageId }
      : { kind: 'unmapped', location }
  }
  if (location.kind === 'block' || location.kind === 'script')
  {
    const targetIndex =
      location.kind === 'block'
        ? location.block.target.targetIndex
        : location.script.target.targetIndex
    const rawId =
      location.kind === 'block'
        ? location.block.blockId
        : location.script.topBlockId
    const ownerLineageId = targetLineage(targetIndex)
    const kind = location.kind
    const rawIdentity = `${kind}:${rawId}`
    const matches = lineage.records.filter(
      (record) =>
        record.status === 'active' &&
        record.kind === kind &&
        record.ownerLineageId === ownerLineageId &&
        record.rawIdentity === rawIdentity
    )
    return matches.length === 1
      ? { kind, lineageId: matches[0]!.lineageId }
      : { kind: 'unmapped', location }
  }
  if (location.kind === 'declaration')
  {
    const declaration = location.declaration
    const ownerLineageId = targetLineage(
      declaration.declarationTarget.targetIndex
    )
    const rawIdentity = `${declaration.kind}:${declaration.id}`
    const matches = lineage.records.filter(
      (record) =>
        record.status === 'active' &&
        record.kind === 'declaration' &&
        record.ownerLineageId === ownerLineageId &&
        record.rawIdentity === rawIdentity
    )
    return matches.length === 1
      ? { kind: 'declaration', lineageId: matches[0]!.lineageId }
      : { kind: 'unmapped', location }
  }
  if (location.kind === 'asset')
  {
    const matches = lineage.records.filter(
      (record) =>
        record.status === 'active' &&
        record.kind === 'asset' &&
        record.rawIdentity === `asset:${location.path}`
    )
    return matches.length === 1
      ? { kind: 'asset', lineageId: matches[0]!.lineageId }
      : { kind: 'unmapped', location }
  }
  if (location.kind === 'monitor')
  {
    const prefix = `monitor:${location.id}:`
    const matches = lineage.records.filter(
      (record) =>
        record.status === 'active' &&
        record.kind === 'monitor' &&
        record.rawIdentity.startsWith(prefix)
    )
    return matches.length === 1
      ? { kind: 'monitor', lineageId: matches[0]!.lineageId }
      : { kind: 'unmapped', location }
  }
  return { kind: 'unresolvedTarget', name: location.name }
}

function diagnosticIdentity(
  diagnostic: DiagnosticFailure,
  lineage: SemanticLineageSnapshot
): string
{
  const locations = diagnostic.locations
    .map((location) => diagnosticLocationIdentity(location, lineage))
    .sort((left, right) =>
    {
      const leftHash = editCanonicalSha256V1(left)
      const rightHash = editCanonicalSha256V1(right)
      return leftHash === rightHash ? 0 : leftHash < rightHash ? -1 : 1
    })
  return editCanonicalSha256V1({
    source: diagnostic.source,
    code: diagnostic.code,
    locations,
  })
}

const DIAGNOSTIC_SEVERITY_RANK = {
  info: 0,
  warning: 1,
  error: 2,
} as const

function diagnosticAdditions(
  before: readonly DiagnosticFailure[],
  after: readonly DiagnosticFailure[],
  beforeLineage: SemanticLineageSnapshot,
  afterLineage: SemanticLineageSnapshot
): readonly DiagnosticFailure[]
{
  const remaining = new Map<string, number[]>()
  for (const entry of before)
  {
    const identity = diagnosticIdentity(entry, beforeLineage)
    const severities = remaining.get(identity) ?? []
    severities.push(DIAGNOSTIC_SEVERITY_RANK[entry.severity])
    severities.sort((left, right) => right - left)
    remaining.set(identity, severities)
  }
  const additions: DiagnosticFailure[] = []
  const orderedAfter = after.map((diagnostic) => ({
    diagnostic,
    identity: diagnosticIdentity(diagnostic, afterLineage),
    severityRank: DIAGNOSTIC_SEVERITY_RANK[diagnostic.severity],
  }))
  orderedAfter.sort(
    (left, right) =>
      right.severityRank - left.severityRank ||
      left.identity.localeCompare(right.identity)
  )
  for (const entry of orderedAfter)
  {
    const severities = remaining.get(entry.identity) ?? []
    const candidateSeverity = entry.severityRank
    const retainedIndex = severities.findIndex(
      (severity) => severity >= candidateSeverity
    )
    if (retainedIndex >= 0) severities.splice(retainedIndex, 1)
    else additions.push(entry.diagnostic)
  }
  return Object.freeze(additions)
}

export function mergeProductionLineageHistoryV1(
  history: SemanticLineageSnapshot,
  active: SemanticLineageSnapshot
): SemanticLineageSnapshot
{
  const validatedHistory = validateSemanticLineageSnapshot(history)
  const validatedActive = validateSemanticLineageSnapshot(active)
  const activeById = new Map(
    validatedActive.records.map((record) => [record.lineageId, record])
  )
  const historyIds = new Set(
    validatedHistory.records.map((record) => record.lineageId)
  )
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: [
      ...validatedHistory.records.map((record) =>
      {
        const current = activeById.get(record.lineageId)
        return current
          ? {
              ...record,
              status: current.status,
              canonicalOrdinal: current.canonicalOrdinal,
            }
          : record
      }),
      ...validatedActive.records.filter(
        (record) => !historyIds.has(record.lineageId)
      ),
    ],
  })
}

function dispatcherMap(
  dispatchers: readonly ProductionOperationDispatcherV1[]
): ReadonlyMap<
  SemanticEditOperationV1['kind'],
  ProductionOperationDispatcherV1
>
{
  const map = new Map<
    SemanticEditOperationV1['kind'],
    ProductionOperationDispatcherV1
  >()
  for (const dispatcher of dispatchers)
  {
    for (const kind of dispatcher.operationKinds)
    {
      if (map.has(kind))
        fail('edit.internal_invariant', `duplicate dispatcher for ${kind}`)
      map.set(kind, dispatcher)
    }
  }
  return map
}

function planningFact(
  destination: string,
  valueKind: OperationPlanningFactValueV1['valueKind'],
  value: unknown
): EditOperationPlanningFactV1
{
  return {
    destination,
    value: { valueKind, value } as OperationPlanningFactValueV1,
  }
}

function targetRenamePlanningCompletionV1(
  input: EditTransactionInputV1,
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  referenceIndex: SemanticReferenceIndex,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: 'target.renameSprite' }
  >
): EditOperationPlanningResultV1
{
  const selected = resolveTargetRefV1(project, goal.target, {
    activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
    resolveHandle: (reference, evidence) =>
      resolveHandleTarget(
        input,
        reference,
        evidence,
        activeLineage,
        project.json.targets.length
      ),
    resolveCreated: () => null,
  })
  const target = project.json.targets[selected.targetIndex]
  if (!target)
    return fail('edit.selector_no_match', 'planning target is absent')
  const inbound = targetInboundReferenceSetV1(
    project,
    referenceIndex,
    selected.targetIndex
  )
  const activation = targetProspectiveNameActivationV1(
    project,
    referenceIndex,
    goal.newName
  )
  const operation: Extract<
    SemanticEditOperationV1,
    { readonly kind: 'target.renameSprite' }
  > = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    expectedName: targetExpectedStringIdentityV1(target.name),
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  }
  const planningFactSetSha256 = productionTargetPlanningFactSetSha256IndexedV1(
    project,
    operation,
    selected.targetIndex,
    activeLineage,
    referenceIndex
  )
  return Object.freeze({
    operationKind: goal.kind,
    planningFactSetSha256,
    facts: Object.freeze([
      planningFact(
        '/expectedPlanningFactSetSha256',
        'sha256',
        planningFactSetSha256
      ),
      planningFact('/expectedName', 'stringIdentity', operation.expectedName),
      planningFact(
        '/expectedInboundReferenceSetSha256',
        'sha256',
        operation.expectedInboundReferenceSetSha256
      ),
      planningFact(
        '/newNameActivation',
        'nameActivation',
        operation.newNameActivation
      ),
    ]),
  })
}

function targetRemainingPlanningCompletionV1(
  input: EditTransactionInputV1,
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  referenceIndex: SemanticReferenceIndex,
  goal: Extract<
    SemanticEditOperationGoalV1,
    {
      readonly kind:
        | 'target.reorderSprite'
        | 'target.removeSprite'
        | 'target.setSpriteProperties'
        | 'target.setStageProperties'
    }
  >
): EditOperationPlanningResultV1
{
  const selected = resolveTargetRefV1(project, goal.target, {
    activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
    resolveHandle: (reference, evidence) =>
      resolveHandleTarget(
        input,
        reference,
        evidence,
        activeLineage,
        project.json.targets.length
      ),
    resolveCreated: () => null,
  })
  const target = project.json.targets[selected.targetIndex]
  if (!target)
    return fail('edit.selector_no_match', 'planning target is absent')
  let operation: TargetOperationV1
  let facts: readonly EditOperationPlanningFactV1[]
  if (goal.kind === 'target.reorderSprite')
  {
    const order = targetDualOrderSnapshotV1(project.json, activeLineage)
    operation = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedVisualLayerOrdinal: target.layerOrder!,
      expectedVisualLayerOrderSha256: order.visualLayerOrderSha256,
    }
    facts = Object.freeze([
      planningFact(
        '/expectedVisualLayerOrdinal',
        'integer',
        operation.expectedVisualLayerOrdinal
      ),
      planningFact(
        '/expectedVisualLayerOrderSha256',
        'sha256',
        operation.expectedVisualLayerOrderSha256
      ),
    ])
  }
  else if (goal.kind === 'target.removeSprite')
  {
    const inbound = targetInboundReferenceSetV1(
      project,
      referenceIndex,
      selected.targetIndex
    )
    const order = targetDualOrderSnapshotV1(project.json, activeLineage)
    operation = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
      requireFinalInboundReferenceCount: 0,
      expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(target),
      expectedSerializedTargetOrderSha256: order.serializedTargetOrderSha256,
      expectedVisualLayerOrderSha256: order.visualLayerOrderSha256,
    }
    facts = Object.freeze([
      planningFact(
        '/expectedInboundReferenceSetSha256',
        'sha256',
        operation.expectedInboundReferenceSetSha256
      ),
      planningFact(
        '/requireFinalInboundReferenceCount',
        'integer',
        operation.requireFinalInboundReferenceCount
      ),
      planningFact(
        '/expectedOwnedSurfaceSha256',
        'sha256',
        operation.expectedOwnedSurfaceSha256
      ),
      planningFact(
        '/expectedSerializedTargetOrderSha256',
        'sha256',
        operation.expectedSerializedTargetOrderSha256
      ),
      planningFact(
        '/expectedVisualLayerOrderSha256',
        'sha256',
        operation.expectedVisualLayerOrderSha256
      ),
    ])
  }
  else
  {
    const edits = goal.edits.map((edit) =>
    {
      const descriptor = Object.getOwnPropertyDescriptor(target, edit.property)
      const expected =
        descriptor?.enumerable === true && 'value' in descriptor
          ? { state: 'value' as const, value: descriptor.value }
          : { state: 'missing' as const }
      return { ...edit, expected }
    })
    operation = {
      ...goal,
      edits,
      expectedPlanningFactSetSha256: '0'.repeat(64),
    } as TargetOperationV1
    facts = Object.freeze(
      edits.map((edit) =>
        planningFact(
          '/edits/*/expected',
          goal.kind === 'target.setSpriteProperties'
            ? 'spritePropertyExpected'
            : 'stagePropertyExpected',
          edit.expected
        )
      )
    )
  }
  const planningFactSetSha256 = productionTargetPlanningFactSetSha256IndexedV1(
    project,
    operation,
    selected.targetIndex,
    activeLineage,
    referenceIndex
  )
  return Object.freeze({
    operationKind: goal.kind,
    planningFactSetSha256,
    facts: Object.freeze([
      planningFact(
        '/expectedPlanningFactSetSha256',
        'sha256',
        planningFactSetSha256
      ),
      ...facts,
    ]),
  })
}

export class ProductionTransactionExecutorV1 implements EditTransactionExecutorV1
{
  readonly #dispatchers: ReadonlyMap<
    SemanticEditOperationV1['kind'],
    ProductionOperationDispatcherV1
  >

  constructor(
    dispatchers: readonly ProductionOperationDispatcherV1[] = [
      new TargetProductionOperationDispatcherV1(),
      ...targetProductionOperationDispatchersV1(),
      ...scriptBlockProductionOperationDispatchersV1(),
      ...procedureProductionOperationDispatchersV1(),
      ...mediaTargetProductionOperationDispatchersV1(),
    ]
  )
  {
    this.#dispatchers = dispatcherMap(dispatchers)
  }

  #applyOperationPrefix(
    input: EditTransactionInputV1,
    operations: readonly SemanticEditOperationV1[],
    source: ProjectIR,
    current: ProjectIR,
    contract: EditSemanticChangeContractV1,
    beforeActiveLineage: SemanticLineageSnapshot,
    preBatchReferenceIndex: SemanticReferenceIndex
  ): AppliedProductionPrefixV1
  {
    const sourceLineage = buildSourceLineageV1(
      source,
      input.semanticSourceSha256
    ).active
    const resolveOwnerLineageId = existingBindingOwnerLineageResolverV1(
      source,
      contract,
      sourceLineage
    )
    let activeLineage = beforeActiveLineage
    let lineageHistory = validateSemanticLineageSnapshot(
      input.currentRevision.lineageHistory as SemanticLineageSnapshot
    )
    let futureBindingLedger = productionFutureBindingLedgerV1(
      input,
      contract,
      resolveOwnerLineageId
    )
    const beforeFutureBindingLedger = futureBindingLedger
    const addedFutureBindingRealizations: FutureBindingRealizationV1[] = []
    const cloned = cloneCandidate(current, input.currentRevision.allocatorState)
    const operationResultsById = new Map<string, unknown>()
    const applied: AppliedProductionOperationV1[] = []
    let nonAuthorableProcedureSurfaceSha256 =
      nonAuthorableProcedureSurfaceSha256V1(current)
    for (const operation of operations)
    {
      const dispatcher = this.#dispatchers.get(operation.kind)
      if (!dispatcher)
        return fail(
          'edit.unsupported_operation',
          `production dispatcher is unavailable for ${operation.kind}`,
          { opId: operation.opId }
        )
      const dispatched = (() =>
      {
        try
        {
          const context: IndexedProductionOperationContextV1 = {
            input,
            source,
            preBatch: current,
            candidate: cloned.project,
            contract,
            operationResultsById,
            preBatchLineage: beforeActiveLineage,
            activeLineage,
            futureBindingLedger,
            [preBatchReferenceIndexKey]: preBatchReferenceIndex,
          }
          return dispatcher.execute(context, operation)
        }
        catch (error)
        {
          return failOperationRefusalV1(error, operation)
        }
      })()
      const priorLineageHistory = lineageHistory
      const nextNonAuthorableProcedureSurfaceSha256 =
        nonAuthorableProcedureSurfaceSha256V1(cloned.project)
      if (
        nextNonAuthorableProcedureSurfaceSha256 !==
        nonAuthorableProcedureSurfaceSha256
      )
        return fail(
          'edit.protected_change',
          'operation changed a non-authorable procedure surface',
          { opId: operation.opId, semanticSurface: 'procedure' }
        )
      nonAuthorableProcedureSurfaceSha256 =
        nextNonAuthorableProcedureSurfaceSha256
      activeLineage = dispatched.activeLineage
      lineageHistory = mergeProductionLineageHistoryV1(
        lineageHistory,
        activeLineage
      )
      const priorRealizationHashes = new Set(
        futureBindingLedger.realizations.map(
          (realization) => realization.resultCorrespondenceSha256
        )
      )
      const occurrenceId = editOperationOccurrenceIdV1(
        input.acceptedHistorySha256,
        operation.opId
      )
      futureBindingLedger = advanceProductionFutureBindingLedgerV1({
        ledger: futureBindingLedger,
        changeContractSha256: input.changeContractSha256,
        contract,
        priorLineageHistory,
        lineageHistory,
        creatorOperationOccurrenceId: occurrenceId,
        predecessorAcceptedHistorySha256: input.acceptedHistorySha256,
        creatorOperationId: operation.opId,
        creatorOperationKind: operation.kind,
        candidates: dispatched.futureBindingRealizationCandidates ?? [],
        resolveOwnerLineageId,
      })
      addedFutureBindingRealizations.push(
        ...futureBindingLedger.realizations.filter(
          (realization) =>
            !priorRealizationHashes.has(realization.resultCorrespondenceSha256)
        )
      )
      operationResultsById.set(operation.opId, dispatched.result)
      applied.push({
        operation,
        occurrenceId,
        ...dispatched,
      })
    }
    return Object.freeze({
      sourceLineage,
      resolveOwnerLineageId,
      beforeActiveLineage,
      activeLineage,
      lineageHistory,
      beforeFutureBindingLedger,
      futureBindingLedger,
      addedFutureBindingRealizations: Object.freeze([
        ...addedFutureBindingRealizations,
      ]),
      candidate: cloned.project,
      allocator: cloned.allocator,
      operationResultsById,
      applied: Object.freeze([...applied]),
    })
  }

  async planOperation(
    input: EditTransactionInputV1,
    request: EditOperationPlanningRequestV1
  ): Promise<EditOperationPlanningResultV1>
  {
    const goal = (() =>
    {
      const parsed = parseContractDefinitionV1<SemanticEditOperationGoalV1>(
        'SemanticEditOperationGoalV1',
        request.goal
      )
      if (!parsed.ok)
        return fail(
          'edit.schema_failed',
          `operation goal failed ${parsed.issues.length} exact schema check(s)`,
          { opId: request.goal.opId }
        )
      return parsed.value
    })()
    const prefix = request.plannedPrefix.map((operation) =>
    {
      const parsed = parseContractDefinitionV1<SemanticEditOperationV1>(
        'SemanticEditOperationV1',
        operation
      )
      if (!parsed.ok)
        return fail(
          'edit.schema_failed',
          `planned operation failed ${parsed.issues.length} exact schema check(s)`,
          { opId: operation.opId }
        )
      return parsed.value
    })
    assertOperationOrder([...prefix, goal as SemanticEditOperationV1])
    const [sourcePreflight, currentPreflight] = await Promise.all([
      inspectSemanticEditArtifact(input.sourceBytes),
      inspectSemanticEditArtifact(input.currentBytes),
    ])
    const contract = parsedContract(input.changeContract)
    assertInputIdentities(input, sourcePreflight, currentPreflight, contract)
    const source = asProject(sourcePreflight, 'source')
    const current = asProject(currentPreflight, 'current candidate')
    const currentReferenceIndex = currentPreflight.referenceIndex!
    const preBatchLineage = validateSemanticLineageSnapshot(
      input.currentRevision.activeLineage as SemanticLineageSnapshot
    )
    let candidate = current
    let activeLineage = preBatchLineage
    let operationResultsById = new Map<string, unknown>()
    let futureBindingLedger = authorizationFutureBindingLedgerV1(
      input.currentRevision.authorization
    )
    if (prefix.length > 0)
    {
      const appliedPrefix = this.#applyOperationPrefix(
        input,
        prefix,
        source,
        current,
        contract,
        preBatchLineage,
        currentReferenceIndex
      )
      candidate = appliedPrefix.candidate
      activeLineage = appliedPrefix.activeLineage
      operationResultsById = new Map(appliedPrefix.operationResultsById)
      futureBindingLedger = appliedPrefix.futureBindingLedger
    }
    const context: ProductionOperationContextV1 = {
      input,
      source,
      preBatch: current,
      candidate,
      contract,
      operationResultsById,
      preBatchLineage,
      activeLineage,
      futureBindingLedger,
    }
    if (request.planningStage === 'enumerateChoices')
      return Object.freeze({
        operationKind: goal.kind,
        planningFactSetSha256: '0'.repeat(64),
        facts: Object.freeze([]),
        choiceSlots:
          goal.kind === 'procedure.updateSignature'
            ? productionProcedureUpdateSignatureChoiceSlotsV1(context, goal)
            : Object.freeze([]),
      })
    if (goal.kind === 'target.renameSprite')
    {
      try
      {
        return targetRenamePlanningCompletionV1(
          input,
          current,
          preBatchLineage,
          currentReferenceIndex,
          goal
        )
      }
      catch (error)
      {
        return failOperationRefusalV1(error, goal as SemanticEditOperationV1)
      }
    }
    if (
      goal.kind === 'target.reorderSprite' ||
      goal.kind === 'target.removeSprite' ||
      goal.kind === 'target.setSpriteProperties' ||
      goal.kind === 'target.setStageProperties'
    )
    {
      try
      {
        return targetRemainingPlanningCompletionV1(
          input,
          current,
          preBatchLineage,
          currentReferenceIndex,
          goal
        )
      }
      catch (error)
      {
        return failOperationRefusalV1(error, goal as SemanticEditOperationV1)
      }
    }
    if (goal.kind === 'target.addSprite')
    {
      const completed = productionMediaTargetSpritePlanningCompletionV1(
        context,
        goal
      )
      return Object.freeze({
        operationKind: goal.kind,
        planningFactSetSha256: completed.planningFactSetSha256,
        facts: Object.freeze([
          planningFact(
            '/expectedPlanningFactSetSha256',
            'sha256',
            completed.planningFactSetSha256
          ),
          planningFact(
            '/nameActivation',
            'nameActivation',
            completed.operation.nameActivation
          ),
        ]),
      })
    }
    if (goal.kind === 'media.addCostume')
    {
      const completed = productionMediaTargetAddCostumePlanningCompletionV1(
        context,
        goal
      )
      return Object.freeze({
        operationKind: goal.kind,
        planningFactSetSha256: completed.planningFactSetSha256,
        facts: Object.freeze([
          planningFact(
            '/expectedPlanningFactSetSha256',
            'sha256',
            completed.planningFactSetSha256
          ),
          planningFact(
            '/nameActivation',
            'nameActivation',
            completed.operation.nameActivation
          ),
          planningFact(
            '/expectedCostumeOrderSha256',
            'sha256',
            completed.operation.expectedCostumeOrderSha256
          ),
          planningFact(
            '/currentSelection',
            'costumeSelection',
            completed.operation.currentSelection
          ),
          planningFact(
            '/expectedFinalCurrentCostumeState',
            'existingOptionalNumber',
            completed.operation.expectedFinalCurrentCostumeState
          ),
        ]),
      })
    }
    if (goal.kind.startsWith('media.'))
      return productionMediaTargetMediaPlanningCompletionV1(
        context,
        goal as Extract<
          SemanticEditOperationGoalV1,
          { readonly kind: `media.${string}` }
        >
      )
    if (goal.kind.startsWith('declaration.'))
      return productionDeclarationPlanningCompletionV1(
        context,
        goal as Extract<
          SemanticEditOperationGoalV1,
          { readonly kind: `declaration.${string}` }
        >
      )
    if (goal.kind.startsWith('comment.'))
      return productionCommentPlanningCompletionV1(
        context,
        goal as Extract<
          SemanticEditOperationGoalV1,
          { readonly kind: `comment.${string}` }
        >
      )
    if (goal.kind === 'script.moveWorkspace')
      return productionScriptWorkspacePlanningCompletionV1(context, goal)
    if (
      goal.kind === 'script.add' ||
      goal.kind === 'block.insertBefore' ||
      goal.kind === 'block.insertAfter' ||
      goal.kind === 'block.insertSubstack' ||
      goal.kind === 'block.setField'
    )
      return productionScriptBlockPlanningCompletionV1(context, goal)
    if (
      goal.kind === 'script.duplicate' ||
      goal.kind === 'script.remove' ||
      goal.kind === 'block.replace' ||
      goal.kind === 'block.move' ||
      goal.kind === 'block.remove' ||
      goal.kind === 'block.setInput'
    )
      return productionScriptBlockChoicePlanningCompletionV1(
        context,
        goal,
        request.choices
      )
    if (
      goal.kind === 'procedure.add' ||
      goal.kind === 'procedure.setCallArgument' ||
      goal.kind === 'procedure.remove'
    )
      return productionProcedureSimplePlanningCompletionV1(
        context,
        goal,
        request.choices
      )
    if (goal.kind === 'procedure.updateSignature')
      return productionProcedureUpdateSignaturePlanningCompletionV1(
        context,
        goal,
        request.choices
      )
    return fail(
      'edit.planning_facts_unavailable',
      `production planning completion is unavailable for ${goal.kind}`,
      { opId: goal.opId }
    )
  }

  async execute(
    input: EditTransactionInputV1
  ): Promise<EditTransactionExecutionPlanV1>
  {
    const batch = parsedBatch(input.canonicalTransaction)
    assertExactHead(input, batch)
    assertOperationOrder(batch.operations)
    const contract = parsedContract(input.changeContract)
    const [sourcePreflight, currentPreflight] = await Promise.all([
      inspectSemanticEditArtifact(input.sourceBytes),
      inspectSemanticEditArtifact(input.currentBytes),
    ])
    assertInputIdentities(input, sourcePreflight, currentPreflight, contract)
    const source = asProject(sourcePreflight, 'source')
    const current = asProject(currentPreflight, 'current candidate')
    const currentReferenceIndex = currentPreflight.referenceIndex!
    const beforeActiveLineage = validateSemanticLineageSnapshot(
      input.currentRevision.activeLineage as SemanticLineageSnapshot
    )
    const conflictProof = productionConflictProofWithIndexV1(
      input,
      current,
      beforeActiveLineage,
      batch.operations,
      currentReferenceIndex
    )
    const prefix = this.#applyOperationPrefix(
      input,
      batch.operations,
      source,
      current,
      contract,
      beforeActiveLineage,
      currentReferenceIndex
    )
    const {
      sourceLineage,
      resolveOwnerLineageId,
      activeLineage,
      lineageHistory,
      beforeFutureBindingLedger,
      futureBindingLedger,
      addedFutureBindingRealizations,
      candidate,
      allocator,
      applied: preliminaryApplied,
    } = prefix
    // a sprite created in this batch must also have gained a costume in it: the
    // batch, not the operation, is the atomic unit that has to close well-formed
    const createdTargetLineageIds = new Set(
      preliminaryApplied.flatMap((operation) =>
      {
        if (operation.operation.kind !== 'target.addSprite') return []
        const slots =
          (
            operation.result as {
              readonly fixedSlots?: readonly Record<string, unknown>[]
            }
          ).fixedSlots ?? []
        return slots.flatMap((slot) =>
          slot['entityKind'] === 'target' &&
          typeof slot['lineageId'] === 'string'
            ? [slot['lineageId']]
            : []
        )
      })
    )
    assertCreatedTargetsAreCostumedV1(
      candidate,
      activeOrderedSemanticLineages(activeLineage, 'target', null).flatMap(
        (record, targetIndex) =>
          createdTargetLineageIds.has(record.lineageId) ? [targetIndex] : []
      )
    )
    const canonicalTransaction: SemanticEditBatchV1 = {
      schemaVersion: 1,
      expected: batch.expected,
      operations: Object.freeze(
        preliminaryApplied.map((operation) => operation.canonicalOperation)
      ),
    }
    const candidateBytes = await packSb3(
      JSON.stringify(candidate.toProjectJson()),
      candidate.assets
    )
    const candidateSha256 = sha256Hex(candidateBytes)
    if (candidateSha256 === input.currentHead.candidateSha256)
      return fail(
        'edit.internal_invariant',
        'applied operation batch reproduced the current candidate'
      )
    const candidatePreflight = await inspectSemanticEditArtifact(candidateBytes)
    const checkedCandidate = asProject(candidatePreflight, 'candidate')
    const applied = Object.freeze(
      preliminaryApplied.map((operation) =>
        Object.freeze({
          ...operation,
          result: reconcileOperationResultWithFinalHead(
            checkedCandidate,
            activeLineage,
            operation.result
          ),
        })
      )
    )
    const newGraph = diagnosticAdditions(
      currentPreflight.graph,
      candidatePreflight.graph,
      beforeActiveLineage,
      activeLineage
    )
    const newStatic = diagnosticAdditions(
      currentPreflight.static,
      candidatePreflight.static,
      beforeActiveLineage,
      activeLineage
    )
    if (newGraph.length > 0)
      return fail('edit.graph_failed', 'candidate introduced graph diagnostics')
    if (newStatic.length > 0)
      return fail(
        'edit.static_regression',
        'candidate introduced static diagnostics',
        {},
        Object.freeze({
          schemaVersion: 1 as const,
          kind: 'edit-static-regression-evidence-v1' as const,
          sessionId: input.sessionId,
          currentHead: Object.freeze(structuredClone(input.currentHead)),
          rejectedCandidateSha256: candidateSha256,
          rejectedCandidateByteLength: candidateBytes.byteLength,
          newStaticSha256: editCanonicalSha256V1(newStatic),
          newStatic: Object.freeze(structuredClone(newStatic)),
        })
      )
    const attribution = applied.map((operation) => ({
      ...operation.attribution,
      operationId: operation.occurrenceId,
    }))
    const parentCorrespondence = productionProjectCorrespondenceV1(
      input.currentHead.revisionId,
      candidateSha256,
      input.semanticSourceSha256,
      current,
      checkedCandidate,
      beforeActiveLineage,
      activeLineage
    )
    const cumulativeCorrespondence = productionProjectCorrespondenceV1(
      input.sourceArtifactSha256,
      candidateSha256,
      input.semanticSourceSha256,
      source,
      checkedCandidate,
      sourceLineage,
      activeLineage
    )
    const parentDelta = productionComputeCorrespondedDeltaV1(
      current,
      checkedCandidate,
      attribution,
      parentCorrespondence,
      beforeActiveLineage,
      activeLineage
    )
    const cumulativeDelta = composeCumulativeProjectDeltaAttributionV1(
      input.currentRevision.cumulativeDelta as ProjectDelta,
      parentDelta,
      productionComputeCorrespondedDeltaV1(
        source,
        checkedCandidate,
        attribution,
        cumulativeCorrespondence,
        sourceLineage,
        activeLineage
      )
    )
    assertMeaningfulDelta(parentDelta)
    assertEveryOperationHasAttributedEffect(parentDelta, applied)
    const contractAuthorization = assertContractDeltaAuthorization(
      contract,
      source,
      checkedCandidate,
      activeLineage,
      futureBindingLedger,
      parentDelta,
      cumulativeDelta,
      applied,
      input.currentRevision.authorization
    )
    const envelopes = authorizationEnvelopes(parentDelta, applied)
    const deltaAuthorization = authorizeEditDelta(parentDelta, envelopes)
    if (!deltaAuthorization.authorized)
      return fail(
        'edit.unauthorized_change',
        `exact delta authorization failed with ${deltaAuthorization.violations.length} violation(s)`
      )
    const authorization = {
      ...deltaAuthorization,
      contractAuthorization,
      conflictProof,
      futureBindingLedger,
    }
    const preservation = preservationResult(
      current,
      checkedCandidate,
      applied,
      parentDelta
    ) as {
      preserved: boolean
      violations: readonly { code?: string; path?: string }[]
    }
    if (!preservation.preserved)
      return fail(
        'edit.protected_change',
        `candidate changed a protected surface: ${preservation.violations
          .map((violation) => `${violation.code} at ${violation.path}`)
          .join(', ')}`
      )
    allocator.acceptReservations()
    const planningFactProjections = applied.map(
      (operation) => operation.planningFactProjection
    )
    const operationResults = applied.map((operation) => operation.result)
    const assetMaterializationUsage = combineAssetMaterializationUsageDeltasV1(
      applied.map(
        (operation) =>
          operation.assetMaterializationUsage ??
          EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1
      )
    )
    const runtimeProjectionAuthorizations =
      compileEditRuntimeProjectionAuthorizationsV1({
        source,
        candidate: checkedCandidate,
        sourceLineage,
        candidateLineage: activeLineage,
        prior: input.currentRevision.runtimeProjectionAuthorizations,
        acceptedOperations: applied.map((operation) => ({
          operation: operation.canonicalOperation,
          selectedEntityLineageIds: operation.selectedEntityLineageIds,
        })),
      })
    const resolvedSemanticBatchSha256 = semanticHashV1(
      'resolved-semantic-batch',
      {
        schemaVersion: 1,
        expectedRevision: exactRevisionFromHeadV1(input.currentHead),
        planningFactSetSha256: semanticHashV1('resolved-plan', {
          kind: 'group-c-ordered-planning-fact-set',
          schemaVersion: 1,
          projections: planningFactProjections,
        }),
        resolvedOperations: applied.map((entry) => ({
          opId: entry.operation.opId,
          operationKind: entry.operation.kind,
          canonicalOperationSha256: editCanonicalSha256V1(
            entry.canonicalOperation
          ),
          selectedScopeSha256: editCanonicalSha256V1(entry.selectedScope),
          planningFactSha256: semanticHashV1(
            'resolved-plan',
            entry.planningFactProjection
          ),
        })),
        resultBindingSetSha256: editCanonicalSha256V1(operationResults),
        conflictProofSha256: conflictProof.proofSha256,
      }
    )
    validateFutureBindingLedgerV1(
      futureBindingLedger,
      contract,
      lineageHistory,
      resolveOwnerLineageId
    )
    const futureBindingLedgerTransition = {
      beforeLedgerSha256: futureBindingLedgerSha256V1(
        beforeFutureBindingLedger
      ),
      addedRealizations: Object.freeze(
        [...addedFutureBindingRealizations].sort((left, right) =>
          left.bindingKeySha256.localeCompare(right.bindingKeySha256)
        )
      ),
      afterLedgerSha256: futureBindingLedgerSha256V1(futureBindingLedger),
    }
    const operationEffectMappingSha256 = editCanonicalSha256V1(attribution)
    const resolvedPlanSha256 = semanticHashV1('resolved-plan', {
      schemaVersion: 1,
      resolvedSemanticBatchSha256,
      predecessorAcceptedHistorySha256: input.acceptedHistorySha256,
      dependencyOrderSha256: editCanonicalSha256V1(
        canonicalTransaction.operations.map((operation) => operation.opId)
      ),
      conflictProofSha256: conflictProof.proofSha256,
      operationEffectMappingSha256,
      assetMaterializationUsageSha256: editCanonicalSha256V1(
        assetMaterializationUsage
      ),
      futureBindingLedgerTransition,
      parentDeltaSha256: editCanonicalSha256V1(parentDelta),
      cumulativeDeltaSha256: editCanonicalSha256V1(cumulativeDelta),
      authorizationProjectionSha256: editCanonicalSha256V1(authorization),
      preservationProjectionSha256: editCanonicalSha256V1(preservation),
      diagnosticProjectionSha256: editCanonicalSha256V1({
        newGraph,
        newStatic,
      }),
      allocatorProjectionSha256: editCanonicalSha256V1(allocator.snapshot()),
      lineageProjectionSha256: editCanonicalSha256V1({
        activeLineage,
        lineageHistory,
      }),
      candidateProjectionSha256: editCanonicalSha256V1({
        candidateSha256,
        projectJsonSha256:
          candidatePreflight.semanticSourceIdentity!.projectJsonSha256,
        assetManifestSha256:
          candidatePreflight.semanticSourceIdentity!.assetManifestSha256,
      }),
    })
    return {
      candidateBytes,
      candidateProjectJsonSha256:
        candidatePreflight.semanticSourceIdentity!.projectJsonSha256,
      candidateAssetManifestSha256:
        candidatePreflight.semanticSourceIdentity!.assetManifestSha256,
      canonicalTransaction,
      operationCount: canonicalTransaction.operations.length,
      transition: {
        transitionKind: 'apply',
        resolvedSemanticBatchSha256,
        resolvedPlanSha256,
        predecessorHistorySha256: input.acceptedHistorySha256,
        operationEffectMappingSha256,
      },
      resolvedSemanticBatchSha256,
      resolvedPlanSha256,
      parentDelta,
      cumulativeDelta,
      preservation,
      authorization,
      diagnostics: {
        status: 'passed',
        graph: candidatePreflight.graph,
        static: candidatePreflight.static,
        newGraph,
        newStatic,
      },
      allocatorState: allocator.snapshot(),
      activeLineage,
      lineageHistory,
      operationResults,
      operationResultSummaries: projectOperationResultSummariesV1(
        checkedCandidate,
        activeLineage,
        parentDelta,
        applied
      ),
      runtimeProjectionAuthorizations,
      assetMaterializationUsage,
      operationResultLineageCorrespondenceSha256: editCanonicalSha256V1({
        correspondences: applied.map(
          (operation) => operation.correspondence ?? null
        ),
        futureBindingLedgerTransition,
      }),
    }
  }
}
