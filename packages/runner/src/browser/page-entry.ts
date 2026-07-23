// packages/runner/src/browser/page-entry.ts
// initialize the pinned TurboWarp scaffolding page on the shared runtime API

import * as ScaffoldingNS from '@turbowarp/scaffolding'

import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'
import type { ScratchRuntime, ScratchVm } from '../vm/vm-api.js'
import { TURBOWARP_LINEAGE_IDENTITY } from './browser-config.js'
import { installRuntimePage } from './runtime-page.js'
import type { PageRenderer } from './visual.js'

interface FrameLoop
{
  stop(): void
}

interface PageRuntime extends ScratchRuntime
{
  compilerOptions: { enabled: boolean }
  renderer?: PageRenderer
  frameLoop?: FrameLoop
  stop?(): void
}

interface TurboWarpVm extends ScratchVm
{
  runtime: PageRuntime
  setCompatibilityMode(enabled: boolean): void
  setTurboMode(enabled: boolean): void
}

interface ScaffoldingInstance
{
  width: number
  height: number
  shouldConnectPeripherals: boolean
  setup(): void
  appendTo(element: HTMLElement): void
  loadProject(data: ArrayBuffer | Uint8Array): Promise<void>
  vm: TurboWarpVm
  renderer?: PageRenderer
}

type ScaffoldingCtor = new () => ScaffoldingInstance

const namespace = ScaffoldingNS as unknown as {
  Scaffolding?: ScaffoldingCtor
  default?: ScaffoldingCtor
}
const Scaffolding = namespace.Scaffolding ?? namespace.default!
const scaffolding = new Scaffolding()
scaffolding.width = STAGE_WIDTH
scaffolding.height = STAGE_HEIGHT
scaffolding.shouldConnectPeripherals = false
scaffolding.setup()
const element = document.getElementById('app')
if (!element) throw new Error('missing #app host')
scaffolding.appendTo(element)
const runtime = scaffolding.vm.runtime
scaffolding.vm.setCompatibilityMode(true)
scaffolding.vm.setTurboMode(false)
runtime.compilerOptions.enabled = true
const renderer = scaffolding.renderer ?? runtime.renderer
if (!renderer) throw new Error('TurboWarp renderer is unavailable')

installRuntimePage({
  vm: scaffolding.vm,
  renderer,
  async loadProject(data: ArrayBuffer): Promise<void>
  {
    await scaffolding.loadProject(data)
  },
  stopFreeRunning(): void
  {
    if (runtime.frameLoop) runtime.frameLoop.stop()
    if (typeof runtime.stop === 'function') runtime.stop()
  },
  lineageIdentity: TURBOWARP_LINEAGE_IDENTITY,
})
