// packages/runner/src/policy/determinism.ts
// deterministic clock, rng, fixed UTC date, & step-driven fake timers at runtime edges

import type { ScratchRuntime } from '../vm/vm-api.js'
import { RUNNER_TICK_MS } from '../browser/browser-config.js'
import { poisonRunnerExecution } from './execution-coordinator.js'

interface DeterminismOptions
{
  seed?: number
  // fixed wall-clock epoch (ms) for sensing_current / days-since-2000
  fixedDateMs?: number
  // virtual clock start (ms)
  startMs?: number
}

export interface Determinism
{
  // current virtual time in ms (advances one currentStepTime per _step)
  nowMs(): number
  // fire fake-setTimeout callbacks whose virtual deadline has passed
  flushTimers(): void
  // undo every global / static edge; call in a finally
  restore(): void
}

interface NowObj
{
  now(): number
}

// a static-bearing handle on the Timer class, reached via a live Timer instance
interface TimerClass
{
  nowObj: NowObj
}

interface FakeTimer
{
  id: number
  fireAt: number
  cb: () => void
}

interface ProcessLike
{
  env: Record<string, string | undefined>
  release?: { name?: string }
}

// mulberry32: tiny, fast, well-distributed seeded prng
function mulberry32(seed: number): () => number
{
  let a = seed >>> 0
  return () =>
  {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// install every deterministic edge for one run; the caller MUST call restore() in a finally
export function installDeterminism(
  runtime: ScratchRuntime,
  opts: DeterminismOptions = {}
): Determinism
{
  const originalUpdateCurrentMSecs = runtime.updateCurrentMSecs
  const stepMs = (): number =>
    typeof runtime.currentStepTime === 'number'
      ? runtime.currentStepTime
      : RUNNER_TICK_MS
  let virtualMs = opts.startMs ?? 0
  const timerClass = runtime.ioDevices.clock._projectTimer
    .constructor as unknown as TimerClass
  const origNowObj = Object.getOwnPropertyDescriptor(timerClass, 'nowObj')
  const sequencerTimer = runtime.sequencer.timer
  const originalSequencerTimerStart = sequencerTimer.start
  const originalSequencerTimerTimeElapsed = sequencerTimer.timeElapsed
  const origRandom = Math.random
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout
  const origDate = globalThis.Date
  const processLike = (globalThis as unknown as { process?: ProcessLike })
    .process
  const nodeProcess =
    processLike?.release?.name === 'node' ? processLike : undefined
  const hadTimezone = nodeProcess ? Object.hasOwn(nodeProcess.env, 'TZ') : false
  const originalTimezone = nodeProcess?.env.TZ
  let sequencerPassesLeft = 1
  const timers: FakeTimer[] = []
  let nextId = 1
  const fakeSetTimeout = (cb: () => void, delayMs = 0): number =>
  {
    const id = nextId++
    timers.push({ id, fireAt: virtualMs + delayMs, cb })
    return id
  }
  const fakeClearTimeout = (id?: number): void =>
  {
    const i = timers.findIndex((t) => t.id === id)
    if (i !== -1) timers.splice(i, 1)
  }

  const restore = (): void =>
  {
    let failed = false
    let firstFailure: unknown
    let globalFailed = false
    let firstGlobalFailure: unknown
    const attempt = (callback: () => void, processGlobal = false): void =>
    {
      try
      {
        callback()
      }
      catch (error)
      {
        if (!failed) firstFailure = error
        failed = true
        if (processGlobal && !globalFailed) firstGlobalFailure = error
        if (processGlobal) globalFailed = true
      }
    }

    attempt(() =>
    {
      runtime.updateCurrentMSecs = originalUpdateCurrentMSecs
    })
    attempt(() =>
    {
      sequencerTimer.start = originalSequencerTimerStart
    })
    attempt(() =>
    {
      sequencerTimer.timeElapsed = originalSequencerTimerTimeElapsed
    })
    attempt(() =>
    {
      Math.random = origRandom
    }, true)
    attempt(() =>
    {
      globalThis.setTimeout = origSetTimeout
    }, true)
    attempt(() =>
    {
      globalThis.clearTimeout = origClearTimeout
    }, true)
    attempt(() =>
    {
      globalThis.Date = origDate
    }, true)
    attempt(() =>
    {
      if (!nodeProcess) return
      if (hadTimezone) nodeProcess.env.TZ = originalTimezone
      else delete nodeProcess.env.TZ
    }, true)
    attempt(() =>
    {
      // restore an own descriptor, else drop the injected one so an inherited nowObj resurfaces
      if (origNowObj) Object.defineProperty(timerClass, 'nowObj', origNowObj)
      else delete (timerClass as { nowObj?: NowObj }).nowObj
    }, true)
    if (globalFailed) poisonRunnerExecution(firstGlobalFailure)
    if (failed) throw firstFailure
  }

  try
  {
    // 1) clock: updateCurrentMSecs is the once-per-step Date.now() chokepoint; self-advance it
    runtime.currentMSecs = virtualMs
    runtime.updateCurrentMSecs = function (): void
    {
      virtualMs += stepMs()
      this.currentMSecs = virtualMs
    }
    runtime.ioDevices.clock.resetProjectTimer()

    // 2) Timer.nowObj: default-constructed Timers read this static getter at construction
    Object.defineProperty(timerClass, 'nowObj', {
      configurable: true,
      get: () => ({ now: () => virtualMs }),
    })
    sequencerTimer.start = (): void =>
    {
      sequencerPassesLeft = 1
    }
    sequencerTimer.timeElapsed = (): number =>
    {
      if (sequencerPassesLeft > 0)
      {
        sequencerPassesLeft--
        return 0
      }
      return 0.75 * stepMs()
    }

    // 3) rng: one global swap covers operator_random, uid(), clone offsets, list-random
    Math.random = mulberry32(opts.seed ?? 0)

    // 4) fake timers: say/think-for-secs use global setTimeout; drive them off virtual time
    globalThis.setTimeout = fakeSetTimeout as unknown as typeof setTimeout
    globalThis.clearTimeout = fakeClearTimeout as unknown as typeof clearTimeout

    // 5) date: sensing_current / days-since-2000 read new Date() directly
    if (nodeProcess) nodeProcess.env.TZ = 'UTC'
    if (opts.fixedDateMs !== undefined)
    {
      const fixed = opts.fixedDateMs
      const FixedDate = class extends origDate
      {
        constructor(...args: ConstructorParameters<DateConstructor> | [])
        {
          if (args.length === 0) super(fixed)
          else super(...args)
        }
        static now(): number
        {
          return fixed
        }
      }
      globalThis.Date = FixedDate as DateConstructor
    }
  }
  catch (error)
  {
    try
    {
      restore()
    }
    catch (restoreError)
    {
      throw new AggregateError(
        [error, restoreError],
        'determinism installation and rollback failed'
      )
    }
    throw error
  }

  return {
    nowMs: () => virtualMs,
    flushTimers: () =>
    {
      const due = timers.filter((t) => t.fireAt <= virtualMs)
      if (due.length === 0) return
      due.sort((a, b) => a.fireAt - b.fireAt)
      for (const t of due)
      {
        const i = timers.indexOf(t)
        if (i !== -1) timers.splice(i, 1)
        t.cb()
      }
    },
    restore,
  }
}
