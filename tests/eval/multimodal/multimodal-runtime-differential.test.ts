// tests/eval/multimodal/multimodal-runtime-differential.test.ts
// consequential real official Scratch/TurboWarp differential & classification proof

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildCollector, buildMovement } from '@scratch-agent/ir'
import {
  installBrowserWebSocketPolicy,
  runScenario,
  type ObservationPlanV1,
  type Scenario,
} from '@scratch-agent/runner'
import { chromium } from 'playwright'

import {
  assessSb3DifferentialCapabilities,
  bindDifferentialCapabilities,
} from '@scratch-agent/eval'
import {
  evaluateBehavioralDifferential,
  runCheapRuntimeDifferential,
  runRenderedRuntimeDifferential,
} from '@scratch-agent/eval'
import type { BehavioralLensSpecV1 } from '@scratch-agent/eval'
import { hashMultimodalJson } from '@scratch-agent/eval'
import {
  createMultimodalEvidenceFacet,
  evaluateMultimodal,
  type MultimodalEvaluationRequest,
} from '@scratch-agent/eval'
import type { RubricSpecV1 } from '@scratch-agent/eval'

function lens(
  report: ReturnType<typeof evaluateBehavioralDifferential>,
  id: string
)
{
  const result = report.results.find((entry) => entry.specId === id)
  assert.ok(result, `missing lens ${id}`)
  return result
}

test('Multimodal runtime differentials reject scenario-level network access', async () =>
{
  const sb3 = await buildMovement().toSb3()
  const observationPlan: ObservationPlanV1 = {
    schemaVersion: 1,
    temporal: null,
    cloneCounts: 'none',
  }
  const scenarios: Scenario[] = [
    { allowNetwork: true, steps: [] },
    { allowedOrigins: ['https://network.invalid'], steps: [] },
  ]
  for (const scenario of scenarios)
  {
    await assert.rejects(
      runCheapRuntimeDifferential(sb3, scenario, {
        browser: { screenshotDir: 'unused-cheap-screenshots' },
        observationPlan,
        specs: [],
      }),
      /scenario must remain network-denied/
    )
    await assert.rejects(
      runRenderedRuntimeDifferential(sb3, scenario, {
        official: { screenshotDir: 'unused-official-screenshots' },
        turboWarp: { screenshotDir: 'unused-turbowarp-screenshots' },
        observationPlan,
        specs: [],
      }),
      /scenario must remain network-denied/
    )
  }
})

test('Multimodal classifies loudness hats as unsupported external audio input', async () =>
{
  for (const menu of ['LOUDNESS', 'LoUdNeSs'])
  {
    const loudnessProject = buildMovement()
    loudnessProject.target('Mover')!.addScript([
      {
        opcode: 'event_whengreaterthan',
        fields: { WHENGREATERTHANMENU: [menu, null] },
        inputs: { VALUE: 10 },
      },
    ])
    const loudness = await assessSb3DifferentialCapabilities(
      await loudnessProject.toSb3(),
      'official-browser-vs-turbowarp-browser'
    )
    const loudnessByKind = new Map(
      loudness.capabilities.map((capability) => [capability.kind, capability])
    )
    assert.equal(loudness.classification, 'unsupported', menu)
    assert.deepEqual(loudnessByKind.get('audio')?.opcodes, [
      'event_whengreaterthan',
    ])
    assert.deepEqual(loudnessByKind.get('external-input')?.opcodes, [
      'event_whengreaterthan',
    ])
  }

  const timerProject = buildMovement()
  timerProject.target('Mover')!.addScript([
    {
      opcode: 'event_whengreaterthan',
      fields: { WHENGREATERTHANMENU: ['TIMER', null] },
      inputs: { VALUE: 10 },
    },
  ])
  const timer = await assessSb3DifferentialCapabilities(
    await timerProject.toSb3(),
    'official-browser-vs-turbowarp-browser'
  )
  assert.equal(timer.classification, 'comparable')
  assert.ok(
    !timer.capabilities.some(
      (capability) =>
        capability.kind === 'audio' || capability.kind === 'external-input'
    )
  )
})

