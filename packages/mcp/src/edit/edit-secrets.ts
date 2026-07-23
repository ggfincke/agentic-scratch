// packages/mcp/src/edit/edit-secrets.ts
// parse purpose-separated edit host secrets into an in-memory audit keyring

import {
  AUDIT_KEY_PURPOSE_V1,
  type AuditKeyMaterialV1,
  type AuditKeyProviderPort,
  type AuditKeyUnavailableErrorV1,
} from '@scratch-agent/edit'
import { scanStrictJson } from '@scratch-agent/sb3'

import { hasExactObjectKeysV1 } from '../internal/exact-object-keys.js'
import { McpBoundaryError } from '../transport/errors.js'

const KEY_ID = /^[A-Za-z0-9_-]{8,128}$/u
const BASE64URL = /^[A-Za-z0-9_-]{43,171}$/u
const MAX_SECRET_MATERIAL_BYTES = 64 * 1024
const SECRET_LABELS = [
  'handle',
  'paginationCursor',
  'resourceCapability',
  'resourceListingCursor',
] as const

type EditSecretLabelV1 = (typeof SECRET_LABELS)[number]

interface ParsedKeyV1
{
  readonly auditKeyId: string
  readonly secret: Uint8Array
}

class EditAuditKeyUnavailableErrorV1
  extends Error
  implements AuditKeyUnavailableErrorV1
{
  readonly code = 'edit.audit-key-unavailable'

  constructor(
    readonly auditKeyId: string,
    readonly reason: 'missing' | 'retired'
  )
  {
    super(`audit verification key is ${reason}`)
    this.name = 'EditAuditKeyUnavailableErrorV1'
  }
}

class EditAuditKeyringV1 implements AuditKeyProviderPort
{
  readonly #activeKeyId: string
  readonly #keys: ReadonlyMap<string, Uint8Array>
  readonly #retired: ReadonlySet<string>

  constructor(input: {
    readonly activeKeyId: string
    readonly keys: readonly ParsedKeyV1[]
    readonly retiredKeyIds: readonly string[]
  })
  {
    this.#activeKeyId = input.activeKeyId
    this.#keys = new Map(
      input.keys.map((key) => [key.auditKeyId, Uint8Array.from(key.secret)])
    )
    this.#retired = new Set(input.retiredKeyIds)
  }

  activeKey(): Promise<AuditKeyMaterialV1>
  {
    return this.verificationKey(this.#activeKeyId)
  }

  async verificationKey(auditKeyId: string): Promise<AuditKeyMaterialV1>
  {
    const secret = this.#keys.get(auditKeyId)
    if (secret === undefined)
    {
      throw new EditAuditKeyUnavailableErrorV1(
        auditKeyId,
        this.#retired.has(auditKeyId) ? 'retired' : 'missing'
      )
    }
    return Object.freeze({
      auditKeyId,
      algorithm: 'HMAC-SHA-256' as const,
      algorithmVersion: 1 as const,
      purpose: AUDIT_KEY_PURPOSE_V1,
      secret: Uint8Array.from(secret),
    })
  }
}

export interface EditMcpSecretMaterialV1
{
  readonly handleSecret: Uint8Array
  readonly paginationCursorSecret: Uint8Array
  readonly resourceCapabilitySecret: Uint8Array
  readonly resourceListingCursorSecret: Uint8Array
  readonly auditKeys: AuditKeyProviderPort
  readonly activeAuditKeyId: string
}

function recordV1(value: unknown, label: string): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      `${label} must be one closed object`
    )
  }
  return value as Record<string, unknown>
}

function exactKeysV1(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void
{
  if (!hasExactObjectKeysV1(value, expected))
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      `${label} has missing or unknown fields`
    )
  }
}

function secretV1(value: unknown, label: string): Uint8Array
{
  if (typeof value !== 'string' || !BASE64URL.test(value))
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      `${label} is not canonical bounded base64url`
    )
  }
  const bytes = Buffer.from(value, 'base64url')
  if (
    bytes.toString('base64url') !== value ||
    bytes.byteLength < 32 ||
    bytes.byteLength > 128
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      `${label} must decode to 32 through 128 bytes`
    )
  }
  return Uint8Array.from(bytes)
}

