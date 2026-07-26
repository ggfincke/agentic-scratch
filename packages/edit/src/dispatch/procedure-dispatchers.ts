// packages/edit/src/dispatch/procedure-dispatchers.ts
// dispatch exact custom-procedure lifecycle & call-argument semantic operations

import { scratchRecordValue, type BlockInput } from '@scratch-agent/sb3'
import type { ProjectIR } from '@scratch-agent/ir'
import {
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
  activeOrderedSemanticLineages,
  applyProcedureOperationV1,
  blockEntityEvidenceSetV1,
  blockInputFingerprintV1,
  canonicalProcedureSignatureV1,
  commentEntityEvidenceSetV1,
  commentSetSha256V1,
  createCuratedCoreOperationAdaptersV1,
  declarationEntityEvidenceSetV1,
  externalArgumentReporterIdsV1,
  procedureCreationContentFingerprintForResultV1,
  parameterEntityEvidenceSetV1,
  planGraphClosureV1,
  procedureCallSitesV1,
  procedureEntityEvidenceSetV1,
  procedureOwnedBlockIdsV1,
  procedurePrototypeMutationV1,
  prospectiveProcedureCollisionSetSha256V1,
  prospectiveProcedureCollisionSetV1,
  resolveCommentRefV1,
  resolveDeclarationRefV1,
  resolveTargetRefV1,
  scriptEntityEvidenceSetV1,
  semanticHashV1,
  targetEntityEvidenceSetV1,
  validateOrderedCollectionCorrespondence,
  SEMANTIC_LINEAGE_VERSION_V1,
  validateSemanticLineageSnapshot,
  type AppliedProcedureOperationV1,
  type BlockEntityEvidenceV1,
  type BlockRefV1,
  type CommentEntityEvidenceV1,
  type CommentRefV1,
  type ContractEntityRefV1,
  type ContractScopeV1,
  type CuratedEntityResolutionRequestV1,
  type CuratedEntityResolverV1,
  type CuratedResolvedEntityV1,
  type DecodedProcedureSignatureV1,
  type DeclarationRefV1,
  type ScriptBlockContractEntityResolutionRequestV1,
  type MediaRefV1,
  type OperationPlanningChoiceV1,
  type ProcedureCreationOperationV1,
  type ProcedureCreationResultRoleV1,
  type OrderedCollectionCorrespondence,
  type OrderedCollectionMemberCorrespondence,
  type ParameterEntityEvidenceV1,
  type ParameterRefV1,
  type ProcedureCallSiteV1,
  type ProcedureEntityEvidenceV1,
  type ProcedureRecordV1,
  type ResolvedProcedureOperationV1,
  type ScriptEntityEvidenceV1,
  type SemanticEditOperationProcedureAddV1,
  type SemanticEditOperationProcedureRemoveV1,
  type SemanticEditOperationProcedureSetCallArgumentV1,
  type SemanticEditOperationProcedureUpdateSignatureV1,
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
  productionOperationResultV1,
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
  exactTargetRef,
  planningContext,
  resolveBlockSelectionRef,
  resolveTargetSelection,
  resolverAdapters,
  scriptBindingKeys,
  targetBindingKeys,
  targetLineageAt,
  tombstoneLineage,
  uniqueSorted,
  type PlanningEntityProjectionV1,
  type ProductionResultSlotV1,
} from './target-dispatchers.js'
import { declarationContractBindingKeys } from './script-block-dispatchers.js'
import {
  curatedMediaEntityV1,
  exactMediaRefV1,
  mediaContractEntityRefV1,
  resolveMediaReferenceV1,
} from './media-target-dispatchers.js'
import {
  canonicalParameterRefV1 as canonicalParameterRef,
  canonicalProcedureRefV1 as canonicalProcedureRef,
  exactParameterRefV1 as exactParameterRef,
  parameterLineageInV1 as parameterLineageIn,
  procedureLineageInV1 as procedureLineageIn,
  procedureRecordAtV1 as procedureRecordAt,
  procedureSignatureStateSha256V1 as procedureSignatureStateSha256V1,
  planningParameterV1 as planningParameter,
  planningProcedureV1 as planningProcedure,
  resolveParameterSelectionV1 as resolveParameterSelection,
  resolveProcedureSelectionV1 as resolveProcedureSelection,
} from './procedure-authority.js'
import type {
  ProductionOperationContextV1,
  ProductionOperationDispatcherV1,
  ProductionOperationDispatchResultV1,
  ProductionStructuralAuthorizationV1,
} from '../transaction/production-transaction.js'
import type {
  EditOperationPlanningChoiceSlotV1,
  EditOperationPlanningFactV1,
  EditOperationPlanningResultV1,
} from '../transaction/transaction.js'

type ProcedureLifecycleOperationV1 =
  | SemanticEditOperationProcedureAddV1
  | SemanticEditOperationProcedureUpdateSignatureV1
  | SemanticEditOperationProcedureRemoveV1

type ProcedureOperationV1 =
  | ProcedureLifecycleOperationV1
  | SemanticEditOperationProcedureSetCallArgumentV1

type ProcedureFutureContractBindingV1 = Extract<
  FutureContractBindingV1,
  { entityKind: 'script' | 'block' | 'procedure' | 'parameter' }
>

// a parameter result is neither a block nor a script, so Group D's dynamic block
// slot cannot carry it; Group E owns its own dynamic slot shape
export interface ProcedureProductionDynamicResultSlotV1
{
  readonly slotKind: 'parameter' | 'blockAlias'
  readonly alias: string
  readonly entityKind: 'parameter' | 'block'
  readonly entitySubtype: 'unspecialized'
  readonly lineageId: string
  readonly ownerLineageId: string
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
}

type ProcedureResultSlotV1 =
  ProductionResultSlotV1 | ProcedureProductionDynamicResultSlotV1

interface ProcedureProductionOperationResultV1
{
  readonly opId: string
  readonly operationKind: SemanticEditOperationV1['kind']
  readonly selectedLineageIds: readonly string[]
  readonly fixedSlots: readonly ProductionResultSlotV1[]
  readonly dynamicSlots?: readonly ProcedureProductionDynamicResultSlotV1[]
  readonly postconditionSha256: string
}

interface ProcedurePlanningFactProjectionV1
{
  readonly kind: 'group-e-procedure-planning-fact-set'
  readonly schemaVersion: 1
  readonly operationKind: ProcedureOperationV1['kind']
  readonly opId: string
  readonly selectedEntities: readonly PlanningEntityProjectionV1[]
  readonly selectedLineageIds: readonly string[]
  readonly catalogEvidence: typeof CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
  readonly facts: unknown
}

interface ResolvedCommentDispositionV1
{
  readonly canonical: SemanticEditOperationProcedureRemoveV1['comments']
  readonly commentIds: readonly string[]
  readonly evidence: readonly CommentEntityEvidenceV1[]
}

interface ResolvedProcedureDispatchV1
{
  readonly operation: ProcedureOperationV1
  readonly canonicalOperation: ProcedureOperationV1
  readonly targetIndex: number
  readonly targetLineageId: string
  readonly decoded: DecodedProcedureSignatureV1 | null
  readonly selectedProcedure: ProcedureEntityEvidenceV1 | null
  readonly selectedProcedureLineageId: string | null
  readonly selectedParameter: ParameterEntityEvidenceV1 | null
  readonly selectedCallBlockId: string | null
  readonly callSiteBlockIds: readonly string[]
  readonly comments: ResolvedCommentDispositionV1 | null
  readonly selectedLineageIds: readonly string[]
  readonly planningEntities: readonly PlanningEntityProjectionV1[]
  readonly facts: unknown
}

interface ResultBindingMatchV1
{
  readonly binding: ProcedureFutureContractBindingV1
  readonly slot: ProcedureResultSlotV1
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
// & canonicalize every other selector, matching the Group D graph rule.
function canonicalBlockRef(
  reference: BlockRefV1,
  evidence: BlockEntityEvidenceV1
): BlockRefV1
{
  return reference.refKind === 'created' ? reference : exactBlockRef(evidence)
}

function exactCurrentTarget(
  project: ProjectIR,
  targetIndex: number
): TargetEntityEvidenceV1
{
  const evidence = targetEntityEvidenceSetV1(project.json)[targetIndex]
  if (!evidence)
    return fail('edit.invalid_owner', 'current target evidence is absent')
  return evidence
}

function procedureCallSetSha256V1(
  targetIndex: number,
  proccode: string,
  sites: readonly ProcedureCallSiteV1[]
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'procedure-call-set',
    schemaVersion: 1,
    targetIndex,
    proccode,
    calls: sites.map((site) => ({
      blockId: site.blockId,
      argumentIds: site.argumentIds,
    })),
  })
}

function externalArgumentReporterSetSha256V1(
  targetIndex: number,
  proccode: string,
  blockIds: readonly string[]
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'procedure-external-argument-reporter-set',
    schemaVersion: 1,
    targetIndex,
    proccode,
    blockIds,
  })
}

function externalArgumentReporterIdsFor(
  project: ProjectIR,
  record: ProcedureRecordV1
): readonly string[]
{
  const target = project.json.targets[record.targetIndex]
  if (!target)
    return fail('edit.invalid_owner', 'procedure owner target is absent')
  return externalArgumentReporterIdsV1(
    project,
    record.targetIndex,
    new Set(procedureOwnedBlockIdsV1(target, record.definitionBlockId)),
    new Set(record.argumentNames)
  )
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

function resolveCommentSelection(
  context: ProductionOperationContextV1,
  reference: CommentRefV1,
  targetIndex: number
): CommentEntityEvidenceV1
{
  const evidence = resolveCommentRefV1(
    context.candidate,
    reference,
    resolverAdapters(context)
  )
  if (evidence.targetIndex !== targetIndex)
    return fail(
      'edit.invalid_owner',
      'comment disposition must remain on one exact target'
    )
  if (evidence.topologyStatus !== 'consistent')
    return fail(
      'edit.graph_failed',
      'comment disposition requires consistent block/comment topology'
    )
  return evidence
}

function resolveRemovalComments(
  context: ProductionOperationContextV1,
  targetIndex: number,
  disposition: SemanticEditOperationProcedureRemoveV1['comments']
): ResolvedCommentDispositionV1
{
  if (disposition.kind === 'rejectIfPresent')
    return {
      canonical: disposition,
      commentIds: Object.freeze([]),
      evidence: Object.freeze([]),
    }
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
    commentIds: Object.freeze(evidence.map((entry) => entry.commentId)),
    evidence: Object.freeze(evidence),
  }
}

function commentPlanningFact(
  project: ProjectIR,
  targetIndex: number,
  evidence: readonly CommentEntityEvidenceV1[]
): unknown
{
  const target = project.json.targets[targetIndex]
  if (!target) return fail('edit.invalid_owner', 'comment target is absent')
  return {
    commentIds: evidence.map((entry) => entry.commentId),
    semanticLocationSha256: evidence.map(
      (entry) => entry.semanticLocationSha256
    ),
    commentSetSha256: commentSetSha256V1(
      target,
      evidence.map((entry) => entry.commentId)
    ),
  }
}

function signatureFact(decoded: DecodedProcedureSignatureV1): unknown
{
  return {
    proccode: decoded.proccode,
    warp: decoded.warp,
    parameters: decoded.parameters.map((parameter) => ({
      localKey: parameter.localKey,
      name: parameter.name,
      parameterType: parameter.parameterType,
      defaultValue: parameter.defaultValue,
    })),
  }
}

// the executed identity is the serialized mutation payload, so the planning fact
// carries the exact JSON the prototype will hold, not just the decoded parts
function procedureStateFact(
  project: ProjectIR,
  record: ProcedureRecordV1
): unknown
{
  const calls = procedureCallSitesV1(
    project,
    record.targetIndex,
    record.proccode
  )
  return {
    proccode: record.proccode,
    warp: record.warp,
    argumentIds: record.argumentIds,
    argumentNames: record.argumentNames,
    argumentDefaults: record.argumentDefaults,
    prototypeMutation: procedurePrototypeMutationV1({
      proccode: record.proccode,
      argumentIds: record.argumentIds,
      argumentNames: record.argumentNames,
      argumentDefaults: record.argumentDefaults,
      warp: record.warp,
    }),
    signatureSha256: procedureSignatureStateSha256V1(record),
    callSetSha256: procedureCallSetSha256V1(
      record.targetIndex,
      record.proccode,
      calls
    ),
    calls: calls.map((site) => ({
      blockId: site.blockId,
      argumentIds: site.argumentIds,
    })),
    externalArgumentReporterIds: externalArgumentReporterIdsFor(
      project,
      record
    ),
  }
}

