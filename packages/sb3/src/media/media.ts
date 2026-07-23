// packages/sb3/src/media/media.ts
// bounded PNG preservation classification & narrow PNG/PCM-WAV authoring

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { createInflate } from 'node:zlib'

import type { Asset } from '../admission/admission.js'
import { DEFAULT_SB3_LIMITS } from '../admission/limits.js'
import type { EditAdmissionLimits } from '../edit-admission/edit-admission-limits.js'
import type { Costume, ProjectJson, Sound } from '../json/project-json.js'
import { normalizeAssetsByPath } from './assets.js'

export const MEDIA_CLASSIFICATION_CODES = {
  assetTooLarge: 'EDIT_MEDIA_ASSET_TOO_LARGE',
  assetDigestMismatch: 'EDIT_MEDIA_ASSET_DIGEST_MISMATCH',
  assetMetadataMismatch: 'EDIT_MEDIA_ASSET_METADATA_MISMATCH',
  referencedAssetMissing: 'EDIT_MEDIA_REFERENCED_ASSET_MISSING',
  pngMalformed: 'EDIT_MEDIA_PNG_MALFORMED',
  pngWorkExceeded: 'EDIT_MEDIA_PNG_WORK_EXCEEDED',
  wavUnsupported: 'EDIT_MEDIA_WAV_UNSUPPORTED',
  authoringUnsupported: 'EDIT_MEDIA_AUTHORING_UNSUPPORTED',
  referenceWorkExceeded: 'EDIT_MEDIA_REFERENCE_WORK_EXCEEDED',
} as const

type MediaClassificationCode =
  (typeof MEDIA_CLASSIFICATION_CODES)[keyof typeof MEDIA_CLASSIFICATION_CODES]

interface PngFeatureFlags
{
  interlaced: boolean
  apng: boolean
  bitDepth: number
  colorType: number
  palette: boolean
  unknownAncillaryChunks: string[]
}

interface PngMetadataClassification
{
  outcome: 'metadataClassified'
  mediaType: 'png'
  width: number
  height: number
  canvasPixels: number
  inflatedSampleBytes: number
  animationFrames: number
  cumulativeFramePixels: number
  cumulativeFrameInflatedSampleBytes: number
  features: PngFeatureFlags
  authoringEligible: boolean
  authoringRefusals: string[]
}

interface PcmWavAuthoringMetadata
{
  mediaType: 'riff-wave-pcm-integer'
  channels: 1 | 2
  sampleRate: number
  bitsPerSample: 8 | 16
  blockAlign: number
  byteRate: number
  dataBytes: number
  sampleCount: number
}

export interface DerivedCostumeAssetIdentity
{
  mediaKind: 'costume'
  sha256: string
  md5: string
  md5ext: string
  dataFormat: 'png'
  bitmapResolution: 1
  byteLength: number
  width: number
  height: number
  canvasPixels: number
}

export interface DerivedSoundAssetIdentity
{
  mediaKind: 'sound'
  sha256: string
  md5: string
  md5ext: string
  dataFormat: 'wav'
  format: ''
  byteLength: number
  rate: number
  sampleCount: number
  channels: 1 | 2
  bitsPerSample: 8 | 16
  blockAlign: number
}

export type DerivedMediaAssetIdentity =
  DerivedCostumeAssetIdentity | DerivedSoundAssetIdentity

interface OpaqueMediaClassification
{
  outcome: 'opaquePreserved'
  mediaType: 'wav' | 'other'
  authoringEligible: boolean
  authoringMetadata?: PcmWavAuthoringMetadata
}

type MediaPreservationClassification =
  PngMetadataClassification | OpaqueMediaClassification

interface ClassifiedArchiveAsset
{
  path: string
  byteLength: number
  classification: MediaPreservationClassification
}

interface ProjectMediaMetrics
{
  classifiedAssets: number
  pngAssets: number
  pngMediaReferences: number
  pngCostumeReferences: number
  pngSoundReferences: number
  pngReferencePixels: number
  pngReferenceAnimationPixels: number
  pngReferenceInflatedSampleBytes: number
  pngDecodedRgbaBytes: number
}

