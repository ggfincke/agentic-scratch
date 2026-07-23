// scripts/repair/codex-repair-bench.ts
// record isolated Codex/MCP R1-R5 repairs & independent verification evidence

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { probeCodexCliVersion } from '@scratch-agent/eval'
import {
  assertRepairBenchmarkCorpus,
  canonicalRepairBenchmarks,
  REPAIR_BENCHMARK_IDS,
  type RepairBenchmarkDefinition,
  type RepairReport,
} from '@scratch-agent/repair'
import { newRunId, sha256 } from '@scratch-agent/runner'

import {
  forbiddenExecutionEvent,
  tomlString,
  unknownRecord,
} from '../lib/codex.js'
import { sha256Hex } from '../lib/hash.js'
import { portableRelativePath } from '../lib/path.js'

const MODEL = 'gpt-5.6-sol'
const REASONING_EFFORT = 'xhigh'
const CASE_TIMEOUT_MS = 10 * 60 * 1000
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000
const MCP_TOOLS = [
  'repair_start',
  'repair_next',
  'repair_submit',
  'repair_status',
  'repair_export',
] as const

interface ProcessResult
{
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdout: Buffer
  stderr: Buffer
}

interface TraceToolCall
{
  tool: string
  server: string
  status: string
  error: unknown
  isError: boolean
}

interface TraceSummary
{
  threadId: string | null
  tools: TraceToolCall[]
  forbiddenExecutionItems: string[]
  errors: string[]
  usage: Record<string, number> | null
}

interface LiveCaseResult
{
  id: string
  repairCaseId: string
  ok: boolean
  errors: string[]
  threadId: string | null
  sessionId: string | null
  status: string | null
  attempts: number | null
  operationKinds: string[]
  toolSequence: string[]
  forbiddenExecutionItems: string[]
  usage: Record<string, number> | null
  controller: {
    reportPath: string | null
    sourceRevision: string | null
    reportSha256: string | null
  }
  exported: {
    path: string
    sha256: string | null
    byteLength: number | null
  }
  verification: {
    status: string | null
    attempts: number | null
    reportPath: string | null
    reportSha256: string | null
  }
  evidence: {
    tracePath: string
    traceSha256: string | null
    stderrPath: string
    stderrSha256: string | null
    messagePath: string
    messageSha256: string | null
  }
}

interface LiveBenchmarkSetup
{
  ok: boolean
  expectedCaseIds: string[]
  errors: string[]
}

interface LiveBenchmarkReport
{
  schemaVersion: 2
  runId: string
  createdAt: string
  completedAt: string
  durationMs: number
  ok: boolean
  codex: {
    cliVersion: string
    model: string
    reasoningEffort: string
    sandbox: 'workspace-write'
    ephemeral: true
    userConfigIgnored: true
    rulesIgnored: true
    strictConfig: true
  }
  setup: LiveBenchmarkSetup
  totals: { cases: number; passed: number; failed: number }
  cases: LiveCaseResult[]
}

export interface RunPaths
{
  root: string
  inputs: string
  outputs: string
  controller: string
  verification: string
  traces: string
  messages: string
  workspaces: string
  config: string
}

interface BenchmarkHooks
{
  definitions: () => RepairBenchmarkDefinition[]
  assertCorpus: (
    actualIds: readonly string[],
    expectedIds: readonly string[]
  ) => void
  persistSchema: (schemaPath: string) => void
  executeCase: (
    paths: RunPaths,
    schemaPath: string,
    definition: RepairBenchmarkDefinition
  ) => Promise<LiveCaseResult>
  codexVersion: () => string
}

interface CreatedBenchmarkResult
{
  report: LiveBenchmarkReport
  aggregateWritten: boolean
}

const root = resolve(import.meta.dirname, '../..')

function digest(bytes: Uint8Array | string): string
{
  return sha256Hex(bytes)
}

