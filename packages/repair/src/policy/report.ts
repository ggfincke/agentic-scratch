// packages/repair/src/policy/report.ts
// authoritative JSON repair report & escaping-safe Markdown projection

import type {
  ArtifactPreflight,
  BaselineEvaluation,
  CandidatePhaseEvaluation,
  CandidatePipelineEvaluation,
  EvaluatedTest,
  NormalizedFailure,
} from '@scratch-agent/eval'
import type { ProjectDelta, SemanticPatch } from '@scratch-agent/ir'
import type { LocalizationReport } from '@scratch-agent/localize'
import { mdCode } from '@scratch-agent/runner'

import type {
  ArtifactIdentity,
  AttemptRecord,
  AttemptStatus,
  EvidenceBundle,
  RepairAgentDescriptor,
  RepairAgentUsage,
  RepairProposal,
  RepairRequest,
  TerminalRepairStatus,
} from './contracts.js'
import {
  hashJson,
  REPAIR_MULTIMODAL_REQUEST_SCHEMA_VERSION,
  REPAIR_REQUEST_SCHEMA_VERSION,
} from './contracts.js'
import type { RepairPolicy } from './policy.js'
import type {
  RepairMultimodalGateV1,
  RepairMultimodalRequirementV1,
} from '../multimodal/multimodal.js'
import type { AcceptanceContract } from '../benchmark/repair-case.js'
import {
  artifactSafeProjection,
  durableProposalProjection,
} from './redaction.js'

const REPAIR_REPORT_SCHEMA_VERSION = 1 as const
const REPAIR_PROTOCOL_SCHEMA_VERSION = REPAIR_REQUEST_SCHEMA_VERSION
const REPAIR_MULTIMODAL_PROTOCOL_SCHEMA_VERSION =
  REPAIR_MULTIMODAL_REQUEST_SCHEMA_VERSION
const REPAIR_CONTAINMENT_CAVEAT =
  'This run reduces accidental and agent-driven risk, but the in-process Node Scratch VM is not a hostile-code sandbox. It supports repository-generated canonical projects and explicitly selected, size-limited inputs; arbitrary untrusted input requires a separate OS-contained worker.'

interface ContentIdentity
{
  sha256: string
  byteLength: number
}

interface AssetManifestIdentity extends ContentIdentity
{
  path: string
  occurrence: number
}

export interface InputArtifactReport
{
  artifact: ArtifactIdentity
  canonicalProjectJson: ContentIdentity | null
  assetManifest: AssetManifestIdentity[]
}

export interface RepairReplayVersions
{
  node: string
  compiler: string
  ir: string
  eval: string
  localizer: string
  controller: string
  scratchVm: string
  scratchRenderer: string
  scratchParser: string
  playwright: string
  browserExecutable: string | null
  dependencies: Record<string, string>
}

interface RepairTestExecutionSettings
{
  testId: string
  seed: number | null
  fixedDateMs: number | null
  maxTicks: number | null
  allowNetwork: boolean
  allowedOrigins: string[]
}

interface RepairBrowserSettings
{
  enabled: boolean
  recordVideo: boolean
  executable: string | null
  networkAllowed: boolean
  allowedOrigins: string[]
}

interface RepairExecutionSettings
{
  tests: RepairTestExecutionSettings[]
  browser: RepairBrowserSettings
}

interface RepairContractHashes
{
  repairCase: string
  acceptance: string
  policy: string
  proposalSchema: string
  operationSchema: string
  multimodalRequirement?: string
}

interface RepairArtifactPaths
{
  input: string
  baselineEvaluation: string
  acceptedCandidate: string | null
  semanticPatch: string | null
  projectDelta: string | null
  reportJson: string
  reportMarkdown: string
}

export interface AttemptArtifactState
{
  request: string
  proposal: string | null
  candidate: string | null
  delta: string | null
  evaluation: string | null
  preservation: string | null
  screenshots: string
}

