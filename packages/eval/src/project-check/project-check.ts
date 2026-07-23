// packages/eval/src/project-check/project-check.ts
// compose selected-project intake, preservation, runtime, visual, & evidence gates

import { basename } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { readFileSync, statSync } from 'node:fs'

import {
  ProjectIR,
  roundTripAdmittedSb3,
  type RoundTripResult,
} from '@scratch-agent/ir'
import {
  browserRuntimeIdentity,
  collectVersions,
  runBrowserScenario,
  runScenario,
  RUNTIME_ID as VM_RUNTIME_ID,
  type BrowserTrace,
  type RunIssue,
  type Scenario,
  type VmTrace,
} from '@scratch-agent/runner'
import {
  admitSb3,
  DEFAULT_SB3_LIMITS,
  isSb3AdmissionError,
  validateAdmittedSb3,
  type ProjectJson,
  type Sb3Admission,
} from '@scratch-agent/sb3'
import { analyzeStatic, type StaticResult } from '@scratch-agent/static'
import {
  countBySeverity,
  validateProject,
  type Diagnostic,
  type ValidateResult as GraphResult,
} from '@scratch-agent/validate'

import { ProjectArtifactStore } from './project-artifacts.js'
import {
  DEFAULT_PROJECT_CHECK_THRESHOLDS,
  PROJECT_CHECK_ISSUE_CODES,
  type ProjectCheckBrowserEvidence,
  type ProjectCheckFileRequest,
  type ProjectCheckGraphEvidence,
  type ProjectCheckIssue,
  type ProjectCheckIssueCode,
  type ProjectCheckPerformance,
  type ProjectCheckPerformanceCheck,
  type ProjectCheckProfile,
  type ProjectCheckReport,
  type ProjectCheckRequest,
  type ProjectCheckResult,
  type ProjectCheckStage,
  type ProjectCheckStageName,
  type ProjectCheckStaticEvidence,
  type ProjectCheckVisualSummary,
  type ProjectCheckVmEvidence,
} from './project-check-contract.js'
import { writeProjectCheckCheckpoint } from './project-check-report.js'
import {
  buildProjectInspectionCatalog,
  type ProjectInspectionCatalog,
} from './project-inspection.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'
import {
  defaultProjectScenario,
  parseProjectScenario,
  ProjectScenarioError,
  type ParsedProjectScenario,
} from './project-scenario.js'
import { regionInkCount } from '../visual/visual-probe.js'

const DIAGNOSTIC_SAMPLE_LIMIT = 20
const ISSUE_SAMPLE_LIMIT = 10
const DIFF_SAMPLE_LIMIT = 20
const TEXT_SAMPLE_BYTES = 500

interface InspectionState
{
  admission: Sb3Admission
  project: ProjectIR
  graph: GraphResult
  statics: StaticResult
  catalog: ProjectInspectionCatalog
}

interface ProjectScenarioRunOptions
{
  lanes: Array<'vm' | 'browser'>
  screenshotDir: string
}

interface ProjectScenarioRunResult
{
  vm: VmTrace | null
  browser: BrowserTrace | null
}

function nowMs(): number
{
  return performance.now()
}

function durationSince(start: number): number
{
  return Math.round((nowMs() - start) * 100) / 100
}

function boundText(value: string, maxBytes = TEXT_SAMPLE_BYTES): string
{
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value
  let result = ''
  let bytes = 0
  for (const character of value)
  {
    const size = Buffer.byteLength(character, 'utf-8')
    if (bytes + size + 3 > maxBytes) break
    result += character
    bytes += size
  }
  return `${result}...`
}

function projectIssue(
  code: ProjectCheckIssueCode,
  message: string,
  stage?: ProjectCheckStageName,
  producerCode?: string
): ProjectCheckIssue
{
  return {
    code,
    message: boundText(message, 1000),
    ...(stage ? { stage } : {}),
    ...(producerCode ? { producerCode } : {}),
  }
}

function notRunStage<T>(
  required: boolean,
  kind: 'not-requested' | 'blocked',
  message: string,
  blockedBy: ProjectCheckStageName[] = []
): ProjectCheckStage<T>
{
  return {
    status: 'not-run',
    required,
    durationMs: null,
    evidence: null,
    issues: [],
    notRunReason: { kind, blockedBy, message },
  }
}

