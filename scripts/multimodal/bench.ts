// scripts/multimodal/bench.ts
// run the authoritative deterministic Multimodal acceptance corpus

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  InMemoryVlmReplayStore,
  MAX_MULTIMODAL_JSON_BYTES,
  MULTIMODAL_SCHEMA_VERSION,
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  ScriptedFakeVlmAdapter,
  createVlmBudgetState,
  evaluateBehavioralDifferential,
  evaluateMultimodal,
  executeLiveVlmEvaluation,
  hashMultimodalJson,
  multimodalReportJson,
  multimodalReportMarkdown,
  prepareVlmRequest,
  runCheapRuntimeDifferential,
  type BehavioralLensSpecV1,
  type BehavioralTrace,
  type DeterministicCriterionResult,
  type DifferentialReportV1,
  type LensResultV1,
  type MultimodalCriterionEvidenceV1,
  type MultimodalEvaluationIssueV1,
  type MultimodalEvaluationReportV1,
  type MultimodalEvaluationRequest,
  type MultimodalVlmPolicyV1,
  type RawRubricJudgmentV1,
  type RubricSpecV1,
  type VlmAdapter,
  type VlmAdapterAdmission,
  type VlmAdapterEstimateRequest,
  type VlmAdapterRequest,
  type VlmAdapterResponse,
  type VlmBudgetV1,
  type VlmProviderDescriptor,
  type VlmRequestEstimate,
} from '@scratch-agent/eval'
import {
  applySemanticPatch,
  blockRef,
  buildCollector,
  buildMovement,
  type ProjectIR,
} from '@scratch-agent/ir'
import {
  RUN_ISSUE_CODES,
  collectVersions,
  newRunId,
  runBrowserScenario,
  runScenario,
  sha256,
  verifyMediaManifest,
  type BrowserTrace,
  type MediaFrameRefV1,
  type ObservationPlanV1,
  type RunVersions,
  type Scenario,
  type VmTrace,
} from '@scratch-agent/runner'

import { portableRelativePath } from '../lib/path.js'

type ArtifactRole = 'correct' | 'deliberately-defective' | 'dependency-probe'
type ExecutionKind = 'vm' | 'browser' | 'runtime-differential'

interface RetainedArtifact
{
  id: string
  role: ArtifactRole
  construction: string
  path: string
  sha256: string
  byteLength: number
  bytes: Uint8Array
  executedBy: string[]
}

interface ArtifactReport
{
  id: string
  role: ArtifactRole
  construction: string
  path: string
  sha256: string
  byteLength: number
  executedBy: string[]
}

interface ExecutionRecord
{
  id: string
  kind: ExecutionKind
  artifactId: string
  artifactSha256: string
  scenarioSha256: string
  observationPlanSha256: string
  runtime: string
  runtimeDescriptorSha256: string
  observationTraceSha256: string
  resultSha256: string
  ok: boolean
  issueCodes: string[]
  snapshotLabels: string[]
  mediaPath: string | null
}

interface EvidenceFile
{
  kind: string
  path: string
  sha256: string
  byteLength: number
}

interface SyntheticFault
{
  kind: 'trace-fault-injection'
  reason: string
  sourceTraceSha256: string
  path: string
  before: unknown
  after: unknown
}

interface CaseSuccess
{
  productionVerdict: string
  observed: Record<string, unknown>
  artifacts: string[]
  executions: string[]
  evidence?: EvidenceFile[]
  syntheticFault?: SyntheticFault | null
}

interface BenchmarkCase
{
  id: string
  category: string
  expectation: string
  ok: boolean
  productionVerdict: string | null
  observed: Record<string, unknown>
  artifacts: string[]
  executions: string[]
  evidence: EvidenceFile[]
  syntheticFault: SyntheticFault | null
  errors: string[]
}

interface EscalationSummary
{
  noVision: number
  screenshotOnly: number
  vlm: number
  providerCalls: number
}

interface MultimodalBenchmarkReport
{
  schemaVersion: 1
  runId: string
  createdAt: string
  completedAt: string
  durationMs: number
  ok: boolean
  claimScope: string
  sourceRevision: string
  versions: RunVersions
  corpus: {
    id: string
    version: string
    definitionSha256: string
    expectedCaseIds: readonly string[]
  }
  artifacts: ArtifactReport[]
  executions: ExecutionRecord[]
  cases: BenchmarkCase[]
  escalation: EscalationSummary
  totals: {
    cases: number
    passed: number
    failed: number
    correctArtifactsExecuted: number
    defectiveArtifactsExecuted: number
    syntheticFaults: number
  }
}

interface FrameEvidence
{
  frame: MediaFrameRefV1
  bytes: Uint8Array
  evidenceId: string
  clipId: string
}

interface PreparedVlmBundle
{
  request: VlmAdapterRequest
  evaluationRequest: MultimodalEvaluationRequest
  evidenceByCriterion: Record<string, MultimodalCriterionEvidenceV1>
}

const EXPECTED_CASE_IDS = [
  'final-unchanged',
  'final-allowed-change',
  'final-unintended-regression',
  'trace-unchanged',
  'trace-transient-divergence',
  'trace-missing-observation',
  'visual-unchanged',
  'visual-known-regression',
  'visual-renderer-unavailable',
  'runtime-real-agreement',
  'runtime-deliberate-normalized-mismatch',
  'runtime-renderer-noncomparable',
  'clone-lifecycle-unchanged',
  'clone-leak',
  'clone-observation-unsupported',
  'replay-exact-hit',
  'replay-media-miss',
  'replay-rubric-miss',
  'replay-provider-version-miss',
  'vlm-malformed-output',
  'vlm-oversized-output',
  'budget-call-limit',
  'budget-input-token-limit',
  'budget-output-token-limit',
  'budget-dollar-limit',
  'budget-media-limit',
  'budget-clip-limit',
  'budget-temporal-evidence-bytes',
  'escalation-no-vision-state-pass',
  'escalation-no-vision-model-pass',
  'escalation-no-vision-deterministic-fail',
  'escalation-no-vision-missing-evidence',
  'escalation-no-vision-stale-evidence',
  'escalation-no-vision-infrastructure-stop',
  'escalation-screenshot-correct',
  'escalation-screenshot-defective',
  'escalation-vlm-good',
  'escalation-vlm-defective',
] as const

const root = resolve(import.meta.dirname, '../..')
const startedAt = performance.now()
const createdAt = new Date().toISOString()
const runId = `multimodal-bench-${newRunId()}`
const runRoot = join(root, 'runs', runId)
const artifactRoot = join(runRoot, 'artifacts')
const executionRoot = join(runRoot, 'executions')
const evidenceRoot = join(runRoot, 'evidence')
const cases: BenchmarkCase[] = []
const executions: ExecutionRecord[] = []
const artifacts = new Map<string, RetainedArtifact>()

const MOVEMENT_SCENARIO: Scenario = {
  seed: 17,
  fixedDateMs: 1_700_000_000_000,
  steps: [
    { do: 'greenFlag' },
    { do: 'tapKey', key: 'right' },
    { do: 'wait', ticks: 5 },
    { do: 'snapshot', label: 'mid' },
    { do: 'tapKey', key: 'left' },
    { do: 'wait', ticks: 5 },
    { do: 'snapshot', label: 'end' },
  ],
}

const STATE_PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: null,
  cloneCounts: 'sampled',
}

const VISUAL_PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: {
    firstTick: 0,
    lastTick: 12,
    everyTicks: 6,
    playbackFps: 10,
    maxFrames: 3,
    maxBytes: 5 * 1024 * 1024,
    derivedVideo: false,
  },
  cloneCounts: 'sampled',
}

const CLONE_SCENARIO: Scenario = {
  seed: 29,
  fixedDateMs: 1_700_000_000_000,
  maxTicks: 60,
  steps: [
    { do: 'greenFlag' },
    { do: 'wait', ticks: 36 },
    { do: 'snapshot', label: 'end' },
  ],
}

const CLONE_PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: null,
  cloneCounts: 'every-tick',
}

const CLONE_DISABLED_PLAN: ObservationPlanV1 = {
  schemaVersion: 1,
  temporal: null,
  cloneCounts: 'none',
}

const COLLECTOR_SCENARIO: Scenario = {
  seed: 31,
  fixedDateMs: 1_700_000_000_000,
  steps: [
    { do: 'greenFlag' },
    { do: 'wait', ticks: 2 },
    { do: 'snapshot', label: 'end' },
  ],
}

const PROVIDER: VlmProviderDescriptor = {
  adapter: 'multimodal-bench-fake',
  provider: 'repository-benchmark',
  model: 'fake-visual-v1',
  version: '1',
}

const ESTIMATE: VlmRequestEstimate = {
  inputTokens: 48,
  outputTokens: 64,
  totalTokens: 112,
  usd: 0.01,
  pricingTableVersion: 'multimodal-bench-pricing-v1',
  unavailableReason: null,
}

const PROMPT_TEMPLATE_TEXT =
  'judge only the admitted Multimodal rubric criteria and retained image evidence'

const MIXED_RUBRIC: RubricSpecV1 = {
  schemaVersion: MULTIMODAL_SCHEMA_VERSION,
  id: 'multimodal-bench-mixed',
  version: '1',
  objective: 'preserve trusted state and judge bounded visual motion',
  criteria: [
    {
      id: 'state',
      requirement: 'required',
      evidenceKind: 'state-and-visual',
      description: 'the trusted host state gate passes',
      passAnchors: ['the declared state agrees'],
      failAnchors: ['the declared state differs'],
    },
    {
      id: 'motion',
      requirement: 'required',
      evidenceKind: 'temporal',
      description: 'the movement is visually coherent',
      passAnchors: ['the movement is coherent'],
      failAnchors: ['the movement contains a visible regression'],
    },
  ],
}

const STATE_RUBRIC: RubricSpecV1 = {
  schemaVersion: MULTIMODAL_SCHEMA_VERSION,
  id: 'multimodal-bench-state',
  version: '1',
  objective: 'retain one trusted deterministic state criterion',
  criteria: [
    {
      id: 'state',
      requirement: 'required',
      evidenceKind: 'state-and-visual',
      description: 'the trusted state result is retained',
      passAnchors: ['the state agrees'],
      failAnchors: ['the state differs'],
    },
  ],
}

const TEMPORAL_RUBRIC: RubricSpecV1 = {
  schemaVersion: MULTIMODAL_SCHEMA_VERSION,
  id: 'multimodal-bench-temporal',
  version: '1',
  objective: 'select bounded temporal evidence only when it is ready',
  criteria: [
    {
      id: 'motion',
      requirement: 'required',
      evidenceKind: 'temporal',
      description: 'the admitted movement evidence is coherent',
      passAnchors: ['the movement is coherent'],
      failAnchors: ['the movement is incoherent'],
    },
  ],
}