interface AttemptRecordProjection
{
  schemaVersion: 1
  attemptId: string
  number: number
  startedAt: string
  completedAt: string
  status: AttemptStatus
  transactionStatus: AttemptRecord['transactionStatus']
  request: RepairRequest
  requestSha256: string
  requestProjectionSha256: string
  evidenceSha256: string
  proposal: RepairProposal | null
  proposalSha256: string | null
  proposalProjectionSha256: string | null
  artifactContentRedacted: boolean
  semanticProposalSha256: string | null
  agent: {
    descriptor: RepairAgentDescriptor | null
    latencyMs: number | null
    usage: RepairAgentUsage | null
  }
  violations: AttemptRecord['violations']
  candidate: ArtifactIdentity | null
  delta: ProjectDelta | null
  preservation: unknown | null
  evaluation: object | null
  multimodal?: RepairMultimodalGateV1 | null
}

interface RepairAttemptReport
{
  record: AttemptRecordProjection
  artifacts: AttemptArtifactState
  gateOrder: Array<'preflight' | 'targeted' | 'regression'>
}

interface RepairBaselineReport
{
  evaluation: object
  failures: NormalizedFailure[]
  failureFingerprints: string[]
  localization: LocalizationReport | null
  evidence: EvidenceBundle
  evidenceSha256: string
  multimodal?: RepairMultimodalGateV1
}

interface RepairBudgetReport
{
  maxAttempts: number
  attemptsReserved: number
  attemptsCompleted: number
  attemptsRemaining: number
  maxOperationsPerProposal: number
  maxTotalProposedOperations: number
  proposedOperations: number
}

export interface RepairGateReport
{
  name: string
  status: 'passed' | 'failed' | 'skipped' | 'stopped'
  attemptNumber: number | null
  detail: string
}

export interface AcceptedRepairReport
{
  artifact: ArtifactIdentity
  semanticPatch: SemanticPatch | null
  delta: ProjectDelta | null
  preservation: unknown | null
  multimodal?: RepairMultimodalGateV1
  exports: Array<{
    sha256: string
    byteLength: number
    recordedAt: string
  }>
  proof: {
    evaluatedArtifactSha256: string
    acceptedCopySha256: string
    acceptedCopyVerified: boolean
    assetsPreserved: boolean
    existingEditorLayoutPreserved: boolean
  }
}

export interface RepairReport
{
  schemaVersion: typeof REPAIR_REPORT_SCHEMA_VERSION
  protocolSchemaVersion:
    | typeof REPAIR_PROTOCOL_SCHEMA_VERSION
    | typeof REPAIR_MULTIMODAL_PROTOCOL_SCHEMA_VERSION
  runId: string
  sessionId: string
  createdAt: string
  completedAt: string | null
  status: TerminalRepairStatus | 'running'
  stopReason: string | null
  sourceRevision: string | null
  repairCase: {
    id: string
    hash: string
    acceptance: AcceptanceContract
    multimodal?: RepairMultimodalRequirementV1
  }
  policy: RepairPolicy
  hashes: RepairContractHashes
  versions: RepairReplayVersions
  execution: RepairExecutionSettings
  input: InputArtifactReport
  baseline: RepairBaselineReport
  attempts: RepairAttemptReport[]
  budget: RepairBudgetReport
  accepted: AcceptedRepairReport | null
  gates: RepairGateReport[]
  artifacts: RepairArtifactPaths
  containment: {
    scope: 'selected-size-limited-input'
    hostileCodeSandbox: false
    caveat: string
  }
}

type RepairReportInput = Omit<
  RepairReport,
  'schemaVersion' | 'protocolSchemaVersion' | 'containment'
>

function jsonProjection<T>(value: T): T
{
  const serialized = JSON.stringify(value)
  if (serialized === undefined)
  {
    throw new TypeError('report value is not serializable JSON')
  }
  return JSON.parse(serialized) as T
}

