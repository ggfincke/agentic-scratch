// packages/runner/src/browser/browser-lane.ts
// browser visual lane: render a .sb3 via playwright + scaffolding, frame-exact stepping + screenshots

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { PNG } from 'pngjs'

import {
  browserFailureIssue,
  browserPageIssue,
  type BrowserRunStage,
} from './browser-issues.js'
import {
  OFFICIAL_BROWSER_LINEAGE_IDENTITY,
  RENDERED_BROWSER_GL_ARGS,
  TURBOWARP_LINEAGE_IDENTITY,
} from './browser-config.js'
import {
  fallbackRenderedRuntimeDescriptor,
  openRenderedPageHost,
  renderedRuntimeDescriptorBeforeLaunch,
  renderedRuntimeId,
  type RenderedBrowserRuntime,
  type RenderedPageHost,
} from './browser-host.js'
export { installBrowserWebSocketPolicy } from './browser-host.js'
import { errorMessage } from '../error-message.js'
import { withRunnerExecution } from '../policy/execution-coordinator.js'
import {
  RUN_ISSUE_CODES,
  RunnerIssueError,
  createRunIssue,
  runIssueMessages,
  toRunIssue,
  type RunIssue,
} from '../policy/issues.js'
import {
  createIdentityBoundObservationTrace,
  createObservationTrace,
  hashObservationPlan,
  verifyMediaManifest,
  writeMediaFileExclusive,
} from '../observation/observation-host.js'
import {
  defaultObservationPlan,
  observationTicks,
  RUNNER_OBSERVATION_SCHEMA_VERSION,
  validateObservationPlan,
  type CloneCountSampleV1,
  type DerivedVideoRefV1,
  type MediaFrameRefV1,
  type MediaManifestV1,
  type ObservationPlanV1,
  type RuntimeObservationCellOptionsV1,
} from '../observation/observation.js'
import type { BrowserRuntimeObservationV1 } from './browser-api.js'
import type { RuntimeObservationRecordV1 } from '../observation/runtime-observation.js'
import {
  BrowserConsoleCollector,
  emptyBrowserConsoleSummary,
} from '../policy/runtime-log.js'
import {
  DEFAULT_MAX_TICKS,
  broadcastExhaustion,
  driveScenario,
  maxTicksError,
  ticksAllowed,
  validateScenario,
  type ScenarioEngine,
} from '../scenario/scenario-driver.js'
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
} from '../scenario/identity-bound-scenario.js'
import {
  toStateSnapshot,
  type CloneCountRead,
} from '../observation/snapshot.js'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'
import type {
  BrowserLaneResult,
  BrowserTrace,
  DiagnosticVideoRef,
  RunScenario,
  Scenario,
  ScreenshotRef,
  VmStateSnapshot,
} from '../policy/types.js'
import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import {
  unavailableRuntimeLineageAdapterResultV1,
  type RuntimeLineageAdapterResultV1,
  type RuntimeIdentityFacetV1,
  type RuntimeLineageManifestV1,
} from '../lineage/runtime-lineage.js'
import { snapshotSteps } from '../vm/vm-lane.js'

export interface BrowserScenarioOptions
{
  // directory to write per-snapshot stage screenshots into
  screenshotDir: string
  // authoritative Multimodal media root; required when the observation plan is temporal
  mediaDir?: string
  observationPlan?: ObservationPlanV1
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
  // opt-in facet: served beside the project bytes on the routed origin
  lineageManifest?: RuntimeLineageManifestV1
  // opt-in facet: drive this lowered timeline instead of the raw scenario
  identityBoundScenario?: IdentityBoundScenarioV1
  // opt-in facet: tag & bound values before browser serialization
  runtimeObservation?: RuntimeObservationCellOptionsV1
}

// per-image hold for failure diagnostics so the recorder captures distinct frames (~6 fps)
const DIAGNOSTIC_FRAME_HOLD_MS = 150

// hard cap for a derived failure-diagnostic video; larger outputs are skipped
const DIAGNOSTIC_MAX_BYTES = 25 * 1024 * 1024

// legacy single-screenshot option shape kept for the spike report
interface BrowserLaneOptions
{
  screenshotPath: string
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
}

function addBlockedNetworkError(
  issues: RunIssue[],
  blockedUrls: string[],
  url: string
): void
{
  const message = `blocked network request: ${url}`
  if (blockedUrls.includes(url)) return
  blockedUrls.push(url)
  issues.push(
    createRunIssue({
      code: RUN_ISSUE_CODES.networkRequestDenied,
      kind: 'network-policy',
      responsibility: 'unsupported',
      message,
    })
  )
}

function screenshotName(tick: number, label: string): string
{
  const safe = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
  return `${String(tick).padStart(4, '0')}-${safe}.png`
}