const KEYFRAME_RUBRIC: RubricSpecV1 = {
  schemaVersion: MULTIMODAL_SCHEMA_VERSION,
  id: 'multimodal-bench-keyframe',
  version: '1',
  objective: 'select deterministic rendered keyframe evidence',
  criteria: [
    {
      id: 'appearance',
      requirement: 'required',
      evidenceKind: 'keyframe',
      description: 'the admitted keyframe has the intended appearance',
      passAnchors: ['the keyframe is correct'],
      failAnchors: ['the keyframe contains a visual regression'],
    },
  ],
}

function ensure(condition: unknown, message: string): asserts condition
{
  if (!condition) throw new Error(message)
}

function portable(path: string): string
{
  return portableRelativePath(runRoot, path)
}

function sourceRevision(): string
{
  if (process.env.SOURCE_REVISION) return process.env.SOURCE_REVISION
  try
  {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim()
    return dirty ? `${head}+dirty` : head
  }
  catch
  {
    return 'unknown'
  }
}

function scrubError(error: unknown): string
{
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replaceAll(runRoot, '<run-root>')
    .replaceAll(root, '<repo-root>')
}

function writeExclusive(path: string, bytes: Uint8Array | string): void
{
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
}

function hardenRunPermissions(path: string): void
{
  chmodSync(path, 0o700)
  for (const entry of readdirSync(path, { withFileTypes: true }))
  {
    const child = join(path, entry.name)
    if (entry.isDirectory()) hardenRunPermissions(child)
    else if (entry.isFile()) chmodSync(child, 0o600)
  }
}

function writeJsonEvidence(
  relativePath: string,
  kind: string,
  value: unknown
): EvidenceFile
{
  const path = join(evidenceRoot, relativePath)
  const text = `${JSON.stringify(value, null, 2)}\n`
  writeExclusive(path, text)
  return {
    kind,
    path: portable(path),
    sha256: sha256(Buffer.from(text)),
    byteLength: Buffer.byteLength(text),
  }
}

function writeEvaluationEvidence(
  id: string,
  report: MultimodalEvaluationReportV1
): EvidenceFile[]
{
  const jsonPath = join(evidenceRoot, 'evaluations', `${id}.json`)
  const markdownPath = join(evidenceRoot, 'evaluations', `${id}.md`)
  const json = multimodalReportJson(report)
  const markdown = multimodalReportMarkdown(report)
  writeExclusive(jsonPath, json)
  writeExclusive(markdownPath, markdown)
  return [
    {
      kind: 'multimodal-evaluation-json',
      path: portable(jsonPath),
      sha256: sha256(Buffer.from(json)),
      byteLength: Buffer.byteLength(json),
    },
    {
      kind: 'multimodal-evaluation-markdown',
      path: portable(markdownPath),
      sha256: sha256(Buffer.from(markdown)),
      byteLength: Buffer.byteLength(markdown),
    },
  ]
}

function traceIdentity(trace: BehavioralTrace): string
{
  return hashMultimodalJson({
    runtimeDescriptor: trace.runtimeDescriptor,
    observations: trace.observations,
    snapshots: trace.snapshots,
    finalSnapshot: trace.finalSnapshot,
    errors: trace.errors,
    issues: trace.issues,
  })
}

function registerExecution(
  id: string,
  kind: ExecutionKind,
  artifact: RetainedArtifact,
  trace: BehavioralTrace,
  mediaPath: string | null
): void
{
  executions.push({
    id,
    kind,
    artifactId: artifact.id,
    artifactSha256: artifact.sha256,
    scenarioSha256: trace.observations.scenarioSha256,
    observationPlanSha256: trace.observations.planSha256,
    runtime: trace.runtime,
    runtimeDescriptorSha256: hashMultimodalJson(trace.runtimeDescriptor),
    observationTraceSha256: hashMultimodalJson(trace.observations),
    resultSha256: traceIdentity(trace),
    ok: trace.ok,
    issueCodes: trace.issues.map((issue) => issue.code),
    snapshotLabels: trace.snapshots.flatMap((snapshot) =>
      snapshot.label === undefined ? [] : [snapshot.label]
    ),
    mediaPath,
  })
}

async function vmExecution(
  id: string,
  artifact: RetainedArtifact,
  scenario: Scenario,
  plan: ObservationPlanV1
): Promise<VmTrace>
{
  const trace = await runScenario(artifact.bytes, scenario, {
    observationPlan: plan,
  })
  registerExecution(id, 'vm', artifact, trace, null)
  return trace
}

async function browserExecution(
  id: string,
  artifact: RetainedArtifact,
  scenario: Scenario,
  plan: ObservationPlanV1
): Promise<BrowserTrace>
{
  const directory = join(executionRoot, id)
  const trace = await runBrowserScenario(artifact.bytes, scenario, {
    screenshotDir: join(directory, 'screenshots'),
    ...(plan.temporal ? { mediaDir: join(directory, 'media') } : {}),
    observationPlan: plan,
  })
  registerExecution(
    id,
    'browser',
    artifact,
    trace,
    trace.mediaRoot ? portable(trace.mediaRoot) : null
  )
  return trace
}

function recordDifferentialExecutions(
  prefix: string,
  artifact: RetainedArtifact,
  official: VmTrace,
  turboWarp: BrowserTrace
): void
{
  registerExecution(
    `${prefix}-official-headless`,
    'runtime-differential',
    artifact,
    official,
    null
  )
  registerExecution(
    `${prefix}-turbowarp`,
    'runtime-differential',
    artifact,
    turboWarp,
    turboWarp.mediaRoot ? portable(turboWarp.mediaRoot) : null
  )
}

function markArtifacts(caseId: string, artifactIds: readonly string[]): void
{
  for (const id of artifactIds)
  {
    const artifact = artifacts.get(id)
    ensure(artifact, `unknown artifact ${id}`)
    if (!artifact.executedBy.includes(caseId)) artifact.executedBy.push(caseId)
  }
}

async function addCase(
  id: (typeof EXPECTED_CASE_IDS)[number],
  category: string,
  expectation: string,
  evaluate: () => Promise<CaseSuccess> | CaseSuccess
): Promise<void>
{
  try
  {
    const result = await evaluate()
    markArtifacts(id, result.artifacts)
    const record: BenchmarkCase = {
      id,
      category,
      expectation,
      ok: true,
      productionVerdict: result.productionVerdict,
      observed: result.observed,
      artifacts: [...result.artifacts],
      executions: [...result.executions],
      evidence: [...(result.evidence ?? [])],
      syntheticFault: result.syntheticFault ?? null,
      errors: [],
    }
    cases.push(record)
    writeExclusive(
      join(runRoot, 'cases', `${id}.json`),
      `${JSON.stringify(record, null, 2)}\n`
    )
    console.log(`PASS  ${id}`)
  }
  catch (error)
  {
    const record: BenchmarkCase = {
      id,
      category,
      expectation,
      ok: false,
      productionVerdict: null,
      observed: {},
      artifacts: [],
      executions: [],
      evidence: [],
      syntheticFault: null,
      errors: [scrubError(error)],
    }
    cases.push(record)
    writeExclusive(
      join(runRoot, 'cases', `${id}.json`),
      `${JSON.stringify(record, null, 2)}\n`
    )
    console.log(`FAIL  ${id}`)
    console.log(`      ${record.errors[0]}`)
  }
}

async function movementVariant(
  id: string,
  right: string,
  left: string
): Promise<{ project: ProjectIR; bytes: Uint8Array; construction: string }>
{
  const baseline = buildMovement()
  const baselineBytes = await baseline.toSb3()
  if (right === '10' && left === '-10')
    return {
      project: baseline,
      bytes: baselineBytes,
      construction: 'buildMovement() canonical +10/-10 control',
    }

  const sprite = baseline.target('Mover')
  ensure(sprite, 'movement builder did not create Mover')
  const targetIndex = baseline.json.targets.indexOf(sprite.raw)
  ensure(targetIndex >= 0, 'Mover target is absent from the project')
  const moves = sprite
    .scripts()
    .flatMap((script) => script.blocks)
    .filter((block) => block.opcode === 'motion_changexby')
  const positive = moves.find(
    (block) =>
      block.inputs.DX?.kind === 'literal' && block.inputs.DX.value === '10'
  )
  const negative = moves.find(
    (block) =>
      block.inputs.DX?.kind === 'literal' && block.inputs.DX.value === '-10'
  )
  ensure(positive && negative, 'movement literals could not be resolved')
  const result = await applySemanticPatch(
    baseline,
    {
      schemaVersion: 1,
      baseArtifactSha256: sha256(baselineBytes),
      operations: [
        {
          opId: `${id}-right`,
          kind: 'replaceLiteral',
          block: blockRef(baseline, targetIndex, positive.id),
          inputName: 'DX',
          expectedOpcode: 'motion_changexby',
          from: { kind: 'number', value: '10' },
          to: { kind: 'number', value: right },
        },
        {
          opId: `${id}-left`,
          kind: 'replaceLiteral',
          block: blockRef(baseline, targetIndex, negative.id),
          inputName: 'DX',
          expectedOpcode: 'motion_changexby',
          from: { kind: 'number', value: '-10' },
          to: { kind: 'number', value: left },
        },
      ],
    },
    { baselineArtifactBytes: baselineBytes }
  )
  if (!result.ok)
    throw new Error(
      `movement semantic patch failed: ${JSON.stringify(result.violations)}`
    )
  return {
    project: result.candidate,
    bytes: result.candidateBytes,
    construction: `buildMovement() + guarded replaceLiteral ${right}/${left}`,
  }
}

async function cloneProject(
  deleteClone: boolean
): Promise<{ project: ProjectIR; bytes: Uint8Array; construction: string }>
{
  const project = buildMovement()
  const sprite = project.target('Mover')
  ensure(sprite, 'clone builder did not retain Mover')
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_create_clone_of',
      inputs: {
        CLONE_OPTION: {
          reporter: {
            opcode: 'control_create_clone_of_menu',
            fields: { CLONE_OPTION: ['_myself_', null] },
          },
        },
      },
    },
  ])
  sprite.addScript([
    { opcode: 'control_start_as_clone' },
    { opcode: 'control_wait', inputs: { DURATION: 0.5 } },
    ...(deleteClone ? [{ opcode: 'control_delete_this_clone' }] : []),
  ])
  return {
    project,
    bytes: await project.toSb3(),
    construction: deleteClone
      ? 'IR-generated clone lifecycle with delayed deletion'
      : 'IR-generated deliberate clone leak without deletion',
  }
}

