// scripts/project/drive-observe.ts
// runs one strict JSONL drive-observe session & retains exact private evidence

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import {
  DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1,
  MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1,
  newRunId,
  withInteractiveBrowserSession,
  type DriveObserveCommandRecordV1,
  type DriveObserveSessionV1,
  type RunIssue,
} from '@scratch-agent/runner'
import {
  DEFAULT_SB3_LIMITS,
  admitSb3,
  validateAdmittedSb3,
  type Sb3Admission,
} from '@scratch-agent/sb3'

import {
  createPrivateDirectoryExclusive,
  ensurePrivateDirectory,
  readBoundedRegularFileNoFollow,
  readContainedRegularFile,
  resolveContainedPath,
  writeExclusivePrivateFile,
} from '../lib/private-fs.js'
import {
  DRIVE_OBSERVE_FIXED_DATE_MS,
  DRIVE_OBSERVE_MAX_JSON_DEPTH,
  DRIVE_OBSERVE_MAX_LINE_BYTES,
  DRIVE_OBSERVE_PROTOCOL,
  DRIVE_OBSERVE_SCHEMA_VERSION,
  DRIVE_OBSERVE_SEED,
  DriveObserveRequestAliases,
  assertBoundedJsonDepth,
  artifactIdentity,
  canonicalJsonArtifactBytes,
  normalizeCommandRecord,
  normalizedCleanupActions,
  observationArtifact,
  orderedArtifactHash,
  orderedRecordHash,
  prettyJson,
  reportMarkdown,
  runtimeDescriptorHash,
  stableHash,
  terminalProjection,
  type DriveObserveArtifactIdentityV1,
  type DriveObserveInputIdentityFileV1,
  type DriveObserveNormalizedRecordV1,
  type DriveObserveNormalizedTranscriptV1,
  type DriveObserveReportV1,
  type DriveObserveTerminalInputV1,
} from './drive-observe-evidence.js'

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000
const MAX_IDLE_TIMEOUT_MS = 15 * 60_000
const MAX_JSON_REPORT_BYTES = 16 * 1024 * 1024
let forceExitAfterEvidence = false

interface CliOptions
{
  readonly input: string
  readonly runsRoot: string
  readonly headless: boolean
  readonly pacing: 'instant' | 'realtime'
  readonly maxCommands: number
  readonly maxTicks: number
  readonly maxObservations: number
  readonly idleTimeoutMs: number
  readonly sessionTimeoutMs: number
}

interface RunLayout
{
  readonly id: string
  readonly root: string
  readonly input: string
  readonly observations: string
  readonly transcript: string
  readonly browser: string
}

type InputFrame =
  | { readonly kind: 'line'; readonly line: number; readonly bytes: Buffer }
  | {
      readonly kind: 'transportIssue'
      readonly line: number
      readonly code: string
      readonly message: string
      readonly bytes: Buffer
    }

interface ObservationRetention
{
  readonly artifact: DriveObserveArtifactIdentityV1
  readonly bytes: Uint8Array
}

interface ForensicCommand
{
  readonly type: 'command'
  readonly protocol: typeof DRIVE_OBSERVE_PROTOCOL
  readonly sessionId: string
  readonly inputLine: number
  readonly receivedAt: string
  readonly pacing: 'instant' | 'realtime'
  readonly rawInput: unknown
  readonly record: unknown
  readonly observation: DriveObserveArtifactIdentityV1 | null
  readonly stableSha256: string
}

interface ForensicTerminal
{
  readonly type: 'transportIssue' | 'sessionIssue'
  readonly protocol: typeof DRIVE_OBSERVE_PROTOCOL
  readonly sessionId: string
  readonly inputLine: number
  readonly tick: number
  readonly drawEpoch: number
  readonly issue: { readonly code: string; readonly message: string }
  readonly evidenceSha256: string
}

interface ProtocolResult
{
  readonly outerReason: string
  readonly records: readonly DriveObserveNormalizedRecordV1[]
  readonly observations: readonly DriveObserveArtifactIdentityV1[]
  readonly forensic: readonly (ForensicCommand | ForensicTerminal)[]
  readonly terminalInput: DriveObserveTerminalInputV1 | null
}

interface SignalLatch
{
  readonly promise: Promise<'sigint' | 'sigterm'>
  dispose(): void
}

interface ProtocolStop
{
  readonly outerReason: string
  readonly sessionIssue: RunIssue | null
}

interface ProtocolStopLatch
{
  readonly signal: AbortSignal
  readonly promise: Promise<ProtocolStop>
  readonly current: () => ProtocolStop | null
  dispose(): void
}

function usageText(): string
{
  return [
    'usage: npm --silent run drive-observe -- \\',
    '  --input <absolute.sb3> [--runs-root <absolute-dir>] \\',
    '  [--headless] [--pace <instant|realtime>] \\',
    '  [--max-commands <1..256>] \\',
    '  [--max-ticks <1..10000>] [--max-observations <1..64>] \\',
    '  [--idle-timeout-ms <1..900000>] \\',
    '  [--session-timeout-ms <1..1800000>]',
  ].join('\n')
}

