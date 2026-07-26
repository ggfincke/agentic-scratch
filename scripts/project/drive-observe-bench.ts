// scripts/project/drive-observe-bench.ts
// runs the three-case deterministic headless drive-observe acceptance corpus

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import {
  newRunId,
  withInteractiveBrowserSession,
  type DriveObserveCommandOutcomeV1,
  type DriveObserveCommandRecordV1,
  type DriveObserveSessionLimitsV1,
  type DriveObserveSessionReportV1,
  type DriveObserveSessionV1,
  type RuntimeDescriptorV1,
} from '@scratch-agent/runner'
import {
  admitSb3,
  validateAdmittedSb3,
  type Sb3AdmissionMetrics,
} from '@scratch-agent/sb3'

import { sha256Hex } from '../lib/hash.js'
import {
  createPrivateDirectoryExclusive,
  ensurePrivateDirectory,
  writeExclusivePrivateFile,
} from '../lib/private-fs.js'
import {
  DRIVE_OBSERVE_FIXED_DATE_MS,
  DRIVE_OBSERVE_SEED,
  canonicalJsonArtifactBytes,
  observationArtifact,
  prettyJson,
  runtimeDescriptorHash,
  stableHash,
} from './drive-observe-evidence.js'
import {
  buildDriveObserveHeldInputFixture,
  buildDriveObserveNetworkFixture,
} from './drive-observe-fixtures.js'

const BENCHMARK_ID = 'drive-observe-v1'
const CASE_IDS = [
  'held-input-control-replay',
  'generic-state-only-equivalence',
  'fail-closed-budget-network-cleanup',
] as const
const LIMITS: DriveObserveSessionLimitsV1 = Object.freeze({
  commands: 64,
  ticks: 32,
  observations: 32,
  durationMs: 60_000,
})

interface FixtureEvidence
{
  readonly id: 'held-input' | 'network-denied'
  readonly sha256: string
  readonly byteLength: number
  readonly admission: Sb3AdmissionMetrics
  readonly projectVersion: number
}

interface StableIssue
{
  readonly code: string
  readonly kind: string
  readonly responsibility: string
}

interface StableRecord
{
  readonly sequence: number
  readonly normalizedCommand: unknown
  readonly status: string
  readonly tickBefore: number
  readonly tickAfter: number
  readonly drawEpochBefore: number
  readonly drawEpochAfter: number
  readonly heldInputBefore: unknown
  readonly heldInputAfter: unknown
  readonly changed: boolean
  readonly result: unknown
  readonly issue: StableIssue | null
  readonly budgets: unknown
}

interface StableSession
{
  readonly runtimeDescriptor: RuntimeDescriptorV1
  readonly runtimeDescriptorSha256: string
  readonly records: readonly StableRecord[]
  readonly observationSha256s: readonly string[]
  readonly transcriptSha256: string
  readonly observationSha256: string
  readonly terminal: unknown
  readonly terminalSha256: string
}

interface BenchmarkCaseEvidence
{
  readonly id: (typeof CASE_IDS)[number]
  readonly ok: boolean
  readonly fixtureIds: readonly FixtureEvidence['id'][]
  readonly runtimeDescriptorSha256: string
  readonly transcriptSha256: string
  readonly observationSha256: string
  readonly terminalSha256: string
  readonly observationArtifacts: readonly RetainedObservationIdentity[]
  readonly checks: Readonly<Record<string, boolean>>
  readonly detail: unknown
  readonly caseResultSha256: string
}

interface RetainedObservationIdentity
{
  readonly session: string
  readonly index: number
  readonly sequence: number
  readonly tick: number
  readonly drawEpoch: number
  readonly sha256: string
  readonly byteLength: number
}

interface RetainedObservation
{
  readonly identity: RetainedObservationIdentity
  readonly bytes: Uint8Array
}

interface BenchmarkCaseRun
{
  readonly evidence: BenchmarkCaseEvidence
  readonly observations: readonly RetainedObservation[]
}

interface BenchmarkStableProjection
{
  readonly benchmarkId: typeof BENCHMARK_ID
  readonly sourceRevision: string
  readonly seed: number
  readonly fixedDateMs: number
  readonly limits: DriveObserveSessionLimitsV1
  readonly historicalCollisionCalibration: 'unresolved-not-in-corpus'
  readonly claim: 'generic-generated-fixture-only'
  readonly fixtures: readonly FixtureEvidence[]
  readonly cases: readonly BenchmarkCaseEvidence[]
}

