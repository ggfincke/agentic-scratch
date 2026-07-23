// packages/ir/src/edit/block-operations.ts
// apply guarded statement, expression, field, input, & same-target block edits

import {
  defineScratchRecordValue,
  deleteScratchRecordValue,
  isBlockEntry,
  scratchRecordValue,
  type Block,
  type BlockField,
  type BlockInput,
  type Target,
} from '@scratch-agent/sb3'

import type { ProjectIR } from '../project/project-ir.js'
import { jsonPointerPart as pointerPart } from '../project/project-vocabulary.js'
import type {
  SemanticEditOperationBlockInsertAfterV1,
  SemanticEditOperationBlockInsertBeforeV1,
  SemanticEditOperationBlockInsertSubstackV1,
  SemanticEditOperationBlockMoveV1,
  SemanticEditOperationBlockRemoveV1,
  SemanticEditOperationBlockReplaceV1,
  SemanticEditOperationBlockSetFieldV1,
  SemanticEditOperationBlockSetInputV1,
  SemanticFieldValueV1,
  SemanticInputValueV1,
  SemanticReplacementV1,
  SemanticStatementSequenceV1,
} from './contracts.generated.js'
import {
  blockFieldFingerprintV1,
  blockInputFingerprintV1,
  clearTopLevelWorkspaceV1,
  commentSetSha256V1,
  commitGraphAllocatorV1,
  deleteExactCommentsV1,
  deleteGraphClosureV1,
  graphBlockV1,
  inputShadowFingerprintV1,
  installGraphClosureV1,
  planGraphClosureV1,
  rewriteInboundEdgeV1,
  setTopLevelWorkspaceV1,
  type GraphClosurePlanV1,
  type GraphInstalledClosureV1,
} from './graph-primitives.js'
import {
  compareLexicalTextV1 as compareText,
  sameStringSetV1 as sameSet,
} from './lexical-order.js'

type BlockStructuralOperationV1 =
  | SemanticEditOperationBlockInsertBeforeV1
  | SemanticEditOperationBlockInsertAfterV1
  | SemanticEditOperationBlockInsertSubstackV1
  | SemanticEditOperationBlockReplaceV1
  | SemanticEditOperationBlockMoveV1
  | SemanticEditOperationBlockRemoveV1
  | SemanticEditOperationBlockSetFieldV1
  | SemanticEditOperationBlockSetInputV1

export interface ResolvedBlockDestinationV1
{
  readonly kind:
    | 'before'
    | 'after'
    | 'substack'
    | 'topLevelStatement'
    | 'input'
    | 'topLevelExpression'
    | 'procedureArgument'
  readonly targetIndex: number
  readonly blockId?: string
  readonly inputName?: string
  readonly inputConnection?: 'stringOrNumber' | 'number' | 'boolean'
  readonly workspace?: { readonly x: number; readonly y: number }
}

export type ResolvedCommentDispositionV1 =
  | { readonly kind: 'rejectIfPresent' }
  | { readonly kind: 'deleteExact'; readonly commentIds: readonly string[] }
  | {
      readonly kind: 'reattachExact'
      readonly mappings: readonly {
        readonly commentId: string
        readonly newBlockAlias: string
      }[]
    }

export type ResolvedBlockStructuralOperationV1 =
  | {
      readonly operation:
        | SemanticEditOperationBlockInsertBeforeV1
        | SemanticEditOperationBlockInsertAfterV1
      readonly targetIndex: number
      readonly anchorBlockId: string
    }
  | {
      readonly operation: SemanticEditOperationBlockInsertSubstackV1
      readonly targetIndex: number
      readonly ownerBlockId: string
    }
  | {
      readonly operation: SemanticEditOperationBlockReplaceV1
      readonly targetIndex: number
      readonly blockId: string
      readonly comments: ResolvedCommentDispositionV1
    }
  | {
      readonly operation: SemanticEditOperationBlockMoveV1
      readonly targetIndex: number
      readonly blockId: string
      readonly destination: ResolvedBlockDestinationV1
    }
  | {
      readonly operation: SemanticEditOperationBlockRemoveV1
      readonly targetIndex: number
      readonly blockId: string
      readonly comments: ResolvedCommentDispositionV1
    }
  | {
      readonly operation: SemanticEditOperationBlockSetFieldV1
      readonly targetIndex: number
      readonly blockId: string
    }
  | {
      readonly operation: SemanticEditOperationBlockSetInputV1
      readonly targetIndex: number
      readonly blockId: string
      readonly replacedInputComments: ResolvedCommentDispositionV1
    }

type GraphBlockShapeV1 =
  'stack' | 'reporter' | 'boolean' | 'hat' | 'cap' | 'cShape' | 'menuReporter'

export interface GraphInputDescriptorV1
{
  readonly name: string
  readonly required: boolean
  readonly connection:
    'stringOrNumber' | 'number' | 'boolean' | 'substack' | 'entityMenu'
}

export interface GraphBlockDescriptorV1
{
  readonly opcode: string
  readonly shape: GraphBlockShapeV1
  readonly category: string
  readonly acceptsSuccessor: boolean
  readonly mustTerminateSequence: boolean
  readonly inputs: readonly GraphInputDescriptorV1[]
}

export interface ExistingGraphBlockEvidenceV1
{
  readonly ok: boolean
  readonly safeForStructuralEdit: boolean
  readonly descriptor: GraphBlockDescriptorV1 | null
  readonly issues: readonly unknown[]
}

export interface LoweredSemanticInputV1
{
  readonly input: BlockInput | null
  readonly closure: GraphInstalledClosureV1 | null
}

export interface BlockOperationCatalogAdapterV1
{
  readonly validateExistingBlock: (block: Block) => ExistingGraphBlockEvidenceV1
  readonly lowerStatementSequence: (
    project: ProjectIR,
    targetIndex: number,
    sequence: SemanticStatementSequenceV1
  ) => GraphInstalledClosureV1
  readonly lowerReplacement: (
    project: ProjectIR,
    targetIndex: number,
    replacement: SemanticReplacementV1
  ) => GraphInstalledClosureV1
  readonly lowerInputValue: (
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    input: GraphInputDescriptorV1,
    value: SemanticInputValueV1,
    currentInput: BlockInput | undefined,
    preservedObscuredShadow: BlockInput[2] | undefined
  ) => LoweredSemanticInputV1
  readonly lowerFieldValue: (
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    fieldName: string,
    value: SemanticFieldValueV1
  ) => BlockField
}

export interface AppliedBlockStructuralOperationV1
{
  readonly opId: string
  readonly operationKind: BlockStructuralOperationV1['kind']
  readonly targetIndex: number
  readonly selectedBlockId: string
  readonly rootBlockId: string | null
  readonly createdTailBlockId: string | null
  readonly sourceGapRootBlockId: string | null
  readonly destinationScriptRootBlockId: string | null
  readonly createdBlockIds: readonly string[]
  readonly removedBlockIds: readonly string[]
  readonly removedCommentIds: readonly string[]
  readonly affectedBlockIds: readonly string[]
  readonly affectedCommentIds: readonly string[]
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly sourceGapAliasBlockIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
  readonly exactPaths: readonly string[]
}

