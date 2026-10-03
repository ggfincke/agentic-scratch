// packages/mcp/src/transport/native-admission-budget.ts
// retain one locked native-run admission budget across both workbench profiles

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  NativeArtifactLockErrorV1,
  withNativeArtifactRootLeaseV1,
} from '@scratch-agent/eval'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { developmentProfileAuthoritySha256V1 } from '../development/tools.js'
import { EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1 } from '../edit/edit-host.js'
import { productionEditProfileAuthoritySha256V1 } from '../edit/edit-tools.js'
import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'
import { McpBoundaryError } from './errors.js'
import type { JsonlFrameAcceptanceV1 } from './jsonl-boundary.js'

export type NativeAdmissionProfileV1 = 'authoring-v1' | 'development-v1'

export interface NativeAdmissionBudgetManifestV1
{
  readonly schemaVersion: 1
  readonly kind: 'native-tool-admission-budget-v1'
  readonly runId: string
  readonly maxToolCalls: 64
  readonly startedAtUnixMs: number
  readonly workDeadlineUnixMs: number
  readonly hardDeadlineUnixMs: number
  readonly profiles: Readonly<Record<NativeAdmissionProfileV1, string>>
}

export interface NativeAdmissionBudgetReferenceV1
{
  readonly root: string
  readonly manifestSha256: string
}

export interface NativeToolAdmissionClaimV1
{
  readonly schemaVersion: 1
  readonly ordinal: number
  readonly runId: string
  readonly manifestSha256: string
  readonly profile: NativeAdmissionProfileV1
  readonly profileAuthoritySha256: string
  readonly serverInstanceId: string
  readonly callId: string
  readonly requestId: string | number | null
  readonly toolName: string | null
  readonly requestSha256: string
  readonly rawFrameSha256: string
  readonly rawFrameBytes: number
  readonly admittedAtUnixMs: number
  readonly request: Readonly<Record<string, unknown>>
}

interface NativeToolAdmissionCompletionV1
{
  readonly schemaVersion: 1
  readonly ordinal: number
  readonly claimSha256: string
  readonly callId: string
  readonly completedAtUnixMs: number
  readonly outcomeSha256: string
}

export interface NativeAdmissionBudgetVerificationV1
{
  readonly ok: boolean
  readonly issues: readonly string[]
  readonly manifest: NativeAdmissionBudgetManifestV1
  readonly admittedCount: number
  readonly completedCount: number
  readonly overflow: boolean
  readonly claims: readonly NativeToolAdmissionClaimV1[]
}

export interface NativeAdmissionDecisionV1
{
  readonly admitted: boolean
  readonly closed: boolean
  readonly code?: string
  readonly complete?: (outcome: unknown) => Promise<void>
}

const MANIFEST_FILE = 'manifest.json'
const FAILURE_FILE = 'failure.json'
const MAX_RECORD_BYTES = 256 * 1024
let profileIdentities: NativeAdmissionBudgetManifestV1['profiles'] | undefined

function profiles(): NativeAdmissionBudgetManifestV1['profiles']
{
  return (profileIdentities ??= Object.freeze({
    'authoring-v1': productionEditProfileAuthoritySha256V1(
      EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
      'standard-v2'
    ),
    'development-v1': developmentProfileAuthoritySha256V1(),
  }))
}

function invalid(message: string): never
{
  throw new McpBoundaryError('mcp.native-budget.invalid', message)
}

function recordName(kind: 'claim' | 'complete', ordinal: number): string
{
  return `${kind}-${String(ordinal).padStart(3, '0')}.json`
}

