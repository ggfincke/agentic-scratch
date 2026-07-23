// scripts/multimodal/project-check.ts
// run bounded Multimodal selected-project integration & exact retained agent replay

import { performance } from 'node:perf_hooks'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from 'node:path'

import {
  MULTIMODAL_SCHEMA_VERSION,
  hashMultimodalJson,
  runCheapRuntimeDifferential,
  runProjectCheckFile,
  validateRubricSpec,
  type BehavioralLensSpecV1,
  type DifferentialReportV1,
  type MultimodalEvaluationReportV1,
  type RubricSpecV1,
} from '@scratch-agent/eval'

import { portableRelativePath } from '../lib/path.js'
import {
  ensurePrivateDirectory,
  writeExclusivePrivateFile,
} from '../lib/private-fs.js'
import {
  hashObservationPlan,
  hashScenario,
  newRunId,
  observationTicks,
  sha256,
  validateObservationPlan,
  verifyMediaManifest,
  type BrowserTrace,
  type ObservationPlanV1,
  type Scenario,
  type VmTrace,
} from '@scratch-agent/runner'

import {
  MULTIMODAL_SELECTED_INPUT_MAX_BYTES,
  MULTIMODAL_SELECTED_RUBRIC_MAX_BYTES,
  multimodalCurrentSourceIdentity,
  multimodalSelectedCriteriaPath,
  multimodalSelectedProjectObservationPlan,
  multimodalSelectedProjectScenario,
  multimodalSourceRevision,
  readMultimodalBoundedRegularFile,
  requireRunRootOutsideSourceInventory,
  verifyMultimodalRetainedSourceIdentity,
} from '@scratch-agent/eval'
import {
  loadMultimodalAgentRecordReport,
  loadValidatedMultimodalAgentRun,
  replayRetainedJudgment,
  verifyMultimodalRetainedJudgmentInputs,
  type MultimodalAgentRecordReportV3,
  type PersistedMultimodalEvaluationInputV1,
} from './live-workflow.js'
import {
  CODEX_EXEC_ADAPTER_VERSION,
  codexExecDescriptorVersion,
} from './codex-adapter.js'

const MAX_RETAINED_JSON_BYTES = 16 * 1024 * 1024

interface CliOptions
{
  input: string
  replayRun: string
  runsRoot: string
}

interface RetainedArtifact
{
  relativePath: string
  sha256: string
  bytes: number
}

interface MultimodalProjectCheckReportV2
{
  schemaVersion: 2
  reportKind: 'multimodal-project-check'
  runId: string
  createdAt: string
  completedAt: string
  durationMs: number
  sourceRevision: string
  input: {
    displayName: string
    byteLengthBefore: number
    sha256Before: string
    byteLengthAfter: number | null
    sha256After: string | null
    exactPreserved: boolean
    retained: RetainedArtifact
  }
  rubric: {
    id: string
    version: string
    sha256: string
    retained: RetainedArtifact
  }
  scenario: Scenario
  observation: {
    plan: ObservationPlanV1
    admitted: boolean
    theoreticalFrameCount: number | null
  }
  projectCheck: {
    status: 'passed' | 'failed' | 'not-run'
    inputIdentityMatched: boolean
    reportJsonRelativePath: string | null
    reportMarkdownRelativePath: string | null
    reportJsonSha256: string | null
  }
  differential: {
    completed: boolean
    officialOk: boolean | null
    turboWarpOk: boolean | null
    verdict: DifferentialReportV1['verdict'] | null
    capabilityStatus:
      DifferentialReportV1['capabilityAssessment']['status'] | null
    capabilityClassification:
      DifferentialReportV1['capabilityAssessment']['classification'] | null
    lensVerdicts: Array<{
      id: string
      kind: string
      required: boolean
      verdict: string
      reason: string | null
    }>
    report: RetainedArtifact | null
    officialTrace: RetainedArtifact | null
    turboWarpTrace: RetainedArtifact | null
    browserMedia: {
      complete: boolean
      frameCount: number
      totalFrameBytes: number
      ticks: number[]
      plannedTicksMatched: boolean
      verificationIssueCount: number
    } | null
  }
  replay: {
    sourceRunId: string | null
    sourceMode: string | null
    sourceCorpusAcceptance: string | null
    agentTransport: string | null
    agentProviderDescriptor: MultimodalAgentRecordReportV3['provider'] | null
    agentAdapterVersion: string | null
    agentCliVersion: string | null
    agentModel: string | null
    agentReasoningEffort: string | null
    authoritativeAgentExecution: boolean
    agentBindingMatched: boolean
    sourceBindingMatched: boolean
    selectedJudgmentPresent: boolean
    artifactBindingMatched: boolean
    rubricBindingMatched: boolean
    scenarioBindingMatched: boolean
    observationPlanBindingMatched: boolean
    reportBindingsMatched: boolean
    originalVerdict: string | null
    replayVerdict: string | null
    exactVerdictAndRubricMatch: boolean
    agentExecutions: number | null
    reportJsonRelativePath: string | null
    reportMarkdownRelativePath: string | null
  }
  acceptance: {
    status: 'passed' | 'failed'
    checks: Array<{ id: string; passed: boolean; detail: string }>
  }
  issues: string[]
  claimScope: string
  limitations: string[]
}

