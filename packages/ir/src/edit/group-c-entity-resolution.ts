// packages/ir/src/edit/group-c-entity-resolution.ts
// resolve Group C selectors to exact token-free semantic entity evidence

import {
  isBlockEntry,
  type Asset,
  type Block,
  type Comment,
  type Costume,
  type Sound,
  type Target,
} from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type { ProjectIR } from '../project/project-ir.js'
import type {
  BlockLocationV1,
  BlockRefV1,
  BoundedBlockLocationProjectionV1,
  BoundedCommentLocationProjectionV1,
  BoundedDeclarationLocationProjectionV1,
  BoundedDisplayStringV1,
  BoundedOwnershipStepV1,
  BoundedScriptLocationProjectionV1,
  BoundedTargetLocationProjectionV1,
  CommentLocationV1,
  CommentRefV1,
  DeclarationLocationV1,
  DeclarationRefV1,
  ExistingNullableOptionalNumberV1,
  ExistingOptionalBooleanV1,
  ExistingOptionalNumberV1,
  MatchSetSelectionV1,
  BoundedMediaLocationProjectionV1,
  MediaLocationV1,
  MediaRefV1,
  OwnershipStepV1,
  ScriptLocationV1,
  ScriptRefV1,
  StructuralMatchScopeV1,
  ParameterLocationV1,
  ProcedureLocationV1,
  TargetLocationV1,
} from './contracts.generated.js'
import { VANILLA_CORE_DESCRIPTORS } from './catalog.js'
import {
  commentSemanticFingerprintV1,
  commentTextSha256V1,
} from './comment-operations.js'
import { semanticHashV1 } from './hash-domains.js'
import { compareLexicalTextV1 as compareText } from './lexical-order.js'
import {
  mediaArchivePathV1,
  mediaSemanticFingerprintV1,
} from './media-operations.js'
import { ownRecordKeys, ownRecordValue } from './own-record.js'
import {
  procedureParameterTypeForPlaceholderV1,
  type ProcedureParameterTypeV1,
} from './procedure-parameter-catalog.js'
import {
  buildSemanticReferenceIndex,
  procedureHasExactAuthorableTopologyV1,
} from './reference-index.js'
import {
  blockKey,
  declarationKey,
  scriptKey,
  type IndexedBlock,
  type IndexedComment,
  type IndexedProcedure,
  type IndexedScript,
  type SemanticReferenceIndex,
} from './reference-index-types.js'
import type { BlockRef, DeclarationRef, ScriptRef } from '../repair/repair-types.js'
import {
  editEvidenceCanonicalSha256V1,
  resolveTargetRefV1,
  targetSemanticFingerprintV1,
  type TargetEntityEvidenceV1,
  type TargetRefResolverAdaptersV1,
} from './target-operations.js'

type HandleDeclarationRefV1 = Extract<DeclarationRefV1, { refKind: 'handle' }>
type CreatedDeclarationRefV1 = Extract<DeclarationRefV1, { refKind: 'created' }>
type HandleCommentRefV1 = Extract<CommentRefV1, { refKind: 'handle' }>
type CreatedCommentRefV1 = Extract<CommentRefV1, { refKind: 'created' }>
type HandleScriptRefV1 = Extract<ScriptRefV1, { refKind: 'handle' }>
type CreatedScriptRefV1 = Extract<ScriptRefV1, { refKind: 'created' }>
type HandleBlockRefV1 = Extract<BlockRefV1, { refKind: 'handle' }>
type CreatedBlockRefV1 = Extract<BlockRefV1, { refKind: 'created' }>
type HandleMediaRefV1 = Extract<MediaRefV1, { refKind: 'handle' }>
type CreatedMediaRefV1 = Extract<MediaRefV1, { refKind: 'created' }>

type RootRoleV1 =
  | 'eventHat'
  | 'statement'
  | 'expression'
  | 'procedureDefinition'
  | 'topLevelPrimitive'

interface ExactEntityEvidenceV1
{
  readonly targetIndex: number
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
}

interface GroupCEvidenceBuildContextV1
{
  readonly project: ProjectIR
  readonly index: SemanticReferenceIndex
  readonly targetLocations: Map<number, TargetLocationV1>
  readonly targetLocationSha256s: Map<number, string>
  readonly targetIndexes: WeakMap<Target, number>
  readonly commentsByScriptKey: Map<string, readonly IndexedComment[]>
  readonly reachableBlockIdsByKey: Map<string, readonly string[]>
  readonly boundedOutlineSha256ByKey: Map<string, string>
  readonly stableTargetBlockOrdinalByKey: Map<string, number>
  declarationEvidence?: readonly DeclarationEntityEvidenceV1[]
  scriptEvidence?: readonly ScriptEntityEvidenceV1[]
  blockEvidence?: readonly BlockEntityEvidenceV1[]
  commentEvidence?: readonly CommentEntityEvidenceV1[]
}

export interface DeclarationEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'declaration'
  readonly declarationKind: 'variable' | 'list' | 'broadcast'
  readonly declarationId: string
  readonly cloud: boolean | null
  readonly rawRef: DeclarationRef
  readonly location: DeclarationLocationV1
}

export interface ProcedureEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'procedure'
  readonly proccode: string
  readonly definitionBlockId: string
  readonly prototypeBlockId: string
  readonly warp: boolean
  readonly location: ProcedureLocationV1
}

export interface ParameterEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'parameter'
  readonly proccode: string
  readonly argumentId: string
  readonly ordinal: number
  readonly parameterType: ProcedureParameterTypeV1
  readonly location: ParameterLocationV1
}

export interface ScriptEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'script'
  readonly topBlockId: string
  readonly rawRef: ScriptRef
  readonly location: ScriptLocationV1
  readonly rootRole: Exclude<RootRoleV1, 'topLevelPrimitive'>
  readonly category: string | null
}

export interface BlockEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'block'
  readonly blockId: string
  readonly rawRef: BlockRef
  readonly location: BlockLocationV1
  readonly scriptTopBlockId: string | null
  readonly category: string | null
}

export interface CommentEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'comment'
  readonly commentId: string
  readonly location: CommentLocationV1
  readonly attachedBlockId: string | null
  readonly scriptTopBlockId: string | null
  readonly topologyStatus: 'consistent' | 'inconsistent'
}

// one costume/sound record addressed by its owning target, kind & serialized
// ordinal. `payloadSha256` is the retained archive bytes, so a payload shared by
// several records yields the same value on every one of them.
export interface MediaRecordEntityEvidenceV1 extends ExactEntityEvidenceV1
{
  readonly entityKind: 'media'
  readonly mediaKind: 'costume' | 'sound'
  readonly ordinal: number
  readonly name: string
  readonly assetId: string
  readonly dataFormat: string
  readonly archivePath: string
  readonly payloadSha256: string | null
  readonly location: MediaLocationV1
}

export interface GroupCEntityResolverAdaptersV1
{
  readonly activeMatchCandidateLimit?: number
  readonly target?: TargetRefResolverAdaptersV1
  readonly resolveDeclarationHandle?: (
    reference: HandleDeclarationRefV1,
    evidence: readonly DeclarationEntityEvidenceV1[]
  ) => number | null
  readonly resolveDeclarationCreated?: (
    reference: CreatedDeclarationRefV1,
    evidence: readonly DeclarationEntityEvidenceV1[]
  ) => number | null
  readonly resolveCommentHandle?: (
    reference: HandleCommentRefV1,
    evidence: readonly CommentEntityEvidenceV1[]
  ) => number | null
  readonly resolveCommentCreated?: (
    reference: CreatedCommentRefV1,
    evidence: readonly CommentEntityEvidenceV1[]
  ) => number | null
  readonly resolveScriptHandle?: (
    reference: HandleScriptRefV1,
    evidence: readonly ScriptEntityEvidenceV1[]
  ) => number | null
  readonly resolveScriptCreated?: (
    reference: CreatedScriptRefV1,
    evidence: readonly ScriptEntityEvidenceV1[]
  ) => number | null
  readonly resolveBlockHandle?: (
    reference: HandleBlockRefV1,
    evidence: readonly BlockEntityEvidenceV1[]
  ) => number | null
  readonly resolveBlockCreated?: (
    reference: CreatedBlockRefV1,
    evidence: readonly BlockEntityEvidenceV1[]
  ) => number | null
  readonly resolveMediaHandle?: (
    reference: HandleMediaRefV1,
    evidence: readonly MediaRecordEntityEvidenceV1[]
  ) => number | null
  readonly resolveMediaCreated?: (
    reference: CreatedMediaRefV1,
    evidence: readonly MediaRecordEntityEvidenceV1[]
  ) => number | null
}

export class GroupCEntityResolutionError extends Error
{
  constructor(
    readonly code: string,
    message: string,
    readonly context?: Readonly<Record<string, unknown>>
  )
  {
    super(message)
    this.name = 'GroupCEntityResolutionError'
  }
}

const DESCRIPTOR_BY_OPCODE: ReadonlyMap<
  string,
  (typeof VANILLA_CORE_DESCRIPTORS)[number]
> = new Map(
  VANILLA_CORE_DESCRIPTORS.map((descriptor) => [descriptor.opcode, descriptor])
)

function editError(code: string, message: string): never
{
  throw new GroupCEntityResolutionError(code, message)
}

function canonicalSha256(value: unknown): string
{
  return editEvidenceCanonicalSha256V1(value)
}

function optionalNumberOrder(value: ExistingOptionalNumberV1): number
{
  return value.state === 'value' ? value.value : Number.POSITIVE_INFINITY
}

function groupCEvidenceBuildContextV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): GroupCEvidenceBuildContextV1
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const targetIndexes = new WeakMap<Target, number>()
  project.json.targets.forEach((target, targetIndex) =>
    targetIndexes.set(target, targetIndex)
  )
  const commentsByScriptKey = new Map<string, IndexedComment[]>()
  for (const comment of index.comments)
  {
    if (!comment.script) continue
    const key = scriptKey(comment.script)
    const grouped = commentsByScriptKey.get(key) ?? []
    grouped.push(comment)
    commentsByScriptKey.set(key, grouped)
  }
  const stableTargetBlockOrdinalByKey = new Map<string, number>()
  for (const [targetIndex, target] of project.json.targets.entries())
  {
    ownRecordKeys(target.blocks)
      .filter((blockId) => isBlockEntry(ownRecordValue(target.blocks, blockId)))
      .sort()
      .forEach((blockId, ordinal) =>
        stableTargetBlockOrdinalByKey.set(
          blockKey({ target: index.targets[targetIndex]!, blockId }),
          ordinal
        )
      )
  }
  return {
    project,
    index,
    targetLocations: new Map(),
    targetLocationSha256s: new Map(),
    targetIndexes,
    commentsByScriptKey,
    reachableBlockIdsByKey: new Map(),
    boundedOutlineSha256ByKey: new Map(),
    stableTargetBlockOrdinalByKey,
  }
}

function targetLocationV1(
  target: Target,
  targetIndex: number,
  context?: GroupCEvidenceBuildContextV1
): TargetLocationV1
{
  const cached = context?.targetLocations.get(targetIndex)
  if (cached) return cached
  const location = {
    kind: 'target' as const,
    targetKind: target.isStage ? ('stage' as const) : ('sprite' as const),
    serializedTargetOrdinal: targetIndex,
    name: target.name,
    semanticFingerprint: targetSemanticFingerprintV1(target),
  }
  const resolved =
    !target.isStage && target.layerOrder !== undefined
      ? { ...location, visualLayerOrdinal: target.layerOrder }
      : location
  context?.targetLocations.set(targetIndex, resolved)
  return resolved
}