function portable(runRoot: string, path: string): string
{
  return portableRelativePath(runRoot, path)
}

function writeExclusive(path: string, bytes: Uint8Array | string): void
{
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
}

function persistFinalMessageSchema(schemaPath: string): void
{
  writeExclusive(
    schemaPath,
    `${JSON.stringify(
      {
        type: 'object',
        additionalProperties: false,
        required: ['caseId', 'sessionId', 'status', 'exported'],
        properties: {
          caseId: {
            type: 'string',
            enum: REPAIR_BENCHMARK_IDS,
          },
          sessionId: { type: 'string', minLength: 1 },
          status: {
            type: 'string',
            enum: ['repaired', 'already-passing'],
          },
          exported: { type: 'boolean', const: true },
        },
      },
      null,
      2
    )}\n`
  )
}

function readExisting(path: string): Buffer | null
{
  try
  {
    return existsSync(path) ? readFileSync(path) : null
  }
  catch
  {
    return null
  }
}

function createRunPaths(runId: string): RunPaths
{
  const runsRoot = join(root, 'runs')
  mkdirSync(runsRoot, { recursive: true, mode: 0o700 })
  const paths: RunPaths = {
    root: join(runsRoot, runId),
    inputs: join(runsRoot, runId, 'inputs'),
    outputs: join(runsRoot, runId, 'outputs'),
    controller: join(runsRoot, runId, 'controller'),
    verification: join(runsRoot, runId, 'verification'),
    traces: join(runsRoot, runId, 'traces'),
    messages: join(runsRoot, runId, 'messages'),
    workspaces: join(runsRoot, runId, 'workspaces'),
    config: join(runsRoot, runId, 'config'),
  }
  mkdirSync(paths.root, { mode: 0o700 })
  for (const path of Object.values(paths).slice(1))
    mkdirSync(path, { mode: 0o700 })
  return paths
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
): Promise<ProcessResult>
{
  return new Promise((resolveProcess, reject) =>
  {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() =>
    {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
    }, options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)))
    child.on('error', (error) =>
    {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode, signal) =>
    {
      clearTimeout(timer)
      resolveProcess({
        exitCode,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      })
    })
  })
}

function codexArgs(
  paths: RunPaths,
  workspace: string,
  messagePath: string,
  schemaPath: string,
  controllerRoot: string,
  prompt: string
): string[]
{
  const serverPath = join(root, 'packages/mcp/dist/transport/server.js')
  const enabledTools = `[${MCP_TOOLS.map(tomlString).join(', ')}]`
  const environment = [
    `SCRATCH_AGENT_INPUT_ROOT = ${tomlString(paths.inputs)}`,
    `SCRATCH_AGENT_OUTPUT_ROOT = ${tomlString(paths.outputs)}`,
    `SCRATCH_AGENT_ARTIFACT_ROOT = ${tomlString(controllerRoot)}`,
  ].join(', ')
  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    '--cd',
    workspace,
    '--add-dir',
    paths.root,
    '--json',
    '--output-last-message',
    messagePath,
    '--output-schema',
    schemaPath,
    '--model',
    MODEL,
    '--config',
    `model_reasoning_effort=${tomlString(REASONING_EFFORT)}`,
    '--config',
    'service_tier="default"',
    '--config',
    'approval_policy="never"',
    '--config',
    'mcp_servers.agentic_scratch_repair.enabled=true',
    '--config',
    'mcp_servers.agentic_scratch_repair.required=true',
    '--config',
    `mcp_servers.agentic_scratch_repair.command=${tomlString(process.execPath)}`,
    '--config',
    `mcp_servers.agentic_scratch_repair.args=[${tomlString(serverPath)}]`,
    '--config',
    `mcp_servers.agentic_scratch_repair.cwd=${tomlString(root)}`,
    '--config',
    'mcp_servers.agentic_scratch_repair.startup_timeout_sec=30.0',
    '--config',
    'mcp_servers.agentic_scratch_repair.tool_timeout_sec=300.0',
    '--config',
    `mcp_servers.agentic_scratch_repair.enabled_tools=${enabledTools}`,
    '--config',
    `mcp_servers.agentic_scratch_repair.env={ ${environment} }`,
    prompt,
  ]
}

