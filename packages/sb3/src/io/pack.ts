// packages/sb3/src/io/pack.ts
// zip project.json + assets into a deterministic .sb3 (stable order, fixed dates)

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import JSZip from 'jszip'

import type { Asset } from './unpack.js'
import { normalizeAssetsByPath } from '../media/assets.js'

// fixed epoch so identical inputs produce byte-identical archives
const FIXED_DATE = new Date(0)

// jszip's carrier for an entry it already compressed: generateAsync copies its bytes, crc & sizes into the archive as
// they are instead of deflating again when its compression is the archive's (lib/zipObject.js _compressWorker); jszip
// 3.10.1 is the final release & exports no entry point for it
const jszipRequire = createRequire(
  createRequire(import.meta.url).resolve('jszip')
)
const CompressedObject = jszipRequire('./compressedObject') as new (
  compressedSize: number,
  uncompressedSize: number,
  crc32: number,
  compression: unknown,
  data: Uint8Array
) => object
const DEFLATE = (jszipRequire('./compressions') as { DEFLATE: unknown }).DEFLATE

interface DeflatedEntry
{
  crc32: number
  uncompressedSize: number
  data: Uint8Array
}

// * jszip deflates each entry w/ a fresh pako stream fed fixed-size chunks under the fixed options below, so its
// bytes, crc & sizes depend only on the payload; a payload packed before reuses the exact entry jszip wrote, keyed by
// sha-256, least recently used dropped past a budget of several times the largest archive a build packs
const DEFLATED_ENTRY_BUDGET_BYTES = 512 * 1024 * 1024
const deflatedEntries = new Map<string, DeflatedEntry>()
let deflatedEntryBytes = 0

function payloadKey(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function remember(key: string, entry: DeflatedEntry): void
{
  if (deflatedEntries.has(key)) return
  deflatedEntries.set(key, entry)
  deflatedEntryBytes += entry.data.byteLength
  for (const [oldest, old] of deflatedEntries)
  {
    if (deflatedEntryBytes <= DEFLATED_ENTRY_BUDGET_BYTES) break
    deflatedEntries.delete(oldest)
    deflatedEntryBytes -= old.data.byteLength
  }
}

// the deflated entries of an archive jszip just wrote (no archive comment, zip64 or data descriptors), by name; a
// layout it doesn't recognize just yields fewer entries to reuse
// * the walk follows the central directory's signatures, since jszip writes only the low 16 bits of the entry count
function deflatedEntriesOf(archive: Uint8Array): Map<string, DeflatedEntry>
{
  const entries = new Map<string, DeflatedEntry>()
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  )
  const end = archive.byteLength - 22
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) return entries
  const names = new TextDecoder()
  let offset = view.getUint32(end + 16, true)
  for (;;)
  {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const local = view.getUint32(offset + 42, true)
    const start =
      local + 30 <= end
        ? local +
          30 +
          view.getUint16(local + 26, true) +
          view.getUint16(local + 28, true)
        : end
    if (method === 8 && start + compressedSize <= end)
    {
      entries.set(
        names.decode(archive.subarray(offset + 46, offset + 46 + nameLength)),
        {
          crc32: view.getUint32(offset + 16, true),
          uncompressedSize: view.getUint32(offset + 24, true),
          data: archive.slice(start, start + compressedSize),
        }
      )
    }
    offset +=
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
  }
  return entries
}

// an archive jszip wrote w/ 65,535 entries or more, plus the zip64 end record & locator its count needs (jszip writes
// only the low 16 bits); the end record's counts read 0xffff, & the 32-bit central directory size & offset stay
// * an archive w/ fewer entries comes back unchanged, so its bytes are jszip's
function withZip64End(archive: Uint8Array): Uint8Array
{
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  )
  const end = archive.byteLength - 22
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) return archive
  const centralBytes = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  let count = 0
  for (let offset = centralOffset; offset < centralOffset + centralBytes; count++)
  {
    if (view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('jszip wrote an unexpected central directory')
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
  }
  if (count < 0xffff) return archive
  const tail = new Uint8Array(56 + 20 + 22)
  const out = new DataView(tail.buffer)
  // zip64 end of central directory record: its size after the size field (44), version 4.5 made & needed, disk 0
  out.setUint32(0, 0x06064b50, true)
  out.setBigUint64(4, 44n, true)
  out.setUint16(12, 45, true)
  out.setUint16(14, 45, true)
  out.setBigUint64(24, BigInt(count), true)
  out.setBigUint64(32, BigInt(count), true)
  out.setBigUint64(40, BigInt(centralBytes), true)
  out.setBigUint64(48, BigInt(centralOffset), true)
  // its locator: the record's offset & one disk
  out.setUint32(56, 0x07064b50, true)
  out.setBigUint64(64, BigInt(end), true)
  out.setUint32(72, 1, true)
  // the end record, both counts 0xffff
  tail.set(archive.subarray(end), 76)
  out.setUint16(76 + 8, 0xffff, true)
  out.setUint16(76 + 10, 0xffff, true)
  const result = new Uint8Array(end + tail.byteLength)
  result.set(archive.subarray(0, end))
  result.set(tail, end)
  return result
}

export async function packSb3(
  projectJsonText: string,
  assets: Asset[]
): Promise<Uint8Array>
{
  const zip = new JSZip()
  zip.file('project.json', projectJsonText, { date: FIXED_DATE })

  // shared payload references dedupe only when their exact bytes agree
  const fresh = new Map<string, { key: string; bytes: Uint8Array }>()
  for (const asset of normalizeAssetsByPath(assets))
  {
    // jszip stores an empty payload uncompressed, so it stays out of the reuse, as does any payload jszip accepts
    // that isn't a byte array
    const key =
      asset.bytes instanceof Uint8Array && asset.bytes.byteLength > 0
        ? payloadKey(asset.bytes)
        : undefined
    const known = key === undefined ? undefined : deflatedEntries.get(key)
    if (known)
    {
      deflatedEntries.delete(key!)
      deflatedEntries.set(key!, known)
      const compressed = new CompressedObject(
        known.data.byteLength,
        known.uncompressedSize,
        known.crc32,
        DEFLATE,
        known.data
      )
      // jszip's typings leave out the internal carrier its file() accepts
      zip.file(asset.path, compressed as Uint8Array, { date: FIXED_DATE })
      continue
    }
    if (key !== undefined) fresh.set(asset.path, { key, bytes: asset.bytes })
    zip.file(asset.path, asset.bytes, { date: FIXED_DATE })
  }

  const archive = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  if (fresh.size > 0)
  {
    // jszip reads each payload while it generates, so one changed since it was keyed stays out
    for (const [path, entry] of deflatedEntriesOf(archive))
    {
      const payload = fresh.get(path)
      if (
        payload !== undefined &&
        entry.uncompressedSize === payload.bytes.byteLength &&
        payloadKey(payload.bytes) === payload.key
      )
        remember(payload.key, entry)
    }
  }
  return withZip64End(archive)
}
