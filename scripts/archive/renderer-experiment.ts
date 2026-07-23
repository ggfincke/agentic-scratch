// scripts/archive/renderer-experiment.ts
// archived headless-gl compatibility experiment, Playwright baseline, & promotion decision

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { release, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluate,
  hashMultimodalJson,
  type Assertion,
} from '@scratch-agent/eval'
import { buildCollector, buildMovement } from '@scratch-agent/ir'
import {
  collectVersions,
  hashObservationPlan,
  hashScenario,
  mdCode,
  newRunId,
  runBrowserScenario,
  runOfficialBrowserScenario,
  sha256,
  type BrowserTrace,
  type ObservationPlanV1,
  type RuntimeDescriptorV1,
  type Scenario,
} from '@scratch-agent/runner'

import {
  multimodalSourceRevision,
  multimodalSourceSnapshot,
  retainSourceSnapshot,
  sourceSnapshotIsAuthoritative,
  sourceSnapshotsMatch,
  type SourceManifestIdentityV1,
  type SourceSnapshotV1,
} from '@scratch-agent/eval'

type MeasurementStatus = 'passed' | 'failed' | 'not-measured'
type LaneName = 'official-playwright' | 'turbowarp-playwright'

interface StatusResult
{
  status: MeasurementStatus
  reasonCode: string | null
  detail: string | null
  blockedBy: string | null
}

interface LogIdentity
{
  path: string
  sha256: string
  byteLength: number
}

interface ProcessEvidence
{
  command: string[]
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  durationMs: number
  processGroupPeakRssBytes: number | null
  descendantTreePeakRssBytes: number | null
  aggregatePeakRssBytes: number | null
  stdout: LogIdentity
  stderr: LogIdentity
  stdoutTail: string
  stderrTail: string
  spawnError: string | null
}

interface NativeModuleIdentity
{
  path: string
  sha256: string
  byteLength: number
}

interface RawContextResult extends StatusResult
{
  width: 480
  height: 360
  requestedAttributes: {
    alpha: false
    stencil: true
    antialias: false
    preserveDrawingBuffer: true
  }
  observedAttributes: Record<string, boolean> | null
  vendor: string | null
  renderer: string | null
  version: string | null
  stencilBits: number | null
  extensions: string[]
  readback: number[] | null
  readbackSha256: string | null
  glError: number | null
}

interface RendererDiagnostic
{
  publicNodeImport: StatusResult
  rendererConstruction: StatusResult
  twoDimensionalSurface: StatusResult
  officialVmAttachment: StatusResult
  projectLoad: StatusResult
  deterministicScenario: StatusResult
  frameAndGeometryEvidence: StatusResult
  networkDenial: StatusResult
  structuredEvidence: StatusResult
  shimmedNodeDiagnostic: {
    eligibleForPromotion: false
    construction: StatusResult
    bitmapDrawAndHitTest: StatusResult
    glSemantics: StatusResult
    observations: {
      supported: boolean | null
      nativeSize: number[] | null
      centerPixel: number[] | null
      cornerPixel: number[] | null
      touchingCenter: boolean | null
      touchingOutside: boolean | null
      glErrors: Array<{
        phase: string
        method: string
        args: Array<string | number>
        errors: number[]
      }>
    }
  }
}

interface GlProbeResult
{
  schemaVersion: 1
  packageVersion: string
  nativeLoad: StatusResult
  rawContext: RawContextResult
  renderer: RendererDiagnostic | null
}

type ShimmedNodeDiagnostic = RendererDiagnostic['shimmedNodeDiagnostic']

interface InstallEvidence
{
  role: 'control' | 'candidate'
  package: 'gl'
  version: string
  environment: {
    node: string
    npm: string
    platform: NodeJS.Platform
    arch: string
    ci: boolean
    ciProvider: string | null
    commit: string
  }
  packageLock: LogIdentity | null
  lockGeneration: ProcessEvidence
  install: StatusResult & {
    process: ProcessEvidence | null
    stderrTail: string[]
  }
  installedVersion: string | null
  nativeModules: NativeModuleIdentity[]
  nativeLoad: StatusResult
  rawContext: RawContextResult
  probeProcesses: ProcessEvidence[]
  renderer: RendererDiagnostic | null
}

interface AssertionEvidence
{
  id: string
  passed: boolean | null
  expected: string | null
  observed: string | null
}

interface CaseLaneResult
{
  status: MeasurementStatus
  runtimeDescriptor: RuntimeDescriptorV1 | null
  runtimeDescriptorSha256: string | null
  traceSha256: string | null
  assertionResults: AssertionEvidence[]
  frameSha256s: string[]
  issues: BrowserTrace['issues']
  reasonCode: string | null
  blockedBy: string | null
}

interface ExperimentCase
{
  id: 'movement-layout-v1' | 'collector-collision-v1'
  name: string
  scenario: Scenario
  observationPlan: ObservationPlanV1
  assertions: Assertion[]
  requiredCapabilities: string[]
  build(): Promise<Uint8Array>
}

interface PreparedCase extends ExperimentCase
{
  artifact: {
    path: string
    sha256: string
    byteLength: number
  }
  bytes: Uint8Array
}

interface CorpusCaseResult
{
  id: ExperimentCase['id']
  name: string
  artifact: PreparedCase['artifact']
  scenarioSha256: string
  observationPlanSha256: string
  requiredCapabilities: string[]
  officialPlaywright: CaseLaneResult
  turboWarpPlaywright: CaseLaneResult
  headlessGl: CaseLaneResult
  comparison: StatusResult & {
    requiredAssertionsAgreed: boolean | null
    collisionStateAgreed: boolean | null
    normalizedVisualAgreed: boolean | null
  }
}

interface BenchmarkBatchResult
{
  schemaVersion: 1
  batch: number
  warmupCorpusCycles: number
  measuredCorpusCycles: number
  visualRunsPerCorpusCycle: number
  warmupOk: boolean
  measuredOk: boolean
  durationNs: string[]
  errors: string[]
  workerPeakRssBytes: number
}

interface BatchEvidence
{
  batch: number
  plannedLaneOrder: Array<'playwright' | 'headless-gl'>
  executedLaneOrder: Array<'playwright' | 'headless-gl'>
  process: ProcessEvidence
  result: BenchmarkBatchResult | null
}

interface Distribution
{
  sampleCount: number
  durationNs: string[]
  medianDurationNs: string
  p95DurationNs: string
  medianVisualRunsPerSecond: number
  p95SlowTailVisualRunsPerSecond: number
  processGroupPeakRssBytes: number
  descendantTreePeakRssBytes: number
  aggregatePeakRssBytes: number
  workerPeakRssBytes: number
}

interface Gate
{
  id: string
  required: true
  threshold: string
  observed: string | null
  result: StatusResult
}

interface CapabilityRow
{
  id: string
  baselineSupported: boolean
  exercisedByCases: ExperimentCase['id'][]
  covered: boolean
  headlessSupported: boolean | null
  result: StatusResult
}

interface DependencyAudit
{
  normalDependencyAdded: boolean
  manifestPaths: string[]
  lockContainsGlPackage: boolean
}

interface MultimodalHeadlessGlReportV2
{
  schemaVersion: 2
  reportKind: 'multimodal-renderer-experiment'
  runId: string
  createdAt: string
  completedAt: string
  durationMs: number
  source: {
    revision: string
    commit: string | null
    state: SourceSnapshotV1['state']
    dirty: boolean | null
    startManifest: SourceManifestIdentityV1
    completionManifest: SourceManifestIdentityV1
    stableAtCompletion: boolean
    packageJsonSha256: string
    packageLockSha256: string
    scriptSha256: string
    rendererNodeEntry: LogIdentity
    rendererWebEntry: LogIdentity
  }
  environment: {
    node: string
    npm: string
    platform: NodeJS.Platform
    release: string
    arch: string
    ci: boolean
    ciProvider: string | null
    versions: ReturnType<typeof collectVersions>
  }
  claimScope: 'bounded compatibility and throughput evidence for the recorded corpus only'
  configuration: {
    candidate: 'gl@9.0.0-rc.10'
    control: 'gl@8.1.6'
    stage: { width: 480; height: 360 }
    rssSampleIntervalMs: 10
    rssMethod: string
    batches: 4
    warmupCorpusCyclesPerBatch: 2
    measuredCorpusCyclesPerBatch: 8
    totalMeasuredCorpusCycles: 32
    visualRunsPerCorpusCycle: 2
    plannedLaneOrderByBatch: Array<Array<'playwright' | 'headless-gl'>>
    thresholds: {
      requiredAssertionAgreement: 1
      collisionStateAgreement: 1
      supportedCapabilityCoverage: 1
      medianThroughputRatio: 2
      p95ThroughputRatio: 1.5
      peakRssRatio: 1.25
      macosInstall: 1
      linuxCiInstall: 1
      isolationEvidenceParity: 1
    }
  }
  dependencyAudit: DependencyAudit
  installation: {
    hostControl: InstallEvidence
    hostCandidate: InstallEvidence
    linuxCiCandidate: null
    linuxContainerDiagnostic: null
  }
  preflight: Array<{ id: string; result: StatusResult }>
  corpus: {
    cases: CorpusCaseResult[]
    capabilityMatrix: CapabilityRow[]
  }
  performance: {
    batches: BatchEvidence[]
    playwright: Distribution | null
    headlessGl: null
    medianThroughputRatio: null
    p95ThroughputRatio: null
    peakRssRatio: null
  }
  gates: Gate[]
  limitations: string[]
  decision: {
    experimentStatus: 'complete' | 'invalid'
    recommendation: 'promote' | 'reject'
    playwrightRemainsProduction: boolean
    normalDependencyAdded: boolean
    reasons: string[]
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scriptPath = fileURLToPath(import.meta.url)
const requirePkg = createRequire(import.meta.url)
const GL_CONTROL_VERSION = '8.1.6'
const GL_CANDIDATE_VERSION = '9.0.0-rc.10'
const RSS_SAMPLE_INTERVAL_MS = 10
const BENCHMARK_BATCHES = 4
const WARMUP_CYCLES = 2
const MEASURED_CYCLES = 8
const VISUAL_RUNS_PER_CYCLE = 2
const PROCESS_TIMEOUT_MS = 8 * 60 * 1000
const TAIL_BYTES = 64 * 1024
const LANE_ORDER: Array<Array<'playwright' | 'headless-gl'>> = [
  ['playwright', 'headless-gl'],
  ['headless-gl', 'playwright'],
  ['headless-gl', 'playwright'],
  ['playwright', 'headless-gl'],
]

const blockedStatus = (blockedBy: string, detail: string): StatusResult => ({
  status: 'not-measured',
  reasonCode: 'prerequisite-not-satisfied',
  detail,
  blockedBy,
})

const failedStatus = (reasonCode: string, detail: string): StatusResult => ({
  status: 'failed',
  reasonCode,
  detail,
  blockedBy: null,
})

const passedStatus = (detail: string): StatusResult => ({
  status: 'passed',
  reasonCode: null,
  detail,
  blockedBy: null,
})

const movementScenario: Scenario = {
  seed: 71,
  fixedDateMs: 1_700_000_000_000,
  steps: [
    { do: 'greenFlag' },
    { do: 'wait', ticks: 1 },
    { do: 'snapshot', label: 'start' },
    ...Array.from({ length: 8 }, () => ({
      do: 'tapKey' as const,
      key: 'right',
    })),
    { do: 'snapshot', label: 'moved' },
  ],
}

const movementObservationPlan: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: {
    firstTick: 1,
    lastTick: 9,
    everyTicks: 8,
    playbackFps: 10,
    maxFrames: 2,
    maxBytes: 4 * 1024 * 1024,
    derivedVideo: false,
  },
  cloneCounts: 'sampled',
}

const collectorScenario: Scenario = {
  seed: 73,
  fixedDateMs: 1_700_000_000_000,
  steps: [
    { do: 'greenFlag' },
    { do: 'wait', ticks: 2 },
    { do: 'snapshot', label: 'start' },
    { do: 'wait', ticks: 33 },
    { do: 'snapshot', label: 'caught' },
  ],
}

const collectorObservationPlan: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: {
    firstTick: 2,
    lastTick: 35,
    everyTicks: 33,
    playbackFps: 10,
    maxFrames: 2,
    maxBytes: 4 * 1024 * 1024,
    derivedVideo: false,
  },
  cloneCounts: 'sampled',
}

