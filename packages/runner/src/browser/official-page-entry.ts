// packages/runner/src/browser/official-page-entry.ts
// initialize official Scratch VM/render/storage/SVG/audio on the shared runtime API

import * as AudioEngineNS from 'scratch-audio/dist.js'

import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'
import type { ScratchVm } from '../vm/vm-api.js'
import { OFFICIAL_BROWSER_LINEAGE_IDENTITY } from './browser-config.js'
import { installRuntimePage } from './runtime-page.js'
import type { PageRenderer } from './visual.js'

interface OfficialRenderer extends PageRenderer
{
  resize(width: number, height: number): void
}

interface OfficialVm extends ScratchVm
{
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
vm.attachAudioEngine(new AudioEngine())
vm.attachV2BitmapAdapter(new globals.ScratchSVGRenderer.BitmapAdapter())
vm.setTurboMode(false)
vm.setCompatibilityMode(false)

installRuntimePage({
  vm,
  renderer,
  async loadProject(data: ArrayBuffer): Promise<void>
  {
    await vm.setLocale('en-US')
    await vm.loadProject(data)
  },
  stopFreeRunning(): void
  {},
  lineageIdentity: OFFICIAL_BROWSER_LINEAGE_IDENTITY,
})