class BlockStructuralOperationErrorV1 extends Error
{
  constructor(
    readonly code:
      | 'edit.cardinality_mismatch'
      | 'edit.entity_still_referenced'
      | 'edit.fingerprint_mismatch'
      | 'edit.graph_cycle'
      | 'edit.graph_failed'
      | 'edit.hat_cap_invariant'
      | 'edit.internal_invariant'
      | 'edit.invalid_move'
      | 'edit.invalid_owner'
      | 'edit.invalid_shape'
      | 'edit.planning_facts_mismatch'
      | 'edit.selector_no_match'
      | 'edit.shadow_invariant'
      | 'edit.unsupported_opcode'
      | 'edit.unsupported_operation',
    message: string,
    readonly matchCount: number | null = null
  )
  {
    super(message)
    this.name = 'BlockStructuralOperationErrorV1'
  }
}

function editError(
  code: BlockStructuralOperationErrorV1['code'],
  message: string,
  matchCount: number | null = null
): never
{
  throw new BlockStructuralOperationErrorV1(code, message, matchCount)
}

function changedRecordIds(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>> | undefined
): readonly string[]
{
  const beforeRecord = before ?? Object.create(null)
  const afterRecord = after ?? Object.create(null)
  const ids = new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ])
  return [...ids]
    .filter(
      (id) =>
        JSON.stringify(scratchRecordValue(beforeRecord, id)) !==
        JSON.stringify(scratchRecordValue(afterRecord, id))
    )
    .sort(compareText)
}

function completeAffectedGraphEvidence(
  result: AppliedBlockStructuralOperationV1,
  before: Target,
  after: Target
): AppliedBlockStructuralOperationV1
{
  const affectedBlockIds = changedRecordIds(before.blocks, after.blocks)
  const affectedCommentIds = changedRecordIds(before.comments, after.comments)
  const exactPaths = [
    ...affectedBlockIds.map(
      (blockId) =>
        `/targets/${result.targetIndex}/blocks/${pointerPart(blockId)}`
    ),
    ...affectedCommentIds.map(
      (commentId) =>
        `/targets/${result.targetIndex}/comments/${pointerPart(commentId)}`
    ),
  ]
  return {
    ...result,
    affectedBlockIds: Object.freeze(affectedBlockIds),
    affectedCommentIds: Object.freeze(affectedCommentIds),
    exactPaths: Object.freeze(exactPaths),
  }
}

function ownerTarget(project: ProjectIR, targetIndex: number): Target
{
  const value = project.json.targets[targetIndex]
  if (!value)
    return editError('edit.selector_no_match', 'block target is absent')
  return value
}

function descriptorFor(
  target: Target,
  blockId: string,
  adapter: BlockOperationCatalogAdapterV1
): GraphBlockDescriptorV1
{
  const raw = graphBlockV1(target, blockId)
  const validation = adapter.validateExistingBlock(raw)
  if (
    !validation.ok ||
    !validation.safeForStructuralEdit ||
    !validation.descriptor
  )
    return editError(
      'edit.unsupported_opcode',
      `block "${blockId}" is outside the exact curated structural profile`
    )
  return validation.descriptor
}

function assertCuratedOwnedClosure(
  target: Target,
  plan: GraphClosurePlanV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  for (const blockId of plan.orderedBlockIds)
    descriptorFor(target, blockId, adapter)
}

function isStatementShape(shape: GraphBlockShapeV1): boolean
{
  return shape === 'stack' || shape === 'cShape' || shape === 'cap'
}

function isExpressionShape(shape: GraphBlockShapeV1): boolean
{
  return shape === 'reporter' || shape === 'boolean'
}

function inputDescriptor(
  descriptor: GraphBlockDescriptorV1,
  inputName: string
): GraphInputDescriptorV1
{
  const matches = descriptor.inputs.filter((input) => input.name === inputName)
  if (matches.length !== 1)
    return editError(
      'edit.invalid_shape',
      `input "${inputName}" is not one exact descriptor input`
    )
  return matches[0]!
}

function assertExpectedClosure(
  plan: GraphClosurePlanV1,
  expectedSha256: string,
  expectedCount?: number
): void
{
  if (plan.closureSha256 !== expectedSha256)
    return editError(
      'edit.fingerprint_mismatch',
      'selected block closure fingerprint changed'
    )
  if (
    expectedCount !== undefined &&
    plan.orderedBlockIds.length !== expectedCount
  )
    return editError(
      'edit.cardinality_mismatch',
      'selected block closure count changed',
      plan.orderedBlockIds.length
    )
}

function setNestedRoot(target: Target, rootId: string, parentId: string): void
{
  clearTopLevelWorkspaceV1(target, rootId, parentId)
}

function exactInput(
  target: Target,
  ownerId: string,
  inputName: string
): BlockInput | undefined
{
  return scratchRecordValue(graphBlockV1(target, ownerId).inputs, inputName)
}

function setInput(
  target: Target,
  ownerId: string,
  inputName: string,
  value: BlockInput
): void
{
  const owner = graphBlockV1(target, ownerId)
  owner.inputs ??= Object.create(null) as Record<string, BlockInput>
  defineScratchRecordValue(owner.inputs, inputName, value)
}

function deleteInput(target: Target, ownerId: string, inputName: string): void
{
  const inputs = graphBlockV1(target, ownerId).inputs
  if (inputs !== undefined) deleteScratchRecordValue(inputs, inputName)
}

function setField(
  target: Target,
  ownerId: string,
  fieldName: string,
  value: BlockField
): void
{
  const owner = graphBlockV1(target, ownerId)
  owner.fields ??= Object.create(null) as Record<string, BlockField>
  defineScratchRecordValue(owner.fields, fieldName, value)
}

function verifyLoweredClosure(
  target: Target,
  lowered: GraphInstalledClosureV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  for (const blockId of lowered.blockIds)
    descriptorFor(target, blockId, adapter)
}

function assertTailCanInheritSuccessor(
  lowered: GraphInstalledClosureV1,
  successorId: string | null,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  if (successorId === null) return
  const tail = scratchRecordValue(lowered.blocks, lowered.tailId)
  if (!isBlockEntry(tail))
    return editError('edit.internal_invariant', 'lowered tail is absent')
  const validation = adapter.validateExistingBlock(tail)
  const descriptor = validation.descriptor
  if (!validation.safeForStructuralEdit || !descriptor)
    return editError('edit.invalid_shape', 'lowered tail is not curated')
  if (!descriptor.acceptsSuccessor || descriptor.mustTerminateSequence)
    return editError(
      'edit.hat_cap_invariant',
      'inserted sequence tail cannot inherit a successor'
    )
}