export interface ProjectMediaAdmission
{
  assets: ClassifiedArchiveAsset[]
  missingReferencedAssetPaths: string[]
  metrics: ProjectMediaMetrics
}

interface PngChunk
{
  type: string
  data: Uint8Array
}

interface FrameControl
{
  width: number
  height: number
  x: number
  y: number
  dispose: number
  blend: number
  compressed: Uint8Array[]
  usesDefaultImage: boolean
}

export class MediaClassificationError extends Error
{
  readonly code: MediaClassificationCode
  readonly path?: string

  constructor(
    code: MediaClassificationCode,
    message: string,
    options: { path?: string; cause?: unknown } = {}
  )
  {
    super(
      options.path === undefined ? message : `${options.path}: ${message}`,
      options.cause === undefined ? undefined : { cause: options.cause }
    )
    this.name = 'MediaClassificationError'
    this.code = code
    this.path = options.path
  }
}

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const MAX_MEDIA_ASSET_BYTES = DEFAULT_SB3_LIMITS.maxAssetBytes
const PNG_COLOR_BITS = new Map<number, readonly number[]>([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
])
const CHANNELS_BY_COLOR = new Map<number, number>([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
])
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const

const CRC32_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC32_TABLE.length; index++)
{
  let value = index
  for (let bit = 0; bit < 8; bit++)
  {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

function fail(
  code: MediaClassificationCode,
  message: string,
  options: { path?: string; cause?: unknown } = {}
): never
{
  throw new MediaClassificationError(code, message, options)
}

function view(bytes: Uint8Array): DataView
{
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes: Uint8Array, start: number, length: number): string
{
  let value = ''
  for (let index = start; index < start + length; index++)
  {
    value += String.fromCharCode(bytes[index] ?? 0)
  }
  return value
}

function crc32(parts: readonly Uint8Array[]): number
{
  let value = 0xffffffff
  for (const bytes of parts)
  {
    for (const byte of bytes)
    {
      value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

function hasPngSignature(bytes: Uint8Array): boolean
{
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function checkedProduct(left: number, right: number, label: string): number
{
  const value = left * right
  if (!Number.isSafeInteger(value))
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
      `${label} exceeds safe integer accounting`
    )
  }
  return value
}

function chunks(bytes: Uint8Array): PngChunk[]
{
  if (!hasPngSignature(bytes))
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'claimed PNG has an invalid signature'
    )
  }
  const result: PngChunk[] = []
  const data = view(bytes)
  let offset = PNG_SIGNATURE.byteLength
  while (offset < bytes.byteLength)
  {
    if (offset + 12 > bytes.byteLength)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngMalformed,
        'truncated PNG chunk header'
      )
    }
    const length = data.getUint32(offset, false)
    const end = offset + 12 + length
    if (end > bytes.byteLength)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngMalformed,
        'PNG chunk length exceeds the payload'
      )
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const type = ascii(typeBytes, 0, 4)
    if (!/^[A-Za-z]{4}$/u.test(type) || (typeBytes[2]! & 0x20) !== 0)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngMalformed,
        `invalid PNG chunk type ${JSON.stringify(type)}`
      )
    }
    const chunkData = bytes.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = data.getUint32(offset + 8 + length, false)
    if (crc32([typeBytes, chunkData]) !== expectedCrc)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngMalformed,
        `CRC mismatch for PNG chunk ${type}`
      )
    }
    result.push({ type, data: chunkData })
    offset = end
  }
  return result
}

function passSize(full: number, start: number, step: number): number
{
  return full <= start ? 0 : Math.floor((full - start + step - 1) / step)
}

function rowLengths(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlace: number
): number[]
{
  const rows: number[] = []
  if (interlace === 0)
  {
    const row = 1 + Math.ceil((width * bitsPerPixel) / 8)
    for (let index = 0; index < height; index++) rows.push(row)
    return rows
  }
  for (const [x, y, dx, dy] of ADAM7)
  {
    const passWidth = passSize(width, x, dx)
    const passHeight = passSize(height, y, dy)
    if (passWidth === 0 || passHeight === 0) continue
    const row = 1 + Math.ceil((passWidth * bitsPerPixel) / 8)
    for (let index = 0; index < passHeight; index++) rows.push(row)
  }
  return rows
}