// derive whole-frame & sampled RGB metrics in one row-major pass
function pngMetrics(
  png: PNG,
  columns: number,
  rows: number
): {
  meanRgb: [number, number, number]
  sampledMeanRgb: {
    columns: number
    rows: number
    values: number[]
  }
}
{
  let totalRed = 0
  let totalGreen = 0
  let totalBlue = 0
  const cells = columns * rows
  const rSum = new Float64Array(cells)
  const gSum = new Float64Array(cells)
  const bSum = new Float64Array(cells)
  const count = new Float64Array(cells)
  const cellW = png.width / columns
  const cellH = png.height / rows
  for (let py = 0; py < png.height; py++)
  {
    const gy = Math.min(rows - 1, Math.floor(py / cellH))
    for (let px = 0; px < png.width; px++)
    {
      const gx = Math.min(columns - 1, Math.floor(px / cellW))
      const idx = (py * png.width + px) * 4
      const red = png.data[idx] ?? 0
      const green = png.data[idx + 1] ?? 0
      const blue = png.data[idx + 2] ?? 0
      totalRed += red
      totalGreen += green
      totalBlue += blue
      const ci = gy * columns + gx
      rSum[ci]! += red
      gSum[ci]! += green
      bSum[ci]! += blue
      count[ci]! += 1
    }
  }
  const grid = new Array<number>(cells * 3).fill(0)
  for (let ci = 0; ci < cells; ci++)
  {
    const n = count[ci] || 1
    grid[ci * 3] = Math.round(rSum[ci]! / n)
    grid[ci * 3 + 1] = Math.round(gSum[ci]! / n)
    grid[ci * 3 + 2] = Math.round(bSum[ci]! / n)
  }
  const pixels = png.width * png.height
  return {
    meanRgb: [totalRed / pixels, totalGreen / pixels, totalBlue / pixels],
    sampledMeanRgb: { columns, rows, values: grid },
  }
}

function observationError(
  code:
    | typeof RUN_ISSUE_CODES.observationCaptureFailed
    | typeof RUN_ISSUE_CODES.observationBudgetExceeded,
  message: string
): RunnerIssueError
{
  return new RunnerIssueError(
    createRunIssue({
      code,
      kind: 'observation',
      responsibility: 'infrastructure',
      message,
    })
  )
}

// one source frame for a derived recording: raw bytes or a filesystem path plus its hold time
interface DerivedVideoSource
{
  bytes?: Uint8Array
  path?: string
  holdMs: number
}

// record PNG sources into a webm via a throwaway recording context; the only wall-clock use left
async function deriveVideoFromPngs(
  browser: Browser,
  sources: readonly DerivedVideoSource[]
): Promise<Buffer>
{
  if (sources.length === 0)
    throw new Error('cannot derive a video without source frames')
  const recordingDir = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-multimodal-video-')
  )
  let context: Awaited<ReturnType<Browser['newContext']>> | undefined
  try
  {
    context = await browser.newContext({
      viewport: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
      recordVideo: {
        dir: recordingDir,
        size: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
      },
    })
    const page = await context.newPage()
    const video = page.video()
    await page.setContent(
      '<style>html,body{margin:0;background:#000;overflow:hidden}' +
        `img{display:block;width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px}</style>` +
        '<img id="frame">'
    )
    for (const source of sources)
    {
      const bytes = source.bytes ?? readFileSync(source.path!)
      const src = `data:image/png;base64,${bytes.toString('base64')}`
      await page.evaluate(
        async (input: { src: string; holdMs: number }) =>
        {
          const element = document.getElementById('frame') as HTMLImageElement
          element.src = input.src
          await element.decode()
          await new Promise<void>((done) => requestAnimationFrame(() => done()))
          await new Promise<void>((done) => setTimeout(done, input.holdMs))
        },
        { src, holdMs: source.holdMs }
      )
    }
    await context.close()
    context = undefined
    if (!video)
      throw new Error('Playwright did not create the derived video recorder')
    const sourcePath = await video.path()
    return readFileSync(sourcePath)
  }
  finally
  {
    if (context) await context.close().catch(() => undefined)
    rmSync(recordingDir, { recursive: true, force: true })
  }
}

async function createDerivedVideo(
  browser: Browser,
  mediaRoot: string,
  frames: readonly MediaFrameRefV1[],
  plan: ObservationPlanV1
): Promise<DerivedVideoRefV1>
{
  const temporal = plan.temporal
  if (!temporal || frames.length === 0)
    throw observationError(
      RUN_ISSUE_CODES.observationCaptureFailed,
      'cannot derive a video without authoritative temporal frames'
    )
  const holdMs = 1000 / temporal.playbackFps
  const bytes = await deriveVideoFromPngs(
    browser,
    frames.map((frame) => ({
      path: join(mediaRoot, frame.relativePath),
      holdMs,
    }))
  )
  if (bytes.byteLength > temporal.maxBytes)
    throw observationError(
      RUN_ISSUE_CODES.observationBudgetExceeded,
      `derived video uses ${bytes.byteLength} bytes, exceeding ${temporal.maxBytes}`
    )
  const relativePath = 'derived/temporal.webm'
  const identity = writeMediaFileExclusive(mediaRoot, relativePath, bytes)
  return {
    id: 'derived-temporal-video',
    relativePath,
    mimeType: 'video/webm',
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    durationMs: Math.round((frames.length * 1000) / temporal.playbackFps),
    playbackFps: temporal.playbackFps,
    bytes: identity.byteLength,
    sha256: identity.sha256,
    authoritative: false,
    sourceFrameIds: frames.map((frame) => frame.id),
  }
}

