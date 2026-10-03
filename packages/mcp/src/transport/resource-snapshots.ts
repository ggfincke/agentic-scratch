// packages/mcp/src/transport/resource-snapshots.ts
// page explicitly verified private payloads within one server-owned memory lease

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { clearTimeout, setTimeout } from 'node:timers'
import { McpBoundaryError } from './errors.js'

export const RESOURCE_SNAPSHOT_POLICY_V1 = Object.freeze({
  identity: 'verified-resource-snapshot-v1',
  maxSnapshots: 2,
  maxSnapshotBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  idleExpiryMs: 60_000,
  absoluteExpiryMs: 600_000,
  pageBytes: 16 * 1024,
  verification: 'one-sha256-over-exact-owned-bytes-before-private-adoption',
  continuation: 'server-hmac-bound-artifact-identity-and-exact-offset',
})

export interface ResourceSnapshotArtifactV1
{
  readonly key: string
  readonly sha256: string
  readonly byteLength: number
  readonly mimeType: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly path?: string
}

export interface ResourceSnapshotSelectionV1
{
  readonly artifact: ResourceSnapshotArtifactV1
  load(): Promise<Uint8Array>
}

interface SnapshotV1
{
  readonly id: string
  readonly selection: string
  readonly createdAt: number
  readonly controller: AbortController
  lastAccess: number
  verifiedAt: number | null
  artifact: ResourceSnapshotArtifactV1 | null
  bytes: Uint8Array | null
  reservedBytes: number
}

function refusal(code: string, message: string): never
{
  throw new McpBoundaryError(`mcp.resource-snapshot-${code}`, message)
}

