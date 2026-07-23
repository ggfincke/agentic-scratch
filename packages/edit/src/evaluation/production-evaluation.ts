// packages/edit/src/evaluation/production-evaluation.ts
// production deterministic evaluator adapter & exact synchronous lane capability

import {
  EditProductionEvaluationErrorV1,
  evaluateEditProductionV1,
  type EditProductionEvaluationOptionsV1,
  type EditProductionEvaluationRequestV1,
} from '@scratch-agent/eval'
import { semanticHashV1 } from '@scratch-agent/ir/edit'

import {
  EDIT_EVALUATION_RUNNER_LANES_V1,
  validatedRunnerAvailabilityV1,
} from '../contracts/capabilities.js'
import type {
  EditDeterministicEvaluationPort,
  EditDeterministicEvaluationExecutionV1,
  EditDeterministicEvaluationRequestV1,
} from './evaluation-ports.js'
import type { RunnerAvailabilityV1 } from '@scratch-agent/ir/edit'

interface ProductionEditRunnerAvailabilityProbeV1
{
  runnerAvailabilityV1(): readonly RunnerAvailabilityV1[]
}

interface ProductionEditDeterministicEvaluationPortOptionsV1 extends EditProductionEvaluationOptionsV1
{
  readonly availabilityEpoch?: number
  readonly runnerAvailabilityProbe?: ProductionEditRunnerAvailabilityProbeV1
}

export class ProductionEditDeterministicEvaluationPortV1 implements EditDeterministicEvaluationPort
{
  readonly #options: EditProductionEvaluationOptionsV1
  readonly #runnerAvailabilityProbe: ProductionEditRunnerAvailabilityProbeV1 | null
  #availabilityEpoch: number
  #poisonSha256: string | null = null

  constructor(
    options: ProductionEditDeterministicEvaluationPortOptionsV1 = {}
  )
  {
    this.#options = {
      ...(options.decoder === undefined ? {} : { decoder: options.decoder }),
      ...(options.evidenceSink === undefined
        ? {}
        : { evidenceSink: options.evidenceSink }),
    }
    this.#runnerAvailabilityProbe = options.runnerAvailabilityProbe ?? null
    this.#availabilityEpoch = options.availabilityEpoch ?? 0
    if (
      !Number.isSafeInteger(this.#availabilityEpoch) ||
      this.#availabilityEpoch < 0
    )
      throw new TypeError('runner availability epoch must be a count')
  }

  runnerAvailabilityV1(): readonly RunnerAvailabilityV1[]
  {
    const probed = validatedRunnerAvailabilityV1(
      this.#runnerAvailabilityProbe?.runnerAvailabilityV1() ??
        EDIT_EVALUATION_RUNNER_LANES_V1.map((lane) => ({
          lane,
          availability: 'unavailable' as const,
          availabilityEpoch: this.#availabilityEpoch,
        }))
    )
    const probedEpoch = probed[0]!.availabilityEpoch
    if (probedEpoch < this.#availabilityEpoch)
      throw new TypeError('runner availability probe epoch regressed')
    this.#availabilityEpoch = probedEpoch
    const deterministicRows = validatedRunnerAvailabilityV1(
      probed.map((row) =>
        row.lane === 'nativeVisual'
          ? {
              lane: row.lane,
              availability: 'unavailable' as const,
              availabilityEpoch: this.#availabilityEpoch,
            }
          : row
      ),
      this.#availabilityEpoch
    )
    const poisonSha256 = this.#poisonSha256
    if (poisonSha256 === null) return deterministicRows
    return validatedRunnerAvailabilityV1(
      deterministicRows.map((row) =>
        row.lane === 'nativeVisual'
          ? row
          : {
              lane: row.lane,
              availability: 'poisoned' as const,
              availabilityEpoch: this.#availabilityEpoch,
              poisonSha256,
            }
      ),
      this.#availabilityEpoch
    )
  }

  async evaluate(
    request: EditDeterministicEvaluationRequestV1
  ): Promise<EditDeterministicEvaluationExecutionV1>
  {
    const productionRequest: EditProductionEvaluationRequestV1 = {
      evaluationId: request.evaluationId,
      plan: {
        plan: request.plan.plan,
        evaluationPlanSha256: request.plan.evaluationPlanSha256,
        masks: request.plan.masks,
        resourceLimitOverrides: request.plan.resourceLimitOverrides,
      },
      revision: request.revision,
      semanticSourceIdentity: request.semanticSourceIdentity,
      semanticSourceSha256: request.semanticSourceSha256,
      changeContractSha256: request.changeContractSha256,
      historySha256: request.historySha256,
      matrixSha256: request.matrixSha256,
      candidateBytes: request.candidateBytes,
      baselineBytes: request.baselineBytes,
      baselineRuntime: request.baselineRuntime,
      candidateRuntime: request.candidateRuntime,
      policies: request.policies,
      projectionAuthority: request.runtimeProjectionAuthorizations,
    }
    try
    {
      const production = await evaluateEditProductionV1(
        productionRequest,
        this.#options
      )
      const { evidencePayloads, ...result } = production
      return Object.freeze({ result, evidencePayloads })
    }
    catch (error)
    {
      if (!(error instanceof EditProductionEvaluationErrorV1))
      {
        try
        {
          const probed = this.#runnerAvailabilityProbe?.runnerAvailabilityV1()
          if (probed !== undefined)
            this.#availabilityEpoch = Math.max(
              this.#availabilityEpoch,
              validatedRunnerAvailabilityV1(probed)[0]!.availabilityEpoch
            )
        }
        catch
        {
          // poisoning remains monotonic even when the health probe itself fails
        }
        this.#availabilityEpoch += 1
        this.#poisonSha256 = semanticHashV1('evidence-content', {
          kind: 'production-evaluation-engine-poison',
          availabilityEpoch: this.#availabilityEpoch,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }
}
