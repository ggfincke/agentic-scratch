// packages/ir/src/edit/operations/media-operations.ts
// synthesize & apply exact costume/sound record, order, payload, & current-costume transactions

import {
  isBlockEntry,
  scratchRecordKeys,
  scratchRecordValue,
  type Costume,
  type DerivedCostumeAssetIdentity,
  type DerivedMediaAssetIdentity,
  type DerivedSoundAssetIdentity,
  type Sound,
  type Target,
} from '@scratch-agent/sb3'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type { ProjectIR } from '../../project/project-ir.js'
import { jsonPointerPart as pointerPart } from '../../project/project-vocabulary.js'
import type {
  CostumePlacementV1,
  CostumeReplacementPlacementV1,
  CostumeSelectionPreconditionV1,
  ExistingOptionalNumberV1,
  ExpectedStringIdentityV1,
  ProspectiveNameActivationGuardV1,
  SemanticEditOperationMediaAddCostumeV1,
  SemanticEditOperationMediaAddSoundV1,
  SemanticEditOperationMediaRemoveCostumeV1,
  SemanticEditOperationMediaRemoveSoundV1,
  SemanticEditOperationMediaRenameCostumeV1,
  SemanticEditOperationMediaRenameSoundV1,
  SemanticEditOperationMediaReorderCostumeV1,
  SemanticEditOperationMediaReorderSoundV1,
  SemanticEditOperationMediaReplaceCostumeV1,
  SemanticEditOperationMediaReplaceSoundV1,
  SemanticEditOperationMediaSetCurrentCostumeV1,
} from '../contracts.generated.js'
import { semanticHashV1 } from '../contracts/hash-domains.js'
import { compareLexicalTextV1 as compareText } from '../support/lexical-order.js'
import { unknownNameSemanticsEvidenceV1 } from '../semantic-index/name-semantics-catalog.js'
import { buildSemanticReferenceIndex } from '../semantic-index/reference-index.js'
import {
  type MediaKind,
  type SemanticReferenceIndex,
} from '../semantic-index/reference-index-types.js'
import { validateExpectedStringIdentity } from '../contracts/semantic-validation.js'

type MediaOperationV1 =
  | SemanticEditOperationMediaAddCostumeV1
  | SemanticEditOperationMediaRenameCostumeV1
  | SemanticEditOperationMediaReorderCostumeV1
  | SemanticEditOperationMediaReplaceCostumeV1
  | SemanticEditOperationMediaRemoveCostumeV1
  | SemanticEditOperationMediaAddSoundV1
  | SemanticEditOperationMediaRenameSoundV1
  | SemanticEditOperationMediaReorderSoundV1
  | SemanticEditOperationMediaReplaceSoundV1
  | SemanticEditOperationMediaRemoveSoundV1
  | SemanticEditOperationMediaSetCurrentCostumeV1

const MEDIA_OPERATION_KINDS_V1 = [
  'media.addCostume',
  'media.addSound',
  'media.removeCostume',
  'media.removeSound',
  'media.renameCostume',
  'media.renameSound',
  'media.reorderCostume',
  'media.reorderSound',
  'media.replaceCostume',
  'media.replaceSound',
  'media.setCurrentCostume',
] as const

type MediaOperationKindV1 = (typeof MEDIA_OPERATION_KINDS_V1)[number]

type MediaOperationErrorCodeV1 =
  | 'edit.archive_conflict'
  | 'edit.asset_digest_mismatch'
  | 'edit.cardinality_mismatch'
  | 'edit.dynamic_reference'
  | 'edit.entity_still_referenced'
  | 'edit.fingerprint_mismatch'
  | 'edit.internal_invariant'
  | 'edit.invalid_move'
  | 'edit.invalid_owner'
  | 'edit.invalid_shape'
  | 'edit.last_costume'
  | 'edit.media_order_reference'
  | 'edit.planning_facts_mismatch'
  | 'edit.project_constraint'
  | 'edit.protected_change'
  | 'edit.selector_no_match'
  | 'edit.semantic_noop'
  | 'edit.unsupported_media'

class MediaOperationErrorV1 extends Error
{
  constructor(
    readonly code: MediaOperationErrorCodeV1,
    message: string,
    readonly matchCount: number | null = null
  )
  {
    super(message)
    this.name = 'MediaOperationErrorV1'
  }
}

function mediaError(
  code: MediaOperationErrorCodeV1,
  message: string,
  matchCount: number | null = null
): never
{
  throw new MediaOperationErrorV1(code, message, matchCount)
}

function hashSet(kind: string, rows: readonly unknown[]): string
{
  return semanticHashV1('semantic-fingerprint', {
    schemaVersion: 1,
    setKind: kind,
    rows,
  })
}

// one costume/sound record addressed by its owning target & serialized ordinal;
// the dispatcher resolves a MediaRefV1 down to exactly this before apply
export interface MediaSlotV1
{
  readonly targetIndex: number
  readonly mediaKind: MediaKind
  readonly ordinal: number
}

function targetAt(project: ProjectIR, targetIndex: number): Target
{
  const target = project.json.targets[targetIndex]
  if (!target)
    mediaError('edit.invalid_owner', `target ${targetIndex} is absent`)
  return target
}

function mediaListV1(
  target: Target,
  mediaKind: MediaKind
): (Costume | Sound)[]
{
  return mediaKind === 'costume' ? target.costumes : target.sounds
}

function mediaAt(
  project: ProjectIR,
  slot: MediaSlotV1
): { target: Target; record: Costume | Sound }
{
  const target = targetAt(project, slot.targetIndex)
  const record = mediaListV1(target, slot.mediaKind)[slot.ordinal]
  if (!record)
    mediaError(
      'edit.selector_no_match',
      `${slot.mediaKind} ordinal ${slot.ordinal} is absent from target ${slot.targetIndex}`
    )
  return { target, record }
}

export function mediaArchivePathV1(record: Costume | Sound): string
{
  return record.md5ext ?? `${record.assetId}.${record.dataFormat}`
}

// the exact revision-0 lineage identity a media record carries; the ordinal is
// part of it, so a lineage row keeps naming the position it was minted at while
// `canonicalOrdinal` is what later order changes reindex
export function mediaLineageRawIdentityV1(
  record: Pick<Costume | Sound, 'assetId' | 'dataFormat'>,
  mediaKind: MediaKind,
  ordinal: number
): string
{
  return `${mediaKind}:${record.assetId}:${record.dataFormat}:${ordinal}`
}

// the exact semantic identity of one media record: name, archive identity, &
// the kind-specific derived metadata the format table emits. serialized
// ordinal is deliberately excluded so a reorder moves an entity, never remakes it.
export function mediaSemanticFingerprintV1(
  record: Costume | Sound,
  mediaKind: MediaKind
): string
{
  const base = {
    kind: 'media',
    mediaKind,
    name: record.name,
    assetId: record.assetId,
    dataFormat: record.dataFormat,
    archivePath: mediaArchivePathV1(record),
  }
  if (mediaKind === 'costume')
  {
    const costume = record as Costume
    return semanticHashV1('semantic-fingerprint', {
      ...base,
      bitmapResolution: costume.bitmapResolution ?? null,
      rotationCenterX: costume.rotationCenterX ?? null,
      rotationCenterY: costume.rotationCenterY ?? null,
    })
  }
  const sound = record as Sound
  return semanticHashV1('semantic-fingerprint', {
    ...base,
    format: sound.format ?? null,
    rate: sound.rate ?? null,
    sampleCount: sound.sampleCount ?? null,
  })
}

// ---------------------------------------------------------------------------
// current-costume selection state
// ---------------------------------------------------------------------------

interface CurrentCostumeStateV1
{
  readonly rawState: ExistingOptionalNumberV1
  readonly effectiveIndex: number | null
  readonly costumeCount: number
}

