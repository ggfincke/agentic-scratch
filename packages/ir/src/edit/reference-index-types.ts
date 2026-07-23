// packages/ir/src/edit/reference-index-types.ts
// stable semantic ownership, dependency, symbol, & script-index contracts

import type {
  BlockRef,
  BroadcastRef,
  DeclarationRef,
  ListRef,
  ScriptRef,
  TargetRef,
  VariableRef,
} from '../repair/repair-types.js'

export type InputChildSlot = 'primary' | 'shadow'

export type ReferenceCardinality = 'none' | 'unique' | 'ambiguous'

export type OwnershipStatus = 'unowned' | 'unique' | 'ambiguous'

export interface InputChildRef
{
  inputName: string
  slot: InputChildSlot
  block: BlockRef
}

export interface IndexedBlock
{
  ref: BlockRef
  opcode: string | null
  topScript: ScriptRef | null
  topScripts: readonly ScriptRef[]
  ownershipStatus: OwnershipStatus
  parent: BlockRef | null
  predecessor: BlockRef | null
  predecessors: readonly BlockRef[]
  predecessorStatus: ReferenceCardinality
  successor: BlockRef | null
  inputChildren: readonly InputChildRef[]
  topLevel: boolean
  shadow: boolean
  primitive: 'variable' | 'list' | null
}

export interface IndexedScript
{
  ref: ScriptRef
  top: BlockRef
  hat: BlockRef | null
  hatOpcode: string | null
  blockRefs: readonly BlockRef[]
  opcodes: readonly string[]
}

export type DeclarationAccess = 'read' | 'write' | 'read-write' | 'reference'

export type DeclarationUseSource =
  'field' | 'input-primitive' | 'top-level-primitive' | 'sensing-property'

export type DeclarationResolutionStatus =
  | 'resolved-id'
  | 'resolved-name'
  | 'resolved-sensing-name'
  | 'ambiguous-name'
  | 'ambiguous-sensing-name'
  | 'unresolved'

export type DeclarationResolutionSource =
  'local-id' | 'stage-id' | 'local-name' | 'stage-name' | 'target-name' | null

export interface DeclarationResolution
{
  declaration: DeclarationRef | null
  candidateDeclarations: readonly DeclarationRef[]
  resolutionStatus: DeclarationResolutionStatus
  resolutionSource: DeclarationResolutionSource
  displayNameMismatch: boolean
}

export interface DeclarationUse
{
  declaration: DeclarationRef | null
  candidateDeclarations: readonly DeclarationRef[]
  resolutionStatus: DeclarationResolutionStatus
  resolutionSource: DeclarationResolutionSource
  displayNameMismatch: boolean
  referencedKind: 'variable' | 'list'
  referencedId: string | null
  referencedName: string
  lookupTarget: TargetRef
  block: BlockRef
  script: ScriptRef | null
  access: DeclarationAccess
  source: DeclarationUseSource
  siteName: string | null
  inputSlotIndex: number | null
}

export type DynamicDeclarationNameReferenceReason =
  | 'reporter-computed-target'
  | 'missing-target-input'
  | 'ambiguous-target'
  | 'unresolved-target'
  | 'unsupported-target-literal'

export interface DynamicDeclarationNameReference
{
  declarationKind: 'variable'
  referencedName: string
  reason: DynamicDeclarationNameReferenceReason
  block: BlockRef
  script: ScriptRef | null
  inputName: 'OBJECT'
  fieldName: 'PROPERTY'
}

export interface IndexedDeclaration<T extends VariableRef | ListRef>
{
  declaration: T
  readers: readonly DeclarationUse[]
  writers: readonly DeclarationUse[]
  references: readonly DeclarationUse[]
}

export type BroadcastUseSource =
  'field' | 'input-primitive' | 'menu' | 'dynamic'

export type BroadcastResolutionStatus =
  'resolved' | 'ambiguous' | 'unresolved' | 'dynamic'

export type BroadcastResolutionSource = 'id' | 'name' | null

export interface BroadcastResolution
{
  declaration: BroadcastRef | null
  idCandidateDeclaration: BroadcastRef | null
  candidateDeclarations: readonly BroadcastRef[]
  resolutionStatus: Exclude<BroadcastResolutionStatus, 'dynamic'>
  resolutionSource: BroadcastResolutionSource
  displayNameMismatch: boolean
  idNameMismatch: boolean
  normalizedName: string | null
}

export interface BroadcastUse
{
  declaration: BroadcastRef | null
  idCandidateDeclaration: BroadcastRef | null
  candidateDeclarations: readonly BroadcastRef[]
  resolutionStatus: BroadcastResolutionStatus
  resolutionSource: BroadcastResolutionSource
  displayNameMismatch: boolean
  idNameMismatch: boolean
  normalizedName: string | null
  referencedId: string | null
  referencedName: string | null
  direction: 'sender' | 'receiver'
  block: BlockRef
  script: ScriptRef | null
  source: BroadcastUseSource
  dynamic: boolean
  fieldName: string | null
  inputName: string | null
  inputSlotIndex: number | null
  path: string
}

