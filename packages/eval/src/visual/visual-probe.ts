// packages/eval/src/visual/visual-probe.ts
// pure grid/rect math for visual probes: region ink, frame-to-frame change, rect fields

import type { ScreenRect, VisualObservation } from '@scratch-agent/runner'

import type { RectField, Region } from '../core/assert.js'

// sum-of-abs RGB deviation from the backdrop that counts a cell as drawn content
const INK_TOL = 60
// sum-of-abs RGB change between two frames that counts a cell as changed
const CHANGE_TOL = 45

export function rectField(rect: ScreenRect, field: RectField): number
{
  switch (field)
  {
    case 'x':
      return rect.x
    case 'y':
      return rect.y
    case 'width':
      return rect.width
    case 'height':
      return rect.height
    case 'cx':
      return rect.x + rect.width / 2
    case 'cy':
      return rect.y + rect.height / 2
  }
}

export function centerInRegion(rect: ScreenRect, region: Region): boolean
{
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return (
    cx >= region.x &&
    cx <= region.x + region.width &&
    cy >= region.y &&
    cy <= region.y + region.height
  )
}

type RGB = [number, number, number]

function cellRGB(v: VisualObservation, ci: number): RGB
{
  return [v.grid[ci * 3] ?? 0, v.grid[ci * 3 + 1] ?? 0, v.grid[ci * 3 + 2] ?? 0]
}

function cellCenter(
  v: VisualObservation,
  gx: number,
  gy: number
): [number, number]
{
  return [
    ((gx + 0.5) * v.canvas.width) / v.gridCols,
    ((gy + 0.5) * v.canvas.height) / v.gridRows,
  ]
}

function inRegion(px: number, py: number, region?: Region): boolean
{
  if (!region) return true
  return (
    px >= region.x &&
    px <= region.x + region.width &&
    py >= region.y &&
    py <= region.y + region.height
  )
}

// the corners are almost always backdrop; average them as the background reference
function backdropRGB(v: VisualObservation): RGB
{
  const corners = [
    0,
    v.gridCols - 1,
    (v.gridRows - 1) * v.gridCols,
    v.gridRows * v.gridCols - 1,
  ]
  let r = 0
  let g = 0
  let b = 0
  for (const c of corners)
  {
    const [cr, cg, cb] = cellRGB(v, c)
    r += cr
    g += cg
    b += cb
  }
  return [r / corners.length, g / corners.length, b / corners.length]
}

function deviation(a: RGB, b: RGB): number
{
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
}

// count grid cells inside the region whose color departs from the backdrop
export function regionInkCount(
  v: VisualObservation,
  region?: Region,
  tol = INK_TOL
): number
{
  const bg = backdropRGB(v)
  let n = 0
  for (let gy = 0; gy < v.gridRows; gy++)
  {
    for (let gx = 0; gx < v.gridCols; gx++)
    {
      const [px, py] = cellCenter(v, gx, gy)
      if (!inRegion(px, py, region)) continue
      if (deviation(cellRGB(v, gy * v.gridCols + gx), bg) > tol) n++
    }
  }
  return n
}

// count grid cells inside the region that changed between two frames; -1 if grids mismatch
export function regionChangedCount(
  now: VisualObservation,
  ref: VisualObservation,
  region?: Region,
  tol = CHANGE_TOL
): number
{
  if (now.gridCols !== ref.gridCols || now.gridRows !== ref.gridRows) return -1
  let n = 0
  for (let gy = 0; gy < now.gridRows; gy++)
  {
    for (let gx = 0; gx < now.gridCols; gx++)
    {
      const [px, py] = cellCenter(now, gx, gy)
      if (!inRegion(px, py, region)) continue
      const ci = gy * now.gridCols + gx
      if (deviation(cellRGB(now, ci), cellRGB(ref, ci)) > tol) n++
    }
  }
  return n
}
