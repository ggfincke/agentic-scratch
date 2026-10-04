// scripts/project/drive-observe-replay.ts
// verifies retained drive-observe evidence & replays it headlessly without writes

import { lstatSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import {
  withInteractiveBrowserSession,
  type DriveObserveCommandRecordV1,
} from '@scratch-agent/runner'
import {
  DEFAULT_SB3_LIMITS,
  admitSb3,
  validateAdmittedSb3,
} from '@scratch-agent/sb3'

import {
  assertNoSymlinkPath,
  readContainedRegularFile,
} from '../lib/private-fs.js'
import {
  DRIVE_OBSERVE_MAX_LINE_BYTES,
  DRIVE_OBSERVE_PROTOCOL,
  DRIVE_OBSERVE_REPLAY_PROTOCOL,
  DRIVE_OBSERVE_SCHEMA_VERSION,
  DriveObserveRequestAliases,
  artifactIdentity,
  canonicalJsonArtifactBytes,
  normalizeCommandRecord,
  observationArtifact,
  orderedArtifactHash,
  orderedRecordHash,
  parseCanonicalJson,
  runtimeDescriptorHash,
  stableHash,
  terminalProjection,
  type DriveObserveArtifactIdentityV1,
  type DriveObserveNormalizedRecordV1,
  type DriveObserveNormalizedTranscriptV1,
  type DriveObserveReplayResultV1,
  type DriveObserveReportV1,
  type DriveObserveTerminalInputV1,
} from './drive-observe-evidence.js'

const MAX_REPORT_BYTES = 16 * 1024 * 1024
const MAX_NORMALIZED_BYTES = 32 * 1024 * 1024
const MAX_FORENSIC_BYTES = DRIVE_OBSERVE_MAX_LINE_BYTES * 256 + 1024 * 1024
const MAX_OBSERVATION_BYTES = 9 * 1024 * 1024

interface CliOptions
{
  readonly runRoot: string
}

interface ReplayExecution
{
  readonly descriptorSha256: string
  readonly records: readonly DriveObserveNormalizedRecordV1[]
  readonly observations: readonly DriveObserveArtifactIdentityV1[]
  readonly refused: boolean
}

function usageText(): string
{
  return 'usage: npm --silent run drive-observe-replay -- --run <absolute-run-root>'
}

function usage(): never
{
  throw new Error(usageText())
}

function parseArgs(argv: readonly string[]): CliOptions | 'help'
{
  if (argv.length === 1 && argv[0] === '--help') return 'help'
  if (
    argv.length !== 2 ||
    argv[0] !== '--run' ||
    !argv[1] ||
    !isAbsolute(argv[1])
  )
    usage()
  return { runRoot: resolve(argv[1]) }
}

function recordValue(value: unknown): Record<string, unknown> | null
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function loadReport(root: string): DriveObserveReportV1
{
  const bytes = readContainedRegularFile(
    root,
    'report.json',
    MAX_REPORT_BYTES,
    'drive-observe report'
  )
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  ) as unknown
  const record = recordValue(value)
  if (
    record?.schemaVersion !== DRIVE_OBSERVE_SCHEMA_VERSION ||
    record.protocol !== DRIVE_OBSERVE_PROTOCOL
  )
    throw new Error('retained report has an unsupported schema')
  return value as DriveObserveReportV1
}

function loadNormalized(
  root: string,
  report: DriveObserveReportV1
): DriveObserveNormalizedTranscriptV1
{
  requireIdentityPath(
    report.transcript.normalized,
    'transcript/normalized.json'
  )
  const bytes = verifiedArtifact(
    root,
    report.transcript.normalized,
    MAX_NORMALIZED_BYTES,
    'normalized transcript'
  )
  const value = parseCanonicalJson(bytes)
  const record = recordValue(value)
  if (
    record?.schemaVersion !== DRIVE_OBSERVE_SCHEMA_VERSION ||
    record.protocol !== DRIVE_OBSERVE_PROTOCOL ||
    !Array.isArray(record.records) ||
    !Array.isArray(record.cleanupActions) ||
    !('terminalInput' in record)
  )
    throw new Error('normalized transcript has an unsupported schema')
  return value as DriveObserveNormalizedTranscriptV1
}

function requireIdentityPath(
  identity: DriveObserveArtifactIdentityV1,
  expectedPath: string
): void
{
  if (identity.path !== expectedPath)
    throw new Error(
      `artifact path ${identity.path} does not equal ${expectedPath}`
    )
}

