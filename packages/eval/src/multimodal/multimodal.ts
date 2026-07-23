// packages/eval/src/multimodal/multimodal.ts
// standalone Multimodal evaluation request, selection, report, & evidence contracts

import {
  hashObservationPlan,
  validateObservationPlan,
  type ObservationPlanV1,
  type ObservationTraceV1,
} from '@scratch-agent/runner'

import {
  selectMultimodalEvidence,
  type MultimodalCriterionEvidenceV1,
} from './multimodal-escalation.js'
import type {
  BehavioralLensSpecV1,
  DifferentialReportV1,
  LensResultV1,
} from './lenses.js'
import {
  validateBehavioralLensSpecs,
  validateDifferentialReport,
} from './lens-validation.js'
import {
  detachedFrozenMultimodalRecord,
  hashMultimodalContent,
  hashMultimodalJson,
  multimodalArray,
  multimodalExactKeys,
  multimodalRecord,
  multimodalString,
  MULTIMODAL_SCHEMA_VERSION,
  validateMultimodalEvidenceLocator,
  type MultimodalContractIssue,
  type MultimodalEvidenceLocator,
  type MultimodalValidationResult,
  type MultimodalVerdict,
} from './multimodal-contracts.js'
import {
  MAX_RUBRIC_CRITERIA,
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  validateRubricSpec,
  type CriterionVerdict,
  type RubricJudgmentV1,
  type RubricSpecV1,
} from './rubric.js'
import {
  createVlmBudgetState,
  executeLiveVlmEvaluation,
  executeReplayVlmEvaluation,
  validateVlmBudgetAccounting,
  validateVlmBudget,
  validateVlmBudgetState,
} from './vlm-evaluator.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'
import {
  MAX_VLM_PROMPT_BYTES,
  renderTrustedVlmPrompt,
  VLM_OUTPUT_SCHEMA_ID,
  VLM_OUTPUT_SCHEMA_VERSION,
  type VlmAdapter,
  type VlmAdapterRequest,
  type VlmBudgetStateV1,
  type VlmBudgetV1,
  type VlmCallRecordV1,
  type VlmGenerationBindingV1,
  type VlmIdentityBindingV1,
  type VlmProviderDescriptor,
  type VlmRequestBindingV1,
  type VlmReplayStore,
} from './vlm.js'

type MultimodalEvaluationMode = 'deterministic' | 'live' | 'replay'

export const MULTIMODAL_DETERMINISTIC_SOURCES = [
  'state',
  'model',
  'keyframe',
  'temporal',
  'differential',
] as const
export const MULTIMODAL_EVALUATION_RESPONSIBILITIES = [
  'project',
  'infrastructure',
  'unsupported',
  'provider',
  'policy',
  'replay',
] as const
export const MAX_MULTIMODAL_RUN_ID_LENGTH = 256
export const MAX_MULTIMODAL_REPORT_TEXT_LENGTH = 2048
export const MAX_MULTIMODAL_ISSUE_CODE_LENGTH = 256
export const MAX_MULTIMODAL_EVALUATION_ISSUES = 512
export const MAX_MULTIMODAL_REPORT_LIMITATIONS = 512
export const MAX_MULTIMODAL_DETERMINISTIC_EVIDENCE = 256
export const MAX_MULTIMODAL_DETERMINISTIC_RESULTS =
  MAX_RUBRIC_CRITERIA * MULTIMODAL_DETERMINISTIC_SOURCES.length

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function isCanonicalMultimodalTimestamp(
  value: unknown
): value is string
{
  return (
    typeof value === 'string' &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

export interface DeterministicCriterionResult
{
  criterionId: string
  required: boolean
  verdict: CriterionVerdict
  source: (typeof MULTIMODAL_DETERMINISTIC_SOURCES)[number]
  evidence: MultimodalEvidenceLocator[]
  limitation: string | null
}

export interface EvidenceSelectionDecisionV1
{
  criterionId: string
  decision:
    | 'deterministic-pass'
    | 'deterministic-fail'
    | 'use-keyframe'
    | 'use-vlm'
    | 'stop-inconclusive'
  reason: string
}

export interface EvidenceSelectionResult
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  decisions: EvidenceSelectionDecisionV1[]
  selectedFrameIds: string[]
  selectedClipIds: string[]
  vlmFrameIds: string[]
  vlmClipIds: string[]
  vlmEvidenceByCriterion: Array<{
    criterionId: string
    frameIds: string[]
    clipIds: string[]
  }>
  vlmCriterionIds: string[]
  stopReason: string | null
}

export interface MultimodalVlmPolicyV1
{
  prompt: {
    template: VlmIdentityBindingV1
    templateText: string
  }
  provider: VlmProviderDescriptor
  generation: VlmGenerationBindingV1
}

export interface MultimodalEvaluationRequest
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  mode: MultimodalEvaluationMode
  input: { artifactSha256: string; byteLength: number }
  scenarioSha256: string
  observationTraceSha256: string
  sampleOrdinal: number
  rubric: RubricSpecV1
  observationPlan: ObservationPlanV1
  lenses: BehavioralLensSpecV1[]
  budget: VlmBudgetV1
  vlmPolicy: MultimodalVlmPolicyV1 | null
}

export interface MultimodalEvaluationIssueV1
{
  code: string
  responsibility: (typeof MULTIMODAL_EVALUATION_RESPONSIBILITIES)[number]
  message: string
}

interface MultimodalVerdictInput
{
  structuralPreflight: MultimodalVerdict
  rubricSpec: RubricSpecV1
  deterministic: DeterministicCriterionResult[]
  lensSpecs: BehavioralLensSpecV1[]
  lenses: LensResultV1[]
  rubricJudgment: RubricJudgmentV1 | null
  issues: MultimodalEvaluationIssueV1[]
}