const experimentCases: ExperimentCase[] = [
  {
    id: 'movement-layout-v1',
    name: 'movement layout and frame change',
    scenario: movementScenario,
    observationPlan: movementObservationPlan,
    assertions: [
      {
        at: 'start',
        probe: { on: 'prop', sprite: 'Mover', prop: 'x' },
        match: { kind: 'equals', value: 0 },
      },
      {
        at: 'moved',
        probe: { on: 'prop', sprite: 'Mover', prop: 'x' },
        match: { kind: 'equals', value: 80 },
      },
      {
        at: 'start',
        probe: { on: 'spriteRect', sprite: 'Mover', field: 'cx' },
        match: { kind: 'closeTo', value: 240, eps: 20 },
      },
      {
        at: 'start',
        probe: { on: 'notBlank' },
        match: { kind: 'equals', value: true },
      },
      {
        at: 'moved',
        probe: {
          on: 'spriteInRegion',
          sprite: 'Mover',
          region: { x: 280, y: 0, width: 200, height: 360 },
        },
        match: { kind: 'equals', value: true },
      },
      {
        at: 'moved',
        probe: { on: 'regionChanged', from: 'start' },
        match: { kind: 'gt', value: 0 },
      },
    ],
    requiredCapabilities: [
      'manual-stepping',
      'keyboard-input',
      'svg-costume',
      'stage-rgb-readback',
      'sprite-geometry',
      'frame-change',
    ],
    async build(): Promise<Uint8Array>
    {
      return buildMovement().toSb3()
    },
  },
  {
    id: 'collector-collision-v1',
    name: 'collector renderer-backed collision',
    scenario: collectorScenario,
    observationPlan: collectorObservationPlan,
    assertions: [
      {
        at: 'caught',
        probe: { on: 'var', name: 'score', sprite: 'Item' },
        match: { kind: 'equals', value: 1 },
      },
      {
        at: 'start',
        probe: {
          on: 'spriteInRegion',
          sprite: 'Item',
          region: { x: 180, y: 0, width: 120, height: 120 },
        },
        match: { kind: 'equals', value: true },
      },
      {
        at: 'start',
        probe: {
          on: 'spriteInRegion',
          sprite: 'Player',
          region: { x: 180, y: 280, width: 120, height: 80 },
        },
        match: { kind: 'equals', value: true },
      },
      {
        at: 'start',
        probe: { on: 'notBlank' },
        match: { kind: 'equals', value: true },
      },
      {
        at: 'caught',
        probe: {
          on: 'regionChanged',
          from: 'start',
          region: { x: 200, y: 0, width: 80, height: 360 },
        },
        match: { kind: 'gt', value: 0 },
      },
    ],
    requiredCapabilities: [
      'manual-stepping',
      'svg-costume',
      'touching-object',
      'collision-driven-state',
      'stage-rgb-readback',
      'sprite-geometry',
      'frame-change',
    ],
    async build(): Promise<Uint8Array>
    {
      return buildCollector().toSb3()
    },
  },
]

function portable(base: string, path: string): string
{
  return relative(base, path).split(sep).join('/')
}

function hashFile(path: string): string
{
  return sha256(readFileSync(path))
}

function fileIdentity(path: string, base: string): LogIdentity
{
  const bytes = readFileSync(path)
  return {
    path: portable(base, path),
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
  }
}

function commandOutput(command: string, args: string[]): string
{
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: pinnedNodeEnvironment(),
  })
  if (result.status !== 0)
    throw new Error(
      `${[command, ...args].join(' ')} failed: ${result.stderr || result.stdout}`
    )
  return result.stdout.trim()
}

function pinnedNodeEnvironment(): NodeJS.ProcessEnv
{
  const nodeBin = dirname(process.execPath)
  const currentPath = process.env.PATH ?? ''
  return {
    ...process.env,
    PATH: `${nodeBin}:${currentPath}`,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  }
}

function ciProvider(): string | null
{
  if (!process.env.CI) return null
  if (process.env.GITHUB_ACTIONS) return 'github-actions'
  if (process.env.GITLAB_CI) return 'gitlab-ci'
  if (process.env.BUILDKITE) return 'buildkite'
  return 'unknown'
}

function appendTail(previous: string, chunk: Buffer): string
{
  const next = previous + chunk.toString('utf8')
  if (Buffer.byteLength(next, 'utf8') <= TAIL_BYTES) return next
  const bytes = Buffer.from(next, 'utf8')
  return bytes.subarray(bytes.byteLength - TAIL_BYTES).toString('utf8')
}

interface ProcessMemorySample
{
  processGroupBytes: number | null
  descendantTreeBytes: number | null
  aggregateBytes: number | null
}

function processMemorySample(rootPid: number): ProcessMemorySample
{
  const empty = {
    processGroupBytes: null,
    descendantTreeBytes: null,
    aggregateBytes: null,
  }
  if (process.platform === 'win32') return empty
  try
  {
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,rss='], {
      encoding: 'utf8',
    })
    if (result.status !== 0) return empty
    const rows: Array<{
      pid: number
      parentPid: number
      processGroup: number
      rssKibibytes: number
    }> = []
    for (const line of result.stdout.split('\n'))
    {
      const [pidText, parentText, groupText, rssText] = line.trim().split(/\s+/)
      const pid = Number(pidText)
      const parentPid = Number(parentText)
      const processGroup = Number(groupText)
      const rss = Number(rssText)
      if (
        Number.isSafeInteger(pid) &&
        Number.isSafeInteger(parentPid) &&
        Number.isSafeInteger(processGroup) &&
        Number.isFinite(rss)
      )
        rows.push({
          pid,
          parentPid,
          processGroup,
          rssKibibytes: rss,
        })
    }
    const descendants = new Set([rootPid])
    let changed = true
    while (changed)
    {
      changed = false
      for (const row of rows)
      {
        if (descendants.has(row.pid) || !descendants.has(row.parentPid))
          continue
        descendants.add(row.pid)
        changed = true
      }
    }
    const groupIds = new Set(
      rows.filter((row) => row.processGroup === rootPid).map((row) => row.pid)
    )
    const aggregateIds = new Set([...groupIds, ...descendants])
    const total = (ids: Set<number>): number | null =>
    {
      const kibibytes = rows
        .filter((row) => ids.has(row.pid))
        .reduce((sum, row) => sum + row.rssKibibytes, 0)
      return kibibytes > 0 ? kibibytes * 1024 : null
    }
    return {
      processGroupBytes: total(groupIds),
      descendantTreeBytes: total(descendants),
      aggregateBytes: total(aggregateIds),
    }
  }
  catch
  {
    return empty
  }
}

async function finishStream(stream: ReturnType<typeof createWriteStream>)
{
  await new Promise<void>((resolvePromise, reject) =>
  {
    stream.once('finish', resolvePromise)
    stream.once('error', reject)
    stream.end()
  })
}

async function runLoggedProcess(options: {
  command: string
  args: string[]
  cwd: string
  runRoot: string
  stdoutPath: string
  stderrPath: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}): Promise<ProcessEvidence>
{
  mkdirSync(dirname(options.stdoutPath), { recursive: true })
  mkdirSync(dirname(options.stderrPath), { recursive: true })
  const stdoutStream = createWriteStream(options.stdoutPath, { flags: 'wx' })
  const stderrStream = createWriteStream(options.stderrPath, { flags: 'wx' })
  const stdoutHash = createHash('sha256')
  const stderrHash = createHash('sha256')
  let stdoutBytes = 0
  let stderrBytes = 0
  let stdoutTail = ''
  let stderrTail = ''
  let spawnError: string | null = null
  let timedOut = false
  let processGroupPeakRssBytes: number | null = null
  let descendantTreePeakRssBytes: number | null = null
  let aggregatePeakRssBytes: number | null = null
  const started = process.hrtime.bigint()
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env ?? pinnedNodeEnvironment(),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (value: Buffer) =>
  {
    stdoutBytes += value.byteLength
    stdoutHash.update(value)
    stdoutStream.write(value)
    stdoutTail = appendTail(stdoutTail, value)
  })
  child.stderr.on('data', (value: Buffer) =>
  {
    stderrBytes += value.byteLength
    stderrHash.update(value)
    stderrStream.write(value)
    stderrTail = appendTail(stderrTail, value)
  })
  child.once('error', (error) =>
  {
    spawnError = error.message
  })

  const sampleRss = (): void =>
  {
    if (!child.pid) return
    const sample = processMemorySample(child.pid)
    if (
      sample.processGroupBytes !== null &&
      (processGroupPeakRssBytes === null ||
        sample.processGroupBytes > processGroupPeakRssBytes)
    )
      processGroupPeakRssBytes = sample.processGroupBytes
    if (
      sample.descendantTreeBytes !== null &&
      (descendantTreePeakRssBytes === null ||
        sample.descendantTreeBytes > descendantTreePeakRssBytes)
    )
      descendantTreePeakRssBytes = sample.descendantTreeBytes
    if (
      sample.aggregateBytes !== null &&
      (aggregatePeakRssBytes === null ||
        sample.aggregateBytes > aggregatePeakRssBytes)
    )
      aggregatePeakRssBytes = sample.aggregateBytes
  }
  const rssTimer = setInterval(sampleRss, RSS_SAMPLE_INTERVAL_MS)
  sampleRss()

  const timeout = setTimeout(() =>
  {
    timedOut = true
    if (!child.pid) return
    try
    {
      if (process.platform === 'win32') child.kill('SIGTERM')
      else process.kill(-child.pid, 'SIGTERM')
    }
    catch
    {
      child.kill('SIGTERM')
    }
    setTimeout(() =>
    {
      if (child.exitCode !== null || !child.pid) return
      try
      {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      }
      catch
      {
        child.kill('SIGKILL')
      }
    }, 2000).unref()
  }, options.timeoutMs ?? PROCESS_TIMEOUT_MS)
  timeout.unref()

  const outcome = await new Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
  }>((resolvePromise) =>
  {
    child.once('close', (exitCode, signal) =>
      resolvePromise({ exitCode, signal })
    )
  })
  clearInterval(rssTimer)
  clearTimeout(timeout)
  sampleRss()
  await Promise.all([finishStream(stdoutStream), finishStream(stderrStream)])
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
  return {
    command: [options.command, ...options.args],
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut,
    durationMs,
    processGroupPeakRssBytes,
    descendantTreePeakRssBytes,
    aggregatePeakRssBytes,
    stdout: {
      path: portable(options.runRoot, options.stdoutPath),
      sha256: stdoutHash.digest('hex'),
      byteLength: stdoutBytes,
    },
    stderr: {
      path: portable(options.runRoot, options.stderrPath),
      sha256: stderrHash.digest('hex'),
      byteLength: stderrBytes,
    },
    stdoutTail,
    stderrTail,
    spawnError,
  }
}

