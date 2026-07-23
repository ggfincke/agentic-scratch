// packages/ir/src/edit/correspondence.ts
// complete unique lineage correspondence for ordered Scratch collections

import type { SemanticLineageSnapshot } from './lineage.js'

export type OrderedCollectionKind =
  | 'targets'
  | 'costumes'
  | 'sounds'
  | 'procedure-parameters'
  | 'procedure-call-arguments'

export interface OrderedCollectionMemberCorrespondence
{
  lineageId: string
  beforeIndex: number | null
  afterIndex: number | null
}

export interface OrderedCollectionCorrespondence
{
  collectionKind: OrderedCollectionKind
  collectionPath: string
  beforeCollectionPath: string | null
  afterCollectionPath: string | null
  ownerLineageId: string | null
  targetOwnerLineageId: string | null
  containerLineageId: string | null
  beforeLineageIds: readonly string[]
  afterLineageIds: readonly string[]
  members: readonly OrderedCollectionMemberCorrespondence[]
}

interface OrderedCollectionHeadMemberEvidence
{
  lineageId: string
  kind: 'target' | 'costume' | 'sound' | 'parameter'
  ownerLineageId: string | null
  memberFingerprint: string
}

export interface OrderedCollectionHeadEvidence
{
  collectionKind: OrderedCollectionKind
  collectionPath: string | null
  ownerLineageId: string | null
  ownerKind: 'target' | 'procedure' | null
  ownerOwnerLineageId: string | null
  ownerFingerprint: string | null
  containerLineageId: string | null
  containerKind: 'target' | 'block' | null
  containerFingerprint: string | null
  members: readonly OrderedCollectionHeadMemberEvidence[]
}

export const PROJECT_ORDERED_HEAD_VERSION_V1 = 'project-ordered-head-v1'

export interface ProjectOrderedHeadEvidence
{
  version: typeof PROJECT_ORDERED_HEAD_VERSION_V1
  revisionIdentity: string
  semanticSourceSha256: string
  projectFingerprint: string
  lineageSnapshot: SemanticLineageSnapshot
  collections: readonly OrderedCollectionHeadEvidence[]
}

export interface SemanticLineageHeadEvidence
{
  revisionIdentity: string
  semanticSourceSha256: string
  lineageSnapshot: SemanticLineageSnapshot
}

export interface ProjectOrderedCorrespondenceEvidence
{
  before: ProjectOrderedHeadEvidence
  after: ProjectOrderedHeadEvidence
}

export interface ProjectOrderedCorrespondence
{
  beforeRevisionIdentity: string
  afterRevisionIdentity: string
  beforeSemanticSourceSha256: string
  afterSemanticSourceSha256: string
  targets?: OrderedCollectionCorrespondence
  media?: readonly OrderedCollectionCorrespondence[]
  procedureParameters?: readonly OrderedCollectionCorrespondence[]
  procedureCallArguments?: readonly OrderedCollectionCorrespondence[]
}

interface ValidatedOrderedCollectionCorrespondence extends OrderedCollectionCorrespondence
{
  beforeToAfter: ReadonlyMap<number, number>
  afterToBefore: ReadonlyMap<number, number>
}

export class OrderedCorrespondenceError extends Error
{
  constructor(
    readonly code:
      | 'wrong-kind'
      | 'wrong-path'
      | 'wrong-owner'
      | 'duplicate-lineage'
      | 'duplicate-index'
      | 'invalid-index'
      | 'member-mismatch'
      | 'incomplete'
      | 'missing-evidence'
      | 'head-mismatch',
    message: string
  )
  {
    super(message)
    this.name = 'OrderedCorrespondenceError'
  }
}

function unique(values: readonly string[]): boolean
{
  return new Set(values).size === values.length
}

