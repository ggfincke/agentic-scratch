// tests/eval/authoring/bounded-evidence.test.ts
// evaluation trace JSON limits resolve from the build up to the hard admission ceilings

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authoringTraceBytesV1,
  authoringTraceLimitsV1,
} from '@scratch-agent/eval'
import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  HARD_EDIT_ADMISSION_LIMITS,
} from '@scratch-agent/sb3'
import { CanonicalJsonError } from '@scratch-agent/sb3/canonical-json'

test('trace limits keep the default JSON caps & raise them only up to the hard ceilings', () =>
{
  assert.equal(DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes, 2_000_000)
  assert.equal(DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer, 100_000)
  assert.equal(HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes, 8_000_000)
  assert.equal(HARD_EDIT_ADMISSION_LIMITS.maxMembersPerContainer, 400_000)
  assert.deepEqual(authoringTraceLimitsV1(), {
    maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
    maxNodes: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes,
    maxMembers: DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
    maxStringCodeUnits: 1_000_000,
  })
  assert.deepEqual(
    authoringTraceLimitsV1({
      maxJsonNodes: HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes,
      maxMembersPerContainer: HARD_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
    }),
    {
      maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
      maxNodes: HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes,
      maxMembers: HARD_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
      maxStringCodeUnits: 1_000_000,
    }
  )
  assert.throws(
    () =>
      authoringTraceLimitsV1({
        maxJsonNodes: HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes + 1,
      }),
    new RegExp(
      `maxJsonNodes must be a nonnegative safe integer at most ${HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes}`,
      'u'
    )
  )
})

test('a trace past the default node cap encodes under raised limits w/ the same bytes', () =>
{
  // 30 lists of 70,000 items stay under the member cap & pass the node cap
  const trace = {
    snapshots: Array.from({ length: 30 }, () =>
      new Array<number>(70_000).fill(0)
    ),
  }
  assert.throws(
    () => authoringTraceBytesV1(trace),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === 'nodes'
  )
  const raised = authoringTraceBytesV1(trace, {
    maxJsonNodes: HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes,
  })
  const hard = authoringTraceBytesV1(trace, {
    maxJsonNodes: HARD_EDIT_ADMISSION_LIMITS.maxJsonNodes,
    maxMembersPerContainer: HARD_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
  })
  assert.deepEqual(raised, hard)
  assert.equal(
    new TextDecoder().decode(raised.subarray(0, 16)),
    '{"snapshots":[[0'
  )
})
