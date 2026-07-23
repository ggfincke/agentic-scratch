// packages/mcp/src/edit/edit-tools.ts
// register the 13 frozen edit tools, their profile, caps, & runtime validation

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  DEFAULT_PHASE_8_RESOURCE_POLICY,
  EDIT_TOOL_DESCRIPTORS,
  EDIT_TOOL_NAMES,
  PROJECT_TOOL_NAMES,
  parseEditToolInputV1,
  toolInputSchemaModel,
  toolOutputSchemaModel,
  toolReceiptFreeResultSchemaModel,
  validateSchemaValue,
  semanticHashV1,
  semanticAuthorityManifestV1,
  type AuditExpectedHeadV1,
  type AuditHeadObservationV1,
  type AuditIdempotencyBindingV1,
  type AuditSemanticEventCorrelationV1,
  type AuditSessionBindingV1,
  type EditToolReceiptFreeResultV1,
  type EditToolRequestForV1,
  type EditToolName,
  type HostInvocationContextV1,
  type HeadProjectionV1,
  type ReviewToolDescriptor,
  type SchemaModel,
  type SchemaNode,
  type SemanticEditParseIssue,
  type TransportRequestHashProjectionV1,
} from '@scratch-agent/edit'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { McpBoundaryError } from '../transport/errors.js'
import { validateClosedJsonSchemaValueV1 } from '../transport/json-schema-check.js'
import { internalProjectOutputSchema } from '../project/project-output-schema.js'
import { scratchMcpProfileToolsV1 } from '../transport/schema-profile.js'
import {
  editReceiptFreeOutcomeSha256V1,
  editTransportRequestSha256V1,
  type AuthenticatedAuditIdempotencyLookupV1,
} from '../transport/tool-audit.js'

// discovery caps measured at startup; a breach refuses to serve the profile
export const MAX_MCP_TOOLS_LIST_BYTES = 384 * 1024
export const MAX_MCP_AGGREGATE_DESCRIPTION_BYTES = 32 * 1024

export const SCRATCH_MCP_PROFILE_NAMES = ['repair', 'project-edit'] as const

export type ScratchMcpProfileName = (typeof SCRATCH_MCP_PROFILE_NAMES)[number]

export function isScratchMcpProfileName(
  value: unknown
): value is ScratchMcpProfileName
{
  return (
    typeof value === 'string' &&
    SCRATCH_MCP_PROFILE_NAMES.includes(value as ScratchMcpProfileName)
  )
}

const PROFILE_TOOLS = Object.freeze(scratchMcpProfileToolsV1())

const EDIT_TOOL_NAME_SET: ReadonlySet<string> = new Set(EDIT_TOOL_NAMES)

export function productionEditProfileAuthoritySha256V1(
  statefulProjectorVersion: string
): string
{
  const semanticAuthority = semanticAuthorityManifestV1()
  return semanticHashV1('transport-request', {
    schemaVersion: 1,
    kind: 'production-edit-profile-authority-v1',
    statefulProjectorVersion,
    toolOrder: [...PROJECT_TOOL_NAMES, ...EDIT_TOOL_NAMES],
    advertisedSchemasSha256: sha256Hex(
      Buffer.from(
        JSON.stringify(
          PROFILE_TOOLS.map((tool) => ({
            name: tool.name,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
          }))
        ),
        'utf8'
      )
    ),
    semanticDeclarationSha256: semanticAuthority.productionDeclarationSha256,
    semanticSchemaSha256: semanticAuthority.semanticSchemaSha256,
    editContracts: EDIT_TOOL_NAMES.map((name) => ({
      name,
      inputDefinition: toolInputSchemaModel(name).root,
      receiptFreeOutputDefinition: toolReceiptFreeResultSchemaModel(name).root,
      auditedOutputDefinition: toolOutputSchemaModel(name).root,
    })),
  })
}

export function isEditToolName(value: unknown): value is EditToolName
{
  return typeof value === 'string' && EDIT_TOOL_NAME_SET.has(value)
}

// the 13 edit tools alone, in the frozen lifecycle order
export const EDIT_TOOLS: readonly Tool[] = Object.freeze(
  PROFILE_TOOLS.filter((tool) => EDIT_TOOL_NAME_SET.has(tool.name))
)

// the project-edit profile is exactly the A0-frozen profileToolOrder; repair is absent
export const PROJECT_EDIT_PROFILE_TOOLS: readonly Tool[] = PROFILE_TOOLS

