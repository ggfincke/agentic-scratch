// packages/edit/src/authoring/workspace-retention.ts
// reuse the durable private artifact store for authoring records & state pointers

import { join } from 'node:path'

import {
  createEditArtifactStoreHostAdapter,
  type EditArtifactStoreHostAdapter,
} from '@scratch-agent/eval'

import { editCanonicalBytesV1 } from '../support/canonical.js'
import {
  authoringBytesSha256V1,
  authoringParseJsonV1,
} from './workspace-files.js'
import type {
  AuthoringArtifactRefV1,
  AuthoringWorkspaceLimitsV1,
} from './workspace-types.js'
import { AuthoringWorkspaceErrorV1 } from './workspace-types.js'

export class AuthoringRetentionV1
{
  readonly store: EditArtifactStoreHostAdapter

  private constructor(
    readonly workspaceId: string,
    readonly root: string,
    store: EditArtifactStoreHostAdapter
  )
  {
    this.store = store
  }

  static async create(
    workspaceId: string,
    root: string,
    limits: AuthoringWorkspaceLimitsV1
  ): Promise<AuthoringRetentionV1>
  {
    const store = createEditArtifactStoreHostAdapter(root, {
      nativeWriterCoordination: true,
      maxBytes: limits.maxRetainedBytes,
      maxEntries: limits.maxRetainedArtifacts,
      maxEntryBytes: Math.max(
        limits.maxSourceFileBytes,
        limits.maxSourceJsonBytes
      ),
    })
    return new AuthoringRetentionV1(workspaceId, root, store)
  }

  static async resume(
    workspaceId: string,
    root: string,
    writable = true
  ): Promise<AuthoringRetentionV1>
  {
    const reader = createEditArtifactStoreHostAdapter(root, {
      mode: 'read-only',
    })
    const capability = await reader.capability()
    if (!writable) return new AuthoringRetentionV1(workspaceId, root, reader)
    const store = createEditArtifactStoreHostAdapter(root, {
      mode: 'recovery',
      nativeWriterCoordination: true,
      expectedStoreId: capability.storeId,
      expectedOwnershipSha256: capability.ownershipSha256,
    })
    return new AuthoringRetentionV1(workspaceId, root, store)
  }

  async withRootLease<T>(operation: () => Promise<T>): Promise<T>
  {
    if (this.store.withRootLease === undefined)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.writer_coordination_unavailable',
        'writable authoring requires the native artifact root lease'
      )
    return this.store.withRootLease(operation)
  }

  async retain(
    key: string,
    bytes: Uint8Array,
    mimeType: string
  ): Promise<AuthoringArtifactRefV1>
  {
    const identity = await this.store.createOrVerifyImmutable(key, bytes)
    return Object.freeze({
      workspaceId: this.workspaceId,
      key,
      path: join(this.root, key),
      ...identity,
      mimeType,
    })
  }

  retainJson(key: string, value: unknown): Promise<AuthoringArtifactRefV1>
  {
    return this.retain(key, editCanonicalBytesV1(value), 'application/json')
  }

  async read(ref: AuthoringArtifactRefV1): Promise<Uint8Array>
  {
    if (ref.workspaceId !== this.workspaceId)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.artifact_mismatch',
        'artifact belongs to another workspace'
      )
    const bytes = await this.store.readImmutable(ref.key)
    if (
      bytes.byteLength !== ref.byteLength ||
      authoringBytesSha256V1(bytes) !== ref.sha256
    )
      throw new AuthoringWorkspaceErrorV1(
        'authoring.artifact_changed',
        'retained artifact differs from its pinned identity'
      )
    return bytes
  }

  async readSnapshotBytes(ref: AuthoringArtifactRefV1): Promise<Uint8Array>
  {
    if (ref.workspaceId !== this.workspaceId)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.artifact_mismatch',
        'artifact belongs to another workspace'
      )
    if (!this.store.readImmutableOwnedBytes)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.snapshot_read_unavailable',
        'durable store cannot transfer a bounded snapshot payload'
      )
    return this.store.readImmutableOwnedBytes(ref.key, ref.byteLength)
  }

  async readJson<T>(ref: AuthoringArtifactRefV1): Promise<T>
  {
    return authoringParseJsonV1(await this.read(ref)) as T
  }
}
