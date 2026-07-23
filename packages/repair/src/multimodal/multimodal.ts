// packages/repair/src/multimodal/multimodal.ts
// validate artifact-bound Multimodal evidence before repair or promotion

import {
  aggregateMultimodalVerdict,
  copyVlmBytes,
  createVlmBudgetState,
  detachedFrozenMultimodalRecord,
  hashMultimodalContent,
  hashMultimodalJson,
  isCanonicalMultimodalTimestamp,
  MAX_MULTIMODAL_ARRAY_LENGTH,
  MAX_MULTIMODAL_DETERMINISTIC_EVIDENCE,
  MAX_MULTIMODAL_DETERMINISTIC_RESULTS,
  MAX_MULTIMODAL_EVALUATION_ISSUES,
  MAX_MULTIMODAL_ISSUE_CODE_LENGTH,
  MAX_MULTIMODAL_REPORT_LIMITATIONS,
  MAX_MULTIMODAL_REPORT_TEXT_LENGTH,
  MAX_MULTIMODAL_RUN_ID_LENGTH,
  MAX_VLM_CLIP_BYTES,
  MAX_VLM_CLIPS,
  MAX_VLM_IMAGES,
  MAX_VLM_PROMPT_BYTES,
  MAX_VLM_SUBMITTED_MEDIA_BYTES,
  MULTIMODAL_DETERMINISTIC_SOURCES,
  MULTIMODAL_EVALUATION_RESPONSIBILITIES,
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  renderTrustedVlmPrompt,
  VLM_OUTPUT_SCHEMA_ID,
  VLM_OUTPUT_SCHEMA_VERSION,
  validateBehavioralLensSpecs,
  validateDifferentialReport,
  validateNormalizedRubricJudgment,
  validateMultimodalEvidenceLocator,
  validateMultimodalEvidenceFacet,
  validateRubricSpec,
  validateVlmBudget,
  validateVlmBudgetAccounting,
  type DeterministicCriterionResult,
  type MultimodalEvaluationReportV1,
  type MultimodalEvaluationRequest,
  type MultimodalEvidenceFacetV1,
  type MultimodalEvidenceLocator,
  type MultimodalVlmPolicyV1,
  type RubricJudgmentBindingV1,
  type VlmRequestBindingV1,
} from '@scratch-agent/eval'
import {
  hashObservationPlan,
  validateObservationPlan,
  type MediaFrameRefV1,
  type ObservationTraceV1,
} from '@scratch-agent/runner'

const REPAIR_MULTIMODAL_SCHEMA_VERSION = 1 as const

export interface RepairMultimodalRequirementV1
{
  schemaVersion: typeof REPAIR_MULTIMODAL_SCHEMA_VERSION
  required: true
}

export interface RepairMultimodalEvaluationInputV1
{
  schemaVersion: typeof REPAIR_MULTIMODAL_SCHEMA_VERSION
  role: 'baseline' | 'candidate'
  sessionId: string
  attemptNumber: number | null
  requirement: RepairMultimodalRequirementV1
  baselineRequest: MultimodalEvaluationRequest | null
  artifact: {
    sha256: string
    byteLength: number
  }
  artifactBytes: Uint8Array
}

export interface RepairMultimodalEvaluationEnvelopeV1
{
  schemaVersion: typeof REPAIR_MULTIMODAL_SCHEMA_VERSION
  request: MultimodalEvaluationRequest
  report: MultimodalEvaluationReportV1
  evidence: MultimodalEvidenceFacetV1
}

export interface RepairMultimodalEvaluator
{
  evaluate(input: RepairMultimodalEvaluationInputV1): Promise<unknown>
}

interface RepairMultimodalHostEvidenceV1
{
  deterministicCriterionIds: string[]
  agreeingLensIds: string[]
}

export interface RepairMultimodalGateV1
{
  schemaVersion: typeof REPAIR_MULTIMODAL_SCHEMA_VERSION
  required: true
  verdict: MultimodalEvaluationReportV1['verdict']
  hostEvidence: RepairMultimodalHostEvidenceV1
  request: MultimodalEvaluationRequest
  report: MultimodalEvaluationReportV1
  evidence: MultimodalEvidenceFacetV1
}

interface RepairMultimodalIssue
{
  code: string
  message: string
}

type RepairMultimodalValidation =
  | { ok: true; value: Readonly<RepairMultimodalGateV1> }
  | { ok: false; issues: RepairMultimodalIssue[] }

export class RepairMultimodalBoundaryError extends Error
{
  readonly code = 'repair.multimodal.invalid-evaluation'

  constructor(message: string)
  {
    super(message)
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/

function record(value: unknown): Record<string, unknown> | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null
}

function exactKeys(
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

function sameJson(left: unknown, right: unknown): boolean
{
  return hashMultimodalJson(left) === hashMultimodalJson(right)
}

function push(
  issues: RepairMultimodalIssue[],
  code: string,
  message: string
): void
{
  issues.push({ code, message })
}

function boundedText(
  value: unknown,
  allowEmpty = false,
  maxLength = 4096
): value is string
{
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.length > 0)
  )
}

function safeInteger(value: unknown, min = 0): value is number
{
  return Number.isSafeInteger(value) && (value as number) >= min
}

function finiteNumber(
  value: unknown,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
): value is number
{
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  )
}

function portableRelativePath(value: unknown): value is string
{
  if (!boundedText(value) || value.startsWith('/') || value.includes('\\'))
    return false
  const segments = value.split('/')
  return segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
  )
}

function runtimeFileIdentity(value: unknown): boolean
{
  const file = record(value)
  return Boolean(
    file &&
    exactKeys(file, ['path', 'sha256', 'byteLength']) &&
    portableRelativePath(file.path) &&
    typeof file.sha256 === 'string' &&
    SHA256_PATTERN.test(file.sha256) &&
    safeInteger(file.byteLength)
  )
}

function runtimeDescriptor(value: unknown): boolean
{
  const runtime = record(value)
  if (
    !runtime ||
    !exactKeys(runtime, [
      'schemaVersion',
      'id',
      'kind',
      'configurationSha256',
      'renderer',
      'compiler',
      'network',
      'components',
      'browser',
      'bundle',
      'workers',
      'environment',
    ]) ||
    runtime.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !boundedText(runtime.id) ||
    ![
      'scratch-vm-node',
      'scratch-official-browser',
      'turbowarp-browser',
      'headless-gl-experiment',
    ].includes(String(runtime.kind)) ||
    typeof runtime.configurationSha256 !== 'string' ||
    !SHA256_PATTERN.test(runtime.configurationSha256) ||
    !['none', 'scratch-render', 'turbowarp-renderer', 'headless-gl'].includes(
      String(runtime.renderer)
    ) ||
    !['enabled', 'disabled', 'not-applicable'].includes(
      String(runtime.compiler)
    ) ||
    !['denied', 'allowlisted'].includes(String(runtime.network)) ||
    !Array.isArray(runtime.components) ||
    runtime.components.length > 512 ||
    !Array.isArray(runtime.workers) ||
    runtime.workers.length > 512
  )
    return false
  for (const value of runtime.components)
  {
    const component = record(value)
    if (
      !component ||
      !exactKeys(component, ['name', 'version', 'sha256', 'byteLength']) ||
      !boundedText(component.name) ||
      !boundedText(component.version) ||
      (component.sha256 !== null &&
        (typeof component.sha256 !== 'string' ||
          !SHA256_PATTERN.test(component.sha256))) ||
      (component.byteLength !== null && !safeInteger(component.byteLength))
    )
      return false
  }
  if (
    runtime.browser !== null &&
    (() =>
    {
      const browser = record(runtime.browser)
      return !(
        browser &&
        exactKeys(browser, ['name', 'version']) &&
        boundedText(browser.name) &&
        boundedText(browser.version)
      )
    })()
  )
    return false
  if (runtime.bundle !== null && !runtimeFileIdentity(runtime.bundle))
    return false
  if (!runtime.workers.every(runtimeFileIdentity)) return false
  const environment = record(runtime.environment)
  return Boolean(
    environment &&
    exactKeys(environment, ['node', 'platform', 'arch']) &&
    boundedText(environment.node) &&
    boundedText(environment.platform) &&
    boundedText(environment.arch)
  )
}

function rendererGeometry(
  value: unknown,
  width: number,
  height: number
): boolean
{
  const geometry = record(value)
  const canvas = geometry ? record(geometry.canvas) : null
  if (
    !geometry ||
    !exactKeys(geometry, ['canvas', 'targets']) ||
    !canvas ||
    !exactKeys(canvas, ['width', 'height']) ||
    canvas.width !== width ||
    canvas.height !== height ||
    !Array.isArray(geometry.targets) ||
    geometry.targets.length > 512
  )
    return false
  const identities = new Set<string>()
  for (const value of geometry.targets)
  {
    const target = record(value)
    const rect = target?.rect === null ? null : record(target?.rect)
    if (
      !target ||
      !exactKeys(target, [
        'originalTargetId',
        'name',
        'isStage',
        'instance',
        'instanceIndex',
        'visible',
        'costumeIndex',
        'costumeName',
        'rect',
      ]) ||
      !boundedText(target.originalTargetId) ||
      !boundedText(target.name, true) ||
      typeof target.isStage !== 'boolean' ||
      !['original', 'clone'].includes(String(target.instance)) ||
      !safeInteger(target.instanceIndex) ||
      (target.instance === 'original' && target.instanceIndex !== 0) ||
      (target.instance === 'clone' && target.instanceIndex === 0) ||
      (target.isStage &&
        (target.instance !== 'original' || target.instanceIndex !== 0)) ||
      typeof target.visible !== 'boolean' ||
      !safeInteger(target.costumeIndex) ||
      !boundedText(target.costumeName, true) ||
      (target.rect !== null &&
        (!rect ||
          !exactKeys(rect, ['x', 'y', 'width', 'height']) ||
          !finiteNumber(rect.x) ||
          !finiteNumber(rect.y) ||
          !finiteNumber(rect.width, 0) ||
          !finiteNumber(rect.height, 0)))
    )
      return false
    const identity = `${target.originalTargetId}\u0000${target.instance}\u0000${target.instanceIndex}`
    if (identities.has(identity)) return false
    identities.add(identity)
  }
  return true
}

function mediaFrame(value: unknown, index: number): value is MediaFrameRefV1
{
  const frame = record(value)
  if (
    !frame ||
    !exactKeys(frame, [
      'id',
      'index',
      'tick',
      'scenarioStepIndex',
      'snapshotLabel',
      'relativePath',
      'mimeType',
      'width',
      'height',
      'meanRgb',
      'sampledMeanRgb',
      'geometry',
      'bytes',
      'sha256',
    ]) ||
    !boundedText(frame.id) ||
    frame.index !== index ||
    !safeInteger(frame.tick) ||
    !safeInteger(frame.scenarioStepIndex, -1) ||
    (frame.snapshotLabel !== null && !boundedText(frame.snapshotLabel)) ||
    !portableRelativePath(frame.relativePath) ||
    frame.mimeType !== 'image/png' ||
    !safeInteger(frame.width, 1) ||
    !safeInteger(frame.height, 1) ||
    !Array.isArray(frame.meanRgb) ||
    frame.meanRgb.length !== 3 ||
    !frame.meanRgb.every((value) => finiteNumber(value, 0, 255)) ||
    !safeInteger(frame.bytes, 1) ||
    typeof frame.sha256 !== 'string' ||
    !SHA256_PATTERN.test(frame.sha256)
  )
    return false
  const sampled = record(frame.sampledMeanRgb)
  if (
    !sampled ||
    !exactKeys(sampled, ['columns', 'rows', 'values']) ||
    !safeInteger(sampled.columns, 1) ||
    sampled.columns > 64 ||
    !safeInteger(sampled.rows, 1) ||
    sampled.rows > 64 ||
    !Array.isArray(sampled.values) ||
    sampled.values.length !== sampled.columns * sampled.rows * 3 ||
    !sampled.values.every(
      (value) => safeInteger(value) && (value as number) <= 255
    )
  )
    return false
  return rendererGeometry(frame.geometry, frame.width, frame.height)
}

