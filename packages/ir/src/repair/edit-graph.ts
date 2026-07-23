// packages/ir/src/repair/edit-graph.ts
// validate & apply atomic edits to the raw Scratch block graph

import {
  deleteScratchRecordValue,
  isBlockEntry,
  scratchRecordEntries,
  scratchRecordValue,
  type Block,
  type Target,
} from '@scratch-agent/sb3'

type GraphEditErrorCode =
  | 'block-not-found'
  | 'statement-not-deletable'
  | 'statement-owner-invalid'
  | 'statement-successor-invalid'
  | 'input-closure-invalid'
  | 'comment-attached'

class GraphEditError extends Error
{
  constructor(
    readonly code: GraphEditErrorCode,
    message: string,
    readonly blockId: string
  )
  {
    super(message)
    this.name = 'GraphEditError'
  }
}

interface NextStatementOwner
{
  kind: 'next'
  blockId: string
}

interface SubstackStatementOwner
{
  kind: 'substack'
  blockId: string
  inputName: string
  slotIndex: number
}

type StatementOwner = NextStatementOwner | SubstackStatementOwner

interface StatementDeletionPlan
{
  statementId: string
  owner: StatementOwner
  successorBlockId: string | null
  deletedBlockIds: string[]
}

interface NextInboundEdge
{
  kind: 'next'
  blockId: string
}

interface InputInboundEdge
{
  kind: 'input'
  blockId: string
  inputName: string
  slotIndex: number
}

type InboundEdge = NextInboundEdge | InputInboundEdge
type InboundEdgeIndex = ReadonlyMap<string, readonly InboundEdge[]>

function requireBlock(
  target: Target,
  blockId: string,
  code: GraphEditErrorCode,
  context: string
): Block
{
  const block = scratchRecordValue(target.blocks, blockId)
  if (!isBlockEntry(block))
  {
    throw new GraphEditError(
      code,
      `${context}: block "${blockId}" not found`,
      blockId
    )
  }
  return block
}

function isSubstackName(name: string): boolean
{
  return /^SUBSTACK\d*$/.test(name)
}

function isHatOpcode(opcode: string): boolean
{
  return (
    opcode === 'control_start_as_clone' ||
    opcode === 'procedures_definition' ||
    /(^|_)when/.test(opcode)
  )
}

function buildInboundEdgeIndex(target: Target): InboundEdgeIndex
{
  const index = new Map<string, InboundEdge[]>()
  const add = (ownedId: string, edge: InboundEdge): void =>
  {
    const edges = index.get(ownedId)
    if (edges)
    {
      edges.push(edge)
      return
    }
    index.set(ownedId, [edge])
  }
  for (const [blockId, entry] of scratchRecordEntries(target.blocks))
  {
    if (!isBlockEntry(entry)) continue
    const block = entry
    if (typeof block.next === 'string')
    {
      add(block.next, { kind: 'next', blockId })
    }
    for (const [inputName, input] of scratchRecordEntries(block.inputs))
    {
      for (let slotIndex = 1; slotIndex < input.length; slotIndex++)
      {
        const ownedId = input[slotIndex]
        if (typeof ownedId === 'string')
        {
          add(ownedId, { kind: 'input', blockId, inputName, slotIndex })
        }
      }
    }
  }
  return index
}

function inboundEdges(
  index: InboundEdgeIndex,
  ownedId: string
): readonly InboundEdge[]
{
  return index.get(ownedId) ?? []
}

export function canInsertStatementsAfter(
  target: Target,
  blockId: string
): boolean
{
  const block = scratchRecordValue(target.blocks, blockId)
  if (!isBlockEntry(block) || block.shadow === true) return false
  if (block.topLevel === true)
  {
    return block.parent === null && isHatOpcode(block.opcode)
  }
  if (typeof block.parent !== 'string') return false
  const owners = inboundEdges(buildInboundEdgeIndex(target), blockId)
  if (owners.length !== 1 || owners[0]!.blockId !== block.parent) return false
  const owner = owners[0]!
  return (
    owner.kind === 'next' ||
    (isSubstackName(owner.inputName) && owner.slotIndex === 1)
  )
}