export function editToolDescriptor(name: EditToolName): ReviewToolDescriptor
{
  const descriptor = EDIT_TOOL_DESCRIPTORS.find((entry) => entry.name === name)
  if (!descriptor)
  {
    throw new McpBoundaryError(
      'mcp.edit-descriptor-missing',
      'edit tool descriptor is missing from the frozen contract'
    )
  }
  return descriptor
}

export interface ToolProfileMeasurementV1
{
  readonly toolCount: number
  readonly editToolCount: number
  readonly projectToolCount: number
  readonly serializedBytes: number
  readonly aggregateDescriptionBytes: number
  readonly maximumSerializedBytes: number
  readonly maximumAggregateDescriptionBytes: number
}

// measure the real complete tools/list response, not a descriptor approximation
export function measureToolProfileV1(
  tools: readonly Tool[]
): ToolProfileMeasurementV1
{
  return Object.freeze({
    toolCount: tools.length,
    editToolCount: tools.filter((tool) => EDIT_TOOL_NAME_SET.has(tool.name))
      .length,
    projectToolCount: tools.filter((tool) =>
      (PROJECT_TOOL_NAMES as readonly string[]).includes(tool.name)
    ).length,
    serializedBytes: Buffer.byteLength(JSON.stringify({ tools }), 'utf-8'),
    aggregateDescriptionBytes: tools.reduce(
      (total, tool) =>
        total + Buffer.byteLength(tool.description ?? '', 'utf-8'),
      0
    ),
    maximumSerializedBytes: MAX_MCP_TOOLS_LIST_BYTES,
    maximumAggregateDescriptionBytes: MAX_MCP_AGGREGATE_DESCRIPTION_BYTES,
  })
}

// refuse to start rather than advertise a profile that breaches a discovery cap
export function assertToolProfileWithinCapsV1(
  tools: readonly Tool[]
): ToolProfileMeasurementV1
{
  const measurement = measureToolProfileV1(tools)
  if (measurement.serializedBytes > MAX_MCP_TOOLS_LIST_BYTES)
  {
    throw new McpBoundaryError(
      'mcp.discovery-limit',
      `tools/list is ${measurement.serializedBytes} bytes and exceeds its ${MAX_MCP_TOOLS_LIST_BYTES} byte limit`
    )
  }
  if (
    measurement.aggregateDescriptionBytes > MAX_MCP_AGGREGATE_DESCRIPTION_BYTES
  )
  {
    throw new McpBoundaryError(
      'mcp.description-limit',
      `aggregate tool descriptions are ${measurement.aggregateDescriptionBytes} bytes and exceed their ${MAX_MCP_AGGREGATE_DESCRIPTION_BYTES} byte limit`
    )
  }
  return measurement
}

// request-boundary refusals are contract codes reachable on every edit tool
export type RequestBoundaryRefusalCodeV1 =
  | 'edit.invalid_payload'
  | 'edit.members_exceeded'
  | 'edit.nesting_exceeded'
  | 'edit.request_too_large'
  | 'edit.string_too_large'
  | 'edit.unknown_field'

type RequestBoundaryRefusal = RequestBoundaryRefusalCodeV1

// * the exact context each boundary code declares. A limit-family code carries
// * a truthful measured limit/observed pair, so the boundary measures the
// * request against the frozen resource policy rather than inventing numbers
const LIMIT_CONTEXT_REFUSALS: ReadonlySet<RequestBoundaryRefusal> = new Set([
  'edit.members_exceeded',
  'edit.nesting_exceeded',
  'edit.request_too_large',
  'edit.string_too_large',
])

export interface EditToolRefusalContextV1
{
  readonly limit?: number
  readonly observed?: number
}

// the measured resource caps already ran ahead of the parser, so a surviving
// schema failure is a payload-shape refusal: an unknown key names itself &
// every other shape failure is an invalid payload
function structuralRefusalCode(
  issues: readonly SemanticEditParseIssue[]
): RequestBoundaryRefusal
{
  const unknownKey = issues.some(
    (entry) =>
      entry.phase === 'structural' && entry.issue.code === 'unknown_key'
  )
  return unknownKey ? 'edit.unknown_field' : 'edit.invalid_payload'
}

