// packages/eval/src/project-check/project-check-contract.ts
// public report, stage, evidence, threshold, & request contracts for project checks

import type {
  BrowserConsoleSummary,
  RunIssue,
  RuntimeLogSummary,
  RunVersions,
  Scenario,
} from '@scratch-agent/runner'
import type { Sb3AdmissionMetrics, Sb3Limits } from '@scratch-agent/sb3'
import type { StaticMetrics } from '@scratch-agent/static'
import type { Diagnostic, DiagnosticCounts } from '@scratch-agent/validate'

import type { ProjectArtifactReference } from './project-artifacts.js'
import type { ProjectScenarioSummary } from './project-scenario.js'

export const PROJECT_CHECK_ISSUE_CODES = {
  inputReadFailed: 'PROJECT_CHECK_INPUT_READ_FAILED',
  admissionFailed: 'PROJECT_CHECK_ADMISSION_FAILED',
  projectJsonInvalid: 'PROJECT_CHECK_PROJECT_JSON_INVALID',
  schemaFailed: 'PROJECT_CHECK_SCHEMA_FAILED',
  graphFailed: 'PROJECT_CHECK_GRAPH_FAILED',
  staticStrictFailed: 'PROJECT_CHECK_STATIC_STRICT_FAILED',
  roundTripFailed: 'PROJECT_CHECK_ROUND_TRIP_FAILED',
  vmFailed: 'PROJECT_CHECK_VM_FAILED',
  browserFailed: 'PROJECT_CHECK_BROWSER_FAILED',
  browserBlank: 'PROJECT_CHECK_BROWSER_BLANK',
  artifactWriteFailed: 'PROJECT_CHECK_ARTIFACT_WRITE_FAILED',
  internalFailed: 'PROJECT_CHECK_INTERNAL_FAILED',
} as const

export type ProjectCheckIssueCode =
  (typeof PROJECT_CHECK_ISSUE_CODES)[keyof typeof PROJECT_CHECK_ISSUE_CODES]

export type ProjectCheckProfile = 'core' | 'full'
export type ProjectCheckStageStatus = 'not-run' | 'passed' | 'failed'
export type ProjectCheckStageName =
  | 'admission'
  | 'schema'
  | 'graph'
  | 'static'
  | 'roundTrip'
  | 'vmSmoke'
  | 'browserSmoke'

export interface ProjectCheckIssue
{
  code: ProjectCheckIssueCode
  message: string
  stage?: ProjectCheckStageName
  producerCode?: string
}

interface ProjectCheckNotRunReason
{
  kind: 'not-requested' | 'blocked'
  blockedBy: ProjectCheckStageName[]
  message: string
}

export interface ProjectCheckStage<T>
{
  status: ProjectCheckStageStatus
  required: boolean
  durationMs: number | null
  evidence: T | null
  issues: ProjectCheckIssue[]
  notRunReason: ProjectCheckNotRunReason | null
}

interface ProjectDiagnosticSummary
{
  counts: DiagnosticCounts
  total: number
  samples: Diagnostic[]
  omitted: number
}

interface ProjectCheckAdmissionEvidence
{
  metrics: Sb3AdmissionMetrics
  limits: Sb3Limits
}

interface ProjectCheckSchemaEvidence
{
  projectVersion: number
  errorCount: number
  errorSamples: string[]
  omitted: number
}

export type ProjectCheckGraphEvidence = ProjectDiagnosticSummary

export interface ProjectCheckStaticEvidence extends ProjectDiagnosticSummary
{
  strict: boolean
}

interface ProjectCheckRoundTripEvidence
{
  semanticJsonEqual: boolean
  projectJsonExact: boolean
  assetsExact: boolean
  contentExact: boolean
  jsonDiffCount: number
  assetDiffCount: number
  jsonDiffSamples: unknown[]
  assetDiffSamples: unknown[]
  projectJsonSha256In: string
  projectJsonSha256Out: string
  assetManifestSha256In: string
  assetManifestSha256Out: string
  bytesIn: number
  bytesOut: number
}

interface ProjectCheckIssueSummary
{
  count: number
  samples: RunIssue[]
  omitted: number
}

