// packages/ir/src/edit/graph-primitives.ts
// index, validate, detach, attach, clone, & delete exact Scratch graph closures

import {
  defineScratchRecordValue,
  deleteScratchRecordValue,
  isBlockEntry,
  scratchRecordEntries,
  scratchRecordValue,
  type Block,
  type BlockEntry,
  type BlockInput,
  type Comment,
  type Target,
} from '@scratch-agent/sb3'

import type { Uids, UidSnapshot } from '../core/uid.js'
import { semanticHashV1 } from './hash-domains.js'
import {
  compareLexicalTextV1 as compareText,
  sameStringSetV1 as sameTextSet,
} from './lexical-order.js'

type GraphPrimitiveErrorCodeV1 =
  | 'edit.cardinality_mismatch'
  | 'edit.entity_still_referenced'
  | 'edit.fingerprint_mismatch'
  | 'edit.graph_cycle'
  | 'edit.graph_failed'
  | 'edit.internal_invariant'
  | 'edit.invalid_move'
  | 'edit.invalid_owner'
  | 'edit.selector_no_match'

class GraphPrimitiveErrorV1 extends Error
{
  constructor(
    readonly code: GraphPrimitiveErrorCodeV1,
    message: string,
    readonly blockId?: string
  )
  {
    super(message)
    this.name = 'GraphPrimitiveErrorV1'
  }
}

interface GraphNextEdgeV1
{
  readonly kind: 'next'
  readonly ownerBlockId: string
}

interface GraphInputEdgeV1
{
  readonly kind: 'input'
  readonly ownerBlockId: string
  readonly inputName: string
  readonly slotIndex: number
}

type GraphInboundEdgeV1 = GraphNextEdgeV1 | GraphInputEdgeV1

interface BlockGraphIndexV1
{
  readonly blocksById: ReadonlyMap<string, Block>
  readonly inboundByBlockId: ReadonlyMap<string, readonly GraphInboundEdgeV1[]>
  readonly danglingEdges: readonly {
    readonly targetBlockId: string
    readonly edge: GraphInboundEdgeV1
  }[]
}

type GraphClosureKindV1 = 'script' | 'ownedBlock' | 'ownedSequence'

export interface GraphClosurePlanV1
{
  readonly kind: GraphClosureKindV1
  readonly rootBlockId: string
  readonly orderedBlockIds: readonly string[]
  readonly closureSha256: string
  readonly rootInboundEdge: GraphInboundEdgeV1 | null
  readonly rootSuccessorBlockId: string | null
  readonly attachedCommentIds: readonly string[]
}

export interface GraphInstalledClosureV1
{
  readonly rootId: string
  readonly tailId: string
  readonly blocks: Readonly<Record<string, Block>>
  readonly blockIds: readonly string[]
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId?: Readonly<Record<string, string>>
  readonly allocatorEvidence?: {
    readonly before: UidSnapshot
    readonly after: UidSnapshot
    readonly allocatedIds: readonly string[]
  }
  readonly allocatorCandidate?: Uids
}

export function commitGraphAllocatorV1(
  uids: Uids,
  lowered: GraphInstalledClosureV1 | null
): void
{
  if (!lowered) return
  if (
    (lowered.allocatorCandidate === undefined) !==
    (lowered.allocatorEvidence === undefined)
  )
    return graphError(
      'edit.internal_invariant',
      'lowered allocator candidate and evidence must appear together'
    )
  if (lowered.allocatorCandidate) uids.commit(lowered.allocatorCandidate)
}

interface GraphClonePlanV1 extends GraphInstalledClosureV1
{
  readonly sourceToCloneBlockIds: Readonly<Record<string, string>>
  readonly sourceToCloneCommentIds: Readonly<Record<string, string>>
  readonly comments: Readonly<Record<string, Comment>>
}

