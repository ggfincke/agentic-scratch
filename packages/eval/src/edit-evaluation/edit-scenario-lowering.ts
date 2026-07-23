// packages/eval/src/edit-evaluation/edit-scenario-lowering.ts
// lower a trusted semantic scenario policy onto one exact artifact's runtime lineage

import { unpackSb3 } from '@scratch-agent/sb3'
import type {
  BroadcastDeclarationContractRefV1,
  EditScenarioPolicyV1,
  EditScenarioStepV1,
  SpriteTargetContractRefV1,
} from '@scratch-agent/ir/edit'
import { scenarioPolicyValueSemanticSha256V1 } from '@scratch-agent/ir/edit'
import {
  hashIdentityBoundScenario,
  hashRunnerJson,
  IDENTITY_BOUND_SCENARIO_SCHEMA_VERSION,
  runtimeLineageManifestForBytes,
  type IdentityBoundActionRecordV1,
  type IdentityBoundScenarioV1,
  type IdentityBoundStepV1,
  type RuntimeLineageManifestV1,
  type RuntimeLineageMediaEntryV1,
  type RuntimeLineageTargetInputV1,
} from '@scratch-agent/runner'

const EDIT_SCENARIO_LOWERING_VERSION = 'edit-scenario-lowering-v1'

export type EditEvaluationSideV1 = 'baseline' | 'candidate'

// domain-separated over the canonical runner encoding, so replay rederives every
// hash from retained inputs alone
export function editRuntimeHashV1(domain: string, value: unknown): string
{
  return hashRunnerJson([domain, value])
}

export interface EditRuntimeDeclarationLineageV1
{
  readonly targetIndex: number
  readonly kind: 'variable' | 'list' | 'broadcast'
  readonly rawDeclarationId: string
  readonly declarationLineage: string
}

export interface EditRuntimeMediaLineageV1
{
  readonly targetIndex: number
  readonly mediaKind: 'costume' | 'sound'
  readonly mediaOrder: number
  readonly mediaLineage: string
}

// what the edit domain knows & eval consumes: stable lineage for every serialized
// member of one exact artifact. eval never invents lineage, & never uses names.
export interface EditRuntimeLineageAssignmentV1
{
  readonly targetLineagesBySerializedIndex: readonly string[]
  readonly declarations: readonly EditRuntimeDeclarationLineageV1[]
  readonly media: readonly EditRuntimeMediaLineageV1[]
}

interface EditRuntimeBroadcastDeclarationV1
{
  readonly declarationLineage: string
  readonly rawDeclarationId: string
  readonly name: string
  readonly receiverTargetLineages: readonly string[]
  readonly receiverScriptCount: number
}

export interface EditRuntimeArtifactBindingV1
{
  readonly artifactSha256: string
  readonly manifest: RuntimeLineageManifestV1
  readonly targetLineagesBySerializedIndex: readonly string[]
  readonly broadcasts: readonly EditRuntimeBroadcastDeclarationV1[]
}

export interface EditRuntimeTargetBindingV1
{
  readonly bindingKey: string
  readonly targetLineage: string
}

export interface EditRuntimeBroadcastBindingV1
{
  readonly bindingKey: string
  readonly declarationLineage: string
}

export interface EditRuntimeDeclarationBindingV1
{
  readonly bindingKey: string
  readonly declarationLineage: string
  readonly targetLineage: string
  readonly collection: 'variables' | 'lists'
}

// resolved contract entity bindings; the lowering maps a contract ref's binding
// key onto lineage & never onto a display name
export interface EditRuntimeBindingTableV1
{
  readonly targets: readonly EditRuntimeTargetBindingV1[]
  readonly declarations: readonly EditRuntimeDeclarationBindingV1[]
  readonly broadcasts: readonly EditRuntimeBroadcastBindingV1[]
}

type EditScenarioLoweringReasonV1 =
  | 'policy-not-applicable-to-side'
  | 'future-binding-on-baseline'
  | 'unbound-target-ref'
  | 'unbound-broadcast-ref'
  | 'target-lineage-absent-from-artifact'
  | 'broadcast-lineage-absent-from-artifact'
  | 'broadcast-name-collision'
  | 'broadcast-receiver-set-empty'

