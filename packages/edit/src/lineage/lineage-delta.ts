// packages/edit/src/lineage/lineage-delta.ts
// compute complete project deltas through independent lineage correspondence

import {
  captureProjectOrderedHeadEvidence,
  computeProjectDelta,
  type DeltaOperationAttribution,
  type ProjectDelta,
  type ProjectIR,
} from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  buildSemanticReferenceIndex,
  validateSemanticLineageSnapshot,
  type IndexedProcedure,
  type OrderedCollectionCorrespondence,
  type ProjectOrderedCorrespondence,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'

import { editCanonicalSha256V1 } from '../support/canonical.js'
import { editJsonPointerPartV1 as pointerPart } from '../support/internal-values.js'

interface LineageProjectDeltaInputV1
{
  readonly before: ProjectIR
  readonly after: ProjectIR
  readonly beforeLineage: SemanticLineageSnapshot
  readonly afterLineage: SemanticLineageSnapshot
  readonly beforeRevisionIdentity: string
  readonly afterRevisionIdentity: string
  readonly semanticSourceSha256: string
  readonly attribution?: readonly DeltaOperationAttribution[]
}

class LineageProjectDeltaErrorV1 extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'LineageProjectDeltaErrorV1'
  }
}

function fail(message: string): never
{
  throw new LineageProjectDeltaErrorV1(message)
}

function activeRecords(
  snapshot: SemanticLineageSnapshot,
  kind: SemanticLineageRecord['kind']
): readonly SemanticLineageRecord[]
{
  return snapshot.records.filter(
    (record) => record.status === 'active' && record.kind === kind
  )
}

function activeRecordById(
  snapshot: SemanticLineageSnapshot,
  lineageId: string
): SemanticLineageRecord | undefined
{
  return snapshot.records.find(
    (record) => record.lineageId === lineageId && record.status === 'active'
  )
}

