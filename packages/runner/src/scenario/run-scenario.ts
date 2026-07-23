// packages/runner/src/scenario/run-scenario.ts
// drive a Scenario against the real headless VM deterministically -> a labeled snapshot trace

import { installDeterminism, type Determinism } from '../policy/determinism.js'
import { withRunnerExecution } from '../policy/execution-coordinator.js'
import { InputController } from './input.js'
import {
  RUN_ISSUE_CODES,
  RunnerIssueError,
  createRunIssue,
  isRunnerIssueError,
  runIssueMessages,
  toRunIssue,
  type RunIssue,
} from '../policy/issues.js'
import {
  blockedNetworkIssues,
  installNetworkPolicy,
  type InstalledNetworkPolicy,
} from '../policy/network-policy.js'
import {
  createIdentityBoundObservationTrace,
  createObservationTrace,
} from '../observation/observation-host.js'
import {
  driveIdentityBoundScenario,
  validateIdentityBoundScenario,
  type IdentityBoundBroadcastActionV1,
  type IdentityBoundBroadcastDispatchV1,
  type IdentityBoundBroadcastResolutionV1,
  type IdentityBoundDriveResultV1,
  type IdentityBoundResolvedBroadcastV1,
  type IdentityBoundResolvedTargetV1,
  type IdentityBoundScenarioEngine,
  type IdentityBoundScenarioV1,
  type IdentityBoundTargetResolutionV1,
} from './identity-bound-scenario.js'
import { IdentityBoundVmBinder } from './identity-bound-vm.js'
import type {
  RuntimeIdentityFacetV1,
  RuntimeLineageAdapterResultV1,
} from '../lineage/runtime-lineage.js'
import type { RuntimeLineageManifestV1 } from '../lineage/runtime-lineage.js'
import { buildRuntimeIdentityFacetV1 } from '../lineage/runtime-lineage-vm.js'
import {
  createRuntimeObservationBudget,
  defaultObservationPlan,
  observationTicks,
  validateObservationPlan,
  type CloneCountSampleV1,
  type ObservationPlanV1,
  type RuntimeObservationBudgetV1,
  type RuntimeObservationCellOptionsV1,
} from '../observation/observation.js'
import {
  DEFAULT_MAX_TICKS,
  broadcastExhaustion,
  driveScenario,
  maxTicksError,
  ticksAllowed,
  validateScenario,
  type ScenarioEngine,
} from './scenario-driver.js'
import {
  captureBoundedRuntimeObservation,
  readCloneCountSample,
  readSnapshot,
  type CloneCountRead,
  type ObservedRuntimeExecutionObservationV1,
} from '../observation/snapshot.js'
import type { RuntimeObservationRecordV1 } from '../observation/runtime-observation.js'
import type {
  RuntimeLogSummary,
  Scenario,
  TickObserver,
  VmStateSnapshot,
  VmTrace,
} from '../policy/types.js'
import type { ScratchThread, ScratchVm } from '../vm/vm-api.js'
import { emptyRuntimeLogSummary } from '../policy/runtime-log.js'
import { nodeRuntimeDescriptor } from '../report/versions.js'
import {
  RUNTIME_ID,
  VmLoadIssueError,
  createVmWithEvidence,
} from '../vm/vm-load.js'
import { errorMessage } from '../error-message.js'

// the headless-vm engine: frame-exact _step + fire-due timers + drain say-for-secs microtasks.
// it satisfies both the raw name-valued surface & the identity-bound surface; the two drivers
// choose which half is reachable, so an identity-bound run cannot fall back to a name lookup.
class VmEngine implements ScenarioEngine, IdentityBoundScenarioEngine
{
  readonly snapshots: VmStateSnapshot[] = []
  finalSnapshot: VmStateSnapshot | null = null
  readonly cloneCounts: CloneCountSampleV1[] = []
  readonly observationIssues: RunIssue[] = []
  readonly runtimeObservations: RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1>[] =
    []
  private tick = 0
  private scenarioStepIndex = -1
  private readonly cloneSampleIndexes = new Map<number, number>()
  private readonly temporalTicks: Set<number>
  private readonly topologyIssues = new Set<string>()
  // input context surfaced to a per-tick observer; keys held & clicks since the last observed tick
  private readonly keysDown = new Set<string>()
  private pendingClicks: string[] = []
  private runtimeObservationAborted = false

