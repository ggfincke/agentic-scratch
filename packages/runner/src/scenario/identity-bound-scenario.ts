// packages/runner/src/scenario/identity-bound-scenario.ts
// neutral identity-bound scenario carrier: lineage-valued actions & concrete action traces

import { RUN_ISSUE_CODES, RunnerIssueError, createRunIssue } from '../policy/issues.js'
import { DEFAULT_WAIT_CAP } from './scenario-driver.js'

export const IDENTITY_BOUND_SCENARIO_SCHEMA_VERSION = 1 as const

// what a lowered broadcast carries: the opaque declaration lineage, the concrete
// message name the pinned name-valued hat API needs, & the claimed receiver set.
// the engine proves that set against the live runtime rather than trusting it.
export interface IdentityBoundBroadcastActionV1
{
  readonly broadcastLineage: string
  readonly name: string
  readonly expectedReceiverTargetLineages: readonly string[]
}

export type IdentityBoundStepV1 =
  | { readonly do: 'greenFlag' }
  | { readonly do: 'clickStage' }
  | { readonly do: 'wait'; readonly ticks: number }
  | { readonly do: 'keyDown'; readonly key: string }
  | { readonly do: 'keyUp'; readonly key: string }
  | { readonly do: 'pressKey'; readonly key: string }
  | { readonly do: 'releaseKey'; readonly key: string }
  | { readonly do: 'tapKey'; readonly key: string; readonly ticks?: number }
  | { readonly do: 'clickTarget'; readonly targetLineage: string }
  | {
      readonly do: 'broadcast'
      readonly broadcast: IdentityBoundBroadcastActionV1
    }
  | {
      readonly do: 'broadcastAndWait'
      readonly broadcast: IdentityBoundBroadcastActionV1
      readonly maxTicks?: number
    }
  | { readonly do: 'moveMouse'; readonly x: number; readonly y: number }
  | { readonly do: 'mouseDown'; readonly x: number; readonly y: number }
  | { readonly do: 'mouseUp'; readonly x: number; readonly y: number }
  | { readonly do: 'typeAnswer'; readonly text: string }
  | { readonly do: 'snapshot'; readonly label: string }

// no allowNetwork field exists: an identity-bound run is always network-denied
export interface IdentityBoundScenarioV1
{
  readonly schemaVersion: typeof IDENTITY_BOUND_SCENARIO_SCHEMA_VERSION
  readonly seed: number
  readonly fixedDateMs: number
  readonly maxTicks: number
  readonly steps: readonly IdentityBoundStepV1[]
}

type IdentityBoundResolutionReasonV1 =
  | 'lineage-not-bound'
  | 'lineage-ambiguous'
  | 'lineage-index-unavailable'
  | 'broadcast-name-empty'
  | 'broadcast-name-collision'
  | 'broadcast-receiver-cardinality'
  | 'broadcast-receiver-identity'
  | 'broadcast-receiver-unmapped'
  | 'dispatch-receiver-divergence'

export type IdentityBoundTargetResolutionV1 =
  | {
      readonly status: 'resolved'
      readonly targetLineage: string
    }
  | {
      readonly status: 'inconclusive'
      readonly targetLineage: string
      readonly reason: IdentityBoundResolutionReasonV1
      readonly detail: string
    }

export type IdentityBoundBroadcastResolutionV1 =
  | {
      readonly status: 'resolved'
      readonly broadcastLineage: string
      readonly name: string
      readonly provenReceiverTargetLineages: readonly string[]
      readonly receiverScriptCount: number
    }
  | {
      readonly status: 'inconclusive'
      readonly broadcastLineage: string
      readonly name: string
      readonly reason: IdentityBoundResolutionReasonV1
      readonly detail: string
    }

// what actually started when the lowered broadcast was driven; compared against
// the independently proven receiver set so agreement is evidence, not assumption
export interface IdentityBoundBroadcastDispatchV1
{
  readonly startedReceiverTargetLineages: readonly string[]
  readonly startedThreadCount: number
  readonly unmappedThreadCount: number
}

export type IdentityBoundResolvedTargetV1 = Extract<
  IdentityBoundTargetResolutionV1,
  { status: 'resolved' }
>

export type IdentityBoundResolvedBroadcastV1 = Extract<
  IdentityBoundBroadcastResolutionV1,
  { status: 'resolved' }
>

