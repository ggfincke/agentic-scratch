// packages/runner/src/development/viewer.ts
// bind private inspector pages & animation previews to exact retained artifacts

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  classifyMediaForPreservation,
  DEFAULT_EDIT_ADMISSION_LIMITS,
  scanStrictJson,
  unpackSb3,
  type ProjectJson,
} from '@scratch-agent/sb3'
import { developmentJsonBytesV1, developmentSha256V1 } from './retention.js'
import {
  DevelopmentErrorV1,
  type DevelopmentArtifactRefV1,
  type DevelopmentLimitsV1,
  type DevelopmentTrace,
} from './types.js'
import type { DevelopmentStatusV1 } from './session.js'
import type { ProfileNumericSelectorV1 } from './profile-browser-types.js'
import type {
  DevelopmentClipPreviewV1,
  DevelopmentClipSourceV1,
  DevelopmentCostumeBoundsV1,
  DevelopmentOverlayV1,
  DevelopmentViewerLaneV1,
  DevelopmentViewerMediaV1,
  DevelopmentViewerModelV1,
} from './viewer-types.js'

export * from './viewer-types.js'

const PNG_VIEW_LIMITS = {
  ...DEFAULT_EDIT_ADMISSION_LIMITS,
  maxPngWidth: 4096,
  maxPngHeight: 4096,
  maxPngCanvasPixels: 16777216,
  maxPngInflatedSampleBytes: 128 * 1024 * 1024,
}

export function validateDevelopmentOverlaysV1(
  value: readonly DevelopmentOverlayV1[],
  maximum = 64
): readonly DevelopmentOverlayV1[]
{
  if (!Array.isArray(value) || value.length > maximum)
    fail('overlays exceed their finite count budget')
  const ids = new Set<string>()
  for (const overlay of value)
  {
    const keys =
      overlay.kind === 'rectangle'
        ? ['id', 'label', 'purpose', 'kind', 'x', 'y', 'width', 'height']
        : ['id', 'label', 'purpose', 'kind', 'x', 'y', 'radius']
    object(overlay, keys)
    text(overlay.id, 128)
    if (ids.has(overlay.id)) fail('overlay IDs must be unique')
    ids.add(overlay.id)
    if (overlay.label !== undefined) text(overlay.label, 80)
    if (
      !['rectangle', 'circle'].includes(overlay.kind) ||
      !['declared-collision', 'debug-region'].includes(overlay.purpose)
    )
      fail('overlay shape or purpose is unsupported')
    for (const value of [
      overlay.x,
      overlay.y,
      ...(overlay.kind === 'rectangle'
        ? [overlay.width, overlay.height]
        : [overlay.radius]),
    ])
    {
      if (typeof value === 'number')
      {
        if (!Number.isFinite(value) || Math.abs(value) > 10000)
          fail('overlay constants must be finite & bounded')
      }
      else
      {
        object(value, ['probe'])
        const selector = value.probe as ProfileNumericSelectorV1
        object(selector, ['targetIndex', 'instance', 'property'])
        if (
          !Number.isSafeInteger(selector.targetIndex) ||
          selector.targetIndex < 0 ||
          selector.targetIndex > 999
        )
          fail('overlay target selector is invalid')
        if (
          selector.instance !== undefined &&
          selector.instance !== 'original'
        )
        {
          object(selector.instance, ['cloneKey'])
          const key = selector.instance.cloneKey
          if (typeof key === 'string') text(key, 256)
          else if (
            typeof key !== 'boolean' &&
            (typeof key !== 'number' || !Number.isFinite(key))
          )
            fail('overlay clone key must be an exact scalar')
        }
        if (typeof selector.property === 'object')
        {
          object(selector.property, ['variableId'])
          text(selector.property.variableId, 256)
        }
        else if (
          ![
            'x',
            'y',
            'direction',
            'size',
            'volume',
            'costumeIndexOneBased',
          ].includes(selector.property)
        )
          fail('overlay property selector is unsupported')
      }
    }
    for (const extent of overlay.kind === 'rectangle'
      ? [overlay.width, overlay.height]
      : [overlay.radius])
      if (typeof extent === 'number' && extent <= 0)
        fail('constant overlay extents must be positive')
  }
  return JSON.parse(JSON.stringify(value)) as readonly DevelopmentOverlayV1[]
}