function usage(): never
{
  throw new Error(
    'usage: npm run multimodal-project-check -- --input <path.sb3> --replay-run <recorded-run> [--runs-root <dir>]'
  )
}

function parseArgs(argv: string[]): CliOptions
{
  let input: string | undefined
  let replayRun: string | undefined
  let runsRoot = 'runs'
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index++)
  {
    const flag = argv[index]
    if (flag !== '--input' && flag !== '--replay-run' && flag !== '--runs-root')
      usage()
    if (seen.has(flag)) usage()
    seen.add(flag)
    const value = argv[++index]
    if (!value || value.startsWith('--')) usage()
    if (flag === '--input') input = value
    else if (flag === '--replay-run') replayRun = value
    else runsRoot = value
  }
  if (!input || !replayRun) usage()
  return { input, replayRun, runsRoot }
}

function ensureDirectory(path: string): void
{
  ensurePrivateDirectory(path)
}

function portable(base: string, path: string): string
{
  return portableRelativePath(base, path)
}

function retainedSourcePath(root: string, relativePath: string): string
{
  if (isAbsolute(relativePath))
    throw new Error('retained source path must be relative')
  const resolvedRoot = resolve(root)
  const path = resolve(resolvedRoot, relativePath)
  if (path !== resolvedRoot && !path.startsWith(`${resolvedRoot}${sep}`))
    throw new Error('retained source path escapes the recorded run')
  return path
}

function writeExclusive(
  runRoot: string,
  path: string,
  value: string | Uint8Array
): RetainedArtifact
{
  ensureDirectory(dirname(path))
  writeExclusivePrivateFile(path, value)
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return {
    relativePath: portable(runRoot, path),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  }
}

function writeJson(
  runRoot: string,
  path: string,
  value: unknown
): RetainedArtifact
{
  return writeExclusive(runRoot, path, JSON.stringify(value, null, 2) + '\n')
}

function loadRubric(path: string): RubricSpecV1
{
  const parsed = JSON.parse(
    readMultimodalBoundedRegularFile(
      path,
      MULTIMODAL_SELECTED_RUBRIC_MAX_BYTES,
      'selected rubric'
    ).toString('utf8')
  ) as unknown
  const validated = validateRubricSpec(parsed)
  if (!validated.ok)
    throw new Error(
      `invalid Multimodal rubric: ${validated.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}`
    )
  return structuredClone(validated.value) as RubricSpecV1
}

function selectedLensSpecs(): BehavioralLensSpecV1[]
{
  return [
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'selected-final-state',
      kind: 'final-state',
      required: true,
      appliesTo: 'runtime-runtime',
      absoluteNumericTolerance: 0,
    },
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'selected-labeled-trace',
      kind: 'labeled-trace',
      required: true,
      appliesTo: 'runtime-runtime',
      labels: ['before-green-flag', 'after-green-flag', 'settled'],
      absoluteNumericTolerance: 0,
    },
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'selected-runtime-outcome',
      kind: 'runtime-outcome',
      required: true,
      appliesTo: 'runtime-runtime',
    },
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'selected-clone-counts',
      kind: 'clone-count-trace',
      required: true,
      appliesTo: 'runtime-runtime',
      ticks: [0, 15, 30],
    },
    {
      schemaVersion: MULTIMODAL_SCHEMA_VERSION,
      id: 'selected-renderer-keyframes',
      kind: 'visual-keyframes',
      required: false,
      appliesTo: 'runtime-runtime',
      frameIds: [
        'temporal-frame-0000',
        'temporal-frame-0001',
        'temporal-frame-0002',
      ],
      maxMeanRgbDelta: 24,
      maxNormalizedRectDelta: 0.05,
    },
  ]
}

