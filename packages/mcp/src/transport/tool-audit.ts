// packages/mcp/src/transport/tool-audit.ts
// durable two-record global host audit journal, append mutex, tail, & reconciliation

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  AUDIT_KEY_PURPOSE_V1,
  DEFAULT_PHASE_8_RESOURCE_POLICY,
  HARD_MAXIMUM_PHASE_8_RESOURCE_POLICY,
  isAuditKeyUnavailableErrorV1,
  parseContractDefinitionV1,
  parseEditToolInputV1,
  semanticHashV1,
  SYSTEM_EDIT_CLOCK,
  type AuditKeyMaterialV1,
  type AuditKeyProviderPort,
  type AuditExpectedHeadV1,
  type AuditHeadObservationV1,
  type AuditIdempotencyBindingV1,
  type AuditPrincipalIdentityV1,
  type AuditSemanticEventCorrelationV1,
  type AuditSessionBindingV1,
  type EditClockPort,
  type EditToolReceiptFreeResultV1,
  type EditToolName,
  type NonToolReceiptFreeOutcomeHashProjectionV1,
  type ProjectToolReceiptFreeOutcomeHashProjectionV1,
  type ServerAuditBoundaryV1,
  type ServerAuditHashProjectionV1,
  type ServerAuditRecordHashProjectionV1,
  type TransportRequestHashProjectionV1,
} from '@scratch-agent/edit'
import {
  DurableArtifactStore,
  isRecoverablePartialDurableArtifactStoreRootV1,
  recoverPartialDurableArtifactStoreV1,
  type DurableArtifactOwnershipAuthority,
  type DurableArtifactFaultHook,
} from '@scratch-agent/eval'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import {
  hmacSha256Bytes,
  sha256Hex,
  timingSafeBytesEqual,
} from '@scratch-agent/sb3/crypto-node'

import type { EditToolAuditPortV1 } from '../edit/edit-tools.js'
import { McpBoundaryError } from './errors.js'
import type { JsonlBoundaryRefusalV1 } from './jsonl-boundary.js'

export const AUDIT_STORE_DIRECTORY_PREFIX = 'server-'
export const AUDIT_SERVER_MANIFEST_KEY = 'server.json'
export const AUDIT_RECOVERY_INDEX_KEY = 'recovery-index.json'
export const AUDIT_QUOTAS_KEY = 'quotas.json'
export const AUDIT_TAIL_KEY = 'audit-tail.json'
export const AUDIT_RECORD_PREFIX = 'audit'
export const AUDIT_REGISTRY_ATTEMPTS_KEY = 'registry-attempts/index.json'
export const AUDIT_SESSIONS_KEY = 'sessions/index.json'
export const AUDIT_IDEMPOTENCY_PREFIX = 'idempotency'
export const AUDIT_TERMINAL_KEY = 'terminal.json'
export const AUDIT_TERMINAL_SIDE_EFFECT_KEY = 'terminal-side-effect.json'
export const AUDIT_SUPERVISOR_DIRECTORY = 'audit-supervisor'
export const AUDIT_SUPERVISOR_MANIFEST_KEY = 'supervisor.json'
export const AUDIT_SUPERVISOR_INDEX_KEY = 'stores.json'
export const AUDIT_SUPERVISOR_TRANSITION_PREFIX = 'transitions'

const MAX_AUDIT_SUPERVISOR_TRANSITIONS_V1 = 262_144
const MAX_AUDIT_SUPERVISOR_TRANSITION_BYTES_V1 = 64 * 1024
const MAX_AUDIT_SUPERVISOR_BYTES_V1 =
  MAX_AUDIT_SUPERVISOR_TRANSITIONS_V1 * MAX_AUDIT_SUPERVISOR_TRANSITION_BYTES_V1

// * the MAC domain is part of the preimage alongside a purpose-scoped secret &
// * a purpose literal inside the signed body. All three must agree, so a token
// * minted for cursors or handles can never verify as an audit tail
export const AUDIT_MAC_DOMAIN_V1 = 'scratch-agent/server-audit-tail/v1'
export const AUDIT_ALGORITHM_V1 = 'HMAC-SHA-256'
export const AUDIT_ALGORITHM_VERSION_V1 = 1
export const AUDIT_MINIMUM_SECRET_BYTES = 32
export const AUDIT_IDEMPOTENCY_PURPOSE_V1 = 'server-audit-idempotency-outcome'
export const AUDIT_IDEMPOTENCY_MAC_DOMAIN_V1 =
  'scratch-agent/server-audit-idempotency-outcome/v1'
export const AUDIT_BOUNDARY_INPUT_DOMAIN_V1 =
  'scratch-agent/server-audit-boundary-input/v1'
export const AUDIT_SERVER_MANIFEST_MAC_DOMAIN_V1 =
  'scratch-agent/server-audit-manifest/v1'
export const AUDIT_SUPERVISOR_MAC_DOMAIN_V1 =
  'scratch-agent/server-audit-supervisor-transition/v1'
export const AUDIT_TERMINAL_SIDE_EFFECT_MAC_DOMAIN_V1 =
  'scratch-agent/server-audit-terminal-side-effect/v1'

const ZERO_SHA256 = '0'.repeat(64)

function auditOwnershipAuthorityV1(
  secret: Uint8Array,
  purpose: string
): DurableArtifactOwnershipAuthority
{
  return Object.freeze({
    ownerTokenSha256: (input: {
      readonly storeId: string
      readonly generation: number
      readonly previousOwnershipSha256: string | null
    }): string =>
      domainMacV1(secret, `scratch-agent/durable-owner/${purpose}/v1`, input),
  })
}

// one record is a bounded projection, never a payload copy, so a fixed ceiling
// is what admission multiplies to reserve durable room
export const MAX_AUDIT_RECORD_BYTES = 8 * 1024
export const MAX_AUDIT_REDACTED_FIELDS = 32
export const MAX_AUDIT_REDACTED_NAME_BYTES = 64
export const MAX_AUDIT_EVIDENCE_IDS = 16
// the retained value contains the exact bounded receipt-free edit envelope plus
// its authenticated lookup metadata. Edit responses are capped at 64 KiB.
export const MAX_AUDIT_IDEMPOTENCY_OUTCOME_BYTES = 68 * 1024
export const MAX_AUDIT_TERMINAL_SIDE_EFFECT_CONTENT_BYTES = 32 * 1024 * 1024
const MAX_AUDIT_TERMINAL_SIDE_EFFECT_ARTIFACT_BYTES = 44 * 1024 * 1024

export const HARD_AUDIT_RECORD_CAP =
  HARD_MAXIMUM_PHASE_8_RESOURCE_POLICY.auditRecordsPerServerLifetime
export const HARD_AUDIT_BYTE_CAP =
  HARD_MAXIMUM_PHASE_8_RESOURCE_POLICY.auditBytesPerServerLifetime
export const DEFAULT_AUDIT_RECORD_CAP =
  DEFAULT_PHASE_8_RESOURCE_POLICY.auditRecordsPerServerLifetime
export const DEFAULT_AUDIT_BYTE_CAP =
  DEFAULT_PHASE_8_RESOURCE_POLICY.auditBytesPerServerLifetime

// reserve is max(10% of the cap, 128 records), so raw protocol pressure
// consumes only the frozen untouched reserve
export function auditReserveRecordsV1(recordCap: number): number
{
  return Math.max(Math.ceil(recordCap / 10), 128)
}

function assertAuditCapsV1(recordCap: number, byteCap: number): void
{
  const reserve = auditReserveRecordsV1(recordCap)
  if (
    !Number.isSafeInteger(recordCap) ||
    recordCap < reserve + 4 ||
    recordCap > HARD_AUDIT_RECORD_CAP ||
    !Number.isSafeInteger(byteCap) ||
    byteCap < (reserve + 4) * MAX_AUDIT_RECORD_BYTES ||
    byteCap > HARD_AUDIT_BYTE_CAP
  )
    refuseAuditV1(
      'audit.store-invalid',
      'audit record or byte cap is outside the frozen Phase 8 authority'
    )
}

const TERMINAL_AUDIT_RECORDS = 2

export const AUDIT_INVARIANT_CODES = Object.freeze([
  'audit.append-failed',
  'audit.append-reentered',
  'audit.capacity-exhausted',
  'audit.chain-broken',
  'audit.duplicate-sequence',
  'audit.interior-tamper',
  'audit.key-unavailable',
  'audit.multiple-successors',
  'audit.record-missing',
  'audit.record-too-large',
  'audit.store-invalid',
  'audit.suffix-truncated',
  'audit.tail-unauthenticated',
  'audit.unknown-call',
] as const)

export type AuditInvariantCodeV1 = (typeof AUDIT_INVARIANT_CODES)[number]

export class AuditInvariantErrorV1 extends McpBoundaryError
{
  constructor(
    readonly invariant: AuditInvariantCodeV1,
    message: string
  )
  {
    super(invariant, message)
    this.name = 'AuditInvariantErrorV1'
  }
}

export interface AuditRedactedFieldV1
{
  readonly name: string
  readonly kind: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'
  readonly byteLength: number
}

// only framing metadata survives a raw parse failure; the frame payload itself
// is represented solely by its hash
export interface AuditFrameMetadataV1
{
  readonly frameSequence: number
  readonly rawByteLength: number
  readonly retainedByteLength: number
  readonly truncated: boolean
  readonly rawSha256: string
}

// implementation provenance is retained beside the IR-owned semantic record;
// only the frozen projection enters the receipt & predecessor hash chain
export interface AuditRecordV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-server-audit-record-v1'
  readonly storeKey: string
  readonly auditKeyId: string
  readonly algorithm: typeof AUDIT_ALGORITHM_V1
  readonly algorithmVersion: typeof AUDIT_ALGORITHM_VERSION_V1
  readonly recordSha256: string
  readonly record: ServerAuditRecordHashProjectionV1
}

// * the tail is the only mutable pointer & it is what makes total order
// * explicit. Interleaved calls are legal: a begin & its completion need not be
// * adjacent, & the previous-record hash still totally orders every record
export interface AuditTailBodyV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-server-audit-tail-v1'
  readonly purpose: typeof AUDIT_KEY_PURPOSE_V1
  readonly storeKey: string
  readonly auditKeyId: string
  readonly algorithm: typeof AUDIT_ALGORITHM_V1
  readonly algorithmVersion: typeof AUDIT_ALGORITHM_VERSION_V1
  readonly expectedNextSequence: number
  readonly currentRecordSha256: string
  readonly currentRecordKey: string | null
  readonly recordCount: number
  readonly recordBytes: number
  readonly previousTailSha256: string
}

export interface AuditTailV1
{
  readonly body: AuditTailBodyV1
  readonly mac: string
}

export interface AuditReceiptV1
{
  readonly callId: string
  readonly beginSequence: number
  readonly beginRecordSha256: string
  readonly completeSequence: number
  readonly completeRecordSha256: string
}

export interface AuditBegunCallV1
{
  readonly callId: string
  readonly sequence: number
  readonly recordSha256: string
}

export interface AuditUnmatchedBeginV1 extends AuditBegunCallV1
{
  readonly boundary: ServerAuditBoundaryV1
  readonly principal: AuditPrincipalIdentityV1
  readonly fullInputSha256: string
  readonly session: AuditSessionBindingV1
  readonly expectedHead: AuditExpectedHeadV1
  readonly idempotency: AuditIdempotencyBindingV1
  readonly retainedOutcome: AuthenticatedAuditIdempotencyOutcomeV1 | null
}

export interface AuthenticatedAuditIdempotencyOutcomeV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-server-audit-idempotency-outcome-v1'
  readonly purpose: typeof AUDIT_IDEMPOTENCY_PURPOSE_V1
  readonly storeKey: string
  readonly auditKeyId: string
  readonly algorithm: typeof AUDIT_ALGORITHM_V1
  readonly algorithmVersion: typeof AUDIT_ALGORITHM_VERSION_V1
  readonly serverInstanceId: string
  readonly runId: string
  readonly realmSha256: string
  readonly profileSha256: string
  readonly boundaryPolicySha256: string
  readonly callId: string
  readonly beginSequence: number
  readonly beginRecordSha256: string
  readonly namespaceSha256: string
  readonly requestIdSha256: string
  readonly fullInputSha256: string
  readonly boundary: Extract<
    ServerAuditBoundaryV1,
    { readonly boundaryKind: 'tool' }
  >
  readonly disposition: 'completed' | 'refused'
  readonly resultSha256: string
  readonly preHead: AuditHeadObservationV1
  readonly postHead: AuditHeadObservationV1
  readonly semanticEvent: AuditSemanticEventCorrelationV1
  readonly evidenceIds: readonly string[]
  readonly receiptFreeOutcome: EditToolReceiptFreeResultV1
  readonly receiptFreeOutcomeByteLength: number
  readonly mac: string
}

export interface AuditAdmissionV1
{
  readonly recordCap: number
  readonly byteCap: number
  readonly reserveRecords: number
  readonly reserveBytes: number
  readonly usedRecords: number
  readonly usedBytes: number
  readonly begunCalls: number
  readonly availableCallRecords: number
  readonly admitted: boolean
}

export interface AuditStoreEvidenceV1
{
  readonly storeKey: string
  readonly auditKeyId: string
  readonly authenticated: boolean
  readonly tail: AuditTailBodyV1
  readonly tailSha256: string
  readonly recordCount: number
  readonly recordBytes: number
  readonly highestSequence: number
  readonly rolledForward: boolean
}

export interface AuditTerminalEvidenceV1
{
  readonly schemaVersion: 1
  readonly storeKey: string
  readonly serverInstanceId: string
  readonly runId: string
  readonly auditKeyId: string
  readonly finalTailSha256: string
  readonly finalRecordSha256: string
  readonly recordCount: number
  readonly recordBytes: number
  readonly closeReceipt: AuditReceiptV1
  readonly terminalSha256: string
}

export interface AuditTerminalSideEffectPlanV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-server-audit-terminal-side-effect-v1'
  readonly purpose: 'terminal-side-effect'
  readonly storeKey: string
  readonly serverInstanceId: string
  readonly runId: string
  readonly auditKeyId: string
  readonly terminalSha256: string
  readonly kind: string
  readonly relativePath: string
  readonly contentSha256: string
  readonly contentByteLength: number
  readonly contentBase64: string
  readonly mac: string
}

export interface AuditTerminalSideEffectInputV1
{
  readonly kind: string
  readonly relativePath: string
  readonly content: Uint8Array
}

function auditRecordKeyV1(
  sequence: number,
  phase: ServerAuditRecordHashProjectionV1['phase'],
  recordSha256: string
): string
{
  const ordinal = String(sequence).padStart(6, '0')
  return `${AUDIT_RECORD_PREFIX}/${ordinal}-${phase}-${recordSha256.slice(0, 16)}.json`
}

const AUDIT_RECORD_KEY_PATTERN =
  /^audit\/(\d{6,})-(call-begin|call-complete|call-rejected)-([0-9a-f]{16})\.json$/

function domainPreimageV1(domainLiteral: string, value: unknown): Uint8Array
{
  const domain = new TextEncoder().encode(domainLiteral)
  const payload = canonicalJsonBytesV1(value)
  const preimage = new Uint8Array(domain.byteLength + 1 + payload.byteLength)
  preimage.set(domain, 0)
  preimage[domain.byteLength] = 0
  preimage.set(payload, domain.byteLength + 1)
  return preimage
}

function auditTailMacV1(secret: Uint8Array, body: AuditTailBodyV1): Uint8Array
{
  return hmacSha256Bytes(secret, domainPreimageV1(AUDIT_MAC_DOMAIN_V1, body))
}

function auditIdempotencyMacPreimageV1(
  outcome: Omit<AuthenticatedAuditIdempotencyOutcomeV1, 'mac'>
): Uint8Array
{
  return domainPreimageV1(AUDIT_IDEMPOTENCY_MAC_DOMAIN_V1, outcome)
}

function auditIdempotencyMacV1(
  secret: Uint8Array,
  outcome: Omit<AuthenticatedAuditIdempotencyOutcomeV1, 'mac'>
): string
{
  return Buffer.from(
    hmacSha256Bytes(secret, auditIdempotencyMacPreimageV1(outcome))
  ).toString('hex')
}

function domainMacV1(
  secret: Uint8Array,
  domainLiteral: string,
  value: unknown
): string
{
  return Buffer.from(
    hmacSha256Bytes(secret, domainPreimageV1(domainLiteral, value))
  ).toString('hex')
}

function hexBytes(value: string): Uint8Array
{
  return /^[0-9a-f]*$/.test(value) && value.length % 2 === 0
    ? Uint8Array.from(Buffer.from(value, 'hex'))
    : new Uint8Array(0)
}

function valueKindV1(value: unknown): AuditRedactedFieldV1['kind']
{
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const kind = typeof value
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return kind
  return 'object'
}

function measuredBytes(value: unknown): number
{
  return value === undefined
    ? 0
    : Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf-8')
}

function boundedName(value: string): string
{
  return Buffer.byteLength(value, 'utf-8') > MAX_AUDIT_REDACTED_NAME_BYTES
    ? `${value.slice(0, MAX_AUDIT_REDACTED_NAME_BYTES - 3)}...`
    : value
}

// * the redaction retains shape, never content: closed-schema field names plus
// * each value's kind & size. No scalar ever enters a record, so the full-input
// * hash is the only thing that can reproduce the argument
export function redactAuditArgumentV1(value: unknown): {
  readonly fields: readonly AuditRedactedFieldV1[]
  readonly truncated: boolean
}
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    return {
      fields: Object.freeze([
        Object.freeze({
          name: 'value',
          kind: valueKindV1(value),
          byteLength: measuredBytes(value),
        }),
      ]),
      truncated: false,
    }
  }
  const record = value as Record<string, unknown>
  const names = Object.keys(record).sort()
  const fields = names.slice(0, MAX_AUDIT_REDACTED_FIELDS).map((name) =>
    Object.freeze({
      name: boundedName(name),
      kind: valueKindV1(record[name]),
      byteLength: measuredBytes(record[name]),
    })
  )
  return {
    fields: Object.freeze(fields),
    truncated: names.length > MAX_AUDIT_REDACTED_FIELDS,
  }
}

function frozenDefinitionV1<T>(definition: string, value: unknown): T
{
  const parsed = parseContractDefinitionV1<T>(definition, value)
  if (!parsed.ok)
  {
    throw new McpBoundaryError(
      'mcp.audit-projection-invalid',
      `${definition} does not match the frozen Phase 8 contract`
    )
  }
  return parsed.value
}

export function editTransportRequestSha256V1<T extends EditToolName>(input: {
  readonly principalSha256: string
  readonly realmSha256: string
  readonly tool: T
  readonly request: Extract<
    TransportRequestHashProjectionV1,
    { readonly tool: T }
  >['request']
}): string
{
  const parsedRequest = parseEditToolInputV1(input.tool, input.request)
  if (!parsedRequest.ok)
    throw new McpBoundaryError(
      'mcp.audit-projection-invalid',
      `${input.tool} transport request does not match the frozen Phase 8 contract`
    )
  const projection = {
    principalSha256: frozenDefinitionV1<string>(
      'Sha256',
      input.principalSha256
    ),
    realmSha256: frozenDefinitionV1<string>('Sha256', input.realmSha256),
    tool: input.tool,
    request: parsedRequest.value,
  } as TransportRequestHashProjectionV1
  return semanticHashV1('transport-request', projection)
}

function serverAuditProjectionSha256V1(
  projection: ServerAuditHashProjectionV1
): string
{
  return semanticHashV1(
    'server-audit',
    frozenDefinitionV1<ServerAuditHashProjectionV1>(
      'ServerAuditHashProjectionV1',
      projection
    )
  )
}

export function editReceiptFreeOutcomeSha256V1(
  outcome: EditToolReceiptFreeResultV1
): string
{
  return serverAuditProjectionSha256V1({
    projectionKind: 'editReceiptFreeOutcome',
    outcome,
  })
}

export function projectReceiptFreeOutcomeSha256V1(
  outcome: ProjectToolReceiptFreeOutcomeHashProjectionV1
): string
{
  return serverAuditProjectionSha256V1({
    projectionKind: 'projectReceiptFreeOutcome',
    outcome,
  })
}

export function boundaryReceiptFreeOutcomeSha256V1(
  outcome: NonToolReceiptFreeOutcomeHashProjectionV1
): string
{
  return serverAuditProjectionSha256V1({
    projectionKind: 'boundaryReceiptFreeOutcome',
    outcome,
  })
}

export function serverAuditRecordSha256V1(
  record: ServerAuditRecordHashProjectionV1
): string
{
  const frozen = frozenDefinitionV1<ServerAuditRecordHashProjectionV1>(
    'ServerAuditRecordHashProjectionV1',
    record
  )
  return serverAuditProjectionSha256V1({
    projectionKind: 'auditRecord',
    record: frozen,
  })
}

function redactedArgumentSha256V1(value: unknown): string
{
  return sha256Hex(canonicalJsonBytesV1(redactAuditArgumentV1(value)))
}

function refuseAuditV1(code: AuditInvariantCodeV1, message: string): never
{
  throw new AuditInvariantErrorV1(code, message)
}

