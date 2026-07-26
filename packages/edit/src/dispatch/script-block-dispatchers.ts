// packages/edit/src/dispatch/script-block-dispatchers.ts
// dispatch exact curated script & nested-block semantic graph operations

import { scratchRecordValue, type BlockInput } from '@scratch-agent/sb3'
import type { ProjectIR } from '@scratch-agent/ir'
import {
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
  applyBlockStructuralOperationV1,
  applyScriptStructuralOperationV1,
  blockEntityEvidenceSetV1,
  blockFieldFingerprintV1,
  blockInputFingerprintV1,
  commentEntityEvidenceSetV1,
  commentSetSha256V1,
  createCuratedCoreOperationAdaptersV1,
  declarationEntityEvidenceSetV1,
  scriptBlockCreationContentFingerprintForResultV1,
  inputShadowFingerprintV1,
  planGraphClosureV1,
  resolveCommentRefV1,
  resolveDeclarationRefV1,
  resolveTargetRefV1,
  scriptBoundedLocationProjectionV1,
  scriptEntityEvidenceSetV1,
  semanticHashV1,
  targetEntityEvidenceSetV1,
  validateCuratedClosureV1,
  validateExistingCuratedBlockV1,
  SEMANTIC_LINEAGE_VERSION_V1,
  validateSemanticLineageSnapshot,
  type AppliedBlockStructuralOperationV1,
  type AppliedScriptStructuralOperationV1,
  type BlockEntityEvidenceV1,
  type BlockRefV1,
  type CommentRefV1,
  type ContractScopeV1,
  type ContractEntityRefV1,
  type CuratedEntityResolutionRequestV1,
  type CuratedEntityResolverV1,
  type CuratedResolvedEntityV1,
  type DeclarationEntityEvidenceV1,
  type DeclarationRefV1,
  type GraphClosurePlanV1,
  type ScriptBlockContractEntityResolutionRequestV1,
  type MediaRefV1,
  type OperationPlanningChoiceV1,
  type ScriptBlockCreationOperationV1,
  type ResolvedBlockDestinationV1,
  type ResolvedBlockStructuralOperationV1,
  type ResolvedCommentDispositionV1,
  type ResolvedScriptStructuralOperationV1,
  type ScriptEntityEvidenceV1,
  type ScriptRefV1,
  type SemanticEditOperationBlockInsertAfterV1,
  type SemanticEditOperationBlockInsertBeforeV1,
  type SemanticEditOperationBlockInsertSubstackV1,
  type SemanticEditOperationBlockMoveV1,
  type SemanticEditOperationBlockRemoveV1,
  type SemanticEditOperationBlockReplaceV1,
  type SemanticEditOperationBlockSetFieldV1,
  type SemanticEditOperationBlockSetInputV1,
  type SemanticEditOperationScriptAddV1,
  type SemanticEditOperationScriptDuplicateV1,
  type SemanticEditOperationScriptRemoveV1,
  type SemanticEditOperationGoalV1,
  type SemanticEditOperationV1,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
  type TargetEntityEvidenceV1,
} from '@scratch-agent/ir/edit'

import {
  bindingRealizationCandidatesV1 as bindingRealizationCandidates,
  blockPlanningProjectionV1 as planningBlock,
  cloneDispatcherProjectV1 as cloneProject,
  completedPlanningFactV1,
  createProductionLineageV1,
  exactCommentRefV1 as exactCommentRef,
  exactContractRefV1 as resolveExactContractRef,
  exactDeclarationRefV1 as exactDeclarationRef,
  futureBindingAlreadyRealizedV1 as futureBindingAlreadyRealized,
  targetPlanningProjectionV1 as planningTarget,
} from './dispatcher-primitives.js'
import { futureBindingKeySha256V1 } from '../lineage/future-binding-ledger.js'
import type { FutureContractBindingV1 } from '../lineage/future-binding-ledger.js'
import { editJsonPointerPartV1 as pointerPart } from '../support/internal-values.js'
import type { CreatedSemanticLineageV1 } from '../lineage/lineage.js'
import {
  blockBindingKeys,
  entityLineageIn,
  exactBlockRef,
  exactScriptRef,
  exactTargetRef,
  operationResult,
  planningContext,
  resolveBlockSelectionRef,
  resolveScriptSelectionRef,
  resolveTargetSelection,
  resolverAdapters,
  scriptBindingKeys,
  targetBindingKeys,
  targetLineageAt,
  tombstoneLineage,
  uniqueSorted,
  type PlanningEntityProjectionV1,
  type ProductionResultSlotV1,
  type ProductionDynamicBlockResultSlotV1,
} from './target-dispatchers.js'
import {
  curatedMediaEntityV1,
  exactMediaRefV1,
  mediaContractEntityRefV1,
  resolveMediaReferenceV1,
} from './media-target-dispatchers.js'
import {
  canonicalParameterRefV1,
  canonicalProcedureRefV1,
  parameterLineageInV1,
  procedureRecordAtV1,
  procedureSignatureStateSha256V1,
  planningParameterV1,
  planningProcedureV1,
  resolveParameterSelectionV1,
  resolveProcedureSelectionV1,
} from './procedure-authority.js'
import type {
  ProductionOperationContextV1,
  ProductionOperationDispatcherV1,
  ProductionOperationDispatchResultV1,
  ProductionStructuralAuthorizationV1,
} from '../transaction/production-transaction.js'
import type {
  EditOperationPlanningFactV1,
  EditOperationPlanningResultV1,
} from '../transaction/transaction.js'

type ScriptBlockScriptOperationV1 =
  | SemanticEditOperationScriptAddV1
  | SemanticEditOperationScriptDuplicateV1
  | SemanticEditOperationScriptRemoveV1

type ScriptBlockBlockOperationV1 =
  | SemanticEditOperationBlockInsertBeforeV1
  | SemanticEditOperationBlockInsertAfterV1
  | SemanticEditOperationBlockInsertSubstackV1
  | SemanticEditOperationBlockReplaceV1
  | SemanticEditOperationBlockMoveV1
  | SemanticEditOperationBlockRemoveV1
  | SemanticEditOperationBlockSetFieldV1
  | SemanticEditOperationBlockSetInputV1

type ScriptBlockOperationV1 = ScriptBlockScriptOperationV1 | ScriptBlockBlockOperationV1

type ScriptBlockFutureContractBindingV1 = Extract<
  FutureContractBindingV1,
  { entityKind: 'script' | 'block' }
>

interface ScriptBlockPlanningFactProjectionV1
{
  readonly kind: 'group-d-graph-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: ScriptBlockOperationV1['kind']
  readonly opId: string
  readonly selectedEntities: readonly PlanningEntityProjectionV1[]
  readonly selectedLineageIds: readonly string[]
  readonly catalogEvidence: typeof CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
  readonly facts: unknown
}

interface ResolvedScriptDispatchV1
{
  readonly operation: ScriptBlockScriptOperationV1
  readonly canonicalOperation: ScriptBlockScriptOperationV1
  readonly resolved: ResolvedScriptStructuralOperationV1
  readonly targetIndex: number
  readonly targetLineageId: string
  readonly selectedTarget?: TargetEntityEvidenceV1
  readonly selectedScript?: ScriptEntityEvidenceV1
  readonly selectedLineageIds: readonly string[]
  readonly planningEntities: readonly PlanningEntityProjectionV1[]
  readonly facts: unknown
  readonly sourceScriptPlan: GraphClosurePlanV1 | null
}

interface ResolvedBlockDispatchV1
{
  readonly operation: ScriptBlockBlockOperationV1
  readonly canonicalOperation: ScriptBlockBlockOperationV1
  readonly resolved: ResolvedBlockStructuralOperationV1
  readonly targetIndex: number
  readonly targetLineageId: string
  readonly selectedBlock: BlockEntityEvidenceV1
  readonly selectedLineageIds: readonly string[]
  readonly planningEntities: readonly PlanningEntityProjectionV1[]
  readonly facts: unknown
  readonly selectedClosurePlan: GraphClosurePlanV1 | null
  readonly procedureArgumentGuard?: {
    readonly actualSignatureSha256: string
    readonly expectedSignatureSha256: string
  }
}

interface ResultBindingMatchV1
{
  readonly binding: ScriptBlockFutureContractBindingV1
  readonly slot:
    ProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
  readonly collisionNonce: number
  readonly creationKey: string
}

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {}
): never
{
  throw Object.assign(new Error(message), { code, context })
}

// a same-batch created ref has no exact location in the predecessor revision, so
// canonicalizing it away makes the retained batch unreplayable. keep it verbatim
// & canonicalize every other selector, matching the Group C declaration rule.
function canonicalBlockRef(
  reference: BlockRefV1,
  evidence: BlockEntityEvidenceV1
): BlockRefV1
{
  return reference.refKind === 'created' ? reference : exactBlockRef(evidence)
}

function canonicalScriptRef(
  reference: ScriptRefV1,
  evidence: ScriptEntityEvidenceV1
): ScriptRefV1
{
  return reference.refKind === 'created' ? reference : exactScriptRef(evidence)
}

function planningScript(
  evidence: ScriptEntityEvidenceV1
): PlanningEntityProjectionV1
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

function declarationLineage(
  context: ProductionOperationContextV1,
  evidence: DeclarationEntityEvidenceV1
): SemanticLineageRecord
{
  return entityLineageIn(
    context.candidate,
    context.activeLineage,
    'declaration',
    evidence.targetIndex,
    `${evidence.declarationKind}:${evidence.declarationId}`
  )
}

function exactCurrentTarget(
  context: ProductionOperationContextV1,
  targetIndex: number
): TargetEntityEvidenceV1
{
  const evidence = targetEntityEvidenceSetV1(context.candidate.json)[
    targetIndex
  ]
  if (!evidence)
    return fail('edit.invalid_owner', 'current target evidence is absent')
  return evidence
}

function assertSameTarget(
  expectedTargetIndex: number,
  actualTargetIndex: number,
  purpose: string
): void
{
  if (expectedTargetIndex !== actualTargetIndex)
    fail('edit.invalid_owner', `${purpose} must remain on one exact target`)
}

function currentScriptForBlock(
  project: ProjectIR,
  block: BlockEntityEvidenceV1
): ScriptEntityEvidenceV1
{
  const matches = scriptEntityEvidenceSetV1(project).filter(
    (script) =>
      script.targetIndex === block.targetIndex &&
      script.topBlockId === block.scriptTopBlockId
  )
  if (matches.length !== 1)
    return fail(
      'edit.invalid_owner',
      'selected block is not owned by one exact top-level script'
    )
  return matches[0]!
}

function currentBlockInput(
  project: ProjectIR,
  targetIndex: number,
  blockId: string,
  inputName: string
): BlockInput | undefined
{
  const target = project.json.targets[targetIndex]
  const entry = target?.blocks[blockId]
  if (entry === undefined || Array.isArray(entry))
    return fail('edit.selector_no_match', 'block input owner is absent')
  return scratchRecordValue(entry.inputs, inputName)
}

function procedureCallInput(
  project: ProjectIR,
  targetIndex: number,
  blockId: string,
  proccode: string,
  argumentId: string
): BlockInput | undefined
{
  const target = project.json.targets[targetIndex]
  const entry = target?.blocks[blockId]
  if (entry === undefined || Array.isArray(entry))
    return fail('edit.selector_no_match', 'procedure call block is absent')
  if (entry.opcode !== 'procedures_call')
    return fail('edit.invalid_shape', 'selected call is not a procedure call')
  if (entry.mutation?.proccode !== proccode)
    return fail(
      'edit.selector_no_match',
      'selected call does not dispatch to the selected procedure'
    )
  return scratchRecordValue(entry.inputs, argumentId)
}

function descriptorPlanningEvidence(
  project: ProjectIR,
  block: BlockEntityEvidenceV1
): unknown
{
  const entry = project.json.targets[block.targetIndex]?.blocks[block.blockId]
  if (entry === undefined || Array.isArray(entry))
    return fail('edit.selector_no_match', 'selected block record is absent')
  const validation = validateExistingCuratedBlockV1(entry)
  if (
    !validation.ok ||
    !validation.safeForStructuralEdit ||
    !validation.descriptor
  )
    return fail(
      'edit.unsupported_opcode',
      `block ${block.blockId} is outside the exact curated structural profile`
    )
  return {
    opcode: validation.descriptor.opcode,
    shape: validation.descriptor.shape,
    category: validation.descriptor.category,
    descriptorIssues: validation.issues,
  }
}

function closurePlanningEvidence(
  project: ProjectIR,
  targetIndex: number,
  rootBlockId: string,
  kind: 'script' | 'ownedBlock'
): GraphClosurePlanV1
{
  const target = project.json.targets[targetIndex]
  if (!target) return fail('edit.invalid_owner', 'closure target is absent')
  const plan = planGraphClosureV1(target, kind, rootBlockId)
  for (const blockId of plan.orderedBlockIds)
  {
    const entry = target.blocks[blockId]
    if (entry === undefined || Array.isArray(entry))
      return fail('edit.graph_failed', 'closure contains an absent block')
    const validation = validateExistingCuratedBlockV1(entry)
    if (!validation.ok || !validation.safeForStructuralEdit)
      return fail(
        'edit.unsupported_opcode',
        `closure block ${blockId} is outside the exact curated profile`
      )
  }
  return plan
}

function closureFact(
  project: ProjectIR,
  targetIndex: number,
  plan: GraphClosurePlanV1
): unknown
{
  const target = project.json.targets[targetIndex]
  if (!target) return fail('edit.invalid_owner', 'closure target is absent')
  return {
    kind: plan.kind,
    rootBlockId: plan.rootBlockId,
    orderedBlockIds: plan.orderedBlockIds,
    closureSha256: plan.closureSha256,
    rootInboundEdge: plan.rootInboundEdge,
    rootSuccessorBlockId: plan.rootSuccessorBlockId,
    attachedCommentIds: plan.attachedCommentIds,
    attachedCommentSetSha256: commentSetSha256V1(
      target,
      plan.attachedCommentIds
    ),
  }
}