function assertDetachedGraphClosureV1(
  lowered: GraphInstalledClosureV1
): void
{
  if (
    lowered.blockIds.length === 0 ||
    new Set(lowered.blockIds).size !== lowered.blockIds.length ||
    !lowered.blockIds.includes(lowered.rootId) ||
    !lowered.blockIds.includes(lowered.tailId)
  )
    return graphError(
      'edit.internal_invariant',
      'detached lowered closure declares an inconsistent block set'
    )
  const declared = new Set(lowered.blockIds)
  const inbound = new Map<string, string[]>()
  const adjacency = new Map<string, string[]>()
  const addEdge = (ownerId: string, childId: string): void =>
  {
    if (!declared.has(childId))
      return graphError(
        'edit.internal_invariant',
        `detached closure has an external graph edge to "${childId}"`,
        childId
      )
    const owners = inbound.get(childId)
    if (owners) owners.push(ownerId)
    else inbound.set(childId, [ownerId])
    const children = adjacency.get(ownerId)
    if (children) children.push(childId)
    else adjacency.set(ownerId, [childId])
  }
  for (const blockId of lowered.blockIds)
  {
    const entry = scratchRecordValue(lowered.blocks, blockId)
    if (!isBlockEntry(entry))
      return graphError(
        'edit.internal_invariant',
        `detached closure block "${blockId}" is absent`,
        blockId
      )
    if (typeof entry.next === 'string') addEdge(blockId, entry.next)
    for (const [, input] of scratchRecordEntries(entry.inputs))
      for (let index = 1; index < input.length; index++)
        if (typeof input[index] === 'string')
          addEdge(blockId, input[index] as string)
  }
  if ((inbound.get(lowered.rootId) ?? []).length !== 0)
    return graphError(
      'edit.internal_invariant',
      'detached closure root has an inbound edge',
      lowered.rootId
    )
  for (const blockId of lowered.blockIds)
  {
    if (blockId === lowered.rootId) continue
    const owners = inbound.get(blockId) ?? []
    const entry = scratchRecordValue(lowered.blocks, blockId)!
    if (
      owners.length !== 1 ||
      entry.parent !== owners[0] ||
      entry.topLevel === true
    )
      return graphError(
        'edit.internal_invariant',
        `detached block "${blockId}" is not uniquely owned`,
        blockId
      )
  }
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (blockId: string): void =>
  {
    if (active.has(blockId))
      return graphError(
        'edit.graph_cycle',
        `detached closure cycle reaches "${blockId}"`,
        blockId
      )
    if (visited.has(blockId)) return
    active.add(blockId)
    visited.add(blockId)
    for (const childId of adjacency.get(blockId) ?? []) visit(childId)
    active.delete(blockId)
  }
  visit(lowered.rootId)
  if (!sameTextSet(visited, declared))
    return graphError(
      'edit.internal_invariant',
      'detached closure contains unreachable declared blocks'
    )
}

function graphError(
  code: GraphPrimitiveErrorCodeV1,
  message: string,
  blockId?: string
): never
{
  throw new GraphPrimitiveErrorV1(code, message, blockId)
}

function edgeIdentity(edge: GraphInboundEdgeV1): string
{
  return edge.kind === 'next'
    ? `next:${edge.ownerBlockId}`
    : `input:${edge.ownerBlockId}:${edge.inputName}:${edge.slotIndex}`
}

function block(target: Target, blockId: string): Block
{
  const value = scratchRecordValue(target.blocks, blockId)
  if (!isBlockEntry(value))
    return graphError(
      'edit.selector_no_match',
      `block "${blockId}" is absent or is a top-level primitive`,
      blockId
    )
  return value
}

function addInbound(
  map: Map<string, GraphInboundEdgeV1[]>,
  blockId: string,
  edge: GraphInboundEdgeV1
): void
{
  const current = map.get(blockId)
  if (current) current.push(edge)
  else map.set(blockId, [edge])
}