// failure-only diagnostic video assembled from labeled snapshots then temporal frames by tick;
// best-effort: never part of MediaManifestV1, never evidence, never affects the lane result
async function createDiagnosticVideo(
  browser: Browser,
  root: string,
  screenshots: readonly ScreenshotRef[],
  frames: readonly MediaFrameRefV1[],
  mediaRoot: string | null
): Promise<DiagnosticVideoRef | null>
{
  const entries = [
    ...screenshots.map((screenshot) => ({
      tick: screenshot.tick,
      path: screenshot.path,
    })),
    ...(mediaRoot
      ? frames.map((frame) => ({
          tick: frame.tick,
          path: join(mediaRoot, frame.relativePath),
        }))
      : []),
  ].sort((a, b) => a.tick - b.tick)
  if (entries.length === 0) return null
  const bytes = await deriveVideoFromPngs(
    browser,
    entries.map((entry) => ({
      path: entry.path,
      holdMs: DIAGNOSTIC_FRAME_HOLD_MS,
    }))
  )
  if (bytes.byteLength > DIAGNOSTIC_MAX_BYTES) return null
  const identity = writeMediaFileExclusive(
    root,
    'derived/diagnostics.webm',
    bytes
  )
  return {
    relativePath: identity.path,
    sha256: identity.sha256,
    byteLength: identity.byteLength,
  }
}

// derive a diagnostic after a higher-level evaluator has classified the run as failed
export async function deriveDiagnosticVideoFromScreenshots(
  root: string,
  screenshots: readonly ScreenshotRef[]
): Promise<DiagnosticVideoRef | null>
{
  if (screenshots.length === 0) return null
  try
  {
    return await withRunnerExecution(async () =>
    {
      let browser: Browser | undefined
      try
      {
        browser = await chromium.launch({
          headless: true,
          args: [...RENDERED_BROWSER_GL_ARGS],
        })
        return await createDiagnosticVideo(browser, root, screenshots, [], null)
      }
      catch
      {
        return null
      }
      finally
      {
        if (browser)
        {
          try
          {
            await browser.close()
          }
          catch
          {
            // a failed cleanup only loses a best-effort diagnostic
          }
        }
      }
    })
  }
  catch
  {
    return null
  }
}

// drive the Step[] timeline against the in-page __spike primitives via page.evaluate
class BrowserEngine implements ScenarioEngine, IdentityBoundScenarioEngine
{
  readonly snapshots: VmStateSnapshot[] = []
  finalSnapshot: VmStateSnapshot | null = null
  readonly screenshots: ScreenshotRef[] = []
  readonly frames: MediaFrameRefV1[] = []
  readonly cloneCounts: CloneCountSampleV1[] = []
  readonly observationIssues: RunIssue[] = []
  readonly runtimeObservations: RuntimeObservationRecordV1<BrowserRuntimeObservationV1>[] =
    []
  private tick = 0
  private scenarioStepIndex = -1
  private totalFrameBytes = 0
  private readonly temporalTicks: number[]
  private readonly temporalTickSet: Set<number>
  private readonly cloneSampleIndexes = new Map<number, number>()
  private readonly frameIndexes = new Map<number, number>()
  private readonly topologyIssues = new Set<string>()
  private runtimeObservationAborted = false

  constructor(
    private readonly page: Page,
    private readonly canvas: Locator,
    private readonly screenshotDir: string,
    private readonly maxTicks: number,
    private readonly observationPlan: ObservationPlanV1,
    private readonly mediaRoot: string | null,
    private readonly runtimeObservation?: RuntimeObservationCellOptionsV1
  )
  {
    this.temporalTicks = observationTicks(observationPlan)
    this.temporalTickSet = new Set(this.temporalTicks)
  }

  beginScenarioStep(index: number): void
  {
    this.scenarioStepIndex = index
  }

  async startObservations(): Promise<void>
  {
    if (this.runtimeObservation)
      await this.page.evaluate(
        (input) =>
          window.__spike!.beginRuntimeObservation(
            input.caps,
            input.carriedAttemptTraceBytes
          ),
        {
          caps: this.runtimeObservation.caps,
          carriedAttemptTraceBytes:
            this.runtimeObservation.carriedAttemptTraceBytes ?? 0,
        }
      )
    await this.observeCurrentTick()
  }

  async greenFlag(): Promise<void>
  {
    await this.page.evaluate(() => window.__spike!.greenFlag())
  }

  async step(n: number): Promise<void>
  {
    // advance up to the cap (matching the vm lane) before failing, so an overshooting step
    // leaves both lanes at the same tick rather than the browser aborting w/ 0 ticks run
    const allowed = ticksAllowed(this.tick, n, this.maxTicks)
    let remaining = allowed
    while (remaining > 0)
    {
      const chunk = this.nextObservationChunk(remaining)
      await this.page.evaluate((k) => window.__spike!.step(k), chunk)
      this.tick += chunk
      remaining -= chunk
      await this.observeCurrentTick()
    }
    if (allowed < n) throw maxTicksError(this.maxTicks)
  }

  async pressKey(key: string): Promise<void>
  {
    await this.page.evaluate((k) => window.__spike!.pressKey(k), key)
  }

  async releaseKey(key: string): Promise<void>
  {
    await this.page.evaluate((k) => window.__spike!.releaseKey(k), key)
  }

  async clickSprite(name: string): Promise<void>
  {
    await this.page.evaluate((n) => window.__spike!.clickSprite(n), name)
  }

  currentTick(): number
  {
    return this.tick
  }

  async resolveTargetLineage(
    targetLineage: string
  ): Promise<IdentityBoundTargetResolutionV1>
  {
    return this.page.evaluate(
      (lineage) => window.__spike!.resolveTargetLineage(lineage),
      targetLineage
    )
  }

