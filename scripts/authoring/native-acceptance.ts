// scripts/authoring/native-acceptance.ts
// exercise scoped native codex authoring & development w/ independent retained replay

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createAuthoringWorkspaceServiceV1 } from '@scratch-agent/edit'
import {
  isolatedCodexEnvironment,
  requireCodexChatGptLogin,
  requireCodexCliVersion,
  validateDevelopmentReproductionReportV1,
  type DevelopmentReproductionReportV2,
} from '@scratch-agent/eval'
import {
  AUTHORING_TOOL_NAMES_V1,
  createNativeAdmissionBudgetV1,
  DEVELOPMENT_TOOL_NAMES_V1,
  developmentProfileAuthoritySha256V1,
  EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
  productionEditProfileAuthoritySha256V1,
  readAuthoringHostConfigurationV1,
  verifyNativeAdmissionBudgetV1,
  verifyWorkbenchCallAuditV1,
  type NativeAdmissionBudgetVerificationV1,
} from '@scratch-agent/mcp'
import {
  canonicalInputKey,
  newRunId,
  type DevelopmentTraceV2,
} from '@scratch-agent/runner'
import {
  forbiddenExecutionEvent,
  tomlString,
  unknownRecord,
} from '../lib/codex.js'
import { assertCodexOutputSchemaCompatible } from '../multimodal/codex-adapter.js'
import { writeSemanticEditBenchmarkFixtureV1 } from '../semantic-edit/benchmark-fixtures.js'
import {
  prepareSemanticEditMcpHostV1,
  type PreparedSemanticEditMcpHostV1,
} from '../semantic-edit/mcp-driver.js'
import {
  canonicalSha256,
  captureSemanticEditAuthorityV1,
  createSemanticEditRunLayoutV1,
  readBoundedJsonV1,
  readBoundedRegularFileV1,
  semanticEditAuthoritySnapshotsMatchV1,
  semanticEditStaticAuthorityV1,
  sha256,
  writeExclusive,
  writeGeneratedSemanticEditInputsV1,
  writeJsonExclusive,
  type SemanticEditRunLayoutV1,
} from '../semantic-edit/harness.js'
import { prepareGenericAuthoringAcceptanceV1 } from './acceptance-fixture.js'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const SERVER_NAMES = ['scratch_authoring', 'scratch_development'] as const
const MAX_TRACE_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 1024 * 1024
const MAX_DURATION_MS = 300000
const CLEANUP_DURATION_MS = 15000
const MAX_CALLS = 64

interface NativeCallV1
{
  server: string
  tool: string
  request: Record<string, unknown>
  outcome: Record<string, unknown>
  data: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown>
{
  const result = unknownRecord(value)
  assert.ok(result, 'expected a structured object')
  return result
}

function text(value: unknown): string
{
  assert.ok(typeof value === 'string')
  assert.ok(value && value.length <= 4096)
  return value
}

function treeIdentity(root: string): string
{
  let byteLength = 0
  const files: { path: string; sha256: string; byteLength: number }[] = []
  function walk(directory: string): void
  {
    for (const entry of readdirSync(directory, { withFileTypes: true }))
    {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else
      {
        assert.ok(
          entry.isFile(),
          'acceptance tree contains a nonregular artifact'
        )
        assert.ok(
          files.length < 32768,
          'acceptance tree exceeds its file bound'
        )
        const bytes = readBoundedRegularFileV1(
          path,
          50 * 1024 * 1024,
          'acceptance artifact'
        )
        byteLength += bytes.byteLength
        assert.ok(
          byteLength <= 1024 * 1024 * 1024,
          'acceptance tree exceeds its byte bound'
        )
        files.push({
          path: relative(root, path),
          sha256: sha256(bytes),
          byteLength: bytes.byteLength,
        })
      }
    }
  }
  walk(root)
  return canonicalSha256(
    files.sort((left, right) => left.path.localeCompare(right.path))
  )
}

// keep model & reasoning selection separate from the scoped mcp overrides
function configuredCodexSettings()
{
  const configurationHome =
    process.env.CODEX_HOME ?? join(text(process.env.HOME), '.codex')
  const path = join(configurationHome, 'config.toml')
  if (!existsSync(path))
    return {
      servers: [],
      rootModel: null,
      rootReasoningEffort: null,
      profile: null,
    }
  const config = Buffer.from(
    readBoundedRegularFileV1(path, 2 * 1024 * 1024, 'Codex configuration')
  ).toString('utf8')
  const names = new Set<string>()
  const selections = new Map<string, string>()
  let root = true
  for (const line of config.split('\n'))
  {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line)
    if (header) root = false
    if (root)
    {
      const selection =
        /^\s*(model|model_reasoning_effort|profile)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/u.exec(
          line
        )
      if (selection)
      {
        try
        {
          const value = selection[2]!.startsWith("'")
            ? selection[2]!.slice(1, -1)
            : (JSON.parse(selection[2]!) as unknown)
          if (typeof value === 'string' && value.length <= 128)
            selections.set(selection[1]!, value)
        }
        catch
        {
          selections.delete(selection[1]!)
        }
      }
    }
    if (header?.[1]?.includes('mcp_servers'))
    {
      const match =
        /^mcp_servers\.(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)')(?:\.[A-Za-z0-9_-]+)*$/u.exec(
          header[1]
        )
      assert.ok(
        match,
        'native acceptance requires ordinary [mcp_servers.name] config sections; no user configuration was changed'
      )
      names.add(match[1] ?? match[2] ?? match[3]!)
    }
    else if (/^\s*mcp_servers(?:\s*=|\.)/u.test(line))
      throw new Error(
        'native acceptance refuses inline MCP config; no user configuration was changed'
      )
  }
  assert.ok(names.size <= 64, 'too many configured MCP servers')
  return {
    servers: [...names].sort(),
    rootModel: selections.get('model') ?? null,
    rootReasoningEffort: selections.get('model_reasoning_effort') ?? null,
    profile: selections.get('profile') ?? null,
  }
}

