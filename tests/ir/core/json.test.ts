// tests/ir/core/json.test.ts
// canonicalization & structural diff behave correctly (incl. -0 & type fidelity)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canonicalJson, diffJson } from '@scratch-agent/ir'

test('canonicalize sorts object keys & preserves array order', () =>
{
  const value = { b: 1, a: [3, 2, 1], c: { z: 1, y: 2 } }
  assert.equal(canonicalJson(value), '{"a":[3,2,1],"b":1,"c":{"y":2,"z":1}}')
})

test('diffJson reports missing, extra & changed paths', () =>
{
  assert.equal(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }).length, 0)
  const diffs = diffJson(
    { a: 1, b: 2, n: { x: 1 } },
    { a: 1, b: 3, n: {}, e: 9 }
  )
  const seen = diffs.map((d) => `${d.kind} ${d.path}`)
  assert.ok(seen.includes('changed $.b'))
  assert.ok(seen.includes('missing $.n.x'))
  assert.ok(seen.includes('extra $.e'))
})

test('canonicalize normalizes -0 to 0 & diffJson flags -0 vs 0', () =>
{
  assert.equal(canonicalJson({ x: -0 }), '{"x":0}')
  const diffs = diffJson({ x: -0 }, { x: 0 })
  assert.equal(diffs.length, 1)
  assert.equal(diffs[0]!.kind, 'changed')
})

test('diffJson previews distinguish string "5" from number 5', () =>
{
  const diffs = diffJson({ v: '5' }, { v: 5 })
  assert.equal(diffs.length, 1)
  assert.equal(diffs[0]!.a, '"5"')
  assert.equal(diffs[0]!.b, '5')
})