function targetLocationSha256V1(
  target: Target,
  targetIndex: number,
  context: GroupCEvidenceBuildContextV1
): string
{
  const cached = context.targetLocationSha256s.get(targetIndex)
  if (cached) return cached
  const digest = semanticHashV1(
    'semantic-location',
    targetLocationV1(target, targetIndex, context)
  )
  context.targetLocationSha256s.set(targetIndex, digest)
  return digest
}

function displayMatches(
  value: string,
  expected: BoundedDisplayStringV1
): boolean
{
  const bytes = canonicalJsonBytesV1(value)
  return (
    bytes.byteLength === expected.canonicalJsonStringByteLength &&
    sha256Hex(bytes) === expected.valueSha256 &&
    (expected.displayKind !== 'inline' || expected.value === value)
  )
}

function boundedLocationDisplayStringV1(value: string): BoundedDisplayStringV1
{
  const canonicalBytes = canonicalJsonBytesV1(value)
  const identity = {
    canonicalJsonStringByteLength: canonicalBytes.byteLength,
    valueSha256: sha256Hex(canonicalBytes),
  }
  return new TextEncoder().encode(value).byteLength <= 256
    ? { displayKind: 'inline', value, ...identity }
    : { displayKind: 'hashOnly', ...identity }
}

function optionalNumber(
  value: object,
  property: string
): ExistingOptionalNumberV1
{
  if (!Object.hasOwn(value, property)) return { state: 'missing' }
  const present = (value as Record<string, unknown>)[property]
  return typeof present === 'number'
    ? { state: 'value', value: present }
    : editError('edit.internal_invariant', `${property} is not numeric`)
}

function nullableOptionalNumber(
  value: object,
  property: string
): ExistingNullableOptionalNumberV1
{
  if (!Object.hasOwn(value, property)) return { state: 'missing' }
  const present = (value as Record<string, unknown>)[property]
  if (present === null) return { state: 'null' }
  return typeof present === 'number'
    ? { state: 'value', value: present }
    : editError(
        'edit.internal_invariant',
        `${property} is not nullable numeric`
      )
}

function optionalBoolean(
  value: object,
  property: string
): ExistingOptionalBooleanV1
{
  if (!Object.hasOwn(value, property)) return { state: 'missing' }
  const present = (value as Record<string, unknown>)[property]
  return typeof present === 'boolean'
    ? { state: 'value', value: present }
    : editError('edit.internal_invariant', `${property} is not boolean`)
}

function stateMatches(
  actual:
    | ExistingOptionalNumberV1
    | ExistingOptionalBooleanV1
    | ExistingNullableOptionalNumberV1,
  expected:
    | ExistingOptionalNumberV1
    | ExistingOptionalBooleanV1
    | ExistingNullableOptionalNumberV1
): boolean
{
  return canonicalSha256(actual) === canonicalSha256(expected)
}

function contextFingerprintV1(
  entityKind:
    | 'declaration'
    | 'script'
    | 'block'
    | 'comment'
    | 'procedure'
    | 'parameter'
    | 'media',
  evidence: readonly Omit<ExactEntityEvidenceV1, 'contextFingerprintSha256'>[],
  index: number,
  owner: unknown,
  orderedCollectionLineageSetSha256?: string
): string
{
  const selected = evidence[index]!
  const neighbor = (candidate: (typeof evidence)[number] | undefined) =>
    candidate
      ? {
          state: 'present',
          semanticLocationSha256: candidate.semanticLocationSha256,
          semanticFingerprintSha256: candidate.semanticFingerprintSha256,
        }
      : { state: 'missing' }
  return semanticHashV1('semantic-fingerprint', {
    entityKind: `${entityKind}-context`,
    ordinal: index,
    owner,
    semanticLocationSha256: selected.semanticLocationSha256,
    semanticFingerprintSha256: selected.semanticFingerprintSha256,
    neighborWindow: {
      previous2: neighbor(evidence[index - 2]),
      previous1: neighbor(evidence[index - 1]),
      next1: neighbor(evidence[index + 1]),
      next2: neighbor(evidence[index + 2]),
    },
    collectionTotalCount: evidence.length,
    orderedCollectionLineageSetSha256:
      orderedCollectionLineageSetSha256 ??
      semanticHashV1('evidence-content', {
        kind: `${entityKind}-ordered-context-collection`,
        schemaVersion: 1,
        collectionLineages: evidence.map(
          (entry) => entry.semanticLocationSha256
        ),
      }),
  })
}

function contextualizeEvidenceV1<
  T extends Omit<ExactEntityEvidenceV1, 'contextFingerprintSha256'>,
>(
  entityKind:
    | 'declaration'
    | 'script'
    | 'block'
    | 'comment'
    | 'procedure'
    | 'parameter'
    | 'media',
  bases: readonly T[],
  groupKey: (base: T) => string,
  owner: (base: T) => unknown
): readonly (T & { readonly contextFingerprintSha256: string })[]
{
  const groups = new Map<string, T[]>()
  for (const base of bases)
  {
    const key = groupKey(base)
    const collection = groups.get(key) ?? []
    collection.push(base)
    groups.set(key, collection)
  }
  const positions = new Map<T, number>()
  const lineageHashes = new Map<string, string>()
  for (const [key, collection] of groups)
  {
    collection.forEach((base, index) => positions.set(base, index))
    lineageHashes.set(
      key,
      semanticHashV1('evidence-content', {
        kind: `${entityKind}-ordered-context-collection`,
        schemaVersion: 1,
        collectionLineages: collection.map(
          (entry) => entry.semanticLocationSha256
        ),
      })
    )
  }
  return Object.freeze(
    bases.map((base) =>
    {
      const key = groupKey(base)
      const collection = groups.get(key)!
      return {
        ...base,
        contextFingerprintSha256: contextFingerprintV1(
          entityKind,
          collection,
          positions.get(base)!,
          owner(base),
          lineageHashes.get(key)!
        ),
      }
    })
  )
}

function callbackIndex<T>(
  value: number | null | undefined,
  evidence: readonly T[],
  code: 'edit.stale_handle' | 'edit.created_result_invalid',
  entityKind: string
): number
{
  if (
    value === null ||
    value === undefined ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= evidence.length
  )
    return editError(code, `${entityKind} callback did not resolve one entity`)
  return value
}

function exactLocationEvidence<T extends { semanticLocationSha256: string }>(
  evidence: readonly T[],
  fullLocationSha256: string
): T | undefined
{
  return evidence.find(
    (candidate) => candidate.semanticLocationSha256 === fullLocationSha256
  )
}

function groupCOrderedMatchSetSha256V1(
  entityKind: 'declaration' | 'script' | 'block' | 'comment' | 'media',
  matches: readonly ExactEntityEvidenceV1[]
): string
{
  return semanticHashV1('evidence-content', {
    kind: `${entityKind}-ordered-match-set`,
    schemaVersion: 1,
    matches: matches.map((match) => ({
      fullLocationSha256: match.semanticLocationSha256,
      semanticFingerprintSha256: match.semanticFingerprintSha256,
      contextFingerprintSha256: match.contextFingerprintSha256,
    })),
  })
}

function selectMatchV1<T extends ExactEntityEvidenceV1>(
  entityKind: 'declaration' | 'script' | 'block' | 'comment' | 'media',
  matches: readonly T[],
  selection: MatchSetSelectionV1,
  expected: {
    readonly expectedMatchCount: number
    readonly expectedOrderedMatchSetSha256: string
    readonly expectedSelectedFullLocationSha256: string
    readonly expectedSelectedSemanticFingerprint: string
    readonly expectedSelectedContextFingerprint: string
  },
  activeMatchCandidateLimit?: number
): T
{
  if (
    activeMatchCandidateLimit !== undefined &&
    matches.length > activeMatchCandidateLimit
  )
    throw new GroupCEntityResolutionError(
      'edit.impact_budget_exceeded',
      `${entityKind} match set exceeds ${activeMatchCandidateLimit} active candidates`,
      { limit: activeMatchCandidateLimit, observed: matches.length }
    )
  if (matches.length === 0)
    return editError(
      'edit.selector_no_match',
      `${entityKind} selector matched none`
    )
  if (
    matches.length !== expected.expectedMatchCount ||
    groupCOrderedMatchSetSha256V1(entityKind, matches) !==
      expected.expectedOrderedMatchSetSha256
  )
    return editError(
      'edit.fingerprint_mismatch',
      `${entityKind} match set changed`
    )
  let selected: T | undefined
  if (selection.kind === 'exactlyOne')
  {
    if (matches.length !== 1)
      return editError(
        'edit.selector_ambiguous',
        `${entityKind} selector matched more than one entity`
      )
    selected = matches[0]
  }
  else selected = matches[selection.zeroBasedIndex]
  if (!selected)
    return editError(
      'edit.selector_no_match',
      `selected ${entityKind} occurrence is absent`
    )
  if (
    selected.semanticLocationSha256 !==
      expected.expectedSelectedFullLocationSha256 ||
    selected.semanticFingerprintSha256 !==
      expected.expectedSelectedSemanticFingerprint ||
    selected.contextFingerprintSha256 !==
      expected.expectedSelectedContextFingerprint
  )
    return editError(
      'edit.fingerprint_mismatch',
      `selected ${entityKind} evidence changed`
    )
  return selected
}

function targetIndexForDeclaration(reference: DeclarationRef): number
{
  return reference.declarationTarget.targetIndex
}

function declarationRawValue(
  project: ProjectIR,
  reference: DeclarationRef
): unknown
{
  const target = project.json.targets[targetIndexForDeclaration(reference)]
  if (!target)
    return editError('edit.selector_no_match', 'declaration owner is absent')
  if (reference.kind === 'variable')
    return ownRecordValue(target.variables, reference.id)
  if (reference.kind === 'list')
    return ownRecordValue(target.lists, reference.id)
  return ownRecordValue(target.broadcasts, reference.id)
}

function declarationCloudV1(
  project: ProjectIR,
  reference: DeclarationRef
): boolean | null
{
  if (reference.kind !== 'variable') return null
  const raw = declarationRawValue(project, reference)
  return Array.isArray(raw) && raw[2] === true
}

function declarationFingerprintV1(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  reference: DeclarationRef,
  context: GroupCEvidenceBuildContextV1
): string
{
  const raw = declarationRawValue(project, reference)
  if (raw === undefined)
    return editError('edit.selector_no_match', 'declaration is absent')
  const target = project.json.targets[targetIndexForDeclaration(reference)]!
  const inbound =
    index.inboundReferencesByEntityKey.get(declarationKey(reference)) ?? []
  const references = inbound.filter((row) => row.kind !== 'monitor-declaration')
  const monitorReferences = inbound.filter(
    (row) => row.kind === 'monitor-declaration'
  )
  const initialValue =
    reference.kind === 'broadcast'
      ? { state: 'notApplicable' }
      : Array.isArray(raw)
        ? { state: 'value', value: raw[1] }
        : { state: 'invalid', value: raw }
  const cloudState =
    reference.kind === 'variable' && Array.isArray(raw) && raw.length > 2
      ? { state: 'value', value: raw[2] }
      : { state: 'missing' }
  return semanticHashV1('semantic-fingerprint', {
    entityKind: 'declaration',
    declarationKind: reference.kind,
    scopeLineageSha256:
      reference.kind === 'broadcast'
        ? semanticHashV1('lineage', {
            entityKind: 'declaration-project-scope',
            schemaVersion: 1,
          })
        : targetLocationSha256V1(
            target,
            reference.declarationTarget.targetIndex,
            context
          ),
    nameSha256: canonicalSha256(reference.name),
    initialValueSha256: canonicalSha256(initialValue),
    cloudStateSha256: canonicalSha256(cloudState),
    referenceSetSha256: canonicalSha256(references),
    monitorReferenceSetSha256: canonicalSha256(monitorReferences),
  })
}