  constructor(
    private readonly vm: ScratchVm,
    private readonly input: InputController,
    private readonly det: Determinism,
    private readonly maxTicks: number,
    private readonly observationPlan: ObservationPlanV1,
    private readonly observer?: TickObserver,
    private readonly binder?: IdentityBoundVmBinder,
    private readonly runtimeObservationBudget?: RuntimeObservationBudgetV1
  )
  {
    this.temporalTicks = new Set(observationTicks(observationPlan))
  }

  beginScenarioStep(index: number): void
  {
    this.scenarioStepIndex = index
  }

  currentTick(): number
  {
    return this.tick
  }

  private requireBinder(): IdentityBoundVmBinder
  {
    if (!this.binder)
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.identityBoundActionInconclusive,
          kind: 'scenario',
          responsibility: 'infrastructure',
          message: 'no identity-bound binder is installed on this lane',
        })
      )
    return this.binder
  }

  async resolveTargetLineage(
    targetLineage: string
  ): Promise<IdentityBoundTargetResolutionV1>
  {
    return this.requireBinder().resolveTargetLineage(targetLineage)
  }

  async resolveBroadcast(
    action: IdentityBoundBroadcastActionV1
  ): Promise<IdentityBoundBroadcastResolutionV1>
  {
    return this.requireBinder().resolveBroadcast(action)
  }

  async clickResolvedTarget(
    resolved: IdentityBoundResolvedTargetV1
  ): Promise<void>
  {
    this.pendingClicks.push(resolved.targetLineage)
    this.requireBinder().clickResolvedTarget(resolved)
  }

  async broadcastResolved(
    resolved: IdentityBoundResolvedBroadcastV1
  ): Promise<IdentityBoundBroadcastDispatchV1>
  {
    return this.requireBinder().startResolvedBroadcast(resolved).dispatch
  }

  // fire the proven receiver set, then pump ticks until those threads drain
  async broadcastAndWaitResolved(
    resolved: IdentityBoundResolvedBroadcastV1,
    cap: number
  ): Promise<IdentityBoundBroadcastDispatchV1>
  {
    const binder = this.requireBinder()
    const started = binder.startResolvedBroadcast(resolved)
    const limit = ticksAllowed(this.tick, cap, this.maxTicks)
    let elapsed = 0
    while (elapsed < limit && binder.threadStillRunning(started.threads))
    {
      await this.tickOnce()
      elapsed++
    }
    if (binder.threadStillRunning(started.threads))
      throw broadcastExhaustion(resolved.name, cap, this.tick, this.maxTicks)
    return started.dispatch
  }

  startObservations(): void
  {
    const sampleClones = this.shouldSampleClones(this.tick)
    const cloneRead = sampleClones ? this.recordCloneCount(null) : undefined
    if (sampleClones || this.temporalTicks.has(this.tick))
      this.captureRuntimeObservation(null, cloneRead)
  }

  async greenFlag(): Promise<void>
  {
    this.vm.greenFlag()
  }

  // one frame-exact tick: _step + fire-due timers + drain say-for-secs microtasks
  private async tickOnce(): Promise<void>
  {
    try
    {
      this.vm.runtime._step()
    }
    catch (error)
    {
      throw new RunnerIssueError(
        toRunIssue(error, {
          code: RUN_ISSUE_CODES.vmRuntimeFailed,
          kind: 'runtime',
          responsibility: 'project',
          location: { kind: 'project' },
        })
      )
    }
    try
    {
      this.det.flushTimers()
    }
    catch (error)
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.internalFailed,
          kind: 'internal',
          responsibility: 'infrastructure',
          message: errorMessage(error),
        })
      )
    }
    await Promise.resolve()
    this.tick++
    const sampleClones = this.shouldSampleClones(this.tick)
    const cloneRead = sampleClones ? this.recordCloneCount(null) : undefined
    if (sampleClones || this.temporalTicks.has(this.tick))
      this.captureRuntimeObservation(null, cloneRead)
    if (this.observer)
    {
      // drain clicks into this tick: the hat fired at click time runs on the step just taken
      const clicked = this.pendingClicks
      this.pendingClicks = []
      try
      {
        await this.observer.onTick({
          state: this.readSnapshot(),
          keysDown: [...this.keysDown],
          clicked,
        })
      }
      catch (error)
      {
        throw new RunnerIssueError(
          createRunIssue({
            code: RUN_ISSUE_CODES.vmObserverFailed,
            kind: 'internal',
            responsibility: 'infrastructure',
            message: errorMessage(error),
          })
        )
      }
    }
  }

  // final observation after the timeline drains, for post-run oracle (end) models
  async finish(): Promise<void>
  {
    this.captureRuntimeObservation(null)
    this.finalSnapshot = this.readSnapshot()
    if (this.observer?.onEnd)
    {
      try
      {
        await this.observer.onEnd({
          state: this.finalSnapshot,
          keysDown: [...this.keysDown],
          clicked: [],
        })
      }
      catch (error)
      {
        throw new RunnerIssueError(
          createRunIssue({
            code: RUN_ISSUE_CODES.vmObserverFailed,
            kind: 'internal',
            responsibility: 'infrastructure',
            message: errorMessage(error),
          })
        )
      }
    }
  }

  async step(n: number): Promise<void>
  {
    const allowed = ticksAllowed(this.tick, n, this.maxTicks)
    for (let i = 0; i < allowed; i++) await this.tickOnce()
    if (allowed < n) throw maxTicksError(this.maxTicks)
  }

  async pressKey(key: string): Promise<void>
  {
    this.keysDown.add(key.toLowerCase())
    this.input.pressKey(key)
  }

  async releaseKey(key: string): Promise<void>
  {
    this.keysDown.delete(key.toLowerCase())
    this.input.releaseKey(key)
  }

  async clickSprite(name: string): Promise<void>
  {
    this.pendingClicks.push(name)
    this.input.clickSprite(name)
  }

  async clickStage(): Promise<void>
  {
    this.input.clickStage()
  }

  async broadcast(name: string): Promise<void>
  {
    this.input.broadcast(name)
  }

  // fire receivers, then pump ticks until those threads drain, bounded by the shared cap/budget
  async broadcastAndWait(name: string, cap: number): Promise<void>
  {
    const started =
      this.vm.runtime.startHats('event_whenbroadcastreceived', {
        BROADCAST_OPTION: name,
      }) ?? []
    const stillRunning = (): boolean =>
      started.some(
        (t: ScratchThread) => this.vm.runtime.threads.indexOf(t) !== -1
      )
    const limit = ticksAllowed(this.tick, cap, this.maxTicks)
    let n = 0
    while (n < limit && stillRunning())
    {
      await this.tickOnce()
      n++
    }
    if (stillRunning())
    {
      throw broadcastExhaustion(name, cap, this.tick, this.maxTicks)
    }
  }

  async moveMouse(x: number, y: number): Promise<void>
  {
    this.input.moveMouse(x, y)
  }

  async mouseDown(x: number, y: number): Promise<void>
  {
    this.input.mouseDown(x, y)
  }

  async mouseUp(x: number, y: number): Promise<void>
  {
    this.input.mouseUp(x, y)
  }

  async answer(text: string): Promise<void>
  {
    this.input.answer(text)
  }

  async snapshot(label: string): Promise<void>
  {
    this.captureRuntimeObservation(label)
    this.snapshots.push(this.readSnapshot(label))
    if (this.observationPlan.cloneCounts !== 'none')
      this.recordCloneCount(label)
  }

  private shouldSampleClones(tick: number): boolean
  {
    if (this.observationPlan.cloneCounts === 'every-tick') return true
    return (
      this.observationPlan.cloneCounts === 'sampled' &&
      this.temporalTicks.has(tick)
    )
  }

  private recordCloneCount(label: string | null): CloneCountRead | undefined
  {
    try
    {
      const read = readCloneCountSample(
        this.vm.runtime,
        this.tick,
        this.scenarioStepIndex,
        label
      )
      const existingIndex = this.cloneSampleIndexes.get(this.tick)
      if (existingIndex === undefined)
      {
        this.cloneSampleIndexes.set(this.tick, this.cloneCounts.length)
        this.cloneCounts.push(read.sample)
      }
      else if (label !== null)
      {
        this.cloneCounts[existingIndex] = read.sample
      }
      for (const message of read.issues)
      {
        if (this.topologyIssues.has(message)) continue
        this.topologyIssues.add(message)
        this.observationIssues.push(
          createRunIssue({
            code: RUN_ISSUE_CODES.observationIdentityMismatch,
            kind: 'observation',
            responsibility: 'infrastructure',
            message,
          })
        )
      }
      return read
    }
    catch (error)
    {
      throw new RunnerIssueError(
        toRunIssue(error, {
          code: RUN_ISSUE_CODES.observationCaptureFailed,
          kind: 'observation',
          responsibility: 'infrastructure',
        })
      )
    }
  }

  private readSnapshot(label?: string): VmStateSnapshot
  {
    try
    {
      return readSnapshot(this.vm.runtime, this.tick, label)
    }
    catch (error)
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.vmSnapshotFailed,
          kind: 'internal',
          responsibility: 'infrastructure',
          message: errorMessage(error),
        })
      )
    }
  }

  private captureRuntimeObservation(
    label: string | null,
    cloneRead?: CloneCountRead
  ): void
  {
    if (!this.runtimeObservationBudget || this.runtimeObservationAborted) return
    const capture = captureBoundedRuntimeObservation(
      this.vm.runtime,
      this.runtimeObservationBudget,
      this.tick,
      this.scenarioStepIndex,
      label,
      undefined,
      cloneRead
    )
    this.runtimeObservations.push(
      Object.freeze({
        tick: this.tick,
        scenarioStepIndex: this.scenarioStepIndex,
        label,
        capture,
      })
    )
    if (capture.status === 'observed') return
    this.runtimeObservationAborted = true
    this.observationIssues.push(
      createRunIssue({
        code:
          capture.issue.code === RUN_ISSUE_CODES.observationResourceExceeded
            ? RUN_ISSUE_CODES.observationResourceExceeded
            : RUN_ISSUE_CODES.observationNonScalar,
        kind: 'observation',
        responsibility: 'project',
        message:
          capture.issue.code === RUN_ISSUE_CODES.observationResourceExceeded
            ? `${capture.issue.resource} observation at ${capture.issue.scope} reached ${capture.issue.observed}, exceeding ${capture.issue.limit}`
            : `${capture.issue.expected} observation at ${capture.issue.scope} received ${capture.issue.observedKind}`,
      })
    )
  }
}

