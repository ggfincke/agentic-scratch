// packages/edit/src/dispatch/dispatcher-primitives.ts
// exact pure project, reference, projection, & planning-fact constructors

import { ProjectIR } from '@scratch-agent/ir'
import {
  blockBoundedLocationProjectionV1,
  commentBoundedLocationProjectionV1,
  semanticHashV1,
  declarationBoundedLocationProjectionV1,
  targetBoundedLocationProjectionV1,
  type BlockEntityEvidenceV1,
  type CommentEntityEvidenceV1,
  type CommentRefV1,
  type ContractEntityBindingV1,
  type ContractEntityRefV1,
  type DeclarationEntityEvidenceV1,
  type DeclarationRefV1,
  type SemanticLineageKind,
  type SemanticLineageSnapshot,
  type TargetEntityEvidenceV1,
} from '@scratch-agent/ir/edit'

import {
  futureBindingKeySha256V1,
  type FutureBindingLedgerV1,
} from '../lineage/future-binding-ledger.js'
import {
  createSemanticLineageV1,
  type CreatedSemanticLineageV1,
} from '../lineage/lineage.js'
import type {
  ProductionFutureBindingRealizationCandidateV1,
  ProductionOperationContextV1,
} from '../transaction/production-transaction.js'
import type { EditOperationPlanningFactV1 } from '../transaction/transaction.js'

export function dispatcherUniqueSortedV1(
  values: readonly string[]
): readonly string[]
{
  return Object.freeze([...new Set(values)].sort())
}

export function productionOperationResultV1<
  Operation extends { readonly opId: string; readonly kind: string },
  FixedSlot,
  DynamicSlot,
>(
  operation: Operation,
  selectedLineageIds: readonly string[],
  fixedSlots: readonly FixedSlot[],
  effectEvidence: unknown,
  dynamicSlots: readonly DynamicSlot[]
): Readonly<{
  readonly opId: string
  readonly operationKind: Operation['kind']
  readonly selectedLineageIds: readonly string[]
  readonly fixedSlots: readonly FixedSlot[]
  readonly dynamicSlots?: readonly DynamicSlot[]
  readonly postconditionSha256: string
}>
{
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    selectedLineageIds: dispatcherUniqueSortedV1(selectedLineageIds),
    fixedSlots: Object.freeze([...fixedSlots]),
    ...(dynamicSlots.length > 0
      ? { dynamicSlots: Object.freeze([...dynamicSlots]) }
      : {}),
    postconditionSha256: semanticHashV1('evidence-content', {
      kind: 'group-c-operation-postcondition',
      schemaVersion: 1,
      operationKind: operation.kind,
      opId: operation.opId,
      postcondition: effectEvidence,
    }),
  })
}

export function createProductionLineageV1(
  context: ProductionOperationContextV1,
  operationId: string,
  kind: Extract<
    SemanticLineageKind,
    | 'declaration'
    | 'comment'
    | 'script'
    | 'block'
    | 'procedure'
    | 'parameter'
    | 'costume'
    | 'sound'
    | 'target'
  >,
  ownerLineageId: string | null,
  rawIdentity: string,
  canonicalOrdinal: number | null,
  creationKey: string,
  activeLineage: SemanticLineageSnapshot
): CreatedSemanticLineageV1
{
  return createSemanticLineageV1({
    lineageHistory: context.input.currentRevision
      .lineageHistory as SemanticLineageSnapshot,
    activeLineage,
    predecessorAcceptedHistorySha256: context.input.acceptedHistorySha256,
    operationId,
    entityKind: kind,
    ownerLineageId,
    rawIdentity,
    canonicalOrdinal,
    creationKey,
  })
}

export function futureBindingAlreadyRealizedV1(
  changeContractSha256: string,
  ledger: FutureBindingLedgerV1,
  bindingKey: string
): boolean
{
  const bindingKeySha256 = futureBindingKeySha256V1(
    changeContractSha256,
    bindingKey
  )
  return ledger.realizations.some(
    (realization) => realization.bindingKeySha256 === bindingKeySha256
  )
}

