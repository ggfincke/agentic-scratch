// packages/mcp/src/repair/sessions.ts
// map opaque MCP session IDs onto the sole repair controller state machine

import {
  RepairProtocolError,
  startRepair,
  type AttemptResult,
  type RepairRequest,
  type RepairSession,
  type RepairSessionSnapshot,
} from '@scratch-agent/repair'

import { registeredRepairCase, REPAIR_CASE_IDS } from './cases.js'
import { RepairMcpBoundaryError } from '../transport/errors.js'
import {
  configureRepairMcpPaths,
  readRepairInput,
  resolveRepairOutput,
  type RepairMcpPathConfig,
  type RepairMcpPaths,
} from '../transport/paths.js'

type ExternalCaseId = (typeof REPAIR_CASE_IDS)[number]

export const DEFAULT_MAX_LIVE_SESSIONS = 4
export const HARD_MAX_LIVE_SESSIONS = 64

interface SessionIdentity
{
  externalCaseId: ExternalCaseId
  repairCaseId: string
}

interface LiveSessionRecord extends SessionIdentity
{
  kind: 'live'
  session: RepairSession
  consumedRequestIds: Set<string>
}

interface DetachedSessionRecord extends SessionIdentity
{
  kind: 'detached'
  snapshot: RepairSessionSnapshot
  releaseReason: 'terminal-nonaccepted' | 'accepted-exported'
}

type SessionRecord = LiveSessionRecord | DetachedSessionRecord

export interface RepairSessionRegistryOptions
{
  maxLiveSessions?: number
}

export interface RepairSessionRetentionStats
{
  maxLiveSessions: number
  liveSessionCount: number
  startingSessionCount: number
  detachedSessionCount: number
  totalRecordCount: number
}

export interface StartedRepairSession
{
  sessionId: string
  caseId: ExternalCaseId
  repairCaseId: string
  snapshot: RepairSessionSnapshot
}

export interface ExportedRepairArtifact
{
  sessionId: string
  exported: true
  sha256: string
  byteLength: number
  recordedAt: string
}

function stringRequestId(value: unknown): string | null
{
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const requestId = (value as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.length > 0
    ? requestId
    : null
}

function wrapRepairError(error: unknown): never
{
  if (error instanceof RepairMcpBoundaryError) throw error
  if (error instanceof RepairProtocolError)
  {
    throw new RepairMcpBoundaryError(error.code, error.message)
  }
  throw new RepairMcpBoundaryError(
    'mcp.controller-failed',
    'repair controller operation failed'
  )
}

function liveSessionLimit(value: number | undefined): number
{
  const limit = value ?? DEFAULT_MAX_LIVE_SESSIONS
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > HARD_MAX_LIVE_SESSIONS
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.session-capacity-invalid',
      `maxLiveSessions must be a positive safe integer at most ${HARD_MAX_LIVE_SESSIONS}`
    )
  }
  return limit
}

export class RepairSessionRegistry
{
  readonly paths: RepairMcpPaths

  private readonly records = new Map<string, SessionRecord>()
  private readonly maxLiveSessions: number
  private liveSessionCount = 0
  private startingSessionCount = 0

  constructor(
    config: RepairMcpPathConfig,
    options: RepairSessionRegistryOptions = {}
  )
  {
    this.paths = configureRepairMcpPaths(config)
    this.maxLiveSessions = liveSessionLimit(options.maxLiveSessions)
  }

  retentionStats(): RepairSessionRetentionStats
  {
    return {
      maxLiveSessions: this.maxLiveSessions,
      liveSessionCount: this.liveSessionCount,
      startingSessionCount: this.startingSessionCount,
      detachedSessionCount: this.records.size - this.liveSessionCount,
      totalRecordCount: this.records.size,
    }
  }

  async start(
    inputPath: unknown,
    caseId: unknown
  ): Promise<StartedRepairSession>
  {
    this.reserveStart()
    try
    {
      const definition = registeredRepairCase(caseId)
      const bytes = readRepairInput(this.paths, inputPath)
      const session = await startRepair({
        artifactBytes: bytes,
        repairCase: definition.repairCase,
        artifactRoot: this.paths.artifactRoot,
      })
      const snapshot = session.snapshot()
      const record: LiveSessionRecord = {
        kind: 'live',
        externalCaseId: definition.id,
        repairCaseId: definition.repairCase.id,
        session,
        consumedRequestIds: new Set(),
      }
      this.records.set(session.id, record)
      this.liveSessionCount++
      this.compactTerminal(record, snapshot)
      return {
        sessionId: session.id,
        caseId: record.externalCaseId,
        repairCaseId: record.repairCaseId,
        snapshot,
      }
    }
    catch (error)
    {
      wrapRepairError(error)
    }
    finally
    {
      this.startingSessionCount--
    }
  }