// the per-lane primitives an identity-bound timeline lowers onto. clickSprite,
// broadcast(name) & broadcastAndWait(name) are deliberately absent: a driver
// holding this surface cannot reach a name-valued action even by mistake.
export interface IdentityBoundScenarioEngine
{
  beginScenarioStep?(
    index: number,
    step: IdentityBoundStepV1
  ): void | Promise<void>
  currentTick(): number
  greenFlag(): Promise<void>
  step(n: number): Promise<void>
  pressKey(key: string): Promise<void>
  releaseKey(key: string): Promise<void>
  clickStage(): Promise<void>
  moveMouse(x: number, y: number): Promise<void>
  mouseDown(x: number, y: number): Promise<void>
  mouseUp(x: number, y: number): Promise<void>
  answer(text: string): Promise<void>
  snapshot(label: string): Promise<void>
  resolveTargetLineage(
    targetLineage: string
  ): Promise<IdentityBoundTargetResolutionV1>
  resolveBroadcast(
    action: IdentityBoundBroadcastActionV1
  ): Promise<IdentityBoundBroadcastResolutionV1>
  clickResolvedTarget(resolved: IdentityBoundResolvedTargetV1): Promise<void>
  broadcastResolved(
    resolved: IdentityBoundResolvedBroadcastV1
  ): Promise<IdentityBoundBroadcastDispatchV1>
  broadcastAndWaitResolved(
    resolved: IdentityBoundResolvedBroadcastV1,
    cap: number
  ): Promise<IdentityBoundBroadcastDispatchV1>
}

export interface IdentityBoundActionRecordV1
{
  readonly stepIndex: number
  readonly do: IdentityBoundStepV1['do']
  readonly tick: number
  readonly targetLineage: string | null
  readonly broadcastLineage: string | null
  readonly concreteName: string | null
  readonly expectedReceiverTargetLineages: readonly string[]
  readonly provenReceiverTargetLineages: readonly string[]
  readonly startedReceiverTargetLineages: readonly string[]
  readonly startedThreadCount: number
}

interface IdentityBoundResolutionFailureV1
{
  readonly stepIndex: number
  readonly do: IdentityBoundStepV1['do']
  readonly reason: IdentityBoundResolutionReasonV1
  readonly detail: string
}

// the complete pre-execution reservation: every identity-valued action in the
// timeline resolved before step zero runs
interface IdentityBoundReservationV1
{
  readonly status: 'reserved' | 'inconclusive'
  readonly targets: readonly IdentityBoundResolvedTargetV1[]
  readonly broadcasts: readonly IdentityBoundResolvedBroadcastV1[]
  readonly failures: readonly IdentityBoundResolutionFailureV1[]
}

export interface IdentityBoundDriveResultV1
{
  readonly status: 'complete' | 'inconclusive'
  readonly reservation: IdentityBoundReservationV1
  readonly actions: readonly IdentityBoundActionRecordV1[]
  readonly inconclusive: IdentityBoundResolutionFailureV1 | null
}

function scenarioIssue(code: string, message: string): RunnerIssueError
{
  return new RunnerIssueError(
    createRunIssue({
      code,
      kind: 'scenario',
      responsibility: 'repair-case',
      message,
    })
  )
}

function validTickCount(value: number): boolean
{
  return Number.isSafeInteger(value) && value >= 0
}