async function validateInflatedRows(
  compressed: readonly Uint8Array[],
  rows: readonly number[],
  maximumBytes: number
): Promise<number>
{
  const expected = rows.reduce((total, row) => total + row, 0)
  const sampleBytes = expected - rows.length
  if (sampleBytes > maximumBytes)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
      `PNG inflated sample bytes ${sampleBytes} exceed ${maximumBytes}`
    )
  }
  const compressedBytes = compressed.reduce(
    (total, part) => total + part.byteLength,
    0
  )
  const inflater = createInflate()
  const output = Readable.from(compressed).pipe(inflater)
  let total = 0
  let rowIndex = 0
  let rowOffset = 0
  try
  {
    for await (const part of output)
    {
      const bytes = part as Uint8Array
      total += bytes.byteLength
      if (total > expected)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
          'PNG inflated output exceeds its exact bounded layout'
        )
      }
      let offset = 0
      while (offset < bytes.byteLength)
      {
        const rowLength = rows[rowIndex]
        if (rowLength === undefined)
        {
          return fail(
            MEDIA_CLASSIFICATION_CODES.pngMalformed,
            'PNG contains excess inflated rows'
          )
        }
        if (rowOffset === 0 && bytes[offset]! > 4)
        {
          return fail(
            MEDIA_CLASSIFICATION_CODES.pngMalformed,
            `PNG row ${rowIndex} has an invalid filter byte`
          )
        }
        const used = Math.min(rowLength - rowOffset, bytes.byteLength - offset)
        rowOffset += used
        offset += used
        if (rowOffset === rowLength)
        {
          rowIndex++
          rowOffset = 0
        }
      }
    }
  }
  catch (cause)
  {
    if (cause instanceof MediaClassificationError) throw cause
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'invalid PNG compressed sample stream',
      { cause }
    )
  }
  if (total !== expected || rowIndex !== rows.length || rowOffset !== 0)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      `PNG inflated sample length is ${total}; expected ${expected}`
    )
  }
  if (inflater.bytesWritten !== compressedBytes)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG compressed stream contains trailing or unconsumed bytes'
    )
  }
  return sampleBytes
}

function frameControl(chunk: PngChunk): {
  sequence: number
  frame: FrameControl
}
{
  if (chunk.data.byteLength !== 26)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'APNG fcTL chunk must contain 26 bytes'
    )
  }
  const data = view(chunk.data)
  return {
    sequence: data.getUint32(0, false),
    frame: {
      width: data.getUint32(4, false),
      height: data.getUint32(8, false),
      x: data.getUint32(12, false),
      y: data.getUint32(16, false),
      dispose: chunk.data[24] ?? 255,
      blend: chunk.data[25] ?? 255,
      compressed: [],
      usesDefaultImage: false,
    },
  }
}

