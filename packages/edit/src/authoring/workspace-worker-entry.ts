// packages/edit/src/authoring/workspace-worker-entry.ts
// compute pure media prefixes & admitted candidates without host capabilities

import { parentPort, workerData } from 'node:worker_threads'
import {
  compileScratchWorkspaceV2,
  type WorkspacePreparedAssetV2,
} from '@scratch-agent/ir/authoring'
import {
  AssetPipelineJobV2,
  admitSb3ForEdit,
  estimateAudioNormalizationV1,
  normalizeAudioV1,
} from '@scratch-agent/sb3'
import {
  workspaceWorkerBytesV1,
  type WorkspaceWorkerDataV1,
  type WorkspaceWorkerPreparationV1,
  type WorkspaceWorkerPreparedV1,
  type WorkspaceWorkerResponseV1,
} from './workspace-worker-types.js'

function budgetFailure(message: string): never
{
  throw Object.assign(new Error(message), {
    code: 'authoring.worker_budget_exceeded',
  })
}

async function prepare(
  input: WorkspaceWorkerPreparationV1
): Promise<WorkspaceWorkerPreparedV1>
{
  const job = new AssetPipelineJobV2(input.preprocessingLimits)
  const assets: WorkspacePreparedAssetV2[] = []
  let outputBytes = 0
  let audioPeak = 0
  let consumed = 0
  let nextAudio: WorkspaceWorkerPreparedV1['nextAudio'] = null
  const add = (asset: WorkspacePreparedAssetV2) =>
  {
    outputBytes += asset.bytes.byteLength
    if (outputBytes > input.maximumOutputBytes)
      budgetFailure('prepared worker output exceeds the remaining asset budget')
    assets.push(asset)
  }
  for (const { asset, bytes } of input.assets)
  {
    if (asset.kind === 'sound')
    {
      const options = {
        format: asset.format,
        sampleRate: asset.sampleRate,
        channels: asset.channels,
        limits: input.audioLimits,
      }
      const estimate = estimateAudioNormalizationV1(bytes, options)
      if (!estimate.native)
      {
        nextAudio = estimate
        break
      }
      audioPeak = Math.max(audioPeak, estimate.workingByteBound)
      const normalized = await normalizeAudioV1(bytes, options)
      add({
        logicalAssetId: asset.id,
        kind: 'sound',
        bytes: normalized.bytes,
        sourceSha256: normalized.sourceSha256,
        transformSha256: normalized.transformationSha256,
        outputSha256: normalized.outputSha256,
        metadata: {
          identity: normalized.identity,
          settings: normalized.settings,
          decoder: normalized.decoder,
        },
      })
    }
    else
    {
      const frames =
        asset.kind === 'costume'
          ? [
              await job.preparePngFrame({
                bytes,
                expectedSourceSha256: asset.source.expectedSha256,
                slice: asset.slice,
                pivot: asset.pivot,
                transforms: asset.transforms,
              }),
            ]
          : await job.preparePngSheet({
              bytes,
              expectedSourceSha256: asset.source.expectedSha256,
              slicing: asset.slicing,
              frames: asset.frames,
            })
      for (const [index, frame] of frames.entries())
        add({
          logicalAssetId:
            asset.kind === 'costume' ? asset.id : asset.frames[index]!.id,
          kind: 'costume',
          bytes: frame.bytes,
          sourceSha256: frame.sourceSha256,
          transformSha256: frame.transformSha256,
          outputSha256: frame.outputSha256,
          metadata: {
            width: frame.width,
            height: frame.height,
            pivot: frame.pivot,
            md5ext: frame.md5ext,
            bitmapResolution: 1,
            dataFormat: 'png',
          },
        })
    }
    consumed++
  }
  return {
    assets,
    consumed,
    nextAudio,
    costs: {
      pixelVisits: job.usage().pixelVisits,
      peakDecodedBytes: Math.max(job.usage().peakDecodedBytes, audioPeak),
    },
  }
}

async function run(data: WorkspaceWorkerDataV1)
{
  const request = data.request
  if (request.kind === 'prepare') return prepare(request.input)
  const limits = {
    limits: request.archiveLimits,
    editLimits: request.editLimits,
  }
  await admitSb3ForEdit(request.input.baselineBytes, limits)
  const result = await compileScratchWorkspaceV2(request.input)
  await admitSb3ForEdit(result.candidateBytes, limits)
  return {
    plan: result.plan,
    candidateBytes: result.candidateBytes,
    diff: result.diff,
  }
}

try
{
  const data = workerData as WorkspaceWorkerDataV1
  const value = await run(data)
  const size = workspaceWorkerBytesV1(value, data.maximumMetadataBytes)
  if (
    size.payloadBytes > data.maximumOutputBytes ||
    size.metadataBytes > data.maximumMetadataBytes
  )
    budgetFailure(
      'worker reply exceeds its reserved payload or metadata budget'
    )
  // fresh transfer buffers avoid pooled Buffer slabs & duplicate reply payloads
  const copies = new Map(
    size.buffers.map((bytes) => [bytes, Uint8Array.from(bytes)])
  )
  const replace = (entry: unknown): unknown =>
  {
    if (entry instanceof Uint8Array) return copies.get(entry)!
    if (Array.isArray(entry)) return entry.map(replace)
    if (entry !== null && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [key, replace(child)])
      )
    return entry
  }
  const response: WorkspaceWorkerResponseV1 = {
    ok: true,
    value: replace(value) as typeof value,
  }
  parentPort!.postMessage(
    response,
    [...copies.values()].map((bytes) => bytes.buffer)
  )
}
catch (error)
{
  const response: WorkspaceWorkerResponseV1 = {
    ok: false,
    code:
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'authoring.worker_failed',
    message: error instanceof Error ? error.message : String(error),
  }
  parentPort!.postMessage(response)
}
finally
{
  parentPort!.close()
}
