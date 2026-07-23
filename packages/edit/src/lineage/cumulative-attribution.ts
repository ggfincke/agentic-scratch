// packages/edit/src/lineage/cumulative-attribution.ts
// compose lineage-stable operation attribution across accepted revisions

import type {
  DeltaChangeKind,
  DeltaOperationAttribution,
  ProjectDelta,
  ProtectedChange,
  ValueDelta,
} from '@scratch-agent/ir'
import { semanticHashV1 } from '@scratch-agent/ir/edit'

import { editJsonPointerPartV1 as pointerPart } from '../support/internal-values.js'
import { operationOccurrenceIdHashV1 } from './occurrence-hash.js'

type SemanticEffectKind = DeltaChangeKind | 'moved'

interface SemanticEffectAttribution
{
  readonly kind: SemanticEffectKind
  readonly operationIds: readonly string[]
  readonly descendantDomain?: string
  readonly semanticPath?: string
}

interface EffectFootprint
{
  readonly path: string
  readonly entityLineageIds: readonly string[]
  readonly operationIds: readonly string[]
}

class CumulativeAttributionErrorV1 extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'CumulativeAttributionErrorV1'
  }
}

function fail(message: string): never
{
  throw new CumulativeAttributionErrorV1(message)
}

function sortedUnique(values: readonly string[]): string[]
{
  return [...new Set(values)].sort()
}

export function editOperationOccurrenceIdV1(
  predecessorAcceptedHistorySha256: string,
  opId: string
): string
{
  return operationOccurrenceIdHashV1(
    predecessorAcceptedHistorySha256,
    opId
  )
}

export function editRestoreOccurrenceIdV1(
  predecessorAcceptedHistorySha256: string,
  restoreKind: 'undo' | 'rollback',
  restoreCommandSha256: string
): string
{
  return semanticHashV1('resolved-plan', {
    kind: 'edit-restore-occurrence',
    schemaVersion: 1,
    predecessorAcceptedHistorySha256,
    restoreKind,
    restoreCommandSha256,
  })
}

function stableKey(parts: readonly unknown[]): string
{
  return JSON.stringify(parts)
}

function targetRelativePath(targetIndex: number, path: string): string
{
  const prefix = `/targets/${targetIndex}`
  if (path !== prefix && !path.startsWith(`${prefix}/`))
    return fail(`target delta path is outside ${prefix}: ${path}`)
  return path.slice(prefix.length)
}

function correspondedRelativePath(
  collectionPath: string,
  path: string
): string
{
  if (path !== collectionPath && !path.startsWith(`${collectionPath}/`))
    return fail(`corresponded delta path is outside ${collectionPath}: ${path}`)
  return path.slice(collectionPath.length)
}

function directTargetChanges(
  target: ProjectDelta['targets'][number]
): readonly ValueDelta[]
{
  return [
    ...target.declarationChanges,
    ...target.gameplayPropertyChanges,
    ...target.assetMetadataChanges,
    ...target.existingEditorLayoutChanges,
    ...target.structureChanges,
    ...target.unknownChanges,
  ]
}

function allTargetChanges(
  target: ProjectDelta['targets'][number]
): readonly ValueDelta[]
{
  return [
    ...target.blockChanges.flatMap((block) => block.changes),
    ...directTargetChanges(target),
  ]
}

function targetChanges(delta: ProjectDelta): readonly {
  readonly targetLineageId: string
  readonly targetIndex: number
  readonly change: ValueDelta
}[]
{
  return delta.targets.flatMap((target) =>
  {
    if (typeof target.lineageId !== 'string' || target.lineageId.length === 0)
      return fail('cumulative target delta lacks semantic lineage')
    const changes = allTargetChanges(target)
    return changes.map((change) => ({
      targetLineageId: target.lineageId!,
      targetIndex: target.targetIndex,
      change,
    }))
  })
}

