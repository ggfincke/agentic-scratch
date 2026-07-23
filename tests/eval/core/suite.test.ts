// tests/eval/core/suite.test.ts
// every canonical VM test case passes; matchers coerce; failures localize

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { blankProject, buildClicker } from '@scratch-agent/ir'
import type { ProjectIR } from '@scratch-agent/ir'
import { runScenario } from '@scratch-agent/runner'
import type {
  Scenario,
  VisualObservation,
  VmStateSnapshot,
} from '@scratch-agent/runner'
import type { Costume } from '@scratch-agent/sb3'

import type { AssertResult, Assertion } from '@scratch-agent/eval'
import { evaluate } from '@scratch-agent/eval'
import { buildRelay } from '@scratch-agent/eval'
import { scratchEquals } from '@scratch-agent/eval'
import { vmTestSuite } from '@scratch-agent/eval'
import { runTest } from '@scratch-agent/eval'
import type { TestCase } from '@scratch-agent/eval'
import { fixturePath } from '../../helpers/repo-paths.js'

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  '<rect width="20" height="20" fill="#4c97ff"/></svg>'

function svgCostume(name: string): { costume: Costume; bytes: Uint8Array }
{
  const bytes = Buffer.from(SVG, 'utf-8')
  const assetId = createHash('md5').update(bytes).digest('hex')
  return {
    costume: {
      name,
      assetId,
      md5ext: `${assetId}.svg`,
      dataFormat: 'svg',
      bitmapResolution: 1,
      rotationCenterX: 10,
      rotationCenterY: 10,
    },
    bytes,
  }
}

function spriteWith(ir: ProjectIR, name: string)
{
  const sprite = ir.addSprite(name)
  const { costume, bytes } = svgCostume(name)
  sprite.addCostume(costume, bytes)
  return sprite
}

function buildNonVisualCounter(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'Looper')
  const countId = sprite.addVariable('count', 0)
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_forever',
      inputs: {
        SUBSTACK: {
          substack: [
            {
              opcode: 'data_changevariableby',
              fields: { VARIABLE: ['count', countId] },
              inputs: { VALUE: 1 },
            },
          ],
        },
      },
    },
  ])
  return ir
}

function buildSlowReceiver(waitSeconds: number): ProjectIR
{
  const ir = blankProject()
  const bcId = ir.stage!.addBroadcast('go')
  const sprite = spriteWith(ir, 'Receiver')
  const doneId = sprite.addVariable('done', 0)
  sprite.addScript([
    {
      opcode: 'event_whenbroadcastreceived',
      fields: { BROADCAST_OPTION: ['go', bcId] },
    },
    { opcode: 'control_wait', inputs: { DURATION: waitSeconds } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['done', doneId] },
      inputs: { VALUE: 1 },
    },
  ])
  return ir
}

function buildKeyHoldCounter(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'KeyWatcher')
  const heldId = sprite.addVariable('held', 0)
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_forever',
      inputs: {
        SUBSTACK: {
          substack: [
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  boolean: {
                    opcode: 'sensing_keypressed',
                    inputs: { KEY_OPTION: 'right arrow' },
                  },
                },
                SUBSTACK: {
                  substack: [
                    {
                      opcode: 'data_changevariableby',
                      fields: { VARIABLE: ['held', heldId] },
                      inputs: { VALUE: 1 },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  ])
  return ir
}

function buildTranslateProject(): ProjectIR
{
  const ir = blankProject()
  ir.toProjectJson().extensions = ['translate']
  const sprite = spriteWith(ir, 'Translator')
  const resultId = sprite.addVariable('result', '')
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['result', resultId] },
      inputs: {
        VALUE: {
          reporter: {
            opcode: 'translate_getTranslate',
            inputs: { WORDS: 'hello', LANGUAGE: 'Spanish' },
          },
        },
      },
    },
  ])
  return ir
}

function failureText(asserts: AssertResult[]): string
{
  return asserts
    .filter((a) => !a.ok)
    .map(
      (a) =>
        `${a.location.hint}: expected ${a.expected}, observed ${a.observed}`
    )
    .join('; ')
}

for (const tc of vmTestSuite)
{
  test(`vm: ${tc.name}`, async () =>
  {
    const r = await runTest(tc)
    assert.ok(r.ok, `${r.errors.join('; ')} ${failureText(r.asserts)}`)
  })
}

test('matcher: scratchEquals coerces numeric strings', () =>
{
  assert.ok(scratchEquals('0', 0))
  assert.ok(scratchEquals(5, '5'))
  assert.ok(!scratchEquals('hi', 0))
  assert.ok(scratchEquals('HELLO', 'hello'))
})