function declarationLocationV1(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  reference: DeclarationRef,
  context: GroupCEvidenceBuildContextV1
): DeclarationLocationV1
{
  const targetIndex = targetIndexForDeclaration(reference)
  const target = project.json.targets[targetIndex]!
  const semanticFingerprint = declarationFingerprintV1(
    project,
    index,
    reference,
    context
  )
  if (reference.kind === 'broadcast')
    return {
      kind: 'declaration',
      declarationKind: 'broadcast',
      scope: { kind: 'project' },
      rawOwnerTarget: targetLocationV1(target, targetIndex, context),
      name: reference.name,
      semanticFingerprint,
    }
  return {
    kind: 'declaration',
    declarationKind: reference.kind,
    scope: targetLocationV1(target, targetIndex, context),
    name: reference.name,
    semanticFingerprint,
  }
}

export function declarationEntityEvidenceSetV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): readonly DeclarationEntityEvidenceV1[]
{
  return declarationEntityEvidenceSetFromContextV1(
    groupCEvidenceBuildContextV1(project, suppliedIndex)
  )
}

function declarationEntityEvidenceSetFromContextV1(
  context: GroupCEvidenceBuildContextV1
): readonly DeclarationEntityEvidenceV1[]
{
  if (context.declarationEvidence) return context.declarationEvidence
  const { project, index } = context
  const references: DeclarationRef[] = [
    ...index.declarationsInRuntimeOrder.map((entry) => entry.declaration),
    ...index.broadcastsInRuntimeOrder.map((entry) => entry.declaration),
  ]
  const bases = references.map((rawRef) =>
  {
    const targetIndex = targetIndexForDeclaration(rawRef)
    const location = declarationLocationV1(project, index, rawRef, context)
    return {
      entityKind: 'declaration' as const,
      declarationKind: rawRef.kind,
      declarationId: rawRef.id,
      cloud: declarationCloudV1(project, rawRef),
      rawRef,
      targetIndex,
      location,
      semanticLocationSha256: semanticHashV1('semantic-location', location),
      semanticFingerprintSha256: location.semanticFingerprint,
    }
  })
  bases.sort(
    (left, right) =>
      left.targetIndex - right.targetIndex ||
      compareText(left.declarationKind, right.declarationKind) ||
      compareText(left.location.name, right.location.name) ||
      compareText(
        left.semanticFingerprintSha256,
        right.semanticFingerprintSha256
      )
  )
  const scopeSha256s = new Map(
    bases.map((base) => [
      base,
      base.location.scope.kind === 'project'
        ? semanticHashV1('semantic-location', base.location.scope)
        : targetLocationSha256V1(
            project.json.targets[base.targetIndex]!,
            base.targetIndex,
            context
          ),
    ])
  )
  const evidence = contextualizeEvidenceV1(
    'declaration',
    bases,
    (base) => `${base.declarationKind}:${scopeSha256s.get(base)!}`,
    (base) => ({
      declarationKind: base.declarationKind,
      scope:
        base.location.scope.kind === 'project'
          ? { kind: 'project' }
          : {
              kind: 'target',
              targetLocationSha256: scopeSha256s.get(base)!,
            },
    })
  )
  context.declarationEvidence = evidence
  return evidence
}

function rootRoleV1(
  opcode: string,
  descriptorShape: string | null
): Exclude<RootRoleV1, 'topLevelPrimitive'>
{
  if (opcode === 'procedures_definition') return 'procedureDefinition'
  if (descriptorShape === 'hat' || opcode.startsWith('event_when'))
    return 'eventHat'
  if (descriptorShape === 'reporter' || descriptorShape === 'boolean')
    return 'expression'
  return 'statement'
}

function rawBlock(project: ProjectIR, reference: BlockRef): Block
{
  const target = project.json.targets[reference.target.targetIndex]
  const entry = target && ownRecordValue(target.blocks, reference.blockId)
  if (!isBlockEntry(entry))
    return editError('edit.selector_no_match', 'block is absent')
  return entry
}

function scriptWorkspaceV1(project: ProjectIR, reference: ScriptRef)
{
  const top = rawBlock(project, {
    target: reference.target,
    blockId: reference.topBlockId,
  })
  return {
    x: optionalNumber(top, 'x'),
    y: optionalNumber(top, 'y'),
  }
}

function scriptFingerprintV1(
  project: ProjectIR,
  script: IndexedScript,
  context: GroupCEvidenceBuildContextV1
): string
{
  const targetIndex = script.ref.target.targetIndex
  const target = project.json.targets[targetIndex]!
  const top = rawBlock(project, script.top)
  const descriptor = DESCRIPTOR_BY_OPCODE.get(top.opcode)
  const attachedComments = (
    context.commentsByScriptKey.get(scriptKey(script.ref)) ?? []
  ).map((comment) => ({
    commentId: comment.ref.commentId,
    text: comment.text,
    attachedBlockId: comment.attachedBlock?.blockId ?? null,
  }))
  const closure = script.blockRefs.map((reference) => ({
    blockId: reference.blockId,
    value: ownRecordValue(target.blocks, reference.blockId),
  }))
  const rootCategory =
    descriptor?.shape === 'reporter'
      ? 'reporter'
      : descriptor?.shape === 'boolean'
        ? 'booleanReporter'
        : rootRoleV1(top.opcode, descriptor?.shape ?? null) === 'eventHat'
          ? 'eventHat'
          : 'statementStack'
  return semanticHashV1('semantic-fingerprint', {
    entityKind: 'script',
    targetLineageSha256: targetLocationSha256V1(target, targetIndex, context),
    normalizedScriptClosureSha256: canonicalSha256(closure),
    rootCategory,
    workspaceStateSha256: canonicalSha256(
      scriptWorkspaceV1(project, script.ref)
    ),
    attachedCommentSetSha256: canonicalSha256(attachedComments),
  })
}

function boundedOutlineSha256V1(
  target: Target,
  rootBlockId: string,
  context: GroupCEvidenceBuildContextV1
): string
{
  const targetIndex = context.targetIndexes.get(target) ?? -1
  const cacheKey = JSON.stringify([targetIndex, rootBlockId])
  const cached = context.boundedOutlineSha256ByKey.get(cacheKey)
  if (cached) return cached
  const rows: unknown[] = []
  const seen = new Set<string>()
  const visit = (blockId: string, depth: number, relation: unknown): void =>
  {
    if (seen.has(blockId))
    {
      rows.push({ rowKind: 'cycle', depth, relation })
      return
    }
    const entry = ownRecordValue(target.blocks, blockId)
    if (!isBlockEntry(entry))
    {
      rows.push({
        rowKind: 'nonObject',
        depth,
        relation,
        payloadSha256: canonicalSha256(entry),
      })
      return
    }
    const descendants = reachableBlockIdsV1(target, blockId, context)
    if (depth > 8 || rows.length >= 64)
    {
      rows.push({
        rowKind: 'frontier',
        depth,
        relation,
        omittedDescendantCount: descendants.length,
        subtreeSha256: canonicalSha256(
          descendants.map((id) => ownRecordValue(target.blocks, id))
        ),
      })
      return
    }
    seen.add(blockId)
    const descriptor = DESCRIPTOR_BY_OPCODE.get(entry.opcode)
    const inputRows = ownRecordKeys(entry.inputs ?? {})
      .sort()
      .map((name) =>
      {
        const input = ownRecordValue(entry.inputs, name)
        return {
          nameSha256: canonicalSha256(name),
          primaryState:
            input && input.length > 1
              ? { state: 'present', valueKind: typeof input[1] }
              : { state: 'missing' },
          shadowState:
            input && input.length > 2
              ? { state: 'present', valueKind: typeof input[2] }
              : { state: 'missing' },
        }
      })
    rows.push({
      rowKind: 'block',
      depth,
      relation,
      opcode: entry.opcode,
      category: descriptor?.category ?? null,
      knownFieldNameSha256s: ownRecordKeys(entry.fields ?? {})
        .sort()
        .map(canonicalSha256),
      inputs: inputRows,
      shadow: entry.shadow,
      topLevel: entry.topLevel,
      childCount:
        (entry.next ? 1 : 0) +
        inputRows.reduce(
          (count, row) =>
            count +
            (row.primaryState.state === 'present' ? 1 : 0) +
            (row.shadowState.state === 'present' ? 1 : 0),
          0
        ),
      fullSubtreeSha256: canonicalSha256(
        descendants.map((id) => ownRecordValue(target.blocks, id))
      ),
    })
    const children: { blockId: string; relation: unknown }[] = []
    if (entry.next)
      children.push({ blockId: entry.next, relation: { relation: 'next' } })
    for (const inputName of ownRecordKeys(entry.inputs ?? {}).sort())
    {
      const input = ownRecordValue(entry.inputs, inputName)
      if (!input) continue
      for (let slot = 1; slot < input.length; slot++)
      {
        const child = input[slot]
        if (typeof child !== 'string') continue
        children.push({
          blockId: child,
          relation: {
            relation: 'input',
            inputNameSha256: canonicalSha256(inputName),
            slot: slot === 1 ? 'primary' : 'shadow',
          },
        })
      }
    }
    for (const child of children)
      visit(child.blockId, depth + 1, child.relation)
  }
  visit(rootBlockId, 0, { relation: 'root' })
  const digest = semanticHashV1('evidence-content', {
    kind: 'bounded-block-outline',
    schemaVersion: 1,
    maxDepth: 8,
    maxObjectBlockRows: 64,
    rows,
  })
  context.boundedOutlineSha256ByKey.set(cacheKey, digest)
  return digest
}

function scriptLocationV1(
  project: ProjectIR,
  script: IndexedScript,
  context: GroupCEvidenceBuildContextV1
): ScriptLocationV1
{
  const targetIndex = script.ref.target.targetIndex
  const target = project.json.targets[targetIndex]!
  const top = rawBlock(project, script.top)
  return {
    kind: 'script',
    target: targetLocationV1(target, targetIndex, context),
    hatOrRootOpcode: top.opcode,
    workspace: scriptWorkspaceV1(project, script.ref),
    boundedOutlineSha256: boundedOutlineSha256V1(
      target,
      script.ref.topBlockId,
      context
    ),
    semanticFingerprint: scriptFingerprintV1(project, script, context),
  }
}

// a procedure's semantic identity is its canonical proccode inside one owning
// target; the definition/prototype block ids are raw & never part of identity
function procedureLocationV1(
  project: ProjectIR,
  procedure: IndexedProcedure,
  prototypeBlockId: string,
  targetLocation: TargetLocationV1
): ProcedureLocationV1
{
  const prototype = rawBlock(project, {
    target: procedure.target,
    blockId: prototypeBlockId,
  })
  return {
    kind: 'procedure',
    target: targetLocation,
    canonicalSignature: procedure.proccode,
    semanticFingerprint: semanticHashV1('semantic-fingerprint', {
      kind: 'procedure',
      proccode: procedure.proccode,
      warp: prototype.mutation?.warp === 'true',
      parameters: (procedure.parameters ?? []).map((parameter) => ({
        name: parameter.name,
        placeholder: parameter.placeholder,
        parameterIndex: parameter.parameterIndex,
      })),
    }),
  }
}

interface NonAuthorableProcedureSurfaceV1
{
  readonly directBlockKeys: ReadonlySet<string>
  readonly scriptKeys: ReadonlySet<string>
  readonly procedures: readonly IndexedProcedure[]
}

