// tests/repair/multimodal-boundary.test.ts
// major provider, localization, & opt-in repair promotion boundary proof

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  InMemoryVlmReplayStore,
  MULTIMODAL_SCHEMA_VERSION,
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  ScriptedFakeVlmAdapter,
  createMultimodalEvidenceFacet,
  evaluateMultimodal,
  hashMultimodalJson,
  prepareVlmRequest,
  type CriterionVerdict,
  type MultimodalEvaluationRequest,
  type MultimodalVlmPolicyV1,
  type RawRubricJudgmentV1,
  type RubricSpecV1,
  type VlmAdapterResponse,
  type VlmBudgetV1,
  type VlmContextBindingV1,
  type VlmProviderDescriptor,
  type VlmRequestEstimate,
} from '@scratch-agent/eval'
import { buildClicker } from '@scratch-agent/ir'
import { localizeVisualSymptoms } from '@scratch-agent/localize'
import {
  createObservationTrace,
  hashObservationPlan,
  hashScenario,
  type ObservationPlanV1,
  type ObservationTraceV1,
  type RuntimeDescriptorV1,
  type Scenario,
} from '@scratch-agent/runner'

import {
  buildRepairBenchmark,
  evaluateRepairMultimodal,
  startRepair,
  validateRepairMultimodalEvaluation,
  type RepairMultimodalEvaluationEnvelopeV1,
  type RepairMultimodalEvaluationInputV1,
  type RepairMultimodalEvaluator,
} from '@scratch-agent/repair'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: null,
  cloneCounts: 'none',
}
const TEMPORAL_PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: {
    firstTick: 6,
    lastTick: 6,
    everyTicks: 6,
    playbackFps: 30,
    maxFrames: 1,
    maxBytes: PNG.byteLength,
    derivedVideo: false,
  },
  cloneCounts: 'none',
}
const RUNTIME: RuntimeDescriptorV1 = {
  schemaVersion: 1,
  id: 'multimodal-boundary-runtime',
  kind: 'scratch-official-browser',
  configurationSha256: 'd'.repeat(64),
  renderer: 'scratch-render',
  compiler: 'disabled',
  network: 'denied',
  components: [],
  browser: { name: 'test-browser', version: '1' },
  bundle: null,
  workers: [],
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
}
const PROVIDER: VlmProviderDescriptor = {
  adapter: 'multimodal-boundary-fake',
  provider: 'repository-test',
  model: 'fake-visual-v1',
  version: '1',
}
const ESTIMATE: VlmRequestEstimate = {
  inputTokens: 48,
  outputTokens: 128,
  totalTokens: 176,
  usd: 0.01,
  pricingTableVersion: 'test-v1',
  unavailableReason: null,
}
const BUDGET: VlmBudgetV1 = {
  schemaVersion: 1,
  maxCalls: 1,
  maxSubmittedMediaBytes: PNG.byteLength,
  maxInputTokens: 128,
  maxCumulativeOutputTokens: 128,
  maxCostUsd: 0.02,
  maxUniqueClips: 1,
}
const PROMPT_TEMPLATE_TEXT = 'judge only the admitted rubric and image evidence'
const VLM_POLICY: MultimodalVlmPolicyV1 = {
  prompt: {
    template: {
      id: 'multimodal-boundary-prompt',
      version: '1',
      sha256: sha256(PROMPT_TEMPLATE_TEXT),
    },
    templateText: PROMPT_TEMPLATE_TEXT,
  },
  provider: PROVIDER,
  generation: { temperature: 0, maxOutputTokens: 128 },
}
const VISUAL_RUBRIC: RubricSpecV1 = {
  schemaVersion: MULTIMODAL_SCHEMA_VERSION,
  id: 'visual-localization-boundary',
  version: '1',
  objective: 'identify only artifact-backed visual symptoms',
  criteria: [
    {
      id: 'visual',
      requirement: 'required',
      evidenceKind: 'temporal',
      description: 'the visible project presentation is coherent',
      passAnchors: ['the admitted frame is visually coherent'],
      failAnchors: ['the admitted frame exposes a visible defect'],
    },
  ],
}
const REPAIR_RUBRIC: RubricSpecV1 = {
  schemaVersion: MULTIMODAL_SCHEMA_VERSION,
  id: 'repair-state-boundary',
  version: '1',
  objective: 'retain one host-owned Multimodal acceptance gate',
  criteria: [
    {
      id: 'host-state',
      requirement: 'required',
      evidenceKind: 'state-and-visual',
      description: 'the trusted host state gate passes',
      passAnchors: ['the declared host state agrees'],
      failAnchors: ['the declared host state differs'],
    },
  ],
}

