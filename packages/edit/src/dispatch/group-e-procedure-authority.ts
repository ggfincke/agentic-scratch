// packages/edit/src/dispatch/group-e-procedure-authority.ts
// shared exact procedure & parameter selection authority for semantic edits

import type { ProjectIR } from '@scratch-agent/ir'
import {
  boundedDisplayStringV1,
  parameterEntityEvidenceSetV1,
  procedureEntityEvidenceSetV1,
  resolveProcedureRecordV1,
  semanticHashV1,
  type BoundedDisplayStringV1,
  type BoundedParameterLocationProjectionV1,
  type BoundedProcedureLocationProjectionV1,
  type ParameterEntityEvidenceV1,
  type ParameterRefV1,
  type ProcedureEntityEvidenceV1,
  type ProcedureRecordV1,
  type ProcedureRefV1,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'

import {
  targetLineageAt,
  type GroupCPlanningEntityProjectionV1,
} from './group-c-dispatchers.js'
import type { ProductionOperationContextV1 } from '../transaction/production-transaction.js'

interface GroupEProcedureSelectionV1
{
  readonly canonical: ProcedureEntityEvidenceV1
  readonly current: ProcedureEntityEvidenceV1
  readonly lineageId: string
}

function fail(code: string, message: string): never
{
  throw Object.assign(new Error(message), { code })
}

function displayString(value: string): BoundedDisplayStringV1
{
  return boundedDisplayStringV1(value) as unknown as BoundedDisplayStringV1
}

function groupEProcedureBoundedLocationV1(
  evidence: ProcedureEntityEvidenceV1
): BoundedProcedureLocationProjectionV1
{
  return {
    kind: 'procedure',
    targetLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.target
    ),
    canonicalSignature: displayString(evidence.location.canonicalSignature),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId: `procedure-location-${evidence.semanticLocationSha256.slice(0, 32)}`,
  }
}

function exactGroupEProcedureRefV1(
  evidence: ProcedureEntityEvidenceV1
): ProcedureRefV1
{
  return {
    entityKind: 'procedure',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: groupEProcedureBoundedLocationV1(evidence),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

export function canonicalGroupEProcedureRefV1(
  reference: ProcedureRefV1,
  evidence: ProcedureEntityEvidenceV1
): ProcedureRefV1
{
  return reference.refKind === 'created'
    ? reference
    : exactGroupEProcedureRefV1(evidence)
}

function groupEParameterBoundedLocationV1(
  evidence: ParameterEntityEvidenceV1
): BoundedParameterLocationProjectionV1
{
  return {
    kind: 'parameter',
    name: displayString(evidence.location.name),
    ordinal: evidence.ordinal,
    parameterType: evidence.parameterType,
    procedureLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.procedure
    ),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId: `parameter-location-${evidence.semanticLocationSha256.slice(0, 32)}`,
  }
}

export function exactGroupEParameterRefV1(
  evidence: ParameterEntityEvidenceV1
): ParameterRefV1
{
  return {
    entityKind: 'parameter',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: groupEParameterBoundedLocationV1(evidence),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

export function canonicalGroupEParameterRefV1(
  reference: ParameterRefV1,
  evidence: ParameterEntityEvidenceV1
): ParameterRefV1
{
  return reference.refKind === 'created'
    ? reference
    : exactGroupEParameterRefV1(evidence)
}

export function planningGroupEProcedureV1(
  evidence: ProcedureEntityEvidenceV1
): GroupCPlanningEntityProjectionV1
{
  return {
    entityKind: 'procedure',
    entitySubtype: 'unspecialized',
    boundedLocation: groupEProcedureBoundedLocationV1(evidence),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

export function planningGroupEParameterV1(
  evidence: ParameterEntityEvidenceV1
): GroupCPlanningEntityProjectionV1
{
  return {
    entityKind: 'parameter',
    entitySubtype: 'unspecialized',
    boundedLocation: groupEParameterBoundedLocationV1(evidence),
    semanticLocationSha256: evidence.semanticLocationSha256,
    semanticFingerprintSha256: evidence.semanticFingerprintSha256,
    contextFingerprintSha256: evidence.contextFingerprintSha256,
  }
}

export function groupEProcedureLineageInV1(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  targetIndex: number,
  proccode: string
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
      record.kind === 'procedure' &&
      record.ownerLineageId === owner.lineageId &&
      record.rawIdentity === `procedure:${proccode}`
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      `procedure ${proccode} does not have one active lineage`
    )
  return matches[0]!
}

export function groupEParameterLineageInV1(
  lineage: SemanticLineageSnapshot,
  procedureLineageId: string,
  argumentId: string
): SemanticLineageRecord
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === 'parameter' &&
      record.ownerLineageId === procedureLineageId &&
      record.rawIdentity === `parameter:${argumentId}`
  )
  if (matches.length !== 1)
    return fail(
      'edit.internal_invariant',
      `parameter ${argumentId} does not have one active lineage`
    )
  return matches[0]!
}

// the frozen signature precondition is the exact serialized prototype identity:
// proccode, warp, & the ordered argument id/name/default triple
export function groupEProcedureSignatureStateSha256V1(
  record: ProcedureRecordV1
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'procedure-signature-state',
    schemaVersion: 1,
    targetIndex: record.targetIndex,
    proccode: record.proccode,
    warp: record.warp,
    argumentIds: record.argumentIds,
    argumentNames: record.argumentNames,
    argumentDefaults: record.argumentDefaults,
  })
}

export function groupEProcedureRecordAtV1(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): ProcedureRecordV1
{
  return resolveProcedureRecordV1(project, targetIndex, proccode)
}

