// scripts/project/drive-observe-evidence.ts
// defines canonical retained evidence shared by live drive-observe & replay

import type {
  BrowserConsoleSummary,
  DriveObserveCleanupActionV1,
  DriveObserveCommandRecordV1,
  DriveObserveSessionLimitsV1,
  DriveObserveSessionReportV1,
  RuntimeDescriptorV1,
  RunIssue,
} from '@scratch-agent/runner'
import type { Sb3AdmissionMetrics, Sb3Limits } from '@scratch-agent/sb3'
import {
  canonicalJsonBytesV1,
  canonicalJsonV1,
} from '@scratch-agent/sb3/canonical-json'

import { sha256Hex } from '../lib/hash.js'

export const DRIVE_OBSERVE_PROTOCOL = 'scratch-agent/drive-observe/v1' as const
export const DRIVE_OBSERVE_REPLAY_PROTOCOL =
  'scratch-agent/drive-observe-replay/v1' as const
export const DRIVE_OBSERVE_SCHEMA_VERSION = 1 as const
export const DRIVE_OBSERVE_MAX_LINE_BYTES = 64 * 1024
export const DRIVE_OBSERVE_MAX_JSON_DEPTH = 64
export const DRIVE_OBSERVE_SEED = 0
export const DRIVE_OBSERVE_FIXED_DATE_MS = 1_700_000_000_000

export interface DriveObserveArtifactIdentityV1
{
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
}

export type DriveObserveSourceIdentityV1 = DriveObserveArtifactIdentityV1

export interface DriveObserveObservationArtifactV1
{
  readonly schemaVersion: typeof DRIVE_OBSERVE_SCHEMA_VERSION
  readonly sequence: number
  readonly tick: number
  readonly drawEpoch: number
  readonly label: string | null
  readonly capture: unknown
}

export interface DriveObserveNormalizedRecordV1
{
  readonly sequence: number
  readonly requestKey: number
  readonly expectedTick: number
  readonly replayInput: unknown
  readonly normalizedCommand: DriveObserveCommandRecordV1['normalizedCommand']
  readonly status: DriveObserveCommandRecordV1['status']
  readonly tickBefore: number
  readonly tickAfter: number
  readonly drawEpochBefore: number
  readonly drawEpochAfter: number
  readonly heldInputBefore: DriveObserveCommandRecordV1['heldInputBefore']
  readonly heldInputAfter: DriveObserveCommandRecordV1['heldInputAfter']
  readonly changed: boolean
  readonly result: unknown
  readonly issue: DriveObserveStableIssueV1 | null
  readonly budgets: DriveObserveCommandRecordV1['budgets']
  readonly observationSha256: string | null
  readonly stableSha256: string
}

export interface DriveObserveNormalizedTranscriptV1
{
  readonly schemaVersion: typeof DRIVE_OBSERVE_SCHEMA_VERSION
  readonly protocol: typeof DRIVE_OBSERVE_PROTOCOL
  readonly records: readonly DriveObserveNormalizedRecordV1[]
  readonly terminalInput: DriveObserveTerminalInputV1 | null
  readonly cleanupActions: readonly DriveObserveNormalizedCleanupV1[]
  readonly orderedSha256: string
  readonly terminalSha256: string
}

export interface DriveObserveTerminalProjectionV1
{
  readonly outerReason: string
  readonly runnerState: DriveObserveSessionReportV1['state']
  readonly runnerReason: string
  readonly tick: number
  readonly drawEpoch: number
  readonly runtimePositionConfirmed: boolean
  readonly heldInput: DriveObserveSessionReportV1['heldInput']
  readonly budgets: DriveObserveSessionReportV1['budgets']
  readonly cleanupActions: readonly DriveObserveNormalizedCleanupV1[]
  readonly terminalInput: DriveObserveTerminalInputProjectionV1 | null
  readonly issues: readonly DriveObserveStableIssueV1[]
  readonly droppedIssues: number
}

export interface DriveObserveTerminalInputV1
{
  readonly inputLine: number
  readonly issueCode: string
  readonly encoding: 'base64'
  readonly value: string
  readonly byteLength: number
  readonly sha256: string
}