async function classifyPng(
  bytes: Uint8Array,
  limits: EditAdmissionLimits
): Promise<PngMetadataClassification>
{
  if (bytes.byteLength > MAX_MEDIA_ASSET_BYTES)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.assetTooLarge,
      `PNG exceeds ${MAX_MEDIA_ASSET_BYTES} bytes`
    )
  }
  const parsedChunks = chunks(bytes)
  if (
    parsedChunks.length < 3 ||
    parsedChunks[0]?.type !== 'IHDR' ||
    parsedChunks.at(-1)?.type !== 'IEND'
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG requires IHDR first and IEND last'
    )
  }
  if (
    parsedChunks.filter((chunk) => chunk.type === 'IHDR').length !== 1 ||
    parsedChunks.filter((chunk) => chunk.type === 'IEND').length !== 1
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG requires exactly one IHDR and IEND'
    )
  }
  if (parsedChunks.at(-1)!.data.byteLength !== 0)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG IEND must have an empty payload'
    )
  }
  const ihdr = parsedChunks[0]!
  if (ihdr.data.byteLength !== 13)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG IHDR must contain 13 bytes'
    )
  }
  const header = view(ihdr.data)
  const width = header.getUint32(0, false)
  const height = header.getUint32(4, false)
  const bitDepth = ihdr.data[8] ?? -1
  const colorType = ihdr.data[9] ?? -1
  const compression = ihdr.data[10] ?? -1
  const filter = ihdr.data[11] ?? -1
  const interlace = ihdr.data[12] ?? -1
  const bitDepths = PNG_COLOR_BITS.get(colorType)
  if (
    width < 1 ||
    height < 1 ||
    width > limits.maxPngWidth ||
    height > limits.maxPngHeight ||
    !bitDepths?.includes(bitDepth) ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG IHDR is outside the preservation profile'
    )
  }
  const canvasPixels = checkedProduct(width, height, 'PNG canvas pixels')
  if (canvasPixels > limits.maxPngCanvasPixels)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
      `PNG canvas pixels ${canvasPixels} exceed ${limits.maxPngCanvasPixels}`
    )
  }
  const channels = CHANNELS_BY_COLOR.get(colorType)!
  const bitsPerPixel = channels * bitDepth
  const idat: Uint8Array[] = []
  const frames: FrameControl[] = []
  const unknownAncillary = new Set<string>()
  let paletteEntries = 0
  let seenPalette = false
  let seenIdat = false
  let endedIdat = false
  let animationFrames: number | null = null
  let nextSequence = 0
  let currentFrame: FrameControl | null = null

  for (let index = 1; index < parsedChunks.length - 1; index++)
  {
    const chunk = parsedChunks[index]!
    const critical = (chunk.type.charCodeAt(0) & 0x20) === 0
    if (critical && chunk.type !== 'PLTE' && chunk.type !== 'IDAT')
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngMalformed,
        `unknown critical PNG chunk ${chunk.type}`
      )
    }
    if (seenIdat && chunk.type !== 'IDAT') endedIdat = true
    if (chunk.type === 'PLTE')
    {
      if (
        seenPalette ||
        seenIdat ||
        chunk.data.byteLength === 0 ||
        chunk.data.byteLength % 3 !== 0 ||
        chunk.data.byteLength > 768
      )
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'PNG PLTE placement or size is invalid'
        )
      }
      seenPalette = true
      paletteEntries = chunk.data.byteLength / 3
      continue
    }
    if (chunk.type === 'IDAT')
    {
      if (endedIdat)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'PNG IDAT chunks must be consecutive'
        )
      }
      seenIdat = true
      idat.push(chunk.data)
      continue
    }
    if (chunk.type === 'acTL')
    {
      if (animationFrames !== null || seenIdat || chunk.data.byteLength !== 8)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'APNG acTL must be unique, eight bytes, and precede IDAT'
        )
      }
      animationFrames = view(chunk.data).getUint32(0, false)
      if (animationFrames < 1 || animationFrames > limits.maxApngFrames)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
          'APNG frame count is outside the preservation profile'
        )
      }
      continue
    }
    if (chunk.type === 'fcTL')
    {
      if (animationFrames === null)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'APNG fcTL requires a preceding acTL'
        )
      }
      const parsed = frameControl(chunk)
      if (parsed.sequence !== nextSequence++)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'APNG sequence numbers must be consecutive from zero'
        )
      }
      const frame = parsed.frame
      if (
        frame.width < 1 ||
        frame.height < 1 ||
        frame.x + frame.width > width ||
        frame.y + frame.height > height ||
        frame.dispose > 2 ||
        frame.blend > 1
      )
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'APNG frame rectangle or operation is invalid'
        )
      }
      frame.usesDefaultImage = !seenIdat
      if (frame.usesDefaultImage && frames.length > 0)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'only the first APNG frame may precede IDAT'
        )
      }
      if (
        frame.usesDefaultImage &&
        (frame.width !== width ||
          frame.height !== height ||
          frame.x !== 0 ||
          frame.y !== 0)
      )
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'default-image APNG frame must cover the IHDR canvas'
        )
      }
      frames.push(frame)
      currentFrame = frame
      continue
    }
    if (chunk.type === 'fdAT')
    {
      if (
        animationFrames === null ||
        currentFrame === null ||
        currentFrame.usesDefaultImage ||
        chunk.data.byteLength < 5
      )
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'APNG fdAT placement or size is invalid'
        )
      }
      const sequence = view(chunk.data).getUint32(0, false)
      if (sequence !== nextSequence++)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.pngMalformed,
          'APNG sequence numbers must be consecutive from zero'
        )
      }
      currentFrame.compressed.push(chunk.data.subarray(4))
      continue
    }
    if (!critical) unknownAncillary.add(chunk.type)
  }

  if (idat.length === 0)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG requires at least one IDAT chunk'
    )
  }
  if (
    ((colorType === 0 || colorType === 4) && seenPalette) ||
    (colorType === 3 && !seenPalette) ||
    (colorType === 3 && paletteEntries > 2 ** bitDepth)
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'PNG palette violates its color-type policy'
    )
  }
  if (animationFrames === null && frames.length > 0)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'APNG frame chunks require acTL'
    )
  }
  if (animationFrames !== null && frames.length !== animationFrames)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      `APNG declares ${animationFrames} frames but contains ${frames.length}`
    )
  }
  if (
    frames.some(
      (frame) => !frame.usesDefaultImage && frame.compressed.length === 0
    )
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.pngMalformed,
      'every non-default APNG frame requires fdAT payload'
    )
  }

  const baseRows = rowLengths(width, height, bitsPerPixel, interlace)
  const inflatedSampleBytes = await validateInflatedRows(
    idat,
    baseRows,
    limits.maxPngInflatedSampleBytes
  )
  let cumulativeFramePixels = 0
  let cumulativeFrameInflatedSampleBytes = 0
  for (const frame of frames)
  {
    const pixels = checkedProduct(
      frame.width,
      frame.height,
      'APNG cumulative frame pixels'
    )
    cumulativeFramePixels += pixels
    if (cumulativeFramePixels > limits.maxApngCumulativeFramePixels)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
        'APNG cumulative frame pixels exceed the preservation limit'
      )
    }
    const rows = rowLengths(frame.width, frame.height, bitsPerPixel, interlace)
    const expectedSampleBytes = rows.reduce((total, row) => total + row - 1, 0)
    cumulativeFrameInflatedSampleBytes += expectedSampleBytes
    if (
      expectedSampleBytes > limits.maxPngInflatedSampleBytes ||
      cumulativeFrameInflatedSampleBytes >
        limits.maxApngCumulativeInflatedSampleBytes
    )
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.pngWorkExceeded,
        'APNG inflated sample work exceeds the preservation limit'
      )
    }
    if (!frame.usesDefaultImage)
    {
      await validateInflatedRows(
        frame.compressed,
        rows,
        limits.maxPngInflatedSampleBytes
      )
    }
  }

  const authoringRefusals: string[] = []
  if (interlace !== 0) authoringRefusals.push('interlaced')
  if (animationFrames !== null) authoringRefusals.push('apng')
  if (bitDepth !== 8) authoringRefusals.push('bit-depth')
  return {
    outcome: 'metadataClassified',
    mediaType: 'png',
    width,
    height,
    canvasPixels,
    inflatedSampleBytes,
    animationFrames: animationFrames ?? 0,
    cumulativeFramePixels,
    cumulativeFrameInflatedSampleBytes,
    features: {
      interlaced: interlace === 1,
      apng: animationFrames !== null,
      bitDepth,
      colorType,
      palette: seenPalette,
      unknownAncillaryChunks: [...unknownAncillary].sort(),
    },
    authoringEligible: authoringRefusals.length === 0,
    authoringRefusals,
  }
}