function canonicalizeSemanticValue(
  context: ProductionOperationContextV1,
  value: unknown
): unknown
{
  if (Array.isArray(value))
    return value.map((entry) => canonicalizeSemanticValue(context, entry))
  if (value === null || typeof value !== 'object') return value
  const record = value as Readonly<Record<string, unknown>>
  if (
    record['entityKind'] === 'target' &&
    typeof record['refKind'] === 'string'
  )
  {
    const evidence = resolveTargetRefV1(
      context.candidate,
      record as unknown as Parameters<typeof resolveTargetRefV1>[1],
      resolverAdapters(context).target
    )
    return exactTargetRef(evidence)
  }
  if (
    record['entityKind'] === 'declaration' &&
    typeof record['refKind'] === 'string'
  )
  {
    const evidence = resolveDeclarationRefV1(
      context.candidate,
      record as unknown as DeclarationRefV1,
      resolverAdapters(context)
    )
    return exactDeclarationRef(evidence)
  }
  if (record['entityKind'] === 'media' && typeof record['refKind'] === 'string')
    return exactMediaRefV1(
      resolveMediaReferenceV1(context, record as unknown as MediaRefV1).current
    )
  const canonical: Record<string, unknown> = Object.create(null)
  for (const [key, entry] of Object.entries(record))
    canonical[key] = canonicalizeSemanticValue(context, entry)
  return canonical
}

function planningAuthoredContent(
  context: ProductionOperationContextV1,
  value: unknown
): unknown
{
  return canonicalizeSemanticValue(context, value)
}

function resolveCommentSelection(
  context: ProductionOperationContextV1,
  reference: CommentRefV1,
  targetIndex: number
): ReturnType<typeof commentEntityEvidenceSetV1>[number]
{
  const evidence = resolveCommentRefV1(
    context.candidate,
    reference,
    resolverAdapters(context)
  )
  assertSameTarget(targetIndex, evidence.targetIndex, 'comment disposition')
  if (evidence.topologyStatus !== 'consistent')
    return fail(
      'edit.graph_failed',
      'comment disposition requires consistent block/comment topology'
    )
  return evidence
}

function resolveCommentDisposition(
  context: ProductionOperationContextV1,
  targetIndex: number,
  disposition:
    | SemanticEditOperationScriptRemoveV1['comments']
    | SemanticEditOperationBlockReplaceV1['comments']
    | Extract<
        SemanticEditOperationBlockSetInputV1['replacedInput'],
        { kind: 'deleteExactOwnedClosure' }
      >['comments']
): {
  readonly canonical: typeof disposition
  readonly resolved: ResolvedCommentDispositionV1
  readonly evidence: readonly ReturnType<
    typeof commentEntityEvidenceSetV1
  >[number][]
}
{
  if (disposition.kind === 'rejectIfPresent')
    return {
      canonical: disposition,
      resolved: { kind: 'rejectIfPresent' },
      evidence: Object.freeze([]),
    }
  if (disposition.kind === 'deleteExact')
  {
    const evidence = disposition.comments.map((reference) =>
      resolveCommentSelection(context, reference, targetIndex)
    )
    if (
      new Set(evidence.map((entry) => entry.commentId)).size !== evidence.length
    )
      return fail(
        'edit.planning_facts_mismatch',
        'comment deletion disposition repeats one semantic comment'
      )
    return {
      canonical: {
        kind: 'deleteExact',
        comments: evidence.map(exactCommentRef),
      },
      resolved: {
        kind: 'deleteExact',
        commentIds: evidence.map((entry) => entry.commentId),
      },
      evidence: Object.freeze(evidence),
    }
  }
  const evidence = disposition.mappings.map((mapping) => ({
    mapping,
    comment: resolveCommentSelection(context, mapping.comment, targetIndex),
  }))
  if (
    new Set(evidence.map((entry) => entry.comment.commentId)).size !==
      evidence.length ||
    new Set(evidence.map((entry) => entry.mapping.newBlockAlias)).size !==
      evidence.length
  )
    return fail(
      'edit.planning_facts_mismatch',
      'comment reattachment must map unique comments to unique aliases'
    )
  return {
    canonical: {
      kind: 'reattachExact',
      mappings: evidence.map((entry) => ({
        comment: exactCommentRef(entry.comment),
        newBlockAlias: entry.mapping.newBlockAlias,
      })),
    },
    resolved: {
      kind: 'reattachExact',
      mappings: evidence.map((entry) => ({
        commentId: entry.comment.commentId,
        newBlockAlias: entry.mapping.newBlockAlias,
      })),
    },
    evidence: Object.freeze(evidence.map((entry) => entry.comment)),
  }
}

function commentPlanningFact(
  project: ProjectIR,
  targetIndex: number,
  evidence: readonly ReturnType<typeof commentEntityEvidenceSetV1>[number][]
): unknown
{
  const target = project.json.targets[targetIndex]
  if (!target) return fail('edit.invalid_owner', 'comment target is absent')
  return {
    commentIds: evidence.map((entry) => entry.commentId),
    semanticLocationSha256: evidence.map(
      (entry) => entry.semanticLocationSha256
    ),
    semanticFingerprintSha256: evidence.map(
      (entry) => entry.semanticFingerprintSha256
    ),
    commentSetSha256: commentSetSha256V1(
      target,
      evidence.map((entry) => entry.commentId)
    ),
  }
}

// `context` addresses the running batch & drives every selection; `planning`
// stays on the pre-batch view so the projected facts keep their canonical hash
function resolveBlockDestination(
  context: ProductionOperationContextV1,
  planning: ProductionOperationContextV1,
  targetIndex: number,
  planningTargetIndex: number,
  destination: SemanticEditOperationBlockMoveV1['destination']
): {
  readonly canonical: SemanticEditOperationBlockMoveV1['destination']
  readonly resolved: ResolvedBlockDestinationV1
  readonly planningEntities: readonly PlanningEntityProjectionV1[]
  readonly lineageIds: readonly string[]
  readonly facts: unknown
  readonly procedureArgumentGuard: {
    readonly actualSignatureSha256: string
    readonly expectedSignatureSha256: string
  } | null
}
{
  if (destination.kind === 'procedureArgument')
  {
    const procedure = resolveProcedureSelectionV1(
      context,
      destination.procedure
    )
    assertSameTarget(targetIndex, procedure.current.targetIndex, 'block move')
    const parameter = resolveParameterSelectionV1(
      planning,
      destination.parameter,
      procedure.canonical
    )
    const call = resolveBlockSelectionRef(context, destination.call)
    assertSameTarget(targetIndex, call.current.targetIndex, 'block move')
    const planningRecord = procedureRecordAtV1(
      planning.candidate,
      planningTargetIndex,
      procedure.canonical.proccode
    )
    const currentRecord = procedureRecordAtV1(
      context.candidate,
      targetIndex,
      procedure.current.proccode
    )
    if (!planningRecord.argumentIds.includes(parameter.argumentId))
      return fail(
        'edit.selector_no_match',
        'selected parameter is absent from the selected procedure signature'
      )
    const planningInput = procedureCallInput(
      planning.candidate,
      planningTargetIndex,
      call.canonical.blockId,
      planningRecord.proccode,
      parameter.argumentId
    )
    procedureCallInput(
      context.candidate,
      targetIndex,
      call.current.blockId,
      currentRecord.proccode,
      parameter.argumentId
    )
    const actualInputFingerprintSha256 = blockInputFingerprintV1(
      planningTargetIndex,
      call.canonical.blockId,
      parameter.argumentId,
      planningInput
    )
    const parameterLineageId = parameterLineageInV1(
      context.activeLineage,
      procedure.lineageId,
      parameter.argumentId
    ).lineageId
    return {
      canonical: {
        ...destination,
        call: canonicalBlockRef(destination.call, call.canonical),
        procedure: canonicalProcedureRefV1(
          destination.procedure,
          procedure.canonical
        ),
        parameter: canonicalParameterRefV1(
          destination.parameter,
          parameter
        ),
      },
      resolved: {
        kind: destination.kind,
        targetIndex,
        blockId: call.current.blockId,
        inputName: parameter.argumentId,
        inputConnection: parameter.parameterType,
      },
      planningEntities: Object.freeze([
        planningBlock(call.canonical),
        planningProcedureV1(procedure.canonical),
        planningParameterV1(parameter),
      ]),
      lineageIds: Object.freeze([
        call.lineageId,
        procedure.lineageId,
        parameterLineageId,
      ]),
      facts: {
        kind: destination.kind,
        call: planningBlock(call.canonical),
        procedure: planningProcedureV1(procedure.canonical),
        parameter: planningParameterV1(parameter),
        argumentId: parameter.argumentId,
        actualSignatureSha256:
          procedureSignatureStateSha256V1(planningRecord),
        expectedSignatureSha256: destination.expectedSignatureSha256,
        actualInputFingerprintSha256,
        expectedCurrentInputFingerprint:
          destination.expectedCurrentInputFingerprint,
        expectedNoOwnedBlock: destination.expectedNoOwnedBlock,
      },
      procedureArgumentGuard: {
        actualSignatureSha256:
          procedureSignatureStateSha256V1(currentRecord),
        expectedSignatureSha256: destination.expectedSignatureSha256,
      },
    }
  }
  if (destination.kind === 'before' || destination.kind === 'after')
  {
    const selected = resolveBlockSelectionRef(context, destination.anchor)
    assertSameTarget(targetIndex, selected.current.targetIndex, 'block move')
    descriptorPlanningEvidence(planning.candidate, selected.canonical)
    return {
      canonical: {
        kind: destination.kind,
        anchor: canonicalBlockRef(destination.anchor, selected.canonical),
      },
      resolved: {
        kind: destination.kind,
        targetIndex,
        blockId: selected.current.blockId,
      },
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      lineageIds: Object.freeze([selected.lineageId]),
      facts: {
        kind: destination.kind,
        block: planningBlock(selected.canonical),
      },
      procedureArgumentGuard: null,
    }
  }
  if (destination.kind === 'substack' || destination.kind === 'input')
  {
    const selected = resolveBlockSelectionRef(context, destination.owner)
    assertSameTarget(targetIndex, selected.current.targetIndex, 'block move')
    descriptorPlanningEvidence(planning.candidate, selected.canonical)
    const currentInput = currentBlockInput(
      planning.candidate,
      planningTargetIndex,
      selected.canonical.blockId,
      destination.inputName
    )
    const actualFingerprint = blockInputFingerprintV1(
      planningTargetIndex,
      selected.canonical.blockId,
      destination.inputName,
      currentInput
    )
    return {
      canonical: {
        ...destination,
        owner: canonicalBlockRef(destination.owner, selected.canonical),
      },
      resolved: {
        kind: destination.kind,
        targetIndex,
        blockId: selected.current.blockId,
        inputName: destination.inputName,
      },
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      lineageIds: Object.freeze([selected.lineageId]),
      facts: {
        kind: destination.kind,
        owner: planningBlock(selected.canonical),
        inputName: destination.inputName,
        actualInputFingerprintSha256: actualFingerprint,
      },
      procedureArgumentGuard: null,
    }
  }
  const targetSelection = resolveTargetSelection(
    context,
    destination.workspace.target
  )
  assertSameTarget(
    targetIndex,
    targetSelection.current.targetIndex,
    'block move'
  )
  return {
    canonical: {
      kind: destination.kind,
      workspace: {
        target: exactTargetRef(targetSelection.canonical),
        x: destination.workspace.x,
        y: destination.workspace.y,
      },
    },
    resolved: {
      kind: destination.kind,
      targetIndex,
      workspace: {
        x: destination.workspace.x,
        y: destination.workspace.y,
      },
    },
    planningEntities: Object.freeze([]),
    lineageIds: Object.freeze([targetSelection.lineageId]),
    facts: {
      kind: destination.kind,
      target: planningTarget(targetSelection.canonical),
      workspace: {
        x: destination.workspace.x,
        y: destination.workspace.y,
      },
    },
    procedureArgumentGuard: null,
  }
}