function installBefore(
  target: Target,
  anchorId: string,
  lowered: GraphInstalledClosureV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  const anchor = graphBlockV1(target, anchorId)
  const anchorDescriptor = descriptorFor(target, anchorId, adapter)
  if (
    !isStatementShape(anchorDescriptor.shape) ||
    anchorDescriptor.shape === 'hat'
  )
    return editError(
      'edit.invalid_shape',
      'insert-before anchor must be a statement block'
    )
  assertTailCanInheritSuccessor(lowered, anchorId, adapter)
  const anchorPlan = planGraphClosureV1(target, 'ownedBlock', anchorId)
  installGraphClosureV1(target, lowered)
  const tail = graphBlockV1(target, lowered.tailId)
  if (anchor.topLevel === true)
  {
    preserveOptionalWorkspace(target, lowered.rootId, anchor)
    anchor.topLevel = false
    anchor.parent = lowered.tailId
    delete anchor.x
    delete anchor.y
  }
  else
  {
    const edge = anchorPlan.rootInboundEdge
    if (!edge)
      return editError('edit.invalid_owner', 'anchor owner edge is absent')
    rewriteInboundEdgeV1(target, edge, anchorId, lowered.rootId)
    setNestedRoot(target, lowered.rootId, edge.ownerBlockId)
    anchor.parent = lowered.tailId
  }
  tail.next = anchorId
  verifyLoweredClosure(target, lowered, adapter)
}

function installAfter(
  target: Target,
  anchorId: string,
  lowered: GraphInstalledClosureV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  const anchor = graphBlockV1(target, anchorId)
  const descriptor = descriptorFor(target, anchorId, adapter)
  if (
    descriptor.shape === 'cap' ||
    descriptor.mustTerminateSequence ||
    !descriptor.acceptsSuccessor ||
    isExpressionShape(descriptor.shape) ||
    descriptor.shape === 'menuReporter' ||
    anchor.opcode === 'procedures_definition'
  )
    return editError(
      'edit.hat_cap_invariant',
      'insert-after anchor cannot accept a successor'
    )
  const successorId = typeof anchor.next === 'string' ? anchor.next : null
  assertTailCanInheritSuccessor(lowered, successorId, adapter)
  installGraphClosureV1(target, lowered)
  const root = graphBlockV1(target, lowered.rootId)
  const tail = graphBlockV1(target, lowered.tailId)
  anchor.next = lowered.rootId
  setNestedRoot(target, lowered.rootId, anchorId)
  tail.next = successorId
  if (successorId !== null)
    graphBlockV1(target, successorId).parent = lowered.tailId
  root.parent = anchorId
  verifyLoweredClosure(target, lowered, adapter)
}

function assertExpectedInputFingerprint(
  targetIndex: number,
  target: Target,
  ownerId: string,
  inputName: string,
  expected: string
): BlockInput | undefined
{
  const current = exactInput(target, ownerId, inputName)
  if (
    blockInputFingerprintV1(targetIndex, ownerId, inputName, current) !==
    expected
  )
    return editError(
      'edit.fingerprint_mismatch',
      `input "${inputName}" fingerprint changed`
    )
  return current
}

function installSubstack(
  targetIndex: number,
  target: Target,
  ownerId: string,
  inputName: string,
  expectedFingerprint: string,
  lowered: GraphInstalledClosureV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  const descriptor = descriptorFor(target, ownerId, adapter)
  const input = inputDescriptor(descriptor, inputName)
  if (input.connection !== 'substack')
    return editError(
      'edit.invalid_shape',
      'substack insertion requires a descriptor substack input'
    )
  const current = assertExpectedInputFingerprint(
    targetIndex,
    target,
    ownerId,
    inputName,
    expectedFingerprint
  )
  if (
    current !== undefined &&
    current.slice(1).some((value) => typeof value === 'string')
  )
    return editError(
      'edit.entity_still_referenced',
      'substack input is not empty',
      current.slice(1).filter((value) => typeof value === 'string').length
    )
  installGraphClosureV1(target, lowered)
  setInput(target, ownerId, inputName, [2, lowered.rootId])
  setNestedRoot(target, lowered.rootId, ownerId)
  verifyLoweredClosure(target, lowered, adapter)
}

function attachExistingSubstack(
  targetIndex: number,
  target: Target,
  ownerId: string,
  inputName: string,
  expectedFingerprint: string,
  rootId: string,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  const descriptor = descriptorFor(target, ownerId, adapter)
  if (inputDescriptor(descriptor, inputName).connection !== 'substack')
    return editError(
      'edit.invalid_shape',
      'moved statement requires a descriptor substack input'
    )
  const current = assertExpectedInputFingerprint(
    targetIndex,
    target,
    ownerId,
    inputName,
    expectedFingerprint
  )
  if (
    current !== undefined &&
    current.slice(1).some((value) => typeof value === 'string')
  )
    return editError(
      'edit.entity_still_referenced',
      'destination substack is not empty',
      current.slice(1).filter((value) => typeof value === 'string').length
    )
  setInput(target, ownerId, inputName, [2, rootId])
  setNestedRoot(target, rootId, ownerId)
}

function exactDispositionCommentIds(
  attached: readonly string[],
  disposition: ResolvedCommentDispositionV1
): readonly string[]
{
  if (disposition.kind === 'rejectIfPresent')
  {
    if (attached.length > 0)
      return editError(
        'edit.entity_still_referenced',
        'operation rejects attached comments',
        attached.length
      )
    return []
  }
  const resolved =
    disposition.kind === 'deleteExact'
      ? disposition.commentIds
      : disposition.mappings.map((mapping) => mapping.commentId)
  if (!sameSet(attached, resolved) || resolved.length !== attached.length)
    return editError(
      'edit.planning_facts_mismatch',
      'comment disposition is not the complete exact attached set'
    )
  return resolved
}

function applyReplacementComments(
  target: Target,
  attached: readonly string[],
  disposition: ResolvedCommentDispositionV1,
  aliases: Readonly<Record<string, string>>
): void
{
  exactDispositionCommentIds(attached, disposition)
  if (disposition.kind === 'deleteExact')
  {
    deleteExactCommentsV1(target, disposition.commentIds)
    return
  }
  if (disposition.kind !== 'reattachExact') return
  const usedBlocks = new Set<string>()
  for (const mapping of disposition.mappings)
  {
    const comment = scratchRecordValue(target.comments, mapping.commentId)
    const newBlockId = aliases[mapping.newBlockAlias]
    if (!comment || !newBlockId || usedBlocks.has(newBlockId))
      return editError(
        'edit.planning_facts_mismatch',
        'comment reattachment mapping is invalid'
      )
    const replacement = graphBlockV1(target, newBlockId)
    if (replacement.comment !== undefined)
      return editError(
        'edit.entity_still_referenced',
        'replacement block already has a comment',
        1
      )
    usedBlocks.add(newBlockId)
    comment.blockId = newBlockId
    replacement.comment = mapping.commentId
  }
}