function sha256(value: Uint8Array | string): string
{
  return createHash('sha256').update(value).digest('hex')
}

function retainedPngTrace(
  artifactBytes: Uint8Array,
  scenario: Scenario
): ObservationTraceV1
{
  const trace = createObservationTrace(artifactBytes, scenario, TEMPORAL_PLAN)
  trace.media = {
    schemaVersion: 1,
    observationPlanSha256: hashObservationPlan(TEMPORAL_PLAN),
    runtime: RUNTIME,
    frames: [
      {
        id: 'frame-1',
        index: 0,
        tick: 6,
        scenarioStepIndex: 0,
        snapshotLabel: null,
        relativePath: 'frames/frame-1.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        meanRgb: [0, 0, 0],
        sampledMeanRgb: { columns: 1, rows: 1, values: [0, 0, 0] },
        geometry: { canvas: { width: 1, height: 1 }, targets: [] },
        bytes: PNG.byteLength,
        sha256: sha256(PNG),
      },
    ],
    derivedVideo: null,
    totalFrameBytes: PNG.byteLength,
    complete: true,
    incompleteReason: null,
  }
  return trace
}

function fakeResponse(raw: unknown): VlmAdapterResponse
{
  return {
    outcome: 'completed',
    responseId: 'multimodal-boundary-response',
    model: PROVIDER.model,
    latencyMs: 4,
    usage: {
      inputTokens: 40,
      outputTokens: 64,
      totalTokens: 104,
      available: true,
      unavailableReason: null,
    },
    billedCostUsd: null,
    raw,
    error: null,
  }
}

function fakeAdapter(raw: unknown): ScriptedFakeVlmAdapter
{
  return new ScriptedFakeVlmAdapter({
    descriptor: PROVIDER,
    estimate: ESTIMATE,
    actions: [{ kind: 'response', response: fakeResponse(raw) }],
  })
}

function rawJudgment(frameId = 'frame-1'): RawRubricJudgmentV1
{
  const evidence = [
    {
      evidenceId: 'visual-evidence',
      frameId,
      tick: 6,
      region: null,
    },
  ]
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    criteria: [
      {
        criterionId: 'visual',
        verdict: 'pass',
        confidence: 0.9,
        evidence,
        symptoms: [
          {
            id: 'sprite-appearance',
            kind: 'appearance',
            subject: { kind: 'sprite', name: 'Sprite1' },
            assetName: 'costume1',
            description: 'the admitted sprite appearance is relevant',
            evidence: [
              {
                ...evidence[0]!,
                region: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
              },
            ],
          },
          {
            id: 'score-monitor',
            kind: 'monitor',
            subject: {
              kind: 'monitor',
              targetName: 'Sprite1',
              declarationName: 'score',
            },
            assetName: null,
            description: 'the admitted score monitor is relevant',
            evidence,
          },
          {
            id: 'combined-evidence',
            kind: 'appearance',
            subject: { kind: 'unknown' },
            assetName: 'costume1',
            description:
              'the region disambiguates an asset name shared by two sprites',
            evidence: [
              {
                ...evidence[0]!,
                region: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
              },
            ],
          },
          {
            id: 'hallucinated-target',
            kind: 'appearance',
            subject: { kind: 'sprite', name: 'Ghost' },
            assetName: null,
            description: 'the provider supplied a target that does not exist',
            evidence,
          },
        ],
        limitation: null,
      },
    ],
  }
}

function visualRequest(
  context: VlmContextBindingV1,
  rubric: RubricSpecV1 = VISUAL_RUBRIC
): ReturnType<typeof prepareVlmRequest>
{
  return prepareVlmRequest({
    context,
    mediaAdmission: {
      maxSubmittedMediaBytes: BUDGET.maxSubmittedMediaBytes,
      maxUniqueClips: BUDGET.maxUniqueClips,
    },
    rubric,
    rubricSha256: hashMultimodalJson(rubric),
    selectedCriterionIds: ['visual'],
    criterionEvidence: [{ criterionId: 'visual', frameIds: ['frame-1'] }],
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
          evidenceId: 'visual-evidence',
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
        bytes: PNG,
      },
    ],
  })
}

