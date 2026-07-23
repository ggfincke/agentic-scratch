// packages/eval/src/edit-evaluation/edit-projection-mask.ts
// lineage-canonical runtime projection & exact typed edit-mask enforcement

import { createHash } from 'node:crypto'

import type {
  CloneProjectionMaskV1,
  NormalizedRegionV1,
  ObservationLabelsV1,
  PreservationLensV1,
  RuntimeStatePathV1,
  StateProjectionMaskV1,
  VisualProjectionMaskV1,
} from '@scratch-agent/ir/edit'
import type {
  MediaFrameRefV1,
  RuntimeObservationRecordV1,
  VmSpriteState,
  VmStateSnapshot,
} from '@scratch-agent/runner'

import { editRuntimeHashV1 } from './edit-scenario-lowering.js'
import type { BehavioralTrace } from '../multimodal/differential.js'
import {
  buildBoundedEditProofTraceV1,
  type EditBoundedRuntimeObservationV1,
} from './edit-bounded-observation.js'
import type { BehavioralLensSpecV1 } from '../multimodal/lenses.js'

const EDIT_PROJECTION_MASK_ENGINE_VERSION =
  'edit-projection-mask-engine-v1' as const

const MASKED_STRING = 'edit-mask:exact-leaf'
const MASKED_NUMBER = 0
const MASKED_BOOLEAN = false

function maskedTaggedString(): string
{
  return {
    scalarKind: 'string',
    value: MASKED_STRING,
  } as unknown as string
}

function maskedTaggedNumber(): number
{
  return {
    scalarKind: 'number',
    value: { numberKind: 'finite', value: MASKED_NUMBER },
  } as unknown as number
}

function maskedTaggedBoolean(): boolean
{
  return {
    scalarKind: 'boolean',
    value: MASKED_BOOLEAN,
  } as unknown as boolean
}

interface EditRuntimeTargetIdentityV1
{
  readonly runtimeTargetId: string
  readonly observationTargetId: string
  readonly cloneCountTargetId: string
  readonly geometryOriginalTargetId: string
  readonly runtimeTargetName: string
  readonly targetLineage: string
  readonly isStage: boolean
}

interface EditRuntimeDeclarationIdentityV1
{
  readonly runtimeName: string
  readonly runtimeDeclarationId: string
  readonly declarationLineage: string
  readonly targetLineage: string
  readonly collection: 'variables' | 'lists'
}

interface EditRuntimeMediaIdentityV1
{
  readonly runtimeName: string
  readonly mediaLineage: string
  readonly targetLineage: string
  readonly mediaKind: 'costume'
  readonly mediaIndex: number
}

interface EditDecodedPixelFrameV1
{
  readonly frameId: string
  readonly sourceFrameSha256: string
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
  readonly rgbaSha256: string
}

// this facet is intentionally explicit until every runner lane emits the same
// identity-complete observation. eval refuses an absent or partial facet.
export interface EditRuntimeIdentityFacetV1
{
  readonly artifactSha256: string
  readonly manifestSha256: string
  readonly targets: readonly EditRuntimeTargetIdentityV1[]
  readonly declarations: readonly EditRuntimeDeclarationIdentityV1[]
  readonly media: readonly EditRuntimeMediaIdentityV1[]
  readonly paneTargetLineageOrder: readonly string[]
  readonly executableTargetLineageOrder: readonly string[]
  readonly decodedPixelFrames: readonly EditDecodedPixelFrameV1[]
  readonly runtimeObservations: readonly RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>[]
}

interface EditProjectionTargetBindingV1
{
  readonly bindingKey: string
  readonly targetLineage: string
}

interface EditProjectionDeclarationBindingV1
{
  readonly bindingKey: string
  readonly declarationLineage: string
  readonly targetLineage: string
  readonly collection: 'variables' | 'lists'
}

interface EditProjectionBindingTableV1
{
  readonly targets: readonly EditProjectionTargetBindingV1[]
  readonly declarations: readonly EditProjectionDeclarationBindingV1[]
}

export type EditProjectionNameTransitionV1 =
  | {
      readonly transitionKind: 'targetName'
      readonly operationKind: 'target.renameSprite'
      readonly targetLineage: string
      readonly baselineName: string
      readonly candidateName: string
    }
  | {
      readonly transitionKind: 'declarationName'
      readonly operationKind: 'declaration.rename'
      readonly declarationLineage: string
      readonly baselineName: string
      readonly candidateName: string
    }
  | {
      readonly transitionKind: 'mediaName'
      readonly operationKind: 'media.renameCostume'
      readonly mediaLineage: string
      readonly baselineName: string
      readonly candidateName: string
    }

export interface EditTargetMembershipAuthorizationV1
{
  readonly targetLineage: string
  readonly presentSide: 'baseline' | 'candidate'
  readonly operationKind: 'target.addSprite' | 'target.removeSprite'
}

export interface EditRuntimeProjectionAuthorizationsV1
{
  readonly nameTransitions: readonly EditProjectionNameTransitionV1[]
  readonly targetMembershipAuthorizations: readonly EditTargetMembershipAuthorizationV1[]
}

export interface EditProjectionMaskPolicyV1 extends EditRuntimeProjectionAuthorizationsV1
{
  readonly scenarioId: string
  readonly lens: PreservationLensV1
  readonly bindings: EditProjectionBindingTableV1
  readonly masks: EditActivatedObservationMasksV1
}

// structurally accepts @scratch-agent/edit's ActivatedObservationMasksV1
// without introducing the edit -> eval package cycle in the opposite direction.
interface EditActivatedObservationMasksV1
{
  readonly state: readonly StateProjectionMaskV1[]
  readonly clone: readonly CloneProjectionMaskV1[]
  readonly visual: readonly VisualProjectionMaskV1[]
}

export interface EditRuntimeProjectionInputV1
{
  readonly baseline: EditRuntimeIdentityFacetV1
  readonly candidate: EditRuntimeIdentityFacetV1
  readonly policy: EditProjectionMaskPolicyV1
}

interface EditAppliedProjectionMaskEvidenceV1
{
  readonly maskId: string
  readonly maskKind:
    | StateProjectionMaskV1['maskKind']
    | CloneProjectionMaskV1['maskKind']
    | VisualProjectionMaskV1['maskKind']
  readonly exactMatchCount: number
}

interface EditPixelComplementEvidenceV1
{
  readonly side: 'baseline' | 'candidate'
  readonly frameId: string
  readonly maskedPixelCount: number
  readonly unmaskedPixelCount: number
  readonly complementSha256: string
}

export interface EditRuntimeProjectionEvidenceV1
{
  readonly engineVersion: typeof EDIT_PROJECTION_MASK_ENGINE_VERSION
  readonly projectionSha256: string
  readonly appliedMasks: readonly EditAppliedProjectionMaskEvidenceV1[]
  readonly pixelComplements: readonly EditPixelComplementEvidenceV1[]
  readonly projectedOrders: {
    readonly baseline: {
      readonly paneTargetLineageOrder: readonly string[]
      readonly executableTargetLineageOrder: readonly string[]
    }
    readonly candidate: {
      readonly paneTargetLineageOrder: readonly string[]
      readonly executableTargetLineageOrder: readonly string[]
    }
  }
}

export type EditRuntimeProjectionResultV1 =
  | {
      readonly status: 'projected'
      readonly baseline: BehavioralTrace
      readonly candidate: BehavioralTrace
      readonly evidence: EditRuntimeProjectionEvidenceV1
    }
  | {
      readonly status: 'inconclusive'
      readonly reason:
        | 'identity-facet-mismatch'
        | 'identity-transition-mismatch'
        | 'projection-mask-mismatch'
        | 'pixel-facet-mismatch'
        | 'bounded-observation-refused'
        | 'bounded-observation-incomplete'
        | 'bounded-observation-invalid'
      readonly maskId: string | null
      readonly detail: string
    }

type ProjectionFailureReason = Extract<
  EditRuntimeProjectionResultV1,
  { status: 'inconclusive' }
>['reason']

class ProjectionFailure extends Error
{
  constructor(
    readonly reason: ProjectionFailureReason,
    readonly maskId: string | null,
    message: string
  )
  {
    super(message)
    this.name = 'ProjectionFailure'
  }
}

interface SideContext
{
  readonly side: 'baseline' | 'candidate'
  readonly trace: BehavioralTrace
  readonly facet: EditRuntimeIdentityFacetV1
  readonly targetByRuntimeId: ReadonlyMap<string, EditRuntimeTargetIdentityV1>
  readonly targetByCloneCountId: ReadonlyMap<
    string,
    EditRuntimeTargetIdentityV1
  >
  readonly targetByGeometryId: ReadonlyMap<string, EditRuntimeTargetIdentityV1>
  readonly targetByLineage: ReadonlyMap<string, EditRuntimeTargetIdentityV1>
  readonly targetsByRuntimeName: ReadonlyMap<
    string,
    readonly EditRuntimeTargetIdentityV1[]
  >
  readonly declarationByRuntimeKey: ReadonlyMap<
    string,
    EditRuntimeDeclarationIdentityV1
  >
  readonly declarationByLineage: ReadonlyMap<
    string,
    EditRuntimeDeclarationIdentityV1
  >
  readonly declarationCountByCollectionKey: ReadonlyMap<string, number>
  readonly mediaByRuntimeKey: ReadonlyMap<string, EditRuntimeMediaIdentityV1>
  readonly mediaByLineage: ReadonlyMap<string, EditRuntimeMediaIdentityV1>
  readonly pixelByFrameId: ReadonlyMap<string, EditDecodedPixelFrameV1>
  readonly canonicalGeometry: WeakSet<object>
  projectedPaneTargetLineageOrder: string[]
  projectedExecutableTargetLineageOrder: string[]
}

