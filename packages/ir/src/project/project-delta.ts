// packages/ir/src/project/project-delta.ts
// compute complete attributed project, block, asset, & protected-surface deltas

import { createHash } from 'node:crypto'

import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  DEFAULT_SB3_LIMITS,
  isBlockEntry,
  type Asset,
  type Block,
  type BlockEntry,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'
import { canonicalJsonV1 } from '@scratch-agent/sb3/canonical-json'

import { canonicalJson, type Json } from '../core/json.js'
import { compareText } from '../internal/compare-text.js'
import type { ProjectIR } from './project-ir.js'
import {
  ownRecordEntries,
  ownRecordKeys,
  ownRecordValue,
} from '../edit/support/own-record.js'
import {
  PROJECT_ORDERED_HEAD_VERSION_V1,
  OrderedCorrespondenceError,
  validateProjectOrderedCorrespondence,
  type OrderedCollectionHeadEvidence,
  type OrderedCollectionCorrespondence,
  type OrderedCollectionKind,
  type ProjectOrderedCorrespondence,
  type ProjectOrderedCorrespondenceEvidence,
  type ProjectOrderedHeadEvidence,
  type SemanticLineageHeadEvidence,
} from '../edit/lineage/correspondence.js'
import {
  activeOrderedSemanticLineages,
  semanticLineageById,
  validateSemanticLineageSnapshot,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '../edit/lineage/lineage.js'
import {
  DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS,
  parseStrictEditMutationArray,
  parseStrictEditProcedureMutation,
  procedurePlaceholderKinds,
} from '../edit/semantic-index/procedure-mutation.js'
import {
  jsonPointerPart as pointerPart,
  KNOWN_BLOCK_FIELDS,
  KNOWN_MUTATION_FIELDS,
  KNOWN_ROOT_FIELDS,
  KNOWN_TARGET_FIELDS,
  projectTargetIdentity,
} from './project-vocabulary.js'

export interface DeltaTargetIdentity
{
  targetIndex: number
  name: string
  isStage: boolean
}

interface DeltaScriptIdentity
{
  target: DeltaTargetIdentity
  topBlockId: string
}

interface DeltaBlockKey
{
  targetIndex: number
  blockId: string
}

export interface DeltaBlockAttribution extends DeltaBlockKey
{
  relativePaths?: readonly string[]
}

interface DeltaTargetPropertyKey
{
  targetIndex: number
  property: string
}

export interface DeltaOperationAttribution
{
  operationId: string
  targetIndexes?: readonly number[]
  blocks?: readonly DeltaBlockAttribution[]
  targetProperties?: readonly DeltaTargetPropertyKey[]
  projectPaths?: readonly string[]
  pathPrefixes?: readonly string[]
  assetPaths?: readonly string[]
  assetPathPrefixes?: readonly string[]
}

export type DeltaChangeKind = 'added' | 'removed' | 'changed'

export interface ValueDelta
{
  path: string
  kind: DeltaChangeKind
  before?: Json
  after?: Json
  operationIds: string[]
  entityLineageIds?: string[]
}

type BlockChangeClass =
  | 'authored'
  | 'graph-link-only'
  | 'existing-editor-layout'
  | 'new-script-layout'
  | 'unknown'

interface BlockOwnership
{
  before: DeltaScriptIdentity[]
  after: DeltaScriptIdentity[]
  beforeStatus: 'owned' | 'unowned' | 'ambiguous'
  afterStatus: 'owned' | 'unowned' | 'ambiguous'
}

interface BlockDelta
{
  blockId: string
  kind: DeltaChangeKind
  before?: Json
  after?: Json
  changes: ValueDelta[]
  classes: BlockChangeClass[]
  ownership: BlockOwnership
  operationIds: string[]
}

interface TargetDelta
{
  targetIndex: number
  lineageId?: string
  beforeTargetIndex?: number
  afterTargetIndex?: number
  beforeIdentity?: DeltaTargetIdentity
  afterIdentity?: DeltaTargetIdentity
  operationIds: string[]
  touchedScripts: DeltaScriptIdentity[]
  blockChanges: BlockDelta[]
  declarationChanges: ValueDelta[]
  gameplayPropertyChanges: ValueDelta[]
  assetMetadataChanges: ValueDelta[]
  existingEditorLayoutChanges: ValueDelta[]
  structureChanges: ValueDelta[]
  unknownChanges: ValueDelta[]
}

type OrderedCollectionChangeKind = 'added' | 'removed' | 'moved'

interface OrderedCollectionDelta
{
  collectionKind: OrderedCollectionKind
  collectionPath: string
  ownerLineageId: string | null
  lineageId: string
  kind: OrderedCollectionChangeKind
  beforeIndex?: number
  afterIndex?: number
  operationIds: string[]
}

type ProjectDeltaOptions =
  | {
      correspondence?: undefined
      correspondenceEvidence?: undefined
    }
  | {
      correspondence: ProjectOrderedCorrespondence
      correspondenceEvidence: ProjectOrderedCorrespondenceEvidence
    }

interface CorrespondedEntityDelta
{
  collectionKind: OrderedCollectionKind
  collectionPath: string
  ownerLineageId: string | null
  entityLineageId: string
  changes: ValueDelta[]
}

export interface AssetFingerprint
{
  path: string
  byteLength: number
  sha256: string
}

interface AssetDelta
{
  path: string
  occurrence: number
  kind: DeltaChangeKind
  beforeIndex?: number
  afterIndex?: number
  before?: AssetFingerprint
  after?: AssetFingerprint
  operationIds: string[]
}

type ProjectChangeClass =
  'existing-editor-layout' | 'metadata' | 'unknown'

interface ProjectChange
{
  class: ProjectChangeClass
  change: ValueDelta
}

export type ProtectedChangeClass =
  | 'asset'
  | 'declaration'
  | 'gameplay-configuration'
  | 'existing-editor-layout'
  | 'project-structure'
  | 'metadata'
  | 'unknown'
  | 'unattributed'
  | 'ambiguous-ownership'

export interface ProtectedChange
{
  class: ProtectedChangeClass
  path: string
  operationIds: string[]
  entityLineageIds?: string[]
  mandatory: boolean
  detail: string
}

interface DeltaSummary
{
  touchedTargets: number
  touchedScripts: number
  addedBlocks: number
  removedBlocks: number
  changedBlockRecords: number
  changedAuthoredBlocks: number
  graphLinkOnlyBlocks: number
  changedDeclarations: number
  changedGameplayProperties: number
  changedExistingEditorLayout: number
  changedAssets: number
  changedProjectMetadata: number
  changedUnknownFields: number
}

export interface ProjectDelta
{
  complete: boolean
  targets: TargetDelta[]
  assets: AssetDelta[]
  projectChanges: ProjectChange[]
  derivedProjectChanges?: ValueDelta[]
  orderedCollectionChanges?: OrderedCollectionDelta[]
  correspondedEntityChanges?: CorrespondedEntityDelta[]
  protectedChanges: ProtectedChange[]
  summary: DeltaSummary
}

interface LeafChange
{
  path: string
  kind: DeltaChangeKind
  before?: Json
  after?: Json
}

interface OwnershipIndex
{
  owners: Map<string, string[]>
  status: Map<string, 'owned' | 'unowned' | 'ambiguous'>
}

const TARGET_STRUCTURE_FIELDS = new Set(['isStage', 'name', 'layerOrder'])
const DECLARATION_FIELDS = new Set(['variables', 'lists', 'broadcasts'])
const ASSET_METADATA_FIELDS = new Set(['costumes', 'sounds'])
const EDITOR_LAYOUT_FIELDS = new Set(['comments'])
export const TARGET_GAMEPLAY_PROPERTY_NAMES = [
  'currentCostume',
  'volume',
  'tempo',
  'videoTransparency',
  'videoState',
  'textToSpeechLanguage',
  'visible',
  'x',
  'y',
  'size',
  'direction',
  'draggable',
  'rotationStyle',
] as const
const GAMEPLAY_FIELDS = new Set<string>(TARGET_GAMEPLAY_PROPERTY_NAMES)
const AUTHORED_BLOCK_FIELDS = new Set([
  'opcode',
  'inputs',
  'fields',
  'mutation',
])
const GRAPH_LINK_FIELDS = new Set(['next', 'parent'])
const LAYOUT_BLOCK_FIELDS = new Set(['x', 'y', 'comment'])

function isObject(value: unknown): value is Record<string, unknown>
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asJson(value: unknown): Json
{
  return structuredClone(value) as Json
}

function equalJson(a: unknown, b: unknown): boolean
{
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b)
  return canonicalJson(a as Json) === canonicalJson(b as Json)
}

function childPath(path: string, key: string | number): string
{
  return `${path}/${pointerPart(key)}`
}

function collectLeafChanges(
  before: unknown,
  after: unknown,
  path: string
): LeafChange[]
{
  if (before === undefined)
  {
    return [{ path, kind: 'added', after: asJson(after) }]
  }
  if (after === undefined)
  {
    return [{ path, kind: 'removed', before: asJson(before) }]
  }
  if (Array.isArray(before) && Array.isArray(after))
  {
    const changes: LeafChange[] = []
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length; index++)
    {
      changes.push(
        ...collectLeafChanges(
          before[index],
          after[index],
          childPath(path, index)
        )
      )
    }
    return changes
  }
  if (isObject(before) && isObject(after))
  {
    const changes: LeafChange[] = []
    const keys = [
      ...new Set([...ownRecordKeys(before), ...ownRecordKeys(after)]),
    ].sort()
    for (const key of keys)
    {
      changes.push(
        ...collectLeafChanges(
          ownRecordValue(before, key),
          ownRecordValue(after, key),
          childPath(path, key)
        )
      )
    }
    return changes
  }
  if (equalJson(before, after)) return []
  return [
    {
      path,
      kind: 'changed',
      before: asJson(before),
      after: asJson(after),
    },
  ]
}

function targetIdentity(
  target: Target | undefined,
  targetIndex: number
): DeltaTargetIdentity | undefined
{
  if (!target) return undefined
  return projectTargetIdentity(target, targetIndex)
}

export function fingerprintAsset(asset: Asset): AssetFingerprint
{
  return {
    path: asset.path,
    byteLength: asset.bytes.byteLength,
    sha256: createHash('sha256').update(asset.bytes).digest('hex'),
  }
}

function referencedBlocks(block: Block): string[]
{
  const referenced = new Set<string>()
  if (typeof block.next === 'string') referenced.add(block.next)
  for (const [, input] of ownRecordEntries(block.inputs))
  {
    for (const slot of input.slice(1))
    {
      if (typeof slot === 'string') referenced.add(slot)
    }
  }
  return [...referenced].sort()
}

function buildOwnershipIndex(target: Target | undefined): OwnershipIndex
{
  const owners = new Map<string, Set<string>>()
  if (!target) return { owners: new Map(), status: new Map() }

  const roots = ownRecordEntries(target.blocks)
    .filter(([, entry]) =>
    {
      if (Array.isArray(entry)) return entry.length >= 5
      return entry.topLevel === true && entry.shadow !== true
    })
    .map(([blockId]) => blockId)
    .sort()

  for (const rootId of roots)
  {
    const pending = [rootId]
    const seen = new Set<string>()
    while (pending.length > 0)
    {
      const blockId = pending.pop()!
      if (seen.has(blockId)) continue
      seen.add(blockId)
      const entry = ownRecordValue(target.blocks, blockId)
      if (!entry) continue
      const currentOwners = owners.get(blockId) ?? new Set<string>()
      currentOwners.add(rootId)
      owners.set(blockId, currentOwners)
      if (isBlockEntry(entry)) pending.push(...referencedBlocks(entry))
    }
  }

  const normalizedOwners = new Map<string, string[]>()
  const status = new Map<string, 'owned' | 'unowned' | 'ambiguous'>()
  for (const blockId of ownRecordKeys(target.blocks).sort())
  {
    const blockOwners = [...(owners.get(blockId) ?? [])].sort()
    normalizedOwners.set(blockId, blockOwners)
    status.set(
      blockId,
      blockOwners.length === 0
        ? 'unowned'
        : blockOwners.length === 1
          ? 'owned'
          : 'ambiguous'
    )
  }
  return { owners: normalizedOwners, status }
}