// a union-rooted tool only reports 'any_of', so the admissible top-level field
// set is derived from the model itself to keep unknown-key refusal uniform
function collectTopLevelFields(
  model: SchemaModel,
  node: SchemaNode,
  into: Set<string>,
  seen: Set<string>
): void
{
  if (node.kind === 'ref')
  {
    if (seen.has(node.name)) return
    seen.add(node.name)
    const target = model.definitions[node.name]
    if (target) collectTopLevelFields(model, target, into, seen)
    return
  }
  if (node.kind === 'anyOf')
  {
    for (const variant of node.variants)
    {
      collectTopLevelFields(model, variant, into, seen)
    }
    return
  }
  if (node.kind === 'object')
  {
    for (const field of Object.keys(node.fields)) into.add(field)
  }
}

const TOP_LEVEL_FIELDS = new Map<EditToolName, ReadonlySet<string>>(
  EDIT_TOOL_NAMES.map((name) =>
  {
    const model = toolInputSchemaModel(name)
    const fields = new Set<string>()
    collectTopLevelFields(model, model.root, fields, new Set())
    return [name, fields as ReadonlySet<string>] as const
  })
)

function unknownTopLevelField(
  name: EditToolName,
  value: unknown
): string | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    return null
  }
  const allowed = TOP_LEVEL_FIELDS.get(name)
  if (!allowed) return null
  return (
    Object.keys(value as Record<string, unknown>).find(
      (key) => !allowed.has(key)
    ) ?? null
  )
}

export class EditToolRefusalErrorV1 extends McpBoundaryError
{
  constructor(
    readonly refusalCode: RequestBoundaryRefusal,
    readonly toolName: EditToolName,
    message: string,
    readonly refusalContext: EditToolRefusalContextV1 = {}
  )
  {
    super('mcp.edit-request-invalid', message)
  }
}

function requestBytes(value: unknown): number
{
  return value === undefined
    ? 2
    : Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf-8')
}

// the frozen "before semantic parse" caps, so every limit refusal this boundary
// emits names the same authority the kernel would have applied
const MAXIMUM_REQUEST_DEPTH =
  DEFAULT_PHASE_8_RESOURCE_POLICY.semanticJsonNestingDepth
const MAXIMUM_REQUEST_MEMBERS =
  DEFAULT_PHASE_8_RESOURCE_POLICY.semanticJsonObjectArrayMembers
const MAXIMUM_REQUEST_STRING_BYTES =
  DEFAULT_PHASE_8_RESOURCE_POLICY.semanticStringValueTextBytes

interface RequestStructureMeasurementV1
{
  readonly depth: number
  readonly containerMembers: number
  readonly stringBytes: number
}

// the walk stops one level past the cap, so a hostile or cyclic request cannot
// make measurement itself the denial vector
function measureEditRequestStructureV1(
  value: unknown,
  depth = 1
): RequestStructureMeasurementV1
{
  if (typeof value === 'string')
  {
    return {
      depth,
      containerMembers: 0,
      stringBytes: Buffer.byteLength(value, 'utf-8'),
    }
  }
  if (value === null || typeof value !== 'object')
  {
    return { depth, containerMembers: 0, stringBytes: 0 }
  }
  const entries = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)
  let measured: RequestStructureMeasurementV1 = {
    depth,
    containerMembers: entries.length,
    stringBytes: 0,
  }
  if (depth > MAXIMUM_REQUEST_DEPTH) return measured
  for (const entry of entries)
  {
    const child = measureEditRequestStructureV1(entry, depth + 1)
    measured = {
      depth: Math.max(measured.depth, child.depth),
      containerMembers: Math.max(
        measured.containerMembers,
        child.containerMembers
      ),
      stringBytes: Math.max(measured.stringBytes, child.stringBytes),
    }
  }
  return measured
}

