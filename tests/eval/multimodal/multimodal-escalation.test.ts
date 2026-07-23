// tests/eval/multimodal/multimodal-escalation.test.ts
// consequential Multimodal escalation, budget, provider, & replay boundary proof

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  hashObservationPlan,
  type ObservationPlanV1,
} from '@scratch-agent/runner'

import {
  InMemoryVlmReplayStore,
  ScriptedFakeVlmAdapter,
} from '@scratch-agent/eval'
import type { MultimodalCriterionEvidenceV1 } from '@scratch-agent/eval'
import {
  MULTIMODAL_SCHEMA_VERSION,
  hashMultimodalJson,
} from '@scratch-agent/eval'
import {
  evaluateMultimodal,
  type DeterministicCriterionResult,
  type MultimodalEvaluationRequest,
  type MultimodalVlmPolicyV1,
} from '@scratch-agent/eval'
import {
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  type RawRubricJudgmentV1,
  type RubricSpecV1,
} from '@scratch-agent/eval'
import {
  prepareVlmRequest,
  VLM_REQUEST_KEY_PREFIX,
  type VlmAdapter,
  type VlmAdapterAdmission,
  type VlmAdapterEstimateRequest,
  type VlmAdapterRequest,
  type VlmAdapterResponse,
  type VlmBudgetV1,
  type VlmContextBindingV1,
  type VlmProviderDescriptor,
  type VlmRequestEstimate,
} from '@scratch-agent/eval'
import {
  createVlmBudgetState,
  executeLiveVlmEvaluation,
  executeReplayVlmEvaluation,
} from '@scratch-agent/eval'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: null,
  cloneCounts: 'none',
}
const DESCRIPTOR: VlmProviderDescriptor = {
  adapter: 'multimodal-fake',
  provider: 'local-test',
  model: 'fake-v1',
  version: 'fake-adapter-v1',
}
const ESTIMATE: VlmRequestEstimate = {
  inputTokens: 50,
  outputTokens: 64,
  totalTokens: 114,
  usd: 0.01,
  pricingTableVersion: 'fake-pricing-v1',
  unavailableReason: null,
}
const BUDGET: VlmBudgetV1 = {
  schemaVersion: 1,
  maxCalls: 1,
  maxSubmittedMediaBytes: PNG.byteLength,
  maxInputTokens: 100,
  maxCumulativeOutputTokens: 64,
  maxCostUsd: 0.02,
  maxUniqueClips: 1,
}
const PROMPT_TEMPLATE_TEXT = 'judge only the trusted selected rubric criteria'
const VLM_POLICY: MultimodalVlmPolicyV1 = {
  prompt: {
    template: {
      id: 'multimodal-rubric-prompt',
      version: '1',
      sha256: sha256(PROMPT_TEMPLATE_TEXT),
    },
    templateText: PROMPT_TEMPLATE_TEXT,
  },
  provider: DESCRIPTOR,
  generation: { temperature: 0, maxOutputTokens: 64 },
}

function sha256(value: Uint8Array | string): string
{
  return createHash('sha256').update(value).digest('hex')
}

function context(sampleOrdinal = 0): VlmContextBindingV1
{
  return {
    artifactSha256: 'a'.repeat(64),
    scenarioSha256: 'b'.repeat(64),
    observationPlanSha256: hashObservationPlan(PLAN),
    observationTraceSha256: 'c'.repeat(64),
    sampleOrdinal,
  }
}

function rubric(includeState = true): RubricSpecV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id: includeState ? 'mixed-rubric' : 'visual-only-rubric',
    version: '1',
    objective: 'the project behaves correctly and presents coherent motion',
    criteria: [
      ...(includeState
        ? [
            {
              id: 'state',
              requirement: 'required' as const,
              evidenceKind: 'keyframe' as const,
              description: 'the exact host-owned state gate passes',
              passAnchors: ['the declared state matches'],
              failAnchors: ['the declared state differs'],
            },
          ]
        : []),
      {
        id: 'motion',
        requirement: 'required',
        evidenceKind: 'temporal',
        description: 'motion is visually coherent over time',
        passAnchors: ['motion progresses smoothly'],
        failAnchors: ['motion visibly stalls or jumps'],
      },
    ],
  }
}