interface ProjectionWork
{
  readonly baseline: SideContext
  readonly candidate: SideContext
  readonly policy: EditSelectedProjectionPolicyV1
  readonly targetBindings: ReadonlyMap<string, string>
  readonly declarationBindings: ReadonlyMap<
    string,
    EditProjectionDeclarationBindingV1
  >
  readonly appliedMasks: EditAppliedProjectionMaskEvidenceV1[]
  readonly pixelComplements: EditPixelComplementEvidenceV1[]
}

interface EditSelectedProjectionPolicyV1 extends Omit<
  EditProjectionMaskPolicyV1,
  'masks'
>
{
  readonly stateMasks: readonly StateProjectionMaskV1[]
  readonly cloneMasks: readonly CloneProjectionMaskV1[]
  readonly visualMasks: readonly VisualProjectionMaskV1[]
}

function targetKey(targetLineage: string): string
{
  return `target:${targetLineage}`
}

function declarationKey(declarationLineage: string): string
{
  return `declaration:${declarationLineage}`
}

function mediaKey(mediaLineage: string): string
{
  return `media:${mediaLineage}`
}

function runtimeDeclarationKey(
  targetLineage: string,
  collection: 'variables' | 'lists',
  runtimeDeclarationId: string
): string
{
  return editRuntimeHashV1('edit-runtime-declaration-key', [
    targetLineage,
    collection,
    runtimeDeclarationId,
  ])
}

function runtimeDeclarationCollectionKey(
  targetLineage: string,
  collection: 'variables' | 'lists'
): string
{
  return editRuntimeHashV1('edit-runtime-declaration-collection-key', [
    targetLineage,
    collection,
  ])
}

function runtimeMediaKey(
  targetLineage: string,
  mediaIndex: number,
  runtimeName: string
): string
{
  return editRuntimeHashV1('edit-runtime-media-key', [
    targetLineage,
    mediaIndex,
    runtimeName,
  ])
}

function uniqueMap<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  detail: string
): ReadonlyMap<string, T>
{
  const result = new Map<string, T>()
  for (const value of values)
  {
    const key = keyOf(value)
    if (key.length === 0 || result.has(key))
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${detail} has a duplicate or empty identity ${JSON.stringify(key)}`
      )
    result.set(key, value)
  }
  return result
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean
{
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function exactSet(values: readonly string[], detail: string): Set<string>
{
  const result = new Set(values)
  if (
    result.size !== values.length ||
    values.some((value) => value.length === 0)
  )
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${detail} must contain nonempty unique lineages`
    )
  return result
}