export interface DriveObserveTerminalInputProjectionV1
{
  readonly inputLine: number
  readonly issueCode: string
  readonly byteLength: number
  readonly sha256: string
}

export interface DriveObserveStableIssueV1
{
  readonly code: string
  readonly kind: RunIssue['kind']
  readonly responsibility: RunIssue['responsibility']
}

export interface DriveObserveNormalizedCleanupV1
{
  readonly command: DriveObserveCleanupActionV1['command']
  readonly heldInputBefore: DriveObserveCleanupActionV1['heldInputBefore']
  readonly heldInputAfter: DriveObserveCleanupActionV1['heldInputAfter']
  readonly drawEpochBefore: number
  readonly drawEpochAfter: number
  readonly issue: DriveObserveStableIssueV1 | null
}

export interface DriveObserveReportV1
{
  readonly schemaVersion: typeof DRIVE_OBSERVE_SCHEMA_VERSION
  readonly protocol: typeof DRIVE_OBSERVE_PROTOCOL
  readonly run: {
    readonly id: string
    readonly root: string
    readonly startedAt: string
    readonly endedAt: string
    readonly sourceRevision: string
  }
  readonly source: {
    readonly originalBefore: DriveObserveSourceIdentityV1
    readonly originalAfter: DriveObserveSourceIdentityV1 | null
    readonly retainedBefore: DriveObserveSourceIdentityV1
    readonly retainedAfter: DriveObserveSourceIdentityV1
    readonly exactPreserved: boolean
    readonly admission: {
      readonly limits: Sb3Limits
      readonly metrics: Sb3AdmissionMetrics
      readonly projectVersion: number
    }
  }
  readonly runtime: {
    readonly descriptor: RuntimeDescriptorV1 | null
    readonly descriptorSha256: string | null
  }
  readonly deterministicEnvironment: {
    readonly seed: number
    readonly fixedDateMs: number
    readonly tickMs: number | null
  }
  readonly pacing: 'instant' | 'realtime'
  readonly limits: {
    readonly session: DriveObserveSessionLimitsV1
    readonly idleTimeoutMs: number
    readonly inputLineBytes: number
    readonly outputLineBytes: number
    readonly observation: unknown
    readonly sb3: Sb3Limits
  }
  readonly transcript: {
    readonly forensic: DriveObserveArtifactIdentityV1
    readonly normalized: DriveObserveArtifactIdentityV1
    readonly records: number
    readonly orderedSha256: string
  }
  readonly observations: {
    readonly artifacts: readonly DriveObserveArtifactIdentityV1[]
    readonly orderedSha256: string
  }
  readonly stateIdentities: {
    readonly initialObservationSha256: string | null
    readonly finalObservationSha256: string | null
    readonly initialUnavailableReason: string | null
    readonly finalUnavailableReason: string | null
  }
  readonly browser: {
    readonly headless: boolean
    readonly console: DriveObserveArtifactIdentityV1
    readonly issues: DriveObserveArtifactIdentityV1
    readonly summary: BrowserConsoleSummary
  }
  readonly terminal: DriveObserveTerminalProjectionV1 & {
    readonly stableSha256: string
  }
  readonly claim: {
    readonly supported: boolean
    readonly statement: string
    readonly limitations: readonly string[]
  }
}

export interface DriveObserveInputIdentityFileV1
{
  readonly schemaVersion: typeof DRIVE_OBSERVE_SCHEMA_VERSION
  readonly original: DriveObserveSourceIdentityV1
  readonly retained: DriveObserveSourceIdentityV1
  readonly admission: {
    readonly limits: Sb3Limits
    readonly metrics: Sb3AdmissionMetrics
    readonly projectVersion: number
  }
}

