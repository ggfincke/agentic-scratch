// tests/edit/session/retained-session-inventory.test.ts
// retained session JSON bounds shared w/ admission authority

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  scanStrictJson,
} from '@scratch-agent/sb3'

import { parseRetainedSessionJsonV1 } from '../../../packages/edit/src/session/retained-session-inventory.js'

const RETIRED_RETAINED_JSON_NODE_LIMIT = 262_144

function groupedScalarArrayBytes(
  groupCount: number,
  membersPerGroup: number
): Uint8Array
{
  const group = `[${new Array<string>(membersPerGroup).fill('0').join(',')}]`
  return new TextEncoder().encode(
    `[${new Array<string>(groupCount).fill(group).join(',')}]`
  )
}

test('retained session JSON accepts the aggregate admission ceiling while remaining strictly bounded', () =>
{
  const acceptedBytes = groupedScalarArrayBytes(3, 90_000)
  const acceptedScan = scanStrictJson(acceptedBytes, {
    maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
    maxMembersPerContainer:
      DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
    maxNodes: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes,
  })
  assert.ok(acceptedScan.metrics.nodes > RETIRED_RETAINED_JSON_NODE_LIMIT)

  const accepted = parseRetainedSessionJsonV1<readonly (readonly number[])[]>(
    acceptedBytes,
    'large retained aggregate'
  )
  assert.equal(accepted.length, 3)
  assert.equal(accepted[2]?.length, 90_000)

  assert.throws(
    () =>
      parseRetainedSessionJsonV1(
        new TextEncoder().encode('{"duplicate":0,"duplicate":1}'),
        'malformed retained evidence'
      ),
    /not strict bounded JSON: duplicate decoded object key/u
  )

  const oversizedBytes = groupedScalarArrayBytes(20, 100_000)
  assert.throws(
    () =>
      parseRetainedSessionJsonV1(oversizedBytes, 'oversized retained evidence'),
    /not strict bounded JSON: JSON node limit exceeded/u
  )
})
