// tests/eval/core/model-suite.test.ts
// the model suite runs a game state machine in lockstep on the vm lane (exit criterion #2)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stateGameCase } from '@scratch-agent/eval'
import { runTest } from '@scratch-agent/eval'
import { buildStateGame } from '@scratch-agent/ir'
import { loadModelsFromText } from '@scratch-agent/model'
import type { Scenario } from '@scratch-agent/runner'

test('the state-game model test expresses the FSM & passes cleanly', async () =>
{
  const r = await runTest(stateGameCase)
  assert.ok(r.ok, `errors: ${r.errors.join('; ')}`)
  assert.ok(r.model, 'model result present')

  const prog = r.model!.models.find((m) => m.modelId === 'stategame')!
  assert.equal(prog.usage, 'program')
  assert.equal(prog.ok, true)
  // the program walked start -> playing -> won
  assert.equal(prog.finalNode, 'won')
  assert.equal(prog.reachedStop, true)
  assert.ok(prog.coverage.covered.includes('e_win'))
  assert.ok(prog.coverage.covered.includes('e_collect'))

  // the end model confirms the run finished in the won state
  const end = r.model!.models.find((m) => m.modelId === 'endwin')!
  assert.equal(end.usage, 'end')
  assert.equal(end.ok, true)

  // a well-formed FSM raises no ambiguity warnings
  assert.deepEqual(r.model!.warnings, [])
})

test('real evaluation retains failed restarted effects and bounds end transitions', async () =>
{
  const scenario: Scenario = {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 3 },
      { do: 'snapshot', label: 'final' },
    ],
  }
  const restarted = (delay: number) =>
    loadModelsFromText(
      JSON.stringify([
        {
          id: 'restarted',
          usage: 'program',
          startNodeId: 'start',
          nodes: [{ id: 'start' }],
          edges: [
            {
              id: 'restart-edge',
              from: 'start',
              to: 'start',
              effects: [
                { name: 'TimeElapsed', args: [delay] },
                { name: 'RestartModels' },
              ],
            },
          ],
        },
      ])
    )
  const failedRestart = await runTest({
    name: 'permanently false restarted effect',
    project: buildStateGame(),
    scenario,
    asserts: [],
    model: restarted(100000),
  })
  assert.equal(failedRestart.ok, false)
  assert.deepEqual(failedRestart.issues, [])
  assert.equal(failedRestart.snapshots[0]!.variables.score, '0')
  const failedEffects = failedRestart.model!.models[0]!.failures
  assert.ok(failedEffects.length > 0)
  assert.equal(failedEffects[0]!.edgeId, 'restart-edge')
  assert.equal(failedEffects[0]!.checkName, 'TimeElapsed')
  assert.equal(failedEffects[0]!.tick, 2)

  const validRestart = await runTest({
    name: 'supported restarted effect',
    project: buildStateGame(),
    scenario,
    asserts: [],
    model: restarted(0),
  })
  assert.equal(validRestart.ok, true)
  assert.deepEqual(validRestart.model!.models[0]!.failures, [])

  const chain = (transitions: number) => ({
    id: 'chain',
    usage: 'end',
    startNodeId: 'n0',
    nodes: Array.from({ length: transitions + 1 }, (_, index) => ({
      id: `n${index}`,
    })),
    edges: Array.from({ length: transitions }, (_, index) => ({
      id: `e${index}`,
      from: `n${index}`,
      to: `n${index + 1}`,
      effects:
        index === 10000
          ? [{ name: 'VarComp', args: ['Stage', 'score', '==', 999] }]
          : [],
    })),
  })
  const inactive = {
    id: 'inactive',
    usage: 'end',
    startNodeId: 'waiting',
    nodes: [{ id: 'waiting' }, { id: 'done' }],
    edges: [
      {
        id: 'conditional',
        from: 'waiting',
        to: 'done',
        conditions: [{ name: 'Key', args: ['space'] }],
      },
    ],
  }
  const bounded = await runTest({
    name: 'complete bounded end chain and inactive control',
    project: buildStateGame(),
    scenario,
    asserts: [],
    model: loadModelsFromText(JSON.stringify([chain(10000), inactive])),
  })
  assert.equal(bounded.ok, true)
  const completed = bounded.model!.models[0]!
  assert.equal(completed.finalNode, 'n10000')
  assert.equal(completed.coverage.covered.length, 10000)
  assert.equal(completed.reachedStop, true)
  assert.equal(bounded.model!.models[1]!.reachedStop, false)

  const cycle = {
    id: 'cycle',
    usage: 'end',
    startNodeId: 'loop',
    nodes: [{ id: 'loop' }],
    edges: [{ id: 'self-loop', from: 'loop', to: 'loop' }],
  }
  for (const model of [chain(10001), cycle])
  {
    const limited = await runTest({
      name: `bounded refusal ${model.id}`,
      project: buildStateGame(),
      scenario,
      asserts: [],
      model: loadModelsFromText(JSON.stringify([model])),
    })
    assert.equal(limited.ok, false)
    assert.equal(limited.model!.ok, false)
    assert.equal(limited.model!.models[0]!.ok, false)
    assert.deepEqual(
      limited.issues.map(({ issue }) => [
        issue.code,
        issue.kind,
        issue.responsibility,
      ]),
      [['model.evaluation.limit-exceeded', 'tick-budget', 'unsupported']]
    )
  }
})

