// packages/mcp/src/edit/edit-resources.ts
// stateless HMAC capabilities for bounded retained edit artifacts

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { DEFAULT_PHASE_8_RESOURCE_POLICY } from '@scratch-agent/edit'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import { McpBoundaryError } from '../transport/errors.js'

export const EDIT_ARTIFACT_URI_SCHEME = 'scratch-edit:'
export const MAX_EDIT_RESOURCE_BYTES = 5 * 1024 * 1024
export const MAX_EDIT_RESOURCE_PAGE_SIZE =
  DEFAULT_PHASE_8_RESOURCE_POLICY.mcpPageItems
export const MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES = 10_000
export const MAX_COMBINED_RESOURCE_LIST_BYTES = 8 * 1024 * 1024

const RESOURCE_DOMAIN_PREFIX = 'scratch-agent:resource-capability:v1'
const RESOURCE_TOKEN_VERSION = 1
const RESOURCE_TOKEN_RAW_BYTES = 81
const RESOURCE_TOKEN_CHARACTERS = 108
const SESSION_STORE_KEY_BYTES = 16
const LOCATOR_DIGEST_BYTES = 32
const RESOURCE_TAG_BYTES = 32
const RESOURCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{108}$/u
const SESSION_STORE_KEY_PATTERN = /^[0-9a-f]{32}$/u
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u
const MIME_TYPE_PATTERN = /^[\x20-\x7e]{1,256}$/u

const LIST_CURSOR_VERSION = 1
const LIST_CURSOR_COLLECTION_BYTES = 32
const LIST_CURSOR_MAC_BYTES = 32
const LIST_CURSOR_BODY_BYTES = 1 + 4 + LIST_CURSOR_COLLECTION_BYTES
const LIST_CURSOR_RAW_BYTES = LIST_CURSOR_BODY_BYTES + LIST_CURSOR_MAC_BYTES
const LIST_CURSOR_CHARACTERS = 92
const LIST_CURSOR_PATTERN = /^[A-Za-z0-9_-]{92}$/u

export interface ScratchEditResourceMacInputV1
{
  readonly schemaVersion: 1
  readonly tokenVersion: 1
  readonly sessionStoreKey: string
  readonly principalIdentity: string
  readonly sessionId: string
  readonly revisionOrStoreIdentity:
    | { readonly kind: 'revision'; readonly revisionId: string }
    | { readonly kind: 'store'; readonly storeIdentitySha256: string }
  readonly locatorKind: 'retained-artifact' | 'exact-virtual-slice'
  readonly locatorDigest: string
  readonly contentSha256: string
  readonly mimeType: string
  readonly byteLength: number
}

export interface ParsedEditResourceTokenV1
{
  readonly tokenVersion: 1
  readonly sessionStoreKey: string
  readonly locatorDigest: string
  readonly tag: Uint8Array
}

export interface EditArtifactCatalogueResolutionV1
{
  readonly claims: ScratchEditResourceMacInputV1
  // internal store authority only; this value never enters a URI or MCP result
  readonly logicalKey: string
}

export interface EditArtifactCataloguePortV1
{
  // this is a view over already-retained authority, never an issuance registry
  refreshRetained(): void
  listRetained(): readonly ScratchEditResourceMacInputV1[]
  resolveRetained(
    sessionStoreKey: string,
    locatorDigest: string
  ): readonly EditArtifactCatalogueResolutionV1[]
  readRetained(input: EditArtifactCatalogueResolutionV1): Uint8Array
}

export interface EditArtifactResourceStoreOptionsV1
{
  readonly principalIdentity: string
  readonly resourceSecret: Uint8Array
  readonly catalogue: EditArtifactCataloguePortV1
  readonly listingCursorSecret: Uint8Array
}

export interface EditArtifactRecordV1
{
  readonly token: string
  readonly uri: string
  readonly macInput: ScratchEditResourceMacInputV1
}

export interface ResourceListEntryV1
{
  readonly uri: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
}

export interface EditResourceListingV1
{
  readonly resources: readonly ResourceListEntryV1[]
  readonly nextCursor: string | null
}