function cloneCountSamples(value: unknown): boolean
{
  if (!Array.isArray(value) || value.length > MAX_MULTIMODAL_ARRAY_LENGTH)
    return false
  let previousTick = -1
  for (const sampleValue of value)
  {
    const sample = record(sampleValue)
    const counts = sample ? record(sample.byOriginalTargetId) : null
    if (
      !sample ||
      !exactKeys(sample, [
        'tick',
        'scenarioStepIndex',
        'snapshotLabel',
        'total',
        'byOriginalTargetId',
      ]) ||
      !safeInteger(sample.tick) ||
      sample.tick <= previousTick ||
      !safeInteger(sample.scenarioStepIndex, -1) ||
      (sample.snapshotLabel !== null && !boundedText(sample.snapshotLabel)) ||
      !safeInteger(sample.total) ||
      !counts ||
      Object.keys(counts).length > 512
    )
      return false
    let total = 0
    for (const [targetId, count] of Object.entries(counts))
    {
      if (!boundedText(targetId) || !safeInteger(count)) return false
      total += count
      if (!Number.isSafeInteger(total)) return false
    }
    if (sample.total !== total) return false
    previousTick = sample.tick
  }
  return true
}

function derivedVideo(
  value: unknown,
  frames: readonly MediaFrameRefV1[],
  playbackFps: number,
  maxBytes: number
): boolean
{
  const video = record(value)
  const firstFrame = frames[0]
  return Boolean(
    video &&
    firstFrame &&
    exactKeys(video, [
      'id',
      'relativePath',
      'mimeType',
      'width',
      'height',
      'durationMs',
      'playbackFps',
      'bytes',
      'sha256',
      'authoritative',
      'sourceFrameIds',
    ]) &&
    boundedText(video.id) &&
    portableRelativePath(video.relativePath) &&
    ['video/webm', 'video/mp4'].includes(String(video.mimeType)) &&
    video.width === firstFrame.width &&
    video.height === firstFrame.height &&
    frames.every(
      (frame) =>
        frame.width === firstFrame.width && frame.height === firstFrame.height
    ) &&
    video.durationMs === Math.round((frames.length * 1000) / playbackFps) &&
    video.playbackFps === playbackFps &&
    safeInteger(video.bytes, 1) &&
    video.bytes <= maxBytes &&
    typeof video.sha256 === 'string' &&
    SHA256_PATTERN.test(video.sha256) &&
    video.authoritative === false &&
    Array.isArray(video.sourceFrameIds) &&
    sameJson(
      video.sourceFrameIds,
      frames.map((frame) => frame.id)
    ) &&
    !frames.some(
      (frame) =>
        frame.id === video.id || frame.relativePath === video.relativePath
    )
  )
}

function validateTemporalTraceShape(
  temporal: ObservationTraceV1 | null,
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  issues: RepairMultimodalIssue[],
  label = 'temporal'
): void
{
  if (!temporal) return
  const cloneShapeValid = cloneCountSamples(temporal.cloneCounts)
  if (
    !exactKeys(temporal as unknown as Record<string, unknown>, [
      'schemaVersion',
      'sourceSb3Sha256',
      'scenarioSha256',
      'plan',
      'planSha256',
      'cloneCounts',
      'media',
    ]) ||
    !cloneShapeValid
  )
    push(
      issues,
      'multimodal.temporal-shape',
      `${label} trace or clone-count samples have an invalid shape`
    )
  if (
    request.observationPlan.cloneCounts === 'none' &&
    temporal.cloneCounts.length > 0
  )
    push(
      issues,
      'multimodal.clone-count-plan',
      'clone-count evidence was retained by a disabled observation plan'
    )
  if (cloneShapeValid && report.verdict === 'passed')
  {
    const ticks = temporal.cloneCounts.map((sample) => sample.tick)
    if (
      request.observationPlan.cloneCounts === 'every-tick' &&
      (ticks.length === 0 ||
        ticks[0] !== 0 ||
        ticks.some(
          (tick, index) => index > 0 && tick !== ticks[index - 1]! + 1
        ))
    )
      push(
        issues,
        'multimodal.clone-count-completeness',
        'a passing every-tick clone trace must cover every tick from zero'
      )
    const temporalPlan = request.observationPlan.temporal
    if (
      request.observationPlan.cloneCounts === 'sampled' &&
      temporalPlan &&
      temporal.media?.complete
    )
    {
      const retained = new Set(ticks)
      for (
        let tick = temporalPlan.firstTick;
        tick <= temporalPlan.lastTick;
        tick += temporalPlan.everyTicks
      )
        if (!retained.has(tick))
        {
          push(
            issues,
            'multimodal.clone-count-completeness',
            'a passing sampled clone trace must cover every temporal sample'
          )
          break
        }
    }
  }
  const plan = request.observationPlan.temporal
  const manifest = temporal.media
  if (!plan)
  {
    if (manifest !== null)
      push(
        issues,
        'multimodal.temporal-plan',
        'a non-temporal observation plan cannot retain media'
      )
    return
  }
  if (!manifest) return
  if (
    !exactKeys(manifest as unknown as Record<string, unknown>, [
      'schemaVersion',
      'observationPlanSha256',
      'runtime',
      'frames',
      'derivedVideo',
      'totalFrameBytes',
      'complete',
      'incompleteReason',
    ]) ||
    manifest.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !runtimeDescriptor(manifest.runtime) ||
    !Array.isArray(manifest.frames) ||
    manifest.frames.length > plan.maxFrames ||
    typeof manifest.complete !== 'boolean' ||
    (manifest.complete && manifest.incompleteReason !== null) ||
    (!manifest.complete && !boundedText(manifest.incompleteReason)) ||
    !safeInteger(manifest.totalFrameBytes)
  )
  {
    push(
      issues,
      'multimodal.temporal-manifest-shape',
      `${label} media manifest has an invalid shape`
    )
    return
  }
  const frames: MediaFrameRefV1[] = []
  const frameIds = new Set<string>()
  const paths = new Set<string>()
  let totalBytes = 0
  let previousTick = -1
  for (const [index, value] of manifest.frames.entries())
  {
    if (!mediaFrame(value, index))
    {
      push(
        issues,
        'multimodal.temporal-frame-shape',
        `temporal frame ${index} has an invalid nested shape`
      )
      continue
    }
    const frame = value
    frames.push(frame)
    if (
      frameIds.has(frame.id) ||
      paths.has(frame.relativePath) ||
      frame.tick <= previousTick ||
      frame.tick < plan.firstTick ||
      frame.tick > plan.lastTick ||
      (frame.tick - plan.firstTick) % plan.everyTicks !== 0
    )
      push(
        issues,
        'multimodal.temporal-frame-identity',
        `temporal frame ${index} has an invalid identity or scheduled tick`
      )
    frameIds.add(frame.id)
    paths.add(frame.relativePath)
    previousTick = frame.tick
    totalBytes += frame.bytes
  }
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes !== manifest.totalFrameBytes ||
    totalBytes > plan.maxBytes
  )
    push(
      issues,
      'multimodal.temporal-byte-total',
      'temporal frame byte total violates its manifest or plan budget'
    )
  const expectedTicks: number[] = []
  for (
    let tick = plan.firstTick;
    tick <= plan.lastTick;
    tick += plan.everyTicks
  )
    expectedTicks.push(tick)
  if (
    manifest.complete &&
    !sameJson(
      frames.map((frame) => frame.tick),
      expectedTicks
    )
  )
    push(
      issues,
      'multimodal.temporal-completeness',
      'complete temporal media must retain every scheduled logical frame'
    )
  if (
    (plan.derivedVideo &&
      ((manifest.complete &&
        !derivedVideo(
          manifest.derivedVideo,
          frames,
          plan.playbackFps,
          plan.maxBytes
        )) ||
        (!manifest.complete && manifest.derivedVideo !== null))) ||
    (!plan.derivedVideo && manifest.derivedVideo !== null)
  )
    push(
      issues,
      'multimodal.temporal-video',
      'derived video does not match its observation plan and source frames'
    )
}

function stringList(
  value: unknown,
  unique = false,
  maxItems = 512,
  maxTextLength = 4096
): value is string[]
{
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => boundedText(entry, false, maxTextLength)) &&
    (!unique || new Set(value).size === value.length)
  )
}

function providerDescriptor(value: unknown): boolean
{
  const descriptor = record(value)
  return Boolean(
    descriptor &&
    exactKeys(descriptor, ['adapter', 'provider', 'model', 'version']) &&
    boundedText(descriptor.adapter) &&
    boundedText(descriptor.provider) &&
    boundedText(descriptor.model) &&
    boundedText(descriptor.version)
  )
}

function nullableNonnegativeNumber(value: unknown): boolean
{
  return value === null || finiteNumber(value, 0)
}

function nullableNonnegativeInteger(value: unknown): boolean
{
  return value === null || safeInteger(value)
}

function vlmUsage(value: unknown): boolean
{
  const usage = record(value)
  if (
    !usage ||
    !exactKeys(usage, [
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'available',
      'unavailableReason',
    ]) ||
    !nullableNonnegativeInteger(usage.inputTokens) ||
    !nullableNonnegativeInteger(usage.outputTokens) ||
    !nullableNonnegativeInteger(usage.totalTokens) ||
    typeof usage.available !== 'boolean' ||
    (usage.unavailableReason !== null && !boundedText(usage.unavailableReason))
  )
    return false
  const inputTokens = usage.inputTokens as number | null
  const outputTokens = usage.outputTokens as number | null
  const totalTokens = usage.totalTokens as number | null
  if (usage.available)
    return (
      inputTokens !== null &&
      outputTokens !== null &&
      totalTokens === inputTokens + outputTokens &&
      usage.unavailableReason === null
    )
  return (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null &&
    usage.unavailableReason !== null
  )
}

function vlmEstimate(value: unknown): boolean
{
  const estimate = record(value)
  if (
    !estimate ||
    !exactKeys(estimate, [
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'usd',
      'pricingTableVersion',
      'unavailableReason',
    ]) ||
    !nullableNonnegativeInteger(estimate.inputTokens) ||
    !nullableNonnegativeInteger(estimate.outputTokens) ||
    !nullableNonnegativeInteger(estimate.totalTokens) ||
    !nullableNonnegativeNumber(estimate.usd) ||
    (estimate.pricingTableVersion !== null &&
      !boundedText(estimate.pricingTableVersion)) ||
    (estimate.unavailableReason !== null &&
      !boundedText(estimate.unavailableReason))
  )
    return false
  const inputTokens = estimate.inputTokens as number | null
  const outputTokens = estimate.outputTokens as number | null
  const totalTokens = estimate.totalTokens as number | null
  if (
    inputTokens !== null &&
    outputTokens !== null &&
    totalTokens !== inputTokens + outputTokens
  )
    return false
  if (estimate.usd !== null && estimate.pricingTableVersion === null)
    return false
  const complete =
    inputTokens !== null &&
    outputTokens !== null &&
    totalTokens !== null &&
    estimate.usd !== null
  return complete
    ? estimate.unavailableReason === null
    : estimate.unavailableReason !== null
}