function blankPerformance(): ProjectCheckPerformance
{
  return {
    passed: true,
    totalMs: 0,
    parentProcessPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    memoryScope: 'parent-process-only',
    thresholds: { ...DEFAULT_PROJECT_CHECK_THRESHOLDS },
    checks: [],
  }
}

function initialReport(
  runId: string,
  displayName: string,
  profile: ProjectCheckProfile,
  sourceRevision: string,
  strictStatic: boolean,
  parsedScenario: ParsedProjectScenario
): ProjectCheckReport
{
  const cpu = cpus()
  return {
    schemaVersion: 1,
    runId,
    profile,
    sourceRevision,
    createdAt: new Date().toISOString(),
    completedAt: null,
    input: {
      displayName: boundText(displayName, 256),
      sha256: null,
      byteLength: null,
    },
    options: {
      strictStatic,
      browserRequired: profile === 'full',
      network: 'denied',
      scenario: parsedScenario.summary,
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpu[0]?.model ?? 'unknown',
      logicalCpuCount: cpu.length,
      totalMemoryBytes: totalmem(),
    },
    versions: collectVersions(),
    runtimeIdentity: {
      vm: VM_RUNTIME_ID,
      browser: browserRuntimeIdentity(),
    },
    metrics: null,
    stages: {
      admission: notRunStage(true, 'blocked', 'input has not been admitted'),
      schema: notRunStage(true, 'blocked', 'blocked by admission', [
        'admission',
      ]),
      graph: notRunStage(true, 'blocked', 'blocked by schema', ['schema']),
      static: notRunStage(true, 'blocked', 'blocked by graph index', ['graph']),
      roundTrip: notRunStage(true, 'blocked', 'blocked by IR construction', [
        'schema',
      ]),
      vmSmoke: notRunStage(true, 'blocked', 'blocked by preservation', [
        'schema',
        'graph',
        'roundTrip',
      ]),
      browserSmoke:
        profile === 'full'
          ? notRunStage(true, 'blocked', 'blocked by preservation', [
              'schema',
              'graph',
              'roundTrip',
            ])
          : notRunStage(
              false,
              'not-requested',
              'browser lane is optional in the core profile'
            ),
    },
    performance: blankPerformance(),
    artifacts: [],
    issues: [],
    overall: { status: 'failed', stopReason: null },
    claims: {
      proves: [
        'bounded archive intake and structural diagnostics',
        'exact unmodified project content preservation',
        'bounded startup execution and recorded state',
        'renderer viability when the browser stage passes',
      ],
      doesNotProve: [
        'complete gameplay correctness or behavioral equivalence',
        'correctness of controls, collision, sound, or every game rule',
        'containment of hostile Scratch projects',
      ],
      runtimeContainment: 'in-process-tick-bounded',
      hardKillTimeout: false,
    },
  }
}

function parsedScenario(request: ProjectCheckRequest): ParsedProjectScenario
{
  if (!request.scenario) return defaultProjectScenario()
  return parseProjectScenario({ profile: 'custom', scenario: request.scenario })
}

function boundedDiagnostic(diagnostic: Diagnostic): Diagnostic
{
  return {
    code: boundText(diagnostic.code),
    severity: diagnostic.severity,
    message: boundText(diagnostic.message),
    location: Object.fromEntries(
      Object.entries(diagnostic.location).map(([key, value]) => [
        key,
        boundText(value),
      ])
    ),
  }
}

function diagnosticEvidence(
  diagnostics: Diagnostic[]
): ProjectCheckGraphEvidence
{
  return {
    counts: countBySeverity(diagnostics),
    total: diagnostics.length,
    samples: diagnostics
      .slice(0, DIAGNOSTIC_SAMPLE_LIMIT)
      .map(boundedDiagnostic),
    omitted: Math.max(0, diagnostics.length - DIAGNOSTIC_SAMPLE_LIMIT),
  }
}

function issueSummary(issues: RunIssue[]): {
  count: number
  samples: RunIssue[]
  omitted: number
}
{
  return {
    count: issues.length,
    samples: issues.slice(0, ISSUE_SAMPLE_LIMIT).map((issue) => ({
      ...structuredClone(issue),
      message: boundText(issue.message),
    })),
    omitted: Math.max(0, issues.length - ISSUE_SAMPLE_LIMIT),
  }
}