function resolveScriptDispatch(
  context: ProductionOperationContextV1,
  operation: ScriptBlockScriptOperationV1
): ResolvedScriptDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the owner; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  if (operation.kind === 'script.add')
  {
    const target = resolveTargetSelection(context, operation.target)
    const canonicalRoot = canonicalizeSemanticValue(
      planning,
      operation.root
    ) as SemanticEditOperationScriptAddV1['root']
    return {
      operation,
      canonicalOperation: {
        ...operation,
        target: exactTargetRef(target.canonical),
        root: canonicalRoot,
      },
      resolved: {
        operation: {
          ...operation,
          target: exactTargetRef(target.canonical),
          root: canonicalRoot,
        },
        targetIndex: target.current.targetIndex,
      },
      targetIndex: target.current.targetIndex,
      targetLineageId: target.lineageId,
      selectedTarget: target.current,
      selectedLineageIds: Object.freeze([target.lineageId]),
      planningEntities: Object.freeze([planningTarget(target.canonical)]),
      facts: {
        ownerTargetLineageId: target.lineageId,
        authoredRoot: planningAuthoredContent(planning, operation.root),
        workspace: operation.workspace,
      },
      sourceScriptPlan: null,
    }
  }

  const script = resolveScriptSelectionRef(context, operation.script)
  const targetIndex = script.current.targetIndex
  const planningTargetIndex = script.canonical.targetIndex
  const plan = closurePlanningEvidence(
    planning.candidate,
    planningTargetIndex,
    script.canonical.topBlockId,
    'script'
  )
  const target = exactCurrentTarget(planning, planningTargetIndex)
  const targetLineageId = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    targetIndex
  ).lineageId
  if (operation.kind === 'script.duplicate')
  {
    const exposed = operation.exposeClones.map((entry) =>
    {
      const block = resolveBlockSelectionRef(context, entry.sourceBlock)
      assertSameTarget(
        targetIndex,
        block.current.targetIndex,
        'script clone exposure'
      )
      if (!plan.orderedBlockIds.includes(block.current.blockId))
        return fail(
          'edit.invalid_owner',
          'clone exposure block is outside the selected script closure'
        )
      return { entry, block }
    })
    if (
      new Set(exposed.map((entry) => entry.entry.alias)).size !==
        exposed.length ||
      new Set(exposed.map((entry) => entry.block.current.blockId)).size !==
        exposed.length
    )
      return fail(
        'edit.planning_facts_mismatch',
        'clone exposures require unique aliases and unique source blocks'
      )
    const canonical: SemanticEditOperationScriptDuplicateV1 = {
      ...operation,
      script: canonicalScriptRef(operation.script, script.canonical),
      exposeClones: exposed.map((entry) => ({
        alias: entry.entry.alias,
        sourceBlock: canonicalBlockRef(
          entry.entry.sourceBlock,
          entry.block.canonical
        ),
      })),
    }
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        topBlockId: script.current.topBlockId,
        exposedCloneSources: exposed.map((entry) => ({
          alias: entry.entry.alias,
          sourceBlockId: entry.block.current.blockId,
        })),
      },
      targetIndex,
      targetLineageId,
      selectedScript: script.current,
      selectedLineageIds: uniqueSorted([
        script.lineageId,
        ...exposed.map((entry) => entry.block.lineageId),
      ]),
      planningEntities: Object.freeze([
        planningScript(script.canonical),
        ...exposed.map((entry) => planningBlock(entry.block.canonical)),
      ]),
      facts: {
        ownerTarget: planningTarget(target),
        sourceClosure: closureFact(
          planning.candidate,
          planningTargetIndex,
          plan
        ),
        sourceCatalog: validateCuratedClosureV1(
          planning.candidate.json.targets[planningTargetIndex]!.blocks,
          script.canonical.topBlockId
        ),
        comments: operation.comments,
        workspace: operation.workspace,
        exposedClones: exposed.map((entry) => ({
          alias: entry.entry.alias,
          sourceBlock: planningBlock(entry.block.canonical),
        })),
      },
      sourceScriptPlan: plan,
    }
  }

  const comments = resolveCommentDisposition(
    planning,
    planningTargetIndex,
    operation.comments
  )
  const canonical: SemanticEditOperationScriptRemoveV1 = {
    ...operation,
    script: canonicalScriptRef(operation.script, script.canonical),
    comments:
      comments.canonical as SemanticEditOperationScriptRemoveV1['comments'],
  }
  return {
    operation,
    canonicalOperation: canonical,
    resolved: {
      operation: canonical,
      targetIndex,
      topBlockId: script.current.topBlockId,
      dispositionCommentIds:
        comments.resolved.kind === 'deleteExact'
          ? comments.resolved.commentIds
          : [],
    },
    targetIndex,
    targetLineageId,
    selectedScript: script.current,
    selectedLineageIds: uniqueSorted([
      script.lineageId,
      ...comments.evidence.map(
        (entry) =>
          entityLineageIn(
            planning.candidate,
            planning.activeLineage,
            'comment',
            entry.targetIndex,
            `comment:${entry.commentId}`
          ).lineageId
      ),
    ]),
    planningEntities: Object.freeze([planningScript(script.canonical)]),
    facts: {
      ownerTarget: planningTarget(target),
      sourceClosure: closureFact(planning.candidate, planningTargetIndex, plan),
      expectedClosureSha256: operation.expectedClosureSha256,
      expectedOwnedBlockCount: operation.expectedOwnedBlockCount,
      comments: commentPlanningFact(
        planning.candidate,
        planningTargetIndex,
        comments.evidence
      ),
      commentDispositionKind: operation.comments.kind,
    },
    sourceScriptPlan: plan,
  }
}

function blockPrimaryReference(operation: ScriptBlockBlockOperationV1): BlockRefV1
{
  if (
    operation.kind === 'block.insertBefore' ||
    operation.kind === 'block.insertAfter'
  )
    return operation.anchor
  if (operation.kind === 'block.insertSubstack') return operation.owner
  return operation.block
}

function blockClosurePlan(
  context: ProductionOperationContextV1,
  operation: ScriptBlockBlockOperationV1,
  selected: BlockEntityEvidenceV1
): GraphClosurePlanV1 | null
{
  return operation.kind === 'block.replace' ||
    operation.kind === 'block.move' ||
    operation.kind === 'block.remove'
    ? closurePlanningEvidence(
        context.candidate,
        selected.targetIndex,
        selected.blockId,
        'ownedBlock'
      )
    : null
}

function resolveSetInputComments(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationBlockSetInputV1,
  targetIndex: number
): ReturnType<typeof resolveCommentDisposition>
{
  if (operation.replacedInput.kind === 'requireNoOwnedBlock')
    return {
      canonical: { kind: 'rejectIfPresent' },
      resolved: { kind: 'rejectIfPresent' },
      evidence: Object.freeze([]),
    }
  return resolveCommentDisposition(
    context,
    targetIndex,
    operation.replacedInput.comments
  )
}

function resolveBlockDispatch(
  context: ProductionOperationContextV1,
  operation: ScriptBlockBlockOperationV1
): ResolvedBlockDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the owner; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const selected = resolveBlockSelectionRef(
    context,
    blockPrimaryReference(operation)
  )
  const targetIndex = selected.current.targetIndex
  const planningTargetIndex = selected.canonical.targetIndex
  const targetLineageId = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    targetIndex
  ).lineageId
  const descriptor = descriptorPlanningEvidence(
    planning.candidate,
    selected.canonical
  )
  const plan = blockClosurePlan(planning, operation, selected.canonical)
  const baseFacts = {
    ownerTarget: planningTarget(
      exactCurrentTarget(planning, planningTargetIndex)
    ),
    selectedBlock: planningBlock(selected.canonical),
    selectedDescriptor: descriptor,
    selectedClosure: plan
      ? closureFact(planning.candidate, planningTargetIndex, plan)
      : null,
  }

  if (
    operation.kind === 'block.insertBefore' ||
    operation.kind === 'block.insertAfter'
  )
  {
    const canonical = {
      ...operation,
      anchor: canonicalBlockRef(operation.anchor, selected.canonical),
      tree: canonicalizeSemanticValue(planning, operation.tree),
    } as typeof operation
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        anchorBlockId: selected.current.blockId,
      },
      targetIndex,
      targetLineageId,
      selectedBlock: selected.current,
      selectedLineageIds: Object.freeze([selected.lineageId]),
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      facts: {
        ...baseFacts,
        authoredTree: planningAuthoredContent(planning, operation.tree),
      },
      selectedClosurePlan: null,
    }
  }

  if (operation.kind === 'block.insertSubstack')
  {
    const current = currentBlockInput(
      planning.candidate,
      planningTargetIndex,
      selected.canonical.blockId,
      operation.inputName
    )
    const actualInputFingerprintSha256 = blockInputFingerprintV1(
      planningTargetIndex,
      selected.canonical.blockId,
      operation.inputName,
      current
    )
    const canonical: SemanticEditOperationBlockInsertSubstackV1 = {
      ...operation,
      owner: canonicalBlockRef(operation.owner, selected.canonical),
      tree: canonicalizeSemanticValue(
        planning,
        operation.tree
      ) as SemanticEditOperationBlockInsertSubstackV1['tree'],
    }
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        ownerBlockId: selected.current.blockId,
      },
      targetIndex,
      targetLineageId,
      selectedBlock: selected.current,
      selectedLineageIds: Object.freeze([selected.lineageId]),
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      facts: {
        ...baseFacts,
        inputName: operation.inputName,
        actualInputFingerprintSha256,
        expectedCurrentInputFingerprint:
          operation.expectedCurrentInputFingerprint,
        expectedEmpty: operation.expectedEmpty,
        authoredTree: planningAuthoredContent(planning, operation.tree),
      },
      selectedClosurePlan: null,
    }
  }

  if (operation.kind === 'block.setField')
  {
    const entry =
      planning.candidate.json.targets[planningTargetIndex]!.blocks[
        selected.canonical.blockId
      ]
    if (entry === undefined || Array.isArray(entry))
      return fail('edit.selector_no_match', 'field owner block is absent')
    const current = scratchRecordValue(entry.fields, operation.fieldName)
    const actualValueFingerprintSha256 = blockFieldFingerprintV1(
      planningTargetIndex,
      selected.canonical.blockId,
      operation.fieldName,
      current
    )
    const canonical: SemanticEditOperationBlockSetFieldV1 = {
      ...operation,
      block: canonicalBlockRef(operation.block, selected.canonical),
      value: canonicalizeSemanticValue(
        planning,
        operation.value
      ) as SemanticEditOperationBlockSetFieldV1['value'],
    }
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        blockId: selected.current.blockId,
      },
      targetIndex,
      targetLineageId,
      selectedBlock: selected.current,
      selectedLineageIds: Object.freeze([selected.lineageId]),
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      facts: {
        ...baseFacts,
        fieldName: operation.fieldName,
        actualValueFingerprintSha256,
        expectedValueFingerprint: operation.expectedValueFingerprint,
        authoredValue: planningAuthoredContent(planning, operation.value),
      },
      selectedClosurePlan: null,
    }
  }

  if (operation.kind === 'block.setInput')
  {
    const current = currentBlockInput(
      planning.candidate,
      planningTargetIndex,
      selected.canonical.blockId,
      operation.inputName
    )
    const comments = resolveSetInputComments(
      planning,
      operation,
      planningTargetIndex
    )
    const canonical: SemanticEditOperationBlockSetInputV1 = {
      ...operation,
      block: canonicalBlockRef(operation.block, selected.canonical),
      value: canonicalizeSemanticValue(
        planning,
        operation.value
      ) as SemanticEditOperationBlockSetInputV1['value'],
      replacedInput:
        operation.replacedInput.kind === 'requireNoOwnedBlock'
          ? operation.replacedInput
          : {
              ...operation.replacedInput,
              comments: comments.canonical as Extract<
                SemanticEditOperationBlockSetInputV1['replacedInput'],
                { kind: 'deleteExactOwnedClosure' }
              >['comments'],
            },
    }
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        blockId: selected.current.blockId,
        replacedInputComments: comments.resolved,
      },
      targetIndex,
      targetLineageId,
      selectedBlock: selected.current,
      selectedLineageIds: uniqueSorted([
        selected.lineageId,
        ...comments.evidence.map(
          (entry) =>
            entityLineageIn(
              planning.candidate,
              planning.activeLineage,
              'comment',
              planningTargetIndex,
              `comment:${entry.commentId}`
            ).lineageId
        ),
      ]),
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      facts: {
        ...baseFacts,
        inputName: operation.inputName,
        actualInputFingerprintSha256: blockInputFingerprintV1(
          planningTargetIndex,
          selected.canonical.blockId,
          operation.inputName,
          current
        ),
        expectedInputFingerprint: operation.expectedInputFingerprint,
        replacedInput: operation.replacedInput,
        replacedInputComments: commentPlanningFact(
          planning.candidate,
          planningTargetIndex,
          comments.evidence
        ),
        authoredValue: planningAuthoredContent(planning, operation.value),
      },
      selectedClosurePlan: null,
    }
  }

  if (operation.kind === 'block.replace')
  {
    const comments = resolveCommentDisposition(
      planning,
      planningTargetIndex,
      operation.comments
    )
    const canonical: SemanticEditOperationBlockReplaceV1 = {
      ...operation,
      block: canonicalBlockRef(operation.block, selected.canonical),
      replacement: canonicalizeSemanticValue(
        planning,
        operation.replacement
      ) as SemanticEditOperationBlockReplaceV1['replacement'],
      comments:
        comments.canonical as SemanticEditOperationBlockReplaceV1['comments'],
    }
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        blockId: selected.current.blockId,
        comments: comments.resolved,
      },
      targetIndex,
      targetLineageId,
      selectedBlock: selected.current,
      selectedLineageIds: uniqueSorted([
        selected.lineageId,
        ...comments.evidence.map(
          (entry) =>
            entityLineageIn(
              planning.candidate,
              planning.activeLineage,
              'comment',
              planningTargetIndex,
              `comment:${entry.commentId}`
            ).lineageId
        ),
      ]),
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      facts: {
        ...baseFacts,
        expectedClosureSha256: operation.expectedClosureSha256,
        expectedOwnedBlockCount: operation.expectedOwnedBlockCount,
        comments: commentPlanningFact(
          planning.candidate,
          planningTargetIndex,
          comments.evidence
        ),
        authoredReplacement: planningAuthoredContent(
          planning,
          operation.replacement
        ),
      },
      selectedClosurePlan: plan,
    }
  }

  if (operation.kind === 'block.remove')
  {
    const comments = resolveCommentDisposition(
      planning,
      planningTargetIndex,
      operation.comments
    )
    const canonical: SemanticEditOperationBlockRemoveV1 = {
      ...operation,
      block: canonicalBlockRef(operation.block, selected.canonical),
      sourceGap: canonicalizeSemanticValue(
        planning,
        operation.sourceGap
      ) as SemanticEditOperationBlockRemoveV1['sourceGap'],
      comments:
        comments.canonical as SemanticEditOperationBlockRemoveV1['comments'],
    }
    return {
      operation,
      canonicalOperation: canonical,
      resolved: {
        operation: canonical,
        targetIndex,
        blockId: selected.current.blockId,
        comments: comments.resolved,
      },
      targetIndex,
      targetLineageId,
      selectedBlock: selected.current,
      selectedLineageIds: uniqueSorted([
        selected.lineageId,
        ...comments.evidence.map(
          (entry) =>
            entityLineageIn(
              planning.candidate,
              planning.activeLineage,
              'comment',
              planningTargetIndex,
              `comment:${entry.commentId}`
            ).lineageId
        ),
      ]),
      planningEntities: Object.freeze([planningBlock(selected.canonical)]),
      facts: {
        ...baseFacts,
        expectedClosureSha256: operation.expectedClosureSha256,
        expectedOwnedBlockCount: operation.expectedOwnedBlockCount,
        sourceGap: canonical.sourceGap,
        comments: commentPlanningFact(
          planning.candidate,
          planningTargetIndex,
          comments.evidence
        ),
      },
      selectedClosurePlan: plan,
    }
  }

  const destination = resolveBlockDestination(
    context,
    planning,
    targetIndex,
    planningTargetIndex,
    operation.destination
  )
  const canonical: SemanticEditOperationBlockMoveV1 = {
    ...operation,
    block: canonicalBlockRef(operation.block, selected.canonical),
    destination: destination.canonical,
    sourceGap: canonicalizeSemanticValue(
      planning,
      operation.sourceGap
    ) as SemanticEditOperationBlockMoveV1['sourceGap'],
  }
  return {
    operation,
    canonicalOperation: canonical,
    resolved: {
      operation: canonical,
      targetIndex,
      blockId: selected.current.blockId,
      destination: destination.resolved,
    },
    targetIndex,
    targetLineageId,
    selectedBlock: selected.current,
    selectedLineageIds: uniqueSorted([
      selected.lineageId,
      ...destination.lineageIds,
    ]),
    planningEntities: Object.freeze([
      planningBlock(selected.canonical),
      ...destination.planningEntities,
    ]),
    facts: {
      ...baseFacts,
      expectedClosureSha256: operation.expectedClosureSha256,
      destination: destination.facts,
      sourceGap: canonical.sourceGap,
      comments: operation.comments,
      expectedCommentSetSha256: operation.comments.expectedCommentSetSha256,
    },
    selectedClosurePlan: plan,
    ...(destination.procedureArgumentGuard
      ? { procedureArgumentGuard: destination.procedureArgumentGuard }
      : {}),
  }
}

