// packages/eval/src/edit-evaluation/edit-bounded-observation.ts
// complete tagged runtime records -> legacy-shaped proof traces for edit-only comparison

import { hashRunnerJson } from '@scratch-agent/runner'
import type {
  BrowserRuntimeObservationV1,
  ObservedRuntimeExecutionObservationV1,
  ObservedRuntimeScalarV1,
  ObservedRuntimeValueV1,
  RuntimeObservationRecordV1,
  MediaFrameRefV1,
  VmSpriteState,
  VmStateSnapshot,
} from '@scratch-agent/runner'

import type { BehavioralLensSpecV1 } from '../multimodal/lenses.js'
import type { BehavioralTrace } from '../multimodal/differential.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

export type EditBoundedRuntimeObservationV1 =
  ObservedRuntimeExecutionObservationV1 | BrowserRuntimeObservationV1

interface EditBoundedTargetIdentityV1
{
  readonly observationTargetId: string
  readonly runtimeTargetName: string
  readonly isStage: boolean
  readonly declarations: readonly {
    readonly runtimeDeclarationId: string
    readonly runtimeName: string
    readonly collection: 'variables' | 'lists'
  }[]
}

type EditBoundedProofTraceResultV1 =
  | { readonly status: 'complete'; readonly trace: BehavioralTrace }
  | {
      readonly status: 'inconclusive'
      readonly reason:
        | 'bounded-observation-refused'
        | 'bounded-observation-incomplete'
        | 'bounded-observation-invalid'
      readonly detail: string
    }

interface TaggedTargetProjectionV1 extends VmSpriteState
{
  editBoundedCostumeIndex: ObservedRuntimeScalarV1
}

interface TaggedSnapshotProjectionV1 extends VmStateSnapshot
{
  editBoundedSupplemental: ObservedRuntimeValueV1 | null
}

function inconclusive(
  reason: Extract<
    EditBoundedProofTraceResultV1,
    { status: 'inconclusive' }
  >['reason'],
  detail: string
): EditBoundedProofTraceResultV1
{
  return Object.freeze({ status: 'inconclusive' as const, reason, detail })
}

function scalarString(
  value: ObservedRuntimeScalarV1,
  location: string
): string
{
  if (value.scalarKind !== 'string')
    throw new Error(`${location} is not one tagged string`)
  return value.value
}

function scalarBoolean(
  value: ObservedRuntimeScalarV1,
  location: string
): boolean
{
  if (value.scalarKind !== 'boolean')
    throw new Error(`${location} is not one tagged boolean`)
  return value.value
}

function declarationIdentity(
  target: EditBoundedTargetIdentityV1,
  runtimeDeclarationId: string,
  collection: 'variables' | 'lists'
): EditBoundedTargetIdentityV1['declarations'][number]
{
  const matches = target.declarations.filter(
    (declaration) =>
      declaration.runtimeDeclarationId === runtimeDeclarationId &&
      declaration.collection === collection
  )
  if (matches.length !== 1)
    throw new Error(
      `${target.observationTargetId}/${collection}/${runtimeDeclarationId} has ${matches.length} exact declaration identities`
    )
  return matches[0]!
}

