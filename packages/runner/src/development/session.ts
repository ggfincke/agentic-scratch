// packages/runner/src/development/session.ts
// serialize live play commands & retain exact applied input segments

import { randomUUID } from 'node:crypto'
import {
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
  DEVELOPMENT_INPUT_POLICY_V2,
  isDevelopmentReleaseSourceV1,
} from './input-policy.js'
import { isRunnerIssueError } from '../policy/issues.js'

import type {
  OpenProfileBrowserEngineOptionsV1,
  ProfileAppliedInputEventV2,
  ProfileBrowserEngineV1,
  ProfileRuntimeFrameV1,
  ProfileRuntimeFrameV2,
  ProfileEvidenceBatchV2,
  ProfileStateProbeV1,
} from './profile-browser-types.js'
import type { RuntimeExecutionProfileV1 } from './execution-profile.js'
import type {
  ProfileAudioCaptureOptionsV1,
  ProfileAudioClipV1,
} from './profile-evidence-types.js'
import {
  DevelopmentRetentionV1,
  DEVELOPMENT_STATUS_BYTES_V2,
  developmentJsonBytesV1,
  developmentReadSourceV1,
  developmentSha256V1,
} from './retention.js'
import {
  DevelopmentErrorV1,
  type DevelopmentArtifactRefV1,
  type DevelopmentBeginRequestV1,
  type DevelopmentCommandRecordV1,
  type DevelopmentCommandV1,
  type DevelopmentFrameRecordV2,
  type DevelopmentInputRecordV2,
  type DevelopmentLimitsV1,
  type DevelopmentMarkV2,
  type DevelopmentSegmentV1,
  type DevelopmentSessionStatusV1,
  type DevelopmentTraceV2,
  type DevelopmentSoundRecordV1,
  type DevelopmentPerformanceRecordV1,
} from './types.js'

// include worst-case json escaping, scalar fields & per-record accounting slack
const CLEANUP_RECORD_BYTES =
  1024 +
  6 *
    DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits *
    (2 + DEVELOPMENT_INPUT_POLICY_V2.maxReleasedKeysPerCleanupEvent)
const TERMINAL_METADATA_BYTES = 8192 + 32 * (6 * 1024 + 3)
const RECORD_METADATA_GROWTH_BYTES = 128

export type DevelopmentEngineFactoryV1 = (
  options: OpenProfileBrowserEngineOptionsV1
) => Promise<ProfileBrowserEngineV1>

export interface DevelopmentStatusV1
{
  readonly sessionId: string
  readonly status: DevelopmentSessionStatusV1
  readonly sourcePath: string
  readonly sourceSha256: string
  readonly source: DevelopmentArtifactRefV1
  readonly profile: RuntimeExecutionProfileV1
  readonly inputMode: 'agent' | 'human'
  readonly probe?: ProfileStateProbeV1
  readonly visible: boolean
  readonly segmentId: string | null
  readonly runtimeIdentitySha256: string | null
  readonly runtimeDescriptor: DevelopmentSegmentV1['runtimeDescriptor'] | null
  readonly tick: number
  readonly usage: {
    readonly commands: number
    readonly segments: number
    readonly ticks: number
    readonly inputEvents: number
    readonly releaseEvents: number
    readonly stateFrames: number
    readonly marks: number
    readonly traceBytes: number
    readonly retainedBytes: number
  }
  readonly limits: DevelopmentLimitsV1
  readonly issues: readonly string[]
  readonly trace: DevelopmentArtifactRefV1 | null
  readonly devicePolicy: {
    readonly automaticCamera: false
    readonly automaticMicrophone: false
    readonly activation: 'human-gesture-and-browser-permission'
  }
}

export interface DevelopmentSessionOptionsV1
{
  readonly sessionId: string
  readonly request: DevelopmentBeginRequestV1
  readonly sourceSha256: string
  readonly source: DevelopmentArtifactRefV1
  readonly sourceRoots: readonly string[]
  readonly evidenceRoot: string
  readonly profile: RuntimeExecutionProfileV1
  readonly inputMode: 'agent' | 'human'
  readonly limits: DevelopmentLimitsV1
  readonly retention: DevelopmentRetentionV1
  readonly engineFactory: DevelopmentEngineFactoryV1
}

export class DevelopmentSessionV1
{
  readonly inputs: DevelopmentInputRecordV2[] = []
  readonly frames: DevelopmentFrameRecordV2[] = []
  readonly commands: DevelopmentCommandRecordV1[] = []
  readonly segments: DevelopmentSegmentV1[] = []
  readonly marks: DevelopmentMarkV2[] = []
  readonly issues: string[] = []
  readonly sounds: DevelopmentSoundRecordV1[] = []
  private readonly performance = new Map<
    string,
    DevelopmentPerformanceRecordV1
  >()
  private readonly soundCounters = new Map<
    string,
    { observed: number; dropped: number }
  >()
  private soundCoverage = {
    observed: 0,
    dropped: 0,
    complete: true,
    diagnosticOnly: true as const,
  }
  status: DevelopmentSessionStatusV1 = 'ready'
  traceArtifact: DevelopmentArtifactRefV1 | null = null

