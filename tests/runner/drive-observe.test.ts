// tests/runner/drive-observe.test.ts
// major drive-observe acceptance for input, neutral reads, policy, & replay

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import {
  withInteractiveBrowserSession,
  type DriveObserveCommandOutcomeV1,
  type DriveObserveCommandRecordV1,
  type DriveObserveSessionReportV1,
  type DriveObserveSessionV1,
  type InteractiveBrowserSessionOptionsV1,
} from '@scratch-agent/runner'

import {
  buildDriveObserveHeldInputFixture,
  buildDriveObserveNetworkFixture,
} from '../../scripts/project/drive-observe-fixtures.js'

const REPOSITORY_ROOT = join(import.meta.dirname, '../..')

function stableHash(value: unknown): string
{
  return createHash('sha256').update(canonicalJsonBytesV1(value)).digest('hex')
}

function command(
  requestId: string,
  sequence: number,
  expectedTick: number,
  commandName: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown>
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
  assert.equal(outcome.kind, 'command')
  return outcome.record
}

function stableRecord(record: DriveObserveCommandRecordV1): unknown
{
  const { requestId: _requestId, durationMs: _durationMs, ...stable } = record
  return stable
}

function stableReport(report: DriveObserveSessionReportV1): unknown
{
  return {
    state: report.state,
    terminalReason: report.terminalReason,
    tick: report.tick,
    drawEpoch: report.drawEpoch,
    runtimePositionConfirmed: report.runtimePositionConfirmed,
    heldInput: report.heldInput,
    budgets: report.budgets,
    records: report.records.map(stableRecord),
    cleanupActions: report.cleanupActions,
    issues: report.issues.map((issue) => ({
      code: issue.code,
      kind: issue.kind,
      responsibility: issue.responsibility,
    })),
    droppedIssues: report.droppedIssues,
  }
}

function sessionOptions(
  sb3: Uint8Array,
  limits: InteractiveBrowserSessionOptionsV1['limits'] = {},
  pacing: InteractiveBrowserSessionOptionsV1['pacing'] = 'instant'
): InteractiveBrowserSessionOptionsV1
{
  return {
    sb3,
    headless: true,
    pacing,
    seed: 0,
    fixedDateMs: 0,
    limits,
  }
}

function dataRecord(value: unknown): Record<string, unknown>
{
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value)
  )
  return value as Record<string, unknown>
}

function scalar(value: unknown): string | number | boolean
{
  const record = dataRecord(value)
  assert.ok(
    record.scalarKind === 'string' ||
      record.scalarKind === 'number' ||
      record.scalarKind === 'boolean'
  )
  if (record.scalarKind === 'number')
  {
    const number = dataRecord(record.value)
    assert.equal(number.numberKind, 'finite')
    assert.equal(typeof number.value, 'number')
    return number.value as number
  }
  assert.ok(
    typeof record.value === 'string' || typeof record.value === 'boolean'
  )
  return record.value as string | boolean
}

function observationValue(
  record: DriveObserveCommandRecordV1
): Record<string, unknown>
{
  assert.equal(record.result?.kind, 'observation')
  assert.equal(record.result.capture.status, 'observed')
  return record.result.capture.value as unknown as Record<string, unknown>
}

function observedMover(record: DriveObserveCommandRecordV1): {
  x: number
  heldTicks: number
}
{
  const observation = observationValue(record)
  const state = dataRecord(observation.state)
  const targets = dataRecord(state.targetsById)
  const mover = Object.values(targets)
    .map(dataRecord)
    .find((target) => scalar(target.name) === 'Mover')
  assert.ok(mover)
  const variables = dataRecord(mover.variables)
  const held = Object.values(variables)
    .map(dataRecord)
    .find((entry) => scalar(entry.name) === 'heldTicks')
  assert.ok(held)
  return {
    x: scalar(mover.x) as number,
    heldTicks: scalar(held.value) as number,
  }
}

function observationLabel(record: DriveObserveCommandRecordV1): string | null
{
  assert.equal(record.result?.kind, 'observation')
  return record.result.label
}

function decodeTagged(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(decodeTagged)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (Object.hasOwn(record, 'scalarKind') && Object.hasOwn(record, 'value'))
    return record.value
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodeTagged(entry)])
  )
}

