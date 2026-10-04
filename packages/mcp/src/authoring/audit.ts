// packages/mcp/src/authoring/audit.ts
// retain bounded workbench calls as a verifiable append-only local hash chain

import { randomUUID } from 'node:crypto'
import { mkdir, open, opendir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { McpBoundaryError } from '../transport/errors.js'

const MAX_RECORDS = 4096
const MAX_BYTES = 32 * 1024 * 1024
const MAX_RECORD_BYTES = 128 * 1024

export interface WorkbenchAuditLimitsV1
{
  readonly maxRecords: number
  readonly maxBytes: number
  readonly maxRecordBytes: number
}

export const DEFAULT_WORKBENCH_AUDIT_LIMITS_V1: WorkbenchAuditLimitsV1 =
  Object.freeze({
    maxRecords: MAX_RECORDS,
    maxBytes: MAX_BYTES,
    maxRecordBytes: MAX_RECORD_BYTES,
  })

export interface WorkbenchAuditPersistenceEntryV1
{
  readonly phase: 'record' | 'head'
  readonly kind: 'begin' | 'complete'
  readonly sequence: number
  readonly callId: string
  readonly tool: string
}

export interface WorkbenchAuditOptionsV1
{
  readonly limits?: Partial<WorkbenchAuditLimitsV1>
  readonly beforePersistence?: (
    entry: WorkbenchAuditPersistenceEntryV1
  ) => void | Promise<void>
}

export type WorkbenchAuditErrorCodeV1 =
  | 'workbench.audit.capacity-exhausted'
  | 'workbench.audit.persistence-failed'
  | 'workbench.audit.recovery-required'
  | 'workbench.audit.completion-invalid'
  | 'workbench.audit.record-invalid'

export class WorkbenchAuditErrorV1 extends McpBoundaryError
{
  constructor(
    code: WorkbenchAuditErrorCodeV1,
    message: string,
    cause?: unknown
  )
  {
    super(code, message)
    this.name = 'WorkbenchAuditErrorV1'
    this.cause = cause
  }
}

function resolveLimits(
  overrides: Partial<WorkbenchAuditLimitsV1> = {}
): WorkbenchAuditLimitsV1
{
  for (const key of Object.keys(overrides))
  {
    if (!Object.hasOwn(DEFAULT_WORKBENCH_AUDIT_LIMITS_V1, key))
      throw new TypeError('workbench audit limits contain an unknown field')
  }
  const limits = { ...DEFAULT_WORKBENCH_AUDIT_LIMITS_V1, ...overrides }
  for (const key of Object.keys(limits) as Array<
    keyof WorkbenchAuditLimitsV1
  >)
  {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > DEFAULT_WORKBENCH_AUDIT_LIMITS_V1[key]
    )
      throw new TypeError(
        'workbench audit limits may only lower their defaults'
      )
  }
  return Object.freeze(limits)
}

interface AuditRecordV1
{
  schemaVersion: 1
  sequence: number
  previousSha256: string | null
  kind: 'begin' | 'complete'
  callId: string
  tool: string
  payload: unknown
  payloadSha256: string
}

export class WorkbenchCallAuditV1
{
  readonly directory: string
  #head: string | null = null
  #sequence = 0
  #bytes = 0
  #queue: Promise<unknown> = Promise.resolve()
  #failed = false
  #pending = new Map<string, string>()
  readonly #limits: WorkbenchAuditLimitsV1
  readonly #beforePersistence: WorkbenchAuditOptionsV1['beforePersistence']

  private constructor(
    directory: string,
    limits: WorkbenchAuditLimitsV1,
    beforePersistence: WorkbenchAuditOptionsV1['beforePersistence']
  )
  {
    this.directory = directory
    this.#limits = limits
    this.#beforePersistence = beforePersistence
  }