interface EditScenarioLoweringFailureV1
{
  readonly stepIndex: number
  readonly reason: EditScenarioLoweringReasonV1
  readonly detail: string
}

export interface EditLoweredScenarioV1
{
  readonly scenarioId: string
  readonly side: EditEvaluationSideV1
  readonly artifactSha256: string
  readonly manifestSha256: string
  readonly semanticPolicySha256: string
  readonly loweringVersion: typeof EDIT_SCENARIO_LOWERING_VERSION
  readonly scenario: IdentityBoundScenarioV1
  readonly loweredScenarioSha256: string
}

type EditScenarioLoweringResultV1 =
  | { readonly status: 'lowered'; readonly lowered: EditLoweredScenarioV1 }
  | {
      readonly status: 'refused'
      readonly scenarioId: string
      readonly side: EditEvaluationSideV1
      readonly failures: readonly EditScenarioLoweringFailureV1[]
    }

function editSemanticScenarioPolicySha256(
  policy: EditScenarioPolicyV1
): string
{
  return scenarioPolicyValueSemanticSha256V1(policy)
}

export function editLoweredActionTraceSha256(
  actions: readonly IdentityBoundActionRecordV1[]
): string
{
  return editRuntimeHashV1('edit-lowered-action-trace', actions)
}

interface SerializedTarget
{
  readonly isStage?: boolean
  readonly blocks?: Record<string, unknown>
  readonly variables?: Record<string, unknown>
  readonly lists?: Record<string, unknown>
  readonly broadcasts?: Record<string, string>
  readonly costumes?: readonly { readonly assetId?: string }[]
  readonly sounds?: readonly { readonly assetId?: string }[]
  readonly layerOrder?: number
}

interface SerializedBlock
{
  readonly opcode?: string
  readonly topLevel?: boolean
  readonly fields?: Record<string, unknown>
}

function targetsOf(projectJsonText: string): readonly SerializedTarget[]
{
  const parsed = JSON.parse(projectJsonText) as {
    targets?: readonly SerializedTarget[]
  }
  return parsed.targets ?? []
}

function blockIdsOf(target: SerializedTarget): readonly string[]
{
  return Object.keys(target.blocks ?? {})
}

function mediaOf(
  target: SerializedTarget,
  targetIndex: number,
  mediaByPosition: ReadonlyMap<string, EditRuntimeMediaLineageV1>
): readonly RuntimeLineageMediaEntryV1[]
{
  const entries: RuntimeLineageMediaEntryV1[] = []
  const push = (
    mediaKind: 'costume' | 'sound',
    list: readonly { readonly assetId?: string }[]
  ): void =>
  {
    list.forEach((media, mediaOrder) =>
    {
      const lineage = mediaByPosition.get(
        `${targetIndex}:${mediaKind}:${mediaOrder}`
      )
      if (!lineage || typeof media.assetId !== 'string') return
      entries.push({
        mediaLineage: lineage.mediaLineage,
        mediaKind,
        mediaOrder,
        assetId: media.assetId,
      })
    })
  }
  push('costume', target.costumes ?? [])
  push('sound', target.sounds ?? [])
  return entries
}

function declarationsOf(
  target: SerializedTarget,
  targetIndex: number,
  declarationByPosition: ReadonlyMap<string, EditRuntimeDeclarationLineageV1>
): readonly {
  readonly declarationLineage: string
  readonly rawDeclarationId: string
}[]
{
  const ids = [
    ...Object.keys(target.variables ?? {}),
    ...Object.keys(target.lists ?? {}),
    ...Object.keys(target.broadcasts ?? {}),
  ]
  const entries: { declarationLineage: string; rawDeclarationId: string }[] = []
  for (const rawDeclarationId of ids)
  {
    const lineage = declarationByPosition.get(
      `${targetIndex}:${rawDeclarationId}`
    )
    if (!lineage) continue
    entries.push({
      declarationLineage: lineage.declarationLineage,
      rawDeclarationId,
    })
  }
  return entries
}

