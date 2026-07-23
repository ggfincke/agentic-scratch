// packages/runner/src/observation/snapshot.ts
// read a deterministic VM state snapshot from the loaded runtime (headless, renderer-free)

import type {
  ScalarValue,
  SpriteState,
  StageState,
  StateSnapshot,
  VmSpriteState,
  VmStateSnapshot,
} from '../policy/types.js'
import type { ScratchRuntime, ScratchTarget } from '../vm/vm-api.js'
import type {
  CloneCountSampleV1,
  ObservedRuntimeScalarV1,
  RuntimeObservationBudgetV1,
} from './observation.js'
import { refuseRuntimeObservationValueV1 } from './observation.js'
import { runtimeObservationValueKindV1 } from './observation.js'
import {
  captureRuntimeObservationV1,
  projectRuntimeObservationScalarListV1,
  projectRuntimeObservationValueV1,
} from './runtime-observation.js'
import type {
  ObservedRuntimeValueV1,
  RuntimeObservationCaptureV1,
} from './runtime-observation.js'

// Scratch3LooksBlocks.STATE_KEY; bubble text/type live here before any renderer call
const LOOKS_STATE_KEY = 'Scratch.looks'

function readBubble(target: ScratchTarget): VmSpriteState['bubble']
{
  const s = target.getCustomState(LOOKS_STATE_KEY)
  if (!s || s.text === '') return null
  return { text: s.text, type: s.type }
}

function uniqueTargetKey(
  state: VmSpriteState,
  used: Record<string, VmSpriteState>
): string
{
  const name = state.name
  if (!used[name]) return name
  const base = `${name}#${state.id}`
  if (!used[base]) return base
  let i = 2
  while (used[`${base}-${i}`]) i++
  return `${base}-${i}`
}

export interface RuntimeTargetIdentity
{
  target: ScratchTarget
  original: ScratchTarget
  originalTargetId: string
  instance: 'original' | 'clone'
  instanceIndex: number
}

export interface RuntimeTargetIdentityResult
{
  targets: RuntimeTargetIdentity[]
  issues: string[]
}

export interface CloneCountRead
{
  sample: CloneCountSampleV1
  issues: string[]
}

function stableOriginalTargetId(
  target: ScratchTarget,
  spriteIndex: number
): string
{
  if (target.isStage) return 'stage'
  return `sprite-${spriteIndex}-${target.getName()}`
}

export function stableObservationTargetId(
  target: ScratchTarget,
  spriteIndex: number
): string
{
  if (target.isStage) return 'stage'
  return `runtime-target-${spriteIndex}`
}

