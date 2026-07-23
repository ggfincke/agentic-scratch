// packages/edit/src/session/retained-session-inventory.ts
// strictly replay closed durable sessions into read-only startup evidence

import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  scanStrictJson,
} from '@scratch-agent/sb3'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { editCanonicalBytesV1 } from '../support/canonical.js'
import type { BoundChangeContractV1 } from '../contracts/change-contracts.js'
import type {
  EditKernelSessionManifestV1,
  EditKernelStateV1,
} from '../contracts/kernel-types.js'
import { assertEditLogicalComponent, editSessionLayoutV1 } from './layout.js'
import type { EditArtifactStorePort } from '../transaction/ports.js'
import { verifyEditSessionReplayV1 } from '../replay/replay.js'
import type { EditSessionTerminalEvidenceV1 } from './session.js'
import { ProductionTransactionExecutorV1 } from '../transaction/production-transaction.js'

export const SESSION_MANIFEST_PATTERN = /^sessions\/([^/]+)\/session\.json$/u
const SESSION_ARTIFACT_PATTERN = /^sessions\/([^/]+)\/.+$/u
export const RETAINED_SESSION_JSON_LIMITS = Object.freeze({
  maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
  maxMembersPerContainer: DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
  maxNodes: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes,
})
const SESSION_MANIFEST_FIELDS = Object.freeze([
  'absoluteDeadlineEpochMs',
  'boundChangeContractArtifactSha256',
  'capabilityProfileArtifactSha256',
  'capabilityProfileSha256',
  'changeContractRegistrationArtifactSha256',
  'changeContractRegistrationId',
  'changeContractSha256',
  'idleDeadlineEpochMs',
  'invocationCorrelation',
  'openedAtEpochMs',
  'provenance',
  'schemaVersion',
  'semanticSourceIdentity',
  'semanticSourceSha256',
  'sessionId',
  'sessionKey',
  'sourceArtifactSha256',
  'sourceProvenanceEvidenceSha256',
  'state',
  'transactionResourceLimits',
])
const BOUND_CONTRACT_FIELDS = Object.freeze([
  'displayEvidenceByteLength',
  'effectiveLimits',
  'existingBindings',
  'registration',
  'registrationArtifactSha256',
  'registrationByteLength',
  'retainedPoliciesBySemanticSha256',
  'semanticContractByteLength',
  'source',
])
const PRE_MANIFEST_TOMBSTONE_FIELDS = Object.freeze([
  'abandonedAtEpochMs',
  'invocationCorrelation',
  'kind',
  'quotaDisposition',
  'retainedEntries',
  'schemaVersion',
  'sessionKey',
])

export interface RetainedEditSessionEvidenceV1
{
  readonly sessionKey: string
  readonly sessionId: string
  readonly state: Extract<
    EditKernelStateV1,
    'closed-abandoned' | 'closed-unexported' | 'closed-exported'
  >
  readonly head: Awaited<
    ReturnType<typeof verifyEditSessionReplayV1>
  >['finalHead']
  readonly eventHeadSha256: string
  readonly reportSha256: string
  readonly terminalEvidence: EditSessionTerminalEvidenceV1
}

export interface RetainedEditSessionInventoryV1
{
  readonly sessions: readonly RetainedEditSessionEvidenceV1[]
}

function refuse(message: string): never
{
  throw new Error(`retained edit-session inventory refused: ${message}`)
}

function exactObjectFields(
  value: unknown,
  fields: readonly string[],
  label: string
): asserts value is Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    refuse(`${label} is not an object`)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  )
    refuse(`${label} does not have its exact field set`)
}