test('Multimodal runs and classifies a real rendered runtime differential', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'multimodal-runtime-differential-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sb3 = await buildMovement().toSb3()
  const scenario: Scenario = {
    seed: 23,
    fixedDateMs: 1_700_000_000_000,
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'start' },
      { do: 'tapKey', key: 'right' },
      { do: 'wait', ticks: 4 },
      { do: 'snapshot', label: 'end' },
    ],
  }
  const observationPlan: ObservationPlanV1 = {
    schemaVersion: 1,
    temporal: {
      firstTick: 0,
      lastTick: 6,
      everyTicks: 6,
      playbackFps: 10,
      maxFrames: 2,
      maxBytes: 2 * 1024 * 1024,
      derivedVideo: false,
    },
    cloneCounts: 'every-tick',
  }
  const agreementSpecs: BehavioralLensSpecV1[] = [
    {
      schemaVersion: 1,
      id: 'final',
      kind: 'final-state',
      required: true,
      appliesTo: 'runtime-runtime',
      absoluteNumericTolerance: 0,
    },
    {
      schemaVersion: 1,
      id: 'trace',
      kind: 'labeled-trace',
      required: true,
      appliesTo: 'runtime-runtime',
      labels: ['start', 'end'],
      absoluteNumericTolerance: 0,
    },
    {
      schemaVersion: 1,
      id: 'outcome',
      kind: 'runtime-outcome',
      required: true,
      appliesTo: 'runtime-runtime',
    },
    {
      schemaVersion: 1,
      id: 'clones',
      kind: 'clone-count-trace',
      required: true,
      appliesTo: 'runtime-runtime',
      ticks: [0, 6],
    },
  ]
  const invalidPlan = structuredClone(observationPlan)
  invalidPlan.temporal!.everyTicks = 0
  await assert.rejects(
    runRenderedRuntimeDifferential(sb3, scenario, {
      official: {
        screenshotDir: join(root, 'invalid-official-screenshots'),
        mediaDir: join(root, 'invalid-official-media'),
      },
      turboWarp: {
        screenshotDir: join(root, 'invalid-turbowarp-screenshots'),
        mediaDir: join(root, 'invalid-turbowarp-media'),
      },
      observationPlan: invalidPlan,
      specs: agreementSpecs,
    }),
    /invalid rendered differential observation plan/
  )
  await assert.rejects(
    runRenderedRuntimeDifferential(sb3, scenario, {
      official: {
        screenshotDir: join(root, 'missing-media-official-screenshots'),
      },
      turboWarp: {
        screenshotDir: join(root, 'missing-media-turbowarp-screenshots'),
        mediaDir: join(root, 'missing-media-turbowarp-media'),
      },
      observationPlan,
      specs: agreementSpecs,
    }),
    /requires both media directories/
  )
  await assert.rejects(
    runRenderedRuntimeDifferential(sb3, scenario, {
      official: {
        screenshotDir: join(root, 'network-official-screenshots'),
        mediaDir: join(root, 'network-official-media'),
        allowNetwork: true,
      },
      turboWarp: {
        screenshotDir: join(root, 'network-turbowarp-screenshots'),
        mediaDir: join(root, 'network-turbowarp-media'),
      },
      observationPlan,
      specs: agreementSpecs,
    }),
    /must remain network-denied/
  )
  const differential = await runRenderedRuntimeDifferential(sb3, scenario, {
    official: {
      screenshotDir: join(root, 'official-screenshots'),
      mediaDir: join(root, 'official-media'),
    },
    turboWarp: {
      screenshotDir: join(root, 'turbowarp-screenshots'),
      mediaDir: join(root, 'turbowarp-media'),
    },
    observationPlan,
    specs: agreementSpecs,
  })

  assert.ok(differential.official.ok, differential.official.errors.join('; '))
  assert.ok(differential.turboWarp.ok, differential.turboWarp.errors.join('; '))
  assert.equal(
    differential.official.runtimeDescriptor.kind,
    'scratch-official-browser'
  )
  assert.equal(
    differential.turboWarp.runtimeDescriptor.kind,
    'turbowarp-browser'
  )
  assert.equal(
    differential.official.runtimeDescriptor.compiler,
    'not-applicable'
  )
  assert.equal(differential.turboWarp.runtimeDescriptor.compiler, 'enabled')
  assert.equal(differential.official.runtimeDescriptor.network, 'denied')
  assert.equal(differential.turboWarp.runtimeDescriptor.network, 'denied')
  assert.notEqual(
    differential.report.left.runtimeDescriptorSha256,
    differential.report.right.runtimeDescriptorSha256
  )
  assert.equal(
    differential.report.left.runtimeDescriptor.kind,
    'scratch-official-browser'
  )
  assert.equal(differential.report.right.runtimeDescriptor.compiler, 'enabled')
  assert.equal(
    differential.report.capabilityAssessment.classification,
    'comparable'
  )
  assert.equal(differential.report.capabilityAssessment.status, 'assessed')
  assert.match(
    differential.report.capabilityAssessment.sourceSb3Sha256 ?? '',
    /^[0-9a-f]{64}$/
  )
  assert.deepEqual(differential.report.capabilityAssessment.capabilities, [])
  assert.deepEqual(
    differential.report.left.runtimeDescriptor,
    differential.official.runtimeDescriptor
  )
  assert.deepEqual(
    differential.report.right.runtimeDescriptor,
    differential.turboWarp.runtimeDescriptor
  )
  assert.deepEqual(
    differential.report.left.runtimeDescriptor.components.map(
      ({ name, version }) => [name, version]
    ),
    [
      ['@scratch/scratch-vm', '14.1.0'],
      ['@scratch/scratch-render', '14.1.0'],
      ['scratch-storage', '6.2.1'],
      ['@scratch/scratch-svg-renderer', '14.1.0'],
      ['scratch-audio', '2.0.268'],
      ['playwright', '1.61.1'],
    ]
  )
  for (const component of differential.report.left.runtimeDescriptor
    .components)
    {
    assert.match(component.sha256 ?? '', /^[0-9a-f]{64}$/)
    assert.ok((component.byteLength ?? 0) > 0)
  }
  assert.match(
    differential.report.left.runtimeDescriptor.bundle?.sha256 ?? '',
    /^[0-9a-f]{64}$/
  )
  assert.ok(
    (differential.report.left.runtimeDescriptor.bundle?.byteLength ?? 0) > 0
  )
  assert.deepEqual(
    differential.official.runtimeDescriptor.workers.map(
      (worker) => worker.path
    ),
    ['extension-worker.js', 'chunks/fetch-worker.7298f079654fee093ceb.js']
  )
  for (const worker of differential.report.left.runtimeDescriptor.workers)
  {
    assert.match(worker.sha256, /^[0-9a-f]{64}$/)
    assert.ok(worker.byteLength > 0)
  }
  for (const trace of [differential.official, differential.turboWarp])
  {
    assert.equal(trace.observations.media?.complete, true)
    assert.deepEqual(
      trace.observations.media?.frames.map((frame) => frame.tick),
      [0, 6]
    )
  }
  assert.equal(differential.report.verdict, 'passed')
  for (const id of ['final', 'trace', 'outcome', 'clones'])
    assert.equal(lens(differential.report, id).verdict, 'agree')

  const mismatched = structuredClone(differential.turboWarp)
  const moverId = mismatched.finalSnapshot?.targetOrder.find(
    (id) => mismatched.finalSnapshot?.targetsById[id]?.name === 'Mover'
  )
  assert.ok(moverId)
  const mismatchedMover = mismatched.finalSnapshot?.targetsById[moverId]
  assert.ok(mismatchedMover)
  mismatchedMover.x += 10
  const deliberateMismatch = evaluateBehavioralDifferential({
    comparisonKind: 'runtime-runtime',
    left: differential.official,
    right: mismatched,
    specs: [agreementSpecs[0]!],
    capabilityAssessment: differential.report.capabilityAssessment,
    seed: scenario.seed,
    fixedDateMs: scenario.fixedDateMs,
  })
  assert.equal(deliberateMismatch.verdict, 'failed')
  assert.equal(lens(deliberateMismatch, 'final').verdict, 'diverge')

  const mismatchedPlan = structuredClone(differential.turboWarp)
  mismatchedPlan.observations.planSha256 = 'f'.repeat(64)
  assert.throws(
    () =>
      evaluateBehavioralDifferential({
        comparisonKind: 'runtime-runtime',
        left: differential.official,
        right: mismatchedPlan,
        specs: [agreementSpecs[0]!],
        capabilityAssessment: differential.report.capabilityAssessment,
        seed: scenario.seed,
        fixedDateMs: scenario.fixedDateMs,
      }),
    /observation plans must match/
  )

  const frameIds = differential.official.observations.media!.frames.map(
    (frame) => frame.id
  )
  const visualSpec: BehavioralLensSpecV1 = {
    schemaVersion: 1,
    id: 'renderer-evidence',
    kind: 'visual-keyframes',
    required: true,
    appliesTo: 'runtime-runtime',
    frameIds,
    maxMeanRgbDelta: 255,
    maxNormalizedRectDelta: 1,
  }
  const renderedVisual = evaluateBehavioralDifferential({
    comparisonKind: 'runtime-runtime',
    left: differential.official,
    right: differential.turboWarp,
    specs: [visualSpec],
    capabilityAssessment: differential.report.capabilityAssessment,
    seed: scenario.seed,
    fixedDateMs: scenario.fixedDateMs,
  })
  assert.notEqual(
    lens(renderedVisual, 'renderer-evidence').verdict,
    'inconclusive'
  )
  const facetRubric: RubricSpecV1 = {
    schemaVersion: 1,
    id: 'runtime-differential-facet',
    version: '1',
    objective: 'retain a host-owned runtime visual comparison',
    criteria: [
      {
        id: 'host-state',
        requirement: 'required',
        evidenceKind: 'state-and-visual',
        description: 'the trusted host state is available',
        passAnchors: ['the trusted host state was retained'],
        failAnchors: ['the trusted host state was unavailable'],
      },
    ],
  }
  const facetRequest: MultimodalEvaluationRequest = {
    schemaVersion: 1,
    mode: 'deterministic',
    input: {
      artifactSha256: differential.turboWarp.observations.sourceSb3Sha256,
      byteLength: sb3.byteLength,
    },
    scenarioSha256: differential.turboWarp.observations.scenarioSha256,
    observationTraceSha256: hashMultimodalJson(
      differential.turboWarp.observations
    ),
    sampleOrdinal: 0,
    rubric: facetRubric,
    observationPlan,
    lenses: [visualSpec],
    budget: {
      schemaVersion: 1,
      maxCalls: 1,
      maxSubmittedMediaBytes: 2 * 1024 * 1024,
      maxInputTokens: null,
      maxCumulativeOutputTokens: 128,
      maxCostUsd: null,
      maxUniqueClips: 2,
    },
    vlmPolicy: null,
  }
  const facetReport = await evaluateMultimodal({
    request: facetRequest,
    boundary: { mode: 'deterministic' },
    runId: 'runtime-differential-facet',
    createdAt: '2026-07-18T18:00:00.000Z',
    structuralPreflight: 'passed',
    deterministic: [
      {
        criterionId: 'host-state',
        required: true,
        verdict: 'pass',
        source: 'state',
        evidence: [],
        limitation: null,
      },
    ],
    evidenceByCriterion: {},
    differential: renderedVisual,
    lenses: renderedVisual.results,
  })
  const facet = createMultimodalEvidenceFacet(
    facetReport,
    differential.turboWarp.observations,
    {
      left: differential.official.observations,
      right: differential.turboWarp.observations,
    }
  )
  assert.deepEqual(
    facet.differentialTemporal?.left,
    differential.official.observations
  )
  assert.deepEqual(
    facet.differentialTemporal?.right,
    differential.turboWarp.observations
  )
  assert.throws(
    () =>
      createMultimodalEvidenceFacet(
        facetReport,
        differential.turboWarp.observations
      ),
    /needs both retained traces/
  )
  assert.throws(
    () =>
      createMultimodalEvidenceFacet(
        facetReport,
        differential.turboWarp.observations,
        {
          left: differential.turboWarp.observations,
          right: differential.official.observations,
        }
      ),
    /does not match its report-side runtime context|primary evaluation trace/
  )

  const headless = await runScenario(sb3, scenario, { observationPlan })
  assert.ok(headless.ok, headless.errors.join('; '))
  assert.throws(
    () =>
      evaluateBehavioralDifferential({
        comparisonKind: 'runtime-runtime',
        left: differential.official,
        right: headless,
        specs: [visualSpec],
        capabilityAssessment: differential.report.capabilityAssessment,
        seed: scenario.seed,
        fixedDateMs: scenario.fixedDateMs,
      }),
    /capability assessment binding does not match/
  )
  const classifiedCustomCapabilities = await assessSb3DifferentialCapabilities(
    sb3,
    'custom-runtime-pair'
  )
  const customCapabilityAssessment = bindDifferentialCapabilities(
    classifiedCustomCapabilities,
    {
      sourceSb3Sha256: differential.official.observations.sourceSb3Sha256,
      runtimeDescriptor: differential.official.runtimeDescriptor,
    },
    {
      sourceSb3Sha256: headless.observations.sourceSb3Sha256,
      runtimeDescriptor: headless.runtimeDescriptor,
    }
  )
  const unavailableRenderer = evaluateBehavioralDifferential({
    comparisonKind: 'runtime-runtime',
    left: differential.official,
    right: headless,
    specs: [visualSpec],
    capabilityAssessment: customCapabilityAssessment,
    seed: scenario.seed,
    fixedDateMs: scenario.fixedDateMs,
  })
  assert.equal(unavailableRenderer.verdict, 'inconclusive')
  assert.equal(
    lens(unavailableRenderer, 'renderer-evidence').inconclusiveReason,
    'unsupported-feature'
  )
  assert.deepEqual(unavailableRenderer.capabilityRequirements, [
    {
      specId: 'renderer-evidence',
      capability: 'renderer',
      support: 'unsupported',
      reason: 'a visual-keyframes lens requires a renderer in both lanes',
    },
  ])

  const rendererProject = await buildCollector().toSb3()
  const cheapRendererAssessment = await assessSb3DifferentialCapabilities(
    rendererProject,
    'official-headless-vs-turbowarp-browser'
  )
  const renderedRendererAssessment = await assessSb3DifferentialCapabilities(
    rendererProject,
    'official-browser-vs-turbowarp-browser'
  )
  assert.equal(cheapRendererAssessment.classification, 'unsupported')
  assert.equal(renderedRendererAssessment.classification, 'comparable')
  assert.equal(
    cheapRendererAssessment.capabilities.find(
      (capability) => capability.kind === 'renderer'
    )?.support,
    'unsupported'
  )
  assert.equal(
    renderedRendererAssessment.capabilities.find(
      (capability) => capability.kind === 'renderer'
    )?.support,
    'supported'
  )

  const dependencyProject = buildMovement()
  const dependencyTarget = dependencyProject.target('Mover')!
  const loudId = dependencyTarget.addVariable('loud', 0)
  const onlineId = dependencyTarget.addVariable('online', 0)
  dependencyTarget.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'looks_setsizeto', inputs: { SIZE: 100 } },
    { opcode: 'sound_setvolumeto', inputs: { VOLUME: 50 } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['loud', loudId] },
      inputs: { VALUE: { reporter: { opcode: 'sensing_loud' } } },
    },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['online', onlineId] },
      inputs: { VALUE: { reporter: { opcode: 'sensing_online' } } },
    },
  ])
  const dependencyAssessment = await assessSb3DifferentialCapabilities(
    await dependencyProject.toSb3(),
    'official-headless-vs-turbowarp-browser'
  )
  const dependencyByKind = new Map(
    dependencyAssessment.capabilities.map((capability) => [
      capability.kind,
      capability,
    ])
  )
  assert.deepEqual(dependencyByKind.get('renderer')?.opcodes, [
    'looks_setsizeto',
  ])
  assert.deepEqual(dependencyByKind.get('audio')?.opcodes, ['sensing_loud'])
  assert.deepEqual(dependencyByKind.get('network')?.opcodes, ['sensing_online'])
  assert.ok(
    !dependencyByKind.get('audio')?.opcodes.includes('sound_setvolumeto')
  )

  const volumeOnlyProject = buildMovement()
  volumeOnlyProject
    .target('Mover')!
    .addScript([
      { opcode: 'event_whenflagclicked' },
      { opcode: 'sound_setvolumeto', inputs: { VOLUME: 50 } },
    ])
  const volumeOnlyAssessment = await assessSb3DifferentialCapabilities(
    await volumeOnlyProject.toSb3(),
    'official-browser-vs-turbowarp-browser'
  )
  assert.equal(volumeOnlyAssessment.classification, 'comparable')
  assert.ok(
    !volumeOnlyAssessment.capabilities.some(
      (capability) => capability.kind === 'audio'
    )
  )

  const browser = await chromium.launch({ headless: true })
  try
  {
    const page = await browser.newPage()
    const blocked: string[] = []
    await installBrowserWebSocketPolicy(page, (url) => blocked.push(url), {})
    await page.goto('data:text/html,<title>offline-websocket-probe</title>')
    const close = await page.evaluate(
      (url) =>
        new Promise<{ code: number; reason: string }>((resolve) =>
        {
          const socket = new WebSocket(url)
          socket.onclose = (event) =>
            resolve({ code: event.code, reason: event.reason })
        }),
      'wss://network-denial.invalid/socket'
    )
    assert.deepEqual(blocked, ['wss://network-denial.invalid/socket'])
    assert.deepEqual(close, { code: 1008, reason: 'network disabled' })
  }
  finally
  {
    await browser.close()
  }
})
