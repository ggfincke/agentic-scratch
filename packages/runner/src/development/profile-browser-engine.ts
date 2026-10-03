// packages/runner/src/development/profile-browser-engine.ts
// retain isolated profile browsers w/ ordered input delivery & close-safe state drains

import { createHash } from 'node:crypto'
import { unpackSb3, type ProjectJson } from '@scratch-agent/sb3'
import {
  openRenderedPageHost,
  type RenderedPageHost,
  type RenderedPageOpeningLeaseV1,
} from '../browser/browser-host.js'
import { hashRunnerJson } from '../observation/observation-host.js'
import { decodeRuntimePngRgbaV1 } from '../observation/png-decode.js'
import {
  PROFILE_VISUAL_CAPTURE_DEFAULTS_V1,
  PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1,
  PROFILE_AUDIO_LIMITS_V1,
  type ProfileVisualCaptureOptionsV1,
  type ProfileSoundEventsV1,
  type ProfilePerformanceDiagnosticsV1,
} from './profile-evidence-types.js'
import { BrowserConsoleCollector } from '../policy/runtime-log.js'
import { createRunIssue, RunnerIssueError } from '../policy/issues.js'
import { validateRuntimeExecutionProfileV1 } from './execution-profile.js'
import { DEVELOPMENT_CHRONOLOGY_POLICY_V2 } from './input-policy.js'
import {
  PROFILE_BROWSER_LIMITS_V1,
  type OpenProfileBrowserEngineOptionsV1,
  type ProfileBrowserEngineV1,
  type ProfileAppliedInputEventV2,
  type ProfileRuntimeFrameV2,
  type ProfileEvidenceBatchV2,
  type ProfileRuntimeStatusV1,
  type ProfileBrowserLimitsV1,
} from './profile-browser-types.js'

export const MAX_PROFILE_BROWSER_ENGINES_V1 = 2
export const PROFILE_BROWSER_CLOSE_GRACE_MS_V1 = 1000
let liveProfileBrowsers = 0

function resolveLimits(
  input: Partial<ProfileBrowserLimitsV1> = {}
): Required<ProfileBrowserLimitsV1>
{
  if (
    Object.keys(input).some(
      (key) => !Object.hasOwn(PROFILE_BROWSER_LIMITS_V1, key)
    )
  )
    throw new Error('unknown browser resource limit')
  const result = { ...PROFILE_BROWSER_LIMITS_V1, ...input }
  for (const key of Object.keys(
    PROFILE_BROWSER_LIMITS_V1
  ) as (keyof Required<ProfileBrowserLimitsV1>)[])
    if (
      !Number.isSafeInteger(result[key]) ||
      result[key] <
        (key === 'maxInputEvents' || key === 'maxReleaseEvents' ? 0 : 1) ||
      result[key] > PROFILE_BROWSER_LIMITS_V1[key]
    )
      throw new Error(`invalid or excessive browser limit ${key}`)
  return result
}