function repairPrompt(
  definition: RepairBenchmarkDefinition,
  inputPath: string,
  outputPath: string
): string
{
  return [
    'Use only the agentic_scratch_repair MCP tools. Do not use shell, file-editing, browser, web, app, collaboration, or any other execution tool.',
    `Repair registered case ${definition.id} from ${inputPath}.`,
    'Start exactly one session, reserve the next request, inspect its objective, failures, localization, evidence, policy, acceptance contract, and authoritative proposal schema, then author and submit a typed proposal that exactly matches that request.',
    'If an ordinary attempt result is nonterminal, reserve the next request and submit a new proposal based only on the returned evidence. Never start a replacement session.',
    `After the session is repaired, call repair_status and then repair_export exactly once to ${outputPath}.`,
    'Do not infer success from your own prose. The controller result is authoritative.',
    'Return only the JSON object required by the supplied output schema.',
  ].join(' ')
}

function executionItem(type: string): boolean
{
  return forbiddenExecutionEvent(type)
}

function recordValue(value: unknown): Record<string, unknown> | null
{
  return unknownRecord(value)
}

function traceSummary(trace: Buffer): TraceSummary
{
  const summary: TraceSummary = {
    threadId: null,
    tools: [],
    forbiddenExecutionItems: [],
    errors: [],
    usage: null,
  }
  for (const [index, line] of trace.toString('utf8').split('\n').entries())
  {
    if (line.trim().length === 0) continue
    let event: Record<string, unknown>
    try
    {
      event = JSON.parse(line) as Record<string, unknown>
    }
    catch
    {
      summary.errors.push(`trace line ${index + 1} is not JSON`)
      continue
    }
    if (event.type === 'thread.started' && typeof event.thread_id === 'string')
      summary.threadId = event.thread_id
    if (event.type === 'turn.failed' || event.type === 'error')
      summary.errors.push(`trace contains ${String(event.type)}`)
    if (event.type === 'turn.completed')
    {
      const usage = recordValue(event.usage)
      if (usage)
      {
        summary.usage = Object.fromEntries(
          Object.entries(usage).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === 'number' && Number.isFinite(entry[1])
          )
        )
      }
    }
    const item = recordValue(event.item)
    const type = typeof item?.type === 'string' ? item.type : null
    if (type && executionItem(type)) summary.forbiddenExecutionItems.push(type)
    if (event.type === 'item.completed' && type === 'mcp_tool_call' && item)
    {
      const result = recordValue(item.result)
      summary.tools.push({
        tool: typeof item.tool === 'string' ? item.tool : '',
        server: typeof item.server === 'string' ? item.server : '',
        status: typeof item.status === 'string' ? item.status : '',
        error: item.error,
        isError: result?.isError === true || result?.is_error === true,
      })
    }
  }
  return summary
}

function validToolSequence(tools: readonly string[]): boolean
{
  if (tools.length < 5 || tools[0] !== 'repair_start') return false
  if (tools.at(-2) !== 'repair_status' || tools.at(-1) !== 'repair_export')
    return false
  const proposals = tools.slice(1, -2)
  if (proposals.length < 2 || proposals.length % 2 !== 0) return false
  return proposals.every(
    (tool, index) =>
      tool === (index % 2 === 0 ? 'repair_next' : 'repair_submit')
  )
}

function controllerRunDirectories(path: string): string[]
{
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('repair-'))
    .map((entry) => join(path, entry.name))
    .sort()
}