async function retainArtifact(
  id: string,
  role: ArtifactRole,
  construction: string,
  bytes: Uint8Array
): Promise<RetainedArtifact>
{
  const path = join(artifactRoot, `${id}.sb3`)
  writeExclusive(path, bytes)
  const artifact: RetainedArtifact = {
    id,
    role,
    construction,
    path: portable(path),
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
    bytes: Uint8Array.from(bytes),
    executedBy: [],
  }
  artifacts.set(id, artifact)
  return artifact
}

function lens(report: DifferentialReportV1, id: string): LensResultV1
{
  const result = report.results.find((entry) => entry.specId === id)
  ensure(result, `missing lens result ${id}`)
  return result
}

function targetX(trace: BehavioralTrace, label: 'mid' | 'end'): number
{
  const snapshot = trace.snapshots.find((entry) => entry.label === label)
  ensure(snapshot, `missing ${label} snapshot`)
  const id = snapshot.targetOrder.find(
    (targetId) => snapshot.targetsById[targetId]?.name === 'Mover'
  )
  ensure(id, `missing Mover identity at ${label}`)
  return snapshot.targetsById[id]!.x
}

function finalTargetId(trace: BehavioralTrace, name: string): string
{
  const snapshot = trace.finalSnapshot
  ensure(snapshot, 'trace has no final snapshot')
  const id = snapshot.targetOrder.find(
    (targetId) => snapshot.targetsById[targetId]?.name === name
  )
  ensure(id, `trace has no final target named ${name}`)
  return id
}

function finalX(trace: BehavioralTrace, name = 'Mover'): number
{
  const snapshot = trace.finalSnapshot
  ensure(snapshot, 'trace has no final snapshot')
  return snapshot.targetsById[finalTargetId(trace, name)]!.x
}

function visualFrame(trace: BrowserTrace, tick: number): MediaFrameRefV1
{
  const frame = trace.observations.media?.frames.find(
    (entry) => entry.tick === tick
  )
  ensure(frame, `missing retained visual frame at tick ${tick}`)
  return frame
}

function frameEvidence(
  trace: BrowserTrace,
  tick: number,
  evidenceId: string,
  clipId: string
): FrameEvidence
{
  const frame = visualFrame(trace, tick)
  ensure(trace.mediaRoot, 'visual trace has no media root')
  const path = join(trace.mediaRoot, frame.relativePath)
  const bytes = readFileSync(path)
  ensure(statSync(path).isFile(), 'retained visual evidence is not a file')
  ensure(bytes.byteLength === frame.bytes, 'retained frame byte count drifted')
  ensure(sha256(bytes) === frame.sha256, 'retained frame hash drifted')
  return {
    frame,
    bytes,
    evidenceId,
    clipId,
  }
}

function providerPolicy(
  provider: VlmProviderDescriptor = PROVIDER
): MultimodalVlmPolicyV1
{
  return {
    prompt: {
      template: {
        id: 'multimodal-bench-prompt',
        version: '1',
        sha256: sha256(Buffer.from(PROMPT_TEMPLATE_TEXT)),
      },
      templateText: PROMPT_TEMPLATE_TEXT,
    },
    provider: { ...provider },
    generation: { temperature: 0, maxOutputTokens: 64 },
  }
}

function budgetFor(frame: FrameEvidence): VlmBudgetV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    maxCalls: 1,
    maxSubmittedMediaBytes: frame.bytes.byteLength,
    maxInputTokens: 128,
    maxCumulativeOutputTokens: 64,
    maxCostUsd: 0.02,
    maxUniqueClips: 1,
  }
}

function prepareBundle(
  mode: 'live' | 'replay',
  artifact: RetainedArtifact,
  trace: BrowserTrace,
  frame: FrameEvidence,
  rubric: RubricSpecV1 = MIXED_RUBRIC,
  provider: VlmProviderDescriptor = PROVIDER
): PreparedVlmBundle
{
  const policy = providerPolicy(provider)
  const budget = budgetFor(frame)
  const context = {
    artifactSha256: artifact.sha256,
    scenarioSha256: trace.observations.scenarioSha256,
    observationPlanSha256: trace.observations.planSha256,
    observationTraceSha256: hashMultimodalJson(trace.observations),
    sampleOrdinal: 0,
  }
  const request = prepareVlmRequest({
    context,
    mediaAdmission: {
      maxSubmittedMediaBytes: budget.maxSubmittedMediaBytes,
      maxUniqueClips: budget.maxUniqueClips,
    },
    rubric,
    rubricSha256: hashMultimodalJson(rubric),
    selectedCriterionIds: ['motion'],
    criterionEvidence: [{ criterionId: 'motion', frameIds: [frame.frame.id] }],
    prompt: policy.prompt,
    outputSchema: {
      identity: {
        id: 'rubric-judgment-schema',
        version: '1',
        sha256: hashMultimodalJson(RUBRIC_JUDGMENT_JSON_SCHEMA),
      },
      value: RUBRIC_JUDGMENT_JSON_SCHEMA,
    },
    provider,
    generation: policy.generation,
    images: [
      {
        binding: {
          evidenceId: frame.evidenceId,
          frameId: frame.frame.id,
          clipId: frame.clipId,
          tick: frame.frame.tick,
          mimeType: 'image/png',
          bytes: frame.bytes.byteLength,
          sha256: frame.frame.sha256,
          width: frame.frame.width,
          height: frame.frame.height,
          detail: 'low',
        },
        bytes: Uint8Array.from(frame.bytes),
      },
    ],
  })
  const evaluationRequest: MultimodalEvaluationRequest = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    mode,
    input: { artifactSha256: artifact.sha256, byteLength: artifact.byteLength },
    scenarioSha256: context.scenarioSha256,
    observationTraceSha256: context.observationTraceSha256,
    sampleOrdinal: context.sampleOrdinal,
    rubric,
    observationPlan: trace.observations.plan,
    lenses: [],
    budget,
    vlmPolicy: policy,
  }
  return {
    request,
    evaluationRequest,
    evidenceByCriterion: {
      motion: {
        status: 'ready',
        frameIds: [frame.frame.id],
        clipIds: [frame.clipId],
      },
    },
  }
}

function deterministicState(
  verdict: 'pass' | 'fail' | 'inconclusive',
  source: 'state' | 'model' = 'state'
): DeterministicCriterionResult
{
  return {
    criterionId: 'state',
    required: true,
    verdict,
    source,
    evidence: [],
    limitation:
      verdict === 'inconclusive'
        ? 'the trusted deterministic result is inconclusive'
        : null,
  }
}

function rawMotionJudgment(
  verdict: 'pass' | 'fail',
  frame: FrameEvidence
): RawRubricJudgmentV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    criteria: [
      {
        criterionId: 'motion',
        verdict,
        confidence: 0.95,
        evidence: [
          {
            evidenceId: frame.evidenceId,
            frameId: frame.frame.id,
            tick: frame.frame.tick,
            region: null,
          },
        ],
        symptoms: [],
        limitation: null,
      },
    ],
  }
}

function completedResponse(
  raw: unknown,
  provider: VlmProviderDescriptor = PROVIDER
): VlmAdapterResponse
{
  return {
    outcome: 'completed',
    responseId: 'multimodal-bench-response',
    model: provider.model,
    latencyMs: 5,
    usage: {
      inputTokens: 40,
      outputTokens: 16,
      totalTokens: 56,
      available: true,
      unavailableReason: null,
    },
    billedCostUsd: null,
    raw,
    error: null,
  }
}

function fakeAdapter(
  actions: ConstructorParameters<typeof ScriptedFakeVlmAdapter>[0]['actions'],
  provider: VlmProviderDescriptor = PROVIDER
): ScriptedFakeVlmAdapter
{
  return new ScriptedFakeVlmAdapter({
    descriptor: provider,
    estimate: ESTIMATE,
    actions,
  })
}

async function evaluateBundle(
  runName: string,
  bundle: PreparedVlmBundle,
  boundary:
    | {
        mode: 'live'
        adapter: VlmAdapter
        replayStore: InMemoryVlmReplayStore
      }
    | { mode: 'replay'; replayStore: InMemoryVlmReplayStore }
): Promise<Readonly<MultimodalEvaluationReportV1>>
{
  return evaluateMultimodal({
    request: bundle.evaluationRequest,
    boundary:
      boundary.mode === 'live'
        ? {
            mode: 'live',
            request: bundle.request,
            adapter: boundary.adapter,
            replayStore: boundary.replayStore,
          }
        : {
            mode: 'replay',
            request: bundle.request,
            replayStore: boundary.replayStore,
          },
    runId: `${runId}-${runName}`,
    createdAt: new Date().toISOString(),
    structuralPreflight: 'passed',
    deterministic: [deterministicState('pass')],
    evidenceByCriterion: bundle.evidenceByCriterion,
    differential: null,
    lenses: [],
  })
}

async function simpleEvaluation(options: {
  runName: string
  artifact: RetainedArtifact
  trace: BehavioralTrace
  rubric: RubricSpecV1
  mode: 'deterministic' | 'live'
  deterministic: DeterministicCriterionResult[]
  evidenceByCriterion: Record<string, MultimodalCriterionEvidenceV1>
  issues?: MultimodalEvaluationIssueV1[]
  adapter?: ScriptedFakeVlmAdapter
}): Promise<Readonly<MultimodalEvaluationReportV1>>
{
  const budget: VlmBudgetV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    maxCalls: 1,
    maxSubmittedMediaBytes: 5 * 1024 * 1024,
    maxInputTokens: 128,
    maxCumulativeOutputTokens: 64,
    maxCostUsd: 0.02,
    maxUniqueClips: 1,
  }
  const request: MultimodalEvaluationRequest = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    mode: options.mode,
    input: {
      artifactSha256: options.artifact.sha256,
      byteLength: options.artifact.byteLength,
    },
    scenarioSha256: options.trace.observations.scenarioSha256,
    observationTraceSha256: hashMultimodalJson(options.trace.observations),
    sampleOrdinal: 0,
    rubric: options.rubric,
    observationPlan: options.trace.observations.plan,
    lenses: [],
    budget,
    vlmPolicy: options.mode === 'live' ? providerPolicy() : null,
  }
  return evaluateMultimodal({
    request,
    boundary:
      options.mode === 'deterministic'
        ? { mode: 'deterministic' }
        : {
            mode: 'live',
            request: null,
            adapter: options.adapter ?? fakeAdapter([]),
            replayStore: new InMemoryVlmReplayStore(),
          },
    runId: `${runId}-${options.runName}`,
    createdAt: new Date().toISOString(),
    structuralPreflight: 'passed',
    deterministic: options.deterministic,
    evidenceByCriterion: options.evidenceByCriterion,
    differential: null,
    lenses: [],
    issues: options.issues,
  })
}

