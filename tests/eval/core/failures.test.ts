// tests/eval/core/failures.test.ts
// protect non-greedy failure matching & exact duplicate cardinality

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  matchFailureMultiset,
  type FailureExpectation,
  type NormalizedFailure,
} from '@scratch-agent/eval'

function graphFailure(path: string): NormalizedFailure
{
  return {
    kind: 'diagnostic',
    fingerprint: path,
    source: 'graph',
    code: 'graph.issue',
    severity: 'error',
    locations: [{ kind: 'asset', path }],
    message: path,
  }
}

test('failure multiset reassigns overlap & preserves duplicate cardinality', () =>
{
  const narrow: FailureExpectation = {
    kind: 'diagnostic',
    source: 'graph',
    code: 'graph.issue',
    locations: [{ kind: 'asset', path: 'specific.svg' }],
  }
  const broad: FailureExpectation = {
    kind: 'diagnostic',
    source: 'graph',
    code: 'graph.issue',
  }
  const specific = graphFailure('specific.svg')
  const other = graphFailure('other.svg')

  const broadFirst = matchFailureMultiset([broad, narrow], [specific, other])
  assert.deepEqual(broadFirst, { missing: [], unexpected: [] })

  const reversed = matchFailureMultiset([narrow, broad], [other, specific])
  assert.deepEqual(reversed, { missing: [], unexpected: [] })

  const duplicateShortage = matchFailureMultiset([broad, broad], [specific])
  assert.equal(duplicateShortage.missing.length, 1)
  assert.deepEqual(duplicateShortage.unexpected, [])
})
