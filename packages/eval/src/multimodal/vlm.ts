// packages/eval/src/multimodal/vlm.ts
// provider-neutral VLM request, budget, telemetry, & immutable replay contracts

import {
  canonicalMultimodalJson,
  detachedFrozenMultimodalRecord,
  hashMultimodalContent,
  hashMultimodalJson,
  MULTIMODAL_SCHEMA_VERSION,
} from './multimodal-contracts.js'
import type {
  RawRubricJudgmentV1,
  RubricJudgmentV1,
  RubricSpecV1,
} from './rubric.js'
import { RUBRIC_JUDGMENT_JSON_SCHEMA, validateRubricSpec } from './rubric.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

export const VLM_REQUEST_KEY_PREFIX = 'multimodal-vlm-v1:' as const
export const MAX_VLM_IMAGES = 120
export const MAX_VLM_CLIPS = 2
export const MAX_VLM_CLIP_BYTES = 25 * 1024 * 1024
export const MAX_VLM_SUBMITTED_MEDIA_BYTES = MAX_VLM_CLIPS * MAX_VLM_CLIP_BYTES
export const MAX_VLM_PROMPT_BYTES = 256 * 1024
export const VLM_OUTPUT_SCHEMA_ID = 'rubric-judgment-schema' as const
export const VLM_OUTPUT_SCHEMA_VERSION = '1' as const

export type VlmRequestKey = `${typeof VLM_REQUEST_KEY_PREFIX}${string}`
type VlmImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
type VlmImageDetail = 'low' | 'high' | 'original'

export interface VlmProviderDescriptor
{
  adapter: string
  provider: string
  model: string
  version: string
}

export interface VlmIdentityBindingV1
{
  id: string
  version: string
  sha256: string
}

export interface VlmFrameBindingV1
{
  evidenceId: string
  frameId: string
  clipId: string | null
  tick: number
  mimeType: VlmImageMimeType
  bytes: number
  sha256: string
  width: number
  height: number
  detail: VlmImageDetail
}

interface VlmEvidenceBindingV1
{
  sha256: string
  frameCount: number
  clipIds: string[]
  submittedMediaBytes: number
}

interface VlmCriterionEvidenceBindingV1
{
  criterionId: string
  frameIds: string[]
}

interface VlmPromptBindingV1
{
  template: VlmIdentityBindingV1
  renderedSha256: string
  rubricSha256: string
  evidenceSha256: string
  criterionEvidenceSha256: string
  selectedCriterionIds: string[]
}

export interface VlmGenerationBindingV1
{
  temperature: number | null
  maxOutputTokens: number
}

export interface VlmContextBindingV1
{
  artifactSha256: string
  scenarioSha256: string
  observationPlanSha256: string
  observationTraceSha256: string
  sampleOrdinal: number
}

export interface VlmRequestBindingV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  context: VlmContextBindingV1
  selectedCriterionIds: string[]
  criterionEvidence: VlmCriterionEvidenceBindingV1[]
  rubric: VlmIdentityBindingV1
  evidence: VlmEvidenceBindingV1
  prompt: VlmPromptBindingV1
  outputSchema: VlmIdentityBindingV1
  frames: VlmFrameBindingV1[]
  provider: VlmProviderDescriptor
  generation: VlmGenerationBindingV1
}

interface VlmAdapterImage
{
  binding: Readonly<VlmFrameBindingV1>
  bytes: Uint8Array
}

export interface VlmAdapterRequest
{
  requestKey: VlmRequestKey
  requestSha256: string
  binding: Readonly<VlmRequestBindingV1>
  prompt: string
  outputSchema: Readonly<unknown>
  images: VlmAdapterImage[]
}

export interface VlmAdapterEstimateRequest
{
  requestKey: VlmRequestKey
  requestSha256: string
  binding: Readonly<VlmRequestBindingV1>
  prompt: string
  outputSchema: Readonly<unknown>
  images: ReadonlyArray<{ binding: Readonly<VlmFrameBindingV1> }>
}

export type VlmAdapterAdmission =
  { accepted: true; reason: null } | { accepted: false; reason: string }

interface PrepareVlmRequestInput
{
  context: VlmContextBindingV1
  mediaAdmission: {
    maxSubmittedMediaBytes: number
    maxUniqueClips: number
  }
  rubric: RubricSpecV1
  rubricSha256: string
  selectedCriterionIds: string[]
  criterionEvidence: VlmCriterionEvidenceBindingV1[]
  prompt: {
    template: VlmIdentityBindingV1
    templateText: string
  }
  outputSchema: {
    identity: VlmIdentityBindingV1
    value: unknown
  }
  provider: VlmProviderDescriptor
  generation: VlmGenerationBindingV1
  images: VlmAdapterImage[]
}

