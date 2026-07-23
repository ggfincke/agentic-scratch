// tests/model/checks.test.ts
// check-catalog evaluation & model-JSON loading/validation

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { VmSpriteState, VmStateSnapshot } from '@scratch-agent/runner'

import { evaluateCheck } from '@scratch-agent/model'
import {
  loadModelsFromText,
  parseModels,
} from '@scratch-agent/model'
import type { Check, CheckContext } from '@scratch-agent/model'

function sprite(
  name: string,
  over: Partial<VmSpriteState> = {}
): VmSpriteState
{
  return {
    id: `s-${name}`,
    name,
    isStage: name === 'Stage',
    x: 0,
    y: 0,
    direction: 90,
    costume: 'c1',
    visible: true,
    size: 100,
    rotationStyle: 'all around',
    draggable: false,
    volume: 100,
    effects: {},
    bubble: null,
    variables: {},
    lists: {},
    ...over,
  }
}

function snap(over: Partial<VmStateSnapshot> = {}): VmStateSnapshot
{
  return {
    tick: 1,
    targetOrder: [],
    targetsById: {},
    stageTargetId: 'stage',
    targets: {},
    variables: {},
    lists: {},
    answer: '',
    timer: 0,
    stage: { backdrop: 'b1', tempo: 60, videoState: 'on' },
    ...over,
  }
}

function ctx(
  over: Partial<CheckContext> & { state: VmStateSnapshot }
): CheckContext
{
  return {
    prev: null,
    keysDown: [],
    clicked: [],
    storage: {},
    ticksSinceTransition: 0,
    tick: over.state.tick,
    programEndTick: null,
    random: () => 0.5,
    ...over,
  }
}

const check = (name: string, args: Check['args'], negated = false): Check => ({
  name,
  negated,
  args,
})

test('VarComp reads globals & sprite-locals with scratch-faithful ops', () =>
{
  const state = snap({
    variables: { score: 10 },
    targets: { Cat: sprite('Cat', { variables: { hp: 3 } }) },
  })
  const c = ctx({ state })
  assert.equal(
    evaluateCheck(check('VarComp', ['Stage', 'score', '>=', 10]), c),
    true
  )
  assert.equal(
    evaluateCheck(check('VarComp', ['Stage', 'score', '<', 10]), c),
    false
  )
  assert.equal(evaluateCheck(check('VarComp', ['Cat', 'hp', '==', 3]), c), true)
  // a missing variable can't satisfy a comparison
  assert.equal(
    evaluateCheck(check('VarComp', ['Stage', 'missing', '==', 0]), c),
    false
  )
})

test('negated inverts a check result', () =>
{
  const c = ctx({ state: snap({ variables: { score: 5 } }) })
  assert.equal(
    evaluateCheck(check('VarComp', ['Stage', 'score', '==', 5], true), c),
    false
  )
  assert.equal(
    evaluateCheck(check('VarComp', ['Stage', 'score', '==', 9], true), c),
    true
  )
})

test('VarChange compares against the previous tick', () =>
{
  const prev = snap({ variables: { score: 2 } })
  const state = snap({ variables: { score: 3 } })
  const c = ctx({ state, prev })
  assert.equal(
    evaluateCheck(check('VarChange', ['Stage', 'score', '+']), c),
    true
  )
  assert.equal(
    evaluateCheck(check('VarChange', ['Stage', 'score', '-']), c),
    false
  )
  assert.equal(
    evaluateCheck(check('VarChange', ['Stage', 'score', 1]), c),
    true
  )
  assert.equal(
    evaluateCheck(check('VarChange', ['Stage', 'score', 2]), c),
    false
  )
  // no previous state -> a change cannot be determined
  assert.equal(
    evaluateCheck(check('VarChange', ['Stage', 'score', '+']), ctx({ state })),
    false
  )
})

test('AttrComp maps attributes; Stage currentCostumeName is the backdrop', () =>
{
  const state = snap({
    targets: {
      Cat: sprite('Cat', { x: 42, visible: false, costume: 'walk' }),
      Stage: sprite('Stage', { costume: 'won' }),
    },
  })
  const c = ctx({ state })
  assert.equal(evaluateCheck(check('AttrComp', ['Cat', 'x', '>', 40]), c), true)
  assert.equal(
    evaluateCheck(check('AttrComp', ['Cat', 'visible', '==', false]), c),
    true
  )
  assert.equal(
    evaluateCheck(
      check('AttrComp', ['Cat', 'currentCostumeName', '==', 'walk']),
      c
    ),
    true
  )
  assert.equal(
    evaluateCheck(
      check('AttrComp', ['Stage', 'currentCostumeName', '==', 'won']),
      c
    ),
    true
  )
})

