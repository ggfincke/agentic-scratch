// packages/ir/src/edit/graph/comment-operations.ts
// apply exact comment text, attachment, removal, & workspace-layout mutations

import { isBlockEntry, type Comment } from '@scratch-agent/sb3'

import type { ProjectIR } from '../../project/project-ir.js'
import type {
  OptionalCollectionContainerStateV1,
  SemanticEditOperationV1,
} from '../contracts.generated.js'
import { semanticHashV1 } from '../contracts/hash-domains.js'
import { ownRecordKeys, ownRecordValue } from '../support/own-record.js'

export type CommentOperationV1 = Extract<
  SemanticEditOperationV1,
  { kind: `comment.${string}` }
>

interface ResolvedCommentOperationV1
{
  readonly operation: CommentOperationV1
  readonly targetIndex: number
  readonly commentId?: string
  readonly blockId?: string
}

interface CommentOperationResultV1
{
  readonly opId: string
  readonly operationKind: CommentOperationV1['kind']
  readonly commentId: string
  readonly targetIndex: number
}

function editError(code: string, message: string): Error
{
  return Object.assign(new Error(message), { code })
}

function target(project: ProjectIR, targetIndex: number)
{
  const value = project.json.targets[targetIndex]
  if (!value)
    throw editError('edit.selector_no_match', 'comment target is absent')
  return value
}

export function commentSemanticFingerprintV1(
  targetIndex: number,
  commentId: string,
  comment: Comment
): string
{
  const nullableState = (property: 'blockId' | 'x' | 'y') =>
    !Object.hasOwn(comment, property)
      ? { state: 'missing' as const }
      : comment[property] === null
        ? { state: 'null' as const }
        : { state: 'value' as const, value: comment[property]! }
  const optionalState = (property: 'width' | 'height' | 'minimized') =>
    !Object.hasOwn(comment, property)
      ? { state: 'missing' as const }
      : { state: 'value' as const, value: comment[property]! }
  return semanticHashV1('semantic-fingerprint', {
    entityKind: 'comment',
    targetIndex,
    commentId,
    text: comment.text,
    blockId: nullableState('blockId'),
    workspace: {
      x: nullableState('x'),
      y: nullableState('y'),
      width: optionalState('width'),
      height: optionalState('height'),
      minimized: optionalState('minimized'),
    },
  })
}

export function commentTextSha256V1(text: string): string
{
  return semanticHashV1('semantic-fingerprint', {
    entityKind: 'comment-text',
    text,
  })
}

export function commentMapStateV1(
  project: ProjectIR,
  targetIndex: number
): OptionalCollectionContainerStateV1
{
  const comments = target(project, targetIndex).comments
  if (comments === undefined) return { state: 'missing' }
  const entries = ownRecordKeys(comments)
    .sort()
    .map((commentId) =>
    {
      const comment = ownRecordValue(comments, commentId)!
      return {
        commentId,
        semanticFingerprint: commentSemanticFingerprintV1(
          targetIndex,
          commentId,
          comment
        ),
      }
    })
  return {
    state: 'present',
    expectedEntryCount: entries.length,
    expectedEntrySetSha256: semanticHashV1('semantic-fingerprint', {
      entityKind: 'comment-map-entry-set',
      targetIndex,
      entries,
    }),
  }
}

function exactState(
  left: OptionalCollectionContainerStateV1,
  right: OptionalCollectionContainerStateV1
): boolean
{
  if (left.state !== right.state) return false
  if (left.state === 'missing' || right.state === 'missing') return true
  return (
    left.expectedEntryCount === right.expectedEntryCount &&
    left.expectedEntrySetSha256 === right.expectedEntrySetSha256
  )
}

function requiredComment(
  project: ProjectIR,
  targetIndex: number,
  commentId: string | undefined
): Comment
{
  if (commentId === undefined)
    throw editError('edit.selector_no_match', 'comment ID is unresolved')
  const comment = ownRecordValue(
    target(project, targetIndex).comments,
    commentId
  )
  if (!comment) throw editError('edit.selector_no_match', 'comment is absent')
  return comment
}

function requiredBlock(
  project: ProjectIR,
  targetIndex: number,
  blockId: string | undefined
)
{
  if (blockId === undefined)
    throw editError('edit.selector_no_match', 'comment block is unresolved')
  const block = ownRecordValue(target(project, targetIndex).blocks, blockId)
  if (!isBlockEntry(block))
    throw editError('edit.selector_no_match', 'comment block is absent')
  return { block, blockId }
}

function clearReverseLink(
  project: ProjectIR,
  targetIndex: number,
  commentId: string,
  blockId: string | null | undefined
): void
{
  if (typeof blockId !== 'string') return
  const block = ownRecordValue(target(project, targetIndex).blocks, blockId)
  if (isBlockEntry(block) && block.comment === commentId) delete block.comment
}