// mirror of the pinned runtime's hat dispatch, read off the archive instead of
// the live VM: a top-level event_whenbroadcastreceived whose uppercased
// BROADCAST_OPTION field name matches. one of three independent derivations.
function broadcastReceiverGroups(
  targets: readonly SerializedTarget[]
): ReadonlyMap<
  string,
  { readonly targetIndexes: readonly number[]; readonly scriptCount: number }
>
{
  const groups = new Map<
    string,
    { targetIndexes: number[]; scriptCount: number }
  >()
  targets.forEach((target, targetIndex) =>
  {
    const scriptCountsByName = new Map<string, number>()
    for (const block of Object.values(target.blocks ?? {}))
    {
      if (typeof block !== 'object' || block === null) continue
      const typed = block as SerializedBlock
      if (typed.opcode !== 'event_whenbroadcastreceived') continue
      if (typed.topLevel !== true) continue
      const field = typed.fields?.BROADCAST_OPTION
      if (!Array.isArray(field) || typeof field[0] !== 'string') continue
      const name = field[0].toUpperCase()
      scriptCountsByName.set(name, (scriptCountsByName.get(name) ?? 0) + 1)
    }
    for (const [name, scriptCount] of scriptCountsByName)
    {
      const group = groups.get(name)
      if (group)
      {
        group.targetIndexes.push(targetIndex)
        group.scriptCount += scriptCount
        continue
      }
      groups.set(name, { targetIndexes: [targetIndex], scriptCount })
    }
  })
  return groups
}

// derive the exact-byte runtime lineage manifest & the broadcast declaration
// table for one artifact; both are inputs to every lowering against those bytes
export async function bindEditRuntimeArtifactV1(
  sb3: Uint8Array,
  assignment: EditRuntimeLineageAssignmentV1
): Promise<EditRuntimeArtifactBindingV1>
{
  const { projectJsonText } = await unpackSb3(sb3)
  const targets = targetsOf(projectJsonText)
  if (targets.length !== assignment.targetLineagesBySerializedIndex.length)
    throw new Error(
      `lineage assignment covers ${assignment.targetLineagesBySerializedIndex.length} targets but the artifact serializes ${targets.length}`
    )
  const mediaByPosition = new Map<string, EditRuntimeMediaLineageV1>()
  for (const media of assignment.media)
  {
    const key = `${media.targetIndex}:${media.mediaKind}:${media.mediaOrder}`
    if (!mediaByPosition.has(key)) mediaByPosition.set(key, media)
  }
  const declarationByPosition = new Map<
    string,
    EditRuntimeDeclarationLineageV1
  >()
  const broadcastDeclarationByPosition = new Map<
    string,
    EditRuntimeDeclarationLineageV1
  >()
  for (const declaration of assignment.declarations)
  {
    const key = `${declaration.targetIndex}:${declaration.rawDeclarationId}`
    if (!declarationByPosition.has(key))
      declarationByPosition.set(key, declaration)
    if (
      declaration.kind === 'broadcast' &&
      !broadcastDeclarationByPosition.has(key)
    )
      broadcastDeclarationByPosition.set(key, declaration)
  }
  const broadcastReceiversByName = broadcastReceiverGroups(targets)
  const manifestTargets: RuntimeLineageTargetInputV1[] = targets.map(
    (target, targetIndex) => ({
      targetLineage: assignment.targetLineagesBySerializedIndex[targetIndex]!,
      isStage: target.isStage === true,
      serializedTargetOrdinal: targetIndex,
      layerOrder:
        typeof target.layerOrder === 'number' ? target.layerOrder : targetIndex,
      blockIds: blockIdsOf(target),
      declarations: declarationsOf(target, targetIndex, declarationByPosition),
      media: mediaOf(target, targetIndex, mediaByPosition),
    })
  )
  const manifest = runtimeLineageManifestForBytes(sb3, manifestTargets)
  const broadcasts: EditRuntimeBroadcastDeclarationV1[] = []
  targets.forEach((target, targetIndex) =>
  {
    for (const [rawDeclarationId, name] of Object.entries(
      target.broadcasts ?? {}
    ))
    {
      const lineage = broadcastDeclarationByPosition.get(
        `${targetIndex}:${rawDeclarationId}`
      )
      if (!lineage) continue
      const receivers = broadcastReceiversByName.get(name.toUpperCase()) ?? {
        targetIndexes: [],
        scriptCount: 0,
      }
      broadcasts.push({
        declarationLineage: lineage.declarationLineage,
        rawDeclarationId,
        name,
        receiverTargetLineages: Object.freeze(
          receivers.targetIndexes.map(
            (index) => assignment.targetLineagesBySerializedIndex[index]!
          )
        ),
        receiverScriptCount: receivers.scriptCount,
      })
    }
  })
  return Object.freeze({
    artifactSha256: manifest.artifactSha256,
    manifest,
    targetLineagesBySerializedIndex: Object.freeze([
      ...assignment.targetLineagesBySerializedIndex,
    ]),
    broadcasts: Object.freeze(broadcasts),
  })
}

