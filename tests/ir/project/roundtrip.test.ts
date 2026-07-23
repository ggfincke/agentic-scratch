// tests/ir/project/roundtrip.test.ts
// committed fixtures round-trip through the IR without losing any field or asset byte

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { roundTripSb3 } from '@scratch-agent/ir'

import { fixturePath } from '../../helpers/repo-paths.js'

for (const name of ['fixture.sb3', 'comments.sb3', 'sprite-named-stage.sb3'])
{
  test(`round-trip ${name} is lossless`, async () =>
  {
    const result = await roundTripSb3(readFileSync(fixturePath(name)))
    assert.equal(
      result.lossless,
      true,
      JSON.stringify([...result.jsonDiffs, ...result.assetDiffs].slice(0, 10))
    )
  })
}