export interface EditResourceContentV1
{
  readonly uri: string
  readonly mimeType: string
  readonly text?: string
  readonly blob?: string
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function invalidCapability(): never
{
  throw new McpBoundaryError(
    'mcp.edit-artifact-capability-invalid',
    'artifact capability is invalid or no longer resolvable'
  )
}

function assertSecret(secret: Uint8Array, purpose: string): Buffer
{
  if (
    !(secret instanceof Uint8Array) ||
    secret.byteLength < 32 ||
    secret.byteLength > 128
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-resource-secret-invalid',
      `${purpose} secret must carry 256 through 1024 bits`
    )
  }
  return Buffer.from(secret)
}

function assertMacInput(
  input: ScratchEditResourceMacInputV1
): ScratchEditResourceMacInputV1
{
  const identity = input.revisionOrStoreIdentity
  const identityValid =
    identity.kind === 'revision'
      ? LOWERCASE_SHA256_PATTERN.test(identity.revisionId)
      : identity.kind === 'store' &&
        LOWERCASE_SHA256_PATTERN.test(identity.storeIdentitySha256)
  if (
    input.schemaVersion !== 1 ||
    input.tokenVersion !== RESOURCE_TOKEN_VERSION ||
    !SESSION_STORE_KEY_PATTERN.test(input.sessionStoreKey) ||
    !LOWERCASE_SHA256_PATTERN.test(input.principalIdentity) ||
    !OPAQUE_ID_PATTERN.test(input.sessionId) ||
    !identityValid ||
    (input.locatorKind !== 'retained-artifact' &&
      input.locatorKind !== 'exact-virtual-slice') ||
    !LOWERCASE_SHA256_PATTERN.test(input.locatorDigest) ||
    !LOWERCASE_SHA256_PATTERN.test(input.contentSha256) ||
    !MIME_TYPE_PATTERN.test(input.mimeType) ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 0 ||
    input.byteLength > MAX_EDIT_RESOURCE_BYTES
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained artifact catalogue claims are invalid'
    )
  }
  return input
}

function exactMacInput(
  input: ScratchEditResourceMacInputV1
): ScratchEditResourceMacInputV1
{
  assertMacInput(input)
  return Object.freeze({
    schemaVersion: 1,
    tokenVersion: 1,
    sessionStoreKey: input.sessionStoreKey,
    principalIdentity: input.principalIdentity,
    sessionId: input.sessionId,
    revisionOrStoreIdentity:
      input.revisionOrStoreIdentity.kind === 'revision'
        ? Object.freeze({
            kind: 'revision' as const,
            revisionId: input.revisionOrStoreIdentity.revisionId,
          })
        : Object.freeze({
            kind: 'store' as const,
            storeIdentitySha256:
              input.revisionOrStoreIdentity.storeIdentitySha256,
          }),
    locatorKind: input.locatorKind,
    locatorDigest: input.locatorDigest,
    contentSha256: input.contentSha256,
    mimeType: input.mimeType,
    byteLength: input.byteLength,
  })
}

export function editResourceLocatorDigestV1(
  locatorKind: ScratchEditResourceMacInputV1['locatorKind'],
  exactLocatorIdentity: unknown
): string
{
  return createHash('sha256')
    .update('scratch-agent:resource-locator:v1', 'utf8')
    .update(Buffer.from([0]))
    .update(
      canonicalJsonBytesV1({
        schemaVersion: 1,
        locatorKind,
        exactLocatorIdentity,
      })
    )
    .digest('hex')
}

export function editResourceCapabilityPreimageV1(
  input: ScratchEditResourceMacInputV1
): Uint8Array
{
  return exactEditResourceCapabilityPreimageV1(exactMacInput(input))
}

function exactEditResourceCapabilityPreimageV1(
  claims: ScratchEditResourceMacInputV1
): Uint8Array
{
  return Buffer.concat([
    Buffer.from(RESOURCE_DOMAIN_PREFIX, 'utf8'),
    Buffer.from([0]),
    Buffer.from(canonicalJsonBytesV1(claims)),
  ])
}

function decodeCanonicalResourceToken(token: string): Buffer
{
  if (!RESOURCE_TOKEN_PATTERN.test(token)) invalidCapability()
  const bytes = Buffer.from(token, 'base64url')
  if (
    bytes.byteLength !== RESOURCE_TOKEN_RAW_BYTES ||
    bytes.toString('base64url') !== token
  )
    invalidCapability()
  return bytes
}