export interface ProjectCheckVmEvidence
{
  runtime: string
  snapshotCount: number
  snapshots: Array<{ label: string | null; tick: number }>
  issues: ProjectCheckIssueSummary
  runtimeLog: RuntimeLogSummary
}

export interface ProjectCheckVisualSummary
{
  observed: boolean
  validGrid: boolean
  nonblank: boolean
  canvas: { width: number; height: number } | null
  distinctColors: number
  visibleSpriteRects: number
  inkCells: number
  snapshotCount: number
}

export interface ProjectCheckBrowserEvidence
{
  runtime: string
  snapshotCount: number
  snapshots: Array<{ label: string | null; tick: number }>
  screenshotCount: number
  screenshots: string[]
  issues: ProjectCheckIssueSummary
  console: BrowserConsoleSummary
  visual: ProjectCheckVisualSummary
}

export interface ProjectCheckStages
{
  admission: ProjectCheckStage<ProjectCheckAdmissionEvidence>
  schema: ProjectCheckStage<ProjectCheckSchemaEvidence>
  graph: ProjectCheckStage<ProjectCheckGraphEvidence>
  static: ProjectCheckStage<ProjectCheckStaticEvidence>
  roundTrip: ProjectCheckStage<ProjectCheckRoundTripEvidence>
  vmSmoke: ProjectCheckStage<ProjectCheckVmEvidence>
  browserSmoke: ProjectCheckStage<ProjectCheckBrowserEvidence>
}

interface ProjectCheckPerformanceThresholds
{
  totalMs: number
  peakRssBytes: number
  admissionMs: number
  diagnosticsMs: number
  roundTripMs: number
  vmMs: number
  browserMs: number
}

export interface ProjectCheckPerformanceCheck
{
  metric: string
  observed: number
  limit: number
  unit: 'milliseconds' | 'bytes'
  passed: boolean
}

export interface ProjectCheckPerformance
{
  passed: boolean
  totalMs: number
  parentProcessPeakRssBytes: number
  memoryScope: 'parent-process-only'
  thresholds: ProjectCheckPerformanceThresholds
  checks: ProjectCheckPerformanceCheck[]
}

export interface ProjectCheckReport
{
  schemaVersion: 1
  runId: string
  profile: ProjectCheckProfile
  sourceRevision: string
  createdAt: string
  completedAt: string | null
  input: {
    displayName: string
    sha256: string | null
    byteLength: number | null
  }
  options: {
    strictStatic: boolean
    browserRequired: boolean
    network: 'denied'
    scenario: ProjectScenarioSummary
  }
  host: {
    platform: string
    architecture: string
    cpuModel: string
    logicalCpuCount: number
    totalMemoryBytes: number
  }
  versions: RunVersions
  runtimeIdentity: {
    vm: string
    browser: string
  }
  metrics: StaticMetrics | null
  stages: ProjectCheckStages
  performance: ProjectCheckPerformance
  artifacts: ProjectArtifactReference[]
  issues: ProjectCheckIssue[]
  overall: {
    status: 'passed' | 'failed'
    stopReason: ProjectCheckIssue | null
  }
  claims: {
    proves: string[]
    doesNotProve: string[]
    runtimeContainment: 'in-process-tick-bounded'
    hardKillTimeout: false
  }
}

export interface ProjectCheckRequest
{
  input: {
    bytes: Uint8Array
    displayName?: string
  }
  run: {
    id: string
    root: string
    sourceRevision?: string
  }
  profile?: ProjectCheckProfile
  scenario?: Scenario
  strictStatic?: boolean
}

export interface ProjectCheckFileRequest extends Omit<
  ProjectCheckRequest,
  'input'
>
{
  inputPath: string
}

export interface ProjectCheckResult
{
  report: ProjectCheckReport
  runRoot: string
}

export const DEFAULT_PROJECT_CHECK_THRESHOLDS: Readonly<ProjectCheckPerformanceThresholds> =
  Object.freeze({
    totalMs: 30_000,
    peakRssBytes: 1.5 * 1024 * 1024 * 1024,
    admissionMs: 5_000,
    diagnosticsMs: 5_000,
    roundTripMs: 10_000,
    vmMs: 5_000,
    browserMs: 15_000,
  })
