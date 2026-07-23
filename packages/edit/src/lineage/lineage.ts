// packages/edit/src/lineage/lineage.ts
// deterministic source, created, & restored semantic lineage snapshots

import type { ProjectIR } from '@scratch-agent/ir'
import {
  buildSemanticReferenceIndex,
  semanticHashV1,
  SEMANTIC_LINEAGE_VERSION_V1,
  validateSemanticLineageSnapshot,
  type SemanticLineageKind,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'
import { isBlockEntry } from '@scratch-agent/sb3'

import { editCanonicalSha256V1 } from '../support/canonical.js'

class RestoreLineageHistoryErrorV1 extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'RestoreLineageHistoryErrorV1'
  }
}

export interface CreatedSemanticLineageV1
{
  readonly activeLineage: SemanticLineageSnapshot
  readonly record: SemanticLineageRecord
  readonly collisionNonce: number
  readonly creationKey: string
}

interface CreateSemanticLineageInputV1
{
  readonly lineageHistory: SemanticLineageSnapshot
  readonly activeLineage: SemanticLineageSnapshot
  readonly predecessorAcceptedHistorySha256: string
  readonly operationId: string
  readonly entityKind: SemanticLineageKind
  readonly ownerLineageId: string | null
  readonly rawIdentity: string
  readonly canonicalOrdinal: number | null
  readonly creationKey: string
}

// one authority owns created-lineage hashes & collision probing for every group
export function createSemanticLineageV1(
  input: CreateSemanticLineageInputV1
): CreatedSemanticLineageV1
{
  const history = validateSemanticLineageSnapshot(input.lineageHistory)
  const used = new Set([
    ...history.records.map((record) => record.lineageId),
    ...input.activeLineage.records.map((record) => record.lineageId),
  ])
  let collisionNonce = 0
  let lineageId = ''
  do
  {
    lineageId = semanticHashV1('lineage', {
      kind: 'created-semantic-lineage',
      schemaVersion: 1,
      predecessorAcceptedHistorySha256: input.predecessorAcceptedHistorySha256,
      operationId: input.operationId,
      entityKind: input.entityKind,
      creationKey: input.creationKey,
      collisionNonce,
    })
    collisionNonce += 1
  } while (used.has(lineageId))
  const record: SemanticLineageRecord = {
    lineageId,
    kind: input.entityKind,
    ownerLineageId: input.ownerLineageId,
    status: 'active',
    rawIdentity: input.rawIdentity,
    canonicalOrdinal: input.canonicalOrdinal,
  }
  return {
    activeLineage: validateSemanticLineageSnapshot({
      version: SEMANTIC_LINEAGE_VERSION_V1,
      records: [...input.activeLineage.records, record],
    }),
    record,
    collisionNonce: collisionNonce - 1,
    creationKey: input.creationKey,
  }
}

interface LineageBuilder
{
  records: SemanticLineageRecord[]
  add(
    kind: SemanticLineageKind,
    ownerLineageId: string | null,
    rawIdentity: string,
    canonicalOrdinal: number | null,
    location: unknown
  ): string
}

function createBuilder(semanticSourceSha256: string): LineageBuilder
{
  const records: SemanticLineageRecord[] = []
  return {
    records,
    add(kind, ownerLineageId, rawIdentity, canonicalOrdinal, location)
    {
      const lineageId = editCanonicalSha256V1({
        domain: 'scratch-agent-source-lineage-v1',
        semanticSourceSha256,
        kind,
        ownerLineageId,
        rawIdentity,
        canonicalOrdinal,
        semanticLocationSha256: editCanonicalSha256V1(location),
      })
      records.push({
        lineageId,
        kind,
        ownerLineageId,
        status: 'active',
        rawIdentity,
        canonicalOrdinal,
      })
      return lineageId
    },
  }
}

function declarationRecords(
  builder: LineageBuilder,
  targetLineageId: string,
  targetIndex: number,
  kind: 'variable' | 'list' | 'broadcast',
  values: Record<string, unknown> | undefined
): void
{
  for (const [ordinal, id] of Object.keys(values ?? {})
    .sort()
    .entries())
    {
    builder.add('declaration', targetLineageId, `${kind}:${id}`, ordinal, {
      kind: 'declaration',
      targetIndex,
      declarationKind: kind,
      id,
    })
  }
}

