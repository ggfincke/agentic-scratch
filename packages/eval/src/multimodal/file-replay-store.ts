// packages/eval/src/multimodal/file-replay-store.ts
// bounded immutable filesystem storage for exact Multimodal VLM replay records

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'

import type {
  VlmReplayEntryV1,
  VlmReplayStore,
  VlmRequestKey,
} from './vlm.js'

export const MAX_FILE_VLM_REPLAY_RECORDS = 512
const MAX_FILE_VLM_REPLAY_RECORD_BYTES = 4 * 1024 * 1024

const REQUEST_KEY_PATTERN = /^multimodal-vlm-v1:([0-9a-f]{64})$/
const RECORD_FILE_PATTERN = /^multimodal-vlm-v1-([0-9a-f]{64})\.json$/
const RECORD_FILE_PREFIX = 'multimodal-vlm-v1-'
const SLOT_DIRECTORY_NAME = '.multimodal-vlm-replay-slots'
const SLOT_FILE_PATTERN = /^(\d{3})\.slot$/
const TEMP_FILE_PREFIX = '.multimodal-vlm-replay-write-'
const SLOT_TEMP_FILE_PREFIX = '.multimodal-vlm-replay-slot-'
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const MAX_SLOT_FILE_BYTES = 128

interface RetainedVlmReplayFile
{
  key: VlmRequestKey
  fileName: string
  path: string
  bytes: number
}

interface LoadedRetainedVlmReplayEntry extends RetainedVlmReplayFile
{
  entry: unknown
}

function errorCode(error: unknown): string | null
{
  if (typeof error !== 'object' || error === null || !('code' in error))
    return null
  return typeof error.code === 'string' ? error.code : null
}

function requestDigest(key: string): string
{
  const match = REQUEST_KEY_PATTERN.exec(key)
  if (!match)
    throw new Error(
      'VLM replay key must use the exact multimodal-vlm-v1:<sha256> form'
    )
  return match[1]!
}

function requestKeyFromFileName(fileName: string): VlmRequestKey | null
{
  const match = RECORD_FILE_PATTERN.exec(fileName)
  return match ? (`multimodal-vlm-v1:${match[1]}` as VlmRequestKey) : null
}

function pathWithin(root: string, fileName: string): string
{
  if (
    fileName.length === 0 ||
    fileName.includes('/') ||
    fileName.includes('\\')
  )
    throw new Error('VLM replay storage names must be single path segments')
  const path = resolve(root, fileName)
  const fromRoot = relative(root, path)
  if (
    fromRoot.length === 0 ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    fromRoot.includes(sep)
  )
    throw new Error('VLM replay storage path escaped its configured root')
  return path
}

async function requireDirectory(path: string, name: string): Promise<void>
{
  await mkdir(path, { recursive: true, mode: DIRECTORY_MODE })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`${name} must be a real directory, not a symlink`)
}

async function syncDirectory(path: string): Promise<void>
{
  const descriptor = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  try
  {
    await descriptor.sync()
  }
  finally
  {
    await descriptor.close()
  }
}