function vlmCost(value: unknown): boolean
{
  const cost = record(value)
  if (
    !cost ||
    !exactKeys(cost, [
      'billedUsd',
      'estimatedUsd',
      'accountedUsd',
      'pricingTableVersion',
      'source',
      'unavailableReason',
    ]) ||
    !nullableNonnegativeNumber(cost.billedUsd) ||
    !nullableNonnegativeNumber(cost.estimatedUsd) ||
    !nullableNonnegativeNumber(cost.accountedUsd) ||
    (cost.pricingTableVersion !== null &&
      !boundedText(cost.pricingTableVersion)) ||
    (cost.unavailableReason !== null && !boundedText(cost.unavailableReason)) ||
    !['billed', 'estimated', 'unavailable', 'replay-zero'].includes(
      String(cost.source)
    )
  )
    return false
  if (cost.source === 'billed')
    return (
      cost.billedUsd !== null &&
      cost.accountedUsd === cost.billedUsd &&
      cost.unavailableReason === null
    )
  if (cost.source === 'estimated')
    return (
      cost.billedUsd === null &&
      cost.estimatedUsd !== null &&
      cost.accountedUsd === cost.estimatedUsd &&
      cost.pricingTableVersion !== null &&
      cost.unavailableReason === null
    )
  if (cost.source === 'unavailable')
    return (
      cost.billedUsd === null &&
      cost.estimatedUsd === null &&
      cost.accountedUsd === null &&
      cost.unavailableReason !== null
    )
  return (
    cost.billedUsd === null &&
    cost.estimatedUsd === null &&
    cost.accountedUsd === 0 &&
    cost.pricingTableVersion === null &&
    cost.unavailableReason === null
  )
}

function vlmCallError(value: unknown): boolean
{
  const error = record(value)
  return Boolean(
    error &&
    exactKeys(error, ['code', 'message', 'retryable']) &&
    boundedText(error.code) &&
    boundedText(error.message) &&
    typeof error.retryable === 'boolean'
  )
}

const VLM_OUTCOMES = Object.freeze([
  'completed',
  'refused',
  'truncated',
  'provider-error',
  'invalid-response',
  'budget-overrun',
])

function sharedVlmTelemetry(value: Record<string, unknown>): boolean
{
  return (
    providerDescriptor(value.descriptor) &&
    (value.responseModel === null || boundedText(value.responseModel)) &&
    VLM_OUTCOMES.includes(String(value.outcome)) &&
    (value.responseSha256 === null ||
      (typeof value.responseSha256 === 'string' &&
        SHA256_PATTERN.test(value.responseSha256))) &&
    finiteNumber(value.latencyMs, 0) &&
    vlmUsage(value.usage) &&
    vlmEstimate(value.estimate) &&
    vlmCost(value.cost) &&
    (value.error === null || vlmCallError(value.error))
  )
}

function liveTelemetry(value: unknown): boolean
{
  const telemetry = record(value)
  if (
    !telemetry ||
    !exactKeys(telemetry, [
      'descriptor',
      'responseModel',
      'outcome',
      'responseSha256',
      'latencyMs',
      'usage',
      'estimate',
      'cost',
      'error',
    ]) ||
    !sharedVlmTelemetry(telemetry)
  )
    return false
  return telemetry.outcome === 'completed'
    ? telemetry.responseSha256 !== null && telemetry.error === null
    : telemetry.error !== null
}

function vlmCall(
  value: unknown,
  mode: MultimodalEvaluationRequest['mode']
): boolean
{
  const call = record(value)
  if (
    !call ||
    !exactKeys(call, [
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
    ]) ||
    call.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    typeof call.requestSha256 !== 'string' ||
    !SHA256_PATTERN.test(call.requestSha256) ||
    call.requestKey !== `multimodal-vlm-v1:${call.requestSha256}` ||
    !sharedVlmTelemetry(call)
  )
    return false
  if (
    (call.outcome === 'completed' &&
      (call.responseSha256 === null ||
        call.responseModel === null ||
        call.error !== null)) ||
    (call.outcome !== 'completed' && call.error === null)
  )
    return false
  if (mode === 'live')
    return (
      call.mode === 'live' &&
      call.providerCallCount === 1 &&
      call.replaySourceSha256 === null &&
      call.originalLive === null &&
      record(call.cost)?.source !== 'replay-zero'
    )
  if (mode !== 'replay') return false
  if (
    call.mode !== 'replay' ||
    call.providerCallCount !== 0 ||
    typeof call.replaySourceSha256 !== 'string' ||
    !SHA256_PATTERN.test(call.replaySourceSha256) ||
    !liveTelemetry(call.originalLive) ||
    record(call.cost)?.source !== 'replay-zero'
  )
    return false
  const original = record(call.originalLive)!
  return (
    sameJson(call.descriptor, original.descriptor) &&
    call.responseModel === original.responseModel &&
    call.responseSha256 === original.responseSha256 &&
    call.outcome === 'completed' &&
    original.outcome === 'completed' &&
    original.error === null &&
    sameJson(call.usage, {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      available: true,
      unavailableReason: null,
    }) &&
    sameJson(call.estimate, {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usd: 0,
      pricingTableVersion: 'replay-zero-v1',
      unavailableReason: null,
    }) &&
    sameJson(call.cost, {
      billedUsd: null,
      estimatedUsd: null,
      accountedUsd: 0,
      pricingTableVersion: null,
      source: 'replay-zero',
      unavailableReason: null,
    })
  )
}

function costMatchesEstimate(
  costValue: unknown,
  estimateValue: unknown
): boolean
{
  const cost = record(costValue)
  const estimate = record(estimateValue)
  if (!cost || !estimate) return false
  if (cost.billedUsd !== null)
    return (
      cost.source === 'billed' &&
      cost.estimatedUsd === estimate.usd &&
      cost.accountedUsd === cost.billedUsd &&
      cost.pricingTableVersion === estimate.pricingTableVersion &&
      cost.unavailableReason === null
    )
  if (estimate.usd !== null)
    return (
      cost.source === 'estimated' &&
      cost.billedUsd === null &&
      cost.estimatedUsd === estimate.usd &&
      cost.accountedUsd === estimate.usd &&
      cost.pricingTableVersion === estimate.pricingTableVersion &&
      cost.unavailableReason === null
    )
  return (
    cost.source === 'unavailable' &&
    cost.billedUsd === null &&
    cost.estimatedUsd === null &&
    cost.accountedUsd === null &&
    cost.pricingTableVersion === estimate.pricingTableVersion &&
    cost.unavailableReason ===
      (estimate.unavailableReason ?? 'provider cost and estimate unavailable')
  )
}

function vlmIdentity(value: unknown, maxLength = 256): boolean
{
  const identity = record(value)
  return Boolean(
    identity &&
    exactKeys(identity, ['id', 'version', 'sha256']) &&
    boundedText(identity.id, false, maxLength) &&
    boundedText(identity.version, false, maxLength) &&
    typeof identity.sha256 === 'string' &&
    SHA256_PATTERN.test(identity.sha256)
  )
}

function multimodalVlmPolicy(
  value: unknown,
  mode: MultimodalEvaluationRequest['mode']
): value is MultimodalVlmPolicyV1 | null
{
  if (mode === 'deterministic') return value === null
  if (mode !== 'live' && mode !== 'replay') return false
  const policy = record(value)
  const prompt = record(policy?.prompt)
  const provider = record(policy?.provider)
  const generation = record(policy?.generation)
  if (
    !policy ||
    !exactKeys(policy, ['prompt', 'provider', 'generation']) ||
    !prompt ||
    !exactKeys(prompt, ['template', 'templateText']) ||
    !vlmIdentity(prompt.template, 128) ||
    !boundedText(prompt.templateText, false, MAX_VLM_PROMPT_BYTES) ||
    Buffer.byteLength(prompt.templateText, 'utf8') > MAX_VLM_PROMPT_BYTES ||
    hashMultimodalContent(prompt.templateText) !==
      record(prompt.template)?.sha256 ||
    !provider ||
    !providerDescriptor(provider) ||
    Object.values(provider).some((entry) => !boundedText(entry, false, 256)) ||
    !generation ||
    !exactKeys(generation, ['temperature', 'maxOutputTokens']) ||
    (generation.temperature !== null &&
      !finiteNumber(generation.temperature, 0, 2)) ||
    !safeInteger(generation.maxOutputTokens, 1)
  )
    return false
  return true
}

