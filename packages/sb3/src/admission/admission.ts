// packages/sb3/src/admission/admission.ts
// preflight & unpack bounded .sb3 archives w/ stable admission evidence

import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

import JSZip from 'jszip'

import {
  DEFAULT_SB3_LIMITS,
  isValidSb3EntryPath,
  resolveSb3Limits,
  type Sb3LimitOptions,
  type Sb3Limits,
} from './limits.js'

export const SB3_ADMISSION_CODES = {
  limitsInvalid: 'SB3_LIMITS_INVALID',
  archiveInvalid: 'SB3_ARCHIVE_INVALID',
  compressedSizeLimit: 'SB3_COMPRESSED_SIZE_LIMIT',
  entryCountLimit: 'SB3_ENTRY_COUNT_LIMIT',
  projectJsonMissing: 'SB3_PROJECT_JSON_MISSING',
  projectJsonSizeLimit: 'SB3_PROJECT_JSON_SIZE_LIMIT',
  assetSizeLimit: 'SB3_ASSET_SIZE_LIMIT',
  totalAssetSizeLimit: 'SB3_TOTAL_ASSET_SIZE_LIMIT',
  duplicateEntry: 'SB3_DUPLICATE_ENTRY',
  invalidEntryPath: 'SB3_INVALID_ENTRY_PATH',
  directoryEntry: 'SB3_DIRECTORY_ENTRY',
  encryptedEntry: 'SB3_ENCRYPTED_ENTRY',
  compressionUnsupported: 'SB3_COMPRESSION_UNSUPPORTED',
  entryTypeUnsupported: 'SB3_ENTRY_TYPE_UNSUPPORTED',
  zip64Unsupported: 'SB3_ZIP64_UNSUPPORTED',
  multidiskUnsupported: 'SB3_MULTIDISK_UNSUPPORTED',
  entryNameEncodingUnsupported: 'SB3_ENTRY_NAME_ENCODING_UNSUPPORTED',
  projectJsonEncodingInvalid: 'SB3_PROJECT_JSON_ENCODING_INVALID',
  entryCrcMismatch: 'SB3_ENTRY_CRC_MISMATCH',
} as const

type Sb3AdmissionCode =
  (typeof SB3_ADMISSION_CODES)[keyof typeof SB3_ADMISSION_CODES]

export interface Asset
{
  path: string
  bytes: Uint8Array
}

export interface Sb3AdmissionMetrics
{
  sha256: string
  projectJsonSha256: string
  compressedBytes: number
  entryCount: number
  knownUncompressedBytes: number
  projectJsonBytes: number
  assetCount: number
  assetBytes: number
  largestAssetBytes: number
}

export interface Sb3AdmissionIssue
{
  code: Sb3AdmissionCode
  message: string
  path?: string
  observed?: number
  limit?: number
}

export interface Sb3Admission
{
  projectJsonText: string
  assets: Asset[]
  metrics: Sb3AdmissionMetrics
  limits: Sb3Limits
}

export interface AdmitOptions
{
  limits?: Sb3LimitOptions
}

interface CentralEntry
{
  path: string
  compression: number
  compressedBytes: number
  uncompressedBytes: number
  crc32: number
  dataOffset: number
}

interface ArchivePreflight
{
  entries: CentralEntry[]
  knownUncompressedBytes: number
  projectJsonBytes: number
  assetCount: number
  assetBytes: number
  largestAssetBytes: number
}

interface AdmissionFailureOptions
{
  path?: string
  observed?: number
  limit?: number
  cause?: unknown
  metrics?: Partial<Sb3AdmissionMetrics>
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_BYTES = 22
const LOCAL_HEADER_BYTES = 30
const MAX_ZIP_COMMENT_BYTES = 0xffff
const ZIP64_U16 = 0xffff
const ZIP64_U32 = 0xffffffff
const UTF8_FLAG = 1 << 11
const DATA_DESCRIPTOR_FLAG = 1 << 3
const ENCRYPTED_FLAG = 1
const STORE_METHOD = 0
const DEFLATE_METHOD = 8
const UNIX_HOST = 3
const UNIX_TYPE_MASK = 0xf000
const UNIX_DIRECTORY = 0x4000
const UNIX_SYMLINK = 0xa000
const DOS_DIRECTORY = 0x10
const PATH_DISPLAY_LIMIT = 160

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

export class Sb3AdmissionError extends Error
{
  readonly code: Sb3AdmissionCode
  readonly issue: Sb3AdmissionIssue
  readonly limits: Sb3Limits
  readonly metrics: Partial<Sb3AdmissionMetrics>

