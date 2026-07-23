// tests/model/checker.test.ts
// lockstep semantics: transitions, the 2-step effect window, stop nodes, coverage & end models

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  ObservedTick,
  ScalarValue,
  VmStateSnapshot,
} from '@scratch-agent/runner'

import { ModelChecker } from '@scratch-agent/model'
import { loadModelsFromText } from '@scratch-agent/model'

function tickOf(
  tick: number,
  variables: Record<string, ScalarValue>,
  keysDown: string[] = []
): ObservedTick
{
  const state: VmStateSnapshot = {
    tick,
    targetOrder: [],
    targetsById: {},
    stageTargetId: 'stage',
    targets: {},
    variables,
    lists: {},
    answer: '',
    timer: tick / 60,
    stage: { backdrop: 'b1', tempo: 60, videoState: 'on' },
  }
  return { state, keysDown, clicked: [] }
}

const GAME = JSON.stringify([
  {
    id: 'game',
    usage: 'program',
    startNodeId: 'start',
    nodes: [{ id: 'start' }, { id: 'playing' }, { id: 'won' }, { id: 'lost' }],
    edges: [
      { id: 'e_start', from: 'start', to: 'playing' },
      {
        id: 'e_win',
        from: 'playing',
        to: 'won',
        conditions: [{ name: 'VarComp', args: ['Stage', 'score', '>=', 3] }],
      },
      {
        id: 'e_lose',
        from: 'playing',
        to: 'lost',
        conditions: [{ name: 'VarComp', args: ['Stage', 'lives', '==', 0] }],
      },
      {
        id: 'e_collect',
        from: 'playing',
        to: 'playing',
        conditions: [{ name: 'Key', args: ['space'] }],
        effects: [{ name: 'VarChange', args: ['Stage', 'score', '+'] }],
      },
    ],
  },
])

test('a program model reaches the win state & covers its edges', () =>
{
  const checker = new ModelChecker(loadModelsFromText(GAME))
  checker.onTick(tickOf(1, { score: 0, lives: 3 }))
  checker.onTick(tickOf(2, { score: 1, lives: 3 }, ['space']))
  checker.onTick(tickOf(3, { score: 2, lives: 3 }, ['space']))
  checker.onTick(tickOf(4, { score: 3, lives: 3 }, ['space']))
  checker.onEnd(tickOf(4, { score: 3, lives: 3 }))

  const res = checker.results()
  const game = res.models.find((m) => m.modelId === 'game')!
  assert.equal(res.ok, true)
  assert.equal(game.finalNode, 'won')
  assert.equal(game.reachedStop, true)
  assert.deepEqual(game.coverage.total.sort(), [
    'e_collect',
    'e_lose',
    'e_start',
    'e_win',
  ])
  assert.ok(game.coverage.covered.includes('e_win'))
  assert.ok(game.coverage.covered.includes('e_collect'))
})

test('a broken increment fails the VarChange effect within the 2-step window', () =>
{
  const checker = new ModelChecker(loadModelsFromText(GAME))
  // space is pressed but score never rises (the deliberate mutation)
  checker.onTick(tickOf(1, { score: 0, lives: 3 }))
  checker.onTick(tickOf(2, { score: 0, lives: 3 }, ['space']))
  checker.onTick(tickOf(3, { score: 0, lives: 3 }, ['space']))
  checker.onTick(tickOf(4, { score: 0, lives: 3 }))

  const res = checker.results()
  const game = res.models.find((m) => m.modelId === 'game')!
  assert.equal(res.ok, false)
  assert.ok(game.failures.length >= 1)
  assert.equal(game.failures[0]!.sprite, 'Stage')
  assert.match(game.failures[0]!.check, /VarChange/)
  assert.notEqual(game.finalNode, 'won')
})

test('a stop node halts the model against further ticks', () =>
{
  const checker = new ModelChecker(loadModelsFromText(GAME))
  checker.onTick(tickOf(1, { score: 0, lives: 3 }))
  checker.onTick(tickOf(2, { score: 3, lives: 3 }))
  const wonCoverage = checker.results().models[0]!.coverage.covered.length
  // more ticks after reaching a stop node change nothing
  checker.onTick(tickOf(3, { score: 3, lives: 3 }, ['space']))
  checker.onTick(tickOf(4, { score: 3, lives: 3 }, ['space']))
  const res = checker.results().models[0]!
  assert.equal(res.finalNode, 'won')
  assert.equal(res.coverage.covered.length, wonCoverage)
})

