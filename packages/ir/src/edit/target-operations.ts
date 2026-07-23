// packages/ir/src/edit/target-operations.ts
// resolve, guard, apply, & prove exact target-family semantic edits

import {
  DEFAULT_SB3_LIMITS,
  defineScratchRecordValue,
  HARD_EDIT_ADMISSION_LIMITS,
  isBlockEntry,
  type ProjectJson,
  type SpriteTarget,
  type Target,
} from '@scratch-agent/sb3'
import {
  CanonicalJsonError,
  canonicalJsonBytesV1,
  canonicalJsonV1,
} from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type { ProjectIR } from '../project/project-ir.js'
import type { DeltaOperationAttribution } from '../project/project-delta.js'
import { jsonPointerPart as pointerPart } from '../project/project-vocabulary.js'
import type {
  ExistingOptionalNumberV1,
  ExpectedStringIdentityV1,
  SemanticEditOperationV1,
  SpritePropertyEditV1,
  StagePropertyEditV1,
  TargetRefV1,
} from './contracts.generated.js'
import type {
  OrderedCollectionCorrespondence,
  OrderedCollectionMemberCorrespondence,
} from './correspondence.js'
import { semanticHashV1 } from './hash-domains.js'
import {
  SEMANTIC_LINEAGE_VERSION_V1,
  activeOrderedSemanticLineages,
  validateSemanticLineageSnapshot,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from './lineage.js'
import { unknownNameSemanticsEvidenceV1 } from './name-semantics-catalog.js'
import { buildSemanticReferenceIndex } from './reference-index.js'
import {
  targetKey,
  type SemanticInboundReference,
  type SemanticReferenceIndex,
  type SpriteReference,
} from './reference-index-types.js'
import { TARGET_NAME_REFERENCE_DESCRIPTORS_V1 } from './target-reference-catalog.js'

export type TargetOperationV1 = Extract<
  SemanticEditOperationV1,
  {
    kind:
      | 'target.renameSprite'
      | 'target.reorderSprite'
      | 'target.removeSprite'
      | 'target.setSpriteProperties'
      | 'target.setStageProperties'
  }
>

export interface TargetEntityEvidenceV1
{
  readonly targetIndex: number
  readonly targetKind: 'stage' | 'sprite'
  readonly name: string
  readonly visualLayerOrdinal?: number
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
}

type HandleTargetRefV1 = Extract<TargetRefV1, { refKind: 'handle' }>
type CreatedTargetRefV1 = Extract<TargetRefV1, { refKind: 'created' }>

export interface TargetRefResolverAdaptersV1
{
  readonly activeMatchCandidateLimit?: number
  readonly resolveHandle?: (
    reference: HandleTargetRefV1,
    evidence: readonly TargetEntityEvidenceV1[]
  ) => number | null
  readonly resolveCreated?: (
    reference: CreatedTargetRefV1,
    evidence: readonly TargetEntityEvidenceV1[]
  ) => number | null
}

interface ResolvedTargetOperationV1
{
  readonly operation: TargetOperationV1
  readonly targetIndex: number
  readonly activeLineage: SemanticLineageSnapshot
}

interface TargetReferenceSetEvidenceV1
{
  readonly references: readonly SemanticInboundReference[]
  readonly referenceSetSha256: string
}

interface TargetProspectiveNameActivationEvidenceV1
{
  readonly activations: readonly TargetProspectiveNameActivationV1[]
  readonly activationSetSha256: string
}

interface TargetProspectiveNameActivationV1
{
  readonly kind: 'unresolved-static' | 'dynamic'
  readonly path: string
  readonly sourceTargetIndex?: number
  readonly blockId?: string
  readonly monitorIndex?: number
  readonly referenceKind: string
  readonly reason?: string
}

export interface TargetDualOrderSnapshotV1
{
  readonly serializedTargetLineageIds: readonly string[]
  readonly visualSpriteLineageIds: readonly string[]
  readonly runtimeExecutableTargetLineageIds: readonly string[]
  readonly serializedTargetOrderSha256: string
  readonly visualLayerOrderSha256: string
  readonly runtimeExecutableTargetOrderSha256: string
}

interface TargetOperationPostconditionEvidenceV1
{
  readonly targetCount: number
  readonly spriteCount: number
  readonly selectedTargetSemanticFingerprintSha256: string | null
  readonly inboundReferenceSetSha256: string | null
  readonly ownedSurfaceSha256: string | null
  readonly propagatedReferenceCount: number
  readonly postconditionSha256: string
}

export interface TargetOperationResultV1
{
  readonly opId: string
  readonly operationKind: TargetOperationV1['kind']
  readonly targetLineageId: string
  readonly beforeTargetIndex: number
  readonly afterTargetIndex: number | null
  readonly attribution: DeltaOperationAttribution
  readonly beforeOrder: TargetDualOrderSnapshotV1
  readonly afterOrder: TargetDualOrderSnapshotV1
  readonly targetCorrespondence: OrderedCollectionCorrespondence
  readonly activeLineage: SemanticLineageSnapshot
  readonly postcondition: TargetOperationPostconditionEvidenceV1
}

interface TargetCapabilityAssessmentItemV1
{
  readonly operationKind: 'target.addSprite' | TargetOperationV1['kind']
  readonly availability: 'supported' | 'unsupported'
  readonly limitationCodes: readonly string[]
  readonly targetIndexes: readonly number[]
}

interface TargetCapabilityAssessmentV1
{
  readonly items: readonly TargetCapabilityAssessmentItemV1[]
  readonly assessmentSha256: string
}

export class TargetOperationError extends Error
{
  constructor(
    readonly code: string,
    message: string,
    readonly matchCount: number | null = null,
    readonly context?: Readonly<Record<string, unknown>>
  )
  {
    super(message)
    this.name = 'TargetOperationError'
  }
}

const RESERVED_TARGET_NAMES = new Set([
  '_edge_',
  '_mouse_',
  '_myself_',
  '_random_',
  '_stage_',
])

function editError(
  code: string,
  message: string,
  matchCount: number | null = code === 'edit.selector_no_match' ? 0 : null
): never
{
  throw new TargetOperationError(code, message, matchCount)
}

export const EDIT_EVIDENCE_CANONICAL_LIMITS_V1 = Object.freeze({
  maxDepth: HARD_EDIT_ADMISSION_LIMITS.maxJsonDepth + 32,
  maxNodes:
    HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes +
    HARD_EDIT_ADMISSION_LIMITS.maxIndexedSemanticRecords * 4,
  maxMembers: HARD_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
  maxStringCodeUnits: DEFAULT_SB3_LIMITS.maxProjectJsonBytes,
})

const CANONICAL_RESOURCE_LIMIT_CODES = new Set([
  'depth',
  'members',
  'nodes',
  'string-length',
])

export function editEvidenceCanonicalBytesV1(value: unknown): Uint8Array
{
  try
  {
    return new TextEncoder().encode(
      canonicalJsonV1(value, EDIT_EVIDENCE_CANONICAL_LIMITS_V1)
    )
  }
  catch (error)
  {
    if (
      error instanceof CanonicalJsonError &&
      CANONICAL_RESOURCE_LIMIT_CODES.has(error.code)
    )
      return editError(
        'edit.impact_budget_exceeded',
        `semantic evidence exceeds the canonical ${error.code} limit`
      )
    throw error
  }
}

export function editEvidenceCanonicalSha256V1(value: unknown): string
{
  return sha256Hex(editEvidenceCanonicalBytesV1(value))
}

const canonicalSha256 = editEvidenceCanonicalSha256V1

function targetKind(target: Target): 'stage' | 'sprite'
{
  return target.isStage ? 'stage' : 'sprite'
}

export function targetExpectedStringIdentityV1(
  value: string
): ExpectedStringIdentityV1
{
  const bytes = canonicalJsonBytesV1(value)
  return {
    canonicalJsonStringByteLength: bytes.byteLength,
    valueSha256: sha256Hex(bytes),
  }
}

function exactStringIdentityMatches(
  value: string,
  expected: ExpectedStringIdentityV1
): boolean
{
  const actual = targetExpectedStringIdentityV1(value)
  return (
    actual.canonicalJsonStringByteLength ===
      expected.canonicalJsonStringByteLength &&
    actual.valueSha256 === expected.valueSha256
  )
}

export function targetSemanticFingerprintV1(target: Target): string
{
  const knownPropertyNames = target.isStage
    ? [
        'currentCostume',
        'volume',
        'layerOrder',
        'tempo',
        'videoTransparency',
        'videoState',
        'textToSpeechLanguage',
      ]
    : [
        'currentCostume',
        'volume',
        'layerOrder',
        'visible',
        'x',
        'y',
        'size',
        'direction',
        'draggable',
        'rotationStyle',
      ]
  const knownPropertyState = Object.fromEntries(
    knownPropertyNames.map((property) => [
      property,
      optionalObjectState(target, property),
    ])
  )
  const declarationChildFingerprintSha256s = [
    ...Object.keys(target.variables)
      .sort()
      .map((id) =>
        semanticHashV1('semantic-fingerprint', {
          entityKind: 'target-declaration-child',
          declarationKind: 'variable',
          value: target.variables[id],
        })
      ),
    ...Object.keys(target.lists ?? {})
      .sort()
      .map((id) =>
        semanticHashV1('semantic-fingerprint', {
          entityKind: 'target-declaration-child',
          declarationKind: 'list',
          value: target.lists![id],
        })
      ),
    ...Object.keys(target.broadcasts ?? {})
      .sort()
      .map((id) =>
        semanticHashV1('semantic-fingerprint', {
          entityKind: 'target-declaration-child',
          declarationKind: 'broadcast',
          name: target.broadcasts![id],
        })
      ),
  ]
  const scriptRootBlockIds = Object.keys(target.blocks)
    .sort()
    .filter((blockId) =>
    {
      const entry = target.blocks[blockId]
      return Array.isArray(entry)
        ? entry.length >= 5
        : isBlockEntry(entry) && entry.topLevel === true
    })
  let scriptChildFingerprintSha256s: string[] = []
  if (scriptRootBlockIds.length > 0)
  {
    const completeBlockMapSha256 = canonicalSha256(target.blocks)
    scriptChildFingerprintSha256s = scriptRootBlockIds.map((blockId) =>
      semanticHashV1('semantic-fingerprint', {
        entityKind: 'target-script-child',
        rootPayloadSha256: canonicalSha256(target.blocks[blockId]),
        completeBlockMapSha256,
      })
    )
  }
  const commentChildFingerprintSha256s = Object.keys(target.comments ?? {})
    .sort()
    .map((commentId) =>
    {
      const comment = target.comments?.[commentId]
      if (!comment)
        return editError(
          'edit.reference_propagation_incomplete',
          'comment record disappeared during target fingerprinting'
        )
      const attachedBlock =
        typeof comment.blockId === 'string'
          ? target.blocks[comment.blockId]
          : undefined
      if (typeof comment.blockId === 'string' && !isBlockEntry(attachedBlock))
        return editError(
          'edit.reference_propagation_incomplete',
          'comment attachment points to an absent block'
        )
      return semanticHashV1('semantic-fingerprint', {
        entityKind: 'target-comment-child',
        attachmentState:
          comment.blockId == null
            ? { state: 'detached' }
            : {
                state: 'attached',
                blockPayloadSha256: canonicalSha256(attachedBlock),
              },
        text: comment.text,
        minimized: optionalObjectState(comment, 'minimized'),
        x: optionalObjectState(comment, 'x'),
        y: optionalObjectState(comment, 'y'),
        width: optionalObjectState(comment, 'width'),
        height: optionalObjectState(comment, 'height'),
      })
    })
  const mediaChildFingerprintSha256s = [
    ...target.costumes.map((costume, order) =>
      semanticHashV1('semantic-fingerprint', {
        entityKind: 'target-media-child',
        mediaKind: 'costume',
        order,
        value: costume,
      })
    ),
    ...target.sounds.map((sound, order) =>
      semanticHashV1('semantic-fingerprint', {
        entityKind: 'target-media-child',
        mediaKind: 'sound',
        order,
        value: sound,
      })
    ),
  ]
  const knownKeys = new Set([
    'isStage',
    'name',
    'variables',
    'lists',
    'broadcasts',
    'blocks',
    'comments',
    'costumes',
    'sounds',
    ...knownPropertyNames,
  ])
  const protectedUnknownFields = Object.fromEntries(
    Object.keys(target)
      .filter((key) => !knownKeys.has(key))
      .sort()
      .map((key) => [key, target[key as keyof Target]])
  )
  return semanticHashV1('semantic-fingerprint', {
    entityKind: 'target',
    targetKind: targetKind(target),
    nameSha256: canonicalSha256(target.name),
    knownPropertyStateSha256: canonicalSha256(knownPropertyState),
    declarationChildFingerprintSha256s,
    scriptChildFingerprintSha256s,
    commentChildFingerprintSha256s,
    mediaChildFingerprintSha256s,
    protectedUnknownFieldSha256: canonicalSha256(protectedUnknownFields),
  })
}

function optionalObjectState(value: object, property: string): unknown
{
  const descriptor = Object.getOwnPropertyDescriptor(value, property)
  if (descriptor?.enumerable !== true || !('value' in descriptor))
    return { state: 'missing' }
  if (descriptor.value === null) return { state: 'null' }
  return { state: 'value', value: descriptor.value }
}

function targetSemanticLocationSha256FromFingerprintV1(
  target: Target,
  targetIndex: number,
  semanticFingerprint: string
): string
{
  const location = {
    kind: 'target',
    targetKind: targetKind(target),
    serializedTargetOrdinal: targetIndex,
    name: target.name,
    semanticFingerprint,
  }
  return semanticHashV1(
    'semantic-location',
    !target.isStage && target.layerOrder !== undefined
      ? { ...location, visualLayerOrdinal: target.layerOrder }
      : location
  )
}

function targetSemanticLocationSha256V1(
  target: Target,
  targetIndex: number
): string
{
  return targetSemanticLocationSha256FromFingerprintV1(
    target,
    targetIndex,
    targetSemanticFingerprintV1(target)
  )
}

function targetContextFingerprintV1(
  json: ProjectJson,
  targetIndex: number
): string
{
  return semanticHashV1('semantic-fingerprint', {
    entityKind: 'target-context',
    serializedTargetOrdinal: targetIndex,
    predecessor: json.targets[targetIndex - 1]
      ? {
          state: 'present',
          nameSha256: canonicalSha256(json.targets[targetIndex - 1]!.name),
        }
      : { state: 'missing' },
    successor: json.targets[targetIndex + 1]
      ? {
          state: 'present',
          nameSha256: canonicalSha256(json.targets[targetIndex + 1]!.name),
        }
      : { state: 'missing' },
  })
}

function targetEntityEvidenceV1(
  json: ProjectJson,
  targetIndex: number
): TargetEntityEvidenceV1
{
  const target = json.targets[targetIndex]
  if (!target) return editError('edit.selector_no_match', 'target is absent')
  const semanticFingerprint = targetSemanticFingerprintV1(target)
  const evidence: TargetEntityEvidenceV1 = {
    targetIndex,
    targetKind: targetKind(target),
    name: target.name,
    semanticLocationSha256: targetSemanticLocationSha256FromFingerprintV1(
      target,
      targetIndex,
      semanticFingerprint
    ),
    semanticFingerprintSha256: semanticFingerprint,
    contextFingerprintSha256: targetContextFingerprintV1(json, targetIndex),
  }
  if (!target.isStage && target.layerOrder !== undefined)
    return { ...evidence, visualLayerOrdinal: target.layerOrder }
  return evidence
}

export function targetEntityEvidenceSetV1(
  json: ProjectJson
): readonly TargetEntityEvidenceV1[]
{
  return Object.freeze(
    json.targets.map((_target, targetIndex) =>
      targetEntityEvidenceV1(json, targetIndex)
    )
  )
}

function displayIdentityMatches(
  value: string,
  display: Extract<
    TargetRefV1,
    { refKind: 'structural'; selectorKind: 'exactLocation' }
  >['location']['name']
): boolean
{
  if (!exactStringIdentityMatches(value, display)) return false
  return display.displayKind !== 'inline' || display.value === value
}

function assertSelectedEvidence(
  evidence: TargetEntityEvidenceV1,
  expected: {
    readonly expectedSelectedFullLocationSha256: string
    readonly expectedSelectedSemanticFingerprint: string
    readonly expectedSelectedContextFingerprint: string
  }
): void
{
  if (
    evidence.semanticLocationSha256 !==
      expected.expectedSelectedFullLocationSha256 ||
    evidence.semanticFingerprintSha256 !==
      expected.expectedSelectedSemanticFingerprint ||
    evidence.contextFingerprintSha256 !==
      expected.expectedSelectedContextFingerprint
  )
    editError('edit.fingerprint_mismatch', 'selected target evidence changed')
}

function targetHasProperty(target: Target, property: string): boolean
{
  const descriptor = Object.getOwnPropertyDescriptor(target, property)
  return descriptor?.enumerable === true && 'value' in descriptor
}

function targetMatchesCriteria(
  target: Target,
  evidence: TargetEntityEvidenceV1,
  criteria: Extract<
    TargetRefV1,
    { refKind: 'structural'; selectorKind: 'matchSet' }
  >['criteria']
): boolean
{
  return criteria.conjunction.every((criterion) =>
  {
    if (criterion.criterionKind === 'nameIdentity')
      return exactStringIdentityMatches(target.name, criterion.name)
    if (criterion.criterionKind === 'contentFingerprint')
      return evidence.semanticFingerprintSha256 === criterion.contentFingerprint
    return targetHasProperty(target, criterion.property)
  })
}

function targetOrderedMatchSetSha256V1(
  matches: readonly TargetEntityEvidenceV1[]
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'target-ordered-match-set',
    schemaVersion: 1,
    matches: matches.map((match) => ({
      fullLocationSha256: match.semanticLocationSha256,
      semanticFingerprintSha256: match.semanticFingerprintSha256,
      contextFingerprintSha256: match.contextFingerprintSha256,
    })),
  })
}