function bytesSha256(domain: string, chunks: readonly Uint8Array[]): string
{
  const hash = createHash('sha256')
  hash.update(domain)
  hash.update('\0')
  for (const chunk of chunks)
  {
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(chunk.byteLength)
    hash.update(length)
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export function editDecodedRgbaSha256V1(input: {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}): string
{
  return bytesSha256('edit-decoded-rgba-v1', [
    Buffer.from(`${input.width}x${input.height}`, 'utf8'),
    input.rgba,
  ])
}

export function editCloneTickSetSha256V1(ticks: readonly number[]): string
{
  return editRuntimeHashV1('edit-clone-mask-tick-set-v1', ticks)
}

export function editCloneCountSeriesSha256V1(
  series: readonly { readonly tick: number; readonly count: number }[]
): string
{
  return editRuntimeHashV1('edit-clone-mask-count-series-v1', series)
}

export function editGeometryInstanceSetSha256V1(
  instances: readonly {
    readonly targetLineage: string
    readonly instance: 'original' | 'clone'
    readonly instanceIndex: number
  }[]
): string
{
  const canonical = [...instances].sort(
    (left, right) =>
      left.targetLineage.localeCompare(right.targetLineage) ||
      left.instance.localeCompare(right.instance) ||
      left.instanceIndex - right.instanceIndex
  )
  return editRuntimeHashV1('edit-geometry-instance-set-v1', canonical)
}

function createSideContext(
  side: 'baseline' | 'candidate',
  trace: BehavioralTrace,
  facet: EditRuntimeIdentityFacetV1,
  expectedArtifactSha256: string,
  expectedManifestSha256: string
): SideContext
{
  if (
    facet.artifactSha256 !== expectedArtifactSha256 ||
    facet.artifactSha256 !== trace.observations.sourceSb3Sha256
  )
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${side} identity facet does not bind the executed artifact`
    )
  if (facet.manifestSha256 !== expectedManifestSha256)
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${side} identity facet does not bind the lowering manifest`
    )

  const targetByRuntimeId = uniqueMap(
    facet.targets,
    (target) => target.observationTargetId,
    `${side} observation target identities`
  )
  const targetByCloneCountId = uniqueMap(
    facet.targets,
    (target) => target.cloneCountTargetId,
    `${side} clone-count target identities`
  )
  const targetByGeometryId = uniqueMap(
    facet.targets,
    (target) => target.geometryOriginalTargetId,
    `${side} geometry target identities`
  )
  const targetByLineage = uniqueMap(
    facet.targets,
    (target) => target.targetLineage,
    `${side} target lineages`
  )
  const targetsByRuntimeName = new Map<string, EditRuntimeTargetIdentityV1[]>()
  for (const target of facet.targets)
  {
    if (target.isStage) continue
    const matches = targetsByRuntimeName.get(target.runtimeTargetName) ?? []
    matches.push(target)
    targetsByRuntimeName.set(target.runtimeTargetName, matches)
  }
  if (facet.targets.filter((target) => target.isStage).length !== 1)
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${side} identity facet must contain exactly one stage`
    )
  const paneSet = exactSet(
    facet.paneTargetLineageOrder,
    `${side} pane target order`
  )
  const executableSet = exactSet(
    facet.executableTargetLineageOrder,
    `${side} executable target order`
  )
  const targetSet = new Set(targetByLineage.keys())
  for (const [label, set] of [
    ['pane', paneSet],
    ['executable', executableSet],
  ] as const)
    if (
      set.size !== targetSet.size ||
      [...targetSet].some((lineage) => !set.has(lineage))
    )
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${side} ${label} order is not the exact target-lineage set`
      )

  const declarationByRuntimeKey = uniqueMap(
    facet.declarations,
    (declaration) =>
      runtimeDeclarationKey(
        declaration.targetLineage,
        declaration.collection,
        declaration.runtimeDeclarationId
      ),
    `${side} runtime declaration identities`
  )
  const declarationByLineage = uniqueMap(
    facet.declarations,
    (declaration) => declaration.declarationLineage,
    `${side} declaration lineages`
  )
  const declarationCountByCollectionKey = new Map<string, number>()
  for (const declaration of facet.declarations)
  {
    const key = runtimeDeclarationCollectionKey(
      declaration.targetLineage,
      declaration.collection
    )
    declarationCountByCollectionKey.set(
      key,
      (declarationCountByCollectionKey.get(key) ?? 0) + 1
    )
  }
  const mediaByRuntimeKey = uniqueMap(
    facet.media,
    (media) =>
      runtimeMediaKey(media.targetLineage, media.mediaIndex, media.runtimeName),
    `${side} runtime media identities`
  )
  uniqueMap(
    facet.media,
    (media) => `${media.targetLineage}:${media.mediaIndex}`,
    `${side} runtime media positions`
  )
  const mediaByLineage = uniqueMap(
    facet.media,
    (media) => media.mediaLineage,
    `${side} media lineages`
  )
  for (const declaration of facet.declarations)
    if (!targetByLineage.has(declaration.targetLineage))
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${side} declaration ${declaration.declarationLineage} names an absent target lineage`
      )
  for (const media of facet.media)
    if (
      !targetByLineage.has(media.targetLineage) ||
      !Number.isSafeInteger(media.mediaIndex) ||
      media.mediaIndex < 0
    )
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${side} media ${media.mediaLineage} has an invalid target or media index`
      )
  const pixelByFrameId = uniqueMap(
    facet.decodedPixelFrames,
    (frame) => frame.frameId,
    `${side} decoded pixel frames`
  )

  if ('lineage' in trace && trace.lineage)
  {
    if (
      trace.lineage.status !== 'bound' ||
      trace.lineage.manifestSha256 !== facet.manifestSha256 ||
      !arraysEqual(
        trace.lineage.paneLineageOrder,
        facet.paneTargetLineageOrder
      ) ||
      !arraysEqual(
        trace.lineage.executableTargetLineageOrder,
        facet.executableTargetLineageOrder
      )
    )
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${side} explicit identity facet disagrees with its retained runner lineage adapter`
      )
  }

  return {
    side,
    trace,
    facet,
    targetByRuntimeId,
    targetByCloneCountId,
    targetByGeometryId,
    targetByLineage,
    targetsByRuntimeName,
    declarationByRuntimeKey,
    declarationByLineage,
    declarationCountByCollectionKey,
    mediaByRuntimeKey,
    mediaByLineage,
    pixelByFrameId,
    canonicalGeometry: new WeakSet(),
    projectedPaneTargetLineageOrder: [...facet.paneTargetLineageOrder],
    projectedExecutableTargetLineageOrder: [
      ...facet.executableTargetLineageOrder,
    ],
  }
}

function selectedMasks<T extends { readonly maskId: string }>(
  maskIds: readonly string[] | undefined,
  masks: readonly T[],
  scenarioId: string,
  kind: string
): readonly T[]
{
  const ids = maskIds ?? []
  if (new Set(ids).size !== ids.length)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      null,
      `${kind} mask selection contains duplicate IDs`
    )
  return ids.map((maskId) =>
  {
    const matches = masks.filter(
      (mask) =>
        mask.maskId === maskId &&
        'scenarioId' in mask &&
        mask.scenarioId === scenarioId
    )
    if (matches.length !== 1)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        maskId,
        `${kind} mask ${maskId} has ${matches.length} exact activated matches for ${scenarioId}`
      )
    return matches[0]!
  })
}

function selectProjectionPolicy(
  policy: EditProjectionMaskPolicyV1
): EditSelectedProjectionPolicyV1
{
  if (policy.lens.scenarioId !== policy.scenarioId)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      null,
      `lens scenario ${policy.lens.scenarioId} does not match projection scenario ${policy.scenarioId}`
    )
  let stateMaskIds: readonly string[] | undefined
  let cloneMaskIds: readonly string[] | undefined
  let visualMaskIds: readonly string[] | undefined
  switch (policy.lens.lensKind)
  {
    case 'finalState':
    case 'labeledTrace':
    case 'cloneCounts':
      stateMaskIds = policy.lens.stateMaskIds
      cloneMaskIds = policy.lens.cloneMaskIds
      break
    case 'runtimeOutcome':
      if (
        (policy.lens.stateMaskIds?.length ?? 0) > 0 ||
        (policy.lens.cloneMaskIds?.length ?? 0) > 0
      )
        throw new ProjectionFailure(
          'projection-mask-mismatch',
          null,
          'runtimeOutcome accepts no projection masks'
        )
      break
    case 'visualKeyframes':
      visualMaskIds = policy.lens.visualMaskIds
      break
  }
  return {
    ...policy,
    stateMasks: selectedMasks(
      stateMaskIds,
      policy.masks.state,
      policy.scenarioId,
      'state'
    ),
    cloneMasks: selectedMasks(
      cloneMaskIds,
      policy.masks.clone,
      policy.scenarioId,
      'clone'
    ),
    visualMasks: selectedMasks(
      visualMaskIds,
      policy.masks.visual,
      policy.scenarioId,
      'visual'
    ),
  }
}

function validateBindings(policy: EditSelectedProjectionPolicyV1): {
  readonly targets: ReadonlyMap<string, string>
  readonly declarations: ReadonlyMap<string, EditProjectionDeclarationBindingV1>
}
{
  uniqueMap(
    policy.bindings.targets,
    (binding) => binding.bindingKey,
    'target projection bindings'
  )
  return {
    targets: new Map(
      policy.bindings.targets.map((binding) => [
        binding.bindingKey,
        binding.targetLineage,
      ])
    ),
    declarations: uniqueMap(
      policy.bindings.declarations,
      (binding) => binding.bindingKey,
      'declaration projection bindings'
    ),
  }
}

function transitionIdentity(
  transition: EditProjectionNameTransitionV1
): string
{
  switch (transition.transitionKind)
  {
    case 'targetName':
      return `target:${transition.targetLineage}`
    case 'declarationName':
      return `declaration:${transition.declarationLineage}`
    case 'mediaName':
      return `media:${transition.mediaLineage}`
  }
}

function validateNameTransitions(
  baseline: SideContext,
  candidate: SideContext,
  transitions: readonly EditProjectionNameTransitionV1[]
): void
{
  const byIdentity = uniqueMap(
    transitions,
    transitionIdentity,
    'authorized name transitions'
  )
  const used = new Set<string>()
  const validate = (
    kind: EditProjectionNameTransitionV1['transitionKind'],
    identity: string,
    baselineName: string,
    candidateName: string
  ): void =>
  {
    if (baselineName === candidateName) return
    const key = `${kind === 'targetName' ? 'target' : kind === 'declarationName' ? 'declaration' : 'media'}:${identity}`
    const transition = byIdentity.get(key)
    if (
      !transition ||
      transition.transitionKind !== kind ||
      transition.baselineName !== baselineName ||
      transition.candidateName !== candidateName ||
      (kind === 'targetName' &&
        transition.operationKind !== 'target.renameSprite') ||
      (kind === 'declarationName' &&
        transition.operationKind !== 'declaration.rename') ||
      (kind === 'mediaName' &&
        transition.operationKind !== 'media.renameCostume')
    )
      throw new ProjectionFailure(
        'identity-transition-mismatch',
        null,
        `${key} changed display identity without one exact authorized transition`
      )
    used.add(key)
  }

  for (const [lineage, left] of baseline.targetByLineage)
  {
    const right = candidate.targetByLineage.get(lineage)
    if (right)
      validate(
        'targetName',
        lineage,
        left.runtimeTargetName,
        right.runtimeTargetName
      )
  }
  for (const [lineage, left] of baseline.declarationByLineage)
  {
    const right = candidate.declarationByLineage.get(lineage)
    if (right)
      validate('declarationName', lineage, left.runtimeName, right.runtimeName)
  }
  for (const [lineage, left] of baseline.mediaByLineage)
  {
    const right = candidate.mediaByLineage.get(lineage)
    if (right)
      validate('mediaName', lineage, left.runtimeName, right.runtimeName)
  }
  const unused = [...byIdentity.keys()].filter((key) => !used.has(key))
  if (unused.length > 0)
    throw new ProjectionFailure(
      'identity-transition-mismatch',
      null,
      `authorized name transitions do not match an observed rename: ${unused.join(', ')}`
    )
}

function validateMembershipAuthorizations(work: ProjectionWork): void
{
  const authorizations = uniqueMap(
    work.policy.targetMembershipAuthorizations,
    (authorization) => authorization.targetLineage,
    'target membership authorizations'
  )
  for (const authorization of authorizations.values())
  {
    const baselinePresent = work.baseline.targetByLineage.has(
      authorization.targetLineage
    )
    const candidatePresent = work.candidate.targetByLineage.has(
      authorization.targetLineage
    )
    const expectedOperation =
      authorization.presentSide === 'candidate'
        ? 'target.addSprite'
        : 'target.removeSprite'
    if (
      authorization.operationKind !== expectedOperation ||
      baselinePresent === candidatePresent ||
      baselinePresent !== (authorization.presentSide === 'baseline') ||
      candidatePresent !== (authorization.presentSide === 'candidate')
    )
      throw new ProjectionFailure(
        'identity-transition-mismatch',
        null,
        `target membership authorization for ${authorization.targetLineage} does not match one exact add/remove`
      )
  }
}

function declarationIdentity(
  context: SideContext,
  targetLineage: string,
  collection: 'variables' | 'lists',
  runtimeDeclarationId: string
): EditRuntimeDeclarationIdentityV1
{
  const identity = context.declarationByRuntimeKey.get(
    runtimeDeclarationKey(targetLineage, collection, runtimeDeclarationId)
  )
  if (!identity)
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} ${targetLineage}/${collection}/${JSON.stringify(runtimeDeclarationId)} has no declaration lineage`
    )
  return identity
}

