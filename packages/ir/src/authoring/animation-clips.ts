// packages/ir/src/authoring/animation-clips.ts
// bind named animation frames & pivot edits to exact costume & payload identity

import type { Costume } from '@scratch-agent/sb3'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import type { ProjectIR } from '../project/project-ir.js'
import { mediaArchivePathV1 } from '../edit/operations/media-operations.js'

export interface AnimationClipV2
{
  readonly id: string
  readonly name: string
  readonly loop: boolean
  readonly frames: readonly {
    readonly logicalAssetId: string
    readonly durationMs: number
  }[]
}

export interface AnimationCostumeBindingV2
{
  readonly logicalAssetId: string
  readonly costumeName: string
  readonly outputSha256: string
}

export interface ResolvedAnimationFrameV2
{
  readonly logicalAssetId: string
  readonly costumeName: string
  readonly costumeIndexOneBased: number
  readonly durationMs: number
  readonly archivePath: string
  readonly payloadSha256: string
  readonly rotationCenterX: number
  readonly rotationCenterY: number
  readonly bitmapResolution: number
}

export interface ResolvedAnimationClipV2
{
  readonly id: string
  readonly name: string
  readonly loop: boolean
  readonly frames: readonly ResolvedAnimationFrameV2[]
  readonly totalDurationMs: number
  readonly targetIndex: number
  readonly resolutionSha256: string
  readonly tables: {
    readonly costumeNames: readonly string[]
    readonly costumeIndexesOneBased: readonly number[]
    readonly durationsMs: readonly number[]
  }
}

export const ANIMATION_CLIP_LIMITS_V2 = Object.freeze({
  maximumClips: 128,
  maximumTotalFrames: 4096,
  maximumFrameDurationMs: 60000,
  maximumClipDurationMs: 600000,
  maximumIdentityLength: 256,
})

function fail(code: string, message: string): never
{
  throw Object.assign(new Error(message), { code })
}

function identity(value: string, role: string): void
{
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > ANIMATION_CLIP_LIMITS_V2.maximumIdentityLength ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  )
    fail(
      'authoring.invalid_animation',
      `${role} must be a bounded nonempty identifier`
    )
}

function hash(value: string, role: string): void
{
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    fail('authoring.invalid_animation', `${role} must be a SHA-256 identity`)
}

function digest(value: unknown): string
{
  return sha256Hex(canonicalJsonBytesV1(value))
}

function payload(
  project: ProjectIR,
  costume: Costume
): {
  readonly archivePath: string
  readonly payloadSha256: string
}
{
  const archivePath = mediaArchivePathV1(costume)
  const matches = project.assets.filter((asset) => asset.path === archivePath)
  if (matches.length !== 1)
    return fail(
      'authoring.missing_asset',
      `costume ${costume.name} has no exact retained payload`
    )
  return { archivePath, payloadSha256: sha256Hex(matches[0]!.bytes) }
}

