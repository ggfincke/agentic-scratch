// packages/edit/src/dispatch/group-c-dispatchers.ts
// production declaration, comment, & workspace-only script operation dispatch

import type { DeltaOperationAttribution, ProjectIR } from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  applyCommentOperationV1,
  applyResolvedDeclarationOperationV1,
  applyScriptWorkspaceOperationV1,
  assertSameTargetBlockV1,
  assertSameTargetCommentBlockV1,
  blockBoundedLocationProjectionV1,
  blockEntityEvidenceSetV1,
  boundedDisplayStringV1,
  broadcastRuntimeCollisionEvidenceV1,
  buildSemanticReferenceIndex,
  canonicalProcedureSignatureV1,
  commentBoundedLocationProjectionV1,
  groupCCommentCreationContentFingerprintV1,
  groupCDeclarationCreationContentFingerprintV1,
  commentEntityEvidenceSetV1,
  commentMapStateV1,
  commentTextSha256V1,
  declarationBoundedLocationProjectionV1,
  declarationEntityEvidenceSetV1,
  declarationItemsFingerprintV1,
  declarationNameActivationEvidenceV1,
  declarationReferenceEvidenceV1,
  declarationValueFingerprintV1,
  expectedDeclarationNameIdentityV1,
  mediaReferenceEvidenceV1,
  optionalCollectionContainerStateV1,
  ownRecordValue,
  procedureEntityEvidenceSetV1,
  resolveBlockRefV1,
  resolveCommentRefV1,
  resolveDeclarationRefV1,
  resolveMediaRefV1,
  resolveScriptRefV1,
  resolveTargetRefV1,
  scriptBoundedLocationProjectionV1,
  scriptEntityEvidenceSetV1,
  semanticEntityMovePositionSha256V1,
  semanticHashV1,
  targetInboundReferenceSetV1,
  targetEntityEvidenceSetV1,
  SEMANTIC_LINEAGE_VERSION_V1,
  validateSemanticLineageSnapshot,
  type BlockEntityEvidenceV1,
  type BlockRefV1,
  type BoundedDisplayStringV1,
  type BoundedSemanticLocationProjectionV1,
  type CommentEntityEvidenceV1,
  type CommentOperationV1,
  type CommentRefV1,
  type ContractEntityBindingV1,
  type ContractScopeV1,
  type CostumeSelectionPreconditionV1,
  type DeclarationEntityEvidenceV1,
  type DeclarationRefV1,
  type EditSemanticChangeContractV1,
  type GroupCEntityResolverAdaptersV1,
  type MediaRecordEntityEvidenceV1,
  type MediaRefV1,
  type ProcedureRefV1,
  type ResolvedDeclarationOperationV1,
  type ScriptEntityEvidenceV1,
  type ScriptRefV1,
  type SemanticEditOperationGoalV1,
  type SemanticEditOperationScriptMoveWorkspaceV1,
  type SemanticEditOperationV1,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
  type SemanticReferenceIndex,
  type TargetEntityEvidenceV1,
  type TargetOperationV1,
  type TargetRefV1,
} from '@scratch-agent/ir/edit'
import { isBlockEntry } from '@scratch-agent/sb3'

import type {
  ProductionOperationContextV1,
  ProductionOperationDispatcherV1,
  ProductionOperationDispatchResultV1,
  ProductionStructuralAuthorizationV1,
} from '../transaction/production-transaction.js'
import {
  blockPlanningProjectionV1 as planningBlockProjection,
  createProductionLineageV1,
  completedPlanningFactV1,
  dispatcherUniqueSortedV1,
  exactCommentRefV1 as exactCommentRef,
  exactDeclarationRefV1 as exactDeclarationRef,
  productionOperationResultV1,
  targetPlanningProjectionV1 as planningTargetProjection,
} from './dispatcher-primitives.js'
import { futureBindingKeySha256V1 } from '../lineage/future-binding-ledger.js'
import { editJsonPointerPartV1 } from '../support/internal-values.js'
import type { CreatedSemanticLineageV1 } from '../lineage/lineage.js'
import type {
  EditOperationPlanningFactV1,
  EditOperationPlanningResultV1,
  EditTransactionInputV1,
} from '../transaction/transaction.js'

type DeclarationOperationV1 = Extract<
  SemanticEditOperationV1,
  { kind: `declaration.${string}` }
>

type GroupEOperationV1 = Extract<
  SemanticEditOperationV1,
  { kind: `procedure.${string}` }
>

type GroupFOperationV1 = Extract<
  SemanticEditOperationV1,
  { kind: `media.${string}` }
>

type ExistingContractBindingV1 = Extract<
  ContractEntityBindingV1,
  { bindingKind: 'existing' }
>

type FutureContractBindingV1 = Extract<
  ContractEntityBindingV1,
  { bindingKind: 'future' }
>

type ProductionFixedResultSlotNameV1 =
  | 'declaration'
  | 'comment'
  | 'script'
  | 'definitionScript'
  | 'rootBlock'
  | 'destinationScript'
  | 'sourceGapRootBlock'
  | 'procedure'
  | 'media'
  | 'target'

type ProductionResultEntityKindV1 =
  | 'declaration'
  | 'comment'
  | 'script'
  | 'block'
  | 'procedure'
  | 'parameter'
  | 'media'
  | 'target'

type ProductionResultEntitySubtypeV1 =
  | 'variable'
  | 'list'
  | 'broadcast'
  | 'unspecialized'
  | 'costume'
  | 'sound'
  | 'sprite'

export interface GroupCProductionResultSlotV1
{
  readonly slotKind: 'fixed'
  readonly name: ProductionFixedResultSlotNameV1
  readonly entityKind: ProductionResultEntityKindV1
  readonly entitySubtype: ProductionResultEntitySubtypeV1
  readonly lineageId: string
  // a created sprite is owned by the project rather than by another entity, so
  // this is the one result slot whose owner is genuinely absent
  readonly ownerLineageId: string | null
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
}

export interface ProductionDynamicBlockResultSlotV1
{
  readonly slotKind: 'fixed' | 'blockAlias' | 'cloneAlias'
  readonly alias?: string
  readonly name?: 'rootBlock' | 'sourceGapRootBlock' | 'destinationScript'
  readonly entityKind: 'block' | 'script'
  readonly entitySubtype: 'unspecialized'
  readonly lineageId: string
  readonly ownerLineageId: string
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
}

export interface GroupCProductionOperationResultV1
{
  readonly opId: string
  readonly operationKind: SemanticEditOperationV1['kind']
  readonly selectedLineageIds: readonly string[]
  readonly fixedSlots: readonly GroupCProductionResultSlotV1[]
  readonly dynamicSlots?: readonly ProductionDynamicBlockResultSlotV1[]
  readonly postconditionSha256: string
}

export interface GroupCPlanningEntityProjectionV1
{
  readonly entityKind:
    | 'target'
    | 'declaration'
    | 'comment'
    | 'block'
    | 'script'
    | 'procedure'
    | 'parameter'
    | 'media'
  readonly entitySubtype:
    | 'stage'
    | 'sprite'
    | 'variable'
    | 'list'
    | 'broadcast'
    | 'unspecialized'
    | 'costume'
    | 'sound'
  readonly boundedLocation: BoundedSemanticLocationProjectionV1
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
}

interface GroupCDeclarationPlanningFactProjectionV1
{
  readonly kind: 'group-c-declaration-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: DeclarationOperationV1['kind']
  readonly opId: string
  readonly selectedTarget?: GroupCPlanningEntityProjectionV1
  readonly selectedDeclaration?: GroupCPlanningEntityProjectionV1
  readonly selectedLineageIds: readonly string[]
  readonly facts: unknown
}

interface GroupCCommentPlanningFactProjectionV1
{
  readonly kind: 'group-c-comment-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: CommentOperationV1['kind']
  readonly opId: string
  readonly selectedTarget?: GroupCPlanningEntityProjectionV1
  readonly selectedComment?: GroupCPlanningEntityProjectionV1
  readonly selectedBlock?: GroupCPlanningEntityProjectionV1
  readonly selectedLineageIds: readonly string[]
  readonly facts: unknown
}

interface GroupCScriptWorkspacePlanningFactProjectionV1
{
  readonly kind: 'group-c-script-workspace-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: 'script.moveWorkspace'
  readonly opId: string
  readonly selectedScript: GroupCPlanningEntityProjectionV1
  readonly selectedLineageIds: readonly string[]
  readonly facts: unknown
}

interface GroupCConflictOperationProjectionV1
{
  readonly opId: string
  readonly operationKind: SemanticEditOperationV1['kind']
  readonly dependencies: readonly string[]
  readonly reads: readonly string[]
  readonly writes: readonly string[]
  readonly deletes: readonly string[]
  readonly createdDependencyResources: readonly string[]
  // the selection leaf this operation only reconciled as a consequence, & the
  // one it wrote as the caller's explicit instruction
  readonly reconciledSelectionResources: readonly string[]
  readonly authoritativeSelectionResources: readonly string[]
}

interface GroupCConflictDecisionV1
{
  readonly leftOpId: string
  readonly rightOpId: string
  readonly decision:
    'compatible' | 'created-dependency' | 'superseded-selection'
  readonly overlappingResources: readonly string[]
  readonly exemptCreatedDependencyResources: readonly string[]
}

interface GroupCConflictProofV1
{
  readonly kind: 'group-c-operation-conflict-proof'
  readonly schemaVersion: 1
  readonly operations: readonly GroupCConflictOperationProjectionV1[]
  readonly pairwiseDecisions: readonly GroupCConflictDecisionV1[]
  readonly proofSha256: string
}

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {}
): never
{
  throw Object.assign(new Error(message), { code, context })
}