function roundTripEvidence(result: RoundTripResult)
{
  return {
    semanticJsonEqual: result.semanticJsonEqual,
    projectJsonExact: result.projectJsonExact,
    assetsExact: result.assetsExact,
    contentExact: result.contentExact,
    jsonDiffCount: result.jsonDiffs.length,
    assetDiffCount: result.assetDiffs.length,
    jsonDiffSamples: result.jsonDiffs.slice(0, DIFF_SAMPLE_LIMIT),
    assetDiffSamples: result.assetDiffs.slice(0, DIFF_SAMPLE_LIMIT),
    projectJsonSha256In: result.projectJsonSha256In,
    projectJsonSha256Out: result.projectJsonSha256Out,
    assetManifestSha256In: result.assetManifestSha256In,
    assetManifestSha256Out: result.assetManifestSha256Out,
    bytesIn: result.stats.bytesIn,
    bytesOut: result.stats.bytesOut,
  }
}

function visualSummary(trace: BrowserTrace): ProjectCheckVisualSummary
{
  const observations = trace.snapshots.flatMap((snapshot) =>
    snapshot.visual ? [snapshot.visual] : []
  )
  const visual = observations.at(-1)
  if (!visual)
  {
    return {
      observed: false,
      validGrid: false,
      nonblank: false,
      canvas: null,
      distinctColors: 0,
      visibleSpriteRects: 0,
      inkCells: 0,
      snapshotCount: 0,
    }
  }
  const validGrid =
    visual.canvas.width === 480 &&
    visual.canvas.height === 360 &&
    visual.gridCols > 0 &&
    visual.gridRows > 0 &&
    visual.grid.length === visual.gridCols * visual.gridRows * 3 &&
    visual.grid.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255
    )
  const colors = new Set<string>()
  if (validGrid)
  {
    for (let index = 0; index < visual.grid.length; index += 3)
    {
      colors.add(
        `${visual.grid[index]},${visual.grid[index + 1]},${visual.grid[index + 2]}`
      )
    }
  }
  const visibleSpriteRects = Object.values(visual.spriteRects).filter(
    Boolean
  ).length
  const inkCells = validGrid ? regionInkCount(visual) : 0
  const soleColor = colors.size === 1 ? [...colors][0] : null
  const nonblank =
    validGrid &&
    (colors.size > 1 ||
      visibleSpriteRects > 0 ||
      (soleColor !== null &&
        soleColor !== '0,0,0' &&
        soleColor !== '255,255,255'))
  return {
    observed: true,
    validGrid,
    nonblank,
    canvas: { ...visual.canvas },
    distinctColors: colors.size,
    visibleSpriteRects,
    inkCells,
    snapshotCount: observations.length,
  }
}

function vmEvidence(trace: VmTrace): ProjectCheckVmEvidence
{
  return {
    runtime: trace.runtime,
    snapshotCount: trace.snapshots.length,
    snapshots: trace.snapshots.map((snapshot) => ({
      label: snapshot.label ?? null,
      tick: snapshot.tick,
    })),
    issues: issueSummary(trace.issues),
    runtimeLog: trace.runtimeLog,
  }
}

function browserEvidence(
  trace: BrowserTrace,
  screenshotPaths: string[]
): ProjectCheckBrowserEvidence
{
  return {
    runtime: trace.runtime,
    snapshotCount: trace.snapshots.length,
    snapshots: trace.snapshots.map((snapshot) => ({
      label: snapshot.label ?? null,
      tick: snapshot.tick,
    })),
    screenshotCount: trace.screenshots.length,
    screenshots: screenshotPaths,
    issues: issueSummary(trace.issues),
    console: trace.consoleSummary,
    visual: visualSummary(trace),
  }
}

function performanceChecks(
  report: ProjectCheckReport,
  totalMs: number
): ProjectCheckPerformance
{
  const t = report.performance.thresholds
  const peak = process.resourceUsage().maxRSS * 1024
  const checks: ProjectCheckPerformanceCheck[] = [
    {
      metric: 'total',
      observed: totalMs,
      limit: t.totalMs,
      unit: 'milliseconds',
      passed: totalMs <= t.totalMs,
    },
    {
      metric: 'parent-process-peak-rss',
      observed: peak,
      limit: t.peakRssBytes,
      unit: 'bytes',
      passed: peak <= t.peakRssBytes,
    },
  ]
  const diagnosticsMs =
    (report.stages.schema.durationMs ?? 0) +
    (report.stages.graph.durationMs ?? 0) +
    (report.stages.static.durationMs ?? 0)
  const stageChecks: Array<[string, number | null, number]> = [
    ['admission', report.stages.admission.durationMs, t.admissionMs],
    ['diagnostics', diagnosticsMs, t.diagnosticsMs],
    ['round-trip', report.stages.roundTrip.durationMs, t.roundTripMs],
    ['vm', report.stages.vmSmoke.durationMs, t.vmMs],
    ['browser', report.stages.browserSmoke.durationMs, t.browserMs],
  ]
  for (const [metric, observed, limit] of stageChecks)
  {
    if (observed === null) continue
    checks.push({
      metric,
      observed,
      limit,
      unit: 'milliseconds',
      passed: observed <= limit,
    })
  }
  return {
    passed: checks.every((check) => check.passed),
    totalMs,
    parentProcessPeakRssBytes: peak,
    memoryScope: 'parent-process-only',
    thresholds: { ...t },
    checks,
  }
}

