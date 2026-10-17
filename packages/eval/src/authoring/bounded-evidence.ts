// packages/eval/src/authoring/bounded-evidence.ts
// retain complete authoring evidence in bounded hash-bound component documents

import { createHash } from 'node:crypto'

import { DEFAULT_EDIT_ADMISSION_LIMITS } from '@scratch-agent/sb3'
import {
  canonicalJsonBytesV1,
  canonicalJsonV1,
  CanonicalJsonError,
  DEFAULT_CANONICAL_JSON_LIMITS,
} from '@scratch-agent/sb3/canonical-json'

const MAX_BYTES = 128 * 1024 * 1024
const KIND = 'authoring-evaluation-components-v1'
const HASH = /^[a-f0-9]{64}$/u
const CATALOG_KEYS = [
  'targets',
  'scripts',
  'blocks',
  'declarations',
  'diagnostics',
] as const
// runtime traces snapshot every admitted list, so they get edit-admission limits
const TRACE_LIMITS = Object.freeze({
  maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
  maxNodes: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes,
  maxMembers: DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
  maxStringCodeUnits: DEFAULT_CANONICAL_JSON_LIMITS.maxStringCodeUnits,
})

type Encode = (value: unknown) => Uint8Array

export interface AuthoringEvidenceComponentV1
{
  sha256: string
  byteLength: number
}

export interface EncodedAuthoringEvidenceV1
{
  bytes: Uint8Array
  components: readonly (AuthoringEvidenceComponentV1 & {
    bytes: Uint8Array
  })[]
}

function hash(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function record(value: unknown): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('authoring evidence requires an object')
  return value as Record<string, unknown>
}

function boundedBytes(value: unknown): Uint8Array
{
  return canonicalJsonBytesV1(value)
}

// * trace hashes, stored trace components, & their decode check share this
export function authoringTraceBytesV1(value: unknown): Uint8Array
{
  return new TextEncoder().encode(canonicalJsonV1(value, TRACE_LIMITS))
}

function aggregate(bytes: Uint8Array, lengths: readonly number[]): void
{
  if (
    bytes.byteLength + lengths.reduce((sum, length) => sum + length, 0) >
    MAX_BYTES
  )
    throw new Error('authoring evaluation evidence exceeds its byte limit')
}

// records too large for one default canonical document fall back to components
// * encode & hash share this so retained bytes keep matching their hash
function exceedsDocumentBudget(error: unknown): boolean
{
  return (
    error instanceof CanonicalJsonError &&
    (error.code === 'nodes' || error.code === 'members')
  )
}

// ordinary small records keep their exact historical canonical bytes
export function encodeAuthoringEvidenceV1(
  value: unknown
): EncodedAuthoringEvidenceV1
{
  try
  {
    const bytes = boundedBytes(value)
    aggregate(bytes, [])
    return { bytes, components: [] }
  }
  catch (error)
  {
    if (!exceedsDocumentBudget(error)) throw error
  }
  return componentEvidence(value, true)
}

// refusal identities remain computable when retention must reject the byte total
function componentEvidence(
  value: unknown,
  retain: boolean
): EncodedAuthoringEvidenceV1
{
  const content = record(value)
  if (content.kind !== 'authoring-candidate-evaluation-v3')
    throw new Error('bounded authoring evidence requires a v3 evaluation')
  const components: EncodedAuthoringEvidenceV1['components'][number][] = []
  let componentBytes = 0
  const put = (
    part: unknown,
    encode: Encode = boundedBytes
  ): AuthoringEvidenceComponentV1 =>
  {
    const bytes = encode(part)
    componentBytes += bytes.byteLength
    if (retain && componentBytes > MAX_BYTES)
      throw new Error('authoring evaluation evidence exceeds its byte limit')
    const descriptor = { sha256: hash(bytes), byteLength: bytes.byteLength }
    if (retain) components.push({ ...descriptor, bytes })
    return descriptor
  }
  let inspection: unknown = content.inspection
  if (inspection !== null)
  {
    const source = record(inspection)
    const catalog = record(source.catalog)
    if (
      Object.keys(catalog).length !== CATALOG_KEYS.length ||
      CATALOG_KEYS.some((key) => !Array.isArray(catalog[key]))
    )
      throw new Error('authoring inspection catalog has an unexpected shape')
    const split = Object.fromEntries(
      CATALOG_KEYS.map((key) =>
      {
        const entries = catalog[key] as unknown[]
        const chunks: AuthoringEvidenceComponentV1[] = []
        for (let index = 0; index < entries.length; index += 256)
          chunks.push(put(entries.slice(index, index + 256)))
        return [key, { length: entries.length, chunks }]
      })
    )
    inspection = { ...source, catalog: split }
  }
  if (!Array.isArray(content.lanes))
    throw new Error('authoring evidence lanes must be an array')
  const lanes = content.lanes.map((value) =>
  {
    const lane = record(value)
    return { ...lane, trace: put(lane.trace, authoringTraceBytesV1) }
  })
  const bytes = boundedBytes({
    kind: KIND,
    schemaVersion: 1,
    content: { ...content, inspection, lanes },
  })
  // count every reference, including repeated payloads, against the same ceiling
  if (retain) aggregate(bytes, [componentBytes])
  return { bytes, components }
}