function nonAuthorableProcedureSurfaceV1(
  index: SemanticReferenceIndex
): NonAuthorableProcedureSurfaceV1
{
  const procedures = index.procedures.filter(
    (procedure) => !procedureHasExactAuthorableTopologyV1(index, procedure)
  )
  const directBlockKeys = new Set<string>()
  const scriptKeys = new Set<string>()
  for (const procedure of procedures)
  {
    for (const reference of [
      ...procedure.definitions,
      ...procedure.prototypes,
      ...procedure.calls,
    ])
    {
      directBlockKeys.add(blockKey(reference))
      const indexed = index.blockByKey.get(blockKey(reference))
      for (const script of indexed?.topScripts ?? [])
        scriptKeys.add(scriptKey(script))
    }
  }
  return {
    directBlockKeys,
    scriptKeys,
    procedures: Object.freeze(procedures),
  }
}

export function nonAuthorableProcedureBlockKeysV1(
  index: SemanticReferenceIndex
): ReadonlySet<string>
{
  const surface = nonAuthorableProcedureSurfaceV1(index)
  return new Set(
    index.blocks
      .filter(
        (block) =>
          surface.directBlockKeys.has(blockKey(block.ref)) ||
          block.topScripts.some((script) =>
            surface.scriptKeys.has(scriptKey(script))
          )
      )
      .map((block) => blockKey(block.ref))
  )
}

// malformed unique procedure pairs remain accepted only as exact opaque data;
// this digest is compared across every candidate transition by the edit kernel
export function nonAuthorableProcedureSurfaceSha256V1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): string
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const surface = nonAuthorableProcedureSurfaceV1(index)
  const blocks = index.blocks
    .filter(
      (block) =>
        surface.directBlockKeys.has(blockKey(block.ref)) ||
        block.topScripts.some((script) =>
          surface.scriptKeys.has(scriptKey(script))
        )
    )
    .map((block) => ({
      targetIndex: block.ref.target.targetIndex,
      blockId: block.ref.blockId,
      value: ownRecordValue(
        project.json.targets[block.ref.target.targetIndex]?.blocks,
        block.ref.blockId
      ),
    }))
    .sort(
      (left, right) =>
        left.targetIndex - right.targetIndex ||
        compareText(left.blockId, right.blockId)
    )
  return semanticHashV1('evidence-content', {
    kind: 'non-authorable-procedure-surface',
    schemaVersion: 1,
    procedures: surface.procedures.map((procedure) => ({
      targetIndex: procedure.target.targetIndex,
      proccode: procedure.proccode,
      definitions: procedure.definitions.map((entry) => entry.blockId),
      prototypes: procedure.prototypes.map((entry) => entry.blockId),
      calls: procedure.calls.map((entry) => entry.blockId),
      mutationIssues: procedure.mutationIssues,
    })),
    blocks,
  })
}

// only a fully resolved, unambiguous definition/prototype pair is admissible
// evidence; ambiguous or mutation-broken procedures are left out entirely
export function procedureEntityEvidenceSetV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): readonly ProcedureEntityEvidenceV1[]
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const targetLocations = new Map<number, TargetLocationV1>()
  const targetLocationSha256s = new Map<number, string>()
  const bases = index.procedures
    .filter(
      (procedure) =>
        procedure.mutationIssues.length === 0 &&
        procedure.definitions.length === 1 &&
        procedure.prototypes.length === 1 &&
        procedure.parameters !== null &&
        procedureHasExactAuthorableTopologyV1(index, procedure)
    )
    .map((procedure) =>
    {
      const targetIndex = procedure.target.targetIndex
      const definitionBlockId = procedure.definitions[0]!.blockId
      const prototypeBlockId = procedure.prototypes[0]!.blockId
      const prototype = rawBlock(project, procedure.prototypes[0]!)
      let targetLocation = targetLocations.get(targetIndex)
      if (!targetLocation)
      {
        targetLocation = targetLocationV1(
          project.json.targets[targetIndex]!,
          targetIndex
        )
        targetLocations.set(targetIndex, targetLocation)
        targetLocationSha256s.set(
          targetIndex,
          semanticHashV1('semantic-location', targetLocation)
        )
      }
      const location = procedureLocationV1(
        project,
        procedure,
        prototypeBlockId,
        targetLocation
      )
      return {
        entityKind: 'procedure' as const,
        targetIndex,
        proccode: procedure.proccode,
        definitionBlockId,
        prototypeBlockId,
        warp: prototype.mutation?.warp === 'true',
        location,
        semanticLocationSha256: semanticHashV1('semantic-location', location),
        semanticFingerprintSha256: location.semanticFingerprint,
      }
    })
  bases.sort(
    (left, right) =>
      left.targetIndex - right.targetIndex ||
      compareText(left.proccode, right.proccode)
  )
  return contextualizeEvidenceV1(
    'procedure',
    bases,
    (base) => targetLocationSha256s.get(base.targetIndex)!,
    (base) => ({
      targetLocationSha256: targetLocationSha256s.get(base.targetIndex)!,
    })
  )
}

// parameters are owned by their procedure & identified by ordinal; the
// serialized argument id is evidence, never the caller-visible selector
export function parameterEntityEvidenceSetV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): readonly ParameterEntityEvidenceV1[]
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const procedures = procedureEntityEvidenceSetV1(project, index)
  const proceduresByTarget = new Map<number, Map<string, IndexedProcedure>>()
  for (const indexed of index.procedures)
  {
    const targetIndex = indexed.target.targetIndex
    const targetProcedures = proceduresByTarget.get(targetIndex) ?? new Map()
    if (!targetProcedures.has(indexed.proccode))
      targetProcedures.set(indexed.proccode, indexed)
    proceduresByTarget.set(targetIndex, targetProcedures)
  }
  const bases: Omit<ParameterEntityEvidenceV1, 'contextFingerprintSha256'>[] =
    []
  for (const procedure of procedures)
  {
    const indexed = proceduresByTarget
      .get(procedure.targetIndex)
      ?.get(procedure.proccode)
    for (const parameter of indexed?.parameters ?? [])
    {
      // every placeholder yields evidence: lineage enumerates all parameters by
      // array index, so skipping %n here would desync ordinals & row counts
      const parameterType = procedureParameterTypeForPlaceholderV1(
        parameter.placeholder
      )
      const location: ParameterLocationV1 = {
        kind: 'parameter',
        name: parameter.name,
        ordinal: parameter.parameterIndex,
        parameterType,
        procedure: procedure.location,
        semanticFingerprint: semanticHashV1('semantic-fingerprint', {
          kind: 'parameter',
          name: parameter.name,
          ordinal: parameter.parameterIndex,
          parameterType,
          procedureSemanticFingerprint: procedure.semanticFingerprintSha256,
        }),
      }
      bases.push({
        entityKind: 'parameter',
        targetIndex: procedure.targetIndex,
        proccode: procedure.proccode,
        argumentId: parameter.argumentId,
        ordinal: parameter.parameterIndex,
        parameterType,
        location,
        semanticLocationSha256: semanticHashV1('semantic-location', location),
        semanticFingerprintSha256: location.semanticFingerprint,
      })
    }
  }
  bases.sort(
    (left, right) =>
      left.targetIndex - right.targetIndex ||
      compareText(left.proccode, right.proccode) ||
      left.ordinal - right.ordinal
  )
  const procedureLocationSha256s = new Map(
    bases.map((base) => [
      base,
      semanticHashV1('semantic-location', base.location.procedure),
    ])
  )
  return contextualizeEvidenceV1(
    'parameter',
    bases,
    (base) => procedureLocationSha256s.get(base)!,
    (base) => ({
      procedureLocationSha256: procedureLocationSha256s.get(base)!,
    })
  )
}

export function scriptEntityEvidenceSetV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): readonly ScriptEntityEvidenceV1[]
{
  return scriptEntityEvidenceSetFromContextV1(
    groupCEvidenceBuildContextV1(project, suppliedIndex)
  )
}

function scriptEntityEvidenceSetFromContextV1(
  context: GroupCEvidenceBuildContextV1
): readonly ScriptEntityEvidenceV1[]
{
  if (context.scriptEvidence) return context.scriptEvidence
  const { project, index } = context
  const nonAuthorable = nonAuthorableProcedureSurfaceV1(index)
  const bases = index.scripts
    .filter((script) => !nonAuthorable.scriptKeys.has(scriptKey(script.ref)))
    .map((script) =>
    {
      const targetIndex = script.ref.target.targetIndex
      const location = scriptLocationV1(project, script, context)
      const descriptor = DESCRIPTOR_BY_OPCODE.get(location.hatOrRootOpcode)
      return {
        entityKind: 'script' as const,
        targetIndex,
        topBlockId: script.ref.topBlockId,
        rawRef: script.ref,
        location,
        rootRole: rootRoleV1(
          location.hatOrRootOpcode,
          descriptor?.shape ?? null
        ),
        category: descriptor?.category ?? null,
        semanticLocationSha256: semanticHashV1('semantic-location', location),
        semanticFingerprintSha256: location.semanticFingerprint,
      }
    })
  bases.sort(
    (left, right) =>
      left.targetIndex - right.targetIndex ||
      optionalNumberOrder(left.location.workspace.y) -
        optionalNumberOrder(right.location.workspace.y) ||
      optionalNumberOrder(left.location.workspace.x) -
        optionalNumberOrder(right.location.workspace.x) ||
      compareText(
        left.location.hatOrRootOpcode,
        right.location.hatOrRootOpcode
      ) ||
      compareText(
        left.semanticFingerprintSha256,
        right.semanticFingerprintSha256
      )
  )
  const targetLocationSha256s = new Map(
    bases.map((base) => [
      base,
      targetLocationSha256V1(
        project.json.targets[base.targetIndex]!,
        base.targetIndex,
        context
      ),
    ])
  )
  const evidence = contextualizeEvidenceV1(
    'script',
    bases,
    (base) => targetLocationSha256s.get(base)!,
    (base) => ({
      targetLocationSha256: targetLocationSha256s.get(base)!,
      rootRole: base.rootRole,
    })
  )
  context.scriptEvidence = evidence
  return evidence
}

function ownershipStepForParent(
  project: ProjectIR,
  parent: IndexedBlock,
  child: IndexedBlock
): OwnershipStepV1 | null
{
  if (parent.ref.target.targetIndex !== child.ref.target.targetIndex)
    return null
  const rawParent = rawBlock(project, parent.ref)
  const matches = parent.inputChildren.filter(
    (entry) => entry.block.blockId === child.ref.blockId
  )
  if (matches.length !== 1) return null
  const match = matches[0]!
  const descriptor = DESCRIPTOR_BY_OPCODE.get(rawParent.opcode)
  const input = [
    ...(descriptor?.requiredInputs ?? []),
    ...(descriptor?.optionalInputs ?? []),
  ].find((candidate) => candidate.name === match.inputName)
  return {
    relation: input?.connection === 'substack' ? 'substack' : 'input',
    name: match.inputName,
    ordinal: match.slot === 'primary' ? 0 : 1,
  }
}

function ownershipPathV1(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  block: IndexedBlock,
  script: IndexedScript
): readonly OwnershipStepV1[] | null
{
  const reversed: OwnershipStepV1[] = []
  const seen = new Set<string>()
  let cursor = block
  while (cursor.ref.blockId !== script.ref.topBlockId)
  {
    const key = blockKey(cursor.ref)
    if (seen.has(key)) return null
    seen.add(key)
    if (cursor.predecessorStatus === 'unique' && cursor.predecessor)
    {
      reversed.push({ relation: 'next', ordinal: 0 })
      const predecessor = index.blockByKey.get(blockKey(cursor.predecessor))
      if (!predecessor) return null
      cursor = predecessor
      continue
    }
    if (cursor.parent)
    {
      const parent = index.blockByKey.get(blockKey(cursor.parent))
      if (!parent) return null
      const step = ownershipStepForParent(project, parent, cursor)
      if (!step) return null
      reversed.push(step)
      cursor = parent
      continue
    }
    return null
  }
  return reversed.reverse()
}

