// packages/mcp/src/edit/edit-catalogue.ts
// durable producer-owned resource descriptors & bounded direct artifact reads

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'
import { hasExactObjectKeysV1 } from '../internal/exact-object-keys.js'

import { createHash } from 'node:crypto'

import type {
  EditArtifactStorePort,
  EditRetainedResourceCatalogueInputV1,
  EditRetainedResourceCataloguePortV1,
  EditRetainedResourceMimeTypeV1,
} from '@scratch-agent/edit'
import {
  DurableArtifactStore,
  DurableArtifactStoreError,
} from '@scratch-agent/eval'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import {
  editResourceLocatorDigestV1,
  MAX_EDIT_RESOURCE_BYTES,
  MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES,
  type EditArtifactCataloguePortV1,
  type EditArtifactCatalogueResolutionV1,
  type ScratchEditResourceMacInputV1,
} from './edit-resources.js'
import { McpBoundaryError } from '../transport/errors.js'

const CATALOGUE_PREFIX = 'resource-catalogue/v1'
const MAX_DESCRIPTOR_BYTES = 4096
const MAX_CATALOGUE_BYTES = 5 * 1024 * 1024
const SESSION_STORE_KEY_PATTERN = /^[a-f0-9]{32}$/u
const SESSION_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/u
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u
const LOGICAL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,2047}$/u
const DESCRIPTOR_KEY_PATTERN =
  /^resource-catalogue\/v1\/([a-f0-9]{32})\/([a-f0-9]{64})\.json$/u

const RETAINED_RESOURCE_MIME_TYPES = new Set<EditRetainedResourceMimeTypeV1>([
  'application/json',
  'application/x.scratch.sb3',
  'audio/wav',
  'image/png',
  'text/markdown; charset=utf-8',
  'video/webm',
])

const PUBLIC_JSON_ARTIFACT =
  /^(?:checkpoints\/[a-z0-9.-]+\.json|events\/[a-z0-9.-]+\.json|assets\/records\/[a-zA-Z0-9_.-]+\.json|reports\/[a-f0-9]{64}\/(?:manifest\.json|report\.json|semantic-projection\.json)|revisions\/[a-z0-9-]+\/(?:allocator\.json|authorization\.json|batch\.json|capability-snapshot\.json|cumulative-delta\.json|diagnostics\.json|lineage-history\.json|lineage\.json|manifest\.json|operation-results\.json|preservation\.json|previous-delta\.json|resolved-plan\.json))$/u
const PUBLIC_SB3_ARTIFACT = /^revisions\/[a-z0-9-]+\/candidate\.sb3$/u
const PUBLIC_MARKDOWN_ARTIFACT = /^reports\/[a-f0-9]{64}\/report\.md$/u
const PUBLIC_ASSET_PAYLOAD = /^assets\/payloads\/[a-f0-9]{64}\.bin$/u
const PUBLIC_EVALUATION_PAYLOAD = /^evaluation-evidence\/[a-f0-9]{64}\.bin$/u
const PUBLIC_REFUSAL_EVIDENCE = /^refusal-evidence\/[a-f0-9]{64}\.json$/u

interface RetainedResourceDescriptorV1
{
  readonly schemaVersion: 1
  readonly sessionStoreKey: string
  readonly locatorDigest: string
  readonly sessionId: string
  readonly sessionKey: string
  readonly logicalKey: string
  readonly storeIdentitySha256: string
  readonly contentSha256: string
  readonly mimeType: EditRetainedResourceMimeTypeV1
  readonly byteLength: number
}

function sha256DomainV1(domain: string, value: unknown): string
{
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJsonBytesV1(value))
    .digest('hex')
}

// storeId is the immutable manifest identity. Writer ownership deliberately
// rotates on every recovery, so it cannot enter a retained resource locator.
function storeIdentitySha256V1(storeId: string): string
{
  return sha256DomainV1('scratch-agent:edit-resource-store-identity:v1', {
    storeId,
  })
}

function sessionStoreKeyV1(
  storeIdentitySha256: string,
  sessionKey: string
): string
{
  return sha256DomainV1('scratch-agent:edit-resource-session-key:v1', {
    storeIdentitySha256,
    sessionKey,
  }).slice(0, 32)
}