  constructor(
    code: Sb3AdmissionCode,
    message: string,
    limits: Sb3Limits,
    options: AdmissionFailureOptions = {}
  )
  {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    )
    this.name = 'Sb3AdmissionError'
    this.code = code
    this.issue = {
      code,
      message,
      ...(options.path === undefined ? {} : { path: options.path }),
      ...(options.observed === undefined ? {} : { observed: options.observed }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }
    this.limits = { ...limits }
    this.metrics = { ...options.metrics }
  }
}

export function isSb3AdmissionError(
  error: unknown
): error is Sb3AdmissionError
{
  return error instanceof Sb3AdmissionError
}

function boundedPath(path: string): string
{
  if (path.length <= PATH_DISPLAY_LIMIT) return path
  return `${path.slice(0, PATH_DISPLAY_LIMIT - 3)}...`
}

function errorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}

function crc32(bytes: Uint8Array): number
{
  let value = 0xffffffff
  for (const byte of bytes)
  {
    value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function fail(
  code: Sb3AdmissionCode,
  message: string,
  limits: Sb3Limits,
  options: AdmissionFailureOptions = {}
): never
{
  throw new Sb3AdmissionError(code, message, limits, options)
}

function dataView(bytes: Uint8Array): DataView
{
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function findEocd(view: DataView, limits: Sb3Limits): number
{
  const start = view.byteLength - EOCD_BYTES
  const minimum = Math.max(0, start - MAX_ZIP_COMMENT_BYTES)
  for (let offset = start; offset >= minimum; offset--)
  {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue
    const commentBytes = view.getUint16(offset + 20, true)
    if (offset + EOCD_BYTES + commentBytes === view.byteLength) return offset
  }
  return fail(
    SB3_ADMISSION_CODES.archiveInvalid,
    'invalid .sb3 ZIP end record',
    limits
  )
}

function decodeEntryName(
  bytes: Uint8Array,
  utf8: boolean,
  limits: Sb3Limits
): string
{
  const ascii = bytes.every((byte) => byte < 0x80)
  if (!ascii && !utf8)
  {
    return fail(
      SB3_ADMISSION_CODES.entryNameEncodingUnsupported,
      'non-UTF-8 .sb3 entry names are not supported',
      limits
    )
  }
  try
  {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch (cause)
  {
    return fail(
      SB3_ADMISSION_CODES.entryNameEncodingUnsupported,
      'invalid UTF-8 .sb3 entry name',
      limits,
      { cause }
    )
  }
}

function isDirectoryEntry(
  path: string,
  madeBy: number,
  externalAttributes: number
): boolean
{
  if (path.endsWith('/')) return true
  if ((externalAttributes & DOS_DIRECTORY) !== 0) return true
  if (madeBy !== UNIX_HOST) return false
  const mode = externalAttributes >>> 16
  return (mode & UNIX_TYPE_MASK) === UNIX_DIRECTORY
}

function isSymlinkEntry(madeBy: number, externalAttributes: number): boolean
{
  if (madeBy !== UNIX_HOST) return false
  const mode = externalAttributes >>> 16
  return (mode & UNIX_TYPE_MASK) === UNIX_SYMLINK
}

function preflightArchive(
  bytes: Uint8Array,
  limits: Sb3Limits,
  baseMetrics: Partial<Sb3AdmissionMetrics>
): ArchivePreflight
{
  const view = dataView(bytes)
  if (view.byteLength < EOCD_BYTES)
  {
    return fail(
      SB3_ADMISSION_CODES.archiveInvalid,
      'invalid .sb3 ZIP archive',
      limits
    )
  }
  const eocd = findEocd(view, limits)
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskEntries = view.getUint16(eocd + 8, true)
  const entryCount = view.getUint16(eocd + 10, true)
  const centralBytes = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  const entryMetrics = { ...baseMetrics, entryCount }

  if (
    entryCount === ZIP64_U16 ||
    diskEntries === ZIP64_U16 ||
    centralBytes === ZIP64_U32 ||
    centralOffset === ZIP64_U32
  )
  {
    return fail(
      SB3_ADMISSION_CODES.zip64Unsupported,
      'ZIP64 .sb3 archives are not supported',
      limits,
      { metrics: entryMetrics }
    )
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount)
  {
    return fail(
      SB3_ADMISSION_CODES.multidiskUnsupported,
      'multi-disk .sb3 archives are not supported',
      limits,
      { metrics: entryMetrics }
    )
  }
  if (entryCount > limits.maxEntries)
  {
    return fail(
      SB3_ADMISSION_CODES.entryCountLimit,
      `.sb3 has ${entryCount} entries; max ${limits.maxEntries}`,
      limits,
      {
        observed: entryCount,
        limit: limits.maxEntries,
        metrics: entryMetrics,
      }
    )
  }
  if (
    centralOffset > eocd ||
    centralBytes > eocd - centralOffset ||
    centralOffset + centralBytes !== eocd
  )
  {
    return fail(
      SB3_ADMISSION_CODES.archiveInvalid,
      'invalid .sb3 central directory bounds',
      limits,
      { metrics: entryMetrics }
    )
  }

  const seen = new Set<string>()
  const entries: CentralEntry[] = []
  let offset = centralOffset
  let knownUncompressedBytes = 0
  let projectJsonBytes = -1
  let assetCount = 0
  let assetBytes = 0
  let largestAssetBytes = 0

  for (let index = 0; index < entryCount; index++)
  {
    if (
      offset + 46 > eocd ||
      view.getUint32(offset, true) !== CENTRAL_SIGNATURE
    )
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        'invalid .sb3 central directory entry',
        limits,
        { metrics: entryMetrics }
      )
    }
    const madeBy = view.getUint8(offset + 5)
    const flags = view.getUint16(offset + 8, true)
    const compression = view.getUint16(offset + 10, true)
    const expectedCrc32 = view.getUint32(offset + 16, true)
    const compressedBytes = view.getUint32(offset + 20, true)
    const uncompressedBytes = view.getUint32(offset + 24, true)
    const nameBytes = view.getUint16(offset + 28, true)
    const extraBytes = view.getUint16(offset + 30, true)
    const commentBytes = view.getUint16(offset + 32, true)
    const startDisk = view.getUint16(offset + 34, true)
    const externalAttributes = view.getUint32(offset + 38, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const next = offset + 46 + nameBytes + extraBytes + commentBytes
    if (next > eocd)
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        'invalid .sb3 central directory entry bounds',
        limits,
        { metrics: entryMetrics }
      )
    }
    if (
      compressedBytes === ZIP64_U32 ||
      uncompressedBytes === ZIP64_U32 ||
      localHeaderOffset === ZIP64_U32 ||
      startDisk === ZIP64_U16
    )
    {
      return fail(
        SB3_ADMISSION_CODES.zip64Unsupported,
        'ZIP64 .sb3 entries are not supported',
        limits,
        { metrics: entryMetrics }
      )
    }
    if (startDisk !== 0)
    {
      return fail(
        SB3_ADMISSION_CODES.multidiskUnsupported,
        'multi-disk .sb3 entries are not supported',
        limits,
        { metrics: entryMetrics }
      )
    }
    const name = decodeEntryName(
      bytes.subarray(offset + 46, offset + 46 + nameBytes),
      (flags & UTF8_FLAG) !== 0,
      limits
    )
    const shown = boundedPath(name)
    if ((flags & ENCRYPTED_FLAG) !== 0)
    {
      return fail(
        SB3_ADMISSION_CODES.encryptedEntry,
        `.sb3 encrypted entries are not supported: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    if (compression !== STORE_METHOD && compression !== DEFLATE_METHOD)
    {
      return fail(
        SB3_ADMISSION_CODES.compressionUnsupported,
        `.sb3 entry uses unsupported compression ${compression}: "${shown}"`,
        limits,
        { path: shown, observed: compression, metrics: entryMetrics }
      )
    }
    if (isDirectoryEntry(name, madeBy, externalAttributes))
    {
      return fail(
        SB3_ADMISSION_CODES.directoryEntry,
        `.sb3 directories are not supported: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    if (isSymlinkEntry(madeBy, externalAttributes))
    {
      return fail(
        SB3_ADMISSION_CODES.entryTypeUnsupported,
        `.sb3 symbolic links are not supported: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    if (!isValidSb3EntryPath(name))
    {
      return fail(
        SB3_ADMISSION_CODES.invalidEntryPath,
        `invalid .sb3 entry path "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    if (seen.has(name))
    {
      return fail(
        SB3_ADMISSION_CODES.duplicateEntry,
        `duplicate .sb3 entry "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    seen.add(name)
    if (
      localHeaderOffset > centralOffset - LOCAL_HEADER_BYTES ||
      view.getUint32(localHeaderOffset, true) !== LOCAL_SIGNATURE
    )
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        `.sb3 entry has an invalid local header: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    const localFlags = view.getUint16(localHeaderOffset + 6, true)
    const localCompression = view.getUint16(localHeaderOffset + 8, true)
    const localCrc32 = view.getUint32(localHeaderOffset + 14, true)
    const localCompressedBytes = view.getUint32(localHeaderOffset + 18, true)
    const localUncompressedBytes = view.getUint32(localHeaderOffset + 22, true)
    const localNameBytes = view.getUint16(localHeaderOffset + 26, true)
    const localExtraBytes = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset =
      localHeaderOffset + LOCAL_HEADER_BYTES + localNameBytes + localExtraBytes
    if (
      dataOffset > centralOffset ||
      compressedBytes > centralOffset - dataOffset
    )
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        `.sb3 entry data is outside the archive body: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    const localName = decodeEntryName(
      bytes.subarray(
        localHeaderOffset + LOCAL_HEADER_BYTES,
        localHeaderOffset + LOCAL_HEADER_BYTES + localNameBytes
      ),
      (localFlags & UTF8_FLAG) !== 0,
      limits
    )
    if (
      localName !== name ||
      localFlags !== flags ||
      localCompression !== compression
    )
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        `.sb3 local header disagrees with the central directory: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    const usesDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0
    if (
      (usesDescriptor && localCrc32 !== 0 && localCrc32 !== expectedCrc32) ||
      (!usesDescriptor && localCrc32 !== expectedCrc32)
    )
    {
      return fail(
        SB3_ADMISSION_CODES.entryCrcMismatch,
        `.sb3 local CRC disagrees with the central directory: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    const localSizesMatch = usesDescriptor
      ? (localCompressedBytes === 0 ||
          localCompressedBytes === compressedBytes) &&
        (localUncompressedBytes === 0 ||
          localUncompressedBytes === uncompressedBytes)
      : localCompressedBytes === compressedBytes &&
        localUncompressedBytes === uncompressedBytes
    if (!localSizesMatch)
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        `.sb3 local sizes disagree with the central directory: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    if (compression === STORE_METHOD && compressedBytes !== uncompressedBytes)
    {
      return fail(
        SB3_ADMISSION_CODES.archiveInvalid,
        `.sb3 stored entry has inconsistent sizes: "${shown}"`,
        limits,
        { path: shown, metrics: entryMetrics }
      )
    }
    entries.push({
      path: name,
      compression,
      compressedBytes,
      uncompressedBytes,
      crc32: expectedCrc32,
      dataOffset,
    })
    knownUncompressedBytes += uncompressedBytes

    if (name === 'project.json')
    {
      projectJsonBytes = uncompressedBytes
      if (projectJsonBytes > limits.maxProjectJsonBytes)
      {
        return fail(
          SB3_ADMISSION_CODES.projectJsonSizeLimit,
          `project.json exceeds ${limits.maxProjectJsonBytes} bytes`,
          limits,
          {
            path: name,
            observed: projectJsonBytes,
            limit: limits.maxProjectJsonBytes,
            metrics: { ...entryMetrics, knownUncompressedBytes },
          }
        )
      }
    }
    else
    {
      assetCount++
      assetBytes += uncompressedBytes
      largestAssetBytes = Math.max(largestAssetBytes, uncompressedBytes)
      if (uncompressedBytes > limits.maxAssetBytes)
      {
        return fail(
          SB3_ADMISSION_CODES.assetSizeLimit,
          `asset ${shown} exceeds ${limits.maxAssetBytes} bytes`,
          limits,
          {
            path: shown,
            observed: uncompressedBytes,
            limit: limits.maxAssetBytes,
            metrics: { ...entryMetrics, knownUncompressedBytes, assetCount },
          }
        )
      }
      if (assetBytes > limits.maxTotalAssetBytes)
      {
        return fail(
          SB3_ADMISSION_CODES.totalAssetSizeLimit,
          `assets exceed ${limits.maxTotalAssetBytes} total bytes`,
          limits,
          {
            observed: assetBytes,
            limit: limits.maxTotalAssetBytes,
            metrics: {
              ...entryMetrics,
              knownUncompressedBytes,
              assetCount,
              assetBytes,
            },
          }
        )
      }
    }
    offset = next
  }

  if (offset !== eocd)
  {
    return fail(
      SB3_ADMISSION_CODES.archiveInvalid,
      'invalid .sb3 central directory size',
      limits,
      { metrics: entryMetrics }
    )
  }
  if (projectJsonBytes < 0)
  {
    return fail(
      SB3_ADMISSION_CODES.projectJsonMissing,
      'project.json not found in .sb3 (single-sprite .sprite3 files are not supported)',
      limits,
      {
        metrics: {
          ...entryMetrics,
          knownUncompressedBytes,
          assetCount,
          assetBytes,
          largestAssetBytes,
        },
      }
    )
  }
  return {
    entries,
    knownUncompressedBytes,
    projectJsonBytes,
    assetCount,
    assetBytes,
    largestAssetBytes,
  }
}

function ensureActualSize(
  path: string,
  actual: number,
  expected: number,
  code: Sb3AdmissionCode,
  label: string,
  limit: number,
  limits: Sb3Limits,
  metrics: Partial<Sb3AdmissionMetrics>
): void
{
  if (actual !== expected)
  {
    fail(
      SB3_ADMISSION_CODES.archiveInvalid,
      `.sb3 entry size disagrees with central directory: "${boundedPath(path)}"`,
      limits,
      { path: boundedPath(path), observed: actual, metrics }
    )
  }
  if (actual > limit)
  {
    fail(code, `${label} exceeds ${limit} bytes`, limits, {
      path: boundedPath(path),
      observed: actual,
      limit,
      metrics,
    })
  }
}

function extractEntry(
  archive: Uint8Array,
  entry: CentralEntry,
  code: Sb3AdmissionCode,
  label: string,
  limit: number,
  limits: Sb3Limits,
  metrics: Partial<Sb3AdmissionMetrics>
): Uint8Array
{
  const compressed = archive.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedBytes
  )
  let output: Uint8Array
  try
  {
    output =
      entry.compression === STORE_METHOD
        ? Uint8Array.from(compressed)
        : Uint8Array.from(
            inflateRawSync(compressed, {
              maxOutputLength: Math.max(
                1,
                Math.min(entry.uncompressedBytes, limit)
              ),
            })
          )
  }
  catch (cause)
  {
    return fail(
      SB3_ADMISSION_CODES.archiveInvalid,
      `failed to decompress .sb3 entry "${boundedPath(entry.path)}": ${errorMessage(cause)}`,
      limits,
      { path: boundedPath(entry.path), cause, metrics }
    )
  }
  ensureActualSize(
    entry.path,
    output.byteLength,
    entry.uncompressedBytes,
    code,
    label,
    limit,
    limits,
    metrics
  )
  return output
}

export async function admitSb3(
  bytes: Uint8Array,
  options: AdmitOptions = {}
): Promise<Sb3Admission>
{
  let limits: Sb3Limits
  try
  {
    limits = resolveSb3Limits(options.limits)
  }
  catch (cause)
  {
    throw new Sb3AdmissionError(
      SB3_ADMISSION_CODES.limitsInvalid,
      errorMessage(cause),
      { ...DEFAULT_SB3_LIMITS },
      { cause }
    )
  }
  const compressedBytes = bytes.byteLength
  if (compressedBytes > limits.maxCompressedBytes)
  {
    return fail(
      SB3_ADMISSION_CODES.compressedSizeLimit,
      `.sb3 exceeds ${limits.maxCompressedBytes} compressed bytes`,
      limits,
      {
        observed: compressedBytes,
        limit: limits.maxCompressedBytes,
        metrics: { compressedBytes },
      }
    )
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const preflight = preflightArchive(bytes, limits, {
    sha256,
    compressedBytes,
  })
  try
  {
    await JSZip.loadAsync(bytes)
  }
  catch (cause)
  {
    return fail(
      SB3_ADMISSION_CODES.archiveInvalid,
      `invalid .sb3 ZIP archive: ${errorMessage(cause)}`,
      limits,
      {
        cause,
        metrics: {
          sha256,
          compressedBytes,
          entryCount: preflight.entries.length,
          knownUncompressedBytes: preflight.knownUncompressedBytes,
        },
      }
    )
  }

  const projectEntry = preflight.entries.find(
    (entry) => entry.path === 'project.json'
  )!
  const projectBytes = extractEntry(
    bytes,
    projectEntry,
    SB3_ADMISSION_CODES.projectJsonSizeLimit,
    'project.json',
    limits.maxProjectJsonBytes,
    limits,
    { sha256, compressedBytes }
  )
  if (crc32(projectBytes) !== projectEntry.crc32)
  {
    return fail(
      SB3_ADMISSION_CODES.entryCrcMismatch,
      'project.json CRC does not match the central directory',
      limits,
      { path: 'project.json', metrics: { sha256, compressedBytes } }
    )
  }

  let projectJsonText: string
  try
  {
    projectJsonText = new TextDecoder('utf-8', { fatal: true }).decode(
      projectBytes
    )
  }
  catch (cause)
  {
    return fail(
      SB3_ADMISSION_CODES.projectJsonEncodingInvalid,
      'project.json is not valid UTF-8',
      limits,
      { path: 'project.json', cause, metrics: { sha256, compressedBytes } }
    )
  }

  const assets: Asset[] = []
  let assetBytes = 0
  let largestAssetBytes = 0
  const assetEntries = preflight.entries
    .filter((entry) => entry.path !== 'project.json')
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const entry of assetEntries)
  {
    const asset = extractEntry(
      bytes,
      entry,
      SB3_ADMISSION_CODES.assetSizeLimit,
      `asset ${boundedPath(entry.path)}`,
      limits.maxAssetBytes,
      limits,
      { sha256, compressedBytes, assetCount: assets.length + 1 }
    )
    if (crc32(asset) !== entry.crc32)
    {
      return fail(
        SB3_ADMISSION_CODES.entryCrcMismatch,
        `.sb3 entry CRC does not match: "${boundedPath(entry.path)}"`,
        limits,
        {
          path: boundedPath(entry.path),
          metrics: { sha256, compressedBytes, assetCount: assets.length + 1 },
        }
      )
    }
    assetBytes += asset.byteLength
    if (assetBytes > limits.maxTotalAssetBytes)
    {
      return fail(
        SB3_ADMISSION_CODES.totalAssetSizeLimit,
        `assets exceed ${limits.maxTotalAssetBytes} total bytes`,
        limits,
        {
          observed: assetBytes,
          limit: limits.maxTotalAssetBytes,
          metrics: { sha256, compressedBytes, assetBytes },
        }
      )
    }
    largestAssetBytes = Math.max(largestAssetBytes, asset.byteLength)
    assets.push({ path: entry.path, bytes: asset })
  }

  return {
    projectJsonText,
    assets,
    limits: { ...limits },
    metrics: {
      sha256,
      projectJsonSha256: createHash('sha256')
        .update(projectBytes)
        .digest('hex'),
      compressedBytes,
      entryCount: preflight.entries.length,
      knownUncompressedBytes: preflight.knownUncompressedBytes,
      projectJsonBytes: projectBytes.byteLength,
      assetCount: assets.length,
      assetBytes,
      largestAssetBytes,
    },
  }
}
