// scripts/project/fragility-probe.ts
// corroborate static warp assumptions against the pinned scratch vm

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

interface StackFrame
{
  warpMode: boolean
}

interface ScratchThread
{
  peekStackFrame(): StackFrame | null
  popStack(): string | null
  pushStack(blockId: string): void
  reuseStackForNextBlock(blockId: string): void
}

interface ScratchThreadConstructor
{
  new (firstBlock: string): ScratchThread
}

interface ScratchVariable
{
  value: unknown
}

interface ScratchTarget
{
  variables: Record<string, ScratchVariable>
}

interface ScratchRuntime
{
  currentStepTime: number | null
  threads: unknown[]
  _step(): void
  getTargetForStage(): ScratchTarget
}

interface ScratchVm
{
  runtime: ScratchRuntime
  greenFlag(): void
  loadProject(project: string): Promise<void>
  quit(): void
}

interface ScratchVmConstructor
{
  new (): ScratchVm
}

interface VmModules
{
  Thread: ScratchThreadConstructor
  VirtualMachine: ScratchVmConstructor
  version: string
}

interface ProjectRun
{
  completed: boolean
  firstStepMs: number | null
  steps: number
  value: number | null
  variableWrites: number | null
}

interface RunOptions
{
  firstStepOnly?: boolean
  instrumentVariable?: boolean
}

interface CheckResult
{
  id: string
  description: string
  observed: unknown
  corroborated: boolean
}

interface CheckObservation
{
  observed: unknown
  corroborated: boolean
}

type WarpEncoding = boolean | string

type ProcedureBody =
  | { kind: 'broadcast' }
  | { kind: 'repeat'; iterations: number }
  | { kind: 'wait'; seconds: number }

const requireCjs = createRequire(import.meta.url)
const variableId = 'counter-id'
const broadcastId = 'message-id'
const emptyCostume = {
  assetId: '00000000000000000000000000000000',
  name: 'blank',
  dataFormat: 'svg',
  md5ext: '00000000000000000000000000000000.svg',
  bitmapResolution: 1,
  rotationCenterX: 0,
  rotationCenterY: 0,
}
const stepCap = 600
let cachedVmModules: VmModules | undefined

function errorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}

function vmPackageRoot(): string
{
  return resolve(dirname(requireCjs.resolve('@scratch/scratch-vm')), '..', '..')
}

function loadVmModules(): VmModules
{
  if (cachedVmModules) return cachedVmModules
  const root = vmPackageRoot()
  const packageJson = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8')
  ) as { version: string }
  const VirtualMachine = requireCjs(
    resolve(root, 'src/index.js')
  ) as ScratchVmConstructor
  const Thread = requireCjs(
    resolve(root, 'src/engine/thread.js')
  ) as ScratchThreadConstructor
  cachedVmModules = { Thread, VirtualMachine, version: packageJson.version }
  return cachedVmModules
}

function prototypeMutation(
  procedureCode: string,
  warp: WarpEncoding
): Record<string, unknown>
{
  return {
    tagName: 'mutation',
    children: [],
    proccode: procedureCode,
    argumentids: '[]',
    argumentnames: '[]',
    argumentdefaults: '[]',
    warp,
  }
}

function callMutation(procedureCode: string): Record<string, unknown>
{
  return {
    tagName: 'mutation',
    children: [],
    proccode: procedureCode,
    argumentids: '[]',
  }
}