  private engine: ProfileBrowserEngineV1 | null = null
  private tail: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private order = 0
  private traceBytes = 0
  private captureComplete = true
  private readonly captureSequences = new Map<string, number>()
  private readonly captureStarts = new Map<string, number | null>()
  private readonly recordBytes = {
    inputs: 0,
    frames: 0,
    commands: 0,
    marks: 0,
    sounds: 0,
  }
  private inputEvents = 0
  private releaseEvents = 0
  private tick = 0
  private checkpoint = 0
  private flushed = { inputs: 0, frames: 0, commands: 0, marks: 0, sounds: 0 }
  private terminalScheduled = false
  private stopping: Promise<void> | null = null
  private readonly interruption = new AbortController()
  private readonly openedAt = Date.now()
  private readonly abortListener: () => void

  constructor(readonly options: DevelopmentSessionOptionsV1)
  {
    this.traceBytes = this.finalTraceByteLength()
    this.abortListener = () =>
    {
      this.scheduleStop('cancelled', 'development session was cancelled')
    }
  }

  async open(): Promise<DevelopmentStatusV1>
  {
    try
    {
      this.options.request.signal?.addEventListener(
        'abort',
        this.abortListener,
        { once: true }
      )
      if (this.options.request.signal?.aborted)
      {
        await this.stop(
          'cancelled',
          'development session was cancelled before opening'
        )
        return this.summary()
      }
      this.chargeBytes(0)
      await this.openSegment()
      if (this.options.request.signal?.aborted)
        await this.stop(
          'cancelled',
          'development session was cancelled before opening'
        )
      else
      {
        this.timer = setInterval(() =>
        {
          if (Date.now() - this.openedAt >= this.options.limits.maxDurationMs)
            this.scheduleStop(
              'exhausted',
              'global session duration budget exhausted'
            )
          if (this.polling || this.isTerminal()) return
          this.polling = true
          void this.serial(async () =>
          {
            if (!this.isTerminal()) await this.collect()
          })
            .catch((error: unknown) =>
            {
              this.scheduleStop(
                error instanceof DevelopmentErrorV1 &&
                  error.code.includes('budget')
                  ? 'exhausted'
                  : 'failed',
                errorText(error)
              )
            })
            .finally(() =>
            {
              this.polling = false
            })
        }, 100)
        this.timer.unref()
        await this.flush()
      }
      return this.summary()
    }
    catch (error)
    {
      await this.stop(
        this.options.request.signal?.aborted ? 'cancelled' : 'failed',
        errorText(error)
      )
      throw error
    }
  }