type VlmRequestPreparationIssueCode =
  | 'invalid-value'
  | 'duplicate-id'
  | 'hash-mismatch'
  | 'byte-length-mismatch'
  | 'dimension-mismatch'
  | 'unsupported-media'

interface VlmRequestPreparationIssue
{
  path: string
  code: VlmRequestPreparationIssueCode
  message: string
}

class VlmRequestPreparationError extends Error
{
  readonly issues: readonly VlmRequestPreparationIssue[]

  constructor(issues: readonly VlmRequestPreparationIssue[])
  {
    super(
      `VLM request preparation failed: ${issues
        .map((current) => `${current.path} ${current.message}`)
        .join('; ')}`
    )
    this.name = 'VlmRequestPreparationError'
    this.issues = detachedFrozenMultimodalRecord([...issues])
  }
}

interface RenderTrustedVlmPromptInput
{
  template: VlmIdentityBindingV1
  templateText: string
  rubric: RubricSpecV1
  rubricSha256: string
  selectedCriterionIds: string[]
  criterionEvidence: VlmCriterionEvidenceBindingV1[]
  frames: VlmFrameBindingV1[]
  outputSchema: VlmIdentityBindingV1
}

export interface VlmUsage
{
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  available: boolean
  unavailableReason: string | null
}

export interface VlmRequestEstimate
{
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  usd: number | null
  pricingTableVersion: string | null
  unavailableReason: string | null
}

interface VlmAdapterErrorV1
{
  code: string
  message: string
  retryable: boolean
}

interface VlmAdapterResponseBase
{
  responseId: string | null
  model: string
  latencyMs: number
  usage: VlmUsage
  billedCostUsd: number | null
}

interface VlmAdapterCompletedResponse extends VlmAdapterResponseBase
{
  outcome: 'completed'
  raw: unknown
  error: null
}

interface VlmAdapterIncompleteResponse extends VlmAdapterResponseBase
{
  outcome: 'refused' | 'truncated' | 'provider-error'
  raw: unknown | null
  error: VlmAdapterErrorV1
}

export type VlmAdapterResponse =
  VlmAdapterCompletedResponse | VlmAdapterIncompleteResponse

export interface VlmCostRecord
{
  billedUsd: number | null
  estimatedUsd: number | null
  accountedUsd: number | null
  pricingTableVersion: string | null
  source: 'billed' | 'estimated' | 'unavailable' | 'replay-zero'
  unavailableReason: string | null
}

export interface VlmBudgetV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  maxCalls: number
  maxSubmittedMediaBytes: number
  maxInputTokens: number | null
  maxCumulativeOutputTokens: number
  maxCostUsd: number | null
  maxUniqueClips: number
}

export type VlmBudgetOverrunReason =
  | 'call-limit'
  | 'media-byte-limit'
  | 'clip-limit'
  | 'input-token-limit'
  | 'output-token-limit'
  | 'cost-limit'
  | 'input-token-estimate-unavailable'
  | 'cost-estimate-unavailable'
  | 'settlement-overrun'

export interface VlmBudgetStateV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  liveCallsReserved: number
  liveCallsAttempted: number
  liveCallsSettled: number
  submittedMediaBytes: number
  submittedClipIds: string[]
  chargedInputTokens: number | null
  chargedOutputTokens: number
  chargedCostUsd: number | null
  observedInputTokens: number | null
  observedOutputTokens: number | null
  observedTotalTokens: number | null
  billedCostUsd: number | null
  estimatedCostUsd: number | null
  overrunReasons: VlmBudgetOverrunReason[]
}

export type VlmCallOutcome =
  | 'completed'
  | 'refused'
  | 'truncated'
  | 'provider-error'
  | 'invalid-response'
  | 'budget-overrun'

export interface VlmCallErrorV1
{
  code: string
  message: string
  retryable: boolean
}

export interface VlmRecordedLiveTelemetryV1
{
  descriptor: VlmProviderDescriptor
  responseModel: string | null
  outcome: VlmCallOutcome
  responseSha256: string | null
  latencyMs: number
  usage: VlmUsage
  estimate: VlmRequestEstimate
  cost: VlmCostRecord
  error: VlmCallErrorV1 | null
}

interface VlmCallRecordBaseV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  requestKey: VlmRequestKey
  requestSha256: string
  responseSha256: string | null
  descriptor: VlmProviderDescriptor
  responseModel: string | null
  outcome: VlmCallOutcome
  error: VlmCallErrorV1 | null
  latencyMs: number
  usage: VlmUsage
  estimate: VlmRequestEstimate
  cost: VlmCostRecord
}