function mediaIdentityBySelection(
  context: SideContext,
  targetLineage: string,
  mediaIndex: number,
  runtimeName: string
): EditRuntimeMediaIdentityV1
{
  const identity = context.mediaByRuntimeKey.get(
    runtimeMediaKey(targetLineage, mediaIndex, runtimeName)
  )
  if (identity === undefined || identity.mediaKind !== 'costume')
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} selected costume ${targetLineage}/${mediaIndex}/${JSON.stringify(runtimeName)} has 0 exact lineage matches`
    )
  return identity
}

function canonicalDeclarations(
  context: SideContext,
  targetLineage: string,
  collection: 'variables' | 'lists',
  values: Record<string, unknown>
): Record<string, unknown>
{
  const canonical: Record<string, unknown> = {}
  for (const [runtimeDeclarationId, value] of Object.entries(values))
  {
    const identity = declarationIdentity(
      context,
      targetLineage,
      collection,
      runtimeDeclarationId
    )
    const key = declarationKey(identity.declarationLineage)
    if (Object.hasOwn(canonical, key))
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${context.side} declaration projection collides at ${key}`
      )
    canonical[key] = value
  }
  const expectedCount =
    context.declarationCountByCollectionKey.get(
      runtimeDeclarationCollectionKey(targetLineage, collection)
    ) ?? 0
  if (Object.keys(canonical).length !== expectedCount)
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} ${targetLineage}/${collection} observation does not cover the complete declaration facet`
    )
  return canonical
}

function canonicalTargetState(
  context: SideContext,
  target: VmSpriteState,
  identity: EditRuntimeTargetIdentityV1
): VmSpriteState
{
  if (
    target.id !== identity.observationTargetId ||
    target.name !== identity.runtimeTargetName ||
    target.isStage !== identity.isStage
  )
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} runtime target ${target.id} disagrees with its explicit identity facet`
    )
  if (!('editBoundedCostumeIndex' in target))
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} ${identity.targetLineage} selected costume has no tagged runtime index`
    )
  const costumeIndex = observedIdentityInteger(
    (
      target as VmSpriteState & {
        editBoundedCostumeIndex: unknown
      }
    ).editBoundedCostumeIndex,
    `${context.side} ${identity.targetLineage} selected costume index`
  )
  const costume = mediaIdentityBySelection(
    context,
    identity.targetLineage,
    costumeIndex,
    target.costume
  )
  return {
    ...target,
    id: targetKey(identity.targetLineage),
    name: targetKey(identity.targetLineage),
    costume: mediaKey(costume.mediaLineage),
    variables: canonicalDeclarations(
      context,
      identity.targetLineage,
      'variables',
      target.variables
    ) as VmSpriteState['variables'],
    lists: canonicalDeclarations(
      context,
      identity.targetLineage,
      'lists',
      target.lists
    ) as VmSpriteState['lists'],
  }
}

function canonicalizeSnapshot(
  context: SideContext,
  snapshot: VmStateSnapshot
): void
{
  const rawStageState = snapshot.targetsById[snapshot.stageTargetId]
  if (
    Object.keys(snapshot.targetsById).length !== snapshot.targetOrder.length ||
    new Set(snapshot.targetOrder).size !== snapshot.targetOrder.length
  )
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} snapshot ${snapshot.tick} does not contain one record per ordered original target`
    )
  const targetOrder: string[] = []
  const targetsById: Record<string, VmSpriteState> = {}
  const targets: Record<string, VmSpriteState> = {}
  for (const runtimeId of snapshot.targetOrder)
  {
    const identity = context.targetByRuntimeId.get(runtimeId)
    const state = snapshot.targetsById[runtimeId]
    if (!identity || !state)
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${context.side} snapshot ${snapshot.tick} target ${runtimeId} lacks an exact identity or state record`
      )
    const canonical = canonicalTargetState(context, state, identity)
    const key = targetKey(identity.targetLineage)
    if (Object.hasOwn(targetsById, key))
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${context.side} snapshot ${snapshot.tick} target lineage collides at ${key}`
      )
    targetOrder.push(key)
    targetsById[key] = canonical
    targets[key] = canonical
  }
  const stageIdentity = context.targetByRuntimeId.get(snapshot.stageTargetId)
  if (!stageIdentity?.isStage)
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} snapshot ${snapshot.tick} stage has no exact target lineage`
    )
  const expectedOrder = context.facet.paneTargetLineageOrder.map(targetKey)
  if (!arraysEqual(targetOrder, expectedOrder))
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} snapshot ${snapshot.tick} executable order disagrees with the identity facet`
    )
  snapshot.targetOrder = targetOrder
  snapshot.targetsById = targetsById
  snapshot.targets = targets
  snapshot.stageTargetId = targetKey(stageIdentity.targetLineage)
  const stage = targetsById[snapshot.stageTargetId]!
  snapshot.variables = { ...stage.variables }
  snapshot.lists = { ...stage.lists }
  if (
    rawStageState === undefined ||
    snapshot.stage.backdrop !== rawStageState.costume
  )
    throw new ProjectionFailure(
      'identity-facet-mismatch',
      null,
      `${context.side} snapshot ${snapshot.tick} stage backdrop does not match its exact selected costume`
    )
  snapshot.stage.backdrop = stage.costume
  if (snapshot.visual)
  {
    const spriteRects: Record<
      string,
      { x: number; y: number; width: number; height: number } | null
    > = {}
    for (const [runtimeName, rect] of Object.entries(
      snapshot.visual.spriteRects
    ))
    {
      const matches = context.targetsByRuntimeName.get(runtimeName) ?? []
      if (matches.length !== 1)
        throw new ProjectionFailure(
          'identity-facet-mismatch',
          null,
          `${context.side} visual sprite key ${JSON.stringify(runtimeName)} has ${matches.length} exact target matches`
        )
      spriteRects[targetKey(matches[0]!.targetLineage)] = rect
    }
    snapshot.visual.spriteRects = spriteRects
    canonicalizeGeometry(
      context,
      snapshot.visual.geometry,
      `tick ${snapshot.tick}`
    )
  }
}

function canonicalizeGeometry(
  context: SideContext,
  geometry: MediaFrameRefV1['geometry'],
  location: string
): void
{
  if (context.canonicalGeometry.has(geometry)) return
  context.canonicalGeometry.add(geometry)
  const seen = new Set<string>()
  for (const target of geometry.targets)
  {
    const identity = context.targetByGeometryId.get(target.originalTargetId)
    if (
      !identity ||
      identity.runtimeTargetName !== target.name ||
      identity.isStage !== target.isStage
    )
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${context.side} ${location} geometry target ${target.originalTargetId} has no exact identity`
      )
    const costumeIndex = observedIdentityInteger(
      target.costumeIndex,
      `${context.side} ${location} costume index`
    )
    const media = context.mediaByRuntimeKey.get(
      runtimeMediaKey(identity.targetLineage, costumeIndex, target.costumeName)
    )
    if (!media)
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${context.side} ${location} geometry costume has no exact media lineage`
      )
    const instance = `${identity.targetLineage}|${target.instance}|${target.instanceIndex}`
    if (seen.has(instance))
      throw new ProjectionFailure(
        'identity-facet-mismatch',
        null,
        `${context.side} ${location} duplicates geometry instance ${instance}`
      )
    seen.add(instance)
    target.originalTargetId = targetKey(identity.targetLineage)
    target.name = targetKey(identity.targetLineage)
    target.costumeName = mediaKey(media.mediaLineage)
  }
}

function observedIdentityInteger(value: unknown, location: string): number
{
  if (Number.isSafeInteger(value)) return value as number
  if (
    value !== null &&
    typeof value === 'object' &&
    'scalarKind' in value &&
    value.scalarKind === 'number' &&
    'value' in value &&
    value.value !== null &&
    typeof value.value === 'object' &&
    'numberKind' in value.value &&
    value.value.numberKind === 'finite' &&
    'value' in value.value &&
    Number.isSafeInteger(value.value.value)
  )
    return value.value.value as number
  throw new ProjectionFailure(
    'identity-facet-mismatch',
    null,
    `${location} is not one tagged safe integer`
  )
}

function canonicalizeTrace(context: SideContext): void
{
  const seen = new Set<VmStateSnapshot>()
  for (const snapshot of [
    ...context.trace.snapshots,
    ...(context.trace.finalSnapshot ? [context.trace.finalSnapshot] : []),
  ])
  {
    if (seen.has(snapshot)) continue
    seen.add(snapshot)
    canonicalizeSnapshot(context, snapshot)
  }
  for (const sample of context.trace.observations.cloneCounts)
  {
    const canonical: Record<string, number> = {}
    for (const [runtimeId, count] of Object.entries(
      sample.byOriginalTargetId
    ))
    {
      const identity = context.targetByCloneCountId.get(runtimeId)
      if (
        !identity ||
        Object.hasOwn(canonical, targetKey(identity.targetLineage))
      )
        throw new ProjectionFailure(
          'identity-facet-mismatch',
          null,
          `${context.side} clone sample ${sample.tick} cannot map ${runtimeId} exactly once`
        )
      canonical[targetKey(identity.targetLineage)] = count
    }
    sample.byOriginalTargetId = canonical
  }
  for (const frame of context.trace.observations.media?.frames ?? [])
    canonicalizeGeometry(context, frame.geometry, `frame ${frame.id}`)
}

function selectedSnapshots(
  context: SideContext,
  labels: ObservationLabelsV1,
  maskId: string
): VmStateSnapshot[]
{
  if (labels === 'final')
  {
    if (!context.trace.finalSnapshot)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        maskId,
        `${context.side} has no final snapshot for ${maskId}`
      )
    return [context.trace.finalSnapshot]
  }
  if (labels.length === 0 || new Set(labels).size !== labels.length)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      maskId,
      `${maskId} must select nonempty unique labels`
    )
  return labels.map((label) =>
  {
    const matches = context.trace.snapshots.filter(
      (snapshot) => snapshot.label === label
    )
    if (matches.length !== 1)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        maskId,
        `${context.side} label ${JSON.stringify(label)} has ${matches.length} observations`
      )
    return matches[0]!
  })
}

function resolveTarget(work: ProjectionWork, bindingKey: string): string
{
  const lineage = work.targetBindings.get(bindingKey)
  if (!lineage)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      null,
      `target binding ${bindingKey} has no exact lineage`
    )
  return lineage
}

function resolveDeclaration(
  work: ProjectionWork,
  bindingKey: string
): EditProjectionDeclarationBindingV1
{
  const binding = work.declarationBindings.get(bindingKey)
  if (!binding)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      null,
      `declaration binding ${bindingKey} has no exact lineage`
    )
  return binding
}