export function validateIdentityBoundScenario(
  scenario: IdentityBoundScenarioV1
): void
{
  if (scenario.schemaVersion !== IDENTITY_BOUND_SCENARIO_SCHEMA_VERSION)
    throw scenarioIssue(
      RUN_ISSUE_CODES.scenarioUnknownStep,
      `unsupported identity-bound scenario version: ${String(scenario.schemaVersion)}`
    )
  if (!validTickCount(scenario.maxTicks))
    throw scenarioIssue(
      RUN_ISSUE_CODES.scenarioInvalidMaxTicks,
      `scenario: invalid maxTicks ${scenario.maxTicks}`
    )
  const labels = new Set<string>()
  for (const step of scenario.steps)
  {
    if (step.do === 'wait' && !validTickCount(step.ticks))
      throw scenarioIssue(
        RUN_ISSUE_CODES.scenarioInvalidWaitTicks,
        `wait: invalid tick count ${step.ticks}`
      )
    if (
      step.do === 'tapKey' &&
      step.ticks !== undefined &&
      !validTickCount(step.ticks)
    )
      throw scenarioIssue(
        RUN_ISSUE_CODES.scenarioInvalidTapTicks,
        `tapKey: invalid tick count ${step.ticks}`
      )
    if (
      step.do === 'broadcastAndWait' &&
      !validTickCount(step.maxTicks ?? DEFAULT_WAIT_CAP)
    )
      throw scenarioIssue(
        RUN_ISSUE_CODES.scenarioInvalidBroadcastTicks,
        `broadcastAndWait: invalid maxTicks ${String(step.maxTicks)}`
      )
    if (step.do === 'clickTarget' && step.targetLineage.length === 0)
      throw scenarioIssue(
        RUN_ISSUE_CODES.scenarioMissingTarget,
        'clickTarget: empty target lineage'
      )
    if (step.do !== 'snapshot') continue
    if (labels.has(step.label))
      throw scenarioIssue(
        RUN_ISSUE_CODES.scenarioDuplicateSnapshot,
        `duplicate snapshot label: "${step.label}"`
      )
    labels.add(step.label)
  }
}

function sortedLineages(values: readonly string[]): readonly string[]
{
  return Object.freeze([...values].sort())
}

// resolve every identity-valued action before any of them is driven, so a
// scenario that cannot be fully lowered never half-executes against a lane
async function reserveIdentityBoundScenario(
  engine: IdentityBoundScenarioEngine,
  scenario: IdentityBoundScenarioV1
): Promise<IdentityBoundReservationV1>
{
  const targets = new Map<string, IdentityBoundResolvedTargetV1>()
  const broadcasts = new Map<string, IdentityBoundResolvedBroadcastV1>()
  const failures: IdentityBoundResolutionFailureV1[] = []
  for (let index = 0; index < scenario.steps.length; index++)
  {
    const step = scenario.steps[index]!
    if (step.do === 'clickTarget')
    {
      if (targets.has(step.targetLineage)) continue
      const resolution = await engine.resolveTargetLineage(step.targetLineage)
      if (resolution.status === 'resolved')
        targets.set(step.targetLineage, resolution)
      else
        failures.push({
          stepIndex: index,
          do: step.do,
          reason: resolution.reason,
          detail: resolution.detail,
        })
      continue
    }
    if (step.do !== 'broadcast' && step.do !== 'broadcastAndWait') continue
    const key = broadcastReservationKey(step.broadcast)
    if (broadcasts.has(key)) continue
    const resolution = await engine.resolveBroadcast(step.broadcast)
    if (resolution.status === 'resolved') broadcasts.set(key, resolution)
    else
      failures.push({
        stepIndex: index,
        do: step.do,
        reason: resolution.reason,
        detail: resolution.detail,
      })
  }
  return Object.freeze({
    status:
      failures.length === 0 ? ('reserved' as const) : ('inconclusive' as const),
    targets: Object.freeze([...targets.values()]),
    broadcasts: Object.freeze([...broadcasts.values()]),
    failures: Object.freeze(failures),
  })
}

function broadcastReservationKey(action: {
  readonly broadcastLineage: string
  readonly name: string
}): string
{
  return `${action.broadcastLineage}\u0000${action.name}`
}

function record(
  partial: Partial<IdentityBoundActionRecordV1> &
    Pick<IdentityBoundActionRecordV1, 'stepIndex' | 'do' | 'tick'>
): IdentityBoundActionRecordV1
{
  return Object.freeze({
    targetLineage: null,
    broadcastLineage: null,
    concreteName: null,
    expectedReceiverTargetLineages: Object.freeze([]),
    provenReceiverTargetLineages: Object.freeze([]),
    startedReceiverTargetLineages: Object.freeze([]),
    startedThreadCount: 0,
    ...partial,
  })
}

function basicActionRecord(
  stepIndex: number,
  action: IdentityBoundActionRecordV1['do'],
  tick: number
): IdentityBoundActionRecordV1
{
  return record({ stepIndex, do: action, tick })
}