class AttributionIndex
{
  private readonly blocks = new Map<string, Set<string>>()
  private readonly blockPaths = new Map<string, Map<string, Set<string>>>()
  private readonly targetProperties = new Map<string, Set<string>>()
  private readonly projectPaths = new Map<string, Set<string>>()
  private readonly projectPathPrefixes = new Map<string, Set<string>>()
  private readonly assetPaths = new Map<string, Set<string>>()
  private readonly assetPathPrefixes = new Map<string, Set<string>>()

  constructor(attribution: readonly DeltaOperationAttribution[])
  {
    for (const entry of attribution)
    {
      const operationId = entry.operationId
      if (!operationId) continue
      for (const block of entry.blocks ?? [])
      {
        const blockKey = `${block.targetIndex}\u0000${block.blockId}`
        if (block.relativePaths === undefined)
        {
          this.add(this.blocks, blockKey, operationId)
          continue
        }
        const paths = this.blockPaths.get(blockKey) ?? new Map()
        for (const path of block.relativePaths)
        {
          const values = paths.get(path) ?? new Set<string>()
          values.add(operationId)
          paths.set(path, values)
        }
        this.blockPaths.set(blockKey, paths)
      }
      for (const property of entry.targetProperties ?? [])
      {
        this.add(
          this.targetProperties,
          `${property.targetIndex}\u0000${property.property}`,
          operationId
        )
      }
      for (const path of entry.projectPaths ?? [])
      {
        this.add(this.projectPaths, path, operationId)
      }
      for (const path of entry.pathPrefixes ?? [])
      {
        if (!path.startsWith('/'))
          throw new Error('delta attribution path prefix must start with /')
        this.add(this.projectPathPrefixes, path, operationId)
      }
      for (const path of entry.assetPaths ?? [])
      {
        this.add(this.assetPaths, path, operationId)
      }
      for (const path of entry.assetPathPrefixes ?? [])
      {
        this.add(this.assetPathPrefixes, path, operationId)
      }
    }
  }

  private add(map: Map<string, Set<string>>, key: string, value: string): void
  {
    const values = map.get(key) ?? new Set<string>()
    values.add(value)
    map.set(key, values)
  }

  private collect(...sets: Array<Set<string> | undefined>): string[]
  {
    const values = new Set<string>()
    for (const set of sets)
    {
      for (const value of set ?? []) values.add(value)
    }
    return [...values].sort()
  }

  private forPrefix(
    map: ReadonlyMap<string, Set<string>>,
    path: string
  ): Set<string>[]
  {
    const values: Set<string>[] = []
    for (const [prefix, operationIds] of map)
    {
      if (path === prefix || path.startsWith(`${prefix}/`))
        values.push(operationIds)
    }
    return values
  }

  private forDescendants(
    map: ReadonlyMap<string, Set<string>>,
    path: string
  ): Set<string>[]
  {
    const values: Set<string>[] = []
    for (const [candidate, operationIds] of map)
    {
      if (candidate.startsWith(`${path}/`)) values.push(operationIds)
    }
    return values
  }

  forBlock(
    targetIndex: number,
    blockId: string,
    paths: string[],
    includeDescendants = false
  ): string[]
  {
    const blockKey = `${targetIndex}\u0000${blockId}`
    const blockPath = `/targets/${targetIndex}/blocks/${pointerPart(blockId)}`
    const scopedPaths = this.blockPaths.get(blockKey)
    const pathAttribution: Array<Set<string> | undefined> = []
    for (const absolutePath of paths)
    {
      if (
        absolutePath !== blockPath &&
        !absolutePath.startsWith(`${blockPath}/`)
      )
      {
        continue
      }
      const relativePath = absolutePath.slice(blockPath.length)
      if (relativePath === '')
      {
        for (const operationIds of scopedPaths?.values() ?? [])
        {
          pathAttribution.push(operationIds)
        }
        continue
      }
      for (const [prefix, operationIds] of scopedPaths ?? [])
      {
        if (relativePath === prefix || relativePath.startsWith(`${prefix}/`))
        {
          pathAttribution.push(operationIds)
        }
      }
    }
    return this.collect(
      this.blocks.get(blockKey),
      ...pathAttribution,
      ...paths.map((path) => this.projectPaths.get(path)),
      ...paths.flatMap((path) =>
        this.forPrefix(this.projectPathPrefixes, path)
      ),
      ...(includeDescendants
        ? paths.flatMap((path) => [
            ...this.forDescendants(this.projectPaths, path),
            ...this.forDescendants(this.projectPathPrefixes, path),
          ])
        : [])
    )
  }

  forTargetProperty(
    targetIndex: number,
    property: string,
    path: string,
    includeDescendants = false
  ): string[]
  {
    return this.collect(
      this.targetProperties.get(`${targetIndex}\u0000${property}`),
      this.projectPaths.get(path),
      ...this.forPrefix(this.projectPathPrefixes, path),
      ...(includeDescendants
        ? [
            ...this.forDescendants(this.projectPaths, path),
            ...this.forDescendants(this.projectPathPrefixes, path),
          ]
        : [])
    )
  }

  forProjectPath(path: string, includeDescendants = false): string[]
  {
    return this.collect(
      this.projectPaths.get(path),
      ...this.forPrefix(this.projectPathPrefixes, path),
      ...(includeDescendants
        ? [
            ...this.forDescendants(this.projectPaths, path),
            ...this.forDescendants(this.projectPathPrefixes, path),
          ]
        : [])
    )
  }

  forAssetPath(path: string): string[]
  {
    return this.collect(
      this.assetPaths.get(path),
      ...this.forPrefix(this.assetPathPrefixes, path)
    )
  }
}

function valueDeltas(
  before: unknown,
  after: unknown,
  path: string,
  operationIds: (change: LeafChange) => string[]
): ValueDelta[]
{
  return collectLeafChanges(before, after, path).map((change) => ({
    ...change,
    operationIds: operationIds(change),
  }))
}

function rootBlockFields(
  changes: LeafChange[],
  blockPath: string
): Set<string>
{
  const fields = new Set<string>()
  const prefix = `${blockPath}/`
  for (const change of changes)
  {
    if (!change.path.startsWith(prefix)) continue
    const rest = change.path.slice(prefix.length)
    const part = rest.split('/')[0]
    const field = part === undefined ? undefined : decodedPointerPart(part)
    if (field) fields.add(field)
  }
  return fields
}

function rootBlockField(
  change: LeafChange,
  blockPath: string
): string | undefined
{
  const prefix = `${blockPath}/`
  if (!change.path.startsWith(prefix)) return undefined
  const part = change.path.slice(prefix.length).split('/')[0]
  return part === undefined ? undefined : decodedPointerPart(part)
}

function blockEntryHasUnknownFields(entry: BlockEntry): boolean
{
  if (Array.isArray(entry)) return true
  if (Object.keys(entry).some((field) => !KNOWN_BLOCK_FIELDS.has(field)))
  {
    return true
  }
  return Boolean(
    entry.mutation &&
    Object.keys(entry.mutation).some(
      (field) => !KNOWN_MUTATION_FIELDS.has(field)
    )
  )
}

function isUnknownBlockChange(change: LeafChange, blockPath: string): boolean
{
  const field = rootBlockField(change, blockPath)
  if (
    field === undefined ||
    !KNOWN_BLOCK_FIELDS.has(field) ||
    field === 'shadow' ||
    field === 'topLevel'
  )
  {
    return true
  }
  if (field !== 'mutation') return false
  const prefix = `${blockPath}/mutation/`
  if (!change.path.startsWith(prefix)) return false
  const part = change.path.slice(prefix.length).split('/')[0]
  const mutationField =
    part === undefined ? undefined : decodedPointerPart(part)
  return (
    mutationField !== undefined && !KNOWN_MUTATION_FIELDS.has(mutationField)
  )
}

function isDeclarationPrimitiveNameChange(
  before: BlockEntry,
  after: BlockEntry,
  changes: readonly LeafChange[],
  blockPath: string
): boolean
{
  if (!Array.isArray(before) || !Array.isArray(after)) return false
  if (
    (before[0] !== 12 && before[0] !== 13) ||
    after[0] !== before[0] ||
    typeof before[1] !== 'string' ||
    typeof after[1] !== 'string' ||
    before[2] !== after[2] ||
    before.length !== after.length
  )
    return false
  return changes.length === 1 && changes[0]!.path === `${blockPath}/1`
}

function classifyBlockChange(
  before: BlockEntry | undefined,
  after: BlockEntry | undefined,
  changes: LeafChange[],
  blockPath: string
): BlockChangeClass[]
{
  if (before === undefined || after === undefined)
  {
    const entry = before ?? after
    const classes: BlockChangeClass[] = ['authored']
    if (entry && blockEntryHasUnknownFields(entry)) classes.push('unknown')
    if (
      entry &&
      !Array.isArray(entry) &&
      entry.topLevel &&
      (entry.x !== undefined || entry.y !== undefined)
    )
    {
      classes.push(
        before === undefined ? 'new-script-layout' : 'existing-editor-layout'
      )
    }
    return classes
  }
  if (Array.isArray(before) || Array.isArray(after))
  {
    return isDeclarationPrimitiveNameChange(before, after, changes, blockPath)
      ? ['authored']
      : ['authored', 'unknown']
  }

  const fields = rootBlockFields(changes, blockPath)
  const classes = new Set<BlockChangeClass>()
  let authored = false
  let layout = false
  let unknown = false
  let graphLinkOnly = fields.size > 0
  for (const field of fields)
  {
    if (AUTHORED_BLOCK_FIELDS.has(field)) authored = true
    if (LAYOUT_BLOCK_FIELDS.has(field)) layout = true
    if (
      !KNOWN_BLOCK_FIELDS.has(field) ||
      field === 'shadow' ||
      field === 'topLevel'
    )
      unknown = true
    if (!GRAPH_LINK_FIELDS.has(field)) graphLinkOnly = false
  }
  if (authored) classes.add('authored')
  if (layout) classes.add('existing-editor-layout')
  if (unknown) classes.add('unknown')
  if (changes.some((change) => isUnknownBlockChange(change, blockPath)))
  {
    classes.add('unknown')
  }
  if (graphLinkOnly) classes.add('graph-link-only')
  return [...classes]
}

function ownershipScripts(
  target: Target | undefined,
  targetIndex: number,
  ownerIds: readonly string[]
): DeltaScriptIdentity[]
{
  const identity = targetIdentity(target, targetIndex)
  if (!identity) return []
  return ownerIds.map((topBlockId) => ({ target: identity, topBlockId }))
}

function uniqueScripts(
  scripts: readonly DeltaScriptIdentity[]
): DeltaScriptIdentity[]
{
  const map = new Map<string, DeltaScriptIdentity>()
  for (const script of scripts)
  {
    const key = `${script.target.targetIndex}\u0000${script.topBlockId}`
    map.set(key, script)
  }
  return [...map.values()].sort((a, b) =>
  {
    if (a.target.targetIndex !== b.target.targetIndex)
    {
      return a.target.targetIndex - b.target.targetIndex
    }
    return a.topBlockId < b.topBlockId
      ? -1
      : a.topBlockId > b.topBlockId
        ? 1
        : 0
  })
}

function uniqueOperationIds(
  records: readonly { operationIds: string[] }[]
): string[]
{
  return [...new Set(records.flatMap((record) => record.operationIds))].sort()
}