// normalize runtime targets around authored originals; clone IDs are deliberately ordinal-only
export function resolveRuntimeTargetIdentities(
  runtime: ScratchRuntime
): RuntimeTargetIdentityResult
{
  const issues: string[] = []
  const originals = runtime.targets.filter((target) => target.isOriginal)
  const originalIds = new Map<ScratchTarget, string>()
  const originalBySprite = new Map<object, ScratchTarget>()
  const originalsByName = new Map<string, ScratchTarget[]>()
  const cloneOrdinalByOriginal = new Map<
    ScratchTarget,
    ReadonlyMap<ScratchTarget, number>
  >()
  const listedCloneCountByOriginal = new Map<ScratchTarget, number>()
  let spriteIndex = 0
  for (const original of originals)
  {
    const id = stableOriginalTargetId(
      original,
      original.isStage ? 0 : ++spriteIndex
    )
    originalIds.set(original, id)
    if (original.sprite) originalBySprite.set(original.sprite, original)
    if (!original.isStage)
    {
      const name = original.getName()
      const sameName = originalsByName.get(name) ?? []
      sameName.push(original)
      originalsByName.set(name, sameName)
    }
    if (original.sprite)
    {
      const cloneOrdinals = new Map<ScratchTarget, number>()
      let listedCloneCount = 0
      original.sprite.clones.forEach((target, index) =>
      {
        if (target.isOriginal) return
        listedCloneCount += 1
        if (!cloneOrdinals.has(target)) cloneOrdinals.set(target, index)
      })
      cloneOrdinalByOriginal.set(original, cloneOrdinals)
      listedCloneCountByOriginal.set(original, listedCloneCount)
    }
  }

  const fallbackCloneIndexes = new Map<ScratchTarget, number>()
  const observedCloneCountByOriginal = new Map<ScratchTarget, number>()
  const targets: RuntimeTargetIdentity[] = []
  for (const [targetOrdinal, target] of runtime.targets.entries())
  {
    if (target.isOriginal)
    {
      targets.push({
        target,
        original: target,
        originalTargetId: originalIds.get(target)!,
        instance: 'original',
        instanceIndex: 0,
      })
      continue
    }

    let original = target.sprite
      ? originalBySprite.get(target.sprite)
      : undefined
    if (!original)
    {
      const sameName = originalsByName.get(target.getName()) ?? []
      if (sameName.length === 1) original = sameName[0]
    }
    if (!original)
    {
      issues.push(
        `clone at runtime target ordinal ${targetOrdinal} has no unique authored original`
      )
      continue
    }

    let instanceIndex = cloneOrdinalByOriginal.get(original)?.get(target) ?? -1
    if (instanceIndex < 1)
    {
      const next = (fallbackCloneIndexes.get(original) ?? 0) + 1
      fallbackCloneIndexes.set(original, next)
      instanceIndex = next
      issues.push(
        `clone ${originalIds.get(original)}#${next} is absent from its original sprite clone list`
      )
    }
    targets.push({
      target,
      original,
      originalTargetId: originalIds.get(original)!,
      instance: 'clone',
      instanceIndex,
    })
    observedCloneCountByOriginal.set(
      original,
      (observedCloneCountByOriginal.get(original) ?? 0) + 1
    )
  }

  for (const original of originals)
  {
    if (original.isStage || !original.sprite) continue
    const listed = listedCloneCountByOriginal.get(original) ?? 0
    const observed = observedCloneCountByOriginal.get(original) ?? 0
    if (listed !== observed)
      issues.push(
        `original target ${originalIds.get(original)} reports ${listed} clones but runtime exposes ${observed}`
      )
  }
  return { targets, issues: [...new Set(issues)] }
}

export function readCloneCountSample(
  runtime: ScratchRuntime,
  tick: number,
  scenarioStepIndex: number,
  snapshotLabel: string | null
): CloneCountRead
{
  return readResolvedCloneCountSample(
    resolveRuntimeTargetIdentities(runtime),
    tick,
    scenarioStepIndex,
    snapshotLabel
  )
}

export function readResolvedCloneCountSample(
  resolved: RuntimeTargetIdentityResult,
  tick: number,
  scenarioStepIndex: number,
  snapshotLabel: string | null
): CloneCountRead
{
  const byOriginalTargetId: Record<string, number> = {}
  let total = 0
  for (const entry of resolved.targets)
  {
    if (entry.target.isStage) continue
    if (!(entry.originalTargetId in byOriginalTargetId))
      byOriginalTargetId[entry.originalTargetId] = 0
    if (entry.instance === 'clone')
    {
      byOriginalTargetId[entry.originalTargetId]! += 1
      total += 1
    }
  }
  return {
    sample: {
      tick,
      scenarioStepIndex,
      snapshotLabel,
      total,
      byOriginalTargetId,
    },
    issues: resolved.issues,
  }
}

function readTarget(target: ScratchTarget, id: string): VmSpriteState
{
  const costume = target.getCostumes()[target.currentCostume]
  const variables: Record<string, ScalarValue> = {}
  const lists: Record<string, ScalarValue[]> = {}
  for (const id of Object.keys(target.variables))
  {
    const v = target.variables[id]!
    if (v.type === '') variables[v.name] = v.value as ScalarValue
    else if (v.type === 'list')
      lists[v.name] = (v.value as ScalarValue[]).slice()
  }
  return {
    id,
    name: target.getName(),
    isStage: target.isStage,
    x: target.x,
    y: target.y,
    direction: target.direction,
    costume: costume ? costume.name : '',
    visible: target.visible,
    size: target.size,
    rotationStyle: target.rotationStyle,
    draggable: target.draggable,
    volume: target.volume,
    effects: { ...target.effects },
    bubble: readBubble(target),
    variables,
    lists,
  }
}