function parsePcmWav(bytes: Uint8Array): PcmWavAuthoringMetadata
{
  if (bytes.byteLength > MAX_MEDIA_ASSET_BYTES)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.assetTooLarge,
      `WAV exceeds ${MAX_MEDIA_ASSET_BYTES} bytes`
    )
  }
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WAVE'
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.wavUnsupported,
      'authoring sound must be RIFF/WAVE'
    )
  }
  const data = view(bytes)
  if (data.getUint32(4, true) !== bytes.byteLength - 8)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.wavUnsupported,
      'RIFF declared size must exactly match the file'
    )
  }
  let offset = 12
  let format:
    | {
        channels: number
        sampleRate: number
        byteRate: number
        blockAlign: number
        bitsPerSample: number
      }
    | undefined
  let dataBytes: number | undefined
  let chunkIndex = 0
  while (offset < bytes.byteLength)
  {
    if (offset + 8 > bytes.byteLength)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.wavUnsupported,
        'truncated WAV chunk header'
      )
    }
    const id = ascii(bytes, offset, 4)
    const length = data.getUint32(offset + 4, true)
    const payload = offset + 8
    const paddedEnd = payload + length + (length & 1)
    if (paddedEnd > bytes.byteLength)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.wavUnsupported,
        'WAV chunk length or padding exceeds the file'
      )
    }
    if (chunkIndex === 0 && id === 'fmt ' && length === 16)
    {
      if (data.getUint16(payload, true) !== 1)
      {
        return fail(
          MEDIA_CLASSIFICATION_CODES.wavUnsupported,
          'WAV audio format must be PCM integer'
        )
      }
      format = {
        channels: data.getUint16(payload + 2, true),
        sampleRate: data.getUint32(payload + 4, true),
        byteRate: data.getUint32(payload + 8, true),
        blockAlign: data.getUint16(payload + 12, true),
        bitsPerSample: data.getUint16(payload + 14, true),
      }
    }
    else if (chunkIndex === 1 && id === 'data')
    {
      dataBytes = length
    }
    else
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.wavUnsupported,
        'WAV authoring permits exactly fmt followed by data'
      )
    }
    chunkIndex++
    offset = paddedEnd
  }
  if (!format || dataBytes === undefined || chunkIndex !== 2)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.wavUnsupported,
      'WAV requires exactly one fmt and one data chunk'
    )
  }
  const { channels, sampleRate, byteRate, blockAlign, bitsPerSample } = format
  if (
    (channels !== 1 && channels !== 2) ||
    (bitsPerSample !== 8 && bitsPerSample !== 16) ||
    sampleRate < 8_000 ||
    sampleRate > 96_000 ||
    blockAlign !== channels * (bitsPerSample / 8) ||
    byteRate !== sampleRate * blockAlign ||
    dataBytes < 1 ||
    dataBytes % blockAlign !== 0
  )
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.wavUnsupported,
      'WAV PCM metadata is outside the authoring profile'
    )
  }
  return {
    mediaType: 'riff-wave-pcm-integer',
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    byteRate,
    dataBytes,
    sampleCount: dataBytes / blockAlign,
  }
}

