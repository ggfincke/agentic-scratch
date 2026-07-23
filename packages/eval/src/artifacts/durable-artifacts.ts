// packages/eval/src/artifacts/durable-artifacts.ts
// provide neutral durable filesystem primitives over bounded logical keys

import { randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { isPathWithinRootV1 } from './path-containment.js'
import { sha256 } from '../core/sha256.js'

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 100_000
const MAX_LOGICAL_KEY_BYTES = 1_024
const MAX_LOGICAL_KEY_SEGMENTS = 32
const LOGICAL_KEY_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/
const TEMP_NAME = /^\.durable-tmp-([a-f0-9]{32})$/
const STORE_MANIFEST_NAME = '.durable-store.json'
const STORE_OWNER_NAME = '.durable-owner.json'
const STORE_QUOTA_NAME = '.durable-quota.json'
const PRIVATE_METADATA_NAMES = new Set([
  STORE_MANIFEST_NAME,
  STORE_OWNER_NAME,
  STORE_QUOTA_NAME,
])

export const DURABLE_ARTIFACT_FAULT_POINTS = [
  'capability.beforeProbe',
  'capability.afterTempOpen',
  'capability.afterTempFileSync',
  'capability.afterNoReplaceInstall',
  'capability.afterDirectorySync',
  'capability.afterPointerRename',
  'capability.afterCleanupSync',
  'capability.afterProbe',
  'directory.beforeCreate',
  'directory.afterCreate',
  'directory.beforeSync',
  'directory.afterSync',
  'immutable.beforeTempOpen',
  'immutable.afterTempOpen',
  'immutable.beforeWrite',
  'immutable.afterWrite',
  'immutable.beforeFileSync',
  'immutable.afterFileSync',
  'immutable.beforeInstall',
  'immutable.afterInstall',
  'immutable.beforeDirectorySync',
  'immutable.afterDirectorySync',
  'immutable.beforeTempCleanup',
  'immutable.afterTempCleanup',
  'immutable.beforeCleanupDirectorySync',
  'immutable.afterCleanupDirectorySync',
  'pointer.beforeExpectedRead',
  'pointer.afterExpectedRead',
  'pointer.beforeTempOpen',
  'pointer.afterTempOpen',
  'pointer.beforeWrite',
  'pointer.afterWrite',
  'pointer.beforeFileSync',
  'pointer.afterFileSync',
  'pointer.beforeCompare',
  'pointer.afterCompare',
  'pointer.beforeInstall',
  'pointer.afterInstall',
  'pointer.beforeDirectorySync',
  'pointer.afterDirectorySync',
  'pointer.beforeTempCleanup',
  'pointer.afterTempCleanup',
  'pointer.beforeCleanupDirectorySync',
  'pointer.afterCleanupDirectorySync',
  'read.beforeOpen',
  'read.afterOpen',
  'read.beforeRead',
  'read.afterRead',
  'read.afterIdentityCheck',
  'list.beforeWalk',
  'list.afterWalk',
  'evict.beforeVerify',
  'evict.afterVerify',
  'evict.beforeUnlink',
  'evict.afterUnlink',
  'evict.beforeDirectorySync',
  'evict.afterDirectorySync',
  'quota.beforeReserve',
  'quota.afterReserve',
  'quota.beforeRelease',
  'quota.afterRelease',
  'quota.beforeSettle',
  'quota.afterSettle',
  'quota.beforePersist',
  'quota.afterPersist',
  'cleanup.beforeVerify',
  'cleanup.afterVerify',
  'cleanup.beforeUnlink',
  'cleanup.afterUnlink',
  'cleanup.beforeDirectorySync',
  'cleanup.afterDirectorySync',
] as const

type DurableArtifactFaultPoint =
  (typeof DURABLE_ARTIFACT_FAULT_POINTS)[number]

export interface DurableArtifactFaultContext
{
  readonly sequence: number
  readonly point: DurableArtifactFaultPoint
  readonly operation: string
  readonly key: string | null
}

export type DurableArtifactFaultHook = (
  context: DurableArtifactFaultContext
) => void

interface DurableArtifactIdentity
{
  readonly sha256: string
  readonly byteLength: number
}

interface DurableArtifactEntry extends DurableArtifactIdentity
{
  readonly key: string
}

interface DurableArtifactMetadataEntry
{
  readonly key: string
  readonly byteLength: number
}

interface DurableArtifactTempProof extends DurableArtifactIdentity
{
  readonly schemaVersion: 1
  readonly storeId: string
  readonly logicalParent: string
  readonly tempToken: string
}

interface DurableArtifactQuotaSnapshot
{
  readonly maxBytes: number
  readonly settledBytes: number
  readonly reservedBytes: number
  readonly availableBytes: number
  readonly reservations: number
}

interface DurableArtifactStoreCapability
{
  readonly schemaVersion: 1
  readonly storeId: string
  readonly logicalKeyVersion: 'durable-logical-key-v1'
  readonly atomicPrimitiveVersion: 'durable-artifact-atomic-v1'
  readonly storeMode: DurableArtifactStoreMode
  readonly ownershipSha256: string
  readonly ownershipGeneration: number
  readonly previousOwnershipSha256: string | null
  readonly writable: boolean
  readonly immutableNoReplace: boolean
  readonly pointerExpectedHashCompareAndSwap: boolean
  readonly fileFsync: boolean
  readonly directoryFsync: boolean
  readonly noFollowOpen: true
  readonly sameDirectoryHardLink: boolean
  readonly expectedHashEviction: boolean
  readonly exclusivePrivateRoot: boolean
  readonly faultPoints: readonly DurableArtifactFaultPoint[]
  readonly quota: DurableArtifactQuotaSnapshot
}

type DurableArtifactStoreMode =
  'create-writer' | 'read-only' | 'recovery'

export interface DurableArtifactOwnershipAuthority
{
  ownerTokenSha256(input: {
    readonly storeId: string
    readonly generation: number
    readonly previousOwnershipSha256: string | null
  }): string
}

interface DurableArtifactStoreOptions
{
  readonly maxBytes?: number
  readonly maxEntryBytes?: number
  readonly maxEntries?: number
  readonly faultHook?: DurableArtifactFaultHook
  readonly probeCapabilities?: boolean
  readonly mode?: DurableArtifactStoreMode
  readonly expectedStoreId?: string
  readonly expectedOwnershipSha256?: string
  readonly ownershipAuthority?: DurableArtifactOwnershipAuthority
}

interface EditArtifactStoreHostCapability extends DurableArtifactStoreCapability
{
  readonly durableFileSync: boolean
  readonly durableDirectorySync: boolean
  readonly noReplaceInstall: boolean
  readonly expectedHashPointerCas: boolean
  readonly exclusiveWriter: boolean
}

interface DurablePointerReconciliation
{
  readonly status: 'old' | 'new' | 'interference'
  readonly observedSha256: string | null
  readonly proposed: DurableArtifactIdentity
}

interface EditArtifactStoreHostQuotaReservation
{
  readonly reservationId: string
  readonly reservedBytes: number
}

type EditArtifactStoreHostQuotaOutcome =
  | {
      readonly state: 'active'
      readonly reservationId: string
      readonly reservedBytes: number
    }
  | {
      readonly state: 'released'
      readonly reservationId: string
      readonly reservedBytes: number
      readonly actualBytes: 0
    }
  | {
      readonly state: 'settled'
      readonly reservationId: string
      readonly reservedBytes: number
      readonly actualBytes: number
    }
  | { readonly state: 'absent'; readonly reservationId: string }

export interface EditArtifactStoreHostAdapter
{
  readonly storeId: string
  capability(): Promise<EditArtifactStoreHostCapability>
  createImmutable(
    key: string,
    bytes: Uint8Array
  ): Promise<DurableArtifactIdentity>
  createOrVerifyImmutable(
    key: string,
    bytes: Uint8Array
  ): Promise<DurableArtifactIdentity>
  readImmutable(key: string): Promise<Uint8Array>
  hashImmutable(key: string): Promise<string>
  sizeImmutable(key: string): Promise<number>
  listImmutable(prefix: string): Promise<readonly DurableArtifactEntry[]>
  compareAndSwapPointer(
    key: string,
    expectedSha256: string | null,
    bytes: Uint8Array
  ): Promise<DurableArtifactIdentity>
  reconcilePointer(
    key: string,
    expectedOldSha256: string | null,
    proposedBytes: Uint8Array
  ): Promise<DurablePointerReconciliation>
  reserveQuota(
    reservationId: string,
    byteLength: number
  ): Promise<EditArtifactStoreHostQuotaReservation>
  releaseQuota(reservationId: string): Promise<void>
  settleQuota(reservationId: string, actualByteLength: number): Promise<void>
  quotaOutcome(
    reservationId: string
  ): Promise<EditArtifactStoreHostQuotaOutcome>
  activeQuotaReservations(): Promise<
    readonly EditArtifactStoreHostQuotaReservation[]
  >
  cleanupProvenTemp(proof: string): Promise<void>
  removeEvictable(key: string, expectedSha256: string): Promise<boolean>
}

type DurableArtifactStoreErrorCode =
  | 'capability-unavailable'
  | 'entry-exists'
  | 'entry-not-found'
  | 'expected-hash-mismatch'
  | 'invalid-logical-key'
  | 'invalid-quota'
  | 'path-unsafe'
  | 'quota-exceeded'
  | 'reservation-conflict'
  | 'reservation-not-found'
  | 'temp-proof-invalid'
  | 'too-many-entries'

export class DurableArtifactStoreError extends Error
{
  constructor(
    readonly code: DurableArtifactStoreErrorCode,
    message: string,
    readonly tempProof: DurableArtifactTempProof | null = null,
    readonly finalInstalled = false
  )
  {
    super(message)
    this.name = 'DurableArtifactStoreError'
  }
}

export class EditArtifactStoreHostError extends Error
{
  constructor(
    readonly code: DurableArtifactStoreErrorCode,
    message: string,
    readonly tempProof: string | null,
    readonly finalInstalled: boolean
  )
  {
    super(message)
    this.name = 'EditArtifactStoreHostError'
  }
}

interface RootIdentity
{
  readonly device: number
  readonly inode: number
  readonly uid: number
}

interface QuotaReservation
{
  readonly key: string
  readonly bytes: number
}

interface QuotaOutcome
{
  readonly kind: 'released' | 'settled'
  readonly reservedBytes: number
  readonly actualBytes: number
}

interface IssuedTemp
{
  readonly proof: DurableArtifactTempProof
  readonly path: string
}

interface DurableStoreManifest
{
  readonly schemaVersion: 1
  readonly format: 'durable-artifact-store-v1'
  readonly storeId: string
  readonly maxBytes: number
  readonly maxEntryBytes: number
  readonly maxEntries: number
  readonly rootDevice: number
  readonly rootInode: number
}

interface DurableStoreOwner
{
  readonly schemaVersion: 1
  readonly storeId: string
  readonly generation: number
  readonly previousOwnershipSha256: string | null
  readonly ownerTokenSha256: string
}

interface DurableQuotaState
{
  readonly schemaVersion: 1
  readonly generation: number
  readonly maxBytes: number
  readonly reservations: readonly QuotaReservation[]
  readonly outcomes: readonly (QuotaOutcome & { readonly key: string })[]
}

function privateJsonBytes(value: unknown): Uint8Array
{
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`)
}

function syncPrivateDirectory(path: string): void
{
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  try
  {
    fsyncSync(descriptor)
  }
  finally
  {
    closeSync(descriptor)
  }
}

function readPrivateBytes(root: string, name: string): Buffer
{
  if (!PRIVATE_METADATA_NAMES.has(name))
    throw new Error('private metadata name is not registered')
  let descriptor: number
  try
  {
    descriptor = openSync(
      join(root, name),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
  }
  catch
  {
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'required private store metadata is unavailable'
    )
  }
  try
  {
    const info = fstatSync(descriptor)
    const rootInfo = lstatSync(root)
    if (
      !info.isFile() ||
      info.dev !== rootInfo.dev ||
      info.uid !== rootInfo.uid ||
      (info.mode & 0o077) !== 0
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'private store metadata is not one private same-device file'
      )
    return readFileSync(descriptor)
  }
  finally
  {
    closeSync(descriptor)
  }
}

function installPrivateImmutable(
  root: string,
  name: string,
  bytes: Uint8Array
): string
{
  if (!PRIVATE_METADATA_NAMES.has(name))
    throw new Error('private metadata name is not registered')
  const finalPath = join(root, name)
  const tempPath = join(root, `.durable-tmp-${randomBytes(16).toString('hex')}`)
  const expectedSha256 = sha256(bytes)
  let descriptor: number | null = null
  let installed = false
  try
  {
    descriptor = openSync(
      tempPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    linkSync(tempPath, finalPath)
    installed = true
    syncPrivateDirectory(root)
    unlinkSync(tempPath)
    syncPrivateDirectory(root)
    return expectedSha256
  }
  catch (error)
  {
    if (descriptor !== null) closeSync(descriptor)
    if (installed)
    {
      try
      {
        if (sha256(readPrivateBytes(root, name)) === expectedSha256)
        {
          syncPrivateDirectory(root)
          try
          {
            unlinkSync(tempPath)
          }
          catch (cleanupError)
          {
            if (!isMissing(cleanupError)) throw cleanupError
          }
          syncPrivateDirectory(root)
          return expectedSha256
        }
      }
      catch
      {
        // root creation remains failed if exact installation cannot be proved
      }
    }
    if (!installed)
    {
      try
      {
        unlinkSync(tempPath)
      }
      catch (cleanupError)
      {
        if (!isMissing(cleanupError)) throw error
      }
    }
    throw error
  }
}

function replacePrivatePointer(
  root: string,
  name: string,
  expectedSha256: string,
  bytes: Uint8Array
): string
{
  const proposedSha256 = sha256(bytes)
  if (sha256(readPrivateBytes(root, name)) !== expectedSha256)
    throw new DurableArtifactStoreError(
      'expected-hash-mismatch',
      'private metadata pointer changed before replacement'
    )
  const finalPath = join(root, name)
  const tempPath = join(root, `.durable-tmp-${randomBytes(16).toString('hex')}`)
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(
      tempPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    if (sha256(readPrivateBytes(root, name)) !== expectedSha256)
      throw new DurableArtifactStoreError(
        'expected-hash-mismatch',
        'private metadata pointer changed before atomic installation'
      )
    renameSync(tempPath, finalPath)
    syncPrivateDirectory(root)
    return proposedSha256
  }
  catch (error)
  {
    if (descriptor !== null) closeSync(descriptor)
    try
    {
      unlinkSync(tempPath)
    }
    catch (cleanupError)
    {
      if (!isMissing(cleanupError)) throw error
    }
    try
    {
      if (sha256(readPrivateBytes(root, name)) === proposedSha256)
      {
        syncPrivateDirectory(root)
        return proposedSha256
      }
    }
    catch
    {
      // the original replacement failure remains authoritative
    }
    throw error
  }
}

function decodePrivateJson(value: Uint8Array, label: string): unknown
{
  try
  {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value))
  }
  catch
  {
    throw new DurableArtifactStoreError(
      'path-unsafe',
      `${label} is not valid UTF-8 JSON`
    )
  }
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[]
): boolean
{
  const keys = Object.keys(record).sort()
  const expected = [...expectedKeys].sort()
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  )
}

function parseStoreManifest(bytes: Uint8Array): DurableStoreManifest
{
  const value = decodePrivateJson(bytes, 'durable store manifest')
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable store manifest has an invalid shape'
    )
  const record = value as Record<string, unknown>
  if (
    !hasExactKeys(record, [
      'schemaVersion',
      'format',
      'storeId',
      'maxBytes',
      'maxEntryBytes',
      'maxEntries',
      'rootDevice',
      'rootInode',
    ]) ||
    record.schemaVersion !== 1 ||
    record.format !== 'durable-artifact-store-v1' ||
    typeof record.storeId !== 'string' ||
    !/^store-[a-f0-9]{32}$/.test(record.storeId) ||
    !Number.isSafeInteger(record.maxBytes) ||
    (record.maxBytes as number) < 1 ||
    !Number.isSafeInteger(record.maxEntryBytes) ||
    (record.maxEntryBytes as number) < 1 ||
    !Number.isSafeInteger(record.maxEntries) ||
    (record.maxEntries as number) < 1 ||
    !Number.isSafeInteger(record.rootDevice) ||
    (record.rootDevice as number) < 0 ||
    !Number.isSafeInteger(record.rootInode) ||
    (record.rootInode as number) < 0
  )
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable store manifest fields are invalid'
    )
  return record as unknown as DurableStoreManifest
}

function parseStoreOwner(bytes: Uint8Array): DurableStoreOwner
{
  const value = decodePrivateJson(bytes, 'durable store owner')
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable store owner has an invalid shape'
    )
  const record = value as Record<string, unknown>
  if (
    !hasExactKeys(record, [
      'schemaVersion',
      'storeId',
      'generation',
      'previousOwnershipSha256',
      'ownerTokenSha256',
    ]) ||
    record.schemaVersion !== 1 ||
    typeof record.storeId !== 'string' ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 0 ||
    (record.previousOwnershipSha256 !== null &&
      (typeof record.previousOwnershipSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.previousOwnershipSha256))) ||
    ((record.generation as number) === 0) !==
      (record.previousOwnershipSha256 === null) ||
    typeof record.ownerTokenSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.ownerTokenSha256)
  )
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable store owner fields are invalid'
    )
  return record as unknown as DurableStoreOwner
}

function parseQuotaState(bytes: Uint8Array): DurableQuotaState
{
  const value = decodePrivateJson(bytes, 'durable quota state')
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable quota state has an invalid shape'
    )
  const record = value as Record<string, unknown>
  if (
    !hasExactKeys(record, [
      'schemaVersion',
      'generation',
      'maxBytes',
      'reservations',
      'outcomes',
    ]) ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 0 ||
    !Number.isSafeInteger(record.maxBytes) ||
    (record.maxBytes as number) < 1 ||
    !Array.isArray(record.reservations) ||
    !Array.isArray(record.outcomes)
  )
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable quota state fields are invalid'
    )
  const reservations: QuotaReservation[] = []
  for (const entry of record.reservations)
  {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      !hasExactKeys(entry as Record<string, unknown>, ['key', 'bytes']) ||
      typeof (entry as Record<string, unknown>).key !== 'string' ||
      !Number.isSafeInteger((entry as Record<string, unknown>).bytes) ||
      ((entry as Record<string, unknown>).bytes as number) < 0
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable quota reservation is invalid'
      )
    reservations.push(entry as QuotaReservation)
  }
  const outcomes: Array<QuotaOutcome & { readonly key: string }> = []
  for (const entry of record.outcomes)
  {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      !hasExactKeys(entry as Record<string, unknown>, [
        'key',
        'kind',
        'reservedBytes',
        'actualBytes',
      ]) ||
      typeof (entry as Record<string, unknown>).key !== 'string' ||
      !['released', 'settled'].includes(
        String((entry as Record<string, unknown>).kind)
      ) ||
      !Number.isSafeInteger((entry as Record<string, unknown>).reservedBytes) ||
      ((entry as Record<string, unknown>).reservedBytes as number) < 0 ||
      !Number.isSafeInteger((entry as Record<string, unknown>).actualBytes) ||
      ((entry as Record<string, unknown>).actualBytes as number) < 0
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable quota outcome is invalid'
      )
    outcomes.push(entry as QuotaOutcome & { readonly key: string })
  }
  return {
    schemaVersion: 1,
    generation: record.generation as number,
    maxBytes: record.maxBytes as number,
    reservations,
    outcomes,
  }
}

function positiveSafeInteger(value: number, label: string): number
{
  if (!Number.isSafeInteger(value) || value < 1)
  {
    throw new DurableArtifactStoreError(
      'invalid-quota',
      `${label} must be a positive safe integer`
    )
  }
  return value
}

function nonnegativeSafeInteger(value: number, label: string): number
{
  if (!Number.isSafeInteger(value) || value < 0)
  {
    throw new DurableArtifactStoreError(
      'invalid-quota',
      `${label} must be a nonnegative safe integer`
    )
  }
  return value
}

function isMissing(error: unknown): boolean
{
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function isExists(error: unknown): boolean
{
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  )
}

function validateLogicalKey(value: string, allowEmpty = false): string
{
  if (allowEmpty && value === '') return value
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes('\0') ||
    value.includes('\\') ||
    Buffer.byteLength(value, 'utf8') > MAX_LOGICAL_KEY_BYTES
  )
  {
    throw new DurableArtifactStoreError(
      'invalid-logical-key',
      'artifact key must be one bounded relative POSIX key'
    )
  }
  const segments = value.split('/')
  if (
    segments.length > MAX_LOGICAL_KEY_SEGMENTS ||
    segments.some((segment) => !LOGICAL_KEY_SEGMENT.test(segment))
  )
  {
    throw new DurableArtifactStoreError(
      'invalid-logical-key',
      'artifact key contains an invalid logical segment'
    )
  }
  return segments.join('/')
}

function logicalParent(key: string): string
{
  const boundary = key.lastIndexOf('/')
  return boundary === -1 ? '' : key.slice(0, boundary)
}

function rootIdentity(path: string): RootIdentity
{
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory())
  {
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable artifact root must be a real directory'
    )
  }
  const processUid = process.getuid?.()
  if (processUid !== undefined && info.uid !== processUid)
  {
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable artifact root must be owned by the current user'
    )
  }
  if ((info.mode & 0o077) !== 0)
  {
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'durable artifact root must not grant group or other access'
    )
  }
  return { device: info.dev, inode: info.ino, uid: info.uid }
}

export class DurableArtifactStore
{
  readonly storeId: string
  readonly #mode: DurableArtifactStoreMode
  readonly #root: string
  readonly #rootIdentity: RootIdentity
  readonly #maxBytes: number
  readonly #maxEntryBytes: number
  readonly #maxEntries: number
  readonly #faultHook: DurableArtifactFaultHook | null
  readonly #reservations = new Map<string, QuotaReservation>()
  readonly #quotaOutcomes = new Map<string, QuotaOutcome>()
  readonly #issuedTemps = new Map<string, IssuedTemp>()
  readonly #manifestSha256: string
  #ownershipSha256: string
  #ownershipGeneration: number
  #previousOwnershipSha256: string | null
  #quotaPointerSha256: string
  #quotaGeneration: number
  #faultSequence = 0
  #capabilityProved = false

  constructor(rawRoot: string, options: DurableArtifactStoreOptions = {})
  {
    if (typeof rawRoot !== 'string' || rawRoot.length === 0)
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable artifact root must be a nonempty host path'
      )
    }
    const mode = options.mode ?? 'create-writer'
    if (mode !== 'create-writer' && mode !== 'read-only' && mode !== 'recovery')
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable artifact store mode is invalid'
      )
    if (
      mode === 'create-writer' &&
      (options.expectedStoreId !== undefined ||
        options.expectedOwnershipSha256 !== undefined)
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'new writer mode cannot accept reopening identities'
      )
    this.#mode = mode
    this.#faultHook = options.faultHook ?? null
    const configuredRoot = resolve(rawRoot)
    if (this.#mode === 'create-writer')
    {
      if (existsSync(configuredRoot))
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'new durable writer root must not already exist'
        )
      const parent = dirname(configuredRoot)
      const parentInfo = lstatSync(parent)
      if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory())
      {
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable artifact root parent must be a real directory'
        )
      }
      mkdirSync(configuredRoot, { mode: 0o700 })
      syncPrivateDirectory(parent)
    }
    else if (!existsSync(configuredRoot))
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable store reopening requires an existing root'
      )
    this.#root = realpathSync(configuredRoot)
    this.#rootIdentity = rootIdentity(this.#root)
    if (this.#mode === 'create-writer')
    {
      this.#maxBytes = positiveSafeInteger(
        options.maxBytes ?? DEFAULT_MAX_BYTES,
        'durable artifact maxBytes'
      )
      this.#maxEntryBytes = positiveSafeInteger(
        options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
        'durable artifact maxEntryBytes'
      )
      this.#maxEntries = positiveSafeInteger(
        options.maxEntries ?? DEFAULT_MAX_ENTRIES,
        'durable artifact maxEntries'
      )
      this.storeId = `store-${randomBytes(16).toString('hex')}`
      const manifest: DurableStoreManifest = {
        schemaVersion: 1,
        format: 'durable-artifact-store-v1',
        storeId: this.storeId,
        maxBytes: this.#maxBytes,
        maxEntryBytes: this.#maxEntryBytes,
        maxEntries: this.#maxEntries,
        rootDevice: this.#rootIdentity.device,
        rootInode: this.#rootIdentity.inode,
      }
      this.#manifestSha256 = installPrivateImmutable(
        this.#root,
        STORE_MANIFEST_NAME,
        privateJsonBytes(manifest)
      )
      const owner: DurableStoreOwner = {
        schemaVersion: 1,
        storeId: this.storeId,
        generation: 0,
        previousOwnershipSha256: null,
        ownerTokenSha256:
          options.ownershipAuthority?.ownerTokenSha256({
            storeId: this.storeId,
            generation: 0,
            previousOwnershipSha256: null,
          }) ?? sha256(randomBytes(32)),
      }
      this.#ownershipSha256 = installPrivateImmutable(
        this.#root,
        STORE_OWNER_NAME,
        privateJsonBytes(owner)
      )
      this.#ownershipGeneration = owner.generation
      this.#previousOwnershipSha256 = owner.previousOwnershipSha256
      const quota: DurableQuotaState = {
        schemaVersion: 1,
        generation: 0,
        maxBytes: this.#maxBytes,
        reservations: [],
        outcomes: [],
      }
      this.#quotaPointerSha256 = installPrivateImmutable(
        this.#root,
        STORE_QUOTA_NAME,
        privateJsonBytes(quota)
      )
      this.#quotaGeneration = 0
    }
    else
    {
      const manifestBytes = readPrivateBytes(this.#root, STORE_MANIFEST_NAME)
      const manifest = parseStoreManifest(manifestBytes)
      this.#manifestSha256 = sha256(manifestBytes)
      if (
        manifest.rootDevice !== this.#rootIdentity.device ||
        manifest.rootInode !== this.#rootIdentity.inode
      )
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable store root identity differs from its pinned manifest'
        )
      if (
        options.expectedStoreId !== undefined &&
        options.expectedStoreId !== manifest.storeId
      )
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable store ID differs from the expected recovery identity'
        )
      for (const [configured, pinned, label] of [
        [options.maxBytes, manifest.maxBytes, 'maxBytes'],
        [options.maxEntryBytes, manifest.maxEntryBytes, 'maxEntryBytes'],
        [options.maxEntries, manifest.maxEntries, 'maxEntries'],
      ] as const)
        if (configured !== undefined && configured !== pinned)
          throw new DurableArtifactStoreError(
            'invalid-quota',
            `reopened durable store ${label} differs from its manifest`
          )
      this.storeId = manifest.storeId
      this.#maxBytes = manifest.maxBytes
      this.#maxEntryBytes = manifest.maxEntryBytes
      this.#maxEntries = manifest.maxEntries
      const ownerBytes = readPrivateBytes(this.#root, STORE_OWNER_NAME)
      const owner = parseStoreOwner(ownerBytes)
      if (owner.storeId !== this.storeId)
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable owner marker names a different store'
        )
      const observedOwnershipSha256 = sha256(ownerBytes)
      if (
        options.ownershipAuthority !== undefined &&
        options.ownershipAuthority.ownerTokenSha256({
          storeId: owner.storeId,
          generation: owner.generation,
          previousOwnershipSha256: owner.previousOwnershipSha256,
        }) !== owner.ownerTokenSha256
      )
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable owner authentication failed'
        )
      if (
        this.#mode === 'read-only' &&
        options.expectedOwnershipSha256 !== undefined &&
        options.expectedOwnershipSha256 !== observedOwnershipSha256
      )
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable owner differs from the expected read identity'
        )
      if (this.#mode === 'recovery')
      {
        if (
          options.expectedStoreId === undefined ||
          options.expectedOwnershipSha256 === undefined ||
          options.expectedOwnershipSha256 !== observedOwnershipSha256
        )
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'exclusive recovery requires exact prior store and owner identities'
          )
        const successor: DurableStoreOwner = {
          schemaVersion: 1,
          storeId: this.storeId,
          generation: owner.generation + 1,
          previousOwnershipSha256: observedOwnershipSha256,
          ownerTokenSha256:
            options.ownershipAuthority?.ownerTokenSha256({
              storeId: this.storeId,
              generation: owner.generation + 1,
              previousOwnershipSha256: observedOwnershipSha256,
            }) ?? sha256(randomBytes(32)),
        }
        this.#ownershipSha256 = replacePrivatePointer(
          this.#root,
          STORE_OWNER_NAME,
          observedOwnershipSha256,
          privateJsonBytes(successor)
        )
        this.#ownershipGeneration = successor.generation
        this.#previousOwnershipSha256 = successor.previousOwnershipSha256
      }
      else
      {
        this.#ownershipSha256 = observedOwnershipSha256
        this.#ownershipGeneration = owner.generation
        this.#previousOwnershipSha256 = owner.previousOwnershipSha256
      }
      const quotaBytes = readPrivateBytes(this.#root, STORE_QUOTA_NAME)
      const quota = parseQuotaState(quotaBytes)
      if (quota.maxBytes !== this.#maxBytes)
        throw new DurableArtifactStoreError(
          'invalid-quota',
          'durable quota state differs from the pinned store limit'
        )
      this.#quotaPointerSha256 = sha256(quotaBytes)
      this.#quotaGeneration = quota.generation
      this.loadQuotaState(quota)
    }
    if (this.physicalBytes() > this.#maxBytes)
      throw new DurableArtifactStoreError(
        'quota-exceeded',
        'existing durable artifacts exceed the configured quota'
      )
    if (this.#mode === 'read-only') this.#capabilityProved = true
    else if (options.probeCapabilities !== false)
    {
      this.probeCapabilities()
      this.#capabilityProved = true
    }
  }

  capability(): DurableArtifactStoreCapability
  {
    if (!this.#capabilityProved)
    {
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        'durable filesystem capabilities were not probed'
      )
    }
    const writable = this.#mode !== 'read-only'
    return Object.freeze({
      schemaVersion: 1,
      storeId: this.storeId,
      storeMode: this.#mode,
      ownershipSha256: this.#ownershipSha256,
      ownershipGeneration: this.#ownershipGeneration,
      previousOwnershipSha256: this.#previousOwnershipSha256,
      writable,
      logicalKeyVersion: 'durable-logical-key-v1',
      atomicPrimitiveVersion: 'durable-artifact-atomic-v1',
      immutableNoReplace: writable,
      pointerExpectedHashCompareAndSwap: writable,
      fileFsync: writable,
      directoryFsync: writable,
      noFollowOpen: true,
      sameDirectoryHardLink: writable,
      expectedHashEviction: writable,
      exclusivePrivateRoot: writable,
      faultPoints: DURABLE_ARTIFACT_FAULT_POINTS,
      quota: this.quotaSnapshot(),
    })
  }

  quotaSnapshot(): DurableArtifactQuotaSnapshot
  {
    const physicalBytes = this.physicalBytes()
    const reservedBytes = this.reservedBytes()
    return Object.freeze({
      maxBytes: this.#maxBytes,
      settledBytes: physicalBytes,
      reservedBytes,
      availableBytes: Math.max(
        0,
        this.#maxBytes - physicalBytes - reservedBytes
      ),
      reservations: this.#reservations.size,
    })
  }

  createImmutable(
    logicalKeyValue: string,
    value: Uint8Array
  ): DurableArtifactIdentity
  {
    this.assertWritable()
    const key = validateLogicalKey(logicalKeyValue)
    const bytes = this.copyAndBoundBytes(value)
    this.assertPhysicalCapacity(bytes.byteLength)
    const identity = Object.freeze({
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    })
    return this.installPreparedImmutable(key, bytes, identity)
  }

  private installPreparedImmutable(
    key: string,
    bytes: Uint8Array,
    identity: DurableArtifactIdentity
  ): DurableArtifactIdentity
  {
    const finalPath = this.checkedPath(key, true)
    const issued = this.createTemp(key, bytes, identity, 'immutable')
    let installed = false
    try
    {
      this.inject('immutable.beforeInstall', 'createImmutable', key)
      this.assertRootIdentity()
      this.assertSafeFinal(finalPath, true)
      try
      {
        linkSync(issued.path, finalPath)
      }
      catch (error)
      {
        if (isExists(error))
        {
          throw new DurableArtifactStoreError(
            'entry-exists',
            'immutable artifact already exists',
            issued.proof
          )
        }
        throw error
      }
      installed = true
      this.inject('immutable.afterInstall', 'createImmutable', key)
      this.inject('immutable.beforeDirectorySync', 'createImmutable', key)
      this.syncDirectory(dirname(finalPath), key)
      this.inject('immutable.afterDirectorySync', 'createImmutable', key)
      this.cleanupIssuedTemp(issued, 'immutable')
      return identity
    }
    catch (error)
    {
      if (!installed) this.tryCleanupIssuedTemp(issued, 'immutable')
      if (error instanceof DurableArtifactStoreError)
      {
        throw new DurableArtifactStoreError(
          error.code,
          error.message,
          issued.proof,
          installed
        )
      }
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        error instanceof Error ? error.message : 'immutable write failed',
        issued.proof,
        installed
      )
    }
  }

  createOrVerifyImmutable(
    logicalKeyValue: string,
    value: Uint8Array
  ): DurableArtifactIdentity
  {
    this.assertWritable()
    const key = validateLogicalKey(logicalKeyValue)
    const bytes = this.copyAndBoundBytes(value)
    const expected = Object.freeze({
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    })
    try
    {
      const observed = this.readOptionalIdentity(key)
      if (!observed)
        throw new DurableArtifactStoreError(
          'entry-not-found',
          'durable artifact does not exist'
        )
      if (
        observed.byteLength !== expected.byteLength ||
        observed.sha256 !== expected.sha256
      )
        throw new DurableArtifactStoreError(
          'entry-exists',
          'immutable artifact exists with different exact bytes'
        )
      const path = this.checkedPath(key, false)
      this.syncReconciledFinalDirectory(path, key, null)
      return expected
    }
    catch (error)
    {
      if (
        !(error instanceof DurableArtifactStoreError) ||
        error.code !== 'entry-not-found'
      )
        throw error
    }
    try
    {
      this.assertPhysicalCapacity(bytes.byteLength)
      return this.installPreparedImmutable(key, bytes, expected)
    }
    catch (error)
    {
      if (
        !(error instanceof DurableArtifactStoreError) ||
        (error.code !== 'entry-exists' && !error.finalInstalled)
      )
        throw error
      let observed: DurableArtifactIdentity | null
      try
      {
        observed = this.readOptionalIdentity(key)
      }
      catch
      {
        throw error
      }
      if (
        !observed ||
        observed.byteLength !== expected.byteLength ||
        observed.sha256 !== expected.sha256
      )
        throw new DurableArtifactStoreError(
          'entry-exists',
          'immutable artifact exists with different exact bytes',
          error.tempProof,
          error.finalInstalled
        )
      const path = this.checkedPath(key, false)
      this.syncReconciledFinalDirectory(path, key, error.tempProof)
      if (error.tempProof)
        try
        {
          this.cleanupProvenTemp(error.tempProof)
        }
        catch
        {
          // exact final bytes are durable even if temp cleanup needs recovery
        }
      return expected
    }
  }

  compareAndSwapPointer(
    logicalKeyValue: string,
    expectedSha256: string | null,
    value: Uint8Array
  ): DurableArtifactIdentity
  {
    this.assertWritable()
    const key = validateLogicalKey(logicalKeyValue)
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256))
    {
      throw new DurableArtifactStoreError(
        'expected-hash-mismatch',
        'expected pointer hash must be lowercase SHA-256 or null'
      )
    }
    const bytes = this.copyAndBoundBytes(value)
    const identity = Object.freeze({
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    })
    const finalPath = this.checkedPath(key, true)
    this.inject('pointer.beforeExpectedRead', 'compareAndSwapPointer', key)
    const observed = this.readOptionalIdentity(key)
    this.inject('pointer.afterExpectedRead', 'compareAndSwapPointer', key)
    if ((observed?.sha256 ?? null) !== expectedSha256)
    {
      throw new DurableArtifactStoreError(
        'expected-hash-mismatch',
        'pointer bytes do not match the expected SHA-256'
      )
    }
    this.assertPhysicalCapacity(
      Math.max(0, bytes.byteLength - (observed?.byteLength ?? 0))
    )
    const issued = this.createTemp(key, bytes, identity, 'pointer')
    let installed = false
    try
    {
      this.inject('pointer.beforeCompare', 'compareAndSwapPointer', key)
      const compared = this.readOptionalIdentity(key)
      if ((compared?.sha256 ?? null) !== expectedSha256)
      {
        throw new DurableArtifactStoreError(
          'expected-hash-mismatch',
          'pointer changed before atomic installation',
          issued.proof
        )
      }
      this.inject('pointer.afterCompare', 'compareAndSwapPointer', key)
      this.inject('pointer.beforeInstall', 'compareAndSwapPointer', key)
      this.assertRootIdentity()
      this.assertSafeFinal(finalPath, expectedSha256 === null)
      if (expectedSha256 === null)
      {
        try
        {
          linkSync(issued.path, finalPath)
        }
        catch (error)
        {
          if (isExists(error))
          {
            throw new DurableArtifactStoreError(
              'expected-hash-mismatch',
              'pointer appeared before atomic installation',
              issued.proof
            )
          }
          throw error
        }
      }
      else
      {
        renameSync(issued.path, finalPath)
        this.#issuedTemps.delete(issued.proof.tempToken)
      }
      installed = true
      this.inject('pointer.afterInstall', 'compareAndSwapPointer', key)
      this.inject('pointer.beforeDirectorySync', 'compareAndSwapPointer', key)
      this.syncDirectory(dirname(finalPath), key)
      this.inject('pointer.afterDirectorySync', 'compareAndSwapPointer', key)
      if (expectedSha256 === null) this.cleanupIssuedTemp(issued, 'pointer')
      return identity
    }
    catch (error)
    {
      if (!installed) this.tryCleanupIssuedTemp(issued, 'pointer')
      if (error instanceof DurableArtifactStoreError)
      {
        throw new DurableArtifactStoreError(
          error.code,
          error.message,
          issued.proof,
          installed
        )
      }
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        error instanceof Error ? error.message : 'pointer update failed',
        issued.proof,
        installed
      )
    }
  }

  reconcilePointer(
    logicalKeyValue: string,
    expectedOldSha256: string | null,
    proposedValue: Uint8Array
  ): DurablePointerReconciliation
  {
    this.assertWritable()
    const key = validateLogicalKey(logicalKeyValue)
    if (expectedOldSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedOldSha256))
      throw new DurableArtifactStoreError(
        'expected-hash-mismatch',
        'expected old pointer hash must be lowercase SHA-256 or null'
      )
    const proposedBytes = this.copyAndBoundBytes(proposedValue)
    const proposed = Object.freeze({
      sha256: sha256(proposedBytes),
      byteLength: proposedBytes.byteLength,
    })
    const observed = this.readOptionalIdentity(key)
    const observedSha256 = observed?.sha256 ?? null
    if (observedSha256 === proposed.sha256)
    {
      const path = this.checkedPath(key, false)
      this.syncReconciledFinalDirectory(path, key, null)
      return Object.freeze({
        status: 'new',
        observedSha256,
        proposed,
      })
    }
    if (observedSha256 === expectedOldSha256)
      return Object.freeze({
        status: 'old',
        observedSha256,
        proposed,
      })
    return Object.freeze({
      status: 'interference',
      observedSha256,
      proposed,
    })
  }

  readImmutable(logicalKeyValue: string): Uint8Array
  {
    const key = validateLogicalKey(logicalKeyValue)
    return Uint8Array.from(this.readCheckedBytes(key))
  }

  hashImmutable(logicalKeyValue: string): string
  {
    return sha256(this.readCheckedBytes(validateLogicalKey(logicalKeyValue)))
  }

  sizeImmutable(logicalKeyValue: string): number
  {
    return this.readCheckedBytes(validateLogicalKey(logicalKeyValue)).byteLength
  }

  listImmutable(logicalPrefixValue = ''): DurableArtifactEntry[]
  {
    const prefix = validateLogicalKey(logicalPrefixValue, true)
    this.inject('list.beforeWalk', 'listImmutable', prefix || null)
    const entries = this.scanEntries(prefix)
    this.inject('list.afterWalk', 'listImmutable', prefix || null)
    return entries
  }

  // metadata-only enumeration lets a bounded catalogue select public entries
  // before reading or hashing any artifact payload
  listImmutableMetadata(
    logicalPrefixValue = '',
    maximumEntries = this.#maxEntries
  ): DurableArtifactMetadataEntry[]
  {
    const prefix = validateLogicalKey(logicalPrefixValue, true)
    if (
      !Number.isSafeInteger(maximumEntries) ||
      maximumEntries < 1 ||
      maximumEntries > this.#maxEntries
    )
      throw new DurableArtifactStoreError(
        'too-many-entries',
        'artifact metadata enumeration limit is invalid'
      )
    this.inject('list.beforeWalk', 'listImmutableMetadata', prefix || null)
    const entries = this.scanMetadataEntries(prefix, maximumEntries)
    this.inject('list.afterWalk', 'listImmutableMetadata', prefix || null)
    return entries
  }

  removeEvictable(logicalKeyValue: string, expectedSha256: string): boolean
  {
    this.assertWritable()
    const key = validateLogicalKey(logicalKeyValue)
    if (!/^[a-f0-9]{64}$/.test(expectedSha256))
    {
      throw new DurableArtifactStoreError(
        'expected-hash-mismatch',
        'expected evictable hash must be lowercase SHA-256'
      )
    }
    const segments = key.split('/')
    const evictableParent = segments.at(-2)
    if (
      segments.length < 2 ||
      (evictableParent !== 'preview-cache' && evictableParent !== 'temp')
    )
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'only direct preview-cache or temp artifacts are evictable'
      )
    }
    const path = this.checkedPath(key, false)
    this.inject('evict.beforeVerify', 'removeEvictable', key)
    let bytes: Buffer
    try
    {
      bytes = this.readCheckedBytes(key)
    }
    catch (error)
    {
      if (
        error instanceof DurableArtifactStoreError &&
        error.code === 'entry-not-found'
      )
      {
        this.syncDirectory(dirname(path), key)
        return false
      }
      throw error
    }
    const info = lstatSync(path)
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.dev !== this.#rootIdentity.device ||
      info.uid !== this.#rootIdentity.uid
    )
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'evictable artifact is not an owned same-device regular file'
      )
    }
    if (sha256(bytes) !== expectedSha256)
    {
      throw new DurableArtifactStoreError(
        'expected-hash-mismatch',
        'evictable artifact bytes do not match the expected SHA-256'
      )
    }
    this.inject('evict.afterVerify', 'removeEvictable', key)
    this.inject('evict.beforeUnlink', 'removeEvictable', key)
    unlinkSync(path)
    this.inject('evict.afterUnlink', 'removeEvictable', key)
    this.inject('evict.beforeDirectorySync', 'removeEvictable', key)
    this.syncDirectory(dirname(path), key)
    this.inject('evict.afterDirectorySync', 'removeEvictable', key)
    return true
  }

  reserveQuota(reservationKeyValue: string, bytesValue: number): void
  {
    this.assertWritable()
    const reservationKey = validateLogicalKey(reservationKeyValue)
    const bytes = nonnegativeSafeInteger(bytesValue, 'quota reservation bytes')
    this.inject('quota.beforeReserve', 'reserveQuota', reservationKey)
    const existing = this.#reservations.get(reservationKey)
    if (existing)
    {
      if (existing.bytes !== bytes)
      {
        throw new DurableArtifactStoreError(
          'reservation-conflict',
          'quota reservation key is already bound to a different byte count'
        )
      }
      this.inject('quota.afterReserve', 'reserveQuota', reservationKey)
      return
    }
    const completed = this.#quotaOutcomes.get(reservationKey)
    if (completed)
    {
      if (completed.reservedBytes !== bytes)
      {
        throw new DurableArtifactStoreError(
          'reservation-conflict',
          'completed quota reservation has a different byte count'
        )
      }
      this.inject('quota.afterReserve', 'reserveQuota', reservationKey)
      return
    }
    if (this.physicalBytes() + this.reservedBytes() + bytes > this.#maxBytes)
    {
      throw new DurableArtifactStoreError(
        'quota-exceeded',
        'durable artifact quota reservation exceeds available capacity'
      )
    }
    const reservations = new Map(this.#reservations)
    reservations.set(reservationKey, { key: reservationKey, bytes })
    this.persistQuotaState(reservations, this.#quotaOutcomes)
    this.inject('quota.afterReserve', 'reserveQuota', reservationKey)
  }

  releaseQuota(reservationKeyValue: string): void
  {
    this.assertWritable()
    const reservationKey = validateLogicalKey(reservationKeyValue)
    this.inject('quota.beforeRelease', 'releaseQuota', reservationKey)
    const completed = this.#quotaOutcomes.get(reservationKey)
    if (completed)
    {
      if (completed.kind !== 'released')
      {
        throw new DurableArtifactStoreError(
          'reservation-conflict',
          'quota reservation was already settled'
        )
      }
      this.inject('quota.afterRelease', 'releaseQuota', reservationKey)
      return
    }
    const reservation = this.#reservations.get(reservationKey)
    if (!reservation)
    {
      throw new DurableArtifactStoreError(
        'reservation-not-found',
        'quota reservation does not exist'
      )
    }
    const reservations = new Map(this.#reservations)
    const outcomes = new Map(this.#quotaOutcomes)
    reservations.delete(reservationKey)
    outcomes.set(reservationKey, {
      kind: 'released',
      reservedBytes: reservation.bytes,
      actualBytes: 0,
    })
    this.persistQuotaState(reservations, outcomes)
    this.inject('quota.afterRelease', 'releaseQuota', reservationKey)
  }

  settleQuota(reservationKeyValue: string, actualBytesValue: number): void
  {
    this.assertWritable()
    const reservationKey = validateLogicalKey(reservationKeyValue)
    const actualBytes = nonnegativeSafeInteger(
      actualBytesValue,
      'settled quota bytes'
    )
    this.inject('quota.beforeSettle', 'settleQuota', reservationKey)
    const completed = this.#quotaOutcomes.get(reservationKey)
    if (completed)
    {
      if (
        completed.kind !== 'settled' ||
        completed.actualBytes !== actualBytes
      )
      {
        throw new DurableArtifactStoreError(
          'reservation-conflict',
          'quota reservation already has a different terminal outcome'
        )
      }
      this.inject('quota.afterSettle', 'settleQuota', reservationKey)
      return
    }
    const reservation = this.#reservations.get(reservationKey)
    if (!reservation)
    {
      throw new DurableArtifactStoreError(
        'reservation-not-found',
        'quota reservation does not exist'
      )
    }
    if (actualBytes > reservation.bytes)
    {
      throw new DurableArtifactStoreError(
        'quota-exceeded',
        'settled bytes exceed the reserved byte count'
      )
    }
    const reservations = new Map(this.#reservations)
    const outcomes = new Map(this.#quotaOutcomes)
    reservations.delete(reservationKey)
    outcomes.set(reservationKey, {
      kind: 'settled',
      reservedBytes: reservation.bytes,
      actualBytes,
    })
    this.persistQuotaState(reservations, outcomes)
    this.inject('quota.afterSettle', 'settleQuota', reservationKey)
  }

  quotaOutcome(reservationKeyValue: string): EditArtifactStoreHostQuotaOutcome
  {
    const reservationId = validateLogicalKey(reservationKeyValue)
    const active = this.#reservations.get(reservationId)
    if (active !== undefined)
      return Object.freeze({
        state: 'active',
        reservationId,
        reservedBytes: active.bytes,
      })
    const completed = this.#quotaOutcomes.get(reservationId)
    if (completed === undefined)
      return Object.freeze({ state: 'absent', reservationId })
    return completed.kind === 'released'
      ? Object.freeze({
          state: 'released',
          reservationId,
          reservedBytes: completed.reservedBytes,
          actualBytes: 0 as const,
        })
      : Object.freeze({
          state: 'settled',
          reservationId,
          reservedBytes: completed.reservedBytes,
          actualBytes: completed.actualBytes,
        })
  }

  activeQuotaReservations(): readonly EditArtifactStoreHostQuotaReservation[]
  {
    return Object.freeze(
      [...this.#reservations.values()]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((reservation) =>
          Object.freeze({
            reservationId: reservation.key,
            reservedBytes: reservation.bytes,
          })
        )
    )
  }

  cleanupProvenTemp(proof: DurableArtifactTempProof): boolean
  {
    this.assertWritable()
    this.inject('cleanup.beforeVerify', 'cleanupProvenTemp', null)
    if (
      proof.schemaVersion !== 1 ||
      proof.storeId !== this.storeId ||
      !TEMP_NAME.test(proof.tempToken) ||
      validateLogicalKey(proof.logicalParent, true) !== proof.logicalParent ||
      !/^[a-f0-9]{64}$/.test(proof.sha256) ||
      !Number.isSafeInteger(proof.byteLength) ||
      proof.byteLength < 0
    )
    {
      throw new DurableArtifactStoreError(
        'temp-proof-invalid',
        'temporary artifact proof is not valid for this store'
      )
    }
    const parentPath =
      proof.logicalParent === ''
        ? this.#root
        : dirname(this.checkedPath(`${proof.logicalParent}/proof`, false))
    const tempPath = join(parentPath, proof.tempToken)
    const issued = this.#issuedTemps.get(proof.tempToken)
    if (
      issued &&
      (issued.path !== tempPath ||
        issued.proof.logicalParent !== proof.logicalParent ||
        issued.proof.sha256 !== proof.sha256 ||
        issued.proof.byteLength !== proof.byteLength)
    )
    {
      throw new DurableArtifactStoreError(
        'temp-proof-invalid',
        'live temporary artifact proof conflicts with its issued identity'
      )
    }
    this.inject('cleanup.afterVerify', 'cleanupProvenTemp', null)
    this.inject('cleanup.beforeUnlink', 'cleanupProvenTemp', null)
    try
    {
      const info = lstatSync(tempPath)
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.dev !== this.#rootIdentity.device ||
        info.uid !== this.#rootIdentity.uid
      )
      {
        throw new DurableArtifactStoreError(
          'temp-proof-invalid',
          'proven temporary artifact is no longer a real file'
        )
      }
      const descriptor = openSync(
        tempPath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      )
      let actual: Buffer
      try
      {
        const opened = fstatSync(descriptor)
        if (opened.dev !== info.dev || opened.ino !== info.ino)
        {
          throw new DurableArtifactStoreError(
            'temp-proof-invalid',
            'proven temporary artifact identity changed before cleanup'
          )
        }
        actual = readFileSync(descriptor)
      }
      finally
      {
        closeSync(descriptor)
      }
      if (
        actual.byteLength !== proof.byteLength ||
        sha256(actual) !== proof.sha256
      )
      {
        throw new DurableArtifactStoreError(
          'temp-proof-invalid',
          'proven temporary artifact no longer matches its identity'
        )
      }
      unlinkSync(tempPath)
    }
    catch (error)
    {
      if (!isMissing(error)) throw error
      this.#issuedTemps.delete(proof.tempToken)
      return false
    }
    this.#issuedTemps.delete(proof.tempToken)
    this.inject('cleanup.afterUnlink', 'cleanupProvenTemp', null)
    this.inject(
      'cleanup.beforeDirectorySync',
      'cleanupProvenTemp',
      proof.logicalParent || null
    )
    this.syncDirectory(parentPath, proof.logicalParent || null)
    this.inject(
      'cleanup.afterDirectorySync',
      'cleanupProvenTemp',
      proof.logicalParent || null
    )
    return true
  }

  private copyAndBoundBytes(value: Uint8Array): Uint8Array
  {
    if (!(value instanceof Uint8Array))
    {
      throw new TypeError('durable artifact bytes must be a Uint8Array')
    }
    if (value.byteLength > this.#maxEntryBytes)
    {
      throw new DurableArtifactStoreError(
        'quota-exceeded',
        'durable artifact exceeds the per-entry byte limit'
      )
    }
    return Uint8Array.from(value)
  }

  private syncReconciledFinalDirectory(
    path: string,
    key: string,
    tempProof: DurableArtifactTempProof | null
  ): void
  {
    try
    {
      this.syncDirectory(dirname(path), key)
    }
    catch (error)
    {
      if (error instanceof DurableArtifactStoreError)
        throw new DurableArtifactStoreError(
          error.code,
          error.message,
          tempProof,
          true
        )
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        error instanceof Error
          ? error.message
          : 'reconciled final directory sync failed',
        tempProof,
        true
      )
    }
  }

  private assertWritable(): void
  {
    if (this.#mode === 'read-only')
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        'read-only durable store cannot perform mutations'
      )
    this.assertRootIdentity()
  }

  private assertPhysicalCapacity(additionalBytes: number): void
  {
    if (this.physicalBytes() + additionalBytes > this.#maxBytes)
      throw new DurableArtifactStoreError(
        'quota-exceeded',
        'physical durable artifact bytes exceed the configured quota'
      )
  }

  private physicalBytes(): number
  {
    this.assertRootIdentity()
    const pending: Array<{ path: string; key: string }> = [
      { path: this.#root, key: '' },
    ]
    const seenInodes = new Set<string>()
    let logicalEntries = 0
    let total = 0
    while (pending.length > 0)
    {
      const current = pending.pop()
      if (!current) break
      const children = readdirSync(current.path, { withFileTypes: true })
      for (const child of children)
      {
        if (current.key === '' && PRIVATE_METADATA_NAMES.has(child.name))
          continue
        const path = join(current.path, child.name)
        const info = lstatSync(path)
        if (info.isSymbolicLink() || info.dev !== this.#rootIdentity.device)
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'physical quota scan found an unsafe entry'
          )
        if (TEMP_NAME.test(child.name))
        {
          if (!info.isFile())
            throw new DurableArtifactStoreError(
              'path-unsafe',
              'physical quota scan found an invalid temporary entry'
            )
          const inode = `${info.dev}:${info.ino}`
          if (!seenInodes.has(inode))
          {
            seenInodes.add(inode)
            total += info.size
            if (!Number.isSafeInteger(total))
              throw new DurableArtifactStoreError(
                'quota-exceeded',
                'physical durable artifact bytes exceed safe integer accounting'
              )
          }
          continue
        }
        if (!LOGICAL_KEY_SEGMENT.test(child.name))
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'physical quota scan found a non-logical entry'
          )
        const key = current.key ? `${current.key}/${child.name}` : child.name
        if (info.isDirectory())
        {
          this.assertDirectoryIdentity(path, info)
          pending.push({ path, key })
          continue
        }
        if (!info.isFile() || info.size > this.#maxEntryBytes)
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'physical quota scan found an invalid artifact file'
          )
        logicalEntries += 1
        if (logicalEntries > this.#maxEntries)
          throw new DurableArtifactStoreError(
            'too-many-entries',
            'physical quota scan exceeds its logical entry limit'
          )
        const inode = `${info.dev}:${info.ino}`
        if (!seenInodes.has(inode))
        {
          seenInodes.add(inode)
          total += info.size
        }
        if (!Number.isSafeInteger(total))
          throw new DurableArtifactStoreError(
            'quota-exceeded',
            'physical durable artifact bytes exceed safe integer accounting'
          )
      }
    }
    return total
  }

  private loadQuotaState(state: DurableQuotaState): void
  {
    if (state.reservations.length + state.outcomes.length > this.#maxEntries)
      throw new DurableArtifactStoreError(
        'too-many-entries',
        'durable quota catalogue exceeds its entry limit'
      )
    this.#reservations.clear()
    this.#quotaOutcomes.clear()
    for (const reservation of state.reservations)
    {
      const key = validateLogicalKey(reservation.key)
      if (this.#reservations.has(key) || this.#quotaOutcomes.has(key))
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable quota catalogue contains a duplicate key'
        )
      this.#reservations.set(key, { key, bytes: reservation.bytes })
    }
    for (const outcome of state.outcomes)
    {
      const key = validateLogicalKey(outcome.key)
      if (
        this.#reservations.has(key) ||
        this.#quotaOutcomes.has(key) ||
        outcome.actualBytes > outcome.reservedBytes
      )
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable quota catalogue contains an invalid outcome'
        )
      this.#quotaOutcomes.set(key, {
        kind: outcome.kind,
        reservedBytes: outcome.reservedBytes,
        actualBytes: outcome.actualBytes,
      })
    }
  }

  private persistQuotaState(
    reservations: ReadonlyMap<string, QuotaReservation>,
    outcomes: ReadonlyMap<string, QuotaOutcome>
  ): void
  {
    const state: DurableQuotaState = {
      schemaVersion: 1,
      generation: this.#quotaGeneration + 1,
      maxBytes: this.#maxBytes,
      reservations: [...reservations.values()].sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0
      ),
      outcomes: [...outcomes.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, outcome]) => ({ key, ...outcome })),
    }
    if (state.reservations.length + state.outcomes.length > this.#maxEntries)
      throw new DurableArtifactStoreError(
        'too-many-entries',
        'durable quota catalogue exceeds its entry limit'
      )
    const bytes = privateJsonBytes(state)
    const proposedSha256 = sha256(bytes)
    this.inject('quota.beforePersist', 'persistQuotaState', null)
    try
    {
      this.#quotaPointerSha256 = replacePrivatePointer(
        this.#root,
        STORE_QUOTA_NAME,
        this.#quotaPointerSha256,
        bytes
      )
    }
    catch (error)
    {
      const observedBytes = readPrivateBytes(this.#root, STORE_QUOTA_NAME)
      if (sha256(observedBytes) !== proposedSha256) throw error
      this.#quotaPointerSha256 = proposedSha256
    }
    this.assertRootIdentity()
    this.#quotaGeneration = state.generation
    this.loadQuotaState(state)
    this.inject('quota.afterPersist', 'persistQuotaState', null)
  }

  private reservedBytes(): number
  {
    let total = 0
    for (const reservation of this.#reservations.values())
      total += reservation.bytes
    return total
  }

  private createTemp(
    key: string,
    bytes: Uint8Array,
    identity: DurableArtifactIdentity,
    kind: 'immutable' | 'pointer'
  ): IssuedTemp
  {
    const parent = dirname(this.checkedPath(key, true))
    const tempToken = `.durable-tmp-${randomBytes(16).toString('hex')}`
    const path = join(parent, tempToken)
    const parentKey = logicalParent(key)
    const proof = Object.freeze({
      schemaVersion: 1 as const,
      storeId: this.storeId,
      logicalParent: parentKey,
      tempToken,
      ...identity,
    })
    const issued = { proof, path }
    const operation = kind === 'immutable' ? 'createImmutable' : 'pointer'
    const beforeOpen = `${kind}.beforeTempOpen` as DurableArtifactFaultPoint
    const afterOpen = `${kind}.afterTempOpen` as DurableArtifactFaultPoint
    const beforeWrite = `${kind}.beforeWrite` as DurableArtifactFaultPoint
    const afterWrite = `${kind}.afterWrite` as DurableArtifactFaultPoint
    const beforeSync = `${kind}.beforeFileSync` as DurableArtifactFaultPoint
    const afterSync = `${kind}.afterFileSync` as DurableArtifactFaultPoint
    this.inject(beforeOpen, operation, key)
    let descriptor: number | null = null
    try
    {
      descriptor = openSync(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      this.#issuedTemps.set(tempToken, issued)
      this.inject(afterOpen, operation, key)
      this.inject(beforeWrite, operation, key)
      writeFileSync(descriptor, bytes)
      this.inject(afterWrite, operation, key)
      this.inject(beforeSync, operation, key)
      fsyncSync(descriptor)
      this.inject(afterSync, operation, key)
      return issued
    }
    catch (error)
    {
      if (this.#issuedTemps.has(tempToken))
        this.tryCleanupIssuedTemp(issued, kind)
      const retainedProof = this.#issuedTemps.has(tempToken) ? proof : null
      if (error instanceof DurableArtifactStoreError)
      {
        throw new DurableArtifactStoreError(
          error.code,
          error.message,
          retainedProof
        )
      }
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        error instanceof Error ? error.message : 'temporary write failed',
        retainedProof
      )
    }
    finally
    {
      if (descriptor !== null) closeSync(descriptor)
    }
  }

  private cleanupIssuedTemp(
    issued: IssuedTemp,
    kind: 'immutable' | 'pointer'
  ): void
  {
    const operation = kind === 'immutable' ? 'createImmutable' : 'pointer'
    const key = issued.proof.logicalParent || null
    if (kind === 'immutable')
      this.inject('immutable.beforeTempCleanup', operation, key)
    else this.inject('pointer.beforeTempCleanup', operation, key)
    try
    {
      unlinkSync(issued.path)
    }
    catch (error)
    {
      if (!isMissing(error)) throw error
    }
    this.#issuedTemps.delete(issued.proof.tempToken)
    if (kind === 'immutable')
      this.inject('immutable.afterTempCleanup', operation, key)
    else this.inject('pointer.afterTempCleanup', operation, key)
    if (kind === 'immutable')
      this.inject('immutable.beforeCleanupDirectorySync', operation, key)
    else this.inject('pointer.beforeCleanupDirectorySync', operation, key)
    this.syncDirectory(dirname(issued.path), key)
    if (kind === 'immutable')
      this.inject('immutable.afterCleanupDirectorySync', operation, key)
    else this.inject('pointer.afterCleanupDirectorySync', operation, key)
  }

  private tryCleanupIssuedTemp(
    issued: IssuedTemp,
    kind: 'immutable' | 'pointer'
  ): void
  {
    try
    {
      this.cleanupIssuedTemp(issued, kind)
    }
    catch
    {
      // the retained proof is the only authority for later cleanup
    }
  }

  private readOptionalIdentity(key: string): DurableArtifactIdentity | null
  {
    try
    {
      const bytes = this.readCheckedBytes(key)
      return Object.freeze({
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      })
    }
    catch (error)
    {
      if (
        error instanceof DurableArtifactStoreError &&
        error.code === 'entry-not-found'
      )
        return null
      throw error
    }
  }

  private readCheckedBytes(key: string): Buffer
  {
    let path: string
    try
    {
      path = this.checkedPath(key, false)
    }
    catch (error)
    {
      if (isMissing(error))
      {
        throw new DurableArtifactStoreError(
          'entry-not-found',
          'durable artifact does not exist'
        )
      }
      throw error
    }
    this.inject('read.beforeOpen', 'readImmutable', key)
    let descriptor: number
    try
    {
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    }
    catch (error)
    {
      if (isMissing(error))
      {
        throw new DurableArtifactStoreError(
          'entry-not-found',
          'durable artifact does not exist'
        )
      }
      throw error
    }
    try
    {
      this.inject('read.afterOpen', 'readImmutable', key)
      const before = fstatSync(descriptor)
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.dev !== this.#rootIdentity.device ||
        before.size > this.#maxEntryBytes
      )
      {
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable artifact is not one bounded same-device regular file'
        )
      }
      this.inject('read.beforeRead', 'readImmutable', key)
      const bytes = readFileSync(descriptor)
      this.inject('read.afterRead', 'readImmutable', key)
      const after = fstatSync(descriptor)
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        bytes.byteLength !== after.size
      )
      {
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable artifact identity changed while it was read'
        )
      }
      this.assertRootIdentity()
      this.inject('read.afterIdentityCheck', 'readImmutable', key)
      return bytes
    }
    finally
    {
      closeSync(descriptor)
    }
  }

  private scanEntries(prefix: string): DurableArtifactEntry[]
  {
    this.assertRootIdentity()
    let start: string
    try
    {
      start = prefix === '' ? this.#root : this.checkedPath(prefix, false)
    }
    catch (error)
    {
      if (isMissing(error)) return []
      throw error
    }
    let startInfo
    try
    {
      startInfo = lstatSync(start)
    }
    catch (error)
    {
      if (isMissing(error)) return []
      throw error
    }
    if (startInfo.isSymbolicLink())
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'artifact enumeration cannot traverse a symbolic link'
      )
    }
    if (startInfo.isFile())
    {
      const bytes = this.readCheckedBytes(prefix)
      return [
        Object.freeze({
          key: prefix,
          sha256: sha256(bytes),
          byteLength: bytes.byteLength,
        }),
      ]
    }
    if (!startInfo.isDirectory())
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'artifact enumeration prefix is not a file or directory'
      )
    }
    const pending: Array<{ path: string; key: string }> = [
      { path: start, key: prefix },
    ]
    const entries: DurableArtifactEntry[] = []
    while (pending.length > 0)
    {
      const current = pending.pop()
      if (!current) break
      const children = readdirSync(current.path, { withFileTypes: true }).sort(
        (left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      )
      for (let index = children.length - 1; index >= 0; index -= 1)
      {
        const child = children[index]
        if (!child) continue
        if (TEMP_NAME.test(child.name)) continue
        if (current.key === '' && PRIVATE_METADATA_NAMES.has(child.name))
          continue
        if (!LOGICAL_KEY_SEGMENT.test(child.name))
        {
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'artifact store contains a non-logical entry'
          )
        }
        const key = current.key ? `${current.key}/${child.name}` : child.name
        const path = join(current.path, child.name)
        const info = lstatSync(path)
        if (info.isSymbolicLink() || info.dev !== this.#rootIdentity.device)
        {
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'artifact store enumeration found an unsafe entry'
          )
        }
        if (info.isDirectory())
        {
          pending.push({ path, key })
          continue
        }
        if (!info.isFile())
        {
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'artifact store enumeration found a non-file entry'
          )
        }
        if (entries.length >= this.#maxEntries)
        {
          throw new DurableArtifactStoreError(
            'too-many-entries',
            'artifact enumeration exceeds its entry limit'
          )
        }
        const bytes = this.readCheckedBytes(key)
        entries.push(
          Object.freeze({
            key,
            sha256: sha256(bytes),
            byteLength: bytes.byteLength,
          })
        )
      }
    }
    return entries.sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    )
  }

  private scanMetadataEntries(
    prefix: string,
    maximumEntries: number
  ): DurableArtifactMetadataEntry[]
  {
    this.assertRootIdentity()
    let start: string
    try
    {
      start = prefix === '' ? this.#root : this.checkedPath(prefix, false)
    }
    catch (error)
    {
      if (isMissing(error)) return []
      throw error
    }
    let startInfo
    try
    {
      startInfo = lstatSync(start)
    }
    catch (error)
    {
      if (isMissing(error)) return []
      throw error
    }
    if (startInfo.isSymbolicLink())
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'artifact metadata enumeration cannot traverse a symbolic link'
      )
    if (startInfo.isFile()) return [{ key: prefix, byteLength: startInfo.size }]
    if (!startInfo.isDirectory())
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'artifact metadata enumeration prefix is not a file or directory'
      )
    const pending: Array<{ path: string; key: string }> = [
      { path: start, key: prefix },
    ]
    const entries: DurableArtifactMetadataEntry[] = []
    while (pending.length > 0)
    {
      const current = pending.pop()
      if (!current) break
      const children = readdirSync(current.path, { withFileTypes: true }).sort(
        (left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      )
      for (let index = children.length - 1; index >= 0; index -= 1)
      {
        const child = children[index]
        if (!child) continue
        if (TEMP_NAME.test(child.name)) continue
        if (current.key === '' && PRIVATE_METADATA_NAMES.has(child.name))
          continue
        if (!LOGICAL_KEY_SEGMENT.test(child.name))
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'artifact store contains a non-logical entry'
          )
        const key = current.key ? `${current.key}/${child.name}` : child.name
        const path = join(current.path, child.name)
        const info = lstatSync(path)
        if (info.isSymbolicLink() || info.dev !== this.#rootIdentity.device)
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'artifact store metadata enumeration found an unsafe entry'
          )
        if (info.isDirectory())
        {
          pending.push({ path, key })
          continue
        }
        if (!info.isFile())
          throw new DurableArtifactStoreError(
            'path-unsafe',
            'artifact store metadata enumeration found a non-file entry'
          )
        if (entries.length >= maximumEntries)
          throw new DurableArtifactStoreError(
            'too-many-entries',
            'artifact metadata enumeration exceeds its entry limit'
          )
        entries.push(Object.freeze({ key, byteLength: info.size }))
      }
    }
    this.assertRootIdentity()
    return entries.sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    )
  }

  private checkedPath(key: string, createParents: boolean): string
  {
    const normalized = validateLogicalKey(key)
    this.assertRootIdentity()
    const segments = normalized.split('/')
    let parent = this.#root
    for (const segment of segments.slice(0, -1))
    {
      const next = join(parent, segment)
      let info
      try
      {
        info = lstatSync(next)
      }
      catch (error)
      {
        if (!isMissing(error) || !createParents) throw error
        this.inject('directory.beforeCreate', 'ensureParent', normalized)
        mkdirSync(next, { mode: 0o700 })
        this.inject('directory.afterCreate', 'ensureParent', normalized)
        this.syncDirectory(next, normalized)
        this.syncDirectory(parent, normalized)
        info = lstatSync(next)
      }
      this.assertDirectoryIdentity(next, info)
      parent = next
    }
    const result = join(this.#root, ...segments)
    if (!isPathWithinRootV1(this.#root, result, { allowEqual: false }))
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'artifact logical key escaped its private root'
      )
    }
    return result
  }

  private assertSafeFinal(path: string, mustBeAbsent: boolean): void
  {
    try
    {
      const info = lstatSync(path)
      if (info.isSymbolicLink() || !info.isFile())
      {
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'artifact final path is not a real regular file'
        )
      }
      if (mustBeAbsent)
      {
        throw new DurableArtifactStoreError(
          'entry-exists',
          'artifact final path already exists'
        )
      }
    }
    catch (error)
    {
      if (isMissing(error))
      {
        if (!mustBeAbsent)
        {
          throw new DurableArtifactStoreError(
            'entry-not-found',
            'artifact final path does not exist'
          )
        }
        return
      }
      throw error
    }
  }

  private assertRootIdentity(): void
  {
    const current = rootIdentity(this.#root)
    if (
      realpathSync(this.#root) !== this.#root ||
      current.device !== this.#rootIdentity.device ||
      current.inode !== this.#rootIdentity.inode ||
      current.uid !== this.#rootIdentity.uid
    )
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable artifact root identity changed'
      )
    }
    if (
      sha256(readPrivateBytes(this.#root, STORE_MANIFEST_NAME)) !==
      this.#manifestSha256
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'durable store manifest changed'
      )
    if (this.#mode !== 'read-only')
    {
      const ownerBytes = readPrivateBytes(this.#root, STORE_OWNER_NAME)
      if (sha256(ownerBytes) !== this.#ownershipSha256)
        throw new DurableArtifactStoreError(
          'path-unsafe',
          'durable writer ownership changed'
        )
    }
  }

  private assertDirectoryIdentity(path: string, info: Stats): void
  {
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.dev !== this.#rootIdentity.device ||
      info.uid !== this.#rootIdentity.uid ||
      (info.mode & 0o077) !== 0 ||
      !isPathWithinRootV1(this.#root, realpathSync(path))
    )
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'artifact parent is not a private same-device real directory'
      )
    }
  }

  private syncDirectory(path: string, key: string | null): void
  {
    this.inject('directory.beforeSync', 'syncDirectory', key)
    const info = statSync(path)
    if (!info.isDirectory() || info.dev !== this.#rootIdentity.device)
    {
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'directory sync target is not a same-device directory'
      )
    }
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try
    {
      fsyncSync(descriptor)
    }
    finally
    {
      closeSync(descriptor)
    }
    this.assertRootIdentity()
    this.inject('directory.afterSync', 'syncDirectory', key)
  }

  private probeCapabilities(): void
  {
    this.inject('capability.beforeProbe', 'probeCapabilities', null)
    const token = randomBytes(16).toString('hex')
    const temp = join(this.#root, `.durable-tmp-${token}`)
    const final = join(
      this.#root,
      `.durable-tmp-${token.slice(0, 16)}${'0'.repeat(16)}`
    )
    const pointerTemp = join(
      this.#root,
      `.durable-tmp-${token.slice(0, 16)}${'1'.repeat(16)}`
    )
    const pointer = join(
      this.#root,
      `.durable-tmp-${token.slice(0, 16)}${'2'.repeat(16)}`
    )
    let descriptor: number | null = null
    try
    {
      descriptor = openSync(
        temp,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      this.inject('capability.afterTempOpen', 'probeCapabilities', null)
      writeFileSync(descriptor, Buffer.from('durable-artifact-probe-v1'))
      fsyncSync(descriptor)
      this.inject('capability.afterTempFileSync', 'probeCapabilities', null)
      closeSync(descriptor)
      descriptor = null
      linkSync(temp, final)
      let noReplaceProved = false
      try
      {
        linkSync(temp, final)
      }
      catch (error)
      {
        noReplaceProved = isExists(error)
      }
      if (!noReplaceProved)
      {
        throw new DurableArtifactStoreError(
          'capability-unavailable',
          'filesystem did not prove no-replace hard-link installation'
        )
      }
      this.inject('capability.afterNoReplaceInstall', 'probeCapabilities', null)
      this.syncDirectory(this.#root, null)
      this.inject('capability.afterDirectorySync', 'probeCapabilities', null)
      descriptor = openSync(
        pointerTemp,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      writeFileSync(descriptor, Buffer.from('durable-pointer-probe-v1'))
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = null
      renameSync(pointerTemp, pointer)
      this.inject('capability.afterPointerRename', 'probeCapabilities', null)
      this.syncDirectory(this.#root, null)
      unlinkSync(temp)
      unlinkSync(final)
      unlinkSync(pointer)
      this.syncDirectory(this.#root, null)
      this.inject('capability.afterCleanupSync', 'probeCapabilities', null)
      this.inject('capability.afterProbe', 'probeCapabilities', null)
    }
    catch (error)
    {
      if (descriptor !== null) closeSync(descriptor)
      for (const path of [temp, final, pointerTemp, pointer])
      {
        try
        {
          unlinkSync(path)
        }
        catch (cleanupError)
        {
          if (!isMissing(cleanupError)) continue
        }
      }
      try
      {
        this.syncDirectory(this.#root, null)
      }
      catch
      {
        // startup refuses even when best-effort probe cleanup cannot sync
      }
      if (error instanceof DurableArtifactStoreError) throw error
      throw new DurableArtifactStoreError(
        'capability-unavailable',
        error instanceof Error
          ? error.message
          : 'durable filesystem capability probe failed'
      )
    }
  }

  private inject(
    point: DurableArtifactFaultPoint,
    operation: string,
    key: string | null
  ): void
  {
    this.#faultSequence += 1
    this.#faultHook?.(
      Object.freeze({
        sequence: this.#faultSequence,
        point,
        operation,
        key,
      })
    )
  }
}

export function createDurableArtifactStore(
  rawRoot: string,
  options: DurableArtifactStoreOptions = {}
): DurableArtifactStore
{
  return new DurableArtifactStore(rawRoot, options)
}

export function recoverPartialDurableArtifactStoreV1(
  rawRoot: string,
  options: Omit<
    DurableArtifactStoreOptions,
    'mode' | 'expectedStoreId' | 'expectedOwnershipSha256'
  >
): DurableArtifactStore
{
  const root = realpathSync(resolve(rawRoot))
  const identity = rootIdentity(root)
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries)
  {
    if (
      !entry.isFile() ||
      (!PRIVATE_METADATA_NAMES.has(entry.name) && !TEMP_NAME.test(entry.name))
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'partial durable initialization retained a non-private artifact'
      )
  }
  for (const entry of entries)
  {
    if (!TEMP_NAME.test(entry.name)) continue
    const path = join(root, entry.name)
    const info = lstatSync(path)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.dev !== identity.device ||
      info.uid !== identity.uid ||
      (info.mode & 0o077) !== 0
    )
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'partial durable initialization temp is not private'
      )
    unlinkSync(path)
  }
  syncPrivateDirectory(root)
  const names = new Set(entries.map((entry) => entry.name))
  if (!names.has(STORE_MANIFEST_NAME))
  {
    if (names.has(STORE_OWNER_NAME) || names.has(STORE_QUOTA_NAME))
      throw new DurableArtifactStoreError(
        'path-unsafe',
        'partial durable initialization lacks its root manifest'
      )
    const parent = dirname(root)
    rmdirSync(root)
    syncPrivateDirectory(parent)
    return new DurableArtifactStore(root, {
      ...options,
      mode: 'create-writer',
    })
  }
  const manifestBytes = readPrivateBytes(root, STORE_MANIFEST_NAME)
  const manifest = parseStoreManifest(manifestBytes)
  if (
    manifest.rootDevice !== identity.device ||
    manifest.rootInode !== identity.inode
  )
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'partial durable manifest differs from its root identity'
    )
  for (const [configured, pinned, label] of [
    [options.maxBytes, manifest.maxBytes, 'maxBytes'],
    [options.maxEntryBytes, manifest.maxEntryBytes, 'maxEntryBytes'],
    [options.maxEntries, manifest.maxEntries, 'maxEntries'],
  ] as const)
    if (configured !== undefined && configured !== pinned)
      throw new DurableArtifactStoreError(
        'invalid-quota',
        `partial durable ${label} differs from its manifest`
      )
  if (!names.has(STORE_OWNER_NAME))
  {
    const owner: DurableStoreOwner = {
      schemaVersion: 1,
      storeId: manifest.storeId,
      generation: 0,
      previousOwnershipSha256: null,
      ownerTokenSha256:
        options.ownershipAuthority?.ownerTokenSha256({
          storeId: manifest.storeId,
          generation: 0,
          previousOwnershipSha256: null,
        }) ?? sha256(randomBytes(32)),
    }
    installPrivateImmutable(root, STORE_OWNER_NAME, privateJsonBytes(owner))
  }
  const ownerBytes = readPrivateBytes(root, STORE_OWNER_NAME)
  const owner = parseStoreOwner(ownerBytes)
  if (
    owner.storeId !== manifest.storeId ||
    (options.ownershipAuthority !== undefined &&
      owner.ownerTokenSha256 !==
        options.ownershipAuthority.ownerTokenSha256({
          storeId: owner.storeId,
          generation: owner.generation,
          previousOwnershipSha256: owner.previousOwnershipSha256,
        }))
  )
    throw new DurableArtifactStoreError(
      'path-unsafe',
      'partial durable owner does not authenticate'
    )
  if (!names.has(STORE_QUOTA_NAME))
    installPrivateImmutable(
      root,
      STORE_QUOTA_NAME,
      privateJsonBytes({
        schemaVersion: 1,
        generation: 0,
        maxBytes: manifest.maxBytes,
        reservations: [],
        outcomes: [],
      } satisfies DurableQuotaState)
    )
  const quota = parseQuotaState(readPrivateBytes(root, STORE_QUOTA_NAME))
  if (quota.maxBytes !== manifest.maxBytes)
    throw new DurableArtifactStoreError(
      'invalid-quota',
      'partial durable quota differs from its manifest'
    )
  const observedOwnershipSha256 = sha256(ownerBytes)
  return new DurableArtifactStore(root, {
    ...options,
    mode: 'recovery',
    expectedStoreId: manifest.storeId,
    expectedOwnershipSha256: observedOwnershipSha256,
  })
}

export function isRecoverablePartialDurableArtifactStoreRootV1(
  rawRoot: string
): boolean
{
  const root = realpathSync(resolve(rawRoot))
  rootIdentity(root)
  const entries = readdirSync(root, { withFileTypes: true })
  if (
    entries.some(
      (entry) =>
        !entry.isFile() ||
        (!PRIVATE_METADATA_NAMES.has(entry.name) && !TEMP_NAME.test(entry.name))
    )
  )
    return false
  const names = new Set(entries.map((entry) => entry.name))
  return ![STORE_MANIFEST_NAME, STORE_OWNER_NAME, STORE_QUOTA_NAME].every(
    (name) => names.has(name)
  )
}

class NodeEditArtifactStoreHostAdapter implements EditArtifactStoreHostAdapter
{
  readonly storeId: string
  readonly #store: DurableArtifactStore

  constructor(rawRoot: string, options: DurableArtifactStoreOptions)
  {
    this.#store = createDurableArtifactStore(rawRoot, options)
    this.storeId = this.#store.storeId
  }

  async capability(): Promise<EditArtifactStoreHostCapability>
  {
    const capability = this.#store.capability()
    return Object.freeze({
      ...capability,
      durableFileSync: capability.fileFsync,
      durableDirectorySync: capability.directoryFsync,
      noReplaceInstall: capability.immutableNoReplace,
      expectedHashPointerCas: capability.pointerExpectedHashCompareAndSwap,
      exclusiveWriter: capability.exclusivePrivateRoot,
    })
  }

  async createImmutable(
    key: string,
    bytes: Uint8Array
  ): Promise<DurableArtifactIdentity>
  {
    return this.call(() => this.#store.createImmutable(key, bytes))
  }

  async createOrVerifyImmutable(
    key: string,
    bytes: Uint8Array
  ): Promise<DurableArtifactIdentity>
  {
    return this.call(() => this.#store.createOrVerifyImmutable(key, bytes))
  }

  async readImmutable(key: string): Promise<Uint8Array>
  {
    return this.call(() => this.#store.readImmutable(key))
  }

  async hashImmutable(key: string): Promise<string>
  {
    return this.call(() => this.#store.hashImmutable(key))
  }

  async sizeImmutable(key: string): Promise<number>
  {
    return this.call(() => this.#store.sizeImmutable(key))
  }

  async listImmutable(
    prefix: string
  ): Promise<readonly DurableArtifactEntry[]>
  {
    return this.call(() => this.#store.listImmutable(prefix))
  }

  async compareAndSwapPointer(
    key: string,
    expectedSha256: string | null,
    bytes: Uint8Array
  ): Promise<DurableArtifactIdentity>
  {
    return this.call(() =>
      this.#store.compareAndSwapPointer(key, expectedSha256, bytes)
    )
  }

  async reconcilePointer(
    key: string,
    expectedOldSha256: string | null,
    proposedBytes: Uint8Array
  ): Promise<DurablePointerReconciliation>
  {
    return this.call(() =>
      this.#store.reconcilePointer(key, expectedOldSha256, proposedBytes)
    )
  }

  async reserveQuota(
    reservationId: string,
    byteLength: number
  ): Promise<EditArtifactStoreHostQuotaReservation>
  {
    return this.call(() =>
    {
      this.#store.reserveQuota(reservationId, byteLength)
      return Object.freeze({ reservationId, reservedBytes: byteLength })
    })
  }

  async releaseQuota(reservationId: string): Promise<void>
  {
    this.call(() => this.#store.releaseQuota(reservationId))
  }

  async settleQuota(
    reservationId: string,
    actualByteLength: number
  ): Promise<void>
  {
    this.call(() => this.#store.settleQuota(reservationId, actualByteLength))
  }

  async quotaOutcome(
    reservationId: string
  ): Promise<EditArtifactStoreHostQuotaOutcome>
  {
    return this.call(() => this.#store.quotaOutcome(reservationId))
  }

  async activeQuotaReservations(): Promise<
    readonly EditArtifactStoreHostQuotaReservation[]
  >
  {
    return this.call(() => this.#store.activeQuotaReservations())
  }

  async cleanupProvenTemp(proof: string): Promise<void>
  {
    this.call(() =>
    {
      this.#store.cleanupProvenTemp(decodeTempProof(proof))
    })
  }

  async removeEvictable(key: string, expectedSha256: string): Promise<boolean>
  {
    return this.call(() => this.#store.removeEvictable(key, expectedSha256))
  }

  private call<T>(operation: () => T): T
  {
    try
    {
      return operation()
    }
    catch (error)
    {
      if (error instanceof DurableArtifactStoreError)
      {
        throw new EditArtifactStoreHostError(
          error.code,
          error.message,
          error.tempProof ? encodeTempProof(error.tempProof) : null,
          error.finalInstalled
        )
      }
      throw error
    }
  }
}

function encodeTempProof(proof: DurableArtifactTempProof): string
{
  return `durable-temp-v1.${Buffer.from(JSON.stringify(proof)).toString(
    'base64url'
  )}`
}

function decodeTempProof(value: string): DurableArtifactTempProof
{
  const prefix = 'durable-temp-v1.'
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    value.length > 512
  )
  {
    throw new DurableArtifactStoreError(
      'temp-proof-invalid',
      'temporary artifact proof has an invalid envelope'
    )
  }
  const encoded = value.slice(prefix.length)
  let decoded: unknown
  try
  {
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded)
    {
      throw new Error('noncanonical base64url')
    }
    decoded = JSON.parse(bytes.toString('utf8'))
  }
  catch
  {
    throw new DurableArtifactStoreError(
      'temp-proof-invalid',
      'temporary artifact proof cannot be decoded'
    )
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded)
  )
  {
    throw new DurableArtifactStoreError(
      'temp-proof-invalid',
      'temporary artifact proof must decode to one record'
    )
  }
  const record = decoded as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [
    'byteLength',
    'logicalParent',
    'schemaVersion',
    'sha256',
    'storeId',
    'tempToken',
  ]
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    record.schemaVersion !== 1 ||
    typeof record.storeId !== 'string' ||
    typeof record.logicalParent !== 'string' ||
    typeof record.tempToken !== 'string' ||
    typeof record.sha256 !== 'string' ||
    typeof record.byteLength !== 'number'
  )
  {
    throw new DurableArtifactStoreError(
      'temp-proof-invalid',
      'temporary artifact proof has an invalid record shape'
    )
  }
  return {
    schemaVersion: record.schemaVersion,
    storeId: record.storeId,
    logicalParent: record.logicalParent,
    tempToken: record.tempToken,
    sha256: record.sha256,
    byteLength: record.byteLength,
  }
}

export function createEditArtifactStoreHostAdapter(
  rawRoot: string,
  options: DurableArtifactStoreOptions = {}
): EditArtifactStoreHostAdapter
{
  return new NodeEditArtifactStoreHostAdapter(rawRoot, options)
}