function productionGroupDPlanningFactProjectionV1(
  context: ProductionOperationContextV1,
  operation: ScriptBlockOperationV1
): ScriptBlockPlanningFactProjectionV1
{
  const resolved = operation.kind.startsWith('script.')
    ? resolveScriptDispatch(context, operation as ScriptBlockScriptOperationV1)
    : resolveBlockDispatch(context, operation as ScriptBlockBlockOperationV1)
  return {
    kind: 'group-d-graph-planning-fact-set',
    schemaVersion: 1,
    operationKind: operation.kind,
    opId: operation.opId,
    selectedEntities: resolved.planningEntities,
    selectedLineageIds: resolved.selectedLineageIds,
    catalogEvidence: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
    facts: resolved.facts,
  }
}

export function productionScriptBlockPlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: ScriptBlockOperationV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionGroupDPlanningFactProjectionV1(context, operation)
  )
}

// completion shares the exact projection that execution verifies after the
// user's goal has been expanded w/ retained current-state facts
export function productionScriptBlockPlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    {
      readonly kind:
        | 'script.add'
        | 'block.insertBefore'
        | 'block.insertAfter'
        | 'block.insertSubstack'
        | 'block.setField'
    }
  >
): EditOperationPlanningResultV1
{
  let operation: ScriptBlockOperationV1
  let facts: readonly EditOperationPlanningFactV1[] = Object.freeze([])
  if (
    goal.kind === 'script.add' ||
    goal.kind === 'block.insertBefore' ||
    goal.kind === 'block.insertAfter'
  )
    operation = { ...goal, expectedPlanningFactSetSha256: '0'.repeat(64) }
  else if (goal.kind === 'block.insertSubstack')
  {
    const provisional: SemanticEditOperationBlockInsertSubstackV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedCurrentInputFingerprint: '0'.repeat(64),
      expectedEmpty: true,
    }
    const resolved = resolveBlockDispatch(context, provisional)
    const resolvedFacts = resolved.facts as {
      readonly actualInputFingerprintSha256: string
    }
    operation = {
      ...provisional,
      expectedCurrentInputFingerprint:
        resolvedFacts.actualInputFingerprintSha256,
    }
    facts = Object.freeze([
      completedPlanningFactV1(
        '/expectedCurrentInputFingerprint',
        'sha256',
        operation.expectedCurrentInputFingerprint
      ),
      completedPlanningFactV1('/expectedEmpty', 'boolean', true),
    ])
  }
  else
  {
    const provisional: SemanticEditOperationBlockSetFieldV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedValueFingerprint: '0'.repeat(64),
    }
    const resolved = resolveBlockDispatch(context, provisional)
    const resolvedFacts = resolved.facts as {
      readonly actualValueFingerprintSha256: string
    }
    operation = {
      ...provisional,
      expectedValueFingerprint: resolvedFacts.actualValueFingerprintSha256,
    }
    facts = Object.freeze([
      completedPlanningFactV1(
        '/expectedValueFingerprint',
        'sha256',
        operation.expectedValueFingerprint
      ),
    ])
  }
  const planningFactSetSha256 = productionScriptBlockPlanningFactSetSha256V1(
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

function exactPlanningChoiceValueV1(
  choices: readonly OperationPlanningChoiceV1[],
  operationKind: OperationPlanningChoiceV1['operationKind'],
  destination: string
): unknown
{
  const matches = choices.filter(
    (choice) =>
      choice.operationKind === operationKind &&
      choice.destination === destination
  )
  if (matches.length !== 1)
    return fail(
      'edit.cardinality_mismatch',
      `planning requires one exact ${destination} choice`,
      { matchCount: matches.length }
    )
  return matches[0]!.selection.value
}

function assertExactPlanningChoiceSetV1(
  choices: readonly OperationPlanningChoiceV1[],
  operationKind: OperationPlanningChoiceV1['operationKind'],
  destinations: readonly string[]
): void
{
  if (
    choices.length !== destinations.length ||
    destinations.some(
      (destination) =>
        choices.filter(
          (choice) =>
            choice.operationKind === operationKind &&
            choice.destination === destination
        ).length !== 1
    )
  )
    fail(
      'edit.cardinality_mismatch',
      `planning choices do not exactly cover ${operationKind}`,
      { matchCount: choices.length }
    )
}

function completedClosureFactsV1(
  plan: GraphClosurePlanV1
): readonly EditOperationPlanningFactV1[]
{
  return Object.freeze([
    completedPlanningFactV1(
      '/expectedClosureSha256',
      'sha256',
      plan.closureSha256
    ),
    completedPlanningFactV1(
      '/expectedOwnedBlockCount',
      'integer',
      plan.orderedBlockIds.length
    ),
  ])
}

function completedSourceGapV1(
  context: ProductionOperationContextV1,
  operation:
    SemanticEditOperationBlockMoveV1 | SemanticEditOperationBlockRemoveV1,
  choices: readonly OperationPlanningChoiceV1[],
  plan: GraphClosurePlanV1,
  targetIndex: number
): {
  readonly sourceGap: SemanticEditOperationBlockMoveV1['sourceGap']
  readonly facts: readonly EditOperationPlanningFactV1[]
}
{
  const kind = exactPlanningChoiceValueV1(
    choices,
    operation.kind,
    '/sourceGap/kind'
  ) as SemanticEditOperationBlockMoveV1['sourceGap']['kind']
  if (kind === 'spliceStatements')
    return { sourceGap: { kind }, facts: Object.freeze([]) }
  const planning = planningContext(context, operation)
  const target = planning.candidate.json.targets[targetIndex]
  if (!target)
    return fail('edit.invalid_owner', 'planning source target is absent')
  if (kind === 'removeTopLevelScript')
  {
    const scriptPlan = closurePlanningEvidence(
      planning.candidate,
      targetIndex,
      plan.rootBlockId,
      'script'
    )
    return {
      sourceGap: {
        kind,
        expectedScriptClosureSha256: scriptPlan.closureSha256,
      },
      facts: Object.freeze([
        completedPlanningFactV1(
          '/sourceGap/expectedScriptClosureSha256',
          'sha256',
          scriptPlan.closureSha256
        ),
      ]),
    }
  }
  const edge = plan.rootInboundEdge
  if (!edge || edge.kind !== 'input' || edge.slotIndex !== 1)
    return fail(
      'edit.invalid_owner',
      `${kind} requires an active owned input source`
    )
  const current = currentBlockInput(
    planning.candidate,
    targetIndex,
    edge.ownerBlockId,
    edge.inputName
  )
  const expectedCurrentInputFingerprint = blockInputFingerprintV1(
    targetIndex,
    edge.ownerBlockId,
    edge.inputName,
    current
  )
  if (kind === 'revealExistingShadow')
  {
    const shadow = current?.[0] === 3 ? current[2] : undefined
    if (shadow === undefined)
      return fail(
        'edit.shadow_invariant',
        'planning source input has no obscured shadow to reveal'
      )
    const expectedShadowFingerprint = inputShadowFingerprintV1(
      targetIndex,
      edge.ownerBlockId,
      edge.inputName,
      shadow
    )
    return {
      sourceGap: {
        kind,
        expectedCurrentInputFingerprint,
        expectedShadowFingerprint,
      },
      facts: Object.freeze([
        completedPlanningFactV1(
          '/sourceGap/expectedCurrentInputFingerprint',
          'sha256',
          expectedCurrentInputFingerprint
        ),
        completedPlanningFactV1(
          '/sourceGap/expectedShadowFingerprint',
          'sha256',
          expectedShadowFingerprint
        ),
      ]),
    }
  }
  const shadowKind = exactPlanningChoiceValueV1(
    choices,
    operation.kind,
    '/sourceGap/obscuredShadow/kind'
  ) as 'requireNone' | 'preserveExact'
  const shadow = current?.[0] === 3 ? current[2] : undefined
  const obscuredShadow =
    shadowKind === 'preserveExact'
      ? {
          kind: shadowKind,
          expectedShadowFingerprint: inputShadowFingerprintV1(
            targetIndex,
            edge.ownerBlockId,
            edge.inputName,
            shadow
          ),
        }
      : { kind: shadowKind }
  if (shadowKind === 'preserveExact' && shadow === undefined)
    return fail(
      'edit.shadow_invariant',
      'planning source input has no obscured shadow to preserve'
    )
  return {
    sourceGap: {
      kind: 'replaceInput',
      expectedCurrentInputFingerprint,
      obscuredShadow,
      value: exactPlanningChoiceValueV1(
        choices,
        operation.kind,
        '/sourceGap/value'
      ) as Extract<
        SemanticEditOperationBlockMoveV1['sourceGap'],
        { readonly kind: 'replaceInput' }
      >['value'],
    },
    facts: Object.freeze([
      completedPlanningFactV1(
        '/sourceGap/expectedCurrentInputFingerprint',
        'sha256',
        expectedCurrentInputFingerprint
      ),
      ...(obscuredShadow.kind === 'preserveExact'
        ? [
            completedPlanningFactV1(
              '/sourceGap/obscuredShadow/expectedShadowFingerprint',
              'sha256',
              obscuredShadow.expectedShadowFingerprint
            ),
          ]
        : []),
    ]),
  }
}

function provisionalMoveDestinationV1(
  goal: Extract<SemanticEditOperationGoalV1, { readonly kind: 'block.move' }>
): SemanticEditOperationBlockMoveV1['destination']
{
  if (goal.destination.kind === 'substack')
    return {
      ...goal.destination,
      expectedCurrentInputFingerprint: '0'.repeat(64),
      expectedEmpty: true,
    }
  if (goal.destination.kind === 'input')
    return {
      ...goal.destination,
      expectedCurrentInputFingerprint: '0'.repeat(64),
      expectedNoOwnedBlock: true,
    }
  if (goal.destination.kind === 'procedureArgument')
    return {
      ...goal.destination,
      expectedSignatureSha256: '0'.repeat(64),
      expectedCurrentInputFingerprint: '0'.repeat(64),
      expectedNoOwnedBlock: true,
    }
  return goal.destination
}

function completeMoveDestinationV1(
  context: ProductionOperationContextV1,
  provisional: SemanticEditOperationBlockMoveV1
): {
  readonly destination: SemanticEditOperationBlockMoveV1['destination']
  readonly facts: readonly EditOperationPlanningFactV1[]
}
{
  if (
    provisional.destination.kind !== 'substack' &&
    provisional.destination.kind !== 'input' &&
    provisional.destination.kind !== 'procedureArgument'
  )
    return { destination: provisional.destination, facts: Object.freeze([]) }
  const resolved = resolveBlockDispatch(context, provisional)
  const destinationFacts = (
    resolved.facts as {
      readonly destination: {
        readonly actualInputFingerprintSha256: string
        readonly actualSignatureSha256?: string
      }
    }
  ).destination
  const destination =
    provisional.destination.kind === 'procedureArgument'
      ? {
          ...provisional.destination,
          expectedSignatureSha256: destinationFacts.actualSignatureSha256!,
          expectedCurrentInputFingerprint:
            destinationFacts.actualInputFingerprintSha256,
        }
      : {
          ...provisional.destination,
          expectedCurrentInputFingerprint:
            destinationFacts.actualInputFingerprintSha256,
        }
  return {
    destination,
    facts: Object.freeze([
      ...(destination.kind === 'procedureArgument'
        ? [
            completedPlanningFactV1(
              '/destination/expectedSignatureSha256',
              'sha256',
              destination.expectedSignatureSha256
            ),
          ]
        : []),
      completedPlanningFactV1(
        '/destination/expectedCurrentInputFingerprint',
        'sha256',
        destination.expectedCurrentInputFingerprint
      ),
      completedPlanningFactV1(
        provisional.destination.kind === 'substack'
          ? '/destination/expectedEmpty'
          : '/destination/expectedNoOwnedBlock',
        'boolean',
        true
      ),
    ]),
  }
}

export function productionScriptBlockChoicePlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    {
      readonly kind:
        | 'script.duplicate'
        | 'script.remove'
        | 'block.replace'
        | 'block.move'
        | 'block.remove'
        | 'block.setInput'
    }
  >,
  choices: readonly OperationPlanningChoiceV1[]
): EditOperationPlanningResultV1
{
  let operation: ScriptBlockOperationV1
  let facts: readonly EditOperationPlanningFactV1[] = Object.freeze([])
  if (goal.kind === 'script.duplicate')
  {
    assertExactPlanningChoiceSetV1(choices, goal.kind, ['/comments'])
    operation = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      comments: exactPlanningChoiceValueV1(
        choices,
        goal.kind,
        '/comments'
      ) as SemanticEditOperationScriptDuplicateV1['comments'],
    }
  }
  else if (goal.kind === 'script.remove')
  {
    assertExactPlanningChoiceSetV1(choices, goal.kind, ['/comments'])
    const provisional: SemanticEditOperationScriptRemoveV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedClosureSha256: '0'.repeat(64),
      expectedOwnedBlockCount: 0,
      comments: exactPlanningChoiceValueV1(
        choices,
        goal.kind,
        '/comments'
      ) as SemanticEditOperationScriptRemoveV1['comments'],
    }
    const plan = resolveScriptDispatch(context, provisional).sourceScriptPlan
    if (!plan)
      return fail('edit.internal_invariant', 'script closure plan is absent')
    operation = {
      ...provisional,
      expectedClosureSha256: plan.closureSha256,
      expectedOwnedBlockCount: plan.orderedBlockIds.length,
    }
    facts = completedClosureFactsV1(plan)
  }
  else if (goal.kind === 'block.replace')
  {
    assertExactPlanningChoiceSetV1(choices, goal.kind, ['/comments'])
    const provisional: SemanticEditOperationBlockReplaceV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedClosureSha256: '0'.repeat(64),
      expectedOwnedBlockCount: 0,
      comments: exactPlanningChoiceValueV1(
        choices,
        goal.kind,
        '/comments'
      ) as SemanticEditOperationBlockReplaceV1['comments'],
    }
    const plan = resolveBlockDispatch(context, provisional).selectedClosurePlan
    if (!plan)
      return fail('edit.internal_invariant', 'block closure plan is absent')
    operation = {
      ...provisional,
      expectedClosureSha256: plan.closureSha256,
      expectedOwnedBlockCount: plan.orderedBlockIds.length,
    }
    facts = completedClosureFactsV1(plan)
  }
  else if (goal.kind === 'block.setInput')
  {
    assertExactPlanningChoiceSetV1(choices, goal.kind, [
      '/replacedInput/kind',
      '/replacedInput/comments',
    ])
    const replacementKind = exactPlanningChoiceValueV1(
      choices,
      goal.kind,
      '/replacedInput/kind'
    ) as SemanticEditOperationBlockSetInputV1['replacedInput']['kind']
    const initialReplacement: SemanticEditOperationBlockSetInputV1['replacedInput'] =
      replacementKind === 'requireNoOwnedBlock'
        ? { kind: replacementKind }
        : {
            kind: replacementKind,
            expectedClosureSha256: '0'.repeat(64),
            expectedOwnedBlockCount: 0,
            comments: exactPlanningChoiceValueV1(
              choices,
              goal.kind,
              '/replacedInput/comments'
            ) as Extract<
              SemanticEditOperationBlockSetInputV1['replacedInput'],
              { readonly kind: 'deleteExactOwnedClosure' }
            >['comments'],
          }
    const provisional: SemanticEditOperationBlockSetInputV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedInputFingerprint: '0'.repeat(64),
      replacedInput: initialReplacement,
    }
    const resolved = resolveBlockDispatch(context, provisional)
    const resolvedFacts = resolved.facts as {
      readonly actualInputFingerprintSha256: string
    }
    let replacedInput = initialReplacement
    const replacementFacts: EditOperationPlanningFactV1[] = []
    if (initialReplacement.kind === 'deleteExactOwnedClosure')
    {
      const planning = planningContext(context, provisional)
      const selected = resolveBlockSelectionRef(context, goal.block)
      const current = currentBlockInput(
        planning.candidate,
        selected.canonical.targetIndex,
        selected.canonical.blockId,
        goal.inputName
      )
      const activeId =
        current &&
        (current[0] === 2 || current[0] === 3) &&
        typeof current[1] === 'string'
          ? current[1]
          : null
      if (activeId === null)
        return fail(
          'edit.cardinality_mismatch',
          'planning replacement expected one owned input closure',
          { matchCount: 0 }
        )
      const plan = closurePlanningEvidence(
        planning.candidate,
        selected.canonical.targetIndex,
        activeId,
        'ownedBlock'
      )
      replacedInput = {
        ...initialReplacement,
        expectedClosureSha256: plan.closureSha256,
        expectedOwnedBlockCount: plan.orderedBlockIds.length,
      }
      replacementFacts.push(
        completedPlanningFactV1(
          '/replacedInput/expectedClosureSha256',
          'sha256',
          plan.closureSha256
        ),
        completedPlanningFactV1(
          '/replacedInput/expectedOwnedBlockCount',
          'integer',
          plan.orderedBlockIds.length
        )
      )
    }
    operation = {
      ...provisional,
      expectedInputFingerprint: resolvedFacts.actualInputFingerprintSha256,
      replacedInput,
    }
    facts = Object.freeze([
      completedPlanningFactV1(
        '/expectedInputFingerprint',
        'sha256',
        operation.expectedInputFingerprint
      ),
      ...replacementFacts,
    ])
  }
  else
  {
    const destinations =
      goal.kind === 'block.move'
        ? [
            '/sourceGap/kind',
            '/sourceGap/obscuredShadow/kind',
            '/sourceGap/value',
            '/comments/layout',
          ]
        : [
            '/sourceGap/kind',
            '/sourceGap/obscuredShadow/kind',
            '/sourceGap/value',
            '/comments',
          ]
    assertExactPlanningChoiceSetV1(choices, goal.kind, destinations)
    const provisional = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedClosureSha256: '0'.repeat(64),
      ...(goal.kind === 'block.remove' ? { expectedOwnedBlockCount: 0 } : {}),
      sourceGap: { kind: 'spliceStatements' as const },
      comments:
        goal.kind === 'block.move'
          ? {
              kind: 'preserveAttached' as const,
              layout: exactPlanningChoiceValueV1(
                choices,
                goal.kind,
                '/comments/layout'
              ) as SemanticEditOperationBlockMoveV1['comments']['layout'],
              expectedCommentSetSha256: '0'.repeat(64),
            }
          : (exactPlanningChoiceValueV1(
              choices,
              goal.kind,
              '/comments'
            ) as SemanticEditOperationBlockRemoveV1['comments']),
      ...(goal.kind === 'block.move'
        ? { destination: provisionalMoveDestinationV1(goal) }
        : {}),
    } as SemanticEditOperationBlockMoveV1 | SemanticEditOperationBlockRemoveV1
    const initialResolved = resolveBlockDispatch(context, provisional)
    const plan = initialResolved.selectedClosurePlan
    if (!plan)
      return fail('edit.internal_invariant', 'block closure plan is absent')
    const sourceGap = completedSourceGapV1(
      context,
      provisional,
      choices,
      plan,
      initialResolved.selectedBlock.targetIndex
    )
    if (goal.kind === 'block.move')
    {
      const destination = completeMoveDestinationV1(
        context,
        provisional as SemanticEditOperationBlockMoveV1
      )
      const target = planningContext(context, provisional).candidate.json
        .targets[initialResolved.selectedBlock.targetIndex]
      if (!target)
        return fail('edit.invalid_owner', 'planning target is absent')
      const expectedCommentSetSha256 = commentSetSha256V1(
        target,
        plan.attachedCommentIds
      )
      operation = {
        ...(provisional as SemanticEditOperationBlockMoveV1),
        expectedClosureSha256: plan.closureSha256,
        destination: destination.destination,
        sourceGap: sourceGap.sourceGap,
        comments: {
          ...(provisional as SemanticEditOperationBlockMoveV1).comments,
          expectedCommentSetSha256,
        },
      }
      facts = Object.freeze([
        completedPlanningFactV1(
          '/expectedClosureSha256',
          'sha256',
          plan.closureSha256
        ),
        ...destination.facts,
        ...sourceGap.facts,
        completedPlanningFactV1(
          '/comments/kind',
          'movedCommentKind',
          'preserveAttached'
        ),
        completedPlanningFactV1(
          '/comments/expectedCommentSetSha256',
          'sha256',
          expectedCommentSetSha256
        ),
      ])
    }
    else
    {
      operation = {
        ...(provisional as SemanticEditOperationBlockRemoveV1),
        expectedClosureSha256: plan.closureSha256,
        expectedOwnedBlockCount: plan.orderedBlockIds.length,
        sourceGap: sourceGap.sourceGap,
      }
      facts = Object.freeze([
        ...completedClosureFactsV1(plan),
        ...sourceGap.facts,
      ])
    }
  }
  const planningFactSetSha256 = productionScriptBlockPlanningFactSetSha256V1(
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

function curatedEntityResolver(
  context: ProductionOperationContextV1
): CuratedEntityResolverV1
{
  return (
    request: CuratedEntityResolutionRequestV1
  ): CuratedResolvedEntityV1 =>
  {
    if (request.expectedEntityKind === 'media')
    {
      if (request.reference.entityKind !== 'media')
        return fail(
          'edit.invalid_shape',
          `${request.semanticPath} does not contain a media reference`
        )
      return curatedMediaEntityV1(
        context,
        request.reference,
        request.expectedEntitySubtype,
        request.semanticPath
      )
    }
    if (request.expectedEntityKind === 'target')
    {
      if (request.reference.entityKind !== 'target')
        return fail(
          'edit.invalid_shape',
          `${request.semanticPath} does not contain a target reference`
        )
      const target = resolveTargetRefV1(
        context.candidate,
        request.reference,
        resolverAdapters(context).target
      )
      if (target.targetKind !== request.expectedEntitySubtype)
        return fail(
          'edit.invalid_shape',
          `${request.semanticPath} target subtype differs from its descriptor`
        )
      const lineage = targetLineageAt(
        context.activeLineage,
        context.candidate.json.targets.length,
        target.targetIndex
      )
      return {
        entityKind: 'target',
        entitySubtype: target.targetKind,
        displayName: target.name,
        serializedId: `target:${target.targetIndex}`,
        ownerTargetIndex: null,
        semanticLineageSha256: lineage.lineageId,
        semanticFingerprintSha256: target.semanticFingerprintSha256,
      }
    }
    if (request.reference.entityKind !== 'declaration')
      return fail(
        'edit.invalid_shape',
        `${request.semanticPath} does not contain a declaration reference`
      )
    const declaration = resolveDeclarationRefV1(
      context.candidate,
      request.reference,
      resolverAdapters(context)
    )
    if (declaration.declarationKind !== request.expectedEntitySubtype)
      return fail(
        'edit.invalid_shape',
        `${request.semanticPath} declaration subtype differs from its descriptor`
      )
    const lineage = declarationLineage(context, declaration)
    return {
      entityKind: 'declaration',
      entitySubtype: declaration.declarationKind,
      displayName: declaration.location.name,
      serializedId: declaration.declarationId,
      ownerTargetIndex: declaration.targetIndex,
      semanticLineageSha256: lineage.lineageId,
      semanticFingerprintSha256: declaration.semanticFingerprintSha256,
    }
  }
}

function createLineage(
  context: ProductionOperationContextV1,
  operationId: string,
  kind: 'script' | 'block' | 'comment',
  ownerLineageId: string,
  rawIdentity: string,
  canonicalOrdinal: number | null,
  creationKey: string,
  activeLineage: SemanticLineageSnapshot
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

function activeRecord(
  lineage: SemanticLineageSnapshot,
  kind: 'script' | 'block' | 'comment',
  ownerLineageId: string,
  rawIdentity: string
): SemanticLineageRecord
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === kind &&
      record.ownerLineageId === ownerLineageId &&
      record.rawIdentity === rawIdentity
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      `active ${kind} lineage is absent or ambiguous for ${rawIdentity}`
    )
  return matches[0]!
}