function targetProjection(
  value: ObservedRuntimeExecutionObservationV1['state']['targetsById'][string],
  identity: EditBoundedTargetIdentityV1
): TaggedTargetProjectionV1
{
  const runtimeName = scalarString(value.name, `${value.id}/name`)
  const isStage = scalarBoolean(value.isStage, `${value.id}/isStage`)
  if (
    value.id !== identity.observationTargetId ||
    runtimeName !== identity.runtimeTargetName ||
    isStage !== identity.isStage
  )
    throw new Error(
      `${value.id} disagrees with its exact runtime identity facet`
    )
  const variables: Record<string, unknown> = {}
  for (const [runtimeDeclarationId, declaration] of Object.entries(
    value.variables
  ))
  {
    const facet = declarationIdentity(
      identity,
      runtimeDeclarationId,
      'variables'
    )
    const name = scalarString(
      declaration.name,
      `${value.id}/variables/${runtimeDeclarationId}/name`
    )
    if (
      name !== facet.runtimeName ||
      Object.hasOwn(variables, runtimeDeclarationId)
    )
      throw new Error(
        `${value.id}/variables/${runtimeDeclarationId} has an ambiguous runtime name`
      )
    variables[runtimeDeclarationId] = declaration.value
  }
  const lists: Record<string, unknown> = {}
  for (const [runtimeDeclarationId, declaration] of Object.entries(
    value.lists
  ))
  {
    const facet = declarationIdentity(identity, runtimeDeclarationId, 'lists')
    const name = scalarString(
      declaration.name,
      `${value.id}/lists/${runtimeDeclarationId}/name`
    )
    if (
      name !== facet.runtimeName ||
      Object.hasOwn(lists, runtimeDeclarationId)
    )
      throw new Error(
        `${value.id}/lists/${runtimeDeclarationId} has an ambiguous runtime name`
      )
    lists[runtimeDeclarationId] = declaration.items
  }
  if (
    Object.keys(variables).length !==
      identity.declarations.filter(
        (declaration) => declaration.collection === 'variables'
      ).length ||
    Object.keys(lists).length !==
      identity.declarations.filter(
        (declaration) => declaration.collection === 'lists'
      ).length
  )
    throw new Error(`${value.id} does not cover its complete declaration facet`)
  return {
    id: value.id,
    name: runtimeName,
    isStage,
    x: value.x as unknown as number,
    y: value.y as unknown as number,
    direction: value.direction as unknown as number,
    costume: scalarString(value.costume, `${value.id}/costume`),
    visible: value.visible as unknown as boolean,
    size: value.size as unknown as number,
    rotationStyle: value.rotationStyle as unknown as string,
    draggable: value.draggable as unknown as boolean,
    volume: value.volume as unknown as number,
    effects: value.effects as unknown as Record<string, number>,
    bubble: value.bubble as unknown as VmSpriteState['bubble'],
    variables: variables as VmSpriteState['variables'],
    lists: lists as VmSpriteState['lists'],
    editBoundedCostumeIndex: value.costumeIndex,
  }
}

function snapshotProjection(
  record: RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>,
  targets: ReadonlyMap<string, EditBoundedTargetIdentityV1>,
  paneTargetIds: readonly string[]
): TaggedSnapshotProjectionV1
{
  if (record.capture.status !== 'observed')
    throw new Error('a refused record reached bounded snapshot projection')
  const observation = record.capture.value
  const state = observation.state
  const stateLabel =
    record.label === null && state.label === '' ? null : (state.label ?? null)
  if (
    state.tick !== record.tick ||
    stateLabel !== record.label ||
    new Set(state.targetOrder).size !== state.targetOrder.length ||
    state.targetOrder.length !== Object.keys(state.targetsById).length ||
    state.targetOrder.length !== targets.size ||
    state.targetOrder.some((id, index) => id !== paneTargetIds[index])
  )
    throw new Error(
      `record ${record.tick}/${record.label ?? 'final'} has incomplete or inconsistent target identity`
    )
  const targetsById: Record<string, VmSpriteState> = {}
  for (const id of state.targetOrder)
  {
    const identity = targets.get(id)
    const value = state.targetsById[id]
    if (!identity || !value)
      throw new Error(`record ${record.tick} target ${id} is not exactly bound`)
    targetsById[id] = targetProjection(value, identity)
  }
  const stageIdentity = targets.get(state.stageTargetId)
  if (!stageIdentity?.isStage)
    throw new Error(`record ${record.tick} has no exact stage identity`)
  const stage = targetsById[state.stageTargetId]!
  const snapshot: TaggedSnapshotProjectionV1 = {
    tick: record.tick,
    targetOrder: [...state.targetOrder],
    targetsById,
    stageTargetId: state.stageTargetId,
    targets: { ...targetsById },
    variables: { ...stage.variables },
    lists: { ...stage.lists },
    answer: state.answer as unknown as string,
    timer: state.timer as unknown as number,
    stage: {
      backdrop: scalarString(state.stage.backdrop, 'stage/backdrop'),
      tempo: state.stage.tempo as unknown as number,
      videoState: state.stage.videoState as unknown as string,
    },
    editBoundedSupplemental: observation.supplemental,
  }
  if (record.label !== null) snapshot.label = record.label
  return snapshot
}