function rebindForgedLiveEnvelope(
  envelope: RepairMultimodalEvaluationEnvelopeV1
): void
{
  const binding = envelope.report.vlmRequest!
  const requestSha256 = hashMultimodalJson(binding)
  const call = envelope.report.calls[0]!
  call.requestSha256 = requestSha256
  call.requestKey = `multimodal-vlm-v1:${requestSha256}`
  call.descriptor = structuredClone(binding.provider)
  const rubric = envelope.report.rubric!
  rubric.evidenceSha256 = binding.evidence.sha256
  rubric.provenance.requestSha256 = requestSha256
  rubric.provenance.outputSchemaSha256 = binding.outputSchema.sha256
  rubric.provenance.criterionEvidenceSha256 = hashMultimodalJson(
    binding.criterionEvidence
  )
  rubric.provenance.context = structuredClone(binding.context)
  rubric.provenance.promptTemplate = {
    id: binding.prompt.template.id,
    version: binding.prompt.template.version,
    templateSha256: binding.prompt.template.sha256,
    renderedPromptSha256: binding.prompt.renderedSha256,
  }
  rubric.provenance.provider = {
    adapter: binding.provider.adapter,
    provider: binding.provider.provider,
    requestedModel: binding.provider.model,
    version: binding.provider.version,
    responseModel: call.responseModel!,
  }
  rubric.provenance.generation = structuredClone(binding.generation)
  envelope.evidence.rubric = structuredClone(rubric)
  envelope.evidence.evaluationSha256 = hashMultimodalJson(envelope.report)
}

async function repairEnvelope(
  input: RepairMultimodalEvaluationInputV1,
  scenario: Scenario,
  candidateVerdict: CriterionVerdict
): Promise<RepairMultimodalEvaluationEnvelopeV1>
{
  const trace = createObservationTrace(input.artifactBytes, scenario, PLAN)
  const request: MultimodalEvaluationRequest = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    mode: 'deterministic',
    input: {
      artifactSha256: input.artifact.sha256,
      byteLength: input.artifact.byteLength,
    },
    scenarioSha256: hashScenario(scenario),
    observationTraceSha256: hashMultimodalJson(trace),
    sampleOrdinal: 0,
    rubric: REPAIR_RUBRIC,
    observationPlan: PLAN,
    lenses: [],
    budget: BUDGET,
    vlmPolicy: null,
  }
  if (input.baselineRequest)
  {
    assert.equal(request.mode, input.baselineRequest.mode)
    assert.equal(request.scenarioSha256, input.baselineRequest.scenarioSha256)
    assert.equal(request.sampleOrdinal, input.baselineRequest.sampleOrdinal)
    assert.equal(
      hashMultimodalJson(request.rubric),
      hashMultimodalJson(input.baselineRequest.rubric)
    )
    assert.equal(
      hashMultimodalJson(request.observationPlan),
      hashMultimodalJson(input.baselineRequest.observationPlan)
    )
    assert.equal(
      hashMultimodalJson(request.lenses),
      hashMultimodalJson(input.baselineRequest.lenses)
    )
    assert.equal(
      hashMultimodalJson(request.budget),
      hashMultimodalJson(input.baselineRequest.budget)
    )
  }
  const verdict =
    input.role === 'baseline' ? ('fail' as const) : candidateVerdict
  const report = await evaluateMultimodal({
    request,
    boundary: { mode: 'deterministic' },
    runId: `repair-${input.sessionId}-${input.role}`,
    createdAt: '2026-07-18T18:00:00.000Z',
    structuralPreflight: 'passed',
    deterministic: [
      {
        criterionId: 'host-state',
        required: true,
        verdict,
        source: 'state',
        evidence: [],
        limitation:
          verdict === 'inconclusive'
            ? 'trusted host state remains inconclusive'
            : null,
      },
    ],
    evidenceByCriterion: {},
    differential: null,
    lenses: [],
  })
  return {
    schemaVersion: 1,
    request,
    report,
    evidence: createMultimodalEvidenceFacet(report, trace),
  }
}

