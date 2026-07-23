// tests/eval/multimodal/multimodal-temporal.test.ts
// consequential Multimodal temporal-evidence & manifest-integrity regression

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  runBrowserScenario,
  verifyMediaManifest,
  type ObservationPlanV1,
  type Scenario,
} from '@scratch-agent/runner'

import { buildGlider } from '@scratch-agent/eval'

test('Multimodal retains bounded logical frames and a verified media manifest', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'multimodal-temporal-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const mediaRoot = join(root, 'media')
  const plan: ObservationPlanV1 = {
    schemaVersion: 1,
    temporal: {
      firstTick: 0,
      lastTick: 60,
      everyTicks: 6,
      playbackFps: 10,
      maxFrames: 11,
      maxBytes: 5 * 1024 * 1024,
      derivedVideo: true,
    },
    cloneCounts: 'every-tick',
  }
  const scenario: Scenario = {
    seed: 17,
    fixedDateMs: 1_700_000_000_000,
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 60 },
      { do: 'snapshot', label: 'end' },
    ],
  }
  const trace = await runBrowserScenario(
    await buildGlider().toSb3(),
    scenario,
    {
      screenshotDir: join(root, 'screenshots'),
      mediaDir: mediaRoot,
      observationPlan: plan,
    }
  )

  assert.ok(trace.ok, trace.errors.join('; '))
  assert.equal(trace.mediaRoot, mediaRoot)
  assert.equal(trace.runtimeDescriptor.kind, 'turbowarp-browser')
  const manifest = trace.observations.media
  assert.ok(manifest)
  assert.equal(manifest.complete, true)
  assert.deepEqual(
    manifest.frames.map((frame) => frame.tick),
    [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60]
  )
  assert.equal(new Set(manifest.frames.map((frame) => frame.id)).size, 11)
  assert.ok(
    new Set(manifest.frames.map((frame) => frame.sha256)).size > 1,
    'motion must produce more than one authoritative frame identity'
  )
  assert.equal(manifest.frames.at(-1)?.snapshotLabel, 'end')
  assert.ok(
    manifest.frames.every(
      (frame, index) =>
        frame.index === index &&
        frame.width === 480 &&
        frame.height === 360 &&
        frame.bytes > 0 &&
        frame.sampledMeanRgb.values.length ===
          frame.sampledMeanRgb.columns * frame.sampledMeanRgb.rows * 3 &&
        frame.geometry.targets.some(
          (target) => target.name === 'Glider' && target.instance === 'original'
        )
    )
  )
  for (const frame of manifest.frames)
  {
    const path = join(mediaRoot, frame.relativePath)
    assert.ok(existsSync(path), `missing ${frame.relativePath}`)
    assert.equal(statSync(path).size, frame.bytes)
  }
  assert.ok(manifest.derivedVideo)
  assert.equal(manifest.derivedVideo.authoritative, false)
  assert.deepEqual(
    manifest.derivedVideo.sourceFrameIds,
    manifest.frames.map((frame) => frame.id)
  )
  assert.ok(
    existsSync(join(mediaRoot, manifest.derivedVideo.relativePath)),
    'derived video is retained'
  )
  assert.deepEqual(verifyMediaManifest(manifest, mediaRoot, plan), [])
  assert.equal(trace.observations.cloneCounts.length, 61)
  assert.deepEqual(
    trace.observations.cloneCounts.map((sample) => sample.tick),
    Array.from({ length: 61 }, (_, tick) => tick)
  )
  assert.ok(
    trace.observations.cloneCounts.every(
      (sample) =>
        sample.total === 0 &&
        Object.values(sample.byOriginalTargetId).every((count) => count === 0)
    )
  )
})
