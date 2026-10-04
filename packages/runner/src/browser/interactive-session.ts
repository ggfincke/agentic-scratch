// packages/runner/src/browser/interactive-session.ts
// callback-scoped serialized drive-observe session for one pinned browser runtime

import { performance } from 'node:perf_hooks'

import { browserFailureIssue, type BrowserRunStage } from './browser-issues.js'
import { RUNNER_TICK_MS } from './browser-config.js'
import {
  openRenderedPageHost,
  RENDERED_PAGE_CLOSE_TIMEOUT_MS,
  type RenderedPageHost,
} from './browser-host.js'
import { errorMessage } from '../error-message.js'
import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import {
  DEFAULT_RUNTIME_OBSERVATION_CAPS,
  type RuntimeObservationBudgetTotalsV1,
  type RuntimeObservationCapsV1,
} from '../observation/observation.js'
import type { ObservedRuntimeExecutionObservationV1 } from '../observation/snapshot.js'
import type { RuntimeObservationCaptureV1 } from '../observation/runtime-observation.js'
import {
  poisonRunnerExecution,
  withRunnerExecution,
} from '../policy/execution-coordinator.js'
import {
  RUN_ISSUE_CODES,
  createRunIssue,
  type RunIssue,
} from '../policy/issues.js'
import { BrowserConsoleCollector } from '../policy/runtime-log.js'
import type { BrowserConsoleSummary } from '../policy/types.js'
import { canonicalInputKey } from '../scenario/input.js'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'

const MAX_REQUEST_ID_BYTES = 256
const MAX_KEY_BYTES = 64
const MAX_LABEL_BYTES = 256
const MAX_ISSUES = 256
const MAX_ISSUE_MESSAGE_BYTES = 2048

export type DriveObservePacingV1 = 'instant' | 'realtime'

export type DriveObserveSessionStateV1 =
  'opening' | 'ready' | 'active' | 'closing' | 'closed' | 'failed'

export interface DriveObserveSessionLimitsV1
{
  readonly commands: number
  readonly ticks: number
  readonly observations: number
  readonly durationMs: number
}

export const DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1: DriveObserveSessionLimitsV1 =
  Object.freeze({
    commands: 64,
    ticks: 600,
    observations: 16,
    durationMs: 15 * 60_000,
  })

export const MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1: DriveObserveSessionLimitsV1 =
  Object.freeze({
    commands: 256,
    ticks: 10_000,
    observations: 64,
    durationMs: 30 * 60_000,
  })

export const DRIVE_OBSERVE_SESSION_ISSUE_CODES = Object.freeze({
  invalidOptions: 'runner.drive-observe.invalid-options',
  invalidCommandIdentity: 'runner.drive-observe.invalid-command-identity',
  sequenceMismatch: 'runner.drive-observe.sequence-mismatch',
  concurrentCommand: 'runner.drive-observe.concurrent-command',
  invalidCommand: 'runner.drive-observe.invalid-command',
  requestIdReused: 'runner.drive-observe.request-id-reused',
  expectedTickMismatch: 'runner.drive-observe.expected-tick-mismatch',
  greenFlagRepeated: 'runner.drive-observe.green-flag-repeated',
  sessionNotAccepting: 'runner.drive-observe.session-not-accepting',
  commandBudgetExceeded: 'runner.drive-observe.command-budget-exceeded',
  observationBudgetExceeded: 'runner.drive-observe.observation-budget-exceeded',
  durationExceeded: 'runner.drive-observe.duration-exceeded',
  observationRefused: 'runner.drive-observe.observation-refused',
  observationPoisoned: 'runner.drive-observe.observation-poisoned',
  pageClosed: 'runner.drive-observe.page-closed',
  contextClosed: 'runner.drive-observe.context-closed',
  browserDisconnected: 'runner.drive-observe.browser-disconnected',
  renderInstrumentationDrift:
    'runner.drive-observe.render-instrumentation-drift',
  tickInvariant: 'runner.drive-observe.tick-invariant',
  drawInvariant: 'runner.drive-observe.draw-invariant',
  cancelled: 'runner.drive-observe.cancelled',
  callbackFailed: 'runner.drive-observe.callback-failed',
} as const)

export type DriveObserveSessionIssueCodeV1 =
  (typeof DRIVE_OBSERVE_SESSION_ISSUE_CODES)[keyof typeof DRIVE_OBSERVE_SESSION_ISSUE_CODES]

export interface InteractiveBrowserSessionOptionsV1
{
  readonly sb3: Uint8Array
  readonly headless: boolean
  readonly pacing: DriveObservePacingV1
  readonly seed: number
  readonly fixedDateMs: number
  readonly limits?: Partial<DriveObserveSessionLimitsV1>
  readonly signal?: AbortSignal
}

export type DriveObserveCommandV1 =
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'greenFlag'
    }
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'keyDown' | 'keyUp'
      readonly key: string
    }
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'mouseMove'
      readonly x: number
      readonly y: number
    }
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'mouseDown' | 'mouseUp'
      readonly x: number
      readonly y: number
      readonly button: 'left'
    }
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'advance'
      readonly ticks: number
    }
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'observe'
      readonly label?: string
    }
  | {
      readonly requestId: string
      readonly sequence: number
      readonly expectedTick: number
      readonly command: 'close'
    }

export type DriveObserveNormalizedCommandV1 =
  | { readonly command: 'greenFlag' }
  | {
      readonly command: 'keyDown' | 'keyUp'
      readonly key: string
    }
  | {
      readonly command: 'mouseMove'
      readonly x: number
      readonly y: number
    }
  | {
      readonly command: 'mouseDown' | 'mouseUp'
      readonly x: number
      readonly y: number
      readonly button: 'left'
    }
  | { readonly command: 'advance'; readonly ticks: number }
  | {
      readonly command: 'observe'
      readonly label: string | null
    }
  | { readonly command: 'close' }

export interface DriveObserveHeldInputV1
{
  readonly keys: readonly string[]
  readonly mouse: {
    readonly x: number
    readonly y: number
    readonly leftDown: boolean
  }
}

export interface DriveObserveSessionBudgetsV1
{
  readonly commands: number
  readonly ticks: number
  readonly observations: number
  readonly runtimeObservation: RuntimeObservationBudgetTotalsV1
}

export type DriveObserveCommandResultV1 =
  | { readonly kind: 'greenFlag'; readonly started: true }
  | { readonly kind: 'input'; readonly heldInput: DriveObserveHeldInputV1 }
  | { readonly kind: 'advance'; readonly ticksAdvanced: number }
  | {
      readonly kind: 'observation'
      readonly label: string | null
      readonly capture: RuntimeObservationCaptureV1<ObservedRuntimeExecutionObservationV1>
    }
  | { readonly kind: 'close' }

export interface DriveObserveCommandRecordV1
{
  readonly requestId: string
  readonly sequence: number
  readonly normalizedCommand: DriveObserveNormalizedCommandV1 | null
  readonly status: 'accepted' | 'refused' | 'failed' | 'closed'
  readonly tickBefore: number
  readonly tickAfter: number
  readonly drawEpochBefore: number
  readonly drawEpochAfter: number
  readonly heldInputBefore: DriveObserveHeldInputV1
  readonly heldInputAfter: DriveObserveHeldInputV1
  readonly changed: boolean
  readonly result: DriveObserveCommandResultV1 | null
  readonly issue: RunIssue | null
  readonly budgets: DriveObserveSessionBudgetsV1
  readonly durationMs: number
}

export type DriveObserveCommandOutcomeV1 =
  | {
      readonly kind: 'command'
      readonly record: DriveObserveCommandRecordV1
    }
  | {
      readonly kind: 'terminalIssue'
      readonly issue: RunIssue
      readonly tick: number
      readonly drawEpoch: number
    }