test('Output, Key, Click & AnyKey read bubble/input context', () =>
{
  const state = snap({
    targets: { Cat: sprite('Cat', { bubble: { text: 'hi', type: 'say' } }) },
  })
  const c = ctx({ state, keysDown: ['right'], clicked: ['Cat'] })
  assert.equal(evaluateCheck(check('Output', ['Cat', 'hi']), c), true)
  assert.equal(evaluateCheck(check('Output', ['Cat', 'bye']), c), false)
  // 'right' presses match the canonical 'right arrow'
  assert.equal(evaluateCheck(check('Key', ['right arrow']), c), true)
  assert.equal(evaluateCheck(check('Key', ['space']), c), false)
  assert.equal(evaluateCheck(check('AnyKey', []), c), true)
  assert.equal(evaluateCheck(check('Click', ['Cat']), c), true)
})

test('TimeElapsed converts ms against our 60 TPS clock; Probability uses the rng', () =>
{
  const state = snap({ tick: 30 })
  // 500ms == 30 ticks at 1000/60 ms per tick
  const c = ctx({ state, ticksSinceTransition: 30 })
  assert.equal(evaluateCheck(check('TimeElapsed', [500]), c), true)
  assert.equal(evaluateCheck(check('TimeElapsed', [600]), c), false)
  assert.equal(
    evaluateCheck(
      check('Probability', [0.75]),
      ctx({ state, random: () => 0.5 })
    ),
    true
  )
  assert.equal(
    evaluateCheck(
      check('Probability', [0.25]),
      ctx({ state, random: () => 0.5 })
    ),
    false
  )
})

test('SpriteTouching needs the browser touching hook', () =>
{
  const state = snap({ targets: { A: sprite('A'), B: sprite('B') } })
  assert.throws(() =>
    evaluateCheck(check('SpriteTouching', ['A', 'B']), ctx({ state }))
  )
  const c = ctx({ state, touching: (a, b) => a === 'A' && b === 'B' })
  assert.equal(evaluateCheck(check('SpriteTouching', ['A', 'B']), c), true)
})

test('loadModels sorts models by role & converts ms timings to ticks', () =>
{
  const models = loadModelsFromText(
    JSON.stringify([
      {
        id: 'prog',
        usage: 'program',
        startNodeId: 'a',
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [
          {
            id: 'e',
            from: 'a',
            to: 'b',
            conditions: [{ name: 'VarComp', args: ['Stage', 's', '>=', 1] }],
          },
        ],
      },
      {
        id: 'post',
        usage: 'end',
        startNodeId: 'a',
        nodes: [{ id: 'a' }],
        edges: [],
      },
      {
        id: 'driver',
        usage: 'user',
        maxDuration: 1000,
        startNodeId: 'a',
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [
          {
            id: 'e',
            from: 'a',
            to: 'b',
            effects: [{ name: 'InputKey', args: ['space'] }],
          },
        ],
      },
    ])
  )
  assert.equal(models.programModels.length, 1)
  assert.equal(models.endModels.length, 1)
  assert.equal(models.userModels.length, 1)
  // 1000ms maxDuration converts to 60 ticks at our 60 TPS clock
  assert.equal(models.userModels[0]!.maxDurationTicks, 60)
  // the user model's effect lowers to an input, not an assertion
  assert.equal(models.userModels[0]!.edges[0]!.inputs[0]!.name, 'InputKey')
})

test('loadModels rejects forceTestAt/forceTestAfter (unimplemented)', () =>
{
  assert.throws(
    () =>
      loadModelsFromText(
        JSON.stringify([
          {
            id: 'm',
            usage: 'program',
            startNodeId: 'a',
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', from: 'a', to: 'b', forceTestAfter: 500 }],
          },
        ])
      ),
    /forceTest/
  )
})

test('loadModels rejects unsupported checks & impure conditions', () =>
{
  // Expr is deferred / not in the supported catalog
  assert.throws(() =>
    loadModelsFromText(
      JSON.stringify([
        {
          id: 'm',
          usage: 'program',
          startNodeId: 'a',
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [
            {
              id: 'e',
              from: 'a',
              to: 'b',
              conditions: [{ name: 'Expr', args: ['x>0'] }],
            },
          ],
        },
      ])
    )
  )
  // a storage effect is impure & cannot be an edge condition
  assert.throws(() =>
    loadModelsFromText(
      JSON.stringify([
        {
          id: 'm',
          usage: 'program',
          startNodeId: 'a',
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [
            {
              id: 'e',
              from: 'a',
              to: 'b',
              conditions: [{ name: 'SetStorage', args: ['k', 1] }],
            },
          ],
        },
      ])
    )
  )
})

test('parseModels rejects a malformed model file', () =>
{
  assert.throws(() => parseModels('{"not":"an array"}'))
  assert.throws(() => parseModels(JSON.stringify([{ usage: 'program' }])))
})