export function parseRetainedSessionJsonV1<T>(
  bytes: Uint8Array,
  label: string
): T
{
  let value: unknown
  try
  {
    value = scanStrictJson(bytes, RETAINED_SESSION_JSON_LIMITS).value
  }
  catch (error)
  {
    refuse(
      `${label} is not strict bounded JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  const canonical = editCanonicalBytesV1(value)
  if (
    canonical.byteLength !== bytes.byteLength ||
    !canonical.every((byte, index) => byte === bytes[index])
  )
    refuse(`${label} is not canonically encoded`)
  return value as T
}

async function exactArtifactV1<T>(
  store: EditArtifactStorePort,
  key: string,
  expectedEntry: {
    readonly sha256: string
    readonly byteLength: number
  } | null,
  label: string
): Promise<{ readonly value: T; readonly sha256: string }>
{
  const bytes = await store.readImmutable(key)
  const actualSha256 = sha256Hex(bytes)
  const storedSha256 = await store.hashImmutable(key)
  const storedByteLength = await store.sizeImmutable(key)
  if (
    actualSha256 !== storedSha256 ||
    storedByteLength !== bytes.byteLength ||
    (expectedEntry !== null &&
      (expectedEntry.sha256 !== actualSha256 ||
        expectedEntry.byteLength !== bytes.byteLength))
  )
    refuse(`${label} bytes, hash, and retained metadata disagree`)
  return Object.freeze({
    value: parseRetainedSessionJsonV1<T>(bytes, label),
    sha256: actualSha256,
  })
}

function closedStateV1(
  state: Awaited<ReturnType<typeof verifyEditSessionReplayV1>>['state']
): RetainedEditSessionEvidenceV1['state']
{
  if (
    state !== 'closed-abandoned' &&
    state !== 'closed-unexported' &&
    state !== 'closed-exported'
  )
    return refuse(`prior session is ${state}, not terminally closed`)
  return state
}

export async function inventoryRetainedEditSessionsV1(input: {
  readonly artifactStore: EditArtifactStorePort
}): Promise<RetainedEditSessionInventoryV1>
{
  const entries = await input.artifactStore.listImmutable('sessions')
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]))
  const sessionArtifactKeys = new Map<string, string[]>()
  for (const entry of entries)
  {
    const match = SESSION_ARTIFACT_PATTERN.exec(entry.key)
    if (!match)
      return refuse(`noncanonical retained session artifact key ${entry.key}`)
    const sessionKey = assertEditLogicalComponent(match[1]!)
    const keys = sessionArtifactKeys.get(sessionKey) ?? []
    keys.push(entry.key)
    sessionArtifactKeys.set(sessionKey, keys)
  }
  const manifestEntries = entries.filter((entry) =>
    entry.key.endsWith('/session.json')
  )
  for (const [sessionKey, keys] of sessionArtifactKeys)
    if (!keys.includes(`sessions/${sessionKey}/session.json`))
    {
      const layout = editSessionLayoutV1(sessionKey)
      if (!keys.includes(layout.recoveryTombstone))
        return refuse(
          `session ${sessionKey} is a partial pre-manifest recovery-required prefix`
        )
      const retained = await exactArtifactV1<{
        schemaVersion: 1
        kind: 'edit-session-pre-manifest-abandoned-v1'
        sessionKey: string
        retainedEntries: readonly {
          key: string
          sha256: string
          byteLength: number
        }[]
        quotaDisposition: 'absent' | 'released'
        invocationCorrelation: unknown
        abandonedAtEpochMs: number
      }>(
        input.artifactStore,
        layout.recoveryTombstone,
        entryByKey.get(layout.recoveryTombstone) ?? null,
        `session ${sessionKey} pre-manifest tombstone`
      )
      exactObjectFields(
        retained.value,
        PRE_MANIFEST_TOMBSTONE_FIELDS,
        `session ${sessionKey} pre-manifest tombstone`
      )
      const actual = keys
        .filter((key) => key !== layout.recoveryTombstone)
        .map((key) => entryByKey.get(key)!)
        .sort((left, right) => left.key.localeCompare(right.key))
      if (
        retained.value.schemaVersion !== 1 ||
        retained.value.kind !== 'edit-session-pre-manifest-abandoned-v1' ||
        retained.value.sessionKey !== sessionKey ||
        retained.value.retainedEntries.length !== actual.length ||
        retained.value.retainedEntries.some(
          (entry, index) =>
            entry.key !== actual[index]!.key ||
            entry.sha256 !== actual[index]!.sha256 ||
            entry.byteLength !== actual[index]!.byteLength
        )
      )
        return refuse(
          `session ${sessionKey} pre-manifest tombstone inventory differs`
        )
    }
  const sessions: RetainedEditSessionEvidenceV1[] = []
  const sessionIds = new Set<string>()
  for (const entry of manifestEntries.sort((left, right) =>
    left.key.localeCompare(right.key)
  ))
  {
    const match = SESSION_MANIFEST_PATTERN.exec(entry.key)
    if (!match) return refuse(`noncanonical session manifest key ${entry.key}`)
    const sessionKey = assertEditLogicalComponent(match[1]!)
    const layout = editSessionLayoutV1(sessionKey)
    const retainedManifest = await exactArtifactV1<EditKernelSessionManifestV1>(
      input.artifactStore,
      layout.session,
      entry,
      `session ${sessionKey} manifest`
    )
    exactObjectFields(
      retainedManifest.value,
      SESSION_MANIFEST_FIELDS,
      `session ${sessionKey} manifest`
    )
    if (
      retainedManifest.value.schemaVersion !== 1 ||
      retainedManifest.value.sessionKey !== sessionKey ||
      typeof retainedManifest.value.sessionId !== 'string' ||
      retainedManifest.value.sessionId.length < 1 ||
      sessionIds.has(retainedManifest.value.sessionId)
    )
      return refuse(`session ${sessionKey} identity is invalid or duplicated`)
    sessionIds.add(retainedManifest.value.sessionId)
    const boundEntry = entryByKey.get(layout.boundChangeContract) ?? null
    const retainedBound = await exactArtifactV1<BoundChangeContractV1>(
      input.artifactStore,
      layout.boundChangeContract,
      boundEntry,
      `session ${sessionKey} bound change contract`
    )
    exactObjectFields(
      retainedBound.value,
      BOUND_CONTRACT_FIELDS,
      `session ${sessionKey} bound change contract`
    )
    if (
      retainedBound.sha256 !==
      retainedManifest.value.boundChangeContractArtifactSha256
    )
      return refuse(`session ${sessionKey} bound contract hash differs`)
    const replay = await verifyEditSessionReplayV1({
      artifactStore: input.artifactStore,
      sessionKey,
      boundChangeContract: retainedBound.value,
      transactionExecutor: new ProductionTransactionExecutorV1(),
    })
    if (!replay.ok)
      return refuse(
        `session ${sessionKey} replay failed: ${replay.failures.join('; ')}`
      )
    const state = closedStateV1(replay.state)
    if (!/^[0-9a-f]{64}$/u.test(replay.eventHeadSha256))
      return refuse(`session ${sessionKey} lacks an exact terminal event head`)
    sessions.push(
      Object.freeze({
        sessionKey,
        sessionId: replay.sessionId,
        state,
        head: replay.finalHead,
        eventHeadSha256: replay.eventHeadSha256,
        reportSha256: replay.semanticReportSha256,
        terminalEvidence: replay.terminalEvidence,
      })
    )
  }
  return Object.freeze({
    sessions: Object.freeze(
      sessions.sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId)
      )
    ),
  })
}