export interface DriveObserveReplayResultV1
{
  readonly protocol: typeof DRIVE_OBSERVE_REPLAY_PROTOCOL
  readonly type: 'replayResult'
  readonly status: 'matched' | 'mismatched' | 'refused' | 'failed'
  readonly runRoot: string
  readonly expected: {
    readonly runtimeDescriptorSha256: string | null
    readonly transcriptSha256: string
    readonly observationSha256s: readonly string[]
    readonly terminalSha256: string
  }
  readonly actual: {
    readonly runtimeDescriptorSha256: string | null
    readonly transcriptSha256: string
    readonly observationSha256s: readonly string[]
    readonly terminalSha256: string
  } | null
  readonly mismatches: readonly {
    readonly path: string
    readonly expected: unknown
    readonly actual: unknown
  }[]
  readonly agentExecutions: 0
  readonly sourceWrites: 0
}

export function stableHash(value: unknown): string
{
  return sha256Hex(canonicalJsonBytesV1(value))
}

export function canonicalJsonArtifactBytes(value: unknown): Uint8Array
{
  return canonicalJsonBytesV1(value)
}

export function prettyJson(value: unknown): string
{
  return `${JSON.stringify(value, null, 2)}\n`
}

export function artifactIdentity(
  path: string,
  bytes: Uint8Array | string
): DriveObserveArtifactIdentityV1
{
  const value = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes
  return {
    path,
    sha256: sha256Hex(value),
    byteLength: value.byteLength,
  }
}

function stableJsonValue(value: unknown): unknown
{
  if (typeof value === 'number')
  {
    if (Object.is(value, -0)) return 0
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      return `$unsafe-integer:${String(value)}`
    return value
  }
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value === null || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort())
    output[key] = stableJsonValue((value as Record<string, unknown>)[key])
  return output
}

export function assertBoundedJsonDepth(value: unknown): void
{
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value, depth: 0 },
  ]
  while (pending.length > 0)
  {
    const current = pending.pop()!
    if (current.value === null || typeof current.value !== 'object') continue
    if (current.depth >= DRIVE_OBSERVE_MAX_JSON_DEPTH)
      throw new Error(
        `JSON nesting exceeds ${DRIVE_OBSERVE_MAX_JSON_DEPTH} levels`
      )
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)
    for (const child of children)
      pending.push({ value: child, depth: current.depth + 1 })
  }
}

export class DriveObserveRequestAliases
{
  readonly #aliases = new Map<string, number>()

  alias(requestId: string): number
  {
    const found = this.#aliases.get(requestId)
    if (found !== undefined) return found
    const alias = this.#aliases.size
    this.#aliases.set(requestId, alias)
    return alias
  }

  replayInput(input: unknown, requestKey: number): unknown
  {
    const value = stableJsonValue(input)
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return value
    return {
      ...(value as Record<string, unknown>),
      requestId: `$request-${requestKey}`,
    }
  }
}

function projectedResult(
  record: DriveObserveCommandRecordV1,
  observation: DriveObserveArtifactIdentityV1 | null
): unknown
{
  if (record.result?.kind !== 'observation') return record.result
  return {
    kind: 'observation',
    label: record.result.label,
    capture: {
      status: record.result.capture.status,
      totals: record.result.capture.totals,
      ...(record.result.capture.status === 'refused'
        ? { value: null, issue: record.result.capture.issue }
        : {}),
    },
    artifact:
      observation === null
        ? null
        : {
            sha256: observation.sha256,
            byteLength: observation.byteLength,
          },
  }
}

export function stableIssue(
  issue: RunIssue | null
): DriveObserveStableIssueV1 | null
{
  return issue === null
    ? null
    : {
        code: issue.code,
        kind: issue.kind,
        responsibility: issue.responsibility,
      }
}

export function normalizedCleanupActions(
  actions: readonly DriveObserveCleanupActionV1[]
): DriveObserveNormalizedCleanupV1[]
{
  return actions.map((action) => ({
    command: action.command,
    heldInputBefore: action.heldInputBefore,
    heldInputAfter: action.heldInputAfter,
    drawEpochBefore: action.drawEpochBefore,
    drawEpochAfter: action.drawEpochAfter,
    issue: stableIssue(action.issue),
  }))
}