  run(
    command: DevelopmentCommandV1
  ): Promise<DevelopmentStatusV1 & { markId?: string }>
  {
    return this.serial(async () =>
    {
      if (this.isTerminal())
        throw new DevelopmentErrorV1(
          'development.session_closed',
          'session no longer accepts runtime commands'
        )
      if (this.commands.length >= this.options.limits.maxCommands)
      {
        await this.stop('exhausted', 'command budget exhausted')
        throw new DevelopmentErrorV1(
          'development.command_budget_exceeded',
          'command budget exhausted'
        )
      }
      try
      {
        await this.collect()
      }
      catch (error)
      {
        await this.stop(
          error instanceof DevelopmentErrorV1 && error.code.includes('budget')
            ? 'exhausted'
            : 'failed',
          errorText(error)
        )
        throw error
      }
      if (this.isTerminal())
      {
        await this.stop(this.status)
        throw new DevelopmentErrorV1(
          'development.session_closed',
          'session stopped at its global execution budget'
        )
      }
      const segment = this.currentSegment()
      let markId: string | undefined
      try
      {
        const engine = this.requireEngine()
        if (command.kind === 'restart')
        {
          if (this.segments.length >= this.options.limits.maxSegments)
            throw new DevelopmentErrorV1(
              'development.segment_budget_exceeded',
              'restart segment budget exhausted'
            )
          await this.endSegment('closed')
          await this.openSegment()
          const result = await this.requireEngine().start()
          this.updateRuntimeStatus(result)
        }
        else if (command.kind === 'start')
        {
          if (this.status !== 'ready')
            throw new DevelopmentErrorV1(
              'development.invalid_transition',
              'start requires a fresh ready segment'
            )
          this.updateRuntimeStatus(await engine.start())
        }
        else if (command.kind === 'pause')
        {
          if (this.status !== 'running')
            throw new DevelopmentErrorV1(
              'development.invalid_transition',
              'pause requires a running segment'
            )
          this.updateRuntimeStatus(await engine.pause())
        }
        else if (command.kind === 'resume')
        {
          if (this.status !== 'paused')
            throw new DevelopmentErrorV1(
              'development.invalid_transition',
              'resume requires a paused segment'
            )
          this.updateRuntimeStatus(await engine.resume())
        }
        else if (command.kind === 'input')
          this.updateRuntimeStatus(await engine.applyInput(command.input))
        else if (command.kind === 'advance')
        {
          if (this.status !== 'running')
            throw new DevelopmentErrorV1(
              'development.invalid_transition',
              'advance requires a running segment'
            )
          if (this.options.profile.scheduler !== 'deterministic')
            throw new DevelopmentErrorV1(
              'development.natural_advance_unavailable',
              'natural sessions advance through native scheduling'
            )
          if (this.totalTicks() + command.ticks > this.options.limits.maxTicks)
            throw new DevelopmentErrorV1(
              'development.tick_budget_exceeded',
              'advance exceeds the global session tick budget'
            )
          this.updateRuntimeStatus(await engine.advance(command.ticks))
        }
        else if (command.kind === 'mark')
        {
          if (this.marks.length >= this.options.limits.maxMarks)
            throw new DevelopmentErrorV1(
              'development.mark_budget_exceeded',
              'mark budget exhausted'
            )
          const observed = await engine.observeEvidence!(
            this.options.request.probe
          )
          this.consumeEvidence(observed)
          const frame = this.frames.find(
            (entry) =>
              entry.segmentId === this.currentSegment().segmentId &&
              entry.captureSequence === observed.observedCaptureSequence
          )
          if (!frame || frame.captureKind !== 'observation')
            throw new DevelopmentErrorV1(
              'development.evidence_incomplete',
              'mark has no exact retained atomic observation'
            )
          const mark: DevelopmentMarkV2 = {
            markId: randomUUID(),
            label: command.label,
            segmentId: this.currentSegment().segmentId,
            tick: frame.tick,
            inputOrdinal: frame.inputOrdinal,
            startInputOrdinal: frame.startInputOrdinal,
            order: this.nextOrder(),
            frame,
          }
          this.recordBytes.marks += this.charge(mark)
          this.marks.push(mark)
          markId = mark.markId
        }
        await this.collect()
        this.recordCommand(command, this.currentSegment().segmentId, 'applied')
        await this.flush()
        return { ...this.summary(), ...(markId ? { markId } : {}) }
      }
      catch (error)
      {
        this.recordCommand(
          command,
          segment.segmentId,
          'refused',
          errorText(error)
        )
        if (
          error instanceof DevelopmentErrorV1 &&
          error.code.includes('budget')
        )
          await this.stop('exhausted', error.message)
        else if (command.kind === 'restart' || !this.engine)
          await this.stop('failed', errorText(error))
        else await this.flush()
        throw error
      }
    })
  }

  async inspect(): Promise<DevelopmentStatusV1>
  {
    return this.serial(async () =>
    {
      if (!this.isTerminal())
      {
        await this.collect()
        await this.flush()
      }
      return this.summary()
    })
  }

  close(): Promise<DevelopmentStatusV1>
  {
    if (!this.traceArtifact)
    {
      this.status = this.isTerminal() ? this.status : 'closed'
      this.terminalScheduled = true
      this.interruption.abort(new Error('development session closed'))
    }
    const interrupted = this.engine?.close()
    void interrupted?.catch(() => undefined)
    return this.serial(async () =>
    {
      try
      {
        await interrupted
      }
      catch (error)
      {
        if (this.issues.length < 32)
          this.issues.push(`runtime interruption failed: ${errorText(error)}`)
      }
      if (!this.traceArtifact)
        await this.stop(this.isTerminal() ? this.status : 'closed')
      return this.summary()
    })
  }

  trace(): DevelopmentTraceV2
  {
    return {
      schemaVersion: 2,
      kind: 'development-trace-v2',
      chronologyPolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
      captureComplete: this.captureComplete,
      sessionId: this.options.sessionId,
      sourceSha256: this.options.sourceSha256,
      profile: this.options.profile,
      inputMode: this.options.inputMode,
      ...(this.options.request.probe
        ? { probe: this.options.request.probe }
        : {}),
      segments: this.segments,
      inputs: this.inputs,
      commands: this.commands,
      frames: this.frames,
      marks: this.marks,
      issues: this.issues,
      sounds: this.sounds,
      soundCoverage: this.soundCoverage,
      diagnostics: [...this.performance.values()],
    }
  }

  recordAudio(
    options: ProfileAudioCaptureOptionsV1
  ): Promise<ProfileAudioClipV1>
  {
    if (this.isTerminal())
      throw new DevelopmentErrorV1(
        'development.session_closed',
        'output audio requires the live original browser'
      )
    return this.requireEngine().recordAudioClip(options)
  }