function readStage(runtime: ScratchRuntime): StageState
{
  const stage = runtime.getTargetForStage()
  const backdrop = stage.getCostumes()[stage.currentCostume]
  return {
    backdrop: backdrop ? backdrop.name : '',
    tempo: stage.tempo,
    videoState: stage.videoState,
  }
}

export function readSnapshot(
  runtime: ScratchRuntime,
  tick: number,
  label?: string
): VmStateSnapshot
{
  const targets: Record<string, VmSpriteState> = {}
  const targetsById: Record<string, VmSpriteState> = {}
  const targetOrder: string[] = []
  let spriteIndex = 0
  let stageTargetId = 'stage'
  for (const target of runtime.targets)
  {
    // skip clones; the original sprites & the stage carry the authored state
    if (!target.isOriginal) continue
    const id = stableOriginalTargetId(
      target,
      target.isStage ? 0 : ++spriteIndex
    )
    const state = readTarget(target, id)
    targetOrder.push(state.id)
    targetsById[state.id] = state
    targets[uniqueTargetKey(state, targets)] = state
    if (target.isStage) stageTargetId = state.id
  }
  const globals = targetsById[stageTargetId]
  const answerPrim = runtime._primitives.sensing_answer
  const snapshot: VmStateSnapshot = {
    tick,
    targetOrder,
    targetsById,
    stageTargetId,
    targets,
    variables: globals ? globals.variables : {},
    lists: globals ? globals.lists : {},
    answer: answerPrim ? String(answerPrim()) : '',
    timer: runtime.ioDevices.clock.projectTimer(),
    stage: readStage(runtime),
  }
  if (label !== undefined) snapshot.label = label
  return snapshot
}

export interface ObservedRuntimeDeclarationValueV1
{
  readonly name: ObservedRuntimeScalarV1
  readonly value: ObservedRuntimeScalarV1
}

export interface ObservedRuntimeDeclarationListV1
{
  readonly name: ObservedRuntimeScalarV1
  readonly items: readonly ObservedRuntimeScalarV1[]
}

interface ObservedRuntimeBubbleV1
{
  readonly text: ObservedRuntimeScalarV1
  readonly type: ObservedRuntimeScalarV1
}

export interface ObservedRuntimeTargetSnapshotV1
{
  readonly id: string
  readonly name: ObservedRuntimeScalarV1
  readonly isStage: ObservedRuntimeScalarV1
  readonly x: ObservedRuntimeScalarV1
  readonly y: ObservedRuntimeScalarV1
  readonly direction: ObservedRuntimeScalarV1
  readonly costume: ObservedRuntimeScalarV1
  readonly costumeIndex: ObservedRuntimeScalarV1
  readonly visible: ObservedRuntimeScalarV1
  readonly size: ObservedRuntimeScalarV1
  readonly rotationStyle: ObservedRuntimeScalarV1
  readonly draggable: ObservedRuntimeScalarV1
  readonly volume: ObservedRuntimeScalarV1
  readonly effects: Readonly<Record<string, ObservedRuntimeScalarV1>>
  readonly bubble: ObservedRuntimeBubbleV1 | null
  readonly variables: Readonly<
    Record<string, ObservedRuntimeDeclarationValueV1>
  >
  readonly lists: Readonly<Record<string, ObservedRuntimeDeclarationListV1>>
}

interface ObservedRuntimeStageSnapshotV1
{
  readonly backdrop: ObservedRuntimeScalarV1
  readonly tempo: ObservedRuntimeScalarV1
  readonly videoState: ObservedRuntimeScalarV1
}

interface ObservedRuntimeSnapshotV1
{
  readonly schemaVersion: 1
  readonly tick: number
  readonly label?: string
  readonly targetOrder: readonly string[]
  readonly targetsById: Readonly<
    Record<string, ObservedRuntimeTargetSnapshotV1>
  >
  readonly stageTargetId: string
  readonly answer: ObservedRuntimeScalarV1
  readonly timer: ObservedRuntimeScalarV1
  readonly stage: ObservedRuntimeStageSnapshotV1
}

export interface ObservedRuntimeExecutionObservationV1
{
  readonly state: ObservedRuntimeSnapshotV1
  readonly cloneCounts: ObservedRuntimeValueV1
  readonly supplemental: ObservedRuntimeValueV1 | null
  readonly cloneIdentityIssues: readonly string[]
}