function buildBlockGraphIndexV1(target: Target): BlockGraphIndexV1
{
  const blocksById = new Map<string, Block>()
  for (const [blockId, entry] of scratchRecordEntries(target.blocks))
    if (isBlockEntry(entry)) blocksById.set(blockId, entry)

  const inbound = new Map<string, GraphInboundEdgeV1[]>()
  const danglingEdges: {
    targetBlockId: string
    edge: GraphInboundEdgeV1
  }[] = []
  const register = (targetBlockId: string, edge: GraphInboundEdgeV1): void =>
  {
    if (blocksById.has(targetBlockId)) addInbound(inbound, targetBlockId, edge)
    else danglingEdges.push({ targetBlockId, edge })
  }

  for (const [ownerBlockId, owner] of blocksById)
  {
    if (typeof owner.next === 'string')
      register(owner.next, { kind: 'next', ownerBlockId })
    for (const [inputName, input] of scratchRecordEntries(owner.inputs))
      for (let slotIndex = 1; slotIndex < input.length; slotIndex++)
      {
        const value = input[slotIndex]
        if (typeof value === 'string')
          register(value, {
            kind: 'input',
            ownerBlockId,
            inputName,
            slotIndex,
          })
      }
  }

  for (const edges of inbound.values())
    edges.sort((left, right) =>
      compareText(edgeIdentity(left), edgeIdentity(right))
    )
  danglingEdges.sort((left, right) =>
    compareText(
      `${left.targetBlockId}:${edgeIdentity(left.edge)}`,
      `${right.targetBlockId}:${edgeIdentity(right.edge)}`
    )
  )
  return { blocksById, inboundByBlockId: inbound, danglingEdges }
}

function graphInboundEdgesV1(
  index: BlockGraphIndexV1,
  blockId: string
): readonly GraphInboundEdgeV1[]
{
  return index.inboundByBlockId.get(blockId) ?? []
}

function outgoingChildren(
  owner: Block,
  includeNext: boolean
): readonly { readonly blockId: string; readonly edge: GraphInboundEdgeV1 }[]
{
  const children: {
    blockId: string
    edge: GraphInboundEdgeV1
  }[] = []
  if (includeNext && typeof owner.next === 'string')
    children.push({
      blockId: owner.next,
      edge: { kind: 'next', ownerBlockId: '' },
    })
  for (const [inputName, input] of scratchRecordEntries(owner.inputs).sort(
    ([left], [right]) => compareText(left, right)
  ))
    for (let slotIndex = 1; slotIndex < input.length; slotIndex++)
    {
      const value = input[slotIndex]
      if (typeof value === 'string')
        children.push({
          blockId: value,
          edge: {
            kind: 'input',
            ownerBlockId: '',
            inputName,
            slotIndex,
          },
        })
    }
  return children
}

function attachedCommentIds(
  target: Target,
  blockIds: ReadonlySet<string>
): readonly string[]
{
  const commentIds = new Set<string>()
  for (const blockId of blockIds)
  {
    const owner = block(target, blockId)
    if (typeof owner.comment === 'string') commentIds.add(owner.comment)
  }
  for (const [commentId, comment] of scratchRecordEntries(target.comments))
    if (typeof comment.blockId === 'string' && blockIds.has(comment.blockId))
      commentIds.add(commentId)
  return [...commentIds].sort(compareText)
}

function assertCommentTopology(
  target: Target,
  blockIds: ReadonlySet<string>,
  commentIds: readonly string[]
): void
{
  for (const commentId of commentIds)
  {
    const comment = scratchRecordValue(target.comments, commentId)
    if (!comment || typeof comment.blockId !== 'string')
      return graphError(
        'edit.graph_failed',
        `comment "${commentId}" has no matching attached record`
      )
    if (!blockIds.has(comment.blockId))
      return graphError(
        'edit.graph_failed',
        `comment "${commentId}" points outside the selected closure`
      )
    const attached = block(target, comment.blockId)
    if (attached.comment !== commentId)
      return graphError(
        'edit.graph_failed',
        `comment "${commentId}" reverse link is inconsistent`,
        comment.blockId
      )
  }
  for (const blockId of blockIds)
  {
    const commentId = block(target, blockId).comment
    if (typeof commentId !== 'string') continue
    const comment = scratchRecordValue(target.comments, commentId)
    if (!comment || comment.blockId !== blockId)
      return graphError(
        'edit.graph_failed',
        `block "${blockId}" comment link is inconsistent`,
        blockId
      )
  }
}