export function aggregateMultimodalVerdict(
  input: MultimodalVerdictInput
): MultimodalVerdict
{
  const criteriaById = new Map(
    input.rubricSpec.criteria.map((criterion) => [criterion.id, criterion])
  )
  const deterministicById = new Map<string, DeterministicCriterionResult[]>()
  const deterministicSources = new Set<string>()
  for (const result of input.deterministic)
  {
    const criterion = criteriaById.get(result.criterionId)
    if (!criterion)
      throw new Error(`unknown deterministic criterion ${result.criterionId}`)
    if (result.required !== (criterion.requirement === 'required'))
      throw new Error(
        `deterministic requirement mismatch for ${result.criterionId}`
      )
    const sourceKey = `${result.criterionId}\u0000${result.source}`
    if (deterministicSources.has(sourceKey))
      throw new Error(
        `duplicate deterministic source for ${result.criterionId}`
      )
    deterministicSources.add(sourceKey)
    const current = deterministicById.get(result.criterionId) ?? []
    current.push(result)
    deterministicById.set(result.criterionId, current)
  }

  const rubricById = new Map(
    (input.rubricJudgment?.criteria ?? []).map((criterion) => [
      criterion.criterionId,
      criterion,
    ])
  )
  if (
    input.rubricJudgment &&
    (input.rubricJudgment.rubric.id !== input.rubricSpec.id ||
      input.rubricJudgment.rubric.version !== input.rubricSpec.version ||
      input.rubricJudgment.rubric.sha256 !==
        hashMultimodalJson(input.rubricSpec))
  )
    throw new Error('rubric judgment does not match the trusted rubric')
  if (rubricById.size !== (input.rubricJudgment?.criteria.length ?? 0))
    throw new Error('rubric judgment contains duplicate criteria')
  for (const [criterionId, judgment] of rubricById)
  {
    const criterion = criteriaById.get(criterionId)
    if (!criterion)
      throw new Error(
        `rubric judgment contains unknown criterion ${criterionId}`
      )
    if (judgment.requirement !== criterion.requirement)
      throw new Error(`rubric requirement mismatch for ${criterionId}`)
    const deterministic = deterministicById.get(criterionId) ?? []
    const deterministicallyResolved =
      deterministic.some((result) => result.verdict === 'fail') ||
      (deterministic.length > 0 &&
        deterministic.every((result) => result.verdict === 'pass'))
    if (deterministicallyResolved)
      throw new Error(
        `criterion ${criterionId} has both deterministic and VLM resolution`
      )
  }

  const lensSpecsById = new Map(input.lensSpecs.map((spec) => [spec.id, spec]))
  if (lensSpecsById.size !== input.lensSpecs.length)
    throw new Error('lens specification IDs must be unique')
  const lensResultsById = new Map<string, LensResultV1>()
  for (const result of input.lenses)
  {
    const spec = lensSpecsById.get(result.specId)
    if (!spec) throw new Error(`unknown lens result ${result.specId}`)
    if (lensResultsById.has(result.specId))
      throw new Error(`duplicate lens result ${result.specId}`)
    if (result.kind !== spec.kind || result.required !== spec.required)
      throw new Error(`lens result binding mismatch for ${result.specId}`)
    lensResultsById.set(result.specId, result)
  }
  const missingRequiredLens = input.lensSpecs.some(
    (spec) => spec.required && !lensResultsById.has(spec.id)
  )
  const requiredLenses = input.lensSpecs
    .filter((spec) => spec.required)
    .flatMap((spec) =>
    {
      const result = lensResultsById.get(spec.id)
      return result ? [result] : []
    })
  const criterionVerdicts = input.rubricSpec.criteria
    .filter((criterion) => criterion.requirement === 'required')
    .map((criterion) =>
    {
      const deterministic = deterministicById.get(criterion.id) ?? []
      if (deterministic.some((result) => result.verdict === 'fail'))
        return 'fail' as const
      if (
        deterministic.length > 0 &&
        deterministic.every((result) => result.verdict === 'pass')
      )
        return 'pass' as const
      return rubricById.get(criterion.id)?.verdict ?? ('inconclusive' as const)
    })
  if (
    input.structuralPreflight === 'failed' ||
    criterionVerdicts.some((verdict) => verdict === 'fail') ||
    requiredLenses.some((result) => result.verdict === 'diverge') ||
    input.rubricJudgment?.verdict === 'failed'
  )
    return 'failed'
  const hostOwnedPass =
    input.structuralPreflight === 'passed' ||
    [...deterministicById.entries()].some(([criterionId, results]) =>
    {
      const criterion = criteriaById.get(criterionId)!
      return (
        criterion.requirement === 'required' &&
        results.length > 0 &&
        results.every((result) => result.verdict === 'pass')
      )
    }) ||
    requiredLenses.some((result) => result.verdict === 'agree')
  if (
    input.structuralPreflight !== 'passed' ||
    input.issues.length > 0 ||
    criterionVerdicts.some((verdict) => verdict !== 'pass') ||
    missingRequiredLens ||
    requiredLenses.some((result) => result.verdict !== 'agree') ||
    !hostOwnedPass
  )
    return 'inconclusive'
  return 'passed'
}

export interface MultimodalEvaluationReportV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  runId: string
  createdAt: string
  mode: MultimodalEvaluationMode
  requestSha256: string
  input: { artifactSha256: string; byteLength: number }
  scenarioSha256: string
  observationTraceSha256: string
  sampleOrdinal: number
  rubricSha256: string
  observationPlanSha256: string
  structuralPreflight: MultimodalVerdict
  deterministic: DeterministicCriterionResult[]
  selection: EvidenceSelectionResult
  vlmRequest: VlmRequestBindingV1 | null
  rubric: RubricJudgmentV1 | null
  differential: DifferentialReportV1 | null
  lenses: LensResultV1[]
  calls: VlmCallRecordV1[]
  budget: VlmBudgetStateV1
  verdict: MultimodalVerdict
  limitations: string[]
  issues: MultimodalEvaluationIssueV1[]
}

type MultimodalExecutionBoundary =
  | { mode: 'deterministic' }
  | {
      mode: 'live'
      request: VlmAdapterRequest | null
      adapter: VlmAdapter
      replayStore: VlmReplayStore
      timeoutMs?: number
    }
  | {
      mode: 'replay'
      request: VlmAdapterRequest | null
      replayStore: VlmReplayStore
    }

export interface EvaluateMultimodalInput
{
  request: MultimodalEvaluationRequest
  boundary: MultimodalExecutionBoundary
  runId: string
  createdAt: string
  structuralPreflight: MultimodalVerdict
  deterministic: DeterministicCriterionResult[]
  evidenceByCriterion: Record<string, MultimodalCriterionEvidenceV1>
  differential: DifferentialReportV1 | null
  lenses: LensResultV1[]
  budgetState?: VlmBudgetStateV1
  limitations?: string[]
  issues?: MultimodalEvaluationIssueV1[]
}