function validateVlmRequestBinding(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  sourceFrames: ReadonlyMap<string, MediaFrameRefV1>,
  issues: RepairMultimodalIssue[]
): VlmRequestBindingV1 | null
{
  const binding = report.vlmRequest
  if (!binding)
  {
    if (
      report.rubric !== null ||
      report.calls.length > 0 ||
      report.selection.vlmCriterionIds.length > 0
    )
      push(
        issues,
        'multimodal.vlm-request-missing',
        'provider evidence needs its retained prepared request binding'
      )
    return null
  }
  const bindingRecord = record(binding)
  const context = record(binding.context)
  const evidence = record(binding.evidence)
  const prompt = record(binding.prompt)
  const generation = record(binding.generation)
  const policy = multimodalVlmPolicy(request.vlmPolicy, request.mode)
    ? request.vlmPolicy
    : null
  if (
    request.mode === 'deterministic' ||
    !policy ||
    !bindingRecord ||
    !exactKeys(bindingRecord, [
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
    ]) ||
    binding.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !context ||
    !exactKeys(context, [
      'artifactSha256',
      'scenarioSha256',
      'observationPlanSha256',
      'observationTraceSha256',
      'sampleOrdinal',
    ]) ||
    !vlmIdentity(binding.rubric) ||
    !evidence ||
    !exactKeys(evidence, [
      'sha256',
      'frameCount',
      'clipIds',
      'submittedMediaBytes',
    ]) ||
    !prompt ||
    !exactKeys(prompt, [
      'template',
      'renderedSha256',
      'rubricSha256',
      'evidenceSha256',
      'criterionEvidenceSha256',
      'selectedCriterionIds',
    ]) ||
    !vlmIdentity(prompt.template) ||
    !vlmIdentity(binding.outputSchema) ||
    !providerDescriptor(binding.provider) ||
    !generation ||
    !exactKeys(generation, ['temperature', 'maxOutputTokens']) ||
    !Array.isArray(binding.selectedCriterionIds) ||
    !Array.isArray(binding.criterionEvidence) ||
    !Array.isArray(binding.frames)
  )
  {
    push(
      issues,
      'multimodal.vlm-request-shape',
      'retained VLM request binding violates its strict nested contract'
    )
    return null
  }

  if (
    binding.context.artifactSha256 !== request.input.artifactSha256 ||
    binding.context.scenarioSha256 !== request.scenarioSha256 ||
    binding.context.observationPlanSha256 !== report.observationPlanSha256 ||
    binding.context.observationTraceSha256 !== request.observationTraceSha256 ||
    binding.context.sampleOrdinal !== request.sampleOrdinal
  )
    push(
      issues,
      'multimodal.vlm-request-context',
      'retained VLM request context does not match the evaluation request'
    )
  const rubricSha256 = hashMultimodalJson(request.rubric)
  if (
    binding.rubric.id !== request.rubric.id ||
    binding.rubric.version !== request.rubric.version ||
    binding.rubric.sha256 !== rubricSha256
  )
    push(
      issues,
      'multimodal.vlm-request-rubric',
      'retained VLM request does not bind the trusted rubric'
    )

  const selectedCriterionIds = binding.selectedCriterionIds
  const selected = new Set(selectedCriterionIds)
  const expectedOrder = request.rubric.criteria
    .filter((criterion) => selected.has(criterion.id))
    .map((criterion) => criterion.id)
  if (
    selectedCriterionIds.length === 0 ||
    selectedCriterionIds.length > request.rubric.criteria.length ||
    selected.size !== selectedCriterionIds.length ||
    !sameJson(selectedCriterionIds, expectedOrder) ||
    !request.rubric.criteria.some(
      (criterion) =>
        criterion.requirement === 'required' && selected.has(criterion.id)
    ) ||
    selectedCriterionIds.some(
      (criterionId) => !boundedText(criterionId, false, 128)
    )
  )
    push(
      issues,
      'multimodal.vlm-request-selection',
      'retained VLM criteria are not an ordered required rubric subset'
    )

  const frameIds = new Set<string>()
  const evidenceFrameIds = new Set<string>()
  const clipBytes = new Map<string, number>()
  let submittedMediaBytes = 0
  for (const [index, value] of binding.frames.entries())
  {
    const frame = record(value)
    if (
      !frame ||
      !exactKeys(frame, [
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
      ]) ||
      !boundedText(frame.evidenceId, false, 256) ||
      !boundedText(frame.frameId, false, 256) ||
      (frame.clipId !== null && !boundedText(frame.clipId, false, 256)) ||
      !safeInteger(frame.tick) ||
      frame.mimeType !== 'image/png' ||
      !safeInteger(frame.bytes, 1) ||
      typeof frame.sha256 !== 'string' ||
      !SHA256_PATTERN.test(frame.sha256) ||
      !safeInteger(frame.width, 1) ||
      !safeInteger(frame.height, 1) ||
      !['low', 'high', 'original'].includes(String(frame.detail))
    )
    {
      push(
        issues,
        'multimodal.vlm-request-frame',
        `retained VLM frame ${index} has an invalid shape`
      )
      continue
    }
    const frameId = frame.frameId as string
    const evidenceFrameId = `${frame.evidenceId}\u0000${frameId}`
    if (frameIds.has(frameId) || evidenceFrameIds.has(evidenceFrameId))
      push(
        issues,
        'multimodal.vlm-request-frame',
        `retained VLM frame ${index} duplicates an evidence identity`
      )
    frameIds.add(frameId)
    evidenceFrameIds.add(evidenceFrameId)
    const source = sourceFrames.get(frameId)
    if (
      !source ||
      source.tick !== frame.tick ||
      source.mimeType !== frame.mimeType ||
      source.bytes !== frame.bytes ||
      source.sha256 !== frame.sha256 ||
      source.width !== frame.width ||
      source.height !== frame.height
    )
      push(
        issues,
        'multimodal.vlm-request-frame-binding',
        `retained VLM frame ${frameId} is not the exact source PNG frame`
      )
    submittedMediaBytes += frame.bytes as number
    const clipId = frame.clipId as string | null
    const clipKey = clipId ?? '\u0000unclipped'
    const bytes = (clipBytes.get(clipKey) ?? 0) + (frame.bytes as number)
    clipBytes.set(clipKey, bytes)
  }
  if (
    binding.frames.length === 0 ||
    binding.frames.length > MAX_VLM_IMAGES ||
    !Number.isSafeInteger(submittedMediaBytes) ||
    submittedMediaBytes > MAX_VLM_SUBMITTED_MEDIA_BYTES ||
    [...clipBytes.values()].some((bytes) => bytes > MAX_VLM_CLIP_BYTES)
  )
    push(
      issues,
      'multimodal.vlm-request-media-bound',
      'retained VLM media exceeds its hard image or byte bounds'
    )
  const expectedClipIds = [
    ...new Set(
      binding.frames.flatMap((frame) =>
        frame.clipId === null ? [] : [frame.clipId]
      )
    ),
  ]
  if (
    binding.evidence.sha256 !== hashMultimodalJson(binding.frames) ||
    binding.evidence.frameCount !== binding.frames.length ||
    binding.evidence.submittedMediaBytes !== submittedMediaBytes ||
    !sameJson(binding.evidence.clipIds, expectedClipIds) ||
    expectedClipIds.length > MAX_VLM_CLIPS
  )
    push(
      issues,
      'multimodal.vlm-request-evidence',
      'retained VLM evidence summary does not re-derive from its frames'
    )

  const mappedFrameIds = new Set<string>()
  if (binding.criterionEvidence.length !== selectedCriterionIds.length)
    push(
      issues,
      'multimodal.vlm-request-criterion-evidence',
      'retained criterion evidence does not cover the VLM selection'
    )
  for (const [index, value] of binding.criterionEvidence.entries())
  {
    const entry = record(value)
    if (
      !entry ||
      !exactKeys(entry, ['criterionId', 'frameIds']) ||
      entry.criterionId !== selectedCriterionIds[index] ||
      !Array.isArray(entry.frameIds) ||
      entry.frameIds.length === 0 ||
      entry.frameIds.length > MAX_VLM_IMAGES ||
      !entry.frameIds.every((frameId) => boundedText(frameId, false, 256)) ||
      new Set(entry.frameIds).size !== entry.frameIds.length ||
      entry.frameIds.some((frameId) => !frameIds.has(frameId))
    )
    {
      push(
        issues,
        'multimodal.vlm-request-criterion-evidence',
        `retained criterion evidence ${index} is invalid`
      )
      continue
    }
    for (const frameId of entry.frameIds as string[])
      mappedFrameIds.add(frameId)
  }
  if (mappedFrameIds.size !== frameIds.size)
    push(
      issues,
      'multimodal.vlm-request-criterion-evidence',
      'retained VLM request contains unrelated source frames'
    )

  const criterionEvidenceSha256 = hashMultimodalJson(binding.criterionEvidence)
  const canonicalOutputSchema = {
    id: VLM_OUTPUT_SCHEMA_ID,
    version: VLM_OUTPUT_SCHEMA_VERSION,
    sha256: hashMultimodalJson(RUBRIC_JUDGMENT_JSON_SCHEMA),
  }
  let renderedPromptSha256: string | null = null
  try
  {
    renderedPromptSha256 = hashMultimodalContent(
      renderTrustedVlmPrompt({
        template: policy.prompt.template,
        templateText: policy.prompt.templateText,
        rubric: request.rubric,
        rubricSha256,
        selectedCriterionIds: [...binding.selectedCriterionIds],
        criterionEvidence: binding.criterionEvidence.map((entry) => ({
          criterionId: entry.criterionId,
          frameIds: [...entry.frameIds],
        })),
        frames: binding.frames.map((frame) => ({ ...frame })),
        outputSchema: canonicalOutputSchema,
      })
    )
  }
  catch
  {
    renderedPromptSha256 = null
  }
  if (
    !sameJson(binding.prompt.template, policy.prompt.template) ||
    binding.prompt.rubricSha256 !== binding.rubric.sha256 ||
    binding.prompt.evidenceSha256 !== binding.evidence.sha256 ||
    binding.prompt.criterionEvidenceSha256 !== criterionEvidenceSha256 ||
    !sameJson(
      binding.prompt.selectedCriterionIds,
      binding.selectedCriterionIds
    ) ||
    !SHA256_PATTERN.test(binding.prompt.renderedSha256) ||
    renderedPromptSha256 === null ||
    binding.prompt.renderedSha256 !== renderedPromptSha256
  )
    push(
      issues,
      'multimodal.vlm-request-prompt',
      'retained VLM prompt hashes do not bind its trusted inputs'
    )
  if (!sameJson(binding.outputSchema, canonicalOutputSchema))
    push(
      issues,
      'multimodal.vlm-request-schema',
      'retained VLM request does not use the canonical judgment schema'
    )
  if (
    !sameJson(binding.provider, policy.provider) ||
    !sameJson(binding.generation, policy.generation) ||
    !boundedText(binding.provider.adapter, false, 256) ||
    !boundedText(binding.provider.provider, false, 256) ||
    !boundedText(binding.provider.model, false, 256) ||
    !boundedText(binding.provider.version, false, 256) ||
    (binding.generation.temperature !== null &&
      !finiteNumber(binding.generation.temperature, 0, 2)) ||
    !safeInteger(binding.generation.maxOutputTokens, 1)
  )
    push(
      issues,
      'multimodal.vlm-request-execution',
      'retained VLM provider or generation binding is invalid'
    )

  const requestSha256 = hashMultimodalJson(binding)
  const call = report.calls[0]
  if (
    call &&
    (call.requestSha256 !== requestSha256 ||
      call.requestKey !== `multimodal-vlm-v1:${requestSha256}` ||
      !sameJson(call.descriptor, binding.provider) ||
      (call.responseModel !== null &&
        call.responseModel !== binding.provider.model &&
        call.error?.code !== 'response-model-mismatch'))
  )
    push(
      issues,
      'multimodal.vlm-call-request-binding',
      'provider call does not match the retained VLM request binding'
    )

  if (report.rubric)
  {
    const framesById = new Map(
      binding.frames.map((frame) => [frame.frameId, frame])
    )
    const criterionEvidence = binding.criterionEvidence.map((entry) => ({
      criterionId: entry.criterionId,
      frameIds: entry.frameIds,
      clipIds: [
        ...new Set(
          entry.frameIds.flatMap((frameId) =>
          {
            const clipId = framesById.get(frameId)?.clipId
            return clipId ? [clipId] : []
          })
        ),
      ],
    }))
    const frameSelection = binding.frames.map((frame) => frame.frameId)
    if (
      report.calls.length !== 1 ||
      report.calls[0]!.outcome !== 'completed' ||
      !sameJson(report.selection.vlmCriterionIds, selectedCriterionIds) ||
      !sameJson(report.selection.vlmFrameIds, frameSelection) ||
      !sameJson(report.selection.vlmClipIds, expectedClipIds) ||
      !sameJson(report.selection.vlmEvidenceByCriterion, criterionEvidence)
    )
      push(
        issues,
        'multimodal.vlm-completed-selection',
        'completed provider evidence does not match its retained selection'
      )
  }
  else
  {
    const failureIssue = report.issues.find(
      (issue) => issue.message === report.selection.stopReason
    )
    if (
      report.verdict === 'passed' ||
      report.selection.stopReason === null ||
      !failureIssue ||
      report.selection.vlmCriterionIds.length > 0 ||
      report.selection.vlmFrameIds.length > 0 ||
      report.selection.vlmClipIds.length > 0 ||
      report.selection.vlmEvidenceByCriterion.length > 0 ||
      selectedCriterionIds.some((criterionId) =>
      {
        const decision = report.selection.decisions.find(
          (current) => current.criterionId === criterionId
        )
        return (
          decision?.decision !== 'stop-inconclusive' ||
          decision.reason !== report.selection.stopReason
        )
      })
    )
      push(
        issues,
        'multimodal.vlm-failure-binding',
        'inconclusive provider execution is not bound to its retained failure'
      )
    if (
      call?.error &&
      (report.selection.stopReason !== call.error.message ||
        !report.issues.some(
          (issue) =>
            issue.code === call.error!.code &&
            issue.message === call.error!.message &&
            issue.responsibility ===
              (call.outcome === 'budget-overrun' ? 'policy' : 'provider')
        ))
    )
      push(
        issues,
        'multimodal.vlm-failure-binding',
        'provider call error does not match the retained evaluation issue'
      )
    if (
      call?.outcome === 'completed' &&
      (report.mode !== 'live' ||
        !report.issues.some(
          (issue) =>
            issue.code === 'replay-record-write-failed' &&
            issue.responsibility === 'infrastructure' &&
            issue.message === report.selection.stopReason
        ))
    )
      push(
        issues,
        'multimodal.vlm-failure-binding',
        'completed call without judgment lacks its replay-write failure'
      )
  }
  return binding
}