function closureProjection(
  target: Target,
  kind: GraphClosureKindV1,
  rootBlockId: string,
  orderedBlockIds: readonly string[],
  commentIds: readonly string[]
): unknown
{
  return {
    schemaVersion: 1,
    kind,
    rootBlockId,
    blocks: orderedBlockIds.map((blockId) => ({
      blockId,
      value: scratchRecordValue(target.blocks, blockId),
    })),
    comments: commentIds.map((commentId) => ({
      commentId,
      value: scratchRecordValue(target.comments, commentId),
    })),
  }
}

export function planGraphClosureV1(
  target: Target,
  kind: GraphClosureKindV1,
  rootBlockId: string
): GraphClosurePlanV1
{
  const index = buildBlockGraphIndexV1(target)
  if (index.danglingEdges.length > 0)
    return graphError(
      'edit.graph_failed',
      'target graph contains a dangling block edge'
    )
  const root = block(target, rootBlockId)
  const rootInbound = graphInboundEdgesV1(index, rootBlockId)
  if (kind === 'script')
  {
    if (
      root.topLevel !== true ||
      root.shadow === true ||
      root.parent !== null ||
      rootInbound.length !== 0
    )
      return graphError(
        'edit.invalid_owner',
        'script root is not one exact top-level non-shadow block',
        rootBlockId
      )
  }
  else if (root.topLevel === true)
  {
    if (
      root.shadow === true ||
      root.parent !== null ||
      rootInbound.length !== 0
    )
      return graphError(
        'edit.invalid_owner',
        'top-level block root has invalid ownership',
        rootBlockId
      )
  }
  else if (
    root.shadow === true ||
    typeof root.parent !== 'string' ||
    rootInbound.length !== 1 ||
    rootInbound[0]!.ownerBlockId !== root.parent
  )
    return graphError(
      'edit.invalid_owner',
      'owned block root does not have one exact parent edge',
      rootBlockId
    )

  const orderedBlockIds: string[] = []
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (blockId: string, followNext: boolean): void =>
  {
    if (active.has(blockId))
      return graphError(
        'edit.graph_cycle',
        `block graph cycle reaches "${blockId}"`,
        blockId
      )
    if (visited.has(blockId))
      return graphError(
        'edit.invalid_owner',
        `block "${blockId}" is multiply reachable in one closure`,
        blockId
      )
    active.add(blockId)
    visited.add(blockId)
    orderedBlockIds.push(blockId)
    const owner = block(target, blockId)
    for (const child of outgoingChildren(owner, followNext))
    {
      const childBlock = block(target, child.blockId)
      const inboundEdges = graphInboundEdgesV1(index, child.blockId)
      if (
        inboundEdges.length !== 1 ||
        inboundEdges[0]!.ownerBlockId !== blockId ||
        childBlock.parent !== blockId ||
        childBlock.topLevel === true
      )
        return graphError(
          'edit.invalid_owner',
          `block "${child.blockId}" is not uniquely owned by "${blockId}"`,
          child.blockId
        )
      visit(child.blockId, true)
    }
    active.delete(blockId)
  }
  visit(rootBlockId, kind !== 'ownedBlock')

  const closure = new Set(orderedBlockIds)
  for (const blockId of orderedBlockIds)
  {
    if (blockId === rootBlockId) continue
    const inbound = graphInboundEdgesV1(index, blockId)
    if (inbound.some((edge) => !closure.has(edge.ownerBlockId)))
      return graphError(
        'edit.invalid_owner',
        `block "${blockId}" has an inbound edge outside its closure`,
        blockId
      )
  }
  const commentIds = attachedCommentIds(target, closure)
  assertCommentTopology(target, closure, commentIds)
  return {
    kind,
    rootBlockId,
    orderedBlockIds,
    closureSha256: semanticHashV1(
      'semantic-fingerprint',
      closureProjection(target, kind, rootBlockId, orderedBlockIds, commentIds)
    ),
    rootInboundEdge: rootInbound[0] ?? null,
    rootSuccessorBlockId:
      kind === 'ownedBlock' && typeof root.next === 'string' ? root.next : null,
    attachedCommentIds: commentIds,
  }
}