// scratch-vm clamps the raw serialized value into range while deserializing
// (`parseScratchObject` in serialization/sb3.js) & RenderedTarget defaults to 0
// when the property is absent, so the effective selection is derived, not read
export function currentCostumeStateV1(target: Target): CurrentCostumeStateV1
{
  const costumeCount = target.costumes.length
  const raw = target.currentCostume
  const rawState: ExistingOptionalNumberV1 =
    raw === undefined ? { state: 'missing' } : { state: 'value', value: raw }
  if (raw !== undefined && !Number.isInteger(raw))
    mediaError(
      'edit.invalid_shape',
      'currentCostume is present but is not an integer'
    )
  if (costumeCount === 0)
    return Object.freeze({ rawState, effectiveIndex: null, costumeCount })
  const effectiveIndex =
    raw === undefined ? 0 : Math.min(Math.max(raw, 0), costumeCount - 1)
  return Object.freeze({ rawState, effectiveIndex, costumeCount })
}

function sameOptionalNumber(
  left: ExistingOptionalNumberV1,
  right: ExistingOptionalNumberV1
): boolean
{
  if (left.state === 'missing' || right.state === 'missing')
    return left.state === right.state
  return left.value === right.value
}

// the frozen canonical final raw state: a project that never serialized
// currentCostume keeps not serializing it while the selection stays on index 0,
// & every other outcome writes the reconciled effective index verbatim
export function reconciledCurrentCostumeStateV1(
  before: CurrentCostumeStateV1,
  reconciledEffectiveIndex: number
): ExistingOptionalNumberV1
{
  if (before.rawState.state === 'missing' && reconciledEffectiveIndex === 0)
    return { state: 'missing' }
  return { state: 'value', value: reconciledEffectiveIndex }
}

type MediaOrdinalShiftV1 =
  | { readonly kind: 'insert'; readonly at: number }
  | { readonly kind: 'remove'; readonly at: number }
  | { readonly kind: 'move'; readonly from: number; readonly to: number }

// replay the exact splice the operation performs against an ordinal list & read
// off where the tracked record lands. deriving the shift from the same mutation
// it describes is what keeps the arithmetic from drifting per operation kind.
export function shiftedOrdinalV1(
  count: number,
  shift: MediaOrdinalShiftV1,
  tracked: number
): number | null
{
  const ordinals = Array.from({ length: count }, (_value, index) => index)
  if (shift.kind === 'insert') ordinals.splice(shift.at, 0, -1)
  else if (shift.kind === 'remove') ordinals.splice(shift.at, 1)
  else
  {
    const [moved] = ordinals.splice(shift.from, 1)
    ordinals.splice(shift.to, 0, moved!)
  }
  const landed = ordinals.indexOf(tracked)
  return landed === -1 ? null : landed
}

export type ResolvedCostumeSelectionV1 =
  | { readonly selectionState: 'uninitializedCreatedTarget' }
  | { readonly selectionState: 'selected'; readonly slot: MediaSlotV1 }

// the caller pre-declares the observed effective selection & its exact raw
// state; both are verified so a stale index or a stale raw value each refuse
function assertCostumeSelectionV1(
  target: Target,
  targetIndex: number,
  expected: CostumeSelectionPreconditionV1,
  resolved: ResolvedCostumeSelectionV1
): CurrentCostumeStateV1
{
  const state = currentCostumeStateV1(target)
  if (expected.selectionState === 'uninitializedCreatedTarget')
  {
    if (resolved.selectionState !== 'uninitializedCreatedTarget')
      mediaError(
        'edit.internal_invariant',
        'resolved selection disagrees with the declared uninitialized arm'
      )
    if (state.costumeCount !== expected.expectedCostumeCount)
      mediaError(
        'edit.cardinality_mismatch',
        `uninitialized target carries ${state.costumeCount} costumes`
      )
    return state
  }
  if (resolved.selectionState !== 'selected')
    mediaError(
      'edit.internal_invariant',
      'resolved selection disagrees with the declared selected arm'
    )
  if (state.effectiveIndex === null)
    mediaError(
      'edit.cardinality_mismatch',
      'a selected current costume was declared but the target has none'
    )
  if (
    resolved.slot.targetIndex !== targetIndex ||
    resolved.slot.mediaKind !== 'costume'
  )
    mediaError(
      'edit.invalid_owner',
      'declared current costume belongs to another target'
    )
  if (resolved.slot.ordinal !== state.effectiveIndex)
    mediaError(
      'edit.selector_no_match',
      'declared current costume is not the effective selection'
    )
  if (expected.expectedEffectiveCurrentCostumeIndex !== state.effectiveIndex)
    mediaError(
      'edit.planning_facts_mismatch',
      'declared effective current-costume index is stale'
    )
  if (!sameOptionalNumber(expected.expectedRawCurrentCostume, state.rawState))
    mediaError(
      'edit.planning_facts_mismatch',
      'declared raw current-costume state is stale'
    )
  const selected = target.costumes[state.effectiveIndex]!
  if (
    expected.expectedEffectiveCurrentCostumeFingerprint !==
    mediaSemanticFingerprintV1(selected, 'costume')
  )
    mediaError(
      'edit.fingerprint_mismatch',
      'declared current-costume fingerprint is stale'
    )
  return state
}

function commitCurrentCostumeV1(
  target: Target,
  final: ExistingOptionalNumberV1
): void
{
  if (final.state === 'missing') delete target.currentCostume
  else target.currentCostume = final.value
}

function assertFinalCurrentCostumeV1(
  declared: ExistingOptionalNumberV1,
  reconciled: ExistingOptionalNumberV1
): void
{
  if (!sameOptionalNumber(declared, reconciled))
    mediaError(
      'edit.planning_facts_mismatch',
      'declared final current-costume state does not match the reconciled state'
    )
}

// ---------------------------------------------------------------------------
// order, reference & reachability evidence
// ---------------------------------------------------------------------------

interface MediaOrderEvidenceV1
{
  readonly mediaCount: number
  readonly orderSha256: string
  readonly orderedFingerprints: readonly string[]
}

export function mediaOrderEvidenceV1(
  target: Target,
  mediaKind: MediaKind
): MediaOrderEvidenceV1
{
  const records = mediaListV1(target, mediaKind)
  const rows = records.map((record, ordinal) => ({
    ordinal,
    name: record.name,
    archivePath: mediaArchivePathV1(record),
    semanticFingerprint: mediaSemanticFingerprintV1(record, mediaKind),
  }))
  return Object.freeze({
    mediaCount: records.length,
    orderSha256: hashSet(`media-order-${mediaKind}-v1`, rows),
    orderedFingerprints: Object.freeze(
      rows.map((row) => row.semanticFingerprint)
    ),
  })
}

interface MediaReferenceEvidenceV1
{
  readonly directReferenceCount: number
  readonly orderSensitiveReferenceCount: number
  readonly dynamicSelectorCount: number
  readonly referenceSetSha256: string
  readonly referencePaths: readonly string[]
}

function mediaReferencePath(reference: {
  block: { target: { targetIndex: number }; blockId: string }
  sourceBlock: { blockId: string } | null
  inputName: string | null
  fieldName: string | null
}): string
{
  const targetIndex = reference.block.target.targetIndex
  if (reference.fieldName !== null && reference.sourceBlock !== null)
    return `/targets/${targetIndex}/blocks/${pointerPart(reference.sourceBlock.blockId)}/fields/${pointerPart(reference.fieldName)}/0`
  if (reference.inputName !== null)
    return `/targets/${targetIndex}/blocks/${pointerPart(reference.block.blockId)}/inputs/${pointerPart(reference.inputName)}/1/1`
  return `/targets/${targetIndex}/blocks/${pointerPart(reference.block.blockId)}`
}

function indexedMediaV1(index: SemanticReferenceIndex, slot: MediaSlotV1)
{
  const indexed = index.media.find(
    (entry) =>
      entry.ref.target.targetIndex === slot.targetIndex &&
      entry.ref.kind === slot.mediaKind &&
      entry.ref.mediaIndex === slot.ordinal
  )
  if (!indexed)
    mediaError(
      'edit.selector_no_match',
      'the selected media record is absent from the reference index'
    )
  return indexed
}