  async resolveBroadcast(
    action: IdentityBoundBroadcastActionV1
  ): Promise<IdentityBoundBroadcastResolutionV1>
  {
    return this.page.evaluate(
      (input) => window.__spike!.resolveBroadcastLineage(input),
      action as IdentityBoundBroadcastActionV1
    )
  }

  async clickResolvedTarget(
    resolved: IdentityBoundResolvedTargetV1
  ): Promise<void>
  {
    await this.page.evaluate(
      (lineage) => window.__spike!.clickTargetLineage(lineage),
      resolved.targetLineage
    )
  }

  async broadcastResolved(
    resolved: IdentityBoundResolvedBroadcastV1
  ): Promise<IdentityBoundBroadcastDispatchV1>
  {
    return this.page.evaluate(
      (input) => window.__spike!.broadcastLineage(input),
      resolved as IdentityBoundResolvedBroadcastV1
    )
  }

  // same tick-chunked drain as the name-valued path, entered through the
  // lineage-bound start so the retained dispatch names its receivers
  async broadcastAndWaitResolved(
    resolved: IdentityBoundResolvedBroadcastV1,
    cap: number
  ): Promise<IdentityBoundBroadcastDispatchV1>
  {
    const limit = ticksAllowed(this.tick, cap, this.maxTicks)
    const dispatch = await this.page.evaluate(
      (input) => window.__spike!.beginBroadcastWaitLineage(input),
      resolved as IdentityBoundResolvedBroadcastV1
    )
    await this.drainBroadcastWait(limit, resolved.name, cap)
    return dispatch
  }

  async clickStage(): Promise<void>
  {
    await this.page.evaluate(() => window.__spike!.clickStage())
  }

  async broadcast(name: string): Promise<void>
  {
    await this.page.evaluate((n) => window.__spike!.broadcast(n), name)
  }

  async broadcastAndWait(name: string, cap: number): Promise<void>
  {
    const limit = ticksAllowed(this.tick, cap, this.maxTicks)
    await this.page.evaluate(
      (message) => window.__spike!.beginBroadcastWait(message),
      name
    )
    await this.drainBroadcastWait(limit, name, cap)
  }

  private async drainBroadcastWait(
    limit: number,
    name: string,
    cap: number
  ): Promise<void>
  {
    let remaining = limit
    let running = true
    while (running && remaining > 0)
    {
      const chunk = this.nextObservationChunk(remaining)
      const result = await this.page.evaluate(
        (count) => window.__spike!.continueBroadcastWait(count),
        chunk
      )
      this.tick += result.used
      remaining -= result.used
      running = result.running
      if (result.used > 0) await this.observeCurrentTick()
      if (running && result.used < chunk)
        throw observationError(
          RUN_ISSUE_CODES.observationCaptureFailed,
          'broadcast stepping stopped before its requested observation boundary'
        )
    }
    if (running)
    {
      throw broadcastExhaustion(name, cap, this.tick, this.maxTicks)
    }
  }

  async moveMouse(x: number, y: number): Promise<void>
  {
    await this.page.evaluate(
      (a: [number, number]) => window.__spike!.moveMouse(a[0], a[1]),
      [x, y] as [number, number]
    )
  }

  async mouseDown(x: number, y: number): Promise<void>
  {
    await this.page.evaluate(
      (a: [number, number]) => window.__spike!.mouseDown(a[0], a[1]),
      [x, y] as [number, number]
    )
  }

  async mouseUp(x: number, y: number): Promise<void>
  {
    await this.page.evaluate(
      (a: [number, number]) => window.__spike!.mouseUp(a[0], a[1]),
      [x, y] as [number, number]
    )
  }

  async answer(text: string): Promise<void>
  {
    await this.page.evaluate((t) => window.__spike!.answer(t), text)
  }

  async snapshot(label: string): Promise<void>
  {
    try
    {
      await this.captureRuntimeObservation(label)
      // readState -> readVisual already draws this frame; no state changes before the screenshot,
      // so the capture below reuses that draw (no extra draw round-trip)
      const snap = await this.page.evaluate(
        (a: [string, number]) => window.__spike!.readState(a[0], a[1]),
        [label, this.tick] as [string, number]
      )
      const path = join(this.screenshotDir, screenshotName(this.tick, label))
      const buf = await this.canvas.screenshot({ path })
      if (snap.visual)
      {
        this.recordTopologyIssues(snap.visual.identityIssues)
        const metrics = pngMetrics(
          PNG.sync.read(buf),
          snap.visual.gridCols,
          snap.visual.gridRows
        )
        snap.visual.grid = metrics.sampledMeanRgb.values
      }
      this.snapshots.push(snap)
      this.screenshots.push({ label, tick: this.tick, path })
      if (this.observationPlan.cloneCounts !== 'none')
        await this.recordCloneCount(label)
      const frameIndex = this.frameIndexes.get(this.tick)
      if (frameIndex !== undefined)
        this.frames[frameIndex] = {
          ...this.frames[frameIndex]!,
          snapshotLabel: label,
        }
    }
    catch (error)
    {
      throw new RunnerIssueError(
        toRunIssue(error, {
          code: RUN_ISSUE_CODES.browserSnapshotFailed,
          kind: 'internal',
          responsibility: 'infrastructure',
        })
      )
    }
  }