export async function openProfileBrowserEngineV1(
  options: OpenProfileBrowserEngineOptionsV1
): Promise<ProfileBrowserEngineV1>
{
  const profile = validateRuntimeExecutionProfileV1(options.profile)
  if (
    !['agent', 'human'].includes(options.inputMode) ||
    typeof options.headless !== 'boolean'
  )
    throw new Error('invalid browser input mode or visibility')
  const limits = resolveLimits(options.limits)
  const seed = options.seed ?? 12345
  const fixedDateMs = options.fixedDateMs ?? 1700000000000
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(fixedDateMs))
    throw new Error('seed & fixed date must be safe integers')
  const sb3 = Uint8Array.from(options.sb3)
  const sourceSha256 = createHash('sha256').update(sb3).digest('hex')
  const admitted = await unpackSb3(sb3)
  const json = JSON.parse(admitted.projectJsonText) as ProjectJson
  const targets = json.targets.map((target, targetIndex) => ({
    targetIndex,
    name: target.name,
    isStage: target.isStage,
  }))
  let resolveReady!: (engine: ProfileBrowserEngineV1) => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<ProfileBrowserEngineV1>((resolve, reject) =>
  {
    resolveReady = resolve
    rejectReady = reject
  })
  let finish!: () => void
  const done = new Promise<void>((resolve) =>
  {
    finish = resolve
  })
  const consoleCollector = new BrowserConsoleCollector()
  const errors: string[] = []
  let host: RenderedPageHost | undefined
  let engine: ProfileBrowserEngineV1 | undefined
  let closePromise: Promise<void> | undefined
  let tail = Promise.resolve()
  let polling: ReturnType<typeof setInterval> | undefined
  let isClosed = false
  let closing = false
  let hardDeadline: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined
  let evidenceTail = Promise.resolve()
  let deliveredOrdinal = 0
  let deliveredCaptureSequence = 0
  let captureComplete = true
  let visualLimits: { maxFrames: number; maxBytes: number } | null = null
  let visualCount = 0
  let visualBytes = 0
  let soundCache: ProfileSoundEventsV1['events'][number][] = []
  let soundSummary = {
    observed: 0,
    dropped: 0,
    complete: true,
    diagnosticOnly: true as const,
  }
  let performanceCache: ProfilePerformanceDiagnosticsV1 | null = null
  let terminationIssue: string | null = null
  let inputCache: ProfileAppliedInputEventV2[] = []
  let frameCache: ProfileRuntimeFrameV2[] = []
  let lastStatus: ProfileRuntimeStatusV1 = {
    tick: 0,
    elapsedMs: 0,
    drawEpoch: 0,
    status: 'ready',
    startInputOrdinal: null,
    issue: null,
    heldKeys: [],
    mouseDown: false,
  }
  function serial<T>(operation: () => Promise<T>): Promise<T>
  {
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  function withEvidence<T>(operation: () => Promise<T>): Promise<T>
  {
    const result = evidenceTail.then(operation)
    evidenceTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  function flush(): Promise<void>
  {
    return withEvidence(readEvidence)
  }
  function absorbEvidence(batch: ProfileEvidenceBatchV2): void
  {
    if (
      batch.schemaVersion !== 2 ||
      batch.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2
    )
      throw new Error('browser capture chronology is unavailable')
    captureComplete &&= batch.captureComplete
    lastStatus = {
      ...batch.status,
      issue: batch.status.issue ?? terminationIssue,
    }
    const rows = [...batch.inputs, ...batch.frames].sort(
      (left, right) => left.captureSequence - right.captureSequence
    )
    for (const row of rows)
    {
      if (row.captureSequence !== deliveredCaptureSequence + 1)
      {
        captureComplete = false
        throw new Error('browser capture sequence is discontinuous')
      }
      deliveredCaptureSequence = row.captureSequence
      if ('captureKind' in row)
      {
        if (row.inputOrdinal !== deliveredOrdinal)
        {
          captureComplete = false
          throw new Error(
            'browser frame input boundary differs from capture order'
          )
        }
        frameCache.push(row)
      }
      else
      {
        if (row.ordinal !== deliveredOrdinal + 1)
        {
          captureComplete = false
          throw new Error('browser applied input order is discontinuous')
        }
        deliveredOrdinal = row.ordinal
        inputCache.push(row)
      }
    }
  }
  function takeEvidence(): ProfileEvidenceBatchV2
  {
    const batch: ProfileEvidenceBatchV2 = {
      schemaVersion: 2,
      chronologyPolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
      captureComplete,
      inputs: inputCache,
      frames: frameCache,
      status: structuredClone(lastStatus),
    }
    inputCache = []
    frameCache = []
    return batch
  }
  async function readEvidence(): Promise<void>
  {
    if (!host || host.page.isClosed() || isClosed) return
    const batch = await host.page.evaluate(() => ({
      ...window.__projectDebug!.drainEvidence(),
      sounds: window.__projectDebug!.drainSoundEvents(),
      performance: window.__projectDebug!.readPerformanceDiagnostics(),
    }))
    absorbEvidence(batch)
    soundCache.push(...batch.sounds.events)
    soundSummary = {
      observed: batch.sounds.observed,
      dropped: batch.sounds.dropped,
      complete: batch.sounds.complete,
      diagnosticOnly: true,
    }
    performanceCache = {
      ...batch.performance,
      sourceSha256,
      runtimeIdentitySha256: createHash('sha256')
        .update(JSON.stringify(host.runtimeDescriptor))
        .digest('hex'),
    }
    for (const event of batch.inputs) await options.onAppliedEvent?.(event)
  }
  async function requireOpen(): Promise<RenderedPageHost>
  {
    if (!host || isClosed || closing || host.page.isClosed())
      throw new Error('profile browser segment is closed')
    if (options.signal?.aborted)
      throw options.signal.reason ?? new Error('profile browser cancelled')
    return host
  }
  if (liveProfileBrowsers >= MAX_PROFILE_BROWSER_ENGINES_V1)
    throw new Error(
      'two profile browser engines are already open or opening; close one before opening another'
    )
  liveProfileBrowsers++
  let openingLease: RenderedPageOpeningLeaseV1 | undefined
  let slotReleased = false
  const releaseSlot = () =>
  {
    if (slotReleased) return
    slotReleased = true
    liveProfileBrowsers--
  }
  const lifetime = (async () =>
  {
    let failure: { readonly error: unknown } | undefined
    try
    {
      host = await openRenderedPageHost({
        runtimeKind: profile.runtime,
        executionProfile: profile,
        inputMode: options.inputMode,
        sb3,
        headless: options.headless,
        blockPhysicalInput: options.inputMode === 'agent',
        allowNetwork: false,
        allowedOrigins: [],
        signal: options.signal,
        ownerControlsProcessSignals: true,
        onOpeningLease: (lease) =>
        {
          openingLease = lease
          void lease.released.then(releaseSlot)
        },
        onConsole: (kind, text) => consoleCollector.add(kind, text),
        onPageError: (error) =>
        {
          if (errors.length < 32) errors.push(error.message.slice(0, 2048))
        },
        onNetworkDenied: (url) =>
        {
          if (errors.length < 32)
            errors.push(`blocked network request: ${url.slice(0, 1024)}`)
        },
      })
      const page = host.page
      engine = {
        evidencePolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
        sourceSha256,
        profile,
        runtimeDescriptor: host.runtimeDescriptor,
        page,
        start: () =>
          serial(async () =>
          {
            const active = await requireOpen()
            const value = await active.page.evaluate(() =>
              window.__projectDebug!.start()
            )
            await flush()
            return value
          }),
        pause: () =>
          serial(async () =>
          {
            const active = await requireOpen()
            const value = await active.page.evaluate(() =>
              window.__projectDebug!.pause()
            )
            await flush()
            return value
          }),
        resume: () =>
          serial(async () =>
          {
            const active = await requireOpen()
            const value = await active.page.evaluate(() =>
              window.__projectDebug!.resume()
            )
            await flush()
            return value
          }),
        applyInput: (input) =>
          serial(async () =>
          {
            const active = await requireOpen()
            const value = await active.page.evaluate(
              (value) => window.__projectDebug!.applyInput(value),
              input
            )
            await flush()
            return value
          }),
        applyReplayInput: (input, provenance) =>
          serial(async () =>
          {
            const active = await requireOpen()
            const value = await active.page.evaluate(
              ({ input, provenance }) =>
                window.__projectDebug!.applyReplayInput(input, provenance),
              { input, provenance }
            )
            await flush()
            return value
          }),
        advance: (ticks) =>
          serial(async () =>
          {
            const active = await requireOpen()
            const value = await active.page.evaluate(
              (count) => window.__projectDebug!.advance(count),
              ticks
            )
            await flush()
            return value
          }),
        observe: (probe) =>
          serial(async () =>
          {
            const active = await requireOpen()
            await flush()
            return await active.page.evaluate(
              (value) => window.__projectDebug!.observe(value),
              probe
            )
          }),
        drainEvidence: () =>
          isClosed
            ? Promise.resolve(takeEvidence())
            : serial(async () =>
              {
                await flush()
                return takeEvidence()
              }),
        observeEvidence: (probe) =>
          serial(async () =>
          {
            const active = await requireOpen()
            return withEvidence(async () =>
            {
              const batch = await active.page.evaluate(
                (value) => window.__projectDebug!.observeEvidence(value),
                probe
              )
              absorbEvidence(batch)
              for (const event of batch.inputs)
                await options.onAppliedEvent?.(event)
              return {
                ...takeEvidence(),
                observedCaptureSequence: batch.observedCaptureSequence,
              }
            })
          }),
        configureProbe: (probe) =>
          serial(async () =>
          {
            const active = await requireOpen()
            await active.page.evaluate(
              (value) => window.__projectDebug!.configureProbe(value),
              probe
            )
          }),
        drainAppliedEvents: () =>
          isClosed
            ? Promise.resolve(
                (() =>
                  {
                  const values = inputCache
                  inputCache = []
                  return values
                })()
              )
            : serial(async () =>
              {
                await flush()
                const values = inputCache
                inputCache = []
                return values
              }),
        drainFrames: () =>
          isClosed
            ? Promise.resolve(
                (() =>
                  {
                  const values = frameCache
                  frameCache = []
                  return values
                })()
              )
            : serial(async () =>
              {
                await flush()
                const values = frameCache
                frameCache = []
                return values
              }),
        status: () =>
          isClosed
            ? Promise.resolve(structuredClone(lastStatus))
            : serial(async () =>
              {
                await flush()
                return structuredClone(lastStatus)
              }),
        snapshot: (label) =>
          serial(async () =>
          {
            const active = await requireOpen()
            await flush()
            return await active.page.evaluate(
              (value) => window.__projectDebug!.snapshot(value),
              label
            )
          }),
        draw: () =>
          serial(async () =>
          {
            const active = await requireOpen()
            await active.page.evaluate(() => window.__projectDebug!.draw())
            await flush()
          }),
        captureVisualFrame: (options: ProfileVisualCaptureOptionsV1 = {}) =>
          serial(async () =>
          {
            const active = await requireOpen()
            if (profile.scheduler !== 'deterministic')
              throw new Error(
                'dense visual capture requires a deterministic replay profile'
              )
            if (
              Object.keys(options).some((key) => key !== 'limits') ||
              (options.limits &&
                Object.keys(options.limits).some(
                  (key) => !['maxFrames', 'maxBytes'].includes(key)
                ))
            )
              throw new Error('invalid visual capture budget')
            const selected = {
              ...PROFILE_VISUAL_CAPTURE_DEFAULTS_V1,
              ...options.limits,
            }
            for (const key of ['maxFrames', 'maxBytes'] as const)
              if (
                !Number.isSafeInteger(selected[key]) ||
                selected[key] < 1 ||
                selected[key] > PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1[key]
              )
                throw new Error(`visual ${key} exceeds its hard bound`)
            if (visualLimits === null) visualLimits = selected
            else if (
              options.limits &&
              (visualLimits.maxFrames !== selected.maxFrames ||
                visualLimits.maxBytes !== selected.maxBytes)
            )
              throw new Error(
                'visual capture budget cannot drift within a replay segment'
              )
            if (visualCount >= visualLimits.maxFrames)
              throw new Error('dense visual frame budget exhausted')
            const before = await active.page.evaluate(() =>
              window.__projectDebug!.observe()
            )
            const visual = await active.page.evaluate(() =>
              window.__projectDebug!.visual()
            )
            const bytes = Uint8Array.from(
              await active.page
                .locator('canvas')
                .first()
                .screenshot({ type: 'png' })
            )
            if (visualBytes + bytes.byteLength > visualLimits.maxBytes)
              throw new Error('dense visual byte budget exhausted')
            const state = await active.page.evaluate(() =>
              window.__projectDebug!.observe()
            )
            if (
              state.tick !== before.tick ||
              state.timer !== before.timer ||
              hashRunnerJson(state.targets) !==
                hashRunnerJson(before.targets) ||
              hashRunnerJson(state.cloneCounts) !==
                hashRunnerJson(before.cloneCounts)
            )
              throw new Error('visual capture changed selected gameplay state')
            const decoded = decodeRuntimePngRgbaV1(bytes)
            if (decoded.width !== 480 || decoded.height !== 360)
              throw new Error('visual capture dimensions differ from the stage')
            visualCount++
            visualBytes += bytes.byteLength
            await flush()
            return {
              schemaVersion: 1 as const,
              ordinal: visualCount,
              tick: state.tick,
              sourceSha256,
              runtimeIdentitySha256: createHash('sha256')
                .update(JSON.stringify(active.runtimeDescriptor))
                .digest('hex'),
              profile,
              state,
              geometry: {
                ...visual.geometry,
                targets: visual.geometry.targets.filter(
                  (entry) => entry.instance === 'original'
                ),
              },
              width: decoded.width,
              height: decoded.height,
              bytes,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              byteLength: bytes.byteLength,
            }
          }),
        recordAudioClip: (options = {}) =>
          serial(async () =>
          {
            const active = await requireOpen()
            const { signal, ...pageOptions } = options
            const cancelled = () => ({
              status: 'unavailable' as const,
              tickStart: lastStatus.tick,
              tickEnd: lastStatus.tick,
              durationMs: 0,
              mimeType: null,
              base64: null,
              issue: 'output audio capture cancelled',
            })
            let cancellationTimer: ReturnType<typeof setTimeout> | undefined
            let resolveCancelled!: (value: ReturnType<typeof cancelled>) => void
            const cancellation = new Promise<ReturnType<typeof cancelled>>(
              (resolve) =>
              {
                resolveCancelled = resolve
              }
            )
            const abortClip = () =>
            {
              void active.page
                .evaluate(() => window.__projectDebug!.cancelAudioClip())
                .catch(() => undefined)
              cancellationTimer ??= setTimeout(
                () => resolveCancelled(cancelled()),
                3000
              )
            }
            let captured
            if (signal?.aborted) captured = cancelled()
            else
            {
              const recording = active.page.evaluate(
                (input) => window.__projectDebug!.recordAudioClip(input),
                pageOptions
              )
              signal?.addEventListener('abort', abortClip, { once: true })
              try
              {
                captured = await Promise.race([recording, cancellation])
              }
              finally
              {
                signal?.removeEventListener('abort', abortClip)
                if (cancellationTimer !== undefined)
                  clearTimeout(cancellationTimer)
              }
            }
            const bytes =
              captured.base64 === null
                ? null
                : Uint8Array.from(Buffer.from(captured.base64, 'base64'))
            if (
              bytes &&
              bytes.byteLength >
                (options.maxBytes ?? PROFILE_AUDIO_LIMITS_V1.defaultBytes)
            )
              throw new Error(
                'returned output audio exceeds its configured byte budget'
              )
            await flush()
            return {
              schemaVersion: 1 as const,
              status: captured.status,
              diagnosticOnly: true as const,
              origin: 'internal-runtime-output' as const,
              sourceSha256,
              runtimeIdentitySha256: createHash('sha256')
                .update(JSON.stringify(active.runtimeDescriptor))
                .digest('hex'),
              profile,
              tickStart: captured.tickStart,
              tickEnd: captured.tickEnd,
              durationMs: captured.durationMs,
              mimeType: captured.mimeType,
              bytes,
              sha256:
                bytes === null
                  ? null
                  : createHash('sha256').update(bytes).digest('hex'),
              byteLength: bytes?.byteLength ?? 0,
              issue: captured.issue,
            }
          }),
        drainSoundEvents: () =>
          isClosed
            ? Promise.resolve(
                (() =>
                  {
                  const events = soundCache
                  soundCache = []
                  return { ...soundSummary, events }
                })()
              )
            : serial(async () =>
              {
                await flush()
                const events = soundCache
                soundCache = []
                return { ...soundSummary, events }
              }),
        readPerformanceDiagnostics: () =>
          isClosed
            ? Promise.resolve(
                structuredClone(
                  performanceCache ?? {
                    schemaVersion: 1,
                    status: 'unavailable',
                    diagnosticOnly: true,
                    profile,
                    sourceSha256,
                    runtimeIdentitySha256: createHash('sha256')
                      .update(JSON.stringify(host!.runtimeDescriptor))
                      .digest('hex'),
                    totalSteps: 0,
                    elapsedMs: 0,
                    observedHz: null,
                    meanVmStepMs: null,
                    maxVmStepMs: null,
                    meanProbeMs: null,
                    stepsOverClockBudget: 0,
                    retainedSamples: [],
                    droppedSamples: 0,
                    issue:
                      'browser closed before performance diagnostics were captured',
                  }
                )
              )
            : serial(async () =>
              {
                await flush()
                return structuredClone(performanceCache!)
              }),
        diagnostics: () => ({
          errors: [...errors],
          consoleLog: [...consoleCollector.entries],
          consoleSummary: consoleCollector.summary(),
        }),
        close: () =>
        {
          closePromise ??= (async () =>
          {
            closing = true
            if (polling) clearInterval(polling)
            if (hardDeadline) clearTimeout(hardDeadline)
            let timeout: ReturnType<typeof setTimeout> | undefined
            const unavailable = (message: string) =>
            {
              captureComplete = false
              soundSummary = { ...soundSummary, complete: false }
              lastStatus = {
                ...lastStatus,
                status: 'closed',
                issue: lastStatus.issue ?? message,
              }
            }
            // cleanup is independent of a pending command or an unresponsive browser task
            const graceful = (async () =>
            {
              try
              {
                if (page.isClosed())
                {
                  unavailable('browser closed before final release capture')
                  return
                }
                await page.evaluate(() => window.__projectDebug!.close())
                await flush()
              }
              catch (error)
              {
                unavailable(
                  `final release capture unavailable: ${error instanceof Error ? error.message.slice(0, 1024) : 'browser cleanup failed'}`
                )
              }
            })()
            try
            {
              await Promise.race([
                graceful,
                new Promise<void>((resolve) =>
                {
                  timeout = setTimeout(() =>
                  {
                    unavailable(
                      'final release capture unavailable: browser cleanup grace expired'
                    )
                    void host!.close().finally(resolve)
                  }, PROFILE_BROWSER_CLOSE_GRACE_MS_V1)
                }),
              ])
            }
            finally
            {
              if (timeout) clearTimeout(timeout)
              isClosed = true
              finish()
            }
            await lifetime
          })()
          return closePromise
        },
      }
      abortListener = () =>
      {
        void engine!.close().catch(() => undefined)
      }
      options.signal?.addEventListener('abort', abortListener, { once: true })
      if (options.signal?.aborted)
      {
        abortListener()
        throw (
          options.signal.reason ??
          new Error('profile browser opening cancelled')
        )
      }
      hardDeadline = setTimeout(() =>
      {
        terminationIssue = 'runtime duration budget exhausted'
        lastStatus = {
          ...lastStatus,
          issue: terminationIssue,
        }
        void engine!.close().catch(() => undefined)
      }, limits.maxDurationMs)
      await page.exposeFunction(
        '__projectDebugControl',
        async (control: string) =>
        {
          if (
            !['start', 'pause', 'resume', 'restart', 'close'].includes(control)
          )
            throw new Error('unknown playtest control')
          if (options.onControl)
          {
            await options.onControl(
              control as 'start' | 'pause' | 'resume' | 'restart' | 'close'
            )
            return
          }
          if (control === 'restart')
            throw new Error('restart requires a retained development service')
          if (control === 'close')
          {
            void engine!.close().catch(() => undefined)
            return
          }
          await engine![control as 'start' | 'pause' | 'resume']()
        }
      )
      await page.evaluate(
        (path) => window.__projectDebug!.load(path),
        host.projectPath
      )
      await page.evaluate((input) => window.__projectDebug!.prepare(input), {
        profile,
        inputMode: options.inputMode,
        seed,
        fixedDateMs,
        limits,
        targets,
      })
      page.on('close', () =>
      {
        if (isClosed) return
        if (options.onControl) void options.onControl('close')
        else void engine!.close().catch(() => undefined)
      })
      polling = setInterval(() =>
      {
        void serial(flush).catch((error: unknown) =>
        {
          lastStatus = {
            ...lastStatus,
            status: 'failed',
            issue:
              error instanceof Error
                ? error.message
                : 'browser evidence drain failed',
          }
          void engine!.close().catch(() => undefined)
        })
      }, 50)
      if (options.signal?.aborted || closing)
        throw (
          options.signal?.reason ??
          new Error('profile browser opening cancelled')
        )
      resolveReady(engine)
      await done
    }
    catch (error)
    {
      failure = { error }
    }
    finally
    {
      if (polling) clearInterval(polling)
      if (hardDeadline) clearTimeout(hardDeadline)
      if (abortListener)
        options.signal?.removeEventListener('abort', abortListener)
      try
      {
        await host?.close()
      }
      catch (error)
      {
        failure ??= { error }
      }
      finally
      {
        if (!openingLease) releaseSlot()
      }
    }
    if (host?.browser.isConnected())
      throw new RunnerIssueError(
        createRunIssue({
          code: 'runner.cleanup.incomplete',
          kind: 'runtime',
          responsibility: 'infrastructure',
          message:
            'development browser remains connected after bounded owner cleanup',
        })
      )
    if (failure) throw failure.error
  })()
  // rejection is forwarded to the opening promise, while close also awaits resource cleanup
  void lifetime.catch((error: unknown) => rejectReady(error))
  return await ready
}
