// tests/ir/repair/ops.test.ts
// projects built entirely through IR ops are schema-valid & round-trip losslessly

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateSb3 } from '@scratch-agent/sb3'
import {
  blankProject,
  buildCat,
  buildClicker,
  roundTripSb3,
} from '@scratch-agent/ir'

test('clicker built from IR validates & round-trips losslessly', async () =>
{
  const ir = buildClicker()
  const bytes = await ir.toSb3()

  const valid = await validateSb3(bytes)
  assert.equal(valid.ok, true, valid.errors.join('; '))

  const rt = await roundTripSb3(bytes)
  assert.equal(
    rt.lossless,
    true,
    JSON.stringify([...rt.jsonDiffs, ...rt.assetDiffs])
  )

  const sprite = ir.target('Sprite1')
  assert.ok(sprite)
  assert.ok(sprite.variableNames().includes('score'))
  assert.equal(sprite.scripts().length, 2)
})

test('cat built from IR validates & round-trips losslessly', async () =>
{
  const ir = buildCat()
  const bytes = await ir.toSb3()
  assert.equal((await validateSb3(bytes)).ok, true)

  const rt = await roundTripSb3(bytes)
  assert.equal(rt.lossless, true, JSON.stringify(rt.jsonDiffs))

  const cat = ir.target('Cat')
  assert.ok(cat)
  assert.equal(cat.scripts().length, 1)
})

test('event_broadcast w/ a broadcast input builds, validates & round-trips', async () =>
{
  const ir = buildClicker()
  const sprite = ir.target('Sprite1')
  assert.ok(sprite)
  const bcId = sprite.addBroadcast('go')
  sprite.addScript(
    [
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'event_broadcast',
        inputs: { BROADCAST_INPUT: { broadcast: 'go', id: bcId } },
      },
    ],
    { x: 200, y: 0 }
  )
  const bytes = await ir.toSb3()
  assert.equal((await validateSb3(bytes)).ok, true)
  assert.equal((await roundTripSb3(bytes)).lossless, true)
})

test('addSprite cannot be coerced into a second Stage', () =>
{
  const ir = blankProject()
  // @ts-expect-error isStage:true is intentionally rejected by the sprite invariant
  const sprite = ir.addSprite('X', { isStage: true })
  assert.equal(sprite.isStage, false)
  assert.equal(ir.sprites().length, 1)
})