function authorizationFor(
  work: ProjectionWork,
  targetLineage: string,
  presentSide: 'baseline' | 'candidate',
  maskId: string
): EditTargetMembershipAuthorizationV1
{
  const matches = work.policy.targetMembershipAuthorizations.filter(
    (authorization) =>
      authorization.targetLineage === targetLineage &&
      authorization.presentSide === presentSide
  )
  if (matches.length !== 1)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      maskId,
      `${maskId} requires one exact authorized target add/remove, found ${matches.length}`
    )
  return matches[0]!
}

function validateOneSidedContractRef(
  ref: { readonly contractRefKind: 'existing' | 'future' },
  presentSide: 'baseline' | 'candidate',
  maskId: string
): void
{
  const expected = presentSide === 'candidate' ? 'future' : 'existing'
  if (ref.contractRefKind !== expected)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      maskId,
      `${maskId} requires a ${expected} contract ref on its declared present side`
    )
}

function countValue(record: Record<string, unknown>, key: string): number
{
  return Object.hasOwn(record, key) ? 1 : 0
}

function applyOneSidedTargetMask(
  work: ProjectionWork,
  mask: Extract<StateProjectionMaskV1, { maskKind: 'oneSidedTarget' }>
): number
{
  if (
    mask.expectedTargetMatchesPerObservation !== 1 ||
    mask.expectedTargetPaneOrderMatchesPerObservation !== 1 ||
    mask.expectedExecutableOrderMatchesPerObservation !== 1
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} must require one match on every target identity surface`
    )
  const lineage = resolveTarget(work, mask.target.bindingKey)
  validateOneSidedContractRef(mask.target, mask.side, mask.maskId)
  authorizationFor(work, lineage, mask.side, mask.maskId)
  const present = work[mask.side]
  const absent = work[mask.side === 'baseline' ? 'candidate' : 'baseline']
  const presentSnapshots = selectedSnapshots(present, mask.labels, mask.maskId)
  const absentSnapshots = selectedSnapshots(absent, mask.labels, mask.maskId)
  if (presentSnapshots.length !== absentSnapshots.length)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} selected different observation cardinalities by side`
    )
  const key = targetKey(lineage)
  const presentPaneMatches = present.projectedPaneTargetLineageOrder.filter(
    (value) => value === lineage
  ).length
  const presentExecutableMatches =
    present.projectedExecutableTargetLineageOrder.filter(
      (value) => value === lineage
    ).length
  const absentPaneMatches = absent.projectedPaneTargetLineageOrder.filter(
    (value) => value === lineage
  ).length
  const absentExecutableMatches =
    absent.projectedExecutableTargetLineageOrder.filter(
      (value) => value === lineage
    ).length
  if (
    presentPaneMatches !== 1 ||
    presentExecutableMatches !== 1 ||
    absentPaneMatches !== 0 ||
    absentExecutableMatches !== 0
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} did not match exactly one pane and executable-order member on only ${mask.side}`
    )
  present.projectedPaneTargetLineageOrder =
    present.projectedPaneTargetLineageOrder.filter((value) => value !== lineage)
  present.projectedExecutableTargetLineageOrder =
    present.projectedExecutableTargetLineageOrder.filter(
      (value) => value !== lineage
    )
  for (let index = 0; index < presentSnapshots.length; index++)
  {
    const presentSnapshot = presentSnapshots[index]!
    const absentSnapshot = absentSnapshots[index]!
    const presentTargetMatches = countValue(presentSnapshot.targetsById, key)
    const presentOrderMatches = presentSnapshot.targetOrder.filter(
      (value) => value === key
    ).length
    const absentTargetMatches = countValue(absentSnapshot.targetsById, key)
    const absentOrderMatches = absentSnapshot.targetOrder.filter(
      (value) => value === key
    ).length
    if (
      presentTargetMatches !== 1 ||
      presentOrderMatches !== 1 ||
      absentTargetMatches !== 0 ||
      absentOrderMatches !== 0
    )
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} target/order cardinality mismatch at observation ${index}`
      )
    delete presentSnapshot.targetsById[key]
    delete presentSnapshot.targets[key]
    presentSnapshot.targetOrder = presentSnapshot.targetOrder.filter(
      (value) => value !== key
    )
  }
  return presentSnapshots.length * 3
}

function declarationRecord(
  snapshot: VmStateSnapshot,
  binding: EditProjectionDeclarationBindingV1
): Record<string, unknown> | null
{
  const target = snapshot.targetsById[targetKey(binding.targetLineage)]
  if (!target) return null
  return target[binding.collection] as Record<string, unknown>
}

function applyOneSidedDeclarationMask(
  work: ProjectionWork,
  mask: Extract<StateProjectionMaskV1, { maskKind: 'oneSidedDeclaration' }>
): number
{
  if (mask.expectedMatchesPerObservation !== 1)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} must require one declaration match per observation`
    )
  const binding = resolveDeclaration(work, mask.declaration.bindingKey)
  validateOneSidedContractRef(mask.declaration, mask.side, mask.maskId)
  const present = work[mask.side]
  const absent = work[mask.side === 'baseline' ? 'candidate' : 'baseline']
  const presentSnapshots = selectedSnapshots(present, mask.labels, mask.maskId)
  const absentSnapshots = selectedSnapshots(absent, mask.labels, mask.maskId)
  if (presentSnapshots.length !== absentSnapshots.length)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} selected different observation cardinalities by side`
    )
  const key = declarationKey(binding.declarationLineage)
  for (let index = 0; index < presentSnapshots.length; index++)
  {
    const presentRecord = declarationRecord(presentSnapshots[index]!, binding)
    const absentRecord = declarationRecord(absentSnapshots[index]!, binding)
    const presentMatches = presentRecord ? countValue(presentRecord, key) : 0
    const absentMatches = absentRecord ? countValue(absentRecord, key) : 0
    if (presentMatches !== 1 || absentMatches !== 0)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} declaration cardinality mismatch at observation ${index}`
      )
    delete presentRecord![key]
  }
  return presentSnapshots.length
}

function maskedTargetProperty(
  target: VmSpriteState,
  property: Extract<
    RuntimeStatePathV1,
    { pathKind: 'targetProperty' }
  >['property']
): void
{
  switch (property)
  {
    case 'x':
    case 'y':
    case 'direction':
    case 'size':
    case 'volume':
      target[property] = maskedTaggedNumber()
      return
    case 'visible':
    case 'draggable':
      target[property] = maskedTaggedBoolean()
      return
    case 'costume':
    case 'rotationStyle':
      target[property] = maskedTaggedString()
      return
    case 'effects':
      target.effects = {}
      return
    case 'bubble':
      target.bubble = null
  }
}

function applyStatePathToSnapshot(
  work: ProjectionWork,
  snapshot: VmStateSnapshot,
  path: RuntimeStatePathV1,
  maskId: string
): void
{
  switch (path.pathKind)
  {
    case 'targetProperty':
    {
      const lineage = resolveTarget(work, path.target.bindingKey)
      const target = snapshot.targetsById[targetKey(lineage)]
      if (!target)
        throw new ProjectionFailure(
          'projection-mask-mismatch',
          maskId,
          `${maskId} target path matched zero target records`
        )
      maskedTargetProperty(target, path.property)
      return
    }
    case 'declarationValue':
    case 'declarationList':
    {
      const binding = resolveDeclaration(work, path.declaration.bindingKey)
      const expectedCollection =
        path.pathKind === 'declarationValue' ? 'variables' : 'lists'
      if (binding.collection !== expectedCollection)
        throw new ProjectionFailure(
          'projection-mask-mismatch',
          maskId,
          `${maskId} declaration path collection disagrees with its binding`
        )
      const record = declarationRecord(snapshot, binding)
      const key = declarationKey(binding.declarationLineage)
      if (!record || countValue(record, key) !== 1)
        throw new ProjectionFailure(
          'projection-mask-mismatch',
          maskId,
          `${maskId} declaration path matched zero exact leaves`
        )
      record[key] =
        path.pathKind === 'declarationList' ? [] : maskedTaggedString()
      return
    }
    case 'stageProperty':
      switch (path.property)
      {
        case 'answer':
          snapshot.answer = maskedTaggedString()
          return
        case 'timer':
          snapshot.timer = maskedTaggedNumber()
          return
        case 'backdrop':
          snapshot.stage.backdrop = maskedTaggedString()
          return
        case 'tempo':
          snapshot.stage.tempo = maskedTaggedNumber()
          return
        case 'videoState':
          snapshot.stage.videoState = maskedTaggedString()
      }
  }
}

function applyStatePathMask(
  work: ProjectionWork,
  mask: Extract<StateProjectionMaskV1, { maskKind: 'statePath' }>
): number
{
  if (mask.expectedMatchesPerObservation !== 1)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} must require one state-path match per observation`
    )
  const baseline = selectedSnapshots(work.baseline, mask.labels, mask.maskId)
  const candidate = selectedSnapshots(work.candidate, mask.labels, mask.maskId)
  if (baseline.length !== candidate.length)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} selected different observation cardinalities by side`
    )
  for (const snapshot of [...baseline, ...candidate])
    applyStatePathToSnapshot(work, snapshot, mask.path, mask.maskId)
  return baseline.length * 2
}

function applyStateMasks(work: ProjectionWork): void
{
  for (const mask of work.policy.stateMasks)
  {
    if (mask.scenarioId !== work.policy.scenarioId)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} belongs to scenario ${mask.scenarioId}, not ${work.policy.scenarioId}`
      )
    const exactMatchCount =
      mask.maskKind === 'oneSidedTarget'
        ? applyOneSidedTargetMask(work, mask)
        : mask.maskKind === 'oneSidedDeclaration'
          ? applyOneSidedDeclarationMask(work, mask)
          : applyStatePathMask(work, mask)
    work.appliedMasks.push({
      maskId: mask.maskId,
      maskKind: mask.maskKind,
      exactMatchCount,
    })
  }
}