  async finish(): Promise<void>
  {
    try
    {
      await this.captureRuntimeObservation(null)
      this.finalSnapshot = await this.page.evaluate(
        (tick) => window.__spike!.readState('', tick),
        this.tick
      )
      if (this.finalSnapshot.visual)
        this.recordTopologyIssues(this.finalSnapshot.visual.identityIssues)
    }
    catch (error)
    {
      throw observationError(
        RUN_ISSUE_CODES.observationCaptureFailed,
        `final-state capture failed: ${errorMessage(error)}`
      )
    }
  }

  private async captureRuntimeObservation(
    label: string | null
  ): Promise<CloneCountRead | undefined>
  {
    if (!this.runtimeObservation || this.runtimeObservationAborted) return
    const read = await this.page.evaluate(
      (input: { label: string; tick: number; scenarioStepIndex: number }) =>
        window.__spike!.readRuntimeObservation(
          input.label,
          input.tick,
          input.scenarioStepIndex
        ),
      {
        label: label ?? '',
        tick: this.tick,
        scenarioStepIndex: this.scenarioStepIndex,
      }
    )
    const capture = read.capture
    this.runtimeObservations.push(
      Object.freeze({
        tick: this.tick,
        scenarioStepIndex: this.scenarioStepIndex,
        label,
        capture,
      })
    )
    if (capture.status === 'observed') return read.cloneRead
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
    return read.cloneRead
  }

  private nextObservationChunk(remaining: number): number
  {
    if (this.observationPlan.cloneCounts === 'every-tick') return 1
    let chunk = remaining
    for (const tick of this.temporalTicks)
    {
      if (tick <= this.tick) continue
      chunk = Math.min(chunk, tick - this.tick)
      break
    }
    return Math.max(1, chunk)
  }

  private async observeCurrentTick(): Promise<void>
  {
    const isTemporalTick = this.temporalTickSet.has(this.tick)
    const sampleClones =
      this.observationPlan.cloneCounts === 'every-tick' ||
      (this.observationPlan.cloneCounts === 'sampled' && isTemporalTick)
    let cloneRead: CloneCountRead | undefined
    if (sampleClones || isTemporalTick)
      cloneRead = await this.captureRuntimeObservation(null)
    if (sampleClones) await this.recordCloneCount(null, cloneRead)
    if (isTemporalTick) await this.captureTemporalFrame()
  }

  private async recordCloneCount(
    label: string | null,
    cloneRead?: CloneCountRead
  ): Promise<void>
  {
    try
    {
      const read =
        cloneRead ??
        (await this.page.evaluate(
          (input: {
            tick: number
            scenarioStepIndex: number
            label: string | null
          }) =>
            window.__spike!.readCloneCounts(
              input.tick,
              input.scenarioStepIndex,
              input.label
            ),
          { tick: this.tick, scenarioStepIndex: this.scenarioStepIndex, label }
        ))
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
      this.recordTopologyIssues(read.issues)
    }
    catch (error)
    {
      if (error instanceof RunnerIssueError) throw error
      throw observationError(
        RUN_ISSUE_CODES.observationCaptureFailed,
        `clone-count capture failed at tick ${this.tick}: ${errorMessage(error)}`
      )
    }
  }

  private recordTopologyIssues(messages: readonly string[]): void
  {
    for (const message of messages)
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
  }

  private async captureTemporalFrame(): Promise<void>
  {
    const temporal = this.observationPlan.temporal
    if (!temporal || !this.mediaRoot)
      throw observationError(
        RUN_ISSUE_CODES.observationCaptureFailed,
        'temporal observation has no admitted media root'
      )
    if (this.frames.length >= temporal.maxFrames)
      throw observationError(
        RUN_ISSUE_CODES.observationBudgetExceeded,
        `temporal observation exceeded ${temporal.maxFrames} frames`
      )
    try
    {
      const snapshot = await this.page.evaluate(
        (input: [string, number]) =>
          window.__spike!.readState(input[0], input[1]),
        ['', this.tick] as [string, number]
      )
      if (!snapshot.visual) throw new Error('renderer geometry is unavailable')
      this.recordTopologyIssues(snapshot.visual.identityIssues)
      const bytes = await this.canvas.screenshot({ type: 'png' })
      const png = PNG.sync.read(bytes)
      const metrics = pngMetrics(png, 16, 12)
      const nextBytes = this.totalFrameBytes + bytes.byteLength
      if (nextBytes > temporal.maxBytes)
        throw observationError(
          RUN_ISSUE_CODES.observationBudgetExceeded,
          `authoritative frames use ${nextBytes} bytes, exceeding ${temporal.maxBytes}`
        )
      const index = this.frames.length
      const relativePath =
        `frames/${String(index).padStart(4, '0')}` +
        `-t${String(this.tick).padStart(6, '0')}.png`
      const identity = writeMediaFileExclusive(
        this.mediaRoot,
        relativePath,
        bytes
      )
      const frame: MediaFrameRefV1 = {
        id: `temporal-frame-${String(index).padStart(4, '0')}`,
        index,
        tick: this.tick,
        scenarioStepIndex: this.scenarioStepIndex,
        snapshotLabel: null,
        relativePath,
        mimeType: 'image/png',
        width: png.width,
        height: png.height,
        meanRgb: metrics.meanRgb,
        sampledMeanRgb: metrics.sampledMeanRgb,
        geometry: snapshot.visual.geometry,
        bytes: identity.byteLength,
        sha256: identity.sha256,
      }
      this.frameIndexes.set(this.tick, index)
      this.frames.push(frame)
      this.totalFrameBytes = nextBytes
    }
    catch (error)
    {
      if (error instanceof RunnerIssueError) throw error
      throw observationError(
        RUN_ISSUE_CODES.observationCaptureFailed,
        `temporal frame capture failed at tick ${this.tick}: ${errorMessage(error)}`
      )
    }
  }