// repair owns a standalone evaluation; cumulative provider state is inadmissible
function validateCallAccounting(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  binding: VlmRequestBindingV1 | null,
  issues: RepairMultimodalIssue[]
): void
{
  const fresh = createVlmBudgetState(request.budget)
  if (report.mode === 'replay')
  {
    if (!sameJson(report.budget, fresh))
      push(
        issues,
        'multimodal.budget-call-binding',
        'standalone repair evaluation budget does not match its retained calls'
      )
    if (report.calls.length === 1)
    {
      const original = report.calls[0]!.originalLive
      if (!original || !costMatchesEstimate(original.cost, original.estimate))
        push(
          issues,
          'multimodal.call-telemetry-binding',
          'replayed live telemetry does not match its retained estimate'
        )
      if (
        original &&
        binding &&
        (original.estimate.outputTokens !==
          binding.generation.maxOutputTokens ||
          !sameJson(original.descriptor, binding.provider) ||
          (original.usage.inputTokens !== null &&
            original.estimate.inputTokens !== null &&
            original.usage.inputTokens > original.estimate.inputTokens) ||
          (original.usage.outputTokens !== null &&
            original.usage.outputTokens > binding.generation.maxOutputTokens) ||
          (original.cost.accountedUsd !== null &&
            original.estimate.usd !== null &&
            original.cost.accountedUsd > original.estimate.usd))
      )
        push(
          issues,
          'multimodal.call-telemetry-binding',
          'replayed live telemetry exceeds its retained generation request'
        )
    }
    return
  }
  if (report.calls.length === 0)
  {
    if (!sameJson(report.budget, fresh))
      push(
        issues,
        'multimodal.budget-call-binding',
        'standalone repair evaluation budget changed without a provider call'
      )
    return
  }
  if (report.mode !== 'live' || report.calls.length !== 1) return
  const call = report.calls[0]!
  if (!costMatchesEstimate(call.cost, call.estimate))
    push(
      issues,
      'multimodal.call-telemetry-binding',
      'live call cost does not match its retained estimate'
    )
  if (!binding)
  {
    push(
      issues,
      'multimodal.budget-call-binding',
      'live call accounting needs its retained VLM request binding'
    )
    return
  }
  const maxOutputTokens = binding.generation.maxOutputTokens
  if (
    call.estimate.outputTokens !== null &&
    call.estimate.outputTokens !== maxOutputTokens
  )
    push(
      issues,
      'multimodal.call-telemetry-binding',
      'live call output estimate does not match its generation request'
    )
  const chargedInputTokens = call.usage.inputTokens ?? call.estimate.inputTokens
  const chargedOutputTokens = call.usage.outputTokens ?? maxOutputTokens
  const chargedCostUsd = call.cost.accountedUsd
  const settlementOverrun =
    (request.budget.maxInputTokens !== null &&
      (chargedInputTokens === null ||
        chargedInputTokens > request.budget.maxInputTokens)) ||
    chargedOutputTokens > request.budget.maxCumulativeOutputTokens ||
    (request.budget.maxCostUsd !== null &&
      (chargedCostUsd === null ||
        chargedCostUsd > request.budget.maxCostUsd)) ||
    (call.usage.inputTokens !== null &&
      call.estimate.inputTokens !== null &&
      call.usage.inputTokens > call.estimate.inputTokens) ||
    (call.usage.outputTokens !== null &&
      call.usage.outputTokens > maxOutputTokens) ||
    (call.cost.accountedUsd !== null &&
      call.estimate.usd !== null &&
      call.cost.accountedUsd > call.estimate.usd)
  const usage = call.usage
  const cost = call.cost
  const expected = {
    schemaVersion: REPAIR_MULTIMODAL_SCHEMA_VERSION,
    liveCallsReserved: 1,
    liveCallsAttempted: 1,
    liveCallsSettled: 1,
    submittedMediaBytes: binding.evidence.submittedMediaBytes,
    submittedClipIds: [...binding.evidence.clipIds],
    chargedInputTokens,
    chargedOutputTokens,
    chargedCostUsd: cost.accountedUsd,
    observedInputTokens: usage.inputTokens,
    observedOutputTokens: usage.outputTokens,
    observedTotalTokens: usage.totalTokens,
    billedCostUsd: cost.billedUsd,
    estimatedCostUsd: call.estimate.usd,
    overrunReasons: settlementOverrun ? ['settlement-overrun'] : [],
  }
  if (!sameJson(report.budget, expected))
    push(
      issues,
      'multimodal.budget-call-binding',
      'live call telemetry does not exactly re-derive its standalone budget'
    )
}

function artifactIdentity(value: unknown): boolean
{
  const identity = record(value)
  return Boolean(
    identity &&
    exactKeys(identity, ['artifactSha256', 'byteLength']) &&
    typeof identity.artifactSha256 === 'string' &&
    SHA256_PATTERN.test(identity.artifactSha256) &&
    safeInteger(identity.byteLength, 1)
  )
}

function evidenceSelection(
  value: unknown,
  request: MultimodalEvaluationRequest
): boolean
{
  const selection = record(value)
  if (
    !selection ||
    !exactKeys(selection, [
      'schemaVersion',
      'decisions',
      'selectedFrameIds',
      'selectedClipIds',
      'vlmFrameIds',
      'vlmClipIds',
      'vlmEvidenceByCriterion',
      'vlmCriterionIds',
      'stopReason',
    ]) ||
    selection.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !Array.isArray(selection.decisions) ||
    selection.decisions.length !== request.rubric.criteria.length ||
    !stringList(selection.selectedFrameIds, true) ||
    !stringList(selection.selectedClipIds, true) ||
    !stringList(selection.vlmFrameIds, true) ||
    !stringList(selection.vlmClipIds, true) ||
    !Array.isArray(selection.vlmEvidenceByCriterion) ||
    selection.vlmEvidenceByCriterion.length > 64 ||
    !stringList(selection.vlmCriterionIds, true) ||
    (selection.stopReason !== null && !boundedText(selection.stopReason))
  )
    return false
  const decisionCriterionIds: string[] = []
  const useVlmIds: string[] = []
  for (const decisionValue of selection.decisions)
  {
    const decision = record(decisionValue)
    if (
      !decision ||
      !exactKeys(decision, ['criterionId', 'decision', 'reason']) ||
      !boundedText(decision.criterionId) ||
      ![
        'deterministic-pass',
        'deterministic-fail',
        'use-keyframe',
        'use-vlm',
        'stop-inconclusive',
      ].includes(String(decision.decision)) ||
      !boundedText(decision.reason)
    )
      return false
    decisionCriterionIds.push(decision.criterionId)
    if (decision.decision === 'use-vlm') useVlmIds.push(decision.criterionId)
  }
  if (
    !sameJson(
      decisionCriterionIds,
      request.rubric.criteria.map((criterion) => criterion.id)
    ) ||
    !sameJson(useVlmIds, selection.vlmCriterionIds)
  )
    return false
  const criterionIds: string[] = []
  const frameIds: string[] = []
  const clipIds: string[] = []
  for (const value of selection.vlmEvidenceByCriterion)
  {
    const entry = record(value)
    if (
      !entry ||
      !exactKeys(entry, ['criterionId', 'frameIds', 'clipIds']) ||
      !boundedText(entry.criterionId) ||
      !stringList(entry.frameIds, true) ||
      entry.frameIds.length === 0 ||
      !stringList(entry.clipIds, true)
    )
      return false
    criterionIds.push(entry.criterionId)
    frameIds.push(...entry.frameIds)
    clipIds.push(...entry.clipIds)
  }
  const uniqueFrameIds = [...new Set(frameIds)]
  const uniqueClipIds = [...new Set(clipIds)]
  return (
    sameJson(criterionIds, selection.vlmCriterionIds) &&
    sameJson(uniqueFrameIds, selection.vlmFrameIds) &&
    sameJson(uniqueClipIds, selection.vlmClipIds) &&
    sameJson(selection.selectedClipIds, selection.vlmClipIds) &&
    selection.vlmFrameIds.every((frameId) =>
      (selection.selectedFrameIds as string[]).includes(frameId)
    ) &&
    (request.mode !== 'deterministic' ||
      (selection.vlmCriterionIds.length === 0 &&
        selection.vlmFrameIds.length === 0 &&
        selection.vlmClipIds.length === 0))
  )
}

function evaluationIssues(value: unknown): boolean
{
  if (!Array.isArray(value) || value.length > MAX_MULTIMODAL_EVALUATION_ISSUES)
    return false
  return value.every((issueValue) =>
  {
    const issue = record(issueValue)
    return Boolean(
      issue &&
      exactKeys(issue, ['code', 'responsibility', 'message']) &&
      boundedText(issue.code, false, MAX_MULTIMODAL_ISSUE_CODE_LENGTH) &&
      MULTIMODAL_EVALUATION_RESPONSIBILITIES.includes(
        issue.responsibility as (typeof MULTIMODAL_EVALUATION_RESPONSIBILITIES)[number]
      ) &&
      boundedText(issue.message, false, MAX_MULTIMODAL_REPORT_TEXT_LENGTH)
    )
  })
}

function validateRequestReportShape(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  issues: RepairMultimodalIssue[]
): boolean
{
  let valid = true
  const requestRecord = record(request)
  const reportRecord = record(report)
  if (
    !requestRecord ||
    !exactKeys(requestRecord, [
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
    ]) ||
    request.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !['deterministic', 'live', 'replay'].includes(String(request.mode)) ||
    !artifactIdentity(request.input) ||
    !SHA256_PATTERN.test(String(request.scenarioSha256)) ||
    !SHA256_PATTERN.test(String(request.observationTraceSha256)) ||
    !safeInteger(request.sampleOrdinal) ||
    !multimodalVlmPolicy(request.vlmPolicy, request.mode)
  )
    valid = false
  if (!validateRubricSpec(request.rubric).ok) valid = false
  if (!validateObservationPlan(request.observationPlan).ok) valid = false
  if (!validateBehavioralLensSpecs(request.lenses).ok) valid = false
  try
  {
    validateVlmBudget(request.budget)
  }
  catch
  {
    valid = false
  }
  if (
    !reportRecord ||
    !exactKeys(reportRecord, [
      'schemaVersion',
      'runId',
      'createdAt',
      'mode',
      'requestSha256',
      'input',
      'scenarioSha256',
      'observationTraceSha256',
      'sampleOrdinal',
      'rubricSha256',
      'observationPlanSha256',
      'structuralPreflight',
      'deterministic',
      'selection',
      'vlmRequest',
      'rubric',
      'differential',
      'lenses',
      'calls',
      'budget',
      'verdict',
      'limitations',
      'issues',
    ]) ||
    report.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !boundedText(report.runId, false, MAX_MULTIMODAL_RUN_ID_LENGTH) ||
    report.runId.trim() !== report.runId ||
    !isCanonicalMultimodalTimestamp(report.createdAt) ||
    !['deterministic', 'live', 'replay'].includes(String(report.mode)) ||
    !SHA256_PATTERN.test(String(report.requestSha256)) ||
    !artifactIdentity(report.input) ||
    !SHA256_PATTERN.test(String(report.scenarioSha256)) ||
    !SHA256_PATTERN.test(String(report.observationTraceSha256)) ||
    !safeInteger(report.sampleOrdinal) ||
    !SHA256_PATTERN.test(String(report.rubricSha256)) ||
    !SHA256_PATTERN.test(String(report.observationPlanSha256)) ||
    !['passed', 'failed', 'inconclusive'].includes(
      String(report.structuralPreflight)
    ) ||
    !Array.isArray(report.deterministic) ||
    report.deterministic.length > MAX_MULTIMODAL_DETERMINISTIC_RESULTS ||
    !evidenceSelection(report.selection, request) ||
    (report.vlmRequest !== null && !record(report.vlmRequest)) ||
    !Array.isArray(report.lenses) ||
    report.lenses.length > 64 ||
    !Array.isArray(report.calls) ||
    report.calls.length > 1 ||
    !report.calls.every((call) => vlmCall(call, request.mode)) ||
    !['passed', 'failed', 'inconclusive'].includes(String(report.verdict)) ||
    !stringList(
      report.limitations,
      true,
      MAX_MULTIMODAL_REPORT_LIMITATIONS,
      MAX_MULTIMODAL_REPORT_TEXT_LENGTH
    ) ||
    !evaluationIssues(report.issues) ||
    (report.verdict === 'passed' && report.issues.length > 0)
  )
    valid = false
  try
  {
    validateVlmBudgetAccounting(request.budget, report.budget)
  }
  catch
  {
    valid = false
  }
  if (
    request.mode === 'deterministic' &&
    (report.calls.length !== 0 ||
      report.vlmRequest !== null ||
      report.rubric !== null)
  )
    valid = false
  if (!valid)
    push(
      issues,
      'multimodal.evaluation-shape',
      'Multimodal request or report violates its strict nested contract'
    )
  return valid
}