// structural caps run ahead of the schema parser so a resource refusal carries
// the exact measured pair its contract context declares
function assertRequestStructureV1(
  name: EditToolName,
  rawArguments: unknown
): void
{
  const measured = measureEditRequestStructureV1(rawArguments)
  if (measured.depth > MAXIMUM_REQUEST_DEPTH)
  {
    throw new EditToolRefusalErrorV1(
      'edit.nesting_exceeded',
      name,
      `${name} request nests deeper than its ${MAXIMUM_REQUEST_DEPTH} level limit`,
      { limit: MAXIMUM_REQUEST_DEPTH, observed: measured.depth }
    )
  }
  if (measured.containerMembers > MAXIMUM_REQUEST_MEMBERS)
  {
    throw new EditToolRefusalErrorV1(
      'edit.members_exceeded',
      name,
      `${name} request carries more than its ${MAXIMUM_REQUEST_MEMBERS} member limit`,
      { limit: MAXIMUM_REQUEST_MEMBERS, observed: measured.containerMembers }
    )
  }
  if (measured.stringBytes > MAXIMUM_REQUEST_STRING_BYTES)
  {
    throw new EditToolRefusalErrorV1(
      'edit.string_too_large',
      name,
      `${name} request carries a string beyond its ${MAXIMUM_REQUEST_STRING_BYTES} byte limit`,
      { limit: MAXIMUM_REQUEST_STRING_BYTES, observed: measured.stringBytes }
    )
  }
}

// validate one tool request against its own frozen closed input schema
export function parseEditToolArgumentsV1<Name extends EditToolName>(
  name: Name,
  rawArguments: unknown
): EditToolRequestForV1<Name>
{
  const descriptor = editToolDescriptor(name)
  const bytes = requestBytes(rawArguments)
  if (bytes > descriptor.requestMaximumBytes)
  {
    throw new EditToolRefusalErrorV1(
      'edit.request_too_large',
      name,
      `${name} request is ${bytes} bytes and exceeds its ${descriptor.requestMaximumBytes} byte limit`,
      { limit: descriptor.requestMaximumBytes, observed: bytes }
    )
  }
  assertRequestStructureV1(name, rawArguments)
  const parsed = parseEditToolInputV1(name, rawArguments)
  if (!parsed.ok)
  {
    const stray = unknownTopLevelField(name, rawArguments)
    throw new EditToolRefusalErrorV1(
      stray === null
        ? structuralRefusalCode(parsed.issues)
        : 'edit.unknown_field',
      name,
      `${name} arguments do not match the advertised schema`
    )
  }
  return parsed.value
}

// no response leaves without validating against the frozen closed output schema
export function assertEditToolResponseV1(
  name: EditToolName,
  response: unknown
): void
{
  const descriptor = editToolDescriptor(name)
  const bytes = requestBytes(response)
  if (bytes > descriptor.responseMaximumBytes)
  {
    throw new McpBoundaryError(
      'mcp.edit-response-limit',
      `${name} response is ${bytes} bytes and exceeds its ${descriptor.responseMaximumBytes} byte limit`
    )
  }
  const record =
    response !== null && typeof response === 'object'
      ? (response as Record<string, unknown>)
      : null
  if (record && 'data' in record)
  {
    const dataBytes = requestBytes(record.data)
    if (dataBytes > descriptor.successDataMaximumBytes)
    {
      throw new McpBoundaryError(
        'mcp.edit-response-limit',
        `${name} success data is ${dataBytes} bytes and exceeds its ${descriptor.successDataMaximumBytes} byte limit`
      )
    }
  }
  const validated = validateSchemaValue(toolOutputSchemaModel(name), response)
  if (!validated.ok)
  {
    throw new McpBoundaryError(
      'mcp.edit-response-invalid',
      `${name} response does not match its advertised output schema`
    )
  }
}

// the host answers without a receipt because the transport is the sole audit
// appender, so its result is checked against the receipt-free contract
export function assertEditToolReceiptFreeResponseV1(
  name: EditToolName,
  response: unknown
): void
{
  const validated = validateSchemaValue(
    toolReceiptFreeResultSchemaModel(name),
    response
  )
  if (!validated.ok)
  {
    const issueSummary = validated.issues
      .slice(0, 3)
      .map((issue) => `${issue.path || '/'} ${issue.code}: ${issue.message}`)
      .join('; ')
    throw new McpBoundaryError(
      'mcp.edit-host-response-invalid',
      `${name} host result does not match its receipt-free contract: ${issueSummary}`
    )
  }
}

// * the audit receipt the advertised output schema requires on every envelope,
// * success & refusal alike. A boundary refusal therefore appends its own
// * begin/complete pair rather than answering without one
export interface EditToolAuditReceiptV1
{
  readonly callId: string
  readonly beginSequence: number
  readonly beginRecordSha256: string
  readonly completeSequence: number
  readonly completeRecordSha256: string
}

