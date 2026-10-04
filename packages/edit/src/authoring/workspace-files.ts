// packages/edit/src/authoring/workspace-files.ts
// bounded no-follow reads & no-replace publication inside operator roots

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import {
  isPathWithinRootV1,
  publicationDirectoryIdentityV1,
  readPublicationFileV1,
  syncPublicationDirectoryV1,
  type PreparedPublicationFileV1,
  type PublicationDirectoryIdentityV1,
} from '@scratch-agent/eval'
import { scanStrictJson } from '@scratch-agent/sb3'

import { AuthoringWorkspaceErrorV1 } from './workspace-types.js'

export function authoringBytesSha256V1(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

export async function authoringDirectoryV1(path: string): Promise<string>
{
  if (!isAbsolute(path))
    throw new AuthoringWorkspaceErrorV1(
      'authoring.invalid_permissions',
      'operator roots must be absolute paths'
    )
  const canonical = await realpath(path)
  const info = await lstat(canonical)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new AuthoringWorkspaceErrorV1(
      'authoring.invalid_permissions',
      'operator roots must resolve to real directories'
    )
  return canonical
}

export async function authoringPrivateParentV1(path: string): Promise<string>
{
  await mkdir(path, { recursive: true, mode: 0o700 })
  return authoringDirectoryV1(resolve(path))
}

export async function authoringPotentialDirectoryV2(
  path: string
): Promise<string>
{
  if (!isAbsolute(path))
    throw new AuthoringWorkspaceErrorV1(
      'authoring.invalid_permissions',
      'operator roots must be absolute paths'
    )
  try
  {
    return await authoringDirectoryV1(path)
  }
  catch (error)
  {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error
    return join(
      await authoringPotentialDirectoryV2(dirname(path)),
      basename(path)
    )
  }
}

export async function authoringExistingParentV2(path: string): Promise<string>
{
  try
  {
    return await authoringDirectoryV1(path)
  }
  catch (error)
  {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error
    return authoringExistingParentV2(dirname(path))
  }
}

export async function authoringReadSourceV1(
  path: string,
  roots: readonly string[],
  evidenceRoot: string,
  maximumBytes: number
): Promise<{ bytes: Uint8Array; canonicalPath: string; sha256: string }>
{
  return readAllowedFile(path, roots, maximumBytes, evidenceRoot)
}

export async function authoringReadEvidenceV1(
  path: string,
  root: string,
  maximumBytes: number
): Promise<{ bytes: Uint8Array; canonicalPath: string; sha256: string }>
{
  return readAllowedFile(path, [root], maximumBytes, null)
}

async function readAllowedFile(
  path: string,
  roots: readonly string[],
  maximumBytes: number,
  forbiddenRoot: string | null
): Promise<{ bytes: Uint8Array; canonicalPath: string; sha256: string }>
{
  const canonicalPath = await realpath(path)
  if (
    !roots.some((root) => isPathWithinRootV1(root, canonicalPath)) ||
    (forbiddenRoot !== null && isPathWithinRootV1(forbiddenRoot, canonicalPath))
  )
    throw new AuthoringWorkspaceErrorV1(
      'authoring.source_outside_permissions',
      'workspace sources must be inside an operator source root & outside private evidence'
    )
  const descriptor = await open(
    canonicalPath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  )
  try
  {
    const before = await descriptor.stat()
    if (!before.isFile() || before.size > maximumBytes)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.source_budget_exceeded',
        `source must be one regular file at most ${maximumBytes} bytes`
      )
    const buffer = Buffer.allocUnsafe(before.size + 1)
    let length = 0
    while (length < buffer.byteLength)
    {
      const read = await descriptor.read(
        buffer,
        length,
        buffer.byteLength - length,
        length
      )
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    const after = await descriptor.stat()
    const currentPath = await realpath(path)
    const currentEntry = await lstat(canonicalPath)
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      length !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      canonicalPath !== currentPath ||
      currentEntry.dev !== before.dev ||
      currentEntry.ino !== before.ino ||
      !currentEntry.isFile() ||
      currentEntry.isSymbolicLink()
    )
      throw new AuthoringWorkspaceErrorV1(
        'authoring.source_changed',
        'source identity changed while it was read'
      )
    const bytes = buffer.subarray(0, length)
    return { bytes, canonicalPath, sha256: authoringBytesSha256V1(bytes) }
  }
  finally
  {
    await descriptor.close()
  }
}