function pushProtected(
  output: ProtectedChange[],
  record: {
    path: string
    operationIds: string[]
    entityLineageIds?: string[]
  },
  changeClass: ProtectedChangeClass,
  detail: string,
  mandatory = false
): void
{
  output.push({
    class: changeClass,
    path: record.path,
    operationIds: record.operationIds,
    ...(record.entityLineageIds
      ? { entityLineageIds: [...record.entityLineageIds] }
      : {}),
    mandatory,
    detail,
  })
}

function protectUnattributed(
  output: ProtectedChange[],
  records: readonly {
    path: string
    operationIds: string[]
    entityLineageIds?: string[]
  }[]
): void
{
  for (const record of records)
  {
    if (record.operationIds.length === 0)
    {
      pushProtected(
        output,
        record,
        'unattributed',
        'actual change has no responsible operation',
        true
      )
    }
  }
}

function projectChange(
  changeClass: ProjectChangeClass,
  leaf: LeafChange,
  attribution: AttributionIndex
): ProjectChange
{
  return {
    class: changeClass,
    change: {
      ...leaf,
      operationIds: attribution.forProjectPath(
        leaf.path,
        leaf.kind === 'added'
      ),
    },
  }
}

function assetGroups(
  assets: readonly Asset[]
): Map<string, Array<{ asset: Asset; index: number }>>
{
  const groups = new Map<string, Array<{ asset: Asset; index: number }>>()
  assets.forEach((asset, index) =>
  {
    const entries = groups.get(asset.path) ?? []
    entries.push({ asset, index })
    groups.set(asset.path, entries)
  })
  return groups
}

function computeAssetDeltas(
  before: readonly Asset[],
  after: readonly Asset[],
  attribution: AttributionIndex
): AssetDelta[]
{
  const beforeGroups = assetGroups(before)
  const afterGroups = assetGroups(after)
  const paths = [
    ...new Set([...beforeGroups.keys(), ...afterGroups.keys()]),
  ].sort()
  const deltas: AssetDelta[] = []
  for (const path of paths)
  {
    const beforeEntries = beforeGroups.get(path) ?? []
    const afterEntries = afterGroups.get(path) ?? []
    const count = Math.max(beforeEntries.length, afterEntries.length)
    for (let occurrence = 0; occurrence < count; occurrence++)
    {
      const beforeEntry = beforeEntries[occurrence]
      const afterEntry = afterEntries[occurrence]
      const beforeFingerprint = beforeEntry
        ? fingerprintAsset(beforeEntry.asset)
        : undefined
      const afterFingerprint = afterEntry
        ? fingerprintAsset(afterEntry.asset)
        : undefined
      if (
        beforeFingerprint &&
        afterFingerprint &&
        equalJson(beforeFingerprint, afterFingerprint)
      )
      {
        continue
      }
      deltas.push({
        path,
        occurrence,
        kind: !beforeEntry ? 'added' : !afterEntry ? 'removed' : 'changed',
        ...(beforeEntry ? { beforeIndex: beforeEntry.index } : {}),
        ...(afterEntry ? { afterIndex: afterEntry.index } : {}),
        ...(beforeFingerprint ? { before: beforeFingerprint } : {}),
        ...(afterFingerprint ? { after: afterFingerprint } : {}),
        operationIds: attribution.forAssetPath(path),
      })
    }
  }
  return deltas
}

function fieldDeltas(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  targetIndex: number,
  field: string,
  attribution: AttributionIndex,
  entityLineages?: (path: string) => readonly string[]
): ValueDelta[]
{
  const path = `/targets/${targetIndex}/${pointerPart(field)}`
  const beforeValue = ownRecordValue(before, field)
  const afterValue = ownRecordValue(after, field)
  const decorate = (changes: readonly ValueDelta[]): ValueDelta[] =>
    changes.map((change) =>
    {
      const lineages = entityLineages?.(change.path) ?? []
      return {
        ...change,
        ...(lineages.length > 0
          ? { entityLineageIds: [...new Set(lineages)].sort(compareText) }
          : {}),
      }
    })
  const optionalCollection =
    field === 'lists' || field === 'broadcasts' || field === 'comments'
  const collectionAdded =
    optionalCollection && beforeValue === undefined && isObject(afterValue)
  const collectionRemoved =
    optionalCollection && isObject(beforeValue) && afterValue === undefined
  if (collectionAdded || collectionRemoved)
  {
    const container = valueDeltas(beforeValue, afterValue, path, (change) =>
      attribution.forTargetProperty(targetIndex, field, change.path)
    )
    const members = valueDeltas(
      collectionAdded ? {} : beforeValue,
      collectionRemoved ? {} : afterValue,
      path,
      (change) =>
        attribution.forTargetProperty(
          targetIndex,
          field,
          change.path,
          change.kind === 'added'
        )
    )
    return decorate([...container, ...members])
  }
  return decorate(
    valueDeltas(beforeValue, afterValue, path, (change) =>
      attribution.forTargetProperty(
        targetIndex,
        field,
        change.path,
        change.kind === 'added'
      )
    )
  )
}

function computeTargetDelta(
  before: Target | undefined,
  after: Target | undefined,
  targetIndex: number,
  attribution: AttributionIndex,
  protectedChanges: ProtectedChange[],
  alignment?: {
    lineageId: string
    beforeTargetIndex: number | null
    afterTargetIndex: number | null
    entityLineagesForPath: (path: string) => readonly string[]
    skipFields?: ReadonlySet<string>
    additionalAssetMetadataChanges?: readonly ValueDelta[]
  }
): TargetDelta | undefined
{
  const beforeRecord = (before ?? {}) as Record<string, unknown>
  const afterRecord = (after ?? {}) as Record<string, unknown>
  const beforeBlocks = before?.blocks ?? {}
  const afterBlocks = after?.blocks ?? {}
  const beforeOwnership = buildOwnershipIndex(before)
  const afterOwnership = buildOwnershipIndex(after)
  const blockChanges: BlockDelta[] = []
  const touchedScripts: DeltaScriptIdentity[] = []

  const blockIds = [
    ...new Set([...ownRecordKeys(beforeBlocks), ...ownRecordKeys(afterBlocks)]),
  ].sort()
  for (const blockId of blockIds)
  {
    const beforeBlock = ownRecordValue(beforeBlocks, blockId)
    const afterBlock = ownRecordValue(afterBlocks, blockId)
    if (
      beforeBlock !== undefined &&
      afterBlock !== undefined &&
      equalJson(beforeBlock, afterBlock)
    )
    {
      continue
    }
    const blockPath = `/targets/${targetIndex}/blocks/${pointerPart(blockId)}`
    const leaves = collectLeafChanges(beforeBlock, afterBlock, blockPath)
    const changes = leaves.map((leaf) =>
    {
      const lineages = alignment?.entityLineagesForPath(leaf.path) ?? []
      return {
        ...leaf,
        operationIds: attribution.forBlock(
          targetIndex,
          blockId,
          [leaf.path],
          leaf.kind === 'added'
        ),
        ...(lineages.length > 0
          ? { entityLineageIds: [...new Set(lineages)].sort(compareText) }
          : {}),
      }
    })
    const operationIds = uniqueOperationIds(changes)
    const beforeOwnerIds = beforeOwnership.owners.get(blockId) ?? []
    const afterOwnerIds = afterOwnership.owners.get(blockId) ?? []
    const beforeScripts = ownershipScripts(
      before,
      alignment?.beforeTargetIndex ?? targetIndex,
      beforeOwnerIds
    )
    const afterScripts = ownershipScripts(
      after,
      alignment?.afterTargetIndex ?? targetIndex,
      afterOwnerIds
    )
    touchedScripts.push(...beforeScripts, ...afterScripts)
    const ownership: BlockOwnership = {
      before: beforeScripts,
      after: afterScripts,
      beforeStatus: beforeOwnership.status.get(blockId) ?? 'unowned',
      afterStatus: afterOwnership.status.get(blockId) ?? 'unowned',
    }
    const classes = classifyBlockChange(
      beforeBlock,
      afterBlock,
      leaves,
      blockPath
    )
    const delta: BlockDelta = {
      blockId,
      kind:
        beforeBlock === undefined
          ? 'added'
          : afterBlock === undefined
            ? 'removed'
            : 'changed',
      ...(beforeBlock !== undefined ? { before: asJson(beforeBlock) } : {}),
      ...(afterBlock !== undefined ? { after: asJson(afterBlock) } : {}),
      changes,
      classes,
      ownership,
      operationIds,
    }
    blockChanges.push(delta)

    protectUnattributed(protectedChanges, changes)
    if (classes.includes('existing-editor-layout'))
    {
      const layoutChanges =
        beforeBlock === undefined || afterBlock === undefined
          ? changes
          : changes.filter((change) =>
              LAYOUT_BLOCK_FIELDS.has(rootBlockField(change, blockPath) ?? '')
            )
      for (const change of layoutChanges)
      {
        pushProtected(
          protectedChanges,
          change,
          'existing-editor-layout',
          'existing block workspace or comment attachment changed'
        )
      }
    }
    if (classes.includes('unknown'))
    {
      const unknownBlockChanges =
        beforeBlock === undefined ||
        afterBlock === undefined ||
        Array.isArray(beforeBlock) ||
        Array.isArray(afterBlock)
          ? changes
          : changes.filter((change) => isUnknownBlockChange(change, blockPath))
      for (const change of unknownBlockChanges)
      {
        pushProtected(
          protectedChanges,
          change,
          'unknown',
          'block change cannot be classified as an allowed semantic surface',
          true
        )
      }
    }
    const invalidBeforeOwnership =
      beforeBlock !== undefined && ownership.beforeStatus !== 'owned'
    const invalidAfterOwnership =
      afterBlock !== undefined && ownership.afterStatus !== 'owned'
    if (invalidBeforeOwnership || invalidAfterOwnership)
    {
      pushProtected(
        protectedChanges,
        { path: blockPath, operationIds },
        'ambiguous-ownership',
        `block ownership is ${ownership.beforeStatus} before & ${ownership.afterStatus} after`,
        true
      )
    }
  }

  const declarationChanges: ValueDelta[] = []
  const gameplayPropertyChanges: ValueDelta[] = []
  const assetMetadataChanges: ValueDelta[] = [
    ...(alignment?.additionalAssetMetadataChanges ?? []),
  ]
  const existingEditorLayoutChanges: ValueDelta[] = []
  const structureChanges: ValueDelta[] = []
  const unknownChanges: ValueDelta[] = []

  const fields = [
    ...new Set([...ownRecordKeys(beforeRecord), ...ownRecordKeys(afterRecord)]),
  ]
    .filter((field) => field !== 'blocks' && !alignment?.skipFields?.has(field))
    .sort()
  protectUnattributed(protectedChanges, assetMetadataChanges)
  for (const change of assetMetadataChanges)
    pushProtected(
      protectedChanges,
      change,
      'asset',
      'costume or sound metadata changed'
    )
  for (const field of fields)
  {
    if (
      equalJson(
        ownRecordValue(beforeRecord, field),
        ownRecordValue(afterRecord, field)
      )
    )
      continue
    const changes = fieldDeltas(
      beforeRecord,
      afterRecord,
      targetIndex,
      field,
      attribution,
      alignment?.entityLineagesForPath
    )
    protectUnattributed(protectedChanges, changes)
    if (DECLARATION_FIELDS.has(field))
    {
      declarationChanges.push(...changes)
      for (const change of changes)
      {
        pushProtected(
          protectedChanges,
          change,
          'declaration',
          'declaration storage changed'
        )
      }
    }
    else if (GAMEPLAY_FIELDS.has(field))
    {
      gameplayPropertyChanges.push(...changes)
      for (const change of changes)
      {
        pushProtected(
          protectedChanges,
          change,
          'gameplay-configuration',
          'target gameplay property changed'
        )
      }
    }
    else if (ASSET_METADATA_FIELDS.has(field))
    {
      assetMetadataChanges.push(...changes)
      for (const change of changes)
      {
        pushProtected(
          protectedChanges,
          change,
          'asset',
          'costume or sound metadata changed'
        )
      }
    }
    else if (EDITOR_LAYOUT_FIELDS.has(field))
    {
      existingEditorLayoutChanges.push(...changes)
      for (const change of changes)
      {
        pushProtected(
          protectedChanges,
          change,
          'existing-editor-layout',
          'comment content, attachment, or geometry changed'
        )
      }
    }
    else if (TARGET_STRUCTURE_FIELDS.has(field))
    {
      structureChanges.push(...changes)
      for (const change of changes)
      {
        pushProtected(
          protectedChanges,
          change,
          'project-structure',
          'target identity, order, or layer changed'
        )
      }
    }
    else if (!KNOWN_TARGET_FIELDS.has(field))
    {
      unknownChanges.push(...changes)
      for (const change of changes)
      {
        pushProtected(
          protectedChanges,
          change,
          'unknown',
          'unrecognized target field changed',
          true
        )
      }
    }
  }

  const allRecords: Array<{ operationIds: string[] }> = [
    ...blockChanges,
    ...declarationChanges,
    ...gameplayPropertyChanges,
    ...assetMetadataChanges,
    ...existingEditorLayoutChanges,
    ...structureChanges,
    ...unknownChanges,
  ]
  if (allRecords.length === 0) return undefined
  return {
    targetIndex,
    ...(alignment ? { lineageId: alignment.lineageId } : {}),
    ...(alignment?.beforeTargetIndex !== null &&
    alignment?.beforeTargetIndex !== undefined
      ? { beforeTargetIndex: alignment.beforeTargetIndex }
      : {}),
    ...(alignment?.afterTargetIndex !== null &&
    alignment?.afterTargetIndex !== undefined
      ? { afterTargetIndex: alignment.afterTargetIndex }
      : {}),
    ...(before
      ? {
          beforeIdentity: targetIdentity(
            before,
            alignment?.beforeTargetIndex ?? targetIndex
          ),
        }
      : {}),
    ...(after
      ? {
          afterIdentity: targetIdentity(
            after,
            alignment?.afterTargetIndex ?? targetIndex
          ),
        }
      : {}),
    operationIds: uniqueOperationIds(allRecords),
    touchedScripts: uniqueScripts(touchedScripts),
    blockChanges,
    declarationChanges,
    gameplayPropertyChanges,
    assetMetadataChanges,
    existingEditorLayoutChanges,
    structureChanges,
    unknownChanges,
  }
}