export interface EditToolAuditPortV1
{
  beginCall(input: {
    readonly toolName: EditToolName
    readonly requestSha256: string
    readonly principalSha256: string
  }): {
    readonly callId: string
    readonly sequence: number
    readonly recordSha256: string
  }
  completeCall(input: {
    readonly callId: string
    readonly beginSequence: number
    readonly disposition: 'completed' | 'refused' | 'failed'
    readonly outcomeSha256: string
  }): { readonly sequence: number; readonly recordSha256: string }
}

// the receipt-free refusal the contract defines for a request-boundary failure;
// requestId & attemptId stay absent because no attempt was ever allocated
export function editToolRefusalResultV1(
  name: EditToolName,
  refusal: EditToolRefusalErrorV1
): Record<string, unknown>
{
  const context: Record<string, number> = LIMIT_CONTEXT_REFUSALS.has(
    refusal.refusalCode
  )
    ? {
        limit: refusal.refusalContext.limit ?? 0,
        observed: refusal.refusalContext.observed ?? 0,
      }
    : {}
  return {
    schemaVersion: 1,
    ok: false,
    tool: name,
    error: {
      code: refusal.refusalCode,
      safeMessage: refusal.message,
      context,
    },
  }
}

// attaching the receipt is the last step before a response leaves, & the
// attached envelope is validated so a non-conforming one cannot escape
export function attachEditToolAuditReceiptV1(
  name: EditToolName,
  receiptFree: Record<string, unknown>,
  audit: EditToolAuditReceiptV1
): Record<string, unknown>
{
  const response = { ...receiptFree, audit: { ...audit } }
  assertEditToolResponseV1(name, response)
  return response
}

// the four project tools validate against the same closed projection they advertise
export function assertProjectToolResponseV1(
  name: (typeof PROJECT_TOOL_NAMES)[number],
  envelope: unknown
): void
{
  const issues = validateClosedJsonSchemaValueV1(
    internalProjectOutputSchema(name),
    envelope
  )
  if (issues.length > 0)
  {
    throw new McpBoundaryError(
      'mcp.project-response-invalid',
      `${name} response does not match its advertised output schema`
    )
  }
}

// the host returns the receipt-free result the contract defines; the transport
// owns the audit pair & attaches the receipt
export interface EditToolHostV1
{
  callEditTool(
    name: EditToolName,
    request: unknown,
    invocation: HostInvocationContextV1
  ): Promise<unknown>
}

export interface EditToolDispatchOptionsV1
{
  readonly audit: EditToolDispatchAuditPortV1
  readonly principalSha256: string
  readonly realmSha256: string
  readonly invocation: (input: {
    readonly callId: string
    readonly toolName: EditToolName
    readonly requestSha256: string
    readonly principalSha256: string
  }) => HostInvocationContextV1
  readonly afterHostCall?: () => void
}

export interface EditToolDispatchAuditPortV1
{
  reserveIdempotency(namespaceSha256: string): Promise<() => void>
  lookupIdempotency(input: {
    readonly toolName: EditToolName
    readonly namespaceSha256: string
    readonly requestIdSha256: string
    readonly requestSha256: string
  }): Promise<AuthenticatedAuditIdempotencyLookupV1>
  beginCall(input: {
    readonly toolName: EditToolName
    readonly requestSha256: string
    readonly request: unknown
    readonly inputByteLength: number
    readonly session: AuditSessionBindingV1
    readonly expectedHead: AuditExpectedHeadV1
    readonly idempotency: AuditIdempotencyBindingV1
  }): {
    readonly callId: string
    readonly sequence: number
    readonly recordSha256: string
  }
  completeCall(input: {
    readonly callId: string
    readonly beginSequence: number
    readonly disposition: 'completed' | 'refused'
    readonly outcomeSha256: string
    readonly preHead: AuditHeadObservationV1
    readonly postHead: AuditHeadObservationV1
    readonly semanticEvent: AuditSemanticEventCorrelationV1
    readonly evidenceIds: readonly string[]
    readonly receiptFreeOutcome: EditToolReceiptFreeResultV1
    readonly retainIdempotencyOutcome: boolean
  }): { readonly sequence: number; readonly recordSha256: string }
  failCall(input: {
    readonly callId: string
    readonly beginSequence: number
    readonly outcomeCode: string
  }): void
  schemaRefusal(input: {
    readonly toolName: EditToolName
    readonly rawArguments: unknown
    readonly receiptFree: Record<string, unknown>
  }): EditToolAuditReceiptV1
}