function statementOwner(
  target: Target,
  statementId: string,
  statement: Block,
  inbound: InboundEdgeIndex
): StatementOwner
{
  const parentId = statement.parent
  if (typeof parentId !== 'string')
  {
    throw new GraphEditError(
      'statement-owner-invalid',
      `delete statement "${statementId}": detached or top-level block`,
      statementId
    )
  }
  requireBlock(
    target,
    parentId,
    'statement-owner-invalid',
    `delete statement "${statementId}" parent`
  )

  const owners = inboundEdges(inbound, statementId)
  if (owners.length !== 1 || owners[0]!.blockId !== parentId)
  {
    throw new GraphEditError(
      'statement-owner-invalid',
      `delete statement "${statementId}": expected one parent ownership edge`,
      statementId
    )
  }

  const owner = owners[0]!
  if (owner.kind === 'next') return owner
  if (!isSubstackName(owner.inputName) || owner.slotIndex !== 1)
  {
    throw new GraphEditError(
      'statement-owner-invalid',
      `delete statement "${statementId}": input owner is not a first substack`,
      statementId
    )
  }
  return {
    kind: 'substack',
    blockId: owner.blockId,
    inputName: owner.inputName,
    slotIndex: owner.slotIndex,
  }
}

function validateSuccessor(
  target: Target,
  statementId: string,
  statement: Block,
  inbound: InboundEdgeIndex
): string | null
{
  const successorId = statement.next ?? null
  if (successorId === null) return null

  const successor = requireBlock(
    target,
    successorId,
    'statement-successor-invalid',
    `delete statement "${statementId}" successor`
  )
  const owners = inboundEdges(inbound, successorId)
  if (
    successor.parent !== statementId ||
    successor.topLevel === true ||
    owners.length !== 1 ||
    owners[0]!.kind !== 'next' ||
    owners[0]!.blockId !== statementId
  )
  {
    throw new GraphEditError(
      'statement-successor-invalid',
      `delete statement "${statementId}": successor ownership is malformed`,
      successorId
    )
  }
  return successorId
}

function inputClosure(
  target: Target,
  statementId: string,
  inbound: InboundEdgeIndex
): string[]
{
  const seen = new Set<string>([statementId])
  const closure = [statementId]

  const visit = (ownerId: string): void =>
  {
    const owner = requireBlock(
      target,
      ownerId,
      'input-closure-invalid',
      `delete statement "${statementId}" input closure`
    )
    for (const [inputName, input] of Object.entries(owner.inputs ?? {}))
    {
      if (isSubstackName(inputName))
      {
        throw new GraphEditError(
          'statement-not-deletable',
          `delete statement "${statementId}": substack input is not deletable`,
          ownerId
        )
      }
      for (let slotIndex = 1; slotIndex < input.length; slotIndex++)
      {
        const childId = input[slotIndex]
        if (typeof childId !== 'string') continue
        if (seen.has(childId))
        {
          throw new GraphEditError(
            'input-closure-invalid',
            `delete statement "${statementId}": input closure is cyclic or shared`,
            childId
          )
        }

        const child = requireBlock(
          target,
          childId,
          'input-closure-invalid',
          `delete statement "${statementId}" input closure`
        )
        const owners = inboundEdges(inbound, childId)
        if (
          child.parent !== ownerId ||
          child.next != null ||
          child.topLevel === true ||
          owners.length !== 1 ||
          owners[0]!.kind !== 'input' ||
          owners[0]!.blockId !== ownerId ||
          owners[0]!.inputName !== inputName ||
          owners[0]!.slotIndex !== slotIndex
        )
        {
          throw new GraphEditError(
            'input-closure-invalid',
            `delete statement "${statementId}": input block is not uniquely owned`,
            childId
          )
        }

        seen.add(childId)
        closure.push(childId)
        visit(childId)
      }
    }
  }

  visit(statementId)
  return closure
}

