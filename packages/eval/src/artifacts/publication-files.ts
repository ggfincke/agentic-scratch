// packages/eval/src/artifacts/publication-files.ts
// prove bounded no-replace filesystem publication independently of destination policy

import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

export interface PublicationDirectoryIdentityV1
{
  readonly canonicalRealpath: string
  readonly device: string
  readonly inode: string
  readonly mode: string
  readonly uid: string
}

export interface PublicationFileIdentityV1
{
  readonly device: string
  readonly inode: string
  readonly mode: string
  readonly byteLength: number
  readonly sha256: string
}

export interface PreparedPublicationFileV1 extends PublicationFileIdentityV1
{
  readonly schemaVersion: 1
  readonly directory: PublicationDirectoryIdentityV1
  readonly tempBasename: string
  readonly tempCanonicalPath: string
  readonly finalCanonicalPath: string
  readonly nameDurableBeforeWrite: true
  readonly fileSynced: true
  readonly readbackVerified: true
}

export const PUBLICATION_FILES_FAULT_POINTS_V1 = [
  'prepare.beforeTempOpen',
  'prepare.afterTempOpen',
  'prepare.afterNameDurable',
  'prepare.beforeWrite',
  'prepare.afterWrite',
  'prepare.beforeFileSync',
  'prepare.afterFileSync',
  'prepare.beforeReadback',
  'prepare.afterReadback',
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
] as const

export type PublicationFilesFaultPointV1 =
  (typeof PUBLICATION_FILES_FAULT_POINTS_V1)[number]

export interface PublicationFilesOptionsV1
{
  readonly hook?: (point: PublicationFilesFaultPointV1) => void
}

export class PublicationFilesystemErrorV1 extends Error
{
  constructor(
    readonly code:
      | 'publication.invalid'
      | 'publication.exists'
      | 'publication.interference'
      | 'publication.io'
      | 'publication.proof',
    readonly phase: string,
    message: string,
    readonly linkCreated = false,
    cause?: unknown
  )
  {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'PublicationFilesystemErrorV1'
  }
}

function hash(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function errno(error: unknown, code: string): boolean
{
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function validBasename(value: string): boolean
{
  return (
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= 255 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    basename(value) === value &&
    !isAbsolute(value)
  )
}

export function publicationDirectoryIdentityV1(
  path: string
): PublicationDirectoryIdentityV1
{
  let info
  try
  {
    info = lstatSync(path, { bigint: true })
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.invalid',
      'directory.stat',
      'publication directory identity could not be checked',
      false,
      cause
    )
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new PublicationFilesystemErrorV1(
      'publication.invalid',
      'directory.kind',
      'publication directory must be a real directory'
    )
  let canonicalRealpath: string
  try
  {
    canonicalRealpath = realpathSync(path)
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.invalid',
      'directory.realpath',
      'publication directory identity could not be resolved',
      false,
      cause
    )
  }
  return Object.freeze({
    canonicalRealpath,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mode: (info.mode & 0o7777n).toString(8),
    uid: info.uid.toString(),
  })
}

export function assertPublicationDirectoryIdentityV1(
  expected: PublicationDirectoryIdentityV1
): PublicationDirectoryIdentityV1
{
  const observed = publicationDirectoryIdentityV1(expected.canonicalRealpath)
  if (
    observed.canonicalRealpath !== expected.canonicalRealpath ||
    observed.device !== expected.device ||
    observed.inode !== expected.inode ||
    observed.mode !== expected.mode ||
    observed.uid !== expected.uid
  )
    throw new PublicationFilesystemErrorV1(
      'publication.interference',
      'directory.identity',
      'publication directory identity changed between operations'
    )
  return observed
}

export function syncPublicationDirectoryV1(path: string): void
{
  let descriptor: number
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'directory.open',
      'publication directory could not be opened for durability proof',
      false,
      cause
    )
  }
  try
  {
    fsyncSync(descriptor)
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'directory.sync',
      'publication directory durability could not be proven',
      false,
      cause
    )
  }
  finally
  {
    closeSync(descriptor)
  }
}

