// packages/runner/src/development/profile-scenario.ts
// execute exact selected clocks & label natural scheduler runs as timing diagnostics

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserConsoleCollector } from '../policy/runtime-log.js'
import { isRunnerIssueError } from '../policy/issues.js'
import type {
  BrowserTrace,
  Scenario,
  VmStateSnapshot,
  ScreenshotRef,
} from '../policy/types.js'
import { createObservationTrace } from '../observation/observation-host.js'
import { defaultObservationPlan } from '../observation/observation.js'
import { decodeRuntimePngRgbaV1 } from '../observation/png-decode.js'
import {
  driveScenario,
  validateScenario,
  broadcastExhaustion,
  DEFAULT_MAX_TICKS,
  type ScenarioEngine,
} from '../scenario/scenario-driver.js'
import {
  validateRuntimeExecutionProfileV1,
  type RuntimeExecutionProfileV1,
} from './execution-profile.js'
import { openProfileBrowserEngineV1 } from './profile-browser-engine.js'
import type { ProfileBrowserEngineV1 } from './profile-browser-types.js'
import { profileRuntimeDescriptorBeforeLaunchV1 } from '../browser/browser-host.js'

export interface ExecuteProfileScenarioOptionsV1
{
  readonly profile: RuntimeExecutionProfileV1
  readonly screenshotDir: string
  readonly signal?: AbortSignal
  readonly maxDurationMs?: number
}
export interface ProfileScenarioTraceV1 extends BrowserTrace
{
  readonly executionProfile: RuntimeExecutionProfileV1
  readonly clock: {
    drive: 'manual' | 'native'
    tickMs: number
    replay: 'exact' | 'timing-diagnostic'
  }
  readonly naturalDiagnostics?: {
    visualCapture: 'native-suspended-without-input-release'
    requestedWaitTicks: number
    observedTicks: number
    elapsedMs: number
    exactReplay: false
  }
}

function sampleGrid(
  bytes: Uint8Array,
  columns: number,
  rows: number
): number[]
{
  const png = decodeRuntimePngRgbaV1(bytes)
  const sums = new Float64Array(columns * rows * 3)
  const counts = new Float64Array(columns * rows)
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
    {
      const cell =
        Math.min(rows - 1, Math.floor((y * rows) / png.height)) * columns +
        Math.min(columns - 1, Math.floor((x * columns) / png.width))
      const offset = (y * png.width + x) * 4
      counts[cell]!++
      for (let channel = 0; channel < 3; channel++)
        sums[cell * 3 + channel]! += png.rgba[offset + channel]!
    }
  return Array.from(sums, (sum, index) =>
    Math.round(sum / (counts[Math.floor(index / 3)] || 1))
  )
}