function observedBubble(
  target: ScratchTarget,
  id: string,
  budget: RuntimeObservationBudgetV1
): ObservedRuntimeBubbleV1 | null
{
  const state = target.getCustomState(LOOKS_STATE_KEY) as unknown
  if (state === undefined) return null
  if (runtimeObservationValueKindV1(state) !== 'record')
    return refuseRuntimeObservationValueV1(
      `${id}/bubble`,
      'plain-record',
      state
    )
  let descriptors: PropertyDescriptorMap
  try
  {
    descriptors = Object.getOwnPropertyDescriptors(state)
  }
  catch
  {
    return refuseRuntimeObservationValueV1(
      `${id}/bubble`,
      'plain-record',
      state
    )
  }
  const textDescriptor = descriptors.text
  const typeDescriptor = descriptors.type
  if (
    textDescriptor === undefined ||
    !('value' in textDescriptor) ||
    typeDescriptor === undefined ||
    !('value' in typeDescriptor)
  )
    return refuseRuntimeObservationValueV1(
      `${id}/bubble`,
      'data-property',
      textDescriptor?.get ?? typeDescriptor?.get
    )
  const text = budget.chargeScalar(`${id}/bubble/text`, textDescriptor.value)
  const type = budget.chargeScalar(`${id}/bubble/type`, typeDescriptor.value)
  if (text.scalarKind === 'string' && text.value === '') return null
  return Object.freeze({ text, type })
}

// charge & tag every value before it enters the returned projection; an
// overflow or non-scalar throws before any partial target can escape
function readBoundedTarget(
  target: ScratchTarget,
  id: string,
  budget: RuntimeObservationBudgetV1
): ObservedRuntimeTargetSnapshotV1
{
  const costume = target.getCostumes()[target.currentCostume]
  const variables = Object.create(null) as Record<
    string,
    ObservedRuntimeDeclarationValueV1
  >
  const lists = Object.create(null) as Record<
    string,
    ObservedRuntimeDeclarationListV1
  >
  for (const declarationId of Object.keys(target.variables))
  {
    const declaration = target.variables[declarationId]!
    const scope = `${id}/${declarationId}`
    if (declaration.type === '')
    {
      budget.chargeRecords(scope, 1)
      variables[declarationId] = Object.freeze({
        name: budget.chargeScalar(`${scope}/name`, declaration.name),
        value: budget.chargeScalar(`${scope}/value`, declaration.value),
      })
      continue
    }
    if (declaration.type !== 'list') continue
    budget.chargeRecords(scope, 1)
    lists[declarationId] = Object.freeze({
      name: budget.chargeScalar(`${scope}/name`, declaration.name),
      items: projectRuntimeObservationScalarListV1(
        declaration.value,
        budget,
        `${scope}/items`
      ),
    })
  }
  const effectNames = Object.keys(target.effects)
  budget.chargeRecords(`${id}/effects`, effectNames.length)
  const effects = Object.create(null) as Record<string, ObservedRuntimeScalarV1>
  for (const name of effectNames)
    effects[name] = budget.chargeScalar(
      `${id}/effects/${name}`,
      target.effects[name]
    )
  return Object.freeze({
    id,
    name: budget.chargeScalar(`${id}/name`, target.getName()),
    isStage: budget.chargeScalar(`${id}/isStage`, target.isStage),
    x: budget.chargeScalar(`${id}/x`, target.x),
    y: budget.chargeScalar(`${id}/y`, target.y),
    direction: budget.chargeScalar(`${id}/direction`, target.direction),
    costume: budget.chargeScalar(`${id}/costume`, costume ? costume.name : ''),
    costumeIndex: budget.chargeScalar(
      `${id}/costumeIndex`,
      target.currentCostume
    ),
    visible: budget.chargeScalar(`${id}/visible`, target.visible),
    size: budget.chargeScalar(`${id}/size`, target.size),
    rotationStyle: budget.chargeScalar(
      `${id}/rotationStyle`,
      target.rotationStyle
    ),
    draggable: budget.chargeScalar(`${id}/draggable`, target.draggable),
    volume: budget.chargeScalar(`${id}/volume`, target.volume),
    effects: Object.freeze(effects),
    bubble: observedBubble(target, id, budget),
    variables: Object.freeze(variables),
    lists: Object.freeze(lists),
  })
}

