// tests/eval/visual/visual-assert.test.ts
// visual assertion DSL end-to-end: probes evaluate against the browser lane & localize failures

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildMovement } from '@scratch-agent/ir'
import type { Scenario } from '@scratch-agent/runner'

import type { Assertion } from '@scratch-agent/eval'
import { runTest, type TestCase } from '@scratch-agent/eval'
import { collectorCase } from '@scratch-agent/eval'

// a caller-owned artifact dir keeps screenshots on pass (opt-out runs auto-discard them)
function artifactDir(prefix: string): string
{
  return mkdtempSync(join(tmpdir(), prefix))
}

// drive the Mover from center (x=0) rightward by 80px via eight arrow taps
const scenario: Scenario = {
  steps: [
    { do: 'greenFlag' },
    { do: 'wait', ticks: 1 },
    { do: 'snapshot', label: 'start' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'tapKey', key: 'right' },
    { do: 'snapshot', label: 'moved' },
  ],
}

test('visual probes pass against the browser lane', async () =>
{
  const passing: Assertion[] = [
    // sprite is centered horizontally at the start (canvas center x = 240)
    {
      at: 'start',
      probe: { on: 'spriteRect', sprite: 'Mover', field: 'cx' },
      match: { kind: 'closeTo', value: 240, eps: 3 },
    },
    // the stage is not a blank frame
    {
      at: 'start',
      probe: { on: 'notBlank' },
      match: { kind: 'equals', value: true },
    },
    // after moving right the sprite is in the right half of the stage
    {
      at: 'moved',
      probe: {
        on: 'spriteInRegion',
        sprite: 'Mover',
        region: { x: 300, y: 0, width: 180, height: 360 },
      },
      match: { kind: 'equals', value: true },
    },
    // the band the sprite travelled through visibly changed between snapshots
    {
      at: 'moved',
      probe: {
        on: 'regionChanged',
        from: 'start',
        region: { x: 220, y: 150, width: 140, height: 60 },
      },
      match: { kind: 'gt', value: 0 },
    },
  ]
  const tc: TestCase = {
    name: 'visual: mover moves right',
    project: buildMovement(),
    scenario,
    asserts: [],
    visual: passing,
  }
  const result = await runTest(tc, {
    artifactDir: artifactDir('vis-pass-'),
    recordVideo: false,
  })
  assert.ok(
    result.ok,
    `expected pass; errors=${result.errors.join('; ')} visual=${result.visual
      .filter((a) => !a.ok)
      .map((a) => `${a.observed}`)
      .join(', ')}`
  )
  assert.equal(result.visual.length, 4)
  assert.ok(
    result.visual.every((a) => a.ok),
    'all visual asserts pass'
  )
  // screenshots were captured for the snapshot steps
  assert.ok(result.screenshots.length >= 2, 'screenshots captured')
  assert.ok(result.screenshots.every((s) => existsSync(s.path)))
})

test('a failing visual probe localizes to the sprite', async () =>
{
  const tc: TestCase = {
    name: 'visual: wrong position localizes',
    project: buildMovement(),
    scenario,
    asserts: [],
    visual: [
      {
        at: 'start',
        probe: { on: 'spriteRect', sprite: 'Mover', field: 'cx' },
        match: { kind: 'closeTo', value: 999, eps: 1 },
      },
    ],
  }
  const result = await runTest(tc, { recordVideo: false })
  assert.equal(result.ok, false, 'wrong position fails')
  const failed = result.visual.find((a) => !a.ok)
  assert.ok(failed, 'a visual assert failed')
  assert.equal(
    failed.location.target,
    'Mover',
    'failure localizes to the sprite'
  )
})

test('video is kept on failure & discarded on pass', async () =>
{
  const passing: TestCase = {
    name: 'video: passing run',
    project: buildMovement(),
    scenario,
    asserts: [],
    visual: [
      {
        at: 'start',
        probe: { on: 'notBlank' },
        match: { kind: 'equals', value: true },
      },
    ],
  }
  const pass = await runTest(passing)
  assert.ok(pass.ok, `expected pass; errors=${pass.errors.join('; ')}`)
  assert.equal(pass.video, null, 'a passing run discards its video')

  const failing: TestCase = {
    name: 'video: failing run',
    project: buildMovement(),
    scenario,
    asserts: [],
    visual: [
      {
        at: 'start',
        probe: { on: 'spriteRect', sprite: 'Mover', field: 'cx' },
        match: { kind: 'closeTo', value: 999, eps: 1 },
      },
    ],
  }
  const fail = await runTest(failing)
  assert.equal(fail.ok, false, 'wrong assert fails')
  assert.ok(fail.video, 'a failing run keeps its video')
  assert.ok(existsSync(fail.video), `video file exists: ${fail.video}`)
  assert.ok(statSync(fail.video).size > 0, 'video is non-empty')
})

// the collector fixture: the browser lane detects a touch the headless vm lane cannot
test('collector: browser lane detects the render-dependent collision', async () =>
{
  const result = await runTest(collectorCase, {
    artifactDir: artifactDir('collector-'),
    recordVideo: false,
  })
  assert.ok(
    result.ok,
    `expected pass; errors=${result.errors.join('; ')}; failed=${result.visual
      .concat(result.asserts)
      .filter((a) => !a.ok)
      .map((a) => `${a.location.hint}: ${a.observed}`)
      .join(' | ')}`
  )
  // the vm lane (no renderer) sees no collision
  assert.ok(
    result.asserts.every((a) => a.ok),
    'vm lane score stays 0 (no renderer)'
  )
  // the browser lane (renderer) scores the touch & localizes both sprites
  assert.ok(
    result.visual.every((a) => a.ok),
    'browser lane scores the touch & localizes sprites'
  )
  assert.ok(result.screenshots.length >= 2, 'stage screenshots captured')
})