export interface IndexedBroadcast
{
  declaration: BroadcastRef
  senders: readonly BroadcastUse[]
  receivers: readonly BroadcastUse[]
}

export interface IndexedProcedure
{
  target: TargetRef
  proccode: string
  definitions: readonly BlockRef[]
  prototypes: readonly BlockRef[]
  prototypeSourceOrder: readonly BlockRef[]
  calls: readonly BlockRef[]
  parameters: readonly IndexedProcedureParameter[] | null
  mutationIssues: readonly ProcedureMutationIssue[]
}

export interface IndexedProcedureParameter
{
  argumentId: string
  name: string
  defaultValue: string | number | boolean
  placeholder: 's' | 'b' | 'n'
  parameterIndex: number
}

export interface ProcedureMutationIssue
{
  block: BlockRef
  code: string
  message: string
}

export interface CommentRef
{
  target: TargetRef
  commentId: string
}

export type CommentAttachmentStatus =
  'detached' | 'resolved' | 'dangling' | 'ambiguous'

export interface IndexedComment
{
  ref: CommentRef
  text: string
  attachedBlock: BlockRef | null
  attachmentStatus: CommentAttachmentStatus
  script: ScriptRef | null
  reverseLinkedBlocks: readonly BlockRef[]
  reverseLinkStatus: ReferenceCardinality
}

export interface UnresolvedBlockCommentReference
{
  block: BlockRef
  commentId: string
}

export type MediaKind = 'costume' | 'sound'

export interface MediaRef
{
  target: TargetRef
  kind: MediaKind
  mediaIndex: number
  name: string
}

export interface IndexedMedia
{
  ref: MediaRef
  assetId: string
  dataFormat: string
  archivePath: string
  references: readonly MediaReference[]
}

export type MediaResolutionStatus =
  'resolved' | 'ambiguous' | 'unresolved' | 'order-sensitive' | 'dynamic'

export type MediaReferenceDomain = 'costume' | 'backdrop' | 'sound'

export type MediaOrderSelectorKind = 'ordinal' | 'next' | 'previous' | 'random'

export interface MediaOrderReference
{
  domain: MediaReferenceDomain
  kind: MediaKind
  target: TargetRef
  selectorKind: MediaOrderSelectorKind
  selectorValue: string | number | null
  oneBasedOrdinal: number | null
  media: MediaRef | null
  candidateMedia: readonly MediaRef[]
  block: BlockRef
  sourceBlock: BlockRef | null
  script: ScriptRef | null
  inputName: string | null
  fieldName: string | null
}

export type DynamicMediaSelectorReason =
  'reporter-computed' | 'missing-input' | 'unsupported-literal'

export interface DynamicMediaSelectorReference
{
  domain: MediaReferenceDomain
  kind: MediaKind
  target: TargetRef
  reason: DynamicMediaSelectorReason
  block: BlockRef
  sourceBlock: BlockRef | null
  script: ScriptRef | null
  inputName: string
  fieldName: string | null
}

export interface MediaReference
{
  domain: MediaReferenceDomain
  kind: MediaKind
  referencedName: string | null
  media: MediaRef | null
  candidateMedia: readonly MediaRef[]
  resolutionStatus: MediaResolutionStatus
  block: BlockRef
  sourceBlock: BlockRef | null
  script: ScriptRef | null
  inputName: string | null
  fieldName: string | null
  dynamic: boolean
}

export interface MonitorRef
{
  monitorIndex: number
  monitorId: string
}

export interface IndexedMonitor
{
  ref: MonitorRef
  opcode: string
  spriteName: string | null
  target: TargetRef | null
  candidateTargets: readonly TargetRef[]
  targetStatus: ReferenceCardinality
  declaration: DeclarationRef | null
  candidateDeclarations: readonly DeclarationRef[]
  declarationStatus: ReferenceCardinality
  declarationKind: 'variable' | 'list' | null
  parameterKeys: readonly string[]
  referencedName: string | null
  resolutionSource: DeclarationResolutionSource
  displayNameMismatch: boolean
}

export type SemanticInboundReferenceKind =
  | 'block-parent'
  | 'block-next'
  | 'block-input'
  | 'block-comment'
  | 'comment-attachment'
  | 'declaration-use'
  | 'broadcast-use'
  | 'procedure-definition'
  | 'procedure-prototype'
  | 'procedure-call'
  | 'media-use'
  | 'media-order-reference'
  | 'dynamic-media-selector'
  | 'sprite-reference'
  | 'dynamic-sprite-reference'
  | 'monitor-target'
  | 'monitor-declaration'

export interface SemanticInboundReference
{
  entityKey: string
  sourceEntityKey: string
  kind: SemanticInboundReferenceKind
  path: string
}

export type SpriteReferenceKind =
  | 'touching'
  | 'distance-to'
  | 'go-to'
  | 'point-towards'
  | 'clone'
  | 'attribute-of'

export type SpriteReferenceSourceStatus =
  'verified-parent' | 'detached-menu' | 'missing-parent' | 'parent-mismatch'

export type SpriteTargetResolutionStatus =
  'unique' | 'ambiguous' | 'special' | 'unresolved'