function repairEvaluator(
  scenario: Scenario,
  candidateVerdict: CriterionVerdict,
  calls: RepairMultimodalEvaluationInputV1[],
  validationFailures: string[]
): RepairMultimodalEvaluator
{
  return {
    async evaluate(input)
    {
      try
      {
        calls.push({
          ...input,
          requirement: structuredClone(input.requirement),
          baselineRequest: input.baselineRequest
            ? structuredClone(input.baselineRequest)
            : null,
          artifact: { ...input.artifact },
          artifactBytes: Uint8Array.from(input.artifactBytes),
        })
        assert.equal(sha256(input.artifactBytes), input.artifact.sha256)
        const envelope = await repairEnvelope(input, scenario, candidateVerdict)
        const validation = validateRepairMultimodalEvaluation(
          envelope,
          input.artifact
        )
        if (!validation.ok)
          validationFailures.push(JSON.stringify(validation.issues))
        assert.equal(
          validation.ok,
          true,
          validation.ok ? undefined : JSON.stringify(validation.issues)
        )
        return envelope
      }
      catch (error)
      {
        validationFailures.push(
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        )
        throw error
      }
    },
  }
}

test('Multimodal provider, localization, and opt-in repair boundaries fail closed', async (t) =>
{
  const project = buildClicker()
  const sprite = project.target('Sprite1')!
  const scoreId = sprite.variableId('score')!
  const sharedCostume = structuredClone(sprite.raw.costumes[0]!)
  const sharedAsset = project.assets.find(
    (asset) => asset.path === sharedCostume.md5ext
  )!
  project
    .addSprite('Sprite2', { x: -150, y: 0 })
    .addCostume(sharedCostume, Uint8Array.from(sharedAsset.bytes))
  project.json.monitors = [
    {
      id: scoreId,
      mode: 'default',
      opcode: 'data_variable',
      params: {},
      spriteName: 'Sprite1',
      value: 0,
    },
  ]
  const artifactBytes = await project.toSb3()
  const artifactSha256 = sha256(artifactBytes)
  const deceptiveBytes = Uint8Array.from(artifactBytes)
  Object.defineProperty(deceptiveBytes, Symbol.iterator, {
    configurable: true,
    value: function* ()
    {
      yield 0
    },
  })
  let evaluatorReceivedIntrinsicBytes = false
  await assert.rejects(
    evaluateRepairMultimodal(
      {
        async evaluate(input)
        {
          evaluatorReceivedIntrinsicBytes = true
          assert.equal(input.artifactBytes.byteLength, artifactBytes.byteLength)
          assert.equal(sha256(input.artifactBytes), artifactSha256)
          throw new Error('intrinsic byte-copy sentinel')
        },
      },
      {
        schemaVersion: 1,
        role: 'baseline',
        sessionId: 'intrinsic-byte-copy',
        attemptNumber: null,
        requirement: { schemaVersion: 1, required: true },
        baselineRequest: null,
        artifact: {
          sha256: artifactSha256,
          byteLength: artifactBytes.byteLength,
        },
        artifactBytes: deceptiveBytes,
      }
    ),
    /intrinsic byte-copy sentinel/
  )
  assert.equal(evaluatorReceivedIntrinsicBytes, true)
  const providerScenario: Scenario = { steps: [] }
  const providerTrace = retainedPngTrace(artifactBytes, providerScenario)
  const context: VlmContextBindingV1 = {
    artifactSha256,
    scenarioSha256: hashScenario(providerScenario),
    observationPlanSha256: hashObservationPlan(TEMPORAL_PLAN),
    observationTraceSha256: hashMultimodalJson(providerTrace),
    sampleOrdinal: 0,
  }
  const request = visualRequest(context)
  const validFake = fakeAdapter(rawJudgment())
  const liveReplayStore = new InMemoryVlmReplayStore()
  const liveEvaluationRequest: MultimodalEvaluationRequest = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    mode: 'live',
    input: { artifactSha256, byteLength: artifactBytes.byteLength },
    scenarioSha256: context.scenarioSha256,
    observationTraceSha256: context.observationTraceSha256,
    sampleOrdinal: context.sampleOrdinal,
    rubric: VISUAL_RUBRIC,
    observationPlan: TEMPORAL_PLAN,
    lenses: [],
    budget: BUDGET,
    vlmPolicy: structuredClone(VLM_POLICY),
  }
  const liveReport = await evaluateMultimodal({
    request: liveEvaluationRequest,
    boundary: {
      mode: 'live',
      request,
      adapter: validFake,
      replayStore: liveReplayStore,
    },
    runId: 'multimodal-provider-localization-boundary',
    createdAt: '2026-07-18T18:00:00.000Z',
    structuralPreflight: 'passed',
    deterministic: [],
    evidenceByCriterion: {
      visual: {
        status: 'ready',
        frameIds: ['frame-1'],
        clipIds: ['clip-1'],
      },
    },
    differential: null,
    lenses: [],
  })
  assert.ok(liveReport.rubric, 'live rubric required for localization')
  assert.ok(liveReport.vlmRequest, 'live vlm request required for forging')
  const liveEnvelope: RepairMultimodalEvaluationEnvelopeV1 = {
    schemaVersion: 1,
    request: liveEvaluationRequest,
    report: liveReport,
    evidence: createMultimodalEvidenceFacet(liveReport, providerTrace),
  }
  const liveValidation = validateRepairMultimodalEvaluation(liveEnvelope, {
    sha256: artifactSha256,
    byteLength: artifactBytes.byteLength,
  })
  assert.equal(
    liveValidation.ok,
    true,
    liveValidation.ok ? undefined : JSON.stringify(liveValidation.issues)
  )
  const replayHitRequest: MultimodalEvaluationRequest = {
    ...liveEvaluationRequest,
    mode: 'replay',
  }
  const replayHitReport = await evaluateMultimodal({
    request: replayHitRequest,
    boundary: { mode: 'replay', request, replayStore: liveReplayStore },
    runId: 'multimodal-replay-hit-boundary',
    createdAt: '2026-07-18T18:00:00.250Z',
    structuralPreflight: 'passed',
    deterministic: [],
    evidenceByCriterion: {
      visual: {
        status: 'ready',
        frameIds: ['frame-1'],
        clipIds: ['clip-1'],
      },
    },
    differential: null,
    lenses: [],
  })
  const replayHitEnvelope: RepairMultimodalEvaluationEnvelopeV1 = {
    schemaVersion: 1,
    request: replayHitRequest,
    report: replayHitReport,
    evidence: createMultimodalEvidenceFacet(replayHitReport, providerTrace),
  }
  const replayHitValidation = validateRepairMultimodalEvaluation(
    replayHitEnvelope,
    { sha256: artifactSha256, byteLength: artifactBytes.byteLength }
  )
  assert.equal(
    replayHitValidation.ok,
    true,
    replayHitValidation.ok
      ? undefined
      : JSON.stringify(replayHitValidation.issues)
  )
  const forgedReplayEnvelope = structuredClone(replayHitEnvelope)
  forgedReplayEnvelope.report.calls[0]!.usage = {
    inputTokens: 1,
    outputTokens: 0,
    totalTokens: 1,
    available: true,
    unavailableReason: null,
  }
  forgedReplayEnvelope.report.calls[0]!.estimate = {
    inputTokens: 1,
    outputTokens: 0,
    totalTokens: 1,
    usd: 0,
    pricingTableVersion: 'replay-zero-v1',
    unavailableReason: null,
  }
  forgedReplayEnvelope.evidence.evaluationSha256 = hashMultimodalJson(
    forgedReplayEnvelope.report
  )
  const forgedReplayValidation = validateRepairMultimodalEvaluation(
    forgedReplayEnvelope,
    { sha256: artifactSha256, byteLength: artifactBytes.byteLength }
  )
  assert.equal(forgedReplayValidation.ok, false)
  if (!forgedReplayValidation.ok)
    assert.ok(
      forgedReplayValidation.issues.some(
        (issue) => issue.code === 'multimodal.evaluation-shape'
      ),
      JSON.stringify(forgedReplayValidation.issues)
    )
  const forgedLiveEnvelope = structuredClone(liveEnvelope)
  const forgedBinding = forgedLiveEnvelope.report.vlmRequest!
  forgedBinding.frames[0]!.sha256 = 'e'.repeat(64)
  forgedBinding.evidence.sha256 = hashMultimodalJson(forgedBinding.frames)
  forgedBinding.prompt.evidenceSha256 = forgedBinding.evidence.sha256
  forgedBinding.prompt.renderedSha256 = 'f'.repeat(64)
  rebindForgedLiveEnvelope(forgedLiveEnvelope)
  const forgedLiveValidation = validateRepairMultimodalEvaluation(
    forgedLiveEnvelope,
    { sha256: artifactSha256, byteLength: artifactBytes.byteLength }
  )
  assert.equal(forgedLiveValidation.ok, false)
  if (!forgedLiveValidation.ok)
    assert.ok(
      forgedLiveValidation.issues.some(
        (issue) => issue.code === 'multimodal.vlm-request-frame-binding'
      ),
      JSON.stringify(forgedLiveValidation.issues)
    )

  const forgedPromptEnvelope = structuredClone(liveEnvelope)
  forgedPromptEnvelope.report.vlmRequest!.prompt.template = {
    id: 'forged-prompt',
    version: '2',
    sha256: '1'.repeat(64),
  }
  forgedPromptEnvelope.report.vlmRequest!.prompt.renderedSha256 = '2'.repeat(64)
  rebindForgedLiveEnvelope(forgedPromptEnvelope)
  const forgedPromptValidation = validateRepairMultimodalEvaluation(
    forgedPromptEnvelope,
    { sha256: artifactSha256, byteLength: artifactBytes.byteLength }
  )
  assert.equal(forgedPromptValidation.ok, false)
  if (!forgedPromptValidation.ok)
    assert.ok(
      forgedPromptValidation.issues.some(
        (issue) => issue.code === 'multimodal.vlm-request-prompt'
      ),
      JSON.stringify(forgedPromptValidation.issues)
    )

  const forgedExecutionPolicyEnvelope = structuredClone(liveEnvelope)
  forgedExecutionPolicyEnvelope.report.vlmRequest!.provider.version =
    'forged-provider-version'
  forgedExecutionPolicyEnvelope.report.vlmRequest!.generation.temperature = 1
  rebindForgedLiveEnvelope(forgedExecutionPolicyEnvelope)
  const forgedExecutionPolicyValidation = validateRepairMultimodalEvaluation(
    forgedExecutionPolicyEnvelope,
    { sha256: artifactSha256, byteLength: artifactBytes.byteLength }
  )
  assert.equal(forgedExecutionPolicyValidation.ok, false)
  if (!forgedExecutionPolicyValidation.ok)
    assert.ok(
      forgedExecutionPolicyValidation.issues.some(
        (issue) => issue.code === 'multimodal.vlm-request-execution'
      ),
      JSON.stringify(forgedExecutionPolicyValidation.issues)
    )

  const symptoms = liveReport.rubric!.criteria[0]!.symptoms
  const localized = await localizeVisualSymptoms({
    schemaVersion: 1,
    artifactSha256,
    artifactBytes,
    symptoms,
    evidence: {
      schemaVersion: 1,
      artifactSha256,
      frames: [
        {
          evidenceId: 'visual-evidence',
          frameId: 'frame-1',
          tick: 6,
          geometry: {
            canvas: { width: 480, height: 360 },
            targets: [
              {
                originalTargetId: 'sprite-1-Sprite1',
                name: 'Sprite1',
                isStage: false,
                instance: 'original',
                instanceIndex: 0,
                visible: true,
                costumeIndex: 0,
                costumeName: 'costume1',
                rect: { x: 216, y: 162, width: 48, height: 36 },
              },
              {
                originalTargetId: 'sprite-2-Sprite2',
                name: 'Sprite2',
                isStage: false,
                instance: 'original',
                instanceIndex: 0,
                visible: true,
                costumeIndex: 0,
                costumeName: 'costume1',
                rect: { x: 66, y: 162, width: 48, height: 36 },
              },
            ],
          },
        },
      ],
    },
  })
  assert.equal(localized.counts.resolved, 3)
  assert.equal(localized.counts.unresolved, 1)
  const appearance = localized.symptoms.find(
    (entry) => entry.symptomId === 'sprite-appearance'
  )!
  assert.equal(appearance.status, 'resolved')
  assert.equal(appearance.selected.target?.name, 'Sprite1')
  assert.equal(appearance.selected.costume?.name, 'costume1')
  assert.equal(
    appearance.selected.asset?.path,
    project.target('Sprite1')!.raw.costumes[0]!.md5ext
  )
  assert.equal(
    appearance.selected.asset?.sha256,
    sha256(
      project.assets.find(
        (asset) => asset.path === appearance.selected.asset?.path
      )!.bytes
    )
  )
  const monitor = localized.symptoms.find(
    (entry) => entry.symptomId === 'score-monitor'
  )!
  assert.equal(monitor.status, 'resolved')
  assert.equal(monitor.selected.declaration?.declaration.id, scoreId)
  assert.equal(monitor.selected.declaration?.monitor.monitorIndex, 0)
  const combined = localized.symptoms.find(
    (entry) => entry.symptomId === 'combined-evidence'
  )!
  assert.equal(combined.status, 'resolved')
  assert.equal(combined.selected.target?.name, 'Sprite1')
  assert.equal(combined.selected.costume?.name, 'costume1')
  const hallucinated = localized.symptoms.find(
    (entry) => entry.symptomId === 'hallucinated-target'
  )!
  assert.equal(hallucinated.status, 'unresolved')
  assert.ok(
    hallucinated.unresolved.some(
      (entry) => entry.code === 'target-hint-not-found' && entry.blocking
    )
  )
  assert.ok(Object.isFrozen(localized))
  assert.ok(Object.isFrozen(localized.symptoms[0]))

  const root = mkdtempSync(join(tmpdir(), 'multimodal-repair-boundary-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const ordinary = buildRepairBenchmark('R1')
  const ordinarySession = await startRepair({
    artifactBytes: await ordinary.broken.toSb3(),
    repairCase: ordinary.repairCase,
    artifactRoot: join(root, 'ordinary'),
    sessionId: 'ordinary-r1',
    recordVideo: false,
  })
  const ordinaryRequest = ordinarySession.nextRequest()
  assert.ok('requestId' in ordinaryRequest)
  assert.equal(ordinaryRequest.schemaVersion, 1)
  assert.ok(!('multimodal' in ordinaryRequest))

  const blocked = buildRepairBenchmark('R1')
  blocked.repairCase.multimodal = { schemaVersion: 1, required: true }
  const blockedCalls: RepairMultimodalEvaluationInputV1[] = []
  const blockedValidationFailures: string[] = []
  const blockedSession = await startRepair({
    artifactBytes: await blocked.broken.toSb3(),
    repairCase: blocked.repairCase,
    artifactRoot: join(root, 'blocked'),
    sessionId: 'multimodal-blocked',
    recordVideo: false,
    multimodalEvaluator: repairEvaluator(
      blocked.repairCase.tests[0]!.scenario,
      'inconclusive',
      blockedCalls,
      blockedValidationFailures
    ),
  })
  assert.deepEqual(blockedValidationFailures, [])
  const blockedRequest = blockedSession.nextRequest()
  assert.ok('requestId' in blockedRequest, JSON.stringify(blockedRequest))
  assert.equal(blockedRequest.schemaVersion, 2)
  assert.equal(blockedRequest.multimodal.verdict, 'failed')
  const blockedAttempt = await blockedSession.submitProposal(
    blocked.referenceProposal(blockedRequest)
  )
  assert.equal(blockedAttempt.attempt.status, 'candidate-rejected')
  assert.equal(blockedAttempt.state, 'awaiting-proposal')
  assert.equal(blockedSession.acceptedArtifact(), null)
  assert.deepEqual(
    blockedCalls.map((entry) => entry.role),
    ['baseline', 'candidate']
  )
  assert.equal(blockedCalls[0]?.baselineRequest, null)
  assert.ok(blockedCalls[1]?.baselineRequest)

  const passing = buildRepairBenchmark('R1')
  passing.repairCase.multimodal = { schemaVersion: 1, required: true }
  const passingCalls: RepairMultimodalEvaluationInputV1[] = []
  const passingValidationFailures: string[] = []
  const passingSession = await startRepair({
    artifactBytes: await passing.broken.toSb3(),
    repairCase: passing.repairCase,
    artifactRoot: join(root, 'passing'),
    sessionId: 'multimodal-passing',
    recordVideo: false,
    multimodalEvaluator: repairEvaluator(
      passing.repairCase.tests[0]!.scenario,
      'pass',
      passingCalls,
      passingValidationFailures
    ),
  })
  assert.deepEqual(passingValidationFailures, [])
  const passingRequest = passingSession.nextRequest()
  assert.ok('requestId' in passingRequest)
  assert.equal(passingRequest.schemaVersion, 2)
  const passingAttempt = await passingSession.submitProposal(
    passing.referenceProposal(passingRequest)
  )
  assert.equal(passingAttempt.state, 'repaired')
  assert.equal(passingAttempt.attempt.status, 'repaired')
  assert.ok(passingSession.acceptedArtifact())
  assert.deepEqual(
    passingCalls.map((entry) => entry.role),
    ['baseline', 'candidate']
  )
})
