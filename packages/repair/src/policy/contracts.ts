// packages/repair/src/policy/contracts.ts
// detached agent protocol, evidence DTOs, outcomes, & resource validation

import { createHash } from 'node:crypto'

import {
  canonicalJson,
  DEFAULT_REPAIR_RESOURCE_LIMITS,
  parseSemanticPatch,
  TARGET_PROPERTIES,
  TARGET_PROPERTY_DESCRIPTORS,
  type Json,
  type ProjectDelta,
  type RepairOp,
  type RepairResourceLimits,
  type RepairViolation,
  type SemanticPatch,
  type TargetProperty,
} from '@scratch-agent/ir'
import type {
  CandidatePipelineEvaluation,
  DiagnosticFailure,
  NormalizedFailure,
} from '@scratch-agent/eval'
import type { LocalizationReport } from '@scratch-agent/localize'

import { isPlainRecord as record } from '../internal/records.js'
import type { EvidenceLevel, RepairPolicy } from './policy.js'
import type {
  RepairMultimodalEvaluator,
  RepairMultimodalGateV1,
} from '../multimodal/multimodal.js'
import type { AcceptanceContract, RepairCase } from '../benchmark/repair-case.js'

export type RepairSessionState =
  | 'created'
  | 'evaluating-baseline'
  | 'awaiting-proposal'
  | 'evaluating-candidate'
  | 'already-passing'
  | 'baseline-invalid'
  | 'case-invalid'
  | 'repaired'
  | 'budget-exhausted'
  | 'no-progress'
  | 'agent-declined'
  | 'stopped-agent'
  | 'stopped-infrastructure'
  | 'stopped-unsupported'
  | 'stopped-internal'

export type TerminalRepairStatus = Exclude<
  RepairSessionState,
  | 'created'
  | 'evaluating-baseline'
  | 'awaiting-proposal'
  | 'evaluating-candidate'
>

export type AttemptStatus =
  | 'proposal-rejected'
  | 'candidate-rejected'
  | 'repaired'
  | 'budget-exhausted'
  | 'no-progress'
  | 'agent-declined'
  | 'stopped-agent'
  | 'stopped-infrastructure'
  | 'stopped-unsupported'
  | 'stopped-internal'

export interface ArtifactIdentity
{
  path: string
  sha256: string
  byteLength: number
}

export interface RepairProposal
{
  schemaVersion: 1
  requestId: string
  baseArtifactSha256: string
  rationale: string
  expectedEffect: string
  confidence?: number
  operations: RepairOp[]
}

export interface RepairAgentDescriptor
{
  adapter: string
  provider?: string
  model?: string
  version?: string
}

export interface RepairAgent
{
  readonly descriptor: RepairAgentDescriptor
  propose(request: RepairRequest): Promise<RepairProposal>
}