function callbackTargetIndex(
  value: number | null | undefined,
  evidence: readonly TargetEntityEvidenceV1[],
  code: 'edit.stale_handle' | 'edit.created_result_invalid'
): number
{
  if (
    value === null ||
    value === undefined ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= evidence.length
  )
    return editError(code, 'target callback did not resolve one live target')
  return value
}

export function resolveTargetRefV1(
  project: ProjectIR,
  reference: TargetRefV1,
  adapters: TargetRefResolverAdaptersV1 = {}
): TargetEntityEvidenceV1
{
  const evidence = targetEntityEvidenceSetV1(project.json)
  if (reference.refKind === 'handle')
  {
    const targetIndex = callbackTargetIndex(
      adapters.resolveHandle?.(reference, evidence),
      evidence,
      'edit.stale_handle'
    )
    const selected = evidence[targetIndex]!
    if (
      selected.semanticFingerprintSha256 !==
      reference.expectedSemanticFingerprint
    )
      return editError('edit.stale_handle', 'target handle is stale')
    return selected
  }
  if (reference.refKind === 'created')
  {
    const targetIndex = callbackTargetIndex(
      adapters.resolveCreated?.(reference, evidence),
      evidence,
      'edit.created_result_invalid'
    )
    return evidence[targetIndex]!
  }
  if (reference.selectorKind === 'exactLocation')
  {
    const targetIndex = reference.location.serializedTargetOrdinal
    const selected = evidence[targetIndex]
    if (!selected)
      return editError('edit.selector_no_match', 'target location is absent')
    const location = reference.location
    const target = project.json.targets[targetIndex]!
    if (
      selected.targetKind !== location.targetKind ||
      !displayIdentityMatches(target.name, location.name) ||
      selected.visualLayerOrdinal !== location.visualLayerOrdinal ||
      selected.semanticLocationSha256 !== location.fullLocationSha256 ||
      selected.semanticFingerprintSha256 !== location.semanticFingerprint ||
      selected.semanticLocationSha256 !==
        reference.expectedFullLocationSha256 ||
      selected.semanticFingerprintSha256 !==
        reference.expectedSemanticFingerprint ||
      selected.contextFingerprintSha256 !== reference.expectedContextFingerprint
    )
      return editError(
        'edit.fingerprint_mismatch',
        'exact target location changed'
      )
    return selected
  }
  if (reference.scope.scopeKind !== 'project')
    return editError(
      'edit.invalid_owner',
      'target match-set selectors require project scope'
    )
  const matches = evidence.filter((candidate) =>
    targetMatchesCriteria(
      project.json.targets[candidate.targetIndex]!,
      candidate,
      reference.criteria
    )
  )
  if (
    adapters.activeMatchCandidateLimit !== undefined &&
    matches.length > adapters.activeMatchCandidateLimit
  )
    throw new TargetOperationError(
      'edit.impact_budget_exceeded',
      `target match set exceeds ${adapters.activeMatchCandidateLimit} active candidates`,
      matches.length,
      {
        limit: adapters.activeMatchCandidateLimit,
        observed: matches.length,
      }
    )
  if (matches.length === 0)
    return editError('edit.selector_no_match', 'target selector matched none')
  if (
    matches.length !== reference.expectedMatchCount ||
    targetOrderedMatchSetSha256V1(matches) !==
      reference.expectedOrderedMatchSetSha256
  )
    return editError('edit.fingerprint_mismatch', 'target match set changed')
  let selected: TargetEntityEvidenceV1 | undefined
  if (reference.selection.kind === 'exactlyOne')
  {
    if (matches.length !== 1)
      return editError(
        'edit.selector_ambiguous',
        'target selector matched more than one target',
        matches.length
      )
    selected = matches[0]
  }
  else selected = matches[reference.selection.zeroBasedIndex]
  if (!selected)
    return editError(
      'edit.selector_no_match',
      'selected target occurrence is absent',
      matches.length
    )
  assertSelectedEvidence(selected, reference)
  return selected
}

