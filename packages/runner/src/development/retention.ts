// packages/runner/src/development/retention.ts
// bounded immutable development evidence inside an operator-owned private directory

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import { scanStrictJson } from '@scratch-agent/sb3'
import {
  DEVELOPMENT_LIMITS_V1,
  DevelopmentErrorV1,
  type DevelopmentArtifactRefV1,
  type DevelopmentLimitsV1,
} from './types.js'

export const DEVELOPMENT_STATUS_BYTES_V2 = 512 * 1024
const TERMINAL_SLOTS = 3
const CATALOG_LIMITS = [
  'maxRetainedBytes',
  'maxRetainedArtifacts',
  'maxEvidenceBytes',
  'maxEvidenceArtifacts',
  'maxTraceBytes',
] as const
type CatalogLimitsV2 = Pick<
  DevelopmentLimitsV1,
  (typeof CATALOG_LIMITS)[number]
>
interface TerminalReservationV2
{
  readonly slots: 3
  readonly bytes: number
  readonly state: 'reserved' | 'committed'
  readonly checkpointKey: string | null
}
interface RetentionPolicyV2
{
  readonly identity: 'development-terminal-reservation-v2'
  readonly limits: CatalogLimitsV2
}
interface RetentionEntryV1
{
  readonly key: string
  readonly bytes: Uint8Array
  readonly mimeType: string
}

export function developmentTerminalReserveBytesV2(
  maxTraceBytes: number
): number
{
  return 2 * maxTraceBytes + 2 * DEVELOPMENT_STATUS_BYTES_V2
}

function catalogPolicy(limits: DevelopmentLimitsV1): RetentionPolicyV2
{
  return {
    identity: 'development-terminal-reservation-v2',
    limits: Object.fromEntries(
      CATALOG_LIMITS.map((key) => [key, limits[key]])
    ) as CatalogLimitsV2,
  }
}

export function developmentSha256V1(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

export function developmentJsonBytesV1(value: unknown): Uint8Array
{
  return Buffer.from(JSON.stringify(value), 'utf8')
}

export function developmentWithinRootV1(root: string, path: string): boolean
{
  const rel = relative(root, path)
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  )
}

export async function developmentDirectoryV1(path: string): Promise<string>
{
  if (!isAbsolute(path))
    throw new DevelopmentErrorV1(
      'development.invalid_permissions',
      'operator roots must be absolute'
    )
  const canonical = await realpath(path)
  if (!(await lstat(canonical)).isDirectory())
    throw new DevelopmentErrorV1(
      'development.invalid_permissions',
      'operator roots must be directories'
    )
  return canonical
}

export async function developmentReadSourceV1(
  path: string,
  roots: readonly string[],
  evidenceRoot: string,
  maxBytes: number
): Promise<{ bytes: Uint8Array; canonicalPath: string; sha256: string }>
{
  if (!isAbsolute(path))
    throw new DevelopmentErrorV1(
      'development.invalid_source',
      'sourcePath must be absolute'
    )
  const canonicalPath = await realpath(path)
  if (
    !roots.some((root) => developmentWithinRootV1(root, canonicalPath)) ||
    developmentWithinRootV1(evidenceRoot, canonicalPath)
  )
    throw new DevelopmentErrorV1(
      'development.source_outside_permissions',
      'source must be inside an operator source root & outside private evidence'
    )
  const descriptor = await open(
    canonicalPath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  )
  try
  {
    const before = await descriptor.stat()
    if (!before.isFile() || before.size > maxBytes)
      throw new DevelopmentErrorV1(
        'development.source_budget_exceeded',
        'source exceeds the regular-file byte budget'
      )
    const bytes = Buffer.allocUnsafe(before.size + 1)
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
    const after = await descriptor.stat()
    const current = await lstat(canonicalPath)
    if (
      offset !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      (await realpath(path)) !== canonicalPath
    )
      throw new DevelopmentErrorV1(
        'development.source_changed',
        'source changed while its snapshot was read'
      )
    const snapshot = bytes.subarray(0, offset)
    return {
      bytes: snapshot,
      canonicalPath,
      sha256: developmentSha256V1(snapshot),
    }
  }
  finally
  {
    await descriptor.close()
  }
}