function orderedCloneSamples(
  context: SideContext,
  maskId: string
): readonly {
  readonly tick: number
  readonly sample: (typeof context.trace.observations.cloneCounts)[number]
}[]
{
  const samples = [...context.trace.observations.cloneCounts].sort(
    (left, right) => left.tick - right.tick
  )
  if (
    samples.some(
      (sample, index) => index > 0 && sample.tick === samples[index - 1]!.tick
    )
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      maskId,
      `${context.side} clone trace has duplicate ticks`
    )
  return samples.map((sample) => ({ tick: sample.tick, sample }))
}

function cloneSeries(
  context: SideContext,
  targetLineage: string,
  maskId: string
): {
  readonly samples: ReturnType<typeof orderedCloneSamples>
  readonly ticksSha256: string
  readonly seriesSha256: string
}
{
  const samples = orderedCloneSamples(context, maskId)
  const key = targetKey(targetLineage)
  const series = samples.map(({ tick, sample }) => ({
    tick,
    count: observedCloneCount(sample.byOriginalTargetId[key] ?? 0, maskId),
  }))
  return {
    samples,
    ticksSha256: editCloneTickSetSha256V1(series.map((row) => row.tick)),
    seriesSha256: editCloneCountSeriesSha256V1(series),
  }
}

function observedCloneCount(value: unknown, maskId: string): number
{
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    return value
  if (
    value !== null &&
    typeof value === 'object' &&
    'scalarKind' in value &&
    value.scalarKind === 'number' &&
    'value' in value &&
    value.value !== null &&
    typeof value.value === 'object' &&
    'numberKind' in value.value &&
    value.value.numberKind === 'finite' &&
    'value' in value.value &&
    typeof value.value.value === 'number' &&
    Number.isSafeInteger(value.value.value) &&
    value.value.value >= 0
  )
    return value.value.value
  throw new ProjectionFailure(
    'projection-mask-mismatch',
    maskId,
    `${maskId} observed a non-finite or invalid tagged clone count`
  )
}

function taggedCloneCount(value: number): number
{
  return {
    scalarKind: 'number',
    value: { numberKind: 'finite', value },
  } as unknown as number
}

function removeCloneContribution(
  samples: ReturnType<typeof orderedCloneSamples>,
  targetLineage: string,
  retainSentinel: boolean,
  maskId: string
): void
{
  const key = targetKey(targetLineage)
  for (const { sample } of samples)
  {
    const count = observedCloneCount(
      sample.byOriginalTargetId[key] ?? 0,
      maskId
    )
    const total = observedCloneCount(sample.total, maskId)
    if (total < count)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        maskId,
        `${maskId} observed an invalid clone count contribution`
      )
    sample.total = taggedCloneCount(total - count)
    if (retainSentinel) sample.byOriginalTargetId[key] = taggedCloneCount(0)
    else delete sample.byOriginalTargetId[key]
  }
}

function applyOneSidedCloneMask(
  work: ProjectionWork,
  mask: Extract<
    CloneProjectionMaskV1,
    { maskKind: 'oneSidedTargetCloneSeries' }
  >
): number
{
  const lineage = resolveTarget(work, mask.target.bindingKey)
  validateOneSidedContractRef(mask.target, mask.side, mask.maskId)
  authorizationFor(work, lineage, mask.side, mask.maskId)
  const present = work[mask.side]
  const absent = work[mask.side === 'baseline' ? 'candidate' : 'baseline']
  const presentSeries = cloneSeries(present, lineage, mask.maskId)
  const absentSeries = cloneSeries(absent, lineage, mask.maskId)
  if (
    presentSeries.ticksSha256 !== mask.expectedTickSetSha256 ||
    presentSeries.seriesSha256 !== mask.expectedCloneCountSeriesSha256 ||
    absentSeries.ticksSha256 !== mask.expectedTickSetSha256 ||
    presentSeries.samples.some(
      ({ sample }) =>
        !Object.hasOwn(sample.byOriginalTargetId, targetKey(lineage))
    ) ||
    absentSeries.samples.some(({ sample }) =>
      Object.hasOwn(sample.byOriginalTargetId, targetKey(lineage))
    )
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} did not match the complete one-sided tick/count series`
    )
  removeCloneContribution(presentSeries.samples, lineage, false, mask.maskId)
  return presentSeries.samples.length
}

function applyCloneTransitionMask(
  work: ProjectionWork,
  mask: Extract<
    CloneProjectionMaskV1,
    { maskKind: 'targetCloneCountTransition' }
  >
): number
{
  const lineage = resolveTarget(work, mask.target.bindingKey)
  if (
    !work.baseline.targetByLineage.has(lineage) ||
    !work.candidate.targetByLineage.has(lineage)
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} requires one existing target live on both sides`
    )
  const baseline = cloneSeries(work.baseline, lineage, mask.maskId)
  const candidate = cloneSeries(work.candidate, lineage, mask.maskId)
  if (
    baseline.ticksSha256 !== mask.expectedTickSetSha256 ||
    candidate.ticksSha256 !== mask.expectedTickSetSha256 ||
    baseline.seriesSha256 !== mask.expectedBaselineCloneCountSeriesSha256 ||
    candidate.seriesSha256 !== mask.expectedCandidateCloneCountSeriesSha256
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} did not match both complete clone-count series at one exact tick set`
    )
  if (
    [...baseline.samples, ...candidate.samples].some(
      ({ sample }) =>
        !Object.hasOwn(sample.byOriginalTargetId, targetKey(lineage))
    )
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} target clone series is absent from at least one tick`
    )
  removeCloneContribution(baseline.samples, lineage, true, mask.maskId)
  removeCloneContribution(candidate.samples, lineage, true, mask.maskId)
  return baseline.samples.length + candidate.samples.length
}

function applyCloneMasks(work: ProjectionWork): void
{
  const maskedTargets = new Set<string>()
  for (const mask of work.policy.cloneMasks)
  {
    if (mask.scenarioId !== work.policy.scenarioId)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} belongs to scenario ${mask.scenarioId}, not ${work.policy.scenarioId}`
      )
    const lineage = resolveTarget(work, mask.target.bindingKey)
    if (maskedTargets.has(lineage))
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${lineage} cannot be covered by overlapping clone masks`
      )
    maskedTargets.add(lineage)
    const exactMatchCount =
      mask.maskKind === 'oneSidedTargetCloneSeries'
        ? applyOneSidedCloneMask(work, mask)
        : applyCloneTransitionMask(work, mask)
    work.appliedMasks.push({
      maskId: mask.maskId,
      maskKind: mask.maskKind,
      exactMatchCount,
    })
  }
}

function frameById(
  context: SideContext,
  frameId: string,
  maskId: string
): MediaFrameRefV1
{
  const matches = (context.trace.observations.media?.frames ?? []).filter(
    (frame) => frame.id === frameId
  )
  if (matches.length !== 1)
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      maskId,
      `${context.side} frame ${frameId} has ${matches.length} exact matches`
    )
  return matches[0]!
}

function targetGeometryRows(
  frame: MediaFrameRefV1,
  targetLineage: string
): MediaFrameRefV1['geometry']['targets']
{
  const key = targetKey(targetLineage)
  return frame.geometry.targets.filter(
    (target) => target.originalTargetId === key
  )
}

function geometrySetSha256(
  rows: MediaFrameRefV1['geometry']['targets'],
  targetLineage: string
): string
{
  return editGeometryInstanceSetSha256V1(
    rows.map((row) => ({
      targetLineage,
      instance: row.instance,
      instanceIndex: row.instanceIndex,
    }))
  )
}

