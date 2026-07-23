// tests/eval/multimodal/multimodal-lenses.test.ts
// consequential Multimodal lens-parametric regression & tolerance proof

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMovement } from '@scratch-agent/ir'
import {
  hashObservationPlan,
  runScenario,
  type MediaFrameRefV1,
  type ObservationPlanV1,
  type VmTrace,
} from '@scratch-agent/runner'

import { evaluateBehavioralDifferential } from '@scratch-agent/eval'
import type { BehavioralLensSpecV1 } from '@scratch-agent/eval'

function frame(mean: number): MediaFrameRefV1
{
  return {
    id: 'frame-mid',
    index: 0,
    tick: 1,
    scenarioStepIndex: 1,
    snapshotLabel: 'mid',
    relativePath: 'frames/mid.png',
    mimeType: 'image/png',
    width: 480,
    height: 360,
    meanRgb: [mean, mean, mean],
    sampledMeanRgb: {
      columns: 1,
      rows: 1,
      values: [mean, mean, mean],
    },
    geometry: {
      canvas: { width: 480, height: 360 },
      targets: [
        {
          originalTargetId: 'sprite-1-Mover',
          name: 'Mover',
          isStage: false,
          instance: 'original',
          instanceIndex: 0,
          visible: true,
          costumeIndex: 0,
          costumeName: 'mover',
          rect: { x: 230, y: 170, width: 20, height: 20 },
        },
      ],
    },
    bytes: 100,
    sha256: 'a'.repeat(64),
  }
}

function addVisualEvidence(
  trace: VmTrace,
  plan: ObservationPlanV1,
  mean: number
): void
{
  trace.observations.media = {
    schemaVersion: 1,
    observationPlanSha256: hashObservationPlan(plan),
    runtime: trace.runtimeDescriptor,
    frames: [frame(mean)],
    derivedVideo: null,
    totalFrameBytes: 100,
    complete: true,
    incompleteReason: null,
  }
}

function result(
  report: ReturnType<typeof evaluateBehavioralDifferential>,
  id: string
)
{
  const found = report.results.find((entry) => entry.specId === id)
  assert.ok(found, `missing lens ${id}`)
  return found
}

test('Multimodal lenses expose transient, visual, and clone regressions independently', async () =>
{
  const plan: ObservationPlanV1 = {
    schemaVersion: 1,
    temporal: null,
    cloneCounts: 'sampled',
  }
  const baseline = await runScenario(
    await buildMovement().toSb3(),
    {
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 1 },
        { do: 'snapshot', label: 'mid' },
        { do: 'wait', ticks: 1 },
        { do: 'snapshot', label: 'end' },
      ],
    },
    { observationPlan: plan }
  )
  assert.ok(baseline.ok, baseline.errors.join('; '))
  addVisualEvidence(baseline, plan, 100)
  const candidate = structuredClone(baseline)
  const moverId = candidate.snapshots[0]!.targetOrder.find(
    (id) => candidate.snapshots[0]!.targetsById[id]?.name === 'Mover'
  )
  assert.ok(moverId)
  candidate.snapshots[0]!.targetsById[moverId]!.x += 5
  candidate.observations.media!.frames[0]!.meanRgb = [110, 110, 110]
  candidate.observations.media!.frames[0]!.sampledMeanRgb.values = [
    110, 110, 110,
  ]
  const cloneSample = candidate.observations.cloneCounts.find(
    (sample) => sample.tick === 1
  )
  assert.ok(cloneSample)
  cloneSample.total = 1
  cloneSample.byOriginalTargetId[moverId] = 1

  const specs: BehavioralLensSpecV1[] = [
    {
      schemaVersion: 1,
      id: 'final',
      kind: 'final-state',
      required: true,
      appliesTo: 'both',
      absoluteNumericTolerance: 0,
    },
    {
      schemaVersion: 1,
      id: 'trace',
      kind: 'labeled-trace',
      required: true,
      appliesTo: 'baseline-candidate',
      labels: ['mid'],
      absoluteNumericTolerance: 0,
    },
    {
      schemaVersion: 1,
      id: 'visual',
      kind: 'visual-keyframes',
      required: true,
      appliesTo: 'baseline-candidate',
      frameIds: ['frame-mid'],
      maxMeanRgbDelta: 1,
      maxNormalizedRectDelta: 0.001,
    },
    {
      schemaVersion: 1,
      id: 'clones',
      kind: 'clone-count-trace',
      required: true,
      appliesTo: 'baseline-candidate',
      ticks: [1],
    },
  ]
  const report = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: baseline,
    right: candidate,
    specs,
  })

  assert.equal(result(report, 'final').verdict, 'agree')
  assert.equal(result(report, 'trace').verdict, 'diverge')
  assert.equal(result(report, 'visual').verdict, 'diverge')
  assert.equal(result(report, 'clones').verdict, 'diverge')
  assert.equal(report.verdict, 'failed')

  const jitter = structuredClone(baseline)
  jitter.snapshots[0]!.targetsById[moverId]!.x += 0.05
  const tolerant = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: baseline,
    right: jitter,
    specs: [
      {
        schemaVersion: 1,
        id: 'tolerant-trace',
        kind: 'labeled-trace',
        required: true,
        appliesTo: 'baseline-candidate',
        labels: ['mid'],
        absoluteNumericTolerance: 0,
        numericToleranceByPath: {
          [`$.labels["mid"].targetsById.${moverId}.x`]: 0.1,
        },
      },
    ],
  })
  assert.equal(result(tolerant, 'tolerant-trace').verdict, 'agree')
  assert.equal(tolerant.verdict, 'passed')
})