function verifiedArtifact(
  root: string,
  identity: DriveObserveArtifactIdentityV1,
  maximumBytes: number,
  label: string
): Uint8Array
{
  const bytes = readContainedRegularFile(
    root,
    identity.path,
    maximumBytes,
    label
  )
  const actual = artifactIdentity(identity.path, bytes)
  if (
    actual.sha256 !== identity.sha256 ||
    actual.byteLength !== identity.byteLength
  )
    throw new Error(`${label} identity does not match its report`)
  return bytes
}

function assertPrivateMode(
  root: string,
  relativePath: string,
  expected: number
): void
{
  assertNoSymlinkPath(root, relativePath)
  const path = resolve(root, relativePath)
  const mode = lstatSync(path).mode & 0o777
  if (mode !== expected)
    throw new Error(
      `${relativePath} mode ${mode.toString(8)} does not equal ${expected.toString(8)}`
    )
}

function verifyTerminalInput(value: DriveObserveTerminalInputV1 | null): void
{
  if (value === null) return
  if (
    value.encoding !== 'base64' ||
    !Number.isSafeInteger(value.inputLine) ||
    value.inputLine < 1 ||
    typeof value.issueCode !== 'string' ||
    value.issueCode.length === 0 ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 0 ||
    value.byteLength > DRIVE_OBSERVE_MAX_LINE_BYTES + 1 ||
    typeof value.value !== 'string' ||
    typeof value.sha256 !== 'string'
  )
    throw new Error('normalized terminal input is invalid')
  const bytes = Buffer.from(value.value, 'base64')
  const identity = artifactIdentity('', bytes)
  if (
    bytes.toString('base64') !== value.value ||
    identity.byteLength !== value.byteLength ||
    identity.sha256 !== value.sha256
  )
    throw new Error('normalized terminal input identity does not match')
}

