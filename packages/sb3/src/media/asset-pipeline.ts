// packages/sb3/src/media/asset-pipeline.ts
// deterministic PNG frames, pivots & previews under one sequential job budget

import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

import { DEFAULT_SB3_LIMITS } from '../admission/limits.js'
import { DEFAULT_EDIT_ADMISSION_LIMITS } from '../edit-admission/edit-admission-limits.js'
import {
  ASSET_PIPELINE_CODES_V2,
  AssetPipelineErrorV2,
  AssetPreprocessingBudgetV2,
} from './asset-pipeline-budget.js'
import type {
  AssetPipelineLimitsV2,
  AssetPipelineUsageV2,
} from './asset-pipeline-budget.js'
import { classifyMediaForPreservation, md5Hex } from './media.js'

export {
  ASSET_PIPELINE_CODES_V2,
  ASSET_PIPELINE_LIMITS_V2,
  AssetPipelineErrorV2,
  AssetPreprocessingBudgetV2,
} from './asset-pipeline-budget.js'
export type {
  AssetPipelineLimitsV2,
  AssetPipelineUsageV2,
} from './asset-pipeline-budget.js'

export interface PngRectangleV2
{
  x: number
  y: number
  width: number
  height: number
}

export interface PngPivotV2
{
  x: number
  y: number
}

export type PngRgbV2 = readonly [number, number, number]

export type PngTransformV2 =
  | ({ kind: 'crop' } & PngRectangleV2)
  | { kind: 'resizeNearest'; width: number; height: number }
  | { kind: 'flip'; horizontal: boolean; vertical: boolean }
  | {
      kind: 'paletteMap'
      mappings: readonly { from: PngRgbV2; to: PngRgbV2 }[]
    }

export interface PngFrameEditsV2
{
  pivot?: PngPivotV2
  transforms?: readonly PngTransformV2[]
}

export interface PreparePngFrameInputV2 extends PngFrameEditsV2
{
  bytes: Uint8Array
  expectedSourceSha256?: string
  slice?: PngRectangleV2
}

export type PngSheetSlicingV2 =
  | {
      kind: 'grid'
      cellWidth: number
      cellHeight: number
      columns: number
      rows: number
      startX?: number
      startY?: number
      spacingX?: number
      spacingY?: number
    }
  | { kind: 'rectangles'; rectangles: readonly PngRectangleV2[] }

export interface PreparePngSheetInputV2
{
  bytes: Uint8Array
  expectedSourceSha256?: string
  slicing: PngSheetSlicingV2
  frames?: readonly PngFrameEditsV2[]
}

export interface PreparedPngFrameV2
{
  bytes: Uint8Array
  width: number
  height: number
  pivot: Readonly<PngPivotV2>
  sourceSha256: string
  transformSha256: string
  outputSha256: string
  md5ext: string
  dataFormat: 'png'
  bitmapResolution: 1
  costs: Readonly<{ pixelVisits: number; outputBytes: number }>
}

export interface RenderPngPreviewInputV2
{
  frames: readonly PreparedPngFrameV2[]
  mode: 'contact' | 'origins' | 'adjacent'
  columns?: number
  padding?: number
  gridSize?: number
}

export interface PreparedPngPreviewV2
{
  bytes: Uint8Array
  width: number
  height: number
  outputSha256: string
  transformSha256: string
  mode: RenderPngPreviewInputV2['mode']
  placements: readonly Readonly<{
    frameIndex: number
    x: number
    y: number
    pivot: Readonly<PngPivotV2>
  }>[]
  costs: Readonly<{ pixelVisits: number; outputBytes: number }>
}

interface RgbaImage
{
  width: number
  height: number
  data: Buffer
  release: () => void
}

interface FramePlan
{
  slice: PngRectangleV2
  pivot: PngPivotV2
  transforms: PngTransformV2[]
}

const MAX_FRAMES = DEFAULT_EDIT_ADMISSION_LIMITS.maxCostumeRecords
const MAX_PREVIEW_FRAMES = 256
const MAX_PALETTE_MAPPINGS = 256
const SHA256 = /^[a-f0-9]{64}$/u
const STREAM_WORKING_BYTES = 64 * 1024

