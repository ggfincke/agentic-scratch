// packages/eval/src/core/matchers.ts
// tiny assertion matchers w/ Scratch-faithful value coercion

import type { ScalarValue } from '@scratch-agent/runner'
import { compareScratchValuesV1 } from '@scratch-agent/runner'

export type Matcher =
  | { kind: 'equals'; value: ScalarValue }
  | { kind: 'closeTo'; value: number; eps?: number }
  | { kind: 'gt'; value: number }
  | { kind: 'lt'; value: number }
  | { kind: 'contains'; value: ScalarValue }

const DEFAULT_EPS = 1e-6

// numeric-only matchers keep their finite-number admission policy
function asNumber(v: unknown): number | null
{
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// equality uses the same pinned cast policy as the model oracle
export function scratchEquals(a: unknown, b: unknown): boolean
{
  return compareScratchValuesV1(a, b) === 0
}

export function matches(matcher: Matcher, observed: unknown): boolean
{
  switch (matcher.kind)
  {
    case 'equals':
      return scratchEquals(observed, matcher.value)
    case 'closeTo':
    {
      const n = asNumber(observed)
      return (
        n !== null &&
        Math.abs(n - matcher.value) <= (matcher.eps ?? DEFAULT_EPS)
      )
    }
    case 'gt':
    {
      const n = asNumber(observed)
      return n !== null && n > matcher.value
    }
    case 'lt':
    {
      const n = asNumber(observed)
      return n !== null && n < matcher.value
    }
    case 'contains':
      return containsValue(observed, matcher.value)
  }
}

function containsValue(observed: unknown, value: ScalarValue): boolean
{
  if (Array.isArray(observed))
    return observed.some((item) => scratchEquals(item, value))
  return String(observed).includes(String(value))
}

export function describeMatcher(matcher: Matcher): string
{
  switch (matcher.kind)
  {
    case 'equals':
      return `== ${String(matcher.value)}`
    case 'closeTo':
      return `~= ${matcher.value} (+/- ${matcher.eps ?? DEFAULT_EPS})`
    case 'gt':
      return `> ${matcher.value}`
    case 'lt':
      return `< ${matcher.value}`
    case 'contains':
      return `contains ${String(matcher.value)}`
  }
}