export class VerifiedResourceSnapshotPagerV1
{
  readonly #secret = randomBytes(32)
  readonly #snapshots = new Map<string, SnapshotV1>()
  readonly #pending = new Set<Promise<unknown>>()
  #closed = false
  #closing: Promise<void> | undefined
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly now: () => number = Date.now)
  {}

  read(
    uri: string,
    request: {
      readonly key: string
      readonly offset: number
      readonly token?: string
    },
    select: (signal: AbortSignal) => Promise<ResourceSnapshotSelectionV1>,
    signal?: AbortSignal
  ): Promise<{ uri: string; mimeType: string; text: string }>
  {
    const operation = this.#read(uri, request, select, signal)
    this.#pending.add(operation)
    const settled = () => this.#pending.delete(operation)
    void operation.then(settled, settled)
    return operation
  }

  async #read(
    uri: string,
    request: {
      readonly key: string
      readonly offset: number
      readonly token?: string
    },
    select: (signal: AbortSignal) => Promise<ResourceSnapshotSelectionV1>,
    signal?: AbortSignal
  ): Promise<{ uri: string; mimeType: string; text: string }>
  {
    this.#assertOpen()
    if (signal?.aborted)
      refusal('cancelled', 'snapshot resource request was cancelled')
    this.#expire()
    const parsed = new URL(uri)
    const selection = JSON.stringify([
      parsed.protocol,
      parsed.hostname,
      request.key,
    ])
    let snapshot: SnapshotV1
    if (request.token !== undefined)
    {
      snapshot = this.#continuation(request.token, request.offset, selection)
    }
    else
    {
      if (request.offset !== 0)
        refusal(
          'invalid-continuation',
          'a new snapshot must start at offset zero'
        )
      if (this.#snapshots.size >= RESOURCE_SNAPSHOT_POLICY_V1.maxSnapshots)
        refusal(
          'capacity-exceeded',
          'two snapshots are already retained or verifying'
        )
      const createdAt = this.now()
      snapshot = {
        id: randomBytes(16).toString('hex'),
        selection,
        createdAt,
        lastAccess: createdAt,
        verifiedAt: null,
        artifact: null,
        bytes: null,
        reservedBytes: 0,
        controller: new AbortController(),
      }
      this.#snapshots.set(snapshot.id, snapshot)
      this.#armTimer()
      const cancel = () => snapshot.controller.abort(signal?.reason)
      if (signal?.aborted) cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      try
      {
        this.#assertAvailable(snapshot)
        const selected = await select(snapshot.controller.signal)
        this.#assertAvailable(snapshot)
        const artifact = selected.artifact
        if (
          artifact.key !== request.key ||
          (artifact.workspaceId ?? artifact.sessionId) !== parsed.hostname ||
          !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
          !Number.isSafeInteger(artifact.byteLength) ||
          artifact.byteLength < 0 ||
          artifact.byteLength > RESOURCE_SNAPSHOT_POLICY_V1.maxSnapshotBytes
        )
          refusal(
            'artifact-unavailable',
            'snapshot identity or its 64-MiB payload bound is invalid'
          )
        const reserved = [...this.#snapshots.values()].reduce(
          (sum, entry) => sum + entry.reservedBytes,
          0
        )
        if (
          reserved + artifact.byteLength >
          RESOURCE_SNAPSHOT_POLICY_V1.maxTotalBytes
        )
          refusal(
            'capacity-exceeded',
            'snapshot payload reservations exceed 128 MiB'
          )
        snapshot.reservedBytes = artifact.byteLength
        snapshot.artifact = Object.freeze({ ...artifact })
        // the loader transfers a fresh bounded buffer after capacity is reserved
        const bytes = await selected.load()
        this.#assertAvailable(snapshot)
        if (
          !(bytes instanceof Uint8Array) ||
          !(bytes.buffer instanceof ArrayBuffer) ||
          bytes.byteOffset !== 0 ||
          bytes.byteLength !== bytes.buffer.byteLength ||
          bytes.byteLength !== artifact.byteLength ||
          createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
        )
          refusal(
            'artifact-changed',
            'snapshot payload differs from its catalogue identity'
          )
        snapshot.bytes = bytes
        snapshot.verifiedAt = this.now()
        snapshot.lastAccess = snapshot.verifiedAt
      }
      catch (error)
      {
        const reason = snapshot.controller.signal.reason as unknown
        this.#drop(snapshot)
        if (
          reason instanceof McpBoundaryError &&
          reason.code === 'mcp.resource-snapshot-expired'
        )
          throw reason
        throw error
      }
      finally
      {
        signal?.removeEventListener('abort', cancel)
      }
    }
    this.#assertAvailable(snapshot)
    const artifact = snapshot.artifact!,
      bytes = snapshot.bytes!
    if (request.offset > bytes.byteLength)
      refusal(
        'invalid-continuation',
        'snapshot offset exceeds its verified payload'
      )
    snapshot.lastAccess = this.now()
    const end = Math.min(
      bytes.byteLength,
      request.offset + RESOURCE_SNAPSHOT_POLICY_V1.pageBytes
    )
    const nextUri =
      end < bytes.byteLength ? this.#uri(parsed, snapshot, end) : null
    this.#armTimer()
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        artifact,
        offset: request.offset,
        encoding: 'base64',
        bytes: Buffer.from(
          bytes.buffer,
          bytes.byteOffset + request.offset,
          end - request.offset
        ).toString('base64'),
        nextUri,
        snapshot: {
          mode: 'snapshot-v1',
          policy: RESOURCE_SNAPSHOT_POLICY_V1.identity,
          snapshotId: snapshot.id,
          sha256: artifact.sha256,
          byteLength: artifact.byteLength,
          verifiedAt: snapshot.verifiedAt,
          idleExpiresAt:
            snapshot.lastAccess + RESOURCE_SNAPSHOT_POLICY_V1.idleExpiryMs,
          absoluteExpiresAt:
            snapshot.createdAt + RESOURCE_SNAPSHOT_POLICY_V1.absoluteExpiryMs,
          verification: RESOURCE_SNAPSHOT_POLICY_V1.verification,
        },
      }),
    }
  }

  close(): Promise<void>
  {
    if (this.#closing) return this.#closing
    this.#closed = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    for (const snapshot of this.#snapshots.values()) this.#drop(snapshot)
    this.#secret.fill(0)
    this.#closing = Promise.allSettled([...this.#pending]).then(() => undefined)
    return this.#closing
  }

  #assertOpen(): void
  {
    if (this.#closed) refusal('closed', 'server snapshot ownership is closed')
  }

  #assertAvailable(snapshot: SnapshotV1): void
  {
    this.#assertOpen()
    if (snapshot.controller.signal.aborted)
    {
      const reason = snapshot.controller.signal.reason as unknown
      if (
        reason instanceof McpBoundaryError &&
        reason.code === 'mcp.resource-snapshot-expired'
      )
        throw reason
      refusal('cancelled', 'snapshot verification was cancelled')
    }
    const now = this.now()
    if (
      now >=
        snapshot.createdAt + RESOURCE_SNAPSHOT_POLICY_V1.absoluteExpiryMs ||
      (snapshot.bytes !== null &&
        now >= snapshot.lastAccess + RESOURCE_SNAPSHOT_POLICY_V1.idleExpiryMs)
    )
    {
      this.#drop(snapshot)
      refusal(
        'expired',
        'verified snapshot expired; start a fresh snapshot read'
      )
    }
  }

  #signature(snapshot: SnapshotV1, offset: number): string
  {
    return createHmac('sha256', this.#secret)
      .update(
        JSON.stringify([
          snapshot.id,
          snapshot.selection,
          snapshot.artifact?.sha256,
          offset,
        ])
      )
      .digest('base64url')
  }

  #uri(parsed: URL, snapshot: SnapshotV1, offset: number): string
  {
    const continuation = Buffer.from(
      JSON.stringify([snapshot.id, offset])
    ).toString('base64url')
    const uri = new URL(parsed)
    uri.searchParams.set('offset', String(offset))
    uri.searchParams.set('read', 'snapshot-v1')
    uri.searchParams.set(
      'token',
      `${continuation}.${this.#signature(snapshot, offset)}`
    )
    return uri.href
  }

  #continuation(token: string, offset: number, selection: string): SnapshotV1
  {
    if (!/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{43}$/u.test(token))
      refusal('invalid-continuation', 'snapshot continuation token is invalid')
    const [encoded, signature] = token.split('.')
    let content: unknown
    try
    {
      content = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    }
    catch
    {
      refusal('invalid-continuation', 'snapshot continuation token is invalid')
    }
    if (
      !Array.isArray(content) ||
      content.length !== 2 ||
      typeof content[0] !== 'string' ||
      content[1] !== offset
    )
      refusal('invalid-continuation', 'snapshot continuation offset is invalid')
    const snapshot = this.#snapshots.get(content[0])
    if (!snapshot)
      refusal('expired', 'snapshot is unavailable or expired in this server')
    const expected = this.#signature(snapshot, offset)
    if (
      snapshot.selection !== selection ||
      !timingSafeEqual(Buffer.from(signature!), Buffer.from(expected))
    )
      refusal(
        'invalid-continuation',
        'snapshot continuation does not match this artifact and offset'
      )
    this.#assertAvailable(snapshot)
    if (snapshot.bytes === null)
      refusal('unavailable', 'snapshot verification has not completed')
    return snapshot
  }

  #drop(snapshot: SnapshotV1): void
  {
    snapshot.controller.abort(new Error('snapshot ownership released'))
    snapshot.bytes = null
    snapshot.reservedBytes = 0
    this.#snapshots.delete(snapshot.id)
    if (!this.#closed) this.#armTimer()
  }

  #expire(): void
  {
    const now = this.now()
    for (const snapshot of this.#snapshots.values())
      if (
        snapshot.bytes === null &&
        now >= snapshot.createdAt + RESOURCE_SNAPSHOT_POLICY_V1.absoluteExpiryMs
      )
      {
        // cancelled verification keeps its reservation until the owned loader settles
        snapshot.controller.abort(
          new McpBoundaryError(
            'mcp.resource-snapshot-expired',
            'snapshot verification exceeded its absolute lifetime'
          )
        )
      }
      else if (
        snapshot.bytes !== null &&
        (now >=
          snapshot.lastAccess + RESOURCE_SNAPSHOT_POLICY_V1.idleExpiryMs ||
          now >=
            snapshot.createdAt + RESOURCE_SNAPSHOT_POLICY_V1.absoluteExpiryMs)
      )
        this.#drop(snapshot)
  }

  #armTimer(): void
  {
    if (this.#timer) clearTimeout(this.#timer)
    const deadlines = [...this.#snapshots.values()]
      .filter((entry) => !entry.controller.signal.aborted)
      .map((entry) =>
        entry.bytes === null
          ? entry.createdAt + RESOURCE_SNAPSHOT_POLICY_V1.absoluteExpiryMs
          : Math.min(
              entry.lastAccess + RESOURCE_SNAPSHOT_POLICY_V1.idleExpiryMs,
              entry.createdAt + RESOURCE_SNAPSHOT_POLICY_V1.absoluteExpiryMs
            )
      )
    if (!deadlines.length)
    {
      this.#timer = undefined
      return
    }
    this.#timer = setTimeout(
      () =>
      {
        this.#expire()
        this.#armTimer()
      },
      Math.max(1, Math.min(...deadlines) - this.now())
    )
    this.#timer.unref()
  }
}