function resolveTargetRef(
  ref: SpriteTargetContractRefV1,
  bindings: EditRuntimeBindingTableV1,
  artifact: EditRuntimeArtifactBindingV1,
  side: EditEvaluationSideV1,
  stepIndex: number
): { readonly targetLineage: string } | EditScenarioLoweringFailureV1
{
  if (ref.contractRefKind === 'future' && side === 'baseline')
    return {
      stepIndex,
      reason: 'future-binding-on-baseline',
      detail: `binding ${ref.bindingKey} names a future entity that cannot exist in the baseline artifact`,
    }
  const binding = bindings.targets.find(
    (candidate) => candidate.bindingKey === ref.bindingKey
  )
  if (!binding)
    return {
      stepIndex,
      reason: 'unbound-target-ref',
      detail: `no resolved target binding for ${ref.bindingKey}`,
    }
  if (!artifact.targetLineagesBySerializedIndex.includes(binding.targetLineage))
    return {
      stepIndex,
      reason: 'target-lineage-absent-from-artifact',
      detail: `${binding.targetLineage} is not a serialized target of ${artifact.artifactSha256}`,
    }
  return { targetLineage: binding.targetLineage }
}

function resolveBroadcastRef(
  ref: BroadcastDeclarationContractRefV1,
  bindings: EditRuntimeBindingTableV1,
  artifact: EditRuntimeArtifactBindingV1,
  side: EditEvaluationSideV1,
  stepIndex: number
): EditRuntimeBroadcastDeclarationV1 | EditScenarioLoweringFailureV1
{
  if (ref.contractRefKind === 'future' && side === 'baseline')
    return {
      stepIndex,
      reason: 'future-binding-on-baseline',
      detail: `binding ${ref.bindingKey} names a future broadcast that cannot exist in the baseline artifact`,
    }
  const binding = bindings.broadcasts.find(
    (candidate) => candidate.bindingKey === ref.bindingKey
  )
  if (!binding)
    return {
      stepIndex,
      reason: 'unbound-broadcast-ref',
      detail: `no resolved broadcast binding for ${ref.bindingKey}`,
    }
  const declaration = artifact.broadcasts.find(
    (candidate) => candidate.declarationLineage === binding.declarationLineage
  )
  if (!declaration)
    return {
      stepIndex,
      reason: 'broadcast-lineage-absent-from-artifact',
      detail: `${binding.declarationLineage} declares no broadcast in ${artifact.artifactSha256}`,
    }
  // the pinned hat API is name-valued, so two declarations that collide under the
  // runtime's uppercase comparison cannot be told apart & must not be driven
  const colliding = artifact.broadcasts.filter(
    (candidate) =>
      candidate.name.toUpperCase() === declaration.name.toUpperCase() &&
      candidate.declarationLineage !== declaration.declarationLineage
  )
  if (colliding.length > 0)
    return {
      stepIndex,
      reason: 'broadcast-name-collision',
      detail: `"${declaration.name}" is declared by ${colliding.length + 1} distinct lineages; the name-valued hat API cannot discriminate them`,
    }
  if (declaration.receiverTargetLineages.length === 0)
    return {
      stepIndex,
      reason: 'broadcast-receiver-set-empty',
      detail: `"${declaration.name}" has no receiving target in ${artifact.artifactSha256}`,
    }
  return declaration
}