function scalarRecord(
  value: ObservedRuntimeValueV1,
  location: string
): Readonly<Record<string, ObservedRuntimeValueV1>>
{
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    throw new Error(`${location} is not one tagged record`)
  if ('scalarKind' in value)
    throw new Error(`${location} is not one tagged record`)
  return value as Readonly<Record<string, ObservedRuntimeValueV1>>
}

function cloneProjection(
  record: RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>
): BehavioralTrace['observations']['cloneCounts'][number]
{
  if (record.capture.status !== 'observed')
    throw new Error('a refused record reached bounded clone projection')
  const cloneCounts = scalarRecord(
    record.capture.value.cloneCounts,
    `record ${record.tick}/cloneCounts`
  )
  const total = cloneCounts.total
  const byOriginalTargetId = scalarRecord(
    cloneCounts.byOriginalTargetId ?? null,
    `record ${record.tick}/cloneCounts/byOriginalTargetId`
  )
  if (!total || !('scalarKind' in total) || total.scalarKind !== 'number')
    throw new Error(`record ${record.tick}/cloneCounts/total is not tagged`)
  const counts: Record<string, number> = {}
  for (const [targetId, count] of Object.entries(byOriginalTargetId))
  {
    if (!count || !('scalarKind' in count) || count.scalarKind !== 'number')
      throw new Error(
        `record ${record.tick}/cloneCounts/${targetId} is not tagged`
      )
    counts[targetId] = count as unknown as number
  }
  return {
    tick: record.tick,
    scenarioStepIndex: record.scenarioStepIndex,
    snapshotLabel: record.label,
    total: total as unknown as number,
    byOriginalTargetId: counts,
  }
}

function requiredRecordKeys(specs: readonly BehavioralLensSpecV1[]): {
  readonly finalRequired: boolean
  readonly labels: ReadonlySet<string>
  readonly ticks: ReadonlySet<number>
  readonly visualRequested: boolean
  readonly frameIds: ReadonlySet<string>
}
{
  const labels = new Set<string>()
  const ticks = new Set<number>()
  let finalRequired = false
  let visualRequested = false
  const frameIds = new Set<string>()
  for (const spec of specs)
  {
    if (spec.kind === 'final-state' || spec.kind === 'runtime-outcome')
      finalRequired = true
    if (spec.kind === 'labeled-trace')
      for (const label of spec.labels) labels.add(label)
    if (spec.kind === 'clone-count-trace')
      for (const tick of spec.ticks) ticks.add(tick)
    if (spec.kind === 'visual-keyframes')
    {
      visualRequested = true
      for (const frameId of spec.frameIds) frameIds.add(frameId)
    }
  }
  return { finalRequired, labels, ticks, visualRequested, frameIds }
}

function scalarFiniteNumber(
  value: ObservedRuntimeValueV1 | undefined,
  location: string
): number
{
  if (
    !value ||
    typeof value !== 'object' ||
    !('scalarKind' in value) ||
    value.scalarKind !== 'number' ||
    value.value.numberKind !== 'finite'
  )
    throw new Error(`${location} is not one tagged finite number`)
  return value.value.value
}

function scalarArray(
  value: ObservedRuntimeValueV1 | undefined,
  location: string
): readonly ObservedRuntimeValueV1[]
{
  if (!Array.isArray(value))
    throw new Error(`${location} is not one tagged array`)
  return value
}