// direct name references, domain-wide order-sensitive references, & domain
// dynamic selectors are counted apart: only the first set is what a name-based
// removal must drive to zero, & the other two drive their own refusals
export function mediaReferenceEvidenceV1(
  project: ProjectIR,
  slot: MediaSlotV1,
  suppliedIndex?: SemanticReferenceIndex
): MediaReferenceEvidenceV1
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const indexed = indexedMediaV1(index, slot)
  const direct = indexed.references.filter(
    (reference) =>
      reference.resolutionStatus === 'resolved' ||
      reference.resolutionStatus === 'ambiguous'
  )
  const orderSensitive = indexed.references.filter(
    (reference) => reference.resolutionStatus === 'order-sensitive'
  )
  const dynamic = index.dynamicMediaSelectorReferences.filter(
    (reference) =>
      reference.target.targetIndex === slot.targetIndex &&
      reference.kind === slot.mediaKind
  )
  const rows = [
    ...direct.map((reference) => ({
      referenceKind: 'direct' as const,
      domain: reference.domain,
      resolutionStatus: reference.resolutionStatus,
      path: mediaReferencePath(reference),
    })),
    ...orderSensitive.map((reference) => ({
      referenceKind: 'orderSensitive' as const,
      domain: reference.domain,
      resolutionStatus: reference.resolutionStatus,
      path: mediaReferencePath(reference),
    })),
    ...dynamic.map((reference) => ({
      referenceKind: 'dynamic' as const,
      domain: reference.domain,
      resolutionStatus: reference.reason,
      path: mediaReferencePath({ ...reference, fieldName: null }),
    })),
  ].sort(
    (left, right) =>
      compareText(left.referenceKind, right.referenceKind) ||
      compareText(left.path, right.path)
  )
  return Object.freeze({
    directReferenceCount: direct.length,
    orderSensitiveReferenceCount: orderSensitive.length,
    dynamicSelectorCount: dynamic.length,
    referenceSetSha256: hashSet('media-reference-set-v1', rows),
    referencePaths: Object.freeze(rows.map((row) => row.path)),
  })
}

interface MediaReachabilityEvidenceV1
{
  readonly referencedArchivePaths: readonly string[]
  readonly retainedArchivePaths: readonly string[]
  readonly protectedArchivePaths: readonly string[]
  readonly reachabilitySha256: string
}

// project-wide on purpose: a payload shared by two media records stays reachable
// when one record is detached, & the protected set is exactly the retained
// payloads no record claims. V1 never garbage-collects either set.
export function mediaReachabilityEvidenceV1(
  project: ProjectIR
): MediaReachabilityEvidenceV1
{
  const referenced = new Set<string>()
  for (const target of project.json.targets)
  {
    for (const costume of target.costumes)
      referenced.add(mediaArchivePathV1(costume))
    for (const sound of target.sounds) referenced.add(mediaArchivePathV1(sound))
  }
  const retained = [...new Set(project.assets.map((asset) => asset.path))].sort(
    compareText
  )
  const referencedPaths = [...referenced].sort(compareText)
  const protectedPaths = retained.filter((path) => !referenced.has(path))
  return Object.freeze({
    referencedArchivePaths: Object.freeze(referencedPaths),
    retainedArchivePaths: Object.freeze(retained),
    protectedArchivePaths: Object.freeze(protectedPaths),
    reachabilitySha256: hashSet('media-reachability-v1', [
      { rowKind: 'referenced', paths: referencedPaths },
      { rowKind: 'retained', paths: retained },
      { rowKind: 'protected', paths: protectedPaths },
    ]),
  })
}

// ---------------------------------------------------------------------------
// naming rules
// ---------------------------------------------------------------------------

function assertAuthoringNameV1(name: string): void
{
  const bytes = new TextEncoder().encode(name)
  if (
    name.length === 0 ||
    bytes.byteLength > 256 ||
    name.includes('\0') ||
    name.normalize('NFC') !== name ||
    /[\uD800-\uDFFF]/u.test(
      [...name].filter((value) => value.length === 1).join('')
    )
  )
    mediaError(
      'edit.project_constraint',
      'media name violates the V1 authoring contract'
    )
}

const RESERVED_COSTUME_TOKENS = new Set(['next costume', 'previous costume'])

const RESERVED_BACKDROP_TOKENS = new Set([
  'next backdrop',
  'previous backdrop',
  'random backdrop',
])

// an exact new media name may never hijack a pinned selector token or read as a
// one-based ordinal; `mediaOrderSelector` in reference-index.ts is the same
// classification the runtime lookup precedence applies
function assertSelectableMediaNameV1(
  name: string,
  mediaKind: MediaKind,
  isStage: boolean
): void
{
  if (mediaKind === 'costume')
  {
    if (
      RESERVED_COSTUME_TOKENS.has(name) ||
      (isStage && RESERVED_BACKDROP_TOKENS.has(name))
    )
      mediaError(
        'edit.project_constraint',
        `media name ${name} collides with a pinned selector token`
      )
  }
  if (name.trim().length > 0 && !Number.isNaN(Number(name)))
    mediaError(
      'edit.project_constraint',
      `media name ${name} is interpreted as a one-based ordinal selector`
    )
}

function assertUniqueMediaNameV1(
  target: Target,
  mediaKind: MediaKind,
  name: string,
  excludingOrdinal: number | null
): void
{
  const collides = mediaListV1(target, mediaKind).some(
    (record, ordinal) => ordinal !== excludingOrdinal && record.name === name
  )
  if (collides)
    mediaError(
      'edit.project_constraint',
      `${mediaKind} name ${name} already exists in the target`
    )
}

interface StageBackdropHatCollisionEvidenceV1
{
  readonly uppercaseHatCollisionCount: number
  readonly collisionSetSha256: string
  readonly collidingNames: readonly string[]
}

// `Runtime.startHats` uppercases both the requested field & every cached hat
// field, so two stage costumes differing only by case are behaviorally the same
// `event_whenbackdropswitchesto` receiver even though direct lookup is exact
function stageBackdropHatCollisionEvidenceV1(
  project: ProjectIR,
  name: string,
  excludingOrdinal: number | null
): StageBackdropHatCollisionEvidenceV1
{
  const stage = project.json.targets.find((target) => target.isStage)
  const rows = (stage?.costumes ?? [])
    .map((costume, ordinal) => ({ ordinal, name: costume.name }))
    .filter(
      (row) =>
        row.ordinal !== excludingOrdinal &&
        row.name.toUpperCase() === name.toUpperCase()
    )
    .sort((left, right) => left.ordinal - right.ordinal)
  return Object.freeze({
    uppercaseHatCollisionCount: rows.length,
    collisionSetSha256: hashSet('stage-backdrop-hat-collision-set-v1', rows),
    collidingNames: Object.freeze(rows.map((row) => row.name)),
  })
}

interface MediaNameActivationEvidenceV1
{
  readonly activationCount: number
  readonly activationSetSha256: string
  readonly activationPaths: readonly string[]
}

// a new or renamed media name activates every reference that could not resolve
// before, plus every domain dynamic selector; V1 requires the count to be zero
export function mediaNameActivationEvidenceV1(
  project: ProjectIR,
  slot: Pick<MediaSlotV1, 'targetIndex' | 'mediaKind'>,
  name: string,
  suppliedIndex?: SemanticReferenceIndex
): MediaNameActivationEvidenceV1
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const rows = [
    ...index.unresolvedMediaReferences
      .filter(
        (reference) =>
          reference.kind === slot.mediaKind &&
          reference.referencedName === name &&
          reference.block.target.targetIndex === slot.targetIndex
      )
      .map((reference) => ({
        activationKind: 'unresolved-static',
        path: mediaReferencePath(reference),
      })),
    ...index.dynamicMediaSelectorReferences
      .filter(
        (reference) =>
          reference.kind === slot.mediaKind &&
          reference.target.targetIndex === slot.targetIndex
      )
      .map((reference) => ({
        activationKind: 'dynamic',
        path: mediaReferencePath({ ...reference, fieldName: null }),
      })),
  ].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.activationKind, right.activationKind)
  )
  return Object.freeze({
    activationCount: rows.length,
    activationSetSha256: hashSet('media-name-activation-set-v1', rows),
    activationPaths: Object.freeze(rows.map((row) => row.path)),
  })
}

