// packages/eval/src/multimodal/fake-vlm.ts
// deterministic scripted VLM adapter & detached in-memory replay store

import {
  detachedFrozenMultimodalRecord,
  hashMultimodalContent,
  hashMultimodalJson,
} from './multimodal-contracts.js'
import {
  hashVlmReplayRecord,
  VLM_REQUEST_KEY_PREFIX,
  type VlmAdapter,
  type VlmAdapterAdmission,
  type VlmAdapterEstimateRequest,
  type VlmAdapterRequest,
  type VlmAdapterResponse,
  type VlmFrameBindingV1,
  type VlmProviderDescriptor,
  type VlmReplayEntryV1,
  type VlmReplayStore,
  type VlmRequestEstimate,
  type VlmRequestKey,
  type VlmUsage,
} from './vlm.js'

interface FakeVlmResponseAction
{
  kind: 'response'
  response: VlmAdapterResponse
}

interface FakeVlmThrowAction
{
  kind: 'throw'
  error: Error | string
}

type FakeVlmAction = FakeVlmResponseAction | FakeVlmThrowAction

interface FakeVlmAdapterOptions
{
  descriptor: VlmProviderDescriptor
  estimate: VlmRequestEstimate
  actions: readonly FakeVlmAction[]
}

interface FakeVlmObservedImageV1
{
  binding: VlmFrameBindingV1
  actualBytes: number
}

interface FakeVlmObservedRequestV1
{
  call: number
  requestKey: VlmRequestKey
  requestSha256: string
  bindingSha256: string
  renderedPromptSha256: string
  outputSchemaSha256: string
  images: FakeVlmObservedImageV1[]
}

interface StoredResponseAction
{
  kind: 'response'
  response: Readonly<VlmAdapterResponse>
}

interface StoredThrowAction
{
  kind: 'throw'
  name: string
  message: string
}

type StoredAction = StoredResponseAction | StoredThrowAction

function assertNonEmptyString(
  value: string,
  name: string,
  maxLength = 4096
): void
{
  if (value.length === 0 || value.length > maxLength)
    throw new Error(`${name} must contain 1..${maxLength} characters`)
}

function assertNullableNonNegativeNumber(
  value: number | null,
  name: string
): void
{
  if (value !== null && (!Number.isFinite(value) || value < 0))
    throw new Error(`${name} must be null or a non-negative finite number`)
}

function assertNullableTokenCount(value: number | null, name: string): void
{
  if (value !== null && (!Number.isSafeInteger(value) || value < 0))
    throw new Error(`${name} must be null or a non-negative safe integer`)
}

function validateDescriptor(descriptor: VlmProviderDescriptor): void
{
  assertNonEmptyString(descriptor.adapter, 'descriptor.adapter', 256)
  assertNonEmptyString(descriptor.provider, 'descriptor.provider', 256)
  assertNonEmptyString(descriptor.model, 'descriptor.model', 256)
  assertNonEmptyString(descriptor.version, 'descriptor.version', 256)
  detachedFrozenMultimodalRecord(descriptor)
}

function validateUsage(usage: VlmUsage, name: string): void
{
  assertNullableTokenCount(usage.inputTokens, `${name}.inputTokens`)
  assertNullableTokenCount(usage.outputTokens, `${name}.outputTokens`)
  assertNullableTokenCount(usage.totalTokens, `${name}.totalTokens`)
  if (
    usage.inputTokens !== null &&
    usage.outputTokens !== null &&
    usage.totalTokens !== null &&
    usage.inputTokens + usage.outputTokens !== usage.totalTokens
  )
    throw new Error(`${name}.totalTokens does not equal input plus output`)
  const hasUnknownTokens =
    usage.inputTokens === null ||
    usage.outputTokens === null ||
    usage.totalTokens === null
  if (usage.available && hasUnknownTokens)
    throw new Error(`${name} cannot be available with unknown token values`)
  if (usage.available && usage.unavailableReason !== null)
    throw new Error(
      `${name}.unavailableReason must be null when usage is available`
    )
  if (!usage.available)
  {
    if (!hasUnknownTokens)
      throw new Error(`${name} cannot be unavailable when all tokens are known`)
    if (usage.unavailableReason === null)
      throw new Error(`${name}.unavailableReason is required when unavailable`)
    assertNonEmptyString(usage.unavailableReason, `${name}.unavailableReason`)
  }
}