test('executable admission refuses unsupported models before packing while inspection remains available', async () =>
{
  const loaded = (usage: 'program' | 'end' | 'user', delay: number | string) =>
    loadModelsFromText(
      JSON.stringify([
        {
          id: usage,
          usage,
          startNodeId: 'start',
          nodes: [{ id: 'start' }, { id: 'done' }],
          edges: [
            {
              id: 'edge',
              from: 'start',
              to: 'done',
              ...(usage === 'user'
                ? { effects: [{ name: 'InputKey', args: ['space'] }] }
                : { conditions: [{ name: 'TimeAfterEnd', args: [delay] }] }),
            },
          ],
        },
      ])
    )
  const user = loaded('user', 0)
  assert.equal(user.userModels[0]!.edges[0]!.inputs[0]!.name, 'InputKey')
  const hidden = loaded('program', 0)
  hidden.programModels[0]!.edges = []
  assert.equal(hidden.programModels[0]!.nodes.get('start')!.outgoing.length, 1)
  const project = buildStateGame()
  let packCalls = 0
  project.toSb3 = async () =>
  {
    packCalls += 1
    throw new Error('unsupported oracle reached project packing')
  }
  for (const model of [
    user,
    loaded('program', 0),
    hidden,
    loaded('end', 1),
    loaded('end', 'Infinity'),
  ])
  {
    const refused = await runTest({
      name: 'unsupported oracle',
      project,
      scenario: { steps: [{ do: 'greenFlag' }] },
      asserts: [],
      visual: [
        {
          at: 'never',
          probe: { on: 'timer' },
          match: { kind: 'equals', value: 0 },
        },
      ],
      model,
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.runtime, 'not-started')
    assert.equal(refused.model, null)
    assert.deepEqual(
      [refused.snapshots, refused.asserts, refused.visual, refused.screenshots],
      [[], [], [], []]
    )
    assert.equal(refused.video, null)
    assert.deepEqual(
      refused.issues.map(({ issue }) => [issue.code, issue.responsibility]),
      [['model.evaluation.unsupported', 'unsupported']]
    )
    assert.equal(packCalls, 0)
  }

  const immediate = loaded('end', 0)
  immediate.endModels[0]!.edges[0]!.effects = [
    { name: 'TimeAfterEnd', negated: false, args: [] },
  ]
  const supported = await runTest({
    name: 'immediate end checks',
    project: buildStateGame(),
    scenario: { steps: [{ do: 'snapshot', label: 'final' }] },
    asserts: [],
    model: immediate,
  })
  assert.equal(supported.ok, true)
  assert.equal(supported.model!.models[0]!.reachedStop, true)
})

test('VM observations do not equate whitespace with numeric zero in either oracle', async () =>
{
  const project = buildStateGame()
  const stage = project.stage!
  stage.raw.variables[stage.variableId('score')!]![1] = '   '
  const result = await runTest({
    name: 'whitespace is a distinct Scratch string',
    project,
    scenario: { steps: [{ do: 'snapshot', label: 'read' }] },
    asserts: [
      {
        at: 'read',
        probe: { on: 'var', name: 'score' },
        match: { kind: 'equals', value: 0 },
      },
      {
        at: 'read',
        probe: { on: 'var', name: 'score' },
        match: { kind: 'equals', value: '   ' },
      },
    ],
    model: loadModelsFromText(
      JSON.stringify([
        {
          id: 'whitespace',
          usage: 'end',
          startNodeId: 'start',
          nodes: [{ id: 'start' }, { id: 'done' }],
          edges: [
            {
              id: 'compare',
              from: 'start',
              to: 'done',
              effects: [{ name: 'VarComp', args: ['Stage', 'score', '==', 0] }],
            },
          ],
        },
      ])
    ),
  })
  assert.equal(result.snapshots[0]!.variables.score, '   ')
  assert.equal(result.ok, false)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.asserts.map((assertion) => assertion.ok),
    [false, true]
  )
  assert.equal(result.model!.ok, false)
  assert.equal(result.model!.models[0]!.failures[0]!.checkName, 'VarComp')
})