function usage(): never
{
  throw new Error(usageText())
}

function positiveInteger(value: string, maximum: number): number
{
  if (!/^[1-9][0-9]*$/.test(value)) usage()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) usage()
  return parsed
}

function parseArgs(argv: readonly string[]): CliOptions | 'help'
{
  if (argv.length === 1 && argv[0] === '--help') return 'help'
  let input: string | undefined
  let runsRoot = resolve('runs')
  let headless = false
  let pacing: CliOptions['pacing'] = 'instant'
  let maxCommands = DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1.commands
  let maxTicks = DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1.ticks
  let maxObservations = DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1.observations
  let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
  let sessionTimeoutMs = DEFAULT_DRIVE_OBSERVE_SESSION_LIMITS_V1.durationMs
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index++)
  {
    const flag = argv[index]
    if (
      flag !== '--input' &&
      flag !== '--runs-root' &&
      flag !== '--headless' &&
      flag !== '--pace' &&
      flag !== '--max-commands' &&
      flag !== '--max-ticks' &&
      flag !== '--max-observations' &&
      flag !== '--idle-timeout-ms' &&
      flag !== '--session-timeout-ms'
    )
      usage()
    if (seen.has(flag)) usage()
    seen.add(flag)
    if (flag === '--headless')
    {
      headless = true
      continue
    }
    const value = argv[++index]
    if (!value || value.startsWith('--')) usage()
    if (flag === '--input')
    {
      if (!isAbsolute(value)) usage()
      input = resolve(value)
    }
    else if (flag === '--runs-root')
    {
      if (!isAbsolute(value)) usage()
      runsRoot = resolve(value)
    }
    else if (flag === '--pace')
    {
      if (value !== 'instant' && value !== 'realtime') usage()
      pacing = value
    }
    else if (flag === '--max-commands')
      maxCommands = positiveInteger(
        value,
        MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1.commands
      )
    else if (flag === '--max-ticks')
      maxTicks = positiveInteger(
        value,
        MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1.ticks
      )
    else if (flag === '--max-observations')
      maxObservations = positiveInteger(
        value,
        MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1.observations
      )
    else if (flag === '--idle-timeout-ms')
      idleTimeoutMs = positiveInteger(value, MAX_IDLE_TIMEOUT_MS)
    else
      sessionTimeoutMs = positiveInteger(
        value,
        MAX_DRIVE_OBSERVE_SESSION_LIMITS_V1.durationMs
      )
  }
  if (!input) usage()
  return {
    input,
    runsRoot,
    headless,
    pacing,
    maxCommands,
    maxTicks,
    maxObservations,
    idleTimeoutMs,
    sessionTimeoutMs,
  }
}

