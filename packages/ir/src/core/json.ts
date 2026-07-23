// packages/ir/src/core/json.ts
// minimal JSON value model + deterministic canonicalization & structural diff

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json }

export type JsonObject = { [key: string]: Json }

function isObject(value: Json): value is JsonObject
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// recursively sort object keys; arrays keep order (order is significant in sb3)
export function canonicalize(value: Json): Json
{
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isObject(value))
  {
    const out = Object.create(null) as JsonObject
    for (const key of Object.keys(value).sort())
    {
      out[key] = canonicalize(value[key]!)
    }
    return out
  }
  // normalize -0 to 0: JSON cannot represent -0 (JSON.stringify(-0) === '0') &
  // scratch-vm collapses it too, so -0 & 0 are treated as equivalent
  if (typeof value === 'number' && Object.is(value, -0)) return 0
  return value
}

export function canonicalJson(value: Json): string
{
  return JSON.stringify(canonicalize(value))
}

export interface JsonDiff
{
  path: string
  // missing: present in a (original) but absent in b (round-trip) -> data LOST
  // extra: present in b but not a -> data ADDED
  // changed: both present, values differ
  kind: 'missing' | 'extra' | 'changed'
  a?: string
  b?: string
}

// JSON-encode so string "5" & number 5 render distinctly in diff output
function preview(value: Json): string
{
  const text = JSON.stringify(value) ?? 'undefined'
  return text.length > 80 ? text.slice(0, 77) + '...' : text
}

// structural diff of original (a) vs round-tripped (b); empty result == lossless
export function diffJson(a: Json, b: Json, limit = 100): JsonDiff[]
{
  const diffs: JsonDiff[] = []

  const walk = (x: Json, y: Json, path: string): void =>
  {
    if (diffs.length >= limit) return

    if (Array.isArray(x) && Array.isArray(y))
    {
      if (x.length !== y.length)
      {
        diffs.push({
          path: `${path}.length`,
          kind: 'changed',
          a: String(x.length),
          b: String(y.length),
        })
      }
      const n = Math.min(x.length, y.length)
      for (let i = 0; i < n; i++) walk(x[i]!, y[i]!, `${path}[${i}]`)
      return
    }

    if (isObject(x) && isObject(y))
    {
      for (const key of Object.keys(x))
      {
        if (!Object.hasOwn(y, key))
        {
          diffs.push({
            path: `${path}.${key}`,
            kind: 'missing',
            a: preview(x[key]!),
          })
        }
        else
        {
          walk(x[key]!, y[key]!, `${path}.${key}`)
        }
      }
      for (const key of Object.keys(y))
      {
        if (!Object.hasOwn(x, key))
        {
          diffs.push({
            path: `${path}.${key}`,
            kind: 'extra',
            b: preview(y[key]!),
          })
        }
      }
      return
    }

    // Object.is distinguishes -0 from 0 & catches container/type mismatches
    if (!Object.is(x, y))
    {
      diffs.push({ path, kind: 'changed', a: preview(x), b: preview(y) })
    }
  }

  walk(a, b, '$')
  return diffs.slice(0, limit)
}