function replaceOwnedClosure(
  target: Target,
  plan: GraphClosurePlanV1,
  lowered: GraphInstalledClosureV1,
  sourceDescriptor: GraphBlockDescriptorV1,
  disposition: ResolvedCommentDispositionV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  const source = graphBlockV1(target, plan.rootBlockId)
  const replacementRoot = scratchRecordValue(lowered.blocks, lowered.rootId)
  if (!isBlockEntry(replacementRoot))
    return editError(
      'edit.internal_invariant',
      'replacement root is absent from lowered closure'
    )
  const replacementValidation = adapter.validateExistingBlock(replacementRoot)
  const replacementDescriptor = replacementValidation.descriptor
  if (!replacementDescriptor || !replacementValidation.safeForStructuralEdit)
    return editError('edit.invalid_shape', 'replacement root is not curated')
  const sourceStatement = isStatementShape(sourceDescriptor.shape)
  if (
    sourceStatement !== isStatementShape(replacementDescriptor.shape) ||
    (!sourceStatement && sourceDescriptor.shape !== replacementDescriptor.shape)
  )
    return editError(
      'edit.invalid_shape',
      'replacement root category is incompatible with the source block'
    )
  const successorId =
    sourceStatement && typeof source.next === 'string' ? source.next : null
  if (sourceStatement)
    assertTailCanInheritSuccessor(lowered, successorId, adapter)
  installGraphClosureV1(target, lowered)
  if (source.topLevel === true)
    preserveOptionalWorkspace(target, lowered.rootId, source)
  else
  {
    if (!plan.rootInboundEdge)
      return editError(
        'edit.invalid_owner',
        'replacement source owner is absent'
      )
    rewriteInboundEdgeV1(
      target,
      plan.rootInboundEdge,
      plan.rootBlockId,
      lowered.rootId
    )
    setNestedRoot(target, lowered.rootId, plan.rootInboundEdge.ownerBlockId)
  }
  if (sourceStatement)
  {
    graphBlockV1(target, lowered.tailId).next = successorId
    if (successorId !== null)
      graphBlockV1(target, successorId).parent = lowered.tailId
  }
  applyReplacementComments(
    target,
    plan.attachedCommentIds,
    disposition,
    lowered.aliasBlockIds
  )
  deleteGraphClosureV1(target, plan)
  verifyLoweredClosure(target, lowered, adapter)
}

function currentActiveOwnedBlockId(
  target: Target,
  input: BlockInput | undefined
): string | null
{
  if (!input || (input[0] !== 2 && input[0] !== 3)) return null
  const value = input[1]
  if (typeof value !== 'string') return null
  const child = scratchRecordValue(target.blocks, value)
  return isBlockEntry(child) && child.shadow !== true ? value : null
}

function assertNoActiveOwnedBlock(
  target: Target,
  input: BlockInput | undefined
): void
{
  if (currentActiveOwnedBlockId(target, input) !== null)
    return editError(
      'edit.entity_still_referenced',
      'destination input already owns a non-shadow block',
      1
    )
}

function attachExistingToInput(
  targetIndex: number,
  target: Target,
  ownerId: string,
  inputName: string,
  expectedFingerprint: string,
  rootId: string,
  rootShape: GraphBlockShapeV1,
  adapter: BlockOperationCatalogAdapterV1,
  inputConnection?: 'stringOrNumber' | 'number' | 'boolean'
): void
{
  const connection =
    inputConnection ??
    inputDescriptor(descriptorFor(target, ownerId, adapter), inputName)
      .connection
  const booleanInput = connection === 'boolean'
  const expressionInput =
    connection === 'stringOrNumber' || connection === 'number'
  if (
    (rootShape === 'boolean' && !booleanInput) ||
    (rootShape === 'reporter' && !expressionInput) ||
    (rootShape !== 'boolean' && rootShape !== 'reporter')
  )
    return editError(
      'edit.invalid_shape',
      'moved expression is incompatible with the destination input'
    )
  const current = assertExpectedInputFingerprint(
    targetIndex,
    target,
    ownerId,
    inputName,
    expectedFingerprint
  )
  assertNoActiveOwnedBlock(target, current)
  let replacement: BlockInput
  if (booleanInput) replacement = [2, rootId]
  else if (current?.[0] === 1 && current[1] !== undefined)
    replacement = [3, rootId, structuredClone(current[1])]
  else replacement = [2, rootId]
  setInput(target, ownerId, inputName, replacement)
  setNestedRoot(target, rootId, ownerId)
}

function replaceSourceInput(
  project: ProjectIR,
  targetIndex: number,
  target: Target,
  plan: GraphClosurePlanV1,
  value: SemanticInputValueV1,
  expectedInputFingerprint: string,
  preservedShadow:
    | { readonly kind: 'requireNone' }
    | {
        readonly kind: 'preserveExact'
        readonly expectedShadowFingerprint: string
      },
  adapter: BlockOperationCatalogAdapterV1
): GraphInstalledClosureV1 | null
{
  const edge = plan.rootInboundEdge
  if (!edge || edge.kind !== 'input' || edge.slotIndex !== 1)
    return editError(
      'edit.invalid_owner',
      'expression source is not the active owned input block'
    )
  const ownerDescriptor = descriptorFor(target, edge.ownerBlockId, adapter)
  const descriptor = inputDescriptor(ownerDescriptor, edge.inputName)
  const current = assertExpectedInputFingerprint(
    targetIndex,
    target,
    edge.ownerBlockId,
    edge.inputName,
    expectedInputFingerprint
  )
  if (!current || current[1] !== plan.rootBlockId)
    return editError('edit.graph_failed', 'expression source input changed')
  const shadow = current[0] === 3 ? current[2] : undefined
  if (preservedShadow.kind === 'requireNone' && shadow !== undefined)
    return editError(
      'edit.shadow_invariant',
      'source input has an obscured shadow that must be preserved explicitly'
    )
  if (
    preservedShadow.kind === 'preserveExact' &&
    (shadow === undefined ||
      inputShadowFingerprintV1(
        targetIndex,
        edge.ownerBlockId,
        edge.inputName,
        shadow
      ) !== preservedShadow.expectedShadowFingerprint)
  )
    return editError(
      'edit.shadow_invariant',
      'source obscured shadow fingerprint changed'
    )
  const lowered = adapter.lowerInputValue(
    project,
    targetIndex,
    edge.ownerBlockId,
    descriptor,
    value,
    current,
    preservedShadow.kind === 'preserveExact' ? shadow : undefined
  )
  installLoweredInput(
    target,
    edge.ownerBlockId,
    edge.inputName,
    descriptor,
    lowered,
    adapter
  )
  return lowered.closure
}