function effectEntries(
  delta: ProjectDelta,
  requireTargetLineage = true
): readonly {
  readonly key: string
  readonly kind: SemanticEffectKind
  readonly operationIds: readonly string[]
  readonly descendantDomain?: string
  readonly semanticPath?: string
}[]
{
  return [
    ...delta.targets.flatMap((target) =>
    {
      const targetLineageId = target.lineageId
      if (
        requireTargetLineage &&
        (typeof targetLineageId !== 'string' || targetLineageId.length === 0)
      )
        return fail('cumulative target delta lacks semantic lineage')
      const stableTargetIdentity =
        typeof targetLineageId === 'string' && targetLineageId.length > 0
          ? targetLineageId
          : `raw-target-index:${target.targetIndex}`
      const changes = allTargetChanges(target)
      return changes.map((change) => ({
        key: stableKey([
          'target-leaf',
          stableTargetIdentity,
          targetRelativePath(target.targetIndex, change.path),
        ]),
        kind: change.kind,
        operationIds: change.operationIds,
        descendantDomain: stableKey(['target-leaf', stableTargetIdentity]),
        semanticPath: targetRelativePath(target.targetIndex, change.path),
      }))
    }),
    ...delta.projectChanges.map((entry) => ({
      key: stableKey(['project-leaf', entry.change.path]),
      kind: entry.change.kind,
      operationIds: entry.change.operationIds,
      descendantDomain: stableKey(['project-leaf']),
      semanticPath: entry.change.path,
    })),
    ...(delta.derivedProjectChanges ?? []).map((entry) => ({
      key: stableKey(['derived-project-leaf', entry.path]),
      kind: entry.kind,
      operationIds: entry.operationIds,
      descendantDomain: stableKey(['derived-project-leaf']),
      semanticPath: entry.path,
    })),
    ...delta.assets.map((entry) => ({
      key: stableKey(['asset', entry.path, entry.occurrence]),
      kind: entry.kind,
      operationIds: entry.operationIds,
    })),
    ...(delta.orderedCollectionChanges ?? []).map((entry) => ({
      key: stableKey([
        'ordered-member',
        entry.collectionKind,
        entry.ownerLineageId,
        entry.lineageId,
      ]),
      kind: entry.kind,
      operationIds: entry.operationIds,
    })),
    ...(delta.correspondedEntityChanges ?? []).flatMap((entry) =>
      entry.changes.map((change) => ({
        key: stableKey([
          'corresponded-leaf',
          entry.collectionKind,
          entry.ownerLineageId,
          entry.entityLineageId,
          correspondedRelativePath(entry.collectionPath, change.path),
        ]),
        kind: change.kind,
        operationIds: change.operationIds,
        descendantDomain: stableKey([
          'corresponded-leaf',
          entry.collectionKind,
          entry.ownerLineageId,
          entry.entityLineageId,
        ]),
        semanticPath: correspondedRelativePath(
          entry.collectionPath,
          change.path
        ),
      }))
    ),
  ]
}

function effectIndex(
  label: string,
  delta: ProjectDelta,
  requireTargetLineage = true
): ReadonlyMap<string, SemanticEffectAttribution>
{
  if (delta.complete !== true)
    return fail(`${label} project delta is incomplete`)
  const entries = new Map<string, SemanticEffectAttribution>()
  for (const effect of effectEntries(delta, requireTargetLineage))
  {
    if (effect.operationIds.length === 0)
      return fail(`${label} effect ${effect.key} is unattributed`)
    const prior = entries.get(effect.key)
    if (prior && prior.kind !== effect.kind)
      return fail(`${label} effect ${effect.key} has inconsistent kinds`)
    entries.set(effect.key, {
      kind: effect.kind,
      operationIds: sortedUnique([
        ...(prior?.operationIds ?? []),
        ...effect.operationIds,
      ]),
      ...(effect.descendantDomain === undefined
        ? {}
        : { descendantDomain: effect.descendantDomain }),
      ...(effect.semanticPath === undefined
        ? {}
        : { semanticPath: effect.semanticPath }),
    })
  }
  return entries
}

function isStrictDescendantPath(parent: string, candidate: string): boolean
{
  if (candidate === parent) return false
  return parent.length === 0
    ? candidate.startsWith('/')
    : candidate.startsWith(`${parent}/`)
}

