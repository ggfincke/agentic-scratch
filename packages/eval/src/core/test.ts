// packages/eval/src/core/test.ts
// a VM test case: build the project, drive the scenario, judge the assertions

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectIR } from '@scratch-agent/ir'
import {
  ModelChecker,
  MODEL_EVALUATION_UNSUPPORTED_CODE_V1,
  type LoadedModels,
  type ModelRunResult,
} from '@scratch-agent/model'
import type {
  DiagnosticVideoRef,
  RunIssue,
  Scenario,
  ScreenshotRef,
  VmStateSnapshot,
} from '@scratch-agent/runner'
import {
  createRunIssue,
  deriveDiagnosticVideoFromScreenshots,
  RUN_ISSUE_CODES,
  isRunnerIssueError,
  runBrowserScenario,
  runIssueMessages,
  runScenario,
} from '@scratch-agent/runner'

import type { AssertResult, Assertion } from './assert.js'
import { evaluate } from './evaluate.js'

export interface TestSpec
{
  name: string
  scenario: Scenario
  asserts: Assertion[]
  // optional renderer-backed assertions run against the browser lane on the same scenario
  visual?: Assertion[]
  // optional model-based oracle: program/end models checked in lockstep on the same vm run
  model?: LoadedModels
}

export interface TestCase extends TestSpec
{
  project: ProjectIR
}

export interface TestResult
{
  name: string
  ok: boolean
  runtime: string
  snapshots: VmStateSnapshot[]
  asserts: AssertResult[]
  visual: AssertResult[]
  screenshots: ScreenshotRef[]
  // present only on failure; derived from captured PNGs, never authoritative evidence
  diagnosticVideo: DiagnosticVideoRef | null
  // model-run result when the case carries models, else null
  model: ModelRunResult | null
  issues: LaneRunIssue[]
  errors: string[]
}

export interface LaneRunIssue
{
  lane: 'vm' | 'browser'
  issue: RunIssue
}

export interface RunOptions
{
  // exact packaged artifact to execute instead of repackaging the bound IR
  artifactBytes?: Uint8Array
  // root dir for browser screenshot artifacts; each test gets a sub-directory
  artifactDir?: string
}

// a filesystem-safe, collision-resistant per-test dir name (slug + a stable hash of the name)
function safeName(name: string): string
{
  const slug = name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)
  let h = 5381
  for (let i = 0; i < name.length; i++)
  {
    h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  }
  return `${slug}-${h.toString(36)}`
}

function failedTestResult(name: string, issue: RunIssue): TestResult
{
  return {
    name,
    ok: false,
    runtime: 'not-started',
    snapshots: [],
    asserts: [],
    visual: [],
    screenshots: [],
    diagnosticVideo: null,
    model: null,
    issues: [{ lane: 'vm', issue }],
    errors: runIssueMessages([issue]),
  }
}

export async function runTest(
  tc: TestCase,
  options: RunOptions = {}
): Promise<TestResult>
{
  // a model rides the same vm run as the asserts: one pass drives both oracles
  let checker: ModelChecker | undefined
  try
  {
    checker = tc.model
      ? new ModelChecker(tc.model, { seed: tc.scenario.seed })
      : undefined
  }
  catch (error)
  {
    if (
      !isRunnerIssueError(error) ||
      error.issue.code !== MODEL_EVALUATION_UNSUPPORTED_CODE_V1
    )
    {
      throw error
    }
    return failedTestResult(tc.name, error.issue)
  }
  const sb3 = options.artifactBytes ?? (await tc.project.toSb3())
  const trace = await runScenario(sb3, tc.scenario, { observer: checker })
  const asserts = trace.issues.length === 0 ? evaluate(trace, tc.asserts) : []
  const model = checker ? checker.results() : null
  const issues: LaneRunIssue[] = trace.issues.map((issue) => ({
    lane: 'vm',
    issue,
  }))

  let visual: AssertResult[] = []
  let screenshots: ScreenshotRef[] = []
  let diagnosticVideo: DiagnosticVideoRef | null = null
  let runtime = trace.runtime
  const vmStopsEvaluation = trace.issues.some(
    (issue) => issue.responsibility !== 'project'
  )
  // a caller-supplied artifactDir persists; an omitted one gets an ephemeral temp dir we own
  let ephemeralDir: string | null = null
  let browserArtifactDir: string | null = null

  if (tc.visual && tc.visual.length > 0 && !vmStopsEvaluation)
  {
    const dir = options.artifactDir
      ? join(options.artifactDir, safeName(tc.name))
      : (ephemeralDir = mkdtempSync(join(tmpdir(), 'vistest-')))
    browserArtifactDir = dir
    const bt = await runBrowserScenario(sb3, tc.scenario, {
      screenshotDir: dir,
      allowNetwork: tc.scenario.allowNetwork,
      allowedOrigins: tc.scenario.allowedOrigins,
    })
    const snapshotByLabel = new Map(
      bt.snapshots
        .filter((snapshot) => snapshot.label !== undefined)
        .map((snapshot) => [snapshot.label!, snapshot])
    )
    const missingVisualLabel =
      bt.issues.length === 0
        ? tc.visual.find(
            (assertion) =>
              snapshotByLabel.get(assertion.at)?.visual === undefined
          )?.at
        : undefined
    if (missingVisualLabel !== undefined)
    {
      const issue = createRunIssue({
        code: RUN_ISSUE_CODES.browserSnapshotFailed,
        kind: 'internal',
        responsibility: 'infrastructure',
        message: `browser trace lacks visual observation for snapshot "${missingVisualLabel}"`,
      })
      issues.push({ lane: 'browser', issue })
    }
    visual =
      bt.issues.length === 0 && missingVisualLabel === undefined
        ? evaluate(bt, tc.visual)
        : []
    screenshots = bt.screenshots
    diagnosticVideo = bt.diagnosticVideo
    runtime = `${trace.runtime} + ${bt.runtime}`
    issues.push(
      ...bt.issues.map((issue) => ({ lane: 'browser' as const, issue }))
    )
  }

  const modelOk = model ? model.ok : true
  const ok =
    issues.length === 0 &&
    asserts.every((a) => a.ok) &&
    visual.every((a) => a.ok) &&
    modelOk
  if (!ok && !diagnosticVideo && browserArtifactDir)
  {
    diagnosticVideo = await deriveDiagnosticVideoFromScreenshots(
      browserArtifactDir,
      screenshots
    )
  }
  if (ok && ephemeralDir)
  {
    // artifacts are kept only on failure; a passing run discards its temp dir entirely
    try
    {
      rmSync(ephemeralDir, { recursive: true, force: true })
    }
    catch
    {
      // a leftover temp dir is harmless; never fail the test on cleanup
    }
    screenshots = []
    diagnosticVideo = null
  }
  return {
    name: tc.name,
    ok,
    runtime,
    snapshots: trace.snapshots,
    asserts,
    visual,
    screenshots,
    diagnosticVideo,
    model,
    issues,
    errors: runIssueMessages(issues.map((tagged) => tagged.issue)),
  }
}

export interface SuiteResult
{
  ok: boolean
  total: number
  passed: number
  failed: number
  results: TestResult[]
}

export async function runSuite(
  cases: TestCase[],
  options: RunOptions = {}
): Promise<SuiteResult>
{
  const results: TestResult[] = []
  for (const tc of cases) results.push(await runTest(tc, options))
  const passed = results.filter((r) => r.ok).length
  return {
    ok: results.every((r) => r.ok),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  }
}