function hostEvidence(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1
): RepairMultimodalHostEvidenceV1
{
  const requiredIds = new Set(
    request.rubric.criteria
      .filter((criterion) => criterion.requirement === 'required')
      .map((criterion) => criterion.id)
  )
  const byCriterion = new Map<string, DeterministicCriterionResult[]>()
  for (const result of report.deterministic)
  {
    const current = byCriterion.get(result.criterionId) ?? []
    current.push(result)
    byCriterion.set(result.criterionId, current)
  }
  const deterministicCriterionIds = [...byCriterion.entries()]
    .filter(
      ([criterionId, results]) =>
        requiredIds.has(criterionId) &&
        results.length > 0 &&
        results.every((result) => result.verdict === 'pass')
    )
    .map(([criterionId]) => criterionId)
    .sort()
  const requiredLensIds = new Set(
    request.lenses.filter((lens) => lens.required).map((lens) => lens.id)
  )
  const agreeingLensIds = report.lenses
    .filter(
      (lens) =>
        lens.required &&
        requiredLensIds.has(lens.specId) &&
        lens.verdict === 'agree'
    )
    .map((lens) => lens.specId)
    .sort()
  return { deterministicCriterionIds, agreeingLensIds }
}

function temporalFrames(
  temporal: ObservationTraceV1 | null,
  label: string,
  issues: RepairMultimodalIssue[]
): Map<string, MediaFrameRefV1>
{
  if (!temporal?.media) return new Map()
  const manifest = temporal.media
  if (!manifest.complete || manifest.incompleteReason !== null)
    push(
      issues,
      'multimodal.temporal-incomplete',
      `${label} evidence requires a complete media manifest`
    )
  const frames = new Map<string, MediaFrameRefV1>()
  let totalBytes = 0
  let previousTick = -1
  manifest.frames.forEach((frame, index) =>
  {
    if (
      frame.index !== index ||
      frame.id.length === 0 ||
      frames.has(frame.id) ||
      !Number.isSafeInteger(frame.tick) ||
      frame.tick < 0 ||
      frame.tick <= previousTick ||
      !Number.isSafeInteger(frame.bytes) ||
      frame.bytes <= 0 ||
      !SHA256_PATTERN.test(frame.sha256) ||
      !Number.isSafeInteger(frame.width) ||
      frame.width <= 0 ||
      !Number.isSafeInteger(frame.height) ||
      frame.height <= 0
    )
      push(
        issues,
        'multimodal.temporal-frame-invalid',
        `temporal frame ${index} has an invalid identity or order`
      )
    frames.set(frame.id, frame)
    previousTick = frame.tick
    totalBytes += frame.bytes
  })
  if (totalBytes !== manifest.totalFrameBytes)
    push(
      issues,
      'multimodal.temporal-byte-total',
      'temporal frame byte total does not match the manifest'
    )
  return frames
}

function resolveLocators(
  locators: readonly MultimodalEvidenceLocator[],
  frames: ReadonlyMap<string, MediaFrameRefV1>,
  code: string,
  issues: RepairMultimodalIssue[]
): void
{
  for (const locator of locators)
  {
    const frame = frames.get(locator.frameId)
    if (!frame || frame.tick !== locator.tick)
      push(
        issues,
        code,
        `evidence locator ${locator.evidenceId}/${locator.frameId}/${locator.tick} is not retained`
      )
  }
}

function validateDeterministicResults(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  issues: RepairMultimodalIssue[]
): void
{
  if (
    !Array.isArray(report.deterministic) ||
    report.deterministic.length > MAX_MULTIMODAL_DETERMINISTIC_RESULTS
  )
  {
    push(
      issues,
      'multimodal.deterministic-shape',
      'deterministic evidence must be a bounded array'
    )
    return
  }
  const criteria = new Map(
    request.rubric.criteria.map((criterion) => [criterion.id, criterion])
  )
  for (const [index, value] of report.deterministic.entries())
  {
    const result = record(value)
    if (
      !result ||
      !exactKeys(result, [
        'criterionId',
        'required',
        'verdict',
        'source',
        'evidence',
        'limitation',
      ])
    )
    {
      push(
        issues,
        'multimodal.deterministic-shape',
        `deterministic result ${index} has an invalid shape`
      )
      continue
    }
    const criterion =
      typeof result.criterionId === 'string'
        ? criteria.get(result.criterionId)
        : undefined
    if (
      !criterion ||
      result.required !== (criterion.requirement === 'required')
    )
      push(
        issues,
        'multimodal.deterministic-criterion',
        `deterministic result ${index} does not match its rubric criterion`
      )
    if (!['pass', 'fail', 'inconclusive'].includes(String(result.verdict)))
      push(
        issues,
        'multimodal.deterministic-verdict',
        `deterministic result ${index} has an invalid verdict`
      )
    if (
      !MULTIMODAL_DETERMINISTIC_SOURCES.includes(
        result.source as (typeof MULTIMODAL_DETERMINISTIC_SOURCES)[number]
      )
    )
      push(
        issues,
        'multimodal.deterministic-source',
        `deterministic result ${index} has an invalid source`
      )
    if (
      !Array.isArray(result.evidence) ||
      result.evidence.length > MAX_MULTIMODAL_DETERMINISTIC_EVIDENCE
    )
      push(
        issues,
        'multimodal.deterministic-evidence',
        `deterministic result ${index} has invalid evidence`
      )
    else
      for (const locator of result.evidence)
        if (!validateMultimodalEvidenceLocator(locator).ok)
          push(
            issues,
            'multimodal.deterministic-evidence',
            `deterministic result ${index} has a malformed locator`
          )
    if (
      result.verdict === 'inconclusive' &&
      !boundedText(result.limitation, false, MAX_MULTIMODAL_REPORT_TEXT_LENGTH)
    )
      push(
        issues,
        'multimodal.deterministic-limitation',
        `deterministic result ${index} needs a bounded limitation`
      )
    if (result.verdict !== 'inconclusive' && result.limitation !== null)
      push(
        issues,
        'multimodal.deterministic-limitation',
        `decisive deterministic result ${index} cannot retain a limitation`
      )
    if (result.source === 'differential' && report.differential === null)
      push(
        issues,
        'multimodal.deterministic-differential',
        `deterministic result ${index} lacks its differential report`
      )
  }
}

function validateSelectionSemantics(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  issues: RepairMultimodalIssue[]
): void
{
  const criteria = new Map(
    request.rubric.criteria.map((criterion) => [criterion.id, criterion])
  )
  const results = new Map<string, DeterministicCriterionResult[]>()
  for (const value of report.deterministic)
  {
    if (!record(value) || typeof value.criterionId !== 'string') continue
    const current = results.get(value.criterionId) ?? []
    current.push(value)
    results.set(value.criterionId, current)
  }
  let usesKeyframe = false
  let usesRequiredKeyframe = false
  let stopsInconclusive = false
  let stopsRequiredInconclusive = false
  let usesVlm = false
  let hasRequiredFailure = false
  let firstStopDecisionReason: string | null = null
  const localStopReasons = new Set([
    'required evidence is missing',
    'required evidence is stale',
    'required evidence is invalid',
    'required evidence is unsupported',
    'required evidence has an infrastructure failure',
    'required deterministic evidence is unresolved',
    'advisory-only uncertainty does not justify a VLM call',
    'deterministic mode does not permit VLM escalation',
    'evaluation infrastructure failed before escalation',
    'a required deterministic criterion failed',
  ])
  for (const decision of report.selection.decisions)
  {
    const criterion = criteria.get(decision.criterionId)
    const current = results.get(decision.criterionId) ?? []
    const deterministicVerdict = current.some(
      (result) => result.verdict === 'fail'
    )
      ? 'fail'
      : current.length > 0 &&
          current.every((result) => result.verdict === 'pass')
        ? 'pass'
        : 'inconclusive'
    if (
      (deterministicVerdict === 'pass' &&
        decision.decision !== 'deterministic-pass') ||
      (deterministicVerdict === 'fail' &&
        decision.decision !== 'deterministic-fail') ||
      (deterministicVerdict === 'inconclusive' &&
        (decision.decision === 'deterministic-pass' ||
          decision.decision === 'deterministic-fail'))
    )
      push(
        issues,
        'multimodal.selection-decision-binding',
        `selection decision for ${decision.criterionId} contradicts deterministic evidence`
      )
    const expectedReason =
      decision.decision === 'deterministic-pass'
        ? 'host-owned deterministic evidence passed the criterion'
        : decision.decision === 'deterministic-fail'
          ? 'host-owned deterministic evidence failed the criterion'
          : decision.decision === 'use-keyframe'
            ? 'keyframe criteria require host-owned rendered evaluation'
            : decision.decision === 'use-vlm'
              ? 'qualitative criterion remains unresolved with admitted evidence'
              : null
    const failedVlmCriterion =
      report.rubric === null &&
      report.vlmRequest?.selectedCriterionIds.includes(decision.criterionId)
    if (
      (expectedReason !== null && decision.reason !== expectedReason) ||
      (decision.decision === 'stop-inconclusive' &&
        !failedVlmCriterion &&
        !localStopReasons.has(decision.reason) &&
        !decision.reason.startsWith(
          'VLM escalation cannot change the final verdict: '
        ))
    )
      push(
        issues,
        'multimodal.selection-reason-binding',
        `selection reason for ${decision.criterionId} is not producer-derived`
      )
    if (decision.decision === 'use-keyframe')
    {
      usesKeyframe = true
      if (criterion?.requirement === 'required') usesRequiredKeyframe = true
      if (criterion?.evidenceKind !== 'keyframe')
        push(
          issues,
          'multimodal.selection-decision-binding',
          `criterion ${decision.criterionId} cannot use keyframe-only evaluation`
        )
    }
    if (decision.decision === 'stop-inconclusive')
    {
      stopsInconclusive = true
      firstStopDecisionReason ??= decision.reason
      if (criterion?.requirement === 'required')
        stopsRequiredInconclusive = true
    }
    if (
      decision.decision === 'deterministic-fail' &&
      criterion?.requirement === 'required'
    )
      hasRequiredFailure = true
    if (decision.decision === 'use-vlm')
    {
      usesVlm = true
      if (
        request.mode === 'deterministic' ||
        criterion?.requirement !== 'required' ||
        criterion.evidenceKind === 'keyframe'
      )
        push(
          issues,
          'multimodal.selection-decision-binding',
          `criterion ${decision.criterionId} cannot use provider escalation`
        )
    }
  }
  if (
    !usesKeyframe &&
    !sameJson(report.selection.selectedFrameIds, report.selection.vlmFrameIds)
  )
    push(
      issues,
      'multimodal.selection-frame-binding',
      'selected frames contain evidence that no selection decision retained'
    )
  if (
    usesVlm &&
    (usesRequiredKeyframe || stopsRequiredInconclusive || hasRequiredFailure)
  )
    push(
      issues,
      'multimodal.selection-decision-binding',
      'provider escalation cannot coexist with an unresolved required decision'
    )
  const hasLocalStop = usesKeyframe || stopsInconclusive || hasRequiredFailure
  if (
    (usesVlm && report.selection.stopReason !== null) ||
    (!usesVlm && hasLocalStop && report.selection.stopReason === null) ||
    (!usesVlm && !hasLocalStop && report.selection.stopReason !== null)
  )
    push(
      issues,
      'multimodal.selection-stop-binding',
      'selection stop reason contradicts its retained decisions'
    )
  if (
    report.selection.stopReason !== null &&
    (!Array.isArray(report.limitations) ||
      !report.limitations.includes(report.selection.stopReason))
  )
    push(
      issues,
      'multimodal.selection-stop-binding',
      'selection stop reason must be retained as a report limitation'
    )
  const resultLensIds = new Set(report.lenses.map((lens) => lens.specId))
  const hasExternalBlockingReason =
    report.structuralPreflight !== 'passed' ||
    report.issues.some((issue) => issue.responsibility === 'infrastructure') ||
    report.lenses.some((lens) => lens.required && lens.verdict !== 'agree') ||
    request.lenses.some((lens) => lens.required && !resultLensIds.has(lens.id))
  const retainedVlmCriterionIds = report.vlmRequest?.selectedCriterionIds ?? []
  const failedVlmStopReason =
    report.vlmRequest !== null && report.rubric === null
      ? (report.selection.decisions.find((decision) =>
          retainedVlmCriterionIds.includes(decision.criterionId)
        )?.reason ?? null)
      : null
  const expectedStopReason = failedVlmStopReason ?? firstStopDecisionReason
  if (
    !usesVlm &&
    !usesKeyframe &&
    !hasRequiredFailure &&
    !hasExternalBlockingReason &&
    expectedStopReason !== null &&
    report.selection.stopReason !== expectedStopReason
  )
    push(
      issues,
      'multimodal.selection-stop-binding',
      'selection stop reason does not match its retained stopping decision'
    )
}

