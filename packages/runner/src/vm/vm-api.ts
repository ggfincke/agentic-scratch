// packages/runner/src/vm/vm-api.ts
// structural surface of @scratch/scratch-vm we drive (the package ships no types)

import type { BubbleState, ScalarValue } from '../policy/types.js'

interface ScratchVariable
{
  name: string
  value: ScalarValue | ScalarValue[]
  type: '' | 'list' | 'broadcast_msg'
}

interface ScratchCostume
{
  name: string
}

interface ScratchSprite
{
  clones: ScratchTarget[]
}

interface ScratchField
{
  name?: string
  id?: string | null
  value?: unknown
}

interface ScratchBlock
{
  opcode: string
  topLevel?: boolean
  fields?: Record<string, ScratchField>
}

// the loader-owned block store; `_scripts` holds top-level block ids in the same
// order BlocksRuntimeCache.getScripts walks when the runtime dispatches hats
interface ScratchBlockContainer
{
  _blocks: Record<string, ScratchBlock>
  _scripts: string[]
}

export interface ScratchTarget
{
  id: string
  blocks?: ScratchBlockContainer
  isStage: boolean
  isOriginal: boolean
  x: number
  y: number
  direction: number
  size: number
  visible: boolean
  draggable: boolean
  rotationStyle: string
  volume: number
  tempo: number
  videoState: string
  currentCostume: number
  effects: Record<string, number>
  variables: Record<string, ScratchVariable>
  sprite?: ScratchSprite
  drawableID?: number
  getName(): string
  getCostumes(): ScratchCostume[]
  getCustomState(key: string): BubbleState | undefined
  lookupVariableByNameAndType(
    name: string,
    type: string
  ): ScratchVariable | undefined
}

interface ScratchTimerInstance
{
  start(): void
  startTime: number
  timeElapsed(): number
}

interface ScratchSequencer
{
  timer: ScratchTimerInstance
}

interface ScratchClock
{
  projectTimer(): number
  resetProjectTimer(): void
  _projectTimer: ScratchTimerInstance
}

interface ScratchIoDevices
{
  clock: ScratchClock
}

export type ScratchThread = unknown

export interface ScratchRuntime
{
  targets: ScratchTarget[]
  threads: ScratchThread[]
  currentStepTime: number | null
  currentMSecs: number
  ioDevices: ScratchIoDevices
  sequencer: ScratchSequencer
  _primitives: Record<string, (...args: unknown[]) => unknown>
  _step(): void
  updateCurrentMSecs(): void
  requestRedraw(): void
  requestTargetsUpdate(target: ScratchTarget): void
  greenFlag(): void
  startHats(
    opcode: string,
    matchFields: Record<string, unknown> | null,
    target?: ScratchTarget
  ): ScratchThread[] | undefined
  getSpriteTargetByName(name: string): ScratchTarget | undefined
  getTargetForStage(): ScratchTarget
  emit(event: string, ...args: unknown[]): void
}

export interface ScratchVm
{
  runtime: ScratchRuntime
  loadProject(input: ArrayBuffer): Promise<void>
  setLocale(locale: string): Promise<void>
  greenFlag(): void
  postIOData(device: string, data: Record<string, unknown>): void
  quit(): void
}

export type ScratchVmCtor = new () => ScratchVm