function boundedErrorTail(value: string): string[]
{
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-40)
}

function emptyRawContext(blockedBy: string): RawContextResult
{
  return {
    ...blockedStatus(blockedBy, 'raw WebGL context was not attempted'),
    width: 480,
    height: 360,
    requestedAttributes: {
      alpha: false,
      stencil: true,
      antialias: false,
      preserveDrawingBuffer: true,
    },
    observedAttributes: null,
    vendor: null,
    renderer: null,
    version: null,
    stencilBits: null,
    extensions: [],
    readback: null,
    readbackSha256: null,
    glError: null,
  }
}

function walkNativeModules(
  directory: string,
  base: string
): NativeModuleIdentity[]
{
  if (!existsSync(directory)) return []
  const found: NativeModuleIdentity[] = []
  const visit = (current: string): void =>
  {
    for (const entry of readdirSync(current, { withFileTypes: true }))
    {
      const path = join(current, entry.name)
      if (entry.isDirectory())
      {
        visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.node')) continue
      const bytes = readFileSync(path)
      found.push({
        path: portable(base, path),
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      })
    }
  }
  visit(directory)
  return found.sort((left, right) => left.path.localeCompare(right.path))
}

function parseSentinel<T>(text: string, prefix: string): T | null
{
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index--)
  {
    const line = lines[index]
    if (!line?.startsWith(prefix)) continue
    try
    {
      return JSON.parse(line.slice(prefix.length)) as T
    }
    catch
    {
      return null
    }
  }
  return null
}

async function installGlCandidate(options: {
  role: InstallEvidence['role']
  version: string
  runRoot: string
  commit: string
}): Promise<{ evidence: InstallEvidence; sandbox: string }>
{
  const installRoot = join(options.runRoot, 'install')
  mkdirSync(installRoot, { recursive: true })
  const sandbox = mkdtempSync(
    join(tmpdir(), `multimodal-headless-gl-${options.role}-`)
  )
  const projectRoot = join(sandbox, 'project')
  const cacheRoot = join(sandbox, 'npm-cache')
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(cacheRoot, { recursive: true })
  writeFileSync(
    join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: `multimodal-headless-gl-${options.role}`,
        version: '0.0.0',
        private: true,
        dependencies: { gl: options.version },
        allowScripts: { gl: true },
      },
      null,
      2
    ) + '\n',
    { flag: 'wx' }
  )

  const stem = `${options.role}-gl-${options.version}`
  const lockProcess = await runLoggedProcess({
    command: 'npm',
    args: [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      cacheRoot,
    ],
    cwd: projectRoot,
    runRoot: options.runRoot,
    stdoutPath: join(installRoot, `${stem}-lock.stdout.log`),
    stderrPath: join(installRoot, `${stem}-lock.stderr.log`),
  })
  const generatedLock = join(projectRoot, 'package-lock.json')
  let packageLock: LogIdentity | null = null
  if (lockProcess.exitCode === 0 && existsSync(generatedLock))
  {
    const retainedLock = join(installRoot, `${stem}-package-lock.json`)
    writeFileSync(retainedLock, readFileSync(generatedLock), { flag: 'wx' })
    packageLock = fileIdentity(retainedLock, options.runRoot)
  }

  let installProcess: ProcessEvidence | null = null
  if (packageLock)
  {
    rmSync(join(projectRoot, 'node_modules'), {
      recursive: true,
      force: true,
    })
    installProcess = await runLoggedProcess({
      command: 'npm',
      args: [
        'ci',
        '--foreground-scripts',
        '--no-audit',
        '--no-fund',
        '--cache',
        cacheRoot,
      ],
      cwd: projectRoot,
      runRoot: options.runRoot,
      stdoutPath: join(installRoot, `${stem}-ci.stdout.log`),
      stderrPath: join(installRoot, `${stem}-ci.stderr.log`),
    })
  }

  const packageManifest = join(
    projectRoot,
    'node_modules',
    'gl',
    'package.json'
  )
  const installedVersion = existsSync(packageManifest)
    ? ((
        JSON.parse(readFileSync(packageManifest, 'utf8')) as {
          version?: string
        }
      ).version ?? null)
    : null
  const installPassed =
    packageLock !== null &&
    installProcess?.exitCode === 0 &&
    installProcess.spawnError === null &&
    !installProcess.timedOut &&
    installedVersion === options.version
  const install = installPassed
    ? passedStatus(`clean npm ci installed gl@${options.version}`)
    : failedStatus(
        packageLock ? 'npm-ci-failed' : 'package-lock-generation-failed',
        packageLock
          ? `npm ci did not install exact gl@${options.version}`
          : 'npm could not generate the exact isolated package lock'
      )
  const nativeModules = installPassed
    ? walkNativeModules(join(projectRoot, 'node_modules', 'gl'), projectRoot)
    : []
  const blockedBy = installPassed ? 'gl-probe' : 'gl-install'
  const evidence: InstallEvidence = {
    role: options.role,
    package: 'gl',
    version: options.version,
    environment: {
      node: process.version,
      npm: commandOutput('npm', ['--version']),
      platform: process.platform,
      arch: process.arch,
      ci: process.env.CI === 'true' || process.env.CI === '1',
      ciProvider: ciProvider(),
      commit: options.commit,
    },
    packageLock,
    lockGeneration: lockProcess,
    install: {
      ...install,
      process: installProcess,
      stderrTail: boundedErrorTail(
        installProcess?.stderrTail ?? lockProcess.stderrTail
      ),
    },
    installedVersion,
    nativeModules,
    nativeLoad: blockedStatus(blockedBy, 'native module was not loaded'),
    rawContext: emptyRawContext(blockedBy),
    probeProcesses: [],
    renderer: null,
  }
  return {
    evidence,
    sandbox,
  }
}

function packageRoot(name: string): string
{
  let current = dirname(requirePkg.resolve(name))
  for (let depth = 0; depth < 10; depth++)
  {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest))
    {
      const value = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string
      }
      if (value.name === name) return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`cannot resolve package root for ${name}`)
}

async function runInstalledProbe(options: {
  evidence: InstallEvidence
  sandbox: string
  runRoot: string
  includeRenderer: boolean
}): Promise<void>
{
  const installRoot = join(options.runRoot, 'install')
  const projectRoot = join(options.sandbox, 'project')
  const rendererRoot = packageRoot('@scratch/scratch-render')
  const args = [
    '--import',
    'tsx',
    scriptPath,
    '--gl-probe-worker',
    '--gl-root',
    join(projectRoot, 'node_modules', 'gl'),
    '--package-version',
    options.evidence.version,
    '--probe-mode',
    'core',
  ]
  if (options.includeRenderer)
  {
    args.push(
      '--renderer-node',
      join(rendererRoot, 'dist', 'node', 'scratch-render.js'),
      '--renderer-web',
      join(rendererRoot, 'dist', 'web', 'scratch-render.js'),
      '--jsdom-root',
      packageRoot('jsdom')
    )
  }
  const processEvidence = await runLoggedProcess({
    command: process.execPath,
    args,
    cwd: root,
    runRoot: options.runRoot,
    stdoutPath: join(
      installRoot,
      `${options.evidence.role}-gl-${options.evidence.version}-probe.stdout.log`
    ),
    stderrPath: join(
      installRoot,
      `${options.evidence.role}-gl-${options.evidence.version}-probe.stderr.log`
    ),
  })
  options.evidence.probeProcesses.push(processEvidence)
  const probe = parseSentinel<GlProbeResult>(
    processEvidence.stdoutTail,
    'MULTIMODAL_GL_PROBE='
  )
  if (!probe || processEvidence.exitCode !== 0)
  {
    options.evidence.nativeLoad = failedStatus(
      'probe-process-failed',
      'the isolated probe did not produce a valid result'
    )
    options.evidence.rawContext = emptyRawContext('native-load')
    return
  }
  options.evidence.nativeLoad = probe.nativeLoad
  options.evidence.rawContext = probe.rawContext
  options.evidence.renderer = probe.renderer

  if (!options.includeRenderer || !probe.renderer) return
  const renderer = probe.renderer
  const shimArgs = [...args]
  const modeIndex = shimArgs.indexOf('core')
  shimArgs[modeIndex] = 'shimmed-node'
  const shimProcess = await runLoggedProcess({
    command: process.execPath,
    args: shimArgs,
    cwd: root,
    runRoot: options.runRoot,
    stdoutPath: join(
      installRoot,
      `${options.evidence.role}-gl-${options.evidence.version}-shim.stdout.log`
    ),
    stderrPath: join(
      installRoot,
      `${options.evidence.role}-gl-${options.evidence.version}-shim.stderr.log`
    ),
  })
  options.evidence.probeProcesses.push(shimProcess)
  const shimmed = parseSentinel<ShimmedNodeDiagnostic>(
    shimProcess.stdoutTail,
    'MULTIMODAL_GL_SHIM='
  )
  if (shimmed && shimProcess.exitCode === 0)
    renderer.shimmedNodeDiagnostic = shimmed
  else
    renderer.shimmedNodeDiagnostic = {
      eligibleForPromotion: false,
      construction: failedStatus(
        'shim-diagnostic-process-failed',
        'the separate shim diagnostic did not produce a valid result'
      ),
      bitmapDrawAndHitTest: blockedStatus(
        'shimmed-renderer-construction',
        'bitmap rendering was not attempted'
      ),
      glSemantics: blockedStatus(
        'shimmed-renderer-construction',
        'GL semantics were not measured'
      ),
      observations: {
        supported: null,
        nativeSize: null,
        centerPixel: null,
        cornerPixel: null,
        touchingCenter: null,
        touchingOutside: null,
        glErrors: [],
      },
    }
}

async function prepareCases(runRoot: string): Promise<PreparedCase[]>
{
  const corpusRoot = join(runRoot, 'corpus')
  mkdirSync(corpusRoot, { recursive: true })
  const prepared: PreparedCase[] = []
  for (const definition of experimentCases)
  {
    const bytes = await definition.build()
    const path = join(corpusRoot, `${definition.id}.sb3`)
    writeFileSync(path, bytes, { flag: 'wx' })
    prepared.push({
      ...definition,
      bytes,
      artifact: {
        path: portable(runRoot, path),
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      },
    })
  }
  return prepared
}

function assertionEvidence(
  caseId: string,
  results: ReturnType<typeof evaluate>
): AssertionEvidence[]
{
  return results.map((result, index) => ({
    id: `${caseId}.assertion.${index + 1}`,
    passed: result.ok,
    expected: result.expected,
    observed: result.observed,
  }))
}