async function verifyRetainedEvidence(input: {
  readonly root: string
  readonly report: DriveObserveReportV1
  readonly normalized: DriveObserveNormalizedTranscriptV1
}): Promise<Uint8Array>
{
  requireIdentityPath(input.report.source.retainedBefore, 'input/source.sb3')
  requireIdentityPath(input.report.source.retainedAfter, 'input/source.sb3')
  requireIdentityPath(
    input.report.transcript.forensic,
    'transcript/commands.jsonl'
  )
  requireIdentityPath(
    input.report.transcript.normalized,
    'transcript/normalized.json'
  )
  requireIdentityPath(input.report.browser.console, 'browser/console.json')
  requireIdentityPath(input.report.browser.issues, 'browser/issues.json')
  input.report.observations.artifacts.forEach((artifact, index) =>
  {
    requireIdentityPath(
      artifact,
      `observations/observation-${String(index).padStart(4, '0')}.json`
    )
  })
  if (
    input.report.runtime.descriptor === null ||
    runtimeDescriptorHash(input.report.runtime.descriptor) !==
      input.report.runtime.descriptorSha256
  )
    throw new Error('retained runtime descriptor identity does not match')

  for (const directory of [
    '.',
    'input',
    'observations',
    'transcript',
    'browser',
  ])
    assertPrivateMode(input.root, directory, 0o700)
  for (const file of [
    'input/source.sb3',
    'input/identity.json',
    'transcript/commands.jsonl',
    'transcript/normalized.json',
    'browser/console.json',
    'browser/issues.json',
    'report.json',
    'report.md',
  ])
    assertPrivateMode(input.root, file, 0o600)

  const source = verifiedArtifact(
    input.root,
    input.report.source.retainedBefore,
    DEFAULT_SB3_LIMITS.maxCompressedBytes,
    'retained source'
  )
  const after = artifactIdentity(input.report.source.retainedAfter.path, source)
  if (
    after.sha256 !== input.report.source.retainedAfter.sha256 ||
    after.byteLength !== input.report.source.retainedAfter.byteLength ||
    !input.report.source.exactPreserved
  )
    throw new Error('retained source preservation identity does not match')
  const admission = await admitSb3(source)
  const validation = await validateAdmittedSb3(source)
  if (
    !validation.ok ||
    stableHash(admission.metrics) !==
      stableHash(input.report.source.admission.metrics) ||
    stableHash(admission.limits) !==
      stableHash(input.report.source.admission.limits)
  )
    throw new Error('retained source admission identity does not match')

  verifiedArtifact(
    input.root,
    input.report.transcript.forensic,
    MAX_FORENSIC_BYTES,
    'forensic transcript'
  )
  verifiedArtifact(
    input.root,
    input.report.browser.console,
    MAX_REPORT_BYTES,
    'browser console'
  )
  verifiedArtifact(
    input.root,
    input.report.browser.issues,
    MAX_REPORT_BYTES,
    'browser issues'
  )
  for (const artifact of input.report.observations.artifacts)
  {
    assertPrivateMode(input.root, artifact.path, 0o600)
    verifiedArtifact(
      input.root,
      artifact,
      MAX_OBSERVATION_BYTES,
      `observation ${artifact.path}`
    )
  }
  if (
    orderedRecordHash(input.normalized.records) !==
      input.normalized.orderedSha256 ||
    input.normalized.orderedSha256 !== input.report.transcript.orderedSha256
  )
    throw new Error('normalized transcript ordered identity does not match')
  if (
    orderedArtifactHash(input.report.observations.artifacts) !==
    input.report.observations.orderedSha256
  )
    throw new Error('ordered observation identity does not match')
  verifyTerminalInput(input.normalized.terminalInput)
  const normalizedTerminalInput =
    input.normalized.terminalInput === null
      ? null
      : {
          inputLine: input.normalized.terminalInput.inputLine,
          issueCode: input.normalized.terminalInput.issueCode,
          byteLength: input.normalized.terminalInput.byteLength,
          sha256: input.normalized.terminalInput.sha256,
        }
  if (
    stableHash(normalizedTerminalInput) !==
    stableHash(input.report.terminal.terminalInput)
  )
    throw new Error('normalized terminal input does not match its report')
  const terminal = {
    outerReason: input.report.terminal.outerReason,
    runnerState: input.report.terminal.runnerState,
    runnerReason: input.report.terminal.runnerReason,
    tick: input.report.terminal.tick,
    drawEpoch: input.report.terminal.drawEpoch,
    runtimePositionConfirmed: input.report.terminal.runtimePositionConfirmed,
    heldInput: input.report.terminal.heldInput,
    budgets: input.report.terminal.budgets,
    cleanupActions: input.report.terminal.cleanupActions,
    terminalInput: input.report.terminal.terminalInput,
    issues: input.report.terminal.issues,
    droppedIssues: input.report.terminal.droppedIssues,
  }
  if (
    stableHash(terminal) !== input.report.terminal.stableSha256 ||
    input.normalized.terminalSha256 !== input.report.terminal.stableSha256
  )
    throw new Error('terminal identity does not match')
  return source
}

function replayObservation(
  record: DriveObserveCommandRecordV1,
  index: number
): DriveObserveArtifactIdentityV1 | null
{
  const value = observationArtifact(record)
  if (value === null) return null
  const bytes = canonicalJsonArtifactBytes(value)
  const path = `observations/observation-${String(index).padStart(4, '0')}.json`
  return artifactIdentity(path, bytes)
}

async function executeReplay(input: {
  readonly source: Uint8Array
  readonly report: DriveObserveReportV1
  readonly normalized: DriveObserveNormalizedTranscriptV1
}): Promise<{
  readonly execution: ReplayExecution
  readonly report: Awaited<
    ReturnType<typeof withInteractiveBrowserSession<ReplayExecution>>
  >['report']
}>
{
  let execution: ReplayExecution | null = null
  const outcome = await withInteractiveBrowserSession(
    {
      sb3: input.source,
      headless: true,
      pacing: 'instant',
      seed: input.report.deterministicEnvironment.seed,
      fixedDateMs: input.report.deterministicEnvironment.fixedDateMs,
      limits: input.report.limits.session,
    },
    async (session) =>
    {
      const descriptorSha256 = runtimeDescriptorHash(
        session.ready.runtimeDescriptor
      )!
      if (descriptorSha256 !== input.report.runtime.descriptorSha256)
      {
        execution = {
          descriptorSha256,
          records: [],
          observations: [],
          refused: true,
        }
        return execution
      }
      const aliases = new DriveObserveRequestAliases()
      const records: DriveObserveNormalizedRecordV1[] = []
      const observations: DriveObserveArtifactIdentityV1[] = []
      for (const expected of input.normalized.records)
      {
        const outcome = await session.execute(expected.replayInput)
        if (outcome.kind !== 'command')
          throw new Error(
            `replay command ${expected.sequence} terminalized without a record`
          )
        const observation = replayObservation(
          outcome.record,
          observations.length
        )
        if (observation) observations.push(observation)
        records.push(
          normalizeCommandRecord({
            rawInput: expected.replayInput,
            expectedTick: expected.expectedTick,
            record: outcome.record,
            observation,
            aliases,
          })
        )
      }
      execution = {
        descriptorSha256,
        records,
        observations,
        refused: input.normalized.terminalInput !== null,
      }
      return execution
    }
  )
  if (execution === null) throw new Error('replay callback was not invoked')
  return { execution, report: outcome.report }
}