function escalationClass(
  report: MultimodalEvaluationReportV1
): 'no-vision' | 'screenshot-only' | 'vlm'
{
  if (
    report.selection.decisions.some(
      (decision) => decision.decision === 'use-vlm'
    ) ||
    report.calls.some((call) => call.providerCallCount === 1)
  )
    return 'vlm'
  if (
    report.selection.decisions.some(
      (decision) => decision.decision === 'use-keyframe'
    )
  )
    return 'screenshot-only'
  return 'no-vision'
}

class OversizedAdapter implements VlmAdapter
{
  readonly descriptor = PROVIDER
  callCount = 0

  admit(_request: VlmAdapterEstimateRequest): VlmAdapterAdmission
  {
    return { accepted: true, reason: null }
  }

  estimateCost(_request: VlmAdapterEstimateRequest): VlmRequestEstimate
  {
    return ESTIMATE
  }

  async evaluate(
    _request: VlmAdapterRequest,
    _signal: AbortSignal
  ): Promise<VlmAdapterResponse>
  {
    this.callCount++
    return completedResponse({
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      criteria: [
        {
          criterionId: 'motion',
          verdict: 'pass',
          confidence: 0.95,
          evidence: [],
          symptoms: [],
          limitation: 'x'.repeat(MAX_MULTIMODAL_JSON_BYTES + 1),
        },
      ],
    })
  }
}