function revealSourceShadow(
  targetIndex: number,
  target: Target,
  plan: GraphClosurePlanV1,
  expectedInputFingerprint: string,
  expectedShadowFingerprint: string
): void
{
  const edge = plan.rootInboundEdge
  if (!edge || edge.kind !== 'input' || edge.slotIndex !== 1)
    return editError(
      'edit.invalid_owner',
      'expression source is not an active input block'
    )
  const current = assertExpectedInputFingerprint(
    targetIndex,
    target,
    edge.ownerBlockId,
    edge.inputName,
    expectedInputFingerprint
  )
  if (
    !current ||
    current[0] !== 3 ||
    current[1] !== plan.rootBlockId ||
    current[2] === undefined ||
    inputShadowFingerprintV1(
      targetIndex,
      edge.ownerBlockId,
      edge.inputName,
      current[2]
    ) !== expectedShadowFingerprint
  )
    return editError(
      'edit.shadow_invariant',
      'exact obscured shadow is unavailable'
    )
  setInput(target, edge.ownerBlockId, edge.inputName, [
    1,
    structuredClone(current[2]),
  ])
}

function preserveOptionalWorkspace(
  target: Target,
  rootId: string,
  source: Block
): void
{
  const root = graphBlockV1(target, rootId)
  root.topLevel = true
  root.parent = null
  if (source.x === undefined) delete root.x
  else root.x = source.x
  if (source.y === undefined) delete root.y
  else root.y = source.y
}

function detachStatementSource(
  target: Target,
  plan: GraphClosurePlanV1,
  sourceGap: SemanticEditOperationBlockMoveV1['sourceGap']
): void
{
  const root = graphBlockV1(target, plan.rootBlockId)
  const successorId = plan.rootSuccessorBlockId
  if (sourceGap.kind === 'removeTopLevelScript')
  {
    if (root.topLevel !== true)
      return editError(
        'edit.invalid_owner',
        'removeTopLevelScript requires a top-level source'
      )
    const scriptPlan = planGraphClosureV1(target, 'script', plan.rootBlockId)
    if (
      scriptPlan.closureSha256 !== sourceGap.expectedScriptClosureSha256 ||
      !sameSet(scriptPlan.orderedBlockIds, plan.orderedBlockIds)
    )
      return editError(
        'edit.fingerprint_mismatch',
        'source is not the exact whole top-level script'
      )
    root.next = null
    return
  }
  if (sourceGap.kind !== 'spliceStatements')
    return editError(
      'edit.invalid_shape',
      'statement movement requires spliceStatements or exact script removal'
    )
  if (root.topLevel === true)
  {
    if (successorId === null)
      return editError(
        'edit.invalid_shape',
        'lone top-level statement requires removeTopLevelScript'
      )
    preserveOptionalWorkspace(target, successorId, root)
  }
  else
  {
    if (!plan.rootInboundEdge)
      return editError('edit.invalid_owner', 'statement source owner is absent')
    rewriteInboundEdgeV1(
      target,
      plan.rootInboundEdge,
      plan.rootBlockId,
      successorId
    )
    if (successorId !== null)
      graphBlockV1(target, successorId).parent =
        plan.rootInboundEdge.ownerBlockId
  }
  root.next = null
}

function sourceGapForExpression(
  project: ProjectIR,
  targetIndex: number,
  target: Target,
  plan: GraphClosurePlanV1,
  sourceGap: SemanticEditOperationBlockMoveV1['sourceGap'],
  adapter: BlockOperationCatalogAdapterV1
): GraphInstalledClosureV1 | null
{
  if (sourceGap.kind === 'removeTopLevelScript')
  {
    const root = graphBlockV1(target, plan.rootBlockId)
    if (root.topLevel !== true)
      return editError(
        'edit.invalid_owner',
        'removeTopLevelScript requires a top-level expression'
      )
    const script = planGraphClosureV1(target, 'script', plan.rootBlockId)
    if (
      script.closureSha256 !== sourceGap.expectedScriptClosureSha256 ||
      !sameSet(script.orderedBlockIds, plan.orderedBlockIds)
    )
      return editError(
        'edit.fingerprint_mismatch',
        'expression is not the exact whole top-level script'
      )
    return null
  }
  if (sourceGap.kind === 'revealExistingShadow')
  {
    revealSourceShadow(
      targetIndex,
      target,
      plan,
      sourceGap.expectedCurrentInputFingerprint,
      sourceGap.expectedShadowFingerprint
    )
    return null
  }
  if (sourceGap.kind === 'replaceInput')
    return replaceSourceInput(
      project,
      targetIndex,
      target,
      plan,
      sourceGap.value,
      sourceGap.expectedCurrentInputFingerprint,
      sourceGap.obscuredShadow,
      adapter
    )
  return editError(
    'edit.invalid_shape',
    'expression movement cannot splice statement adjacency'
  )
}

function attachMovedStatement(
  targetIndex: number,
  target: Target,
  rootId: string,
  destination: ResolvedBlockDestinationV1,
  operation: SemanticEditOperationBlockMoveV1,
  adapter: BlockOperationCatalogAdapterV1
): string | null
{
  if (destination.kind === 'topLevelStatement')
  {
    if (!destination.workspace)
      return editError('edit.internal_invariant', 'workspace is unresolved')
    setTopLevelWorkspaceV1(target, rootId, destination.workspace)
    return rootId
  }
  if (destination.kind === 'before' || destination.kind === 'after')
  {
    if (!destination.blockId)
      return editError('edit.internal_invariant', 'anchor is unresolved')
    if (destination.kind === 'before')
    {
      const anchor = graphBlockV1(target, destination.blockId)
      const anchorDescriptor = descriptorFor(
        target,
        destination.blockId,
        adapter
      )
      const movedDescriptor = descriptorFor(target, rootId, adapter)
      if (
        !isStatementShape(anchorDescriptor.shape) ||
        anchorDescriptor.shape === 'hat' ||
        !movedDescriptor.acceptsSuccessor ||
        movedDescriptor.mustTerminateSequence
      )
        return editError(
          'edit.hat_cap_invariant',
          'moved block cannot precede the destination anchor'
        )
      const anchorPlan = planGraphClosureV1(
        target,
        'ownedBlock',
        destination.blockId
      )
      const root = graphBlockV1(target, rootId)
      if (anchor.topLevel === true)
      {
        preserveOptionalWorkspace(target, rootId, anchor)
        anchor.topLevel = false
        anchor.parent = rootId
        delete anchor.x
        delete anchor.y
      }
      else
      {
        if (!anchorPlan.rootInboundEdge)
          return editError(
            'edit.invalid_owner',
            'destination anchor owner is absent'
          )
        rewriteInboundEdgeV1(
          target,
          anchorPlan.rootInboundEdge,
          destination.blockId,
          rootId
        )
        setNestedRoot(target, rootId, anchorPlan.rootInboundEdge.ownerBlockId)
        anchor.parent = rootId
      }
      root.next = destination.blockId
      return null
    }
    const anchor = graphBlockV1(target, destination.blockId)
    const descriptor = descriptorFor(target, destination.blockId, adapter)
    if (!descriptor.acceptsSuccessor || descriptor.mustTerminateSequence)
      return editError(
        'edit.hat_cap_invariant',
        'destination anchor cannot accept a moved successor'
      )
    const successor = typeof anchor.next === 'string' ? anchor.next : null
    const movedDescriptor = descriptorFor(target, rootId, adapter)
    if (
      successor !== null &&
      (!movedDescriptor.acceptsSuccessor ||
        movedDescriptor.mustTerminateSequence)
    )
      return editError(
        'edit.hat_cap_invariant',
        'moved cap block cannot inherit a destination successor'
      )
    anchor.next = rootId
    setNestedRoot(target, rootId, destination.blockId)
    graphBlockV1(target, rootId).next = successor
    if (successor !== null) graphBlockV1(target, successor).parent = rootId
    return null
  }
  if (destination.kind === 'substack')
  {
    if (!destination.blockId || !destination.inputName)
      return editError(
        'edit.internal_invariant',
        'substack destination is unresolved'
      )
    attachExistingSubstack(
      targetIndex,
      target,
      destination.blockId,
      destination.inputName,
      ExtractDestinationFingerprint(operation.destination),
      rootId,
      adapter
    )
    return null
  }
  return editError(
    'edit.invalid_shape',
    'statement block requires a statement destination'
  )
}