function serverArguments(input: {
  layout: SemanticEditRunLayoutV1
  host: PreparedSemanticEditMcpHostV1
  fixture: Awaited<ReturnType<typeof prepareGenericAuthoringAcceptanceV1>>
  timeoutMs: number
  configuredServers: readonly string[]
  admission?: {
    readonly root: string
    readonly manifestSha256: string
  }
}): string[]
{
  const disabled = input.configuredServers
  assert.ok(
    disabled.every(
      (name) => !(SERVER_NAMES as readonly string[]).includes(name)
    ),
    'native acceptance server names collide with existing user MCP configuration'
  )
  const args = disabled.flatMap((name) => [
    '--config',
    `mcp_servers.${name}.enabled=false`,
  ])
  const editEnvironment = {
    SCRATCH_AGENT_INPUT_ROOT: input.layout.inputRoot,
    SCRATCH_AGENT_ASSET_INPUT_ROOT: input.layout.assetInputRoot,
    SCRATCH_AGENT_OUTPUT_ROOT: input.layout.outputRoot,
    SCRATCH_AGENT_EDIT_PRIVATE_ROOT: input.layout.editPrivateRoot,
    SCRATCH_AGENT_READABLE_ARTIFACT_ROOT: input.layout.readableArtifactRoot,
    SCRATCH_AGENT_EDIT_HOST_CONFIG: input.host.descriptorPath,
    SCRATCH_AGENT_EDIT_EXPECTED_DESCRIPTOR_SHA256: input.host.descriptorSha256,
    SCRATCH_AGENT_EDIT_EXPECTED_DESCRIPTOR_CANONICAL_SHA256:
      input.host.descriptorCanonicalSha256,
    SCRATCH_AGENT_EDIT_EXPECTED_CONTRACT_REGISTRY_SHA256:
      input.host.contractRegistrySha256,
    SCRATCH_AGENT_EDIT_EXPECTED_CONTRACT_REGISTRY_ARTIFACT_SET_SHA256:
      input.host.contractRegistryArtifactSetSha256,
    SCRATCH_AGENT_EDIT_EXPECTED_SECRET_MATERIAL_SHA256:
      input.host.secretMaterialSha256,
    SCRATCH_AGENT_EDIT_EXPECTED_PREDECESSOR_HANDOFF_SHA256: 'absent',
  }
  const servers = [
    {
      name: SERVER_NAMES[0],
      profile: 'authoring-v1',
      config: input.fixture.hostConfigPath,
      tools: AUTHORING_TOOL_NAMES_V1,
      environment: editEnvironment,
    },
    {
      name: SERVER_NAMES[1],
      profile: 'development-v1',
      config: input.fixture.developmentConfigPath,
      tools: DEVELOPMENT_TOOL_NAMES_V1,
      environment: {},
    },
  ]
  for (const server of servers)
  {
    const environment = {
      ...server.environment,
      SCRATCH_AGENT_MCP_PROFILE: server.profile,
      SCRATCH_AGENT_WORKBENCH_CONFIG: server.config,
      SCRATCH_AGENT_WORKBENCH_CONFIG_SHA256: sha256(
        readBoundedRegularFileV1(
          server.config,
          64 * 1024,
          'workbench host configuration'
        )
      ),
      ...(input.admission
        ? {
            SCRATCH_AGENT_NATIVE_ADMISSION_ROOT: input.admission.root,
            SCRATCH_AGENT_NATIVE_ADMISSION_MANIFEST_SHA256:
              input.admission.manifestSha256,
          }
        : {}),
    }
    const properties = {
      enabled: 'true',
      required: 'true',
      command: tomlString(process.execPath),
      args: `[${tomlString(join(REPOSITORY_ROOT, 'packages/mcp/dist/transport/server.js'))}]`,
      cwd: tomlString(REPOSITORY_ROOT),
      startup_timeout_sec: '30.0',
      tool_timeout_sec: `${Math.ceil(input.timeoutMs / 1000)}.0`,
      enabled_tools: `[${server.tools.map(tomlString).join(',')}]`,
      env: `{${Object.entries(environment)
        .map(([key, value]) => `${key}=${tomlString(value)}`)
        .join(',')}}`,
    }
    for (const [key, value] of Object.entries(properties))
      args.push('--config', `mcp_servers.${server.name}.${key}=${value}`)
  }
  return args
}