function correspondenceCollections(
  correspondence: ProjectOrderedCorrespondence
): OrderedCollectionCorrespondence[]
{
  return [
    ...(correspondence.targets ? [correspondence.targets] : []),
    ...(correspondence.media ?? []),
    ...(correspondence.procedureParameters ?? []),
    ...(correspondence.procedureCallArguments ?? []),
  ]
}

function decodedPointerPart(value: string): string
{
  return value.replaceAll('~1', '/').replaceAll('~0', '~')
}

function valueFingerprint(value: unknown): string
{
  return createHash('sha256')
    .update(
      canonicalJsonV1(value, {
        maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
        maxNodes: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes,
        maxMembers: DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
        maxStringCodeUnits: DEFAULT_SB3_LIMITS.maxProjectJsonBytes,
      })
    )
    .digest('hex')
}

function equalCorrespondenceValue(a: unknown, b: unknown): boolean
{
  return valueFingerprint(a) === valueFingerprint(b)
}

function orderedHeadProjectFingerprint(project: ProjectIR): string
{
  return valueFingerprint(project.json)
}

type HeadSide = 'before' | 'after'
type HeadMemberKind = 'target' | 'costume' | 'sound' | 'parameter'

interface ProcedureMemberSurface
{
  argumentId: string
  name?: string
  defaultValue?: Json
  placeholder?: 's' | 'b' | 'n'
  input?: Json
}

interface StrictProcedureSurface
{
  targetIndex: number
  blockId: string
  block: Block
  proccode: string
  members: ProcedureMemberSurface[]
}

interface ResolvedOrderedHeadSurface
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
  memberKind: HeadMemberKind
  members: Json[]
  procedureMembers?: ProcedureMemberSurface[]
  proccode?: string
}

interface ProcedurePath
{
  targetIndex: number
  blockId: string
}

function collectionPathForSide(
  correspondence: OrderedCollectionCorrespondence,
  side: HeadSide
): string | null
{
  return side === 'before'
    ? correspondence.beforeCollectionPath
    : correspondence.afterCollectionPath
}

function lineageIdsForSide(
  correspondence: OrderedCollectionCorrespondence,
  side: HeadSide
): readonly string[]
{
  return side === 'before'
    ? correspondence.beforeLineageIds
    : correspondence.afterLineageIds
}

function parseProcedurePath(path: string): ProcedurePath
{
  const parts = path.slice(1).split('/').map(decodedPointerPart)
  if (
    parts.length !== 6 ||
    parts[0] !== 'targets' ||
    !/^(?:0|[1-9][0-9]*)$/.test(parts[1] ?? '') ||
    parts[2] !== 'blocks' ||
    parts[4] !== 'mutation' ||
    parts[5] !== 'argumentids'
  )
  {
    throw new OrderedCorrespondenceError(
      'wrong-path',
      `procedure correspondence has invalid path: ${path}`
    )
  }
  return { targetIndex: Number(parts[1]), blockId: parts[3]! }
}

function strictPrototypeSurface(
  project: ProjectJson,
  path: string
): StrictProcedureSurface
{
  const { targetIndex, blockId } = parseProcedurePath(path)
  const block = ownRecordValue(project.targets[targetIndex]?.blocks, blockId)
  if (!isBlockEntry(block) || block.opcode !== 'procedures_prototype')
    throw new OrderedCorrespondenceError(
      'member-mismatch',
      `${path}: parameter correspondence does not identify a prototype`
    )
  try
  {
    if (!block.mutation) throw new Error('procedure prototype has no mutation')
    const arrays = parseStrictEditProcedureMutation(
      block.mutation,
      DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS
    )
    const proccode = block.mutation.proccode!
    const placeholders = procedurePlaceholderKinds(proccode)
    return {
      targetIndex,
      blockId,
      block,
      proccode,
      members: arrays.argumentIds.map((argumentId, index) => ({
        argumentId,
        name: arrays.argumentNames[index]!,
        defaultValue: asJson(arrays.argumentDefaults[index]),
        placeholder: placeholders[index]!,
      })),
    }
  }
  catch (error)
  {
    if (error instanceof OrderedCorrespondenceError) throw error
    throw new OrderedCorrespondenceError(
      'member-mismatch',
      `${path}: ${error instanceof Error ? error.message : 'invalid procedure mutation'}`
    )
  }
}

function findPrototypeForCall(
  project: ProjectJson,
  targetIndex: number,
  proccode: string
): StrictProcedureSurface
{
  const target = project.targets[targetIndex]
  const matches: StrictProcedureSurface[] = []
  for (const [blockId, entry] of ownRecordEntries(target?.blocks))
  {
    if (
      !isBlockEntry(entry) ||
      entry.opcode !== 'procedures_prototype' ||
      entry.mutation?.proccode !== proccode
    )
      continue
    matches.push(
      strictPrototypeSurface(
        project,
        `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/mutation/argumentids`
      )
    )
  }
  if (matches.length !== 1)
    throw new OrderedCorrespondenceError(
      'member-mismatch',
      `procedure call must resolve exactly one prototype for ${proccode}`
    )
  return matches[0]!
}

function strictCallSurface(
  project: ProjectJson,
  path: string
): StrictProcedureSurface
{
  const { targetIndex, blockId } = parseProcedurePath(path)
  const block = ownRecordValue(project.targets[targetIndex]?.blocks, blockId)
  if (!isBlockEntry(block) || block.opcode !== 'procedures_call')
    throw new OrderedCorrespondenceError(
      'member-mismatch',
      `${path}: call correspondence does not identify a procedure call`
    )
  try
  {
    if (typeof block.mutation?.proccode !== 'string')
      throw new Error('procedure call has no proccode')
    const argumentIds = parseStrictEditMutationArray(
      block.mutation.argumentids,
      'argumentids',
      DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS
    ) as readonly string[]
    if (new Set(argumentIds).size !== argumentIds.length)
      throw new Error('procedure call argument IDs must be unique')
    const prototype = findPrototypeForCall(
      project,
      targetIndex,
      block.mutation.proccode
    )
    if (
      argumentIds.length !== prototype.members.length ||
      argumentIds.some(
        (argumentId, index) =>
          argumentId !== prototype.members[index]?.argumentId
      )
    )
      throw new Error('procedure call argument IDs do not align with prototype')
    const inputKeys = ownRecordKeys(block.inputs).sort(compareText)
    const sortedArgumentIds = [...argumentIds].sort(compareText)
    if (
      inputKeys.length !== sortedArgumentIds.length ||
      inputKeys.some((key, index) => key !== sortedArgumentIds[index])
    )
      throw new Error('procedure call inputs do not align with argument IDs')
    return {
      targetIndex,
      blockId,
      block,
      proccode: block.mutation.proccode,
      members: argumentIds.map((argumentId) => ({
        argumentId,
        input: asJson(ownRecordValue(block.inputs, argumentId)),
      })),
    }
  }
  catch (error)
  {
    if (error instanceof OrderedCorrespondenceError) throw error
    throw new OrderedCorrespondenceError(
      'member-mismatch',
      `${path}: ${error instanceof Error ? error.message : 'invalid procedure call'}`
    )
  }
}

function resolveOrderedHeadSurface(
  project: ProjectIR,
  correspondence: OrderedCollectionCorrespondence,
  side: HeadSide
): ResolvedOrderedHeadSurface
{
  const path = collectionPathForSide(correspondence, side)
  if (path === null)
  {
    if (lineageIdsForSide(correspondence, side).length !== 0)
      throw new OrderedCorrespondenceError(
        'incomplete',
        `${side} collection is absent but has lineage members`
      )
    return {
      collectionKind: correspondence.collectionKind,
      collectionPath: null,
      ownerLineageId: correspondence.ownerLineageId,
      ownerKind:
        correspondence.collectionKind === 'targets'
          ? null
          : correspondence.collectionKind === 'costumes' ||
              correspondence.collectionKind === 'sounds'
            ? 'target'
            : 'procedure',
      ownerOwnerLineageId: correspondence.targetOwnerLineageId,
      ownerFingerprint: null,
      containerLineageId: correspondence.containerLineageId,
      containerKind:
        correspondence.collectionKind === 'targets'
          ? null
          : correspondence.collectionKind === 'costumes' ||
              correspondence.collectionKind === 'sounds'
            ? 'target'
            : 'block',
      containerFingerprint: null,
      memberKind:
        correspondence.collectionKind === 'targets'
          ? 'target'
          : correspondence.collectionKind === 'costumes'
            ? 'costume'
            : correspondence.collectionKind === 'sounds'
              ? 'sound'
              : 'parameter',
      members: [],
    }
  }
  if (correspondence.collectionKind === 'targets')
  {
    if (path !== '/targets')
      throw new OrderedCorrespondenceError(
        'wrong-path',
        'target correspondence must bind /targets'
      )
    return {
      collectionKind: 'targets',
      collectionPath: path,
      ownerLineageId: null,
      ownerKind: null,
      ownerOwnerLineageId: null,
      ownerFingerprint: null,
      containerLineageId: null,
      containerKind: null,
      containerFingerprint: null,
      memberKind: 'target',
      members: project.json.targets.map((target) => asJson(target)),
    }
  }
  if (
    correspondence.collectionKind === 'costumes' ||
    correspondence.collectionKind === 'sounds'
  )
  {
    const parts = path.slice(1).split('/').map(decodedPointerPart)
    const field = correspondence.collectionKind
    if (
      parts.length !== 3 ||
      parts[0] !== 'targets' ||
      !/^(?:0|[1-9][0-9]*)$/.test(parts[1] ?? '') ||
      parts[2] !== field
    )
      throw new OrderedCorrespondenceError(
        'wrong-path',
        `media correspondence has invalid path: ${path}`
      )
    const target = project.json.targets[Number(parts[1])]
    if (!target)
      throw new OrderedCorrespondenceError(
        'wrong-owner',
        `${path}: media target does not exist`
      )
    const targetFingerprint = valueFingerprint(target)
    return {
      collectionKind: correspondence.collectionKind,
      collectionPath: path,
      ownerLineageId: correspondence.ownerLineageId,
      ownerKind: 'target',
      ownerOwnerLineageId: correspondence.targetOwnerLineageId,
      ownerFingerprint: targetFingerprint,
      containerLineageId: correspondence.containerLineageId,
      containerKind: 'target',
      containerFingerprint: targetFingerprint,
      memberKind:
        correspondence.collectionKind === 'costumes' ? 'costume' : 'sound',
      members: target[field].map((member) => asJson(member)),
    }
  }
  const decoded =
    correspondence.collectionKind === 'procedure-parameters'
      ? strictPrototypeSurface(project.json, path)
      : strictCallSurface(project.json, path)
  return {
    collectionKind: correspondence.collectionKind,
    collectionPath: path,
    ownerLineageId: correspondence.ownerLineageId,
    ownerKind: 'procedure',
    ownerOwnerLineageId: correspondence.targetOwnerLineageId,
    ownerFingerprint: valueFingerprint({
      targetIndex: decoded.targetIndex,
      proccode: decoded.proccode,
    }),
    containerLineageId: correspondence.containerLineageId,
    containerKind: 'block',
    containerFingerprint: valueFingerprint(decoded.block),
    memberKind: 'parameter',
    members: decoded.members.map((member) => asJson(member)),
    procedureMembers: decoded.members,
    proccode: decoded.proccode,
  }
}