function traceIdentity(trace: BrowserTrace): string
{
  return hashMultimodalJson({
    runtimeDescriptor: trace.runtimeDescriptor,
    observations: trace.observations,
    snapshots: trace.snapshots,
    finalSnapshot: trace.finalSnapshot,
    issues: trace.issues,
  })
}

async function runCaseLane(
  definition: PreparedCase,
  lane: LaneName,
  outputRoot: string
): Promise<CaseLaneResult>
{
  const laneRoot = join(outputRoot, definition.id, lane)
  const options = {
    screenshotDir: join(laneRoot, 'screenshots'),
    mediaDir: join(laneRoot, 'media'),
    observationPlan: definition.observationPlan,
  }
  const trace =
    lane === 'official-playwright'
      ? await runOfficialBrowserScenario(
          definition.bytes,
          definition.scenario,
          options
        )
      : await runBrowserScenario(definition.bytes, definition.scenario, options)
  const results =
    trace.issues.length === 0 ? evaluate(trace, definition.assertions) : []
  const media = trace.observations.media
  const expectedTicks = definition.observationPlan.temporal
    ? [
        definition.observationPlan.temporal.firstTick,
        definition.observationPlan.temporal.lastTick,
      ]
    : []
  const observedTicks = media?.frames.map((frame) => frame.tick) ?? []
  const mediaOk =
    media?.complete === true &&
    JSON.stringify(observedTicks) === JSON.stringify(expectedTicks)
  const assertionsOk =
    results.length === definition.assertions.length &&
    results.every((result) => result.ok)
  const passed = trace.ok && mediaOk && assertionsOk
  return {
    status: passed ? 'passed' : 'failed',
    runtimeDescriptor: trace.runtimeDescriptor,
    runtimeDescriptorSha256: hashMultimodalJson(trace.runtimeDescriptor),
    traceSha256: traceIdentity(trace),
    assertionResults: assertionEvidence(definition.id, results),
    frameSha256s: media?.frames.map((frame) => frame.sha256) ?? [],
    issues: trace.issues,
    reasonCode: passed ? null : 'playwright-corpus-case-failed',
    blockedBy: null,
  }
}

function unmeasuredHeadlessCase(definition: PreparedCase): CaseLaneResult
{
  return {
    status: 'not-measured',
    runtimeDescriptor: null,
    runtimeDescriptorSha256: null,
    traceSha256: null,
    assertionResults: definition.assertions.map((_assertion, index) => ({
      id: `${definition.id}.assertion.${index + 1}`,
      passed: null,
      expected: null,
      observed: null,
    })),
    frameSha256s: [],
    issues: [],
    reasonCode: 'prerequisite-not-satisfied',
    blockedBy: 'scratch-render-node-integration',
  }
}

async function runCorrectnessBaseline(
  prepared: PreparedCase[],
  runRoot: string
): Promise<CorpusCaseResult[]>
{
  const outputRoot = join(runRoot, 'baseline', 'correctness')
  const results: CorpusCaseResult[] = []
  for (const definition of prepared)
  {
    const officialPlaywright = await runCaseLane(
      definition,
      'official-playwright',
      outputRoot
    )
    const turboWarpPlaywright = await runCaseLane(
      definition,
      'turbowarp-playwright',
      outputRoot
    )
    results.push({
      id: definition.id,
      name: definition.name,
      artifact: definition.artifact,
      scenarioSha256: hashScenario(definition.scenario),
      observationPlanSha256: hashObservationPlan(definition.observationPlan),
      requiredCapabilities: [...definition.requiredCapabilities],
      officialPlaywright,
      turboWarpPlaywright,
      headlessGl: unmeasuredHeadlessCase(definition),
      comparison: {
        ...blockedStatus(
          'scratch-render-node-integration',
          'headless-gl did not reach the corpus, so agreement was not measured'
        ),
        requiredAssertionsAgreed: null,
        collisionStateAgreed: null,
        normalizedVisualAgreed: null,
      },
    })
  }
  return results
}

function workerCases(runRoot: string): PreparedCase[]
{
  return experimentCases.map((definition) =>
  {
    const path = join(runRoot, 'corpus', `${definition.id}.sb3`)
    const bytes = readFileSync(path)
    return {
      ...definition,
      bytes,
      artifact: {
        path: portable(runRoot, path),
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      },
    }
  })
}

async function runBenchmarkCorpusCycle(
  definitions: PreparedCase[],
  outputRoot: string
): Promise<string[]>
{
  const errors: string[] = []
  for (const definition of definitions)
  {
    const trace = await runOfficialBrowserScenario(
      definition.bytes,
      definition.scenario,
      {
        screenshotDir: join(outputRoot, definition.id, 'screenshots'),
        mediaDir: join(outputRoot, definition.id, 'media'),
        observationPlan: definition.observationPlan,
      }
    )
    const results =
      trace.issues.length === 0 ? evaluate(trace, definition.assertions) : []
    if (!trace.ok)
      errors.push(
        `${definition.id}: ${trace.errors.join('; ') || 'browser trace failed'}`
      )
    if (results.length !== definition.assertions.length)
      errors.push(`${definition.id}: assertion evaluation was incomplete`)
    for (const result of results)
    {
      if (!result.ok)
        errors.push(
          `${definition.id}: ${result.location.hint} expected ${result.expected}, observed ${result.observed}`
        )
    }
    const frames = trace.observations.media?.frames ?? []
    if (
      trace.observations.media?.complete !== true ||
      frames.length !== definition.observationPlan.temporal?.maxFrames
    )
      errors.push(`${definition.id}: temporal evidence was incomplete`)
  }
  return errors
}

function workerPeakRssBytes(): number
{
  return process.resourceUsage().maxRSS * 1024
}

async function benchmarkWorker(args: Map<string, string>): Promise<void>
{
  const runRoot = args.get('--run-root')
  const batchText = args.get('--batch')
  if (!runRoot || !batchText)
    throw new Error('benchmark worker args are missing')
  const batch = Number(batchText)
  if (!Number.isSafeInteger(batch) || batch < 1)
    throw new Error('benchmark batch must be a positive integer')
  const definitions = workerCases(runRoot)
  const workRoot = join(runRoot, 'baseline', 'work', `batch-${batch}`)
  rmSync(workRoot, { recursive: true, force: true })
  mkdirSync(workRoot, { recursive: true })
  const errors: string[] = []
  let warmupOk = true
  for (let cycle = 0; cycle < WARMUP_CYCLES; cycle++)
  {
    const found = await runBenchmarkCorpusCycle(
      definitions,
      join(workRoot, `warmup-${cycle + 1}`)
    )
    if (found.length > 0) warmupOk = false
    errors.push(...found.map((error) => `warmup ${cycle + 1}: ${error}`))
  }

  const durationNs: string[] = []
  let measuredOk = true
  for (let cycle = 0; cycle < MEASURED_CYCLES; cycle++)
  {
    const started = process.hrtime.bigint()
    const found = await runBenchmarkCorpusCycle(
      definitions,
      join(workRoot, `measured-${cycle + 1}`)
    )
    const duration = process.hrtime.bigint() - started
    durationNs.push(duration.toString())
    if (found.length > 0) measuredOk = false
    errors.push(...found.map((error) => `measured ${cycle + 1}: ${error}`))
  }

  const result: BenchmarkBatchResult = {
    schemaVersion: 1,
    batch,
    warmupCorpusCycles: WARMUP_CYCLES,
    measuredCorpusCycles: MEASURED_CYCLES,
    visualRunsPerCorpusCycle: VISUAL_RUNS_PER_CYCLE,
    warmupOk,
    measuredOk,
    durationNs,
    errors,
    workerPeakRssBytes: workerPeakRssBytes(),
  }
  rmSync(workRoot, { recursive: true, force: true })
  console.log(`MULTIMODAL_PLAYWRIGHT_BATCH=${JSON.stringify(result)}`)
}

function cliArgs(values: string[]): Map<string, string>
{
  const parsed = new Map<string, string>()
  for (let index = 0; index < values.length; index++)
  {
    const key = values[index]
    if (!key?.startsWith('--')) continue
    const value = values[index + 1]
    if (!value || value.startsWith('--')) continue
    parsed.set(key, value)
    index++
  }
  return parsed
}

async function runPerformanceBatches(
  runRoot: string
): Promise<BatchEvidence[]>
{
  const baselineRoot = join(runRoot, 'baseline')
  mkdirSync(baselineRoot, { recursive: true })
  const batches: BatchEvidence[] = []
  for (let batch = 1; batch <= BENCHMARK_BATCHES; batch++)
  {
    const processEvidence = await runLoggedProcess({
      command: process.execPath,
      args: [
        '--import',
        'tsx',
        scriptPath,
        '--playwright-benchmark-worker',
        '--run-root',
        runRoot,
        '--batch',
        String(batch),
      ],
      cwd: root,
      runRoot,
      stdoutPath: join(baselineRoot, `batch-${batch}.stdout.log`),
      stderrPath: join(baselineRoot, `batch-${batch}.stderr.log`),
    })
    const result = parseSentinel<BenchmarkBatchResult>(
      processEvidence.stdoutTail,
      'MULTIMODAL_PLAYWRIGHT_BATCH='
    )
    batches.push({
      batch,
      plannedLaneOrder: [...LANE_ORDER[batch - 1]!],
      executedLaneOrder: ['playwright'],
      process: processEvidence,
      result,
    })
  }
  return batches
}

function percentile95(sorted: bigint[]): bigint
{
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!
}

function median(sorted: bigint[]): bigint
{
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint]!
  return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2n
}

function finiteRate(visualRuns: number, durationNs: bigint): number
{
  return (visualRuns * 1_000_000_000) / Number(durationNs)
}

function playwrightDistribution(batches: BatchEvidence[]): Distribution | null
{
  if (batches.length !== BENCHMARK_BATCHES) return null
  if (
    batches.some(
      (batch) =>
        batch.process.exitCode !== 0 ||
        batch.process.timedOut ||
        !batch.result?.warmupOk ||
        !batch.result.measuredOk ||
        batch.result.durationNs.length !== MEASURED_CYCLES ||
        batch.process.processGroupPeakRssBytes === null ||
        batch.process.descendantTreePeakRssBytes === null ||
        batch.process.aggregatePeakRssBytes === null
    )
  )
    return null
  const durations = batches.flatMap((batch) =>
    batch.result!.durationNs.map((value) => BigInt(value))
  )
  if (durations.length !== BENCHMARK_BATCHES * MEASURED_CYCLES) return null
  const sorted = [...durations].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  const medianDuration = median(sorted)
  const p95Duration = percentile95(sorted)
  return {
    sampleCount: durations.length,
    durationNs: durations.map(String),
    medianDurationNs: medianDuration.toString(),
    p95DurationNs: p95Duration.toString(),
    medianVisualRunsPerSecond: finiteRate(
      VISUAL_RUNS_PER_CYCLE,
      medianDuration
    ),
    p95SlowTailVisualRunsPerSecond: finiteRate(
      VISUAL_RUNS_PER_CYCLE,
      p95Duration
    ),
    processGroupPeakRssBytes: Math.max(
      ...batches.map((batch) => batch.process.processGroupPeakRssBytes!)
    ),
    descendantTreePeakRssBytes: Math.max(
      ...batches.map((batch) => batch.process.descendantTreePeakRssBytes!)
    ),
    aggregatePeakRssBytes: Math.max(
      ...batches.map((batch) => batch.process.aggregatePeakRssBytes!)
    ),
    workerPeakRssBytes: Math.max(
      ...batches.map((batch) => batch.result!.workerPeakRssBytes)
    ),
  }
}