// a created ref names a slot on a prior typed result in this same batch; those
// rows are the only authority for what that slot produced
function priorResultSlotLineageId(
  context: ProductionOperationContextV1,
  opId: string,
  slotMatches: (slot: Readonly<Record<string, unknown>>) => boolean,
  purpose: string
): string
{
  const value = context.operationResultsById.get(opId)
  if (value === null || typeof value !== 'object')
    return fail(
      'edit.created_result_invalid',
      `${purpose} names an absent prior operation result`
    )
  const result = value as {
    readonly fixedSlots?: readonly Readonly<Record<string, unknown>>[]
    readonly dynamicSlots?: readonly Readonly<Record<string, unknown>>[]
  }
  const slots = [...(result.fixedSlots ?? []), ...(result.dynamicSlots ?? [])]
  const matches = slots.filter(slotMatches)
  if (matches.length !== 1)
    return fail(
      'edit.created_result_invalid',
      `${purpose} does not name one exact prior result slot`
    )
  const lineageId = matches[0]?.['lineageId']
  if (typeof lineageId !== 'string')
    return fail(
      'edit.created_result_invalid',
      `${purpose} result slot lacks an exact lineage identity`
    )
  return lineageId
}

function procedureEvidenceByLineage(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  lineageId: string
): ProcedureEntityEvidenceV1
{
  const matches = procedureEntityEvidenceSetV1(project).filter(
    (candidate) =>
      groupEProcedureLineageInV1(
        project,
        lineage,
        candidate.targetIndex,
        candidate.proccode
      ).lineageId === lineageId
  )
  if (matches.length !== 1)
    return fail(
      'edit.created_result_invalid',
      'created procedure result is absent or ambiguous'
    )
  return matches[0]!
}

// exact-location & same-batch created selectors share one Group E authority
export function resolveGroupEProcedureSelectionV1(
  context: ProductionOperationContextV1,
  reference: ProcedureRefV1
): GroupEProcedureSelectionV1
{
  if (reference.refKind === 'created')
  {
    const lineageId = priorResultSlotLineageId(
      context,
      reference.opId,
      (slot) =>
        slot['slotKind'] === 'fixed' &&
        slot['name'] === reference.slot.name &&
        slot['entityKind'] === 'procedure',
      'procedure created ref'
    )
    const current = procedureEvidenceByLineage(
      context.candidate,
      context.activeLineage,
      lineageId
    )
    return { canonical: current, current, lineageId }
  }
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
  const canonical = procedureEntityEvidenceSetV1(context.preBatch).find(
    (candidate) =>
      candidate.semanticLocationSha256 === reference.location.fullLocationSha256
  )
  if (!canonical)
    return fail('edit.selector_no_match', 'procedure location is absent')
  if (
    canonical.semanticLocationSha256 !== reference.expectedFullLocationSha256 ||
    canonical.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint ||
    canonical.contextFingerprintSha256 !== reference.expectedContextFingerprint
  )
    return fail('edit.fingerprint_mismatch', 'procedure location changed')
  const lineageId = groupEProcedureLineageInV1(
    context.preBatch,
    context.preBatchLineage,
    canonical.targetIndex,
    canonical.proccode
  ).lineageId
  const matches = procedureEntityEvidenceSetV1(context.candidate).filter(
    (candidate) =>
      groupEProcedureLineageInV1(
        context.candidate,
        context.activeLineage,
        candidate.targetIndex,
        candidate.proccode
      ).lineageId === lineageId
  )
  if (matches.length !== 1)
    return fail(
      'edit.invalid_owner',
      'selected procedure was removed or became ambiguous before use'
    )
  return { canonical, current: matches[0]!, lineageId }
}

export function resolveGroupEParameterSelectionV1(
  context: ProductionOperationContextV1,
  reference: ParameterRefV1,
  procedure: ProcedureEntityEvidenceV1
): ParameterEntityEvidenceV1
{
  const owned = parameterEntityEvidenceSetV1(context.candidate).filter(
    (candidate) =>
      candidate.targetIndex === procedure.targetIndex &&
      candidate.proccode === procedure.proccode
  )
  if (reference.refKind === 'created')
  {
    const lineageId = priorResultSlotLineageId(
      context,
      reference.opId,
      (slot) =>
        slot['slotKind'] === 'parameter' &&
        slot['alias'] === reference.slot.localKey &&
        slot['entityKind'] === 'parameter',
      'parameter created ref'
    )
    const procedureLineageId = groupEProcedureLineageInV1(
      context.candidate,
      context.activeLineage,
      procedure.targetIndex,
      procedure.proccode
    ).lineageId
    const matches = owned.filter(
      (candidate) =>
        groupEParameterLineageInV1(
          context.activeLineage,
          procedureLineageId,
          candidate.argumentId
        ).lineageId === lineageId
    )
    if (matches.length !== 1)
      return fail(
        'edit.created_result_invalid',
        'created parameter result is absent or ambiguous'
      )
    return matches[0]!
  }
  if (reference.refKind !== 'structural')
    return fail(
      'edit.unsupported_operation',
      'parameter handle references require a parameter handle authority'
    )
  if (reference.selectorKind !== 'exactLocation')
    return fail(
      'edit.unsupported_operation',
      'parameter match-set selectors require a parameter match authority'
    )
  const selected = owned.find(
    (candidate) =>
      candidate.semanticLocationSha256 === reference.location.fullLocationSha256
  )
  if (!selected)
    return fail('edit.selector_no_match', 'parameter location is absent')
  if (
    selected.ordinal !== reference.location.ordinal ||
    selected.parameterType !== reference.location.parameterType ||
    selected.semanticLocationSha256 !== reference.expectedFullLocationSha256 ||
    selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint ||
    selected.contextFingerprintSha256 !== reference.expectedContextFingerprint
  )
    return fail('edit.fingerprint_mismatch', 'parameter location changed')
  return selected
}