function headEvidenceFromSurface(
  surface: ResolvedOrderedHeadSurface,
  lineageIds: readonly string[]
): OrderedCollectionHeadEvidence
{
  if (surface.members.length !== lineageIds.length)
    throw new OrderedCorrespondenceError(
      'incomplete',
      `correspondence length does not match ${surface.collectionPath ?? 'absent collection'}`
    )
  return {
    collectionKind: surface.collectionKind,
    collectionPath: surface.collectionPath,
    ownerLineageId: surface.ownerLineageId,
    ownerKind: surface.ownerKind,
    ownerOwnerLineageId: surface.ownerOwnerLineageId,
    ownerFingerprint: surface.ownerFingerprint,
    containerLineageId: surface.containerLineageId,
    containerKind: surface.containerKind,
    containerFingerprint: surface.containerFingerprint,
    members: surface.members.map((member, index) => ({
      lineageId: lineageIds[index]!,
      kind: surface.memberKind,
      ownerLineageId: surface.ownerLineageId,
      memberFingerprint: valueFingerprint(member),
    })),
  }
}

function activeRecord(
  records: ReadonlyMap<string, SemanticLineageRecord>,
  lineageId: string | null,
  kind: SemanticLineageRecord['kind'],
  label: string
): SemanticLineageRecord
{
  const record = lineageId === null ? undefined : records.get(lineageId)
  if (!record || record.status !== 'active' || record.kind !== kind)
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      `${label} must identify an active ${kind} lineage`
    )
  return record
}

function snapshotLineagesForSurface(
  snapshot: SemanticLineageSnapshot,
  correspondence: OrderedCollectionCorrespondence,
  surface: ResolvedOrderedHeadSurface
): readonly string[]
{
  const records = semanticLineageById(snapshot)
  if (correspondence.collectionKind === 'targets')
    return activeOrderedSemanticLineages(snapshot, 'target', null).map(
      (record) => record.lineageId
    )
  if (surface.collectionPath === null) return []
  const targetOwner = activeRecord(
    records,
    correspondence.targetOwnerLineageId,
    'target',
    'collection target owner'
  )
  if (
    correspondence.collectionKind === 'costumes' ||
    correspondence.collectionKind === 'sounds'
  )
  {
    if (
      correspondence.ownerLineageId !== targetOwner.lineageId ||
      correspondence.containerLineageId !== targetOwner.lineageId
    )
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        'media owner and container must match independent target lineage'
      )
    return activeOrderedSemanticLineages(
      snapshot,
      correspondence.collectionKind === 'costumes' ? 'costume' : 'sound',
      targetOwner.lineageId
    ).map((record) => record.lineageId)
  }
  const procedure = activeRecord(
    records,
    correspondence.ownerLineageId,
    'procedure',
    'procedure collection owner'
  )
  if (procedure.ownerLineageId !== targetOwner.lineageId)
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      'procedure lineage belongs to a different target owner'
    )
  const container = activeRecord(
    records,
    correspondence.containerLineageId,
    'block',
    'procedure collection container'
  )
  if (surface.collectionPath !== null)
  {
    const { blockId } = parseProcedurePath(surface.collectionPath)
    if (container.rawIdentity !== `block:${blockId}`)
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        'procedure container lineage does not bind the path block identity'
      )
  }
  const parameters = activeOrderedSemanticLineages(
    snapshot,
    'parameter',
    procedure.lineageId
  )
  for (let index = 0; index < parameters.length; index++)
  {
    if (
      `parameter:${surface.procedureMembers?.[index]?.argumentId}` !==
      parameters[index]?.rawIdentity
    )
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        `parameter lineage ${parameters[index]?.lineageId} does not bind decoded argument ID`
      )
  }
  return parameters.map((record) => record.lineageId)
}

function headBindingForSide(
  correspondence: ProjectOrderedCorrespondence,
  side: HeadSide
): { revisionIdentity: string; semanticSourceSha256: string }
{
  return side === 'before'
    ? {
        revisionIdentity: correspondence.beforeRevisionIdentity,
        semanticSourceSha256: correspondence.beforeSemanticSourceSha256,
      }
    : {
        revisionIdentity: correspondence.afterRevisionIdentity,
        semanticSourceSha256: correspondence.afterSemanticSourceSha256,
      }
}

export function captureProjectOrderedHeadEvidence(
  project: ProjectIR,
  correspondence: ProjectOrderedCorrespondence,
  side: HeadSide,
  head: SemanticLineageHeadEvidence
): ProjectOrderedHeadEvidence
{
  const validated = validateProjectOrderedCorrespondence(correspondence)
  const binding = headBindingForSide(validated, side)
  if (
    head.revisionIdentity !== binding.revisionIdentity ||
    head.semanticSourceSha256 !== binding.semanticSourceSha256
  )
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      `${side} lineage head identity does not match correspondence binding`
    )
  const lineageSnapshot = validateSemanticLineageSnapshot(head.lineageSnapshot)
  return {
    version: PROJECT_ORDERED_HEAD_VERSION_V1,
    ...binding,
    projectFingerprint: orderedHeadProjectFingerprint(project),
    lineageSnapshot,
    collections: correspondenceCollections(validated).map((collection) =>
    {
      const surface = resolveOrderedHeadSurface(project, collection, side)
      const snapshotLineages = snapshotLineagesForSurface(
        lineageSnapshot,
        collection,
        surface
      )
      if (
        !equalCorrespondenceValue(
          snapshotLineages,
          lineageIdsForSide(collection, side)
        )
      )
        throw new OrderedCorrespondenceError(
          'head-mismatch',
          `${side} correspondence member order differs from independent lineage head`
        )
      return headEvidenceFromSurface(surface, snapshotLineages)
    }),
  }
}

function verifyHeadEvidence(
  project: ProjectIR,
  correspondence: ProjectOrderedCorrespondence,
  evidence: ProjectOrderedHeadEvidence,
  side: HeadSide
): Map<OrderedCollectionCorrespondence, ResolvedOrderedHeadSurface>
{
  if (evidence.version !== PROJECT_ORDERED_HEAD_VERSION_V1)
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      `${side} correspondence evidence has an unsupported version`
    )
  const binding = headBindingForSide(correspondence, side)
  if (
    evidence.revisionIdentity !== binding.revisionIdentity ||
    evidence.semanticSourceSha256 !== binding.semanticSourceSha256
  )
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      `${side} correspondence evidence has the wrong revision or semantic source identity`
    )
  const lineageSnapshot = validateSemanticLineageSnapshot(
    evidence.lineageSnapshot
  )
  if (evidence.projectFingerprint !== orderedHeadProjectFingerprint(project))
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      `${side} correspondence evidence belongs to a different project head`
    )
  const collections = correspondenceCollections(correspondence)
  if (evidence.collections.length !== collections.length)
    throw new OrderedCorrespondenceError(
      'head-mismatch',
      `${side} correspondence evidence has missing or extra collections`
    )
  const surfaces = new Map<
    OrderedCollectionCorrespondence,
    ResolvedOrderedHeadSurface
  >()
  for (let index = 0; index < collections.length; index++)
  {
    const collection = collections[index]!
    const surface = resolveOrderedHeadSurface(project, collection, side)
    const snapshotLineages = snapshotLineagesForSurface(
      lineageSnapshot,
      collection,
      surface
    )
    if (
      !equalCorrespondenceValue(
        snapshotLineages,
        lineageIdsForSide(collection, side)
      )
    )
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        `${side} correspondence membership differs from lineage head`
      )
    const expected = headEvidenceFromSurface(surface, snapshotLineages)
    const actual = evidence.collections[index]
    if (!actual || !equalCorrespondenceValue(actual, expected))
      throw new OrderedCorrespondenceError(
        'head-mismatch',
        `${side} correspondence evidence does not match collection ${collection.collectionPath}`
      )
    surfaces.set(collection, surface)
  }
  return surfaces
}

interface LineagePathRule
{
  path: string
  exact: boolean
  entityLineageIds: readonly string[]
}

interface CorrespondenceRuntime
{
  rulesByTargetLineage: ReadonlyMap<string, readonly LineagePathRule[]>
  mediaChangesByTargetLineage: ReadonlyMap<string, readonly ValueDelta[]>
  correspondedEntityChanges: CorrespondedEntityDelta[]
}

function targetMemberMap(
  correspondence: OrderedCollectionCorrespondence
): ReadonlyMap<string, OrderedCollectionCorrespondence['members'][number]>
{
  return new Map(
    correspondence.members.map((member) => [member.lineageId, member])
  )
}

function pathTargetIndex(path: string): number
{
  const parts = path.slice(1).split('/').map(decodedPointerPart)
  if (parts[0] !== 'targets' || !/^(?:0|[1-9][0-9]*)$/.test(parts[1] ?? ''))
    throw new OrderedCorrespondenceError(
      'wrong-path',
      `nested correspondence has invalid target path: ${path}`
    )
  return Number(parts[1])
}

function verifyNestedOwnership(
  correspondence: ProjectOrderedCorrespondence
): void
{
  const targets = correspondence.targets
  const nested = [
    ...(correspondence.media ?? []),
    ...(correspondence.procedureParameters ?? []),
    ...(correspondence.procedureCallArguments ?? []),
  ]
  if (nested.length > 0 && !targets)
    throw new OrderedCorrespondenceError(
      'incomplete',
      'nested correspondence requires complete target correspondence'
    )
  if (!targets) return
  const members = targetMemberMap(targets)
  for (const collection of nested)
  {
    const targetOwner = collection.targetOwnerLineageId
    const targetMember = targetOwner ? members.get(targetOwner) : undefined
    if (!targetMember)
      throw new OrderedCorrespondenceError(
        'wrong-owner',
        `${collection.collectionKind} owner is not a corresponded target`
      )
    for (const side of ['before', 'after'] as const)
    {
      const path = collectionPathForSide(collection, side)
      const targetIndex =
        side === 'before' ? targetMember.beforeIndex : targetMember.afterIndex
      const mediaCollection =
        collection.collectionKind === 'costumes' ||
        collection.collectionKind === 'sounds'
      if (targetIndex === null && path !== null)
        throw new OrderedCorrespondenceError(
          'wrong-path',
          `${side} collection presence does not match its target owner`
        )
      if (targetIndex !== null && mediaCollection && path === null)
        throw new OrderedCorrespondenceError(
          'wrong-path',
          `${side} collection presence does not match its target owner`
        )
      if (path !== null && pathTargetIndex(path) !== targetIndex)
        throw new OrderedCorrespondenceError(
          'wrong-path',
          `${side} collection path does not match its target owner`
        )
      if (
        path !== null &&
        mediaCollection &&
        path !== `/targets/${targetIndex}/${collection.collectionKind}`
      )
        throw new OrderedCorrespondenceError(
          'wrong-path',
          `${side} media path does not match its target owner`
        )
    }
  }
}