function looksLikeWav(bytes: Uint8Array): boolean
{
  return (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WAVE'
  )
}

export async function classifyMediaForPreservation(
  bytes: Uint8Array,
  limits: EditAdmissionLimits,
  claimedPng = false
): Promise<MediaPreservationClassification>
{
  if (bytes.byteLength > MAX_MEDIA_ASSET_BYTES)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.assetTooLarge,
      `media payload exceeds ${MAX_MEDIA_ASSET_BYTES} bytes`
    )
  }
  if (claimedPng || hasPngSignature(bytes)) return classifyPng(bytes, limits)
  if (looksLikeWav(bytes))
  {
    try
    {
      return {
        outcome: 'opaquePreserved',
        mediaType: 'wav',
        authoringEligible: true,
        authoringMetadata: parsePcmWav(bytes),
      }
    }
    catch
    {
      return {
        outcome: 'opaquePreserved',
        mediaType: 'wav',
        authoringEligible: false,
      }
    }
  }
  return {
    outcome: 'opaquePreserved',
    mediaType: 'other',
    authoringEligible: false,
  }
}

export async function classifyMediaForAuthoring(
  bytes: Uint8Array,
  kind: 'costume' | 'sound',
  limits: EditAdmissionLimits
): Promise<PngMetadataClassification | PcmWavAuthoringMetadata>
{
  if (kind === 'sound') return parsePcmWav(bytes)
  const png = await classifyPng(bytes, limits)
  if (!png.authoringEligible)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.authoringUnsupported,
      `PNG is preservation-only: ${png.authoringRefusals.join(', ')}`
    )
  }
  return png
}