function ExtractDestinationFingerprint(
  destination: SemanticEditOperationBlockMoveV1['destination']
): string
{
  if (destination.kind !== 'substack')
    return editError(
      'edit.internal_invariant',
      'substack destination fingerprint is absent'
    )
  return destination.expectedCurrentInputFingerprint
}

function attachMovedExpression(
  targetIndex: number,
  target: Target,
  rootId: string,
  rootShape: GraphBlockShapeV1,
  destination: ResolvedBlockDestinationV1,
  operation: SemanticEditOperationBlockMoveV1,
  adapter: BlockOperationCatalogAdapterV1
): string | null
{
  if (destination.kind === 'topLevelExpression')
  {
    if (!destination.workspace)
      return editError('edit.internal_invariant', 'workspace is unresolved')
    setTopLevelWorkspaceV1(target, rootId, destination.workspace)
    return rootId
  }
  if (destination.kind === 'procedureArgument')
  {
    if (
      !destination.blockId ||
      !destination.inputName ||
      !destination.inputConnection ||
      operation.destination.kind !== 'procedureArgument'
    )
      return editError(
        'edit.internal_invariant',
        'procedure argument destination is unresolved'
      )
    attachExistingToInput(
      targetIndex,
      target,
      destination.blockId,
      destination.inputName,
      operation.destination.expectedCurrentInputFingerprint,
      rootId,
      rootShape,
      adapter,
      destination.inputConnection
    )
    return null
  }
  if (
    destination.kind !== 'input' ||
    !destination.blockId ||
    !destination.inputName
  )
    return editError(
      'edit.invalid_shape',
      'expression block requires an expression input destination'
    )
  if (operation.destination.kind !== 'input')
    return editError(
      'edit.internal_invariant',
      'resolved destination does not match the operation branch'
    )
  attachExistingToInput(
    targetIndex,
    target,
    destination.blockId,
    destination.inputName,
    operation.destination.expectedCurrentInputFingerprint,
    rootId,
    rootShape,
    adapter
  )
  return null
}

function translateMovedComments(
  target: Target,
  plan: GraphClosurePlanV1,
  operation: SemanticEditOperationBlockMoveV1,
  sourceWorkspace: { readonly x?: number; readonly y?: number },
  destination: ResolvedBlockDestinationV1
): void
{
  if (
    commentSetSha256V1(target, plan.attachedCommentIds) !==
    operation.comments.expectedCommentSetSha256
  )
    return editError(
      'edit.fingerprint_mismatch',
      'moved attached comment set changed'
    )
  if (operation.comments.layout === 'preserveAbsolute') return
  if (
    !destination.workspace ||
    sourceWorkspace.x === undefined ||
    sourceWorkspace.y === undefined
  )
    return editError(
      'edit.invalid_move',
      'comment translation requires concrete source and destination workspaces'
    )
  const deltaX = destination.workspace.x - sourceWorkspace.x
  const deltaY = destination.workspace.y - sourceWorkspace.y
  for (const commentId of plan.attachedCommentIds)
  {
    const comment = scratchRecordValue(target.comments, commentId)
    if (!comment)
      return editError('edit.graph_failed', 'moved comment is absent')
    if (typeof comment.x === 'number') comment.x += deltaX
    if (typeof comment.y === 'number') comment.y += deltaY
  }
}

function assertDestinationOutsideClosure(
  plan: GraphClosurePlanV1,
  destination: ResolvedBlockDestinationV1
): void
{
  if (
    destination.blockId !== undefined &&
    plan.orderedBlockIds.includes(destination.blockId)
  )
    return editError(
      'edit.graph_cycle',
      'block cannot move into its own owned closure'
    )
}

function installLoweredInput(
  target: Target,
  ownerId: string,
  inputName: string,
  descriptor: GraphInputDescriptorV1,
  lowered: LoweredSemanticInputV1,
  adapter: BlockOperationCatalogAdapterV1
): void
{
  if (lowered.input === null && descriptor.required)
    return editError(
      'edit.invalid_shape',
      'required descriptor input cannot be emptied'
    )
  if (lowered.closure) installGraphClosureV1(target, lowered.closure)
  if (lowered.input === null) deleteInput(target, ownerId, inputName)
  else setInput(target, ownerId, inputName, structuredClone(lowered.input))
  if (lowered.closure)
  {
    setNestedRoot(target, lowered.closure.rootId, ownerId)
    verifyLoweredClosure(target, lowered.closure, adapter)
  }
}

function applySetInput(
  project: ProjectIR,
  targetIndex: number,
  target: Target,
  resolved: Extract<
    ResolvedBlockStructuralOperationV1,
    { operation: SemanticEditOperationBlockSetInputV1 }
  >,
  adapter: BlockOperationCatalogAdapterV1
): AppliedBlockStructuralOperationV1
{
  const { operation, blockId } = resolved
  const ownerDescriptor = descriptorFor(target, blockId, adapter)
  if (graphBlockV1(target, blockId).opcode === 'procedures_call')
    return editError(
      'edit.unsupported_operation',
      'procedure call inputs require Group E parameter authority'
    )
  const descriptor = inputDescriptor(ownerDescriptor, operation.inputName)
  const current = assertExpectedInputFingerprint(
    targetIndex,
    target,
    blockId,
    operation.inputName,
    operation.expectedInputFingerprint
  )
  const activeId = currentActiveOwnedBlockId(target, current)
  let removed: readonly string[] = []
  if (operation.replacedInput.kind === 'requireNoOwnedBlock')
  {
    if (activeId !== null)
      return editError(
        'edit.entity_still_referenced',
        'set-input requires no existing owned block',
        1
      )
    if (resolved.replacedInputComments.kind !== 'rejectIfPresent')
      return editError(
        'edit.planning_facts_mismatch',
        'set-input has an unexpected comment disposition'
      )
  }
  else
  {
    if (activeId === null)
      return editError(
        'edit.cardinality_mismatch',
        'set-input expected one owned closure',
        0
      )
    const plan = planGraphClosureV1(target, 'ownedBlock', activeId)
    assertExpectedClosure(
      plan,
      operation.replacedInput.expectedClosureSha256,
      operation.replacedInput.expectedOwnedBlockCount
    )
    assertCuratedOwnedClosure(target, plan, adapter)
    exactDispositionCommentIds(
      plan.attachedCommentIds,
      resolved.replacedInputComments
    )
    if (resolved.replacedInputComments.kind === 'deleteExact')
      deleteExactCommentsV1(target, resolved.replacedInputComments.commentIds)
    else if (resolved.replacedInputComments.kind === 'reattachExact')
      return editError(
        'edit.planning_facts_mismatch',
        'set-input deletion cannot reattach comments without replacement aliases'
      )
    deleteGraphClosureV1(target, plan)
    removed = plan.orderedBlockIds
  }
  const lowered = adapter.lowerInputValue(
    project,
    targetIndex,
    blockId,
    descriptor,
    operation.value,
    current,
    current?.[0] === 1
      ? current[1]
      : current?.[0] === 3
        ? current[2]
        : undefined
  )
  installLoweredInput(
    target,
    blockId,
    operation.inputName,
    descriptor,
    lowered,
    adapter
  )
  commitGraphAllocatorV1(project.uids, lowered.closure)
  return operationResult(
    operation,
    targetIndex,
    blockId,
    lowered.closure?.rootId ?? null,
    null,
    null,
    lowered.closure?.blockIds ?? [],
    removed,
    lowered.closure?.aliasBlockIds ?? {},
    {},
    lowered.closure?.creationKeyByBlockId ?? {},
    lowered.closure?.tailId ?? null
  )
}

