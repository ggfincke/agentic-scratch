// scripts/lib/private-fs.ts
// provides bounded no-follow reads plus private directory & file primitives

import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export type BoundedFileReadFailure =
  'unavailable' | 'not-regular' | 'too-large' | 'changed'

export class BoundedFileReadError extends Error
{
  readonly failure: BoundedFileReadFailure

  constructor(failure: BoundedFileReadFailure, message: string)
  {
    super(message)
    this.name = 'BoundedFileReadError'
    this.failure = failure
  }
}

function readError(
  failure: BoundedFileReadFailure,
  label: string,
  message: string
): BoundedFileReadError
{
  return new BoundedFileReadError(failure, `${label} ${message}`)
}

export function ensurePrivateDirectory(path: string): void
{
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

export function createPrivateDirectoryExclusive(path: string): void
{
  mkdirSync(path, { recursive: false, mode: 0o700 })
  chmodSync(path, 0o700)
}

export function writeExclusivePrivateFile(
  path: string,
  value: Uint8Array | string
): void
{
  writeFileSync(path, value, { flag: 'wx', mode: 0o600 })
  chmodSync(path, 0o600)
}

export function resolveContainedPath(
  root: string,
  relativePath: string
): string
{
  if (isAbsolute(relativePath))
    throw new Error('contained path must be relative')
  const resolvedRoot = resolve(root)
  const path = resolve(resolvedRoot, relativePath)
  const fromRoot = relative(resolvedRoot, path)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`))
    throw new Error('contained path escapes its root')
  return path
}

export function assertNoSymlinkPath(root: string, relativePath: string): void
{
  const resolvedRoot = resolve(root)
  const path = resolveContainedPath(resolvedRoot, relativePath)
  const fromRoot = relative(resolvedRoot, path)
  let current = resolvedRoot
  const rootStat = lstatSync(current)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('artifact root must be one non-symlink directory')
  for (const part of fromRoot.split(sep).filter(Boolean))
  {
    current = resolve(current, part)
    const stat = lstatSync(current)
    if (stat.isSymbolicLink())
      throw new Error(`artifact path contains a symlink: ${relativePath}`)
  }
}

export function readBoundedRegularFileNoFollow(
  path: string,
  maximumBytes: number,
  label: string
): Uint8Array
{
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw readError('unavailable', label, 'byte limit is invalid')

  let descriptor: number
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  }
  catch (error)
  {
    const failure =
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ELOOP' || error.code === 'EISDIR')
        ? 'not-regular'
        : 'unavailable'
    throw readError(
      failure,
      label,
      'could not be opened as one bounded regular file'
    )
  }

  try
  {
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile())
      throw readError('not-regular', label, 'must be one regular file')
    if (before.size > BigInt(maximumBytes))
      throw readError('too-large', label, `exceeds ${maximumBytes} bytes`)

    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.byteLength)
    {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        null
      )
      if (count === 0) break
      offset += count
    }
    if (offset !== bytes.byteLength)
      throw readError('changed', label, 'changed while it was read')

    const after = fstatSync(descriptor, { bigint: true })
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw readError('changed', label, 'changed while it was read')
    return bytes
  }
  catch (error)
  {
    if (error instanceof BoundedFileReadError) throw error
    throw readError(
      'unavailable',
      label,
      'could not be read as one bounded file'
    )
  }
  finally
  {
    closeSync(descriptor)
  }
}

export function readContainedRegularFile(
  root: string,
  relativePath: string,
  maximumBytes: number,
  label: string
): Uint8Array
{
  assertNoSymlinkPath(root, relativePath)
  return readBoundedRegularFileNoFollow(
    resolveContainedPath(root, relativePath),
    maximumBytes,
    label
  )
}