function validateDecisiveTemporalEvidence(
  report: MultimodalEvaluationReportV1,
  evidence: MultimodalEvidenceFacetV1,
  issues: RepairMultimodalIssue[]
): Map<string, MediaFrameRefV1>
{
  const decisive = report.deterministic.filter(
    (result) =>
      (result.source === 'temporal' || result.source === 'keyframe') &&
      result.verdict !== 'inconclusive'
  )
  const providerLocators = (report.rubric?.criteria ?? []).flatMap(
    (criterion) => [
      ...criterion.evidence,
      ...criterion.symptoms.flatMap((symptom) => symptom.evidence),
    ]
  )
  const deterministicLocators = report.deterministic.flatMap(
    (result) => result.evidence
  )
  const selectedFrameIds = report.selection.selectedFrameIds
  const vlmFrameIds =
    report.vlmRequest?.frames.map((frame) => frame.frameId) ?? []
  if (
    decisive.length === 0 &&
    report.rubric === null &&
    report.vlmRequest === null &&
    deterministicLocators.length === 0 &&
    selectedFrameIds.length === 0
  )
    return new Map()
  if (!evidence.temporal?.media)
  {
    push(
      issues,
      'multimodal.temporal-required',
      'decisive temporal, keyframe, or provider evidence needs its retained trace'
    )
    return new Map()
  }
  const frames = temporalFrames(evidence.temporal, 'primary temporal', issues)
  resolveLocators(
    deterministicLocators,
    frames,
    'multimodal.deterministic-evidence-unresolved',
    issues
  )
  for (const result of decisive)
  {
    if (result.evidence.length === 0)
      push(
        issues,
        'multimodal.deterministic-evidence-missing',
        `decisive ${result.source} result ${result.criterionId} needs evidence`
      )
  }
  for (const frameId of [...new Set([...selectedFrameIds, ...vlmFrameIds])])
    if (!frames.has(frameId))
      push(
        issues,
        'multimodal.selection-frame-unresolved',
        `selected frame ${frameId} is not retained`
      )
  resolveLocators(
    providerLocators,
    frames,
    'multimodal.provider-evidence-unresolved',
    issues
  )
  return frames
}

function rubricAdmittedEvidence(
  binding: VlmRequestBindingV1,
  frames: ReadonlyMap<string, MediaFrameRefV1>,
  issues: RepairMultimodalIssue[]
): RubricJudgmentBindingV1['admittedEvidence']
{
  const boundFrames = new Map(
    binding.frames.map((frame) => [frame.frameId, frame])
  )
  return binding.criterionEvidence.flatMap((entry) =>
    entry.frameIds.flatMap((frameId) =>
    {
      const boundFrame = boundFrames.get(frameId)
      const sourceFrame = frames.get(frameId)
      if (!boundFrame || !sourceFrame || sourceFrame.tick !== boundFrame.tick)
      {
        push(
          issues,
          'multimodal.provider-evidence-unresolved',
          `criterion ${entry.criterionId} admitted an unavailable frame`
        )
        return []
      }
      return [
        {
          criterionId: entry.criterionId,
          evidenceId: boundFrame.evidenceId,
          frameId: boundFrame.frameId,
          tick: boundFrame.tick,
        },
      ]
    })
  )
}

function validateRubricJudgmentBinding(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  binding: VlmRequestBindingV1 | null,
  frames: ReadonlyMap<string, MediaFrameRefV1>,
  issues: RepairMultimodalIssue[]
): void
{
  const judgment = report.rubric
  if (!judgment) return
  if (!binding || report.calls.length !== 1)
  {
    push(
      issues,
      'multimodal.rubric-call-binding',
      'a rubric judgment requires exactly one retained provider call'
    )
    return
  }
  const call = report.calls[0]!
  if (
    call.outcome !== 'completed' ||
    call.responseSha256 === null ||
    call.responseModel === null
  )
  {
    push(
      issues,
      'multimodal.rubric-call-binding',
      'rubric judgment call did not complete with bound response identities'
    )
    return
  }
  const selectedCriterionIds = [...binding.selectedCriterionIds]
  const admitted = rubricAdmittedEvidence(binding, frames, issues)
  const expectedProvenance = {
    requestSha256: hashMultimodalJson(binding),
    outputSchemaSha256: binding.outputSchema.sha256,
    criterionEvidenceSha256: hashMultimodalJson(binding.criterionEvidence),
    admittedEvidence: admitted,
    context: { ...binding.context },
    promptTemplate: {
      id: binding.prompt.template.id,
      version: binding.prompt.template.version,
      templateSha256: binding.prompt.template.sha256,
      renderedPromptSha256: binding.prompt.renderedSha256,
    },
    provider: {
      adapter: binding.provider.adapter,
      provider: binding.provider.provider,
      requestedModel: binding.provider.model,
      version: binding.provider.version,
      responseModel: call.responseModel,
    },
    generation: { ...binding.generation },
  }
  const validated = validateNormalizedRubricJudgment(request.rubric, judgment, {
    rubricSha256: binding.rubric.sha256,
    evidenceSha256: binding.evidence.sha256,
    responseSha256: call.responseSha256,
    selectedCriterionIds,
    provenance: expectedProvenance,
    admittedEvidence: admitted,
  })
  if (!validated.ok)
    push(
      issues,
      'multimodal.rubric-judgment-invalid',
      validated.issues[0]?.message ?? 'rubric judgment is invalid'
    )
}

function validateRequestReportBinding(
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  artifact: RepairMultimodalEvaluationInputV1['artifact'],
  issues: RepairMultimodalIssue[]
): void
{
  if (!validateRequestReportShape(request, report, issues)) return
  if (
    request.input.artifactSha256 !== artifact.sha256 ||
    request.input.byteLength !== artifact.byteLength ||
    report.input.artifactSha256 !== artifact.sha256 ||
    report.input.byteLength !== artifact.byteLength
  )
    push(
      issues,
      'multimodal.artifact-binding',
      'Multimodal request and report must bind the exact repair artifact'
    )
  if (
    report.requestSha256 !== hashMultimodalJson(request) ||
    report.mode !== request.mode ||
    report.scenarioSha256 !== request.scenarioSha256 ||
    report.observationTraceSha256 !== request.observationTraceSha256 ||
    report.sampleOrdinal !== request.sampleOrdinal
  )
    push(
      issues,
      'multimodal.request-binding',
      'Multimodal report does not match its trusted request'
    )
  const rubric = validateRubricSpec(request.rubric)
  if (!rubric.ok)
  {
    push(issues, 'multimodal.rubric', 'Multimodal request rubric is invalid')
    return
  }
  if (report.rubricSha256 !== hashMultimodalJson(rubric.value))
    push(
      issues,
      'multimodal.rubric-binding',
      'Multimodal report rubric hash does not match its request'
    )
  const observationPlan = validateObservationPlan(request.observationPlan)
  if (!observationPlan.ok)
    push(
      issues,
      'multimodal.observation-plan',
      'Multimodal request observation plan is invalid'
    )
  else if (
    report.observationPlanSha256 !== hashObservationPlan(observationPlan.value)
  )
    push(
      issues,
      'multimodal.observation-plan-binding',
      'Multimodal report observation plan does not match its request'
    )
  if (report.differential === null)
  {
    if (request.lenses.length > 0 || report.lenses.length > 0)
      push(
        issues,
        'multimodal.lens-binding',
        'Multimodal lens evidence needs a bound differential report'
      )
  }
  else
  {
    const differential = validateDifferentialReport(report.differential)
    if (!differential.ok)
      push(
        issues,
        'multimodal.differential-invalid',
        differential.issues[0]?.message ?? 'differential report is invalid'
      )
    if (
      !sameJson(report.differential.specs, request.lenses) ||
      !sameJson(report.differential.results, report.lenses)
    )
      push(
        issues,
        'multimodal.lens-binding',
        'Multimodal differential and lens evidence do not match the request'
      )
    if (
      report.differential.left.scenarioSha256 !== request.scenarioSha256 ||
      report.differential.right.scenarioSha256 !== request.scenarioSha256
    )
      push(
        issues,
        'multimodal.differential-scenario',
        'both differential sides must bind the evaluation scenario'
      )
    if (
      report.differential.right.artifactSha256 !==
        request.input.artifactSha256 ||
      (report.differential.comparisonKind === 'runtime-runtime' &&
        report.differential.left.artifactSha256 !==
          request.input.artifactSha256)
    )
      push(
        issues,
        'multimodal.differential-artifact',
        'the evaluated artifact must occupy the designated differential side'
      )
  }
}

function validateVisualDifferentialEvidence(
  evidence: MultimodalEvidenceFacetV1,
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  issues: RepairMultimodalIssue[]
): void
{
  const decisive = report.lenses.filter(
    (lens) =>
      lens.kind === 'visual-keyframes' && lens.verdict !== 'inconclusive'
  )
  if (decisive.length === 0) return
  const differential = report.differential
  const traces = evidence.differentialTemporal
  if (!differential || !traces)
  {
    push(
      issues,
      'multimodal.visual-differential-traces',
      'decisive visual lens evidence needs both retained runtime traces'
    )
    return
  }
  const framesBySide = {
    left: temporalFrames(traces.left, 'left visual differential', issues),
    right: temporalFrames(traces.right, 'right visual differential', issues),
  }
  for (const side of ['left', 'right'] as const)
  {
    const trace = traces[side]
    const binding = differential[side]
    if (
      trace.sourceSb3Sha256 !== binding.artifactSha256 ||
      trace.scenarioSha256 !== binding.scenarioSha256 ||
      trace.planSha256 !== report.observationPlanSha256 ||
      !trace.media ||
      hashMultimodalJson(trace.media.runtime) !==
        binding.runtimeDescriptorSha256
    )
      push(
        issues,
        'multimodal.visual-differential-binding',
        `${side} visual trace does not match its report-side runtime binding`
      )
  }
  if (
    !evidence.temporal ||
    hashMultimodalJson(traces.right) !== hashMultimodalJson(evidence.temporal)
  )
    push(
      issues,
      'multimodal.visual-differential-primary',
      'right visual trace must be the primary candidate evaluation trace'
    )

  const locators = decisive.flatMap((result) => [
    ...result.evidence,
    ...result.differences.flatMap((difference) => difference.evidence),
  ])
  for (const locator of locators)
  {
    const separator = locator.evidenceId.indexOf(':')
    const side = locator.evidenceId.slice(0, separator)
    const retainedId = locator.evidenceId.slice(separator + 1)
    if (
      (side !== 'left' && side !== 'right') ||
      retainedId !== locator.frameId
    )
    {
      push(
        issues,
        'multimodal.lens-evidence-side',
        `visual locator ${locator.evidenceId} lacks exact side ownership`
      )
      continue
    }
    const frame = framesBySide[side].get(locator.frameId)
    if (!frame || frame.tick !== locator.tick)
      push(
        issues,
        'multimodal.lens-evidence-unresolved',
        `visual locator ${locator.evidenceId}/${locator.frameId}/${locator.tick} is not retained on its declared side`
      )
  }
  for (const result of decisive)
  {
    const spec = request.lenses.find((current) => current.id === result.specId)
    if (!spec || spec.kind !== 'visual-keyframes') continue
    const resultLocators = [
      ...result.evidence,
      ...result.differences.flatMap((difference) => difference.evidence),
    ]
    for (const frameId of spec.frameIds)
      for (const side of ['left', 'right'] as const)
        if (
          !resultLocators.some(
            (locator) =>
              locator.evidenceId === `${side}:${frameId}` &&
              locator.frameId === frameId
          )
        )
          push(
            issues,
            'multimodal.lens-evidence-missing',
            `visual lens ${result.specId} omitted ${side}:${frameId}`
          )
  }
}