function assertActivationV1(
  expected: ProspectiveNameActivationGuardV1,
  evidence: MediaNameActivationEvidenceV1
): void
{
  if (expected.expectedActivationSetSha256 !== evidence.activationSetSha256)
    mediaError(
      'edit.planning_facts_mismatch',
      'prospective media activation set changed'
    )
  if (evidence.activationCount !== expected.requireProspectiveActivationCount)
    mediaError(
      'edit.dynamic_reference',
      'media add/rename would activate an unresolved or dynamic reference'
    )
}

function assertExpectedNameV1(
  expected: ExpectedStringIdentityV1,
  actual: string
): void
{
  if (!validateExpectedStringIdentity(expected, actual).valid)
    mediaError(
      'edit.fingerprint_mismatch',
      'expected media name identity is stale'
    )
}

interface MediaDomainOrderPolicyV1
{
  readonly orderSensitiveReferenceCount: number
  readonly dynamicSelectorCount: number
  readonly orderPolicySha256: string
}

// an order-changing operation shifts every ordinal meaning in one target+kind
// domain, so the policy is domain-wide rather than per-record: an add has no
// record of its own yet & a remove disturbs every sibling ordinal alike
export function mediaDomainOrderPolicyV1(
  project: ProjectIR,
  targetIndex: number,
  mediaKind: MediaKind,
  suppliedIndex?: SemanticReferenceIndex
): MediaDomainOrderPolicyV1
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const inDomain = (reference: {
    target: { targetIndex: number }
    kind: MediaKind
  }): boolean =>
    reference.target.targetIndex === targetIndex && reference.kind === mediaKind
  const orderSensitive = index.mediaOrderReferences.filter(inDomain)
  const dynamic = index.dynamicMediaSelectorReferences.filter(inDomain)
  const rows = [
    ...orderSensitive.map((reference) => ({
      policyKind: 'orderSensitive',
      domain: reference.domain,
      selectorKind: reference.selectorKind,
      path: mediaReferencePath(reference),
    })),
    ...dynamic.map((reference) => ({
      policyKind: 'dynamic',
      domain: reference.domain,
      selectorKind: reference.reason,
      path: mediaReferencePath({ ...reference, fieldName: null }),
    })),
  ].sort(
    (left, right) =>
      compareText(left.policyKind, right.policyKind) ||
      compareText(left.path, right.path)
  )
  return Object.freeze({
    orderSensitiveReferenceCount: orderSensitive.length,
    dynamicSelectorCount: dynamic.length,
    orderPolicySha256: hashSet('media-domain-order-policy-v1', rows),
  })
}

// V1 has no bounded runtime proof that a `next costume` block or a computed
// selector does not observe the shift, so it refuses rather than guessing
function assertOrderChangeAuthorizedV1(
  project: ProjectIR,
  targetIndex: number,
  mediaKind: MediaKind,
  index: SemanticReferenceIndex
): void
{
  const policy = mediaDomainOrderPolicyV1(
    project,
    targetIndex,
    mediaKind,
    index
  )
  if (policy.dynamicSelectorCount > 0)
    mediaError(
      'edit.dynamic_reference',
      'a dynamic media selector could observe this order change'
    )
  if (policy.orderSensitiveReferenceCount > 0)
    mediaError(
      'edit.media_order_reference',
      'an order-sensitive media reference could observe this order change'
    )
}

// ---------------------------------------------------------------------------
// reference propagation
// ---------------------------------------------------------------------------

interface MediaNameSiteV1
{
  readonly targetIndex: number
  readonly blockId: string
  readonly fieldName: string | null
  readonly inputName: string | null
  readonly path: string
}

// scratch-vm renames media by rewriting every block field of the domain's field
// name whose value equals the old name (`Blocks.updateAssetName`), scoped to the
// owner except stage backdrops which sweep every target
function mediaNameFieldScopeV1(
  slot: MediaSlotV1,
  isStage: boolean
): readonly { fieldName: string; allTargets: boolean }[]
{
  if (slot.mediaKind === 'sound')
    return [{ fieldName: 'SOUND_MENU', allTargets: false }]
  if (!isStage) return [{ fieldName: 'COSTUME', allTargets: false }]
  return [
    { fieldName: 'BACKDROP', allTargets: true },
    { fieldName: 'COSTUME', allTargets: false },
  ]
}

function mediaNameSitesV1(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  slot: MediaSlotV1,
  isStage: boolean,
  currentName: string
): readonly MediaNameSiteV1[]
{
  const sites = new Map<string, MediaNameSiteV1>()
  for (const scope of mediaNameFieldScopeV1(slot, isStage))
  {
    for (const [targetIndex, target] of project.json.targets.entries())
    {
      if (!scope.allTargets && targetIndex !== slot.targetIndex) continue
      for (const blockId of scratchRecordKeys(target.blocks).sort())
      {
        const entry = scratchRecordValue(target.blocks, blockId)
        if (!isBlockEntry(entry)) continue
        const field = scratchRecordValue(entry.fields, scope.fieldName)
        if (!field || field[0] !== currentName) continue
        const site: MediaNameSiteV1 = {
          targetIndex,
          blockId,
          fieldName: scope.fieldName,
          inputName: null,
          path: `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/fields/${pointerPart(scope.fieldName)}/0`,
        }
        sites.set(site.path, site)
      }
    }
  }
  // a hand-authored project can carry the selector as an inline literal instead
  // of a menu block; the index resolves those & leaving them behind would dangle
  const indexed = indexedMediaV1(index, slot)
  for (const reference of indexed.references)
  {
    if (
      reference.resolutionStatus !== 'resolved' ||
      reference.referencedName !== currentName ||
      reference.fieldName !== null ||
      reference.inputName === null
    )
      continue
    const site: MediaNameSiteV1 = {
      targetIndex: reference.block.target.targetIndex,
      blockId: reference.block.blockId,
      fieldName: null,
      inputName: reference.inputName,
      path: mediaReferencePath(reference),
    }
    sites.set(site.path, site)
  }
  return Object.freeze(
    [...sites.values()].sort((left, right) =>
      compareText(left.path, right.path)
    )
  )
}

function propagateMediaNameV1(
  project: ProjectIR,
  sites: readonly MediaNameSiteV1[],
  newName: string
): void
{
  for (const site of sites)
  {
    const target = project.json.targets[site.targetIndex]!
    const entry = scratchRecordValue(target.blocks, site.blockId)
    if (!isBlockEntry(entry))
      mediaError(
        'edit.internal_invariant',
        'indexed media reference block disappeared'
      )
    if (site.fieldName !== null)
    {
      const field = scratchRecordValue(entry.fields, site.fieldName)
      if (!field)
        mediaError(
          'edit.internal_invariant',
          'indexed media reference field disappeared'
        )
      field[0] = newName
      continue
    }
    const input = scratchRecordValue(entry.inputs, site.inputName!)
    const primitive = input?.[1]
    if (!Array.isArray(primitive))
      mediaError(
        'edit.internal_invariant',
        'indexed media reference literal disappeared'
      )
    primitive[1] = newName
  }
}

// ---------------------------------------------------------------------------
// capability assessment
// ---------------------------------------------------------------------------

interface MediaEntityEvidenceV1
{
  readonly targetIndex: number
  readonly mediaKind: MediaKind
  readonly ordinal: number
  readonly name: string
  readonly archivePath: string
  readonly semanticFingerprintSha256: string
}