export function resolveAnimationClipsV2(
  clips: readonly AnimationClipV2[],
  project: ProjectIR,
  targetIndex: number,
  bindings: readonly AnimationCostumeBindingV2[]
): readonly ResolvedAnimationClipV2[]
{
  const target = project.json.targets[targetIndex]
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || !target)
    return fail('authoring.invalid_target', 'animation target is absent')
  if (
    clips.length > ANIMATION_CLIP_LIMITS_V2.maximumClips ||
    bindings.length > 1024
  )
    return fail(
      'authoring.animation_budget_exceeded',
      'animation manifest exceeds its clip or target costume budget'
    )
  const byId = new Map<string, AnimationCostumeBindingV2>()
  for (const binding of bindings)
  {
    identity(binding.logicalAssetId, 'logical asset ID')
    identity(binding.costumeName, 'costume name')
    hash(binding.outputSha256, 'prepared asset hash')
    if (byId.has(binding.logicalAssetId))
      return fail(
        'authoring.duplicate_identity',
        `logical asset ${binding.logicalAssetId} is repeated`
      )
    byId.set(binding.logicalAssetId, binding)
  }
  const clipIds = new Set<string>()
  const clipNames = new Set<string>()
  let totalFrames = 0
  const resolvedAssets = new Map<
    string,
    Omit<ResolvedAnimationFrameV2, 'durationMs'>
  >()
  return Object.freeze(
    clips.map((clip) =>
    {
      identity(clip.id, 'clip ID')
      identity(clip.name, 'clip name')
      if (clipIds.has(clip.id) || clipNames.has(clip.name))
        return fail(
          'authoring.duplicate_identity',
          'clip IDs and names must each be unique'
        )
      if (typeof clip.loop !== 'boolean' || clip.frames.length === 0)
        return fail(
          'authoring.invalid_animation',
          `clip ${clip.id} must have a loop flag and frames`
        )
      clipIds.add(clip.id)
      clipNames.add(clip.name)
      totalFrames += clip.frames.length
      if (totalFrames > ANIMATION_CLIP_LIMITS_V2.maximumTotalFrames)
        return fail(
          'authoring.animation_budget_exceeded',
          'animation manifest exceeds its frame budget'
        )
      let totalDurationMs = 0
      const frames = Object.freeze(
        clip.frames.map((frame) =>
        {
          identity(frame.logicalAssetId, 'frame logical asset ID')
          if (
            !Number.isSafeInteger(frame.durationMs) ||
            frame.durationMs < 1 ||
            frame.durationMs > ANIMATION_CLIP_LIMITS_V2.maximumFrameDurationMs
          )
            return fail(
              'authoring.invalid_animation',
              `clip ${clip.id} has an invalid frame duration`
            )
          totalDurationMs += frame.durationMs
          if (totalDurationMs > ANIMATION_CLIP_LIMITS_V2.maximumClipDurationMs)
            return fail(
              'authoring.animation_budget_exceeded',
              `clip ${clip.id} exceeds its duration budget`
            )
          let resolved = resolvedAssets.get(frame.logicalAssetId)
          if (!resolved)
          {
            const binding = byId.get(frame.logicalAssetId)
            if (!binding)
              return fail(
                'authoring.missing_asset',
                `clip ${clip.id} references absent asset ${frame.logicalAssetId}`
              )
            const matches = target.costumes.flatMap((costume, ordinal) =>
              costume.name === binding.costumeName ? [{ costume, ordinal }] : []
            )
            if (matches.length !== 1)
              return fail(
                'authoring.ambiguous_costume',
                `asset ${binding.logicalAssetId} has no unique costume name`
              )
            const { costume, ordinal } = matches[0]!
            const retained = payload(project, costume)
            if (retained.payloadSha256 !== binding.outputSha256)
              return fail(
                'authoring.asset_identity_mismatch',
                `asset ${binding.logicalAssetId} payload differs from preparation`
              )
            const bitmapResolution = costume.bitmapResolution ?? 1
            if (
              !Number.isFinite(costume.rotationCenterX) ||
              !Number.isFinite(costume.rotationCenterY) ||
              !Number.isFinite(bitmapResolution) ||
              bitmapResolution <= 0
            )
              return fail(
                'authoring.invalid_pivot',
                `costume ${costume.name} has no finite pivot and bitmap resolution`
              )
            resolved = Object.freeze({
              logicalAssetId: binding.logicalAssetId,
              costumeName: costume.name,
              costumeIndexOneBased: ordinal + 1,
              ...retained,
              rotationCenterX: costume.rotationCenterX!,
              rotationCenterY: costume.rotationCenterY!,
              bitmapResolution,
            })
            resolvedAssets.set(frame.logicalAssetId, resolved)
          }
          return Object.freeze({ ...resolved, durationMs: frame.durationMs })
        })
      )
      const tables = Object.freeze({
        costumeNames: Object.freeze(frames.map((frame) => frame.costumeName)),
        costumeIndexesOneBased: Object.freeze(
          frames.map((frame) => frame.costumeIndexOneBased)
        ),
        durationsMs: Object.freeze(frames.map((frame) => frame.durationMs)),
      })
      const value = {
        id: clip.id,
        name: clip.name,
        loop: clip.loop,
        frames,
        totalDurationMs,
        targetIndex,
        tables,
      }
      return Object.freeze({
        ...value,
        resolutionSha256: digest({
          kind: 'animation-clip-resolution',
          schemaVersion: 2,
          ...value,
        }),
      })
    })
  )
}