function replaceLineageRawIdentity(
  active: SemanticLineageSnapshot,
  lineageId: string,
  rawIdentity: string
): SemanticLineageSnapshot
{
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: active.records.map((record) =>
      record.lineageId === lineageId ? { ...record, rawIdentity } : record
    ),
  })
}

function reindexOwnerLineages(
  active: SemanticLineageSnapshot,
  kind: 'script' | 'comment',
  ownerLineageId: string,
  orderedRawIdentities: readonly string[]
): SemanticLineageSnapshot
{
  const ordinalByRawIdentity = new Map(
    orderedRawIdentities.map((rawIdentity, ordinal) => [rawIdentity, ordinal])
  )
  const siblings = active.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === kind &&
      record.ownerLineageId === ownerLineageId
  )
  if (
    siblings.length !== orderedRawIdentities.length ||
    siblings.some((record) => !ordinalByRawIdentity.has(record.rawIdentity))
  )
    return fail(
      'edit.internal_invariant',
      `active ${kind} lineage does not match post-operation evidence`
    )
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: active.records.map((record) =>
      record.status === 'active' &&
      record.kind === kind &&
      record.ownerLineageId === ownerLineageId
        ? {
            ...record,
            canonicalOrdinal: ordinalByRawIdentity.get(record.rawIdentity)!,
          }
        : record
    ),
  })
}

function targetScriptRawIdentities(
  project: ProjectIR,
  targetIndex: number
): readonly string[]
{
  return Object.freeze(
    scriptEntityEvidenceSetV1(project)
      .filter((script) => script.targetIndex === targetIndex)
      .map((script) => `script:${script.topBlockId}`)
  )
}

function targetCommentRawIdentities(
  project: ProjectIR,
  targetIndex: number
): readonly string[]
{
  return Object.freeze(
    commentEntityEvidenceSetV1(project)
      .filter((comment) => comment.targetIndex === targetIndex)
      .map((comment) => `comment:${comment.commentId}`)
  )
}

interface ReconciledGroupDLineageV1
{
  readonly activeLineage: SemanticLineageSnapshot
  readonly collisionNonceByLineageId: ReadonlyMap<string, number>
  readonly creationKeyByLineageId: ReadonlyMap<string, string>
  readonly createdScriptLineageIds: readonly string[]
  readonly createdBlockLineageIds: readonly string[]
  readonly selectedLineageIds: readonly string[]
}