function reportMarkdown(report: MultimodalProjectCheckReportV2): string
{
  return [
    '# Multimodal selected-project check',
    '',
    `**${report.acceptance.status.toUpperCase()}**`,
    '',
    `- run: \`${report.runId}\``,
    `- input: \`${report.input.displayName}\``,
    `- source SHA-256: \`${report.input.sha256Before}\``,
    `- exact source preservation: ${report.input.exactPreserved ? 'yes' : 'no'}`,
    `- observation plan: ${report.observation.admitted ? 'admitted' : 'rejected'} (${report.observation.theoreticalFrameCount ?? 'unknown'} frames)`,
    `- generic project-check: \`${report.projectCheck.status}\``,
    `- runtime differential: \`${report.differential.verdict ?? 'not run'}\``,
    `- capability classification: \`${report.differential.capabilityClassification ?? 'not run'}\``,
    `- retained agent judgment replay: ${report.replay.exactVerdictAndRubricMatch ? 'exact' : 'not exact'}`,
    `- authoritative agent execution: ${report.replay.authoritativeAgentExecution && report.replay.agentBindingMatched ? 'yes' : 'no'} (${report.replay.agentTransport ?? 'not run'}; current binding ${report.replay.agentBindingMatched ? 'yes' : 'no'})`,
    `- agent provider descriptor: \`${report.replay.agentProviderDescriptor === null ? 'not run' : JSON.stringify(report.replay.agentProviderDescriptor)}\``,
    `- agent adapter version: \`${report.replay.agentAdapterVersion ?? 'not run'}\``,
    `- Codex CLI: \`${report.replay.agentCliVersion ?? 'not run'}\``,
    `- agent model: \`${report.replay.agentModel ?? 'not run'}\``,
    `- reasoning effort: \`${report.replay.agentReasoningEffort ?? 'not run'}\``,
    `- replay agent executions: ${report.replay.agentExecutions ?? 'not run'}`,
    '',
    '## Acceptance checks',
    '',
    ...report.acceptance.checks.map(
      (check) =>
        `- ${check.passed ? 'PASS' : 'FAIL'} \`${check.id}\`: ${check.detail}`
    ),
    '',
    '## Claim boundary',
    '',
    report.claimScope,
    '',
    '## Limitations',
    '',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    ...(report.issues.length > 0
      ? ['', '## Issues', '', ...report.issues.map((issue) => `- ${issue}`)]
      : []),
    '',
  ].join('\n')
}

function traceArtifact(
  runRoot: string,
  path: string,
  trace: VmTrace | BrowserTrace
): RetainedArtifact
{
  return writeJson(runRoot, path, trace)
}