export function validateRepairMultimodalCandidateBinding(
  baseline: RepairMultimodalGateV1,
  candidate: RepairMultimodalGateV1
): RepairMultimodalIssue[]
{
  const issues: RepairMultimodalIssue[] = []
  const left = baseline.request
  const right = candidate.request
  if (
    left.mode !== right.mode ||
    left.scenarioSha256 !== right.scenarioSha256 ||
    left.sampleOrdinal !== right.sampleOrdinal ||
    !sameJson(left.rubric, right.rubric) ||
    !sameJson(left.observationPlan, right.observationPlan) ||
    !sameJson(left.lenses, right.lenses) ||
    !sameJson(left.budget, right.budget) ||
    !sameJson(left.vlmPolicy, right.vlmPolicy)
  )
    push(
      issues,
      'multimodal.candidate-contract-mismatch',
      'candidate Multimodal evidence changed the baseline evaluation contract'
    )
  const differential = candidate.report.differential
  if (
    differential?.comparisonKind === 'baseline-candidate' &&
    differential.left.artifactSha256 !== baseline.evidence.artifactSha256
  )
    push(
      issues,
      'multimodal.candidate-baseline-binding',
      'candidate differential does not retain the repair baseline on the left'
    )
  const decisiveVisual = candidate.report.lenses.some(
    (lens) =>
      lens.kind === 'visual-keyframes' && lens.verdict !== 'inconclusive'
  )
  if (differential?.comparisonKind === 'baseline-candidate' && decisiveVisual)
  {
    const traces = candidate.evidence.differentialTemporal
    if (
      !traces ||
      !baseline.evidence.temporal ||
      !candidate.evidence.temporal ||
      hashMultimodalJson(traces.left) !==
        hashMultimodalJson(baseline.evidence.temporal) ||
      hashMultimodalJson(traces.right) !==
        hashMultimodalJson(candidate.evidence.temporal)
    )
      push(
        issues,
        'multimodal.candidate-visual-trace-binding',
        'candidate visual differential must retain the exact baseline and candidate traces'
      )
  }
  return issues
}

function validateFacetBinding(
  evidence: MultimodalEvidenceFacetV1,
  request: MultimodalEvaluationRequest,
  report: MultimodalEvaluationReportV1,
  artifact: RepairMultimodalEvaluationInputV1['artifact'],
  issues: RepairMultimodalIssue[]
): void
{
  const validated = validateMultimodalEvidenceFacet(evidence)
  if (!validated.ok)
  {
    push(
      issues,
      'multimodal.evidence-invalid',
      validated.issues[0]?.message ?? 'Multimodal evidence facet is invalid'
    )
    return
  }
  if (
    evidence.artifactSha256 !== artifact.sha256 ||
    evidence.evaluationSha256 !== hashMultimodalJson(report) ||
    !sameJson(evidence.rubric, report.rubric) ||
    !sameJson(evidence.differential, report.differential) ||
    !sameJson(evidence.lenses, report.differential ? report.lenses : null)
  )
    push(
      issues,
      'multimodal.evidence-binding',
      'Multimodal evidence facet does not match the exact evaluation'
    )
  const temporal = evidence.temporal
  if (
    temporal &&
    (temporal.sourceSb3Sha256 !== artifact.sha256 ||
      temporal.scenarioSha256 !== request.scenarioSha256 ||
      temporal.planSha256 !== report.observationPlanSha256 ||
      hashMultimodalJson(temporal) !== request.observationTraceSha256)
  )
    push(
      issues,
      'multimodal.temporal-binding',
      'Multimodal temporal evidence does not match the evaluation context'
    )
  validateTemporalTraceShape(temporal, request, report, issues)
  if (evidence.differentialTemporal)
    for (const side of ['left', 'right'] as const)
      validateTemporalTraceShape(
        evidence.differentialTemporal[side],
        request,
        report,
        issues,
        `${side} differential`
      )
  validateVisualDifferentialEvidence(evidence, request, report, issues)
}

export function validateRepairMultimodalEvaluation(
  value: unknown,
  artifact: RepairMultimodalEvaluationInputV1['artifact']
): RepairMultimodalValidation
{
  const issues: RepairMultimodalIssue[] = []
  if (
    !SHA256_PATTERN.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength <= 0
  )
  {
    return {
      ok: false,
      issues: [
        {
          code: 'multimodal.artifact',
          message: 'repair artifact identity is invalid',
        },
      ],
    }
  }
  const envelope = record(value)
  if (!envelope)
  {
    return {
      ok: false,
      issues: [
        {
          code: 'multimodal.envelope',
          message: 'Multimodal evaluator returned an invalid envelope',
        },
      ],
    }
  }
  let detached: RepairMultimodalEvaluationEnvelopeV1
  let owned: RepairMultimodalHostEvidenceV1 = {
    deterministicCriterionIds: [],
    agreeingLensIds: [],
  }
  try
  {
    detached = detachedFrozenMultimodalRecord(
      envelope as unknown as RepairMultimodalEvaluationEnvelopeV1
    ) as RepairMultimodalEvaluationEnvelopeV1
  }
  catch
  {
    return {
      ok: false,
      issues: [
        {
          code: 'multimodal.envelope',
          message: 'Multimodal evaluator envelope must be bounded finite JSON',
        },
      ],
    }
  }
  const normalized = record(detached)!
  if (
    !exactKeys(normalized, [
      'schemaVersion',
      'request',
      'report',
      'evidence',
    ]) ||
    normalized.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    !record(normalized.request) ||
    !record(normalized.report) ||
    !record(normalized.evidence)
  )
  {
    return {
      ok: false,
      issues: [
        {
          code: 'multimodal.envelope',
          message: 'Multimodal evaluator returned an invalid envelope',
        },
      ],
    }
  }
  try
  {
    validateRequestReportBinding(
      detached.request,
      detached.report,
      artifact,
      issues
    )
    validateFacetBinding(
      detached.evidence,
      detached.request,
      detached.report,
      artifact,
      issues
    )
    validateDeterministicResults(detached.request, detached.report, issues)
    validateSelectionSemantics(detached.request, detached.report, issues)
    const frames = validateDecisiveTemporalEvidence(
      detached.report,
      detached.evidence,
      issues
    )
    const vlmRequest = validateVlmRequestBinding(
      detached.request,
      detached.report,
      frames,
      issues
    )
    validateRubricJudgmentBinding(
      detached.request,
      detached.report,
      vlmRequest,
      frames,
      issues
    )
    validateCallAccounting(
      detached.request,
      detached.report,
      vlmRequest,
      issues
    )
    const rubric = validateRubricSpec(detached.request.rubric)
    if (rubric.ok)
    {
      const aggregated = aggregateMultimodalVerdict({
        structuralPreflight: detached.report.structuralPreflight,
        rubricSpec: rubric.value,
        deterministic: detached.report.deterministic,
        lensSpecs: detached.request.lenses,
        lenses: detached.report.lenses,
        rubricJudgment: detached.report.rubric,
        issues: detached.report.issues,
      })
      if (aggregated !== detached.report.verdict)
        push(
          issues,
          'multimodal.verdict-binding',
          'Multimodal report verdict does not match trusted aggregation'
        )
    }
    if (issues.length === 0)
      owned = hostEvidence(detached.request, detached.report)
  }
  catch
  {
    push(
      issues,
      'multimodal.invalid-evaluation',
      'Multimodal evaluation could not be validated safely'
    )
  }
  if (issues.length > 0) return { ok: false, issues }
  const gate: RepairMultimodalGateV1 = {
    schemaVersion: REPAIR_MULTIMODAL_SCHEMA_VERSION,
    required: true,
    verdict: detached.report.verdict,
    hostEvidence: owned,
    request: detached.request,
    report: detached.report,
    evidence: detached.evidence,
  }
  return {
    ok: true,
    value: detachedFrozenMultimodalRecord(gate),
  }
}

export async function evaluateRepairMultimodal(
  evaluator: RepairMultimodalEvaluator,
  input: RepairMultimodalEvaluationInputV1
): Promise<Readonly<RepairMultimodalGateV1>>
{
  if (!(input.artifactBytes instanceof Uint8Array))
    throw new RepairMultimodalBoundaryError(
      'Multimodal repair artifact bytes are invalid'
    )
  let artifactBytes: Uint8Array
  try
  {
    artifactBytes = copyVlmBytes(input.artifactBytes)
  }
  catch
  {
    throw new RepairMultimodalBoundaryError(
      'Multimodal repair artifact bytes do not have a readable backing store'
    )
  }
  const byteLength = artifactBytes.byteLength
  const artifactSha256 = hashMultimodalContent(artifactBytes)
  if (
    byteLength !== input.artifact.byteLength ||
    artifactSha256 !== input.artifact.sha256
  )
    throw new RepairMultimodalBoundaryError(
      'Multimodal repair artifact bytes do not match their declared identity'
    )
  const raw = await evaluator.evaluate({
    schemaVersion: REPAIR_MULTIMODAL_SCHEMA_VERSION,
    role: input.role,
    sessionId: input.sessionId,
    attemptNumber: input.attemptNumber,
    requirement: structuredClone(input.requirement),
    baselineRequest: input.baselineRequest
      ? structuredClone(input.baselineRequest)
      : null,
    artifact: { ...input.artifact },
    artifactBytes,
  })
  const validated = validateRepairMultimodalEvaluation(raw, input.artifact)
  if (!validated.ok)
    throw new RepairMultimodalBoundaryError(
      validated.issues[0]?.message ?? 'Multimodal evaluation is invalid'
    )
  return validated.value
}

export function validateRepairMultimodalRequirement(
  value: unknown
): RepairMultimodalIssue[]
{
  const requirement = record(value)
  if (
    !requirement ||
    !exactKeys(requirement, ['schemaVersion', 'required']) ||
    requirement.schemaVersion !== REPAIR_MULTIMODAL_SCHEMA_VERSION ||
    requirement.required !== true
  )
    return [
      {
        code: 'case.multimodal.invalid-shape',
        message:
          'multimodal must explicitly require the supported evidence schema',
      },
    ]
  return []
}

export function cloneRepairMultimodalRequirement(
  value: RepairMultimodalRequirementV1
): RepairMultimodalRequirementV1
{
  if (validateRepairMultimodalRequirement(value).length > 0)
    throw new TypeError('invalid Multimodal repair requirement')
  return { schemaVersion: REPAIR_MULTIMODAL_SCHEMA_VERSION, required: true }
}