  static async create(
    root: string,
    profileSha256: string,
    options: WorkbenchAuditOptionsV1 = {}
  )
  {
    const limits = resolveLimits(options.limits)
    const beforePersistence = options.beforePersistence
    const directory = join(root, `mcp-audit-${randomUUID()}`)
    try
    {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(
        join(directory, 'manifest.json'),
        canonicalJsonBytesV1({
          schemaVersion: 1,
          kind: 'workbench-call-audit-v1',
          profileSha256,
          limits,
        }),
        { flag: 'wx', mode: 0o600 }
      )
      await writeFile(
        join(directory, 'head.json'),
        canonicalJsonBytesV1({
          schemaVersion: 1,
          count: 0,
          bytes: 0,
          headSha256: null,
        }),
        { flag: 'wx', mode: 0o600 }
      )
    }
    catch (error)
    {
      throw new WorkbenchAuditErrorV1(
        'workbench.audit.persistence-failed',
        'workbench audit initialization could not be retained',
        error
      )
    }
    return new WorkbenchCallAuditV1(directory, limits, beforePersistence)
  }

  statusV1()
  {
    return Object.freeze({
      auditDirectory: this.directory,
      records: this.#sequence,
      bytes: this.#bytes,
      headSha256: this.#head,
      failed: this.#failed,
      incompleteCalls: Object.freeze([...this.#pending.keys()]),
      limits: this.#limits,
    })
  }

  async begin(tool: string, input: unknown): Promise<string>
  {
    const callId = randomUUID()
    await this.#append('begin', callId, tool, input)
    return callId
  }

  async complete(callId: string, tool: string, outcome: unknown)
  {
    return this.#append('complete', callId, tool, outcome)
  }

  #append(
    kind: 'begin' | 'complete',
    callId: string,
    tool: string,
    payload: unknown
  )
  {
    const operation = this.#queue.then(async () =>
    {
      if (this.#failed)
        throw new WorkbenchAuditErrorV1(
          'workbench.audit.recovery-required',
          'workbench audit persistence failed; retained records require inspection'
        )
      let payloadBytes: Uint8Array
      try
      {
        payloadBytes = canonicalJsonBytesV1(payload)
      }
      catch (error)
      {
        throw new WorkbenchAuditErrorV1(
          'workbench.audit.record-invalid',
          'workbench audit payload is not canonical JSON',
          error
        )
      }
      const record: AuditRecordV1 = {
        schemaVersion: 1,
        sequence: this.#sequence,
        previousSha256: this.#head,
        kind,
        callId,
        tool,
        payload,
        payloadSha256: sha256Hex(payloadBytes),
      }
      const bytes = canonicalJsonBytesV1(record)
      if (kind === 'complete' && this.#pending.get(callId) !== tool)
        throw new WorkbenchAuditErrorV1(
          'workbench.audit.completion-invalid',
          'workbench audit completion has no matching begin'
        )
      const pendingCount = this.#pending.size + (kind === 'begin' ? 1 : -1)
      if (
        this.#sequence + 1 + pendingCount > this.#limits.maxRecords ||
        bytes.byteLength > this.#limits.maxRecordBytes ||
        this.#bytes +
          bytes.byteLength +
          pendingCount * this.#limits.maxRecordBytes >
          this.#limits.maxBytes
      )
        throw new WorkbenchAuditErrorV1(
          'workbench.audit.capacity-exhausted',
          'workbench audit capacity exhausted; no further call was admitted'
        )
      const recordSha256 = sha256Hex(bytes)
      const nextHead = canonicalJsonBytesV1({
        schemaVersion: 1,
        count: this.#sequence + 1,
        bytes: this.#bytes + bytes.byteLength,
        headSha256: recordSha256,
      })
      try
      {
        const entry = { kind, sequence: this.#sequence, callId, tool }
        await this.#beforePersistence?.({ phase: 'record', ...entry })
        await writeFile(
          join(
            this.directory,
            `${String(this.#sequence).padStart(6, '0')}.json`
          ),
          bytes,
          { flag: 'wx', mode: 0o600 }
        )
        await this.#beforePersistence?.({ phase: 'head', ...entry })
        await writeFile(join(this.directory, 'head.json'), nextHead, {
          mode: 0o600,
        })
      }
      catch (error)
      {
        throw new WorkbenchAuditErrorV1(
          'workbench.audit.persistence-failed',
          'workbench audit persistence failed; retained records require inspection',
          error
        )
      }
      this.#head = recordSha256
      this.#sequence++
      this.#bytes += bytes.byteLength
      if (kind === 'begin') this.#pending.set(callId, tool)
      else this.#pending.delete(callId)
      return {
        sequence: record.sequence,
        recordSha256,
        auditDirectory: this.directory,
      }
    })
    this.#queue = operation.catch((error: unknown) =>
    {
      if (
        error instanceof WorkbenchAuditErrorV1 &&
        error.code === 'workbench.audit.persistence-failed'
      )
        this.#failed = true
    })
    return operation
  }
}

async function boundedRead(path: string, maximum: number): Promise<Buffer>
{
  const file = await open(path, 'r')
  try
  {
    const bytes = Buffer.alloc(maximum + 1)
    let offset = 0
    while (offset < bytes.length)
    {
      const read = await file.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    if (offset > maximum) throw new Error('audit artifact exceeds its limit')
    return bytes.subarray(0, offset)
  }
  finally
  {
    await file.close()
  }
}

export async function verifyWorkbenchCallAuditV1(
  directory: string,
  expectedProfileSha256?: string
)
{
  const manifest = JSON.parse(
    (await boundedRead(join(directory, 'manifest.json'), 4096)).toString()
  ) as {
    schemaVersion: number
    kind: string
    profileSha256: string
    limits?: Partial<WorkbenchAuditLimitsV1>
  }
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'workbench-call-audit-v1' ||
    !/^[a-f0-9]{64}$/u.test(manifest.profileSha256) ||
    (expectedProfileSha256 !== undefined &&
      manifest.profileSha256 !== expectedProfileSha256)
  )
    throw new Error('audit profile identity differs')
  const limits = resolveLimits(manifest.limits)
  const headBytes = await boundedRead(join(directory, 'head.json'), 4096)
  const head = JSON.parse(headBytes.toString()) as {
    count: number
    bytes: number
    headSha256: string | null
  }
  if (
    !Number.isSafeInteger(head.count) ||
    head.count < 0 ||
    head.count > limits.maxRecords ||
    !Number.isSafeInteger(head.bytes) ||
    head.bytes < 0 ||
    head.bytes > limits.maxBytes
  )
    throw new Error('audit head is invalid')
  let previousSha256: string | null = null
  let totalBytes = 0
  const pending = new Map<string, string>()
  const tools: string[] = []
  let fileCount = 0
  for await (const entry of await opendir(directory))
  {
    fileCount++
    if (
      fileCount > limits.maxRecords + 2 ||
      !entry.isFile() ||
      (entry.name !== 'head.json' &&
        entry.name !== 'manifest.json' &&
        !/^\d{6}\.json$/u.test(entry.name))
    )
      throw new Error('audit contains an unexpected artifact')
  }
  if (fileCount !== head.count + 2)
    throw new Error('audit contains an unconfirmed tail')
  for (let sequence = 0; sequence < head.count; sequence++)
  {
    const bytes = await boundedRead(
      join(directory, `${String(sequence).padStart(6, '0')}.json`),
      limits.maxRecordBytes
    )
    totalBytes += bytes.byteLength
    if (
      bytes.byteLength > limits.maxRecordBytes ||
      totalBytes > limits.maxBytes
    )
      throw new Error('audit record exceeds its limit')
    const record = JSON.parse(bytes.toString()) as AuditRecordV1
    if (
      record.schemaVersion !== 1 ||
      record.sequence !== sequence ||
      record.previousSha256 !== previousSha256 ||
      record.payloadSha256 !==
        sha256Hex(canonicalJsonBytesV1(record.payload)) ||
      !Buffer.from(canonicalJsonBytesV1(record)).equals(bytes)
    )
      throw new Error(`audit divergence at record ${sequence}`)
    if (record.kind === 'begin')
    {
      if (pending.has(record.callId))
        throw new Error('audit call identity repeated')
      pending.set(record.callId, record.tool)
      tools.push(record.tool)
    }
    else if (record.kind === 'complete')
    {
      if (pending.get(record.callId) !== record.tool)
        throw new Error('audit completion has no matching begin')
      pending.delete(record.callId)
    }
    else throw new Error('audit record kind is invalid')
    previousSha256 = sha256Hex(bytes)
  }
  if (totalBytes !== head.bytes || previousSha256 !== head.headSha256)
    throw new Error('audit terminal identity differs')
  return {
    schemaVersion: 1,
    profileSha256: manifest.profileSha256,
    matched: pending.size === 0,
    records: head.count,
    calls: tools.length,
    tools,
    headSha256: previousSha256,
    incompleteCalls: [...pending.keys()],
    replayWrites: 0,
  }
}
