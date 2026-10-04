// packages/runner/src/browser/official-debug-page-entry.ts
// host explicit official Scratch clocks & physical input on a separate debug page

import * as AudioEngineNS from 'scratch-audio/dist.js'

import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'
import type { ScratchVm } from '../vm/vm-api.js'
import { installProjectDebugPageV1 } from './debug-runtime-page.js'
import { installDebugDevicePolicyV1 } from './debug-devices.js'
import { installDebugPhysicalInputV1 } from './debug-physical-input.js'
import type { PageRenderer } from './visual.js'

interface OfficialRenderer extends PageRenderer
{
  resize(width: number, height: number): void
}

interface OfficialVm extends ScratchVm
{
  start(): void
  runtime: ScratchVm['runtime'] & {
    _steppingInterval: ReturnType<typeof setInterval> | null
  }
  attachAudioEngine(engine: unknown): void
  attachRenderer(renderer: OfficialRenderer): void
  attachStorage(storage: unknown): void
  attachV2BitmapAdapter(adapter: unknown): void
  setCompatibilityMode(enabled: boolean): void
  setTurboMode(enabled: boolean): void
}

type OfficialVmCtor = new () => OfficialVm
type OfficialRendererCtor = new (canvas: HTMLCanvasElement) => OfficialRenderer
type OfficialStorageCtor = new () => unknown
type OfficialBitmapAdapterCtor = new () => unknown
type AudioEngineCtor = new () => unknown

interface OfficialGlobals
{
  VirtualMachine: OfficialVmCtor
  ScratchRender: OfficialRendererCtor
  ScratchStorage: { ScratchStorage: OfficialStorageCtor }
  ScratchSVGRenderer: { BitmapAdapter: OfficialBitmapAdapterCtor }
}

const devices = installDebugDevicePolicyV1()
const globals = window as unknown as OfficialGlobals
for (const name of [
  'VirtualMachine',
  'ScratchRender',
  'ScratchStorage',
  'ScratchSVGRenderer',
] as const)
{
  if (!globals[name])
    throw new Error(`official Scratch global ${name} is missing`)
}

const audioNamespace = AudioEngineNS as unknown as {
  default?: AudioEngineCtor
}
const AudioEngine =
  audioNamespace.default ?? (AudioEngineNS as unknown as AudioEngineCtor)
const element = document.getElementById('app')
if (!element) throw new Error('missing #app host')
const canvas = document.createElement('canvas')
canvas.width = STAGE_WIDTH
canvas.height = STAGE_HEIGHT
canvas.style.width = `${STAGE_WIDTH}px`
canvas.style.height = `${STAGE_HEIGHT}px`
element.appendChild(canvas)

const vm = new globals.VirtualMachine()
const storage = new globals.ScratchStorage.ScratchStorage()
const renderer = new globals.ScratchRender(canvas)
renderer.resize(STAGE_WIDTH, STAGE_HEIGHT)
vm.attachStorage(storage)
vm.attachRenderer(renderer)
const audio = new AudioEngine() as {
  audioContext: AudioContext
  inputNode: AudioNode
}
vm.attachAudioEngine(audio)
vm.attachV2BitmapAdapter(new globals.ScratchSVGRenderer.BitmapAdapter())
vm.setTurboMode(false)
vm.setCompatibilityMode(false)

installDebugPhysicalInputV1(vm, canvas)
installProjectDebugPageV1({
  vm,
  renderer,
  canvas,
  audioEngine: audio,
  async loadProject(data: ArrayBuffer): Promise<void>
  {
    await vm.setLocale('en-US')
    await vm.loadProject(data)
  },
  configureClock: (rate) => vm.setCompatibilityMode(rate === 30),
  startNative: () => vm.start(),
  stopNative: () =>
  {
    if (vm.runtime._steppingInterval !== null)
      clearInterval(vm.runtime._steppingInterval)
    vm.runtime._steppingInterval = null
  },
  resumeAudioFromHuman: async () =>
  {
    await audio.audioContext?.resume()
  },
  enableDevicesFromHuman: () => devices.enableFromHuman(),
})
