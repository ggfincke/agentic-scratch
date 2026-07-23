// packages/edit/src/replay/replay-run.ts
// replay every retained edit session in one run root w/ zero agent executions

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  createEditArtifactStoreHostAdapter,
  isPathWithinRootV1,
} from '@scratch-agent/eval'

import { replayEditSessionV1 } from '../index.js'
import type {
  BoundChangeContractV1,
  EditArtifactEntryV1,
  EditArtifactStorePort,
  ReplayEditSessionResultV1,
} from '../index.js'

interface SemanticEditReplayOptionsV1
{
  readonly runRoot: string
  readonly outRoot?: string
}

interface SemanticEditReplaySessionV1
{
  readonly sessionKey: string
  readonly sessionId: string
  readonly matched: boolean
  readonly state: ReplayEditSessionResultV1['state']
  readonly revisions: number
  readonly events: number
  readonly reports: number
  readonly certificates: number
  readonly exports: number
  readonly publishedSha256: string | null
  readonly exportReceiptSha256: string | null
  readonly reconstructedExternalObservations: number
  readonly reportComplete: boolean
  readonly semanticReportSha256: string
  readonly identities: SemanticEditReplayIdentitiesV1
  readonly failures: readonly string[]
}

interface SemanticEditReplayIdentitiesV1
{
  readonly revisionSha256s: readonly string[]
  readonly parentDeltaSha256s: readonly string[]
  readonly cumulativeDeltaSha256s: readonly string[]
  readonly preservationSha256s: readonly string[]
  readonly lineageSha256s: readonly string[]
  readonly certificateSha256s: readonly string[]
  readonly reportProjectionSha256s: readonly string[]
  readonly exportReceiptSha256s: readonly string[]
}

interface SemanticEditReplayReportV1
{
  readonly schemaVersion: 1
  readonly reportKind: 'semantic-edit-replay'
  readonly sourceRunId: string
  readonly runRoot: string
  readonly createdAt: string
  readonly completedAt: string
  readonly zeroAgentBasis: string
  readonly sessions: readonly SemanticEditReplaySessionV1[]
  readonly acceptance: {
    readonly passed: boolean
    readonly exactMatches: number
    readonly total: number
    readonly agentExecutions: number
    readonly storeWriteAttempts: number
    readonly reconstructedExternalObservations: number
  }
}

// ! replay never writes. Every mutating store method is refused & counted, so a
// ! run that tried to repair what it is verifying is observable, not assumed
class ReadOnlyReplayStoreV1 implements EditArtifactStorePort
{
  writeAttempts = 0

  constructor(private readonly inner: EditArtifactStorePort)
  {}

  #refuse(method: string): never
  {
    this.writeAttempts += 1
    throw new Error(`replay attempted to ${method} against a read-only run`)
  }

  async capability(): ReturnType<EditArtifactStorePort['capability']>
  {
    return this.inner.capability()
  }

  async createImmutable(): ReturnType<
    EditArtifactStorePort['createImmutable']
  >
  {
    this.#refuse('createImmutable')
  }

  async createOrVerifyImmutable(): ReturnType<
    EditArtifactStorePort['createOrVerifyImmutable']
  >
  {
    this.#refuse('createOrVerifyImmutable')
  }

  async readImmutable(key: string): Promise<Uint8Array>
  {
    return this.inner.readImmutable(key)
  }

  async hashImmutable(key: string): Promise<string>
  {
    return this.inner.hashImmutable(key)
  }

  async sizeImmutable(key: string): Promise<number>
  {
    return this.inner.sizeImmutable(key)
  }

  async listImmutable(prefix: string): Promise<readonly EditArtifactEntryV1[]>
  {
    return this.inner.listImmutable(prefix)
  }

  async compareAndSwapPointer(): ReturnType<
    EditArtifactStorePort['compareAndSwapPointer']
  >
  {
    this.#refuse('compareAndSwapPointer')
  }

  async reconcilePointer(): ReturnType<
    EditArtifactStorePort['reconcilePointer']
  >
  {
    this.#refuse('reconcilePointer')
  }

  async reserveQuota(): ReturnType<EditArtifactStorePort['reserveQuota']>
  {
    this.#refuse('reserveQuota')
  }

  async releaseQuota(): Promise<void>
  {
    this.#refuse('releaseQuota')
  }

  async settleQuota(): Promise<void>
  {
    this.#refuse('settleQuota')
  }

  async quotaOutcome(
    reservationId: string
  ): ReturnType<EditArtifactStorePort['quotaOutcome']>
  {
    return this.inner.quotaOutcome(reservationId)
  }

  async cleanupProvenTemp(): Promise<void>
  {
    this.#refuse('cleanupProvenTemp')
  }