function targetRefAt(json: ProjectJson, targetIndex: number)
{
  const target = json.targets[targetIndex]
  if (!target) return editError('edit.selector_no_match', 'target is absent')
  return { targetIndex, name: target.name, isStage: target.isStage }
}

export function targetInboundReferenceSetV1(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  targetIndex: number
): TargetReferenceSetEvidenceV1
{
  const target = project.json.targets[targetIndex]
  if (!target) return editError('edit.selector_no_match', 'target is absent')
  const references = Object.freeze([
    ...(index.inboundReferencesByEntityKey.get(
      targetKey(targetRefAt(project.json, targetIndex))
    ) ?? []),
  ])
  return {
    references,
    referenceSetSha256: semanticHashV1('evidence-content', {
      kind: 'target-inbound-reference-set',
      schemaVersion: 1,
      target: targetSemanticLocationSha256V1(target, targetIndex),
      references,
    }),
  }
}

export function targetProspectiveNameActivationV1(
  _project: ProjectIR,
  index: SemanticReferenceIndex,
  name: string
): TargetProspectiveNameActivationEvidenceV1
{
  const activations: TargetProspectiveNameActivationV1[] = []
  for (const reference of index.spriteReferences)
  {
    if (reference.name !== name || reference.targetStatus !== 'unresolved')
      continue
    activations.push({
      kind: 'unresolved-static',
      path: `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}/fields/${pointerPart(reference.fieldName)}/0`,
      sourceTargetIndex: reference.block.target.targetIndex,
      blockId: reference.block.blockId,
      referenceKind: reference.kind,
    })
  }
  for (const reference of index.dynamicSpriteReferences)
  {
    activations.push({
      kind: 'dynamic',
      path: `/targets/${reference.block.target.targetIndex}/blocks/${pointerPart(reference.block.blockId)}/inputs/${pointerPart(reference.inputName)}`,
      sourceTargetIndex: reference.block.target.targetIndex,
      blockId: reference.block.blockId,
      referenceKind: reference.kind,
      reason: reference.reason,
    })
  }
  for (const monitor of index.monitors)
  {
    if (monitor.spriteName !== name || monitor.targetStatus !== 'none') continue
    activations.push({
      kind: 'unresolved-static',
      path: `/monitors/${monitor.ref.monitorIndex}/spriteName`,
      monitorIndex: monitor.ref.monitorIndex,
      referenceKind: 'monitor-owner',
    })
  }
  activations.sort((left, right) =>
    left.path === right.path
      ? left.kind < right.kind
        ? -1
        : left.kind > right.kind
          ? 1
          : 0
      : left.path < right.path
        ? -1
        : 1
  )
  const frozen = Object.freeze(activations)
  return {
    activations: frozen,
    activationSetSha256: semanticHashV1('evidence-content', {
      kind: 'target-prospective-name-activation-set',
      schemaVersion: 1,
      nameIdentity: targetExpectedStringIdentityV1(name),
      activations: frozen,
    }),
  }
}