export function parseEditResourceTokenV1(
  token: string
): ParsedEditResourceTokenV1
{
  const bytes = decodeCanonicalResourceToken(token)
  if (bytes.readUInt8(0) !== RESOURCE_TOKEN_VERSION) invalidCapability()
  return Object.freeze({
    tokenVersion: 1,
    sessionStoreKey: bytes
      .subarray(1, 1 + SESSION_STORE_KEY_BYTES)
      .toString('hex'),
    locatorDigest: bytes
      .subarray(
        1 + SESSION_STORE_KEY_BYTES,
        1 + SESSION_STORE_KEY_BYTES + LOCATOR_DIGEST_BYTES
      )
      .toString('hex'),
    tag: Uint8Array.from(
      bytes.subarray(
        1 + SESSION_STORE_KEY_BYTES + LOCATOR_DIGEST_BYTES,
        RESOURCE_TOKEN_RAW_BYTES
      )
    ),
  })
}

export function issueEditResourceTokenV1(
  secret: Uint8Array,
  input: ScratchEditResourceMacInputV1
): string
{
  const claims = exactMacInput(input)
  const tag = createHmac('sha256', assertSecret(secret, 'resource capability'))
    .update(exactEditResourceCapabilityPreimageV1(claims))
    .digest()
  const raw = Buffer.concat([
    Buffer.from([RESOURCE_TOKEN_VERSION]),
    Buffer.from(claims.sessionStoreKey, 'hex'),
    Buffer.from(claims.locatorDigest, 'hex'),
    tag,
  ])
  const token = raw.toString('base64url')
  if (
    raw.byteLength !== RESOURCE_TOKEN_RAW_BYTES ||
    token.length !== RESOURCE_TOKEN_CHARACTERS ||
    !RESOURCE_TOKEN_PATTERN.test(token)
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-artifact-capability-invalid',
      'artifact capability encoder violated the frozen token contract'
    )
  }
  return token
}

export function verifyEditResourceTokenV1(
  secret: Uint8Array,
  token: string,
  input: ScratchEditResourceMacInputV1
): boolean
{
  let parsed: ParsedEditResourceTokenV1
  try
  {
    parsed = parseEditResourceTokenV1(token)
  }
  catch
  {
    return false
  }
  const claims = exactMacInput(input)
  if (
    parsed.sessionStoreKey !== claims.sessionStoreKey ||
    parsed.locatorDigest !== claims.locatorDigest
  )
    return false
  const expected = createHmac(
    'sha256',
    assertSecret(secret, 'resource capability')
  )
    .update(exactEditResourceCapabilityPreimageV1(claims))
    .digest()
  const presented = Buffer.from(parsed.tag)
  return (
    presented.byteLength === RESOURCE_TAG_BYTES &&
    timingSafeEqual(presented, expected)
  )
}

export function editArtifactUriV1(token: string): string
{
  if (!RESOURCE_TOKEN_PATTERN.test(token)) invalidCapability()
  return `scratch-edit://artifact/${token}`
}