function reachableBlockIdsV1(
  target: Target,
  rootBlockId: string,
  context: GroupCEvidenceBuildContextV1
): readonly string[]
{
  const targetIndex = context.targetIndexes.get(target) ?? -1
  const cacheKey = JSON.stringify([targetIndex, rootBlockId])
  const cached = context.reachableBlockIdsByKey.get(cacheKey)
  if (cached) return cached
  const ordered: string[] = []
  const seen = new Set<string>()
  const pending = [rootBlockId]
  while (pending.length > 0)
  {
    const blockId = pending.pop()!
    if (seen.has(blockId)) continue
    seen.add(blockId)
    ordered.push(blockId)
    const entry = ownRecordValue(target.blocks, blockId)
    if (!isBlockEntry(entry)) continue
    const children = entry.next ? [entry.next] : []
    for (const inputName of ownRecordKeys(entry.inputs).sort())
    {
      const input = ownRecordValue(entry.inputs, inputName)
      if (!input) continue
      for (let slot = 1; slot < input.length; slot++)
        if (typeof input[slot] === 'string')
          children.push(input[slot] as string)
    }
    for (let index = children.length - 1; index >= 0; index--)
      pending.push(children[index]!)
  }
  const frozen = Object.freeze(ordered)
  context.reachableBlockIdsByKey.set(cacheKey, frozen)
  return frozen
}

function blockFingerprintV1(
  project: ProjectIR,
  block: IndexedBlock,
  ownership: 'unique' | 'unowned' | 'multiplyOwned',
  scriptLocationSha256: string | null,
  candidateScriptSetSha256: string | null,
  context: GroupCEvidenceBuildContextV1
): string
{
  const targetIndex = block.ref.target.targetIndex
  const target = project.json.targets[targetIndex]!
  const raw = rawBlock(project, block.ref)
  const descriptor = DESCRIPTOR_BY_OPCODE.get(raw.opcode)
  const closure = reachableBlockIdsV1(target, block.ref.blockId, context).map(
    (blockId) => ({
      blockId,
      value: ownRecordValue(target.blocks, blockId),
    })
  )
  const projection = {
    entityKind: 'block' as const,
    targetLineageSha256: targetLocationSha256V1(target, targetIndex, context),
    opcode: raw.opcode,
    ownership,
    blockClosureSha256: canonicalSha256(closure),
    ...(scriptLocationSha256
      ? { scriptLineageSha256: scriptLocationSha256 }
      : {}),
    ...(candidateScriptSetSha256
      ? { ownerCandidateSetSha256: candidateScriptSetSha256 }
      : {}),
    ...(descriptor
      ? {
          category: descriptor.category,
          canonicalKnownStateSha256: canonicalSha256(raw),
        }
      : { opaqueRawSha256: canonicalSha256(raw) }),
  }
  return semanticHashV1('semantic-fingerprint', projection)
}

function blockLocationV1(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  block: IndexedBlock,
  scriptsByKey: ReadonlyMap<string, ScriptEntityEvidenceV1>,
  context: GroupCEvidenceBuildContextV1
): BlockLocationV1
{
  const targetIndex = block.ref.target.targetIndex
  const target = project.json.targets[targetIndex]!
  const raw = rawBlock(project, block.ref)
  const uniqueScript = block.topScript
    ? index.scriptByKey.get(scriptKey(block.topScript))
    : undefined
  const path = uniqueScript
    ? ownershipPathV1(project, index, block, uniqueScript)
    : null
  const scriptEvidence = uniqueScript
    ? scriptsByKey.get(scriptKey(uniqueScript.ref))
    : undefined
  if (block.ownershipStatus === 'unique' && path && scriptEvidence)
  {
    const semanticFingerprint = blockFingerprintV1(
      project,
      block,
      'unique',
      scriptEvidence.semanticLocationSha256,
      null,
      context
    )
    return {
      kind: 'block',
      ownershipStatus: 'uniqueOwned',
      script: scriptEvidence.location,
      ownershipPath: path,
      opcode: raw.opcode,
      semanticFingerprint,
    }
  }
  const candidateScriptSetSha256 = semanticHashV1('evidence-content', {
    kind: 'block-candidate-script-set',
    schemaVersion: 1,
    candidates: block.topScripts
      .map((script) => scriptsByKey.get(scriptKey(script)))
      .filter((value): value is ScriptEntityEvidenceV1 => value !== undefined)
      .map((value) => value.semanticLocationSha256)
      .sort(),
  })
  const stableTargetBlockOrdinal =
    context.stableTargetBlockOrdinalByKey.get(blockKey(block.ref)) ?? -1
  const ownershipStatus =
    block.ownershipStatus === 'unowned' ? 'unowned' : 'multiplyOwned'
  return {
    kind: 'block',
    ownershipStatus,
    target: targetLocationV1(target, targetIndex, context),
    stableTargetBlockOrdinal,
    opcode: raw.opcode,
    boundedOutlineSha256: boundedOutlineSha256V1(
      target,
      block.ref.blockId,
      context
    ),
    candidateScriptSetSha256,
    semanticFingerprint: blockFingerprintV1(
      project,
      block,
      ownershipStatus === 'unowned' ? 'unowned' : 'multiplyOwned',
      null,
      candidateScriptSetSha256,
      context
    ),
  }
}

export function blockEntityEvidenceSetV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex,
  suppliedScripts?: readonly ScriptEntityEvidenceV1[]
): readonly BlockEntityEvidenceV1[]
{
  const context = groupCEvidenceBuildContextV1(project, suppliedIndex)
  if (suppliedScripts) context.scriptEvidence = suppliedScripts
  return blockEntityEvidenceSetFromContextV1(context)
}

function blockEntityEvidenceSetFromContextV1(
  context: GroupCEvidenceBuildContextV1
): readonly BlockEntityEvidenceV1[]
{
  if (context.blockEvidence) return context.blockEvidence
  const { project, index } = context
  const scripts = scriptEntityEvidenceSetFromContextV1(context)
  const nonAuthorable = nonAuthorableProcedureSurfaceV1(index)
  const scriptsByKey = new Map(
    scripts.map((script) => [scriptKey(script.rawRef), script])
  )
  const scriptOrder = new Map(
    scripts.map((script, order) => [scriptKey(script.rawRef), order])
  )
  const graphOrder = new Map<string, number>()
  for (const script of scripts)
  {
    const indexed = index.scriptByKey.get(scriptKey(script.rawRef))
    indexed?.blockRefs.forEach((block, order) =>
      graphOrder.set(blockKey(block), order)
    )
  }
  const bases = index.blocks
    .filter(
      (block) =>
        block.opcode !== null &&
        !nonAuthorable.directBlockKeys.has(blockKey(block.ref)) &&
        !block.topScripts.some((script) =>
          nonAuthorable.scriptKeys.has(scriptKey(script))
        )
    )
    .map((block) =>
    {
      const location = blockLocationV1(
        project,
        index,
        block,
        scriptsByKey,
        context
      )
      return {
        entityKind: 'block' as const,
        targetIndex: block.ref.target.targetIndex,
        blockId: block.ref.blockId,
        rawRef: block.ref,
        location,
        scriptTopBlockId: block.topScript?.topBlockId ?? null,
        category:
          block.opcode === null
            ? null
            : (DESCRIPTOR_BY_OPCODE.get(block.opcode)?.category ?? null),
        semanticLocationSha256: semanticHashV1('semantic-location', location),
        semanticFingerprintSha256: location.semanticFingerprint,
      }
    })
  bases.sort((left, right) =>
  {
    const leftScriptOrder =
      scriptOrder.get(
        scriptKey({
          target: left.rawRef.target,
          topBlockId: left.scriptTopBlockId ?? '',
        })
      ) ?? Number.MAX_SAFE_INTEGER
    const rightScriptOrder =
      scriptOrder.get(
        scriptKey({
          target: right.rawRef.target,
          topBlockId: right.scriptTopBlockId ?? '',
        })
      ) ?? Number.MAX_SAFE_INTEGER
    return (
      left.targetIndex - right.targetIndex ||
      leftScriptOrder - rightScriptOrder ||
      (graphOrder.get(blockKey(left.rawRef)) ?? Number.MAX_SAFE_INTEGER) -
        (graphOrder.get(blockKey(right.rawRef)) ?? Number.MAX_SAFE_INTEGER) ||
      compareText(
        left.semanticFingerprintSha256,
        right.semanticFingerprintSha256
      )
    )
  })
  const grouping = new Map(
    bases.map((base) =>
    {
      const targetLocationSha256 = targetLocationSha256V1(
        project.json.targets[base.targetIndex]!,
        base.targetIndex,
        context
      )
      const scriptLocationSha256 =
        base.location.ownershipStatus === 'uniqueOwned'
          ? semanticHashV1('semantic-location', base.location.script)
          : null
      return [
        base,
        {
          groupKey:
            scriptLocationSha256 === null
              ? `target:${targetLocationSha256}`
              : `script:${scriptLocationSha256}`,
          targetLocationSha256,
          scriptLocationSha256,
        },
      ] as const
    })
  )
  const evidence = contextualizeEvidenceV1(
    'block',
    bases,
    (base) => grouping.get(base)!.groupKey,
    (base) => ({
      targetLocationSha256: grouping.get(base)!.targetLocationSha256,
      scriptLocationSha256: grouping.get(base)!.scriptLocationSha256,
      ownershipPath:
        base.location.ownershipStatus === 'uniqueOwned'
          ? base.location.ownershipPath
          : null,
    })
  )
  context.blockEvidence = evidence
  return evidence
}

function commentWorkspaceV1(comment: Comment)
{
  return {
    x: nullableOptionalNumber(comment, 'x'),
    y: nullableOptionalNumber(comment, 'y'),
    width: optionalNumber(comment, 'width'),
    height: optionalNumber(comment, 'height'),
    minimized: optionalBoolean(comment, 'minimized'),
  }
}

function commentTopologyStatusV1(
  comment: IndexedComment
): 'consistent' | 'inconsistent'
{
  if (comment.attachmentStatus === 'detached')
    return comment.reverseLinkStatus === 'none' ? 'consistent' : 'inconsistent'
  if (comment.attachmentStatus !== 'resolved') return 'inconsistent'
  return comment.reverseLinkStatus === 'unique' &&
    comment.reverseLinkedBlocks[0]?.blockId === comment.attachedBlock?.blockId
    ? 'consistent'
    : 'inconsistent'
}

export function commentEntityEvidenceSetV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex,
  suppliedBlocks?: readonly BlockEntityEvidenceV1[]
): readonly CommentEntityEvidenceV1[]
{
  const context = groupCEvidenceBuildContextV1(project, suppliedIndex)
  if (suppliedBlocks) context.blockEvidence = suppliedBlocks
  return commentEntityEvidenceSetFromContextV1(context)
}