function parseJsonObject(
  bytes: Uint8Array,
  code: AuditInvariantCodeV1
): Record<string, unknown>
{
  let parsed: unknown
  try
  {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as unknown
  }
  catch
  {
    refuseAuditV1(code, 'audit artifact is not decodable JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
  {
    refuseAuditV1(code, 'audit artifact is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

function hasExactKeysV1(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean
{
  return (
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
  )
}

function terminalSideEffectRelativePathV1(value: unknown): value is string
{
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    value
      .split('/')
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== '.' &&
          segment !== '..' &&
          /^[A-Za-z0-9._-]+$/u.test(segment)
      )
  )
}

function parseAuditTerminalSideEffectPlanV1(
  bytes: Uint8Array,
  authentication: {
    readonly secret: Uint8Array
    readonly terminal: AuditTerminalEvidenceV1
    readonly identity: AuditServerStoreIdentityV1
  }
): AuditTerminalSideEffectPlanV1
{
  if (bytes.byteLength > MAX_AUDIT_TERMINAL_SIDE_EFFECT_ARTIFACT_BYTES)
    refuseAuditV1(
      'audit.interior-tamper',
      'audit terminal side-effect plan exceeds its bound'
    )
  const parsed = parseJsonObject(bytes, 'audit.interior-tamper')
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes) ||
    !hasExactKeysV1(parsed, [
      'algorithm',
      'algorithmVersion',
      'auditKeyId',
      'contentBase64',
      'contentByteLength',
      'contentSha256',
      'format',
      'kind',
      'mac',
      'purpose',
      'runId',
      'schemaVersion',
      'serverInstanceId',
      'storeKey',
      'terminalSha256',
      'relativePath',
    ])
  )
    refuseAuditV1(
      'audit.interior-tamper',
      'audit terminal side-effect plan is not one canonical closed object'
    )
  const plan = parsed as unknown as AuditTerminalSideEffectPlanV1 & {
    readonly algorithm: string
    readonly algorithmVersion: number
  }
  const decoded =
    typeof plan.contentBase64 === 'string'
      ? Uint8Array.from(Buffer.from(plan.contentBase64, 'base64'))
      : new Uint8Array(0)
  const { mac, ...unsigned } = plan
  if (
    plan.schemaVersion !== 1 ||
    plan.format !== 'mcp-server-audit-terminal-side-effect-v1' ||
    plan.purpose !== 'terminal-side-effect' ||
    plan.algorithm !== AUDIT_ALGORITHM_V1 ||
    plan.algorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    plan.storeKey !== authentication.terminal.storeKey ||
    plan.serverInstanceId !== authentication.terminal.serverInstanceId ||
    plan.runId !== authentication.terminal.runId ||
    plan.auditKeyId !== authentication.terminal.auditKeyId ||
    plan.terminalSha256 !== authentication.terminal.terminalSha256 ||
    typeof plan.kind !== 'string' ||
    !/^[a-z][a-z0-9.-]{0,127}$/u.test(plan.kind) ||
    !terminalSideEffectRelativePathV1(plan.relativePath) ||
    typeof plan.contentSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(plan.contentSha256) ||
    !Number.isSafeInteger(plan.contentByteLength) ||
    plan.contentByteLength < 0 ||
    plan.contentByteLength > MAX_AUDIT_TERMINAL_SIDE_EFFECT_CONTENT_BYTES ||
    decoded.byteLength !== plan.contentByteLength ||
    Buffer.from(decoded).toString('base64') !== plan.contentBase64 ||
    sha256Hex(decoded) !== plan.contentSha256 ||
    typeof mac !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(mac) ||
    !timingSafeBytesEqual(
      hexBytes(mac),
      hexBytes(
        domainMacV1(
          authentication.secret,
          AUDIT_TERMINAL_SIDE_EFFECT_MAC_DOMAIN_V1,
          unsigned
        )
      )
    ) ||
    plan.serverInstanceId !== authentication.identity.serverInstanceId ||
    plan.runId !== authentication.identity.runId
  )
    refuseAuditV1(
      'audit.interior-tamper',
      'audit terminal side-effect plan failed authentication'
    )
  return Object.freeze(plan)
}

function auditIdempotencyKeyV1(namespaceSha256: string): string
{
  if (!LOWERCASE_SHA256_PATTERN.test(namespaceSha256))
    refuseAuditV1(
      'audit.store-invalid',
      'audit idempotency namespace is not SHA-256'
    )
  return `${AUDIT_IDEMPOTENCY_PREFIX}/${namespaceSha256}.json`
}

function parseAuditIdempotencyOutcomeV1(
  bytes: Uint8Array,
  authentication: {
    readonly secret: Uint8Array
    readonly storeKey: string
    readonly auditKeyId: string
    readonly identity: AuditServerStoreIdentityV1
  }
): AuthenticatedAuditIdempotencyOutcomeV1
{
  if (bytes.byteLength > MAX_AUDIT_IDEMPOTENCY_OUTCOME_BYTES)
    refuseAuditV1(
      'audit.interior-tamper',
      'audit idempotency outcome exceeds its bound'
    )
  const parsed = parseJsonObject(bytes, 'audit.interior-tamper')
  if (!timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes))
    refuseAuditV1(
      'audit.interior-tamper',
      'audit idempotency outcome is not canonically encoded'
    )
  const outcome = parsed as unknown as AuthenticatedAuditIdempotencyOutcomeV1
  const sha256 = (value: unknown): value is string =>
    typeof value === 'string' && LOWERCASE_SHA256_PATTERN.test(value)
  if (
    !hasExactKeysV1(parsed, [
      'algorithm',
      'algorithmVersion',
      'auditKeyId',
      'beginRecordSha256',
      'beginSequence',
      'boundary',
      'boundaryPolicySha256',
      'callId',
      'disposition',
      'evidenceIds',
      'format',
      'fullInputSha256',
      'mac',
      'namespaceSha256',
      'postHead',
      'preHead',
      'profileSha256',
      'purpose',
      'realmSha256',
      'receiptFreeOutcome',
      'receiptFreeOutcomeByteLength',
      'requestIdSha256',
      'resultSha256',
      'runId',
      'schemaVersion',
      'semanticEvent',
      'serverInstanceId',
      'storeKey',
    ]) ||
    outcome.schemaVersion !== 1 ||
    outcome.format !== 'mcp-server-audit-idempotency-outcome-v1' ||
    outcome.purpose !== AUDIT_IDEMPOTENCY_PURPOSE_V1 ||
    outcome.storeKey !== authentication.storeKey ||
    outcome.auditKeyId !== authentication.auditKeyId ||
    outcome.algorithm !== AUDIT_ALGORITHM_V1 ||
    outcome.algorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    outcome.serverInstanceId !== authentication.identity.serverInstanceId ||
    outcome.runId !== authentication.identity.runId ||
    outcome.realmSha256 !== authentication.identity.realmSha256 ||
    outcome.profileSha256 !== authentication.identity.profileSha256 ||
    outcome.boundaryPolicySha256 !==
      authentication.identity.boundaryPolicySha256 ||
    !/^mcp-call-[0-9a-f]{32}$/u.test(outcome.callId) ||
    !Number.isSafeInteger(outcome.beginSequence) ||
    outcome.beginSequence < 0 ||
    !sha256(outcome.beginRecordSha256) ||
    !sha256(outcome.namespaceSha256) ||
    !sha256(outcome.requestIdSha256) ||
    !sha256(outcome.fullInputSha256) ||
    outcome.boundary?.boundaryKind !== 'tool' ||
    (outcome.disposition !== 'completed' &&
      outcome.disposition !== 'refused') ||
    !sha256(outcome.resultSha256) ||
    !Array.isArray(outcome.evidenceIds) ||
    outcome.evidenceIds.length > MAX_AUDIT_EVIDENCE_IDS ||
    outcome.evidenceIds.some((value) => typeof value !== 'string') ||
    !Number.isSafeInteger(outcome.receiptFreeOutcomeByteLength) ||
    outcome.receiptFreeOutcomeByteLength < 0 ||
    typeof outcome.mac !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(outcome.mac)
  )
    refuseAuditV1(
      'audit.interior-tamper',
      'audit idempotency outcome fields are invalid'
    )
  if (
    outcome.receiptFreeOutcome === null ||
    typeof outcome.receiptFreeOutcome !== 'object' ||
    Array.isArray(outcome.receiptFreeOutcome) ||
    canonicalJsonBytesV1(outcome.receiptFreeOutcome).byteLength !==
      outcome.receiptFreeOutcomeByteLength
  )
    refuseAuditV1(
      'audit.interior-tamper',
      'audit idempotency outcome is not one exact receipt-free envelope'
    )
  frozenDefinitionV1<AuditHeadObservationV1>(
    'AuditHeadObservationV1',
    outcome.preHead
  )
  frozenDefinitionV1<AuditHeadObservationV1>(
    'AuditHeadObservationV1',
    outcome.postHead
  )
  frozenDefinitionV1<AuditSemanticEventCorrelationV1>(
    'AuditSemanticEventCorrelationV1',
    outcome.semanticEvent
  )
  frozenDefinitionV1<ServerAuditBoundaryV1>(
    'ServerAuditBoundaryV1',
    outcome.boundary
  )
  const { mac, ...unsigned } = outcome
  if (
    !timingSafeBytesEqual(
      hexBytes(mac),
      hexBytes(auditIdempotencyMacV1(authentication.secret, unsigned))
    )
  )
    refuseAuditV1(
      'audit.interior-tamper',
      'audit idempotency outcome MAC does not verify under its pinned key'
    )
  try
  {
    if (
      editReceiptFreeOutcomeSha256V1(outcome.receiptFreeOutcome) !==
      outcome.resultSha256
    )
      refuseAuditV1(
        'audit.interior-tamper',
        'audit idempotency outcome hash does not bind its receipt-free envelope'
      )
  }
  catch (error)
  {
    if (error instanceof AuditInvariantErrorV1) throw error
    refuseAuditV1(
      'audit.interior-tamper',
      'audit idempotency outcome receipt-free envelope is invalid'
    )
  }
  return Object.freeze({
    ...outcome,
    evidenceIds: Object.freeze([...outcome.evidenceIds]),
  })
}

// a record must round-trip to the exact bytes it was installed under, so any
// re-encoding difference is itself tamper evidence
function parseAuditRecordV1(
  bytes: Uint8Array,
  expected: { readonly storeKey: string; readonly auditKeyId: string }
): AuditRecordV1
{
  const parsed = parseJsonObject(bytes, 'audit.interior-tamper')
  const record = parsed as unknown as AuditRecordV1
  if (
    !hasExactKeysV1(parsed, [
      'algorithm',
      'algorithmVersion',
      'auditKeyId',
      'format',
      'record',
      'recordSha256',
      'schemaVersion',
      'storeKey',
    ]) ||
    record.schemaVersion !== 1 ||
    record.format !== 'mcp-server-audit-record-v1' ||
    record.storeKey !== expected.storeKey ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(record.storeKey) ||
    record.auditKeyId !== expected.auditKeyId ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(record.auditKeyId) ||
    record.algorithm !== AUDIT_ALGORITHM_V1 ||
    record.algorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    typeof record.recordSha256 !== 'string' ||
    record.record === null ||
    typeof record.record !== 'object'
  )
  {
    refuseAuditV1(
      'audit.interior-tamper',
      'audit record fields are not the frozen shape'
    )
  }
  if (!timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes))
  {
    refuseAuditV1(
      'audit.interior-tamper',
      'audit record bytes are not their canonical encoding'
    )
  }
  const frozen = frozenDefinitionV1<ServerAuditRecordHashProjectionV1>(
    'ServerAuditRecordHashProjectionV1',
    record.record
  )
  if (serverAuditRecordSha256V1(frozen) !== record.recordSha256)
  {
    refuseAuditV1(
      'audit.interior-tamper',
      'audit record semantic hash does not match its frozen projection'
    )
  }
  return { ...record, record: frozen }
}

function parseAuditTailV1(bytes: Uint8Array): AuditTailV1
{
  const parsed = parseJsonObject(bytes, 'audit.tail-unauthenticated')
  const tail = parsed as unknown as AuditTailV1
  const body = tail.body as AuditTailBodyV1 | undefined
  if (
    !body ||
    !hasExactKeysV1(parsed, ['body', 'mac']) ||
    !hasExactKeysV1(body as unknown as Record<string, unknown>, [
      'algorithm',
      'algorithmVersion',
      'auditKeyId',
      'currentRecordKey',
      'currentRecordSha256',
      'expectedNextSequence',
      'format',
      'previousTailSha256',
      'purpose',
      'recordBytes',
      'recordCount',
      'schemaVersion',
      'storeKey',
    ]) ||
    typeof tail.mac !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(tail.mac) ||
    body.schemaVersion !== 1 ||
    body.format !== 'mcp-server-audit-tail-v1' ||
    body.purpose !== AUDIT_KEY_PURPOSE_V1 ||
    typeof body.storeKey !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(body.storeKey) ||
    typeof body.auditKeyId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(body.auditKeyId) ||
    body.algorithm !== AUDIT_ALGORITHM_V1 ||
    body.algorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    !Number.isSafeInteger(body.expectedNextSequence) ||
    body.expectedNextSequence < 0 ||
    !LOWERCASE_SHA256_PATTERN.test(body.currentRecordSha256) ||
    (body.currentRecordKey !== null &&
      typeof body.currentRecordKey !== 'string') ||
    !Number.isSafeInteger(body.recordCount) ||
    body.recordCount < 0 ||
    !Number.isSafeInteger(body.recordBytes) ||
    body.recordBytes < 0 ||
    !LOWERCASE_SHA256_PATTERN.test(body.previousTailSha256) ||
    body.recordCount !== body.expectedNextSequence ||
    (body.expectedNextSequence === 0
      ? body.currentRecordKey !== null ||
        body.currentRecordSha256 !== ZERO_SHA256
      : body.currentRecordKey === null)
  )
  {
    refuseAuditV1(
      'audit.tail-unauthenticated',
      'audit tail fields are not the frozen shape'
    )
  }
  if (!timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes))
    refuseAuditV1(
      'audit.tail-unauthenticated',
      'audit tail bytes are not their canonical encoding'
    )
  return tail
}

interface LoadedRecordV1
{
  readonly key: string
  readonly sequence: number
  readonly sha256: string
  readonly byteLength: number
  readonly record: AuditRecordV1
}

interface NamedRecordV1
{
  readonly key: string
  readonly sequence: number
  readonly kind: string
  readonly hashPrefix: string
}

// naming-level invariants are decided before a single byte is read, so a
// duplicate or an absent named key is never masked by a content failure
function nameAuditRecordsV1(
  store: DurableArtifactStore
): Map<number, NamedRecordV1>
{
  const named = new Map<number, NamedRecordV1>()
  for (const entry of store.listImmutable(AUDIT_RECORD_PREFIX))
  {
    const matched = AUDIT_RECORD_KEY_PATTERN.exec(entry.key)
    if (!matched)
    {
      refuseAuditV1(
        'audit.interior-tamper',
        'audit directory holds an unnameable artifact'
      )
    }
    const sequence = Number(matched[1])
    if (named.has(sequence))
    {
      refuseAuditV1(
        'audit.duplicate-sequence',
        `two audit records claim sequence ${sequence}`
      )
    }
    named.set(sequence, {
      key: entry.key,
      sequence,
      kind: matched[2] as string,
      hashPrefix: matched[3] as string,
    })
  }
  return named
}

function loadAuditRecordV1(
  store: DurableArtifactStore,
  entry: NamedRecordV1,
  expected: { readonly storeKey: string; readonly auditKeyId: string }
): LoadedRecordV1
{
  const bytes = store.readImmutable(entry.key)
  const record = parseAuditRecordV1(bytes, expected)
  if (record.recordSha256.slice(0, 16) !== entry.hashPrefix)
  {
    refuseAuditV1(
      'audit.interior-tamper',
      `audit record ${entry.sequence} does not hash to its name`
    )
  }
  if (
    record.record.sequence !== entry.sequence ||
    record.record.phase !== entry.kind
  )
  {
    refuseAuditV1(
      'audit.interior-tamper',
      `audit record ${entry.sequence} disagrees w/ its name`
    )
  }
  return {
    key: entry.key,
    sequence: entry.sequence,
    sha256: record.recordSha256,
    byteLength: bytes.byteLength,
    record,
  }
}

export interface AuditReconciliationV1
{
  readonly tail: AuditTailBodyV1
  readonly tailSha256: string
  readonly records: ReadonlyMap<number, LoadedRecordV1>
  readonly rolledForward: boolean
  readonly authenticated: boolean
}

// * startup reconciles ONLY the unique record-written / tail-not-advanced
// * window. A missing named record, duplicate sequence, multiple successors,
// * interior tamper, or suffix truncation is an invariant failure, not a state
export function reconcileAuditStoreV1(
  store: DurableArtifactStore,
  secret: Uint8Array | null,
  rollForward: boolean,
  expected?: { readonly storeKey: string; readonly auditKeyId: string }
): AuditReconciliationV1
{
  const tailBytes = store.readImmutable(AUDIT_TAIL_KEY)
  const tail = parseAuditTailV1(tailBytes)
  if (
    expected &&
    (tail.body.storeKey !== expected.storeKey ||
      tail.body.auditKeyId !== expected.auditKeyId)
  )
    refuseAuditV1(
      'audit.tail-unauthenticated',
      'audit tail does not identify its pinned store and key'
    )
  const authenticated = secret !== null
  if (secret)
  {
    const expected = auditTailMacV1(secret, tail.body)
    if (!timingSafeBytesEqual(hexBytes(tail.mac), expected))
    {
      refuseAuditV1(
        'audit.tail-unauthenticated',
        'audit tail MAC does not verify under its pinned key'
      )
    }
  }
  const named = nameAuditRecordsV1(store)
  const next = tail.body.expectedNextSequence
  let highest = -1
  while (named.has(highest + 1)) highest += 1
  if (highest + 1 < named.size)
  {
    refuseAuditV1('audit.record-missing', 'the audit chain has an interior gap')
  }
  if (highest < next - 1)
  {
    refuseAuditV1(
      'audit.suffix-truncated',
      'the audit chain ends before the tail it is anchored to'
    )
  }
  if (
    tail.body.currentRecordKey !== null &&
    !namedKeyPresent(named, tail.body.currentRecordKey)
  )
  {
    refuseAuditV1(
      'audit.record-missing',
      'the record named by the audit tail is absent'
    )
  }
  if (highest > next)
  {
    refuseAuditV1(
      'audit.multiple-successors',
      'more than one record follows the audit tail'
    )
  }
  const records = new Map<number, LoadedRecordV1>()
  let previous = ZERO_SHA256
  for (let sequence = 0; sequence <= highest; sequence += 1)
  {
    const entry = loadAuditRecordV1(
      store,
      named.get(sequence) as NamedRecordV1,
      {
        storeKey: tail.body.storeKey,
        auditKeyId: tail.body.auditKeyId,
      }
    )
    const prior = entry.record.record.previousRecord
    const exactPrior =
      sequence === 0
        ? prior.state === 'genesis'
        : prior.state === 'present' && prior.recordSha256 === previous
    if (!exactPrior)
    {
      refuseAuditV1(
        'audit.chain-broken',
        `audit record ${sequence} does not chain its predecessor`
      )
    }
    previous = entry.sha256
    records.set(sequence, entry)
  }
  if (
    next > 0 &&
    (records.get(next - 1) as LoadedRecordV1).sha256 !==
      tail.body.currentRecordSha256
  )
  {
    refuseAuditV1(
      'audit.interior-tamper',
      'the record named by the audit tail has different bytes'
    )
  }
  if (highest < next)
  {
    return {
      tail: tail.body,
      tailSha256: sha256Hex(tailBytes),
      records,
      rolledForward: false,
      authenticated,
    }
  }
  return rollForwardAuditTailV1(
    store,
    secret,
    tail,
    sha256Hex(tailBytes),
    records.get(next) as LoadedRecordV1,
    records,
    rollForward
  )
}

function namedKeyPresent(
  named: ReadonlyMap<number, NamedRecordV1>,
  key: string
): boolean
{
  for (const entry of named.values()) if (entry.key === key) return true
  return false
}

// the crash window: the record is durably installed & correctly chained, but
// the tail never advanced. Rolling it forward is the only recoverable state
function rollForwardAuditTailV1(
  store: DurableArtifactStore,
  secret: Uint8Array | null,
  tail: AuditTailV1,
  tailSha256: string,
  successor: LoadedRecordV1,
  records: ReadonlyMap<number, LoadedRecordV1>,
  rollForward: boolean
): AuditReconciliationV1
{
  const prior = successor.record.record.previousRecord
  const exactPrior =
    tail.body.expectedNextSequence === 0
      ? prior.state === 'genesis'
      : prior.state === 'present' &&
        prior.recordSha256 === tail.body.currentRecordSha256
  if (!exactPrior)
  {
    refuseAuditV1(
      'audit.chain-broken',
      'the successor record does not chain the audit tail'
    )
  }
  if (!rollForward || !secret)
  {
    return {
      tail: tail.body,
      tailSha256,
      records,
      rolledForward: false,
      authenticated: secret !== null,
    }
  }
  const body: AuditTailBodyV1 = {
    ...tail.body,
    expectedNextSequence: successor.sequence + 1,
    currentRecordSha256: successor.sha256,
    currentRecordKey: successor.key,
    recordCount: tail.body.recordCount + 1,
    recordBytes: tail.body.recordBytes + successor.byteLength,
    previousTailSha256: tailSha256,
  }
  const bytes = sealAuditTailV1(secret, body)
  store.compareAndSwapPointer(AUDIT_TAIL_KEY, tailSha256, bytes)
  return {
    tail: body,
    tailSha256: sha256Hex(bytes),
    records,
    rolledForward: true,
    authenticated: true,
  }
}

function sealAuditTailV1(
  secret: Uint8Array,
  body: AuditTailBodyV1
): Uint8Array
{
  const mac = Buffer.from(auditTailMacV1(secret, body)).toString('hex')
  return canonicalJsonBytesV1({ body, mac })
}

function assertAuditKeyMaterialV1(material: AuditKeyMaterialV1): void
{
  if (material.purpose !== AUDIT_KEY_PURPOSE_V1)
  {
    refuseAuditV1(
      'audit.key-unavailable',
      'audit key material declares another HMAC purpose'
    )
  }
  if (
    material.algorithm !== AUDIT_ALGORITHM_V1 ||
    material.algorithmVersion !== AUDIT_ALGORITHM_VERSION_V1
  )
  {
    refuseAuditV1(
      'audit.key-unavailable',
      'audit key material pins another algorithm'
    )
  }
  if (material.secret.byteLength < AUDIT_MINIMUM_SECRET_BYTES)
  {
    refuseAuditV1(
      'audit.key-unavailable',
      'audit key material carries fewer than 256 secret bits'
    )
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(material.auditKeyId))
  {
    refuseAuditV1(
      'audit.key-unavailable',
      'audit key ID is not an opaque bounded identifier'
    )
  }
}

export interface AuditJournalOptionsV1
{
  readonly serverRoot: string
  readonly storeKey: string
  readonly identity: AuditServerStoreIdentityV1
  readonly keys: AuditKeyProviderPort
  readonly clock?: EditClockPort
  readonly monotonicClock?: AuditMonotonicClockPortV1
  readonly recordCap?: number
  readonly byteCap?: number
  readonly faultHook?: DurableArtifactFaultHook
  readonly tailCheckpoint?: AuditTailCheckpointPortV1
  readonly keyMaterial?: AuditKeyMaterialV1
}

export interface AuditTailCheckpointPortV1
{
  checkpoint(
    tail: AuditTailBodyV1,
    tailSha256: string,
    ownership: AuditSupervisorOwnershipCheckpointV1
  ): void
}

export interface AuditMonotonicClockPortV1
{
  nowMonotonicMs(): number
}

export const SYSTEM_AUDIT_MONOTONIC_CLOCK_V1: AuditMonotonicClockPortV1 =
  Object.freeze({
    nowMonotonicMs: () => Number(process.hrtime.bigint() / 1_000_000n),
  })

export type AuditPredecessorAnchorV1 =
  | { readonly state: 'absent' }
  | {
      readonly state: 'present'
      readonly storeKey: string
      readonly finalTailSha256: string
    }

export interface AuditServerStoreIdentityV1
{
  readonly serverInstanceId: string
  readonly runId: string
  readonly realmSha256: string
  readonly profileSha256: string
  readonly boundaryPolicySha256: string
  readonly predecessor: AuditPredecessorAnchorV1
}

interface InFlightCallV1
{
  readonly boundary: ServerAuditBoundaryV1
  readonly principal: AuditPrincipalIdentityV1
  readonly sequence: number
  readonly recordSha256: string
  readonly startedMonotonicMs: number
  readonly fullInputSha256: string
  readonly session: AuditSessionBindingV1
  readonly expectedHead: AuditExpectedHeadV1
  readonly idempotency: AuditIdempotencyBindingV1
}

export interface AuditBeginInputV1
{
  readonly boundary: ServerAuditBoundaryV1
  readonly schemaProfileSha256: string
  readonly policySha256: string
  readonly fullInputSha256: string
  readonly inputByteLength: number
  readonly principal: AuditPrincipalIdentityV1
  readonly rawArgument?: unknown
  readonly redactedArgumentSha256?: string
  readonly session?: AuditSessionBindingV1
  readonly expectedHead?: AuditExpectedHeadV1
  readonly idempotency?: AuditIdempotencyBindingV1
}