const EXACT_HEAD_FIELDS = Object.freeze([
  'sourceArtifactSha256',
  'revisionNumber',
  'revisionId',
  'candidateSha256',
  'assetManifestSha256',
  'changeContractSha256',
  'capabilityProfileSha256',
  'capabilitySnapshotSha256',
] as const)

function recordValueV1(value: unknown): Record<string, unknown> | null
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function exactHeadV1(value: unknown): AuditHeadObservationV1
{
  const candidate = recordValueV1(value)
  if (
    candidate === null ||
    !Number.isSafeInteger(candidate.revisionNumber) ||
    EXACT_HEAD_FIELDS.filter((field) => field !== 'revisionNumber').some(
      (field) =>
        typeof candidate[field] !== 'string' ||
        !LOWERCASE_SHA256_PATTERN.test(String(candidate[field]))
    )
  )
    return { state: 'unavailable' }
  return {
    state: 'observed',
    head: Object.freeze(
      Object.fromEntries(
        EXACT_HEAD_FIELDS.map((field) => [field, candidate[field]])
      )
    ) as HeadProjectionV1,
  }
}

function requestExpectedHeadV1(request: unknown): AuditExpectedHeadV1
{
  const candidate = recordValueV1(request)
  if (candidate === null) return { state: 'absent' }
  const batch = recordValueV1(candidate.batch)
  const context = recordValueV1(candidate.context)
  for (const nested of [candidate.expected, batch?.expected, context?.head])
  {
    const projected = exactHeadV1(nested)
    if (projected.state === 'observed')
      return { state: 'present', head: projected.head }
  }
  const projected = exactHeadV1(
    Object.fromEntries(
      EXACT_HEAD_FIELDS.map((field) => [
        field,
        candidate[
          field === 'revisionNumber'
            ? 'expectedRevisionNumber'
            : `expected${field[0]!.toUpperCase()}${field.slice(1)}`
        ],
      ])
    )
  )
  return projected.state === 'observed'
    ? { state: 'present', head: projected.head }
    : { state: 'absent' }
}

function requestSessionV1(request: unknown): AuditSessionBindingV1
{
  const candidate = recordValueV1(request)
  if (candidate === null) return { state: 'absent' }
  const direct = candidate.sessionId
  if (typeof direct === 'string') return { state: 'present', sessionId: direct }
  const context = recordValueV1(candidate.context)
  return context?.kind === 'edit' && typeof context.sessionId === 'string'
    ? { state: 'present', sessionId: context.sessionId }
    : { state: 'absent' }
}

function requestIdempotencyV1(
  name: EditToolName,
  request: unknown,
  options: EditToolDispatchOptionsV1
): AuditIdempotencyBindingV1
{
  const candidate = recordValueV1(request)
  if (candidate === null || typeof candidate.requestId !== 'string')
    return { state: 'absent' }
  const session = requestSessionV1(request)
  return editTransportIdempotencyBindingV1({
    realmSha256: options.realmSha256,
    principalSha256: options.principalSha256,
    toolName: name,
    sessionId: session.state === 'present' ? session.sessionId : null,
    requestId: candidate.requestId,
  })
}

export function editTransportIdempotencyBindingV1(input: {
  readonly realmSha256: string
  readonly principalSha256: string
  readonly toolName: EditToolName
  readonly sessionId: string | null
  readonly requestId: string
}): Extract<AuditIdempotencyBindingV1, { readonly state: 'present' }>
{
  return {
    state: 'present',
    namespaceSha256: semanticHashV1('transport-request', {
      schemaVersion: 1,
      kind: 'mcp-edit-idempotency-namespace-v1',
      realmSha256: input.realmSha256,
      principalSha256: input.principalSha256,
      tool: input.toolName,
      sessionId: input.sessionId,
      requestId: input.requestId,
    }),
    requestIdSha256: semanticHashV1('transport-request', {
      schemaVersion: 1,
      kind: 'mcp-edit-request-id-v1',
      requestId: input.requestId,
    }),
  }
}