  async finalizeObservations(
    browser: Browser,
    runtime: RuntimeDescriptorV1
  ): Promise<MediaManifestV1 | null>
  {
    const temporal = this.observationPlan.temporal
    if (!temporal || !this.mediaRoot) return null
    const capturedTicks = new Set(this.frames.map((frame) => frame.tick))
    const missingTicks = this.temporalTicks.filter(
      (tick) => !capturedTicks.has(tick)
    )
    let complete = missingTicks.length === 0
    let incompleteReason = complete
      ? null
      : `missing logical frame ticks: ${missingTicks.join(', ')}`
    let derivedVideo: DerivedVideoRefV1 | null = null
    if (complete && temporal.derivedVideo)
    {
      try
      {
        derivedVideo = await createDerivedVideo(
          browser,
          this.mediaRoot,
          this.frames,
          this.observationPlan
        )
      }
      catch (error)
      {
        complete = false
        incompleteReason = errorMessage(error)
        this.observationIssues.push(
          error instanceof RunnerIssueError
            ? error.issue
            : createRunIssue({
                code: RUN_ISSUE_CODES.observationCaptureFailed,
                kind: 'observation',
                responsibility: 'infrastructure',
                message: incompleteReason,
              })
        )
      }
    }
    const manifest: MediaManifestV1 = {
      schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
      observationPlanSha256: hashObservationPlan(this.observationPlan),
      runtime,
      frames: structuredClone(this.frames),
      derivedVideo,
      totalFrameBytes: this.totalFrameBytes,
      complete,
      incompleteReason,
    }
    const verificationIssues = verifyMediaManifest(
      manifest,
      this.mediaRoot,
      this.observationPlan
    )
    for (const issue of verificationIssues)
    {
      manifest.complete = false
      manifest.incompleteReason ??= issue.message
      this.observationIssues.push(
        createRunIssue({
          code: RUN_ISSUE_CODES.observationIdentityMismatch,
          kind: 'observation',
          responsibility: 'infrastructure',
          message: `${issue.path}: ${issue.message}`,
        })
      )
    }
    if (!manifest.complete && missingTicks.length > 0)
      this.observationIssues.push(
        createRunIssue({
          code: RUN_ISSUE_CODES.observationIncomplete,
          kind: 'observation',
          responsibility: 'infrastructure',
          message: manifest.incompleteReason!,
        })
      )
    return manifest
  }
}