export function authoringEvidenceSha256V1(value: unknown): string
{
  try
  {
    return hash(boundedBytes(value))
  }
  catch (error)
  {
    if (!exceedsDocumentBudget(error)) throw error
  }
  return hash(componentEvidence(value, false).bytes)
}

function component(value: unknown): AuthoringEvidenceComponentV1
{
  const ref = record(value)
  if (
    Object.keys(ref).length !== 2 ||
    typeof ref.sha256 !== 'string' ||
    !HASH.test(ref.sha256) ||
    !Number.isSafeInteger(ref.byteLength) ||
    (ref.byteLength as number) < 1 ||
    (ref.byteLength as number) > MAX_BYTES
  )
    throw new Error('authoring evidence component identity is invalid')
  return ref as unknown as AuthoringEvidenceComponentV1
}

// callers provide an owner-bound immutable reader, never paths from the envelope
export async function decodeAuthoringEvidenceV1(
  bytes: Uint8Array,
  read: (component: AuthoringEvidenceComponentV1) => Promise<Uint8Array>
): Promise<unknown>
{
  if (bytes.byteLength > MAX_BYTES)
    throw new Error('authoring evaluation evidence exceeds its byte limit')
  const envelope = record(JSON.parse(Buffer.from(bytes).toString('utf8')))
  if (!Buffer.from(boundedBytes(envelope)).equals(Buffer.from(bytes)))
    throw new Error('authoring evidence is not exact canonical JSON')
  if (envelope.kind !== KIND) return envelope
  if (
    envelope.schemaVersion !== 1 ||
    Object.keys(envelope).sort().join(',') !== 'content,kind,schemaVersion'
  )
    throw new Error('authoring evidence envelope is invalid')
  const content = record(envelope.content)
  if (content.kind !== 'authoring-candidate-evaluation-v3')
    throw new Error('authoring evidence envelope has the wrong domain')
  const references: { ref: AuthoringEvidenceComponentV1; encode: Encode }[] = []
  const register = (value: unknown, encode: Encode = boundedBytes) =>
  {
    const ref = component(value)
    references.push({ ref, encode })
    return ref
  }
  let inspection: Record<string, unknown> | null = null
  const catalogs = new Map<
    string,
    { length: number; chunks: AuthoringEvidenceComponentV1[] }
  >()
  if (content.inspection !== null)
  {
    inspection = record(content.inspection)
    const catalog = record(inspection.catalog)
    if (
      Object.keys(catalog).sort().join(',') !==
      [...CATALOG_KEYS].sort().join(',')
    )
      throw new Error('authoring evidence catalog members differ')
    for (const key of CATALOG_KEYS)
    {
      const value = record(catalog[key])
      if (
        Object.keys(value).sort().join(',') !== 'chunks,length' ||
        !Number.isSafeInteger(value.length) ||
        (value.length as number) < 0 ||
        !Array.isArray(value.chunks) ||
        value.chunks.length !== Math.ceil((value.length as number) / 256)
      )
        throw new Error('authoring evidence catalog chunk sequence is invalid')
      catalogs.set(key, {
        length: value.length as number,
        chunks: value.chunks.map((chunk) => register(chunk)),
      })
    }
  }
  if (!Array.isArray(content.lanes))
    throw new Error('authoring evidence lanes must be an array')
  const lanes = content.lanes.map((value) =>
  {
    const lane = record(value)
    return { lane, ref: register(lane.trace, authoringTraceBytesV1) }
  })
  aggregate(
    bytes,
    references.map(({ ref }) => ref.byteLength)
  )
  const decoded = new Map<string, unknown>()
  for (const { ref, encode } of references)
  {
    const part = await read(ref)
    if (part.byteLength !== ref.byteLength || hash(part) !== ref.sha256)
      throw new Error('authoring evidence component bytes differ')
    const value: unknown = JSON.parse(Buffer.from(part).toString('utf8'))
    if (!Buffer.from(encode(value)).equals(Buffer.from(part)))
      throw new Error(
        'authoring evidence component is not exact canonical JSON'
      )
    decoded.set(ref.sha256, value)
  }
  if (inspection)
  {
    const catalog = Object.fromEntries(
      [...catalogs].map(([key, value]) =>
      {
        const entries: unknown[] = []
        for (let index = 0; index < value.chunks.length; index++)
        {
          const chunk = decoded.get(value.chunks[index]!.sha256)
          if (
            !Array.isArray(chunk) ||
            chunk.length !== Math.min(256, value.length - index * 256)
          )
            throw new Error('authoring evidence catalog chunk length differs')
          entries.push(...chunk)
        }
        return [key, entries]
      })
    )
    inspection = { ...inspection, catalog }
  }
  const restored = {
    ...content,
    inspection,
    lanes: lanes.map(({ lane, ref }) => ({
      ...lane,
      trace: decoded.get(ref.sha256),
    })),
  }
  if (
    !Buffer.from(encodeAuthoringEvidenceV1(restored).bytes).equals(
      Buffer.from(bytes)
    )
  )
    throw new Error('authoring evidence envelope does not reconstruct exactly')
  return restored
}
