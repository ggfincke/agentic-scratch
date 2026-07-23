// packages/mcp/src/transport/publication.ts
// host publication port: private output directory, no-replace hard-link commit, & proof

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { isEditPublicationCapabilityReadyV1 } from '@scratch-agent/edit'
import type {
  EditPublicationPreparedV1,
  EditPublicationRecoveryAuthorityV1,
  EditPublicationRecoveryPortV1,
} from '@scratch-agent/edit'
import { isPathWithinRootV1 } from '@scratch-agent/eval'

import { RepairMcpBoundaryError } from './errors.js'

const OUTPUT_BASENAME_MAXIMUM_BYTES = 255
const TEMP_NAME = /^\.edit-publication-tmp-[a-f0-9]{32}$/u
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024 * 1024

// mirrors DURABLE_ARTIFACT_FAULT_POINTS: the same discipline, over the external
// output directory instead of the store's own private root
export const EDIT_PUBLICATION_FAULT_POINTS = [
  'capability.beforeProbe',
  'capability.afterNoReplaceLink',
  'capability.afterProbe',
  'reservation.beforeRevalidate',
  'reservation.afterRevalidate',
  'directory.beforeRecheck',
  'directory.afterRecheck',
  'prepare.beforeTempOpen',
  'prepare.afterTempOpen',
  'prepare.afterNameDurable',
  'prepare.beforeWrite',
  'prepare.afterWrite',
  'prepare.beforeFileSync',
  'prepare.afterFileSync',
  'prepare.beforeReadback',
  'prepare.afterReadback',
  'reopen.beforePreparedRead',
  'reopen.afterPreparedRead',
  'commit.beforeLink',
  'commit.afterLink',
  'commit.beforeDirectorySync',
  'commit.afterDirectorySync',
  'verify.beforeOpen',
  'verify.afterOpen',
  'verify.afterIdentityCheck',
  'release.beforeUnlink',
  'release.afterUnlink',
  'release.afterDirectorySync',
  'recover.beforeInspect',
  'recover.afterInspect',
  'recover.beforeDirectorySync',
  'recover.afterDirectorySync',
  'recover.beforeTempRecreate',
  'recover.afterTempRecreate',
  'recover.beforeLink',
  'recover.afterLink',
] as const

export type EditPublicationFaultPoint =
  (typeof EDIT_PUBLICATION_FAULT_POINTS)[number]

export interface EditPublicationFaultContext
{
  readonly sequence: number
  readonly point: EditPublicationFaultPoint
  readonly operation: string
}

export type EditPublicationFaultHook = (
  context: EditPublicationFaultContext
) => void

export class EditPublicationError extends Error
{
  readonly internalEvidenceSha256: string | null

  constructor(
    readonly code: string,
    message: string,
    readonly committed: boolean = false,
    internalError?: unknown
  )
  {
    super(message)
    this.name = 'EditPublicationError'
    this.internalEvidenceSha256 =
      internalError === undefined
        ? null
        : filesystemErrorEvidenceSha256(internalError)
  }
}

// path-free diagnostic evidence keeps errno/syscall classes observable without
// allowing host paths or arbitrary filesystem prose into semantic records
function filesystemErrorEvidenceSha256(error: unknown): string
{
  const record =
    error !== null && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null
  const bounded = (value: unknown): string | null =>
    typeof value === 'string'
      ? value.replace(/[^A-Za-z0-9_.-]/gu, '?').slice(0, 64)
      : null
  return createHash('sha256')
    .update('scratch-agent:publication-fs-error:v1', 'utf8')
    .update(Buffer.from([0]))
    .update(
      JSON.stringify({
        name: error instanceof Error ? bounded(error.name) : null,
        code: bounded(record?.code),
        errno:
          typeof record?.errno === 'number' &&
          Number.isSafeInteger(record.errno)
            ? record.errno
            : null,
        syscall: bounded(record?.syscall),
      })
    )
    .digest('hex')
}

interface DirectoryIdentity
{
  canonicalRealpath: string
  device: string
  inode: string
  mode: string
  uid: string
}

interface Reservation
{
  reservationId: string
  reservationSha256: string
  basename: string
  finalCanonicalPath: string
}

interface FinalEntryIdentity
{
  readonly device: string
  readonly inode: string
}

interface Prepared
{
  preparationId: string
  reservationId: string
  tempBasename: string
  tempCanonicalPath: string
  finalCanonicalPath: string
  device: string
  inode: string
  mode: string
  byteLength: number
  sha256: string
  nameDurableBeforeWrite: boolean
  fileSynced: boolean
  readbackVerified: boolean
  committed: boolean
  released: boolean
}

export interface EditPublicationRootOptions
{
  readonly maximumOutputByteLength?: number
  readonly faultHook?: EditPublicationFaultHook
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function isExists(error: unknown): boolean
{
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  )
}

function isMissing(error: unknown): boolean
{
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

// O_DIRECTORY|O_NOFOLLOW so the sync target cannot be swapped for a symlink
// between the identity check & the sync itself
function syncDirectory(path: string): void
{
  let descriptor: number
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
  }
  catch (error)
  {
    throw new EditPublicationError(
      'edit.export_write_failed',
      'publication directory could not be opened for durability proof',
      false,
      error
    )
  }
  try
  {
    fsyncSync(descriptor)
  }
  catch (error)
  {
    throw new EditPublicationError(
      'edit.export_write_failed',
      'publication directory durability could not be proven',
      false,
      error
    )
  }
  finally
  {
    closeSync(descriptor)
  }
}