function firstRequiredFailure(
  report: ProjectCheckReport
): ProjectCheckIssue | null
{
  const order: ProjectCheckStageName[] = [
    'admission',
    'schema',
    'graph',
    'static',
    'roundTrip',
    'vmSmoke',
    'browserSmoke',
  ]
  for (const name of order)
  {
    const stage = report.stages[name]
    if (stage.required && stage.status !== 'passed')
    {
      return (
        stage.issues[0] ??
        projectIssue(
          PROJECT_CHECK_ISSUE_CODES.internalFailed,
          stage.notRunReason?.message ?? `${name} did not pass`,
          name
        )
      )
    }
  }
  return report.issues[0] ?? null
}

function finalizeReport(report: ProjectCheckReport, started: number): void
{
  report.completedAt = new Date().toISOString()
  report.performance = performanceChecks(report, durationSince(started))
  if (!report.performance.passed)
  {
    const failed = report.performance.checks.find((check) => !check.passed)!
    report.issues.push(
      projectIssue(
        PROJECT_CHECK_ISSUE_CODES.internalFailed,
        `${failed.metric} ${failed.observed} exceeds ${failed.limit} ${failed.unit}`
      )
    )
  }
  const stopReason = firstRequiredFailure(report)
  report.overall = {
    status:
      stopReason === null && report.issues.length === 0 ? 'passed' : 'failed',
    stopReason,
  }
}

function checkpoint(
  store: ProjectArtifactStore,
  report: ProjectCheckReport
): boolean
{
  try
  {
    writeProjectCheckCheckpoint(store, report)
    return true
  }
  catch (error)
  {
    if (
      !report.issues.some(
        (issue) => issue.code === PROJECT_CHECK_ISSUE_CODES.artifactWriteFailed
      )
    )
    {
      report.issues.push(
        projectIssue(
          PROJECT_CHECK_ISSUE_CODES.artifactWriteFailed,
          unknownErrorMessage(error)
        )
      )
    }
    return false
  }
}

function writeArtifact(report: ProjectCheckReport, work: () => void): boolean
{
  try
  {
    work()
    return true
  }
  catch (error)
  {
    report.issues.push(
      projectIssue(
        PROJECT_CHECK_ISSUE_CODES.artifactWriteFailed,
        unknownErrorMessage(error)
      )
    )
    return false
  }
}

function blockedRuntime(report: ProjectCheckReport): ProjectCheckStageName[]
{
  const blocked: ProjectCheckStageName[] = []
  if (report.stages.schema.status !== 'passed') blocked.push('schema')
  if (
    report.stages.graph.status !== 'passed' ||
    (report.stages.graph.evidence?.counts.error ?? 1) > 0
  )
  {
    blocked.push('graph')
  }
  if (
    report.stages.roundTrip.status !== 'passed' ||
    report.stages.roundTrip.evidence?.contentExact !== true
  )
  {
    blocked.push('roundTrip')
  }
  return blocked
}

function sanitizeBrowserTrace(
  trace: BrowserTrace,
  screenshotPaths: string[]
): BrowserTrace
{
  return {
    ...trace,
    screenshots: trace.screenshots.map((screenshot, index) => ({
      ...screenshot,
      path: screenshotPaths[index] ?? 'browser/screenshots/unknown.png',
    })),
    video: null,
  }
}

export async function runProjectCheckScenario(
  bytes: Uint8Array,
  scenario: Scenario,
  options: ProjectScenarioRunOptions
): Promise<ProjectScenarioRunResult>
{
  let vm: VmTrace | null = null
  let browser: BrowserTrace | null = null
  if (options.lanes.includes('vm')) vm = await runScenario(bytes, scenario)
  if (options.lanes.includes('browser'))
  {
    browser = await runBrowserScenario(bytes, scenario, {
      screenshotDir: options.screenshotDir,
      allowNetwork: false,
    })
  }
  return { vm, browser }
}