  summary(): DevelopmentStatusV1
  {
    const segment = this.segments.at(-1)
    const summary: DevelopmentStatusV1 = {
      sessionId: this.options.sessionId,
      status: this.status,
      sourcePath: this.options.request.sourcePath,
      sourceSha256: this.options.sourceSha256,
      source: this.options.source,
      profile: this.options.profile,
      inputMode: this.options.inputMode,
      ...(this.options.request.probe
        ? { probe: this.options.request.probe }
        : {}),
      visible: this.options.request.visible ?? false,
      segmentId: segment?.segmentId ?? null,
      runtimeIdentitySha256: segment?.runtimeIdentitySha256 ?? null,
      runtimeDescriptor: segment?.runtimeDescriptor ?? null,
      tick: this.tick,
      usage: {
        commands: this.commands.length,
        segments: this.segments.length,
        ticks: this.totalTicks(),
        inputEvents: this.inputEvents,
        releaseEvents: this.releaseEvents,
        stateFrames: this.frames.length,
        marks: this.marks.length,
        traceBytes: this.finalTraceByteLength(),
        retainedBytes: this.options.retention.retainedBytes,
      },
      limits: this.options.limits,
      issues: [
        ...this.issues,
        ...(this.options.retention.cleanupIssue
          ? [this.options.retention.cleanupIssue]
          : []),
      ],
      trace: this.traceArtifact,
      devicePolicy: {
        automaticCamera: false,
        automaticMicrophone: false,
        activation: 'human-gesture-and-browser-permission',
      },
    }
    return JSON.parse(JSON.stringify(summary)) as DevelopmentStatusV1
  }

  private async openSegment(): Promise<void>
  {
    if (this.interruption.signal.aborted)
      throw new DevelopmentErrorV1(
        'development.session_closed',
        'session closure prevents another source-loaded segment'
      )
    const current = await developmentReadSourceV1(
      this.options.request.sourcePath,
      this.options.sourceRoots,
      this.options.evidenceRoot,
      this.options.limits.maxSourceBytes
    )
    if (this.interruption.signal.aborted)
      throw new DevelopmentErrorV1(
        'development.session_closed',
        'session closure cancelled source-loaded segment opening'
      )
    if (current.sha256 !== this.options.sourceSha256)
      throw new DevelopmentErrorV1(
        'development.source_changed',
        'restart requires the exact retained source; open a new session for changed bytes'
      )
    const segmentId = randomUUID()
    const seed = this.options.request.seed ?? 12345
    const fixedDateMs = this.options.request.fixedDateMs ?? 1700000000000
    const engine = await this.options.engineFactory({
      sb3: current.bytes,
      profile: this.options.profile,
      headless: !(this.options.request.visible ?? false),
      inputMode: this.options.inputMode,
      seed,
      fixedDateMs,
      limits: {
        maxTicks: Math.max(1, this.options.limits.maxTicks - this.totalTicks()),
        maxDurationMs: Math.max(
          1,
          this.options.limits.maxDurationMs - (Date.now() - this.openedAt)
        ),
        maxInputEvents: this.options.limits.maxInputEvents - this.inputEvents,
        maxReleaseEvents:
          this.options.limits.maxReleaseEvents - this.releaseEvents,
        maxStateFrames: Math.max(
          1,
          this.options.limits.maxStateFrames - this.frames.length
        ),
        maxStateBytes: this.options.limits.maxTraceBytes,
      },
      signal: this.interruption.signal,
      onControl: (kind) =>
      {
        if (kind === 'start' || kind === 'pause' || kind === 'resume')
          return this.run({ kind }).then(() => undefined)
        void (kind === 'close' ? this.close() : this.run({ kind })).catch(
          (error: unknown) =>
          {
            if (!(error instanceof DevelopmentErrorV1))
              this.scheduleStop('failed', errorText(error))
          }
        )
      },
    })
    if (this.interruption.signal.aborted || this.isTerminal())
    {
      await engine.close()
      throw new DevelopmentErrorV1(
        'development.session_closed',
        'session closure cancelled browser segment opening'
      )
    }
    if (
      engine.evidencePolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
      !engine.drainEvidence ||
      !engine.observeEvidence ||
      engine.sourceSha256 !== this.options.sourceSha256 ||
      engine.profile.runtime !== this.options.profile.runtime ||
      engine.profile.scheduler !== this.options.profile.scheduler ||
      engine.profile.tickRate !== this.options.profile.tickRate ||
      engine.runtimeDescriptor.network !== 'denied' ||
      engine.runtimeDescriptor.kind !==
        (this.options.profile.runtime === 'scratch-official'
          ? 'scratch-official-browser'
          : 'turbowarp-browser')
    )
    {
      await engine.close()
      throw new DevelopmentErrorV1(
        'development.source_mismatch',
        'browser source, execution profile or atomic evidence policy differs'
      )
    }
    this.engine = engine
    const segment: DevelopmentSegmentV1 = {
      segmentId,
      ordinal: this.segments.length,
      sourceSha256: this.options.sourceSha256,
      runtimeIdentitySha256: developmentSha256V1(
        developmentJsonBytesV1(engine.runtimeDescriptor)
      ),
      runtimeDescriptor: JSON.parse(
        JSON.stringify(engine.runtimeDescriptor)
      ) as DevelopmentSegmentV1['runtimeDescriptor'],
      profile: this.options.profile,
      seed,
      fixedDateMs,
      openedAt: new Date().toISOString(),
      closedAt: null,
      finalTick: 0,
      inputEvents: 0,
      startInputOrdinal: null,
      status: 'ready',
    }
    this.charge(segment)
    this.segments.push(segment)
    this.status = 'ready'
    this.tick = 0
    if (this.options.request.probe)
      await engine.configureProbe(this.options.request.probe)
    await this.collect()
  }