export function buildSourceLineageV1(
  project: ProjectIR,
  semanticSourceSha256: string
): {
  active: SemanticLineageSnapshot
  history: SemanticLineageSnapshot
}
{
  const builder = createBuilder(semanticSourceSha256)
  const targetLineages = new Map<number, string>()
  for (const [targetIndex, target] of project.json.targets.entries())
  {
    const targetLineageId = builder.add(
      'target',
      null,
      `target:${targetIndex}`,
      targetIndex,
      {
        kind: 'target',
        targetKind: target.isStage ? 'stage' : 'sprite',
        name: target.name,
        serializedTargetOrdinal: targetIndex,
      }
    )
    targetLineages.set(targetIndex, targetLineageId)
    declarationRecords(
      builder,
      targetLineageId,
      targetIndex,
      'variable',
      target.variables as Record<string, unknown>
    )
    declarationRecords(
      builder,
      targetLineageId,
      targetIndex,
      'list',
      target.lists as Record<string, unknown> | undefined
    )
    declarationRecords(
      builder,
      targetLineageId,
      targetIndex,
      'broadcast',
      target.broadcasts as Record<string, unknown> | undefined
    )
    const blockEntries = Object.entries(target.blocks)
    const scriptRoots = blockEntries.filter(([, entry]) =>
      Array.isArray(entry)
        ? entry.length >= 5
        : isBlockEntry(entry) && entry.topLevel === true
    )
    for (const [scriptOrdinal, [blockId]] of scriptRoots.entries())
    {
      builder.add(
        'script',
        targetLineageId,
        `script:${blockId}`,
        scriptOrdinal,
        { kind: 'script', targetIndex, topBlockId: blockId }
      )
    }
    for (const [blockId] of blockEntries)
    {
      builder.add('block', targetLineageId, `block:${blockId}`, null, {
        kind: 'block',
        targetIndex,
        blockId,
      })
    }
    for (const [commentOrdinal, commentId] of Object.keys(target.comments ?? {})
      .sort()
      .entries())
      {
      builder.add(
        'comment',
        targetLineageId,
        `comment:${commentId}`,
        commentOrdinal,
        { kind: 'comment', targetIndex, commentId }
      )
    }
    for (const [costumeOrdinal, costume] of target.costumes.entries())
    {
      builder.add(
        'costume',
        targetLineageId,
        `costume:${costume.assetId}:${costume.dataFormat}:${costumeOrdinal}`,
        costumeOrdinal,
        { kind: 'media', mediaKind: 'costume', targetIndex, costumeOrdinal }
      )
    }
    for (const [soundOrdinal, sound] of target.sounds.entries())
    {
      builder.add(
        'sound',
        targetLineageId,
        `sound:${sound.assetId}:${sound.dataFormat}:${soundOrdinal}`,
        soundOrdinal,
        { kind: 'media', mediaKind: 'sound', targetIndex, soundOrdinal }
      )
    }
  }
  const index = buildSemanticReferenceIndex(project)
  for (const procedure of index.procedures)
  {
    const owner = targetLineages.get(procedure.target.targetIndex) ?? null
    const procedureLineageId = builder.add(
      'procedure',
      owner,
      `procedure:${procedure.proccode}`,
      null,
      {
        kind: 'procedure',
        targetIndex: procedure.target.targetIndex,
        proccode: procedure.proccode,
      }
    )
    for (const [parameterOrdinal, parameter] of (
      procedure.parameters ?? []
    ).entries())
    {
      builder.add(
        'parameter',
        procedureLineageId,
        `parameter:${parameter.argumentId}`,
        parameterOrdinal,
        {
          kind: 'parameter',
          targetIndex: procedure.target.targetIndex,
          proccode: procedure.proccode,
          argumentId: parameter.argumentId,
        }
      )
    }
  }
  for (const [monitorOrdinal, monitor] of (
    project.json.monitors ?? []
  ).entries())
  {
    builder.add(
      'monitor',
      null,
      `monitor:${monitor.id}:${monitorOrdinal}`,
      monitorOrdinal,
      { kind: 'monitor', monitorId: monitor.id, monitorOrdinal }
    )
  }
  for (const [assetOrdinal, asset] of [...project.assets]
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    )
    .entries())
    {
    builder.add('asset', null, `asset:${asset.path}`, assetOrdinal, {
      kind: 'asset',
      path: asset.path,
    })
  }
  const active = validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: builder.records,
  })
  return { active, history: structuredClone(active) }
}

export function reconcileRestoreLineageHistoryV1(
  rawHistory: SemanticLineageSnapshot,
  rawSelected: SemanticLineageSnapshot
): SemanticLineageSnapshot
{
  const history = validateSemanticLineageSnapshot(rawHistory)
  const selected = validateSemanticLineageSnapshot(rawSelected)
  const historyById = new Map(
    history.records.map((record) => [record.lineageId, record])
  )
  for (const record of selected.records)
  {
    const historical = historyById.get(record.lineageId)
    if (!historical)
      throw new RestoreLineageHistoryErrorV1(
        `selected lineage is absent from monotonic history: ${record.lineageId}`
      )
    if (
      historical.kind !== record.kind ||
      historical.ownerLineageId !== record.ownerLineageId ||
      historical.rawIdentity !== record.rawIdentity
    )
      throw new RestoreLineageHistoryErrorV1(
        `selected lineage identity differs from monotonic history: ${record.lineageId}`
      )
  }
  const selectedById = new Map(
    selected.records.map((record) => [record.lineageId, record])
  )
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: history.records.map((record) =>
    {
      const restored = selectedById.get(record.lineageId)
      return restored
        ? {
            ...record,
            status: restored.status,
            canonicalOrdinal: restored.canonicalOrdinal,
          }
        : { ...record, status: 'tombstoned' as const }
    }),
  })
}