function invalid(message: string): never
{
  throw new AssetPipelineErrorV2(ASSET_PIPELINE_CODES_V2.invalidInput, message)
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function evidenceHash(value: unknown): string
{
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'))
}

function integer(value: number, name: string, minimum = 0): number
{
  if (!Number.isSafeInteger(value) || value < minimum)
  {
    return invalid(`${name} must be a safe integer at least ${minimum}`)
  }
  return value
}

function dimensions(width: number, height: number): void
{
  integer(width, 'width', 1)
  integer(height, 'height', 1)
  if (
    width > DEFAULT_EDIT_ADMISSION_LIMITS.maxPngWidth ||
    height > DEFAULT_EDIT_ADMISSION_LIMITS.maxPngHeight ||
    width * height > DEFAULT_EDIT_ADMISSION_LIMITS.maxPngCanvasPixels
  )
  {
    invalid('PNG dimensions exceed the existing edit admission profile')
  }
}

function pivotCopy(pivot: PngPivotV2): PngPivotV2
{
  if (
    !pivot ||
    !Number.isFinite(pivot.x) ||
    !Number.isFinite(pivot.y) ||
    Math.abs(pivot.x) > Number.MAX_SAFE_INTEGER ||
    Math.abs(pivot.y) > Number.MAX_SAFE_INTEGER
  )
  {
    invalid('pivot coordinates must be finite, safely representable numbers')
  }
  return { x: pivot.x, y: pivot.y }
}

function rectangleCopy(rect: PngRectangleV2): PngRectangleV2
{
  if (!rect) return invalid('a slicing rectangle is required')
  integer(rect.x, 'rectangle x')
  integer(rect.y, 'rectangle y')
  dimensions(rect.width, rect.height)
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function assertRectangle(
  rect: PngRectangleV2,
  width: number,
  height: number
): void
{
  if (rect.x + rect.width > width || rect.y + rect.height > height)
  {
    invalid('crop or slicing rectangle extends outside its image')
  }
}

function rgbCopy(rgb: PngRgbV2): [number, number, number]
{
  if (
    !Array.isArray(rgb) ||
    rgb.length !== 3 ||
    [0, 1, 2].some(
      (index) =>
        !Number.isInteger(rgb[index]) || rgb[index]! < 0 || rgb[index]! > 255
    )
  )
  {
    return invalid('palette colors must contain exactly three 8-bit RGB values')
  }
  return [rgb[0]!, rgb[1]!, rgb[2]!]
}

function transformCopy(transform: PngTransformV2): PngTransformV2
{
  if (!transform) return invalid('a transform is required')
  switch (transform.kind)
  {
    case 'crop':
      return { kind: 'crop', ...rectangleCopy(transform) }
    case 'resizeNearest':
      dimensions(transform.width, transform.height)
      return {
        kind: 'resizeNearest',
        width: transform.width,
        height: transform.height,
      }
    case 'flip':
      if (
        typeof transform.horizontal !== 'boolean' ||
        typeof transform.vertical !== 'boolean'
      )
      {
        return invalid('flip must explicitly select horizontal & vertical axes')
      }
      return {
        kind: 'flip',
        horizontal: transform.horizontal,
        vertical: transform.vertical,
      }
    case 'paletteMap':
    {
      if (
        !Array.isArray(transform.mappings) ||
        transform.mappings.length > MAX_PALETTE_MAPPINGS
      )
      {
        return invalid(
          `palette mapping supports at most ${MAX_PALETTE_MAPPINGS} colors`
        )
      }
      const seen = new Set<string>()
      const mappings = transform.mappings.map((mapping) =>
      {
        const from = rgbCopy(mapping.from)
        const to = rgbCopy(mapping.to)
        const key = from.join(',')
        if (seen.has(key))
          return invalid('palette source colors must be unique')
        seen.add(key)
        return { from, to }
      })
      mappings.sort(
        (a, b) =>
          a.from[0] - b.from[0] ||
          a.from[1] - b.from[1] ||
          a.from[2] - b.from[2]
      )
      return { kind: 'paletteMap', mappings }
    }
    default:
      return invalid('unsupported PNG transform')
  }
}

// snapshots precede the first await, so the caller cannot change admitted work
function snapshotBytes(bytes: Uint8Array, expectedSha256?: string): Buffer
{
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > DEFAULT_SB3_LIMITS.maxAssetBytes
  )
  {
    return invalid(
      `PNG payload must be at most ${DEFAULT_SB3_LIMITS.maxAssetBytes} bytes`
    )
  }
  if (expectedSha256 !== undefined && !SHA256.test(expectedSha256))
  {
    return invalid('expected source SHA-256 must be lowercase hexadecimal')
  }
  const snapshot = Buffer.from(bytes)
  if (expectedSha256 !== undefined && sha256(snapshot) !== expectedSha256)
  {
    throw new AssetPipelineErrorV2(
      ASSET_PIPELINE_CODES_V2.sourceChanged,
      'PNG source bytes differ from the expected SHA-256'
    )
  }
  return snapshot
}

// this rejects animated input before its extra frames can consume inflate work
function sourceHeader(bytes: Buffer): { width: number; height: number }
{
  if (
    bytes.byteLength < 33 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
  {
    return invalid('input must be a PNG with a complete IHDR')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  dimensions(width, height)
  let offset = 8
  while (offset + 12 <= bytes.byteLength)
  {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.byteLength - offset - 12)
    {
      return invalid('PNG contains a truncated chunk')
    }
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL')
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.unsupportedPng,
        'APNG input requires explicit static frame export before import'
      )
    }
    offset += length + 12
  }
  return { width, height }
}