export function editReceiptFreeAuditContextV1(
  receiptFree: Record<string, unknown>
): {
  readonly preHead: AuditHeadObservationV1
  readonly postHead: AuditHeadObservationV1
  readonly semanticEvent: AuditSemanticEventCorrelationV1
  readonly evidenceIds: readonly string[]
}
{
  const data = recordValueV1(receiptFree.data)
  const identity = recordValueV1(
    receiptFree.ok === true ? data?.identity : receiptFree.identity
  )
  const nestedPreHead = recordValueV1(identity?.preHead)
  const nestedPostHead = recordValueV1(identity?.postHead)
  const preHead = exactHeadV1(
    nestedPreHead?.state === 'present' ? nestedPreHead.head : null
  )
  const postHead = exactHeadV1(
    nestedPostHead?.state === 'present'
      ? nestedPostHead.head
      : identity?.postHead
  )
  const eventCorrelation = recordValueV1(identity?.event)
  const event = recordValueV1(
    eventCorrelation?.state === 'present'
      ? eventCorrelation.event
      : eventCorrelation?.state === 'absent'
        ? null
        : eventCorrelation
  )
  const semanticEvent: AuditSemanticEventCorrelationV1 =
    event !== null &&
    typeof event.eventSha256 === 'string' &&
    LOWERCASE_SHA256_PATTERN.test(event.eventSha256) &&
    Number.isSafeInteger(event.sequence)
      ? {
          state: 'present',
          event: {
            eventSha256: event.eventSha256,
            sequence: Number(event.sequence),
          },
        }
      : { state: 'absent' }
  const evidenceIds = Array.isArray(identity?.evidenceIds)
    ? identity.evidenceIds.filter(
        (value): value is string => typeof value === 'string'
      )
    : []
  return Object.freeze({
    preHead,
    postHead,
    semanticEvent,
    evidenceIds: Object.freeze([...new Set(evidenceIds)]),
  })
}

const AUDIT_RECEIPT_HASH_PLACEHOLDER = '0'.repeat(64)

function editRequestSha256V1(
  name: EditToolName,
  request: unknown,
  options: EditToolDispatchOptionsV1
): string
{
  return editTransportRequestSha256V1({
    principalSha256: options.principalSha256,
    realmSha256: options.realmSha256,
    tool: name,
    request: request as Extract<
      TransportRequestHashProjectionV1,
      { readonly tool: typeof name }
    >['request'],
  })
}

function prevalidateAuditedEditResponseV1(
  name: EditToolName,
  receiptFree: Record<string, unknown>,
  begun: {
    readonly callId: string
    readonly sequence: number
    readonly recordSha256: string
  }
): void
{
  assertEditToolResponseV1(name, {
    ...receiptFree,
    audit: {
      callId: begun.callId,
      beginSequence: begun.sequence,
      beginRecordSha256: begun.recordSha256,
      completeSequence: begun.sequence + 1,
      completeRecordSha256: AUDIT_RECEIPT_HASH_PLACEHOLDER,
    },
  })
}