export interface RepairAgentUsage
{
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export interface EvidenceValueChange
{
  path: string
  before: unknown
  after: unknown
}

export interface EvidenceSnapshotDelta
{
  testId: string
  snapshot: string
  previousTick: number | null
  currentTick: number
  changes: EvidenceValueChange[]
  omittedChangeCount: number
}

export interface EvidenceScreenshot
{
  testId: string
  label: string
  tick: number
  path: string
}

export interface EvidenceBundle
{
  schemaVersion: 1
  level: EvidenceLevel
  selectedReasons: string[]
  level0: {
    failures: NormalizedFailure[]
    diagnostics: DiagnosticFailure[]
  }
  level1: {
    localization: LocalizationReport
  } | null
  level2: {
    snapshotDeltas: EvidenceSnapshotDelta[]
    previousProposal: RepairProposal | null
    previousOutcome: PriorAttemptSummary | null
  } | null
  level3: {
    screenshots: EvidenceScreenshot[]
  } | null
}

export interface EvidenceProgression
{
  level: EvidenceLevel
  relocalize: boolean
  reason: 'unchanged' | 'persistent' | 'introduced' | 'changed' | 'ineligible'
}

export interface TrustedSubmissionMetadata
{
  descriptor?: RepairAgentDescriptor
  latencyMs?: number
  usage?: RepairAgentUsage
}

export interface PriorAttemptSummary
{
  attemptId: string
  number: number
  status: AttemptStatus
  evidenceLevel: number
  requestSha256: string
  proposalSha256: string | null
  semanticProposalSha256: string | null
  operationKinds: string[]
  violations: AttemptViolation[]
  candidate: ArtifactIdentity | null
  evaluationStatus: CandidatePipelineEvaluation['status'] | null
  failureFingerprints: string[]
  deltaSummary: ProjectDelta['summary'] | null
}

interface RepairRequestBase
{
  requestId: string
  sessionId: string
  attempt: {
    number: number
    maxAttempts: number
    remainingAfterThis: number
  }
  baseline: {
    projectJsonSha256: string
    artifactSha256: string
  }
  repairCase: {
    id: string
    objective: string
  }
  acceptance: AcceptanceContract
  policy: RepairPolicy
  protectedSurfaces: string[]
  projectSummary: string
  failures: NormalizedFailure[]
  localization: LocalizationReport
  evidence: EvidenceBundle
  priorAttempts: PriorAttemptSummary[]
  proposalSchema: object
}

export const REPAIR_REQUEST_SCHEMA_VERSION = 1 as const
export const REPAIR_MULTIMODAL_REQUEST_SCHEMA_VERSION = 2 as const

interface RepairRequestV1 extends RepairRequestBase
{
  schemaVersion: typeof REPAIR_REQUEST_SCHEMA_VERSION
}

interface RepairRequestV2 extends RepairRequestBase
{
  schemaVersion: typeof REPAIR_MULTIMODAL_REQUEST_SCHEMA_VERSION
  multimodal: RepairMultimodalGateV1
}

export type RepairRequest = RepairRequestV1 | RepairRequestV2

export interface AttemptViolation
{
  source: 'proposal' | 'policy' | 'preservation' | 'internal'
  code: string
  message: string
  opId?: string
}

export interface AttemptRecord
{
  schemaVersion: 1
  attemptId: string
  number: number
  startedAt: string
  completedAt: string
  status: AttemptStatus
  transactionStatus: 'not-run' | 'passed' | 'failed' | 'stopped'
  request: RepairRequest
  requestSha256: string
  proposal: RepairProposal | null
  proposalSha256: string | null
  semanticProposalSha256: string | null
  agent: {
    descriptor: RepairAgentDescriptor | null
    latencyMs: number | null
    usage: RepairAgentUsage | null
  }
  violations: AttemptViolation[]
  candidate: ArtifactIdentity | null
  delta: ProjectDelta | null
  preservation: unknown | null
  evaluation: CandidatePipelineEvaluation | null
  multimodal?: RepairMultimodalGateV1 | null
}

export interface AttemptResult
{
  schemaVersion: 1
  sessionId: string
  attempt: PriorAttemptSummary
  state: RepairSessionState
  terminal: TerminalResult | null
}

export interface TerminalResult
{
  schemaVersion: 1
  sessionId: string
  status: TerminalRepairStatus
  stopReason: string
  attemptsUsed: number
  maxAttempts: number
  accepted: ArtifactIdentity | null
  report: {
    json: string | null
    markdown: string | null
    errorCode: string | null
  }
}

export interface StartRepairInput
{
  artifactBytes: Uint8Array
  repairCase: RepairCase
  artifactRoot?: string
  sessionId?: string
  createdAt?: string
  sourceRevision?: string
  recordVideo?: boolean
  multimodalEvaluator?: RepairMultimodalEvaluator
}

export interface RepairResult extends TerminalResult
{
  baseline: object
  localization: LocalizationReport | null
  attempts: PriorAttemptSummary[]
}

export interface RepairSessionSnapshot
{
  schemaVersion: 1
  sessionId: string
  state: RepairSessionState
  attemptsReserved: number
  attemptsCompleted: number
  maxAttempts: number
  pendingRequestId: string | null
  terminal: TerminalResult | null
}

export interface AcceptedArtifact
{
  identity: ArtifactIdentity
  bytes: Uint8Array
}

interface ParsedRepairProposal
{
  ok: true
  proposal: RepairProposal
  patch: SemanticPatch
  proposalSha256: string
  semanticProposalSha256: string
}

interface RejectedRepairProposal
{
  ok: false
  proposal: RepairProposal | null
  proposalSha256: string | null
  violations: AttemptViolation[]
}

type RepairProposalParseResult =
  ParsedRepairProposal | RejectedRepairProposal

export class RepairProtocolError extends Error
{
  constructor(
    readonly code: string,
    message: string
  )
  {
    super(message)
  }
}

const SHA256 = /^[a-f0-9]{64}$/
const UTF8_ENCODER = new TextEncoder()
const ROOT_PROPOSAL_KEYS = new Set([
  'schemaVersion',
  'requestId',
  'baseArtifactSha256',
  'rationale',
  'expectedEffect',
  'confidence',
  'operations',
])

function utf8Length(value: string): number
{
  return UTF8_ENCODER.encode(value).byteLength
}

function resourceViolation(message: string): AttemptViolation
{
  return { source: 'proposal', code: 'resource-limit', message }
}

function validateResources(
  value: unknown,
  limits: RepairResourceLimits,
  depth = 0
): AttemptViolation[]
{
  if (depth > limits.maxDepth)
  {
    return [resourceViolation(`proposal depth exceeds ${limits.maxDepth}`)]
  }
  if (typeof value === 'string')
  {
    return utf8Length(value) > limits.maxStringBytes
      ? [resourceViolation(`proposal string exceeds ${limits.maxStringBytes}`)]
      : []
  }
  if (value === null || typeof value !== 'object') return []
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value)
  if (entries.length > limits.maxMembers)
  {
    return [
      resourceViolation(`proposal member count exceeds ${limits.maxMembers}`),
    ]
  }
  const violations: AttemptViolation[] = []
  for (const [key, entry] of entries)
  {
    if (utf8Length(key) > limits.maxStringBytes)
    {
      violations.push(
        resourceViolation(`proposal key exceeds ${limits.maxStringBytes}`)
      )
    }
    violations.push(...validateResources(entry, limits, depth + 1))
  }
  return violations
}

