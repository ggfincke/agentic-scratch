// packages/eval/src/multimodal/vlm-evaluator.ts
// budgeted live VLM execution & exact zero-network replay validation

import { withHostNetworkAccess } from '@scratch-agent/runner'

import {
  canonicalMultimodalJson,
  detachedFrozenMultimodalRecord,
  hashMultimodalContent,
  hashMultimodalJson,
  MULTIMODAL_SCHEMA_VERSION,
} from './multimodal-contracts.js'
import {
  normalizeRubricJudgment,
  parseRawRubricJudgment,
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  validateRubricSpec,
  type RawRubricJudgmentV1,
  type RubricJudgmentProvenanceV1,
  type RubricJudgmentV1,
  type RubricSpecV1,
} from './rubric.js'
import {
  copyVlmBytes,
  hashVlmReplayRecord,
  inspectVlmImageDimensions,
  MAX_VLM_CLIP_BYTES,
  MAX_VLM_CLIPS,
  MAX_VLM_IMAGES,
  MAX_VLM_PROMPT_BYTES,
  MAX_VLM_SUBMITTED_MEDIA_BYTES,
  renderTrustedVlmPrompt,
  type VlmAdapter,
  type VlmAdapterEstimateRequest,
  type VlmAdapterRequest,
  type VlmAdapterResponse,
  type VlmBudgetOverrunReason,
  type VlmBudgetStateV1,
  type VlmBudgetV1,
  type VlmCallErrorV1,
  type VlmCallOutcome,
  type VlmCostRecord,
  type VlmLiveCallRecordV1,
  type VlmProviderDescriptor,
  type VlmRecordedLiveTelemetryV1,
  type VlmReplayCallRecordV1,
  type VlmReplayEntryV1,
  type VlmReplayStore,
  type VlmRequestEstimate,
  type VlmUsage,
  VLM_REQUEST_KEY_PREFIX,
  VLM_OUTPUT_SCHEMA_ID,
  VLM_OUTPUT_SCHEMA_VERSION,
} from './vlm.js'

const HASH_PATTERN = /^[0-9a-f]{64}$/
type JsonRecord = Record<string, unknown>

interface VlmBudgetReservationV1
{
  requestSha256: string
  callOrdinal: number
  submittedMediaBytes: number
  submittedClipIds: string[]
  before: VlmBudgetStateV1
  after: VlmBudgetStateV1
  estimate: VlmRequestEstimate
  reservedInputTokens: number | null
  reservedOutputTokens: number
  reservedCostUsd: number | null
}

type VlmBudgetReservationResult =
  | {
      ok: true
      state: Readonly<VlmBudgetStateV1>
      reservation: Readonly<VlmBudgetReservationV1>
    }
  | {
      ok: false
      state: Readonly<VlmBudgetStateV1>
      reasons: VlmBudgetOverrunReason[]
    }

interface VlmBudgetSettlementV1
{
  state: Readonly<VlmBudgetStateV1>
  cost: Readonly<VlmCostRecord>
}

interface VlmExecutionIssueV1
{
  code: string
  responsibility: 'provider' | 'policy' | 'infrastructure' | 'replay'
  message: string
}

interface VlmExecutionResultBaseV1
{
  mode: 'live' | 'replay'
  budget: Readonly<VlmBudgetStateV1>
  issue: Readonly<VlmExecutionIssueV1> | null
}

interface VlmCompletedExecutionV1 extends VlmExecutionResultBaseV1
{
  outcome: 'completed'
  judgment: Readonly<RubricJudgmentV1>
  call: Readonly<VlmLiveCallRecordV1 | VlmReplayCallRecordV1>
  replayEntry: Readonly<VlmReplayEntryV1> | null
}

interface VlmInconclusiveExecutionV1 extends VlmExecutionResultBaseV1
{
  outcome: 'inconclusive'
  judgment: null
  call: Readonly<VlmLiveCallRecordV1> | null
  replayEntry: null
}

type VlmExecutionResultV1 =
  VlmCompletedExecutionV1 | VlmInconclusiveExecutionV1

interface ExecuteLiveVlmInput
{
  rubric: RubricSpecV1
  request: VlmAdapterRequest
  budget: VlmBudgetV1
  budgetState: VlmBudgetStateV1
  adapter: VlmAdapter
  replayStore: VlmReplayStore
  timeoutMs?: number
}

interface ExecuteReplayVlmInput
{
  rubric: RubricSpecV1
  request: VlmAdapterRequest
  budgetState: VlmBudgetStateV1
  replayStore: VlmReplayStore
}

function plainRecord(value: unknown, name: string): JsonRecord
{
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error(`${name} must be a plain object`)
  return value as JsonRecord
}

function exactKeys(
  value: JsonRecord,
  name: string,
  expected: readonly string[]
): void
{
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  )
    throw new Error(`${name} has an unexpected object shape`)
}

function nonemptyString(value: unknown, name: string, max = 2048): string
{
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new Error(`${name} must be a bounded nonempty string`)
  return value
}

function nullableString(
  value: unknown,
  name: string,
  max = 2048
): string | null
{
  if (value === null) return null
  return nonemptyString(value, name, max)
}

function hashString(value: unknown, name: string): string
{
  if (typeof value !== 'string' || !HASH_PATTERN.test(value))
    throw new Error(`${name} must be a lowercase SHA-256 digest`)
  return value
}

function nonnegativeInteger(value: unknown, name: string): number
{
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${name} must be a non-negative safe integer`)
  return value as number
}

function nullableNonnegativeInteger(
  value: unknown,
  name: string
): number | null
{
  if (value === null) return null
  return nonnegativeInteger(value, name)
}

function nonnegativeNumber(value: unknown, name: string): number
{
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be a non-negative finite number`)
  return Object.is(value, -0) ? 0 : value
}

function nullableNonnegativeNumber(
  value: unknown,
  name: string
): number | null
{
  if (value === null) return null
  return nonnegativeNumber(value, name)
}