function inputRecord(value: unknown): Record<string, unknown> | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null
}

function exactInputKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean
{
  const keys = Object.keys(value)
  const allowed = new Set(expected)
  return (
    keys.length === expected.length && keys.every((key) => allowed.has(key))
  )
}

function boundedInputText(
  value: unknown,
  maxLength = MAX_MULTIMODAL_REPORT_TEXT_LENGTH
): value is string
{
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  )
}

function validateEvaluationIssues(
  value: unknown
): asserts value is MultimodalEvaluationIssueV1[]
{
  if (!Array.isArray(value) || value.length > MAX_MULTIMODAL_EVALUATION_ISSUES)
    throw new Error('Multimodal issues must be a bounded array')
  for (const [index, current] of value.entries())
  {
    const issue = inputRecord(current)
    if (
      !issue ||
      !exactInputKeys(issue, ['code', 'responsibility', 'message']) ||
      !boundedInputText(issue.code, MAX_MULTIMODAL_ISSUE_CODE_LENGTH) ||
      !MULTIMODAL_EVALUATION_RESPONSIBILITIES.includes(
        issue.responsibility as MultimodalEvaluationIssueV1['responsibility']
      ) ||
      !boundedInputText(issue.message)
    )
      throw new Error(`Multimodal issue ${index} is invalid`)
  }
}

function validateLimitations(value: unknown): asserts value is string[]
{
  if (
    !Array.isArray(value) ||
    value.length > MAX_MULTIMODAL_REPORT_LIMITATIONS ||
    value.some((current) => !boundedInputText(current))
  )
    throw new Error('Multimodal limitations must be bounded nonempty strings')
}

function validateDeterministicInput(
  value: unknown,
  differential: DifferentialReportV1 | null
): asserts value is DeterministicCriterionResult[]
{
  if (
    !Array.isArray(value) ||
    value.length > MAX_MULTIMODAL_DETERMINISTIC_RESULTS
  )
    throw new Error('Multimodal deterministic results exceed their bound')
  for (const [index, current] of value.entries())
  {
    const result = inputRecord(current)
    if (
      !result ||
      !exactInputKeys(result, [
        'criterionId',
        'required',
        'verdict',
        'source',
        'evidence',
        'limitation',
      ]) ||
      !boundedInputText(result.criterionId, 128) ||
      typeof result.required !== 'boolean' ||
      !['pass', 'fail', 'inconclusive'].includes(String(result.verdict)) ||
      !MULTIMODAL_DETERMINISTIC_SOURCES.includes(
        result.source as DeterministicCriterionResult['source']
      ) ||
      !Array.isArray(result.evidence) ||
      result.evidence.length > MAX_MULTIMODAL_DETERMINISTIC_EVIDENCE
    )
      throw new Error(`Multimodal deterministic result ${index} is invalid`)
    for (const locator of result.evidence)
      if (!validateMultimodalEvidenceLocator(locator).ok)
        throw new Error(
          `Multimodal deterministic result ${index} has invalid evidence`
        )
    if (
      result.verdict === 'inconclusive' &&
      !boundedInputText(result.limitation)
    )
      throw new Error(
        `Multimodal deterministic result ${index} needs a limitation`
      )
    if (result.verdict !== 'inconclusive' && result.limitation !== null)
      throw new Error(
        `Multimodal deterministic result ${index} cannot retain a limitation`
      )
    if (
      (result.source === 'temporal' || result.source === 'keyframe') &&
      result.verdict !== 'inconclusive' &&
      result.evidence.length === 0
    )
      throw new Error(
        `Multimodal deterministic result ${index} needs temporal evidence`
      )
    if (result.source === 'differential' && differential === null)
      throw new Error(
        `Multimodal deterministic result ${index} needs a differential report`
      )
  }
}

function exactStrings(
  left: readonly string[],
  right: readonly string[]
): boolean
{
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function exactRecord(value: unknown, keys: readonly string[]): boolean
{
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    return false
  const actual = Object.keys(value)
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  )
}

function validateMultimodalVlmPolicy(
  request: MultimodalEvaluationRequest
): MultimodalVlmPolicyV1 | null
{
  const policy = request.vlmPolicy
  if (request.mode === 'deterministic')
  {
    if (policy !== null)
      throw new Error(
        'deterministic Multimodal requests cannot retain VLM policy'
      )
    return null
  }
  if (
    !policy ||
    !exactRecord(policy, ['prompt', 'provider', 'generation']) ||
    !exactRecord(policy.prompt, ['template', 'templateText']) ||
    !exactRecord(policy.prompt.template, ['id', 'version', 'sha256']) ||
    !exactRecord(policy.provider, [
      'adapter',
      'provider',
      'model',
      'version',
    ]) ||
    !exactRecord(policy.generation, ['temperature', 'maxOutputTokens'])
  )
    throw new Error(
      'live and replay Multimodal requests need strict VLM policy'
    )
  const template = policy.prompt.template
  const templateText = policy.prompt.templateText
  const providerValues = [
    policy.provider.adapter,
    policy.provider.provider,
    policy.provider.model,
    policy.provider.version,
  ]
  if (
    typeof template.id !== 'string' ||
    template.id.length === 0 ||
    template.id.length > 128 ||
    typeof template.version !== 'string' ||
    template.version.length === 0 ||
    template.version.length > 128 ||
    typeof template.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(template.sha256) ||
    typeof templateText !== 'string' ||
    templateText.trim().length === 0 ||
    Buffer.byteLength(templateText, 'utf8') > MAX_VLM_PROMPT_BYTES ||
    hashMultimodalContent(templateText) !== template.sha256 ||
    providerValues.some(
      (value) =>
        typeof value !== 'string' || value.length === 0 || value.length > 256
    ) ||
    (policy.generation.temperature !== null &&
      (typeof policy.generation.temperature !== 'number' ||
        !Number.isFinite(policy.generation.temperature) ||
        policy.generation.temperature < 0 ||
        policy.generation.temperature > 2)) ||
    !Number.isSafeInteger(policy.generation.maxOutputTokens) ||
    policy.generation.maxOutputTokens <= 0
  )
    throw new Error('Multimodal VLM policy values are invalid')
  return policy
}