interface ProbeCanvas
{
  width: number
  height: number
  getContext(type: string): unknown
  getBoundingClientRect(): {
    width: number
    height: number
    top: number
    left: number
    right: number
    bottom: number
  }
}

interface ProbeWindow extends Record<string, unknown>
{
  document: { createElement(name: string): ProbeCanvas }
  close(): void
}

interface ProbeDom
{
  window: ProbeWindow
}

interface HeadlessGlContext extends Record<PropertyKey, unknown>
{
  COLOR_BUFFER_BIT: number
  RGBA: number
  UNSIGNED_BYTE: number
  NO_ERROR: number
  STENCIL_BITS: number
  VENDOR: number
  RENDERER: number
  VERSION: number
  VERTEX_SHADER: number
  clearColor(red: number, green: number, blue: number, alpha: number): void
  clear(mask: number): void
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    destination: Uint8Array
  ): void
  getError(): number
  getParameter(parameter: number): unknown
  getSupportedExtensions(): string[] | null
  getContextAttributes(): Record<string, boolean> | null
  getExtension(name: string): unknown
  createBuffer(): object
  createFramebuffer(): object
  createProgram(): object
  createRenderbuffer(): object
  createShader(type: number): object
  createTexture(): object
}

type CreateGl = (
  width: number,
  height: number,
  attributes: Record<string, boolean>
) => HeadlessGlContext | null

interface ScratchRenderer
{
  setLayerGroupOrdering(groups: string[]): void
  createBitmapSkin(
    data: object,
    bitmapResolution: number,
    rotationCenter: [number, number]
  ): number
  createDrawable(group: string): number
  updateDrawableProperties(
    drawableId: number,
    properties: Record<string, unknown>
  ): void
  draw(): void
  getNativeSize(): number[]
  drawableTouchingScratchPoint(
    drawableId: number,
    x: number,
    y: number
  ): boolean
}

interface ScratchRendererConstructor
{
  new (canvas: ProbeCanvas): ScratchRenderer
  isSupported(canvas: ProbeCanvas): boolean
}

interface DomInstallation
{
  dom: ProbeDom
  canvas(): ProbeCanvas
}

function errorText(error: unknown): string
{
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

function installProbeDom(jsdomRoot: string): DomInstallation
{
  const jsdomRequire = createRequire(join(jsdomRoot, 'package.json'))
  const loaded = jsdomRequire(jsdomRoot) as {
    JSDOM: new (
      html: string,
      options: { pretendToBeVisual: boolean }
    ) => ProbeDom
  }
  const dom = new loaded.JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
  })
  const globals = globalThis as Record<string, unknown>
  const window = dom.window
  for (const name of [
    'DOMParser',
    'XMLSerializer',
    'Node',
    'Element',
    'HTMLCanvasElement',
    'HTMLImageElement',
    'HTMLVideoElement',
  ])
    globals[name] = window[name]
  globals.window = window
  globals.document = window.document
  globals.self = window
  return {
    dom,
    canvas(): ProbeCanvas
    {
      return window.document.createElement('canvas')
    },
  }
}