function inspectController(
  definition: RepairBenchmarkDefinition,
  report: RepairReport,
  outputPath: string,
  errors: string[]
): string[]
{
  const operationKinds = report.attempts.flatMap(
    (attempt) =>
      attempt.record.proposal?.operations.map((operation) => operation.kind) ??
      []
  )
  if (report.repairCase.id !== definition.repairCase.id)
    errors.push('controller report uses the wrong registered case')
  if (report.status !== 'repaired')
    errors.push('controller terminal status is not repaired')
  if (report.attempts.length < 1 || report.attempts.length > 4)
    errors.push('controller attempt count is outside the one-to-four budget')
  if (
    report.attempts.some(
      (attempt) => (attempt.record.proposal?.operations.length ?? 0) > 1
    )
  )
    errors.push('a Codex proposal exceeded the one-operation case budget')
  if (
    operationKinds.some(
      (kind) =>
        !definition.repairCase.policy.intentBudget.allowedOpKinds.includes(
          kind as (typeof definition.repairCase.policy.intentBudget.allowedOpKinds)[number]
        )
    )
  )
    errors.push('a Codex proposal used a disallowed operation kind')
  const acceptedAttempt = report.attempts.find(
    (attempt) => attempt.record.status === 'repaired'
  )
  if (
    JSON.stringify(acceptedAttempt?.gateOrder ?? []) !==
    JSON.stringify(['preflight', 'targeted', 'regression'])
  )
    errors.push('accepted attempt does not have the complete gate order')
  if (
    report.attempts.some(
      (attempt) => attempt.record.agent.descriptor?.adapter !== 'mcp'
    )
  )
    errors.push('a proposal is missing the trusted MCP adapter identity')
  if (report.accepted?.proof.acceptedCopyVerified !== true)
    errors.push('accepted controller copy was not verified')
  if (report.accepted?.proof.assetsPreserved !== true)
    errors.push('controller report does not prove asset preservation')
  if (report.accepted?.proof.existingEditorLayoutPreserved !== true)
    errors.push('controller report does not prove editor-layout preservation')
  if ((report.accepted?.exports.length ?? 0) !== 1)
    errors.push(
      'controller report does not contain exactly one verified export'
    )
  if (!existsSync(outputPath))
    errors.push('expected exported artifact is missing')
  if (existsSync(outputPath) && report.accepted)
  {
    const output = readFileSync(outputPath)
    if (sha256(output) !== report.accepted.artifact.sha256)
      errors.push('exported artifact hash differs from the accepted artifact')
    if (output.byteLength !== report.accepted.artifact.byteLength)
      errors.push('exported artifact size differs from the accepted artifact')
  }
  return operationKinds
}

function secretFindings(values: Array<[string, Buffer | string]>): string[]
{
  const patterns: Array<[string, RegExp]> = [
    ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i],
    ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
    ['API key assignment', /\b(?:OPENAI_)?API_KEY\s*[=:]\s*[^\s"']+/i],
  ]
  return values.flatMap(([label, value]) =>
  {
    const text = typeof value === 'string' ? value : value.toString('utf8')
    return patterns
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => `${label} contains a possible ${name}`)
  })
}

