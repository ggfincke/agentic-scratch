// packages/runner/src/browser/visual.ts
// in-page renderer observation: per-sprite screen rects (frame grid filled host-side from the
// screenshot -- raw gl.readPixels races the compositor & blanks under load). esbuild-bundled.

import type { ScreenRect, VisualObservation } from '../policy/types.js'
import { resolveRuntimeTargetIdentities } from '../observation/snapshot.js'
import type { RuntimeTargetIdentityResult } from '../observation/snapshot.js'
import type { ScratchRuntime, ScratchTarget } from '../vm/vm-api.js'

// coarse enough to smooth swiftshader AA noise, fine enough for region-level checks
const GRID_COLS = 32
const GRID_ROWS = 24

interface Bounds
{
  left: number
  right: number
  top: number
  bottom: number
}

// the renderer surface we read; getBounds returns Scratch stage units, getNativeSize the stage size
export interface PageRenderer
{
  draw(): void
  getNativeSize(): [number, number]
  getBounds(drawableID: number): Bounds
}

// map a sprite's stage-unit bounds to a stage-native-pixel rect (top-left origin, 0..nativeW x
// 0..nativeH) -- the SAME space regions & the frame grid use, independent of the gl backing store
function screenRect(
  renderer: PageRenderer,
  target: ScratchTarget,
  nativeW: number,
  nativeH: number
): ScreenRect | null
{
  if (!target.visible) return null
  if (target.isStage) return { x: 0, y: 0, width: nativeW, height: nativeH }
  if (!Number.isSafeInteger(target.drawableID)) return null
  try
  {
    const b = renderer.getBounds(target.drawableID!)
    return {
      x: b.left + nativeW / 2,
      y: nativeH / 2 - b.top,
      width: b.right - b.left,
      height: b.top - b.bottom,
    }
  }
  catch
  {
    return null
  }
}

// capture renderer observation at the current frame; the grid is left empty for the host to fill
export function readVisual(
  renderer: PageRenderer,
  runtime: ScratchRuntime
): VisualObservation
{
  return readResolvedVisual(
    renderer,
    resolveRuntimeTargetIdentities(runtime)
  )
}

export function readResolvedVisual(
  renderer: PageRenderer,
  resolved: RuntimeTargetIdentityResult
): VisualObservation
{
  renderer.draw()
  const [nativeW, nativeH] = renderer.getNativeSize()

  const spriteRects: Record<string, ScreenRect | null> = {}
  for (const entry of resolved.targets)
  {
    const target = entry.target
    if (entry.instance !== 'original' || target.isStage) continue
    // first sprite wins on a name collision; visual probes address sprites by name
    if (!(target.getName() in spriteRects))
    {
      spriteRects[target.getName()] = screenRect(
        renderer,
        target,
        nativeW,
        nativeH
      )
    }
  }

  // report the stage-native size (NOT the gl backing store): rects, regions & the host-filled
  // grid all live in this one 0..nativeW x 0..nativeH space regardless of canvas resolution
  return {
    canvas: { width: nativeW, height: nativeH },
    spriteRects,
    gridCols: GRID_COLS,
    gridRows: GRID_ROWS,
    grid: [],
    identityIssues: resolved.issues,
    geometry: {
      canvas: { width: nativeW, height: nativeH },
      targets: resolved.targets.map((entry) =>
      {
        const target = entry.target
        const costume = target.getCostumes()[target.currentCostume]
        return {
          originalTargetId: entry.originalTargetId,
          name: target.getName(),
          isStage: target.isStage,
          instance: entry.instance,
          instanceIndex: entry.instanceIndex,
          visible: target.visible,
          costumeIndex: target.currentCostume,
          costumeName: costume?.name ?? '',
          rect: screenRect(renderer, target, nativeW, nativeH),
        }
      }),
    },
  }
}