function collisionSetFact(
  project: ProjectIR,
  targetIndex: number,
  proccode: string,
  excluded: ReadonlySet<string>
): unknown
{
  const set = prospectiveProcedureCollisionSetV1(
    project,
    targetIndex,
    proccode,
    excluded
  )
  return {
    set,
    setSha256: prospectiveProcedureCollisionSetSha256V1(set),
  }
}

function resolveProcedureAddDispatch(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationProcedureAddV1
): ResolvedProcedureDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the owner; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const target = resolveTargetSelection(context, operation.target)
  const planningTargetIndex = target.canonical.targetIndex
  const decoded = canonicalProcedureSignatureV1(operation.signature)
  const canonicalBody =
    operation.body === undefined
      ? undefined
      : (canonicalizeSemanticValue(
          planning,
          operation.body
        ) as SemanticEditOperationProcedureAddV1['body'])
  const canonicalOperation: SemanticEditOperationProcedureAddV1 = {
    ...operation,
    target: exactTargetRef(target.canonical),
    ...(canonicalBody === undefined ? {} : { body: canonicalBody }),
  }
  return {
    operation,
    canonicalOperation,
    targetIndex: target.current.targetIndex,
    targetLineageId: target.lineageId,
    decoded,
    selectedProcedure: null,
    selectedProcedureLineageId: null,
    selectedParameter: null,
    selectedCallBlockId: null,
    callSiteBlockIds: Object.freeze([]),
    comments: null,
    selectedLineageIds: Object.freeze([target.lineageId]),
    planningEntities: Object.freeze([planningTarget(target.canonical)]),
    facts: {
      ownerTarget: planningTarget(target.canonical),
      signature: signatureFact(decoded),
      workspace: operation.workspace,
      authoredBody: canonicalBody ?? null,
      prospectiveCollisions: collisionSetFact(
        planning.candidate,
        planningTargetIndex,
        decoded.proccode,
        new Set<string>()
      ),
      requireExistingProspectiveCollisionCount:
        operation.requireExistingProspectiveCollisionCount,
      expectedProspectiveProcedureCollisionSetSha256:
        operation.expectedProspectiveProcedureCollisionSetSha256,
    },
  }
}

// the prospective set for a rename excludes the procedure's own definition &
// prototype plus every call the operation maps, so only foreign records remain
function updateSignatureExclusions(
  record: ProcedureRecordV1,
  callSiteBlockIds: readonly string[]
): ReadonlySet<string>
{
  return new Set<string>([
    record.definitionBlockId,
    record.prototypeBlockId,
    ...callSiteBlockIds,
  ])
}

function resolveProcedureUpdateSignatureDispatch(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationProcedureUpdateSignatureV1
): ResolvedProcedureDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the owner; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const procedure = resolveProcedureSelection(context, operation.procedure)
  const targetIndex = procedure.current.targetIndex
  const planningTargetIndex = procedure.canonical.targetIndex
  const record = procedureRecordAt(
    planning.candidate,
    planningTargetIndex,
    procedure.canonical.proccode
  )
  const decoded = canonicalProcedureSignatureV1(operation.signature)
  const targetLineageId = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    targetIndex
  ).lineageId
  const parameterLineage = operation.parameterLineage.map((entry) =>
    entry.lineage.kind === 'retain'
      ? {
          parameterLocalKey: entry.parameterLocalKey,
          lineage: {
            kind: 'retain' as const,
            existingParameter: canonicalParameterRef(
              entry.lineage.existingParameter,
              resolveParameterSelection(
                planning,
                entry.lineage.existingParameter,
                procedure.canonical
              )
            ),
          },
        }
      : entry
  )
  const callSites = operation.callSites.map((entry) =>
  {
    const call = resolveBlockSelectionRef(context, entry.call)
    if (call.current.targetIndex !== targetIndex)
      return fail(
        'edit.invalid_owner',
        'procedure call site must remain on one exact target'
      )
    return {
      entry,
      blockId: call.current.blockId,
      lineageId: call.lineageId,
      evidence: call.canonical,
      canonical: {
        ...entry,
        call: canonicalBlockRef(entry.call, call.canonical),
        arguments: canonicalizeSemanticValue(
          planning,
          entry.arguments
        ) as (typeof entry)['arguments'],
      },
    }
  })
  const callSiteBlockIds = Object.freeze(
    callSites.map((site) => site.blockId).sort()
  )
  const canonicalOperation: SemanticEditOperationProcedureUpdateSignatureV1 = {
    ...operation,
    procedure: canonicalProcedureRef(operation.procedure, procedure.canonical),
    parameterLineage,
    callSites: callSites.map((site) => site.canonical),
  }
  return {
    operation,
    canonicalOperation,
    targetIndex,
    targetLineageId,
    decoded,
    selectedProcedure: procedure.current,
    selectedProcedureLineageId: procedure.lineageId,
    selectedParameter: null,
    selectedCallBlockId: null,
    callSiteBlockIds,
    comments: null,
    selectedLineageIds: uniqueSorted([
      procedure.lineageId,
      ...callSites.map((site) => site.lineageId),
    ]),
    planningEntities: Object.freeze([
      planningProcedure(procedure.canonical),
      ...callSites.map((site) => planningBlock(site.evidence)),
    ]),
    facts: {
      ownerTarget: planningTarget(
        exactCurrentTarget(planning.candidate, planningTargetIndex)
      ),
      currentProcedure: procedureStateFact(planning.candidate, record),
      signature: signatureFact(decoded),
      expectedSignatureSha256: operation.expectedSignatureSha256,
      expectedCallSetSha256: operation.expectedCallSetSha256,
      mappedCallBlockIds: callSiteBlockIds,
      prospectiveCollisions: collisionSetFact(
        planning.candidate,
        planningTargetIndex,
        decoded.proccode,
        updateSignatureExclusions(record, callSiteBlockIds)
      ),
      requireFinalExternalProspectiveCollisionCount:
        operation.requireFinalExternalProspectiveCollisionCount,
      expectedProspectiveProcedureCollisionSetSha256:
        operation.expectedProspectiveProcedureCollisionSetSha256,
    },
  }
}