function collectionMemberSurface(
  surface: ResolvedOrderedHeadSurface,
  index: number | null
): Json | undefined
{
  return index === null ? undefined : surface.members[index]
}

function collectionOperationIds(
  correspondence: OrderedCollectionCorrespondence,
  attribution: AttributionIndex
): string[]
{
  const ids = new Set(attribution.forProjectPath(correspondence.collectionPath))
  if (
    correspondence.collectionKind === 'costumes' ||
    correspondence.collectionKind === 'sounds'
  )
  {
    const targetIndex = pathTargetIndex(correspondence.collectionPath)
    for (const operationId of attribution.forTargetProperty(
      targetIndex,
      correspondence.collectionKind,
      correspondence.collectionPath
    ))
      ids.add(operationId)
  }
  else if (
    correspondence.collectionKind === 'procedure-parameters' ||
    correspondence.collectionKind === 'procedure-call-arguments'
  )
  {
    const parsed = parseProcedurePath(correspondence.collectionPath)
    const blockPath = `/targets/${parsed.targetIndex}/blocks/${pointerPart(parsed.blockId)}`
    for (const operationId of attribution.forBlock(
      parsed.targetIndex,
      parsed.blockId,
      [blockPath, correspondence.collectionPath]
    ))
      ids.add(operationId)
  }
  return [...ids].sort(compareText)
}

function semanticMemberDeltas(
  correspondence: OrderedCollectionCorrespondence,
  beforeSurface: ResolvedOrderedHeadSurface,
  afterSurface: ResolvedOrderedHeadSurface,
  attribution: AttributionIndex
): CorrespondedEntityDelta[]
{
  const baseOperationIds = collectionOperationIds(correspondence, attribution)
  const output: CorrespondedEntityDelta[] = []
  for (const member of correspondence.members)
  {
    const before = collectionMemberSurface(beforeSurface, member.beforeIndex)
    const after = collectionMemberSurface(afterSurface, member.afterIndex)
    const semanticPath = `${correspondence.collectionPath}/$members/${pointerPart(member.lineageId)}`
    const operationIds = [...baseOperationIds]
    const changes = collectLeafChanges(before, after, semanticPath).map(
      (change) => ({
        ...change,
        operationIds,
        entityLineageIds: [member.lineageId],
      })
    )
    if (changes.length > 0)
      output.push({
        collectionKind: correspondence.collectionKind,
        collectionPath: correspondence.collectionPath,
        ownerLineageId: correspondence.ownerLineageId,
        entityLineageId: member.lineageId,
        changes,
      })
  }
  if (
    (correspondence.collectionKind === 'procedure-parameters' ||
      correspondence.collectionKind === 'procedure-call-arguments') &&
    beforeSurface.proccode !== afterSurface.proccode &&
    correspondence.ownerLineageId !== null
  )
  {
    const ownerLineageId = correspondence.ownerLineageId
    output.push({
      collectionKind: correspondence.collectionKind,
      collectionPath: correspondence.collectionPath,
      ownerLineageId,
      entityLineageId: ownerLineageId,
      changes: [
        {
          path: `${correspondence.collectionPath}/$owner/proccode`,
          kind:
            beforeSurface.proccode === undefined
              ? 'added'
              : afterSurface.proccode === undefined
                ? 'removed'
                : 'changed',
          ...(beforeSurface.proccode !== undefined
            ? { before: beforeSurface.proccode }
            : {}),
          ...(afterSurface.proccode !== undefined
            ? { after: afterSurface.proccode }
            : {}),
          operationIds: [...baseOperationIds],
          entityLineageIds: [ownerLineageId],
        },
      ],
    })
  }
  return output
}

function directMediaMemberDeltas(
  correspondence: OrderedCollectionCorrespondence,
  beforeSurface: ResolvedOrderedHeadSurface,
  afterSurface: ResolvedOrderedHeadSurface,
  attribution: AttributionIndex
): ValueDelta[]
{
  const operationIds = collectionOperationIds(correspondence, attribution)
  const output: ValueDelta[] = []
  for (const member of correspondence.members)
  {
    const before = collectionMemberSurface(beforeSurface, member.beforeIndex)
    const after = collectionMemberSurface(afterSurface, member.afterIndex)
    const memberPath =
      member.afterIndex !== null && correspondence.afterCollectionPath !== null
        ? `${correspondence.afterCollectionPath}/${member.afterIndex}`
        : member.beforeIndex !== null &&
            correspondence.beforeCollectionPath !== null
          ? `${correspondence.beforeCollectionPath}/${member.beforeIndex}`
          : null
    if (memberPath === null)
      throw new OrderedCorrespondenceError(
        'wrong-path',
        `media member ${member.lineageId} has no head-local path`
      )
    output.push(
      ...collectLeafChanges(before, after, memberPath).map((change) => ({
        ...change,
        operationIds,
        entityLineageIds: [member.lineageId],
      }))
    )
  }
  return output
}

function changedProcedureMembers(
  correspondence: OrderedCollectionCorrespondence,
  beforeSurface: ResolvedOrderedHeadSurface,
  afterSurface: ResolvedOrderedHeadSurface,
  field: 'argumentId' | 'name' | 'defaultValue' | 'placeholder' | 'input',
  includeMoves: boolean
): string[]
{
  const output: string[] = []
  for (const member of correspondence.members)
  {
    const beforeIndex = member.beforeIndex
    const afterIndex = member.afterIndex
    const before =
      beforeIndex === null
        ? undefined
        : beforeSurface.procedureMembers?.[beforeIndex]?.[field]
    const after =
      afterIndex === null
        ? undefined
        : afterSurface.procedureMembers?.[afterIndex]?.[field]
    if (
      beforeIndex === null ||
      afterIndex === null ||
      (includeMoves && beforeIndex !== afterIndex) ||
      !equalJson(before, after)
    )
      output.push(member.lineageId)
  }
  return output
}

function normalizedProcedureBlockPath(
  collection: OrderedCollectionCorrespondence,
  outputTargetIndex: number,
  side: HeadSide
): string | null
{
  const path = collectionPathForSide(collection, side)
  if (path === null) return null
  const parsed = parseProcedurePath(path)
  return `/targets/${outputTargetIndex}/blocks/${pointerPart(parsed.blockId)}`
}

function addProcedureRules(
  rules: LineagePathRule[],
  collection: OrderedCollectionCorrespondence,
  beforeSurface: ResolvedOrderedHeadSurface,
  afterSurface: ResolvedOrderedHeadSurface,
  outputTargetIndex: number
): void
{
  const owner = collection.ownerLineageId ? [collection.ownerLineageId] : []
  const container = collection.containerLineageId
    ? [collection.containerLineageId]
    : []
  const allMembers = collection.members.map((member) => member.lineageId)
  const allEntities = [...new Set([...container, ...owner, ...allMembers])]
  for (const side of ['before', 'after'] as const)
  {
    const blockPath = normalizedProcedureBlockPath(
      collection,
      outputTargetIndex,
      side
    )
    if (blockPath === null) continue
    rules.push({
      path: blockPath,
      exact: true,
      entityLineageIds: allEntities,
    })
    if (collection.collectionKind === 'procedure-parameters')
    {
      const fields = [
        ['argumentids', 'argumentId', true],
        ['argumentnames', 'name', true],
        ['argumentdefaults', 'defaultValue', true],
      ] as const
      for (const [rawField, semanticField, includeMoves] of fields)
      {
        const affected = changedProcedureMembers(
          collection,
          beforeSurface,
          afterSurface,
          semanticField,
          includeMoves
        )
        rules.push({
          path: `${blockPath}/mutation/${rawField}`,
          exact: true,
          entityLineageIds: [
            ...new Set([
              ...container,
              ...(rawField === 'argumentids' ? owner : []),
              ...affected,
            ]),
          ],
        })
      }
      const placeholderMembers = changedProcedureMembers(
        collection,
        beforeSurface,
        afterSurface,
        'placeholder',
        true
      )
      rules.push({
        path: `${blockPath}/mutation/proccode`,
        exact: true,
        entityLineageIds: [
          ...new Set([...container, ...owner, ...placeholderMembers]),
        ],
      })
    }
    else
    {
      const argumentIds = changedProcedureMembers(
        collection,
        beforeSurface,
        afterSurface,
        'argumentId',
        true
      )
      rules.push({
        path: `${blockPath}/mutation/argumentids`,
        exact: true,
        entityLineageIds: [
          ...new Set([...container, ...owner, ...argumentIds]),
        ],
      })
      rules.push({
        path: `${blockPath}/mutation/proccode`,
        exact: true,
        entityLineageIds: [...new Set([...container, ...owner])],
      })
      for (const member of collection.members)
      {
        const beforeId =
          member.beforeIndex === null
            ? undefined
            : beforeSurface.procedureMembers?.[member.beforeIndex]?.argumentId
        const afterId =
          member.afterIndex === null
            ? undefined
            : afterSurface.procedureMembers?.[member.afterIndex]?.argumentId
        for (const argumentId of new Set(
          [beforeId, afterId].filter(
            (value): value is string => value !== undefined
          )
        ))
          rules.push({
            path: `${blockPath}/inputs/${pointerPart(argumentId)}`,
            exact: false,
            entityLineageIds: [...new Set([...container, member.lineageId])],
          })
      }
    }
    rules.push({
      path: blockPath,
      exact: false,
      entityLineageIds: container.length > 0 ? container : owner,
    })
  }
}

function matchingRule(
  rules: readonly LineagePathRule[],
  path: string,
  defaultLineageId: string
): readonly string[]
{
  const matching = rules.find((rule) =>
    rule.exact
      ? path === rule.path
      : path === rule.path || path.startsWith(`${rule.path}/`)
  )
  return matching?.entityLineageIds ?? [defaultLineageId]
}

function procedureBlockKey(path: string | null): string | null
{
  if (path === null) return null
  const parsed = parseProcedurePath(path)
  return `${parsed.targetIndex}\u0000${parsed.blockId}`
}

function mutationForProcedurePath(
  project: ProjectIR,
  path: string | null
): Block['mutation'] | undefined
{
  if (path === null) return undefined
  const parsed = parseProcedurePath(path)
  const block = ownRecordValue(
    project.json.targets[parsed.targetIndex]?.blocks,
    parsed.blockId
  )
  return isBlockEntry(block) ? block.mutation : undefined
}

function rejectRawOnlyProcedureChanges(
  baseline: ProjectIR,
  candidate: ProjectIR,
  collection: OrderedCollectionCorrespondence,
  beforeSurface: ResolvedOrderedHeadSurface,
  afterSurface: ResolvedOrderedHeadSurface
): void
{
  if (
    collection.collectionKind !== 'procedure-parameters' &&
    collection.collectionKind !== 'procedure-call-arguments'
  )
    return
  const beforeMutation = mutationForProcedurePath(
    baseline,
    collection.beforeCollectionPath
  )
  const afterMutation = mutationForProcedurePath(
    candidate,
    collection.afterCollectionPath
  )
  const checks =
    collection.collectionKind === 'procedure-parameters'
      ? ([
          ['argumentids', 'argumentId'],
          ['argumentnames', 'name'],
          ['argumentdefaults', 'defaultValue'],
        ] as const)
      : ([['argumentids', 'argumentId']] as const)
  for (const [rawField, semanticField] of checks)
  {
    if (beforeMutation?.[rawField] === afterMutation?.[rawField]) continue
    const affected = changedProcedureMembers(
      collection,
      beforeSurface,
      afterSurface,
      semanticField,
      true
    )
    if (affected.length === 0)
      throw new OrderedCorrespondenceError(
        'member-mismatch',
        `${collection.collectionPath}: raw ${rawField} changed without a semantic procedure change`
      )
  }
}