// only a media record whose name is exactly unique inside its target & kind is
// admissible evidence: `mediaByName` lookup collapses duplicates into one
// identity, so a repeated name cannot carry a stable entity
function mediaEntityEvidenceSetV1(
  project: ProjectIR
): readonly MediaEntityEvidenceV1[]
{
  const rows: MediaEntityEvidenceV1[] = []
  for (const [targetIndex, target] of project.json.targets.entries())
  {
    for (const mediaKind of ['costume', 'sound'] as const)
    {
      const records = mediaListV1(target, mediaKind)
      const counts = new Map<string, number>()
      for (const record of records)
        counts.set(record.name, (counts.get(record.name) ?? 0) + 1)
      for (const [ordinal, record] of records.entries())
      {
        if (counts.get(record.name) !== 1) continue
        if (record.name.length === 0 || record.assetId.length === 0) continue
        if (record.dataFormat.length === 0) continue
        rows.push({
          targetIndex,
          mediaKind,
          ordinal,
          name: record.name,
          archivePath: mediaArchivePathV1(record),
          semanticFingerprintSha256: mediaSemanticFingerprintV1(
            record,
            mediaKind
          ),
        })
      }
    }
  }
  return Object.freeze(rows)
}

// deliberately carries ONE availability over coveredOperationKinds rather than
// a per-operation row set; the media family is enabled as a complete unit
interface MediaCapabilityAssessmentV1
{
  readonly family: 'media'
  readonly availability: 'supported' | 'unsupported'
  readonly coveredOperationKinds: readonly MediaOperationKindV1[]
  readonly indexedMediaCount: number
  readonly admissibleMediaCount: number
  readonly restrictions: readonly string[]
  readonly assessmentSha256: string
}

// an existing stage backdrop pair that differs only by case is behaviorally
// ambiguous under the hat rule, so the whole family stands down rather than
// letting one add/rename silently repoint a receiver
function existingStageBackdropHatCollisionV1(project: ProjectIR): boolean
{
  const stage = project.json.targets.find((target) => target.isStage)
  const seen = new Set<string>()
  for (const costume of stage?.costumes ?? [])
  {
    const key = costume.name.toUpperCase()
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

// one aggregate verdict over all eleven media operation kinds; the family is
// available as a complete unit or not at all, never per-operation
export function assessMediaOperationCapabilitiesV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): MediaCapabilityAssessmentV1
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const restrictions: string[] = []
  const unknownSemantics = unknownNameSemanticsEvidenceV1(project.json)
  const unknownSemanticsBlocked =
    unknownSemantics.declaredExtensions.length > 0 ||
    unknownSemantics.unknownOpcodes.length > 0 ||
    unknownSemantics.surfaceIssues.length > 0
  if (unknownSemanticsBlocked)
    restrictions.push(
      'unknown extension or opcode name semantics restrict structural media edits'
    )
  const indexedMediaCount = index.media.length
  const admissibleMediaCount = mediaEntityEvidenceSetV1(project).length
  const mediaEvidenceComplete = indexedMediaCount === admissibleMediaCount
  if (!mediaEvidenceComplete)
    restrictions.push(
      'repeated or malformed media names leave lineage rows without exact evidence'
    )
  const stageHatCollision = existingStageBackdropHatCollisionV1(project)
  if (stageHatCollision)
    restrictions.push(
      'existing stage backdrop names collide under the uppercase hat rule'
    )
  const supported =
    !unknownSemanticsBlocked && mediaEvidenceComplete && !stageHatCollision
  const assessment = {
    family: 'media' as const,
    availability: supported ? ('supported' as const) : ('unsupported' as const),
    coveredOperationKinds: MEDIA_OPERATION_KINDS_V1,
    indexedMediaCount,
    admissibleMediaCount,
    restrictions: Object.freeze(restrictions.sort(compareText)),
  }
  return Object.freeze({
    ...assessment,
    assessmentSha256: semanticHashV1('capability-profile', assessment),
  })
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export type ResolvedMediaOperationV1 =
  | {
      readonly operation: SemanticEditOperationMediaAddCostumeV1
      readonly targetIndex: number
      readonly identity: DerivedCostumeAssetIdentity
      readonly payload: Uint8Array
      readonly currentSelection: ResolvedCostumeSelectionV1
    }
  | {
      readonly operation: SemanticEditOperationMediaAddSoundV1
      readonly targetIndex: number
      readonly identity: DerivedSoundAssetIdentity
      readonly payload: Uint8Array
    }
  | {
      readonly operation: SemanticEditOperationMediaRenameCostumeV1
      readonly slot: MediaSlotV1
    }
  | {
      readonly operation: SemanticEditOperationMediaRenameSoundV1
      readonly slot: MediaSlotV1
    }
  | {
      readonly operation: SemanticEditOperationMediaReorderCostumeV1
      readonly slot: MediaSlotV1
      readonly currentSelection: ResolvedCostumeSelectionV1
    }
  | {
      readonly operation: SemanticEditOperationMediaReorderSoundV1
      readonly slot: MediaSlotV1
    }
  | {
      readonly operation: SemanticEditOperationMediaReplaceCostumeV1
      readonly slot: MediaSlotV1
      readonly identity: DerivedCostumeAssetIdentity
      readonly payload: Uint8Array
    }
  | {
      readonly operation: SemanticEditOperationMediaReplaceSoundV1
      readonly slot: MediaSlotV1
      readonly identity: DerivedSoundAssetIdentity
      readonly payload: Uint8Array
    }
  | {
      readonly operation: SemanticEditOperationMediaRemoveCostumeV1
      readonly slot: MediaSlotV1
      readonly currentSelection: ResolvedCostumeSelectionV1
    }
  | {
      readonly operation: SemanticEditOperationMediaRemoveSoundV1
      readonly slot: MediaSlotV1
    }
  | {
      readonly operation: SemanticEditOperationMediaSetCurrentCostumeV1
      readonly targetIndex: number
      readonly slot: MediaSlotV1
      readonly currentSelection: ResolvedCostumeSelectionV1
    }

export interface AppliedMediaOperationV1
{
  readonly opId: string
  readonly operationKind: MediaOperationV1['kind']
  readonly targetIndex: number
  readonly mediaKind: MediaKind
  readonly mediaName: string
  readonly mediaOrdinal: number | null
  readonly createdMediaOrdinal: number | null
  readonly detachedMediaOrdinal: number | null
  readonly admittedArchivePaths: readonly string[]
  readonly protectedArchivePaths: readonly string[]
  readonly propagatedReferencePaths: readonly string[]
  readonly currentCostumeBefore: ExistingOptionalNumberV1 | null
  readonly currentCostumeAfter: ExistingOptionalNumberV1 | null
  readonly exactPaths: readonly string[]
}

export function mediaCollectionPathV1(
  targetIndex: number,
  mediaKind: MediaKind
): string
{
  return `/targets/${targetIndex}/${mediaKind === 'costume' ? 'costumes' : 'sounds'}`
}

// the payload is admitted into the archive under its own derived md5ext; an
// identical path w/ identical bytes is the shared-asset case & dedupes, while
// identical path w/ different bytes is a real conflict `packSb3` would reject
function admitArchivePayloadV1(
  project: ProjectIR,
  identity: DerivedMediaAssetIdentity,
  payload: Uint8Array
): readonly string[]
{
  const existing = project.assets.find(
    (asset) => asset.path === identity.md5ext
  )
  if (existing)
  {
    const same =
      existing.bytes.byteLength === payload.byteLength &&
      existing.bytes.every((byte, offset) => byte === payload[offset])
    if (!same)
      mediaError(
        'edit.archive_conflict',
        `archive path ${identity.md5ext} already holds different bytes`
      )
    return Object.freeze([])
  }
  project.assets.push({ path: identity.md5ext, bytes: payload })
  return Object.freeze([identity.md5ext])
}

function assertPayloadDigestV1(
  expectedPayloadSha256: string,
  identity: DerivedMediaAssetIdentity
): void
{
  if (expectedPayloadSha256 !== identity.sha256)
    mediaError(
      'edit.asset_digest_mismatch',
      'admitted payload digest does not match the declared asset digest'
    )
}

function costumePlacementV1(
  placement: CostumePlacementV1,
  identity: DerivedCostumeAssetIdentity
): { rotationCenterX: number; rotationCenterY: number }
{
  if (placement.kind === 'derivedImageCenter')
    return {
      rotationCenterX: identity.width / 2,
      rotationCenterY: identity.height / 2,
    }
  if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y))
    mediaError(
      'edit.invalid_shape',
      'explicit costume center must be finite in both axes'
    )
  return { rotationCenterX: placement.x, rotationCenterY: placement.y }
}