function validateMultimodalEvaluationRequest(
  value: unknown
): MultimodalEvaluationRequest
{
  let detached: Readonly<unknown>
  try
  {
    detached = detachedFrozenMultimodalRecord(value)
  }
  catch (error)
  {
    const message = unknownErrorMessage(error)
    throw new Error(
      `Multimodal evaluation request must be bounded canonical JSON: ${message}`
    )
  }
  const request = inputRecord(detached)
  if (
    !request ||
    !exactInputKeys(request, [
      'schemaVersion',
      'mode',
      'input',
      'scenarioSha256',
      'observationTraceSha256',
      'sampleOrdinal',
      'rubric',
      'observationPlan',
      'lenses',
      'budget',
      'vlmPolicy',
    ])
  )
    throw new Error(
      'Multimodal evaluation request has invalid top-level fields'
    )
  if (request.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    throw new Error(
      'Multimodal evaluation request schema version is unsupported'
    )
  if (
    typeof request.mode !== 'string' ||
    !['deterministic', 'live', 'replay'].includes(request.mode)
  )
    throw new Error('Multimodal evaluation request mode is invalid')
  const artifact = inputRecord(request.input)
  if (!artifact || !exactInputKeys(artifact, ['artifactSha256', 'byteLength']))
    throw new Error('Multimodal evaluation request input fields are invalid')
  if (
    [
      artifact.artifactSha256,
      request.scenarioSha256,
      request.observationTraceSha256,
    ].some(
      (identity) =>
        typeof identity !== 'string' || !/^[0-9a-f]{64}$/.test(identity)
    )
  )
    throw new Error(
      'Multimodal evaluation request identities must be SHA-256 digests'
    )
  if (
    typeof artifact.byteLength !== 'number' ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength <= 0
  )
    throw new Error(
      'Multimodal evaluation request input byte length must be a positive integer'
    )
  if (
    typeof request.sampleOrdinal !== 'number' ||
    !Number.isSafeInteger(request.sampleOrdinal) ||
    request.sampleOrdinal < 0
  )
    throw new Error(
      'Multimodal evaluation request sample ordinal must be a non-negative integer'
    )
  const rubricValidation = validateRubricSpec(request.rubric)
  if (!rubricValidation.ok)
    throw new Error(
      `Multimodal evaluation request rubric is invalid: ${rubricValidation.issues[0]?.message ?? 'unknown error'}`
    )
  const observationValidation = validateObservationPlan(request.observationPlan)
  if (!observationValidation.ok)
    throw new Error(
      `Multimodal evaluation request observation plan is invalid: ${observationValidation.issues[0]?.message ?? 'unknown error'}`
    )
  const lensesValidation = validateBehavioralLensSpecs(request.lenses)
  if (!lensesValidation.ok)
    throw new Error(
      `Multimodal evaluation request lenses are invalid: ${lensesValidation.issues[0]?.message ?? 'unknown error'}`
    )
  const typed = detached as MultimodalEvaluationRequest
  try
  {
    validateVlmBudget(typed.budget)
    validateMultimodalVlmPolicy(typed)
  }
  catch (error)
  {
    const message = unknownErrorMessage(error)
    throw new Error(
      `Multimodal evaluation request policy is invalid: ${message}`
    )
  }
  return typed
}

function finalizedSelection(
  selection: EvidenceSelectionResult,
  reason: string,
  evidenceByCriterion: Record<string, MultimodalCriterionEvidenceV1>
): EvidenceSelectionResult
{
  const keyframeFrameIds = [
    ...new Set(
      selection.decisions.flatMap((current) =>
        current.decision === 'use-keyframe'
          ? (evidenceByCriterion[current.criterionId]?.frameIds ?? [])
          : []
      )
    ),
  ]
  return {
    ...selection,
    decisions: selection.decisions.map((decision) =>
      decision.decision === 'use-vlm'
        ? {
            ...decision,
            decision: 'stop-inconclusive',
            reason,
          }
        : decision
    ),
    selectedFrameIds: keyframeFrameIds,
    selectedClipIds: [],
    vlmCriterionIds: [],
    vlmFrameIds: [],
    vlmClipIds: [],
    vlmEvidenceByCriterion: [],
    stopReason: reason,
  }
}

function validateMultimodalBoundary(
  input: EvaluateMultimodalInput,
  observationPlanSha256: string,
  selection: EvidenceSelectionResult
): void
{
  const vlmPolicy = validateMultimodalVlmPolicy(input.request)
  if (input.boundary.mode !== input.request.mode)
    throw new Error('Multimodal execution boundary does not match request mode')
  if (input.boundary.mode === 'deterministic')
  {
    if (selection.vlmCriterionIds.length > 0)
      throw new Error('deterministic mode retained a VLM selection')
    return
  }
  if (selection.vlmCriterionIds.length === 0) return
  const prepared = input.boundary.request
  if (!prepared)
    throw new Error('selected VLM evidence needs a prepared request')
  if (!vlmPolicy)
    throw new Error('selected VLM evidence needs trusted VLM policy')
  const context = prepared.binding.context
  if (
    context.artifactSha256 !== input.request.input.artifactSha256 ||
    context.scenarioSha256 !== input.request.scenarioSha256 ||
    context.observationPlanSha256 !== observationPlanSha256 ||
    context.observationTraceSha256 !== input.request.observationTraceSha256 ||
    context.sampleOrdinal !== input.request.sampleOrdinal
  )
    throw new Error('prepared VLM request context does not match evaluation')
  const canonicalOutputSchema = {
    id: VLM_OUTPUT_SCHEMA_ID,
    version: VLM_OUTPUT_SCHEMA_VERSION,
    sha256: hashMultimodalJson(RUBRIC_JUDGMENT_JSON_SCHEMA),
  }
  const expectedPrompt = renderTrustedVlmPrompt({
    template: vlmPolicy.prompt.template,
    templateText: vlmPolicy.prompt.templateText,
    rubric: input.request.rubric,
    rubricSha256: hashMultimodalJson(input.request.rubric),
    selectedCriterionIds: [...prepared.binding.selectedCriterionIds],
    criterionEvidence: prepared.binding.criterionEvidence.map((entry) => ({
      criterionId: entry.criterionId,
      frameIds: [...entry.frameIds],
    })),
    frames: prepared.binding.frames.map((frame) => ({ ...frame })),
    outputSchema: canonicalOutputSchema,
  })
  if (
    hashMultimodalJson(prepared.binding.prompt.template) !==
      hashMultimodalJson(vlmPolicy.prompt.template) ||
    hashMultimodalJson(prepared.binding.provider) !==
      hashMultimodalJson(vlmPolicy.provider) ||
    hashMultimodalJson(prepared.binding.generation) !==
      hashMultimodalJson(vlmPolicy.generation) ||
    hashMultimodalJson(prepared.binding.outputSchema) !==
      hashMultimodalJson(canonicalOutputSchema) ||
    prepared.prompt !== expectedPrompt ||
    prepared.binding.prompt.renderedSha256 !==
      hashMultimodalContent(expectedPrompt)
  )
    throw new Error('prepared VLM request does not match trusted VLM policy')
  if (
    !exactStrings(
      prepared.binding.selectedCriterionIds,
      selection.vlmCriterionIds
    ) ||
    !exactStrings(
      prepared.binding.frames.map((frame) => frame.frameId),
      selection.vlmFrameIds
    ) ||
    !exactStrings(prepared.binding.evidence.clipIds, selection.vlmClipIds) ||
    hashMultimodalJson(prepared.binding.criterionEvidence) !==
      hashMultimodalJson(
        selection.vlmEvidenceByCriterion.map((entry) => ({
          criterionId: entry.criterionId,
          frameIds: entry.frameIds,
        }))
      )
  )
    throw new Error('prepared VLM request does not match evidence selection')
  for (const entry of selection.vlmEvidenceByCriterion)
  {
    const bound = prepared.binding.criterionEvidence.find(
      (current) => current.criterionId === entry.criterionId
    )!
    const boundClipIds = [
      ...new Set(
        bound.frameIds.flatMap((frameId) =>
        {
          const frame = prepared.binding.frames.find(
            (current) => current.frameId === frameId
          )!
          return frame.clipId === null ? [] : [frame.clipId]
        })
      ),
    ]
    if (!exactStrings(boundClipIds, entry.clipIds))
      throw new Error('prepared VLM criterion clips do not match selection')
  }
}

function validateDifferentialBinding(input: EvaluateMultimodalInput): void
{
  const report = input.differential
  if (!report)
  {
    if (input.request.lenses.length > 0 || input.lenses.length > 0)
      throw new Error(
        'behavioral lens evidence requires a bound differential report'
      )
    return
  }
  const validated = validateDifferentialReport(report)
  if (!validated.ok)
    throw new Error(
      `invalid differential report: ${validated.issues[0]?.message ?? 'unknown error'}`
    )
  if (
    report.left.scenarioSha256 !== input.request.scenarioSha256 ||
    report.right.scenarioSha256 !== input.request.scenarioSha256
  )
    throw new Error('differential scenario does not match Multimodal request')
  if (
    report.left.artifactSha256 !== input.request.input.artifactSha256 &&
    report.right.artifactSha256 !== input.request.input.artifactSha256
  )
    throw new Error('differential does not include the evaluated artifact')
  if (
    hashMultimodalJson(report.specs) !==
      hashMultimodalJson(input.request.lenses) ||
    hashMultimodalJson(report.results) !== hashMultimodalJson(input.lenses)
  )
    throw new Error('differential lenses do not match the evaluation evidence')
}

export async function evaluateMultimodal(
  input: EvaluateMultimodalInput
): Promise<Readonly<MultimodalEvaluationReportV1>>
{
  input = {
    ...input,
    request: validateMultimodalEvaluationRequest(input.request),
  }
  if (
    !boundedInputText(input.runId, MAX_MULTIMODAL_RUN_ID_LENGTH) ||
    input.runId.trim() !== input.runId
  )
    throw new Error('Multimodal run ID must be trimmed and bounded')
  if (!isCanonicalMultimodalTimestamp(input.createdAt))
    throw new Error('Multimodal createdAt must be a canonical UTC timestamp')
  if (!['passed', 'failed', 'inconclusive'].includes(input.structuralPreflight))
    throw new Error('Multimodal structural preflight verdict is invalid')
  validateEvaluationIssues(input.issues ?? [])
  validateLimitations(input.limitations ?? [])
  validateDeterministicInput(input.deterministic, input.differential)
  const rubricValidation = validateRubricSpec(input.request.rubric)
  if (!rubricValidation.ok)
    throw new Error('Multimodal request contains an invalid rubric')
  const rubric = rubricValidation.value
  const observationPlanSha256 = hashObservationPlan(
    input.request.observationPlan
  )
  validateDifferentialBinding(input)
  const initialIssues = [...(input.issues ?? [])]
  aggregateMultimodalVerdict({
    structuralPreflight: input.structuralPreflight,
    rubricSpec: rubric,
    deterministic: input.deterministic,
    lensSpecs: input.request.lenses,
    lenses: input.lenses,
    rubricJudgment: null,
    issues: initialIssues,
  })
  const blockingIssues = initialIssues
    .filter((current) => current.responsibility === 'infrastructure')
    .map((current) => current.message)
  if (input.structuralPreflight !== 'passed')
    blockingIssues.push('structural preflight did not pass')
  if (input.lenses.some((lens) => lens.required && lens.verdict !== 'agree'))
    blockingIssues.push('a required behavioral lens did not agree')
  const providedLensIds = new Set(input.lenses.map((lens) => lens.specId))
  if (
    input.request.lenses.some(
      (lens) => lens.required && !providedLensIds.has(lens.id)
    )
  )
    blockingIssues.push('a required behavioral lens result is missing')
  let selection = selectMultimodalEvidence({
    rubric,
    mode: input.request.mode,
    deterministic: input.deterministic,
    evidenceByCriterion: input.evidenceByCriterion,
    infrastructureIssues: blockingIssues,
  })
  validateMultimodalBoundary(input, observationPlanSha256, selection)

  const budgetPolicy = validateVlmBudget(input.request.budget)
  const initialBudget = input.budgetState
    ? validateVlmBudgetState(input.budgetState)
    : createVlmBudgetState(budgetPolicy)
  validateVlmBudgetAccounting(budgetPolicy, initialBudget)
  let budget = initialBudget
  let judgment: Readonly<RubricJudgmentV1> | null = null
  let vlmRequest: Readonly<VlmRequestBindingV1> | null = null
  const calls: VlmCallRecordV1[] = []
  if (selection.vlmCriterionIds.length > 0)
  {
    if (input.boundary.mode === 'deterministic')
      throw new Error('deterministic boundary cannot execute VLM evidence')
    const preparedRequest = input.boundary.request
    if (!preparedRequest)
      throw new Error('selected VLM evidence needs a prepared request')
    vlmRequest = detachedFrozenMultimodalRecord(preparedRequest.binding)
    const execution =
      input.boundary.mode === 'live'
        ? await executeLiveVlmEvaluation({
            rubric,
            request: preparedRequest,
            budget: budgetPolicy,
            budgetState: initialBudget,
            adapter: input.boundary.adapter,
            replayStore: input.boundary.replayStore,
            timeoutMs: input.boundary.timeoutMs,
          })
        : await executeReplayVlmEvaluation({
            rubric,
            request: preparedRequest,
            budgetState: initialBudget,
            replayStore: input.boundary.replayStore,
          })
    budget = execution.budget
    if (execution.call) calls.push(execution.call)
    if (execution.outcome === 'completed') judgment = execution.judgment
    else if (execution.issue)
    {
      selection = finalizedSelection(
        selection,
        execution.issue.message,
        input.evidenceByCriterion
      )
      initialIssues.push({
        code: execution.issue.code,
        responsibility: execution.issue.responsibility,
        message: execution.issue.message,
      })
    }
  }
  if (calls.length > 1)
    throw new Error(
      'Multimodal evaluation exceeded its one-call escalation bound'
    )
  const providerCallCount = calls.reduce(
    (total, call) => total + call.providerCallCount,
    0
  )
  if (input.request.mode === 'live')
  {
    if (
      budget.liveCallsReserved - initialBudget.liveCallsReserved !==
        providerCallCount ||
      budget.liveCallsAttempted - initialBudget.liveCallsAttempted !==
        providerCallCount ||
      budget.liveCallsSettled - initialBudget.liveCallsSettled !==
        providerCallCount
    )
      throw new Error(
        'Multimodal call records do not match live budget accounting'
      )
  }
  else if (
    providerCallCount !== 0 ||
    hashMultimodalJson(budget) !== hashMultimodalJson(initialBudget)
  )
    throw new Error(
      'non-live Multimodal evaluation changed provider budget state'
    )
  validateEvaluationIssues(initialIssues)
  const verdict = aggregateMultimodalVerdict({
    structuralPreflight: input.structuralPreflight,
    rubricSpec: rubric,
    deterministic: input.deterministic,
    lensSpecs: input.request.lenses,
    lenses: input.lenses,
    rubricJudgment: judgment,
    issues: initialIssues,
  })
  const limitations = [
    ...(input.limitations ?? []),
    ...(selection.stopReason ? [selection.stopReason] : []),
    ...(judgment?.limitations ?? []),
  ].filter((value, index, values) => values.indexOf(value) === index)
  validateLimitations(limitations)
  const report: MultimodalEvaluationReportV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    runId: input.runId,
    createdAt: input.createdAt,
    mode: input.request.mode,
    requestSha256: hashMultimodalJson(input.request),
    input: { ...input.request.input },
    scenarioSha256: input.request.scenarioSha256,
    observationTraceSha256: input.request.observationTraceSha256,
    sampleOrdinal: input.request.sampleOrdinal,
    rubricSha256: hashMultimodalJson(rubric),
    observationPlanSha256,
    structuralPreflight: input.structuralPreflight,
    deterministic: [...input.deterministic],
    selection,
    vlmRequest,
    rubric: judgment,
    differential: input.differential,
    lenses: [...input.lenses],
    calls,
    budget,
    verdict,
    limitations,
    issues: initialIssues,
  }
  return detachedFrozenMultimodalRecord(report)
}