export interface AuditCompleteInputV1
{
  readonly callId: string
  readonly disposition: 'completed' | 'refused' | 'failed'
  readonly resultSha256: string
  readonly preHead?: AuditHeadObservationV1
  readonly postHead?: AuditHeadObservationV1
  readonly semanticEvent?: AuditSemanticEventCorrelationV1
  readonly evidenceIds?: readonly string[]
  readonly receiptFreeOutcome?: EditToolReceiptFreeResultV1
  readonly retainIdempotencyOutcome?: boolean
}

function storeRootV1(serverRoot: string, storeKey: string): string
{
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(storeKey))
  {
    refuseAuditV1(
      'audit.store-invalid',
      'audit store key is not a host-safe bounded name'
    )
  }
  return join(serverRoot, `${AUDIT_STORE_DIRECTORY_PREFIX}${storeKey}`)
}

function assertServerStoreIdentityV1(
  identity: AuditServerStoreIdentityV1
): void
{
  const opaque = (value: string): boolean =>
    /^[A-Za-z0-9_-]{16,128}$/.test(value)
  const sha256 = (value: string): boolean => LOWERCASE_SHA256_PATTERN.test(value)
  const identityRecord =
    identity !== null &&
    typeof identity === 'object' &&
    !Array.isArray(identity)
      ? (identity as unknown as Record<string, unknown>)
      : null
  const predecessor = identity?.predecessor as unknown
  const predecessorRecord =
    predecessor !== null &&
    typeof predecessor === 'object' &&
    !Array.isArray(predecessor)
      ? (predecessor as Record<string, unknown>)
      : null
  const predecessorValid =
    predecessorRecord !== null &&
    ((predecessorRecord.state === 'absent' &&
      Object.keys(predecessorRecord).join('\0') === 'state') ||
      (predecessorRecord.state === 'present' &&
        Object.keys(predecessorRecord).sort().join('\0') ===
          'finalTailSha256\0state\0storeKey' &&
        typeof predecessorRecord.storeKey === 'string' &&
        /^[a-z0-9][a-z0-9._-]{0,63}$/.test(predecessorRecord.storeKey) &&
        typeof predecessorRecord.finalTailSha256 === 'string' &&
        sha256(predecessorRecord.finalTailSha256)))
  if (
    identityRecord === null ||
    Object.keys(identityRecord).sort().join('\0') !==
      'boundaryPolicySha256\0predecessor\0profileSha256\0realmSha256\0runId\0serverInstanceId' ||
    !opaque(identity.serverInstanceId) ||
    !opaque(identity.runId) ||
    !sha256(identity.realmSha256) ||
    !sha256(identity.profileSha256) ||
    !sha256(identity.boundaryPolicySha256) ||
    !predecessorValid
  )
    refuseAuditV1(
      'audit.store-invalid',
      'audit server identity is not one bounded exact store identity'
    )
}

// * the journal is the sole audit appender for the transport boundary. A direct
// * host export never synthesizes one of these records
export class DurableToolAuditJournalV1
{
  readonly storeKey: string
  readonly auditKeyId: string
  readonly recordCap: number
  readonly byteCap: number
  readonly reserveRecords: number
  readonly reconciliation: AuditReconciliationV1
  readonly identity: AuditServerStoreIdentityV1

  readonly #store: DurableArtifactStore
  readonly #secret: Uint8Array
  readonly #clock: EditClockPort
  readonly #monotonicClock: AuditMonotonicClockPortV1
  readonly #recoveryOnly: boolean
  readonly #tailCheckpoint: AuditTailCheckpointPortV1 | undefined
  readonly #inFlight = new Map<string, InFlightCallV1>()
  #tail: AuditTailBodyV1
  #tailSha256: string
  #begunCalls = 0
  #appending = false
  #faulted = false
  #terminalized = false

  private constructor(input: {
    readonly store: DurableArtifactStore
    readonly storeKey: string
    readonly secret: Uint8Array
    readonly auditKeyId: string
    readonly clock: EditClockPort
    readonly monotonicClock: AuditMonotonicClockPortV1
    readonly identity: AuditServerStoreIdentityV1
    readonly recoveryOnly: boolean
    readonly recordCap: number
    readonly byteCap: number
    readonly reconciliation: AuditReconciliationV1
    readonly tailCheckpoint?: AuditTailCheckpointPortV1
  })
  {
    this.#store = input.store
    this.#secret = input.secret
    this.#clock = input.clock
    this.#monotonicClock = input.monotonicClock
    this.#recoveryOnly = input.recoveryOnly
    this.#tailCheckpoint = input.tailCheckpoint
    this.identity = input.identity
    this.storeKey = input.storeKey
    this.auditKeyId = input.auditKeyId
    this.recordCap = input.recordCap
    this.byteCap = input.byteCap
    this.reserveRecords = auditReserveRecordsV1(input.recordCap)
    this.reconciliation = input.reconciliation
    this.#tail = input.reconciliation.tail
    this.#tailSha256 = input.reconciliation.tailSha256
    this.#restoreUnmatchedBegins(input.reconciliation.records)
    assertAuditCapsV1(this.recordCap, this.byteCap)
  }

  // create a brand new process store: one store, one pinned active key ID
  static async create(
    options: AuditJournalOptionsV1
  ): Promise<DurableToolAuditJournalV1>
  {
    const material = options.keyMaterial ?? (await options.keys.activeKey())
    assertAuditKeyMaterialV1(material)
    const recordCap = options.recordCap ?? DEFAULT_AUDIT_RECORD_CAP
    const byteCap = options.byteCap ?? DEFAULT_AUDIT_BYTE_CAP
    assertAuditCapsV1(recordCap, byteCap)
    const store = new DurableArtifactStore(
      storeRootV1(options.serverRoot, options.storeKey),
      {
        mode: 'create-writer',
        maxEntries: recordCap + Math.floor(recordCap / 2) + 33,
        maxBytes:
          byteCap +
          MAX_AUDIT_RECORD_BYTES * 16 +
          MAX_AUDIT_IDEMPOTENCY_OUTCOME_BYTES * Math.floor(recordCap / 2) +
          MAX_AUDIT_TERMINAL_SIDE_EFFECT_ARTIFACT_BYTES,
        ownershipAuthority: auditOwnershipAuthorityV1(
          material.secret,
          `process-${options.storeKey}`
        ),
        ...(options.faultHook ? { faultHook: options.faultHook } : {}),
      }
    )
    installStoreLayoutV1(
      store,
      options.storeKey,
      material,
      options.identity,
      recordCap,
      byteCap
    )
    const body: AuditTailBodyV1 = {
      schemaVersion: 1,
      format: 'mcp-server-audit-tail-v1',
      purpose: AUDIT_KEY_PURPOSE_V1,
      storeKey: options.storeKey,
      auditKeyId: material.auditKeyId,
      algorithm: AUDIT_ALGORITHM_V1,
      algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
      expectedNextSequence: 0,
      currentRecordSha256: ZERO_SHA256,
      currentRecordKey: null,
      recordCount: 0,
      recordBytes: 0,
      previousTailSha256: ZERO_SHA256,
    }
    const bytes = sealAuditTailV1(material.secret, body)
    store.compareAndSwapPointer(AUDIT_TAIL_KEY, null, bytes)
    const journal = new DurableToolAuditJournalV1({
      store,
      storeKey: options.storeKey,
      secret: material.secret,
      auditKeyId: material.auditKeyId,
      clock: options.clock ?? SYSTEM_EDIT_CLOCK,
      monotonicClock: options.monotonicClock ?? SYSTEM_AUDIT_MONOTONIC_CLOCK_V1,
      identity: options.identity,
      recoveryOnly: false,
      recordCap,
      byteCap,
      reconciliation: {
        tail: body,
        tailSha256: sha256Hex(bytes),
        records: new Map(),
        rolledForward: false,
        authenticated: true,
      },
      ...(options.tailCheckpoint
        ? { tailCheckpoint: options.tailCheckpoint }
        : {}),
    })
    journal.#checkpointTailV1()
    return journal
  }

  // reopen for authoritative append: recovery requests the recorded key ID, &
  // a missing, wrong, or retired key fails startup rather than degrading
  static async reopen(
    options: AuditJournalOptionsV1
  ): Promise<DurableToolAuditJournalV1>
  {
    const root = storeRootV1(options.serverRoot, options.storeKey)
    const probe = new DurableArtifactStore(root, { mode: 'read-only' })
    if (hasAuditArtifactV1(probe, AUDIT_TERMINAL_KEY))
      refuseAuditV1(
        'audit.store-invalid',
        'a terminal predecessor may only be mounted read-only'
      )
    const manifest = readServerManifestV1(
      probe,
      options.storeKey,
      options.identity
    )
    const material = await requestVerificationKeyV1(
      options.keys,
      manifest.auditKeyId
    )
    authenticateServerManifestV1(manifest, material.secret)
    const ownershipAuthority = auditOwnershipAuthorityV1(
      material.secret,
      `process-${options.storeKey}`
    )
    const authenticatedProbe = new DurableArtifactStore(root, {
      mode: 'read-only',
      ownershipAuthority,
    })
    const store = new DurableArtifactStore(root, {
      mode: 'recovery',
      expectedStoreId: authenticatedProbe.storeId,
      expectedOwnershipSha256: authenticatedProbe.capability().ownershipSha256,
      ownershipAuthority,
      ...(options.faultHook ? { faultHook: options.faultHook } : {}),
    })
    const reconciliation = reconcileAuditStoreV1(store, material.secret, true, {
      storeKey: options.storeKey,
      auditKeyId: manifest.auditKeyId,
    })
    recordReconciliationV1(store, reconciliation)
    const journal = new DurableToolAuditJournalV1({
      store,
      storeKey: options.storeKey,
      secret: material.secret,
      auditKeyId: manifest.auditKeyId,
      clock: options.clock ?? SYSTEM_EDIT_CLOCK,
      monotonicClock: options.monotonicClock ?? SYSTEM_AUDIT_MONOTONIC_CLOCK_V1,
      identity: manifest.identity,
      recoveryOnly: true,
      recordCap: manifest.recordCap,
      byteCap: manifest.byteCap,
      reconciliation,
      ...(options.tailCheckpoint
        ? { tailCheckpoint: options.tailCheckpoint }
        : {}),
    })
    journal.#checkpointTailV1()
    return journal
  }

  // exclusive completion of an allocated process store whose host layout was
  // interrupted before its authenticated genesis became live
  static async recoverAllocatedStoreV1(
    options: Omit<
      AuditJournalOptionsV1,
      'keyMaterial' | 'recordCap' | 'byteCap'
    > & {
      readonly keyMaterial: AuditKeyMaterialV1
      readonly recordCap: number
      readonly byteCap: number
    }
  ): Promise<DurableToolAuditJournalV1>
  {
    assertAuditKeyMaterialV1(options.keyMaterial)
    const root = storeRootV1(options.serverRoot, options.storeKey)
    const ownershipAuthority = auditOwnershipAuthorityV1(
      options.keyMaterial.secret,
      `process-${options.storeKey}`
    )
    if (isRecoverablePartialDurableArtifactStoreRootV1(root))
    {
      const store = recoverPartialDurableArtifactStoreV1(root, {
        maxEntries: options.recordCap + Math.floor(options.recordCap / 2) + 33,
        maxBytes:
          options.byteCap +
          MAX_AUDIT_RECORD_BYTES * 16 +
          MAX_AUDIT_IDEMPOTENCY_OUTCOME_BYTES *
            Math.floor(options.recordCap / 2) +
          MAX_AUDIT_TERMINAL_SIDE_EFFECT_ARTIFACT_BYTES,
        ownershipAuthority,
        ...(options.faultHook ? { faultHook: options.faultHook } : {}),
      })
      return DurableToolAuditJournalV1.finishAllocatedStoreRecoveryV1(
        options,
        store
      )
    }
    const probe = new DurableArtifactStore(root, {
      mode: 'read-only',
      ownershipAuthority,
    })
    const entries = probe.listImmutable('')
    const hasManifest = entries.some(
      (entry) => entry.key === AUDIT_SERVER_MANIFEST_KEY
    )
    if (!hasManifest && entries.length !== 0)
      refuseAuditV1(
        'audit.store-invalid',
        'a partial process store retained artifacts before its signed manifest'
      )
    if (hasManifest)
    {
      const manifest = readServerManifestV1(
        probe,
        options.storeKey,
        options.identity
      )
      if (
        manifest.auditKeyId !== options.keyMaterial.auditKeyId ||
        manifest.recordCap !== options.recordCap ||
        manifest.byteCap !== options.byteCap
      )
        refuseAuditV1(
          'audit.store-invalid',
          'the partial process store differs from its supervisor allocation'
        )
      authenticateServerManifestV1(manifest, options.keyMaterial.secret)
    }
    const store = new DurableArtifactStore(root, {
      mode: 'recovery',
      expectedStoreId: probe.storeId,
      expectedOwnershipSha256: probe.capability().ownershipSha256,
      ownershipAuthority,
      ...(options.faultHook ? { faultHook: options.faultHook } : {}),
    })
    return DurableToolAuditJournalV1.finishAllocatedStoreRecoveryV1(
      options,
      store
    )
  }

  private static finishAllocatedStoreRecoveryV1(
    options: Omit<
      AuditJournalOptionsV1,
      'keyMaterial' | 'recordCap' | 'byteCap'
    > & {
      readonly keyMaterial: AuditKeyMaterialV1
      readonly recordCap: number
      readonly byteCap: number
    },
    store: DurableArtifactStore
  ): DurableToolAuditJournalV1
  {
    installStoreLayoutV1(
      store,
      options.storeKey,
      options.keyMaterial,
      options.identity,
      options.recordCap,
      options.byteCap
    )
    const genesis: AuditTailBodyV1 = {
      schemaVersion: 1,
      format: 'mcp-server-audit-tail-v1',
      purpose: AUDIT_KEY_PURPOSE_V1,
      storeKey: options.storeKey,
      auditKeyId: options.keyMaterial.auditKeyId,
      algorithm: AUDIT_ALGORITHM_V1,
      algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
      expectedNextSequence: 0,
      currentRecordSha256: ZERO_SHA256,
      currentRecordKey: null,
      recordCount: 0,
      recordBytes: 0,
      previousTailSha256: ZERO_SHA256,
    }
    const genesisBytes = sealAuditTailV1(options.keyMaterial.secret, genesis)
    if (!hasAuditArtifactV1(store, AUDIT_TAIL_KEY))
      store.compareAndSwapPointer(AUDIT_TAIL_KEY, null, genesisBytes)
    else
    {
      const observed = store.readImmutable(AUDIT_TAIL_KEY)
      if (!timingSafeBytesEqual(observed, genesisBytes))
        refuseAuditV1(
          'audit.store-invalid',
          'a partial process store carries a non-genesis live tail'
        )
    }
    const reconciliation = reconcileAuditStoreV1(
      store,
      options.keyMaterial.secret,
      true,
      {
        storeKey: options.storeKey,
        auditKeyId: options.keyMaterial.auditKeyId,
      }
    )
    recordReconciliationV1(store, reconciliation)
    const journal = new DurableToolAuditJournalV1({
      store,
      storeKey: options.storeKey,
      secret: options.keyMaterial.secret,
      auditKeyId: options.keyMaterial.auditKeyId,
      clock: options.clock ?? SYSTEM_EDIT_CLOCK,
      monotonicClock: options.monotonicClock ?? SYSTEM_AUDIT_MONOTONIC_CLOCK_V1,
      identity: options.identity,
      recoveryOnly: true,
      recordCap: options.recordCap,
      byteCap: options.byteCap,
      reconciliation,
      ...(options.tailCheckpoint
        ? { tailCheckpoint: options.tailCheckpoint }
        : {}),
    })
    journal.#checkpointTailV1()
    return journal
  }

  tail(): AuditTailBodyV1
  {
    return this.#tail
  }

  tailSha256(): string
  {
    return this.#tailSha256
  }

  admission(): AuditAdmissionV1
  {
    const reserveBytes = this.reserveRecords * MAX_AUDIT_RECORD_BYTES
    const usedRecords = this.#tail.recordCount
    const usedBytes = this.#tail.recordBytes
    const availableCallRecords =
      this.recordCap - usedRecords - this.#begunCalls - this.reserveRecords
    return Object.freeze({
      recordCap: this.recordCap,
      byteCap: this.byteCap,
      reserveRecords: this.reserveRecords,
      reserveBytes,
      usedRecords,
      usedBytes,
      begunCalls: this.#begunCalls,
      availableCallRecords,
      admitted: this.#admissible(),
    })
  }

  // * admission needs room for two maximum-sized records for this call, one
  // * completion record for every other begun call, & the untouched reserve.
  // * The plan's 2 * begunCalls + reserve <= cap invariant is enforced alongside
  #admissible(): boolean
  {
    return this.#hasCapacity(2 + this.#begunCalls + this.reserveRecords)
  }

  #hasCapacity(maximumRecords: number): boolean
  {
    return (
      this.#tail.recordCount + maximumRecords <= this.recordCap &&
      this.#tail.recordBytes + maximumRecords * MAX_AUDIT_RECORD_BYTES <=
        this.byteCap
    )
  }

  #admissibleReserve(boundary: ServerAuditBoundaryV1): boolean
  {
    const terminal =
      boundary.boundaryKind === 'server-close' ? 0 : TERMINAL_AUDIT_RECORDS
    return this.#hasCapacity(2 + this.#begunCalls + terminal)
  }

  beginCall(input: AuditBeginInputV1): AuditBegunCallV1
  {
    if (this.#terminalized)
      refuseAuditV1('audit.store-invalid', 'the audit store is terminal')
    if (this.#recoveryOnly && input.boundary.boundaryKind !== 'server-close')
      refuseAuditV1(
        'audit.store-invalid',
        'a recovery journal cannot admit new calls'
      )
    const reserve =
      input.boundary.boundaryKind === 'protocol' ||
      input.boundary.boundaryKind === 'server-close'
    if (!reserve && !this.#admissible())
    {
      refuseAuditV1(
        'audit.capacity-exhausted',
        'the audit journal cannot guarantee completion capacity for another call'
      )
    }
    if (reserve && !this.#admissibleReserve(input.boundary))
    {
      refuseAuditV1(
        'audit.capacity-exhausted',
        'the audit journal reserve is exhausted'
      )
    }
    const callId = `mcp-call-${randomBytes(16).toString('hex')}`
    const startedWallClockEpochMs = this.#clock.nowEpochMs()
    const startedMonotonicMs = this.#monotonicClock.nowMonotonicMs()
    const appended = this.#append({
      schemaVersion: 1,
      serverInstanceId: this.identity.serverInstanceId,
      principal: input.principal,
      sequence: this.#tail.expectedNextSequence,
      previousRecord: this.#priorRecord(),
      callId,
      boundary: input.boundary,
      phase: 'call-begin',
      schemaProfileSha256: input.schemaProfileSha256,
      policySha256: input.policySha256,
      redactedArgumentSha256:
        input.redactedArgumentSha256 ??
        redactedArgumentSha256V1(input.rawArgument ?? null),
      fullInputSha256: input.fullInputSha256,
      inputByteLength: input.inputByteLength,
      session: input.session ?? { state: 'absent' },
      expectedHead: input.expectedHead ?? { state: 'absent' },
      idempotency: input.idempotency ?? { state: 'absent' },
      startedWallClockEpochMs,
      startedMonotonicMs,
    })
    this.#inFlight.set(callId, {
      boundary: input.boundary,
      principal: input.principal,
      sequence: appended.sequence,
      recordSha256: appended.recordSha256,
      startedMonotonicMs,
      fullInputSha256: input.fullInputSha256,
      session: input.session ?? { state: 'absent' },
      expectedHead: input.expectedHead ?? { state: 'absent' },
      idempotency: input.idempotency ?? { state: 'absent' },
    })
    this.#begunCalls += 1
    return Object.freeze({
      callId,
      sequence: appended.sequence,
      recordSha256: appended.recordSha256,
    })
  }