function costumeRecordV1(
  name: string,
  identity: DerivedCostumeAssetIdentity,
  center: { rotationCenterX: number; rotationCenterY: number }
): Costume
{
  return {
    assetId: identity.md5,
    name,
    dataFormat: identity.dataFormat,
    md5ext: identity.md5ext,
    bitmapResolution: identity.bitmapResolution,
    rotationCenterX: center.rotationCenterX,
    rotationCenterY: center.rotationCenterY,
  }
}

function soundRecordV1(
  name: string,
  identity: DerivedSoundAssetIdentity
): Sound
{
  return {
    assetId: identity.md5,
    name,
    dataFormat: identity.dataFormat,
    md5ext: identity.md5ext,
    format: identity.format,
    rate: identity.rate,
    sampleCount: identity.sampleCount,
  }
}

export function applyMediaOperationV1(
  project: ProjectIR,
  resolved: ResolvedMediaOperationV1
): AppliedMediaOperationV1
{
  const kind = resolved.operation.kind
  if (kind === 'media.addCostume')
    return applyAddCostume(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        { operation: SemanticEditOperationMediaAddCostumeV1 }
      >
    )
  if (kind === 'media.addSound')
    return applyAddSound(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        { operation: SemanticEditOperationMediaAddSoundV1 }
      >
    )
  if (kind === 'media.renameCostume' || kind === 'media.renameSound')
    return applyRename(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        {
          operation:
            | SemanticEditOperationMediaRenameCostumeV1
            | SemanticEditOperationMediaRenameSoundV1
        }
      >
    )
  if (kind === 'media.reorderCostume')
    return applyReorderCostume(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        { operation: SemanticEditOperationMediaReorderCostumeV1 }
      >
    )
  if (kind === 'media.reorderSound')
    return applyReorderSound(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        { operation: SemanticEditOperationMediaReorderSoundV1 }
      >
    )
  if (kind === 'media.replaceCostume' || kind === 'media.replaceSound')
    return applyReplace(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        {
          operation:
            | SemanticEditOperationMediaReplaceCostumeV1
            | SemanticEditOperationMediaReplaceSoundV1
        }
      >
    )
  if (kind === 'media.removeCostume')
    return applyRemoveCostume(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        { operation: SemanticEditOperationMediaRemoveCostumeV1 }
      >
    )
  if (kind === 'media.removeSound')
    return applyRemoveSound(
      project,
      resolved as Extract<
        ResolvedMediaOperationV1,
        { operation: SemanticEditOperationMediaRemoveSoundV1 }
      >
    )
  return applySetCurrentCostume(
    project,
    resolved as Extract<
      ResolvedMediaOperationV1,
      { operation: SemanticEditOperationMediaSetCurrentCostumeV1 }
    >
  )
}

function applyAddCostume(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaAddCostumeV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, targetIndex, identity, payload } = resolved
  const target = targetAt(project, targetIndex)
  const index = buildSemanticReferenceIndex(project)
  assertPayloadDigestV1(operation.asset.expectedPayloadSha256, identity)
  assertAuthoringNameV1(operation.name)
  assertSelectableMediaNameV1(operation.name, 'costume', target.isStage)
  assertUniqueMediaNameV1(target, 'costume', operation.name, null)
  if (target.isStage)
  {
    const collision = stageBackdropHatCollisionEvidenceV1(
      project,
      operation.name,
      null
    )
    if (collision.uppercaseHatCollisionCount > 0)
      mediaError(
        'edit.project_constraint',
        'backdrop name collides under the uppercase hat rule'
      )
  }
  const order = operation.order
  if (!Number.isInteger(order) || order < 0 || order > target.costumes.length)
    mediaError('edit.invalid_move', `costume order ${order} is out of range`)
  const orderEvidence = mediaOrderEvidenceV1(target, 'costume')
  if (orderEvidence.orderSha256 !== operation.expectedCostumeOrderSha256)
    mediaError(
      'edit.planning_facts_mismatch',
      'expected costume order hash is stale'
    )
  assertActivationV1(
    operation.nameActivation,
    mediaNameActivationEvidenceV1(
      project,
      { targetIndex, mediaKind: 'costume' },
      operation.name,
      index
    )
  )
  const before = assertCostumeSelectionV1(
    target,
    targetIndex,
    operation.currentSelection,
    resolved.currentSelection
  )
  assertOrderChangeAuthorizedV1(project, targetIndex, 'costume', index)
  const admitted = admitArchivePayloadV1(project, identity, payload)
  const record = costumeRecordV1(
    operation.name,
    identity,
    costumePlacementV1(operation.placement, identity)
  )
  target.costumes.splice(order, 0, record)
  // an uninitialized created target has no prior selection, so the first
  // costume becomes index 0; otherwise the same record stays selected
  const reconciledIndex =
    before.effectiveIndex === null
      ? 0
      : shiftedOrdinalV1(
          before.costumeCount,
          { kind: 'insert', at: order },
          before.effectiveIndex
        )!
  const final = reconciledCurrentCostumeStateV1(before, reconciledIndex)
  assertFinalCurrentCostumeV1(operation.expectedFinalCurrentCostumeState, final)
  commitCurrentCostumeV1(target, final)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    mediaKind: 'costume',
    mediaName: operation.name,
    mediaOrdinal: order,
    createdMediaOrdinal: order,
    detachedMediaOrdinal: null,
    admittedArchivePaths: admitted,
    protectedArchivePaths: Object.freeze([]),
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: before.rawState,
    currentCostumeAfter: final,
    exactPaths: Object.freeze([
      mediaCollectionPathV1(targetIndex, 'costume'),
      `/targets/${targetIndex}/currentCostume`,
    ]),
  })
}

function applyAddSound(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaAddSoundV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, targetIndex, identity, payload } = resolved
  const target = targetAt(project, targetIndex)
  const index = buildSemanticReferenceIndex(project)
  assertPayloadDigestV1(operation.asset.expectedPayloadSha256, identity)
  assertAuthoringNameV1(operation.name)
  assertSelectableMediaNameV1(operation.name, 'sound', target.isStage)
  assertUniqueMediaNameV1(target, 'sound', operation.name, null)
  const order = operation.order
  if (!Number.isInteger(order) || order < 0 || order > target.sounds.length)
    mediaError('edit.invalid_move', `sound order ${order} is out of range`)
  assertActivationV1(
    operation.nameActivation,
    mediaNameActivationEvidenceV1(
      project,
      { targetIndex, mediaKind: 'sound' },
      operation.name,
      index
    )
  )
  assertOrderChangeAuthorizedV1(project, targetIndex, 'sound', index)
  const admitted = admitArchivePayloadV1(project, identity, payload)
  target.sounds.splice(order, 0, soundRecordV1(operation.name, identity))
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    mediaKind: 'sound',
    mediaName: operation.name,
    mediaOrdinal: order,
    createdMediaOrdinal: order,
    detachedMediaOrdinal: null,
    admittedArchivePaths: admitted,
    protectedArchivePaths: Object.freeze([]),
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: null,
    currentCostumeAfter: null,
    exactPaths: Object.freeze([mediaCollectionPathV1(targetIndex, 'sound')]),
  })
}