function verifyCorrespondenceCompleteness(
  baseline: ProjectIR,
  candidate: ProjectIR,
  correspondence: ProjectOrderedCorrespondence
): void
{
  const targets = correspondence.targets
  if (!targets) return
  const media = correspondence.media ?? []
  const procedures = [
    ...(correspondence.procedureParameters ?? []),
    ...(correspondence.procedureCallArguments ?? []),
  ]
  for (const targetMember of targets.members)
  {
    const beforeTarget =
      targetMember.beforeIndex === null
        ? undefined
        : baseline.json.targets[targetMember.beforeIndex]
    const afterTarget =
      targetMember.afterIndex === null
        ? undefined
        : candidate.json.targets[targetMember.afterIndex]
    for (const field of ['costumes', 'sounds'] as const)
    {
      if (equalJson(beforeTarget?.[field] ?? [], afterTarget?.[field] ?? []))
        continue
      if (
        !media.some(
          (collection) =>
            collection.collectionKind === field &&
            collection.ownerLineageId === targetMember.lineageId
        )
      )
        throw new OrderedCorrespondenceError(
          'incomplete',
          `changed ${field} collection lacks exact correspondence`
        )
    }
    const blockIds = new Set([
      ...ownRecordKeys(beforeTarget?.blocks),
      ...ownRecordKeys(afterTarget?.blocks),
    ])
    for (const blockId of blockIds)
    {
      const beforeBlock = ownRecordValue(beforeTarget?.blocks, blockId)
      const afterBlock = ownRecordValue(afterTarget?.blocks, blockId)
      const role =
        (isBlockEntry(beforeBlock) ? beforeBlock.opcode : undefined) ??
        (isBlockEntry(afterBlock) ? afterBlock.opcode : undefined)
      const collectionKind =
        role === 'procedures_prototype'
          ? 'procedure-parameters'
          : role === 'procedures_call'
            ? 'procedure-call-arguments'
            : null
      if (collectionKind === null) continue
      const relevantBefore =
        collectionKind === 'procedure-parameters'
          ? isBlockEntry(beforeBlock)
            ? beforeBlock.mutation
            : undefined
          : isBlockEntry(beforeBlock)
            ? { mutation: beforeBlock.mutation, inputs: beforeBlock.inputs }
            : undefined
      const relevantAfter =
        collectionKind === 'procedure-parameters'
          ? isBlockEntry(afterBlock)
            ? afterBlock.mutation
            : undefined
          : isBlockEntry(afterBlock)
            ? { mutation: afterBlock.mutation, inputs: afterBlock.inputs }
            : undefined
      if (equalJson(relevantBefore, relevantAfter)) continue
      const beforeKey =
        targetMember.beforeIndex === null
          ? null
          : `${targetMember.beforeIndex}\u0000${blockId}`
      const afterKey =
        targetMember.afterIndex === null
          ? null
          : `${targetMember.afterIndex}\u0000${blockId}`
      if (
        !procedures.some(
          (collection) =>
            collection.collectionKind === collectionKind &&
            (procedureBlockKey(collection.beforeCollectionPath) === beforeKey ||
              procedureBlockKey(collection.afterCollectionPath) === afterKey)
        )
      )
        throw new OrderedCorrespondenceError(
          'incomplete',
          `changed ${collectionKind} surface lacks exact correspondence`
        )
    }
  }
}

function procedureCorrespondenceChanged(
  collection: OrderedCollectionCorrespondence,
  beforeSurface: ResolvedOrderedHeadSurface,
  afterSurface: ResolvedOrderedHeadSurface
): boolean
{
  return (
    !equalJson(beforeSurface.procedureMembers, afterSurface.procedureMembers) ||
    beforeSurface.proccode !== afterSurface.proccode ||
    collection.members.some(
      (member) =>
        member.beforeIndex !== null &&
        member.afterIndex !== null &&
        member.beforeIndex !== member.afterIndex
    )
  )
}

function requireChangedProcedureCallAdapters(
  baseline: ProjectIR,
  candidate: ProjectIR,
  correspondence: ProjectOrderedCorrespondence,
  beforeSurfaces: ReadonlyMap<
    OrderedCollectionCorrespondence,
    ResolvedOrderedHeadSurface
  >,
  afterSurfaces: ReadonlyMap<
    OrderedCollectionCorrespondence,
    ResolvedOrderedHeadSurface
  >
): void
{
  const parametersByOwner = new Map<string, OrderedCollectionCorrespondence>()
  for (const parameters of correspondence.procedureParameters ?? [])
  {
    if (parametersByOwner.has(parameters.ownerLineageId!))
      throw new OrderedCorrespondenceError(
        'wrong-owner',
        `duplicate procedure owner: ${parameters.ownerLineageId}`
      )
    parametersByOwner.set(parameters.ownerLineageId!, parameters)
  }
  for (const call of correspondence.procedureCallArguments ?? [])
  {
    const parameters = parametersByOwner.get(call.ownerLineageId!)
    if (
      !parameters ||
      parameters.targetOwnerLineageId !== call.targetOwnerLineageId ||
      !equalJson(parameters.beforeLineageIds, call.beforeLineageIds) ||
      !equalJson(parameters.afterLineageIds, call.afterLineageIds)
    )
      throw new OrderedCorrespondenceError(
        'wrong-owner',
        `${call.collectionPath}: call arguments do not bind the exact procedure parameters`
      )
  }
  for (const parameters of parametersByOwner.values())
  {
    const beforeSurface = beforeSurfaces.get(parameters)!
    const afterSurface = afterSurfaces.get(parameters)!
    if (
      !procedureCorrespondenceChanged(parameters, beforeSurface, afterSurface)
    )
      continue
    for (const [side, project, surface] of [
      ['before', baseline, beforeSurface],
      ['after', candidate, afterSurface],
    ] as const)
    {
      const path = collectionPathForSide(parameters, side)
      if (path === null || surface.proccode === undefined) continue
      const targetIndex = pathTargetIndex(path)
      for (const [blockId, entry] of ownRecordEntries(
        project.json.targets[targetIndex]?.blocks
      ))
      {
        if (
          !isBlockEntry(entry) ||
          entry.opcode !== 'procedures_call' ||
          entry.mutation?.proccode !== surface.proccode
        )
          continue
        const callKey = `${targetIndex}\u0000${blockId}`
        const covered = (correspondence.procedureCallArguments ?? []).some(
          (call) =>
            call.ownerLineageId === parameters.ownerLineageId &&
            procedureBlockKey(collectionPathForSide(call, side)) === callKey
        )
        if (!covered)
          throw new OrderedCorrespondenceError(
            'incomplete',
            `${side} call ${blockId} lacks an adapter for changed procedure ${parameters.ownerLineageId}`
          )
      }
    }
  }
}

function buildCorrespondenceRuntime(
  baseline: ProjectIR,
  candidate: ProjectIR,
  correspondence: ProjectOrderedCorrespondence,
  evidence: ProjectOrderedCorrespondenceEvidence,
  attribution: AttributionIndex
): CorrespondenceRuntime
{
  verifyNestedOwnership(correspondence)
  verifyCorrespondenceCompleteness(baseline, candidate, correspondence)
  const beforeSurfaces = verifyHeadEvidence(
    baseline,
    correspondence,
    evidence.before,
    'before'
  )
  const afterSurfaces = verifyHeadEvidence(
    candidate,
    correspondence,
    evidence.after,
    'after'
  )
  requireChangedProcedureCallAdapters(
    baseline,
    candidate,
    correspondence,
    beforeSurfaces,
    afterSurfaces
  )
  const targets = correspondence.targets
  const rulesByTargetLineage = new Map<string, LineagePathRule[]>()
  const mediaChangesByTargetLineage = new Map<string, ValueDelta[]>()
  const correspondedEntityChanges: CorrespondedEntityDelta[] = []
  if (!targets)
    return {
      rulesByTargetLineage,
      mediaChangesByTargetLineage,
      correspondedEntityChanges,
    }
  const targetMembers = targetMemberMap(targets)
  const procedureOwnerProccodes = new Map<string, Set<string>>()
  for (const collection of correspondenceCollections(correspondence))
  {
    const beforeSurface = beforeSurfaces.get(collection)!
    const afterSurface = afterSurfaces.get(collection)!
    if (collection.collectionKind === 'targets') continue
    rejectRawOnlyProcedureChanges(
      baseline,
      candidate,
      collection,
      beforeSurface,
      afterSurface
    )
    correspondedEntityChanges.push(
      ...semanticMemberDeltas(
        collection,
        beforeSurface,
        afterSurface,
        attribution
      )
    )
    const targetOwner = collection.targetOwnerLineageId!
    const target = targetMembers.get(targetOwner)!
    const outputTargetIndex = target.afterIndex ?? target.beforeIndex!
    const rules = rulesByTargetLineage.get(targetOwner) ?? []
    if (
      collection.collectionKind === 'costumes' ||
      collection.collectionKind === 'sounds'
    )
    {
      const mediaChanges = mediaChangesByTargetLineage.get(targetOwner) ?? []
      mediaChanges.push(
        ...directMediaMemberDeltas(
          collection,
          beforeSurface,
          afterSurface,
          attribution
        )
      )
      mediaChangesByTargetLineage.set(targetOwner, mediaChanges)
    }
    else
    {
      addProcedureRules(
        rules,
        collection,
        beforeSurface,
        afterSurface,
        outputTargetIndex
      )
      const proccodes =
        procedureOwnerProccodes.get(collection.ownerLineageId!) ??
        new Set<string>()
      for (const proccode of [beforeSurface.proccode, afterSurface.proccode])
      {
        if (proccode !== undefined) proccodes.add(proccode)
      }
      procedureOwnerProccodes.set(collection.ownerLineageId!, proccodes)
    }
    rulesByTargetLineage.set(targetOwner, rules)
  }
  for (const [ownerLineageId, proccodes] of procedureOwnerProccodes)
  {
    if (proccodes.size > 2)
      throw new OrderedCorrespondenceError(
        'wrong-owner',
        `procedure owner ${ownerLineageId} binds unrelated prototypes or calls`
      )
    const parameterAdapter = (correspondence.procedureParameters ?? []).some(
      (collection) => collection.ownerLineageId === ownerLineageId
    )
    const callAdapter = (correspondence.procedureCallArguments ?? []).some(
      (collection) => collection.ownerLineageId === ownerLineageId
    )
    if (callAdapter && !parameterAdapter)
      throw new OrderedCorrespondenceError(
        'wrong-owner',
        `procedure call owner ${ownerLineageId} has no matching prototype adapter`
      )
  }
  for (const rules of rulesByTargetLineage.values())
    rules.sort((a, b) => b.path.length - a.path.length)
  return {
    rulesByTargetLineage,
    mediaChangesByTargetLineage,
    correspondedEntityChanges,
  }
}