export function authoringParseJsonV1(bytes: Uint8Array): unknown
{
  return scanStrictJson(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    {
      maxDepth: 128,
      maxMembersPerContainer: 100000,
      maxNodes: 2000000,
    }
  ).value
}

export async function authoringResolvePublicationV2(
  destinationPath: string,
  outputRoots: readonly string[],
  evidenceRoot: string,
  allowExisting = false
)
{
  if (!isAbsolute(destinationPath) || !destinationPath.endsWith('.sb3'))
    throw new AuthoringWorkspaceErrorV1(
      'authoring.invalid_destination',
      'export requires an absolute new .sb3 destination'
    )
  const parent = await authoringDirectoryV1(dirname(destinationPath))
  const path = join(parent, basename(destinationPath))
  if (
    !outputRoots.some((root) => isPathWithinRootV1(root, path)) ||
    isPathWithinRootV1(evidenceRoot, path)
  )
    throw new AuthoringWorkspaceErrorV1(
      'authoring.output_outside_permissions',
      'export destination is outside operator output roots or inside private evidence'
    )
  if (!allowExisting)
  {
    try
    {
      await lstat(path)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.destination_exists',
        'export destination already exists; publication never replaces it'
      )
    }
    catch (error)
    {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error
    }
  }
  return {
    path,
    finalBasename: basename(path),
    directory: publicationDirectoryIdentityV1(parent),
  }
}

export async function authoringRecoverPreparationV2(input: {
  directory: PublicationDirectoryIdentityV1
  finalBasename: string
  tempBasename: string
  sha256: string
  byteLength: number
}): Promise<PreparedPublicationFileV1 | null>
{
  const path = join(input.directory.canonicalRealpath, input.tempBasename)
  let actual: ReturnType<typeof readPublicationFileV1>
  try
  {
    actual = readPublicationFileV1(path, input.byteLength)
  }
  catch (error)
  {
    if (
      typeof error === 'object' &&
      error !== null &&
      'cause' in error &&
      typeof error.cause === 'object' &&
      error.cause !== null &&
      'code' in error.cause &&
      error.cause.code === 'ENOENT'
    )
      return null
    throw error
  }
  if (actual.sha256 !== input.sha256 || actual.byteLength !== input.byteLength)
    throw new AuthoringWorkspaceErrorV1(
      'authoring.publication_interference',
      'intent temporary differs from the retained exact candidate'
    )
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try
  {
    const info = await descriptor.stat({ bigint: true })
    if (
      info.dev.toString() !== actual.device ||
      info.ino.toString() !== actual.inode
    )
      throw new AuthoringWorkspaceErrorV1(
        'authoring.publication_interference',
        'intent temporary changed before recovery sync'
      )
    await descriptor.sync()
  }
  finally
  {
    await descriptor.close()
  }
  syncPublicationDirectoryV1(input.directory.canonicalRealpath)
  return {
    schemaVersion: 1,
    directory: input.directory,
    tempBasename: input.tempBasename,
    tempCanonicalPath: path,
    finalCanonicalPath: join(
      input.directory.canonicalRealpath,
      input.finalBasename
    ),
    device: actual.device,
    inode: actual.inode,
    mode: actual.mode,
    byteLength: actual.byteLength,
    sha256: actual.sha256,
    nameDurableBeforeWrite: true,
    fileSynced: true,
    readbackVerified: true,
  }
}
