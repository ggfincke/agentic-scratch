// scripts/semantic-edit/bench.ts
// prepare or execute the generic zero-agent semantic-edit acceptance benchmark

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { DurableArtifactStore } from '@scratch-agent/eval'
import {
  AUDIT_IDEMPOTENCY_PREFIX,
  AUDIT_RECORD_PREFIX,
  AUDIT_SERVER_MANIFEST_KEY,
  AUDIT_STORE_DIRECTORY_PREFIX,
  AUDIT_SUPERVISOR_DIRECTORY,
  AUDIT_SUPERVISOR_INDEX_KEY,
  AUDIT_TERMINAL_KEY,
} from '@scratch-agent/mcp'
import { newRunId } from '@scratch-agent/runner'

import {
  SEMANTIC_EDIT_BENCHMARK_WORKFLOWS,
  MAX_SEMANTIC_EDIT_EVIDENCE_BYTES,
  SEMANTIC_EDIT_NEGATIVE_PROBES,
  assertAuthoritativeNpmLifecycleV1,
  captureSemanticEditAuthorityV1,
  canonicalSha256,
  createSemanticEditRunLayoutV1,
  portablePath,
  readBoundedRegularFileV1,
  readBoundedJsonV1,
  parseSemanticEditAcceptedEvidenceV1,
  reconcileSemanticEditTraceV1,
  semanticEditAuthoritySnapshotsMatchV1,
  semanticEditStaticAuthorityV1,
  sha256,
  writeGeneratedSemanticEditInputsV1,
  writeExclusive,
  writeJsonExclusive,
  type SemanticEditAcceptedEvidenceV1,
  type SemanticEditAcceptedEvidenceAuthorityV1,
  type SemanticEditRunLayoutV1,
  type SemanticEditTraceRecordV1,
} from './harness.js'
import { writeSemanticEditBenchmarkFixtureV1 } from './benchmark-fixtures.js'
import {
  runSemanticEditAuditNearFullProbeV1,
  runSemanticEditBenchmarkWorkflowsV1,
  runSemanticEditEvaluationDispositionProbeV1,
  type SemanticEditProbeExecutionV1,
  type SemanticEditWorkflowExecutionSetV1,
} from './benchmark-run.js'
import {
  createSemanticEditMcpPredecessorHandoffV1,
  createSemanticEditMcpDriverV1,
  prepareSemanticEditMcpHostV1,
  prepareSemanticEditMcpSuccessorHostV1,
  recheckPreparedSemanticEditMcpHostV1,
  recoverSemanticEditMcpPredecessorHandoffV1,
  type PreparedSemanticEditMcpHostV1,
  type SemanticEditMcpDriverV1,
  type SemanticEditToolProfileEvidenceV1,
} from './mcp-driver.js'

interface CliOptions
{
  readonly runsRoot: string
  readonly prepareOnly: boolean
  readonly secretMaterialPath?: string
}

const USAGE =
  'usage: npm run semantic-edit-bench -- [--runs-root <dir>] [--secret-material <absolute-json>] [--prepare-only]'

interface AuditProcessStoreSnapshotV1
{
  readonly storeKey: string
  readonly manifestBytes: Uint8Array
  readonly manifest: Record<string, unknown>
  readonly capability: ReturnType<DurableArtifactStore['capability']>
  readonly records: readonly Record<string, unknown>[]
  readonly entries: readonly {
    readonly key: string
    readonly sha256: string
    readonly byteLength: number
  }[]
  readonly contentSha256: string
}

interface FreshReplayAcceptanceV1
{
  readonly report: Record<string, unknown>
  readonly exactMatches: number
  readonly total: number
  readonly agentExecutions: 0
  readonly identityReconciliationSha256: string
}

interface SecretBoundaryPayloadV1
{
  readonly label: string
  readonly bytes: Uint8Array
}

interface PredecessorRecoveryProbeResultV1
{
  readonly probe: SemanticEditProbeExecutionV1
  readonly assertSecretBoundary: (
    payloads: readonly SecretBoundaryPayloadV1[]
  ) => void
}

function fail(message: string): never
{
  throw new Error(`${message}\n${USAGE}`)
}

function object(value: unknown, label: string): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function decodeJsonBytes(
  bytes: Uint8Array,
  label: string
): Record<string, unknown>
{
  try
  {
    return object(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      label
    )
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new Error(`${label} could not be decoded: ${message}`)
  }
}

const MAX_SECRET_SCAN_ENTRIES = 20_000
const MAX_SECRET_SCAN_FILE_BYTES = 64 * 1024 * 1024
const MAX_SECRET_SCAN_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

function createSecretBoundaryVerifier(input: {
  readonly runRoot: string
  readonly authorizedSecretFiles: readonly string[]
  readonly tokens: readonly string[]
}): (payloads: readonly SecretBoundaryPayloadV1[]) => void
{
  const runRoot = resolve(input.runRoot)
  const authorizedSecretFiles = new Set(
    input.authorizedSecretFiles.map((path) =>
    {
      const resolved = resolve(path)
      if (!resolved.startsWith(`${runRoot}${sep}`))
        throw new Error('authorized secret file escapes the benchmark run')
      return resolved
    })
  )
  if (
    authorizedSecretFiles.size !== input.authorizedSecretFiles.length ||
    authorizedSecretFiles.size === 0
  )
    throw new Error('authorized secret file set is empty or duplicated')
  const needles = new Map<string, Buffer>()
  for (const token of input.tokens)
  {
    if (typeof token !== 'string' || token.length === 0)
      throw new Error('secret-boundary token is invalid')
    const encoded = Buffer.from(token, 'utf8')
    const decoded = Buffer.from(token, 'base64url')
    if (decoded.byteLength < 32 || decoded.toString('base64url') !== token)
      throw new Error('secret-boundary token is not canonical key material')
    needles.set(`encoded:${encoded.toString('hex')}`, encoded)
    needles.set(`decoded:${decoded.toString('hex')}`, decoded)
  }
  const needleBytes = [...needles.values()]
  const assertClean = (bytes: Uint8Array, label: string): void =>
  {
    const buffer = Buffer.from(bytes)
    if (needleBytes.some((needle) => buffer.includes(needle)))
      throw new Error(`raw secret material entered ${label}`)
  }
  return (payloads): void =>
  {
    const pending = [runRoot]
    const observedAuthorizedFiles = new Set<string>()
    let entries = 0
    let totalBytes = 0
    while (pending.length > 0)
    {
      const current = pending.pop()!
      entries += 1
      if (entries > MAX_SECRET_SCAN_ENTRIES)
        throw new Error('secret-boundary scan exceeded its entry bound')
      const status = lstatSync(current)
      if (status.isSymbolicLink())
        throw new Error('secret-boundary scan encountered a symbolic link')
      if (status.isDirectory())
      {
        for (const entry of readdirSync(current).sort().reverse())
          pending.push(join(current, entry))
        continue
      }
      if (!status.isFile() || status.size > MAX_SECRET_SCAN_FILE_BYTES)
        throw new Error('secret-boundary scan encountered an unsupported file')
      const bytes = readBoundedRegularFileV1(
        current,
        MAX_SECRET_SCAN_FILE_BYTES,
        'secret-boundary file'
      )
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_SECRET_SCAN_TOTAL_BYTES)
        throw new Error(
          'secret-boundary scan exceeded its cumulative byte bound'
        )
      if (authorizedSecretFiles.has(current))
      {
        observedAuthorizedFiles.add(current)
        continue
      }
      assertClean(bytes, 'a retained benchmark artifact')
    }
    if (observedAuthorizedFiles.size !== authorizedSecretFiles.size)
      throw new Error('secret-boundary scan missed an authorized secret file')
    for (const payload of payloads)
    {
      if (payload.bytes.byteLength > MAX_SECRET_SCAN_FILE_BYTES)
        throw new Error('secret-boundary payload exceeds its byte bound')
      totalBytes += payload.bytes.byteLength
      if (totalBytes > MAX_SECRET_SCAN_TOTAL_BYTES)
        throw new Error(
          'secret-boundary scan exceeded its cumulative byte bound'
        )
      assertClean(payload.bytes, payload.label)
    }
  }
}

function currentAuditStoreKey(layout: SemanticEditRunLayoutV1): string
{
  const supervisor = new DurableArtifactStore(
    join(layout.editPrivateRoot, AUDIT_SUPERVISOR_DIRECTORY),
    { mode: 'read-only' }
  )
  const transition = object(
    decodeJsonBytes(
      supervisor.readImmutable(AUDIT_SUPERVISOR_INDEX_KEY),
      'audit supervisor transition'
    ),
    'audit supervisor transition'
  )
  const index = object(transition.index, 'audit supervisor transition index')
  const current = object(index.current, 'audit supervisor current store')
  if (
    (current.state !== 'active' && current.state !== 'terminal') ||
    typeof current.storeKey !== 'string'
  )
    throw new Error('audit supervisor has no materialized current store')
  return current.storeKey
}

function auditProcessStoreSnapshot(
  layout: SemanticEditRunLayoutV1,
  storeKey: string
): AuditProcessStoreSnapshotV1
{
  const store = new DurableArtifactStore(
    join(layout.editPrivateRoot, `${AUDIT_STORE_DIRECTORY_PREFIX}${storeKey}`),
    { mode: 'read-only' }
  )
  const manifestBytes = store.readImmutable(AUDIT_SERVER_MANIFEST_KEY)
  const manifest = decodeJsonBytes(manifestBytes, 'audit server manifest')
  if (manifest.storeKey !== storeKey)
    throw new Error('audit server manifest names another store')
  const records = store
    .listImmutable(AUDIT_RECORD_PREFIX)
    .map((entry) =>
      decodeJsonBytes(
        store.readImmutable(entry.key),
        `audit record ${entry.key}`
      )
    )
    .sort(
      (left, right) =>
        Number(object(left.record, 'left audit projection').sequence) -
        Number(object(right.record, 'right audit projection').sequence)
    )
  const capability = store.capability()
  const entries = store.listImmutable().map((entry) => ({
    key: entry.key,
    sha256: entry.sha256,
    byteLength: entry.byteLength,
  }))
  return Object.freeze({
    storeKey,
    manifestBytes,
    manifest,
    capability,
    records: Object.freeze(records),
    entries: Object.freeze(entries),
    contentSha256: canonicalSha256({
      storeId: capability.storeId,
      ownershipSha256: capability.ownershipSha256,
      entries,
    }),
  })
}