type VmRunStage = 'setup' | 'runtime'

function vmFailureIssue(
  error: unknown,
  stage: VmRunStage,
  networkDenied: boolean
): RunIssue
{
  if (isRunnerIssueError(error)) return error.issue
  if (networkDenied)
  {
    return createRunIssue({
      code: RUN_ISSUE_CODES.networkExecutionFailed,
      kind: 'network-policy',
      responsibility: 'unsupported',
      message: errorMessage(error),
    })
  }
  if (stage === 'setup')
  {
    return toRunIssue(error, {
      code: RUN_ISSUE_CODES.internalFailed,
      kind: 'internal',
      responsibility: 'infrastructure',
    })
  }
  return toRunIssue(error, {
    code: RUN_ISSUE_CODES.vmRuntimeFailed,
    kind: 'runtime',
    responsibility: 'project',
    location: { kind: 'project' },
  })
}

// which timeline this scoped run drives; everything else (network denial,
// determinism, cleanup, issue collection) is shared by both
type VmDrivePlanV1 =
  | { readonly kind: 'raw'; readonly scenario: Scenario }
  | {
      readonly kind: 'identityBound'
      readonly scenario: IdentityBoundScenarioV1
      readonly manifest: RuntimeLineageManifestV1
    }

interface ScopedVmRunV1
{
  readonly trace: VmTrace
  readonly drive: IdentityBoundDriveResultV1 | null
  readonly lineage: RuntimeLineageAdapterResultV1 | null
  readonly runtimeObservations: readonly RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1>[]
  readonly runtimeIdentityFacet: RuntimeIdentityFacetV1 | null
}