export interface DriveObserveCleanupActionV1
{
  readonly command:
    | { readonly command: 'keyUp'; readonly key: string }
    | {
        readonly command: 'mouseUp'
        readonly x: number
        readonly y: number
        readonly button: 'left'
      }
  readonly heldInputBefore: DriveObserveHeldInputV1
  readonly heldInputAfter: DriveObserveHeldInputV1
  readonly drawEpochBefore: number
  readonly drawEpochAfter: number
  readonly issue: RunIssue | null
}

export interface DriveObserveSessionReadyV1
{
  readonly runtimeDescriptor: RuntimeDescriptorV1
  readonly deterministicEnvironment: {
    readonly seed: number
    readonly fixedDateMs: number
    readonly tickMs: number
  }
  readonly pacing: DriveObservePacingV1
  readonly limits: DriveObserveSessionLimitsV1
  readonly observationCaps: RuntimeObservationCapsV1
  readonly tick: 0
  readonly drawEpoch: number
  readonly heldInput: DriveObserveHeldInputV1
}

export interface DriveObserveSessionReportV1
{
  readonly state: 'closed' | 'failed'
  readonly terminalReason: string
  readonly ready: DriveObserveSessionReadyV1 | null
  readonly tick: number
  readonly drawEpoch: number
  readonly runtimePositionConfirmed: boolean
  readonly heldInput: DriveObserveHeldInputV1
  readonly budgets: DriveObserveSessionBudgetsV1
  readonly records: readonly DriveObserveCommandRecordV1[]
  readonly cleanupActions: readonly DriveObserveCleanupActionV1[]
  readonly consoleEntries: readonly string[]
  readonly consoleSummary: BrowserConsoleSummary
  readonly issues: readonly RunIssue[]
  readonly droppedIssues: number
  readonly elapsedMs: number
}

export interface DriveObserveSessionV1
{
  readonly ready: DriveObserveSessionReadyV1
  readonly state: DriveObserveSessionStateV1
  readonly terminal: Promise<RunIssue>
  execute(input: unknown): Promise<DriveObserveCommandOutcomeV1>
}

export interface InteractiveBrowserSessionOutcomeV1<T>
{
  readonly callback:
    | { readonly status: 'completed'; readonly value: T }
    | { readonly status: 'failed'; readonly issue: RunIssue }
    | { readonly status: 'not-invoked'; readonly issue: RunIssue }
  readonly report: DriveObserveSessionReportV1
}

interface TrustedCommandIdentity
{
  readonly record: Record<string, unknown>
  readonly requestId: string
  readonly sequence: number
  readonly expectedTick: number
}

const ZERO_OBSERVATION_TOTALS: RuntimeObservationBudgetTotalsV1 = Object.freeze(
  {
    scalarSlots: 0,
    snapshotBytes: 0,
    records: 0,
    cellTraceBytes: 0,
    attemptTraceBytes: 0,
  }
)

function boundedMessage(value: unknown): string
{
  const message = errorMessage(value)
  if (Buffer.byteLength(message, 'utf8') <= MAX_ISSUE_MESSAGE_BYTES)
    return message
  let retained = ''
  for (const character of message)
  {
    if (
      Buffer.byteLength(`${retained}${character}...`, 'utf8') >
      MAX_ISSUE_MESSAGE_BYTES
    )
      break
    retained += character
  }
  return `${retained}...`
}

function sessionIssue(
  code: DriveObserveSessionIssueCodeV1,
  message: string,
  responsibility:
    'project' | 'repair-case' | 'infrastructure' | 'unsupported' = 'repair-case'
): RunIssue
{
  return createRunIssue({
    code,
    kind: responsibility === 'infrastructure' ? 'internal' : 'scenario',
    responsibility,
    message: boundedMessage(message),
  })
}

function runtimeIssue(error: unknown): RunIssue
{
  return createRunIssue({
    code: RUN_ISSUE_CODES.browserRuntimeFailed,
    kind: 'runtime',
    responsibility: 'infrastructure',
    message: boundedMessage(error),
  })
}

function cancellationIssue(signal: AbortSignal): RunIssue
{
  if (isRunIssueLike(signal.reason)) return signal.reason
  return sessionIssue(
    DRIVE_OBSERVE_SESSION_ISSUE_CODES.cancelled,
    signal.reason === undefined
      ? 'interactive browser session was cancelled'
      : boundedMessage(signal.reason),
    'infrastructure'
  )
}

function isRunIssueLike(error: unknown): error is RunIssue
{
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'kind' in error &&
    'responsibility' in error &&
    'message' in error &&
    typeof (error as RunIssue).code === 'string' &&
    typeof (error as RunIssue).kind === 'string' &&
    typeof (error as RunIssue).responsibility === 'string' &&
    typeof (error as RunIssue).message === 'string'
  )
}

// preserve thrown RunIssue codes; plain objects stringify as [object Object]
function cleanupIssue(error: unknown): RunIssue
{
  if (isRunIssueLike(error)) return error
  return createRunIssue({
    code: RUN_ISSUE_CODES.browserCleanupFailed,
    kind: 'internal',
    responsibility: 'infrastructure',
    message: boundedMessage(error),
  })
}

function plainDataRecord(value: unknown): Record<string, unknown> | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  try
  {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    if (Object.getOwnPropertySymbols(value).length !== 0) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const descriptor of Object.values(descriptors))
    {
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        return null
    }
    return value as Record<string, unknown>
  }
  catch
  {
    return null
  }
}

function hasUnpairedSurrogate(value: string): boolean
{
  for (let index = 0; index < value.length; index++)
  {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff)
    {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index++
    }
    else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

function boundedString(
  value: unknown,
  maximumBytes: number,
  allowEmpty: boolean
): value is string
{
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    !value.includes('\0') &&
    !hasUnpairedSurrogate(value) &&
    Buffer.byteLength(value, 'utf8') <= maximumBytes
  )
}

function sameKeys(
  record: Record<string, unknown>,
  expected: readonly string[]
): boolean
{
  const actual = Object.keys(record).sort()
  const wanted = [...expected].sort()
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  )
}

function trustedIdentity(value: unknown): TrustedCommandIdentity | null
{
  const record = plainDataRecord(value)
  if (
    record === null ||
    !boundedString(record.requestId, MAX_REQUEST_ID_BYTES, false) ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 0 ||
    !Number.isSafeInteger(record.expectedTick) ||
    (record.expectedTick as number) < 0
  )
    return null
  return {
    record,
    requestId: record.requestId,
    sequence: record.sequence as number,
    expectedTick: record.expectedTick as number,
  }
}

function normalizedCoordinate(
  value: unknown,
  minimum: number,
  maximum: number
): number | null
{
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    return null
  return Object.is(value, -0) ? 0 : value
}

function parseCommand(
  identity: TrustedCommandIdentity
): DriveObserveNormalizedCommandV1 | null
{
  const record = identity.record
  const command = record.command
  const base = ['requestId', 'sequence', 'expectedTick', 'command'] as const
  if (command === 'greenFlag' || command === 'close')
  {
    return sameKeys(record, base) ? { command } : null
  }
  if (command === 'keyDown' || command === 'keyUp')
  {
    if (
      !sameKeys(record, [...base, 'key']) ||
      !boundedString(record.key, MAX_KEY_BYTES, false)
    )
      return null
    const key = canonicalInputKey(record.key)
    if (key === null || !boundedString(key, MAX_KEY_BYTES, false)) return null
    return { command, key }
  }
  if (
    command === 'mouseMove' ||
    command === 'mouseDown' ||
    command === 'mouseUp'
  )
  {
    const buttonCommand = command !== 'mouseMove'
    if (
      !sameKeys(
        record,
        buttonCommand ? [...base, 'x', 'y', 'button'] : [...base, 'x', 'y']
      ) ||
      (buttonCommand && record.button !== 'left')
    )
      return null
    const x = normalizedCoordinate(record.x, -STAGE_WIDTH / 2, STAGE_WIDTH / 2)
    const y = normalizedCoordinate(
      record.y,
      -STAGE_HEIGHT / 2,
      STAGE_HEIGHT / 2
    )
    if (x === null || y === null) return null
    return command === 'mouseMove'
      ? { command, x, y }
      : { command, x, y, button: 'left' }
  }
  if (command === 'advance')
  {
    if (
      !sameKeys(record, [...base, 'ticks']) ||
      !Number.isSafeInteger(record.ticks) ||
      (record.ticks as number) <= 0
    )
      return null
    return { command, ticks: record.ticks as number }
  }
  if (command === 'observe')
  {
    const keys = Object.hasOwn(record, 'label') ? [...base, 'label'] : base
    if (
      !sameKeys(record, keys) ||
      (Object.hasOwn(record, 'label') &&
        !boundedString(record.label, MAX_LABEL_BYTES, true))
    )
      return null
    return {
      command,
      label: typeof record.label === 'string' ? record.label : null,
    }
  }
  return null
}