async function unlinkIfPresent(path: string): Promise<void>
{
  try
  {
    await unlink(path)
  }
  catch (error)
  {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

async function durableTempFile(
  root: string,
  prefix: string,
  bytes: Uint8Array
): Promise<string>
{
  const path = pathWithin(root, `${prefix}${process.pid}-${randomUUID()}.tmp`)
  try
  {
    const descriptor = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      FILE_MODE
    )
    try
    {
      await descriptor.writeFile(bytes)
      await descriptor.sync()
    }
    finally
    {
      await descriptor.close()
    }
    return path
  }
  catch (error)
  {
    await unlinkIfPresent(path)
    throw error
  }
}

async function readBoundedRegularFile(
  path: string,
  maximumBytes: number
): Promise<Uint8Array>
{
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try
  {
    const info = await descriptor.stat()
    if (!info.isFile())
      throw new Error(`replay artifact is not a file: ${path}`)
    if (info.size > maximumBytes)
      throw new Error(
        `replay artifact exceeds the ${maximumBytes}-byte limit: ${path}`
      )
    const bytes = Buffer.allocUnsafe(maximumBytes + 1)
    let offset = 0
    while (offset < bytes.byteLength)
    {
      const read = await descriptor.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      )
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    if (offset > maximumBytes)
      throw new Error(
        `replay artifact exceeds the ${maximumBytes}-byte limit: ${path}`
      )
    return Uint8Array.from(bytes.subarray(0, offset))
  }
  finally
  {
    await descriptor.close()
  }
}

async function readJsonRecord(path: string): Promise<unknown>
{
  const bytes = await readBoundedRegularFile(
    path,
    MAX_FILE_VLM_REPLAY_RECORD_BYTES
  )
  let text: string
  try
  {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch (error)
  {
    throw new Error(`replay record is not valid UTF-8: ${path}`, {
      cause: error,
    })
  }
  try
  {
    return JSON.parse(text) as unknown
  }
  catch (error)
  {
    throw new Error(`replay record is not strict JSON: ${path}`, {
      cause: error,
    })
  }
}

async function regularFileSize(path: string): Promise<number>
{
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try
  {
    const info = await descriptor.stat()
    if (!info.isFile())
      throw new Error(`replay artifact is not a file: ${path}`)
    if (info.size > MAX_FILE_VLM_REPLAY_RECORD_BYTES)
      throw new Error(
        `replay artifact exceeds the ${MAX_FILE_VLM_REPLAY_RECORD_BYTES}-byte limit: ${path}`
      )
    return info.size
  }
  finally
  {
    await descriptor.close()
  }
}

function serializedEntry(entry: Readonly<VlmReplayEntryV1>): Uint8Array
{
  const text = JSON.stringify(entry, null, 2)
  if (text === undefined)
    throw new Error('VLM replay entry is not JSON serializable')
  const bytes = Buffer.from(`${text}\n`, 'utf8')
  if (bytes.byteLength > MAX_FILE_VLM_REPLAY_RECORD_BYTES)
    throw new Error(
      `VLM replay entry exceeds the ${MAX_FILE_VLM_REPLAY_RECORD_BYTES}-byte limit`
    )
  return bytes
}

function routedEntryKey(entry: Readonly<VlmReplayEntryV1>): VlmRequestKey
{
  const candidate = (entry as { record?: { key?: unknown } }).record?.key
  if (typeof candidate !== 'string')
    throw new Error('VLM replay entry has no string record key')
  requestDigest(candidate)
  return candidate as VlmRequestKey
}

function fileNameForVlmRequestKey(key: VlmRequestKey): string
{
  return `${RECORD_FILE_PREFIX}${requestDigest(key)}.json`
}

async function enumerateRetainedVlmReplayFiles(
  directory: string
): Promise<readonly RetainedVlmReplayFile[]>
{
  const root = resolve(directory)
  let entries
  try
  {
    entries = await readdir(root, { withFileTypes: true })
  }
  catch (error)
  {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  const retained: RetainedVlmReplayFile[] = []
  for (const entry of entries)
  {
    const key = requestKeyFromFileName(entry.name)
    if (!key)
    {
      if (
        entry.name.startsWith(RECORD_FILE_PREFIX) &&
        entry.name.endsWith('.json')
      )
        throw new Error(`malformed VLM replay record filename: ${entry.name}`)
      continue
    }
    if (!entry.isFile())
      throw new Error(`VLM replay record is not a regular file: ${entry.name}`)
    const path = pathWithin(root, entry.name)
    retained.push({
      key,
      fileName: entry.name,
      path,
      bytes: await regularFileSize(path),
    })
  }
  if (retained.length > MAX_FILE_VLM_REPLAY_RECORDS)
    throw new Error(
      `VLM replay store exceeds the ${MAX_FILE_VLM_REPLAY_RECORDS}-record limit`
    )
  retained.sort((left, right) => left.key.localeCompare(right.key))
  return retained
}

async function loadRetainedVlmReplayEntries(
  directory: string
): Promise<readonly LoadedRetainedVlmReplayEntry[]>
{
  const retained = await enumerateRetainedVlmReplayFiles(directory)
  const loaded: LoadedRetainedVlmReplayEntry[] = []
  for (const record of retained)
  {
    loaded.push({
      ...record,
      entry: await readJsonRecord(record.path),
    })
  }
  return loaded
}

async function slotKeys(slotRoot: string): Promise<Set<VlmRequestKey>>
{
  const entries = await readdir(slotRoot, { withFileTypes: true })
  const keys = new Set<VlmRequestKey>()
  for (const entry of entries)
  {
    const match = SLOT_FILE_PATTERN.exec(entry.name)
    if (!match)
    {
      if (entry.name.startsWith(SLOT_TEMP_FILE_PREFIX)) continue
      throw new Error(`unexpected VLM replay capacity artifact: ${entry.name}`)
    }
    const index = Number(match[1])
    if (index >= MAX_FILE_VLM_REPLAY_RECORDS || !entry.isFile())
      throw new Error(`invalid VLM replay capacity slot: ${entry.name}`)
    const path = pathWithin(slotRoot, entry.name)
    const bytes = await readBoundedRegularFile(path, MAX_SLOT_FILE_BYTES)
    let marker: string
    try
    {
      marker = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch (error)
    {
      throw new Error(`invalid VLM replay capacity marker: ${entry.name}`, {
        cause: error,
      })
    }
    const key = marker.endsWith('\n') ? marker.slice(0, -1) : ''
    requestDigest(key)
    if (keys.has(key as VlmRequestKey))
      throw new Error(`duplicate VLM replay capacity marker for ${key}`)
    keys.add(key as VlmRequestKey)
  }
  return keys
}

async function assertCapacityAccounting(
  root: string,
  slotRoot: string
): Promise<void>
{
  const [retained, reserved] = await Promise.all([
    enumerateRetainedVlmReplayFiles(root),
    slotKeys(slotRoot),
  ])
  for (const record of retained)
  {
    if (!reserved.has(record.key))
      throw new Error(
        `VLM replay record has no capacity reservation: ${record.fileName}`
      )
  }
  const retainedKeys = new Set(retained.map((record) => record.key))
  for (const key of reserved)
  {
    if (!retainedKeys.has(key))
      throw new Error(`VLM replay capacity reservation has no record: ${key}`)
  }
}

interface CapacityReservation
{
  path: string
  owned: boolean
}

async function reserveCapacity(
  slotRoot: string,
  key: VlmRequestKey
): Promise<CapacityReservation>
{
  requestDigest(key)
  const marker = Buffer.from(`${key}\n`, 'utf8')
  const markerTemp = await durableTempFile(
    slotRoot,
    SLOT_TEMP_FILE_PREFIX,
    marker
  )
  try
  {
    const first =
      createHash('sha256').update(key).digest().readUInt32BE(0) %
      MAX_FILE_VLM_REPLAY_RECORDS
    for (let offset = 0; offset < MAX_FILE_VLM_REPLAY_RECORDS; offset++)
    {
      const index = (first + offset) % MAX_FILE_VLM_REPLAY_RECORDS
      const slotPath = pathWithin(
        slotRoot,
        `${index.toString().padStart(3, '0')}.slot`
      )
      try
      {
        await link(markerTemp, slotPath)
        try
        {
          await syncDirectory(slotRoot)
        }
        catch (error)
        {
          try
          {
            await rollbackReservation(slotRoot, {
              path: slotPath,
              owned: true,
            })
          }
          catch (rollbackError)
          {
            throw new AggregateError(
              [error, rollbackError],
              'VLM replay capacity reservation and rollback both failed'
            )
          }
          throw error
        }
        return { path: slotPath, owned: true }
      }
      catch (error)
      {
        if (errorCode(error) !== 'EEXIST') throw error
        const existing = await readBoundedRegularFile(
          slotPath,
          MAX_SLOT_FILE_BYTES
        )
        if (Buffer.from(existing).equals(marker))
          throw new Error(`VLM replay key already has a reservation: ${key}`)
      }
    }
    throw new Error(
      `VLM replay store reached its ${MAX_FILE_VLM_REPLAY_RECORDS}-record limit`
    )
  }
  finally
  {
    await unlinkIfPresent(markerTemp)
  }
}

async function regularFileExists(path: string): Promise<boolean>
{
  try
  {
    const info = await lstat(path)
    return info.isFile() && !info.isSymbolicLink()
  }
  catch (error)
  {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

async function rollbackReservation(
  slotRoot: string,
  reservation: CapacityReservation
): Promise<void>
{
  if (!reservation.owned) return
  await unlinkIfPresent(reservation.path)
  await syncDirectory(slotRoot)
}

export class FileVlmReplayStore implements VlmReplayStore
{
  readonly root: string
  readonly #slotRoot: string
  #writableReady: Promise<void> | null = null

  constructor(directory: string)
  {
    if (directory.trim().length === 0 || directory.includes('\0'))
      throw new Error(
        'VLM replay directory must be a non-empty filesystem path'
      )
    this.root = resolve(directory)
    this.#slotRoot = resolve(this.root, SLOT_DIRECTORY_NAME)
    const fromRoot = relative(this.root, this.#slotRoot)
    if (fromRoot !== SLOT_DIRECTORY_NAME)
      throw new Error('VLM replay capacity path escaped its configured root')
  }

  pathForKey(key: VlmRequestKey): string
  {
    return pathWithin(this.root, fileNameForVlmRequestKey(key))
  }

  async enumerateRetained(): Promise<readonly RetainedVlmReplayFile[]>
  {
    return enumerateRetainedVlmReplayFiles(this.root)
  }

  async loadRetained(): Promise<readonly LoadedRetainedVlmReplayEntry[]>
  {
    return loadRetainedVlmReplayEntries(this.root)
  }

  async read(key: VlmRequestKey): Promise<unknown | null>
  {
    const path = this.pathForKey(key)
    try
    {
      return await readJsonRecord(path)
    }
    catch (error)
    {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
  }

  #prepareWritable(): Promise<void>
  {
    this.#writableReady ??= this.#initializeWritable()
    return this.#writableReady
  }

  async #initializeWritable(): Promise<void>
  {
    await requireDirectory(this.root, 'VLM replay root')
    await requireDirectory(this.#slotRoot, 'VLM replay capacity root')
  }

  async writeExclusive(entry: Readonly<VlmReplayEntryV1>): Promise<void>
  {
    const key = routedEntryKey(entry)
    const bytes = serializedEntry(entry)
    await this.#prepareWritable()
    await assertCapacityAccounting(this.root, this.#slotRoot)

    const finalPath = this.pathForKey(key)
    const recordTemp = await durableTempFile(this.root, TEMP_FILE_PREFIX, bytes)
    let reservation: CapacityReservation | null = null
    let recordLinked = false
    try
    {
      reservation = await reserveCapacity(this.#slotRoot, key)
      try
      {
        await link(recordTemp, finalPath)
        recordLinked = true
      }
      catch (error)
      {
        if (errorCode(error) === 'EEXIST')
          throw new Error(`VLM replay key already exists: ${key}`, {
            cause: error,
          })
        throw error
      }
      await syncDirectory(this.root)
    }
    catch (error)
    {
      let retainedByAnotherWriter = false
      if (reservation?.owned && !recordLinked)
      {
        try
        {
          retainedByAnotherWriter = await regularFileExists(finalPath)
        }
        catch (inspectionError)
        {
          throw new AggregateError(
            [error, inspectionError],
            'VLM replay write failed and record state could not be inspected'
          )
        }
      }
      if (reservation?.owned && !recordLinked && !retainedByAnotherWriter)
        try
        {
          await rollbackReservation(this.#slotRoot, reservation)
        }
        catch (rollbackError)
        {
          throw new AggregateError(
            [error, rollbackError],
            'VLM replay write and capacity rollback both failed'
          )
        }
      throw error
    }
    finally
    {
      await unlinkIfPresent(recordTemp)
    }
  }
}