async function runScenarioScoped(
  sb3: Uint8Array,
  plan: VmDrivePlanV1,
  opts: RunScenarioOptions
): Promise<ScopedVmRunV1>
{
  const requestedPlan = opts.observationPlan ?? defaultObservationPlan()
  const observationValidation = validateObservationPlan(requestedPlan)
  const observationPlan = observationValidation.ok
    ? observationValidation.value
    : defaultObservationPlan()
  const runtimeDescriptor =
    plan.kind === 'raw'
      ? nodeRuntimeDescriptor(plan.scenario)
      : nodeRuntimeDescriptor({})
  const observations =
    plan.kind === 'raw'
      ? createObservationTrace(sb3, plan.scenario, observationPlan)
      : createIdentityBoundObservationTrace(sb3, plan.scenario, observationPlan)
  const maxTicks =
    plan.kind === 'raw'
      ? (plan.scenario.maxTicks ?? DEFAULT_MAX_TICKS)
      : plan.scenario.maxTicks
  const cleanupIssues: RunIssue[] = []
  let vm: ScratchVm | undefined
  let restore: (() => void) | undefined
  let network: InstalledNetworkPolicy | undefined
  let engine: VmEngine | undefined
  let runtimeLog: RuntimeLogSummary = emptyRuntimeLogSummary()
  let lineage: RuntimeLineageAdapterResultV1 | null = null
  let drive: IdentityBoundDriveResultV1 | null = null
  let runtimeIdentityFacet: RuntimeIdentityFacetV1 | null = null
  let failure: unknown
  let stage: VmRunStage = 'setup'

  try
  {
    if (plan.kind === 'raw') validateScenario(plan.scenario)
    else validateIdentityBoundScenario(plan.scenario)
    if (!observationValidation.ok)
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.observationPlanInvalid,
          kind: 'observation',
          responsibility: 'repair-case',
          message: observationValidation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; '),
        })
      )
    // an identity-bound run is always network-denied; no carrier field can relax it
    network = installNetworkPolicy(
      plan.kind === 'raw'
        ? {
            allowNetwork: plan.scenario.allowNetwork,
            allowedOrigins: plan.scenario.allowedOrigins,
          }
        : {}
    )
    const created = await createVmWithEvidence(
      sb3,
      plan.kind === 'identityBound' ? { lineageManifest: plan.manifest } : {}
    )
    vm = created.vm
    runtimeLog = created.runtimeLog
    lineage = created.lineage
    if (plan.kind === 'identityBound')
      runtimeIdentityFacet = buildRuntimeIdentityFacetV1(
        vm.runtime,
        plan.manifest,
        created.lineageTargets
      )
    const det = installDeterminism(vm.runtime, {
      seed: plan.scenario.seed ?? 0,
      fixedDateMs: plan.scenario.fixedDateMs,
    })
    restore = det.restore
    engine = new VmEngine(
      vm,
      new InputController(vm),
      det,
      maxTicks,
      observationPlan,
      opts.observer,
      plan.kind === 'identityBound'
        ? new IdentityBoundVmBinder(vm.runtime, created.lineageTargets)
        : undefined,
      opts.runtimeObservation === undefined
        ? undefined
        : createRuntimeObservationBudget(
            opts.runtimeObservation.caps,
            opts.runtimeObservation.carriedAttemptTraceBytes ?? 0
          )
    )
    engine.startObservations()
    stage = 'runtime'
    if (plan.kind === 'raw') await driveScenario(engine, plan.scenario)
    else drive = await driveIdentityBoundScenario(engine, plan.scenario)
    await engine.finish()
  }
  catch (error)
  {
    if (error instanceof VmLoadIssueError) runtimeLog = error.runtimeLog
    failure = error
  }
  finally
  {
    const attemptCleanup = (callback: () => void): void =>
    {
      try
      {
        callback()
      }
      catch (error)
      {
        cleanupIssues.push(
          toRunIssue(error, {
            code: RUN_ISSUE_CODES.vmCleanupFailed,
            kind: 'internal',
            responsibility: 'infrastructure',
          })
        )
      }
    }
    if (restore) attemptCleanup(restore)
    if (network)
    {
      const installedNetwork = network
      attemptCleanup(() => installedNetwork.restore())
    }
    if (vm)
    {
      const createdVm = vm
      attemptCleanup(() => createdVm.quit())
    }
  }

  const networkIssues = blockedNetworkIssues(network)
  const issues: RunIssue[] = []
  if (failure !== undefined)
  {
    issues.push(vmFailureIssue(failure, stage, networkIssues.length > 0))
  }
  for (const category of runtimeLog.categories)
  {
    if (category.disposition !== 'failure') continue
    issues.push(
      createRunIssue({
        code: RUN_ISSUE_CODES.vmLogError,
        kind: 'project-load',
        responsibility: 'unsupported',
        message:
          category.samples[0] ??
          `${category.count} VM log errors in ${category.code}`,
      })
    )
  }
  issues.push(
    ...networkIssues,
    ...(engine ? engine.observationIssues : []),
    ...cleanupIssues
  )
  if (engine) observations.cloneCounts = structuredClone(engine.cloneCounts)
  // a lowering that could not resolve every action is a lane failure, not a pass
  if (drive && drive.status !== 'complete')
    issues.push(
      createRunIssue({
        code: RUN_ISSUE_CODES.identityBoundActionInconclusive,
        kind: 'scenario',
        responsibility: 'repair-case',
        message: drive.inconclusive
          ? `step ${drive.inconclusive.stepIndex} (${drive.inconclusive.do}) ${drive.inconclusive.reason}: ${drive.inconclusive.detail}`
          : 'the identity-bound scenario could not be fully lowered',
      })
    )
  return {
    trace: {
      ok: issues.length === 0,
      runtime: RUNTIME_ID,
      runtimeDescriptor,
      observations,
      snapshots: engine ? engine.snapshots : [],
      finalSnapshot: engine?.finalSnapshot ?? null,
      errors: runIssueMessages(issues),
      issues,
      runtimeLog,
    },
    drive,
    lineage,
    runtimeObservations: Object.freeze([
      ...(engine?.runtimeObservations ?? []),
    ]),
    runtimeIdentityFacet,
  }
}