export function targetOwnedSurfaceSha256V1(target: Target): string
{
  return semanticHashV1('evidence-content', {
    kind: 'target-owned-surface',
    schemaVersion: 1,
    target,
  })
}

function activeTargetLineages(
  lineage: SemanticLineageSnapshot,
  targetCount: number
): readonly SemanticLineageRecord[]
{
  const records = activeOrderedSemanticLineages(lineage, 'target', null)
  if (records.length !== targetCount)
    return editError(
      'edit.internal_invariant',
      'active target lineage count does not match project targets'
    )
  return records
}

function visualSpriteIndexes(json: ProjectJson): readonly number[]
{
  if (json.targets.length === 0 || json.targets[0]?.isStage !== true)
    return editError(
      'edit.project_constraint',
      'stage must occupy serialized target ordinal zero'
    )
  if (json.targets.some((target, index) => index > 0 && target.isStage))
    return editError(
      'edit.project_constraint',
      'project must contain exactly one serialized stage'
    )
  const sprites = json.targets
    .map((target, targetIndex) => ({ target, targetIndex }))
    .filter((entry) => !entry.target.isStage)
  const layers = sprites.map((entry) => entry.target.layerOrder)
  if (
    layers.some(
      (layer) =>
        !Number.isSafeInteger(layer) ||
        layer === undefined ||
        layer < 1 ||
        layer > sprites.length
    ) ||
    new Set(layers).size !== sprites.length
  )
    return editError(
      'edit.project_constraint',
      'sprite layerOrder values must be the exact contiguous permutation 1..N'
    )
  return Object.freeze(
    sprites
      .sort((left, right) => left.target.layerOrder! - right.target.layerOrder!)
      .map((entry) => entry.targetIndex)
  )
}

export function targetDualOrderSnapshotV1(
  json: ProjectJson,
  lineage: SemanticLineageSnapshot
): TargetDualOrderSnapshotV1
{
  const targetLineages = activeTargetLineages(lineage, json.targets.length)
  const serializedTargetLineageIds = Object.freeze(
    targetLineages.map((record) => record.lineageId)
  )
  const visualSpriteLineageIds = Object.freeze(
    visualSpriteIndexes(json).map(
      (targetIndex) => targetLineages[targetIndex]!.lineageId
    )
  )
  const runtimeExecutableTargetLineageIds = Object.freeze([
    serializedTargetLineageIds[0]!,
    ...visualSpriteLineageIds,
  ])
  return {
    serializedTargetLineageIds,
    visualSpriteLineageIds,
    runtimeExecutableTargetLineageIds,
    serializedTargetOrderSha256: semanticHashV1('evidence-content', {
      kind: 'serialized-target-order',
      schemaVersion: 1,
      lineageIds: serializedTargetLineageIds,
    }),
    visualLayerOrderSha256: semanticHashV1('evidence-content', {
      kind: 'visual-sprite-layer-order',
      schemaVersion: 1,
      lineageIds: visualSpriteLineageIds,
    }),
    runtimeExecutableTargetOrderSha256: semanticHashV1('evidence-content', {
      kind: 'runtime-executable-target-order',
      schemaVersion: 1,
      lineageIds: runtimeExecutableTargetLineageIds,
    }),
  }
}

function descendantsOfTarget(
  lineage: SemanticLineageSnapshot,
  targetLineageId: string
): ReadonlySet<string>
{
  const descendants = new Set([targetLineageId])
  let changed = true
  while (changed)
  {
    changed = false
    for (const record of lineage.records)
    {
      if (
        record.ownerLineageId !== null &&
        descendants.has(record.ownerLineageId) &&
        !descendants.has(record.lineageId)
      )
      {
        descendants.add(record.lineageId)
        changed = true
      }
    }
  }
  return descendants
}

function lineageAfterRemoval(
  lineage: SemanticLineageSnapshot,
  targetLineageId: string
): SemanticLineageSnapshot
{
  const validated = validateSemanticLineageSnapshot(lineage)
  const removed = descendantsOfTarget(validated, targetLineageId)
  const remainingTargets = activeOrderedSemanticLineages(
    validated,
    'target',
    null
  ).filter((record) => record.lineageId !== targetLineageId)
  const targetOrdinals = new Map(
    remainingTargets.map((record, ordinal) => [record.lineageId, ordinal])
  )
  return validateSemanticLineageSnapshot({
    version: SEMANTIC_LINEAGE_VERSION_V1,
    records: validated.records.map((record) =>
    {
      if (removed.has(record.lineageId))
        return { ...record, status: 'tombstoned' as const }
      if (record.kind === 'target' && record.status === 'active')
        return {
          ...record,
          canonicalOrdinal: targetOrdinals.get(record.lineageId) ?? null,
        }
      return record
    }),
  })
}

function targetCorrespondenceV1(
  before: TargetDualOrderSnapshotV1,
  after: TargetDualOrderSnapshotV1
): OrderedCollectionCorrespondence
{
  const beforeIndexes = new Map(
    before.serializedTargetLineageIds.map((lineageId, index) => [
      lineageId,
      index,
    ])
  )
  const afterIndexes = new Map(
    after.serializedTargetLineageIds.map((lineageId, index) => [
      lineageId,
      index,
    ])
  )
  const lineageIds = [
    ...before.serializedTargetLineageIds,
    ...after.serializedTargetLineageIds.filter(
      (lineageId) => !beforeIndexes.has(lineageId)
    ),
  ]
  const members: OrderedCollectionMemberCorrespondence[] = lineageIds.map(
    (lineageId) => ({
      lineageId,
      beforeIndex: beforeIndexes.get(lineageId) ?? null,
      afterIndex: afterIndexes.get(lineageId) ?? null,
    })
  )
  return {
    collectionKind: 'targets',
    collectionPath: '/targets',
    beforeCollectionPath: '/targets',
    afterCollectionPath: '/targets',
    ownerLineageId: null,
    targetOwnerLineageId: null,
    containerLineageId: null,
    beforeLineageIds: before.serializedTargetLineageIds,
    afterLineageIds: after.serializedTargetLineageIds,
    members: Object.freeze(members),
  }
}

function assertExpectedOrder(
  actual: string,
  expected: string,
  label: string
): void
{
  if (actual !== expected)
    editError('edit.planning_facts_mismatch', `${label} changed`)
}

function assertUniqueSpriteNames(json: ProjectJson): void
{
  const names = json.targets
    .filter((target) => !target.isStage)
    .map((target) => target.name)
  if (new Set(names).size !== names.length)
    editError(
      'edit.project_constraint',
      'sprite names must be exact-unique for target-name mutation'
    )
}