export function blockInputFingerprintV1(
  targetIndex: number,
  blockId: string,
  inputName: string,
  value: BlockInput | undefined
): string
{
  return semanticHashV1('semantic-fingerprint', {
    schemaVersion: 1,
    entityKind: 'block-input',
    targetIndex,
    blockId,
    inputName,
    value:
      value === undefined ? { state: 'missing' } : { state: 'value', value },
  })
}

export function blockFieldFingerprintV1(
  targetIndex: number,
  blockId: string,
  fieldName: string,
  value: unknown
): string
{
  return semanticHashV1('semantic-fingerprint', {
    schemaVersion: 1,
    entityKind: 'block-field',
    targetIndex,
    blockId,
    fieldName,
    value:
      value === undefined ? { state: 'missing' } : { state: 'value', value },
  })
}

export function inputShadowFingerprintV1(
  targetIndex: number,
  blockId: string,
  inputName: string,
  value: BlockInput[1] | BlockInput[2] | undefined
): string
{
  return semanticHashV1('semantic-fingerprint', {
    schemaVersion: 1,
    entityKind: 'block-input-shadow',
    targetIndex,
    blockId,
    inputName,
    value:
      value === undefined ? { state: 'missing' } : { state: 'value', value },
  })
}

export function commentSetSha256V1(
  target: Target,
  commentIds: readonly string[]
): string
{
  const unique = [...new Set(commentIds)].sort(compareText)
  return semanticHashV1('semantic-fingerprint', {
    schemaVersion: 1,
    entityKind: 'attached-comment-set',
    comments: unique.map((commentId) => ({
      commentId,
      value: scratchRecordValue(target.comments, commentId),
    })),
  })
}

export function rewriteInboundEdgeV1(
  target: Target,
  edge: GraphInboundEdgeV1,
  expectedBlockId: string,
  replacementBlockId: string | null
): void
{
  const owner = block(target, edge.ownerBlockId)
  if (edge.kind === 'next')
  {
    if (owner.next !== expectedBlockId)
      return graphError(
        'edit.graph_failed',
        'next ownership edge changed before rewrite',
        expectedBlockId
      )
    owner.next = replacementBlockId
    return
  }
  const input = scratchRecordValue(owner.inputs, edge.inputName)
  if (!input || input[edge.slotIndex] !== expectedBlockId)
    return graphError(
      'edit.graph_failed',
      'input ownership edge changed before rewrite',
      expectedBlockId
    )
  input[edge.slotIndex] = replacementBlockId
}

export function installGraphClosureV1(
  target: Target,
  lowered: GraphInstalledClosureV1
): void
{
  assertDetachedGraphClosureV1(lowered)
  for (const blockId of lowered.blockIds)
  {
    if (scratchRecordValue(target.blocks, blockId) !== undefined)
      return graphError(
        'edit.cardinality_mismatch',
        `lowered block ID "${blockId}" already exists`,
        blockId
      )
    const value = scratchRecordValue(lowered.blocks, blockId)
    if (!isBlockEntry(value))
      return graphError(
        'edit.internal_invariant',
        `lowered block "${blockId}" is absent`,
        blockId
      )
  }
  for (const blockId of lowered.blockIds)
    defineScratchRecordValue<BlockEntry>(
      target.blocks,
      blockId,
      structuredClone(scratchRecordValue(lowered.blocks, blockId)!)
    )
}