function validateEstimate(estimate: VlmRequestEstimate): void
{
  assertNullableTokenCount(estimate.inputTokens, 'estimate.inputTokens')
  assertNullableTokenCount(estimate.outputTokens, 'estimate.outputTokens')
  assertNullableTokenCount(estimate.totalTokens, 'estimate.totalTokens')
  if (
    estimate.inputTokens !== null &&
    estimate.outputTokens !== null &&
    estimate.totalTokens !== null &&
    estimate.inputTokens + estimate.outputTokens !== estimate.totalTokens
  )
    throw new Error(
      'estimate.totalTokens does not equal estimated input plus output'
    )
  assertNullableNonNegativeNumber(estimate.usd, 'estimate.usd')
  const hasUnknownValue =
    estimate.inputTokens === null ||
    estimate.outputTokens === null ||
    estimate.totalTokens === null ||
    estimate.usd === null
  if (hasUnknownValue && estimate.unavailableReason === null)
    throw new Error(
      'estimate.unavailableReason is required when an estimate is unknown'
    )
  if (!hasUnknownValue && estimate.unavailableReason !== null)
    throw new Error(
      'estimate.unavailableReason must be null when all estimates are known'
    )
  if (estimate.usd !== null && estimate.pricingTableVersion === null)
    throw new Error(
      'estimate.pricingTableVersion is required for a USD estimate'
    )
  if (estimate.pricingTableVersion !== null)
    assertNonEmptyString(
      estimate.pricingTableVersion,
      'estimate.pricingTableVersion',
      256
    )
  if (estimate.unavailableReason !== null)
    assertNonEmptyString(
      estimate.unavailableReason,
      'estimate.unavailableReason'
    )
  detachedFrozenMultimodalRecord(estimate)
}

function validateResponse(
  response: VlmAdapterResponse,
  descriptor: VlmProviderDescriptor,
  index: number
): Readonly<VlmAdapterResponse>
{
  const name = `actions[${index}].response`
  if (response.responseId !== null)
    assertNonEmptyString(response.responseId, `${name}.responseId`, 256)
  assertNonEmptyString(response.model, `${name}.model`, 256)
  if (response.model !== descriptor.model)
    throw new Error(`${name}.model does not match the configured model`)
  assertNullableNonNegativeNumber(response.latencyMs, `${name}.latencyMs`)
  assertNullableNonNegativeNumber(
    response.billedCostUsd,
    `${name}.billedCostUsd`
  )
  validateUsage(response.usage, `${name}.usage`)
  if (response.outcome === 'completed' && response.error !== null)
    throw new Error(`${name}.error must be null for a completed response`)
  if (response.outcome !== 'completed')
  {
    assertNonEmptyString(response.error.code, `${name}.error.code`, 256)
    assertNonEmptyString(response.error.message, `${name}.error.message`)
    if (typeof response.error.retryable !== 'boolean')
      throw new Error(`${name}.error.retryable must be a boolean`)
  }
  return detachedFrozenMultimodalRecord(response)
}

function storeAction(
  action: FakeVlmAction,
  descriptor: VlmProviderDescriptor,
  index: number
): StoredAction
{
  if (action.kind === 'response')
    return {
      kind: 'response',
      response: validateResponse(action.response, descriptor, index),
    }
  const error = action.error
  const name = typeof error === 'string' ? 'Error' : error.name || 'Error'
  const message = typeof error === 'string' ? error : error.message
  assertNonEmptyString(name, `actions[${index}].error.name`, 256)
  assertNonEmptyString(message, `actions[${index}].error.message`)
  return { kind: 'throw', name, message }
}

function validateRequest(
  request: VlmAdapterRequest | VlmAdapterEstimateRequest,
  descriptor: VlmProviderDescriptor
): void
{
  const bindingSha256 = hashMultimodalJson(request.binding)
  if (request.requestSha256 !== bindingSha256)
    throw new Error('fake VLM request hash does not match its binding')
  if (request.requestKey !== `${VLM_REQUEST_KEY_PREFIX}${bindingSha256}`)
    throw new Error('fake VLM request key does not match its binding')
  if (
    hashMultimodalJson(request.binding.provider) !==
    hashMultimodalJson(descriptor)
  )
    throw new Error('fake VLM request provider does not match the adapter')
  if (
    hashMultimodalContent(request.prompt) !==
    request.binding.prompt.renderedSha256
  )
    throw new Error('fake VLM rendered prompt does not match its binding')
  if (
    hashMultimodalJson(request.outputSchema) !==
    request.binding.outputSchema.sha256
  )
    throw new Error('fake VLM output schema does not match its binding')
  if (request.images.length !== request.binding.frames.length)
    throw new Error('fake VLM image count does not match its binding')
  request.images.forEach((image, index) =>
  {
    const binding = request.binding.frames[index]!
    if (hashMultimodalJson(image.binding) !== hashMultimodalJson(binding))
      throw new Error(`fake VLM image ${index} metadata does not match`)
    if ('bytes' in image)
    {
      if (!(image.bytes instanceof Uint8Array))
        throw new Error(`fake VLM image ${index} bytes are invalid`)
      if (image.bytes.byteLength !== binding.bytes)
        throw new Error(`fake VLM image ${index} byte length does not match`)
      if (hashMultimodalContent(image.bytes) !== binding.sha256)
        throw new Error(`fake VLM image ${index} hash does not match`)
    }
  })
}