function validateIndex(
  value: number | null,
  length: number,
  side: 'before' | 'after'
): void
{
  if (
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0 || value >= length)
  )
  {
    throw new OrderedCorrespondenceError(
      'invalid-index',
      `${side} correspondence index is out of range: ${String(value)}`
    )
  }
}

export function validateOrderedCollectionCorrespondence(
  value: OrderedCollectionCorrespondence,
  expected?: {
    collectionKind?: OrderedCollectionKind
    collectionPath?: string
    ownerLineageId?: string | null
  }
): ValidatedOrderedCollectionCorrespondence
{
  if (!value.collectionPath.startsWith('/'))
    throw new OrderedCorrespondenceError(
      'wrong-path',
      'ordered collection path must be an absolute JSON pointer'
    )
  for (const [side, path] of [
    ['before', value.beforeCollectionPath],
    ['after', value.afterCollectionPath],
  ] as const)
  {
    if (path !== null && !path.startsWith('/'))
      throw new OrderedCorrespondenceError(
        'wrong-path',
        `${side} ordered collection path must be an absolute JSON pointer or null`
      )
  }
  if (value.beforeCollectionPath === null && value.afterCollectionPath === null)
    throw new OrderedCorrespondenceError(
      'wrong-path',
      'ordered collection must exist on at least one head'
    )
  if (
    value.collectionPath !==
    (value.afterCollectionPath ?? value.beforeCollectionPath)
  )
    throw new OrderedCorrespondenceError(
      'wrong-path',
      'ordered collection path must use the after-head path when present'
    )
  if (
    value.ownerLineageId !== null &&
    (typeof value.ownerLineageId !== 'string' ||
      value.ownerLineageId.length === 0)
  )
    throw new OrderedCorrespondenceError(
      'wrong-owner',
      'ordered collection owner lineage must be a nonempty string or null'
    )
  if (
    value.containerLineageId !== null &&
    (typeof value.containerLineageId !== 'string' ||
      value.containerLineageId.length === 0)
  )
    throw new OrderedCorrespondenceError(
      'wrong-owner',
      'ordered collection container lineage must be a nonempty string or null'
    )
  if (
    value.targetOwnerLineageId !== null &&
    (typeof value.targetOwnerLineageId !== 'string' ||
      value.targetOwnerLineageId.length === 0)
  )
    throw new OrderedCorrespondenceError(
      'wrong-owner',
      'ordered collection target owner lineage must be a nonempty string or null'
    )
  if (
    expected?.collectionKind !== undefined &&
    value.collectionKind !== expected.collectionKind
  )
  {
    throw new OrderedCorrespondenceError(
      'wrong-kind',
      `expected ${expected.collectionKind}, received ${value.collectionKind}`
    )
  }
  if (
    expected?.collectionPath !== undefined &&
    value.collectionPath !== expected.collectionPath
  )
  {
    throw new OrderedCorrespondenceError(
      'wrong-path',
      `correspondence belongs to the wrong collection path`
    )
  }
  if (
    expected !== undefined &&
    Object.hasOwn(expected, 'ownerLineageId') &&
    value.ownerLineageId !== expected.ownerLineageId
  )
  {
    throw new OrderedCorrespondenceError(
      'wrong-owner',
      `correspondence belongs to the wrong collection owner`
    )
  }
  if (
    value.beforeLineageIds.some(
      (lineageId) => typeof lineageId !== 'string' || lineageId.length === 0
    ) ||
    value.afterLineageIds.some(
      (lineageId) => typeof lineageId !== 'string' || lineageId.length === 0
    )
  )
    throw new OrderedCorrespondenceError(
      'member-mismatch',
      'ordered collection lineage IDs must be nonempty strings'
    )
  if (!unique(value.beforeLineageIds) || !unique(value.afterLineageIds))
    throw new OrderedCorrespondenceError(
      'duplicate-lineage',
      'ordered collection lineage lists must be unique'
    )

  const beforeIndexes = new Set<number>()
  const afterIndexes = new Set<number>()
  const memberLineageIds = new Set<string>()
  const beforeToAfter = new Map<number, number>()
  const afterToBefore = new Map<number, number>()
  for (const member of value.members)
  {
    if (typeof member.lineageId !== 'string' || member.lineageId.length === 0)
      throw new OrderedCorrespondenceError(
        'member-mismatch',
        'correspondence member lineage ID must be a nonempty string'
      )
    validateIndex(member.beforeIndex, value.beforeLineageIds.length, 'before')
    validateIndex(member.afterIndex, value.afterLineageIds.length, 'after')
    if (member.beforeIndex === null && member.afterIndex === null)
      throw new OrderedCorrespondenceError(
        'member-mismatch',
        'correspondence member must exist on at least one side'
      )
    if (memberLineageIds.has(member.lineageId))
      throw new OrderedCorrespondenceError(
        'duplicate-lineage',
        `duplicate correspondence lineage: ${member.lineageId}`
      )
    memberLineageIds.add(member.lineageId)
    if (member.beforeIndex !== null)
    {
      if (beforeIndexes.has(member.beforeIndex))
        throw new OrderedCorrespondenceError(
          'duplicate-index',
          `duplicate before index: ${member.beforeIndex}`
        )
      beforeIndexes.add(member.beforeIndex)
      if (value.beforeLineageIds[member.beforeIndex] !== member.lineageId)
      {
        throw new OrderedCorrespondenceError(
          'member-mismatch',
          `before lineage does not match index ${member.beforeIndex}`
        )
      }
    }
    if (member.afterIndex !== null)
    {
      if (afterIndexes.has(member.afterIndex))
        throw new OrderedCorrespondenceError(
          'duplicate-index',
          `duplicate after index: ${member.afterIndex}`
        )
      afterIndexes.add(member.afterIndex)
      if (value.afterLineageIds[member.afterIndex] !== member.lineageId)
        throw new OrderedCorrespondenceError(
          'member-mismatch',
          `after lineage does not match index ${member.afterIndex}`
        )
    }
    if (member.beforeIndex !== null && member.afterIndex !== null)
    {
      beforeToAfter.set(member.beforeIndex, member.afterIndex)
      afterToBefore.set(member.afterIndex, member.beforeIndex)
    }
  }
  if (
    beforeIndexes.size !== value.beforeLineageIds.length ||
    afterIndexes.size !== value.afterLineageIds.length
  )
  {
    throw new OrderedCorrespondenceError(
      'incomplete',
      'correspondence must cover every before and after member exactly once'
    )
  }
  const expectedLineageIds = new Set([
    ...value.beforeLineageIds,
    ...value.afterLineageIds,
  ])
  if (
    expectedLineageIds.size !== memberLineageIds.size ||
    [...expectedLineageIds].some((id) => !memberLineageIds.has(id))
  )
  {
    throw new OrderedCorrespondenceError(
      'incomplete',
      'correspondence contains missing or extra lineage members'
    )
  }
  return {
    ...value,
    beforeLineageIds: [...value.beforeLineageIds],
    afterLineageIds: [...value.afterLineageIds],
    members: value.members.map((member) => ({ ...member })),
    beforeToAfter,
    afterToBefore,
  }
}