async function runBrowserScenarioScoped(
  runtimeKind: RenderedBrowserRuntime,
  sb3: Uint8Array,
  scenario: Scenario,
  options: BrowserScenarioOptions
): Promise<BrowserTrace>
{
  // when an identity-bound timeline is supplied it replaces the raw one entirely;
  // `scenario` then only carries determinism inputs the page still needs
  const identityBound = options.identityBoundScenario ?? null
  const requestedPlan = options.observationPlan ?? defaultObservationPlan()
  const planValidation = validateObservationPlan(requestedPlan)
  const observationPlan = planValidation.ok
    ? planValidation.value
    : defaultObservationPlan()
  let runtimeDescriptor = renderedRuntimeDescriptorBeforeLaunch(
    runtimeKind,
    options
  )
  const observations = identityBound
    ? createIdentityBoundObservationTrace(sb3, identityBound, observationPlan)
    : createObservationTrace(sb3, scenario, observationPlan)
  const mediaRoot = observationPlan.temporal
    ? options.mediaDir
      ? resolve(options.mediaDir)
      : null
    : null
  const issues: RunIssue[] = []
  const blockedUrls: string[] = []
  const console = new BrowserConsoleCollector()
  let consoleFailureStage: BrowserRunStage | undefined
  let host: RenderedPageHost | undefined
  let engine: BrowserEngine | undefined
  let diagnosticVideo: DiagnosticVideoRef | null = null
  let stage: BrowserRunStage = 'launch'
  let lineage: RuntimeLineageAdapterResultV1 | null = null
  let identityBoundDrive: IdentityBoundDriveResultV1 | null = null
  let runtimeIdentityFacet: RuntimeIdentityFacetV1 | null = null

  try
  {
    if (identityBound) validateIdentityBoundScenario(identityBound)
    else validateScenario(scenario)
    if (!planValidation.ok)
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.observationPlanInvalid,
          kind: 'observation',
          responsibility: 'repair-case',
          message: planValidation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; '),
        })
      )
    if (observationPlan.temporal && !mediaRoot)
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.observationPlanInvalid,
          kind: 'observation',
          responsibility: 'repair-case',
          message: 'a temporal observation plan requires options.mediaDir',
        })
      )
    host = await openRenderedPageHost({
      runtimeKind,
      sb3,
      lineageManifest: options.lineageManifest,
      headless: true,
      allowNetwork: options.allowNetwork,
      allowedOrigins: options.allowedOrigins,
      onBrowserLaunched(descriptor): void
      {
        // record version only; stage stays launch until the host is fully ready
        runtimeDescriptor = descriptor
      },
      // only uncaught page errors fail the run; console output is retained
      onPageError(error): void
      {
        issues.push(browserPageIssue(error, stage))
      },
      onConsole(type, text): void
      {
        const classified = console.add(type, text)
        if (classified.disposition === 'failure' && !consoleFailureStage)
          consoleFailureStage = stage
      },
      onNetworkDenied(url): void
      {
        addBlockedNetworkError(issues, blockedUrls, url)
      },
      onCleanupError(error): void
      {
        issues.push(
          toRunIssue(error, {
            code: RUN_ISSUE_CODES.browserCleanupFailed,
            kind: 'internal',
            responsibility: 'infrastructure',
          })
        )
      },
    })
    const page = host.page

    mkdirSync(options.screenshotDir, { recursive: true })
    stage = 'project-load'
    await page.evaluate(
      (input) => window.__spike!.load(input.project, input.manifest),
      {
        project: host.projectPath,
        manifest: host.lineageManifestPath,
      }
    )
    if (options.lineageManifest)
    {
      lineage = await page.evaluate(() => window.__spike!.lineage())
      runtimeIdentityFacet = await page.evaluate(() =>
        window.__spike!.runtimeIdentityFacet()
      )
    }
    stage = 'setup'
    await page.evaluate((o) => window.__spike!.prep(o), {
      seed: scenario.seed ?? 0,
      fixedDateMs: scenario.fixedDateMs,
    })

    const canvas = page.locator('#app canvas').first()
    engine = new BrowserEngine(
      page,
      canvas,
      options.screenshotDir,
      identityBound
        ? identityBound.maxTicks
        : (scenario.maxTicks ?? DEFAULT_MAX_TICKS),
      observationPlan,
      mediaRoot,
      options.runtimeObservation
    )
    await engine.startObservations()
    stage = 'runtime'
    if (identityBound)
      identityBoundDrive = await driveIdentityBoundScenario(
        engine,
        identityBound
      )
    else await driveScenario(engine, scenario)
    await engine.finish()
  }
  catch (error)
  {
    const issue = browserFailureIssue(error, stage, blockedUrls.length > 0)
    const duplicatesPageError =
      issue.code === RUN_ISSUE_CODES.browserRuntimeFailed &&
      issues.some(
        (existing) => existing.code === RUN_ISSUE_CODES.browserPageError
      )
    if (!duplicatesPageError) issues.push(issue)
  }
  finally
  {
    if (engine && host)
    {
      observations.cloneCounts = structuredClone(engine.cloneCounts)
      try
      {
        observations.media = await engine.finalizeObservations(
          host.browser,
          runtimeDescriptor
        )
      }
      catch (error)
      {
        issues.push(
          toRunIssue(error, {
            code: RUN_ISSUE_CODES.observationCaptureFailed,
            kind: 'observation',
            responsibility: 'infrastructure',
          })
        )
      }
      issues.push(...engine.observationIssues)
    }
    // failure-only diagnostics: replicate the post-teardown issue pushes exactly, then derive
    const consoleHasFailure = console
      .summary()
      .categories.some((category) => category.disposition === 'failure')
    const loweringIncomplete =
      identityBoundDrive !== null && identityBoundDrive.status !== 'complete'
    if (
      host &&
      engine &&
      (issues.length > 0 || consoleHasFailure || loweringIncomplete)
    )
    {
      try
      {
        diagnosticVideo = await createDiagnosticVideo(
          host.browser,
          mediaRoot ?? options.screenshotDir,
          engine.screenshots,
          engine.frames,
          mediaRoot
        )
      }
      catch
      {
        // a failed derivation only loses a debug artifact; the lane result is already set
      }
    }
    if (host) await host.close()
  }

  if (blockedUrls.length > 0)
  {
    for (let i = 0; i < issues.length; i++)
    {
      const issue = issues[i]
      if (!issue || issue.kind !== 'runtime') continue
      issues[i] = createRunIssue({
        code: RUN_ISSUE_CODES.networkExecutionFailed,
        kind: 'network-policy',
        responsibility: 'unsupported',
        message: issue.message,
      })
    }
  }

  const consoleSummary = console.summary()
  const consoleFailure = consoleSummary.categories.find(
    (category) => category.disposition === 'failure'
  )
  if (consoleFailure)
  {
    const loadFailure = consoleFailureStage === 'project-load'
    issues.push(
      createRunIssue({
        code: RUN_ISSUE_CODES.browserConsoleError,
        kind: loadFailure ? 'project-load' : 'runtime',
        responsibility: loadFailure ? 'unsupported' : 'project',
        message:
          consoleFailure.samples[0] ??
          `${consoleFailure.count} browser console errors`,
        ...(loadFailure ? {} : { location: { kind: 'project' as const } }),
      })
    )
  }

  // a lowering that could not resolve every action is a lane failure, not a pass
  if (identityBoundDrive && identityBoundDrive.status !== 'complete')
    issues.push(
      createRunIssue({
        code: RUN_ISSUE_CODES.identityBoundActionInconclusive,
        kind: 'scenario',
        responsibility: 'repair-case',
        message: identityBoundDrive.inconclusive
          ? `step ${identityBoundDrive.inconclusive.stepIndex} (${identityBoundDrive.inconclusive.do}) ${identityBoundDrive.inconclusive.reason}: ${identityBoundDrive.inconclusive.detail}`
          : 'the identity-bound scenario could not be fully lowered',
      })
    )

  // page errors captured during teardown stay authoritative in the final issue list
  return {
    ok: issues.length === 0,
    runtime: renderedRuntimeId(runtimeKind),
    runtimeDescriptor,
    observations,
    mediaRoot,
    snapshots: engine ? engine.snapshots : [],
    finalSnapshot: engine?.finalSnapshot ?? null,
    screenshots: engine ? engine.screenshots : [],
    diagnosticVideo,
    errors: runIssueMessages(issues),
    issues,
    consoleLog: console.entries,
    consoleSummary,
    lineage,
    identityBoundDrive,
    runtimeObservations: engine
      ? Object.freeze([...engine.runtimeObservations])
      : Object.freeze([]),
    runtimeIdentityFacet,
  }
}