export class DevelopmentRetentionV1
{
  readonly artifacts: DevelopmentArtifactRefV1[] = []
  retainedBytes = 0
  cleanupIssue: string | null = null
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    readonly sessionId: string,
    readonly root: string,
    readonly limits: DevelopmentLimitsV1,
    private readonly directoryIdentity: {
      readonly dev: number
      readonly ino: number
    },
    private readonly policy: RetentionPolicyV2 | null,
    private terminal: TerminalReservationV2 | null
  )
  {}

  static async create(
    sessionId: string,
    parent: string,
    limits: DevelopmentLimitsV1
  ): Promise<DevelopmentRetentionV1>
  {
    const root = join(parent, sessionId)
    await mkdir(root, { mode: 0o700 })
    const store = new DevelopmentRetentionV1(
      sessionId,
      root,
      limits,
      await lstat(root),
      catalogPolicy(limits),
      {
        slots: TERMINAL_SLOTS,
        bytes: developmentTerminalReserveBytesV2(limits.maxTraceBytes),
        state: 'reserved',
        checkpointKey: null,
      }
    )
    await store.writeIndex()
    return store
  }

  static async resume(
    sessionId: string,
    parent: string,
    limits: DevelopmentLimitsV1
  ): Promise<DevelopmentRetentionV1>
  {
    assertSessionId(sessionId)
    const root = join(parent, sessionId)
    if ((await realpath(root)) !== root)
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'private session directory changed'
      )
    const indexBytes = await readBoundedFile(
      join(root, 'index.json'),
      1024 * 1024
    )
    const index = scanStrictJson(
      new TextDecoder('utf8', { fatal: true }).decode(indexBytes),
      { maxDepth: 32, maxMembersPerContainer: 4096, maxNodes: 65536 }
    ).value as {
      schemaVersion?: unknown
      sessionId?: unknown
      artifacts?: DevelopmentArtifactRefV1[]
      policy?: RetentionPolicyV2
      terminal?: TerminalReservationV2
    }
    if (
      (index.schemaVersion !== 1 && index.schemaVersion !== 2) ||
      index.sessionId !== sessionId ||
      !Array.isArray(index.artifacts)
    )
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'retained development catalog is invalid'
      )
    let policy: RetentionPolicyV2 | null = null
    let terminal: TerminalReservationV2 | null = null
    if (index.schemaVersion === 2)
    {
      const value = index.policy
      const reservation = index.terminal
      if (
        value?.identity !== 'development-terminal-reservation-v2' ||
        !value.limits ||
        Object.keys(value.limits).sort().join(',') !==
          [...CATALOG_LIMITS].sort().join(',') ||
        CATALOG_LIMITS.some(
          (key) =>
            !Number.isSafeInteger(value.limits[key]) ||
            value.limits[key] < 1 ||
            value.limits[key] > DEVELOPMENT_LIMITS_V1[key]
        ) ||
        reservation?.slots !== TERMINAL_SLOTS ||
        reservation.bytes !==
          developmentTerminalReserveBytesV2(value.limits.maxTraceBytes) ||
        !['reserved', 'committed'].includes(reservation.state) ||
        (reservation.state === 'reserved'
          ? reservation.checkpointKey !== null
          : typeof reservation.checkpointKey !== 'string' ||
            !/^checkpoint-\d{6}\.json$/.test(reservation.checkpointKey))
      )
        throw new DevelopmentErrorV1(
          'development.artifact_changed',
          'retained terminal reservation or creation limits are invalid'
        )
      policy = catalogPolicy({ ...limits, ...value.limits })
      terminal = { ...reservation }
    }
    const effectiveLimits = { ...limits }
    if (policy)
      for (const key of CATALOG_LIMITS)
        effectiveLimits[key] = Math.min(limits[key], policy.limits[key])
    const store = new DevelopmentRetentionV1(
      sessionId,
      root,
      effectiveLimits,
      await lstat(root),
      policy,
      terminal
    )
    if (index.artifacts.length > effectiveLimits.maxRetainedArtifacts)
      throw new DevelopmentErrorV1(
        'development.retention_budget_exceeded',
        'retained artifact count exceeds host budget'
      )
    const keys = new Set<string>()
    for (const ref of index.artifacts)
    {
      assertKey(ref.key)
      if (
        ref.sessionId !== sessionId ||
        ref.path !== join(root, ref.key) ||
        keys.has(ref.key) ||
        !/^[a-f0-9]{64}$/.test(ref.sha256) ||
        !Number.isSafeInteger(ref.byteLength) ||
        ref.byteLength < 0 ||
        typeof ref.mimeType !== 'string'
      )
        throw new DevelopmentErrorV1(
          'development.artifact_changed',
          'retained artifact identity is invalid'
        )
      keys.add(ref.key)
      store.artifacts.push(Object.freeze({ ...ref }))
      store.retainedBytes += ref.byteLength
    }
    if (store.retainedBytes > effectiveLimits.maxRetainedBytes)
      throw new DevelopmentErrorV1(
        'development.retention_budget_exceeded',
        'retained bytes exceed host budget'
      )
    if (policy && terminal)
    {
      const trace = store.artifacts.findIndex((ref) => ref.key === 'trace.json')
      const summary = store.artifacts.findIndex(
        (ref) => ref.key === 'session.json'
      )
      const checkpoint = store.artifacts.findIndex(
        (ref) => ref.key === terminal.checkpointKey
      )
      const reserved = terminal.state === 'reserved'
      if (
        (reserved &&
          (trace !== -1 ||
            summary !== -1 ||
            store.artifacts.length + terminal.slots >
              policy.limits.maxRetainedArtifacts ||
            store.retainedBytes + terminal.bytes >
              policy.limits.maxRetainedBytes)) ||
        (!reserved &&
          (checkpoint < 0 ||
            trace !== checkpoint + 1 ||
            summary !== trace + 1 ||
            store.artifacts[checkpoint]!.byteLength >
              policy.limits.maxTraceBytes + DEVELOPMENT_STATUS_BYTES_V2 ||
            store.artifacts[trace]!.byteLength > policy.limits.maxTraceBytes ||
            store.artifacts[summary]!.byteLength > DEVELOPMENT_STATUS_BYTES_V2))
      )
        throw new DevelopmentErrorV1(
          'development.artifact_changed',
          'retained terminal artifacts disagree with their reservation'
        )
    }
    return store
  }

  async retain(
    key: string,
    bytes: Uint8Array,
    mimeType: string
  ): Promise<DevelopmentArtifactRefV1>
  {
    return (await this.retainBatch([{ key, bytes, mimeType }]))[0]!
  }

  retainBatch(
    entries: readonly RetentionEntryV1[]
  ): Promise<readonly DevelopmentArtifactRefV1[]>
  {
    const mutation = this.mutationTail.then(() => this.lockedRetain(entries))
    this.mutationTail = mutation.then(
      () => undefined,
      () => undefined
    )
    return mutation
  }

  retainTerminal(input: {
    readonly checkpoint: { readonly key: string; readonly bytes: Uint8Array }
    readonly traceBytes: Uint8Array
    readonly sessionBytes: Uint8Array
  }): Promise<readonly DevelopmentArtifactRefV1[]>
  {
    const entries = [
      input.checkpoint,
      { key: 'trace.json', bytes: input.traceBytes },
      { key: 'session.json', bytes: input.sessionBytes },
    ].map((entry) => ({ ...entry, mimeType: 'application/json' }))
    const mutation = this.mutationTail.then(() =>
      this.lockedRetain(entries, true)
    )
    this.mutationTail = mutation.then(
      () => undefined,
      () => undefined
    )
    return mutation
  }

  artifactRef(
    key: string,
    bytes: Uint8Array,
    mimeType = 'application/json'
  ): DevelopmentArtifactRefV1
  {
    assertKey(key)
    return Object.freeze({
      sessionId: this.sessionId,
      key,
      path: join(this.root, key),
      sha256: developmentSha256V1(bytes),
      byteLength: bytes.byteLength,
      mimeType,
    })
  }

  assertWritable(): void
  {
    if (!this.policy)
      throw new DevelopmentErrorV1(
        'development.legacy_read_only',
        'legacy development catalogs are read-only; begin a new session for retained evidence'
      )
  }

  refresh(): Promise<void>
  {
    const refresh = this.mutationTail.then(async () =>
    {
      await this.verifyRoot()
      const current = await DevelopmentRetentionV1.resume(
        this.sessionId,
        dirname(this.root),
        this.limits
      )
      await this.verifyRoot()
      this.adoptAppendedCatalog(current)
    })
    this.mutationTail = refresh.then(
      () => undefined,
      () => undefined
    )
    return refresh
  }

  private adoptAppendedCatalog(current: DevelopmentRetentionV1): void
  {
    if (
      JSON.stringify(this.policy) !== JSON.stringify(current.policy) ||
      this.terminal?.slots !== current.terminal?.slots ||
      this.terminal?.bytes !== current.terminal?.bytes ||
      (this.terminal?.state === 'committed' &&
        JSON.stringify(this.terminal) !== JSON.stringify(current.terminal)) ||
      this.artifacts.some((ref, index) =>
      {
        const other = current.artifacts[index]
        return (
          !other ||
          other.key !== ref.key ||
          other.sessionId !== ref.sessionId ||
          other.path !== ref.path ||
          other.sha256 !== ref.sha256 ||
          other.byteLength !== ref.byteLength ||
          other.mimeType !== ref.mimeType
        )
      })
    )
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'private artifact catalog replaced or removed previously pinned evidence'
      )
    this.artifacts.push(...current.artifacts.slice(this.artifacts.length))
    this.retainedBytes = current.retainedBytes
    this.terminal = current.terminal
  }

  private async lockedRetain(
    entries: readonly RetentionEntryV1[],
    terminal = false
  ): Promise<readonly DevelopmentArtifactRefV1[]>
  {
    await this.verifyRoot()
    const lockPath = join(this.root, '.writer.lock')
    let lock
    try
    {
      lock = await open(lockPath, 'wx', 0o600)
    }
    catch (cause)
    {
      throw new DevelopmentErrorV1(
        'development.evidence_writer_busy',
        'private evidence has another writer or an unfinished write; read-only inspection remains available',
        { cause }
      )
    }
    const identity = await lock.stat()
    try
    {
      const current = await DevelopmentRetentionV1.resume(
        this.sessionId,
        dirname(this.root),
        this.limits
      )
      await this.verifyRoot()
      this.adoptAppendedCatalog(current)
      this.assertWritable()
      if (terminal)
      {
        if (
          this.terminal?.state !== 'reserved' ||
          entries.length !== TERMINAL_SLOTS ||
          !/^checkpoint-\d{6}\.json$/.test(entries[0]!.key) ||
          entries[1]!.key !== 'trace.json' ||
          entries[2]!.key !== 'session.json' ||
          entries[0]!.bytes.byteLength >
            this.policy!.limits.maxTraceBytes + DEVELOPMENT_STATUS_BYTES_V2 ||
          entries[1]!.bytes.byteLength > this.policy!.limits.maxTraceBytes ||
          entries[2]!.bytes.byteLength > DEVELOPMENT_STATUS_BYTES_V2
        )
          throw new DevelopmentErrorV1(
            'development.retention_budget_exceeded',
            'terminal checkpoint, trace or summary exceeds its pinned reservation'
          )
      }
      else if (
        entries.some((entry) =>
          ['trace.json', 'session.json'].includes(entry.key)
        )
      )
        throw new DevelopmentErrorV1(
          'development.artifact_changed',
          'terminal records require one atomic terminal batch'
        )
      const reserved =
        !terminal && this.terminal?.state === 'reserved' ? this.terminal : null
      const total = entries.reduce(
        (sum, entry) => sum + entry.bytes.byteLength,
        0
      )
      if (
        !entries.length ||
        entries.length + this.artifacts.length + (reserved?.slots ?? 0) >
          this.limits.maxRetainedArtifacts ||
        total + this.retainedBytes + (reserved?.bytes ?? 0) >
          this.limits.maxRetainedBytes ||
        new Set(entries.map((entry) => entry.key)).size !== entries.length
      )
        throw new DevelopmentErrorV1(
          'development.retention_budget_exceeded',
          'artifact batch exceeds retained capacity after the pinned terminal reservation'
        )
      const evidence = this.artifacts.filter((ref) =>
        /^(frame|audio|clip|reproduction)-/.test(ref.key)
      )
      const addedEvidence = entries.filter((entry) =>
        /^(frame|audio|clip|reproduction)-/.test(entry.key)
      )
      if (
        evidence.length + addedEvidence.length >
          this.limits.maxEvidenceArtifacts ||
        evidence.reduce((sum, ref) => sum + ref.byteLength, 0) +
          addedEvidence.reduce(
            (sum, entry) => sum + entry.bytes.byteLength,
            0
          ) >
          this.limits.maxEvidenceBytes
      )
        throw new DevelopmentErrorV1(
          'development.evidence_budget_exceeded',
          'media & reproduction artifacts exceed the global session evidence budget'
        )
      const before = {
        count: this.artifacts.length,
        bytes: this.retainedBytes,
        terminal: this.terminal,
        index: this.indexBytes(),
      }
      const created: string[] = []
      const refs: DevelopmentArtifactRefV1[] = []
      let proposed: Uint8Array | null = null
      try
      {
        for (const entry of entries)
          refs.push(
            await this.retainUnlocked(
              entry.key,
              entry.bytes,
              entry.mimeType,
              created
            )
          )
        if (terminal)
          this.terminal = {
            ...this.terminal!,
            state: 'committed',
            checkpointKey: entries[0]!.key,
          }
        proposed = this.indexBytes()
        await this.writeIndex(proposed)
        return refs
      }
      catch (error)
      {
        // a rename may have committed before its caller observed a failure
        const observed = await readBoundedFile(
          join(this.root, 'index.json'),
          1024 * 1024
        ).catch(() => null)
        if (
          proposed &&
          observed &&
          developmentSha256V1(observed) === developmentSha256V1(proposed)
        )
        {
          await this.syncDirectory().catch((failure: unknown) =>
          {
            this.cleanupIssue = `private evidence writer cleanup incomplete: catalog directory sync failed: ${String(failure).slice(0, 1024)}`
          })
          return refs
        }
        this.artifacts.splice(before.count)
        this.retainedBytes = before.bytes
        this.terminal = before.terminal
        if (
          observed &&
          developmentSha256V1(observed) === developmentSha256V1(before.index)
        )
          for (const path of created) await unlink(path).catch(() => undefined)
        throw error
      }
    }
    finally
    {
      try
      {
        await lock.close()
        const entry = await lstat(lockPath)
        if (entry.dev === identity.dev && entry.ino === identity.ino)
          await unlink(lockPath)
      }
      catch (error)
      {
        this.cleanupIssue = `private evidence writer cleanup incomplete: ${String(error).slice(0, 1024)}`
      }
    }
  }

  private async retainUnlocked(
    key: string,
    bytes: Uint8Array,
    mimeType: string,
    created: string[]
  ): Promise<DevelopmentArtifactRefV1>
  {
    assertKey(key)
    if (this.artifacts.some((ref) => ref.key === key))
      throw new DevelopmentErrorV1(
        'development.artifact_exists',
        'immutable artifact key is already retained'
      )
    if (
      this.artifacts.length >= this.limits.maxRetainedArtifacts ||
      this.retainedBytes + bytes.byteLength > this.limits.maxRetainedBytes
    )
      throw new DevelopmentErrorV1(
        'development.retention_budget_exceeded',
        'development evidence exceeds the host retention budget'
      )
    const path = join(this.root, key)
    const file = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    created.push(path)
    try
    {
      await file.writeFile(bytes)
      await file.sync()
    }
    finally
    {
      await file.close()
    }
    const ref = this.artifactRef(key, bytes, mimeType)
    this.artifacts.push(ref)
    this.retainedBytes += ref.byteLength
    return ref
  }

  retainJson(key: string, value: unknown): Promise<DevelopmentArtifactRefV1>
  {
    return this.retain(key, developmentJsonBytesV1(value), 'application/json')
  }

  async read(key: string): Promise<Uint8Array>
  {
    await this.verifyRoot()
    const ref = this.artifacts.find((artifact) => artifact.key === key)
    if (!ref)
      throw new DevelopmentErrorV1(
        'development.artifact_unavailable',
        'artifact is not in this session catalog'
      )
    const bytes = await readBoundedFile(ref.path, ref.byteLength)
    if (
      bytes.byteLength !== ref.byteLength ||
      developmentSha256V1(bytes) !== ref.sha256
    )
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'retained artifact bytes differ from the pinned identity'
      )
    return bytes
  }

  async readSnapshotBytes(ref: DevelopmentArtifactRefV1): Promise<Uint8Array>
  {
    await this.verifyRoot()
    if (
      ref.sessionId !== this.sessionId ||
      !this.artifacts.some(
        (artifact) =>
          artifact.key === ref.key &&
          artifact.sha256 === ref.sha256 &&
          artifact.byteLength === ref.byteLength
      )
    )
      throw new DevelopmentErrorV1(
        'development.artifact_unavailable',
        'artifact is not in this session catalog'
      )
    return readBoundedFile(ref.path, ref.byteLength, true)
  }

  private indexBytes(): Uint8Array
  {
    return developmentJsonBytesV1({
      schemaVersion: this.policy ? 2 : 1,
      sessionId: this.sessionId,
      ...(this.policy ? { policy: this.policy, terminal: this.terminal } : {}),
      artifacts: this.artifacts,
    })
  }

  private async writeIndex(bytes = this.indexBytes()): Promise<void>
  {
    if (bytes.byteLength > 1024 * 1024)
      throw new DevelopmentErrorV1(
        'development.retention_budget_exceeded',
        'retained catalog exceeds its bounded read limit'
      )
    await this.verifyRoot()
    const path = join(this.root, `index-${randomUUID()}.tmp`)
    const file = await open(path, 'wx', 0o600)
    try
    {
      await file.writeFile(bytes)
      await file.sync()
    }
    finally
    {
      await file.close()
    }
    await rename(path, join(this.root, 'index.json'))
    await this.syncDirectory()
  }

  private async syncDirectory(): Promise<void>
  {
    const directory = await open(
      this.root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try
    {
      await directory.sync()
    }
    finally
    {
      await directory.close()
    }
  }

  private async verifyRoot(): Promise<void>
  {
    const info = await lstat(this.root)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.dev !== this.directoryIdentity.dev ||
      info.ino !== this.directoryIdentity.ino ||
      (await realpath(this.root)) !== this.root
    )
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'private session directory identity changed'
      )
  }
}