// opt-in bounded reader for the evaluation facet: same shape as
// readSnapshot, but it charges the quota table while reading the live VM &
// throws rather than ever returning a truncated snapshot
export function readBoundedSnapshot(
  runtime: ScratchRuntime,
  budget: RuntimeObservationBudgetV1,
  tick: number,
  label?: string
): ObservedRuntimeSnapshotV1
{
  budget.beginSnapshot()
  const targetsById = Object.create(null) as Record<
    string,
    ObservedRuntimeTargetSnapshotV1
  >
  const targetOrder: string[] = []
  let spriteIndex = 0
  let stageTargetId = 'stage'
  for (const target of runtime.targets)
  {
    if (!target.isOriginal) continue
    const id = stableObservationTargetId(
      target,
      target.isStage ? 0 : ++spriteIndex
    )
    budget.chargeRecords(id, 1)
    const state = readBoundedTarget(target, id, budget)
    targetOrder.push(state.id)
    targetsById[state.id] = state
    if (target.isStage) stageTargetId = id
  }
  const answerPrim = runtime._primitives.sensing_answer
  const stage = runtime.getTargetForStage()
  const backdrop = stage.getCostumes()[stage.currentCostume]
  const snapshot: ObservedRuntimeSnapshotV1 = {
    schemaVersion: 1,
    tick,
    ...(label === undefined ? {} : { label }),
    targetOrder: Object.freeze(targetOrder),
    targetsById: Object.freeze(targetsById),
    stageTargetId,
    answer: budget.chargeScalar(
      'project/answer',
      answerPrim ? answerPrim() : ''
    ),
    timer: budget.chargeScalar(
      'project/timer',
      runtime.ioDevices.clock.projectTimer()
    ),
    stage: Object.freeze({
      backdrop: budget.chargeScalar(
        'stage/backdrop',
        backdrop ? backdrop.name : ''
      ),
      tempo: budget.chargeScalar('stage/tempo', stage.tempo),
      videoState: budget.chargeScalar('stage/videoState', stage.videoState),
    }),
  }
  return Object.freeze(snapshot)
}

// the Node identity lane's complete neutral producer; monitor/trace adapters
// pass their closed raw record through supplemental before retaining it
export function captureBoundedRuntimeObservation(
  runtime: ScratchRuntime,
  budget: RuntimeObservationBudgetV1,
  tick: number,
  scenarioStepIndex: number,
  label: string | null,
  supplemental?: unknown,
  cloneRead?: CloneCountRead
): RuntimeObservationCaptureV1<ObservedRuntimeExecutionObservationV1>
{
  return captureRuntimeObservationV1(budget, () =>
  {
    const state = readBoundedSnapshot(runtime, budget, tick, label ?? undefined)
    const currentCloneRead =
      cloneRead ??
      readCloneCountSample(runtime, tick, scenarioStepIndex, label)
    const cloneCounts = projectRuntimeObservationValueV1(
      currentCloneRead.sample,
      budget,
      'cloneCounts'
    )
    const projectedSupplemental =
      supplemental === undefined
        ? null
        : projectRuntimeObservationValueV1(supplemental, budget, 'supplemental')
    const observation = Object.freeze({
      state,
      cloneCounts,
      supplemental: projectedSupplemental,
      cloneIdentityIssues: Object.freeze([...currentCloneRead.issues]),
    })
    budget.chargeTraceBytes(
      `observation/${tick}`,
      new TextEncoder().encode(JSON.stringify(observation)).byteLength
    )
    return observation
  })
}

function legacySpriteState(state: VmSpriteState): SpriteState
{
  return {
    x: state.x,
    y: state.y,
    direction: state.direction,
    costume: state.costume,
    visible: state.visible,
  }
}

export function toStateSnapshot(snapshot: VmStateSnapshot): StateSnapshot
{
  const targets: Record<string, SpriteState> = {}
  for (const [key, state] of Object.entries(snapshot.targets))
  {
    targets[key] = legacySpriteState(state)
  }
  return {
    tick: snapshot.tick,
    targets,
    variables: { ...snapshot.variables },
  }
}