interface RunScenarioOptions
{
  observer?: TickObserver
  observationPlan?: ObservationPlanV1
  runtimeObservation?: RuntimeObservationCellOptionsV1
}

// run a scenario under the shared global-state lock through guaranteed cleanup
export async function runScenario(
  sb3: Uint8Array,
  scenario: Scenario,
  opts: RunScenarioOptions = {}
): Promise<VmTrace>
{
  try
  {
    return (
      await withRunnerExecution(() =>
        runScenarioScoped(sb3, { kind: 'raw', scenario }, opts)
      )
    ).trace
  }
  catch (error)
  {
    const issue = toRunIssue(error, {
      code: RUN_ISSUE_CODES.internalFailed,
      kind: 'internal',
      responsibility: 'infrastructure',
    })
    const issues = [issue]
    const requestedPlan = opts.observationPlan ?? defaultObservationPlan()
    const observationValidation = validateObservationPlan(requestedPlan)
    const observationPlan = observationValidation.ok
      ? observationValidation.value
      : defaultObservationPlan()
    return {
      ok: false,
      runtime: RUNTIME_ID,
      runtimeDescriptor: nodeRuntimeDescriptor(scenario),
      observations: createObservationTrace(sb3, scenario, observationPlan),
      snapshots: [],
      finalSnapshot: null,
      errors: runIssueMessages(issues),
      issues,
      runtimeLog: emptyRuntimeLogSummary(),
    }
  }
}