function commentEntityEvidenceSetFromContextV1(
  context: GroupCEvidenceBuildContextV1
): readonly CommentEntityEvidenceV1[]
{
  if (context.commentEvidence) return context.commentEvidence
  const { project, index } = context
  const blocks = blockEntityEvidenceSetFromContextV1(context)
  const blocksByKey = new Map(
    blocks.map((block) => [blockKey(block.rawRef), block])
  )
  const bases = index.comments.map((indexed) =>
  {
    const targetIndex = indexed.ref.target.targetIndex
    const target = project.json.targets[targetIndex]!
    const comment = ownRecordValue(target.comments, indexed.ref.commentId)
    if (!comment)
      return editError('edit.selector_no_match', 'comment is absent')
    const attachedBlock = indexed.attachedBlock
      ? blocksByKey.get(blockKey(indexed.attachedBlock))
      : undefined
    const location: CommentLocationV1 = {
      kind: 'comment',
      target: targetLocationV1(target, targetIndex, context),
      ...(attachedBlock ? { attachedBlock: attachedBlock.location } : {}),
      workspace: commentWorkspaceV1(comment),
      textSha256: commentTextSha256V1(comment.text),
      semanticFingerprint: commentSemanticFingerprintV1(
        targetIndex,
        indexed.ref.commentId,
        comment
      ),
    }
    return {
      entityKind: 'comment' as const,
      targetIndex,
      commentId: indexed.ref.commentId,
      location,
      attachedBlockId: indexed.attachedBlock?.blockId ?? null,
      scriptTopBlockId: indexed.script?.topBlockId ?? null,
      topologyStatus: commentTopologyStatusV1(indexed),
      semanticLocationSha256: semanticHashV1('semantic-location', location),
      semanticFingerprintSha256: location.semanticFingerprint,
    }
  })
  bases.sort(
    (left, right) =>
      left.targetIndex - right.targetIndex ||
      compareText(
        left.semanticFingerprintSha256,
        right.semanticFingerprintSha256
      )
  )
  const targetLocationSha256s = new Map(
    bases.map((base) => [
      base,
      targetLocationSha256V1(
        project.json.targets[base.targetIndex]!,
        base.targetIndex,
        context
      ),
    ])
  )
  const evidence = contextualizeEvidenceV1(
    'comment',
    bases,
    (base) => targetLocationSha256s.get(base)!,
    (base) => ({
      targetLocationSha256: targetLocationSha256s.get(base)!,
      attachedBlockLocationSha256: base.location.attachedBlock
        ? semanticHashV1('semantic-location', base.location.attachedBlock)
        : null,
    })
  )
  context.commentEvidence = evidence
  return evidence
}