async function verifyExport(
  paths: RunPaths,
  verificationRoot: string,
  definition: RepairBenchmarkDefinition,
  outputPath: string,
  errors: string[]
): Promise<{
  status: string | null
  attempts: number | null
  reportPath: string | null
  reportSha256: string | null
}>
{
  const stdoutPath = join(verificationRoot, 'stdout.json')
  const stderrPath = join(verificationRoot, 'stderr.log')
  const result = await runProcess(
    process.execPath,
    [
      '--import',
      'tsx',
      join(root, 'scripts/repair/repair.ts'),
      'verify',
      definition.id,
      '--input',
      outputPath,
      '--artifact-root',
      verificationRoot,
    ],
    { cwd: root, timeoutMs: VERIFY_TIMEOUT_MS }
  )
  writeExclusive(stdoutPath, result.stdout)
  writeExclusive(stderrPath, result.stderr)
  if (result.exitCode !== 0 || result.timedOut)
    errors.push('independent verification command failed')
  let parsed: Record<string, unknown> | null = null
  try
  {
    parsed = JSON.parse(result.stdout.toString('utf8')) as Record<
      string,
      unknown
    >
  }
  catch
  {
    errors.push('independent verification stdout is not JSON')
  }
  const status = typeof parsed?.status === 'string' ? parsed.status : null
  const sessionId =
    typeof parsed?.sessionId === 'string' ? parsed.sessionId : null
  if (status !== 'already-passing')
    errors.push('export did not independently verify as already-passing')
  if (!sessionId)
  {
    errors.push('verification result has no session ID')
    return { status, attempts: null, reportPath: null, reportSha256: null }
  }
  const reportPath = join(
    verificationRoot,
    `repair-${sessionId}`,
    'report.json'
  )
  if (!existsSync(reportPath))
  {
    errors.push('verification report is missing')
    return { status, attempts: null, reportPath: null, reportSha256: null }
  }
  const raw = readFileSync(reportPath)
  const report = JSON.parse(raw.toString('utf8')) as RepairReport
  if (report.attempts.length !== 0)
    errors.push('already-passing verification unexpectedly used an attempt')
  return {
    status,
    attempts: report.attempts.length,
    reportPath: portable(paths.root, reportPath),
    reportSha256: digest(raw),
  }
}

