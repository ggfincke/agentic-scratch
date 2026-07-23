// packages/runner/src/vm/vm-load.ts
// load a .sb3 into a fresh headless @scratch/scratch-vm (jsdom globals installed first)

import { createRequire } from 'node:module'

import type {
  ScratchRuntime,
  ScratchTarget,
  ScratchVm,
  ScratchVmCtor,
} from './vm-api.js'
import {
  RUN_ISSUE_CODES,
  RunnerIssueError,
  createRunIssue,
  toRunIssue,
} from '../policy/issues.js'
import {
  captureScratchVmLoadLogs,
  emptyRuntimeLogSummary,
} from '../policy/runtime-log.js'
import type { RuntimeLogSummary } from '../policy/types.js'
import type { RuntimeLineageAdapterResultV1 } from '../lineage/runtime-lineage.js'
import {
  installRuntimeLineageSeamAdapter,
  unboundRuntimeLineageTargetIndexV1,
  type RuntimeLineageSeamHandle,
  type RuntimeLineageSeamVm,
  type RuntimeLineageTargetIndexV1,
} from '../lineage/runtime-lineage-vm.js'
import type { RuntimeLineageManifestV1 } from '../lineage/runtime-lineage.js'
import { RUNNER_TICK_MS } from '../browser/browser-config.js'
import { errorMessage } from '../error-message.js'

export const RUNTIME_ID = '@scratch/scratch-vm (node, headless)'

const requireCjs = createRequire(import.meta.url)

let domReady = false

// install jsdom globals BEFORE scratch-vm is required; its bundle does DOM setup at construction
function installDomGlobals(): void
{
  if (domReady) return
  const { JSDOM } = requireCjs('jsdom')
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
  })
  const g = globalThis as unknown as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.DOMParser = dom.window.DOMParser
  g.XMLSerializer = dom.window.XMLSerializer
  g.Node = dom.window.Node
  g.Element = dom.window.Element
  domReady = true
}

function loadVmCtor(): ScratchVmCtor
{
  installDomGlobals()
  return requireCjs('@scratch/scratch-vm') as ScratchVmCtor
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer
{
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

// emulate the renderer's redraw-on-visual-change so visual loops (e.g. forever-move) yield
// once per tick headless, instead of spinning to the real-time work budget. setXY itself
// only requests a redraw when a renderer exists; we supply that missing signal at the edge.
function installRedrawEmulation(runtime: ScratchRuntime): void
{
  const original = runtime.requestTargetsUpdate.bind(runtime)
  runtime.requestTargetsUpdate = (target: ScratchTarget): void =>
  {
    original(target)
    if (target.visible) runtime.requestRedraw()
  }
}

function cleanupFailedVm(vm: ScratchVm): RunnerIssueError | null
{
  try
  {
    vm.quit()
    return null
  }
  catch (error)
  {
    const message = errorMessage(error)
    return new RunnerIssueError(
      createRunIssue({
        code: RUN_ISSUE_CODES.vmCleanupFailed,
        kind: 'internal',
        responsibility: 'infrastructure',
        message,
      })
    )
  }
}

// construct a VM, load the project, & set the manual-stepping clock (1000/60 ms per tick)
interface CreatedVm
{
  vm: ScratchVm
  runtimeLog: RuntimeLogSummary
  lineage: RuntimeLineageAdapterResultV1 | null
  // lineage -> the exact bound target object, empty unless the seam bound cleanly
  lineageTargets: RuntimeLineageTargetIndexV1
}

interface CreateVmOptions
{
  // opt-in facet: bind this manifest at the deserialize-before-install seam
  lineageManifest?: RuntimeLineageManifestV1
}

export class VmLoadIssueError extends RunnerIssueError
{
  readonly runtimeLog: RuntimeLogSummary

  constructor(
    issue: ConstructorParameters<typeof RunnerIssueError>[0],
    log: RuntimeLogSummary
  )
  {
    super(issue)
    this.name = 'VmLoadIssueError'
    this.runtimeLog = log
  }
}

export async function createVmWithEvidence(
  sb3: Uint8Array,
  options: CreateVmOptions = {}
): Promise<CreatedVm>
{
  let vm: ScratchVm | undefined
  let initialized = false
  let runtimeLog = emptyRuntimeLogSummary()
  let seam: RuntimeLineageSeamHandle | null = null
  let loaded: Awaited<ReturnType<typeof captureScratchVmLoadLogs<void>>>
  try
  {
    loaded = await captureScratchVmLoadLogs(async () =>
    {
      const VirtualMachine = loadVmCtor()
      vm = new VirtualMachine()
      initialized = true
      // the seam must be shadowed before loadProject; installTargets runs inside it
      if (options.lineageManifest)
        seam = installRuntimeLineageSeamAdapter(
          vm as unknown as RuntimeLineageSeamVm,
          options.lineageManifest
        )
      await vm.setLocale('en-US')
      await vm.loadProject(toArrayBuffer(sb3))
    })
    runtimeLog = loaded.log
  }
  catch (error)
  {
    const cleanupFailure = vm ? cleanupFailedVm(vm) : null
    if (cleanupFailure) throw cleanupFailure
    throw new RunnerIssueError(
      toRunIssue(error, {
        code: initialized
          ? RUN_ISSUE_CODES.projectLoadFailed
          : RUN_ISSUE_CODES.vmInitializationFailed,
        kind: initialized ? 'project-load' : 'internal',
        responsibility: initialized ? 'unsupported' : 'infrastructure',
      })
    )
  }
  if (!loaded.ok)
  {
    const cleanupFailure = vm ? cleanupFailedVm(vm) : null
    const issue = cleanupFailure
      ? cleanupFailure.issue
      : toRunIssue(loaded.error, {
          code: initialized
            ? RUN_ISSUE_CODES.projectLoadFailed
            : RUN_ISSUE_CODES.vmInitializationFailed,
          kind: initialized ? 'project-load' : 'internal',
          responsibility: initialized ? 'unsupported' : 'infrastructure',
        })
    throw new VmLoadIssueError(issue, runtimeLog)
  }
  if (!vm)
  {
    throw new VmLoadIssueError(
      createRunIssue({
        code: RUN_ISSUE_CODES.vmInitializationFailed,
        kind: 'internal',
        responsibility: 'infrastructure',
        message: 'VM load completed without a VM instance',
      }),
      runtimeLog
    )
  }

  try
  {
    // REQUIRED before manual stepping: WORK_TIME = 0.75 * currentStepTime; null -> 0 threads run
    vm.runtime.currentStepTime = RUNNER_TICK_MS
    installRedrawEmulation(vm.runtime)
    const handle = seam as RuntimeLineageSeamHandle | null
    const lineage = handle ? handle.result() : null
    const lineageTargets = handle
      ? handle.targetIndex()
      : unboundRuntimeLineageTargetIndexV1()
    handle?.release()
    return { vm, runtimeLog, lineage, lineageTargets }
  }
  catch (error)
  {
    const cleanupFailure = cleanupFailedVm(vm)
    if (cleanupFailure) throw cleanupFailure
    throw new RunnerIssueError(
      toRunIssue(error, {
        code: RUN_ISSUE_CODES.vmInitializationFailed,
        kind: 'internal',
        responsibility: 'infrastructure',
      })
    )
  }
}