export async function developmentPngMetadataV1(
  bytes: Uint8Array
): Promise<{ width: number; height: number }>
{
  if (bytes.byteLength > 16 * 1024 * 1024)
    fail('one viewer PNG exceeds its 16 MiB encoded budget')
  const metadata = await classifyMediaForPreservation(
    bytes,
    PNG_VIEW_LIMITS,
    true
  )
  if (
    metadata.outcome !== 'metadataClassified' ||
    metadata.mediaType !== 'png' ||
    metadata.animationFrames !== 0
  )
    fail('viewer images require validated static PNG payloads')
  return { width: metadata.width, height: metadata.height }
}

export async function prepareDevelopmentClipPreviewV1(input: {
  sourceBytes: Uint8Array
  manifestBytes: Uint8Array
  sessionId: string
  root: string
  limits: DevelopmentLimitsV1
}): Promise<{
  preview: DevelopmentClipPreviewV1
  entries: readonly { key: string; bytes: Uint8Array; mimeType: string }[]
}>
{
  if (input.manifestBytes.byteLength > input.limits.maxClipSourceBytes)
    fail('clip manifest exceeds its byte budget')
  const source = parse(input.manifestBytes) as DevelopmentClipSourceV1
  object(source, ['schemaVersion', 'kind', 'sourceSha256', 'clips'])
  if (
    source.schemaVersion !== 1 ||
    source.kind !== 'development-clips-v1' ||
    source.sourceSha256 !== developmentSha256V1(input.sourceBytes) ||
    !Array.isArray(source.clips) ||
    source.clips.length > 128
  )
    fail('clip manifest must bind the exact retained source')
  const unpacked = await unpackSb3(input.sourceBytes)
  const project = JSON.parse(unpacked.projectJsonText) as ProjectJson
  const assets = new Map(
    unpacked.assets.map((asset) => [asset.path, asset.bytes])
  )
  const entries: { key: string; bytes: Uint8Array; mimeType: string }[] = []
  const images = new Map<
    string,
    { bounds: DevelopmentCostumeBoundsV1; artifact: DevelopmentArtifactRefV1 }
  >()
  const ids = new Set<string>()
  let count = 0
  let bytes = 0
  const clips: DevelopmentClipPreviewV1['clips'][number][] = []
  for (const clip of source.clips)
  {
    object(clip, ['id', 'name', 'targetIndex', 'loop', 'frames'])
    text(clip.id, 256)
    text(clip.name, 256)
    const clipIdentity = `${clip.targetIndex}:${clip.id}`
    if (
      ids.has(clipIdentity) ||
      !Number.isSafeInteger(clip.targetIndex) ||
      !project.targets[clip.targetIndex] ||
      typeof clip.loop !== 'boolean' ||
      !Array.isArray(clip.frames) ||
      !clip.frames.length
    )
      fail('clip identity, target or frames are invalid')
    ids.add(clipIdentity)
    const frames: DevelopmentClipPreviewV1['clips'][number]['frames'][number][] =
      []
    let duration = 0
    for (const frame of clip.frames)
    {
      object(frame, ['costumeIndexOneBased', 'durationMs'])
      if (
        ++count > input.limits.maxClipFrames ||
        !Number.isSafeInteger(frame.costumeIndexOneBased) ||
        frame.costumeIndexOneBased < 1 ||
        !Number.isSafeInteger(frame.durationMs) ||
        frame.durationMs < 1 ||
        frame.durationMs > 60000
      )
        fail('clip frames or durations exceed their finite bounds')
      duration += frame.durationMs
      if (duration > 600000) fail('clip duration exceeds ten minutes')
      const identity = `${clip.targetIndex}:${frame.costumeIndexOneBased}`
      let prepared = images.get(identity)
      if (!prepared)
      {
        const costume =
          project.targets[clip.targetIndex]!.costumes[
            frame.costumeIndexOneBased - 1
          ]
        if (!costume || costume.dataFormat !== 'png')
          fail('clip preview requires exact existing PNG costume indexes')
        const payload = assets.get(
          costume.md5ext ?? `${costume.assetId}.${costume.dataFormat}`
        )
        if (!payload)
          fail('clip costume payload is absent from the retained source')
        bytes += payload.byteLength
        if (bytes > Math.min(25 * 1024 * 1024, input.limits.maxEvidenceBytes))
          fail('clip preview PNGs exceed their aggregate encoded byte budget')
        const metadata = await developmentPngMetadataV1(payload)
        const bounds = costumeBounds(
          clip.targetIndex,
          frame.costumeIndexOneBased,
          costume,
          metadata
        )
        const key = `frame-${randomUUID()}.png`
        const artifact = {
          sessionId: input.sessionId,
          key,
          path: join(input.root, key),
          sha256: developmentSha256V1(payload),
          byteLength: payload.byteLength,
          mimeType: 'image/png',
        }
        entries.push({ key, bytes: payload, mimeType: 'image/png' })
        prepared = { bounds, artifact }
        images.set(identity, prepared)
      }
      frames.push({
        ...prepared.bounds,
        durationMs: frame.durationMs,
        image: prepared.artifact,
      })
    }
    clips.push({
      id: clip.id,
      name: clip.name,
      targetIndex: clip.targetIndex,
      loop: clip.loop,
      frames,
    })
  }
  return {
    preview: {
      schemaVersion: 1,
      kind: 'development-clip-preview-v1',
      sourceSha256: source.sourceSha256,
      sourceManifestSha256: developmentSha256V1(input.manifestBytes),
      clips,
    },
    entries,
  }
}