  completeCall(input: AuditCompleteInputV1): AuditReceiptV1
  {
    const begun = this.#inFlight.get(input.callId)
    if (!begun)
    {
      refuseAuditV1(
        'audit.unknown-call',
        'no begun audit call carries that call ID'
      )
    }
    const completedAtEpochMs = this.#clock.nowEpochMs()
    const completedMonotonicMs = this.#monotonicClock.nowMonotonicMs()
    const preHead = input.preHead ?? { state: 'unavailable' as const }
    const postHead = input.postHead ?? { state: 'unavailable' as const }
    const semanticEvent = input.semanticEvent ?? { state: 'absent' as const }
    const evidenceIds = Object.freeze(
      [...new Set(input.evidenceIds ?? [])].slice(0, MAX_AUDIT_EVIDENCE_IDS)
    )
    if (
      input.disposition !== 'failed' &&
      begun.boundary.boundaryKind === 'tool' &&
      begun.idempotency.state === 'present' &&
      input.retainIdempotencyOutcome !== false
    )
    {
      if (input.receiptFreeOutcome === undefined)
      {
        this.completeCall({
          callId: input.callId,
          disposition: 'failed',
          resultSha256: sha256Hex(
            canonicalJsonBytesV1({
              schemaVersion: 1,
              kind: 'audit-idempotency-retain-failure-v1',
              callId: input.callId,
              beginRecordSha256: begun.recordSha256,
              reason: 'receipt-free-outcome-absent',
            })
          ),
        })
        refuseAuditV1(
          'audit.store-invalid',
          'an idempotent edit completion requires its receipt-free outcome'
        )
      }
      const unsignedOutcome: Omit<
        AuthenticatedAuditIdempotencyOutcomeV1,
        'mac'
      > = {
        schemaVersion: 1,
        format: 'mcp-server-audit-idempotency-outcome-v1',
        purpose: AUDIT_IDEMPOTENCY_PURPOSE_V1,
        storeKey: this.storeKey,
        auditKeyId: this.auditKeyId,
        algorithm: AUDIT_ALGORITHM_V1,
        algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
        serverInstanceId: this.identity.serverInstanceId,
        runId: this.identity.runId,
        realmSha256: this.identity.realmSha256,
        profileSha256: this.identity.profileSha256,
        boundaryPolicySha256: this.identity.boundaryPolicySha256,
        callId: input.callId,
        beginSequence: begun.sequence,
        beginRecordSha256: begun.recordSha256,
        namespaceSha256: begun.idempotency.namespaceSha256,
        requestIdSha256: begun.idempotency.requestIdSha256,
        fullInputSha256: begun.fullInputSha256,
        boundary: begun.boundary,
        disposition: input.disposition,
        resultSha256: input.resultSha256,
        preHead,
        postHead,
        semanticEvent,
        evidenceIds,
        receiptFreeOutcome: input.receiptFreeOutcome,
        receiptFreeOutcomeByteLength: canonicalJsonBytesV1(
          input.receiptFreeOutcome
        ).byteLength,
      }
      try
      {
        this.#retainIdempotencyOutcomeV1(unsignedOutcome)
      }
      catch (error)
      {
        let exactRetained = false
        try
        {
          const retained = this.#retainedIdempotencyOutcomeV1(
            input.callId,
            begun
          )
          const expected: AuthenticatedAuditIdempotencyOutcomeV1 = {
            ...unsignedOutcome,
            mac: auditIdempotencyMacV1(this.#secret, unsignedOutcome),
          }
          exactRetained =
            retained !== null &&
            timingSafeBytesEqual(
              canonicalJsonBytesV1(retained),
              canonicalJsonBytesV1(expected)
            )
        }
        catch (reconciliationError)
        {
          this.#faulted = true
          if (reconciliationError instanceof AuditInvariantErrorV1)
            throw reconciliationError
          return refuseAuditV1(
            'audit.append-failed',
            'audit idempotency reconciliation failed & requires exclusive recovery'
          )
        }
        if (exactRetained)
        {
          try
          {
            this.#retainIdempotencyOutcomeV1(unsignedOutcome)
          }
          catch
          {
            this.#faulted = true
            return refuseAuditV1(
              'audit.append-failed',
              'audit idempotency durability reconciliation failed & requires exclusive recovery'
            )
          }
        }
        if (!exactRetained)
        {
          try
          {
            this.completeCall({
              callId: input.callId,
              disposition: 'failed',
              resultSha256: sha256Hex(
                canonicalJsonBytesV1({
                  schemaVersion: 1,
                  kind: 'audit-idempotency-retain-failure-v1',
                  callId: input.callId,
                  beginRecordSha256: begun.recordSha256,
                  reason: 'retain-failed',
                })
              ),
            })
          }
          finally
          {
            this.#faulted = true
          }
          if (
            error instanceof AuditInvariantErrorV1 &&
            error.invariant === 'audit.append-failed'
          )
            throw error
          return refuseAuditV1(
            'audit.append-failed',
            'audit idempotency persistence failed & requires exclusive recovery'
          )
        }
      }
    }
    const appended = this.#append({
      schemaVersion: 1,
      serverInstanceId: this.identity.serverInstanceId,
      principal: begun.principal,
      sequence: this.#tail.expectedNextSequence,
      previousRecord: this.#priorRecord(),
      callId: input.callId,
      boundary: begun.boundary,
      phase:
        input.disposition === 'completed'
          ? ('call-complete' as const)
          : ('call-rejected' as const),
      beginSequence: begun.sequence,
      beginRecordSha256: begun.recordSha256,
      resultSha256: input.resultSha256,
      preHead,
      postHead,
      completedWallClockEpochMs: completedAtEpochMs,
      durationMonotonicMs: Math.max(
        0,
        completedMonotonicMs - begun.startedMonotonicMs
      ),
      evidenceIds,
      semanticEvent,
    })
    this.#inFlight.delete(input.callId)
    this.#begunCalls -= 1
    return Object.freeze({
      callId: input.callId,
      beginSequence: begun.sequence,
      beginRecordSha256: begun.recordSha256,
      completeSequence: appended.sequence,
      completeRecordSha256: appended.recordSha256,
    })
  }

  unmatchedBegins(): readonly AuditUnmatchedBeginV1[]
  {
    return Object.freeze(
      [...this.#inFlight.entries()]
        .sort((left, right) => left[1].sequence - right[1].sequence)
        .map(([callId, begun]) =>
          Object.freeze({
            callId,
            sequence: begun.sequence,
            recordSha256: begun.recordSha256,
            boundary: begun.boundary,
            principal: begun.principal,
            fullInputSha256: begun.fullInputSha256,
            session: begun.session,
            expectedHead: begun.expectedHead,
            idempotency: begun.idempotency,
            retainedOutcome: this.#retainedIdempotencyOutcomeV1(callId, begun),
          })
        )
    )
  }

  rejectRecoveredCallV1(
    input: Omit<AuditCompleteInputV1, 'disposition'>
  ): AuditReceiptV1
  {
    if (!this.#recoveryOnly)
      refuseAuditV1(
        'audit.store-invalid',
        'only exclusive recovery may classify an unmatched predecessor call'
      )
    return this.completeCall({ ...input, disposition: 'failed' })
  }

  completeRecoveredCallV1(input: AuditCompleteInputV1): AuditReceiptV1
  {
    if (!this.#recoveryOnly)
      refuseAuditV1(
        'audit.store-invalid',
        'only exclusive recovery may classify an unmatched predecessor call'
      )
    return this.completeCall(input)
  }

  retainTerminalSideEffectPlanV1(
    terminal: AuditTerminalEvidenceV1,
    input: AuditTerminalSideEffectInputV1
  ): AuditTerminalSideEffectPlanV1
  {
    if (
      terminal.storeKey !== this.storeKey ||
      terminal.serverInstanceId !== this.identity.serverInstanceId ||
      terminal.runId !== this.identity.runId ||
      terminal.auditKeyId !== this.auditKeyId
    )
      refuseAuditV1(
        'audit.store-invalid',
        'terminal side-effect input names a different process authority'
      )
    if (
      !/^[a-z][a-z0-9.-]{0,127}$/u.test(input.kind) ||
      !terminalSideEffectRelativePathV1(input.relativePath) ||
      input.content.byteLength > MAX_AUDIT_TERMINAL_SIDE_EFFECT_CONTENT_BYTES
    )
      refuseAuditV1(
        'audit.store-invalid',
        'terminal side-effect input exceeds its closed bounds'
      )
    const unsigned = {
      schemaVersion: 1 as const,
      format: 'mcp-server-audit-terminal-side-effect-v1' as const,
      purpose: 'terminal-side-effect' as const,
      storeKey: this.storeKey,
      serverInstanceId: this.identity.serverInstanceId,
      runId: this.identity.runId,
      auditKeyId: this.auditKeyId,
      algorithm: AUDIT_ALGORITHM_V1,
      algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
      terminalSha256: terminal.terminalSha256,
      kind: input.kind,
      relativePath: input.relativePath,
      contentSha256: sha256Hex(input.content),
      contentByteLength: input.content.byteLength,
      contentBase64: Buffer.from(input.content).toString('base64'),
    }
    const plan = Object.freeze({
      ...unsigned,
      mac: domainMacV1(
        this.#secret,
        AUDIT_TERMINAL_SIDE_EFFECT_MAC_DOMAIN_V1,
        unsigned
      ),
    })
    const bytes = canonicalJsonBytesV1(plan)
    if (bytes.byteLength > MAX_AUDIT_TERMINAL_SIDE_EFFECT_ARTIFACT_BYTES)
      refuseAuditV1(
        'audit.store-invalid',
        'terminal side-effect plan exceeds its artifact bound'
      )
    try
    {
      this.#store.createOrVerifyImmutable(AUDIT_TERMINAL_SIDE_EFFECT_KEY, bytes)
      const retained = this.#store.readImmutable(AUDIT_TERMINAL_SIDE_EFFECT_KEY)
      if (!timingSafeBytesEqual(retained, bytes))
        refuseAuditV1(
          'audit.store-invalid',
          'terminal side-effect plan differs from its retained authority'
        )
    }
    catch (error)
    {
      try
      {
        const retained = this.#store.readImmutable(
          AUDIT_TERMINAL_SIDE_EFFECT_KEY
        )
        if (timingSafeBytesEqual(retained, bytes))
          return parseAuditTerminalSideEffectPlanV1(retained, {
            secret: this.#secret,
            terminal,
            identity: this.identity,
          })
      }
      catch
      {
        // the original persistence failure remains authoritative
      }
      this.#faulted = true
      if (error instanceof AuditInvariantErrorV1) throw error
      refuseAuditV1(
        'audit.append-failed',
        'terminal side-effect persistence failed & requires exclusive recovery'
      )
    }
    return parseAuditTerminalSideEffectPlanV1(bytes, {
      secret: this.#secret,
      terminal,
      identity: this.identity,
    })
  }

  terminalSideEffectPlanV1(
    terminal: AuditTerminalEvidenceV1
  ): AuditTerminalSideEffectPlanV1 | null
  {
    if (!hasAuditArtifactV1(this.#store, AUDIT_TERMINAL_SIDE_EFFECT_KEY))
      return null
    return parseAuditTerminalSideEffectPlanV1(
      this.#store.readImmutable(AUDIT_TERMINAL_SIDE_EFFECT_KEY),
      { secret: this.#secret, terminal, identity: this.identity }
    )
  }

  terminalizeV1(input: {
    readonly principal: AuditPrincipalIdentityV1
    readonly fullInputSha256: string
    readonly inputByteLength: number
    readonly rawArgument?: unknown
    readonly outcome: NonToolReceiptFreeOutcomeHashProjectionV1
    readonly beforeTerminalPersistence?: (
      terminal: AuditTerminalEvidenceV1,
      journal: DurableToolAuditJournalV1
    ) => void
  }): AuditTerminalEvidenceV1
  {
    if (this.#faulted)
      refuseAuditV1(
        'audit.append-failed',
        'a faulted audit journal must be exclusively reopened before terminalization'
      )
    if (this.#inFlight.size !== 0)
      refuseAuditV1(
        'audit.store-invalid',
        'audit store cannot terminalize with unmatched begun calls'
      )
    if (input.outcome.boundary.boundaryKind !== 'server-close')
      throw new McpBoundaryError(
        'mcp.audit-projection-invalid',
        'terminal outcome is not the frozen server-close boundary'
      )
    const expectedResultSha256 = boundaryReceiptFreeOutcomeSha256V1(
      input.outcome
    )
    const candidate = this.#serverCloseReceiptCandidate()
    if (candidate !== null && candidate.resultSha256 !== expectedResultSha256)
      refuseAuditV1(
        'audit.store-invalid',
        'the unanchored close outcome differs from the recovery close outcome'
      )
    const closeReceipt =
      candidate?.receipt ??
      this.recordNonToolBoundaryV1({
        boundary: { boundaryKind: 'server-close' },
        principal: input.principal,
        fullInputSha256: input.fullInputSha256,
        inputByteLength: input.inputByteLength,
        rawArgument: input.rawArgument,
        outcome: input.outcome,
        disposition: 'completed',
      })
    const withoutHash = {
      schemaVersion: 1 as const,
      storeKey: this.storeKey,
      serverInstanceId: this.identity.serverInstanceId,
      runId: this.identity.runId,
      auditKeyId: this.auditKeyId,
      finalTailSha256: this.#tailSha256,
      finalRecordSha256: this.#tail.currentRecordSha256,
      recordCount: this.#tail.recordCount,
      recordBytes: this.#tail.recordBytes,
      closeReceipt,
    }
    const terminalSha256 = sha256Hex(canonicalJsonBytesV1(withoutHash))
    const terminal = Object.freeze({ ...withoutHash, terminalSha256 })
    input.beforeTerminalPersistence?.(terminal, this)
    try
    {
      this.#store.compareAndSwapPointer(
        AUDIT_TERMINAL_KEY,
        null,
        canonicalJsonBytesV1(terminal)
      )
    }
    catch (error)
    {
      this.#faulted = true
      if (
        error instanceof AuditInvariantErrorV1 &&
        error.invariant === 'audit.append-failed'
      )
        throw error
      return refuseAuditV1(
        'audit.append-failed',
        'audit terminal persistence failed & requires exclusive recovery'
      )
    }
    this.#terminalized = true
    return terminal
  }

  // a raw frame never dispatches, so its pair is appended together; only
  // framing metadata & the frame hash are retained
  recordFrameRefusalV1(
    refusal: JsonlBoundaryRefusalV1,
    principal: AuditPrincipalIdentityV1
  ): AuditReceiptV1
  {
    const summary = 'suppressed' in refusal ? refusal.suppressed : null
    const fullInputSha256 =
      (summary
        ? sha256Hex(
            canonicalJsonBytesV1({
              domain: AUDIT_BOUNDARY_INPUT_DOMAIN_V1,
              projection: {
                kind: 'suppressed-frame-refusals-v1',
                ...summary,
              },
            })
          )
        : null) ??
      ('metadata' in refusal ? refusal.metadata.rawSha256 : ZERO_SHA256)
    const inputByteLength =
      summary?.rawByteLength ??
      ('metadata' in refusal ? refusal.metadata.rawByteLength : 0)
    const boundary: ServerAuditBoundaryV1 = {
      boundaryKind: 'protocol',
      protocolKind:
        refusal.code === 'mcp.frame-invalid-utf8'
          ? 'invalid-utf8'
          : refusal.code === 'mcp.frame-invalid-json-rpc'
            ? 'invalid-json-rpc'
            : refusal.code === 'mcp.frame-malformed' ||
                refusal.code === 'mcp.frame-duplicate-key' ||
                refusal.code === 'mcp.frame-unsafe-number' ||
                refusal.code === 'mcp.frame-nul-string' ||
                refusal.code === 'mcp.frame-unpaired-surrogate'
              ? 'invalid-json'
              : 'raw-frame-rejected',
    }
    const outcomeBytes = canonicalJsonBytesV1(refusal)
    const outcome: NonToolReceiptFreeOutcomeHashProjectionV1 = {
      outcomeKind: 'nonToolBoundary',
      boundary,
      disposition: 'malformed',
      outcomeCode: refusal.code,
      canonicalOutcomeSha256: sha256Hex(outcomeBytes),
      outcomeByteLength: outcomeBytes.byteLength,
      evidenceIds: [],
    }
    const begun = this.beginCall({
      boundary,
      schemaProfileSha256: this.identity.profileSha256,
      policySha256: this.identity.boundaryPolicySha256,
      fullInputSha256,
      inputByteLength,
      redactedArgumentSha256: sha256Hex(canonicalJsonBytesV1(refusal)),
      principal,
    })
    return this.completeCall({
      callId: begun.callId,
      disposition: 'refused',
      resultSha256: boundaryReceiptFreeOutcomeSha256V1(outcome),
    })
  }

  recordNonToolBoundaryV1(input: {
    readonly boundary: Exclude<
      ServerAuditBoundaryV1,
      { readonly boundaryKind: 'tool' }
    >
    readonly principal: AuditPrincipalIdentityV1
    readonly fullInputSha256: string
    readonly inputByteLength: number
    readonly rawArgument?: unknown
    readonly outcome: NonToolReceiptFreeOutcomeHashProjectionV1
    readonly disposition: 'completed' | 'refused' | 'failed'
  }): AuditReceiptV1
  {
    if (
      !timingSafeBytesEqual(
        canonicalJsonBytesV1(input.boundary),
        canonicalJsonBytesV1(input.outcome.boundary)
      )
    )
      throw new McpBoundaryError(
        'mcp.audit-projection-invalid',
        'non-tool outcome names a different boundary than its audit call'
      )
    const begun = this.beginCall({
      boundary: input.boundary,
      schemaProfileSha256: this.identity.profileSha256,
      policySha256: this.identity.boundaryPolicySha256,
      fullInputSha256: input.fullInputSha256,
      inputByteLength: input.inputByteLength,
      principal: input.principal,
      rawArgument: input.rawArgument,
    })
    return this.completeCall({
      callId: begun.callId,
      disposition: input.disposition,
      resultSha256: boundaryReceiptFreeOutcomeSha256V1(input.outcome),
      evidenceIds: input.outcome.evidenceIds,
    })
  }

  // the seam the transport already dispatches through; edit tools become one
  // boundary kind inside the same global chain as everything else
  editToolAuditPort(options: {
    readonly principal: AuditPrincipalIdentityV1
    readonly beginContext: (input: {
      readonly toolName: EditToolName
      readonly requestSha256: string
    }) => Omit<AuditBeginInputV1, 'boundary' | 'principal' | 'fullInputSha256'>
    readonly completeContext?: (input: {
      readonly callId: string
      readonly disposition: 'completed' | 'refused'
      readonly outcomeSha256: string
    }) => Omit<AuditCompleteInputV1, 'callId' | 'disposition' | 'resultSha256'>
  }): EditToolAuditPortV1
  {
    const beginSequences = new Map<string, number>()
    return {
      beginCall: (input: {
        readonly toolName: EditToolName
        readonly requestSha256: string
        readonly principalSha256: string
      }) =>
      {
        const begun = this.beginCall({
          ...options.beginContext(input),
          boundary: { boundaryKind: 'tool', tool: input.toolName },
          principal: options.principal,
          fullInputSha256: input.requestSha256,
        })
        beginSequences.set(begun.callId, begun.sequence)
        return begun
      },
      completeCall: (input: {
        readonly callId: string
        readonly beginSequence: number
        readonly disposition: 'completed' | 'refused'
        readonly outcomeSha256: string
      }) =>
      {
        if (beginSequences.get(input.callId) !== input.beginSequence)
        {
          refuseAuditV1(
            'audit.unknown-call',
            'completion names a begin sequence this journal did not issue'
          )
        }
        beginSequences.delete(input.callId)
        const receipt = this.completeCall({
          ...(options.completeContext?.(input) ?? {}),
          callId: input.callId,
          disposition: input.disposition,
          resultSha256: input.outcomeSha256,
        })
        return {
          sequence: receipt.completeSequence,
          recordSha256: receipt.completeRecordSha256,
        }
      },
    }
  }

  evidence(): AuditStoreEvidenceV1
  {
    return Object.freeze({
      storeKey: this.storeKey,
      auditKeyId: this.auditKeyId,
      authenticated: true,
      tail: this.#tail,
      tailSha256: this.#tailSha256,
      recordCount: this.#tail.recordCount,
      recordBytes: this.#tail.recordBytes,
      highestSequence: this.#tail.expectedNextSequence - 1,
      rolledForward: this.reconciliation.rolledForward,
    })
  }

  verify(): AuditReconciliationV1
  {
    return reconcileAuditStoreV1(this.#store, this.#secret, false, {
      storeKey: this.storeKey,
      auditKeyId: this.auditKeyId,
    })
  }

  lookupIdempotencyV1(input: {
    readonly namespaceSha256: string
    readonly requestIdSha256: string
    readonly fullInputSha256: string
    readonly boundary: Extract<
      ServerAuditBoundaryV1,
      { readonly boundaryKind: 'tool' }
    >
  }): AuthenticatedAuditIdempotencyLookupV1
  {
    frozenDefinitionV1<ServerAuditBoundaryV1>(
      'ServerAuditBoundaryV1',
      input.boundary
    )
    const key = auditIdempotencyKeyV1(input.namespaceSha256)
    if (!hasAuditArtifactV1(this.#store, key)) return { state: 'absent' }
    const outcome = parseAuditIdempotencyOutcomeV1(
      this.#store.readImmutable(key),
      {
        secret: this.#secret,
        storeKey: this.storeKey,
        auditKeyId: this.auditKeyId,
        identity: this.identity,
      }
    )
    const reconciliation = this.verify()
    const authenticated = auditRecordsAuthenticateIdempotencyOutcomeV1(
      reconciliation.records,
      outcome
    )
    if (!authenticated)
      refuseAuditV1(
        'audit.interior-tamper',
        'live idempotency outcome has no authenticated terminal audit pair'
      )
    if (outcome.namespaceSha256 !== input.namespaceSha256)
      refuseAuditV1(
        'audit.interior-tamper',
        'live idempotency outcome is stored under another namespace'
      )
    const matched =
      outcome.requestIdSha256 === input.requestIdSha256 &&
      outcome.fullInputSha256 === input.fullInputSha256 &&
      timingSafeBytesEqual(
        canonicalJsonBytesV1(outcome.boundary),
        canonicalJsonBytesV1(input.boundary)
      )
    return matched
      ? { state: 'matched', storeKey: this.storeKey, outcome }
      : { state: 'conflict', storeKey: this.storeKey, outcome }
  }

  // * the append mutex. The critical section contains no await, so the JS turn
  // * itself serializes it; the guard turns any accidental re-entrancy into an
  // * invariant failure rather than a silently interleaved sequence allocation
  #append(projection: ServerAuditRecordHashProjectionV1): {
    readonly sequence: number
    readonly recordSha256: string
  }
  {
    if (this.#faulted)
    {
      refuseAuditV1(
        'audit.append-failed',
        'the audit tail is behind its record store & needs reconciliation'
      )
    }
    if (this.#appending)
    {
      refuseAuditV1(
        'audit.append-reentered',
        'the audit append mutex was re-entered'
      )
    }
    this.#appending = true
    let persistenceStarted = false
    try
    {
      const sequence = this.#tail.expectedNextSequence
      if (projection.sequence !== sequence)
        refuseAuditV1(
          'audit.append-failed',
          'audit projection sequence differs from the authenticated tail'
        )
      const recordSha256 = serverAuditRecordSha256V1(projection)
      const record: AuditRecordV1 = {
        schemaVersion: 1,
        format: 'mcp-server-audit-record-v1',
        storeKey: this.storeKey,
        auditKeyId: this.auditKeyId,
        algorithm: AUDIT_ALGORITHM_V1,
        algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
        recordSha256,
        record: projection,
      }
      const bytes = canonicalJsonBytesV1(record)
      if (bytes.byteLength > MAX_AUDIT_RECORD_BYTES)
      {
        refuseAuditV1(
          'audit.record-too-large',
          'an audit record exceeds its bounded maximum'
        )
      }
      if (
        this.#tail.recordCount + 1 > this.recordCap ||
        this.#tail.recordBytes + bytes.byteLength > this.byteCap
      )
        refuseAuditV1(
          'audit.capacity-exhausted',
          'the audit record would exceed its exact durable capacity'
        )
      const key = auditRecordKeyV1(sequence, projection.phase, recordSha256)
      persistenceStarted = true
      this.#store.createImmutable(key, bytes)
      const next: AuditTailBodyV1 = {
        ...this.#tail,
        expectedNextSequence: sequence + 1,
        currentRecordSha256: recordSha256,
        currentRecordKey: key,
        recordCount: this.#tail.recordCount + 1,
        recordBytes: this.#tail.recordBytes + bytes.byteLength,
        previousTailSha256: this.#tailSha256,
      }
      const tailBytes = sealAuditTailV1(this.#secret, next)
      this.#store.compareAndSwapPointer(
        AUDIT_TAIL_KEY,
        this.#tailSha256,
        tailBytes
      )
      this.#tail = next
      this.#tailSha256 = sha256Hex(tailBytes)
      this.#checkpointTailV1()
      return { sequence, recordSha256 }
    }
    catch (error)
    {
      if (!persistenceStarted) throw error
      this.#faulted = true
      if (
        error instanceof AuditInvariantErrorV1 &&
        error.invariant === 'audit.append-failed'
      )
        throw error
      return refuseAuditV1(
        'audit.append-failed',
        'audit append persistence failed & requires exclusive recovery'
      )
    }
    finally
    {
      this.#appending = false
    }
  }

  #priorRecord(): ServerAuditRecordHashProjectionV1['previousRecord']
  {
    return this.#tail.expectedNextSequence === 0
      ? { state: 'genesis' }
      : {
          state: 'present',
          recordSha256: this.#tail.currentRecordSha256,
        }
  }

  #checkpointTailV1(): void
  {
    this.#tailCheckpoint?.checkpoint(
      this.#tail,
      this.#tailSha256,
      ownershipCheckpointV1(this.#store.capability())
    )
  }

  #retainIdempotencyOutcomeV1(
    unsigned: Omit<AuthenticatedAuditIdempotencyOutcomeV1, 'mac'>
  ): void
  {
    const outcome: AuthenticatedAuditIdempotencyOutcomeV1 = Object.freeze({
      ...unsigned,
      mac: auditIdempotencyMacV1(this.#secret, unsigned),
    })
    frozenDefinitionV1<ServerAuditBoundaryV1>(
      'ServerAuditBoundaryV1',
      outcome.boundary
    )
    frozenDefinitionV1<AuditHeadObservationV1>(
      'AuditHeadObservationV1',
      outcome.preHead
    )
    frozenDefinitionV1<AuditHeadObservationV1>(
      'AuditHeadObservationV1',
      outcome.postHead
    )
    frozenDefinitionV1<AuditSemanticEventCorrelationV1>(
      'AuditSemanticEventCorrelationV1',
      outcome.semanticEvent
    )
    const bytes = canonicalJsonBytesV1(outcome)
    if (bytes.byteLength > MAX_AUDIT_IDEMPOTENCY_OUTCOME_BYTES)
      refuseAuditV1(
        'audit.record-too-large',
        'audit idempotency outcome exceeds its bounded maximum'
      )
    parseAuditIdempotencyOutcomeV1(bytes, {
      secret: this.#secret,
      storeKey: this.storeKey,
      auditKeyId: this.auditKeyId,
      identity: this.identity,
    })
    this.#store.createOrVerifyImmutable(
      auditIdempotencyKeyV1(outcome.namespaceSha256),
      bytes
    )
  }

  #retainedIdempotencyOutcomeV1(
    callId: string,
    begun: InFlightCallV1
  ): AuthenticatedAuditIdempotencyOutcomeV1 | null
  {
    if (
      begun.boundary.boundaryKind !== 'tool' ||
      begun.idempotency.state !== 'present'
    )
      return null
    const key = auditIdempotencyKeyV1(begun.idempotency.namespaceSha256)
    if (!hasAuditArtifactV1(this.#store, key)) return null
    const outcome = parseAuditIdempotencyOutcomeV1(
      this.#store.readImmutable(key),
      {
        secret: this.#secret,
        storeKey: this.storeKey,
        auditKeyId: this.auditKeyId,
        identity: this.identity,
      }
    )
    if (
      outcome.callId !== callId ||
      outcome.beginSequence !== begun.sequence ||
      outcome.beginRecordSha256 !== begun.recordSha256 ||
      outcome.namespaceSha256 !== begun.idempotency.namespaceSha256 ||
      outcome.requestIdSha256 !== begun.idempotency.requestIdSha256 ||
      outcome.fullInputSha256 !== begun.fullInputSha256 ||
      !timingSafeBytesEqual(
        canonicalJsonBytesV1(outcome.boundary),
        canonicalJsonBytesV1(begun.boundary)
      )
    )
      refuseAuditV1(
        'audit.interior-tamper',
        'retained idempotency outcome disagrees with its audit begin'
      )
    return outcome
  }

  #serverCloseReceiptCandidate(): {
    readonly receipt: AuditReceiptV1
    readonly resultSha256: string
  } | null
  {
    if (this.#tail.expectedNextSequence < 2) return null
    const reconciliation = this.verify()
    const complete = reconciliation.records.get(
      this.#tail.expectedNextSequence - 1
    )
    if (!complete || complete.record.record.phase === 'call-begin') return null
    const completeRecord = complete.record.record
    const begin = reconciliation.records.get(completeRecord.beginSequence)
    if (
      !begin ||
      begin.record.record.phase !== 'call-begin' ||
      begin.record.record.callId !== completeRecord.callId ||
      begin.record.record.boundary.boundaryKind !== 'server-close' ||
      begin.sha256 !== completeRecord.beginRecordSha256
    )
      return null
    return Object.freeze({
      resultSha256: completeRecord.resultSha256,
      receipt: Object.freeze({
        callId: completeRecord.callId,
        beginSequence: begin.record.record.sequence,
        beginRecordSha256: begin.sha256,
        completeSequence: completeRecord.sequence,
        completeRecordSha256: complete.sha256,
      }),
    })
  }

  #restoreUnmatchedBegins(records: ReadonlyMap<number, LoadedRecordV1>): void
  {
    const terminals = new Set<string>()
    for (const loaded of records.values())
      if (loaded.record.record.phase !== 'call-begin')
        terminals.add(loaded.record.record.callId)
    for (const loaded of records.values())
    {
      const record = loaded.record.record
      if (record.phase !== 'call-begin' || terminals.has(record.callId))
        continue
      this.#inFlight.set(record.callId, {
        boundary: record.boundary,
        principal: record.principal,
        sequence: record.sequence,
        recordSha256: loaded.sha256,
        startedMonotonicMs: record.startedMonotonicMs,
        fullInputSha256: record.fullInputSha256,
        session: record.session,
        expectedHead: record.expectedHead,
        idempotency: record.idempotency,
      })
    }
    this.#begunCalls = this.#inFlight.size
  }
}

function hasAuditArtifactV1(store: DurableArtifactStore, key: string): boolean
{
  return store.listImmutable(key).some((entry) => entry.key === key)
}

export interface AuditServerManifestV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-server-store-v1'
  readonly storeKey: string
  readonly durableStoreId: string
  readonly initialOwnershipSha256: string
  readonly auditKeyId: string
  readonly auditAlgorithm: typeof AUDIT_ALGORITHM_V1
  readonly auditAlgorithmVersion: typeof AUDIT_ALGORITHM_VERSION_V1
  readonly auditKeyPurpose: typeof AUDIT_KEY_PURPOSE_V1
  readonly identity: AuditServerStoreIdentityV1
  readonly recordCap: number
  readonly byteCap: number
  readonly manifestMac: string
}

export interface AuditPredecessorHandoffManifestV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-server-predecessor-handoff-v1'
  readonly serverManifest: AuditServerManifestV1
  readonly terminal: AuditTerminalEvidenceV1
}

function installStoreLayoutV1(
  store: DurableArtifactStore,
  storeKey: string,
  material: AuditKeyMaterialV1,
  identity: AuditServerStoreIdentityV1,
  recordCap: number,
  byteCap: number
): void
{
  assertServerStoreIdentityV1(identity)
  const capability = store.capability()
  const unsignedManifest = {
    schemaVersion: 1 as const,
    format: 'mcp-server-store-v1' as const,
    storeKey,
    durableStoreId: capability.storeId,
    initialOwnershipSha256: capability.ownershipSha256,
    identity,
    auditKeyId: material.auditKeyId,
    auditAlgorithm: AUDIT_ALGORITHM_V1,
    auditAlgorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
    auditKeyPurpose: AUDIT_KEY_PURPOSE_V1,
    recordCap,
    byteCap,
  }
  store.createOrVerifyImmutable(
    AUDIT_SERVER_MANIFEST_KEY,
    canonicalJsonBytesV1({
      ...unsignedManifest,
      manifestMac: domainMacV1(
        material.secret,
        AUDIT_SERVER_MANIFEST_MAC_DOMAIN_V1,
        unsignedManifest
      ),
    })
  )
  store.createOrVerifyImmutable(
    AUDIT_QUOTAS_KEY,
    canonicalJsonBytesV1({
      schemaVersion: 1,
      auditRecordCap: recordCap,
      auditByteCap: byteCap,
      auditReserveRecords: auditReserveRecordsV1(recordCap),
      maximumAuditRecordBytes: MAX_AUDIT_RECORD_BYTES,
    })
  )
  const emptyCatalogue = canonicalJsonBytesV1({ schemaVersion: 1, entries: [] })
  store.createOrVerifyImmutable(AUDIT_REGISTRY_ATTEMPTS_KEY, emptyCatalogue)
  store.createOrVerifyImmutable(AUDIT_SESSIONS_KEY, emptyCatalogue)
  const recoveryIndexBytes = canonicalJsonBytesV1({
    schemaVersion: 1,
    reconciliations: [],
  })
  if (!hasAuditArtifactV1(store, AUDIT_RECOVERY_INDEX_KEY))
    store.compareAndSwapPointer(
      AUDIT_RECOVERY_INDEX_KEY,
      null,
      recoveryIndexBytes
    )
  else if (
    !timingSafeBytesEqual(
      store.readImmutable(AUDIT_RECOVERY_INDEX_KEY),
      recoveryIndexBytes
    )
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the partial process recovery index differs from genesis'
    )
}

function readServerManifestV1(
  store: DurableArtifactStore,
  storeKey: string,
  expectedIdentity?: AuditServerStoreIdentityV1
): AuditServerManifestV1
{
  const bytes = store.readImmutable(AUDIT_SERVER_MANIFEST_KEY)
  const manifest = parseJsonObject(bytes, 'audit.store-invalid')
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(manifest), bytes) ||
    !hasExactKeysV1(manifest, [
      'auditAlgorithm',
      'auditAlgorithmVersion',
      'auditKeyId',
      'auditKeyPurpose',
      'byteCap',
      'durableStoreId',
      'format',
      'identity',
      'initialOwnershipSha256',
      'manifestMac',
      'recordCap',
      'schemaVersion',
      'storeKey',
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.format !== 'mcp-server-store-v1' ||
    manifest.storeKey !== storeKey ||
    manifest.durableStoreId !== store.storeId ||
    typeof manifest.initialOwnershipSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(manifest.initialOwnershipSha256) ||
    typeof manifest.auditKeyId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(manifest.auditKeyId) ||
    manifest.auditAlgorithm !== AUDIT_ALGORITHM_V1 ||
    manifest.auditAlgorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    manifest.auditKeyPurpose !== AUDIT_KEY_PURPOSE_V1 ||
    typeof manifest.manifestMac !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(manifest.manifestMac) ||
    !Number.isSafeInteger(manifest.recordCap) ||
    !Number.isSafeInteger(manifest.byteCap) ||
    manifest.identity === null ||
    typeof manifest.identity !== 'object'
  )
  {
    refuseAuditV1(
      'audit.store-invalid',
      'the server manifest does not pin this audit store'
    )
  }
  const identity = manifest.identity as unknown as AuditServerStoreIdentityV1
  assertServerStoreIdentityV1(identity)
  assertAuditCapsV1(manifest.recordCap as number, manifest.byteCap as number)
  if (
    expectedIdentity !== undefined &&
    !timingSafeBytesEqual(
      canonicalJsonBytesV1(identity),
      canonicalJsonBytesV1(expectedIdentity)
    )
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the server manifest carries another server/run/realm/profile identity'
    )
  return {
    schemaVersion: 1,
    format: 'mcp-server-store-v1',
    storeKey,
    durableStoreId: manifest.durableStoreId as string,
    initialOwnershipSha256: manifest.initialOwnershipSha256,
    auditKeyId: manifest.auditKeyId,
    auditAlgorithm: AUDIT_ALGORITHM_V1,
    auditAlgorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
    auditKeyPurpose: AUDIT_KEY_PURPOSE_V1,
    identity,
    recordCap: manifest.recordCap as number,
    byteCap: manifest.byteCap as number,
    manifestMac: manifest.manifestMac,
  }
}

function authenticateServerManifestV1(
  manifest: AuditServerManifestV1,
  secret: Uint8Array
): void
{
  const { manifestMac, ...unsigned } = manifest
  if (
    !timingSafeBytesEqual(
      hexBytes(manifestMac),
      hexBytes(
        domainMacV1(secret, AUDIT_SERVER_MANIFEST_MAC_DOMAIN_V1, unsigned)
      )
    )
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the server manifest MAC does not verify under its pinned key'
    )
}

async function requestVerificationKeyV1(
  keys: AuditKeyProviderPort,
  auditKeyId: string
): Promise<AuditKeyMaterialV1>
{
  let material: AuditKeyMaterialV1
  try
  {
    material = await keys.verificationKey(auditKeyId)
  }
  catch (error)
  {
    if (isAuditKeyUnavailableErrorV1(error))
    {
      refuseAuditV1(
        'audit.key-unavailable',
        `the audit key this store pins is ${error.reason}`
      )
    }
    throw error
  }
  assertAuditKeyMaterialV1(material)
  if (material.auditKeyId !== auditKeyId)
  {
    refuseAuditV1(
      'audit.key-unavailable',
      'the provider answered w/ a different audit key ID'
    )
  }
  return material
}

// the reconciliation outcome is durable evidence in its own right, & it never
// names key bytes, only the key ID the store already pins
function recordReconciliationV1(
  store: DurableArtifactStore,
  reconciliation: AuditReconciliationV1
): void
{
  const observed = store.readImmutable(AUDIT_RECOVERY_INDEX_KEY)
  const current = parseJsonObject(observed, 'audit.store-invalid')
  const entries = Array.isArray(current.reconciliations)
    ? (current.reconciliations as unknown[]).slice(-31)
    : []
  entries.push({
    tailSha256: reconciliation.tailSha256,
    expectedNextSequence: reconciliation.tail.expectedNextSequence,
    recordCount: reconciliation.tail.recordCount,
    rolledForward: reconciliation.rolledForward,
    auditKeyId: reconciliation.tail.auditKeyId,
  })
  store.compareAndSwapPointer(
    AUDIT_RECOVERY_INDEX_KEY,
    sha256Hex(observed),
    canonicalJsonBytesV1({ schemaVersion: 1, reconciliations: entries })
  )
}

// * an observational mount is read-only & unauthenticated. It yields evidence
// * marked unverified & CANNOT issue an AuditReceiptV1 or a cross-store
// * idempotency guarantee, because nothing here proves the tail is genuine
export function mountObservationalAuditStoreV1(
  serverRoot: string,
  storeKey: string
): AuditStoreEvidenceV1
{
  const store = new DurableArtifactStore(storeRootV1(serverRoot, storeKey), {
    mode: 'read-only',
  })
  const manifest = readServerManifestV1(store, storeKey)
  const reconciliation = reconcileAuditStoreV1(store, null, false, {
    storeKey,
    auditKeyId: manifest.auditKeyId,
  })
  return Object.freeze({
    storeKey,
    auditKeyId: manifest.auditKeyId,
    authenticated: false,
    tail: reconciliation.tail,
    tailSha256: reconciliation.tailSha256,
    recordCount: reconciliation.records.size,
    recordBytes: reconciliation.tail.recordBytes,
    highestSequence: reconciliation.records.size - 1,
    rolledForward: false,
  })
}

export interface AuthenticatedAuditStoreMountV1
{
  readonly evidence: AuditStoreEvidenceV1
  readonly identity: AuditServerStoreIdentityV1
  readonly terminal: AuditTerminalEvidenceV1
  readonly terminalSideEffect: AuditTerminalSideEffectPlanV1 | null
}

export type AuthenticatedAuditIdempotencyLookupV1 =
  | { readonly state: 'absent' }
  | {
      readonly state: 'conflict'
      readonly storeKey: string
      readonly outcome: AuthenticatedAuditIdempotencyOutcomeV1
    }
  | {
      readonly state: 'matched'
      readonly storeKey: string
      readonly outcome: AuthenticatedAuditIdempotencyOutcomeV1
    }

function auditRecordsAuthenticateIdempotencyOutcomeV1(
  records: ReadonlyMap<number, LoadedRecordV1>,
  outcome: AuthenticatedAuditIdempotencyOutcomeV1
): boolean
{
  const loadedBegin = records.get(outcome.beginSequence)
  const begin = loadedBegin?.record.record
  if (
    begin?.phase !== 'call-begin' ||
    loadedBegin?.sha256 !== outcome.beginRecordSha256 ||
    begin.callId !== outcome.callId ||
    begin.idempotency.state !== 'present' ||
    begin.idempotency.namespaceSha256 !== outcome.namespaceSha256 ||
    begin.idempotency.requestIdSha256 !== outcome.requestIdSha256 ||
    begin.fullInputSha256 !== outcome.fullInputSha256 ||
    !timingSafeBytesEqual(
      canonicalJsonBytesV1(begin.boundary),
      canonicalJsonBytesV1(outcome.boundary)
    )
  )
    return false
  return [...records.values()].some((candidate) =>
  {
    const terminal = candidate.record.record
    return (
      terminal.phase !== 'call-begin' &&
      terminal.callId === outcome.callId &&
      terminal.beginSequence === outcome.beginSequence &&
      terminal.beginRecordSha256 === outcome.beginRecordSha256 &&
      terminal.resultSha256 === outcome.resultSha256 &&
      terminal.phase ===
        (outcome.disposition === 'completed'
          ? 'call-complete'
          : 'call-rejected') &&
      timingSafeBytesEqual(
        canonicalJsonBytesV1(terminal.boundary),
        canonicalJsonBytesV1(outcome.boundary)
      ) &&
      timingSafeBytesEqual(
        canonicalJsonBytesV1(terminal.preHead),
        canonicalJsonBytesV1(outcome.preHead)
      ) &&
      timingSafeBytesEqual(
        canonicalJsonBytesV1(terminal.postHead),
        canonicalJsonBytesV1(outcome.postHead)
      ) &&
      timingSafeBytesEqual(
        canonicalJsonBytesV1(terminal.semanticEvent),
        canonicalJsonBytesV1(outcome.semanticEvent)
      ) &&
      timingSafeBytesEqual(
        canonicalJsonBytesV1(terminal.evidenceIds),
        canonicalJsonBytesV1(outcome.evidenceIds)
      )
    )
  })
}

function readAuditTerminalV1(
  store: DurableArtifactStore,
  identity: AuditServerStoreIdentityV1,
  reconciliation: AuditReconciliationV1
): AuditTerminalEvidenceV1
{
  const bytes = store.readImmutable(AUDIT_TERMINAL_KEY)
  const parsed = parseJsonObject(bytes, 'audit.store-invalid')
  const terminal = parsed as unknown as AuditTerminalEvidenceV1
  assertAuditTerminalShapeV1(terminal)
  const { terminalSha256: _terminalSha256, ...withoutHash } = terminal
  const expectedSha256 = sha256Hex(canonicalJsonBytesV1(withoutHash))
  const receipt = frozenDefinitionV1<AuditReceiptV1>(
    'AuditReceiptV1',
    terminal.closeReceipt
  )
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes) ||
    !hasExactKeysV1(parsed, [
      'auditKeyId',
      'closeReceipt',
      'finalRecordSha256',
      'finalTailSha256',
      'recordBytes',
      'recordCount',
      'runId',
      'schemaVersion',
      'serverInstanceId',
      'storeKey',
      'terminalSha256',
    ]) ||
    terminal.schemaVersion !== 1 ||
    terminal.storeKey !== reconciliation.tail.storeKey ||
    terminal.serverInstanceId !== identity.serverInstanceId ||
    terminal.runId !== identity.runId ||
    terminal.auditKeyId !== reconciliation.tail.auditKeyId ||
    terminal.finalTailSha256 !== reconciliation.tailSha256 ||
    terminal.finalRecordSha256 !== reconciliation.tail.currentRecordSha256 ||
    terminal.recordCount !== reconciliation.tail.recordCount ||
    terminal.recordBytes !== reconciliation.tail.recordBytes ||
    receipt.completeRecordSha256 !== terminal.finalRecordSha256 ||
    terminal.terminalSha256 !== expectedSha256
  )
    refuseAuditV1(
      'audit.store-invalid',
      'terminal audit anchor does not match the authenticated final tail'
    )
  return Object.freeze({ ...terminal, closeReceipt: receipt })
}

export async function mountAuthenticatedAuditStoreV1(
  serverRoot: string,
  storeKey: string,
  keys: AuditKeyProviderPort,
  expectedIdentity?: AuditServerStoreIdentityV1
): Promise<AuthenticatedAuditStoreMountV1>
{
  const unauthenticated = new DurableArtifactStore(
    storeRootV1(serverRoot, storeKey),
    {
      mode: 'read-only',
    }
  )
  const manifest = readServerManifestV1(
    unauthenticated,
    storeKey,
    expectedIdentity
  )
  const material = await requestVerificationKeyV1(keys, manifest.auditKeyId)
  authenticateServerManifestV1(manifest, material.secret)
  const store = new DurableArtifactStore(storeRootV1(serverRoot, storeKey), {
    mode: 'read-only',
    ownershipAuthority: auditOwnershipAuthorityV1(
      material.secret,
      `process-${storeKey}`
    ),
  })
  readServerManifestV1(store, storeKey, expectedIdentity)
  const reconciliation = reconcileAuditStoreV1(store, material.secret, false, {
    storeKey,
    auditKeyId: manifest.auditKeyId,
  })
  if (!reconciliation.authenticated || reconciliation.rolledForward)
    refuseAuditV1(
      'audit.store-invalid',
      'predecessor mount is not one authenticated terminal view'
    )
  const terminal = readAuditTerminalV1(store, manifest.identity, reconciliation)
  const terminalSideEffect = hasAuditArtifactV1(
    store,
    AUDIT_TERMINAL_SIDE_EFFECT_KEY
  )
    ? parseAuditTerminalSideEffectPlanV1(
        store.readImmutable(AUDIT_TERMINAL_SIDE_EFFECT_KEY),
        {
          secret: material.secret,
          terminal,
          identity: manifest.identity,
        }
      )
    : null
  return Object.freeze({
    identity: manifest.identity,
    terminal,
    terminalSideEffect,
    evidence: Object.freeze({
      storeKey,
      auditKeyId: manifest.auditKeyId,
      authenticated: true,
      tail: reconciliation.tail,
      tailSha256: reconciliation.tailSha256,
      recordCount: reconciliation.records.size,
      recordBytes: reconciliation.tail.recordBytes,
      highestSequence: reconciliation.records.size - 1,
      rolledForward: false,
    }),
  })
}

export function parseAuditPredecessorHandoffManifestV1(
  bytes: Uint8Array
): AuditPredecessorHandoffManifestV1
{
  const parsed = parseJsonObject(bytes, 'audit.store-invalid')
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes) ||
    !hasExactKeysV1(parsed, [
      'format',
      'schemaVersion',
      'serverManifest',
      'terminal',
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.format !== 'mcp-server-predecessor-handoff-v1'
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the predecessor handoff is not one exact canonical v1 manifest'
    )
  const serverManifest = parsed.serverManifest as AuditServerManifestV1
  const terminal = parsed.terminal as AuditTerminalEvidenceV1
  const manifestRecord = serverManifest as unknown as Record<string, unknown>
  if (
    serverManifest === null ||
    typeof serverManifest !== 'object' ||
    Array.isArray(serverManifest) ||
    !hasExactKeysV1(manifestRecord, [
      'auditAlgorithm',
      'auditAlgorithmVersion',
      'auditKeyId',
      'auditKeyPurpose',
      'byteCap',
      'durableStoreId',
      'format',
      'identity',
      'initialOwnershipSha256',
      'manifestMac',
      'recordCap',
      'schemaVersion',
      'storeKey',
    ]) ||
    serverManifest.schemaVersion !== 1 ||
    serverManifest.format !== 'mcp-server-store-v1' ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(serverManifest.storeKey) ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(serverManifest.durableStoreId) ||
    !LOWERCASE_SHA256_PATTERN.test(serverManifest.initialOwnershipSha256) ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(serverManifest.auditKeyId) ||
    serverManifest.auditAlgorithm !== AUDIT_ALGORITHM_V1 ||
    serverManifest.auditAlgorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    serverManifest.auditKeyPurpose !== AUDIT_KEY_PURPOSE_V1 ||
    !Number.isSafeInteger(serverManifest.recordCap) ||
    !Number.isSafeInteger(serverManifest.byteCap) ||
    !LOWERCASE_SHA256_PATTERN.test(serverManifest.manifestMac)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the predecessor handoff server manifest is invalid'
    )
  assertAuditCapsV1(serverManifest.recordCap, serverManifest.byteCap)
  assertServerStoreIdentityV1(serverManifest.identity)
  assertAuditTerminalShapeV1(terminal)
  if (
    terminal.storeKey !== serverManifest.storeKey ||
    terminal.serverInstanceId !== serverManifest.identity.serverInstanceId ||
    terminal.runId !== serverManifest.identity.runId ||
    terminal.auditKeyId !== serverManifest.auditKeyId
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the predecessor handoff terminal does not identify its server manifest'
    )
  return Object.freeze({
    schemaVersion: 1,
    format: 'mcp-server-predecessor-handoff-v1',
    serverManifest: Object.freeze(serverManifest),
    terminal: Object.freeze(terminal),
  })
}

export async function createAuditPredecessorHandoffManifestV1(input: {
  readonly serverRoot: string
  readonly storeKey: string
  readonly keys: AuditKeyProviderPort
  readonly expectedIdentity?: AuditServerStoreIdentityV1
}): Promise<Uint8Array>
{
  const store = new DurableArtifactStore(
    storeRootV1(input.serverRoot, input.storeKey),
    { mode: 'read-only' }
  )
  const serverManifest = readServerManifestV1(
    store,
    input.storeKey,
    input.expectedIdentity
  )
  const material = await requestVerificationKeyV1(
    input.keys,
    serverManifest.auditKeyId
  )
  authenticateServerManifestV1(serverManifest, material.secret)
  const mounted = await mountAuthenticatedAuditStoreV1(
    input.serverRoot,
    input.storeKey,
    input.keys,
    input.expectedIdentity
  )
  return canonicalJsonBytesV1({
    schemaVersion: 1,
    format: 'mcp-server-predecessor-handoff-v1',
    serverManifest,
    terminal: mounted.terminal,
  })
}

async function lookupAuthenticatedAuditIdempotencyStoreV1(input: {
  readonly serverRoot: string
  readonly storeKey: string
  readonly keys: AuditKeyProviderPort
  readonly identity: AuditServerStoreIdentityV1
  readonly namespaceSha256: string
  readonly requestIdSha256: string
  readonly fullInputSha256: string
  readonly boundary: Extract<
    ServerAuditBoundaryV1,
    { readonly boundaryKind: 'tool' }
  >
}): Promise<AuthenticatedAuditIdempotencyLookupV1>
{
  const mounted = await mountAuthenticatedAuditStoreV1(
    input.serverRoot,
    input.storeKey,
    input.keys,
    input.identity
  )
  const store = new DurableArtifactStore(
    storeRootV1(input.serverRoot, input.storeKey),
    { mode: 'read-only' }
  )
  const key = auditIdempotencyKeyV1(input.namespaceSha256)
  if (!hasAuditArtifactV1(store, key)) return { state: 'absent' }
  const material = await requestVerificationKeyV1(
    input.keys,
    mounted.evidence.auditKeyId
  )
  const authenticatedStore = new DurableArtifactStore(
    storeRootV1(input.serverRoot, input.storeKey),
    {
      mode: 'read-only',
      ownershipAuthority: auditOwnershipAuthorityV1(
        material.secret,
        `process-${input.storeKey}`
      ),
    }
  )
  const outcome = parseAuditIdempotencyOutcomeV1(
    authenticatedStore.readImmutable(key),
    {
      secret: material.secret,
      storeKey: input.storeKey,
      auditKeyId: mounted.evidence.auditKeyId,
      identity: input.identity,
    }
  )
  const reconciliation = reconcileAuditStoreV1(
    authenticatedStore,
    material.secret,
    false,
    {
      storeKey: input.storeKey,
      auditKeyId: mounted.evidence.auditKeyId,
    }
  )
  if (
    !auditRecordsAuthenticateIdempotencyOutcomeV1(
      reconciliation.records,
      outcome
    )
  )
    refuseAuditV1(
      'audit.interior-tamper',
      'predecessor idempotency outcome has no authenticated terminal audit pair'
    )
  if (outcome.namespaceSha256 !== input.namespaceSha256)
    refuseAuditV1(
      'audit.interior-tamper',
      'authenticated idempotency outcome is stored under another namespace'
    )
  return outcome.requestIdSha256 === input.requestIdSha256 &&
    outcome.fullInputSha256 === input.fullInputSha256 &&
    timingSafeBytesEqual(
      canonicalJsonBytesV1(outcome.boundary),
      canonicalJsonBytesV1(input.boundary)
    )
    ? { state: 'matched', storeKey: input.storeKey, outcome }
    : { state: 'conflict', storeKey: input.storeKey, outcome }
}

export type AuditSupervisorLiveTailV1 =
  | { readonly state: 'absent' }
  | {
      readonly state: 'present'
      readonly storeKey: string
      readonly auditKeyId: string
      readonly tail: AuditTailBodyV1
      readonly tailSha256: string
    }

export interface AuditSupervisorOwnershipCheckpointV1
{
  readonly ownershipSha256: string
  readonly generation: number
  readonly previousOwnershipSha256: string | null
}

function ownershipCheckpointV1(
  capability: ReturnType<DurableArtifactStore['capability']>
): AuditSupervisorOwnershipCheckpointV1
{
  return Object.freeze({
    ownershipSha256: capability.ownershipSha256,
    generation: capability.ownershipGeneration,
    previousOwnershipSha256: capability.previousOwnershipSha256,
  })
}

function ownershipCheckpointRelationV1(
  observed: AuditSupervisorOwnershipCheckpointV1,
  expected: AuditSupervisorOwnershipCheckpointV1
): 'equal' | 'successor'
{
  if (
    observed.ownershipSha256 === expected.ownershipSha256 &&
    observed.generation === expected.generation &&
    observed.previousOwnershipSha256 === expected.previousOwnershipSha256
  )
    return 'equal'
  if (
    observed.generation === expected.generation + 1 &&
    observed.previousOwnershipSha256 === expected.ownershipSha256
  )
    return 'successor'
  return refuseAuditV1(
    'audit.store-invalid',
    'durable writer ownership is rolled back, skipped, or substituted'
  )
}

export type AuditSupervisorProcessOwnershipV1 =
  | { readonly state: 'absent' }
  | ({ readonly state: 'present' } & AuditSupervisorOwnershipCheckpointV1)

export type AuditSupervisorCurrentV1 =
  | { readonly state: 'absent' }
  | {
      readonly state: 'active'
      readonly storeKey: string
      readonly identity: AuditServerStoreIdentityV1
      readonly liveTail: AuditSupervisorLiveTailV1
      readonly processAuditKeyId: string
      readonly processRecordCap: number
      readonly processByteCap: number
      readonly supervisorRecoveryClaimCap: number
      readonly supervisorOwnershipGenerationAtAllocation: number
      readonly processOwnership: AuditSupervisorProcessOwnershipV1
    }
  | {
      readonly state: 'terminal'
      readonly storeKey: string
      readonly identity: AuditServerStoreIdentityV1
      readonly liveTail: Extract<
        AuditSupervisorLiveTailV1,
        { readonly state: 'present' }
      >
      readonly processAuditKeyId: string
      readonly processRecordCap: number
      readonly processByteCap: number
      readonly supervisorRecoveryClaimCap: number
      readonly supervisorOwnershipGenerationAtAllocation: number
      readonly processOwnership: Extract<
        AuditSupervisorProcessOwnershipV1,
        { readonly state: 'present' }
      >
      readonly terminal: AuditTerminalEvidenceV1
    }

export interface AuditSupervisorPredecessorV1
{
  readonly storeKey: string
  readonly identity: AuditServerStoreIdentityV1
  readonly terminal: AuditTerminalEvidenceV1
  readonly successorStoreKey: string
}

export interface AuditSupervisorIndexV1
{
  readonly schemaVersion: 1
  readonly generation: number
  readonly supervisorOwnership: AuditSupervisorOwnershipCheckpointV1
  readonly current: AuditSupervisorCurrentV1
  readonly predecessors: readonly AuditSupervisorPredecessorV1[]
}

export interface AuditSupervisorOptionsV1
{
  readonly serverRoot: string
  readonly keys: AuditKeyProviderPort
  readonly faultHook?: DurableArtifactFaultHook
}

export interface AuditStoreIdentitySeedV1
{
  readonly serverInstanceId: string
  readonly runId: string
  readonly realmSha256: string
  readonly profileSha256: string
  readonly boundaryPolicySha256: string
}

export type AuditRecoveryClassificationV1 = Omit<AuditCompleteInputV1, 'callId'>

export interface AuditRecoveryTerminalInputV1
{
  readonly principal: AuditPrincipalIdentityV1
  readonly fullInputSha256: string
  readonly inputByteLength: number
  readonly rawArgument?: unknown
  readonly outcome: NonToolReceiptFreeOutcomeHashProjectionV1
}

interface AuditSupervisorManifestV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-audit-supervisor-v1'
  readonly durableStoreId: string
  readonly initialOwnershipSha256: string
  readonly auditKeyId: string
  readonly auditAlgorithm: typeof AUDIT_ALGORITHM_V1
  readonly auditAlgorithmVersion: typeof AUDIT_ALGORITHM_VERSION_V1
  readonly auditKeyPurpose: typeof AUDIT_KEY_PURPOSE_V1
  readonly manifestMac: string
}