function bodyBlocks(
  body: ProcedureBody,
  parent: string
): Record<string, Record<string, unknown>>
{
  if (body.kind === 'broadcast')
  {
    return {
      body: {
        opcode: 'event_broadcastandwait',
        next: null,
        parent,
        inputs: {
          BROADCAST_INPUT: [1, [11, 'msg', broadcastId]],
        },
        fields: {},
        shadow: false,
        topLevel: false,
      },
    }
  }
  if (body.kind === 'wait')
  {
    return {
      body: {
        opcode: 'control_wait',
        next: null,
        parent,
        inputs: {
          DURATION: [1, [4, String(body.seconds)]],
        },
        fields: {},
        shadow: false,
        topLevel: false,
      },
    }
  }
  return {
    body: {
      opcode: 'control_repeat',
      next: null,
      parent,
      inputs: {
        TIMES: [1, [4, String(body.iterations)]],
        SUBSTACK: [2, 'change'],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    change: {
      opcode: 'data_changevariableby',
      next: null,
      parent: 'body',
      inputs: {
        VALUE: [1, [4, '1']],
      },
      fields: {
        VARIABLE: ['counter', variableId],
      },
      shadow: false,
      topLevel: false,
    },
  }
}

function projectWithBlocks(
  blocks: Record<string, Record<string, unknown>>
): Record<string, unknown>
{
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {
          [variableId]: ['counter', 0],
        },
        lists: {},
        broadcasts: {
          [broadcastId]: 'msg',
        },
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [emptyCostume],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null,
      },
      {
        isStage: false,
        name: 'Sprite1',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks,
        comments: {},
        currentCostume: 0,
        costumes: [emptyCostume],
        sounds: [],
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: {
      semver: '3.0.0',
      vm: '14.1.0',
      agent: 'fragility-probe',
    },
  }
}

function singleProcedureProject(
  warp: WarpEncoding,
  body: ProcedureBody
): Record<string, unknown>
{
  const procedureCode = 'probe'
  return projectWithBlocks({
    flag: {
      opcode: 'event_whenflagclicked',
      next: 'call',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    call: {
      opcode: 'procedures_call',
      next: null,
      parent: 'flag',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: callMutation(procedureCode),
    },
    definition: {
      opcode: 'procedures_definition',
      next: 'body',
      parent: null,
      inputs: {
        custom_block: [1, 'prototype'],
      },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 200,
      y: 0,
    },
    prototype: {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'definition',
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: prototypeMutation(procedureCode, warp),
    },
    ...bodyBlocks(body, 'definition'),
  })
}

function nestedRepeatProject(outerWarp: WarpEncoding): Record<string, unknown>
{
  const outerCode = 'outer'
  const innerCode = 'inner'
  const frameCode = 'frame boundary'
  return projectWithBlocks({
    flag: {
      opcode: 'event_whenflagclicked',
      next: 'outer-call',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    'outer-call': {
      opcode: 'procedures_call',
      next: null,
      parent: 'flag',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: callMutation(outerCode),
    },
    'outer-definition': {
      opcode: 'procedures_definition',
      next: 'inner-call',
      parent: null,
      inputs: {
        custom_block: [1, 'outer-prototype'],
      },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 200,
      y: 0,
    },
    'outer-prototype': {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'outer-definition',
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: prototypeMutation(outerCode, outerWarp),
    },
    'inner-call': {
      opcode: 'procedures_call',
      next: null,
      parent: 'outer-definition',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: callMutation(innerCode),
    },
    'inner-definition': {
      opcode: 'procedures_definition',
      next: 'body',
      parent: null,
      inputs: {
        custom_block: [1, 'inner-prototype'],
      },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 400,
      y: 0,
    },
    'inner-prototype': {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'inner-definition',
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: prototypeMutation(innerCode, 'false'),
    },
    'frame-flag': {
      opcode: 'event_whenflagclicked',
      next: 'frame-call',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 200,
    },
    'frame-call': {
      opcode: 'procedures_call',
      next: null,
      parent: 'frame-flag',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: callMutation(frameCode),
    },
    'frame-definition': {
      opcode: 'procedures_definition',
      next: 'frame-wait',
      parent: null,
      inputs: {
        custom_block: [1, 'frame-prototype'],
      },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 600,
      y: 0,
    },
    'frame-prototype': {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'frame-definition',
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: prototypeMutation(frameCode, 'true'),
    },
    'frame-wait': {
      opcode: 'control_wait',
      next: null,
      parent: 'frame-definition',
      inputs: {
        DURATION: [1, [4, '0']],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    ...bodyBlocks({ kind: 'repeat', iterations: 3 }, 'inner-definition'),
  })
}

function stageVariableValue(runtime: ScratchRuntime): number | null
{
  const value = runtime.getTargetForStage().variables[variableId]?.value
  return typeof value === 'number' ? value : null
}

async function runProject(
  project: Record<string, unknown>,
  options: RunOptions = {}
): Promise<ProjectRun>
{
  const { VirtualMachine } = loadVmModules()
  const vm = new VirtualMachine()
  try
  {
    await vm.loadProject(JSON.stringify(project))
    vm.runtime.currentStepTime = 1000 / 60
    const variable = vm.runtime.getTargetForStage().variables[variableId]
    let variableWrites: number | null = null
    if (options.instrumentVariable)
    {
      if (!variable) throw new Error('missing stage variable')
      variableWrites = 0
      vm.runtime.getTargetForStage().variables[variableId] = new Proxy(
        variable,
        {
          get: (target, property, receiver) =>
            Reflect.get(target, property, receiver),
          set: (target, property, value, receiver) =>
          {
            if (property === 'value') variableWrites = (variableWrites ?? 0) + 1
            return Reflect.set(target, property, value, receiver)
          },
        }
      )
    }
    vm.greenFlag()
    let steps = 0
    let firstStepMs: number | null = null
    while (vm.runtime.threads.length > 0 && steps < stepCap)
    {
      const startedAt = performance.now()
      vm.runtime._step()
      const elapsed = performance.now() - startedAt
      steps++
      if (firstStepMs === null) firstStepMs = elapsed
      if (options.firstStepOnly) break
    }
    return {
      completed: vm.runtime.threads.length === 0,
      firstStepMs: firstStepMs === null ? null : Number(firstStepMs.toFixed(2)),
      steps,
      value: stageVariableValue(vm.runtime),
      variableWrites,
    }
  }
  finally
  {
    vm.quit()
  }
}

async function runCheck(
  id: string,
  description: string,
  observe: () => Promise<CheckObservation>
): Promise<CheckResult>
{
  try
  {
    const result = await observe()
    return { id, description, ...result }
  }
  catch (error)
  {
    return {
      id,
      description,
      observed: { error: errorMessage(error) },
      corroborated: false,
    }
  }
}

async function checkWarpInheritance(): Promise<CheckObservation>
{
  const warp = await runProject(nestedRepeatProject('true'))
  const nonWarp = await runProject(nestedRepeatProject('false'))
  return {
    observed: {
      warpSteps: warp.steps,
      nonWarpSteps: nonWarp.steps,
      warpValue: warp.value,
      nonWarpValue: nonWarp.value,
    },
    corroborated: warp.steps === 1 && nonWarp.steps > 1,
  }
}

async function checkPromiseResumeWarpLoss(): Promise<CheckObservation>
{
  const { Thread } = loadVmModules()
  const thread = new Thread('parent')
  thread.pushStack('parent')
  thread.pushStack('pending')
  const pendingFrame = thread.peekStackFrame()
  if (!pendingFrame) throw new Error('missing pending stack frame')
  pendingFrame.warpMode = true
  thread.popStack()
  thread.pushStack('next')
  const replacementFrame = thread.peekStackFrame()
  if (!replacementFrame) throw new Error('missing replacement stack frame')
  const afterResume = replacementFrame.warpMode
  replacementFrame.warpMode = true
  thread.reuseStackForNextBlock('reused')
  const reusedFrame = thread.peekStackFrame()
  if (!reusedFrame) throw new Error('missing reused stack frame')
  const afterReuse = reusedFrame.warpMode
  return {
    observed: { afterResume, afterReuse },
    corroborated: afterResume === false && afterReuse === true,
  }
}

async function checkEncoding(): Promise<CheckObservation>
{
  const booleanTrue = await runProject(nestedRepeatProject(true))
  const stringNull = await runProject(nestedRepeatProject('null'))
  return {
    observed: {
      booleanTrueSteps: booleanTrue.steps,
      stringNullSteps: stringNull.steps,
    },
    corroborated: booleanTrue.steps === 1 && stringNull.steps > 1,
  }
}

async function checkBudget(): Promise<CheckObservation>
{
  const run = await runProject(
    singleProcedureProject('true', {
      kind: 'repeat',
      iterations: 2_000_000,
    }),
    { firstStepOnly: true, instrumentVariable: true }
  )
  const elapsed = run.firstStepMs
  const interrupted =
    !run.completed && run.value !== null && run.value < 2_000_000
  return {
    observed: {
      firstStepMs: elapsed,
      threadAlive: !run.completed,
      valueAfterFirstStep: run.value,
      variableWrites: run.variableWrites,
    },
    corroborated:
      elapsed !== null && elapsed >= 400 && elapsed <= 700 && interrupted,
  }
}

async function checkBroadcastReceiverConditional(): Promise<CheckObservation>
{
  const run = await runProject(
    singleProcedureProject('true', { kind: 'broadcast' })
  )
  return {
    observed: { steps: run.steps },
    corroborated: run.steps === 1,
  }
}

async function checkWaitBurn(): Promise<CheckObservation>
{
  const positiveWait = await runProject(
    singleProcedureProject('true', { kind: 'wait', seconds: 0.01 })
  )
  const zeroWait = await runProject(
    singleProcedureProject('true', { kind: 'wait', seconds: 0 })
  )
  return {
    observed: {
      positiveWaitSteps: positiveWait.steps,
      positiveWaitFirstStepMs: positiveWait.firstStepMs,
      zeroWaitSteps: zeroWait.steps,
      zeroWaitFirstStepMs: zeroWait.firstStepMs,
    },
    corroborated:
      positiveWait.steps >= 2 &&
      positiveWait.firstStepMs !== null &&
      positiveWait.firstStepMs >= 400 &&
      zeroWait.steps === 1 &&
      zeroWait.firstStepMs !== null &&
      zeroWait.firstStepMs < 100,
  }
}

async function main(): Promise<void>
{
  const originalLog = console.log
  console.log = (...values: unknown[]): void =>
  {
    console.error(...values)
  }
  let pinnedVmVersion: string
  try
  {
    pinnedVmVersion = loadVmModules().version
  }
  catch (error)
  {
    pinnedVmVersion = `unavailable: ${errorMessage(error)}`
  }
  const checks = [
    await runCheck(
      'V1-warp-inheritance',
      'an outer warp procedure lends warp mode to a non-warp callee',
      checkWarpInheritance
    ),
    await runCheck(
      'V2-promise-resume-warp-loss',
      'promise stack rebuilding loses warp while stack reuse preserves it',
      checkPromiseResumeWarpLoss
    ),
    await runCheck(
      'V3-encoding',
      'boolean true enables warp while string null does not',
      checkEncoding
    ),
    await runCheck(
      'V6-budget',
      'a long warp loop is interrupted at the real-time warp budget',
      checkBudget
    ),
    await runCheck(
      'V7C-broadcast-receiver-conditional',
      'broadcast and wait does not yield when no receiver exists',
      checkBroadcastReceiverConditional
    ),
    await runCheck(
      'V8-wait-burn',
      'a positive warp wait burns one budget while a zero wait completes',
      checkWaitBurn
    ),
  ]
  console.log = originalLog
  const allCorroborated = checks.every((check) => check.corroborated)
  process.stdout.write(
    `${JSON.stringify({ pinnedVmVersion, checks, allCorroborated })}\n`
  )
  process.exitCode = allCorroborated ? 0 : 1
}

main().catch((error: unknown) =>
{
  console.error(errorMessage(error))
  process.stdout.write(
    `${JSON.stringify({
      pinnedVmVersion: 'unavailable',
      checks: [],
      allCorroborated: false,
    })}\n`
  )
  process.exitCode = 1
})