async function runRenderedBrowserScenario(
  kind: RenderedBrowserRuntime,
  sb3: Uint8Array,
  scenario: Scenario,
  options: BrowserScenarioOptions
): Promise<BrowserTrace>
{
  try
  {
    return await withRunnerExecution(() =>
      runBrowserScenarioScoped(kind, sb3, scenario, options)
    )
  }
  catch (error)
  {
    const issue = toRunIssue(error, {
      code: RUN_ISSUE_CODES.internalFailed,
      kind: 'internal',
      responsibility: 'infrastructure',
    })
    const issues = [issue]
    const requestedPlan = options.observationPlan ?? defaultObservationPlan()
    const planValidation = validateObservationPlan(requestedPlan)
    const observationPlan = planValidation.ok
      ? planValidation.value
      : defaultObservationPlan()
    return {
      ok: false,
      runtime: renderedRuntimeId(kind),
      runtimeDescriptor: fallbackRenderedRuntimeDescriptor(kind, options),
      observations: createObservationTrace(sb3, scenario, observationPlan),
      mediaRoot:
        observationPlan.temporal && options.mediaDir
          ? resolve(options.mediaDir)
          : null,
      snapshots: [],
      finalSnapshot: null,
      screenshots: [],
      diagnosticVideo: null,
      errors: runIssueMessages(issues),
      issues,
      consoleLog: [],
      consoleSummary: emptyBrowserConsoleSummary(),
      lineage: options.lineageManifest
        ? unavailableRuntimeLineageAdapterResultV1(
            kind === 'turbowarp'
              ? TURBOWARP_LINEAGE_IDENTITY
              : OFFICIAL_BROWSER_LINEAGE_IDENTITY,
            options.lineageManifest.manifestSha256,
            `the browser lane failed before the seam could be verified: ${issue.code}`
          )
        : null,
    }
  }
}

// run the default TurboWarp browser scenario under the shared execution lock
// drive one lowered identity-bound timeline in a rendered browser lane; every
// action comes from the carrier, never from a name
export async function runIdentityBoundBrowserScenario(
  kind: RenderedBrowserRuntime,
  sb3: Uint8Array,
  scenario: IdentityBoundScenarioV1,
  manifest: RuntimeLineageManifestV1,
  options: BrowserScenarioOptions
): Promise<BrowserTrace>
{
  return runRenderedBrowserScenario(
    kind,
    sb3,
    { seed: scenario.seed, fixedDateMs: scenario.fixedDateMs, steps: [] },
    { ...options, lineageManifest: manifest, identityBoundScenario: scenario }
  )
}

export async function runBrowserScenario(
  sb3: Uint8Array,
  scenario: Scenario,
  options: BrowserScenarioOptions
): Promise<BrowserTrace>
{
  return runRenderedBrowserScenario('turbowarp', sb3, scenario, options)
}

// run the selective official Scratch rendered lane under the same host contract
export async function runOfficialBrowserScenario(
  sb3: Uint8Array,
  scenario: Scenario,
  options: BrowserScenarioOptions
): Promise<BrowserTrace>
{
  if (options.allowNetwork || (options.allowedOrigins?.length ?? 0) > 0)
    throw new Error('the official Scratch browser lane is network-denied')
  return runRenderedBrowserScenario('scratch-official', sb3, scenario, options)
}

// legacy compatibility: RunScenario -> a single stage screenshot + StateSnapshot[]
export async function runBrowser(
  sb3: Uint8Array,
  scenario: RunScenario,
  options: BrowserLaneOptions
): Promise<BrowserLaneResult>
{
  const screenshotDir = dirname(options.screenshotPath)
  const trace = await runBrowserScenario(
    sb3,
    {
      ...(scenario.allowNetwork === undefined
        ? {}
        : { allowNetwork: scenario.allowNetwork }),
      ...(scenario.allowedOrigins === undefined
        ? {}
        : { allowedOrigins: scenario.allowedOrigins }),
      steps: snapshotSteps(scenario),
    },
    {
      screenshotDir,
      allowNetwork: scenario.allowNetwork,
      allowedOrigins: scenario.allowedOrigins,
    }
  )
  const screenshots: string[] = []
  const last = trace.screenshots[trace.screenshots.length - 1]
  if (last)
  {
    copyFileSync(last.path, options.screenshotPath)
    screenshots.push(options.screenshotPath)
  }
  const issues = trace.issues
  return {
    ok: issues.length === 0,
    runtime: trace.runtime,
    snapshots: trace.snapshots.map(toStateSnapshot),
    errors: runIssueMessages(issues),
    issues,
    screenshots,
    consoleLog: trace.consoleLog,
  }
}