function validateProof(proof: PreparedPublicationFileV1): void
{
  if (
    proof.schemaVersion !== 1 ||
    !validBasename(proof.tempBasename) ||
    !validBasename(basename(proof.finalCanonicalPath)) ||
    proof.tempCanonicalPath === proof.finalCanonicalPath ||
    proof.tempCanonicalPath !==
      join(proof.directory.canonicalRealpath, proof.tempBasename) ||
    dirname(proof.finalCanonicalPath) !== proof.directory.canonicalRealpath ||
    !/^[a-f0-9]{64}$/u.test(proof.sha256) ||
    !Number.isSafeInteger(proof.byteLength) ||
    proof.byteLength < 0 ||
    !/^[0-9]+$/u.test(proof.device) ||
    !/^[0-9]+$/u.test(proof.inode) ||
    !/^[0-7]{3,4}$/u.test(proof.mode) ||
    !proof.nameDurableBeforeWrite ||
    !proof.fileSynced ||
    !proof.readbackVerified
  )
    throw new PublicationFilesystemErrorV1(
      'publication.invalid',
      'proof.validate',
      'publication proof is not one bounded prepared file'
    )
}

function statOrAbsent(path: string): {
  device: string
  inode: string
  byteLength: number
} | null
{
  try
  {
    const info = lstatSync(path, { bigint: true })
    if (!info.isFile() || info.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new PublicationFilesystemErrorV1(
        'publication.interference',
        'file.kind',
        'a proven publication name is not one bounded regular file'
      )
    return {
      device: info.dev.toString(),
      inode: info.ino.toString(),
      byteLength: Number(info.size),
    }
  }
  catch (cause)
  {
    if (errno(cause, 'ENOENT')) return null
    if (cause instanceof PublicationFilesystemErrorV1) throw cause
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'file.stat',
      'a proven publication name could not be checked',
      false,
      cause
    )
  }
}

export function readPublicationFileV1(
  path: string,
  maxBytes: number,
  expected?: Pick<PublicationFileIdentityV1, 'device' | 'inode'>,
  afterOpen?: () => void
): PublicationFileIdentityV1 & { readonly bytes: Uint8Array }
{
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new PublicationFilesystemErrorV1(
      'publication.invalid',
      'file.budget',
      'publication byte ceiling must be a nonnegative safe integer'
    )
  let descriptor: number
  try
  {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'file.open',
      'publication could not be reopened safely',
      false,
      cause
    )
  }
  try
  {
    const info = fstatSync(descriptor, { bigint: true })
    afterOpen?.()
    if (!info.isFile())
      throw new PublicationFilesystemErrorV1(
        'publication.interference',
        'file.kind',
        'publication path is not one regular file'
      )
    if (info.size > BigInt(maxBytes))
      throw new PublicationFilesystemErrorV1(
        'publication.proof',
        'file.budget',
        'publication contents exceed the configured byte ceiling'
      )
    if (
      expected !== undefined &&
      (info.dev.toString() !== expected.device ||
        info.ino.toString() !== expected.inode)
    )
      throw new PublicationFilesystemErrorV1(
        'publication.interference',
        'file.identity',
        'prepared name no longer resolves to the prepared inode'
      )
    const buffer = Buffer.alloc(Number(info.size) + 1)
    let count = 0
    while (count < buffer.byteLength)
    {
      const read = readSync(
        descriptor,
        buffer,
        count,
        buffer.byteLength - count,
        count
      )
      if (read === 0) break
      count += read
    }
    const after = fstatSync(descriptor, { bigint: true })
    const entry = lstatSync(path, { bigint: true })
    if (
      count !== Number(info.size) ||
      after.size !== info.size ||
      after.mtimeNs !== info.mtimeNs ||
      after.ctimeNs !== info.ctimeNs ||
      entry.dev !== info.dev ||
      entry.ino !== info.ino ||
      !entry.isFile()
    )
      throw new PublicationFilesystemErrorV1(
        'publication.interference',
        'file.identity',
        'publication file changed during bounded readback'
      )
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, count)
    return {
      device: info.dev.toString(),
      inode: info.ino.toString(),
      mode: (info.mode & 0o7777n).toString(8),
      byteLength: count,
      sha256: hash(bytes),
      bytes,
    }
  }
  catch (cause)
  {
    if (cause instanceof PublicationFilesystemErrorV1) throw cause
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'file.read',
      'publication contents could not be read safely',
      false,
      cause
    )
  }
  finally
  {
    closeSync(descriptor)
  }
}