interface AuditSupervisorTransitionV1
{
  readonly schemaVersion: 1
  readonly format: 'mcp-audit-supervisor-transition-v1'
  readonly purpose: 'server-audit-supervisor-transition'
  readonly auditKeyId: string
  readonly algorithm: typeof AUDIT_ALGORITHM_V1
  readonly algorithmVersion: typeof AUDIT_ALGORITHM_VERSION_V1
  readonly previousTransitionSha256: string
  readonly index: AuditSupervisorIndexV1
  readonly mac: string
}

function assertAuditTerminalShapeV1(terminal: AuditTerminalEvidenceV1): void
{
  const record = terminal as unknown as Record<string, unknown>
  if (
    terminal === null ||
    typeof terminal !== 'object' ||
    Array.isArray(terminal) ||
    !hasExactKeysV1(record, [
      'auditKeyId',
      'closeReceipt',
      'finalRecordSha256',
      'finalTailSha256',
      'recordBytes',
      'recordCount',
      'runId',
      'schemaVersion',
      'serverInstanceId',
      'storeKey',
      'terminalSha256',
    ]) ||
    terminal.schemaVersion !== 1 ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(terminal.storeKey) ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(terminal.serverInstanceId) ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(terminal.runId) ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(terminal.auditKeyId) ||
    !LOWERCASE_SHA256_PATTERN.test(terminal.finalTailSha256) ||
    !LOWERCASE_SHA256_PATTERN.test(terminal.finalRecordSha256) ||
    !Number.isSafeInteger(terminal.recordCount) ||
    terminal.recordCount < 0 ||
    !Number.isSafeInteger(terminal.recordBytes) ||
    terminal.recordBytes < 0 ||
    !LOWERCASE_SHA256_PATTERN.test(terminal.terminalSha256)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'audit terminal evidence is not one exact bounded terminal'
    )
  frozenDefinitionV1<AuditReceiptV1>('AuditReceiptV1', terminal.closeReceipt)
  const { terminalSha256: _terminalSha256, ...withoutHash } = terminal
  if (sha256Hex(canonicalJsonBytesV1(withoutHash)) !== terminal.terminalSha256)
    refuseAuditV1(
      'audit.store-invalid',
      'audit terminal self-hash does not verify'
    )
}

