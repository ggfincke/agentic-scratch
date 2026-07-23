// tests/eval/core/browser-lane.test.ts
// browser lane parity: the same Scenario drives the vm & browser lanes to the same state

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildMovement } from '@scratch-agent/ir'
import {
  runBrowserScenario,
  runScenario,
  type Scenario,
} from '@scratch-agent/runner'

import {
  buildGlider,
  buildRelay,
  buildStuckReceiver,
} from '@scratch-agent/eval'

function tmp(prefix: string): string
{
  return mkdtempSync(join(tmpdir(), prefix))
}

function xAt(
  snaps: { label?: string; targets: Record<string, { x: number }> }[],
  label: string,
  sprite: string
): number
{
  const snap = snaps.find((s) => s.label === label)
  assert.ok(snap, `no snapshot labeled ${label}`)
  const target = snap.targets[sprite]
  assert.ok(target, `no target ${sprite} at ${label}`)
  return target.x
}

// input + frame-exact motion: arrow taps nudge x by +/-10, identical across lanes
test('browser lane matches vm lane on an input+motion scenario', async () =>
{
  const sb3 = await buildMovement().toSb3()
  const scenario: Scenario = {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'start' },
      { do: 'tapKey', key: 'right' },
      { do: 'snapshot', label: 'right1' },
      { do: 'tapKey', key: 'right' },
      { do: 'snapshot', label: 'right2' },
      { do: 'tapKey', key: 'left' },
      { do: 'snapshot', label: 'left1' },
    ],
  }
  const vm = await runScenario(sb3, scenario)
  const br = await runBrowserScenario(sb3, scenario, {
    screenshotDir: tmp('blane-move-'),
  })
  assert.ok(vm.ok, `vm errors: ${vm.errors.join('; ')}`)
  assert.ok(br.ok, `browser errors: ${br.errors.join('; ')}`)
  assert.equal(br.snapshots.length, vm.snapshots.length)
  for (const label of ['start', 'right1', 'right2', 'left1'])
  {
    assert.equal(
      xAt(br.snapshots, label, 'Mover'),
      xAt(vm.snapshots, label, 'Mover'),
      `Mover.x mismatch at ${label}`
    )
  }
  // a stage screenshot is written for every snapshot step
  assert.equal(br.screenshots.length, 4)
  for (const shot of br.screenshots)
  {
    assert.ok(existsSync(shot.path), `missing screenshot ${shot.path}`)
    assert.ok(statSync(shot.path).size > 0, `empty screenshot ${shot.path}`)
  }
})

// determinism at the edges must hold in-page: a 1s glide lands at x=100 reproducibly
test('browser lane is deterministic for a time-dependent glide', async () =>
{
  const sb3 = await buildGlider().toSb3()
  const scenario: Scenario = {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 30 },
      { do: 'snapshot', label: 'mid' },
      { do: 'wait', ticks: 50 },
      { do: 'snapshot', label: 'end' },
    ],
  }
  const a = await runBrowserScenario(sb3, scenario, {
    screenshotDir: tmp('blane-glide-a-'),
  })
  const b = await runBrowserScenario(sb3, scenario, {
    screenshotDir: tmp('blane-glide-b-'),
  })
  assert.ok(a.ok, `browser errors: ${a.errors.join('; ')}`)
  const midX = xAt(a.snapshots, 'mid', 'Glider')
  const endX = xAt(a.snapshots, 'end', 'Glider')
  assert.ok(midX > 0 && midX < 100, `mid glide x out of range: ${midX}`)
  assert.ok(Math.abs(endX - 100) < 0.5, `end glide x not ~100: ${endX}`)
  // reproducible run-to-run
  assert.equal(xAt(b.snapshots, 'mid', 'Glider'), midX)
  assert.equal(xAt(b.snapshots, 'end', 'Glider'), endX)
})

// non-white cells in the downsampled frame grid (white backdrop ~254 luminance)
function nonBackgroundCells(visual: {
  grid: number[]
  gridCols: number
  gridRows: number
}): number
{
  let count = 0
  for (let i = 0; i < visual.grid.length; i += 3)
  {
    const lum =
      ((visual.grid[i] ?? 0) +
        (visual.grid[i + 1] ?? 0) +
        (visual.grid[i + 2] ?? 0)) /
      3
    if (lum < 240) count++
  }
  return count
}

// in-page renderer observation: per-sprite screen rects + a downsampled frame grid
test('browser lane captures per-sprite screen rects & a frame grid', async () =>
{
  const sb3 = await buildMovement().toSb3()
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
      { do: 'snapshot', label: 'moved' },
    ],
  }
  const br = await runBrowserScenario(sb3, scenario, {
    screenshotDir: tmp('blane-visual-'),
  })
  assert.ok(br.ok, `browser errors: ${br.errors.join('; ')}`)

  const start = br.snapshots.find((s) => s.label === 'start')?.visual
  const moved = br.snapshots.find((s) => s.label === 'moved')?.visual
  assert.ok(start && moved, 'visual observation present on browser snapshots')

  // a sprite at x=0 sits centered on the 480x360 stage; rect is canvas-pixel top-left
  const r0 = start.spriteRects['Mover']
  assert.ok(r0, 'Mover screen rect present')
  assert.ok(
    Math.abs(r0.x - 230) <= 2 && Math.abs(r0.y - 170) <= 2,
    `Mover rect centered: ${JSON.stringify(r0)}`
  )
  assert.ok(r0.width >= 15 && r0.width <= 25, `Mover rect ~20px: ${r0.width}`)

  // moving right shifts the rect right (sprite-level localization tracks state)
  const r1 = moved.spriteRects['Mover']
  assert.ok(r1, 'Mover rect present after move')
  assert.ok(r1.x > r0.x + 20, `Mover rect moved right: ${r0.x} -> ${r1.x}`)

  // the grid captures real rendered content, not a blank uniform frame
  assert.equal(start.grid.length, start.gridCols * start.gridRows * 3)
  assert.ok(nonBackgroundCells(start) > 0, 'grid has non-background content')
})

// broadcastAndWait synchronization works in-page (receiver drains within the cap)
test('browser lane broadcastAndWait drains the receiver in-page', async () =>
{
  const sb3 = await buildRelay().toSb3()
  const scenario: Scenario = {
    steps: [
      { do: 'broadcastAndWait', name: 'go' },
      { do: 'snapshot', label: 'after' },
    ],
  }
  const br = await runBrowserScenario(sb3, scenario, {
    screenshotDir: tmp('blane-relay-'),
  })
  assert.ok(br.ok, `browser errors: ${br.errors.join('; ')}`)
  assert.equal(xAt(br.snapshots, 'after', 'Receiver'), 10)
})

// the one lane-divergent primitive: a never-draining broadcastAndWait must fail w/ the same
// cap-exhaustion error the vm lane raises (guards the hand-mirrored budget/cap cutoff)
test('browser lane broadcastAndWait fails when the receiver exceeds the cap', async () =>
{
  const sb3 = await buildStuckReceiver().toSb3()
  const scenario: Scenario = {
    steps: [{ do: 'broadcastAndWait', name: 'go', maxTicks: 2 }],
  }
  const br = await runBrowserScenario(sb3, scenario, {
    screenshotDir: tmp('blane-stuck-'),
  })
  assert.equal(br.ok, false)
  assert.match(br.errors.join('; '), /broadcastAndWait "go" exceeded maxTicks/)
})