function operationResult(
  operation: BlockStructuralOperationV1,
  targetIndex: number,
  selectedBlockId: string,
  rootBlockId: string | null,
  sourceGapRootBlockId: string | null,
  destinationScriptRootBlockId: string | null,
  createdBlockIds: readonly string[],
  removedBlockIds: readonly string[],
  aliases: Readonly<Record<string, string>>,
  sourceGapAliases: Readonly<Record<string, string>>,
  creationKeyByBlockId: Readonly<Record<string, string>> = {},
  createdTailBlockId: string | null = null,
  removedCommentIds: readonly string[] = []
): AppliedBlockStructuralOperationV1
{
  const exactPaths = [
    `/targets/${targetIndex}/blocks/${pointerPart(selectedBlockId)}`,
    ...createdBlockIds.map(
      (blockId) => `/targets/${targetIndex}/blocks/${pointerPart(blockId)}`
    ),
    ...removedBlockIds.map(
      (blockId) => `/targets/${targetIndex}/blocks/${pointerPart(blockId)}`
    ),
    ...removedCommentIds.map(
      (commentId) =>
        `/targets/${targetIndex}/comments/${pointerPart(commentId)}`
    ),
  ]
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    selectedBlockId,
    rootBlockId,
    createdTailBlockId,
    sourceGapRootBlockId,
    destinationScriptRootBlockId,
    createdBlockIds: Object.freeze([...createdBlockIds]),
    removedBlockIds: Object.freeze([...removedBlockIds]),
    removedCommentIds: Object.freeze([...removedCommentIds]),
    affectedBlockIds: Object.freeze([]),
    affectedCommentIds: Object.freeze([]),
    aliasBlockIds: Object.freeze({ ...aliases }),
    sourceGapAliasBlockIds: Object.freeze({ ...sourceGapAliases }),
    creationKeyByBlockId: Object.freeze({ ...creationKeyByBlockId }),
    exactPaths: Object.freeze([...new Set(exactPaths)].sort(compareText)),
  }
}