interface FutureBindingRealizationMatchV1
{
  readonly binding: {
    readonly bindingKey: string
    readonly entityKind: ProductionFutureBindingRealizationCandidateV1['createdEntityKind']
    readonly entitySubtype: ProductionFutureBindingRealizationCandidateV1['createdEntitySubtype']
  }
  readonly slot: {
    readonly lineageId: string
    readonly ownerLineageId: string | null
  }
  readonly collisionNonce: number
  readonly creationKey: string
}

export function bindingRealizationCandidatesV1<
  Match extends FutureBindingRealizationMatchV1,
>(
  matches: readonly Match[]
): readonly ProductionFutureBindingRealizationCandidateV1[]
{
  return Object.freeze(
    matches.map((match) => ({
      bindingKey: match.binding.bindingKey,
      createdEntityKind: match.binding.entityKind,
      createdEntitySubtype: match.binding.entitySubtype,
      collisionNonce: match.collisionNonce,
      creationKey: match.creationKey,
      resultLineageId: match.slot.lineageId,
      ownerLineageId: match.slot.ownerLineageId,
    }))
  )
}

export function exactContractRefV1(
  bindings: readonly ContractEntityBindingV1[],
  bindingKeys: readonly string[],
  expectedEntityKind: ContractEntityBindingV1['entityKind'],
  expectedEntitySubtype: ContractEntityBindingV1['entitySubtype'],
  failCardinality: () => never,
  failKindOrSubtype: () => never
): ContractEntityRefV1
{
  if (bindingKeys.length !== 1) return failCardinality()
  const matches = bindings.filter(
    (binding) =>
      binding.bindingKey === bindingKeys[0] &&
      binding.entityKind === expectedEntityKind &&
      binding.entitySubtype === expectedEntitySubtype
  )
  if (matches.length !== 1) return failKindOrSubtype()
  const binding = matches[0]!
  return {
    contractRefKind: binding.bindingKind,
    bindingKey: binding.bindingKey,
    entityKind: binding.entityKind,
    entitySubtype: binding.entitySubtype,
  } as ContractEntityRefV1
}

export function cloneDispatcherProjectV1(project: ProjectIR): ProjectIR
{
  return ProjectIR.fromProjectJsonWithUidSnapshot(
    structuredClone(project.json),
    [...project.assets],
    project.uids.snapshot()
  )
}

export function targetPlanningProjectionV1(evidence: TargetEntityEvidenceV1)
{
  return {
    entityKind: 'target',
    entitySubtype: evidence.targetKind,
    boundedLocation: targetBoundedLocationProjectionV1(
      evidence,
      `target-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  } as const
}

export function blockPlanningProjectionV1(evidence: BlockEntityEvidenceV1)
{
  return {
    entityKind: 'block',
    entitySubtype: 'unspecialized',
    boundedLocation: blockBoundedLocationProjectionV1(
      evidence,
      `block-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  } as const
}

export function exactDeclarationRefV1(
  evidence: DeclarationEntityEvidenceV1
): DeclarationRefV1
{
  return {
    entityKind: 'declaration',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: declarationBoundedLocationProjectionV1(
      evidence,
      `declaration-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

export function exactCommentRefV1(
  evidence: CommentEntityEvidenceV1
): CommentRefV1
{
  return {
    entityKind: 'comment',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: commentBoundedLocationProjectionV1(
      evidence,
      `comment-location-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

export function completedPlanningFactV1(
  destination: string,
  valueKind: EditOperationPlanningFactV1['value']['valueKind'],
  value: unknown
): EditOperationPlanningFactV1
{
  return {
    destination,
    value: { valueKind, value } as EditOperationPlanningFactV1['value'],
  }
}