function evaluatedTestProjection(
  test: EvaluatedTest,
  normalizePath: (path: string) => string
): object
{
  return jsonProjection({
    id: test.id,
    name: test.name,
    role: test.role,
    ok: test.ok,
    failures: test.failures,
    evidenceFailures: test.evidenceFailures,
    issues: test.issues,
    result: {
      name: test.result.name,
      ok: test.result.ok,
      runtime: test.result.runtime,
      snapshots: test.result.snapshots,
      asserts: test.result.asserts,
      visual: test.result.visual,
      screenshots: test.result.screenshots.map((screenshot) => ({
        label: screenshot.label,
        tick: screenshot.tick,
        path: normalizePath(screenshot.path),
      })),
      video:
        test.result.video === null
          ? null
          : normalizePath(test.result.video),
      model: test.result.model,
      issues: test.result.issues,
      errors: test.result.errors,
    },
  })
}

function preflightProjection(preflight: ArtifactPreflight): object
{
  return jsonProjection({
    ok: preflight.ok,
    schema: preflight.schema,
    graph: preflight.graph,
    static: preflight.static,
    diagnosticBaseline: preflight.diagnosticBaseline,
    diagnosticChanges: preflight.diagnosticChanges,
    failures: preflight.failures,
    issues: preflight.issues,
  })
}

function candidatePhaseProjection(
  phase: CandidatePhaseEvaluation | null,
  normalizePath: (path: string) => string
): object | null
{
  if (phase === null) return null
  return jsonProjection({
    status: phase.status,
    ok: phase.ok,
    phase: phase.phase,
    preflight: preflightProjection(phase.preflight),
    tests: phase.tests.map((test) =>
      evaluatedTestProjection(test, normalizePath)
    ),
    failures: phase.failures,
    issues: phase.issues,
  })
}

export function baselineEvaluationProjection(
  evaluation: BaselineEvaluation,
  normalizePath: (path: string) => string
): object
{
  return jsonProjection({
    status: evaluation.status,
    ok: evaluation.ok,
    preflight: preflightProjection(evaluation.preflight),
    tests: evaluation.tests.map((test) =>
      evaluatedTestProjection(test, normalizePath)
    ),
    failingTestIds: evaluation.failingTestIds,
    failures: evaluation.failures,
    issues: evaluation.issues,
    mismatches: evaluation.mismatches,
  })
}

export function candidateEvaluationProjection(
  evaluation: CandidatePipelineEvaluation,
  normalizePath: (path: string) => string
): object
{
  return jsonProjection({
    status: evaluation.status,
    ok: evaluation.ok,
    preflight: preflightProjection(evaluation.preflight),
    targeted: candidatePhaseProjection(evaluation.targeted, normalizePath),
    regression: candidatePhaseProjection(evaluation.regression, normalizePath),
    failures: evaluation.failures,
    issues: evaluation.issues,
  })
}

export function repairRequestProjection(
  request: RepairRequest,
  normalizePath: (path: string) => string
): RepairRequest
{
  return jsonProjection({
    ...request,
    evidence: evidenceProjection(request.evidence, normalizePath),
  })
}

export function evidenceProjection(
  evidence: EvidenceBundle,
  normalizePath: (path: string) => string
): EvidenceBundle
{
  return jsonProjection({
    ...evidence,
    level3: evidence.level3
      ? {
          screenshots: evidence.level3.screenshots.map((screenshot) => ({
            ...screenshot,
            path: normalizePath(screenshot.path),
          })),
        }
      : null,
  })
}

export function createRepairBaselineReport(
  evaluation: BaselineEvaluation,
  localization: LocalizationReport | null,
  evidence: EvidenceBundle,
  normalizePath: (path: string) => string,
  multimodal: RepairMultimodalGateV1 | null = null
): RepairBaselineReport
{
  const portableEvidence = evidenceProjection(evidence, normalizePath)
  const safeEvidence = artifactSafeProjection(portableEvidence).value
  return {
    evaluation: baselineEvaluationProjection(evaluation, normalizePath),
    failures: jsonProjection(evaluation.failures),
    failureFingerprints: evaluation.failures.map(
      (failure) => failure.fingerprint
    ),
    localization: localization ? jsonProjection(localization) : null,
    evidence: safeEvidence,
    evidenceSha256: hashJson(safeEvidence),
    ...(multimodal
      ? { multimodal: artifactSafeProjection(jsonProjection(multimodal)).value }
      : {}),
  }
}