function assertKnownTargetReferenceSemantics(json: ProjectJson): void
{
  const evidence = unknownNameSemanticsEvidenceV1(json)
  if (evidence.declaredExtensions.length > 0)
    editError(
      'edit.unsupported_extension',
      'target-name mutation is unavailable with extension semantics'
    )
  if (evidence.unknownOpcodes.length > 0 || evidence.surfaceIssues.length > 0)
    editError(
      'edit.unsupported_opcode',
      'target-name mutation is unavailable with unknown raw name semantics'
    )
}

function assertNoDynamicTargetReferences(index: SemanticReferenceIndex): void
{
  if (index.dynamicSpriteReferences.length > 0)
    editError(
      'edit.dynamic_reference',
      'target-name mutation is unavailable with dynamic target references'
    )
}

function assertReferenceCanPropagate(
  reference: SpriteReference,
  targetIndex: number,
  matchCount: number
): void
{
  if (
    reference.sourceStatus !== 'verified-parent' ||
    reference.targetStatus !== 'unique' ||
    reference.targets[0]?.targetIndex !== targetIndex
  )
    editError(
      'edit.reference_propagation_incomplete',
      'target-name menu ownership or resolution is not exact',
      matchCount
    )
}

function renameSpriteReferences(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  targetIndex: number,
  oldName: string,
  newName: string
): number
{
  let propagated = 0
  const matchingReferences = index.spriteReferences.filter(
    (reference) => reference.name === oldName
  )
  for (const reference of matchingReferences)
  {
    assertReferenceCanPropagate(
      reference,
      targetIndex,
      matchingReferences.length
    )
    const owner = project.json.targets[reference.block.target.targetIndex]
    const entry = owner?.blocks[reference.block.blockId]
    if (!isBlockEntry(entry))
      return editError(
        'edit.reference_propagation_incomplete',
        'target-name menu block disappeared',
        matchingReferences.length
      )
    const field = entry.fields?.[reference.fieldName]
    if (!field || field[0] !== oldName)
      return editError(
        'edit.reference_propagation_incomplete',
        'target-name menu field changed',
        matchingReferences.length
      )
    field[0] = newName
    propagated += 1
  }
  for (const monitor of index.monitors)
  {
    if (monitor.spriteName !== oldName) continue
    if (
      monitor.targetStatus === 'unique' &&
      monitor.target?.targetIndex !== targetIndex
    )
      continue
    if (
      monitor.targetStatus !== 'unique' ||
      monitor.target?.targetIndex !== targetIndex
    )
      return editError(
        'edit.reference_propagation_incomplete',
        'monitor target ownership is not exact',
        index.monitors.filter((candidate) => candidate.spriteName === oldName)
          .length
      )
    const value = project.json.monitors?.[monitor.ref.monitorIndex]
    if (!value || value.spriteName !== oldName)
      return editError(
        'edit.reference_propagation_incomplete',
        'monitor target name changed',
        index.monitors.filter((candidate) => candidate.spriteName === oldName)
          .length
      )
    value.spriteName = newName
    propagated += 1
  }
  return propagated
}

function matchingInboundPaths(
  evidence: TargetReferenceSetEvidenceV1
): readonly string[]
{
  return Object.freeze(evidence.references.map((reference) => reference.path))
}

function assertRenamePostcondition(
  project: ProjectIR,
  targetIndex: number,
  oldInboundPaths: readonly string[],
  expectedPropagatedCount: number
): TargetReferenceSetEvidenceV1
{
  const index = buildSemanticReferenceIndex(project)
  const target = project.json.targets[targetIndex]!
  const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
  const paths = matchingInboundPaths(inbound)
  if (
    target.isStage ||
    paths.length !== oldInboundPaths.length ||
    paths.some((path, pathIndex) => path !== oldInboundPaths[pathIndex]) ||
    inbound.references.length !== expectedPropagatedCount ||
    index.spriteReferences.some(
      (reference) =>
        reference.name === target.name &&
        (reference.targetStatus !== 'unique' ||
          reference.targets[0]?.targetIndex !== targetIndex)
    ) ||
    index.monitors.some(
      (monitor) =>
        monitor.spriteName === target.name &&
        (monitor.targetStatus !== 'unique' ||
          monitor.target?.targetIndex !== targetIndex)
    )
  )
    editError(
      'edit.postcondition_failed',
      'target-name reference propagation postcondition failed'
    )
  return inbound
}

function applyRename(
  project: ProjectIR,
  operation: Extract<TargetOperationV1, { kind: 'target.renameSprite' }>,
  targetIndex: number
): {
  propagatedReferenceCount: number
  inbound: TargetReferenceSetEvidenceV1
  attribution: DeltaOperationAttribution
}
{
  const target = project.json.targets[targetIndex]
  if (!target || target.isStage)
    return editError('edit.invalid_owner', 'rename requires a sprite target')
  assertKnownTargetReferenceSemantics(project.json)
  assertUniqueSpriteNames(project.json)
  if (RESERVED_TARGET_NAMES.has(operation.newName))
    return editError(
      'edit.project_constraint',
      'sprite name collides with a reserved runtime target name'
    )
  if (
    project.json.targets.some(
      (candidate, index) =>
        index !== targetIndex && candidate.name === operation.newName
    )
  )
    return editError(
      'edit.project_constraint',
      'sprite name must be exact-unique'
    )
  if (target.name === operation.newName)
    return editError('edit.semantic_noop', 'sprite name is unchanged')
  if (!exactStringIdentityMatches(target.name, operation.expectedName))
    return editError(
      'edit.planning_facts_mismatch',
      'expected sprite name changed'
    )
  const index = buildSemanticReferenceIndex(project)
  assertNoDynamicTargetReferences(index)
  const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
  assertExpectedOrder(
    inbound.referenceSetSha256,
    operation.expectedInboundReferenceSetSha256,
    'target inbound reference set'
  )
  const activation = targetProspectiveNameActivationV1(
    project,
    index,
    operation.newName
  )
  assertExpectedOrder(
    activation.activationSetSha256,
    operation.newNameActivation.expectedActivationSetSha256,
    'prospective target-name activation set'
  )
  if (activation.activations.length !== 0)
    return editError(
      'edit.dynamic_reference',
      'new sprite name would activate an unresolved or dynamic reference'
    )
  const oldName = target.name
  const propagatedReferenceCount = renameSpriteReferences(
    project,
    index,
    targetIndex,
    oldName,
    operation.newName
  )
  target.name = operation.newName
  const afterInbound = assertRenamePostcondition(
    project,
    targetIndex,
    matchingInboundPaths(inbound),
    propagatedReferenceCount
  )
  return {
    propagatedReferenceCount,
    inbound: afterInbound,
    attribution: {
      operationId: operation.opId,
      targetIndexes: [targetIndex],
      targetProperties: [{ targetIndex, property: 'name' }],
      projectPaths: [
        ...inbound.references
          .filter((reference) => reference.kind === 'monitor-target')
          .map((reference) => reference.path),
      ],
      blocks: index.spriteReferences
        .filter(
          (reference) =>
            reference.name === oldName &&
            reference.targets[0]?.targetIndex === targetIndex
        )
        .map((reference) => ({
          targetIndex: reference.block.target.targetIndex,
          blockId: reference.block.blockId,
          relativePaths: [`/fields/${pointerPart(reference.fieldName)}/0`],
        })),
    },
  }
}