function isFailure(value: unknown): value is EditScenarioLoweringFailureV1
{
  return (
    typeof value === 'object' &&
    value !== null &&
    'reason' in value &&
    'stepIndex' in value
  )
}

function lowerStep(
  step: EditScenarioStepV1,
  stepIndex: number,
  bindings: EditRuntimeBindingTableV1,
  artifact: EditRuntimeArtifactBindingV1,
  side: EditEvaluationSideV1
): IdentityBoundStepV1 | EditScenarioLoweringFailureV1
{
  switch (step.do)
  {
    case 'clickTarget':
    {
      const resolved = resolveTargetRef(
        step.target,
        bindings,
        artifact,
        side,
        stepIndex
      )
      if (isFailure(resolved)) return resolved
      return { do: 'clickTarget', targetLineage: resolved.targetLineage }
    }
    case 'broadcast':
    case 'broadcastAndWait':
    {
      const resolved = resolveBroadcastRef(
        step.broadcast,
        bindings,
        artifact,
        side,
        stepIndex
      )
      if (isFailure(resolved)) return resolved
      const broadcast = {
        broadcastLineage: resolved.declarationLineage,
        name: resolved.name,
        expectedReceiverTargetLineages: Object.freeze(
          [...resolved.receiverTargetLineages].sort()
        ),
      }
      return step.do === 'broadcast'
        ? { do: 'broadcast', broadcast }
        : step.maxTicks === undefined
          ? { do: 'broadcastAndWait', broadcast }
          : { do: 'broadcastAndWait', broadcast, maxTicks: step.maxTicks }
    }
    default:
      return step as IdentityBoundStepV1
  }
}

// lower one semantic policy against one exact artifact & side. a policy that
// cannot resolve every action is refused here, before any lane is dispatched.
export function lowerEditScenarioPolicyV1(input: {
  readonly policy: EditScenarioPolicyV1
  readonly semanticPolicySha256?: string
  readonly side: EditEvaluationSideV1
  readonly bindings: EditRuntimeBindingTableV1
  readonly artifact: EditRuntimeArtifactBindingV1
}): EditScenarioLoweringResultV1
{
  const { policy, side, bindings, artifact } = input
  if (policy.applicability === 'candidateOnly' && side === 'baseline')
    return {
      status: 'refused',
      scenarioId: policy.scenarioId,
      side,
      failures: Object.freeze([
        {
          stepIndex: -1,
          reason: 'policy-not-applicable-to-side' as const,
          detail:
            'a candidateOnly policy never runs on the baseline & can never carry shared preservation evidence',
        },
      ]),
    }
  const failures: EditScenarioLoweringFailureV1[] = []
  const steps: IdentityBoundStepV1[] = []
  policy.steps.forEach((step, stepIndex) =>
  {
    const lowered = lowerStep(step, stepIndex, bindings, artifact, side)
    if (isFailure(lowered)) failures.push(lowered)
    else steps.push(lowered)
  })
  if (failures.length > 0)
    return {
      status: 'refused',
      scenarioId: policy.scenarioId,
      side,
      failures: Object.freeze(failures),
    }
  const scenario: IdentityBoundScenarioV1 = Object.freeze({
    schemaVersion: IDENTITY_BOUND_SCENARIO_SCHEMA_VERSION,
    seed: policy.seed,
    fixedDateMs: policy.fixedDateMs,
    maxTicks: policy.maxTicks,
    steps: Object.freeze(steps),
  })
  return {
    status: 'lowered',
    lowered: Object.freeze({
      scenarioId: policy.scenarioId,
      side,
      artifactSha256: artifact.artifactSha256,
      manifestSha256: artifact.manifest.manifestSha256,
      semanticPolicySha256:
        input.semanticPolicySha256 ?? editSemanticScenarioPolicySha256(policy),
      loweringVersion: EDIT_SCENARIO_LOWERING_VERSION,
      scenario,
      loweredScenarioSha256: hashIdentityBoundScenario(scenario),
    }),
  }
}