export function preparePublicationFileV1(input: {
  readonly directory: PublicationDirectoryIdentityV1
  readonly finalBasename: string
  readonly tempBasename: string
  readonly bytes: Uint8Array
  readonly expectedSha256: string
  readonly maxBytes: number
  readonly hook?: PublicationFilesOptionsV1['hook']
}): PreparedPublicationFileV1
{
  const directory = assertPublicationDirectoryIdentityV1(input.directory)
  if (
    !validBasename(input.finalBasename) ||
    !validBasename(input.tempBasename) ||
    input.tempBasename === input.finalBasename ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 0 ||
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength > input.maxBytes ||
    hash(input.bytes) !== input.expectedSha256
  )
    throw new PublicationFilesystemErrorV1(
      'publication.invalid',
      'prepare.validate',
      'publication candidate or prepared names differ from their bounded proof'
    )
  const tempCanonicalPath = join(
    directory.canonicalRealpath,
    input.tempBasename
  )
  let descriptor: number | null = null
  let created: { device: string; inode: string } | null = null
  try
  {
    input.hook?.('prepare.beforeTempOpen')
    descriptor = openSync(
      tempCanonicalPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    const info = fstatSync(descriptor, { bigint: true })
    created = { device: info.dev.toString(), inode: info.ino.toString() }
    input.hook?.('prepare.afterTempOpen')
    syncPublicationDirectoryV1(directory.canonicalRealpath)
    input.hook?.('prepare.afterNameDurable')
    input.hook?.('prepare.beforeWrite')
    writeFileSync(descriptor, input.bytes)
    input.hook?.('prepare.afterWrite')
    input.hook?.('prepare.beforeFileSync')
    fsyncSync(descriptor)
    input.hook?.('prepare.afterFileSync')
    closeSync(descriptor)
    descriptor = null
    input.hook?.('prepare.beforeReadback')
    const readback = readPublicationFileV1(
      tempCanonicalPath,
      input.maxBytes,
      created
    )
    if (
      readback.byteLength !== input.bytes.byteLength ||
      readback.sha256 !== input.expectedSha256
    )
      throw new PublicationFilesystemErrorV1(
        'publication.proof',
        'prepare.readback',
        'prepared bytes did not read back at the exact size & hash'
      )
    input.hook?.('prepare.afterReadback')
    return Object.freeze({
      schemaVersion: 1,
      directory,
      tempBasename: input.tempBasename,
      tempCanonicalPath,
      finalCanonicalPath: join(
        directory.canonicalRealpath,
        input.finalBasename
      ),
      device: readback.device,
      inode: readback.inode,
      mode: readback.mode,
      byteLength: readback.byteLength,
      sha256: readback.sha256,
      nameDurableBeforeWrite: true,
      fileSynced: true,
      readbackVerified: true,
    })
  }
  catch (cause)
  {
    if (descriptor !== null) closeSync(descriptor)
    if (created !== null)
    {
      try
      {
        const observed = statOrAbsent(tempCanonicalPath)
        if (
          observed?.device === created.device &&
          observed.inode === created.inode
        )
        {
          unlinkSync(tempCanonicalPath)
          syncPublicationDirectoryV1(directory.canonicalRealpath)
        }
      }
      catch
      {
        // the caller retains the prepared name as its cleanup authority
      }
    }
    if (cause instanceof PublicationFilesystemErrorV1) throw cause
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'prepare.write',
      'prepared publication could not be written safely',
      false,
      cause
    )
  }
}

export function commitPreparedPublicationV1(
  proof: PreparedPublicationFileV1,
  options: PublicationFilesOptionsV1 = {}
): {
  readonly finalCanonicalPath: string
  readonly linkCreated: true
  readonly directorySynced: true
  readonly device: string
  readonly inode: string
  readonly byteLength: number
}
{
  validateProof(proof)
  assertPublicationDirectoryIdentityV1(proof.directory)
  options.hook?.('commit.beforeLink')
  const candidate = readPublicationFileV1(
    proof.tempCanonicalPath,
    proof.byteLength,
    proof
  )
  if (
    candidate.byteLength !== proof.byteLength ||
    candidate.sha256 !== proof.sha256 ||
    candidate.mode !== proof.mode
  )
    throw new PublicationFilesystemErrorV1(
      'publication.interference',
      'commit.identity',
      'prepared temporary changed before publication'
    )
  try
  {
    linkSync(proof.tempCanonicalPath, proof.finalCanonicalPath)
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      errno(cause, 'EEXIST') ? 'publication.exists' : 'publication.io',
      'commit.link',
      'publication link could not be created safely without replacing a name',
      false,
      cause
    )
  }
  try
  {
    options.hook?.('commit.afterLink')
    options.hook?.('commit.beforeDirectorySync')
    syncPublicationDirectoryV1(proof.directory.canonicalRealpath)
    options.hook?.('commit.afterDirectorySync')
    const info = statOrAbsent(proof.finalCanonicalPath)
    if (
      info === null ||
      info.device !== proof.device ||
      info.inode !== proof.inode ||
      info.byteLength !== proof.byteLength
    )
      throw new Error('committed file identity differs from prepared proof')
    return Object.freeze({
      finalCanonicalPath: proof.finalCanonicalPath,
      linkCreated: true,
      directorySynced: true,
      ...info,
    })
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'commit.durability',
      'publication did not prove the durable commit point after link creation',
      true,
      cause
    )
  }
}

