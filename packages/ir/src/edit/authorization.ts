// packages/ir/src/edit/authorization.ts
// edit-only exact authorization envelopes w/ default-deny preservation results

import type {
  DeltaChangeKind,
  ProjectDelta,
  ProtectedChangeClass,
} from '../project/project-delta.js'
import { jsonPointerPart as pointerPart } from '../project/project-vocabulary.js'
import { semanticHashV1 } from './hash-domains.js'

type SemanticEntityMoveCollectionV1 =
  | 'visualLayers'
  | 'costumes'
  | 'sounds'
  | 'scriptWorkspace'
  | 'commentWorkspace'

export function semanticEntityMovePositionSha256V1(
  collection: SemanticEntityMoveCollectionV1,
  position: unknown
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'semantic-entity-move-position',
    schemaVersion: 1,
    collection,
    position,
  })
}

export interface EditAuthorizationEnvelope
{
  operationId: string
  exactPaths: readonly string[]
  pathPrefixes: readonly string[]
  changeKinds: readonly DeltaChangeKind[]
  protectedClasses: readonly ProtectedChangeClass[]
  entityLineageIds: readonly string[]
  allowMandatoryProtectedChange: boolean
}

interface EditAuthorizationViolation
{
  code:
    | 'incomplete-delta'
    | 'unattributed-change'
    | 'unknown-operation'
    | 'duplicate-envelope'
    | 'unauthorized-path'
    | 'unauthorized-kind'
    | 'unauthorized-entity'
    | 'unauthorized-class'
    | 'mandatory-protected-change'
  path: string
  operationIds: readonly string[]
  detail: string
}

interface EditAuthorizationResult
{
  authorized: boolean
  violations: readonly EditAuthorizationViolation[]
}

interface AuthorizableChange
{
  path: string
  kind: DeltaChangeKind
  operationIds: readonly string[]
  entityLineageIds?: readonly string[]
}

function ownDataValue(value: object, key: string): unknown
{
  const property = Object.getOwnPropertyDescriptor(value, key)
  return property?.enumerable === true && 'value' in property
    ? property.value
    : undefined
}

function ownStringArray(value: object, key: string): readonly string[]
{
  const input = ownDataValue(value, key)
  if (!Array.isArray(input)) return []
  const result: string[] = []
  for (let index = 0; index < input.length; index += 1)
  {
    const entry = ownDataValue(input, String(index))
    if (typeof entry !== 'string') return []
    result.push(entry)
  }
  return Object.freeze(result)
}

function sanitizeEnvelope(value: unknown): EditAuthorizationEnvelope | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  const operationId = ownDataValue(value, 'operationId')
  if (typeof operationId !== 'string' || operationId.length === 0) return null
  return Object.freeze({
    operationId,
    exactPaths: ownStringArray(value, 'exactPaths'),
    pathPrefixes: ownStringArray(value, 'pathPrefixes'),
    changeKinds: ownStringArray(value, 'changeKinds') as DeltaChangeKind[],
    protectedClasses: ownStringArray(
      value,
      'protectedClasses'
    ) as ProtectedChangeClass[],
    entityLineageIds: ownStringArray(value, 'entityLineageIds'),
    allowMandatoryProtectedChange:
      ownDataValue(value, 'allowMandatoryProtectedChange') === true,
  })
}

function sanitizeEnvelopes(
  values: readonly EditAuthorizationEnvelope[]
): readonly EditAuthorizationEnvelope[]
{
  const result: EditAuthorizationEnvelope[] = []
  for (let index = 0; index < values.length; index += 1)
  {
    const envelope = sanitizeEnvelope(ownDataValue(values, String(index)))
    if (envelope) result.push(envelope)
  }
  return result
}

function isPathWithinPrefix(path: string, prefix: string): boolean
{
  return path === prefix || path.startsWith(`${prefix}/`)
}

function collectAuthorizableChanges(delta: ProjectDelta): AuthorizableChange[]
{
  const changes: AuthorizableChange[] = []
  for (const target of delta.targets)
  {
    for (const block of target.blockChanges) changes.push(...block.changes)
    changes.push(
      ...target.declarationChanges,
      ...target.gameplayPropertyChanges,
      ...target.assetMetadataChanges,
      ...target.existingEditorLayoutChanges,
      ...target.structureChanges,
      ...target.unknownChanges
    )
  }
  for (const asset of delta.assets)
  {
    changes.push({
      path: `/assets/${pointerPart(asset.path)}/${asset.occurrence}`,
      kind: asset.kind,
      operationIds: asset.operationIds,
    })
  }
  for (const projectChange of delta.projectChanges)
    changes.push(projectChange.change)
  changes.push(...(delta.derivedProjectChanges ?? []))
  for (const ordered of delta.orderedCollectionChanges ?? [])
  {
    changes.push({
      path: ordered.collectionPath,
      kind:
        ordered.kind === 'added'
          ? 'added'
          : ordered.kind === 'removed'
            ? 'removed'
            : 'changed',
      operationIds: ordered.operationIds,
      entityLineageIds: [ordered.lineageId],
    })
  }
  for (const entity of delta.correspondedEntityChanges ?? [])
    changes.push(...entity.changes)
  return changes
}