async function main(): Promise<void>
{
  const options = parseArgs(process.argv.slice(2))
  const started = performance.now()
  const runId = `multimodal-project-check-${newRunId()}`
  const runRoot = resolve(options.runsRoot, runId)
  requireRunRootOutsideSourceInventory(runRoot)
  ensureDirectory(runRoot)
  const createdAt = new Date().toISOString()
  const inputPath = resolve(options.input)
  const rubricPath = multimodalSelectedCriteriaPath()
  const replayRun = resolve(options.replayRun)
  const currentSourceAtStart = multimodalCurrentSourceIdentity()
  const sourceBytes = Uint8Array.from(
    readMultimodalBoundedRegularFile(
      inputPath,
      MULTIMODAL_SELECTED_INPUT_MAX_BYTES,
      'selected input'
    )
  )
  const sourceHash = sha256(sourceBytes)
  const retainedInput = writeExclusive(
    runRoot,
    join(runRoot, 'selected-project.sb3'),
    sourceBytes
  )
  const rubric = loadRubric(rubricPath)
  const rubricHash = hashMultimodalJson(rubric)
  const retainedRubric = writeJson(
    runRoot,
    join(runRoot, 'rubric.json'),
    rubric
  )
  const scenario = multimodalSelectedProjectScenario()
  const observationPlan = multimodalSelectedProjectObservationPlan()
  const scenarioHash = hashScenario(scenario)
  const observationPlanHash = hashObservationPlan(observationPlan)
  const planValidation = validateObservationPlan(observationPlan)
  if (!planValidation.ok)
    throw new Error(
      `selected observation plan was rejected: ${planValidation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}`
    )

  const issues: string[] = []
  const projectCheckRoot = join(runRoot, 'project-check')
  let projectCheckStatus: MultimodalProjectCheckReportV2['projectCheck']['status'] =
    'not-run'
  let projectCheckInputIdentityMatched = false
  let projectCheckJson: string | null = null
  let projectCheckMarkdown: string | null = null
  let projectCheckJsonSha256: string | null = null
  try
  {
    const result = await runProjectCheckFile({
      inputPath: join(runRoot, retainedInput.relativePath),
      run: {
        id: `${runId}-generic`,
        root: projectCheckRoot,
        sourceRevision: multimodalSourceRevision(),
      },
      profile: 'full',
      strictStatic: false,
    })
    projectCheckStatus = result.report.overall.status
    projectCheckInputIdentityMatched =
      result.report.input.sha256 === sourceHash &&
      result.report.input.byteLength === sourceBytes.byteLength
    const jsonPath = join(result.runRoot, 'project-check.json')
    const markdownPath = join(result.runRoot, 'project-check.md')
    projectCheckJson = portable(runRoot, jsonPath)
    projectCheckMarkdown = portable(runRoot, markdownPath)
    projectCheckJsonSha256 = sha256(
      readMultimodalBoundedRegularFile(
        jsonPath,
        MAX_RETAINED_JSON_BYTES,
        'generic project-check JSON report'
      )
    )
  }
  catch (error)
  {
    projectCheckStatus = 'failed'
    issues.push(
      `generic project-check failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  let officialTrace: VmTrace | null = null
  let turboWarpTrace: BrowserTrace | null = null
  let differentialReport: Readonly<DifferentialReportV1> | null = null
  let differentialArtifact: RetainedArtifact | null = null
  let officialArtifact: RetainedArtifact | null = null
  let turboWarpArtifact: RetainedArtifact | null = null
  let browserMedia: MultimodalProjectCheckReportV2['differential']['browserMedia'] =
    null
  try
  {
    const differential = await runCheapRuntimeDifferential(
      sourceBytes,
      scenario,
      {
        browser: {
          screenshotDir: join(runRoot, 'differential', 'screenshots'),
          mediaDir: join(runRoot, 'differential', 'media'),
        },
        observationPlan,
        specs: selectedLensSpecs(),
      }
    )
    officialTrace = differential.officialHeadless
    turboWarpTrace = differential.turboWarp
    differentialReport = differential.report
    officialArtifact = traceArtifact(
      runRoot,
      join(runRoot, 'differential', 'official-headless-trace.json'),
      officialTrace
    )
    turboWarpArtifact = traceArtifact(
      runRoot,
      join(runRoot, 'differential', 'turbowarp-trace.json'),
      turboWarpTrace
    )
    differentialArtifact = writeJson(
      runRoot,
      join(runRoot, 'differential', 'differential-report.json'),
      differentialReport
    )
    const manifest = turboWarpTrace.observations.media
    if (manifest)
    {
      const mediaIssues = verifyMediaManifest(
        manifest,
        join(runRoot, 'differential', 'media'),
        observationPlan
      )
      browserMedia = {
        complete: manifest.complete,
        frameCount: manifest.frames.length,
        totalFrameBytes: manifest.totalFrameBytes,
        ticks: manifest.frames.map((frame) => frame.tick),
        plannedTicksMatched:
          hashMultimodalJson(manifest.frames.map((frame) => frame.tick)) ===
          hashMultimodalJson(observationTicks(observationPlan)),
        verificationIssueCount: mediaIssues.length,
      }
      if (mediaIssues.length > 0)
        issues.push(
          `TurboWarp media verification found ${mediaIssues.length} issues: ${mediaIssues
            .slice(0, 3)
            .map((issue) => `${issue.path} ${issue.message}`)
            .join('; ')}`
        )
    }
  }
  catch (error)
  {
    issues.push(
      `runtime differential failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  let sourceRunId: string | null = null
  let sourceMode: string | null = null
  let sourceCorpusAcceptance: string | null = null
  let agentTransport: string | null = null
  let agentProviderDescriptor:
    MultimodalAgentRecordReportV3['provider'] | null = null
  let agentAdapterVersion: string | null = null
  let agentCliVersion: string | null = null
  let agentModel: string | null = null
  let agentReasoningEffort: string | null = null
  let authoritativeAgentExecution = false
  let agentBindingMatched = false
  let sourceBindingMatched = false
  let expectedAgentDescriptor:
    MultimodalAgentRecordReportV3['provider'] | null = null
  let selectedJudgmentPresent = false
  let artifactBindingMatched = false
  let rubricBindingMatched = false
  let scenarioBindingMatched = false
  let observationPlanBindingMatched = false
  let reportBindingsMatched = false
  let originalReplayReport: MultimodalEvaluationReportV1 | null = null
  let replayReport: Readonly<MultimodalEvaluationReportV1> | null = null
  let replayJsonPath: string | null = null
  let replayMarkdownPath: string | null = null
  try
  {
    const declaredRecord = loadMultimodalAgentRecordReport(replayRun)
    sourceRunId = declaredRecord.runId
    sourceMode = declaredRecord.mode
    sourceCorpusAcceptance = declaredRecord.acceptance.status
    agentTransport = declaredRecord.agentExecution.transport
    const agentRecord = await loadValidatedMultimodalAgentRun(replayRun)
    agentProviderDescriptor = structuredClone(agentRecord.provider)
    agentAdapterVersion = agentRecord.agentExecution.adapterVersion
    agentCliVersion = agentRecord.agentExecution.cliVersion
    agentModel = agentRecord.agentExecution.model
    agentReasoningEffort = agentRecord.agentExecution.reasoningEffort
    agentTransport = agentRecord.agentExecution.transport
    authoritativeAgentExecution =
      agentRecord.agentExecution.authoritative &&
      agentRecord.agentExecution.transport === 'codex-cli'
    expectedAgentDescriptor = agentRecord.provider
    agentBindingMatched =
      agentRecord.provider.adapter === 'codex-cli' &&
      agentRecord.provider.provider === 'codex-agent' &&
      agentRecord.agentExecution.adapterVersion ===
        CODEX_EXEC_ADAPTER_VERSION &&
      agentRecord.provider.version ===
        codexExecDescriptorVersion(
          agentRecord.agentExecution.cliVersion,
          agentRecord.agentExecution.reasoningEffort
        )
    sourceBindingMatched =
      currentSourceAtStart.issue === null &&
      currentSourceAtStart.executionArtifactsIssue === null &&
      verifyMultimodalRetainedSourceIdentity(replayRun, agentRecord.source) &&
      agentRecord.source.commit === currentSourceAtStart.commit &&
      agentRecord.source.startManifest.treeSha256 ===
        currentSourceAtStart.treeSha256 &&
      agentRecord.source.completionManifest.treeSha256 ===
        currentSourceAtStart.treeSha256 &&
      agentRecord.source.executionArtifacts.startManifest.treeSha256 ===
        currentSourceAtStart.executionArtifactsTreeSha256 &&
      agentRecord.source.executionArtifacts.completionManifest.treeSha256 ===
        currentSourceAtStart.executionArtifactsTreeSha256
    const selected = agentRecord.selectedProject
    selectedJudgmentPresent = selected !== null
    if (!selected)
      throw new Error('recorded run has no selected-project judgment')
    const evaluationInputPath = retainedSourcePath(
      replayRun,
      selected.evaluationInputRelativePath
    )
    const evaluationInput = JSON.parse(
      readMultimodalBoundedRegularFile(
        evaluationInputPath,
        MAX_RETAINED_JSON_BYTES,
        'recorded selected-project evaluation input'
      ).toString('utf8')
    ) as PersistedMultimodalEvaluationInputV1
    if (evaluationInput.schemaVersion !== 1)
      throw new Error(
        'recorded selected-project evaluation input version is invalid'
      )
    const retainedInputs = verifyMultimodalRetainedJudgmentInputs(
      replayRun,
      selected
    )
    artifactBindingMatched =
      retainedInputs.artifact &&
      selected.artifact.sha256 === sourceHash &&
      selected.artifact.byteLength === sourceBytes.byteLength &&
      evaluationInput.request.input.artifactSha256 === sourceHash &&
      evaluationInput.request.input.byteLength === sourceBytes.byteLength
    rubricBindingMatched =
      retainedInputs.rubric &&
      selected.rubric.sha256 === rubricHash &&
      hashMultimodalJson(evaluationInput.request.rubric) === rubricHash
    agentBindingMatched =
      agentBindingMatched &&
      evaluationInput.request.vlmPolicy !== null &&
      hashMultimodalJson(evaluationInput.request.vlmPolicy.provider) ===
        hashMultimodalJson(expectedAgentDescriptor)
    scenarioBindingMatched =
      evaluationInput.request.scenarioSha256 === scenarioHash
    observationPlanBindingMatched =
      hashObservationPlan(evaluationInput.request.observationPlan) ===
      observationPlanHash
    if (!artifactBindingMatched)
      throw new Error('recorded selected-project artifact binding is stale')
    if (!rubricBindingMatched)
      throw new Error('recorded selected-project rubric binding is stale')
    if (!scenarioBindingMatched)
      throw new Error('recorded selected-project scenario binding is stale')
    if (!observationPlanBindingMatched)
      throw new Error(
        'recorded selected-project observation-plan binding is stale'
      )
    if (agentRecord.mode !== 'agent')
      throw new Error(
        'selected-project replay needs an authoritative agent run'
      )
    const replayed = await replayRetainedJudgment({
      runRoot: replayRun,
      judgment: selected,
      outputRoot: join(runRoot, 'replay'),
      outputBaseRoot: runRoot,
    })
    originalReplayReport = replayed.original
    replayReport = replayed.report
    const reportBindingMatches = (
      report: Readonly<MultimodalEvaluationReportV1>
    ): boolean =>
      report.input.artifactSha256 === sourceHash &&
      report.input.byteLength === sourceBytes.byteLength &&
      report.rubricSha256 === rubricHash &&
      report.scenarioSha256 === scenarioHash &&
      report.observationPlanSha256 === observationPlanHash
    reportBindingsMatched =
      reportBindingMatches(originalReplayReport) &&
      reportBindingMatches(replayReport) &&
      hashMultimodalJson(originalReplayReport.calls[0]?.descriptor ?? null) ===
        hashMultimodalJson(expectedAgentDescriptor) &&
      hashMultimodalJson(replayReport.calls[0]?.descriptor ?? null) ===
        hashMultimodalJson(expectedAgentDescriptor)
    replayJsonPath = replayed.paths.json
    replayMarkdownPath = replayed.paths.markdown
  }
  catch (error)
  {
    issues.push(
      `retained agent judgment replay failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const currentSourceAtCompletion = multimodalCurrentSourceIdentity()
  sourceBindingMatched =
    sourceBindingMatched &&
    currentSourceAtCompletion.issue === null &&
    currentSourceAtCompletion.executionArtifactsIssue === null &&
    currentSourceAtCompletion.commit === currentSourceAtStart.commit &&
    currentSourceAtCompletion.state === currentSourceAtStart.state &&
    currentSourceAtCompletion.treeSha256 === currentSourceAtStart.treeSha256 &&
    currentSourceAtCompletion.executionArtifactsTreeSha256 ===
      currentSourceAtStart.executionArtifactsTreeSha256
  const replayCall = replayReport?.calls[0] ?? null
  const exactReplay =
    originalReplayReport !== null &&
    replayReport !== null &&
    sourceCorpusAcceptance === 'passed' &&
    authoritativeAgentExecution &&
    agentBindingMatched &&
    sourceBindingMatched &&
    originalReplayReport.verdict === replayReport.verdict &&
    reportBindingsMatched &&
    hashMultimodalJson(originalReplayReport.rubric) ===
      hashMultimodalJson(replayReport.rubric) &&
    replayReport.calls.length === 1 &&
    replayCall?.providerCallCount === 0 &&
    replayCall.cost.source === 'replay-zero' &&
    replayCall.cost.accountedUsd === 0

  let afterBytes: Uint8Array | null = null
  let afterHash: string | null = null
  try
  {
    afterBytes = Uint8Array.from(
      readMultimodalBoundedRegularFile(
        inputPath,
        MULTIMODAL_SELECTED_INPUT_MAX_BYTES,
        'selected input preservation check',
        sourceBytes.byteLength
      )
    )
    afterHash = sha256(afterBytes)
  }
  catch (error)
  {
    issues.push(
      `selected input preservation check failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const exactPreserved =
    afterBytes !== null &&
    sourceBytes.byteLength === afterBytes.byteLength &&
    sourceHash === afterHash
  const differentialCompleted =
    officialTrace !== null &&
    turboWarpTrace !== null &&
    differentialReport !== null
  const mediaPassed =
    browserMedia !== null &&
    browserMedia.complete &&
    browserMedia.frameCount === planValidation.theoreticalFrameCount &&
    browserMedia.totalFrameBytes <= observationPlan.temporal!.maxBytes &&
    browserMedia.plannedTicksMatched &&
    browserMedia.verificationIssueCount === 0
  const checks: MultimodalProjectCheckReportV2['acceptance']['checks'] = [
    {
      id: 'observation-plan-admitted',
      passed: true,
      detail: `${planValidation.theoreticalFrameCount} bounded logical frames admitted`,
    },
    {
      id: 'generic-project-check',
      passed:
        projectCheckStatus === 'passed' && projectCheckInputIdentityMatched,
      detail: `generic project-check status ${projectCheckStatus}; frozen input identity ${projectCheckInputIdentityMatched}`,
    },
    {
      id: 'deterministic-runtime-execution',
      passed:
        differentialCompleted &&
        officialTrace?.ok === true &&
        turboWarpTrace?.ok === true,
      detail: `official=${officialTrace?.ok ?? 'not run'} TurboWarp=${turboWarpTrace?.ok ?? 'not run'}`,
    },
    {
      id: 'runtime-differential-classified',
      passed:
        differentialCompleted &&
        differentialReport?.capabilityAssessment.status === 'assessed',
      detail: `${differentialReport?.capabilityAssessment.status ?? 'not run'}/${differentialReport?.capabilityAssessment.classification ?? 'not run'}; observed verdict ${differentialReport?.verdict ?? 'not run'}`,
    },
    {
      id: 'bounded-temporal-media',
      passed: mediaPassed,
      detail: browserMedia
        ? `${browserMedia.frameCount} frames, ${browserMedia.totalFrameBytes} bytes, ticks ${browserMedia.ticks.join(',')}, planned ticks ${browserMedia.plannedTicksMatched}, ${browserMedia.verificationIssueCount} verification issues`
        : 'no TurboWarp media manifest retained',
    },
    {
      id: 'recorded-artifact-and-rubric-binding',
      passed:
        artifactBindingMatched &&
        rubricBindingMatched &&
        scenarioBindingMatched &&
        observationPlanBindingMatched &&
        reportBindingsMatched,
      detail: `artifact=${artifactBindingMatched} rubric=${rubricBindingMatched} scenario=${scenarioBindingMatched} plan=${observationPlanBindingMatched} reports=${reportBindingsMatched}`,
    },
    {
      id: 'authoritative-agent-execution',
      passed: authoritativeAgentExecution && agentBindingMatched,
      detail: `transport=${agentTransport ?? 'not run'} authoritative=${authoritativeAgentExecution} current binding=${agentBindingMatched}`,
    },
    {
      id: 'current-agent-source-and-binding',
      passed:
        sourceCorpusAcceptance === 'passed' &&
        authoritativeAgentExecution &&
        agentBindingMatched &&
        sourceBindingMatched,
      detail: `corpus=${sourceCorpusAcceptance ?? 'not run'} authority=${authoritativeAgentExecution} agent=${agentBindingMatched} source=${sourceBindingMatched}`,
    },
    {
      id: 'exact-zero-agent-replay',
      passed: exactReplay,
      detail: `match=${exactReplay} agent executions=${replayCall?.providerCallCount ?? 'not run'}`,
    },
    {
      id: 'exact-source-preservation',
      passed: exactPreserved,
      detail: `${sourceBytes.byteLength}/${afterBytes?.byteLength ?? 'unavailable'} bytes and ${sourceHash}/${afterHash ?? 'unavailable'}`,
    },
  ]
  const status = checks.every((check) => check.passed) ? 'passed' : 'failed'
  const report: MultimodalProjectCheckReportV2 = {
    schemaVersion: 2,
    reportKind: 'multimodal-project-check',
    runId,
    createdAt,
    completedAt: new Date().toISOString(),
    durationMs: performance.now() - started,
    sourceRevision: multimodalSourceRevision(),
    input: {
      displayName: basename(inputPath),
      byteLengthBefore: sourceBytes.byteLength,
      sha256Before: sourceHash,
      byteLengthAfter: afterBytes?.byteLength ?? null,
      sha256After: afterHash,
      exactPreserved,
      retained: retainedInput,
    },
    rubric: {
      id: rubric.id,
      version: rubric.version,
      sha256: rubricHash,
      retained: retainedRubric,
    },
    scenario,
    observation: {
      plan: observationPlan,
      admitted: true,
      theoreticalFrameCount: planValidation.theoreticalFrameCount,
    },
    projectCheck: {
      status: projectCheckStatus,
      inputIdentityMatched: projectCheckInputIdentityMatched,
      reportJsonRelativePath: projectCheckJson,
      reportMarkdownRelativePath: projectCheckMarkdown,
      reportJsonSha256: projectCheckJsonSha256,
    },
    differential: {
      completed: differentialCompleted,
      officialOk: officialTrace?.ok ?? null,
      turboWarpOk: turboWarpTrace?.ok ?? null,
      verdict: differentialReport?.verdict ?? null,
      capabilityStatus: differentialReport?.capabilityAssessment.status ?? null,
      capabilityClassification:
        differentialReport?.capabilityAssessment.classification ?? null,
      lensVerdicts:
        differentialReport?.results.map((result) => ({
          id: result.specId,
          kind: result.kind,
          required: result.required,
          verdict: result.verdict,
          reason: result.inconclusiveReason,
        })) ?? [],
      report: differentialArtifact,
      officialTrace: officialArtifact,
      turboWarpTrace: turboWarpArtifact,
      browserMedia,
    },
    replay: {
      sourceRunId,
      sourceMode,
      sourceCorpusAcceptance,
      agentTransport,
      agentProviderDescriptor,
      agentAdapterVersion,
      agentCliVersion,
      agentModel,
      agentReasoningEffort,
      authoritativeAgentExecution,
      agentBindingMatched,
      sourceBindingMatched,
      selectedJudgmentPresent,
      artifactBindingMatched,
      rubricBindingMatched,
      scenarioBindingMatched,
      observationPlanBindingMatched,
      reportBindingsMatched,
      originalVerdict: originalReplayReport?.verdict ?? null,
      replayVerdict: replayReport?.verdict ?? null,
      exactVerdictAndRubricMatch: exactReplay,
      agentExecutions: replayCall?.providerCallCount ?? null,
      reportJsonRelativePath: replayJsonPath,
      reportMarkdownRelativePath: replayMarkdownPath,
    },
    acceptance: { status, checks },
    issues,
    claimScope:
      'No regression was observed only where the retained scenario, seed, lenses, and runtimes agree; a finite selected-project run does not prove semantic equivalence or complete gameplay correctness.',
    limitations: [
      'The selected project is a bounded scale and integration probe with no project-specific gameplay assertions.',
      'The cheap runtime differential compares official Scratch headless state with rendered TurboWarp state; renderer comparison is therefore explicitly unsupported in this lane.',
      'The agent judgment is replayed evidence bound to retained frames and a trusted rubric, never a sole acceptance oracle.',
    ],
  }
  const jsonPath = join(runRoot, 'multimodal-project-check.json')
  const markdownPath = join(runRoot, 'multimodal-project-check.md')
  writeJson(runRoot, jsonPath, report)
  writeExclusive(runRoot, markdownPath, reportMarkdown(report))
  process.stdout.write(
    [
      `${status.toUpperCase()} ${report.input.displayName}`,
      `run: ${runRoot}`,
      `sha256: ${sourceHash}`,
      `project-check: ${projectCheckStatus}`,
      `differential: ${differentialReport?.verdict ?? 'not run'} (${differentialReport?.capabilityAssessment.classification ?? 'not run'})`,
      `replay: ${exactReplay ? 'exact, zero agent executions' : 'failed'}`,
      `source preservation: ${exactPreserved ? 'exact' : 'failed'}`,
      `report: ${jsonPath}`,
    ].join('\n') + '\n'
  )
  if (status !== 'passed') process.exitCode = 1
}

main().catch((error: unknown) =>
{
  console.error(error)
  process.exitCode = 1
})