function booleanValue(value: unknown, name: string): boolean
{
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`)
  return value
}

function sameJson(left: unknown, right: unknown): boolean
{
  return canonicalMultimodalJson(left) === canonicalMultimodalJson(right)
}

function descriptor(value: unknown, name: string): VlmProviderDescriptor
{
  const record = plainRecord(value, name)
  exactKeys(record, name, ['adapter', 'provider', 'model', 'version'])
  return {
    adapter: nonemptyString(record.adapter, `${name}.adapter`, 256),
    provider: nonemptyString(record.provider, `${name}.provider`, 256),
    model: nonemptyString(record.model, `${name}.model`, 256),
    version: nonemptyString(record.version, `${name}.version`, 256),
  }
}

function requestEstimate(value: unknown, name: string): VlmRequestEstimate
{
  const record = plainRecord(value, name)
  exactKeys(record, name, [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'usd',
    'pricingTableVersion',
    'unavailableReason',
  ])
  const result: VlmRequestEstimate = {
    inputTokens: nullableNonnegativeInteger(
      record.inputTokens,
      `${name}.inputTokens`
    ),
    outputTokens: nullableNonnegativeInteger(
      record.outputTokens,
      `${name}.outputTokens`
    ),
    totalTokens: nullableNonnegativeInteger(
      record.totalTokens,
      `${name}.totalTokens`
    ),
    usd: nullableNonnegativeNumber(record.usd, `${name}.usd`),
    pricingTableVersion: nullableString(
      record.pricingTableVersion,
      `${name}.pricingTableVersion`,
      256
    ),
    unavailableReason: nullableString(
      record.unavailableReason,
      `${name}.unavailableReason`
    ),
  }
  if (
    result.inputTokens !== null &&
    result.outputTokens !== null &&
    result.totalTokens !== result.inputTokens + result.outputTokens
  )
    throw new Error(`${name}.totalTokens does not equal input plus output`)
  if (result.usd !== null && result.pricingTableVersion === null)
    throw new Error(`${name} has an unversioned dollar estimate`)
  if (
    (result.inputTokens === null ||
      result.outputTokens === null ||
      result.totalTokens === null ||
      result.usd === null) &&
    result.unavailableReason === null
  )
    throw new Error(`${name} needs a reason for unavailable estimates`)
  if (
    result.inputTokens !== null &&
    result.outputTokens !== null &&
    result.totalTokens !== null &&
    result.usd !== null &&
    result.unavailableReason !== null
  )
    throw new Error(`${name} cannot retain an unavailable estimate reason`)
  return detachedFrozenMultimodalRecord(result)
}

function usage(value: unknown, name: string): VlmUsage
{
  const record = plainRecord(value, name)
  exactKeys(record, name, [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'available',
    'unavailableReason',
  ])
  const result: VlmUsage = {
    inputTokens: nullableNonnegativeInteger(
      record.inputTokens,
      `${name}.inputTokens`
    ),
    outputTokens: nullableNonnegativeInteger(
      record.outputTokens,
      `${name}.outputTokens`
    ),
    totalTokens: nullableNonnegativeInteger(
      record.totalTokens,
      `${name}.totalTokens`
    ),
    available: booleanValue(record.available, `${name}.available`),
    unavailableReason: nullableString(
      record.unavailableReason,
      `${name}.unavailableReason`
    ),
  }
  if (result.available)
  {
    if (
      result.inputTokens === null ||
      result.outputTokens === null ||
      result.totalTokens === null ||
      result.unavailableReason !== null
    )
      throw new Error(`${name} has inconsistent available usage`)
    if (result.totalTokens !== result.inputTokens + result.outputTokens)
      throw new Error(`${name}.totalTokens does not equal input plus output`)
  }
  else if (
    result.inputTokens !== null ||
    result.outputTokens !== null ||
    result.totalTokens !== null ||
    result.unavailableReason === null
  )
    throw new Error(`${name} has inconsistent unavailable usage`)
  return detachedFrozenMultimodalRecord(result)
}

function callError(value: unknown, name: string): VlmCallErrorV1
{
  const record = plainRecord(value, name)
  exactKeys(record, name, ['code', 'message', 'retryable'])
  return {
    code: nonemptyString(record.code, `${name}.code`, 128),
    message: nonemptyString(record.message, `${name}.message`, 2048),
    retryable: booleanValue(record.retryable, `${name}.retryable`),
  }
}

function costRecord(value: unknown, name: string): VlmCostRecord
{
  const record = plainRecord(value, name)
  exactKeys(record, name, [
    'billedUsd',
    'estimatedUsd',
    'accountedUsd',
    'pricingTableVersion',
    'source',
    'unavailableReason',
  ])
  const result: VlmCostRecord = {
    billedUsd: nullableNonnegativeNumber(record.billedUsd, `${name}.billedUsd`),
    estimatedUsd: nullableNonnegativeNumber(
      record.estimatedUsd,
      `${name}.estimatedUsd`
    ),
    accountedUsd: nullableNonnegativeNumber(
      record.accountedUsd,
      `${name}.accountedUsd`
    ),
    pricingTableVersion: nullableString(
      record.pricingTableVersion,
      `${name}.pricingTableVersion`,
      256
    ),
    source: nonemptyString(
      record.source,
      `${name}.source`,
      32
    ) as VlmCostRecord['source'],
    unavailableReason: nullableString(
      record.unavailableReason,
      `${name}.unavailableReason`
    ),
  }
  if (
    !['billed', 'estimated', 'unavailable', 'replay-zero'].includes(
      result.source
    )
  )
    throw new Error(`${name}.source is invalid`)
  if (result.source === 'billed')
  {
    if (
      result.billedUsd === null ||
      result.accountedUsd !== result.billedUsd ||
      result.unavailableReason !== null
    )
      throw new Error(`${name} has inconsistent billed cost`)
  }
  else if (result.source === 'estimated')
  {
    if (
      result.billedUsd !== null ||
      result.estimatedUsd === null ||
      result.accountedUsd !== result.estimatedUsd ||
      result.pricingTableVersion === null ||
      result.unavailableReason !== null
    )
      throw new Error(`${name} has inconsistent estimated cost`)
  }
  else if (result.source === 'unavailable')
  {
    if (
      result.billedUsd !== null ||
      result.estimatedUsd !== null ||
      result.accountedUsd !== null ||
      result.unavailableReason === null
    )
      throw new Error(`${name} has inconsistent unavailable cost`)
  }
  else if (
    result.billedUsd !== null ||
    result.estimatedUsd !== null ||
    result.accountedUsd !== 0 ||
    result.pricingTableVersion !== null ||
    result.unavailableReason !== null
  )
    throw new Error(`${name} has inconsistent replay cost`)
  return detachedFrozenMultimodalRecord(result)
}

export function validateVlmBudget(budget: VlmBudgetV1): Readonly<VlmBudgetV1>
{
  const record = plainRecord(budget, 'budget')
  exactKeys(record, 'budget', [
    'schemaVersion',
    'maxCalls',
    'maxSubmittedMediaBytes',
    'maxInputTokens',
    'maxCumulativeOutputTokens',
    'maxCostUsd',
    'maxUniqueClips',
  ])
  if (budget.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    throw new Error('budget schema version is unsupported')
  nonnegativeInteger(budget.maxCalls, 'budget.maxCalls')
  nonnegativeInteger(
    budget.maxSubmittedMediaBytes,
    'budget.maxSubmittedMediaBytes'
  )
  nullableNonnegativeInteger(budget.maxInputTokens, 'budget.maxInputTokens')
  nonnegativeInteger(
    budget.maxCumulativeOutputTokens,
    'budget.maxCumulativeOutputTokens'
  )
  nullableNonnegativeNumber(budget.maxCostUsd, 'budget.maxCostUsd')
  nonnegativeInteger(budget.maxUniqueClips, 'budget.maxUniqueClips')
  return detachedFrozenMultimodalRecord(budget)
}

export function validateVlmBudgetState(
  state: VlmBudgetStateV1
): Readonly<VlmBudgetStateV1>
{
  const record = plainRecord(state, 'budget state')
  exactKeys(record, 'budget state', [
    'schemaVersion',
    'liveCallsReserved',
    'liveCallsAttempted',
    'liveCallsSettled',
    'submittedMediaBytes',
    'submittedClipIds',
    'chargedInputTokens',
    'chargedOutputTokens',
    'chargedCostUsd',
    'observedInputTokens',
    'observedOutputTokens',
    'observedTotalTokens',
    'billedCostUsd',
    'estimatedCostUsd',
    'overrunReasons',
  ])
  if (state.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    throw new Error('budget state schema version is unsupported')
  nonnegativeInteger(state.liveCallsReserved, 'budget state liveCallsReserved')
  nonnegativeInteger(
    state.liveCallsAttempted,
    'budget state liveCallsAttempted'
  )
  nonnegativeInteger(state.liveCallsSettled, 'budget state liveCallsSettled')
  if (
    state.liveCallsSettled > state.liveCallsAttempted ||
    state.liveCallsAttempted > state.liveCallsReserved
  )
    throw new Error('budget state live-call counts are inconsistent')
  nonnegativeInteger(
    state.submittedMediaBytes,
    'budget state submittedMediaBytes'
  )
  if (!Array.isArray(state.submittedClipIds))
    throw new Error('budget state submittedClipIds must be an array')
  const submittedClipIds = new Set<string>()
  state.submittedClipIds.forEach((clipId, index) =>
  {
    nonemptyString(clipId, `budget state submittedClipIds[${index}]`, 256)
    if (submittedClipIds.has(clipId))
      throw new Error('budget state contains a duplicate submitted clip ID')
    submittedClipIds.add(clipId)
  })
  nullableNonnegativeInteger(
    state.chargedInputTokens,
    'budget state chargedInputTokens'
  )
  nonnegativeInteger(
    state.chargedOutputTokens,
    'budget state chargedOutputTokens'
  )
  nullableNonnegativeNumber(state.chargedCostUsd, 'budget state chargedCostUsd')
  nullableNonnegativeInteger(
    state.observedInputTokens,
    'budget state observedInputTokens'
  )
  nullableNonnegativeInteger(
    state.observedOutputTokens,
    'budget state observedOutputTokens'
  )
  nullableNonnegativeInteger(
    state.observedTotalTokens,
    'budget state observedTotalTokens'
  )
  if (
    state.observedInputTokens !== null &&
    state.observedOutputTokens !== null &&
    state.observedTotalTokens !== null &&
    state.observedTotalTokens !==
      state.observedInputTokens + state.observedOutputTokens
  )
    throw new Error('budget state observed token totals are inconsistent')
  nullableNonnegativeNumber(state.billedCostUsd, 'budget state billedCostUsd')
  nullableNonnegativeNumber(
    state.estimatedCostUsd,
    'budget state estimatedCostUsd'
  )
  if (!Array.isArray(state.overrunReasons))
    throw new Error('budget state overrunReasons must be an array')
  const reasons = new Set<VlmBudgetOverrunReason>()
  for (const reason of state.overrunReasons)
  {
    if (reason !== 'settlement-overrun')
      throw new Error('budget state contains an invalid overrun reason')
    if (reasons.has(reason))
      throw new Error('budget state contains a duplicate overrun reason')
    reasons.add(reason)
  }
  return detachedFrozenMultimodalRecord(state)
}

export function validateVlmBudgetAccounting(
  budget: VlmBudgetV1,
  state: VlmBudgetStateV1
): {
  budget: Readonly<VlmBudgetV1>
  state: Readonly<VlmBudgetStateV1>
}
{
  const policy = validateVlmBudget(budget)
  const accounting = validateVlmBudgetState(state)
  if (
    accounting.liveCallsReserved > policy.maxCalls ||
    accounting.submittedMediaBytes > policy.maxSubmittedMediaBytes ||
    accounting.submittedClipIds.length > policy.maxUniqueClips
  )
    throw new Error('budget state exceeds a non-overrunnable policy limit')
  if (accounting.overrunReasons.length === 0)
  {
    if (
      (policy.maxInputTokens !== null &&
        (accounting.chargedInputTokens === null ||
          accounting.chargedInputTokens > policy.maxInputTokens)) ||
      accounting.chargedOutputTokens > policy.maxCumulativeOutputTokens ||
      (policy.maxCostUsd !== null &&
        (accounting.chargedCostUsd === null ||
          accounting.chargedCostUsd > policy.maxCostUsd))
    )
      throw new Error('budget state exceeds policy without an overrun marker')
  }
  return { budget: policy, state: accounting }
}

function emptyVlmBudgetState(): Readonly<VlmBudgetStateV1>
{
  return detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    liveCallsReserved: 0,
    liveCallsAttempted: 0,
    liveCallsSettled: 0,
    submittedMediaBytes: 0,
    submittedClipIds: [],
    chargedInputTokens: 0,
    chargedOutputTokens: 0,
    chargedCostUsd: 0,
    observedInputTokens: 0,
    observedOutputTokens: 0,
    observedTotalTokens: 0,
    billedCostUsd: 0,
    estimatedCostUsd: 0,
    overrunReasons: [],
  })
}

export function createVlmBudgetState(
  budget: VlmBudgetV1
): Readonly<VlmBudgetStateV1>
{
  validateVlmBudget(budget)
  return emptyVlmBudgetState()
}

function identityBinding(
  value: unknown,
  name: string
): { id: string; version: string; sha256: string }
{
  const record = plainRecord(value, name)
  exactKeys(record, name, ['id', 'version', 'sha256'])
  return {
    id: nonemptyString(record.id, `${name}.id`, 256),
    version: nonemptyString(record.version, `${name}.version`, 256),
    sha256: hashString(record.sha256, `${name}.sha256`),
  }
}

function assertPreparedRequest(request: VlmAdapterRequest): void
{
  const record = plainRecord(request, 'prepared VLM request')
  exactKeys(record, 'prepared VLM request', [
    'requestKey',
    'requestSha256',
    'binding',
    'prompt',
    'outputSchema',
    'images',
  ])
  const bindingRecord = plainRecord(request.binding, 'VLM request binding')
  exactKeys(bindingRecord, 'VLM request binding', [
    'schemaVersion',
    'context',
    'selectedCriterionIds',
    'criterionEvidence',
    'rubric',
    'evidence',
    'prompt',
    'outputSchema',
    'frames',
    'provider',
    'generation',
  ])
  if (request.binding.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    throw new Error('prepared VLM request schema version is unsupported')
  const context = plainRecord(request.binding.context, 'VLM request context')
  exactKeys(context, 'VLM request context', [
    'artifactSha256',
    'scenarioSha256',
    'observationPlanSha256',
    'observationTraceSha256',
    'sampleOrdinal',
  ])
  hashString(context.artifactSha256, 'VLM context artifact hash')
  hashString(context.scenarioSha256, 'VLM context scenario hash')
  hashString(context.observationPlanSha256, 'VLM context observation-plan hash')
  hashString(
    context.observationTraceSha256,
    'VLM context observation-trace hash'
  )
  nonnegativeInteger(context.sampleOrdinal, 'VLM context sample ordinal')
  descriptor(request.binding.provider, 'VLM request provider')
  const rubric = identityBinding(request.binding.rubric, 'VLM request rubric')
  const evidence = plainRecord(request.binding.evidence, 'VLM request evidence')
  exactKeys(evidence, 'VLM request evidence', [
    'sha256',
    'frameCount',
    'clipIds',
    'submittedMediaBytes',
  ])
  hashString(evidence.sha256, 'VLM request evidence.sha256')
  nonnegativeInteger(evidence.frameCount, 'VLM request evidence.frameCount')
  nonnegativeInteger(
    evidence.submittedMediaBytes,
    'VLM request evidence.submittedMediaBytes'
  )
  if (!Array.isArray(evidence.clipIds))
    throw new Error('VLM request evidence.clipIds must be an array')
  const evidenceClipIds = new Set<string>()
  evidence.clipIds.forEach((clipId, index) =>
  {
    const parsed = nonemptyString(
      clipId,
      `VLM request evidence.clipIds[${index}]`,
      256
    )
    if (evidenceClipIds.has(parsed))
      throw new Error('VLM request evidence contains a duplicate clip ID')
    evidenceClipIds.add(parsed)
  })
  if (evidenceClipIds.size > MAX_VLM_CLIPS)
    throw new Error('prepared VLM request exceeds the hard clip-count bound')
  const prompt = plainRecord(request.binding.prompt, 'VLM request prompt')
  exactKeys(prompt, 'VLM request prompt', [
    'template',
    'renderedSha256',
    'rubricSha256',
    'evidenceSha256',
    'criterionEvidenceSha256',
    'selectedCriterionIds',
  ])
  identityBinding(prompt.template, 'VLM request prompt.template')
  hashString(prompt.renderedSha256, 'VLM request prompt.renderedSha256')
  hashString(prompt.rubricSha256, 'VLM request prompt.rubricSha256')
  hashString(prompt.evidenceSha256, 'VLM request prompt.evidenceSha256')
  hashString(
    prompt.criterionEvidenceSha256,
    'VLM request prompt.criterionEvidenceSha256'
  )
  if (!Array.isArray(prompt.selectedCriterionIds))
    throw new Error('VLM request prompt selected criteria must be an array')
  const outputSchema = identityBinding(
    request.binding.outputSchema,
    'VLM request output schema'
  )
  if (
    outputSchema.id !== VLM_OUTPUT_SCHEMA_ID ||
    outputSchema.version !== VLM_OUTPUT_SCHEMA_VERSION ||
    outputSchema.sha256 !== hashMultimodalJson(RUBRIC_JUDGMENT_JSON_SCHEMA)
  )
    throw new Error('VLM request output schema is not canonical')
  const generation = plainRecord(
    request.binding.generation,
    'VLM request generation'
  )
  exactKeys(generation, 'VLM request generation', [
    'temperature',
    'maxOutputTokens',
  ])
  if (
    generation.temperature !== null &&
    (typeof generation.temperature !== 'number' ||
      !Number.isFinite(generation.temperature) ||
      generation.temperature < 0 ||
      generation.temperature > 2)
  )
    throw new Error('VLM request temperature must be null or 0..2')
  if (
    !Number.isSafeInteger(generation.maxOutputTokens) ||
    (generation.maxOutputTokens as number) <= 0
  )
    throw new Error('VLM request max output tokens must be a positive integer')
  if (!Array.isArray(request.binding.selectedCriterionIds))
    throw new Error('prepared VLM selected criteria must be an array')
  if (
    !Array.isArray(request.binding.criterionEvidence) ||
    !Array.isArray(request.binding.frames) ||
    !Array.isArray(request.images)
  )
    throw new Error('prepared VLM frames and images must be arrays')
  if (
    request.binding.frames.length === 0 ||
    request.binding.frames.length > MAX_VLM_IMAGES ||
    request.images.length === 0 ||
    request.images.length > MAX_VLM_IMAGES
  )
    throw new Error('prepared VLM request exceeds the hard image-count bound')
  nonemptyString(request.prompt, 'prepared VLM prompt', MAX_VLM_PROMPT_BYTES)
  if (Buffer.byteLength(request.prompt, 'utf8') > MAX_VLM_PROMPT_BYTES)
    throw new Error('prepared VLM request exceeds the hard prompt-byte bound')
  const selectedCriterionIds = new Set<string>()
  request.binding.selectedCriterionIds.forEach((criterionId, index) =>
  {
    const parsed = nonemptyString(
      criterionId,
      `prepared VLM selectedCriterionIds[${index}]`,
      256
    )
    if (selectedCriterionIds.has(parsed))
      throw new Error('prepared VLM selected criteria contain a duplicate ID')
    selectedCriterionIds.add(parsed)
  })
  if (selectedCriterionIds.size === 0)
    throw new Error('prepared VLM selected criteria must not be empty')
  const actualRequestSha256 = hashMultimodalJson(request.binding)
  if (request.requestSha256 !== actualRequestSha256)
    throw new Error('prepared VLM request binding hash changed')
  if (request.requestKey !== `${VLM_REQUEST_KEY_PREFIX}${actualRequestSha256}`)
    throw new Error('prepared VLM request key changed')
  if (
    request.binding.prompt.renderedSha256 !==
    hashMultimodalContent(request.prompt)
  )
    throw new Error('prepared VLM prompt hash changed')
  if (
    request.binding.outputSchema.sha256 !==
    hashMultimodalJson(request.outputSchema)
  )
    throw new Error('prepared VLM output schema hash changed')
  if (rubric.sha256 !== request.binding.prompt.rubricSha256)
    throw new Error('prepared VLM rubric binding is inconsistent')
  if (request.binding.evidence.sha256 !== request.binding.prompt.evidenceSha256)
    throw new Error('prepared VLM evidence binding is inconsistent')
  if (
    request.binding.prompt.criterionEvidenceSha256 !==
    hashMultimodalJson(request.binding.criterionEvidence)
  )
    throw new Error('prepared VLM criterion evidence hash changed')
  if (
    !sameJson(
      request.binding.selectedCriterionIds,
      request.binding.prompt.selectedCriterionIds
    )
  )
    throw new Error('prepared VLM criterion selection is inconsistent')
  if (request.images.length !== request.binding.frames.length)
    throw new Error('prepared VLM image count changed')
  const frameIds = new Set<string>()
  const evidenceFrameIds = new Set<string>()
  const bytesByClip = new Map<string, number>()
  let submittedMediaBytes = 0
  request.images.forEach((image, index) =>
  {
    const frame = request.binding.frames[index]!
    const frameRecord = plainRecord(frame, `prepared VLM frame ${index}`)
    exactKeys(frameRecord, `prepared VLM frame ${index}`, [
      'evidenceId',
      'frameId',
      'clipId',
      'tick',
      'mimeType',
      'bytes',
      'sha256',
      'width',
      'height',
      'detail',
    ])
    const evidenceId = nonemptyString(
      frame.evidenceId,
      `prepared VLM frame ${index}.evidenceId`,
      256
    )
    const frameId = nonemptyString(
      frame.frameId,
      `prepared VLM frame ${index}.frameId`,
      256
    )
    if (frame.clipId !== null)
      nonemptyString(frame.clipId, `prepared VLM frame ${index}.clipId`, 256)
    nonnegativeInteger(frame.tick, `prepared VLM frame ${index}.tick`)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(frame.mimeType))
      throw new Error(`prepared VLM frame ${index} has unsupported media`)
    const declaredBytes = nonnegativeInteger(
      frame.bytes,
      `prepared VLM frame ${index}.bytes`
    )
    if (declaredBytes === 0)
      throw new Error(`prepared VLM frame ${index} has no image bytes`)
    hashString(frame.sha256, `prepared VLM frame ${index}.sha256`)
    const width = nonnegativeInteger(
      frame.width,
      `prepared VLM frame ${index}.width`
    )
    const height = nonnegativeInteger(
      frame.height,
      `prepared VLM frame ${index}.height`
    )
    if (width === 0 || height === 0)
      throw new Error(`prepared VLM frame ${index} has invalid dimensions`)
    if (!['low', 'high', 'original'].includes(frame.detail))
      throw new Error(`prepared VLM frame ${index} has invalid detail`)
    if (!sameJson(image.binding, frame))
      throw new Error(`prepared VLM image ${index} binding changed`)
    if (!(image.bytes instanceof Uint8Array))
      throw new Error(`prepared VLM image ${index} bytes are invalid`)
    let bytes: Uint8Array
    try
    {
      bytes = copyVlmBytes(image.bytes)
    }
    catch
    {
      throw new Error(
        `prepared VLM image ${index} has an unreadable typed-array backing store`
      )
    }
    if (bytes.byteLength !== declaredBytes)
      throw new Error(`prepared VLM image ${index} byte length changed`)
    submittedMediaBytes += bytes.byteLength
    if (
      !Number.isSafeInteger(submittedMediaBytes) ||
      submittedMediaBytes > MAX_VLM_SUBMITTED_MEDIA_BYTES
    )
      throw new Error('prepared VLM request exceeds the hard media-byte bound')
    const clipKey = frame.clipId ?? '\u0000unclipped'
    const clipBytes = (bytesByClip.get(clipKey) ?? 0) + bytes.byteLength
    if (!Number.isSafeInteger(clipBytes) || clipBytes > MAX_VLM_CLIP_BYTES)
      throw new Error(
        'prepared VLM request exceeds the hard per-clip byte bound'
      )
    bytesByClip.set(clipKey, clipBytes)
    if (hashMultimodalContent(bytes) !== frame.sha256)
      throw new Error(`prepared VLM image ${index} bytes changed`)
    const dimensions = inspectVlmImageDimensions(frame.mimeType, bytes)
    if (
      !dimensions ||
      dimensions.width !== width ||
      dimensions.height !== height
    )
      throw new Error(`prepared VLM image ${index} dimensions changed`)
    if (frameIds.has(frameId))
      throw new Error('prepared VLM frame IDs must be unique')
    const evidenceFrameId = `${evidenceId}\u0000${frameId}`
    if (evidenceFrameIds.has(evidenceFrameId))
      throw new Error('prepared VLM evidence/frame identities must be unique')
    frameIds.add(frameId)
    evidenceFrameIds.add(evidenceFrameId)
  })
  if (submittedMediaBytes > MAX_VLM_SUBMITTED_MEDIA_BYTES)
    throw new Error('prepared VLM request exceeds the hard media-byte bound')
  if ([...bytesByClip.values()].some((bytes) => bytes > MAX_VLM_CLIP_BYTES))
    throw new Error('prepared VLM request exceeds the hard per-clip byte bound')
  if (
    request.binding.evidence.sha256 !==
    hashMultimodalJson(request.binding.frames)
  )
    throw new Error('prepared VLM evidence hash changed')
  if (request.binding.evidence.frameCount !== request.binding.frames.length)
    throw new Error('prepared VLM evidence frame count changed')
  if (request.binding.evidence.submittedMediaBytes !== submittedMediaBytes)
    throw new Error('prepared VLM evidence byte count changed')
  const clipIds = [
    ...new Set(
      request.binding.frames.flatMap((frame) =>
        frame.clipId === null ? [] : [frame.clipId]
      )
    ),
  ]
  if (!sameJson(request.binding.evidence.clipIds, clipIds))
    throw new Error('prepared VLM evidence clip IDs changed')
  if (
    request.binding.criterionEvidence.length !==
    request.binding.selectedCriterionIds.length
  )
    throw new Error('prepared VLM criterion evidence coverage changed')
  const mappedFrameIds = new Set<string>()
  request.binding.criterionEvidence.forEach((entry, index) =>
  {
    const entryRecord = plainRecord(
      entry,
      `prepared VLM criterion evidence ${index}`
    )
    exactKeys(entryRecord, `prepared VLM criterion evidence ${index}`, [
      'criterionId',
      'frameIds',
    ])
    nonemptyString(
      entry.criterionId,
      `prepared VLM criterion evidence ${index}.criterionId`,
      256
    )
    if (!Array.isArray(entry.frameIds))
      throw new Error('prepared VLM criterion frame IDs must be an array')
    entry.frameIds.forEach((frameId, frameIndex) =>
      nonemptyString(
        frameId,
        `prepared VLM criterion evidence ${index}.frameIds[${frameIndex}]`,
        256
      )
    )
    if (
      entry.criterionId !== request.binding.selectedCriterionIds[index] ||
      entry.frameIds.length === 0 ||
      new Set(entry.frameIds).size !== entry.frameIds.length ||
      entry.frameIds.some(
        (frameId) =>
          !request.binding.frames.some((frame) => frame.frameId === frameId)
      )
    )
      throw new Error('prepared VLM criterion evidence binding changed')
    entry.frameIds.forEach((frameId) => mappedFrameIds.add(frameId))
  })
  if (mappedFrameIds.size !== request.binding.frames.length)
    throw new Error('prepared VLM request contains unrelated evidence frames')
}

function assertRequestRubric(
  request: VlmAdapterRequest,
  rubric: RubricSpecV1
): void
{
  const rubricSha256 = hashMultimodalJson(rubric)
  if (
    request.binding.rubric.id !== rubric.id ||
    request.binding.rubric.version !== rubric.version ||
    request.binding.rubric.sha256 !== rubricSha256
  )
    throw new Error('prepared VLM request does not bind the trusted rubric')
  const selected = new Set(request.binding.selectedCriterionIds)
  const expectedOrder = rubric.criteria
    .filter((criterion) => selected.has(criterion.id))
    .map((criterion) => criterion.id)
  if (
    selected.size !== request.binding.selectedCriterionIds.length ||
    !sameJson(expectedOrder, request.binding.selectedCriterionIds) ||
    request.binding.selectedCriterionIds.some(
      (criterionId) =>
        !rubric.criteria.some((criterion) => criterion.id === criterionId)
    )
  )
    throw new Error('prepared VLM request has an invalid criterion selection')
  if (
    !rubric.criteria.some(
      (criterion) =>
        criterion.requirement === 'required' && selected.has(criterion.id)
    )
  )
    throw new Error('prepared VLM request has no required criterion')
  const promptSuffix = renderTrustedVlmPrompt({
    template: request.binding.prompt.template,
    templateText: '',
    rubric,
    rubricSha256,
    selectedCriterionIds: [...request.binding.selectedCriterionIds],
    criterionEvidence: request.binding.criterionEvidence.map((entry) => ({
      criterionId: entry.criterionId,
      frameIds: [...entry.frameIds],
    })),
    frames: request.binding.frames.map((frame) => ({ ...frame })),
    outputSchema: request.binding.outputSchema,
  })
  if (!request.prompt.endsWith(promptSuffix))
    throw new Error('prepared VLM prompt does not contain the trusted payload')
  const templateText = request.prompt.slice(0, -promptSuffix.length)
  if (
    templateText.trim().length === 0 ||
    Buffer.byteLength(templateText, 'utf8') > MAX_VLM_PROMPT_BYTES ||
    hashMultimodalContent(templateText) !==
      request.binding.prompt.template.sha256
  )
    throw new Error('prepared VLM prompt template text is not trusted')
  const expectedPrompt = renderTrustedVlmPrompt({
    template: request.binding.prompt.template,
    templateText,
    rubric,
    rubricSha256,
    selectedCriterionIds: [...request.binding.selectedCriterionIds],
    criterionEvidence: request.binding.criterionEvidence.map((entry) => ({
      criterionId: entry.criterionId,
      frameIds: [...entry.frameIds],
    })),
    frames: request.binding.frames.map((frame) => ({ ...frame })),
    outputSchema: request.binding.outputSchema,
  })
  if (expectedPrompt !== request.prompt)
    throw new Error('prepared VLM prompt failed trusted re-rendering')
}

function cloneAdapterRequest(request: VlmAdapterRequest): VlmAdapterRequest
{
  const binding = detachedFrozenMultimodalRecord(request.binding)
  return {
    requestKey: request.requestKey,
    requestSha256: request.requestSha256,
    binding,
    prompt: request.prompt,
    outputSchema: detachedFrozenMultimodalRecord(request.outputSchema),
    images: request.images.map((image, index) => ({
      binding: binding.frames[index]!,
      bytes: copyVlmBytes(image.bytes),
    })),
  }
}

function estimateAdapterRequest(
  request: VlmAdapterRequest
): VlmAdapterEstimateRequest
{
  return {
    requestKey: request.requestKey,
    requestSha256: request.requestSha256,
    binding: request.binding,
    prompt: request.prompt,
    outputSchema: request.outputSchema,
    images: request.images.map((image) => ({ binding: image.binding })),
  }
}

function validateAdapterAdmission(
  value: unknown
): { accepted: true; reason: null } | { accepted: false; reason: string }
{
  const record = plainRecord(value, 'VLM adapter admission')
  exactKeys(record, 'VLM adapter admission', ['accepted', 'reason'])
  const accepted = booleanValue(record.accepted, 'VLM admission accepted')
  if (accepted)
  {
    if (record.reason !== null)
      throw new Error('accepted VLM admission cannot retain a reason')
    return { accepted: true, reason: null }
  }
  return {
    accepted: false,
    reason: nonemptyString(record.reason, 'VLM admission reason'),
  }
}

function addReason(
  reasons: VlmBudgetOverrunReason[],
  reason: VlmBudgetOverrunReason
): void
{
  if (!reasons.includes(reason)) reasons.push(reason)
}

function reserveVlmBudget(
  budget: VlmBudgetV1,
  state: VlmBudgetStateV1,
  request: VlmAdapterRequest,
  estimateValue: VlmRequestEstimate
): VlmBudgetReservationResult
{
  const snapshot = validateVlmBudgetAccounting(budget, state)
  const policy = snapshot.budget
  const before = snapshot.state
  assertPreparedRequest(request)
  const estimate = requestEstimate(estimateValue, 'VLM cost estimate')
  if (
    estimate.outputTokens !== null &&
    estimate.outputTokens !== request.binding.generation.maxOutputTokens
  )
    throw new Error(
      'VLM estimate output tokens must equal the requested maximum'
    )
  const reasons: VlmBudgetOverrunReason[] = []
  if (before.overrunReasons.length > 0) addReason(reasons, 'settlement-overrun')
  if (before.liveCallsReserved + 1 > policy.maxCalls)
    addReason(reasons, 'call-limit')
  const mediaBytes = request.binding.evidence.submittedMediaBytes
  if (before.submittedMediaBytes + mediaBytes > policy.maxSubmittedMediaBytes)
    addReason(reasons, 'media-byte-limit')
  const submittedClipIds = [
    ...new Set([
      ...before.submittedClipIds,
      ...request.binding.evidence.clipIds,
    ]),
  ]
  if (submittedClipIds.length > policy.maxUniqueClips)
    addReason(reasons, 'clip-limit')
  if (policy.maxInputTokens !== null)
  {
    if (estimate.inputTokens === null)
      addReason(reasons, 'input-token-estimate-unavailable')
    else if (
      before.chargedInputTokens === null ||
      before.chargedInputTokens + estimate.inputTokens > policy.maxInputTokens
    )
      addReason(reasons, 'input-token-limit')
  }
  const reservedOutputTokens = request.binding.generation.maxOutputTokens
  if (
    before.chargedOutputTokens + reservedOutputTokens >
    policy.maxCumulativeOutputTokens
  )
    addReason(reasons, 'output-token-limit')
  if (policy.maxCostUsd !== null)
  {
    if (estimate.usd === null || estimate.pricingTableVersion === null)
      addReason(reasons, 'cost-estimate-unavailable')
    else if (
      before.chargedCostUsd === null ||
      before.chargedCostUsd + estimate.usd > policy.maxCostUsd
    )
      addReason(reasons, 'cost-limit')
  }
  if (reasons.length > 0) return { ok: false, state: before, reasons }

  const after = detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    liveCallsReserved: before.liveCallsReserved + 1,
    liveCallsAttempted: before.liveCallsAttempted,
    liveCallsSettled: before.liveCallsSettled,
    submittedMediaBytes: before.submittedMediaBytes + mediaBytes,
    submittedClipIds,
    chargedInputTokens:
      before.chargedInputTokens === null || estimate.inputTokens === null
        ? null
        : before.chargedInputTokens + estimate.inputTokens,
    chargedOutputTokens: before.chargedOutputTokens + reservedOutputTokens,
    chargedCostUsd:
      before.chargedCostUsd === null || estimate.usd === null
        ? null
        : before.chargedCostUsd + estimate.usd,
    observedInputTokens: before.observedInputTokens,
    observedOutputTokens: before.observedOutputTokens,
    observedTotalTokens: before.observedTotalTokens,
    billedCostUsd: before.billedCostUsd,
    estimatedCostUsd: before.estimatedCostUsd,
    overrunReasons: [...before.overrunReasons],
  } satisfies VlmBudgetStateV1)
  const reservation = detachedFrozenMultimodalRecord({
    requestSha256: request.requestSha256,
    callOrdinal: before.liveCallsReserved,
    submittedMediaBytes: mediaBytes,
    submittedClipIds: [...request.binding.evidence.clipIds],
    before,
    after,
    estimate,
    reservedInputTokens: estimate.inputTokens,
    reservedOutputTokens,
    reservedCostUsd: estimate.usd,
  } satisfies VlmBudgetReservationV1)
  return { ok: true, state: after, reservation }
}

function accountedTotal(
  before: number | null,
  actual: number | null,
  fallback: number | null
): number | null
{
  if (before === null) return null
  const current = actual ?? fallback
  return current === null ? null : before + current
}

function liveCost(
  estimate: VlmRequestEstimate,
  billedCostUsd: number | null
): VlmCostRecord
{
  if (billedCostUsd !== null)
    return {
      billedUsd: billedCostUsd,
      estimatedUsd: estimate.usd,
      accountedUsd: billedCostUsd,
      pricingTableVersion: estimate.pricingTableVersion,
      source: 'billed',
      unavailableReason: null,
    }
  if (estimate.usd !== null)
    return {
      billedUsd: null,
      estimatedUsd: estimate.usd,
      accountedUsd: estimate.usd,
      pricingTableVersion: estimate.pricingTableVersion,
      source: 'estimated',
      unavailableReason: null,
    }
  return {
    billedUsd: null,
    estimatedUsd: null,
    accountedUsd: null,
    pricingTableVersion: estimate.pricingTableVersion,
    source: 'unavailable',
    unavailableReason:
      estimate.unavailableReason ?? 'provider cost and estimate unavailable',
  }
}

function settleVlmBudget(
  budget: VlmBudgetV1,
  reservation: VlmBudgetReservationV1,
  usageValue: VlmUsage,
  billedCostUsdValue: number | null
): VlmBudgetSettlementV1
{
  const beforeSnapshot = validateVlmBudgetAccounting(budget, reservation.before)
  const policy = beforeSnapshot.budget
  const before = beforeSnapshot.state
  const after = validateVlmBudgetAccounting(policy, reservation.after).state
  const estimate = requestEstimate(reservation.estimate, 'reserved estimate')
  const reportedUsage = usage(usageValue, 'provider usage')
  const billedCostUsd = nullableNonnegativeNumber(
    billedCostUsdValue,
    'provider billed cost'
  )
  if (
    after.liveCallsReserved !== before.liveCallsReserved + 1 ||
    reservation.callOrdinal !== before.liveCallsReserved ||
    reservation.submittedMediaBytes !==
      after.submittedMediaBytes - before.submittedMediaBytes
  )
    throw new Error('budget reservation call count is inconsistent')
  const cost = detachedFrozenMultimodalRecord(liveCost(estimate, billedCostUsd))
  const chargedInputTokens = accountedTotal(
    before.chargedInputTokens,
    reportedUsage.inputTokens,
    reservation.reservedInputTokens
  )
  const chargedOutputTokens = accountedTotal(
    before.chargedOutputTokens,
    reportedUsage.outputTokens,
    reservation.reservedOutputTokens
  )!
  const chargedCostUsd = accountedTotal(
    before.chargedCostUsd,
    cost.accountedUsd,
    reservation.reservedCostUsd
  )
  const observedInputTokens = accountedTotal(
    before.observedInputTokens,
    reportedUsage.inputTokens,
    null
  )
  const observedOutputTokens = accountedTotal(
    before.observedOutputTokens,
    reportedUsage.outputTokens,
    null
  )
  const observedTotalTokens = accountedTotal(
    before.observedTotalTokens,
    reportedUsage.totalTokens,
    null
  )
  const billedCostTotal = accountedTotal(
    before.billedCostUsd,
    billedCostUsd,
    null
  )
  const estimatedCostTotal = accountedTotal(
    before.estimatedCostUsd,
    estimate.usd,
    null
  )
  const overrunReasons = [...after.overrunReasons]
  if (
    (policy.maxInputTokens !== null &&
      (chargedInputTokens === null ||
        chargedInputTokens > policy.maxInputTokens)) ||
    chargedOutputTokens > policy.maxCumulativeOutputTokens ||
    (policy.maxCostUsd !== null &&
      (chargedCostUsd === null || chargedCostUsd > policy.maxCostUsd)) ||
    (reportedUsage.inputTokens !== null &&
      reservation.reservedInputTokens !== null &&
      reportedUsage.inputTokens > reservation.reservedInputTokens) ||
    (reportedUsage.outputTokens !== null &&
      reportedUsage.outputTokens > reservation.reservedOutputTokens) ||
    (cost.accountedUsd !== null &&
      reservation.reservedCostUsd !== null &&
      cost.accountedUsd > reservation.reservedCostUsd)
  )
    addReason(overrunReasons, 'settlement-overrun')
  return {
    state: detachedFrozenMultimodalRecord({
      ...after,
      liveCallsAttempted: before.liveCallsAttempted + 1,
      liveCallsSettled: before.liveCallsSettled + 1,
      chargedInputTokens,
      chargedOutputTokens,
      chargedCostUsd,
      observedInputTokens,
      observedOutputTokens,
      observedTotalTokens,
      billedCostUsd: billedCostTotal,
      estimatedCostUsd: estimatedCostTotal,
      overrunReasons,
    }),
    cost,
  }
}

function unavailableUsage(reason: string): VlmUsage
{
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    available: false,
    unavailableReason: reason,
  }
}

function validateAdapterResponse(value: unknown): VlmAdapterResponse
{
  const record = plainRecord(value, 'VLM adapter response')
  exactKeys(record, 'VLM adapter response', [
    'outcome',
    'responseId',
    'model',
    'latencyMs',
    'usage',
    'billedCostUsd',
    'raw',
    'error',
  ])
  const outcome = nonemptyString(record.outcome, 'VLM response outcome', 32)
  if (
    !['completed', 'refused', 'truncated', 'provider-error'].includes(outcome)
  )
    throw new Error('VLM adapter response outcome is invalid')
  const base = {
    responseId: nullableString(record.responseId, 'VLM response ID', 256),
    model: nonemptyString(record.model, 'VLM response model', 256),
    latencyMs: nonnegativeNumber(record.latencyMs, 'VLM response latency'),
    usage: usage(record.usage, 'VLM response usage'),
    billedCostUsd: nullableNonnegativeNumber(
      record.billedCostUsd,
      'VLM response billed cost'
    ),
  }
  if (outcome === 'completed')
  {
    if (record.error !== null)
      throw new Error('completed VLM response has an error')
    return { ...base, outcome, raw: record.raw, error: null }
  }
  if (record.error === null)
    throw new Error('incomplete VLM response is missing an error')
  return {
    ...base,
    outcome: outcome as 'refused' | 'truncated' | 'provider-error',
    raw: record.raw,
    error: callError(record.error, 'VLM response error'),
  }
}

function issue(
  code: string,
  responsibility: VlmExecutionIssueV1['responsibility'],
  message: string
): Readonly<VlmExecutionIssueV1>
{
  return detachedFrozenMultimodalRecord({ code, responsibility, message })
}

function liveCall(
  request: VlmAdapterRequest,
  estimate: VlmRequestEstimate,
  settlement: VlmBudgetSettlementV1,
  fields: {
    responseSha256: string | null
    responseModel: string | null
    outcome: VlmCallOutcome
    error: VlmCallErrorV1 | null
    latencyMs: number
    usage: VlmUsage
  }
): Readonly<VlmLiveCallRecordV1>
{
  return detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    requestKey: request.requestKey,
    requestSha256: request.requestSha256,
    responseSha256: fields.responseSha256,
    descriptor: { ...request.binding.provider },
    responseModel: fields.responseModel,
    outcome: fields.outcome,
    error: fields.error,
    latencyMs: fields.latencyMs,
    usage: fields.usage,
    estimate,
    cost: settlement.cost,
    mode: 'live',
    providerCallCount: 1,
    replaySourceSha256: null,
    originalLive: null,
  })
}

function inconclusiveLive(
  budget: VlmBudgetStateV1,
  call: Readonly<VlmLiveCallRecordV1> | null,
  executionIssue: Readonly<VlmExecutionIssueV1>
): Readonly<VlmInconclusiveExecutionV1>
{
  return detachedFrozenMultimodalRecord({
    mode: 'live',
    outcome: 'inconclusive',
    judgment: null,
    call,
    budget,
    issue: executionIssue,
    replayEntry: null,
  })
}

function admittedEvidence(
  request: VlmAdapterRequest
): RubricJudgmentProvenanceV1['admittedEvidence']
{
  const frames = new Map(
    request.binding.frames.map((frame) => [frame.frameId, frame])
  )
  return request.binding.criterionEvidence.flatMap((entry) =>
    entry.frameIds.map((frameId) =>
    {
      const frame = frames.get(frameId)!
      return {
        criterionId: entry.criterionId,
        evidenceId: frame.evidenceId,
        frameId: frame.frameId,
        tick: frame.tick,
      }
    })
  )
}

function provenance(
  request: VlmAdapterRequest,
  responseModel: string,
  admitted: RubricJudgmentProvenanceV1['admittedEvidence']
): RubricJudgmentProvenanceV1
{
  return {
    requestSha256: request.requestSha256,
    outputSchemaSha256: request.binding.outputSchema.sha256,
    criterionEvidenceSha256: hashMultimodalJson(
      request.binding.criterionEvidence
    ),
    admittedEvidence: admitted,
    context: { ...request.binding.context },
    promptTemplate: {
      id: request.binding.prompt.template.id,
      version: request.binding.prompt.template.version,
      templateSha256: request.binding.prompt.template.sha256,
      renderedPromptSha256: request.binding.prompt.renderedSha256,
    },
    provider: {
      adapter: request.binding.provider.adapter,
      provider: request.binding.provider.provider,
      requestedModel: request.binding.provider.model,
      version: request.binding.provider.version,
      responseModel,
    },
    generation: { ...request.binding.generation },
  }
}

function normalizeResponse(
  rubric: RubricSpecV1,
  request: VlmAdapterRequest,
  raw: unknown,
  responseModel: string
): {
  judgment: Readonly<RubricJudgmentV1>
  rawJudgment: Readonly<RawRubricJudgmentV1>
  responseSha256: string
}
{
  const responseSha256 = hashMultimodalJson(raw)
  const parsed = parseRawRubricJudgment(raw)
  if (!parsed.ok)
    throw new Error(
      `provider judgment failed strict parsing at ${parsed.issues[0]?.path ?? '$'}`
    )
  const admitted = admittedEvidence(request)
  const normalized = normalizeRubricJudgment(rubric, parsed.value, {
    rubricSha256: request.binding.rubric.sha256,
    evidenceSha256: request.binding.evidence.sha256,
    responseSha256,
    selectedCriterionIds: [...request.binding.selectedCriterionIds],
    provenance: provenance(request, responseModel, admitted),
    admittedEvidence: admitted,
  })
  if (!normalized.ok)
    throw new Error(
      `provider judgment failed evidence binding at ${normalized.issues[0]?.path ?? '$'}`
    )
  return {
    judgment: normalized.value,
    rawJudgment: parsed.value,
    responseSha256,
  }
}

function telemetryFromLive(
  call: VlmLiveCallRecordV1
): VlmRecordedLiveTelemetryV1
{
  return {
    descriptor: call.descriptor,
    responseModel: call.responseModel,
    outcome: call.outcome,
    responseSha256: call.responseSha256,
    latencyMs: call.latencyMs,
    usage: call.usage,
    estimate: call.estimate,
    cost: call.cost,
    error: call.error,
  }
}

export async function executeLiveVlmEvaluation(
  input: ExecuteLiveVlmInput
): Promise<Readonly<VlmExecutionResultV1>>
{
  let initialBudget: Readonly<VlmBudgetStateV1>
  try
  {
    initialBudget = validateVlmBudgetState(input.budgetState)
  }
  catch (error)
  {
    return inconclusiveLive(
      emptyVlmBudgetState(),
      null,
      issue(
        'invalid-vlm-budget-state',
        'policy',
        error instanceof Error ? error.message : 'invalid VLM budget state'
      )
    )
  }
  let policy: Readonly<VlmBudgetV1>
  try
  {
    policy = validateVlmBudget(input.budget)
  }
  catch (error)
  {
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'invalid-vlm-budget',
        'policy',
        error instanceof Error ? error.message : 'invalid VLM budget'
      )
    )
  }
  try
  {
    const snapshot = validateVlmBudgetAccounting(policy, initialBudget)
    policy = snapshot.budget
    initialBudget = snapshot.state
  }
  catch (error)
  {
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'invalid-vlm-budget-state',
        'policy',
        error instanceof Error
          ? error.message
          : 'VLM budget state does not match its policy'
      )
    )
  }
  let request: VlmAdapterRequest
  let rubric: Readonly<RubricSpecV1>
  try
  {
    const rubricValidation = validateRubricSpec(input.rubric)
    if (!rubricValidation.ok)
      throw new Error('trusted rubric specification is invalid')
    rubric = rubricValidation.value
    assertPreparedRequest(input.request)
    request = cloneAdapterRequest(input.request)
    assertPreparedRequest(request)
    assertRequestRubric(request, rubric)
    if (!sameJson(input.adapter.descriptor, request.binding.provider))
      throw new Error('adapter descriptor does not match the prepared request')
  }
  catch (error)
  {
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'invalid-vlm-request',
        'policy',
        error instanceof Error ? error.message : 'invalid VLM request'
      )
    )
  }

  const timeoutMs = input.timeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'invalid-provider-timeout',
        'policy',
        'provider timeout must be a positive integer no greater than 120000 ms'
      )
    )

  let admission: ReturnType<typeof validateAdapterAdmission>
  try
  {
    admission = validateAdapterAdmission(
      input.adapter.admit(estimateAdapterRequest(request))
    )
  }
  catch
  {
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'adapter-admission-failed',
        'provider',
        'provider adapter did not return a valid request-admission decision'
      )
    )
  }
  if (!admission.accepted)
    return inconclusiveLive(
      initialBudget,
      null,
      issue('adapter-request-denied', 'policy', admission.reason)
    )

  let estimate: VlmRequestEstimate
  try
  {
    estimate = requestEstimate(
      input.adapter.estimateCost(estimateAdapterRequest(request)),
      'VLM cost estimate'
    )
  }
  catch
  {
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'cost-estimate-failed',
        'provider',
        'provider cost estimation did not return a valid bounded estimate'
      )
    )
  }
  let reservation: VlmBudgetReservationResult
  try
  {
    reservation = reserveVlmBudget(policy, initialBudget, request, estimate)
  }
  catch (error)
  {
    return inconclusiveLive(
      initialBudget,
      null,
      issue(
        'invalid-vlm-budget',
        'policy',
        error instanceof Error ? error.message : 'invalid VLM budget'
      )
    )
  }
  if (!reservation.ok)
    return inconclusiveLive(
      reservation.state,
      null,
      issue(
        'vlm-budget-exhausted',
        'policy',
        `provider call blocked by ${reservation.reasons.join(', ')}`
      )
    )

  let startedAt = 0
  let timedOut = false
  let providerAttempted = false
  let responseValue: unknown
  try
  {
    responseValue = await withHostNetworkAccess(async () =>
    {
      startedAt = performance.now()
      const controller = new AbortController()
      const timeout = setTimeout(() =>
      {
        timedOut = true
        controller.abort(new Error('provider evaluation timed out'))
      }, timeoutMs)
      providerAttempted = true
      try
      {
        return await input.adapter.evaluate(
          cloneAdapterRequest(request),
          controller.signal
        )
      }
      finally
      {
        clearTimeout(timeout)
      }
    })
  }
  catch
  {
    if (!providerAttempted)
      return inconclusiveLive(
        reservation.reservation.before,
        null,
        issue(
          'host-network-lease-failed',
          'infrastructure',
          'trusted host networking could not acquire a clean runner lease'
        )
      )
    const reportedUsage = unavailableUsage(
      'provider threw before returning usage telemetry'
    )
    const settlement = settleVlmBudget(
      policy,
      reservation.reservation,
      reportedUsage,
      null
    )
    const call = liveCall(request, estimate, settlement, {
      responseSha256: null,
      responseModel: null,
      outcome: 'provider-error',
      error: {
        code: timedOut ? 'provider-timeout' : 'provider-threw',
        message: timedOut
          ? 'provider evaluation exceeded its host timeout'
          : 'provider adapter threw before returning a valid response',
        retryable: true,
      },
      latencyMs: performance.now() - startedAt,
      usage: reportedUsage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue(call.error!.code, 'provider', call.error!.message)
    )
  }

  let response: VlmAdapterResponse
  try
  {
    response = validateAdapterResponse(responseValue)
  }
  catch
  {
    const reportedUsage = unavailableUsage(
      'malformed provider response did not expose trusted usage telemetry'
    )
    const settlement = settleVlmBudget(
      policy,
      reservation.reservation,
      reportedUsage,
      null
    )
    const call = liveCall(request, estimate, settlement, {
      responseSha256: null,
      responseModel: null,
      outcome: timedOut ? 'provider-error' : 'invalid-response',
      error: {
        code: timedOut ? 'provider-timeout' : 'invalid-provider-envelope',
        message: timedOut
          ? 'provider evaluation exceeded its host timeout'
          : 'provider adapter returned an invalid response envelope',
        retryable: timedOut,
      },
      latencyMs: performance.now() - startedAt,
      usage: reportedUsage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue(call.error!.code, 'provider', call.error!.message)
    )
  }

  const settlement = settleVlmBudget(
    policy,
    reservation.reservation,
    response.usage,
    response.billedCostUsd
  )
  const measuredLatencyMs = performance.now() - startedAt
  if (timedOut)
  {
    const call = liveCall(request, estimate, settlement, {
      responseSha256: null,
      responseModel: response.model,
      outcome: 'provider-error',
      error: {
        code: 'provider-timeout',
        message: 'provider evaluation exceeded its host timeout',
        retryable: true,
      },
      latencyMs: measuredLatencyMs,
      usage: response.usage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue('provider-timeout', 'provider', call.error!.message)
    )
  }
  if (response.model !== request.binding.provider.model)
  {
    const call = liveCall(request, estimate, settlement, {
      responseSha256: null,
      responseModel: response.model,
      outcome: 'invalid-response',
      error: {
        code: 'response-model-mismatch',
        message: 'provider response model differs from the requested model',
        retryable: false,
      },
      latencyMs: measuredLatencyMs,
      usage: response.usage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue('response-model-mismatch', 'provider', call.error!.message)
    )
  }
  if (response.outcome !== 'completed')
  {
    const call = liveCall(request, estimate, settlement, {
      responseSha256: null,
      responseModel: response.model,
      outcome: response.outcome,
      error: response.error,
      latencyMs: measuredLatencyMs,
      usage: response.usage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue(response.error.code, 'provider', response.error.message)
    )
  }

  let normalized: {
    judgment: Readonly<RubricJudgmentV1>
    rawJudgment: Readonly<RawRubricJudgmentV1>
    responseSha256: string
  }
  try
  {
    normalized = normalizeResponse(
      rubric,
      request,
      response.raw,
      response.model
    )
  }
  catch
  {
    const call = liveCall(request, estimate, settlement, {
      responseSha256: null,
      responseModel: response.model,
      outcome: 'invalid-response',
      error: {
        code: 'invalid-rubric-judgment',
        message: 'provider output failed strict rubric and evidence validation',
        retryable: false,
      },
      latencyMs: measuredLatencyMs,
      usage: response.usage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue('invalid-rubric-judgment', 'provider', call.error!.message)
    )
  }
  if (settlement.state.overrunReasons.includes('settlement-overrun'))
  {
    const call = liveCall(request, estimate, settlement, {
      responseSha256: normalized.responseSha256,
      responseModel: response.model,
      outcome: 'budget-overrun',
      error: {
        code: 'budget-settlement-overrun',
        message: 'provider usage exceeded its reserved budget bound',
        retryable: false,
      },
      latencyMs: measuredLatencyMs,
      usage: response.usage,
    })
    return inconclusiveLive(
      settlement.state,
      call,
      issue('budget-settlement-overrun', 'policy', call.error!.message)
    )
  }
  const call = liveCall(request, estimate, settlement, {
    responseSha256: normalized.responseSha256,
    responseModel: response.model,
    outcome: 'completed',
    error: null,
    latencyMs: measuredLatencyMs,
    usage: response.usage,
  })
  const record = detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    key: request.requestKey,
    requestBinding: request.binding,
    requestSha256: request.requestSha256,
    rawJudgment: normalized.rawJudgment,
    normalizedJudgment: normalized.judgment,
    liveCall: call,
    liveBudget: {
      policy,
      before: reservation.reservation.before,
      after: settlement.state,
    },
  })
  const replayEntry = detachedFrozenMultimodalRecord({
    record,
    recordSha256: hashVlmReplayRecord(record),
  })
  try
  {
    await input.replayStore.writeExclusive(replayEntry)
  }
  catch
  {
    return inconclusiveLive(
      settlement.state,
      call,
      issue(
        'replay-record-write-failed',
        'infrastructure',
        'validated live result could not be written as an immutable replay record'
      )
    )
  }
  return detachedFrozenMultimodalRecord({
    mode: 'live',
    outcome: 'completed',
    judgment: normalized.judgment,
    call,
    budget: settlement.state,
    issue: null,
    replayEntry,
  })
}

function liveCallFromReplay(
  value: unknown,
  request: VlmAdapterRequest,
  rawResponseSha256: string
): Readonly<VlmLiveCallRecordV1>
{
  const record = plainRecord(value, 'replay live call')
  exactKeys(record, 'replay live call', [
    'schemaVersion',
    'requestKey',
    'requestSha256',
    'responseSha256',
    'descriptor',
    'responseModel',
    'outcome',
    'error',
    'latencyMs',
    'usage',
    'estimate',
    'cost',
    'mode',
    'providerCallCount',
    'replaySourceSha256',
    'originalLive',
  ])
  if (
    record.schemaVersion !== MULTIMODAL_SCHEMA_VERSION ||
    record.mode !== 'live' ||
    record.providerCallCount !== 1 ||
    record.replaySourceSha256 !== null ||
    record.originalLive !== null ||
    record.requestKey !== request.requestKey ||
    record.requestSha256 !== request.requestSha256 ||
    record.responseSha256 !== rawResponseSha256 ||
    record.outcome !== 'completed' ||
    record.error !== null
  )
    throw new Error('replay live call binding is invalid')
  const parsedDescriptor = descriptor(record.descriptor, 'replay descriptor')
  if (!sameJson(parsedDescriptor, request.binding.provider))
    throw new Error('replay provider descriptor does not match the request')
  const responseModel = nonemptyString(
    record.responseModel,
    'replay response model',
    256
  )
  if (responseModel !== request.binding.provider.model)
    throw new Error('replay response model does not match the request')
  const parsed: VlmLiveCallRecordV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    requestKey: request.requestKey,
    requestSha256: request.requestSha256,
    responseSha256: rawResponseSha256,
    descriptor: parsedDescriptor,
    responseModel,
    outcome: 'completed',
    error: null,
    latencyMs: nonnegativeNumber(record.latencyMs, 'replay live latency'),
    usage: usage(record.usage, 'replay live usage'),
    estimate: requestEstimate(record.estimate, 'replay live estimate'),
    cost: costRecord(record.cost, 'replay live cost'),
    mode: 'live',
    providerCallCount: 1,
    replaySourceSha256: null,
    originalLive: null,
  }
  if (parsed.cost.source === 'replay-zero')
    throw new Error('source live call cannot have replay-zero cost')
  if (
    parsed.estimate.outputTokens !==
      request.binding.generation.maxOutputTokens ||
    parsed.cost.estimatedUsd !== parsed.estimate.usd ||
    parsed.cost.pricingTableVersion !== parsed.estimate.pricingTableVersion
  )
    throw new Error('replay live cost does not match its recorded estimate')
  return detachedFrozenMultimodalRecord(parsed)
}

function validateReplayEntry(
  value: unknown,
  rubric: RubricSpecV1,
  request: VlmAdapterRequest
): Readonly<VlmReplayEntryV1>
{
  const detached = detachedFrozenMultimodalRecord(value)
  const entryRecord = plainRecord(detached, 'replay entry')
  exactKeys(entryRecord, 'replay entry', ['record', 'recordSha256'])
  const declaredRecordSha256 = hashString(
    entryRecord.recordSha256,
    'replay record hash'
  )
  const replayRecord = plainRecord(entryRecord.record, 'replay record')
  exactKeys(replayRecord, 'replay record', [
    'schemaVersion',
    'key',
    'requestBinding',
    'requestSha256',
    'rawJudgment',
    'normalizedJudgment',
    'liveCall',
    'liveBudget',
  ])
  if (
    replayRecord.schemaVersion !== MULTIMODAL_SCHEMA_VERSION ||
    replayRecord.key !== request.requestKey ||
    replayRecord.requestSha256 !== request.requestSha256 ||
    !sameJson(replayRecord.requestBinding, request.binding)
  )
    throw new Error('replay record does not match the exact request')
  const raw = parseRawRubricJudgment(replayRecord.rawJudgment)
  if (!raw.ok) throw new Error('replay raw judgment is invalid')
  const rawResponseSha256 = hashMultimodalJson(raw.value)
  const parsedLiveCall = liveCallFromReplay(
    replayRecord.liveCall,
    request,
    rawResponseSha256
  )
  const liveBudgetRecord = plainRecord(
    replayRecord.liveBudget,
    'replay live budget'
  )
  exactKeys(liveBudgetRecord, 'replay live budget', [
    'policy',
    'before',
    'after',
  ])
  const policy = detachedFrozenMultimodalRecord(
    liveBudgetRecord.policy as VlmBudgetV1
  )
  validateVlmBudget(policy)
  const budgetBefore = validateVlmBudgetState(
    liveBudgetRecord.before as VlmBudgetStateV1
  )
  const budgetAfter = validateVlmBudgetState(
    liveBudgetRecord.after as VlmBudgetStateV1
  )
  const replayReservation = reserveVlmBudget(
    policy,
    budgetBefore,
    request,
    parsedLiveCall.estimate
  )
  if (!replayReservation.ok)
    throw new Error('replay live budget could not reserve its recorded call')
  const replaySettlement = settleVlmBudget(
    policy,
    replayReservation.reservation,
    parsedLiveCall.usage,
    parsedLiveCall.cost.billedUsd
  )
  if (
    !sameJson(replaySettlement.state, budgetAfter) ||
    !sameJson(replaySettlement.cost, parsedLiveCall.cost) ||
    replaySettlement.state.overrunReasons.includes('settlement-overrun')
  )
    throw new Error('replay live budget failed trusted re-derivation')
  const normalized = normalizeResponse(
    rubric,
    request,
    raw.value,
    parsedLiveCall.responseModel!
  )
  if (!sameJson(replayRecord.normalizedJudgment, normalized.judgment))
    throw new Error('replay normalized judgment failed trusted re-derivation')
  const parsedRecord = detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    key: request.requestKey,
    requestBinding: request.binding,
    requestSha256: request.requestSha256,
    rawJudgment: raw.value,
    normalizedJudgment: normalized.judgment,
    liveCall: parsedLiveCall,
    liveBudget: {
      policy,
      before: budgetBefore,
      after: budgetAfter,
    },
  })
  const actualRecordSha256 = hashVlmReplayRecord(parsedRecord)
  if (declaredRecordSha256 !== actualRecordSha256)
    throw new Error('replay record self-hash is invalid')
  return detachedFrozenMultimodalRecord({
    record: parsedRecord,
    recordSha256: actualRecordSha256,
  })
}

function replayCall(
  entry: VlmReplayEntryV1,
  latencyMs: number
): Readonly<VlmReplayCallRecordV1>
{
  const live = entry.record.liveCall
  return detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    requestKey: live.requestKey,
    requestSha256: live.requestSha256,
    responseSha256: live.responseSha256,
    descriptor: live.descriptor,
    responseModel: live.responseModel,
    outcome: 'completed',
    error: null,
    latencyMs,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      available: true,
      unavailableReason: null,
    },
    estimate: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usd: 0,
      pricingTableVersion: 'replay-zero-v1',
      unavailableReason: null,
    },
    cost: {
      billedUsd: null,
      estimatedUsd: null,
      accountedUsd: 0,
      pricingTableVersion: null,
      source: 'replay-zero',
      unavailableReason: null,
    },
    mode: 'replay',
    providerCallCount: 0,
    replaySourceSha256: entry.recordSha256,
    originalLive: telemetryFromLive(live),
  })
}

function inconclusiveReplay(
  budget: VlmBudgetStateV1,
  executionIssue: Readonly<VlmExecutionIssueV1>
): Readonly<VlmInconclusiveExecutionV1>
{
  return detachedFrozenMultimodalRecord({
    mode: 'replay',
    outcome: 'inconclusive',
    judgment: null,
    call: null,
    budget,
    issue: executionIssue,
    replayEntry: null,
  })
}

export async function executeReplayVlmEvaluation(
  input: ExecuteReplayVlmInput
): Promise<Readonly<VlmExecutionResultV1>>
{
  const startedAt = performance.now()
  let budget: Readonly<VlmBudgetStateV1>
  try
  {
    budget = validateVlmBudgetState(input.budgetState)
  }
  catch (error)
  {
    return inconclusiveReplay(
      emptyVlmBudgetState(),
      issue(
        'invalid-vlm-budget-state',
        'policy',
        error instanceof Error ? error.message : 'invalid VLM budget state'
      )
    )
  }
  let request: VlmAdapterRequest
  let rubric: Readonly<RubricSpecV1>
  try
  {
    const rubricValidation = validateRubricSpec(input.rubric)
    if (!rubricValidation.ok)
      throw new Error('trusted rubric specification is invalid')
    rubric = rubricValidation.value
    assertPreparedRequest(input.request)
    request = cloneAdapterRequest(input.request)
    assertPreparedRequest(request)
    assertRequestRubric(request, rubric)
  }
  catch (error)
  {
    return inconclusiveReplay(
      budget,
      issue(
        'invalid-replay-request',
        'policy',
        error instanceof Error ? error.message : 'invalid replay request'
      )
    )
  }
  let value: unknown | null
  try
  {
    value = await input.replayStore.read(request.requestKey)
  }
  catch
  {
    return inconclusiveReplay(
      budget,
      issue(
        'replay-read-failed',
        'infrastructure',
        'replay store failed while reading the exact request key'
      )
    )
  }
  if (value === null)
    return inconclusiveReplay(
      budget,
      issue(
        'replay-miss',
        'replay',
        'no immutable replay record matches the exact request key'
      )
    )
  let entry: Readonly<VlmReplayEntryV1>
  try
  {
    entry = validateReplayEntry(value, rubric, request)
  }
  catch
  {
    return inconclusiveReplay(
      budget,
      issue(
        'invalid-replay-record',
        'replay',
        'replay record failed strict shape, binding, or self-hash validation'
      )
    )
  }
  const call = replayCall(entry, performance.now() - startedAt)
  return detachedFrozenMultimodalRecord({
    mode: 'replay',
    outcome: 'completed',
    judgment: entry.record.normalizedJudgment,
    call,
    budget,
    issue: null,
    replayEntry: null,
  })
}