  async removeEvictable(): Promise<boolean>
  {
    this.#refuse('removeEvictable')
  }
}

// the retained session keys, discovered from the store rather than supplied, so
// a run cannot hide a session by leaving it off a command line
async function retainedSessionKeysV1(
  store: EditArtifactStorePort
): Promise<readonly string[]>
{
  const entries = await store.listImmutable('sessions')
  const keys = entries
    .filter((entry) => /^sessions\/[^/]+\/session\.json$/u.test(entry.key))
    .map((entry) => entry.key.split('/')[1]!)
  return Object.freeze([...new Set(keys)].sort())
}

function decodeJson<T>(bytes: Uint8Array): T
{
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  ) as T
}

function object(value: unknown, label: string): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function sha256Field(value: unknown, field: string, label: string): string
{
  const selected = object(value, label)[field]
  if (typeof selected !== 'string' || !/^[0-9a-f]{64}$/u.test(selected))
    throw new Error(`${label} has no ${field} SHA-256`)
  return selected
}

async function retainedIdentitySetsV1(
  store: EditArtifactStorePort,
  sessionKey: string
): Promise<SemanticEditReplayIdentitiesV1>
{
  const prefix = `sessions/${sessionKey}`
  const unique = (values: readonly string[]): readonly string[] =>
    Object.freeze([...new Set(values)].sort())
  const revisionSha256s: string[] = []
  const parentDeltaSha256s: string[] = []
  const cumulativeDeltaSha256s: string[] = []
  const preservationSha256s: string[] = []
  const lineageSha256s: string[] = []
  for (const entry of await store.listImmutable(`${prefix}/revisions`))
  {
    if (!entry.key.endsWith('/manifest.json')) continue
    const manifest = object(
      decodeJson<unknown>(await store.readImmutable(entry.key)),
      `retained revision ${entry.key}`
    )
    const revision = object(manifest.revision, `revision ${entry.key}`)
    const projection = object(
      revision.hashProjection,
      `revision projection ${entry.key}`
    )
    revisionSha256s.push(
      sha256Field(revision, 'revisionId', `revision ${entry.key}`)
    )
    parentDeltaSha256s.push(
      sha256Field(
        projection,
        'parentChildDeltaSha256',
        `revision projection ${entry.key}`
      )
    )
    cumulativeDeltaSha256s.push(
      sha256Field(
        projection,
        'sourceHeadDeltaSha256',
        `revision projection ${entry.key}`
      )
    )
    preservationSha256s.push(
      sha256Field(
        projection,
        'preservationSha256',
        `revision projection ${entry.key}`
      )
    )
    lineageSha256s.push(
      sha256Field(
        projection,
        'activeLineageSnapshotSha256',
        `revision projection ${entry.key}`
      ),
      sha256Field(
        projection,
        'lineageHistoryLedgerSha256',
        `revision projection ${entry.key}`
      )
    )
  }
  const certificateSha256s: string[] = []
  for (const entry of await store.listImmutable(`${prefix}/evaluations`))
  {
    if (!entry.key.endsWith('/certificate.json')) continue
    const retained = object(
      decodeJson<unknown>(await store.readImmutable(entry.key)),
      `retained certificate ${entry.key}`
    )
    certificateSha256s.push(
      sha256Field(
        retained.certificate,
        'certificateSha256',
        `certificate ${entry.key}`
      )
    )
  }
  const reportProjectionSha256s: string[] = []
  for (const entry of await store.listImmutable(`${prefix}/reports`))
  {
    if (!entry.key.endsWith('/report.json')) continue
    reportProjectionSha256s.push(
      sha256Field(
        decodeJson<unknown>(await store.readImmutable(entry.key)),
        'semanticProjectionSha256',
        `report ${entry.key}`
      )
    )
  }
  const exportReceiptSha256s: string[] = []
  for (const entry of await store.listImmutable(`${prefix}/exports`))
  {
    if (!entry.key.endsWith('/semantic-receipt.json')) continue
    exportReceiptSha256s.push(
      sha256Field(
        decodeJson<unknown>(await store.readImmutable(entry.key)),
        'receiptSha256',
        `export receipt ${entry.key}`
      )
    )
  }
  return Object.freeze({
    revisionSha256s: unique(revisionSha256s),
    parentDeltaSha256s: unique(parentDeltaSha256s),
    cumulativeDeltaSha256s: unique(cumulativeDeltaSha256s),
    preservationSha256s: unique(preservationSha256s),
    lineageSha256s: unique(lineageSha256s),
    certificateSha256s: unique(certificateSha256s),
    reportProjectionSha256s: unique(reportProjectionSha256s),
    exportReceiptSha256s: unique(exportReceiptSha256s),
  })
}