function invalid(message: string): AttemptViolation
{
  return { source: 'proposal', code: 'invalid-payload', message }
}

export function hashJson(value: unknown): string
{
  return createHash('sha256')
    .update(canonicalJson(value as Json))
    .digest('hex')
}

export function detachJson<T>(value: T): T
{
  const serialized = JSON.stringify(value)
  if (serialized === undefined)
  {
    throw new TypeError('value is not serializable JSON')
  }
  return JSON.parse(serialized) as T
}

function freezeDeep<T>(value: T, seen = new Set<object>()): T
{
  if (value === null || typeof value !== 'object' || seen.has(value))
    return value
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>))
  {
    freezeDeep(child, seen)
  }
  return Object.freeze(value)
}

export function detachedFrozen<T>(value: T): T
{
  return freezeDeep(detachJson(value))
}

function normalizedSemanticPatch(patch: SemanticPatch): Json
{
  return {
    schemaVersion: patch.schemaVersion,
    baseArtifactSha256: patch.baseArtifactSha256,
    operations: patch.operations.map((operation) =>
    {
      const { opId: _opId, ...semantic } = operation
      return semantic
    }),
  } as unknown as Json
}

export function parseRepairProposal(
  raw: unknown,
  resourceLimits: Partial<RepairResourceLimits> = {}
): RepairProposalParseResult
{
  const limits: RepairResourceLimits = {
    ...DEFAULT_REPAIR_RESOURCE_LIMITS,
    ...Object.fromEntries(
      Object.entries(resourceLimits).filter(([key, value]) =>
      {
        const maximum =
          DEFAULT_REPAIR_RESOURCE_LIMITS[key as keyof RepairResourceLimits]
        return (
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value > 0 &&
          value <= maximum
        )
      })
    ),
  }
  let detached: unknown
  let serialized: string
  try
  {
    detached = detachJson(raw)
    serialized = canonicalJson(detached as Json)
  }
  catch (error)
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256: null,
      violations: [
        invalid(
          error instanceof Error ? error.message : 'proposal is not JSON'
        ),
      ],
    }
  }
  const proposalSha256 = createHash('sha256').update(serialized).digest('hex')
  if (utf8Length(serialized) > limits.maxProposalBytes)
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256,
      violations: [
        resourceViolation(`proposal exceeds ${limits.maxProposalBytes} bytes`),
      ],
    }
  }
  const resourceViolations = validateResources(detached, limits)
  if (resourceViolations.length > 0)
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256,
      violations: resourceViolations,
    }
  }
  if (!record(detached))
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256,
      violations: [invalid('proposal must be a plain object')],
    }
  }
  const unknown = Object.keys(detached).filter(
    (key) => !ROOT_PROPOSAL_KEYS.has(key)
  )
  if (unknown.length > 0)
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256,
      violations: [invalid(`unknown proposal field: ${unknown.sort()[0]}`)],
    }
  }
  const confidenceValid =
    detached.confidence === undefined ||
    (typeof detached.confidence === 'number' &&
      Number.isFinite(detached.confidence) &&
      detached.confidence >= 0 &&
      detached.confidence <= 1)
  if (
    detached.schemaVersion !== 1 ||
    typeof detached.requestId !== 'string' ||
    detached.requestId.length === 0 ||
    typeof detached.baseArtifactSha256 !== 'string' ||
    !SHA256.test(detached.baseArtifactSha256) ||
    typeof detached.rationale !== 'string' ||
    typeof detached.expectedEffect !== 'string' ||
    !confidenceValid ||
    !Array.isArray(detached.operations)
  )
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256,
      violations: [invalid('proposal envelope has invalid required fields')],
    }
  }
  const parsed = parseSemanticPatch(
    {
      schemaVersion: 1,
      baseArtifactSha256: detached.baseArtifactSha256,
      operations: detached.operations,
    },
    limits
  )
  if (!parsed.ok)
  {
    return {
      ok: false,
      proposal: null,
      proposalSha256,
      violations: parsed.violations.map((violation) => ({
        source: 'proposal' as const,
        code: violation.code,
        message: violation.message,
        ...(violation.opId ? { opId: violation.opId } : {}),
      })),
    }
  }
  const proposal: RepairProposal = {
    schemaVersion: 1,
    requestId: detached.requestId,
    baseArtifactSha256: detached.baseArtifactSha256,
    rationale: detached.rationale,
    expectedEffect: detached.expectedEffect,
    ...(detached.confidence !== undefined
      ? { confidence: detached.confidence as number }
      : {}),
    operations: parsed.patch.operations,
  }
  return {
    ok: true,
    proposal,
    patch: parsed.patch,
    proposalSha256,
    semanticProposalSha256: hashJson(normalizedSemanticPatch(parsed.patch)),
  }
}