export function applyBlockStructuralOperationV1(
  project: ProjectIR,
  resolved: ResolvedBlockStructuralOperationV1,
  adapter: BlockOperationCatalogAdapterV1
): AppliedBlockStructuralOperationV1
{
  const { operation, targetIndex } = resolved
  const source = ownerTarget(project, targetIndex)
  const staged = structuredClone(source)
  const complete = (
    result: AppliedBlockStructuralOperationV1
  ): AppliedBlockStructuralOperationV1 =>
    completeAffectedGraphEvidence(result, source, staged)

  if (
    operation.kind === 'block.insertBefore' ||
    operation.kind === 'block.insertAfter'
  )
  {
    const insertResolved = resolved as Extract<
      ResolvedBlockStructuralOperationV1,
      {
        operation:
          | SemanticEditOperationBlockInsertBeforeV1
          | SemanticEditOperationBlockInsertAfterV1
      }
    >
    const lowered = adapter.lowerStatementSequence(
      project,
      targetIndex,
      operation.tree
    )
    if (operation.kind === 'block.insertBefore')
      installBefore(staged, insertResolved.anchorBlockId, lowered, adapter)
    else installAfter(staged, insertResolved.anchorBlockId, lowered, adapter)
    commitGraphAllocatorV1(project.uids, lowered)
    project.json.targets[targetIndex] = staged
    return complete(
      operationResult(
        operation,
        targetIndex,
        insertResolved.anchorBlockId,
        lowered.rootId,
        null,
        null,
        lowered.blockIds,
        [],
        lowered.aliasBlockIds,
        {},
        lowered.creationKeyByBlockId,
        lowered.tailId
      )
    )
  }

  if (operation.kind === 'block.insertSubstack')
  {
    const substackResolved = resolved as Extract<
      ResolvedBlockStructuralOperationV1,
      { operation: SemanticEditOperationBlockInsertSubstackV1 }
    >
    const lowered = adapter.lowerStatementSequence(
      project,
      targetIndex,
      operation.tree
    )
    installSubstack(
      targetIndex,
      staged,
      substackResolved.ownerBlockId,
      operation.inputName,
      operation.expectedCurrentInputFingerprint,
      lowered,
      adapter
    )
    commitGraphAllocatorV1(project.uids, lowered)
    project.json.targets[targetIndex] = staged
    return complete(
      operationResult(
        operation,
        targetIndex,
        substackResolved.ownerBlockId,
        lowered.rootId,
        null,
        null,
        lowered.blockIds,
        [],
        lowered.aliasBlockIds,
        {},
        lowered.creationKeyByBlockId,
        lowered.tailId
      )
    )
  }

  if (operation.kind === 'block.setField')
  {
    const fieldResolved = resolved as Extract<
      ResolvedBlockStructuralOperationV1,
      { operation: SemanticEditOperationBlockSetFieldV1 }
    >
    const descriptor = descriptorFor(staged, fieldResolved.blockId, adapter)
    const raw = graphBlockV1(staged, fieldResolved.blockId)
    if (!descriptor || raw.opcode === 'procedures_call')
      return editError('edit.unsupported_opcode', 'field owner is unsupported')
    const current = scratchRecordValue(raw.fields, operation.fieldName)
    if (
      blockFieldFingerprintV1(
        targetIndex,
        fieldResolved.blockId,
        operation.fieldName,
        current
      ) !== operation.expectedValueFingerprint
    )
      return editError('edit.fingerprint_mismatch', 'field fingerprint changed')
    const value = adapter.lowerFieldValue(
      project,
      targetIndex,
      fieldResolved.blockId,
      operation.fieldName,
      operation.value
    )
    setField(staged, fieldResolved.blockId, operation.fieldName, value)
    descriptorFor(staged, fieldResolved.blockId, adapter)
    project.json.targets[targetIndex] = staged
    return complete(
      operationResult(
        operation,
        targetIndex,
        fieldResolved.blockId,
        null,
        null,
        null,
        [],
        [],
        {},
        {},
        {}
      )
    )
  }

  if (operation.kind === 'block.setInput')
  {
    const inputResolved = resolved as Extract<
      ResolvedBlockStructuralOperationV1,
      { operation: SemanticEditOperationBlockSetInputV1 }
    >
    const result = applySetInput(
      project,
      targetIndex,
      staged,
      inputResolved,
      adapter
    )
    project.json.targets[targetIndex] = staged
    return complete(result)
  }

  const selectedResolved = resolved as Extract<
    ResolvedBlockStructuralOperationV1,
    {
      operation:
        | SemanticEditOperationBlockReplaceV1
        | SemanticEditOperationBlockMoveV1
        | SemanticEditOperationBlockRemoveV1
    }
  >
  const blockId = selectedResolved.blockId
  const plan = planGraphClosureV1(staged, 'ownedBlock', blockId)
  const sourceDescriptor = descriptorFor(staged, blockId, adapter)
  if (
    sourceDescriptor.shape === 'hat' ||
    sourceDescriptor.shape === 'menuReporter' ||
    graphBlockV1(staged, blockId).opcode === 'procedures_definition'
  )
    return editError(
      'edit.hat_cap_invariant',
      'hat, procedure-definition, and menu-shadow roots require dedicated operations'
    )
  assertExpectedClosure(
    plan,
    operation.expectedClosureSha256,
    'expectedOwnedBlockCount' in operation
      ? operation.expectedOwnedBlockCount
      : undefined
  )
  assertCuratedOwnedClosure(staged, plan, adapter)

  if (operation.kind === 'block.replace')
  {
    const replaceResolved = selectedResolved as Extract<
      ResolvedBlockStructuralOperationV1,
      { operation: SemanticEditOperationBlockReplaceV1 }
    >
    const lowered = adapter.lowerReplacement(
      project,
      targetIndex,
      operation.replacement
    )
    replaceOwnedClosure(
      staged,
      plan,
      lowered,
      sourceDescriptor,
      replaceResolved.comments,
      adapter
    )
    commitGraphAllocatorV1(project.uids, lowered)
    project.json.targets[targetIndex] = staged
    return complete(
      operationResult(
        operation,
        targetIndex,
        blockId,
        lowered.rootId,
        null,
        null,
        lowered.blockIds,
        plan.orderedBlockIds,
        lowered.aliasBlockIds,
        {},
        lowered.creationKeyByBlockId,
        lowered.tailId,
        replaceResolved.comments.kind === 'deleteExact'
          ? replaceResolved.comments.commentIds
          : []
      )
    )
  }

  if (operation.kind === 'block.remove')
  {
    const removeResolved = selectedResolved as Extract<
      ResolvedBlockStructuralOperationV1,
      { operation: SemanticEditOperationBlockRemoveV1 }
    >
    const comments = exactDispositionCommentIds(
      plan.attachedCommentIds,
      removeResolved.comments
    )
    if (removeResolved.comments.kind === 'reattachExact')
      return editError(
        'edit.planning_facts_mismatch',
        'block removal cannot reattach comments'
      )
    if (comments.length > 0) deleteExactCommentsV1(staged, comments)
    let sourceGap: GraphInstalledClosureV1 | null = null
    if (isStatementShape(sourceDescriptor.shape))
      detachStatementSource(staged, plan, operation.sourceGap)
    else
      sourceGap = sourceGapForExpression(
        project,
        targetIndex,
        staged,
        plan,
        operation.sourceGap,
        adapter
      )
    deleteGraphClosureV1(staged, plan)
    commitGraphAllocatorV1(project.uids, sourceGap)
    project.json.targets[targetIndex] = staged
    return complete(
      operationResult(
        operation,
        targetIndex,
        blockId,
        null,
        sourceGap?.rootId ?? null,
        null,
        sourceGap?.blockIds ?? [],
        plan.orderedBlockIds,
        {},
        sourceGap?.aliasBlockIds ?? {},
        sourceGap?.creationKeyByBlockId ?? {},
        sourceGap?.tailId ?? null,
        comments
      )
    )
  }

  const moveResolved = selectedResolved as Extract<
    ResolvedBlockStructuralOperationV1,
    { operation: SemanticEditOperationBlockMoveV1 }
  >
  if (moveResolved.destination.targetIndex !== targetIndex)
    return editError(
      'edit.invalid_owner',
      'cross-target block movement is unsupported'
    )
  assertDestinationOutsideClosure(plan, moveResolved.destination)
  const sourceRoot = graphBlockV1(staged, blockId)
  const sourceWorkspace = { x: sourceRoot.x, y: sourceRoot.y }
  translateMovedComments(
    staged,
    plan,
    operation,
    sourceWorkspace,
    moveResolved.destination
  )
  let sourceGap: GraphInstalledClosureV1 | null = null
  if (isStatementShape(sourceDescriptor.shape))
    detachStatementSource(staged, plan, operation.sourceGap)
  else
    sourceGap = sourceGapForExpression(
      project,
      targetIndex,
      staged,
      plan,
      operation.sourceGap,
      adapter
    )
  if (sourceRoot.topLevel === true)
  {
    sourceRoot.topLevel = false
    delete sourceRoot.x
    delete sourceRoot.y
  }
  const destinationScriptRootBlockId = isStatementShape(sourceDescriptor.shape)
    ? attachMovedStatement(
        targetIndex,
        staged,
        blockId,
        moveResolved.destination,
        operation,
        adapter
      )
    : attachMovedExpression(
        targetIndex,
        staged,
        blockId,
        sourceDescriptor.shape,
        moveResolved.destination,
        operation,
        adapter
      )
  const movedPlan = planGraphClosureV1(staged, 'ownedBlock', blockId)
  if (!sameSet(movedPlan.orderedBlockIds, plan.orderedBlockIds))
    return editError(
      'edit.graph_failed',
      'moved block closure changed membership'
    )
  assertCuratedOwnedClosure(staged, movedPlan, adapter)
  commitGraphAllocatorV1(project.uids, sourceGap)
  project.json.targets[targetIndex] = staged
  return complete(
    operationResult(
      operation,
      targetIndex,
      blockId,
      null,
      sourceGap?.rootId ?? null,
      destinationScriptRootBlockId,
      sourceGap?.blockIds ?? [],
      [],
      {},
      sourceGap?.aliasBlockIds ?? {},
      sourceGap?.creationKeyByBlockId ?? {},
      sourceGap?.tailId ?? null
    )
  )
}