function visualFrameProjection(
  frame: MediaFrameRefV1,
  record: RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>
): MediaFrameRefV1
{
  if (
    record.capture.status !== 'observed' ||
    !('visual' in record.capture.value)
  )
    throw new Error(`frame ${frame.id} has no bounded visual observation`)
  const visual = scalarRecord(
    record.capture.value.visual,
    `frame ${frame.id}/visual`
  )
  const identityIssues = scalarArray(
    visual.identityIssues,
    `frame ${frame.id}/visual/identityIssues`
  )
  if (identityIssues.length > 0)
    throw new Error(`frame ${frame.id} has visual identity issues`)
  const geometry = scalarRecord(
    visual.geometry ?? null,
    `frame ${frame.id}/visual/geometry`
  )
  const canvas = scalarRecord(
    geometry.canvas ?? null,
    `frame ${frame.id}/visual/geometry/canvas`
  )
  const width = scalarFiniteNumber(
    canvas.width,
    `frame ${frame.id}/visual/geometry/canvas/width`
  )
  const height = scalarFiniteNumber(
    canvas.height,
    `frame ${frame.id}/visual/geometry/canvas/height`
  )
  const targets = scalarArray(
    geometry.targets,
    `frame ${frame.id}/visual/geometry/targets`
  ).map((entry, index) =>
  {
    const target = scalarRecord(
      entry,
      `frame ${frame.id}/visual/geometry/targets/${index}`
    )
    const instance = scalarString(
      target.instance as ObservedRuntimeScalarV1,
      `frame ${frame.id}/geometry/${index}/instance`
    )
    if (instance !== 'original' && instance !== 'clone')
      throw new Error(`frame ${frame.id} has an invalid geometry instance`)
    const rect =
      target.rect === null
        ? null
        : scalarRecord(
            target.rect ?? null,
            `frame ${frame.id}/geometry/${index}/rect`
          )
    return {
      originalTargetId: scalarString(
        target.originalTargetId as ObservedRuntimeScalarV1,
        `frame ${frame.id}/geometry/${index}/originalTargetId`
      ),
      name: scalarString(
        target.name as ObservedRuntimeScalarV1,
        `frame ${frame.id}/geometry/${index}/name`
      ),
      isStage: scalarBoolean(
        target.isStage as ObservedRuntimeScalarV1,
        `frame ${frame.id}/geometry/${index}/isStage`
      ),
      instance: instance as 'original' | 'clone',
      instanceIndex: scalarFiniteNumber(
        target.instanceIndex,
        `frame ${frame.id}/geometry/${index}/instanceIndex`
      ),
      visible: target.visible as unknown as boolean,
      costumeIndex: target.costumeIndex as unknown as number,
      costumeName: scalarString(
        target.costumeName as ObservedRuntimeScalarV1,
        `frame ${frame.id}/geometry/${index}/costumeName`
      ),
      rect: rect
        ? {
            x: rect.x as unknown as number,
            y: rect.y as unknown as number,
            width: rect.width as unknown as number,
            height: rect.height as unknown as number,
          }
        : null,
    }
  })
  const projected = structuredClone(frame)
  projected.geometry = {
    canvas: { width, height },
    targets,
  }
  const boundedGeometry = projected.geometry as MediaFrameRefV1['geometry'] & {
    editBoundedCanvas: unknown
  }
  boundedGeometry.editBoundedCanvas = canvas
  return projected
}