function sharedObservationProjection(
  record: DriveObserveCommandRecordV1
): unknown
{
  const value = observationValue(record)
  const cloneCounts = dataRecord(decodeTagged(value.cloneCounts))
  const {
    scenarioStepIndex: _scenarioStepIndex,
    snapshotLabel: _snapshotLabel,
    ...stableCloneCounts
  } = cloneCounts
  return {
    state: value.state,
    cloneCounts: stableCloneCounts,
    supplemental: decodeTagged(value.supplemental),
    cloneIdentityIssues: value.cloneIdentityIssues,
  }
}

function assertNoVisualFields(value: unknown): void
{
  const forbidden = new Set([
    'visual',
    'geometry',
    'spriterects',
    'grid',
    'pixels',
    'screenshot',
    'screenshots',
    'instanceindex',
  ])
  const visit = (entry: unknown): void =>
  {
    if (Array.isArray(entry))
    {
      entry.forEach(visit)
      return
    }
    if (entry === null || typeof entry !== 'object') return
    for (const [key, nested] of Object.entries(
      entry as Record<string, unknown>
    ))
    {
      assert.equal(forbidden.has(key.toLowerCase()), false, key)
      visit(nested)
    }
  }
  visit(value)
}

async function runHeldTranscript(
  sb3: Uint8Array,
  requestPrefix: string
): Promise<{
  records: DriveObserveCommandRecordV1[]
  report: DriveObserveSessionReportV1
}>
{
  const outcome = await withInteractiveBrowserSession(
    sessionOptions(sb3),
    async (session) =>
    {
      const inputs = [
        command(`${requestPrefix}-g`, 0, 0, 'greenFlag'),
        command(`${requestPrefix}-kd`, 1, 0, 'keyDown', { key: 'right' }),
        command(`${requestPrefix}-kd-repeat`, 2, 0, 'keyDown', {
          key: 'right',
        }),
        command(`${requestPrefix}-advance-3`, 3, 0, 'advance', { ticks: 3 }),
        command(`${requestPrefix}-held`, 4, 3, 'observe', {
          label: 'held-3',
        }),
        command(`${requestPrefix}-advance-2`, 5, 3, 'advance', { ticks: 2 }),
        command(`${requestPrefix}-before-release`, 6, 5, 'observe', {
          label: 'before-release-5',
        }),
        command(`${requestPrefix}-ku`, 7, 5, 'keyUp', { key: 'right' }),
        command(`${requestPrefix}-ku-repeat`, 8, 5, 'keyUp', {
          key: 'right',
        }),
        command(`${requestPrefix}-released-advance`, 9, 5, 'advance', {
          ticks: 2,
        }),
        command(`${requestPrefix}-released`, 10, 7, 'observe', {
          label: 'released-7',
        }),
        command(`${requestPrefix}-close`, 11, 7, 'close'),
      ]
      const records: DriveObserveCommandRecordV1[] = []
      for (const input of inputs)
        records.push(commandRecord(await session.execute(input)))
      return records
    }
  )
  assert.equal(outcome.callback.status, 'completed')
  return { records: outcome.callback.value, report: outcome.report }
}