function unmatchedProjectRunBegin(
  snapshot: AuditProcessStoreSnapshotV1
): Record<string, unknown> | null
{
  const terminals = new Set<string>()
  for (const wrapper of snapshot.records)
  {
    const projection = object(wrapper.record, 'audit projection')
    if (
      projection.phase === 'call-complete' ||
      projection.phase === 'call-rejected'
    )
      if (typeof projection.callId === 'string')
        terminals.add(projection.callId)
  }
  for (const wrapper of snapshot.records)
  {
    const projection = object(wrapper.record, 'audit projection')
    const boundary = object(projection.boundary, 'audit boundary')
    if (
      projection.phase === 'call-begin' &&
      boundary.boundaryKind === 'tool' &&
      boundary.tool === 'project_run' &&
      typeof projection.callId === 'string' &&
      !terminals.has(projection.callId)
    )
    {
      if (
        typeof wrapper.recordSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(wrapper.recordSha256)
      )
        throw new Error('unmatched audit begin has no valid record digest')
      return Object.freeze({
        ...projection,
        recordSha256: wrapper.recordSha256,
      })
    }
  }
  return null
}

async function waitForUnmatchedProjectRunBegin(
  layout: SemanticEditRunLayoutV1,
  durationMs: number
): Promise<{
  readonly snapshot: AuditProcessStoreSnapshotV1
  readonly begin: Record<string, unknown>
}>
{
  const deadline = Date.now() + durationMs
  let lastError: string | null = null
  while (Date.now() < deadline)
  {
    try
    {
      const snapshot = auditProcessStoreSnapshot(
        layout,
        currentAuditStoreKey(layout)
      )
      const begin = unmatchedProjectRunBegin(snapshot)
      if (begin) return Object.freeze({ snapshot, begin })
    }
    catch (error)
    {
      lastError = error instanceof Error ? error.message : 'audit read failed'
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(
    `project_run did not retain an unmatched audit begin within ${durationMs} ms${lastError ? `: ${lastError}` : ''}`
  )
}

async function runFreshProcessReplay(input: {
  readonly layout: SemanticEditRunLayoutV1
  readonly acceptedEvidence: SemanticEditAcceptedEvidenceV1
}): Promise<FreshReplayAcceptanceV1>
{
  const editStoreRoot = join(
    input.layout.readableArtifactRoot,
    'edit-artifacts'
  )
  const scriptPath = join(process.cwd(), 'scripts/semantic-edit/replay.ts')
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const maximumOutputBytes = 128 * 1024
  const retainChunk = (target: Buffer[], chunk: Buffer): void =>
  {
    const retained = target.reduce((total, entry) => total + entry.length, 0)
    if (retained >= maximumOutputBytes) return
    target.push(chunk.subarray(0, maximumOutputBytes - retained))
  }
  const exitCode = await new Promise<number>((resolveExit, rejectExit) =>
  {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        scriptPath,
        '--run',
        editStoreRoot,
        '--out',
        input.layout.replayRoot,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    child.stdout.on('data', (chunk: Buffer) => retainChunk(stdoutChunks, chunk))
    child.stderr.on('data', (chunk: Buffer) => retainChunk(stderrChunks, chunk))
    const timeout = setTimeout(
      () =>
      {
        child.kill('SIGKILL')
        rejectExit(
          new Error('fresh-process semantic replay exceeded 10 minutes')
        )
      },
      10 * 60 * 1000
    )
    child.once('error', (error) =>
    {
      clearTimeout(timeout)
      rejectExit(error)
    })
    child.once('close', (code) =>
    {
      clearTimeout(timeout)
      resolveExit(code ?? -1)
    })
  })
  if (exitCode !== 0)
    throw new Error(
      `fresh-process semantic replay exited ${exitCode}: ${Buffer.concat(stderrChunks).toString('utf8')}`
    )
  const report = object(
    readBoundedJsonV1(
      join(input.layout.replayRoot, 'semantic-edit-replay.json'),
      'fresh-process semantic replay report',
      MAX_SEMANTIC_EDIT_EVIDENCE_BYTES
    ),
    'fresh-process semantic replay report'
  )
  const acceptance = object(
    report.acceptance,
    'fresh-process semantic replay acceptance'
  )
  if (!Array.isArray(report.sessions) || report.sessions.length !== 2)
    throw new Error(
      'fresh-process replay did not discover exactly two sessions'
    )
  const sessions = report.sessions.map((entry, index) =>
    object(entry, `fresh-process replay session ${index}`)
  )
  if (
    acceptance.passed !== true ||
    acceptance.exactMatches !== 2 ||
    acceptance.total !== 2 ||
    acceptance.agentExecutions !== 0 ||
    acceptance.storeWriteAttempts !== 0 ||
    sessions.some(
      (session) =>
        session.matched !== true || session.state !== 'closed-exported'
    )
  )
    throw new Error('fresh-process replay did not pass exact zero-agent gates')
  const identityFields = [
    'revisionSha256s',
    'parentDeltaSha256s',
    'cumulativeDeltaSha256s',
    'preservationSha256s',
    'lineageSha256s',
    'certificateSha256s',
    'reportProjectionSha256s',
    'exportReceiptSha256s',
  ] as const
  const replayIdentities = Object.fromEntries(
    identityFields.map((field) =>
    {
      const values = sessions.flatMap((session, sessionIndex) =>
      {
        const identities = object(
          session.identities,
          `fresh-process replay session ${sessionIndex} identities`
        )
        if (
          !Array.isArray(identities[field]) ||
          identities[field].some(
            (value) =>
              typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)
          )
        )
          throw new Error(`fresh-process replay ${field} is invalid`)
        return identities[field] as string[]
      })
      return [field, [...new Set(values)].sort()]
    })
  ) as unknown as Record<(typeof identityFields)[number], readonly string[]>
  for (const field of identityFields)
    if (
      JSON.stringify(replayIdentities[field]) !==
      JSON.stringify(input.acceptedEvidence[field])
    )
      throw new Error(
        `fresh-process replay differs from accepted evidence at ${field}`
      )
  const stdout = Buffer.concat(stdoutChunks).toString('utf8')
  if (!stdout.includes('agent invocations: 0'))
    throw new Error('fresh-process replay stdout omitted zero-agent evidence')
  return Object.freeze({
    report,
    exactMatches: 2,
    total: 2,
    agentExecutions: 0,
    identityReconciliationSha256: canonicalSha256({
      acceptedEvidenceTerminalSha256: input.acceptedEvidence.terminalSha256,
      replayIdentities,
      replayReportSha256: canonicalSha256(report),
      stdoutSha256: sha256(stdout),
    }),
  })
}

async function reconcileTerminalEvidence(input: {
  readonly layout: SemanticEditRunLayoutV1
  readonly evidenceSummaryRelativePath: string
  readonly trace: readonly SemanticEditTraceRecordV1[]
  readonly preparedHost: PreparedSemanticEditMcpHostV1
})
{
  const prepared = recheckPreparedSemanticEditMcpHostV1(
    input.layout,
    input.preparedHost
  )
  const authority: SemanticEditAcceptedEvidenceAuthorityV1 = {
    invocationPrincipalSha256: input.preparedHost.descriptor.principalSha256,
    journalProfileSha256: semanticEditStaticAuthorityV1().profileSha256,
    bootstrapDescriptorSha256: prepared.descriptorSha256,
    bootstrapDescriptorCanonicalSha256: prepared.descriptorCanonicalSha256,
    contractRegistrySha256: prepared.contractRegistrySha256,
    contractRegistryArtifactSetSha256:
      prepared.contractRegistryArtifactSetSha256,
    secretMaterialSha256: prepared.secretMaterialSha256,
    predecessorHandoffSha256: prepared.predecessorHandoffSha256,
    hostManifestSha256:
      input.preparedHost.descriptor.authoritativeBuildManifestSha256,
  }
  const evidence: SemanticEditAcceptedEvidenceV1 =
    parseSemanticEditAcceptedEvidenceV1(
      readBoundedJsonV1(
        join(
          input.layout.readableArtifactRoot,
          input.evidenceSummaryRelativePath
        ),
        'semantic edit accepted evidence',
        MAX_SEMANTIC_EDIT_EVIDENCE_BYTES
      ),
      authority
    )
  const reconciliation = reconcileSemanticEditTraceV1(input.trace, evidence)
  if (!reconciliation.ok)
    throw new Error(
      `semantic edit audit reconciliation failed: ${reconciliation.failures.join('; ')}`
    )
  const authenticatedHandoff = await createSemanticEditMcpPredecessorHandoffV1({
    layout: input.layout,
    predecessorHost: input.preparedHost,
    storeKey: evidence.journalStoreKey,
  })
  const manifest = authenticatedHandoff.manifest
  const expectedIdentity = {
    serverInstanceId: evidence.serverInstanceId,
    runId: evidence.journalRunId,
    realmSha256: evidence.journalRealmSha256,
    profileSha256: evidence.journalProfileSha256,
    boundaryPolicySha256: evidence.journalBoundaryPolicySha256,
    predecessor: evidence.journalPredecessor,
  }
  if (
    manifest.serverManifest.storeKey !== evidence.journalStoreKey ||
    manifest.serverManifest.auditKeyId !== evidence.journalAuditKeyId ||
    canonicalSha256(manifest.serverManifest.identity) !==
      canonicalSha256(expectedIdentity) ||
    manifest.terminal.storeKey !== evidence.journalStoreKey ||
    manifest.terminal.serverInstanceId !== evidence.serverInstanceId ||
    manifest.terminal.runId !== evidence.journalRunId ||
    manifest.terminal.auditKeyId !== evidence.journalAuditKeyId ||
    manifest.terminal.finalTailSha256 !== evidence.serverAuditHeadSha256 ||
    manifest.terminal.terminalSha256 !== evidence.terminalSha256 ||
    manifest.terminal.recordCount !== evidence.auditRecordCount ||
    manifest.terminal.recordBytes !== evidence.auditRecordBytes
  )
    throw new Error(
      'semantic edit accepted evidence differs from authenticated audit storage'
    )
  return Object.freeze({ evidence, reconciliation, authenticatedHandoff })
}

function parseArgs(argv: readonly string[]): CliOptions
{
  let runsRoot = join(process.cwd(), 'runs')
  let secretMaterialPath: string | undefined
  let prepareOnly = false
  for (let index = 0; index < argv.length; index++)
  {
    const flag = argv[index]
    if (flag === '--prepare-only')
    {
      if (prepareOnly) fail('--prepare-only may be supplied only once')
      prepareOnly = true
      continue
    }
    if (flag !== '--runs-root' && flag !== '--secret-material')
      fail(`unknown argument: ${flag}`)
    const value = argv[++index]
    if (!value || value.startsWith('--'))
      fail(`${flag} requires a non-empty value`)
    if (flag === '--runs-root') runsRoot = value
    else secretMaterialPath = resolve(value)
  }
  return Object.freeze({
    runsRoot: resolve(runsRoot),
    prepareOnly,
    ...(secretMaterialPath ? { secretMaterialPath } : {}),
  })
}

function markdownReport(report: Readonly<Record<string, unknown>>): string
{
  const mode = String(report.mode)
  const status = String(report.status)
  const acceptance = report.acceptance as Readonly<Record<string, unknown>>
  const integration = report.integration as Readonly<Record<string, unknown>>
  return [
    '# Semantic edit benchmark',
    '',
    `- Mode: ${mode}`,
    `- Status: ${status}`,
    `- Accepted: ${String(acceptance.accepted)}`,
    `- Agent executions: ${String(acceptance.agentExecutions)}`,
    `- Workflows: ${String(acceptance.workflowsPassed)}/${String(acceptance.workflowsRequired)}`,
    `- Negative probes: ${String(acceptance.negativeProbesPassed)}/${String(acceptance.negativeProbesRequired)}`,
    `- MCP boundary: ${String(integration.boundary)}`,
    '',
    'This report never treats preparation or transport discovery as semantic-edit acceptance.',
    '',
  ].join('\n')
}

function boundedFailureProjection(error: unknown): Readonly<{
  name: string
  message: string
}>
{
  return Object.freeze({
    name: error instanceof Error ? error.name : 'UnknownError',
    message: (error instanceof Error ? error.message : String(error)).slice(
      0,
      4096
    ),
  })
}

interface ProbeDriverDiagnosticV1
{
  readonly label: string
  readonly driver: SemanticEditMcpDriverV1
}

async function closeAndRetainProbeDriversV1(input: {
  readonly layout: SemanticEditRunLayoutV1
  readonly probeId: string
  readonly drivers: readonly ProbeDriverDiagnosticV1[]
}): Promise<unknown[]>
{
  const failures: unknown[] = []
  for (const observed of input.drivers)
  {
    try
    {
      await observed.driver.close()
    }
    catch (error)
    {
      failures.push(error)
    }
    for (const [suffix, evidence] of [
      ['server-stderr', observed.driver.stderrEvidence()],
      ['process-observation', observed.driver.processObservation()],
    ] as const)
      try
      {
        writeJsonExclusive(
          join(
            input.layout.evidenceRoot,
            `${input.probeId}-${observed.label}-${suffix}.json`
          ),
          {
            schemaVersion: 1,
            label: observed.label,
            ...evidence,
          }
        )
      }
      catch (error)
      {
        failures.push(error)
      }
  }
  return failures
}

function retainProbeFailureV1(input: {
  readonly layout: SemanticEditRunLayoutV1
  readonly probeId: string
  readonly failure: unknown
  readonly cleanupFailures: readonly unknown[]
}): void
{
  writeJsonExclusive(
    join(input.layout.evidenceRoot, `${input.probeId}-failure.json`),
    {
      schemaVersion: 1,
      status: 'not-accepted',
      probeId: input.probeId,
      execution:
        input.failure === null ? null : boundedFailureProjection(input.failure),
      cleanup: input.cleanupFailures.map(boundedFailureProjection),
    }
  )
}

async function runOperatorFixtureProbes(input: {
  readonly parentRunRoot: string
  readonly serverPath: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly authoritativeBuildManifestSha256: string
}): Promise<readonly SemanticEditProbeExecutionV1[]>
{
  const probes: SemanticEditProbeExecutionV1[] = []
  const runFixture = async (
    label: string,
    operatorFixture: NonNullable<
      Parameters<typeof prepareSemanticEditMcpHostV1>[0]['operatorFixture']
    >,
    execute: (input: {
      readonly driver: ReturnType<typeof createSemanticEditMcpDriverV1>
      readonly fixture: Awaited<
        ReturnType<typeof writeSemanticEditBenchmarkFixtureV1>
      >
      readonly inputs: Awaited<
        ReturnType<typeof writeGeneratedSemanticEditInputsV1>
      >
      readonly layout: SemanticEditRunLayoutV1
    }) => Promise<SemanticEditProbeExecutionV1>
  ): Promise<void> =>
  {
    const layout = createSemanticEditRunLayoutV1(
      join(input.parentRunRoot, 'operator-hosts'),
      label
    )
    const inputs = await writeGeneratedSemanticEditInputsV1(layout)
    const fixture = await writeSemanticEditBenchmarkFixtureV1({
      root: join(layout.configRoot, 'registry-source'),
      inputs,
    })
    const prepared = prepareSemanticEditMcpHostV1({
      layout,
      principalSha256: canonicalSha256({
        schemaVersion: 1,
        boundary: 'semantic-edit-benchmark-operator-fixture',
        label,
      }),
      pinnedScratchRuntimeSourceSha256: input.pinnedScratchRuntimeSourceSha256,
      authoritativeBuildManifestSha256: input.authoritativeBuildManifestSha256,
      behaviorContract: fixture.behaviorContract,
      mediaContract: fixture.mediaContract,
      contractRegistryPath: fixture.registryPath,
      evidenceSummaryRelativePath: `evidence/${label}-accepted-evidence.json`,
      operatorFixture,
    })
    const driver = createSemanticEditMcpDriverV1({
      repositoryRoot: process.cwd(),
      layout,
      preparedHost: prepared,
      hostBootstrapPath: prepared.descriptorPath,
      maximumCallDurationMs: 120_000,
      serverPath: input.serverPath,
    })
    let executionFailure: unknown = null
    let closeFailure: unknown = null
    try
    {
      await driver.connect()
      await driver.assertExactToolProfile()
      probes.push(await execute({ driver, fixture, inputs, layout }))
    }
    catch (error)
    {
      executionFailure = error
    }
    finally
    {
      try
      {
        await driver.close()
      }
      catch (error)
      {
        closeFailure = error
      }
    }
    const trace = driver.trace()
    writeJsonExclusive(join(layout.evidenceRoot, 'mcp-trace.json'), trace)
    writeJsonExclusive(join(layout.evidenceRoot, 'server-stderr.json'), {
      schemaVersion: 1,
      ...driver.stderrEvidence(),
    })
    writeJsonExclusive(join(layout.evidenceRoot, 'process-observation.json'), {
      schemaVersion: 1,
      ...driver.processObservation(),
    })
    let reconciliationFailure: unknown = null
    const evidencePath = join(
      layout.readableArtifactRoot,
      prepared.descriptor.evidenceSummaryRelativePath
    )
    if (existsSync(evidencePath))
    {
      try
      {
        const terminal = await reconcileTerminalEvidence({
          layout,
          evidenceSummaryRelativePath:
            prepared.descriptor.evidenceSummaryRelativePath,
          trace,
          preparedHost: prepared,
        })
        writeJsonExclusive(
          join(layout.evidenceRoot, 'audit-reconciliation.json'),
          {
            authenticatedHandoffSha256: terminal.authenticatedHandoff.sha256,
            reconciliation: terminal.reconciliation,
          }
        )
      }
      catch (error)
      {
        reconciliationFailure = error
      }
    }
    else
      reconciliationFailure = new Error(
        'operator host retained no terminal accepted evidence'
      )
    if (
      executionFailure !== null ||
      closeFailure !== null ||
      reconciliationFailure !== null
    )
    {
      const failure = Object.freeze({
        schemaVersion: 1,
        status: 'not-accepted',
        label,
        execution:
          executionFailure === null
            ? null
            : boundedFailureProjection(executionFailure),
        close:
          closeFailure === null ? null : boundedFailureProjection(closeFailure),
        reconciliation:
          reconciliationFailure === null
            ? null
            : boundedFailureProjection(reconciliationFailure),
        traceRecords: trace.length,
        stderr: driver.stderrEvidence(),
        process: driver.processObservation(),
      })
      writeJsonExclusive(
        join(layout.evidenceRoot, 'operator-failure.json'),
        failure
      )
      const primary =
        executionFailure ??
        closeFailure ??
        reconciliationFailure ??
        new Error('operator fixture failed without one classified cause')
      throw new Error(
        `${label} operator fixture failed: ${boundedFailureProjection(primary).message}; ` +
          `diagnostics: ${layout.evidenceRoot}`
      )
    }
  }
  for (const disposition of [
    'required-lane-unavailable',
    'required-lane-inconclusive',
  ] as const)
    await runFixture(
      `evaluation-${disposition}`,
      {
        kind: 'semantic-edit-benchmark-v1',
        evaluationDisposition: disposition,
      },
      ({ driver, fixture, inputs, layout }) =>
        runSemanticEditEvaluationDispositionProbeV1({
          driver,
          fixture,
          inputs,
          outputRoot: layout.outputRoot,
          disposition,
        })
    )
  await runFixture(
    'audit-near-full',
    {
      kind: 'semantic-edit-benchmark-v1',
      auditLimits: {
        recordCap: 160,
        byteCap: 160 * 8 * 1024,
      },
    },
    ({ driver }) =>
      runSemanticEditAuditNearFullProbeV1({
        driver,
        maximumCalls: 32,
      })
  )
  return Object.freeze(probes)
}

function receiptFreeEditEnvelope(value: unknown): Record<string, unknown>
{
  const envelope = object(value, 'edit result envelope')
  if (!Object.hasOwn(envelope, 'audit'))
    throw new Error('edit result envelope has no audit receipt')
  const { audit: _audit, ...receiptFree } = envelope
  return Object.freeze(receiptFree)
}

function retainedSemanticIdentityProjection(
  evidence: SemanticEditAcceptedEvidenceV1
): Readonly<Record<string, unknown>>
{
  return Object.freeze({
    semanticEventHeads: evidence.semanticEventHeads,
    revisionSha256s: evidence.revisionSha256s,
    parentDeltaSha256s: evidence.parentDeltaSha256s,
    cumulativeDeltaSha256s: evidence.cumulativeDeltaSha256s,
    preservationSha256s: evidence.preservationSha256s,
    lineageSha256s: evidence.lineageSha256s,
    certificateSha256s: evidence.certificateSha256s,
    reportProjectionSha256s: evidence.reportProjectionSha256s,
    exportReceiptSha256s: evidence.exportReceiptSha256s,
  })
}

async function runResponseLossIdempotencyProbe(input: {
  readonly parentRunRoot: string
  readonly serverPath: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly authoritativeBuildManifestSha256: string
}): Promise<SemanticEditProbeExecutionV1>
{
  const layout = createSemanticEditRunLayoutV1(
    join(input.parentRunRoot, 'operator-hosts'),
    'response-loss-idempotent-retry'
  )
  const inputs = await writeGeneratedSemanticEditInputsV1(layout)
  const fixture = await writeSemanticEditBenchmarkFixtureV1({
    root: join(layout.configRoot, 'registry-source'),
    inputs,
  })
  const predecessor = prepareSemanticEditMcpHostV1({
    layout,
    principalSha256: canonicalSha256({
      schemaVersion: 1,
      boundary: 'semantic-edit-response-loss-idempotency-probe',
    }),
    pinnedScratchRuntimeSourceSha256: input.pinnedScratchRuntimeSourceSha256,
    authoritativeBuildManifestSha256: input.authoritativeBuildManifestSha256,
    behaviorContract: fixture.behaviorContract,
    mediaContract: fixture.mediaContract,
    contractRegistryPath: fixture.registryPath,
    evidenceSummaryRelativePath:
      'evidence/response-loss-predecessor-accepted-evidence.json',
  })
  const predecessorDriver = createSemanticEditMcpDriverV1({
    repositoryRoot: process.cwd(),
    layout,
    preparedHost: predecessor,
    hostBootstrapPath: predecessor.descriptorPath,
    maximumCallDurationMs: 120_000,
    serverPath: input.serverPath,
  })
  const diagnosticDrivers: ProbeDriverDiagnosticV1[] = [
    { label: 'predecessor', driver: predecessorDriver },
  ]
  let probeFailure: unknown = null
  let probeResult: SemanticEditProbeExecutionV1 | null = null
  try
  {
    await predecessorDriver.connect()
    await predecessorDriver.assertExactToolProfile()
    const opened = object(
      object(
        (
          await predecessorDriver.callProject('project_open', {
            inputPath: inputs.behaviorProject.path,
          })
        ).result,
        'response-loss project_open result'
      ).data,
      'response-loss project_open data'
    )
    if (typeof opened.sessionId !== 'string')
      throw new Error('response-loss project_open returned no session identity')
    const beginCall = await predecessorDriver.callEdit('edit_begin', {
      schemaVersion: 1,
      requestId: `request_${canonicalSha256({
        scope: 'response-loss-begin',
        ordinal: 1,
      }).slice(0, 48)}`,
      baseline: {
        kind: 'projectSession',
        projectSessionId: opened.sessionId,
        expectedSourceArtifactSha256: inputs.behaviorProject.sha256,
      },
      changeContractRegistrationId: fixture.behaviorContract.registrationId,
      expectedSemanticContractSha256:
        fixture.behaviorContract.semanticContractSha256,
    })
    if (!beginCall.result.ok)
      throw new Error(
        `response-loss edit_begin failed: ${beginCall.result.error.code}`
      )
    const identity = beginCall.result.data.identity
    const head = identity.postHead
    const checkpointRequest = Object.freeze({
      schemaVersion: 1 as const,
      requestId: `request_${canonicalSha256({
        scope: 'response-loss-checkpoint',
        ordinal: 1,
      }).slice(0, 48)}`,
      label: 'retained-response-loss-checkpoint',
      note: 'the MCP response is discarded after durable completion',
      sessionId: identity.sessionId,
      expectedSourceArtifactSha256: head.sourceArtifactSha256,
      expectedRevisionNumber: head.revisionNumber,
      expectedRevisionId: head.revisionId,
      expectedCandidateSha256: head.candidateSha256,
      expectedAssetManifestSha256: head.assetManifestSha256,
      expectedChangeContractSha256: head.changeContractSha256,
      expectedCapabilityProfileSha256: head.capabilityProfileSha256,
    })
    const lost = await predecessorDriver.callEditWithLostResponse(
      'edit_checkpoint',
      checkpointRequest
    )
    if (!lost.result.ok)
      throw new Error(`lost checkpoint failed: ${lost.result.error.code}`)
    const closeHead = lost.result.data.identity.postHead
    const closeCall = await predecessorDriver.callEdit('edit_close', {
      schemaVersion: 1,
      requestId: `request_${canonicalSha256({
        scope: 'response-loss-close',
        ordinal: 1,
      }).slice(0, 48)}`,
      reason: 'terminalize retained response-loss predecessor',
      sessionId: identity.sessionId,
      expectedSourceArtifactSha256: closeHead.sourceArtifactSha256,
      expectedRevisionNumber: closeHead.revisionNumber,
      expectedRevisionId: closeHead.revisionId,
      expectedCandidateSha256: closeHead.candidateSha256,
      expectedAssetManifestSha256: closeHead.assetManifestSha256,
      expectedChangeContractSha256: closeHead.changeContractSha256,
      expectedCapabilityProfileSha256: closeHead.capabilityProfileSha256,
    })
    if (!closeCall.result.ok)
      throw new Error(
        `response-loss predecessor close failed: ${closeCall.result.error.code}`
      )
    if (closeCall.result.data.terminalState !== 'closed-unexported')
      throw new Error(
        'response-loss predecessor session is not terminally closed'
      )
    await predecessorDriver.close()
    const predecessorClientTrace = predecessorDriver.trace()
    const predecessorAuditTrace = Object.freeze(
      [...predecessorClientTrace, lost.interceptedTrace].sort(
        (left, right) => left.sequence - right.sequence
      )
    )
    writeJsonExclusive(
      join(layout.evidenceRoot, 'response-loss-predecessor-client-trace.json'),
      predecessorClientTrace
    )
    writeJsonExclusive(
      join(layout.evidenceRoot, 'response-loss-fault-intercept.json'),
      {
        wireResponseSha256: lost.wireResponseSha256,
        interceptedTrace: lost.interceptedTrace,
      }
    )
    const predecessorTerminal = await reconcileTerminalEvidence({
      layout,
      evidenceSummaryRelativePath:
        predecessor.descriptor.evidenceSummaryRelativePath,
      trace: predecessorAuditTrace,
      preparedHost: predecessor,
    })
    const predecessorStoreKey = predecessorTerminal.evidence.journalStoreKey
    const beforeSuccessor = auditProcessStoreSnapshot(
      layout,
      predecessorStoreKey
    )
    const handoff = predecessorTerminal.authenticatedHandoff
    const successor = await prepareSemanticEditMcpSuccessorHostV1({
      layout,
      predecessorHost: predecessor,
      predecessorHandoffBytes: handoff.bytes,
      evidenceSummaryRelativePath:
        'evidence/response-loss-successor-accepted-evidence.json',
      descriptorBasename: 'host-bootstrap-response-loss-successor',
    })
    const successorDriver = createSemanticEditMcpDriverV1({
      repositoryRoot: process.cwd(),
      layout,
      preparedHost: successor,
      hostBootstrapPath: successor.descriptorPath,
      maximumCallDurationMs: 120_000,
      serverPath: input.serverPath,
    })
    diagnosticDrivers.push({ label: 'successor', driver: successorDriver })
    await successorDriver.connect()
    await successorDriver.assertExactToolProfile()
    const retry = await successorDriver.callEdit(
      'edit_checkpoint',
      checkpointRequest
    )
    if (!retry.result.ok)
      throw new Error(`response-loss retry failed: ${retry.result.error.code}`)
    const changed = await successorDriver.callEdit('edit_checkpoint', {
      ...checkpointRequest,
      label: 'changed-request-with-retained-request-id',
    })
    if (
      changed.result.ok ||
      changed.result.error.code !== 'edit.request_id_conflict'
    )
      throw new Error(
        'changed response-loss retry was not refused as a conflict'
      )
    await successorDriver.close()
    const successorTrace = successorDriver.trace()
    writeJsonExclusive(
      join(layout.evidenceRoot, 'response-loss-successor-trace.json'),
      successorTrace
    )
    const successorTerminal = await reconcileTerminalEvidence({
      layout,
      evidenceSummaryRelativePath:
        successor.descriptor.evidenceSummaryRelativePath,
      trace: successorTrace,
      preparedHost: successor,
    })
    writeJsonExclusive(
      join(layout.evidenceRoot, 'response-loss-audit-reconciliation.json'),
      {
        predecessorAuthenticatedHandoffSha256:
          predecessorTerminal.authenticatedHandoff.sha256,
        successorAuthenticatedHandoffSha256:
          successorTerminal.authenticatedHandoff.sha256,
        predecessorReconciliation: predecessorTerminal.reconciliation,
        successorReconciliation: successorTerminal.reconciliation,
      }
    )
    const lostEvidenceCall = predecessorTerminal.evidence.calls.find(
      (call) => call.callId === lost.interceptedTrace.callId
    )
    const retryEvidenceCall = successorTerminal.evidence.calls.find(
      (call) => call.callId === retry.trace.callId
    )
    const conflictEvidenceCall = successorTerminal.evidence.calls.find(
      (call) => call.callId === changed.trace.callId
    )
    if (
      !lostEvidenceCall ||
      !retryEvidenceCall ||
      !conflictEvidenceCall ||
      lostEvidenceCall.requestSha256 !== retryEvidenceCall.requestSha256 ||
      lostEvidenceCall.outcomeSha256 !== retryEvidenceCall.outcomeSha256 ||
      conflictEvidenceCall.requestSha256 === retryEvidenceCall.requestSha256
    )
      throw new Error('response-loss retry audit identities do not reconcile')
    const lostReceiptFree = receiptFreeEditEnvelope(lost.result)
    const retryReceiptFree = receiptFreeEditEnvelope(retry.result)
    if (canonicalSha256(lostReceiptFree) !== canonicalSha256(retryReceiptFree))
      throw new Error(
        'successor retry changed the retained receipt-free outcome'
      )
    if (
      retry.trace.callId === lost.interceptedTrace.callId ||
      retry.trace.beginRecordSha256 ===
        lost.interceptedTrace.beginRecordSha256 ||
      retry.trace.completeRecordSha256 ===
        lost.interceptedTrace.completeRecordSha256
    )
      throw new Error('successor retry did not produce a fresh audit pair')
    if (
      canonicalSha256(
        retainedSemanticIdentityProjection(predecessorTerminal.evidence)
      ) !==
      canonicalSha256(
        retainedSemanticIdentityProjection(successorTerminal.evidence)
      )
    )
      throw new Error('successor retry redispatched semantic session work')
    const predecessorAfterSuccessor = auditProcessStoreSnapshot(
      layout,
      predecessorStoreKey
    )
    if (
      beforeSuccessor.contentSha256 !== predecessorAfterSuccessor.contentSha256
    )
      throw new Error('response-loss successor mutated its predecessor store')
    const successorStore = auditProcessStoreSnapshot(
      layout,
      successorTerminal.evidence.journalStoreKey
    )
    if (
      successorStore.entries.some((entry) =>
        entry.key.startsWith(`${AUDIT_IDEMPOTENCY_PREFIX}/`)
      )
    )
      throw new Error('successor duplicated a predecessor idempotency artifact')
    const predecessorAnchor = successorTerminal.evidence.journalPredecessor
    if (
      predecessorAnchor.state !== 'present' ||
      predecessorAnchor.storeKey !== predecessorStoreKey ||
      predecessorAnchor.finalTailSha256 !==
        handoff.manifest.terminal.finalTailSha256
    )
      throw new Error(
        'response-loss successor has the wrong predecessor anchor'
      )
    probeResult = Object.freeze({
      id: 'response-loss-idempotent-retry',
      passed: true,
      disposition: 'same-retained-outcome',
      evidenceSha256: canonicalSha256({
        predecessorStoreKey,
        predecessorTerminalSha256: predecessorTerminal.evidence.terminalSha256,
        predecessorHandoffSha256: handoff.sha256,
        lostWireResponseSha256: lost.wireResponseSha256,
        lostCallId: lost.interceptedTrace.callId,
        lostBeginRecordSha256: lost.interceptedTrace.beginRecordSha256,
        lostCompleteRecordSha256: lost.interceptedTrace.completeRecordSha256,
        retainedReceiptFreeOutcomeSha256: canonicalSha256(lostReceiptFree),
        retainedAuditOutcomeSha256: lostEvidenceCall.outcomeSha256,
        retryCallId: retry.trace.callId,
        retryBeginRecordSha256: retry.trace.beginRecordSha256,
        retryCompleteRecordSha256: retry.trace.completeRecordSha256,
        changedInputConflictCallId: changed.trace.callId,
        successorStoreKey: successorTerminal.evidence.journalStoreKey,
        successorTerminalSha256: successorTerminal.evidence.terminalSha256,
        semanticIdentityProjectionSha256: canonicalSha256(
          retainedSemanticIdentityProjection(successorTerminal.evidence)
        ),
      }),
    })
  }
  catch (error)
  {
    probeFailure = error
  }
  const cleanupFailures = await closeAndRetainProbeDriversV1({
    layout,
    probeId: 'response-loss-idempotent-retry',
    drivers: diagnosticDrivers,
  })
  if (probeFailure !== null || cleanupFailures.length !== 0)
    try
    {
      retainProbeFailureV1({
        layout,
        probeId: 'response-loss-idempotent-retry',
        failure: probeFailure,
        cleanupFailures,
      })
    }
    catch (error)
    {
      cleanupFailures.push(error)
    }
  const failures = [
    ...(probeFailure === null ? [] : [probeFailure]),
    ...cleanupFailures,
  ]
  if (failures.length !== 0)
    throw new AggregateError(
      failures,
      'response-loss probe execution, cleanup, or diagnostic retention failed'
    )
  if (probeResult === null)
    throw new Error('response-loss probe produced no result or failure')
  return probeResult
}

async function runPredecessorRecoveryProbe(input: {
  readonly parentRunRoot: string
  readonly serverPath: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly authoritativeBuildManifestSha256: string
}): Promise<PredecessorRecoveryProbeResultV1>
{
  const layout = createSemanticEditRunLayoutV1(
    join(input.parentRunRoot, 'operator-hosts'),
    'predecessor-recovery'
  )
  const inputs = await writeGeneratedSemanticEditInputsV1(layout)
  const fixture = await writeSemanticEditBenchmarkFixtureV1({
    root: join(layout.configRoot, 'registry-source'),
    inputs,
  })
  const first = prepareSemanticEditMcpHostV1({
    layout,
    principalSha256: canonicalSha256({
      schemaVersion: 1,
      boundary: 'semantic-edit-predecessor-recovery-probe',
    }),
    pinnedScratchRuntimeSourceSha256: input.pinnedScratchRuntimeSourceSha256,
    authoritativeBuildManifestSha256: input.authoritativeBuildManifestSha256,
    behaviorContract: fixture.behaviorContract,
    mediaContract: fixture.mediaContract,
    contractRegistryPath: fixture.registryPath,
    evidenceSummaryRelativePath:
      'evidence/predecessor-crash-accepted-evidence.json',
  })
  const crashing = createSemanticEditMcpDriverV1({
    repositoryRoot: process.cwd(),
    layout,
    preparedHost: first,
    hostBootstrapPath: first.descriptorPath,
    maximumCallDurationMs: 120_000,
    serverPath: input.serverPath,
  })
  const diagnosticDrivers: ProbeDriverDiagnosticV1[] = [
    { label: 'crashing-predecessor', driver: crashing },
  ]
  let probeFailure: unknown = null
  let probeResult: PredecessorRecoveryProbeResultV1 | null = null
  try
  {
    await crashing.connect()
    await crashing.assertExactToolProfile()
    const opened = object(
      object(
        (
          await crashing.callProject('project_open', {
            inputPath: inputs.behaviorProject.path,
          })
        ).result,
        'predecessor project_open result'
      ).data,
      'predecessor project_open data'
    )
    if (typeof opened.sessionId !== 'string')
      throw new Error('predecessor project_open returned no session identity')
    const pendingRun = crashing
      .callProject('project_run', {
        sessionId: opened.sessionId,
        lanes: ['browser'],
        scenario: { profile: 'default-smoke' },
      })
      .then(
        () => 'returned' as const,
        () => 'interrupted' as const
      )
    const unmatched = await waitForUnmatchedProjectRunBegin(layout, 30_000)
    await crashing.crashForRecoveryProbe()
    if ((await pendingRun) !== 'interrupted')
      throw new Error('predecessor project_run completed before forced crash')
    writeJsonExclusive(
      join(layout.evidenceRoot, 'predecessor-crash-trace.json'),
      crashing.trace()
    )
    if (
      existsSync(
        join(
          layout.readableArtifactRoot,
          first.descriptor.evidenceSummaryRelativePath
        )
      )
    )
      throw new Error('crashed predecessor emitted terminal accepted evidence')

    const predecessorStoreKey = unmatched.snapshot.storeKey
    const afterCrash = auditProcessStoreSnapshot(layout, predecessorStoreKey)
    const recoveredHandoff = await recoverSemanticEditMcpPredecessorHandoffV1({
      layout,
      predecessorHost: first,
    })
    if (
      recoveredHandoff.manifest.serverManifest.storeKey !== predecessorStoreKey
    )
      throw new Error('exclusive recovery handoff names another predecessor')
    const afterExclusiveRecovery = auditProcessStoreSnapshot(
      layout,
      predecessorStoreKey
    )
    if (
      recoveredHandoff.manifest.terminal.storeKey !== predecessorStoreKey ||
      !afterExclusiveRecovery.entries.some(
        (entry) => entry.key === AUDIT_TERMINAL_KEY
      )
    )
      throw new Error('exclusive recovery did not terminalize its predecessor')
    const predecessorSecret = object(
      readBoundedJsonV1(
        join(
          layout.editPrivateRoot,
          first.descriptor.secretMaterialRelativePath
        ),
        'predecessor secret material'
      ),
      'predecessor secret material'
    )
    if (!Array.isArray(predecessorSecret.auditKeys))
      throw new Error('predecessor secret material has no audit key set')
    const oldAuditKeyId = predecessorSecret.activeAuditKeyId
    if (typeof oldAuditKeyId !== 'string')
      throw new Error('predecessor secret material has no active audit key')
    if (
      recoveredHandoff.manifest.serverManifest.auditKeyId !== oldAuditKeyId ||
      recoveredHandoff.manifest.terminal.auditKeyId !== oldAuditKeyId
    )
      throw new Error(
        'exclusive recovery did not authenticate with the old key'
      )
    const recoveredCompletionWrapper = afterExclusiveRecovery.records.find(
      (wrapper) =>
      {
        const projection = object(wrapper.record, 'recovered audit projection')
        return (
          projection.callId === unmatched.begin.callId &&
          projection.phase === 'call-rejected'
        )
      }
    )
    if (!recoveredCompletionWrapper)
      throw new Error('exclusive recovery did not classify the unmatched begin')
    const recoveredCompletion = object(
      recoveredCompletionWrapper.record,
      'recovered audit projection'
    )
    const expectedRecoveryResultSha256 = canonicalSha256({
      schemaVersion: 1,
      kind: 'unmatched-audit-call-recovery-v1',
      callId: unmatched.begin.callId,
      beginRecordSha256: unmatched.begin.recordSha256,
      fullInputSha256: unmatched.begin.fullInputSha256,
    })
    if (
      recoveredCompletion.beginRecordSha256 !== unmatched.begin.recordSha256 ||
      recoveredCompletion.resultSha256 !== expectedRecoveryResultSha256 ||
      typeof recoveredCompletionWrapper.recordSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(recoveredCompletionWrapper.recordSha256)
    )
      throw new Error('exclusive recovery classified another unmatched begin')
    const recoveredPrepared = recheckPreparedSemanticEditMcpHostV1(
      layout,
      first
    )
    const recoveredEvidence = parseSemanticEditAcceptedEvidenceV1(
      readBoundedJsonV1(
        join(
          layout.readableArtifactRoot,
          first.descriptor.evidenceSummaryRelativePath
        ),
        'recovered predecessor accepted evidence',
        MAX_SEMANTIC_EDIT_EVIDENCE_BYTES
      ),
      {
        invocationPrincipalSha256: first.descriptor.principalSha256,
        journalProfileSha256: semanticEditStaticAuthorityV1().profileSha256,
        bootstrapDescriptorSha256: recoveredPrepared.descriptorSha256,
        bootstrapDescriptorCanonicalSha256:
          recoveredPrepared.descriptorCanonicalSha256,
        contractRegistrySha256: recoveredPrepared.contractRegistrySha256,
        contractRegistryArtifactSetSha256:
          recoveredPrepared.contractRegistryArtifactSetSha256,
        secretMaterialSha256: recoveredPrepared.secretMaterialSha256,
        predecessorHandoffSha256: recoveredPrepared.predecessorHandoffSha256,
        hostManifestSha256: first.descriptor.authoritativeBuildManifestSha256,
      }
    )
    const recoveredCalls = recoveredEvidence.calls.filter(
      (call) => call.callId === unmatched.begin.callId
    )
    const recoveredCall = recoveredCalls.at(0)
    const recoveredIdentity = {
      serverInstanceId: recoveredEvidence.serverInstanceId,
      runId: recoveredEvidence.journalRunId,
      realmSha256: recoveredEvidence.journalRealmSha256,
      profileSha256: recoveredEvidence.journalProfileSha256,
      boundaryPolicySha256: recoveredEvidence.journalBoundaryPolicySha256,
      predecessor: recoveredEvidence.journalPredecessor,
    }
    if (
      recoveredEvidence.journalStoreKey !== predecessorStoreKey ||
      recoveredEvidence.journalAuditKeyId !== oldAuditKeyId ||
      recoveredEvidence.journalPredecessor.state !== 'absent' ||
      recoveredEvidence.terminalSha256 !==
        recoveredHandoff.manifest.terminal.terminalSha256 ||
      recoveredEvidence.serverAuditHeadSha256 !==
        recoveredHandoff.manifest.terminal.finalTailSha256 ||
      recoveredEvidence.auditRecordCount !==
        recoveredHandoff.manifest.terminal.recordCount ||
      recoveredEvidence.auditRecordBytes !==
        recoveredHandoff.manifest.terminal.recordBytes ||
      canonicalSha256(recoveredIdentity) !==
        canonicalSha256(recoveredHandoff.manifest.serverManifest.identity) ||
      recoveredCalls.length !== 1 ||
      recoveredCall?.boundary !== 'tool' ||
      recoveredCall.name !== 'project_run' ||
      recoveredCall.requestSha256 !== unmatched.begin.fullInputSha256 ||
      recoveredCall.beginRecordSha256 !== unmatched.begin.recordSha256 ||
      recoveredCall.completeRecordSha256 !==
        recoveredCompletionWrapper.recordSha256 ||
      recoveredCall.outcomeSha256 !== expectedRecoveryResultSha256 ||
      recoveredCall.eventSha256 !== null
    )
      throw new Error(
        'recovered predecessor accepted evidence differs from recovery authority'
      )
    const recoveredAcceptedEvidenceSha256 = canonicalSha256(recoveredEvidence)
    const rotatedAuditKeyId = `audit_${randomBytes(12).toString('hex')}`
    const rotatedAuditSecret = randomBytes(32).toString('base64url')
    const rotatedSecretMaterial = Object.freeze({
      ...predecessorSecret,
      activeAuditKeyId: rotatedAuditKeyId,
      auditKeys: Object.freeze([
        ...predecessorSecret.auditKeys,
        Object.freeze({
          auditKeyId: rotatedAuditKeyId,
          secret: rotatedAuditSecret,
        }),
      ]),
    })
    const rotatedSecretMaterialPath = join(
      layout.editPrivateRoot,
      'rotation-candidate-secret-material.json'
    )
    writeJsonExclusive(rotatedSecretMaterialPath, rotatedSecretMaterial)
    const successor = await prepareSemanticEditMcpSuccessorHostV1({
      layout,
      predecessorHost: first,
      predecessorHandoffBytes: recoveredHandoff.bytes,
      evidenceSummaryRelativePath:
        'evidence/predecessor-successor-accepted-evidence.json',
      descriptorBasename: 'host-bootstrap-predecessor-successor',
      rotatedSecretMaterialPath,
    })
    const successorDriver = createSemanticEditMcpDriverV1({
      repositoryRoot: process.cwd(),
      layout,
      preparedHost: successor,
      hostBootstrapPath: successor.descriptorPath,
      maximumCallDurationMs: 120_000,
      serverPath: input.serverPath,
    })
    diagnosticDrivers.push({ label: 'successor', driver: successorDriver })
    await successorDriver.connect()
    await successorDriver.assertExactToolProfile()
    await successorDriver.callProject('project_open', {
      inputPath: inputs.behaviorProject.path,
    })
    const predecessorAfterSuccessorStart = auditProcessStoreSnapshot(
      layout,
      predecessorStoreKey
    )
    await successorDriver.close()
    const predecessorAfterSuccessorClose = auditProcessStoreSnapshot(
      layout,
      predecessorStoreKey
    )
    if (
      afterExclusiveRecovery.contentSha256 !==
        predecessorAfterSuccessorStart.contentSha256 ||
      predecessorAfterSuccessorStart.contentSha256 !==
        predecessorAfterSuccessorClose.contentSha256
    )
      throw new Error('successor mutated its terminal predecessor after mount')
    const successorTrace = successorDriver.trace()
    writeJsonExclusive(
      join(layout.evidenceRoot, 'predecessor-successor-trace.json'),
      successorTrace
    )
    const terminal = await reconcileTerminalEvidence({
      layout,
      evidenceSummaryRelativePath:
        successor.descriptor.evidenceSummaryRelativePath,
      trace: successorTrace,
      preparedHost: successor,
    })
    writeJsonExclusive(
      join(layout.evidenceRoot, 'predecessor-successor-reconciliation.json'),
      {
        recoveredAcceptedEvidenceSha256,
        recoveredAcceptedEvidenceTerminalSha256:
          recoveredEvidence.terminalSha256,
        recoveredAcceptedEvidenceAuditKeyId:
          recoveredEvidence.journalAuditKeyId,
        recoveredPredecessorHandoffSha256: recoveredHandoff.sha256,
        successorAuthenticatedHandoffSha256:
          terminal.authenticatedHandoff.sha256,
        reconciliation: terminal.reconciliation,
      }
    )
    const predecessorAnchor = terminal.evidence.journalPredecessor
    if (
      predecessorAnchor.state !== 'present' ||
      predecessorAnchor.storeKey !== predecessorStoreKey
    )
      throw new Error('successor evidence does not name the exact predecessor')
    if (
      rotatedAuditKeyId === oldAuditKeyId ||
      terminal.evidence.journalAuditKeyId !== rotatedAuditKeyId ||
      terminal.evidence.secretMaterialSha256 !==
        successor.secretMaterialSha256 ||
      terminal.evidence.predecessorHandoffSha256 !== recoveredHandoff.sha256 ||
      successor.secretMaterialSha256 === first.secretMaterialSha256
    )
      throw new Error('successor audit-key rotation evidence is inconsistent')
    const predecessorTerminal = decodeJsonBytes(
      new DurableArtifactStore(
        join(
          layout.editPrivateRoot,
          `${AUDIT_STORE_DIRECTORY_PREFIX}${predecessorStoreKey}`
        ),
        { mode: 'read-only' }
      ).readImmutable(AUDIT_TERMINAL_KEY),
      'predecessor terminal evidence'
    )
    if (
      predecessorTerminal.finalTailSha256 !==
        predecessorAnchor.finalTailSha256 ||
      canonicalSha256(predecessorTerminal) !==
        canonicalSha256(recoveredHandoff.manifest.terminal)
    )
      throw new Error('successor predecessor tail anchor is not exact')
    const supervisor = new DurableArtifactStore(
      join(layout.editPrivateRoot, AUDIT_SUPERVISOR_DIRECTORY),
      { mode: 'read-only' }
    )
    const supervisorTransition = object(
      decodeJsonBytes(
        supervisor.readImmutable(AUDIT_SUPERVISOR_INDEX_KEY),
        'terminal audit supervisor transition'
      ),
      'terminal audit supervisor transition'
    )
    const supervisorIndex = object(
      supervisorTransition.index,
      'terminal audit supervisor transition index'
    )
    const current = object(
      supervisorIndex.current,
      'terminal audit supervisor current store'
    )
    const predecessors = Array.isArray(supervisorIndex.predecessors)
      ? supervisorIndex.predecessors.map((entry, index) =>
          object(entry, `audit supervisor predecessor ${index}`)
        )
      : []
    const predecessor = predecessors.find(
      (entry) => entry.storeKey === predecessorStoreKey
    )
    if (
      current.state !== 'terminal' ||
      current.storeKey !== terminal.evidence.journalStoreKey ||
      !predecessor ||
      predecessor.successorStoreKey !== terminal.evidence.journalStoreKey ||
      object(predecessor.terminal, 'supervisor predecessor terminal')
        .finalTailSha256 !== predecessorAnchor.finalTailSha256
    )
      throw new Error('audit supervisor successor chain is inconsistent')
    const secretTokens = [
      predecessorSecret.handle,
      predecessorSecret.paginationCursor,
      predecessorSecret.resourceCapability,
      predecessorSecret.resourceListingCursor,
      ...predecessorSecret.auditKeys.map((candidate, index) =>
      {
        const key = object(candidate, `predecessor audit key ${index}`)
        if (typeof key.secret !== 'string')
          throw new Error('predecessor audit key has no secret material')
        return key.secret
      }),
      rotatedAuditSecret,
    ]
    if (secretTokens.some((token) => typeof token !== 'string'))
      throw new Error('predecessor purpose secret material is invalid')
    const assertSecretBoundary = createSecretBoundaryVerifier({
      runRoot: input.parentRunRoot,
      authorizedSecretFiles: [
        join(
          layout.editPrivateRoot,
          first.descriptor.secretMaterialRelativePath
        ),
        rotatedSecretMaterialPath,
        join(
          layout.editPrivateRoot,
          successor.descriptor.secretMaterialRelativePath
        ),
      ],
      tokens: secretTokens as string[],
    })
    probeResult = Object.freeze({
      probe: Object.freeze({
        id: 'predecessor-recovery',
        passed: true,
        disposition: 'successor-after-terminalization',
        evidenceSha256: canonicalSha256({
          predecessorStoreKey,
          activeCrashManifestSha256: sha256(afterCrash.manifestBytes),
          predecessorHandoffSha256: recoveredHandoff.sha256,
          recoveredAcceptedEvidenceSha256,
          recoveredAcceptedEvidenceTerminalSha256:
            recoveredEvidence.terminalSha256,
          unmatchedBeginCallId: unmatched.begin.callId,
          unmatchedBeginRecordSha256: unmatched.begin.recordSha256,
          recoveredCompletionRecordSha256:
            recoveredCompletionWrapper.recordSha256,
          recoveryResultSha256: expectedRecoveryResultSha256,
          predecessorFinalTailSha256: predecessorAnchor.finalTailSha256,
          predecessorTerminalSha256: predecessorTerminal.terminalSha256,
          predecessorAuditKeyId: oldAuditKeyId,
          predecessorReadOnlyContentSha256:
            predecessorAfterSuccessorClose.contentSha256,
          exclusiveRecoveryTerminalSha256:
            recoveredHandoff.manifest.terminal.terminalSha256,
          successorStoreKey: terminal.evidence.journalStoreKey,
          successorTerminalSha256: terminal.evidence.terminalSha256,
          successorAuditKeyId: terminal.evidence.journalAuditKeyId,
          rotatedSecretMaterialSha256: successor.secretMaterialSha256,
          secretBoundaryVerified: true,
          supervisorGeneration: supervisorIndex.generation,
        }),
      }),
      assertSecretBoundary,
    })
  }
  catch (error)
  {
    probeFailure = error
  }
  const cleanupFailures = await closeAndRetainProbeDriversV1({
    layout,
    probeId: 'predecessor-recovery',
    drivers: diagnosticDrivers,
  })
  if (probeFailure !== null || cleanupFailures.length !== 0)
    try
    {
      retainProbeFailureV1({
        layout,
        probeId: 'predecessor-recovery',
        failure: probeFailure,
        cleanupFailures,
      })
    }
    catch (error)
    {
      cleanupFailures.push(error)
    }
  const failures = [
    ...(probeFailure === null ? [] : [probeFailure]),
    ...cleanupFailures,
  ]
  if (failures.length !== 0)
    throw new AggregateError(
      failures,
      'predecessor-recovery probe execution, cleanup, or diagnostic retention failed'
    )
  if (probeResult === null)
    throw new Error('predecessor-recovery probe produced no result or failure')
  return probeResult
}

async function main(): Promise<void>
{
  assertAuthoritativeNpmLifecycleV1('semantic-edit-bench')
  const options = parseArgs(process.argv.slice(2))
  const runId = `semantic-edit-bench-${newRunId()}`
  const layout = createSemanticEditRunLayoutV1(options.runsRoot, runId)
  const startAuthority = captureSemanticEditAuthorityV1(layout.runRoot, 'start')
  const staticAuthority = semanticEditStaticAuthorityV1()
  const inputs = await writeGeneratedSemanticEditInputsV1(layout)
  const serverPath = join(process.cwd(), 'packages/mcp/dist/transport/server.js')
  if (!existsSync(serverPath))
    throw new Error('authoritative build did not produce the MCP server')

  const fixture = await writeSemanticEditBenchmarkFixtureV1({
    root: join(layout.configRoot, 'registry-source'),
    inputs,
  })
  const pinnedScratchRuntimeSourceSha256 = canonicalSha256({
    schemaVersion: 1,
    sourceTreeSha256: startAuthority.source.treeSha256,
    versions: staticAuthority.versions,
  })
  const preparedHost = prepareSemanticEditMcpHostV1({
    layout,
    principalSha256: canonicalSha256({
      schemaVersion: 1,
      boundary: 'zero-agent-semantic-edit-benchmark',
      runId,
    }),
    pinnedScratchRuntimeSourceSha256,
    authoritativeBuildManifestSha256: startAuthority.executableManifest.sha256,
    behaviorContract: fixture.behaviorContract,
    mediaContract: fixture.mediaContract,
    contractRegistryPath: fixture.registryPath,
    evidenceSummaryRelativePath: 'evidence/main-accepted-evidence.json',
    ...(options.secretMaterialPath
      ? { secretMaterialPath: options.secretMaterialPath }
      : {}),
  })
  const retainedBootstrapPath = preparedHost.descriptorPath

  const plan = Object.freeze({
    schemaVersion: 1,
    runId,
    mode: options.prepareOnly ? 'prepare-only' : 'execute',
    zeroAgentExecution: true,
    server: {
      command: process.execPath,
      arguments: [serverPath],
      profile: 'project-edit',
      transport: 'stdio',
    },
    roots: {
      input: portablePath(layout.runRoot, layout.inputRoot),
      assetInput: portablePath(layout.runRoot, layout.assetInputRoot),
      output: portablePath(layout.runRoot, layout.outputRoot),
      editPrivate: portablePath(layout.runRoot, layout.editPrivateRoot),
      readableArtifact: portablePath(
        layout.runRoot,
        layout.readableArtifactRoot
      ),
    },
    inputs: {
      behaviorProject: {
        relativePath: portablePath(layout.runRoot, inputs.behaviorProject.path),
        sha256: inputs.behaviorProject.sha256,
        byteLength: inputs.behaviorProject.byteLength,
      },
      mediaAsset: {
        relativePath: portablePath(layout.runRoot, inputs.mediaAsset.path),
        sha256: inputs.mediaAsset.sha256,
        byteLength: inputs.mediaAsset.byteLength,
        mediaType: inputs.mediaAsset.mediaType,
      },
    },
    workflows: SEMANTIC_EDIT_BENCHMARK_WORKFLOWS,
    negativeProbes: SEMANTIC_EDIT_NEGATIVE_PROBES,
    authority: {
      semanticManifestSha256: canonicalSha256(
        staticAuthority.semanticAuthority
      ),
      sourceManifestSha256: startAuthority.sourceManifest.sha256,
      executableManifestSha256: startAuthority.executableManifest.sha256,
      profileSha256: staticAuthority.profileSha256,
      schemaSha256: staticAuthority.schemaSha256,
      policySha256: staticAuthority.policySha256,
      runtimeSha256: staticAuthority.runtimeSha256,
      versions: staticAuthority.versions,
      toolAllowlist: staticAuthority.toolAllowlist,
    },
    acceptedInputs: {
      hostBootstrap: portablePath(layout.runRoot, retainedBootstrapPath),
      acceptedEvidence: preparedHost.descriptor.evidenceSummaryRelativePath,
      predecessorHandoff:
        preparedHost.descriptor.predecessorManifestRelativePath,
      replayCommand:
        'npm run semantic-edit-replay -- --run <semantic-edit-benchmark-run>',
    },
    watchdogs: {
      callDurationMs: 120_000,
      workflowDurationMs: 10 * 60 * 1000,
      resourceReadsBounded: true,
      noFollowReads: true,
    },
    integrationRequirements: [
      'production stdio bootstrap must consume the five protected roots',
      'production host must load the exact two-row contract registry',
      'production host must retain durable edit store and server audit state',
      'production host must expose deterministic evaluation and publication ports',
      'scripted executor must complete both workflows and every required negative probe through MCP',
      'accepted evidence must reconcile MCP trace, audit receipts, semantic events, resources, and report heads',
      'fresh-process semantic replay must reproduce every semantic identity with zero agent executions',
    ],
  })
  const planPath = join(layout.runRoot, 'semantic-edit-benchmark-plan.json')
  writeJsonExclusive(planPath, plan)

  let profileEvidence: SemanticEditToolProfileEvidenceV1 | null = null
  let integrationBlocker: string | null = null
  let workflowExecution: SemanticEditWorkflowExecutionSetV1 | null = null
  let operatorProbes: readonly SemanticEditProbeExecutionV1[] = []
  let mainAcceptedEvidence: SemanticEditAcceptedEvidenceV1 | null = null
  let mainAuditHandoffSha256: string | null = null
  let freshReplay: FreshReplayAcceptanceV1 | null = null
  let mainAuditReconciliation: ReturnType<
    typeof reconcileSemanticEditTraceV1
  > | null = null
  let assertPredecessorSecretBoundary:
    PredecessorRecoveryProbeResultV1['assertSecretBoundary'] | null = null
  if (!options.prepareOnly)
  {
    const driver = createSemanticEditMcpDriverV1({
      repositoryRoot: process.cwd(),
      layout,
      preparedHost,
      hostBootstrapPath: retainedBootstrapPath,
      maximumCallDurationMs: 120_000,
      serverPath,
    })
    let executionFailure: unknown = null
    let closeFailure: unknown = null
    try
    {
      await driver.connect()
      profileEvidence = await driver.assertExactToolProfile()
      workflowExecution = await runSemanticEditBenchmarkWorkflowsV1({
        driver,
        fixture,
        inputs,
        layout,
      })
    }
    catch (error)
    {
      executionFailure = error
    }
    finally
    {
      try
      {
        await driver.close()
      }
      catch (error)
      {
        closeFailure = error
      }
    }
    const trace = driver.trace()
    writeJsonExclusive(join(layout.evidenceRoot, 'mcp-trace.json'), trace)
    writeJsonExclusive(join(layout.evidenceRoot, 'server-stderr.json'), {
      schemaVersion: 1,
      ...driver.stderrEvidence(),
    })
    writeJsonExclusive(join(layout.evidenceRoot, 'process-observation.json'), {
      schemaVersion: 1,
      ...driver.processObservation(),
    })
    if (executionFailure !== null || closeFailure !== null)
    {
      let retainedEvidence: unknown = null
      const evidencePath = join(
        layout.readableArtifactRoot,
        preparedHost.descriptor.evidenceSummaryRelativePath
      )
      if (existsSync(evidencePath))
      {
        try
        {
          const terminal = await reconcileTerminalEvidence({
            layout,
            evidenceSummaryRelativePath:
              preparedHost.descriptor.evidenceSummaryRelativePath,
            trace,
            preparedHost,
          })
          retainedEvidence = {
            authenticatedHandoffSha256: terminal.authenticatedHandoff.sha256,
            reconciliation: terminal.reconciliation,
          }
        }
        catch (error)
        {
          retainedEvidence = {
            reconciliationFailure: boundedFailureProjection(error),
          }
        }
      }
      const failure = Object.freeze({
        schemaVersion: 1,
        status: 'not-accepted',
        execution:
          executionFailure === null
            ? null
            : boundedFailureProjection(executionFailure),
        close:
          closeFailure === null ? null : boundedFailureProjection(closeFailure),
        retainedEvidence,
        traceRecords: trace.length,
        stderr: driver.stderrEvidence(),
        process: driver.processObservation(),
      })
      writeJsonExclusive(
        join(layout.evidenceRoot, 'benchmark-failure.json'),
        failure
      )
      const primary = executionFailure ?? closeFailure
      throw new Error(
        `main benchmark host failed: ${boundedFailureProjection(primary).message}; ` +
          `diagnostics: ${layout.evidenceRoot}`
      )
    }
    if (workflowExecution === null)
      throw new Error('main benchmark completed without workflow evidence')
    const terminal = await reconcileTerminalEvidence({
      layout,
      evidenceSummaryRelativePath:
        preparedHost.descriptor.evidenceSummaryRelativePath,
      trace,
      preparedHost,
    })
    mainAuditReconciliation = terminal.reconciliation
    mainAcceptedEvidence = terminal.evidence
    mainAuditHandoffSha256 = terminal.authenticatedHandoff.sha256
    writeJsonExclusive(join(layout.evidenceRoot, 'audit-reconciliation.json'), {
      authenticatedHandoffSha256: terminal.authenticatedHandoff.sha256,
      reconciliation: terminal.reconciliation,
    })
    integrationBlocker =
      'both workflows and audit reconciliation passed, but predecessor ' +
      'recovery and fresh-process replay are not yet complete'
    const fixtureProbes = await runOperatorFixtureProbes({
      parentRunRoot: layout.runRoot,
      serverPath,
      pinnedScratchRuntimeSourceSha256,
      authoritativeBuildManifestSha256:
        startAuthority.executableManifest.sha256,
    })
    const responseLossProbe = await runResponseLossIdempotencyProbe({
      parentRunRoot: layout.runRoot,
      serverPath,
      pinnedScratchRuntimeSourceSha256,
      authoritativeBuildManifestSha256:
        startAuthority.executableManifest.sha256,
    })
    const predecessorRecovery = await runPredecessorRecoveryProbe({
      parentRunRoot: layout.runRoot,
      serverPath,
      pinnedScratchRuntimeSourceSha256,
      authoritativeBuildManifestSha256:
        startAuthority.executableManifest.sha256,
    })
    assertPredecessorSecretBoundary = predecessorRecovery.assertSecretBoundary
    operatorProbes = Object.freeze([
      ...fixtureProbes,
      responseLossProbe,
      predecessorRecovery.probe,
    ])
    freshReplay = await runFreshProcessReplay({
      layout,
      acceptedEvidence: terminal.evidence,
    })
    const semanticEvidence = terminal.evidence
    for (const workflow of workflowExecution.workflows)
      for (const [field, expected, retained] of [
        [
          'revisionSha256',
          workflow.revisionSha256,
          semanticEvidence.revisionSha256s,
        ],
        [
          'parentDeltaSha256',
          workflow.deltaSha256,
          semanticEvidence.parentDeltaSha256s,
        ],
        [
          'preservationSha256',
          workflow.preservationSha256,
          semanticEvidence.preservationSha256s,
        ],
        [
          'lineageSha256',
          workflow.lineageSha256,
          semanticEvidence.lineageSha256s,
        ],
        [
          'certificateSha256',
          workflow.certificateSha256,
          semanticEvidence.certificateSha256s,
        ],
        [
          'reportProjectionSha256',
          workflow.reportSha256,
          semanticEvidence.reportProjectionSha256s,
        ],
      ] as const)
        if (!retained.includes(expected))
          throw new Error(`accepted evidence omitted workflow ${field}`)
    integrationBlocker = null
  }

  const completionAuthority = captureSemanticEditAuthorityV1(
    layout.runRoot,
    'completion'
  )
  const authorityStable = semanticEditAuthoritySnapshotsMatchV1(
    startAuthority,
    completionAuthority
  )
  const completionPreparedHost = recheckPreparedSemanticEditMcpHostV1(
    layout,
    preparedHost
  )
  const probes = [...(workflowExecution?.probes ?? []), ...operatorProbes]
  const requiredProbeIds = new Set(
    SEMANTIC_EDIT_NEGATIVE_PROBES.map((probe) => probe.id)
  )
  const observedProbeIds = new Set(probes.map((probe) => probe.id))
  const probeSetExact =
    probes.length === SEMANTIC_EDIT_NEGATIVE_PROBES.length &&
    observedProbeIds.size === requiredProbeIds.size &&
    [...requiredProbeIds].every((probe) => observedProbeIds.has(probe))
  const accepted =
    !options.prepareOnly &&
    authorityStable &&
    profileEvidence !== null &&
    workflowExecution?.workflows.length ===
      SEMANTIC_EDIT_BENCHMARK_WORKFLOWS.length &&
    probeSetExact &&
    mainAcceptedEvidence !== null &&
    mainAuditHandoffSha256 !== null &&
    mainAuditReconciliation?.ok === true &&
    freshReplay?.exactMatches === 2 &&
    freshReplay.total === 2 &&
    freshReplay.agentExecutions === 0 &&
    integrationBlocker === null
  const report = Object.freeze({
    schemaVersion: 1,
    runId,
    runRoot: layout.runRoot,
    mode: options.prepareOnly ? 'prepare-only' : 'execute',
    status: options.prepareOnly
      ? 'prepared'
      : accepted
        ? 'accepted'
        : 'not-accepted',
    planSha256: canonicalSha256(plan),
    authority: {
      stable: authorityStable,
      startSourceManifestSha256: startAuthority.sourceManifest.sha256,
      completionSourceManifestSha256: completionAuthority.sourceManifest.sha256,
      startExecutableManifestSha256: startAuthority.executableManifest.sha256,
      completionExecutableManifestSha256:
        completionAuthority.executableManifest.sha256,
    },
    integration: {
      boundary: 'real-mcp-stdio-project-edit',
      profileVerified: profileEvidence !== null,
      profileEvidence,
      directEditPackageCalls: 0,
      blocker: integrationBlocker,
      preparedHost: {
        ...completionPreparedHost,
        generatedSecretMaterial: preparedHost.generatedSecretMaterial,
      },
      auditReconciliation: mainAuditReconciliation,
      acceptedEvidenceTerminalSha256:
        mainAcceptedEvidence?.terminalSha256 ?? null,
      authenticatedAuditHandoffSha256: mainAuditHandoffSha256,
      freshProcessReplay: freshReplay,
    },
    workflows: workflowExecution?.workflows ?? [],
    negativeProbes: probes,
    acceptance: {
      accepted,
      agentExecutions: 0,
      workflowsRequired: SEMANTIC_EDIT_BENCHMARK_WORKFLOWS.length,
      workflowsPassed: workflowExecution?.workflows.length ?? 0,
      negativeProbesRequired: SEMANTIC_EDIT_NEGATIVE_PROBES.length,
      negativeProbesPassed: probes.length,
      replayExactMatches: freshReplay?.exactMatches ?? 0,
      replayAgentExecutions: freshReplay?.agentExecutions ?? 0,
    },
  })
  const reportJson = `${JSON.stringify(report, null, 2)}\n`
  const authorityJson = `${JSON.stringify(report.authority, null, 2)}\n`
  const markdown = markdownReport(report)
  const stdout =
    [
      `${String(report.status).toUpperCase()} SEMANTIC EDIT BENCHMARK`,
      `run: ${layout.runRoot}`,
      `mode: ${report.mode}`,
      `accepted: ${String(report.acceptance.accepted)}`,
      `agents: ${report.acceptance.agentExecutions}`,
      `authority stable: ${String(authorityStable)}`,
      `plan: ${planPath}`,
    ].join('\n') + '\n'
  if (!options.prepareOnly && assertPredecessorSecretBoundary === null)
    throw new Error(
      'execute mode omitted the required secret-boundary verifier'
    )
  assertPredecessorSecretBoundary?.([
    {
      label: 'the final benchmark JSON report',
      bytes: Buffer.from(reportJson),
    },
    {
      label: 'the final benchmark authority report',
      bytes: Buffer.from(authorityJson),
    },
    {
      label: 'the final benchmark Markdown report',
      bytes: Buffer.from(markdown),
    },
    {
      label: 'the final benchmark process output',
      bytes: Buffer.from(stdout),
    },
  ])
  writeExclusive(
    join(layout.runRoot, 'semantic-edit-benchmark.json'),
    reportJson
  )
  writeExclusive(
    join(layout.evidenceRoot, 'benchmark-authority.json'),
    authorityJson
  )
  const markdownPath = join(layout.runRoot, 'semantic-edit-benchmark.md')
  writeExclusive(markdownPath, markdown)
  process.stdout.write(stdout)
  if (!authorityStable || (!options.prepareOnly && !accepted))
    process.exitCode = 1
}

main().catch((error: unknown) =>
{
  const message = error instanceof Error ? error.message : 'unknown error'
  process.stderr.write(`semantic-edit-bench: ${message}\n`)
  process.exitCode = 1
})