function applyOneSidedGeometryMask(
  work: ProjectionWork,
  mask: Extract<
    VisualProjectionMaskV1,
    { maskKind: 'oneSidedTargetGeometrySet' }
  >
): number
{
  const lineage = resolveTarget(work, mask.target.bindingKey)
  validateOneSidedContractRef(mask.target, mask.side, mask.maskId)
  authorizationFor(work, lineage, mask.side, mask.maskId)
  if (
    mask.frames.length === 0 ||
    new Set(mask.frames.map((frame) => frame.frameId)).size !==
      mask.frames.length
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} must declare nonempty unique frames`
    )
  const present = work[mask.side]
  const absent = work[mask.side === 'baseline' ? 'candidate' : 'baseline']
  let matches = 0
  for (const expected of mask.frames)
  {
    if (
      expected.expectedOriginalMatches !== 1 ||
      !Number.isSafeInteger(expected.expectedCloneCount) ||
      expected.expectedCloneCount < 0
    )
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} has invalid geometry cardinalities in ${expected.frameId}`
      )
    const frame = frameById(present, expected.frameId, mask.maskId)
    const absentFrame = frameById(absent, expected.frameId, mask.maskId)
    const rows = targetGeometryRows(frame, lineage)
    const absentRows = targetGeometryRows(absentFrame, lineage)
    const originals = rows.filter((row) => row.instance === 'original')
    const clones = rows.filter((row) => row.instance === 'clone')
    if (
      originals.length !== expected.expectedOriginalMatches ||
      clones.length !== expected.expectedCloneCount ||
      absentRows.length !== 0 ||
      geometrySetSha256(rows, lineage) !== expected.expectedInstanceSetSha256
    )
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} geometry set/cardinality mismatch in ${expected.frameId}`
      )
    frame.geometry.targets = frame.geometry.targets.filter(
      (row) => row.originalTargetId !== targetKey(lineage)
    )
    matches += rows.length
  }
  return matches
}

function maskGeometryProperty(
  row: MediaFrameRefV1['geometry']['targets'][number],
  property: Extract<
    VisualProjectionMaskV1,
    { maskKind: 'targetGeometryProperty' }
  >['property']
): void
{
  switch (property)
  {
    case 'targetName':
      row.name = MASKED_STRING
      return
    case 'visible':
      row.visible = maskedTaggedBoolean()
      return
    case 'costumeIndex':
      row.costumeIndex = maskedTaggedNumber()
      return
    case 'costumeName':
      row.costumeName = MASKED_STRING
      return
    case 'rect':
      row.rect = null
  }
}

function applyGeometryPropertyMask(
  work: ProjectionWork,
  mask: Extract<VisualProjectionMaskV1, { maskKind: 'targetGeometryProperty' }>
): number
{
  const lineage = resolveTarget(work, mask.target.bindingKey)
  if (
    mask.frames.length === 0 ||
    new Set(mask.frames.map((frame) => frame.frameId)).size !==
      mask.frames.length
  )
    throw new ProjectionFailure(
      'projection-mask-mismatch',
      mask.maskId,
      `${mask.maskId} must declare nonempty unique frames`
    )
  let matches = 0
  for (const expected of mask.frames)
  {
    if (
      !Number.isSafeInteger(expected.expectedMatchCount) ||
      expected.expectedMatchCount < 1
    )
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} has invalid geometry match count in ${expected.frameId}`
      )
    for (const context of [work.baseline, work.candidate])
    {
      const frame = frameById(context, expected.frameId, mask.maskId)
      const rows = targetGeometryRows(frame, lineage)
      if (
        rows.length !== expected.expectedMatchCount ||
        geometrySetSha256(rows, lineage) !== expected.expectedInstanceSetSha256
      )
        throw new ProjectionFailure(
          'projection-mask-mismatch',
          mask.maskId,
          `${mask.maskId} geometry property set/cardinality mismatch on ${context.side}/${expected.frameId}`
        )
      for (const row of rows) maskGeometryProperty(row, mask.property)
      matches += rows.length
    }
  }
  return matches
}

function normalizedRegionValid(region: NormalizedRegionV1): boolean
{
  return (
    [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= 1 &&
    region.y + region.height <= 1
  )
}

function pixelMaskFor(
  width: number,
  height: number,
  regions: readonly NormalizedRegionV1[]
): Uint8Array
{
  const masked = new Uint8Array(width * height)
  for (const region of regions)
  {
    const firstX = Math.floor(region.x * width)
    const firstY = Math.floor(region.y * height)
    const lastX = Math.ceil((region.x + region.width) * width)
    const lastY = Math.ceil((region.y + region.height) * height)
    for (let y = firstY; y < lastY; y++)
      for (let x = firstX; x < lastX; x++) masked[y * width + x] = 1
  }
  return masked
}

function projectedPixelMetrics(
  frame: MediaFrameRefV1,
  pixels: EditDecodedPixelFrameV1,
  masked: Uint8Array
): {
  readonly maskedPixelCount: number
  readonly unmaskedPixelCount: number
  readonly complementSha256: string
}
{
  const columns = frame.sampledMeanRgb.columns
  const rows = frame.sampledMeanRgb.rows
  const cells = columns * rows
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    frame.sampledMeanRgb.values.length !== cells * 3
  )
    throw new ProjectionFailure(
      'pixel-facet-mismatch',
      null,
      `frame ${frame.id} has invalid sampled RGB grid dimensions`
    )
  const sums = [0, 0, 0]
  const cellSums = new Float64Array(cells * 3)
  const cellCounts = new Uint32Array(cells)
  const complementHash = createHash('sha256')
  complementHash.update('edit-pixel-complement-v1\0')
  complementHash.update(`${pixels.width}x${pixels.height}\0`)
  let maskedPixelCount = 0
  let unmaskedPixelCount = 0
  const identity = Buffer.allocUnsafe(8)
  for (let y = 0; y < pixels.height; y++)
    for (let x = 0; x < pixels.width; x++)
    {
      const pixelIndex = y * pixels.width + x
      if (masked[pixelIndex])
      {
        maskedPixelCount++
        continue
      }
      unmaskedPixelCount++
      const rgbaIndex = pixelIndex * 4
      const red = pixels.rgba[rgbaIndex]!
      const green = pixels.rgba[rgbaIndex + 1]!
      const blue = pixels.rgba[rgbaIndex + 2]!
      sums[0]! += red
      sums[1]! += green
      sums[2]! += blue
      const cellX = Math.min(
        columns - 1,
        Math.floor(x / (pixels.width / columns))
      )
      const cellY = Math.min(rows - 1, Math.floor(y / (pixels.height / rows)))
      const cell = cellY * columns + cellX
      cellSums[cell * 3]! += red
      cellSums[cell * 3 + 1]! += green
      cellSums[cell * 3 + 2]! += blue
      cellCounts[cell]!++
      identity.writeUInt32BE(pixelIndex, 0)
      identity[4] = red
      identity[5] = green
      identity[6] = blue
      identity[7] = pixels.rgba[rgbaIndex + 3]!
      complementHash.update(identity)
    }
  if (unmaskedPixelCount === 0)
    throw new ProjectionFailure(
      'pixel-facet-mismatch',
      null,
      `frame ${frame.id} pixel masks leave no comparison complement`
    )
  frame.meanRgb = [
    sums[0]! / unmaskedPixelCount,
    sums[1]! / unmaskedPixelCount,
    sums[2]! / unmaskedPixelCount,
  ]
  const values = new Array<number>(cells * 3).fill(0)
  for (let cell = 0; cell < cells; cell++)
  {
    const count = cellCounts[cell] || 1
    values[cell * 3] = Math.round(cellSums[cell * 3]! / count)
    values[cell * 3 + 1] = Math.round(cellSums[cell * 3 + 1]! / count)
    values[cell * 3 + 2] = Math.round(cellSums[cell * 3 + 2]! / count)
  }
  frame.sampledMeanRgb.values = values
  return {
    maskedPixelCount,
    unmaskedPixelCount,
    complementSha256: complementHash.digest('hex'),
  }
}

