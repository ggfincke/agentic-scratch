// tests/repair/benchmark.test.ts
// exact canonical repair corpus validation

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertRepairBenchmarkCorpus,
  REPAIR_BENCHMARK_IDS,
} from '@scratch-agent/repair'

test('canonical repair corpus requires exact ordered unique R1-R5 IDs', () =>
{
  const invalid = [
    [],
    ['R1', 'R2', 'R3', 'R4'],
    ['R1', 'R2', 'R3', 'R4', 'R4'],
    ['R1', 'R2', 'R3', 'R4', 'R6'],
    ['R2', 'R1', 'R3', 'R4', 'R5'],
  ]
  for (const ids of invalid)
  {
    assert.throws(
      () => assertRepairBenchmarkCorpus(ids, REPAIR_BENCHMARK_IDS),
      /canonical repair corpus mismatch/
    )
  }
})