function envelopeAuthorizesPath(
  envelope: EditAuthorizationEnvelope,
  path: string
): boolean
{
  return (
    envelope.exactPaths?.includes(path) === true ||
    envelope.pathPrefixes?.some((prefix) =>
      isPathWithinPrefix(path, prefix)
    ) === true
  )
}

function envelopeAuthorizesKind(
  envelope: EditAuthorizationEnvelope,
  change: AuthorizableChange
): boolean
{
  return envelope.changeKinds?.includes(change.kind) === true
}

function envelopeCoversEveryLineage(
  envelope: EditAuthorizationEnvelope,
  entityLineageIds: readonly string[]
): boolean
{
  return entityLineageIds.every(
    (lineageId) => envelope.entityLineageIds?.includes(lineageId) === true
  )
}

export function authorizeEditDelta(
  delta: ProjectDelta,
  envelopes: readonly EditAuthorizationEnvelope[]
): EditAuthorizationResult
{
  const violations: EditAuthorizationViolation[] = []
  if (!delta.complete)
  {
    violations.push({
      code: 'incomplete-delta',
      path: '',
      operationIds: [],
      detail: 'edit authorization requires a complete project delta',
    })
  }
  const envelopeByOperationId = new Map<string, EditAuthorizationEnvelope>()
  for (const envelope of sanitizeEnvelopes(envelopes))
  {
    if (envelopeByOperationId.has(envelope.operationId))
    {
      violations.push({
        code: 'duplicate-envelope',
        path: '',
        operationIds: [envelope.operationId],
        detail: 'each operation must have exactly one authorization envelope',
      })
      continue
    }
    envelopeByOperationId.set(envelope.operationId, envelope)
  }
  for (const change of collectAuthorizableChanges(delta))
  {
    if (change.operationIds.length === 0)
    {
      violations.push({
        code: 'unattributed-change',
        path: change.path,
        operationIds: [],
        detail: 'changed leaf has no responsible operation',
      })
      continue
    }
    const known = change.operationIds.flatMap((operationId) =>
    {
      const envelope = envelopeByOperationId.get(operationId)
      return envelope ? [envelope] : []
    })
    if (known.length !== change.operationIds.length)
    {
      violations.push({
        code: 'unknown-operation',
        path: change.path,
        operationIds: change.operationIds,
        detail: 'changed leaf names an operation without an envelope',
      })
    }
    const pathMatches = known.filter((envelope) =>
      envelopeAuthorizesPath(envelope, change.path)
    )
    if (pathMatches.length === 0)
    {
      violations.push({
        code: 'unauthorized-path',
        path: change.path,
        operationIds: change.operationIds,
        detail: 'no responsible operation authorizes the changed leaf',
      })
      continue
    }
    const kindMatches = pathMatches.filter((envelope) =>
      envelopeAuthorizesKind(envelope, change)
    )
    if (kindMatches.length === 0)
    {
      violations.push({
        code: 'unauthorized-kind',
        path: change.path,
        operationIds: change.operationIds,
        detail: `no responsible operation explicitly authorizes ${change.kind}`,
      })
      continue
    }
    const entityLineageIds = change.entityLineageIds ?? []
    if (
      !kindMatches.some((envelope) =>
        envelopeCoversEveryLineage(envelope, entityLineageIds)
      )
    )
    {
      violations.push({
        code: 'unauthorized-entity',
        path: change.path,
        operationIds: change.operationIds,
        detail: `no one responsible operation authorizes every changed lineage: ${entityLineageIds.join(', ')}`,
      })
    }
  }
  for (const protectedChange of delta.protectedChanges)
  {
    const candidates = protectedChange.operationIds.flatMap((operationId) =>
    {
      const envelope = envelopeByOperationId.get(operationId)
      return envelope ? [envelope] : []
    })
    const classAndPathCandidates = candidates.filter(
      (envelope) =>
        envelopeAuthorizesPath(envelope, protectedChange.path) &&
        envelope.protectedClasses?.includes(protectedChange.class) === true
    )
    const protectedCandidates = (
      protectedChange.mandatory
        ? classAndPathCandidates.filter(
            (envelope) => envelope.allowMandatoryProtectedChange === true
          )
        : classAndPathCandidates
    ).filter((envelope) =>
      envelopeCoversEveryLineage(
        envelope,
        protectedChange.entityLineageIds ?? []
      )
    )
    if (protectedChange.mandatory && protectedCandidates.length === 0)
    {
      violations.push({
        code: 'mandatory-protected-change',
        path: protectedChange.path,
        operationIds: protectedChange.operationIds,
        detail: protectedChange.detail,
      })
      continue
    }
    if (protectedCandidates.length === 0)
    {
      violations.push({
        code:
          classAndPathCandidates.length === 0
            ? 'unauthorized-class'
            : 'unauthorized-entity',
        path: protectedChange.path,
        operationIds: protectedChange.operationIds,
        detail:
          classAndPathCandidates.length === 0
            ? `protected class is not authorized: ${protectedChange.class}`
            : 'no one responsible operation authorizes every protected lineage',
      })
    }
  }
  const unique = new Map<string, EditAuthorizationViolation>()
  for (const violation of violations)
  {
    const key = JSON.stringify([
      violation.code,
      violation.path,
      violation.operationIds,
    ])
    if (!unique.has(key)) unique.set(key, violation)
  }
  return {
    authorized: unique.size === 0,
    violations: [...unique.values()],
  }
}