function reconcileGroupDLineage(
  context: ProductionOperationContextV1,
  operation: ScriptBlockOperationV1,
  targetIndex: number,
  targetLineageId: string,
  beforeScriptRawIdentities: readonly string[],
  applied:
    AppliedScriptStructuralOperationV1 | AppliedBlockStructuralOperationV1
): ReconciledGroupDLineageV1
{
  let active = context.activeLineage
  const collisionNonceByLineageId = new Map<string, number>()
  const creationKeyByLineageId = new Map<string, string>()
  const selectedLineageIds = new Set<string>()
  const createdBlockLineageIds: string[] = []
  const createdScriptLineageIds: string[] = []
  const sourceBlockIdByCloneId = new Map<string, string>()
  if ('clonedBlockIds' in applied)
    for (const [sourceBlockId, cloneBlockId] of Object.entries(
      applied.clonedBlockIds
    ))
      if (!sourceBlockIdByCloneId.has(cloneBlockId))
        sourceBlockIdByCloneId.set(cloneBlockId, sourceBlockId)
  const sourceCommentIdByCloneId = new Map<string, string>()
  if ('clonedCommentIds' in applied)
    for (const [sourceCommentId, cloneCommentId] of Object.entries(
      applied.clonedCommentIds
    ))
      if (!sourceCommentIdByCloneId.has(cloneCommentId))
        sourceCommentIdByCloneId.set(cloneCommentId, sourceCommentId)
  for (const blockId of applied.removedBlockIds)
  {
    const record = activeRecord(
      active,
      'block',
      targetLineageId,
      `block:${blockId}`
    )
    selectedLineageIds.add(record.lineageId)
    active = tombstoneLineage(active, record.lineageId)
  }
  for (const commentId of applied.removedCommentIds)
  {
    const record = activeRecord(
      active,
      'comment',
      targetLineageId,
      `comment:${commentId}`
    )
    selectedLineageIds.add(record.lineageId)
    active = tombstoneLineage(active, record.lineageId)
  }
  for (const [index, blockId] of applied.createdBlockIds.entries())
  {
    const clonedSourceBlockId =
      'clonedBlockIds' in applied
        ? sourceBlockIdByCloneId.get(blockId)
        : undefined
    const creationKey =
      clonedSourceBlockId !== undefined
        ? `cloned-block:${
            activeRecord(
              context.activeLineage,
              'block',
              targetLineageId,
              `block:${clonedSourceBlockId}`
            ).lineageId
          }`
        : (() =>
          {
            const authoredCreationKey = applied.creationKeyByBlockId[blockId]
            if (!authoredCreationKey)
              return fail(
                'edit.internal_invariant',
                `created block ${index} lacks a descriptor-owned creation key`
              )
            return `authored-block:${authoredCreationKey}`
          })()
    const created = createLineage(
      context,
      operation.opId,
      'block',
      targetLineageId,
      `block:${blockId}`,
      null,
      creationKey,
      active
    )
    active = created.activeLineage
    createdBlockLineageIds.push(created.record.lineageId)
    collisionNonceByLineageId.set(
      created.record.lineageId,
      created.collisionNonce
    )
    creationKeyByLineageId.set(created.record.lineageId, created.creationKey)
  }
  if ('clonedCommentIds' in applied)
  {
    const clonedCommentIds = Object.values(applied.clonedCommentIds).sort()
    for (const commentId of clonedCommentIds)
    {
      const sourceCommentId = sourceCommentIdByCloneId.get(commentId)
      if (!sourceCommentId)
        return fail(
          'edit.internal_invariant',
          'cloned comment lacks its exact source correspondence'
        )
      const sourceLineage = activeRecord(
        context.activeLineage,
        'comment',
        targetLineageId,
        `comment:${sourceCommentId}`
      )
      const created = createLineage(
        context,
        operation.opId,
        'comment',
        targetLineageId,
        `comment:${commentId}`,
        0,
        `cloned-comment:${sourceLineage.lineageId}`,
        active
      )
      active = created.activeLineage
      collisionNonceByLineageId.set(
        created.record.lineageId,
        created.collisionNonce
      )
      creationKeyByLineageId.set(created.record.lineageId, created.creationKey)
    }
  }

  const afterScriptRawIdentities = targetScriptRawIdentities(
    context.candidate,
    targetIndex
  )
  const beforeSet = new Set(beforeScriptRawIdentities)
  const afterSet = new Set(afterScriptRawIdentities)
  let removedScripts = beforeScriptRawIdentities.filter(
    (rawIdentity) => !afterSet.has(rawIdentity)
  )
  let addedScripts = afterScriptRawIdentities.filter(
    (rawIdentity) => !beforeSet.has(rawIdentity)
  )
  const splitDestinationRawIdentity =
    operation.kind === 'block.move' &&
    'destinationScriptRootBlockId' in applied &&
    applied.destinationScriptRootBlockId !== null
      ? `script:${applied.destinationScriptRootBlockId}`
      : null
  const splitsPriorTopLevelScript =
    splitDestinationRawIdentity !== null &&
    beforeSet.has(splitDestinationRawIdentity) &&
    afterSet.has(splitDestinationRawIdentity) &&
    addedScripts.length === 1
  if (splitsPriorTopLevelScript)
  {
    const sourceScript = activeRecord(
      active,
      'script',
      targetLineageId,
      splitDestinationRawIdentity
    )
    selectedLineageIds.add(sourceScript.lineageId)
    active = replaceLineageRawIdentity(
      active,
      sourceScript.lineageId,
      addedScripts[0]!
    )
    removedScripts = []
    addedScripts = [splitDestinationRawIdentity]
  }
  const transfersScriptIdentity =
    !splitsPriorTopLevelScript &&
    operation.kind.startsWith('block.') &&
    removedScripts.length === 1 &&
    addedScripts.length === 1
  if (transfersScriptIdentity)
  {
    const record = activeRecord(
      active,
      'script',
      targetLineageId,
      removedScripts[0]!
    )
    selectedLineageIds.add(record.lineageId)
    active = replaceLineageRawIdentity(
      active,
      record.lineageId,
      addedScripts[0]!
    )
  }
  else
  {
    for (const rawIdentity of removedScripts)
    {
      const record = activeRecord(
        active,
        'script',
        targetLineageId,
        rawIdentity
      )
      selectedLineageIds.add(record.lineageId)
      active = tombstoneLineage(active, record.lineageId)
    }
    for (const rawIdentity of addedScripts)
    {
      const topBlockId = /^script:(.*)$/su.exec(rawIdentity)?.[1]
      if (!topBlockId)
        return fail(
          'edit.internal_invariant',
          'created script raw identity is invalid'
        )
      const creationKey =
        operation.kind === 'script.duplicate' &&
        'topBlockId' in applied &&
        applied.topBlockId !== null
          ? `cloned-script:${
              activeRecord(
                context.activeLineage,
                'script',
                targetLineageId,
                `script:${applied.topBlockId}`
              ).lineageId
            }`
          : operation.kind === 'block.move' && 'selectedBlockId' in applied
            ? `promoted-script:${
                activeRecord(
                  context.activeLineage,
                  'block',
                  targetLineageId,
                  `block:${topBlockId}`
                ).lineageId
              }`
            : `authored-script-root:${
                activeRecord(
                  active,
                  'block',
                  targetLineageId,
                  `block:${topBlockId}`
                ).lineageId
              }`
      const created = createLineage(
        context,
        operation.opId,
        'script',
        targetLineageId,
        rawIdentity,
        afterScriptRawIdentities.indexOf(rawIdentity),
        creationKey,
        active
      )
      active = created.activeLineage
      createdScriptLineageIds.push(created.record.lineageId)
      collisionNonceByLineageId.set(
        created.record.lineageId,
        created.collisionNonce
      )
      creationKeyByLineageId.set(created.record.lineageId, created.creationKey)
    }
  }
  active = reindexOwnerLineages(
    active,
    'script',
    targetLineageId,
    afterScriptRawIdentities
  )
  active = reindexOwnerLineages(
    active,
    'comment',
    targetLineageId,
    targetCommentRawIdentities(context.candidate, targetIndex)
  )
  return {
    activeLineage: active,
    collisionNonceByLineageId,
    creationKeyByLineageId,
    createdScriptLineageIds: Object.freeze(createdScriptLineageIds),
    createdBlockLineageIds: Object.freeze(createdBlockLineageIds),
    selectedLineageIds: uniqueSorted([...selectedLineageIds]),
  }
}

