// packages/edit/src/evaluation/runtime-projection-authority.ts
// compile accepted edit operations into exact runtime projection authority

import type { ProjectIR } from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  validateSemanticLineageSnapshot,
  type SemanticEditOperationV1,
  type SemanticLineageKind,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'
import type {
  EditProjectionNameTransitionV1,
  EditRuntimeProjectionAuthorizationsV1,
  EditTargetMembershipAuthorizationV1,
} from '@scratch-agent/eval'

interface EditAcceptedRuntimeProjectionOperationV1
{
  readonly operation: SemanticEditOperationV1
  readonly selectedEntityLineageIds: readonly string[]
}

class EditRuntimeProjectionAuthorityErrorV1 extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'EditRuntimeProjectionAuthorityErrorV1'
  }
}

function fail(message: string): never
{
  throw new EditRuntimeProjectionAuthorityErrorV1(message)
}

function activeRecord(
  lineage: SemanticLineageSnapshot,
  lineageId: string,
  kind: SemanticLineageKind
): SemanticLineageRecord | null
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.lineageId === lineageId &&
      record.kind === kind
  )
  if (matches.length > 1)
    fail(`runtime projection lineage ${lineageId} has duplicate ${kind} rows`)
  return matches[0] ?? null
}

function exactAcceptedLineage(
  operation: EditAcceptedRuntimeProjectionOperationV1,
  kind: SemanticLineageKind,
  sourceLineage: SemanticLineageSnapshot,
  candidateLineage: SemanticLineageSnapshot
): string
{
  const matches = operation.selectedEntityLineageIds.filter(
    (lineageId) =>
      activeRecord(sourceLineage, lineageId, kind) !== null ||
      activeRecord(candidateLineage, lineageId, kind) !== null
  )
  if (matches.length !== 1)
  {
    fail(
      `${operation.operation.kind} selected ${matches.length} exact ${kind} lineages for runtime projection authority`
    )
  }
  return matches[0]!
}

function targetName(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  lineageId: string
): string | null
{
  const record = activeRecord(lineage, lineageId, 'target')
  if (!record) return null
  const ordered = activeOrderedSemanticLineages(lineage, 'target', null)
  const targetIndex = ordered.findIndex(
    (candidate) => candidate.lineageId === record.lineageId
  )
  const target = project.json.targets[targetIndex]
  if (!target)
    fail(`runtime projection target ${lineageId} has no exact artifact row`)
  return target.name
}

function ownerTargetIndex(
  lineage: SemanticLineageSnapshot,
  record: SemanticLineageRecord
): number
{
  if (record.ownerLineageId === null)
    return fail(
      `runtime projection ${record.kind} ${record.lineageId} has no owner`
    )
  const targets = activeOrderedSemanticLineages(lineage, 'target', null)
  const targetIndex = targets.findIndex(
    (target) => target.lineageId === record.ownerLineageId
  )
  if (targetIndex < 0)
    return fail(`runtime projection owner ${record.ownerLineageId} is absent`)
  return targetIndex
}

function declarationName(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  lineageId: string
): string | null
{
  const record = activeRecord(lineage, lineageId, 'declaration')
  if (!record) return null
  const separator = record.rawIdentity.indexOf(':')
  if (separator < 1)
    return fail(
      `runtime projection declaration ${lineageId} has invalid identity`
    )
  const kind = record.rawIdentity.slice(0, separator)
  const rawId = record.rawIdentity.slice(separator + 1)
  const target = project.json.targets[ownerTargetIndex(lineage, record)]
  if (!target)
    return fail(`runtime projection declaration ${lineageId} owner is absent`)
  if (kind === 'variable')
  {
    const value = target.variables?.[rawId]
    if (!value)
      return fail(`runtime projection variable ${lineageId} is absent`)
    return value[0]
  }
  if (kind === 'list')
  {
    const value = target.lists?.[rawId]
    if (!value) return fail(`runtime projection list ${lineageId} is absent`)
    return value[0]
  }
  return null
}

function costumeName(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  lineageId: string
): string | null
{
  const record = activeRecord(lineage, lineageId, 'costume')
  if (!record) return null
  if (record.canonicalOrdinal === null)
    return fail(`runtime projection costume ${lineageId} has no ordinal`)
  const target = project.json.targets[ownerTargetIndex(lineage, record)]
  const costume = target?.costumes[record.canonicalOrdinal]
  if (!costume) return fail(`runtime projection costume ${lineageId} is absent`)
  return costume.name
}

function transitionIdentity(
  transition: EditProjectionNameTransitionV1
): string
{
  if (transition.transitionKind === 'targetName')
    return transition.targetLineage
  if (transition.transitionKind === 'declarationName')
    return transition.declarationLineage
  return transition.mediaLineage
}

function sortedTransitions(
  transitions: ReadonlyMap<string, EditProjectionNameTransitionV1>
): readonly EditProjectionNameTransitionV1[]
{
  return Object.freeze(
    [...transitions.values()]
      .sort((left, right) =>
      {
        const leftId = transitionIdentity(left)
        const rightId = transitionIdentity(right)
        return leftId === rightId ? 0 : leftId < rightId ? -1 : 1
      })
      .map((entry) => Object.freeze(entry))
  )
}