function descendantOperationIds(
  ancestor: SemanticEffectAttribution,
  effects: ReadonlyMap<string, SemanticEffectAttribution>
): string[]
{
  if (
    ancestor.descendantDomain === undefined ||
    ancestor.semanticPath === undefined
  )
    return []
  const output: string[] = []
  for (const effect of effects.values())
  {
    if (
      effect.descendantDomain === ancestor.descendantDomain &&
      effect.semanticPath !== undefined &&
      isStrictDescendantPath(ancestor.semanticPath, effect.semanticPath)
    )
      output.push(...effect.operationIds)
  }
  return sortedUnique(output)
}

export function projectDeltaOperationAttributionProjectionV1(
  delta: ProjectDelta
): unknown
{
  const effects = effectIndex('project delta attribution', delta, false)
  return {
    kind: 'edit-project-delta-operation-attribution',
    schemaVersion: 1,
    effects: [...effects]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, effect]) => ({
        semanticEffectKey: JSON.parse(key) as unknown,
        changeKind: effect.kind,
        operationOccurrenceIds: effect.operationIds,
      })),
  }
}

export function singleOperationProjectDeltaAttributionV1(
  delta: ProjectDelta,
  operationOccurrenceId: string
): DeltaOperationAttribution
{
  if (delta.complete !== true)
    return fail('single-operation project delta is incomplete')
  return {
    operationId: operationOccurrenceId,
    projectPaths: sortedUnique([
      ...delta.targets
        .flatMap(allTargetChanges)
        .map((change) => change.path),
      ...delta.projectChanges.map((entry) => entry.change.path),
      ...(delta.derivedProjectChanges ?? []).map((entry) => entry.path),
      ...(delta.orderedCollectionChanges ?? []).map(
        (entry) => entry.collectionPath
      ),
      ...(delta.correspondedEntityChanges ?? []).map(
        (entry) => entry.collectionPath
      ),
    ]),
    assetPaths: sortedUnique(delta.assets.map((entry) => entry.path)),
  }
}

function cumulativeOperationIds(
  key: string,
  kind: SemanticEffectKind,
  prior: ReadonlyMap<string, SemanticEffectAttribution>,
  parent: ReadonlyMap<string, SemanticEffectAttribution>
): string[]
{
  const priorEffect = prior.get(key)
  const parentEffect = parent.get(key)
  if (kind === 'added' && priorEffect?.kind === 'added')
    return sortedUnique([
      ...priorEffect.operationIds,
      ...(parentEffect?.operationIds ?? []),
      ...descendantOperationIds(priorEffect, parent),
    ])
  if (parentEffect)
  {
    return [...parentEffect.operationIds]
  }
  if (priorEffect) return [...priorEffect.operationIds]
  return fail(`cumulative effect ${key} has no prior or parent attribution`)
}

function assignValueDelta(
  change: ValueDelta,
  key: string,
  prior: ReadonlyMap<string, SemanticEffectAttribution>,
  parent: ReadonlyMap<string, SemanticEffectAttribution>
): void
{
  change.operationIds = cumulativeOperationIds(key, change.kind, prior, parent)
}

function effectFootprints(delta: ProjectDelta): readonly EffectFootprint[]
{
  return [
    ...targetChanges(delta).map((entry) => ({
      path: entry.change.path,
      entityLineageIds: sortedUnique([
        entry.targetLineageId,
        ...(entry.change.entityLineageIds ?? []),
      ]),
      operationIds: entry.change.operationIds,
    })),
    ...delta.projectChanges.map((entry) => ({
      path: entry.change.path,
      entityLineageIds: entry.change.entityLineageIds ?? [],
      operationIds: entry.change.operationIds,
    })),
    ...(delta.derivedProjectChanges ?? []).map((entry) => ({
      path: entry.path,
      entityLineageIds: entry.entityLineageIds ?? [],
      operationIds: entry.operationIds,
    })),
    ...delta.assets.map((entry) => ({
      path: `/assets/${pointerPart(entry.path)}/${entry.occurrence}`,
      entityLineageIds: [],
      operationIds: entry.operationIds,
    })),
    ...(delta.orderedCollectionChanges ?? []).map((entry) => ({
      path: entry.collectionPath,
      entityLineageIds: [entry.lineageId],
      operationIds: entry.operationIds,
    })),
    ...(delta.correspondedEntityChanges ?? []).flatMap((entry) =>
      entry.changes.map((change) => ({
        path: change.path,
        entityLineageIds: sortedUnique([
          entry.entityLineageId,
          ...(change.entityLineageIds ?? []),
        ]),
        operationIds: change.operationIds,
      }))
    ),
  ]
}