export function buildBoundedEditProofTraceV1(input: {
  readonly trace: BehavioralTrace
  readonly records: readonly RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>[]
  readonly targets: readonly EditBoundedTargetIdentityV1[]
  readonly paneTargetObservationIdOrder: readonly string[]
  readonly specs: readonly BehavioralLensSpecV1[]
  readonly decodedPixelFrameIds: readonly string[]
}): EditBoundedProofTraceResultV1
{
  const refused = input.records.find(
    (record) => record.capture.status === 'refused'
  )
  if (refused?.capture.status === 'refused')
    return inconclusive(
      'bounded-observation-refused',
      `${refused.capture.issue.code} at ${refused.capture.issue.scope}; no observation prefix is retained`
    )
  const requirements = requiredRecordKeys(input.specs)
  const decodedFrameIds = new Set(input.decodedPixelFrameIds)
  if (
    requirements.visualRequested &&
    [...requirements.frameIds].some((frameId) => !decodedFrameIds.has(frameId))
  )
    return inconclusive(
      'bounded-observation-incomplete',
      'visual preservation has no complete decoded pixel facet'
    )
  const matches = (
    predicate: (
      record: RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>
    ) => boolean
  ): number => input.records.filter(predicate).length
  if (
    (requirements.finalRequired && input.records.at(-1)?.label !== null) ||
    [...requirements.labels].some(
      (label) => matches((record) => record.label === label) !== 1
    ) ||
    [...requirements.ticks].some(
      (tick) => matches((record) => record.tick === tick) < 1
    )
  )
    return inconclusive(
      'bounded-observation-incomplete',
      'the exact final, label, or tick observation set is missing or ambiguous'
    )
  if (
    input.records.length === 0 ||
    input.records.some(
      (record) =>
        record.capture.status !== 'observed' ||
        record.capture.value.cloneIdentityIssues.length > 0
    )
  )
    return inconclusive(
      'bounded-observation-incomplete',
      'the cell has no complete identity-safe bounded observation set'
    )
  try
  {
    const targets = new Map(
      input.targets.map((target) => [target.observationTargetId, target])
    )
    if (targets.size !== input.targets.length)
      throw new Error('bounded target identities are duplicated')
    const proof = structuredClone(input.trace) as BehavioralTrace
    proof.snapshots = []
    proof.finalSnapshot = null
    proof.observations.cloneCounts = []
    proof.observations.media = null
    const finalRecord = input.records.at(-1)
    const cloneByTick = new Map<
      number,
      BehavioralTrace['observations']['cloneCounts'][number]
    >()
    for (const record of input.records)
    {
      const snapshot = snapshotProjection(
        record,
        targets,
        input.paneTargetObservationIdOrder
      )
      if (record === finalRecord && record.label === null)
        proof.finalSnapshot = snapshot
      else proof.snapshots.push(snapshot)
      const clone = cloneProjection(record)
      const priorClone = cloneByTick.get(record.tick)
      if (
        priorClone &&
        hashRunnerJson({
          total: priorClone.total,
          byOriginalTargetId: priorClone.byOriginalTargetId,
        }) !==
          hashRunnerJson({
            total: clone.total,
            byOriginalTargetId: clone.byOriginalTargetId,
          })
      )
        throw new Error(
          `tick ${record.tick} has conflicting complete tagged clone projections`
        )
      if (!priorClone) cloneByTick.set(record.tick, clone)
    }
    proof.observations.cloneCounts.push(
      ...[...cloneByTick.values()]
        .filter(
          (sample) =>
            requirements.ticks.size === 0 || requirements.ticks.has(sample.tick)
        )
        .sort((left, right) => left.tick - right.tick)
    )
    if (requirements.visualRequested)
    {
      const sourceMedia = input.trace.observations.media
      if (!sourceMedia?.complete)
        throw new Error('visual preservation has no complete frame manifest')
      const selectedFrames = sourceMedia.frames.filter((frame) =>
        requirements.frameIds.has(frame.id)
      )
      if (selectedFrames.length !== requirements.frameIds.size)
        throw new Error(
          'visual preservation frame IDs are missing or duplicated'
        )
      const frames = selectedFrames.map((frame) =>
      {
        const matches = input.records.filter(
          (record) =>
            record.tick === frame.tick && record.label === frame.snapshotLabel
        )
        if (matches.length < 1)
          throw new Error(
            `frame ${frame.id} has ${matches.length} exact bounded observations`
          )
        const projections = matches.map((record) =>
          visualFrameProjection(frame, record)
        )
        const firstHash = hashRunnerJson(projections[0]!.geometry)
        if (
          projections.some(
            (projection) => hashRunnerJson(projection.geometry) !== firstHash
          )
        )
          throw new Error(
            `frame ${frame.id} has conflicting complete tagged visual projections`
          )
        return projections[0]!
      })
      proof.observations.media = {
        ...structuredClone(sourceMedia),
        frames,
      }
    }
    return { status: 'complete', trace: proof }
  }
  catch (error)
  {
    return inconclusive(
      'bounded-observation-invalid',
      unknownErrorMessage(error)
    )
  }
}