function catalogueKeyV1(
  sessionStoreKey: string,
  locatorDigest: string
): string
{
  if (
    !SESSION_STORE_KEY_PATTERN.test(sessionStoreKey) ||
    !LOWERCASE_SHA256_PATTERN.test(locatorDigest)
  )
    throw new McpBoundaryError(
      'mcp.edit-artifact-capability-invalid',
      'artifact capability locator is invalid'
    )
  return `${CATALOGUE_PREFIX}/${sessionStoreKey}/${locatorDigest}.json`
}

function assertExactKeysV1(
  value: Record<string, unknown>,
  expected: readonly string[]
): void
{
  if (!hasExactObjectKeysV1(value, expected))
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor has unknown or missing fields'
    )
}

function exactMimeTypeV1(value: unknown): EditRetainedResourceMimeTypeV1
{
  if (
    typeof value !== 'string' ||
    !RETAINED_RESOURCE_MIME_TYPES.has(value as EditRetainedResourceMimeTypeV1)
  )
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor has an unsupported media type'
    )
  return value as EditRetainedResourceMimeTypeV1
}

function assertPublicResourceV1(input: {
  readonly sessionKey: string
  readonly logicalKey: string
  readonly mimeType: EditRetainedResourceMimeTypeV1
}): void
{
  const prefix = `sessions/${input.sessionKey}/`
  if (!input.logicalKey.startsWith(prefix))
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource does not belong to its declared session'
    )
  const relativeKey = input.logicalKey.slice(prefix.length)
  const valid =
    (PUBLIC_JSON_ARTIFACT.test(relativeKey) &&
      input.mimeType === 'application/json') ||
    (PUBLIC_SB3_ARTIFACT.test(relativeKey) &&
      input.mimeType === 'application/x.scratch.sb3') ||
    (PUBLIC_MARKDOWN_ARTIFACT.test(relativeKey) &&
      input.mimeType === 'text/markdown; charset=utf-8') ||
    (PUBLIC_ASSET_PAYLOAD.test(relativeKey) &&
      (input.mimeType === 'image/png' || input.mimeType === 'audio/wav')) ||
    (PUBLIC_EVALUATION_PAYLOAD.test(relativeKey) &&
      (input.mimeType === 'application/json' ||
        input.mimeType === 'image/png' ||
        input.mimeType === 'video/webm')) ||
    (PUBLIC_REFUSAL_EVIDENCE.test(relativeKey) &&
      input.mimeType === 'application/json')
  if (!valid)
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource is not an explicitly public producer-owned artifact'
    )
}

function descriptorV1(
  input: EditRetainedResourceCatalogueInputV1,
  storeIdentitySha256: string
): RetainedResourceDescriptorV1
{
  if (
    !OPAQUE_ID_PATTERN.test(input.sessionId) ||
    !SESSION_KEY_PATTERN.test(input.sessionKey) ||
    !LOGICAL_KEY_PATTERN.test(input.logicalKey) ||
    !LOWERCASE_SHA256_PATTERN.test(input.identity.sha256) ||
    !Number.isSafeInteger(input.identity.byteLength) ||
    input.identity.byteLength < 0
  )
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource producer claims are invalid'
    )
  const mimeType = exactMimeTypeV1(input.mimeType)
  assertPublicResourceV1({
    sessionKey: input.sessionKey,
    logicalKey: input.logicalKey,
    mimeType,
  })
  const sessionStoreKey = sessionStoreKeyV1(
    storeIdentitySha256,
    input.sessionKey
  )
  const locatorDigest = editResourceLocatorDigestV1('retained-artifact', {
    storeIdentitySha256,
    logicalKey: input.logicalKey,
  })
  return Object.freeze({
    schemaVersion: 1 as const,
    sessionStoreKey,
    locatorDigest,
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    logicalKey: input.logicalKey,
    storeIdentitySha256,
    contentSha256: input.identity.sha256,
    mimeType,
    byteLength: input.identity.byteLength,
  })
}

