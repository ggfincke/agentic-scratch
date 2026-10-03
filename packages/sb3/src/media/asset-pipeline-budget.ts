// packages/sb3/src/media/asset-pipeline-budget.ts
// finite cumulative work & live buffer accounting for one preprocessing job

export const ASSET_PIPELINE_LIMITS_V2 = Object.freeze({
  maxTransformsPerFrame: 16,
  maxDecodedWorkingBytes: 128 * 1024 * 1024,
  maxPixelVisits: 268_435_456,
})

export interface AssetPipelineLimitsV2
{
  maxTransformsPerFrame: number
  maxDecodedWorkingBytes: number
  maxPixelVisits: number
}

export interface AssetPipelineUsageV2
{
  pixelVisits: number
  decodedBytesInUse: number
  peakDecodedBytes: number
}

export const ASSET_PIPELINE_CODES_V2 = Object.freeze({
  invalidInput: 'ASSET_PIPELINE_INVALID_INPUT',
  unsupportedPng: 'ASSET_PIPELINE_UNSUPPORTED_PNG',
  sourceChanged: 'ASSET_PIPELINE_SOURCE_CHANGED',
  budgetExceeded: 'ASSET_PIPELINE_BUDGET_EXCEEDED',
  concurrentOperation: 'ASSET_PIPELINE_CONCURRENT_OPERATION',
})

export class AssetPipelineErrorV2 extends Error
{
  readonly code: (typeof ASSET_PIPELINE_CODES_V2)[keyof typeof ASSET_PIPELINE_CODES_V2]

  constructor(
    code: AssetPipelineErrorV2['code'],
    message: string,
    options?: ErrorOptions
  )
  {
    super(message, options)
    this.name = 'AssetPipelineErrorV2'
    this.code = code
  }
}

export class AssetPreprocessingBudgetV2
{
  readonly limits: Readonly<AssetPipelineLimitsV2>
  #pixelVisits = 0
  #decodedBytesInUse = 0
  #peakDecodedBytes = 0

  constructor(options: Partial<AssetPipelineLimitsV2> = {})
  {
    const limits: AssetPipelineLimitsV2 = { ...ASSET_PIPELINE_LIMITS_V2 }
    for (const key of Object.keys(options))
    {
      if (!Object.hasOwn(limits, key))
      {
        throw new AssetPipelineErrorV2(
          ASSET_PIPELINE_CODES_V2.invalidInput,
          `unknown preprocessing limit ${key}`
        )
      }
      const name = key as keyof AssetPipelineLimitsV2
      const value = options[name]
      if (
        !Number.isSafeInteger(value) ||
        value! < 0 ||
        value! > ASSET_PIPELINE_LIMITS_V2[name]
      )
      {
        throw new AssetPipelineErrorV2(
          ASSET_PIPELINE_CODES_V2.invalidInput,
          `${name} can only lower its hard ceiling ${ASSET_PIPELINE_LIMITS_V2[name]}`
        )
      }
      limits[name] = value!
    }
    this.limits = Object.freeze(limits)
  }

  usage(): Readonly<AssetPipelineUsageV2>
  {
    return Object.freeze({
      pixelVisits: this.#pixelVisits,
      decodedBytesInUse: this.#decodedBytesInUse,
      peakDecodedBytes: this.#peakDecodedBytes,
    })
  }

  chargePixelVisits(visits: number): void
  {
    if (
      !Number.isSafeInteger(visits) ||
      visits < 0 ||
      this.#pixelVisits + visits > this.limits.maxPixelVisits
    )
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.budgetExceeded,
        `preprocessing pixel visits exceed ${this.limits.maxPixelVisits}`
      )
    }
    this.#pixelVisits += visits
  }

  reserveDecodedBytes(bytes: number): () => void
  {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.#decodedBytesInUse + bytes > this.limits.maxDecodedWorkingBytes
    )
    {
      throw new AssetPipelineErrorV2(
        ASSET_PIPELINE_CODES_V2.budgetExceeded,
        `preprocessing live decoded buffers exceed ${this.limits.maxDecodedWorkingBytes} bytes`
      )
    }
    this.#decodedBytesInUse += bytes
    this.#peakDecodedBytes = Math.max(
      this.#peakDecodedBytes,
      this.#decodedBytesInUse
    )
    let released = false
    return () =>
    {
      if (released) return
      released = true
      this.#decodedBytesInUse -= bytes
    }
  }
}