// the runner can inject a broadcast directly (no in-project sender needed)
test('runner: a broadcast step drives a when-I-receive hat', async () =>
{
  const scenario: Scenario = {
    steps: [
      { do: 'broadcast', name: 'go' },
      { do: 'wait', ticks: 2 },
      { do: 'snapshot', label: 'after' },
    ],
  }
  const trace = await runScenario(await buildRelay().toSb3(), scenario)
  assert.equal(trace.ok, true)
  assert.equal(trace.snapshots[0]?.targets.Receiver?.x, 10)
})

test('runner: snapshots keep Stage identity when a sprite is also named Stage', async () =>
{
  const sb3 = readFileSync(fixturePath('sprite-named-stage.sb3'))
  const trace = await runScenario(sb3, {
    steps: [{ do: 'snapshot', label: 'initial' }],
  })
  assert.equal(trace.ok, true)
  const snap = trace.snapshots[0]
  assert.ok(snap)
  const stage = snap.targetsById[snap.stageTargetId]
  assert.equal(stage?.isStage, true)
  assert.equal(snap.targets.Stage?.id, stage?.id)
  assert.ok(
    Object.values(snap.targets).some((t) => !t.isStage && t.name === 'Stage')
  )
  assert.ok('my variable' in snap.variables)
  assert.ok(snap.timer >= 0)
})

test('runner: non-visual tight loops are deterministic per tick', async () =>
{
  const sb3 = await buildNonVisualCounter().toSb3()
  const values: unknown[] = []
  for (let i = 0; i < 5; i++)
  {
    const trace = await runScenario(sb3, {
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 1 },
        { do: 'snapshot', label: 'after' },
      ],
    })
    assert.equal(trace.ok, true, trace.errors.join('; '))
    values.push(trace.snapshots[0]?.targets.Looper?.variables.count)
  }
  assert.deepEqual([...new Set(values)], [values[0]])
  assert.equal(typeof values[0], 'number')
  assert.ok((values[0] as number) > 0)
})

test('runner: broadcastAndWait fails when receiver threads exceed the cap', async () =>
{
  const trace = await runScenario(await buildSlowReceiver(5).toSb3(), {
    steps: [{ do: 'broadcastAndWait', name: 'go', maxTicks: 1 }],
  })
  assert.equal(trace.ok, false)
  assert.match(trace.errors[0] ?? '', /broadcastAndWait "go" exceeded maxTicks/)
})

test('runner: broadcastAndWait waits until receiver completion', async () =>
{
  const trace = await runScenario(await buildSlowReceiver(1).toSb3(), {
    steps: [
      { do: 'broadcastAndWait', name: 'go', maxTicks: 90 },
      { do: 'snapshot', label: 'after' },
    ],
  })
  assert.equal(trace.ok, true, trace.errors.join('; '))
  const snap = trace.snapshots[0]
  assert.ok(snap)
  assert.ok(scratchEquals(snap.targets.Receiver?.variables.done, 1))
  assert.ok(snap.tick > 1)
})

test('runner: keyDown holds until keyUp releases it', async () =>
{
  const trace = await runScenario(await buildKeyHoldCounter().toSb3(), {
    steps: [
      { do: 'greenFlag' },
      { do: 'keyDown', key: 'right' },
      { do: 'wait', ticks: 3 },
      { do: 'snapshot', label: 'held' },
      { do: 'keyUp', key: 'right' },
      { do: 'wait', ticks: 3 },
      { do: 'snapshot', label: 'released' },
    ],
  })
  assert.equal(trace.ok, true, trace.errors.join('; '))
  const held = trace.snapshots.find((s) => s.label === 'held')
  const released = trace.snapshots.find((s) => s.label === 'released')
  const heldCount = held?.targets.KeyWatcher?.variables.held as number
  const releasedCount = released?.targets.KeyWatcher?.variables.held as number
  assert.ok(heldCount > 0)
  assert.equal(releasedCount, heldCount)
})

test('runner: translate extension fetches are blocked by default', async () =>
{
  const trace = await runScenario(await buildTranslateProject().toSb3(), {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 5 },
      { do: 'snapshot', label: 'after' },
    ],
  })
  assert.equal(trace.ok, false)
  assert.match(
    trace.errors.join('; '),
    /blocked network request: https:\/\/translate-service\.scratch\.mit\.edu\//
  )
})