function auditSupervisorRootV1(serverRoot: string): string
{
  return join(serverRoot, AUDIT_SUPERVISOR_DIRECTORY)
}

function assertSupervisorProcessStoreInventoryV1(
  serverRoot: string,
  index: AuditSupervisorIndexV1
): void
{
  const expected = new Map<string, 'active' | 'terminal' | 'predecessor'>()
  if (index.current.state !== 'absent')
    expected.set(index.current.storeKey, index.current.state)
  for (const predecessor of index.predecessors)
  {
    if (expected.has(predecessor.storeKey))
      refuseAuditV1(
        'audit.store-invalid',
        'one process store is duplicated across supervisor roles'
      )
    expected.set(predecessor.storeKey, 'predecessor')
  }
  const observed = new Set<string>()
  for (const entry of readdirSync(serverRoot, { withFileTypes: true }))
  {
    if (!entry.name.startsWith(AUDIT_STORE_DIRECTORY_PREFIX)) continue
    if (!entry.isDirectory())
      refuseAuditV1(
        'audit.store-invalid',
        'an audit process-store name is not a directory'
      )
    const storeKey = entry.name.slice(AUDIT_STORE_DIRECTORY_PREFIX.length)
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(storeKey))
      refuseAuditV1(
        'audit.store-invalid',
        'an audit process-store directory has an invalid key'
      )
    if (!expected.has(storeKey))
      refuseAuditV1(
        'audit.store-invalid',
        'an audit process store is omitted from the authenticated supervisor'
      )
    observed.add(storeKey)
  }
  for (const [storeKey, role] of expected)
    if (!observed.has(storeKey) && role !== 'active')
      refuseAuditV1(
        'audit.store-invalid',
        'the authenticated supervisor names a missing terminal process store'
      )
}

function assertAuditSupervisorLiveTailV1(
  liveTail: AuditSupervisorLiveTailV1,
  storeKey: string
): void
{
  const record = liveTail as unknown as Record<string, unknown>
  if (liveTail.state === 'absent')
  {
    if (!hasExactKeysV1(record, ['state']))
      refuseAuditV1(
        'audit.store-invalid',
        'an absent supervisor live-tail checkpoint has unknown fields'
      )
    return
  }
  if (
    liveTail.state !== 'present' ||
    !hasExactKeysV1(record, [
      'auditKeyId',
      'state',
      'storeKey',
      'tail',
      'tailSha256',
    ]) ||
    liveTail.storeKey !== storeKey ||
    liveTail.tail.storeKey !== storeKey ||
    liveTail.auditKeyId !== liveTail.tail.auditKeyId ||
    !LOWERCASE_SHA256_PATTERN.test(liveTail.tailSha256)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the supervisor live-tail checkpoint is not one exact projection'
    )
  parseAuditTailV1(
    canonicalJsonBytesV1({ body: liveTail.tail, mac: ZERO_SHA256 })
  )
}

function assertAuditSupervisorOwnershipCheckpointV1(
  checkpoint: AuditSupervisorOwnershipCheckpointV1
): void
{
  if (
    checkpoint === null ||
    typeof checkpoint !== 'object' ||
    Array.isArray(checkpoint) ||
    !hasExactKeysV1(checkpoint as unknown as Record<string, unknown>, [
      'generation',
      'ownershipSha256',
      'previousOwnershipSha256',
    ]) ||
    !Number.isSafeInteger(checkpoint.generation) ||
    checkpoint.generation < 0 ||
    !LOWERCASE_SHA256_PATTERN.test(checkpoint.ownershipSha256) ||
    (checkpoint.previousOwnershipSha256 !== null &&
      !LOWERCASE_SHA256_PATTERN.test(checkpoint.previousOwnershipSha256)) ||
    (checkpoint.generation === 0) !==
      (checkpoint.previousOwnershipSha256 === null)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'an audit ownership checkpoint is not one exact monotonic projection'
    )
}

function assertAuditSupervisorProcessOwnershipV1(
  ownership: AuditSupervisorProcessOwnershipV1
): void
{
  const record = ownership as unknown as Record<string, unknown>
  if (ownership.state === 'absent')
  {
    if (!hasExactKeysV1(record, ['state']))
      refuseAuditV1(
        'audit.store-invalid',
        'an absent process ownership checkpoint has unknown fields'
      )
    return
  }
  if (
    ownership.state !== 'present' ||
    !hasExactKeysV1(record, [
      'generation',
      'ownershipSha256',
      'previousOwnershipSha256',
      'state',
    ])
  )
    refuseAuditV1(
      'audit.store-invalid',
      'a process ownership checkpoint is not one exact union'
    )
  assertAuditSupervisorOwnershipCheckpointV1({
    generation: ownership.generation,
    ownershipSha256: ownership.ownershipSha256,
    previousOwnershipSha256: ownership.previousOwnershipSha256,
  })
}

function parseAuditSupervisorIndexV1(
  bytes: Uint8Array
): AuditSupervisorIndexV1
{
  const parsed = parseJsonObject(bytes, 'audit.store-invalid')
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes) ||
    !hasExactKeysV1(parsed, [
      'current',
      'generation',
      'predecessors',
      'schemaVersion',
      'supervisorOwnership',
    ]) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.generation !== 'number' ||
    !Number.isSafeInteger(parsed.generation) ||
    parsed.generation < 0 ||
    parsed.current === null ||
    typeof parsed.current !== 'object' ||
    parsed.supervisorOwnership === null ||
    typeof parsed.supervisorOwnership !== 'object' ||
    !Array.isArray(parsed.predecessors)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the supervisor store index is not one bounded v1 index'
    )
  assertAuditSupervisorOwnershipCheckpointV1(
    parsed.supervisorOwnership as unknown as AuditSupervisorOwnershipCheckpointV1
  )
  const current = parsed.current as unknown as AuditSupervisorCurrentV1
  if (
    current.state !== 'absent' &&
    current.state !== 'active' &&
    current.state !== 'terminal'
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the supervisor current-store state is invalid'
    )
  const currentRecord = current as unknown as Record<string, unknown>
  if (
    (current.state === 'absent' && !hasExactKeysV1(currentRecord, ['state'])) ||
    (current.state === 'active' &&
      !hasExactKeysV1(currentRecord, [
        'identity',
        'liveTail',
        'processAuditKeyId',
        'processByteCap',
        'processOwnership',
        'processRecordCap',
        'state',
        'storeKey',
        'supervisorOwnershipGenerationAtAllocation',
        'supervisorRecoveryClaimCap',
      ])) ||
    (current.state === 'terminal' &&
      !hasExactKeysV1(currentRecord, [
        'identity',
        'liveTail',
        'processAuditKeyId',
        'processByteCap',
        'processOwnership',
        'processRecordCap',
        'state',
        'storeKey',
        'supervisorOwnershipGenerationAtAllocation',
        'supervisorRecoveryClaimCap',
        'terminal',
      ]))
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the supervisor current-store union has unknown or missing fields'
    )
  if (current.state !== 'absent')
  {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(current.storeKey))
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor current store key is invalid'
      )
    assertServerStoreIdentityV1(current.identity)
    assertAuditSupervisorLiveTailV1(current.liveTail, current.storeKey)
    if (
      !/^[A-Za-z0-9_-]{8,128}$/u.test(current.processAuditKeyId) ||
      !Number.isSafeInteger(current.processRecordCap) ||
      !Number.isSafeInteger(current.processByteCap) ||
      !Number.isSafeInteger(current.supervisorRecoveryClaimCap) ||
      current.supervisorRecoveryClaimCap < 1 ||
      current.supervisorRecoveryClaimCap !==
        auditReserveRecordsV1(current.processRecordCap) ||
      !Number.isSafeInteger(
        current.supervisorOwnershipGenerationAtAllocation
      ) ||
      current.supervisorOwnershipGenerationAtAllocation < 0 ||
      current.supervisorOwnershipGenerationAtAllocation >
        (parsed.supervisorOwnership as AuditSupervisorOwnershipCheckpointV1)
          .generation ||
      (parsed.supervisorOwnership as AuditSupervisorOwnershipCheckpointV1)
        .generation -
        current.supervisorOwnershipGenerationAtAllocation >
        current.supervisorRecoveryClaimCap
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor process-store allocation is invalid'
      )
    assertAuditCapsV1(current.processRecordCap, current.processByteCap)
    assertAuditSupervisorProcessOwnershipV1(current.processOwnership)
  }
  if (current.state === 'terminal')
  {
    assertAuditTerminalShapeV1(current.terminal)
    if (
      current.terminal.storeKey !== current.storeKey ||
      current.terminal.serverInstanceId !== current.identity.serverInstanceId ||
      current.terminal.runId !== current.identity.runId
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor terminal does not match its current store identity'
      )
    if (
      current.liveTail.state !== 'present' ||
      current.liveTail.tailSha256 !== current.terminal.finalTailSha256 ||
      current.liveTail.tail.currentRecordSha256 !==
        current.terminal.finalRecordSha256 ||
      current.liveTail.tail.recordCount !== current.terminal.recordCount ||
      current.liveTail.tail.recordBytes !== current.terminal.recordBytes
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor terminal differs from its live-tail checkpoint'
      )
  }
  const predecessors =
    parsed.predecessors as unknown as readonly AuditSupervisorPredecessorV1[]
  const storeKeys = new Set<string>()
  for (const predecessor of predecessors)
  {
    if (
      predecessor === null ||
      typeof predecessor !== 'object' ||
      Array.isArray(predecessor) ||
      !hasExactKeysV1(predecessor as unknown as Record<string, unknown>, [
        'identity',
        'storeKey',
        'successorStoreKey',
        'terminal',
      ]) ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(predecessor.storeKey)
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor predecessor entry is not one exact bounded entry'
      )
    assertServerStoreIdentityV1(predecessor.identity)
    assertAuditTerminalShapeV1(predecessor.terminal)
    if (
      storeKeys.has(predecessor.storeKey) ||
      predecessor.terminal.storeKey !== predecessor.storeKey ||
      predecessor.terminal.serverInstanceId !==
        predecessor.identity.serverInstanceId ||
      predecessor.terminal.runId !== predecessor.identity.runId ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(predecessor.successorStoreKey)
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor predecessor index is inconsistent'
      )
    storeKeys.add(predecessor.storeKey)
  }
  return Object.freeze({
    schemaVersion: 1,
    generation: parsed.generation as number,
    supervisorOwnership:
      parsed.supervisorOwnership as AuditSupervisorOwnershipCheckpointV1,
    current,
    predecessors: Object.freeze([...predecessors]),
  })
}

function sealAuditSupervisorTransitionV1(
  secret: Uint8Array,
  auditKeyId: string,
  previousTransitionSha256: string,
  index: AuditSupervisorIndexV1
): Uint8Array
{
  const unsigned = {
    schemaVersion: 1 as const,
    format: 'mcp-audit-supervisor-transition-v1' as const,
    purpose: 'server-audit-supervisor-transition' as const,
    auditKeyId,
    algorithm: AUDIT_ALGORITHM_V1,
    algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
    previousTransitionSha256,
    index,
  }
  return canonicalJsonBytesV1({
    ...unsigned,
    mac: domainMacV1(secret, AUDIT_SUPERVISOR_MAC_DOMAIN_V1, unsigned),
  })
}

function parseAuditSupervisorTransitionV1(
  bytes: Uint8Array,
  secret: Uint8Array,
  auditKeyId: string
): AuditSupervisorTransitionV1
{
  const parsed = parseJsonObject(bytes, 'audit.store-invalid')
  const transition = parsed as unknown as AuditSupervisorTransitionV1
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes) ||
    !hasExactKeysV1(parsed, [
      'algorithm',
      'algorithmVersion',
      'auditKeyId',
      'format',
      'index',
      'mac',
      'previousTransitionSha256',
      'purpose',
      'schemaVersion',
    ]) ||
    transition.schemaVersion !== 1 ||
    transition.format !== 'mcp-audit-supervisor-transition-v1' ||
    transition.purpose !== 'server-audit-supervisor-transition' ||
    transition.auditKeyId !== auditKeyId ||
    transition.algorithm !== AUDIT_ALGORITHM_V1 ||
    transition.algorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    !LOWERCASE_SHA256_PATTERN.test(transition.previousTransitionSha256) ||
    !LOWERCASE_SHA256_PATTERN.test(transition.mac)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the audit supervisor transition is not one exact authenticated envelope'
    )
  const index = parseAuditSupervisorIndexV1(
    canonicalJsonBytesV1(transition.index)
  )
  const { mac, ...unsigned } = transition
  if (
    !timingSafeBytesEqual(
      hexBytes(mac),
      hexBytes(domainMacV1(secret, AUDIT_SUPERVISOR_MAC_DOMAIN_V1, unsigned))
    )
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the audit supervisor transition MAC does not verify'
    )
  return Object.freeze({ ...transition, index })
}