export function parseEditArtifactUriV1(uri: string): string
{
  let parsed: URL
  try
  {
    parsed = new URL(uri)
  }
  catch
  {
    return invalidCapability()
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (
    parsed.protocol !== EDIT_ARTIFACT_URI_SCHEME ||
    parsed.hostname !== 'artifact' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parts.length !== 1 ||
    !RESOURCE_TOKEN_PATTERN.test(parts[0]!)
  )
    return invalidCapability()
  return parts[0]!
}

function listingCollectionDigest(
  resources: readonly ResourceListEntryV1[]
): Buffer
{
  return createHash('sha256')
    .update(
      canonicalJsonBytesV1({
        schemaVersion: 1,
        resources: resources.map((entry) => ({ ...entry })),
      })
    )
    .digest()
}

function exactCombinedResources(
  collections: readonly (readonly ResourceListEntryV1[])[]
): readonly ResourceListEntryV1[]
{
  let entryCount = 0
  for (const collection of collections)
  {
    if (!Array.isArray(collection))
    {
      throw new McpBoundaryError(
        'mcp.resource-list-invalid',
        'resource listing collection is invalid'
      )
    }
    entryCount += collection.length
    if (entryCount > MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES)
    {
      throw new McpBoundaryError(
        'mcp.resource-list-limit',
        'combined resource listing exceeds its bounded catalogue limit'
      )
    }
  }
  let metadataBytes = 0
  const resources = collections
    .flatMap((collection) => [...collection])
    .map((entry) =>
    {
      if (
        typeof entry.uri !== 'string' ||
        entry.uri.length < 1 ||
        Buffer.byteLength(entry.uri, 'utf8') > 2048 ||
        typeof entry.name !== 'string' ||
        entry.name.length < 1 ||
        Buffer.byteLength(entry.name, 'utf8') > 256 ||
        !MIME_TYPE_PATTERN.test(entry.mimeType) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > MAX_EDIT_RESOURCE_BYTES
      )
      {
        throw new McpBoundaryError(
          'mcp.resource-list-invalid',
          'resource listing contains invalid metadata'
        )
      }
      metadataBytes +=
        Buffer.byteLength(entry.uri, 'utf8') +
        Buffer.byteLength(entry.name, 'utf8') +
        Buffer.byteLength(entry.mimeType, 'utf8') +
        32
      if (metadataBytes > MAX_COMBINED_RESOURCE_LIST_BYTES)
      {
        throw new McpBoundaryError(
          'mcp.resource-list-limit',
          'combined resource listing exceeds its bounded metadata limit'
        )
      }
      return Object.freeze({ ...entry })
    })
    .sort((left, right) =>
      left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0
    )
  if (resources.length > MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES)
  {
    throw new McpBoundaryError(
      'mcp.resource-list-limit',
      'combined resource listing exceeds its bounded catalogue limit'
    )
  }
  for (let index = 1; index < resources.length; index++)
    if (resources[index - 1]!.uri === resources[index]!.uri)
    {
      throw new McpBoundaryError(
        'mcp.resource-list-collision',
        'combined resource listing contains a duplicate URI'
      )
    }
  return Object.freeze(resources)
}

export class CombinedResourceListingAuthorityV1
{
  readonly #secret: Buffer
  readonly #principalIdentity: string

  constructor(secret: Uint8Array, principalIdentity: string)
  {
    this.#secret = assertSecret(secret, 'resource-list cursor')
    if (!LOWERCASE_SHA256_PATTERN.test(principalIdentity))
    {
      throw new McpBoundaryError(
        'mcp.edit-resource-principal-invalid',
        'resource-list cursor principal identity must be SHA-256'
      )
    }
    this.#principalIdentity = principalIdentity
  }

  list(
    collections: readonly (readonly ResourceListEntryV1[])[],
    cursor?: unknown,
    pageSize: number = MAX_EDIT_RESOURCE_PAGE_SIZE
  ): EditResourceListingV1
  {
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_EDIT_RESOURCE_PAGE_SIZE
    )
    {
      throw new McpBoundaryError(
        'mcp.resource-page-invalid',
        `resource page size must be an integer from 1 to ${MAX_EDIT_RESOURCE_PAGE_SIZE}`
      )
    }
    const resources = exactCombinedResources(collections)
    const collectionDigest = listingCollectionDigest(resources)
    const offset = this.#offset(cursor, collectionDigest)
    if (offset > resources.length)
    {
      throw new McpBoundaryError(
        'mcp.resource-cursor-stale',
        'resource cursor offset exceeds the current collection'
      )
    }
    const page = resources.slice(offset, offset + pageSize)
    const nextOffset = offset + page.length
    return Object.freeze({
      resources: Object.freeze(page),
      nextCursor:
        nextOffset < resources.length
          ? this.#issue(nextOffset, collectionDigest)
          : null,
    })
  }

  #issue(offset: number, collectionDigest: Buffer): string
  {
    const body = Buffer.alloc(LIST_CURSOR_BODY_BYTES)
    body.writeUInt8(LIST_CURSOR_VERSION, 0)
    body.writeUInt32BE(offset, 1)
    collectionDigest.copy(body, 5)
    const token = Buffer.concat([body, this.#mac(body)]).toString('base64url')
    if (
      token.length !== LIST_CURSOR_CHARACTERS ||
      !LIST_CURSOR_PATTERN.test(token)
    )
    {
      throw new McpBoundaryError(
        'mcp.resource-cursor-invalid',
        'resource cursor encoder violated its bounded token contract'
      )
    }
    return token
  }

  #offset(value: unknown, collectionDigest: Buffer): number
  {
    if (value === undefined || value === null) return 0
    if (typeof value !== 'string' || !LIST_CURSOR_PATTERN.test(value))
    {
      throw new McpBoundaryError(
        'mcp.resource-cursor-invalid',
        'resource cursor is invalid'
      )
    }
    const token = Buffer.from(value, 'base64url')
    if (
      token.byteLength !== LIST_CURSOR_RAW_BYTES ||
      token.toString('base64url') !== value ||
      token.readUInt8(0) !== LIST_CURSOR_VERSION
    )
    {
      throw new McpBoundaryError(
        'mcp.resource-cursor-invalid',
        'resource cursor is invalid'
      )
    }
    const body = token.subarray(0, LIST_CURSOR_BODY_BYTES)
    const presented = token.subarray(LIST_CURSOR_BODY_BYTES)
    const expected = this.#mac(body)
    if (!timingSafeEqual(presented, expected))
    {
      throw new McpBoundaryError(
        'mcp.resource-cursor-invalid',
        'resource cursor signature is invalid'
      )
    }
    if (!timingSafeEqual(body.subarray(5), collectionDigest))
    {
      throw new McpBoundaryError(
        'mcp.resource-cursor-stale',
        'resource cursor belongs to a different collection'
      )
    }
    return body.readUInt32BE(1)
  }

  #mac(body: Buffer): Buffer
  {
    return createHmac('sha256', this.#secret)
      .update('scratch-edit/resource-list-cursor/v1', 'utf8')
      .update(Buffer.from([0]))
      .update(this.#principalIdentity, 'utf8')
      .update(Buffer.from([0]))
      .update(body)
      .digest()
  }
}

function exactCatalogueList(
  value: unknown
): readonly ScratchEditResourceMacInputV1[]
{
  if (
    !Array.isArray(value) ||
    value.length > MAX_EDIT_RESOURCE_CATALOGUE_ENTRIES
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-limit',
      'retained artifact catalogue exceeds its bounded entry limit'
    )
  }
  return Object.freeze([...(value as ScratchEditResourceMacInputV1[])])
}

function exactCatalogueMatches(
  value: unknown
): readonly EditArtifactCatalogueResolutionV1[]
{
  if (!Array.isArray(value) || value.length > 2)
  {
    throw new McpBoundaryError(
      'mcp.edit-artifact-catalogue-invalid',
      'retained artifact lookup violated its bounded exact-match contract'
    )
  }
  for (const match of value)
  {
    if (
      match === null ||
      typeof match !== 'object' ||
      !('claims' in match) ||
      !('logicalKey' in match) ||
      typeof match.logicalKey !== 'string'
    )
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-invalid',
        'retained artifact lookup returned an invalid resolution'
      )
  }
  return Object.freeze([...(value as EditArtifactCatalogueResolutionV1[])])
}

export class EditArtifactResourceStoreV1
{
  readonly #catalogue: EditArtifactCataloguePortV1
  readonly #listing: CombinedResourceListingAuthorityV1
  readonly #principalIdentity: string
  readonly #resourceSecret: Buffer

  constructor(options: EditArtifactResourceStoreOptionsV1)
  {
    if (options === null || typeof options !== 'object')
    {
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-invalid',
        'retained artifact authority options are unavailable'
      )
    }
    if (!LOWERCASE_SHA256_PATTERN.test(options.principalIdentity))
    {
      throw new McpBoundaryError(
        'mcp.edit-resource-principal-invalid',
        'resource principal identity must be SHA-256'
      )
    }
    if (
      !options.catalogue ||
      typeof options.catalogue.refreshRetained !== 'function' ||
      typeof options.catalogue.listRetained !== 'function' ||
      typeof options.catalogue.resolveRetained !== 'function' ||
      typeof options.catalogue.readRetained !== 'function'
    )
    {
      throw new McpBoundaryError(
        'mcp.edit-artifact-catalogue-invalid',
        'retained artifact catalogue port is unavailable'
      )
    }
    this.#catalogue = Object.freeze({
      refreshRetained: options.catalogue.refreshRetained.bind(
        options.catalogue
      ),
      listRetained: options.catalogue.listRetained.bind(options.catalogue),
      resolveRetained: options.catalogue.resolveRetained.bind(
        options.catalogue
      ),
      readRetained: options.catalogue.readRetained.bind(options.catalogue),
    })
    this.#principalIdentity = options.principalIdentity
    this.#resourceSecret = assertSecret(
      options.resourceSecret,
      'resource capability'
    )
    const listingCursorSecret = assertSecret(
      options.listingCursorSecret,
      'resource-list cursor'
    )
    if (listingCursorSecret.equals(this.#resourceSecret))
    {
      throw new McpBoundaryError(
        'mcp.edit-resource-secret-invalid',
        'resource capability and resource-list cursor secrets must be distinct'
      )
    }
    this.#listing = new CombinedResourceListingAuthorityV1(
      listingCursorSecret,
      this.#principalIdentity
    )
  }

  refresh(): void
  {
    this.#catalogue.refreshRetained()
  }

  listAll(): readonly ResourceListEntryV1[]
  {
    const retained = exactCatalogueList(this.#catalogue.listRetained())
    const seen = new Set<string>()
    const resources: ResourceListEntryV1[] = []
    for (const candidate of retained)
    {
      const input = exactMacInput(candidate)
      const lookupKey = `${input.sessionStoreKey}\u0000${input.locatorDigest}`
      if (seen.has(lookupKey))
      {
        throw new McpBoundaryError(
          'mcp.edit-artifact-catalogue-collision',
          'retained artifact catalogue has an ambiguous locator'
        )
      }
      seen.add(lookupKey)
      if (input.principalIdentity !== this.#principalIdentity) continue
      const token = issueEditResourceTokenV1(this.#resourceSecret, input)
      resources.push(
        Object.freeze({
          uri: editArtifactUriV1(token),
          name: `artifact-${input.contentSha256.slice(0, 16)}`,
          mimeType: input.mimeType,
          size: input.byteLength,
        })
      )
    }
    return exactCombinedResources([resources])
  }

  list(cursor?: unknown): EditResourceListingV1
  {
    return this.#listing.list([this.listAll()], cursor)
  }

  listCombined(
    otherCollections: readonly (readonly ResourceListEntryV1[])[],
    cursor?: unknown
  ): EditResourceListingV1
  {
    return this.#listing.list([...otherCollections, this.listAll()], cursor)
  }

  read(uri: string): EditResourceContentV1
  {
    let token: string
    let parsed: ParsedEditResourceTokenV1
    let matches: readonly EditArtifactCatalogueResolutionV1[]
    try
    {
      token = parseEditArtifactUriV1(uri)
      parsed = parseEditResourceTokenV1(token)
      matches = exactCatalogueMatches(
        this.#catalogue.resolveRetained(
          parsed.sessionStoreKey,
          parsed.locatorDigest
        )
      )
      if (matches.length !== 1) return invalidCapability()
    }
    catch
    {
      return invalidCapability()
    }
    const resolution = matches[0]!
    const input = exactMacInput(resolution.claims)
    if (
      input.principalIdentity !== this.#principalIdentity ||
      !verifyEditResourceTokenV1(this.#resourceSecret, token, input)
    )
      return invalidCapability()

    let bytes: Uint8Array
    try
    {
      bytes = Uint8Array.from(this.#catalogue.readRetained(resolution))
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.edit-artifact-read-failed',
        'artifact could not be read safely'
      )
    }
    if (
      bytes.byteLength !== input.byteLength ||
      bytes.byteLength > MAX_EDIT_RESOURCE_BYTES ||
      sha256(bytes) !== input.contentSha256
    )
    {
      throw new McpBoundaryError(
        'mcp.edit-artifact-read-failed',
        'artifact identity changed after capability verification'
      )
    }
    const base = { uri, mimeType: input.mimeType }
    return Object.freeze(
      input.mimeType.startsWith('text/') ||
        input.mimeType === 'application/json'
        ? { ...base, text: Buffer.from(bytes).toString('utf8') }
        : { ...base, blob: Buffer.from(bytes).toString('base64') }
    )
  }
}