test('simultaneously-passing edges emit an ambiguity warning', () =>
{
  const checker = new ModelChecker(
    loadModelsFromText(
      JSON.stringify([
        {
          id: 'amb',
          usage: 'program',
          startNodeId: 's',
          nodes: [{ id: 's' }, { id: 'a' }, { id: 'b' }],
          edges: [
            { id: 'e1', from: 's', to: 'a' },
            { id: 'e2', from: 's', to: 'b' },
          ],
        },
      ])
    )
  )
  checker.onTick(tickOf(1, {}))
  const res = checker.results()
  assert.ok(res.warnings.some((w) => /pass at once/.test(w)))
  // first edge wins
  assert.equal(res.models[0]!.finalNode, 'a')
})

test('an end model asserts against the frozen final state', () =>
{
  const END = JSON.stringify([
    {
      id: 'endcheck',
      usage: 'end',
      startNodeId: 's',
      nodes: [{ id: 's' }, { id: 'ok' }],
      edges: [
        {
          id: 'e',
          from: 's',
          to: 'ok',
          conditions: [{ name: 'VarComp', args: ['Stage', 'score', '>=', 1] }],
          effects: [{ name: 'VarComp', args: ['Stage', 'lives', '>=', 1] }],
        },
      ],
    },
  ])
  // score>=1 fires the edge; lives==0 makes its effect fail immediately
  const failing = new ModelChecker(loadModelsFromText(END))
  failing.onEnd(tickOf(50, { score: 5, lives: 0 }))
  assert.equal(failing.results().ok, false)

  const passing = new ModelChecker(loadModelsFromText(END))
  passing.onEnd(tickOf(50, { score: 5, lives: 2 }))
  const ok = passing.results()
  assert.equal(ok.ok, true)
  assert.equal(ok.models[0]!.finalNode, 'ok')
})

// regression: a failing effect on the edge INTO a stop node must not be dropped when the
// model stops that same tick (the recheck has to still run after the model is stopped)
const TERMINAL = JSON.stringify([
  {
    id: 'term',
    usage: 'program',
    startNodeId: 'start',
    nodes: [{ id: 'start' }, { id: 'playing' }, { id: 'won' }],
    edges: [
      { id: 'e_start', from: 'start', to: 'playing' },
      {
        id: 'e_win',
        from: 'playing',
        to: 'won',
        conditions: [{ name: 'VarComp', args: ['Stage', 'score', '>=', 3] }],
        effects: [{ name: 'VarComp', args: ['Stage', 'state', '==', 'won'] }],
      },
    ],
  },
])

test('a failing effect on a terminal edge is caught, not swallowed by the stop', () =>
{
  const checker = new ModelChecker(loadModelsFromText(TERMINAL))
  checker.onTick(tickOf(1, { score: 0, state: 'playing' }))
  // score hits 3 (e_win fires into the 'won' stop node) but the program never sets state='won'
  checker.onTick(tickOf(2, { score: 3, state: 'playing' }))
  checker.onTick(tickOf(3, { score: 3, state: 'playing' }))
  checker.onEnd(tickOf(3, { score: 3, state: 'playing' }))

  const res = checker.results()
  assert.equal(res.ok, false)
  assert.ok(res.models[0]!.failures.some((f) => /VarComp/.test(f.check)))
  assert.equal(res.models[0]!.finalNode, 'won')
})

test('an effect deferred on the final tick is flushed at run end', () =>
{
  const checker = new ModelChecker(loadModelsFromText(GAME))
  checker.onTick(tickOf(1, { score: 0, lives: 3 }))
  // last tick: space is pressed but score never rises; there is no tick after to recheck
  checker.onTick(tickOf(2, { score: 0, lives: 3 }, ['space']))
  checker.onEnd(tickOf(2, { score: 0, lives: 3 }))

  const res = checker.results()
  assert.equal(res.ok, false)
  assert.ok(res.models[0]!.failures.some((f) => /VarChange/.test(f.check)))
})