function resolveLimits(
  requested: Partial<DriveObserveSessionLimitsV1> | undefined
): DriveObserveSessionLimitsV1 | null
{
  const record = requested === undefined ? {} : plainDataRecord(requested)
  if (record === null) return null
  const allowed = new Set(['commands', 'ticks', 'observations', 'durationMs'])
  if (Object.keys(record).some((key) => !allowed.has(key))) return null
  const limits = {
    ...DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1,
    ...record,
  } as unknown as DriveObserveSessionLimitsV1
  for (const key of Object.keys(MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1) as Array<
    keyof DriveObserveSessionLimitsV1
  >)
  {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1[key]
    )
      return null
  }
  return Object.freeze(limits)
}

function validOptions(
  options: InteractiveBrowserSessionOptionsV1,
  limits: DriveObserveSessionLimitsV1 | null
): limits is DriveObserveSessionLimitsV1
{
  return (
    options !== null &&
    typeof options === 'object' &&
    options.sb3 instanceof Uint8Array &&
    typeof options.headless === 'boolean' &&
    (options.pacing === 'instant' || options.pacing === 'realtime') &&
    Number.isSafeInteger(options.seed) &&
    options.seed >= 0 &&
    options.seed <= 0xffffffff &&
    Number.isSafeInteger(options.fixedDateMs) &&
    !Number.isNaN(new Date(options.fixedDateMs).valueOf()) &&
    (options.signal === undefined || options.signal instanceof AbortSignal) &&
    limits !== null
  )
}

function heldInput(
  keys: ReadonlySet<string>,
  mouseX: number,
  mouseY: number,
  leftDown: boolean
): DriveObserveHeldInputV1
{
  return Object.freeze({
    keys: Object.freeze([...keys].sort()),
    mouse: Object.freeze({ x: mouseX, y: mouseY, leftDown }),
  })
}

function sleep(durationMs: number): Promise<void>
{
  return new Promise((resolve) =>
  {
    const timer = setTimeout(resolve, durationMs)
    timer.unref()
  })
}

async function settlesWithin(
  promise: Promise<void>,
  durationMs: number
): Promise<boolean>
{
  let timer: NodeJS.Timeout | undefined
  try
  {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) =>
      {
        timer = setTimeout(() => resolve(false), durationMs)
      }),
    ])
  }
  finally
  {
    if (timer) clearTimeout(timer)
  }
}