function rawMotionJudgment(): RawRubricJudgmentV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    criteria: [
      {
        criterionId: 'motion',
        verdict: 'pass',
        confidence: 0.9,
        evidence: [
          {
            evidenceId: 'temporal-1',
            frameId: 'frame-1',
            tick: 6,
            region: null,
          },
        ],
        symptoms: [],
        limitation: null,
      },
    ],
  }
}

function completedResponse(
  raw: unknown = rawMotionJudgment(),
  inputTokens = 40
): VlmAdapterResponse
{
  return {
    outcome: 'completed',
    responseId: 'fake-response-1',
    model: DESCRIPTOR.model,
    latencyMs: 5,
    usage: {
      inputTokens,
      outputTokens: 16,
      totalTokens: inputTokens + 16,
      available: true,
      unavailableReason: null,
    },
    billedCostUsd: null,
    raw,
    error: null,
  }
}

function preparedRequest(
  specification: RubricSpecV1,
  requestContext = context(),
  imageBytes: Uint8Array = PNG
): VlmAdapterRequest
{
  return prepareVlmRequest({
    context: requestContext,
    mediaAdmission: {
      maxSubmittedMediaBytes: BUDGET.maxSubmittedMediaBytes,
      maxUniqueClips: BUDGET.maxUniqueClips,
    },
    rubric: specification,
    rubricSha256: hashMultimodalJson(specification),
    selectedCriterionIds: ['motion'],
    criterionEvidence: [{ criterionId: 'motion', frameIds: ['frame-1'] }],
    prompt: {
      template: VLM_POLICY.prompt.template,
      templateText: VLM_POLICY.prompt.templateText,
    },
    outputSchema: {
      identity: {
        id: 'rubric-judgment-schema',
        version: '1',
        sha256: hashMultimodalJson(RUBRIC_JUDGMENT_JSON_SCHEMA),
      },
      value: RUBRIC_JUDGMENT_JSON_SCHEMA,
    },
    provider: VLM_POLICY.provider,
    generation: VLM_POLICY.generation,
    images: [
      {
        binding: {
          evidenceId: 'temporal-1',
          frameId: 'frame-1',
          clipId: 'clip-1',
          tick: 6,
          mimeType: 'image/png',
          bytes: PNG.byteLength,
          sha256: sha256(PNG),
          width: 1,
          height: 1,
          detail: 'low',
        },
        bytes: imageBytes,
      },
    ],
  })
}

function fake(
  actions: ConstructorParameters<typeof ScriptedFakeVlmAdapter>[0]['actions'],
  estimate: VlmRequestEstimate = ESTIMATE
): ScriptedFakeVlmAdapter
{
  return new ScriptedFakeVlmAdapter({
    descriptor: DESCRIPTOR,
    estimate,
    actions,
  })
}

function evaluationRequest(
  specification: RubricSpecV1,
  sampleOrdinal = 0
): MultimodalEvaluationRequest
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    mode: 'live',
    input: { artifactSha256: 'a'.repeat(64), byteLength: 1024 },
    scenarioSha256: 'b'.repeat(64),
    observationTraceSha256: 'c'.repeat(64),
    sampleOrdinal,
    rubric: specification,
    observationPlan: PLAN,
    lenses: [],
    budget: BUDGET,
    vlmPolicy: structuredClone(VLM_POLICY),
  }
}