function framePlan(
  width: number,
  height: number,
  edits: PngFrameEditsV2,
  slice: PngRectangleV2 | undefined,
  maxTransforms: number
): FramePlan
{
  const rect =
    slice === undefined ? { x: 0, y: 0, width, height } : rectangleCopy(slice)
  assertRectangle(rect, width, height)
  if (edits.transforms !== undefined && !Array.isArray(edits.transforms))
  {
    return invalid('transforms must be an array')
  }
  if (
    (edits.transforms?.length ?? 0) + (slice === undefined ? 0 : 1) >
    maxTransforms
  )
  {
    throw new AssetPipelineErrorV2(
      ASSET_PIPELINE_CODES_V2.budgetExceeded,
      `slicing & edits exceed ${maxTransforms} transforms per frame`
    )
  }
  const transforms = (edits.transforms ?? []).map(transformCopy)
  let currentWidth = rect.width
  let currentHeight = rect.height
  for (const transform of transforms)
  {
    if (transform.kind === 'crop')
    {
      assertRectangle(transform, currentWidth, currentHeight)
      currentWidth = transform.width
      currentHeight = transform.height
    }
    else if (transform.kind === 'resizeNearest')
    {
      currentWidth = transform.width
      currentHeight = transform.height
    }
  }
  return {
    slice: rect,
    pivot:
      edits.pivot === undefined
        ? { x: width / 2, y: height / 2 }
        : pivotCopy(edits.pivot),
    transforms,
  }
}

function sheetRectangles(slicing: PngSheetSlicingV2): PngRectangleV2[]
{
  if (!slicing) return invalid('an explicit sheet slicing layout is required')
  if (slicing.kind === 'rectangles')
  {
    if (
      !Array.isArray(slicing.rectangles) ||
      slicing.rectangles.length < 1 ||
      slicing.rectangles.length > MAX_FRAMES
    )
    {
      return invalid(`sheet slicing requires 1-${MAX_FRAMES} rectangles`)
    }
    return slicing.rectangles.map(rectangleCopy)
  }
  if (slicing.kind !== 'grid')
    return invalid('unsupported sheet slicing layout')
  dimensions(slicing.cellWidth, slicing.cellHeight)
  integer(slicing.columns, 'grid columns', 1)
  integer(slicing.rows, 'grid rows', 1)
  if (slicing.columns * slicing.rows > MAX_FRAMES)
  {
    return invalid(`sheet grid exceeds ${MAX_FRAMES} frames`)
  }
  const startX = integer(slicing.startX ?? 0, 'grid startX')
  const startY = integer(slicing.startY ?? 0, 'grid startY')
  const spacingX = integer(slicing.spacingX ?? 0, 'grid spacingX')
  const spacingY = integer(slicing.spacingY ?? 0, 'grid spacingY')
  const rectangles: PngRectangleV2[] = []
  for (let y = 0; y < slicing.rows; y += 1)
  {
    for (let x = 0; x < slicing.columns; x += 1)
    {
      rectangles.push(
        rectangleCopy({
          x: startX + x * (slicing.cellWidth + spacingX),
          y: startY + y * (slicing.cellHeight + spacingY),
          width: slicing.cellWidth,
          height: slicing.cellHeight,
        })
      )
    }
  }
  return rectangles
}