function resolveProcedureRemoveDispatch(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationProcedureRemoveV1
): ResolvedProcedureDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the owner; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const procedure = resolveProcedureSelection(context, operation.procedure)
  const targetIndex = procedure.current.targetIndex
  const planningTargetIndex = procedure.canonical.targetIndex
  const record = procedureRecordAt(
    planning.candidate,
    planningTargetIndex,
    procedure.canonical.proccode
  )
  const targetLineageId = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    targetIndex
  ).lineageId
  // a comment is addressed purely by location & yields only its stable
  // commentId, so it resolves on the canonical view like the ref that named it
  const comments = resolveRemovalComments(
    planning,
    planningTargetIndex,
    operation.comments
  )
  const target = planning.candidate.json.targets[planningTargetIndex]
  if (!target)
    return fail('edit.invalid_owner', 'procedure owner target is absent')
  const plan = planGraphClosureV1(target, 'script', record.definitionBlockId)
  const canonicalOperation: SemanticEditOperationProcedureRemoveV1 = {
    ...operation,
    procedure: canonicalProcedureRef(operation.procedure, procedure.canonical),
    comments: comments.canonical,
  }
  return {
    operation,
    canonicalOperation,
    targetIndex,
    targetLineageId,
    decoded: null,
    selectedProcedure: procedure.current,
    selectedProcedureLineageId: procedure.lineageId,
    selectedParameter: null,
    selectedCallBlockId: null,
    callSiteBlockIds: Object.freeze([]),
    comments,
    selectedLineageIds: uniqueSorted([
      procedure.lineageId,
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
    planningEntities: Object.freeze([planningProcedure(procedure.canonical)]),
    facts: {
      ownerTarget: planningTarget(
        exactCurrentTarget(planning.candidate, planningTargetIndex)
      ),
      currentProcedure: procedureStateFact(planning.candidate, record),
      ownedClosure: {
        kind: plan.kind,
        rootBlockId: plan.rootBlockId,
        orderedBlockIds: plan.orderedBlockIds,
        closureSha256: plan.closureSha256,
        attachedCommentIds: plan.attachedCommentIds,
      },
      expectedOwnedBlockCount: operation.expectedOwnedBlockCount,
      expectedOwnedClosureSha256: operation.expectedOwnedClosureSha256,
      expectedCallSetSha256: operation.expectedCallSetSha256,
      expectedExternalArgumentReporterSetSha256:
        operation.expectedExternalArgumentReporterSetSha256,
      requireFinalCallCount: operation.requireFinalCallCount,
      requireFinalExternalArgumentReporterCount:
        operation.requireFinalExternalArgumentReporterCount,
      comments: commentPlanningFact(
        planning.candidate,
        planningTargetIndex,
        comments.evidence
      ),
      commentDispositionKind: operation.comments.kind,
    },
  }
}

function resolveProcedureSetCallArgumentDispatch(
  context: ProductionOperationContextV1,
  operation: SemanticEditOperationProcedureSetCallArgumentV1
): ResolvedProcedureDispatchV1
{
  // references resolve against the running batch so an earlier operation may have
  // moved the owner; only the fact projection stays on the pre-batch view
  const planning = planningContext(context, operation)
  const procedure = resolveProcedureSelection(context, operation.procedure)
  const targetIndex = procedure.current.targetIndex
  const planningTargetIndex = procedure.canonical.targetIndex
  const record = procedureRecordAt(
    planning.candidate,
    planningTargetIndex,
    procedure.canonical.proccode
  )
  // a parameter is addressed purely by location & yields only its stable
  // argumentId, so it resolves on the canonical view like the ref that named it
  const parameter = resolveParameterSelection(
    planning,
    operation.parameter,
    procedure.canonical
  )
  const call = resolveBlockSelectionRef(context, operation.call)
  if (call.current.targetIndex !== targetIndex)
    return fail(
      'edit.invalid_owner',
      'procedure call argument must remain on one exact target'
    )
  const targetLineageId = targetLineageAt(
    context.activeLineage,
    context.candidate.json.targets.length,
    targetIndex
  ).lineageId
  const canonicalValue = canonicalizeSemanticValue(
    planning,
    operation.value
  ) as SemanticEditOperationProcedureSetCallArgumentV1['value']
  const canonicalOperation: SemanticEditOperationProcedureSetCallArgumentV1 = {
    ...operation,
    procedure: canonicalProcedureRef(operation.procedure, procedure.canonical),
    parameter: canonicalParameterRef(operation.parameter, parameter),
    call: canonicalBlockRef(operation.call, call.canonical),
    value: canonicalValue,
  }
  return {
    operation,
    canonicalOperation,
    targetIndex,
    targetLineageId,
    decoded: null,
    selectedProcedure: procedure.current,
    selectedProcedureLineageId: procedure.lineageId,
    selectedParameter: parameter,
    selectedCallBlockId: call.current.blockId,
    callSiteBlockIds: Object.freeze([call.current.blockId]),
    comments: null,
    selectedLineageIds: uniqueSorted([
      procedure.lineageId,
      call.lineageId,
      parameterLineageIn(
        context.activeLineage,
        procedure.lineageId,
        parameter.argumentId
      ).lineageId,
    ]),
    planningEntities: Object.freeze([
      planningProcedure(procedure.canonical),
      planningParameter(parameter),
      planningBlock(call.canonical),
    ]),
    facts: {
      ownerTarget: planningTarget(
        exactCurrentTarget(planning.candidate, planningTargetIndex)
      ),
      currentProcedure: procedureStateFact(planning.candidate, record),
      parameter: planningParameter(parameter),
      argumentId: parameter.argumentId,
      expectedSignatureSha256: operation.expectedSignatureSha256,
      expectedInputFingerprint: operation.expectedInputFingerprint,
      actualInputFingerprintSha256: blockInputFingerprintV1(
        planningTargetIndex,
        call.canonical.blockId,
        parameter.argumentId,
        currentCallInput(
          planning.candidate,
          planningTargetIndex,
          call.canonical.blockId,
          parameter.argumentId
        )
      ),
      replacedInput: operation.replacedInput,
      authoredValue: canonicalValue,
    },
  }
}

function currentCallInput(
  project: ProjectIR,
  targetIndex: number,
  blockId: string,
  argumentId: string
): BlockInput | undefined
{
  const entry = project.json.targets[targetIndex]?.blocks[blockId]
  if (entry === undefined || Array.isArray(entry))
    return fail('edit.selector_no_match', 'call argument owner is absent')
  return scratchRecordValue(entry.inputs, argumentId)
}

function resolveProcedureDispatch(
  context: ProductionOperationContextV1,
  operation: ProcedureOperationV1
): ResolvedProcedureDispatchV1
{
  if (operation.kind === 'procedure.add')
    return resolveProcedureAddDispatch(context, operation)
  if (operation.kind === 'procedure.updateSignature')
    return resolveProcedureUpdateSignatureDispatch(context, operation)
  if (operation.kind === 'procedure.remove')
    return resolveProcedureRemoveDispatch(context, operation)
  return resolveProcedureSetCallArgumentDispatch(context, operation)
}

function procedurePlanningFactProjection(
  resolved: ResolvedProcedureDispatchV1
): ProcedurePlanningFactProjectionV1
{
  return {
    kind: 'group-e-procedure-planning-fact-set',
    schemaVersion: 1,
    operationKind: resolved.operation.kind,
    opId: resolved.operation.opId,
    selectedEntities: resolved.planningEntities,
    selectedLineageIds: resolved.selectedLineageIds,
    catalogEvidence: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
    facts: resolved.facts,
  }
}

function productionProcedurePlanningFactProjectionV1(
  context: ProductionOperationContextV1,
  operation: ProcedureOperationV1
): ProcedurePlanningFactProjectionV1
{
  return procedurePlanningFactProjection(resolveProcedureDispatch(context, operation))
}

export function productionProcedurePlanningFactSetSha256V1(
  context: ProductionOperationContextV1,
  operation: ProcedureOperationV1
): string
{
  return semanticHashV1(
    'resolved-plan',
    productionProcedurePlanningFactProjectionV1(context, operation)
  )
}

function exactPlanningChoiceValueV1(
  choices: readonly OperationPlanningChoiceV1[],
  operationKind: SemanticEditOperationGoalV1['kind'],
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
  operationKind: SemanticEditOperationGoalV1['kind'],
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

function completedPlanningResultV1(
  context: ProductionOperationContextV1,
  operation: ProcedureOperationV1,
  facts: readonly EditOperationPlanningFactV1[]
): EditOperationPlanningResultV1
{
  const planningFactSetSha256 = productionProcedurePlanningFactSetSha256V1(
    context,
    operation
  )
  return Object.freeze({
    operationKind: operation.kind,
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

export function productionProcedureSimplePlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    {
      readonly kind:
        'procedure.add' | 'procedure.setCallArgument' | 'procedure.remove'
    }
  >,
  choices: readonly OperationPlanningChoiceV1[]
): EditOperationPlanningResultV1
{
  if (goal.kind === 'procedure.add')
  {
    assertExactPlanningChoiceSetV1(choices, goal.kind, [])
    const provisional: SemanticEditOperationProcedureAddV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedProspectiveProcedureCollisionSetSha256: '0'.repeat(64),
      requireExistingProspectiveCollisionCount: 0,
    }
    const resolved = resolveProcedureAddDispatch(context, provisional)
    const setSha256 = (
      resolved.facts as {
        readonly prospectiveCollisions: { readonly setSha256: string }
      }
    ).prospectiveCollisions.setSha256
    const operation: SemanticEditOperationProcedureAddV1 = {
      ...provisional,
      expectedProspectiveProcedureCollisionSetSha256: setSha256,
    }
    return completedPlanningResultV1(context, operation, [
      completedPlanningFactV1(
        '/expectedProspectiveProcedureCollisionSetSha256',
        'sha256',
        setSha256
      ),
      completedPlanningFactV1(
        '/requireExistingProspectiveCollisionCount',
        'integer',
        0
      ),
    ])
  }
  if (goal.kind === 'procedure.remove')
  {
    assertExactPlanningChoiceSetV1(choices, goal.kind, ['/comments'])
    const provisional: SemanticEditOperationProcedureRemoveV1 = {
      ...goal,
      expectedPlanningFactSetSha256: '0'.repeat(64),
      expectedCallSetSha256: '0'.repeat(64),
      expectedExternalArgumentReporterSetSha256: '0'.repeat(64),
      expectedOwnedBlockCount: 0,
      expectedOwnedClosureSha256: '0'.repeat(64),
      requireFinalCallCount: 0,
      requireFinalExternalArgumentReporterCount: 0,
      comments: exactPlanningChoiceValueV1(
        choices,
        goal.kind,
        '/comments'
      ) as SemanticEditOperationProcedureRemoveV1['comments'],
    }
    const resolved = resolveProcedureRemoveDispatch(context, provisional)
    const procedure = resolved.selectedProcedure
    if (!procedure)
      return fail('edit.internal_invariant', 'selected procedure is absent')
    const planning = planningContext(context, provisional)
    const record = procedureRecordAt(
      planning.candidate,
      procedure.targetIndex,
      procedure.proccode
    )
    const target = planning.candidate.json.targets[procedure.targetIndex]
    if (!target)
      return fail('edit.invalid_owner', 'procedure owner target is absent')
    const plan = planGraphClosureV1(target, 'script', record.definitionBlockId)
    const calls = procedureCallSitesV1(
      planning.candidate,
      record.targetIndex,
      record.proccode
    )
    const expectedCallSetSha256 = procedureCallSetSha256V1(
      record.targetIndex,
      record.proccode,
      calls
    )
    const external = externalArgumentReporterIdsFor(planning.candidate, record)
    const expectedExternalArgumentReporterSetSha256 =
      externalArgumentReporterSetSha256V1(
        record.targetIndex,
        record.proccode,
        external
      )
    const operation: SemanticEditOperationProcedureRemoveV1 = {
      ...provisional,
      expectedCallSetSha256,
      expectedExternalArgumentReporterSetSha256,
      expectedOwnedBlockCount: plan.orderedBlockIds.length,
      expectedOwnedClosureSha256: plan.closureSha256,
    }
    return completedPlanningResultV1(context, operation, [
      completedPlanningFactV1(
        '/expectedCallSetSha256',
        'sha256',
        expectedCallSetSha256
      ),
      completedPlanningFactV1(
        '/expectedExternalArgumentReporterSetSha256',
        'sha256',
        expectedExternalArgumentReporterSetSha256
      ),
      completedPlanningFactV1('/requireFinalCallCount', 'integer', 0),
      completedPlanningFactV1(
        '/requireFinalExternalArgumentReporterCount',
        'integer',
        0
      ),
      completedPlanningFactV1(
        '/expectedOwnedClosureSha256',
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
  assertExactPlanningChoiceSetV1(choices, goal.kind, [
    '/replacedInput/kind',
    '/replacedInput/comments',
  ])
  const replacementKind = exactPlanningChoiceValueV1(
    choices,
    goal.kind,
    '/replacedInput/kind'
  ) as SemanticEditOperationProcedureSetCallArgumentV1['replacedInput']['kind']
  const initialReplacement: SemanticEditOperationProcedureSetCallArgumentV1['replacedInput'] =
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
            SemanticEditOperationProcedureSetCallArgumentV1['replacedInput'],
            { readonly kind: 'deleteExactOwnedClosure' }
          >['comments'],
        }
  const provisional: SemanticEditOperationProcedureSetCallArgumentV1 = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    expectedSignatureSha256: '0'.repeat(64),
    expectedInputFingerprint: '0'.repeat(64),
    replacedInput: initialReplacement,
  }
  const resolved = resolveProcedureSetCallArgumentDispatch(context, provisional)
  const resolvedFacts = resolved.facts as {
    readonly currentProcedure: { readonly signatureSha256: string }
    readonly actualInputFingerprintSha256: string
  }
  const replacementFacts: EditOperationPlanningFactV1[] = []
  let replacedInput = initialReplacement
  if (initialReplacement.kind === 'deleteExactOwnedClosure')
  {
    const planning = planningContext(context, provisional)
    if (
      resolved.selectedCallBlockId === null ||
      resolved.selectedParameter === null
    )
      return fail(
        'edit.internal_invariant',
        'call argument planning selection is absent'
      )
    const current = currentCallInput(
      planning.candidate,
      resolved.targetIndex,
      resolved.selectedCallBlockId,
      resolved.selectedParameter.argumentId
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
        'planning replacement expected one owned call argument closure',
        { matchCount: 0 }
      )
    const target = planning.candidate.json.targets[resolved.targetIndex]
    if (!target)
      return fail('edit.invalid_owner', 'procedure owner target is absent')
    const plan = planGraphClosureV1(target, 'ownedBlock', activeId)
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
  const operation: SemanticEditOperationProcedureSetCallArgumentV1 = {
    ...provisional,
    expectedSignatureSha256: resolvedFacts.currentProcedure.signatureSha256,
    expectedInputFingerprint: resolvedFacts.actualInputFingerprintSha256,
    replacedInput,
  }
  return completedPlanningResultV1(context, operation, [
    completedPlanningFactV1(
      '/expectedSignatureSha256',
      'sha256',
      operation.expectedSignatureSha256
    ),
    completedPlanningFactV1(
      '/expectedInputFingerprint',
      'sha256',
      operation.expectedInputFingerprint
    ),
    ...replacementFacts,
  ])
}

const UPDATE_SIGNATURE_CHOICE_DESTINATIONS = Object.freeze([
  '/parameterLineage/*/lineage/kind',
  '/parameterLineage/*/lineage/existingParameter',
  '/prototypeReporters/*/disposition/kind',
  '/prototypeReporters/*/disposition/parameterLocalKey',
  '/prototypeReporters/*/disposition/comments',
  '/bodyParameterReporters/*/disposition/kind',
  '/bodyParameterReporters/*/disposition/parameterLocalKey',
  '/callSites/*/arguments/*/source/kind',
  '/callSites/*/arguments/*/source/existingParameter',
  '/callSites/*/arguments/*/source/replacedInput/kind',
  '/callSites/*/arguments/*/source/replacedInput/comments',
  '/callSites/*/arguments/*/source/value',
  '/callSites/*/removedArguments/*/removedInput/kind',
  '/callSites/*/removedArguments/*/removedInput/comments',
] as const)

export function productionProcedureUpdateSignatureChoiceSlotsV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: 'procedure.updateSignature' }
  >
): readonly EditOperationPlanningChoiceSlotV1[]
{
  const seed = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    expectedSignatureSha256: '0'.repeat(64),
    expectedCallSetSha256: '0'.repeat(64),
    expectedProspectiveProcedureCollisionSetSha256: '0'.repeat(64),
    requireFinalExternalProspectiveCollisionCount: 0 as const,
    parameterLineage: [],
    prototypeReporters: [],
    bodyParameterReporters: [],
    callSites: [],
  } satisfies SemanticEditOperationProcedureUpdateSignatureV1
  const planning = planningContext(context, seed)
  const procedure = resolveProcedureSelection(context, goal.procedure)
  const record = procedureRecordAt(
    planning.candidate,
    procedure.canonical.targetIndex,
    procedure.canonical.proccode
  )
  const decoded = canonicalProcedureSignatureV1(goal.signature)
  const parameters = parameterEntityEvidenceSetV1(planning.candidate).filter(
    (parameter) =>
      parameter.targetIndex === record.targetIndex &&
      parameter.proccode === record.proccode
  )
  const calls = procedureCallSitesV1(
    planning.candidate,
    record.targetIndex,
    record.proccode
  )
  const slots: EditOperationPlanningChoiceSlotV1[] = []
  const add = (
    destination: string,
    discriminator: string,
    currentState: string,
    evidenceIds: readonly string[]
  ): void =>
  {
    slots.push({
      destination,
      slotDiscriminator: discriminator,
      currentState,
      evidenceIds,
    })
  }
  for (const destination of UPDATE_SIGNATURE_CHOICE_DESTINATIONS)
  {
    if (destination.startsWith('/parameterLineage/'))
      decoded.parameters.forEach((parameter, index) =>
        add(
          destination,
          `new-parameter-${index}-${parameter.localKey}`,
          `new parameter ${index} ${parameter.name} (${parameter.parameterType})`,
          [procedure.canonical.semanticLocationSha256]
        )
      )
    else if (destination.startsWith('/prototypeReporters/'))
      parameters.forEach((parameter, index) =>
        add(
          destination,
          `prototype-parameter-${index}-${parameter.argumentId}`,
          `prototype reporter for existing parameter ${index} ${record.argumentNames[index] ?? ''}`,
          [parameter.semanticLocationSha256]
        )
      )
    else if (destination.startsWith('/bodyParameterReporters/'))
      parameters.forEach((parameter, index) =>
        add(
          destination,
          `body-parameter-${index}-${parameter.argumentId}`,
          `body reporters for existing parameter ${index} ${record.argumentNames[index] ?? ''}`,
          [parameter.semanticLocationSha256]
        )
      )
    else if (destination.startsWith('/callSites/*/arguments/'))
      calls.forEach((call, callIndex) =>
        decoded.parameters.forEach((parameter, parameterIndex) =>
          add(
            destination,
            `call-${callIndex}-${call.blockId}-new-${parameterIndex}-${parameter.localKey}`,
            `call ${callIndex} argument for new parameter ${parameterIndex} ${parameter.name}`,
            [procedure.canonical.semanticLocationSha256]
          )
        )
      )
    else
      calls.forEach((call, callIndex) =>
        parameters.forEach((parameter, parameterIndex) =>
          add(
            destination,
            `call-${callIndex}-${call.blockId}-old-${parameterIndex}-${parameter.argumentId}`,
            `call ${callIndex} disposition for old parameter ${parameterIndex} ${record.argumentNames[parameterIndex] ?? ''}`,
            [parameter.semanticLocationSha256]
          )
        )
      )
  }
  if (slots.length > 512)
    return fail(
      'edit.members_exceeded',
      `signature planning requires ${slots.length} choices; limit is 512`
    )
  return Object.freeze(slots)
}

function reporterSetSha256V1(
  targetIndex: number,
  proccode: string,
  argumentId: string,
  blockIds: readonly string[]
): string
{
  return semanticHashV1('semantic-fingerprint', {
    kind: 'procedure-parameter-reporter-set',
    schemaVersion: 1,
    targetIndex,
    proccode,
    argumentId,
    blockIds,
  })
}

function callArgumentSetSha256V1(
  targetIndex: number,
  proccode: string,
  site: ProcedureCallSiteV1
): string
{
  return semanticHashV1('semantic-fingerprint', {
    kind: 'procedure-call-argument-set',
    schemaVersion: 1,
    targetIndex,
    proccode,
    blockId: site.blockId,
    argumentIds: site.argumentIds,
  })
}

function updateSignatureInputReplacementV1(
  project: ProjectIR,
  targetIndex: number,
  callBlockId: string,
  argumentId: string,
  kind: 'requireNoOwnedBlock' | 'deleteExactOwnedClosure',
  comments: Extract<
    SemanticEditOperationProcedureSetCallArgumentV1['replacedInput'],
    { readonly kind: 'deleteExactOwnedClosure' }
  >['comments']
): {
  readonly replacement: SemanticEditOperationProcedureSetCallArgumentV1['replacedInput']
  readonly facts: readonly EditOperationPlanningFactV1[]
}
{
  if (kind === 'requireNoOwnedBlock')
    return { replacement: { kind }, facts: Object.freeze([]) }
  const current = currentCallInput(
    project,
    targetIndex,
    callBlockId,
    argumentId
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
      'signature planning expected one owned call argument closure',
      { matchCount: 0 }
    )
  const target = project.json.targets[targetIndex]
  if (!target)
    return fail('edit.invalid_owner', 'procedure owner target is absent')
  const plan = planGraphClosureV1(target, 'ownedBlock', activeId)
  return {
    replacement: {
      kind,
      expectedClosureSha256: plan.closureSha256,
      expectedOwnedBlockCount: plan.orderedBlockIds.length,
      comments,
    },
    facts: Object.freeze([
      completedPlanningFactV1(
        '/callSites/*/arguments/*/source/replacedInput/expectedClosureSha256',
        'sha256',
        plan.closureSha256
      ),
      completedPlanningFactV1(
        '/callSites/*/arguments/*/source/replacedInput/expectedOwnedBlockCount',
        'integer',
        plan.orderedBlockIds.length
      ),
    ]),
  }
}

export function productionProcedureUpdateSignaturePlanningCompletionV1(
  context: ProductionOperationContextV1,
  goal: Extract<
    SemanticEditOperationGoalV1,
    { readonly kind: 'procedure.updateSignature' }
  >,
  choices: readonly OperationPlanningChoiceV1[]
): EditOperationPlanningResultV1
{
  const expandedSlots = productionProcedureUpdateSignatureChoiceSlotsV1(
    context,
    goal
  )
  if (
    choices.length !== expandedSlots.length ||
    choices.some(
      (choice, index) =>
        choice.operationKind !== goal.kind ||
        choice.destination !== expandedSlots[index]?.destination
    )
  )
    return fail(
      'edit.cardinality_mismatch',
      'signature planning choices do not cover every expanded wildcard slot',
      { matchCount: choices.length }
    )
  const values = (destination: string): readonly unknown[] =>
    choices
      .filter((choice) => choice.destination === destination)
      .map((choice) => choice.selection.value)
  const seed: SemanticEditOperationProcedureUpdateSignatureV1 = {
    ...goal,
    expectedPlanningFactSetSha256: '0'.repeat(64),
    expectedSignatureSha256: '0'.repeat(64),
    expectedCallSetSha256: '0'.repeat(64),
    expectedProspectiveProcedureCollisionSetSha256: '0'.repeat(64),
    requireFinalExternalProspectiveCollisionCount: 0,
    parameterLineage: [],
    prototypeReporters: [],
    bodyParameterReporters: [],
    callSites: [],
  }
  const planning = planningContext(context, seed)
  const procedure = resolveProcedureSelection(context, goal.procedure)
  const record = procedureRecordAt(
    planning.candidate,
    procedure.canonical.targetIndex,
    procedure.canonical.proccode
  )
  const decoded = canonicalProcedureSignatureV1(goal.signature)
  const parameters = parameterEntityEvidenceSetV1(planning.candidate).filter(
    (parameter) =>
      parameter.targetIndex === record.targetIndex &&
      parameter.proccode === record.proccode
  )
  const parameterKinds = values(
    '/parameterLineage/*/lineage/kind'
  ) as readonly ('retain' | 'create')[]
  const chosenParameters = values(
    '/parameterLineage/*/lineage/existingParameter'
  ) as readonly ParameterRefV1[]
  const parameterLineage = decoded.parameters.map((parameter, index) => ({
    parameterLocalKey: parameter.localKey,
    lineage:
      parameterKinds[index] === 'retain'
        ? {
            kind: 'retain' as const,
            existingParameter: chosenParameters[index]!,
          }
        : { kind: 'create' as const },
  }))
  const parameterFacts = decoded.parameters.map((parameter) =>
    completedPlanningFactV1(
      '/parameterLineage/*/parameterLocalKey',
      'localKey',
      parameter.localKey
    )
  )
  const target = planning.candidate.json.targets[record.targetIndex]
  if (!target)
    return fail('edit.invalid_owner', 'procedure owner target is absent')
  const prototype = scratchRecordValue(target.blocks, record.prototypeBlockId)
  if (!prototype || Array.isArray(prototype))
    return fail('edit.selector_no_match', 'procedure prototype is absent')
  const prototypeKinds = values(
    '/prototypeReporters/*/disposition/kind'
  ) as readonly ('preserveExisting' | 'replaceForMappedParameter' | 'remove')[]
  const prototypeLocalKeys = values(
    '/prototypeReporters/*/disposition/parameterLocalKey'
  ) as readonly string[]
  const prototypeCommentChoices = values(
    '/prototypeReporters/*/disposition/comments'
  ) as readonly Extract<
    SemanticEditOperationProcedureUpdateSignatureV1['prototypeReporters'][number]['disposition'],
    { readonly kind: 'replaceForMappedParameter' }
  >['comments'][]
  const blockEvidence = blockEntityEvidenceSetV1(planning.candidate)
  const prototypeFacts: EditOperationPlanningFactV1[] = []
  const prototypeReporters = parameters.map((parameter, index) =>
  {
    const input = scratchRecordValue(prototype.inputs, parameter.argumentId)
    const reporterId = input?.[1]
    const reporter =
      typeof reporterId === 'string'
        ? blockEvidence.find(
            (block) =>
              block.targetIndex === record.targetIndex &&
              block.blockId === reporterId
          )
        : undefined
    if (!reporter)
      return fail(
        'edit.selector_no_match',
        'prototype parameter reporter is absent'
      )
    const reporterBlock = scratchRecordValue(target.blocks, reporter.blockId)
    const attached =
      reporterBlock &&
      !Array.isArray(reporterBlock) &&
      typeof reporterBlock.comment === 'string'
        ? [reporterBlock.comment]
        : []
    const prototypeKind = prototypeKinds[index]!
    const prototypeComments = prototypeCommentChoices[index]!
    const mappedLocalKey = prototypeLocalKeys[index]!
    const disposition =
      prototypeKind === 'preserveExisting'
        ? {
            kind: prototypeKind,
            parameterLocalKey: mappedLocalKey,
            expectedCommentSetSha256: commentSetSha256V1(target, attached),
          }
        : prototypeKind === 'replaceForMappedParameter'
          ? {
              kind: prototypeKind,
              parameterLocalKey: mappedLocalKey,
              comments: prototypeComments,
            }
          : {
              kind: prototypeKind,
              comments:
                prototypeComments.kind === 'reattachExactToParameterReporter'
                  ? fail(
                      'edit.invalid_shape',
                      'removed prototype reporter comments cannot reattach'
                    )
                  : prototypeComments,
            }
    prototypeFacts.push(
      completedPlanningFactV1(
        '/prototypeReporters/*/existingParameter',
        'parameterRef',
        exactParameterRef(parameter)
      ),
      completedPlanningFactV1(
        '/prototypeReporters/*/expectedReporterBlockFingerprint',
        'sha256',
        reporter.semanticFingerprintSha256
      )
    )
    if (disposition.kind === 'preserveExisting')
      prototypeFacts.push(
        completedPlanningFactV1(
          '/prototypeReporters/*/disposition/expectedCommentSetSha256',
          'sha256',
          disposition.expectedCommentSetSha256
        )
      )
    return {
      existingParameter: exactParameterRef(parameter),
      expectedReporterBlockFingerprint: reporter.semanticFingerprintSha256,
      disposition,
    }
  })
  const bodyKinds = values(
    '/bodyParameterReporters/*/disposition/kind'
  ) as readonly ('retainMapped' | 'requireFinalZero')[]
  const bodyLocalKeys = values(
    '/bodyParameterReporters/*/disposition/parameterLocalKey'
  ) as readonly string[]
  const owned = procedureOwnedBlockIdsV1(target, record.definitionBlockId)
  const bodyFacts: EditOperationPlanningFactV1[] = []
  const bodyParameterReporters = parameters.map((parameter, index) =>
  {
    const bodyKind = bodyKinds[index]!
    const reporterIds = owned.filter((blockId) =>
    {
      const block = scratchRecordValue(target.blocks, blockId)
      if (!block || Array.isArray(block)) return false
      return (
        (block.opcode === 'argument_reporter_string_number' ||
          block.opcode === 'argument_reporter_boolean') &&
        scratchRecordValue(block.fields, 'VALUE')?.[0] ===
          record.argumentNames[index]
      )
    })
    const expectedReporterSetSha256 = reporterSetSha256V1(
      record.targetIndex,
      record.proccode,
      parameter.argumentId,
      reporterIds
    )
    const disposition =
      bodyKind === 'retainMapped'
        ? {
            kind: bodyKind,
            parameterLocalKey: bodyLocalKeys[index]!,
          }
        : { kind: bodyKind, requireFinalReporterCount: 0 as const }
    bodyFacts.push(
      completedPlanningFactV1(
        '/bodyParameterReporters/*/existingParameter',
        'parameterRef',
        exactParameterRef(parameter)
      ),
      completedPlanningFactV1(
        '/bodyParameterReporters/*/expectedReporterSetSha256',
        'sha256',
        expectedReporterSetSha256
      )
    )
    if (disposition.kind === 'requireFinalZero')
      bodyFacts.push(
        completedPlanningFactV1(
          '/bodyParameterReporters/*/disposition/requireFinalReporterCount',
          'integer',
          0
        )
      )
    return {
      existingParameter: exactParameterRef(parameter),
      expectedReporterSetSha256,
      disposition,
    }
  })
  const callSites = procedureCallSitesV1(
    planning.candidate,
    record.targetIndex,
    record.proccode
  )
  const callArgumentKinds = values(
    '/callSites/*/arguments/*/source/kind'
  ) as readonly (
    'preserveParameter' | 'replaceParameter' | 'initializeNewParameter'
  )[]
  const callExistingParameters = values(
    '/callSites/*/arguments/*/source/existingParameter'
  ) as readonly ParameterRefV1[]
  const replacementKinds = values(
    '/callSites/*/arguments/*/source/replacedInput/kind'
  ) as readonly ('requireNoOwnedBlock' | 'deleteExactOwnedClosure')[]
  const replacementCommentChoices = values(
    '/callSites/*/arguments/*/source/replacedInput/comments'
  ) as readonly Extract<
    SemanticEditOperationProcedureSetCallArgumentV1['replacedInput'],
    { readonly kind: 'deleteExactOwnedClosure' }
  >['comments'][]
  const argumentValues = values(
    '/callSites/*/arguments/*/source/value'
  ) as readonly Extract<
    SemanticEditOperationProcedureUpdateSignatureV1['callSites'][number]['arguments'][number]['source'],
    { readonly kind: 'initializeNewParameter' }
  >['value'][]
  const removedKinds = values(
    '/callSites/*/removedArguments/*/removedInput/kind'
  ) as readonly ('requireNoOwnedBlock' | 'deleteExactOwnedClosure')[]
  const removedCommentChoices = values(
    '/callSites/*/removedArguments/*/removedInput/comments'
  ) as readonly Extract<
    SemanticEditOperationProcedureSetCallArgumentV1['replacedInput'],
    { readonly kind: 'deleteExactOwnedClosure' }
  >['comments'][]
  const callFacts: EditOperationPlanningFactV1[] = []
  const mappedExistingArgumentIds = new Set(
    parameterLineage.flatMap((entry) =>
      entry.lineage.kind === 'retain'
        ? [
            resolveParameterSelection(
              planning,
              entry.lineage.existingParameter,
              procedure.canonical
            ).argumentId,
          ]
        : []
    )
  )
  const callMappings = callSites.map((site, callIndex) =>
  {
    const call = blockEvidence.find(
      (block) =>
        block.targetIndex === record.targetIndex &&
        block.blockId === site.blockId
    )
    if (!call)
      return fail('edit.selector_no_match', 'procedure call block is absent')
    const argumentsForCall = decoded.parameters.map((parameter, index) =>
    {
      const choiceIndex = callIndex * decoded.parameters.length + index
      const callArgumentKind = callArgumentKinds[choiceIndex]!
      const callExistingParameter = callExistingParameters[choiceIndex]!
      const replacementKind = replacementKinds[choiceIndex]!
      const replacementComments = replacementCommentChoices[choiceIndex]!
      const argumentValue = argumentValues[choiceIndex]!
      if (callArgumentKind === 'initializeNewParameter')
        return {
          parameterLocalKey: parameter.localKey,
          source: {
            kind: 'initializeNewParameter' as const,
            value: argumentValue,
          },
        }
      const existing = resolveParameterSelection(
        planning,
        callExistingParameter,
        procedure.canonical
      )
      const existingParameter = callExistingParameter
      const expectedInputFingerprint = blockInputFingerprintV1(
        record.targetIndex,
        site.blockId,
        existing.argumentId,
        currentCallInput(
          planning.candidate,
          record.targetIndex,
          site.blockId,
          existing.argumentId
        )
      )
      callFacts.push(
        completedPlanningFactV1(
          '/callSites/*/arguments/*/source/expectedInputFingerprint',
          'sha256',
          expectedInputFingerprint
        )
      )
      if (callArgumentKind === 'preserveParameter')
        return {
          parameterLocalKey: parameter.localKey,
          source: {
            kind: callArgumentKind,
            existingParameter,
            expectedInputFingerprint,
          },
        }
      const replacement = updateSignatureInputReplacementV1(
        planning.candidate,
        record.targetIndex,
        site.blockId,
        existing.argumentId,
        replacementKind,
        replacementComments
      )
      callFacts.push(...replacement.facts)
      return {
        parameterLocalKey: parameter.localKey,
        source: {
          kind: callArgumentKind,
          existingParameter,
          expectedInputFingerprint,
          replacedInput: replacement.replacement,
          value: argumentValue,
        },
      }
    })
    const removedArguments = parameters
      .filter(
        (parameter) => !mappedExistingArgumentIds.has(parameter.argumentId)
      )
      .map((parameter) =>
      {
        const parameterIndex = parameters.indexOf(parameter)
        const choiceIndex = callIndex * parameters.length + parameterIndex
        const removedKind = removedKinds[choiceIndex]!
        const removedComments = removedCommentChoices[choiceIndex]!
        const expectedInputFingerprint = blockInputFingerprintV1(
          record.targetIndex,
          site.blockId,
          parameter.argumentId,
          currentCallInput(
            planning.candidate,
            record.targetIndex,
            site.blockId,
            parameter.argumentId
          )
        )
        const replacement = updateSignatureInputReplacementV1(
          planning.candidate,
          record.targetIndex,
          site.blockId,
          parameter.argumentId,
          removedKind,
          removedComments
        )
        callFacts.push(
          completedPlanningFactV1(
            '/callSites/*/removedArguments/*/existingParameter',
            'parameterRef',
            exactParameterRef(parameter)
          ),
          completedPlanningFactV1(
            '/callSites/*/removedArguments/*/expectedInputFingerprint',
            'sha256',
            expectedInputFingerprint
          ),
          ...replacement.facts.map((fact) => ({
            ...fact,
            destination: fact.destination.replace(
              '/arguments/*/source/replacedInput/',
              '/removedArguments/*/removedInput/'
            ),
          }))
        )
        return {
          existingParameter: exactParameterRef(parameter),
          expectedInputFingerprint,
          removedInput: replacement.replacement,
        }
      })
    const expectedArgumentSetSha256 = callArgumentSetSha256V1(
      record.targetIndex,
      record.proccode,
      site
    )
    callFacts.push(
      completedPlanningFactV1(
        '/callSites/*/call',
        'blockRef',
        exactBlockRef(call)
      ),
      completedPlanningFactV1(
        '/callSites/*/expectedArgumentSetSha256',
        'sha256',
        expectedArgumentSetSha256
      ),
      ...decoded.parameters.map((parameter) =>
        completedPlanningFactV1(
          '/callSites/*/arguments/*/parameterLocalKey',
          'localKey',
          parameter.localKey
        )
      )
    )
    return {
      call: exactBlockRef(call),
      expectedArgumentSetSha256,
      arguments: argumentsForCall,
      removedArguments,
    }
  })
  const expectedSignatureSha256 = procedureSignatureStateSha256V1(record)
  const expectedCallSetSha256 = procedureCallSetSha256V1(
    record.targetIndex,
    record.proccode,
    callSites
  )
  const expectedProspectiveProcedureCollisionSetSha256 =
    prospectiveProcedureCollisionSetSha256V1(
      prospectiveProcedureCollisionSetV1(
        planning.candidate,
        record.targetIndex,
        decoded.proccode,
        updateSignatureExclusions(
          record,
          callSites.map((site) => site.blockId)
        )
      )
    )
  const operation: SemanticEditOperationProcedureUpdateSignatureV1 = {
    ...seed,
    expectedSignatureSha256,
    expectedCallSetSha256,
    expectedProspectiveProcedureCollisionSetSha256,
    parameterLineage,
    prototypeReporters,
    bodyParameterReporters,
    callSites: callMappings,
  }
  return completedPlanningResultV1(context, operation, [
    completedPlanningFactV1(
      '/expectedSignatureSha256',
      'sha256',
      expectedSignatureSha256
    ),
    ...parameterFacts,
    ...prototypeFacts,
    ...bodyFacts,
    ...callFacts,
    completedPlanningFactV1(
      '/expectedCallSetSha256',
      'sha256',
      expectedCallSetSha256
    ),
    completedPlanningFactV1(
      '/expectedProspectiveProcedureCollisionSetSha256',
      'sha256',
      expectedProspectiveProcedureCollisionSetSha256
    ),
    completedPlanningFactV1(
      '/requireFinalExternalProspectiveCollisionCount',
      'integer',
      0
    ),
  ])
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
    const lineage = entityLineageIn(
      context.candidate,
      context.activeLineage,
      'declaration',
      declaration.targetIndex,
      `${declaration.declarationKind}:${declaration.declarationId}`
    )
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
  kind: 'script' | 'block' | 'comment' | 'procedure' | 'parameter',
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
  kind: 'script' | 'block' | 'comment' | 'procedure' | 'parameter',
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
  kind: 'script' | 'comment' | 'parameter',
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

function orderedParameterRawIdentities(
  applied: AppliedProcedureOperationV1,
  decoded: DecodedProcedureSignatureV1 | null
): readonly string[]
{
  if (!decoded) return Object.freeze([])
  return Object.freeze(
    decoded.parameters.map(
      (parameter) =>
        `parameter:${applied.argumentIdByLocalKey[parameter.localKey]!}`
    )
  )
}

interface ReconciledProcedureLineageV1
{
  readonly activeLineage: SemanticLineageSnapshot
  readonly collisionNonceByLineageId: ReadonlyMap<string, number>
  readonly creationKeyByLineageId: ReadonlyMap<string, string>
  readonly procedureLineageId: string | null
  readonly createdProcedureLineageId: string | null
  readonly createdScriptLineageIds: readonly string[]
  readonly createdParameterLineageIdByLocalKey: ReadonlyMap<string, string>
  readonly selectedLineageIds: readonly string[]
}

function reconcileProcedureLineage(
  context: ProductionOperationContextV1,
  resolved: ResolvedProcedureDispatchV1,
  beforeScriptRawIdentities: readonly string[],
  beforeArgumentIds: readonly string[],
  applied: AppliedProcedureOperationV1
): ReconciledProcedureLineageV1
{
  const operation = resolved.operation
  const targetLineageId = resolved.targetLineageId
  let active = context.activeLineage
  const collisionNonceByLineageId = new Map<string, number>()
  const creationKeyByLineageId = new Map<string, string>()
  const createdParameterLineageIdByLocalKey = new Map<string, string>()
  const createdScriptLineageIds: string[] = []
  const selectedLineageIds = new Set<string>()
  let procedureLineageId = resolved.selectedProcedureLineageId
  let createdProcedureLineageId: string | null = null

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
  for (const blockId of applied.createdBlockIds)
  {
    const authoredCreationKey = applied.creationKeyByBlockId[blockId]
    if (!authoredCreationKey)
      return fail(
        'edit.internal_invariant',
        `created block ${blockId} lacks a descriptor-owned creation key`
      )
    const created = createLineage(
      context,
      operation.opId,
      'block',
      targetLineageId,
      `block:${blockId}`,
      null,
      `authored-block:${authoredCreationKey}`,
      active
    )
    active = created.activeLineage
    collisionNonceByLineageId.set(
      created.record.lineageId,
      created.collisionNonce
    )
    creationKeyByLineageId.set(created.record.lineageId, created.creationKey)
  }

  if (operation.kind === 'procedure.add')
  {
    const created = createLineage(
      context,
      operation.opId,
      'procedure',
      targetLineageId,
      `procedure:${applied.proccode}`,
      null,
      'fixed:procedure',
      active
    )
    active = created.activeLineage
    procedureLineageId = created.record.lineageId
    createdProcedureLineageId = created.record.lineageId
    collisionNonceByLineageId.set(
      created.record.lineageId,
      created.collisionNonce
    )
    creationKeyByLineageId.set(created.record.lineageId, created.creationKey)
  }
  if (procedureLineageId === null)
    return fail(
      'edit.internal_invariant',
      'Group E operation has no owning procedure lineage'
    )
  // a rename keeps the procedure identity & only moves its raw proccode, so the
  // ordered-collection correspondence can prove a stable lineage
  if (
    operation.kind === 'procedure.updateSignature' &&
    resolved.selectedProcedure &&
    resolved.selectedProcedure.proccode !== applied.proccode
  )
  {
    selectedLineageIds.add(procedureLineageId)
    active = replaceLineageRawIdentity(
      active,
      procedureLineageId,
      `procedure:${applied.proccode}`
    )
  }

  // only an operation that authors a signature moves the parameter set; a call
  // argument edit leaves every parameter lineage exactly as it found it
  const authorsSignature =
    operation.kind === 'procedure.add' ||
    operation.kind === 'procedure.updateSignature'
  if (authorsSignature)
  {
    const finalArgumentIds = new Set(
      Object.values(applied.argumentIdByLocalKey)
    )
    for (const argumentId of beforeArgumentIds)
    {
      if (finalArgumentIds.has(argumentId)) continue
      const record = activeRecord(
        active,
        'parameter',
        procedureLineageId,
        `parameter:${argumentId}`
      )
      selectedLineageIds.add(record.lineageId)
      active = tombstoneLineage(active, record.lineageId)
    }
    const retainedArgumentIds = new Set(beforeArgumentIds)
    for (const [localKey, argumentId] of Object.entries(
      applied.argumentIdByLocalKey
    ).sort(([left], [right]) => left.localeCompare(right)))
    {
      if (retainedArgumentIds.has(argumentId)) continue
      const created = createLineage(
        context,
        operation.opId,
        'parameter',
        procedureLineageId,
        `parameter:${argumentId}`,
        applied.argumentOrdinalById[argumentId] ?? null,
        `procedure-parameter:${procedureLineageId}:${localKey}`,
        active
      )
      active = created.activeLineage
      createdParameterLineageIdByLocalKey.set(
        localKey,
        created.record.lineageId
      )
      collisionNonceByLineageId.set(
        created.record.lineageId,
        created.collisionNonce
      )
      creationKeyByLineageId.set(created.record.lineageId, created.creationKey)
    }
  }

  if (operation.kind === 'procedure.remove')
  {
    for (const argumentId of beforeArgumentIds)
    {
      const matches = active.records.filter(
        (record) =>
          record.status === 'active' &&
          record.kind === 'parameter' &&
          record.ownerLineageId === procedureLineageId &&
          record.rawIdentity === `parameter:${argumentId}`
      )
      for (const record of matches)
      {
        selectedLineageIds.add(record.lineageId)
        active = tombstoneLineage(active, record.lineageId)
      }
    }
    selectedLineageIds.add(procedureLineageId)
    active = tombstoneLineage(active, procedureLineageId)
  }

  const afterScriptRawIdentities = targetScriptRawIdentities(
    context.candidate,
    resolved.targetIndex
  )
  const beforeSet = new Set(beforeScriptRawIdentities)
  const afterSet = new Set(afterScriptRawIdentities)
  for (const rawIdentity of beforeScriptRawIdentities.filter(
    (entry) => !afterSet.has(entry)
  ))
  {
    const record = activeRecord(active, 'script', targetLineageId, rawIdentity)
    selectedLineageIds.add(record.lineageId)
    active = tombstoneLineage(active, record.lineageId)
  }
  for (const rawIdentity of afterScriptRawIdentities.filter(
    (entry) => !beforeSet.has(entry)
  ))
  {
    const created = createLineage(
      context,
      operation.opId,
      'script',
      targetLineageId,
      rawIdentity,
      afterScriptRawIdentities.indexOf(rawIdentity),
      'fixed:definitionScript',
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
    targetCommentRawIdentities(context.candidate, resolved.targetIndex)
  )
  if (operation.kind !== 'procedure.remove' && resolved.decoded)
    active = reindexOwnerLineages(
      active,
      'parameter',
      procedureLineageId,
      orderedParameterRawIdentities(applied, resolved.decoded)
    )
  return {
    activeLineage: active,
    collisionNonceByLineageId,
    creationKeyByLineageId,
    procedureLineageId,
    createdProcedureLineageId,
    createdScriptLineageIds: Object.freeze(createdScriptLineageIds),
    createdParameterLineageIdByLocalKey,
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

// a procedure binding is matched on its exact source evidence triple, exactly
// like every other existing entity binding in the contract
function procedureBindingKeys(
  context: ProductionOperationContextV1,
  evidence: ProcedureEntityEvidenceV1,
  lineageId: string
): readonly string[]
{
  const source = procedureEntityEvidenceSetV1(context.source).find(
    (candidate) =>
      candidate.targetIndex === evidence.targetIndex &&
      candidate.proccode === evidence.proccode
  )
  const existing = source
    ? context.contract.entityBindings.flatMap((binding) =>
        binding.bindingKind === 'existing' &&
        binding.entityKind === 'procedure' &&
        binding.entitySubtype === 'unspecialized' &&
        binding.expectedMatchCount === 1 &&
        binding.sourceLocationSha256 === source.semanticLocationSha256 &&
        binding.expectedSourceSemanticFingerprint ===
          source.semanticFingerprintSha256 &&
        binding.expectedSourceContextFingerprint ===
          source.contextFingerprintSha256
          ? [binding.bindingKey]
          : []
      )
    : []
  return uniqueSorted([
    ...existing,
    ...realizedFutureBindingKeys(context, lineageId),
  ])
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

function resultProcedureEvidence(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): ProcedureEntityEvidenceV1
{
  const matches = procedureEntityEvidenceSetV1(project).filter(
    (evidence) =>
      evidence.targetIndex === targetIndex && evidence.proccode === proccode
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      'created procedure does not have one exact post-operation evidence row'
    )
  return matches[0]!
}

function resultParameterEvidence(
  project: ProjectIR,
  targetIndex: number,
  proccode: string,
  argumentId: string
): ParameterEntityEvidenceV1
{
  const matches = parameterEntityEvidenceSetV1(project).filter(
    (evidence) =>
      evidence.targetIndex === targetIndex &&
      evidence.proccode === proccode &&
      evidence.argumentId === argumentId
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      'created parameter does not have one exact post-operation evidence row'
    )
  return matches[0]!
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

interface CollectedProcedureResultSlotsV1
{
  readonly fixedSlots: readonly ProductionResultSlotV1[]
  readonly dynamicSlots: readonly ProcedureProductionDynamicResultSlotV1[]
}

function fixedSlot(
  name: 'procedure' | 'definitionScript' | 'rootBlock',
  entityKind: 'procedure' | 'script' | 'block',
  evidence: {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
    readonly contextFingerprintSha256: string
  },
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

function dynamicSlot(
  slotKind: 'parameter' | 'blockAlias',
  alias: string,
  entityKind: 'parameter' | 'block',
  evidence: {
    readonly semanticLocationSha256: string
    readonly semanticFingerprintSha256: string
    readonly contextFingerprintSha256: string
  },
  lineageId: string,
  ownerLineageId: string
): ProcedureProductionDynamicResultSlotV1
{
  return {
    slotKind,
    alias,
    entityKind,
    entitySubtype: 'unspecialized',
    lineageId,
    ownerLineageId,
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

function callArgumentRootBlockId(
  project: ProjectIR,
  targetIndex: number,
  callBlockId: string,
  argumentId: string
): string | null
{
  const input = currentCallInput(project, targetIndex, callBlockId, argumentId)
  const owned = input?.[1]
  return typeof owned === 'string' ? owned : null
}

function collectProcedureResultSlots(
  context: ProductionOperationContextV1,
  resolved: ResolvedProcedureDispatchV1,
  lineage: ReconciledProcedureLineageV1,
  applied: AppliedProcedureOperationV1
): CollectedProcedureResultSlotsV1
{
  const fixedSlots: ProductionResultSlotV1[] = []
  const dynamicSlots: ProcedureProductionDynamicResultSlotV1[] = []
  const targetIndex = resolved.targetIndex
  if (lineage.createdProcedureLineageId !== null)
  {
    const evidence = resultProcedureEvidence(
      context.candidate,
      targetIndex,
      applied.proccode
    )
    fixedSlots.push(
      fixedSlot(
        'procedure',
        'procedure',
        evidence,
        lineage.createdProcedureLineageId,
        resolved.targetLineageId
      )
    )
  }
  for (const scriptLineageId of lineage.createdScriptLineageIds)
  {
    const record = lineage.activeLineage.records.find(
      (candidate) => candidate.lineageId === scriptLineageId
    )
    const topBlockId = /^script:(.*)$/su.exec(record?.rawIdentity ?? '')?.[1]
    if (!topBlockId)
      return fail(
        'edit.internal_invariant',
        'created definition script identity is invalid'
      )
    fixedSlots.push(
      fixedSlot(
        'definitionScript',
        'script',
        resultScriptEvidence(context.candidate, targetIndex, topBlockId),
        scriptLineageId,
        resolved.targetLineageId
      )
    )
  }
  if (
    resolved.operation.kind === 'procedure.setCallArgument' &&
    resolved.selectedCallBlockId !== null &&
    resolved.selectedParameter !== null
  )
  {
    const rootBlockId = callArgumentRootBlockId(
      context.candidate,
      targetIndex,
      resolved.selectedCallBlockId,
      resolved.selectedParameter.argumentId
    )
    if (rootBlockId !== null && applied.createdBlockIds.includes(rootBlockId))
    {
      const evidence = resultBlockEvidence(
        context.candidate,
        targetIndex,
        rootBlockId
      )
      fixedSlots.push(
        fixedSlot(
          'rootBlock',
          'block',
          evidence,
          activeRecord(
            lineage.activeLineage,
            'block',
            resolved.targetLineageId,
            `block:${rootBlockId}`
          ).lineageId,
          resolved.targetLineageId
        )
      )
    }
  }
  for (const [localKey, parameterLineageId] of [
    ...lineage.createdParameterLineageIdByLocalKey.entries(),
  ].sort(([left], [right]) => left.localeCompare(right)))
  {
    const argumentId = applied.argumentIdByLocalKey[localKey]
    if (argumentId === undefined)
      return fail(
        'edit.internal_invariant',
        `created parameter ${localKey} lacks a serialized argument id`
      )
    dynamicSlots.push(
      dynamicSlot(
        'parameter',
        localKey,
        'parameter',
        resultParameterEvidence(
          context.candidate,
          targetIndex,
          applied.proccode,
          argumentId
        ),
        parameterLineageId,
        lineage.procedureLineageId!
      )
    )
  }
  for (const [alias, blockId] of Object.entries(applied.aliasBlockIds).sort(
    ([left], [right]) => left.localeCompare(right)
  ))
  {
    if (applied.argumentIdByLocalKey[alias] !== undefined) continue
    if (!applied.createdBlockIds.includes(blockId)) continue
    dynamicSlots.push(
      dynamicSlot(
        'blockAlias',
        alias,
        'block',
        resultBlockEvidence(context.candidate, targetIndex, blockId),
        activeRecord(
          lineage.activeLineage,
          'block',
          resolved.targetLineageId,
          `block:${blockId}`
        ).lineageId,
        resolved.targetLineageId
      )
    )
  }
  return {
    fixedSlots: Object.freeze(fixedSlots),
    dynamicSlots: Object.freeze(dynamicSlots),
  }
}

// symmetric to the Group D role mapping; Group E owns procedure, definition
// script, parameter, root block, & authored block alias results
function procedureCreationRoleForSlot(
  slot: ProcedureResultSlotV1
): ProcedureCreationResultRoleV1
{
  if (slot.slotKind === 'parameter')
    return { roleKind: 'dynamic', name: 'parameter', alias: slot.alias }
  if (slot.slotKind !== 'fixed')
    return { roleKind: 'dynamic', name: 'blockAlias', alias: slot.alias }
  if (
    slot.name === 'procedure' ||
    slot.name === 'definitionScript' ||
    slot.name === 'rootBlock'
  )
    return { roleKind: 'fixed', name: slot.name }
  return fail(
    'edit.internal_invariant',
    `Group E does not create a ${slot.name} result`
  )
}

function futureBindingScopeMatches(
  binding: ProcedureFutureContractBindingV1,
  targetBindingKeysForCreation: readonly string[],
  procedureBindingKeysForSlot: readonly string[],
  scriptBindingKeysForSlot: readonly string[]
): boolean
{
  const scope = binding.expectedCreationScope
  if (binding.entityKind === 'procedure' || binding.entityKind === 'script')
    return (
      scope.scopeKind === 'targetAndOwnedDescendants' &&
      targetBindingKeysForCreation.includes(scope.target.bindingKey)
    )
  if (binding.entityKind === 'parameter')
    return (
      scope.scopeKind === 'procedureOwnedClosure' &&
      procedureBindingKeysForSlot.includes(scope.procedure.bindingKey)
    )
  return (
    scope.scopeKind === 'scriptClosure' &&
    scriptBindingKeysForSlot.includes(scope.script.bindingKey)
  )
}

function matchResultBindings(
  context: ProductionOperationContextV1,
  operation: ProcedureOperationV1,
  slots: readonly ProcedureResultSlotV1[],
  targetBindingKeysForCreation: readonly string[],
  procedureBindingKeysForSlot: (slot: ProcedureResultSlotV1) => readonly string[],
  scriptBindingKeysForSlot: (slot: ProcedureResultSlotV1) => readonly string[],
  creationContentFingerprint: (
    binding: ProcedureFutureContractBindingV1,
    slot: ProcedureResultSlotV1
  ) => string,
  collisionNonceByLineageId: ReadonlyMap<string, number>,
  creationKeyByLineageId: ReadonlyMap<string, string>
): readonly ResultBindingMatchV1[]
{
  return Object.freeze(
    slots.map((slot) =>
    {
      const role = procedureCreationRoleForSlot(slot)
      const matches = context.contract.entityBindings
        .filter(
          (binding): binding is ProcedureFutureContractBindingV1 =>
            binding.bindingKind === 'future' &&
            (binding.entityKind === 'script' ||
              binding.entityKind === 'block' ||
              binding.entityKind === 'procedure' ||
              binding.entityKind === 'parameter')
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
              procedureBindingKeysForSlot(slot),
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

function resolveContractEntityReference(
  context: ProductionOperationContextV1,
  request: ScriptBlockContractEntityResolutionRequestV1
): ContractEntityRefV1
{
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
  if (request.sourceKind === 'rawProcedure')
  {
    const matches = procedureEntityEvidenceSetV1(context.candidate).filter(
      (evidence) =>
        evidence.targetIndex === request.ownerTargetIndex &&
        evidence.proccode === request.rawProccode
    )
    if (matches.length !== 1)
      return fail(
        'edit.selector_no_match',
        `${request.semanticPath} raw procedure is absent or ambiguous`
      )
    const evidence = matches[0]!
    const lineageId = procedureLineageIn(
      context.candidate,
      context.activeLineage,
      evidence.targetIndex,
      evidence.proccode
    ).lineageId
    return exactContractRef(
      context,
      procedureBindingKeys(context, evidence, lineageId),
      request.expectedEntityKind,
      request.expectedEntitySubtype,
      request.semanticPath
    )
  }
  if (request.sourceKind === 'rawScript')
  {
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
  return exactContractRef(
    context,
    declarationContractBindingKeys(context, visible[0]!),
    request.expectedEntityKind,
    request.expectedEntitySubtype,
    request.semanticPath
  )
}

function creationContentFingerprint(
  context: ProductionOperationContextV1,
  sourceProject: ProjectIR,
  resolved: ResolvedProcedureDispatchV1,
  binding: ProcedureFutureContractBindingV1,
  slot: ProcedureResultSlotV1
): string
{
  const sourceContext: ProductionOperationContextV1 = {
    ...context,
    candidate: sourceProject,
  }
  const proccode = resolved.selectedProcedure?.proccode
  return procedureCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex: resolved.targetIndex,
    operation: resolved.canonicalOperation as ProcedureCreationOperationV1,
    descriptor: binding,
    resultRole: procedureCreationRoleForSlot(slot),
    selectedSource: proccode === undefined ? {} : { proccode },
    resolveContractEntityRef: (request) =>
      resolveContractEntityReference(sourceContext, request),
  })
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
  if (scope.locationScope.scopeKind === 'procedureOwnedClosure')
    return scope.locationScope.procedure.bindingKey
  return null
}

// a signature change is the only Group E operation that rewrites a procedure
// property surface, so only it needs an allowed property path
function procedurePropertyAllowed(
  scope: ContractScopeV1,
  operation: ProcedureOperationV1
): boolean
{
  if (scope.scopeSubjectKind !== 'entity') return false
  if (operation.kind !== 'procedure.updateSignature') return true
  return scope.allowedPropertyPaths.some(
    (path) => path.surface === 'procedure' && path.property === 'signature'
  )
}

function selectProcedureScope(
  context: ProductionOperationContextV1,
  operation: ProcedureOperationV1,
  entityBindingKeys: readonly string[],
  targetScopeBindingKeys: readonly string[],
  procedureScopeBindingKeys: readonly string[],
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
  const procedureKeys = new Set(procedureScopeBindingKeys)
  const scriptKeys = new Set(scriptScopeBindingKeys)
  const matches = context.contract.allowedSemanticScopes.filter((scope) =>
  {
    if (
      scope.operationKind !== operation.kind ||
      scope.scopeSubjectKind !== 'entity' ||
      scope.entityKind !== 'procedure' ||
      scope.entitySubtype !== 'unspecialized' ||
      !procedurePropertyAllowed(scope, operation)
    )
      return false
    if (scope.locationScope.scopeKind === 'exactEntity')
      return exactKeys.has(scope.locationScope.entity.bindingKey)
    if (scope.locationScope.scopeKind === 'targetAndOwnedDescendants')
      return targetKeys.has(scope.locationScope.target.bindingKey)
    if (scope.locationScope.scopeKind === 'procedureOwnedClosure')
      return procedureKeys.has(scope.locationScope.procedure.bindingKey)
    if (scope.locationScope.scopeKind === 'scriptClosure')
      return scriptKeys.has(scope.locationScope.script.bindingKey)
    return false
  })
  if (matches.length !== 1)
    return fail(
      'edit.unauthorized_change',
      matches.length === 0
        ? `change contract has no exact Group E scope for ${operation.kind}`
        : `change contract has ambiguous Group E scopes for ${operation.kind}`
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
  resolved: ResolvedProcedureDispatchV1,
  record: ProcedureRecordV1 | null
): readonly string[]
{
  if (resolved.operation.kind !== 'procedure.remove' || record === null)
    return Object.freeze([])
  return Object.freeze([
    `/targets/${resolved.targetIndex}/blocks/${pointerPart(record.definitionBlockId)}`,
  ])
}

function procedureOperationResult(
  operation: SemanticEditOperationV1,
  selectedLineageIds: readonly string[],
  fixedSlots: readonly ProductionResultSlotV1[],
  effectEvidence: unknown,
  dynamicSlots: readonly ProcedureProductionDynamicResultSlotV1[]
): ProcedureProductionOperationResultV1
{
  return productionOperationResultV1(
    operation,
    selectedLineageIds,
    fixedSlots,
    effectEvidence,
    dynamicSlots
  )
}

// every state-dependent precondition the frozen contract freezes is enforced
// here, before any mutation, so a refusal leaves the candidate byte-identical
function assertProcedurePreconditions(
  context: ProductionOperationContextV1,
  resolved: ResolvedProcedureDispatchV1,
  record: ProcedureRecordV1 | null
): void
{
  const operation = resolved.operation
  const targetIndex = resolved.targetIndex
  if (operation.kind === 'procedure.add')
  {
    const decoded = resolved.decoded!
    const set = prospectiveProcedureCollisionSetV1(
      context.candidate,
      targetIndex,
      decoded.proccode
    )
    if (
      prospectiveProcedureCollisionSetSha256V1(set) !==
      operation.expectedProspectiveProcedureCollisionSetSha256
    )
      fail(
        'edit.fingerprint_mismatch',
        'prospective procedure collision set differs from the planned set'
      )
    if (
      set.records.length !== operation.requireExistingProspectiveCollisionCount
    )
      fail(
        'edit.cardinality_mismatch',
        `proccode ${decoded.proccode} already has ${set.records.length} prospective records`,
        { matchCount: set.records.length }
      )
    return
  }
  if (record === null)
    return fail(
      'edit.internal_invariant',
      'Group E operation lacks its exact procedure record'
    )
  const calls = procedureCallSitesV1(
    context.candidate,
    targetIndex,
    record.proccode
  )
  if (operation.kind === 'procedure.updateSignature')
  {
    const decoded = resolved.decoded!
    if (
      procedureSignatureStateSha256V1(record) !==
      operation.expectedSignatureSha256
    )
      fail(
        'edit.fingerprint_mismatch',
        'current procedure signature differs from the planned signature'
      )
    if (
      procedureCallSetSha256V1(targetIndex, record.proccode, calls) !==
      operation.expectedCallSetSha256
    )
      fail(
        'edit.fingerprint_mismatch',
        'current procedure call set differs from the planned call set'
      )
    if (calls.length !== resolved.callSiteBlockIds.length)
      fail(
        'edit.cardinality_mismatch',
        'signature update does not map every current call site',
        { matchCount: calls.length }
      )
    const external = prospectiveProcedureCollisionSetV1(
      context.candidate,
      targetIndex,
      decoded.proccode,
      updateSignatureExclusions(record, resolved.callSiteBlockIds)
    )
    if (
      prospectiveProcedureCollisionSetSha256V1(external) !==
      operation.expectedProspectiveProcedureCollisionSetSha256
    )
      fail(
        'edit.fingerprint_mismatch',
        'external prospective collision set differs from the planned set'
      )
    if (
      external.records.length !==
      operation.requireFinalExternalProspectiveCollisionCount
    )
      fail(
        'edit.cardinality_mismatch',
        `renamed proccode collides with ${external.records.length} foreign records`,
        { matchCount: external.records.length }
      )
    return
  }
  if (operation.kind === 'procedure.remove')
  {
    if (
      procedureCallSetSha256V1(targetIndex, record.proccode, calls) !==
      operation.expectedCallSetSha256
    )
      fail(
        'edit.fingerprint_mismatch',
        'current procedure call set differs from the planned call set'
      )
    if (calls.length !== operation.requireFinalCallCount)
      fail(
        'edit.cardinality_mismatch',
        `procedure ${record.proccode} still has ${calls.length} call sites`,
        { matchCount: calls.length }
      )
    const external = externalArgumentReporterIdsFor(context.candidate, record)
    if (
      externalArgumentReporterSetSha256V1(
        targetIndex,
        record.proccode,
        external
      ) !== operation.expectedExternalArgumentReporterSetSha256
    )
      fail(
        'edit.fingerprint_mismatch',
        'external argument reporter set differs from the planned set'
      )
    if (external.length !== operation.requireFinalExternalArgumentReporterCount)
      fail(
        'edit.cardinality_mismatch',
        `procedure ${record.proccode} has ${external.length} external argument reporters`,
        { matchCount: external.length }
      )
    // an unmapped comment attached to the removed closure would dangle, so a
    // rejectIfPresent disposition refuses rather than orphaning it
    const target = context.candidate.json.targets[targetIndex]
    if (!target)
      fail('edit.invalid_owner', 'procedure owner target is absent')
    const plan = planGraphClosureV1(target, 'script', record.definitionBlockId)
    if (
      operation.comments.kind === 'rejectIfPresent' &&
      plan.attachedCommentIds.length > 0
    )
      fail(
        'edit.cardinality_mismatch',
        'procedure removal disposition rejects the attached comments it found',
        { matchCount: plan.attachedCommentIds.length }
      )
    return
  }
  if (
    procedureSignatureStateSha256V1(record) !==
    operation.expectedSignatureSha256
  )
    fail(
      'edit.fingerprint_mismatch',
      'current procedure signature differs from the planned signature'
    )
  const parameter = resolved.selectedParameter
  const callBlockId = resolved.selectedCallBlockId
  if (parameter === null || callBlockId === null)
    return fail(
      'edit.internal_invariant',
      'call argument operation lacks its exact call or parameter selection'
    )
  const actual = blockInputFingerprintV1(
    targetIndex,
    callBlockId,
    parameter.argumentId,
    currentCallInput(
      context.candidate,
      targetIndex,
      callBlockId,
      parameter.argumentId
    )
  )
  if (actual !== operation.expectedInputFingerprint)
    fail(
      'edit.fingerprint_mismatch',
      'current call argument input differs from the planned input'
    )
}

function resolvedProcedureOperation(
  resolved: ResolvedProcedureDispatchV1,
  record: ProcedureRecordV1 | null
): ResolvedProcedureOperationV1
{
  const operation = resolved.canonicalOperation
  if (operation.kind === 'procedure.add')
    return { operation, targetIndex: resolved.targetIndex }
  if (record === null)
    return fail(
      'edit.internal_invariant',
      'Group E operation lacks its exact procedure record'
    )
  if (operation.kind === 'procedure.updateSignature')
    return {
      operation,
      targetIndex: resolved.targetIndex,
      record,
      callSiteBlockIds: resolved.callSiteBlockIds,
    }
  if (operation.kind === 'procedure.remove')
    return {
      operation,
      targetIndex: resolved.targetIndex,
      record,
      dispositionCommentIds: resolved.comments?.commentIds ?? Object.freeze([]),
    }
  if (resolved.selectedCallBlockId === null || !resolved.selectedParameter)
    return fail(
      'edit.internal_invariant',
      'call argument operation lacks its exact call or parameter selection'
    )
  return {
    operation,
    targetIndex: resolved.targetIndex,
    record,
    callBlockId: resolved.selectedCallBlockId,
    argumentId: resolved.selectedParameter.argumentId,
  }
}

// the frozen delta engine parses exactly one procedure pointer shape & tells a
// prototype from a call by block opcode, so both kinds share the shape & stay
// unique through the block id they carry
function procedureCollectionPathV1(
  targetIndex: number,
  blockId: string
): string
{
  return `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/mutation/argumentids`
}

// membership is read off the reconciled lineage, never recomputed, so it cannot
// disagree w/ the ordinals the operation actually wrote
function orderedParameterLineageIds(
  lineage: SemanticLineageSnapshot,
  procedureLineageId: string
): readonly string[]
{
  return Object.freeze(
    activeOrderedSemanticLineages(lineage, 'parameter', procedureLineageId).map(
      (record) => record.lineageId
    )
  )
}

// one member per lineage carrying both of its ordinals, so a reorder reads as a
// stable id w/ moved indices & an add/remove as a null on the absent side
function orderedCollectionMembers(
  beforeLineageIds: readonly string[],
  afterLineageIds: readonly string[]
): readonly OrderedCollectionMemberCorrespondence[]
{
  const beforeIndexes = new Map(
    beforeLineageIds.map((lineageId, index) => [lineageId, index] as const)
  )
  const afterIndexes = new Map(
    afterLineageIds.map((lineageId, index) => [lineageId, index] as const)
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

// validateProjectOrderedCorrespondence owns the procedure owner rules & is
// unreachable from a dispatcher, so restate them where the value is produced.
// unlike media, a procedure's owner, container & target owner are all distinct
function assertProcedureCorrespondenceOwnersV1(
  value: OrderedCollectionCorrespondence
): void
{
  const owners = [
    value.ownerLineageId,
    value.containerLineageId,
    value.targetOwnerLineageId,
  ]
  if (owners.some((lineageId) => lineageId === null))
    return fail(
      'edit.internal_invariant',
      'procedure correspondence requires owner, container & target owner lineage'
    )
  if (new Set(owners).size !== owners.length)
    return fail(
      'edit.internal_invariant',
      'procedure correspondence owner, container & target owner must differ'
    )
}

// refuse an invalid correspondence where it is built rather than letting it
// reach the delta engine, & keep the leaf error inside the edit taxonomy
function validatedProcedureCorrespondenceV1(
  value: OrderedCollectionCorrespondence
): OrderedCollectionCorrespondence
{
  assertProcedureCorrespondenceOwnersV1(value)
  try
  {
    validateOrderedCollectionCorrespondence(value, {
      collectionKind: value.collectionKind,
      collectionPath: value.collectionPath,
      ownerLineageId: value.ownerLineageId,
    })
  }
  catch (error)
  {
    return fail(
      'edit.internal_invariant',
      `procedure correspondence is invalid: ${error instanceof Error ? error.message : 'unknown'}`
    )
  }
  return Object.freeze(value)
}

// only the two operations that move an ordered collection emit correspondence.
// add & remove create or retire the procedure itself, so its container block
// lineage is absent from one head & no ordered movement exists to prove
function procedureOrderedCorrespondence(
  context: ProductionOperationContextV1,
  resolved: ResolvedProcedureDispatchV1,
  lineage: ReconciledProcedureLineageV1,
  applied: AppliedProcedureOperationV1
): OrderedCollectionCorrespondence | null
{
  const kind = resolved.operation.kind
  if (
    kind !== 'procedure.updateSignature' &&
    kind !== 'procedure.setCallArgument'
  )
    return null
  const procedureLineageId = lineage.procedureLineageId
  if (procedureLineageId === null)
    return fail(
      'edit.internal_invariant',
      'ordered correspondence has no owning procedure lineage'
    )
  const parameters = kind === 'procedure.updateSignature'
  const containerBlockId = parameters
    ? applied.prototypeBlockId
    : resolved.selectedCallBlockId
  if (containerBlockId === null)
    return fail(
      'edit.internal_invariant',
      'ordered correspondence has no container block'
    )
  // the container addresses both heads, so a prototype that moved block identity
  // would silently mis-address the before collection
  if (
    parameters &&
    resolved.selectedProcedure !== null &&
    resolved.selectedProcedure.prototypeBlockId !== containerBlockId
  )
    return fail(
      'edit.internal_invariant',
      'procedure prototype block identity moved under a signature update'
    )
  const collectionPath = procedureCollectionPathV1(
    resolved.targetIndex,
    containerBlockId
  )
  const beforeLineageIds = orderedParameterLineageIds(
    context.activeLineage,
    procedureLineageId
  )
  const afterLineageIds = orderedParameterLineageIds(
    lineage.activeLineage,
    procedureLineageId
  )
  return validatedProcedureCorrespondenceV1({
    collectionKind: parameters
      ? 'procedure-parameters'
      : 'procedure-call-arguments',
    collectionPath,
    beforeCollectionPath: collectionPath,
    afterCollectionPath: collectionPath,
    ownerLineageId: procedureLineageId,
    targetOwnerLineageId: resolved.targetLineageId,
    containerLineageId: activeRecord(
      lineage.activeLineage,
      'block',
      resolved.targetLineageId,
      `block:${containerBlockId}`
    ).lineageId,
    beforeLineageIds,
    afterLineageIds,
    members: orderedCollectionMembers(beforeLineageIds, afterLineageIds),
  })
}

function executeResolvedProcedureOperation(
  context: ProductionOperationContextV1,
  resolved: ResolvedProcedureDispatchV1,
  planningFactProjection: ProcedurePlanningFactProjectionV1
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
  const record =
    resolved.selectedProcedure === null
      ? null
      : procedureRecordAt(
          context.candidate,
          resolved.targetIndex,
          resolved.selectedProcedure.proccode
        )
  assertProcedurePreconditions(context, resolved, record)
  const beforeScriptRawIdentities = targetScriptRawIdentities(
    context.candidate,
    resolved.targetIndex
  )
  const beforeArgumentIds = record ? record.argumentIds : Object.freeze([])
  const creationSourceProject = cloneProject(context.candidate)
  const priorScriptBindingKeys = scriptBindingKeysByLineage(
    context,
    resolved.targetIndex
  )
  const targetEvidence = exactCurrentTarget(
    context.candidate,
    resolved.targetIndex
  )
  const targetKeys = targetBindingKeys(context, targetEvidence)
  const priorProcedureKeys =
    resolved.selectedProcedure === null ||
    resolved.selectedProcedureLineageId === null
      ? Object.freeze([])
      : procedureBindingKeys(
          context,
          resolved.selectedProcedure,
          resolved.selectedProcedureLineageId
        )
  const adapters = createCuratedCoreOperationAdaptersV1(
    curatedEntityResolver(context)
  )
  const applied = applyProcedureOperationV1(
    context.candidate,
    resolvedProcedureOperation(resolved, record),
    { lowerStatementSequence: adapters.block.lowerStatementSequence }
  )
  const lineage = reconcileProcedureLineage(
    context,
    resolved,
    beforeScriptRawIdentities,
    beforeArgumentIds,
    applied
  )
  const slots = collectProcedureResultSlots(context, resolved, lineage, applied)
  const noKeys = (): readonly string[] => Object.freeze([])

  const procedureSlots = slots.fixedSlots.filter(
    (slot) => slot.entityKind === 'procedure'
  )
  const procedureMatches = matchResultBindings(
    context,
    operation,
    procedureSlots,
    targetKeys,
    noKeys,
    noKeys,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        resolved,
        binding,
        slot
      ),
    lineage.collisionNonceByLineageId,
    lineage.creationKeyByLineageId
  )
  const createdProcedureKeys = procedureMatches.map(
    (match) => match.binding.bindingKey
  )
  const scriptSlots = slots.fixedSlots.filter(
    (slot) => slot.entityKind === 'script'
  )
  const scriptMatches = matchResultBindings(
    context,
    operation,
    scriptSlots,
    targetKeys,
    noKeys,
    noKeys,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        resolved,
        binding,
        slot
      ),
    lineage.collisionNonceByLineageId,
    lineage.creationKeyByLineageId
  )
  const createdScriptKeys = scriptMatches.map(
    (match) => match.binding.bindingKey
  )
  const procedureKeysForSlot = (): readonly string[] =>
    uniqueSorted([...priorProcedureKeys, ...createdProcedureKeys])
  const parameterSlots = slots.dynamicSlots.filter(
    (slot) => slot.entityKind === 'parameter'
  )
  const parameterMatches = matchResultBindings(
    context,
    operation,
    parameterSlots,
    targetKeys,
    procedureKeysForSlot,
    noKeys,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        resolved,
        binding,
        slot
      ),
    lineage.collisionNonceByLineageId,
    lineage.creationKeyByLineageId
  )
  const blockSlots: ProcedureResultSlotV1[] = [
    ...slots.fixedSlots.filter((slot) => slot.entityKind === 'block'),
    ...slots.dynamicSlots.filter((slot) => slot.entityKind === 'block'),
  ]
  const scriptKeysForSlot = (slot: ProcedureResultSlotV1): readonly string[] =>
  {
    if (slot.entityKind !== 'block') return Object.freeze([])
    const owner = lineage.activeLineage.records.find(
      (candidate) => candidate.lineageId === slot.lineageId
    )
    const blockId = /^block:(.*)$/su.exec(owner?.rawIdentity ?? '')?.[1]
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
    const scriptLineage = activeRecord(
      lineage.activeLineage,
      'script',
      resolved.targetLineageId,
      `script:${script.topBlockId}`
    )
    return uniqueSorted([
      ...(priorScriptBindingKeys.get(scriptLineage.lineageId) ?? []),
      ...(lineage.createdScriptLineageIds.includes(scriptLineage.lineageId)
        ? createdScriptKeys
        : []),
    ])
  }
  const blockMatches = matchResultBindings(
    context,
    operation,
    blockSlots,
    targetKeys,
    noKeys,
    scriptKeysForSlot,
    (binding, slot) =>
      creationContentFingerprint(
        context,
        creationSourceProject,
        resolved,
        binding,
        slot
      ),
    lineage.collisionNonceByLineageId,
    lineage.creationKeyByLineageId
  )
  const bindingMatches = [
    ...procedureMatches,
    ...scriptMatches,
    ...parameterMatches,
    ...blockMatches,
  ]
  const createdBindingKeys = bindingMatches.map(
    (match) => match.binding.bindingKey
  )
  const callBlockKeys = resolved.callSiteBlockIds.flatMap((blockId) =>
  {
    const evidence = blockEntityEvidenceSetV1(creationSourceProject).find(
      (candidate) =>
        candidate.targetIndex === resolved.targetIndex &&
        candidate.blockId === blockId
    )
    if (!evidence) return []
    return [
      ...allBlockBindingKeys(
        context,
        evidence,
        entityLineageIn(
          creationSourceProject,
          context.activeLineage,
          'block',
          resolved.targetIndex,
          `block:${blockId}`
        ).lineageId
      ),
    ]
  })
  const scopeEntityKeys = uniqueSorted([
    ...priorProcedureKeys,
    ...createdProcedureKeys,
  ])
  const selectedScope = selectProcedureScope(
    context,
    operation,
    scopeEntityKeys,
    targetKeys,
    uniqueSorted([...priorProcedureKeys, ...createdProcedureKeys]),
    uniqueSorted([
      ...[...priorScriptBindingKeys.values()].flatMap((keys) => [...keys]),
      ...createdScriptKeys,
    ])
  )
  const exactPaths = applied.exactPaths
  const affectedBlockIds = uniqueSorted([
    ...applied.createdBlockIds,
    ...applied.removedBlockIds,
    ...applied.callSiteBlockIds,
    ...(applied.prototypeBlockId === null ? [] : [applied.prototypeBlockId]),
  ])
  const selectedLineageIds = uniqueSorted([
    ...resolved.selectedLineageIds,
    ...lineage.selectedLineageIds,
    ...slots.fixedSlots.map((slot) => slot.lineageId),
    ...slots.dynamicSlots.map((slot) => slot.lineageId),
  ])
  const correspondence = procedureOrderedCorrespondence(
    context,
    resolved,
    lineage,
    applied
  )
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
    result: procedureOperationResult(
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
    ...(correspondence ? { correspondence } : {}),
    planningFactProjection,
    matchedContractBindingKeys: uniqueSorted([
      ...scopeEntityKeys,
      ...targetKeys,
      ...callBlockKeys,
      ...createdBindingKeys,
      ...(scopeBindingKey(selectedScope)
        ? [scopeBindingKey(selectedScope)!]
        : []),
    ]),
    selectedEntityLineageIds: selectedLineageIds,
    structuralAuthorization: structuralAuthorization(exactPaths),
    authorizationEvidence: {
      groupDGraph: {
        publicRemovalPaths: publicRemovalPaths(resolved, record),
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

class ProcedureLifecycleProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'procedure.add',
    'procedure.updateSignature',
    'procedure.remove',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `procedure lifecycle dispatcher does not support ${operation.kind}`
      )
    const resolved = resolveProcedureDispatch(
      context,
      operation as ProcedureLifecycleOperationV1
    )
    return executeResolvedProcedureOperation(
      context,
      resolved,
      procedurePlanningFactProjection(resolved)
    )
  }
}

class ProcedureCallProductionOperationDispatcherV1 implements ProductionOperationDispatcherV1
{
  readonly operationKinds = Object.freeze([
    'procedure.setCallArgument',
  ] as const)

  execute(
    context: ProductionOperationContextV1,
    operation: SemanticEditOperationV1
  ): ProductionOperationDispatchResultV1
  {
    if (!this.operationKinds.some((kind) => kind === operation.kind))
      return fail(
        'edit.unsupported_operation',
        `procedure call dispatcher does not support ${operation.kind}`
      )
    const resolved = resolveProcedureDispatch(
      context,
      operation as SemanticEditOperationProcedureSetCallArgumentV1
    )
    return executeResolvedProcedureOperation(
      context,
      resolved,
      procedurePlanningFactProjection(resolved)
    )
  }
}

export function procedureProductionOperationDispatchersV1(): readonly ProductionOperationDispatcherV1[]
{
  return Object.freeze([
    new ProcedureLifecycleProductionOperationDispatcherV1(),
    new ProcedureCallProductionOperationDispatcherV1(),
  ])
}