function requestBoundaryInput(
  request: MultimodalEvaluationRequest,
  adapter: VlmAdapter
): Parameters<typeof evaluateMultimodal>[0]
{
  return {
    request,
    boundary: {
      mode: 'live',
      request: null,
      adapter,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'request-boundary',
    createdAt: '2026-07-18T11:59:59.000Z',
    structuralPreflight: 'passed',
    deterministic: [
      statePass(),
      {
        criterionId: 'motion',
        required: true,
        verdict: 'pass',
        source: 'model',
        evidence: [],
        limitation: null,
      },
    ],
    evidenceByCriterion: {},
    differential: null,
    lenses: [],
  }
}

function statePass(): DeterministicCriterionResult
{
  return {
    criterionId: 'state',
    required: true,
    verdict: 'pass',
    source: 'state',
    evidence: [],
    limitation: null,
  }
}

function readyMotion(): Record<string, MultimodalCriterionEvidenceV1>
{
  return {
    motion: {
      status: 'ready',
      frameIds: ['frame-1'],
      clipIds: ['clip-1'],
    },
  }
}

class BytesFreeEstimateAdapter implements VlmAdapter
{
  readonly descriptor: Readonly<VlmProviderDescriptor>
  readonly #delegate: ScriptedFakeVlmAdapter

  constructor(delegate: ScriptedFakeVlmAdapter)
  {
    this.#delegate = delegate
    this.descriptor = delegate.descriptor
  }

  estimateCost(request: VlmAdapterEstimateRequest): VlmRequestEstimate
  {
    assert.ok(
      request.images.every((image) => !Object.hasOwn(image, 'bytes')),
      'cost estimation must not receive evidence bytes'
    )
    return this.#delegate.estimateCost(request)
  }

  admit(request: VlmAdapterEstimateRequest): VlmAdapterAdmission
  {
    assert.ok(request.images.every((image) => !Object.hasOwn(image, 'bytes')))
    return this.#delegate.admit(request)
  }

  evaluate(
    request: VlmAdapterRequest,
    signal: AbortSignal
  ): Promise<VlmAdapterResponse>
  {
    assert.equal(
      sha256(request.images[0]!.bytes),
      request.images[0]!.binding.sha256
    )
    return this.#delegate.evaluate(request, signal)
  }
}

class CooperativeTimeoutAdapter implements VlmAdapter
{
  readonly descriptor = DESCRIPTOR
  callCount = 0

  admit(): VlmAdapterAdmission
  {
    return { accepted: true, reason: null }
  }

  estimateCost(): VlmRequestEstimate
  {
    return ESTIMATE
  }

  evaluate(
    _request: VlmAdapterRequest,
    signal: AbortSignal
  ): Promise<VlmAdapterResponse>
  {
    this.callCount++
    return new Promise((_, reject) =>
    {
      const aborted = () => reject(signal.reason)
      if (signal.aborted) aborted()
      else signal.addEventListener('abort', aborted, { once: true })
    })
  }
}

function withTamperedPrompt(source: VlmAdapterRequest): VlmAdapterRequest
{
  const prompt = source.prompt.replace(
    '"criterionId":"motion"',
    '"criterionId":"state"'
  )
  assert.notEqual(prompt, source.prompt)
  const clonedBinding = structuredClone(source.binding)
  const binding = {
    ...clonedBinding,
    prompt: {
      ...clonedBinding.prompt,
      renderedSha256: sha256(prompt),
    },
  }
  const requestSha256 = hashMultimodalJson(binding)
  return {
    requestKey: `${VLM_REQUEST_KEY_PREFIX}${requestSha256}`,
    requestSha256,
    binding,
    prompt,
    outputSchema: structuredClone(source.outputSchema),
    images: source.images.map((image, index) => ({
      binding: binding.frames[index]!,
      bytes: Uint8Array.from(image.bytes),
    })),
  }
}

test('Multimodal escalates selectively with bounded live and exact replay accounting', async () =>
{
  const mixedRubric = rubric()
  const noCallFake = fake([])
  const unsupportedSchema = {
    ...evaluationRequest(mixedRubric),
    schemaVersion: 999,
  } as unknown as MultimodalEvaluationRequest
  await assert.rejects(
    evaluateMultimodal(requestBoundaryInput(unsupportedSchema, noCallFake)),
    /schema version is unsupported/
  )
  const unknownMode = {
    ...evaluationRequest(mixedRubric),
    mode: 'forged',
  } as unknown as MultimodalEvaluationRequest
  await assert.rejects(
    evaluateMultimodal(requestBoundaryInput(unknownMode, noCallFake)),
    /request mode is invalid/
  )
  const extraField = {
    ...evaluationRequest(mixedRubric),
    unexpected: true,
  }
  await assert.rejects(
    evaluateMultimodal(requestBoundaryInput(extraField, noCallFake)),
    /invalid top-level fields/
  )
  const invalidObservationPlan: MultimodalEvaluationRequest = {
    ...evaluationRequest(mixedRubric),
    observationPlan: {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      temporal: {
        firstTick: 0,
        lastTick: 10,
        everyTicks: 1,
        playbackFps: 10,
        maxFrames: 999_999,
        maxBytes: 5 * 1024 * 1024,
        derivedVideo: false,
      },
      cloneCounts: 'none',
    },
  }
  await assert.rejects(
    evaluateMultimodal(
      requestBoundaryInput(invalidObservationPlan, noCallFake)
    ),
    /observation plan is invalid/
  )
  assert.equal(noCallFake.callCount, 0)
  const noCallReport = await evaluateMultimodal({
    request: evaluationRequest(mixedRubric),
    boundary: {
      mode: 'live',
      request: null,
      adapter: noCallFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'clear-state',
    createdAt: '2026-07-18T12:00:00.000Z',
    structuralPreflight: 'passed',
    deterministic: [
      statePass(),
      {
        criterionId: 'motion',
        required: true,
        verdict: 'pass',
        source: 'model',
        evidence: [],
        limitation: null,
      },
    ],
    evidenceByCriterion: {},
    differential: null,
    lenses: [],
  })
  assert.equal(noCallReport.verdict, 'passed')
  assert.equal(noCallReport.calls.length, 0)
  assert.equal(noCallFake.callCount, 0)
  assert.equal(noCallReport.budget.liveCallsReserved, 0)

  const keyframeRubric: RubricSpecV1 = {
    ...mixedRubric,
    id: 'keyframe-rubric',
    criteria: [mixedRubric.criteria[0]!],
  }
  const keyframeRequest = evaluationRequest(keyframeRubric)
  const keyframeReport = await evaluateMultimodal({
    request: keyframeRequest,
    boundary: {
      mode: 'live',
      request: null,
      adapter: noCallFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'keyframe-only',
    createdAt: '2026-07-18T12:00:01.000Z',
    structuralPreflight: 'passed',
    deterministic: [],
    evidenceByCriterion: {
      state: {
        status: 'ready',
        frameIds: ['frame-state'],
        clipIds: [],
      },
    },
    differential: null,
    lenses: [],
  })
  assert.equal(keyframeReport.verdict, 'inconclusive')
  assert.equal(keyframeReport.selection.decisions[0]?.decision, 'use-keyframe')
  assert.equal(keyframeReport.calls.length, 0)
  assert.equal(noCallFake.callCount, 0)

  const keyframeBlockedReport = await evaluateMultimodal({
    request: evaluationRequest(mixedRubric),
    boundary: {
      mode: 'live',
      request: null,
      adapter: noCallFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'required-keyframe-blocks-vlm',
    createdAt: '2026-07-18T12:00:01.100Z',
    structuralPreflight: 'passed',
    deterministic: [],
    evidenceByCriterion: {
      state: {
        status: 'ready',
        frameIds: ['frame-state'],
        clipIds: [],
      },
      ...readyMotion(),
    },
    differential: null,
    lenses: [],
  })
  assert.equal(keyframeBlockedReport.verdict, 'inconclusive')
  assert.deepEqual(keyframeBlockedReport.selection.vlmCriterionIds, [])
  assert.deepEqual(keyframeBlockedReport.selection.vlmFrameIds, [])
  assert.deepEqual(keyframeBlockedReport.selection.vlmClipIds, [])
  assert.deepEqual(keyframeBlockedReport.selection.selectedFrameIds, [
    'frame-state',
  ])
  assert.equal(
    keyframeBlockedReport.selection.decisions[1]?.decision,
    'stop-inconclusive'
  )
  assert.equal(noCallFake.callCount, 0)

  const staleBlockedRubric: RubricSpecV1 = {
    ...mixedRubric,
    id: 'stale-blocked-rubric',
    criteria: [
      ...mixedRubric.criteria,
      {
        id: 'timing',
        requirement: 'required',
        evidenceKind: 'temporal',
        description: 'the sequence completes at the intended time',
        passAnchors: ['the final event occurs on time'],
        failAnchors: ['the final event occurs too early or too late'],
      },
    ],
  }
  const staleBlockedReport = await evaluateMultimodal({
    request: evaluationRequest(staleBlockedRubric),
    boundary: {
      mode: 'live',
      request: null,
      adapter: noCallFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'stale-required-blocks-vlm',
    createdAt: '2026-07-18T12:00:01.200Z',
    structuralPreflight: 'passed',
    deterministic: [statePass()],
    evidenceByCriterion: {
      ...readyMotion(),
      timing: { status: 'stale', frameIds: [], clipIds: [] },
    },
    differential: null,
    lenses: [],
  })
  assert.equal(staleBlockedReport.verdict, 'inconclusive')
  assert.deepEqual(staleBlockedReport.selection.vlmCriterionIds, [])
  assert.deepEqual(staleBlockedReport.selection.selectedFrameIds, [])
  assert.equal(
    staleBlockedReport.selection.stopReason,
    'required evidence is stale'
  )
  assert.equal(noCallFake.callCount, 0)

  const request = preparedRequest(mixedRubric)
  assert.match(request.prompt, /"criterionId":"motion"/)
  assert.match(request.prompt, /"imageOrdinal":1/)
  assert.equal(
    request.binding.prompt.criterionEvidenceSha256,
    hashMultimodalJson(request.binding.criterionEvidence)
  )
  const iteratorBytes = Uint8Array.from(PNG)
  Object.defineProperty(iteratorBytes, Symbol.iterator, {
    configurable: true,
    value: function* ()
    {
      yield 0
    },
  })
  Object.defineProperty(iteratorBytes, 'byteLength', {
    configurable: true,
    value: 1,
  })
  const iteratorRequest = preparedRequest(mixedRubric, context(), iteratorBytes)
  assert.equal(sha256(iteratorRequest.images[0]!.bytes), sha256(PNG))
  Object.defineProperty(iteratorRequest.images[0]!.bytes, Symbol.iterator, {
    configurable: true,
    value: function* ()
    {
      yield 0
    },
  })
  Object.defineProperty(iteratorRequest.images[0]!.bytes, 'byteLength', {
    configurable: true,
    value: 1,
  })
  const iteratorFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  const iteratorExecution = await executeLiveVlmEvaluation({
    rubric: mixedRubric,
    request: iteratorRequest,
    budget: BUDGET,
    budgetState: createVlmBudgetState(BUDGET),
    adapter: new BytesFreeEstimateAdapter(iteratorFake),
    replayStore: new InMemoryVlmReplayStore(),
  })
  assert.equal(iteratorExecution.outcome, 'completed')
  assert.equal(iteratorFake.callCount, 1)
  const mismatchedPolicyRequest = evaluationRequest(mixedRubric)
  mismatchedPolicyRequest.vlmPolicy!.provider.version = 'mismatched-policy'
  const mismatchedPolicyFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  await assert.rejects(
    evaluateMultimodal({
      request: mismatchedPolicyRequest,
      boundary: {
        mode: 'live',
        request,
        adapter: mismatchedPolicyFake,
        replayStore: new InMemoryVlmReplayStore(),
      },
      runId: 'mismatched-vlm-policy',
      createdAt: '2026-07-18T12:00:01.300Z',
      structuralPreflight: 'passed',
      deterministic: [statePass()],
      evidenceByCriterion: readyMotion(),
      differential: null,
      lenses: [],
    }),
    /does not match trusted VLM policy/
  )
  assert.equal(mismatchedPolicyFake.callCount, 0)
  const tamperedPromptFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  const tamperedPrompt = await executeLiveVlmEvaluation({
    rubric: mixedRubric,
    request: withTamperedPrompt(request),
    budget: BUDGET,
    budgetState: createVlmBudgetState(BUDGET),
    adapter: tamperedPromptFake,
    replayStore: new InMemoryVlmReplayStore(),
  })
  assert.equal(tamperedPrompt.outcome, 'inconclusive')
  assert.equal(tamperedPrompt.issue?.code, 'invalid-vlm-request')
  assert.equal(tamperedPromptFake.callCount, 0)
  const liveFake = fake([{ kind: 'response', response: completedResponse() }])
  const guardedAdapter = new BytesFreeEstimateAdapter(liveFake)
  const store = new InMemoryVlmReplayStore()
  const liveReport = await evaluateMultimodal({
    request: evaluationRequest(mixedRubric),
    boundary: {
      mode: 'live',
      request,
      adapter: guardedAdapter,
      replayStore: store,
    },
    runId: 'qualitative-live',
    createdAt: '2026-07-18T12:00:02.000Z',
    structuralPreflight: 'passed',
    deterministic: [statePass()],
    evidenceByCriterion: readyMotion(),
    differential: null,
    lenses: [],
  })
  assert.equal(liveReport.verdict, 'passed')
  assert.equal(liveFake.callCount, 1)
  assert.equal(store.size, 1)
  assert.equal(liveReport.calls[0]?.providerCallCount, 1)
  assert.equal(liveReport.budget.liveCallsReserved, 1)
  assert.equal(liveReport.budget.liveCallsAttempted, 1)
  assert.equal(liveReport.budget.liveCallsSettled, 1)
  assert.equal(liveReport.budget.chargedInputTokens, 40)
  assert.equal(liveReport.budget.chargedOutputTokens, 16)
  assert.equal(liveReport.budget.chargedCostUsd, 0.01)

  const mixedEvidenceFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  const mixedEvidenceReport = await evaluateMultimodal({
    request: evaluationRequest(mixedRubric),
    boundary: {
      mode: 'live',
      request,
      adapter: mixedEvidenceFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'deterministic-inconclusive-plus-vlm',
    createdAt: '2026-07-18T12:00:02.100Z',
    structuralPreflight: 'passed',
    deterministic: [
      statePass(),
      {
        criterionId: 'motion',
        required: true,
        verdict: 'inconclusive',
        source: 'temporal',
        evidence: [],
        limitation: 'deterministic temporal signal was insufficient',
      },
    ],
    evidenceByCriterion: readyMotion(),
    differential: null,
    lenses: [],
  })
  assert.equal(mixedEvidenceReport.verdict, 'passed')
  assert.equal(mixedEvidenceFake.callCount, 1)

  const replayRequest = evaluationRequest(mixedRubric)
  replayRequest.mode = 'replay'
  const replayReport = await evaluateMultimodal({
    request: replayRequest,
    boundary: { mode: 'replay', request, replayStore: store },
    runId: 'qualitative-replay',
    createdAt: '2026-07-18T12:00:03.000Z',
    structuralPreflight: 'passed',
    deterministic: [statePass()],
    evidenceByCriterion: readyMotion(),
    differential: null,
    lenses: [],
  })
  assert.equal(replayReport.verdict, 'passed')
  assert.deepEqual(replayReport.rubric, liveReport.rubric)
  assert.equal(replayReport.calls[0]?.providerCallCount, 0)
  assert.equal(replayReport.calls[0]?.cost.source, 'replay-zero')
  assert.equal(replayReport.calls[0]?.cost.accountedUsd, 0)
  assert.equal(replayReport.budget.liveCallsAttempted, 0)
  assert.equal(liveFake.callCount, 1)

  const deniedBudgets: VlmBudgetV1[] = [
    { ...BUDGET, maxCalls: 0 },
    { ...BUDGET, maxSubmittedMediaBytes: PNG.byteLength - 1 },
    { ...BUDGET, maxCostUsd: 0.009 },
  ]
  for (const deniedBudget of deniedBudgets)
  {
    const deniedFake = fake([
      { kind: 'response', response: completedResponse() },
    ])
    const denied = await executeLiveVlmEvaluation({
      rubric: mixedRubric,
      request,
      budget: deniedBudget,
      budgetState: createVlmBudgetState(deniedBudget),
      adapter: deniedFake,
      replayStore: new InMemoryVlmReplayStore(),
    })
    assert.equal(denied.outcome, 'inconclusive')
    assert.equal(denied.issue?.code, 'vlm-budget-exhausted')
    assert.equal(denied.call, null)
    assert.equal(deniedFake.callCount, 0)
    assert.equal(denied.budget.liveCallsReserved, 0)
  }

  const topLevelDeniedRequest = evaluationRequest(mixedRubric)
  topLevelDeniedRequest.budget = { ...BUDGET, maxCalls: 0 }
  const topLevelDeniedFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  const topLevelDenied = await evaluateMultimodal({
    request: topLevelDeniedRequest,
    boundary: {
      mode: 'live',
      request,
      adapter: topLevelDeniedFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'top-level-budget-denial',
    createdAt: '2026-07-18T12:00:03.100Z',
    structuralPreflight: 'passed',
    deterministic: [statePass()],
    evidenceByCriterion: readyMotion(),
    differential: null,
    lenses: [],
  })
  assert.equal(topLevelDenied.verdict, 'inconclusive')
  assert.equal(topLevelDeniedFake.callCount, 0)
  assert.deepEqual(topLevelDenied.selection.selectedFrameIds, [])
  assert.deepEqual(topLevelDenied.selection.selectedClipIds, [])
  assert.deepEqual(topLevelDenied.selection.vlmCriterionIds, [])
  assert.equal(
    topLevelDenied.selection.decisions[1]?.decision,
    'stop-inconclusive'
  )

  const impossibleBudgetRequest = evaluationRequest(mixedRubric)
  impossibleBudgetRequest.budget = { ...BUDGET, maxCalls: 0 }
  const impossibleBudgetState = {
    ...createVlmBudgetState(BUDGET),
    liveCallsReserved: 1,
    liveCallsAttempted: 1,
    liveCallsSettled: 1,
  }
  await assert.rejects(
    evaluateMultimodal({
      request: impossibleBudgetRequest,
      boundary: {
        mode: 'live',
        request: null,
        adapter: noCallFake,
        replayStore: new InMemoryVlmReplayStore(),
      },
      runId: 'impossible-no-call-budget',
      createdAt: '2026-07-18T12:00:03.200Z',
      structuralPreflight: 'passed',
      deterministic: [
        statePass(),
        {
          criterionId: 'motion',
          required: true,
          verdict: 'pass',
          source: 'model',
          evidence: [],
          limitation: null,
        },
      ],
      evidenceByCriterion: {},
      differential: null,
      lenses: [],
      budgetState: impossibleBudgetState,
    }),
    /non-overrunnable policy limit/
  )
  assert.equal(noCallFake.callCount, 0)

  const malformedFake = fake([
    {
      kind: 'response',
      response: completedResponse({ schemaVersion: 1, criteria: [] }),
    },
  ])
  const malformed = await executeLiveVlmEvaluation({
    rubric: mixedRubric,
    request,
    budget: BUDGET,
    budgetState: createVlmBudgetState(BUDGET),
    adapter: malformedFake,
    replayStore: new InMemoryVlmReplayStore(),
  })
  assert.equal(malformed.outcome, 'inconclusive')
  assert.equal(malformed.call?.outcome, 'invalid-response')
  assert.equal(malformed.budget.liveCallsAttempted, 1)
  assert.equal(malformed.budget.submittedMediaBytes, PNG.byteLength)
  assert.equal(malformed.budget.chargedCostUsd, 0.01)

  const throwingFake = fake([{ kind: 'throw', error: 'provider unavailable' }])
  const thrown = await executeLiveVlmEvaluation({
    rubric: mixedRubric,
    request,
    budget: BUDGET,
    budgetState: createVlmBudgetState(BUDGET),
    adapter: throwingFake,
    replayStore: new InMemoryVlmReplayStore(),
  })
  assert.equal(thrown.outcome, 'inconclusive')
  assert.equal(thrown.call?.outcome, 'provider-error')
  assert.equal(thrown.budget.liveCallsAttempted, 1)
  assert.equal(thrown.budget.observedInputTokens, null)
  assert.equal(thrown.budget.chargedInputTokens, 50)
  assert.equal(thrown.budget.chargedCostUsd, 0.01)

  const timeoutAdapter = new CooperativeTimeoutAdapter()
  const timedOut = await executeLiveVlmEvaluation({
    rubric: mixedRubric,
    request,
    budget: BUDGET,
    budgetState: createVlmBudgetState(BUDGET),
    adapter: timeoutAdapter,
    replayStore: new InMemoryVlmReplayStore(),
    timeoutMs: 5,
  })
  assert.equal(timedOut.outcome, 'inconclusive')
  assert.equal(timedOut.issue?.code, 'provider-timeout')
  assert.equal(timedOut.call?.providerCallCount, 1)
  assert.equal(timeoutAdapter.callCount, 1)

  const overrunEstimate = { ...ESTIMATE, inputTokens: 10, totalTokens: 74 }
  const overrunFake = fake(
    [
      {
        kind: 'response',
        response: completedResponse(rawMotionJudgment(), 11),
      },
    ],
    overrunEstimate
  )
  const overrun = await executeLiveVlmEvaluation({
    rubric: mixedRubric,
    request,
    budget: BUDGET,
    budgetState: createVlmBudgetState(BUDGET),
    adapter: overrunFake,
    replayStore: new InMemoryVlmReplayStore(),
  })
  assert.equal(overrun.outcome, 'inconclusive')
  assert.equal(overrun.call?.outcome, 'budget-overrun')
  assert.deepEqual(overrun.budget.overrunReasons, ['settlement-overrun'])

  const changedContext = context()
  changedContext.scenarioSha256 = 'd'.repeat(64)
  const contextMissRequest = preparedRequest(mixedRubric, changedContext)
  const contextMiss = await executeReplayVlmEvaluation({
    rubric: mixedRubric,
    request: contextMissRequest,
    budgetState: createVlmBudgetState(BUDGET),
    replayStore: store,
  })
  assert.equal(contextMiss.outcome, 'inconclusive')
  assert.equal(contextMiss.issue?.code, 'replay-miss')
  assert.equal(contextMiss.call, null)
  assert.equal(liveFake.callCount, 1)

  const topLevelReplayMissRequest = evaluationRequest(mixedRubric)
  topLevelReplayMissRequest.mode = 'replay'
  const topLevelReplayMiss = await evaluateMultimodal({
    request: topLevelReplayMissRequest,
    boundary: {
      mode: 'replay',
      request,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'top-level-replay-miss',
    createdAt: '2026-07-18T12:00:03.300Z',
    structuralPreflight: 'passed',
    deterministic: [statePass()],
    evidenceByCriterion: readyMotion(),
    differential: null,
    lenses: [],
  })
  assert.equal(topLevelReplayMiss.verdict, 'inconclusive')
  assert.deepEqual(topLevelReplayMiss.selection.selectedFrameIds, [])
  assert.deepEqual(topLevelReplayMiss.selection.selectedClipIds, [])
  assert.deepEqual(topLevelReplayMiss.selection.vlmCriterionIds, [])

  const wrongSampleFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  await assert.rejects(
    evaluateMultimodal({
      request: evaluationRequest(mixedRubric),
      boundary: {
        mode: 'live',
        request: preparedRequest(mixedRubric, context(1)),
        adapter: wrongSampleFake,
        replayStore: new InMemoryVlmReplayStore(),
      },
      runId: 'sample-binding-mismatch',
      createdAt: '2026-07-18T12:00:03.400Z',
      structuralPreflight: 'passed',
      deterministic: [statePass()],
      evidenceByCriterion: readyMotion(),
      differential: null,
      lenses: [],
    }),
    /context does not match evaluation/
  )
  assert.equal(wrongSampleFake.callCount, 0)

  const visualOnlyRubric = rubric(false)
  const visualOnlyRequest = preparedRequest(visualOnlyRubric, context(1))
  const visualOnlyFake = fake([
    { kind: 'response', response: completedResponse() },
  ])
  const visualOnlyReport = await evaluateMultimodal({
    request: evaluationRequest(visualOnlyRubric, 1),
    boundary: {
      mode: 'live',
      request: visualOnlyRequest,
      adapter: visualOnlyFake,
      replayStore: new InMemoryVlmReplayStore(),
    },
    runId: 'visual-only',
    createdAt: '2026-07-18T12:00:04.000Z',
    structuralPreflight: 'passed',
    deterministic: [],
    evidenceByCriterion: readyMotion(),
    differential: null,
    lenses: [],
  })
  assert.equal(visualOnlyReport.rubric?.verdict, 'passed')
  assert.equal(visualOnlyReport.verdict, 'passed')
})
