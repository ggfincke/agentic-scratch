// packages/eval/src/core/assert.ts
// assertion + probe types: what to read from a snapshot & how to judge it

import type { Matcher } from './matchers.js'

type SpriteProp =
  | 'x'
  | 'y'
  | 'direction'
  | 'costume'
  | 'visible'
  | 'size'
  | 'rotationStyle'
  | 'volume'
  | 'draggable'

// a screen region in canvas pixels (top-left origin, 0..480 x, 0..360 y)
export interface Region
{
  x: number
  y: number
  width: number
  height: number
}

// a field of a sprite's screen rect; cx/cy are the rect center
export type RectField = 'x' | 'y' | 'width' | 'height' | 'cx' | 'cy'

export type Probe =
  | { on: 'prop'; sprite: string; prop: SpriteProp }
  | { on: 'var'; name: string; sprite?: string }
  | { on: 'list'; name: string; sprite?: string }
  | { on: 'timer' }
  | { on: 'answer' }
  | { on: 'said'; sprite: string }
  // visual probes (browser lane only): read the renderer-derived observation
  | { on: 'spriteRect'; sprite: string; field: RectField }
  | { on: 'spriteInRegion'; sprite: string; region: Region }
  | { on: 'notBlank'; region?: Region }
  | { on: 'regionInk'; region?: Region }
  | { on: 'regionChanged'; region?: Region; from: string }

// an expectation checked against the snapshot captured at `at`
export interface Assertion
{
  at: string
  probe: Probe
  match: Matcher
  note?: string
}

export interface AssertLocation
{
  target: string
  hint: string
}

export interface AssertResult
{
  ok: boolean
  at: string
  probe: Probe
  matcher: Matcher
  expected: string
  observed: string
  location: AssertLocation
  note?: string
}