function caseMarkdown(report: MultimodalBenchmarkReport): string
{
  const lines = [
    '# Multimodal deterministic acceptance benchmark',
    '',
    `**result:** ${report.ok ? 'PASS' : 'FAIL'}`,
    `**run:** \`${report.runId}\``,
    `**cases:** ${report.totals.passed}/${report.totals.cases} passed`,
    '',
    'This is bounded observational evidence, not a claim of general semantic equivalence.',
    '',
    '## Corpus',
    '',
    `- definition sha256: \`${report.corpus.definitionSha256}\``,
    `- correct artifacts executed: ${report.totals.correctArtifactsExecuted}`,
    `- deliberately defective artifacts executed: ${report.totals.defectiveArtifactsExecuted}`,
    `- explicit synthetic trace faults: ${report.totals.syntheticFaults}`,
    '',
    '## Escalation matrix',
    '',
    `- no vision: ${report.escalation.noVision}`,
    `- screenshot only: ${report.escalation.screenshotOnly}`,
    `- VLM: ${report.escalation.vlm}`,
    `- provider calls: ${report.escalation.providerCalls}`,
    '',
    '## Cases',
    '',
    '| Case | Category | Result | Production verdict |',
    '| --- | --- | --- | --- |',
    ...report.cases.map(
      (entry) =>
        `| ${entry.id} | ${entry.category} | ${entry.ok ? 'PASS' : 'FAIL'} | ${entry.productionVerdict ?? '-'} |`
    ),
  ]
  const failures = report.cases.flatMap((entry) =>
    entry.errors.map((error) => `- ${entry.id}: ${error}`)
  )
  if (failures.length > 0) lines.push('', '## Failures', '', ...failures)
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void>
{
  mkdirSync(runRoot, { recursive: false, mode: 0o700 })
  mkdirSync(artifactRoot, { recursive: false, mode: 0o700 })
  mkdirSync(executionRoot, { recursive: false, mode: 0o700 })
  mkdirSync(evidenceRoot, { recursive: false, mode: 0o700 })

  const controlBuilt = await movementVariant('control', '10', '-10')
  const finalBuilt = await movementVariant('final-regression', '20', '-10')
  const transientBuilt = await movementVariant(
    'transient-regression',
    '20',
    '-20'
  )
  const cloneContainedBuilt = await cloneProject(true)
  const cloneLeakBuilt = await cloneProject(false)
  const collectorProject = buildCollector()

  const control = await retainArtifact(
    'movement-control',
    'correct',
    controlBuilt.construction,
    controlBuilt.bytes
  )
  const finalRegression = await retainArtifact(
    'movement-final-regression',
    'deliberately-defective',
    finalBuilt.construction,
    finalBuilt.bytes
  )
  const transientRegression = await retainArtifact(
    'movement-transient-regression',
    'deliberately-defective',
    transientBuilt.construction,
    transientBuilt.bytes
  )
  const cloneContained = await retainArtifact(
    'clone-contained',
    'correct',
    cloneContainedBuilt.construction,
    cloneContainedBuilt.bytes
  )
  const cloneLeakArtifact = await retainArtifact(
    'clone-leak',
    'deliberately-defective',
    cloneLeakBuilt.construction,
    cloneLeakBuilt.bytes
  )
  const collector = await retainArtifact(
    'collector',
    'dependency-probe',
    'buildCollector() renderer-dependent runtime probe',
    await collectorProject.toSb3()
  )

  ensure(
    new Set([...artifacts.values()].map((artifact) => artifact.sha256)).size ===
      artifacts.size,
    'generated corpus artifacts are not identity-distinct'
  )

  const controlBrowserA = await browserExecution(
    'movement-control-browser-a',
    control,
    MOVEMENT_SCENARIO,
    VISUAL_PLAN
  )
  const controlBrowserB = await browserExecution(
    'movement-control-browser-b',
    control,
    MOVEMENT_SCENARIO,
    VISUAL_PLAN
  )
  const finalBrowser = await browserExecution(
    'movement-final-browser',
    finalRegression,
    MOVEMENT_SCENARIO,
    VISUAL_PLAN
  )
  const controlVmA = await vmExecution(
    'movement-control-vm-a',
    control,
    MOVEMENT_SCENARIO,
    STATE_PLAN
  )
  const controlVmB = await vmExecution(
    'movement-control-vm-b',
    control,
    MOVEMENT_SCENARIO,
    STATE_PLAN
  )
  const transientVm = await vmExecution(
    'movement-transient-vm',
    transientRegression,
    MOVEMENT_SCENARIO,
    STATE_PLAN
  )
  const cloneContainedA = await vmExecution(
    'clone-contained-vm-a',
    cloneContained,
    CLONE_SCENARIO,
    CLONE_PLAN
  )
  const cloneContainedB = await vmExecution(
    'clone-contained-vm-b',
    cloneContained,
    CLONE_SCENARIO,
    CLONE_PLAN
  )
  const cloneLeakTrace = await vmExecution(
    'clone-leak-vm',
    cloneLeakArtifact,
    CLONE_SCENARIO,
    CLONE_PLAN
  )
  const cloneDisabledA = await vmExecution(
    'clone-disabled-vm-a',
    cloneContained,
    CLONE_SCENARIO,
    CLONE_DISABLED_PLAN
  )
  const cloneDisabledB = await vmExecution(
    'clone-disabled-vm-b',
    cloneContained,
    CLONE_SCENARIO,
    CLONE_DISABLED_PLAN
  )

  for (const trace of [
    controlBrowserA,
    controlBrowserB,
    finalBrowser,
    controlVmA,
    controlVmB,
    transientVm,
    cloneContainedA,
    cloneContainedB,
    cloneLeakTrace,
    cloneDisabledA,
    cloneDisabledB,
  ])
    ensure(
      trace.ok,
      `shared corpus execution failed: ${trace.errors.join('; ')}`
    )

  for (const trace of [controlBrowserA, controlBrowserB, finalBrowser])
  {
    ensure(trace.mediaRoot, 'visual corpus trace did not retain a media root')
    const manifest = trace.observations.media
    ensure(manifest, 'visual corpus trace did not retain a media manifest')
    ensure(
      manifest.complete,
      manifest.incompleteReason ?? 'manifest incomplete'
    )
    ensure(
      verifyMediaManifest(manifest, trace.mediaRoot, VISUAL_PLAN).length === 0,
      'visual corpus media manifest verification failed'
    )
  }

  const exactFinalSpec: BehavioralLensSpecV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id: 'final',
    kind: 'final-state',
    required: true,
    appliesTo: 'baseline-candidate',
    absoluteNumericTolerance: 0,
  }
  const finalUnchanged = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlBrowserA,
    right: controlBrowserB,
    specs: [exactFinalSpec],
  })
  const moverId = finalTargetId(controlBrowserA, 'Mover')
  const allowedFinalSpec: BehavioralLensSpecV1 = {
    ...exactFinalSpec,
    id: 'final-allowed',
    numericToleranceByPath: {
      [`$.finalState.targetsById.${moverId}.x`]: 10,
    },
  }
  const finalAllowed = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlBrowserA,
    right: finalBrowser,
    specs: [allowedFinalSpec],
  })
  const finalFailed = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlBrowserA,
    right: finalBrowser,
    specs: [exactFinalSpec],
  })

  const traceSpec: BehavioralLensSpecV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id: 'trace',
    kind: 'labeled-trace',
    required: true,
    appliesTo: 'baseline-candidate',
    labels: ['mid', 'end'],
    absoluteNumericTolerance: 0,
  }
  const traceUnchanged = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlVmA,
    right: controlVmB,
    specs: [traceSpec],
  })
  const traceTransient = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlVmA,
    right: transientVm,
    specs: [traceSpec],
  })
  const missingTrace = structuredClone(controlVmB)
  const missingSourceTraceSha256 = traceIdentity(controlVmB)
  const missingBefore = missingTrace.snapshots.length
  missingTrace.snapshots = missingTrace.snapshots.filter(
    (snapshot) => snapshot.label !== 'mid'
  )
  const traceMissing = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlVmA,
    right: missingTrace,
    specs: [traceSpec],
  })

  const midFrameId = visualFrame(controlBrowserA, 6).id
  const visualSpec: BehavioralLensSpecV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id: 'visual',
    kind: 'visual-keyframes',
    required: true,
    appliesTo: 'baseline-candidate',
    frameIds: [midFrameId],
    maxMeanRgbDelta: 0,
    maxNormalizedRectDelta: 0,
  }
  const visualUnchanged = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlBrowserA,
    right: controlBrowserB,
    specs: [visualSpec],
  })
  const visualFailed = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlBrowserA,
    right: finalBrowser,
    specs: [visualSpec],
  })
  const visualUnavailable = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: controlVmA,
    right: controlVmB,
    specs: [visualSpec],
  })

  const runtimeSpecs: BehavioralLensSpecV1[] = [
    {
      ...exactFinalSpec,
      id: 'runtime-final',
      appliesTo: 'runtime-runtime',
    },
    {
      ...traceSpec,
      id: 'runtime-trace',
      appliesTo: 'runtime-runtime',
    },
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'runtime-outcome',
      kind: 'runtime-outcome',
      required: true,
      appliesTo: 'runtime-runtime',
    },
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'runtime-clones',
      kind: 'clone-count-trace',
      required: true,
      appliesTo: 'runtime-runtime',
      ticks: [6, 12],
    },
  ]
  const runtimeAgreement = await runCheapRuntimeDifferential(
    control.bytes,
    MOVEMENT_SCENARIO,
    {
      browser: {
        screenshotDir: join(
          executionRoot,
          'runtime-movement-turbowarp',
          'screenshots'
        ),
      },
      observationPlan: STATE_PLAN,
      specs: runtimeSpecs,
    }
  )
  recordDifferentialExecutions(
    'runtime-movement',
    control,
    runtimeAgreement.officialHeadless,
    runtimeAgreement.turboWarp
  )
  const mismatchedRuntime = structuredClone(runtimeAgreement.turboWarp)
  const mismatchedSourceTraceSha256 = traceIdentity(runtimeAgreement.turboWarp)
  const mismatchId = finalTargetId(mismatchedRuntime, 'Mover')
  const mismatchBefore =
    mismatchedRuntime.finalSnapshot!.targetsById[mismatchId]!.x
  mismatchedRuntime.finalSnapshot!.targetsById[mismatchId]!.x += 10
  const mismatchAfter =
    mismatchedRuntime.finalSnapshot!.targetsById[mismatchId]!.x
  const runtimeMismatch = evaluateBehavioralDifferential({
    comparisonKind: 'runtime-runtime',
    left: runtimeAgreement.officialHeadless,
    right: mismatchedRuntime,
    specs: [runtimeSpecs[0]!],
    capabilityAssessment: runtimeAgreement.report.capabilityAssessment,
    seed: MOVEMENT_SCENARIO.seed,
    fixedDateMs: MOVEMENT_SCENARIO.fixedDateMs,
  })
  const rendererNoncomparable = await runCheapRuntimeDifferential(
    collector.bytes,
    COLLECTOR_SCENARIO,
    {
      browser: {
        screenshotDir: join(
          executionRoot,
          'runtime-collector-turbowarp',
          'screenshots'
        ),
      },
      observationPlan: STATE_PLAN,
      specs: [
        {
          ...exactFinalSpec,
          id: 'collector-final',
          appliesTo: 'runtime-runtime',
        },
      ],
    }
  )
  recordDifferentialExecutions(
    'runtime-collector',
    collector,
    rendererNoncomparable.officialHeadless,
    rendererNoncomparable.turboWarp
  )

  const cloneTicks = [1, 36]
  const cloneSpec: BehavioralLensSpecV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id: 'clones',
    kind: 'clone-count-trace',
    required: true,
    appliesTo: 'baseline-candidate',
    ticks: cloneTicks,
  }
  const cloneUnchanged = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: cloneContainedA,
    right: cloneContainedB,
    specs: [cloneSpec],
  })
  const cloneLeaked = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: cloneContainedA,
    right: cloneLeakTrace,
    specs: [cloneSpec],
  })
  const cloneUnsupported = evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left: cloneDisabledA,
    right: cloneDisabledB,
    specs: [cloneSpec],
  })

  const goodFrame = frameEvidence(
    controlBrowserA,
    6,
    'movement-mid-evidence',
    'movement-control-clip'
  )
  const alternateFrame = frameEvidence(
    controlBrowserA,
    0,
    'movement-start-evidence',
    'movement-control-clip'
  )
  const defectiveFrame = frameEvidence(
    finalBrowser,
    6,
    'movement-defective-evidence',
    'movement-defective-clip'
  )
  const liveStore = new InMemoryVlmReplayStore()
  const goodBundle = prepareBundle('live', control, controlBrowserA, goodFrame)
  const goodAdapter = fakeAdapter([
    {
      kind: 'response',
      response: completedResponse(rawMotionJudgment('pass', goodFrame)),
    },
  ])
  const goodLiveReport = await evaluateBundle('vlm-good', goodBundle, {
    mode: 'live',
    adapter: goodAdapter,
    replayStore: liveStore,
  })
  const badStore = new InMemoryVlmReplayStore()
  const badBundle = prepareBundle(
    'live',
    finalRegression,
    finalBrowser,
    defectiveFrame
  )
  const badAdapter = fakeAdapter([
    {
      kind: 'response',
      response: completedResponse(rawMotionJudgment('fail', defectiveFrame)),
    },
  ])
  const badLiveReport = await evaluateBundle('vlm-defective', badBundle, {
    mode: 'live',
    adapter: badAdapter,
    replayStore: badStore,
  })

  const replayExactBundle: PreparedVlmBundle = {
    ...goodBundle,
    evaluationRequest: { ...goodBundle.evaluationRequest, mode: 'replay' },
  }
  const replayExactReport = await evaluateBundle(
    'replay-exact',
    replayExactBundle,
    { mode: 'replay', replayStore: liveStore }
  )
  const mediaMissBundle = prepareBundle(
    'replay',
    control,
    controlBrowserA,
    alternateFrame
  )
  const mediaMissReport = await evaluateBundle(
    'replay-media-miss',
    mediaMissBundle,
    { mode: 'replay', replayStore: liveStore }
  )
  const changedRubric: RubricSpecV1 = {
    ...MIXED_RUBRIC,
    version: '2',
    criteria: MIXED_RUBRIC.criteria.map((criterion) =>
      criterion.id === 'motion'
        ? {
            ...criterion,
            passAnchors: [...criterion.passAnchors, 'motion remains stable'],
          }
        : criterion
    ),
  }
  const rubricMissBundle = prepareBundle(
    'replay',
    control,
    controlBrowserA,
    goodFrame,
    changedRubric
  )
  const rubricMissReport = await evaluateBundle(
    'replay-rubric-miss',
    rubricMissBundle,
    { mode: 'replay', replayStore: liveStore }
  )
  const changedProvider = { ...PROVIDER, version: '2' }
  const providerMissBundle = prepareBundle(
    'replay',
    control,
    controlBrowserA,
    goodFrame,
    MIXED_RUBRIC,
    changedProvider
  )
  const providerMissReport = await evaluateBundle(
    'replay-provider-miss',
    providerMissBundle,
    { mode: 'replay', replayStore: liveStore }
  )

  const noCallAdapter = fakeAdapter([])
  const noVisionStatePass = await simpleEvaluation({
    runName: 'no-vision-state-pass',
    artifact: control,
    trace: controlVmA,
    rubric: STATE_RUBRIC,
    mode: 'deterministic',
    deterministic: [deterministicState('pass')],
    evidenceByCriterion: {},
  })
  const noVisionModelPass = await simpleEvaluation({
    runName: 'no-vision-model-pass',
    artifact: control,
    trace: controlVmA,
    rubric: STATE_RUBRIC,
    mode: 'deterministic',
    deterministic: [deterministicState('pass', 'model')],
    evidenceByCriterion: {},
  })
  const noVisionFailure = await simpleEvaluation({
    runName: 'no-vision-fail',
    artifact: finalRegression,
    trace: finalBrowser,
    rubric: STATE_RUBRIC,
    mode: 'deterministic',
    deterministic: [deterministicState('fail')],
    evidenceByCriterion: {},
  })
  const noVisionMissing = await simpleEvaluation({
    runName: 'no-vision-missing',
    artifact: control,
    trace: controlBrowserA,
    rubric: TEMPORAL_RUBRIC,
    mode: 'live',
    deterministic: [],
    evidenceByCriterion: {
      motion: { status: 'missing', frameIds: [], clipIds: [] },
    },
    adapter: noCallAdapter,
  })
  const noVisionStale = await simpleEvaluation({
    runName: 'no-vision-stale',
    artifact: control,
    trace: controlBrowserA,
    rubric: TEMPORAL_RUBRIC,
    mode: 'live',
    deterministic: [],
    evidenceByCriterion: {
      motion: { status: 'stale', frameIds: [], clipIds: [] },
    },
    adapter: noCallAdapter,
  })
  const noVisionInfrastructure = await simpleEvaluation({
    runName: 'no-vision-infrastructure',
    artifact: control,
    trace: controlBrowserA,
    rubric: TEMPORAL_RUBRIC,
    mode: 'live',
    deterministic: [],
    evidenceByCriterion: {
      motion: {
        status: 'ready',
        frameIds: [goodFrame.frame.id],
        clipIds: [goodFrame.clipId],
      },
    },
    issues: [
      {
        code: 'multimodal-bench.infrastructure-stop',
        responsibility: 'infrastructure',
        message: 'the benchmark injected an explicit infrastructure stop',
      },
    ],
    adapter: noCallAdapter,
  })
  const screenshotCorrect = await simpleEvaluation({
    runName: 'screenshot-correct',
    artifact: control,
    trace: controlBrowserA,
    rubric: KEYFRAME_RUBRIC,
    mode: 'live',
    deterministic: [],
    evidenceByCriterion: {
      appearance: {
        status: 'ready',
        frameIds: [goodFrame.frame.id],
        clipIds: [],
      },
    },
    adapter: noCallAdapter,
  })
  const screenshotDefective = await simpleEvaluation({
    runName: 'screenshot-defective',
    artifact: finalRegression,
    trace: finalBrowser,
    rubric: KEYFRAME_RUBRIC,
    mode: 'live',
    deterministic: [],
    evidenceByCriterion: {
      appearance: {
        status: 'ready',
        frameIds: [defectiveFrame.frame.id],
        clipIds: [],
      },
    },
    adapter: noCallAdapter,
  })

  const escalationReports = [
    noVisionStatePass,
    noVisionModelPass,
    noVisionFailure,
    noVisionMissing,
    noVisionStale,
    noVisionInfrastructure,
    screenshotCorrect,
    screenshotDefective,
    goodLiveReport,
    badLiveReport,
  ]
  const escalation: EscalationSummary = {
    noVision: escalationReports.filter(
      (report) => escalationClass(report) === 'no-vision'
    ).length,
    screenshotOnly: escalationReports.filter(
      (report) => escalationClass(report) === 'screenshot-only'
    ).length,
    vlm: escalationReports.filter((report) => escalationClass(report) === 'vlm')
      .length,
    providerCalls: escalationReports.reduce(
      (total, report) =>
        total +
        report.calls.reduce(
          (callTotal, call) => callTotal + call.providerCallCount,
          0
        ),
      0
    ),
  }

  await addCase(
    'final-unchanged',
    'final-state',
    'two independent control runs agree exactly in final state',
    () =>
    {
      ensure(finalUnchanged.verdict === 'passed', 'final state did not agree')
      ensure(lens(finalUnchanged, 'final').verdict === 'agree', 'lens diverged')
      return {
        productionVerdict: finalUnchanged.verdict,
        observed: {
          leftFinalX: finalX(controlBrowserA),
          rightFinalX: finalX(controlBrowserB),
          independentExecutions: 2,
        },
        artifacts: [control.id],
        executions: [
          'movement-control-browser-a',
          'movement-control-browser-b',
        ],
      }
    }
  )
  await addCase(
    'final-allowed-change',
    'final-state',
    'a real nonzero intended final delta agrees only under its exact path tolerance',
    () =>
    {
      const left = finalX(controlBrowserA)
      const right = finalX(finalBrowser)
      ensure(left === 0 && right === 10, 'allowed-change witness drifted')
      ensure(finalAllowed.verdict === 'passed', 'allowed change did not pass')
      ensure(
        lens(finalAllowed, 'final-allowed').verdict === 'agree',
        'not agree'
      )
      return {
        productionVerdict: finalAllowed.verdict,
        observed: {
          path: `$.finalState.targetsById.${moverId}.x`,
          left,
          right,
          absoluteDelta: Math.abs(right - left),
          tolerance: 10,
        },
        artifacts: [control.id, finalRegression.id],
        executions: ['movement-control-browser-a', 'movement-final-browser'],
      }
    }
  )
  await addCase(
    'final-unintended-regression',
    'final-state',
    'the same real nonzero delta fails under zero tolerance',
    () =>
    {
      const result = lens(finalFailed, 'final')
      ensure(finalFailed.verdict === 'failed', 'regression did not fail')
      ensure(result.verdict === 'diverge', 'final lens did not diverge')
      ensure(result.differences.length > 0, 'final divergence has no witness')
      return {
        productionVerdict: finalFailed.verdict,
        observed: { differences: result.differences },
        artifacts: [control.id, finalRegression.id],
        executions: ['movement-control-browser-a', 'movement-final-browser'],
      }
    }
  )
  await addCase(
    'trace-unchanged',
    'labeled-trace',
    'two independent control traces agree at mid and end labels',
    () =>
    {
      ensure(traceUnchanged.verdict === 'passed', 'trace pair did not pass')
      ensure(
        lens(traceUnchanged, 'trace').verdict === 'agree',
        'trace diverged'
      )
      return {
        productionVerdict: traceUnchanged.verdict,
        observed: {
          leftMidX: targetX(controlVmA, 'mid'),
          rightMidX: targetX(controlVmB, 'mid'),
          leftEndX: targetX(controlVmA, 'end'),
          rightEndX: targetX(controlVmB, 'end'),
        },
        artifacts: [control.id],
        executions: ['movement-control-vm-a', 'movement-control-vm-b'],
      }
    }
  )
  await addCase(
    'trace-transient-divergence',
    'labeled-trace',
    'a real transient defect diverges at mid despite the same final state',
    () =>
    {
      const result = lens(traceTransient, 'trace')
      ensure(targetX(controlVmA, 'end') === 0, 'control final state drifted')
      ensure(targetX(transientVm, 'end') === 0, 'defective final state drifted')
      ensure(targetX(controlVmA, 'mid') === 10, 'control mid witness drifted')
      ensure(targetX(transientVm, 'mid') === 20, 'defect mid witness drifted')
      ensure(
        traceTransient.verdict === 'failed',
        'transient defect did not fail'
      )
      ensure(result.verdict === 'diverge', 'trace lens did not diverge')
      return {
        productionVerdict: traceTransient.verdict,
        observed: {
          controlMidX: 10,
          defectiveMidX: 20,
          controlEndX: 0,
          defectiveEndX: 0,
          differences: result.differences,
        },
        artifacts: [control.id, transientRegression.id],
        executions: ['movement-control-vm-a', 'movement-transient-vm'],
      }
    }
  )
  await addCase(
    'trace-missing-observation',
    'labeled-trace',
    'an explicitly removed required label is inconclusive, never agreement',
    () =>
    {
      const result = lens(traceMissing, 'trace')
      ensure(traceMissing.verdict === 'inconclusive', 'missing trace passed')
      ensure(result.verdict === 'inconclusive', 'missing lens was decisive')
      ensure(
        result.inconclusiveReason === 'observation-unavailable',
        'missing label has the wrong reason'
      )
      return {
        productionVerdict: traceMissing.verdict,
        observed: {
          beforeSnapshotCount: missingBefore,
          afterSnapshotCount: missingTrace.snapshots.length,
          reason: result.inconclusiveReason,
        },
        artifacts: [control.id],
        executions: ['movement-control-vm-a', 'movement-control-vm-b'],
        syntheticFault: {
          kind: 'trace-fault-injection',
          reason:
            'a healthy runner always emits declared snapshot steps, so the missing-observation contract needs an explicit trace fault',
          sourceTraceSha256: missingSourceTraceSha256,
          path: '$.snapshots[label="mid"]',
          before: missingBefore,
          after: missingTrace.snapshots.length,
        },
      }
    }
  )
  await addCase(
    'visual-unchanged',
    'visual-keyframes',
    'independent retained renderer frames agree under exact visual tolerances',
    () =>
    {
      const result = lens(visualUnchanged, 'visual')
      ensure(visualUnchanged.verdict === 'passed', 'visual pair did not pass')
      ensure(result.verdict === 'agree', 'visual pair diverged')
      ensure(result.evidence.length === 2, 'visual evidence is incomplete')
      return {
        productionVerdict: visualUnchanged.verdict,
        observed: {
          frameId: midFrameId,
          leftSha256: visualFrame(controlBrowserA, 6).sha256,
          rightSha256: visualFrame(controlBrowserB, 6).sha256,
          evidence: result.evidence,
        },
        artifacts: [control.id],
        executions: [
          'movement-control-browser-a',
          'movement-control-browser-b',
        ],
      }
    }
  )
  await addCase(
    'visual-known-regression',
    'visual-keyframes',
    'a real generated movement defect diverges in the retained mid keyframe',
    () =>
    {
      const result = lens(visualFailed, 'visual')
      ensure(
        visualFailed.verdict === 'failed',
        'visual regression did not fail'
      )
      ensure(result.verdict === 'diverge', 'visual lens did not diverge')
      ensure(result.differences.length > 0, 'visual divergence has no witness')
      ensure(result.evidence.length === 2, 'visual divergence lacks evidence')
      return {
        productionVerdict: visualFailed.verdict,
        observed: {
          controlMidX: targetX(controlBrowserA, 'mid'),
          defectiveMidX: targetX(finalBrowser, 'mid'),
          differences: result.differences,
          evidence: result.evidence,
        },
        artifacts: [control.id, finalRegression.id],
        executions: ['movement-control-browser-a', 'movement-final-browser'],
      }
    }
  )
  await addCase(
    'visual-renderer-unavailable',
    'visual-keyframes',
    'headless traces cannot satisfy a visual keyframe lens',
    () =>
    {
      const result = lens(visualUnavailable, 'visual')
      ensure(
        visualUnavailable.verdict === 'inconclusive',
        'headless visual passed'
      )
      ensure(
        result.inconclusiveReason === 'observation-unavailable',
        'headless visual has the wrong reason'
      )
      return {
        productionVerdict: visualUnavailable.verdict,
        observed: { reason: result.inconclusiveReason },
        artifacts: [control.id],
        executions: ['movement-control-vm-a', 'movement-control-vm-b'],
      }
    }
  )
  await addCase(
    'runtime-real-agreement',
    'runtime-differential',
    'real official headless and TurboWarp executions agree on supported lenses',
    () =>
    {
      ensure(runtimeAgreement.report.verdict === 'passed', 'runtimes diverged')
      ensure(
        runtimeAgreement.report.capabilityAssessment.classification ===
          'comparable',
        'movement runtime pair is not comparable'
      )
      ensure(
        runtimeAgreement.report.results.every(
          (result) => result.verdict === 'agree'
        ),
        'a required runtime lens did not agree'
      )
      const evidence = writeJsonEvidence(
        'differentials/runtime-real-agreement.json',
        'runtime-differential',
        runtimeAgreement.report
      )
      return {
        productionVerdict: runtimeAgreement.report.verdict,
        observed: {
          classification:
            runtimeAgreement.report.capabilityAssessment.classification,
          runtimes: [
            runtimeAgreement.officialHeadless.runtimeDescriptor.kind,
            runtimeAgreement.turboWarp.runtimeDescriptor.kind,
          ],
          lenses: runtimeAgreement.report.results,
        },
        artifacts: [control.id],
        executions: [
          'runtime-movement-official-headless',
          'runtime-movement-turbowarp',
        ],
        evidence: [evidence],
      }
    }
  )
  await addCase(
    'runtime-deliberate-normalized-mismatch',
    'runtime-differential',
    'an explicit normalized final-state fault is detected against real runtime evidence',
    () =>
    {
      const result = lens(runtimeMismatch, 'runtime-final')
      ensure(runtimeMismatch.verdict === 'failed', 'runtime fault did not fail')
      ensure(result.verdict === 'diverge', 'runtime fault did not diverge')
      const evidence = writeJsonEvidence(
        'differentials/runtime-deliberate-mismatch.json',
        'runtime-differential',
        runtimeMismatch
      )
      return {
        productionVerdict: runtimeMismatch.verdict,
        observed: {
          targetId: mismatchId,
          before: mismatchBefore,
          after: mismatchAfter,
          differences: result.differences,
        },
        artifacts: [control.id],
        executions: [
          'runtime-movement-official-headless',
          'runtime-movement-turbowarp',
        ],
        evidence: [evidence],
        syntheticFault: {
          kind: 'trace-fault-injection',
          reason:
            'the same admitted artifact genuinely agrees, so the deliberate normalized-mismatch contract needs an explicit observation fault',
          sourceTraceSha256: mismatchedSourceTraceSha256,
          path: `$.finalSnapshot.targetsById.${mismatchId}.x`,
          before: mismatchBefore,
          after: mismatchAfter,
        },
      }
    }
  )
  await addCase(
    'runtime-renderer-noncomparable',
    'runtime-differential',
    'a renderer-dependent collector is explicitly non-comparable in the cheap pair',
    () =>
    {
      const result = lens(rendererNoncomparable.report, 'collector-final')
      const renderer =
        rendererNoncomparable.report.capabilityAssessment.capabilities.find(
          (capability) => capability.kind === 'renderer'
        )
      ensure(
        rendererNoncomparable.report.verdict === 'inconclusive',
        'renderer-dependent differential was decisive'
      )
      ensure(
        rendererNoncomparable.report.capabilityAssessment.classification ===
          'unsupported',
        'renderer dependency was not classified unsupported'
      )
      ensure(renderer?.support === 'unsupported', 'renderer witness is absent')
      ensure(
        result.inconclusiveReason === 'unsupported-feature',
        'renderer non-comparability has the wrong reason'
      )
      const evidence = writeJsonEvidence(
        'differentials/runtime-renderer-noncomparable.json',
        'runtime-differential',
        rendererNoncomparable.report
      )
      return {
        productionVerdict: rendererNoncomparable.report.verdict,
        observed: {
          classification:
            rendererNoncomparable.report.capabilityAssessment.classification,
          renderer,
          reason: result.inconclusiveReason,
        },
        artifacts: [collector.id],
        executions: [
          'runtime-collector-official-headless',
          'runtime-collector-turbowarp',
        ],
        evidence: [evidence],
      }
    }
  )
  await addCase(
    'clone-lifecycle-unchanged',
    'clone-count-trace',
    'two real contained clone lifecycles agree and exhibit a nonzero transient clone',
    () =>
    {
      const result = lens(cloneUnchanged, 'clones')
      const maximum = Math.max(
        ...cloneContainedA.observations.cloneCounts.map(
          (sample) => sample.total
        )
      )
      const final = cloneContainedA.observations.cloneCounts.find(
        (sample) => sample.tick === 36
      )?.total
      ensure(maximum > 0, 'contained clone lifecycle never created a clone')
      ensure(final === 0, 'contained clone did not delete itself')
      ensure(cloneUnchanged.verdict === 'passed', 'clone reruns did not pass')
      ensure(result.verdict === 'agree', 'clone reruns diverged')
      return {
        productionVerdict: cloneUnchanged.verdict,
        observed: { maximumCloneCount: maximum, finalCloneCount: final },
        artifacts: [cloneContained.id],
        executions: ['clone-contained-vm-a', 'clone-contained-vm-b'],
      }
    }
  )
  await addCase(
    'clone-leak',
    'clone-count-trace',
    'a real generated missing-deletion defect leaves a final clone and diverges',
    () =>
    {
      const result = lens(cloneLeaked, 'clones')
      const containedFinal = cloneContainedA.observations.cloneCounts.find(
        (sample) => sample.tick === 36
      )?.total
      const leakedFinal = cloneLeakTrace.observations.cloneCounts.find(
        (sample) => sample.tick === 36
      )?.total
      ensure(containedFinal === 0, 'contained final clone count drifted')
      ensure((leakedFinal ?? 0) > 0, 'leak project has no final clone')
      ensure(cloneLeaked.verdict === 'failed', 'clone leak did not fail')
      ensure(result.verdict === 'diverge', 'clone leak lens did not diverge')
      return {
        productionVerdict: cloneLeaked.verdict,
        observed: {
          containedFinal,
          leakedFinal,
          differences: result.differences,
        },
        artifacts: [cloneContained.id, cloneLeakArtifact.id],
        executions: ['clone-contained-vm-a', 'clone-leak-vm'],
      }
    }
  )
  await addCase(
    'clone-observation-unsupported',
    'clone-count-trace',
    'disabled clone observation is explicitly inconclusive',
    () =>
    {
      const result = lens(cloneUnsupported, 'clones')
      ensure(
        cloneUnsupported.verdict === 'inconclusive',
        'disabled clones passed'
      )
      ensure(
        result.inconclusiveReason === 'observation-unavailable',
        'disabled clone observation has the wrong reason'
      )
      return {
        productionVerdict: cloneUnsupported.verdict,
        observed: { reason: result.inconclusiveReason },
        artifacts: [cloneContained.id],
        executions: ['clone-disabled-vm-a', 'clone-disabled-vm-b'],
      }
    }
  )
  await addCase(
    'replay-exact-hit',
    'replay',
    'the exact immutable request replays with zero provider calls, usage, and cost',
    () =>
    {
      const call = replayExactReport.calls[0]
      ensure(
        replayExactReport.verdict === 'passed',
        'exact replay did not pass'
      )
      ensure(call?.mode === 'replay', 'exact replay has no replay call')
      ensure(call.providerCallCount === 0, 'exact replay called a provider')
      ensure(call.usage.totalTokens === 0, 'exact replay charged tokens')
      ensure(
        call.cost.source === 'replay-zero',
        'exact replay cost is not zero'
      )
      ensure(call.cost.accountedUsd === 0, 'exact replay charged cost')
      return {
        productionVerdict: replayExactReport.verdict,
        observed: {
          requestKey: call.requestKey,
          providerCallCount: call.providerCallCount,
          usage: call.usage,
          cost: call.cost,
        },
        artifacts: [control.id],
        executions: ['movement-control-browser-a'],
        evidence: writeEvaluationEvidence(
          'replay-exact-hit',
          replayExactReport
        ),
      }
    }
  )
  for (const entry of [
    {
      id: 'replay-media-miss' as const,
      expectation:
        'changing only admitted media identity yields an exact replay miss',
      report: mediaMissReport,
      bundle: mediaMissBundle,
      observed: {
        liveRequestKey: goodBundle.request.requestKey,
        replayRequestKey: mediaMissBundle.request.requestKey,
        liveFrameSha256: goodFrame.frame.sha256,
        replayFrameSha256: alternateFrame.frame.sha256,
      },
    },
    {
      id: 'replay-rubric-miss' as const,
      expectation:
        'changing the trusted rubric identity yields an exact replay miss',
      report: rubricMissReport,
      bundle: rubricMissBundle,
      observed: {
        liveRequestKey: goodBundle.request.requestKey,
        replayRequestKey: rubricMissBundle.request.requestKey,
        liveRubricSha256: hashMultimodalJson(MIXED_RUBRIC),
        replayRubricSha256: hashMultimodalJson(changedRubric),
      },
    },
    {
      id: 'replay-provider-version-miss' as const,
      expectation: 'changing only provider version yields an exact replay miss',
      report: providerMissReport,
      bundle: providerMissBundle,
      observed: {
        liveRequestKey: goodBundle.request.requestKey,
        replayRequestKey: providerMissBundle.request.requestKey,
        liveProviderVersion: PROVIDER.version,
        replayProviderVersion: changedProvider.version,
      },
    },
  ])
  {
    await addCase(entry.id, 'replay', entry.expectation, () =>
    {
      ensure(
        entry.report.verdict === 'inconclusive',
        'replay miss was decisive'
      )
      ensure(entry.report.calls.length === 0, 'replay miss retained a call')
      ensure(
        entry.report.issues.some((issue) => issue.code === 'replay-miss'),
        'replay miss issue is absent'
      )
      ensure(
        entry.bundle.request.requestKey !== goodBundle.request.requestKey,
        'replay miss request key did not change'
      )
      return {
        productionVerdict: entry.report.verdict,
        observed: { ...entry.observed, issues: entry.report.issues },
        artifacts: [control.id],
        executions: ['movement-control-browser-a'],
        evidence: writeEvaluationEvidence(entry.id, entry.report),
      }
    })
  }

  await addCase(
    'vlm-malformed-output',
    'provider-output',
    'a malformed completed judgment fails closed after exactly one provider call',
    async () =>
    {
      const adapter = fakeAdapter([
        {
          kind: 'response',
          response: completedResponse({
            schemaVersion: MULTIMODAL_SCHEMA_VERSION,
            criteria: [],
          }),
        },
      ])
      const result = await executeLiveVlmEvaluation({
        rubric: MIXED_RUBRIC,
        request: goodBundle.request,
        budget: goodBundle.evaluationRequest.budget,
        budgetState: createVlmBudgetState(goodBundle.evaluationRequest.budget),
        adapter,
        replayStore: new InMemoryVlmReplayStore(),
      })
      ensure(result.outcome === 'inconclusive', 'malformed output was accepted')
      ensure(result.call?.outcome === 'invalid-response', 'wrong call outcome')
      ensure(adapter.callCount === 1, 'malformed case call count is not one')
      ensure(result.replayEntry === null, 'malformed output entered replay')
      const evidence = writeJsonEvidence(
        'provider-output/vlm-malformed-output.json',
        'vlm-execution',
        result
      )
      return {
        productionVerdict: result.outcome,
        observed: {
          callOutcome: result.call.outcome,
          issue: result.issue,
          providerCalls: adapter.callCount,
        },
        artifacts: [control.id],
        executions: ['movement-control-browser-a'],
        evidence: [evidence],
      }
    }
  )
  await addCase(
    'vlm-oversized-output',
    'provider-output',
    'a response beyond the canonical JSON bound fails closed after one call',
    async () =>
    {
      const adapter = new OversizedAdapter()
      const result = await executeLiveVlmEvaluation({
        rubric: MIXED_RUBRIC,
        request: goodBundle.request,
        budget: goodBundle.evaluationRequest.budget,
        budgetState: createVlmBudgetState(goodBundle.evaluationRequest.budget),
        adapter,
        replayStore: new InMemoryVlmReplayStore(),
      })
      ensure(result.outcome === 'inconclusive', 'oversized output was accepted')
      ensure(result.call?.outcome === 'invalid-response', 'wrong call outcome')
      ensure(adapter.callCount === 1, 'oversized case call count is not one')
      ensure(result.replayEntry === null, 'oversized output entered replay')
      const evidence = writeJsonEvidence(
        'provider-output/vlm-oversized-output.json',
        'vlm-execution',
        result
      )
      return {
        productionVerdict: result.outcome,
        observed: {
          hardLimitBytes: MAX_MULTIMODAL_JSON_BYTES,
          oversizedFieldLength: MAX_MULTIMODAL_JSON_BYTES + 1,
          callOutcome: result.call.outcome,
          issue: result.issue,
          providerCalls: adapter.callCount,
        },
        artifacts: [control.id],
        executions: ['movement-control-browser-a'],
        evidence: [evidence],
      }
    }
  )

  const budgetCases: Array<{
    id:
      | 'budget-call-limit'
      | 'budget-input-token-limit'
      | 'budget-output-token-limit'
      | 'budget-dollar-limit'
      | 'budget-media-limit'
      | 'budget-clip-limit'
    reason: string
    budget: VlmBudgetV1
  }> = [
    {
      id: 'budget-call-limit',
      reason: 'call-limit',
      budget: { ...goodBundle.evaluationRequest.budget, maxCalls: 0 },
    },
    {
      id: 'budget-input-token-limit',
      reason: 'input-token-limit',
      budget: { ...goodBundle.evaluationRequest.budget, maxInputTokens: 47 },
    },
    {
      id: 'budget-output-token-limit',
      reason: 'output-token-limit',
      budget: {
        ...goodBundle.evaluationRequest.budget,
        maxCumulativeOutputTokens: 63,
      },
    },
    {
      id: 'budget-dollar-limit',
      reason: 'cost-limit',
      budget: { ...goodBundle.evaluationRequest.budget, maxCostUsd: 0.009 },
    },
    {
      id: 'budget-media-limit',
      reason: 'media-byte-limit',
      budget: {
        ...goodBundle.evaluationRequest.budget,
        maxSubmittedMediaBytes: goodFrame.bytes.byteLength - 1,
      },
    },
    {
      id: 'budget-clip-limit',
      reason: 'clip-limit',
      budget: { ...goodBundle.evaluationRequest.budget, maxUniqueClips: 0 },
    },
  ]
  for (const entry of budgetCases)
  {
    await addCase(
      entry.id,
      'budget',
      `${entry.reason} blocks the provider before dispatch`,
      async () =>
      {
        const adapter = fakeAdapter([])
        const result = await executeLiveVlmEvaluation({
          rubric: MIXED_RUBRIC,
          request: goodBundle.request,
          budget: entry.budget,
          budgetState: createVlmBudgetState(entry.budget),
          adapter,
          replayStore: new InMemoryVlmReplayStore(),
        })
        ensure(result.outcome === 'inconclusive', 'denied budget was decisive')
        ensure(result.call === null, 'denied budget retained a call record')
        ensure(adapter.callCount === 0, 'denied budget dispatched provider')
        ensure(
          result.issue?.code === 'vlm-budget-exhausted',
          'denied budget has the wrong issue'
        )
        ensure(
          result.issue.message.includes(entry.reason),
          `denied budget did not report ${entry.reason}`
        )
        return {
          productionVerdict: result.outcome,
          observed: {
            reason: entry.reason,
            issue: result.issue,
            providerCalls: adapter.callCount,
            budget: entry.budget,
          },
          artifacts: [control.id],
          executions: ['movement-control-browser-a'],
        }
      }
    )
  }

  await addCase(
    'budget-temporal-evidence-bytes',
    'budget',
    'a real rendered frame exceeding the temporal byte budget fails capture',
    async () =>
    {
      const plan: ObservationPlanV1 = {
        schemaVersion: 1,
        temporal: {
          firstTick: 0,
          lastTick: 0,
          everyTicks: 6,
          playbackFps: 10,
          maxFrames: 1,
          maxBytes: 1,
          derivedVideo: false,
        },
        cloneCounts: 'none',
      }
      const trace = await browserExecution(
        'temporal-evidence-budget-browser',
        control,
        { seed: 43, fixedDateMs: 1_700_000_000_000, steps: [] },
        plan
      )
      const issue = trace.issues.find(
        (current) => current.code === RUN_ISSUE_CODES.observationBudgetExceeded
      )
      ensure(!trace.ok, 'one-byte temporal budget unexpectedly passed')
      ensure(issue, 'temporal evidence budget issue is absent')
      ensure(
        trace.observations.media === null ||
          trace.observations.media.complete === false,
        'failed temporal budget retained a complete manifest'
      )
      return {
        productionVerdict: 'inconclusive',
        observed: {
          maxBytes: 1,
          issue,
          mediaComplete: trace.observations.media?.complete ?? null,
          incompleteReason: trace.observations.media?.incompleteReason ?? null,
        },
        artifacts: [control.id],
        executions: ['temporal-evidence-budget-browser'],
      }
    }
  )

  const escalationCases: Array<{
    id:
      | 'escalation-no-vision-state-pass'
      | 'escalation-no-vision-model-pass'
      | 'escalation-no-vision-deterministic-fail'
      | 'escalation-no-vision-missing-evidence'
      | 'escalation-no-vision-stale-evidence'
      | 'escalation-no-vision-infrastructure-stop'
      | 'escalation-screenshot-correct'
      | 'escalation-screenshot-defective'
      | 'escalation-vlm-good'
      | 'escalation-vlm-defective'
    expectedClass: 'no-vision' | 'screenshot-only' | 'vlm'
    expectedVerdict: 'passed' | 'failed' | 'inconclusive'
    report: Readonly<MultimodalEvaluationReportV1>
    artifactIds: string[]
    executionIds: string[]
  }> = [
    {
      id: 'escalation-no-vision-state-pass',
      expectedClass: 'no-vision',
      expectedVerdict: 'passed',
      report: noVisionStatePass,
      artifactIds: [control.id],
      executionIds: ['movement-control-vm-a'],
    },
    {
      id: 'escalation-no-vision-model-pass',
      expectedClass: 'no-vision',
      expectedVerdict: 'passed',
      report: noVisionModelPass,
      artifactIds: [control.id],
      executionIds: ['movement-control-vm-a'],
    },
    {
      id: 'escalation-no-vision-deterministic-fail',
      expectedClass: 'no-vision',
      expectedVerdict: 'failed',
      report: noVisionFailure,
      artifactIds: [finalRegression.id],
      executionIds: ['movement-final-browser'],
    },
    {
      id: 'escalation-no-vision-missing-evidence',
      expectedClass: 'no-vision',
      expectedVerdict: 'inconclusive',
      report: noVisionMissing,
      artifactIds: [control.id],
      executionIds: ['movement-control-browser-a'],
    },
    {
      id: 'escalation-no-vision-stale-evidence',
      expectedClass: 'no-vision',
      expectedVerdict: 'inconclusive',
      report: noVisionStale,
      artifactIds: [control.id],
      executionIds: ['movement-control-browser-a'],
    },
    {
      id: 'escalation-no-vision-infrastructure-stop',
      expectedClass: 'no-vision',
      expectedVerdict: 'inconclusive',
      report: noVisionInfrastructure,
      artifactIds: [control.id],
      executionIds: ['movement-control-browser-a'],
    },
    {
      id: 'escalation-screenshot-correct',
      expectedClass: 'screenshot-only',
      expectedVerdict: 'inconclusive',
      report: screenshotCorrect,
      artifactIds: [control.id],
      executionIds: ['movement-control-browser-a'],
    },
    {
      id: 'escalation-screenshot-defective',
      expectedClass: 'screenshot-only',
      expectedVerdict: 'inconclusive',
      report: screenshotDefective,
      artifactIds: [finalRegression.id],
      executionIds: ['movement-final-browser'],
    },
    {
      id: 'escalation-vlm-good',
      expectedClass: 'vlm',
      expectedVerdict: 'passed',
      report: goodLiveReport,
      artifactIds: [control.id],
      executionIds: ['movement-control-browser-a'],
    },
    {
      id: 'escalation-vlm-defective',
      expectedClass: 'vlm',
      expectedVerdict: 'failed',
      report: badLiveReport,
      artifactIds: [finalRegression.id],
      executionIds: ['movement-final-browser'],
    },
  ]
  for (const entry of escalationCases)
  {
    await addCase(
      entry.id,
      'escalation',
      `${entry.expectedClass} selection with ${entry.expectedVerdict} aggregate verdict`,
      () =>
      {
        const classification = escalationClass(entry.report)
        const providerCalls = entry.report.calls.reduce(
          (total, call) => total + call.providerCallCount,
          0
        )
        ensure(
          classification === entry.expectedClass,
          `expected ${entry.expectedClass}, observed ${classification}`
        )
        ensure(
          entry.report.verdict === entry.expectedVerdict,
          `expected ${entry.expectedVerdict}, observed ${entry.report.verdict}`
        )
        if (classification === 'vlm')
          ensure(
            providerCalls === 1,
            'VLM matrix case did not call exactly once'
          )
        else
          ensure(providerCalls === 0, 'non-VLM matrix case called a provider')
        return {
          productionVerdict: entry.report.verdict,
          observed: {
            classification,
            providerCalls,
            selection: entry.report.selection,
            issues: entry.report.issues,
          },
          artifacts: entry.artifactIds,
          executions: entry.executionIds,
          evidence: writeEvaluationEvidence(entry.id, entry.report),
        }
      }
    )
  }

  ensure(cases.length === EXPECTED_CASE_IDS.length, 'case count drifted')
  ensure(
    cases.every((entry, index) => entry.id === EXPECTED_CASE_IDS[index]),
    'case order or identity drifted from the canonical ledger'
  )
  ensure(
    new Set(cases.map((entry) => entry.id)).size === cases.length,
    'duplicate case ID'
  )
  ensure(
    escalation.noVision === 6 &&
      escalation.screenshotOnly === 2 &&
      escalation.vlm === 2 &&
      escalation.providerCalls === 2,
    `escalation matrix drifted: ${JSON.stringify(escalation)}`
  )
  ensure(noCallAdapter.callCount === 0, 'no-call escalation adapter was called')
  ensure(goodAdapter.callCount === 1, 'good VLM case call count drifted')
  ensure(badAdapter.callCount === 1, 'defective VLM case call count drifted')

  const artifactReports: ArtifactReport[] = [...artifacts.values()].map(
    ({ bytes: _bytes, ...artifact }) => ({
      ...artifact,
      executedBy: [...artifact.executedBy].sort(),
    })
  )
  const correctArtifactsExecuted = artifactReports.filter(
    (artifact) => artifact.role === 'correct' && artifact.executedBy.length > 0
  ).length
  const defectiveArtifactsExecuted = artifactReports.filter(
    (artifact) =>
      artifact.role === 'deliberately-defective' &&
      artifact.executedBy.length > 0
  ).length
  ensure(correctArtifactsExecuted > 0, 'no correct artifact was executed')
  ensure(defectiveArtifactsExecuted > 0, 'no defective artifact was executed')
  const passed = cases.filter((entry) => entry.ok).length
  const definitionSha256 = hashMultimodalJson({
    id: 'multimodal-deterministic-acceptance-corpus',
    version: '1',
    expectedCaseIds: EXPECTED_CASE_IDS,
    artifactDefinitions: artifactReports.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      construction: artifact.construction,
    })),
  })
  const report: MultimodalBenchmarkReport = {
    schemaVersion: 1,
    runId,
    createdAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, performance.now() - startedAt),
    ok: passed === cases.length,
    claimScope:
      'No regression was observed only for the recorded generated artifacts, scenarios, seeds, lenses, runtimes, budgets, and deterministic fake-provider boundaries.',
    sourceRevision: sourceRevision(),
    versions: collectVersions(),
    corpus: {
      id: 'multimodal-deterministic-acceptance-corpus',
      version: '1',
      definitionSha256,
      expectedCaseIds: EXPECTED_CASE_IDS,
    },
    artifacts: artifactReports,
    executions,
    cases,
    escalation,
    totals: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
      correctArtifactsExecuted,
      defectiveArtifactsExecuted,
      syntheticFaults: cases.filter((entry) => entry.syntheticFault !== null)
        .length,
    },
  }
  hardenRunPermissions(runRoot)
  const json = `${JSON.stringify(report, null, 2)}\n`
  const markdown = caseMarkdown(report)
  writeExclusive(join(runRoot, 'multimodal-bench.json'), json)
  writeExclusive(join(runRoot, 'multimodal-bench.md'), markdown)
  console.log(
    `\n${passed}/${cases.length} passed -> ${join(runRoot, 'multimodal-bench.md')}`
  )
  if (!report.ok) process.exitCode = 1
}

main().catch((error: unknown) =>
{
  console.error(scrubError(error))
  process.exitCode = 1
})