async function awaitAbortable<T>(
  factory: () => Promise<T>,
  signal: AbortSignal | undefined
): Promise<T>
{
  if (signal?.aborted) throw cancellationIssue(signal)
  const operation = factory()
  if (!signal) return await operation

  return await new Promise<T>((resolve, reject) =>
  {
    let settled = false
    const onAbort = (): void =>
    {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(cancellationIssue(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    void operation.then(
      (value) =>
      {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) =>
      {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

class InteractiveBrowserSession implements DriveObserveSessionV1
{
  readonly ready: DriveObserveSessionReadyV1
  readonly terminal: Promise<RunIssue>
  readonly #host: RenderedPageHost
  readonly #startedAt: number
  readonly #limits: DriveObserveSessionLimitsV1
  readonly #pacing: DriveObservePacingV1
  readonly #closeHost: () => Promise<void>
  readonly #keys = new Set<string>()
  readonly #requestIds = new Set<string>()
  readonly #records: DriveObserveCommandRecordV1[] = []
  readonly #cleanupActions: DriveObserveCleanupActionV1[] = []
  readonly #issues: RunIssue[] = []
  #state: DriveObserveSessionStateV1 = 'ready'
  #nextSequence = 0
  #tick = 0
  #drawEpoch: number
  #mouseX = 0
  #mouseY = 0
  #mouseLeftDown = false
  #greenFlagStarted = false
  #commands = 0
  #observations = 0
  #observationTotals = ZERO_OBSERVATION_TOTALS
  #inFlight = false
  #inFlightCompletion: Promise<void> | null = null
  #releaseHeldInputPromise: Promise<void> | null = null
  #terminalIssue: RunIssue | null = null
  #terminalReason = 'callback-returned'
  #runtimePositionConfirmed = true
  #droppedIssues = 0
  #durationTimer: NodeJS.Timeout | null = null
  #resolveTerminal!: (issue: RunIssue) => void

  constructor(input: {
    readonly host: RenderedPageHost
    readonly options: InteractiveBrowserSessionOptionsV1
    readonly limits: DriveObserveSessionLimitsV1
    readonly drawEpoch: number
    readonly closeHost: () => Promise<void>
    // duration clock starts at ready (post begin), not before browser launch
    readonly startedAt: number
  })
  {
    this.#host = input.host
    this.#startedAt = input.startedAt
    this.#limits = input.limits
    this.#pacing = input.options.pacing
    this.#closeHost = input.closeHost
    this.#drawEpoch = input.drawEpoch
    this.terminal = new Promise((resolve) =>
    {
      this.#resolveTerminal = resolve
    })
    this.ready = Object.freeze({
      runtimeDescriptor: structuredClone(input.host.runtimeDescriptor),
      deterministicEnvironment: Object.freeze({
        seed: input.options.seed,
        fixedDateMs: input.options.fixedDateMs,
        tickMs: RUNNER_TICK_MS,
      }),
      pacing: input.options.pacing,
      limits: structuredClone(input.limits),
      observationCaps: structuredClone(DEFAULT_RUNTIME_OBSERVATION_CAPS),
      tick: 0 as const,
      drawEpoch: input.drawEpoch,
      heldInput: this.#heldInput(),
    })
    this.#durationTimer = setTimeout(() =>
    {
      const issue = sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.durationExceeded,
        `session exceeded ${this.#limits.durationMs} ms`,
        'infrastructure'
      )
      if (this.#inFlight) this.#runtimePositionConfirmed = false
      this.latchTerminal(issue, 'duration-exceeded')
      if (this.#inFlight) void this.#closeHost()
    }, input.limits.durationMs)
    this.#durationTimer.unref()
  }

  get state(): DriveObserveSessionStateV1
  {
    return this.#state
  }

  latchExternalIssue(issue: RunIssue, reason: string): void
  {
    if (this.#inFlight) this.#runtimePositionConfirmed = false
    this.latchTerminal(issue, reason)
    if (this.#inFlight) void this.#closeHost()
  }

  #heldInput(): DriveObserveHeldInputV1
  {
    return heldInput(
      this.#keys,
      this.#mouseX,
      this.#mouseY,
      this.#mouseLeftDown
    )
  }

  #elapsedMs(): number
  {
    return Math.max(0, performance.now() - this.#startedAt)
  }

  #addIssue(issue: RunIssue): void
  {
    if (this.#issues.length < MAX_ISSUES) this.#issues.push(issue)
    else this.#droppedIssues++
  }

  #checkDuration(): RunIssue | null
  {
    if (this.#terminalIssue) return this.#terminalIssue
    if (this.#elapsedMs() <= this.#limits.durationMs) return null
    const issue = sessionIssue(
      DRIVE_OBSERVE_SESSION_ISSUE_CODES.durationExceeded,
      `session exceeded ${this.#limits.durationMs} ms`,
      'infrastructure'
    )
    this.latchTerminal(issue, 'duration-exceeded')
    return issue
  }

  private latchTerminal(issue: RunIssue, reason: string): void
  {
    if (this.#state === 'closed') return
    if (this.#terminalIssue !== null)
    {
      if (
        this.#terminalIssue.code !== issue.code ||
        this.#terminalIssue.message !== issue.message
      )
        this.#addIssue(issue)
      return
    }
    this.#addIssue(issue)
    this.#terminalIssue = issue
    this.#terminalReason = reason
    this.#state = 'failed'
    this.#resolveTerminal(issue)
  }

  #budgets(): DriveObserveSessionBudgetsV1
  {
    return Object.freeze({
      commands: this.#commands,
      ticks: this.#tick,
      observations: this.#observations,
      runtimeObservation: structuredClone(this.#observationTotals),
    })
  }

  #terminalOutcome(issue: RunIssue): DriveObserveCommandOutcomeV1
  {
    return Object.freeze({
      kind: 'terminalIssue' as const,
      issue,
      tick: this.#tick,
      drawEpoch: this.#drawEpoch,
    })
  }

  #record(input: {
    readonly identity: TrustedCommandIdentity
    readonly normalizedCommand: DriveObserveNormalizedCommandV1 | null
    readonly status: DriveObserveCommandRecordV1['status']
    readonly tickBefore: number
    readonly drawEpochBefore: number
    readonly heldInputBefore: DriveObserveHeldInputV1
    readonly changed: boolean
    readonly result: DriveObserveCommandResultV1 | null
    readonly issue: RunIssue | null
    readonly startedAt: number
  }): DriveObserveCommandOutcomeV1
  {
    const record: DriveObserveCommandRecordV1 = Object.freeze({
      requestId: input.identity.requestId,
      sequence: input.identity.sequence,
      normalizedCommand: input.normalizedCommand,
      status: input.status,
      tickBefore: input.tickBefore,
      tickAfter: this.#tick,
      drawEpochBefore: input.drawEpochBefore,
      drawEpochAfter: this.#drawEpoch,
      heldInputBefore: input.heldInputBefore,
      heldInputAfter: this.#heldInput(),
      changed: input.changed,
      result: input.result,
      issue: input.issue,
      budgets: this.#budgets(),
      durationMs: Math.max(0, performance.now() - input.startedAt),
    })
    this.#records.push(record)
    return Object.freeze({ kind: 'command' as const, record })
  }

  #refusal(
    identity: TrustedCommandIdentity,
    normalizedCommand: DriveObserveNormalizedCommandV1 | null,
    issue: RunIssue,
    commandStartedAt: number,
    tickBefore: number,
    drawEpochBefore: number,
    heldInputBefore: DriveObserveHeldInputV1,
    result: DriveObserveCommandResultV1 | null = null
  ): DriveObserveCommandOutcomeV1
  {
    this.#addIssue(issue)
    return this.#record({
      identity,
      normalizedCommand,
      status: 'refused',
      tickBefore,
      drawEpochBefore,
      heldInputBefore,
      changed: false,
      result,
      issue,
      startedAt: commandStartedAt,
    })
  }

  #failure(
    identity: TrustedCommandIdentity,
    normalizedCommand: DriveObserveNormalizedCommandV1 | null,
    issue: RunIssue,
    reason: string,
    commandStartedAt: number,
    tickBefore: number,
    drawEpochBefore: number,
    heldInputBefore: DriveObserveHeldInputV1,
    changed = false,
    result: DriveObserveCommandResultV1 | null = null
  ): DriveObserveCommandOutcomeV1
  {
    this.latchTerminal(issue, reason)
    return this.#record({
      identity,
      normalizedCommand,
      status: 'failed',
      tickBefore,
      drawEpochBefore,
      heldInputBefore,
      changed,
      result,
      issue,
      startedAt: commandStartedAt,
    })
  }

  async #evaluate<T>(factory: () => Promise<T>): Promise<T>
  {
    if (this.#terminalIssue) throw this.#terminalIssue
    const evaluation = factory().then(
      (value) => ({ kind: 'value' as const, value }),
      (error) => ({ kind: 'error' as const, error })
    )
    const outcome = await Promise.race([
      evaluation,
      this.terminal.then((issue) => ({ kind: 'terminal' as const, issue })),
    ])
    if (outcome.kind === 'terminal') throw outcome.issue
    if (outcome.kind === 'error') throw outcome.error
    if (this.#terminalIssue) throw this.#terminalIssue
    return outcome.value
  }

  async #inspectDrawEpoch(): Promise<number>
  {
    const inspected = await this.#evaluate(() =>
      this.#host.page.evaluate(() => window.__spike!.inspectDriveObserve())
    )
    this.#acceptDrawEpoch(inspected.drawEpoch)
    return inspected.drawEpoch
  }

  #acceptDrawEpoch(value: number): void
  {
    if (!Number.isSafeInteger(value) || value < this.#drawEpoch)
    {
      throw sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.renderInstrumentationDrift,
        'drive-observe draw instrumentation returned an invalid epoch',
        'infrastructure'
      )
    }
  }

  async #verifyNoDraw(drawEpochBefore: number): Promise<void>
  {
    const drawEpochAfter = await this.#inspectDrawEpoch()
    this.#drawEpoch = drawEpochAfter
    if (drawEpochAfter !== drawEpochBefore)
    {
      throw sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.drawInvariant,
        `command changed draw epoch from ${drawEpochBefore} to ${drawEpochAfter}`,
        'infrastructure'
      )
    }
  }

  #issueFromError(error: unknown): RunIssue
  {
    if (isRunIssueLike(error)) return error
    const message = boundedMessage(error)
    if (message.includes('renderer instrumentation drifted'))
    {
      return sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.renderInstrumentationDrift,
        message,
        'infrastructure'
      )
    }
    return runtimeIssue(error)
  }

  #heldInputChanged(before: DriveObserveHeldInputV1): boolean
  {
    const after = this.#heldInput()
    return (
      before.keys.length !== after.keys.length ||
      before.keys.some((key, index) => key !== after.keys[index]) ||
      before.mouse.x !== after.mouse.x ||
      before.mouse.y !== after.mouse.y ||
      before.mouse.leftDown !== after.mouse.leftDown
    )
  }

  #runtimeChanged(
    tickBefore: number,
    drawEpochBefore: number,
    heldInputBefore: DriveObserveHeldInputV1
  ): boolean
  {
    return (
      this.#tick !== tickBefore ||
      this.#drawEpoch !== drawEpochBefore ||
      this.#heldInputChanged(heldInputBefore)
    )
  }

  async execute(input: unknown): Promise<DriveObserveCommandOutcomeV1>
  {
    if (this.#state !== 'ready' && this.#state !== 'active')
    {
      return this.#terminalOutcome(
        sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.sessionNotAccepting,
          `session state ${this.#state} does not accept commands`
        )
      )
    }
    if (this.#inFlight)
    {
      const issue = sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.concurrentCommand,
        'concurrent commands are not allowed'
      )
      this.latchTerminal(issue, 'concurrent-command')
      return this.#terminalOutcome(issue)
    }

    let complete!: () => void
    const completion = new Promise<void>((resolve) =>
    {
      complete = resolve
    })
    this.#inFlight = true
    this.#inFlightCompletion = completion
    try
    {
      return await this.#executeExclusive(input)
    }
    finally
    {
      this.#inFlight = false
      complete()
      if (this.#inFlightCompletion === completion)
        this.#inFlightCompletion = null
    }
  }

  async #executeExclusive(
    input: unknown
  ): Promise<DriveObserveCommandOutcomeV1>
  {
    const commandStartedAt = performance.now()
    const tickBefore = this.#tick
    const drawEpochBefore = this.#drawEpoch
    const heldInputBefore = this.#heldInput()
    const identity = trustedIdentity(input)
    if (identity === null)
    {
      const issue = sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.invalidCommandIdentity,
        'command requires a bounded requestId and nonnegative safe sequence and expectedTick'
      )
      this.latchTerminal(issue, 'invalid-command-identity')
      return this.#terminalOutcome(issue)
    }
    if (identity.sequence !== this.#nextSequence)
    {
      const issue = sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.sequenceMismatch,
        `command sequence ${identity.sequence} does not equal ${this.#nextSequence}`
      )
      this.latchTerminal(issue, 'sequence-mismatch')
      return this.#terminalOutcome(issue)
    }

    this.#nextSequence++
    this.#commands++
    if (this.#commands > this.#limits.commands)
    {
      return this.#failure(
        identity,
        null,
        sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.commandBudgetExceeded,
          `command count ${this.#commands} exceeds ${this.#limits.commands}`
        ),
        'command-budget-exceeded',
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore
      )
    }
    if (this.#requestIds.has(identity.requestId))
    {
      return this.#refusal(
        identity,
        null,
        sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.requestIdReused,
          'requestId was already used in this session'
        ),
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore
      )
    }
    this.#requestIds.add(identity.requestId)
    if (identity.expectedTick !== this.#tick)
    {
      return this.#refusal(
        identity,
        null,
        sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.expectedTickMismatch,
          `expectedTick ${identity.expectedTick} does not equal ${this.#tick}`
        ),
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore
      )
    }

    const parsed = parseCommand(identity)
    if (parsed === null)
    {
      return this.#refusal(
        identity,
        null,
        sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.invalidCommand,
          'command has an unsupported shape or value'
        ),
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore
      )
    }
    const durationIssue = this.#checkDuration()
    if (durationIssue)
    {
      return this.#failure(
        identity,
        parsed,
        durationIssue,
        'duration-exceeded',
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore
      )
    }

    try
    {
      return await this.#executeParsed({
        identity,
        command: parsed,
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore,
      })
    }
    catch (error)
    {
      this.#runtimePositionConfirmed = false
      const issue = this.#terminalIssue ?? this.#issueFromError(error)
      return this.#failure(
        identity,
        parsed,
        issue,
        this.#terminalReason === 'callback-returned'
          ? 'runtime-failed'
          : this.#terminalReason,
        commandStartedAt,
        tickBefore,
        drawEpochBefore,
        heldInputBefore,
        this.#runtimeChanged(tickBefore, drawEpochBefore, heldInputBefore)
      )
    }
  }

  async #executeParsed(input: {
    readonly identity: TrustedCommandIdentity
    readonly command: DriveObserveNormalizedCommandV1
    readonly commandStartedAt: number
    readonly tickBefore: number
    readonly drawEpochBefore: number
    readonly heldInputBefore: DriveObserveHeldInputV1
  }): Promise<DriveObserveCommandOutcomeV1>
  {
    const command = input.command
    if (command.command === 'greenFlag')
    {
      if (this.#greenFlagStarted)
      {
        return this.#refusal(
          input.identity,
          command,
          sessionIssue(
            DRIVE_OBSERVE_SESSION_ISSUE_CODES.greenFlagRepeated,
            'greenFlag may be accepted only once'
          ),
          input.commandStartedAt,
          input.tickBefore,
          input.drawEpochBefore,
          input.heldInputBefore
        )
      }
      await this.#evaluate(() =>
        this.#host.page.evaluate(() => window.__spike!.greenFlag())
      )
      await this.#verifyNoDraw(input.drawEpochBefore)
      this.#greenFlagStarted = true
      return this.#accepted(
        input,
        true,
        Object.freeze({ kind: 'greenFlag' as const, started: true as const })
      )
    }
    if (command.command === 'keyDown' || command.command === 'keyUp')
    {
      const down = command.command === 'keyDown'
      const alreadyDown = this.#keys.has(command.key)
      const changed = down !== alreadyDown
      if (changed)
      {
        await this.#evaluate(() =>
          this.#host.page.evaluate(
            (value: { key: string; down: boolean }) =>
            {
              if (value.down) window.__spike!.pressKey(value.key)
              else window.__spike!.releaseKey(value.key)
            },
            { key: command.key, down }
          )
        )
        if (down) this.#keys.add(command.key)
        else this.#keys.delete(command.key)
      }
      await this.#verifyNoDraw(input.drawEpochBefore)
      return this.#accepted(
        input,
        changed,
        Object.freeze({
          kind: 'input' as const,
          heldInput: this.#heldInput(),
        })
      )
    }
    if (
      command.command === 'mouseMove' ||
      command.command === 'mouseDown' ||
      command.command === 'mouseUp'
    )
    {
      const targetDown =
        command.command === 'mouseDown'
          ? true
          : command.command === 'mouseUp'
            ? false
            : this.#mouseLeftDown
      const positionChanged =
        command.x !== this.#mouseX || command.y !== this.#mouseY
      const buttonChanged = targetDown !== this.#mouseLeftDown
      const changed = positionChanged || buttonChanged
      if (changed)
      {
        const movement: {
          command: 'move' | 'down' | 'up'
          x: number
          y: number
        } = {
          command: buttonChanged ? (targetDown ? 'down' : 'up') : 'move',
          x: command.x,
          y: command.y,
        }
        await this.#evaluate(() =>
          this.#host.page.evaluate(
            (value: {
              command: 'move' | 'down' | 'up'
              x: number
              y: number
            }) =>
            {
              if (value.command === 'down')
                window.__spike!.mouseDown(value.x, value.y)
              else if (value.command === 'up')
                window.__spike!.mouseUp(value.x, value.y)
              else window.__spike!.moveMouse(value.x, value.y)
            },
            movement
          )
        )
        this.#mouseX = command.x
        this.#mouseY = command.y
        this.#mouseLeftDown = targetDown
      }
      await this.#verifyNoDraw(input.drawEpochBefore)
      return this.#accepted(
        input,
        changed,
        Object.freeze({
          kind: 'input' as const,
          heldInput: this.#heldInput(),
        })
      )
    }
    if (command.command === 'advance')
    {
      if (this.#tick + command.ticks > this.#limits.ticks)
      {
        return this.#failure(
          input.identity,
          command,
          createRunIssue({
            code: RUN_ISSUE_CODES.tickBudgetExceeded,
            kind: 'tick-budget',
            responsibility: 'project',
            message: `advance would exceed ${this.#limits.ticks} ticks`,
            location: { kind: 'project' },
          }),
          'tick-budget-exceeded',
          input.commandStartedAt,
          input.tickBefore,
          input.drawEpochBefore,
          input.heldInputBefore
        )
      }
      const ticksAdvanced = await this.#advance(command.ticks)
      return this.#accepted(
        input,
        ticksAdvanced > 0,
        Object.freeze({
          kind: 'advance' as const,
          ticksAdvanced,
        })
      )
    }
    if (command.command === 'observe')
    {
      if (this.#observations + 1 > this.#limits.observations)
      {
        return this.#failure(
          input.identity,
          command,
          sessionIssue(
            DRIVE_OBSERVE_SESSION_ISSUE_CODES.observationBudgetExceeded,
            `observation count ${this.#observations + 1} exceeds ${this.#limits.observations}`
          ),
          'observation-budget-exceeded',
          input.commandStartedAt,
          input.tickBefore,
          input.drawEpochBefore,
          input.heldInputBefore
        )
      }
      const read = await this.#evaluate(() =>
        this.#host.page.evaluate(
          (value: {
            tick: number
            sequence: number
            label: string | null
            heldInput: DriveObserveHeldInputV1
          }) =>
            window.__spike!.readDriveObserveState({
              tick: value.tick,
              commandSequence: value.sequence,
              label: value.label,
              heldInput: value.heldInput,
            }),
          {
            tick: this.#tick,
            sequence: input.identity.sequence,
            label: command.label,
            heldInput: this.#heldInput(),
          }
        )
      )
      this.#acceptDrawEpoch(read.drawEpoch)
      this.#drawEpoch = read.drawEpoch
      this.#observationTotals = read.capture.totals
      // charge only after a successful read + epoch accept
      this.#observations++
      const result: DriveObserveCommandResultV1 = Object.freeze({
        kind: 'observation' as const,
        label: command.label,
        capture: read.capture,
      })
      if (
        this.#tick !== input.tickBefore ||
        read.drawEpoch !== input.drawEpochBefore
      )
      {
        const issue = sessionIssue(
          this.#tick !== input.tickBefore
            ? DRIVE_OBSERVE_SESSION_ISSUE_CODES.tickInvariant
            : DRIVE_OBSERVE_SESSION_ISSUE_CODES.drawInvariant,
          'observation changed the authoritative tick or draw epoch',
          'infrastructure'
        )
        return this.#failure(
          input.identity,
          command,
          issue,
          'observation-invariant-failed',
          input.commandStartedAt,
          input.tickBefore,
          input.drawEpochBefore,
          input.heldInputBefore,
          false,
          result
        )
      }
      if (read.capture.status === 'refused')
      {
        const poisoned = 'resource' in read.capture.issue
        const issue = sessionIssue(
          poisoned
            ? DRIVE_OBSERVE_SESSION_ISSUE_CODES.observationPoisoned
            : DRIVE_OBSERVE_SESSION_ISSUE_CODES.observationRefused,
          `${read.capture.issue.code} at ${read.capture.issue.scope}`,
          poisoned ? 'project' : 'unsupported'
        )
        if (poisoned)
        {
          return this.#failure(
            input.identity,
            command,
            issue,
            'observation-poisoned',
            input.commandStartedAt,
            input.tickBefore,
            input.drawEpochBefore,
            input.heldInputBefore,
            false,
            result
          )
        }
        return this.#refusal(
          input.identity,
          command,
          issue,
          input.commandStartedAt,
          input.tickBefore,
          input.drawEpochBefore,
          input.heldInputBefore,
          result
        )
      }
      return this.#accepted(input, false, result)
    }

    this.#state = 'closing'
    this.#terminalReason = 'command-close'
    await this.releaseHeldInput()
    const changed =
      input.heldInputBefore.keys.length !== this.#keys.size ||
      input.heldInputBefore.mouse.leftDown !== this.#mouseLeftDown
    const result = Object.freeze({ kind: 'close' as const })
    if (this.#terminalIssue)
    {
      return this.#failure(
        input.identity,
        command,
        this.#terminalIssue,
        this.#terminalReason,
        input.commandStartedAt,
        input.tickBefore,
        input.drawEpochBefore,
        input.heldInputBefore,
        changed,
        result
      )
    }
    return this.#record({
      identity: input.identity,
      normalizedCommand: command,
      status: 'closed',
      tickBefore: input.tickBefore,
      drawEpochBefore: input.drawEpochBefore,
      heldInputBefore: input.heldInputBefore,
      changed,
      result,
      issue: null,
      startedAt: input.commandStartedAt,
    })
  }

  #accepted(
    input: {
      readonly identity: TrustedCommandIdentity
      readonly command: DriveObserveNormalizedCommandV1
      readonly commandStartedAt: number
      readonly tickBefore: number
      readonly drawEpochBefore: number
      readonly heldInputBefore: DriveObserveHeldInputV1
    },
    changed: boolean,
    result: DriveObserveCommandResultV1
  ): DriveObserveCommandOutcomeV1
  {
    // duration is a pre-command gate; completed mutations stay accepted
    if (
      this.#terminalIssue &&
      this.#terminalIssue.code !==
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.durationExceeded
    )
    {
      return this.#failure(
        input.identity,
        input.command,
        this.#terminalIssue,
        this.#terminalReason,
        input.commandStartedAt,
        input.tickBefore,
        input.drawEpochBefore,
        input.heldInputBefore,
        changed,
        result
      )
    }
    if (this.#state === 'ready' || this.#state === 'active')
      this.#state = 'active'
    return this.#record({
      identity: input.identity,
      normalizedCommand: input.command,
      status: 'accepted',
      tickBefore: input.tickBefore,
      drawEpochBefore: input.drawEpochBefore,
      heldInputBefore: input.heldInputBefore,
      changed,
      result,
      issue: null,
      startedAt: input.commandStartedAt,
    })
  }

  async #advance(ticks: number): Promise<number>
  {
    if (this.#pacing === 'instant')
    {
      const advanced = await this.#evaluate(() =>
        this.#host.page.evaluate(
          (count) => window.__spike!.advanceDriveObserve(count),
          ticks
        )
      )
      if (advanced.ticksAdvanced !== ticks)
      {
        throw sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.tickInvariant,
          `runtime advanced ${advanced.ticksAdvanced} of ${ticks} ticks`,
          'infrastructure'
        )
      }
      this.#acceptDrawEpoch(advanced.drawEpoch)
      this.#tick += ticks
      this.#drawEpoch = advanced.drawEpoch
      return ticks
    }

    // fail closed before any tick so retained advances stay exact for replay
    const remainingMs = this.#limits.durationMs - this.#elapsedMs()
    const realtimeBudgetMs = ticks * RUNNER_TICK_MS
    if (realtimeBudgetMs > remainingMs)
    {
      const issue = sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.durationExceeded,
        `realtime advance of ${ticks} ticks needs ${Math.ceil(realtimeBudgetMs)} ms but only ${Math.max(0, Math.floor(remainingMs))} ms remain`,
        'infrastructure'
      )
      this.latchTerminal(issue, 'duration-exceeded')
      throw issue
    }
    if (this.#terminalIssue) throw this.#terminalIssue

    for (let index = 0; index < ticks; index++)
    {
      const durationIssue = this.#checkDuration()
      if (durationIssue) throw durationIssue
      if (this.#terminalIssue) throw this.#terminalIssue
      const advanced = await this.#evaluate(() =>
        this.#host.page.evaluate(() => window.__spike!.advanceDriveObserve(1))
      )
      if (advanced.ticksAdvanced !== 1)
      {
        throw sessionIssue(
          DRIVE_OBSERVE_SESSION_ISSUE_CODES.tickInvariant,
          `runtime advanced ${advanced.ticksAdvanced} instead of one tick`,
          'infrastructure'
        )
      }
      this.#acceptDrawEpoch(advanced.drawEpoch)
      this.#tick++
      this.#drawEpoch = advanced.drawEpoch
      await sleep(RUNNER_TICK_MS)
    }
    return ticks
  }

  async #runCleanupStep(
    step: () => Promise<void>,
    deadline: number
  ): Promise<boolean>
  {
    const remainingMs = deadline - performance.now()
    if (remainingMs <= 0) return false
    let timer: NodeJS.Timeout | undefined
    try
    {
      const completion = step().then(
        () => ({ kind: 'completed' as const }),
        (error) => ({ kind: 'failed' as const, error })
      )
      const outcome = await Promise.race([
        completion,
        new Promise<{ readonly kind: 'timed-out' }>((resolve) =>
        {
          timer = setTimeout(
            () => resolve({ kind: 'timed-out' as const }),
            remainingMs
          )
        }),
      ])
      if (outcome.kind === 'failed') throw outcome.error
      return outcome.kind === 'completed'
    }
    finally
    {
      if (timer) clearTimeout(timer)
    }
  }

  async #verifyCleanupNoDraw(
    drawEpochBefore: number,
    active: () => boolean
  ): Promise<void>
  {
    const inspected = await this.#host.page.evaluate(() =>
      window.__spike!.inspectDriveObserve()
    )
    if (!active()) return
    this.#acceptDrawEpoch(inspected.drawEpoch)
    this.#drawEpoch = inspected.drawEpoch
    if (inspected.drawEpoch !== drawEpochBefore)
    {
      throw sessionIssue(
        DRIVE_OBSERVE_SESSION_ISSUE_CODES.drawInvariant,
        `command changed draw epoch from ${drawEpochBefore} to ${inspected.drawEpoch}`,
        'infrastructure'
      )
    }
  }

  #recordCleanupAction(
    command: DriveObserveCleanupActionV1['command'],
    heldInputBefore: DriveObserveHeldInputV1,
    drawEpochBefore: number,
    issue: RunIssue | null
  ): void
  {
    this.#cleanupActions.push(
      Object.freeze({
        command: Object.freeze(command),
        heldInputBefore,
        heldInputAfter: this.#heldInput(),
        drawEpochBefore,
        drawEpochAfter: this.#drawEpoch,
        issue,
      })
    )
  }

  #failCleanup(error: unknown): RunIssue
  {
    this.#runtimePositionConfirmed = false
    const issue = cleanupIssue(error)
    this.latchTerminal(issue, 'cleanup-failed')
    poisonRunnerExecution(issue)
    return issue
  }

  #recordRemainingCleanupActions(
    keys: readonly string[],
    mouseWasHeld: boolean,
    issue: RunIssue
  ): void
  {
    for (const key of keys)
    {
      const before = this.#heldInput()
      this.#recordCleanupAction(
        { command: 'keyUp', key },
        before,
        this.#drawEpoch,
        issue
      )
    }
    if (!mouseWasHeld || !this.#mouseLeftDown) return
    const before = this.#heldInput()
    this.#recordCleanupAction(
      {
        command: 'mouseUp',
        x: this.#mouseX,
        y: this.#mouseY,
        button: 'left',
      },
      before,
      this.#drawEpoch,
      issue
    )
  }

  releaseHeldInput(): Promise<void>
  {
    this.#releaseHeldInputPromise ??= this.#releaseHeldInput()
    return this.#releaseHeldInputPromise
  }

  async #releaseHeldInput(): Promise<void>
  {
    const deadline = performance.now() + RENDERED_PAGE_CLOSE_TIMEOUT_MS
    const keys = [...this.#keys].sort()
    const mouseWasHeld = this.#mouseLeftDown
    for (const [index, key] of keys.entries())
    {
      const before = this.#heldInput()
      const drawBefore = this.#drawEpoch
      let issue: RunIssue | null = null
      let active = true
      try
      {
        const completed = await this.#runCleanupStep(async () =>
        {
          await this.#host.page.evaluate(
            (value) => window.__spike!.releaseKey(value),
            key
          )
          if (!active) return
          this.#keys.delete(key)
          await this.#verifyCleanupNoDraw(drawBefore, () => active)
        }, deadline)
        if (!completed)
        {
          active = false
          issue = this.#failCleanup(
            new Error(
              `held-input cleanup exceeded ${RENDERED_PAGE_CLOSE_TIMEOUT_MS} ms`
            )
          )
          void this.#closeHost()
          this.#recordCleanupAction(
            { command: 'keyUp', key },
            before,
            drawBefore,
            issue
          )
          this.#recordRemainingCleanupActions(
            keys.slice(index + 1),
            mouseWasHeld,
            issue
          )
          return
        }
      }
      catch (error)
      {
        active = false
        issue = this.#failCleanup(error)
      }
      this.#recordCleanupAction(
        { command: 'keyUp', key },
        before,
        drawBefore,
        issue
      )
    }

    if (!this.#mouseLeftDown) return
    const before = this.#heldInput()
    const drawBefore = this.#drawEpoch
    let issue: RunIssue | null = null
    let active = true
    try
    {
      const completed = await this.#runCleanupStep(async () =>
      {
        await this.#host.page.evaluate(
          (value: { x: number; y: number }) =>
            window.__spike!.mouseUp(value.x, value.y),
          { x: this.#mouseX, y: this.#mouseY }
        )
        if (!active) return
        this.#mouseLeftDown = false
        await this.#verifyCleanupNoDraw(drawBefore, () => active)
      }, deadline)
      if (!completed)
      {
        active = false
        issue = this.#failCleanup(
          new Error(
            `held-input cleanup exceeded ${RENDERED_PAGE_CLOSE_TIMEOUT_MS} ms`
          )
        )
        void this.#closeHost()
      }
    }
    catch (error)
    {
      active = false
      issue = this.#failCleanup(error)
    }
    this.#recordCleanupAction(
      {
        command: 'mouseUp',
        x: this.#mouseX,
        y: this.#mouseY,
        button: 'left',
      },
      before,
      drawBefore,
      issue
    )
  }

  async beginCallbackCleanup(): Promise<void>
  {
    if (this.#durationTimer)
    {
      clearTimeout(this.#durationTimer)
      this.#durationTimer = null
    }
    if (this.#state === 'ready' || this.#state === 'active')
    {
      this.#state = 'closing'
      this.#terminalReason = 'callback-returned'
    }
    const completion = this.#inFlightCompletion
    if (!completion) return
    await this.#closeHost()
    if (await settlesWithin(completion, RENDERED_PAGE_CLOSE_TIMEOUT_MS)) return
    const issue = cleanupIssue(
      new Error(
        `in-flight browser command did not settle within ${RENDERED_PAGE_CLOSE_TIMEOUT_MS} ms after close`
      )
    )
    this.latchTerminal(issue, 'cleanup-failed')
    poisonRunnerExecution(issue)
  }

  finishCleanup(cleanupFailures: readonly RunIssue[]): void
  {
    const [firstCleanupFailure, ...laterCleanupFailures] = cleanupFailures
    if (firstCleanupFailure)
    {
      this.latchTerminal(firstCleanupFailure, 'cleanup-failed')
      poisonRunnerExecution(firstCleanupFailure)
    }
    for (const cleanupFailure of laterCleanupFailures)
      this.#addIssue(cleanupFailure)
    if (this.#state === 'closing') this.#state = 'closed'
  }

  report(
    console: BrowserConsoleCollector,
    ready: DriveObserveSessionReadyV1 | null = this.ready
  ): DriveObserveSessionReportV1
  {
    return Object.freeze({
      state: this.#state === 'closed' ? 'closed' : 'failed',
      terminalReason: this.#terminalReason,
      ready,
      tick: this.#tick,
      drawEpoch: this.#drawEpoch,
      runtimePositionConfirmed: this.#runtimePositionConfirmed,
      heldInput: this.#heldInput(),
      budgets: this.#budgets(),
      records: Object.freeze([...this.#records]),
      cleanupActions: Object.freeze([...this.#cleanupActions]),
      consoleEntries: Object.freeze([...console.entries]),
      consoleSummary: console.summary(),
      issues: Object.freeze([...this.#issues]),
      droppedIssues: this.#droppedIssues,
      elapsedMs: this.#elapsedMs(),
    })
  }
}

function openingReport(
  issue: RunIssue,
  console: BrowserConsoleCollector,
  startedAt: number,
  cleanupFailures: readonly RunIssue[]
): DriveObserveSessionReportV1
{
  const [firstCleanupFailure, ...laterCleanupFailures] = cleanupFailures
  const firstCleanupDuplicatesIssue =
    firstCleanupFailure?.code === issue.code &&
    firstCleanupFailure.message === issue.message
  const issues = [
    issue,
    ...(firstCleanupFailure && !firstCleanupDuplicatesIssue
      ? [firstCleanupFailure]
      : []),
    ...laterCleanupFailures,
  ]
  return Object.freeze({
    state: 'failed' as const,
    terminalReason:
      cleanupFailures.length > 0 ? 'cleanup-failed' : 'opening-failed',
    ready: null,
    tick: 0,
    drawEpoch: 0,
    runtimePositionConfirmed: false,
    heldInput: heldInput(new Set(), 0, 0, false),
    budgets: Object.freeze({
      commands: 0,
      ticks: 0,
      observations: 0,
      runtimeObservation: ZERO_OBSERVATION_TOTALS,
    }),
    records: Object.freeze([]),
    cleanupActions: Object.freeze([]),
    consoleEntries: Object.freeze([...console.entries]),
    consoleSummary: console.summary(),
    issues: Object.freeze(issues),
    droppedIssues: 0,
    elapsedMs: Math.max(0, performance.now() - startedAt),
  })
}

export async function withInteractiveBrowserSession<T>(
  options: InteractiveBrowserSessionOptionsV1,
  callback: (session: DriveObserveSessionV1) => Promise<T>
): Promise<InteractiveBrowserSessionOutcomeV1<T>>
{
  const openedAt = performance.now()
  const console = new BrowserConsoleCollector()
  const limits = resolveLimits(options?.limits)
  if (!validOptions(options, limits))
  {
    const issue = sessionIssue(
      DRIVE_OBSERVE_SESSION_ISSUE_CODES.invalidOptions,
      'interactive browser session options are invalid'
    )
    return {
      callback: { status: 'not-invoked', issue },
      report: openingReport(issue, console, openedAt, []),
    }
  }

  try
  {
    return await withRunnerExecution(async () =>
    {
      let host: RenderedPageHost | null = null
      let session: InteractiveBrowserSession | null = null
      let stage: BrowserRunStage = 'launch'
      let openingIssue: RunIssue | null = null
      const cleanupFailures: RunIssue[] = []
      let closingHost = false
      let closePromise: Promise<void> | null = null
      const closeHost = (): Promise<void> =>
      {
        if (!host) return Promise.resolve()
        closingHost = true
        closePromise ??= host.close()
        return closePromise
      }
      const latch = (issue: RunIssue, reason: string): void =>
      {
        if (session) session.latchExternalIssue(issue, reason)
        else openingIssue ??= issue
      }
      const onAbort = (): void =>
      {
        if (!options.signal) return
        const issue = cancellationIssue(options.signal)
        latch(
          issue,
          issue.code === DRIVE_OBSERVE_SESSION_ISSUE_CODES.durationExceeded
            ? 'duration-exceeded'
            : 'cancelled'
        )
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) onAbort()

      try
      {
        host = await openRenderedPageHost({
          runtimeKind: 'turbowarp',
          sb3: options.sb3,
          headless: options.headless,
          allowNetwork: false,
          allowedOrigins: [],
          blockPhysicalInput: true,
          onPageError: (error) =>
            latch(
              createRunIssue({
                code: RUN_ISSUE_CODES.browserPageError,
                kind: 'runtime',
                responsibility: 'project',
                message: boundedMessage(error),
                location: { kind: 'project' },
              }),
              'page-error'
            ),
          onConsole: (type, text) => void console.add(type, text),
          onNetworkDenied: (url) =>
            latch(
              createRunIssue({
                code: RUN_ISSUE_CODES.networkRequestDenied,
                kind: 'network-policy',
                responsibility: 'unsupported',
                message: boundedMessage(`blocked network request: ${url}`),
              }),
              'network-denied'
            ),
          onCleanupError: (error) =>
          {
            cleanupFailures.push(cleanupIssue(error))
          },
          signal: options.signal,
        })
        host.page.on('crash', () =>
          latch(runtimeIssue('browser page crashed'), 'page-crashed')
        )
        host.page.on('close', () =>
        {
          if (closingHost) return
          latch(
            sessionIssue(
              DRIVE_OBSERVE_SESSION_ISSUE_CODES.pageClosed,
              'browser page closed unexpectedly',
              'infrastructure'
            ),
            'page-closed'
          )
        })
        host.context.on('close', () =>
        {
          if (closingHost) return
          latch(
            sessionIssue(
              DRIVE_OBSERVE_SESSION_ISSUE_CODES.contextClosed,
              'browser context closed unexpectedly',
              'infrastructure'
            ),
            'context-closed'
          )
        })
        host.browser.on('disconnected', () =>
        {
          if (closingHost) return
          latch(
            sessionIssue(
              DRIVE_OBSERVE_SESSION_ISSUE_CODES.browserDisconnected,
              'browser disconnected unexpectedly',
              'infrastructure'
            ),
            'browser-disconnected'
          )
        })

        if (openingIssue) throw openingIssue
        stage = 'project-load'
        await awaitAbortable(
          () =>
            host!.page.evaluate(
              (projectPath) => window.__spike!.load(projectPath, null),
              host!.projectPath
            ),
          options.signal
        )
        if (openingIssue) throw openingIssue
        stage = 'setup'
        await awaitAbortable(
          () =>
            host!.page.evaluate(
              (determinism: { seed: number; fixedDateMs: number }) =>
                window.__spike!.prep(determinism),
              { seed: options.seed, fixedDateMs: options.fixedDateMs }
            ),
          options.signal
        )
        const begun = await awaitAbortable(
          () =>
            host!.page.evaluate(
              (caps) => window.__spike!.beginDriveObserve(caps),
              DEFAULT_RUNTIME_OBSERVATION_CAPS
            ),
          options.signal
        )
        if (openingIssue) throw openingIssue
        stage = 'runtime'
        session = new InteractiveBrowserSession({
          host,
          options,
          limits,
          drawEpoch: begun.drawEpoch,
          closeHost,
          startedAt: performance.now(),
        })

        let callbackActive = true
        const callbackSettlement = Promise.resolve()
          .then(() => callback(session!))
          .then<
            InteractiveBrowserSessionOutcomeV1<T>['callback'],
            InteractiveBrowserSessionOutcomeV1<T>['callback']
          >(
            (value) => ({ status: 'completed', value }),
            (error) =>
            {
              const issue = sessionIssue(
                DRIVE_OBSERVE_SESSION_ISSUE_CODES.callbackFailed,
                boundedMessage(error),
                'infrastructure'
              )
              if (callbackActive)
                session!.latchExternalIssue(issue, 'callback-failed')
              return { status: 'failed', issue }
            }
          )
        const callbackEvent = await Promise.race([
          callbackSettlement.then((outcome) => ({
            kind: 'callback' as const,
            outcome,
          })),
          session.terminal.then((issue) => ({
            kind: 'terminal' as const,
            issue,
          })),
        ])
        let callbackOutcome: InteractiveBrowserSessionOutcomeV1<T>['callback']
        if (callbackEvent.kind === 'callback')
          callbackOutcome = callbackEvent.outcome
        else if (
          await settlesWithin(
            callbackSettlement.then(() => undefined),
            RENDERED_PAGE_CLOSE_TIMEOUT_MS
          )
        )
          callbackOutcome = await callbackSettlement
        else
        {
          callbackActive = false
          callbackOutcome = {
            status: 'failed',
            issue: callbackEvent.issue,
          }
        }

        await session.beginCallbackCleanup()
        await session.releaseHeldInput()
        await closeHost()
        session.finishCleanup(cleanupFailures)
        return {
          callback: callbackOutcome,
          report: session.report(console),
        }
      }
      catch (error)
      {
        const issue = openingIssue ?? browserFailureIssue(error, stage, false)
        closingHost = true
        if (session)
        {
          session.latchExternalIssue(issue, 'runtime-failed')
          await session.beginCallbackCleanup()
          await session.releaseHeldInput()
        }
        await closeHost()
        if (cleanupFailures[0]) poisonRunnerExecution(cleanupFailures[0])
        if (session)
        {
          session.finishCleanup(cleanupFailures)
          return {
            callback: {
              status: 'failed' as const,
              issue,
            },
            report: session.report(console),
          }
        }
        return {
          callback: {
            status: 'not-invoked' as const,
            issue,
          },
          report: openingReport(issue, console, openedAt, cleanupFailures),
        }
      }
      finally
      {
        options.signal?.removeEventListener('abort', onAbort)
      }
    })
  }
  catch (error)
  {
    const issue =
      error !== null && typeof error === 'object' && 'issue' in error
        ? (error as { issue: RunIssue }).issue
        : runtimeIssue(error)
    return {
      callback: { status: 'not-invoked', issue },
      report: openingReport(issue, console, openedAt, []),
    }
  }
}