function orderedCorrespondence(
  collectionKind: OrderedCollectionCorrespondence['collectionKind'],
  collectionPath: string,
  beforeCollectionPath: string | null,
  afterCollectionPath: string | null,
  ownerLineageId: string | null,
  targetOwnerLineageId: string | null,
  containerLineageId: string | null,
  beforeLineageIds: readonly string[],
  afterLineageIds: readonly string[]
): OrderedCollectionCorrespondence
{
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
  return {
    collectionKind,
    collectionPath,
    beforeCollectionPath,
    afterCollectionPath,
    ownerLineageId,
    targetOwnerLineageId,
    containerLineageId,
    beforeLineageIds: Object.freeze([...beforeLineageIds]),
    afterLineageIds: Object.freeze([...afterLineageIds]),
    members: Object.freeze(
      allIds.map((lineageId) => ({
        lineageId,
        beforeIndex: beforeIndexes.get(lineageId) ?? null,
        afterIndex: afterIndexes.get(lineageId) ?? null,
      }))
    ),
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
  return orderedCorrespondence(
    'targets',
    '/targets',
    '/targets',
    '/targets',
    null,
    null,
    null,
    beforeIds,
    afterIds
  )
}

function ownedOrderedLineageIds(
  snapshot: SemanticLineageSnapshot,
  kind: 'costume' | 'sound' | 'parameter',
  ownerLineageId: string
): readonly string[]
{
  return activeOrderedSemanticLineages(snapshot, kind, ownerLineageId).map(
    (record) => record.lineageId
  )
}

function mediaCorrespondences(
  input: LineageProjectDeltaInputV1,
  targets: OrderedCollectionCorrespondence
): readonly OrderedCollectionCorrespondence[]
{
  const output: OrderedCollectionCorrespondence[] = []
  for (const member of targets.members)
  {
    const beforeTarget =
      member.beforeIndex === null
        ? undefined
        : input.before.json.targets[member.beforeIndex]
    const afterTarget =
      member.afterIndex === null
        ? undefined
        : input.after.json.targets[member.afterIndex]
    for (const [field, kind] of [
      ['costumes', 'costume'],
      ['sounds', 'sound'],
    ] as const)
    {
      if (
        editCanonicalSha256V1(beforeTarget?.[field] ?? []) ===
        editCanonicalSha256V1(afterTarget?.[field] ?? [])
      )
        continue
      const beforeLineageIds = ownedOrderedLineageIds(
        input.beforeLineage,
        kind,
        member.lineageId
      )
      const afterLineageIds = ownedOrderedLineageIds(
        input.afterLineage,
        kind,
        member.lineageId
      )
      const beforePath =
        member.beforeIndex === null
          ? null
          : `/targets/${member.beforeIndex}/${field}`
      const afterPath =
        member.afterIndex === null
          ? null
          : `/targets/${member.afterIndex}/${field}`
      output.push(
        orderedCorrespondence(
          field,
          afterPath ?? beforePath!,
          beforePath,
          afterPath,
          member.lineageId,
          member.lineageId,
          member.lineageId,
          beforeLineageIds,
          afterLineageIds
        )
      )
    }
  }
  return Object.freeze(output)
}

interface ProcedureHead
{
  readonly procedure: IndexedProcedure
  readonly procedureLineage: SemanticLineageRecord
  readonly targetLineage: SemanticLineageRecord
  readonly prototypeLineage: SemanticLineageRecord
  readonly targetIndex: number
  readonly prototypeBlockId: string
  readonly callLineages: ReadonlyMap<string, string>
}

function rawIdentitySuffix(
  record: SemanticLineageRecord,
  prefix: string
): string
{
  if (!record.rawIdentity.startsWith(prefix))
    return fail(`${record.kind} lineage has invalid raw identity`)
  return record.rawIdentity.slice(prefix.length)
}

function targetIndexForLineage(
  snapshot: SemanticLineageSnapshot,
  lineageId: string
): number
{
  const targets = activeOrderedSemanticLineages(snapshot, 'target', null)
  const index = targets.findIndex((record) => record.lineageId === lineageId)
  return index < 0 ? fail('procedure target lineage is inactive') : index
}

function blockLineage(
  snapshot: SemanticLineageSnapshot,
  targetLineageId: string,
  blockId: string
): SemanticLineageRecord
{
  const matches = activeRecords(snapshot, 'block').filter(
    (record) =>
      record.ownerLineageId === targetLineageId &&
      record.rawIdentity === `block:${blockId}`
  )
  return matches.length === 1
    ? matches[0]!
    : fail(`block ${blockId} lacks one active lineage`)
}

function procedureHead(
  procedures: readonly IndexedProcedure[],
  snapshot: SemanticLineageSnapshot,
  procedureLineageId: string
): ProcedureHead | null
{
  const procedureLineage = activeRecordById(snapshot, procedureLineageId)
  if (!procedureLineage) return null
  if (
    procedureLineage.kind !== 'procedure' ||
    procedureLineage.ownerLineageId === null
  )
    return fail('procedure lineage has an invalid owner')
  const targetLineage = activeRecordById(
    snapshot,
    procedureLineage.ownerLineageId
  )
  if (!targetLineage || targetLineage.kind !== 'target')
    return fail('procedure target lineage is absent')
  const targetIndex = targetIndexForLineage(snapshot, targetLineage.lineageId)
  const proccode = rawIdentitySuffix(procedureLineage, 'procedure:')
  const matches = procedures.filter(
    (entry) =>
      entry.target.targetIndex === targetIndex && entry.proccode === proccode
  )
  if (matches.length !== 1)
    return fail('procedure lineage does not resolve exactly once')
  const procedure = matches[0]!
  if (procedure.prototypes.length !== 1)
    return fail('procedure correspondence requires one prototype')
  const prototypeBlockId = procedure.prototypes[0]!.blockId
  const prototypeLineage = blockLineage(
    snapshot,
    targetLineage.lineageId,
    prototypeBlockId
  )
  const callLineages = new Map<string, string>()
  for (const call of procedure.calls)
  {
    const lineage = blockLineage(
      snapshot,
      targetLineage.lineageId,
      call.blockId
    )
    if (callLineages.has(lineage.lineageId))
      return fail('procedure call lineage is duplicated')
    callLineages.set(lineage.lineageId, call.blockId)
  }
  return {
    procedure,
    procedureLineage,
    targetLineage,
    prototypeLineage,
    targetIndex,
    prototypeBlockId,
    callLineages,
  }
}

function ownValue(value: object | undefined, key: string): unknown
{
  if (!value) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor?.enumerable === true && 'value' in descriptor
    ? descriptor.value
    : undefined
}

function blockSurface(
  project: ProjectIR,
  targetIndex: number,
  blockId: string,
  kind: 'prototype' | 'call'
): unknown
{
  const blocks = project.json.targets[targetIndex]?.blocks
  const block = ownValue(blocks, blockId)
  if (block === null || typeof block !== 'object' || Array.isArray(block))
    return fail(`procedure ${kind} block is absent`)
  const record = block as Record<string, unknown>
  return kind === 'prototype'
    ? { opcode: record.opcode, mutation: record.mutation }
    : {
        opcode: record.opcode,
        mutation: record.mutation,
        inputs: record.inputs,
      }
}

function procedurePath(
  head: ProcedureHead | null,
  blockId: string | null
): string | null
{
  return !head || blockId === null
    ? null
    : `/targets/${head.targetIndex}/blocks/${pointerPart(blockId)}/mutation/argumentids`
}

function procedureCorrespondences(input: LineageProjectDeltaInputV1): {
  readonly parameters: readonly OrderedCollectionCorrespondence[]
  readonly calls: readonly OrderedCollectionCorrespondence[]
}
{
  const beforeProcedures = buildSemanticReferenceIndex(input.before).procedures
  const afterProcedures = buildSemanticReferenceIndex(input.after).procedures
  const procedureIds = new Set([
    ...activeRecords(input.beforeLineage, 'procedure').map(
      (record) => record.lineageId
    ),
    ...activeRecords(input.afterLineage, 'procedure').map(
      (record) => record.lineageId
    ),
  ])
  const parameters: OrderedCollectionCorrespondence[] = []
  const calls: OrderedCollectionCorrespondence[] = []
  for (const procedureId of [...procedureIds].sort())
  {
    const before = procedureHead(
      beforeProcedures,
      input.beforeLineage,
      procedureId
    )
    const after = procedureHead(
      afterProcedures,
      input.afterLineage,
      procedureId
    )
    const owner = after?.procedureLineage ?? before?.procedureLineage
    const targetOwner = after?.targetLineage ?? before?.targetLineage
    const container = after?.prototypeLineage ?? before?.prototypeLineage
    if (!owner || !targetOwner || !container)
      return fail('procedure correspondence lacks lineage authority')
    if (
      before &&
      after &&
      (before.targetLineage.lineageId !== after.targetLineage.lineageId ||
        before.prototypeLineage.lineageId !== after.prototypeLineage.lineageId)
    )
      return fail('procedure owner or prototype lineage changed')
    const beforeParameters = before
      ? ownedOrderedLineageIds(input.beforeLineage, 'parameter', procedureId)
      : []
    const afterParameters = after
      ? ownedOrderedLineageIds(input.afterLineage, 'parameter', procedureId)
      : []
    const beforePrototypeSurface = before
      ? blockSurface(
          input.before,
          before.targetIndex,
          before.prototypeBlockId,
          'prototype'
        )
      : null
    const afterPrototypeSurface = after
      ? blockSurface(
          input.after,
          after.targetIndex,
          after.prototypeBlockId,
          'prototype'
        )
      : null
    const parametersChanged =
      editCanonicalSha256V1(beforePrototypeSurface) !==
      editCanonicalSha256V1(afterPrototypeSurface)
    if (parametersChanged)
    {
      const beforePath = procedurePath(before, before?.prototypeBlockId ?? null)
      const afterPath = procedurePath(after, after?.prototypeBlockId ?? null)
      parameters.push(
        orderedCorrespondence(
          'procedure-parameters',
          afterPath ?? beforePath!,
          beforePath,
          afterPath,
          owner.lineageId,
          targetOwner.lineageId,
          container.lineageId,
          beforeParameters,
          afterParameters
        )
      )
    }
    const callIds = new Set([
      ...(before?.callLineages.keys() ?? []),
      ...(after?.callLineages.keys() ?? []),
    ])
    for (const callLineageId of [...callIds].sort())
    {
      const beforeBlockId = before?.callLineages.get(callLineageId) ?? null
      const afterBlockId = after?.callLineages.get(callLineageId) ?? null
      const beforeSurface =
        before && beforeBlockId
          ? blockSurface(
              input.before,
              before.targetIndex,
              beforeBlockId,
              'call'
            )
          : null
      const afterSurface =
        after && afterBlockId
          ? blockSurface(input.after, after.targetIndex, afterBlockId, 'call')
          : null
      if (
        !parametersChanged &&
        editCanonicalSha256V1(beforeSurface) ===
          editCanonicalSha256V1(afterSurface)
      )
        continue
      const beforePath = procedurePath(before, beforeBlockId)
      const afterPath = procedurePath(after, afterBlockId)
      calls.push(
        orderedCorrespondence(
          'procedure-call-arguments',
          afterPath ?? beforePath!,
          beforePath,
          afterPath,
          owner.lineageId,
          targetOwner.lineageId,
          callLineageId,
          beforeParameters,
          afterParameters
        )
      )
    }
  }
  return {
    parameters: Object.freeze(parameters),
    calls: Object.freeze(calls),
  }
}

export function computeLineageProjectDeltaV1(
  rawInput: LineageProjectDeltaInputV1
): ProjectDelta
{
  const input = {
    ...rawInput,
    beforeLineage: validateSemanticLineageSnapshot(rawInput.beforeLineage),
    afterLineage: validateSemanticLineageSnapshot(rawInput.afterLineage),
  }
  const targets = targetCorrespondence(input.beforeLineage, input.afterLineage)
  const media = mediaCorrespondences(input, targets)
  const procedures = procedureCorrespondences(input)
  const correspondence: ProjectOrderedCorrespondence = {
    beforeRevisionIdentity: input.beforeRevisionIdentity,
    afterRevisionIdentity: input.afterRevisionIdentity,
    beforeSemanticSourceSha256: input.semanticSourceSha256,
    afterSemanticSourceSha256: input.semanticSourceSha256,
    targets,
    ...(media.length > 0 ? { media } : {}),
    ...(procedures.parameters.length > 0
      ? { procedureParameters: procedures.parameters }
      : {}),
    ...(procedures.calls.length > 0
      ? { procedureCallArguments: procedures.calls }
      : {}),
  }
  return computeProjectDelta(
    input.before,
    input.after,
    input.attribution ?? [],
    {
      correspondence,
      correspondenceEvidence: {
        before: captureProjectOrderedHeadEvidence(
          input.before,
          correspondence,
          'before',
          {
            revisionIdentity: input.beforeRevisionIdentity,
            semanticSourceSha256: input.semanticSourceSha256,
            lineageSnapshot: input.beforeLineage,
          }
        ),
        after: captureProjectOrderedHeadEvidence(
          input.after,
          correspondence,
          'after',
          {
            revisionIdentity: input.afterRevisionIdentity,
            semanticSourceSha256: input.semanticSourceSha256,
            lineageSnapshot: input.afterLineage,
          }
        ),
      },
    }
  )
}