function syncDirectory(root: string): void
{
  const descriptor = openSync(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  try
  {
    fsyncSync(descriptor)
  }
  finally
  {
    closeSync(descriptor)
  }
}

function writeImmutable(root: string, name: string, value: unknown): void
{
  const bytes = canonicalJsonBytesV1(value)
  if (bytes.byteLength > MAX_RECORD_BYTES)
    invalid('native admission record exceeds its byte bound')
  const descriptor = openSync(
    join(root, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  )
  try
  {
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
  }
  finally
  {
    closeSync(descriptor)
  }
  syncDirectory(root)
}

function readRecord(root: string, name: string): unknown
{
  const descriptor = openSync(
    join(root, name),
    constants.O_RDONLY | constants.O_NOFOLLOW
  )
  try
  {
    const info = fstatSync(descriptor)
    if (!info.isFile() || info.size > MAX_RECORD_BYTES || info.nlink !== 1)
      invalid('native admission record is not a bounded private file')
    const bytes = readFileSync(descriptor)
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    if (!bytes.equals(canonicalJsonBytesV1(value)))
      invalid('native admission record is not canonical')
    return value
  }
  finally
  {
    closeSync(descriptor)
  }
}

function manifestFor(
  reference: NativeAdmissionBudgetReferenceV1
): NativeAdmissionBudgetManifestV1
{
  if (!LOWERCASE_SHA256_PATTERN.test(reference.manifestSha256))
    invalid('native admission manifest pin is invalid')
  const value = readRecord(
    reference.root,
    MANIFEST_FILE
  ) as NativeAdmissionBudgetManifestV1
  if (sha256Hex(canonicalJsonBytesV1(value)) !== reference.manifestSha256)
    invalid('native admission manifest differs from its pin')
  if (
    value.schemaVersion !== 1 ||
    value.kind !== 'native-tool-admission-budget-v1' ||
    typeof value.runId !== 'string' ||
    value.runId.length < 1 ||
    value.runId.length > 256 ||
    value.maxToolCalls !== 64 ||
    !Number.isSafeInteger(value.startedAtUnixMs) ||
    value.startedAtUnixMs < 0 ||
    !Number.isSafeInteger(value.workDeadlineUnixMs) ||
    !Number.isSafeInteger(value.hardDeadlineUnixMs) ||
    value.workDeadlineUnixMs <= value.startedAtUnixMs ||
    value.workDeadlineUnixMs > value.startedAtUnixMs + 285000 ||
    value.hardDeadlineUnixMs > value.startedAtUnixMs + 300000 ||
    value.hardDeadlineUnixMs - value.workDeadlineUnixMs < 15000 ||
    sha256Hex(canonicalJsonBytesV1(value.profiles)) !==
      sha256Hex(canonicalJsonBytesV1(profiles()))
  )
    invalid('native admission manifest identity or deadlines are invalid')
  Object.freeze(value.profiles)
  return Object.freeze(value)
}

async function lease<T>(root: string, operation: () => T): Promise<T>
{
  const deadline = Date.now() + 1000
  for (;;)
    try
    {
      return withNativeArtifactRootLeaseV1(root, operation)
    }
    catch (error)
    {
      if (
        !(error instanceof NativeArtifactLockErrorV1) ||
        error.code !== 'lock-busy' ||
        Date.now() >= deadline
      )
        throw error
      await delay(10)
    }
}

function entries(root: string): {
  count: number
  completed: number
  failed: boolean
}
{
  const names = readdirSync(root)
  if (
    names.length > 130 ||
    names.some(
      (name) =>
        name !== MANIFEST_FILE &&
        name !== FAILURE_FILE &&
        !/^(?:claim|complete)-0(?:0[1-9]|[1-5][0-9]|6[0-4])\.json$/u.test(name)
    )
  )
    invalid('native admission directory has unexpected entries')
  const count = names.filter((name) => name.startsWith('claim-')).length
  for (let ordinal = 1; ordinal <= count; ordinal += 1)
    if (!names.includes(recordName('claim', ordinal)))
      invalid('native admission claims are not consecutive')
  if (
    names.some(
      (name) =>
        name.startsWith('complete-') &&
        !names.includes(name.replace('complete-', 'claim-'))
    )
  )
    invalid('native admission completion has no claim')
  return {
    count,
    completed: names.filter((name) => name.startsWith('complete-')).length,
    failed: names.includes(FAILURE_FILE),
  }
}

function failure(
  root: string,
  reference: NativeAdmissionBudgetReferenceV1,
  reason: string,
  attempt?: unknown
): void
{
  if (readdirSync(root).includes(FAILURE_FILE)) return
  writeImmutable(root, FAILURE_FILE, {
    schemaVersion: 1,
    manifestSha256: reference.manifestSha256,
    reason,
    recordedAtUnixMs: Date.now(),
    attempt: attempt ?? null,
  })
}

function claimValid(
  claim: NativeToolAdmissionClaimV1,
  ordinal: number,
  reference: NativeAdmissionBudgetReferenceV1,
  manifest: NativeAdmissionBudgetManifestV1
): boolean
{
  const request = claim.request
  const params = request?.params as { name?: unknown } | undefined
  return (
    claim.schemaVersion === 1 &&
    claim.ordinal === ordinal &&
    claim.runId === manifest.runId &&
    claim.manifestSha256 === reference.manifestSha256 &&
    Object.hasOwn(manifest.profiles, claim.profile) &&
    claim.profileAuthoritySha256 === manifest.profiles[claim.profile] &&
    typeof claim.serverInstanceId === 'string' &&
    claim.serverInstanceId.length > 0 &&
    typeof claim.callId === 'string' &&
    claim.callId.length > 0 &&
    request !== null &&
    typeof request === 'object' &&
    request.method === 'tools/call' &&
    claim.requestId ===
      (typeof request.id === 'string' || typeof request.id === 'number'
        ? request.id
        : null) &&
    claim.toolName ===
      (typeof params?.name === 'string' ? params.name : null) &&
    claim.requestSha256 === sha256Hex(canonicalJsonBytesV1(request)) &&
    LOWERCASE_SHA256_PATTERN.test(claim.rawFrameSha256) &&
    Number.isSafeInteger(claim.rawFrameBytes) &&
    claim.rawFrameBytes > 0 &&
    claim.rawFrameBytes <= 128 * 1024 &&
    Number.isSafeInteger(claim.admittedAtUnixMs) &&
    claim.admittedAtUnixMs >= manifest.startedAtUnixMs &&
    claim.admittedAtUnixMs < manifest.workDeadlineUnixMs
  )
}

export async function createNativeAdmissionBudgetV1(input: {
  readonly root: string
  readonly runId: string
  readonly startedAtUnixMs: number
  readonly workDeadlineUnixMs: number
  readonly hardDeadlineUnixMs: number
}): Promise<
  NativeAdmissionBudgetReferenceV1 & {
    readonly manifest: NativeAdmissionBudgetManifestV1
  }
>
{
  if (!isAbsolute(input.root)) invalid('native admission root must be absolute')
  mkdirSync(input.root, { mode: 0o700 })
  syncDirectory(dirname(input.root))
  const root = realpathSync(input.root)
  const manifest: NativeAdmissionBudgetManifestV1 = Object.freeze({
    schemaVersion: 1,
    kind: 'native-tool-admission-budget-v1',
    runId: input.runId,
    maxToolCalls: 64,
    startedAtUnixMs: input.startedAtUnixMs,
    workDeadlineUnixMs: input.workDeadlineUnixMs,
    hardDeadlineUnixMs: input.hardDeadlineUnixMs,
    profiles: profiles(),
  })
  const reference = {
    root,
    manifestSha256: sha256Hex(canonicalJsonBytesV1(manifest)),
  }
  await lease(root, () =>
  {
    writeImmutable(root, MANIFEST_FILE, manifest)
    manifestFor(reference)
  })
  return Object.freeze({ ...reference, manifest })
}

export class NativeAdmissionBudgetV1
{
  readonly serverInstanceId = randomUUID()
  readonly #device: number
  readonly #inode: number
  #failed = false

  constructor(
    readonly reference: NativeAdmissionBudgetReferenceV1,
    readonly manifest: NativeAdmissionBudgetManifestV1,
    readonly profile: NativeAdmissionProfileV1
  )
  {
    const info = lstatSync(reference.root)
    this.#device = info.dev
    this.#inode = info.ino
  }

  get drainDeadlineUnixMs(): number
  {
    return Math.min(
      this.manifest.workDeadlineUnixMs + 2000,
      this.manifest.hardDeadlineUnixMs - 13000
    )
  }

  #assertRoot(): void
  {
    const info = lstatSync(this.reference.root)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.dev !== this.#device ||
      info.ino !== this.#inode
    )
      invalid('native admission root identity changed')
    manifestFor(this.reference)
  }

  async #locked<T>(operation: () => T): Promise<T>
  {
    try
    {
      return await lease(this.reference.root, () =>
      {
        this.#assertRoot()
        try
        {
          return operation()
        }
        catch (error)
        {
          try
          {
            failure(
              this.reference.root,
              this.reference,
              'persistence-or-record-failure'
            )
          }
          catch
          {
            // the failed operation remains terminal even when its marker cannot persist
          }
          throw error
        }
      })
    }
    catch (cause)
    {
      this.#failed = true
      throw new McpBoundaryError('mcp.native-budget.unavailable', String(cause))
    }
  }

  async intakeClosed(): Promise<boolean>
  {
    if (this.#failed) return true
    try
    {
      // observation can only close intake; every actual claim still takes the lease
      this.#assertRoot()
      const state = entries(this.reference.root)
      return (
        state.failed ||
        state.count === 64 ||
        Date.now() >= this.manifest.workDeadlineUnixMs
      )
    }
    catch (error)
    {
      this.#failed = true
      throw error
    }
  }

  async admit(
    frame: JsonlFrameAcceptanceV1
  ): Promise<NativeAdmissionDecisionV1>
  {
    if (this.#failed) invalid('native admission owner previously failed')
    const request = frame.value
    if (request.method !== 'tools/call')
      return { admitted: true, closed: false }
    return this.#locked(() =>
    {
      const state = entries(this.reference.root)
      const now = Date.now()
      const params = request.params as { name?: unknown } | undefined
      const attempt = {
        profile: this.profile,
        serverInstanceId: this.serverInstanceId,
        callId: randomUUID(),
        requestId:
          typeof request.id === 'string' || typeof request.id === 'number'
            ? request.id
            : null,
        toolName: typeof params?.name === 'string' ? params.name : null,
        requestSha256: sha256Hex(canonicalJsonBytesV1(request)),
        rawFrameSha256: frame.metadata.rawSha256,
        rawFrameBytes: frame.metadata.rawByteLength,
      }
      if (state.count === 64)
      {
        failure(this.reference.root, this.reference, 'overflow', attempt)
        return {
          admitted: false,
          closed: true,
          code: 'mcp.native-budget.exhausted',
        }
      }
      if (
        state.failed ||
        now >= this.manifest.workDeadlineUnixMs ||
        now < this.manifest.startedAtUnixMs
      )
      {
        failure(this.reference.root, this.reference, 'intake-closed', attempt)
        return {
          admitted: false,
          closed: true,
          code: 'mcp.native-budget.closed',
        }
      }
      for (let ordinal = 1; ordinal <= state.count; ordinal += 1)
        if (
          !claimValid(
            readRecord(
              this.reference.root,
              recordName('claim', ordinal)
            ) as NativeToolAdmissionClaimV1,
            ordinal,
            this.reference,
            this.manifest
          )
        )
          invalid('native admission claim changed')
      const claim: NativeToolAdmissionClaimV1 = Object.freeze({
        schemaVersion: 1,
        ordinal: state.count + 1,
        runId: this.manifest.runId,
        manifestSha256: this.reference.manifestSha256,
        profileAuthoritySha256: this.manifest.profiles[this.profile],
        ...attempt,
        admittedAtUnixMs: now,
        request: structuredClone(request),
      })
      if (!claimValid(claim, claim.ordinal, this.reference, this.manifest))
        invalid('native admission frame identity is invalid')
      writeImmutable(
        this.reference.root,
        recordName('claim', claim.ordinal),
        claim
      )
      return {
        admitted: true,
        closed: claim.ordinal === 64,
        complete: async (outcome: unknown): Promise<void> =>
        {
          await this.#locked(() =>
          {
            const retained = readRecord(
              this.reference.root,
              recordName('claim', claim.ordinal)
            )
            const claimSha256 = sha256Hex(canonicalJsonBytesV1(claim))
            if (sha256Hex(canonicalJsonBytesV1(retained)) !== claimSha256)
              invalid('native admission completion claim differs')
            writeImmutable(
              this.reference.root,
              recordName('complete', claim.ordinal),
              {
                schemaVersion: 1,
                ordinal: claim.ordinal,
                claimSha256,
                callId: claim.callId,
                completedAtUnixMs: Date.now(),
                outcomeSha256: sha256Hex(canonicalJsonBytesV1(outcome)),
              } satisfies NativeToolAdmissionCompletionV1
            )
          })
        },
      }
    })
  }
}

export async function openNativeAdmissionBudgetV1(
  input: NativeAdmissionBudgetReferenceV1 & {
    readonly profile: NativeAdmissionProfileV1
  }
): Promise<NativeAdmissionBudgetV1>
{
  if (!isAbsolute(input.root) || realpathSync(input.root) !== input.root)
    invalid('native admission root must be a canonical absolute directory')
  if (input.profile !== 'authoring-v1' && input.profile !== 'development-v1')
    invalid('native admission profile is invalid')
  const manifest = await lease(input.root, () => manifestFor(input))
  return new NativeAdmissionBudgetV1(
    { root: input.root, manifestSha256: input.manifestSha256 },
    manifest,
    input.profile
  )
}

export async function nativeAdmissionBudgetFromEnvironmentV1(
  environment: NodeJS.ProcessEnv,
  profile: NativeAdmissionProfileV1
): Promise<NativeAdmissionBudgetV1 | undefined>
{
  const root = environment.SCRATCH_AGENT_NATIVE_ADMISSION_ROOT
  const manifestSha256 =
    environment.SCRATCH_AGENT_NATIVE_ADMISSION_MANIFEST_SHA256
  if (root === undefined && manifestSha256 === undefined) return undefined
  if (!root || !manifestSha256)
    invalid('native admission root and manifest pin are both required')
  return openNativeAdmissionBudgetV1({ root, manifestSha256, profile })
}

export async function verifyNativeAdmissionBudgetV1(
  reference: NativeAdmissionBudgetReferenceV1
): Promise<NativeAdmissionBudgetVerificationV1>
{
  return lease(reference.root, () =>
  {
    const manifest = manifestFor(reference)
    const state = entries(reference.root)
    const issues: string[] = []
    const claims: NativeToolAdmissionClaimV1[] = []
    const callIds = new Set<string>()
    const names = new Set(readdirSync(reference.root))
    for (let ordinal = 1; ordinal <= state.count; ordinal += 1)
    {
      const claim = readRecord(
        reference.root,
        recordName('claim', ordinal)
      ) as NativeToolAdmissionClaimV1
      if (
        !claimValid(claim, ordinal, reference, manifest) ||
        callIds.has(claim.callId)
      )
        issues.push(`claim ${ordinal} is invalid`)
      callIds.add(claim.callId)
      claims.push(claim)
      if (!names.has(recordName('complete', ordinal)))
      {
        issues.push(`claim ${ordinal} has no completion`)
        continue
      }
      const completion = readRecord(
        reference.root,
        recordName('complete', ordinal)
      ) as NativeToolAdmissionCompletionV1
      if (
        completion.schemaVersion !== 1 ||
        completion.ordinal !== ordinal ||
        completion.callId !== claim.callId ||
        completion.claimSha256 !== sha256Hex(canonicalJsonBytesV1(claim)) ||
        !LOWERCASE_SHA256_PATTERN.test(completion.outcomeSha256) ||
        !Number.isSafeInteger(completion.completedAtUnixMs) ||
        completion.completedAtUnixMs < claim.admittedAtUnixMs ||
        completion.completedAtUnixMs > manifest.hardDeadlineUnixMs
      )
        issues.push(`completion ${ordinal} is invalid`)
    }
    const failed = state.failed
      ? (readRecord(reference.root, FAILURE_FILE) as { reason?: unknown })
      : null
    if (failed) issues.push(`native admission failed: ${String(failed.reason)}`)
    return Object.freeze({
      ok: issues.length === 0,
      issues: Object.freeze(issues),
      manifest,
      admittedCount: state.count,
      completedCount: state.completed,
      overflow: failed?.reason === 'overflow',
      claims: Object.freeze(claims),
    })
  })
}