function decodeDescriptorV1(
  bytes: Uint8Array,
  expected: {
    readonly storeIdentitySha256: string
    readonly sessionStoreKey?: string
    readonly locatorDigest?: string
  }
): RetainedResourceDescriptorV1
{
  if (bytes.byteLength > MAX_DESCRIPTOR_BYTES)
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-limit',
      'retained resource descriptor exceeds its byte limit'
    )
  let value: unknown
  try
  {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch
  {
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor is not valid UTF-8 JSON'
    )
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor is not an object'
    )
  const record = value as Record<string, unknown>
  assertExactKeysV1(record, [
    'schemaVersion',
    'sessionStoreKey',
    'locatorDigest',
    'sessionId',
    'sessionKey',
    'logicalKey',
    'storeIdentitySha256',
    'contentSha256',
    'mimeType',
    'byteLength',
  ])
  const mimeType = exactMimeTypeV1(record.mimeType)
  if (
    record.schemaVersion !== 1 ||
    typeof record.sessionStoreKey !== 'string' ||
    !SESSION_STORE_KEY_PATTERN.test(record.sessionStoreKey) ||
    typeof record.locatorDigest !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(record.locatorDigest) ||
    typeof record.sessionId !== 'string' ||
    !OPAQUE_ID_PATTERN.test(record.sessionId) ||
    typeof record.sessionKey !== 'string' ||
    !SESSION_KEY_PATTERN.test(record.sessionKey) ||
    typeof record.logicalKey !== 'string' ||
    !LOGICAL_KEY_PATTERN.test(record.logicalKey) ||
    record.storeIdentitySha256 !== expected.storeIdentitySha256 ||
    typeof record.contentSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(record.contentSha256) ||
    !Number.isSafeInteger(record.byteLength) ||
    (record.byteLength as number) < 0 ||
    (record.byteLength as number) > MAX_EDIT_RESOURCE_BYTES
  )
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor claims are invalid'
    )
  const descriptor = Object.freeze({
    schemaVersion: 1 as const,
    sessionStoreKey: record.sessionStoreKey,
    locatorDigest: record.locatorDigest,
    sessionId: record.sessionId,
    sessionKey: record.sessionKey,
    logicalKey: record.logicalKey,
    storeIdentitySha256: record.storeIdentitySha256,
    contentSha256: record.contentSha256,
    mimeType,
    byteLength: record.byteLength as number,
  })
  assertPublicResourceV1(descriptor)
  if (
    descriptor.sessionStoreKey !==
      sessionStoreKeyV1(
        descriptor.storeIdentitySha256,
        descriptor.sessionKey
      ) ||
    descriptor.locatorDigest !==
      editResourceLocatorDigestV1('retained-artifact', {
        storeIdentitySha256: descriptor.storeIdentitySha256,
        logicalKey: descriptor.logicalKey,
      }) ||
    (expected.sessionStoreKey !== undefined &&
      descriptor.sessionStoreKey !== expected.sessionStoreKey) ||
    (expected.locatorDigest !== undefined &&
      descriptor.locatorDigest !== expected.locatorDigest)
  )
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor locator binding is invalid'
    )
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalJsonBytesV1(descriptor))))
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource descriptor is not exact canonical JSON'
    )
  return descriptor
}

function claimsV1(
  descriptor: RetainedResourceDescriptorV1,
  principalIdentity: string
): ScratchEditResourceMacInputV1
{
  return Object.freeze({
    schemaVersion: 1 as const,
    tokenVersion: 1 as const,
    sessionStoreKey: descriptor.sessionStoreKey,
    principalIdentity,
    sessionId: descriptor.sessionId,
    revisionOrStoreIdentity: Object.freeze({
      kind: 'store' as const,
      storeIdentitySha256: descriptor.storeIdentitySha256,
    }),
    locatorKind: 'retained-artifact' as const,
    locatorDigest: descriptor.locatorDigest,
    contentSha256: descriptor.contentSha256,
    mimeType: descriptor.mimeType,
    byteLength: descriptor.byteLength,
  })
}

class DurableEditArtifactCatalogueWriterV1 implements EditRetainedResourceCataloguePortV1
{
  readonly #store: EditArtifactStorePort
  readonly #storeIdentitySha256: string

  constructor(input: {
    readonly store: EditArtifactStorePort
    readonly storeIdentitySha256: string
  })
  {
    this.#store = input.store
    this.#storeIdentitySha256 = input.storeIdentitySha256
  }