// * the candidate values below are readable only after the accepted operation
// * named the exact lineage; an artifact diff never grants authority by itself.
export function compileEditRuntimeProjectionAuthorizationsV1(input: {
  readonly source: ProjectIR
  readonly candidate: ProjectIR
  readonly sourceLineage: SemanticLineageSnapshot
  readonly candidateLineage: SemanticLineageSnapshot
  readonly prior: EditRuntimeProjectionAuthorizationsV1
  readonly acceptedOperations: readonly EditAcceptedRuntimeProjectionOperationV1[]
}): EditRuntimeProjectionAuthorizationsV1
{
  const sourceLineage = validateSemanticLineageSnapshot(input.sourceLineage)
  const candidateLineage = validateSemanticLineageSnapshot(
    input.candidateLineage
  )
  const transitionKinds = new Map(
    input.prior.nameTransitions.map((transition) => [
      transitionIdentity(transition),
      transition.transitionKind,
    ])
  )
  const membershipKinds = new Set(
    input.prior.targetMembershipAuthorizations.map(
      (authorization) => authorization.targetLineage
    )
  )
  for (const accepted of input.acceptedOperations)
  {
    if (accepted.operation.kind === 'target.renameSprite')
      transitionKinds.set(
        exactAcceptedLineage(
          accepted,
          'target',
          sourceLineage,
          candidateLineage
        ),
        'targetName'
      )
    else if (accepted.operation.kind === 'declaration.rename')
      transitionKinds.set(
        exactAcceptedLineage(
          accepted,
          'declaration',
          sourceLineage,
          candidateLineage
        ),
        'declarationName'
      )
    else if (accepted.operation.kind === 'media.renameCostume')
      transitionKinds.set(
        exactAcceptedLineage(
          accepted,
          'costume',
          sourceLineage,
          candidateLineage
        ),
        'mediaName'
      )
    else if (
      accepted.operation.kind === 'target.addSprite' ||
      accepted.operation.kind === 'target.removeSprite'
    )
      membershipKinds.add(
        exactAcceptedLineage(
          accepted,
          'target',
          sourceLineage,
          candidateLineage
        )
      )
  }
  const transitions = new Map<string, EditProjectionNameTransitionV1>()
  for (const [lineageId, transitionKind] of transitionKinds)
  {
    const baselineName =
      transitionKind === 'targetName'
        ? targetName(input.source, sourceLineage, lineageId)
        : transitionKind === 'declarationName'
          ? declarationName(input.source, sourceLineage, lineageId)
          : costumeName(input.source, sourceLineage, lineageId)
    const candidateName =
      transitionKind === 'targetName'
        ? targetName(input.candidate, candidateLineage, lineageId)
        : transitionKind === 'declarationName'
          ? declarationName(input.candidate, candidateLineage, lineageId)
          : costumeName(input.candidate, candidateLineage, lineageId)
    if (
      baselineName === null ||
      candidateName === null ||
      baselineName === candidateName
    )
      continue
    transitions.set(
      lineageId,
      transitionKind === 'targetName'
        ? {
            transitionKind,
            operationKind: 'target.renameSprite',
            targetLineage: lineageId,
            baselineName,
            candidateName,
          }
        : transitionKind === 'declarationName'
          ? {
              transitionKind,
              operationKind: 'declaration.rename',
              declarationLineage: lineageId,
              baselineName,
              candidateName,
            }
          : {
              transitionKind,
              operationKind: 'media.renameCostume',
              mediaLineage: lineageId,
              baselineName,
              candidateName,
            }
    )
  }
  const memberships: EditTargetMembershipAuthorizationV1[] = []
  for (const lineageId of membershipKinds)
  {
    const baselinePresent =
      activeRecord(sourceLineage, lineageId, 'target') !== null
    const candidatePresent =
      activeRecord(candidateLineage, lineageId, 'target') !== null
    if (baselinePresent === candidatePresent) continue
    memberships.push(
      Object.freeze(
        candidatePresent
          ? {
              targetLineage: lineageId,
              presentSide: 'candidate' as const,
              operationKind: 'target.addSprite' as const,
            }
          : {
              targetLineage: lineageId,
              presentSide: 'baseline' as const,
              operationKind: 'target.removeSprite' as const,
            }
      )
    )
  }
  memberships.sort((left, right) =>
    left.targetLineage.localeCompare(right.targetLineage)
  )
  return immutableEditRuntimeProjectionAuthorizationsV1({
    nameTransitions: sortedTransitions(transitions),
    targetMembershipAuthorizations: Object.freeze(memberships),
  })
}

export function emptyEditRuntimeProjectionAuthorizationsV1(): EditRuntimeProjectionAuthorizationsV1
{
  return immutableEditRuntimeProjectionAuthorizationsV1({
    nameTransitions: Object.freeze([]),
    targetMembershipAuthorizations: Object.freeze([]),
  })
}

export function immutableEditRuntimeProjectionAuthorizationsV1(
  value: EditRuntimeProjectionAuthorizationsV1
): EditRuntimeProjectionAuthorizationsV1
{
  return Object.freeze({
    nameTransitions: Object.freeze(
      value.nameTransitions.map((entry) => Object.freeze({ ...entry }))
    ),
    targetMembershipAuthorizations: Object.freeze(
      value.targetMembershipAuthorizations.map((entry) =>
        Object.freeze({ ...entry })
      )
    ),
  })
}