function auditSupervisorTransitionKeyV1(
  generation: number,
  sha256: string
): string
{
  return `${AUDIT_SUPERVISOR_TRANSITION_PREFIX}/${String(generation).padStart(
    6,
    '0'
  )}-${sha256.slice(0, 16)}.json`
}

function reconcileAuditSupervisorTransitionsV1(
  store: DurableArtifactStore,
  secret: Uint8Array,
  auditKeyId: string,
  rollForward: boolean,
  refuseUnreconciled = true
): { readonly index: AuditSupervisorIndexV1; readonly sha256: string }
{
  const transitions = store
    .listImmutable(AUDIT_SUPERVISOR_TRANSITION_PREFIX)
    .sort((left, right) => left.key.localeCompare(right.key))
  if (transitions.length === 0)
    refuseAuditV1(
      'audit.store-invalid',
      'the audit supervisor has no authenticated transition chain'
    )
  let previousSha256 = ZERO_SHA256
  let latest: {
    index: AuditSupervisorIndexV1
    sha256: string
    previousTransitionSha256: string
    bytes: Uint8Array
  } | null = null
  for (let generation = 0; generation < transitions.length; generation += 1)
  {
    const entry = transitions[generation]!
    const match = /^transitions\/(\d{6,})-([0-9a-f]{16})\.json$/u.exec(
      entry.key
    )
    const bytes = store.readImmutable(entry.key)
    const sha256 = sha256Hex(bytes)
    const transition = parseAuditSupervisorTransitionV1(
      bytes,
      secret,
      auditKeyId
    )
    if (
      !match ||
      Number(match[1]) !== generation ||
      match[2] !== sha256.slice(0, 16) ||
      transition.index.generation !== generation ||
      transition.previousTransitionSha256 !== previousSha256
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the audit supervisor transition chain is missing, reordered, or substituted'
      )
    previousSha256 = sha256
    latest = {
      index: transition.index,
      sha256,
      previousTransitionSha256: transition.previousTransitionSha256,
      bytes,
    }
  }
  const pointerBytes = store.readImmutable(AUDIT_SUPERVISOR_INDEX_KEY)
  const pointerSha256 = sha256Hex(pointerBytes)
  const pointer = parseAuditSupervisorTransitionV1(
    pointerBytes,
    secret,
    auditKeyId
  )
  if (latest === null)
    refuseAuditV1(
      'audit.store-invalid',
      'the audit supervisor transition chain is absent'
    )
  if (latest.sha256 !== pointerSha256)
  {
    if (
      latest.index.generation !== pointer.index.generation + 1 ||
      latest.previousTransitionSha256 !== pointerSha256
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the audit supervisor pointer is rolled back or omits transitions'
      )
    if (!rollForward && refuseUnreconciled)
      refuseAuditV1(
        'audit.store-invalid',
        'the audit supervisor has one unreconciled pointer transition'
      )
    if (rollForward)
      store.compareAndSwapPointer(
        AUDIT_SUPERVISOR_INDEX_KEY,
        pointerSha256,
        latest.bytes
      )
  }
  return { index: latest.index, sha256: latest.sha256 }
}