function rejectAttachedComments(target: Target, blockIds: string[]): void
{
  const closure = new Set(blockIds)
  for (const blockId of blockIds)
  {
    const block = scratchRecordValue(target.blocks, blockId)
    if (isBlockEntry(block) && block.comment != null)
    {
      throw new GraphEditError(
        'comment-attached',
        `delete statement "${blockIds[0]}": block "${blockId}" has a comment`,
        blockId
      )
    }
  }
  for (const [, comment] of scratchRecordEntries(target.comments))
  {
    if (typeof comment.blockId === 'string' && closure.has(comment.blockId))
    {
      throw new GraphEditError(
        'comment-attached',
        `delete statement "${blockIds[0]}": deletion closure has a comment`,
        comment.blockId
      )
    }
  }
}

function planStatementDeletionWithIndex(
  target: Target,
  statementId: string,
  inbound: InboundEdgeIndex
): StatementDeletionPlan
{
  const statement = requireBlock(
    target,
    statementId,
    'block-not-found',
    'delete statement'
  )
  if (
    statement.shadow === true ||
    statement.topLevel === true ||
    isHatOpcode(statement.opcode)
  )
  {
    throw new GraphEditError(
      'statement-not-deletable',
      `delete statement "${statementId}": hats, shadows & top-level blocks are protected`,
      statementId
    )
  }

  const owner = statementOwner(target, statementId, statement, inbound)
  const successorBlockId = validateSuccessor(
    target,
    statementId,
    statement,
    inbound
  )
  const deletedBlockIds = inputClosure(target, statementId, inbound)
  rejectAttachedComments(target, deletedBlockIds)
  return { statementId, owner, successorBlockId, deletedBlockIds }
}

function planStatementDeletion(
  target: Target,
  statementId: string
): StatementDeletionPlan
{
  return planStatementDeletionWithIndex(
    target,
    statementId,
    buildInboundEdgeIndex(target)
  )
}

function canDeleteStatementWithIndex(
  target: Target,
  statementId: string,
  inbound: InboundEdgeIndex
): boolean
{
  try
  {
    planStatementDeletionWithIndex(target, statementId, inbound)
    return true
  }
  catch (error)
  {
    if (error instanceof GraphEditError) return false
    throw error
  }
}

export function deletableStatementIds(
  target: Target,
  statementIds: readonly string[]
): ReadonlySet<string>
{
  const inbound = buildInboundEdgeIndex(target)
  const deletable = new Set<string>()
  for (const statementId of statementIds)
  {
    if (canDeleteStatementWithIndex(target, statementId, inbound))
    {
      deletable.add(statementId)
    }
  }
  return deletable
}

export function deleteStatement(
  target: Target,
  statementId: string
): StatementDeletionPlan
{
  const plan = planStatementDeletion(target, statementId)
  const blocks = structuredClone(target.blocks)
  const owner = scratchRecordValue(blocks, plan.owner.blockId)
  if (!isBlockEntry(owner))
  {
    throw new GraphEditError(
      'statement-owner-invalid',
      `delete statement "${statementId}": owner vanished during edit`,
      plan.owner.blockId
    )
  }

  if (plan.owner.kind === 'next')
  {
    owner.next = plan.successorBlockId
  }
  else
  {
    const input = scratchRecordValue(owner.inputs, plan.owner.inputName)
    if (!input || input[plan.owner.slotIndex] !== statementId)
    {
      throw new GraphEditError(
        'statement-owner-invalid',
        `delete statement "${statementId}": substack owner vanished during edit`,
        plan.owner.blockId
      )
    }
    input[plan.owner.slotIndex] = plan.successorBlockId
  }

  if (plan.successorBlockId !== null)
  {
    const successor = scratchRecordValue(blocks, plan.successorBlockId)
    if (!isBlockEntry(successor))
    {
      throw new GraphEditError(
        'statement-successor-invalid',
        `delete statement "${statementId}": successor vanished during edit`,
        plan.successorBlockId
      )
    }
    successor.parent = plan.owner.blockId
  }

  for (const blockId of plan.deletedBlockIds)
    deleteScratchRecordValue(blocks, blockId)
  target.blocks = blocks
  return plan
}