interface BenchmarkReport
{
  readonly schemaVersion: 1
  readonly run: {
    readonly id: string
    readonly root: string
    readonly createdAt: string
    readonly completedAt: string
  }
  readonly stable: BenchmarkStableProjection
  readonly aggregateSha256: string
  readonly ok: boolean
  readonly files: readonly string[]
}

function usageText(): string
{
  return 'usage: npm run drive-observe-bench -- [--runs-root <absolute-dir>]'
}

function parseRunsRoot(argv: readonly string[]): string | 'help'
{
  if (argv.length === 1 && argv[0] === '--help') return 'help'
  if (argv.length === 0) return resolve('runs')
  if (
    argv.length !== 2 ||
    argv[0] !== '--runs-root' ||
    !argv[1] ||
    !isAbsolute(argv[1])
  )
    throw new Error(usageText())
  return resolve(argv[1])
}

function sourceRevision(): string
{
  try
  {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim()
    return dirty ? `${head}+dirty` : head
  }
  catch
  {
    return 'unknown'
  }
}

function command(
  requestId: string,
  sequence: number,
  expectedTick: number,
  commandName: string,
  fields: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>>
{
  return {
    requestId,
    sequence,
    expectedTick,
    command: commandName,
    ...fields,
  }
}

function commandRecord(
  outcome: DriveObserveCommandOutcomeV1
): DriveObserveCommandRecordV1
{
  if (outcome.kind !== 'command')
    throw new Error(`command terminalized before record: ${outcome.issue.code}`)
  return outcome.record
}

function stableIssue(
  issue: DriveObserveCommandRecordV1['issue']
): StableIssue | null
{
  return issue === null
    ? null
    : {
        code: issue.code,
        kind: issue.kind,
        responsibility: issue.responsibility,
      }
}

function stableResult(record: DriveObserveCommandRecordV1): unknown
{
  if (record.result?.kind !== 'observation') return record.result
  return {
    kind: 'observation',
    label: record.result.label,
    capture: {
      status: record.result.capture.status,
      totals: record.result.capture.totals,
      valueSha256:
        record.result.capture.status === 'observed'
          ? stableHash(record.result.capture.value)
          : null,
      issue:
        record.result.capture.status === 'refused'
          ? record.result.capture.issue
          : null,
    },
  }
}

function stableRecord(record: DriveObserveCommandRecordV1): StableRecord
{
  return {
    sequence: record.sequence,
    normalizedCommand: record.normalizedCommand,
    status: record.status,
    tickBefore: record.tickBefore,
    tickAfter: record.tickAfter,
    drawEpochBefore: record.drawEpochBefore,
    drawEpochAfter: record.drawEpochAfter,
    heldInputBefore: record.heldInputBefore,
    heldInputAfter: record.heldInputAfter,
    changed: record.changed,
    result: stableResult(record),
    issue: stableIssue(record.issue),
    budgets: record.budgets,
  }
}

function stableCleanup(
  report: DriveObserveSessionReportV1
): readonly unknown[]
{
  return report.cleanupActions.map((action) => ({
    command: action.command,
    heldInputBefore: action.heldInputBefore,
    heldInputAfter: action.heldInputAfter,
    drawEpochBefore: action.drawEpochBefore,
    drawEpochAfter: action.drawEpochAfter,
    issue: stableIssue(action.issue),
  }))
}

function stableTerminal(report: DriveObserveSessionReportV1): unknown
{
  return {
    state: report.state,
    terminalReason: report.terminalReason,
    tick: report.tick,
    drawEpoch: report.drawEpoch,
    runtimePositionConfirmed: report.runtimePositionConfirmed,
    heldInput: report.heldInput,
    budgets: report.budgets,
    cleanupActions: stableCleanup(report),
    issues: report.issues.map((issue) => ({
      code: issue.code,
      kind: issue.kind,
      responsibility: issue.responsibility,
    })),
    droppedIssues: report.droppedIssues,
  }
}

function observationValues(
  records: readonly DriveObserveCommandRecordV1[]
): readonly unknown[]
{
  return records.flatMap((record) =>
    record.result?.kind === 'observation' &&
    record.result.capture.status === 'observed'
      ? [record.result.capture.value]
      : []
  )
}

function retainedObservations(
  session: string,
  records: readonly DriveObserveCommandRecordV1[]
): RetainedObservation[]
{
  return records.flatMap((record, index) =>
  {
    const value = observationArtifact(record)
    if (value === null) return []
    const bytes = canonicalJsonArtifactBytes(value)
    return [
      {
        identity: {
          session,
          index,
          sequence: record.sequence,
          tick: record.tickAfter,
          drawEpoch: record.drawEpochAfter,
          sha256: sha256Hex(bytes),
          byteLength: bytes.byteLength,
        },
        bytes,
      },
    ]
  })
}

function stableSession(
  descriptor: RuntimeDescriptorV1,
  records: readonly DriveObserveCommandRecordV1[],
  report: DriveObserveSessionReportV1
): StableSession
{
  const projectedRecords = records.map(stableRecord)
  const observationSha256s = observationValues(records).map(stableHash)
  const terminal = stableTerminal(report)
  return {
    runtimeDescriptor: descriptor,
    runtimeDescriptorSha256: runtimeDescriptorHash(descriptor)!,
    records: projectedRecords,
    observationSha256s,
    transcriptSha256: stableHash(projectedRecords),
    observationSha256: stableHash(observationSha256s),
    terminal,
    terminalSha256: stableHash(terminal),
  }
}

async function runCommands(
  sb3: Uint8Array,
  inputs: readonly Readonly<Record<string, unknown>>[],
  limits: Partial<DriveObserveSessionLimitsV1> = LIMITS
): Promise<
  StableSession & {
    readonly rawRecords: readonly DriveObserveCommandRecordV1[]
  }
>
{
  let descriptor: RuntimeDescriptorV1 | null = null
  const outcome = await withInteractiveBrowserSession(
    {
      sb3,
      headless: true,
      pacing: 'instant',
      seed: DRIVE_OBSERVE_SEED,
      fixedDateMs: DRIVE_OBSERVE_FIXED_DATE_MS,
      limits,
    },
    async (session) =>
    {
      descriptor = session.ready.runtimeDescriptor
      const records: DriveObserveCommandRecordV1[] = []
      for (const input of inputs)
        records.push(commandRecord(await session.execute(input)))
      return records
    }
  )
  if (outcome.callback.status !== 'completed' || descriptor === null)
    throw new Error(
      `headless benchmark session failed: ${outcome.callback.status}`
    )
  return {
    ...stableSession(descriptor, outcome.callback.value, outcome.report),
    rawRecords: outcome.callback.value,
  }
}

function retainedSession(
  session: StableSession & {
    readonly rawRecords: readonly DriveObserveCommandRecordV1[]
  }
): StableSession
{
  const { rawRecords: _rawRecords, ...stable } = session
  return stable
}

function observationRecord(
  records: readonly DriveObserveCommandRecordV1[],
  label: string
): DriveObserveCommandRecordV1
{
  const found = records.find(
    (record) =>
      record.result?.kind === 'observation' && record.result.label === label
  )
  if (!found) throw new Error(`missing observation ${label}`)
  return found
}

function stateProjection(record: DriveObserveCommandRecordV1): unknown
{
  if (
    record.result?.kind !== 'observation' ||
    record.result.capture.status !== 'observed'
  )
    throw new Error('state projection requires one observed record')
  const value = structuredClone(
    record.result.capture.value
  ) as unknown as Record<string, unknown>
  const state = value.state as Record<string, unknown>
  const cloneCounts = value.cloneCounts as Record<string, unknown>
  delete state.label
  delete cloneCounts.snapshotLabel
  delete cloneCounts.scenarioStepIndex
  return {
    state,
    cloneCounts,
    cloneIdentityIssues: value.cloneIdentityIssues,
    supplemental: value.supplemental,
    heldInput: record.heldInputAfter,
  }
}

function observationsAreNeutral(
  records: readonly DriveObserveCommandRecordV1[]
): boolean
{
  return records
    .filter((record) => record.result?.kind === 'observation')
    .every(
      (record) =>
        record.tickBefore === record.tickAfter &&
        record.drawEpochBefore === record.drawEpochAfter &&
        record.changed === false
    )
}

function taggedFiniteNumber(value: unknown): number
{
  const scalar = value as {
    readonly scalarKind?: unknown
    readonly value?: { readonly numberKind?: unknown; readonly value?: unknown }
  }
  if (
    scalar.scalarKind !== 'number' ||
    scalar.value?.numberKind !== 'finite' ||
    typeof scalar.value.value !== 'number'
  )
    throw new Error('expected one finite tagged number')
  return scalar.value.value
}

function observedMover(record: DriveObserveCommandRecordV1): {
  readonly x: number
  readonly heldTicks: number
}
{
  if (
    record.result?.kind !== 'observation' ||
    record.result.capture.status !== 'observed'
  )
    throw new Error('mover projection requires one observed record')
  const value = record.result.capture.value as unknown as {
    readonly state: {
      readonly targetsById: Readonly<
        Record<
          string,
          {
            readonly name: { readonly value?: unknown }
            readonly x: unknown
            readonly variables: Readonly<
              Record<
                string,
                {
                  readonly name: { readonly value?: unknown }
                  readonly value: unknown
                }
              >
            >
          }
        >
      >
    }
  }
  const mover = Object.values(value.state.targetsById).find(
    (target) => target.name.value === 'Mover'
  )
  if (!mover) throw new Error('observed fixture has no Mover')
  const held = Object.values(mover.variables).find(
    (variable) => variable.name.value === 'heldTicks'
  )
  if (!held) throw new Error('observed fixture has no heldTicks variable')
  return {
    x: taggedFiniteNumber(mover.x),
    heldTicks: taggedFiniteNumber(held.value),
  }
}

function caseEvidence(
  input: Omit<BenchmarkCaseEvidence, 'caseResultSha256'>
): BenchmarkCaseEvidence
{
  return {
    ...input,
    caseResultSha256: stableHash(input),
  }
}

function contextualizeCase(
  entry: BenchmarkCaseEvidence,
  revision: string,
  fixtures: readonly FixtureEvidence[]
): BenchmarkCaseEvidence
{
  const { caseResultSha256: _caseResultSha256, ...projection } = entry
  const fixtureEvidence = fixtures.filter((fixture) =>
    entry.fixtureIds.includes(fixture.id)
  )
  return {
    ...projection,
    caseResultSha256: stableHash({
      sourceRevision: revision,
      seed: DRIVE_OBSERVE_SEED,
      fixedDateMs: DRIVE_OBSERVE_FIXED_DATE_MS,
      limits: LIMITS,
      fixtures: fixtureEvidence,
      case: projection,
    }),
  }
}

async function heldInputCase(sb3: Uint8Array): Promise<BenchmarkCaseRun>
{
  const inputs = [
    command('held-g', 0, 0, 'greenFlag'),
    command('held-kd', 1, 0, 'keyDown', { key: 'right' }),
    command('held-kd-repeat', 2, 0, 'keyDown', { key: 'right' }),
    command('held-a3', 3, 0, 'advance', { ticks: 3 }),
    command('held-o3', 4, 3, 'observe', { label: 'held-3' }),
    command('held-a2', 5, 3, 'advance', { ticks: 2 }),
    command('held-ku', 6, 5, 'keyUp', { key: 'right' }),
    command('held-ku-repeat', 7, 5, 'keyUp', { key: 'right' }),
    command('held-a7', 8, 5, 'advance', { ticks: 2 }),
    command('held-o7', 9, 7, 'observe', { label: 'released-7' }),
    command('held-close', 10, 7, 'close'),
  ]
  const control = await runCommands(sb3, inputs)
  const replay = await runCommands(sb3, inputs)
  const held = observationRecord(control.rawRecords, 'held-3')
  const released = observationRecord(control.rawRecords, 'released-7')
  const observations = [
    ...retainedObservations('control', control.rawRecords),
    ...retainedObservations('replay', replay.rawRecords),
  ]
  const controlTerminal = control.terminal as {
    readonly state?: unknown
    readonly heldInput?: {
      readonly keys?: readonly string[]
      readonly mouse?: { readonly leftDown?: boolean }
    }
  }
  const checks = {
    exactReplayTranscript: control.transcriptSha256 === replay.transcriptSha256,
    exactReplayObservations:
      control.observationSha256 === replay.observationSha256,
    exactReplayTerminal: control.terminalSha256 === replay.terminalSha256,
    idempotentEdges:
      control.rawRecords[2]?.changed === false &&
      control.rawRecords[7]?.changed === false,
    heldMovement:
      stableHash(observedMover(held)) === stableHash({ x: 13, heldTicks: 3 }),
    releasedMovement:
      stableHash(observedMover(released)) ===
      stableHash({ x: 15, heldTicks: 5 }),
    neutralObservations: observationsAreNeutral(control.rawRecords),
    cleanTerminal:
      controlTerminal.state === 'closed' &&
      controlTerminal.heldInput?.keys?.length === 0 &&
      controlTerminal.heldInput.mouse?.leftDown === false,
  }
  return {
    evidence: caseEvidence({
      id: CASE_IDS[0],
      ok: Object.values(checks).every(Boolean),
      fixtureIds: ['held-input'],
      runtimeDescriptorSha256: control.runtimeDescriptorSha256,
      transcriptSha256: stableHash([
        control.transcriptSha256,
        replay.transcriptSha256,
      ]),
      observationSha256: stableHash([
        control.observationSha256,
        replay.observationSha256,
      ]),
      terminalSha256: stableHash([
        control.terminalSha256,
        replay.terminalSha256,
      ]),
      observationArtifacts: observations.map((entry) => entry.identity),
      checks,
      detail: {
        control: retainedSession(control),
        replay: retainedSession(replay),
        held: observedMover(held),
        released: observedMover(released),
      },
    }),
    observations,
  }
}

function sparseCommands(): readonly Readonly<Record<string, unknown>>[]
{
  return [
    command('s-g', 0, 0, 'greenFlag'),
    command('s-kd', 1, 0, 'keyDown', { key: 'right' }),
    command('s-a6', 2, 0, 'advance', { ticks: 6 }),
    command('s-o6', 3, 6, 'observe', { label: 'shared-6' }),
    command('s-a12', 4, 6, 'advance', { ticks: 6 }),
    command('s-o12', 5, 12, 'observe', { label: 'shared-12' }),
    command('s-ku', 6, 12, 'keyUp', { key: 'right' }),
    command('s-a15', 7, 12, 'advance', { ticks: 3 }),
    command('s-o15', 8, 15, 'observe', { label: 'shared-15' }),
    command('s-close', 9, 15, 'close'),
  ]
}

function denseCommands(): readonly Readonly<Record<string, unknown>>[]
{
  const inputs: Readonly<Record<string, unknown>>[] = [
    command('d-g', 0, 0, 'greenFlag'),
    command('d-kd', 1, 0, 'keyDown', { key: 'right' }),
  ]
  let sequence = 2
  for (let tick = 1; tick <= 12; tick++)
  {
    inputs.push(
      command(`d-a${tick}`, sequence++, tick - 1, 'advance', {
        ticks: 1,
      })
    )
    inputs.push(
      command(`d-o${tick}`, sequence++, tick, 'observe', {
        label: `dense-${tick}`,
      })
    )
  }
  inputs.push(command('d-ku', sequence++, 12, 'keyUp', { key: 'right' }))
  for (let tick = 13; tick <= 15; tick++)
  {
    inputs.push(
      command(`d-a${tick}`, sequence++, tick - 1, 'advance', {
        ticks: 1,
      })
    )
    inputs.push(
      command(`d-o${tick}`, sequence++, tick, 'observe', {
        label: `dense-${tick}`,
      })
    )
  }
  inputs.push(command('d-close', sequence, 15, 'close'))
  return inputs
}

async function equivalenceCase(sb3: Uint8Array): Promise<BenchmarkCaseRun>
{
  const sparse = await runCommands(sb3, sparseCommands())
  const dense = await runCommands(sb3, denseCommands())
  const shared = [6, 12, 15].map((tick) =>
  {
    const sparseRecord = observationRecord(sparse.rawRecords, `shared-${tick}`)
    const denseRecord = observationRecord(dense.rawRecords, `dense-${tick}`)
    return {
      tick,
      sparseSha256: stableHash(stateProjection(sparseRecord)),
      denseSha256: stableHash(stateProjection(denseRecord)),
    }
  })
  const observations = [
    ...retainedObservations('sparse', sparse.rawRecords),
    ...retainedObservations('dense', dense.rawRecords),
  ]
  const checks = {
    sharedStateEqual: shared.every(
      (checkpoint) => checkpoint.sparseSha256 === checkpoint.denseSha256
    ),
    sparseObservationsNeutral: observationsAreNeutral(sparse.rawRecords),
    denseObservationsNeutral: observationsAreNeutral(dense.rawRecords),
    runtimeDescriptorEqual:
      sparse.runtimeDescriptorSha256 === dense.runtimeDescriptorSha256,
    terminalStateEqual:
      stableHash(
        stateProjection(observationRecord(sparse.rawRecords, 'shared-15'))
      ) ===
      stableHash(
        stateProjection(observationRecord(dense.rawRecords, 'dense-15'))
      ),
    noIssues:
      (sparse.terminal as { issues?: readonly unknown[] }).issues?.length ===
        0 &&
      (dense.terminal as { issues?: readonly unknown[] }).issues?.length === 0,
  }
  return {
    evidence: caseEvidence({
      id: CASE_IDS[1],
      ok: Object.values(checks).every(Boolean),
      fixtureIds: ['held-input'],
      runtimeDescriptorSha256: sparse.runtimeDescriptorSha256,
      transcriptSha256: stableHash([
        sparse.transcriptSha256,
        dense.transcriptSha256,
      ]),
      observationSha256: stableHash([
        sparse.observationSha256,
        dense.observationSha256,
      ]),
      terminalSha256: stableHash([sparse.terminalSha256, dense.terminalSha256]),
      observationArtifacts: observations.map((entry) => entry.identity),
      checks,
      detail: {
        historicalCollisionCalibration: 'unresolved-not-in-corpus',
        claim: 'generic-generated-fixture-only',
        shared,
        sparse: retainedSession(sparse),
        dense: retainedSession(dense),
      },
    }),
    observations,
  }
}

async function networkTerminal(
  session: DriveObserveSessionV1
): Promise<string>
{
  let timer: NodeJS.Timeout | null = null
  try
  {
    const issue = await Promise.race([
      session.terminal,
      new Promise<never>((_resolve, reject) =>
      {
        timer = setTimeout(
          () => reject(new Error('network terminal issue timed out')),
          5_000
        )
      }),
    ])
    return issue.code
  }
  finally
  {
    if (timer) clearTimeout(timer)
  }
}

async function failClosedCase(
  heldSb3: Uint8Array,
  networkSb3: Uint8Array
): Promise<BenchmarkCaseRun>
{
  const tick = await runCommands(
    heldSb3,
    [
      command('t-kd', 0, 0, 'keyDown', { key: 'right' }),
      command('t-md', 1, 0, 'mouseDown', {
        x: 5,
        y: 6,
        button: 'left',
      }),
      command('t-a2', 2, 0, 'advance', { ticks: 2 }),
      command('t-a1', 3, 2, 'advance', { ticks: 1 }),
    ],
    { commands: 8, ticks: 2, observations: 2, durationMs: 60_000 }
  )
  const observation = await runCommands(
    heldSb3,
    [command('o-1', 0, 0, 'observe'), command('o-2', 1, 0, 'observe')],
    { commands: 4, ticks: 2, observations: 1, durationMs: 60_000 }
  )

  let networkDescriptor: RuntimeDescriptorV1 | null = null
  const networkOutcome = await withInteractiveBrowserSession(
    {
      sb3: networkSb3,
      headless: true,
      pacing: 'instant',
      seed: DRIVE_OBSERVE_SEED,
      fixedDateMs: DRIVE_OBSERVE_FIXED_DATE_MS,
      limits: LIMITS,
    },
    async (session) =>
    {
      networkDescriptor = session.ready.runtimeDescriptor
      const green = commandRecord(
        await session.execute(command('n-g', 0, 0, 'greenFlag'))
      )
      const advance = commandRecord(
        await session.execute(command('n-a', 1, 0, 'advance', { ticks: 5 }))
      )
      return {
        records: [green, advance],
        terminalCode: await networkTerminal(session),
      }
    }
  )
  if (
    networkOutcome.callback.status !== 'completed' ||
    networkDescriptor === null
  )
    throw new Error('network benchmark callback did not complete')
  const network = stableSession(
    networkDescriptor,
    networkOutcome.callback.value.records,
    networkOutcome.report
  )
  const tickFailure = tick.rawRecords.at(-1)!
  const observationFailure = observation.rawRecords.at(-1)!
  const tickTerminal = tick.terminal as {
    readonly heldInput?: {
      readonly keys?: readonly string[]
      readonly mouse?: { readonly leftDown?: boolean }
    }
    readonly cleanupActions?: readonly {
      readonly command?: { readonly command?: unknown }
      readonly drawEpochBefore?: unknown
      readonly drawEpochAfter?: unknown
      readonly issue?: unknown
    }[]
  }
  const observations = [
    ...retainedObservations('tick-budget', tick.rawRecords),
    ...retainedObservations('observation-budget', observation.rawRecords),
    ...retainedObservations(
      'network-denied',
      networkOutcome.callback.value.records
    ),
  ]
  const cleanup = tickTerminal.cleanupActions ?? []
  const checks = {
    tickBudgetFailed:
      tickFailure.status === 'failed' &&
      tickFailure.issue?.code === 'runner.tick-budget.exceeded' &&
      tickFailure.tickBefore === tickFailure.tickAfter,
    observationBudgetFailedWithoutPartial:
      observationFailure.status === 'failed' &&
      observationFailure.issue?.code ===
        'runner.drive-observe.observation-budget-exceeded' &&
      observationFailure.result === null,
    deniedNetworkTerminal:
      networkOutcome.callback.value.terminalCode ===
        'runner.network.request-denied' &&
      networkOutcome.report.state === 'failed',
    heldInputReleased:
      tickTerminal.heldInput?.keys?.length === 0 &&
      tickTerminal.heldInput.mouse?.leftDown === false,
    cleanupRecorded:
      stableHash(cleanup.map((action) => action.command?.command)) ===
        stableHash(['keyUp', 'mouseUp']) &&
      cleanup.every(
        (action) =>
          action.drawEpochBefore === action.drawEpochAfter &&
          action.issue === null
      ),
    runtimeDescriptorsAgree:
      tick.runtimeDescriptorSha256 === observation.runtimeDescriptorSha256 &&
      tick.runtimeDescriptorSha256 === runtimeDescriptorHash(networkDescriptor),
  }
  return {
    evidence: caseEvidence({
      id: CASE_IDS[2],
      ok: Object.values(checks).every(Boolean),
      fixtureIds: ['held-input', 'network-denied'],
      runtimeDescriptorSha256: tick.runtimeDescriptorSha256,
      transcriptSha256: stableHash([
        tick.transcriptSha256,
        observation.transcriptSha256,
        network.transcriptSha256,
      ]),
      observationSha256: stableHash([
        tick.observationSha256,
        observation.observationSha256,
        network.observationSha256,
      ]),
      terminalSha256: stableHash([
        tick.terminalSha256,
        observation.terminalSha256,
        network.terminalSha256,
      ]),
      observationArtifacts: observations.map((entry) => entry.identity),
      checks,
      detail: {
        tick: retainedSession(tick),
        observation: retainedSession(observation),
        network,
        networkTerminalCode: networkOutcome.callback.value.terminalCode,
      },
    }),
    observations,
  }
}

async function fixtureEvidence(
  id: FixtureEvidence['id'],
  bytes: Uint8Array
): Promise<FixtureEvidence>
{
  const admitted = await admitSb3(bytes)
  const validation = await validateAdmittedSb3(bytes)
  if (!validation.ok)
    throw new Error(`${id} fixture failed admission: ${validation.errors}`)
  return {
    id,
    sha256: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    admission: admitted.metrics,
    projectVersion: validation.projectVersion,
  }
}

function reportMarkdown(report: BenchmarkReport): string
{
  return [
    '# Drive-observe deterministic benchmark',
    '',
    `**${report.ok ? 'PASS' : 'FAIL'} — ${report.stable.cases.filter((entry) => entry.ok).length}/3 cases**`,
    '',
    `- aggregate: \`${report.aggregateSha256}\``,
    `- source revision: \`${report.stable.sourceRevision}\``,
    `- historical collision calibration: \`${report.stable.historicalCollisionCalibration}\``,
    `- claim: \`${report.stable.claim}\``,
    '',
    '## Cases',
    '',
    ...report.stable.cases.map(
      (entry) =>
        `- ${entry.ok ? 'PASS' : 'FAIL'} \`${entry.id}\`: \`${entry.caseResultSha256}\``
    ),
    '',
    'This corpus is headless and deterministic. It uses no agent, model, VLM,',
    'provider credential, selected personal artifact, screenshot, or visual claim.',
    '',
  ].join('\n')
}

async function main(): Promise<void>
{
  const parsed = parseRunsRoot(process.argv.slice(2))
  if (parsed === 'help')
  {
    process.stdout.write(`${usageText()}\n`)
    return
  }
  const runsRoot = parsed
  if (existsSync(runsRoot))
  {
    const stat = lstatSync(runsRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('benchmark runs root must be one non-symlink directory')
    ensurePrivateDirectory(runsRoot)
  }
  else ensurePrivateDirectory(runsRoot)
  const runId = `drive-observe-bench-${newRunId()}`
  const root = join(runsRoot, runId)
  const fixturesRoot = join(root, 'fixtures')
  const casesRoot = join(root, 'cases')
  createPrivateDirectoryExclusive(root)
  createPrivateDirectoryExclusive(fixturesRoot)
  createPrivateDirectoryExclusive(casesRoot)
  const createdAt = new Date().toISOString()

  const heldSb3 = await buildDriveObserveHeldInputFixture()
  const networkSb3 = await buildDriveObserveNetworkFixture()
  const fixtures = [
    await fixtureEvidence('held-input', heldSb3),
    await fixtureEvidence('network-denied', networkSb3),
  ]
  writeExclusivePrivateFile(join(fixturesRoot, 'held-input.sb3'), heldSb3)
  writeExclusivePrivateFile(
    join(fixturesRoot, 'network-denied.sb3'),
    networkSb3
  )
  writeExclusivePrivateFile(
    join(fixturesRoot, 'identities.json'),
    prettyJson(fixtures)
  )

  const revision = sourceRevision()
  const caseRuns = [
    await heldInputCase(heldSb3),
    await equivalenceCase(heldSb3),
    await failClosedCase(heldSb3, networkSb3),
  ]
  const cases = caseRuns.map((entry) =>
    contextualizeCase(entry.evidence, revision, fixtures)
  )
  const caseFiles: string[] = []
  for (let index = 0; index < cases.length; index++)
  {
    const entry = cases[index]!
    const run = caseRuns[index]!
    const caseRoot = join(casesRoot, entry.id)
    const observationRoot = join(caseRoot, 'observations')
    createPrivateDirectoryExclusive(caseRoot)
    createPrivateDirectoryExclusive(observationRoot)
    const evidencePath = `cases/${entry.id}/evidence.json`
    writeExclusivePrivateFile(
      join(caseRoot, 'evidence.json'),
      prettyJson(entry)
    )
    caseFiles.push(evidencePath)
    for (const observation of run.observations)
    {
      const name = `${observation.identity.session}-${String(
        observation.identity.index
      ).padStart(4, '0')}.json`
      writeExclusivePrivateFile(join(observationRoot, name), observation.bytes)
      caseFiles.push(`cases/${entry.id}/observations/${name}`)
    }
  }
  const stable: BenchmarkStableProjection = {
    benchmarkId: BENCHMARK_ID,
    sourceRevision: revision,
    seed: DRIVE_OBSERVE_SEED,
    fixedDateMs: DRIVE_OBSERVE_FIXED_DATE_MS,
    limits: LIMITS,
    historicalCollisionCalibration: 'unresolved-not-in-corpus',
    claim: 'generic-generated-fixture-only',
    fixtures,
    cases,
  }
  const aggregateSha256 = stableHash(stable)
  const files = [
    'fixtures/held-input.sb3',
    'fixtures/network-denied.sb3',
    'fixtures/identities.json',
    ...caseFiles,
    'report.md',
    'report.json',
  ]
  const report: BenchmarkReport = {
    schemaVersion: 1,
    run: {
      id: runId,
      root,
      createdAt,
      completedAt: new Date().toISOString(),
    },
    stable,
    aggregateSha256,
    ok: cases.every((entry) => entry.ok),
    files,
  }
  writeExclusivePrivateFile(join(root, 'report.md'), reportMarkdown(report))
  writeExclusivePrivateFile(join(root, 'report.json'), prettyJson(report))
  process.stdout.write(
    `${JSON.stringify({
      benchmarkId: BENCHMARK_ID,
      ok: report.ok,
      runRoot: root,
      sourceRevision: stable.sourceRevision,
      historicalCollisionCalibration: stable.historicalCollisionCalibration,
      claim: stable.claim,
      runtimeDescriptorSha256: cases[0]?.runtimeDescriptorSha256 ?? null,
      fixtureSha256s: fixtures.map((entry) => entry.sha256),
      transcriptSha256s: cases.map((entry) => entry.transcriptSha256),
      observationSha256s: cases.map((entry) => entry.observationSha256),
      terminalSha256s: cases.map((entry) => entry.terminalSha256),
      caseResultSha256s: cases.map((entry) => entry.caseResultSha256),
      aggregateSha256,
      agentExecutions: 0,
      modelCalls: 0,
      visualCaptures: 0,
    })}\n`
  )
  if (!report.ok) process.exitCode = 1
}

void main().catch((error: unknown) =>
{
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
})