// derive the Scratch asset identity a costume/sound record needs from the
// authoring metadata this module already parsed; there is no caller-supplied
// override, so every emitted field comes only from the payload bytes
export async function deriveAuthoringMediaIdentity(
  bytes: Uint8Array,
  kind: 'costume' | 'sound',
  limits: EditAdmissionLimits
): Promise<DerivedMediaAssetIdentity>
{
  const metadata = await classifyMediaForAuthoring(bytes, kind, limits)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const md5 = md5Hex(bytes)
  if (kind === 'costume')
  {
    const png = metadata as PngMetadataClassification
    return Object.freeze({
      mediaKind: 'costume',
      sha256,
      md5,
      md5ext: `${md5}.png`,
      dataFormat: 'png',
      bitmapResolution: 1,
      byteLength: bytes.byteLength,
      width: png.width,
      height: png.height,
      canvasPixels: png.canvasPixels,
    })
  }
  const wav = metadata as PcmWavAuthoringMetadata
  return Object.freeze({
    mediaKind: 'sound',
    sha256,
    md5,
    md5ext: `${md5}.wav`,
    dataFormat: 'wav',
    format: '',
    byteLength: bytes.byteLength,
    rate: wav.sampleRate,
    sampleCount: wav.sampleCount,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    blockAlign: wav.blockAlign,
  })
}

function mediaPath(media: Costume | Sound): string
{
  return media.md5ext ?? `${media.assetId}.${media.dataFormat}`
}

const CANONICAL_DATA_FORMAT = /^[a-z0-9]+$/u

// Scratch addresses every asset by md5, so this module owns that derivation for
// authoring identity & for any pinned payload admitted on the preservation path
export function md5Hex(bytes: Uint8Array): string
{
  return createHash('md5').update(bytes).digest('hex')
}

function claimedPng(media: Costume | Sound): boolean
{
  return (
    media.dataFormat.toLowerCase() === 'png' ||
    mediaPath(media).toLowerCase().endsWith('.png')
  )
}

function* projectMediaReferences(
  project: ProjectJson
): Generator<{ kind: 'costume' | 'sound'; media: Costume | Sound }>
{
  for (const target of project.targets)
  {
    for (const media of target.costumes) yield { kind: 'costume', media }
    for (const media of target.sounds) yield { kind: 'sound', media }
  }
}