function planningDeclarationProjection(
  evidence: DeclarationEntityEvidenceV1
): GroupCPlanningEntityProjectionV1
{
  return {
    entityKind: 'declaration',
    entitySubtype: evidence.declarationKind,
    boundedLocation: declarationBoundedLocationProjectionV1(
      evidence,
      `declaration-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

function planningCommentProjection(
  evidence: CommentEntityEvidenceV1
): GroupCPlanningEntityProjectionV1
{
  return {
    entityKind: 'comment',
    entitySubtype: 'unspecialized',
    boundedLocation: commentBoundedLocationProjectionV1(
      evidence,
      `comment-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

function planningScriptProjection(
  evidence: ScriptEntityEvidenceV1
): GroupCPlanningEntityProjectionV1
{
  return {
    entityKind: 'script',
    entitySubtype: 'unspecialized',
    boundedLocation: scriptBoundedLocationProjectionV1(
      evidence,
      `script-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

export const pointerPart = editJsonPointerPartV1

export function uniqueSorted(values: readonly string[]): readonly string[]
{
  return dispatcherUniqueSortedV1(values)
}

function containsCreatedReference(value: unknown): boolean
{
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsCreatedReference)
  const record = value as Record<string, unknown>
  if (record.refKind === 'created') return true
  return Object.values(record).some(containsCreatedReference)
}

export function planningContext(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationV1
): ProductionOperationContextV1
{
  return containsCreatedReference(operation)
    ? context
    : {
        ...context,
        candidate: context.preBatch,
        activeLineage: context.preBatchLineage,
      }
}

export function targetLineageAt(
  lineage: SemanticLineageSnapshot,
  targetCount: number,
  targetIndex: number
): SemanticLineageRecord
{
  const targets = activeOrderedSemanticLineages(lineage, 'target', null)
  const selected = targets[targetIndex]
  if (targets.length !== targetCount || !selected)
    return fail(
      'edit.internal_invariant',
      'target lineage does not correspond to the candidate'
    )
  return selected
}

// media lineage rows carry their source ordinal inside `rawIdentity` forever, so
// the maintained pointer is `canonicalOrdinal` & every lookup here is positional
export function mediaLineageAt(
  lineage: SemanticLineageSnapshot,
  mediaKind: 'costume' | 'sound',
  ownerLineageId: string,
  ordinal: number
): SemanticLineageRecord
{
  const ordered = activeOrderedSemanticLineages(
    lineage,
    mediaKind,
    ownerLineageId
  )
  const selected = ordered[ordinal]
  if (!selected)
    return fail(
      'edit.internal_invariant',
      `active ${mediaKind} lineage has no ordinal ${ordinal}`
    )
  return selected
}

export function entityLineageIn(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  kind: 'declaration' | 'comment' | 'script' | 'block' | 'procedure',
  targetIndex: number,
  rawIdentity: string
): SemanticLineageRecord
{
  const owner = targetLineageAt(
    lineage,
    project.json.targets.length,
    targetIndex
  )
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === kind &&
      record.ownerLineageId === owner.lineageId &&
      record.rawIdentity === rawIdentity
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      `${kind} evidence does not have one active lineage`
    )
  return matches[0]!
}

function entityLineage(
  context: ProductionOperationContextV1,
  kind: 'declaration' | 'comment' | 'script' | 'block',
  targetIndex: number,
  rawIdentity: string
): SemanticLineageRecord
{
  return entityLineageIn(
    context.candidate,
    context.activeLineage,
    kind,
    targetIndex,
    rawIdentity
  )
}

function declarationLineage(
  context: ProductionOperationContextV1,
  evidence: DeclarationEntityEvidenceV1
): SemanticLineageRecord
{
  return entityLineage(
    context,
    'declaration',
    evidence.targetIndex,
    `${evidence.declarationKind}:${evidence.declarationId}`
  )
}

function commentLineage(
  context: ProductionOperationContextV1,
  evidence: CommentEntityEvidenceV1
): SemanticLineageRecord
{
  return entityLineage(
    context,
    'comment',
    evidence.targetIndex,
    `comment:${evidence.commentId}`
  )
}

function scriptLineage(
  context: ProductionOperationContextV1,
  evidence: ScriptEntityEvidenceV1
): SemanticLineageRecord
{
  return entityLineage(
    context,
    'script',
    evidence.targetIndex,
    `script:${evidence.topBlockId}`
  )
}

function blockLineage(
  context: ProductionOperationContextV1,
  evidence: BlockEntityEvidenceV1
): SemanticLineageRecord
{
  return entityLineage(
    context,
    'block',
    evidence.targetIndex,
    `block:${evidence.blockId}`
  )
}

function verifyHandleIndex<
  T extends {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
  },
>(
  context: ProductionOperationContextV1,
  reference: { readonly token: string },
  evidence: readonly T[],
  entityKind: string,
  subtype: (candidate: T) => string,
  lineageSha256: (candidate: T) => string
): number | null
{
  if (!context.input.verifyHandle) return null
  const matches = evidence.flatMap((candidate, index) =>
    context.input.verifyHandle!({
      token: reference.token,
      entityKind,
      entitySubtype: subtype(candidate),
      lineageSha256: lineageSha256(candidate),
      semanticLocationSha256: candidate.semanticLocationSha256,
      semanticFingerprintSha256: candidate.semanticFingerprintSha256,
    })
      ? [index]
      : []
  )
  if (matches.length > 1)
    return fail(
      'edit.internal_invariant',
      `${entityKind} handle matched more than one entity`
    )
  return matches[0] ?? null
}

function groupCResult(
  context: ProductionOperationContextV1,
  opId: string
): GroupCProductionOperationResultV1
{
  const value = context.operationResultsById.get(opId)
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as Partial<GroupCProductionOperationResultV1>).opId !== opId ||
    !Array.isArray(
      (value as Partial<GroupCProductionOperationResultV1>).fixedSlots
    )
  )
    return fail(
      'edit.created_result_invalid',
      `created-result producer ${opId} has no compatible result ledger`
    )
  return value as GroupCProductionOperationResultV1
}

function createdSlot(
  context: ProductionOperationContextV1,
  reference: {
    readonly opId: string
    readonly slot: { readonly slotKind: string; readonly name?: string }
  },
  entityKind: ProductionResultEntityKindV1,
  name: ProductionFixedResultSlotNameV1
): GroupCProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
{
  if (reference.slot.slotKind !== 'fixed' || reference.slot.name !== name)
    return fail(
      'edit.created_result_invalid',
      `created ${entityKind} reference uses an invalid result slot`
    )
  const result = groupCResult(context, reference.opId)
  const slots = [...result.fixedSlots, ...(result.dynamicSlots ?? [])].filter(
    (slot) =>
      slot.slotKind === 'fixed' &&
      slot.entityKind === entityKind &&
      slot.name === name
  )
  if (slots.length !== 1)
    return fail(
      'edit.created_result_invalid',
      `created ${entityKind} result slot is absent or ambiguous`
    )
  return slots[0]!
}

function createdDynamicBlockSlot(
  context: ProductionOperationContextV1,
  reference: {
    readonly opId: string
    readonly slot: {
      readonly slotKind: string
      readonly alias?: string
    }
  }
): ProductionDynamicBlockResultSlotV1
{
  const slotKind = reference.slot.slotKind
  if (
    (slotKind !== 'blockAlias' && slotKind !== 'cloneAlias') ||
    typeof reference.slot.alias !== 'string'
  )
    return fail(
      'edit.created_result_invalid',
      'created block reference uses an invalid dynamic result slot'
    )
  const result = groupCResult(context, reference.opId)
  const slots = (result.dynamicSlots ?? []).filter(
    (slot) =>
      slot.entityKind === 'block' &&
      slot.slotKind === slotKind &&
      slot.alias === reference.slot.alias
  )
  if (slots.length !== 1)
    return fail(
      'edit.created_result_invalid',
      'created block dynamic result slot is absent or ambiguous'
    )
  return slots[0]!
}

function declarationEvidenceLineageId(
  context: ProductionOperationContextV1,
  evidence: DeclarationEntityEvidenceV1
): string
{
  return declarationLineage(context, evidence).lineageId
}

function commentEvidenceLineageId(
  context: ProductionOperationContextV1,
  evidence: CommentEntityEvidenceV1
): string
{
  return commentLineage(context, evidence).lineageId
}

function scriptEvidenceLineageId(
  context: ProductionOperationContextV1,
  evidence: ScriptEntityEvidenceV1
): string
{
  return scriptLineage(context, evidence).lineageId
}

function blockEvidenceLineageId(
  context: ProductionOperationContextV1,
  evidence: BlockEntityEvidenceV1
): string
{
  return blockLineage(context, evidence).lineageId
}

export function resolverAdapters(
  context: ProductionOperationContextV1
): GroupCEntityResolverAdaptersV1
{
  return {
    activeMatchCandidateLimit:
      context.input.resourceLimits.activeMatchCandidates,
    target: {
      activeMatchCandidateLimit:
        context.input.resourceLimits.activeMatchCandidates,
      resolveHandle: (reference, evidence) =>
        verifyHandleIndex(
          context,
          reference,
          evidence,
          'target',
          (candidate) => candidate.targetKind,
          (candidate) =>
            targetLineageAt(
              context.preBatchLineage,
              context.preBatch.json.targets.length,
              candidate.targetIndex
            ).lineageId
        ),
      resolveCreated: () => null,
    },
    resolveDeclarationHandle: (reference, evidence) =>
      verifyHandleIndex(
        context,
        reference,
        evidence,
        'declaration',
        (candidate) => candidate.declarationKind,
        (candidate) =>
          entityLineageIn(
            context.preBatch,
            context.preBatchLineage,
            'declaration',
            candidate.targetIndex,
            `${candidate.declarationKind}:${candidate.declarationId}`
          ).lineageId
      ),
    resolveDeclarationCreated: (reference, evidence) =>
    {
      const slot = createdSlot(context, reference, 'declaration', 'declaration')
      const matches = evidence.flatMap((candidate, index) =>
        declarationEvidenceLineageId(context, candidate) === slot.lineageId
          ? [index]
          : []
      )
      return matches.length === 1 ? matches[0]! : null
    },
    resolveCommentHandle: (reference, evidence) =>
      verifyHandleIndex(
        context,
        reference,
        evidence,
        'comment',
        () => 'unspecialized',
        (candidate) =>
          entityLineageIn(
            context.preBatch,
            context.preBatchLineage,
            'comment',
            candidate.targetIndex,
            `comment:${candidate.commentId}`
          ).lineageId
      ),
    resolveCommentCreated: (reference, evidence) =>
    {
      const slot = createdSlot(context, reference, 'comment', 'comment')
      const matches = evidence.flatMap((candidate, index) =>
        commentEvidenceLineageId(context, candidate) === slot.lineageId
          ? [index]
          : []
      )
      return matches.length === 1 ? matches[0]! : null
    },
    resolveScriptHandle: (reference, evidence) =>
      verifyHandleIndex(
        context,
        reference,
        evidence,
        'script',
        () => 'unspecialized',
        (candidate) =>
          entityLineageIn(
            context.preBatch,
            context.preBatchLineage,
            'script',
            candidate.targetIndex,
            `script:${candidate.topBlockId}`
          ).lineageId
      ),
    resolveScriptCreated: (reference, evidence) =>
    {
      const slot = createdSlot(
        context,
        reference,
        'script',
        reference.slot.name
      )
      const matches = evidence.flatMap((candidate, index) =>
        scriptEvidenceLineageId(context, candidate) === slot.lineageId
          ? [index]
          : []
      )
      return matches.length === 1 ? matches[0]! : null
    },
    resolveBlockHandle: (reference, evidence) =>
      verifyHandleIndex(
        context,
        reference,
        evidence,
        'block',
        () => 'unspecialized',
        (candidate) =>
          entityLineageIn(
            context.preBatch,
            context.preBatchLineage,
            'block',
            candidate.targetIndex,
            `block:${candidate.blockId}`
          ).lineageId
      ),
    resolveBlockCreated: (reference, evidence) =>
    {
      const slot =
        reference.slot.slotKind === 'fixed'
          ? createdSlot(context, reference, 'block', reference.slot.name)
          : createdDynamicBlockSlot(context, reference)
      const matches = evidence.flatMap((candidate, index) =>
        blockEvidenceLineageId(context, candidate) === slot.lineageId
          ? [index]
          : []
      )
      return matches.length === 1 ? matches[0]! : null
    },
  }
}

function priorCreatedSlotForLineage(
  context: ProductionOperationContextV1,
  entityKind: ProductionResultEntityKindV1,
  lineageId: string
): GroupCProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1 | null
{
  const matches: (
    GroupCProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
  )[] = []
  for (const value of context.operationResultsById.values())
  {
    if (value === null || typeof value !== 'object') continue
    const slots = (value as Partial<GroupCProductionOperationResultV1>)
      .fixedSlots
    if (!Array.isArray(slots)) continue
    matches.push(
      ...slots.filter(
        (slot) => slot.entityKind === entityKind && slot.lineageId === lineageId
      )
    )
    const dynamicSlots = (value as Partial<GroupCProductionOperationResultV1>)
      .dynamicSlots
    if (Array.isArray(dynamicSlots))
      matches.push(
        ...dynamicSlots.filter(
          (slot) =>
            slot.entityKind === entityKind && slot.lineageId === lineageId
        )
      )
  }
  if (matches.length > 1)
    return fail(
      'edit.internal_invariant',
      `created ${entityKind} lineage has multiple result slots`
    )
  return matches[0] ?? null
}

function currentTargetForPreBatchEvidence(
  context: ProductionOperationContextV1,
  selected: TargetEntityEvidenceV1
): TargetEntityEvidenceV1
{
  const lineageId = targetLineageAt(
    context.preBatchLineage,
    context.preBatch.json.targets.length,
    selected.targetIndex
  ).lineageId
  const currentTargets = activeOrderedSemanticLineages(
    context.activeLineage,
    'target',
    null
  )
  const currentIndex = currentTargets.findIndex(
    (record) => record.lineageId === lineageId
  )
  const current = targetEntityEvidenceSetV1(context.candidate.json)[
    currentIndex
  ]
  if (!current)
    return fail(
      'edit.invalid_owner',
      'pre-batch target was removed before this operation'
    )
  return current
}

interface ResolvedTargetSelectionV1
{
  readonly canonical: TargetEntityEvidenceV1
  readonly current: TargetEntityEvidenceV1
  readonly lineageId: string
}

// a created target ref names exactly one fixed `target` slot of a prior operation;
// anything else is a malformed result rather than a resolvable reference
function priorResultTargetSlot(
  context: ProductionOperationContextV1,
  opId: string
): string
{
  const prior = context.operationResultsById.get(opId) as
    { readonly fixedSlots?: readonly Record<string, unknown>[] } | undefined
  const slots = (prior?.fixedSlots ?? []).filter(
    (slot) =>
      slot['slotKind'] === 'fixed' &&
      slot['name'] === 'target' &&
      slot['entityKind'] === 'target'
  )
  const lineageId = slots.length === 1 ? slots[0]!['lineageId'] : undefined
  if (typeof lineageId !== 'string')
    return fail(
      'edit.created_result_invalid',
      `target created ref does not name one target result of ${opId}`
    )
  return lineageId
}

export function resolveTargetSelection(
  context: ProductionOperationContextV1,
  reference: TargetRefV1
): ResolvedTargetSelectionV1
{
  // a created target has no pre-batch evidence to canonicalize against, so it is
  // resolved entirely against the running lineage. this is the cross-family seam:
  // a Group F media creation may scope to a sprite this same batch just created
  if (reference.refKind === 'created')
  {
    const lineageId = priorResultTargetSlot(context, reference.opId)
    const targetIndex = activeOrderedSemanticLineages(
      context.activeLineage,
      'target',
      null
    ).findIndex((record) => record.lineageId === lineageId)
    const current = targetEntityEvidenceSetV1(context.candidate.json)[
      targetIndex
    ]
    if (targetIndex < 0 || !current)
      return fail(
        'edit.created_result_invalid',
        'created target result is absent from the running lineage'
      )
    return { canonical: current, current, lineageId }
  }
  const canonical = resolveTargetRefV1(context.preBatch, reference, {
    activeMatchCandidateLimit:
      context.input.resourceLimits.activeMatchCandidates,
    resolveHandle: (handle, evidence) =>
      verifyHandleIndex(
        context,
        handle,
        evidence,
        'target',
        (candidate) => candidate.targetKind,
        (candidate) =>
          targetLineageAt(
            context.preBatchLineage,
            context.preBatch.json.targets.length,
            candidate.targetIndex
          ).lineageId
      ),
    resolveCreated: () => null,
  })
  const lineageId = targetLineageAt(
    context.preBatchLineage,
    context.preBatch.json.targets.length,
    canonical.targetIndex
  ).lineageId
  return {
    canonical,
    current: currentTargetForPreBatchEvidence(context, canonical),
    lineageId,
  }
}

interface ResolvedDeclarationSelectionV1
{
  readonly canonical: DeclarationEntityEvidenceV1
  readonly current: DeclarationEntityEvidenceV1
  readonly lineageId: string
}

function currentDeclarationForLineage(
  context: ProductionOperationContextV1,
  lineageId: string
): DeclarationEntityEvidenceV1
{
  const matches = declarationEntityEvidenceSetV1(context.candidate).filter(
    (candidate) =>
      declarationLineage(context, candidate).lineageId === lineageId
  )
  if (matches.length !== 1)
    return fail(
      'edit.invalid_owner',
      'selected declaration was removed or became ambiguous before use'
    )
  return matches[0]!
}

function resolveDeclarationSelectionRef(
  context: ProductionOperationContextV1,
  reference: DeclarationRefV1
): ResolvedDeclarationSelectionV1
{
  if (reference.refKind === 'created')
  {
    const current = resolveDeclarationRefV1(
      context.candidate,
      reference,
      resolverAdapters(context)
    )
    const lineageId = declarationLineage(context, current).lineageId
    if (!priorCreatedSlotForLineage(context, 'declaration', lineageId))
      return fail(
        'edit.created_result_invalid',
        'declaration created ref is not backed by a prior typed result'
      )
    return { canonical: current, current, lineageId }
  }
  const canonical = resolveDeclarationRefV1(
    context.preBatch,
    reference,
    resolverAdapters(context)
  )
  const lineageId = entityLineageIn(
    context.preBatch,
    context.preBatchLineage,
    'declaration',
    canonical.targetIndex,
    `${canonical.declarationKind}:${canonical.declarationId}`
  ).lineageId
  return {
    canonical,
    current: currentDeclarationForLineage(context, lineageId),
    lineageId,
  }
}

interface ResolvedCommentSelectionV1
{
  readonly canonical: CommentEntityEvidenceV1
  readonly current: CommentEntityEvidenceV1
  readonly lineageId: string
}

function currentCommentForLineage(
  context: ProductionOperationContextV1,
  lineageId: string
): CommentEntityEvidenceV1
{
  const matches = commentEntityEvidenceSetV1(context.candidate).filter(
    (candidate) => commentLineage(context, candidate).lineageId === lineageId
  )
  if (matches.length !== 1)
    return fail(
      'edit.invalid_owner',
      'selected comment was removed or became ambiguous before use'
    )
  return matches[0]!
}

function resolveCommentSelectionRef(
  context: ProductionOperationContextV1,
  reference: CommentRefV1
): ResolvedCommentSelectionV1
{
  if (reference.refKind === 'created')
  {
    const current = resolveCommentRefV1(
      context.candidate,
      reference,
      resolverAdapters(context)
    )
    const lineageId = commentLineage(context, current).lineageId
    if (!priorCreatedSlotForLineage(context, 'comment', lineageId))
      return fail(
        'edit.created_result_invalid',
        'comment created ref is not backed by a prior typed result'
      )
    return { canonical: current, current, lineageId }
  }
  const canonical = resolveCommentRefV1(
    context.preBatch,
    reference,
    resolverAdapters(context)
  )
  const lineageId = entityLineageIn(
    context.preBatch,
    context.preBatchLineage,
    'comment',
    canonical.targetIndex,
    `comment:${canonical.commentId}`
  ).lineageId
  return {
    canonical,
    current: currentCommentForLineage(context, lineageId),
    lineageId,
  }
}

function currentBlockForPreBatchEvidence(
  context: ProductionOperationContextV1,
  canonical: BlockEntityEvidenceV1
): BlockEntityEvidenceV1
{
  const lineageId = entityLineageIn(
    context.preBatch,
    context.preBatchLineage,
    'block',
    canonical.targetIndex,
    `block:${canonical.blockId}`
  ).lineageId
  const matches = blockEntityEvidenceSetV1(context.candidate).filter(
    (candidate) => blockLineage(context, candidate).lineageId === lineageId
  )
  if (matches.length !== 1)
    return fail(
      'edit.invalid_owner',
      'selected block was removed or became ambiguous before use'
    )
  return matches[0]!
}

export function resolveBlockSelectionRef(
  context: ProductionOperationContextV1,
  reference: BlockRefV1
): {
  readonly canonical: BlockEntityEvidenceV1
  readonly current: BlockEntityEvidenceV1
  readonly lineageId: string
}
{
  if (reference.refKind === 'created')
  {
    const current = resolveBlockRefV1(
      context.candidate,
      reference,
      resolverAdapters(context)
    )
    const lineageId = blockLineage(context, current).lineageId
    if (!priorCreatedSlotForLineage(context, 'block', lineageId))
      return fail(
        'edit.created_result_invalid',
        'block created ref is not backed by a prior typed result'
      )
    return { canonical: current, current, lineageId }
  }
  const canonical = resolveBlockRefV1(
    context.preBatch,
    reference,
    resolverAdapters(context)
  )
  const lineageId = entityLineageIn(
    context.preBatch,
    context.preBatchLineage,
    'block',
    canonical.targetIndex,
    `block:${canonical.blockId}`
  ).lineageId
  return {
    canonical,
    current: currentBlockForPreBatchEvidence(context, canonical),
    lineageId,
  }
}

export function resolveScriptSelectionRef(
  context: ProductionOperationContextV1,
  reference: ScriptRefV1
): {
  readonly canonical: ScriptEntityEvidenceV1
  readonly current: ScriptEntityEvidenceV1
  readonly lineageId: string
}
{
  if (reference.refKind === 'created')
  {
    const current = resolveScriptRefV1(
      context.candidate,
      reference,
      resolverAdapters(context)
    )
    const lineageId = scriptLineage(context, current).lineageId
    if (!priorCreatedSlotForLineage(context, 'script', lineageId))
      return fail(
        'edit.created_result_invalid',
        'script created ref is not backed by a prior typed result'
      )
    return { canonical: current, current, lineageId }
  }
  const canonical = resolveScriptRefV1(
    context.preBatch,
    reference,
    resolverAdapters(context)
  )
  const lineageId = entityLineageIn(
    context.preBatch,
    context.preBatchLineage,
    'script',
    canonical.targetIndex,
    `script:${canonical.topBlockId}`
  ).lineageId
  const matches = scriptEntityEvidenceSetV1(context.candidate).filter(
    (candidate) => scriptLineage(context, candidate).lineageId === lineageId
  )
  if (matches.length !== 1)
    return fail(
      'edit.invalid_owner',
      'selected script was removed or became ambiguous before use'
    )
  return { canonical, current: matches[0]!, lineageId }
}

export function exactTargetRef(evidence: TargetEntityEvidenceV1): TargetRefV1
{
  return {
    entityKind: 'target',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: {
      kind: 'target',
      targetKind: evidence.targetKind,
      name: boundedDisplayStringV1(
        evidence.name
      ) as unknown as BoundedDisplayStringV1,
      serializedTargetOrdinal: evidence.targetIndex,
      semanticFingerprint: evidence.semanticFingerprintSha256,
      fullLocationSha256: evidence.semanticLocationSha256,
      retainedLocationArtifactId: `target-location-${evidence.semanticLocationSha256.slice(0, 32)}`,
      ...(evidence.visualLayerOrdinal === undefined
        ? {}
        : { visualLayerOrdinal: evidence.visualLayerOrdinal }),
    },
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

export function exactBlockRef(evidence: BlockEntityEvidenceV1): BlockRefV1
{
  return {
    entityKind: 'block',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: blockBoundedLocationProjectionV1(
      evidence,
      `block-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

export function exactScriptRef(evidence: ScriptEntityEvidenceV1): ScriptRefV1
{
  return {
    entityKind: 'script',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: scriptBoundedLocationProjectionV1(
      evidence,
      `script-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

function sourceTargetEvidence(
  context: ProductionOperationContextV1,
  current: TargetEntityEvidenceV1
): TargetEntityEvidenceV1 | null
{
  const lineage = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    current.targetIndex
  )
  const match = /^target:(0|[1-9][0-9]*)$/u.exec(lineage.rawIdentity)
  return match
    ? (targetEntityEvidenceSetV1(context.source.json)[Number(match[1])] ?? null)
    : null
}

function sourceEvidenceByLineage<T>(
  context: ProductionOperationContextV1,
  lineage: SemanticLineageRecord,
  evidence: readonly T[],
  rawIdentity: (candidate: T) => string,
  targetIndex: (candidate: T) => number
): T | null
{
  if (lineage.ownerLineageId === null) return null
  const owner = context.activeLineage.records.find(
    (record) => record.lineageId === lineage.ownerLineageId
  )
  const targetMatch = /^target:(0|[1-9][0-9]*)$/u.exec(owner?.rawIdentity ?? '')
  if (!targetMatch) return null
  const sourceTargetIndex = Number(targetMatch[1])
  return (
    evidence.find(
      (candidate) =>
        targetIndex(candidate) === sourceTargetIndex &&
        rawIdentity(candidate) === lineage.rawIdentity
    ) ?? null
  )
}

function exactExistingBinding(
  binding: ContractEntityBindingV1,
  entityKind: string,
  entitySubtype: string,
  evidence: {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
    readonly contextFingerprintSha256: string
  }
): binding is ExistingContractBindingV1
{
  return (
    binding.bindingKind === 'existing' &&
    binding.entityKind === entityKind &&
    binding.entitySubtype === entitySubtype &&
    binding.expectedMatchCount === 1 &&
    binding.sourceLocationSha256 === evidence.semanticLocationSha256 &&
    binding.expectedSourceSemanticFingerprint ===
      evidence.semanticFingerprintSha256 &&
    binding.expectedSourceContextFingerprint ===
      evidence.contextFingerprintSha256
  )
}

export function targetBindingKeys(
  context: ProductionOperationContextV1,
  evidence: TargetEntityEvidenceV1
): readonly string[]
{
  const source = sourceTargetEvidence(context, evidence)
  if (!source) return Object.freeze([])
  return uniqueSorted(
    context.contract.entityBindings.flatMap((binding) =>
      exactExistingBinding(binding, 'target', source.targetKind, source)
        ? [binding.bindingKey]
        : []
    )
  )
}

function existingEntityBindingKeys(
  context: ProductionOperationContextV1,
  entityKind: 'declaration' | 'comment' | 'script' | 'block',
  entitySubtype: 'variable' | 'list' | 'broadcast' | 'unspecialized',
  lineage: SemanticLineageRecord,
  sourceEvidence: {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
    readonly contextFingerprintSha256: string
  } | null
): readonly string[]
{
  if (!sourceEvidence || lineage.status !== 'active') return Object.freeze([])
  return uniqueSorted(
    context.contract.entityBindings.flatMap((binding) =>
      exactExistingBinding(binding, entityKind, entitySubtype, sourceEvidence)
        ? [binding.bindingKey]
        : []
    )
  )
}

function declarationBindingKeys(
  context: ProductionOperationContextV1,
  evidence: DeclarationEntityEvidenceV1
): readonly string[]
{
  const lineage = declarationLineage(context, evidence)
  const source = sourceEvidenceByLineage(
    context,
    lineage,
    declarationEntityEvidenceSetV1(context.source),
    (candidate) => `${candidate.declarationKind}:${candidate.declarationId}`,
    (candidate) => candidate.targetIndex
  )
  const existing = existingEntityBindingKeys(
    context,
    'declaration',
    evidence.declarationKind,
    lineage,
    source
  )
  return uniqueSorted([
    ...existing,
    ...futureBindingKeysForLineage(context, lineage.lineageId),
  ])
}

function commentBindingKeys(
  context: ProductionOperationContextV1,
  evidence: CommentEntityEvidenceV1
): readonly string[]
{
  const lineage = commentLineage(context, evidence)
  const source = sourceEvidenceByLineage(
    context,
    lineage,
    commentEntityEvidenceSetV1(context.source),
    (candidate) => `comment:${candidate.commentId}`,
    (candidate) => candidate.targetIndex
  )
  const existing = existingEntityBindingKeys(
    context,
    'comment',
    'unspecialized',
    lineage,
    source
  )
  return uniqueSorted([
    ...existing,
    ...futureBindingKeysForLineage(context, lineage.lineageId),
  ])
}

export function scriptBindingKeys(
  context: ProductionOperationContextV1,
  evidence: ScriptEntityEvidenceV1
): readonly string[]
{
  const lineage = scriptLineage(context, evidence)
  const source = sourceEvidenceByLineage(
    context,
    lineage,
    scriptEntityEvidenceSetV1(context.source),
    (candidate) => `script:${candidate.topBlockId}`,
    (candidate) => candidate.targetIndex
  )
  return existingEntityBindingKeys(
    context,
    'script',
    'unspecialized',
    lineage,
    source
  )
}

export function blockBindingKeys(
  context: ProductionOperationContextV1,
  evidence: BlockEntityEvidenceV1
): readonly string[]
{
  const lineage = blockLineage(context, evidence)
  const source = sourceEvidenceByLineage(
    context,
    lineage,
    blockEntityEvidenceSetV1(context.source),
    (candidate) => `block:${candidate.blockId}`,
    (candidate) => candidate.targetIndex
  )
  return existingEntityBindingKeys(
    context,
    'block',
    'unspecialized',
    lineage,
    source
  )
}

// media has no rawIdentity-keyed lineage lookup of its own: the caller already
// resolved the source ordinal, so the source record is addressed positionally
export function mediaBindingKeys(
  context: ProductionOperationContextV1,
  sourceEvidence: {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
    readonly contextFingerprintSha256: string
  } | null,
  entitySubtype: 'costume' | 'sound'
): readonly string[]
{
  if (!sourceEvidence) return Object.freeze([])
  return uniqueSorted(
    context.contract.entityBindings.flatMap((binding) =>
      exactExistingBinding(binding, 'media', entitySubtype, sourceEvidence)
        ? [binding.bindingKey]
        : []
    )
  )
}

function futureBindingKeysForLineage(
  context: ProductionOperationContextV1,
  lineageId: string
): readonly string[]
{
  return uniqueSorted(
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
}

function locationBindingKey(
  scope: ContractScopeV1
): { kind: 'existing' | 'future'; key: string } | null
{
  if (
    scope.scopeSubjectKind !== 'entity' ||
    scope.locationScope.scopeKind !== 'exactEntity'
  )
    return null
  return {
    kind: scope.locationScope.entity.contractRefKind,
    key: scope.locationScope.entity.bindingKey,
  }
}

function targetScopeBindingKey(scope: ContractScopeV1): string | null
{
  if (
    scope.scopeSubjectKind !== 'entity' ||
    scope.locationScope.scopeKind !== 'targetAndOwnedDescendants'
  )
    return null
  return scope.locationScope.target.bindingKey
}

function allowedProperties(
  scope: ContractScopeV1,
  surface: 'declaration' | 'comment' | 'script',
  required: readonly string[]
): boolean
{
  if (scope.scopeSubjectKind !== 'entity') return false
  return required.every((property) =>
    scope.allowedPropertyPaths.some(
      (path) =>
        path.surface === surface &&
        'property' in path &&
        path.property === property
    )
  )
}

function selectExactScope(
  contract: EditSemanticChangeContractV1,
  operationKind: SemanticEditOperationV1['kind'],
  entityKind: 'declaration' | 'comment' | 'script',
  entitySubtype: 'variable' | 'list' | 'broadcast' | 'unspecialized',
  requiredProperties: readonly string[],
  entityBindingKeys: readonly string[],
  ownerTargetBindingKeys: readonly string[],
  allowProjectCollection?: 'broadcasts'
): ContractScopeV1
{
  if (!contract.allowedOperationKinds.includes(operationKind))
    return fail(
      'edit.unauthorized_change',
      `change contract does not allow ${operationKind}`
    )
  const candidates = contract.allowedSemanticScopes.filter((scope) =>
  {
    if (
      scope.operationKind !== operationKind ||
      scope.scopeSubjectKind !== 'entity' ||
      scope.entityKind !== entityKind ||
      scope.entitySubtype !== entitySubtype ||
      !allowedProperties(scope, entityKind, requiredProperties)
    )
      return false
    const exact = locationBindingKey(scope)
    if (exact) return entityBindingKeys.includes(exact.key)
    const targetKey = targetScopeBindingKey(scope)
    if (targetKey) return ownerTargetBindingKeys.includes(targetKey)
    return (
      allowProjectCollection !== undefined &&
      scope.locationScope.scopeKind === 'projectEntityCollection' &&
      scope.locationScope.collection === allowProjectCollection
    )
  })
  if (candidates.length === 0)
    return fail(
      'edit.unauthorized_change',
      `change contract has no exact scope for ${operationKind}`
    )
  if (candidates.length > 1)
    return fail(
      'edit.unauthorized_change',
      `change contract has ambiguous scopes for ${operationKind}`
    )
  return candidates[0]!
}

function declarationRequiredProperties(
  operation: DeclarationOperationV1
): readonly string[]
{
  if (operation.kind === 'declaration.addVariable')
    return Object.freeze(['name', 'initialValue'])
  if (operation.kind === 'declaration.addList')
    return Object.freeze(['name', 'initialItems'])
  if (operation.kind === 'declaration.addBroadcast')
    return Object.freeze(['name'])
  if (operation.kind === 'declaration.rename') return Object.freeze(['name'])
  if (operation.kind === 'declaration.setVariableInitialValue')
    return Object.freeze(['initialValue'])
  if (operation.kind === 'declaration.setListInitialItems')
    return Object.freeze(['initialItems'])
  return Object.freeze([])
}

function declarationSubtype(
  operation: DeclarationOperationV1,
  selected?: DeclarationEntityEvidenceV1
): 'variable' | 'list' | 'broadcast'
{
  if (selected) return selected.declarationKind
  if (operation.kind === 'declaration.addVariable') return 'variable'
  if (operation.kind === 'declaration.addList') return 'list'
  if (operation.kind === 'declaration.addBroadcast') return 'broadcast'
  return fail('edit.internal_invariant', 'declaration subtype is unavailable')
}

function commentRequiredProperties(
  operation: CommentOperationV1
): readonly string[]
{
  if (operation.kind === 'comment.add')
    return Object.freeze([
      'text',
      'attachment',
      'x',
      'y',
      'width',
      'height',
      'minimized',
    ])
  if (operation.kind === 'comment.updateText') return Object.freeze(['text'])
  if (operation.kind === 'comment.move')
    return uniqueSorted(operation.edits.map((edit) => edit.property))
  if (
    operation.kind === 'comment.attach' ||
    operation.kind === 'comment.detach'
  )
    return Object.freeze(['attachment'])
  return Object.freeze([])
}

function targetRawRef(evidence: TargetEntityEvidenceV1)
{
  return {
    targetIndex: evidence.targetIndex,
    name: evidence.name,
    isStage: evidence.targetKind === 'stage',
  }
}

function declarationRawValue(
  project: ProjectIR,
  evidence: DeclarationEntityEvidenceV1
): unknown
{
  const owner = project.json.targets[evidence.targetIndex]
  if (evidence.declarationKind === 'variable')
    return ownRecordValue(owner?.variables, evidence.declarationId)
  if (evidence.declarationKind === 'list')
    return ownRecordValue(owner?.lists, evidence.declarationId)
  return ownRecordValue(owner?.broadcasts, evidence.declarationId)
}

function boundedReferenceFacts(
  evidence: ReturnType<typeof declarationReferenceEvidenceV1>
): unknown
{
  return {
    referenceCount: evidence.referenceCount,
    propagatableReferenceCount: evidence.propagatableReferenceCount,
    monitorCount: evidence.monitorCount,
    expectedReferenceSetSha256: evidence.expectedReferenceSetSha256,
    expectedMonitorSetSha256: evidence.expectedMonitorSetSha256,
    hasDynamicReference: evidence.hasDynamicReference,
  }
}

function boundedNameActivationFacts(
  evidence: ReturnType<typeof declarationNameActivationEvidenceV1>
): unknown
{
  return {
    activationCount: evidence.activationCount,
    activationSetSha256: evidence.activationSetSha256,
  }
}

function boundedBroadcastCollisionFacts(
  evidence: ReturnType<typeof broadcastRuntimeCollisionEvidenceV1>
): unknown
{
  return {
    exactCollisionCount: evidence.exactCollisionCount,
    lowercaseCollisionCount: evidence.lowercaseCollisionCount,
    uppercaseHatCollisionCount: evidence.uppercaseHatCollisionCount,
    collisionSetSha256: evidence.collisionSetSha256,
  }
}

function declarationPlanningFacts(
  context: ProductionOperationContextV1,
  operation: DeclarationOperationV1,
  selectedTarget: TargetEntityEvidenceV1 | undefined,
  selectedDeclaration: DeclarationEntityEvidenceV1 | undefined
): unknown
{
  if (operation.kind === 'declaration.addVariable')
  {
    const scope = targetRawRef(selectedTarget!)
    return {
      ownerTargetLineageId: targetLineageAt(
        context.activeLineage,
        context.candidate.json.targets.length,
        selectedTarget!.targetIndex
      ).lineageId,
      nameActivation: boundedNameActivationFacts(
        declarationNameActivationEvidenceV1(
          context.candidate,
          'variable',
          scope,
          operation.name
        )
      ),
    }
  }
  if (operation.kind === 'declaration.addList')
  {
    const owner = context.candidate.json.targets[selectedTarget!.targetIndex]!
    const scope = targetRawRef(selectedTarget!)
    return {
      ownerTargetLineageId: targetLineageAt(
        context.activeLineage,
        context.candidate.json.targets.length,
        selectedTarget!.targetIndex
      ).lineageId,
      nameActivation: boundedNameActivationFacts(
        declarationNameActivationEvidenceV1(
          context.candidate,
          'list',
          scope,
          operation.name
        )
      ),
      listMapState: optionalCollectionContainerStateV1(owner.lists),
    }
  }
  if (operation.kind === 'declaration.addBroadcast')
  {
    const stageIndex = context.candidate.json.targets.findIndex(
      (target) => target.isStage
    )
    const stage = context.candidate.json.targets[stageIndex]
    if (!stage || stageIndex < 0)
      return fail('edit.project_constraint', 'project has no unique stage')
    return {
      stageTargetLineageId: targetLineageAt(
        context.activeLineage,
        context.candidate.json.targets.length,
        stageIndex
      ).lineageId,
      nameActivation: boundedNameActivationFacts(
        declarationNameActivationEvidenceV1(
          context.candidate,
          'broadcast',
          null,
          operation.name
        )
      ),
      collision: boundedBroadcastCollisionFacts(
        broadcastRuntimeCollisionEvidenceV1(context.candidate, operation.name)
      ),
      broadcastMapState: optionalCollectionContainerStateV1(stage.broadcasts),
    }
  }
  const selected = selectedDeclaration!
  const raw = declarationRawValue(context.candidate, selected)
  const references = declarationReferenceEvidenceV1(
    context.candidate,
    selected.rawRef
  )
  if (operation.kind === 'declaration.rename')
    return {
      currentName: selected.location.name,
      references: boundedReferenceFacts(references),
      newNameActivation: boundedNameActivationFacts(
        declarationNameActivationEvidenceV1(
          context.candidate,
          selected.declarationKind,
          selected.declarationKind === 'broadcast'
            ? null
            : selected.rawRef.declarationTarget,
          operation.newName,
          selected.rawRef
        )
      ),
      broadcastCollision:
        selected.declarationKind === 'broadcast'
          ? boundedBroadcastCollisionFacts(
              broadcastRuntimeCollisionEvidenceV1(
                context.candidate,
                operation.newName,
                selected.rawRef as Parameters<
                  typeof broadcastRuntimeCollisionEvidenceV1
                >[2]
              )
            )
          : null,
    }
  if (operation.kind === 'declaration.setVariableInitialValue')
  {
    if (!Array.isArray(raw))
      return fail('edit.internal_invariant', 'variable tuple is unavailable')
    return {
      valueFingerprintSha256: declarationValueFingerprintV1(raw[1]),
      references: boundedReferenceFacts(references),
    }
  }
  if (operation.kind === 'declaration.setListInitialItems')
  {
    if (!Array.isArray(raw) || !Array.isArray(raw[1]))
      return fail('edit.internal_invariant', 'list tuple is unavailable')
    return {
      itemsFingerprintSha256: declarationItemsFingerprintV1(raw[1]),
      itemCount: raw[1].length,
      references: boundedReferenceFacts(references),
    }
  }
  return { references: boundedReferenceFacts(references) }
}

function resolveDeclarationSelection(
  context: ProductionOperationContextV1,
  operation: DeclarationOperationV1
): {
  readonly selectedTarget?: TargetEntityEvidenceV1
  readonly canonicalTarget?: TargetEntityEvidenceV1
  readonly selectedDeclaration?: DeclarationEntityEvidenceV1
  readonly canonicalDeclaration?: DeclarationEntityEvidenceV1
  readonly selectedLineageIds: readonly string[]
}
{
  if (
    operation.kind === 'declaration.addVariable' ||
    operation.kind === 'declaration.addList'
  )
  {
    const target = resolveTargetSelection(context, operation.scope)
    return {
      selectedTarget: target.current,
      canonicalTarget: target.canonical,
      selectedLineageIds: Object.freeze([target.lineageId]),
    }
  }
  if (operation.kind === 'declaration.addBroadcast')
  {
    const stageIndex = context.candidate.json.targets.findIndex(
      (target) => target.isStage
    )
    const stageEvidence = targetEntityEvidenceSetV1(context.candidate.json)[
      stageIndex
    ]
    if (!stageEvidence)
      return fail('edit.project_constraint', 'project has no stage')
    return {
      selectedTarget: stageEvidence,
      canonicalTarget: targetEntityEvidenceSetV1(context.preBatch.json)[
        stageIndex
      ],
      selectedLineageIds: Object.freeze([
        targetLineageAt(
          context.activeLineage,
          context.candidate.json.targets.length,
          stageIndex
        ).lineageId,
      ]),
    }
  }
  const declaration = resolveDeclarationSelectionRef(
    context,
    operation.declaration
  )
  return {
    selectedDeclaration: declaration.current,
    canonicalDeclaration: declaration.canonical,
    selectedLineageIds: Object.freeze([declaration.lineageId]),
  }
}

function productionDeclarationPlanningFactProjectionV1(
  context: ProductionOperationContextV1,
  operation: DeclarationOperationV1
): GroupCDeclarationPlanningFactProjectionV1
{
  const selection = resolveDeclarationSelection(context, operation)
  const factsContext = planningContext(context, operation)
  return {
    kind: 'group-c-declaration-planning-fact-set',
    schemaVersion: 1,
    operationKind: operation.kind,
    opId: operation.opId,
    ...(selection.canonicalTarget
      ? { selectedTarget: planningTargetProjection(selection.canonicalTarget) }
      : {}),
    ...(selection.canonicalDeclaration
      ? {
          selectedDeclaration: planningDeclarationProjection(
            selection.canonicalDeclaration
          ),
        }
      : {}),
    selectedLineageIds: selection.selectedLineageIds,
    facts: declarationPlanningFacts(
      factsContext,
      operation,
      selection.canonicalTarget ?? selection.selectedTarget,
      selection.canonicalDeclaration ?? selection.selectedDeclaration
    ),
  }
}

export function productionDeclarationPlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: DeclarationOperationV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionDeclarationPlanningFactProjectionV1(context, operation)
  )
}

export function productionDeclarationPlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: `declaration.${string}` }
  >
): EditOperationPlanningResultV1
{
  let operation: DeclarationOperationV1
  let facts: readonly EditOperationPlanningFactV1[]
  if (
    goal.kind === 'declaration.addVariable' ||
    goal.kind === 'declaration.addList'
  )
  {
    const target = resolveTargetSelection(context, goal.scope)
    const targetRecord =
      context.candidate.json.targets[target.current.targetIndex]
    if (!targetRecord)
      return fail('edit.selector_no_match', 'declaration owner is absent')
    const kind = goal.kind === 'declaration.addVariable' ? 'variable' : 'list'
    const activation = declarationNameActivationEvidenceV1(
      context.candidate,
      kind,
      targetRawRef(target.current),
      goal.name
    )
    const nameActivation = {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0 as const,
    }
    if (goal.kind === 'declaration.addVariable')
    {
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        nameActivation,
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/nameActivation',
          'nameActivation',
          nameActivation
        ),
      ])
    }
    else
    {
      const expectedListMapState = optionalCollectionContainerStateV1(
        targetRecord.lists
      )
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        nameActivation,
        expectedListMapState,
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/nameActivation',
          'nameActivation',
          nameActivation
        ),
        completedPlanningFactV1(
          '/expectedListMapState',
          'containerState',
          expectedListMapState
        ),
      ])
    }
  }
  else if (goal.kind === 'declaration.addBroadcast')
  {
    const stage = context.candidate.json.targets.find(
      (target) => target.isStage
    )
    if (!stage) return fail('edit.project_constraint', 'project has no stage')
    const activation = declarationNameActivationEvidenceV1(
      context.candidate,
      'broadcast',
      null,
      goal.name
    )
    const nameActivation = {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0 as const,
    }
    const expectedStageBroadcastMapState = optionalCollectionContainerStateV1(
      stage.broadcasts
    )
    operation = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      nameActivation,
      expectedStageBroadcastMapState,
    }
    facts = Object.freeze([
      completedPlanningFactV1(
        '/nameActivation',
        'nameActivation',
        nameActivation
      ),
      completedPlanningFactV1(
        '/expectedStageBroadcastMapState',
        'containerState',
        expectedStageBroadcastMapState
      ),
    ])
  }
  else
  {
    const selected = resolveDeclarationSelectionRef(context, goal.declaration)
    const references = declarationReferenceEvidenceV1(
      context.candidate,
      selected.current.rawRef
    )
    if (goal.kind === 'declaration.rename')
    {
      const activation = declarationNameActivationEvidenceV1(
        context.candidate,
        selected.current.declarationKind,
        selected.current.declarationKind === 'broadcast'
          ? null
          : selected.current.rawRef.declarationTarget,
        goal.newName,
        selected.current.rawRef
      )
      const newNameActivation = {
        expectedActivationSetSha256: activation.activationSetSha256,
        requireProspectiveActivationCount: 0 as const,
      }
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedName: expectedDeclarationNameIdentityV1(
          selected.current.rawRef
        ),
        expectedReferenceSetSha256: references.expectedReferenceSetSha256,
        newNameActivation,
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedName',
          'stringIdentity',
          operation.expectedName
        ),
        completedPlanningFactV1(
          '/expectedReferenceSetSha256',
          'sha256',
          operation.expectedReferenceSetSha256
        ),
        completedPlanningFactV1(
          '/newNameActivation',
          'nameActivation',
          newNameActivation
        ),
      ])
    }
    else if (goal.kind === 'declaration.setVariableInitialValue')
    {
      const raw = declarationRawValue(context.candidate, selected.current)
      if (!Array.isArray(raw))
        return fail('edit.internal_invariant', 'variable tuple is absent')
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedValueFingerprintSha256: declarationValueFingerprintV1(raw[1]),
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedValueFingerprintSha256',
          'sha256',
          operation.expectedValueFingerprintSha256
        ),
      ])
    }
    else if (goal.kind === 'declaration.setListInitialItems')
    {
      const raw = declarationRawValue(context.candidate, selected.current)
      if (!Array.isArray(raw) || !Array.isArray(raw[1]))
        return fail('edit.internal_invariant', 'list tuple is absent')
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedItemsSha256: declarationItemsFingerprintV1(raw[1]),
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedItemsSha256',
          'sha256',
          operation.expectedItemsSha256
        ),
      ])
    }
    else
    {
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedReferenceSetSha256: references.expectedReferenceSetSha256,
        expectedMonitorSetSha256: references.expectedMonitorSetSha256,
        requireFinalReferenceCount: 0,
        requireFinalMonitorCount: 0,
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedReferenceSetSha256',
          'sha256',
          operation.expectedReferenceSetSha256
        ),
        completedPlanningFactV1(
          '/expectedMonitorSetSha256',
          'sha256',
          operation.expectedMonitorSetSha256
        ),
        completedPlanningFactV1(
          '/requireFinalReferenceCount',
          'integer',
          operation.requireFinalReferenceCount
        ),
        completedPlanningFactV1(
          '/requireFinalMonitorCount',
          'integer',
          operation.requireFinalMonitorCount
        ),
      ])
    }
  }
  const planningFactSetSha256 = productionDeclarationPlanningFactSetSha256V1(
    context,
    operation
  )
  return Object.freeze({
    operationKind: goal.kind,
    planningFactSetSha256,
    facts: Object.freeze([
      completedPlanningFactV1(
        '/expectedPlanningFactSetSha256',
        'sha256',
        planningFactSetSha256
      ),
      ...facts,
    ]),
  })
}

function declarationCanonicalOperation(
  operation: DeclarationOperationV1,
  selection: ReturnType<typeof resolveDeclarationSelection>
): DeclarationOperationV1
{
  if (
    operation.kind === 'declaration.addVariable' ||
    operation.kind === 'declaration.addList'
  )
    return {
      ...operation,
      scope: exactTargetRef(selection.canonicalTarget!),
    }
  if (operation.kind === 'declaration.addBroadcast') return operation
  if (operation.declaration.refKind === 'created') return operation
  return {
    ...operation,
    declaration: exactDeclarationRef(selection.canonicalDeclaration!),
  } as DeclarationOperationV1
}

function resolvedDeclarationOperation(
  operation: DeclarationOperationV1,
  selection: ReturnType<typeof resolveDeclarationSelection>
): ResolvedDeclarationOperationV1
{
  if (operation.kind === 'declaration.addVariable')
    return {
      ...operation,
      scope: targetRawRef(selection.selectedTarget!),
    }
  if (operation.kind === 'declaration.addList')
    return {
      ...operation,
      scope: targetRawRef(selection.selectedTarget!),
    }
  if (operation.kind === 'declaration.addBroadcast') return operation
  return {
    ...operation,
    declaration: selection.selectedDeclaration!.rawRef,
  } as ResolvedDeclarationOperationV1
}

function futureBindingKeysForCreation(
  context: ProductionOperationContextV1,
  operationKind: SemanticEditOperationV1['kind'],
  entityKind: 'declaration' | 'comment',
  entitySubtype: 'variable' | 'list' | 'broadcast' | 'unspecialized',
  roleName: ProductionFixedResultSlotNameV1,
  ownerBindingKeys: readonly string[],
  creationContentFingerprint: (binding: FutureContractBindingV1) => string
): readonly FutureContractBindingV1[]
{
  const matches = context.contract.entityBindings.filter((binding) =>
  {
    if (
      binding.bindingKind !== 'future' ||
      binding.entityKind !== entityKind ||
      binding.entitySubtype !== entitySubtype ||
      binding.expectedCreatorOperationKind !== operationKind ||
      binding.expectedCreationRole.roleKind !== 'fixed' ||
      binding.expectedCreationRole.name !== roleName
    )
      return false
    if (
      context.futureBindingLedger.realizations.some(
        (realization) =>
          realization.bindingKeySha256 ===
          futureBindingKeySha256V1(
            context.input.changeContractSha256,
            binding.bindingKey
          )
      )
    )
      return false
    const scope = binding.expectedCreationScope
    const scopeMatches =
      scope.scopeKind === 'projectEntityCollection'
        ? operationKind === 'declaration.addBroadcast' &&
          scope.collection === 'broadcasts'
        : scope.scopeKind === 'targetAndOwnedDescendants' &&
          ownerBindingKeys.includes(scope.target.bindingKey)
    return (
      scopeMatches &&
      binding.expectedCreationContentFingerprintSha256 ===
        creationContentFingerprint(binding)
    )
  }) as FutureContractBindingV1[]
  if (matches.length > 1)
    return fail(
      'edit.unauthorized_change',
      `${operationKind} ambiguously matches multiple future bindings`
    )
  if (matches.length === 0)
    return fail(
      'edit.unauthorized_change',
      `${operationKind} requires one exact future entity binding`
    )
  return Object.freeze(matches)
}

function createdLineage(
  context: ProductionOperationContextV1,
  operationId: string,
  kind: 'declaration' | 'comment' | 'script' | 'block',
  ownerLineageId: string,
  rawIdentity: string,
  canonicalOrdinal: number,
  creationKey: string,
  activeLineage: SemanticLineageSnapshot = context.activeLineage
): CreatedSemanticLineageV1
{
  return createProductionLineageV1(
    context,
    operationId,
    kind,
    ownerLineageId,
    rawIdentity,
    canonicalOrdinal,
    creationKey,
    activeLineage
  )
}

export function tombstoneLineage(
  active: SemanticLineageSnapshot,
  lineageId: string
): SemanticLineageSnapshot
{
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: active.records.map((record) =>
      record.lineageId === lineageId
        ? { ...record, status: 'tombstoned' as const }
        : record
    ),
  })
}

function reindexActiveSiblingLineages(
  active: SemanticLineageSnapshot,
  kind: 'declaration' | 'comment',
  ownerLineageId: string,
  orderedRawIdentities: readonly string[],
  rawIdentityPrefix?: string
): SemanticLineageSnapshot
{
  const ordinals = new Map(
    orderedRawIdentities.map((rawIdentity, ordinal) => [rawIdentity, ordinal])
  )
  const siblings = active.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === kind &&
      record.ownerLineageId === ownerLineageId &&
      (rawIdentityPrefix === undefined ||
        record.rawIdentity.startsWith(rawIdentityPrefix))
  )
  if (
    siblings.length !== orderedRawIdentities.length ||
    siblings.some((record) => !ordinals.has(record.rawIdentity))
  )
    return fail(
      'edit.internal_invariant',
      `active ${kind} lineage does not match canonical sibling evidence`
    )
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: active.records.map((record) =>
    {
      if (
        record.status !== 'active' ||
        record.kind !== kind ||
        record.ownerLineageId !== ownerLineageId ||
        (rawIdentityPrefix !== undefined &&
          !record.rawIdentity.startsWith(rawIdentityPrefix))
      )
        return record
      return {
        ...record,
        canonicalOrdinal: ordinals.get(record.rawIdentity)!,
      }
    }),
  })
}

function canonicalDeclarationRawIdentities(
  project: ProjectIR,
  targetIndex: number,
  declarationKind: 'variable' | 'list' | 'broadcast'
): readonly string[]
{
  return Object.freeze(
    declarationEntityEvidenceSetV1(project)
      .filter(
        (evidence) =>
          evidence.targetIndex === targetIndex &&
          evidence.declarationKind === declarationKind
      )
      .map(
        (evidence) => `${evidence.declarationKind}:${evidence.declarationId}`
      )
  )
}

function canonicalCommentRawIdentities(
  project: ProjectIR,
  targetIndex: number
): readonly string[]
{
  return Object.freeze(
    commentEntityEvidenceSetV1(project)
      .filter((evidence) => evidence.targetIndex === targetIndex)
      .map((evidence) => `comment:${evidence.commentId}`)
  )
}

export function operationResult(
  operation: SemanticEditOperationV1,
  selectedLineageIds: readonly string[],
  fixedSlots: readonly GroupCProductionResultSlotV1[],
  effectEvidence: unknown,
  dynamicSlots: readonly ProductionDynamicBlockResultSlotV1[] = []
): GroupCProductionOperationResultV1
{
  return productionOperationResultV1(
    operation,
    selectedLineageIds,
    fixedSlots,
    effectEvidence,
    dynamicSlots
  )
}

function declarationAttribution(
  operationId: string,
  exactPaths: readonly string[],
  pathPrefixes: readonly string[]
): DeltaOperationAttribution
{
  return {
    operationId,
    projectPaths: uniqueSorted(exactPaths),
    pathPrefixes: uniqueSorted(pathPrefixes),
  }
}

function declarationStructuralAuthorization(
  exactPaths: readonly string[],
  pathPrefixes: readonly string[]
): ProductionStructuralAuthorizationV1
{
  return {
    exactPaths: uniqueSorted(exactPaths),
    pathPrefixes: uniqueSorted(pathPrefixes),
  }
}

export class DeclarationProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'declaration.addVariable',
    'declaration.addList',
    'declaration.addBroadcast',
    'declaration.rename',
    'declaration.setVariableInitialValue',
    'declaration.setListInitialItems',
    'declaration.remove',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `declaration dispatcher does not support ${operation.kind}`
      )
    const declarationOperation = operation as DeclarationOperationV1
    const selection = resolveDeclarationSelection(context, declarationOperation)
    const planningFactProjection =
      productionDeclarationPlanningFactProjectionV1(
        context,
        declarationOperation
      )
    if (
      declarationOperation.expectedPlanningFactSetSha256 !==
      semanticHashV1('resolved-plan', planningFactProjection)
    )
      return fail(
        'edit.planning_facts_mismatch',
        `planning facts changed for ${declarationOperation.opId}`
      )
    const selectedDeclaration = selection.selectedDeclaration
    const referenceEvidenceBefore = selectedDeclaration
      ? declarationReferenceEvidenceV1(
          context.candidate,
          selectedDeclaration.rawRef
        )
      : undefined
    const subtype = declarationSubtype(
      declarationOperation,
      selectedDeclaration
    )
    const target =
      selection.selectedTarget ??
      (selectedDeclaration
        ? targetEntityEvidenceSetV1(context.candidate.json)[
            selectedDeclaration.targetIndex
          ]
        : undefined)
    if (!target)
      return fail('edit.internal_invariant', 'declaration owner is absent')
    const ownerBindingKeys = targetBindingKeys(context, target)
    let entityBindingKeys = selectedDeclaration
      ? declarationBindingKeys(context, selectedDeclaration)
      : Object.freeze([] as string[])
    let futureBindings: readonly FutureContractBindingV1[] = Object.freeze([])
    if (
      declarationOperation.kind === 'declaration.addVariable' ||
      declarationOperation.kind === 'declaration.addList' ||
      declarationOperation.kind === 'declaration.addBroadcast'
    )
    {
      futureBindings = futureBindingKeysForCreation(
        context,
        declarationOperation.kind,
        'declaration',
        subtype,
        'declaration',
        ownerBindingKeys,
        (binding) =>
        {
          if (binding.entityKind !== 'declaration')
            return fail(
              'edit.internal_invariant',
              'declaration creation matched a non-declaration binding'
            )
          return groupCDeclarationCreationContentFingerprintV1(
            declarationOperation,
            binding
          )
        }
      )
      entityBindingKeys = Object.freeze(
        futureBindings.map((binding) => binding.bindingKey)
      )
    }
    if (
      declarationOperation.kind === 'declaration.remove' &&
      entityBindingKeys.length === 0
    )
      return fail(
        'edit.unauthorized_change',
        'declaration removal requires one exact entity binding'
      )
    const selectedScope = selectExactScope(
      context.contract,
      declarationOperation.kind,
      'declaration',
      subtype,
      declarationRequiredProperties(declarationOperation),
      entityBindingKeys,
      ownerBindingKeys,
      subtype === 'broadcast' ? 'broadcasts' : undefined
    )
    const canonicalOperation = declarationCanonicalOperation(
      declarationOperation,
      selection
    )
    const selectedLineageId = selectedDeclaration
      ? declarationLineage(context, selectedDeclaration).lineageId
      : null
    const builderResult = applyResolvedDeclarationOperationV1(
      context.candidate,
      resolvedDeclarationOperation(declarationOperation, selection)
    )
    let activeLineage = context.activeLineage
    let fixedSlots: readonly GroupCProductionResultSlotV1[] = Object.freeze([])
    let resultLineageId = selectedLineageId
    let creationProvenance:
      | {
          readonly entitySubtype: 'variable' | 'list' | 'broadcast'
          readonly collisionNonce: number
          readonly creationKey: string
        }
      | undefined
    if (builderResult.createdDeclaration)
    {
      const createdEvidence = declarationEntityEvidenceSetV1(
        context.candidate
      ).find(
        (evidence) =>
          evidence.targetIndex ===
            builderResult.createdDeclaration!.declarationTarget.targetIndex &&
          evidence.declarationKind === builderResult.createdDeclaration!.kind &&
          evidence.declarationId === builderResult.createdDeclaration!.id
      )
      if (!createdEvidence)
        return fail(
          'edit.postcondition_failed',
          'created declaration evidence is absent'
        )
      const ownerLineage = targetLineageAt(
        context.activeLineage,
        context.candidate.json.targets.length,
        createdEvidence.targetIndex
      )
      const canonicalRawIdentities = canonicalDeclarationRawIdentities(
        context.candidate,
        createdEvidence.targetIndex,
        createdEvidence.declarationKind
      )
      const createdRawIdentity = `${createdEvidence.declarationKind}:${createdEvidence.declarationId}`
      const canonicalOrdinal =
        canonicalRawIdentities.indexOf(createdRawIdentity)
      if (canonicalOrdinal < 0)
        return fail(
          'edit.internal_invariant',
          'created declaration is absent from canonical sibling evidence'
        )
      const creationKey = 'fixed:declaration'
      const created = createdLineage(
        context,
        declarationOperation.opId,
        'declaration',
        ownerLineage.lineageId,
        createdRawIdentity,
        canonicalOrdinal,
        creationKey
      )
      creationProvenance = {
        entitySubtype: createdEvidence.declarationKind,
        collisionNonce: created.collisionNonce,
        creationKey: created.creationKey,
      }
      activeLineage = reindexActiveSiblingLineages(
        created.activeLineage,
        'declaration',
        ownerLineage.lineageId,
        canonicalRawIdentities,
        `${createdEvidence.declarationKind}:`
      )
      resultLineageId = created.record.lineageId
      fixedSlots = Object.freeze([
        {
          slotKind: 'fixed',
          name: 'declaration',
          entityKind: 'declaration',
          entitySubtype: createdEvidence.declarationKind,
          lineageId: created.record.lineageId,
          ownerLineageId: ownerLineage.lineageId,
          semanticLocationSha256: createdEvidence.semanticLocationSha256,
          semanticFingerprintSha256: createdEvidence.semanticFingerprintSha256,
          contextFingerprintSha256: createdEvidence.contextFingerprintSha256,
        },
      ])
    }
    else if (
      declarationOperation.kind === 'declaration.remove' &&
      selectedLineageId
    )
    {
      const ownerLineage = targetLineageAt(
        activeLineage,
        context.candidate.json.targets.length,
        selectedDeclaration!.targetIndex
      )
      activeLineage = reindexActiveSiblingLineages(
        tombstoneLineage(activeLineage, selectedLineageId),
        'declaration',
        ownerLineage.lineageId,
        canonicalDeclarationRawIdentities(
          context.candidate,
          selectedDeclaration!.targetIndex,
          selectedDeclaration!.declarationKind
        ),
        `${selectedDeclaration!.declarationKind}:`
      )
    }
    const result = operationResult(
      declarationOperation,
      resultLineageId ? [resultLineageId] : [],
      fixedSlots,
      {
        selectedLineageId,
        resultLineageId,
        exactPaths: builderResult.exactPaths,
        referenceEvidenceAfter: builderResult.referenceEvidenceAfter,
      }
    )
    const subtreePaths =
      declarationOperation.kind === 'declaration.setListInitialItems'
        ? builderResult.exactPaths
        : []
    const exactPaths =
      declarationOperation.kind === 'declaration.setListInitialItems'
        ? []
        : builderResult.exactPaths
    return {
      canonicalOperation,
      selectedScope,
      result,
      attribution: declarationAttribution(
        declarationOperation.opId,
        exactPaths,
        subtreePaths
      ),
      activeLineage,
      planningFactProjection,
      matchedContractBindingKeys: entityBindingKeys,
      selectedEntityLineageIds: result.selectedLineageIds,
      structuralAuthorization: declarationStructuralAuthorization(
        exactPaths,
        subtreePaths
      ),
      ...(resultLineageId && creationProvenance && futureBindings.length > 0
        ? {
            futureBindingRealizationCandidates: Object.freeze(
              futureBindings.map((binding) => ({
                bindingKey: binding.bindingKey,
                createdEntityKind: 'declaration' as const,
                createdEntitySubtype: creationProvenance.entitySubtype,
                collisionNonce: creationProvenance.collisionNonce,
                creationKey: creationProvenance.creationKey,
                resultLineageId,
                ownerLineageId: fixedSlots[0]!.ownerLineageId,
              }))
            ),
          }
        : {}),
      ...(declarationOperation.kind === 'declaration.rename' &&
      referenceEvidenceBefore &&
      builderResult.referenceEvidenceAfter
        ? {
            authorizationEvidence: {
              referencePropagation: {
                beforeReferenceSetSha256:
                  referenceEvidenceBefore.expectedReferenceSetSha256,
                afterReferenceSetSha256:
                  builderResult.referenceEvidenceAfter
                    .expectedReferenceSetSha256,
              },
            },
          }
        : {}),
    }
  }
}

function assertTargetCommentTopology(
  project: ProjectIR,
  targetIndex: number
): void
{
  const comments = commentEntityEvidenceSetV1(project).filter(
    (comment) => comment.targetIndex === targetIndex
  )
  const inconsistentComments = comments.filter(
    (comment) => comment.topologyStatus !== 'consistent'
  )
  if (inconsistentComments.length > 0)
    return fail(
      'edit.reference_propagation_incomplete',
      'comment attachment topology is inconsistent',
      { matchCount: inconsistentComments.length }
    )
  const target = project.json.targets[targetIndex]
  if (!target) return fail('edit.selector_no_match', 'comment owner is absent')
  const knownCommentIds = new Set(comments.map((comment) => comment.commentId))
  const danglingReverseLinks = Object.entries(target.blocks).filter(
    ([, block]) =>
      isBlockEntry(block) &&
      typeof block.comment === 'string' &&
      !knownCommentIds.has(block.comment)
  )
  if (danglingReverseLinks.length > 0)
    return fail(
      'edit.reference_propagation_incomplete',
      `block ${danglingReverseLinks[0]![0]} has a dangling comment reverse link`,
      { matchCount: danglingReverseLinks.length }
    )
}

function resolveCommentSelection(
  context: ProductionOperationContextV1,
  operation: CommentOperationV1
): {
  readonly selectedTarget: TargetEntityEvidenceV1
  readonly canonicalTarget: TargetEntityEvidenceV1
  readonly selectedComment?: CommentEntityEvidenceV1
  readonly canonicalComment?: CommentEntityEvidenceV1
  readonly selectedBlock?: BlockEntityEvidenceV1
  readonly canonicalBlock?: BlockEntityEvidenceV1
  readonly selectedLineageIds: readonly string[]
}
{
  if (operation.kind === 'comment.add')
  {
    const target = resolveTargetSelection(context, operation.target)
    const block =
      operation.attachment.kind === 'attached'
        ? resolveBlockSelectionRef(context, operation.attachment.block)
        : undefined
    if (block)
      assertSameTargetBlockV1(target.current.targetIndex, block.current)
    assertTargetCommentTopology(context.preBatch, target.canonical.targetIndex)
    return {
      selectedTarget: target.current,
      canonicalTarget: target.canonical,
      ...(block
        ? { selectedBlock: block.current, canonicalBlock: block.canonical }
        : {}),
      selectedLineageIds: uniqueSorted([
        target.lineageId,
        ...(block ? [blockLineage(context, block.current).lineageId] : []),
      ]),
    }
  }
  const comment = resolveCommentSelectionRef(context, operation.comment)
  const selectedTarget = targetEntityEvidenceSetV1(context.candidate.json)[
    comment.current.targetIndex
  ]!
  const canonicalTarget = targetEntityEvidenceSetV1(context.preBatch.json)[
    comment.canonical.targetIndex
  ]!
  let block:
    | {
        readonly canonical: BlockEntityEvidenceV1
        readonly current: BlockEntityEvidenceV1
      }
    | undefined
  if (operation.kind === 'comment.attach')
    block = resolveBlockSelectionRef(context, operation.block)
  else if (operation.kind === 'comment.detach')
    block = resolveBlockSelectionRef(context, operation.expectedBlock)
  if (block) assertSameTargetCommentBlockV1(comment.current, block.current)
  assertTargetCommentTopology(context.preBatch, comment.canonical.targetIndex)
  return {
    selectedTarget,
    canonicalTarget,
    selectedComment: comment.current,
    canonicalComment: comment.canonical,
    ...(block
      ? { selectedBlock: block.current, canonicalBlock: block.canonical }
      : {}),
    selectedLineageIds: uniqueSorted([
      comment.lineageId,
      ...(block ? [blockLineage(context, block.current).lineageId] : []),
    ]),
  }
}

function commentPlanningFacts(
  context: ProductionOperationContextV1,
  operation: CommentOperationV1,
  selection: ReturnType<typeof resolveCommentSelection>
): unknown
{
  if (operation.kind === 'comment.add')
    return {
      commentMapState: commentMapStateV1(
        context.candidate,
        selection.selectedTarget.targetIndex
      ),
      attachment:
        selection.selectedBlock === undefined
          ? { kind: 'detached' }
          : {
              kind: 'attached',
              blockLocationSha256:
                selection.selectedBlock.semanticLocationSha256,
              blockSemanticFingerprintSha256:
                selection.selectedBlock.semanticFingerprintSha256,
            },
      topologySetSha256: semanticHashV1('evidence-content', {
        kind: 'comment-topology-set',
        schemaVersion: 1,
        comments: commentEntityEvidenceSetV1(context.candidate)
          .filter(
            (comment) =>
              comment.targetIndex === selection.selectedTarget.targetIndex
          )
          .map((comment) => ({
            semanticLocationSha256: comment.semanticLocationSha256,
            semanticFingerprintSha256: comment.semanticFingerprintSha256,
            contextFingerprintSha256: comment.contextFingerprintSha256,
            topologyStatus: comment.topologyStatus,
          })),
      }),
    }
  const comment = selection.selectedComment!
  return {
    commentSemanticFingerprintSha256: comment.semanticFingerprintSha256,
    commentContextFingerprintSha256: comment.contextFingerprintSha256,
    attachment: {
      attachmentKind:
        comment.attachedBlockId === null ? 'detached' : 'attached',
      attachedBlockLocationSha256:
        comment.location.attachedBlock === undefined
          ? null
          : semanticHashV1('semantic-location', comment.location.attachedBlock),
    },
    workspace: comment.location.workspace,
    textSha256: comment.location.textSha256,
    selectedBlock:
      selection.selectedBlock === undefined
        ? null
        : {
            semanticLocationSha256:
              selection.selectedBlock.semanticLocationSha256,
            semanticFingerprintSha256:
              selection.selectedBlock.semanticFingerprintSha256,
          },
  }
}

function productionCommentPlanningFactProjectionV1(
  context: ProductionOperationContextV1,
  operation: CommentOperationV1
): GroupCCommentPlanningFactProjectionV1
{
  const selection = resolveCommentSelection(context, operation)
  const factsContext = planningContext(context, operation)
  const factsSelection = {
    ...selection,
    selectedTarget: selection.canonicalTarget,
    ...(selection.canonicalComment
      ? { selectedComment: selection.canonicalComment }
      : {}),
    ...(selection.canonicalBlock
      ? { selectedBlock: selection.canonicalBlock }
      : {}),
  }
  return {
    kind: 'group-c-comment-planning-fact-set',
    schemaVersion: 1,
    operationKind: operation.kind,
    opId: operation.opId,
    selectedTarget: planningTargetProjection(selection.canonicalTarget),
    ...(selection.canonicalComment
      ? {
          selectedComment: planningCommentProjection(
            selection.canonicalComment
          ),
        }
      : {}),
    ...(selection.canonicalBlock
      ? { selectedBlock: planningBlockProjection(selection.canonicalBlock) }
      : {}),
    selectedLineageIds: selection.selectedLineageIds,
    facts: commentPlanningFacts(
      factsContext,
      operation,
      factsSelection as ReturnType<typeof resolveCommentSelection>
    ),
  }
}

export function productionCommentPlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: CommentOperationV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionCommentPlanningFactProjectionV1(context, operation)
  )
}

export function productionCommentPlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: `comment.${string}` }
  >
): EditOperationPlanningResultV1
{
  let operation: CommentOperationV1
  let facts: readonly EditOperationPlanningFactV1[]
  if (goal.kind === 'comment.add')
  {
    const target = resolveTargetSelection(context, goal.target)
    const expectedCommentMapState = commentMapStateV1(
      context.candidate,
      target.current.targetIndex
    )
    operation = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedCommentMapState,
    }
    facts = Object.freeze([
      completedPlanningFactV1(
        '/expectedCommentMapState',
        'containerState',
        expectedCommentMapState
      ),
    ])
  }
  else
  {
    const selected = resolveCommentSelectionRef(context, goal.comment)
    if (goal.kind === 'comment.updateText')
    {
      const owner = context.candidate.json.targets[selected.current.targetIndex]
      const raw = ownRecordValue(owner?.comments, selected.current.commentId)
      if (!raw)
        return fail('edit.internal_invariant', 'selected comment is absent')
      const expectedTextSha256 = commentTextSha256V1(raw.text)
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedTextSha256,
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedTextSha256',
          'sha256',
          expectedTextSha256
        ),
      ])
    }
    else if (goal.kind === 'comment.move')
    {
      const edits = goal.edits.map((edit) =>
      {
        if (edit.property === 'x' || edit.property === 'y')
          return {
            ...edit,
            expected: selected.current.location.workspace[edit.property],
          }
        if (edit.property === 'minimized')
          return {
            ...edit,
            expected: selected.current.location.workspace.minimized,
          }
        return {
          ...edit,
          expected: selected.current.location.workspace[edit.property],
        }
      })
      operation = {
        ...goal,
        edits,
        expectedPlanningFactSetSha256: '0'.repeat(64),
      }
      facts = Object.freeze(
        edits.map((edit) =>
          completedPlanningFactV1(
            '/edits/*/expected',
            'commentLayoutExpected',
            edit.expected
          )
        )
      )
    }
    else if (goal.kind === 'comment.attach')
    {
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedDetached: true,
      }
      facts = Object.freeze([
        completedPlanningFactV1('/expectedDetached', 'boolean', true),
      ])
    }
    else if (goal.kind === 'comment.detach')
    {
      const attachedBlockId = selected.current.attachedBlockId
      const block = blockEntityEvidenceSetV1(context.candidate).find(
        (entry) =>
          entry.targetIndex === selected.current.targetIndex &&
          entry.blockId === attachedBlockId
      )
      if (!block)
        return fail(
          'edit.planning_facts_mismatch',
          'selected comment is not attached to one exact block'
        )
      const expectedBlock = exactBlockRef(block)
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedBlock,
      }
      facts = Object.freeze([
        completedPlanningFactV1('/expectedBlock', 'blockRef', expectedBlock),
      ])
    }
    else
    {
      operation = {
        ...goal,
        expectedPlanningFactSetSha256: '0'.repeat(64),
        expectedSemanticFingerprint: selected.current.semanticFingerprintSha256,
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedSemanticFingerprint',
          'sha256',
          operation.expectedSemanticFingerprint
        ),
      ])
    }
  }
  const planningFactSetSha256 = productionCommentPlanningFactSetSha256V1(
    context,
    operation
  )
  return Object.freeze({
    operationKind: goal.kind,
    planningFactSetSha256,
    facts: Object.freeze([
      completedPlanningFactV1(
        '/expectedPlanningFactSetSha256',
        'sha256',
        planningFactSetSha256
      ),
      ...facts,
    ]),
  })
}

function commentCanonicalOperation(
  operation: CommentOperationV1,
  selection: ReturnType<typeof resolveCommentSelection>
): CommentOperationV1
{
  if (operation.kind === 'comment.add')
    return {
      ...operation,
      target: exactTargetRef(selection.canonicalTarget),
      attachment:
        operation.attachment.kind === 'attached'
          ? {
              kind: 'attached',
              block: exactBlockRef(selection.canonicalBlock!),
            }
          : operation.attachment,
    }
  if (operation.kind === 'comment.attach')
    return {
      ...operation,
      comment:
        operation.comment.refKind === 'created'
          ? operation.comment
          : exactCommentRef(selection.canonicalComment!),
      block: exactBlockRef(selection.canonicalBlock!),
    }
  if (operation.kind === 'comment.detach')
    return {
      ...operation,
      comment:
        operation.comment.refKind === 'created'
          ? operation.comment
          : exactCommentRef(selection.canonicalComment!),
      expectedBlock: exactBlockRef(selection.canonicalBlock!),
    }
  return {
    ...operation,
    comment:
      operation.comment.refKind === 'created'
        ? operation.comment
        : exactCommentRef(selection.canonicalComment!),
  }
}

function commentAttribution(
  operation: CommentOperationV1,
  targetIndex: number,
  commentId: string,
  block: BlockEntityEvidenceV1 | undefined,
  mapWasMissing: boolean
): DeltaOperationAttribution
{
  const base = `/targets/${targetIndex}/comments/${pointerPart(commentId)}`
  const projectPaths: string[] = []
  const blocks: NonNullable<DeltaOperationAttribution['blocks']>[number][] = []
  if (operation.kind === 'comment.add')
  {
    projectPaths.push(base)
    if (mapWasMissing) projectPaths.push(`/targets/${targetIndex}/comments`)
  }
  else if (operation.kind === 'comment.updateText')
    projectPaths.push(`${base}/text`)
  else if (operation.kind === 'comment.move')
    projectPaths.push(
      ...operation.edits.map((edit) => `${base}/${edit.property}`)
    )
  else if (operation.kind === 'comment.attach')
    projectPaths.push(`${base}/blockId`)
  else if (operation.kind === 'comment.detach')
    projectPaths.push(`${base}/blockId`)
  else projectPaths.push(base)
  if (
    block &&
    (operation.kind === 'comment.add' ||
      operation.kind === 'comment.attach' ||
      operation.kind === 'comment.detach' ||
      operation.kind === 'comment.remove')
  )
    blocks.push({
      targetIndex: block.targetIndex,
      blockId: block.blockId,
      relativePaths: Object.freeze(['/comment']),
    })
  return {
    operationId: operation.opId,
    projectPaths: uniqueSorted(projectPaths),
    blocks: Object.freeze(blocks),
  }
}

function commentStructuralPaths(
  attribution: DeltaOperationAttribution,
  block: BlockEntityEvidenceV1 | undefined
): readonly string[]
{
  return uniqueSorted([
    ...(attribution.projectPaths ?? []),
    ...(block
      ? [
          `/targets/${block.targetIndex}/blocks/${pointerPart(block.blockId)}/comment`,
        ]
      : []),
  ])
}

export class CommentProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'comment.add',
    'comment.updateText',
    'comment.move',
    'comment.attach',
    'comment.detach',
    'comment.remove',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `comment dispatcher does not support ${operation.kind}`
      )
    const commentOperation = operation as CommentOperationV1
    const selection = resolveCommentSelection(context, commentOperation)
    const planningFactProjection = productionCommentPlanningFactProjectionV1(
      context,
      commentOperation
    )
    if (
      commentOperation.expectedPlanningFactSetSha256 !==
      semanticHashV1('resolved-plan', planningFactProjection)
    )
      return fail(
        'edit.planning_facts_mismatch',
        `planning facts changed for ${commentOperation.opId}`
      )
    const ownerBindingKeys = targetBindingKeys(
      context,
      selection.selectedTarget
    )
    const selectedComment = selection.selectedComment
    let entityBindingKeys = selectedComment
      ? commentBindingKeys(context, selectedComment)
      : Object.freeze([] as string[])
    let futureBindings: readonly FutureContractBindingV1[] = Object.freeze([])
    if (commentOperation.kind === 'comment.add')
    {
      const blockKeys = selection.selectedBlock
        ? blockBindingKeys(context, selection.selectedBlock)
        : Object.freeze([] as string[])
      if (
        selection.selectedBlock &&
        blockKeys.length !== 1 &&
        context.contract.entityBindings.some(
          (binding) =>
            binding.bindingKind === 'future' &&
            binding.entityKind === 'comment' &&
            binding.expectedCreatorOperationKind === 'comment.add'
        )
      )
        return fail(
          'edit.unauthorized_change',
          'attached comment future binding requires one exact block binding'
        )
      futureBindings = futureBindingKeysForCreation(
        context,
        'comment.add',
        'comment',
        'unspecialized',
        'comment',
        ownerBindingKeys,
        (binding) =>
        {
          if (binding.entityKind !== 'comment')
            return fail(
              'edit.internal_invariant',
              'comment creation matched a non-comment binding'
            )
          return groupCCommentCreationContentFingerprintV1(
            commentOperation,
            binding,
            commentOperation.attachment.kind === 'detached'
              ? { kind: 'detached' }
              : {
                  kind: 'attached',
                  block: {
                    contractRefKind: 'existing',
                    entityKind: 'block',
                    entitySubtype: 'unspecialized',
                    bindingKey: blockKeys[0]!,
                  },
                }
          )
        }
      )
      entityBindingKeys = Object.freeze(
        futureBindings.map((binding) => binding.bindingKey)
      )
    }
    if (
      commentOperation.kind === 'comment.remove' &&
      entityBindingKeys.length === 0
    )
      return fail(
        'edit.unauthorized_change',
        'comment removal requires one exact entity binding'
      )
    const selectedScope = selectExactScope(
      context.contract,
      commentOperation.kind,
      'comment',
      'unspecialized',
      commentRequiredProperties(commentOperation),
      entityBindingKeys,
      ownerBindingKeys
    )
    const canonicalOperation = commentCanonicalOperation(
      commentOperation,
      selection
    )
    const selectedLineageId = selectedComment
      ? commentLineage(context, selectedComment).lineageId
      : null
    const priorMapState = commentMapStateV1(
      context.candidate,
      selection.selectedTarget.targetIndex
    )
    const priorAttachedBlock =
      selectedComment?.attachedBlockId === null
        ? undefined
        : blockEntityEvidenceSetV1(context.candidate).find(
            (block) =>
              block.targetIndex === selectedComment?.targetIndex &&
              block.blockId === selectedComment?.attachedBlockId
          )
    const effectiveBlock = selection.selectedBlock ?? priorAttachedBlock
    const beforeWorkspace = selectedComment?.location.workspace
    const builderResult = applyCommentOperationV1(context.candidate, {
      operation: canonicalOperation,
      targetIndex: selection.selectedTarget.targetIndex,
      ...(selectedComment ? { commentId: selectedComment.commentId } : {}),
      ...(selection.selectedBlock
        ? { blockId: selection.selectedBlock.blockId }
        : {}),
    })
    assertTargetCommentTopology(
      context.candidate,
      selection.selectedTarget.targetIndex
    )
    let activeLineage = context.activeLineage
    let fixedSlots: readonly GroupCProductionResultSlotV1[] = Object.freeze([])
    let resultLineageId = selectedLineageId
    let creationProvenance:
      | { readonly collisionNonce: number; readonly creationKey: string }
      | undefined
    if (commentOperation.kind === 'comment.add')
    {
      const createdEvidence = commentEntityEvidenceSetV1(
        context.candidate
      ).find(
        (comment) =>
          comment.targetIndex === builderResult.targetIndex &&
          comment.commentId === builderResult.commentId
      )
      if (!createdEvidence)
        return fail(
          'edit.postcondition_failed',
          'created comment evidence is absent'
        )
      const ownerLineage = targetLineageAt(
        context.activeLineage,
        context.candidate.json.targets.length,
        createdEvidence.targetIndex
      )
      const canonicalRawIdentities = canonicalCommentRawIdentities(
        context.candidate,
        createdEvidence.targetIndex
      )
      const createdRawIdentity = `comment:${createdEvidence.commentId}`
      const canonicalOrdinal =
        canonicalRawIdentities.indexOf(createdRawIdentity)
      if (canonicalOrdinal < 0)
        return fail(
          'edit.internal_invariant',
          'created comment is absent from canonical sibling evidence'
        )
      const creationKey = 'fixed:comment'
      const created = createdLineage(
        context,
        commentOperation.opId,
        'comment',
        ownerLineage.lineageId,
        createdRawIdentity,
        canonicalOrdinal,
        creationKey
      )
      creationProvenance = {
        collisionNonce: created.collisionNonce,
        creationKey: created.creationKey,
      }
      activeLineage = reindexActiveSiblingLineages(
        created.activeLineage,
        'comment',
        ownerLineage.lineageId,
        canonicalRawIdentities
      )
      resultLineageId = created.record.lineageId
      fixedSlots = Object.freeze([
        {
          slotKind: 'fixed',
          name: 'comment',
          entityKind: 'comment',
          entitySubtype: 'unspecialized',
          lineageId: created.record.lineageId,
          ownerLineageId: ownerLineage.lineageId,
          semanticLocationSha256: createdEvidence.semanticLocationSha256,
          semanticFingerprintSha256: createdEvidence.semanticFingerprintSha256,
          contextFingerprintSha256: createdEvidence.contextFingerprintSha256,
        },
      ])
    }
    else if (
      commentOperation.kind === 'comment.remove' &&
      selectedLineageId
    )
    {
      const ownerLineage = targetLineageAt(
        activeLineage,
        context.candidate.json.targets.length,
        selectedComment!.targetIndex
      )
      activeLineage = reindexActiveSiblingLineages(
        tombstoneLineage(activeLineage, selectedLineageId),
        'comment',
        ownerLineage.lineageId,
        canonicalCommentRawIdentities(
          context.candidate,
          selectedComment!.targetIndex
        )
      )
    }
    const attribution = commentAttribution(
      commentOperation,
      builderResult.targetIndex,
      builderResult.commentId,
      effectiveBlock,
      priorMapState.state === 'missing'
    )
    const result = operationResult(
      commentOperation,
      resultLineageId ? [resultLineageId] : [],
      fixedSlots,
      {
        selectedLineageId,
        resultLineageId,
        topologyStatus:
          commentOperation.kind === 'comment.remove'
            ? 'removed'
            : commentEntityEvidenceSetV1(context.candidate).find(
                (comment) =>
                  comment.targetIndex === builderResult.targetIndex &&
                  comment.commentId === builderResult.commentId
              )?.topologyStatus,
      }
    )
    return {
      canonicalOperation,
      selectedScope,
      result,
      attribution,
      activeLineage,
      planningFactProjection,
      matchedContractBindingKeys: entityBindingKeys,
      selectedEntityLineageIds: result.selectedLineageIds,
      structuralAuthorization: {
        exactPaths: commentStructuralPaths(attribution, effectiveBlock),
        pathPrefixes: Object.freeze([]),
      },
      ...(resultLineageId && creationProvenance && futureBindings.length > 0
        ? {
            futureBindingRealizationCandidates: Object.freeze(
              futureBindings.map((binding) => ({
                bindingKey: binding.bindingKey,
                createdEntityKind: 'comment' as const,
                createdEntitySubtype: 'unspecialized' as const,
                collisionNonce: creationProvenance.collisionNonce,
                creationKey: creationProvenance.creationKey,
                resultLineageId,
                ownerLineageId: fixedSlots[0]!.ownerLineageId,
              }))
            ),
          }
        : {}),
      ...(commentOperation.kind === 'comment.move' && beforeWorkspace
        ? {
            authorizationEvidence: {
              entityMove: {
                collection: 'commentWorkspace' as const,
                beforePositionSha256: semanticEntityMovePositionSha256V1(
                  'commentWorkspace',
                  beforeWorkspace
                ),
                afterPositionSha256: semanticEntityMovePositionSha256V1(
                  'commentWorkspace',
                  commentEntityEvidenceSetV1(context.candidate).find(
                    (comment) =>
                      comment.targetIndex === builderResult.targetIndex &&
                      comment.commentId === builderResult.commentId
                  )!.location.workspace
                ),
              },
            },
          }
        : {}),
    }
  }
}

function resolveScriptSelection(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationScriptMoveWorkspaceV1
): {
  readonly selectedScript: ScriptEntityEvidenceV1
  readonly canonicalScript: ScriptEntityEvidenceV1
  readonly selectedLineageIds: readonly string[]
}
{
  const script = resolveScriptSelectionRef(context, operation.script)
  return {
    selectedScript: script.current,
    canonicalScript: script.canonical,
    selectedLineageIds: Object.freeze([script.lineageId]),
  }
}

function productionScriptWorkspacePlanningFactProjectionV1(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationScriptMoveWorkspaceV1
): GroupCScriptWorkspacePlanningFactProjectionV1
{
  const selection = resolveScriptSelection(context, operation)
  return {
    kind: 'group-c-script-workspace-planning-fact-set',
    schemaVersion: 1,
    operationKind: 'script.moveWorkspace',
    opId: operation.opId,
    selectedScript: planningScriptProjection(selection.canonicalScript),
    selectedLineageIds: selection.selectedLineageIds,
    facts: {
      workspace: selection.canonicalScript.location.workspace,
      rootRole: selection.canonicalScript.rootRole,
      category: selection.canonicalScript.category,
    },
  }
}

export function productionScriptWorkspacePlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationScriptMoveWorkspaceV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionScriptWorkspacePlanningFactProjectionV1(context, operation)
  )
}

export function productionScriptWorkspacePlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: 'script.moveWorkspace' }
  >
): EditOperationPlanningResultV1
{
  const provisional: SemanticEditOperationScriptMoveWorkspaceV1 = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    expected: {
      x: { state: 'missing' },
      y: { state: 'missing' },
    },
  }
  const selected = resolveScriptSelection(context, provisional)
  const operation: SemanticEditOperationScriptMoveWorkspaceV1 = {
    ...provisional,
    expected: selected.canonicalScript.location.workspace,
  }
  const planningFactSetSha256 =
    productionScriptWorkspacePlanningFactSetSha256V1(context, operation)
  return Object.freeze({
    operationKind: goal.kind,
    planningFactSetSha256,
    facts: Object.freeze([
      completedPlanningFactV1(
        '/expectedPlanningFactSetSha256',
        'sha256',
        planningFactSetSha256
      ),
      completedPlanningFactV1(
        '/expected',
        'workspaceExpected',
        operation.expected
      ),
    ]),
  })
}

export class ScriptWorkspaceProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze(['script.moveWorkspace'] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (operation.kind !== 'script.moveWorkspace')
      return fail(
        'edit.unsupported_operation',
        `workspace dispatcher does not support ${operation.kind}`
      )
    const selection = resolveScriptSelection(context, operation)
    const planningFactProjection =
      productionScriptWorkspacePlanningFactProjectionV1(context, operation)
    if (
      operation.expectedPlanningFactSetSha256 !==
      semanticHashV1('resolved-plan', planningFactProjection)
    )
      return fail(
        'edit.planning_facts_mismatch',
        `planning facts changed for ${operation.opId}`
      )
    const bindingKeys = scriptBindingKeys(context, selection.selectedScript)
    const target = targetEntityEvidenceSetV1(context.candidate.json)[
      selection.selectedScript.targetIndex
    ]!
    const selectedScope = selectExactScope(
      context.contract,
      operation.kind,
      'script',
      'unspecialized',
      ['workspaceX', 'workspaceY'],
      bindingKeys,
      targetBindingKeys(context, target)
    )
    const canonicalOperation: SemanticEditOperationScriptMoveWorkspaceV1 = {
      ...operation,
      script: exactScriptRef(selection.canonicalScript),
    }
    const resultLineageId = selection.selectedLineageIds[0]!
    const builderResult = applyScriptWorkspaceOperationV1(context.candidate, {
      operation: canonicalOperation,
      targetIndex: selection.selectedScript.targetIndex,
      topBlockId: selection.selectedScript.topBlockId,
    })
    const selectedAfter = scriptEntityEvidenceSetV1(context.candidate).find(
      (script) =>
        script.targetIndex === builderResult.targetIndex &&
        script.topBlockId === builderResult.topBlockId
    )
    if (!selectedAfter)
      return fail(
        'edit.postcondition_failed',
        'moved script is absent after workspace mutation'
      )
    const base = `/targets/${builderResult.targetIndex}/blocks/${pointerPart(builderResult.topBlockId)}`
    const exactPaths = Object.freeze([`${base}/x`, `${base}/y`].sort())
    const result = operationResult(operation, [resultLineageId], [], {
      before: selection.selectedScript.location.workspace,
      after: selectedAfter.location.workspace,
    })
    return {
      canonicalOperation,
      selectedScope,
      result,
      attribution: {
        operationId: operation.opId,
        blocks: Object.freeze([
          {
            targetIndex: builderResult.targetIndex,
            blockId: builderResult.topBlockId,
            relativePaths: Object.freeze(['/x', '/y']),
          },
        ]),
      },
      activeLineage: context.activeLineage,
      planningFactProjection,
      matchedContractBindingKeys: bindingKeys,
      selectedEntityLineageIds: result.selectedLineageIds,
      structuralAuthorization: {
        exactPaths,
        pathPrefixes: Object.freeze([]),
      },
      authorizationEvidence: {
        entityMove: {
          collection: 'scriptWorkspace',
          beforePositionSha256: semanticEntityMovePositionSha256V1(
            'scriptWorkspace',
            selection.selectedScript.location.workspace
          ),
          afterPositionSha256: semanticEntityMovePositionSha256V1(
            'scriptWorkspace',
            selectedAfter.location.workspace
          ),
        },
      },
    }
  }
}

function conflictResource(kind: string, projection: unknown): string
{
  return `${kind}:${semanticHashV1('resolved-plan', {
    kind: 'group-c-conflict-resource',
    schemaVersion: 1,
    resourceKind: kind,
    projection,
  })}`
}

function conflictDependencies(
  operation: SemanticEditOperationV1
): readonly string[]
{
  const dependencies = new Set<string>()
  const visit = (value: unknown): void =>
  {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value))
    {
      for (const entry of value) visit(entry)
      return
    }
    const record = value as Record<string, unknown>
    if (record.refKind === 'created' && typeof record.opId === 'string')
      dependencies.add(record.opId)
    for (const child of Object.values(record)) visit(child)
  }
  visit(operation)
  return Object.freeze([...dependencies].sort())
}

function conflictHandleIndex<
  T extends {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
  },
>(
  input: EditTransactionInputV1,
  reference: { readonly token: string },
  evidence: readonly T[],
  entityKind: string,
  subtype: (candidate: T) => string,
  lineageSha256: (candidate: T) => string
): number | null
{
  if (!input.verifyHandle) return null
  const matches = evidence.flatMap((candidate, index) =>
    input.verifyHandle!({
      token: reference.token,
      entityKind,
      entitySubtype: subtype(candidate),
      lineageSha256: lineageSha256(candidate),
      semanticLocationSha256: candidate.semanticLocationSha256,
      semanticFingerprintSha256: candidate.semanticFingerprintSha256,
    })
      ? [index]
      : []
  )
  return matches.length === 1 ? matches[0]! : null
}

function conflictTargetLineage(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: TargetRefV1
): string
{
  if (reference.refKind === 'created')
    return conflictResource('created-target', {
      opId: reference.opId,
      slot: reference.slot,
    })
  const evidence = resolveTargetRefV1(project, reference, {
    activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
    resolveHandle: (handle, candidates) =>
      conflictHandleIndex(
        input,
        handle,
        candidates,
        'target',
        (candidate) => candidate.targetKind,
        (candidate) =>
          targetLineageAt(
            lineage,
            project.json.targets.length,
            candidate.targetIndex
          ).lineageId
      ),
    resolveCreated: () => null,
  })
  return targetLineageAt(
    lineage,
    project.json.targets.length,
    evidence.targetIndex
  ).lineageId
}

function conflictResolverAdapters(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot
): GroupCEntityResolverAdaptersV1
{
  return {
    activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
    target: {
      activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
      resolveHandle: (reference, evidence) =>
        conflictHandleIndex(
          input,
          reference,
          evidence,
          'target',
          (candidate) => candidate.targetKind,
          (candidate) =>
            targetLineageAt(
              lineage,
              project.json.targets.length,
              candidate.targetIndex
            ).lineageId
        ),
      resolveCreated: () => null,
    },
    resolveDeclarationHandle: (reference, evidence) =>
      conflictHandleIndex(
        input,
        reference,
        evidence,
        'declaration',
        (candidate) => candidate.declarationKind,
        (candidate) =>
          entityLineageIn(
            project,
            lineage,
            'declaration',
            candidate.targetIndex,
            `${candidate.declarationKind}:${candidate.declarationId}`
          ).lineageId
      ),
    resolveDeclarationCreated: () => null,
    resolveCommentHandle: (reference, evidence) =>
      conflictHandleIndex(
        input,
        reference,
        evidence,
        'comment',
        () => 'unspecialized',
        (candidate) =>
          entityLineageIn(
            project,
            lineage,
            'comment',
            candidate.targetIndex,
            `comment:${candidate.commentId}`
          ).lineageId
      ),
    resolveCommentCreated: () => null,
    resolveScriptHandle: (reference, evidence) =>
      conflictHandleIndex(
        input,
        reference,
        evidence,
        'script',
        () => 'unspecialized',
        (candidate) =>
          entityLineageIn(
            project,
            lineage,
            'script',
            candidate.targetIndex,
            `script:${candidate.topBlockId}`
          ).lineageId
      ),
    resolveScriptCreated: () => null,
    resolveBlockHandle: (reference, evidence) =>
      conflictHandleIndex(
        input,
        reference,
        evidence,
        'block',
        () => 'unspecialized',
        (candidate) =>
          entityLineageIn(
            project,
            lineage,
            'block',
            candidate.targetIndex,
            `block:${candidate.blockId}`
          ).lineageId
      ),
    resolveBlockCreated: () => null,
    resolveMediaHandle: (reference, evidence) =>
      conflictHandleIndex(
        input,
        reference,
        evidence,
        'media',
        (candidate) => candidate.mediaKind,
        (candidate) =>
          mediaLineageAt(
            lineage,
            candidate.mediaKind,
            targetLineageAt(
              lineage,
              project.json.targets.length,
              candidate.targetIndex
            ).lineageId,
            candidate.ordinal
          ).lineageId
      ),
    resolveMediaCreated: () => null,
  }
}

function conflictDeclarationLineage(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: DeclarationRefV1
): string
{
  if (reference.refKind === 'created')
    return conflictResource('created-declaration', {
      opId: reference.opId,
      slot: reference.slot,
    })
  const evidence = resolveDeclarationRefV1(
    project,
    reference,
    conflictResolverAdapters(input, project, lineage)
  )
  return entityLineageIn(
    project,
    lineage,
    'declaration',
    evidence.targetIndex,
    `${evidence.declarationKind}:${evidence.declarationId}`
  ).lineageId
}

function conflictCommentLineage(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: CommentRefV1
): string
{
  if (reference.refKind === 'created')
    return conflictResource('created-comment', {
      opId: reference.opId,
      slot: reference.slot,
    })
  const evidence = resolveCommentRefV1(
    project,
    reference,
    conflictResolverAdapters(input, project, lineage)
  )
  return entityLineageIn(
    project,
    lineage,
    'comment',
    evidence.targetIndex,
    `comment:${evidence.commentId}`
  ).lineageId
}

function conflictBlockLineage(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: BlockRefV1
): string
{
  if (reference.refKind === 'created')
    return conflictResource('created-block', {
      opId: reference.opId,
      slot: reference.slot,
    })
  const evidence = resolveBlockRefV1(
    project,
    reference,
    conflictResolverAdapters(input, project, lineage)
  )
  return entityLineageIn(
    project,
    lineage,
    'block',
    evidence.targetIndex,
    `block:${evidence.blockId}`
  ).lineageId
}

function conflictScriptLineage(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: ScriptRefV1
): string
{
  if (reference.refKind === 'created')
    return conflictResource('created-script', {
      opId: reference.opId,
      slot: reference.slot,
    })
  const evidence = resolveScriptRefV1(
    project,
    reference,
    conflictResolverAdapters(input, project, lineage)
  )
  return entityLineageIn(
    project,
    lineage,
    'script',
    evidence.targetIndex,
    `script:${evidence.topBlockId}`
  ).lineageId
}

interface MutableConflictProjectionV1
{
  readonly reads: Set<string>
  readonly writes: Set<string>
  readonly deletes: Set<string>
  readonly createdDependencyResources: Set<string>
  readonly reconciledSelectionResources: Set<string>
  readonly authoritativeSelectionResources: Set<string>
}

function mutableConflictProjection(): MutableConflictProjectionV1
{
  return {
    reads: new Set<string>(),
    writes: new Set<string>(),
    deletes: new Set<string>(),
    createdDependencyResources: new Set<string>(),
    reconciledSelectionResources: new Set<string>(),
    authoritativeSelectionResources: new Set<string>(),
  }
}

function entityConflictResource(
  entityKind: string,
  lineageId: string,
  property?: string
): string
{
  return conflictResource('entity', {
    entityKind,
    lineageId,
    ...(property === undefined ? {} : { property }),
  })
}

function pathConflictResource(path: string): string
{
  return conflictResource('semantic-path', { path })
}

function addEntityRead(
  projection: MutableConflictProjectionV1,
  entityKind: string,
  lineageId: string,
  property?: string
): void
{
  projection.reads.add(entityConflictResource(entityKind, lineageId))
  if (property !== undefined)
    projection.reads.add(
      entityConflictResource(entityKind, lineageId, property)
    )
}

function addEntityWrite(
  projection: MutableConflictProjectionV1,
  entityKind: string,
  lineageId: string,
  property?: string
): void
{
  if (property === undefined)
    projection.writes.add(entityConflictResource(entityKind, lineageId))
  else
    projection.writes.add(
      entityConflictResource(entityKind, lineageId, property)
    )
}

function addOwnerTargetRead(
  projection: MutableConflictProjectionV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  targetIndex: number
): void
{
  addEntityRead(
    projection,
    'target',
    targetLineageAt(lineage, project.json.targets.length, targetIndex).lineageId
  )
}

function targetChangedVisualIndexes(
  project: ProjectIR,
  targetIndex: number,
  newLayer: number
): readonly number[]
{
  const selected = project.json.targets[targetIndex]
  if (!selected || selected.isStage) return Object.freeze([])
  const oldLayer = selected.layerOrder!
  return Object.freeze(
    project.json.targets.flatMap((candidate, index) =>
    {
      if (candidate.isStage) return []
      const layer = candidate.layerOrder!
      const shifted =
        (oldLayer < newLayer && layer > oldLayer && layer <= newLayer) ||
        (oldLayer > newLayer && layer >= newLayer && layer < oldLayer)
      return index === targetIndex || shifted ? [index] : []
    })
  )
}

function targetConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: Extract<SemanticEditOperationV1, { kind: `target.${string}` }>,
  projection: MutableConflictProjectionV1,
  referenceIndex?: SemanticReferenceIndex
): void
{
  // creation selects no existing target: it appends to the serialized collection &
  // opens one visual slot, so it conflicts on both orders & on nothing else
  if (operation.kind === 'target.addSprite')
  {
    const serialized = conflictResource('target-order', { kind: 'serialized' })
    const visual = conflictResource('target-order', { kind: 'visual' })
    const domain = conflictResource('target-name-domain', { kind: 'project' })
    projection.reads.add(serialized)
    projection.reads.add(visual)
    projection.reads.add(domain)
    projection.writes.add(serialized)
    projection.writes.add(visual)
    projection.writes.add(domain)
    projection.writes.add(
      conflictResource('target-order', { kind: 'runtime-executable' })
    )
    for (const [index, candidate] of project.json.targets.entries())
    {
      if (candidate.isStage) continue
      if ((candidate.layerOrder ?? 0) < operation.visualLayerOrdinal) continue
      addEntityWrite(
        projection,
        'target',
        targetLineageAt(lineage, project.json.targets.length, index).lineageId,
        'layerOrder'
      )
    }
    return
  }
  const targetOperation = operation as TargetOperationV1
  const selected = resolveTargetRefV1(project, targetOperation.target, {
    activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
    resolveHandle: (reference, evidence) =>
      conflictHandleIndex(
        input,
        reference,
        evidence,
        'target',
        (candidate) => candidate.targetKind,
        (candidate) =>
          targetLineageAt(
            lineage,
            project.json.targets.length,
            candidate.targetIndex
          ).lineageId
      ),
    resolveCreated: () => null,
  })
  const lineageId = targetLineageAt(
    lineage,
    project.json.targets.length,
    selected.targetIndex
  ).lineageId
  if (targetOperation.kind === 'target.renameSprite')
  {
    addEntityRead(projection, 'target', lineageId, 'name')
    addEntityWrite(projection, 'target', lineageId, 'name')
    const domain = conflictResource('target-name-domain', { kind: 'project' })
    projection.reads.add(domain)
    projection.writes.add(domain)
    const inbound = targetInboundReferenceSetV1(
      project,
      referenceIndex ?? buildSemanticReferenceIndex(project),
      selected.targetIndex
    )
    for (const reference of inbound.references)
    {
      const path = pathConflictResource(reference.path)
      projection.reads.add(path)
      projection.writes.add(path)
    }
  }
  else if (targetOperation.kind === 'target.reorderSprite')
  {
    const order = conflictResource('target-order', { kind: 'visual' })
    projection.reads.add(order)
    projection.writes.add(order)
    projection.writes.add(
      conflictResource('target-order', { kind: 'runtime-executable' })
    )
    for (const targetIndex of targetChangedVisualIndexes(
      project,
      selected.targetIndex,
      targetOperation.newVisualLayerOrdinal
    ))
    {
      const changedLineageId = targetLineageAt(
        lineage,
        project.json.targets.length,
        targetIndex
      ).lineageId
      addEntityWrite(projection, 'target', changedLineageId, 'layerOrder')
    }
  }
  else if (targetOperation.kind === 'target.removeSprite')
  {
    addEntityRead(projection, 'target', lineageId)
    const base = entityConflictResource('target', lineageId)
    projection.writes.add(base)
    projection.deletes.add(base)
    for (const kind of ['serialized', 'visual', 'runtime-executable'])
      projection.writes.add(conflictResource('target-order', { kind }))
  }
  else
  {
    for (const edit of targetOperation.edits)
    {
      addEntityRead(projection, 'target', lineageId, edit.property)
      addEntityWrite(projection, 'target', lineageId, edit.property)
    }
  }
}

function declarationConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: DeclarationOperationV1,
  operations: readonly SemanticEditOperationV1[],
  projection: MutableConflictProjectionV1
): void
{
  const nameDomain = (kind: string, targetLineageId: string | null) =>
    conflictResource('declaration-name-domain', { kind, targetLineageId })
  if (
    operation.kind === 'declaration.addVariable' ||
    operation.kind === 'declaration.addList'
  )
  {
    const owner = conflictTargetLineage(
      input,
      project,
      lineage,
      operation.scope
    )
    const subtype =
      operation.kind === 'declaration.addVariable' ? 'variable' : 'list'
    const ownerEvidence = resolveTargetRefV1(project, operation.scope, {
      activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
      resolveHandle: (reference, evidence) =>
        conflictHandleIndex(
          input,
          reference,
          evidence,
          'target',
          (candidate) => candidate.targetKind,
          (candidate) =>
            targetLineageAt(
              lineage,
              project.json.targets.length,
              candidate.targetIndex
            ).lineageId
        ),
      resolveCreated: () => null,
    })
    addOwnerTargetRead(projection, project, lineage, ownerEvidence.targetIndex)
    const collection = conflictResource('declaration-collection', {
      owner,
      subtype,
    })
    const created = conflictResource('created-declaration', {
      opId: operation.opId,
      slot: { slotKind: 'fixed', name: 'declaration' },
    })
    projection.reads.add(collection)
    projection.writes.add(collection)
    const createdEntity = entityConflictResource('declaration', created)
    projection.writes.add(createdEntity)
    projection.createdDependencyResources.add(createdEntity)
    const domain = nameDomain(subtype, owner)
    projection.reads.add(domain)
    projection.writes.add(domain)
    projection.createdDependencyResources.add(domain)
    return
  }
  if (operation.kind === 'declaration.addBroadcast')
  {
    const stageIndex = project.json.targets.findIndex(
      (target) => target.isStage
    )
    if (stageIndex < 0)
      return fail('edit.project_constraint', 'project has no stage')
    addOwnerTargetRead(projection, project, lineage, stageIndex)
    const collection = conflictResource('declaration-collection', {
      owner: 'project',
      subtype: 'broadcast',
    })
    const created = conflictResource('created-declaration', {
      opId: operation.opId,
      slot: { slotKind: 'fixed', name: 'declaration' },
    })
    projection.reads.add(collection)
    projection.writes.add(collection)
    const createdEntity = entityConflictResource('declaration', created)
    projection.writes.add(createdEntity)
    projection.createdDependencyResources.add(createdEntity)
    const domain = nameDomain('broadcast', null)
    projection.reads.add(domain)
    projection.writes.add(domain)
    projection.createdDependencyResources.add(domain)
    return
  }
  const declarationId = conflictDeclarationLineage(
    input,
    project,
    lineage,
    operation.declaration
  )
  const declarationEvidence =
    operation.declaration.refKind === 'created'
      ? null
      : resolveDeclarationRefV1(
          project,
          operation.declaration,
          conflictResolverAdapters(input, project, lineage)
        )
  if (declarationEvidence)
    addOwnerTargetRead(
      projection,
      project,
      lineage,
      declarationEvidence.targetIndex
    )
  if (operation.kind === 'declaration.rename')
  {
    addEntityRead(projection, 'declaration', declarationId, 'name')
    addEntityWrite(projection, 'declaration', declarationId, 'name')
    const evidence = declarationEvidence
    const createdOperationId =
      operation.declaration.refKind === 'created'
        ? operation.declaration.opId
        : null
    const createdBy =
      createdOperationId !== null
        ? operations.find((candidate) => candidate.opId === createdOperationId)
        : undefined
    const createdDomain = (() =>
    {
      if (
        createdBy?.kind === 'declaration.addVariable' ||
        createdBy?.kind === 'declaration.addList'
      )
        return {
          kind:
            createdBy.kind === 'declaration.addVariable' ? 'variable' : 'list',
          owner: conflictTargetLineage(
            input,
            project,
            lineage,
            createdBy.scope
          ),
        }
      if (createdBy?.kind === 'declaration.addBroadcast')
        return { kind: 'broadcast', owner: null }
      return null
    })()
    if (!evidence && !createdDomain)
      return fail(
        'edit.internal_invariant',
        'created declaration rename has no exact creator operation'
      )
    const domain = nameDomain(
      evidence?.declarationKind ?? createdDomain!.kind,
      evidence
        ? targetLineageAt(
            lineage,
            project.json.targets.length,
            evidence.targetIndex
          ).lineageId
        : createdDomain!.owner
    )
    projection.reads.add(domain)
    projection.writes.add(domain)
    if (evidence)
    {
      const references = declarationReferenceEvidenceV1(
        project,
        evidence.rawRef
      )
      for (const path of [
        ...references.referencePaths,
        ...references.monitorPaths,
      ])
      {
        const resource = pathConflictResource(path)
        projection.reads.add(resource)
        projection.writes.add(resource)
      }
    }
  }
  else if (operation.kind === 'declaration.setVariableInitialValue')
  {
    addEntityRead(projection, 'declaration', declarationId, 'initialValue')
    addEntityWrite(projection, 'declaration', declarationId, 'initialValue')
  }
  else if (operation.kind === 'declaration.setListInitialItems')
  {
    addEntityRead(projection, 'declaration', declarationId, 'initialItems')
    addEntityWrite(projection, 'declaration', declarationId, 'initialItems')
  }
  else
  {
    addEntityRead(projection, 'declaration', declarationId)
    const base = entityConflictResource('declaration', declarationId)
    projection.writes.add(base)
    projection.deletes.add(base)
  }
}

function commentConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: CommentOperationV1,
  projection: MutableConflictProjectionV1
): void
{
  if (operation.kind === 'comment.add')
  {
    const owner = conflictTargetLineage(
      input,
      project,
      lineage,
      operation.target
    )
    const ownerEvidence = resolveTargetRefV1(project, operation.target, {
      activeMatchCandidateLimit: input.resourceLimits.activeMatchCandidates,
      resolveHandle: (reference, evidence) =>
        conflictHandleIndex(
          input,
          reference,
          evidence,
          'target',
          (candidate) => candidate.targetKind,
          (candidate) =>
            targetLineageAt(
              lineage,
              project.json.targets.length,
              candidate.targetIndex
            ).lineageId
        ),
      resolveCreated: () => null,
    })
    addOwnerTargetRead(projection, project, lineage, ownerEvidence.targetIndex)
    const collection = conflictResource('comment-collection', { owner })
    const created = conflictResource('created-comment', {
      opId: operation.opId,
      slot: { slotKind: 'fixed', name: 'comment' },
    })
    projection.reads.add(collection)
    projection.writes.add(collection)
    const createdEntity = entityConflictResource('comment', created)
    projection.writes.add(createdEntity)
    projection.createdDependencyResources.add(createdEntity)
    if (operation.attachment.kind === 'attached')
    {
      const blockId = conflictBlockLineage(
        input,
        project,
        lineage,
        operation.attachment.block
      )
      addEntityRead(projection, 'block', blockId, 'comment')
      addEntityWrite(projection, 'block', blockId, 'comment')
    }
    return
  }
  const commentId = conflictCommentLineage(
    input,
    project,
    lineage,
    operation.comment
  )
  const commentEvidence =
    operation.comment.refKind === 'created'
      ? null
      : resolveCommentRefV1(
          project,
          operation.comment,
          conflictResolverAdapters(input, project, lineage)
        )
  if (commentEvidence)
    addOwnerTargetRead(
      projection,
      project,
      lineage,
      commentEvidence.targetIndex
    )
  if (operation.kind === 'comment.updateText')
  {
    addEntityRead(projection, 'comment', commentId, 'text')
    addEntityWrite(projection, 'comment', commentId, 'text')
  }
  else if (operation.kind === 'comment.move')
  {
    for (const edit of operation.edits)
    {
      addEntityRead(projection, 'comment', commentId, edit.property)
      addEntityWrite(projection, 'comment', commentId, edit.property)
    }
  }
  else if (operation.kind === 'comment.attach')
  {
    addEntityRead(projection, 'comment', commentId, 'attachment')
    addEntityWrite(projection, 'comment', commentId, 'attachment')
    const blockId = conflictBlockLineage(
      input,
      project,
      lineage,
      operation.block
    )
    addEntityRead(projection, 'block', blockId, 'comment')
    addEntityWrite(projection, 'block', blockId, 'comment')
  }
  else if (operation.kind === 'comment.detach')
  {
    addEntityRead(projection, 'comment', commentId, 'attachment')
    addEntityWrite(projection, 'comment', commentId, 'attachment')
    const blockId = conflictBlockLineage(
      input,
      project,
      lineage,
      operation.expectedBlock
    )
    addEntityRead(projection, 'block', blockId, 'comment')
    addEntityWrite(projection, 'block', blockId, 'comment')
  }
  else
  {
    addEntityRead(projection, 'comment', commentId)
    const base = entityConflictResource('comment', commentId)
    projection.writes.add(base)
    projection.deletes.add(base)
    if (commentEvidence?.attachedBlockId)
    {
      const block = entityLineageIn(
        project,
        lineage,
        'block',
        commentEvidence.targetIndex,
        `block:${commentEvidence.attachedBlockId}`
      )
      addEntityRead(projection, 'block', block.lineageId, 'comment')
      addEntityWrite(projection, 'block', block.lineageId, 'comment')
    }
  }
}

function scriptWorkspaceConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: SemanticEditOperationScriptMoveWorkspaceV1,
  projection: MutableConflictProjectionV1
): void
{
  const scriptId = conflictScriptLineage(
    input,
    project,
    lineage,
    operation.script
  )
  if (operation.script.refKind !== 'created')
  {
    const evidence = resolveScriptRefV1(
      project,
      operation.script,
      conflictResolverAdapters(input, project, lineage)
    )
    addOwnerTargetRead(projection, project, lineage, evidence.targetIndex)
  }
  for (const property of ['workspaceX', 'workspaceY'])
  {
    addEntityRead(projection, 'script', scriptId, property)
    addEntityWrite(projection, 'script', scriptId, property)
  }
}

function authoredTreeAliases(value: unknown): readonly string[]
{
  const aliases = new Set<string>()
  const visit = (entry: unknown): void =>
  {
    if (entry === null || typeof entry !== 'object') return
    if (Array.isArray(entry))
    {
      for (const child of entry) visit(child)
      return
    }
    const record = entry as Readonly<Record<string, unknown>>
    if (typeof record.localAlias === 'string') aliases.add(record.localAlias)
    for (const child of Object.values(record)) visit(child)
  }
  visit(value)
  return Object.freeze([...aliases].sort())
}

function createdEntityConflictResource(
  entityKind: 'script' | 'block' | 'procedure' | 'parameter',
  opId: string,
  slot: Readonly<Record<string, unknown>>
): string
{
  return entityConflictResource(
    entityKind,
    conflictResource(`created-${entityKind}`, { opId, slot })
  )
}

function addCreatedScriptAndRootResources(
  projection: MutableConflictProjectionV1,
  operation: SemanticEditOperationV1,
  aliases: readonly { readonly alias: string; readonly slotKind: string }[]
): void
{
  const script = createdEntityConflictResource('script', operation.opId, {
    slotKind: 'fixed',
    name: 'script',
  })
  const root = createdEntityConflictResource('block', operation.opId, {
    slotKind: 'fixed',
    name: 'rootBlock',
  })
  for (const resource of [script, root])
  {
    projection.writes.add(resource)
    projection.createdDependencyResources.add(resource)
  }
  for (const alias of aliases)
  {
    const resource = createdEntityConflictResource('block', operation.opId, {
      slotKind: alias.slotKind,
      alias: alias.alias,
    })
    projection.writes.add(resource)
    projection.createdDependencyResources.add(resource)
  }
}

function addCreatedBlockResources(
  projection: MutableConflictProjectionV1,
  operation: SemanticEditOperationV1,
  aliases: readonly string[]
): void
{
  const root = createdEntityConflictResource('block', operation.opId, {
    slotKind: 'fixed',
    name: 'rootBlock',
  })
  projection.writes.add(root)
  projection.createdDependencyResources.add(root)
  for (const alias of aliases)
  {
    const resource = createdEntityConflictResource('block', operation.opId, {
      slotKind: 'blockAlias',
      alias,
    })
    projection.writes.add(resource)
    projection.createdDependencyResources.add(resource)
  }
}

function groupDConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: SemanticEditOperationV1,
  projection: MutableConflictProjectionV1
): void
{
  if (operation.kind === 'script.add')
  {
    const targetId = conflictTargetLineage(
      input,
      project,
      lineage,
      operation.target
    )
    addEntityRead(projection, 'target', targetId)
    const collection = conflictResource('script-collection', {
      targetLineageId: targetId,
    })
    projection.reads.add(collection)
    projection.writes.add(collection)
    addCreatedScriptAndRootResources(
      projection,
      operation,
      authoredTreeAliases(operation.root).map((alias) => ({
        alias,
        slotKind: 'blockAlias',
      }))
    )
    return
  }
  if (operation.kind === 'script.duplicate')
  {
    const scriptId = conflictScriptLineage(
      input,
      project,
      lineage,
      operation.script
    )
    addEntityRead(projection, 'script', scriptId)
    addCreatedScriptAndRootResources(
      projection,
      operation,
      operation.exposeClones.map((clone) => ({
        alias: clone.alias,
        slotKind: 'cloneAlias',
      }))
    )
    return
  }
  if (operation.kind === 'script.remove')
  {
    const scriptId = conflictScriptLineage(
      input,
      project,
      lineage,
      operation.script
    )
    addEntityRead(projection, 'script', scriptId)
    const resource = entityConflictResource('script', scriptId)
    projection.writes.add(resource)
    projection.deletes.add(resource)
    return
  }
  if (
    operation.kind === 'block.insertBefore' ||
    operation.kind === 'block.insertAfter'
  )
  {
    const anchorId = conflictBlockLineage(
      input,
      project,
      lineage,
      operation.anchor
    )
    addEntityRead(projection, 'block', anchorId)
    addEntityWrite(projection, 'block', anchorId)
    addCreatedBlockResources(
      projection,
      operation,
      authoredTreeAliases(operation.tree)
    )
    return
  }
  if (operation.kind === 'block.insertSubstack')
  {
    const ownerId = conflictBlockLineage(
      input,
      project,
      lineage,
      operation.owner
    )
    addEntityRead(projection, 'block', ownerId, operation.inputName)
    addEntityWrite(projection, 'block', ownerId, operation.inputName)
    addCreatedBlockResources(
      projection,
      operation,
      authoredTreeAliases(operation.tree)
    )
    return
  }
  if (
    operation.kind === 'block.replace' ||
    operation.kind === 'block.move' ||
    operation.kind === 'block.remove' ||
    operation.kind === 'block.setField' ||
    operation.kind === 'block.setInput'
  )
  {
    const blockId = conflictBlockLineage(
      input,
      project,
      lineage,
      operation.block
    )
    const property =
      operation.kind === 'block.setField'
        ? operation.fieldName
        : operation.kind === 'block.setInput'
          ? operation.inputName
          : undefined
    addEntityRead(projection, 'block', blockId, property)
    addEntityWrite(projection, 'block', blockId, property)
    if (operation.kind === 'block.remove' || operation.kind === 'block.replace')
      projection.deletes.add(entityConflictResource('block', blockId))
    if (operation.kind === 'block.replace')
      addCreatedBlockResources(
        projection,
        operation,
        authoredTreeAliases(operation.replacement)
      )
    if (operation.kind === 'block.setInput')
    {
      const aliases = authoredTreeAliases(operation.value)
      if (aliases.length > 0)
        addCreatedBlockResources(projection, operation, aliases)
    }
    return
  }
  return fail(
    'edit.unsupported_operation',
    `operation ${operation.kind} is unavailable in the Group D conflict planner`
  )
}

// a procedure is addressed by its own lineage, so conflict planning resolves the
// exact location the operation names rather than any owned block
function conflictProcedureLineage(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: ProcedureRefV1
): string
{
  if (reference.refKind === 'created')
    return conflictResource('created-procedure', {
      opId: reference.opId,
      slot: reference.slot,
    })
  if (reference.refKind !== 'structural')
    return fail(
      'edit.unsupported_operation',
      'procedure handle references require a procedure handle authority'
    )
  if (reference.selectorKind !== 'exactLocation')
    return fail(
      'edit.unsupported_operation',
      'procedure match-set selectors require a procedure match authority'
    )
  const evidence = procedureEntityEvidenceSetV1(project).find(
    (candidate) =>
      candidate.semanticLocationSha256 === reference.location.fullLocationSha256
  )
  if (!evidence)
    return fail('edit.selector_no_match', 'procedure location is absent')
  return entityLineageIn(
    project,
    lineage,
    'procedure',
    evidence.targetIndex,
    `procedure:${evidence.proccode}`
  ).lineageId
}

// every result slot a Group E operation may produce, so a later operation that
// names one of them orders behind its creator
function addCreatedProcedureResources(
  projection: MutableConflictProjectionV1,
  operation: GroupEOperationV1,
  fixedNames: readonly string[],
  parameterLocalKeys: readonly string[],
  aliases: readonly string[]
): void
{
  const resources = [
    ...fixedNames.map((name) =>
      createdEntityConflictResource(
        name === 'procedure'
          ? 'procedure'
          : name === 'rootBlock'
            ? 'block'
            : 'script',
        operation.opId,
        { slotKind: 'fixed', name }
      )
    ),
    ...parameterLocalKeys.map((localKey) =>
      createdEntityConflictResource('parameter', operation.opId, {
        slotKind: 'parameter',
        localKey,
      })
    ),
    ...aliases.map((alias) =>
      createdEntityConflictResource('block', operation.opId, {
        slotKind: 'blockAlias',
        alias,
      })
    ),
  ]
  for (const resource of resources)
  {
    projection.writes.add(resource)
    projection.createdDependencyResources.add(resource)
  }
}

function groupEConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: GroupEOperationV1,
  projection: MutableConflictProjectionV1
): void
{
  if (operation.kind === 'procedure.add')
  {
    const targetId = conflictTargetLineage(
      input,
      project,
      lineage,
      operation.target
    )
    addEntityRead(projection, 'target', targetId)
    // a new procedure claims both collections: the proccode namespace it joins
    // & the script collection its definition lands in
    for (const kind of ['procedure-collection', 'script-collection'])
    {
      const resource = conflictResource(kind, { targetLineageId: targetId })
      projection.reads.add(resource)
      projection.writes.add(resource)
    }
    addCreatedProcedureResources(
      projection,
      operation,
      ['procedure', 'definitionScript'],
      canonicalProcedureSignatureV1(operation.signature).parameters.map(
        (parameter) => parameter.localKey
      ),
      authoredTreeAliases(operation.body)
    )
    return
  }
  const procedureId = conflictProcedureLineage(
    project,
    lineage,
    operation.procedure
  )
  addEntityRead(projection, 'procedure', procedureId)
  if (operation.kind === 'procedure.remove')
  {
    const resource = entityConflictResource('procedure', procedureId)
    projection.writes.add(resource)
    projection.deletes.add(resource)
    return
  }
  if (operation.kind === 'procedure.setCallArgument')
  {
    const callId = conflictBlockLineage(input, project, lineage, operation.call)
    addEntityRead(projection, 'block', callId)
    addEntityWrite(projection, 'block', callId)
    addCreatedProcedureResources(
      projection,
      operation,
      ['rootBlock'],
      [],
      authoredTreeAliases(operation.value)
    )
    return
  }
  // a signature update rewrites the prototype, every mapped call, & every
  // argument reporter, so it claims the procedure & each call it maps
  addEntityWrite(projection, 'procedure', procedureId, 'signature')
  for (const mapping of operation.callSites)
  {
    const callId = conflictBlockLineage(input, project, lineage, mapping.call)
    addEntityRead(projection, 'block', callId)
    addEntityWrite(projection, 'block', callId)
  }
  addCreatedProcedureResources(
    projection,
    operation,
    [],
    operation.parameterLineage.flatMap((entry) =>
      entry.lineage.kind === 'create' ? [entry.parameterLocalKey] : []
    ),
    authoredTreeAliases(operation.callSites)
  )
}

// costumes & sounds are two separate serialized arrays, so an order domain is
// claimed per target & per kind: only same-kind operations reindex each other
function mediaOrderConflictResource(
  targetLineageId: string,
  mediaKind: 'costume' | 'sound'
): string
{
  return conflictResource('media-order-domain', { targetLineageId, mediaKind })
}

// keyed by the name itself rather than by the whole namespace, so two renames of
// different records stay compatible while two renames to one name do not

// the fold is the uppercase hat rule, under which two stage backdrops differing
// only by case are the same receiver
function mediaNameConflictResource(
  targetLineageId: string,
  mediaKind: 'costume' | 'sound',
  name: string
): string
{
  return conflictResource('media-name-domain', {
    targetLineageId,
    mediaKind,
    foldedName: name.toUpperCase(),
  })
}

// the archive is content-addressed, so several records may share one entry & the
// payload digest is what an add, replace, or remove genuinely claims
function mediaArchiveConflictResource(archiveKey: string): string
{
  return conflictResource('media-archive-entry', { archiveKey })
}

// everything a media operation needs about the record it names, resolved either
// from pre-batch evidence or from the exact add that mints it in this batch
interface MediaConflictSelectionV1
{
  readonly lineageId: string
  readonly targetLineageId: string
  readonly mediaKind: 'costume' | 'sound'
  readonly name: string
  readonly archiveKey: string | null
  readonly evidence: MediaRecordEntityEvidenceV1 | null
}

// a same-batch created record has no pre-batch location at all, so its domain
// facts come from its creator exactly as a created declaration rename's do
function conflictMediaSelection(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  reference: MediaRefV1,
  operations: readonly SemanticEditOperationV1[]
): MediaConflictSelectionV1
{
  if (reference.refKind === 'created')
  {
    const createdBy = operations.find(
      (candidate) => candidate.opId === reference.opId
    )
    if (
      createdBy?.kind !== 'media.addCostume' &&
      createdBy?.kind !== 'media.addSound'
    )
      return fail(
        'edit.internal_invariant',
        'created media reference has no exact creator operation'
      )
    return {
      lineageId: conflictResource('created-media', {
        opId: reference.opId,
        slot: reference.slot,
      }),
      targetLineageId: conflictTargetLineage(
        input,
        project,
        lineage,
        createdBy.target
      ),
      mediaKind: createdBy.kind === 'media.addCostume' ? 'costume' : 'sound',
      name: createdBy.name,
      archiveKey: createdBy.asset.expectedPayloadSha256,
      evidence: null,
    }
  }
  const evidence = resolveMediaRefV1(
    project,
    reference,
    conflictResolverAdapters(input, project, lineage)
  )
  const targetLineageId = targetLineageAt(
    lineage,
    project.json.targets.length,
    evidence.targetIndex
  ).lineageId
  return {
    lineageId: mediaLineageAt(
      lineage,
      evidence.mediaKind,
      targetLineageId,
      evidence.ordinal
    ).lineageId,
    targetLineageId,
    mediaKind: evidence.mediaKind,
    name: evidence.name,
    archiveKey: evidence.payloadSha256 ?? evidence.archivePath,
    evidence,
  }
}

// `currentCostume` is a per-target singleton, so every costume operation that can
// shift or set the selected index claims that one leaf & orders against the rest
function addCurrentCostumeConflict(
  projection: MutableConflictProjectionV1,
  targetLineageId: string,
  authority: 'reconciled' | 'authoritative'
): void
{
  addEntityRead(projection, 'target', targetLineageId, 'currentCostume')
  addEntityWrite(projection, 'target', targetLineageId, 'currentCostume')
  const resource = entityConflictResource(
    'target',
    targetLineageId,
    'currentCostume'
  )
  if (authority === 'authoritative')
    projection.authoritativeSelectionResources.add(resource)
  else projection.reconciledSelectionResources.add(resource)
}

// the declared effective selection is a precondition on one exact record, so a
// concurrent removal of that record is what has to be refused
function addCurrentSelectionConflict(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  precondition: CostumeSelectionPreconditionV1,
  operations: readonly SemanticEditOperationV1[],
  projection: MutableConflictProjectionV1
): void
{
  if (precondition.selectionState !== 'selected') return
  addEntityRead(
    projection,
    'media',
    conflictMediaSelection(
      input,
      project,
      lineage,
      precondition.expectedEffectiveCurrentCostume,
      operations
    ).lineageId
  )
}

function addDomainConflict(
  projection: MutableConflictProjectionV1,
  resources: readonly string[]
): void
{
  for (const resource of resources)
  {
    projection.reads.add(resource)
    projection.writes.add(resource)
  }
}

function mediaConflictResources(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: GroupFOperationV1,
  operations: readonly SemanticEditOperationV1[],
  projection: MutableConflictProjectionV1
): void
{
  // an add claims the whole insertion: the order it shifts, the name it takes,
  // the archive entry it materializes, & the record it mints
  if (
    operation.kind === 'media.addCostume' ||
    operation.kind === 'media.addSound'
  )
  {
    const targetLineageId = conflictTargetLineage(
      input,
      project,
      lineage,
      operation.target
    )
    const mediaKind =
      operation.kind === 'media.addCostume' ? 'costume' : 'sound'
    addEntityRead(projection, 'target', targetLineageId)
    const order = mediaOrderConflictResource(targetLineageId, mediaKind)
    const name = mediaNameConflictResource(
      targetLineageId,
      mediaKind,
      operation.name
    )
    addDomainConflict(projection, [
      order,
      name,
      mediaArchiveConflictResource(operation.asset.expectedPayloadSha256),
    ])
    const created = entityConflictResource(
      'media',
      conflictResource('created-media', {
        opId: operation.opId,
        slot: { slotKind: 'fixed', name: 'media' },
      })
    )
    projection.writes.add(created)
    // an add claims the order & the name only because it mints the record, so a
    // later operation naming that record orders behind it rather than refusing
    for (const resource of [created, order, name])
      projection.createdDependencyResources.add(resource)
    if (operation.kind !== 'media.addCostume') return
    addCurrentCostumeConflict(projection, targetLineageId, 'reconciled')
    projection.createdDependencyResources.add(
      entityConflictResource('target', targetLineageId, 'currentCostume')
    )
    addCurrentSelectionConflict(
      input,
      project,
      lineage,
      operation.currentSelection,
      operations,
      projection
    )
    return
  }
  const selection = conflictMediaSelection(
    input,
    project,
    lineage,
    operation.media,
    operations
  )
  const { lineageId, targetLineageId, mediaKind } = selection
  if (
    operation.kind === 'media.renameCostume' ||
    operation.kind === 'media.renameSound'
  )
  {
    addEntityRead(projection, 'media', lineageId, 'name')
    addEntityWrite(projection, 'media', lineageId, 'name')
    // a rename frees the old name & claims the new one, so an operation taking
    // either of them is genuinely ordered against it
    addDomainConflict(projection, [
      mediaNameConflictResource(targetLineageId, mediaKind, selection.name),
      mediaNameConflictResource(targetLineageId, mediaKind, operation.newName),
    ])
    // the new name is propagated into every site that names the old one
    const evidence = selection.evidence
    if (!evidence) return
    addDomainConflict(
      projection,
      mediaReferenceEvidenceV1(project, {
        targetIndex: evidence.targetIndex,
        mediaKind: evidence.mediaKind,
        ordinal: evidence.ordinal,
      }).referencePaths.map(pathConflictResource)
    )
    return
  }
  if (
    operation.kind === 'media.reorderCostume' ||
    operation.kind === 'media.reorderSound'
  )
  {
    addEntityRead(projection, 'media', lineageId)
    addDomainConflict(projection, [
      mediaOrderConflictResource(targetLineageId, mediaKind),
    ])
    if (operation.kind !== 'media.reorderCostume') return
    addCurrentCostumeConflict(projection, targetLineageId, 'reconciled')
    addCurrentSelectionConflict(
      input,
      project,
      lineage,
      operation.currentSelection,
      operations,
      projection
    )
    return
  }
  // a replace rewrites the payload leaf alone: it neither reorders nor renames,
  // so it claims the entry it leaves behind & the entry it materializes
  if (
    operation.kind === 'media.replaceCostume' ||
    operation.kind === 'media.replaceSound'
  )
  {
    addEntityRead(projection, 'media', lineageId, 'payload')
    addEntityWrite(projection, 'media', lineageId, 'payload')
    addDomainConflict(projection, [
      mediaArchiveConflictResource(operation.asset.expectedPayloadSha256),
      ...(selection.archiveKey === null
        ? []
        : [mediaArchiveConflictResource(selection.archiveKey)]),
    ])
    return
  }
  if (
    operation.kind === 'media.removeCostume' ||
    operation.kind === 'media.removeSound'
  )
  {
    addEntityRead(projection, 'media', lineageId)
    const base = entityConflictResource('media', lineageId)
    projection.writes.add(base)
    projection.deletes.add(base)
    // a removal shifts the order, frees the name, & releases the archive entry
    addDomainConflict(projection, [
      mediaOrderConflictResource(targetLineageId, mediaKind),
      mediaNameConflictResource(targetLineageId, mediaKind, selection.name),
      ...(selection.archiveKey === null
        ? []
        : [mediaArchiveConflictResource(selection.archiveKey)]),
    ])
    if (operation.kind !== 'media.removeCostume') return
    addCurrentCostumeConflict(projection, targetLineageId, 'reconciled')
    addCurrentSelectionConflict(
      input,
      project,
      lineage,
      operation.currentSelection,
      operations,
      projection
    )
    return
  }
  // the written index is derived from where the selected record sits, so this
  // reads the order that names it & the record itself but shifts neither
  const ownerLineageId = conflictTargetLineage(
    input,
    project,
    lineage,
    operation.target
  )
  addEntityRead(projection, 'target', ownerLineageId)
  addEntityRead(projection, 'media', lineageId)
  // it deliberately does not claim the order domain: it shifts no ordinal, & the
  // ordinal it resolves is reverified against the running candidate at apply, so
  // a stale expectation fails closed there instead of being refused here
  addCurrentCostumeConflict(projection, ownerLineageId, 'authoritative')
  addCurrentSelectionConflict(
    input,
    project,
    lineage,
    operation.currentSelection,
    operations,
    projection
  )
}

function operationConflictProjection(
  input: EditTransactionInputV1,
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  operation: SemanticEditOperationV1,
  operations: readonly SemanticEditOperationV1[],
  referenceIndex?: SemanticReferenceIndex
): GroupCConflictOperationProjectionV1
{
  const projection = mutableConflictProjection()
  if (operation.kind.startsWith('target.'))
    targetConflictResources(
      input,
      project,
      lineage,
      operation as Extract<
        SemanticEditOperationV1,
        { kind: `target.${string}` }
      >,
      projection,
      referenceIndex
    )
  else if (operation.kind.startsWith('declaration.'))
    declarationConflictResources(
      input,
      project,
      lineage,
      operation as DeclarationOperationV1,
      operations,
      projection
    )
  else if (operation.kind.startsWith('comment.'))
    commentConflictResources(
      input,
      project,
      lineage,
      operation as CommentOperationV1,
      projection
    )
  else if (operation.kind === 'script.moveWorkspace')
    scriptWorkspaceConflictResources(
      input,
      project,
      lineage,
      operation,
      projection
    )
  else if (
    operation.kind.startsWith('script.') ||
    operation.kind.startsWith('block.')
  )
    groupDConflictResources(input, project, lineage, operation, projection)
  else if (operation.kind.startsWith('procedure.'))
    groupEConflictResources(
      input,
      project,
      lineage,
      operation as GroupEOperationV1,
      projection
    )
  else if (operation.kind.startsWith('media.'))
    mediaConflictResources(
      input,
      project,
      lineage,
      operation as GroupFOperationV1,
      operations,
      projection
    )
  else
    return fail(
      'edit.unsupported_operation',
      `operation ${operation.kind} is unavailable in the Group C conflict planner`
    )
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    dependencies: conflictDependencies(operation),
    reads: uniqueSorted([...projection.reads]),
    writes: uniqueSorted([...projection.writes]),
    deletes: uniqueSorted([...projection.deletes]),
    createdDependencyResources: uniqueSorted([
      ...projection.createdDependencyResources,
    ]),
    reconciledSelectionResources: uniqueSorted([
      ...projection.reconciledSelectionResources,
    ]),
    authoritativeSelectionResources: uniqueSorted([
      ...projection.authoritativeSelectionResources,
    ]),
  }
}

function conflictOverlap(
  left: GroupCConflictOperationProjectionV1,
  right: GroupCConflictOperationProjectionV1
): readonly string[]
{
  const leftReads = new Set(left.reads)
  const leftWrites = new Set(left.writes)
  const rightReads = new Set(right.reads)
  const rightWrites = new Set(right.writes)
  const rightDeletes = new Set(right.deletes)
  const values = new Set<string>()
  for (const value of leftWrites)
    if (rightWrites.has(value) || rightReads.has(value)) values.add(value)
  for (const value of rightWrites) if (leftReads.has(value)) values.add(value)
  for (const value of left.deletes)
    if (
      rightReads.has(value) ||
      rightWrites.has(value) ||
      rightDeletes.has(value)
    )
      values.add(value)
  for (const value of right.deletes)
    if (leftReads.has(value) || leftWrites.has(value))
      values.add(value)
  return uniqueSorted([...values])
}

function productionGroupCConflictProofIndexedV1(
  input: EditTransactionInputV1,
  preBatch: ProjectIR,
  preBatchLineage: SemanticLineageSnapshot,
  operations: readonly SemanticEditOperationV1[],
  referenceIndex?: SemanticReferenceIndex
): GroupCConflictProofV1
{
  const projected = operations.map((operation) =>
  {
    try
    {
      return operationConflictProjection(
        input,
        preBatch,
        preBatchLineage,
        operation,
        operations,
        referenceIndex
      )
    }
    catch (error)
    {
      const record =
        error !== null && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : null
      const code = record?.['code']
      if (code === 'edit.stale_handle')
        return fail(
          code,
          error instanceof Error ? error.message : String(error),
          { opId: operation.opId }
        )
      throw error
    }
  })
  const decisions: GroupCConflictDecisionV1[] = []
  for (let leftIndex = 0; leftIndex < projected.length; leftIndex += 1)
  {
    const left = projected[leftIndex]!
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < projected.length;
      rightIndex += 1
    )
    {
      const right = projected[rightIndex]!
      const overlap = conflictOverlap(left, right)
      const createdExemptions = right.dependencies.includes(left.opId)
        ? overlap.filter((resource) =>
            left.createdDependencyResources.includes(resource)
          )
        : Object.freeze([] as string[])
      // a reconciliation asserts no batch-final value, so a later explicit set
      // of that leaf supersedes it. the reverse order stays a conflict, where
      // the reconciliation would instead overwrite the caller's instruction
      const supersededExemptions = overlap.filter(
        (resource) =>
          left.reconciledSelectionResources.includes(resource) &&
          right.authoritativeSelectionResources.includes(resource)
      )
      const unexempted = overlap.filter(
        (resource) =>
          !createdExemptions.includes(resource) &&
          !supersededExemptions.includes(resource)
      )
      if (unexempted.length > 0)
        return fail(
          'edit.project_constraint',
          `operations ${left.opId} and ${right.opId} conflict at ${unexempted[0]}`
        )
      decisions.push({
        leftOpId: left.opId,
        rightOpId: right.opId,
        decision:
          createdExemptions.length > 0
            ? 'created-dependency'
            : supersededExemptions.length > 0
              ? 'superseded-selection'
              : 'compatible',
        overlappingResources: overlap,
        exemptCreatedDependencyResources: uniqueSorted(createdExemptions),
      })
    }
  }
  const projection = {
    kind: 'group-c-operation-conflict-proof' as const,
    schemaVersion: 1 as const,
    operations: Object.freeze(projected),
    pairwiseDecisions: Object.freeze(decisions),
  }
  return Object.freeze({
    ...projection,
    proofSha256: semanticHashV1('resolved-plan', projection),
  })
}

export function productionGroupCConflictProofV1(
  input: EditTransactionInputV1,
  preBatch: ProjectIR,
  preBatchLineage: SemanticLineageSnapshot,
  operations: readonly SemanticEditOperationV1[]
): GroupCConflictProofV1
{
  return productionGroupCConflictProofIndexedV1(
    input,
    preBatch,
    preBatchLineage,
    operations
  )
}

export function productionGroupCConflictProofWithIndexV1(
  input: EditTransactionInputV1,
  preBatch: ProjectIR,
  preBatchLineage: SemanticLineageSnapshot,
  operations: readonly SemanticEditOperationV1[],
  referenceIndex: SemanticReferenceIndex
): GroupCConflictProofV1
{
  return productionGroupCConflictProofIndexedV1(
    input,
    preBatch,
    preBatchLineage,
    operations,
    referenceIndex
  )
}

export function groupCProductionOperationDispatchersV1(): readonly ProductionOperationDispatcherV1[]
{
  return Object.freeze([
    new DeclarationProductionOperationDispatcherV1(),
    new CommentProductionOperationDispatcherV1(),
    new ScriptWorkspaceProductionOperationDispatcherV1(),
  ])
}
