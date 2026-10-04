// packages/runner/src/browser/debug-page-entry.ts
// host explicit TurboWarp execution clocks without changing the legacy runtime page

import * as ScaffoldingNS from '@turbowarp/scaffolding'
import { installProjectDebugPageV1 } from './debug-runtime-page.js'
import { installDebugDevicePolicyV1 } from './debug-devices.js'
import type { ScratchVm, ScratchRuntime } from '../vm/vm-api.js'
import type { PageRenderer } from './visual.js'

interface DebugRuntime extends ScratchRuntime
{
  compilerOptions: { enabled: boolean }
  frameLoop: { stop(): void }
  renderer?: PageRenderer
}
interface DebugVm extends ScratchVm
{
  runtime: DebugRuntime
  start(): void
  setCompatibilityMode(enabled: boolean): void
  setTurboMode(enabled: boolean): void
}
interface DebugScaffolding
{
  width: number
  height: number
  shouldConnectPeripherals: boolean
  editableLists: boolean
  setup(): void
  appendTo(element: HTMLElement): void
  loadProject(data: ArrayBuffer): Promise<void>
  vm: DebugVm
  renderer?: PageRenderer
  audioEngine?: { audioContext: AudioContext; inputNode: AudioNode }
  _startDragging: () => void
}
const devices = installDebugDevicePolicyV1()
const namespace = ScaffoldingNS as unknown as {
  Scaffolding?: new () => DebugScaffolding
  default?: new () => DebugScaffolding
}
const Scaffolding = namespace.Scaffolding ?? namespace.default!
const scaffolding = new Scaffolding()
scaffolding.width = 480
scaffolding.height = 360
scaffolding.shouldConnectPeripherals = false
scaffolding.editableLists = false
scaffolding.setup()
// editor dragging is outside the captured keyboard/mouse application boundary
scaffolding._startDragging = () =>
{}
const app = document.getElementById('app')
if (!app) throw new Error('missing #app host')
scaffolding.appendTo(app)
const vm = scaffolding.vm
vm.setTurboMode(false)
vm.runtime.compilerOptions.enabled = true
const renderer = scaffolding.renderer ?? vm.runtime.renderer
const canvas = app.querySelector('canvas')
if (!renderer || !canvas) throw new Error('TurboWarp renderer is unavailable')
installProjectDebugPageV1({
  vm,
  renderer,
  canvas,
  audioEngine: scaffolding.audioEngine,
  loadProject: async (data) => await scaffolding.loadProject(data),
  configureClock: (rate) => vm.setCompatibilityMode(rate === 30),
  startNative: () => vm.start(),
  stopNative: () => vm.runtime.frameLoop.stop(),
  resumeAudioFromHuman: async () =>
  {
    await scaffolding.audioEngine?.audioContext?.resume()
  },
  enableDevicesFromHuman: () => devices.enableFromHuman(),
})