function applyReorder(
  project: ProjectIR,
  operation: Extract<TargetOperationV1, { kind: 'target.reorderSprite' }>,
  targetIndex: number,
  beforeOrder: TargetDualOrderSnapshotV1
): DeltaOperationAttribution
{
  const target = project.json.targets[targetIndex]
  if (!target || target.isStage)
    return editError('edit.invalid_owner', 'reorder requires a sprite target')
  visualSpriteIndexes(project.json)
  if (target.layerOrder !== operation.expectedVisualLayerOrdinal)
    return editError(
      'edit.planning_facts_mismatch',
      'expected sprite visual layer changed'
    )
  assertExpectedOrder(
    beforeOrder.visualLayerOrderSha256,
    operation.expectedVisualLayerOrderSha256,
    'visual layer order'
  )
  const spriteCount = project.json.targets.filter(
    (candidate) => !candidate.isStage
  ).length
  if (
    !Number.isSafeInteger(operation.newVisualLayerOrdinal) ||
    operation.newVisualLayerOrdinal < 1 ||
    operation.newVisualLayerOrdinal > spriteCount
  )
    return editError(
      'edit.project_constraint',
      'new sprite visual layer is out of range'
    )
  if (target.layerOrder === operation.newVisualLayerOrdinal)
    return editError('edit.semantic_noop', 'sprite visual layer is unchanged')
  const oldLayer = target.layerOrder
  const changedIndexes: number[] = []
  for (const [candidateIndex, candidate] of project.json.targets.entries())
  {
    if (candidate.isStage) continue
    const layer = candidate.layerOrder!
    let nextLayer = layer
    if (
      oldLayer < operation.newVisualLayerOrdinal &&
      layer > oldLayer &&
      layer <= operation.newVisualLayerOrdinal
    )
      nextLayer -= 1
    else if (
      oldLayer > operation.newVisualLayerOrdinal &&
      layer >= operation.newVisualLayerOrdinal &&
      layer < oldLayer
    )
      nextLayer += 1
    if (candidateIndex === targetIndex)
      nextLayer = operation.newVisualLayerOrdinal
    if (nextLayer !== layer)
    {
      candidate.layerOrder = nextLayer
      changedIndexes.push(candidateIndex)
    }
  }
  visualSpriteIndexes(project.json)
  return {
    operationId: operation.opId,
    targetIndexes: changedIndexes,
    targetProperties: changedIndexes.map((index) => ({
      targetIndex: index,
      property: 'layerOrder',
    })),
    projectPaths: ['/visualTargetOrder', '/runtimeExecutableTargetOrder'],
  }
}

function applyRemove(
  project: ProjectIR,
  operation: Extract<TargetOperationV1, { kind: 'target.removeSprite' }>,
  targetIndex: number,
  lineage: SemanticLineageSnapshot,
  beforeOrder: TargetDualOrderSnapshotV1
): {
  activeLineage: SemanticLineageSnapshot
  attribution: DeltaOperationAttribution
  ownedSurfaceSha256: string
  inbound: TargetReferenceSetEvidenceV1
}
{
  const target = project.json.targets[targetIndex]
  if (!target || target.isStage)
    return editError('edit.invalid_owner', 'remove requires a sprite target')
  assertKnownTargetReferenceSemantics(project.json)
  assertUniqueSpriteNames(project.json)
  const index = buildSemanticReferenceIndex(project)
  assertNoDynamicTargetReferences(index)
  const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
  const ownedSurfaceSha256 = targetOwnedSurfaceSha256V1(target)
  assertExpectedOrder(
    inbound.referenceSetSha256,
    operation.expectedInboundReferenceSetSha256,
    'target inbound reference set'
  )
  assertExpectedOrder(
    ownedSurfaceSha256,
    operation.expectedOwnedSurfaceSha256,
    'target owned surface'
  )
  assertExpectedOrder(
    beforeOrder.serializedTargetOrderSha256,
    operation.expectedSerializedTargetOrderSha256,
    'serialized target order'
  )
  assertExpectedOrder(
    beforeOrder.visualLayerOrderSha256,
    operation.expectedVisualLayerOrderSha256,
    'visual layer order'
  )
  if (
    operation.requireFinalInboundReferenceCount !== 0 ||
    inbound.references.length !== 0
  )
    return editError(
      'edit.entity_still_referenced',
      'sprite removal requires zero final inbound references',
      inbound.references.length
    )
  const targetLineages = activeTargetLineages(
    lineage,
    project.json.targets.length
  )
  const removedLineage = targetLineages[targetIndex]!
  const removedLayer = target.layerOrder!
  project.json.targets.splice(targetIndex, 1)
  const changedLayerIndexes: number[] = []
  for (const [afterIndex, candidate] of project.json.targets.entries())
  {
    if (!candidate.isStage && candidate.layerOrder! > removedLayer)
    {
      candidate.layerOrder! -= 1
      changedLayerIndexes.push(afterIndex)
    }
  }
  visualSpriteIndexes(project.json)
  return {
    activeLineage: lineageAfterRemoval(lineage, removedLineage.lineageId),
    attribution: {
      operationId: operation.opId,
      targetIndexes: [targetIndex, ...changedLayerIndexes],
      targetProperties: changedLayerIndexes.map((index) => ({
        targetIndex: index,
        property: 'layerOrder',
      })),
      projectPaths: [
        '/targets',
        '/serializedTargetOrder',
        '/visualTargetOrder',
        '/runtimeExecutableTargetOrder',
      ],
      pathPrefixes: [`/targets/${targetIndex}`],
    },
    ownedSurfaceSha256,
    inbound,
  }
}

function matchesExpectedOptional(
  value: unknown,
  present: boolean,
  expected: SpritePropertyEditV1['expected'] | StagePropertyEditV1['expected']
): boolean
{
  if (expected.state === 'missing') return !present
  return present && Object.is(value, expected.value)
}

function setProperty(
  target: Target,
  edit: SpritePropertyEditV1 | StagePropertyEditV1
): boolean
{
  const descriptor = Object.getOwnPropertyDescriptor(target, edit.property)
  const present = descriptor?.enumerable === true && 'value' in descriptor
  const current = present ? descriptor.value : undefined
  if (!matchesExpectedOptional(current, present, edit.expected))
    return editError(
      'edit.planning_facts_mismatch',
      `expected target property ${edit.property} changed`
    )
  if (present && Object.is(current, edit.value)) return false
  defineScratchRecordValue<unknown>(
    target as unknown as Record<string, unknown>,
    edit.property,
    edit.value
  )
  return true
}

function applyProperties(
  project: ProjectIR,
  operation: Extract<
    TargetOperationV1,
    { kind: 'target.setSpriteProperties' | 'target.setStageProperties' }
  >,
  targetIndex: number
): DeltaOperationAttribution
{
  const target = project.json.targets[targetIndex]
  if (!target) return editError('edit.selector_no_match', 'target is absent')
  if (
    (operation.kind === 'target.setSpriteProperties' && target.isStage) ||
    (operation.kind === 'target.setStageProperties' && !target.isStage)
  )
    return editError(
      'edit.invalid_owner',
      'target property operation has the wrong target kind'
    )
  const changedProperties: string[] = []
  for (const edit of operation.edits)
  {
    if (setProperty(target, edit)) changedProperties.push(edit.property)
  }
  if (changedProperties.length === 0)
    return editError('edit.semantic_noop', 'target properties are unchanged')
  for (const edit of operation.edits)
  {
    if (!Object.is(target[edit.property as keyof Target], edit.value))
      return editError(
        'edit.postcondition_failed',
        `target property ${edit.property} was not set exactly`
      )
  }
  return {
    operationId: operation.opId,
    targetIndexes: [targetIndex],
    targetProperties: changedProperties.map((property) => ({
      targetIndex,
      property,
    })),
  }
}

function operationTargetLineage(
  lineage: SemanticLineageSnapshot,
  targetCount: number,
  targetIndex: number
): string
{
  return activeTargetLineages(lineage, targetCount)[targetIndex]!.lineageId
}

function postconditionEvidence(
  project: ProjectIR,
  targetIndex: number | null,
  propagatedReferenceCount: number,
  inboundReferenceSetSha256: string | null,
  ownedSurfaceSha256: string | null
): TargetOperationPostconditionEvidenceV1
{
  const target =
    targetIndex === null ? undefined : project.json.targets[targetIndex]
  const evidence = {
    targetCount: project.json.targets.length,
    spriteCount: project.json.targets.filter((candidate) => !candidate.isStage)
      .length,
    selectedTargetSemanticFingerprintSha256: target
      ? targetSemanticFingerprintV1(target)
      : null,
    inboundReferenceSetSha256,
    ownedSurfaceSha256,
    propagatedReferenceCount,
  }
  return {
    ...evidence,
    postconditionSha256: semanticHashV1('evidence-content', {
      kind: 'target-operation-postcondition',
      schemaVersion: 1,
      ...evidence,
    }),
  }
}