// walk the reserved timeline & retain one concrete action record per step; a
// dispatch whose started receivers disagree w/ the proven set stops the run
export async function driveIdentityBoundScenario(
  engine: IdentityBoundScenarioEngine,
  scenario: IdentityBoundScenarioV1
): Promise<IdentityBoundDriveResultV1>
{
  validateIdentityBoundScenario(scenario)
  const reservation = await reserveIdentityBoundScenario(engine, scenario)
  if (reservation.status !== 'reserved')
    return Object.freeze({
      status: 'inconclusive' as const,
      reservation,
      actions: Object.freeze([]),
      inconclusive: reservation.failures[0] ?? null,
    })

  const targets = new Map(
    reservation.targets.map((entry) => [entry.targetLineage, entry])
  )
  const broadcasts = new Map(
    reservation.broadcasts.map((entry) => [
      broadcastReservationKey(entry),
      entry,
    ])
  )
  const actions: IdentityBoundActionRecordV1[] = []
  for (let index = 0; index < scenario.steps.length; index++)
  {
    const step = scenario.steps[index]!
    await engine.beginScenarioStep?.(index, step)
    const tick = engine.currentTick()
    switch (step.do)
    {
      case 'greenFlag':
        await engine.greenFlag()
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'clickStage':
        await engine.clickStage()
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'wait':
        await engine.step(step.ticks)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'keyDown':
      case 'pressKey':
        await engine.pressKey(step.key)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'keyUp':
      case 'releaseKey':
        await engine.releaseKey(step.key)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'tapKey':
        await engine.pressKey(step.key)
        await engine.step(step.ticks ?? 1)
        await engine.releaseKey(step.key)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'clickTarget':
      {
        const resolved = targets.get(step.targetLineage)!
        await engine.clickResolvedTarget(resolved)
        actions.push(
          record({
            stepIndex: index,
            do: step.do,
            tick,
            targetLineage: resolved.targetLineage,
          })
        )
        break
      }
      case 'broadcast':
      case 'broadcastAndWait':
      {
        const resolved = broadcasts.get(
          broadcastReservationKey(step.broadcast)
        )!
        const dispatch =
          step.do === 'broadcast'
            ? await engine.broadcastResolved(resolved)
            : await engine.broadcastAndWaitResolved(
                resolved,
                step.maxTicks ?? DEFAULT_WAIT_CAP
              )
        const expectedReceiverTargetLineages = sortedLineages(
          step.broadcast.expectedReceiverTargetLineages
        )
        const provenReceiverTargetLineages = sortedLineages(
          resolved.provenReceiverTargetLineages
        )
        const startedReceiverTargetLineages = sortedLineages(
          dispatch.startedReceiverTargetLineages
        )
        actions.push(
          record({
            stepIndex: index,
            do: step.do,
            tick,
            broadcastLineage: resolved.broadcastLineage,
            concreteName: resolved.name,
            expectedReceiverTargetLineages,
            provenReceiverTargetLineages,
            startedReceiverTargetLineages,
            startedThreadCount: dispatch.startedThreadCount,
          })
        )
        if (
          dispatch.unmappedThreadCount > 0 ||
          (startedReceiverTargetLineages.length !==
            provenReceiverTargetLineages.length ||
            !startedReceiverTargetLineages.every(
              (value, lineageIndex) =>
                value === provenReceiverTargetLineages[lineageIndex]
            ))
        )
          return Object.freeze({
            status: 'inconclusive' as const,
            reservation,
            actions: Object.freeze(actions),
            inconclusive: {
              stepIndex: index,
              do: step.do,
              reason: 'dispatch-receiver-divergence' as const,
              detail: `broadcast "${resolved.name}" started receivers ${JSON.stringify(startedReceiverTargetLineages)} but the proven receiver set is ${JSON.stringify(provenReceiverTargetLineages)} (${dispatch.unmappedThreadCount} unmapped)`,
            },
          })
        break
      }
      case 'moveMouse':
        await engine.moveMouse(step.x, step.y)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'mouseDown':
        await engine.mouseDown(step.x, step.y)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'mouseUp':
        await engine.mouseUp(step.x, step.y)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'typeAnswer':
        await engine.answer(step.text)
        await engine.step(1)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      case 'snapshot':
        await engine.snapshot(step.label)
        actions.push(basicActionRecord(index, step.do, tick))
        break
      default:
      {
        const unknown: never = step
        throw scenarioIssue(
          RUN_ISSUE_CODES.scenarioUnknownStep,
          `unknown identity-bound step: ${JSON.stringify(unknown)}`
        )
      }
    }
  }
  return Object.freeze({
    status: 'complete' as const,
    reservation,
    actions: Object.freeze(actions),
    inconclusive: null,
  })
}