async function runCodex(
  args: readonly string[],
  cwd: string,
  timing: {
    readonly startedAtUnixMs: number
    readonly startedAtMonotonicMs: number
    readonly durationMs: number
  }
)
{
  assert.notEqual(
    process.platform,
    'win32',
    'native acceptance requires an owned process group for bounded child cleanup'
  )
  const stdout: Buffer[] = [],
    stderr: Buffer[] = []
  let outBytes = 0,
    errBytes = 0
  let issue: string | null = null
  let exitCode: number | null = null
  let closed = false,
    cleanupComplete = false,
    forcedTermination = false
  let cleanupStartedAtMonotonicMs: number | null = null
  const hardDeadline = timing.startedAtMonotonicMs + timing.durationMs
  const workDeadline = hardDeadline - CLEANUP_DURATION_MS
  assert.ok(
    performance.now() < workDeadline,
    'native work period expired before process launch'
  )
  const child = spawn('codex', [...args], {
    cwd,
    env: isolatedCodexEnvironment(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  function signal(value: NodeJS.Signals): void
  {
    try
    {
      if (child.pid !== undefined) process.kill(-child.pid, value)
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
        issue ??= error instanceof Error ? error.message : String(error)
    }
  }
  function groupGone(): boolean
  {
    if (child.pid === undefined) return true
    try
    {
      process.kill(-child.pid, 0)
      return false
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
      issue ??= error instanceof Error ? error.message : String(error)
      return false
    }
  }
  await new Promise<void>((done) =>
  {
    let settled = false
    let cleanupTimer: NodeJS.Timeout | undefined
    const workTimer = setTimeout(
      () => startCleanup('native agent work duration exhausted'),
      Math.max(0, workDeadline - performance.now())
    )
    const hardTimer = setTimeout(
      forceCleanup,
      Math.max(0, hardDeadline - performance.now())
    )
    const poll = setInterval(checkCleanup, 50)
    const interruptions = {
      SIGINT: () => startCleanup('native harness interrupted by SIGINT'),
      SIGTERM: () => startCleanup('native harness interrupted by SIGTERM'),
      SIGHUP: () => startCleanup('native harness interrupted by SIGHUP'),
    }
    for (const [name, listener] of Object.entries(interruptions))
      process.on(name, listener)
    function finish(complete: boolean): void
    {
      if (settled) return
      settled = true
      cleanupComplete = complete
      clearTimeout(workTimer)
      clearTimeout(hardTimer)
      clearInterval(poll)
      for (const [name, listener] of Object.entries(interruptions))
        process.off(name, listener)
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
      if (!complete)
      {
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
      }
      done()
    }
    function checkCleanup(): void
    {
      if (closed && groupGone()) finish(true)
    }
    function forceCleanup(): void
    {
      if (settled) return
      issue ??= 'native owned process cleanup exceeded its deadline'
      forcedTermination = true
      signal('SIGKILL')
      finish(false)
    }
    function startCleanup(reason?: string): void
    {
      if (reason) issue ??= reason
      if (settled || cleanupStartedAtMonotonicMs !== null) return
      cleanupStartedAtMonotonicMs = performance.now()
      clearTimeout(workTimer)
      signal('SIGTERM')
      cleanupTimer = setTimeout(
        forceCleanup,
        Math.max(
          0,
          Math.min(
            hardDeadline,
            cleanupStartedAtMonotonicMs + CLEANUP_DURATION_MS
          ) - performance.now()
        )
      )
      checkCleanup()
    }
    child.stdout.on('data', (chunk: Buffer) =>
    {
      outBytes += chunk.byteLength
      const remaining = MAX_TRACE_BYTES - (outBytes - chunk.byteLength)
      if (remaining > 0) stdout.push(chunk.subarray(0, remaining))
      if (outBytes > MAX_TRACE_BYTES)
        startCleanup('native trace byte budget exhausted')
    })
    child.stderr.on('data', (chunk: Buffer) =>
    {
      errBytes += chunk.byteLength
      const remaining = MAX_STDERR_BYTES - (errBytes - chunk.byteLength)
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining))
      if (errBytes > MAX_STDERR_BYTES)
        startCleanup('native stderr byte budget exhausted')
    })
    child.once('error', (error) =>
    {
      issue ??= error.message
      if (child.pid === undefined) closed = true
      startCleanup()
      checkCleanup()
    })
    child.once('exit', (code) =>
    {
      exitCode = code
      startCleanup()
    })
    child.once('close', (code) =>
    {
      exitCode = code
      closed = true
      startCleanup()
      checkCleanup()
    })
  })
  const elapsedMs = performance.now() - timing.startedAtMonotonicMs
  if (elapsedMs > timing.durationMs)
    issue ??= 'native execution and cleanup exceeded their total duration'
  return {
    exitCode,
    issue,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr),
    outBytes,
    errBytes,
    startedAtUnixMs: timing.startedAtUnixMs,
    finishedAtUnixMs: Date.now(),
    elapsedMs,
    workDeadlineUnixMs:
      timing.startedAtUnixMs + timing.durationMs - CLEANUP_DURATION_MS,
    hardDeadlineUnixMs: timing.startedAtUnixMs + timing.durationMs,
    cleanup: {
      complete: cleanupComplete,
      forcedTermination,
      processGroupGone: groupGone(),
      durationMs:
        cleanupStartedAtMonotonicMs === null
          ? 0
          : performance.now() - cleanupStartedAtMonotonicMs,
    },
  }
}

function nativeTraceMetadata(bytes: Uint8Array)
{
  let startedCalls = 0,
    completedCalls = 0,
    events = 0
  const started = new Set<string>()
  const reportedModels = new Set<string>()
  const reportedReasoningEfforts = new Set<string>()
  const scanIssues: string[] = []
  const attempts: {
    id: string | null
    server: string | null
    tool: string | null
  }[] = []
  const bounded = (value: unknown) =>
    typeof value === 'string' ? value.slice(0, 256) : null
  for (const line of Buffer.from(bytes)
    .toString('utf8')
    .split('\n')
    .filter(Boolean))
    {
    if (++events > 10000 || line.length > 1024 * 1024)
    {
      scanIssues.push(
        'native trace metadata exceeds its bounded event envelope'
      )
      break
    }
    let event: Record<string, unknown> | null
    try
    {
      event = unknownRecord(JSON.parse(line))
    }
    catch
    {
      if (scanIssues.length < 8)
        scanIssues.push(`native trace event ${events} is not JSON`)
      continue
    }
    if (!event) continue
    const item = unknownRecord(event.item)
    for (const value of [event, item])
    {
      if (!value) continue
      if (typeof value.model === 'string' && value.model.length <= 128)
        reportedModels.add(value.model)
      const effort = value.reasoning_effort ?? value.model_reasoning_effort
      if (typeof effort === 'string' && effort.length <= 128)
        reportedReasoningEfforts.add(effort)
    }
    if (item?.type !== 'mcp_tool_call') continue
    if (event.type === 'item.started')
    {
      startedCalls++
      if (typeof item.id === 'string') started.add(item.id)
      if (attempts.length <= MAX_CALLS)
        attempts.push({
          id: bounded(item.id),
          server: bounded(item.server),
          tool: bounded(item.tool),
        })
    }
    else if (event.type === 'item.completed') completedCalls++
  }
  return {
    startedCalls,
    uniqueStartedCalls: started.size,
    completedCalls,
    attempts,
    attemptSamplesTruncated: attempts.length < startedCalls,
    scanIssues,
    reportedModels: [...reportedModels],
    reportedReasoningEfforts: [...reportedReasoningEfforts],
  }
}