export function applyTargetOperationV1(
  project: ProjectIR,
  resolved: ResolvedTargetOperationV1
): TargetOperationResultV1
{
  const beforeTargetCount = project.json.targets.length
  const targetLineageId = operationTargetLineage(
    resolved.activeLineage,
    beforeTargetCount,
    resolved.targetIndex
  )
  const beforeOrder = targetDualOrderSnapshotV1(
    project.json,
    resolved.activeLineage
  )
  const originalSerializedNames = project.json.targets.map(
    (target) => target.name
  )
  const workingJson = structuredClone(project.json)
  const workingProject = {
    json: workingJson,
  } as ProjectIR
  let activeLineage = validateSemanticLineageSnapshot(resolved.activeLineage)
  let attribution: DeltaOperationAttribution
  let propagatedReferenceCount = 0
  let inboundReferenceSetSha256: string | null = null
  let ownedSurfaceSha256: string | null = null
  const operation = resolved.operation
  if (operation.kind === 'target.renameSprite')
  {
    const result = applyRename(workingProject, operation, resolved.targetIndex)
    attribution = result.attribution
    propagatedReferenceCount = result.propagatedReferenceCount
    inboundReferenceSetSha256 = result.inbound.referenceSetSha256
  }
  else if (operation.kind === 'target.reorderSprite')
    attribution = applyReorder(
      workingProject,
      operation,
      resolved.targetIndex,
      beforeOrder
    )
  else if (operation.kind === 'target.removeSprite')
  {
    const result = applyRemove(
      workingProject,
      operation,
      resolved.targetIndex,
      activeLineage,
      beforeOrder
    )
    activeLineage = result.activeLineage
    attribution = result.attribution
    inboundReferenceSetSha256 = result.inbound.referenceSetSha256
    ownedSurfaceSha256 = result.ownedSurfaceSha256
  }
  else
    attribution = applyProperties(
      workingProject,
      operation,
      resolved.targetIndex
    )
  const afterOrder = targetDualOrderSnapshotV1(workingJson, activeLineage)
  if (operation.kind !== 'target.removeSprite')
  {
    const afterSerializedNames = workingJson.targets.map(
      (target) => target.name
    )
    const expectedNames =
      operation.kind === 'target.renameSprite'
        ? originalSerializedNames.map((name, index) =>
            index === resolved.targetIndex ? operation.newName : name
          )
        : originalSerializedNames
    if (
      afterSerializedNames.some((name, index) => name !== expectedNames[index])
    )
      return editError(
        'edit.postcondition_failed',
        'serialized target order changed unexpectedly'
      )
  }
  if (
    operation.kind === 'target.reorderSprite' &&
    beforeOrder.serializedTargetOrderSha256 !==
      afterOrder.serializedTargetOrderSha256
  )
    return editError(
      'edit.postcondition_failed',
      'target reorder changed serialized target order'
    )
  const afterTargetIndex =
    operation.kind === 'target.removeSprite' ? null : resolved.targetIndex
  const correspondence = targetCorrespondenceV1(beforeOrder, afterOrder)
  const postcondition = postconditionEvidence(
    workingProject,
    afterTargetIndex,
    propagatedReferenceCount,
    inboundReferenceSetSha256,
    ownedSurfaceSha256
  )
  project.json.targets = workingJson.targets
  if (workingJson.monitors !== undefined)
    project.json.monitors = workingJson.monitors
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetLineageId,
    beforeTargetIndex: resolved.targetIndex,
    afterTargetIndex,
    attribution,
    beforeOrder,
    afterOrder,
    targetCorrespondence: correspondence,
    activeLineage,
    postcondition,
  }
}

// ---------------------------------------------------------------------------
// target creation
// ---------------------------------------------------------------------------

// addSprite is the one creating target op & it lives in Group F, not C: a sprite
// w/o a costume is not a well-formed target, so the op is only ever half of an
// atomic same-batch transaction whose other half is a media creation
export type TargetCreationOperationV1 = Extract<
  SemanticEditOperationV1,
  { kind: 'target.addSprite' }
>

interface ResolvedTargetCreationV1
{
  readonly operation: TargetCreationOperationV1
  readonly activeLineage: SemanticLineageSnapshot
}

interface AppliedTargetCreationV1
{
  readonly opId: string
  readonly operationKind: 'target.addSprite'
  readonly createdTargetIndex: number
  readonly createdName: string
  readonly visualLayerOrdinal: number
  readonly shiftedTargetIndexes: readonly number[]
  readonly beforeOrder: TargetDualOrderSnapshotV1
  readonly currentCostumeAfter: ExistingOptionalNumberV1
  readonly attribution: DeltaOperationAttribution
  readonly exactPaths: readonly string[]
}

// the created sprite carries every property the contract names & nothing else;
// unlisted leaves stay absent rather than acquiring an invented default
function createdSpriteTarget(
  operation: TargetCreationOperationV1
): SpriteTarget
{
  const { properties } = operation
  return {
    isStage: false,
    name: operation.name,
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    costumes: [],
    sounds: [],
    volume: properties.volume,
    layerOrder: operation.visualLayerOrdinal,
    visible: properties.visible,
    x: properties.x,
    y: properties.y,
    size: properties.size,
    direction: properties.direction,
    draggable: properties.draggable,
    rotationStyle: properties.rotationStyle,
  }
}

// a created sprite has no costume yet, so it has no effective selection either.
// leaving `currentCostume` absent is what the uninitializedCreatedTarget arm
// then observes; serializing a 0 here would fake a selection of nothing
const UNINITIALIZED_CURRENT_COSTUME: ExistingOptionalNumberV1 = Object.freeze({
  state: 'missing',
})

export function applyTargetAddSpriteV1(
  project: ProjectIR,
  resolved: ResolvedTargetCreationV1
): AppliedTargetCreationV1
{
  const operation = resolved.operation
  const beforeOrder = targetDualOrderSnapshotV1(
    project.json,
    resolved.activeLineage
  )
  visualSpriteIndexes(project.json)
  assertKnownTargetReferenceSemantics(project.json)
  assertUniqueSpriteNames(project.json)
  if (operation.name.length === 0)
    return editError('edit.project_constraint', 'a sprite name cannot be empty')
  if (RESERVED_TARGET_NAMES.has(operation.name))
    return editError(
      'edit.project_constraint',
      'sprite name collides with a reserved runtime target name'
    )
  if (
    project.json.targets.some((candidate) => candidate.name === operation.name)
  )
    return editError(
      'edit.project_constraint',
      'sprite name must be exact-unique'
    )
  const spriteCount = project.json.targets.filter(
    (candidate) => !candidate.isStage
  ).length
  if (
    !Number.isSafeInteger(operation.visualLayerOrdinal) ||
    operation.visualLayerOrdinal < 1 ||
    operation.visualLayerOrdinal > spriteCount + 1
  )
    return editError(
      'edit.project_constraint',
      'new sprite visual layer is out of range'
    )
  const workingJson = structuredClone(project.json)
  // insertion opens exactly one visual slot: every sprite already at or above the
  // requested ordinal moves up by one & every sprite below it is untouched
  const shiftedTargetIndexes: number[] = []
  for (const [candidateIndex, candidate] of workingJson.targets.entries())
  {
    if (candidate.isStage) continue
    if (candidate.layerOrder! < operation.visualLayerOrdinal) continue
    candidate.layerOrder! += 1
    shiftedTargetIndexes.push(candidateIndex)
  }
  // serialized target order is append-only, so the created sprite always takes
  // the last serialized ordinal regardless of where it lands visually
  workingJson.targets.push(createdSpriteTarget(operation))
  const createdTargetIndex = workingJson.targets.length - 1
  const created = workingJson.targets[createdTargetIndex]!
  if (created.currentCostume !== undefined)
    return editError(
      'edit.postcondition_failed',
      'a created sprite must not carry a current-costume selection'
    )
  project.json.targets = workingJson.targets
  visualSpriteIndexes(project.json)
  // appending a target moves all three derived order projections, exactly as a
  // removal does, so the creation names them rather than leaving them orphaned
  const exactPaths = Object.freeze([
    '/targets',
    `/targets/${createdTargetIndex}`,
    '/serializedTargetOrder',
    '/visualTargetOrder',
    '/runtimeExecutableTargetOrder',
    ...shiftedTargetIndexes.map((index) => `/targets/${index}/layerOrder`),
  ])
  return {
    opId: operation.opId,
    operationKind: 'target.addSprite',
    createdTargetIndex,
    createdName: operation.name,
    visualLayerOrdinal: operation.visualLayerOrdinal,
    shiftedTargetIndexes: Object.freeze(shiftedTargetIndexes),
    beforeOrder,
    currentCostumeAfter: UNINITIALIZED_CURRENT_COSTUME,
    attribution: {
      operationId: operation.opId,
      targetIndexes: [createdTargetIndex, ...shiftedTargetIndexes],
      targetProperties: shiftedTargetIndexes.map((targetIndex) => ({
        targetIndex,
        property: 'layerOrder' as const,
      })),
      projectPaths: [...exactPaths],
      // every leaf of the created sprite exists because this operation created
      // it, so the whole created subtree is attributed here. the prefix stops at
      // the created target & never reaches a sprite that already existed
      pathPrefixes: [`/targets/${createdTargetIndex}`],
    },
    exactPaths,
  }
}