export async function createDevelopmentViewerV1(input: {
  primary: {
    status: DevelopmentStatusV1
    trace: DevelopmentTrace
    sourceBytes: Uint8Array
  }
  comparison?: {
    status: DevelopmentStatusV1
    trace: DevelopmentTrace
    sourceBytes: Uint8Array
  }
  overlays?: readonly DevelopmentOverlayV1[]
  clips?: DevelopmentClipPreviewV1
  reproduction?: unknown
  media?: readonly (DevelopmentViewerMediaV1 & { bytes: Uint8Array })[]
  limits: DevelopmentLimitsV1
}): Promise<{
  modelBytes: Uint8Array
  htmlBytes: Uint8Array
  model: DevelopmentViewerModelV1
}>
{
  const limitations = [
    'Navigation reads retained history; reversing the timeline never restores or drives a VM.',
    'Declared collision overlays are authored debug shapes. Dashed costume image bounds are visual extents.',
    'Natural scheduling and output audio remain timing diagnostics.',
  ]
  if (
    input.reproduction &&
    typeof input.reproduction === 'object' &&
    'schemaVersion' in input.reproduction &&
    input.reproduction.schemaVersion === 1
  )
    limitations.push(
      'Legacy reproduction is shown as recorded; it does not establish current browser chronology.'
    )
  const primary = await viewerLane(input.primary, limitations)
  const comparison = input.comparison
    ? await viewerLane(input.comparison, limitations)
    : null
  const media = input.media ?? []
  if (media.length > input.limits.maxEvidenceArtifacts)
    fail('viewer media count exceeds the finite artifact budget')
  let payloadBytes = 0
  for (const item of media)
  {
    if (
      developmentSha256V1(item.bytes) !== item.artifact.sha256 ||
      item.bytes.byteLength !== item.artifact.byteLength
    )
      fail('viewer media differs from its retained artifact identity')
    if (item.artifact.mimeType === 'image/png')
      await developmentPngMetadataV1(item.bytes)
    else if (!['audio/webm', 'audio/wav'].includes(item.artifact.mimeType))
      fail('viewer media must be local validated PNG or output audio')
    payloadBytes += item.bytes.byteLength
  }
  if (payloadBytes > input.limits.maxEvidenceBytes)
    fail('viewer media exceeds its aggregate encoded byte budget')
  const model: DevelopmentViewerModelV1 = {
    schemaVersion: 1,
    kind: 'development-viewer-v1',
    title: 'Scratch playtest inspector',
    primary,
    comparison,
    overlays: validateDevelopmentOverlaysV1(
      input.overlays ?? [],
      input.limits.maxOverlays
    ),
    media: media.map(({ bytes: _bytes, ...item }) => item),
    clips: input.clips ?? null,
    reproduction: input.reproduction ?? null,
    limitations: [...new Set(limitations)].slice(0, 64),
  }
  const modelBytes = developmentJsonBytesV1(model)
  const script = await readFile(
    new URL('./viewer-page.js', import.meta.url),
    'utf8'
  )
  if (/<\/script/i.test(script)) fail('viewer bundle cannot be embedded safely')
  const estimate =
    modelBytes.byteLength +
    Math.ceil((payloadBytes * 4) / 3) +
    Buffer.byteLength(script) +
    Buffer.byteLength(VIEWER_CSS) +
    16384
  if (
    modelBytes.byteLength > input.limits.maxViewerBytes ||
    estimate > input.limits.maxViewerBytes
  )
    fail('self-contained viewer exceeds its byte budget')
  const embedded = {
    ...model,
    media: media.map(({ bytes, ...item }) => ({
      ...item,
      dataUrl: `data:${item.artifact.mimeType};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`,
    })),
  }
  const data = JSON.stringify(embedded)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
  const scriptHash = createHash('sha256').update(script).digest('base64')
  const styleHash = createHash('sha256').update(VIEWER_CSS).digest('base64')
  const htmlBytes = Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src data: blob:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Scratch playtest inspector</title><style>${VIEWER_CSS}</style></head><body><main id="app"></main><script id="viewer-data" type="application/json">${data}</script><script>${script}</script></body></html>`
  )
  if (htmlBytes.byteLength > input.limits.maxViewerBytes)
    fail('rendered viewer exceeds its exact byte budget')
  return { modelBytes, htmlBytes, model }
}

async function viewerLane(
  input: {
    status: DevelopmentStatusV1
    trace: DevelopmentTrace
    sourceBytes: Uint8Array
  },
  limitations: string[]
): Promise<DevelopmentViewerLaneV1>
{
  if (input.trace.schemaVersion === 1)
    limitations.push(
      'Legacy input/frame ordering is shown as recorded; new exact reproduction is unavailable.'
    )
  else if (!input.trace.captureComplete)
    limitations.push(
      'Browser capture is incomplete; retained observations remain inspectable, but exact reproduction is unavailable.'
    )
  if (
    developmentSha256V1(input.sourceBytes) !== input.trace.sourceSha256 ||
    input.status.sourceSha256 !== input.trace.sourceSha256
  )
    fail('viewer lane source identity does not match its retained trace')
  const unpacked = await unpackSb3(input.sourceBytes)
  const project = JSON.parse(unpacked.projectJsonText) as ProjectJson
  const assets = new Map(
    unpacked.assets.map((asset) => [asset.path, asset.bytes])
  )
  const used = new Set(
    input.trace.frames.flatMap((frame) =>
      frame.targets.map(
        (target) => `${target.targetIndex}:${target.costumeIndexOneBased}`
      )
    )
  )
  const bounds: DevelopmentCostumeBoundsV1[] = []
  const metadataByPath = new Map<string, { width: number; height: number }>()
  for (const identity of [...used].slice(0, 256))
  {
    const [targetIndex, index] = identity.split(':').map(Number)
    const costume = project.targets[targetIndex!]?.costumes[index! - 1]
    if (!costume || costume.dataFormat !== 'png')
    {
      limitations.push(
        'Costume image bounds are unavailable for non-PNG or absent costume payloads.'
      )
      continue
    }
    const path = costume.md5ext ?? `${costume.assetId}.${costume.dataFormat}`
    const bytes = assets.get(path)
    if (!bytes) continue
    try
    {
      let metadata = metadataByPath.get(path)
      if (!metadata)
      {
        metadata = await developmentPngMetadataV1(bytes)
        metadataByPath.set(path, metadata)
      }
      bounds.push(costumeBounds(targetIndex!, index!, costume, metadata))
    }
    catch
    {
      limitations.push(
        'Some costume image bounds exceed preview support or validation budgets.'
      )
    }
  }
  if (used.size > 256)
    limitations.push(
      'Costume image bounds are limited to the first 256 referenced costumes per lane.'
    )
  return { status: input.status, trace: input.trace, costumeBounds: bounds }
}

function costumeBounds(
  targetIndex: number,
  index: number,
  costume: ProjectJson['targets'][number]['costumes'][number],
  metadata: { width: number; height: number }
): DevelopmentCostumeBoundsV1
{
  const rotationCenterX = costume.rotationCenterX ?? metadata.width / 2
  const rotationCenterY = costume.rotationCenterY ?? metadata.height / 2
  const bitmapResolution = costume.bitmapResolution ?? 1
  if (
    ![rotationCenterX, rotationCenterY, bitmapResolution].every(
      Number.isFinite
    ) ||
    bitmapResolution <= 0
  )
    fail('costume pivots or bitmap resolution are invalid')
  return {
    targetIndex,
    costumeIndexOneBased: index,
    costumeName: costume.name,
    ...metadata,
    rotationCenterX,
    rotationCenterY,
    bitmapResolution,
  }
}

function parse(bytes: Uint8Array): unknown
{
  return scanStrictJson(
    new TextDecoder('utf8', { fatal: true }).decode(bytes),
    { maxDepth: 64, maxMembersPerContainer: 10000, maxNodes: 100000 }
  ).value
}
function object(value: unknown, keys: readonly string[]): void
{
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail('viewer input contains unsupported fields or an invalid object')
}
function text(value: unknown, max: number): void
{
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    value.includes('\0')
  )
    fail('viewer identities must be nonempty bounded text')
}
function fail(message: string): never
{
  throw new DevelopmentErrorV1('development.viewer_refused', message)
}

const VIEWER_CSS = `:root{color-scheme:dark;--bg:#161a22;--panel:#202733;--line:#465164;--ink:#eef0f4;--muted:#b9c6d8;--accent:#70cddd;--collision:#ffb65a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:26px;margin:0}h2{font-size:17px;margin:0 0 12px}header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:20px}.muted,small{color:var(--muted)}.identity{font:12px ui-monospace,monospace;overflow-wrap:anywhere;max-width:720px}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0}button,select,input{font:inherit}button,select{background:#283140;color:inherit;border:1px solid var(--line);border-radius:5px;padding:8px 12px}button:disabled{opacity:.45}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}label{display:flex;align-items:center;gap:7px}input[type=range]{flex:1;min-width:170px;accent-color:var(--accent)}.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px}.stage{position:relative;width:100%;aspect-ratio:4/3;background:#eef0f4;border:1px solid var(--line);overflow:hidden}.stage canvas,.stage svg{position:absolute;width:100%;height:100%;inset:0}.stage svg{pointer-events:none}.caption{margin:8px 0;color:var(--muted)}.panels{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px;margin-top:24px}section{min-width:0}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;border-bottom:1px solid var(--line);padding:8px;vertical-align:top;overflow-wrap:anywhere}th{color:var(--muted);font-weight:500}code,pre{font:12px ui-monospace,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}details{margin:18px 0;border-top:1px solid var(--line);padding-top:14px}summary{cursor:pointer}.scroll{max-height:330px;overflow:auto}.marks{display:flex;flex-wrap:wrap;gap:8px}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.legend span::before{content:'';display:inline-block;width:20px;border-top:2px solid var(--accent);margin-right:7px}.legend span:nth-child(2)::before{border-color:var(--collision)}.legend span:nth-child(3)::before{border-color:#4d6b91;border-top-style:dashed}.clip canvas{max-width:480px;width:100%;aspect-ratio:1;background:#eee;background-image:conic-gradient(#d6d7d9 25%,#eee 0 50%,#d6d7d9 0 75%,#eee 0);background-size:16px 16px}.note{border-left:3px solid var(--accent);padding-left:12px}.warning{color:#ffca81}.hidden{display:none}audio{max-width:100%;width:350px}@media(max-width:800px){main{padding:16px}.panels{grid-template-columns:1fr}header{display:block}.lanes{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`