function attemptRecordProjection(
  record: AttemptRecord,
  normalizePath: (path: string) => string
): AttemptRecordProjection
{
  const request = repairRequestProjection(record.request, normalizePath)
  const safeRequest = artifactSafeProjection(request)
  const safeProposal = record.proposal
    ? durableProposalProjection(record.proposal)
    : artifactSafeProjection(null)
  const safeMultimodal = record.multimodal
    ? artifactSafeProjection(record.multimodal)
    : artifactSafeProjection(null)
  return jsonProjection({
    schemaVersion: record.schemaVersion,
    attemptId: record.attemptId,
    number: record.number,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    transactionStatus: record.transactionStatus,
    request: safeRequest.value,
    requestSha256: record.requestSha256,
    requestProjectionSha256: hashJson(safeRequest.value),
    evidenceSha256: hashJson(safeRequest.value.evidence),
    proposal: safeProposal.value,
    proposalSha256: record.proposalSha256,
    proposalProjectionSha256: safeProposal.value
      ? hashJson(safeProposal.value)
      : null,
    artifactContentRedacted:
      safeRequest.redacted || safeProposal.redacted || safeMultimodal.redacted,
    semanticProposalSha256: record.semanticProposalSha256,
    agent: record.agent,
    violations: record.violations,
    candidate: record.candidate
      ? {
          ...record.candidate,
          path: normalizePath(record.candidate.path),
        }
      : null,
    delta: record.delta,
    preservation: record.preservation,
    evaluation: record.evaluation
      ? candidateEvaluationProjection(record.evaluation, normalizePath)
      : null,
    ...(record.multimodal !== undefined
      ? { multimodal: safeMultimodal.value }
      : {}),
  })
}

export function createRepairAttemptReport(
  record: AttemptRecord,
  artifacts: AttemptArtifactState,
  gateOrder: RepairAttemptReport['gateOrder'],
  normalizePath: (path: string) => string
): RepairAttemptReport
{
  return jsonProjection({
    record: attemptRecordProjection(record, normalizePath),
    artifacts: {
      request: normalizePath(artifacts.request),
      proposal: artifacts.proposal
        ? normalizePath(artifacts.proposal)
        : null,
      candidate: artifacts.candidate
        ? normalizePath(artifacts.candidate)
        : null,
      delta: artifacts.delta
        ? normalizePath(artifacts.delta)
        : null,
      evaluation: artifacts.evaluation
        ? normalizePath(artifacts.evaluation)
        : null,
      preservation: artifacts.preservation
        ? normalizePath(artifacts.preservation)
        : null,
      screenshots: normalizePath(artifacts.screenshots),
    },
    gateOrder,
  })
}

export function createRepairReport(input: RepairReportInput): RepairReport
{
  return jsonProjection({
    schemaVersion: REPAIR_REPORT_SCHEMA_VERSION,
    protocolSchemaVersion: input.repairCase.multimodal
      ? REPAIR_MULTIMODAL_PROTOCOL_SCHEMA_VERSION
      : REPAIR_PROTOCOL_SCHEMA_VERSION,
    ...input,
    containment: {
      scope: 'selected-size-limited-input' as const,
      hostileCodeSandbox: false as const,
      caveat: REPAIR_CONTAINMENT_CAVEAT,
    },
  })
}

export function repairReportJson(report: RepairReport): string
{
  return `${JSON.stringify(report, null, 2)}\n`
}

function statusLabel(status: RepairReport['status']): string
{
  if (status === 'running') return 'RUNNING'
  return status === 'repaired' || status === 'already-passing'
    ? 'ACCEPTED'
    : 'STOPPED'
}