export interface MultimodalEvidenceFacetV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  artifactSha256: string
  evaluationSha256: string
  temporal: ObservationTraceV1 | null
  differentialTemporal: {
    left: ObservationTraceV1
    right: ObservationTraceV1
  } | null
  rubric: RubricJudgmentV1 | null
  differential: DifferentialReportV1 | null
  lenses: LensResultV1[] | null
}

function facetIssue(
  issues: MultimodalContractIssue[],
  path: string,
  code: MultimodalContractIssue['code'],
  message: string
): void
{
  issues.push({ path, code, message })
}

function facetHash(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): string | null
{
  const parsed = multimodalString(value, path, issues, {
    minLength: 64,
    maxLength: 64,
  })
  if (parsed !== null && !/^[0-9a-f]{64}$/.test(parsed))
  {
    facetIssue(issues, path, 'invalid-value', 'expected a SHA-256 digest')
    return null
  }
  return parsed
}

function validateFacetTrace(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  expectedArtifactSha256: string | null
): Record<string, unknown> | null
{
  const temporal = multimodalRecord(value, path, issues)
  if (!temporal) return null
  multimodalExactKeys(
    temporal,
    path,
    [
      'schemaVersion',
      'sourceSb3Sha256',
      'scenarioSha256',
      'plan',
      'planSha256',
      'cloneCounts',
      'media',
    ],
    [],
    issues
  )
  if (temporal.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    facetIssue(
      issues,
      `${path}.schemaVersion`,
      'invalid-value',
      'unsupported observation-trace schema version'
    )
  const sourceSha256 = facetHash(
    temporal.sourceSb3Sha256,
    `${path}.sourceSb3Sha256`,
    issues
  )
  facetHash(temporal.scenarioSha256, `${path}.scenarioSha256`, issues)
  const planSha256 = facetHash(
    temporal.planSha256,
    `${path}.planSha256`,
    issues
  )
  const plan = validateObservationPlan(temporal.plan)
  if (!plan.ok)
    for (const current of plan.issues)
      facetIssue(
        issues,
        `${path}.plan${current.path === '$' ? '' : current.path.slice(1)}`,
        current.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-value',
        current.message
      )
  else if (planSha256 !== hashObservationPlan(plan.value))
    facetIssue(
      issues,
      `${path}.planSha256`,
      'invalid-value',
      'observation-plan hash does not match the trace plan'
    )
  multimodalArray(temporal.cloneCounts, `${path}.cloneCounts`, issues)
  if (temporal.media !== null)
  {
    const media = multimodalRecord(temporal.media, `${path}.media`, issues)
    if (media)
    {
      multimodalExactKeys(
        media,
        `${path}.media`,
        [
          'schemaVersion',
          'observationPlanSha256',
          'runtime',
          'frames',
          'derivedVideo',
          'totalFrameBytes',
          'complete',
          'incompleteReason',
        ],
        [],
        issues
      )
      if (media.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
        facetIssue(
          issues,
          `${path}.media.schemaVersion`,
          'invalid-value',
          'unsupported media-manifest schema version'
        )
      if (media.observationPlanSha256 !== planSha256)
        facetIssue(
          issues,
          `${path}.media.observationPlanSha256`,
          'invalid-value',
          'media manifest does not match the trace plan'
        )
      multimodalRecord(media.runtime, `${path}.media.runtime`, issues)
      multimodalArray(media.frames, `${path}.media.frames`, issues)
      if (
        typeof media.complete !== 'boolean' ||
        (media.complete && media.incompleteReason !== null) ||
        (!media.complete &&
          multimodalString(
            media.incompleteReason,
            `${path}.media.incompleteReason`,
            issues,
            { minLength: 1 }
          ) === null)
      )
        facetIssue(
          issues,
          `${path}.media`,
          'invalid-value',
          'media completeness fields are inconsistent'
        )
    }
  }
  if (
    expectedArtifactSha256 !== null &&
    sourceSha256 !== null &&
    sourceSha256 !== expectedArtifactSha256
  )
    facetIssue(
      issues,
      `${path}.sourceSb3Sha256`,
      'invalid-value',
      'observation trace does not match its expected artifact'
    )
  return temporal
}

export function validateMultimodalEvidenceFacet(
  value: unknown
): MultimodalValidationResult<MultimodalEvidenceFacetV1>
{
  const issues: MultimodalContractIssue[] = []
  try
  {
    detachedFrozenMultimodalRecord(value)
  }
  catch (error)
  {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          code: 'limit-exceeded',
          message: unknownErrorMessage(error),
        },
      ],
    }
  }
  const record = multimodalRecord(value, '$', issues)
  if (!record) return { ok: false, issues }
  multimodalExactKeys(
    record,
    '$',
    [
      'schemaVersion',
      'artifactSha256',
      'evaluationSha256',
      'temporal',
      'differentialTemporal',
      'rubric',
      'differential',
      'lenses',
    ],
    [],
    issues
  )
  if (record.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    facetIssue(
      issues,
      '$.schemaVersion',
      'invalid-value',
      'unsupported Multimodal evidence-facet schema version'
    )
  const artifactSha256 = facetHash(
    record.artifactSha256,
    '$.artifactSha256',
    issues
  )
  facetHash(record.evaluationSha256, '$.evaluationSha256', issues)

  const temporal =
    record.temporal === null
      ? null
      : validateFacetTrace(
          record.temporal,
          '$.temporal',
          issues,
          artifactSha256
        )

  const rubric =
    record.rubric === null
      ? null
      : multimodalRecord(record.rubric, '$.rubric', issues)
  if (rubric)
  {
    if (rubric.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
      facetIssue(
        issues,
        '$.rubric.schemaVersion',
        'invalid-value',
        'unsupported rubric-judgment schema version'
      )
    const provenance = multimodalRecord(
      rubric.provenance,
      '$.rubric.provenance',
      issues
    )
    const context = provenance
      ? multimodalRecord(
          provenance.context,
          '$.rubric.provenance.context',
          issues
        )
      : null
    if (
      context &&
      artifactSha256 !== null &&
      context.artifactSha256 !== artifactSha256
    )
      facetIssue(
        issues,
        '$.rubric.provenance.context.artifactSha256',
        'invalid-value',
        'rubric judgment does not match the facet artifact'
      )
    multimodalArray(rubric.criteria, '$.rubric.criteria', issues)
  }

  const differential =
    record.differential === null
      ? null
      : multimodalRecord(record.differential, '$.differential', issues)
  const lenses =
    record.lenses === null
      ? null
      : multimodalArray(record.lenses, '$.lenses', issues)
  if ((differential === null) !== (lenses === null))
    facetIssue(
      issues,
      '$.lenses',
      'invalid-value',
      'differential and lens evidence must be present together'
    )
  if (differential && lenses)
  {
    const validatedDifferential = validateDifferentialReport(differential)
    if (!validatedDifferential.ok)
      for (const current of validatedDifferential.issues)
        facetIssue(
          issues,
          `$.differential${current.path === '$' ? '' : current.path.slice(1)}`,
          current.code,
          current.message
        )
    if (
      !Array.isArray(differential.results) ||
      hashMultimodalJson(differential.results) !== hashMultimodalJson(lenses)
    )
      facetIssue(
        issues,
        '$.lenses',
        'invalid-value',
        'lens evidence does not match the differential report'
      )
    const left = multimodalRecord(
      differential.left,
      '$.differential.left',
      issues
    )
    const right = multimodalRecord(
      differential.right,
      '$.differential.right',
      issues
    )
    if (
      artifactSha256 !== null &&
      left &&
      right &&
      left.artifactSha256 !== artifactSha256 &&
      right.artifactSha256 !== artifactSha256
    )
      facetIssue(
        issues,
        '$.differential',
        'invalid-value',
        'differential does not include the facet artifact'
      )
  }

  const decisiveVisual = Boolean(
    lenses?.some((value, index) =>
    {
      const lens = multimodalRecord(value, `$.lenses[${index}]`, issues)
      return (
        lens?.kind === 'visual-keyframes' && lens.verdict !== 'inconclusive'
      )
    })
  )
  const differentialTemporal =
    record.differentialTemporal === null
      ? null
      : multimodalRecord(
          record.differentialTemporal,
          '$.differentialTemporal',
          issues
        )
  if (decisiveVisual && temporal === null)
    facetIssue(
      issues,
      '$.temporal',
      'invalid-value',
      'decisive visual lens evidence needs its primary retained trace'
    )
  if ((differentialTemporal === null) === decisiveVisual)
    facetIssue(
      issues,
      '$.differentialTemporal',
      'invalid-value',
      decisiveVisual
        ? 'decisive visual lens evidence needs both retained traces'
        : 'differential traces are only retained for decisive visual lenses'
    )
  if (differentialTemporal)
  {
    multimodalExactKeys(
      differentialTemporal,
      '$.differentialTemporal',
      ['left', 'right'],
      [],
      issues
    )
    const leftBinding = differential
      ? multimodalRecord(differential.left, '$.differential.left', issues)
      : null
    const rightBinding = differential
      ? multimodalRecord(differential.right, '$.differential.right', issues)
      : null
    if (!leftBinding || !rightBinding)
      facetIssue(
        issues,
        '$.differentialTemporal',
        'invalid-value',
        'differential traces need a retained differential report'
      )
    const leftTrace = validateFacetTrace(
      differentialTemporal.left,
      '$.differentialTemporal.left',
      issues,
      typeof leftBinding?.artifactSha256 === 'string'
        ? leftBinding.artifactSha256
        : null
    )
    const rightTrace = validateFacetTrace(
      differentialTemporal.right,
      '$.differentialTemporal.right',
      issues,
      typeof rightBinding?.artifactSha256 === 'string'
        ? rightBinding.artifactSha256
        : null
    )
    for (const [side, trace, binding] of [
      ['left', leftTrace, leftBinding],
      ['right', rightTrace, rightBinding],
    ] as const)
    {
      const media = trace
        ? multimodalRecord(
            trace.media,
            `$.differentialTemporal.${side}.media`,
            issues
          )
        : null
      if (!media || media.complete !== true || media.incompleteReason !== null)
        facetIssue(
          issues,
          `$.differentialTemporal.${side}.media`,
          'invalid-value',
          'decisive visual lens evidence needs a complete media manifest'
        )
      if (
        trace &&
        binding &&
        (trace.scenarioSha256 !== binding.scenarioSha256 ||
          (temporal && trace.planSha256 !== temporal.planSha256) ||
          !media ||
          hashMultimodalJson(media.runtime) !== binding.runtimeDescriptorSha256)
      )
        facetIssue(
          issues,
          `$.differentialTemporal.${side}`,
          'invalid-value',
          'differential trace does not match its report-side runtime context'
        )
    }
    if (
      temporal &&
      rightTrace &&
      hashMultimodalJson(temporal) !== hashMultimodalJson(rightTrace)
    )
      facetIssue(
        issues,
        '$.differentialTemporal.right',
        'invalid-value',
        'the right differential trace must be the primary evaluation trace'
      )
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detachedFrozenMultimodalRecord(value as MultimodalEvidenceFacetV1),
  }
}

export function createMultimodalEvidenceFacet(
  report: MultimodalEvaluationReportV1,
  temporal: ObservationTraceV1 | null,
  differentialTemporal: {
    left: ObservationTraceV1
    right: ObservationTraceV1
  } | null = null
): Readonly<MultimodalEvidenceFacetV1>
{
  const decisiveVisual = report.lenses.some(
    (lens) =>
      lens.kind === 'visual-keyframes' && lens.verdict !== 'inconclusive'
  )
  const temporalRequired =
    report.vlmRequest !== null ||
    report.rubric !== null ||
    report.selection.selectedFrameIds.length > 0 ||
    report.deterministic.some(
      (result) =>
        (result.source === 'temporal' || result.source === 'keyframe') &&
        result.verdict !== 'inconclusive'
    ) ||
    decisiveVisual
  if (
    temporalRequired &&
    (!temporal?.media?.complete || temporal.media.incompleteReason !== null)
  )
    throw new Error(
      'decisive Multimodal media evidence needs its complete retained trace'
    )
  if (temporal)
  {
    if (
      temporal.sourceSb3Sha256 !== report.input.artifactSha256 ||
      temporal.scenarioSha256 !== report.scenarioSha256 ||
      temporal.planSha256 !== report.observationPlanSha256 ||
      hashMultimodalJson(temporal) !== report.observationTraceSha256
    )
      throw new Error('observation trace does not match the Multimodal report')
  }
  if (decisiveVisual !== (differentialTemporal !== null))
    throw new Error(
      decisiveVisual
        ? 'decisive visual lens evidence needs both retained traces'
        : 'differential traces are only retained for decisive visual lenses'
    )
  if (differentialTemporal)
  {
    if (!report.differential || !temporal)
      throw new Error(
        'differential traces need a report and primary evaluation trace'
      )
    for (const [side, trace, binding] of [
      ['left', differentialTemporal.left, report.differential.left],
      ['right', differentialTemporal.right, report.differential.right],
    ] as const)
    {
      if (
        trace.sourceSb3Sha256 !== binding.artifactSha256 ||
        trace.scenarioSha256 !== binding.scenarioSha256 ||
        trace.planSha256 !== report.observationPlanSha256 ||
        !trace.media?.complete ||
        trace.media.incompleteReason !== null ||
        hashMultimodalJson(trace.media.runtime) !==
          binding.runtimeDescriptorSha256
      )
        throw new Error(
          `${side} differential trace does not match its report-side runtime context`
        )
    }
    if (
      hashMultimodalJson(differentialTemporal.right) !==
      hashMultimodalJson(temporal)
    )
      throw new Error(
        'the right differential trace must be the primary evaluation trace'
      )
  }
  const facet: MultimodalEvidenceFacetV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    artifactSha256: report.input.artifactSha256,
    evaluationSha256: hashMultimodalJson(report),
    temporal: temporal ? structuredClone(temporal) : null,
    differentialTemporal: differentialTemporal
      ? structuredClone(differentialTemporal)
      : null,
    rubric: report.rubric ? structuredClone(report.rubric) : null,
    differential: report.differential
      ? structuredClone(report.differential)
      : null,
    lenses: report.differential ? structuredClone(report.lenses) : null,
  }
  const validated = validateMultimodalEvidenceFacet(facet)
  if (!validated.ok)
    throw new Error(
      `invalid Multimodal evidence facet: ${validated.issues[0]?.message ?? 'unknown error'}`
    )
  return validated.value
}