function readAuditSupervisorManifestV1(
  store: DurableArtifactStore
): AuditSupervisorManifestV1
{
  const bytes = store.readImmutable(AUDIT_SUPERVISOR_MANIFEST_KEY)
  const parsed = parseJsonObject(bytes, 'audit.store-invalid')
  if (
    !timingSafeBytesEqual(canonicalJsonBytesV1(parsed), bytes) ||
    !hasExactKeysV1(parsed, [
      'auditAlgorithm',
      'auditAlgorithmVersion',
      'auditKeyId',
      'auditKeyPurpose',
      'durableStoreId',
      'format',
      'initialOwnershipSha256',
      'manifestMac',
      'schemaVersion',
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.format !== 'mcp-audit-supervisor-v1' ||
    parsed.durableStoreId !== store.storeId ||
    typeof parsed.initialOwnershipSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(parsed.initialOwnershipSha256) ||
    typeof parsed.auditKeyId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(parsed.auditKeyId) ||
    parsed.auditAlgorithm !== AUDIT_ALGORITHM_V1 ||
    parsed.auditAlgorithmVersion !== AUDIT_ALGORITHM_VERSION_V1 ||
    parsed.auditKeyPurpose !== AUDIT_KEY_PURPOSE_V1 ||
    typeof parsed.manifestMac !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(parsed.manifestMac)
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the audit supervisor manifest does not pin this durable store'
    )
  return {
    schemaVersion: 1,
    format: 'mcp-audit-supervisor-v1',
    durableStoreId: parsed.durableStoreId as string,
    initialOwnershipSha256: parsed.initialOwnershipSha256,
    auditKeyId: parsed.auditKeyId,
    auditAlgorithm: AUDIT_ALGORITHM_V1,
    auditAlgorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
    auditKeyPurpose: AUDIT_KEY_PURPOSE_V1,
    manifestMac: parsed.manifestMac,
  }
}

function authenticateAuditSupervisorManifestV1(
  manifest: AuditSupervisorManifestV1,
  secret: Uint8Array
): void
{
  const { manifestMac, ...unsigned } = manifest
  if (
    !timingSafeBytesEqual(
      hexBytes(manifestMac),
      hexBytes(domainMacV1(secret, AUDIT_SUPERVISOR_MAC_DOMAIN_V1, unsigned))
    )
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the audit supervisor manifest MAC does not verify'
    )
}

interface AuditSupervisorProcessTailInspectionV1
{
  readonly reconciliation: AuditReconciliationV1 | null
  readonly aheadOfCheckpoint: boolean
  readonly unadvancedRecord: boolean
  readonly partialAllocation: boolean
  readonly ownership: AuditSupervisorOwnershipCheckpointV1 | null
  readonly ownershipAhead: boolean
}

async function inspectSupervisorCurrentProcessTailV1(input: {
  readonly serverRoot: string
  readonly index: AuditSupervisorIndexV1
  readonly keys: AuditKeyProviderPort
}): Promise<AuditSupervisorProcessTailInspectionV1>
{
  const current = input.index.current
  if (current.state === 'absent')
    return {
      reconciliation: null,
      aheadOfCheckpoint: false,
      unadvancedRecord: false,
      partialAllocation: false,
      ownership: null,
      ownershipAhead: false,
    }
  const root = storeRootV1(input.serverRoot, current.storeKey)
  if (!existsSync(root))
  {
    if (current.state !== 'active' || current.liveTail.state !== 'absent')
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor live-tail checkpoint names a missing process store'
      )
    return {
      reconciliation: null,
      aheadOfCheckpoint: false,
      unadvancedRecord: false,
      partialAllocation: false,
      ownership: null,
      ownershipAhead: false,
    }
  }
  const material = await requestVerificationKeyV1(
    input.keys,
    current.processAuditKeyId
  )
  if (
    current.state === 'active' &&
    current.liveTail.state === 'absent' &&
    isRecoverablePartialDurableArtifactStoreRootV1(root)
  )
    return {
      reconciliation: null,
      aheadOfCheckpoint: false,
      unadvancedRecord: false,
      partialAllocation: true,
      ownership: null,
      ownershipAhead: false,
    }
  const probe = new DurableArtifactStore(root, {
    mode: 'read-only',
    ownershipAuthority: auditOwnershipAuthorityV1(
      material.secret,
      `process-${current.storeKey}`
    ),
  })
  const entries = probe.listImmutable('')
  const ownership = ownershipCheckpointV1(probe.capability())
  const ownershipAhead =
    current.processOwnership.state === 'absent'
      ? true
      : ownershipCheckpointRelationV1(ownership, current.processOwnership) ===
        'successor'
  const entryKeys = new Set(entries.map((entry) => entry.key))
  const hasManifest = entryKeys.has(AUDIT_SERVER_MANIFEST_KEY)
  if (!hasManifest)
  {
    if (
      current.state !== 'active' ||
      current.liveTail.state !== 'absent' ||
      entries.length !== 0
    )
      refuseAuditV1(
        'audit.store-invalid',
        'an allocated process store has artifacts but no signed server manifest'
      )
    return {
      reconciliation: null,
      aheadOfCheckpoint: false,
      unadvancedRecord: false,
      partialAllocation: true,
      ownership,
      ownershipAhead,
    }
  }
  const manifest = readServerManifestV1(
    probe,
    current.storeKey,
    current.identity
  )
  if (
    manifest.auditKeyId !== current.processAuditKeyId ||
    manifest.recordCap !== current.processRecordCap ||
    manifest.byteCap !== current.processByteCap
  )
    refuseAuditV1(
      'audit.store-invalid',
      'the process store differs from its authenticated supervisor allocation'
    )
  authenticateServerManifestV1(manifest, material.secret)
  if (!entryKeys.has(AUDIT_TAIL_KEY))
  {
    const allowed = new Set([
      AUDIT_SERVER_MANIFEST_KEY,
      AUDIT_QUOTAS_KEY,
      AUDIT_REGISTRY_ATTEMPTS_KEY,
      AUDIT_SESSIONS_KEY,
      AUDIT_RECOVERY_INDEX_KEY,
    ])
    if (
      current.state !== 'active' ||
      current.liveTail.state !== 'absent' ||
      [...entryKeys].some((key) => !allowed.has(key))
    )
      refuseAuditV1(
        'audit.store-invalid',
        'a process store without a live tail has non-layout artifacts'
      )
    return {
      reconciliation: null,
      aheadOfCheckpoint: false,
      unadvancedRecord: false,
      partialAllocation: true,
      ownership,
      ownershipAhead,
    }
  }
  const reconciliation = reconcileAuditStoreV1(probe, material.secret, false, {
    storeKey: current.storeKey,
    auditKeyId: manifest.auditKeyId,
  })
  const checkpoint = current.liveTail
  let aheadOfCheckpoint = false
  if (checkpoint.state === 'absent') aheadOfCheckpoint = true
  else if (reconciliation.tail.recordCount < checkpoint.tail.recordCount)
    refuseAuditV1(
      'audit.suffix-truncated',
      'the process audit tail is behind its authenticated supervisor checkpoint'
    )
  else if (reconciliation.tail.recordCount === checkpoint.tail.recordCount)
  {
    if (
      reconciliation.tailSha256 !== checkpoint.tailSha256 ||
      !timingSafeBytesEqual(
        canonicalJsonBytesV1(reconciliation.tail),
        canonicalJsonBytesV1(checkpoint.tail)
      )
    )
      refuseAuditV1(
        'audit.interior-tamper',
        'the process audit tail differs from its equal-height supervisor checkpoint'
      )
  }
  else
  {
    if (
      checkpoint.tail.recordCount > 0 &&
      reconciliation.records.get(checkpoint.tail.recordCount - 1)?.sha256 !==
        checkpoint.tail.currentRecordSha256
    )
      refuseAuditV1(
        'audit.interior-tamper',
        'the authenticated process suffix does not extend the supervisor checkpoint record'
      )
    aheadOfCheckpoint = true
  }
  const unadvancedRecord =
    reconciliation.records.size > reconciliation.tail.recordCount
  if (current.state === 'terminal')
  {
    if (aheadOfCheckpoint || unadvancedRecord)
      refuseAuditV1(
        'audit.store-invalid',
        'a terminal process store differs from its final supervisor checkpoint'
      )
    const mounted = await mountAuthenticatedAuditStoreV1(
      input.serverRoot,
      current.storeKey,
      input.keys,
      current.identity
    )
    if (mounted.terminal.terminalSha256 !== current.terminal.terminalSha256)
      refuseAuditV1(
        'audit.store-invalid',
        'the process terminal differs from its supervisor terminal anchor'
      )
  }
  return {
    reconciliation,
    aheadOfCheckpoint,
    unadvancedRecord,
    partialAllocation: false,
    ownership,
    ownershipAhead,
  }
}

// * the supervisor is the only writer allowed to move between process stores.
// * It allocates a store identity before creation, so a crash cannot leave an
// * unindexed mutable store; an uncreated allocation is the only resumable case
export class DurableAuditStoreSupervisorV1
{
  readonly #serverRoot: string
  readonly #store: DurableArtifactStore
  readonly #secret: Uint8Array
  readonly #auditKeyId: string
  #index: AuditSupervisorIndexV1
  #indexSha256: string

  private constructor(input: {
    readonly serverRoot: string
    readonly store: DurableArtifactStore
    readonly secret: Uint8Array
    readonly auditKeyId: string
    readonly index: AuditSupervisorIndexV1
    readonly indexSha256: string
  })
  {
    this.#serverRoot = input.serverRoot
    this.#store = input.store
    this.#secret = input.secret
    this.#auditKeyId = input.auditKeyId
    this.#index = input.index
    this.#indexSha256 = input.indexSha256
  }

  static async create(
    options: AuditSupervisorOptionsV1
  ): Promise<DurableAuditStoreSupervisorV1>
  {
    if (
      existsSync(options.serverRoot) &&
      readdirSync(options.serverRoot, { withFileTypes: true }).some((entry) =>
        entry.name.startsWith(AUDIT_STORE_DIRECTORY_PREFIX)
      )
    )
      refuseAuditV1(
        'audit.store-invalid',
        'a new audit supervisor refuses existing unindexed process stores'
      )
    const material = await options.keys.activeKey()
    assertAuditKeyMaterialV1(material)
    const supervisorRoot = auditSupervisorRootV1(options.serverRoot)
    const supervisorStoreOptions = {
      maxEntries: MAX_AUDIT_SUPERVISOR_TRANSITIONS_V1,
      maxBytes: MAX_AUDIT_SUPERVISOR_BYTES_V1,
      ownershipAuthority: auditOwnershipAuthorityV1(
        material.secret,
        'supervisor'
      ),
      ...(options.faultHook ? { faultHook: options.faultHook } : {}),
    }
    const store =
      existsSync(supervisorRoot) &&
      isRecoverablePartialDurableArtifactStoreRootV1(supervisorRoot)
        ? recoverPartialDurableArtifactStoreV1(
            supervisorRoot,
            supervisorStoreOptions
          )
        : new DurableArtifactStore(supervisorRoot, {
            mode: 'create-writer',
            ...supervisorStoreOptions,
          })
    const capability = store.capability()
    const unsignedManifest = {
      schemaVersion: 1 as const,
      format: 'mcp-audit-supervisor-v1' as const,
      durableStoreId: store.storeId,
      initialOwnershipSha256: capability.ownershipSha256,
      auditKeyId: material.auditKeyId,
      auditAlgorithm: AUDIT_ALGORITHM_V1,
      auditAlgorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
      auditKeyPurpose: AUDIT_KEY_PURPOSE_V1,
    }
    store.createImmutable(
      AUDIT_SUPERVISOR_MANIFEST_KEY,
      canonicalJsonBytesV1({
        ...unsignedManifest,
        manifestMac: domainMacV1(
          material.secret,
          AUDIT_SUPERVISOR_MAC_DOMAIN_V1,
          unsignedManifest
        ),
      })
    )
    const index: AuditSupervisorIndexV1 = {
      schemaVersion: 1,
      generation: 0,
      supervisorOwnership: ownershipCheckpointV1(capability),
      current: { state: 'absent' },
      predecessors: [],
    }
    const bytes = sealAuditSupervisorTransitionV1(
      material.secret,
      material.auditKeyId,
      ZERO_SHA256,
      index
    )
    store.createImmutable(
      auditSupervisorTransitionKeyV1(0, sha256Hex(bytes)),
      bytes
    )
    store.compareAndSwapPointer(AUDIT_SUPERVISOR_INDEX_KEY, null, bytes)
    return new DurableAuditStoreSupervisorV1({
      serverRoot: options.serverRoot,
      store,
      secret: material.secret,
      auditKeyId: material.auditKeyId,
      index,
      indexSha256: sha256Hex(bytes),
    })
  }

  static async reopen(
    options: AuditSupervisorOptionsV1
  ): Promise<DurableAuditStoreSupervisorV1>
  {
    const root = auditSupervisorRootV1(options.serverRoot)
    const probe = new DurableArtifactStore(root, { mode: 'read-only' })
    const manifest = readAuditSupervisorManifestV1(probe)
    const material = await requestVerificationKeyV1(
      options.keys,
      manifest.auditKeyId
    )
    authenticateAuditSupervisorManifestV1(manifest, material.secret)
    const ownershipAuthority = auditOwnershipAuthorityV1(
      material.secret,
      'supervisor'
    )
    const authenticatedProbe = new DurableArtifactStore(root, {
      mode: 'read-only',
      ownershipAuthority,
    })
    const preflight = reconcileAuditSupervisorTransitionsV1(
      authenticatedProbe,
      material.secret,
      manifest.auditKeyId,
      false,
      false
    )
    assertSupervisorProcessStoreInventoryV1(options.serverRoot, preflight.index)
    const processTail = await inspectSupervisorCurrentProcessTailV1({
      serverRoot: options.serverRoot,
      index: preflight.index,
      keys: options.keys,
    })
    const currentOwnershipSha256 =
      authenticatedProbe.capability().ownershipSha256
    const observedSupervisorOwnership = ownershipCheckpointV1(
      authenticatedProbe.capability()
    )
    ownershipCheckpointRelationV1(
      observedSupervisorOwnership,
      preflight.index.supervisorOwnership
    )
    const allocated = preflight.index.current
    if (allocated.state !== 'absent')
    {
      const recoveryClaims =
        observedSupervisorOwnership.generation -
        allocated.supervisorOwnershipGenerationAtAllocation
      if (
        recoveryClaims < 0 ||
        recoveryClaims >= allocated.supervisorRecoveryClaimCap
      )
        refuseAuditV1(
          'audit.capacity-exhausted',
          'the active supervisor allocation exhausted its authenticated recovery-claim cap'
        )
      const retainedRecords =
        processTail.reconciliation?.tail.recordCount ??
        (allocated.liveTail.state === 'present'
          ? allocated.liveTail.tail.recordCount
          : 0)
      const remainingRecords =
        allocated.state === 'active'
          ? allocated.processRecordCap - retainedRecords
          : 0
      const requiredTransitions = remainingRecords + 4
      const retainedTransitions = authenticatedProbe.listImmutable('').length
      const availableBytes =
        authenticatedProbe.capability().quota.availableBytes
      if (
        retainedTransitions + requiredTransitions >
          MAX_AUDIT_SUPERVISOR_TRANSITIONS_V1 ||
        availableBytes <
          requiredTransitions * MAX_AUDIT_SUPERVISOR_TRANSITION_BYTES_V1
      )
        refuseAuditV1(
          'audit.capacity-exhausted',
          'the supervisor cannot claim ownership while preserving completion capacity'
        )
    }
    const store = new DurableArtifactStore(root, {
      mode: 'recovery',
      expectedStoreId: manifest.durableStoreId,
      expectedOwnershipSha256: currentOwnershipSha256,
      ownershipAuthority,
      ...(options.faultHook ? { faultHook: options.faultHook } : {}),
    })
    const reconciled = reconcileAuditSupervisorTransitionsV1(
      store,
      material.secret,
      manifest.auditKeyId,
      true
    )
    assertSupervisorProcessStoreInventoryV1(
      options.serverRoot,
      reconciled.index
    )
    const supervisor = new DurableAuditStoreSupervisorV1({
      serverRoot: options.serverRoot,
      store,
      secret: material.secret,
      auditKeyId: manifest.auditKeyId,
      index: reconciled.index,
      indexSha256: reconciled.sha256,
    })
    supervisor.#checkpointSupervisorOwnershipV1(
      ownershipCheckpointV1(store.capability()),
      observedSupervisorOwnership
    )
    if (
      (processTail.aheadOfCheckpoint || processTail.ownershipAhead) &&
      processTail.reconciliation !== null &&
      processTail.ownership !== null
    )
      supervisor.#checkpointCurrentTailV1(
        processTail.reconciliation.tail,
        processTail.reconciliation.tailSha256,
        processTail.ownership,
        processTail.reconciliation.tail.storeKey,
        true
      )
    return supervisor
  }

  static async inspect(
    options: AuditSupervisorOptionsV1
  ): Promise<AuditSupervisorIndexV1>
  {
    const probe = new DurableArtifactStore(
      auditSupervisorRootV1(options.serverRoot),
      { mode: 'read-only' }
    )
    const manifest = readAuditSupervisorManifestV1(probe)
    const material = await requestVerificationKeyV1(
      options.keys,
      manifest.auditKeyId
    )
    authenticateAuditSupervisorManifestV1(manifest, material.secret)
    const store = new DurableArtifactStore(
      auditSupervisorRootV1(options.serverRoot),
      {
        mode: 'read-only',
        ownershipAuthority: auditOwnershipAuthorityV1(
          material.secret,
          'supervisor'
        ),
      }
    )
    const observedSupervisorOwnership = ownershipCheckpointV1(
      store.capability()
    )
    const reconciled = reconcileAuditSupervisorTransitionsV1(
      store,
      material.secret,
      manifest.auditKeyId,
      false
    )
    if (
      ownershipCheckpointRelationV1(
        observedSupervisorOwnership,
        reconciled.index.supervisorOwnership
      ) !== 'equal'
    )
      refuseAuditV1(
        'audit.store-invalid',
        'ordinary inspection refuses an unreconciled supervisor owner successor'
      )
    assertSupervisorProcessStoreInventoryV1(
      options.serverRoot,
      reconciled.index
    )
    const processTail = await inspectSupervisorCurrentProcessTailV1({
      serverRoot: options.serverRoot,
      index: reconciled.index,
      keys: options.keys,
    })
    if (
      processTail.aheadOfCheckpoint ||
      processTail.unadvancedRecord ||
      processTail.partialAllocation ||
      processTail.ownershipAhead
    )
      refuseAuditV1(
        'audit.store-invalid',
        'ordinary inspection refuses an unreconciled process audit tail'
      )
    return reconciled.index
  }

  index(): AuditSupervisorIndexV1
  {
    return this.#index
  }

  async createInitialStoreV1(
    options: Omit<
      AuditJournalOptionsV1,
      'serverRoot' | 'identity' | 'keyMaterial' | 'tailCheckpoint'
    > & {
      readonly identity: AuditStoreIdentitySeedV1
    }
  ): Promise<DurableToolAuditJournalV1>
  {
    if (this.#index.current.state !== 'absent')
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor already owns a current audit store'
      )
    const identity: AuditServerStoreIdentityV1 = {
      ...options.identity,
      predecessor: { state: 'absent' },
    }
    const material = await options.keys.activeKey()
    assertAuditKeyMaterialV1(material)
    const recordCap = options.recordCap ?? DEFAULT_AUDIT_RECORD_CAP
    const byteCap = options.byteCap ?? DEFAULT_AUDIT_BYTE_CAP
    assertAuditCapsV1(recordCap, byteCap)
    this.#allocate(
      options.storeKey,
      identity,
      this.#index.predecessors,
      material.auditKeyId,
      recordCap,
      byteCap
    )
    return DurableToolAuditJournalV1.create({
      ...options,
      serverRoot: this.#serverRoot,
      identity,
      keyMaterial: material,
      tailCheckpoint: this.#tailCheckpointPortV1(options.storeKey),
    })
  }

  async resumeUncreatedStoreV1(
    options: Omit<
      AuditJournalOptionsV1,
      'serverRoot' | 'identity' | 'storeKey' | 'keyMaterial' | 'tailCheckpoint'
    >
  ): Promise<DurableToolAuditJournalV1>
  {
    const current = this.#index.current
    if (current.state !== 'active')
      refuseAuditV1(
        'audit.store-invalid',
        'no active allocation can be resumed'
      )
    if (existsSync(storeRootV1(this.#serverRoot, current.storeKey)))
      refuseAuditV1(
        'audit.store-invalid',
        'an existing process store requires exclusive recovery, not resumption'
      )
    const material = await requestVerificationKeyV1(
      options.keys,
      current.processAuditKeyId
    )
    return DurableToolAuditJournalV1.create({
      ...options,
      serverRoot: this.#serverRoot,
      storeKey: current.storeKey,
      identity: current.identity,
      recordCap: current.processRecordCap,
      byteCap: current.processByteCap,
      keyMaterial: material,
      tailCheckpoint: this.#tailCheckpointPortV1(current.storeKey),
    })
  }

  async recoverCurrentStoreV1(options: {
    readonly keys: AuditKeyProviderPort
    readonly classify: (
      begin: AuditUnmatchedBeginV1
    ) => AuditRecoveryClassificationV1 | Promise<AuditRecoveryClassificationV1>
    readonly terminal: AuditRecoveryTerminalInputV1
    readonly clock?: EditClockPort
    readonly monotonicClock?: AuditMonotonicClockPortV1
    readonly faultHook?: DurableArtifactFaultHook
    readonly beforeTerminalPersistence?: (
      terminal: AuditTerminalEvidenceV1,
      journal: DurableToolAuditJournalV1
    ) => void
    readonly beforeTerminalAnchor?: (
      terminal: AuditTerminalEvidenceV1,
      plan: AuditTerminalSideEffectPlanV1 | null
    ) => void
  }): Promise<AuditTerminalEvidenceV1>
  {
    const current = this.#index.current
    if (current.state === 'terminal')
    {
      if (options.beforeTerminalAnchor)
      {
        const mounted = await mountAuthenticatedAuditStoreV1(
          this.#serverRoot,
          current.storeKey,
          options.keys,
          current.identity
        )
        options.beforeTerminalAnchor(
          mounted.terminal,
          mounted.terminalSideEffect
        )
      }
      return current.terminal
    }
    if (current.state !== 'active')
      refuseAuditV1(
        'audit.store-invalid',
        'no active predecessor can be recovered'
      )
    if (!existsSync(storeRootV1(this.#serverRoot, current.storeKey)))
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor allocation has no process store to recover'
      )
    const processRoot = storeRootV1(this.#serverRoot, current.storeKey)
    const partialPrivate =
      isRecoverablePartialDurableArtifactStoreRootV1(processRoot)
    const probe = partialPrivate
      ? null
      : new DurableArtifactStore(processRoot, { mode: 'read-only' })
    let terminal: AuditTerminalEvidenceV1
    let terminalSideEffect: AuditTerminalSideEffectPlanV1 | null
    if (probe !== null && hasAuditArtifactV1(probe, AUDIT_TERMINAL_KEY))
    {
      const mounted = await mountAuthenticatedAuditStoreV1(
        this.#serverRoot,
        current.storeKey,
        options.keys,
        current.identity
      )
      terminal = mounted.terminal
      terminalSideEffect = mounted.terminalSideEffect
    }
    else
    {
      const currentInspection = await inspectSupervisorCurrentProcessTailV1({
        serverRoot: this.#serverRoot,
        index: this.#index,
        keys: options.keys,
      })
      const material = await requestVerificationKeyV1(
        options.keys,
        current.processAuditKeyId
      )
      const journal = currentInspection.partialAllocation
        ? await DurableToolAuditJournalV1.recoverAllocatedStoreV1({
            serverRoot: this.#serverRoot,
            storeKey: current.storeKey,
            identity: current.identity,
            keys: options.keys,
            keyMaterial: material,
            recordCap: current.processRecordCap,
            byteCap: current.processByteCap,
            tailCheckpoint: this.#tailCheckpointPortV1(current.storeKey),
            ...(options.clock ? { clock: options.clock } : {}),
            ...(options.monotonicClock
              ? { monotonicClock: options.monotonicClock }
              : {}),
            ...(options.faultHook ? { faultHook: options.faultHook } : {}),
          })
        : await DurableToolAuditJournalV1.reopen({
            serverRoot: this.#serverRoot,
            storeKey: current.storeKey,
            identity: current.identity,
            keys: options.keys,
            tailCheckpoint: this.#tailCheckpointPortV1(current.storeKey),
            ...(options.clock ? { clock: options.clock } : {}),
            ...(options.monotonicClock
              ? { monotonicClock: options.monotonicClock }
              : {}),
            ...(options.faultHook ? { faultHook: options.faultHook } : {}),
          })
      for (const begin of journal.unmatchedBegins())
      {
        const classification =
          begin.boundary.boundaryKind === 'server-close'
            ? {
                disposition: 'completed' as const,
                resultSha256: boundaryReceiptFreeOutcomeSha256V1(
                  options.terminal.outcome
                ),
              }
            : await options.classify(begin)
        journal.completeRecoveredCallV1({
          ...classification,
          callId: begin.callId,
        })
      }
      terminal = journal.terminalizeV1({
        ...options.terminal,
        ...(options.beforeTerminalPersistence
          ? { beforeTerminalPersistence: options.beforeTerminalPersistence }
          : {}),
      })
      terminalSideEffect = journal.terminalSideEffectPlanV1(terminal)
    }
    const recoveredCurrent = this.#index.current
    if (
      recoveredCurrent.state !== 'active' ||
      recoveredCurrent.liveTail.state !== 'present' ||
      recoveredCurrent.processOwnership.state !== 'present'
    )
      refuseAuditV1(
        'audit.store-invalid',
        'a recovered terminal has no authenticated live-tail checkpoint'
      )
    options.beforeTerminalAnchor?.(terminal, terminalSideEffect)
    this.#replace({
      ...this.#index,
      generation: this.#index.generation + 1,
      current: {
        ...recoveredCurrent,
        state: 'terminal',
        liveTail: recoveredCurrent.liveTail,
        processOwnership: recoveredCurrent.processOwnership,
        terminal,
      },
    })
    return terminal
  }

  async createSuccessorStoreV1(
    options: Omit<
      AuditJournalOptionsV1,
      'serverRoot' | 'identity' | 'keyMaterial' | 'tailCheckpoint'
    > & {
      readonly identity: AuditStoreIdentitySeedV1
    }
  ): Promise<DurableToolAuditJournalV1>
  {
    const current = this.#index.current
    if (current.state !== 'terminal')
      refuseAuditV1(
        'audit.store-invalid',
        'a successor requires an exclusively terminalized predecessor'
      )
    if (options.storeKey === current.storeKey)
      refuseAuditV1(
        'audit.store-invalid',
        'a successor must use a new durable process store'
      )
    const mounted = await mountAuthenticatedAuditStoreV1(
      this.#serverRoot,
      current.storeKey,
      options.keys,
      current.identity
    )
    if (mounted.terminal.finalTailSha256 !== current.terminal.finalTailSha256)
      refuseAuditV1(
        'audit.store-invalid',
        'the supervisor predecessor anchor differs from its authenticated tail'
      )
    const identity: AuditServerStoreIdentityV1 = {
      ...options.identity,
      predecessor: {
        state: 'present',
        storeKey: current.storeKey,
        finalTailSha256: current.terminal.finalTailSha256,
      },
    }
    const predecessors = [
      ...this.#index.predecessors,
      {
        storeKey: current.storeKey,
        identity: current.identity,
        terminal: current.terminal,
        successorStoreKey: options.storeKey,
      },
    ]
    const material = await options.keys.activeKey()
    assertAuditKeyMaterialV1(material)
    const recordCap = options.recordCap ?? DEFAULT_AUDIT_RECORD_CAP
    const byteCap = options.byteCap ?? DEFAULT_AUDIT_BYTE_CAP
    assertAuditCapsV1(recordCap, byteCap)
    this.#allocate(
      options.storeKey,
      identity,
      predecessors,
      material.auditKeyId,
      recordCap,
      byteCap
    )
    return DurableToolAuditJournalV1.create({
      ...options,
      serverRoot: this.#serverRoot,
      identity,
      keyMaterial: material,
      tailCheckpoint: this.#tailCheckpointPortV1(options.storeKey),
    })
  }

  // normal shutdown has already authenticated & durably installed this
  // terminal in the current writer; the supervisor records the exact anchor so
  // the next process can mount it read-only before allocating a successor
  recordCurrentTerminalV1(terminal: AuditTerminalEvidenceV1): void
  {
    const current = this.#index.current
    if (current.state === 'terminal')
    {
      if (current.terminal.terminalSha256 !== terminal.terminalSha256)
        refuseAuditV1(
          'audit.store-invalid',
          'the current audit store already has another terminal anchor'
        )
      return
    }
    if (
      current.state !== 'active' ||
      terminal.storeKey !== current.storeKey ||
      terminal.serverInstanceId !== current.identity.serverInstanceId ||
      terminal.runId !== current.identity.runId
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the terminal evidence does not identify the current audit store'
      )
    if (
      current.liveTail.state !== 'present' ||
      current.processOwnership.state !== 'present'
    )
      refuseAuditV1(
        'audit.store-invalid',
        'a terminal audit store has no authenticated live-tail checkpoint'
      )
    this.#replace({
      ...this.#index,
      generation: this.#index.generation + 1,
      current: {
        state: 'terminal',
        storeKey: current.storeKey,
        identity: current.identity,
        liveTail: current.liveTail,
        processAuditKeyId: current.processAuditKeyId,
        processRecordCap: current.processRecordCap,
        processByteCap: current.processByteCap,
        supervisorRecoveryClaimCap: current.supervisorRecoveryClaimCap,
        supervisorOwnershipGenerationAtAllocation:
          current.supervisorOwnershipGenerationAtAllocation,
        processOwnership: current.processOwnership,
        terminal,
      },
    })
  }

  async mountPredecessorV1(
    storeKey: string,
    keys: AuditKeyProviderPort
  ): Promise<AuthenticatedAuditStoreMountV1>
  {
    const predecessor = this.#index.predecessors.find(
      (entry) => entry.storeKey === storeKey
    )
    if (!predecessor)
      refuseAuditV1(
        'audit.store-invalid',
        'the requested store is not a supervisor-owned predecessor'
      )
    return mountAuthenticatedAuditStoreV1(
      this.#serverRoot,
      storeKey,
      keys,
      predecessor.identity
    )
  }

  async lookupPredecessorIdempotencyV1(input: {
    readonly keys: AuditKeyProviderPort
    readonly namespaceSha256: string
    readonly requestIdSha256: string
    readonly fullInputSha256: string
    readonly boundary: Extract<
      ServerAuditBoundaryV1,
      { readonly boundaryKind: 'tool' }
    >
  }): Promise<AuthenticatedAuditIdempotencyLookupV1>
  {
    let matched: AuthenticatedAuditIdempotencyLookupV1 | null = null
    for (const predecessor of this.#index.predecessors)
    {
      const candidate = await lookupAuthenticatedAuditIdempotencyStoreV1({
        serverRoot: this.#serverRoot,
        storeKey: predecessor.storeKey,
        keys: input.keys,
        identity: predecessor.identity,
        namespaceSha256: input.namespaceSha256,
        requestIdSha256: input.requestIdSha256,
        fullInputSha256: input.fullInputSha256,
        boundary: input.boundary,
      })
      if (candidate.state === 'absent') continue
      if (matched !== null)
        refuseAuditV1(
          'audit.store-invalid',
          'multiple authenticated predecessors retain one idempotency namespace'
        )
      matched = candidate
    }
    return matched ?? { state: 'absent' }
  }

  #allocate(
    storeKey: string,
    identity: AuditServerStoreIdentityV1,
    predecessors: readonly AuditSupervisorPredecessorV1[],
    processAuditKeyId: string,
    recordCap: number,
    byteCap: number
  ): void
  {
    assertServerStoreIdentityV1(identity)
    storeRootV1(this.#serverRoot, storeKey)
    const supervisorRecoveryClaimCap = auditReserveRecordsV1(recordCap)
    const supervisorOwnershipGenerationAtAllocation =
      this.#index.supervisorOwnership.generation
    const next: AuditSupervisorIndexV1 = {
      schemaVersion: 1,
      generation: this.#index.generation + 1,
      supervisorOwnership: this.#index.supervisorOwnership,
      current: {
        state: 'active',
        storeKey,
        identity,
        liveTail: { state: 'absent' },
        processAuditKeyId,
        processRecordCap: recordCap,
        processByteCap: byteCap,
        supervisorRecoveryClaimCap,
        supervisorOwnershipGenerationAtAllocation,
        processOwnership: { state: 'absent' },
      },
      predecessors: Object.freeze([...predecessors]),
    }
    const entries = this.#store.listImmutable('')
    const requiredTransitions = recordCap + supervisorRecoveryClaimCap * 2 + 5
    const maximumSha256 = 'f'.repeat(64)
    const maximumOwnership = {
      state: 'present' as const,
      ownershipSha256: maximumSha256,
      generation: Number.MAX_SAFE_INTEGER,
      previousOwnershipSha256: maximumSha256,
    }
    const maximumTail: AuditTailBodyV1 = {
      schemaVersion: 1,
      format: 'mcp-server-audit-tail-v1',
      purpose: AUDIT_KEY_PURPOSE_V1,
      storeKey,
      auditKeyId: processAuditKeyId,
      algorithm: AUDIT_ALGORITHM_V1,
      algorithmVersion: AUDIT_ALGORITHM_VERSION_V1,
      expectedNextSequence: recordCap,
      currentRecordSha256: maximumSha256,
      currentRecordKey: `audit/${String(recordCap).padStart(
        6,
        '0'
      )}-call-complete-${'f'.repeat(16)}.json`,
      recordCount: recordCap,
      recordBytes: byteCap,
      previousTailSha256: maximumSha256,
    }
    const maximumLiveTail: Extract<
      AuditSupervisorLiveTailV1,
      { readonly state: 'present' }
    > = {
      state: 'present',
      storeKey,
      auditKeyId: processAuditKeyId,
      tail: maximumTail,
      tailSha256: maximumSha256,
    }
    const maximumTerminal: AuditTerminalEvidenceV1 = {
      schemaVersion: 1,
      storeKey,
      serverInstanceId: identity.serverInstanceId,
      runId: identity.runId,
      auditKeyId: processAuditKeyId,
      finalTailSha256: maximumSha256,
      finalRecordSha256: maximumSha256,
      recordCount: recordCap,
      recordBytes: byteCap,
      closeReceipt: {
        callId: `mcp-call-${'f'.repeat(32)}`,
        beginSequence: recordCap,
        beginRecordSha256: maximumSha256,
        completeSequence: recordCap,
        completeRecordSha256: maximumSha256,
      },
      terminalSha256: maximumSha256,
    }
    const maximumIndex = (
      current: AuditSupervisorCurrentV1,
      projectedPredecessors = predecessors
    ): AuditSupervisorIndexV1 => ({
      schemaVersion: 1,
      generation: Number.MAX_SAFE_INTEGER,
      supervisorOwnership: {
        ownershipSha256: maximumSha256,
        generation: Number.MAX_SAFE_INTEGER,
        previousOwnershipSha256: maximumSha256,
      },
      current,
      predecessors: Object.freeze([...projectedPredecessors]),
    })
    const maximumActive: AuditSupervisorCurrentV1 = {
      state: 'active',
      storeKey,
      identity,
      liveTail: maximumLiveTail,
      processAuditKeyId,
      processRecordCap: recordCap,
      processByteCap: byteCap,
      supervisorRecoveryClaimCap,
      supervisorOwnershipGenerationAtAllocation,
      processOwnership: maximumOwnership,
    }
    const maximumTerminalCurrent: AuditSupervisorCurrentV1 = {
      state: 'terminal',
      storeKey,
      identity,
      liveTail: maximumLiveTail,
      processAuditKeyId,
      processRecordCap: recordCap,
      processByteCap: byteCap,
      supervisorRecoveryClaimCap,
      supervisorOwnershipGenerationAtAllocation,
      processOwnership: maximumOwnership,
      terminal: maximumTerminal,
    }
    const maximumSuccessorStoreKey = 's'.repeat(64)
    const maximumRollover = maximumIndex(
      {
        state: 'active',
        storeKey: maximumSuccessorStoreKey,
        identity: {
          serverInstanceId: 'S'.repeat(128),
          runId: 'R'.repeat(128),
          realmSha256: maximumSha256,
          profileSha256: maximumSha256,
          boundaryPolicySha256: maximumSha256,
          predecessor: {
            state: 'present',
            storeKey,
            finalTailSha256: maximumSha256,
          },
        },
        liveTail: { state: 'absent' },
        processAuditKeyId: 'K'.repeat(128),
        processRecordCap: HARD_AUDIT_RECORD_CAP,
        processByteCap: HARD_AUDIT_BYTE_CAP,
        supervisorRecoveryClaimCap: auditReserveRecordsV1(
          HARD_AUDIT_RECORD_CAP
        ),
        supervisorOwnershipGenerationAtAllocation: Number.MAX_SAFE_INTEGER,
        processOwnership: { state: 'absent' },
      },
      [
        ...predecessors,
        {
          storeKey,
          identity,
          terminal: maximumTerminal,
          successorStoreKey: maximumSuccessorStoreKey,
        },
      ]
    )
    for (const candidate of [
      next,
      maximumIndex(maximumActive),
      maximumIndex(maximumTerminalCurrent),
      maximumRollover,
    ])
    {
      const sampleBytes = sealAuditSupervisorTransitionV1(
        this.#secret,
        this.#auditKeyId,
        this.#indexSha256,
        candidate
      )
      if (sampleBytes.byteLength > MAX_AUDIT_SUPERVISOR_TRANSITION_BYTES_V1)
        refuseAuditV1(
          'audit.capacity-exhausted',
          'the complete supervisor lifecycle cannot fit its bounded transition size'
        )
    }
    if (
      entries.length + requiredTransitions >
        MAX_AUDIT_SUPERVISOR_TRANSITIONS_V1 ||
      this.#store.capability().quota.availableBytes <
        requiredTransitions * MAX_AUDIT_SUPERVISOR_TRANSITION_BYTES_V1
    )
      refuseAuditV1(
        'audit.capacity-exhausted',
        'the supervisor cannot reserve checkpoints for the complete process audit cap'
      )
    this.#replace(next)
  }

  #tailCheckpointPortV1(storeKey: string): AuditTailCheckpointPortV1
  {
    return Object.freeze({
      checkpoint: (
        tail: AuditTailBodyV1,
        tailSha256: string,
        ownership: AuditSupervisorOwnershipCheckpointV1
      ): void =>
        this.#checkpointCurrentTailV1(tail, tailSha256, ownership, storeKey),
    })
  }

  #checkpointCurrentTailV1(
    tail: AuditTailBodyV1,
    tailSha256: string,
    ownership: AuditSupervisorOwnershipCheckpointV1,
    expectedStoreKey = tail.storeKey,
    allowAuthenticatedSuffix = false
  ): void
  {
    const current = this.#index.current
    if (
      current.state !== 'active' ||
      current.storeKey !== expectedStoreKey ||
      tail.storeKey !== current.storeKey ||
      tail.auditKeyId !== current.processAuditKeyId ||
      !LOWERCASE_SHA256_PATTERN.test(tailSha256)
    )
      refuseAuditV1(
        'audit.store-invalid',
        'a process tail checkpoint does not identify the active supervisor store'
      )
    assertAuditSupervisorOwnershipCheckpointV1(ownership)
    const ownershipRelation =
      current.processOwnership.state === 'absent'
        ? 'successor'
        : ownershipCheckpointRelationV1(ownership, current.processOwnership)
    const prior = current.liveTail
    if (prior.state === 'present')
    {
      if (prior.tailSha256 === tailSha256)
      {
        if (
          !timingSafeBytesEqual(
            canonicalJsonBytesV1(prior.tail),
            canonicalJsonBytesV1(tail)
          )
        )
          refuseAuditV1(
            'audit.interior-tamper',
            'one process tail hash names different supervisor projections'
          )
        if (ownershipRelation === 'equal') return
      }
      else
      {
        const exactSuccessor =
          tail.recordCount === prior.tail.recordCount + 1 &&
          tail.expectedNextSequence === prior.tail.expectedNextSequence + 1 &&
          tail.previousTailSha256 === prior.tailSha256
        if (
          !exactSuccessor &&
          (!allowAuthenticatedSuffix ||
            tail.recordCount <= prior.tail.recordCount ||
            tail.expectedNextSequence <= prior.tail.expectedNextSequence)
        )
          refuseAuditV1(
            'audit.store-invalid',
            'the process tail checkpoint does not advance exactly one authenticated record'
          )
      }
    }
    else if (
      tail.recordCount !== 0 ||
      tail.expectedNextSequence !== 0 ||
      tail.previousTailSha256 !== ZERO_SHA256
    )
      refuseAuditV1(
        'audit.store-invalid',
        'the first process tail checkpoint is not the authenticated genesis'
      )
    this.#replace({
      ...this.#index,
      generation: this.#index.generation + 1,
      current: {
        ...current,
        liveTail: {
          state: 'present',
          storeKey: current.storeKey,
          auditKeyId: tail.auditKeyId,
          tail: Object.freeze({ ...tail }),
          tailSha256,
        },
        processOwnership: {
          state: 'present',
          ...ownership,
        },
      },
    })
  }

  #checkpointSupervisorOwnershipV1(
    current: AuditSupervisorOwnershipCheckpointV1,
    observedBeforeClaim: AuditSupervisorOwnershipCheckpointV1
  ): void
  {
    assertAuditSupervisorOwnershipCheckpointV1(current)
    assertAuditSupervisorOwnershipCheckpointV1(observedBeforeClaim)
    ownershipCheckpointRelationV1(
      observedBeforeClaim,
      this.#index.supervisorOwnership
    )
    if (
      ownershipCheckpointRelationV1(current, observedBeforeClaim) !==
      'successor'
    )
      refuseAuditV1(
        'audit.store-invalid',
        'exclusive supervisor ownership did not advance exactly once'
      )
    this.#replace({
      ...this.#index,
      generation: this.#index.generation + 1,
      supervisorOwnership: current,
    })
  }

  #replace(next: AuditSupervisorIndexV1): void
  {
    const bytes = sealAuditSupervisorTransitionV1(
      this.#secret,
      this.#auditKeyId,
      this.#indexSha256,
      next
    )
    if (bytes.byteLength > MAX_AUDIT_SUPERVISOR_TRANSITION_BYTES_V1)
      refuseAuditV1(
        'audit.capacity-exhausted',
        'an audit supervisor transition exceeds its reserved maximum'
      )
    this.#store.createImmutable(
      auditSupervisorTransitionKeyV1(next.generation, sha256Hex(bytes)),
      bytes
    )
    this.#store.compareAndSwapPointer(
      AUDIT_SUPERVISOR_INDEX_KEY,
      this.#indexSha256,
      bytes
    )
    this.#index = Object.freeze(next)
    this.#indexSha256 = sha256Hex(bytes)
  }
}