export function assertSessionId(sessionId: string): void
{
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(sessionId))
    throw new DevelopmentErrorV1(
      'development.invalid_session',
      'sessionId must be a retained development UUID'
    )
}

function assertKey(key: string): void
{
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(key))
    throw new DevelopmentErrorV1(
      'development.invalid_artifact_key',
      'artifact keys must be bounded private filenames'
    )
}

async function readBoundedFile(
  path: string,
  maxBytes: number,
  exactPayload = false
): Promise<Uint8Array>
{
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try
  {
    const info = await file.stat()
    if (
      !info.isFile() ||
      info.size > maxBytes ||
      (exactPayload && info.size !== maxBytes)
    )
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'artifact exceeds its pinned regular-file budget'
      )
    const bytes = exactPayload
      ? Buffer.allocUnsafeSlow(info.size)
      : Buffer.allocUnsafe(info.size + 1)
    let offset = 0
    while (offset < bytes.byteLength)
    {
      const read = await file.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      )
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const after = await file.stat()
    if (
      offset !== info.size ||
      info.size !== after.size ||
      info.mtimeMs !== after.mtimeMs
    )
      throw new DevelopmentErrorV1(
        'development.artifact_changed',
        'artifact changed during its bounded read'
      )
    return bytes.subarray(0, offset)
  }
  finally
  {
    await file.close()
  }
}