function parseCalls(bytes: Uint8Array): {
  calls: NativeCallV1[]
  threadId: string
}
{
  const calls: NativeCallV1[] = []
  const pending = new Set<string>()
  const started = new Set<string>()
  let threadId: string | null = null
  let completedTurns = 0,
    count = 0
  for (const line of Buffer.from(bytes)
    .toString('utf8')
    .split('\n')
    .filter(Boolean))
    {
    assert.ok(
      ++count <= 10000 && line.length <= 1024 * 1024,
      'native trace event budget exhausted'
    )
    const event = record(JSON.parse(line))
    if (event.type === 'thread.started') threadId = text(event.thread_id)
    assert.ok(
      event.type !== 'turn.failed' && event.type !== 'error',
      'native trace records a failed turn'
    )
    if (event.type === 'turn.completed') completedTurns++
    const item = unknownRecord(event.item)
    if (!item) continue
    assert.ok(
      !forbiddenExecutionEvent(String(item.type)),
      'native agent used an unapproved execution surface'
    )
    if (item.type !== 'mcp_tool_call')
    {
      assert.ok(
        !('tool' in item || 'name' in item || 'namespace' in item),
        'native orchestration wrapper needs independently verified subcall evidence'
      )
      continue
    }
    const id = text(item.id)
    if (event.type === 'item.started')
    {
      assert.ok(!started.has(id), 'native MCP start identifier repeated')
      assert.ok(
        started.size < MAX_CALLS,
        'native MCP admission budget exhausted'
      )
      started.add(id)
      pending.add(id)
      continue
    }
    if (event.type !== 'item.completed') continue
    assert.ok(pending.delete(id), 'native MCP completion has no matching start')
    const server = text(item.server),
      tool = text(item.tool)
    const allowlist =
      server === SERVER_NAMES[0]
        ? AUTHORING_TOOL_NAMES_V1
        : server === SERVER_NAMES[1]
          ? DEVELOPMENT_TOOL_NAMES_V1
          : []
    assert.ok(
      (allowlist as readonly string[]).includes(tool),
      'native agent called a tool outside its allowlist'
    )
    assert.equal(item.status, 'completed', 'native MCP call did not complete')
    const result = record(item.result)
    assert.ok(
      result.isError !== true && result.is_error !== true,
      'native MCP call returned an error'
    )
    const outcome = record(
      result.structured_content ?? result.structuredContent
    )
    assert.equal(outcome.tool, tool)
    assert.equal(outcome.ok, true, 'native MCP outcome refused the operation')
    assert.ok(calls.length < MAX_CALLS, 'native MCP call budget exhausted')
    calls.push({
      server,
      tool,
      request: record(item.arguments),
      outcome,
      data: record(outcome.data),
    })
  }
  assert.equal(pending.size, 0)
  assert.equal(completedTurns, 1)
  assert.ok(threadId)
  return { calls, threadId }
}

function verifyNativeAdmissions(
  calls: readonly NativeCallV1[],
  budget: NativeAdmissionBudgetVerificationV1
): void
{
  assert.equal(
    budget.ok,
    true,
    `native admission evidence refused: ${budget.issues.join('; ')}`
  )
  assert.equal(budget.overflow, false)
  assert.ok(budget.admittedCount <= MAX_CALLS)
  assert.equal(budget.admittedCount, calls.length)
  assert.equal(budget.completedCount, calls.length)
  const identity = (profile: string, tool: unknown, input: unknown) =>
    canonicalSha256({ profile, tool, input })
  const expected = new Map<string, number>()
  for (const call of calls)
  {
    const key = identity(
      call.server === SERVER_NAMES[0] ? 'authoring-v1' : 'development-v1',
      call.tool,
      call.request
    )
    expected.set(key, (expected.get(key) ?? 0) + 1)
  }
  for (const claim of budget.claims)
  {
    const request = record(claim.request)
    assert.equal(request.method, 'tools/call')
    const params = record(request.params)
    assert.equal(params.name, claim.toolName)
    const key = identity(claim.profile, claim.toolName, params.arguments ?? {})
    const remaining = expected.get(key) ?? 0
    assert.ok(remaining > 0, 'durable native admission has no exact trace call')
    expected.set(key, remaining - 1)
  }
  assert.ok(
    [...expected.values()].every((count) => count === 0),
    'native trace has no exact durable admission'
  )
}

async function verifyAudit(
  calls: readonly NativeCallV1[],
  evidenceRoot: string,
  profileSha256: string
)
{
  const directories = readdirSync(evidenceRoot, { withFileTypes: true }).filter(
    (entry) => entry.name.startsWith('mcp-audit-')
  )
  assert.equal(directories.length, 1, 'expected one scoped MCP audit')
  const directory = join(evidenceRoot, directories[0]!.name)
  assert.ok(lstatSync(directory).isDirectory())
  const chain = await verifyWorkbenchCallAuditV1(directory, profileSha256)
  assert.equal(chain.matched, true)
  assert.equal(
    chain.calls,
    calls.length,
    'native trace omits or invents retained MCP calls'
  )
  const seen = new Set<number>()
  for (const call of calls)
  {
    const receipt = record(call.data.audit)
    assert.equal(receipt.auditDirectory, directory)
    const sequence = receipt.sequence
    assert.ok(
      Number.isSafeInteger(sequence) &&
        (sequence as number) > 0 &&
        (sequence as number) < chain.records
    )
    assert.ok(!seen.has(sequence as number), 'native audit receipt repeated')
    seen.add(sequence as number)
    const completePath = join(
      directory,
      `${String(sequence).padStart(6, '0')}.json`
    )
    const raw = readBoundedRegularFileV1(
      completePath,
      128 * 1024,
      'audit completion'
    )
    assert.equal(sha256(raw), receipt.recordSha256)
    const complete = record(JSON.parse(Buffer.from(raw).toString('utf8')))
    assert.equal(complete.kind, 'complete')
    assert.equal(complete.tool, call.tool)
    const data = { ...call.data }
    delete data.audit
    assert.equal(
      canonicalSha256(complete.payload),
      canonicalSha256({ ...call.outcome, data })
    )
    const begin = record(
      readBoundedJsonV1(
        join(
          directory,
          `${String((sequence as number) - 1).padStart(6, '0')}.json`
        ),
        'audit begin'
      )
    )
    assert.equal(begin.kind, 'begin')
    assert.equal(begin.callId, complete.callId)
    assert.equal(begin.tool, call.tool)
    assert.equal(canonicalSha256(begin.payload), canonicalSha256(call.request))
  }
  return chain
}