export function deleteGraphClosureV1(
  target: Target,
  plan: GraphClosurePlanV1
): void
{
  for (const blockId of plan.orderedBlockIds)
    if (!deleteScratchRecordValue(target.blocks, blockId))
      return graphError(
        'edit.graph_failed',
        `block "${blockId}" vanished before deletion`,
        blockId
      )
}

function remapBlockInput(
  input: BlockInput,
  blockIds: ReadonlyMap<string, string>
): BlockInput
{
  const clone = structuredClone(input)
  for (let index = 1; index < clone.length; index++)
  {
    const value = clone[index]
    if (typeof value !== 'string') continue
    const remapped = blockIds.get(value)
    if (!remapped)
      return graphError(
        'edit.invalid_owner',
        `closure contains an outgoing graph reference to "${value}"`,
        value
      )
    clone[index] = remapped
  }
  return clone
}

function translateCoordinate(
  value: number | null | undefined,
  delta: number
): number | null | undefined
{
  return typeof value === 'number' ? value + delta : value
}

export function cloneGraphClosureV1(
  target: Target,
  plan: GraphClosurePlanV1,
  uids: Uids,
  workspace: { readonly x: number; readonly y: number },
  commentLayout: 'rejectIfPresent' | 'preserveAbsolute' | 'translateWithRoot'
): GraphClonePlanV1
{
  if (plan.kind !== 'script')
    return graphError(
      'edit.internal_invariant',
      'only a complete script closure can be duplicated'
    )
  if (commentLayout === 'rejectIfPresent' && plan.attachedCommentIds.length > 0)
    return graphError(
      'edit.entity_still_referenced',
      'script duplication rejects attached comments'
    )
  const allocatorBefore = uids.snapshot()
  const allocator = uids.clone()
  const sourceRoot = block(target, plan.rootBlockId)
  let sourceTailId = plan.rootBlockId
  const topChain = new Set<string>()
  while (true)
  {
    if (topChain.has(sourceTailId))
      return graphError(
        'edit.graph_cycle',
        'script top-level statement chain is cyclic',
        sourceTailId
      )
    topChain.add(sourceTailId)
    const next = block(target, sourceTailId).next
    if (typeof next !== 'string') break
    sourceTailId = next
  }
  const deltaX = workspace.x - (sourceRoot.x ?? 0)
  const deltaY = workspace.y - (sourceRoot.y ?? 0)
  const blockIds = new Map<string, string>()
  for (const sourceId of plan.orderedBlockIds)
    blockIds.set(sourceId, allocator.next('b'))
  const commentIds = new Map<string, string>()
  if (commentLayout !== 'rejectIfPresent')
    for (const sourceId of plan.attachedCommentIds)
      commentIds.set(sourceId, allocator.next('comment'))

  const blocks = Object.create(null) as Record<string, Block>
  for (const sourceId of plan.orderedBlockIds)
  {
    const source = block(target, sourceId)
    const cloneId = blockIds.get(sourceId)!
    const clone = structuredClone(source)
    clone.next =
      typeof source.next === 'string'
        ? (blockIds.get(source.next) ?? null)
        : null
    clone.parent =
      typeof source.parent === 'string'
        ? (blockIds.get(source.parent) ?? null)
        : null
    if (sourceId === plan.rootBlockId)
    {
      clone.topLevel = true
      clone.parent = null
      clone.x = workspace.x
      clone.y = workspace.y
    }
    for (const [inputName, input] of scratchRecordEntries(source.inputs))
    {
      clone.inputs ??= Object.create(null) as Record<string, BlockInput>
      defineScratchRecordValue(
        clone.inputs,
        inputName,
        remapBlockInput(input, blockIds)
      )
    }
    if (typeof source.comment === 'string')
    {
      const cloneCommentId = commentIds.get(source.comment)
      if (!cloneCommentId)
        return graphError(
          'edit.internal_invariant',
          'comment clone mapping is incomplete',
          sourceId
        )
      clone.comment = cloneCommentId
    }
    defineScratchRecordValue(blocks, cloneId, clone)
  }

  const comments = Object.create(null) as Record<string, Comment>
  for (const sourceCommentId of plan.attachedCommentIds)
  {
    const source = scratchRecordValue(target.comments, sourceCommentId)
    const cloneCommentId = commentIds.get(sourceCommentId)
    if (!source || !cloneCommentId || typeof source.blockId !== 'string')
      return graphError(
        'edit.internal_invariant',
        'comment clone source is incomplete'
      )
    const clone = structuredClone(source)
    clone.blockId = blockIds.get(source.blockId)!
    if (commentLayout === 'translateWithRoot')
    {
      clone.x = translateCoordinate(source.x, deltaX)
      clone.y = translateCoordinate(source.y, deltaY)
    }
    defineScratchRecordValue(comments, cloneCommentId, clone)
  }
  const sourceToCloneBlockIds = Object.fromEntries(blockIds)
  const allocatedIds = [...blockIds.values(), ...commentIds.values()]
  const allocatorAfter = allocator.snapshot()
  const priorIds = new Set(allocatorBefore.usedIds)
  const reservedIds = allocatorAfter.usedIds.filter((id) => !priorIds.has(id))
  if (!sameTextSet(new Set(allocatedIds), new Set(reservedIds)))
    return graphError(
      'edit.internal_invariant',
      'clone allocator reservations differ from cloned entity ids'
    )
  return {
    rootId: blockIds.get(plan.rootBlockId)!,
    tailId: blockIds.get(sourceTailId)!,
    blocks,
    blockIds: plan.orderedBlockIds.map((blockId) => blockIds.get(blockId)!),
    aliasBlockIds: Object.freeze({}),
    sourceToCloneBlockIds,
    sourceToCloneCommentIds: Object.fromEntries(commentIds),
    comments,
    allocatorEvidence: {
      before: allocatorBefore,
      after: allocatorAfter,
      allocatedIds,
    },
    allocatorCandidate: allocator,
  }
}