export async function runProjectCheck(
  request: ProjectCheckRequest
): Promise<ProjectCheckResult>
{
  const started = nowMs()
  const profile = request.profile ?? 'full'
  const displayName = request.input.displayName ?? 'selected-project.sb3'
  let scenario: ParsedProjectScenario
  try
  {
    scenario = parsedScenario(request)
  }
  catch (error)
  {
    scenario = defaultProjectScenario()
    const report = initialReport(
      request.run.id,
      displayName,
      profile,
      request.run.sourceRevision ?? 'unknown',
      request.strictStatic ?? false,
      scenario
    )
    report.input.byteLength = request.input.bytes.byteLength
    report.issues.push(
      projectIssue(
        PROJECT_CHECK_ISSUE_CODES.internalFailed,
        unknownErrorMessage(error),
        undefined,
        error instanceof ProjectScenarioError ? error.code : undefined
      )
    )
    finalizeReport(report, started)
    try
    {
      const store = new ProjectArtifactStore(request.run.root)
      checkpoint(store, report)
    }
    catch
    {
      // the in-memory report still carries the artifact-write failure
    }
    return { report, runRoot: request.run.root }
  }

  const report = initialReport(
    request.run.id,
    displayName,
    profile,
    request.run.sourceRevision ?? 'unknown',
    request.strictStatic ?? false,
    scenario
  )
  report.input.byteLength = request.input.bytes.byteLength
  let store: ProjectArtifactStore
  try
  {
    store = new ProjectArtifactStore(request.run.root)
  }
  catch (error)
  {
    report.issues.push(
      projectIssue(
        PROJECT_CHECK_ISSUE_CODES.artifactWriteFailed,
        unknownErrorMessage(error)
      )
    )
    finalizeReport(report, started)
    return { report, runRoot: request.run.root }
  }
  checkpoint(store, report)

  let inspection: InspectionState | null = null
  let parsedJson: ProjectJson | null = null
  let admission: Sb3Admission | null = null
  const admissionStart = nowMs()
  try
  {
    admission = await admitSb3(request.input.bytes)
    report.input.sha256 = admission.metrics.sha256
    report.stages.admission = {
      status: 'passed',
      required: true,
      durationMs: durationSince(admissionStart),
      evidence: {
        metrics: admission.metrics,
        limits: admission.limits,
      },
      issues: [],
      notRunReason: null,
    }
    writeArtifact(report, () =>
      store.writeJson('input-identity.json', 'input-identity', {
        schemaVersion: 1,
        displayName: report.input.displayName,
        sha256: report.input.sha256,
        byteLength: report.input.byteLength,
      })
    )
  }
  catch (error)
  {
    const issue = projectIssue(
      PROJECT_CHECK_ISSUE_CODES.admissionFailed,
      unknownErrorMessage(error),
      'admission',
      isSb3AdmissionError(error) ? error.code : undefined
    )
    if (isSb3AdmissionError(error))
    {
      report.input.sha256 = error.metrics.sha256 ?? null
    }
    report.stages.admission = {
      status: 'failed',
      required: true,
      durationMs: durationSince(admissionStart),
      evidence: null,
      issues: [issue],
      notRunReason: null,
    }
    report.issues.push(issue)
    writeArtifact(report, () =>
      store.writeJson('input-identity.json', 'input-identity', {
        schemaVersion: 1,
        displayName: report.input.displayName,
        sha256: report.input.sha256,
        byteLength: report.input.byteLength,
      })
    )
    finalizeReport(report, started)
    checkpoint(store, report)
    return { report, runRoot: store.root }
  }
  checkpoint(store, report)

  try
  {
    parsedJson = JSON.parse(admission.projectJsonText) as ProjectJson
  }
  catch (error)
  {
    const issue = projectIssue(
      PROJECT_CHECK_ISSUE_CODES.projectJsonInvalid,
      unknownErrorMessage(error),
      'schema'
    )
    report.stages.schema = {
      status: 'failed',
      required: true,
      durationMs: 0,
      evidence: {
        projectVersion: 0,
        errorCount: 1,
        errorSamples: [issue.message],
        omitted: 0,
      },
      issues: [issue],
      notRunReason: null,
    }
    report.issues.push(issue)
  }

  if (parsedJson)
  {
    const schemaStart = nowMs()
    try
    {
      const schemaResult = await validateAdmittedSb3(request.input.bytes)
      const issue = schemaResult.ok
        ? null
        : projectIssue(
            PROJECT_CHECK_ISSUE_CODES.schemaFailed,
            schemaResult.errors[0] ?? 'Scratch schema validation failed',
            'schema'
          )
      report.stages.schema = {
        status: schemaResult.ok ? 'passed' : 'failed',
        required: true,
        durationMs: durationSince(schemaStart),
        evidence: {
          projectVersion: schemaResult.projectVersion,
          errorCount: schemaResult.errors.length,
          errorSamples: schemaResult.errors
            .slice(0, DIAGNOSTIC_SAMPLE_LIMIT)
            .map((message) => boundText(message)),
          omitted: Math.max(
            0,
            schemaResult.errors.length - DIAGNOSTIC_SAMPLE_LIMIT
          ),
        },
        issues: issue ? [issue] : [],
        notRunReason: null,
      }
      if (issue) report.issues.push(issue)
    }
    catch (error)
    {
      const issue = projectIssue(
        PROJECT_CHECK_ISSUE_CODES.internalFailed,
        unknownErrorMessage(error),
        'schema'
      )
      report.stages.schema = {
        status: 'failed',
        required: true,
        durationMs: durationSince(schemaStart),
        evidence: null,
        issues: [issue],
        notRunReason: null,
      }
      report.issues.push(issue)
    }
  }
  checkpoint(store, report)

  if (parsedJson && report.stages.schema.status === 'passed')
  {
    const graphStart = nowMs()
    let project: ProjectIR | null = null
    let graph: GraphResult | null = null
    try
    {
      project = ProjectIR.fromProjectJson(parsedJson, admission.assets)
      graph = validateProject(project)
      const graphEvidence = diagnosticEvidence(graph.diagnostics)
      const graphIssue =
        graph.counts.error > 0
          ? projectIssue(
              PROJECT_CHECK_ISSUE_CODES.graphFailed,
              `graph validation found ${graph.counts.error} errors`,
              'graph'
            )
          : null
      report.stages.graph = {
        status: graphIssue ? 'failed' : 'passed',
        required: true,
        durationMs: durationSince(graphStart),
        evidence: graphEvidence,
        issues: graphIssue ? [graphIssue] : [],
        notRunReason: null,
      }
      if (graphIssue) report.issues.push(graphIssue)
    }
    catch (error)
    {
      const issue = projectIssue(
        PROJECT_CHECK_ISSUE_CODES.internalFailed,
        unknownErrorMessage(error),
        'graph'
      )
      report.stages.graph = {
        status: 'failed',
        required: true,
        durationMs: durationSince(graphStart),
        evidence: null,
        issues: [issue],
        notRunReason: null,
      }
      report.issues.push(issue)
    }

    if (project && graph)
    {
      const staticStart = nowMs()
      let statics: StaticResult | null = null
      try
      {
        statics = analyzeStatic(project.toProjectJson(), graph.index)
        const staticSummary = diagnosticEvidence(statics.diagnostics)
        const strictFailure =
          (request.strictStatic ?? false) &&
          (staticSummary.counts.warning > 0 || staticSummary.counts.error > 0)
        const staticIssue = strictFailure
          ? projectIssue(
              PROJECT_CHECK_ISSUE_CODES.staticStrictFailed,
              `strict static policy found ${staticSummary.counts.error} errors and ${staticSummary.counts.warning} warnings`,
              'static'
            )
          : null
        const staticEvidence: ProjectCheckStaticEvidence = {
          ...staticSummary,
          strict: request.strictStatic ?? false,
        }
        report.stages.static = {
          status: staticIssue ? 'failed' : 'passed',
          required: true,
          durationMs: durationSince(staticStart),
          evidence: staticEvidence,
          issues: staticIssue ? [staticIssue] : [],
          notRunReason: null,
        }
        if (staticIssue) report.issues.push(staticIssue)
        report.metrics = statics.metrics
      }
      catch (error)
      {
        const issue = projectIssue(
          PROJECT_CHECK_ISSUE_CODES.internalFailed,
          unknownErrorMessage(error),
          'static'
        )
        report.stages.static = {
          status: 'failed',
          required: true,
          durationMs: durationSince(staticStart),
          evidence: null,
          issues: [issue],
          notRunReason: null,
        }
        report.issues.push(issue)
      }

      if (statics)
      {
        try
        {
          const catalog = buildProjectInspectionCatalog(
            project.toProjectJson(),
            {
              schema: report.stages.schema.evidence?.errorSamples ?? [],
              graph: graph.diagnostics,
              static: statics.diagnostics,
            }
          )
          inspection = { admission, project, graph, statics, catalog }
          writeArtifact(report, () =>
            store.writeJson('analysis/metrics.json', 'project-metrics', {
              schemaVersion: 1,
              metrics: statics.metrics,
            })
          )
          writeArtifact(report, () =>
            store.writeJson('analysis/diagnostics.json', 'diagnostics', {
              schemaVersion: 1,
              schema: report.stages.schema.evidence,
              graph: graph.diagnostics,
              static: statics.diagnostics,
            })
          )
          writeArtifact(report, () =>
            store.writeJson(
              'analysis/catalog.json',
              'inspection-catalog',
              catalog
            )
          )
        }
        catch (error)
        {
          const issue = projectIssue(
            PROJECT_CHECK_ISSUE_CODES.internalFailed,
            `inspection catalog failed: ${unknownErrorMessage(error)}`,
            'static'
          )
          report.stages.static = {
            ...report.stages.static,
            status: 'failed',
            issues: [...report.stages.static.issues, issue],
          }
          report.issues.push(issue)
        }
      }
    }
  }
  checkpoint(store, report)

  let candidate: Uint8Array | null = null
  if (inspection)
  {
    const roundTripStart = nowMs()
    try
    {
      const artifact = await roundTripAdmittedSb3(
        request.input.bytes,
        inspection.admission
      )
      candidate = artifact.outputBytes
      const evidence = roundTripEvidence(artifact.result)
      const issue = evidence.contentExact
        ? null
        : projectIssue(
            PROJECT_CHECK_ISSUE_CODES.roundTripFailed,
            `round-trip changed project content: ${evidence.jsonDiffCount} JSON diffs, ${evidence.assetDiffCount} asset diffs`,
            'roundTrip'
          )
      report.stages.roundTrip = {
        status: issue ? 'failed' : 'passed',
        required: true,
        durationMs: durationSince(roundTripStart),
        evidence,
        issues: issue ? [issue] : [],
        notRunReason: null,
      }
      if (issue) report.issues.push(issue)
      writeArtifact(report, () =>
        store.writeBytes(
          'roundtrip/candidate.sb3',
          'roundtrip-candidate',
          'application/x.scratch.sb3',
          artifact.outputBytes
        )
      )
      writeArtifact(report, () =>
        store.writeJson(
          'roundtrip/comparison.json',
          'roundtrip-comparison',
          artifact.result
        )
      )
    }
    catch (error)
    {
      const issue = projectIssue(
        PROJECT_CHECK_ISSUE_CODES.roundTripFailed,
        unknownErrorMessage(error),
        'roundTrip'
      )
      report.stages.roundTrip = {
        status: 'failed',
        required: true,
        durationMs: durationSince(roundTripStart),
        evidence: null,
        issues: [issue],
        notRunReason: null,
      }
      report.issues.push(issue)
    }
  }
  checkpoint(store, report)

  const runtimeBlockers = blockedRuntime(report)
  if (candidate && runtimeBlockers.length === 0)
  {
    const vmStart = nowMs()
    const vm = await runScenario(candidate, scenario.scenario)
    const evidence = vmEvidence(vm)
    const completeSnapshots =
      evidence.snapshotCount === scenario.summary.snapshotCount
    const issue =
      vm.ok && completeSnapshots
        ? null
        : projectIssue(
            PROJECT_CHECK_ISSUE_CODES.vmFailed,
            vm.errors[0] ??
              `VM recorded ${evidence.snapshotCount} of ${scenario.summary.snapshotCount} snapshots`,
            'vmSmoke',
            vm.issues[0]?.code
          )
    report.stages.vmSmoke = {
      status: issue ? 'failed' : 'passed',
      required: true,
      durationMs: durationSince(vmStart),
      evidence,
      issues: issue ? [issue] : [],
      notRunReason: null,
    }
    if (issue) report.issues.push(issue)
    writeArtifact(report, () =>
      store.writeJson('vm/trace.json', 'vm-trace', vm)
    )
    writeArtifact(report, () =>
      store.writeJson('vm/runtime-log.json', 'vm-runtime-log', vm.runtimeLog)
    )

    if (profile === 'full')
    {
      const browserStart = nowMs()
      const screenshotDir = store.absolutePath('browser/screenshots')
      const browser = await runBrowserScenario(candidate, scenario.scenario, {
        screenshotDir,
        allowNetwork: false,
      })
      const screenshotPaths = browser.screenshots.map(
        (screenshot) => `browser/screenshots/${basename(screenshot.path)}`
      )
      for (const [index, screenshot] of browser.screenshots.entries())
      {
        const relativePath = screenshotPaths[index]!
        writeArtifact(report, () =>
          store.writeBytes(
            relativePath,
            'browser-screenshot',
            'image/png',
            readFileSync(screenshot.path)
          )
        )
      }
      const evidence = browserEvidence(browser, screenshotPaths)
      const complete =
        browser.ok &&
        evidence.snapshotCount === scenario.summary.snapshotCount &&
        evidence.screenshotCount === scenario.summary.snapshotCount
      let issue: ProjectCheckIssue | null = null
      if (!complete)
      {
        issue = projectIssue(
          PROJECT_CHECK_ISSUE_CODES.browserFailed,
          browser.errors[0] ??
            `browser recorded ${evidence.snapshotCount} snapshots and ${evidence.screenshotCount} screenshots`,
          'browserSmoke',
          browser.issues[0]?.code
        )
      }
      else if (!evidence.visual.nonblank)
      {
        issue = projectIssue(
          PROJECT_CHECK_ISSUE_CODES.browserBlank,
          'browser returned no visual content in its valid 480x360 sampled stage frame',
          'browserSmoke'
        )
      }
      report.stages.browserSmoke = {
        status: issue ? 'failed' : 'passed',
        required: true,
        durationMs: durationSince(browserStart),
        evidence,
        issues: issue ? [issue] : [],
        notRunReason: null,
      }
      if (issue) report.issues.push(issue)
      const safeTrace = sanitizeBrowserTrace(browser, screenshotPaths)
      writeArtifact(report, () =>
        store.writeJson('browser/trace.json', 'browser-trace', safeTrace)
      )
      writeArtifact(report, () =>
        store.writeText(
          'browser/console.log',
          'browser-console',
          'text/plain; charset=utf-8',
          browser.consoleLog.join('\n') +
            (browser.consoleLog.length ? '\n' : '')
        )
      )
      writeArtifact(report, () =>
        store.writeJson(
          'browser/console-summary.json',
          'browser-console-summary',
          browser.consoleSummary
        )
      )
    }
  }
  else
  {
    report.stages.vmSmoke = notRunStage(
      true,
      'blocked',
      'runtime execution requires valid schema, zero graph errors, and exact preservation',
      runtimeBlockers
    )
    if (profile === 'full')
    {
      report.stages.browserSmoke = notRunStage(
        true,
        'blocked',
        'browser execution requires valid schema, zero graph errors, and exact preservation',
        runtimeBlockers
      )
    }
  }

  finalizeReport(report, started)
  checkpoint(store, report)
  return { report, runRoot: store.root }
}