// a sprite created in this batch is only well-formed once it also owns a costume,
// so the batch — not the operation — is the unit that has to close consistently
export function assertCreatedTargetsAreCostumedV1(
  project: ProjectIR,
  createdTargetIndexes: readonly number[]
): void
{
  for (const targetIndex of createdTargetIndexes)
  {
    const target = project.json.targets[targetIndex]
    if (!target)
      editError(
        'edit.internal_invariant',
        'created target is absent from the candidate'
      )
    else if (target.costumes.length === 0)
      editError(
        'edit.cardinality_mismatch',
        `created sprite ${target.name} has no costume in the same batch`,
        target.costumes.length
      )
  }
}

// creation reads no existing target, so its limitations are project-wide facts
function targetCreationLimitations(json: ProjectJson): readonly string[]
{
  const limitations = new Set<string>()
  try
  {
    visualSpriteIndexes(json)
  }
  catch
  {
    limitations.add('edit.project_constraint')
  }
  const spriteNames = json.targets
    .filter((candidate) => !candidate.isStage)
    .map((candidate) => candidate.name)
  if (new Set(spriteNames).size !== spriteNames.length)
    limitations.add('edit.project_constraint')
  const unknownSemantics = unknownNameSemanticsEvidenceV1(json)
  if (unknownSemantics.declaredExtensions.length > 0)
    limitations.add('edit.unsupported_extension')
  if (
    unknownSemantics.unknownOpcodes.length > 0 ||
    unknownSemantics.surfaceIssues.length > 0
  )
    limitations.add('edit.unsupported_opcode')
  return Object.freeze([...limitations].sort())
}

function targetMutationLimitations(
  json: ProjectJson,
  index: SemanticReferenceIndex,
  targetIndex: number,
  operationKind: TargetCapabilityAssessmentItemV1['operationKind']
): readonly string[]
{
  const target = json.targets[targetIndex]
  if (!target) return ['edit.selector_no_match']
  const limitations = new Set<string>()
  const spriteRequired =
    operationKind === 'target.renameSprite' ||
    operationKind === 'target.reorderSprite' ||
    operationKind === 'target.removeSprite' ||
    operationKind === 'target.setSpriteProperties'
  if (spriteRequired && target.isStage) limitations.add('edit.invalid_owner')
  if (operationKind === 'target.setStageProperties' && !target.isStage)
    limitations.add('edit.invalid_owner')
  if (
    operationKind === 'target.renameSprite' ||
    operationKind === 'target.removeSprite'
  )
  {
    const unknownSemantics = unknownNameSemanticsEvidenceV1(json)
    if (unknownSemantics.declaredExtensions.length > 0)
      limitations.add('edit.unsupported_extension')
    if (
      unknownSemantics.unknownOpcodes.length > 0 ||
      unknownSemantics.surfaceIssues.length > 0
    )
      limitations.add('edit.unsupported_opcode')
    const spriteNames = json.targets
      .filter((candidate) => !candidate.isStage)
      .map((candidate) => candidate.name)
    if (new Set(spriteNames).size !== spriteNames.length)
      limitations.add('edit.project_constraint')
    if (index.dynamicSpriteReferences.length > 0)
      limitations.add('edit.dynamic_reference')
    if (
      index.spriteReferences.some(
        (reference) =>
          reference.name === target.name &&
          (reference.sourceStatus !== 'verified-parent' ||
            reference.targetStatus !== 'unique')
      ) ||
      index.monitors.some(
        (monitor) =>
          monitor.spriteName === target.name &&
          monitor.targetStatus !== 'unique'
      )
    )
      limitations.add('edit.reference_propagation_incomplete')
  }
  if (operationKind === 'target.removeSprite')
  {
    const inbound = targetInboundReferenceSetV1(
      { json } as ProjectIR,
      index,
      targetIndex
    )
    if (inbound.references.length > 0)
      limitations.add('edit.entity_still_referenced')
  }
  if (
    operationKind === 'target.reorderSprite' ||
    operationKind === 'target.removeSprite'
  )
  {
    try
    {
      visualSpriteIndexes(json)
    }
    catch
    {
      limitations.add('edit.project_constraint')
    }
  }
  return Object.freeze([...limitations].sort())
}

export function assessTargetOperationCapabilitiesV1(
  project: ProjectIR
): TargetCapabilityAssessmentV1
{
  const index = buildSemanticReferenceIndex(project)
  const operationKinds: readonly TargetCapabilityAssessmentItemV1['operationKind'][] =
    [
      'target.addSprite',
      'target.renameSprite',
      'target.reorderSprite',
      'target.removeSprite',
      'target.setSpriteProperties',
      'target.setStageProperties',
    ]
  const items = operationKinds.map((operationKind) =>
  {
    // creation names no existing target, so it is assessed project-wide: the only
    // things that can stand it down are a malformed layer order or a name domain
    // that cannot prove exact-uniqueness for the sprite it is about to add
    if (operationKind === 'target.addSprite')
      return {
        operationKind,
        availability:
          targetCreationLimitations(project.json).length === 0
            ? ('supported' as const)
            : ('unsupported' as const),
        limitationCodes: targetCreationLimitations(project.json),
        targetIndexes: Object.freeze([] as number[]),
      }
    const supportedTargetIndexes: number[] = []
    const limitationCodes = new Set<string>()
    for (
      let targetIndex = 0;
      targetIndex < project.json.targets.length;
      targetIndex++
    )
    {
      const limitations = targetMutationLimitations(
        project.json,
        index,
        targetIndex,
        operationKind
      )
      if (limitations.length === 0) supportedTargetIndexes.push(targetIndex)
      for (const limitation of limitations) limitationCodes.add(limitation)
    }
    return {
      operationKind,
      availability:
        supportedTargetIndexes.length > 0
          ? ('supported' as const)
          : ('unsupported' as const),
      limitationCodes: Object.freeze([...limitationCodes].sort()),
      targetIndexes: Object.freeze(supportedTargetIndexes),
    }
  })
  const frozenItems = Object.freeze(items)
  return {
    items: frozenItems,
    assessmentSha256: semanticHashV1('capability-snapshot', {
      kind: 'target-operation-capability-assessment',
      schemaVersion: 1,
      items: frozenItems,
      descriptorSetSha256: semanticHashV1('capability-profile', {
        kind: 'target-name-reference-descriptor-set',
        descriptors: TARGET_NAME_REFERENCE_DESCRIPTORS_V1,
      }),
    }),
  }
}