function realizedFutureBindingKeys(
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

function allScriptBindingKeys(
  context: ProductionOperationContextV1,
  evidence: ScriptEntityEvidenceV1,
  lineageId: string
): readonly string[]
{
  return uniqueSorted([
    ...scriptBindingKeys(context, evidence),
    ...realizedFutureBindingKeys(context, lineageId),
  ])
}

function allBlockBindingKeys(
  context: ProductionOperationContextV1,
  evidence: BlockEntityEvidenceV1,
  lineageId: string
): readonly string[]
{
  return uniqueSorted([
    ...blockBindingKeys(context, evidence),
    ...realizedFutureBindingKeys(context, lineageId),
  ])
}

function exactExistingBindingKeys(
  context: ProductionOperationContextV1,
  entityKind: 'declaration',
  entitySubtype: 'variable' | 'list' | 'broadcast',
  sourceEvidence: {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
    readonly contextFingerprintSha256: string
  }
): readonly string[]
{
  return uniqueSorted(
    context.contract.entityBindings.flatMap((binding) =>
      binding.bindingKind === 'existing' &&
      binding.entityKind === entityKind &&
      binding.entitySubtype === entitySubtype &&
      binding.expectedMatchCount === 1 &&
      binding.sourceLocationSha256 === sourceEvidence.semanticLocationSha256 &&
      binding.expectedSourceSemanticFingerprint ===
        sourceEvidence.semanticFingerprintSha256 &&
      binding.expectedSourceContextFingerprint ===
        sourceEvidence.contextFingerprintSha256
        ? [binding.bindingKey]
        : []
    )
  )
}

export function declarationContractBindingKeys(
  context: ProductionOperationContextV1,
  evidence: DeclarationEntityEvidenceV1
): readonly string[]
{
  const lineage = declarationLineage(context, evidence)
  const future = realizedFutureBindingKeys(context, lineage.lineageId)
  const owner = context.activeLineage.records.find(
    (record) => record.lineageId === lineage.ownerLineageId
  )
  const sourceTargetMatch = /^target:(0|[1-9][0-9]*)$/u.exec(
    owner?.rawIdentity ?? ''
  )
  const sourceTargetIndex = sourceTargetMatch
    ? Number(sourceTargetMatch[1])
    : null
  const source =
    sourceTargetIndex === null
      ? null
      : resolveDeclarationSourceEvidence(
          context,
          sourceTargetIndex,
          lineage.rawIdentity
        )
  return uniqueSorted([
    ...(source
      ? exactExistingBindingKeys(
          context,
          'declaration',
          source.declarationKind,
          source
        )
      : []),
    ...future,
  ])
}

function resolveDeclarationSourceEvidence(
  context: ProductionOperationContextV1,
  targetIndex: number,
  rawIdentity: string
): DeclarationEntityEvidenceV1 | null
{
  const [declarationKind, declarationId] = rawIdentity.split(':', 2)
  return (
    declarationEntityEvidenceSetV1(context.source).find(
      (candidate) =>
        candidate.targetIndex === targetIndex &&
        candidate.declarationKind === declarationKind &&
        candidate.declarationId === declarationId
    ) ?? null
  )
}

function resultSlot(
  entityKind: 'script' | 'block',
  name: 'script' | 'rootBlock' | 'destinationScript' | 'sourceGapRootBlock',
  evidence: ScriptEntityEvidenceV1 | BlockEntityEvidenceV1,
  lineageId: string,
  ownerLineageId: string
): ProductionResultSlotV1
{
  return {
    slotKind: 'fixed',
    name,
    entityKind,
    entitySubtype: 'unspecialized',
    lineageId,
    ownerLineageId,
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

function dynamicBlockSlot(
  slotKind: 'blockAlias' | 'cloneAlias',
  alias: string,
  evidence: BlockEntityEvidenceV1,
  lineageId: string,
  ownerLineageId: string
): ProductionDynamicBlockResultSlotV1
{
  return {
    slotKind,
    alias,
    entityKind: 'block',
    entitySubtype: 'unspecialized',
    lineageId,
    ownerLineageId,
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

function activeLineageForEvidence(
  active: SemanticLineageSnapshot,
  targetLineageId: string,
  evidence: ScriptEntityEvidenceV1 | BlockEntityEvidenceV1
): SemanticLineageRecord
{
  return activeRecord(
    active,
    evidence.entityKind,
    targetLineageId,
    evidence.entityKind === 'script'
      ? `script:${evidence.topBlockId}`
      : `block:${evidence.blockId}`
  )
}

function resultScriptEvidence(
  project: ProjectIR,
  targetIndex: number,
  topBlockId: string
): ScriptEntityEvidenceV1
{
  const matches = scriptEntityEvidenceSetV1(project).filter(
    (evidence) =>
      evidence.targetIndex === targetIndex && evidence.topBlockId === topBlockId
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      'created script does not have one exact post-operation evidence row'
    )
  return matches[0]!
}

function resultBlockEvidence(
  project: ProjectIR,
  targetIndex: number,
  blockId: string
): BlockEntityEvidenceV1
{
  const matches = blockEntityEvidenceSetV1(project).filter(
    (evidence) =>
      evidence.targetIndex === targetIndex && evidence.blockId === blockId
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      'created block does not have one exact post-operation evidence row'
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
  if (scope.locationScope.scopeKind === 'scriptClosure')
    return scope.locationScope.script.bindingKey
  return null
}

function scriptBlockPropertyAllowed(
  scope: ContractScopeV1,
  operation: ScriptBlockOperationV1
): boolean
{
  if (scope.scopeSubjectKind !== 'entity') return false
  if (operation.kind === 'block.setField')
    return scope.allowedPropertyPaths.some(
      (path) =>
        path.surface === 'blockField' &&
        path.descriptorName === operation.fieldName
    )
  if (operation.kind === 'block.setInput')
    return scope.allowedPropertyPaths.some(
      (path) =>
        path.surface === 'blockInput' &&
        path.descriptorName === operation.inputName
    )
  return true
}

function selectGroupDScope(
  context: ProductionOperationContextV1,
  operation: ScriptBlockOperationV1,
  entityKind: 'script' | 'block',
  entityBindingKeys: readonly string[],
  targetScopeBindingKeys: readonly string[],
  scriptScopeBindingKeys: readonly string[]
): ContractScopeV1
{
  if (!context.contract.allowedOperationKinds.includes(operation.kind))
    return fail(
      'edit.unauthorized_change',
      `change contract does not allow ${operation.kind}`
    )
  const exactKeys = new Set(entityBindingKeys)
  const targetKeys = new Set(targetScopeBindingKeys)
  const scriptKeys = new Set(scriptScopeBindingKeys)
  const matches = context.contract.allowedSemanticScopes.filter((scope) =>
  {
    if (
      scope.operationKind !== operation.kind ||
      scope.scopeSubjectKind !== 'entity' ||
      scope.entityKind !== entityKind ||
      scope.entitySubtype !== 'unspecialized' ||
      !scriptBlockPropertyAllowed(scope, operation)
    )
      return false
    if (scope.locationScope.scopeKind === 'exactEntity')
      return exactKeys.has(scope.locationScope.entity.bindingKey)
    if (scope.locationScope.scopeKind === 'targetAndOwnedDescendants')
      return targetKeys.has(scope.locationScope.target.bindingKey)
    if (scope.locationScope.scopeKind === 'scriptClosure')
      return scriptKeys.has(scope.locationScope.script.bindingKey)
    return false
  })
  if (matches.length !== 1)
    return fail(
      'edit.unauthorized_change',
      matches.length === 0
        ? `change contract has no exact Group D scope for ${operation.kind}`
        : `change contract has ambiguous Group D scopes for ${operation.kind}`
    )
  return matches[0]!
}

function structuralAuthorization(
  exactPaths: readonly string[]
): ProductionStructuralAuthorizationV1
{
  return {
    exactPaths: uniqueSorted(exactPaths),
    pathPrefixes: uniqueSorted(exactPaths),
  }
}

function publicRemovalPaths(
  operation: ScriptBlockOperationV1,
  resolved: ResolvedScriptDispatchV1 | ResolvedBlockDispatchV1
): readonly string[]
{
  if (operation.kind === 'script.remove')
  {
    const script = (resolved as ResolvedScriptDispatchV1).selectedScript
    if (!script)
      return fail(
        'edit.internal_invariant',
        'script removal lacks its exact selected script'
      )
    return Object.freeze([
      `/targets/${resolved.targetIndex}/blocks/${pointerPart(script.topBlockId)}`,
    ])
  }
  if (operation.kind === 'block.remove' || operation.kind === 'block.replace')
  {
    const block = (resolved as ResolvedBlockDispatchV1).selectedBlock
    return Object.freeze([
      `/targets/${resolved.targetIndex}/blocks/${pointerPart(block.blockId)}`,
    ])
  }
  return Object.freeze([])
}

interface CollectedGroupDResultSlotsV1
{
  readonly fixedSlots: readonly ProductionResultSlotV1[]
  readonly dynamicSlots: readonly ProductionDynamicBlockResultSlotV1[]
}

function collectScriptResultSlots(
  context: ProductionOperationContextV1,
  operation: ScriptBlockScriptOperationV1,
  targetIndex: number,
  targetLineageId: string,
  activeLineage: SemanticLineageSnapshot,
  applied: AppliedScriptStructuralOperationV1
): CollectedGroupDResultSlotsV1
{
  if (applied.createdTopBlockId === null)
    return { fixedSlots: Object.freeze([]), dynamicSlots: Object.freeze([]) }
  const scriptEvidence = resultScriptEvidence(
    context.candidate,
    targetIndex,
    applied.createdTopBlockId
  )
  const rootEvidence = resultBlockEvidence(
    context.candidate,
    targetIndex,
    applied.createdTopBlockId
  )
  const scriptLineage = activeLineageForEvidence(
    activeLineage,
    targetLineageId,
    scriptEvidence
  )
  const rootLineage = activeLineageForEvidence(
    activeLineage,
    targetLineageId,
    rootEvidence
  )
  const aliasKind =
    operation.kind === 'script.duplicate' ? 'cloneAlias' : 'blockAlias'
  const dynamicSlots = Object.entries(applied.aliasBlockIds)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alias, blockId]) =>
    {
      const evidence = resultBlockEvidence(
        context.candidate,
        targetIndex,
        blockId
      )
      const lineage = activeLineageForEvidence(
        activeLineage,
        targetLineageId,
        evidence
      )
      return dynamicBlockSlot(
        aliasKind,
        alias,
        evidence,
        lineage.lineageId,
        targetLineageId
      )
    })
  return {
    fixedSlots: Object.freeze([
      resultSlot(
        'script',
        'script',
        scriptEvidence,
        scriptLineage.lineageId,
        targetLineageId
      ),
      resultSlot(
        'block',
        'rootBlock',
        rootEvidence,
        rootLineage.lineageId,
        targetLineageId
      ),
    ]),
    dynamicSlots: Object.freeze(dynamicSlots),
  }
}

function collectBlockResultSlots(
  context: ProductionOperationContextV1,
  targetIndex: number,
  targetLineageId: string,
  activeLineage: SemanticLineageSnapshot,
  lineage: ReconciledGroupDLineageV1,
  applied: AppliedBlockStructuralOperationV1
): CollectedGroupDResultSlotsV1
{
  const fixedSlots: ProductionResultSlotV1[] = []
  const dynamicSlots: ProductionDynamicBlockResultSlotV1[] = []
  const addFixedBlock = (
    name: 'rootBlock' | 'sourceGapRootBlock',
    blockId: string | null
  ): void =>
  {
    if (blockId === null) return
    const evidence = resultBlockEvidence(
      context.candidate,
      targetIndex,
      blockId
    )
    const record = activeLineageForEvidence(
      activeLineage,
      targetLineageId,
      evidence
    )
    fixedSlots.push(
      resultSlot('block', name, evidence, record.lineageId, targetLineageId)
    )
  }
  addFixedBlock('rootBlock', applied.rootBlockId)
  addFixedBlock('sourceGapRootBlock', applied.sourceGapRootBlockId)
  if (applied.destinationScriptRootBlockId !== null)
  {
    const evidence = resultScriptEvidence(
      context.candidate,
      targetIndex,
      applied.destinationScriptRootBlockId
    )
    const record = activeLineageForEvidence(
      activeLineage,
      targetLineageId,
      evidence
    )
    if (lineage.createdScriptLineageIds.includes(record.lineageId))
      fixedSlots.push(
        resultSlot(
          'script',
          'destinationScript',
          evidence,
          record.lineageId,
          targetLineageId
        )
      )
  }
  for (const [alias, blockId] of Object.entries(applied.aliasBlockIds).sort(
    ([left], [right]) => left.localeCompare(right)
  ))
  {
    const evidence = resultBlockEvidence(
      context.candidate,
      targetIndex,
      blockId
    )
    const record = activeLineageForEvidence(
      activeLineage,
      targetLineageId,
      evidence
    )
    dynamicSlots.push(
      dynamicBlockSlot(
        'blockAlias',
        alias,
        evidence,
        record.lineageId,
        targetLineageId
      )
    )
  }
  for (const [alias, blockId] of Object.entries(
    applied.sourceGapAliasBlockIds
  ).sort(([left], [right]) => left.localeCompare(right)))
  {
    const evidence = resultBlockEvidence(
      context.candidate,
      targetIndex,
      blockId
    )
    const record = activeLineageForEvidence(
      activeLineage,
      targetLineageId,
      evidence
    )
    dynamicSlots.push(
      dynamicBlockSlot(
        'blockAlias',
        alias,
        evidence,
        record.lineageId,
        targetLineageId
      )
    )
  }
  return {
    fixedSlots: Object.freeze(fixedSlots),
    dynamicSlots: Object.freeze(dynamicSlots),
  }
}

function creationRoleForSlot(
  slot: ProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
): {
  readonly roleKind: 'fixed' | 'dynamic'
  readonly name:
    | 'script'
    | 'destinationScript'
    | 'rootBlock'
    | 'sourceGapRootBlock'
    | 'blockAlias'
    | 'cloneAlias'
  readonly alias?: string
}
{
  if (slot.slotKind === 'blockAlias' || slot.slotKind === 'cloneAlias')
    return {
      roleKind: 'dynamic',
      name: slot.slotKind,
      alias: slot.alias,
    }
  if (!slot.name)
    return fail('edit.internal_invariant', 'fixed result slot name is absent')
  if (
    slot.name === 'definitionScript' ||
    slot.name === 'procedure' ||
    slot.name === 'declaration' ||
    slot.name === 'comment' ||
    slot.name === 'media' ||
    slot.name === 'target'
  )
    return fail(
      'edit.internal_invariant',
      `Group D does not create a ${slot.name} result`
    )
  return { roleKind: 'fixed', name: slot.name }
}

function futureBindingScopeMatches(
  binding: ScriptBlockFutureContractBindingV1,
  targetBindingKeys: readonly string[],
  scriptBindingKeysForSlot: readonly string[]
): boolean
{
  if (binding.entityKind === 'script')
    return (
      binding.expectedCreationScope.scopeKind === 'targetAndOwnedDescendants' &&
      targetBindingKeys.includes(
        binding.expectedCreationScope.target.bindingKey
      )
    )
  if (binding.entityKind === 'block')
    return (
      binding.expectedCreationScope.scopeKind === 'scriptClosure' &&
      scriptBindingKeysForSlot.includes(
        binding.expectedCreationScope.script.bindingKey
      )
    )
  return false
}

function matchResultBindings(
  context: ProductionOperationContextV1,
  operation: ScriptBlockOperationV1,
  slots: CollectedGroupDResultSlotsV1,
  targetBindingKeysForCreation: readonly string[],
  scriptBindingKeysForSlot: (
    slot: ProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
  ) => readonly string[],
  creationContentFingerprint: (
    binding: ScriptBlockFutureContractBindingV1,
    slot: ProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
  ) => string,
  collisionNonceByLineageId: ReadonlyMap<string, number>,
  creationKeyByLineageId: ReadonlyMap<string, string>
): readonly ResultBindingMatchV1[]
{
  const results = [...slots.fixedSlots, ...slots.dynamicSlots]
  return Object.freeze(
    results.map((slot) =>
    {
      const role = creationRoleForSlot(slot)
      const matches = context.contract.entityBindings
        .filter(
          (binding): binding is ScriptBlockFutureContractBindingV1 =>
            binding.bindingKind === 'future' &&
            (binding.entityKind === 'script' || binding.entityKind === 'block')
        )
        .filter((binding) =>
        {
          if (
            binding.entityKind !== slot.entityKind ||
            binding.entitySubtype !== 'unspecialized' ||
            binding.expectedCreatorOperationKind !== operation.kind ||
            binding.expectedCreationRole.roleKind !== role.roleKind ||
            binding.expectedCreationRole.name !== role.name ||
            futureBindingAlreadyRealized(
              context.input.changeContractSha256,
              context.futureBindingLedger,
              binding.bindingKey
            ) ||
            !futureBindingScopeMatches(
              binding,
              targetBindingKeysForCreation,
              scriptBindingKeysForSlot(slot)
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
            ? `${operation.kind} result ${role.name} has no exact future binding`
            : `${operation.kind} result ${role.name} ambiguously matches future bindings`
        )
      const collisionNonce = collisionNonceByLineageId.get(slot.lineageId)
      const creationKey = creationKeyByLineageId.get(slot.lineageId)
      if (collisionNonce === undefined || creationKey === undefined)
        return fail(
          'edit.internal_invariant',
          `${operation.kind} result lineage lacks creation provenance`
        )
      return { binding: matches[0]!, slot, collisionNonce, creationKey }
    })
  )
}

function exactContractRef(
  context: ProductionOperationContextV1,
  bindingKeys: readonly string[],
  expectedEntityKind: ScriptBlockContractEntityResolutionRequestV1['expectedEntityKind'],
  expectedEntitySubtype: ScriptBlockContractEntityResolutionRequestV1['expectedEntitySubtype'],
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

function rawDeclarationEvidence(
  context: ProductionOperationContextV1,
  request: Extract<
    ScriptBlockContractEntityResolutionRequestV1,
    { sourceKind: 'rawDeclarationReference' }
  >
): DeclarationEntityEvidenceV1
{
  const candidates = declarationEntityEvidenceSetV1(context.candidate).filter(
    (evidence) =>
      evidence.declarationKind === request.expectedEntitySubtype &&
      evidence.declarationId === request.rawDeclarationId &&
      evidence.location.name === request.rawDisplayName
  )
  const ownerCandidates = candidates.filter(
    (evidence) => evidence.targetIndex === request.ownerTargetIndex
  )
  const stageCandidates = candidates.filter(
    (evidence) =>
      context.candidate.json.targets[evidence.targetIndex]?.isStage === true
  )
  const visible =
    request.expectedEntitySubtype === 'broadcast'
      ? stageCandidates
      : ownerCandidates.length > 0
        ? ownerCandidates
        : stageCandidates
  if (visible.length !== 1)
    return fail(
      'edit.selector_ambiguous',
      `${request.semanticPath} raw declaration reference is absent or ambiguous`,
      { matchCount: visible.length }
    )
  return visible[0]!
}

function resolveContractEntityReference(
  context: ProductionOperationContextV1,
  request: ScriptBlockContractEntityResolutionRequestV1
): ContractEntityRefV1
{
  if (request.sourceKind === 'semanticReference')
  {
    if (request.reference.entityKind === 'target')
    {
      const evidence = resolveTargetRefV1(
        context.candidate,
        request.reference,
        resolverAdapters(context).target
      )
      return exactContractRef(
        context,
        targetBindingKeys(context, evidence),
        request.expectedEntityKind,
        request.expectedEntitySubtype,
        request.semanticPath
      )
    }
    if (request.reference.entityKind === 'declaration')
    {
      const evidence = resolveDeclarationRefV1(
        context.candidate,
        request.reference,
        resolverAdapters(context)
      )
      return exactContractRef(
        context,
        declarationContractBindingKeys(context, evidence),
        request.expectedEntityKind,
        request.expectedEntitySubtype,
        request.semanticPath
      )
    }
    if (request.reference.entityKind !== 'media')
      return fail(
        'edit.invalid_shape',
        `${request.semanticPath} does not contain a media reference`
      )
    return mediaContractEntityRefV1(
      context,
      request.reference,
      request.expectedEntitySubtype,
      request.semanticPath
    )
  }
  if (request.sourceKind === 'rawDeclarationReference')
  {
    const evidence = rawDeclarationEvidence(context, request)
    return exactContractRef(
      context,
      declarationContractBindingKeys(context, evidence),
      request.expectedEntityKind,
      request.expectedEntitySubtype,
      request.semanticPath
    )
  }
  if (request.sourceKind === 'rawTarget')
  {
    const evidence = targetEntityEvidenceSetV1(context.candidate.json)[
      request.rawTargetIndex
    ]
    if (!evidence || evidence.name !== request.rawDisplayName)
      return fail(
        'edit.selector_no_match',
        `${request.semanticPath} raw target is absent or changed`
      )
    return exactContractRef(
      context,
      targetBindingKeys(context, evidence),
      request.expectedEntityKind,
      request.expectedEntitySubtype,
      request.semanticPath
    )
  }
  // procedure references belong to the Group E resolver; Group D never
  // produces one, so reaching here is an internal invariant break
  if (request.sourceKind !== 'rawScript')
    return fail(
      'edit.unsupported_operation',
      `${request.semanticPath} reference kind requires Group E authority`
    )
  const matches = scriptEntityEvidenceSetV1(context.candidate).filter(
    (evidence) =>
      evidence.targetIndex === request.ownerTargetIndex &&
      evidence.topBlockId === request.rawScriptTopBlockId
  )
  if (matches.length !== 1)
    return fail(
      'edit.selector_no_match',
      `${request.semanticPath} raw script is absent or ambiguous`
    )
  const evidence = matches[0]!
  const lineage = entityLineageIn(
    context.candidate,
    context.activeLineage,
    'script',
    evidence.targetIndex,
    `script:${evidence.topBlockId}`
  )
  return exactContractRef(
    context,
    allScriptBindingKeys(context, evidence, lineage.lineageId),
    request.expectedEntityKind,
    request.expectedEntitySubtype,
    request.semanticPath
  )
}

function creationContentFingerprint(
  context: ProductionOperationContextV1,
  sourceProject: ProjectIR,
  operation: ScriptBlockOperationV1,
  binding: ScriptBlockFutureContractBindingV1,
  slot: ProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1,
  resolved: ResolvedScriptDispatchV1 | ResolvedBlockDispatchV1
): string
{
  const sourceContext: ProductionOperationContextV1 = {
    ...context,
    candidate: sourceProject,
  }
  let scriptTopBlockId: string | undefined
  let blockId: string | undefined
  if ('selectedScript' in resolved && resolved.selectedScript)
    scriptTopBlockId = resolved.selectedScript.topBlockId
  if ('selectedBlock' in resolved)
  {
    scriptTopBlockId = resolved.selectedBlock.scriptTopBlockId ?? undefined
    if (
      operation.kind === 'block.move' &&
      slot.entityKind === 'script' &&
      slot.name === 'destinationScript'
    )
      blockId = resolved.selectedBlock.blockId
  }
  if (operation.kind === 'script.duplicate' && slot.slotKind === 'cloneAlias')
  {
    const exposure = resolved.resolved as Extract<
      ResolvedScriptStructuralOperationV1,
      { operation: SemanticEditOperationScriptDuplicateV1 }
    >
    const matches = exposure.exposedCloneSources.filter(
      (entry) => entry.alias === slot.alias
    )
    if (matches.length !== 1)
      return fail(
        'edit.internal_invariant',
        'clone result alias does not have one exact source block'
      )
    blockId = matches[0]!.sourceBlockId
  }
  return scriptBlockCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex: resolved.targetIndex,
    operation: resolved.canonicalOperation as ScriptBlockCreationOperationV1,
    descriptor: binding,
    resultRole: creationRoleForSlot(slot),
    selectedSource: {
      ...(scriptTopBlockId === undefined ? {} : { scriptTopBlockId }),
      ...(blockId === undefined ? {} : { blockId }),
    },
    resolveContractEntityRef: (request) =>
      resolveContractEntityReference(sourceContext, request),
  })
}

function scriptBindingKeysByLineage(
  context: ProductionOperationContextV1,
  targetIndex: number
): ReadonlyMap<string, readonly string[]>
{
  const entries = scriptEntityEvidenceSetV1(context.candidate)
    .filter((script) => script.targetIndex === targetIndex)
    .map((script) =>
    {
      const lineage = entityLineageIn(
        context.candidate,
        context.activeLineage,
        'script',
        targetIndex,
        `script:${script.topBlockId}`
      )
      return [
        lineage.lineageId,
        allScriptBindingKeys(context, script, lineage.lineageId),
      ] as const
    })
  return new Map(entries)
}

function splitResultSlots(slots: CollectedGroupDResultSlotsV1): {
  readonly scripts: CollectedGroupDResultSlotsV1
  readonly blocks: CollectedGroupDResultSlotsV1
}
{
  return {
    scripts: {
      fixedSlots: Object.freeze(
        slots.fixedSlots.filter((slot) => slot.entityKind === 'script')
      ),
      dynamicSlots: Object.freeze([]),
    },
    blocks: {
      fixedSlots: Object.freeze(
        slots.fixedSlots.filter((slot) => slot.entityKind === 'block')
      ),
      dynamicSlots: slots.dynamicSlots,
    },
  }
}

function executeResolvedScriptBlockOperation(
  context: ProductionOperationContextV1,
  resolved: ResolvedScriptDispatchV1 | ResolvedBlockDispatchV1,
  planningFactProjection: ScriptBlockPlanningFactProjectionV1
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
  if (
    'procedureArgumentGuard' in resolved &&
    resolved.procedureArgumentGuard !== undefined &&
    resolved.procedureArgumentGuard.actualSignatureSha256 !==
      resolved.procedureArgumentGuard.expectedSignatureSha256
  )
    return fail(
      'edit.fingerprint_mismatch',
      'current procedure signature differs from the planned signature'
    )
  const beforeScriptRawIdentities = targetScriptRawIdentities(
    context.candidate,
    resolved.targetIndex
  )
  const creationSourceProject = cloneProject(context.candidate)
  const priorScriptBindingKeys = scriptBindingKeysByLineage(
    context,
    resolved.targetIndex
  )
  const targetEvidence = exactCurrentTarget(context, resolved.targetIndex)
  const targetKeys = targetBindingKeys(context, targetEvidence)
  const adapters = createCuratedCoreOperationAdaptersV1(
    curatedEntityResolver(context)
  )
  const applied = operation.kind.startsWith('script.')
    ? applyScriptStructuralOperationV1(
        context.candidate,
        (resolved as ResolvedScriptDispatchV1).resolved,
        adapters.script
      )
    : applyBlockStructuralOperationV1(
        context.candidate,
        (resolved as ResolvedBlockDispatchV1).resolved,
        adapters.block
      )
  const lineage = reconcileGroupDLineage(
    context,
    operation,
    resolved.targetIndex,
    resolved.targetLineageId,
    beforeScriptRawIdentities,
    applied
  )
  const slots =
    'createdTopBlockId' in applied
      ? collectScriptResultSlots(
          context,
          operation as ScriptBlockScriptOperationV1,
          resolved.targetIndex,
          resolved.targetLineageId,
          lineage.activeLineage,
          applied
        )
      : collectBlockResultSlots(
          context,
          resolved.targetIndex,
          resolved.targetLineageId,
          lineage.activeLineage,
          lineage,
          applied
        )
  const splitSlots = splitResultSlots(slots)
  const noScriptScope = (): readonly string[] => Object.freeze([])
  const scriptMatches = matchResultBindings(
    context,
    operation,
    splitSlots.scripts,
    targetKeys,
    noScriptScope,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        operation,
        binding,
        slot,
        resolved
      ),
    lineage.collisionNonceByLineageId,
    lineage.creationKeyByLineageId
  )
  const createdScriptBindingKeys = new Map<string, string[]>()
  for (const match of scriptMatches)
  {
    const current = createdScriptBindingKeys.get(match.slot.lineageId)
    if (current) current.push(match.binding.bindingKey)
    else
      createdScriptBindingKeys.set(match.slot.lineageId, [
        match.binding.bindingKey,
      ])
  }
  const scriptKeysForSlot = (
    slot: ProductionResultSlotV1 | ProductionDynamicBlockResultSlotV1
  ): readonly string[] =>
  {
    if (slot.entityKind !== 'block') return Object.freeze([])
    const record = lineage.activeLineage.records.find(
      (candidate) => candidate.lineageId === slot.lineageId
    )
    const blockId = /^block:(.*)$/su.exec(record?.rawIdentity ?? '')?.[1]
    if (!blockId)
      return fail(
        'edit.internal_invariant',
        'created block identity is invalid'
      )
    const block = resultBlockEvidence(
      context.candidate,
      resolved.targetIndex,
      blockId
    )
    if (block.scriptTopBlockId === null)
      return fail(
        'edit.internal_invariant',
        'created result block has no exact owning script'
      )
    const script = resultScriptEvidence(
      context.candidate,
      resolved.targetIndex,
      block.scriptTopBlockId
    )
    const scriptLineage = activeLineageForEvidence(
      lineage.activeLineage,
      resolved.targetLineageId,
      script
    )
    return uniqueSorted([
      ...(priorScriptBindingKeys.get(scriptLineage.lineageId) ?? []),
      ...(createdScriptBindingKeys.get(scriptLineage.lineageId) ?? []),
    ])
  }
  const blockMatches = matchResultBindings(
    context,
    operation,
    splitSlots.blocks,
    targetKeys,
    scriptKeysForSlot,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        operation,
        binding,
        slot,
        resolved
      ),
    lineage.collisionNonceByLineageId,
    lineage.creationKeyByLineageId
  )
  const bindingMatches = [...scriptMatches, ...blockMatches]
  const createdBindingKeys = bindingMatches.map(
    (match) => match.binding.bindingKey
  )
  const primaryEntityKeys =
    'selectedScript' in resolved && resolved.selectedScript !== undefined
      ? allScriptBindingKeys(
          context,
          resolved.selectedScript,
          activeRecord(
            context.activeLineage,
            'script',
            resolved.targetLineageId,
            `script:${resolved.selectedScript.topBlockId}`
          ).lineageId
        )
      : 'selectedBlock' in resolved
        ? allBlockBindingKeys(
            context,
            resolved.selectedBlock,
            activeRecord(
              context.activeLineage,
              'block',
              resolved.targetLineageId,
              `block:${resolved.selectedBlock.blockId}`
            ).lineageId
          )
        : Object.freeze([])
  const sourceScriptKeys =
    'selectedBlock' in resolved
      ? (() =>
        {
          const script = currentScriptForBlock(
            creationSourceProject,
            resolved.selectedBlock
          )
          const lineageId = entityLineageIn(
            creationSourceProject,
            context.activeLineage,
            'script',
            script.targetIndex,
            `script:${script.topBlockId}`
          ).lineageId
          return priorScriptBindingKeys.get(lineageId) ?? []
        })()
      : 'selectedScript' in resolved && resolved.selectedScript
        ? primaryEntityKeys
        : []
  const scopeEntityKeys = uniqueSorted([
    ...primaryEntityKeys,
    ...createdBindingKeys,
  ])
  const selectedScope = selectGroupDScope(
    context,
    operation,
    operation.kind.startsWith('script.') ? 'script' : 'block',
    scopeEntityKeys,
    targetKeys,
    uniqueSorted([
      ...sourceScriptKeys,
      ...[...createdScriptBindingKeys.values()].flatMap((keys) => keys),
    ])
  )
  const exactPaths = applied.exactPaths
  const affectedBlockIds =
    'affectedBlockIds' in applied
      ? applied.affectedBlockIds
      : uniqueSorted([...applied.createdBlockIds, ...applied.removedBlockIds])
  const selectedLineageIds = uniqueSorted([
    ...resolved.selectedLineageIds,
    ...lineage.selectedLineageIds,
    ...slots.fixedSlots.map((slot) => slot.lineageId),
    ...slots.dynamicSlots.map((slot) => slot.lineageId),
  ])
  const effectEvidence = {
    catalogEvidence: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
    applied,
    postTargetScriptSetSha256: semanticHashV1('evidence-content', {
      targetIndex: resolved.targetIndex,
      scripts: targetScriptRawIdentities(
        context.candidate,
        resolved.targetIndex
      ),
    }),
  }
  return {
    canonicalOperation: resolved.canonicalOperation,
    selectedScope,
    result: operationResult(
      resolved.canonicalOperation,
      selectedLineageIds,
      slots.fixedSlots,
      effectEvidence,
      slots.dynamicSlots
    ),
    attribution: {
      operationId: operation.opId,
      blocks: Object.freeze(
        affectedBlockIds.map((blockId) => ({
          targetIndex: resolved.targetIndex,
          blockId,
        }))
      ),
      projectPaths: uniqueSorted(exactPaths),
      pathPrefixes: uniqueSorted(exactPaths),
    },
    activeLineage: lineage.activeLineage,
    planningFactProjection,
    matchedContractBindingKeys: uniqueSorted([
      ...scopeEntityKeys,
      ...targetKeys,
      ...sourceScriptKeys,
      ...createdBindingKeys,
      ...(scopeBindingKey(selectedScope)
        ? [scopeBindingKey(selectedScope)!]
        : []),
    ]),
    selectedEntityLineageIds: selectedLineageIds,
    structuralAuthorization: structuralAuthorization(exactPaths),
    authorizationEvidence: {
      groupDGraph: {
        publicRemovalPaths: publicRemovalPaths(operation, resolved),
      },
    },
    ...(bindingMatches.length > 0
      ? {
          futureBindingRealizationCandidates:
            bindingRealizationCandidates(bindingMatches),
        }
      : {}),
  }
}

class ScriptStructuralProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'script.add',
    'script.duplicate',
    'script.remove',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `script structural dispatcher does not support ${operation.kind}`
      )
    const scriptOperation = operation as ScriptBlockScriptOperationV1
    const resolved = resolveScriptDispatch(context, scriptOperation)
    const planningFactProjection = productionGroupDPlanningFactProjectionV1(
      context,
      scriptOperation
    )
    return executeResolvedScriptBlockOperation(
      context,
      resolved,
      planningFactProjection
    )
  }
}

class BlockStructuralProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'block.insertBefore',
    'block.insertAfter',
    'block.insertSubstack',
    'block.replace',
    'block.move',
    'block.remove',
    'block.setField',
    'block.setInput',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `block structural dispatcher does not support ${operation.kind}`
      )
    const blockOperation = operation as ScriptBlockBlockOperationV1
    const resolved = resolveBlockDispatch(context, blockOperation)
    const planningFactProjection = productionGroupDPlanningFactProjectionV1(
      context,
      blockOperation
    )
    return executeResolvedScriptBlockOperation(
      context,
      resolved,
      planningFactProjection
    )
  }
}

export function scriptBlockProductionOperationDispatchersV1(): readonly ProductionOperationDispatcherV1[]
{
  return Object.freeze([
    new ScriptStructuralProductionOperationDispatcherV1(),
    new BlockStructuralProductionOperationDispatcherV1(),
  ])
}