export function validateProjectOrderedCorrespondence(
  value: ProjectOrderedCorrespondence
): ProjectOrderedCorrespondence
{
  for (const [name, identity] of [
    ['before revision', value.beforeRevisionIdentity],
    ['after revision', value.afterRevisionIdentity],
  ] as const)
  {
    if (typeof identity !== 'string' || identity.length === 0)
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        `${name} identity must be a nonempty string`
      )
  }
  for (const [name, sha256] of [
    ['before semantic source', value.beforeSemanticSourceSha256],
    ['after semantic source', value.afterSemanticSourceSha256],
  ] as const)
  {
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256))
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        `${name} SHA-256 must be lowercase hexadecimal`
      )
  }
  const targets = value.targets
    ? validateOrderedCollectionCorrespondence(value.targets, {
        collectionKind: 'targets',
        collectionPath: '/targets',
        ownerLineageId: null,
      })
    : undefined
  if (
    targets &&
    (targets.beforeCollectionPath !== '/targets' ||
      targets.afterCollectionPath !== '/targets' ||
      targets.targetOwnerLineageId !== null ||
      targets.containerLineageId !== null)
  )
    throw new OrderedCorrespondenceError(
      'wrong-path',
      'target correspondence must bind /targets on both heads'
    )
  const paths = new Set<string>()
  const validatedGroups = {
    media: [] as ValidatedOrderedCollectionCorrespondence[],
    procedureParameters: [] as ValidatedOrderedCollectionCorrespondence[],
    procedureCallArguments: [] as ValidatedOrderedCollectionCorrespondence[],
  }
  const groups: readonly [
    keyof typeof validatedGroups,
    readonly OrderedCollectionCorrespondence[],
    readonly OrderedCollectionKind[],
  ][] = [
    ['media', value.media ?? [], ['costumes', 'sounds']],
    [
      'procedureParameters',
      value.procedureParameters ?? [],
      ['procedure-parameters'],
    ],
    [
      'procedureCallArguments',
      value.procedureCallArguments ?? [],
      ['procedure-call-arguments'],
    ],
  ]
  for (const [groupName, correspondences, allowedKinds] of groups)
  {
    for (const correspondence of correspondences)
    {
      if (correspondence.ownerLineageId === null)
        throw new OrderedCorrespondenceError(
          'wrong-owner',
          `${correspondence.collectionKind} correspondence requires an owner lineage`
        )
      if (!allowedKinds.includes(correspondence.collectionKind))
        throw new OrderedCorrespondenceError(
          'wrong-kind',
          `unexpected collection kind: ${correspondence.collectionKind}`
        )
      const mediaCollection =
        correspondence.collectionKind === 'costumes' ||
        correspondence.collectionKind === 'sounds'
      if (
        mediaCollection &&
        (correspondence.containerLineageId !== correspondence.ownerLineageId ||
          correspondence.targetOwnerLineageId !== correspondence.ownerLineageId)
      )
        throw new OrderedCorrespondenceError(
          'wrong-owner',
          'media correspondence container must be its target owner'
        )
      if (!mediaCollection && correspondence.containerLineageId === null)
        throw new OrderedCorrespondenceError(
          'wrong-owner',
          'procedure correspondence requires a prototype or call container lineage'
        )
      if (!mediaCollection && correspondence.targetOwnerLineageId === null)
        throw new OrderedCorrespondenceError(
          'wrong-owner',
          'procedure correspondence requires a target owner lineage'
        )
      if (paths.has(correspondence.collectionPath))
        throw new OrderedCorrespondenceError(
          'wrong-path',
          `duplicate ordered collection path: ${correspondence.collectionPath}`
        )
      paths.add(correspondence.collectionPath)
      validatedGroups[groupName].push(
        validateOrderedCollectionCorrespondence(correspondence)
      )
    }
  }
  return {
    beforeRevisionIdentity: value.beforeRevisionIdentity,
    afterRevisionIdentity: value.afterRevisionIdentity,
    beforeSemanticSourceSha256: value.beforeSemanticSourceSha256,
    afterSemanticSourceSha256: value.afterSemanticSourceSha256,
    ...(targets ? { targets } : {}),
    ...(validatedGroups.media.length > 0
      ? { media: validatedGroups.media }
      : {}),
    ...(validatedGroups.procedureParameters.length > 0
      ? { procedureParameters: validatedGroups.procedureParameters }
      : {}),
    ...(validatedGroups.procedureCallArguments.length > 0
      ? { procedureCallArguments: validatedGroups.procedureCallArguments }
      : {}),
  }
}