  private recordInput(
    segmentId: string,
    event: ProfileAppliedInputEventV2
  ): void
  {
    const segment = this.segments.find((value) => value.segmentId === segmentId)
    if (!segment) throw new Error('input segment is unavailable')
    const release = isDevelopmentReleaseSourceV1(event.source)
    if (
      (!release && this.inputEvents >= this.options.limits.maxInputEvents) ||
      (release && this.releaseEvents >= this.options.limits.maxReleaseEvents)
    )
    {
      this.scheduleStop('exhausted', 'applied input event budget exhausted')
      throw new DevelopmentErrorV1(
        'development.input_budget_exceeded',
        'applied input event budget exhausted'
      )
    }
    const record = {
      ...event,
      data: { ...event.data },
      releasedKeys: [...event.releasedKeys],
      segmentId,
      order: this.nextOrder(),
    }
    this.recordBytes.inputs += this.charge(record, release)
    segment.finalTick = Math.max(segment.finalTick, event.tick)
    this.inputs.push(record)
    if (release) this.releaseEvents += 1
    else this.inputEvents += 1
  }

  private recordFrame(frame: ProfileRuntimeFrameV2): DevelopmentFrameRecordV2
  {
    if (this.frames.length >= this.options.limits.maxStateFrames)
      throw new DevelopmentErrorV1(
        'development.state_budget_exceeded',
        'selected state frame budget exhausted'
      )
    const record = JSON.parse(
      JSON.stringify({
        ...frame,
        segmentId: this.currentSegment().segmentId,
        order: this.nextOrder(),
      })
    ) as DevelopmentFrameRecordV2
    this.recordBytes.frames += this.charge(record)
    this.frames.push(record)
    this.tick = Math.max(this.tick, record.tick)
    this.currentSegment().finalTick = Math.max(
      this.currentSegment().finalTick,
      record.tick
    )
    return record
  }

  private recordCommand(
    command: DevelopmentCommandV1,
    segmentId: string,
    disposition: 'applied' | 'refused',
    issue?: string
  ): void
  {
    const record: DevelopmentCommandRecordV1 = {
      kind: 'command',
      order: this.nextOrder(),
      segmentId,
      tick: this.tick,
      command,
      disposition,
      ...(issue ? { issue } : {}),
    }
    this.recordBytes.commands += this.charge(record)
    this.commands.push(record)
  }

  private async collect(): Promise<void>
  {
    const engine = this.engine
    if (!engine) return
    this.consumeEvidence(await engine.drainEvidence!())
    await this.collectDiagnostics(engine)
    if (
      Date.now() - this.openedAt >= this.options.limits.maxDurationMs ||
      this.totalTicks() >= this.options.limits.maxTicks
    )
      this.scheduleStop('exhausted', 'session clock budget exhausted')
    if (
      this.inputs.length - this.flushed.inputs >= 128 ||
      this.frames.length - this.flushed.frames >= 30
    )
      await this.flush()
  }