function applyRename(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    {
      operation:
        | SemanticEditOperationMediaRenameCostumeV1
        | SemanticEditOperationMediaRenameSoundV1
    }
  >
): AppliedMediaOperationV1
{
  const { operation, slot } = resolved
  const { target, record } = mediaAt(project, slot)
  const index = buildSemanticReferenceIndex(project)
  assertExpectedNameV1(operation.expectedName, record.name)
  if (operation.newName === record.name)
    mediaError('edit.semantic_noop', 'media rename is a semantic no-op')
  assertAuthoringNameV1(operation.newName)
  assertSelectableMediaNameV1(operation.newName, slot.mediaKind, target.isStage)
  assertUniqueMediaNameV1(
    target,
    slot.mediaKind,
    operation.newName,
    slot.ordinal
  )
  if (slot.mediaKind === 'costume' && target.isStage)
  {
    const collision = stageBackdropHatCollisionEvidenceV1(
      project,
      operation.newName,
      slot.ordinal
    )
    if (collision.uppercaseHatCollisionCount > 0)
      mediaError(
        'edit.project_constraint',
        'backdrop rename collides under the uppercase hat rule'
      )
  }
  const referenceEvidence = mediaReferenceEvidenceV1(project, slot, index)
  if (
    referenceEvidence.referenceSetSha256 !==
    operation.expectedReferenceSetSha256
  )
    mediaError(
      'edit.planning_facts_mismatch',
      'expected media reference set hash is stale'
    )
  assertActivationV1(
    operation.newNameActivation,
    mediaNameActivationEvidenceV1(project, slot, operation.newName, index)
  )
  const sites = mediaNameSitesV1(
    project,
    index,
    slot,
    target.isStage,
    record.name
  )
  propagateMediaNameV1(project, sites, operation.newName)
  record.name = operation.newName
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex: slot.targetIndex,
    mediaKind: slot.mediaKind,
    mediaName: operation.newName,
    mediaOrdinal: slot.ordinal,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: null,
    admittedArchivePaths: Object.freeze([]),
    protectedArchivePaths: Object.freeze([]),
    propagatedReferencePaths: Object.freeze(sites.map((site) => site.path)),
    currentCostumeBefore: null,
    currentCostumeAfter: null,
    exactPaths: Object.freeze([
      `${mediaCollectionPathV1(slot.targetIndex, slot.mediaKind)}/${slot.ordinal}/name`,
      ...sites.map((site) => site.path),
    ]),
  })
}

function assertReorderBoundsV1(
  operation: { expectedIndex: number; newIndex: number },
  slot: MediaSlotV1,
  count: number
): void
{
  if (operation.expectedIndex !== slot.ordinal)
    mediaError(
      'edit.planning_facts_mismatch',
      'expected media index does not match the resolved record'
    )
  if (
    !Number.isInteger(operation.newIndex) ||
    operation.newIndex < 0 ||
    operation.newIndex > count - 1
  )
    mediaError(
      'edit.invalid_move',
      `media index ${operation.newIndex} is out of range`
    )
  if (operation.newIndex === operation.expectedIndex)
    mediaError('edit.semantic_noop', 'media reorder is a semantic no-op')
}

function applyReorderCostume(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaReorderCostumeV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, slot } = resolved
  const { target, record } = mediaAt(project, slot)
  const index = buildSemanticReferenceIndex(project)
  assertReorderBoundsV1(operation, slot, target.costumes.length)
  const orderEvidence = mediaOrderEvidenceV1(target, 'costume')
  if (orderEvidence.orderSha256 !== operation.expectedMediaOrderSha256)
    mediaError(
      'edit.planning_facts_mismatch',
      'expected costume order hash is stale'
    )
  assertOrderChangeAuthorizedV1(project, slot.targetIndex, 'costume', index)
  const before = assertCostumeSelectionV1(
    target,
    slot.targetIndex,
    operation.currentSelection,
    resolved.currentSelection
  )
  if (before.effectiveIndex === null)
    mediaError(
      'edit.cardinality_mismatch',
      'a costume reorder requires an effective current costume'
    )
  const [moved] = target.costumes.splice(slot.ordinal, 1)
  target.costumes.splice(operation.newIndex, 0, moved!)
  const reconciledIndex = shiftedOrdinalV1(
    before.costumeCount,
    { kind: 'move', from: slot.ordinal, to: operation.newIndex },
    before.effectiveIndex
  )!
  const final = reconciledCurrentCostumeStateV1(before, reconciledIndex)
  assertFinalCurrentCostumeV1(operation.expectedFinalCurrentCostumeState, final)
  commitCurrentCostumeV1(target, final)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex: slot.targetIndex,
    mediaKind: 'costume',
    mediaName: record.name,
    mediaOrdinal: operation.newIndex,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: null,
    admittedArchivePaths: Object.freeze([]),
    protectedArchivePaths: Object.freeze([]),
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: before.rawState,
    currentCostumeAfter: final,
    exactPaths: Object.freeze([
      mediaCollectionPathV1(slot.targetIndex, 'costume'),
      `/targets/${slot.targetIndex}/currentCostume`,
    ]),
  })
}

function applyReorderSound(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaReorderSoundV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, slot } = resolved
  const { target, record } = mediaAt(project, slot)
  const index = buildSemanticReferenceIndex(project)
  assertReorderBoundsV1(operation, slot, target.sounds.length)
  const orderEvidence = mediaOrderEvidenceV1(target, 'sound')
  if (orderEvidence.orderSha256 !== operation.expectedMediaOrderSha256)
    mediaError(
      'edit.planning_facts_mismatch',
      'expected sound order hash is stale'
    )
  assertOrderChangeAuthorizedV1(project, slot.targetIndex, 'sound', index)
  const [moved] = target.sounds.splice(slot.ordinal, 1)
  target.sounds.splice(operation.newIndex, 0, moved!)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex: slot.targetIndex,
    mediaKind: 'sound',
    mediaName: record.name,
    mediaOrdinal: operation.newIndex,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: null,
    admittedArchivePaths: Object.freeze([]),
    protectedArchivePaths: Object.freeze([]),
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: null,
    currentCostumeAfter: null,
    exactPaths: Object.freeze([
      mediaCollectionPathV1(slot.targetIndex, 'sound'),
    ]),
  })
}

// the outgoing payload entry is never removed: replace swaps the record's
// archive identity while the old bytes stay in the archive as protected data
function applyReplace(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    {
      operation:
        | SemanticEditOperationMediaReplaceCostumeV1
        | SemanticEditOperationMediaReplaceSoundV1
    }
  >
): AppliedMediaOperationV1
{
  const { operation, slot, identity, payload } = resolved
  const { record } = mediaAt(project, slot)
  assertPayloadDigestV1(operation.asset.expectedPayloadSha256, identity)
  if (identity.mediaKind !== slot.mediaKind)
    mediaError(
      'edit.unsupported_media',
      'admitted payload kind does not match the selected media record'
    )
  // the outgoing payload is proven by hashing the archive entry the record
  // actually claims, never by trusting the record's own md5 assetId
  const previousPath = mediaArchivePathV1(record)
  const previous = project.assets.find((asset) => asset.path === previousPath)
  if (!previous)
    mediaError(
      'edit.selector_no_match',
      `archive payload ${previousPath} is absent from the retained assets`
    )
  const previousSha256 = sha256Hex(previous.bytes)
  if (operation.expectedPayloadSha256 !== previousSha256)
    mediaError(
      'edit.asset_digest_mismatch',
      'expected outgoing payload digest does not match the retained archive bytes'
    )
  if (previousSha256 === identity.sha256)
    mediaError('edit.semantic_noop', 'media replace is a semantic no-op')
  const admitted = admitArchivePayloadV1(project, identity, payload)
  record.assetId = identity.md5
  record.dataFormat = identity.dataFormat
  record.md5ext = identity.md5ext
  if (slot.mediaKind === 'costume')
  {
    const costume = record as Costume
    const costumeIdentity = identity as DerivedCostumeAssetIdentity
    costume.bitmapResolution = costumeIdentity.bitmapResolution
    const placement = (operation as SemanticEditOperationMediaReplaceCostumeV1)
      .placement as CostumeReplacementPlacementV1
    if (placement.kind !== 'preserveExistingCenter')
    {
      const center = costumePlacementV1(placement, costumeIdentity)
      costume.rotationCenterX = center.rotationCenterX
      costume.rotationCenterY = center.rotationCenterY
    }
  }
  else
  {
    const sound = record as Sound
    const soundIdentity = identity as DerivedSoundAssetIdentity
    sound.format = soundIdentity.format
    sound.rate = soundIdentity.rate
    sound.sampleCount = soundIdentity.sampleCount
  }
  const reachability = mediaReachabilityEvidenceV1(project)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex: slot.targetIndex,
    mediaKind: slot.mediaKind,
    mediaName: record.name,
    mediaOrdinal: slot.ordinal,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: null,
    admittedArchivePaths: admitted,
    protectedArchivePaths: Object.freeze(
      reachability.protectedArchivePaths.filter((path) => path === previousPath)
    ),
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: null,
    currentCostumeAfter: null,
    exactPaths: Object.freeze([
      `${mediaCollectionPathV1(slot.targetIndex, slot.mediaKind)}/${slot.ordinal}`,
    ]),
  })
}

