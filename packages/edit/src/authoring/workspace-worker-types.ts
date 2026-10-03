// packages/edit/src/authoring/workspace-worker-types.ts
// bound pure authoring worker snapshots, results & transfer accounting

import type {
  WorkspaceAssetV2,
  WorkspaceCompilationInputV2,
  WorkspaceCompilationResultV2,
  WorkspacePreparedAssetV2,
} from '@scratch-agent/ir/authoring'
import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  type AssetPipelineLimitsV2,
  type AudioNormalizationEstimateV1,
  type AudioPipelineLimitsV1,
  type EditAdmissionLimits,
  type Sb3Limits,
} from '@scratch-agent/sb3'
import { AuthoringWorkspaceErrorV1 } from './workspace-types.js'

export interface WorkspaceWorkerPreparationV1
{
  readonly assets: readonly {
    readonly asset: WorkspaceAssetV2
    readonly bytes: Uint8Array
  }[]
  readonly preprocessingLimits: AssetPipelineLimitsV2
  readonly audioLimits: AudioPipelineLimitsV1
  readonly maximumOutputBytes: number
}

export interface WorkspaceWorkerPreparedV1
{
  readonly assets: readonly WorkspacePreparedAssetV2[]
  readonly consumed: number
  readonly nextAudio: AudioNormalizationEstimateV1 | null
  readonly costs: {
    readonly pixelVisits: number
    readonly peakDecodedBytes: number
  }
}

export type WorkspaceWorkerCompilationV1 = Pick<
  WorkspaceCompilationResultV2,
  'plan' | 'candidateBytes' | 'diff'
>

export type WorkspaceWorkerRequestV1 =
  | { readonly kind: 'prepare'; readonly input: WorkspaceWorkerPreparationV1 }
  | {
      readonly kind: 'compile'
      readonly input: WorkspaceCompilationInputV2
      readonly archiveLimits: Sb3Limits
      readonly editLimits: EditAdmissionLimits
    }

export type WorkspaceWorkerResultV1<
  Kind extends WorkspaceWorkerRequestV1['kind'],
> = Kind extends 'prepare'
  ? WorkspaceWorkerPreparedV1
  : WorkspaceWorkerCompilationV1

export interface WorkspaceWorkerBudgetV1
{
  readonly maximumBytes: number
  readonly parentBytes: number
  readonly outputBytes: number
  readonly decodedBytes: number
  readonly metadataBytes: number
}

export interface WorkspaceWorkerDataV1
{
  readonly request: WorkspaceWorkerRequestV1
  readonly maximumOutputBytes: number
  readonly maximumMetadataBytes: number
}

export type WorkspaceWorkerResponseV1 =
  | {
      readonly ok: true
      readonly value: WorkspaceWorkerPreparedV1 | WorkspaceWorkerCompilationV1
    }
  | { readonly ok: false; readonly code: string; readonly message: string }

// bound metadata before cloning & recognize Buffer before its JSON conversion
export function workspaceWorkerBytesV1(
  value: unknown,
  maximumMetadataBytes: number
): {
  payloadBytes: number
  metadataBytes: number
  buffers: readonly Uint8Array[]
}
{
  const buffers = new Set<Uint8Array>()
  const ancestors = new Set<object>()
  let metadataBytes = 0
  let nodes = 0
  const charge = (bytes: number) =>
  {
    metadataBytes += bytes
    if (
      !Number.isSafeInteger(metadataBytes) ||
      metadataBytes > maximumMetadataBytes
    )
      throw new AuthoringWorkspaceErrorV1(
        'authoring.worker_budget_exceeded',
        'worker metadata exceeds its bounded copy budget'
      )
  }
  const visit = (entry: unknown, depth: number): void =>
  {
    if (
      ++nodes > DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes ||
      depth > DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth + 32
    )
      throw new AuthoringWorkspaceErrorV1(
        'authoring.worker_budget_exceeded',
        'worker metadata exceeds its bounded traversal'
      )
    charge(64)
    if (entry instanceof Uint8Array)
    {
      buffers.add(entry)
      return
    }
    if (typeof entry === 'string') charge(2 + 6 * entry.length)
    if (entry !== null && typeof entry === 'object')
    {
      if (ancestors.has(entry))
        throw new AuthoringWorkspaceErrorV1(
          'authoring.worker_budget_exceeded',
          'worker metadata must be acyclic'
        )
      ancestors.add(entry)
      for (const key in entry)
      {
        if (!Object.hasOwn(entry, key)) continue
        charge(3 + 6 * key.length)
        visit((entry as Record<string, unknown>)[key], depth + 1)
      }
      ancestors.delete(entry)
    }
  }
  visit(value, 0)
  return {
    payloadBytes: [...buffers].reduce(
      (sum, bytes) => sum + bytes.byteLength,
      0
    ),
    metadataBytes,
    buffers: [...buffers],
  }
}