function runCli(
  script: 'drive-observe' | 'drive-observe-replay',
  args: readonly string[],
  input = ''
): { exit: number | null; stdout: string; stderr: string }
{
  const result = spawnSync('npm', ['--silent', 'run', script, '--', ...args], {
    cwd: REPOSITORY_ROOT,
    input,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  return {
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function cliLines(stdout: string): Array<Record<string, unknown>>
{
  if (stdout === '') return []
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function temporaryRoot(t: TestContext): string
{
  const root = mkdtempSync(join(tmpdir(), 'drive-observe-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

async function terminalWithin(session: DriveObserveSessionV1): Promise<string>
{
  let timer: NodeJS.Timeout | undefined
  try
  {
    const issue = await Promise.race([
      session.terminal,
      new Promise<never>((_resolve, reject) =>
      {
        timer = setTimeout(
          () => reject(new Error('session terminal issue timed out')),
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

test('T1 held input, idempotency, cleanup, identities, and replay are deterministic', async (t) =>
{
  const sb3 = await buildDriveObserveHeldInputFixture()
  const first = await runHeldTranscript(sb3, 'first')
  const second = await runHeldTranscript(sb3, 'second')

  assert.equal(first.records[1]?.changed, true)
  assert.equal(first.records[2]?.changed, false)
  assert.deepEqual(
    [first.records[2]?.tickBefore, first.records[2]?.tickAfter],
    [0, 0]
  )
  assert.deepEqual(
    [first.records[2]?.drawEpochBefore, first.records[2]?.drawEpochAfter],
    [0, 0]
  )
  assert.equal(first.records[7]?.changed, true)
  assert.equal(first.records[8]?.changed, false)

  const held = first.records[4]!
  const beforeRelease = first.records[6]!
  const released = first.records[10]!
  assert.deepEqual([held.tickBefore, held.tickAfter], [3, 3])
  assert.deepEqual([held.drawEpochBefore, held.drawEpochAfter], [3, 3])
  const heldState = observedMover(held)
  const beforeReleaseState = observedMover(beforeRelease)
  const releasedState = observedMover(released)
  assert.ok(heldState.heldTicks > 0)
  assert.ok(beforeReleaseState.x > heldState.x)
  assert.ok(beforeReleaseState.heldTicks > heldState.heldTicks)
  assert.deepEqual(held.heldInputAfter.keys, ['ArrowRight'])
  assert.deepEqual([released.tickBefore, released.tickAfter], [7, 7])
  assert.deepEqual([released.drawEpochBefore, released.drawEpochAfter], [7, 7])
  assert.deepEqual(releasedState, beforeReleaseState)
  assert.deepEqual(released.heldInputAfter.keys, [])
  assert.equal(first.records[11]?.status, 'closed')
  assert.deepEqual(first.report.heldInput.keys, [])
  assert.equal(first.report.heldInput.mouse.leftDown, false)
  assert.deepEqual(first.report.cleanupActions, [])
  assert.equal(first.report.state, 'closed')
  assert.equal(first.report.runtimePositionConfirmed, true)

  assert.equal(
    stableHash(first.records.map(stableRecord)),
    stableHash(second.records.map(stableRecord))
  )
  assert.equal(
    stableHash(
      first.records
        .filter((record) => record.result?.kind === 'observation')
        .map(sharedObservationProjection)
    ),
    stableHash(
      second.records
        .filter((record) => record.result?.kind === 'observation')
        .map(sharedObservationProjection)
    )
  )
  assert.equal(
    stableHash(stableReport(first.report)),
    stableHash(stableReport(second.report))
  )

  const root = temporaryRoot(t)
  const inputPath = join(root, 'fixture.sb3')
  const runsRoot = join(root, 'runs')
  writeFileSync(inputPath, sb3, { mode: 0o600 })
  const inputs = [
    command('g', 0, 0, 'greenFlag'),
    command('kd', 1, 0, 'keyDown', { key: 'right' }),
    command('kd-repeat', 2, 0, 'keyDown', { key: 'right' }),
    command('advance-3', 3, 0, 'advance', { ticks: 3 }),
    command('held', 4, 3, 'observe', { label: 'held-3' }),
    command('advance-2', 5, 3, 'advance', { ticks: 2 }),
    command('before-release', 6, 5, 'observe', {
      label: 'before-release-5',
    }),
    command('ku', 7, 5, 'keyUp', { key: 'right' }),
    command('ku-repeat', 8, 5, 'keyUp', { key: 'right' }),
    command('released-advance', 9, 5, 'advance', { ticks: 2 }),
    command('released', 10, 7, 'observe', { label: 'released-7' }),
    command('close', 11, 7, 'close'),
  ]
  const live = runCli(
    'drive-observe',
    [
      '--headless',
      '--input',
      inputPath,
      '--runs-root',
      runsRoot,
      '--pace',
      'instant',
      '--max-commands',
      '16',
      '--max-ticks',
      '10',
      '--max-observations',
      '3',
      '--idle-timeout-ms',
      '60000',
      '--session-timeout-ms',
      '60000',
    ],
    `${inputs.map((input) => JSON.stringify(input)).join('\n')}\n`
  )
  assert.equal(live.exit, 0, live.stderr)
  const liveLines = cliLines(live.stdout)
  assert.equal(liveLines[0]?.type, 'ready')
  const runRoot = liveLines[0]?.runRoot
  assert.equal(typeof runRoot, 'string')
  const replay = runCli('drive-observe-replay', ['--run', runRoot as string])
  assert.equal(replay.exit, 0, replay.stderr)
  const replayLines = cliLines(replay.stdout)
  assert.equal(replayLines.length, 1)
  assert.equal(replayLines[0]?.status, 'matched')
  assert.equal(replayLines[0]?.agentExecutions, 0)
  assert.equal(replayLines[0]?.sourceWrites, 0)
})

test('T2 dense state-only observation matches sparse control without render boundaries', async () =>
{
  const sb3 = await buildDriveObserveHeldInputFixture()
  const sparseOutcome = await withInteractiveBrowserSession(
    sessionOptions(sb3),
    async (session) =>
    {
      const records: DriveObserveCommandRecordV1[] = []
      const inputs = [
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
      for (const input of inputs)
        records.push(commandRecord(await session.execute(input)))
      return records
    }
  )
  assert.equal(sparseOutcome.callback.status, 'completed')

  const denseOutcome = await withInteractiveBrowserSession(
    sessionOptions(sb3),
    async (session) =>
    {
      const records: DriveObserveCommandRecordV1[] = []
      let sequence = 0
      records.push(
        commandRecord(
          await session.execute(command('d-g', sequence++, 0, 'greenFlag'))
        )
      )
      records.push(
        commandRecord(
          await session.execute(
            command('d-kd', sequence++, 0, 'keyDown', { key: 'right' })
          )
        )
      )
      for (let tick = 1; tick <= 12; tick++)
      {
        records.push(
          commandRecord(
            await session.execute(
              command(`d-a-${tick}`, sequence++, tick - 1, 'advance', {
                ticks: 1,
              })
            )
          )
        )
        records.push(
          commandRecord(
            await session.execute(
              command(`d-o-${tick}`, sequence++, tick, 'observe', {
                label:
                  tick === 6 || tick === 12
                    ? `shared-${tick}`
                    : `dense-${tick}`,
              })
            )
          )
        )
      }
      records.push(
        commandRecord(
          await session.execute(
            command('d-ku', sequence++, 12, 'keyUp', { key: 'right' })
          )
        )
      )
      for (let tick = 13; tick <= 15; tick++)
      {
        records.push(
          commandRecord(
            await session.execute(
              command(`d-a-${tick}`, sequence++, tick - 1, 'advance', {
                ticks: 1,
              })
            )
          )
        )
        records.push(
          commandRecord(
            await session.execute(
              command(`d-o-${tick}`, sequence++, tick, 'observe', {
                label: tick === 15 ? 'shared-15' : `dense-${tick}`,
              })
            )
          )
        )
      }
      records.push(
        commandRecord(
          await session.execute(command('d-close', sequence, 15, 'close'))
        )
      )
      return records
    }
  )
  assert.equal(denseOutcome.callback.status, 'completed')

  const sparseObservations = sparseOutcome.callback.value.filter(
    (record) => record.result?.kind === 'observation'
  )
  const denseObservations = denseOutcome.callback.value.filter(
    (record) => record.result?.kind === 'observation'
  )
  assert.equal(sparseObservations.length, 3)
  assert.equal(denseObservations.length, 15)
  for (const record of [...sparseObservations, ...denseObservations])
  {
    assert.equal(record.tickBefore, record.tickAfter)
    assert.equal(record.drawEpochBefore, record.drawEpochAfter)
    assertNoVisualFields(observationValue(record))
  }

  const labels = ['shared-6', 'shared-12', 'shared-15'] as const
  const states = new Map<string, ReturnType<typeof observedMover>>()
  for (const label of labels)
  {
    const sparse = sparseObservations.find(
      (record) => observationLabel(record) === label
    )
    const dense = denseObservations.find(
      (record) => observationLabel(record) === label
    )
    assert.ok(sparse)
    assert.ok(dense)
    states.set(label, observedMover(sparse))
    assert.equal(
      stableHash(sharedObservationProjection(sparse)),
      stableHash(sharedObservationProjection(dense))
    )
  }
  const atSix = states.get('shared-6')!
  const atTwelve = states.get('shared-12')!
  const atFifteen = states.get('shared-15')!
  assert.ok(atTwelve.x > atSix.x)
  assert.ok(atTwelve.heldTicks > atSix.heldTicks)
  assert.deepEqual(atFifteen, atTwelve)
  assert.deepEqual(sparseObservations[0]?.heldInputAfter.keys, ['ArrowRight'])
  assert.deepEqual(sparseObservations[1]?.heldInputAfter.keys, ['ArrowRight'])
  assert.deepEqual(sparseObservations[2]?.heldInputAfter.keys, [])
  assert.equal(sparseOutcome.report.tick, 15)
  assert.equal(denseOutcome.report.tick, 15)
  assert.equal(sparseOutcome.report.drawEpoch, 15)
  assert.equal(denseOutcome.report.drawEpoch, 15)
  assert.deepEqual(sparseOutcome.report.issues, [])
  assert.deepEqual(denseOutcome.report.issues, [])

  const capped = await withInteractiveBrowserSession(
    sessionOptions(sb3, { observations: 1 }),
    async (session) =>
    {
      const first = commandRecord(
        await session.execute(command('cap-1', 0, 0, 'observe'))
      )
      const second = commandRecord(
        await session.execute(command('cap-2', 1, 0, 'observe'))
      )
      return { first, second }
    }
  )
  assert.equal(capped.callback.status, 'completed')
  assert.equal(capped.callback.value.first.status, 'accepted')
  assert.equal(
    capped.callback.value.first.result?.kind === 'observation'
      ? capped.callback.value.first.result.capture.status
      : null,
    'observed'
  )
  assert.equal(capped.callback.value.second.status, 'failed')
  assert.equal(
    capped.callback.value.second.issue?.code,
    'runner.drive-observe.observation-budget-exceeded'
  )
  assert.equal(capped.callback.value.second.result, null)
  assert.deepEqual(
    [
      capped.callback.value.second.tickBefore,
      capped.callback.value.second.tickAfter,
      capped.callback.value.second.drawEpochBefore,
      capped.callback.value.second.drawEpochAfter,
    ],
    [0, 0, 0, 0]
  )
})

test('T3 consequential session policy fails closed and cleans private state', async (t) =>
{
  const sb3 = await buildDriveObserveHeldInputFixture()
  const trusted = await withInteractiveBrowserSession(
    sessionOptions(sb3),
    async (session) =>
    {
      const records = [
        commandRecord(await session.execute(command('g', 0, 0, 'greenFlag'))),
        commandRecord(
          await session.execute(command('a', 1, 0, 'advance', { ticks: 1 }))
        ),
        commandRecord(
          await session.execute(
            command('stale', 2, 0, 'observe', { label: 'stale' })
          )
        ),
        commandRecord(
          await session.execute(
            command('a', 3, 1, 'observe', { label: 'reused' })
          )
        ),
        commandRecord(await session.execute(command('c', 4, 1, 'close'))),
      ]
      const afterClose = await session.execute(
        command('after-close', 5, 1, 'observe')
      )
      const afterCloseAgain = await session.execute(
        command('after-close-again', 5, 1, 'advance', { ticks: 1 })
      )
      return { records, afterClose, afterCloseAgain }
    }
  )
  assert.equal(trusted.callback.status, 'completed')
  assert.equal(trusted.callback.value.records[2]?.status, 'refused')
  assert.equal(
    trusted.callback.value.records[2]?.issue?.code,
    'runner.drive-observe.expected-tick-mismatch'
  )
  assert.equal(trusted.callback.value.records[3]?.status, 'refused')
  assert.equal(
    trusted.callback.value.records[3]?.issue?.code,
    'runner.drive-observe.request-id-reused'
  )
  for (const record of trusted.callback.value.records.slice(2, 4))
  {
    assert.deepEqual(
      [
        record.tickBefore,
        record.tickAfter,
        record.drawEpochBefore,
        record.drawEpochAfter,
      ],
      [1, 1, 1, 1]
    )
  }
  assert.equal(trusted.callback.value.afterClose.kind, 'terminalIssue')
  assert.equal(trusted.callback.value.afterCloseAgain.kind, 'terminalIssue')
  if (
    trusted.callback.value.afterClose.kind === 'terminalIssue' &&
    trusted.callback.value.afterCloseAgain.kind === 'terminalIssue'
  )
  {
    assert.equal(
      trusted.callback.value.afterClose.issue.code,
      'runner.drive-observe.session-not-accepting'
    )
    assert.deepEqual(
      [
        trusted.callback.value.afterClose.tick,
        trusted.callback.value.afterClose.drawEpoch,
      ],
      [1, 1]
    )
    assert.deepEqual(
      trusted.callback.value.afterClose,
      trusted.callback.value.afterCloseAgain
    )
  }

  const observationCap = await withInteractiveBrowserSession(
    sessionOptions(sb3, { observations: 1 }),
    async (session) =>
    {
      await session.execute(command('kd', 0, 0, 'keyDown', { key: 'right' }))
      await session.execute(
        command('md', 1, 0, 'mouseDown', {
          x: -7,
          y: 8,
          button: 'left',
        })
      )
      const first = commandRecord(
        await session.execute(command('o1', 2, 0, 'observe'))
      )
      const second = commandRecord(
        await session.execute(command('o2', 3, 0, 'observe'))
      )
      return { first, second }
    }
  )
  assert.equal(observationCap.callback.status, 'completed')
  assert.equal(observationCap.callback.value.first.status, 'accepted')
  assert.equal(observationCap.callback.value.second.status, 'failed')
  assert.equal(observationCap.callback.value.second.result, null)
  assert.equal(observationCap.report.state, 'failed')
  assert.deepEqual(observationCap.report.heldInput.keys, [])
  assert.equal(observationCap.report.heldInput.mouse.leftDown, false)
  assert.deepEqual(
    observationCap.report.cleanupActions.map(
      (action) => action.command.command
    ),
    ['keyUp', 'mouseUp']
  )
  assert.ok(
    observationCap.report.cleanupActions.every(
      (action) =>
        action.drawEpochBefore === action.drawEpochAfter &&
        action.issue === null
    )
  )

  const networkSb3 = await buildDriveObserveNetworkFixture()
  const network = await withInteractiveBrowserSession(
    sessionOptions(networkSb3),
    async (session) =>
    {
      await session.execute(command('g', 0, 0, 'greenFlag'))
      const advance = await session.execute(
        command('a', 1, 0, 'advance', { ticks: 5 })
      )
      const terminalCode = await terminalWithin(session)
      return { advance, terminalCode }
    }
  )
  assert.equal(network.callback.status, 'completed')
  assert.equal(
    network.callback.value.terminalCode,
    'runner.network.request-denied'
  )
  assert.equal(network.report.state, 'failed')
  assert.ok(
    network.report.issues.some(
      (issue) => issue.code === 'runner.network.request-denied'
    )
  )

  const root = temporaryRoot(t)
  const inputPath = join(root, 'fixture.sb3')
  const runsRoot = join(root, 'runs')
  writeFileSync(inputPath, sb3, { mode: 0o600 })
  const inputs = [
    command('g', 0, 0, 'greenFlag'),
    command('kd', 1, 0, 'keyDown', { key: 'right' }),
    command('md', 2, 0, 'mouseDown', {
      x: 5,
      y: 6,
      button: 'left',
    }),
    command('a2', 3, 0, 'advance', { ticks: 2 }),
    command('a1', 4, 2, 'advance', { ticks: 1 }),
  ]
  const failed = runCli(
    'drive-observe',
    [
      '--headless',
      '--input',
      inputPath,
      '--runs-root',
      runsRoot,
      '--pace',
      'instant',
      '--max-commands',
      '10',
      '--max-ticks',
      '2',
      '--max-observations',
      '2',
      '--idle-timeout-ms',
      '60000',
      '--session-timeout-ms',
      '60000',
    ],
    `${inputs.map((input) => JSON.stringify(input)).join('\n')}\n`
  )
  assert.equal(failed.exit, 1)
  const lines = cliLines(failed.stdout)
  const final = lines.at(-1)
  assert.equal(final?.status, 'failed')
  assert.equal(dataRecord(final?.issue).code, 'runner.tick-budget.exceeded')
  assert.deepEqual(
    [
      final?.tickBefore,
      final?.tickAfter,
      final?.drawEpochBefore,
      final?.drawEpochAfter,
    ],
    [2, 2, 2, 2]
  )
  const ready = lines[0]
  assert.equal(ready?.type, 'ready')
  const runRoot = ready?.runRoot
  assert.equal(typeof runRoot, 'string')
  const report = JSON.parse(
    readFileSync(join(runRoot as string, 'report.json'), 'utf8')
  ) as DriveObserveSessionReportV1 & {
    terminal: {
      stableSha256: string
      heldInput: { keys: string[]; mouse: { leftDown: boolean } }
      cleanupActions: Array<{
        command: { command: string }
        drawEpochBefore: number
        drawEpochAfter: number
        issue: unknown
      }>
    }
    source: { exactPreserved: boolean }
  }
  assert.equal(report.source.exactPreserved, true)
  const {
    stableSha256: retainedTerminalSha256,
    ...retainedTerminalProjection
  } = report.terminal
  assert.equal(retainedTerminalSha256, stableHash(retainedTerminalProjection))
  assert.deepEqual(report.terminal.heldInput.keys, [])
  assert.equal(report.terminal.heldInput.mouse.leftDown, false)
  assert.deepEqual(
    report.terminal.cleanupActions.map((action) => action.command.command),
    ['keyUp', 'mouseUp']
  )
  assert.ok(
    report.terminal.cleanupActions.every(
      (action) =>
        action.drawEpochBefore === action.drawEpochAfter &&
        action.issue === null
    )
  )
  const expectedFiles = [
    'browser/console.json',
    'browser/issues.json',
    'input/identity.json',
    'input/source.sb3',
    'report.json',
    'report.md',
    'transcript/commands.jsonl',
    'transcript/normalized.json',
  ]
  const actualFiles: string[] = []
  const visit = (directory: string): void =>
  {
    for (const entry of readdirSync(directory, { withFileTypes: true }))
    {
      const path = join(directory, entry.name)
      const mode = lstatSync(path).mode & 0o777
      if (entry.isDirectory())
      {
        assert.equal(mode, 0o700)
        visit(path)
      }
      else
      {
        assert.equal(entry.isFile(), true)
        assert.equal(mode, 0o600)
        actualFiles.push(relative(runRoot as string, path))
      }
    }
  }
  visit(runRoot as string)
  assert.deepEqual(actualFiles.sort(), expectedFiles)
  assert.equal(
    actualFiles.filter((path) => path.endsWith('.sb3')).join(','),
    'input/source.sb3'
  )

  const fresh = await withInteractiveBrowserSession(
    sessionOptions(sb3),
    async (session) =>
    {
      const advance = commandRecord(
        await session.execute(command('fresh-a', 0, 0, 'advance', { ticks: 1 }))
      )
      const observe = commandRecord(
        await session.execute(command('fresh-o', 1, 1, 'observe'))
      )
      const close = commandRecord(
        await session.execute(command('fresh-c', 2, 1, 'close'))
      )
      return { advance, observe, close }
    }
  )
  assert.equal(fresh.callback.status, 'completed')
  assert.equal(fresh.callback.value.advance.status, 'accepted')
  assert.deepEqual(
    [
      fresh.callback.value.observe.tickBefore,
      fresh.callback.value.observe.tickAfter,
      fresh.callback.value.observe.drawEpochBefore,
      fresh.callback.value.observe.drawEpochAfter,
    ],
    [1, 1, 1, 1]
  )
  assert.equal(fresh.callback.value.close.status, 'closed')
  assert.deepEqual(fresh.report.issues, [])
})

test('duration clock starts at ready and realtime advance fails closed', async () =>
{
  const sb3 = await buildDriveObserveHeldInputFixture()

  // short budget after ready still accepts a cheap command (launch no longer eats it)
  const readyClock = await withInteractiveBrowserSession(
    sessionOptions(sb3, { durationMs: 2_000 }),
    async (session) =>
    {
      const flag = commandRecord(
        await session.execute(command('ready-g', 0, 0, 'greenFlag'))
      )
      const close = commandRecord(
        await session.execute(command('ready-c', 1, 0, 'close'))
      )
      return { flag, close }
    }
  )
  assert.equal(readyClock.callback.status, 'completed')
  assert.equal(readyClock.callback.value.flag.status, 'accepted')
  assert.equal(readyClock.callback.value.close.status, 'closed')
  assert.equal(readyClock.report.state, 'closed')

  // pre-command duration gate fails without mutating ticks
  const expired = await withInteractiveBrowserSession(
    sessionOptions(sb3, { durationMs: 50 }),
    async (session) =>
    {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return session.execute(command('exp-a', 0, 0, 'advance', { ticks: 1 }))
    }
  )
  assert.equal(expired.callback.status, 'completed')
  if (expired.callback.value.kind === 'command')
  {
    assert.equal(expired.callback.value.record.status, 'failed')
    assert.equal(
      expired.callback.value.record.issue?.code,
      'runner.drive-observe.duration-exceeded'
    )
    assert.equal(expired.callback.value.record.tickAfter, 0)
    assert.equal(expired.callback.value.record.changed, false)
  }
  else
  {
    // timer may already have failed the session before the next execute
    assert.ok(
      expired.callback.value.issue.code ===
        'runner.drive-observe.session-not-accepting' ||
        expired.callback.value.issue.code ===
          'runner.drive-observe.duration-exceeded'
    )
  }
  assert.ok(
    expired.report.issues.some(
      (issue) => issue.code === 'runner.drive-observe.duration-exceeded'
    )
  )
  assert.equal(expired.report.tick, 0)

  // realtime advance that cannot finish inside the remaining budget fails w/o ticks
  const partial = await withInteractiveBrowserSession(
    sessionOptions(sb3, { durationMs: 250, ticks: 10_000 }, 'realtime'),
    async (session) =>
    {
      const advance = commandRecord(
        await session.execute(
          command('rt-a', 0, 0, 'advance', { ticks: 120 })
        )
      )
      return advance
    }
  )
  assert.equal(partial.callback.status, 'completed')
  assert.equal(partial.callback.value.status, 'failed')
  assert.equal(
    partial.callback.value.issue?.code,
    'runner.drive-observe.duration-exceeded'
  )
  assert.equal(partial.callback.value.tickBefore, 0)
  assert.equal(partial.callback.value.tickAfter, 0)
  assert.equal(partial.callback.value.changed, false)
  assert.equal(partial.callback.value.result, null)
  assert.equal(partial.report.tick, 0)
  assert.equal(partial.report.state, 'failed')
})

test('accepted held-input changed matches retained before/after', async () =>
{
  const sb3 = await buildDriveObserveHeldInputFixture()
  const outcome = await withInteractiveBrowserSession(
    sessionOptions(sb3),
    async (session) =>
    {
      const down = commandRecord(
        await session.execute(
          command('ch-kd', 0, 0, 'keyDown', { key: 'right' })
        )
      )
      const again = commandRecord(
        await session.execute(
          command('ch-kd2', 1, 0, 'keyDown', { key: 'right' })
        )
      )
      const up = commandRecord(
        await session.execute(
          command('ch-ku', 2, 0, 'keyUp', { key: 'right' })
        )
      )
      await session.execute(command('ch-c', 3, 0, 'close'))
      return { down, again, up }
    }
  )
  assert.equal(outcome.callback.status, 'completed')
  const { down, again, up } = outcome.callback.value
  assert.equal(down.changed, true)
  assert.deepEqual(down.heldInputBefore.keys, [])
  assert.deepEqual(down.heldInputAfter.keys, ['ArrowRight'])
  assert.equal(again.changed, false)
  assert.deepEqual(again.heldInputBefore, again.heldInputAfter)
  assert.equal(up.changed, true)
  assert.deepEqual(up.heldInputBefore.keys, ['ArrowRight'])
  assert.deepEqual(up.heldInputAfter.keys, [])
  assert.ok(
    outcome.report.cleanupActions.every(
      (action) =>
        action.issue === null ||
        !String(action.issue.message).includes('[object Object]')
    )
  )
})