  private consumeEvidence(
    batch: ProfileEvidenceBatchV2,
    closing = false
  ): void
  {
    const segment = this.currentSegment()
    if (
      batch.schemaVersion !== 2 ||
      batch.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
      typeof batch.captureComplete !== 'boolean' ||
      !Array.isArray(batch.inputs) ||
      !Array.isArray(batch.frames)
    )
    {
      this.captureComplete = false
      throw new DevelopmentErrorV1(
        'development.evidence_mismatch',
        'browser atomic evidence policy is invalid'
      )
    }
    this.captureComplete &&= batch.captureComplete
    const rows = [
      ...batch.inputs.map((value) => ({ kind: 'input' as const, value })),
      ...batch.frames.map((value) => ({ kind: 'frame' as const, value })),
    ].sort(
      (left, right) => left.value.captureSequence - right.value.captureSequence
    )
    let failure: unknown
    for (const row of rows)
    {
      const sequence = row.value.captureSequence
      const previous = this.captureSequences.get(segment.segmentId) ?? 0
      if (!Number.isSafeInteger(sequence) || sequence !== previous + 1)
      {
        this.captureComplete = false
        throw new DevelopmentErrorV1(
          'development.evidence_mismatch',
          'browser capture sequence is not consecutive'
        )
      }
      this.captureSequences.set(segment.segmentId, sequence)
      if (row.kind === 'input')
      {
        const event = row.value
        const validKey = (key: unknown): key is string =>
          typeof key === 'string' &&
          key.length > 0 &&
          key.length <= DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits &&
          !key.includes('\0')
        if (
          event.ordinal !== segment.inputEvents + 1 ||
          (event.interpretedKey !== null && !validKey(event.interpretedKey)) ||
          !Array.isArray(event.releasedKeys) ||
          event.releasedKeys.length >
            DEVELOPMENT_INPUT_POLICY_V2.maxReleasedKeysPerInputEvent ||
          event.releasedKeys.some((key: unknown) => !validKey(key)) ||
          (isDevelopmentReleaseSourceV1(event.source) &&
            (event.data.isDown !== false ||
              event.releasedKeys.length >
                DEVELOPMENT_INPUT_POLICY_V2.maxReleasedKeysPerCleanupEvent))
        )
        {
          this.captureComplete = false
          throw new DevelopmentErrorV1(
            'development.input_order_mismatch',
            'browser input boundary or interpreted release identity is invalid'
          )
        }
        segment.inputEvents = event.ordinal
      }
      else
      {
        const frame = row.value
        const priorStart = this.captureStarts.get(segment.segmentId) ?? null
        if (
          frame.inputOrdinal !== segment.inputEvents ||
          (frame.startInputOrdinal !== null &&
            (!Number.isSafeInteger(frame.startInputOrdinal) ||
              frame.startInputOrdinal < 0 ||
              frame.startInputOrdinal > frame.inputOrdinal)) ||
          (priorStart !== null && frame.startInputOrdinal !== priorStart) ||
          !['post-step', 'observation'].includes(frame.captureKind)
        )
        {
          this.captureComplete = false
          throw new DevelopmentErrorV1(
            'development.evidence_mismatch',
            'observation differs from its exact applied-input boundary'
          )
        }
        this.captureStarts.set(segment.segmentId, frame.startInputOrdinal)
      }
      if (
        failure &&
        (row.kind !== 'input' ||
          !isDevelopmentReleaseSourceV1(row.value.source))
      )
        continue
      try
      {
        if (row.kind === 'input') this.recordInput(segment.segmentId, row.value)
        else this.recordFrame(row.value)
      }
      catch (error)
      {
        this.captureComplete = false
        failure ??= error
      }
    }
    this.updateRuntimeStatus(batch.status, closing)
    if (failure)
    {
      if (!closing) throw failure
      if (this.issues.length < 32)
        this.issues.push(`final capture is incomplete: ${errorText(failure)}`)
    }
  }

  private updateRuntimeStatus(
    value: {
      tick: number
      status: ProfileRuntimeFrameV1['status']
      issue?: string | null
      startInputOrdinal?: number | null
    },
    closing = false
  ): void
  {
    this.tick = value.tick
    const segment = this.segments.at(-1)
    if (segment)
    {
      segment.finalTick = Math.max(segment.finalTick, value.tick)
      if (value.startInputOrdinal !== undefined)
        segment.startInputOrdinal = value.startInputOrdinal
    }
    if (!closing && !this.isTerminal())
    {
      this.status = value.status
      if (segment) segment.status = this.status
      if (value.status === 'failed' || value.status === 'closed')
        this.scheduleStop(
          value.issue?.includes('budget') ? 'exhausted' : 'failed',
          value.issue ?? 'runtime stopped before explicit session closure'
        )
    }
  }

  private async collectDiagnostics(
    engine: ProfileBrowserEngineV1
  ): Promise<void>
  {
    const segment = this.currentSegment().segmentId
    const sound = await engine.drainSoundEvents()
    const previous = this.soundCounters.get(segment) ?? {
      observed: 0,
      dropped: 0,
    }
    this.soundCoverage.observed += Math.max(
      0,
      sound.observed - previous.observed
    )
    this.soundCoverage.dropped += Math.max(0, sound.dropped - previous.dropped)
    this.soundCoverage.complete &&= sound.complete
    this.soundCounters.set(segment, {
      observed: sound.observed,
      dropped: sound.dropped,
    })
    for (const event of sound.events)
    {
      if (this.sounds.length >= this.options.limits.maxSoundEvents)
      {
        this.soundCoverage.dropped++
        this.soundCoverage.complete = false
        continue
      }
      const record = { ...event, segmentId: segment, order: this.nextOrder() }
      this.recordBytes.sounds += this.charge(record)
      this.sounds.push(record)
    }
    const performance = await engine.readPerformanceDiagnostics()
    const old = this.performance.get(segment)
    const used = [...this.performance.values()]
      .filter((row) => row.segmentId !== segment)
      .reduce((sum, row) => sum + row.performance.retainedSamples.length, 0)
    const maximum = Math.max(
      0,
      this.options.limits.maxPerformanceSamples - used
    )
    const samples = performance.retainedSamples.slice(0, maximum)
    const record = {
      segmentId: segment,
      performance: {
        ...performance,
        retainedSamples: samples,
        droppedSamples:
          performance.droppedSamples +
          performance.retainedSamples.length -
          samples.length,
      },
    }
    const additional = Math.max(
      0,
      developmentJsonBytesV1(record).byteLength -
        (old ? developmentJsonBytesV1(old).byteLength : 0)
    )
    if (additional) this.chargeBytes(additional)
    this.performance.set(segment, record)
  }