function applyRemoveCostume(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaRemoveCostumeV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, slot } = resolved
  const { target, record } = mediaAt(project, slot)
  const index = buildSemanticReferenceIndex(project)
  if (target.costumes.length !== operation.expectedCostumeCount)
    mediaError('edit.cardinality_mismatch', 'expected costume count is stale')
  if (target.costumes.length - 1 < operation.requireFinalCostumeCountAtLeast)
    mediaError(
      'edit.last_costume',
      'a target must keep at least one costume after removal'
    )
  const reachability = mediaReachabilityEvidenceV1(project)
  if (reachability.reachabilitySha256 !== operation.expectedReachabilitySha256)
    mediaError(
      'edit.planning_facts_mismatch',
      'expected media reachability hash is stale'
    )
  const referenceEvidence = mediaReferenceEvidenceV1(project, slot, index)
  if (
    referenceEvidence.referenceSetSha256 !==
    operation.expectedReferenceSetSha256
  )
    mediaError(
      'edit.planning_facts_mismatch',
      'expected media reference set hash is stale'
    )
  if (
    referenceEvidence.directReferenceCount !==
    operation.requireFinalReferenceCount
  )
    mediaError(
      'edit.entity_still_referenced',
      `costume ${record.name} still has ${referenceEvidence.directReferenceCount} references`
    )
  assertOrderChangeAuthorizedV1(project, slot.targetIndex, 'costume', index)
  const before = assertCostumeSelectionV1(
    target,
    slot.targetIndex,
    operation.currentSelection,
    resolved.currentSelection
  )
  if (before.effectiveIndex === null)
    mediaError(
      'edit.cardinality_mismatch',
      'a costume removal requires an effective current costume'
    )
  // the frozen contract can only ever assert `expectedCurrentCostume: false`,
  // so removing the selected costume is a refusal rather than a reconciliation
  if (before.effectiveIndex === slot.ordinal)
    mediaError(
      'edit.protected_change',
      'the currently selected costume cannot be removed'
    )
  target.costumes.splice(slot.ordinal, 1)
  const reconciledIndex = shiftedOrdinalV1(
    before.costumeCount,
    { kind: 'remove', at: slot.ordinal },
    before.effectiveIndex
  )!
  const final = reconciledCurrentCostumeStateV1(before, reconciledIndex)
  assertFinalCurrentCostumeV1(operation.expectedFinalCurrentCostumeState, final)
  commitCurrentCostumeV1(target, final)
  const after = mediaReachabilityEvidenceV1(project)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex: slot.targetIndex,
    mediaKind: 'costume',
    mediaName: record.name,
    mediaOrdinal: null,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: slot.ordinal,
    admittedArchivePaths: Object.freeze([]),
    protectedArchivePaths: after.protectedArchivePaths,
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: before.rawState,
    currentCostumeAfter: final,
    exactPaths: Object.freeze([
      mediaCollectionPathV1(slot.targetIndex, 'costume'),
      `/targets/${slot.targetIndex}/currentCostume`,
    ]),
  })
}

function applyRemoveSound(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaRemoveSoundV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, slot } = resolved
  const { target, record } = mediaAt(project, slot)
  const index = buildSemanticReferenceIndex(project)
  const reachability = mediaReachabilityEvidenceV1(project)
  if (reachability.reachabilitySha256 !== operation.expectedReachabilitySha256)
    mediaError(
      'edit.planning_facts_mismatch',
      'expected media reachability hash is stale'
    )
  const referenceEvidence = mediaReferenceEvidenceV1(project, slot, index)
  if (
    referenceEvidence.referenceSetSha256 !==
    operation.expectedReferenceSetSha256
  )
    mediaError(
      'edit.planning_facts_mismatch',
      'expected media reference set hash is stale'
    )
  if (
    referenceEvidence.directReferenceCount !==
    operation.requireFinalReferenceCount
  )
    mediaError(
      'edit.entity_still_referenced',
      `sound ${record.name} still has ${referenceEvidence.directReferenceCount} references`
    )
  assertOrderChangeAuthorizedV1(project, slot.targetIndex, 'sound', index)
  target.sounds.splice(slot.ordinal, 1)
  const after = mediaReachabilityEvidenceV1(project)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex: slot.targetIndex,
    mediaKind: 'sound',
    mediaName: record.name,
    mediaOrdinal: null,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: slot.ordinal,
    admittedArchivePaths: Object.freeze([]),
    protectedArchivePaths: after.protectedArchivePaths,
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: null,
    currentCostumeAfter: null,
    exactPaths: Object.freeze([
      mediaCollectionPathV1(slot.targetIndex, 'sound'),
    ]),
  })
}

function applySetCurrentCostume(
  project: ProjectIR,
  resolved: Extract<
    ResolvedMediaOperationV1,
    { operation: SemanticEditOperationMediaSetCurrentCostumeV1 }
  >
): AppliedMediaOperationV1
{
  const { operation, targetIndex, slot } = resolved
  const target = targetAt(project, targetIndex)
  const { record } = mediaAt(project, slot)
  if (slot.targetIndex !== targetIndex || slot.mediaKind !== 'costume')
    mediaError(
      'edit.invalid_owner',
      'the selected costume belongs to another target'
    )
  const before = assertCostumeSelectionV1(
    target,
    targetIndex,
    operation.currentSelection,
    resolved.currentSelection
  )
  if (before.effectiveIndex === null)
    mediaError(
      'edit.cardinality_mismatch',
      'a current-costume selection requires at least one costume'
    )
  if (operation.expectedFinalCurrentCostumeIndex !== slot.ordinal)
    mediaError(
      'edit.planning_facts_mismatch',
      'declared final current-costume index does not name the selected costume'
    )
  if (before.effectiveIndex === slot.ordinal)
    mediaError(
      'edit.semantic_noop',
      'the named costume is already the current selection'
    )
  const final = reconciledCurrentCostumeStateV1(before, slot.ordinal)
  commitCurrentCostumeV1(target, final)
  return Object.freeze({
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    mediaKind: 'costume',
    mediaName: record.name,
    mediaOrdinal: slot.ordinal,
    createdMediaOrdinal: null,
    detachedMediaOrdinal: null,
    admittedArchivePaths: Object.freeze([]),
    protectedArchivePaths: Object.freeze([]),
    propagatedReferencePaths: Object.freeze([]),
    currentCostumeBefore: before.rawState,
    currentCostumeAfter: final,
    exactPaths: Object.freeze([`/targets/${targetIndex}/currentCostume`]),
  })
}