export function installClonedCommentsV1(
  target: Target,
  clone: GraphClonePlanV1
): void
{
  const entries = scratchRecordEntries(clone.comments)
  if (entries.length === 0) return
  target.comments ??= Object.create(null) as Record<string, Comment>
  for (const [commentId, comment] of entries)
  {
    if (scratchRecordValue(target.comments, commentId) !== undefined)
      return graphError(
        'edit.cardinality_mismatch',
        `cloned comment ID "${commentId}" already exists`
      )
    defineScratchRecordValue(
      target.comments,
      commentId,
      structuredClone(comment)
    )
  }
}

export function deleteExactCommentsV1(
  target: Target,
  expectedCommentIds: readonly string[]
): void
{
  for (const commentId of expectedCommentIds)
  {
    const comment = scratchRecordValue(target.comments, commentId)
    if (!comment)
      return graphError(
        'edit.selector_no_match',
        `comment "${commentId}" is absent`
      )
    if (typeof comment.blockId === 'string')
    {
      const attached = block(target, comment.blockId)
      if (attached.comment !== commentId)
        return graphError(
          'edit.graph_failed',
          `comment "${commentId}" reverse link changed`
        )
      delete attached.comment
    }
    deleteScratchRecordValue(target.comments!, commentId)
  }
}

export function setTopLevelWorkspaceV1(
  target: Target,
  blockId: string,
  workspace: { readonly x: number; readonly y: number }
): void
{
  const root = block(target, blockId)
  root.topLevel = true
  root.parent = null
  root.x = workspace.x
  root.y = workspace.y
}

export function clearTopLevelWorkspaceV1(
  target: Target,
  blockId: string,
  parentBlockId: string
): void
{
  const root = block(target, blockId)
  root.topLevel = false
  root.parent = parentBlockId
  delete root.x
  delete root.y
}

export function graphBlockV1(target: Target, blockId: string): Block
{
  return block(target, blockId)
}