export function repairViolation(violation: RepairViolation): AttemptViolation
{
  return {
    source:
      violation.code === 'preservation'
        ? 'preservation'
        : violation.code === 'internal-invariant' ||
            violation.code === 'unattributed-change'
          ? 'internal'
          : 'policy',
    code: violation.code,
    message: violation.message,
    ...(violation.opId ? { opId: violation.opId } : {}),
  }
}

function operationObject(
  required: string[],
  properties: Record<string, unknown>
): object
{
  return {
    type: 'object',
    additionalProperties: false,
    required: ['opId', 'kind', ...required],
    properties: {
      opId: {
        type: 'string',
        minLength: 1,
        maxLength: 8192,
        pattern: '^(?:\\S|\\S[\\s\\S]*\\S)$',
      },
      ...properties,
    },
  }
}

function declarationReferenceSchema(
  kind: 'variable' | 'list' | 'broadcast'
): object
{
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'declarationTarget', 'id', 'name'],
    properties: {
      kind: { const: kind },
      declarationTarget: { $ref: '#/$defs/targetRef' },
      id: { type: 'string', minLength: 1, maxLength: 8192 },
      name: { type: 'string', minLength: 1, maxLength: 8192 },
    },
  }
}

function operationSchemas(
  maxNewBlocks: number,
  allowedTargetProperties: readonly string[]
): Record<string, object>
{
  const allowedProperties = new Set(allowedTargetProperties)
  const targetPropertySchemas = TARGET_PROPERTIES.filter((property) =>
    allowedProperties.has(property)
  ).map((property) =>
  {
    const descriptor = TARGET_PROPERTY_DESCRIPTORS[property]
    const valueSchema =
      descriptor.valueType === 'rotation-style'
        ? { enum: [...descriptor.values] }
        : { type: descriptor.valueType }
    const targetSchema =
      descriptor.target === 'sprite'
        ? {
            allOf: [
              { $ref: '#/$defs/targetRef' },
              { properties: { isStage: { const: false } } },
            ],
          }
        : { $ref: '#/$defs/targetRef' }
    return operationObject(['target', 'property', 'from', 'to'], {
      kind: { const: 'setTargetProperty' },
      target: targetSchema,
      property: { const: property satisfies TargetProperty },
      from: valueSchema,
      to: valueSchema,
    })
  })
  return {
    replaceLiteral: operationObject(
      ['block', 'inputName', 'expectedOpcode', 'from', 'to'],
      {
        kind: { const: 'replaceLiteral' },
        block: { $ref: '#/$defs/blockRef' },
        inputName: { type: 'string', minLength: 1, maxLength: 8192 },
        expectedOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
        from: { $ref: '#/$defs/literal' },
        to: { $ref: '#/$defs/literal' },
      }
    ),
    replaceCompatibleOpcode: operationObject(
      ['block', 'fromOpcode', 'toOpcode'],
      {
        kind: { const: 'replaceCompatibleOpcode' },
        block: { $ref: '#/$defs/blockRef' },
        fromOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
        toOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
      }
    ),
    replaceVariableRef: operationObject(
      ['block', 'expectedOpcode', 'site', 'from', 'to'],
      {
        kind: { const: 'replaceVariableRef' },
        block: { $ref: '#/$defs/blockRef' },
        expectedOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
        site: { $ref: '#/$defs/referenceSite' },
        from: { $ref: '#/$defs/variableRef' },
        to: { $ref: '#/$defs/variableRef' },
      }
    ),
    replaceBroadcastRef: operationObject(
      ['block', 'expectedOpcode', 'site', 'from', 'to'],
      {
        kind: { const: 'replaceBroadcastRef' },
        block: { $ref: '#/$defs/blockRef' },
        expectedOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
        site: { $ref: '#/$defs/referenceSite' },
        from: { $ref: '#/$defs/broadcastRef' },
        to: { $ref: '#/$defs/broadcastRef' },
      }
    ),
    insertStatementsAfter: operationObject(
      ['anchor', 'expectedOpcode', 'statements'],
      {
        kind: { const: 'insertStatementsAfter' },
        anchor: { $ref: '#/$defs/blockRef' },
        expectedOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
        statements: {
          type: 'array',
          minItems: 1,
          maxItems: maxNewBlocks,
          items: { $ref: '#/$defs/blockSpec' },
        },
      }
    ),
    deleteStatement: operationObject(['statement', 'expectedOpcode'], {
      kind: { const: 'deleteStatement' },
      statement: { $ref: '#/$defs/blockRef' },
      expectedOpcode: { type: 'string', minLength: 1, maxLength: 8192 },
    }),
    addScript: operationObject(['target', 'statements'], {
      kind: { const: 'addScript' },
      target: { $ref: '#/$defs/targetRef' },
      statements: {
        type: 'array',
        minItems: 1,
        maxItems: maxNewBlocks,
        items: { $ref: '#/$defs/blockSpec' },
      },
    }),
    setTargetProperty:
      targetPropertySchemas.length > 0
        ? { oneOf: targetPropertySchemas }
        : { not: {} },
  }
}