// * dispatch one edit tool. Both paths append the same begin/complete pair &
// * answer through the same validated envelope, so a request-boundary refusal
// * is an ordinary contract response rather than an off-schema error shape
export async function callEditTool(
  host: EditToolHostV1 | null,
  name: string,
  rawArguments: unknown,
  options: EditToolDispatchOptionsV1
): Promise<Record<string, unknown>>
{
  if (!isEditToolName(name))
  {
    throw new McpBoundaryError('mcp.tool-unknown', 'edit tool was not found')
  }
  let request: unknown
  try
  {
    request = parseEditToolArgumentsV1(name, rawArguments)
  }
  catch (error)
  {
    if (!(error instanceof EditToolRefusalErrorV1)) throw error
    const receiptFree = editToolRefusalResultV1(name, error)
    assertEditToolReceiptFreeResponseV1(name, receiptFree)
    return attachEditToolAuditReceiptV1(
      name,
      receiptFree,
      options.audit.schemaRefusal({
        toolName: name,
        rawArguments,
        receiptFree,
      })
    )
  }
  const requestSha256 = editRequestSha256V1(name, request, options)
  const idempotency = requestIdempotencyV1(name, request, options)
  const releaseReservation =
    idempotency.state === 'present'
      ? await options.audit.reserveIdempotency(idempotency.namespaceSha256)
      : null
  try
  {
    const retained =
      idempotency.state === 'present'
        ? await options.audit.lookupIdempotency({
            toolName: name,
            namespaceSha256: idempotency.namespaceSha256,
            requestIdSha256: idempotency.requestIdSha256,
            requestSha256,
          })
        : ({ state: 'absent' } as const)
    const begun = options.audit.beginCall({
      toolName: name,
      requestSha256,
      request,
      inputByteLength: requestBytes(request),
      session: requestSessionV1(request),
      expectedHead: requestExpectedHeadV1(request),
      idempotency,
    })
    let completionAttempted = false
    let terminal = false
    const complete = (
      disposition: 'completed' | 'refused',
      outcome: Record<string, unknown>
    ): EditToolAuditReceiptV1 =>
    {
      if (completionAttempted)
      {
        throw new McpBoundaryError(
          'mcp.audit-completion-duplicate',
          'an edit audit begin cannot acquire two terminal records'
        )
      }
      completionAttempted = true
      const context = editReceiptFreeAuditContextV1(outcome)
      const completed = options.audit.completeCall({
        callId: begun.callId,
        beginSequence: begun.sequence,
        disposition,
        outcomeSha256: editReceiptFreeOutcomeSha256V1(
          outcome as unknown as EditToolReceiptFreeResultV1
        ),
        receiptFreeOutcome: outcome as unknown as EditToolReceiptFreeResultV1,
        retainIdempotencyOutcome: retained.state === 'absent',
        ...context,
      })
      terminal = true
      return {
        callId: begun.callId,
        beginSequence: begun.sequence,
        beginRecordSha256: begun.recordSha256,
        completeSequence: completed.sequence,
        completeRecordSha256: completed.recordSha256,
      }
    }
    try
    {
      if (retained.state === 'conflict')
      {
        const receiptFree = {
          schemaVersion: 1,
          ok: false,
          tool: name,
          error: {
            code: 'edit.request_id_conflict',
            safeMessage:
              'requestId is already bound to another exact edit request',
            context: {},
          },
        }
        assertEditToolReceiptFreeResponseV1(name, receiptFree)
        prevalidateAuditedEditResponseV1(name, receiptFree, begun)
        return attachEditToolAuditReceiptV1(
          name,
          receiptFree,
          complete('refused', receiptFree)
        )
      }
      if (retained.state === 'matched')
      {
        const receiptFree = retained.outcome
          .receiptFreeOutcome as unknown as Record<string, unknown>
        assertEditToolReceiptFreeResponseV1(name, receiptFree)
        if (
          editReceiptFreeOutcomeSha256V1(
            receiptFree as unknown as EditToolReceiptFreeResultV1
          ) !== retained.outcome.resultSha256
        )
          throw new McpBoundaryError(
            'mcp.audit-idempotency-invalid',
            'retained idempotency envelope does not match its authenticated hash'
          )
        prevalidateAuditedEditResponseV1(name, receiptFree, begun)
        return attachEditToolAuditReceiptV1(
          name,
          receiptFree,
          complete(
            receiptFree.ok === false ? 'refused' : 'completed',
            receiptFree
          )
        )
      }
      if (!host)
      {
        throw new McpBoundaryError(
          'mcp.edit-host-unavailable',
          'this server has no registered trusted edit host'
        )
      }
      const receiptFree = (await host.callEditTool(
        name,
        request,
        options.invocation({
          callId: begun.callId,
          toolName: name,
          requestSha256,
          principalSha256: options.principalSha256,
        })
      )) as Record<string, unknown>
      options.afterHostCall?.()
      assertEditToolReceiptFreeResponseV1(name, receiptFree)
      prevalidateAuditedEditResponseV1(name, receiptFree, begun)
      return attachEditToolAuditReceiptV1(
        name,
        receiptFree,
        complete(
          receiptFree.ok === false ? 'refused' : 'completed',
          receiptFree
        )
      )
    }
    catch (error)
    {
      const recoveryRequired =
        error instanceof McpBoundaryError &&
        error.code === 'mcp.edit-transport-recovery-required'
      if (!terminal && !completionAttempted && !recoveryRequired)
      {
        completionAttempted = true
        options.audit.failCall({
          callId: begun.callId,
          beginSequence: begun.sequence,
          outcomeCode:
            error instanceof McpBoundaryError
              ? error.code
              : 'mcp.edit-host-failed',
        })
      }
      throw error
    }
  }
  finally
  {
    releaseReservation?.()
  }
}

// repair keeps the current surface as a rollback anchor; project-edit excludes it
export function profileTools(
  profile: ScratchMcpProfileName,
  repairTools: readonly Tool[],
  projectTools: readonly Tool[]
): readonly Tool[]
{
  return profile === 'project-edit'
    ? PROJECT_EDIT_PROFILE_TOOLS
    : Object.freeze([...repairTools, ...projectTools])
}