function one(calls: readonly NativeCallV1[], tool: string): NativeCallV1
{
  const matches = calls.filter((call) => call.tool === tool)
  assert.equal(matches.length, 1, `expected one actual ${tool} call`)
  return matches[0]!
}

function retainedArtifact(
  value: unknown,
  root: string,
  maximum = 1024 * 1024
): Buffer
{
  const artifact = record(value)
  const path = resolve(text(artifact.path))
  assert.ok(
    path.startsWith(`${resolve(root)}${sep}`),
    'artifact escapes its operator evidence root'
  )
  let cursor = path
  while (cursor !== resolve(root))
  {
    assert.ok(
      !lstatSync(cursor).isSymbolicLink(),
      'artifact path contains a symbolic link'
    )
    cursor = dirname(cursor)
  }
  const bytes = readBoundedRegularFileV1(
    path,
    maximum,
    'retained workbench artifact'
  )
  assert.equal(bytes.byteLength, artifact.byteLength)
  assert.equal(sha256(bytes), artifact.sha256)
  return Buffer.from(bytes)
}

async function main(): Promise<void>
{
  let runsRoot = join(REPOSITORY_ROOT, 'runs'),
    prepareOnly = false,
    durationMs = 180000
  let model: string | undefined
  for (let index = 2; index < process.argv.length; index++)
  {
    const argument = process.argv[index]
    if (argument === '--prepare-only') prepareOnly = true
    else if (argument === '--runs-root')
      runsRoot = resolve(text(process.argv[++index]))
    else if (argument === '--max-duration-ms')
      durationMs = Number(text(process.argv[++index]))
    else if (argument === '--model')
    {
      assert.equal(model, undefined, '--model may be supplied only once')
      model = text(process.argv[++index])
      assert.match(
        model,
        /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/u,
        '--model must be one bounded model identifier'
      )
    }
    else throw new Error(`unknown native acceptance option ${argument}`)
  }
  assert.ok(
    Number.isSafeInteger(durationMs) &&
      durationMs >= 10000 + CLEANUP_DURATION_MS &&
      durationMs <= MAX_DURATION_MS,
    'native execution and cleanup duration must be 25000..300000 ms'
  )
  const layout = createSemanticEditRunLayoutV1(
    runsRoot,
    `authoring-native-${newRunId()}`
  )
  const configured = configuredCodexSettings()
  const selection = {
    model: model ?? 'inherited-configured-default',
    reasoningEffort: 'inherited-configured-default',
    configuration: {
      rootModel: configured.rootModel,
      rootReasoningEffort: configured.rootReasoningEffort,
      profile: configured.profile,
    },
  }
  const admissionRoot = join(layout.evidenceRoot, 'native-admissions')
  let admission:
    Awaited<ReturnType<typeof createNativeAdmissionBudgetV1>> | undefined
  try
  {
    const start = captureSemanticEditAuthorityV1(layout.runRoot, 'start')
    const staticAuthority = semanticEditStaticAuthorityV1()
    const generated = await writeGeneratedSemanticEditInputsV1(layout)
    const registry = await writeSemanticEditBenchmarkFixtureV1({
      root: join(layout.configRoot, 'registry'),
      inputs: generated,
    })
    const host = prepareSemanticEditMcpHostV1({
      layout,
      principalSha256: canonicalSha256({
        kind: 'authoring-native-acceptance-v1',
        runId: randomUUID(),
      }),
      pinnedScratchRuntimeSourceSha256: canonicalSha256({
        schemaVersion: 1,
        sourceTreeSha256: start.source.treeSha256,
        versions: staticAuthority.versions,
      }),
      authoritativeBuildManifestSha256: start.executableManifest.sha256,
      behaviorContract: registry.behaviorContract,
      mediaContract: registry.mediaContract,
      contractRegistryPath: registry.registryPath,
      evidenceSummaryRelativePath: 'evidence/authoring-native-acceptance.json',
    })
    const fixture = await prepareGenericAuthoringAcceptanceV1(
      join(layout.runRoot, 'workbench')
    )
    const destination = join(fixture.output, 'native-two-player.sb3')
    const schemaPath = join(layout.configRoot, 'output-schema.json')
    const finalPath = join(layout.evidenceRoot, 'native-final.json')
    writeJsonExclusive(schemaPath, {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string' },
        planId: { type: 'string' },
        buildId: { type: 'string' },
        candidateSha256: { type: 'string' },
        exportPath: { type: 'string' },
        evaluationDisposition: { type: 'string', const: 'accepted' },
        sessionId: { type: 'string' },
        markId: { type: 'string' },
        replayDisposition: { type: 'string', const: 'matched' },
        player1X: { type: 'number' },
        player2X: { type: 'number' },
      },
      required: [
        'workspaceId',
        'planId',
        'buildId',
        'candidateSha256',
        'exportPath',
        'evaluationDisposition',
        'sessionId',
        'markId',
        'replayDisposition',
        'player1X',
        'player2X',
      ],
    })
    assertCodexOutputSchemaCompatible(
      readBoundedJsonV1(schemaPath, 'native final output schema')
    )
    const prompt = [
      'Perform one bounded generic Scratch workbench acceptance using only the two supplied MCP servers. Bounded Codex code orchestration is permitted solely to invoke those supplied MCP tools and emit their complete structured results. Do not use shell, filesystem operations, network, any other tools or subcalls, or additional agents. Source files are already prepared; all outputs must come from actual successful MCP responses. Call sequentially. Stop if a tool refuses.',
      `On scratch_authoring: authoring_open manifestPath=${JSON.stringify(fixture.manifestPath)}; retain workspaceId. authoring_plan, authoring_build with returned planId, authoring_evaluate with returned buildId. Require disposition accepted. authoring_inspect collection clips, limit 4; confirm Walk resolves costume indices [18,1] and durations [40,60]. authoring_export that exact accepted build to ${JSON.stringify(destination)}.`,
      'On scratch_development: development_begin on that exported path with expectedSourceSha256 from the build, visible false, inputMode agent, profile {schemaVersion:1,runtime:"turbowarp",scheduler:"deterministic",tickRate:60}, probe {targets:[{targetIndex:1},{targetIndex:2}]}. Retain sessionId.',
      'Use development_command: start, advance 1, input keyboard d true, input keyboard l true, advance 4, input keyboard d false, input keyboard l false, mark label "two-player held input". Retain markId. Then pause. Inspect state limit 10; read the latest Player1 and Player2 x values. Both must be positive and equal. Reproduce the mark with denseCapture {maxFrames:5,maxBytes:1048576}; require disposition matched. Inspect inputs limit 10; confirm both key-down and key-up events. Inspect artifacts limit 10. Close the development session and authoring workspace.',
      'Return only JSON matching the schema: exact workspaceId, planId, buildId, candidateSha256, exportPath, evaluationDisposition, sessionId, markId, replayDisposition, player1X, player2X. Never invent successful output.',
    ].join('\n')
    const nativeArguments = (budget?: typeof admission) => [
      'exec',
      prompt,
      ...(model === undefined ? [] : ['--model', model]),
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--cd',
      layout.workspaceRoot,
      '--json',
      '--output-last-message',
      finalPath,
      '--output-schema',
      schemaPath,
      '--config',
      'web_search="disabled"',
      ...[
        'shell_tool',
        'unified_exec',
        'computer_use',
        'browser_use',
        'image_generation',
        'apps',
        'plugins',
        'multi_agent',
        'multi_agent_v2',
      ].flatMap((feature) => ['--disable', feature]),
      ...serverArguments({
        layout,
        host,
        fixture,
        timeoutMs: durationMs,
        configuredServers: configured.servers,
        ...(budget ? { admission: budget } : {}),
      }),
    ]
    const invocation = {
      schemaVersion: 2,
      command: 'codex',
      sandbox: 'read-only',
      ...selection,
      durationMs,
      workDurationMs: durationMs - CLEANUP_DURATION_MS,
      cleanupDurationMs: CLEANUP_DURATION_MS,
      maxToolCalls: MAX_CALLS,
    }
    const sourceBefore = treeIdentity(fixture.sources)
    const preAgent = captureSemanticEditAuthorityV1(layout.runRoot, 'pre-agent')
    assert.ok(
      semanticEditAuthoritySnapshotsMatchV1(start, preAgent),
      'authority changed during preparation'
    )
    if (prepareOnly)
    {
      writeJsonExclusive(join(layout.configRoot, 'invocation.json'), {
        ...invocation,
        args: nativeArguments(),
        admission: {
          state: 'created-only-at-native-start',
          required: true,
          root: admissionRoot,
        },
      })
      const prepared = {
        schemaVersion: 1,
        disposition: 'prepared',
        runRoot: layout.runRoot,
        invocation: join(layout.configRoot, 'invocation.json'),
        ...selection,
        agents: 0,
      }
      writeJsonExclusive(
        join(layout.runRoot, 'native-acceptance.json'),
        prepared
      )
      console.log(JSON.stringify(prepared))
      return
    }
    const cliVersion = requireCodexCliVersion()
    requireCodexChatGptLogin()
    const startedAtUnixMs = Date.now()
    const startedAtMonotonicMs = performance.now()
    admission = await createNativeAdmissionBudgetV1({
      root: admissionRoot,
      runId: `native-${randomUUID()}`,
      startedAtUnixMs,
      workDeadlineUnixMs: startedAtUnixMs + durationMs - CLEANUP_DURATION_MS,
      hardDeadlineUnixMs: startedAtUnixMs + durationMs,
    })
    const args = nativeArguments(admission)
    writeJsonExclusive(join(layout.configRoot, 'invocation.json'), {
      ...invocation,
      args,
      admission,
    })
    const execution = await runCodex(args, layout.workspaceRoot, {
      startedAtUnixMs,
      startedAtMonotonicMs,
      durationMs,
    })
    writeExclusive(
      join(layout.evidenceRoot, 'native-trace.jsonl'),
      execution.stdout
    )
    writeExclusive(
      join(layout.evidenceRoot, 'native-stderr.txt'),
      execution.stderr
    )
    const traceMetadata = nativeTraceMetadata(execution.stdout)
    let parsed: ReturnType<typeof parseCalls> | undefined
    let traceIssue: string | null = null
    try
    {
      parsed = parseCalls(execution.stdout)
      if (model !== undefined)
        assert.ok(
          traceMetadata.reportedModels.every((reported) => reported === model),
          'native trace reports a model different from --model'
        )
    }
    catch (error)
    {
      traceIssue = error instanceof Error ? error.message : String(error)
    }
    const traceVerification = {
      ok: traceIssue === null,
      issue: traceIssue,
      ...traceMetadata,
    }
    writeJsonExclusive(
      join(layout.evidenceRoot, 'native-trace-verification.json'),
      traceVerification
    )
    writeJsonExclusive(join(layout.evidenceRoot, 'native-process.json'), {
      ...execution,
      stdout: undefined,
      stderr: undefined,
      cliVersion,
      ...selection,
      reportedModels: traceVerification.reportedModels,
      reportedReasoningEfforts: traceVerification.reportedReasoningEfforts,
    })
    const admissionVerification = await verifyNativeAdmissionBudgetV1(admission)
    const admissionVerificationPath = join(
      layout.evidenceRoot,
      'native-admission-verification.json'
    )
    writeJsonExclusive(admissionVerificationPath, admissionVerification)
    assert.equal(
      execution.issue,
      null,
      'native process did not finish within its retained limits'
    )
    assert.equal(
      execution.exitCode,
      0,
      'native process did not exit successfully; see retained stderr'
    )
    assert.equal(
      execution.cleanup.complete,
      true,
      'native owned processes did not finish cleanup'
    )
    assert.equal(execution.cleanup.processGroupGone, true)
    assert.ok(execution.elapsedMs <= durationMs)
    assert.equal(traceIssue, null, 'native trace verification failed')
    assert.ok(parsed)
    verifyNativeAdmissions(parsed.calls, admissionVerification)
    const authoringCalls = parsed.calls.filter(
      (call) => call.server === SERVER_NAMES[0]
    )
    const developmentCalls = parsed.calls.filter(
      (call) => call.server === SERVER_NAMES[1]
    )
    assert.ok(
      authoringCalls.length > 0 && developmentCalls.length > 0,
      'native trace lacks independently auditable calls to both scoped MCP servers'
    )
    const authoringAudit = await verifyAudit(
      authoringCalls,
      fixture.evidence,
      productionEditProfileAuthoritySha256V1(
        EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
        'standard-v2'
      )
    )
    const developmentAudit = await verifyAudit(
      developmentCalls,
      fixture.developmentEvidence,
      developmentProfileAuthoritySha256V1()
    )
    const opened = one(authoringCalls, 'authoring_open'),
      planned = one(authoringCalls, 'authoring_plan'),
      built = one(authoringCalls, 'authoring_build'),
      evaluated = one(authoringCalls, 'authoring_evaluate'),
      exported = one(authoringCalls, 'authoring_export')
    const workspaceId = text(opened.data.workspaceId),
      planId = text(planned.data.planId),
      buildId = text(built.data.buildId),
      candidateSha256 = text(built.data.candidateSha256)
    assert.equal(opened.request.manifestPath, fixture.manifestPath)
    for (const call of authoringCalls.filter(
      (call) => call.tool !== 'authoring_open'
    ))
      assert.equal(call.request.workspaceId, workspaceId)
    assert.equal(built.request.planId, planId)
    assert.equal(planned.data.candidateSha256, candidateSha256)
    assert.equal(evaluated.request.buildId, buildId)
    assert.equal(evaluated.data.disposition, 'accepted')
    assert.equal(evaluated.data.candidateSha256, candidateSha256)
    assert.equal(exported.request.buildId, buildId)
    assert.equal(exported.request.destinationPath, destination)
    assert.equal(exported.data.candidateSha256, candidateSha256)
    assert.equal(
      sha256(
        readBoundedRegularFileV1(destination, 50 * 1024 * 1024, 'native export')
      ),
      candidateSha256
    )
    assert.equal(one(authoringCalls, 'authoring_close').data.closed, true)
    assert.ok(
      authoringCalls.some(
        (call) =>
          call.tool === 'authoring_inspect' &&
          call.request.collection === 'clips'
      )
    )
    const clipPage = authoringCalls.find(
      (call) =>
        call.tool === 'authoring_inspect' && call.request.collection === 'clips'
    )!
    assert.ok(Array.isArray(clipPage.data.items))
    const clip = record(clipPage.data.items[0])
    assert.equal(clip.name, 'Walk')
    const tables = record(clip.tables)
    assert.deepEqual(tables.costumeIndexesOneBased, [18, 1])
    assert.deepEqual(tables.durationsMs, [40, 60])
    const begun = one(developmentCalls, 'development_begin'),
      marked = developmentCalls.filter(
        (call) =>
          call.tool === 'development_command' &&
          record(call.request.command).kind === 'mark'
      )
    assert.equal(marked.length, 1)
    const sessionId = text(begun.data.sessionId),
      markId = text(marked[0]!.data.markId)
    assert.equal(begun.request.sourcePath, destination)
    assert.equal(begun.request.expectedSourceSha256, candidateSha256)
    assert.equal(begun.request.visible, false)
    assert.equal(begun.request.inputMode, 'agent')
    assert.deepEqual(begun.request.profile, {
      schemaVersion: 1,
      runtime: 'turbowarp',
      scheduler: 'deterministic',
      tickRate: 60,
    })
    for (const call of developmentCalls.filter(
      (call) => call.tool !== 'development_begin'
    ))
      assert.equal(call.request.sessionId, sessionId)
    const reproduced = one(developmentCalls, 'development_reproduce')
    assert.equal(reproduced.request.markId, markId)
    assert.deepEqual(reproduced.request.denseCapture, {
      maxFrames: 5,
      maxBytes: 1048576,
    })
    assert.equal(reproduced.data.disposition, 'matched')
    const report = JSON.parse(
      retainedArtifact(
        reproduced.data.result,
        fixture.developmentEvidence
      ).toString('utf8')
    ) as DevelopmentReproductionReportV2
    assert.deepEqual(validateDevelopmentReproductionReportV1(report), [])
    assert.equal(report.schemaVersion, 2)
    assert.equal(report.kind, 'development-reproduction-v2')
    assert.equal(report.sessionId, sessionId)
    assert.equal(report.markId, markId)
    assert.equal(report.disposition, 'matched')
    assert.equal(report.sourceSha256, candidateSha256)
    assert.equal(
      sha256(
        retainedArtifact(
          report.source,
          fixture.developmentEvidence,
          50 * 1024 * 1024
        )
      ),
      candidateSha256
    )
    assert.equal(report.inputApplicationVerified, true)
    const priorCommand = developmentCalls
      .slice(0, developmentCalls.indexOf(reproduced))
      .reverse()
      .find((call) => call.tool === 'development_command')
    const alreadyPaused =
      priorCommand !== undefined &&
      record(priorCommand.request.command).kind === 'pause' &&
      priorCommand.data.status === 'paused' &&
      priorCommand.data.segmentId === report.mark?.segmentId &&
      priorCommand.data.tick === report.mark?.tick &&
      priorCommand.data.sourceSha256 === candidateSha256
    assert.ok(
      report.originalPaused || alreadyPaused,
      'original browser was not paused at the audited reproduction boundary'
    )
    assert.equal(report.schedulerConversion, 'none')
    assert.ok(report.frames.length > 0 && report.frames.length <= 5)
    for (const frame of report.frames)
    {
      retainedArtifact(frame.image, fixture.developmentEvidence, 1024 * 1024)
      retainedArtifact(frame.metadata, fixture.developmentEvidence)
    }
    assert.ok(report.mark)
    assert.equal(report.mark.tick, 5)
    const targets = report.mark.frame.targets
    const player1X = targets.find(
      (target) => target.targetIndex === 1 && target.instance === 'original'
    )?.x
    const player2X = targets.find(
      (target) => target.targetIndex === 2 && target.instance === 'original'
    )?.x
    assert.ok(typeof player1X === 'number' && player1X > 0)
    assert.equal(player1X, player2X)
    for (const key of ['d', 'l'])
      for (const isDown of [true, false])
        assert.ok(
          report.prefix.some(
            (event) =>
              event.device === 'keyboard' &&
              'interpretedKey' in event &&
              event.interpretedKey === canonicalInputKey(key) &&
              event.data.isDown === isDown
          ),
          'reproducer omitted held-key evidence'
        )
    const closed = one(developmentCalls, 'development_close')
    assert.equal(closed.data.status, 'closed')
    const retainedTrace = JSON.parse(
      retainedArtifact(
        closed.data.trace,
        fixture.developmentEvidence,
        16 * 1024 * 1024
      ).toString('utf8')
    ) as DevelopmentTraceV2
    assert.equal(retainedTrace.schemaVersion, 2)
    assert.equal(retainedTrace.kind, 'development-trace-v2')
    assert.equal(retainedTrace.captureComplete, true)
    assert.equal(retainedTrace.sessionId, sessionId)
    assert.equal(retainedTrace.sourceSha256, candidateSha256)
    assert.equal(retainedTrace.segments.length, 1)
    assert.equal(retainedTrace.segments[0]?.status, 'closed')
    assert.equal(
      retainedTrace.segments[0]?.runtimeIdentitySha256,
      report.recordedRuntimeIdentitySha256
    )
    assert.equal(
      canonicalSha256(
        retainedTrace.marks.find((mark) => mark.markId === markId)
      ),
      canonicalSha256(report.mark)
    )
    assert.equal(
      canonicalSha256(
        retainedTrace.inputs.filter(
          (input) => input.ordinal <= report.mark!.inputOrdinal
        )
      ),
      canonicalSha256(report.prefix)
    )
    for (const collection of ['state', 'inputs', 'artifacts'])
      assert.ok(
        developmentCalls.some(
          (call) =>
            call.tool === 'development_inspect' &&
            call.request.collection === collection
        )
      )
    const final = record(readBoundedJsonV1(finalPath, 'native final result'))
    for (const [key, value] of Object.entries({
      workspaceId,
      planId,
      buildId,
      candidateSha256,
      exportPath: destination,
      evaluationDisposition: 'accepted',
      sessionId,
      markId,
      replayDisposition: 'matched',
      player1X,
      player2X,
    }))
      assert.equal(
        final[key],
        value,
        `native final ${key} differs from retained evidence`
      )
    assert.equal(
      treeIdentity(fixture.sources),
      sourceBefore,
      'native workflow changed authored source files'
    )
    const evidenceBefore = treeIdentity(fixture.evidence),
      developmentBefore = treeIdentity(fixture.developmentEvidence),
      outputsBefore = treeIdentity(fixture.output)
    const loaded = await readAuthoringHostConfigurationV1(
      fixture.hostConfigPath
    )
    const service = await createAuthoringWorkspaceServiceV1({
      permissions: loaded.configuration.permissions,
    })
    const replay = await service.replay({ workspaceId, buildId })
    assert.equal(replay.disposition, 'matched')
    assert.equal(replay.candidateSha256, candidateSha256)
    assert.equal(replay.replayWrites, 0)
    assert.equal(replay.agents, 0)
    assert.equal(
      treeIdentity(fixture.evidence),
      evidenceBefore,
      'readonly build replay wrote evidence'
    )
    assert.equal(
      treeIdentity(fixture.developmentEvidence),
      developmentBefore,
      'readonly build replay changed playtest evidence'
    )
    assert.equal(
      treeIdentity(fixture.sources),
      sourceBefore,
      'readonly build replay changed authored sources'
    )
    assert.equal(
      treeIdentity(fixture.output),
      outputsBefore,
      'readonly build replay changed exported outputs'
    )
    const completion = captureSemanticEditAuthorityV1(
      layout.runRoot,
      'completion'
    )
    assert.ok(
      semanticEditAuthoritySnapshotsMatchV1(preAgent, completion),
      'source or executable authority drifted during native acceptance'
    )
    const summary = {
      schemaVersion: 1,
      disposition: 'accepted',
      runRoot: layout.runRoot,
      cliVersion,
      ...selection,
      reportedModels: traceMetadata.reportedModels,
      reportedReasoningEfforts: traceMetadata.reportedReasoningEfforts,
      nativeElapsedMs: execution.elapsedMs,
      nativeAdmission: {
        root: admission.root,
        manifestSha256: admission.manifestSha256,
        verification: admissionVerificationPath,
        admittedCount: admissionVerification.admittedCount,
        completedCount: admissionVerification.completedCount,
        maxToolCalls: MAX_CALLS,
      },
      sandbox: 'read-only',
      threadId: parsed.threadId,
      tools: parsed.calls.map((call) => call.tool),
      authoringAudit,
      developmentAudit,
      ...final,
      replay,
      agents: 1,
      sourcePreserved: true,
      authorityStable: true,
    }
    writeJsonExclusive(join(layout.runRoot, 'native-acceptance.json'), summary)
    console.log(JSON.stringify(summary))
  }
  catch (error)
  {
    const failure = {
      schemaVersion: 1,
      disposition: 'refused',
      runRoot: layout.runRoot,
      ...selection,
      ...(admission ? { nativeAdmission: admission } : {}),
      issue: error instanceof Error ? error.message : String(error),
    }
    writeJsonExclusive(
      join(layout.runRoot, 'native-acceptance-failure.json'),
      failure
    )
    console.error(JSON.stringify(failure))
    process.exitCode = 1
  }
}

await main()