export function normalizeCommandRecord(input: {
  readonly rawInput: unknown
  readonly expectedTick: number
  readonly record: DriveObserveCommandRecordV1
  readonly observation: DriveObserveArtifactIdentityV1 | null
  readonly aliases: DriveObserveRequestAliases
}): DriveObserveNormalizedRecordV1
{
  const requestKey = input.aliases.alias(input.record.requestId)
  const projection = {
    sequence: input.record.sequence,
    requestKey,
    expectedTick: input.expectedTick,
    replayInput: input.aliases.replayInput(input.rawInput, requestKey),
    normalizedCommand: input.record.normalizedCommand,
    status: input.record.status,
    tickBefore: input.record.tickBefore,
    tickAfter: input.record.tickAfter,
    drawEpochBefore: input.record.drawEpochBefore,
    drawEpochAfter: input.record.drawEpochAfter,
    heldInputBefore: input.record.heldInputBefore,
    heldInputAfter: input.record.heldInputAfter,
    changed: input.record.changed,
    result: projectedResult(input.record, input.observation),
    issue: stableIssue(input.record.issue),
    budgets: input.record.budgets,
    observationSha256: input.observation?.sha256 ?? null,
  }
  return {
    ...projection,
    stableSha256: stableHash(projection),
  }
}

export function orderedRecordHash(
  records: readonly DriveObserveNormalizedRecordV1[]
): string
{
  return stableHash(records.map((record) => record.stableSha256))
}

export function orderedArtifactHash(
  artifacts: readonly DriveObserveArtifactIdentityV1[]
): string
{
  return stableHash(artifacts.map((artifact) => artifact.sha256))
}

export function terminalProjection(
  outerReason: string,
  report: DriveObserveSessionReportV1,
  terminalInput: DriveObserveTerminalInputV1 | null = null
): DriveObserveTerminalProjectionV1
{
  return {
    outerReason,
    runnerState: report.state,
    runnerReason: report.terminalReason,
    tick: report.tick,
    drawEpoch: report.drawEpoch,
    runtimePositionConfirmed: report.runtimePositionConfirmed,
    heldInput: report.heldInput,
    budgets: report.budgets,
    cleanupActions: normalizedCleanupActions(report.cleanupActions),
    terminalInput:
      terminalInput === null
        ? null
        : {
            inputLine: terminalInput.inputLine,
            issueCode: terminalInput.issueCode,
            byteLength: terminalInput.byteLength,
            sha256: terminalInput.sha256,
          },
    issues: report.issues.map((issue) => stableIssue(issue)!),
    droppedIssues: report.droppedIssues,
  }
}

export function runtimeDescriptorHash(
  descriptor: RuntimeDescriptorV1 | null
): string | null
{
  return descriptor === null ? null : stableHash(descriptor)
}

export function observationArtifact(
  record: DriveObserveCommandRecordV1
): DriveObserveObservationArtifactV1 | null
{
  if (record.result?.kind !== 'observation') return null
  return {
    schemaVersion: DRIVE_OBSERVE_SCHEMA_VERSION,
    sequence: record.sequence,
    tick: record.tickAfter,
    drawEpoch: record.drawEpochAfter,
    label: record.result.label,
    capture: record.result.capture,
  }
}

export function reportMarkdown(report: DriveObserveReportV1): string
{
  return [
    '# Drive-and-observe run',
    '',
    `**${report.terminal.runnerState.toUpperCase()}**`,
    '',
    `- source: \`${report.source.retainedBefore.sha256}\``,
    `- exact source preservation: ${report.source.exactPreserved ? 'yes' : 'no'}`,
    `- runtime descriptor: \`${report.runtime.descriptorSha256 ?? 'unavailable'}\``,
    `- transcript: \`${report.transcript.orderedSha256}\``,
    `- terminal: \`${report.terminal.stableSha256}\``,
    `- terminal reason: \`${report.terminal.outerReason}/${report.terminal.runnerReason}\``,
    `- ticks: ${report.terminal.tick}`,
    `- observations: ${report.observations.artifacts.length}`,
    '',
    '## Supported claim',
    '',
    report.claim.statement,
    '',
    '## Limitations',
    '',
    ...report.claim.limitations.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n')
}

export function parseCanonicalJson(bytes: Uint8Array): unknown
{
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const parsed = JSON.parse(text) as unknown
  canonicalJsonV1(parsed)
  return parsed
}