function observeRequest(
  request: VlmAdapterRequest,
  call: number
): Readonly<FakeVlmObservedRequestV1>
{
  return detachedFrozenMultimodalRecord({
    call,
    requestKey: request.requestKey,
    requestSha256: request.requestSha256,
    bindingSha256: hashMultimodalJson(request.binding),
    renderedPromptSha256: hashMultimodalContent(request.prompt),
    outputSchemaSha256: hashMultimodalJson(request.outputSchema),
    images: request.images.map((image) => ({
      binding: { ...image.binding },
      actualBytes: image.bytes.byteLength,
    })),
  })
}

export class ScriptedFakeVlmAdapter implements VlmAdapter
{
  readonly descriptor: Readonly<VlmProviderDescriptor>
  readonly #estimate: Readonly<VlmRequestEstimate>
  readonly #actions: StoredAction[]
  readonly #observed: Readonly<FakeVlmObservedRequestV1>[] = []
  #callCount = 0

  constructor(options: FakeVlmAdapterOptions)
  {
    validateDescriptor(options.descriptor)
    validateEstimate(options.estimate)
    if (options.actions.length > 512)
      throw new Error('fake VLM action queue exceeds 512 entries')
    this.descriptor = detachedFrozenMultimodalRecord(options.descriptor)
    this.#estimate = detachedFrozenMultimodalRecord(options.estimate)
    this.#actions = options.actions.map((action, index) =>
      storeAction(action, options.descriptor, index)
    )
  }

  get callCount(): number
  {
    return this.#callCount
  }

  get remainingActions(): number
  {
    return this.#actions.length
  }

  get observedRequests(): readonly Readonly<FakeVlmObservedRequestV1>[]
  {
    return this.#observed.map((request) => structuredClone(request))
  }

  admit(request: VlmAdapterEstimateRequest): VlmAdapterAdmission
  {
    validateRequest(request, this.descriptor)
    return { accepted: true, reason: null }
  }

  estimateCost(request: VlmAdapterEstimateRequest): VlmRequestEstimate
  {
    validateRequest(request, this.descriptor)
    return structuredClone(this.#estimate)
  }

  async evaluate(
    request: VlmAdapterRequest,
    signal: AbortSignal
  ): Promise<VlmAdapterResponse>
  {
    if (signal.aborted) throw signal.reason
    validateRequest(request, this.descriptor)
    this.#callCount++
    this.#observed.push(observeRequest(request, this.#callCount))
    const action = this.#actions.shift()
    if (!action)
      throw new Error(
        `fake VLM has no scripted action for call ${this.#callCount}`
      )
    if (action.kind === 'throw')
    {
      const error = new Error(action.message)
      error.name = action.name
      throw error
    }
    return structuredClone(action.response)
  }
}

function validateReplayEntry(entry: VlmReplayEntryV1): VlmReplayEntryV1
{
  detachedFrozenMultimodalRecord(entry)
  if (entry.recordSha256 !== hashVlmReplayRecord(entry.record))
    throw new Error('replay entry hash does not match its record')
  if (
    entry.record.requestSha256 !==
    hashMultimodalJson(entry.record.requestBinding)
  )
    throw new Error('replay request hash does not match its binding')
  if (
    entry.record.key !==
    `${VLM_REQUEST_KEY_PREFIX}${entry.record.requestSha256}`
  )
    throw new Error('replay key does not match its request hash')
  if (
    entry.record.liveCall.requestKey !== entry.record.key ||
    entry.record.liveCall.requestSha256 !== entry.record.requestSha256
  )
    throw new Error('replay live call does not match its request')
  return detachedFrozenMultimodalRecord(entry) as VlmReplayEntryV1
}

export class InMemoryVlmReplayStore implements VlmReplayStore
{
  readonly #entries = new Map<VlmRequestKey, VlmReplayEntryV1>()
  #readCount = 0
  #writeCount = 0

  constructor(entries: readonly VlmReplayEntryV1[] = [])
  {
    if (entries.length > 512)
      throw new Error('initial replay entry set exceeds 512 records')
    for (const entry of entries)
    {
      const stored = validateReplayEntry(entry)
      if (this.#entries.has(stored.record.key))
        throw new Error(`replay key already exists: ${stored.record.key}`)
      this.#entries.set(stored.record.key, stored)
    }
  }

  get size(): number
  {
    return this.#entries.size
  }

  get readCount(): number
  {
    return this.#readCount
  }

  get writeCount(): number
  {
    return this.#writeCount
  }

  get keys(): readonly VlmRequestKey[]
  {
    return [...this.#entries.keys()].sort()
  }

  async read(key: VlmRequestKey): Promise<unknown | null>
  {
    this.#readCount++
    const entry = this.#entries.get(key)
    return entry ? structuredClone(entry) : null
  }

  async writeExclusive(entry: Readonly<VlmReplayEntryV1>): Promise<void>
  {
    const stored = validateReplayEntry(entry as VlmReplayEntryV1)
    if (this.#entries.has(stored.record.key))
      throw new Error(`replay key already exists: ${stored.record.key}`)
    this.#entries.set(stored.record.key, stored)
    this.#writeCount++
  }
}