  private async endSegment(status: DevelopmentSessionStatusV1): Promise<void>
  {
    const engine = this.engine
    if (!engine) return
    try
    {
      await engine.close()
      const finalEvidence = await engine.drainEvidence!()
      this.consumeEvidence(finalEvidence, true)
      const finalStatus = finalEvidence.status
      try
      {
        await this.collectDiagnostics(engine)
      }
      catch (error)
      {
        if (
          !(error instanceof DevelopmentErrorV1) ||
          !error.code.includes('budget')
        )
          throw error
        if (this.issues.length < 32)
          this.issues.push(
            'final sound or performance diagnostics unavailable after trace budget exhaustion'
          )
      }
      this.tick = Math.max(this.tick, finalStatus.tick)
      if (
        finalStatus.issue &&
        this.issues.length < 32 &&
        !this.issues.includes(finalStatus.issue)
      )
        this.issues.push(finalStatus.issue.slice(0, 1024))
      if (finalStatus.heldKeys.length || finalStatus.mouseDown)
      {
        this.captureComplete = false
        if (this.issues.length < 32)
          this.issues.push(
            'final input release evidence is unavailable for the closed browser'
          )
      }
    }
    finally
    {
      this.engine = null
      const segment = this.currentSegment()
      segment.status = status
      segment.closedAt = new Date().toISOString()
      segment.finalTick = Math.max(segment.finalTick, this.tick)
    }
  }

  private stop(
    status: DevelopmentSessionStatusV1,
    issue?: string
  ): Promise<void>
  {
    if (this.stopping) return this.stopping
    this.terminalScheduled = true
    this.stopping = this.finishStop(
      this.isTerminal() ? this.status : status,
      issue
    )
    return this.stopping
  }

  private async finishStop(
    status: DevelopmentSessionStatusV1,
    issue?: string
  ): Promise<void>
  {
    if (this.traceArtifact) return
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.options.request.signal?.removeEventListener(
      'abort',
      this.abortListener
    )
    this.status = status
    this.interruption.abort(new Error(issue ?? `development session ${status}`))
    if (issue && this.issues.length < 32) this.issues.push(issue.slice(0, 1024))
    try
    {
      await this.endSegment(status)
    }
    catch (error)
    {
      this.status = 'failed'
      this.captureComplete = false
      const message = `runtime cleanup failed: ${errorText(error)}`
      if (this.issues.length < 32) this.issues.push(message)
      else if (
        isRunnerIssueError(error) &&
        error.issue.code === 'runner.cleanup.incomplete'
      )
        this.issues[31] = message
    }
    try
    {
      await this.options.retention.refresh()
      const traceBytes = developmentJsonBytesV1(this.trace())
      if (traceBytes.byteLength > this.options.limits.maxTraceBytes)
        throw new DevelopmentErrorV1(
          'development.trace_budget_exceeded',
          'full encoded terminal trace exceeds its byte ceiling'
        )
      const trace = this.options.retention.artifactRef('trace.json', traceBytes)
      const base = this.summary()
      let retainedBytes =
        this.options.retention.retainedBytes + traceBytes.byteLength
      let checkpointBytes: Uint8Array = new Uint8Array()
      let sessionBytes: Uint8Array = new Uint8Array()
      let settled = false
      for (let attempt = 0; attempt < 8; attempt++)
      {
        const summary = {
          ...base,
          trace,
          usage: {
            ...base.usage,
            traceBytes: traceBytes.byteLength,
            retainedBytes,
          },
        }
        checkpointBytes = developmentJsonBytesV1(this.checkpointRecord(summary))
        sessionBytes = developmentJsonBytesV1(summary)
        const total =
          this.options.retention.retainedBytes +
          traceBytes.byteLength +
          checkpointBytes.byteLength +
          sessionBytes.byteLength
        if (total === retainedBytes)
        {
          settled = true
          break
        }
        retainedBytes = total
      }
      if (!settled)
        throw new Error('terminal byte accounting did not stabilize')
      const refs = await this.options.retention.retainTerminal({
        checkpoint: { key: this.checkpointKey(), bytes: checkpointBytes },
        traceBytes,
        sessionBytes,
      })
      this.traceArtifact = refs[1]!
      this.advanceCheckpoint()
    }
    catch (error)
    {
      this.status = 'failed'
      if (this.issues.length < 32)
        this.issues.push(
          `terminal evidence remains incomplete: ${errorText(error)}`
        )
      throw error
    }
  }

  private scheduleStop(
    status: DevelopmentSessionStatusV1,
    issue: string
  ): void
  {
    if (this.terminalScheduled || this.traceArtifact) return
    this.terminalScheduled = true
    this.status = status
    this.interruption.abort(new Error(issue))
    void this.serial(() => this.stop(status, issue)).catch((error: unknown) =>
    {
      this.status = 'failed'
      if (this.issues.length < 32) this.issues.push(errorText(error))
    })
  }