function applyPixelMasks(
  work: ProjectionWork,
  masks: readonly Extract<VisualProjectionMaskV1, { maskKind: 'pixelRegion' }>[]
): void
{
  const regionsByFrame = new Map<string, NormalizedRegionV1[]>()
  for (const mask of masks)
  {
    if (
      mask.frameIds.length === 0 ||
      new Set(mask.frameIds).size !== mask.frameIds.length ||
      !normalizedRegionValid(mask.normalizedRegion) ||
      !Number.isFinite(mask.maxMaskedAreaFraction) ||
      mask.maxMaskedAreaFraction <= 0 ||
      mask.maxMaskedAreaFraction >= 1 ||
      mask.normalizedRegion.width * mask.normalizedRegion.height >
        mask.maxMaskedAreaFraction
    )
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} has invalid frames, region, or masked-area bound`
      )
    for (const frameId of mask.frameIds)
    {
      const regions = regionsByFrame.get(frameId) ?? []
      regions.push(mask.normalizedRegion)
      regionsByFrame.set(frameId, regions)
    }
    work.appliedMasks.push({
      maskId: mask.maskId,
      maskKind: mask.maskKind,
      exactMatchCount: mask.frameIds.length * 2,
    })
  }
  if (work.policy.lens.lensKind === 'visualKeyframes')
  {
    const baselineFrames = new Set(
      work.baseline.trace.observations.media?.frames.map((frame) => frame.id) ??
        []
    )
    const candidateFrames = new Set(
      work.candidate.trace.observations.media?.frames.map(
        (frame) => frame.id
      ) ?? []
    )
    if (
      baselineFrames.size === 0 ||
      baselineFrames.size !== candidateFrames.size ||
      [...baselineFrames].some(
        (frameId) =>
          !candidateFrames.has(frameId) ||
          !work.baseline.pixelByFrameId.has(frameId) ||
          !work.candidate.pixelByFrameId.has(frameId)
      )
    )
      throw new ProjectionFailure(
        'pixel-facet-mismatch',
        null,
        'baseline and candidate decoded pixel frame sets differ'
      )
    for (const frameId of baselineFrames)
      if (!regionsByFrame.has(frameId)) regionsByFrame.set(frameId, [])
  }
  for (const [frameId, regions] of regionsByFrame)
    for (const context of [work.baseline, work.candidate])
    {
      const frame = frameById(
        context,
        frameId,
        masks.find((mask) => mask.frameIds.includes(frameId))?.maskId ??
          'decoded-pixels'
      )
      const pixels = context.pixelByFrameId.get(frameId)
      if (
        !pixels ||
        pixels.sourceFrameSha256 !== frame.sha256 ||
        pixels.width !== frame.width ||
        pixels.height !== frame.height ||
        pixels.rgba.byteLength !== frame.width * frame.height * 4 ||
        pixels.rgbaSha256 !== editDecodedRgbaSha256V1(pixels)
      )
        throw new ProjectionFailure(
          'pixel-facet-mismatch',
          null,
          `${context.side} frame ${frameId} lacks exact hash-bound decoded RGBA pixels`
        )
      const retainedMeanRgb = [...frame.meanRgb]
      const retainedSampledMeanRgb = [...frame.sampledMeanRgb.values]
      projectedPixelMetrics(
        frame,
        pixels,
        new Uint8Array(frame.width * frame.height)
      )
      if (
        retainedMeanRgb.some(
          (value, index) => Math.abs(value - frame.meanRgb[index]!) > 1e-9
        ) ||
        retainedSampledMeanRgb.some(
          (value, index) => value !== frame.sampledMeanRgb.values[index]
        )
      )
        throw new ProjectionFailure(
          'pixel-facet-mismatch',
          null,
          `${context.side} decoded RGBA pixels do not reproduce retained frame ${frameId}`
        )
      const projected = projectedPixelMetrics(
        frame,
        pixels,
        pixelMaskFor(frame.width, frame.height, regions)
      )
      work.pixelComplements.push({
        side: context.side,
        frameId,
        ...projected,
      })
    }
}

function applyVisualMasks(work: ProjectionWork): void
{
  const pixelMasks: Extract<
    VisualProjectionMaskV1,
    { maskKind: 'pixelRegion' }
  >[] = []
  for (const mask of work.policy.visualMasks)
  {
    if (mask.scenarioId !== work.policy.scenarioId)
      throw new ProjectionFailure(
        'projection-mask-mismatch',
        mask.maskId,
        `${mask.maskId} belongs to scenario ${mask.scenarioId}, not ${work.policy.scenarioId}`
      )
    if (mask.maskKind === 'pixelRegion')
    {
      pixelMasks.push(mask)
      continue
    }
    const exactMatchCount =
      mask.maskKind === 'oneSidedTargetGeometrySet'
        ? applyOneSidedGeometryMask(work, mask)
        : applyGeometryPropertyMask(work, mask)
    work.appliedMasks.push({
      maskId: mask.maskId,
      maskKind: mask.maskKind,
      exactMatchCount,
    })
  }
  if (pixelMasks.length > 0 || work.policy.lens.lensKind === 'visualKeyframes')
    applyPixelMasks(work, pixelMasks)
}

function projectionHashInput(
  input: EditRuntimeProjectionInputV1,
  work: ProjectionWork
): unknown
{
  const facet = (value: EditRuntimeIdentityFacetV1): unknown => ({
    artifactSha256: value.artifactSha256,
    manifestSha256: value.manifestSha256,
    targets: value.targets,
    declarations: value.declarations,
    media: value.media,
    paneTargetLineageOrder: value.paneTargetLineageOrder,
    executableTargetLineageOrder: value.executableTargetLineageOrder,
    decodedPixelFrames: value.decodedPixelFrames.map((frame) => ({
      frameId: frame.frameId,
      sourceFrameSha256: frame.sourceFrameSha256,
      width: frame.width,
      height: frame.height,
      rgbaSha256: frame.rgbaSha256,
    })),
    runtimeObservations: value.runtimeObservations,
  })
  return {
    engineVersion: EDIT_PROJECTION_MASK_ENGINE_VERSION,
    policy: input.policy,
    baseline: facet(input.baseline),
    candidate: facet(input.candidate),
    appliedMasks: work.appliedMasks,
    pixelComplements: work.pixelComplements,
    projectedOrders: {
      baseline: {
        paneTargetLineageOrder: work.baseline.projectedPaneTargetLineageOrder,
        executableTargetLineageOrder:
          work.baseline.projectedExecutableTargetLineageOrder,
      },
      candidate: {
        paneTargetLineageOrder: work.candidate.projectedPaneTargetLineageOrder,
        executableTargetLineageOrder:
          work.candidate.projectedExecutableTargetLineageOrder,
      },
    },
  }
}

export function projectEditRuntimeTracesV1(input: {
  readonly baselineTrace: BehavioralTrace
  readonly candidateTrace: BehavioralTrace
  readonly baselineArtifactSha256: string
  readonly candidateArtifactSha256: string
  readonly baselineManifestSha256: string
  readonly candidateManifestSha256: string
  readonly projection: EditRuntimeProjectionInputV1
  readonly specs: readonly BehavioralLensSpecV1[]
}): EditRuntimeProjectionResultV1
{
  try
  {
    const observationIdOrder = (
      facet: EditRuntimeIdentityFacetV1
    ): readonly string[] =>
      facet.paneTargetLineageOrder.map((lineage) =>
      {
        const matches = facet.targets.filter(
          (target) => target.targetLineage === lineage
        )
        if (matches.length !== 1)
          throw new ProjectionFailure(
            'identity-facet-mismatch',
            null,
            `executable lineage ${lineage} has ${matches.length} exact target identities`
          )
        return matches[0]!.observationTargetId
      })
    const proofTrace = (
      side: 'baseline' | 'candidate',
      trace: BehavioralTrace,
      facet: EditRuntimeIdentityFacetV1
    ): BehavioralTrace =>
    {
      const proof = buildBoundedEditProofTraceV1({
        trace,
        records: facet.runtimeObservations,
        targets: facet.targets.map((target) => ({
          observationTargetId: target.observationTargetId,
          runtimeTargetName: target.runtimeTargetName,
          isStage: target.isStage,
          declarations: facet.declarations
            .filter(
              (declaration) =>
                declaration.targetLineage === target.targetLineage
            )
            .map((declaration) => ({
              runtimeDeclarationId: declaration.runtimeDeclarationId,
              runtimeName: declaration.runtimeName,
              collection: declaration.collection,
            })),
        })),
        paneTargetObservationIdOrder: observationIdOrder(facet),
        specs: input.specs,
        decodedPixelFrameIds: facet.decodedPixelFrames.map(
          (frame) => frame.frameId
        ),
      })
      if (proof.status === 'inconclusive')
        throw new ProjectionFailure(
          proof.reason,
          null,
          `${side}: ${proof.detail}`
        )
      return proof.trace
    }
    const baselineTrace = proofTrace(
      'baseline',
      input.baselineTrace,
      input.projection.baseline
    )
    const candidateTrace = proofTrace(
      'candidate',
      input.candidateTrace,
      input.projection.candidate
    )
    const baseline = createSideContext(
      'baseline',
      baselineTrace,
      input.projection.baseline,
      input.baselineArtifactSha256,
      input.baselineManifestSha256
    )
    const candidate = createSideContext(
      'candidate',
      candidateTrace,
      input.projection.candidate,
      input.candidateArtifactSha256,
      input.candidateManifestSha256
    )
    const policy = selectProjectionPolicy(input.projection.policy)
    const bindings = validateBindings(policy)
    const work: ProjectionWork = {
      baseline,
      candidate,
      policy,
      targetBindings: bindings.targets,
      declarationBindings: bindings.declarations,
      appliedMasks: [],
      pixelComplements: [],
    }
    validateNameTransitions(baseline, candidate, policy.nameTransitions)
    validateMembershipAuthorizations(work)
    canonicalizeTrace(baseline)
    canonicalizeTrace(candidate)
    applyStateMasks(work)
    applyCloneMasks(work)
    applyVisualMasks(work)
    const projectionSha256 = editRuntimeHashV1(
      'edit-runtime-projection-evidence-v1',
      projectionHashInput(input.projection, work)
    )
    return {
      status: 'projected',
      baseline: baseline.trace,
      candidate: candidate.trace,
      evidence: Object.freeze({
        engineVersion: EDIT_PROJECTION_MASK_ENGINE_VERSION,
        projectionSha256,
        appliedMasks: Object.freeze([...work.appliedMasks]),
        pixelComplements: Object.freeze([...work.pixelComplements]),
        projectedOrders: Object.freeze({
          baseline: Object.freeze({
            paneTargetLineageOrder: Object.freeze([
              ...work.baseline.projectedPaneTargetLineageOrder,
            ]),
            executableTargetLineageOrder: Object.freeze([
              ...work.baseline.projectedExecutableTargetLineageOrder,
            ]),
          }),
          candidate: Object.freeze({
            paneTargetLineageOrder: Object.freeze([
              ...work.candidate.projectedPaneTargetLineageOrder,
            ]),
            executableTargetLineageOrder: Object.freeze([
              ...work.candidate.projectedExecutableTargetLineageOrder,
            ]),
          }),
        }),
      }),
    }
  }
  catch (error)
  {
    if (error instanceof ProjectionFailure)
      return Object.freeze({
        status: 'inconclusive' as const,
        reason: error.reason,
        maskId: error.maskId,
        detail: error.message,
      })
    throw error
  }
}
