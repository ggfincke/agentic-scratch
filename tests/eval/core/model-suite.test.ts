// tests/eval/core/model-suite.test.ts
// the model suite runs a game state machine in lockstep on the vm lane (exit criterion #2)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stateGameCase } from '@scratch-agent/eval'
import { runTest } from '@scratch-agent/eval'

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