function assertExactAttachment(
  project: ProjectIR,
  targetIndex: number,
  commentId: string,
  comment: Comment
): void
{
  const blocks = target(project, targetIndex).blocks
  const reverseLinks = ownRecordKeys(blocks)
    .filter((blockId) =>
    {
      const block = ownRecordValue(blocks, blockId)
      return isBlockEntry(block) && block.comment === commentId
    })
    .sort()
  const expected = typeof comment.blockId === 'string' ? [comment.blockId] : []
  if (
    reverseLinks.length !== expected.length ||
    reverseLinks.some((blockId, index) => blockId !== expected[index])
  )
    throw editError(
      'edit.reference_propagation_incomplete',
      'comment attachment and reverse link are inconsistent'
    )
}

function expectedOptional(
  value: number | boolean | null | undefined,
  expected: { state: string; value?: number | boolean }
): boolean
{
  if (expected.state === 'missing') return value === undefined
  if (expected.state === 'null') return value === null
  return expected.state === 'value' && Object.is(value, expected.value)
}

export function applyCommentOperationV1(
  project: ProjectIR,
  resolved: ResolvedCommentOperationV1
): CommentOperationResultV1
{
  const { operation, targetIndex } = resolved
  const owner = target(project, targetIndex)
  let commentId = resolved.commentId
  if (operation.kind === 'comment.add')
  {
    if (
      !exactState(
        commentMapStateV1(project, targetIndex),
        operation.expectedCommentMapState
      )
    )
      throw editError(
        'edit.planning_facts_mismatch',
        'comment map state changed'
      )
    const attachment =
      operation.attachment.kind === 'attached'
        ? requiredBlock(project, targetIndex, resolved.blockId)
        : null
    if (attachment?.block.comment !== undefined)
      throw editError(
        'edit.entity_still_referenced',
        'block already has a comment'
      )
    commentId = project.uids.next('comment')
    owner.comments ??= Object.create(null) as Record<string, Comment>
    owner.comments[commentId] = {
      blockId: attachment ? attachment.blockId : null,
      text: operation.text,
      x: operation.layout.x,
      y: operation.layout.y,
      width: operation.layout.width,
      height: operation.layout.height,
      minimized: operation.layout.minimized,
    }
    if (attachment) attachment.block.comment = commentId
  }
  else
  {
    const comment = requiredComment(project, targetIndex, commentId)
    assertExactAttachment(project, targetIndex, commentId!, comment)
    if (operation.kind === 'comment.updateText')
    {
      if (commentTextSha256V1(comment.text) !== operation.expectedTextSha256)
        throw editError('edit.fingerprint_mismatch', 'comment text changed')
      comment.text = operation.text
    }
    else if (operation.kind === 'comment.move')
    {
      for (const edit of operation.edits)
      {
        if (!expectedOptional(comment[edit.property], edit.expected))
          throw editError(
            'edit.planning_facts_mismatch',
            'comment layout changed'
          )
        Object.assign(comment, { [edit.property]: edit.value })
      }
    }
    else if (operation.kind === 'comment.attach')
    {
      if (!operation.expectedDetached || comment.blockId != null)
        throw editError(
          'edit.planning_facts_mismatch',
          'comment is not detached'
        )
      const attachment = requiredBlock(project, targetIndex, resolved.blockId)
      if (attachment.block.comment !== undefined)
        throw editError(
          'edit.entity_still_referenced',
          'block already has a comment'
        )
      comment.blockId = attachment.blockId
      attachment.block.comment = commentId
    }
    else if (operation.kind === 'comment.detach')
    {
      const attachment = requiredBlock(project, targetIndex, resolved.blockId)
      if (comment.blockId !== attachment.blockId)
        throw editError(
          'edit.planning_facts_mismatch',
          'comment attachment changed'
        )
      clearReverseLink(project, targetIndex, commentId!, comment.blockId)
      comment.blockId = null
    }
    else
    {
      if (
        commentSemanticFingerprintV1(targetIndex, commentId!, comment) !==
        operation.expectedSemanticFingerprint
      )
        throw editError('edit.fingerprint_mismatch', 'comment changed')
      clearReverseLink(project, targetIndex, commentId!, comment.blockId)
      delete owner.comments![commentId!]
    }
  }
  const retained = ownRecordValue(owner.comments, commentId!)
  if (operation.kind === 'comment.remove')
  {
    if (retained !== undefined)
      throw editError('edit.postcondition_failed', 'removed comment remains')
    const reverseLinkRemains = ownRecordKeys(owner.blocks).some((blockId) =>
    {
      const block = ownRecordValue(owner.blocks, blockId)
      return isBlockEntry(block) && block.comment === commentId
    })
    if (reverseLinkRemains)
      throw editError(
        'edit.postcondition_failed',
        'removed comment still has a reverse link'
      )
  }
  else if (retained)
    assertExactAttachment(project, targetIndex, commentId!, retained)
  else throw editError('edit.postcondition_failed', 'edited comment is absent')
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    commentId: commentId!,
    targetIndex,
  }
}