export async function classifyProjectMedia(
  project: ProjectJson,
  inputAssets: readonly Asset[],
  limits: EditAdmissionLimits
): Promise<ProjectMediaAdmission>
{
  const assets = normalizeAssetsByPath(inputAssets)
  const archiveAssetsByPath = new Map(
    assets.map((asset) => [asset.path, asset] as const)
  )
  const claimedPngPaths = new Set<string>()
  const referencedPaths = new Set<string>()
  for (const { media } of projectMediaReferences(project))
  {
    referencedPaths.add(mediaPath(media))
    if (claimedPng(media)) claimedPngPaths.add(mediaPath(media))
  }
  const classified: ClassifiedArchiveAsset[] = []
  const byPath = new Map<string, MediaPreservationClassification>()
  for (const asset of assets)
  {
    let classification: MediaPreservationClassification
    try
    {
      classification = await classifyMediaForPreservation(
        asset.bytes,
        limits,
        claimedPngPaths.has(asset.path) ||
          asset.path.toLowerCase().endsWith('.png')
      )
    }
    catch (cause)
    {
      if (cause instanceof MediaClassificationError)
      {
        return fail(cause.code, cause.message, { path: asset.path, cause })
      }
      throw cause
    }
    classified.push({
      path: asset.path,
      byteLength: asset.bytes.byteLength,
      classification,
    })
    byPath.set(asset.path, classification)
  }
  const missingReferencedAssetPaths = [...referencedPaths]
    .filter((path) => !byPath.has(path))
    .sort()
  const md5ByPath = new Map<string, string>()
  for (const { media } of projectMediaReferences(project))
  {
    const path = mediaPath(media)
    const asset = archiveAssetsByPath.get(path)
    if (!asset) continue
    if (
      !CANONICAL_DATA_FORMAT.test(media.dataFormat) ||
      media.dataFormat !== media.dataFormat.toLowerCase()
    )
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.assetMetadataMismatch,
        `media ${JSON.stringify(media.name)} has noncanonical dataFormat ${JSON.stringify(media.dataFormat)}`,
        { path }
      )
    }
    let digest = md5ByPath.get(path)
    if (!digest)
    {
      digest = md5Hex(asset.bytes)
      md5ByPath.set(path, digest)
    }
    if (media.assetId !== digest)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.assetDigestMismatch,
        `media ${JSON.stringify(media.name)} assetId does not match its payload MD5`,
        { path }
      )
    }
    const canonicalPath = `${digest}.${media.dataFormat}`
    if (path !== canonicalPath)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.assetMetadataMismatch,
        `media ${JSON.stringify(media.name)} path is not canonical ${canonicalPath}`,
        { path }
      )
    }
    const classification = byPath.get(path)
    const classifiedFormat =
      classification?.outcome === 'metadataClassified'
        ? 'png'
        : classification?.mediaType === 'wav'
          ? 'wav'
          : null
    if (
      (media.dataFormat === 'png' || media.dataFormat === 'wav') &&
      classifiedFormat !== media.dataFormat
    )
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.assetMetadataMismatch,
        `media ${JSON.stringify(media.name)} dataFormat does not match its payload`,
        { path }
      )
    }
    if (classifiedFormat !== null && media.dataFormat !== classifiedFormat)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.assetMetadataMismatch,
        `media ${JSON.stringify(media.name)} payload requires dataFormat ${classifiedFormat}`,
        { path }
      )
    }
  }
  let pngMediaReferences = 0
  let pngCostumeReferences = 0
  let pngSoundReferences = 0
  let pngReferencePixels = 0
  let pngReferenceAnimationPixels = 0
  let pngReferenceInflatedSampleBytes = 0
  for (const { kind, media } of projectMediaReferences(project))
  {
    const classification = byPath.get(mediaPath(media))
    if (classification?.outcome !== 'metadataClassified') continue
    pngMediaReferences++
    if (kind === 'costume') pngCostumeReferences++
    else pngSoundReferences++
    pngReferencePixels += classification.canvasPixels
    pngReferenceAnimationPixels += classification.cumulativeFramePixels
    pngReferenceInflatedSampleBytes +=
      classification.inflatedSampleBytes +
      classification.cumulativeFrameInflatedSampleBytes
    if (pngReferencePixels > limits.maxPngReferencePixels)
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.referenceWorkExceeded,
        `PNG reference pixels exceed ${limits.maxPngReferencePixels}`
      )
    }
    if (
      pngReferenceAnimationPixels > limits.maxApngCumulativeFramePixels ||
      pngReferenceInflatedSampleBytes >
        limits.maxApngCumulativeInflatedSampleBytes
    )
    {
      return fail(
        MEDIA_CLASSIFICATION_CODES.referenceWorkExceeded,
        'PNG reference animation/inflate work exceeds the admission profile'
      )
    }
  }
  const pngDecodedRgbaBytes = checkedProduct(
    pngReferencePixels,
    4,
    'PNG decoded RGBA estimate'
  )
  if (pngDecodedRgbaBytes > limits.maxPngDecodedRgbaBytes)
  {
    return fail(
      MEDIA_CLASSIFICATION_CODES.referenceWorkExceeded,
      `PNG decoded RGBA estimate exceeds ${limits.maxPngDecodedRgbaBytes}`
    )
  }
  return {
    assets: classified,
    missingReferencedAssetPaths,
    metrics: {
      classifiedAssets: classified.length,
      pngAssets: classified.filter(
        (asset) => asset.classification.outcome === 'metadataClassified'
      ).length,
      pngMediaReferences,
      pngCostumeReferences,
      pngSoundReferences,
      pngReferencePixels,
      pngReferenceAnimationPixels,
      pngReferenceInflatedSampleBytes,
      pngDecodedRgbaBytes,
    },
  }
}