function rgbKey(r: number, g: number, b: number): number
{
  return r * 65536 + g * 256 + b
}

export class AssetPipelineJobV2
{
  #budget: AssetPreprocessingBudgetV2
  #active = false
  #preparedFrames = 0
  #outputBytes = 0

  constructor(limits: Partial<AssetPipelineLimitsV2> = {})
  {
    this.#budget = new AssetPreprocessingBudgetV2(limits)
  }

  usage(): Readonly<
    AssetPipelineUsageV2 & {
      preparedFrames: number
      outputBytes: number
    }
  >
  {
    return Object.freeze({
      ...this.#budget.usage(),
      preparedFrames: this.#preparedFrames,
      outputBytes: this.#outputBytes,
    })
  }

  async preparePngFrame(
    input: PreparePngFrameInputV2
  ): Promise<PreparedPngFrameV2>
  {
    return this.#exclusive(async () =>
    {
      const started = this.#budget.usage().pixelVisits
      const bytes = snapshotBytes(input.bytes, input.expectedSourceSha256)
      const header = sourceHeader(bytes)
      const plan = framePlan(
        header.width,
        header.height,
        input,
        input.slice,
        this.#budget.limits.maxTransformsPerFrame
      )
      this.#assertFrameCapacity(1)
      const source = await this.#decode(bytes)
      try
      {
        return this.#prepareDecodedFrame(source, plan, sha256(bytes), started)
      }
      finally
      {
        source.release()
      }
    })
  }

  async preparePngSheet(
    input: PreparePngSheetInputV2
  ): Promise<PreparedPngFrameV2[]>
  {
    return this.#exclusive(async () =>
    {
      let started = this.#budget.usage().pixelVisits
      const bytes = snapshotBytes(input.bytes, input.expectedSourceSha256)
      const header = sourceHeader(bytes)
      const rectangles = sheetRectangles(input.slicing)
      if (
        input.frames !== undefined &&
        (!Array.isArray(input.frames) ||
          input.frames.length !== rectangles.length)
      )
      {
        return invalid('sheet frame edits must match the exact slice count')
      }
      // sheet pivots belong to each selected frame, unlike source-frame crops
      const plans = rectangles.map((rect, index) =>
      {
        const edits = input.frames?.[index] ?? {}
        const pivot =
          edits.pivot === undefined
            ? { x: rect.width / 2, y: rect.height / 2 }
            : pivotCopy(edits.pivot)
        return framePlan(
          header.width,
          header.height,
          {
            pivot: { x: pivot.x + rect.x, y: pivot.y + rect.y },
            transforms: edits.transforms,
          },
          rect,
          this.#budget.limits.maxTransformsPerFrame
        )
      })
      this.#assertFrameCapacity(plans.length)
      const sourceHash = sha256(bytes)
      const source = await this.#decode(bytes)
      const frames: PreparedPngFrameV2[] = []
      try
      {
        for (const plan of plans)
        {
          frames.push(
            this.#prepareDecodedFrame(source, plan, sourceHash, started)
          )
          started = this.#budget.usage().pixelVisits
        }
      }
      finally
      {
        source.release()
      }
      return frames
    })
  }

  async renderPngPreview(
    input: RenderPngPreviewInputV2
  ): Promise<PreparedPngPreviewV2>
  {
    return this.#exclusive(async () =>
    {
      const started = this.#budget.usage().pixelVisits
      if (
        !Array.isArray(input.frames) ||
        input.frames.length < 1 ||
        input.frames.length > MAX_PREVIEW_FRAMES ||
        !['contact', 'origins', 'adjacent'].includes(input.mode)
      )
      {
        return invalid(
          `preview requires a supported mode & 1-${MAX_PREVIEW_FRAMES} frames`
        )
      }
      if (input.mode === 'adjacent' && input.frames.length !== 2)
      {
        return invalid('adjacent alpha preview requires exactly two frames')
      }
      const mode = input.mode
      const padding = integer(input.padding ?? 4, 'preview padding')
      const columns = integer(
        input.columns ?? Math.ceil(Math.sqrt(input.frames.length)),
        'preview columns',
        1
      )
      if (columns > MAX_PREVIEW_FRAMES || padding > 4096)
      {
        return invalid('preview columns or padding exceed the bounded layout')
      }
      const gridSize =
        input.gridSize === undefined
          ? undefined
          : integer(input.gridSize, 'preview grid size', 1)
      if (gridSize !== undefined && gridSize > 4096)
      {
        return invalid('preview grid size exceeds the bounded layout')
      }
      let inputBytes = 0
      const frames = input.frames.map((frame) =>
      {
        if (!SHA256.test(frame.outputSha256))
        {
          return invalid('preview frames require their prepared output SHA-256')
        }
        dimensions(frame.width, frame.height)
        inputBytes += frame.bytes.byteLength
        if (inputBytes > DEFAULT_SB3_LIMITS.maxTotalAssetBytes)
        {
          return invalid(
            'preview encoded inputs exceed the existing archive asset limit'
          )
        }
        const bytes = snapshotBytes(frame.bytes, frame.outputSha256)
        const header = sourceHeader(bytes)
        if (header.width !== frame.width || header.height !== frame.height)
        {
          return invalid(
            'preview frame dimensions differ from the pinned PNG bytes'
          )
        }
        return {
          bytes,
          width: frame.width,
          height: frame.height,
          pivot: pivotCopy(frame.pivot),
          outputSha256: frame.outputSha256,
        }
      })
      const minX = Math.min(0, ...frames.map((frame) => -frame.pivot.x))
      const minY = Math.min(0, ...frames.map((frame) => -frame.pivot.y))
      const maxX = Math.max(
        0,
        ...frames.map((frame) => frame.width - frame.pivot.x)
      )
      const maxY = Math.max(
        0,
        ...frames.map((frame) => frame.height - frame.pivot.y)
      )
      const aligned = mode !== 'contact'
      const cellWidth = aligned
        ? Math.ceil(maxX) - Math.floor(minX)
        : Math.max(...frames.map((frame) => frame.width))
      const cellHeight = aligned
        ? Math.ceil(maxY) - Math.floor(minY)
        : Math.max(...frames.map((frame) => frame.height))
      const actualColumns =
        mode === 'adjacent' ? 1 : Math.min(columns, frames.length)
      const rows =
        mode === 'adjacent' ? 1 : Math.ceil(frames.length / actualColumns)
      const width = actualColumns * cellWidth + (actualColumns + 1) * padding
      const height = rows * cellHeight + (rows + 1) * padding
      dimensions(width, height)
      const canvas = this.#allocate(width, height, true)
      const placements: PreparedPngPreviewV2['placements'][number][] = []
      try
      {
        for (const [index, frame] of frames.entries())
        {
          const cellX = mode === 'adjacent' ? 0 : index % actualColumns
          const cellY =
            mode === 'adjacent' ? 0 : Math.floor(index / actualColumns)
          const x =
            padding +
            cellX * (cellWidth + padding) +
            (aligned ? Math.round(-Math.floor(minX) - frame.pivot.x) : 0)
          const y =
            padding +
            cellY * (cellHeight + padding) +
            (aligned ? Math.round(-Math.floor(minY) - frame.pivot.y) : 0)
          const decoded = await this.#decode(frame.bytes)
          try
          {
            this.#composite(
              canvas,
              decoded,
              x,
              y,
              mode === 'adjacent' ? 0.5 : 1
            )
          }
          finally
          {
            decoded.release()
          }
          placements.push(
            Object.freeze({
              frameIndex: index,
              x,
              y,
              pivot: Object.freeze({
                x: x + frame.pivot.x,
                y: y + frame.pivot.y,
              }),
            })
          )
        }
        if (gridSize !== undefined) this.#drawGrid(canvas, gridSize)
        if (mode === 'origins')
        {
          for (const placement of placements)
          {
            this.#drawOrigin(canvas, placement.pivot)
          }
        }
        const bytes = this.#encode(canvas)
        this.#retainOutput(bytes.byteLength)
        return Object.freeze({
          bytes,
          width,
          height,
          outputSha256: sha256(bytes),
          transformSha256: evidenceHash({
            pipeline: 'png-preprocessing-v2',
            mode,
            frames: frames.map((frame) => ({
              outputSha256: frame.outputSha256,
              pivot: frame.pivot,
            })),
            columns: actualColumns,
            padding,
            gridSize: gridSize ?? null,
            placements,
          }),
          mode,
          placements: Object.freeze(placements),
          costs: Object.freeze({
            pixelVisits: this.#budget.usage().pixelVisits - started,
            outputBytes: bytes.byteLength,
          }),
        })
      }
      finally
      {
        canvas.release()
      }
    })
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T>
  {
    if (this.#active)
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.concurrentOperation,
        'one preprocessing job requires sequential operations'
      )
    }
    this.#active = true
    try
    {
      return await operation()
    }
    finally
    {
      this.#active = false
    }
  }

  #assertFrameCapacity(count: number): void
  {
    if (this.#preparedFrames + count > MAX_FRAMES)
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.budgetExceeded,
        `one preprocessing job supports at most ${MAX_FRAMES} prepared frames`
      )
    }
  }

  #retainOutput(bytes: number): void
  {
    if (this.#outputBytes + bytes > DEFAULT_SB3_LIMITS.maxTotalAssetBytes)
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.budgetExceeded,
        'cumulative encoded preprocessing outputs exceed the existing archive asset limit'
      )
    }
    this.#outputBytes += bytes
  }

  async #decode(bytes: Buffer): Promise<RgbaImage>
  {
    const header = sourceHeader(bytes)
    const pixels = header.width * header.height
    this.#budget.chargePixelVisits(pixels)
    const releaseValidation =
      this.#budget.reserveDecodedBytes(STREAM_WORKING_BYTES)
    let metadata: Awaited<ReturnType<typeof classifyMediaForPreservation>>
    try
    {
      metadata = await classifyMediaForPreservation(
        bytes,
        DEFAULT_EDIT_ADMISSION_LIMITS,
        true
      )
    }
    finally
    {
      releaseValidation()
    }
    if (metadata.outcome !== 'metadataClassified' || metadata.features.apng)
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.unsupportedPng,
        'only validated static PNG input can be normalized'
      )
    }
    const rgbaBytes = pixels * 4
    const bitmapBytes = pixels * (metadata.features.bitDepth === 16 ? 8 : 4)
    const scratchBytes =
      4 * (metadata.inflatedSampleBytes + metadata.height * 7) +
      bitmapBytes +
      rgbaBytes +
      STREAM_WORKING_BYTES
    this.#budget.chargePixelVisits(pixels * 3)
    const releaseScratch = this.#budget.reserveDecodedBytes(scratchBytes)
    let decoded: ReturnType<typeof PNG.sync.read>
    try
    {
      decoded = PNG.sync.read(bytes, { checkCRC: true, skipRescale: false })
      if (
        decoded.width !== header.width ||
        decoded.height !== header.height ||
        decoded.data.byteLength !== rgbaBytes
      )
      {
        return invalid('decoded PNG does not match its validated dimensions')
      }
    }
    catch (cause)
    {
      if (cause instanceof AssetPipelineErrorV2) throw cause
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.unsupportedPng,
        'validated PNG could not be decoded by the pinned PNG codec',
        { cause }
      )
    }
    finally
    {
      releaseScratch()
    }
    const release = this.#budget.reserveDecodedBytes(rgbaBytes)
    return {
      width: header.width,
      height: header.height,
      data: decoded.data,
      release,
    }
  }

  #allocate(width: number, height: number, clear = false): RgbaImage
  {
    dimensions(width, height)
    const release = this.#budget.reserveDecodedBytes(width * height * 4)
    try
    {
      if (clear) this.#budget.chargePixelVisits(width * height)
      return {
        width,
        height,
        data: clear
          ? Buffer.alloc(width * height * 4)
          : Buffer.allocUnsafe(width * height * 4),
        release,
      }
    }
    catch (cause)
    {
      release()
      throw cause
    }
  }

  #copyPixels(
    source: RgbaImage,
    width: number,
    height: number,
    sourceCoordinate: (x: number, y: number) => readonly [number, number]
  ): RgbaImage
  {
    this.#budget.chargePixelVisits(width * height)
    const output = this.#allocate(width, height)
    try
    {
      for (let y = 0; y < height; y += 1)
      {
        for (let x = 0; x < width; x += 1)
        {
          const [sourceX, sourceY] = sourceCoordinate(x, y)
          const sourceOffset = (sourceY * source.width + sourceX) * 4
          const outputOffset = (y * width + x) * 4
          output.data.writeUInt32LE(
            source.data.readUInt32LE(sourceOffset),
            outputOffset
          )
        }
      }
      return output
    }
    catch (cause)
    {
      output.release()
      throw cause
    }
  }

  #prepareDecodedFrame(
    source: RgbaImage,
    plan: FramePlan,
    sourceHash: string,
    started: number
  ): PreparedPngFrameV2
  {
    const { slice } = plan
    let working = this.#copyPixels(
      source,
      slice.width,
      slice.height,
      (x, y) => [x + slice.x, y + slice.y]
    )
    const pivot = { x: plan.pivot.x - slice.x, y: plan.pivot.y - slice.y }
    try
    {
      for (const transform of plan.transforms)
      {
        let next: RgbaImage | undefined
        if (transform.kind === 'crop')
        {
          next = this.#copyPixels(
            working,
            transform.width,
            transform.height,
            (x, y) => [x + transform.x, y + transform.y]
          )
          pivot.x -= transform.x
          pivot.y -= transform.y
        }
        else if (transform.kind === 'resizeNearest')
        {
          const previousWidth = working.width
          const previousHeight = working.height
          next = this.#copyPixels(
            working,
            transform.width,
            transform.height,
            (x, y) => [
              Math.floor((x * previousWidth) / transform.width),
              Math.floor((y * previousHeight) / transform.height),
            ]
          )
          pivot.x *= transform.width / previousWidth
          pivot.y *= transform.height / previousHeight
        }
        else if (transform.kind === 'flip')
        {
          const previousWidth = working.width
          const previousHeight = working.height
          next = this.#copyPixels(
            working,
            previousWidth,
            previousHeight,
            (x, y) => [
              transform.horizontal ? previousWidth - 1 - x : x,
              transform.vertical ? previousHeight - 1 - y : y,
            ]
          )
          if (transform.horizontal) pivot.x = previousWidth - pivot.x
          if (transform.vertical) pivot.y = previousHeight - pivot.y
        }
        else
        {
          this.#budget.chargePixelVisits(working.width * working.height)
          const replacements = new Map(
            transform.mappings.map((mapping) => [
              rgbKey(...mapping.from),
              mapping.to,
            ])
          )
          for (let offset = 0; offset < working.data.byteLength; offset += 4)
          {
            const replacement = replacements.get(
              rgbKey(
                working.data[offset]!,
                working.data[offset + 1]!,
                working.data[offset + 2]!
              )
            )
            if (!replacement) continue
            working.data[offset] = replacement[0]
            working.data[offset + 1] = replacement[1]
            working.data[offset + 2] = replacement[2]
          }
        }
        if (next !== undefined)
        {
          working.release()
          working = next
        }
        pivotCopy(pivot)
      }
      const bytes = this.#encode(working)
      this.#retainOutput(bytes.byteLength)
      this.#preparedFrames += 1
      return Object.freeze({
        bytes,
        width: working.width,
        height: working.height,
        pivot: Object.freeze(pivotCopy(pivot)),
        sourceSha256: sourceHash,
        transformSha256: evidenceHash({
          pipeline: 'png-preprocessing-v2',
          sourceSha256: sourceHash,
          sourceWidth: source.width,
          sourceHeight: source.height,
          slice,
          sourcePivot: plan.pivot,
          transforms: plan.transforms,
        }),
        outputSha256: sha256(bytes),
        md5ext: `${md5Hex(bytes)}.png`,
        dataFormat: 'png',
        bitmapResolution: 1,
        costs: Object.freeze({
          pixelVisits: this.#budget.usage().pixelVisits - started,
          outputBytes: bytes.byteLength,
        }),
      })
    }
    finally
    {
      working.release()
    }
  }

  #encode(image: RgbaImage): Buffer
  {
    this.#budget.chargePixelVisits(image.width * image.height)
    const release = this.#budget.reserveDecodedBytes(
      (image.width * 4 + 1) * image.height + STREAM_WORKING_BYTES
    )
    try
    {
      const png = new PNG()
      png.width = image.width
      png.height = image.height
      png.data = image.data
      png.gamma = 0
      const bytes = PNG.sync.write(png, {
        bitDepth: 8,
        colorType: 6,
        inputColorType: 6,
        inputHasAlpha: true,
        filterType: 0,
        deflateLevel: 9,
        deflateStrategy: 3,
      })
      if (bytes.byteLength > DEFAULT_SB3_LIMITS.maxAssetBytes)
      {
        throw new AssetPipelineErrorV2(
          ASSET_PIPELINE_CODES_V2.budgetExceeded,
          'canonical PNG exceeds the existing encoded asset size limit'
        )
      }
      return bytes
    }
    finally
    {
      release()
    }
  }

  #composite(
    destination: RgbaImage,
    source: RgbaImage,
    x: number,
    y: number,
    opacity: number
  ): void
  {
    if (
      x < 0 ||
      y < 0 ||
      x + source.width > destination.width ||
      y + source.height > destination.height
    )
    {
      invalid('preview placement extends outside its bounded canvas')
    }
    this.#budget.chargePixelVisits(source.width * source.height)
    for (let sy = 0; sy < source.height; sy += 1)
    {
      for (let sx = 0; sx < source.width; sx += 1)
      {
        const sourceOffset = (sy * source.width + sx) * 4
        const outputOffset = ((y + sy) * destination.width + x + sx) * 4
        if (opacity === 1)
        {
          destination.data.writeUInt32LE(
            source.data.readUInt32LE(sourceOffset),
            outputOffset
          )
        }
        else
        {
          this.#blend(
            destination.data,
            outputOffset,
            source.data,
            sourceOffset,
            opacity
          )
        }
      }
    }
  }

  #blend(
    destination: Buffer,
    outputOffset: number,
    source: Uint8Array,
    sourceOffset: number,
    opacity: number
  ): void
  {
    const sourceAlpha = (source[sourceOffset + 3]! / 255) * opacity
    if (sourceAlpha === 0) return
    const destinationAlpha = destination[outputOffset + 3]! / 255
    const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
    for (let channel = 0; channel < 3; channel += 1)
    {
      destination[outputOffset + channel] = Math.round(
        (source[sourceOffset + channel]! * sourceAlpha +
          destination[outputOffset + channel]! *
            destinationAlpha *
            (1 - sourceAlpha)) /
          alpha
      )
    }
    destination[outputOffset + 3] = Math.round(alpha * 255)
  }

  #drawGrid(canvas: RgbaImage, gridSize: number): void
  {
    const color = Uint8Array.from([128, 128, 128, 96])
    const vertical = Math.ceil(canvas.width / gridSize) * canvas.height
    const horizontal = Math.ceil(canvas.height / gridSize) * canvas.width
    this.#budget.chargePixelVisits(vertical + horizontal)
    for (let x = 0; x < canvas.width; x += gridSize)
    {
      for (let y = 0; y < canvas.height; y += 1)
      {
        this.#blend(canvas.data, (y * canvas.width + x) * 4, color, 0, 1)
      }
    }
    for (let y = 0; y < canvas.height; y += gridSize)
    {
      for (let x = 0; x < canvas.width; x += 1)
      {
        this.#blend(canvas.data, (y * canvas.width + x) * 4, color, 0, 1)
      }
    }
  }

  #drawOrigin(canvas: RgbaImage, pivot: PngPivotV2): void
  {
    const x = Math.round(pivot.x)
    const y = Math.round(pivot.y)
    const color = Uint8Array.from([255, 48, 48, 255])
    this.#budget.chargePixelVisits(10)
    for (let offset = -2; offset <= 2; offset += 1)
    {
      for (const [px, py] of [
        [x + offset, y],
        [x, y + offset],
      ])
      {
        if (px! < 0 || py! < 0 || px! >= canvas.width || py! >= canvas.height)
          continue
        this.#blend(canvas.data, (py! * canvas.width + px!) * 4, color, 0, 1)
      }
    }
  }
}