  async retain(input: EditRetainedResourceCatalogueInputV1): Promise<void>
  {
    const descriptor = descriptorV1(input, this.#storeIdentitySha256)
    const observedByteLength = await this.#store.sizeImmutable(input.logicalKey)
    const observedSha256 = await this.#store.hashImmutable(input.logicalKey)
    if (
      observedByteLength !== input.identity.byteLength ||
      observedSha256 !== input.identity.sha256
    )
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-invalid',
        'retained resource payload does not match its producer claims'
      )
    // payloads above the MCP resource boundary remain durable host evidence.
    // only their public catalogue projection is intentionally omitted.
    if (descriptor.byteLength > MAX_EDIT_RESOURCE_BYTES) return
    const bytes = canonicalJsonBytesV1(descriptor)
    if (bytes.byteLength > MAX_DESCRIPTOR_BYTES)
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-limit',
        'retained resource descriptor exceeds its byte limit'
      )
    await this.#store.createOrVerifyImmutable(
      catalogueKeyV1(descriptor.sessionStoreKey, descriptor.locatorDigest),
      bytes
    )
  }
}

export interface DurableEditArtifactCatalogueWriterOptionsV1
{
  readonly artifactStore: EditArtifactStorePort
  readonly expectedStoreId: string
  readonly expectedOwnershipSha256: string
}

export async function createDurableEditArtifactCatalogueWriterV1(
  options: DurableEditArtifactCatalogueWriterOptionsV1
): Promise<EditRetainedResourceCataloguePortV1>
{
  const capability = await options.artifactStore.capability()
  if (
    capability.storeId !== options.expectedStoreId ||
    capability.ownershipSha256 !== options.expectedOwnershipSha256 ||
    !capability.writable ||
    !capability.exclusiveWriter ||
    !capability.durableFileSync ||
    !capability.durableDirectorySync ||
    !capability.noReplaceInstall
  )
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained resource writer is not the expected durable exclusive store'
    )
  return new DurableEditArtifactCatalogueWriterV1({
    store: options.artifactStore,
    storeIdentitySha256: storeIdentitySha256V1(capability.storeId),
  })
}

export interface DurableEditArtifactCatalogueOptionsV1
{
  readonly storeRoot: string
  readonly expectedStoreId: string
  readonly expectedOwnershipSha256: string
  readonly principalIdentity: string
}

// listing walks only the bounded descriptor prefix; exact token resolution reads
// one deterministic descriptor, then one identity-checked immutable payload
export class DurableEditArtifactCatalogueV1 implements EditArtifactCataloguePortV1
{
  readonly #store: DurableArtifactStore
  readonly #principalIdentity: string
  readonly #storeIdentitySha256: string
  #retained: readonly EditArtifactCatalogueResolutionV1[] = Object.freeze([])