async function runCase(
  paths: RunPaths,
  schemaPath: string,
  definition: RepairBenchmarkDefinition
): Promise<LiveCaseResult>
{
  const errors: string[] = []
  const workspace = join(paths.workspaces, definition.id)
  const controllerRoot = join(paths.controller, definition.id)
  const verificationRoot = join(paths.verification, definition.id)
  mkdirSync(workspace, { mode: 0o700 })
  mkdirSync(controllerRoot, { mode: 0o700 })
  mkdirSync(verificationRoot, { mode: 0o700 })
  const inputPath = join(
    paths.inputs,
    `${definition.id.toLowerCase()}-broken.sb3`
  )
  const outputPath = join(
    paths.outputs,
    `${definition.id.toLowerCase()}-repaired.sb3`
  )
  const tracePath = join(paths.traces, `${definition.id}.jsonl`)
  const stderrPath = join(paths.traces, `${definition.id}.stderr.log`)
  const messagePath = join(paths.messages, `${definition.id}.json`)
  writeExclusive(inputPath, await definition.broken.toSb3())

  console.log(`START ${definition.id} with ${MODEL}/${REASONING_EFFORT}`)
  const processResult = await runProcess(
    'codex',
    codexArgs(
      paths,
      workspace,
      messagePath,
      schemaPath,
      controllerRoot,
      repairPrompt(definition, inputPath, outputPath)
    ),
    { cwd: root, timeoutMs: CASE_TIMEOUT_MS }
  )
  writeExclusive(tracePath, processResult.stdout)
  writeExclusive(stderrPath, processResult.stderr)
  if (processResult.exitCode !== 0)
    errors.push(`Codex exited with code ${String(processResult.exitCode)}`)
  if (processResult.signal)
    errors.push(`Codex exited on signal ${processResult.signal}`)
  if (processResult.timedOut) errors.push('Codex case timed out')

  const trace = traceSummary(processResult.stdout)
  const toolSequence = trace.tools.map((entry) => entry.tool)
  errors.push(...trace.errors)
  if (!validToolSequence(toolSequence))
    errors.push('MCP tool calls do not follow the required repair sequence')
  if (
    trace.tools.some(
      (entry) =>
        entry.server !== 'agentic_scratch_repair' ||
        !MCP_TOOLS.includes(entry.tool as (typeof MCP_TOOLS)[number])
    )
  )
    errors.push('trace contains a call outside the allowed MCP server/tools')
  if (
    trace.tools.some(
      (entry) =>
        entry.status !== 'completed' || entry.error !== null || entry.isError
    )
  )
    errors.push('trace contains an incomplete or failed MCP tool call')
  if (trace.forbiddenExecutionItems.length > 0)
    errors.push('trace contains a forbidden non-MCP execution item')
  if (!existsSync(messagePath)) errors.push('Codex final message is missing')
  const message = existsSync(messagePath) ? readFileSync(messagePath) : null
  errors.push(
    ...secretFindings([
      ['trace', processResult.stdout],
      ['stderr', processResult.stderr],
      ...(message ? ([['message', message]] as Array<[string, Buffer]>) : []),
    ])
  )

  const controllerRuns = controllerRunDirectories(controllerRoot)
  if (controllerRuns.length !== 1)
    errors.push('Codex did not create exactly one controller session')
  const controllerRunRoot = controllerRuns[0] ?? null
  const controllerReportPath = controllerRunRoot
    ? join(controllerRunRoot, 'report.json')
    : null
  let controllerReport: RepairReport | null = null
  let controllerRaw: Buffer | null = null
  let operationKinds: string[] = []
  if (controllerReportPath && existsSync(controllerReportPath))
  {
    controllerRaw = readFileSync(controllerReportPath)
    controllerReport = JSON.parse(
      controllerRaw.toString('utf8')
    ) as RepairReport
    operationKinds = inspectController(
      definition,
      controllerReport,
      outputPath,
      errors
    )
  }
  else errors.push('authoritative controller report is missing')

  let verification = {
    status: null as string | null,
    attempts: null as number | null,
    reportPath: null as string | null,
    reportSha256: null as string | null,
  }
  if (existsSync(outputPath))
  {
    verification = await verifyExport(
      paths,
      verificationRoot,
      definition,
      outputPath,
      errors
    )
    if (
      controllerReport?.accepted &&
      verification.reportPath &&
      existsSync(join(paths.root, verification.reportPath))
    )
    {
      const verified = JSON.parse(
        readFileSync(join(paths.root, verification.reportPath), 'utf8')
      ) as RepairReport
      if (
        verified.input.artifact.sha256 !==
        controllerReport.accepted.artifact.sha256
      )
        errors.push(
          'verification input hash differs from the accepted artifact'
        )
    }
  }

  const exported = existsSync(outputPath) ? readFileSync(outputPath) : null
  const result: LiveCaseResult = {
    id: definition.id,
    repairCaseId: definition.repairCase.id,
    ok: errors.length === 0,
    errors,
    threadId: trace.threadId,
    sessionId: controllerReport?.sessionId ?? null,
    status: controllerReport?.status ?? null,
    attempts: controllerReport?.attempts.length ?? null,
    operationKinds,
    toolSequence,
    forbiddenExecutionItems: [...new Set(trace.forbiddenExecutionItems)].sort(),
    usage: trace.usage,
    controller: {
      reportPath: controllerReportPath
        ? portable(paths.root, controllerReportPath)
        : null,
      sourceRevision: controllerReport?.sourceRevision ?? null,
      reportSha256: controllerRaw ? digest(controllerRaw) : null,
    },
    exported: {
      path: portable(paths.root, outputPath),
      sha256: exported ? sha256(exported) : null,
      byteLength: exported?.byteLength ?? null,
    },
    verification,
    evidence: {
      tracePath: portable(paths.root, tracePath),
      traceSha256: digest(processResult.stdout),
      stderrPath: portable(paths.root, stderrPath),
      stderrSha256: digest(processResult.stderr),
      messagePath: portable(paths.root, messagePath),
      messageSha256: message ? digest(message) : null,
    },
  }
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${definition.id}`)
  for (const error of result.errors) console.log(`      ${error}`)
  return result
}

function failedCase(
  paths: RunPaths,
  definition: RepairBenchmarkDefinition,
  error: unknown
): LiveCaseResult
{
  const outputPath = join(
    paths.outputs,
    `${definition.id.toLowerCase()}-repaired.sb3`
  )
  const tracePath = join(paths.traces, `${definition.id}.jsonl`)
  const stderrPath = join(paths.traces, `${definition.id}.stderr.log`)
  const messagePath = join(paths.messages, `${definition.id}.json`)
  const trace = readExisting(tracePath)
  const stderr = readExisting(stderrPath)
  const message = readExisting(messagePath)
  const exported = readExisting(outputPath)
  const detail = error instanceof Error ? error.message : 'unknown failure'
  return {
    id: definition.id,
    repairCaseId: definition.repairCase.id,
    ok: false,
    errors: [
      `unexpected case failure: ${detail}`
        .replaceAll(paths.root, '<run-root>')
        .replaceAll(root, '<repo-root>'),
    ],
    threadId: null,
    sessionId: null,
    status: null,
    attempts: null,
    operationKinds: [],
    toolSequence: [],
    forbiddenExecutionItems: [],
    usage: null,
    controller: {
      reportPath: null,
      sourceRevision: null,
      reportSha256: null,
    },
    exported: {
      path: portable(paths.root, outputPath),
      sha256: exported ? sha256(exported) : null,
      byteLength: exported?.byteLength ?? null,
    },
    verification: {
      status: null,
      attempts: null,
      reportPath: null,
      reportSha256: null,
    },
    evidence: {
      tracePath: portable(paths.root, tracePath),
      traceSha256: trace ? digest(trace) : null,
      stderrPath: portable(paths.root, stderrPath),
      stderrSha256: stderr ? digest(stderr) : null,
      messagePath: portable(paths.root, messagePath),
      messageSha256: message ? digest(message) : null,
    },
  }
}

function reportMarkdown(report: LiveBenchmarkReport): string
{
  const lines = [
    '# Phase 6 Codex/MCP repair benchmark',
    '',
    `**run:** \`${report.runId}\``,
    `**result:** ${report.ok ? 'PASS' : 'FAIL'}`,
    `**Codex:** ${report.codex.cliVersion}, \`${report.codex.model}\`, ${report.codex.reasoningEffort}`,
    `**setup:** ${report.setup.ok ? 'PASS' : 'FAIL'}`,
    `**expected cases:** ${report.setup.expectedCaseIds.join(', ')}`,
    `**cases:** ${report.totals.passed}/${report.totals.cases} passed`,
    '',
    '| Case | Result | Attempts | Operation | Tools | Verification | Export SHA-256 |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
    ...report.cases.map(
      (entry) =>
        `| ${[
          entry.id,
          entry.ok ? 'PASS' : 'FAIL',
          entry.attempts === null ? '-' : String(entry.attempts),
          entry.operationKinds.join(', ') || '-',
          entry.toolSequence.join(' -> ') || '-',
          entry.verification.status ?? '-',
          entry.exported.sha256 ?? '-',
        ].join(' | ')} |`
    ),
  ]
  const failures = report.cases.flatMap((entry) =>
    entry.errors.map(
      (error) => `- ${entry.id}: ${error.replaceAll('|', '\\|')}`
    )
  )
  failures.unshift(
    ...report.setup.errors.map(
      (error) => `- setup: ${error.replaceAll('|', '\\|')}`
    )
  )
  if (failures.length > 0) lines.push('', '## Failures', '', ...failures)
  return `${lines.join('\n')}\n`
}