  next(sessionId: unknown): RepairRequest
  {
    const record = this.requireLiveRecord(sessionId)
    if (record.session.snapshot().terminal)
    {
      this.compactTerminal(record)
      throw new RepairMcpBoundaryError(
        'mcp.session-terminal',
        'repair session is terminal'
      )
    }
    try
    {
      const next = record.session.nextRequest()
      if ('stopReason' in next)
      {
        this.compactTerminal(record)
        throw new RepairMcpBoundaryError(
          'mcp.session-terminal',
          'repair session became terminal before a request was available'
        )
      }
      return next
    }
    catch (error)
    {
      this.compactTerminal(record)
      wrapRepairError(error)
    }
  }

  async submit(sessionId: unknown, proposal: unknown): Promise<AttemptResult>
  {
    const record = this.requireLiveRecord(sessionId)
    const snapshot = record.session.snapshot()
    if (snapshot.terminal)
    {
      this.compactTerminal(record, snapshot)
      throw new RepairMcpBoundaryError(
        'mcp.session-terminal',
        'cannot submit to a terminal repair session'
      )
    }
    if (!snapshot.pendingRequestId)
    {
      throw new RepairMcpBoundaryError(
        'mcp.request-missing',
        'repair_next must reserve a request before repair_submit'
      )
    }
    const submittedRequestId = stringRequestId(proposal)
    if (
      record.consumedRequestIds.has(snapshot.pendingRequestId) ||
      (submittedRequestId !== null &&
        record.consumedRequestIds.has(submittedRequestId))
    )
    {
      throw new RepairMcpBoundaryError(
        'mcp.submission-duplicate',
        'repair request was already submitted'
      )
    }
    record.consumedRequestIds.add(snapshot.pendingRequestId)
    try
    {
      return await record.session.submitProposal(proposal, {
        descriptor: { adapter: 'mcp' },
      })
    }
    catch (error)
    {
      wrapRepairError(error)
    }
    finally
    {
      this.compactTerminal(record)
    }
  }

  status(sessionId: unknown): RepairSessionSnapshot
  {
    const record = this.requireRecord(sessionId)
    if (record.kind === 'detached') return structuredClone(record.snapshot)
    const snapshot = record.session.snapshot()
    this.compactTerminal(record, snapshot)
    return snapshot
  }

  export(sessionId: unknown, outputPath: unknown): ExportedRepairArtifact
  {
    const record = this.requireRecord(sessionId)
    const resolvedOutput = resolveRepairOutput(this.paths, outputPath)
    if (record.kind === 'detached')
    {
      throw new RepairMcpBoundaryError(
        'mcp.export-unavailable-released',
        'repair session was released and can no longer export an artifact'
      )
    }
    try
    {
      const proof = record.session.exportAccepted(resolvedOutput)
      this.detach(record, record.session.snapshot(), 'accepted-exported')
      return {
        sessionId: record.session.id,
        exported: true,
        ...proof,
      }
    }
    catch (error)
    {
      this.compactTerminal(record)
      wrapRepairError(error)
    }
  }

  private reserveStart(): void
  {
    if (
      this.liveSessionCount + this.startingSessionCount >=
      this.maxLiveSessions
    )
    {
      throw new RepairMcpBoundaryError(
        'mcp.session-capacity-exhausted',
        'repair session capacity is exhausted'
      )
    }
    this.startingSessionCount++
  }

  private compactTerminal(
    record: LiveSessionRecord,
    snapshot = record.session.snapshot()
  ): void
  {
    if (!snapshot.terminal || snapshot.terminal.accepted) return
    this.detach(record, snapshot, 'terminal-nonaccepted')
  }

  private detach(
    record: LiveSessionRecord,
    snapshot: RepairSessionSnapshot,
    releaseReason: DetachedSessionRecord['releaseReason']
  ): void
  {
    if (this.records.get(record.session.id) !== record) return
    this.records.set(record.session.id, {
      kind: 'detached',
      externalCaseId: record.externalCaseId,
      repairCaseId: record.repairCaseId,
      snapshot: structuredClone(snapshot),
      releaseReason,
    })
    this.liveSessionCount--
  }

  private requireLiveRecord(sessionId: unknown): LiveSessionRecord
  {
    const record = this.requireRecord(sessionId)
    if (record.kind === 'detached')
    {
      throw new RepairMcpBoundaryError(
        'mcp.session-terminal',
        'repair session is terminal'
      )
    }
    return record
  }

  private requireRecord(sessionId: unknown): SessionRecord
  {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
    {
      throw new RepairMcpBoundaryError(
        'mcp.session-id-invalid',
        'sessionId must be a nonempty string'
      )
    }
    const record = this.records.get(sessionId)
    if (!record)
    {
      throw new RepairMcpBoundaryError(
        'mcp.session-unknown',
        'repair session was not found'
      )
    }
    return record
  }
}
