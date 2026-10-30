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
  const count = view.getUint16(end + 10, true)
  const names = new TextDecoder()
  let offset = view.getUint32(end + 16, true)
  for (let index = 0; index < count; index++)
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
  return archive
}