function directoryIdentity(path: string): DirectoryIdentity
{
  let info
  try
  {
    info = lstatSync(path, { bigint: true })
  }
  catch (error)
  {
    throw new EditPublicationError(
      'edit.output_invalid',
      'publication directory identity could not be checked',
      false,
      error
    )
  }
  if (info.isSymbolicLink() || !info.isDirectory())
  {
    throw new EditPublicationError(
      'edit.output_invalid',
      'publication directory must be a real directory'
    )
  }
  const processUid = process.getuid?.()
  if (processUid !== undefined && info.uid !== BigInt(processUid))
  {
    throw new EditPublicationError(
      'edit.output_invalid',
      'publication directory must be owned by the current user'
    )
  }
  if ((info.mode & 0o077n) !== 0n)
  {
    throw new EditPublicationError(
      'edit.output_invalid',
      'publication directory must not grant group or other access'
    )
  }
  let canonicalRealpath: string
  try
  {
    canonicalRealpath = realpathSync(path)
  }
  catch (error)
  {
    throw new EditPublicationError(
      'edit.output_invalid',
      'publication directory identity could not be resolved',
      false,
      error
    )
  }
  return {
    canonicalRealpath,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mode: (info.mode & 0o7777n).toString(8),
    uid: info.uid.toString(),
  }
}

// resolveDestination must expose the final entry's own identity without
// turning existence into a refusal; edit uses it to classify source aliases
// before revalidateReservation applies the ordinary no-replace rule
function finalEntryIdentity(path: string): FinalEntryIdentity | null
{
  try
  {
    const info = lstatSync(path, { bigint: true })
    return Object.freeze({
      device: info.dev.toString(),
      inode: info.ino.toString(),
    })
  }
  catch (error)
  {
    if (isMissing(error)) return null
    throw new EditPublicationError(
      'edit.output_invalid',
      'output destination identity could not be checked'
    )
  }
}

function rejectSymlinkComponents(root: string, candidate: string): void
{
  const rel = relative(root, candidate)
  if (rel === '') return
  let cursor = root
  for (const part of rel.split(/[\\/]+/))
  {
    cursor = join(cursor, part)
    try
    {
      if (lstatSync(cursor).isSymbolicLink())
      {
        throw new EditPublicationError(
          'edit.output_invalid',
          'symlink path components are not allowed under the publication root'
        )
      }
    }
    catch (error)
    {
      if (error instanceof EditPublicationError) throw error
      if (isMissing(error)) continue
      throw new EditPublicationError(
        'edit.output_invalid',
        'publication path component could not be checked'
      )
    }
  }
}

// the host creates this leaf before the agent starts; mode 0700 & current-user
// ownership are preconditions, not something the port repairs later
export function configureEditPublicationDirectory(
  outputRoot: string,
  leafName: string
): string
{
  if (typeof outputRoot !== 'string' || !isAbsolute(outputRoot))
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication output root must be an absolute existing directory'
    )
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(leafName))
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication leaf name is not host-safe'
    )
  }
  let root: string
  try
  {
    root = realpathSync(resolve(outputRoot))
    if (!statSync(root).isDirectory()) throw new Error('not a directory')
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication output root must be an existing directory'
    )
  }
  const leaf = join(root, leafName)
  try
  {
    mkdirSync(leaf, { recursive: false, mode: 0o700 })
    return realpathSync(leaf)
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication directory could not be created safely'
    )
  }
}

export class EditPublicationDirectoryPort
{
  readonly #directory: string
  readonly #identity: DirectoryIdentity
  readonly #maximumOutputByteLength: number
  readonly #faultHook: EditPublicationFaultHook | null
  readonly #reservations = new Map<string, Reservation>()
  readonly #prepared = new Map<string, Prepared>()
  readonly #rootOwnershipSha256: string
  #faultSequence = 0
  #noReplaceProven = false