interface IdentityBoundVmRunV1
{
  readonly trace: VmTrace
  readonly drive: IdentityBoundDriveResultV1
  readonly lineage: RuntimeLineageAdapterResultV1 | null
  readonly runtimeObservations: readonly RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1>[]
  readonly runtimeIdentityFacet: RuntimeIdentityFacetV1 | null
}

// run one identity-bound timeline against exactly these bytes & this manifest.
// the raw name-valued driver is never reached, so a lowering that loses its
// lineage binding fails instead of silently resolving a display name.
export async function runIdentityBoundScenario(
  sb3: Uint8Array,
  scenario: IdentityBoundScenarioV1,
  manifest: RuntimeLineageManifestV1,
  opts: RunScenarioOptions = {}
): Promise<IdentityBoundVmRunV1>
{
  const scoped = await withRunnerExecution(() =>
    runScenarioScoped(sb3, { kind: 'identityBound', scenario, manifest }, opts)
  )
  return {
    trace: scoped.trace,
    drive: scoped.drive ?? {
      status: 'inconclusive',
      reservation: {
        status: 'inconclusive',
        targets: [],
        broadcasts: [],
        failures: [],
      },
      actions: [],
      inconclusive: null,
    },
    lineage: scoped.lineage,
    runtimeObservations: scoped.runtimeObservations,
    runtimeIdentityFacet: scoped.runtimeIdentityFacet,
  }
}
