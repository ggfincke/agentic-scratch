// tests/eval/core/mutation.test.ts
// mutation testing kills a deliberately-injected bug -> the suite's oracles have real power (exit #3)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stateGameCase } from '@scratch-agent/eval'
import { runMutationForCase } from '@scratch-agent/eval'
import { runTest } from '@scratch-agent/eval'

test('mutation reveals the deliberate score-increment bug', async () =>
{
  const base = await runTest(stateGameCase)
  assert.ok(base.ok, 'base case must pass on the un-mutated project')

  const { report, invalid } = await runMutationForCase(stateGameCase)
  assert.equal(invalid.length, 0, 'the operators produce loadable mutants')
  assert.ok(report.total >= 10, `expected many mutants, got ${report.total}`)

  // zeroing the score increment must be caught (the headline deliberate bug)
  const scoreBug = report.outcomes.find(
    (o) =>
      o.record.sprite === 'Hero' &&
      /data_changevariableby\.VALUE: 1 -> 0/.test(o.record.description)
  )
  assert.ok(scoreBug, 'the score-increment mutation exists')
  assert.equal(scoreBug!.killed, true, 'the score bug is killed by the oracles')

  // deleting the increment entirely is also caught
  const deleteBug = report.outcomes.find(
    (o) => o.record.sprite === 'Hero' && o.record.operator === 'delete'
  )
  assert.equal(deleteBug!.killed, true, 'deleting the increment is caught')

  // survivors exist -> the report surfaces oracle gaps rather than a hollow 100%
  assert.ok(report.killed > 0 && report.survived > 0)
})