  constructor(options: DurableEditArtifactCatalogueOptionsV1)
  {
    this.#store = new DurableArtifactStore(options.storeRoot, {
      mode: 'read-only',
      expectedStoreId: options.expectedStoreId,
      expectedOwnershipSha256: options.expectedOwnershipSha256,
    })
    const capability = this.#store.capability()
    if (
      capability.storeId !== options.expectedStoreId ||
      capability.ownershipSha256 !== options.expectedOwnershipSha256 ||
      capability.storeMode !== 'read-only' ||
      capability.writable
    )
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-invalid',
        'retained edit resource reader is not the expected read-only store'
      )
    if (!LOWERCASE_SHA256_PATTERN.test(options.principalIdentity))
      throw new McpBoundaryError(
        'mcp.edit-resource-principal-invalid',
        'resource principal identity must be SHA-256'
      )
    this.#principalIdentity = options.principalIdentity
    this.#storeIdentitySha256 = storeIdentitySha256V1(capability.storeId)
    this.refreshRetained()
  }

  refreshRetained(): void
  {
    let metadata
    try
    {
      metadata = this.#store.listImmutableMetadata(
        CATALOGUE_PREFIX,
        MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES + 1
      )
    }
    catch (error)
    {
      throw new McpBoundaryError(
        error instanceof DurableArtifactStoreError &&
          error.code === 'too-many-entries'
          ? 'mcp.edit-artifact-catalogue-limit'
          : 'mcp.edit-artifact-catalogue-invalid',
        error instanceof Error
          ? error.message
          : 'retained resource catalogue could not be enumerated'
      )
    }
    if (metadata.length > MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES)
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-limit',
        'retained artifact catalogue exceeds its entry limit'
      )
    let aggregateBytes = 0
    for (const entry of metadata)
    {
      aggregateBytes += entry.byteLength
      if (
        entry.byteLength > MAX_DESCRIPTOR_BYTES ||
        aggregateBytes > MAX_CATALOGUE_BYTES
      )
        throw new McpBoundaryError(
          'mcp.edit-artifact-catalogue-limit',
          'retained artifact catalogue exceeds its descriptor byte limit'
        )
    }
    const retained = metadata
      .slice()
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((entry): EditArtifactCatalogueResolutionV1 =>
      {
        const matched = DESCRIPTOR_KEY_PATTERN.exec(entry.key)
        if (matched === null)
          throw new McpBoundaryError(
            'mcp.edit-artifact-catalogue-invalid',
            'retained resource catalogue contains an invalid descriptor key'
          )
        const bytes = this.#store.readImmutable(entry.key)
        if (bytes.byteLength !== entry.byteLength)
          throw new McpBoundaryError(
            'mcp.edit-artifact-catalogue-invalid',
            'retained resource descriptor changed during refresh'
          )
        const descriptor = decodeDescriptorV1(bytes, {
          storeIdentitySha256: this.#storeIdentitySha256,
          sessionStoreKey: matched[1]!,
          locatorDigest: matched[2]!,
        })
        return Object.freeze({
          claims: claimsV1(descriptor, this.#principalIdentity),
          logicalKey: descriptor.logicalKey,
        })
      })
    this.#retained = Object.freeze(retained)
  }

  listRetained(): readonly ScratchEditResourceMacInputV1[]
  {
    return Object.freeze(this.#retained.map((entry) => entry.claims))
  }

  resolveRetained(
    sessionStoreKey: string,
    locatorDigest: string
  ): readonly EditArtifactCatalogueResolutionV1[]
  {
    const key = catalogueKeyV1(sessionStoreKey, locatorDigest)
    let bytes: Uint8Array
    try
    {
      bytes = this.#store.readImmutable(key)
    }
    catch (error)
    {
      if (
        error instanceof DurableArtifactStoreError &&
        error.code === 'entry-not-found'
      )
        return Object.freeze([])
      throw error
    }
    const descriptor = decodeDescriptorV1(bytes, {
      storeIdentitySha256: this.#storeIdentitySha256,
      sessionStoreKey,
      locatorDigest,
    })
    return Object.freeze([
      Object.freeze({
        claims: claimsV1(descriptor, this.#principalIdentity),
        logicalKey: descriptor.logicalKey,
      }),
    ])
  }

  readRetained(input: EditArtifactCatalogueResolutionV1): Uint8Array
  {
    const expectedLocatorDigest = editResourceLocatorDigestV1(
      'retained-artifact',
      {
        storeIdentitySha256: this.#storeIdentitySha256,
        logicalKey: input.logicalKey,
      }
    )
    if (
      input.claims.locatorKind !== 'retained-artifact' ||
      input.claims.locatorDigest !== expectedLocatorDigest ||
      input.claims.revisionOrStoreIdentity.kind !== 'store' ||
      input.claims.revisionOrStoreIdentity.storeIdentitySha256 !==
        this.#storeIdentitySha256
    )
      throw new McpBoundaryError(
        'mcp.edit-artifact-capability-invalid',
        'artifact capability is invalid or no longer resolvable'
      )
    const bytes = this.#store.readImmutable(input.logicalKey)
    const contentSha256 = createHash('sha256').update(bytes).digest('hex')
    if (
      bytes.byteLength !== input.claims.byteLength ||
      bytes.byteLength > MAX_EDIT_RESOURCE_BYTES ||
      contentSha256 !== input.claims.contentSha256
    )
      throw new McpBoundaryError(
        'mcp.edit-artifact-capability-invalid',
        'retained artifact bytes no longer match the capability'
      )
    return bytes
  }
}
