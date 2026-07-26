// packages/ir/src/edit/lineage/lineage.ts
// validated active semantic lineage snapshots & monotonic history records

import { compareLexicalTextV1 as compareText } from '../support/lexical-order.js'

export type SemanticLineageKind =
  | 'target'
  | 'declaration'
  | 'script'
  | 'block'
  | 'comment'
  | 'procedure'
  | 'parameter'
  | 'costume'
  | 'sound'
  | 'asset'
  | 'monitor'

type SemanticLineageStatus = 'active' | 'dormant' | 'tombstoned'

const SEMANTIC_LINEAGE_KINDS = new Set<SemanticLineageKind>([
  'target',
  'declaration',
  'script',
  'block',
  'comment',
  'procedure',
  'parameter',
  'costume',
  'sound',
  'asset',
  'monitor',
])

const SEMANTIC_LINEAGE_STATUSES = new Set<SemanticLineageStatus>([
  'active',
  'dormant',
  'tombstoned',
])

export interface SemanticLineageRecord
{
  lineageId: string
  kind: SemanticLineageKind
  ownerLineageId: string | null
  status: SemanticLineageStatus
  rawIdentity: string
  canonicalOrdinal: number | null
}

export const SEMANTIC_LINEAGE_VERSION_V1 = 'semantic-lineage-v1'

export interface SemanticLineageSnapshot
{
  version: typeof SEMANTIC_LINEAGE_VERSION_V1
  records: readonly SemanticLineageRecord[]
}

class SemanticLineageError extends Error
{
  constructor(
    readonly code:
      | 'duplicate-lineage'
      | 'duplicate-identity'
      | 'invalid-record'
      | 'missing-owner'
      | 'owner-cycle',
    message: string
  )
  {
    super(message)
    this.name = 'SemanticLineageError'
  }
}

function ownDataValue(value: object, key: string): unknown
{
  const property = Object.getOwnPropertyDescriptor(value, key)
  return property?.enumerable === true && 'value' in property
    ? property.value
    : undefined
}

export function validateSemanticLineageSnapshot(
  snapshot: SemanticLineageSnapshot
): SemanticLineageSnapshot
{
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  )
    throw new SemanticLineageError(
      'invalid-record',
      'semantic lineage snapshot must be an object'
    )
  const version = ownDataValue(snapshot, 'version')
  const inputRecords = ownDataValue(snapshot, 'records')
  if (version !== SEMANTIC_LINEAGE_VERSION_V1)
    throw new SemanticLineageError(
      'invalid-record',
      `unsupported semantic lineage version: ${String(version)}`
    )
  if (!Array.isArray(inputRecords))
    throw new SemanticLineageError(
      'invalid-record',
      'semantic lineage records must be an array'
    )
  const byId = new Map<string, SemanticLineageRecord>()
  const identityKeys = new Set<string>()
  const records: SemanticLineageRecord[] = []
  for (let index = 0; index < inputRecords.length; index += 1)
  {
    const input = ownDataValue(inputRecords, String(index))
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw new SemanticLineageError(
        'invalid-record',
        'semantic lineage record must be an object'
      )
    const lineageId = ownDataValue(input, 'lineageId')
    const kind = ownDataValue(input, 'kind')
    const ownerLineageId = ownDataValue(input, 'ownerLineageId')
    const status = ownDataValue(input, 'status')
    const rawIdentity = ownDataValue(input, 'rawIdentity')
    const canonicalOrdinal = ownDataValue(input, 'canonicalOrdinal')
    if (
      typeof kind !== 'string' ||
      !SEMANTIC_LINEAGE_KINDS.has(kind as SemanticLineageKind) ||
      typeof status !== 'string' ||
      !SEMANTIC_LINEAGE_STATUSES.has(status as SemanticLineageStatus) ||
      (typeof ownerLineageId !== 'string' && ownerLineageId !== null) ||
      typeof lineageId !== 'string' ||
      typeof rawIdentity !== 'string' ||
      lineageId.length === 0 ||
      rawIdentity.length === 0 ||
      (canonicalOrdinal !== null &&
        (typeof canonicalOrdinal !== 'number' ||
          !Number.isSafeInteger(canonicalOrdinal) ||
          canonicalOrdinal < 0))
    )
    {
      throw new SemanticLineageError(
        'invalid-record',
        `invalid semantic lineage record: ${String(lineageId)}`
      )
    }
    const record: SemanticLineageRecord = Object.freeze({
      lineageId,
      kind: kind as SemanticLineageKind,
      ownerLineageId,
      status: status as SemanticLineageStatus,
      rawIdentity,
      canonicalOrdinal,
    })
    if (byId.has(record.lineageId))
      throw new SemanticLineageError(
        'duplicate-lineage',
        `duplicate semantic lineage ID: ${record.lineageId}`
      )
    records.push(record)
    byId.set(record.lineageId, record)
    const identityKey = JSON.stringify([
      record.kind,
      record.ownerLineageId,
      record.rawIdentity,
      record.canonicalOrdinal,
    ])
    if (identityKeys.has(identityKey))
      throw new SemanticLineageError(
        'duplicate-identity',
        `duplicate semantic lineage identity: ${record.rawIdentity}`
      )
    identityKeys.add(identityKey)
  }
  for (const record of byId.values())
  {
    if (record.ownerLineageId !== null && !byId.has(record.ownerLineageId))
    {
      throw new SemanticLineageError(
        'missing-owner',
        `lineage owner is absent: ${record.ownerLineageId}`
      )
    }
    const visited = new Set([record.lineageId])
    let ownerId = record.ownerLineageId
    while (ownerId !== null)
    {
      if (visited.has(ownerId))
        throw new SemanticLineageError(
          'owner-cycle',
          `lineage ownership cycle includes: ${ownerId}`
        )
      visited.add(ownerId)
      ownerId = byId.get(ownerId)?.ownerLineageId ?? null
    }
  }
  return Object.freeze({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: Object.freeze(
      records.sort((a, b) => compareText(a.lineageId, b.lineageId))
    ),
  })
}

export function semanticLineageById(
  snapshot: SemanticLineageSnapshot
): ReadonlyMap<string, SemanticLineageRecord>
{
  const validated = validateSemanticLineageSnapshot(snapshot)
  return new Map(validated.records.map((record) => [record.lineageId, record]))
}

export function activeOrderedSemanticLineages(
  snapshot: SemanticLineageSnapshot,
  kind: 'target' | 'costume' | 'sound' | 'parameter',
  ownerLineageId: string | null
): readonly SemanticLineageRecord[]
{
  const validated = validateSemanticLineageSnapshot(snapshot)
  const records = validated.records
    .filter(
      (record) =>
        record.status === 'active' &&
        record.kind === kind &&
        record.ownerLineageId === ownerLineageId
    )
    .sort((a, b) =>
    {
      if (a.canonicalOrdinal === null || b.canonicalOrdinal === null) return 0
      return a.canonicalOrdinal - b.canonicalOrdinal
    })
  for (let index = 0; index < records.length; index++)
  {
    if (records[index]?.canonicalOrdinal !== index)
      throw new SemanticLineageError(
        'invalid-record',
        `active ${kind} lineage ordinals for ${ownerLineageId ?? 'project'} must be contiguous`
      )
  }
  return Object.freeze([...records])
}