function orderedCollectionDeltas(
  correspondence: ProjectOrderedCorrespondence,
  attribution: AttributionIndex
): OrderedCollectionDelta[]
{
  const changes: OrderedCollectionDelta[] = []
  for (const collection of correspondenceCollections(correspondence))
  {
    const baseOperationIds = collectionOperationIds(collection, attribution)
    for (const member of collection.members)
    {
      const kind: OrderedCollectionChangeKind | null =
        member.beforeIndex === null
          ? 'added'
          : member.afterIndex === null
            ? 'removed'
            : member.beforeIndex !== member.afterIndex
              ? 'moved'
              : null
      if (kind === null) continue
      changes.push({
        collectionKind: collection.collectionKind,
        collectionPath: collection.collectionPath,
        ownerLineageId: collection.ownerLineageId,
        lineageId: member.lineageId,
        kind,
        ...(member.beforeIndex !== null
          ? { beforeIndex: member.beforeIndex }
          : {}),
        ...(member.afterIndex !== null
          ? { afterIndex: member.afterIndex }
          : {}),
        operationIds: [...baseOperationIds],
      })
    }
  }
  return changes
}

function targetLineageOrder(
  rows: readonly {
    lineageId: string
    index: number
    target: Target
  }[],
  orderKind: 'serialized' | 'visual' | 'runtime-executable'
): string[]
{
  if (orderKind === 'visual')
    return [...rows]
      .filter((row) => !row.target.isStage)
      .sort(
        (left, right) =>
          left.target.layerOrder! - right.target.layerOrder! ||
          left.index - right.index
      )
      .map((row) => row.lineageId)
  return [...rows]
    .filter((row) => orderKind === 'serialized' || !row.target.isStage)
    .sort((left, right) => left.index - right.index)
    .map((row) => row.lineageId)
}

function derivedTargetOrderChanges(
  before: ProjectIR,
  after: ProjectIR,
  correspondence: OrderedCollectionCorrespondence,
  attribution: AttributionIndex
): ValueDelta[]
{
  const entityLineageIds = [
    ...new Set([
      ...correspondence.beforeLineageIds,
      ...correspondence.afterLineageIds,
    ]),
  ].sort()
  const rows = (project: ProjectIR, side: HeadSide) =>
    correspondence.members.flatMap((member) =>
    {
      const index = side === 'before' ? member.beforeIndex : member.afterIndex
      if (index === null) return []
      const target = project.json.targets[index]
      return target ? [{ lineageId: member.lineageId, index, target }] : []
    })
  const beforeRows = rows(before, 'before')
  const afterRows = rows(after, 'after')
  const changes: ValueDelta[] = []
  for (const [orderKind, path] of [
    ['serialized', '/serializedTargetOrder'],
    ['visual', '/visualTargetOrder'],
    ['runtime-executable', '/runtimeExecutableTargetOrder'],
  ] as const)
  {
    const beforeOrder = targetLineageOrder(beforeRows, orderKind)
    const afterOrder = targetLineageOrder(afterRows, orderKind)
    if (equalJson(beforeOrder, afterOrder)) continue
    changes.push({
      path,
      kind: 'changed',
      before: asJson(beforeOrder),
      after: asJson(afterOrder),
      operationIds: attribution.forProjectPath(path),
      entityLineageIds: [...entityLineageIds],
    })
  }
  return changes
}

export function computeProjectDelta(
  baseline: ProjectIR,
  candidate: ProjectIR,
  attribution: readonly DeltaOperationAttribution[] = [],
  options: ProjectDeltaOptions = {}
): ProjectDelta
{
  const attributionIndex = new AttributionIndex(attribution)
  const correspondence = options.correspondence
    ? validateProjectOrderedCorrespondence(options.correspondence)
    : undefined
  if (correspondence && !options.correspondenceEvidence)
    throw new OrderedCorrespondenceError(
      'missing-evidence',
      'ordered correspondence requires independent before & after head evidence'
    )
  const correspondenceRuntime =
    correspondence && options.correspondenceEvidence
      ? buildCorrespondenceRuntime(
          baseline,
          candidate,
          correspondence,
          options.correspondenceEvidence,
          attributionIndex
        )
      : undefined
  const targetCorrespondence = correspondence?.targets
  const protectedChanges: ProtectedChange[] = []
  const assets = computeAssetDeltas(
    baseline.assets,
    candidate.assets,
    attributionIndex
  )
  for (const asset of assets)
  {
    const path = `/assets/${pointerPart(asset.path)}/${asset.occurrence}`
    pushProtected(
      protectedChanges,
      { path, operationIds: asset.operationIds },
      'asset',
      'asset path, byte length, or SHA-256 changed'
    )
    protectUnattributed(protectedChanges, [
      { path, operationIds: asset.operationIds },
    ])
  }

  const orderedCollectionChanges =
    correspondence && correspondenceCollections(correspondence).length > 0
      ? orderedCollectionDeltas(correspondence, attributionIndex)
      : undefined
  const derivedProjectChanges = targetCorrespondence
    ? derivedTargetOrderChanges(
        baseline,
        candidate,
        targetCorrespondence,
        attributionIndex
      )
    : undefined
  for (const change of orderedCollectionChanges ?? [])
  {
    if (
      change.collectionKind !== 'targets' &&
      change.collectionKind !== 'costumes' &&
      change.collectionKind !== 'sounds'
    )
      continue
    const protectedClass: ProtectedChangeClass =
      change.collectionKind === 'targets' ? 'project-structure' : 'asset'
    pushProtected(
      protectedChanges,
      {
        path: change.collectionPath,
        operationIds: change.operationIds,
        entityLineageIds: [change.lineageId],
      },
      protectedClass,
      `${change.collectionKind} member ${change.kind}`,
      false
    )
    protectUnattributed(protectedChanges, [
      {
        path: change.collectionPath,
        operationIds: change.operationIds,
        entityLineageIds: [change.lineageId],
      },
    ])
  }

  const targets: TargetDelta[] = []
  if (targetCorrespondence)
  {
    const orderedTargetMembers = [...targetCorrespondence.members].sort(
      (a, b) =>
      {
        const aIndex = a.afterIndex ?? Number.MAX_SAFE_INTEGER
        const bIndex = b.afterIndex ?? Number.MAX_SAFE_INTEGER
        return aIndex - bIndex || (a.beforeIndex ?? 0) - (b.beforeIndex ?? 0)
      }
    )
    for (const member of orderedTargetMembers)
    {
      const targetIndex = member.afterIndex ?? member.beforeIndex!
      const media = (correspondence?.media ?? []).filter(
        (value) => value.ownerLineageId === member.lineageId
      )
      const before =
        member.beforeIndex === null
          ? undefined
          : baseline.json.targets[member.beforeIndex]
      const after =
        member.afterIndex === null
          ? undefined
          : candidate.json.targets[member.afterIndex]
      const delta = computeTargetDelta(
        before,
        after,
        targetIndex,
        attributionIndex,
        protectedChanges,
        {
          lineageId: member.lineageId,
          beforeTargetIndex: member.beforeIndex,
          afterTargetIndex: member.afterIndex,
          skipFields: new Set(
            media.map((collection) => collection.collectionKind)
          ),
          additionalAssetMetadataChanges:
            correspondenceRuntime?.mediaChangesByTargetLineage.get(
              member.lineageId
            ) ?? [],
          entityLineagesForPath: (path) =>
            matchingRule(
              correspondenceRuntime?.rulesByTargetLineage.get(
                member.lineageId
              ) ?? [],
              path,
              member.lineageId
            ),
        }
      )
      if (delta) targets.push(delta)
    }
  }
  else
  {
    const targetCount = Math.max(
      baseline.json.targets.length,
      candidate.json.targets.length
    )
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex++)
    {
      const delta = computeTargetDelta(
        baseline.json.targets[targetIndex],
        candidate.json.targets[targetIndex],
        targetIndex,
        attributionIndex,
        protectedChanges
      )
      if (delta) targets.push(delta)
    }
  }

  const baselineRoot = baseline.json as unknown as Record<string, unknown>
  const candidateRoot = candidate.json as unknown as Record<string, unknown>
  const projectChanges: ProjectChange[] = []
  const rootFields = [
    ...new Set([
      ...ownRecordKeys(baselineRoot),
      ...ownRecordKeys(candidateRoot),
    ]),
  ]
    .filter((field) => field !== 'targets')
    .sort()
  for (const field of rootFields)
  {
    const beforeValue = ownRecordValue(baselineRoot, field)
    const afterValue = ownRecordValue(candidateRoot, field)
    if (equalJson(beforeValue, afterValue)) continue
    const changeClass: ProjectChangeClass =
      field === 'monitors'
        ? 'existing-editor-layout'
        : KNOWN_ROOT_FIELDS.has(field)
          ? 'metadata'
          : 'unknown'
    const leaves = collectLeafChanges(
      beforeValue,
      afterValue,
      `/${pointerPart(field)}`
    )
    for (const leaf of leaves)
    {
      const change = projectChange(changeClass, leaf, attributionIndex)
      projectChanges.push(change)
      pushProtected(
        protectedChanges,
        change.change,
        changeClass,
        changeClass === 'unknown'
          ? 'unrecognized project field changed'
          : changeClass === 'existing-editor-layout'
            ? 'monitor value, visibility, or geometry changed'
            : 'extension or project metadata changed',
        changeClass === 'unknown'
      )
      protectUnattributed(protectedChanges, [change.change])
    }
  }

  const blockChanges = targets.flatMap((target) => target.blockChanges)
  const touchedScripts = uniqueScripts(
    targets.flatMap((target) => target.touchedScripts)
  )
  const changedExistingEditorLayout =
    targets.reduce(
      (count, target) => count + target.existingEditorLayoutChanges.length,
      0
    ) +
    blockChanges.reduce(
      (count, block) =>
        count +
        (block.classes.includes('existing-editor-layout')
          ? block.changes.length
          : 0),
      0
    ) +
    projectChanges.filter((change) => change.class === 'existing-editor-layout')
      .length
  const changedUnknownFields =
    targets.reduce((count, target) => count + target.unknownChanges.length, 0) +
    projectChanges.filter((change) => change.class === 'unknown').length +
    blockChanges.reduce(
      (count, block) => count + (block.classes.includes('unknown') ? 1 : 0),
      0
    )
  const summary: DeltaSummary = {
    touchedTargets:
      targets.length +
      (orderedCollectionChanges?.filter(
        (change) =>
          change.collectionKind === 'targets' &&
          !targets.some((target) => target.lineageId === change.lineageId)
      ).length ?? 0),
    touchedScripts: touchedScripts.length,
    addedBlocks: blockChanges.filter((block) => block.kind === 'added').length,
    removedBlocks: blockChanges.filter((block) => block.kind === 'removed')
      .length,
    changedBlockRecords: blockChanges.length,
    changedAuthoredBlocks: blockChanges.filter((block) =>
      block.classes.includes('authored')
    ).length,
    graphLinkOnlyBlocks: blockChanges.filter((block) =>
      block.classes.includes('graph-link-only')
    ).length,
    changedDeclarations: targets.reduce(
      (count, target) => count + target.declarationChanges.length,
      0
    ),
    changedGameplayProperties: targets.reduce(
      (count, target) => count + target.gameplayPropertyChanges.length,
      0
    ),
    changedExistingEditorLayout,
    changedAssets:
      assets.length +
      targets.reduce(
        (count, target) => count + target.assetMetadataChanges.length,
        0
      ) +
      (orderedCollectionChanges?.filter(
        (change) =>
          change.kind === 'moved' &&
          (change.collectionKind === 'costumes' ||
            change.collectionKind === 'sounds')
      ).length ?? 0),
    changedProjectMetadata: projectChanges.filter(
      (change) => change.class === 'metadata'
    ).length,
    changedUnknownFields,
  }

  return {
    complete: true,
    targets,
    assets,
    projectChanges,
    ...(derivedProjectChanges && derivedProjectChanges.length > 0
      ? { derivedProjectChanges }
      : {}),
    ...(orderedCollectionChanges ? { orderedCollectionChanges } : {}),
    ...(correspondenceRuntime?.correspondedEntityChanges.length
      ? {
          correspondedEntityChanges:
            correspondenceRuntime.correspondedEntityChanges,
        }
      : {}),
    protectedChanges,
    summary,
  }
}