export interface CostumePivotEditV2
{
  readonly kind: 'costume.setPivot'
  readonly targetIndex: number
  readonly costumeIndexOneBased: number
  readonly expectedIdentitySha256: string
  readonly rotationCenterX: number
  readonly rotationCenterY: number
}

function pivotSlot(
  project: ProjectIR,
  targetIndex: number,
  costumeIndexOneBased: number
)
{
  const target = project.json.targets[targetIndex]
  const costume = target?.costumes[costumeIndexOneBased - 1]
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    !Number.isSafeInteger(costumeIndexOneBased) ||
    costumeIndexOneBased < 1 ||
    !target ||
    !costume
  )
    return fail(
      'authoring.invalid_target',
      'pivot edit names an absent costume slot'
    )
  return { target, costume, ...payload(project, costume) }
}

export function costumePivotIdentityV2(
  project: ProjectIR,
  targetIndex: number,
  costumeIndexOneBased: number
): string
{
  const { target, costume, archivePath, payloadSha256 } = pivotSlot(
    project,
    targetIndex,
    costumeIndexOneBased
  )
  return digest({
    kind: 'costume-pivot-identity',
    schemaVersion: 2,
    targetIndex,
    costumeIndexOneBased,
    targetSha256: digest(target),
    costumeSha256: digest(costume),
    archivePath,
    payloadSha256,
  })
}

export function applyCostumePivotEditV2(
  project: ProjectIR,
  operation: CostumePivotEditV2
)
{
  if (
    operation.kind !== 'costume.setPivot' ||
    !Number.isFinite(operation.rotationCenterX) ||
    !Number.isFinite(operation.rotationCenterY)
  )
    return fail(
      'authoring.invalid_pivot',
      'pivot edit requires finite center coordinates'
    )
  hash(operation.expectedIdentitySha256, 'expected pivot identity')
  const beforeIdentitySha256 = costumePivotIdentityV2(
    project,
    operation.targetIndex,
    operation.costumeIndexOneBased
  )
  if (beforeIdentitySha256 !== operation.expectedIdentitySha256)
    return fail(
      'authoring.stale_identity',
      'pivot edit target, record or payload changed'
    )
  const { costume, archivePath, payloadSha256 } = pivotSlot(
    project,
    operation.targetIndex,
    operation.costumeIndexOneBased
  )
  const before = Object.freeze({
    rotationCenterX: costume.rotationCenterX ?? null,
    rotationCenterY: costume.rotationCenterY ?? null,
  })
  costume.rotationCenterX = operation.rotationCenterX
  costume.rotationCenterY = operation.rotationCenterY
  return Object.freeze({
    schemaVersion: 2 as const,
    operationKind: operation.kind,
    targetIndex: operation.targetIndex,
    costumeIndexOneBased: operation.costumeIndexOneBased,
    archivePath,
    payloadSha256,
    before,
    after: Object.freeze({
      rotationCenterX: operation.rotationCenterX,
      rotationCenterY: operation.rotationCenterY,
    }),
    beforeIdentitySha256,
    afterIdentitySha256: costumePivotIdentityV2(
      project,
      operation.targetIndex,
      operation.costumeIndexOneBased
    ),
  })
}