// invariant: the engine never reports ok:true when the probed value is absent
test('eval: a prop probe with an unresolved value never passes', async () =>
{
  const trace = await runScenario(await buildClicker().toSb3(), {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 's' },
    ],
  })
  // an out-of-enum prop resolves to undefined; the engine must not pass it
  const bogus = {
    at: 's',
    probe: { on: 'prop', sprite: 'Sprite1', prop: 'bogus' },
    match: { kind: 'contains', value: 'undefined' },
  } as unknown as Assertion
  const res = evaluate(trace, [bogus])[0]
  assert.equal(res?.ok, false)
  assert.equal(res?.observed, '<absent>')
})

// robustness: a malformed step verb fails loudly rather than silently passing
test('runner: an unknown step verb fails loudly', async () =>
{
  const bad = { steps: [{ do: 'frobnicate' }] } as unknown as Scenario
  const trace = await runScenario(await buildClicker().toSb3(), bad)
  assert.equal(trace.ok, false)
  assert.match(trace.errors[0] ?? '', /unknown step/)
})

// determinism: the same scenario yields a byte-identical snapshot trace
test('runner: scenario traces are reproducible', async () =>
{
  const scenario: Scenario = {
    seed: 7,
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 3 },
      { do: 'clickSprite', sprite: 'Sprite1' },
      { do: 'wait', ticks: 2 },
      { do: 'snapshot', label: 'end' },
    ],
  }
  const sb3 = await buildClicker().toSb3()
  const a = await runScenario(sb3, scenario)
  const b = await runScenario(sb3, scenario)
  assert.equal(JSON.stringify(a.snapshots), JSON.stringify(b.snapshots))
})

// a deliberately wrong expectation must localize: expected/observed + target
test('vm: a failing assertion carries expected, observed & location', async () =>
{
  const broken: TestCase = {
    name: 'clicker but expects the wrong score',
    project: buildClicker(),
    scenario: {
      steps: [
        { do: 'greenFlag' },
        { do: 'clickSprite', sprite: 'Sprite1' },
        { do: 'wait', ticks: 1 },
        { do: 'snapshot', label: 'after' },
      ],
    },
    asserts: [
      {
        at: 'after',
        probe: { on: 'var', name: 'score', sprite: 'Sprite1' },
        match: { kind: 'equals', value: 99 },
      },
    ],
  }
  const r = await runTest(broken)
  assert.equal(r.ok, false)
  const a = r.asserts[0]
  assert.ok(a)
  assert.equal(a.ok, false)
  assert.equal(a.observed, '1')
  assert.equal(a.location.target, 'Sprite1')
  assert.match(a.expected, /99/)
})

// a uniform grid observation; only gridCols/gridRows/visual presence matter for these paths
function uniformVisual(cols: number, rows: number): VisualObservation
{
  return {
    canvas: { width: 480, height: 360 },
    spriteRects: {},
    gridCols: cols,
    gridRows: rows,
    grid: new Array(cols * rows * 3).fill(200),
    geometry: { canvas: { width: 480, height: 360 }, targets: [] },
    identityIssues: [],
  }
}

// regionChanged must fail as not-found (never spuriously pass) when the reference is unusable
test('eval: regionChanged is not-found on a missing from-snapshot or grid mismatch', () =>
{
  const now = {
    label: 'now',
    visual: uniformVisual(4, 4),
  } as unknown as VmStateSnapshot

  // (a) the referenced 'from' snapshot does not exist
  const missing = evaluate({ snapshots: [now] }, [
    {
      at: 'now',
      probe: { on: 'regionChanged', from: 'start' },
      match: { kind: 'gt', value: 0 },
    },
  ])[0]
  assert.equal(missing?.ok, false)
  assert.equal(missing?.observed, '<absent>')

  // (b) the two frames have incompatible grid dimensions (regionChangedCount -> -1)
  const start = {
    label: 'start',
    visual: uniformVisual(8, 4),
  } as unknown as VmStateSnapshot
  const mismatch = evaluate({ snapshots: [start, now] }, [
    {
      at: 'now',
      probe: { on: 'regionChanged', from: 'start' },
      match: { kind: 'gt', value: 0 },
    },
  ])[0]
  assert.equal(mismatch?.ok, false)
  assert.equal(mismatch?.observed, '<absent>')
})

// duplicate snapshot labels would clobber the byLabel lookup & the screenshot file: fail loudly
test('runner: a scenario with duplicate snapshot labels fails loudly', async () =>
{
  const trace = await runScenario(await buildClicker().toSb3(), {
    steps: [
      { do: 'greenFlag' },
      { do: 'snapshot', label: 'x' },
      { do: 'snapshot', label: 'x' },
    ],
  })
  assert.equal(trace.ok, false)
  assert.match(trace.errors[0] ?? '', /duplicate snapshot label/)
})