function codexVersion(): string
{
  return probeCodexCliVersion()
}

function setupFailure(paths: RunPaths, error: unknown): string
{
  const detail = error instanceof Error ? error.message : String(error)
  return `benchmark setup failed: ${detail}`
    .replaceAll(paths.root, '<run-root>')
    .replaceAll(root, '<repo-root>')
}

function writeAggregate(paths: RunPaths, report: LiveBenchmarkReport): boolean
{
  let complete = true
  try
  {
    writeExclusive(
      join(paths.root, 'live-report.json'),
      `${JSON.stringify(report, null, 2)}\n`
    )
  }
  catch (error)
  {
    complete = false
    console.error(
      `could not write live-report.json: ${error instanceof Error ? error.message : 'unknown failure'}`
    )
  }
  try
  {
    writeExclusive(join(paths.root, 'live-report.md'), reportMarkdown(report))
  }
  catch (error)
  {
    complete = false
    console.error(
      `could not write live-report.md: ${error instanceof Error ? error.message : 'unknown failure'}`
    )
  }
  return complete
}

export async function runCreatedBenchmark(
  paths: RunPaths,
  runId: string,
  options: {
    createdAt?: string
    startedAt?: number
    hooks?: Partial<BenchmarkHooks>
  } = {}
): Promise<CreatedBenchmarkResult>
{
  const createdAt = options.createdAt ?? new Date().toISOString()
  const startedAt = options.startedAt ?? performance.now()
  const hooks: BenchmarkHooks = {
    definitions: canonicalRepairBenchmarks,
    assertCorpus: assertRepairBenchmarkCorpus,
    persistSchema: persistFinalMessageSchema,
    executeCase: runCase,
    codexVersion,
    ...options.hooks,
  }
  const expectedCaseIds = [...REPAIR_BENCHMARK_IDS]
  const setupErrors: string[] = []
  const definitions: RepairBenchmarkDefinition[] = []
  let cliVersion = 'unavailable'

  try
  {
    definitions.push(...hooks.definitions())
    hooks.assertCorpus(
      definitions.map((definition) => definition.id),
      expectedCaseIds
    )
    hooks.persistSchema(join(paths.config, 'final-message.schema.json'))
    cliVersion = hooks.codexVersion()
  }
  catch (error)
  {
    setupErrors.push(setupFailure(paths, error))
  }

  const cases: LiveCaseResult[] = []
  if (setupErrors.length === 0)
  {
    const schemaPath = join(paths.config, 'final-message.schema.json')
    for (const definition of definitions)
    {
      try
      {
        cases.push(await hooks.executeCase(paths, schemaPath, definition))
      }
      catch (error)
      {
        const result = failedCase(paths, definition, error)
        cases.push(result)
        console.log(`FAIL  ${definition.id}`)
        for (const detail of result.errors) console.log(`      ${detail}`)
      }
    }
  }

  const passed = cases.filter((entry) => entry.ok).length
  const report: LiveBenchmarkReport = {
    schemaVersion: 2,
    runId,
    createdAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, performance.now() - startedAt),
    ok:
      setupErrors.length === 0 &&
      cases.length === expectedCaseIds.length &&
      passed === cases.length,
    codex: {
      cliVersion,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      sandbox: 'workspace-write',
      ephemeral: true,
      userConfigIgnored: true,
      rulesIgnored: true,
      strictConfig: true,
    },
    setup: {
      ok: setupErrors.length === 0,
      expectedCaseIds,
      errors: setupErrors,
    },
    totals: { cases: cases.length, passed, failed: cases.length - passed },
    cases,
  }
  return {
    report,
    aggregateWritten: writeAggregate(paths, report),
  }
}

async function main(): Promise<void>
{
  const started = performance.now()
  const createdAt = new Date().toISOString()
  const runId = `codex-repair-bench-${newRunId()}`
  const paths = createRunPaths(runId)
  const { report, aggregateWritten } = await runCreatedBenchmark(paths, runId, {
    createdAt,
    startedAt: started,
  })
  console.log(
    `\n${report.totals.passed}/${report.totals.cases} passed -> ${join(paths.root, 'live-report.md')}`
  )
  if (!report.ok || !aggregateWritten) process.exitCode = 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
{
  main().catch((error: unknown) =>
  {
    console.error(
      error instanceof Error ? error.message : 'Codex repair benchmark failed'
    )
    process.exitCode = 1
  })
}