export async function runProjectCheckFile(
  request: ProjectCheckFileRequest
): Promise<ProjectCheckResult>
{
  let bytes: Uint8Array
  try
  {
    const stat = statSync(request.inputPath)
    if (!stat.isFile()) throw new Error('selected input is not a regular file')
    if (stat.size > DEFAULT_SB3_LIMITS.maxCompressedBytes)
    {
      throw new Error(
        `selected input exceeds ${DEFAULT_SB3_LIMITS.maxCompressedBytes} bytes`
      )
    }
    bytes = readFileSync(request.inputPath)
  }
  catch (error)
  {
    const started = nowMs()
    const scenario = defaultProjectScenario()
    const report = initialReport(
      request.run.id,
      basename(request.inputPath),
      request.profile ?? 'full',
      request.run.sourceRevision ?? 'unknown',
      request.strictStatic ?? false,
      scenario
    )
    const issue = projectIssue(
      PROJECT_CHECK_ISSUE_CODES.inputReadFailed,
      unknownErrorMessage(error)
    )
    report.issues.push(issue)
    finalizeReport(report, started)
    try
    {
      const store = new ProjectArtifactStore(request.run.root)
      checkpoint(store, report)
      return { report, runRoot: store.root }
    }
    catch
    {
      return { report, runRoot: request.run.root }
    }
  }
  const { inputPath, ...checkRequest } = request
  return runProjectCheck({
    ...checkRequest,
    input: { bytes, displayName: basename(inputPath) },
  })
}