export async function replaySemanticEditRunV1(
  options: SemanticEditReplayOptionsV1
): Promise<{
  report: SemanticEditReplayReportV1
  outRoot: string | null
}>
{
  const runRoot = resolve(options.runRoot)
  const outRoot = options.outRoot ? resolve(options.outRoot) : null
  if (outRoot !== null && isPathWithinRootV1(runRoot, outRoot))
    throw new Error('--out may not write inside the run root being replayed')
  const createdAt = new Date().toISOString()
  const host = createEditArtifactStoreHostAdapter(runRoot, {
    mode: 'read-only',
  })
  const capability = await host.capability()
  const guarded = new ReadOnlyReplayStoreV1(host)
  const sessionKeys = await retainedSessionKeysV1(guarded)
  const sessions: SemanticEditReplaySessionV1[] = []
  for (const sessionKey of sessionKeys)
  {
    // the retained bound contract is the run's own authority; a replay driven
    // from a run root has no other contract to compare it against, & replay
    // still rederives its artifact & semantic hashes from the manifest
    const boundChangeContract = decodeJson<BoundChangeContractV1>(
      await guarded.readImmutable(
        `sessions/${sessionKey}/authority/bound-change-contract.json`
      )
    )
    const result = await replayEditSessionV1({
      artifactStore: guarded,
      sessionKey,
      boundChangeContract,
    })
    const identities = await retainedIdentitySetsV1(guarded, sessionKey)
    sessions.push({
      sessionKey,
      sessionId: result.sessionId,
      matched: result.ok,
      state: result.state,
      revisions: result.verifiedRevisionCount,
      events: result.verifiedEventCount,
      reports: result.verifiedReportCount,
      certificates: result.verifiedCertificateCount,
      exports: result.verifiedExportCount,
      publishedSha256: result.publishedSha256,
      exportReceiptSha256: result.exportReceiptSha256,
      reconstructedExternalObservations:
        result.reconstructedExternalObservations,
      reportComplete: result.reportComplete,
      semanticReportSha256: result.semanticReportSha256,
      identities,
      failures: result.failures,
    })
  }
  const reconstructedExternalObservations = sessions.reduce(
    (total, session) => total + session.reconstructedExternalObservations,
    0
  )
  const report: SemanticEditReplayReportV1 = {
    schemaVersion: 1,
    reportKind: 'semantic-edit-replay',
    sourceRunId: capability.storeId,
    runRoot,
    createdAt,
    completedAt: new Date().toISOString(),
    zeroAgentBasis:
      'the replay API accepts no agent, provider or evaluation port; every certificate & export receipt is rebuilt from retained artifacts, & the store is opened read-only w/ every mutating method counted & refused',
    sessions: Object.freeze(sessions),
    acceptance: {
      passed:
        sessions.length > 0 &&
        sessions.every((session) => session.matched) &&
        guarded.writeAttempts === 0,
      exactMatches: sessions.filter((session) => session.matched).length,
      total: sessions.length,
      agentExecutions: 0,
      storeWriteAttempts: guarded.writeAttempts,
      reconstructedExternalObservations,
    },
  }
  if (outRoot !== null)
  {
    mkdirSync(outRoot, { recursive: true, mode: 0o700 })
    writeFileSync(
      join(outRoot, 'semantic-edit-replay.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: 'utf-8', flag: 'wx' }
    )
    writeFileSync(join(outRoot, 'semantic-edit-replay.md'), markdown(report), {
      encoding: 'utf-8',
      flag: 'wx',
    })
  }
  return { report, outRoot }
}

function markdown(report: SemanticEditReplayReportV1): string
{
  return [
    '# Semantic Edit Replay',
    '',
    `- source run: \`${report.sourceRunId}\``,
    `- run root: \`${report.runRoot}\``,
    `- exact matches: ${report.acceptance.exactMatches}/${report.acceptance.total}`,
    `- agent executions: ${report.acceptance.agentExecutions}`,
    `- store write attempts: ${report.acceptance.storeWriteAttempts}`,
    `- reconstructed external observations: ${report.acceptance.reconstructedExternalObservations}`,
    `- zero-agent basis: ${report.zeroAgentBasis}`,
    '',
    '## Sessions',
    '',
    ...report.sessions.flatMap((session) => [
      `- \`${session.sessionId}\`: ${session.matched ? 'exact' : 'FAILED'}, state \`${session.state}\`, ${session.revisions} revisions, ${session.certificates} certificates, ${session.exports} exports, report ${session.reportComplete ? 'complete' : 'INCOMPLETE'}`,
      ...session.failures.map((failure) => `  - ${failure}`),
    ]),
    '',
  ].join('\n')
}