function makeProbeContext(
  createGl: CreateGl,
  canvas: ProbeCanvas
): HeadlessGlContext
{
  canvas.width = 480
  canvas.height = 360
  const context = createGl(480, 360, {
    alpha: false,
    stencil: true,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  if (!context) throw new Error('gl context creation returned null')
  Object.defineProperty(context, 'canvas', {
    value: canvas,
    configurable: true,
  })
  canvas.getBoundingClientRect = () => ({
    width: 480,
    height: 360,
    top: 0,
    left: 0,
    right: 480,
    bottom: 360,
  })
  return context
}

function destroyContext(context: HeadlessGlContext): void
{
  const extension = context.getExtension('STACKGL_destroy_context') as {
    destroy?: () => void
  } | null
  extension?.destroy?.()
}

function valueString(value: unknown): string | null
{
  return typeof value === 'string' ? value : null
}

function rawContextProbe(createGl: CreateGl): RawContextResult
{
  const canvas: ProbeCanvas = {
    width: 480,
    height: 360,
    getContext: () => null,
    getBoundingClientRect: () => ({
      width: 480,
      height: 360,
      top: 0,
      left: 0,
      right: 480,
      bottom: 360,
    }),
  }
  let context: HeadlessGlContext | null = null
  try
  {
    context = makeProbeContext(createGl, canvas)
    const observedAttributes = context.getContextAttributes()
    context.clearColor(1, 0.5, 0.25, 1)
    context.clear(context.COLOR_BUFFER_BIT)
    const pixel = new Uint8Array(4)
    context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
    const glError = context.getError()
    const stencilBits = Number(context.getParameter(context.STENCIL_BITS))
    const extensions = [...(context.getSupportedExtensions() ?? [])].sort()
    const readback = [...pixel]
    const attributesOk =
      observedAttributes?.alpha === false &&
      observedAttributes.stencil === true &&
      observedAttributes.antialias === false
    const passed =
      attributesOk &&
      stencilBits >= 8 &&
      glError === context.NO_ERROR &&
      JSON.stringify(readback) === JSON.stringify([255, 128, 64, 255])
    return {
      ...(passed
        ? passedStatus('raw WebGL1 context and exact clear/readback succeeded')
        : failedStatus(
            'raw-context-mismatch',
            'raw context attributes, stencil, GL error, or readback mismatched'
          )),
      width: 480,
      height: 360,
      requestedAttributes: {
        alpha: false,
        stencil: true,
        antialias: false,
        preserveDrawingBuffer: true,
      },
      observedAttributes,
      vendor: valueString(context.getParameter(context.VENDOR)),
      renderer: valueString(context.getParameter(context.RENDERER)),
      version: valueString(context.getParameter(context.VERSION)),
      stencilBits,
      extensions,
      readback,
      readbackSha256: sha256(pixel),
      glError,
    }
  }
  catch (error)
  {
    return {
      ...emptyRawContext('native-load'),
      ...failedStatus('raw-context-failed', errorText(error)),
    }
  }
  finally
  {
    if (context) destroyContext(context)
  }
}

function scratchRendererConstructor(
  value: unknown
): ScratchRendererConstructor
{
  const record = value as {
    ScratchRender?: ScratchRendererConstructor
    default?: ScratchRendererConstructor
  }
  const constructor = record.ScratchRender ?? record.default
  if (typeof constructor !== 'function')
    throw new Error('public export does not contain ScratchRender')
  return constructor
}

function emptyShimDiagnostic(): ShimmedNodeDiagnostic
{
  return {
    eligibleForPromotion: false,
    construction: blockedStatus(
      'shimmed-node-diagnostic',
      'separate shim diagnostic has not run'
    ),
    bitmapDrawAndHitTest: blockedStatus(
      'shimmed-renderer-construction',
      'bitmap rendering has not run'
    ),
    glSemantics: blockedStatus(
      'shimmed-renderer-construction',
      'GL semantics have not been measured'
    ),
    observations: {
      supported: null,
      nativeSize: null,
      centerPixel: null,
      cornerPixel: null,
      touchingCenter: null,
      touchingOutside: null,
      glErrors: [],
    },
  }
}

function rendererCoreProbe(
  createGl: CreateGl,
  rendererNodePath: string,
  jsdomRoot: string
): RendererDiagnostic
{
  const installation = installProbeDom(jsdomRoot)
  let publicNodeImport: StatusResult
  let constructor: ScratchRendererConstructor | null = null
  try
  {
    constructor = scratchRendererConstructor(requirePkg(rendererNodePath))
    publicNodeImport = passedStatus(
      'public Node export loaded after the complete jsdom environment was installed'
    )
  }
  catch (error)
  {
    publicNodeImport = failedStatus(
      'scratch-render-public-import-failed',
      errorText(error)
    )
  }

  let rendererConstruction: StatusResult
  if (!constructor)
  {
    rendererConstruction = blockedStatus(
      'scratch-render-public-node-import',
      'renderer construction requires the public export'
    )
  }
  else
  {
    const canvas = installation.canvas()
    let context: HeadlessGlContext | null = null
    try
    {
      context = makeProbeContext(createGl, canvas)
      canvas.getContext = (type) =>
        type === 'webgl' || type === 'experimental-webgl' ? context : null
      new constructor(canvas)
      rendererConstruction = passedStatus(
        'renderer constructed without compatibility shims'
      )
    }
    catch (error)
    {
      rendererConstruction = failedStatus(
        'scratch-render-clean-construction-failed',
        errorText(error)
      )
    }
    finally
    {
      if (context) destroyContext(context)
    }
  }

  let twoDimensionalSurface: StatusResult
  try
  {
    const surface = installation.canvas().getContext('2d')
    twoDimensionalSurface = surface
      ? passedStatus('jsdom provided a 2D canvas surface')
      : failedStatus(
          'two-dimensional-canvas-unavailable',
          'jsdom returned no 2D canvas context for SVG, text, and general bitmap paths'
        )
  }
  catch (error)
  {
    twoDimensionalSurface = failedStatus(
      'two-dimensional-canvas-unavailable',
      errorText(error)
    )
  }
  installation.dom.window.close()
  const blocker =
    rendererConstruction.status !== 'passed'
      ? 'scratch-render-clean-construction'
      : 'two-dimensional-canvas-surface'
  const downstream = (detail: string): StatusResult =>
    blockedStatus(blocker, detail)
  return {
    publicNodeImport,
    rendererConstruction,
    twoDimensionalSurface,
    officialVmAttachment: downstream(
      'official VM attachment was not attempted'
    ),
    projectLoad: downstream('exact .sb3 loading was not attempted'),
    deterministicScenario: downstream(
      'deterministic scenario execution was not attempted'
    ),
    frameAndGeometryEvidence: downstream(
      'frame and geometry evidence was not captured'
    ),
    networkDenial: downstream('offline transport denial was not exercised'),
    structuredEvidence: downstream(
      'runtime descriptors and media manifests were not produced'
    ),
    shimmedNodeDiagnostic: emptyShimDiagnostic(),
  }
}

function glProbeWorker(args: Map<string, string>): void
{
  const glRoot = args.get('--gl-root')
  const packageVersion = args.get('--package-version')
  const mode = args.get('--probe-mode')
  if (!glRoot || !packageVersion || !mode)
    throw new Error('gl probe worker args are missing')
  const glRequire = createRequire(join(glRoot, 'package.json'))
  let createGl: CreateGl | null = null
  let nativeLoad: StatusResult
  try
  {
    createGl = glRequire(glRoot) as CreateGl
    nativeLoad =
      typeof createGl === 'function'
        ? passedStatus(`native gl@${packageVersion} module loaded`)
        : failedStatus('native-export-invalid', 'gl did not export a function')
  }
  catch (error)
  {
    nativeLoad = failedStatus('native-load-failed', errorText(error))
  }
  if (mode === 'shimmed-node')
  {
    const rendererNode = args.get('--renderer-node')
    const jsdomRoot = args.get('--jsdom-root')
    if (!createGl || !rendererNode || !jsdomRoot)
      throw new Error('shim diagnostic prerequisites are missing')
    const result = shimmedRendererProbe(createGl, rendererNode, jsdomRoot)
    console.log(`MULTIMODAL_GL_SHIM=${JSON.stringify(result)}`)
    return
  }
  const rawContext = createGl
    ? rawContextProbe(createGl)
    : emptyRawContext('native-load')
  let renderer: RendererDiagnostic | null = null
  const rendererNode = args.get('--renderer-node')
  const jsdomRoot = args.get('--jsdom-root')
  if (createGl && rendererNode && jsdomRoot)
    renderer = rendererCoreProbe(createGl, rendererNode, jsdomRoot)
  const result: GlProbeResult = {
    schemaVersion: 1,
    packageVersion,
    nativeLoad,
    rawContext,
    renderer,
  }
  console.log(`MULTIMODAL_GL_PROBE=${JSON.stringify(result)}`)
}

type GlErrorEvent = ShimmedNodeDiagnostic['observations']['glErrors'][number]

function installWebGlConstructors(
  context: HeadlessGlContext,
  window: ProbeWindow
): void
{
  const objects: Record<string, object> = {
    WebGLBuffer: context.createBuffer(),
    WebGLFramebuffer: context.createFramebuffer(),
    WebGLProgram: context.createProgram(),
    WebGLRenderbuffer: context.createRenderbuffer(),
    WebGLShader: context.createShader(context.VERTEX_SHADER),
    WebGLTexture: context.createTexture(),
  }
  const globals = globalThis as Record<string, unknown>
  for (const [name, object] of Object.entries(objects))
  {
    const constructor = Object.getPrototypeOf(object)?.constructor as unknown
    globals[name] = constructor
    window[name] = constructor
  }
  const contextConstructor = Object.getPrototypeOf(context)
    ?.constructor as unknown
  globals.WebGLRenderingContext = contextConstructor
  window.WebGLRenderingContext = contextConstructor
}

function instrumentContext(
  raw: HeadlessGlContext,
  events: GlErrorEvent[],
  phase: { value: string }
): HeadlessGlContext
{
  return new Proxy(raw, {
    get(target, property): unknown
    {
      const value = Reflect.get(target, property, target) as unknown
      if (typeof value !== 'function') return value
      if (property === 'getError') return value.bind(target)
      return (...args: unknown[]): unknown =>
      {
        const result = Reflect.apply(value, target, args)
        const errors: number[] = []
        for (
          let error = target.getError();
          error !== target.NO_ERROR && errors.length < 8;
          error = target.getError()
        )
          errors.push(error)
        if (errors.length > 0)
          events.push({
            phase: phase.value,
            method: String(property),
            args: args.map((argument) =>
              typeof argument === 'number'
                ? argument
                : ((argument as { constructor?: { name?: string } } | null)
                    ?.constructor?.name ?? typeof argument)
            ),
            errors,
          })
        return result
      }
    },
  })
}

class ProbeImageData
{
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    maybeHeight?: number
  )
  {
    if (typeof dataOrWidth === 'number')
    {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
      return
    }
    if (maybeHeight === undefined)
      throw new Error('ImageData height is required with explicit pixels')
    this.data = dataOrWidth
    this.width = widthOrHeight
    this.height = maybeHeight
  }
}

function shimmedRendererProbe(
  createGl: CreateGl,
  rendererNodePath: string,
  jsdomRoot: string
): ShimmedNodeDiagnostic
{
  const installation = installProbeDom(jsdomRoot)
  const canvas = installation.canvas()
  let raw: HeadlessGlContext | null = null
  const events: GlErrorEvent[] = []
  const phase = { value: 'constructor' }
  const result = emptyShimDiagnostic()
  try
  {
    raw = makeProbeContext(createGl, canvas)
    installWebGlConstructors(raw, installation.dom.window)
    const globals = globalThis as Record<string, unknown>
    globals.ImageData = ProbeImageData
    installation.dom.window.ImageData = ProbeImageData
    const instrumented = instrumentContext(raw, events, phase)
    canvas.getContext = (type) =>
      type === 'webgl' || type === 'experimental-webgl' ? instrumented : null
    const constructor = scratchRendererConstructor(requirePkg(rendererNodePath))
    const supported = constructor.isSupported(canvas)
    const renderer = new constructor(canvas)
    result.construction = passedStatus(
      'renderer constructed only after explicit DOM and WebGL constructor shims'
    )
    phase.value = 'bitmap-and-draw'
    renderer.setLayerGroupOrdering(['sprite'])
    const pixels = new Uint8ClampedArray(32 * 32 * 4)
    for (let index = 0; index < pixels.length; index += 4)
    {
      pixels[index] = 255
      pixels[index + 3] = 255
    }
    const skinId = renderer.createBitmapSkin(
      new ProbeImageData(pixels, 32, 32),
      1,
      [16, 16]
    )
    const drawableId = renderer.createDrawable('sprite')
    renderer.updateDrawableProperties(drawableId, {
      skinId,
      position: [0, 0],
      direction: 90,
      scale: [100, 100],
      visible: true,
    })
    renderer.draw()
    const centerPixel = new Uint8Array(4)
    const cornerPixel = new Uint8Array(4)
    instrumented.readPixels(
      240,
      180,
      1,
      1,
      instrumented.RGBA,
      instrumented.UNSIGNED_BYTE,
      centerPixel
    )
    instrumented.readPixels(
      0,
      0,
      1,
      1,
      instrumented.RGBA,
      instrumented.UNSIGNED_BYTE,
      cornerPixel
    )
    const touchingCenter = renderer.drawableTouchingScratchPoint(
      drawableId,
      0,
      0
    )
    const touchingOutside = renderer.drawableTouchingScratchPoint(
      drawableId,
      100,
      100
    )
    const nativeSize = renderer.getNativeSize()
    const center = [...centerPixel]
    const corner = [...cornerPixel]
    const bitmapPassed =
      supported === true &&
      JSON.stringify(nativeSize) === JSON.stringify([480, 360]) &&
      JSON.stringify(center) === JSON.stringify([255, 0, 0, 255]) &&
      JSON.stringify(corner) === JSON.stringify([255, 255, 255, 255]) &&
      touchingCenter === true &&
      touchingOutside === false
    result.bitmapDrawAndHitTest = bitmapPassed
      ? passedStatus(
          'shimmed bitmap draw, pixel readback, and point hit-test matched'
        )
      : failedStatus(
          'shimmed-bitmap-smoke-mismatch',
          'shimmed bitmap pixels, geometry, or hit-test mismatched'
        )
    result.observations = {
      supported,
      nativeSize,
      centerPixel: center,
      cornerPixel: corner,
      touchingCenter,
      touchingOutside,
      glErrors: events,
    }
    result.glSemantics =
      events.length === 0
        ? passedStatus('no instrumented GL call left an error')
        : failedStatus(
            'shimmed-renderer-gl-errors',
            `${events.length} renderer/TWGL calls produced GL errors`
          )
  }
  catch (error)
  {
    result.construction = failedStatus(
      'shimmed-renderer-diagnostic-failed',
      errorText(error)
    )
    result.bitmapDrawAndHitTest = blockedStatus(
      'shimmed-renderer-construction',
      'bitmap rendering did not complete'
    )
    result.glSemantics = blockedStatus(
      'shimmed-renderer-construction',
      'GL semantics could not be measured'
    )
    result.observations.glErrors = events
  }
  finally
  {
    if (raw) destroyContext(raw)
    installation.dom.window.close()
  }
  return result
}

function dependencyAudit(): DependencyAudit
{
  const manifests = [join(root, 'package.json')]
  const packagesRoot = join(root, 'packages')
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true }))
  {
    if (!entry.isDirectory()) continue
    const manifest = join(packagesRoot, entry.name, 'package.json')
    if (existsSync(manifest)) manifests.push(manifest)
  }
  const matched: string[] = []
  for (const manifest of manifests)
  {
    const value = JSON.parse(readFileSync(manifest, 'utf8')) as Record<
      string,
      unknown
    >
    for (const section of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ])
    {
      const dependencies = value[section] as Record<string, unknown> | undefined
      if (dependencies && Object.hasOwn(dependencies, 'gl'))
      {
        matched.push(portable(root, manifest))
        break
      }
    }
  }
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8')
  ) as { packages?: Record<string, unknown> }
  return {
    normalDependencyAdded: matched.length > 0,
    manifestPaths: matched,
    lockContainsGlPackage: Object.hasOwn(
      lock.packages ?? {},
      'node_modules/gl'
    ),
  }
}

function capabilityMatrix(): CapabilityRow[]
{
  const uses = new Map<string, ExperimentCase['id'][]>()
  for (const definition of experimentCases)
  {
    for (const capability of definition.requiredCapabilities)
    {
      const ids = uses.get(capability) ?? []
      ids.push(definition.id)
      uses.set(capability, ids)
    }
  }
  const supported = [
    'manual-stepping',
    'keyboard-input',
    'svg-costume',
    'bitmap-costume',
    'stage-rgb-readback',
    'sprite-geometry',
    'frame-change',
    'touching-object',
    'collision-driven-state',
    'touching-color',
    'color-touching-color',
    'pen-output',
    'graphic-effects',
    'layer-ordering',
    'clone-rendering',
    'mouse-hit-testing',
    'speech-and-text-bubbles',
  ]
  return supported.map((id) =>
  {
    const exercisedByCases = uses.get(id) ?? []
    const covered = exercisedByCases.length > 0
    return {
      id,
      baselineSupported: true,
      exercisedByCases,
      covered,
      headlessSupported: null,
      result: covered
        ? blockedStatus(
            'scratch-render-node-integration',
            'Playwright exercised this capability, but headless support was not measured'
          )
        : failedStatus(
            'baseline-capability-not-covered',
            'the bounded corpus does not exercise this supported renderer capability'
          ),
    }
  })
}

function gate(
  id: string,
  threshold: string,
  observed: string | null,
  result: StatusResult
): Gate
{
  return { id, required: true, threshold, observed, result }
}