export function declarationBoundedLocationProjectionV1(
  evidence: DeclarationEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedDeclarationLocationProjectionV1
{
  const location = evidence.location
  return {
    kind: 'declaration',
    declarationKind: location.declarationKind,
    scopeKind: location.scope.kind === 'project' ? 'project' : 'target',
    ...(location.scope.kind === 'target'
      ? {
          scopeTargetSha256: semanticHashV1(
            'semantic-location',
            location.scope
          ),
        }
      : {}),
    ...(location.declarationKind === 'broadcast'
      ? {
          rawOwnerTargetSha256: semanticHashV1(
            'semantic-location',
            location.rawOwnerTarget
          ),
        }
      : {}),
    name: boundedLocationDisplayStringV1(location.name),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

export function targetBoundedLocationProjectionV1(
  evidence: TargetEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedTargetLocationProjectionV1
{
  return {
    kind: 'target',
    targetKind: evidence.targetKind,
    serializedTargetOrdinal: evidence.targetIndex,
    name: boundedLocationDisplayStringV1(evidence.name),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
    ...(evidence.visualLayerOrdinal === undefined
      ? {}
      : { visualLayerOrdinal: evidence.visualLayerOrdinal }),
  }
}

export function scriptBoundedLocationProjectionV1(
  evidence: ScriptEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedScriptLocationProjectionV1
{
  return {
    kind: 'script',
    targetLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.target
    ),
    hatOrRootOpcode: boundedLocationDisplayStringV1(
      evidence.location.hatOrRootOpcode
    ),
    workspace: evidence.location.workspace,
    boundedOutlineSha256: evidence.location.boundedOutlineSha256,
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

function ownershipPathSha256V1(
  ownershipPath: readonly OwnershipStepV1[]
): string
{
  return canonicalSha256(ownershipPath)
}

function boundedOwnershipStepV1(step: OwnershipStepV1): BoundedOwnershipStepV1
{
  return step.relation === 'next'
    ? step
    : { ...step, name: boundedLocationDisplayStringV1(step.name) }
}

export function blockBoundedLocationProjectionV1(
  evidence: BlockEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedBlockLocationProjectionV1
{
  const location = evidence.location
  if (location.ownershipStatus === 'uniqueOwned')
  {
    const steps = location.ownershipPath.map(boundedOwnershipStepV1)
    return {
      kind: 'block',
      ownershipStatus: 'uniqueOwned',
      scriptLocationSha256: semanticHashV1(
        'semantic-location',
        location.script
      ),
      ownershipPath: {
        stepCount: steps.length,
        fullPathSha256: ownershipPathSha256V1(location.ownershipPath),
        prefix: steps.slice(0, 8),
        suffix: steps.slice(-8),
      },
      opcode: boundedLocationDisplayStringV1(location.opcode),
      semanticFingerprint: evidence.semanticFingerprintSha256,
      fullLocationSha256: evidence.semanticLocationSha256,
      retainedLocationArtifactId,
    }
  }
  return {
    kind: 'block',
    ownershipStatus: location.ownershipStatus,
    targetLocationSha256: semanticHashV1('semantic-location', location.target),
    opcode: boundedLocationDisplayStringV1(location.opcode),
    stableTargetBlockOrdinal: location.stableTargetBlockOrdinal,
    boundedOutlineSha256: location.boundedOutlineSha256,
    candidateScriptSetSha256: location.candidateScriptSetSha256,
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

export function commentBoundedLocationProjectionV1(
  evidence: CommentEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedCommentLocationProjectionV1
{
  return {
    kind: 'comment',
    targetLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.target
    ),
    ...(evidence.location.attachedBlock
      ? {
          attachedBlockLocationSha256: semanticHashV1(
            'semantic-location',
            evidence.location.attachedBlock
          ),
        }
      : {}),
    workspace: evidence.location.workspace,
    textSha256: evidence.location.textSha256,
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

function boundedOwnershipPathMatches(
  path: readonly OwnershipStepV1[],
  bounded: BoundedBlockLocationProjectionV1 & { ownershipStatus: 'uniqueOwned' }
): boolean
{
  if (
    bounded.ownershipPath.stepCount !== path.length ||
    bounded.ownershipPath.fullPathSha256 !== ownershipPathSha256V1(path)
  )
    return false
  const boundedStepMatches = (
    actual: OwnershipStepV1,
    expected: (typeof bounded.ownershipPath.prefix)[number]
  ) =>
  {
    if (
      actual.relation !== expected.relation ||
      actual.ordinal !== expected.ordinal
    )
      return false
    if (actual.relation === 'next' || expected.relation === 'next') return true
    return displayMatches(actual.name, expected.name)
  }
  return (
    bounded.ownershipPath.prefix.every((step, index) =>
      path[index] ? boundedStepMatches(path[index]!, step) : false
    ) &&
    bounded.ownershipPath.suffix.every((step, index) =>
    {
      const actual =
        path[path.length - bounded.ownershipPath.suffix.length + index]
      return actual ? boundedStepMatches(actual, step) : false
    })
  )
}

function declarationExactLocationMatches(
  evidence: DeclarationEntityEvidenceV1,
  location: Extract<
    DeclarationRefV1,
    { refKind: 'structural'; selectorKind: 'exactLocation' }
  >['location']
): boolean
{
  const actual = evidence.location
  const scopeKind = actual.scope.kind === 'project' ? 'project' : 'target'
  const scopeTargetSha256 =
    actual.scope.kind === 'target'
      ? semanticHashV1('semantic-location', actual.scope)
      : undefined
  const rawOwnerTargetSha256 =
    actual.declarationKind === 'broadcast'
      ? semanticHashV1('semantic-location', actual.rawOwnerTarget)
      : undefined
  return (
    location.kind === 'declaration' &&
    location.declarationKind === actual.declarationKind &&
    location.scopeKind === scopeKind &&
    displayMatches(actual.name, location.name) &&
    location.scopeTargetSha256 === scopeTargetSha256 &&
    location.rawOwnerTargetSha256 === rawOwnerTargetSha256 &&
    location.semanticFingerprint === evidence.semanticFingerprintSha256 &&
    location.fullLocationSha256 === evidence.semanticLocationSha256
  )
}

function scriptExactLocationMatches(
  evidence: ScriptEntityEvidenceV1,
  location: Extract<
    ScriptRefV1,
    { refKind: 'structural'; selectorKind: 'exactLocation' }
  >['location']
): boolean
{
  const actual = evidence.location
  return (
    location.kind === 'script' &&
    location.targetLocationSha256 ===
      semanticHashV1('semantic-location', actual.target) &&
    displayMatches(actual.hatOrRootOpcode, location.hatOrRootOpcode) &&
    stateMatches(actual.workspace.x, location.workspace.x) &&
    stateMatches(actual.workspace.y, location.workspace.y) &&
    location.boundedOutlineSha256 === actual.boundedOutlineSha256 &&
    location.semanticFingerprint === evidence.semanticFingerprintSha256 &&
    location.fullLocationSha256 === evidence.semanticLocationSha256
  )
}

function blockExactLocationMatches(
  evidence: BlockEntityEvidenceV1,
  location: Extract<
    BlockRefV1,
    { refKind: 'structural'; selectorKind: 'exactLocation' }
  >['location']
): boolean
{
  const actual = evidence.location
  if (
    location.kind !== 'block' ||
    location.ownershipStatus !== actual.ownershipStatus ||
    !displayMatches(actual.opcode, location.opcode) ||
    location.semanticFingerprint !== evidence.semanticFingerprintSha256 ||
    location.fullLocationSha256 !== evidence.semanticLocationSha256
  )
    return false
  if (
    actual.ownershipStatus === 'uniqueOwned' &&
    location.ownershipStatus === 'uniqueOwned'
  )
    return (
      location.scriptLocationSha256 ===
        semanticHashV1('semantic-location', actual.script) &&
      boundedOwnershipPathMatches(actual.ownershipPath, location)
    )
  if (
    actual.ownershipStatus !== 'uniqueOwned' &&
    location.ownershipStatus !== 'uniqueOwned'
  )
    return (
      location.targetLocationSha256 ===
        semanticHashV1('semantic-location', actual.target) &&
      location.stableTargetBlockOrdinal === actual.stableTargetBlockOrdinal &&
      location.boundedOutlineSha256 === actual.boundedOutlineSha256 &&
      location.candidateScriptSetSha256 === actual.candidateScriptSetSha256
    )
  return false
}

function commentExactLocationMatches(
  evidence: CommentEntityEvidenceV1,
  location: Extract<
    CommentRefV1,
    { refKind: 'structural'; selectorKind: 'exactLocation' }
  >['location']
): boolean
{
  const actual = evidence.location
  const attachedBlockLocationSha256 = actual.attachedBlock
    ? semanticHashV1('semantic-location', actual.attachedBlock)
    : undefined
  return (
    location.kind === 'comment' &&
    location.targetLocationSha256 ===
      semanticHashV1('semantic-location', actual.target) &&
    location.attachedBlockLocationSha256 === attachedBlockLocationSha256 &&
    stateMatches(actual.workspace.x, location.workspace.x) &&
    stateMatches(actual.workspace.y, location.workspace.y) &&
    stateMatches(actual.workspace.width, location.workspace.width) &&
    stateMatches(actual.workspace.height, location.workspace.height) &&
    stateMatches(actual.workspace.minimized, location.workspace.minimized) &&
    location.textSha256 === actual.textSha256 &&
    location.semanticFingerprint === evidence.semanticFingerprintSha256 &&
    location.fullLocationSha256 === evidence.semanticLocationSha256
  )
}

function commonExactEvidenceMatches(
  evidence: ExactEntityEvidenceV1,
  reference: {
    readonly expectedFullLocationSha256: string
    readonly expectedSemanticFingerprint: string
    readonly expectedContextFingerprint: string
  }
): boolean
{
  return (
    evidence.semanticLocationSha256 === reference.expectedFullLocationSha256 &&
    evidence.semanticFingerprintSha256 ===
      reference.expectedSemanticFingerprint &&
    evidence.contextFingerprintSha256 === reference.expectedContextFingerprint
  )
}

function resolveScopeV1(
  project: ProjectIR,
  scope: StructuralMatchScopeV1,
  adapters: GroupCEntityResolverAdaptersV1,
  depth: number,
  context?: GroupCEvidenceBuildContextV1
): { readonly targetIndex?: number; readonly script?: ScriptEntityEvidenceV1 }
{
  if (depth > 32)
    return editError(
      'edit.nesting_exceeded',
      'selector scope nesting exceeds 32'
    )
  if (scope.scopeKind === 'project') return {}
  if (scope.scopeKind === 'target')
    return {
      targetIndex: resolveTargetRefV1(project, scope.target, adapters.target)
        .targetIndex,
    }
  const script = resolveScriptRefInternalV1(
    project,
    scope.script,
    adapters,
    depth + 1,
    context ?? groupCEvidenceBuildContextV1(project)
  )
  return { targetIndex: script.targetIndex, script }
}

function declarationMatchesCriteria(
  evidence: DeclarationEntityEvidenceV1,
  criteria: Extract<
    DeclarationRefV1,
    { refKind: 'structural'; selectorKind: 'matchSet' }
  >['criteria']
): boolean
{
  return criteria.conjunction.every((criterion) =>
  {
    if (criterion.criterionKind === 'nameIdentity')
    {
      const bytes = canonicalJsonBytesV1(evidence.location.name)
      return (
        bytes.byteLength === criterion.name.canonicalJsonStringByteLength &&
        sha256Hex(bytes) === criterion.name.valueSha256
      )
    }
    if (criterion.criterionKind === 'contentFingerprint')
      return evidence.semanticFingerprintSha256 === criterion.contentFingerprint
    if (criterion.semanticSurface !== 'declaration') return false
    if (criterion.property === 'name') return true
    if (
      evidence.declarationKind === 'variable' &&
      (criterion.property === 'initialValue' || criterion.property === 'cloud')
    )
      return true
    return (
      evidence.declarationKind === 'list' &&
      criterion.property === 'initialItems'
    )
  })
}

function scriptMatchesCriteria(
  evidence: ScriptEntityEvidenceV1,
  criteria: Extract<
    ScriptRefV1,
    { refKind: 'structural'; selectorKind: 'matchSet' }
  >['criteria']
): boolean
{
  return criteria.conjunction.every((criterion) =>
  {
    if (criterion.criterionKind === 'opcode')
      return evidence.location.hatOrRootOpcode === criterion.opcode
    if (criterion.criterionKind === 'category')
      return evidence.category === criterion.category
    if (criterion.criterionKind === 'rootRole')
      return evidence.rootRole === criterion.rootRole
    return evidence.semanticFingerprintSha256 === criterion.contentFingerprint
  })
}

function blockMatchesCriteria(
  project: ProjectIR,
  evidence: BlockEntityEvidenceV1,
  criteria: Extract<
    BlockRefV1,
    { refKind: 'structural'; selectorKind: 'matchSet' }
  >['criteria']
): boolean
{
  const raw = rawBlock(project, evidence.rawRef)
  return criteria.conjunction.every((criterion) =>
  {
    if (criterion.criterionKind === 'opcode')
      return evidence.location.opcode === criterion.opcode
    if (criterion.criterionKind === 'category')
      return evidence.category === criterion.category
    if (criterion.criterionKind === 'contentFingerprint')
      return evidence.semanticFingerprintSha256 === criterion.contentFingerprint
    if (criterion.semanticSurface === 'blockField')
      return Object.hasOwn(raw.fields ?? {}, criterion.property)
    if (criterion.semanticSurface === 'blockInput')
      return Object.hasOwn(raw.inputs ?? {}, criterion.property)
    return false
  })
}

function scopeMatchesEvidence(
  evidence: ExactEntityEvidenceV1 & {
    readonly scriptTopBlockId?: string | null
  },
  scope: {
    readonly targetIndex?: number
    readonly script?: ScriptEntityEvidenceV1
  }
): boolean
{
  if (
    scope.targetIndex !== undefined &&
    evidence.targetIndex !== scope.targetIndex
  )
    return false
  if (!scope.script) return true
  return evidence.scriptTopBlockId === scope.script.topBlockId
}

export function resolveDeclarationRefV1(
  project: ProjectIR,
  reference: DeclarationRefV1,
  adapters: GroupCEntityResolverAdaptersV1 = {}
): DeclarationEntityEvidenceV1
{
  const context = groupCEvidenceBuildContextV1(project)
  const evidence = declarationEntityEvidenceSetFromContextV1(context)
  if (reference.refKind === 'handle')
  {
    const selected =
      evidence[
        callbackIndex(
          adapters.resolveDeclarationHandle?.(reference, evidence),
          evidence,
          'edit.stale_handle',
          'declaration'
        )
      ]!
    if (
      selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint
    )
      return editError('edit.stale_handle', 'declaration handle is stale')
    return selected
  }
  if (reference.refKind === 'created')
    return evidence[
      callbackIndex(
        adapters.resolveDeclarationCreated?.(reference, evidence),
        evidence,
        'edit.created_result_invalid',
        'declaration'
      )
    ]!
  if (reference.selectorKind === 'exactLocation')
  {
    const selected = exactLocationEvidence(
      evidence,
      reference.location.fullLocationSha256
    )
    if (!selected)
      return editError(
        'edit.selector_no_match',
        'declaration location is absent'
      )
    if (
      !declarationExactLocationMatches(selected, reference.location) ||
      !commonExactEvidenceMatches(selected, reference)
    )
      return editError(
        'edit.fingerprint_mismatch',
        'declaration location changed'
      )
    return selected
  }
  const scope = resolveScopeV1(project, reference.scope, adapters, 0, context)
  const matches = evidence.filter(
    (candidate) =>
      scopeMatchesEvidence(candidate, scope) &&
      declarationMatchesCriteria(candidate, reference.criteria)
  )
  return selectMatchV1(
    'declaration',
    matches,
    reference.selection,
    reference,
    adapters.activeMatchCandidateLimit
  )
}

function resolveScriptRefInternalV1(
  project: ProjectIR,
  reference: ScriptRefV1,
  adapters: GroupCEntityResolverAdaptersV1,
  depth: number,
  context: GroupCEvidenceBuildContextV1
): ScriptEntityEvidenceV1
{
  const evidence = scriptEntityEvidenceSetFromContextV1(context)
  if (reference.refKind === 'handle')
  {
    const selected =
      evidence[
        callbackIndex(
          adapters.resolveScriptHandle?.(reference, evidence),
          evidence,
          'edit.stale_handle',
          'script'
        )
      ]!
    if (
      selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint
    )
      return editError('edit.stale_handle', 'script handle is stale')
    return selected
  }
  if (reference.refKind === 'created')
    return evidence[
      callbackIndex(
        adapters.resolveScriptCreated?.(reference, evidence),
        evidence,
        'edit.created_result_invalid',
        'script'
      )
    ]!
  if (reference.selectorKind === 'exactLocation')
  {
    const selected = exactLocationEvidence(
      evidence,
      reference.location.fullLocationSha256
    )
    if (!selected)
      return editError('edit.selector_no_match', 'script location is absent')
    if (
      !scriptExactLocationMatches(selected, reference.location) ||
      !commonExactEvidenceMatches(selected, reference)
    )
      return editError('edit.fingerprint_mismatch', 'script location changed')
    return selected
  }
  const scope = resolveScopeV1(
    project,
    reference.scope,
    adapters,
    depth,
    context
  )
  const matches = evidence.filter(
    (candidate) =>
      scopeMatchesEvidence(
        { ...candidate, scriptTopBlockId: candidate.topBlockId },
        scope
      ) && scriptMatchesCriteria(candidate, reference.criteria)
  )
  return selectMatchV1(
    'script',
    matches,
    reference.selection,
    reference,
    adapters.activeMatchCandidateLimit
  )
}

export function resolveScriptRefV1(
  project: ProjectIR,
  reference: ScriptRefV1,
  adapters: GroupCEntityResolverAdaptersV1 = {}
): ScriptEntityEvidenceV1
{
  return resolveScriptRefInternalV1(
    project,
    reference,
    adapters,
    0,
    groupCEvidenceBuildContextV1(project)
  )
}

export function resolveBlockRefV1(
  project: ProjectIR,
  reference: BlockRefV1,
  adapters: GroupCEntityResolverAdaptersV1 = {}
): BlockEntityEvidenceV1
{
  const context = groupCEvidenceBuildContextV1(project)
  const evidence = blockEntityEvidenceSetFromContextV1(context)
  if (reference.refKind === 'handle')
  {
    const selected =
      evidence[
        callbackIndex(
          adapters.resolveBlockHandle?.(reference, evidence),
          evidence,
          'edit.stale_handle',
          'block'
        )
      ]!
    if (
      selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint
    )
      return editError('edit.stale_handle', 'block handle is stale')
    return selected
  }
  if (reference.refKind === 'created')
    return evidence[
      callbackIndex(
        adapters.resolveBlockCreated?.(reference, evidence),
        evidence,
        'edit.created_result_invalid',
        'block'
      )
    ]!
  if (reference.selectorKind === 'exactLocation')
  {
    const selected = exactLocationEvidence(
      evidence,
      reference.location.fullLocationSha256
    )
    if (!selected)
      return editError('edit.selector_no_match', 'block location is absent')
    if (
      !blockExactLocationMatches(selected, reference.location) ||
      !commonExactEvidenceMatches(selected, reference)
    )
      return editError('edit.fingerprint_mismatch', 'block location changed')
    return selected
  }
  const scope = resolveScopeV1(project, reference.scope, adapters, 0, context)
  const matches = evidence.filter(
    (candidate) =>
      scopeMatchesEvidence(candidate, scope) &&
      blockMatchesCriteria(project, candidate, reference.criteria)
  )
  return selectMatchV1(
    'block',
    matches,
    reference.selection,
    reference,
    adapters.activeMatchCandidateLimit
  )
}

function assertCommentTopologyV1(evidence: CommentEntityEvidenceV1): void
{
  if (evidence.topologyStatus !== 'consistent')
    return editError(
      'edit.reference_propagation_incomplete',
      'comment attachment topology is inconsistent'
    )
}

export function resolveCommentRefV1(
  project: ProjectIR,
  reference: CommentRefV1,
  adapters: GroupCEntityResolverAdaptersV1 = {}
): CommentEntityEvidenceV1
{
  const context = groupCEvidenceBuildContextV1(project)
  const evidence = commentEntityEvidenceSetFromContextV1(context)
  let selected: CommentEntityEvidenceV1
  if (reference.refKind === 'handle')
  {
    selected =
      evidence[
        callbackIndex(
          adapters.resolveCommentHandle?.(reference, evidence),
          evidence,
          'edit.stale_handle',
          'comment'
        )
      ]!
    if (
      selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint
    )
      return editError('edit.stale_handle', 'comment handle is stale')
  }
  else if (reference.refKind === 'created')
    selected =
      evidence[
        callbackIndex(
          adapters.resolveCommentCreated?.(reference, evidence),
          evidence,
          'edit.created_result_invalid',
          'comment'
        )
      ]!
  else if (reference.selectorKind === 'exactLocation')
  {
    const exact = exactLocationEvidence(
      evidence,
      reference.location.fullLocationSha256
    )
    if (!exact)
      return editError('edit.selector_no_match', 'comment location is absent')
    if (
      !commentExactLocationMatches(exact, reference.location) ||
      !commonExactEvidenceMatches(exact, reference)
    )
      return editError('edit.fingerprint_mismatch', 'comment location changed')
    selected = exact
  }
  else
  {
    const scope = resolveScopeV1(project, reference.scope, adapters, 0, context)
    const matches = evidence.filter(
      (candidate) =>
        scopeMatchesEvidence(candidate, scope) &&
        reference.criteria.conjunction.every(
          (criterion) =>
            candidate.semanticFingerprintSha256 === criterion.contentFingerprint
        )
    )
    selected = selectMatchV1(
      'comment',
      matches,
      reference.selection,
      reference,
      adapters.activeMatchCandidateLimit
    )
  }
  assertCommentTopologyV1(selected)
  return selected
}

export function assertSameTargetBlockV1(
  targetIndex: number,
  block: BlockEntityEvidenceV1
): void
{
  if (targetIndex !== block.targetIndex)
    return editError('edit.invalid_owner', 'block belongs to another target')
}

export function assertSameTargetCommentBlockV1(
  comment: CommentEntityEvidenceV1,
  block: BlockEntityEvidenceV1
): void
{
  assertSameTargetBlockV1(comment.targetIndex, block)
}

// ---------------------------------------------------------------------------
// media record resolution
// ---------------------------------------------------------------------------

// a record whose declared archive entry is absent stays addressable: it is
// preservation-only opaque data, so it resolves w/ a declared-identity digest
// instead of a payload digest rather than dropping out of the evidence set
function mediaPayloadProjectionV1(
  record: Costume | Sound,
  payloadSha256: string | null
): MediaLocationV1['payload']
{
  if (payloadSha256 !== null) return { resolution: 'present', payloadSha256 }
  const declaredIdentity = {
    assetId: record.assetId,
    dataFormat: record.dataFormat,
    archivePath: mediaArchivePathV1(record),
  }
  return {
    resolution: 'missing',
    expectedAssetIdentitySha256: semanticHashV1('semantic-fingerprint', {
      kind: 'media-declared-identity',
      ...declaredIdentity,
    }),
    diagnosticFingerprint: semanticHashV1('evidence-content', {
      kind: 'media-absent-payload-diagnostic',
      schemaVersion: 1,
      ...declaredIdentity,
      name: record.name,
    }),
  }
}

function mediaLocationV1(
  targetLocation: TargetLocationV1,
  record: Costume | Sound,
  mediaKind: 'costume' | 'sound',
  ordinal: number,
  payloadSha256: string | null
): MediaLocationV1
{
  return {
    kind: 'media',
    mediaKind,
    name: record.name,
    order: ordinal,
    payload: mediaPayloadProjectionV1(record, payloadSha256),
    semanticFingerprint: mediaSemanticFingerprintV1(record, mediaKind),
    target: targetLocation,
  }
}

// every media record is admissible evidence, duplicate names included: a
// match-set selector has to see the true match count, & the capability profile
// is what stands the family down when names are not exactly unique
export function mediaRecordEntityEvidenceSetV1(
  project: ProjectIR
): readonly MediaRecordEntityEvidenceV1[]
{
  // one hash per distinct archive path per build; a payload shared by several
  // records is bounded to a single pass over its bytes
  const payloadDigests = new Map<string, string | null>()
  const assetsByPath = new Map<string, Asset>()
  for (const asset of project.assets)
  {
    if (!assetsByPath.has(asset.path)) assetsByPath.set(asset.path, asset)
  }
  const payloadDigest = (archivePath: string): string | null =>
  {
    const cached = payloadDigests.get(archivePath)
    if (cached !== undefined) return cached
    const asset = assetsByPath.get(archivePath)
    const digest = asset ? sha256Hex(asset.bytes) : null
    payloadDigests.set(archivePath, digest)
    return digest
  }
  const bases: Omit<MediaRecordEntityEvidenceV1, 'contextFingerprintSha256'>[] =
    []
  for (const [targetIndex, target] of project.json.targets.entries())
  {
    let targetLocation: TargetLocationV1 | undefined
    for (const mediaKind of ['costume', 'sound'] as const)
    {
      const records: readonly (Costume | Sound)[] =
        mediaKind === 'costume' ? target.costumes : target.sounds
      for (const [ordinal, record] of records.entries())
      {
        const archivePath = mediaArchivePathV1(record)
        targetLocation ??= targetLocationV1(target, targetIndex)
        const location = mediaLocationV1(
          targetLocation,
          record,
          mediaKind,
          ordinal,
          payloadDigest(archivePath)
        )
        bases.push({
          entityKind: 'media',
          targetIndex,
          mediaKind,
          ordinal,
          name: record.name,
          assetId: record.assetId,
          dataFormat: record.dataFormat,
          archivePath,
          payloadSha256: payloadDigest(archivePath),
          location,
          semanticLocationSha256: semanticHashV1('semantic-location', location),
          semanticFingerprintSha256: location.semanticFingerprint,
        })
      }
    }
  }
  const targetLocationSha256s = new Map<number, string>()
  for (const base of bases)
  {
    if (targetLocationSha256s.has(base.targetIndex)) continue
    targetLocationSha256s.set(
      base.targetIndex,
      semanticHashV1('semantic-location', base.location.target)
    )
  }
  // context is the ordered collection the record actually lives in, so a
  // costume never neighbors a sound even inside the same target
  return contextualizeEvidenceV1(
    'media',
    bases,
    (base) => `${base.targetIndex}:${base.mediaKind}`,
    (base) => ({
      targetLocationSha256: targetLocationSha256s.get(base.targetIndex)!,
      mediaKind: base.mediaKind,
    })
  )
}

export function mediaBoundedLocationProjectionV1(
  evidence: MediaRecordEntityEvidenceV1,
  retainedLocationArtifactId: string
): BoundedMediaLocationProjectionV1
{
  const payload = evidence.location.payload
  return {
    kind: 'media',
    mediaKind: evidence.mediaKind,
    name: boundedLocationDisplayStringV1(evidence.name),
    order: evidence.ordinal,
    payloadResolution: payload.resolution,
    payloadOrExpectedIdentitySha256:
      payload.resolution === 'present'
        ? payload.payloadSha256
        : payload.expectedAssetIdentitySha256,
    ...(payload.resolution === 'present'
      ? {}
      : { diagnosticFingerprint: payload.diagnosticFingerprint }),
    targetLocationSha256: semanticHashV1(
      'semantic-location',
      evidence.location.target
    ),
    semanticFingerprint: evidence.semanticFingerprintSha256,
    fullLocationSha256: evidence.semanticLocationSha256,
    retainedLocationArtifactId,
  }
}

function mediaExactLocationMatches(
  evidence: MediaRecordEntityEvidenceV1,
  location: Extract<
    MediaRefV1,
    { refKind: 'structural'; selectorKind: 'exactLocation' }
  >['location']
): boolean
{
  const payload = evidence.location.payload
  const expectedPayloadDigest =
    payload.resolution === 'present'
      ? payload.payloadSha256
      : payload.expectedAssetIdentitySha256
  return (
    location.kind === 'media' &&
    location.mediaKind === evidence.mediaKind &&
    location.order === evidence.ordinal &&
    displayMatches(evidence.name, location.name) &&
    location.payloadResolution === payload.resolution &&
    location.payloadOrExpectedIdentitySha256 === expectedPayloadDigest &&
    location.targetLocationSha256 ===
      semanticHashV1('semantic-location', evidence.location.target) &&
    location.semanticFingerprint === evidence.semanticFingerprintSha256 &&
    location.fullLocationSha256 === evidence.semanticLocationSha256
  )
}

const COSTUME_MATCH_PROPERTIES: ReadonlySet<string> = Object.freeze(
  new Set([
    'name',
    'order',
    'assetId',
    'dataFormat',
    'md5ext',
    'bitmapResolution',
    'rotationCenterX',
    'rotationCenterY',
  ])
)

const SOUND_MATCH_PROPERTIES: ReadonlySet<string> = Object.freeze(
  new Set([
    'name',
    'order',
    'assetId',
    'dataFormat',
    'md5ext',
    'format',
    'rate',
    'sampleCount',
  ])
)

// media is the one entity whose content fingerprint is the retained payload
// rather than the semantic fingerprint, which is exactly what makes a shared
// asset select several records at once
function mediaMatchesCriteria(
  evidence: MediaRecordEntityEvidenceV1,
  criteria: Extract<
    MediaRefV1,
    { refKind: 'structural'; selectorKind: 'matchSet' }
  >['criteria']
): boolean
{
  return criteria.conjunction.every((criterion) =>
  {
    if (criterion.criterionKind === 'nameIdentity')
    {
      const bytes = canonicalJsonBytesV1(evidence.name)
      return (
        bytes.byteLength === criterion.name.canonicalJsonStringByteLength &&
        sha256Hex(bytes) === criterion.name.valueSha256
      )
    }
    if (criterion.criterionKind === 'contentFingerprint')
      return (
        evidence.payloadSha256 !== null &&
        evidence.payloadSha256 === criterion.contentFingerprint
      )
    if (criterion.semanticSurface !== evidence.mediaKind) return false
    return (
      evidence.mediaKind === 'costume'
        ? COSTUME_MATCH_PROPERTIES
        : SOUND_MATCH_PROPERTIES
    ).has(criterion.property)
  })
}

export function resolveMediaRefV1(
  project: ProjectIR,
  reference: MediaRefV1,
  adapters: GroupCEntityResolverAdaptersV1 = {}
): MediaRecordEntityEvidenceV1
{
  const evidence = mediaRecordEntityEvidenceSetV1(project)
  if (reference.refKind === 'handle')
  {
    const selected =
      evidence[
        callbackIndex(
          adapters.resolveMediaHandle?.(reference, evidence),
          evidence,
          'edit.stale_handle',
          'media'
        )
      ]!
    if (
      selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint
    )
      return editError('edit.stale_handle', 'media handle is stale')
    return selected
  }
  if (reference.refKind === 'created')
    return evidence[
      callbackIndex(
        adapters.resolveMediaCreated?.(reference, evidence),
        evidence,
        'edit.created_result_invalid',
        'media'
      )
    ]!
  if (reference.selectorKind === 'exactLocation')
  {
    const selected = exactLocationEvidence(
      evidence,
      reference.location.fullLocationSha256
    )
    if (!selected)
      return editError('edit.selector_no_match', 'media location is absent')
    if (
      !mediaExactLocationMatches(selected, reference.location) ||
      !commonExactEvidenceMatches(selected, reference)
    )
      return editError('edit.fingerprint_mismatch', 'media location changed')
    return selected
  }
  const scope = resolveScopeV1(project, reference.scope, adapters, 0)
  const matches = evidence.filter(
    (candidate) =>
      scopeMatchesEvidence(candidate, scope) &&
      mediaMatchesCriteria(candidate, reference.criteria)
  )
  return selectMatchV1(
    'media',
    matches,
    reference.selection,
    reference,
    adapters.activeMatchCandidateLimit
  )
}
