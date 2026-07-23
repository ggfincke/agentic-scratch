// packages/ir/src/edit/reference-index.ts
// build deterministic semantic ownership, dependency, symbol, & script indexes

import type {
  BlockRef,
  BroadcastRef,
  DeclarationRef,
  ListRef,
  ScriptRef,
  TargetRef,
  VariableRef,
} from '../repair/repair-types.js'
import type { ProjectIR } from '../project/project-ir.js'
import { jsonPointerPart as pointerPart } from '../project/project-vocabulary.js'
import {
  isBlockEntry,
  primaryInputSlot,
  type Block,
  type BlockEntry,
  type BlockField,
  type InputPrimitive,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'

import {
  blockKey,
  commentKey,
  declarationKey,
  mediaKey,
  monitorKey,
  procedureKey,
  scriptKey,
  targetKey,
  type BroadcastUse,
  type BroadcastResolution,
  type DeclarationResolution,
  type DeclarationAccess,
  type DeclarationUse,
  type DynamicDeclarationNameReference,
  type DynamicDeclarationNameReferenceReason,
  type DynamicSpriteReference,
  type DynamicSpriteReferenceReason,
  type DynamicMediaSelectorReason,
  type DynamicMediaSelectorReference,
  type IndexedBlock,
  type IndexedBroadcast,
  type IndexedComment,
  type IndexedDeclaration,
  type IndexedEventHat,
  type IndexedMedia,
  type IndexedMonitor,
  type IndexedProcedure,
  type IndexedProcedureParameter,
  type IndexedScript,
  type InputChildRef,
  type MediaKind,
  type MediaOrderReference,
  type MediaOrderSelectorKind,
  type MediaReference,
  type MediaReferenceDomain,
  type OwnershipStatus,
  type ProcedureMutationIssue,
  type ReferenceCardinality,
  type SemanticInboundReference,
  type SemanticReferenceIndex,
  type SpriteReference,
  type SpriteReferenceKind,
  type SpriteReferenceSourceStatus,
  type SpriteTargetResolutionStatus,
} from './reference-index-types.js'
import {
  DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS,
  parseStrictEditProcedureMutation,
  procedurePlaceholderKinds,
  StrictProcedureMutationError,
} from './procedure-mutation.js'
import { compareLexicalTextV1 as compareText } from './lexical-order.js'
import { ownRecordKeys, ownRecordValue } from './own-record.js'
import { TARGET_NAME_REFERENCE_DESCRIPTORS_V1 } from './target-reference-catalog.js'

interface MutableDeclaration<T extends VariableRef | ListRef>
{
  declaration: T
  readers: DeclarationUse[]
  writers: DeclarationUse[]
  references: DeclarationUse[]
}

interface MutableBroadcast
{
  declaration: BroadcastRef
  senders: BroadcastUse[]
  receivers: BroadcastUse[]
}

interface MutableMedia extends Omit<IndexedMedia, 'references'>
{
  references: MediaReference[]
}

interface MutableProcedure
{
  target: TargetRef
  proccode: string
  definitions: BlockRef[]
  prototypes: BlockRef[]
  prototypeSourceOrder: BlockRef[]
  calls: BlockRef[]
  parameters: IndexedProcedureParameter[] | null
  mutationIssues: ProcedureMutationIssue[]
}

interface ReferenceIndexProject
{
  readonly json: ProjectJson
}

interface OrderedBlockEntry
{
  readonly blockId: string
  readonly entry: BlockEntry
}

interface OrderedSemanticBlockEntry extends OrderedBlockEntry
{
  readonly entry: Block
}

function isOrderedSemanticBlockEntry(
  value: OrderedBlockEntry
): value is OrderedSemanticBlockEntry
{
  return isBlockEntry(value.entry)
}

// a unique procedure pair is authorable only when its ownership edges match
// the exact Scratch definition -> prototype shape the semantic editor emits
export function procedureHasExactAuthorableTopologyV1(
  index: SemanticReferenceIndex,
  procedure: IndexedProcedure
): boolean
{
  if (procedure.definitions.length !== 1 || procedure.prototypes.length !== 1)
    return false
  const definition = procedure.definitions[0]!
  const prototype = procedure.prototypes[0]!
  const indexedDefinition = index.blockByKey.get(blockKey(definition))
  const indexedPrototype = index.blockByKey.get(blockKey(prototype))
  const customBlockLinks = indexedDefinition?.inputChildren.filter(
    (child) => child.inputName === 'custom_block'
  )
  return (
    indexedDefinition !== undefined &&
    indexedPrototype !== undefined &&
    indexedDefinition.opcode === 'procedures_definition' &&
    indexedDefinition.topLevel &&
    indexedDefinition.parent === null &&
    indexedPrototype.opcode === 'procedures_prototype' &&
    customBlockLinks?.length === 1 &&
    customBlockLinks[0]!.slot === 'primary' &&
    blockKey(customBlockLinks[0]!.block) === blockKey(prototype) &&
    indexedPrototype.parent !== null &&
    blockKey(indexedPrototype.parent) === blockKey(definition) &&
    indexedPrototype.ownershipStatus === 'unique'
  )
}

const VARIABLE_WRITES = new Set(['data_setvariableto'])
const VARIABLE_READ_WRITES = new Set(['data_changevariableby'])
const VARIABLE_READS = new Set(['data_variable'])
const LIST_WRITES = new Set([
  'data_addtolist',
  'data_deleteoflist',
  'data_deletealloflist',
  'data_insertatlist',
  'data_replaceitemoflist',
])
const LIST_READS = new Set([
  'data_listcontents',
  'data_itemoflist',
  'data_itemnumoflist',
  'data_lengthoflist',
  'data_listcontainsitem',
])
const SPRITE_INPUT_SITES = TARGET_NAME_REFERENCE_DESCRIPTORS_V1.map((row) => ({
  ...row,
  kind: row.referenceKind as SpriteReferenceKind,
  specialNames: new Set(row.specialNames),
}))

const SPRITE_INPUT_BY_SOURCE_OPCODE: ReadonlyMap<
  string,
  (typeof SPRITE_INPUT_SITES)[number]
> = new Map(
  SPRITE_INPUT_SITES.map((site) => [site.sourceOpcode, site] as const)
)

const SPRITE_INPUT_BY_MENU_OPCODE: ReadonlyMap<
  string,
  (typeof SPRITE_INPUT_SITES)[number]
> = new Map(SPRITE_INPUT_SITES.map((site) => [site.menuOpcode, site] as const))

const MEDIA_INPUTS: ReadonlyMap<
  string,
  {
    inputName: string
    fieldName: string
    menuOpcode: string
    kind: MediaKind
    targetScope: 'self' | 'stage'
  }
> = new Map([
  [
    'looks_switchcostumeto',
    {
      inputName: 'COSTUME',
      fieldName: 'COSTUME',
      menuOpcode: 'looks_costume',
      kind: 'costume',
      targetScope: 'self',
    },
  ],
  [
    'looks_switchbackdropto',
    {
      inputName: 'BACKDROP',
      fieldName: 'BACKDROP',
      menuOpcode: 'looks_backdrops',
      kind: 'costume',
      targetScope: 'stage',
    },
  ],
  [
    'looks_switchbackdroptoandwait',
    {
      inputName: 'BACKDROP',
      fieldName: 'BACKDROP',
      menuOpcode: 'looks_backdrops',
      kind: 'costume',
      targetScope: 'stage',
    },
  ],
  [
    'sound_play',
    {
      inputName: 'SOUND_MENU',
      fieldName: 'SOUND_MENU',
      menuOpcode: 'sound_sounds_menu',
      kind: 'sound',
      targetScope: 'self',
    },
  ],
  [
    'sound_playuntildone',
    {
      inputName: 'SOUND_MENU',
      fieldName: 'SOUND_MENU',
      menuOpcode: 'sound_sounds_menu',
      kind: 'sound',
      targetScope: 'self',
    },
  ],
])

const FIXED_MEDIA_ORDER_OPERATIONS: ReadonlyMap<
  string,
  {
    domain: 'costume' | 'backdrop'
    kind: 'costume'
    targetScope: 'self' | 'stage'
    selectorKind: 'next'
  }
> = new Map([
  [
    'looks_nextcostume',
    {
      domain: 'costume',
      kind: 'costume',
      targetScope: 'self',
      selectorKind: 'next',
    },
  ],
  [
    'looks_nextbackdrop',
    {
      domain: 'backdrop',
      kind: 'costume',
      targetScope: 'stage',
      selectorKind: 'next',
    },
  ],
])

const STAGE_SENSING_PROPERTY_TOKENS = new Set([
  'background #',
  'backdrop #',
  'backdrop name',
  'volume',
])

const SPRITE_SENSING_PROPERTY_TOKENS = new Set([
  'x position',
  'y position',
  'direction',
  'costume #',
  'costume name',
  'size',
  'volume',
])

function sensingPropertyIsBuiltin(
  target: TargetRef,
  property: string
): boolean
{
  return (
    target.isStage
      ? STAGE_SENSING_PROPERTY_TOKENS
      : SPRITE_SENSING_PROPERTY_TOKENS
  ).has(property)
}

function targetRef(target: Target, targetIndex: number): TargetRef
{
  return { targetIndex, name: target.name, isStage: target.isStage }
}

function cardinality(length: number): ReferenceCardinality
{
  if (length === 0) return 'none'
  if (length === 1) return 'unique'
  return 'ambiguous'
}

function ownershipStatus(length: number): OwnershipStatus
{
  if (length === 0) return 'unowned'
  if (length === 1) return 'unique'
  return 'ambiguous'
}

function ref(target: TargetRef, blockId: string): BlockRef
{
  return { target, blockId }
}

function compareBlockRef(a: BlockRef, b: BlockRef): number
{
  return (
    a.target.targetIndex - b.target.targetIndex ||
    compareText(a.blockId, b.blockId)
  )
}

function addGrouped<K, V>(map: Map<K, V[]>, key: K, value: V): void
{
  const values = map.get(key)
  if (values) values.push(value)
  else map.set(key, [value])
}

interface DeclarationRecord
{
  declaration: VariableRef | ListRef
}

interface DeclarationResolutionLookup<T extends DeclarationRecord>
{
  readonly firstByTargetKindId: ReadonlyMap<string, T>
  readonly byTargetKindName: ReadonlyMap<string, readonly T[]>
}

function declarationResolutionKey(
  kind: 'variable' | 'list',
  targetIndex: number,
  value: string
): string
{
  return JSON.stringify([kind, targetIndex, value])
}

function buildDeclarationResolutionLookup<T extends DeclarationRecord>(
  declarationsInRuntimeOrder: readonly T[]
): DeclarationResolutionLookup<T>
{
  const firstByTargetKindId = new Map<string, T>()
  const byTargetKindName = new Map<string, T[]>()
  for (const record of declarationsInRuntimeOrder)
  {
    const { kind, declarationTarget, id, name } = record.declaration
    const idKey = declarationResolutionKey(
      kind,
      declarationTarget.targetIndex,
      id
    )
    if (!firstByTargetKindId.has(idKey)) firstByTargetKindId.set(idKey, record)
    addGrouped(
      byTargetKindName,
      declarationResolutionKey(kind, declarationTarget.targetIndex, name),
      record
    )
  }
  return { firstByTargetKindId, byTargetKindName }
}

interface ResolvedDeclarationRecord<
  T extends DeclarationRecord,
> extends DeclarationResolution
{
  record: T | undefined
  candidateRecords: readonly T[]
}

function resolveDeclarationRecords<T extends DeclarationRecord>(
  lookup: DeclarationResolutionLookup<T>,
  stageIndex: number,
  kind: 'variable' | 'list',
  targetIndex: number,
  id: string,
  name: string | null
): ResolvedDeclarationRecord<T>
{
  const localId = lookup.firstByTargetKindId.get(
    declarationResolutionKey(kind, targetIndex, id)
  )
  const stageId =
    localId || stageIndex < 0 || stageIndex === targetIndex
      ? undefined
      : lookup.firstByTargetKindId.get(
          declarationResolutionKey(kind, stageIndex, id)
        )
  const idRecord = localId ?? stageId
  if (idRecord)
  {
    return {
      record: idRecord,
      candidateRecords: [idRecord],
      declaration: idRecord.declaration,
      candidateDeclarations: [idRecord.declaration],
      resolutionStatus: 'resolved-id',
      resolutionSource: localId ? 'local-id' : 'stage-id',
      displayNameMismatch: name !== null && name !== idRecord.declaration.name,
    }
  }

  const localNames =
    name === null
      ? []
      : (lookup.byTargetKindName.get(
          declarationResolutionKey(kind, targetIndex, name)
        ) ?? [])
  const stageNames =
    localNames.length > 0 || stageIndex < 0 || stageIndex === targetIndex
      ? []
      : name === null
        ? []
        : (lookup.byTargetKindName.get(
            declarationResolutionKey(kind, stageIndex, name)
          ) ?? [])
  const nameRecords = localNames.length > 0 ? localNames : stageNames
  const record = nameRecords[0]
  if (!record)
  {
    return {
      record: undefined,
      candidateRecords: [],
      declaration: null,
      candidateDeclarations: [],
      resolutionStatus: 'unresolved',
      resolutionSource: null,
      displayNameMismatch: false,
    }
  }
  return {
    record,
    candidateRecords: nameRecords,
    declaration: record.declaration,
    candidateDeclarations: nameRecords.map((value) => value.declaration),
    resolutionStatus:
      nameRecords.length === 1 ? 'resolved-name' : 'ambiguous-name',
    resolutionSource: localNames.length > 0 ? 'local-name' : 'stage-name',
    displayNameMismatch: false,
  }
}

interface BroadcastRecord
{
  declaration: BroadcastRef
}

interface BroadcastResolutionLookup<T extends BroadcastRecord>
{
  readonly firstById: ReadonlyMap<string, T>
  readonly byLowerName: ReadonlyMap<string, readonly T[]>
}

function buildBroadcastResolutionLookup<T extends BroadcastRecord>(
  broadcastsInRuntimeOrder: readonly T[]
): BroadcastResolutionLookup<T>
{
  const firstById = new Map<string, T>()
  const byLowerName = new Map<string, T[]>()
  for (const record of broadcastsInRuntimeOrder)
  {
    if (!firstById.has(record.declaration.id))
      firstById.set(record.declaration.id, record)
    addGrouped(byLowerName, record.declaration.name.toLowerCase(), record)
  }
  return { firstById, byLowerName }
}

interface ResolvedBroadcastRecord<
  T extends BroadcastRecord,
> extends BroadcastResolution
{
  record: T | undefined
  candidateRecords: readonly T[]
}

function resolveBroadcastRecords<T extends BroadcastRecord>(
  lookup: BroadcastResolutionLookup<T>,
  id: string | null,
  name: string | null
): ResolvedBroadcastRecord<T>
{
  const idRecord = id === null ? undefined : lookup.firstById.get(id)
  const idNameMismatch =
    idRecord !== undefined &&
    name !== null &&
    name.toLowerCase() !== idRecord.declaration.name.toLowerCase()
  if (idRecord && !idNameMismatch)
  {
    const normalizedName =
      name !== null && name !== idRecord.declaration.name
        ? idRecord.declaration.name
        : null
    return {
      record: idRecord,
      candidateRecords: [idRecord],
      declaration: idRecord.declaration,
      idCandidateDeclaration: idRecord.declaration,
      candidateDeclarations: [idRecord.declaration],
      resolutionStatus: 'resolved',
      resolutionSource: 'id',
      displayNameMismatch: false,
      idNameMismatch: false,
      normalizedName,
    }
  }

  const lowerName = name?.toLowerCase() ?? null
  const nameRecords =
    lowerName === null ? [] : (lookup.byLowerName.get(lowerName) ?? [])
  const record = nameRecords[0]
  if (!record)
  {
    return {
      record: undefined,
      candidateRecords: [],
      declaration: null,
      idCandidateDeclaration: idRecord?.declaration ?? null,
      candidateDeclarations: [],
      resolutionStatus: 'unresolved',
      resolutionSource: null,
      displayNameMismatch: idNameMismatch,
      idNameMismatch,
      normalizedName: null,
    }
  }
  return {
    record,
    candidateRecords: nameRecords,
    declaration: record.declaration,
    idCandidateDeclaration: idRecord?.declaration ?? null,
    candidateDeclarations: nameRecords.map((value) => value.declaration),
    resolutionStatus: nameRecords.length === 1 ? 'resolved' : 'ambiguous',
    resolutionSource: 'name',
    displayNameMismatch: idNameMismatch,
    idNameMismatch,
    normalizedName:
      name === record.declaration.name ? null : record.declaration.name,
  }
}

const declarationResolutionLookupByIndex = new WeakMap<
  SemanticReferenceIndex,
  DeclarationResolutionLookup<IndexedDeclaration<VariableRef | ListRef>>
>()

const broadcastResolutionLookupByIndex = new WeakMap<
  SemanticReferenceIndex,
  BroadcastResolutionLookup<IndexedBroadcast>
>()

function broadcastResolutionLookupForIndex(
  index: SemanticReferenceIndex
): BroadcastResolutionLookup<IndexedBroadcast>
{
  const retained = broadcastResolutionLookupByIndex.get(index)
  if (retained) return retained
  const built = buildBroadcastResolutionLookup(index.broadcastsInRuntimeOrder)
  broadcastResolutionLookupByIndex.set(index, built)
  return built
}

function* orderedInputSlots(block: Block)
{
  for (const inputName of ownRecordKeys(block.inputs).sort())
  {
    const input = ownRecordValue(block.inputs, inputName)
    if (!input) continue
    for (
      let inputSlotIndex = 1;
      inputSlotIndex < input.length;
      inputSlotIndex++
    )
      yield { inputName, inputSlotIndex, slot: input[inputSlotIndex] }
  }
}

function inputChildren(target: TargetRef, block: Block): InputChildRef[]
{
  const children: InputChildRef[] = []
  for (const { inputName, inputSlotIndex, slot } of orderedInputSlots(block))
  {
    if (typeof slot !== 'string') continue
    children.push({
      inputName,
      slot: inputSlotIndex === 1 ? 'primary' : 'shadow',
      block: ref(target, slot),
    })
  }
  return children
}

function eventHat(opcode: string): boolean
{
  return (
    opcode.startsWith('event_when') ||
    opcode === 'control_start_as_clone' ||
    (opcode !== 'procedures_definition' && /when/i.test(opcode))
  )
}

function scriptTraversal(
  target: Target,
  script: ScriptRef,
  primaryOwners: Map<string, ScriptRef>,
  secondaryOwners: Map<string, ScriptRef>
): string[]
{
  const ordered: string[] = []
  const seen = new Set<string>()
  const pending = [script.topBlockId]
  while (pending.length > 0)
  {
    const blockId = pending.pop()!
    if (seen.has(blockId)) continue
    seen.add(blockId)
    ordered.push(blockId)
    const primaryOwner = primaryOwners.get(blockId)
    if (primaryOwner)
    {
      if (
        primaryOwner.topBlockId !== script.topBlockId &&
        !secondaryOwners.has(blockId)
      )
        secondaryOwners.set(blockId, script)
      // shared reachability already proves invalid ownership, so stop this branch
      continue
    }
    primaryOwners.set(blockId, script)
    const entry = ownRecordValue(target.blocks, blockId)
    if (!isBlockEntry(entry)) continue
    if (entry.next) pending.push(entry.next)
    const inputChildren: string[] = []
    for (const { slot } of orderedInputSlots(entry))
    {
      if (typeof slot === 'string') inputChildren.push(slot)
    }
    for (let index = inputChildren.length - 1; index >= 0; index--)
      pending.push(inputChildren[index]!)
  }
  return ordered
}

function collectScriptOwners(
  primaryOwners: ReadonlyMap<string, ScriptRef>,
  secondaryOwners: ReadonlyMap<string, ScriptRef>
): Map<string, ScriptRef[]>
{
  const owners = new Map<string, ScriptRef[]>()
  for (const [blockId, primaryOwner] of primaryOwners)
  {
    const secondaryOwner = secondaryOwners.get(blockId)
    owners.set(
      blockId,
      secondaryOwner ? [primaryOwner, secondaryOwner] : [primaryOwner]
    )
  }
  return owners
}

function declarationAccess(
  kind: 'variable' | 'list',
  opcode: string
): DeclarationAccess
{
  if (kind === 'variable')
  {
    if (VARIABLE_READ_WRITES.has(opcode)) return 'read-write'
    if (VARIABLE_WRITES.has(opcode)) return 'write'
    if (VARIABLE_READS.has(opcode)) return 'read'
    return 'reference'
  }
  if (LIST_WRITES.has(opcode)) return 'write'
  if (LIST_READS.has(opcode)) return 'read'
  return 'reference'
}

function primitiveDeclaration(
  value: InputPrimitive
): { kind: 'variable' | 'list'; name: string; id: string } | null
{
  if (value[0] !== 12 && value[0] !== 13) return null
  return {
    kind: value[0] === 12 ? 'variable' : 'list',
    name: String(value[1]),
    id: String(value[2]),
  }
}

function fieldDeclaration(
  name: string,
  field: BlockField
): { kind: 'variable' | 'list'; name: string; id: string } | null
{
  if (name !== 'VARIABLE' && name !== 'LIST') return null
  if (typeof field[1] !== 'string') return null
  return {
    kind: name === 'VARIABLE' ? 'variable' : 'list',
    name: String(field[0] ?? ''),
    id: field[1],
  }
}

function addDeclarationUse(
  use: DeclarationUse,
  declaration: MutableDeclaration<VariableRef | ListRef> | undefined,
  unresolved: DeclarationUse[]
): void
{
  if (!declaration)
  {
    unresolved.push(use)
    return
  }
  use.declaration = declaration.declaration
  declaration.references.push(use)
  if (use.access === 'read' || use.access === 'read-write')
    declaration.readers.push(use)
  if (use.access === 'write' || use.access === 'read-write')
    declaration.writers.push(use)
  if (
    use.resolutionStatus === 'ambiguous-name' ||
    use.resolutionStatus === 'ambiguous-sensing-name'
  )
    unresolved.push(use)
}

function addBroadcastUse(
  use: BroadcastUse,
  declaration: MutableBroadcast | undefined,
  unresolved: BroadcastUse[]
): void
{
  if (!declaration)
  {
    unresolved.push(use)
    return
  }
  use.declaration = declaration.declaration
  if (use.direction === 'sender') declaration.senders.push(use)
  else declaration.receivers.push(use)
  if (use.resolutionStatus === 'ambiguous') unresolved.push(use)
}

function scriptFor(
  block: BlockRef,
  blocks: ReadonlyMap<string, IndexedBlock>
): ScriptRef | null
{
  return blocks.get(blockKey(block))?.topScript ?? null
}

function targetMediaNameKey(
  target: TargetRef,
  kind: MediaKind,
  name: string
): string
{
  return JSON.stringify([target.targetIndex, kind, name])
}

function targetMediaKindKey(target: TargetRef, kind: MediaKind): string
{
  return JSON.stringify([target.targetIndex, kind])
}

function mediaArchivePath(media: {
  assetId: string
  dataFormat: string
  md5ext?: string
}): string
{
  return media.md5ext ?? `${media.assetId}.${media.dataFormat}`
}

function mediaReferenceDomain(
  kind: MediaKind,
  targetScope: 'self' | 'stage'
): MediaReferenceDomain
{
  if (kind === 'sound') return 'sound'
  return targetScope === 'stage' ? 'backdrop' : 'costume'
}

function mediaOrderSelector(
  domain: MediaReferenceDomain,
  value: string | number
): { kind: MediaOrderSelectorKind; oneBasedOrdinal: number | null } | null
{
  if (typeof value === 'string')
  {
    if (domain === 'costume' && value === 'next costume')
      return { kind: 'next', oneBasedOrdinal: null }
    if (domain === 'costume' && value === 'previous costume')
      return { kind: 'previous', oneBasedOrdinal: null }
    if (domain === 'backdrop' && value === 'next backdrop')
      return { kind: 'next', oneBasedOrdinal: null }
    if (domain === 'backdrop' && value === 'previous backdrop')
      return { kind: 'previous', oneBasedOrdinal: null }
    if (domain === 'backdrop' && value === 'random backdrop')
      return { kind: 'random', oneBasedOrdinal: null }
  }

  if (domain === 'sound')
  {
    const ordinal = Number.parseInt(String(value), 10)
    return Number.isNaN(ordinal)
      ? null
      : { kind: 'ordinal', oneBasedOrdinal: ordinal }
  }
  if (typeof value === 'string' && value.trim().length === 0) return null
  const ordinal = Number(value)
  return Number.isNaN(ordinal)
    ? null
    : { kind: 'ordinal', oneBasedOrdinal: ordinal }
}

function mediaIndexForOrdinal(
  domain: MediaReferenceDomain,
  oneBasedOrdinal: number,
  mediaLength: number
): number | null
{
  if (mediaLength === 0) return null
  let zeroBased =
    domain === 'sound' ? oneBasedOrdinal - 1 : Math.round(oneBasedOrdinal - 1)
  if (!Number.isFinite(zeroBased)) zeroBased = 0
  return zeroBased - Math.floor(zeroBased / mediaLength) * mediaLength
}

export function buildSemanticReferenceIndex(
  project: ProjectIR | ReferenceIndexProject
): SemanticReferenceIndex
{
  const targets = project.json.targets.map(targetRef)
  const blockEntriesByTarget = project.json.targets.map((target) =>
    ownRecordKeys(target.blocks).map((blockId) => ({
      blockId,
      entry: ownRecordValue(target.blocks, blockId)!,
    }))
  )
  const orderedBlockEntriesByTarget = blockEntriesByTarget.map((entries) =>
    [...entries].sort((left, right) =>
      left.blockId < right.blockId ? -1 : left.blockId > right.blockId ? 1 : 0
    )
  )
  const orderedSemanticBlocksByTarget = orderedBlockEntriesByTarget.map(
    (entries) => entries.filter(isOrderedSemanticBlockEntry)
  )
  const targetsByName = new Map<string, TargetRef[]>()
  for (const target of targets) addGrouped(targetsByName, target.name, target)

  const blocks: IndexedBlock[] = []
  const blockByKey = new Map<string, IndexedBlock>()
  const blocksById = new Map<string, IndexedBlock[]>()
  const scripts: IndexedScript[] = []
  const scriptByKey = new Map<string, IndexedScript>()
  const eventHats: IndexedEventHat[] = []

  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    const topIds = orderedSemanticBlocksByTarget[targetIndex]!.filter(
      ({ entry }) => entry.topLevel === true && entry.shadow !== true
    ).map(({ blockId }) => blockId)
    const traversals = new Map<string, readonly string[]>()
    const primaryOwners = new Map<string, ScriptRef>()
    const secondaryOwners = new Map<string, ScriptRef>()
    for (const topBlockId of topIds)
    {
      const script = { target: targetReference, topBlockId }
      traversals.set(
        topBlockId,
        scriptTraversal(target, script, primaryOwners, secondaryOwners)
      )
    }
    const owners = collectScriptOwners(primaryOwners, secondaryOwners)
    const predecessorsById = new Map<string, string[]>()
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      if (entry.next) addGrouped(predecessorsById, entry.next, blockId)
    }

    for (const { blockId, entry } of orderedBlockEntriesByTarget[
      targetIndex
    ]!)
    {
      const blockReference = ref(targetReference, blockId)
      const topScripts = owners.get(blockId) ?? []
      const predecessorIds = predecessorsById.get(blockId) ?? []
      const predecessors = predecessorIds.map((id) => ref(targetReference, id))
      const indexed: IndexedBlock = isBlockEntry(entry)
        ? {
            ref: blockReference,
            opcode: entry.opcode,
            topScript: topScripts.length === 1 ? topScripts[0]! : null,
            topScripts,
            ownershipStatus: ownershipStatus(topScripts.length),
            parent: entry.parent ? ref(targetReference, entry.parent) : null,
            predecessor: predecessors.length === 1 ? predecessors[0]! : null,
            predecessors,
            predecessorStatus: cardinality(predecessors.length),
            successor: entry.next ? ref(targetReference, entry.next) : null,
            inputChildren: inputChildren(targetReference, entry),
            topLevel: entry.topLevel === true,
            shadow: entry.shadow === true,
            primitive: null,
          }
        : {
            ref: blockReference,
            opcode: null,
            topScript: null,
            topScripts,
            ownershipStatus: ownershipStatus(topScripts.length),
            parent: null,
            predecessor: null,
            predecessors,
            predecessorStatus: cardinality(predecessors.length),
            successor: null,
            inputChildren: [],
            topLevel: true,
            shadow: false,
            primitive: entry[0] === 12 ? 'variable' : 'list',
          }
      blocks.push(indexed)
      blockByKey.set(blockKey(blockReference), indexed)
      addGrouped(blocksById, blockId, indexed)
    }

    for (const topBlockId of topIds)
    {
      const scriptReference = { target: targetReference, topBlockId }
      const top = blockByKey.get(blockKey(ref(targetReference, topBlockId)))!
      const scriptBlocks = traversals
        .get(topBlockId)!
        .map((id) => blockByKey.get(blockKey(ref(targetReference, id))))
        .filter((entry): entry is IndexedBlock => entry !== undefined)
      const hat = top.opcode && eventHat(top.opcode) ? top.ref : null
      const indexed: IndexedScript = {
        ref: scriptReference,
        top: top.ref,
        hat,
        hatOpcode: hat ? top.opcode : null,
        blockRefs: scriptBlocks.map((entry) => entry.ref),
        opcodes: scriptBlocks.flatMap((entry) =>
          entry.opcode === null ? [] : [entry.opcode]
        ),
      }
      scripts.push(indexed)
      scriptByKey.set(scriptKey(scriptReference), indexed)
      if (hat && top.opcode)
        eventHats.push({
          block: hat,
          script: scriptReference,
          opcode: top.opcode,
        })
    }
  }

  const variables: MutableDeclaration<VariableRef>[] = []
  const lists: MutableDeclaration<ListRef>[] = []
  const mutableDeclarations = new Map<
    string,
    MutableDeclaration<VariableRef | ListRef>
  >()
  const declarationsById = new Map<
    string,
    MutableDeclaration<VariableRef | ListRef>[]
  >()
  const stageIndex = project.json.targets.findIndex((target) => target.isStage)

  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const declarationTarget = targets[targetIndex]!
    for (const id of ownRecordKeys(target.variables).sort())
    {
      const variable = ownRecordValue(target.variables, id)
      if (!variable) continue
      const declaration: VariableRef = {
        kind: 'variable',
        declarationTarget,
        id,
        name: variable[0],
      }
      const indexed = { declaration, readers: [], writers: [], references: [] }
      variables.push(indexed)
      mutableDeclarations.set(declarationKey(declaration), indexed)
      addGrouped(declarationsById, id, indexed)
    }
    for (const id of ownRecordKeys(target.lists).sort())
    {
      const list = ownRecordValue(target.lists, id)
      if (!list) continue
      const declaration: ListRef = {
        kind: 'list',
        declarationTarget,
        id,
        name: list[0],
      }
      const indexed = { declaration, readers: [], writers: [], references: [] }
      lists.push(indexed)
      mutableDeclarations.set(declarationKey(declaration), indexed)
      addGrouped(declarationsById, id, indexed)
    }
  }

  const declarationsInRuntimeOrder: MutableDeclaration<
    VariableRef | ListRef
  >[] = []
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    for (const [kind, record] of [
      ['variable', target.variables],
      ['list', target.lists],
    ] as const)
    {
      for (const id of ownRecordKeys(record))
      {
        const indexed = mutableDeclarations.get(
          declarationKey({
            kind,
            declarationTarget: targets[targetIndex]!,
            id,
            name: '',
          } as DeclarationRef)
        )
        if (indexed) declarationsInRuntimeOrder.push(indexed)
      }
    }
  }
  const declarationResolutionLookup = buildDeclarationResolutionLookup(
    declarationsInRuntimeOrder
  )

  const unresolvedDeclarationUses: DeclarationUse[] = []
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedBlockEntriesByTarget[
      targetIndex
    ]!)
    {
      const blockReference = ref(targetReference, blockId)
      const script = scriptFor(blockReference, blockByKey)
      if (!isBlockEntry(entry))
      {
        const primitive = primitiveDeclaration(entry)
        if (!primitive) continue
        const resolution = resolveDeclarationRecords(
          declarationResolutionLookup,
          stageIndex,
          primitive.kind,
          targetIndex,
          primitive.id,
          primitive.name
        )
        addDeclarationUse(
          {
            declaration: resolution.declaration,
            candidateDeclarations: resolution.candidateDeclarations,
            resolutionStatus: resolution.resolutionStatus,
            resolutionSource: resolution.resolutionSource,
            displayNameMismatch: resolution.displayNameMismatch,
            referencedKind: primitive.kind,
            referencedId: primitive.id,
            referencedName: primitive.name,
            lookupTarget: targetReference,
            block: blockReference,
            script,
            access: 'read',
            source: 'top-level-primitive',
            siteName: null,
            inputSlotIndex: null,
          },
          resolution.record,
          unresolvedDeclarationUses
        )
        continue
      }

      for (const fieldName of ownRecordKeys(entry.fields).sort())
      {
        const field = ownRecordValue(entry.fields, fieldName)
        if (!field) continue
        const reference = fieldDeclaration(fieldName, field)
        if (!reference) continue
        const resolution = resolveDeclarationRecords(
          declarationResolutionLookup,
          stageIndex,
          reference.kind,
          targetIndex,
          reference.id,
          reference.name
        )
        addDeclarationUse(
          {
            declaration: resolution.declaration,
            candidateDeclarations: resolution.candidateDeclarations,
            resolutionStatus: resolution.resolutionStatus,
            resolutionSource: resolution.resolutionSource,
            displayNameMismatch: resolution.displayNameMismatch,
            referencedKind: reference.kind,
            referencedId: reference.id,
            referencedName: reference.name,
            lookupTarget: targetReference,
            block: blockReference,
            script,
            access: declarationAccess(reference.kind, entry.opcode),
            source: 'field',
            siteName: fieldName,
            inputSlotIndex: null,
          },
          resolution.record,
          unresolvedDeclarationUses
        )
      }
      for (const { inputName, inputSlotIndex, slot } of orderedInputSlots(
        entry
      ))
      {
        if (!Array.isArray(slot)) continue
        const reference = primitiveDeclaration(slot)
        if (!reference) continue
        const resolution = resolveDeclarationRecords(
          declarationResolutionLookup,
          stageIndex,
          reference.kind,
          targetIndex,
          reference.id,
          reference.name
        )
        addDeclarationUse(
          {
            declaration: resolution.declaration,
            candidateDeclarations: resolution.candidateDeclarations,
            resolutionStatus: resolution.resolutionStatus,
            resolutionSource: resolution.resolutionSource,
            displayNameMismatch: resolution.displayNameMismatch,
            referencedKind: reference.kind,
            referencedId: reference.id,
            referencedName: reference.name,
            lookupTarget: targetReference,
            block: blockReference,
            script,
            access: 'read',
            source: 'input-primitive',
            siteName: inputName,
            inputSlotIndex,
          },
          resolution.record,
          unresolvedDeclarationUses
        )
      }
    }
  }

  const mutableBroadcasts: MutableBroadcast[] = []
  const mutableBroadcastByKey = new Map<string, MutableBroadcast>()
  const mutableBroadcastsById = new Map<string, MutableBroadcast[]>()
  const mutableBroadcastsByName = new Map<string, MutableBroadcast[]>()
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    for (const id of ownRecordKeys(target.broadcasts).sort())
    {
      const name = ownRecordValue(target.broadcasts, id)
      if (name === undefined) continue
      const declaration: BroadcastRef = {
        kind: 'broadcast',
        declarationTarget: targets[targetIndex]!,
        id,
        name,
      }
      const indexed = { declaration, senders: [], receivers: [] }
      mutableBroadcasts.push(indexed)
      mutableBroadcastByKey.set(declarationKey(declaration), indexed)
      addGrouped(mutableBroadcastsById, id, indexed)
      addGrouped(mutableBroadcastsByName, declaration.name, indexed)
    }
  }

  const broadcastsInRuntimeOrder: MutableBroadcast[] = []
  if (stageIndex >= 0)
  {
    const stage = project.json.targets[stageIndex]!
    for (const id of ownRecordKeys(stage.broadcasts))
    {
      const indexed = mutableBroadcastByKey.get(
        declarationKey({
          kind: 'broadcast',
          declarationTarget: targets[stageIndex]!,
          id,
          name: '',
        })
      )
      if (indexed) broadcastsInRuntimeOrder.push(indexed)
    }
  }
  const broadcastResolutionLookup = buildBroadcastResolutionLookup(
    broadcastsInRuntimeOrder
  )

  const unresolvedBroadcastUses: BroadcastUse[] = []
  const dynamicBroadcastSenders: BroadcastUse[] = []
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      const blockReference = ref(targetReference, blockId)
      const script = scriptFor(blockReference, blockByKey)
      for (const fieldName of ownRecordKeys(entry.fields).sort())
      {
        if (
          fieldName !== 'BROADCAST_OPTION' ||
          (entry.opcode !== 'event_whenbroadcastreceived' &&
            entry.opcode !== 'event_broadcast_menu')
        )
          continue
        const field = ownRecordValue(entry.fields, fieldName)
        if (!field) continue
        const id = typeof field[1] === 'string' ? field[1] : null
        const name = String(field[0] ?? '')
        const resolution = resolveBroadcastRecords(
          broadcastResolutionLookup,
          id,
          name
        )
        const use: BroadcastUse = {
          declaration: resolution.declaration,
          idCandidateDeclaration: resolution.idCandidateDeclaration,
          candidateDeclarations: resolution.candidateDeclarations,
          resolutionStatus: resolution.resolutionStatus,
          resolutionSource: resolution.resolutionSource,
          displayNameMismatch: resolution.displayNameMismatch,
          idNameMismatch: resolution.idNameMismatch,
          normalizedName: resolution.normalizedName,
          referencedId: id,
          referencedName: name,
          direction:
            entry.opcode === 'event_whenbroadcastreceived'
              ? 'receiver'
              : 'sender',
          block: blockReference,
          script,
          source: entry.opcode === 'event_broadcast_menu' ? 'menu' : 'field',
          dynamic: false,
          fieldName,
          inputName: null,
          inputSlotIndex: null,
          path: `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/fields/${pointerPart(fieldName)}/0`,
        }
        addBroadcastUse(use, resolution.record, unresolvedBroadcastUses)
      }
      for (const { inputName, inputSlotIndex, slot } of orderedInputSlots(
        entry
      ))
      {
        if (!Array.isArray(slot) || slot[0] !== 11) continue
        const id = String(slot[2])
        const name = String(slot[1])
        const resolution = resolveBroadcastRecords(
          broadcastResolutionLookup,
          id,
          name
        )
        addBroadcastUse(
          {
            declaration: resolution.declaration,
            idCandidateDeclaration: resolution.idCandidateDeclaration,
            candidateDeclarations: resolution.candidateDeclarations,
            resolutionStatus: resolution.resolutionStatus,
            resolutionSource: resolution.resolutionSource,
            displayNameMismatch: resolution.displayNameMismatch,
            idNameMismatch: resolution.idNameMismatch,
            normalizedName: resolution.normalizedName,
            referencedId: id,
            referencedName: name,
            direction: 'sender',
            block: blockReference,
            script,
            source: 'input-primitive',
            dynamic: false,
            fieldName: null,
            inputName,
            inputSlotIndex,
            path: `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/inputs/${pointerPart(inputName)}/${inputSlotIndex}/1`,
          },
          resolution.record,
          unresolvedBroadcastUses
        )
      }
      if (
        entry.opcode === 'event_broadcast' ||
        entry.opcode === 'event_broadcastandwait'
      )
      {
        const input = ownRecordValue(entry.inputs, 'BROADCAST_INPUT')
        const slot = input ? primaryInputSlot(input) : null
        const menu =
          typeof slot === 'string'
            ? ownRecordValue(target.blocks, slot)
            : undefined
        if (
          (Array.isArray(slot) && slot[0] === 11) ||
          (isBlockEntry(menu) &&
            menu.opcode === 'event_broadcast_menu' &&
            ownRecordValue(menu.fields, 'BROADCAST_OPTION') !== undefined)
        )
          continue
        dynamicBroadcastSenders.push({
          declaration: null,
          idCandidateDeclaration: null,
          candidateDeclarations: [],
          resolutionStatus: 'dynamic',
          resolutionSource: null,
          displayNameMismatch: false,
          idNameMismatch: false,
          normalizedName: null,
          referencedId: null,
          referencedName: null,
          direction: 'sender',
          block: blockReference,
          script,
          source: 'dynamic',
          dynamic: true,
          fieldName: null,
          inputName: 'BROADCAST_INPUT',
          inputSlotIndex: null,
          path: `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/inputs/BROADCAST_INPUT`,
        })
      }
    }
  }

  const mutableProcedures = new Map<string, MutableProcedure>()
  const unresolvedProcedureBlocks: BlockRef[] = []
  const procedure = (target: TargetRef, proccode: string): MutableProcedure =>
  {
    const key = procedureKey(target, proccode)
    const existing = mutableProcedures.get(key)
    if (existing) return existing
    const created = {
      target,
      proccode,
      definitions: [],
      prototypes: [],
      prototypeSourceOrder: [],
      calls: [],
      parameters: null,
      mutationIssues: [],
    }
    mutableProcedures.set(key, created)
    return created
  }

  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      const blockReference = ref(targetReference, blockId)
      if (entry.opcode === 'procedures_prototype')
      {
        const proccode = entry.mutation?.proccode
        if (typeof proccode === 'string')
        {
          const indexed = procedure(targetReference, proccode)
          indexed.prototypes.push(blockReference)
          try
          {
            const parsed = parseStrictEditProcedureMutation(
              entry.mutation!,
              DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS
            )
            const placeholders = procedurePlaceholderKinds(proccode)
            const parameters = parsed.argumentIds.map(
              (argumentId, parameterIndex): IndexedProcedureParameter => ({
                argumentId,
                name: parsed.argumentNames[parameterIndex]!,
                defaultValue: parsed.argumentDefaults[parameterIndex]!,
                placeholder: placeholders[parameterIndex]!,
                parameterIndex,
              })
            )
            if (indexed.parameters === null) indexed.parameters = parameters
            else if (
              JSON.stringify(indexed.parameters) !== JSON.stringify(parameters)
            )
            {
              indexed.mutationIssues.push({
                block: blockReference,
                code: 'conflicting-prototype',
                message: 'procedure prototypes disagree on parameter metadata',
              })
            }
          }
          catch (error)
          {
            indexed.mutationIssues.push({
              block: blockReference,
              code:
                error instanceof StrictProcedureMutationError
                  ? error.code
                  : 'invalid-procedure-mutation',
              message:
                error instanceof Error
                  ? error.message
                  : 'procedure mutation is invalid',
            })
          }
        }
        else unresolvedProcedureBlocks.push(blockReference)
      }
      else if (entry.opcode === 'procedures_call')
      {
        const proccode = entry.mutation?.proccode
        if (typeof proccode === 'string')
          procedure(targetReference, proccode).calls.push(blockReference)
        else unresolvedProcedureBlocks.push(blockReference)
      }
      else if (entry.opcode === 'procedures_definition')
      {
        const input = ownRecordValue(entry.inputs, 'custom_block')
        const childId = input ? primaryInputSlot(input) : null
        const prototype =
          typeof childId === 'string'
            ? ownRecordValue(target.blocks, childId)
            : undefined
        const proccode =
          isBlockEntry(prototype) && prototype.opcode === 'procedures_prototype'
            ? prototype.mutation?.proccode
            : undefined
        if (typeof proccode === 'string')
          procedure(targetReference, proccode).definitions.push(blockReference)
        else unresolvedProcedureBlocks.push(blockReference)
      }
    }
  }

  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    for (const { blockId, entry } of blockEntriesByTarget[targetIndex]!)
    {
      if (!isBlockEntry(entry) || entry.opcode !== 'procedures_prototype')
        continue
      const proccode = entry.mutation?.proccode
      if (typeof proccode !== 'string') continue
      procedure(targets[targetIndex]!, proccode).prototypeSourceOrder.push(
        ref(targets[targetIndex]!, blockId)
      )
    }
  }

  const spriteReferences: SpriteReference[] = []
  const spriteReferencesByName = new Map<string, SpriteReference[]>()
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      const menu = SPRITE_INPUT_BY_MENU_OPCODE.get(entry.opcode)
      if (!menu) continue
      const field = ownRecordValue(entry.fields, menu.fieldName)
      if (!field) continue
      const name = String(field[0] ?? '')
      const blockReference = ref(targetReference, blockId)
      const parentReference = entry.parent
        ? ref(targetReference, entry.parent)
        : null
      const parent = parentReference
        ? blockByKey.get(blockKey(parentReference))
        : undefined
      const parentSite =
        parent?.opcode === null || parent?.opcode === undefined
          ? undefined
          : SPRITE_INPUT_BY_SOURCE_OPCODE.get(parent.opcode)
      const parentOwnsMenu =
        parent !== undefined &&
        parentSite !== undefined &&
        parentSite.menuOpcode === entry.opcode &&
        parent.inputChildren.some(
          (child) =>
            child.inputName === parentSite.inputName &&
            child.block.blockId === blockId
        )
      let sourceBlock: BlockRef | null = null
      let sourceStatus: SpriteReferenceSourceStatus
      if (!parentReference) sourceStatus = 'detached-menu'
      else if (!parent) sourceStatus = 'missing-parent'
      else if (!parentOwnsMenu) sourceStatus = 'parent-mismatch'
      else
      {
        sourceBlock = parentReference
        sourceStatus = 'verified-parent'
      }
      const specialNames =
        sourceStatus === 'verified-parent'
          ? parentSite!.specialNames
          : sourceStatus === 'detached-menu'
            ? menu.specialNames
            : new Set<string>()
      const special = specialNames.has(name)
      const matches = special
        ? []
        : (targetsByName.get(name) ?? []).filter((target) => !target.isStage)
      let targetStatus: SpriteTargetResolutionStatus
      if (special) targetStatus = 'special'
      else if (matches.length === 1) targetStatus = 'unique'
      else if (matches.length > 1) targetStatus = 'ambiguous'
      else targetStatus = 'unresolved'
      const reference: SpriteReference = {
        kind: menu.kind,
        name,
        block: blockReference,
        sourceBlock,
        sourceStatus,
        script: scriptFor(sourceBlock ?? blockReference, blockByKey),
        fieldName: menu.fieldName,
        targets: matches,
        targetStatus,
        special,
      }
      spriteReferences.push(reference)
      addGrouped(spriteReferencesByName, name, reference)
    }
  }

  const dynamicSpriteReferences: DynamicSpriteReference[] = []
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      const site = SPRITE_INPUT_BY_SOURCE_OPCODE.get(entry.opcode)
      if (!site) continue
      const input = ownRecordValue(entry.inputs, site.inputName)
      const slot = input ? primaryInputSlot(input) : null
      let sourceBlock: BlockRef | null = null
      let reason: DynamicSpriteReferenceReason | null = null
      if (typeof slot === 'string')
      {
        const child = ownRecordValue(target.blocks, slot)
        if (isBlockEntry(child)) sourceBlock = ref(targetReference, slot)
        if (isBlockEntry(child) && child.opcode === site.menuOpcode)
        {
          const field = ownRecordValue(child.fields, site.fieldName)
          if (typeof field?.[0] === 'string' || typeof field?.[0] === 'number')
            continue
          reason = 'unsupported-literal'
        }
        else reason = 'reporter-computed'
      }
      else if (Array.isArray(slot)) reason = 'unsupported-literal'
      else reason = 'missing-input'

      const blockReference = ref(targetReference, blockId)
      dynamicSpriteReferences.push({
        kind: site.kind,
        reason,
        block: blockReference,
        sourceBlock,
        script: scriptFor(blockReference, blockByKey),
        inputName: site.inputName,
      })
    }
  }

  const sensingDeclarationUses: DeclarationUse[] = []
  const dynamicDeclarationNameReferences: DynamicDeclarationNameReference[] = []
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      if (entry.opcode !== 'sensing_of') continue
      const propertyField = ownRecordValue(entry.fields, 'PROPERTY')
      if (
        typeof propertyField?.[0] !== 'string' &&
        typeof propertyField?.[0] !== 'number'
      )
        continue
      const referencedName = String(propertyField[0])
      const blockReference = ref(targetReference, blockId)
      const script = scriptFor(blockReference, blockByKey)
      const objectInput = ownRecordValue(entry.inputs, 'OBJECT')
      const objectSlot = objectInput ? primaryInputSlot(objectInput) : null
      let candidateTargets: readonly TargetRef[] = []
      let dynamicReason: DynamicDeclarationNameReferenceReason | null = null
      if (typeof objectSlot === 'string')
      {
        const menu = ownRecordValue(target.blocks, objectSlot)
        if (isBlockEntry(menu) && menu.opcode === 'sensing_of_object_menu')
        {
          const objectField = ownRecordValue(menu.fields, 'OBJECT')
          const objectName =
            typeof objectField?.[0] === 'string' ||
            typeof objectField?.[0] === 'number'
              ? String(objectField[0])
              : null
          if (objectName === '_stage_')
            candidateTargets = targets.filter((candidate) => candidate.isStage)
          else if (objectName !== null)
            candidateTargets = (targetsByName.get(objectName) ?? []).filter(
              (candidate) => !candidate.isStage
            )
          else dynamicReason = 'unsupported-target-literal'
        }
        else dynamicReason = 'reporter-computed-target'
      }
      else if (objectSlot === null) dynamicReason = 'missing-target-input'
      else dynamicReason = 'unsupported-target-literal'

      if (dynamicReason !== null)
      {
        dynamicDeclarationNameReferences.push({
          declarationKind: 'variable',
          referencedName,
          reason: dynamicReason,
          block: blockReference,
          script,
          inputName: 'OBJECT',
          fieldName: 'PROPERTY',
        })
        continue
      }
      if (candidateTargets.length !== 1)
      {
        dynamicDeclarationNameReferences.push({
          declarationKind: 'variable',
          referencedName,
          reason:
            candidateTargets.length === 0
              ? 'unresolved-target'
              : 'ambiguous-target',
          block: blockReference,
          script,
          inputName: 'OBJECT',
          fieldName: 'PROPERTY',
        })
        continue
      }
      const selectedTarget = candidateTargets[0]!
      if (sensingPropertyIsBuiltin(selectedTarget, referencedName)) continue
      const candidateRecords =
        declarationResolutionLookup.byTargetKindName.get(
          declarationResolutionKey(
            'variable',
            selectedTarget.targetIndex,
            referencedName
          )
        ) ?? []
      const selected =
        candidateRecords.length === 1 ? candidateRecords[0] : undefined
      sensingDeclarationUses.push({
        declaration: selected?.declaration ?? null,
        candidateDeclarations: candidateRecords.map(
          (value) => value.declaration
        ),
        resolutionStatus:
          candidateRecords.length === 1
            ? 'resolved-sensing-name'
            : candidateRecords.length > 1
              ? 'ambiguous-sensing-name'
              : 'unresolved',
        resolutionSource: candidateRecords.length > 0 ? 'target-name' : null,
        displayNameMismatch: false,
        referencedKind: 'variable',
        referencedId: null,
        referencedName,
        lookupTarget: selectedTarget,
        block: blockReference,
        script,
        access: 'read',
        source: 'sensing-property',
        siteName: 'PROPERTY',
        inputSlotIndex: null,
      })
    }
  }

  const indexedVariables = variables as IndexedDeclaration<VariableRef>[]
  const indexedLists = lists as IndexedDeclaration<ListRef>[]
  const declarationByKey = new Map<
    string,
    IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>
  >()
  for (const indexed of [...indexedVariables, ...indexedLists])
    declarationByKey.set(declarationKey(indexed.declaration), indexed)
  const indexedDeclarationsById = new Map<
    string,
    (IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>)[]
  >()
  for (const [id, values] of declarationsById)
  {
    indexedDeclarationsById.set(
      id,
      values as (
        IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>
      )[]
    )
  }
  const broadcasts = mutableBroadcasts as IndexedBroadcast[]
  const broadcastByKey = mutableBroadcastByKey as Map<string, IndexedBroadcast>
  const indexedBroadcastsByName = new Map<string, IndexedBroadcast[]>()
  for (const [name, values] of mutableBroadcastsByName)
    indexedBroadcastsByName.set(name, values as IndexedBroadcast[])
  const indexedBroadcastsById = new Map<string, IndexedBroadcast[]>()
  for (const [id, values] of mutableBroadcastsById)
    indexedBroadcastsById.set(id, values as IndexedBroadcast[])

  const procedures = [...mutableProcedures.values()].sort(
    (a, b) =>
      a.target.targetIndex - b.target.targetIndex ||
      compareText(a.proccode, b.proccode)
  )
  for (const indexed of procedures)
  {
    indexed.definitions.sort(compareBlockRef)
    indexed.prototypes.sort(compareBlockRef)
    indexed.calls.sort(compareBlockRef)
    indexed.mutationIssues.sort((a, b) => compareBlockRef(a.block, b.block))
  }

  const blockCommentLinks = new Map<string, BlockRef[]>()
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      if (typeof entry.comment !== 'string') continue
      addGrouped(
        blockCommentLinks,
        JSON.stringify([targetIndex, entry.comment]),
        ref(targets[targetIndex]!, blockId)
      )
    }
  }

  const comments: IndexedComment[] = []
  const commentByKey = new Map<string, IndexedComment>()
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    for (const commentId of ownRecordKeys(target.comments).sort())
    {
      const comment = ownRecordValue(target.comments, commentId)
      if (!comment) continue
      const commentReference = { target: targetReference, commentId }
      const attachedBlock =
        typeof comment.blockId === 'string'
          ? ref(targetReference, comment.blockId)
          : null
      const attachedIndex = attachedBlock
        ? blockByKey.get(blockKey(attachedBlock))
        : undefined
      const reverseLinkedBlocks =
        blockCommentLinks.get(JSON.stringify([targetIndex, commentId])) ?? []
      const indexed = {
        ref: commentReference,
        text: comment.text,
        attachedBlock,
        attachmentStatus:
          attachedBlock === null
            ? ('detached' as const)
            : attachedIndex
              ? ('resolved' as const)
              : ('dangling' as const),
        script: attachedIndex?.topScript ?? null,
        reverseLinkedBlocks,
        reverseLinkStatus: cardinality(reverseLinkedBlocks.length),
      }
      comments.push(indexed)
      commentByKey.set(commentKey(commentReference), indexed)
    }
  }
  const unresolvedBlockCommentReferences = [...blockCommentLinks.entries()]
    .filter(([key]) =>
    {
      const [targetIndex, commentId] = JSON.parse(key) as [number, string]
      return !commentByKey.has(
        commentKey({ target: targets[targetIndex]!, commentId })
      )
    })
    .flatMap(([key, blockReferences]) =>
    {
      const [, commentId] = JSON.parse(key) as [number, string]
      return blockReferences.map((block) => ({ block, commentId }))
    })

  const mutableMedia: MutableMedia[] = []
  const mutableMediaByKey = new Map<string, MutableMedia>()
  const mutableMediaByName = new Map<string, MutableMedia[]>()
  const mutableMediaByArchivePath = new Map<string, MutableMedia[]>()
  const mediaByTargetName = new Map<string, MutableMedia[]>()
  const mediaByTargetKind = new Map<string, MutableMedia[]>()
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    const addMedia = (
      kind: MediaKind,
      mediaIndex: number,
      value: {
        assetId: string
        dataFormat: string
        md5ext?: string
        name: string
      }
    ): void =>
    {
      const reference = {
        target: targetReference,
        kind,
        mediaIndex,
        name: value.name,
      }
      const indexed: MutableMedia = {
        ref: reference,
        assetId: value.assetId,
        dataFormat: value.dataFormat,
        archivePath: mediaArchivePath(value),
        references: [],
      }
      mutableMedia.push(indexed)
      mutableMediaByKey.set(mediaKey(reference), indexed)
      addGrouped(mutableMediaByName, value.name, indexed)
      addGrouped(mutableMediaByArchivePath, indexed.archivePath, indexed)
      addGrouped(
        mediaByTargetName,
        targetMediaNameKey(targetReference, kind, value.name),
        indexed
      )
      addGrouped(
        mediaByTargetKind,
        targetMediaKindKey(targetReference, kind),
        indexed
      )
    }
    target.costumes.forEach((value, index) => addMedia('costume', index, value))
    target.sounds.forEach((value, index) => addMedia('sound', index, value))
  }

  const unresolvedMediaReferences: MediaReference[] = []
  const mediaOrderReferences: MediaOrderReference[] = []
  const dynamicMediaSelectorReferences: DynamicMediaSelectorReference[] = []
  for (
    let targetIndex = 0;
    targetIndex < project.json.targets.length;
    targetIndex++
  )
  {
    const target = project.json.targets[targetIndex]!
    const targetReference = targets[targetIndex]!
    for (const { blockId, entry } of orderedSemanticBlocksByTarget[
      targetIndex
    ]!)
    {
      const blockReference = ref(targetReference, blockId)
      const script = scriptFor(blockReference, blockByKey)
      const fixedOrderOperation = FIXED_MEDIA_ORDER_OPERATIONS.get(entry.opcode)
      if (fixedOrderOperation)
      {
        const declarationTarget =
          fixedOrderOperation.targetScope === 'stage'
            ? targets.find((value) => value.isStage)
            : targetReference
        if (!declarationTarget) continue
        const orderReference: MediaOrderReference = {
          domain: fixedOrderOperation.domain,
          kind: fixedOrderOperation.kind,
          target: declarationTarget,
          selectorKind: fixedOrderOperation.selectorKind,
          selectorValue: null,
          oneBasedOrdinal: null,
          media: null,
          candidateMedia: [],
          block: blockReference,
          sourceBlock: null,
          script,
          inputName: null,
          fieldName: null,
        }
        mediaOrderReferences.push(orderReference)
        const indexedReference: MediaReference = {
          domain: fixedOrderOperation.domain,
          kind: fixedOrderOperation.kind,
          referencedName: null,
          media: null,
          candidateMedia: [],
          resolutionStatus: 'order-sensitive',
          block: blockReference,
          sourceBlock: null,
          script,
          inputName: null,
          fieldName: null,
          dynamic: false,
        }
        for (const indexed of mediaByTargetKind.get(
          targetMediaKindKey(declarationTarget, fixedOrderOperation.kind)
        ) ?? [])
          indexed.references.push(indexedReference)
        continue
      }
      const mediaSite = MEDIA_INPUTS.get(entry.opcode)
      if (!mediaSite) continue
      const input = ownRecordValue(entry.inputs, mediaSite.inputName)
      const slot = input ? primaryInputSlot(input) : null
      let sourceBlock: BlockRef | null = null
      let fieldName: string | null = null
      let selectorValue: string | number | null = null
      let dynamicReason: DynamicMediaSelectorReason | null = null
      if (typeof slot === 'string')
      {
        const menu = ownRecordValue(target.blocks, slot)
        if (isBlockEntry(menu)) sourceBlock = ref(targetReference, slot)
        const field =
          isBlockEntry(menu) && menu.opcode === mediaSite.menuOpcode
            ? ownRecordValue(menu.fields, mediaSite.fieldName)
            : undefined
        if (typeof field?.[0] === 'string' || typeof field?.[0] === 'number')
        {
          selectorValue = field[0]
          fieldName = mediaSite.fieldName
        }
        else dynamicReason = 'reporter-computed'
      }
      else if (Array.isArray(slot) && slot.length > 1)
      {
        if (
          slot[0] >= 4 &&
          slot[0] <= 10 &&
          (typeof slot[1] === 'string' || typeof slot[1] === 'number')
        )
          selectorValue = slot[1]
        else dynamicReason = 'unsupported-literal'
      }
      else dynamicReason = 'missing-input'

      const declarationTarget =
        mediaSite.targetScope === 'stage'
          ? targets.find((value) => value.isStage)
          : targetReference
      if (!declarationTarget) continue
      const domain = mediaReferenceDomain(mediaSite.kind, mediaSite.targetScope)
      const domainMedia =
        mediaByTargetKind.get(
          targetMediaKindKey(declarationTarget, mediaSite.kind)
        ) ?? []
      const baseReference = {
        domain,
        kind: mediaSite.kind,
        block: blockReference,
        sourceBlock,
        script,
        inputName: mediaSite.inputName,
        fieldName,
      }

      if (dynamicReason)
      {
        dynamicMediaSelectorReferences.push({
          ...baseReference,
          target: declarationTarget,
          reason: dynamicReason,
        })
        unresolvedMediaReferences.push({
          ...baseReference,
          referencedName: null,
          media: null,
          candidateMedia: [],
          resolutionStatus: 'dynamic',
          dynamic: true,
        })
        continue
      }

      const referencedName =
        typeof selectorValue === 'string' ? selectorValue : null
      const candidates =
        referencedName === null
          ? []
          : (mediaByTargetName.get(
              targetMediaNameKey(
                declarationTarget,
                mediaSite.kind,
                referencedName
              )
            ) ?? [])
      if (candidates.length > 0)
      {
        const indexedReference: MediaReference = {
          ...baseReference,
          referencedName,
          media: candidates[0]!.ref,
          candidateMedia: candidates.map((candidate) => candidate.ref),
          resolutionStatus: candidates.length === 1 ? 'resolved' : 'ambiguous',
          dynamic: false,
        }
        for (const candidate of candidates)
          candidate.references.push(indexedReference)
        if (candidates.length > 1)
          unresolvedMediaReferences.push(indexedReference)
        continue
      }

      const orderSelector = mediaOrderSelector(domain, selectorValue!)
      if (orderSelector)
      {
        const mediaIndex =
          orderSelector.oneBasedOrdinal === null
            ? null
            : mediaIndexForOrdinal(
                domain,
                orderSelector.oneBasedOrdinal,
                domainMedia.length
              )
        const selectedMedia =
          mediaIndex === null ? undefined : domainMedia[mediaIndex]
        mediaOrderReferences.push({
          ...baseReference,
          target: declarationTarget,
          selectorKind: orderSelector.kind,
          selectorValue: selectorValue!,
          oneBasedOrdinal: orderSelector.oneBasedOrdinal,
          media: selectedMedia?.ref ?? null,
          candidateMedia: selectedMedia ? [selectedMedia.ref] : [],
        })
        const indexedReference: MediaReference = {
          ...baseReference,
          referencedName,
          media: selectedMedia?.ref ?? null,
          candidateMedia: selectedMedia ? [selectedMedia.ref] : [],
          resolutionStatus: 'order-sensitive',
          dynamic: false,
        }
        for (const indexed of domainMedia)
          indexed.references.push(indexedReference)
        continue
      }

      unresolvedMediaReferences.push({
        ...baseReference,
        referencedName,
        media: null,
        candidateMedia: [],
        resolutionStatus: 'unresolved',
        dynamic: false,
      })
    }
  }

  const monitors: IndexedMonitor[] = []
  const monitorByKey = new Map<string, IndexedMonitor>()
  const monitorsById = new Map<string, IndexedMonitor[]>()
  for (
    let monitorIndex = 0;
    monitorIndex < (project.json.monitors?.length ?? 0);
    monitorIndex++
  )
  {
    const monitor = project.json.monitors![monitorIndex]!
    const reference = { monitorIndex, monitorId: monitor.id }
    const candidateTargets =
      monitor.spriteName === null || monitor.spriteName.length === 0
        ? targets.filter((target) => target.isStage)
        : (targetsByName.get(monitor.spriteName) ?? [])
    const declarationKind =
      monitor.opcode === 'data_variable'
        ? 'variable'
        : monitor.opcode === 'data_listcontents'
          ? 'list'
          : null
    const nameValue =
      declarationKind === 'variable'
        ? ownRecordValue(monitor.params, 'VARIABLE')
        : declarationKind === 'list'
          ? ownRecordValue(monitor.params, 'LIST')
          : undefined
    const referencedName = typeof nameValue === 'string' ? nameValue : null
    const resolutions =
      declarationKind === null
        ? []
        : candidateTargets.map((target) =>
            resolveDeclarationRecords(
              declarationResolutionLookup,
              stageIndex,
              declarationKind,
              target.targetIndex,
              monitor.id,
              referencedName
            )
          )
    const candidateDeclarationsByKey = new Map<string, DeclarationRef>()
    for (const resolution of resolutions)
    {
      for (const declaration of resolution.candidateDeclarations)
        candidateDeclarationsByKey.set(declarationKey(declaration), declaration)
    }
    const candidateDeclarations = [...candidateDeclarationsByKey.values()]
    const exactResolution =
      candidateTargets.length === 1 ? resolutions[0] : undefined
    const indexed: IndexedMonitor = {
      ref: reference,
      opcode: monitor.opcode,
      spriteName: monitor.spriteName,
      target: candidateTargets.length === 1 ? candidateTargets[0]! : null,
      candidateTargets,
      targetStatus: cardinality(candidateTargets.length),
      declaration:
        candidateDeclarations.length === 1 ? candidateDeclarations[0]! : null,
      candidateDeclarations,
      declarationStatus: cardinality(candidateDeclarations.length),
      declarationKind,
      parameterKeys: ownRecordKeys(monitor.params).sort(),
      referencedName,
      resolutionSource: exactResolution?.resolutionSource ?? null,
      displayNameMismatch:
        exactResolution?.displayNameMismatch ??
        resolutions.some((resolution) => resolution.displayNameMismatch),
    }
    monitors.push(indexed)
    monitorByKey.set(monitorKey(reference), indexed)
    addGrouped(monitorsById, monitor.id, indexed)
  }

  const inboundReferencesByEntityKey = new Map<
    string,
    SemanticInboundReference[]
  >()
  const addInbound = (
    entityKey: string,
    sourceEntityKey: string,
    kind: SemanticInboundReference['kind'],
    path: string
  ): void =>
  {
    addGrouped(inboundReferencesByEntityKey, entityKey, {
      entityKey,
      sourceEntityKey,
      kind,
      path,
    })
  }
  for (const indexed of blocks)
  {
    const sourceKey = blockKey(indexed.ref)
    const prefix = `/targets/${indexed.ref.target.targetIndex}/blocks/${pointerPart(indexed.ref.blockId)}`
    if (indexed.parent)
      addInbound(
        blockKey(indexed.parent),
        sourceKey,
        'block-parent',
        `${prefix}/parent`
      )
    if (indexed.successor)
      addInbound(
        blockKey(indexed.successor),
        sourceKey,
        'block-next',
        `${prefix}/next`
      )
    for (const child of indexed.inputChildren)
      addInbound(
        blockKey(child.block),
        sourceKey,
        'block-input',
        `${prefix}/inputs/${pointerPart(child.inputName)}/${child.slot}`
      )
  }
  for (const indexed of comments)
  {
    if (indexed.attachedBlock)
      addInbound(
        blockKey(indexed.attachedBlock),
        commentKey(indexed.ref),
        'comment-attachment',
        `/targets/${indexed.ref.target.targetIndex}/comments/${pointerPart(indexed.ref.commentId)}/blockId`
      )
    for (const block of indexed.reverseLinkedBlocks)
      addInbound(
        commentKey(indexed.ref),
        blockKey(block),
        'block-comment',
        `/targets/${block.target.targetIndex}/blocks/${pointerPart(block.blockId)}/comment`
      )
  }
  for (const reference of unresolvedBlockCommentReferences)
    addInbound(
      commentKey({
        target: reference.block.target,
        commentId: reference.commentId,
      }),
      blockKey(reference.block),
      'block-comment',
      `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}/comment`
    )
  for (const indexed of [...indexedVariables, ...indexedLists])
  {
    for (const use of indexed.references)
    {
      const base = `/targets/${use.block.target.targetIndex}/blocks/${pointerPart(use.block.blockId)}`
      const path =
        use.source === 'top-level-primitive'
          ? `${base}/1`
          : use.source === 'field' || use.source === 'sensing-property'
            ? `${base}/fields/${pointerPart(use.siteName!)}/0`
            : `${base}/inputs/${pointerPart(use.siteName!)}/${use.inputSlotIndex}/1`
      addInbound(
        declarationKey(indexed.declaration),
        blockKey(use.block),
        'declaration-use',
        path
      )
    }
  }
  for (const use of sensingDeclarationUses)
  {
    if (!use.declaration) continue
    addInbound(
      declarationKey(use.declaration),
      blockKey(use.block),
      'declaration-use',
      `/targets/${use.block.target.targetIndex}/blocks/${pointerPart(use.block.blockId)}/fields/PROPERTY/0`
    )
  }
  for (const indexed of broadcasts)
  {
    for (const use of [...indexed.senders, ...indexed.receivers])
      addInbound(
        declarationKey(indexed.declaration),
        blockKey(use.block),
        'broadcast-use',
        use.path
      )
  }
  for (const indexed of procedures)
  {
    const key = procedureKey(indexed.target, indexed.proccode)
    for (const definition of indexed.definitions)
      addInbound(
        key,
        blockKey(definition),
        'procedure-definition',
        `/targets/${definition.target.targetIndex}/blocks/${pointerPart(definition.blockId)}`
      )
    for (const prototype of indexed.prototypes)
      addInbound(
        key,
        blockKey(prototype),
        'procedure-prototype',
        `/targets/${prototype.target.targetIndex}/blocks/${pointerPart(prototype.blockId)}/mutation`
      )
    for (const call of indexed.calls)
      addInbound(
        key,
        blockKey(call),
        'procedure-call',
        `/targets/${call.target.targetIndex}/blocks/${pointerPart(call.blockId)}/mutation`
      )
  }
  for (const indexed of mutableMedia)
  {
    for (const reference of indexed.references)
    {
      if (reference.resolutionStatus === 'order-sensitive') continue
      addInbound(
        mediaKey(indexed.ref),
        blockKey(reference.block),
        'media-use',
        `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}`
      )
    }
  }
  for (const reference of mediaOrderReferences)
  {
    for (const indexed of mediaByTargetKind.get(
      targetMediaKindKey(reference.target, reference.kind)
    ) ?? [])
    {
      addInbound(
        mediaKey(indexed.ref),
        blockKey(reference.block),
        'media-order-reference',
        `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}`
      )
    }
  }
  for (const reference of dynamicMediaSelectorReferences)
  {
    for (const indexed of mediaByTargetKind.get(
      targetMediaKindKey(reference.target, reference.kind)
    ) ?? [])
    {
      addInbound(
        mediaKey(indexed.ref),
        blockKey(reference.block),
        'dynamic-media-selector',
        `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}`
      )
    }
  }
  for (const reference of spriteReferences)
  {
    for (const target of reference.targets)
      addInbound(
        targetKey(target),
        blockKey(reference.sourceBlock ?? reference.block),
        'sprite-reference',
        `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}/fields/${pointerPart(reference.fieldName)}/0`
      )
  }
  for (const reference of dynamicSpriteReferences)
  {
    for (const target of targets)
    {
      if (target.isStage) continue
      addInbound(
        targetKey(target),
        blockKey(reference.block),
        'dynamic-sprite-reference',
        `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}/inputs/${pointerPart(reference.inputName)}`
      )
    }
  }
  for (const indexed of monitors)
  {
    const sourceKey = monitorKey(indexed.ref)
    for (const target of indexed.candidateTargets)
      addInbound(
        targetKey(target),
        sourceKey,
        'monitor-target',
        `/monitors/${indexed.ref.monitorIndex}/spriteName`
      )
    for (const declaration of indexed.candidateDeclarations)
      addInbound(
        declarationKey(declaration),
        sourceKey,
        'monitor-declaration',
        `/monitors/${indexed.ref.monitorIndex}/id`
      )
  }
  for (const references of inboundReferencesByEntityKey.values())
    references.sort(
      (a, b) =>
        compareText(a.path, b.path) ||
        compareText(a.sourceEntityKey, b.sourceEntityKey) ||
        compareText(a.kind, b.kind)
    )

  const media = mutableMedia as IndexedMedia[]
  const mediaByKey = mutableMediaByKey as Map<string, IndexedMedia>
  const mediaByName = mutableMediaByName as Map<string, IndexedMedia[]>
  const mediaByArchivePath = mutableMediaByArchivePath as Map<
    string,
    IndexedMedia[]
  >

  const index: SemanticReferenceIndex = {
    targets,
    targetsByName,
    blocks,
    blockByKey,
    blocksById,
    scripts,
    scriptByKey,
    variables: indexedVariables,
    lists: indexedLists,
    declarationByKey,
    declarationsById: indexedDeclarationsById,
    declarationsInRuntimeOrder: declarationsInRuntimeOrder as (
      IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>
    )[],
    unresolvedDeclarationUses,
    sensingDeclarationUses,
    dynamicDeclarationNameReferences,
    broadcasts,
    broadcastByKey,
    broadcastsById: indexedBroadcastsById,
    broadcastsByName: indexedBroadcastsByName,
    broadcastsInRuntimeOrder: broadcastsInRuntimeOrder as IndexedBroadcast[],
    unresolvedBroadcastUses,
    dynamicBroadcastSenders,
    procedures,
    procedureByKey: mutableProcedures,
    unresolvedProcedureBlocks: unresolvedProcedureBlocks.sort(compareBlockRef),
    comments,
    commentByKey,
    unresolvedBlockCommentReferences,
    media,
    mediaByKey,
    mediaByName,
    mediaByArchivePath,
    unresolvedMediaReferences,
    mediaOrderReferences,
    dynamicMediaSelectorReferences,
    monitors,
    monitorByKey,
    monitorsById,
    inboundReferencesByEntityKey,
    spriteReferences,
    spriteReferencesByName,
    dynamicSpriteReferences,
    eventHats,
  }
  declarationResolutionLookupByIndex.set(index, declarationResolutionLookup)
  broadcastResolutionLookupByIndex.set(index, broadcastResolutionLookup)
  return index
}

export function resolveBroadcastReference(
  index: SemanticReferenceIndex,
  id: string | null,
  name: string | null
): BroadcastResolution
{
  const resolution = resolveBroadcastRecords(
    broadcastResolutionLookupForIndex(index),
    id,
    name
  )
  return {
    declaration: resolution.declaration,
    idCandidateDeclaration: resolution.idCandidateDeclaration,
    candidateDeclarations: resolution.candidateDeclarations,
    resolutionStatus: resolution.resolutionStatus,
    resolutionSource: resolution.resolutionSource,
    displayNameMismatch: resolution.displayNameMismatch,
    idNameMismatch: resolution.idNameMismatch,
    normalizedName: resolution.normalizedName,
  }
}