function promotionGates(options: {
  candidate: InstallEvidence
  matrix: CapabilityRow[]
}): Gate[]
{
  const renderer = options.candidate.renderer
  const hostInstallPassed =
    options.candidate.install.status === 'passed' &&
    options.candidate.nativeLoad.status === 'passed' &&
    options.candidate.rawContext.status === 'passed'
  const integrationPassed =
    renderer?.publicNodeImport.status === 'passed' &&
    renderer.rendererConstruction.status === 'passed' &&
    renderer.twoDimensionalSurface.status === 'passed'
  const coveragePassed = options.matrix.every((row) => row.covered)
  return [
    gate(
      'candidate-host-install',
      'clean Node 24 macOS install, native load, and raw context',
      `${options.candidate.install.status}; native ${options.candidate.nativeLoad.status}; raw ${options.candidate.rawContext.status}`,
      hostInstallPassed
        ? passedStatus('candidate installed and passed the raw host probe')
        : failedStatus(
            'candidate-host-install-or-probe-failed',
            'candidate install, native load, and raw context did not all pass'
          )
    ),
    gate(
      'candidate-linux-ci-install',
      'clean Node 24 installation and build in Linux CI',
      null,
      blockedStatus(
        'linux-ci-run',
        'no same-source Linux CI run exists; local containers cannot substitute'
      )
    ),
    gate(
      'scratch-render-public-node-integration',
      'public export, unshimmed construction, and required DOM surfaces all pass',
      renderer
        ? `import ${renderer.publicNodeImport.status}; construction ${renderer.rendererConstruction.status}; 2D ${renderer.twoDimensionalSurface.status}`
        : null,
      integrationPassed
        ? passedStatus('public Scratch renderer integration passed cleanly')
        : failedStatus(
            'scratch-render-node-integration-failed',
            'the public Node renderer did not construct with complete required surfaces without shims'
          )
    ),
    gate(
      'required-assertion-agreement',
      '100% agreement with Playwright on required renderer assertions',
      null,
      blockedStatus(
        'scratch-render-node-integration',
        'headless-gl did not reach the correctness corpus'
      )
    ),
    gate(
      'collision-state-agreement',
      '100% agreement with Playwright on collision-driven state outcomes',
      null,
      blockedStatus(
        'scratch-render-node-integration',
        'headless-gl did not execute the collector collision case'
      )
    ),
    gate(
      'supported-capability-coverage',
      'no missing supported visual capability',
      `${options.matrix.filter((row) => row.covered).length}/${options.matrix.length} capabilities covered by the bounded corpus`,
      coveragePassed
        ? passedStatus('every supported visual capability was covered')
        : failedStatus(
            'supported-capability-coverage-incomplete',
            'the corpus cannot establish complete renderer capability support'
          )
    ),
    gate(
      'median-throughput',
      'headless warm median throughput >= 2x Playwright',
      null,
      blockedStatus(
        'scratch-render-node-integration',
        'headless end-to-end throughput was not measured'
      )
    ),
    gate(
      'p95-throughput',
      'headless slow-tail p95 throughput >= 1.5x Playwright',
      null,
      blockedStatus(
        'scratch-render-node-integration',
        'headless slow-tail throughput was not measured'
      )
    ),
    gate(
      'peak-rss',
      'headless aggregate process peak RSS <= 1.25x Playwright',
      null,
      blockedStatus(
        'scratch-render-node-integration',
        'headless aggregate process RSS was not measured'
      )
    ),
    gate(
      'isolation-and-evidence-parity',
      'no weaker isolation or runtime evidence than Playwright',
      null,
      blockedStatus(
        'headless-runtime-lane',
        'no headless lane produced network denial, runtime identity, trace, or media evidence'
      )
    ),
  ]
}

function statusText(result: StatusResult): string
{
  const prefix =
    result.status === 'not-measured'
      ? 'NOT MEASURED'
      : result.status.toUpperCase()
  if (result.blockedBy)
    return `${prefix} - blocked by ${result.blockedBy}: ${result.detail}`
  return result.detail ? `${prefix} - ${result.detail}` : prefix
}

function markdownCell(value: unknown): string
{
  return mdCode(String(value).replaceAll('|', '\\|').replaceAll('\n', ' '))
}

function mib(bytes: number | null): string
{
  return bytes === null ? 'not measured' : (bytes / (1024 * 1024)).toFixed(2)
}

function reportMarkdown(report: MultimodalHeadlessGlReportV2): string
{
  const lines = [
    '# Multimodal headless-gl experiment',
    '',
    `**${report.decision.recommendation.toUpperCase()}** - experiment ${report.decision.experimentStatus}`,
    '',
    'This report contains bounded compatibility and throughput evidence for the recorded corpus only. It is not a claim of general renderer equivalence.',
    '',
    '## Decision',
    '',
    `- Playwright remains production: ${markdownCell(report.decision.playwrightRemainsProduction)}`,
    `- normal gl dependency added: ${markdownCell(report.decision.normalDependencyAdded)}`,
    `- run id: ${markdownCell(report.runId)}`,
    `- source revision: ${markdownCell(report.source.revision)}`,
    `- source commit: ${markdownCell(report.source.commit)}`,
    `- source state: ${markdownCell(report.source.state)}`,
    `- source dirty: ${markdownCell(report.source.dirty)}`,
    `- source stable at completion: ${markdownCell(report.source.stableAtCompletion)}`,
    `- start source tree sha256: ${markdownCell(report.source.startManifest.treeSha256)}`,
    `- start source manifest: ${markdownCell(`${report.source.startManifest.relativePath} (${report.source.startManifest.entryCount} entries, ${report.source.startManifest.byteLength} bytes, sha256 ${report.source.startManifest.sha256})`)}`,
    `- completion source tree sha256: ${markdownCell(report.source.completionManifest.treeSha256)}`,
    `- completion source manifest: ${markdownCell(`${report.source.completionManifest.relativePath} (${report.source.completionManifest.entryCount} entries, ${report.source.completionManifest.byteLength} bytes, sha256 ${report.source.completionManifest.sha256})`)}`,
    `- Node: ${markdownCell(report.environment.node)}`,
    `- npm: ${markdownCell(report.environment.npm)}`,
    `- host: ${markdownCell(`${report.environment.platform}/${report.environment.arch}`)}`,
    '',
  ]
  for (const reason of report.decision.reasons) lines.push(`- ${reason}`)

  lines.push(
    '',
    '## Promotion gates',
    '',
    '| Gate | Result | Threshold | Observed |',
    '| --- | --- | --- | --- |'
  )
  for (const entry of report.gates)
    lines.push(
      `| ${markdownCell(entry.id)} | ${markdownCell(statusText(entry.result))} | ${markdownCell(entry.threshold)} | ${markdownCell(entry.observed ?? 'not measured')} |`
    )

  lines.push(
    '',
    '## Isolated installation',
    '',
    '| Role | Package | Install | Duration ms | Peak RSS MiB | Raw context |',
    '| --- | --- | --- | ---: | ---: | --- |'
  )
  for (const installation of [
    report.installation.hostControl,
    report.installation.hostCandidate,
  ])
    lines.push(
      `| ${markdownCell(installation.role)} | ${markdownCell(`gl@${installation.version}`)} | ${markdownCell(statusText(installation.install))} | ${installation.install.process?.durationMs.toFixed(2) ?? 'not measured'} | ${mib(installation.install.process?.aggregatePeakRssBytes ?? null)} | ${markdownCell(statusText(installation.rawContext))} |`
    )

  lines.push('', '## Candidate preflight', '')
  for (const stage of report.preflight)
    lines.push(`- ${markdownCell(stage.id)}: ${statusText(stage.result)}`)

  lines.push(
    '',
    '## Playwright correctness baseline',
    '',
    '| Case | Official Scratch | TurboWarp | Headless-gl | Frames |',
    '| --- | --- | --- | --- | ---: |'
  )
  for (const testCase of report.corpus.cases)
    lines.push(
      `| ${markdownCell(testCase.id)} | ${markdownCell(testCase.officialPlaywright.status)} | ${markdownCell(testCase.turboWarpPlaywright.status)} | ${markdownCell(testCase.headlessGl.status)} | ${testCase.officialPlaywright.frameSha256s.length} |`
    )

  lines.push('', '## Playwright performance baseline', '')
  const baseline = report.performance.playwright
  if (baseline)
  {
    lines.push(
      `- measured corpus cycles: ${baseline.sampleCount}`,
      `- visual runs per cycle: ${report.configuration.visualRunsPerCorpusCycle}`,
      `- median duration: ${markdownCell(`${baseline.medianDurationNs} ns`)}`,
      `- p95 duration: ${markdownCell(`${baseline.p95DurationNs} ns`)}`,
      `- median throughput: ${baseline.medianVisualRunsPerSecond.toFixed(4)} visual runs/s`,
      `- p95 slow-tail throughput: ${baseline.p95SlowTailVisualRunsPerSecond.toFixed(4)} visual runs/s`,
      `- aggregate process peak RSS: ${mib(baseline.aggregatePeakRssBytes)} MiB`,
      `- process-group-only peak RSS: ${mib(baseline.processGroupPeakRssBytes)} MiB`,
      `- descendant-tree-only peak RSS: ${mib(baseline.descendantTreePeakRssBytes)} MiB`,
      `- worker-only peak RSS: ${mib(baseline.workerPeakRssBytes)} MiB`
    )
  }
  else lines.push('_invalid or incomplete baseline_')
  lines.push(
    '',
    'Headless throughput and RSS ratios are not measured because the candidate did not pass Scratch renderer integration.',
    '',
    '## Capability matrix',
    '',
    '| Capability | Corpus cases | Headless support | Result |',
    '| --- | --- | --- | --- |'
  )
  for (const row of report.corpus.capabilityMatrix)
    lines.push(
      `| ${markdownCell(row.id)} | ${markdownCell(row.exercisedByCases.join(', ') || 'not covered')} | ${markdownCell(row.headlessSupported ?? 'not measured')} | ${markdownCell(statusText(row.result))} |`
    )

  const shim = report.installation.hostCandidate.renderer?.shimmedNodeDiagnostic
  if (shim)
  {
    lines.push(
      '',
      '## Non-promotable shim diagnostic',
      '',
      `- construction: ${statusText(shim.construction)}`,
      `- bitmap draw and hit-test: ${statusText(shim.bitmapDrawAndHitTest)}`,
      `- GL semantics: ${statusText(shim.glSemantics)}`,
      `- instrumented GL error calls: ${shim.observations.glErrors.length}`
    )
    for (const event of shim.observations.glErrors)
      lines.push(
        `  - ${markdownCell(event.phase)} ${markdownCell(event.method)} -> ${markdownCell(event.errors.join(', '))}`
      )
  }

  lines.push('', '## Limitations', '')
  for (const limitation of report.limitations) lines.push(`- ${limitation}`)
  return lines.join('\n') + '\n'
}