  constructor(directory: string, options: EditPublicationRootOptions = {})
  {
    try
    {
      this.#directory = realpathSync(resolve(directory))
    }
    catch (error)
    {
      throw new EditPublicationError(
        'edit.publication_unavailable',
        'publication directory could not be resolved',
        false,
        error
      )
    }
    this.#identity = directoryIdentity(this.#directory)
    this.#maximumOutputByteLength =
      options.maximumOutputByteLength ?? DEFAULT_MAX_OUTPUT_BYTES
    this.#faultHook = options.faultHook ?? null
    this.#rootOwnershipSha256 = sha256(
      new TextEncoder().encode(
        `${this.#identity.canonicalRealpath}\0${this.#identity.device}\0${this.#identity.inode}\0${this.#identity.uid}`
      )
    )
    this.probe()
  }

  // exactly the no-replace proof durable-artifacts.ts uses: link once, then link
  // again & require EEXIST. Without that proof there is no copy, replace-rename,
  // or direct-final-write fallback - publication is simply unavailable
  private probe(): void
  {
    this.inject('capability.beforeProbe', 'probe')
    const token = randomBytes(16).toString('hex')
    const temp = join(this.#directory, `.edit-publication-tmp-${token}`)
    const final = join(
      this.#directory,
      `.edit-publication-tmp-${token.slice(0, 16)}${'0'.repeat(16)}`
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
      writeFileSync(descriptor, Buffer.from('edit-publication-probe-v1'))
      fsyncSync(descriptor)
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
        throw new EditPublicationError(
          'edit.publication_unavailable',
          'filesystem did not prove no-replace hard-link publication'
        )
      }
      this.inject('capability.afterNoReplaceLink', 'probe')
      syncDirectory(this.#directory)
      unlinkSync(temp)
      unlinkSync(final)
      syncDirectory(this.#directory)
      this.#noReplaceProven = true
      this.inject('capability.afterProbe', 'probe')
    }
    catch (error)
    {
      if (descriptor !== null) closeSync(descriptor)
      for (const path of [temp, final])
      {
        try
        {
          unlinkSync(path)
        }
        catch
        {
          continue
        }
      }
      if (
        error instanceof EditPublicationError &&
        error.code === 'edit.publication_unavailable'
      )
        throw error
      throw new EditPublicationError(
        'edit.publication_unavailable',
        'publication capability probe failed',
        false,
        error
      )
    }
  }

  async capability(): Promise<{
    publicationRootId: string
    publicationRootOwnershipSha256: string
    writable: boolean
    rejectsSymlinkComponents: boolean
    enforcesRealPathContainment: boolean
    noReplaceLink: boolean
    durableFileSync: boolean
    durableDirectorySync: boolean
    reopensNoFollow: boolean
    maximumOutputByteLength: number
  }>
  {
    return Object.freeze({
      publicationRootId: basename(this.#directory),
      publicationRootOwnershipSha256: this.#rootOwnershipSha256,
      writable: true,
      rejectsSymlinkComponents: true,
      enforcesRealPathContainment: true,
      noReplaceLink: this.#noReplaceProven,
      durableFileSync: true,
      durableDirectorySync: true,
      reopensNoFollow: true,
      maximumOutputByteLength: this.#maximumOutputByteLength,
    })
  }

  // * deliberately performs no existence check: the edit domain decides its
  // * permanent source denial from this resolution first, so a denied
  // * destination never reports the weaker output_exists instead
  async resolveDestination(
    request:
      | { kind: 'basename'; basename: string }
      | { kind: 'reservation'; reservationId: string }
  ): Promise<{
    basename: string
    finalCanonicalPath: string
    finalIdentity: FinalEntryIdentity | null
    directory: DirectoryIdentity
  }>
  {
    const identity = this.assertDirectoryIdentity()
    if (request.kind === 'reservation')
    {
      const existing = this.#reservations.get(request.reservationId)
      if (existing === undefined)
      {
        throw new EditPublicationError(
          'edit.output_invalid',
          'no live output reservation carries that identity'
        )
      }
      return Object.freeze({
        basename: existing.basename,
        finalCanonicalPath: existing.finalCanonicalPath,
        finalIdentity: finalEntryIdentity(existing.finalCanonicalPath),
        directory: identity,
      })
    }
    const name = this.assertBasename(request.basename)
    const finalCanonicalPath = join(identity.canonicalRealpath, name)
    rejectSymlinkComponents(identity.canonicalRealpath, finalCanonicalPath)
    return Object.freeze({
      basename: name,
      finalCanonicalPath,
      finalIdentity: finalEntryIdentity(finalCanonicalPath),
      directory: identity,
    })
  }

  async revalidateReservation(
    request:
      | { kind: 'basename'; basename: string }
      | { kind: 'reservation'; reservationId: string }
  ): Promise<{
    reservationId: string
    reservationSha256: string
    basename: string
    finalCanonicalPath: string
    directory: DirectoryIdentity
  }>
  {
    this.inject('reservation.beforeRevalidate', 'revalidateReservation')
    const identity = this.assertDirectoryIdentity()
    if (request.kind === 'reservation')
    {
      const existing = this.#reservations.get(request.reservationId)
      if (existing === undefined)
      {
        throw new EditPublicationError(
          'edit.output_invalid',
          'no live output reservation carries that identity'
        )
      }
      this.inject('reservation.afterRevalidate', 'revalidateReservation')
      return Object.freeze({ ...existing, directory: identity })
    }
    const name = this.assertBasename(request.basename)
    const finalCanonicalPath = join(identity.canonicalRealpath, name)
    rejectSymlinkComponents(identity.canonicalRealpath, finalCanonicalPath)
    // a preexisting final name always refuses, before anything is written
    try
    {
      lstatSync(finalCanonicalPath)
      throw new EditPublicationError(
        'edit.output_exists',
        'the output name already exists & is never replaced'
      )
    }
    catch (error)
    {
      if (error instanceof EditPublicationError) throw error
      if (!isMissing(error))
      {
        throw new EditPublicationError(
          'edit.output_invalid',
          'output name could not be checked'
        )
      }
    }
    const reservationSha256 = sha256(
      new TextEncoder().encode(
        `edit-publication-reservation-v1\0${identity.device}\0${identity.inode}\0${name}`
      )
    )
    const reservationId = `outres-${sha256(
      new Uint8Array([
        ...new TextEncoder().encode('outres\0'),
        ...randomBytes(16),
        ...new TextEncoder().encode(reservationSha256),
      ])
    ).slice(0, 32)}`
    const reservation: Reservation = {
      reservationId,
      reservationSha256,
      basename: name,
      finalCanonicalPath,
    }
    this.#reservations.set(reservationId, reservation)
    this.inject('reservation.afterRevalidate', 'revalidateReservation')
    return Object.freeze({ ...reservation, directory: identity })
  }

  async recheckDirectory(reservationId: string): Promise<DirectoryIdentity>
  {
    this.inject('directory.beforeRecheck', 'recheckDirectory')
    if (!this.#reservations.has(reservationId))
    {
      throw new EditPublicationError(
        'edit.output_invalid',
        'no live output reservation carries that identity'
      )
    }
    const identity = this.assertDirectoryIdentity()
    this.inject('directory.afterRecheck', 'recheckDirectory')
    return identity
  }

  // steps 3 & 4 together: the temp name is made durable before any byte lands,
  // then the bytes are written, synced, read back, & verified by size + hash
  async prepare(
    reservationId: string,
    bytes: Uint8Array,
    recoveryAuthority: string
  ): Promise<{
    preparationId: string
    reservationId: string
    tempBasename: string
    tempCanonicalPath: string
    finalCanonicalPath: string
    device: string
    inode: string
    mode: string
    byteLength: number
    sha256: string
    directory: DirectoryIdentity
    nameDurableBeforeWrite: boolean
    fileSynced: boolean
    readbackVerified: boolean
  }>
  {
    const reservation = this.#reservations.get(reservationId)
    if (reservation === undefined)
    {
      throw new EditPublicationError(
        'edit.output_invalid',
        'no live output reservation carries that identity'
      )
    }
    if (bytes.byteLength > this.#maximumOutputByteLength)
    {
      throw new EditPublicationError(
        'edit.export_write_failed',
        'candidate exceeds the configured publication byte ceiling'
      )
    }
    const identity = this.assertDirectoryIdentity()
    if (!TEMP_NAME.test(recoveryAuthority))
    {
      throw new EditPublicationError(
        'edit.output_invalid',
        'publication recovery authority is not one host-safe temp name'
      )
    }
    const tempBasename = recoveryAuthority
    const tempCanonicalPath = join(identity.canonicalRealpath, tempBasename)
    const expectedSha256 = sha256(bytes)
    this.inject('prepare.beforeTempOpen', 'prepare')
    let descriptor: number | null = null
    try
    {
      descriptor = openSync(
        tempCanonicalPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      this.inject('prepare.afterTempOpen', 'prepare')
      // * the recovery name must be durable before the bytes, so a crash leaves
      // * a nameable inode rather than an unreachable one
      syncDirectory(identity.canonicalRealpath)
      this.inject('prepare.afterNameDurable', 'prepare')
      this.inject('prepare.beforeWrite', 'prepare')
      writeFileSync(descriptor, bytes)
      this.inject('prepare.afterWrite', 'prepare')
      this.inject('prepare.beforeFileSync', 'prepare')
      fsyncSync(descriptor)
      this.inject('prepare.afterFileSync', 'prepare')
      const info = fstatSync(descriptor, { bigint: true })
      closeSync(descriptor)
      descriptor = null
      this.inject('prepare.beforeReadback', 'prepare')
      const readback = this.readNoFollow(tempCanonicalPath)
      if (
        readback.byteLength !== bytes.byteLength ||
        sha256(readback) !== expectedSha256
      )
      {
        throw new EditPublicationError(
          'edit.export_proof_failed',
          'prepared bytes did not read back at the exact size & hash'
        )
      }
      this.inject('prepare.afterReadback', 'prepare')
      const preparationId = `outprep-${sha256(
        new Uint8Array([
          ...new TextEncoder().encode('outprep\0'),
          ...randomBytes(16),
          ...new TextEncoder().encode(`${tempBasename}\0${expectedSha256}`),
        ])
      ).slice(0, 32)}`
      const prepared: Prepared = {
        preparationId,
        reservationId,
        tempBasename,
        tempCanonicalPath,
        finalCanonicalPath: reservation.finalCanonicalPath,
        device: info.dev.toString(),
        inode: info.ino.toString(),
        mode: (info.mode & 0o7777n).toString(8),
        byteLength: bytes.byteLength,
        sha256: expectedSha256,
        nameDurableBeforeWrite: true,
        fileSynced: true,
        readbackVerified: true,
        committed: false,
        released: false,
      }
      this.#prepared.set(preparationId, prepared)
      return Object.freeze({ ...prepared, directory: identity })
    }
    catch (error)
    {
      if (descriptor !== null) closeSync(descriptor)
      try
      {
        unlinkSync(tempCanonicalPath)
        syncDirectory(identity.canonicalRealpath)
      }
      catch
      {
        // the retained temp name stays the only cleanup authority
      }
      if (error instanceof EditPublicationError) throw error
      throw new EditPublicationError(
        'edit.export_write_failed',
        'prepared publication could not be written safely',
        false,
        error
      )
    }
  }

  async readPrepared(preparationId: string): Promise<Uint8Array>
  {
    const prepared = this.requirePrepared(preparationId)
    this.inject('reopen.beforePreparedRead', 'readPrepared')
    // reopened through the temp path but verified against the recorded inode, so
    // a replaced name is caught rather than admitted
    const bytes = this.readNoFollow(prepared.tempCanonicalPath, prepared)
    this.inject('reopen.afterPreparedRead', 'readPrepared')
    return bytes
  }

  async adoptRetainedPreparation(
    authority: EditPublicationRecoveryAuthorityV1
  ): Promise<EditPublicationPreparedV1>
  {
    const identity = this.assertDirectoryIdentity()
    if (
      authority.publicationRootId !== basename(this.#directory) ||
      authority.publicationRootOwnershipSha256 !== this.#rootOwnershipSha256 ||
      authority.directory.canonicalRealpath !== identity.canonicalRealpath ||
      authority.directory.device !== identity.device ||
      authority.directory.inode !== identity.inode ||
      authority.directory.mode !== identity.mode ||
      authority.directory.uid !== identity.uid ||
      !TEMP_NAME.test(authority.tempBasename) ||
      !/^outres-[0-9a-f]{32}$/u.test(authority.reservationId) ||
      !LOWERCASE_SHA256_PATTERN.test(authority.reservationSha256) ||
      !LOWERCASE_SHA256_PATTERN.test(authority.candidateSha256) ||
      (authority.tempDevice !== null &&
        !/^[0-9]+$/u.test(authority.tempDevice)) ||
      (authority.tempInode !== null &&
        !/^[0-9]+$/u.test(authority.tempInode)) ||
      (authority.tempMode !== null &&
        !/^[0-7]{3,4}$/u.test(authority.tempMode)) ||
      ((authority.tempDevice === null ||
        authority.tempInode === null ||
        authority.tempMode === null) &&
        !(
          authority.tempDevice === null &&
          authority.tempInode === null &&
          authority.tempMode === null
        )) ||
      !Number.isSafeInteger(authority.candidateByteLength) ||
      authority.candidateByteLength < 0 ||
      authority.candidateByteLength > this.#maximumOutputByteLength
    )
    {
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'retained publication recovery authority differs from this protected root'
      )
    }
    const name = this.assertBasename(authority.basename)
    const expectedReservationSha256 = sha256(
      new TextEncoder().encode(
        `edit-publication-reservation-v1\0${identity.device}\0${identity.inode}\0${name}`
      )
    )
    if (expectedReservationSha256 !== authority.reservationSha256)
    {
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'retained publication reservation no longer reconstructs'
      )
    }
    const tempCanonicalPath = join(
      identity.canonicalRealpath,
      authority.tempBasename
    )
    const finalCanonicalPath = join(identity.canonicalRealpath, name)
    rejectSymlinkComponents(identity.canonicalRealpath, tempCanonicalPath)
    rejectSymlinkComponents(identity.canonicalRealpath, finalCanonicalPath)
    const observedTemp = this.statOrAbsent(tempCanonicalPath)
    let tempDevice = authority.tempDevice ?? '0'
    let tempInode = authority.tempInode ?? '0'
    let tempMode = authority.tempMode ?? '600'
    if (observedTemp !== null)
    {
      let info
      try
      {
        info = lstatSync(tempCanonicalPath, { bigint: true })
      }
      catch (error)
      {
        throw new EditPublicationError(
          'edit.export_proof_failed',
          'retained publication temp identity could not be checked',
          false,
          error
        )
      }
      const observedMode = (info.mode & 0o7777n).toString(8)
      const processUid = process.getuid?.()
      const retainedIdentityMatches =
        authority.tempDevice === null ||
        (observedTemp.device === authority.tempDevice &&
          observedTemp.inode === authority.tempInode &&
          observedMode === authority.tempMode)
      if (
        !retainedIdentityMatches ||
        !info.isFile() ||
        observedMode !== '600' ||
        (processUid !== undefined && info.uid !== BigInt(processUid)) ||
        observedTemp.byteLength !== authority.candidateByteLength ||
        sha256(this.readNoFollow(tempCanonicalPath)) !==
          authority.candidateSha256
      )
      {
        throw new EditPublicationError(
          'edit.publication_interference',
          'retained temp name no longer matches its exact publication proof',
          true
        )
      }
      tempDevice = observedTemp.device
      tempInode = observedTemp.inode
      tempMode = observedMode
    }
    const preparationId = `outprep-${sha256(
      new TextEncoder().encode(
        `retained\0${authority.tempBasename}\0${authority.candidateSha256}`
      )
    ).slice(0, 32)}`
    const reservation: Reservation = {
      reservationId: authority.reservationId,
      reservationSha256: authority.reservationSha256,
      basename: name,
      finalCanonicalPath,
    }
    const prepared: Prepared = {
      preparationId,
      reservationId: authority.reservationId,
      tempBasename: authority.tempBasename,
      tempCanonicalPath,
      finalCanonicalPath,
      device: tempDevice,
      inode: tempInode,
      mode: tempMode,
      byteLength: authority.candidateByteLength,
      sha256: authority.candidateSha256,
      nameDurableBeforeWrite: true,
      fileSynced: true,
      readbackVerified: true,
      committed: false,
      released: false,
    }
    const existing = this.#prepared.get(preparationId)
    if (existing !== undefined)
    {
      if (JSON.stringify(existing) !== JSON.stringify(prepared))
      {
        throw new EditPublicationError(
          'edit.publication_interference',
          'retained preparation identity was adopted with different authority',
          true
        )
      }
    }
    else this.#prepared.set(preparationId, prepared)
    this.#reservations.set(authority.reservationId, reservation)
    return Object.freeze({ ...prepared, directory: identity })
  }

  // step 7: the durable commit point is successful link creation together w/ a
  // successful directory fsync; neither alone is reported as committed
  async commit(preparationId: string): Promise<{
    preparationId: string
    finalCanonicalPath: string
    linkCreated: boolean
    directorySynced: boolean
    device: string
    inode: string
    byteLength: number
  }>
  {
    const prepared = this.requirePrepared(preparationId)
    const identity = this.assertDirectoryIdentity()
    // * the link syscall sits alone in its own try. Only a failure of the call
    // * itself is an ordinary pre-publication failure; from the moment it
    // * returns, every later failure belongs to the recovery window
    this.inject('commit.beforeLink', 'commit')
    try
    {
      linkSync(prepared.tempCanonicalPath, prepared.finalCanonicalPath)
    }
    catch (error)
    {
      if (isExists(error))
      {
        // ! refuses without touching the existing name at all
        throw new EditPublicationError(
          'edit.output_exists',
          'the output name already exists & is never replaced'
        )
      }
      throw new EditPublicationError(
        'edit.export_write_failed',
        'publication link could not be created safely',
        false,
        error
      )
    }
    try
    {
      this.inject('commit.afterLink', 'commit')
      this.inject('commit.beforeDirectorySync', 'commit')
      syncDirectory(identity.canonicalRealpath)
      this.inject('commit.afterDirectorySync', 'commit')
      prepared.committed = true
      const info = lstatSync(prepared.finalCanonicalPath, { bigint: true })
      return Object.freeze({
        preparationId,
        finalCanonicalPath: prepared.finalCanonicalPath,
        linkCreated: true,
        directorySynced: true,
        device: info.dev.toString(),
        inode: info.ino.toString(),
        byteLength: Number(info.size),
      })
    }
    catch (error)
    {
      // the link may be visible but is not proven durable; this window is
      // recovery, never an ordinary export failure
      throw new EditPublicationError(
        'edit.recovery_required',
        'publication did not prove the durable commit point after link creation',
        true,
        error
      )
    }
  }

  async verifyCommitted(preparationId: string): Promise<{
    preparationId: string
    finalCanonicalPath: string
    device: string
    inode: string
    byteLength: number
    sha256: string
    bytes: Uint8Array
    matchesPreparedIdentity: boolean
  }>
  {
    const prepared = this.requirePrepared(preparationId)
    if (!prepared.committed)
    {
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'publication was not committed, so there is nothing to verify'
      )
    }
    this.inject('verify.beforeOpen', 'verifyCommitted')
    let descriptor: number
    try
    {
      descriptor = openSync(
        prepared.finalCanonicalPath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      )
    }
    catch (error)
    {
      throw new EditPublicationError(
        'edit.export_reopen_failed',
        'committed publication could not be reopened safely',
        true,
        error
      )
    }
    try
    {
      const info = fstatSync(descriptor, { bigint: true })
      this.inject('verify.afterOpen', 'verifyCommitted')
      const bytes = Uint8Array.from(readFileSync(descriptor))
      const observed = sha256(bytes)
      const matchesPreparedIdentity =
        info.dev.toString() === prepared.device &&
        info.ino.toString() === prepared.inode &&
        Number(info.size) === prepared.byteLength &&
        observed === prepared.sha256
      if (!matchesPreparedIdentity)
      {
        // outside the trusted-directory threat model: never delete the unknown
        // path, terminalize as external publication interference
        throw new EditPublicationError(
          'edit.publication_interference',
          'committed output identity does not match the retained temp proof',
          true
        )
      }
      this.inject('verify.afterIdentityCheck', 'verifyCommitted')
      return Object.freeze({
        preparationId,
        finalCanonicalPath: prepared.finalCanonicalPath,
        device: info.dev.toString(),
        inode: info.ino.toString(),
        byteLength: Number(info.size),
        sha256: observed,
        bytes,
        matchesPreparedIdentity,
      })
    }
    catch (error)
    {
      if (error instanceof EditPublicationError) throw error
      throw new EditPublicationError(
        'edit.export_reopen_failed',
        'committed publication could not be verified safely',
        true,
        error
      )
    }
    finally
    {
      closeSync(descriptor)
    }
  }

  async releasePrepared(preparationId: string): Promise<void>
  {
    const prepared = this.#prepared.get(preparationId)
    if (prepared === undefined || prepared.released) return
    const identity = this.assertDirectoryIdentity()
    if (!TEMP_NAME.test(prepared.tempBasename))
    {
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'retained temp proof is not a host-internal publication name'
      )
    }
    this.inject('release.beforeUnlink', 'releasePrepared')
    try
    {
      const info = lstatSync(prepared.tempCanonicalPath, { bigint: true })
      if (
        info.dev.toString() !== prepared.device ||
        info.ino.toString() !== prepared.inode
      )
      {
        throw new EditPublicationError(
          'edit.export_proof_failed',
          'proven temp name no longer resolves to the prepared inode',
          prepared.committed
        )
      }
      unlinkSync(prepared.tempCanonicalPath)
    }
    catch (error)
    {
      if (error instanceof EditPublicationError) throw error
      if (!isMissing(error))
      {
        throw new EditPublicationError(
          'edit.export_proof_failed',
          'publication temp cleanup could not be proven',
          prepared.committed,
          error
        )
      }
    }
    this.inject('release.afterUnlink', 'releasePrepared')
    try
    {
      syncDirectory(identity.canonicalRealpath)
    }
    catch (error)
    {
      throw new EditPublicationError(
        prepared.committed
          ? 'edit.recovery_required'
          : 'edit.export_proof_failed',
        'publication temp cleanup durability could not be proven',
        prepared.committed,
        error
      )
    }
    prepared.released = true
    this.inject('release.afterDirectorySync', 'releasePrepared')
  }

  // ---- roll-forward recovery for the link-before-directory-sync window ----

  // pure observation of the two proven names; it mutates nothing & claims
  // nothing, so the domain can classify the window before acting
  async inspectPublicationNames(preparationId: string): Promise<{
    preparationId: string
    tempPresent: boolean
    tempMatchesProof: boolean
    finalPresent: boolean
    finalMatchesProof: boolean
    finalDevice: string | null
    finalInode: string | null
    finalByteLength: number | null
  }>
  {
    const prepared = this.requirePrepared(preparationId)
    this.inject('recover.beforeInspect', 'inspectPublicationNames')
    this.assertDirectoryIdentity()
    const temp = this.statOrAbsent(prepared.tempCanonicalPath)
    const final = this.statOrAbsent(prepared.finalCanonicalPath)
    const inspection = Object.freeze({
      preparationId,
      tempPresent: temp !== null,
      tempMatchesProof:
        temp !== null &&
        temp.device === prepared.device &&
        temp.inode === prepared.inode,
      finalPresent: final !== null,
      // a hard link shares the inode, so the committed name matching the proof
      // is exactly device+inode equality w/ the prepared temp
      finalMatchesProof:
        final !== null &&
        final.device === prepared.device &&
        final.inode === prepared.inode &&
        final.byteLength === prepared.byteLength,
      finalDevice: final?.device ?? null,
      finalInode: final?.inode ?? null,
      finalByteLength: final?.byteLength ?? null,
    })
    this.inject('recover.afterInspect', 'inspectPublicationNames')
    return inspection
  }

  // case A: the final link is already the prepared inode, so recovery only owes
  // the directory sync that the interrupted attempt never reached
  async syncPublicationDirectory(preparationId: string): Promise<{
    preparationId: string
    finalCanonicalPath: string
    linkCreated: boolean
    directorySynced: boolean
    device: string
    inode: string
    byteLength: number
  }>
  {
    const prepared = this.requirePrepared(preparationId)
    const identity = this.assertDirectoryIdentity()
    const final = this.statOrAbsent(prepared.finalCanonicalPath)
    if (
      final === null ||
      final.device !== prepared.device ||
      final.inode !== prepared.inode
    )
    {
      throw new EditPublicationError(
        'edit.publication_interference',
        'the final name is not the prepared inode, so it cannot be synced forward',
        true
      )
    }
    this.inject('recover.beforeDirectorySync', 'syncPublicationDirectory')
    try
    {
      syncDirectory(identity.canonicalRealpath)
    }
    catch (error)
    {
      throw new EditPublicationError(
        'edit.recovery_required',
        'publication recovery durability could not be proven',
        true,
        error
      )
    }
    this.inject('recover.afterDirectorySync', 'syncPublicationDirectory')
    prepared.committed = true
    return Object.freeze({
      preparationId,
      finalCanonicalPath: prepared.finalCanonicalPath,
      linkCreated: true,
      directorySynced: true,
      device: final.device,
      inode: final.inode,
      byteLength: final.byteLength,
    })
  }

  // case B: the final name is proven absent, so recovery repeats the no-replace
  // link, recreating a verified temp from the retained candidate if the proven
  // temp no longer resolves to the prepared inode
  async relinkPrepared(
    preparationId: string,
    bytes: Uint8Array
  ): Promise<{
    commit: {
      preparationId: string
      finalCanonicalPath: string
      linkCreated: boolean
      directorySynced: boolean
      device: string
      inode: string
      byteLength: number
    }
    prepared: Prepared & { directory: DirectoryIdentity }
    temporaryRecreated: boolean
  }>
  {
    const prepared = this.requirePrepared(preparationId)
    const identity = this.assertDirectoryIdentity()
    if (this.statOrAbsent(prepared.finalCanonicalPath) !== null)
    {
      throw new EditPublicationError(
        'edit.publication_interference',
        'the final name is present, so a roll-forward relink is not the right recovery',
        true
      )
    }
    if (sha256(bytes) !== prepared.sha256)
    {
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'the retained candidate is not the exact prepared candidate',
        true
      )
    }
    const temp = this.statOrAbsent(prepared.tempCanonicalPath)
    const tempUsable =
      temp !== null &&
      temp.device === prepared.device &&
      temp.inode === prepared.inode &&
      sha256(this.readNoFollow(prepared.tempCanonicalPath, prepared)) ===
        prepared.sha256
    let temporaryRecreated = false
    if (!tempUsable)
    {
      this.inject('recover.beforeTempRecreate', 'relinkPrepared')
      this.recreateTemp(prepared, identity, bytes)
      temporaryRecreated = true
      this.inject('recover.afterTempRecreate', 'relinkPrepared')
    }
    this.inject('recover.beforeLink', 'relinkPrepared')
    try
    {
      linkSync(prepared.tempCanonicalPath, prepared.finalCanonicalPath)
      this.inject('recover.afterLink', 'relinkPrepared')
    }
    catch (error)
    {
      if (isExists(error))
      {
        // ! something appeared at the final name between the inspection & the
        // ! link; the existing name is never touched
        throw new EditPublicationError(
          'edit.publication_interference',
          'the output name appeared during recovery & is never replaced',
          true
        )
      }
      throw new EditPublicationError(
        'edit.recovery_required',
        'publication recovery link could not be created safely',
        true,
        error
      )
    }
    try
    {
      syncDirectory(identity.canonicalRealpath)
    }
    catch (error)
    {
      throw new EditPublicationError(
        'edit.recovery_required',
        'publication recovery durability could not be proven',
        true,
        error
      )
    }
    prepared.committed = true
    let info
    try
    {
      info = lstatSync(prepared.finalCanonicalPath, { bigint: true })
    }
    catch (error)
    {
      throw new EditPublicationError(
        'edit.recovery_required',
        'recovered publication identity could not be checked',
        true,
        error
      )
    }
    return Object.freeze({
      commit: Object.freeze({
        preparationId,
        finalCanonicalPath: prepared.finalCanonicalPath,
        linkCreated: true,
        directorySynced: true,
        device: info.dev.toString(),
        inode: info.ino.toString(),
        byteLength: Number(info.size),
      }),
      prepared: Object.freeze({ ...prepared, directory: identity }),
      temporaryRecreated,
    })
  }

  // the same discipline as prepare(): exclusive no-follow create, durable name
  // before any byte, fsync, then a size+hash readback
  private recreateTemp(
    prepared: Prepared,
    identity: DirectoryIdentity,
    bytes: Uint8Array
  ): void
  {
    const tempBasename = `.edit-publication-tmp-${randomBytes(16).toString('hex')}`
    const tempCanonicalPath = join(identity.canonicalRealpath, tempBasename)
    let descriptor: number | null = null
    try
    {
      descriptor = openSync(
        tempCanonicalPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      syncDirectory(identity.canonicalRealpath)
      writeFileSync(descriptor, bytes)
      fsyncSync(descriptor)
      const info = fstatSync(descriptor, { bigint: true })
      closeSync(descriptor)
      descriptor = null
      const readback = this.readNoFollow(tempCanonicalPath)
      if (
        readback.byteLength !== bytes.byteLength ||
        sha256(readback) !== prepared.sha256
      )
      {
        throw new EditPublicationError(
          'edit.export_proof_failed',
          'recreated temp did not read back at the exact size & hash',
          true
        )
      }
      prepared.tempBasename = tempBasename
      prepared.tempCanonicalPath = tempCanonicalPath
      prepared.device = info.dev.toString()
      prepared.inode = info.ino.toString()
      prepared.mode = (info.mode & 0o7777n).toString(8)
      prepared.released = false
    }
    catch (error)
    {
      if (descriptor !== null) closeSync(descriptor)
      try
      {
        unlinkSync(tempCanonicalPath)
      }
      catch
      {
        // the retained temp name stays the only cleanup authority
      }
      if (error instanceof EditPublicationError) throw error
      throw new EditPublicationError(
        'edit.recovery_required',
        'publication recovery temp could not be recreated safely',
        true,
        error
      )
    }
  }

  private statOrAbsent(
    path: string
  ): { device: string; inode: string; byteLength: number } | null
  {
    try
    {
      const info = lstatSync(path, { bigint: true })
      if (!info.isFile())
      {
        throw new EditPublicationError(
          'edit.publication_interference',
          'a proven publication name is not one regular file'
        )
      }
      return {
        device: info.dev.toString(),
        inode: info.ino.toString(),
        byteLength: Number(info.size),
      }
    }
    catch (error)
    {
      if (error instanceof EditPublicationError) throw error
      if (isMissing(error)) return null
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'a proven publication name could not be checked',
        false,
        error
      )
    }
  }

  private assertBasename(value: string): string
  {
    const byteLength = Buffer.byteLength(value, 'utf-8')
    if (
      byteLength < 5 ||
      byteLength > OUTPUT_BASENAME_MAXIMUM_BYTES ||
      !value.endsWith('.sb3') ||
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\') ||
      value.includes('\u0000') ||
      isAbsolute(value) ||
      basename(value) !== value
    )
    {
      throw new EditPublicationError(
        'edit.output_invalid',
        'output basename is not a contract-valid bounded .sb3 name'
      )
    }
    return value
  }

  private requirePrepared(preparationId: string): Prepared
  {
    const prepared = this.#prepared.get(preparationId)
    if (prepared === undefined)
    {
      throw new EditPublicationError(
        'edit.export_proof_failed',
        'no live publication preparation carries that identity'
      )
    }
    return prepared
  }

  // between operations the directory identity must still be the one probed at
  // construction; a change is detected & stops the transaction
  private assertDirectoryIdentity(): DirectoryIdentity
  {
    const observed = directoryIdentity(this.#directory)
    if (
      observed.canonicalRealpath !== this.#identity.canonicalRealpath ||
      observed.device !== this.#identity.device ||
      observed.inode !== this.#identity.inode ||
      observed.uid !== this.#identity.uid
    )
    {
      throw new EditPublicationError(
        'edit.publication_interference',
        'publication directory identity changed between operations'
      )
    }
    return observed
  }

  private readNoFollow(path: string, expect?: Prepared): Uint8Array
  {
    let descriptor: number
    try
    {
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    }
    catch (error)
    {
      throw new EditPublicationError(
        'edit.export_reopen_failed',
        'publication could not be reopened safely',
        false,
        error
      )
    }
    try
    {
      const info = fstatSync(descriptor, { bigint: true })
      if (!info.isFile())
      {
        throw new EditPublicationError(
          'edit.export_reopen_failed',
          'publication path is not one regular file'
        )
      }
      if (
        expect !== undefined &&
        (info.dev.toString() !== expect.device ||
          info.ino.toString() !== expect.inode)
      )
      {
        throw new EditPublicationError(
          'edit.publication_interference',
          'prepared name no longer resolves to the prepared inode'
        )
      }
      return Uint8Array.from(readFileSync(descriptor))
    }
    catch (error)
    {
      if (error instanceof EditPublicationError) throw error
      throw new EditPublicationError(
        'edit.export_reopen_failed',
        'publication contents could not be read safely',
        expect?.committed ?? false,
        error
      )
    }
    finally
    {
      closeSync(descriptor)
    }
  }

  private inject(point: EditPublicationFaultPoint, operation: string): void
  {
    this.#faultSequence += 1
    this.#faultHook?.(
      Object.freeze({ sequence: this.#faultSequence, point, operation })
    )
  }
}

// the edit domain receives only this narrow capability-probed surface
export function createEditPublicationPort(
  directory: string,
  options: EditPublicationRootOptions = {}
): EditPublicationDirectoryPort
{
  return new EditPublicationDirectoryPort(directory, options)
}

export async function createEditPublicationRecoveryPortV1(input: {
  readonly outputRoot: string
  readonly authority: Pick<
    EditPublicationRecoveryAuthorityV1,
    'publicationRootId' | 'publicationRootOwnershipSha256' | 'directory'
  >
}): Promise<EditPublicationRecoveryPortV1>
{
  if (!isAbsolute(input.outputRoot))
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication recovery output root must be absolute'
    )
  }
  let outputRoot: string
  try
  {
    outputRoot = realpathSync(resolve(input.outputRoot))
    if (!statSync(outputRoot).isDirectory()) throw new Error('not a directory')
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication recovery output root is unavailable'
    )
  }
  const leafName = input.authority.publicationRootId
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(leafName))
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication recovery root ID is not host-safe'
    )
  }
  const directory = join(outputRoot, leafName)
  let canonicalDirectory: string
  try
  {
    rejectSymlinkComponents(outputRoot, directory)
    canonicalDirectory = realpathSync(directory)
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication recovery directory is unavailable'
    )
  }
  if (
    !isPathWithinRootV1(outputRoot, canonicalDirectory) ||
    canonicalDirectory !== input.authority.directory.canonicalRealpath
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication recovery directory escaped or differs from retained authority'
    )
  }
  const port = new EditPublicationDirectoryPort(canonicalDirectory)
  const capability = await port.capability()
  if (
    !isEditPublicationCapabilityReadyV1(capability) ||
    capability.publicationRootOwnershipSha256 !==
      input.authority.publicationRootOwnershipSha256
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      'publication recovery root ownership differs from retained authority'
    )
  }
  return port
}