export interface VlmLiveCallRecordV1 extends VlmCallRecordBaseV1
{
  mode: 'live'
  providerCallCount: 1
  replaySourceSha256: null
  originalLive: null
}

export interface VlmReplayCallRecordV1 extends VlmCallRecordBaseV1
{
  mode: 'replay'
  providerCallCount: 0
  replaySourceSha256: string
  originalLive: VlmRecordedLiveTelemetryV1
}

export type VlmCallRecordV1 = VlmLiveCallRecordV1 | VlmReplayCallRecordV1

interface VlmReplayRecordV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  key: VlmRequestKey
  requestBinding: VlmRequestBindingV1
  requestSha256: string
  rawJudgment: RawRubricJudgmentV1
  normalizedJudgment: RubricJudgmentV1
  liveCall: VlmLiveCallRecordV1
  liveBudget: {
    policy: VlmBudgetV1
    before: VlmBudgetStateV1
    after: VlmBudgetStateV1
  }
}

export interface VlmReplayEntryV1
{
  record: VlmReplayRecordV1
  recordSha256: string
}

export interface VlmReplayStore
{
  read(key: VlmRequestKey): Promise<unknown | null>
  writeExclusive(entry: Readonly<VlmReplayEntryV1>): Promise<void>
}

export interface VlmAdapter
{
  readonly descriptor: Readonly<VlmProviderDescriptor>
  admit(request: VlmAdapterEstimateRequest): VlmAdapterAdmission
  estimateCost(request: VlmAdapterEstimateRequest): VlmRequestEstimate
  // * trusted adapters settle promptly when the supplied abort signal fires
  evaluate(
    request: VlmAdapterRequest,
    signal: AbortSignal
  ): Promise<VlmAdapterResponse>
}

const UINT8_ARRAY_SET = Uint8Array.prototype.set
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength'
)!.get!

export function copyVlmBytes(bytes: Uint8Array): Uint8Array
{
  const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, bytes, []) as number
  const copy = new Uint8Array(byteLength)
  Reflect.apply(UINT8_ARRAY_SET, copy, [bytes])
  return copy
}

function preparationIssue(
  issues: VlmRequestPreparationIssue[],
  path: string,
  code: VlmRequestPreparationIssueCode,
  message: string
): void
{
  issues.push({ path, code, message })
}

function validHash(value: string): boolean
{
  return /^[0-9a-f]{64}$/.test(value)
}

function validateIdentity(
  value: VlmIdentityBindingV1,
  path: string,
  issues: VlmRequestPreparationIssue[]
): void
{
  if (value.id.length === 0 || value.id.length > 128)
    preparationIssue(
      issues,
      `${path}.id`,
      'invalid-value',
      'identity ID must contain 1..128 characters'
    )
  if (value.version.length === 0 || value.version.length > 128)
    preparationIssue(
      issues,
      `${path}.version`,
      'invalid-value',
      'identity version must contain 1..128 characters'
    )
  if (!validHash(value.sha256))
    preparationIssue(
      issues,
      `${path}.sha256`,
      'invalid-value',
      'identity hash must be a lowercase SHA-256 digest'
    )
}

function readUint24Le(bytes: Uint8Array, offset: number): number
{
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function readUint16Be(bytes: Uint8Array, offset: number): number
{
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readUint16Le(bytes: Uint8Array, offset: number): number
{
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32Be(bytes: Uint8Array, offset: number): number
{
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  )
}

function pngDimensions(
  bytes: Uint8Array
): { width: number; height: number } | null
{
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (
    bytes.byteLength < 24 ||
    signature.some((value, index) => bytes[index] !== value) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
  )
    return null
  return {
    width: readUint32Be(bytes, 16),
    height: readUint32Be(bytes, 20),
  }
}

function jpegDimensions(
  bytes: Uint8Array
): { width: number; height: number } | null
{
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return null
  let offset = 2
  while (offset + 3 < bytes.byteLength)
  {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]!
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 1 >= bytes.byteLength) return null
    const segmentBytes = readUint16Be(bytes, offset)
    if (segmentBytes < 2 || offset + segmentBytes > bytes.byteLength)
      return null
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame)
    {
      if (segmentBytes < 7) return null
      return {
        width: readUint16Be(bytes, offset + 5),
        height: readUint16Be(bytes, offset + 3),
      }
    }
    offset += segmentBytes
  }
  return null
}