function keyIdV1(value: unknown, label: string): string
{
  if (typeof value !== 'string' || !KEY_ID.test(value))
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      `${label} is not a bounded opaque key ID`
    )
  }
  return value
}

export function parseEditMcpSecretMaterialV1(
  bytes: Uint8Array
): EditMcpSecretMaterialV1
{
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_SECRET_MATERIAL_BYTES
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'edit secret material exceeds its bounded input size'
    )
  }
  let value: unknown
  try
  {
    value = scanStrictJson(bytes, {
      maxDepth: 6,
      maxMembersPerContainer: 64,
      maxNodes: 512,
    }).value
  }
  catch
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'edit secret material is not strict bounded JSON'
    )
  }
  const root = recordV1(value, 'edit secret material')
  exactKeysV1(
    root,
    [
      'activeAuditKeyId',
      'auditKeys',
      'retiredAuditKeyIds',
      'schemaVersion',
      ...SECRET_LABELS,
    ],
    'edit secret material'
  )
  if (root.schemaVersion !== 1)
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'edit secret material schema version is unsupported'
    )
  }
  const purposeSecrets = Object.fromEntries(
    SECRET_LABELS.map((label) => [label, secretV1(root[label], label)])
  ) as Record<EditSecretLabelV1, Uint8Array>
  if (!Array.isArray(root.auditKeys) || root.auditKeys.length < 1)
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'edit secret material must retain at least one audit key'
    )
  }
  if (root.auditKeys.length > 32)
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'edit secret material retains too many audit keys'
    )
  }
  const keys = root.auditKeys.map((candidate, index) =>
  {
    const key = recordV1(candidate, `audit key ${index}`)
    exactKeysV1(key, ['auditKeyId', 'secret'], `audit key ${index}`)
    return Object.freeze({
      auditKeyId: keyIdV1(key.auditKeyId, `audit key ${index}`),
      secret: secretV1(key.secret, `audit key ${index}`),
    })
  })
  const activeAuditKeyId = keyIdV1(root.activeAuditKeyId, 'active audit key ID')
  if (!keys.some((key) => key.auditKeyId === activeAuditKeyId))
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'active audit key ID has no retained key material'
    )
  }
  const retired = root.retiredAuditKeyIds
  if (
    !Array.isArray(retired) ||
    retired.length > 128 ||
    retired.some((value) => typeof value !== 'string' || !KEY_ID.test(value))
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'retired audit key IDs are not one bounded key-ID collection'
    )
  }
  const keyIds = new Set<string>()
  const secretDigests = new Set<string>()
  for (const [purpose, secret] of [
    ...SECRET_LABELS.map((label) => [label, purposeSecrets[label]] as const),
    ...keys.map((key) => [`audit:${key.auditKeyId}`, key.secret] as const),
  ])
  {
    const digest = Buffer.from(secret).toString('hex')
    if (secretDigests.has(digest))
    {
      throw new McpBoundaryError(
        'mcp.edit-secret-config-invalid',
        `secret material reuses bytes across purpose ${purpose}`
      )
    }
    secretDigests.add(digest)
  }
  for (const key of keys)
  {
    if (keyIds.has(key.auditKeyId))
    {
      throw new McpBoundaryError(
        'mcp.edit-secret-config-invalid',
        'audit key material repeats one key ID'
      )
    }
    keyIds.add(key.auditKeyId)
  }
  const retiredKeyIds = retired as string[]
  if (
    new Set(retiredKeyIds).size !== retiredKeyIds.length ||
    retiredKeyIds.some((id) => keyIds.has(id))
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-secret-config-invalid',
      'retired audit key IDs overlap or repeat retained keys'
    )
  }
  return Object.freeze({
    handleSecret: purposeSecrets.handle,
    paginationCursorSecret: purposeSecrets.paginationCursor,
    resourceCapabilitySecret: purposeSecrets.resourceCapability,
    resourceListingCursorSecret: purposeSecrets.resourceListingCursor,
    auditKeys: new EditAuditKeyringV1({
      activeKeyId: activeAuditKeyId,
      keys,
      retiredKeyIds,
    }),
    activeAuditKeyId,
  })
}