  private checkpointRecord(status = this.summary())
  {
    return {
      schemaVersion: 2,
      chronologyPolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
      captureComplete: this.captureComplete,
      sessionId: this.options.sessionId,
      sequence: this.checkpoint,
      status,
      segments: this.segments,
      inputs: this.inputs.slice(this.flushed.inputs),
      frames: this.frames.slice(this.flushed.frames),
      commands: this.commands.slice(this.flushed.commands),
      marks: this.marks.slice(this.flushed.marks),
      sounds: this.sounds.slice(this.flushed.sounds),
      soundCoverage: this.soundCoverage,
      diagnostics: [...this.performance.values()],
    }
  }

  private checkpointKey(): string
  {
    return `checkpoint-${String(this.checkpoint).padStart(6, '0')}.json`
  }

  private async flush(): Promise<void>
  {
    const delta = this.checkpointRecord()
    if (
      this.checkpoint > 0 &&
      !delta.inputs.length &&
      !delta.frames.length &&
      !delta.commands.length &&
      !delta.marks.length &&
      !delta.sounds.length
    )
      return
    const bytes = developmentJsonBytesV1(delta)
    if (
      bytes.byteLength >
      (this.checkpoint === 0
        ? DEVELOPMENT_STATUS_BYTES_V2
        : this.options.limits.maxTraceBytes + DEVELOPMENT_STATUS_BYTES_V2)
    )
      throw new DevelopmentErrorV1(
        'development.retention_budget_exceeded',
        'encoded lifecycle checkpoint exceeds its bounded startup or trace allowance'
      )
    await this.options.retention.retain(
      this.checkpointKey(),
      bytes,
      'application/json'
    )
    this.advanceCheckpoint()
  }

  private advanceCheckpoint(): void
  {
    this.checkpoint++
    this.flushed = {
      inputs: this.inputs.length,
      frames: this.frames.length,
      commands: this.commands.length,
      marks: this.marks.length,
      sounds: this.sounds.length,
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T>
  {
    const result = this.tail.then(work)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private totalTicks(): number
  {
    return this.segments.reduce((sum, segment) => sum + segment.finalTick, 0)
  }

  private currentSegment(): DevelopmentSegmentV1
  {
    const segment = this.segments.at(-1)
    if (!segment)
      throw new DevelopmentErrorV1(
        'development.segment_unavailable',
        'no browser segment is available'
      )
    return segment
  }

  private requireEngine(): ProfileBrowserEngineV1
  {
    if (!this.engine)
      throw new DevelopmentErrorV1(
        'development.runtime_unavailable',
        'live browser is unavailable'
      )
    return this.engine
  }

  private isTerminal(): boolean
  {
    return ['exhausted', 'cancelled', 'failed', 'closed'].includes(this.status)
  }

  private nextOrder(): number
  {
    return ++this.order
  }

  // record arrays only append owned entries; mutable metadata stays fresh at each checkpoint
  private finalTraceByteLength(): number
  {
    const envelope = {
      ...this.trace(),
      inputs: [],
      frames: [],
      commands: [],
      marks: [],
      sounds: [],
    }
    let bytes = developmentJsonBytesV1(envelope).byteLength
    for (const key of [
      'inputs',
      'frames',
      'commands',
      'marks',
      'sounds',
    ] as const)
      bytes += this.recordBytes[key] + Math.max(0, this[key].length - 1)
    return bytes
  }

  private charge(value: unknown, cleanup = false): number
  {
    const bytes = developmentJsonBytesV1(value).byteLength
    if (
      cleanup &&
      bytes + RECORD_METADATA_GROWTH_BYTES + 1 > CLEANUP_RECORD_BYTES
    )
      throw new DevelopmentErrorV1(
        'development.trace_budget_exceeded',
        'cleanup record exceeds its bounded encoding allowance'
      )
    this.chargeBytes(bytes, cleanup)
    return bytes
  }

  private chargeBytes(bytes: number, cleanup = false): void
  {
    const releases = Math.min(
      this.options.limits.maxReleaseEvents - this.releaseEvents,
      DEVELOPMENT_INPUT_POLICY_V2.maxHeldKeys + 1
    )
    const reserve =
      TERMINAL_METADATA_BYTES + (cleanup ? 0 : releases * CLEANUP_RECORD_BYTES)
    const charged = bytes + 1 + RECORD_METADATA_GROWTH_BYTES
    const limit = this.options.limits.maxTraceBytes - reserve
    if (this.traceBytes + charged > limit)
    {
      this.captureComplete = false
      this.scheduleStop('exhausted', 'trace byte budget exhausted')
      throw new DevelopmentErrorV1(
        'development.trace_budget_exceeded',
        'trace byte budget exhausted'
      )
    }
    this.traceBytes += charged
  }
}

function errorText(error: unknown): string
{
  if (
    isRunnerIssueError(error) &&
    error.issue.code === 'runner.cleanup.incomplete'
  )
    return `${error.issue.code}: ${error.message}`.slice(0, 1024)
  return (error instanceof Error ? error.message : String(error)).slice(0, 1024)
}