function sourceRevision(): string
{
  if (process.env.SOURCE_REVISION) return process.env.SOURCE_REVISION
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

function createLayout(runsRoot: string): RunLayout
{
  if (existsSync(runsRoot))
  {
    const stat = lstatSync(runsRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('runs root must be one non-symlink directory')
  }
  else ensurePrivateDirectory(runsRoot)
  const id = `drive-observe-${newRunId()}`
  const root = join(runsRoot, id)
  createPrivateDirectoryExclusive(root)
  const layout = {
    id,
    root,
    input: join(root, 'input'),
    observations: join(root, 'observations'),
    transcript: join(root, 'transcript'),
    browser: join(root, 'browser'),
  }
  for (const path of [
    layout.input,
    layout.observations,
    layout.transcript,
    layout.browser,
  ])
    createPrivateDirectoryExclusive(path)
  return layout
}

function writeArtifact(
  layout: RunLayout,
  relativePath: string,
  value: Uint8Array | string
): DriveObserveArtifactIdentityV1
{
  const path = resolveContainedPath(layout.root, relativePath)
  writeExclusivePrivateFile(path, value)
  return artifactIdentity(relativePath, value)
}

async function admitInput(path: string): Promise<{
  readonly bytes: Uint8Array
  readonly admission: Sb3Admission
  readonly projectVersion: number
}>
{
  const bytes = readBoundedRegularFileNoFollow(
    path,
    DEFAULT_SB3_LIMITS.maxCompressedBytes,
    'selected input'
  )
  const admission = await admitSb3(bytes)
  const validation = await validateAdmittedSb3(bytes)
  if (!validation.ok)
    throw new Error(
      `selected input failed Scratch 3 validation: ${validation.errors.join('; ')}`
    )
  return { bytes, admission, projectVersion: validation.projectVersion }
}

async function writeOutput(
  value: unknown,
  stop: ProtocolStopLatch
): Promise<ProtocolStop | null>
{
  const line = JSON.stringify(value)
  const bytes = Buffer.byteLength(line, 'utf8')
  if (bytes > DRIVE_OBSERVE_MAX_LINE_BYTES)
    throw new Error(
      `protocol output exceeds ${DRIVE_OBSERVE_MAX_LINE_BYTES} bytes`
    )
  if (process.stdout.destroyed)
  {
    forceExitAfterEvidence = true
    return { outerReason: 'output-closed', sessionIssue: null }
  }
  if (process.stdout.write(`${line}\n`)) return null
  return await new Promise<ProtocolStop | null>((resolveWrite) =>
  {
    const finish = (result: ProtocolStop | null): void =>
    {
      process.stdout.off('drain', onDrain)
      process.stdout.off('error', onError)
      stop.signal.removeEventListener('abort', onAbort)
      resolveWrite(result)
    }
    const onDrain = (): void => finish(null)
    const onError = (): void =>
    {
      forceExitAfterEvidence = true
      finish({ outerReason: 'output-failed', sessionIssue: null })
    }
    const onAbort = (): void =>
    {
      forceExitAfterEvidence = true
      process.stdout.destroy()
      finish(
        stop.current() ?? {
          outerReason: 'output-interrupted',
          sessionIssue: null,
        }
      )
    }
    process.stdout.once('drain', onDrain)
    process.stdout.once('error', onError)
    stop.signal.addEventListener('abort', onAbort, { once: true })
    if (stop.signal.aborted) onAbort()
  })
}

async function* inputFrames(): AsyncGenerator<InputFrame>
{
  let pending = Buffer.alloc(0)
  let line = 0
  for await (const chunk of process.stdin)
  {
    pending = Buffer.concat([
      pending,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ])
    while (true)
    {
      const newline = pending.indexOf(0x0a)
      if (newline === -1) break
      line++
      let bytes = pending.subarray(0, newline)
      pending = pending.subarray(newline + 1)
      if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, -1)
      if (bytes.byteLength > DRIVE_OBSERVE_MAX_LINE_BYTES)
      {
        yield {
          kind: 'transportIssue',
          line,
          code: 'drive-observe.input-line-too-large',
          message: `input line exceeds ${DRIVE_OBSERVE_MAX_LINE_BYTES} bytes`,
          bytes: Buffer.from(
            bytes.subarray(0, DRIVE_OBSERVE_MAX_LINE_BYTES + 1)
          ),
        }
        return
      }
      yield { kind: 'line', line, bytes: Buffer.from(bytes) }
    }
    if (pending.byteLength > DRIVE_OBSERVE_MAX_LINE_BYTES)
    {
      yield {
        kind: 'transportIssue',
        line: line + 1,
        code: 'drive-observe.input-line-too-large',
        message: `input line exceeds ${DRIVE_OBSERVE_MAX_LINE_BYTES} bytes`,
        bytes: Buffer.from(
          pending.subarray(0, DRIVE_OBSERVE_MAX_LINE_BYTES + 1)
        ),
      }
      return
    }
  }
  if (pending.byteLength > 0)
  {
    line++
    if (pending.at(-1) === 0x0d) pending = pending.subarray(0, -1)
    yield { kind: 'line', line, bytes: pending }
  }
}

function signalLatch(): SignalLatch
{
  let resolveSignal!: (signal: 'sigint' | 'sigterm') => void
  const promise = new Promise<'sigint' | 'sigterm'>((resolve) =>
  {
    resolveSignal = resolve
  })
  const onSigint = (): void => resolveSignal('sigint')
  const onSigterm = (): void => resolveSignal('sigterm')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  return {
    promise,
    dispose(): void
    {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    },
  }
}

function protocolStopLatch(input: {
  readonly signal: SignalLatch
  readonly session: DriveObserveSessionV1
  readonly absoluteDeadlineMs: number
}): ProtocolStopLatch
{
  const controller = new AbortController()
  let stopped: ProtocolStop | null = null
  let resolveStop!: (stop: ProtocolStop) => void
  const promise = new Promise<ProtocolStop>((resolve) =>
  {
    resolveStop = resolve
  })
  const stop = (next: ProtocolStop): void =>
  {
    if (stopped !== null) return
    stopped = next
    resolveStop(next)
    controller.abort()
  }
  void input.signal.promise.then((signal) =>
    stop({ outerReason: signal, sessionIssue: null })
  )
  void input.session.terminal.then((issue) =>
    stop({ outerReason: 'runner-terminal', sessionIssue: issue })
  )
  const timer = setTimeout(
    () =>
      stop({
        outerReason: 'absolute-timeout',
        sessionIssue: null,
      }),
    Math.max(0, input.absoluteDeadlineMs - Date.now())
  )
  timer.unref()
  return {
    signal: controller.signal,
    promise,
    current: () => stopped,
    dispose(): void
    {
      clearTimeout(timer)
    },
  }
}

function waitForIdle(durationMs: number): {
  readonly promise: Promise<'idle-timeout'>
  cancel(): void
}
{
  let timer: NodeJS.Timeout
  const promise = new Promise<'idle-timeout'>((resolve) =>
  {
    timer = setTimeout(() => resolve('idle-timeout'), durationMs)
    timer.unref()
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

function issueEnvelope(issue: RunIssue): { code: string; message: string }
{
  return { code: issue.code, message: issue.message }
}

function expectedTick(input: unknown, fallback: number): number
{
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Number.isSafeInteger((input as Record<string, unknown>).expectedTick)
  )
    return (input as { expectedTick: number }).expectedTick
  return fallback
}

function sessionId(): string
{
  return `drive-observe-${newRunId()}-${process.pid}`
}

function observationSummary(
  artifact: DriveObserveArtifactIdentityV1,
  record: DriveObserveCommandRecordV1
): unknown
{
  const capture =
    record.result?.kind === 'observation' ? record.result.capture : null
  return {
    storage: 'artifact',
    artifact,
    summary:
      capture === null
        ? null
        : {
            status: capture.status,
            sequence: record.sequence,
            tick: record.tickAfter,
            label:
              record.result?.kind === 'observation'
                ? record.result.label
                : null,
            ...capture.totals,
          },
  }
}

function responseResult(
  record: DriveObserveCommandRecordV1,
  retained: ObservationRetention | null,
  inline: boolean
): unknown
{
  if (record.result?.kind !== 'observation' || retained === null)
    return record.result
  if (!inline) return observationSummary(retained.artifact, record)
  return {
    kind: 'observation',
    label: record.result.label,
    capture: record.result.capture,
    artifact: retained.artifact,
  }
}

function commandResponse(
  id: string,
  record: DriveObserveCommandRecordV1,
  result: unknown,
  evidenceSha256: string
): unknown
{
  return {
    protocol: DRIVE_OBSERVE_PROTOCOL,
    type: 'commandResponse',
    sessionId: id,
    requestId: record.requestId,
    sequence: record.sequence,
    status: record.status,
    tickBefore: record.tickBefore,
    tickAfter: record.tickAfter,
    drawEpochBefore: record.drawEpochBefore,
    drawEpochAfter: record.drawEpochAfter,
    changed: record.changed,
    result,
    issue: record.issue === null ? null : issueEnvelope(record.issue),
    evidenceSha256,
  }
}

function terminalInput(
  inputLine: number,
  issueCode: string,
  bytes: Uint8Array
): DriveObserveTerminalInputV1
{
  const identity = artifactIdentity('', bytes)
  return {
    inputLine,
    issueCode,
    encoding: 'base64',
    value: Buffer.from(bytes).toString('base64'),
    byteLength: identity.byteLength,
    sha256: identity.sha256,
  }
}

async function retainObservation(
  layout: RunLayout,
  record: DriveObserveCommandRecordV1,
  index: number
): Promise<ObservationRetention | null>
{
  const value = observationArtifact(record)
  if (value === null) return null
  const relativePath = `observations/observation-${String(index).padStart(4, '0')}.json`
  const bytes = canonicalJsonArtifactBytes(value)
  return {
    artifact: writeArtifact(layout, relativePath, bytes),
    bytes,
  }
}

async function emitTransportIssue(input: {
  readonly sessionId: string
  readonly inputLine: number
  readonly tick: number
  readonly drawEpoch: number
  readonly issue: { readonly code: string; readonly message: string }
  readonly stop: ProtocolStopLatch
}): Promise<{
  readonly entry: ForensicTerminal
  readonly stopped: ProtocolStop | null
}>
{
  const projection = {
    inputLine: input.inputLine,
    status: 'failed' as const,
    tick: input.tick,
    drawEpoch: input.drawEpoch,
    issue: { code: input.issue.code },
  }
  const evidenceSha256 = stableHash(projection)
  const stopped = await writeOutput(
    {
      protocol: DRIVE_OBSERVE_PROTOCOL,
      type: 'transportIssue',
      sessionId: input.sessionId,
      inputLine: input.inputLine,
      status: 'failed',
      tick: input.tick,
      drawEpoch: input.drawEpoch,
      issue: input.issue,
      evidenceSha256,
    },
    input.stop
  )
  return {
    stopped,
    entry: {
      type: 'transportIssue',
      protocol: DRIVE_OBSERVE_PROTOCOL,
      sessionId: input.sessionId,
      inputLine: input.inputLine,
      tick: input.tick,
      drawEpoch: input.drawEpoch,
      issue: input.issue,
      evidenceSha256,
    },
  }
}

async function runProtocol(input: {
  readonly options: CliOptions
  readonly layout: RunLayout
  readonly session: DriveObserveSessionV1
  readonly sessionId: string
  readonly sourceIdentity: DriveObserveArtifactIdentityV1
  readonly signal: SignalLatch
  readonly absoluteDeadlineMs: number
}): Promise<ProtocolResult>
{
  const ready = input.session.ready
  const iterator = inputFrames()[Symbol.asyncIterator]()
  const stop = protocolStopLatch({
    signal: input.signal,
    session: input.session,
    absoluteDeadlineMs: input.absoluteDeadlineMs,
  })
  const aliases = new DriveObserveRequestAliases()
  const records: DriveObserveNormalizedRecordV1[] = []
  const observations: DriveObserveArtifactIdentityV1[] = []
  const forensic: Array<ForensicCommand | ForensicTerminal> = []
  let inputEnded = false
  let lastTick: number = ready.tick
  let lastDrawEpoch: number = ready.drawEpoch
  const finish = (
    outerReason: string,
    terminal: DriveObserveTerminalInputV1 | null = null
  ): ProtocolResult =>
  {
    return {
      outerReason,
      records,
      observations,
      forensic,
      terminalInput: terminal,
    }
  }
  const finishStop = (stopped: ProtocolStop): ProtocolResult =>
  {
    if (stopped.sessionIssue !== null)
    {
      forensic.push({
        type: 'sessionIssue',
        protocol: DRIVE_OBSERVE_PROTOCOL,
        sessionId: input.sessionId,
        inputLine: 0,
        tick: lastTick,
        drawEpoch: lastDrawEpoch,
        issue: issueEnvelope(stopped.sessionIssue),
        evidenceSha256: stableHash({
          tick: lastTick,
          drawEpoch: lastDrawEpoch,
          issue: { code: stopped.sessionIssue.code },
        }),
      })
    }
    return finish(stopped.outerReason)
  }
  const finishTerminalInput = async (
    frame: { readonly line: number; readonly bytes: Uint8Array },
    issue: { readonly code: string; readonly message: string },
    outerReason: string
  ): Promise<ProtocolResult> =>
  {
    const retainedInput = terminalInput(frame.line, issue.code, frame.bytes)
    const emitted = await emitTransportIssue({
      sessionId: input.sessionId,
      inputLine: frame.line,
      tick: lastTick,
      drawEpoch: lastDrawEpoch,
      issue,
      stop,
    })
    forensic.push(emitted.entry)
    return finish(emitted.stopped?.outerReason ?? outerReason, retainedInput)
  }

  try
  {
    const readyStopped = await writeOutput(
      {
        protocol: DRIVE_OBSERVE_PROTOCOL,
        type: 'ready',
        sessionId: input.sessionId,
        sourceIdentity: input.sourceIdentity,
        runtimeDescriptorIdentity: {
          sha256: runtimeDescriptorHash(ready.runtimeDescriptor),
          descriptor: ready.runtimeDescriptor,
        },
        deterministicEnvironment: ready.deterministicEnvironment,
        pacing: ready.pacing,
        limits: {
          session: ready.limits,
          observation: ready.observationCaps,
          inputLineBytes: DRIVE_OBSERVE_MAX_LINE_BYTES,
          outputLineBytes: DRIVE_OBSERVE_MAX_LINE_BYTES,
          idleTimeoutMs: input.options.idleTimeoutMs,
        },
        tick: 0,
        drawEpoch: ready.drawEpoch,
        runRoot: input.layout.root,
      },
      stop
    )
    if (readyStopped !== null) return finishStop(readyStopped)

    while (true)
    {
      const idle = waitForIdle(input.options.idleTimeoutMs)
      const event = await Promise.race([
        iterator.next().then(
          (next) => ({ kind: 'input' as const, next }),
          () => ({ kind: 'inputError' as const })
        ),
        stop.promise.then((stopped) => ({
          kind: 'stop' as const,
          stopped,
        })),
        idle.promise.then(() => ({ kind: 'idle' as const })),
      ])
      idle.cancel()
      if (event.kind === 'stop') return finishStop(event.stopped)
      if (event.kind === 'idle') return finish('idle-timeout')
      if (event.kind === 'inputError') return finish('input-failed')
      if (event.next.done)
      {
        inputEnded = true
        return finish('eof')
      }

      const frame = event.next.value
      if (frame.kind === 'transportIssue')
        return await finishTerminalInput(
          frame,
          { code: frame.code, message: frame.message },
          'transport-failed'
        )

      let parsed: unknown
      try
      {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          frame.bytes
        )
        parsed = JSON.parse(text) as unknown
      }
      catch
      {
        return await finishTerminalInput(
          frame,
          {
            code: 'drive-observe.input-json-invalid',
            message: 'input line is not one valid UTF-8 JSON value',
          },
          'transport-failed'
        )
      }
      try
      {
        assertBoundedJsonDepth(parsed)
      }
      catch
      {
        return await finishTerminalInput(
          frame,
          {
            code: 'drive-observe.input-json-too-deep',
            message: `input JSON exceeds ${DRIVE_OBSERVE_MAX_JSON_DEPTH} nesting levels`,
          },
          'transport-failed'
        )
      }

      const receivedAt = new Date().toISOString()
      const outcome = await input.session.execute(parsed)
      if (outcome.kind === 'terminalIssue')
      {
        lastTick = outcome.tick
        lastDrawEpoch = outcome.drawEpoch
        return await finishTerminalInput(
          frame,
          issueEnvelope(outcome.issue),
          'session-command-terminal'
        )
      }

      const record = outcome.record
      lastTick = record.tickAfter
      lastDrawEpoch = record.drawEpochAfter
      const retained = await retainObservation(
        input.layout,
        record,
        observations.length
      )
      if (retained) observations.push(retained.artifact)
      const normalized = normalizeCommandRecord({
        rawInput: parsed,
        expectedTick: expectedTick(parsed, record.tickBefore),
        record,
        observation: retained?.artifact ?? null,
        aliases,
      })
      records.push(normalized)
      forensic.push({
        type: 'command',
        protocol: DRIVE_OBSERVE_PROTOCOL,
        sessionId: input.sessionId,
        inputLine: frame.line,
        receivedAt,
        pacing: input.options.pacing,
        rawInput: parsed,
        record: forensicRecord(record, retained?.artifact ?? null),
        observation: retained?.artifact ?? null,
        stableSha256: normalized.stableSha256,
      })

      const inlineResult = responseResult(record, retained, true)
      let response = commandResponse(
        input.sessionId,
        record,
        inlineResult,
        normalized.stableSha256
      )
      if (
        Buffer.byteLength(JSON.stringify(response), 'utf8') >
        DRIVE_OBSERVE_MAX_LINE_BYTES
      )
        response = commandResponse(
          input.sessionId,
          record,
          responseResult(record, retained, false),
          normalized.stableSha256
        )
      const responseStopped = await writeOutput(response, stop)
      if (responseStopped !== null) return finishStop(responseStopped)
      if (record.status === 'closed' || record.status === 'failed')
        return finish(
          record.status === 'closed' ? 'explicit-close' : 'command-failed'
        )
    }
  }
  finally
  {
    stop.dispose()
    if (!inputEnded)
    {
      process.stdin.destroy()
      try
      {
        await iterator.return?.(undefined)
      }
      catch
      {
        // stdin teardown is best-effort after the authoritative stop reason
      }
    }
  }
}

function forensicRecord(
  record: DriveObserveCommandRecordV1,
  observation: DriveObserveArtifactIdentityV1 | null
): unknown
{
  if (record.result?.kind !== 'observation') return record
  return {
    ...record,
    result: {
      kind: 'observation',
      label: record.result.label,
      capture:
        record.result.capture.status === 'refused'
          ? record.result.capture
          : {
              status: 'observed',
              totals: record.result.capture.totals,
              value: null,
              artifact: observation,
            },
    },
  }
}

function initialStateIdentity(
  records: readonly DriveObserveNormalizedRecordV1[]
): string | null
{
  const observation = records.find(
    (record) => record.observationSha256 !== null
  )
  if (!observation || observation.tickAfter !== 0) return null
  const before = records.slice(0, records.indexOf(observation))
  return before.some((record) => record.changed)
    ? null
    : observation.observationSha256
}

function finalStateIdentity(
  records: readonly DriveObserveNormalizedRecordV1[],
  cleanupChanged: boolean
): string | null
{
  if (cleanupChanged) return null
  const reversed = [...records].reverse()
  const observation = reversed.find(
    (record) => record.observationSha256 !== null
  )
  if (!observation) return null
  const after = records.slice(records.indexOf(observation) + 1)
  return after.some((record) => record.changed)
    ? null
    : observation.observationSha256
}

async function main(): Promise<void>
{
  const parsedOptions = parseArgs(process.argv.slice(2))
  if (parsedOptions === 'help')
  {
    process.stdout.write(`${usageText()}\n`)
    return
  }
  const options = parsedOptions
  const startedAt = new Date().toISOString()
  const admitted = await admitInput(options.input)
  const originalBefore = artifactIdentity(options.input, admitted.bytes)
  const layout = createLayout(options.runsRoot)
  const retainedSource = writeArtifact(
    layout,
    'input/source.sb3',
    admitted.bytes
  )
  const retainedCheck = readContainedRegularFile(
    layout.root,
    retainedSource.path,
    DEFAULT_SB3_LIMITS.maxCompressedBytes,
    'retained source'
  )
  const checkedIdentity = artifactIdentity(retainedSource.path, retainedCheck)
  if (
    checkedIdentity.sha256 !== retainedSource.sha256 ||
    checkedIdentity.byteLength !== retainedSource.byteLength
  )
    throw new Error('retained source identity changed after copy')
  const inputIdentity: DriveObserveInputIdentityFileV1 = {
    schemaVersion: DRIVE_OBSERVE_SCHEMA_VERSION,
    original: originalBefore,
    retained: retainedSource,
    admission: {
      limits: admitted.admission.limits,
      metrics: admitted.admission.metrics,
      projectVersion: admitted.projectVersion,
    },
  }
  writeArtifact(layout, 'input/identity.json', prettyJson(inputIdentity))

  const signal = signalLatch()
  const id = sessionId()
  const absoluteDeadlineMs = Date.now() + options.sessionTimeoutMs
  let protocolResult: ProtocolResult | null = null
  try
  {
    const outcome = await withInteractiveBrowserSession(
      {
        sb3: admitted.bytes,
        headless: options.headless,
        pacing: options.pacing,
        seed: DRIVE_OBSERVE_SEED,
        fixedDateMs: DRIVE_OBSERVE_FIXED_DATE_MS,
        limits: {
          commands: options.maxCommands,
          ticks: options.maxTicks,
          observations: options.maxObservations,
          durationMs: options.sessionTimeoutMs,
        },
      },
      async (session) =>
      {
        protocolResult = await runProtocol({
          options,
          layout,
          session,
          sessionId: id,
          sourceIdentity: retainedSource,
          signal,
          absoluteDeadlineMs,
        })
        return protocolResult
      }
    )

    const result: ProtocolResult = protocolResult ?? {
      outerReason: 'opening-failed',
      records: [],
      observations: [],
      forensic: [],
      terminalInput: null,
    }
    const sourceAfterBytes = readContainedRegularFile(
      layout.root,
      retainedSource.path,
      DEFAULT_SB3_LIMITS.maxCompressedBytes,
      'retained source after session'
    )
    const sourceAfter = artifactIdentity(retainedSource.path, sourceAfterBytes)
    let originalAfter: DriveObserveArtifactIdentityV1 | null = null
    try
    {
      originalAfter = artifactIdentity(
        options.input,
        readBoundedRegularFileNoFollow(
          options.input,
          DEFAULT_SB3_LIMITS.maxCompressedBytes,
          'selected input after session'
        )
      )
    }
    catch
    {
      originalAfter = null
    }
    const exactPreserved =
      originalAfter !== null &&
      originalAfter.sha256 === originalBefore.sha256 &&
      originalAfter.byteLength === originalBefore.byteLength &&
      sourceAfter.sha256 === retainedSource.sha256 &&
      sourceAfter.byteLength === retainedSource.byteLength &&
      sourceAfter.sha256 === originalBefore.sha256 &&
      sourceAfter.byteLength === originalBefore.byteLength

    const forensicLines = [
      ...result.forensic.map((entry) => JSON.stringify(entry)),
      ...outcome.report.cleanupActions.map((action, index) =>
        JSON.stringify({
          type: 'cleanup',
          protocol: DRIVE_OBSERVE_PROTOCOL,
          sessionId: id,
          index,
          action,
        })
      ),
    ]
    const forensicValue =
      forensicLines.length === 0 ? '' : `${forensicLines.join('\n')}\n`
    const forensic = writeArtifact(
      layout,
      'transcript/commands.jsonl',
      forensicValue
    )
    const terminal = terminalProjection(
      result.outerReason,
      outcome.report,
      result.terminalInput
    )
    const terminalSha256 = stableHash(terminal)
    const orderedSha256 = orderedRecordHash(result.records)
    const normalizedTranscript: DriveObserveNormalizedTranscriptV1 = {
      schemaVersion: DRIVE_OBSERVE_SCHEMA_VERSION,
      protocol: DRIVE_OBSERVE_PROTOCOL,
      records: result.records,
      terminalInput: result.terminalInput,
      cleanupActions: normalizedCleanupActions(outcome.report.cleanupActions),
      orderedSha256,
      terminalSha256,
    }
    const normalized = writeArtifact(
      layout,
      'transcript/normalized.json',
      canonicalJsonArtifactBytes(normalizedTranscript)
    )
    const consoleArtifact = writeArtifact(
      layout,
      'browser/console.json',
      prettyJson({
        schemaVersion: DRIVE_OBSERVE_SCHEMA_VERSION,
        entries: outcome.report.consoleEntries,
        summary: outcome.report.consoleSummary,
      })
    )
    const issuesArtifact = writeArtifact(
      layout,
      'browser/issues.json',
      prettyJson({
        schemaVersion: DRIVE_OBSERVE_SCHEMA_VERSION,
        issues: outcome.report.issues,
        droppedIssues: outcome.report.droppedIssues,
        cleanupActions: outcome.report.cleanupActions,
      })
    )
    const descriptor = outcome.report.ready?.runtimeDescriptor ?? null
    const cleanupChanged = outcome.report.cleanupActions.some(
      (action) =>
        stableHash(action.heldInputBefore) !== stableHash(action.heldInputAfter)
    )
    const initialObservationSha256 = initialStateIdentity(result.records)
    const finalObservationSha256 = finalStateIdentity(
      result.records,
      cleanupChanged
    )
    const cleanOuterReason =
      result.outerReason === 'explicit-close' || result.outerReason === 'eof'
    const observedRecords = result.records.filter((record) =>
    {
      if (
        record.status !== 'accepted' ||
        record.result === null ||
        typeof record.result !== 'object'
      )
        return false
      const projected = record.result as {
        readonly kind?: unknown
        readonly capture?: { readonly status?: unknown }
      }
      return (
        projected.kind === 'observation' &&
        projected.capture?.status === 'observed'
      )
    })
    const observationsAddedNoDraws = observedRecords.every(
      (record) => record.drawEpochAfter === record.drawEpochBefore
    )
    const claimSupported =
      outcome.callback.status === 'completed' &&
      outcome.report.state === 'closed' &&
      cleanOuterReason &&
      exactPreserved &&
      observedRecords.length > 0 &&
      observationsAddedNoDraws
    const report: DriveObserveReportV1 = {
      schemaVersion: DRIVE_OBSERVE_SCHEMA_VERSION,
      protocol: DRIVE_OBSERVE_PROTOCOL,
      run: {
        id: layout.id,
        root: layout.root,
        startedAt,
        endedAt: new Date().toISOString(),
        sourceRevision: sourceRevision(),
      },
      source: {
        originalBefore,
        originalAfter,
        retainedBefore: retainedSource,
        retainedAfter: sourceAfter,
        exactPreserved,
        admission: inputIdentity.admission,
      },
      runtime: {
        descriptor,
        descriptorSha256: runtimeDescriptorHash(descriptor),
      },
      deterministicEnvironment: {
        seed: DRIVE_OBSERVE_SEED,
        fixedDateMs: DRIVE_OBSERVE_FIXED_DATE_MS,
        tickMs: outcome.report.ready?.deterministicEnvironment.tickMs ?? null,
      },
      pacing: options.pacing,
      limits: {
        session: outcome.report.ready?.limits ?? {
          commands: options.maxCommands,
          ticks: options.maxTicks,
          observations: options.maxObservations,
          durationMs: options.sessionTimeoutMs,
        },
        idleTimeoutMs: options.idleTimeoutMs,
        inputLineBytes: DRIVE_OBSERVE_MAX_LINE_BYTES,
        outputLineBytes: DRIVE_OBSERVE_MAX_LINE_BYTES,
        observation: outcome.report.ready?.observationCaps ?? null,
        sb3: admitted.admission.limits,
      },
      transcript: {
        forensic,
        normalized,
        records: result.records.length,
        orderedSha256,
      },
      observations: {
        artifacts: result.observations,
        orderedSha256: orderedArtifactHash(result.observations),
      },
      stateIdentities: {
        initialObservationSha256,
        finalObservationSha256,
        initialUnavailableReason:
          initialObservationSha256 === null
            ? 'no explicit tick-zero observation preceded runtime changes'
            : null,
        finalUnavailableReason:
          finalObservationSha256 === null
            ? 'no explicit final observation followed all runtime and cleanup changes'
            : null,
      },
      browser: {
        headless: options.headless,
        console: consoleArtifact,
        issues: issuesArtifact,
        summary: outcome.report.consoleSummary,
      },
      terminal: { ...terminal, stableSha256: terminalSha256 },
      claim: {
        supported: claimSupported,
        statement: claimSupported
          ? 'This finite run applied its retained held-input commands, advanced exact logical ticks, and retained bounded original-target state plus clone counts without the observation command adding a logical tick or renderer draw.'
          : 'This run does not support the finite drive-and-observe claim because its terminal, source-preservation, observation-presence, or zero-draw evidence did not close cleanly.',
        limitations: [
          'The run does not claim visual correctness or official Scratch parity.',
          'The browser close path has no OS hard-kill guarantee.',
          'State identities are available only from explicit charged observations.',
        ],
      },
    }
    const reportJson = prettyJson(report)
    if (Buffer.byteLength(reportJson, 'utf8') > MAX_JSON_REPORT_BYTES)
      throw new Error(`report JSON exceeds ${MAX_JSON_REPORT_BYTES} bytes`)
    writeArtifact(layout, 'report.md', reportMarkdown(report))
    writeArtifact(layout, 'report.json', reportJson)

    if (
      outcome.callback.status !== 'completed' ||
      outcome.report.state !== 'closed' ||
      !cleanOuterReason ||
      !exactPreserved
    )
    {
      process.stderr.write(
        `drive-observe failed; evidence retained at ${layout.root}\n`
      )
      process.exitCode = 1
    }
  }
  finally
  {
    signal.dispose()
  }
}

void main()
  .catch((error: unknown) =>
  {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
  .finally(() =>
  {
    if (forceExitAfterEvidence) process.exit(process.exitCode ?? 1)
  })