function mismatch(
  path: string,
  expected: unknown,
  actual: unknown
): { path: string; expected: unknown; actual: unknown } | null
{
  return stableHash(expected) === stableHash(actual)
    ? null
    : { path, expected, actual }
}

async function main(): Promise<void>
{
  const options = parseArgs(process.argv.slice(2))
  if (options === 'help')
  {
    process.stdout.write(`${usageText()}\n`)
    return
  }
  const rootStat = lstatSync(options.runRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('replay run must be one non-symlink directory')
  const report = loadReport(options.runRoot)
  const normalized = loadNormalized(options.runRoot, report)
  const source = await verifyRetainedEvidence({
    root: options.runRoot,
    report,
    normalized,
  })
  const replay = await executeReplay({ source, report, normalized })
  const actualOrdered = orderedRecordHash(replay.execution.records)
  const actualObservationHashes = replay.execution.observations.map(
    (artifact) => artifact.sha256
  )
  const actualTerminal = terminalProjection(
    report.terminal.outerReason,
    replay.report,
    null
  )
  const actualTerminalSha256 = stableHash(actualTerminal)
  const mismatches = [
    mismatch(
      'runtime.descriptorSha256',
      report.runtime.descriptorSha256,
      replay.execution.descriptorSha256
    ),
    mismatch(
      'transcript.orderedSha256',
      normalized.orderedSha256,
      actualOrdered
    ),
    mismatch(
      'observations.sha256s',
      report.observations.artifacts.map((artifact) => artifact.sha256),
      actualObservationHashes
    ),
    mismatch(
      'terminal.stableSha256',
      report.terminal.stableSha256,
      actualTerminalSha256
    ),
  ].filter(
    (value): value is { path: string; expected: unknown; actual: unknown } =>
      value !== null
  )
  const status = replay.execution.refused
    ? 'refused'
    : mismatches.length === 0
      ? 'matched'
      : 'mismatched'
  // replay is read-only: re-check retained source identity after execution
  const sourceAfterReplay = artifactIdentity(
    report.source.retainedBefore.path,
    readContainedRegularFile(
      options.runRoot,
      report.source.retainedBefore.path,
      DEFAULT_SB3_LIMITS.maxCompressedBytes,
      'retained source after replay'
    )
  )
  const sourceWrites =
    sourceAfterReplay.sha256 === report.source.retainedBefore.sha256 &&
    sourceAfterReplay.byteLength === report.source.retainedBefore.byteLength
      ? 0
      : 1
  if (sourceWrites !== 0)
    throw new Error('replay mutated the retained source artifact')
  const result: DriveObserveReplayResultV1 = {
    protocol: DRIVE_OBSERVE_REPLAY_PROTOCOL,
    type: 'replayResult',
    status,
    runRoot: options.runRoot,
    expected: {
      runtimeDescriptorSha256: report.runtime.descriptorSha256,
      transcriptSha256: normalized.orderedSha256,
      observationSha256s: report.observations.artifacts.map(
        (artifact) => artifact.sha256
      ),
      terminalSha256: report.terminal.stableSha256,
    },
    actual: {
      runtimeDescriptorSha256: replay.execution.descriptorSha256,
      transcriptSha256: actualOrdered,
      observationSha256s: actualObservationHashes,
      terminalSha256: actualTerminalSha256,
    },
    mismatches,
    agentExecutions: 0,
    // measured above; typed as 0 because replay must remain source-preserving
    sourceWrites: 0,
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (status !== 'matched') process.exitCode = 1
}

main().catch((error: unknown) =>
{
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