export interface SpriteReference
{
  kind: SpriteReferenceKind
  name: string
  block: BlockRef
  sourceBlock: BlockRef | null
  sourceStatus: SpriteReferenceSourceStatus
  script: ScriptRef | null
  fieldName: string
  targets: readonly TargetRef[]
  targetStatus: SpriteTargetResolutionStatus
  special: boolean
}

export type DynamicSpriteReferenceReason =
  'reporter-computed' | 'missing-input' | 'unsupported-literal'

export interface DynamicSpriteReference
{
  kind: SpriteReferenceKind
  reason: DynamicSpriteReferenceReason
  block: BlockRef
  sourceBlock: BlockRef | null
  script: ScriptRef | null
  inputName: string
}

export interface IndexedEventHat
{
  block: BlockRef
  script: ScriptRef
  opcode: string
}

export interface LocalizationIndexes
{
  targets: readonly TargetRef[]
  targetsByName: ReadonlyMap<string, readonly TargetRef[]>
  blocks: readonly IndexedBlock[]
  blockByKey: ReadonlyMap<string, IndexedBlock>
  blocksById: ReadonlyMap<string, readonly IndexedBlock[]>
  scripts: readonly IndexedScript[]
  scriptByKey: ReadonlyMap<string, IndexedScript>
  variables: readonly IndexedDeclaration<VariableRef>[]
  lists: readonly IndexedDeclaration<ListRef>[]
  declarationByKey: ReadonlyMap<
    string,
    IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>
  >
  declarationsById: ReadonlyMap<
    string,
    readonly (IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>)[]
  >
  declarationsInRuntimeOrder: readonly (
    IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>
  )[]
  unresolvedDeclarationUses: readonly DeclarationUse[]
  sensingDeclarationUses: readonly DeclarationUse[]
  dynamicDeclarationNameReferences: readonly DynamicDeclarationNameReference[]
  broadcasts: readonly IndexedBroadcast[]
  broadcastByKey: ReadonlyMap<string, IndexedBroadcast>
  broadcastsById: ReadonlyMap<string, readonly IndexedBroadcast[]>
  broadcastsByName: ReadonlyMap<string, readonly IndexedBroadcast[]>
  broadcastsInRuntimeOrder: readonly IndexedBroadcast[]
  unresolvedBroadcastUses: readonly BroadcastUse[]
  dynamicBroadcastSenders: readonly BroadcastUse[]
  procedures: readonly IndexedProcedure[]
  procedureByKey: ReadonlyMap<string, IndexedProcedure>
  unresolvedProcedureBlocks: readonly BlockRef[]
  comments: readonly IndexedComment[]
  commentByKey: ReadonlyMap<string, IndexedComment>
  unresolvedBlockCommentReferences: readonly UnresolvedBlockCommentReference[]
  media: readonly IndexedMedia[]
  mediaByKey: ReadonlyMap<string, IndexedMedia>
  mediaByName: ReadonlyMap<string, readonly IndexedMedia[]>
  mediaByArchivePath: ReadonlyMap<string, readonly IndexedMedia[]>
  unresolvedMediaReferences: readonly MediaReference[]
  mediaOrderReferences: readonly MediaOrderReference[]
  dynamicMediaSelectorReferences: readonly DynamicMediaSelectorReference[]
  monitors: readonly IndexedMonitor[]
  monitorByKey: ReadonlyMap<string, IndexedMonitor>
  monitorsById: ReadonlyMap<string, readonly IndexedMonitor[]>
  inboundReferencesByEntityKey: ReadonlyMap<
    string,
    readonly SemanticInboundReference[]
  >
  spriteReferences: readonly SpriteReference[]
  spriteReferencesByName: ReadonlyMap<string, readonly SpriteReference[]>
  dynamicSpriteReferences: readonly DynamicSpriteReference[]
  eventHats: readonly IndexedEventHat[]
}

export type SemanticReferenceIndex = LocalizationIndexes

export function targetKey(target: TargetRef): string
{
  return JSON.stringify([target.targetIndex, target.name, target.isStage])
}

export function blockKey(block: BlockRef): string
{
  return JSON.stringify([targetKey(block.target), block.blockId])
}

export function scriptKey(script: ScriptRef): string
{
  return JSON.stringify([targetKey(script.target), script.topBlockId])
}

export function declarationKey(declaration: DeclarationRef): string
{
  return JSON.stringify([
    declaration.kind,
    targetKey(declaration.declarationTarget),
    declaration.id,
  ])
}

export function procedureKey(target: TargetRef, proccode: string): string
{
  return JSON.stringify([targetKey(target), proccode])
}

export function commentKey(comment: CommentRef): string
{
  return JSON.stringify([
    'comment',
    targetKey(comment.target),
    comment.commentId,
  ])
}

export function mediaKey(media: MediaRef): string
{
  return JSON.stringify([media.kind, targetKey(media.target), media.mediaIndex])
}

export function monitorKey(monitor: MonitorRef): string
{
  return JSON.stringify(['monitor', monitor.monitorIndex, monitor.monitorId])
}