function webpDimensions(
  bytes: Uint8Array
): { width: number; height: number } | null
{
  if (
    bytes.byteLength < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP'
  )
    return null
  const kind = String.fromCharCode(...bytes.subarray(12, 16))
  if (kind === 'VP8X')
    return {
      width: readUint24Le(bytes, 24) + 1,
      height: readUint24Le(bytes, 27) + 1,
    }
  if (kind === 'VP8L')
  {
    if (bytes[20] !== 0x2f) return null
    const packed =
      bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    }
  }
  if (
    kind === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  )
    return {
      width: readUint16Le(bytes, 26) & 0x3fff,
      height: readUint16Le(bytes, 28) & 0x3fff,
    }
  return null
}

function encodedImageDimensions(
  mimeType: VlmImageMimeType,
  bytes: Uint8Array
): { width: number; height: number } | null
{
  if (mimeType === 'image/png') return pngDimensions(bytes)
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  return webpDimensions(bytes)
}

export function inspectVlmImageDimensions(
  mimeType: VlmImageMimeType,
  bytes: Uint8Array
): { width: number; height: number } | null
{
  return encodedImageDimensions(mimeType, copyVlmBytes(bytes))
}

function validateProvider(
  provider: VlmProviderDescriptor,
  issues: VlmRequestPreparationIssue[]
): void
{
  for (const key of ['adapter', 'provider', 'model', 'version'] as const)
  {
    const value = provider[key]
    if (value.length === 0 || value.length > 256)
      preparationIssue(
        issues,
        `$.provider.${key}`,
        'invalid-value',
        `${key} must contain 1..256 characters`
      )
  }
}

function validateGeneration(
  generation: VlmGenerationBindingV1,
  issues: VlmRequestPreparationIssue[]
): void
{
  if (
    generation.temperature !== null &&
    (!Number.isFinite(generation.temperature) ||
      generation.temperature < 0 ||
      generation.temperature > 2)
  )
    preparationIssue(
      issues,
      '$.generation.temperature',
      'invalid-value',
      'temperature must be null or a finite number from 0 through 2'
    )
  if (
    !Number.isSafeInteger(generation.maxOutputTokens) ||
    generation.maxOutputTokens <= 0
  )
    preparationIssue(
      issues,
      '$.generation.maxOutputTokens',
      'invalid-value',
      'max output tokens must be a positive safe integer'
    )
}

function validateContext(
  context: VlmContextBindingV1,
  issues: VlmRequestPreparationIssue[]
): void
{
  for (const key of [
    'artifactSha256',
    'scenarioSha256',
    'observationPlanSha256',
    'observationTraceSha256',
  ] as const)
  {
    if (!validHash(context[key]))
      preparationIssue(
        issues,
        `$.context.${key}`,
        'invalid-value',
        `${key} must be a lowercase SHA-256 digest`
      )
  }
  if (!Number.isSafeInteger(context.sampleOrdinal) || context.sampleOrdinal < 0)
    preparationIssue(
      issues,
      '$.context.sampleOrdinal',
      'invalid-value',
      'sample ordinal must be a non-negative safe integer'
    )
}