function renderFailures(failures: readonly NormalizedFailure[]): string[]
{
  if (failures.length === 0) return ['_none_']
  const shown = failures.slice(0, 12).map((failure) =>
  {
    const message = 'message' in failure ? failure.message : failure.fingerprint
    return `- ${mdCode(failure.kind)} ${mdCode(failure.fingerprint)}: ${mdCode(message)}`
  })
  const omitted = failures.length - shown.length
  if (omitted > 0) shown.push(`- ${mdCode(`${omitted} more in report.json`)}`)
  return shown
}

function renderAttempts(attempts: readonly RepairAttemptReport[]): string[]
{
  if (attempts.length === 0) return ['_none_']
  return attempts.flatMap((attempt) =>
  {
    const record = attempt.record
    const operations = record.proposal?.operations.map((op) => op.kind) ?? []
    const lines = [
      `- attempt ${mdCode(record.number)}: ${mdCode(record.status)}`,
      `  - operations: ${operations.length > 0 ? operations.map(mdCode).join(', ') : mdCode('none')}`,
      `  - evidence level: ${mdCode(record.request.evidence.level)}`,
      `  - candidate: ${mdCode(record.candidate?.path ?? 'none')}`,
    ]
    for (const violation of record.violations.slice(0, 8))
    {
      lines.push(`  - ${mdCode(violation.code)}: ${mdCode(violation.message)}`)
    }
    if (record.violations.length > 8)
    {
      lines.push(
        `  - ${mdCode(`${record.violations.length - 8} more violations in report.json`)}`
      )
    }
    return lines
  })
}

function renderGates(gates: readonly RepairGateReport[]): string[]
{
  if (gates.length === 0) return ['_none_']
  return gates.map(
    (gate) =>
      `- ${mdCode(gate.name)}: ${mdCode(gate.status)} - ${mdCode(gate.detail)}`
  )
}

export function repairReportMarkdown(report: RepairReport): string
{
  const accepted = report.accepted?.artifact
  const lines = [
    '# Scratch repair report',
    '',
    `**${statusLabel(report.status)}**`,
    '',
    '## Run',
    '',
    `- run: ${mdCode(report.runId)}`,
    `- session: ${mdCode(report.sessionId)}`,
    `- created: ${mdCode(report.createdAt)}`,
    `- completed: ${mdCode(report.completedAt ?? 'in progress')}`,
    `- status: ${mdCode(report.status)}`,
    `- stop reason: ${mdCode(report.stopReason ?? 'none')}`,
    `- source revision: ${mdCode(report.sourceRevision ?? 'unknown')}`,
    '',
    '## Registered case',
    '',
    `- id: ${mdCode(report.repairCase.id)}`,
    `- objective: ${mdCode(report.repairCase.acceptance.objective)}`,
    `- case sha256: ${mdCode(report.repairCase.hash)}`,
    '',
    '## Artifacts',
    '',
    `- input: ${mdCode(report.input.artifact.path)}`,
    `- input sha256: ${mdCode(report.input.artifact.sha256)}`,
    `- accepted: ${mdCode(accepted?.path ?? 'none')}`,
    `- accepted sha256: ${mdCode(accepted?.sha256 ?? 'none')}`,
    `- JSON authority: ${mdCode(report.artifacts.reportJson)}`,
    '',
    '## Budget',
    '',
    `- attempts: ${mdCode(`${report.budget.attemptsCompleted}/${report.budget.maxAttempts}`)}`,
    `- attempts remaining: ${mdCode(report.budget.attemptsRemaining)}`,
    `- proposed operations: ${mdCode(`${report.budget.proposedOperations}/${report.budget.maxTotalProposedOperations}`)}`,
    '',
    '## Baseline failures',
    '',
    ...renderFailures(report.baseline.failures),
    '',
    '## Attempts',
    '',
    ...renderAttempts(report.attempts),
    '',
    '## Gates',
    '',
    ...renderGates(report.gates),
    '',
    '## Containment',
    '',
    mdCode(report.containment.caveat),
    '',
  ]
  return `${lines.join('\n')}\n`
}