export async function executeProfileScenarioV1(
  sb3: Uint8Array,
  scenario: Scenario,
  options: ExecuteProfileScenarioOptionsV1
): Promise<ProfileScenarioTraceV1>
{
  const profile = validateRuntimeExecutionProfileV1(options.profile)
  validateScenario(scenario)
  if (
    scenario.steps.length > 1024 ||
    scenario.steps.filter((step) => step.do === 'snapshot').length > 128
  )
    throw new Error(
      'profile scenario exceeds bounded step or snapshot capacity'
    )
  const maxTicks = scenario.maxTicks ?? DEFAULT_MAX_TICKS
  if (maxTicks > 10000) throw new Error('profile scenario exceeds 10000 ticks')
  const maxDurationMs = options.maxDurationMs ?? 120000
  const snapshots: VmStateSnapshot[] = []
  const screenshots: ScreenshotRef[] = []
  const errors: string[] = []
  const consoleCollector = new BrowserConsoleCollector()
  let engine: ProfileBrowserEngineV1 | undefined
  let finalSnapshot: VmStateSnapshot | null = null
  let runtimeDescriptor = profileRuntimeDescriptorBeforeLaunchV1(profile)
  let requestedWaitTicks = 0
  let observedTicks = 0
  let elapsedMs = 0
  try
  {
    await mkdir(options.screenshotDir, { recursive: true })
    engine = await openProfileBrowserEngineV1({
      sb3,
      profile,
      inputMode: 'agent',
      headless: true,
      limits: {
        maxTicks: Math.max(1, maxTicks),
        maxDurationMs,
        maxStateFrames: Math.max(1, maxTicks),
      },
      signal: options.signal,
    })
    runtimeDescriptor = engine.runtimeDescriptor
    engine.page.on('console', (message) =>
      consoleCollector.add(message.type(), message.text())
    )
    async function step(ticks: number): Promise<void>
    {
      requestedWaitTicks += ticks
      if (profile.scheduler === 'deterministic')
      {
        await engine!.advance(ticks)
        return
      }
      const before = await engine!.status()
      const target = before.tick + ticks
      if (target > maxTicks)
        throw new Error(`scenario exceeded maxTicks (${maxTicks})`)
      while (true)
      {
        if (options.signal?.aborted)
          throw options.signal.reason ?? new Error('profile scenario cancelled')
        const state = await engine!.status()
        if (state.status === 'failed' || state.status === 'closed')
          throw new Error(state.issue ?? `profile runtime is ${state.status}`)
        if (state.tick >= target) break
        if (state.status !== 'running')
          throw new Error('natural waits require a running scheduler')
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(1, Math.min(8, 1000 / profile.tickRate / 4))
          )
        )
      }
    }
    const adapter: ScenarioEngine = {
      greenFlag: async () =>
      {
        await engine!.start()
      },
      step,
      pressKey: async (key) =>
      {
        await engine!.applyInput({ device: 'keyboard', key, isDown: true })
      },
      releaseKey: async (key) =>
      {
        await engine!.applyInput({ device: 'keyboard', key, isDown: false })
      },
      moveMouse: async (x, y) =>
      {
        await engine!.applyInput({ device: 'mouse', x, y })
      },
      mouseDown: async (x, y) =>
      {
        await engine!.applyInput({ device: 'mouse', x, y, isDown: true })
      },
      mouseUp: async (x, y) =>
      {
        await engine!.applyInput({ device: 'mouse', x, y, isDown: false })
      },
      clickSprite: async (value) =>
      {
        await engine!.page.evaluate(
          (value) =>
            window.__projectDebug!.action({ kind: 'clickSprite', value }),
          value
        )
      },
      clickStage: async () =>
      {
        await engine!.page.evaluate(() =>
          window.__projectDebug!.action({ kind: 'clickStage' })
        )
      },
      broadcast: async (value) =>
      {
        await engine!.page.evaluate(
          (value) =>
            window.__projectDebug!.action({ kind: 'broadcast', value }),
          value
        )
      },
      answer: async (value) =>
      {
        await engine!.page.evaluate(
          (value) => window.__projectDebug!.action({ kind: 'answer', value }),
          value
        )
      },
      broadcastAndWait: async (name, cap) =>
      {
        await engine!.page.evaluate(
          (value) => window.__projectDebug!.beginBroadcastWait(value),
          name
        )
        for (let index = 0; index < cap; index++)
        {
          if (
            !(await engine!.page.evaluate(() =>
              window.__projectDebug!.broadcastRunning()
            ))
          )
            return
          await step(1)
        }
        if (
          await engine!.page.evaluate(() =>
            window.__projectDebug!.broadcastRunning()
          )
        )
          throw broadcastExhaustion(
            name,
            cap,
            (await engine!.status()).tick,
            maxTicks
          )
      },
      snapshot: async (label) =>
      {
        if (profile.scheduler === 'natural')
          await engine!.page.evaluate(() =>
            window.__projectDebug!.setCaptureSuspended(true)
          )
        try
        {
          const snapshot = await engine!.snapshot(label)
          snapshot.visual = await engine!.page.evaluate(() =>
            window.__projectDebug!.visual()
          )
          const bytes = await engine!.page
            .locator('canvas')
            .first()
            .screenshot({ type: 'png' })
          snapshot.visual.grid = sampleGrid(
            bytes,
            snapshot.visual.gridCols,
            snapshot.visual.gridRows
          )
          const safe = label.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80)
          const path = join(
            options.screenshotDir,
            `${String(screenshots.length).padStart(3, '0')}-${snapshot.tick}-${safe}.png`
          )
          await writeFile(path, bytes, { flag: 'wx' })
          snapshots.push(snapshot)
          screenshots.push({ label, tick: snapshot.tick, path })
        }
        finally
        {
          if (profile.scheduler === 'natural')
            await engine!.page.evaluate(() =>
              window.__projectDebug!.setCaptureSuspended(false)
            )
        }
      },
    }
    await driveScenario(adapter, scenario)
    if (profile.scheduler === 'natural') await engine.pause()
    finalSnapshot = await engine.snapshot('final')
    const state = await engine.status()
    observedTicks = state.tick
    elapsedMs = state.elapsedMs
    if (state.status === 'failed')
      errors.push(state.issue ?? 'profile runtime failed')
    errors.push(...engine.diagnostics().errors)
  }
  catch (error)
  {
    if (
      isRunnerIssueError(error) &&
      error.issue.code === 'runner.cleanup.incomplete'
    )
      throw error
    errors.push(error instanceof Error ? error.message : String(error))
  }
  finally
  {
    await engine?.close()
  }
  return {
    ok: errors.length === 0,
    runtime: profile.runtime,
    runtimeDescriptor,
    observations: createObservationTrace(
      sb3,
      scenario,
      defaultObservationPlan()
    ),
    mediaRoot: null,
    snapshots,
    finalSnapshot,
    screenshots,
    diagnosticVideo: null,
    errors,
    issues: [],
    consoleLog: [...consoleCollector.entries],
    consoleSummary: consoleCollector.summary(),
    executionProfile: profile,
    clock: {
      drive: profile.scheduler === 'deterministic' ? 'manual' : 'native',
      tickMs: 1000 / profile.tickRate,
      replay:
        profile.scheduler === 'deterministic' ? 'exact' : 'timing-diagnostic',
    },
    ...(profile.scheduler === 'natural'
      ? {
          naturalDiagnostics: {
            requestedWaitTicks,
            observedTicks,
            elapsedMs,
            exactReplay: false as const,
            visualCapture: 'native-suspended-without-input-release' as const,
          },
        }
      : {}),
  }
}