function candidatePreflight(candidate: InstallEvidence): Array<{
  id: string
  result: StatusResult
}>
{
  const renderer = candidate.renderer
  return [
    { id: 'candidate-isolated-install', result: candidate.install },
    { id: 'candidate-native-load', result: candidate.nativeLoad },
    { id: 'candidate-raw-webgl1', result: candidate.rawContext },
    {
      id: 'scratch-render-public-node-import',
      result:
        renderer?.publicNodeImport ??
        blockedStatus(
          'candidate-native-load',
          'public import was not attempted'
        ),
    },
    {
      id: 'scratch-render-clean-construction',
      result:
        renderer?.rendererConstruction ??
        blockedStatus(
          'scratch-render-public-node-import',
          'renderer construction was not attempted'
        ),
    },
    {
      id: 'two-dimensional-canvas-surface',
      result:
        renderer?.twoDimensionalSurface ??
        blockedStatus(
          'scratch-render-public-node-import',
          '2D canvas availability was not measured'
        ),
    },
    {
      id: 'official-vm-attachment',
      result:
        renderer?.officialVmAttachment ??
        blockedStatus(
          'scratch-render-node-integration',
          'official VM attachment was not attempted'
        ),
    },
    {
      id: 'exact-project-load',
      result:
        renderer?.projectLoad ??
        blockedStatus(
          'official-vm-attachment',
          'exact .sb3 loading was not attempted'
        ),
    },
    {
      id: 'deterministic-scenario',
      result:
        renderer?.deterministicScenario ??
        blockedStatus(
          'exact-project-load',
          'deterministic scenario execution was not attempted'
        ),
    },
    {
      id: 'frame-and-geometry-evidence',
      result:
        renderer?.frameAndGeometryEvidence ??
        blockedStatus(
          'deterministic-scenario',
          'frame and geometry evidence was not captured'
        ),
    },
    {
      id: 'offline-transport-denial',
      result:
        renderer?.networkDenial ??
        blockedStatus(
          'headless-runtime-lane',
          'offline transport denial was not exercised'
        ),
    },
    {
      id: 'structured-runtime-evidence',
      result:
        renderer?.structuredEvidence ??
        blockedStatus(
          'headless-runtime-lane',
          'runtime identity, trace, and media evidence were not produced'
        ),
    },
    {
      id: 'diagnostic-shim-construction-non-promotable',
      result:
        renderer?.shimmedNodeDiagnostic.construction ??
        blockedStatus(
          'candidate-native-load',
          'shim diagnostic was not attempted'
        ),
    },
    {
      id: 'diagnostic-shim-bitmap-non-promotable',
      result:
        renderer?.shimmedNodeDiagnostic.bitmapDrawAndHitTest ??
        blockedStatus(
          'diagnostic-shim-construction',
          'shimmed bitmap diagnostic was not attempted'
        ),
    },
    {
      id: 'diagnostic-shim-gl-semantics-non-promotable',
      result:
        renderer?.shimmedNodeDiagnostic.glSemantics ??
        blockedStatus(
          'diagnostic-shim-construction',
          'shimmed GL semantics were not measured'
        ),
    },
  ]
}

function decisionReasons(gates: Gate[], audit: DependencyAudit): string[]
{
  const reasons = gates
    .filter((entry) => entry.result.status !== 'passed')
    .map((entry) => `${markdownCell(entry.id)}: ${statusText(entry.result)}`)
  if (audit.normalDependencyAdded)
    reasons.push(
      `${markdownCell('dependency-policy')}: a normal gl dependency was found unexpectedly`
    )
  return reasons
}

async function experimentMain(): Promise<void>
{
  const started = process.hrtime.bigint()
  const runId = `multimodal-renderer-experiment-${newRunId()}`
  const runRoot = join(root, 'runs', runId)
  mkdirSync(runRoot, { recursive: true })
  const createdAt = new Date().toISOString()
  const startSource = multimodalSourceSnapshot()
  const startManifest = retainSourceSnapshot(runRoot, 'start', startSource)
  const revision = multimodalSourceRevision()
  const commit = startSource.commit ?? 'unknown'
  const npmVersion = commandOutput('npm', ['--version'])
  const sandboxes: string[] = []
  let experimentStatus: 'complete' | 'invalid' = 'invalid'
  let report: MultimodalHeadlessGlReportV2 | null = null
  try
  {
    const prepared = await prepareCases(runRoot)
    console.log('headless-gl: isolated control install gl@8.1.6')
    const control = await installGlCandidate({
      role: 'control',
      version: GL_CONTROL_VERSION,
      runRoot,
      commit,
    })
    sandboxes.push(control.sandbox)
    if (control.evidence.install.status === 'passed')
      await runInstalledProbe({
        evidence: control.evidence,
        sandbox: control.sandbox,
        runRoot,
        includeRenderer: false,
      })

    console.log('headless-gl: isolated candidate install gl@9.0.0-rc.10')
    const candidate = await installGlCandidate({
      role: 'candidate',
      version: GL_CANDIDATE_VERSION,
      runRoot,
      commit,
    })
    sandboxes.push(candidate.sandbox)
    if (candidate.evidence.install.status === 'passed')
      await runInstalledProbe({
        evidence: candidate.evidence,
        sandbox: candidate.sandbox,
        runRoot,
        includeRenderer: true,
      })

    console.log(
      'headless-gl: official Scratch and TurboWarp correctness baseline'
    )
    const corpusCases = await runCorrectnessBaseline(prepared, runRoot)
    console.log(
      'headless-gl: four Playwright batches, 32 measured two-case corpus cycles'
    )
    const batches = await runPerformanceBatches(runRoot)
    const playwright = playwrightDistribution(batches)
    const baselineValid =
      corpusCases.every(
        (testCase) =>
          testCase.officialPlaywright.status === 'passed' &&
          testCase.turboWarpPlaywright.status === 'passed'
      ) && playwright !== null

    const matrix = capabilityMatrix()
    const gates = promotionGates({
      candidate: candidate.evidence,
      matrix,
    })
    const audit = dependencyAudit()
    const everyGatePassed = gates.every(
      (entry) => entry.result.status === 'passed'
    )
    const rendererRoot = packageRoot('@scratch/scratch-render')
    const packageJsonSha256 = hashFile(join(root, 'package.json'))
    const packageLockSha256 = hashFile(join(root, 'package-lock.json'))
    const scriptSha256 = hashFile(scriptPath)
    const rendererNodeEntry = fileIdentity(
      join(rendererRoot, 'dist', 'node', 'scratch-render.js'),
      root
    )
    const rendererWebEntry = fileIdentity(
      join(rendererRoot, 'dist', 'web', 'scratch-render.js'),
      root
    )
    const completionSource = multimodalSourceSnapshot()
    const completionManifest = retainSourceSnapshot(
      runRoot,
      'completion',
      completionSource
    )
    const startAuthoritative = sourceSnapshotIsAuthoritative(startSource)
    const completionAuthoritative =
      sourceSnapshotIsAuthoritative(completionSource)
    const stableAtCompletion = sourceSnapshotsMatch(
      startSource,
      completionSource
    )
    const sourceProvenanceValid = startAuthoritative && stableAtCompletion
    const completedAt = new Date().toISOString()
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
    experimentStatus =
      baselineValid && sourceProvenanceValid ? 'complete' : 'invalid'
    const recommendation =
      everyGatePassed && sourceProvenanceValid ? 'promote' : 'reject'
    const reasons = decisionReasons(gates, audit)
    let sourceLimitation: string | null = null
    if (!startAuthoritative)
    {
      sourceLimitation = `The experiment is invalid because the bounded starting source snapshot is not authoritative: ${startSource.issue ?? 'source identity is unavailable'}.`
    }
    else if (!completionAuthoritative)
    {
      sourceLimitation = `The experiment is invalid because the bounded completion source snapshot is not authoritative: ${completionSource.issue ?? 'source identity is unavailable'}.`
    }
    else if (!stableAtCompletion)
    {
      sourceLimitation =
        'The experiment is invalid because bounded source identity changed between the start and completion snapshots.'
    }
    if (sourceLimitation)
      reasons.push(`${markdownCell('source-provenance')}: ${sourceLimitation}`)
    report = {
      schemaVersion: 2,
      reportKind: 'multimodal-renderer-experiment',
      runId,
      createdAt,
      completedAt,
      durationMs,
      source: {
        revision,
        commit: startSource.commit,
        state: startSource.state,
        dirty:
          startSource.state === 'unknown'
            ? null
            : startSource.state === 'dirty',
        startManifest,
        completionManifest,
        stableAtCompletion,
        packageJsonSha256,
        packageLockSha256,
        scriptSha256,
        rendererNodeEntry,
        rendererWebEntry,
      },
      environment: {
        node: process.version,
        npm: npmVersion,
        platform: process.platform,
        release: release(),
        arch: process.arch,
        ci: process.env.CI === 'true' || process.env.CI === '1',
        ciProvider: ciProvider(),
        versions: collectVersions(),
      },
      claimScope:
        'bounded compatibility and throughput evidence for the recorded corpus only',
      configuration: {
        candidate: 'gl@9.0.0-rc.10',
        control: 'gl@8.1.6',
        stage: { width: 480, height: 360 },
        rssSampleIntervalMs: 10,
        rssMethod:
          'ps pid/ppid/pgid/rss union of the worker process group and live descendant tree',
        batches: 4,
        warmupCorpusCyclesPerBatch: 2,
        measuredCorpusCyclesPerBatch: 8,
        totalMeasuredCorpusCycles: 32,
        visualRunsPerCorpusCycle: 2,
        plannedLaneOrderByBatch: LANE_ORDER.map((order) => [...order]),
        thresholds: {
          requiredAssertionAgreement: 1,
          collisionStateAgreement: 1,
          supportedCapabilityCoverage: 1,
          medianThroughputRatio: 2,
          p95ThroughputRatio: 1.5,
          peakRssRatio: 1.25,
          macosInstall: 1,
          linuxCiInstall: 1,
          isolationEvidenceParity: 1,
        },
      },
      dependencyAudit: audit,
      installation: {
        hostControl: control.evidence,
        hostCandidate: candidate.evidence,
        linuxCiCandidate: null,
        linuxContainerDiagnostic: null,
      },
      preflight: candidatePreflight(candidate.evidence),
      corpus: { cases: corpusCases, capabilityMatrix: matrix },
      performance: {
        batches,
        playwright,
        headlessGl: null,
        medianThroughputRatio: null,
        p95ThroughputRatio: null,
        peakRssRatio: null,
      },
      gates,
      limitations: [
        'The bounded two-case corpus does not cover every renderer capability, so it cannot establish general visual equivalence.',
        'The prerelease raw context and shimmed bitmap smoke are diagnostics, not a production runtime lane.',
        'Headless throughput and RSS are not measured because clean Scratch renderer integration failed first.',
        'No Linux CI result exists for this source and configuration; local container evidence would not satisfy that gate.',
        'The report rejects promotion when any required gate is failed or not measured; missing metrics are never represented as zero.',
        'The 10 ms external RSS sampler adds some host overhead to absolute timing; a promoted comparison would apply the identical sampler to both lanes.',
        'Aggregate RSS unions the worker process group with its live descendant tree so browser children that change process groups remain counted.',
        ...(sourceLimitation ? [sourceLimitation] : []),
      ],
      decision: {
        experimentStatus,
        recommendation,
        playwrightRemainsProduction: recommendation !== 'promote',
        normalDependencyAdded: audit.normalDependencyAdded,
        reasons,
      },
    }
    const jsonPath = join(runRoot, 'multimodal-renderer-experiment.json')
    const markdownPath = join(runRoot, 'multimodal-renderer-experiment.md')
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    })
    writeFileSync(markdownPath, reportMarkdown(report), { flag: 'wx' })
    console.log(
      `\n${recommendation.toUpperCase()} headless-gl; Playwright remains production`
    )
    for (const entry of gates)
      console.log(`${entry.result.status.toUpperCase()}  ${entry.id}`)
    console.log(`\nreport -> ${markdownPath}`)
  }
  finally
  {
    for (const sandbox of sandboxes)
      rmSync(sandbox, { recursive: true, force: true })
  }
  if (!report || experimentStatus === 'invalid') process.exitCode = 1
}

async function dispatch(): Promise<void>
{
  const args = process.argv.slice(2)
  if (args[0] === '--gl-probe-worker')
  {
    glProbeWorker(cliArgs(args.slice(1)))
    return
  }
  if (args[0] === '--playwright-benchmark-worker')
  {
    await benchmarkWorker(cliArgs(args.slice(1)))
    return
  }
  await experimentMain()
}

dispatch().catch((error: unknown) =>
{
  console.error(error)
  process.exitCode = 1
})