function protectedOperationIds(
  change: ProtectedChange,
  footprints: readonly EffectFootprint[]
): string[]
{
  const requiredLineages = change.entityLineageIds ?? []
  const lineageMatches = (footprint: EffectFootprint): boolean =>
    requiredLineages.every((lineageId) =>
      footprint.entityLineageIds.includes(lineageId)
    )
  const exact = footprints.filter(
    (footprint) => footprint.path === change.path && lineageMatches(footprint)
  )
  const matches =
    exact.length > 0
      ? exact
      : footprints.filter(
          (footprint) =>
            footprint.path.startsWith(`${change.path}/`) &&
            lineageMatches(footprint)
        )
  return sortedUnique(matches.flatMap((footprint) => footprint.operationIds))
}

function assignTargetAttribution(
  delta: ProjectDelta,
  prior: ReadonlyMap<string, SemanticEffectAttribution>,
  parent: ReadonlyMap<string, SemanticEffectAttribution>
): void
{
  for (const target of delta.targets)
  {
    if (typeof target.lineageId !== 'string' || target.lineageId.length === 0)
      return fail('cumulative target delta lacks semantic lineage')
    const assign = (change: ValueDelta): void =>
      assignValueDelta(
        change,
        stableKey([
          'target-leaf',
          target.lineageId,
          targetRelativePath(target.targetIndex, change.path),
        ]),
        prior,
        parent
      )
    for (const block of target.blockChanges)
    {
      for (const change of block.changes) assign(change)
      block.operationIds = sortedUnique(
        block.changes.flatMap((change) => change.operationIds)
      )
    }
    const direct = directTargetChanges(target)
    for (const change of direct) assign(change)
    target.operationIds = sortedUnique([
      ...target.blockChanges.flatMap((block) => block.operationIds),
      ...direct.flatMap((change) => change.operationIds),
    ])
  }
}

export function composeCumulativeProjectDeltaAttributionV1(
  priorCumulativeDelta: ProjectDelta,
  parentDelta: ProjectDelta,
  draftCumulativeDelta: ProjectDelta
): ProjectDelta
{
  const prior = effectIndex('prior cumulative', priorCumulativeDelta)
  const parent = effectIndex('parent', parentDelta)
  if (draftCumulativeDelta.complete !== true)
    return fail('draft cumulative project delta is incomplete')
  const output = structuredClone(draftCumulativeDelta)
  assignTargetAttribution(output, prior, parent)
  for (const entry of output.projectChanges)
    assignValueDelta(
      entry.change,
      stableKey(['project-leaf', entry.change.path]),
      prior,
      parent
    )
  for (const entry of output.derivedProjectChanges ?? [])
    assignValueDelta(
      entry,
      stableKey(['derived-project-leaf', entry.path]),
      prior,
      parent
    )
  for (const entry of output.assets)
    entry.operationIds = cumulativeOperationIds(
      stableKey(['asset', entry.path, entry.occurrence]),
      entry.kind,
      prior,
      parent
    )
  for (const entry of output.orderedCollectionChanges ?? [])
    entry.operationIds = cumulativeOperationIds(
      stableKey([
        'ordered-member',
        entry.collectionKind,
        entry.ownerLineageId,
        entry.lineageId,
      ]),
      entry.kind,
      prior,
      parent
    )
  for (const entry of output.correspondedEntityChanges ?? [])
  {
    for (const change of entry.changes)
      assignValueDelta(
        change,
        stableKey([
          'corresponded-leaf',
          entry.collectionKind,
          entry.ownerLineageId,
          entry.entityLineageId,
          correspondedRelativePath(entry.collectionPath, change.path),
        ]),
        prior,
        parent
      )
  }
  const footprints = effectFootprints(output)
  output.protectedChanges = output.protectedChanges.flatMap((change) =>
  {
    const operationIds = protectedOperationIds(change, footprints)
    if (operationIds.length === 0)
      return fail(`protected effect ${change.path} remains unattributed`)
    if (change.class === 'unattributed') return []
    return [{ ...change, operationIds }]
  })
  return output
}