function validateFrame(
  image: VlmAdapterImage,
  index: number,
  issues: VlmRequestPreparationIssue[]
): VlmAdapterImage | null
{
  const path = `$.images[${index}]`
  const binding = image.binding
  if (!(image.bytes instanceof Uint8Array))
  {
    preparationIssue(
      issues,
      `${path}.bytes`,
      'invalid-value',
      'image bytes must be a Uint8Array'
    )
    return null
  }
  let bytes: Uint8Array
  try
  {
    bytes = copyVlmBytes(image.bytes)
  }
  catch
  {
    preparationIssue(
      issues,
      `${path}.bytes`,
      'invalid-value',
      'image bytes do not have a readable typed-array backing store'
    )
    return null
  }
  if (binding.evidenceId.length === 0 || binding.evidenceId.length > 256)
    preparationIssue(
      issues,
      `${path}.binding.evidenceId`,
      'invalid-value',
      'evidence ID must contain 1..256 characters'
    )
  if (binding.frameId.length === 0 || binding.frameId.length > 256)
    preparationIssue(
      issues,
      `${path}.binding.frameId`,
      'invalid-value',
      'frame ID must contain 1..256 characters'
    )
  if (
    binding.clipId !== null &&
    (binding.clipId.length === 0 || binding.clipId.length > 256)
  )
    preparationIssue(
      issues,
      `${path}.binding.clipId`,
      'invalid-value',
      'clip ID must be null or contain 1..256 characters'
    )
  if (!Number.isSafeInteger(binding.tick) || binding.tick < 0)
    preparationIssue(
      issues,
      `${path}.binding.tick`,
      'invalid-value',
      'tick must be a non-negative safe integer'
    )
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(binding.mimeType))
    preparationIssue(
      issues,
      `${path}.binding.mimeType`,
      'unsupported-media',
      'only PNG, JPEG, and WebP images are supported'
    )
  if (!['low', 'high', 'original'].includes(binding.detail))
    preparationIssue(
      issues,
      `${path}.binding.detail`,
      'invalid-value',
      'unknown image detail value'
    )
  if (binding.bytes !== bytes.byteLength)
    preparationIssue(
      issues,
      `${path}.binding.bytes`,
      'byte-length-mismatch',
      'declared byte length does not match the supplied image'
    )
  if (
    !validHash(binding.sha256) ||
    binding.sha256 !== hashMultimodalContent(bytes)
  )
    preparationIssue(
      issues,
      `${path}.binding.sha256`,
      'hash-mismatch',
      'declared hash does not match the supplied image'
    )
  const dimensions = encodedImageDimensions(binding.mimeType, bytes)
  if (!dimensions)
    preparationIssue(
      issues,
      `${path}.bytes`,
      'unsupported-media',
      'image bytes do not contain a supported encoded image header'
    )
  else if (
    dimensions.width !== binding.width ||
    dimensions.height !== binding.height
  )
    preparationIssue(
      issues,
      `${path}.binding`,
      'dimension-mismatch',
      'declared dimensions do not match the supplied image'
    )
  if (
    !Number.isSafeInteger(binding.width) ||
    binding.width <= 0 ||
    !Number.isSafeInteger(binding.height) ||
    binding.height <= 0
  )
    preparationIssue(
      issues,
      `${path}.binding`,
      'invalid-value',
      'image dimensions must be positive safe integers'
    )
  return { binding, bytes }
}

export function renderTrustedVlmPrompt(
  input: RenderTrustedVlmPromptInput
): string
{
  const framesById = new Map(
    input.frames.map((frame, index) => [
      frame.frameId,
      { imageOrdinal: index + 1, frame },
    ])
  )
  const selected = new Set(input.selectedCriterionIds)
  const payload = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    promptTemplate: input.template,
    rubric: {
      id: input.rubric.id,
      version: input.rubric.version,
      sha256: input.rubricSha256,
      objective: input.rubric.objective,
      criteria: input.rubric.criteria
        .filter((criterion) => selected.has(criterion.id))
        .map((criterion) => ({
          id: criterion.id,
          requirement: criterion.requirement,
          evidenceKind: criterion.evidenceKind,
          description: criterion.description,
          passAnchors: criterion.passAnchors,
          failAnchors: criterion.failAnchors,
        })),
    },
    evidenceByCriterion: input.criterionEvidence.map((entry) => ({
      criterionId: entry.criterionId,
      frames: entry.frameIds.map((frameId) =>
      {
        const admitted = framesById.get(frameId)!
        return {
          imageOrdinal: admitted.imageOrdinal,
          evidenceId: admitted.frame.evidenceId,
          frameId: admitted.frame.frameId,
          clipId: admitted.frame.clipId,
          tick: admitted.frame.tick,
          mimeType: admitted.frame.mimeType,
          width: admitted.frame.width,
          height: admitted.frame.height,
          detail: admitted.frame.detail,
          sha256: admitted.frame.sha256,
        }
      }),
    })),
    outputSchema: input.outputSchema,
    constraints: [
      'judge every selected criterion exactly once and in rubric order',
      'use only the frames mapped to that criterion',
      'cite only the supplied evidenceId, frameId, and tick values',
      'mark uncertainty or insufficient evidence inconclusive',
      'return only an object satisfying the bound output schema',
    ],
  }
  return `${input.templateText}\n\nTrusted Multimodal context (canonical JSON):\n${canonicalMultimodalJson(payload)}`
}

