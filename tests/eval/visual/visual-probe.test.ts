// tests/eval/visual/visual-probe.test.ts
// pure grid/rect probe math: browser-free unit tests over hand-built observations

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ScreenRect, VisualObservation } from '../../../packages/runner/src/policy/types.js'

import type { Region } from '../../../packages/eval/src/core/assert.js'
import { centerInRegion, rectField, regionChangedCount, regionInkCount } from '../../../packages/eval/src/visual/visual-probe.js'

// a 480x360 observation whose grid is filled from a rows x cols array of [r,g,b] cells
function obs(cells: [number, number, number][][]): VisualObservation
{
  const gridRows = cells.length
  const gridCols = cells[0]!.length
  const grid: number[] = []
  for (let gy = 0; gy < gridRows; gy++)
  {
    for (let gx = 0; gx < gridCols; gx++)
    {
      const [r, g, b] = cells[gy]![gx]!
      grid.push(r, g, b)
    }
  }
  return {
    canvas: { width: 480, height: 360 },
    spriteRects: {},
    gridCols,
    gridRows,
    grid,
    geometry: { canvas: { width: 480, height: 360 }, targets: [] },
    identityIssues: [],
  }
}

// a uniform rows x cols field of one color, mutated cell-by-cell in the tests
function fill(
  rows: number,
  cols: number,
  color: [number, number, number]
): [number, number, number][][]
{
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => [...color] as [number, number, number])
  )
}

test('rectField derives the center', () =>
{
  const rect: ScreenRect = { x: 10, y: 20, width: 40, height: 60 }
  assert.equal(rectField(rect, 'cx'), 30)
  assert.equal(rectField(rect, 'cy'), 50)
})

test('centerInRegion is true inside & false just past each edge (boundary inclusive)', () =>
{
  const rect: ScreenRect = { x: 100, y: 100, width: 20, height: 20 }
  // center is (110, 110)
  assert.equal(
    centerInRegion(rect, { x: 100, y: 100, width: 20, height: 20 }),
    true
  )
  // exactly on the far edge counts as inside
  assert.equal(
    centerInRegion(rect, { x: 0, y: 0, width: 110, height: 110 }),
    true
  )
  // one unit short on x excludes it
  assert.equal(
    centerInRegion(rect, { x: 0, y: 0, width: 109, height: 110 }),
    false
  )
  // one unit short on y excludes it
  assert.equal(
    centerInRegion(rect, { x: 0, y: 0, width: 110, height: 109 }),
    false
  )
})

test('regionInkCount counts only cells past INK_TOL from the corner backdrop', () =>
{
  // 4x4 backdrop grey; corners set the backdrop reference to [200,200,200]
  const cells = fill(4, 4, [200, 200, 200])
  // deviation 600 from backdrop -> counts as ink
  cells[1]![1] = [0, 0, 0]
  cells[2]![2] = [0, 0, 0]
  // deviation 30 (< INK_TOL 60) -> not ink
  cells[1]![2] = [210, 210, 210]
  const v = obs(cells)
  assert.equal(regionInkCount(v), 2)
})

test('regionInkCount respects the region filter (cells outside excluded)', () =>
{
  const cells = fill(4, 4, [200, 200, 200])
  // ink at col 1 (cell center x = 180) & col 2 (cell center x = 300)
  cells[1]![1] = [0, 0, 0]
  cells[2]![2] = [0, 0, 0]
  const v = obs(cells)
  // left half only (x < 240) -> col 0,1 in; the col-2 ink cell is excluded
  const leftHalf: Region = { x: 0, y: 0, width: 240, height: 360 }
  assert.equal(regionInkCount(v, leftHalf), 1)
})

test('regionChangedCount counts cells past CHANGE_TOL & returns -1 on a grid mismatch', () =>
{
  const ref = obs(fill(4, 4, [200, 200, 200]))
  const nowCells = fill(4, 4, [200, 200, 200])
  // deviation 600 (> CHANGE_TOL 45) -> changed
  nowCells[1]![1] = [0, 0, 0]
  // deviation 30 (< CHANGE_TOL) -> unchanged
  nowCells[2]![2] = [210, 210, 210]
  const now = obs(nowCells)
  assert.equal(regionChangedCount(now, ref), 1)

  // dimension mismatch is a hard sentinel, not a spurious "no change"
  const bigger = obs(fill(4, 8, [200, 200, 200]))
  assert.equal(regionChangedCount(bigger, ref), -1)
})
