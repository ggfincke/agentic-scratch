// packages/eval/src/artifacts/native-root-lock.ts
// coordinate writable artifact jobs w/ lazy native directory locks

import { AsyncLocalStorage } from 'node:async_hooks'
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statfsSync,
} from 'node:fs'
import { createRequire } from 'node:module'

export const NATIVE_ARTIFACT_LOCK_POLICY_V1 = Object.freeze({
  identity: 'native-artifact-root-lock-v1',
  dependency: 'fs-ext',
  version: '2.1.1',
  acquisition: 'flock-directory-exclusive-nonblocking',
  filesystem: 'local-mount-with-native-lock-capability',
  release: 'owner-finally-or-kernel-process-exit',
  nested: 'same-adapter-active-invocation-lease',
  platforms: Object.freeze(['darwin', 'linux']),
  linuxLocalFilesystemTypes: Object.freeze([
    0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x858458f6, 0x794c7630,
    0xca451a4e, 0xf2f52010,
  ]),
})

export class NativeArtifactLockErrorV1 extends Error
{
  constructor(
    readonly code: 'lock-busy' | 'lock-unavailable' | 'lock-path-changed',
    message: string,
    options?: ErrorOptions
  )
  {
    super(message, options)
    this.name = 'NativeArtifactLockErrorV1'
  }
}

interface NativeLockApi
{
  flockSync(fd: number, flags: 'exnb' | 'un'): void
}

interface RootLease
{
  root: string
  owner: object
  descriptor: number
  device: number
  inode: number
  active: boolean
  release(): void
}

const require = createRequire(import.meta.url)
const context = new AsyncLocalStorage<ReadonlyMap<string, RootLease>>()
let nativeApi: NativeLockApi | undefined

export function assertNativeArtifactLockCapabilityV1(directory?: string): void
{
  if (process.platform !== 'darwin' && process.platform !== 'linux')
    throw new NativeArtifactLockErrorV1(
      'lock-unavailable',
      'writable authoring requires native locks on local macOS or Linux'
    )
  if (!nativeApi)
    try
    {
      const metadata = require('fs-ext/package.json') as { version?: unknown }
      if (metadata.version !== NATIVE_ARTIFACT_LOCK_POLICY_V1.version)
        throw new Error('native locking dependency differs from its exact pin')
      const loaded = require('fs-ext') as Partial<NativeLockApi>
      if (typeof loaded.flockSync !== 'function')
        throw new Error('native flockSync capability is absent')
      nativeApi = loaded as NativeLockApi
    }
    catch (cause)
    {
      throw new NativeArtifactLockErrorV1(
        'lock-unavailable',
        'writable authoring requires the project native dependency fs-ext@2.1.1; read-only inspection remains available',
        { cause }
      )
    }
  if (directory !== undefined)
  {
    const probe = acquire(directory)
    probe.release()
  }
}

export function assertNativeArtifactFilesystemV1(root: string): void
{
  assertNativeArtifactLockCapabilityV1()
  let local: boolean
  if (process.platform === 'linux')
  {
    const type = Number(statfsSync(root).type) >>> 0
    local =
      NATIVE_ARTIFACT_LOCK_POLICY_V1.linuxLocalFilesystemTypes.includes(type)
  }
  else
  {
    const canonical = realpathSync(root)
    let output: string
    try
    {
      output = execFileSync('/sbin/mount', [], {
        encoding: 'utf8',
        timeout: 1000,
        maxBuffer: 1024 * 1024,
      })
    }
    catch (cause)
    {
      throw new NativeArtifactLockErrorV1(
        'lock-unavailable',
        'local filesystem identity could not be established for native locking',
        { cause }
      )
    }
    const mounts = output
      .split('\n')
      .flatMap((line) =>
      {
        const match = /^.+ on (.+) \(([^\n]*)\)$/u.exec(line)
        if (!match) return []
        const path = match[1]!
        return canonical === path ||
          canonical.startsWith(path === '/' ? '/' : `${path}/`)
          ? [{ path, local: match[2]!.split(', ').includes('local') }]
          : []
      })
      .sort((a, b) => b.path.length - a.path.length)
    local = mounts[0]?.local === true
  }
  if (!local)
    throw new NativeArtifactLockErrorV1(
      'lock-unavailable',
      'writable authoring requires a lock-capable local filesystem'
    )
}

function assertLeaseIdentity(lease: RootLease): void
{
  const info = lstatSync(lease.root)
  if (
    !lease.active ||
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.dev !== lease.device ||
    info.ino !== lease.inode
  )
    throw new NativeArtifactLockErrorV1(
      'lock-path-changed',
      'native artifact root differs from the locked directory identity'
    )
}

function acquire(
  rootPath: string,
  owner?: object
): { lease: RootLease; release(): void }
{
  const root = realpathSync(rootPath)
  const current = context.getStore()?.get(root)
  if (current?.active && (owner === undefined || current.owner === owner))
  {
    assertLeaseIdentity(current)
    return { lease: current, release()
    {} }
  }
  assertNativeArtifactFilesystemV1(rootPath)
  const descriptor = openSync(
    rootPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  let locked = false
  try
  {
    const info = fstatSync(descriptor)
    const entry = lstatSync(root)
    if (
      !info.isDirectory() ||
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      info.dev !== entry.dev ||
      info.ino !== entry.ino
    )
      throw new NativeArtifactLockErrorV1(
        'lock-path-changed',
        'native artifact lock requires one stable real directory'
      )
    nativeApi!.flockSync(descriptor, 'exnb')
    locked = true
    const lease: RootLease = {
      root,
      owner: owner ?? {},
      descriptor,
      device: info.dev,
      inode: info.ino,
      active: true,
      release()
      {
        if (!lease.active) return
        lease.active = false
        try
        {
          nativeApi!.flockSync(descriptor, 'un')
        }
        finally
        {
          closeSync(descriptor)
        }
      },
    }
    assertLeaseIdentity(lease)
    return { lease, release: () => lease.release() }
  }
  catch (cause)
  {
    try
    {
      if (locked) nativeApi!.flockSync(descriptor, 'un')
    }
    finally
    {
      closeSync(descriptor)
    }
    if (cause instanceof NativeArtifactLockErrorV1) throw cause
    const code = (cause as NodeJS.ErrnoException).code
    throw new NativeArtifactLockErrorV1(
      code === 'EAGAIN' || code === 'EWOULDBLOCK'
        ? 'lock-busy'
        : 'lock-unavailable',
      code === 'EAGAIN' || code === 'EWOULDBLOCK'
        ? 'another authoring process owns the artifact root lock'
        : 'native artifact root locking capability is unavailable',
      { cause }
    )
  }
}

// constructor initialization holds a synchronous lease before owner rotation
export function acquireNativeArtifactRootLeaseV1(
  root: string,
  owner?: object
): {
  release(): void
}
{
  return acquire(root, owner)
}

export function withNativeArtifactRootLeaseV1<T>(
  root: string,
  operation: () => T,
  owner?: object
): T
{
  const acquired = acquire(root, owner)
  const lease = acquired.lease
  const leases = new Map(context.getStore())
  leases.set(lease.root, lease)
  let result: T
  try
  {
    result = context.run(leases, operation)
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof (result as { then?: unknown }).then === 'function'
    )
      return Promise.resolve(result).finally(() => acquired.release()) as T
  }
  catch (error)
  {
    acquired.release()
    throw error
  }
  acquired.release()
  return result
}