export function verifyCommittedPublicationV1(
  proof: PreparedPublicationFileV1,
  options: PublicationFilesOptionsV1 & { readonly maxBytes?: number } = {}
): PublicationFileIdentityV1 & {
  readonly finalCanonicalPath: string
  readonly bytes: Uint8Array
  readonly matchesPreparedIdentity: true
}
{
  validateProof(proof)
  assertPublicationDirectoryIdentityV1(proof.directory)
  options.hook?.('verify.beforeOpen')
  try
  {
    const result = readPublicationFileV1(
      proof.finalCanonicalPath,
      options.maxBytes ?? proof.byteLength,
      proof,
      () => options.hook?.('verify.afterOpen')
    )
    if (
      result.byteLength !== proof.byteLength ||
      result.sha256 !== proof.sha256 ||
      result.mode !== proof.mode
    )
      throw new PublicationFilesystemErrorV1(
        'publication.interference',
        'verify.identity',
        'committed output identity does not match the retained temp proof',
        true
      )
    options.hook?.('verify.afterIdentityCheck')
    return Object.freeze({
      ...result,
      finalCanonicalPath: proof.finalCanonicalPath,
      matchesPreparedIdentity: true,
    })
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      cause instanceof PublicationFilesystemErrorV1
        ? cause.code
        : 'publication.io',
      cause instanceof PublicationFilesystemErrorV1
        ? cause.phase
        : 'verify.read',
      'committed publication could not be verified safely',
      true,
      cause
    )
  }
}

export function inspectPreparedPublicationV1(
  proof: PreparedPublicationFileV1,
  options: { readonly maxBytes?: number } = {}
): {
  readonly tempPresent: boolean
  readonly tempMatchesProof: boolean
  readonly finalPresent: boolean
  readonly finalMatchesProof: boolean
  readonly finalDevice: string | null
  readonly finalInode: string | null
  readonly finalByteLength: number | null
}
{
  validateProof(proof)
  assertPublicationDirectoryIdentityV1(proof.directory)
  const temp = statOrAbsent(proof.tempCanonicalPath)
  const final = statOrAbsent(proof.finalCanonicalPath)
  const matches = (path: string, info: typeof temp): boolean =>
  {
    if (
      info === null ||
      info.device !== proof.device ||
      info.inode !== proof.inode ||
      info.byteLength !== proof.byteLength
    )
      return false
    const read = readPublicationFileV1(
      path,
      options.maxBytes ?? proof.byteLength,
      proof
    )
    return read.sha256 === proof.sha256 && read.mode === proof.mode
  }
  return Object.freeze({
    tempPresent: temp !== null,
    tempMatchesProof: matches(proof.tempCanonicalPath, temp),
    finalPresent: final !== null,
    finalMatchesProof: matches(proof.finalCanonicalPath, final),
    finalDevice: final?.device ?? null,
    finalInode: final?.inode ?? null,
    finalByteLength: final?.byteLength ?? null,
  })
}

export function releasePreparedPublicationV1(
  proof: PreparedPublicationFileV1,
  options: PublicationFilesOptionsV1 = {}
): void
{
  validateProof(proof)
  assertPublicationDirectoryIdentityV1(proof.directory)
  options.hook?.('release.beforeUnlink')
  try
  {
    const info = statOrAbsent(proof.tempCanonicalPath)
    if (info !== null)
    {
      if (info.device !== proof.device || info.inode !== proof.inode)
        throw new PublicationFilesystemErrorV1(
          'publication.interference',
          'release.identity',
          'proven temp name no longer resolves to the prepared inode'
        )
      unlinkSync(proof.tempCanonicalPath)
    }
  }
  catch (cause)
  {
    if (cause instanceof PublicationFilesystemErrorV1) throw cause
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'release.unlink',
      'publication temp cleanup could not be proven',
      false,
      cause
    )
  }
  options.hook?.('release.afterUnlink')
  try
  {
    syncPublicationDirectoryV1(proof.directory.canonicalRealpath)
  }
  catch (cause)
  {
    throw new PublicationFilesystemErrorV1(
      'publication.io',
      'release.durability',
      'publication temp cleanup durability could not be proven',
      false,
      cause
    )
  }
  options.hook?.('release.afterDirectorySync')
}