export function proposalSchema(
  allowedKinds: readonly string[],
  maxOperations = 4,
  maxNewBlocks = 16,
  allowedTargetProperties: readonly string[] = []
): object
{
  const operations = operationSchemas(maxNewBlocks, allowedTargetProperties)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment:
      'The controller also enforces global recursive block, byte, depth, and member limits that JSON Schema cannot express across recursive branches.',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'requestId',
      'baseArtifactSha256',
      'rationale',
      'expectedEffect',
      'operations',
    ],
    properties: {
      schemaVersion: { const: 1 },
      requestId: { type: 'string', minLength: 1, maxLength: 8192 },
      baseArtifactSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      rationale: { type: 'string', maxLength: 8192 },
      expectedEffect: { type: 'string', maxLength: 8192 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      operations: {
        type: 'array',
        maxItems: maxOperations,
        items: {
          oneOf: allowedKinds.flatMap((kind) =>
            operations[kind] ? [operations[kind]] : []
          ),
        },
      },
    },
    $defs: {
      targetRef: {
        type: 'object',
        additionalProperties: false,
        required: ['targetIndex', 'name', 'isStage'],
        properties: {
          targetIndex: {
            type: 'integer',
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          name: { type: 'string', minLength: 1, maxLength: 8192 },
          isStage: { type: 'boolean' },
        },
      },
      blockRef: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'blockId'],
        properties: {
          target: { $ref: '#/$defs/targetRef' },
          blockId: { type: 'string', minLength: 1, maxLength: 8192 },
        },
      },
      variableRef: declarationReferenceSchema('variable'),
      listRef: declarationReferenceSchema('list'),
      broadcastRef: declarationReferenceSchema('broadcast'),
      referenceSite: {
        type: 'object',
        additionalProperties: false,
        required: ['container', 'name'],
        properties: {
          container: { enum: ['input', 'field'] },
          name: { type: 'string', minLength: 1, maxLength: 8192 },
        },
      },
      literal: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'value'],
            properties: {
              kind: {
                enum: [
                  'number',
                  'positive-number',
                  'positive-integer',
                  'integer',
                  'angle',
                ],
              },
              value: {
                oneOf: [
                  { type: 'string', maxLength: 8192 },
                  { type: 'number' },
                ],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'value'],
            properties: {
              kind: { enum: ['color'] },
              value: { type: 'string', maxLength: 8192 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'value'],
            properties: {
              kind: { enum: ['text'] },
              value: {
                oneOf: [
                  { type: 'string', maxLength: 8192 },
                  { type: 'number' },
                ],
              },
            },
          },
        ],
      },
      repairInput: {
        oneOf: [
          { $ref: '#/$defs/literal' },
          { $ref: '#/$defs/variableRef' },
          { $ref: '#/$defs/listRef' },
          { $ref: '#/$defs/broadcastRef' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'block'],
            properties: {
              kind: { enum: ['reporter', 'boolean'] },
              block: { $ref: '#/$defs/blockSpec' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'blocks'],
            properties: {
              kind: { const: 'substack' },
              blocks: {
                type: 'array',
                maxItems: maxNewBlocks,
                items: { $ref: '#/$defs/blockSpec' },
              },
            },
          },
        ],
      },
      repairField: {
        oneOf: [
          {
            oneOf: [
              { type: 'string', maxLength: 8192 },
              { type: 'number' },
              { type: 'null' },
            ],
          },
          { $ref: '#/$defs/variableRef' },
          { $ref: '#/$defs/listRef' },
          { $ref: '#/$defs/broadcastRef' },
        ],
      },
      blockSpec: {
        type: 'object',
        additionalProperties: false,
        required: ['opcode'],
        properties: {
          opcode: { type: 'string', minLength: 1, maxLength: 8192 },
          inputs: {
            type: 'object',
            maxProperties: 128,
            propertyNames: { minLength: 1, maxLength: 8192 },
            additionalProperties: { $ref: '#/$defs/repairInput' },
          },
          fields: {
            type: 'object',
            maxProperties: 128,
            propertyNames: { minLength: 1, maxLength: 8192 },
            additionalProperties: { $ref: '#/$defs/repairField' },
          },
        },
      },
    },
  }
}

export function operationSchema(
  allowedKinds: readonly string[],
  maxNewBlocks = 16,
  allowedTargetProperties: readonly string[] = []
): object
{
  const schema = proposalSchema(
    allowedKinds,
    1,
    maxNewBlocks,
    allowedTargetProperties
  ) as {
    $schema: string
    $comment: string
    properties: { operations: { items: object } }
    $defs: Record<string, object>
  }
  return {
    $schema: schema.$schema,
    $comment: schema.$comment,
    ...schema.properties.operations.items,
    $defs: schema.$defs,
  }
}