export function prepareVlmRequest(
  input: PrepareVlmRequestInput
): VlmAdapterRequest
{
  const issues: VlmRequestPreparationIssue[] = []
  const rubricValidation = validateRubricSpec(input.rubric)
  if (!rubricValidation.ok)
    for (const issue of rubricValidation.issues)
      preparationIssue(
        issues,
        `$.rubric${issue.path === '$' ? '' : issue.path.slice(1)}`,
        issue.code === 'duplicate-id' ? 'duplicate-id' : 'invalid-value',
        issue.message
      )
  const actualRubricSha256 = hashMultimodalJson(input.rubric)
  if (
    !validHash(input.rubricSha256) ||
    input.rubricSha256 !== actualRubricSha256
  )
    preparationIssue(
      issues,
      '$.rubricSha256',
      'hash-mismatch',
      'declared rubric hash does not match the supplied rubric'
    )

  if (
    input.selectedCriterionIds.length === 0 ||
    input.selectedCriterionIds.length > input.rubric.criteria.length
  )
    preparationIssue(
      issues,
      '$.selectedCriterionIds',
      'invalid-value',
      'selected criteria must be a non-empty rubric subset'
    )
  const rubricCriterionIds = new Set(
    input.rubric.criteria.map((criterion) => criterion.id)
  )
  const selectedCriterionIds = new Set<string>()
  input.selectedCriterionIds.forEach((criterionId, index) =>
  {
    if (!rubricCriterionIds.has(criterionId))
      preparationIssue(
        issues,
        `$.selectedCriterionIds[${index}]`,
        'invalid-value',
        'selected criterion is not present in the rubric'
      )
    if (selectedCriterionIds.has(criterionId))
      preparationIssue(
        issues,
        `$.selectedCriterionIds[${index}]`,
        'duplicate-id',
        'selected criterion IDs must be unique'
      )
    selectedCriterionIds.add(criterionId)
  })
  const orderedSelection = input.rubric.criteria
    .filter((criterion) => selectedCriterionIds.has(criterion.id))
    .map((criterion) => criterion.id)
  if (
    orderedSelection.length !== input.selectedCriterionIds.length ||
    orderedSelection.some(
      (criterionId, index) => criterionId !== input.selectedCriterionIds[index]
    )
  )
    preparationIssue(
      issues,
      '$.selectedCriterionIds',
      'invalid-value',
      'selected criteria must retain their trusted rubric order'
    )
  if (
    !input.rubric.criteria.some(
      (criterion) =>
        criterion.requirement === 'required' &&
        selectedCriterionIds.has(criterion.id)
    )
  )
    preparationIssue(
      issues,
      '$.selectedCriterionIds',
      'invalid-value',
      'selected criteria must include at least one required criterion'
    )

  validateContext(input.context, issues)
  validateIdentity(input.prompt.template, '$.prompt.template', issues)
  const actualTemplateSha256 =
    typeof input.prompt.templateText === 'string'
      ? hashMultimodalContent(input.prompt.templateText)
      : null
  if (
    actualTemplateSha256 !== null &&
    input.prompt.template.sha256 !== actualTemplateSha256
  )
    preparationIssue(
      issues,
      '$.prompt.template.sha256',
      'hash-mismatch',
      'declared template hash does not match the supplied template'
    )
  if (
    typeof input.prompt.templateText !== 'string' ||
    input.prompt.templateText.trim().length === 0
  )
    preparationIssue(
      issues,
      '$.prompt.templateText',
      'invalid-value',
      'prompt template text must not be empty'
    )
  if (
    typeof input.prompt.templateText === 'string' &&
    Buffer.byteLength(input.prompt.templateText, 'utf8') > MAX_VLM_PROMPT_BYTES
  )
    preparationIssue(
      issues,
      '$.prompt.templateText',
      'invalid-value',
      `prompt template exceeds ${MAX_VLM_PROMPT_BYTES} bytes`
    )

  validateIdentity(
    input.outputSchema.identity,
    '$.outputSchema.identity',
    issues
  )
  if (
    input.outputSchema.identity.id !== VLM_OUTPUT_SCHEMA_ID ||
    input.outputSchema.identity.version !== VLM_OUTPUT_SCHEMA_VERSION
  )
    preparationIssue(
      issues,
      '$.outputSchema.identity',
      'invalid-value',
      'Multimodal requires the canonical rubric judgment schema identity'
    )
  let actualOutputSchemaSha256: string | null = null
  try
  {
    actualOutputSchemaSha256 = hashMultimodalJson(input.outputSchema.value)
  }
  catch (error)
  {
    preparationIssue(
      issues,
      '$.outputSchema.value',
      'invalid-value',
      unknownErrorMessage(error)
    )
  }
  if (
    actualOutputSchemaSha256 !== null &&
    input.outputSchema.identity.sha256 !== actualOutputSchemaSha256
  )
    preparationIssue(
      issues,
      '$.outputSchema.identity.sha256',
      'hash-mismatch',
      'declared schema hash does not match the supplied output schema'
    )
  const canonicalOutputSchemaSha256 = hashMultimodalJson(
    RUBRIC_JUDGMENT_JSON_SCHEMA
  )
  if (
    actualOutputSchemaSha256 !== null &&
    actualOutputSchemaSha256 !== canonicalOutputSchemaSha256
  )
    preparationIssue(
      issues,
      '$.outputSchema.value',
      'invalid-value',
      'Multimodal requires the canonical rubric judgment output schema'
    )

  validateProvider(input.provider, issues)
  validateGeneration(input.generation, issues)
  if (
    !Number.isSafeInteger(input.mediaAdmission.maxSubmittedMediaBytes) ||
    input.mediaAdmission.maxSubmittedMediaBytes < 0 ||
    input.mediaAdmission.maxSubmittedMediaBytes > MAX_VLM_SUBMITTED_MEDIA_BYTES
  )
    preparationIssue(
      issues,
      '$.mediaAdmission.maxSubmittedMediaBytes',
      'invalid-value',
      `media admission must be 0..${MAX_VLM_SUBMITTED_MEDIA_BYTES} bytes`
    )
  if (
    !Number.isSafeInteger(input.mediaAdmission.maxUniqueClips) ||
    input.mediaAdmission.maxUniqueClips < 0 ||
    input.mediaAdmission.maxUniqueClips > MAX_VLM_CLIPS
  )
    preparationIssue(
      issues,
      '$.mediaAdmission.maxUniqueClips',
      'invalid-value',
      `clip admission must be 0..${MAX_VLM_CLIPS}`
    )
  if (input.images.length === 0 || input.images.length > MAX_VLM_IMAGES)
    preparationIssue(
      issues,
      '$.images',
      'invalid-value',
      `image count must be 1..${MAX_VLM_IMAGES}`
    )
  const images =
    input.images.length > 0 && input.images.length <= MAX_VLM_IMAGES
      ? input.images.flatMap((image, index) =>
        {
          const validated = validateFrame(image, index, issues)
          return validated ? [validated] : []
        })
      : []
  let declaredMediaBytes = 0
  const bytesByClip = new Map<string, number>()
  for (const image of images)
  {
    declaredMediaBytes += image.bytes.byteLength
    const clipKey = image.binding.clipId ?? '\u0000unclipped'
    const clipBytes = (bytesByClip.get(clipKey) ?? 0) + image.bytes.byteLength
    bytesByClip.set(clipKey, clipBytes)
    if (!Number.isSafeInteger(declaredMediaBytes))
    {
      declaredMediaBytes = MAX_VLM_SUBMITTED_MEDIA_BYTES + 1
      break
    }
  }
  if ([...bytesByClip.values()].some((bytes) => bytes > MAX_VLM_CLIP_BYTES))
    preparationIssue(
      issues,
      '$.images',
      'invalid-value',
      `submitted evidence exceeds ${MAX_VLM_CLIP_BYTES} bytes in one clip`
    )
  if (
    declaredMediaBytes > MAX_VLM_SUBMITTED_MEDIA_BYTES ||
    declaredMediaBytes > input.mediaAdmission.maxSubmittedMediaBytes
  )
    preparationIssue(
      issues,
      '$.images',
      'invalid-value',
      'submitted media exceeds its trusted admission limit'
    )
  const declaredClipIds = new Set(
    images.flatMap((image) =>
      image.binding.clipId === null ? [] : [image.binding.clipId]
    )
  )
  if (
    declaredClipIds.size > MAX_VLM_CLIPS ||
    declaredClipIds.size > input.mediaAdmission.maxUniqueClips
  )
    preparationIssue(
      issues,
      '$.images',
      'invalid-value',
      'submitted evidence exceeds its trusted unique-clip admission limit'
    )
  const frameIds = new Set<string>()
  const evidenceFrameIds = new Set<string>()
  for (let index = 0; index < images.length; index++)
  {
    const binding = images[index]!.binding
    const pair = `${binding.evidenceId}\u0000${binding.frameId}`
    if (frameIds.has(binding.frameId) || evidenceFrameIds.has(pair))
      preparationIssue(
        issues,
        `$.images[${index}].binding.frameId`,
        'duplicate-id',
        'frame IDs must be unique across the ordered evidence set'
      )
    frameIds.add(binding.frameId)
    evidenceFrameIds.add(pair)
  }
  if (input.criterionEvidence.length !== input.selectedCriterionIds.length)
    preparationIssue(
      issues,
      '$.criterionEvidence',
      'invalid-value',
      'criterion evidence must cover every selected criterion exactly once'
    )
  const mappedFrameIds = new Set<string>()
  input.criterionEvidence.forEach((entry, index) =>
  {
    const path = `$.criterionEvidence[${index}]`
    if (entry.criterionId !== input.selectedCriterionIds[index])
      preparationIssue(
        issues,
        `${path}.criterionId`,
        'invalid-value',
        'criterion evidence must retain selected rubric order'
      )
    if (entry.frameIds.length === 0 || entry.frameIds.length > MAX_VLM_IMAGES)
      preparationIssue(
        issues,
        `${path}.frameIds`,
        'invalid-value',
        `criterion evidence needs 1..${MAX_VLM_IMAGES} frames`
      )
    const currentFrameIds = new Set<string>()
    entry.frameIds.forEach((frameId, frameIndex) =>
    {
      if (currentFrameIds.has(frameId))
        preparationIssue(
          issues,
          `${path}.frameIds[${frameIndex}]`,
          'duplicate-id',
          'criterion frame IDs must be unique'
        )
      if (!frameIds.has(frameId))
        preparationIssue(
          issues,
          `${path}.frameIds[${frameIndex}]`,
          'invalid-value',
          'criterion evidence references an unsubmitted frame'
        )
      currentFrameIds.add(frameId)
      mappedFrameIds.add(frameId)
    })
  })
  for (const frameId of frameIds)
  {
    if (!mappedFrameIds.has(frameId))
      preparationIssue(
        issues,
        '$.criterionEvidence',
        'invalid-value',
        `submitted frame ${frameId} is unrelated to every selected criterion`
      )
  }
  if (issues.length > 0) throw new VlmRequestPreparationError(issues)

  const frames = images.map((image) => ({ ...image.binding }))
  const evidenceSha256 = hashMultimodalJson(frames)
  const clipIds = [
    ...new Set(
      frames.flatMap((frame) => (frame.clipId === null ? [] : [frame.clipId]))
    ),
  ]
  const evidence: VlmEvidenceBindingV1 = {
    sha256: evidenceSha256,
    frameCount: frames.length,
    clipIds,
    submittedMediaBytes: frames.reduce(
      (total, frame) => total + frame.bytes,
      0
    ),
  }
  const criterionEvidence = input.criterionEvidence.map((entry) => ({
    criterionId: entry.criterionId,
    frameIds: [...entry.frameIds],
  }))
  const renderedPrompt = renderTrustedVlmPrompt({
    template: { ...input.prompt.template },
    templateText: input.prompt.templateText,
    rubric: input.rubric,
    rubricSha256: actualRubricSha256,
    selectedCriterionIds: [...input.selectedCriterionIds],
    criterionEvidence,
    frames,
    outputSchema: { ...input.outputSchema.identity },
  })
  if (Buffer.byteLength(renderedPrompt, 'utf8') > MAX_VLM_PROMPT_BYTES)
    throw new VlmRequestPreparationError([
      {
        path: '$.prompt',
        code: 'invalid-value',
        message: `rendered prompt exceeds ${MAX_VLM_PROMPT_BYTES} bytes`,
      },
    ])
  const actualRenderedSha256 = hashMultimodalContent(renderedPrompt)
  const criterionEvidenceSha256 = hashMultimodalJson(criterionEvidence)
  const prompt: VlmPromptBindingV1 = {
    template: { ...input.prompt.template },
    renderedSha256: actualRenderedSha256,
    rubricSha256: actualRubricSha256,
    evidenceSha256,
    criterionEvidenceSha256,
    selectedCriterionIds: [...input.selectedCriterionIds],
  }
  const binding: VlmRequestBindingV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    context: { ...input.context },
    selectedCriterionIds: [...input.selectedCriterionIds],
    criterionEvidence,
    rubric: {
      id: input.rubric.id,
      version: input.rubric.version,
      sha256: actualRubricSha256,
    },
    evidence,
    prompt,
    outputSchema: { ...input.outputSchema.identity },
    frames,
    provider: { ...input.provider },
    generation: { ...input.generation },
  }
  const frozenBinding = detachedFrozenMultimodalRecord(binding)
  const requestSha256 = hashMultimodalJson(frozenBinding)
  const requestKey =
    `${VLM_REQUEST_KEY_PREFIX}${requestSha256}` as VlmRequestKey
  return {
    requestKey,
    requestSha256,
    binding: frozenBinding,
    prompt: renderedPrompt,
    outputSchema: detachedFrozenMultimodalRecord(input.outputSchema.value),
    images: images.map((image, index) => ({
      binding: frozenBinding.frames[index]!,
      bytes: image.bytes,
    })),
  }
}

export function hashVlmReplayRecord(record: VlmReplayRecordV1): string
{
  return hashMultimodalJson(record)
}
