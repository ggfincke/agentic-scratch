// packages/edit/src/session/retained-session-recovery.ts
// exclusively terminalize replay-verified predecessor sessions without resuming them

import { join } from 'node:path'

import {
  parseEditToolInputV1,
  semanticHashV1,
  type EditToolName,
} from '@scratch-agent/ir/edit'
import { scanStrictJson } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type { BoundChangeContractV1 } from '../contracts/change-contracts.js'
import {
  admittedEditAssetV1,
  editAssetAdmissionEvidenceIdV1,
  type RetainedEditAssetRecordV1,
  type SessionAssetRecordV1,
} from '../assets/asset-admission.js'
import {
  editCanonicalBytesV1,
  editCanonicalSha256V1,
  editOpaqueIdV1,
  exactRevisionFromHeadV1,
} from '../support/canonical.js'
import type {
  EditKernelAttemptV1,
  EditKernelCheckpointV1,
  EditKernelReportV1,
  EditKernelRevisionRecordV1,
  EditKernelSemanticEventV1,
  EditKernelSessionManifestV1,
} from '../contracts/kernel-types.js'
import { assertEditLogicalComponent, editSessionLayoutV1 } from './layout.js'
import type {
  EditArtifactIdentityV1,
  EditArtifactStorePort,
  EditClockPort,
  EditPublicationDirectoryIdentityV1,
  EditPublicationRecoveryAuthorityV1,
  EditPublicationRecoveryPortV1,
  EditRetainedResourceCataloguePortV1,
  EditRetainedResourceMimeTypeV1,
  HostInvocationContextV1,
} from '../transaction/ports.js'
import { SYSTEM_EDIT_CLOCK } from '../transaction/ports.js'
import { ProductionTransactionExecutorV1 } from '../transaction/production-transaction.js'
import {
  retainedAssetDomainRecordFailureV1,
  retainedStatefulRequestBindingFailureV1,
} from './retained-request-authority.js'
import { assertFrozenRefusalResultV1 } from '../contracts/refusal-context.js'
import {
  editExportPreparedProofSha256V1,
  editExportProvenanceSha256V1,
  editSemanticExportReceiptSha256V1,
  EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
  isPreparedPublicationBoundV1,
  isPublicationCommitBoundV1,
  isPublicationInspectionBoundV1,
  isPublicationVerificationBoundV1,
  type EditExportProvenanceV1,
  type EditSemanticExportReceiptV1,
} from '../assets/publication.js'
import {
  certificateSetProjectionV1,
  type EditRetainedCertificateV1,
} from '../evaluation/evaluation-certificate.js'
import type {
  RetainedEditBeginAttemptAuthorityV1,
  RetainedEditBeginOutcomeAuthorityV1,
  RetainedEditBeginOpeningSessionV1,
  EditTransportOutcomeTargetV1,
} from './session.js'
import {
  inventoryRetainedEditSessionsV1,
  RETAINED_SESSION_JSON_LIMITS,
  SESSION_MANIFEST_PATTERN,
  type RetainedEditSessionInventoryV1,
} from './retained-session-inventory.js'
import { verifyEditSessionReplayV1 } from '../replay/replay.js'
import {
  buildAppliedRevisionV1,
  historyProjectionV1,
  semanticReportProjectionV1,
} from './revision.js'
import { sourceProvenanceEvidenceSha256V1 } from './source-intake.js'

interface RetainedPointerV1
{
  readonly schemaVersion: 1
  readonly reportJsonSha256: string
  readonly reportManifestSha256: string
}

interface RetainedAttemptIndexEntryV1
{
  readonly namespaceSha256: string
  readonly requestSha256: string
  readonly attemptSequence: number
  readonly state: EditKernelAttemptV1['state']
  readonly resultSha256?: string
  readonly refusalCode?: string
}

interface RetainedAttemptIndexV1
{
  readonly schemaVersion: 1
  readonly entries: readonly RetainedAttemptIndexEntryV1[]
}

interface RetainedPendingAttemptV1
{
  readonly schemaVersion: 1
  readonly attempt: EditKernelAttemptV1
  readonly request: unknown
  readonly transportRequest: unknown
  readonly invocationCorrelation: {
    readonly boundaryKind: 'directHost' | 'mcp'
    readonly invocationSha256: string
  }
}

export interface RecoveredRetainedEditAttemptV1
{
  readonly schemaVersion: 1
  readonly sessionId: string | null
  readonly sessionKey: string | null
  readonly session: RetainedEditBeginOpeningSessionV1
  readonly attemptId: string
  readonly attemptSequence: number
  readonly toolName: EditToolName
  readonly requestId: string
  readonly requestSha256: string
  readonly transportRequest: unknown
  readonly namespaceSha256: string
  readonly beginNamespaceSha256: string | null
  readonly registryAttemptSha256: string | null
  readonly invocationCorrelation: RetainedPendingAttemptV1['invocationCorrelation']
  readonly disposition: 'completed' | 'refused'
  readonly result: unknown
  readonly resultSha256: string
  readonly receiptFreeOutcome: unknown | null
  readonly preHead: EditKernelAttemptV1['preHead']
  readonly postHead: EditKernelAttemptV1['postHead']
  readonly budget: EditKernelReportV1['budget']
  readonly events: readonly {
    readonly eventSha256: string
    readonly sequence: number
  }[]
  readonly evidenceIds: readonly string[]
  readonly transportAuthority: EditTransportOutcomeTargetV1
}

interface RecoverRetainedEditSessionsResultV1 extends RetainedEditSessionInventoryV1
{
  readonly recoveredAttempts: readonly RecoveredRetainedEditAttemptV1[]
}

interface RetainedExportIntentV1
{
  readonly schemaVersion: 1
  readonly exportId: string
  readonly exportSha256: string
  readonly exportedRevision: {
    readonly revisionNumber: number
    readonly revisionId: string
    readonly candidateSha256: string
  }
  readonly outputReservationId: string
  readonly outputReservationSha256: string
  readonly auditRecordSha256: string
  readonly expectedFinalName: string
  readonly publicationRootId: string
  readonly publicationRootOwnershipSha256: string
  readonly publicationDirectory: EditPublicationDirectoryIdentityV1
  readonly recoveryAuthority: string
  readonly invocationCorrelation: RetainedPendingAttemptV1['invocationCorrelation']
  readonly deniedDestinationSetSha256: string
}

interface RetainedPreparedExportV1
{
  readonly schemaVersion: 1
  readonly exportId: string
  readonly preparedProofSha256: string
  readonly publicationRootId: string
  readonly publicationRootOwnershipSha256: string
  readonly tempBasename: string
  readonly candidateSha256: string
  readonly candidateByteLength: number
  readonly directoryCanonicalRealpath: string
  readonly tempDevice: string
  readonly tempInode: string
  readonly tempMode: string
  readonly directoryDevice: string
  readonly directoryInode: string
  readonly preparedAtEpochMs: number
}

interface PlannedImmutableV1
{
  readonly key: string
  readonly bytesHex: string
  readonly mimeType: EditRetainedResourceMimeTypeV1 | null
}

function plannedImmutableBytesHexV1(bytes: Uint8Array): string
{
  return Buffer.from(bytes).toString('hex')
}

function plannedImmutableBytesV1(artifact: PlannedImmutableV1): Uint8Array
{
  if (
    artifact.bytesHex.length % 2 !== 0 ||
    !/^[0-9a-f]*$/u.test(artifact.bytesHex)
  )
    return refuse('terminal recovery immutable bytes are not canonical hex')
  return new Uint8Array(Buffer.from(artifact.bytesHex, 'hex'))
}

function terminalReportArtifactsV1(
  layout: ReturnType<typeof editSessionLayoutV1>,
  report: EditKernelReportV1
): {
  readonly reportJsonSha256: string
  readonly reportManifestBytes: Uint8Array
  readonly reportPointerBytes: Uint8Array
  readonly immutables: readonly PlannedImmutableV1[]
}
{
  const reportBytes = canonicalJsonBytesV1(report)
  const reportJsonSha256 = sha256Hex(reportBytes)
  const reportManifestBytes = canonicalJsonBytesV1({
    schemaVersion: 1,
    reportJsonSha256,
    reportByteLength: reportBytes.byteLength,
    semanticProjectionSha256: report.semanticProjectionSha256,
  })
  const reportPointerBytes = canonicalJsonBytesV1({
    schemaVersion: 1,
    reportJsonSha256,
    reportManifestSha256: sha256Hex(reportManifestBytes),
  })
  return {
    reportJsonSha256,
    reportManifestBytes,
    reportPointerBytes,
    immutables: [
      {
        key: layout.report(reportJsonSha256, 'report.json'),
        bytesHex: plannedImmutableBytesHexV1(reportBytes),
        mimeType: 'application/json',
      },
      {
        key: layout.report(reportJsonSha256, 'semantic-projection.json'),
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1(report.semanticProjection)
        ),
        mimeType: 'application/json',
      },
      {
        key: layout.report(reportJsonSha256, 'report.md'),
        bytesHex: plannedImmutableBytesHexV1(
          new TextEncoder().encode(
            [
              '# Phase 8 Edit Session Report',
              '',
              `- state: ${report.state}`,
              `- revision count: ${report.revisionCount}`,
              `- semantic report: ${report.semanticProjectionSha256}`,
              `- event head: ${report.eventHeadSha256}`,
              '',
            ].join('\n')
          )
        ),
        mimeType: 'text/markdown; charset=utf-8',
      },
      {
        key: layout.report(reportJsonSha256, 'manifest.json'),
        bytesHex: plannedImmutableBytesHexV1(reportManifestBytes),
        mimeType: 'application/json',
      },
    ],
  }
}

interface RetainedTerminalPlanV1
{
  readonly schemaVersion: 1
  readonly kind: 'retained-edit-session-terminal-plan-v1'
  readonly sessionId: string
  readonly sessionKey: string
  readonly preReplayState:
    | 'interrupted'
    | 'recovery-required'
    | 'closed-abandoned'
    | 'closed-unexported'
    | 'closed-exported'
  readonly preEventHeadSha256: string
  readonly preSemanticReportSha256: string
  readonly artifactByteLimit: number
  readonly artifactBytesAfterRecovery: number
  readonly recoveryReservationId: string
  readonly recoveryReservedBytes: number
  readonly recoveryActualBytes: number
  readonly idempotencyPointerExpectedSha256: string
  readonly idempotencyPointerBytesHex: string
  readonly reportPointerExpectedSha256: string | null
  readonly reportPointerBytesHex: string | null
  readonly immutables: readonly PlannedImmutableV1[]
  readonly quotaSettlements: readonly {
    readonly reservationId: string
    readonly reservedBytes: number
    readonly actualBytes: number
  }[]
  readonly quotaReleases: readonly {
    readonly reservationId: string
    readonly reservedBytes: number
  }[]
  readonly evictions: readonly {
    readonly key: string
    readonly expectedSha256: string
  }[]
  readonly recoveredAttempts: readonly RecoveredRetainedEditAttemptV1[]
}

function mutableSessionPointerV1(
  layout: ReturnType<typeof editSessionLayoutV1>,
  key: string
): boolean
{
  return (
    key === layout.head ||
    key === layout.currentReport ||
    key === layout.idempotencyIndex ||
    key === layout.quotaState
  )
}

async function meteredTerminalPlanV1(
  input: RecoverRetainedEditSessionsInputV1,
  layout: ReturnType<typeof editSessionLayoutV1>,
  artifactByteLimit: number,
  evictions: RetainedTerminalPlanV1['evictions'],
  build: (
    artifactBytesAfterRecovery: number,
    recoveryReservationId: string,
    recoveryReservedBytes: number,
    recoveryActualBytes: number
  ) => RetainedTerminalPlanV1
): Promise<RetainedTerminalPlanV1>
{
  const retainedEntries = (
    await input.artifactStore.listImmutable(layout.prefix)
  ).filter((entry) => !mutableSessionPointerV1(layout, entry.key))
  const retainedByKey = new Map(
    retainedEntries.map((entry) => [entry.key, entry])
  )
  let retainedBytesAfterEvictions = retainedEntries.reduce(
    (total, entry) => total + entry.byteLength,
    0
  )
  for (const eviction of evictions)
  {
    const retained = retainedByKey.get(eviction.key)
    if (retained === undefined) continue
    if (retained.sha256 !== eviction.expectedSha256)
      return refuse('terminal recovery eviction identity differs')
    retainedBytesAfterEvictions -= retained.byteLength
  }
  const recoveryReservationId = editCanonicalSha256V1({
    schemaVersion: 1,
    sessionKey: layout.prefix,
    purpose: 'terminal-recovery',
  })
  const measure = (
    plan: RetainedTerminalPlanV1
  ): {
    readonly recoveryActualBytes: number
    readonly artifactBytes: number
  } =>
  {
    const plannedByKey = new Map<string, PlannedImmutableV1>()
    let missingImmutableBytes = 0
    for (const artifact of plan.immutables)
    {
      const previous = plannedByKey.get(artifact.key)
      if (previous !== undefined)
      {
        if (previous.bytesHex !== artifact.bytesHex)
          return refuse('terminal recovery plans conflicting immutable bytes')
        continue
      }
      plannedByKey.set(artifact.key, artifact)
      const artifactBytes = plannedImmutableBytesV1(artifact)
      const retained = retainedByKey.get(artifact.key)
      if (retained === undefined)
      {
        missingImmutableBytes += artifactBytes.byteLength
        continue
      }
      if (
        retained.byteLength !== artifactBytes.byteLength ||
        retained.sha256 !== sha256Hex(artifactBytes)
      )
        return refuse('terminal recovery immutable identity differs')
    }
    const planBytes = canonicalJsonBytesV1(plan)
    const recoveryActualBytes = missingImmutableBytes + planBytes.byteLength
    return Object.freeze({
      recoveryActualBytes,
      artifactBytes: retainedBytesAfterEvictions + recoveryActualBytes,
    })
  }
  const upperBound = measure(
    build(
      Number.MAX_SAFE_INTEGER,
      recoveryReservationId,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER
    )
  )
  const recoveryReservedBytes = upperBound.recoveryActualBytes
  const decimalWidth = (value: number): number => String(value).length
  const placeholder = (width: number): number =>
    width === 1 ? 0 : 10 ** (width - 1)
  for (let artifactWidth = 1; artifactWidth <= 16; artifactWidth += 1)
    for (let actualWidth = 1; actualWidth <= 16; actualWidth += 1)
    {
      const measured = measure(
        build(
          placeholder(artifactWidth),
          recoveryReservationId,
          recoveryReservedBytes,
          placeholder(actualWidth)
        )
      )
      if (
        decimalWidth(measured.artifactBytes) !== artifactWidth ||
        decimalWidth(measured.recoveryActualBytes) !== actualWidth
      )
        continue
      const plan = build(
        measured.artifactBytes,
        recoveryReservationId,
        recoveryReservedBytes,
        measured.recoveryActualBytes
      )
      const exact = measure(plan)
      if (
        exact.artifactBytes !== measured.artifactBytes ||
        exact.recoveryActualBytes !== measured.recoveryActualBytes ||
        exact.recoveryActualBytes > recoveryReservedBytes
      )
        return refuse('terminal recovery artifact measurement differs')
      if (exact.artifactBytes > artifactByteLimit)
        return refuse(
          `terminal recovery artifacts would reach ${exact.artifactBytes}, above the retained ceiling ${artifactByteLimit}`
        )
      return plan
    }
  return refuse('terminal recovery artifact measurement has no safe width')
}

interface RetainedBeginRecoveryAuthorityV1
{
  readonly schemaVersion: 1
  readonly kind: 'edit-session-begin-recovery-authority-v1'
  readonly sessionId: string
  readonly sessionKey: string
  readonly beginNamespaceSha256: string
  readonly reservationId: string
  readonly reservedBytes: number
  readonly sourceArtifactSha256: string
  readonly semanticSourceSha256: string
  readonly changeContractSha256: string
  readonly capabilityProfileSha256: string
}

interface RetainedInitialReportManifestV1
{
  readonly schemaVersion: 1
  readonly reportJsonSha256: string
  readonly reportByteLength: number
  readonly semanticProjectionSha256: string
}

interface RetainedPreManifestTombstoneV1
{
  readonly schemaVersion: 1
  readonly kind: 'edit-session-pre-manifest-abandoned-v1'
  readonly sessionKey: string
  readonly retainedEntries: readonly {
    readonly key: string
    readonly sha256: string
    readonly byteLength: number
  }[]
  readonly quotaDisposition: 'absent' | 'released'
  readonly invocationCorrelation: ReturnType<typeof invocationCorrelationV1>
  readonly abandonedAtEpochMs: number
}

interface PublicationRecoveryClassificationV1
{
  readonly attemptResult: unknown
  readonly attemptState: 'completed' | 'refused'
  readonly refusalCode?: 'edit.interrupted' | 'edit.publication_interference'
  readonly closePayload:
    | {
        readonly reason: 'post-publication-interference'
        readonly terminalState: 'closed-abandoned'
        readonly exportId: string
        readonly disposition:
          'committedCandidateUnattested' | 'unexpectedFinalIdentity'
        readonly interferenceEvidenceSha256: string
        readonly receiptIssued: false
      }
    | {
        readonly reason: 'export-published'
        readonly terminalState: 'closed-exported'
        readonly receiptSha256: string
        readonly publicationProofSha256: string
      }
    | null
  readonly artifacts: readonly {
    readonly key: string
    readonly value: unknown
  }[]
}

interface RecoveredAttemptOutcomeV1
{
  readonly state: 'completed' | 'refused'
  readonly result: unknown
  readonly refusalCode?: string
}

function assertRecoveredRefusalResultV1(
  outcome: RecoveredAttemptOutcomeV1
): void
{
  if (outcome.state === 'refused')
    assertFrozenRefusalResultV1(outcome.refusalCode, outcome.result)
}

function assertBeginOutcomeRefusalResultV1(
  outcome: RetainedEditBeginOutcomeAuthorityV1
): void
{
  if (outcome.disposition !== 'refused') return
  const code =
    outcome.result !== null && typeof outcome.result === 'object'
      ? (outcome.result as Record<string, unknown>)['code']
      : undefined
  assertFrozenRefusalResultV1(code, outcome.result)
}

interface RecoveredSameHeadAuthorityV1
{
  readonly outcome: RecoveredAttemptOutcomeV1
  readonly artifacts: readonly {
    readonly key: string
    readonly value: unknown
    readonly mimeType?: EditRetainedResourceMimeTypeV1 | null
  }[]
  readonly quotaSettlement?: RetainedTerminalPlanV1['quotaSettlements'][number]
  readonly quotaRelease?: RetainedTerminalPlanV1['quotaReleases'][number]
  readonly event?: EditKernelSemanticEventV1
}

function recoveredAttemptProjectionV1(input: {
  readonly sessionId: string
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly outcome: RecoveredAttemptOutcomeV1
  readonly budget: EditKernelReportV1['budget']
  readonly events: readonly EditKernelSemanticEventV1[]
  readonly receiptFreeOutcome?: unknown
}): RecoveredRetainedEditAttemptV1
{
  const evidenceIds = new Set<string>()
  let visitedEvidenceNodes = 0
  const visitEvidence = (value: unknown, depth: number): void =>
  {
    if (
      depth > 8 ||
      visitedEvidenceNodes >= 4096 ||
      value === null ||
      typeof value !== 'object'
    )
      return
    visitedEvidenceNodes += 1
    if (Array.isArray(value))
    {
      for (const item of value.slice(0, 256)) visitEvidence(item, depth + 1)
      return
    }
    for (const [key, child] of Object.entries(value))
    {
      if (
        (key === 'evidenceId' ||
          key === 'publicationEvidenceId' ||
          key === 'requestArtifactId') &&
        typeof child === 'string'
      )
        evidenceIds.add(child)
      else if (
        (key === 'evidenceIds' || key === 'requestArtifactIds') &&
        Array.isArray(child)
      )
        for (const id of child) if (typeof id === 'string') evidenceIds.add(id)
      visitEvidence(child, depth + 1)
      if (evidenceIds.size >= 256) return
    }
  }
  visitEvidence(input.outcome.result, 0)
  const expectedEventKinds = new Set<
    EditKernelSemanticEventV1['projection']['eventKind']
  >(
    input.pending.attempt.toolName === 'edit_asset_admit'
      ? ['asset-admitted']
      : input.pending.attempt.toolName === 'edit_preview'
        ? ['preview-recorded']
        : input.pending.attempt.toolName === 'edit_checkpoint'
          ? ['checkpoint-recorded']
          : input.pending.attempt.toolName === 'edit_apply' ||
              input.pending.attempt.toolName === 'edit_undo' ||
              input.pending.attempt.toolName === 'edit_rollback'
            ? [
                'transition-prepared',
                'transition-committed',
                'transition-aborted',
              ]
            : input.pending.attempt.toolName === 'edit_evaluate'
              ? ['evaluation-recorded']
              : input.pending.attempt.toolName === 'edit_export' ||
                  input.pending.attempt.toolName === 'edit_close'
                ? ['session-closed']
                : []
  )
  const recoveredEvents = Object.freeze(
    input.events
      .filter(
        (event) =>
          expectedEventKinds.has(event.projection.eventKind) &&
          event.projection.invocationCorrelation.invocationSha256 ===
            input.pending.invocationCorrelation.invocationSha256 &&
          event.projection.invocationCorrelation.boundaryKind ===
            input.pending.invocationCorrelation.boundaryKind
      )
      .sort(
        (left, right) => left.projection.sequence - right.projection.sequence
      )
      .map((event) =>
        Object.freeze({
          eventSha256: event.eventSha256,
          sequence: event.projection.sequence,
        })
      )
  )
  if (input.pending.attempt.preHead === null)
    return refuse('retained session attempt lacks its pre-head authority')
  const resultRecord =
    input.outcome.result !== null &&
    typeof input.outcome.result === 'object' &&
    !Array.isArray(input.outcome.result)
      ? (input.outcome.result as Record<string, unknown>)
      : null
  const changesHead =
    input.outcome.state === 'completed' &&
    (input.pending.attempt.toolName === 'edit_apply' ||
      input.pending.attempt.toolName === 'edit_undo' ||
      input.pending.attempt.toolName === 'edit_rollback')
  const postHead = changesHead
    ? (resultRecord?.['head'] as EditKernelAttemptV1['postHead'])
    : input.pending.attempt.preHead
  if (postHead === null || typeof postHead !== 'object')
    return refuse('retained session attempt lacks its exact post-head')
  const exactPostHeadSha256 = editCanonicalSha256V1(
    exactRevisionFromHeadV1(postHead)
  )
  const lastEvent = recoveredEvents.at(-1)
  const retainedLastEvent =
    lastEvent === undefined
      ? undefined
      : input.events.find(
          (event) => event.eventSha256 === lastEvent.eventSha256
        )
  if (
    (input.pending.attempt.postHead !== null &&
      editCanonicalSha256V1(input.pending.attempt.postHead) !==
        editCanonicalSha256V1(postHead)) ||
    (retainedLastEvent !== undefined &&
      editCanonicalSha256V1(retainedLastEvent.projection.postHead) !==
        exactPostHeadSha256) ||
    (!changesHead &&
      resultRecord?.['head'] !== undefined &&
      editCanonicalSha256V1(resultRecord['head']) !==
        editCanonicalSha256V1(postHead))
  )
    return refuse('retained session attempt post-head authority differs')
  return Object.freeze({
    schemaVersion: 1,
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    session: Object.freeze({
      state: 'present' as const,
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
    }),
    attemptId: input.pending.attempt.attemptId,
    attemptSequence: input.pending.attempt.sequence,
    toolName: input.pending.attempt.toolName as EditToolName,
    requestId: input.pending.attempt.requestId,
    requestSha256: input.pending.attempt.requestSha256,
    transportRequest: structuredClone(input.pending.transportRequest),
    namespaceSha256: input.pending.attempt.namespaceSha256,
    beginNamespaceSha256: null,
    registryAttemptSha256: null,
    invocationCorrelation: input.pending.invocationCorrelation,
    disposition: input.outcome.state,
    result: input.outcome.result,
    resultSha256: editCanonicalSha256V1(input.outcome.result),
    receiptFreeOutcome: input.receiptFreeOutcome ?? null,
    preHead: input.pending.attempt.preHead,
    postHead,
    budget: input.budget,
    events: recoveredEvents,
    evidenceIds: Object.freeze([...evidenceIds].sort()),
    transportAuthority: Object.freeze({
      kind: 'session' as const,
      sessionKey: input.sessionKey,
      toolName: input.pending.attempt.toolName as EditToolName,
      disposition: input.outcome.state,
      attemptId: input.pending.attempt.attemptId,
      attemptSequence: input.pending.attempt.sequence,
      requestId: input.pending.attempt.requestId,
      requestSha256: input.pending.attempt.requestSha256,
      sessionId: input.sessionId,
      namespaceSha256: input.pending.attempt.namespaceSha256,
      invocationCorrelation: structuredClone(
        input.pending.invocationCorrelation
      ),
    }),
  })
}

async function recoverAssetRetentionV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionId: string
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly events: readonly EditKernelSemanticEventV1[]
  readonly clock: EditClockPort
}): Promise<RecoveredSameHeadAuthorityV1 | null>
{
  if (input.pending.attempt.toolName !== 'edit_asset_admit') return null
  const layout = editSessionLayoutV1(input.sessionKey)
  const authorityKey = layout.attempt(
    input.pending.attempt.sequence,
    input.pending.attempt.requestSha256,
    'asset-retention-authority.json'
  )
  const attemptEntries = await input.store.listImmutable(
    authorityKey.replace(/\/asset-retention-authority\.json$/u, '')
  )
  if (!attemptEntries.some((entry) => entry.key === authorityKey)) return null
  const authority = await readJsonV1<Record<string, unknown>>(
    input.store,
    authorityKey,
    'asset retention recovery authority'
  )
  exactFieldsV1(
    authority,
    [
      'eventProjection',
      'eventSha256',
      'invocationCorrelation',
      'kind',
      'ledger',
      'namespaceSha256',
      'preBudget',
      'record',
      'requestSha256',
      'retainedRecord',
      'retentionPlan',
      'schemaVersion',
    ],
    'asset retention recovery authority'
  )
  const record = authority['record'] as Record<string, unknown>
  const retainedRecord = authority['retainedRecord']
  const retainedRecordProjection =
    retainedRecord !== null &&
    typeof retainedRecord === 'object' &&
    !Array.isArray(retainedRecord)
      ? (retainedRecord as Partial<RetainedEditAssetRecordV1>)
      : null
  const requestRecordFailure = retainedAssetDomainRecordFailureV1(
    input.pending.request,
    record as unknown as RetainedEditAssetRecordV1['record']
  )
  const plan = authority['retentionPlan'] as Record<string, unknown>
  const eventProjection = authority[
    'eventProjection'
  ] as EditKernelSemanticEventV1['projection']
  const payloadKey = plan['payloadKey']
  const recordKey = plan['recordKey']
  const reservationId = plan['reservationId']
  const reservedBytes = plan['reservedBytes']
  const payloadAlreadyRetained = plan['payloadAlreadyRetained']
  const recordAlreadyRetained = plan['recordAlreadyRetained']
  const eventSha256 = authority['eventSha256']
  const expectedReservationId = editCanonicalSha256V1({
    sessionId: input.sessionId,
    assetToken: record['assetToken'],
    purpose: 'asset-admit',
  })
  const assetEventPayload = Object.freeze({
    assetToken: record['assetToken'],
    mediaKind: record['mediaKind'],
    payloadSha256: record['payloadSha256'],
    metadataSha256: record['metadataSha256'],
    byteLength: record['byteLength'],
    dataFormat: (record['identity'] as Record<string, unknown>)['dataFormat'],
    payloadKey,
    recordKey,
  })
  if (
    authority['schemaVersion'] !== 1 ||
    authority['kind'] !== 'asset-admit-retention-authority-v1' ||
    authority['namespaceSha256'] !== input.pending.attempt.namespaceSha256 ||
    authority['requestSha256'] !== input.pending.attempt.requestSha256 ||
    retainedRecordProjection?.schemaVersion !== 1 ||
    editCanonicalSha256V1(retainedRecordProjection.record) !==
      editCanonicalSha256V1(record) ||
    requestRecordFailure !== null ||
    editCanonicalSha256V1(authority['invocationCorrelation']) !==
      editCanonicalSha256V1(input.pending.invocationCorrelation) ||
    typeof payloadKey !== 'string' ||
    typeof recordKey !== 'string' ||
    typeof reservationId !== 'string' ||
    !Number.isSafeInteger(reservedBytes) ||
    typeof payloadAlreadyRetained !== 'boolean' ||
    typeof recordAlreadyRetained !== 'boolean' ||
    payloadKey !== layout.assetPayload(String(record['payloadSha256'])) ||
    recordKey !== layout.assetRecord(String(record['assetToken'])) ||
    reservationId !== expectedReservationId ||
    eventProjection.eventKind !== 'asset-admitted' ||
    eventProjection.semanticPayloadSha256 !==
      editCanonicalSha256V1(assetEventPayload) ||
    eventProjection.invocationCorrelation.invocationSha256 !==
      input.pending.invocationCorrelation.invocationSha256 ||
    eventProjection.invocationCorrelation.boundaryKind !==
      input.pending.invocationCorrelation.boundaryKind ||
    semanticHashV1('semantic-event', eventProjection) !== eventSha256
  )
    return refuse('asset retention recovery authority differs')
  const payloadEntry = (
    await input.store.listImmutable(`${layout.prefix}/assets/payloads`)
  ).find((entry) => entry.key === payloadKey)
  const recordEntry = (
    await input.store.listImmutable(`${layout.prefix}/assets/records`)
  ).find((entry) => entry.key === recordKey)
  const recordBytes = canonicalJsonBytesV1(retainedRecord)
  const payloadByteLength = record['byteLength']
  if (
    !Number.isSafeInteger(payloadByteLength) ||
    (payloadByteLength as number) < 0 ||
    (payloadEntry !== undefined &&
      (payloadEntry.sha256 !== record['payloadSha256'] ||
        payloadEntry.byteLength !== payloadByteLength)) ||
    (recordEntry !== undefined &&
      (recordEntry.sha256 !== sha256Hex(recordBytes) ||
        recordEntry.byteLength !== recordBytes.byteLength)) ||
    (payloadAlreadyRetained && payloadEntry === undefined) ||
    (recordAlreadyRetained && recordEntry === undefined)
  )
    return refuse('asset retained bytes differ from their authority')
  const expectedReservedBytes =
    (payloadAlreadyRetained ? 0 : (payloadByteLength as number)) +
    (recordAlreadyRetained ? 0 : recordBytes.byteLength)
  if (reservedBytes !== expectedReservedBytes)
    return refuse('asset quota reservation differs from its authority')
  const quota = await input.store.quotaOutcome(reservationId)
  if (
    quota.state !== 'absent' &&
    (quota.reservedBytes !== reservedBytes ||
      (quota.state === 'released' && quota.actualBytes !== 0))
  )
    return refuse('asset quota outcome differs from its authority')
  if (quota.state === 'absent')
  {
    const deduplicatedCommit =
      payloadAlreadyRetained === true &&
      recordAlreadyRetained === true &&
      expectedReservedBytes === 0 &&
      payloadEntry !== undefined &&
      recordEntry !== undefined
    if (!deduplicatedCommit)
    {
      if (payloadAlreadyRetained !== true && payloadEntry !== undefined)
        return refuse(
          'asset payload appeared without reservation or deduplication authority'
        )
      return Object.freeze({
        outcome: Object.freeze({
          state: 'refused',
          refusalCode: 'edit.interrupted',
          result: Object.freeze({
            ok: false,
            code: 'edit.interrupted',
            safeMessage:
              'exclusive predecessor recovery abandoned asset admission before quota reservation',
            context: Object.freeze({}),
          }),
        }),
        artifacts: Object.freeze([]),
      })
    }
  }
  if (payloadEntry === undefined)
  {
    if (quota.state === 'active')
      return Object.freeze({
        outcome: Object.freeze({
          state: 'refused',
          refusalCode: 'edit.interrupted',
          result: Object.freeze({
            ok: false,
            code: 'edit.interrupted',
            safeMessage:
              'exclusive predecessor recovery released an asset reservation before payload commit',
            context: Object.freeze({}),
          }),
        }),
        artifacts: Object.freeze([]),
        quotaRelease: Object.freeze({
          reservationId,
          reservedBytes: reservedBytes as number,
        }),
      })
    if (quota.state === 'absent' || quota.state === 'released')
      return Object.freeze({
        outcome: Object.freeze({
          state: 'refused',
          refusalCode: 'edit.interrupted',
          result: Object.freeze({
            ok: false,
            code: 'edit.interrupted',
            safeMessage:
              'exclusive predecessor recovery abandoned an uncommitted asset admission',
            context: Object.freeze({}),
          }),
        }),
        artifacts: Object.freeze([]),
      })
    return refuse('asset payload is absent after quota settlement')
  }
  if (
    quota.state !== 'active' &&
    quota.state !== 'settled' &&
    !(quota.state === 'absent' && expectedReservedBytes === 0)
  )
    return refuse('asset payload has no recoverable quota reservation')
  const actualBytes = expectedReservedBytes
  if (quota.state === 'settled' && quota.actualBytes !== actualBytes)
    return refuse('asset settled quota differs from retained bytes')
  const retention = Object.freeze({
    payloadKey,
    recordKey,
    retainedBytes: actualBytes,
  })
  const preBudget = authority['preBudget'] as EditKernelReportV1['budget']
  const budget = Object.freeze({
    ...preBudget,
    artifactBytesUsed: preBudget.artifactBytesUsed + actualBytes,
  })
  const artifacts: {
    key: string
    value: unknown
    mimeType?: EditRetainedResourceMimeTypeV1 | null
  }[] = []
  if (recordEntry === undefined)
    artifacts.push({
      key: recordKey,
      value: retainedRecord,
      mimeType: 'application/json',
    })
  const event = input.events.find(
    (candidate) => candidate.eventSha256 === eventSha256
  )
  const expectedSequence = event?.projection.sequence ?? input.events.length
  const expectedPrevious =
    expectedSequence === 0
      ? undefined
      : input.events.find(
          (candidate) => candidate.projection.sequence === expectedSequence - 1
        )?.eventSha256
  if (
    eventProjection.sequence !== expectedSequence ||
    eventProjection.previousEventSha256 !== expectedPrevious
  )
    return refuse('asset recovery event position differs')
  const recoveredEvent: EditKernelSemanticEventV1 =
    event ??
    Object.freeze({
      projection: eventProjection,
      eventSha256: String(eventSha256),
      hostTimestampEpochMs: input.clock.nowEpochMs(),
    })
  if (event === undefined)
    artifacts.push({
      key: layout.event(eventProjection.sequence, String(eventSha256)),
      value: recoveredEvent,
      mimeType: 'application/json',
    })
  artifacts.push({
    key: layout.attempt(
      input.pending.attempt.sequence,
      input.pending.attempt.requestSha256,
      'recovery-authority.json'
    ),
    value: Object.freeze({
      schemaVersion: 1,
      kind: 'asset-admit-recovery-authority-v1',
      namespaceSha256: input.pending.attempt.namespaceSha256,
      requestSha256: input.pending.attempt.requestSha256,
      invocationCorrelation: input.pending.invocationCorrelation,
      record,
      retention,
      ledger: authority['ledger'],
      budget,
    }),
  })
  return Object.freeze({
    outcome: Object.freeze({
      state: 'completed',
      result: Object.freeze({
        assetToken: record['assetToken'],
        admissionEvidenceId: editAssetAdmissionEvidenceIdV1({
          sessionId: input.sessionId,
          eventSha256: String(eventSha256),
          record: record as unknown as SessionAssetRecordV1,
        }),
        mediaKind: record['mediaKind'],
        payloadSha256: record['payloadSha256'],
        metadataSha256: record['metadataSha256'],
        byteLength: record['byteLength'],
        dataFormat: (record['identity'] as Record<string, unknown>)[
          'dataFormat'
        ],
        payloadKey,
        recordKey,
        ledger: authority['ledger'],
        budget,
        eventSha256,
      }),
    }),
    artifacts: Object.freeze(artifacts),
    ...(quota.state === 'absent'
      ? {}
      : {
          quotaSettlement: Object.freeze({
            reservationId,
            reservedBytes: reservedBytes as number,
            actualBytes,
          }),
        }),
    event: recoveredEvent,
  })
}

async function rederiveRetainedPreviewV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionId: string
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly contract: BoundChangeContractV1
}): Promise<{
  readonly transaction: Awaited<
    ReturnType<ProductionTransactionExecutorV1['execute']>
  >
  readonly predicted: EditKernelRevisionRecordV1
}>
{
  if (
    input.pending.attempt.toolName !== 'edit_preview' ||
    input.pending.attempt.preHead === null
  )
    return refuse('preview rederivation lacks its pending head authority')
  const layout = editSessionLayoutV1(input.sessionKey)
  const manifest = await readJsonV1<EditKernelSessionManifestV1>(
    input.store,
    layout.session,
    `session ${input.sessionKey} preview manifest`
  )
  const revisionEntries = (
    await input.store.listImmutable(`${layout.prefix}/revisions`)
  ).filter((entry) => entry.key.endsWith('/manifest.json'))
  const revisions = await Promise.all(
    revisionEntries.map((entry) =>
      readJsonV1<EditKernelRevisionRecordV1>(
        input.store,
        entry.key,
        `session ${input.sessionKey} preview revision`
      )
    )
  )
  revisions.sort(
    (left, right) => left.head.revisionNumber - right.head.revisionNumber
  )
  const current = revisions.find(
    (revision) =>
      revision.head.revisionNumber ===
        input.pending.attempt.preHead!.revisionNumber &&
      revision.head.revisionId === input.pending.attempt.preHead!.revisionId
  )
  if (current === undefined)
    return refuse('preview rederivation cannot locate its retained head')
  const accepted = revisions.filter(
    (revision) => revision.head.revisionNumber <= current.head.revisionNumber
  )
  const assets = new Map<string, ReturnType<typeof admittedEditAssetV1>>()
  const assetRecordEntries = await input.store.listImmutable(
    `${layout.prefix}/assets/records`
  )
  for (const entry of assetRecordEntries)
  {
    const retained = await readJsonV1<RetainedEditAssetRecordV1>(
      input.store,
      entry.key,
      `session ${input.sessionKey} preview asset record`
    )
    const payload = await input.store.readImmutable(
      layout.assetPayload(retained.record.payloadSha256)
    )
    if (assets.has(retained.record.assetToken))
      return refuse('preview rederivation repeats one admitted asset')
    assets.set(
      retained.record.assetToken,
      admittedEditAssetV1(retained.record, payload)
    )
  }
  const transaction = await new ProductionTransactionExecutorV1().execute({
    sessionId: input.sessionId,
    sourceBytes: await input.store.readImmutable(layout.sourceInput),
    currentBytes: await input.store.readImmutable(current.candidateKey),
    semanticSourceSha256: manifest.semanticSourceSha256,
    sourceArtifactSha256: manifest.sourceArtifactSha256,
    currentHead: input.pending.attempt.preHead,
    currentRevision: current,
    acceptedHistorySha256: historyProjectionV1(
      manifest.semanticSourceSha256,
      accepted
    ).sha256,
    changeContractSha256: manifest.changeContractSha256,
    changeContract: input.contract.registration.semanticContract,
    resourceLimits: manifest.transactionResourceLimits,
    canonicalTransaction: (
      input.pending.request as { readonly canonicalTransaction?: unknown }
    ).canonicalTransaction,
    resolveAdmittedAsset: (assetToken) => assets.get(assetToken) ?? null,
    verifyHandle: () => true,
  })
  const predicted = buildAppliedRevisionV1(
    {
      semanticSourceSha256: manifest.semanticSourceSha256,
      sourceArtifactSha256: manifest.sourceArtifactSha256,
      changeContractSha256: manifest.changeContractSha256,
      capabilityProfileSha256: manifest.capabilityProfileSha256,
      capabilitySnapshotSha256:
        input.pending.attempt.preHead.capabilitySnapshotSha256,
      originatingRequestId: input.pending.attempt.requestId,
      invocationCorrelation: input.pending.invocationCorrelation,
      hostTimestampEpochMs: 0,
    },
    current,
    transaction,
    '',
    '',
    transaction.candidateProjectJsonSha256,
    transaction.candidateAssetManifestSha256
  )
  return Object.freeze({ transaction, predicted })
}

async function retainedSameHeadAuthorityV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionId: string
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly events: readonly EditKernelSemanticEventV1[]
  readonly clock: EditClockPort
  readonly contract: BoundChangeContractV1
  readonly preBudget: EditKernelReportV1['budget']
}): Promise<RecoveredSameHeadAuthorityV1 | null>
{
  const tool = input.pending.attempt.toolName
  if (
    tool !== 'edit_asset_admit' &&
    tool !== 'edit_preview' &&
    tool !== 'edit_checkpoint'
  )
    return null
  const retainedAsset = await recoverAssetRetentionV1(input)
  if (retainedAsset !== null) return retainedAsset
  const layout = editSessionLayoutV1(input.sessionKey)
  const key = layout.attempt(
    input.pending.attempt.sequence,
    input.pending.attempt.requestSha256,
    'recovery-authority.json'
  )
  const present = (
    await input.store.listImmutable(
      key.replace(/\/recovery-authority\.json$/u, '')
    )
  ).some((entry) => entry.key === key)
  if (!present) return null
  const authority = await readJsonV1<Record<string, unknown>>(
    input.store,
    key,
    `session ${input.sessionKey} same-head recovery authority`
  )
  const commonMatches =
    authority['schemaVersion'] === 1 &&
    authority['namespaceSha256'] === input.pending.attempt.namespaceSha256 &&
    authority['requestSha256'] === input.pending.attempt.requestSha256 &&
    editCanonicalSha256V1(authority['invocationCorrelation']) ===
      editCanonicalSha256V1(input.pending.invocationCorrelation)
  if (!commonMatches)
    return refuse(`session ${input.sessionKey} same-head authority differs`)
  const expectedEventKind =
    tool === 'edit_asset_admit'
      ? 'asset-admitted'
      : tool === 'edit_preview'
        ? 'preview-recorded'
        : 'checkpoint-recorded'
  const events = input.events.filter(
    (event) =>
      event.projection.eventKind === expectedEventKind &&
      event.projection.invocationCorrelation.invocationSha256 ===
        input.pending.invocationCorrelation.invocationSha256
  )
  if (events.length === 0) return null
  if (events.length !== 1)
    return refuse(`session ${input.sessionKey} same-head event is ambiguous`)
  const event = events[0]!
  if (tool === 'edit_asset_admit')
  {
    exactFieldsV1(
      authority,
      [
        'budget',
        'invocationCorrelation',
        'kind',
        'ledger',
        'namespaceSha256',
        'record',
        'requestSha256',
        'retention',
        'schemaVersion',
      ],
      `session ${input.sessionKey} asset recovery authority`
    )
    if (authority['kind'] !== 'asset-admit-recovery-authority-v1')
      return refuse(`session ${input.sessionKey} asset authority kind differs`)
    const record = authority['record'] as Record<string, unknown>
    const retention = authority['retention'] as Record<string, unknown>
    const payload = await input.store.readImmutable(
      String(retention['payloadKey'])
    )
    const retainedRecord = await readJsonV1<{
      record: unknown
      schemaVersion: 1
    }>(
      input.store,
      String(retention['recordKey']),
      `session ${input.sessionKey} admitted asset record`
    )
    const payloadProjection = {
      assetToken: record['assetToken'],
      mediaKind: record['mediaKind'],
      payloadSha256: record['payloadSha256'],
      metadataSha256: record['metadataSha256'],
      byteLength: record['byteLength'],
      dataFormat: (record['identity'] as Record<string, unknown>)['dataFormat'],
      payloadKey: retention['payloadKey'],
      recordKey: retention['recordKey'],
    }
    if (
      sha256Hex(payload) !== record['payloadSha256'] ||
      editCanonicalSha256V1(retainedRecord.record) !==
        editCanonicalSha256V1(record) ||
      event.projection.semanticPayloadSha256 !==
        editCanonicalSha256V1(payloadProjection)
    )
      return refuse(
        `session ${input.sessionKey} asset authority does not reconstruct`
      )
    return Object.freeze({
      outcome: Object.freeze({
        state: 'completed',
        result: Object.freeze({
          ...payloadProjection,
          admissionEvidenceId: editAssetAdmissionEvidenceIdV1({
            sessionId: input.sessionId,
            eventSha256: event.eventSha256,
            record: record as unknown as SessionAssetRecordV1,
          }),
          ledger: authority['ledger'],
          budget: authority['budget'],
          eventSha256: event.eventSha256,
        }),
      }),
      artifacts: Object.freeze([]),
    })
  }
  if (tool === 'edit_preview')
  {
    exactFieldsV1(
      authority,
      [
        'budget',
        'invocationCorrelation',
        'kind',
        'namespaceSha256',
        'preview',
        'requestSha256',
        'schemaVersion',
      ],
      `session ${input.sessionKey} preview recovery authority`
    )
    if (authority['kind'] !== 'preview-recovery-authority-v1')
      return refuse(
        `session ${input.sessionKey} preview authority kind differs`
      )
    const preview = authority['preview'] as Record<string, unknown>
    exactFieldsV1(
      preview,
      [
        'activeLineageSha256',
        'allocatorSha256',
        'applyGuardSha256',
        'authorizationSha256',
        'candidateCacheKey',
        'canonicalTransaction',
        'capabilitySnapshotSha256',
        'createdSequence',
        'cumulativeDeltaSha256',
        'deltaSha256',
        'diagnosticsSha256',
        'expectedHead',
        'lineageHistorySha256',
        'operationCount',
        'operationResultLineageCorrespondenceSha256',
        'operationResultSetSha256',
        'operationResultSummaries',
        'operationResults',
        'predictedAssetManifestSha256',
        'predictedCandidateByteLength',
        'predictedCandidateSha256',
        'predictedProjectJsonSha256',
        'preservationSha256',
        'previewId',
        'requestId',
        'requestSha256',
        'resolvedPlanSha256',
        'resolvedSemanticBatchSha256',
        'state',
      ],
      `session ${input.sessionKey} retained preview`
    )
    const rederived = await rederiveRetainedPreviewV1({
      store: input.store,
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      pending: input.pending,
      contract: input.contract,
    })
    const candidate = await input.store.readImmutable(
      String(preview['candidateCacheKey'])
    )
    const payload = {
      previewId: preview['previewId'],
      requestSha256: preview['requestSha256'],
      predictedCandidateSha256: preview['predictedCandidateSha256'],
      resolvedPlanSha256: preview['resolvedPlanSha256'],
      operationResultSetSha256: preview['operationResultSetSha256'],
      applyGuardSha256: preview['applyGuardSha256'],
    }
    const request = input.pending.request as {
      readonly canonicalTransaction?: unknown
      readonly expectedHead?: unknown
    }
    const expectedApplyGuardSha256 = editCanonicalSha256V1({
      requestSha256: editCanonicalSha256V1(request.canonicalTransaction),
      expectedHead: request.expectedHead,
      predictedRevisionId: rederived.predicted.head.revisionId,
      predictedCandidateSha256: rederived.predicted.head.candidateSha256,
      resolvedPlanSha256: rederived.transaction.resolvedPlanSha256,
    })
    const expectedPreviewProjection = {
      requestId: input.pending.attempt.requestId,
      requestSha256: editCanonicalSha256V1(request.canonicalTransaction),
      expectedHead: input.pending.attempt.preHead,
      capabilitySnapshotSha256:
        input.pending.attempt.preHead!.capabilitySnapshotSha256,
      canonicalTransaction: request.canonicalTransaction,
      operationCount: rederived.transaction.operationCount,
      predictedCandidateSha256: rederived.predicted.head.candidateSha256,
      predictedCandidateByteLength:
        rederived.transaction.candidateBytes.byteLength,
      predictedProjectJsonSha256: rederived.predicted.projectJsonSha256,
      predictedAssetManifestSha256:
        rederived.predicted.head.assetManifestSha256,
      resolvedSemanticBatchSha256:
        rederived.transaction.resolvedSemanticBatchSha256,
      resolvedPlanSha256: rederived.transaction.resolvedPlanSha256,
      deltaSha256:
        rederived.predicted.revision.hashProjection.parentChildDeltaSha256,
      cumulativeDeltaSha256:
        rederived.predicted.revision.hashProjection.sourceHeadDeltaSha256,
      preservationSha256:
        rederived.predicted.revision.hashProjection.preservationSha256,
      authorizationSha256:
        rederived.predicted.revision.hashProjection.authorizationSha256,
      diagnosticsSha256:
        rederived.predicted.revision.hashProjection.diagnosticSha256,
      allocatorSha256:
        rederived.predicted.revision.hashProjection
          .allocatorReservationStateSha256,
      activeLineageSha256:
        rederived.predicted.revision.hashProjection.activeLineageSnapshotSha256,
      lineageHistorySha256:
        rederived.predicted.revision.hashProjection.lineageHistoryLedgerSha256,
      operationResultSetSha256:
        rederived.predicted.revision.hashProjection.operationResultSetSha256,
      operationResultLineageCorrespondenceSha256:
        rederived.transaction.operationResultLineageCorrespondenceSha256,
      applyGuardSha256: expectedApplyGuardSha256,
      operationResults: rederived.transaction.operationResults,
      operationResultSummaries: rederived.transaction.operationResultSummaries,
      candidateCacheKey: layout.preview(
        rederived.predicted.head.candidateSha256
      ),
      state: 'unapplied',
    }
    const retainedProjection = Object.fromEntries(
      Object.keys(expectedPreviewProjection).map((key) => [key, preview[key]])
    )
    const budget = authority['budget'] as EditKernelReportV1['budget']
    const budgetWithoutPreviewCount = {
      ...budget,
      retainedPreviews: input.preBudget.retainedPreviews,
    }
    if (
      !Number.isSafeInteger(preview['createdSequence']) ||
      (preview['createdSequence'] as number) < 0 ||
      typeof preview['previewId'] !== 'string' ||
      editCanonicalSha256V1(retainedProjection) !==
        editCanonicalSha256V1(expectedPreviewProjection) ||
      !Number.isSafeInteger(budget.retainedPreviews) ||
      budget.retainedPreviews < 1 ||
      editCanonicalSha256V1(budgetWithoutPreviewCount) !==
        editCanonicalSha256V1(input.preBudget) ||
      sha256Hex(candidate) !== preview['predictedCandidateSha256'] ||
      candidate.byteLength !== preview['predictedCandidateByteLength'] ||
      sha256Hex(rederived.transaction.candidateBytes) !==
        sha256Hex(candidate) ||
      event.projection.semanticPayloadSha256 !== editCanonicalSha256V1(payload)
    )
      return refuse(
        `session ${input.sessionKey} preview authority does not reconstruct`
      )
    return Object.freeze({
      outcome: Object.freeze({
        state: 'completed',
        result: Object.freeze({
          preview,
          budget,
          eventSha256: event.eventSha256,
        }),
      }),
      artifacts: Object.freeze([]),
    })
  }
  const optionalNote = Object.hasOwn(authority, 'note')
  exactFieldsV1(
    authority,
    [
      'checkpointId',
      'invocationCorrelation',
      'kind',
      'label',
      'namespaceSha256',
      ...(optionalNote ? ['note'] : []),
      'requestSha256',
      'revision',
      'schemaVersion',
    ],
    `session ${input.sessionKey} checkpoint recovery authority`
  )
  if (authority['kind'] !== 'checkpoint-recovery-authority-v1')
    return refuse(
      `session ${input.sessionKey} checkpoint authority kind differs`
    )
  const projection = {
    schemaVersion: 1,
    checkpointId: authority['checkpointId'],
    label: authority['label'],
    ...(optionalNote ? { note: authority['note'] } : {}),
    revision: authority['revision'],
    eventSha256: event.eventSha256,
  }
  if (
    event.projection.semanticPayloadSha256 !==
    editCanonicalSha256V1({
      checkpointId: authority['checkpointId'],
      label: authority['label'],
      ...(optionalNote ? { note: authority['note'] } : {}),
      revision: authority['revision'],
    })
  )
    return refuse(`session ${input.sessionKey} checkpoint event differs`)
  const checkpoint = Object.freeze({
    ...projection,
    checkpointSha256: editCanonicalSha256V1(projection),
  })
  const checkpointEntries = await input.store.listImmutable(
    `${layout.prefix}/checkpoints`
  )
  const retainedCheckpoint = checkpointEntries.find(
    (entry) => entry.sha256 === sha256Hex(canonicalJsonBytesV1(checkpoint))
  )
  return Object.freeze({
    outcome: Object.freeze({ state: 'completed', result: checkpoint }),
    artifacts:
      retainedCheckpoint === undefined
        ? Object.freeze([
            Object.freeze({
              key: layout.checkpoint(
                checkpointEntries.length,
                checkpoint.checkpointSha256
              ),
              value: checkpoint,
            }),
          ])
        : Object.freeze([]),
  })
}

async function abandonPreparedEvaluationV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
}): Promise<{
  readonly outcome: RecoveredAttemptOutcomeV1
  readonly artifact: { readonly key: string; readonly value: unknown }
} | null>
{
  if (input.pending.attempt.toolName !== 'edit_evaluate') return null
  const layout = editSessionLayoutV1(input.sessionKey)
  const entries = await input.store.listImmutable(
    `${layout.prefix}/evaluations`
  )
  const preparedEntries = entries.filter((entry) =>
    entry.key.endsWith('/000000-prepared.json')
  )
  for (const preparedEntry of preparedEntries)
  {
    const prepared = await readJsonV1<{
      schemaVersion: 1
      startAttemptNamespaceSha256: string
      reservationId: string
      reservedBytes: number
    }>(
      input.store,
      preparedEntry.key,
      `session ${input.sessionKey} evaluation preparation`
    )
    if (
      prepared.startAttemptNamespaceSha256 !==
      input.pending.attempt.namespaceSha256
    )
      continue
    const directory = preparedEntry.key.replace(/\/000000-prepared\.json$/u, '')
    const retained = entries
      .filter((entry) => entry.key.startsWith(`${directory}/`))
      .map((entry) => ({
        name: entry.key.slice(directory.length + 1),
        sha256: entry.sha256,
        byteLength: entry.byteLength,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    if (
      retained.some((entry) =>
        [
          '000001-awaiting-external.json',
          '000002-cancelled.json',
          '000002-completed.json',
          'certificate.json',
          'retained-certificate.json',
          'recovery-abandoned.json',
        ].includes(entry.name)
      )
    )
      return null
    const quota = await input.store.quotaOutcome(prepared.reservationId)
    if (quota.state === 'active')
      await input.store.releaseQuota(prepared.reservationId)
    else if (quota.state !== 'released')
      return refuse(
        `session ${input.sessionKey} incomplete evaluation quota differs`
      )
    const outcome: RecoveredAttemptOutcomeV1 = Object.freeze({
      state: 'refused',
      refusalCode: 'edit.interrupted',
      result: Object.freeze({
        ok: false,
        code: 'edit.interrupted',
        safeMessage:
          'exclusive predecessor recovery abandoned an incomplete evaluation before any terminal evaluation evidence',
        context: Object.freeze({}),
      }),
    })
    return Object.freeze({
      outcome,
      artifact: Object.freeze({
        key: `${directory}/recovery-abandoned.json`,
        value: Object.freeze({
          schemaVersion: 1,
          kind: 'retained-evaluation-abandoned-v1',
          reservationId: prepared.reservationId,
          startAttemptNamespaceSha256: prepared.startAttemptNamespaceSha256,
          retainedEntriesSha256: editCanonicalSha256V1(retained),
        }),
      }),
    })
  }
  return null
}

async function recoverAwaitingEvaluationsV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionId: string
  readonly sessionKey: string
  readonly finalHead: EditKernelRevisionRecordV1['head']
  readonly events: EditKernelSemanticEventV1[]
  readonly pending: readonly RetainedPendingAttemptV1[]
  readonly invocation: HostInvocationContextV1
  readonly clock: EditClockPort
}): Promise<{
  readonly artifacts: readonly {
    readonly key: string
    readonly value: unknown
    readonly mimeType: EditRetainedResourceMimeTypeV1 | null
  }[]
  readonly quotaSettlements: readonly RetainedTerminalPlanV1['quotaSettlements'][number][]
  readonly outcomes: ReadonlyMap<string, RecoveredAttemptOutcomeV1>
  readonly evaluationState: EditKernelReportV1['evaluationState'] | null
}>
{
  const layout = editSessionLayoutV1(input.sessionKey)
  const entries = await input.store.listImmutable(
    `${layout.prefix}/evaluations`
  )
  const directories = [
    ...new Set(
      entries.map((entry) => entry.key.slice(0, entry.key.lastIndexOf('/')))
    ),
  ].sort()
  const evidenceEntries = await input.store.listImmutable(
    `${layout.prefix}/evaluation-evidence`
  )
  const chargedPayloads = new Set<string>()
  const artifacts: {
    key: string
    value: unknown
    mimeType: EditRetainedResourceMimeTypeV1 | null
  }[] = []
  const quotaSettlements: RetainedTerminalPlanV1['quotaSettlements'][number][] =
    []
  const outcomes = new Map<string, RecoveredAttemptOutcomeV1>()
  let evaluationState: EditKernelReportV1['evaluationState'] | null = null
  for (const directory of directories)
  {
    const names = new Map(
      entries
        .filter((entry) => entry.key.startsWith(`${directory}/`))
        .map((entry) => [entry.key.slice(directory.length + 1), entry])
    )
    const deterministicEntry = names.get('deterministic-results.json')
    if (
      names.has('000002-completed.json') ||
      names.has('recovery-abandoned.json')
    )
    {
      if (deterministicEntry !== undefined)
      {
        const deterministic = await readJsonV1<{
          readonly deterministic: {
            readonly evidenceArtifactIndex: readonly {
              readonly payloadSha256: string
            }[]
          }
        }>(
          input.store,
          deterministicEntry.key,
          'evaluation deterministic result'
        )
        for (const payload of deterministic.deterministic.evidenceArtifactIndex)
          chargedPayloads.add(payload.payloadSha256)
      }
      continue
    }
    const authorityEntry = names.get('awaiting-authority.json')
    if (authorityEntry === undefined) continue
    const preparedEntry = names.get('000000-prepared.json')
    const externalEntry = names.get('external-requests.json')
    const evidenceEntry = names.get('deterministic-evidence-index.json')
    if (
      preparedEntry === undefined ||
      deterministicEntry === undefined ||
      externalEntry === undefined ||
      evidenceEntry === undefined
    )
      return refuse('awaiting evaluation lacks exact retained prerequisites')
    const prepared = await readJsonV1<{
      readonly sequence: number
      readonly attemptSha256: string
      readonly reservationId: string
      readonly reservedBytes: number
      readonly evaluatedRevision: unknown
      readonly startAttemptNamespaceSha256: string
    }>(input.store, preparedEntry.key, 'awaiting evaluation preparation')
    const authority = await readJsonV1<{
      readonly schemaVersion: 1
      readonly kind: 'edit-evaluation-awaiting-authority-v1'
      readonly attemptNamespaceSha256: string
      readonly evaluationId: string
      readonly sequence: number
      readonly attemptSha256: string
      readonly evaluatedRevision: unknown
      readonly evidenceContent: unknown
      readonly requestArtifactIds: readonly string[]
      readonly awaitingRecord: Record<string, unknown>
      readonly eventProjection: EditKernelSemanticEventV1['projection']
      readonly eventSha256: string
      readonly reportSha256: string
    }>(input.store, authorityEntry.key, 'evaluation awaiting authority')
    exactFieldsV1(
      authority,
      [
        'attemptNamespaceSha256',
        'attemptSha256',
        'awaitingRecord',
        'evaluatedRevision',
        'evaluationId',
        'eventProjection',
        'eventSha256',
        'evidenceContent',
        'kind',
        'reportSha256',
        'requestArtifactIds',
        'schemaVersion',
        'sequence',
      ],
      'evaluation awaiting authority'
    )
    const event = input.events.find(
      (candidate) => candidate.eventSha256 === authority.eventSha256
    )
    const expectedEventSequence =
      event?.projection.sequence ?? input.events.length
    const expectedPreviousEventSha256 =
      expectedEventSequence === 0
        ? undefined
        : input.events.find(
            (candidate) =>
              candidate.projection.sequence === expectedEventSequence - 1
          )?.eventSha256
    if (
      authority.schemaVersion !== 1 ||
      authority.kind !== 'edit-evaluation-awaiting-authority-v1' ||
      authority.attemptNamespaceSha256 !==
        prepared.startAttemptNamespaceSha256 ||
      authority.sequence !== prepared.sequence ||
      authority.attemptSha256 !== prepared.attemptSha256 ||
      editCanonicalSha256V1(authority.evaluatedRevision) !==
        editCanonicalSha256V1(prepared.evaluatedRevision) ||
      authority.awaitingRecord['evaluationId'] !== authority.evaluationId ||
      authority.awaitingRecord['eventSha256'] !== authority.eventSha256 ||
      authority.eventProjection.sequence !== expectedEventSequence ||
      authority.eventProjection.previousEventSha256 !==
        expectedPreviousEventSha256 ||
      authority.eventProjection.eventKind !== 'evaluation-recorded' ||
      semanticHashV1('semantic-event', authority.eventProjection) !==
        authority.eventSha256
    )
      return refuse('evaluation awaiting recovery authority differs')
    const recoveredAwaitingEvent: EditKernelSemanticEventV1 =
      event ??
      Object.freeze({
        projection: authority.eventProjection,
        eventSha256: authority.eventSha256,
        hostTimestampEpochMs: input.clock.nowEpochMs(),
      })
    if (event === undefined)
    {
      artifacts.push({
        key: layout.event(
          authority.eventProjection.sequence,
          authority.eventSha256
        ),
        value: recoveredAwaitingEvent,
        mimeType: 'application/json',
      })
      input.events.push(recoveredAwaitingEvent)
    }
    const awaitingEntry = names.get('000001-awaiting-external.json')
    if (awaitingEntry === undefined)
      artifacts.push({
        key: `${directory}/000001-awaiting-external.json`,
        value: authority.awaitingRecord,
        mimeType: 'application/json',
      })
    else if (
      awaitingEntry.sha256 !==
      sha256Hex(canonicalJsonBytesV1(authority.awaitingRecord))
    )
      return refuse('evaluation awaiting record differs from its authority')
    const cancellationAuthorityEntry = names.get('cancellation-authority.json')
    const retainedCancelledEntry = names.get('000002-cancelled.json')
    let cancelledRecord: Readonly<Record<string, unknown>>
    if (cancellationAuthorityEntry === undefined)
    {
      if (retainedCancelledEntry !== undefined)
        return refuse('evaluation cancellation has no retained authority')
      const cancellationReason = 'edit.predecessor_recovery_cancelled'
      const cancellationPayload = Object.freeze({
        state: 'cancelled',
        certificate: null,
        attemptSha256: authority.attemptSha256,
        evaluatedRevision: authority.evaluatedRevision,
        reason: cancellationReason,
      })
      const cancellationProjection = Object.freeze({
        schemaVersion: 1 as const,
        sessionId: input.sessionId,
        sequence: input.events.length,
        eventKind: 'evaluation-recorded' as const,
        previousEventSha256: input.events.at(-1)?.eventSha256,
        preHead: Object.freeze({
          state: 'present' as const,
          head: exactRevisionFromHeadV1(input.finalHead),
        }),
        postHead: exactRevisionFromHeadV1(input.finalHead),
        semanticPayloadSha256: editCanonicalSha256V1(cancellationPayload),
        invocationCorrelation: invocationCorrelationV1(input.invocation),
      })
      const cancellationEventSha256 = semanticHashV1(
        'semantic-event',
        cancellationProjection
      )
      cancelledRecord = Object.freeze({
        schemaVersion: 1,
        evaluationId: authority.evaluationId,
        evaluatedRevision: authority.evaluatedRevision,
        requestSetSha256: authority.awaitingRecord['requestSetSha256'],
        deadlineEpochMs: authority.awaitingRecord['deadlineEpochMs'],
        deadlineSha256: authority.awaitingRecord['deadlineSha256'],
        notificationSha256: authority.awaitingRecord['notificationSha256'],
        reason: cancellationReason,
        eventSha256: cancellationEventSha256,
      })
      artifacts.push({
        key: `${directory}/cancellation-authority.json`,
        value: Object.freeze({
          schemaVersion: 1,
          kind: 'edit-evaluation-cancellation-authority-v1',
          evaluationId: authority.evaluationId,
          sequence: authority.sequence,
          attemptSha256: authority.attemptSha256,
          reservationId: prepared.reservationId,
          cancellationRecord: cancelledRecord,
          eventProjection: cancellationProjection,
          eventSha256: cancellationEventSha256,
        }),
        mimeType: 'application/json',
      })
      const cancellationEvent: EditKernelSemanticEventV1 = Object.freeze({
        projection: cancellationProjection,
        eventSha256: cancellationEventSha256,
        hostTimestampEpochMs: input.clock.nowEpochMs(),
      })
      artifacts.push({
        key: layout.event(
          cancellationProjection.sequence,
          cancellationEventSha256
        ),
        value: cancellationEvent,
        mimeType: 'application/json',
      })
      input.events.push(cancellationEvent)
    }
    else
    {
      const cancellationAuthority = await readJsonV1<{
        readonly schemaVersion: 1
        readonly kind: 'edit-evaluation-cancellation-authority-v1'
        readonly evaluationId: string
        readonly sequence: number
        readonly attemptSha256: string
        readonly reservationId: string
        readonly cancellationRecord: Readonly<Record<string, unknown>>
        readonly eventProjection: EditKernelSemanticEventV1['projection']
        readonly eventSha256: string
      }>(
        input.store,
        cancellationAuthorityEntry.key,
        'evaluation cancellation authority'
      )
      exactFieldsV1(
        cancellationAuthority,
        [
          'attemptSha256',
          'cancellationRecord',
          'evaluationId',
          'eventProjection',
          'eventSha256',
          'kind',
          'reservationId',
          'schemaVersion',
          'sequence',
        ],
        'evaluation cancellation authority'
      )
      exactFieldsV1(
        cancellationAuthority.cancellationRecord,
        [
          'deadlineEpochMs',
          'deadlineSha256',
          'evaluatedRevision',
          'evaluationId',
          'eventSha256',
          'notificationSha256',
          'reason',
          'requestSetSha256',
          'schemaVersion',
        ],
        'evaluation cancellation record authority'
      )
      const cancellationEvent = input.events.find(
        (candidate) =>
          candidate.eventSha256 === cancellationAuthority.eventSha256
      )
      const expectedSequence =
        cancellationEvent?.projection.sequence ?? input.events.length
      const expectedPrevious =
        expectedSequence === 0
          ? undefined
          : input.events.find(
              (candidate) =>
                candidate.projection.sequence === expectedSequence - 1
            )?.eventSha256
      if (
        cancellationAuthority.schemaVersion !== 1 ||
        cancellationAuthority.kind !==
          'edit-evaluation-cancellation-authority-v1' ||
        cancellationAuthority.evaluationId !== authority.evaluationId ||
        cancellationAuthority.sequence !== authority.sequence ||
        cancellationAuthority.attemptSha256 !== authority.attemptSha256 ||
        cancellationAuthority.reservationId !== prepared.reservationId ||
        cancellationAuthority.cancellationRecord['eventSha256'] !==
          cancellationAuthority.eventSha256 ||
        cancellationAuthority.cancellationRecord['schemaVersion'] !== 1 ||
        cancellationAuthority.cancellationRecord['evaluationId'] !==
          authority.evaluationId ||
        editCanonicalSha256V1(
          cancellationAuthority.cancellationRecord['evaluatedRevision']
        ) !== editCanonicalSha256V1(authority.evaluatedRevision) ||
        cancellationAuthority.cancellationRecord['requestSetSha256'] !==
          authority.awaitingRecord['requestSetSha256'] ||
        cancellationAuthority.cancellationRecord['deadlineEpochMs'] !==
          authority.awaitingRecord['deadlineEpochMs'] ||
        cancellationAuthority.cancellationRecord['deadlineSha256'] !==
          authority.awaitingRecord['deadlineSha256'] ||
        cancellationAuthority.cancellationRecord['notificationSha256'] !==
          authority.awaitingRecord['notificationSha256'] ||
        typeof cancellationAuthority.cancellationRecord['reason'] !==
          'string' ||
        cancellationAuthority.eventProjection.eventKind !==
          'evaluation-recorded' ||
        cancellationAuthority.eventProjection.sequence !== expectedSequence ||
        cancellationAuthority.eventProjection.previousEventSha256 !==
          expectedPrevious ||
        cancellationAuthority.eventProjection.semanticPayloadSha256 !==
          editCanonicalSha256V1({
            state: 'cancelled',
            certificate: null,
            attemptSha256: authority.attemptSha256,
            evaluatedRevision: authority.evaluatedRevision,
            reason: cancellationAuthority.cancellationRecord['reason'],
          }) ||
        semanticHashV1(
          'semantic-event',
          cancellationAuthority.eventProjection
        ) !== cancellationAuthority.eventSha256
      )
        return refuse('evaluation cancellation recovery authority differs')
      cancelledRecord = cancellationAuthority.cancellationRecord
      if (cancellationEvent === undefined)
      {
        const recoveredCancellationEvent: EditKernelSemanticEventV1 =
          Object.freeze({
            projection: cancellationAuthority.eventProjection,
            eventSha256: cancellationAuthority.eventSha256,
            hostTimestampEpochMs: input.clock.nowEpochMs(),
          })
        artifacts.push({
          key: layout.event(
            cancellationAuthority.eventProjection.sequence,
            cancellationAuthority.eventSha256
          ),
          value: recoveredCancellationEvent,
          mimeType: 'application/json',
        })
        input.events.push(recoveredCancellationEvent)
      }
    }
    if (retainedCancelledEntry === undefined)
      artifacts.push({
        key: `${directory}/000002-cancelled.json`,
        value: cancelledRecord,
        mimeType: 'application/json',
      })
    else if (
      retainedCancelledEntry.sha256 !==
      sha256Hex(canonicalJsonBytesV1(cancelledRecord))
    )
      return refuse('evaluation cancelled record differs from its authority')
    const deterministic = await readJsonV1<{
      readonly deterministic: {
        readonly evidenceArtifactIndex: readonly {
          readonly payloadSha256: string
          readonly byteLength: number
        }[]
      }
    }>(input.store, deterministicEntry.key, 'evaluation deterministic result')
    let actualBytes = [...names.values()].reduce(
      (total, entry) => total + entry.byteLength,
      0
    )
    actualBytes += artifacts
      .filter((artifact) => artifact.key.startsWith(`${directory}/`))
      .reduce(
        (total, artifact) =>
          total + canonicalJsonBytesV1(artifact.value).byteLength,
        0
      )
    for (const payload of deterministic.deterministic.evidenceArtifactIndex)
    {
      const retainedPayload = evidenceEntries.find(
        (entry) =>
          entry.key === layout.evaluationEvidence(payload.payloadSha256)
      )
      if (
        retainedPayload === undefined ||
        retainedPayload.sha256 !== payload.payloadSha256 ||
        retainedPayload.byteLength !== payload.byteLength
      )
        return refuse('awaiting evaluation evidence payload differs')
      if (!chargedPayloads.has(payload.payloadSha256))
        actualBytes += payload.byteLength
      chargedPayloads.add(payload.payloadSha256)
    }
    if (
      !Number.isSafeInteger(prepared.reservedBytes) ||
      actualBytes > prepared.reservedBytes
    )
      return refuse('awaiting evaluation quota authority differs')
    quotaSettlements.push(
      Object.freeze({
        reservationId: prepared.reservationId,
        reservedBytes: prepared.reservedBytes,
        actualBytes,
      })
    )
    const pending = input.pending.find(
      (attempt) =>
        attempt.attempt.namespaceSha256 === prepared.startAttemptNamespaceSha256
    )
    if (pending !== undefined)
      outcomes.set(
        pending.attempt.namespaceSha256,
        Object.freeze({
          state: 'completed',
          result: Object.freeze({
            evaluationId: authority.evaluationId,
            phase: 'awaitingExternalEvidence',
            evaluatedRevision: authority.evaluatedRevision,
            evaluationAttemptSha256: authority.attemptSha256,
            certificate: Object.freeze({ state: 'absent' as const }),
            evidenceContent: authority.evidenceContent,
            requiredHostAction: Object.freeze({
              kind: 'stageExternalEvidence' as const,
              evaluationId: authority.evaluationId,
              requestArtifactIds: authority.requestArtifactIds,
              requestSetSha256: authority.awaitingRecord['requestSetSha256'],
              deadlineSha256: authority.awaitingRecord['deadlineSha256'],
              notificationSha256:
                authority.awaitingRecord['notificationSha256'],
            }),
            eventSha256: authority.eventSha256,
            reportSha256: authority.reportSha256,
          }),
        })
      )
    evaluationState = 'inconclusive'
  }
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    quotaSettlements: Object.freeze(quotaSettlements),
    outcomes,
    evaluationState,
  })
}

async function committedEvaluationResultV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly events: readonly EditKernelSemanticEventV1[]
  readonly clock: EditClockPort
}): Promise<{
  readonly outcome: RecoveredAttemptOutcomeV1
  readonly artifacts: readonly {
    readonly key: string
    readonly value: unknown
    readonly mimeType: EditRetainedResourceMimeTypeV1 | null
  }[]
  readonly quotaSettlement: {
    readonly reservationId: string
    readonly reservedBytes: number
    readonly actualBytes: number
  }
  readonly retainedCertificate: EditRetainedCertificateV1
  readonly status: EditKernelReportV1['evaluationState']
  readonly reportSha256: string
  readonly event: EditKernelSemanticEventV1
} | null>
{
  if (input.pending.attempt.toolName !== 'edit_evaluate') return null
  const layout = editSessionLayoutV1(input.sessionKey)
  const entries = await input.store.listImmutable(
    `${layout.prefix}/evaluations`
  )
  const directories = new Set(
    entries.map((entry) => entry.key.slice(0, entry.key.lastIndexOf('/')))
  )
  for (const directory of directories)
  {
    const names = new Map(
      entries
        .filter((entry) => entry.key.startsWith(`${directory}/`))
        .map((entry) => [entry.key.slice(directory.length + 1), entry])
    )
    const preparedEntry = names.get('000000-prepared.json')
    const authorityEntry = names.get('completion-authority.json')
    const evidenceEntry = names.get('evidence-index.json')
    if (
      preparedEntry === undefined ||
      authorityEntry === undefined ||
      evidenceEntry === undefined
    )
      continue
    const prepared = await readJsonV1<{
      readonly attemptSha256: string
      readonly evaluatedRevision: unknown
      readonly startAttemptNamespaceSha256: string
      readonly reservationId: string
      readonly reservedBytes: number
    }>(input.store, preparedEntry.key, 'evaluation recovery preparation')
    const request = input.pending.request as {
      readonly action?: unknown
      readonly evaluationId?: unknown
      readonly expectedEvaluationAttemptSha256?: unknown
    }
    const isStart =
      request.action === 'start' &&
      prepared.startAttemptNamespaceSha256 ===
        input.pending.attempt.namespaceSha256
    const authority = await readJsonV1<{
      readonly schemaVersion: 1
      readonly kind: 'edit-evaluation-completion-authority-v1'
      readonly attemptNamespaceSha256: string
      readonly evaluationId: string
      readonly sequence: number
      readonly attemptSha256: string
      readonly evaluatedRevision: unknown
      readonly evidenceContent: unknown
      readonly certificate: {
        readonly certificateSha256: string
        readonly hashProjection: { readonly status: string }
      }
      readonly retainedCertificate: EditRetainedCertificateV1
      readonly status: string
      readonly completedRecord: Record<string, unknown>
      readonly eventProjection: EditKernelSemanticEventV1['projection']
      readonly eventSha256: string
      readonly reportSha256: string
    }>(input.store, authorityEntry.key, 'evaluation completion authority')
    exactFieldsV1(
      authority,
      [
        'attemptNamespaceSha256',
        'attemptSha256',
        'certificate',
        'completedRecord',
        'evaluatedRevision',
        'evaluationId',
        'eventProjection',
        'eventSha256',
        'evidenceContent',
        'kind',
        'reportSha256',
        'retainedCertificate',
        'schemaVersion',
        'sequence',
        'status',
      ],
      'evaluation completion authority'
    )
    const isFinalize =
      request.action === 'finalize' &&
      request.evaluationId === authority.evaluationId &&
      request.expectedEvaluationAttemptSha256 === prepared.attemptSha256
    if (!isStart && !isFinalize) continue
    const evidence = await readJsonV1<{
      readonly schemaVersion: 1
      readonly evidenceContent: unknown
    }>(input.store, evidenceEntry.key, 'evaluation recovery evidence index')
    const status = authority.status
    const eventSha256 = authority.eventSha256
    const retained = authority.retainedCertificate
    const expectedEventSha256 = semanticHashV1(
      'semantic-event',
      authority.eventProjection
    )
    const event = input.events.find(
      (candidate) => candidate.eventSha256 === eventSha256
    )
    const expectedEventSequence =
      event === undefined ? input.events.length : event.projection.sequence
    const expectedPreviousEventSha256 =
      expectedEventSequence === 0
        ? undefined
        : input.events.find(
            (candidate) =>
              candidate.projection.sequence === expectedEventSequence - 1
          )?.eventSha256
    if (
      authority.schemaVersion !== 1 ||
      authority.kind !== 'edit-evaluation-completion-authority-v1' ||
      authority.attemptNamespaceSha256 !==
        input.pending.attempt.namespaceSha256 ||
      authority.sequence !== retained.sequence ||
      authority.attemptSha256 !== prepared.attemptSha256 ||
      authority.attemptSha256 !== retained.attemptSha256 ||
      authority.evaluationId !== retained.evaluationId ||
      authority.certificate.certificateSha256 !==
        retained.certificate.certificateSha256 ||
      editCanonicalSha256V1(authority.certificate) !==
        editCanonicalSha256V1(retained.certificate) ||
      editCanonicalSha256V1(authority.evaluatedRevision) !==
        editCanonicalSha256V1(prepared.evaluatedRevision) ||
      authority.evidenceContent === null ||
      typeof authority.evidenceContent !== 'object' ||
      editCanonicalSha256V1(authority.evidenceContent) !==
        editCanonicalSha256V1(evidence.evidenceContent) ||
      status !== authority.certificate.hashProjection.status ||
      authority.completedRecord['status'] !== status ||
      authority.completedRecord['certificateSha256'] !==
        authority.certificate.certificateSha256 ||
      authority.completedRecord['eventSha256'] !== eventSha256 ||
      authority.eventProjection.eventKind !== 'evaluation-recorded' ||
      authority.eventProjection.sequence !== expectedEventSequence ||
      authority.eventProjection.previousEventSha256 !==
        expectedPreviousEventSha256 ||
      authority.eventProjection.invocationCorrelation.invocationSha256 !==
        input.pending.invocationCorrelation.invocationSha256 ||
      authority.eventProjection.invocationCorrelation.boundaryKind !==
        input.pending.invocationCorrelation.boundaryKind ||
      expectedEventSha256 !== eventSha256
    )
      return refuse('committed evaluation recovery authority differs')
    const artifacts: {
      key: string
      value: unknown
      mimeType: EditRetainedResourceMimeTypeV1 | null
    }[] = []
    const recoveredEvent: EditKernelSemanticEventV1 =
      event ??
      Object.freeze({
        projection: authority.eventProjection,
        eventSha256,
        hostTimestampEpochMs: input.clock.nowEpochMs(),
      })
    if (event === undefined)
      artifacts.push({
        key: layout.event(authority.eventProjection.sequence, eventSha256),
        value: recoveredEvent,
        mimeType: 'application/json',
      })
    else if (
      editCanonicalSha256V1(event.projection) !==
      editCanonicalSha256V1(authority.eventProjection)
    )
      return refuse('committed evaluation event differs from its authority')
    const plannedRecords = [
      {
        name: 'certificate.json',
        value: Object.freeze({
          schemaVersion: 1,
          certificate: authority.certificate,
        }),
      },
      { name: '000002-completed.json', value: authority.completedRecord },
      {
        name: 'retained-certificate.json',
        value: Object.freeze({ schemaVersion: 1, retained }),
      },
    ] as const
    for (const planned of plannedRecords)
    {
      const existing = names.get(planned.name)
      if (existing === undefined)
        artifacts.push({
          key: `${directory}/${planned.name}`,
          value: planned.value,
          mimeType: 'application/json',
        })
      else if (
        existing.sha256 !== sha256Hex(canonicalJsonBytesV1(planned.value))
      )
        return refuse(
          `committed evaluation ${planned.name} differs from its authority`
        )
    }
    const deterministicEntry = names.get('deterministic-results.json')
    if (deterministicEntry === undefined)
      return refuse('committed evaluation has no deterministic result')
    const deterministic = await readJsonV1<{
      readonly deterministic: {
        readonly evidenceArtifactIndex: readonly {
          readonly payloadSha256: string
          readonly byteLength: number
        }[]
      }
    }>(input.store, deterministicEntry.key, 'evaluation deterministic result')
    let actualBytes = [...names.values()].reduce(
      (total, entry) => total + entry.byteLength,
      0
    )
    for (const artifact of artifacts)
      if (artifact.key.startsWith(`${directory}/`))
        actualBytes += canonicalJsonBytesV1(artifact.value).byteLength
    const previouslyChargedPayloads = new Set<string>()
    for (const priorDirectory of [...directories].sort())
    {
      if (priorDirectory === directory) break
      const priorDeterministic = entries.find(
        (entry) => entry.key === `${priorDirectory}/deterministic-results.json`
      )
      if (priorDeterministic === undefined) continue
      const prior = await readJsonV1<{
        readonly deterministic: {
          readonly evidenceArtifactIndex: readonly {
            readonly payloadSha256: string
          }[]
        }
      }>(
        input.store,
        priorDeterministic.key,
        'prior evaluation deterministic result'
      )
      for (const payload of prior.deterministic.evidenceArtifactIndex)
        previouslyChargedPayloads.add(payload.payloadSha256)
    }
    const evidenceEntries = await input.store.listImmutable(
      `${layout.prefix}/evaluation-evidence`
    )
    for (const payload of deterministic.deterministic.evidenceArtifactIndex)
    {
      const payloadKey = layout.evaluationEvidence(payload.payloadSha256)
      const retainedPayload = evidenceEntries.find(
        (entry) => entry.key === payloadKey
      )
      if (
        retainedPayload === undefined ||
        retainedPayload.sha256 !== payload.payloadSha256 ||
        retainedPayload.byteLength !== payload.byteLength
      )
        return refuse('committed evaluation evidence payload differs')
      if (!previouslyChargedPayloads.has(payload.payloadSha256))
        actualBytes += payload.byteLength
    }
    if (
      !Number.isSafeInteger(prepared['reservedBytes']) ||
      typeof prepared['reservationId'] !== 'string' ||
      actualBytes > (prepared['reservedBytes'] as number)
    )
      return refuse('committed evaluation quota authority differs')
    const result = Object.freeze({
      evaluationId: retained.evaluationId,
      phase: status === 'passed' ? 'completed' : status,
      evaluatedRevision: prepared.evaluatedRevision,
      evaluationAttemptSha256: prepared.attemptSha256,
      certificate: Object.freeze({
        state: 'present' as const,
        certificateSha256: retained.certificate.certificateSha256,
        status,
      }),
      evidenceContent: evidence.evidenceContent,
      requiredHostAction:
        status === 'unavailable'
          ? Object.freeze({
              kind: 'configureEvidenceProducer' as const,
              limitationCode: 'edit.evaluation_unavailable' as const,
            })
          : Object.freeze({ kind: 'none' as const }),
      eventSha256,
      reportSha256: authority.reportSha256,
    })
    return Object.freeze({
      outcome: Object.freeze({ state: 'completed', result }),
      artifacts: Object.freeze(artifacts),
      quotaSettlement: Object.freeze({
        reservationId: prepared['reservationId'] as string,
        reservedBytes: prepared['reservedBytes'] as number,
        actualBytes,
      }),
      retainedCertificate: retained,
      status: status as EditKernelReportV1['evaluationState'],
      reportSha256: authority.reportSha256,
      event: recoveredEvent,
    })
  }
  return null
}

async function recoverRevisionAttemptsV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionId: string
  readonly sessionKey: string
  readonly finalHead: EditKernelRevisionRecordV1['head']
  readonly pending: readonly RetainedPendingAttemptV1[]
  readonly events: EditKernelSemanticEventV1[]
  readonly clock: EditClockPort
}): Promise<{
  readonly artifacts: readonly {
    readonly key: string
    readonly value: unknown
    readonly mimeType: EditRetainedResourceMimeTypeV1 | null
  }[]
  readonly settlements: readonly RetainedTerminalPlanV1['quotaSettlements'][number][]
  readonly releases: readonly RetainedTerminalPlanV1['quotaReleases'][number][]
  readonly outcomes: ReadonlyMap<string, RecoveredAttemptOutcomeV1>
  readonly postCommitBudget: EditKernelReportV1['budget'] | null
}>
{
  const layout = editSessionLayoutV1(input.sessionKey)
  const artifacts: {
    key: string
    value: unknown
    mimeType: EditRetainedResourceMimeTypeV1 | null
  }[] = []
  const settlements: RetainedTerminalPlanV1['quotaSettlements'][number][] = []
  const releases: RetainedTerminalPlanV1['quotaReleases'][number][] = []
  const outcomes = new Map<string, RecoveredAttemptOutcomeV1>()
  let postCommitBudget: EditKernelReportV1['budget'] | null = null
  for (const pending of input.pending)
  {
    if (
      pending.attempt.toolName !== 'edit_apply' &&
      pending.attempt.toolName !== 'edit_undo' &&
      pending.attempt.toolName !== 'edit_rollback'
    )
      continue
    const authorityKey = layout.attempt(
      pending.attempt.sequence,
      pending.attempt.requestSha256,
      'revision-recovery-authority.json'
    )
    const attemptEntries = await input.store.listImmutable(
      authorityKey.replace(/\/revision-recovery-authority\.json$/u, '')
    )
    const authorityEntry = attemptEntries.find(
      (entry) => entry.key === authorityKey
    )
    if (authorityEntry === undefined) continue
    const retainedAuthorityEntry = attemptEntries.find((entry) =>
      entry.key.endsWith('/revision-retained-authority.json')
    )
    const authority = await readJsonV1<{
      readonly schemaVersion: 1
      readonly kind: 'edit-revision-recovery-authority-v1'
      readonly namespaceSha256: string
      readonly requestSha256: string
      readonly revisionId: string
      readonly revisionNumber: number
      readonly revisionManifestSha256: string
      readonly previousHead: unknown
      readonly proposedHead: unknown
      readonly reservationId: string
      readonly reservedBytes: number
      readonly invocationCorrelation: RetainedPendingAttemptV1['invocationCorrelation']
    }>(input.store, authorityKey, 'revision recovery authority')
    exactFieldsV1(
      authority,
      [
        'invocationCorrelation',
        'kind',
        'namespaceSha256',
        'previousHead',
        'proposedHead',
        'requestSha256',
        'reservationId',
        'reservedBytes',
        'revisionId',
        'revisionManifestSha256',
        'revisionNumber',
        'schemaVersion',
      ],
      'revision recovery authority'
    )
    const revisionDirectory = `${layout.prefix}/revisions/${String(
      authority.revisionNumber
    ).padStart(6, '0')}-${authority.revisionId}`
    const revisionEntries = await input.store.listImmutable(revisionDirectory)
    const manifestEntry = revisionEntries.find((entry) =>
      entry.key.endsWith('/manifest.json')
    )
    const candidateEntry = revisionEntries.find((entry) =>
      entry.key.endsWith('/candidate.sb3')
    )
    const record =
      manifestEntry === undefined
        ? null
        : await readJsonV1<EditKernelRevisionRecordV1>(
            input.store,
            manifestEntry.key,
            'revision recovery manifest'
          )
    const expectedReservationId = editCanonicalSha256V1({
      sessionId: input.sessionId,
      revisionId: authority.revisionId,
      purpose: 'revision-commit',
    })
    const expectedReservedBytes =
      record === null || candidateEntry === undefined
        ? authority.reservedBytes
        : candidateEntry.byteLength +
          editCanonicalBytesV1(record).byteLength * 3
    if (
      authority.schemaVersion !== 1 ||
      authority.kind !== 'edit-revision-recovery-authority-v1' ||
      authority.namespaceSha256 !== pending.attempt.namespaceSha256 ||
      authority.requestSha256 !== pending.attempt.requestSha256 ||
      authority.reservationId !== expectedReservationId ||
      authority.reservedBytes !== expectedReservedBytes ||
      authority.invocationCorrelation.invocationSha256 !==
        pending.invocationCorrelation.invocationSha256 ||
      authority.invocationCorrelation.boundaryKind !==
        pending.invocationCorrelation.boundaryKind ||
      (record !== null &&
        (manifestEntry!.sha256 !== authority.revisionManifestSha256 ||
          record.head.revisionId !== authority.revisionId ||
          record.head.revisionNumber !== authority.revisionNumber ||
          editCanonicalSha256V1(record.head) !==
            editCanonicalSha256V1(authority.proposedHead) ||
          record.revision.originatingRequestId !== pending.attempt.requestId ||
          editCanonicalSha256V1(record.revision.invocationCorrelation) !==
            editCanonicalSha256V1(authority.invocationCorrelation)))
    )
      return refuse('revision recovery authority differs')
    const quota = await input.store.quotaOutcome(authority.reservationId)
    const headCommitted =
      input.finalHead.revisionId === authority.revisionId &&
      input.finalHead.revisionNumber === authority.revisionNumber
    const prepared = input.events.filter(
      (event) =>
        event.projection.eventKind === 'transition-prepared' &&
        event.projection.postHead.revisionId === authority.revisionId
    )
    if (!headCommitted)
    {
      if (
        editCanonicalSha256V1(input.finalHead) !==
          editCanonicalSha256V1(authority.previousHead) ||
        quota.state === 'settled' ||
        (quota.state !== 'absent' &&
          quota.reservedBytes !== authority.reservedBytes) ||
        (quota.state === 'released' && quota.actualBytes !== 0) ||
        prepared.length > 1
      )
        return refuse('pre-head revision recovery authority differs')
      if (quota.state === 'active')
        releases.push(
          Object.freeze({
            reservationId: authority.reservationId,
            reservedBytes: authority.reservedBytes,
          })
        )
      if (prepared.length === 1)
      {
        const preparedEvent = prepared[0]!
        if (
          preparedEvent.projection.invocationCorrelation.invocationSha256 !==
            pending.invocationCorrelation.invocationSha256 ||
          preparedEvent.projection.invocationCorrelation.boundaryKind !==
            pending.invocationCorrelation.boundaryKind
        )
          return refuse('pre-head revision prepared event differs')
        const abortPayload = Object.freeze({
          preparedEventSha256: preparedEvent.eventSha256,
          proposedRevisionId: authority.revisionId,
          failureSha256: editCanonicalSha256V1({
            code: 'edit.interrupted',
            message:
              'exclusive predecessor recovery aborted a pre-head revision',
          }),
        })
        const abortProjection = Object.freeze({
          schemaVersion: 1 as const,
          sessionId: input.sessionId,
          sequence: input.events.length,
          eventKind: 'transition-aborted' as const,
          previousEventSha256: input.events.at(-1)?.eventSha256,
          preHead: Object.freeze({
            state: 'present' as const,
            head: exactRevisionFromHeadV1(input.finalHead),
          }),
          postHead: exactRevisionFromHeadV1(input.finalHead),
          semanticPayloadSha256: editCanonicalSha256V1(abortPayload),
          invocationCorrelation: pending.invocationCorrelation,
        })
        const abortSha256 = semanticHashV1('semantic-event', abortProjection)
        const abortEvent: EditKernelSemanticEventV1 = Object.freeze({
          projection: abortProjection,
          eventSha256: abortSha256,
          hostTimestampEpochMs: input.clock.nowEpochMs(),
        })
        artifacts.push({
          key: layout.event(abortProjection.sequence, abortSha256),
          value: abortEvent,
          mimeType: 'application/json',
        })
        input.events.push(abortEvent)
      }
      outcomes.set(
        pending.attempt.namespaceSha256,
        Object.freeze({
          state: 'refused',
          refusalCode: 'edit.interrupted',
          result: Object.freeze({
            ok: false,
            code: 'edit.interrupted',
            safeMessage:
              'exclusive predecessor recovery aborted a pre-head revision',
            context: Object.freeze({}),
          }),
        })
      )
      continue
    }
    if (
      record === null ||
      prepared.length !== 1 ||
      (quota.state !== 'active' && quota.state !== 'settled') ||
      quota.reservedBytes !== authority.reservedBytes
    )
      return refuse('post-head revision recovery authority differs')
    if (retainedAuthorityEntry === undefined)
      return refuse('post-head revision has no retained-byte authority')
    const retainedAuthority = await readJsonV1<{
      readonly schemaVersion: 1
      readonly kind: 'edit-revision-retained-authority-v1'
      readonly namespaceSha256: string
      readonly revisionId: string
      readonly reservationId: string
      readonly retainedBytes: number
      readonly postCommitBudget: EditKernelReportV1['budget']
    }>(
      input.store,
      retainedAuthorityEntry.key,
      'revision retained-byte authority'
    )
    exactFieldsV1(
      retainedAuthority,
      [
        'kind',
        'namespaceSha256',
        'postCommitBudget',
        'reservationId',
        'retainedBytes',
        'revisionId',
        'schemaVersion',
      ],
      'revision retained-byte authority'
    )
    const retainedBytes = revisionEntries.reduce(
      (total, entry) => total + entry.byteLength,
      0
    )
    if (
      retainedAuthority.schemaVersion !== 1 ||
      retainedAuthority.kind !== 'edit-revision-retained-authority-v1' ||
      retainedAuthority.namespaceSha256 !== pending.attempt.namespaceSha256 ||
      retainedAuthority.revisionId !== authority.revisionId ||
      retainedAuthority.reservationId !== authority.reservationId ||
      retainedAuthority.retainedBytes !== retainedBytes ||
      retainedBytes > authority.reservedBytes
    )
      return refuse('post-head revision exceeds its reservation')
    if (quota.state === 'settled' && quota.actualBytes !== retainedBytes)
      return refuse('post-head revision settled quota differs')
    settlements.push(
      Object.freeze({
        reservationId: authority.reservationId,
        reservedBytes: authority.reservedBytes,
        actualBytes: retainedBytes,
      })
    )
    if (postCommitBudget !== null)
      return refuse('multiple pending committed revisions are not recoverable')
    postCommitBudget = retainedAuthority.postCommitBudget
    const committed = input.events.filter(
      (event) =>
        event.projection.eventKind === 'transition-committed' &&
        event.projection.postHead.revisionId === authority.revisionId
    )
    if (committed.length > 1)
      return refuse('post-head revision has ambiguous committed events')
    if (committed.length === 0)
    {
      const commitPayload = Object.freeze({
        revisionId: authority.revisionId,
        preparedEventSha256: prepared[0]!.eventSha256,
      })
      const commitProjection = Object.freeze({
        schemaVersion: 1 as const,
        sessionId: input.sessionId,
        sequence: input.events.length,
        eventKind: 'transition-committed' as const,
        previousEventSha256: input.events.at(-1)?.eventSha256,
        preHead: Object.freeze({
          state: 'present' as const,
          head: authority.previousHead as ReturnType<
            typeof exactRevisionFromHeadV1
          >,
        }),
        postHead: authority.proposedHead as ReturnType<
          typeof exactRevisionFromHeadV1
        >,
        semanticPayloadSha256: editCanonicalSha256V1(commitPayload),
        invocationCorrelation: pending.invocationCorrelation,
      })
      const commitSha256 = semanticHashV1('semantic-event', commitProjection)
      const commitEvent: EditKernelSemanticEventV1 = Object.freeze({
        projection: commitProjection,
        eventSha256: commitSha256,
        hostTimestampEpochMs: input.clock.nowEpochMs(),
      })
      artifacts.push({
        key: layout.event(commitProjection.sequence, commitSha256),
        value: commitEvent,
        mimeType: 'application/json',
      })
      input.events.push(commitEvent)
    }
  }
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    settlements: Object.freeze(settlements),
    releases: Object.freeze(releases),
    outcomes,
    postCommitBudget,
  })
}

interface RecoverRetainedEditSessionsInputV1
{
  readonly artifactStore: EditArtifactStorePort
  readonly resourceCatalogue?: EditRetainedResourceCataloguePortV1
  readonly invocation: HostInvocationContextV1
  readonly clock?: EditClockPort
  readonly openPublicationRecoveryPort?: (
    authority: EditPublicationRecoveryAuthorityV1
  ) => Promise<EditPublicationRecoveryPortV1>
}

const PRE_MANIFEST_ALLOWED_SUFFIXES = new Set([
  'authority/bound-change-contract.json',
  'authority/capability-profile.json',
  'authority/change-contract-registration.json',
  'recovery/begin-authority-v1.json',
  'source/admission.json',
  'source/input.sb3',
  'source/provenance.json',
  'source/semantic-identity.json',
])

function allowedPreManifestSuffixV1(suffix: string): boolean
{
  return (
    PRE_MANIFEST_ALLOWED_SUFFIXES.has(suffix) ||
    suffix === 'head.json' ||
    /^events\/000000-[0-9a-f]{64}\.json$/u.test(suffix) ||
    /^reports\/[0-9a-f]{64}\/(manifest\.json|report\.json|report\.md|semantic-projection\.json)$/u.test(
      suffix
    ) ||
    /^revisions\/000000-[0-9a-f]{64}\/(allocator\.json|authorization\.json|batch\.json|candidate\.sb3|capability-snapshot\.json|cumulative-delta\.json|diagnostics\.json|lineage-history\.json|lineage\.json|manifest\.json|operation-results\.json|preservation\.json|previous-delta\.json|resolved-plan\.json)$/u.test(
      suffix
    )
  )
}

function refuse(message: string): never
{
  throw new Error(`retained edit-session recovery refused: ${message}`)
}

function decodeJsonV1<T>(bytes: Uint8Array, label: string): T
{
  let value: unknown
  try
  {
    value = scanStrictJson(bytes, RETAINED_SESSION_JSON_LIMITS).value
  }
  catch (error)
  {
    return refuse(
      `${label} is not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  const canonical = editCanonicalBytesV1(value)
  if (
    canonical.byteLength !== bytes.byteLength ||
    !canonical.every((byte, index) => byte === bytes[index])
  )
    return refuse(`${label} is not canonical JSON`)
  return value as T
}

function exactFieldsV1(
  value: unknown,
  fields: readonly string[],
  label: string
): asserts value is Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return refuse(`${label} is not one closed object`)
  const observed = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (
    observed.length !== expected.length ||
    observed.some((field, index) => field !== expected[index])
  )
    return refuse(`${label} does not have its exact field set`)
}

// MCP recovery must carry the original frozen request beside the transformed
// domain authority, w/ the two projections still describing one exact call
function assertRetainedTransportDomainBindingV1(
  pending: RetainedPendingAttemptV1,
  sessionId: string
): void
{
  const failure = retainedStatefulRequestBindingFailureV1({
    toolName: pending.attempt.toolName,
    requestId: pending.attempt.requestId,
    sessionId,
    boundaryKind: pending.invocationCorrelation.boundaryKind,
    request: pending.request,
    transportRequest: pending.transportRequest,
  })
  if (failure !== null) return refuse(failure)
}

async function readJsonV1<T>(
  store: EditArtifactStorePort,
  key: string,
  label: string
): Promise<T>
{
  return decodeJsonV1<T>(await store.readImmutable(key), label)
}

async function retainPublicV1(
  input: RecoverRetainedEditSessionsInputV1,
  sessionId: string,
  sessionKey: string,
  artifact: PlannedImmutableV1
): Promise<EditArtifactIdentityV1>
{
  const bytes = plannedImmutableBytesV1(artifact)
  const identity = await input.artifactStore.createOrVerifyImmutable(
    artifact.key,
    bytes
  )
  if (artifact.mimeType !== null)
    await input.resourceCatalogue?.retain({
      sessionId,
      sessionKey,
      logicalKey: artifact.key,
      identity,
      mimeType: artifact.mimeType,
    })
  return identity
}

async function installPointerV1(
  store: EditArtifactStorePort,
  key: string,
  expectedSha256: string | null,
  bytes: Uint8Array
): Promise<void>
{
  try
  {
    await store.compareAndSwapPointer(key, expectedSha256, bytes)
  }
  catch (error)
  {
    const reconciled = await store.reconcilePointer(key, expectedSha256, bytes)
    if (reconciled.status === 'new') return
    if (reconciled.status === 'interference')
      return refuse(`pointer ${key} changed outside the retained recovery plan`)
    throw error
  }
}

async function reconcileCommittedBeginV1(
  input: RecoverRetainedEditSessionsInputV1,
  sessionKey: string
): Promise<void>
{
  const layout = editSessionLayoutV1(sessionKey)
  const entries = await input.artifactStore.listImmutable(layout.prefix)
  const keys = new Set(entries.map((entry) => entry.key))
  if (!keys.has(layout.session)) return
  if (!keys.has(layout.head))
    return refuse(
      `session ${sessionKey} retained a manifest before its admission head`
    )
  const begin = await readJsonV1<RetainedBeginRecoveryAuthorityV1>(
    input.artifactStore,
    layout.recoveryBegin,
    `session ${sessionKey} begin recovery authority`
  )
  exactFieldsV1(
    begin,
    [
      'beginNamespaceSha256',
      'capabilityProfileSha256',
      'changeContractSha256',
      'kind',
      'reservationId',
      'reservedBytes',
      'schemaVersion',
      'semanticSourceSha256',
      'sessionId',
      'sessionKey',
      'sourceArtifactSha256',
    ],
    `session ${sessionKey} begin recovery authority`
  )
  if (
    begin.schemaVersion !== 1 ||
    begin.kind !== 'edit-session-begin-recovery-authority-v1' ||
    begin.sessionKey !== sessionKey ||
    begin.reservationId !==
      editCanonicalSha256V1({
        beginNamespaceSha256: begin.beginNamespaceSha256,
        purpose: 'session-begin',
      }) ||
    !Number.isSafeInteger(begin.reservedBytes) ||
    begin.reservedBytes < 0
  )
    return refuse(`session ${sessionKey} begin recovery authority differs`)

  let reportPointerRepair: Uint8Array | null = null
  if (!keys.has(layout.currentReport))
  {
    const reportManifests = entries.filter((entry) =>
      /^sessions\/[^/]+\/reports\/[0-9a-f]{64}\/manifest\.json$/u.test(
        entry.key
      )
    )
    if (reportManifests.length !== 1)
      return refuse(
        `session ${sessionKey} admission has no unique initial report manifest`
      )
    const reportManifest = await readJsonV1<RetainedInitialReportManifestV1>(
      input.artifactStore,
      reportManifests[0]!.key,
      `session ${sessionKey} initial report manifest`
    )
    exactFieldsV1(
      reportManifest,
      [
        'reportByteLength',
        'reportJsonSha256',
        'schemaVersion',
        'semanticProjectionSha256',
      ],
      `session ${sessionKey} initial report manifest`
    )
    const directory = reportManifests[0]!.key.replace(/\/manifest\.json$/u, '')
    const reportKey = `${directory}/report.json`
    const projectionKey = `${directory}/semantic-projection.json`
    const markdownKey = `${directory}/report.md`
    if (
      reportManifest.schemaVersion !== 1 ||
      !/^[0-9a-f]{64}$/u.test(reportManifest.reportJsonSha256) ||
      reportKey !==
        layout.report(reportManifest.reportJsonSha256, 'report.json') ||
      !keys.has(reportKey) ||
      !keys.has(projectionKey) ||
      !keys.has(markdownKey)
    )
      return refuse(`session ${sessionKey} initial report authority differs`)
    const reportBytes = await input.artifactStore.readImmutable(reportKey)
    const report = decodeJsonV1<EditKernelReportV1>(
      reportBytes,
      `session ${sessionKey} initial report`
    )
    if (
      sha256Hex(reportBytes) !== reportManifest.reportJsonSha256 ||
      reportBytes.byteLength !== reportManifest.reportByteLength ||
      report.reportSequence !== 0 ||
      report.state !== 'active' ||
      report.semanticProjectionSha256 !==
        reportManifest.semanticProjectionSha256 ||
      sha256Hex(await input.artifactStore.readImmutable(projectionKey)) !==
        sha256Hex(canonicalJsonBytesV1(report.semanticProjection))
    )
      return refuse(`session ${sessionKey} initial report does not reconstruct`)
    reportPointerRepair = canonicalJsonBytesV1({
      schemaVersion: 1,
      reportJsonSha256: reportManifest.reportJsonSha256,
      reportManifestSha256: reportManifests[0]!.sha256,
    })
  }

  const quota = await input.artifactStore.quotaOutcome(begin.reservationId)
  const initialReportEntries: (typeof entries)[number][] = []
  for (const entry of entries.filter((candidate) =>
    candidate.key.endsWith('/report.json')
  ))
  {
    const report = await readJsonV1<EditKernelReportV1>(
      input.artifactStore,
      entry.key,
      `session ${sessionKey} retained report`
    )
    if (report.reportSequence !== 0) continue
    const directory = entry.key.slice(0, entry.key.lastIndexOf('/'))
    initialReportEntries.push(
      ...entries.filter((candidate) =>
        candidate.key.startsWith(`${directory}/`)
      )
    )
  }
  const initialRevisionPrefix = `${layout.prefix}/revisions/000000-`
  const initialEventPrefix = `${layout.prefix}/events/000000-`
  const initialKeys = new Set([
    layout.session,
    layout.recoveryBegin,
    ...entries
      .filter(
        (entry) =>
          entry.key.startsWith(`${layout.prefix}/source/`) ||
          entry.key.startsWith(`${layout.prefix}/authority/`) ||
          entry.key.startsWith(initialRevisionPrefix) ||
          entry.key.startsWith(initialEventPrefix)
      )
      .map((entry) => entry.key),
    ...initialReportEntries.map((entry) => entry.key),
  ])
  const retainedBytes = entries
    .filter((entry) => initialKeys.has(entry.key))
    .reduce((sum, entry) => sum + entry.byteLength, 0)
  if (
    !Number.isSafeInteger(begin.reservedBytes) ||
    begin.reservedBytes < retainedBytes ||
    (quota.state !== 'active' && quota.state !== 'settled') ||
    quota.reservedBytes !== begin.reservedBytes ||
    (quota.state === 'settled' && quota.actualBytes !== retainedBytes)
  )
    return refuse(
      `session ${sessionKey} committed admission quota differs from retained authority`
    )
  if (reportPointerRepair !== null)
    await installPointerV1(
      input.artifactStore,
      layout.currentReport,
      null,
      reportPointerRepair
    )
  if (quota.state === 'active')
    await input.artifactStore.settleQuota(begin.reservationId, retainedBytes)
}

function invocationCorrelationV1(invocation: HostInvocationContextV1): {
  readonly boundaryKind: 'directHost' | 'mcp'
  readonly invocationSha256: string
}
{
  return Object.freeze({
    boundaryKind:
      invocation.boundaryKind === 'directHost' ? 'directHost' : 'mcp',
    invocationSha256: invocation.invocationSha256,
  })
}

async function pendingAttemptsV1(
  store: EditArtifactStorePort,
  sessionKey: string,
  sessionId: string,
  index: RetainedAttemptIndexV1
): Promise<readonly RetainedPendingAttemptV1[]>
{
  const layout = editSessionLayoutV1(sessionKey)
  const pending: RetainedPendingAttemptV1[] = []
  for (const entry of index.entries)
  {
    if (entry.state !== 'pending') continue
    const retained = await readJsonV1<RetainedPendingAttemptV1>(
      store,
      layout.attempt(
        entry.attemptSequence,
        entry.requestSha256,
        'request.json'
      ),
      `session ${sessionKey} pending attempt ${entry.attemptSequence}`
    )
    exactFieldsV1(
      retained,
      [
        'attempt',
        'invocationCorrelation',
        'request',
        'schemaVersion',
        'transportRequest',
      ],
      `session ${sessionKey} pending attempt wrapper`
    )
    exactFieldsV1(
      retained.attempt,
      [
        'attemptId',
        'namespaceSha256',
        'postHead',
        'preHead',
        'requestId',
        'requestSha256',
        'sequence',
        'state',
        'toolName',
      ],
      `session ${sessionKey} pending attempt`
    )
    if (
      retained.schemaVersion !== 1 ||
      retained.attempt.namespaceSha256 !== entry.namespaceSha256 ||
      retained.attempt.requestSha256 !== entry.requestSha256 ||
      retained.attempt.sequence !== entry.attemptSequence ||
      editCanonicalSha256V1(retained.request) !== entry.requestSha256 ||
      !/^[0-9a-f]{64}$/u.test(
        retained.invocationCorrelation.invocationSha256
      ) ||
      (retained.invocationCorrelation.boundaryKind !== 'directHost' &&
        retained.invocationCorrelation.boundaryKind !== 'mcp')
    )
      return refuse(`session ${sessionKey} pending attempt authority differs`)
    assertRetainedTransportDomainBindingV1(retained, sessionId)
    pending.push(retained)
  }
  return Object.freeze(pending)
}

async function retainedResultV1(
  store: EditArtifactStorePort,
  sessionKey: string,
  pending: RetainedPendingAttemptV1
): Promise<RecoveredAttemptOutcomeV1 | null>
{
  const key = editSessionLayoutV1(sessionKey).attempt(
    pending.attempt.sequence,
    pending.attempt.requestSha256,
    'result.json'
  )
  const present = (
    await store.listImmutable(key.replace(/\/result\.json$/u, ''))
  ).some((entry) => entry.key === key)
  if (!present) return null
  const retained = await readJsonV1<{ schemaVersion: 1; result: unknown }>(
    store,
    key,
    `session ${sessionKey} retained pending result`
  )
  exactFieldsV1(
    retained,
    ['result', 'schemaVersion'],
    `session ${sessionKey} retained pending result`
  )
  if (retained.schemaVersion !== 1)
    return refuse(
      `session ${sessionKey} retained pending result schema differs`
    )
  const record =
    retained.result !== null && typeof retained.result === 'object'
      ? (retained.result as Record<string, unknown>)
      : null
  const code = record?.['code']
  return Object.freeze(
    typeof code === 'string'
      ? {
          state: 'refused' as const,
          result: retained.result,
          refusalCode: code,
        }
      : { state: 'completed' as const, result: retained.result }
  )
}

async function committedTransitionResultV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly finalHead: Awaited<
    ReturnType<typeof verifyEditSessionReplayV1>
  >['finalHead']
  readonly report: EditKernelReportV1
  readonly events: readonly EditKernelSemanticEventV1[]
}): Promise<RecoveredAttemptOutcomeV1 | null>
{
  const expectedKind =
    input.pending.attempt.toolName === 'edit_apply'
      ? 'apply'
      : input.pending.attempt.toolName === 'edit_undo'
        ? 'undo'
        : input.pending.attempt.toolName === 'edit_rollback'
          ? 'rollback'
          : null
  if (expectedKind === null) return null
  const layout = editSessionLayoutV1(input.sessionKey)
  const record = await readJsonV1<EditKernelRevisionRecordV1>(
    input.store,
    layout.revision(
      input.finalHead.revisionNumber,
      input.finalHead.revisionId,
      'manifest.json'
    ),
    `session ${input.sessionKey} final revision`
  )
  if (
    record.revision.originatingRequestId !== input.pending.attempt.requestId ||
    record.transitionDescriptor.kind !== expectedKind
  )
    return null
  const prepared = input.events.filter(
    (event) =>
      event.projection.eventKind === 'transition-prepared' &&
      event.projection.postHead.revisionId === record.head.revisionId
  )
  const committed = input.events.filter(
    (event) =>
      event.projection.eventKind === 'transition-committed' &&
      event.projection.postHead.revisionId === record.head.revisionId
  )
  if (prepared.length !== 1 || committed.length !== 1)
    return refuse(
      `session ${input.sessionKey} committed transition lacks exact event authority`
    )
  if (
    prepared[0]!.projection.invocationCorrelation.invocationSha256 !==
      input.pending.invocationCorrelation.invocationSha256 ||
    prepared[0]!.projection.invocationCorrelation.boundaryKind !==
      input.pending.invocationCorrelation.boundaryKind ||
    committed[0]!.projection.invocationCorrelation.invocationSha256 !==
      input.pending.invocationCorrelation.invocationSha256 ||
    committed[0]!.projection.invocationCorrelation.boundaryKind !==
      input.pending.invocationCorrelation.boundaryKind
  )
    return refuse(
      `session ${input.sessionKey} committed transition invocation differs`
    )
  if (expectedKind === 'apply')
    return Object.freeze({
      state: 'completed',
      result: Object.freeze({
        head: input.finalHead,
        revisionId: record.head.revisionId,
        preparedEventSha256: prepared[0]!.eventSha256,
        committedEventSha256: committed[0]!.eventSha256,
        reportSha256: input.report.semanticProjectionSha256,
        operationResults: record.operationResults,
        operationResultSummaries: record.operationResultSummaries,
        budget: input.report.budget,
      }),
    })
  const predecessorNumber = record.head.revisionNumber - 1
  if (predecessorNumber < 0)
    return refuse(`session ${input.sessionKey} restore predecessor is absent`)
  const predecessorEntries = await input.store.listImmutable(
    `${layout.prefix}/revisions/${String(predecessorNumber).padStart(6, '0')}-`
  )
  const predecessorManifest = predecessorEntries.find((entry) =>
    entry.key.endsWith('/manifest.json')
  )
  if (predecessorManifest === undefined)
    return refuse(`session ${input.sessionKey} restore predecessor is absent`)
  const predecessor = await readJsonV1<EditKernelRevisionRecordV1>(
    input.store,
    predecessorManifest.key,
    `session ${input.sessionKey} restore predecessor`
  )
  const descriptor = record.transitionDescriptor
  if (descriptor.kind !== 'undo' && descriptor.kind !== 'rollback') return null
  const selectedEntries = await input.store.listImmutable(
    `${layout.prefix}/revisions/${String(
      descriptor.selectedRevision.revisionNumber
    ).padStart(6, '0')}-${descriptor.selectedRevision.revisionId}`
  )
  const selectedManifest = selectedEntries.find((entry) =>
    entry.key.endsWith('/manifest.json')
  )
  if (selectedManifest === undefined)
    return refuse(`session ${input.sessionKey} restore target is absent`)
  const selected = await readJsonV1<EditKernelRevisionRecordV1>(
    input.store,
    selectedManifest.key,
    `session ${input.sessionKey} restore target`
  )
  return Object.freeze({
    state: 'completed',
    result: Object.freeze({
      head: input.finalHead,
      restoreKind: descriptor.kind,
      fromRevision: predecessor.head,
      selectedRevision: selected.head,
      preparedEventSha256: prepared[0]!.eventSha256,
      committedEventSha256: committed[0]!.eventSha256,
      reportSha256: input.report.semanticProjectionSha256,
      budget: input.report.budget,
    }),
  })
}

async function committedCheckpointResultV1(input: {
  readonly store: EditArtifactStorePort
  readonly sessionKey: string
  readonly pending: RetainedPendingAttemptV1
  readonly events: readonly EditKernelSemanticEventV1[]
}): Promise<RecoveredAttemptOutcomeV1 | null>
{
  if (input.pending.attempt.toolName !== 'edit_checkpoint') return null
  const request = input.pending.request as {
    readonly label?: unknown
    readonly note?: unknown
    readonly expectedRevisionId?: unknown
    readonly expectedRevisionNumber?: unknown
  }
  const entries = await input.store.listImmutable(
    `${editSessionLayoutV1(input.sessionKey).prefix}/checkpoints`
  )
  const matches: EditKernelCheckpointV1[] = []
  for (const entry of entries)
  {
    const checkpoint = await readJsonV1<EditKernelCheckpointV1>(
      input.store,
      entry.key,
      `session ${input.sessionKey} retained checkpoint`
    )
    const event = input.events.find(
      (candidate) => candidate.eventSha256 === checkpoint.eventSha256
    )
    if (
      checkpoint.label === request.label &&
      checkpoint.note === request.note &&
      checkpoint.revision.revisionId === request.expectedRevisionId &&
      checkpoint.revision.revisionNumber === request.expectedRevisionNumber &&
      event?.projection.eventKind === 'checkpoint-recorded' &&
      event.projection.invocationCorrelation.invocationSha256 ===
        input.pending.invocationCorrelation.invocationSha256 &&
      event.projection.invocationCorrelation.boundaryKind ===
        input.pending.invocationCorrelation.boundaryKind &&
      event.projection.semanticPayloadSha256 ===
        editCanonicalSha256V1({
          checkpointId: checkpoint.checkpointId,
          label: checkpoint.label,
          ...(checkpoint.note === undefined ? {} : { note: checkpoint.note }),
          revision: checkpoint.revision,
        }) &&
      checkpoint.checkpointSha256 ===
        editCanonicalSha256V1({
          schemaVersion: 1,
          checkpointId: checkpoint.checkpointId,
          label: checkpoint.label,
          ...(checkpoint.note === undefined ? {} : { note: checkpoint.note }),
          revision: checkpoint.revision,
          eventSha256: checkpoint.eventSha256,
        })
    )
      matches.push(checkpoint)
  }
  if (matches.length === 0) return null
  if (matches.length !== 1)
    return refuse(
      `session ${input.sessionKey} checkpoint recovery is ambiguous`
    )
  return Object.freeze({ state: 'completed', result: matches[0]! })
}

function committedCloseResultV1(input: {
  readonly sessionId: string
  readonly pending: RetainedPendingAttemptV1
  readonly finalHead: Awaited<
    ReturnType<typeof verifyEditSessionReplayV1>
  >['finalHead']
  readonly report: EditKernelReportV1
  readonly events: readonly EditKernelSemanticEventV1[]
}): RecoveredAttemptOutcomeV1 | null
{
  if (input.pending.attempt.toolName !== 'edit_close') return null
  const request = input.pending.request as { readonly reason?: unknown }
  const matches = input.events.filter(
    (event) =>
      event.projection.eventKind === 'session-closed' &&
      event.projection.invocationCorrelation.invocationSha256 ===
        input.pending.invocationCorrelation.invocationSha256 &&
      event.projection.invocationCorrelation.boundaryKind ===
        input.pending.invocationCorrelation.boundaryKind &&
      event.projection.semanticPayloadSha256 ===
        editCanonicalSha256V1({
          reason: request.reason,
          terminalState: 'closed-unexported',
        }) &&
      event.eventSha256 === input.report.eventHeadSha256
  )
  if (matches.length === 0) return null
  if (matches.length !== 1)
    return refuse('close recovery has ambiguous terminal event authority')
  const result = Object.freeze({
    terminalState: 'closed-unexported' as const,
    head: input.finalHead,
    eventSha256: matches[0]!.eventSha256,
    reportSha256: input.report.semanticProjectionSha256,
    retentionProofSha256: editCanonicalSha256V1({
      kind: 'edit-close-retention-proof',
      sessionId: input.sessionId,
      finalHead: input.finalHead,
      eventSha256: matches[0]!.eventSha256,
      reportSha256: input.report.semanticProjectionSha256,
      retainedPreviewCount: 0,
      awaitingEvaluationCount: 0,
    }),
  })
  return Object.freeze({ state: 'completed', result })
}

function exportDirectoryV1(
  sessionKey: string,
  sequence: number,
  exportSha256: string
): string
{
  return editSessionLayoutV1(sessionKey)
    .export(sequence, exportSha256, '000000-intent.json')
    .replace(/\/000000-intent\.json$/u, '')
}

async function incompleteExportV1(
  input: RecoverRetainedEditSessionsInputV1,
  sessionKey: string,
  pending: RetainedPendingAttemptV1,
  recoveryContext: {
    readonly sessionId: string
    readonly finalHead: Awaited<
      ReturnType<typeof verifyEditSessionReplayV1>
    >['finalHead']
    readonly eventHeadSha256: string
    readonly eventSequence: number
    readonly events: readonly EditKernelSemanticEventV1[]
    readonly semanticReportSha256: string
  }
): Promise<PublicationRecoveryClassificationV1 | null>
{
  if (pending.attempt.toolName !== 'edit_export') return null
  const layout = editSessionLayoutV1(sessionKey)
  const entries = await input.artifactStore.listImmutable(
    `${layout.prefix}/exports`
  )
  const intents = entries.filter((entry) =>
    entry.key.endsWith('/000000-intent.json')
  )
  const matches: {
    readonly sequence: number
    readonly directory: string
    readonly intent: RetainedExportIntentV1
  }[] = []
  for (const entry of intents)
  {
    const intent = await readJsonV1<RetainedExportIntentV1>(
      input.artifactStore,
      entry.key,
      `session ${sessionKey} export intent`
    )
    exactFieldsV1(
      intent,
      [
        'auditRecordSha256',
        'certificateSha256',
        'deniedDestinationSetSha256',
        'expectedFinalName',
        'exportId',
        'exportSha256',
        'exportedRevision',
        'historySha256',
        'invocationCorrelation',
        'outputReservationId',
        'outputReservationSha256',
        'publicationDirectory',
        'publicationRootId',
        'publicationRootOwnershipSha256',
        'recoveryAuthority',
        'schemaVersion',
        'semanticSourceSha256',
        'sourceArtifactSha256',
        'sourceProvenanceEvidenceSha256',
      ],
      `session ${sessionKey} export intent`
    )
    if (intent.auditRecordSha256 !== pending.attempt.requestSha256) continue
    if (
      intent.invocationCorrelation.invocationSha256 !==
        pending.invocationCorrelation.invocationSha256 ||
      intent.invocationCorrelation.boundaryKind !==
        pending.invocationCorrelation.boundaryKind
    )
      return refuse(`session ${sessionKey} export invocation authority differs`)
    const name = entry.key.slice(`${layout.prefix}/exports/`.length)
    const sequenceText = name.slice(0, name.indexOf('-'))
    const sequence = Number(sequenceText)
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      return refuse(`session ${sessionKey} export intent is not ordinal-named`)
    matches.push({
      sequence,
      directory: exportDirectoryV1(sessionKey, sequence, intent.exportSha256),
      intent,
    })
  }
  if (matches.length === 0) return null
  if (matches.length !== 1)
    return refuse(
      `session ${sessionKey} has ambiguous pending export authority`
    )
  const retained = matches[0]!
  const names = new Map(
    entries
      .filter((entry) => entry.key.startsWith(`${retained.directory}/`))
      .map((entry) => [entry.key.slice(retained.directory.length + 1), entry])
  )
  if (names.has('000004-completed.json'))
  {
    const completed = await readJsonV1<{
      readonly schemaVersion: 1
      readonly exportId: string
      readonly result: unknown
    }>(
      input.artifactStore,
      names.get('000004-completed.json')!.key,
      `session ${sessionKey} completed export`
    )
    exactFieldsV1(
      completed,
      ['exportId', 'result', 'schemaVersion'],
      `session ${sessionKey} completed export`
    )
    if (
      completed.schemaVersion !== 1 ||
      completed.exportId !== retained.intent.exportId
    )
      return refuse(`session ${sessionKey} completed export identity differs`)
    return Object.freeze({
      attemptResult: completed.result,
      attemptState: 'completed' as const,
      closePayload: null,
      artifacts: Object.freeze([]),
    })
  }
  if (names.has('000003-external-interference.json'))
    return refuse(
      `session ${sessionKey} terminal interference lacks its retained attempt result`
    )
  const candidate = await input.artifactStore.readImmutable(
    layout.revision(
      retained.intent.exportedRevision.revisionNumber,
      retained.intent.exportedRevision.revisionId,
      'candidate.sb3'
    )
  )
  if (sha256Hex(candidate) !== retained.intent.exportedRevision.candidateSha256)
    return refuse(`session ${sessionKey} export candidate identity differs`)
  const preparedEntry = names.get('000001-prepared.json')
  const prepared =
    preparedEntry === undefined
      ? null
      : await readJsonV1<RetainedPreparedExportV1>(
          input.artifactStore,
          preparedEntry.key,
          `session ${sessionKey} prepared export`
        )
  if (prepared !== null)
    exactFieldsV1(
      prepared,
      [
        'candidateByteLength',
        'candidateSha256',
        'directoryCanonicalRealpath',
        'directoryDevice',
        'directoryInode',
        'exportId',
        'preparedAtEpochMs',
        'preparedProofSha256',
        'publicationRootId',
        'publicationRootOwnershipSha256',
        'schemaVersion',
        'tempBasename',
        'tempDevice',
        'tempInode',
        'tempMode',
      ],
      `session ${sessionKey} prepared export`
    )
  if (
    prepared !== null &&
    (prepared.exportId !== retained.intent.exportId ||
      prepared.publicationRootId !== retained.intent.publicationRootId ||
      prepared.publicationRootOwnershipSha256 !==
        retained.intent.publicationRootOwnershipSha256 ||
      prepared.tempBasename !== retained.intent.recoveryAuthority ||
      prepared.candidateSha256 !== sha256Hex(candidate) ||
      prepared.candidateByteLength !== candidate.byteLength ||
      prepared.directoryCanonicalRealpath !==
        retained.intent.publicationDirectory.canonicalRealpath ||
      prepared.directoryDevice !==
        retained.intent.publicationDirectory.device ||
      prepared.directoryInode !== retained.intent.publicationDirectory.inode ||
      prepared.preparedProofSha256 !==
        editExportPreparedProofSha256V1({
          schemaVersion: 1,
          publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
          basename: retained.intent.expectedFinalName,
          candidateSha256: sha256Hex(candidate),
          candidateByteLength: candidate.byteLength,
          nameDurableBeforeWrite: true,
          fileSynced: true,
          readbackVerified: true,
        }))
  )
    return refuse(`session ${sessionKey} prepared export proof differs`)
  if (names.has('semantic-receipt.json'))
  {
    if (
      prepared === null ||
      !names.has('000002-link-observed.json') ||
      !names.has('000003-published.json')
    )
      return refuse(
        `session ${sessionKey} semantic receipt lacks its pre-receipt publication chain`
      )
    const retainedReceipt = await readJsonV1<{
      readonly schemaVersion: 1
      readonly receipt: EditSemanticExportReceiptV1
      readonly receiptSha256: string
    }>(
      input.artifactStore,
      names.get('semantic-receipt.json')!.key,
      `session ${sessionKey} semantic receipt`
    )
    const published = await readJsonV1<{
      readonly schemaVersion: 1
      readonly exportId: string
      readonly publicationProofSha256: string
      readonly reopenSha256: string
      readonly sourcePreservationSha256: string
      readonly gateSha256: string
    }>(
      input.artifactStore,
      names.get('000003-published.json')!.key,
      `session ${sessionKey} published export`
    )
    const link = await readJsonV1<{
      readonly schemaVersion: 1
      readonly exportId: string
      readonly linkCreated: boolean
      readonly directorySynced: boolean
      readonly finalDevice: string
      readonly finalInode: string
      readonly byteLength: number
    }>(
      input.artifactStore,
      names.get('000002-link-observed.json')!.key,
      `session ${sessionKey} linked export`
    )
    const receiptSha256 = editSemanticExportReceiptSha256V1(
      retainedReceipt.receipt
    )
    if (
      retainedReceipt.schemaVersion !== 1 ||
      retainedReceipt.receiptSha256 !== receiptSha256 ||
      retainedReceipt.receipt.publishedSha256 !== sha256Hex(candidate) ||
      retainedReceipt.receipt.publishedByteLength !== candidate.byteLength ||
      retainedReceipt.receipt.basename !== retained.intent.expectedFinalName ||
      retainedReceipt.receipt.preparedProofSha256 !==
        prepared.preparedProofSha256 ||
      published.schemaVersion !== 1 ||
      published.exportId !== retained.intent.exportId ||
      published.reopenSha256 !== retainedReceipt.receipt.reopenSha256 ||
      published.sourcePreservationSha256 !==
        retainedReceipt.receipt.sourcePreservationSha256 ||
      published.gateSha256 !== retainedReceipt.receipt.gateSha256 ||
      link.schemaVersion !== 1 ||
      link.exportId !== retained.intent.exportId ||
      !link.linkCreated ||
      !link.directorySynced ||
      link.finalDevice !== prepared.tempDevice ||
      link.finalInode !== prepared.tempInode ||
      link.byteLength !== candidate.byteLength
    )
      return refuse(`session ${sessionKey} semantic receipt chain differs`)
    const closePayload = Object.freeze({
      reason: 'export-published' as const,
      terminalState: 'closed-exported' as const,
      receiptSha256,
      publicationProofSha256: published.publicationProofSha256,
    })
    const existingEvent = recoveryContext.events.find(
      (event) =>
        event.projection.eventKind === 'session-closed' &&
        event.projection.semanticPayloadSha256 ===
          editCanonicalSha256V1(closePayload)
    )
    const eventSha256 =
      existingEvent?.eventSha256 ??
      semanticHashV1('semantic-event', {
        schemaVersion: 1,
        sessionId: recoveryContext.sessionId,
        sequence: recoveryContext.eventSequence,
        eventKind: 'session-closed',
        previousEventSha256: recoveryContext.eventHeadSha256,
        preHead: {
          state: 'present',
          head: exactRevisionFromHeadV1(recoveryContext.finalHead),
        },
        postHead: exactRevisionFromHeadV1(recoveryContext.finalHead),
        semanticPayloadSha256: editCanonicalSha256V1(closePayload),
        invocationCorrelation: pending.invocationCorrelation,
      })
    const committedAtEpochMs = (input.clock ?? SYSTEM_EDIT_CLOCK).nowEpochMs()
    const provenance: EditExportProvenanceV1 = Object.freeze({
      schemaVersion: 1,
      exportId: retained.intent.exportId,
      reservationId: retained.intent.outputReservationId,
      reservationSha256: retained.intent.outputReservationSha256,
      publicationRootId: retained.intent.publicationRootId,
      publicationRootOwnershipSha256:
        retained.intent.publicationRootOwnershipSha256,
      directoryCanonicalRealpath:
        retained.intent.publicationDirectory.canonicalRealpath,
      directoryDevice: retained.intent.publicationDirectory.device,
      directoryInode: retained.intent.publicationDirectory.inode,
      directoryMode: retained.intent.publicationDirectory.mode,
      tempCanonicalPath: `${retained.intent.publicationDirectory.canonicalRealpath}/${prepared.tempBasename}`,
      tempDevice: prepared.tempDevice,
      tempInode: prepared.tempInode,
      tempMode: prepared.tempMode,
      finalCanonicalPath: `${retained.intent.publicationDirectory.canonicalRealpath}/${retained.intent.expectedFinalName}`,
      finalDevice: link.finalDevice,
      finalInode: link.finalInode,
      nameDurableBeforeWrite: true,
      fileSynced: true,
      readbackVerified: true,
      linkCreated: true,
      directorySynced: true,
      postCommitIdentityMatched: true,
      tempReleased: true,
      deniedDestinationSetSha256: retained.intent.deniedDestinationSetSha256,
      originalSourceCheckSha256:
        retainedReceipt.receipt.sourcePreservationSha256,
      preparedAtEpochMs: prepared.preparedAtEpochMs,
      committedAtEpochMs,
      recoveryAuthority: retained.intent.recoveryAuthority,
      auditRecordSha256: pending.attempt.requestSha256,
      reportSha256: recoveryContext.semanticReportSha256,
      eventSha256,
    })
    const publicationEvidenceId = editOpaqueIdV1(
      'pubevid',
      new TextEncoder().encode(receiptSha256).subarray(0, 16),
      { exportId: retained.intent.exportId, receiptSha256 }
    )
    const result = Object.freeze({
      terminalState: 'closed-exported' as const,
      exportedRevision: retained.intent.exportedRevision,
      certificateSha256: retainedReceipt.receipt.certificateSha256,
      outputReservationId: retained.intent.outputReservationId,
      outputReservationSha256: retained.intent.outputReservationSha256,
      publicationEvidenceId,
      publicationProofSha256: published.publicationProofSha256,
      publishedByteLength: candidate.byteLength,
      publishedSha256: sha256Hex(candidate),
      reopenSha256: retainedReceipt.receipt.reopenSha256,
      sourcePreservationSha256:
        retainedReceipt.receipt.sourcePreservationSha256,
      eventSha256,
      reportSha256: recoveryContext.semanticReportSha256,
      receiptSha256,
    })
    const artifacts = [] as { readonly key: string; readonly value: unknown }[]
    if (!names.has('provenance.json'))
      artifacts.push({
        key: `${retained.directory}/provenance.json`,
        value: {
          schemaVersion: 1,
          provenance,
          provenanceSha256: editExportProvenanceSha256V1(provenance),
        },
      })
    artifacts.push({
      key: `${retained.directory}/000004-completed.json`,
      value: { schemaVersion: 1, exportId: retained.intent.exportId, result },
    })
    return Object.freeze({
      attemptResult: result,
      attemptState: 'completed',
      closePayload,
      artifacts: Object.freeze(artifacts),
    })
  }
  if (input.openPublicationRecoveryPort === undefined)
    return refuse(
      `session ${sessionKey} requires publication recovery authority`
    )
  const authority: EditPublicationRecoveryAuthorityV1 = Object.freeze({
    publicationRootId: retained.intent.publicationRootId,
    publicationRootOwnershipSha256:
      retained.intent.publicationRootOwnershipSha256,
    directory: retained.intent.publicationDirectory,
    reservationId: retained.intent.outputReservationId,
    reservationSha256: retained.intent.outputReservationSha256,
    basename: retained.intent.expectedFinalName,
    tempBasename: retained.intent.recoveryAuthority,
    tempDevice: prepared?.tempDevice ?? null,
    tempInode: prepared?.tempInode ?? null,
    tempMode: prepared?.tempMode ?? null,
    candidateSha256: sha256Hex(candidate),
    candidateByteLength: candidate.byteLength,
  })
  const port = await input.openPublicationRecoveryPort(authority)
  const adopted = await port.adoptRetainedPreparation(authority)
  const retainedReservation = Object.freeze({
    reservationId: authority.reservationId,
    reservationSha256: authority.reservationSha256,
    basename: authority.basename,
    finalCanonicalPath: join(
      authority.directory.canonicalRealpath,
      authority.basename
    ),
    directory: authority.directory,
  })
  if (
    !isPreparedPublicationBoundV1({
      prepared: adopted,
      reservation: retainedReservation,
      recoveryAuthority: authority.tempBasename,
      candidateSha256: authority.candidateSha256,
      candidateByteLength: authority.candidateByteLength,
    })
  )
    return refuse(`session ${sessionKey} adopted publication proof differs`)
  const inspection = await port.inspectPublicationNames(adopted.preparationId)
  if (!isPublicationInspectionBoundV1(adopted, inspection))
    return refuse(`session ${sessionKey} publication inspection differs`)
  const ordinals = [...names.keys()]
    .map((name) => /^recovery-([0-9]{6})\.json$/u.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  const ordinal = String(
    ordinals.length === 0 ? 0 : Math.max(...ordinals) + 1
  ).padStart(6, '0')
  const artifacts: { readonly key: string; readonly value: unknown }[] = [
    {
      key: `${retained.directory}/recovery-${ordinal}.json`,
      value: {
        schemaVersion: 1,
        exportId: retained.intent.exportId,
        inspection,
      },
    },
  ]
  if (!inspection.finalPresent)
  {
    await port.releasePrepared(adopted.preparationId)
    const cleanup = await port.inspectPublicationNames(adopted.preparationId)
    if (
      !isPublicationInspectionBoundV1(adopted, cleanup) ||
      cleanup.tempPresent ||
      cleanup.finalPresent
    )
      return refuse(`session ${sessionKey} publication cleanup is incomplete`)
    artifacts.push({
      key: `${retained.directory}/000002-failed-before-publish.json`,
      value: {
        schemaVersion: 1,
        code: 'edit.interrupted',
        auditRecordSha256: pending.attempt.requestSha256,
        publicationCommitted: false,
        preparationExisted: true,
        cleanupRequired: true,
        finalObservation: inspection,
        finalObservationFailureSha256: null,
        cleanupCompleted: true,
        cleanupDirectorySynced: true,
        cleanupObservation: cleanup,
        cleanupObservationFailureSha256: null,
        cleanupFailureSha256: null,
        recoveryRequired: false,
      },
    })
    return Object.freeze({
      attemptResult: Object.freeze({
        ok: false,
        code: 'edit.interrupted',
        safeMessage:
          'exclusive predecessor recovery abandoned an incomplete unpublished export',
        context: Object.freeze({}),
      }),
      attemptState: 'refused',
      refusalCode: 'edit.interrupted',
      closePayload: null,
      artifacts: Object.freeze(artifacts),
    })
  }
  let disposition: 'committedCandidateUnattested' | 'unexpectedFinalIdentity'
  let interferenceEvidenceSha256: string
  if (inspection.finalMatchesProof)
  {
    const commit = await port.syncPublicationDirectory(adopted.preparationId)
    const verification = await port.verifyCommitted(adopted.preparationId)
    if (
      !isPublicationCommitBoundV1(adopted, commit) ||
      !isPublicationVerificationBoundV1(adopted, commit, verification)
    )
      return refuse(`session ${sessionKey} recovered final proof differs`)
    artifacts.push({
      key: `${retained.directory}/000002-link-observed.json`,
      value: {
        schemaVersion: 1,
        exportId: retained.intent.exportId,
        linkCreated: commit.linkCreated,
        directorySynced: commit.directorySynced,
        finalDevice: commit.device,
        finalInode: commit.inode,
        byteLength: commit.byteLength,
      },
    })
    disposition = 'committedCandidateUnattested'
    interferenceEvidenceSha256 = editCanonicalSha256V1({
      kind: 'committed-candidate-unattested',
      link: {
        linkCreated: commit.linkCreated,
        directorySynced: commit.directorySynced,
        finalDevice: commit.device,
        finalInode: commit.inode,
        byteLength: commit.byteLength,
      },
    })
  }
  else
  {
    disposition = 'unexpectedFinalIdentity'
    interferenceEvidenceSha256 = editCanonicalSha256V1({
      kind: 'unexpected-final-identity',
      inspection,
    })
  }
  if (inspection.tempPresent && inspection.tempMatchesProof)
    await port.releasePrepared(adopted.preparationId)
  const closePayload = Object.freeze({
    reason: 'post-publication-interference' as const,
    terminalState: 'closed-abandoned' as const,
    exportId: retained.intent.exportId,
    disposition,
    interferenceEvidenceSha256,
    receiptIssued: false as const,
  })
  return Object.freeze({
    attemptResult: Object.freeze({
      ok: false,
      code: 'edit.publication_interference',
      safeMessage:
        'exclusive predecessor recovery terminalized an incomplete publication without issuing a receipt',
      disposition,
    }),
    attemptState: 'refused',
    refusalCode: 'edit.publication_interference',
    closePayload,
    artifacts: Object.freeze(artifacts),
  })
}

async function buildTerminalPlanV1(
  input: RecoverRetainedEditSessionsInputV1,
  sessionKey: string,
  contract: BoundChangeContractV1
): Promise<RetainedTerminalPlanV1 | null>
{
  const layout = editSessionLayoutV1(sessionKey)
  const replay = await verifyEditSessionReplayV1({
    artifactStore: input.artifactStore,
    sessionKey,
    boundChangeContract: contract,
    transactionExecutor: new ProductionTransactionExecutorV1(),
  })
  const alreadyTerminal =
    replay.state === 'closed-abandoned' ||
    replay.state === 'closed-unexported' ||
    replay.state === 'closed-exported'
  if (alreadyTerminal && replay.verifiedPendingAttemptCount === 0)
  {
    if (!replay.ok)
      return refuse(
        `session ${sessionKey} terminal replay failed: ${replay.failures.join('; ')}`
      )
    return null
  }
  if (!replay.recoverySafe)
    return refuse(
      `session ${sessionKey} is not a structurally safe recovery source: ${replay.failures.join('; ')}`
    )
  const reportPointerBytes = await input.artifactStore.readImmutable(
    layout.currentReport
  )
  const reportPointer = decodeJsonV1<RetainedPointerV1>(
    reportPointerBytes,
    `session ${sessionKey} report pointer`
  )
  let currentReport = await readJsonV1<EditKernelReportV1>(
    input.artifactStore,
    layout.report(reportPointer.reportJsonSha256, 'report.json'),
    `session ${sessionKey} current report`
  )
  const indexBytes = await input.artifactStore.readImmutable(
    layout.idempotencyIndex
  )
  const index = decodeJsonV1<RetainedAttemptIndexV1>(
    indexBytes,
    `session ${sessionKey} idempotency index`
  )
  const pending = await pendingAttemptsV1(
    input.artifactStore,
    sessionKey,
    replay.sessionId,
    index
  )
  const previewAuthorities = (
    await input.artifactStore.listImmutable(`${layout.prefix}/attempts`)
  ).filter((entry) => entry.key.endsWith('/recovery-authority.json'))
  const evictionsByKey = new Map<string, string>()
  for (const entry of previewAuthorities)
  {
    const authority = await readJsonV1<Record<string, unknown>>(
      input.artifactStore,
      entry.key,
      `session ${sessionKey} retained preview authority`
    )
    if (authority['kind'] !== 'preview-recovery-authority-v1') continue
    const preview = authority['preview'] as Record<string, unknown>
    const key = preview['candidateCacheKey']
    const expectedSha256 = preview['predictedCandidateSha256']
    if (
      typeof key !== 'string' ||
      typeof expectedSha256 !== 'string' ||
      key !== layout.preview(expectedSha256)
    )
      return refuse(`session ${sessionKey} preview eviction authority differs`)
    const existing = evictionsByKey.get(key)
    if (existing !== undefined && existing !== expectedSha256)
      return refuse(`session ${sessionKey} preview eviction identity differs`)
    const retainedSha256 = await input.artifactStore
      .hashImmutable(key)
      .catch(() => null)
    if (retainedSha256 !== null && retainedSha256 !== expectedSha256)
      return refuse(`session ${sessionKey} preview cache hash differs`)
    evictionsByKey.set(key, expectedSha256)
  }
  const eventEntries = (
    await input.artifactStore.listImmutable(`${layout.prefix}/events`)
  ).filter((entry) => entry.key.endsWith('.json'))
  const events = await Promise.all(
    eventEntries.map((entry) =>
      readJsonV1<EditKernelSemanticEventV1>(
        input.artifactStore,
        entry.key,
        `session ${sessionKey} retained event`
      )
    )
  )
  events.sort(
    (left, right) => left.projection.sequence - right.projection.sequence
  )
  const results = new Map<string, RecoveredAttemptOutcomeV1>()
  let publication: PublicationRecoveryClassificationV1 | null = null
  const quotaSettlements: RetainedTerminalPlanV1['quotaSettlements'][number][] =
    []
  const quotaReleases: RetainedTerminalPlanV1['quotaReleases'][number][] = []
  const recoveredCertificates: EditRetainedCertificateV1[] = []
  const recoveredEvaluationReportSha256s: string[] = []
  let recoveredCompletionQuotaBytes = 0
  const attemptRecoveryArtifacts: {
    readonly key: string
    readonly value: unknown
    readonly mimeType?: EditRetainedResourceMimeTypeV1 | null
  }[] = []
  const revisionRecovery = await recoverRevisionAttemptsV1({
    store: input.artifactStore,
    sessionId: replay.sessionId,
    sessionKey,
    finalHead: replay.finalHead,
    pending,
    events,
    clock: input.clock ?? SYSTEM_EDIT_CLOCK,
  })
  attemptRecoveryArtifacts.push(...revisionRecovery.artifacts)
  quotaSettlements.push(...revisionRecovery.settlements)
  quotaReleases.push(...revisionRecovery.releases)
  for (const [namespaceSha256, outcome] of revisionRecovery.outcomes)
    results.set(namespaceSha256, outcome)
  if (revisionRecovery.postCommitBudget !== null)
  {
    const revisionManifestEntries = (
      await input.artifactStore.listImmutable(`${layout.prefix}/revisions`)
    ).filter((entry) => entry.key.endsWith('/manifest.json'))
    const retainedRevisions = await Promise.all(
      revisionManifestEntries.map((entry) =>
        readJsonV1<EditKernelRevisionRecordV1>(
          input.artifactStore,
          entry.key,
          `session ${sessionKey} retained revision`
        )
      )
    )
    const revisionsById = new Map(
      retainedRevisions.map((record) => [record.head.revisionId, record])
    )
    const revisions: EditKernelRevisionRecordV1[] = []
    let cursor = revisionsById.get(replay.finalHead.revisionId)
    while (cursor !== undefined)
    {
      revisions.unshift(cursor)
      const predecessor = cursor.revision.hashProjection.predecessor
      cursor =
        predecessor.state === 'absent'
          ? undefined
          : revisionsById.get(predecessor.revisionId)
    }
    if (revisions.length !== replay.verifiedRevisionCount)
      return refuse(`session ${sessionKey} revision recovery chain differs`)
    const certificateEntries = (
      await input.artifactStore.listImmutable(`${layout.prefix}/evaluations`)
    ).filter((entry) => entry.key.endsWith('/retained-certificate.json'))
    const certificates = await Promise.all(
      certificateEntries.map(
        async (entry) =>
          (
            await readJsonV1<{ readonly retained: EditRetainedCertificateV1 }>(
              input.artifactStore,
              entry.key,
              `session ${sessionKey} retained evaluation certificate`
            )
          ).retained
      )
    )
    certificates.sort((left, right) => left.sequence - right.sequence)
    const manifest = await readJsonV1<{
      readonly semanticSourceSha256: string
      readonly changeContractSha256: string
      readonly capabilityProfileSha256: string
    }>(input.artifactStore, layout.session, `session ${sessionKey} manifest`)
    const semantic = semanticReportProjectionV1(
      manifest.semanticSourceSha256,
      manifest.changeContractSha256,
      manifest.capabilityProfileSha256,
      revisions,
      certificateSetProjectionV1(certificates).sha256
    )
    currentReport = Object.freeze({
      ...currentReport,
      semanticProjection: semantic.projection,
      semanticProjectionSha256: semantic.sha256,
      reportArtifactSha256: editCanonicalSha256V1(semantic.projection),
      budget: revisionRecovery.postCommitBudget,
      eventHeadSha256: events.at(-1)!.eventSha256,
      revisionCount: revisions.length,
    })
  }
  const awaitingRecovery = await recoverAwaitingEvaluationsV1({
    store: input.artifactStore,
    sessionId: replay.sessionId,
    sessionKey,
    finalHead: replay.finalHead,
    events,
    pending,
    invocation: input.invocation,
    clock: input.clock ?? SYSTEM_EDIT_CLOCK,
  })
  attemptRecoveryArtifacts.push(...awaitingRecovery.artifacts)
  quotaSettlements.push(...awaitingRecovery.quotaSettlements)
  for (const [namespaceSha256, outcome] of awaitingRecovery.outcomes)
    results.set(namespaceSha256, outcome)
  if (awaitingRecovery.evaluationState !== null)
    currentReport = Object.freeze({
      ...currentReport,
      budget: Object.freeze({
        ...currentReport.budget,
        artifactBytesUsed:
          currentReport.budget.artifactBytesUsed +
          awaitingRecovery.quotaSettlements.reduce(
            (total, settlement) => total + settlement.actualBytes,
            0
          ),
      }),
      eventHeadSha256: events.at(-1)!.eventSha256,
      evaluationState: awaitingRecovery.evaluationState,
    })
  for (const attempt of pending)
  {
    if (results.has(attempt.attempt.namespaceSha256)) continue
    const retained = await retainedResultV1(
      input.artifactStore,
      sessionKey,
      attempt
    )
    if (retained !== null)
    {
      results.set(attempt.attempt.namespaceSha256, retained)
      continue
    }
    const classified = await incompleteExportV1(input, sessionKey, attempt, {
      sessionId: replay.sessionId,
      finalHead: replay.finalHead,
      eventHeadSha256: replay.eventHeadSha256,
      eventSequence: events.length,
      events,
      semanticReportSha256: currentReport.semanticProjectionSha256,
    })
    if (classified !== null)
    {
      if (publication !== null)
        return refuse(`session ${sessionKey} has multiple incomplete exports`)
      publication = classified
      results.set(
        attempt.attempt.namespaceSha256,
        Object.freeze({
          state: classified.attemptState,
          result: classified.attemptResult,
          ...(classified.refusalCode === undefined
            ? {}
            : { refusalCode: classified.refusalCode }),
        })
      )
      continue
    }
    const committedTransition = await committedTransitionResultV1({
      store: input.artifactStore,
      sessionKey,
      pending: attempt,
      finalHead: replay.finalHead,
      report: currentReport,
      events,
    })
    if (committedTransition !== null)
    {
      results.set(attempt.attempt.namespaceSha256, committedTransition)
      continue
    }
    const sameHead = await retainedSameHeadAuthorityV1({
      store: input.artifactStore,
      sessionId: replay.sessionId,
      sessionKey,
      pending: attempt,
      events,
      clock: input.clock ?? SYSTEM_EDIT_CLOCK,
      contract,
      preBudget: currentReport.budget,
    })
    if (sameHead !== null)
    {
      results.set(attempt.attempt.namespaceSha256, sameHead.outcome)
      attemptRecoveryArtifacts.push(...sameHead.artifacts)
      if (sameHead.quotaSettlement !== undefined)
        quotaSettlements.push(sameHead.quotaSettlement)
      if (sameHead.quotaRelease !== undefined)
        quotaReleases.push(sameHead.quotaRelease)
      if (
        sameHead.event !== undefined &&
        !events.some(
          (event) => event.eventSha256 === sameHead.event!.eventSha256
        )
      )
        events.push(sameHead.event)
      if (
        attempt.attempt.toolName === 'edit_asset_admit' &&
        sameHead.outcome.state === 'completed' &&
        sameHead.outcome.result !== null &&
        typeof sameHead.outcome.result === 'object'
      )
      {
        const budget = (sameHead.outcome.result as Record<string, unknown>)[
          'budget'
        ] as EditKernelReportV1['budget']
        currentReport = Object.freeze({
          ...currentReport,
          budget,
          eventHeadSha256: events.at(-1)!.eventSha256,
        })
      }
      continue
    }
    const checkpoint = await committedCheckpointResultV1({
      store: input.artifactStore,
      sessionKey,
      pending: attempt,
      events,
    })
    if (checkpoint !== null)
    {
      results.set(attempt.attempt.namespaceSha256, checkpoint)
      continue
    }
    const close = committedCloseResultV1({
      sessionId: replay.sessionId,
      pending: attempt,
      finalHead: replay.finalHead,
      report: currentReport,
      events,
    })
    if (close !== null)
    {
      results.set(attempt.attempt.namespaceSha256, close)
      continue
    }
    const committedEvaluation = await committedEvaluationResultV1({
      store: input.artifactStore,
      sessionKey,
      pending: attempt,
      events,
      clock: input.clock ?? SYSTEM_EDIT_CLOCK,
    })
    if (committedEvaluation !== null)
    {
      results.set(attempt.attempt.namespaceSha256, committedEvaluation.outcome)
      attemptRecoveryArtifacts.push(...committedEvaluation.artifacts)
      quotaSettlements.push(committedEvaluation.quotaSettlement)
      recoveredCompletionQuotaBytes +=
        committedEvaluation.quotaSettlement.actualBytes
      recoveredCertificates.push(committedEvaluation.retainedCertificate)
      recoveredEvaluationReportSha256s.push(committedEvaluation.reportSha256)
      if (
        !events.some(
          (event) => event.eventSha256 === committedEvaluation.event.eventSha256
        )
      )
      {
        events.push(committedEvaluation.event)
        events.sort(
          (left, right) => left.projection.sequence - right.projection.sequence
        )
      }
      continue
    }
    const abandonedEvaluation = await abandonPreparedEvaluationV1({
      store: input.artifactStore,
      sessionKey,
      pending: attempt,
    })
    if (abandonedEvaluation !== null)
    {
      results.set(attempt.attempt.namespaceSha256, abandonedEvaluation.outcome)
      attemptRecoveryArtifacts.push(abandonedEvaluation.artifact)
      continue
    }
    const expectedEventKind =
      attempt.attempt.toolName === 'edit_asset_admit'
        ? 'asset-admitted'
        : attempt.attempt.toolName === 'edit_preview'
          ? 'preview-recorded'
          : attempt.attempt.toolName === 'edit_checkpoint'
            ? 'checkpoint-recorded'
            : null
    const committedSameHeadEvents =
      expectedEventKind === null
        ? []
        : events.filter(
            (event) =>
              event.projection.eventKind === expectedEventKind &&
              event.projection.invocationCorrelation.invocationSha256 ===
                attempt.invocationCorrelation.invocationSha256 &&
              event.projection.invocationCorrelation.boundaryKind ===
                attempt.invocationCorrelation.boundaryKind &&
              attempt.attempt.preHead !== null &&
              event.projection.preHead.state === 'present' &&
              editCanonicalSha256V1(event.projection.preHead.head) ===
                editCanonicalSha256V1(attempt.attempt.preHead) &&
              editCanonicalSha256V1(event.projection.postHead) ===
                editCanonicalSha256V1(attempt.attempt.preHead)
          )
    if (committedSameHeadEvents.length > 1)
      return refuse(
        `session ${sessionKey} pending ${attempt.attempt.toolName} has ambiguous committed event authority`
      )
    if (committedSameHeadEvents.length === 1)
      attemptRecoveryArtifacts.push({
        key: `${layout.prefix}/recovery/attempt-${String(
          attempt.attempt.sequence
        ).padStart(6, '0')}-abandoned.json`,
        value: Object.freeze({
          schemaVersion: 1,
          kind: 'retained-stateful-attempt-abandoned-v1',
          attemptSequence: attempt.attempt.sequence,
          namespaceSha256: attempt.attempt.namespaceSha256,
          requestSha256: attempt.attempt.requestSha256,
          toolName: attempt.attempt.toolName,
          eventSha256: committedSameHeadEvents[0]!.eventSha256,
          invocationCorrelation: attempt.invocationCorrelation,
          disposition: 'retained-semantic-event-abandoned-at-terminal-recovery',
        }),
      })
    results.set(
      attempt.attempt.namespaceSha256,
      Object.freeze({
        state: 'refused',
        refusalCode: 'edit.interrupted',
        result: Object.freeze({
          ok: false,
          code: 'edit.interrupted',
          safeMessage:
            'exclusive predecessor recovery terminalized an incomplete request',
          context: Object.freeze({}),
        }),
      })
    )
  }
  if (recoveredCertificates.length > 0)
  {
    const retainedCertificateEntries = (
      await input.artifactStore.listImmutable(`${layout.prefix}/evaluations`)
    ).filter((entry) => entry.key.endsWith('/retained-certificate.json'))
    const certificates = await Promise.all(
      retainedCertificateEntries.map(
        async (entry) =>
          (
            await readJsonV1<{ readonly retained: EditRetainedCertificateV1 }>(
              input.artifactStore,
              entry.key,
              `session ${sessionKey} retained evaluation certificate`
            )
          ).retained
      )
    )
    for (const recovered of recoveredCertificates)
      if (
        !certificates.some(
          (certificate) => certificate.attemptSha256 === recovered.attemptSha256
        )
      )
        certificates.push(recovered)
    certificates.sort((left, right) => left.sequence - right.sequence)
    const revisionEntries = (
      await input.artifactStore.listImmutable(`${layout.prefix}/revisions`)
    ).filter((entry) => entry.key.endsWith('/manifest.json'))
    const revisions = await Promise.all(
      revisionEntries.map((entry) =>
        readJsonV1<EditKernelRevisionRecordV1>(
          input.artifactStore,
          entry.key,
          `session ${sessionKey} retained revision`
        )
      )
    )
    revisions.sort(
      (left, right) => left.head.revisionNumber - right.head.revisionNumber
    )
    const manifest = await readJsonV1<{
      readonly semanticSourceSha256: string
      readonly changeContractSha256: string
      readonly capabilityProfileSha256: string
    }>(input.artifactStore, layout.session, `session ${sessionKey} manifest`)
    const semantic = semanticReportProjectionV1(
      manifest.semanticSourceSha256,
      manifest.changeContractSha256,
      manifest.capabilityProfileSha256,
      revisions,
      certificateSetProjectionV1(certificates).sha256
    )
    if (recoveredEvaluationReportSha256s.at(-1) !== semantic.sha256)
      return refuse(
        `session ${sessionKey} recovered evaluation report identity differs`
      )
    const recoveredEvaluationState = recoveredCertificates
      .map((certificate) => certificate.certificate.hashProjection.status)
      .at(-1) as EditKernelReportV1['evaluationState']
    currentReport = Object.freeze({
      ...currentReport,
      semanticProjection: semantic.projection,
      semanticProjectionSha256: semantic.sha256,
      reportArtifactSha256: editCanonicalSha256V1(semantic.projection),
      budget: Object.freeze({
        ...currentReport.budget,
        artifactBytesUsed:
          currentReport.budget.artifactBytesUsed +
          recoveredCompletionQuotaBytes,
      }),
      eventHeadSha256: events.at(-1)!.eventSha256,
      certificateCount: certificates.length,
      evaluationState: recoveredEvaluationState,
    })
  }
  const checkpointEntries = await input.artifactStore.listImmutable(
    `${layout.prefix}/checkpoints`
  )
  const checkpointById = new Map<string, string>()
  const checkpointKeys = new Set<string>()
  for (const entry of checkpointEntries)
  {
    const checkpoint = await readJsonV1<EditKernelCheckpointV1>(
      input.artifactStore,
      entry.key,
      `session ${sessionKey} checkpoint inventory`
    )
    const expectedCheckpointSha256 = editCanonicalSha256V1({
      schemaVersion: 1,
      checkpointId: checkpoint.checkpointId,
      label: checkpoint.label,
      ...(checkpoint.note === undefined ? {} : { note: checkpoint.note }),
      revision: checkpoint.revision,
      eventSha256: checkpoint.eventSha256,
    })
    if (
      checkpoint.checkpointSha256 !== expectedCheckpointSha256 ||
      entry.sha256 !== sha256Hex(canonicalJsonBytesV1(checkpoint)) ||
      checkpointById.has(checkpoint.checkpointId)
    )
      return refuse(`session ${sessionKey} checkpoint inventory differs`)
    checkpointById.set(checkpoint.checkpointId, checkpoint.checkpointSha256)
    checkpointKeys.add(entry.key)
  }
  for (const artifact of attemptRecoveryArtifacts)
  {
    if (!artifact.key.startsWith(`${layout.prefix}/checkpoints/`)) continue
    const checkpoint = artifact.value as EditKernelCheckpointV1
    const expectedCheckpointSha256 = editCanonicalSha256V1({
      schemaVersion: 1,
      checkpointId: checkpoint.checkpointId,
      label: checkpoint.label,
      ...(checkpoint.note === undefined ? {} : { note: checkpoint.note }),
      revision: checkpoint.revision,
      eventSha256: checkpoint.eventSha256,
    })
    const previous = checkpointById.get(checkpoint.checkpointId)
    if (
      checkpoint.checkpointSha256 !== expectedCheckpointSha256 ||
      (previous !== undefined && previous !== expectedCheckpointSha256) ||
      checkpointKeys.has(artifact.key)
    )
      return refuse(`session ${sessionKey} planned checkpoint differs`)
    checkpointById.set(checkpoint.checkpointId, expectedCheckpointSha256)
    checkpointKeys.add(artifact.key)
  }
  currentReport = Object.freeze({
    ...currentReport,
    budget: Object.freeze({
      ...currentReport.budget,
      checkpoints: checkpointById.size,
    }),
    checkpointCount: checkpointById.size,
  })
  const previewCacheEntries = await input.artifactStore.listImmutable(
    `${layout.prefix}/preview-cache`
  )
  const pendingPreviewPredictions = new Map<string, string>()
  for (const entry of previewCacheEntries)
  {
    const match = /\/preview-cache\/([0-9a-f]{64})\.sb3$/u.exec(entry.key)
    const observedSha256 = await input.artifactStore.hashImmutable(entry.key)
    const observedByteLength = await input.artifactStore.sizeImmutable(
      entry.key
    )
    if (
      match === null ||
      entry.key !== layout.preview(match[1]!) ||
      entry.sha256 !== match[1] ||
      observedSha256 !== entry.sha256 ||
      observedByteLength !== entry.byteLength
    )
      return refuse(`session ${sessionKey} preview cache identity differs`)
    const authorized = evictionsByKey.get(entry.key)
    if (authorized !== undefined)
    {
      if (authorized !== entry.sha256)
        return refuse(`session ${sessionKey} preview cache authority differs`)
      continue
    }
    const matches: RetainedPendingAttemptV1[] = []
    for (const previewAttempt of pending.filter(
      (attempt) => attempt.attempt.toolName === 'edit_preview'
    ))
    {
      let predictedCandidateSha256 = pendingPreviewPredictions.get(
        previewAttempt.attempt.namespaceSha256
      )
      if (predictedCandidateSha256 === undefined)
      {
        const rederived = await rederiveRetainedPreviewV1({
          store: input.artifactStore,
          sessionId: replay.sessionId,
          sessionKey,
          pending: previewAttempt,
          contract,
        })
        predictedCandidateSha256 = rederived.predicted.head.candidateSha256
        pendingPreviewPredictions.set(
          previewAttempt.attempt.namespaceSha256,
          predictedCandidateSha256
        )
      }
      if (predictedCandidateSha256 === entry.sha256)
        matches.push(previewAttempt)
    }
    if (matches.length !== 1)
      return refuse(
        `session ${sessionKey} preview cache has no exact attempt authority`
      )
    evictionsByKey.set(entry.key, entry.sha256)
  }
  const evictions = Object.freeze(
    [...evictionsByKey]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, expectedSha256]) => Object.freeze({ key, expectedSha256 }))
  )
  for (const outcome of results.values())
    assertRecoveredRefusalResultV1(outcome)
  const nextIndex: RetainedAttemptIndexV1 = Object.freeze({
    schemaVersion: 1,
    entries: Object.freeze(
      index.entries.map((entry) =>
      {
        const outcome = results.get(entry.namespaceSha256)
        if (outcome === undefined) return entry
        return Object.freeze({
          namespaceSha256: entry.namespaceSha256,
          requestSha256: entry.requestSha256,
          attemptSequence: entry.attemptSequence,
          state: outcome.state,
          resultSha256: editCanonicalSha256V1(outcome.result),
          ...(outcome.refusalCode === undefined
            ? {}
            : { refusalCode: outcome.refusalCode }),
        })
      })
    ),
  })
  const recoveredAttemptsForBudget = (
    budget: EditKernelReportV1['budget']
  ): readonly RecoveredRetainedEditAttemptV1[] =>
    Object.freeze(
      pending.map((attempt) =>
        recoveredAttemptProjectionV1({
          sessionId: replay.sessionId,
          sessionKey,
          pending: attempt,
          outcome: results.get(attempt.attempt.namespaceSha256)!,
          budget,
          events,
        })
      )
    )
  const reportEntries = (
    await input.artifactStore.listImmutable(`${layout.prefix}/reports`)
  ).filter((entry) => entry.key.endsWith('/report.json'))
  if (alreadyTerminal)
  {
    if (results.size !== pending.length)
      return refuse(
        `session ${sessionKey} terminal evidence leaves a pending attempt without an exact outcome`
      )
    const immutables: PlannedImmutableV1[] = pending.map((attempt) =>
    {
      const result = results.get(attempt.attempt.namespaceSha256)!.result
      return Object.freeze({
        key: layout.attempt(
          attempt.attempt.sequence,
          attempt.attempt.requestSha256,
          'result.json'
        ),
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1({ schemaVersion: 1, result })
        ),
        mimeType: null,
      })
    })
    for (const artifact of publication?.artifacts ?? [])
      immutables.push({
        key: artifact.key,
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1(artifact.value)
        ),
        mimeType: null,
      })
    const terminalGeneratedAtEpochMs = (
      input.clock ?? SYSTEM_EDIT_CLOCK
    ).nowEpochMs()
    return meteredTerminalPlanV1(
      input,
      layout,
      contract.effectiveLimits.artifactBytesPerSessionLimit,
      evictions,
      (
        artifactBytesAfterRecovery,
        recoveryReservationId,
        recoveryReservedBytes,
        recoveryActualBytes
      ) =>
      {
        const report: EditKernelReportV1 = Object.freeze({
          ...currentReport,
          reportSequence: reportEntries.length,
          budget: Object.freeze({
            ...currentReport.budget,
            artifactBytesUsed: artifactBytesAfterRecovery,
            retainedPreviews: 0,
          }),
          generatedAtEpochMs: terminalGeneratedAtEpochMs,
        })
        const reportArtifacts = terminalReportArtifactsV1(layout, report)
        return Object.freeze({
          schemaVersion: 1,
          kind: 'retained-edit-session-terminal-plan-v1',
          sessionId: replay.sessionId,
          sessionKey,
          preReplayState: replay.state,
          preEventHeadSha256: replay.eventHeadSha256,
          preSemanticReportSha256: replay.semanticReportSha256,
          artifactByteLimit:
            contract.effectiveLimits.artifactBytesPerSessionLimit,
          artifactBytesAfterRecovery,
          recoveryReservationId,
          recoveryReservedBytes,
          recoveryActualBytes,
          idempotencyPointerExpectedSha256: sha256Hex(indexBytes),
          idempotencyPointerBytesHex: plannedImmutableBytesHexV1(
            canonicalJsonBytesV1(nextIndex)
          ),
          reportPointerExpectedSha256: sha256Hex(reportPointerBytes),
          reportPointerBytesHex: plannedImmutableBytesHexV1(
            reportArtifacts.reportPointerBytes
          ),
          immutables: Object.freeze([
            ...immutables,
            ...reportArtifacts.immutables,
          ]),
          quotaSettlements: Object.freeze(quotaSettlements),
          quotaReleases: Object.freeze(quotaReleases),
          evictions,
          recoveredAttempts: recoveredAttemptsForBudget(report.budget),
        })
      }
    )
  }
  const closePayload =
    publication?.closePayload ??
    Object.freeze({
      reason: 'exclusive-predecessor-recovery',
      terminalState: 'closed-abandoned',
      priorState: replay.state,
      pendingAttemptRequestSha256s: Object.freeze(
        pending.map((entry) => entry.attempt.requestSha256).sort()
      ),
    })
  events.sort(
    (left, right) => left.projection.sequence - right.projection.sequence
  )
  for (const [sequence, retainedEvent] of events.entries())
  {
    const expectedPreviousEventSha256 =
      sequence === 0 ? undefined : events[sequence - 1]!.eventSha256
    if (
      retainedEvent.projection.sequence !== sequence ||
      retainedEvent.projection.previousEventSha256 !==
        expectedPreviousEventSha256 ||
      semanticHashV1('semantic-event', retainedEvent.projection) !==
        retainedEvent.eventSha256
    )
      return refuse(`session ${sessionKey} recovery event chain differs`)
  }
  const committedTerminalEvent = events.at(-1)
  const pendingClose = pending.find(
    (entry) => entry.attempt.toolName === 'edit_close'
  )
  const pendingExport = pending.find(
    (entry) => entry.attempt.toolName === 'edit_export'
  )
  const reusableCommittedClose =
    committedTerminalEvent?.projection.eventKind === 'session-closed' &&
    (closePayload.terminalState === 'closed-exported' &&
    pendingExport !== undefined
      ? committedTerminalEvent.projection.semanticPayloadSha256 ===
          editCanonicalSha256V1(closePayload) &&
        committedTerminalEvent.projection.invocationCorrelation
          .invocationSha256 ===
          pendingExport.invocationCorrelation.invocationSha256
      : pendingClose === undefined
        ? committedTerminalEvent.projection.semanticPayloadSha256 ===
          editCanonicalSha256V1({
            reason: 'lease-expired',
            terminalState: 'closed-abandoned',
          })
        : committedTerminalEvent.projection.semanticPayloadSha256 ===
            editCanonicalSha256V1({
              reason: (pendingClose.request as { readonly reason?: unknown })
                .reason,
              terminalState: 'closed-unexported',
            }) &&
          committedTerminalEvent.projection.invocationCorrelation
            .invocationSha256 ===
            pendingClose.invocationCorrelation.invocationSha256)
  if (
    committedTerminalEvent?.projection.eventKind === 'session-closed' &&
    !reusableCommittedClose
  )
    return refuse(
      `session ${sessionKey} retained an unauthenticated terminal close event`
    )
  const eventProjection = reusableCommittedClose
    ? committedTerminalEvent!.projection
    : Object.freeze({
        schemaVersion: 1 as const,
        sessionId: replay.sessionId,
        sequence: events.length,
        eventKind: 'session-closed' as const,
        previousEventSha256: events.at(-1)?.eventSha256,
        preHead: Object.freeze({
          state: 'present' as const,
          head: exactRevisionFromHeadV1(replay.finalHead),
        }),
        postHead: exactRevisionFromHeadV1(replay.finalHead),
        semanticPayloadSha256: editCanonicalSha256V1(closePayload),
        invocationCorrelation:
          closePayload.terminalState === 'closed-exported'
            ? pending.find((entry) => entry.attempt.toolName === 'edit_export')!
                .invocationCorrelation
            : invocationCorrelationV1(input.invocation),
      })
  const eventSha256 = reusableCommittedClose
    ? committedTerminalEvent!.eventSha256
    : semanticHashV1('semantic-event', eventProjection)
  const event: EditKernelSemanticEventV1 = reusableCommittedClose
    ? committedTerminalEvent!
    : Object.freeze({
        projection: eventProjection,
        eventSha256,
        hostTimestampEpochMs: (input.clock ?? SYSTEM_EDIT_CLOCK).nowEpochMs(),
      })
  const terminalReportState =
    closePayload.terminalState === 'closed-exported'
      ? 'closed-exported'
      : reusableCommittedClose && pendingClose !== undefined
        ? 'closed-unexported'
        : 'closed-abandoned'
  const terminalGeneratedAtEpochMs = (
    input.clock ?? SYSTEM_EDIT_CLOCK
  ).nowEpochMs()
  const terminalPlan = (
    artifactBytesAfterRecovery: number,
    recoveryReservationId: string,
    recoveryReservedBytes: number,
    recoveryActualBytes: number
  ): RetainedTerminalPlanV1 =>
  {
    const report: EditKernelReportV1 = Object.freeze({
      ...currentReport,
      reportSequence: reportEntries.length,
      state: terminalReportState,
      exportState:
        terminalReportState === 'closed-exported'
          ? 'exported'
          : currentReport.exportState,
      budget: Object.freeze({
        ...currentReport.budget,
        artifactBytesUsed: artifactBytesAfterRecovery,
        retainedPreviews: 0,
        rejectedAttempts:
          currentReport.budget.rejectedAttempts +
          [...results.values()].filter((outcome) => outcome.state === 'refused')
            .length,
      }),
      eventHeadSha256: eventSha256,
      attemptCount: index.entries.length,
      generatedAtEpochMs: terminalGeneratedAtEpochMs,
    })
    const reportArtifacts = terminalReportArtifactsV1(layout, report)
    const immutables: PlannedImmutableV1[] = [
      ...(reusableCommittedClose
        ? []
        : [
            {
              key: layout.event(eventProjection.sequence, eventSha256),
              bytesHex: plannedImmutableBytesHexV1(canonicalJsonBytesV1(event)),
              mimeType: 'application/json' as const,
            },
          ]),
    ]
    for (const attempt of pending)
    {
      const result = results.get(attempt.attempt.namespaceSha256)!.result
      immutables.push({
        key: layout.attempt(
          attempt.attempt.sequence,
          attempt.attempt.requestSha256,
          'result.json'
        ),
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1({ schemaVersion: 1, result })
        ),
        mimeType: null,
      })
    }
    for (const artifact of publication?.artifacts ?? [])
      immutables.push({
        key: artifact.key,
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1(artifact.value)
        ),
        mimeType: null,
      })
    for (const artifact of attemptRecoveryArtifacts)
      immutables.push({
        key: artifact.key,
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1(artifact.value)
        ),
        mimeType: artifact.mimeType ?? null,
      })
    immutables.push(...reportArtifacts.immutables)
    if (
      publication?.closePayload !== null &&
      publication !== null &&
      publication.closePayload.terminalState === 'closed-abandoned'
    )
    {
      immutables.push({
        key: publication.artifacts[0]!.key.replace(
          /recovery-[0-9]{6}\.json$/u,
          '000003-external-interference.json'
        ),
        bytesHex: plannedImmutableBytesHexV1(
          canonicalJsonBytesV1({
            schemaVersion: 1,
            exportId: publication.closePayload.exportId,
            code: 'edit.publication_interference',
            disposition: publication.closePayload.disposition,
            interferenceEvidenceSha256:
              publication.closePayload.interferenceEvidenceSha256,
            receiptIssued: false,
            recoveryAuthorityDisposition: 'cleared',
            auditRecordSha256: pending.find(
              (entry) => entry.attempt.toolName === 'edit_export'
            )!.attempt.requestSha256,
            eventSha256,
            reportSha256: report.semanticProjectionSha256,
          })
        ),
        mimeType: null,
      })
    }
    return Object.freeze({
      schemaVersion: 1,
      kind: 'retained-edit-session-terminal-plan-v1',
      sessionId: replay.sessionId,
      sessionKey,
      preReplayState: replay.state,
      preEventHeadSha256: replay.eventHeadSha256,
      preSemanticReportSha256: replay.semanticReportSha256,
      artifactByteLimit: contract.effectiveLimits.artifactBytesPerSessionLimit,
      artifactBytesAfterRecovery,
      recoveryReservationId,
      recoveryReservedBytes,
      recoveryActualBytes,
      idempotencyPointerExpectedSha256: sha256Hex(indexBytes),
      idempotencyPointerBytesHex: plannedImmutableBytesHexV1(
        canonicalJsonBytesV1(nextIndex)
      ),
      reportPointerExpectedSha256: sha256Hex(reportPointerBytes),
      reportPointerBytesHex: plannedImmutableBytesHexV1(
        reportArtifacts.reportPointerBytes
      ),
      immutables: Object.freeze(immutables),
      quotaSettlements: Object.freeze(quotaSettlements),
      quotaReleases: Object.freeze(quotaReleases),
      evictions,
      recoveredAttempts: recoveredAttemptsForBudget(report.budget),
    })
  }
  return meteredTerminalPlanV1(
    input,
    layout,
    contract.effectiveLimits.artifactBytesPerSessionLimit,
    evictions,
    terminalPlan
  )
}

async function installTerminalPlanV1(
  input: RecoverRetainedEditSessionsInputV1,
  plan: RetainedTerminalPlanV1,
  artifactByteLimit: number
): Promise<void>
{
  const layout = editSessionLayoutV1(plan.sessionKey)
  if (
    plan.artifactByteLimit !== artifactByteLimit ||
    !Number.isSafeInteger(plan.artifactBytesAfterRecovery) ||
    plan.artifactBytesAfterRecovery < 0 ||
    plan.artifactBytesAfterRecovery > artifactByteLimit ||
    !Number.isSafeInteger(plan.recoveryReservedBytes) ||
    plan.recoveryReservedBytes < 0 ||
    !Number.isSafeInteger(plan.recoveryActualBytes) ||
    plan.recoveryActualBytes < 0 ||
    plan.recoveryActualBytes > plan.recoveryReservedBytes
  )
    return refuse(`session ${plan.sessionKey} recovery artifact budget differs`)
  const recoveryQuota = await input.artifactStore.quotaOutcome(
    plan.recoveryReservationId
  )
  if (
    !(recoveryQuota.state === 'active' || recoveryQuota.state === 'settled') ||
    recoveryQuota.reservedBytes !== plan.recoveryReservedBytes ||
    (recoveryQuota.state === 'settled' &&
      recoveryQuota.actualBytes !== plan.recoveryActualBytes)
  )
    return refuse(`session ${plan.sessionKey} recovery quota differs`)
  const retainedEntries = (
    await input.artifactStore.listImmutable(layout.prefix)
  ).filter((entry) => !mutableSessionPointerV1(layout, entry.key))
  const retainedByKey = new Map(
    retainedEntries.map((entry) => [entry.key, entry])
  )
  let projectedArtifactBytes = retainedEntries.reduce(
    (total, entry) => total + entry.byteLength,
    0
  )
  for (const eviction of plan.evictions)
  {
    const retained = retainedByKey.get(eviction.key)
    if (retained === undefined) continue
    if (retained.sha256 !== eviction.expectedSha256)
      return refuse(`session ${plan.sessionKey} preview eviction hash differs`)
    projectedArtifactBytes -= retained.byteLength
  }
  const plannedKeys = new Set<string>()
  for (const artifact of plan.immutables)
  {
    if (plannedKeys.has(artifact.key)) continue
    plannedKeys.add(artifact.key)
    const retained = retainedByKey.get(artifact.key)
    const bytes = plannedImmutableBytesV1(artifact)
    if (retained === undefined) projectedArtifactBytes += bytes.byteLength
    else if (
      retained.byteLength !== bytes.byteLength ||
      retained.sha256 !== sha256Hex(bytes)
    )
      return refuse(`session ${plan.sessionKey} planned immutable differs`)
  }
  if (projectedArtifactBytes !== plan.artifactBytesAfterRecovery)
    return refuse(`session ${plan.sessionKey} recovery artifact total differs`)
  const settlementStates = await Promise.all(
    plan.quotaSettlements.map(async (settlement) => ({
      settlement,
      quota: await input.artifactStore.quotaOutcome(settlement.reservationId),
    }))
  )
  for (const { settlement, quota } of settlementStates)
    if (
      !(
        quota.state === 'active' &&
        quota.reservedBytes === settlement.reservedBytes
      ) &&
      !(
        quota.state === 'settled' &&
        quota.reservedBytes === settlement.reservedBytes &&
        quota.actualBytes === settlement.actualBytes
      )
    )
      return refuse(
        `session ${plan.sessionKey} quota settlement authority differs`
      )
  const releaseStates = await Promise.all(
    plan.quotaReleases.map(async (release) => ({
      release,
      quota: await input.artifactStore.quotaOutcome(release.reservationId),
    }))
  )
  for (const { release, quota } of releaseStates)
    if (
      !(
        quota.state === 'active' &&
        quota.reservedBytes === release.reservedBytes
      ) &&
      !(
        quota.state === 'released' &&
        quota.reservedBytes === release.reservedBytes &&
        quota.actualBytes === 0
      )
    )
      return refuse(
        `session ${plan.sessionKey} quota release authority differs`
      )
  const evictionStates = await Promise.all(
    plan.evictions.map(async (eviction) => ({
      eviction,
      retainedSha256: await input.artifactStore
        .hashImmutable(eviction.key)
        .catch(() => null),
    }))
  )
  for (const { eviction, retainedSha256 } of evictionStates)
    if (retainedSha256 !== null && retainedSha256 !== eviction.expectedSha256)
      return refuse(`session ${plan.sessionKey} preview eviction hash differs`)
  for (const artifact of plan.immutables)
    await retainPublicV1(input, plan.sessionId, plan.sessionKey, artifact)
  if (recoveryQuota.state === 'active')
    await input.artifactStore.settleQuota(
      plan.recoveryReservationId,
      plan.recoveryActualBytes
    )
  for (const { settlement, quota } of settlementStates)
  {
    if (quota.state === 'active')
      await input.artifactStore.settleQuota(
        settlement.reservationId,
        settlement.actualBytes
      )
  }
  for (const { release, quota } of releaseStates)
  {
    if (quota.state === 'active')
      await input.artifactStore.releaseQuota(release.reservationId)
  }
  for (const { eviction, retainedSha256 } of evictionStates)
    if (retainedSha256 !== null)
      await input.artifactStore.removeEvictable(
        eviction.key,
        eviction.expectedSha256
      )
  await installPointerV1(
    input.artifactStore,
    layout.idempotencyIndex,
    plan.idempotencyPointerExpectedSha256,
    plannedImmutableBytesV1({
      key: layout.idempotencyIndex,
      bytesHex: plan.idempotencyPointerBytesHex,
      mimeType: null,
    })
  )
  if (plan.reportPointerBytesHex !== null)
    await installPointerV1(
      input.artifactStore,
      layout.currentReport,
      plan.reportPointerExpectedSha256,
      plannedImmutableBytesV1({
        key: layout.currentReport,
        bytesHex: plan.reportPointerBytesHex,
        mimeType: null,
      })
    )
}

async function recoverPreManifestPrefixesV1(
  input: RecoverRetainedEditSessionsInputV1,
  entries: readonly Awaited<
    ReturnType<EditArtifactStorePort['listImmutable']>
  >[number][]
): Promise<void>
{
  const bySession = new Map<string, typeof entries>()
  for (const entry of entries)
  {
    const match = /^sessions\/([^/]+)\/(.+)$/u.exec(entry.key)
    if (match === null)
      return refuse(`noncanonical retained session key ${entry.key}`)
    const sessionKey = assertEditLogicalComponent(match[1]!)
    const bucket = bySession.get(sessionKey) ?? []
    bySession.set(sessionKey, Object.freeze([...bucket, entry]))
  }
  for (const [sessionKey, sessionEntries] of bySession)
  {
    const layout = editSessionLayoutV1(sessionKey)
    if (sessionEntries.some((entry) => entry.key === layout.session)) continue
    const tombstone = sessionEntries.find(
      (entry) => entry.key === layout.recoveryTombstone
    )
    if (tombstone !== undefined) continue
    const unexpected = sessionEntries.filter((entry) =>
    {
      const suffix = entry.key.slice(layout.prefix.length + 1)
      return !allowedPreManifestSuffixV1(suffix)
    })
    if (unexpected.length > 0)
      return refuse(
        `session ${sessionKey} pre-manifest prefix contains ${unexpected[0]!.key}`
      )
    const beginEntry = sessionEntries.find(
      (entry) => entry.key === layout.recoveryBegin
    )
    let quotaDisposition: RetainedPreManifestTombstoneV1['quotaDisposition'] =
      'absent'
    if (beginEntry !== undefined)
    {
      const authority = await readJsonV1<RetainedBeginRecoveryAuthorityV1>(
        input.artifactStore,
        beginEntry.key,
        `session ${sessionKey} begin recovery authority`
      )
      exactFieldsV1(
        authority,
        [
          'beginNamespaceSha256',
          'capabilityProfileSha256',
          'changeContractSha256',
          'kind',
          'reservationId',
          'reservedBytes',
          'schemaVersion',
          'semanticSourceSha256',
          'sessionId',
          'sessionKey',
          'sourceArtifactSha256',
        ],
        `session ${sessionKey} begin recovery authority`
      )
      if (
        authority.schemaVersion !== 1 ||
        authority.kind !== 'edit-session-begin-recovery-authority-v1' ||
        authority.sessionKey !== sessionKey ||
        !Number.isSafeInteger(authority.reservedBytes) ||
        authority.reservedBytes < 0
      )
        return refuse(`session ${sessionKey} begin recovery authority differs`)
      const quota = await input.artifactStore.quotaOutcome(
        authority.reservationId
      )
      if (
        quota.state !== 'absent' &&
        (quota.reservedBytes !== authority.reservedBytes ||
          (quota.state === 'released' && quota.actualBytes !== 0))
      )
        return refuse(
          `session ${sessionKey} pre-manifest quota differs from its authority`
        )
      if (quota.state === 'active')
      {
        await input.artifactStore.releaseQuota(authority.reservationId)
        quotaDisposition = 'released'
      }
      else if (quota.state === 'released') quotaDisposition = 'released'
      else if (quota.state !== 'absent')
        return refuse(
          `session ${sessionKey} pre-manifest quota is unexpectedly settled`
        )
    }
    const retainedEntries = Object.freeze(
      sessionEntries
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) => left.key.localeCompare(right.key))
    )
    const tombstoneValue: RetainedPreManifestTombstoneV1 = Object.freeze({
      schemaVersion: 1,
      kind: 'edit-session-pre-manifest-abandoned-v1',
      sessionKey,
      retainedEntries,
      quotaDisposition,
      invocationCorrelation: invocationCorrelationV1(input.invocation),
      abandonedAtEpochMs: (input.clock ?? SYSTEM_EDIT_CLOCK).nowEpochMs(),
    })
    await input.artifactStore.createOrVerifyImmutable(
      layout.recoveryTombstone,
      canonicalJsonBytesV1(tombstoneValue)
    )
  }
}

async function retainedTransportOutcomesV1(
  store: EditArtifactStorePort,
  inventory: RetainedEditSessionInventoryV1
): Promise<readonly RecoveredRetainedEditAttemptV1[]>
{
  const entries = await store.listImmutable('sessions')
  const inventoryBySessionKey = new Map(
    inventory.sessions.map((session) => [session.sessionKey, session])
  )
  const attemptFiles = new Map<
    string,
    {
      readonly sessionKey: string
      readonly files: Map<string, (typeof entries)[number]>
    }
  >()
  const eventEntriesBySession = new Map<string, (typeof entries)[number][]>()
  for (const entry of entries)
  {
    const attemptMatch =
      /^(sessions\/([^/]+)\/attempts\/[0-9]{6}-[0-9a-f]{16})\/([^/]+)$/u.exec(
        entry.key
      )
    if (attemptMatch !== null)
    {
      const directory = attemptMatch[1]!
      const sessionKey = assertEditLogicalComponent(attemptMatch[2]!)
      const bucket = attemptFiles.get(directory) ?? {
        sessionKey,
        files: new Map<string, (typeof entries)[number]>(),
      }
      if (bucket.files.has(attemptMatch[3]!))
        return refuse(`attempt directory repeats ${attemptMatch[3]!}`)
      bucket.files.set(attemptMatch[3]!, entry)
      attemptFiles.set(directory, bucket)
      continue
    }
    const eventMatch =
      /^sessions\/([^/]+)\/events\/[0-9]{6}-[0-9a-f]{64}\.json$/u.exec(
        entry.key
      )
    if (eventMatch !== null)
    {
      const sessionKey = assertEditLogicalComponent(eventMatch[1]!)
      const bucket = eventEntriesBySession.get(sessionKey) ?? []
      bucket.push(entry)
      eventEntriesBySession.set(sessionKey, bucket)
    }
  }
  interface SessionRecoveryCacheV1
  {
    readonly report: EditKernelReportV1
    readonly indexByNamespace: ReadonlyMap<string, RetainedAttemptIndexEntryV1>
    readonly events: readonly EditKernelSemanticEventV1[]
  }
  const sessionCaches = new Map<string, SessionRecoveryCacheV1>()
  const loadSession = async (
    sessionKey: string
  ): Promise<SessionRecoveryCacheV1> =>
  {
    const cached = sessionCaches.get(sessionKey)
    if (cached !== undefined) return cached
    const layout = editSessionLayoutV1(sessionKey)
    const pointer = await readJsonV1<RetainedPointerV1>(
      store,
      layout.currentReport,
      `session ${sessionKey} current report pointer`
    )
    const report = await readJsonV1<EditKernelReportV1>(
      store,
      layout.report(pointer.reportJsonSha256, 'report.json'),
      `session ${sessionKey} current report`
    )
    const index = await readJsonV1<RetainedAttemptIndexV1>(
      store,
      layout.idempotencyIndex,
      `session ${sessionKey} idempotency index`
    )
    const events = await Promise.all(
      (eventEntriesBySession.get(sessionKey) ?? []).map((entry) =>
        readJsonV1<EditKernelSemanticEventV1>(
          store,
          entry.key,
          `session ${sessionKey} semantic event`
        )
      )
    )
    events.sort(
      (left, right) => left.projection.sequence - right.projection.sequence
    )
    const value = Object.freeze({
      report,
      indexByNamespace: new Map(
        index.entries.map((entry) => [entry.namespaceSha256, entry])
      ),
      events: Object.freeze(events),
    })
    sessionCaches.set(sessionKey, value)
    return value
  }
  const recovered: RecoveredRetainedEditAttemptV1[] = []
  for (const [_directory, bucket] of [...attemptFiles].sort(([left], [right]) =>
    left.localeCompare(right)
  ))
  {
    const sessionKey = bucket.sessionKey
    const session = inventoryBySessionKey.get(sessionKey)
    if (session === undefined)
      return refuse(`attempt names no terminal retained session`)
    const requestEntry = bucket.files.get('request.json')
    if (requestEntry === undefined) continue
    const pending = await readJsonV1<RetainedPendingAttemptV1>(
      store,
      requestEntry.key,
      `session ${sessionKey} retained request authority`
    )
    exactFieldsV1(
      pending,
      [
        'attempt',
        'invocationCorrelation',
        'request',
        'schemaVersion',
        'transportRequest',
      ],
      `session ${sessionKey} retained request authority`
    )
    assertRetainedTransportDomainBindingV1(pending, session.sessionId)
    const cache = await loadSession(sessionKey)
    const indexed = cache.indexByNamespace.get(pending.attempt.namespaceSha256)
    if (
      indexed === undefined ||
      indexed.requestSha256 !== pending.attempt.requestSha256 ||
      indexed.attemptSequence !== pending.attempt.sequence ||
      (indexed.state !== 'completed' && indexed.state !== 'refused')
    )
      return refuse(`session ${sessionKey} attempt index differs`)
    const resultEntry = bucket.files.get('result.json')
    if (resultEntry === undefined)
      return refuse(`session ${sessionKey} terminal attempt has no result`)
    const resultRecord = await readJsonV1<{
      readonly schemaVersion: 1
      readonly result: unknown
    }>(store, resultEntry.key, `session ${sessionKey} semantic attempt result`)
    if (
      indexed.resultSha256 !== editCanonicalSha256V1(resultRecord.result) ||
      (pending.attempt.resultSha256 !== undefined &&
        pending.attempt.resultSha256 !== indexed.resultSha256)
    )
      return refuse(`session ${sessionKey} terminal result identity differs`)
    let receiptFreeOutcome: unknown | undefined
    const transportEntry = bucket.files.get('transport-result.json')
    if (transportEntry !== undefined)
    {
      const retained = await readJsonV1<{
        readonly schemaVersion: 1
        readonly kind: 'retained-mcp-transport-result-v1'
        readonly namespaceSha256: string
        readonly requestSha256: string
        readonly invocationCorrelation: RetainedPendingAttemptV1['invocationCorrelation']
        readonly receiptFreeOutcome: unknown
        readonly receiptFreeOutcomeSha256: string
      }>(
        store,
        transportEntry.key,
        `session ${sessionKey} retained transport result`
      )
      exactFieldsV1(
        retained,
        [
          'invocationCorrelation',
          'kind',
          'namespaceSha256',
          'receiptFreeOutcome',
          'receiptFreeOutcomeSha256',
          'requestSha256',
          'schemaVersion',
        ],
        `session ${sessionKey} retained transport result`
      )
      if (
        retained.schemaVersion !== 1 ||
        retained.kind !== 'retained-mcp-transport-result-v1' ||
        retained.namespaceSha256 !== pending.attempt.namespaceSha256 ||
        retained.requestSha256 !== pending.attempt.requestSha256 ||
        retained.receiptFreeOutcomeSha256 !==
          editCanonicalSha256V1(retained.receiptFreeOutcome) ||
        editCanonicalSha256V1(retained.invocationCorrelation) !==
          editCanonicalSha256V1(pending.invocationCorrelation)
      )
        return refuse(`session ${sessionKey} retained transport result differs`)
      receiptFreeOutcome = retained.receiptFreeOutcome
    }
    const resultRecordValue =
      resultRecord.result !== null && typeof resultRecord.result === 'object'
        ? (resultRecord.result as Record<string, unknown>)
        : null
    const outcome: RecoveredAttemptOutcomeV1 = Object.freeze({
      state: indexed.state,
      result: resultRecord.result,
      ...(indexed.state === 'refused'
        ? {
            refusalCode:
              indexed.refusalCode ??
              (typeof resultRecordValue?.['code'] === 'string'
                ? resultRecordValue['code']
                : 'edit.interrupted'),
          }
        : {}),
    })
    const resultBudget =
      resultRecordValue?.['budget'] !== null &&
      typeof resultRecordValue?.['budget'] === 'object'
        ? (resultRecordValue['budget'] as EditKernelReportV1['budget'])
        : cache.report.budget
    recovered.push(
      recoveredAttemptProjectionV1({
        sessionId: session.sessionId,
        sessionKey,
        pending,
        outcome,
        budget: resultBudget,
        events: cache.events,
        ...(receiptFreeOutcome === undefined ? {} : { receiptFreeOutcome }),
      })
    )
  }
  return Object.freeze(recovered)
}

function recoveryInitialBudgetV1(): EditKernelReportV1['budget']
{
  return Object.freeze({
    artifactBytesUsed: 0,
    impactUsed: 0,
    intentUsed: 0,
    restoreReserveHeld: true,
    acceptedOperations: 0,
    acceptedRevisions: 1,
    rejectedAttempts: 0,
    retainedPreviews: 0,
    checkpoints: 0,
  })
}

async function retainedBeginOutcomesV1(
  store: EditArtifactStorePort,
  inventory: RetainedEditSessionInventoryV1
): Promise<readonly RecoveredRetainedEditAttemptV1[]>
{
  const registryEntries = await store.listImmutable('registry-attempts')
  const sessionEntries = await store.listImmutable('sessions')
  const sessionFiles = new Map<string, (typeof sessionEntries)[number][]>()
  for (const entry of sessionEntries)
  {
    const match = /^sessions\/([^/]+)\//u.exec(entry.key)
    if (match === null)
      return refuse(`noncanonical retained session artifact ${entry.key}`)
    const sessionKey = assertEditLogicalComponent(match[1]!)
    const bucket = sessionFiles.get(sessionKey) ?? []
    bucket.push(entry)
    sessionFiles.set(sessionKey, bucket)
  }
  const registryFiles = new Map<
    string,
    {
      readonly sequence: number
      readonly requestPrefix: string
      readonly files: Map<string, (typeof registryEntries)[number]>
    }
  >()
  for (const entry of registryEntries)
  {
    const match =
      /^(registry-attempts\/([0-9]{6})-([0-9a-f]{16}))\/([^/]+)$/u.exec(
        entry.key
      )
    if (match === null)
      return refuse(`noncanonical registry-attempt artifact ${entry.key}`)
    if (
      match[4] !== 'request.json' &&
      match[4] !== 'outcome.json' &&
      match[4] !== 'transport-result.json'
    )
      return refuse(`registry attempt retains unknown artifact ${entry.key}`)
    const directory = match[1]!
    const bucket = registryFiles.get(directory) ?? {
      sequence: Number(match[2]),
      requestPrefix: match[3]!,
      files: new Map<string, (typeof registryEntries)[number]>(),
    }
    if (bucket.files.has(match[4]!))
      return refuse(`registry attempt repeats ${match[4]!}`)
    bucket.files.set(match[4]!, entry)
    registryFiles.set(directory, bucket)
  }

  interface OpeningSessionContextV1
  {
    readonly beginNamespaceSha256: string
    readonly sessionId: string
    readonly sessionKey: string
    readonly result: {
      readonly sessionId: string
      readonly state: 'active'
      readonly head: EditKernelRevisionRecordV1['head']
      readonly semanticSourceSha256: string
      readonly changeContractSha256: string
      readonly capabilityProfileSha256: string
      readonly sourceProvenanceEvidenceSha256: string
      readonly eventSha256: string
      readonly reportSha256: string
    }
    readonly budget: EditKernelReportV1['budget']
    readonly events: readonly {
      readonly eventSha256: string
      readonly sequence: number
    }[]
    readonly evidenceIds: readonly string[]
    readonly refusalEvidenceIds: readonly string[]
    readonly invocationCorrelation: RetainedPendingAttemptV1['invocationCorrelation']
  }
  const sessionEntryByKey = new Map(
    sessionEntries.map((entry) => [entry.key, entry])
  )
  const sessionsByBeginInvocation = new Map<string, OpeningSessionContextV1>()
  for (const inventorySession of inventory.sessions)
  {
    const layout = editSessionLayoutV1(inventorySession.sessionKey)
    const begin = await readJsonV1<RetainedBeginRecoveryAuthorityV1>(
      store,
      layout.recoveryBegin,
      `session ${inventorySession.sessionKey} begin recovery authority`
    )
    const manifest = await readJsonV1<EditKernelSessionManifestV1>(
      store,
      layout.session,
      `session ${inventorySession.sessionKey} manifest`
    )
    const retainedSessionFiles =
      sessionFiles.get(inventorySession.sessionKey) ?? []
    const revisionEntries = retainedSessionFiles.filter(
      (entry) =>
        entry.key.startsWith(`${layout.prefix}/revisions/000000-`) &&
        entry.key.endsWith('/manifest.json')
    )
    const eventEntries = retainedSessionFiles.filter((entry) =>
      entry.key.startsWith(`${layout.prefix}/events/000000-`)
    )
    const reportEntries = retainedSessionFiles.filter(
      (entry) =>
        entry.key.startsWith(`${layout.prefix}/reports/`) &&
        entry.key.endsWith('/report.json')
    )
    if (revisionEntries.length !== 1 || eventEntries.length !== 1)
      return refuse(
        `session ${inventorySession.sessionKey} lacks one revision-zero authority`
      )
    const revision = await readJsonV1<EditKernelRevisionRecordV1>(
      store,
      revisionEntries[0]!.key,
      `session ${inventorySession.sessionKey} revision zero`
    )
    const event = await readJsonV1<EditKernelSemanticEventV1>(
      store,
      eventEntries[0]!.key,
      `session ${inventorySession.sessionKey} opening event`
    )
    const initialReports = (
      await Promise.all(
        reportEntries.map((entry) =>
          readJsonV1<EditKernelReportV1>(
            store,
            entry.key,
            `session ${inventorySession.sessionKey} report`
          )
        )
      )
    ).filter((report) => report.reportSequence === 0)
    if (initialReports.length !== 1)
      return refuse(
        `session ${inventorySession.sessionKey} lacks one initial report`
      )
    const report = initialReports[0]!
    if (
      begin.sessionId !== inventorySession.sessionId ||
      begin.sessionKey !== inventorySession.sessionKey ||
      manifest.sessionId !== inventorySession.sessionId ||
      manifest.sessionKey !== inventorySession.sessionKey ||
      revision.head.revisionNumber !== 0 ||
      event.projection.sequence !== 0 ||
      event.projection.eventKind !== 'session-begun' ||
      event.projection.preHead.state !== 'absent' ||
      editCanonicalSha256V1(event.projection.postHead) !==
        editCanonicalSha256V1(exactRevisionFromHeadV1(revision.head)) ||
      report.eventHeadSha256 !== event.eventSha256 ||
      report.revisionCount !== 1 ||
      report.attemptCount !== 1 ||
      begin.semanticSourceSha256 !== manifest.semanticSourceSha256 ||
      begin.changeContractSha256 !== manifest.changeContractSha256 ||
      begin.changeContractSha256 !== revision.head.changeContractSha256 ||
      begin.capabilityProfileSha256 !== manifest.capabilityProfileSha256 ||
      begin.capabilityProfileSha256 !== revision.head.capabilityProfileSha256 ||
      editCanonicalSha256V1(event.projection.invocationCorrelation) !==
        editCanonicalSha256V1(manifest.invocationCorrelation)
    )
      return refuse(
        `session ${inventorySession.sessionKey} opening authorities differ`
      )
    const result = Object.freeze({
      sessionId: manifest.sessionId,
      state: 'active' as const,
      head: structuredClone(revision.head),
      semanticSourceSha256: manifest.semanticSourceSha256,
      changeContractSha256: manifest.changeContractSha256,
      capabilityProfileSha256: manifest.capabilityProfileSha256,
      sourceProvenanceEvidenceSha256: manifest.sourceProvenanceEvidenceSha256,
      eventSha256: event.eventSha256,
      reportSha256: report.semanticProjectionSha256,
    })
    const context: OpeningSessionContextV1 = Object.freeze({
      beginNamespaceSha256: begin.beginNamespaceSha256,
      sessionId: manifest.sessionId,
      sessionKey: manifest.sessionKey,
      result,
      budget: structuredClone(report.budget),
      events: Object.freeze([
        Object.freeze({
          eventSha256: event.eventSha256,
          sequence: event.projection.sequence,
        }),
      ]),
      evidenceIds: Object.freeze(
        [
          manifest.sourceProvenanceEvidenceSha256,
          report.reportArtifactSha256,
        ].sort()
      ),
      refusalEvidenceIds: Object.freeze([report.reportArtifactSha256]),
      invocationCorrelation: structuredClone(manifest.invocationCorrelation),
    })
    const beginInvocationKey = editCanonicalSha256V1({
      beginNamespaceSha256: begin.beginNamespaceSha256,
      invocationCorrelation: manifest.invocationCorrelation,
    })
    if (sessionsByBeginInvocation.has(beginInvocationKey))
      return refuse('multiple sessions repeat one begin invocation')
    sessionsByBeginInvocation.set(beginInvocationKey, context)
    if (
      sessionEntryByKey.get(revisionEntries[0]!.key)?.sha256 !==
        editCanonicalSha256V1(revision) ||
      sessionEntryByKey.get(eventEntries[0]!.key)?.sha256 !==
        editCanonicalSha256V1(event)
    )
      return refuse(
        `session ${inventorySession.sessionKey} opening metadata differs`
      )
  }

  const recovered: RecoveredRetainedEditAttemptV1[] = []
  for (const [directory, bucket] of [...registryFiles].sort(([left], [right]) =>
    left.localeCompare(right)
  ))
  {
    const requestEntry = bucket.files.get('request.json')
    if (requestEntry === undefined)
      return refuse(`registry attempt ${directory} lacks request authority`)
    const attempt = await readJsonV1<RetainedEditBeginAttemptAuthorityV1>(
      store,
      requestEntry.key,
      `registry attempt ${directory} request authority`
    )
    const parsedRequest = parseEditToolInputV1('edit_begin', attempt.request)
    if (!parsedRequest.ok)
      return refuse(`registry attempt ${directory} request is not exact`)
    exactFieldsV1(
      attempt,
      [
        'attemptId',
        'attemptSequence',
        'beginNamespaceSha256',
        'invocationCorrelation',
        'kind',
        'namespaceSha256',
        'registryIdentity',
        'request',
        'requestSha256',
        'schemaVersion',
        'sourceIdentity',
      ],
      `registry attempt ${directory} request authority`
    )
    exactFieldsV1(
      attempt.registryIdentity,
      ['principalSha256', 'profileSha256', 'realmSha256'],
      `registry attempt ${directory} registry identity`
    )
    exactFieldsV1(
      attempt.sourceIdentity,
      [
        'expectedArtifactSha256',
        'provenance',
        'provenanceEvidenceSha256',
        'sourceBinding',
      ],
      `registry attempt ${directory} source identity`
    )
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      attempt.sourceIdentity.provenance
    )
    const sourceIdentityMatches =
      attempt.request.baseline.kind === 'projectSession'
        ? attempt.sourceIdentity.provenance.kind === 'projectSession' &&
          attempt.sourceIdentity.provenance.projectSessionId ===
            attempt.request.baseline.projectSessionId
        : attempt.sourceIdentity.provenance.kind === 'registeredTemplate' &&
          attempt.sourceIdentity.provenance.templateId ===
            attempt.request.baseline.templateId &&
          String(attempt.sourceIdentity.provenance.templateVersion) ===
            attempt.request.baseline.expectedVersion &&
          attempt.sourceIdentity.provenance.templateArtifactSha256 ===
            attempt.request.baseline.expectedArtifactSha256 &&
          attempt.sourceIdentity.expectedArtifactSha256 ===
            attempt.request.baseline.expectedArtifactSha256
    const sourceArtifactMatchesRequest =
      attempt.request.baseline.kind !== 'projectSession' ||
      attempt.sourceIdentity.expectedArtifactSha256 ===
        attempt.request.baseline.expectedSourceArtifactSha256
    const expectedSourceBinding =
      attempt.request.baseline.kind === 'projectSession'
        ? {
            kind: 'exactArtifact' as const,
            sourceArtifactSha256:
              attempt.request.baseline.expectedSourceArtifactSha256,
          }
        : {
            kind: 'template' as const,
            templateId: attempt.request.baseline.templateId,
            version: attempt.request.baseline.expectedVersion,
            artifactSha256: attempt.request.baseline.expectedArtifactSha256,
          }
    const beginNamespaceSha256 = editCanonicalSha256V1({
      sourceBinding: expectedSourceBinding,
      registrationId: attempt.request.changeContractRegistrationId,
      expectedSemanticContractSha256:
        attempt.request.expectedSemanticContractSha256,
      provenanceEvidenceSha256,
    })
    const requestSha256 = editCanonicalSha256V1({
      request: attempt.request,
      sourceBinding: expectedSourceBinding,
      provenanceEvidenceSha256,
    })
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: attempt.registryIdentity.realmSha256,
      profileSha256: attempt.registryIdentity.profileSha256,
      principalSha256: attempt.registryIdentity.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256,
      requestId: attempt.request.requestId,
    })
    const attemptBytes = canonicalJsonBytesV1(attempt)
    if (
      attempt.schemaVersion !== 1 ||
      attempt.kind !== 'retained-edit-begin-attempt-authority-v1' ||
      attempt.attemptSequence !== bucket.sequence ||
      attempt.requestSha256.slice(0, 16) !== bucket.requestPrefix ||
      attempt.requestSha256 !== requestSha256 ||
      attempt.beginNamespaceSha256 !== beginNamespaceSha256 ||
      attempt.namespaceSha256 !== namespaceSha256 ||
      attempt.sourceIdentity.provenanceEvidenceSha256 !==
        provenanceEvidenceSha256 ||
      !sourceIdentityMatches ||
      editCanonicalSha256V1(attempt.sourceIdentity.sourceBinding) !==
        editCanonicalSha256V1(expectedSourceBinding) ||
      requestEntry.sha256 !== sha256Hex(attemptBytes) ||
      requestEntry.byteLength !== attemptBytes.byteLength
    )
      return refuse(`registry attempt ${directory} authority differs`)
    const session = sessionsByBeginInvocation.get(
      editCanonicalSha256V1({
        beginNamespaceSha256,
        invocationCorrelation: attempt.invocationCorrelation,
      })
    )
    let outcome: RetainedEditBeginOutcomeAuthorityV1
    const outcomeEntry = bucket.files.get('outcome.json')
    if (outcomeEntry === undefined)
    {
      const result =
        session === undefined
          ? Object.freeze({
              code: 'edit.retention_failed',
              safeMessage:
                'begin retained no session before predecessor recovery',
              context: Object.freeze({}),
              recoveryRequired: false,
            })
          : session.result
      outcome = Object.freeze({
        schemaVersion: 1,
        kind: 'retained-edit-begin-outcome-authority-v1',
        attemptId: attempt.attemptId,
        attemptSequence: attempt.attemptSequence,
        registryAttemptSha256: requestEntry.sha256,
        namespaceSha256,
        beginNamespaceSha256,
        requestSha256,
        invocationCorrelation: attempt.invocationCorrelation,
        disposition: session === undefined ? 'refused' : 'completed',
        result,
        resultSha256: editCanonicalSha256V1(result),
        openingSession:
          session === undefined
            ? { state: 'absent' as const }
            : {
                state: 'present' as const,
                sessionId: session.sessionId,
                sessionKey: session.sessionKey,
              },
        preHead: null,
        postHead:
          session === undefined ? null : structuredClone(session.result.head),
        budget:
          session === undefined
            ? recoveryInitialBudgetV1()
            : structuredClone(session.budget),
        events: session === undefined ? [] : session.events,
        evidenceIds: session === undefined ? [] : session.evidenceIds,
      })
      assertBeginOutcomeRefusalResultV1(outcome)
      await store.createOrVerifyImmutable(
        `${directory}/outcome.json`,
        canonicalJsonBytesV1(outcome)
      )
    }
    else
    {
      outcome = await readJsonV1<RetainedEditBeginOutcomeAuthorityV1>(
        store,
        outcomeEntry.key,
        `registry attempt ${directory} outcome authority`
      )
      assertBeginOutcomeRefusalResultV1(outcome)
    }
    exactFieldsV1(
      outcome,
      [
        'attemptId',
        'attemptSequence',
        'beginNamespaceSha256',
        'budget',
        'disposition',
        'events',
        'evidenceIds',
        'invocationCorrelation',
        'kind',
        'namespaceSha256',
        'openingSession',
        'postHead',
        'preHead',
        'registryAttemptSha256',
        'requestSha256',
        'result',
        'resultSha256',
        'schemaVersion',
      ],
      `registry attempt ${directory} outcome authority`
    )
    const expectedOpeningSession =
      session === undefined
        ? ({ state: 'absent' } as const)
        : ({
            state: 'present',
            sessionId: session.sessionId,
            sessionKey: session.sessionKey,
          } as const)
    const expectedBudget =
      session === undefined ? recoveryInitialBudgetV1() : session.budget
    const expectedEvents = session === undefined ? [] : session.events
    const expectedEvidenceIds =
      session === undefined
        ? []
        : outcome.disposition === 'completed'
          ? session.evidenceIds
          : session.refusalEvidenceIds
    const refusalResult =
      outcome.result !== null &&
      typeof outcome.result === 'object' &&
      !Array.isArray(outcome.result)
        ? (outcome.result as Record<string, unknown>)
        : null
    if (outcome.openingSession.state === 'absent')
      exactFieldsV1(
        outcome.openingSession,
        ['state'],
        `registry attempt ${directory} absent session`
      )
    else
      exactFieldsV1(
        outcome.openingSession,
        ['sessionId', 'sessionKey', 'state'],
        `registry attempt ${directory} present session`
      )
    if (
      outcome.schemaVersion !== 1 ||
      outcome.kind !== 'retained-edit-begin-outcome-authority-v1' ||
      outcome.attemptId !== attempt.attemptId ||
      outcome.attemptSequence !== attempt.attemptSequence ||
      outcome.registryAttemptSha256 !== requestEntry.sha256 ||
      outcome.namespaceSha256 !== namespaceSha256 ||
      outcome.beginNamespaceSha256 !== beginNamespaceSha256 ||
      outcome.requestSha256 !== requestSha256 ||
      editCanonicalSha256V1(outcome.invocationCorrelation) !==
        editCanonicalSha256V1(attempt.invocationCorrelation) ||
      outcome.resultSha256 !== editCanonicalSha256V1(outcome.result) ||
      editCanonicalSha256V1(outcome.openingSession) !==
        editCanonicalSha256V1(expectedOpeningSession) ||
      outcome.preHead !== null ||
      editCanonicalSha256V1(outcome.postHead) !==
        editCanonicalSha256V1(
          session === undefined ? null : session.result.head
        ) ||
      editCanonicalSha256V1(outcome.budget) !==
        editCanonicalSha256V1(expectedBudget) ||
      editCanonicalSha256V1(outcome.events) !==
        editCanonicalSha256V1(expectedEvents) ||
      editCanonicalSha256V1(outcome.evidenceIds) !==
        editCanonicalSha256V1(expectedEvidenceIds) ||
      (outcome.openingSession.state === 'present' &&
        outcome.events.length !== 1) ||
      (outcome.disposition === 'completed' &&
        (session === undefined ||
          editCanonicalSha256V1(outcome.result) !==
            editCanonicalSha256V1(session.result))) ||
      (outcome.disposition === 'refused' &&
        (refusalResult === null ||
          typeof refusalResult['code'] !== 'string' ||
          typeof refusalResult['safeMessage'] !== 'string' ||
          refusalResult['context'] === null ||
          typeof refusalResult['context'] !== 'object' ||
          Array.isArray(refusalResult['context']) ||
          typeof refusalResult['recoveryRequired'] !== 'boolean')) ||
      (!sourceArtifactMatchesRequest &&
        (outcome.disposition !== 'refused' ||
          outcome.openingSession.state !== 'absent' ||
          refusalResult?.['code'] !== 'edit.source_identity_mismatch'))
    )
      return refuse(`registry attempt ${directory} outcome differs`)
    if (outcomeEntry !== undefined)
    {
      const outcomeBytes = canonicalJsonBytesV1(outcome)
      if (
        outcomeEntry.sha256 !== sha256Hex(outcomeBytes) ||
        outcomeEntry.byteLength !== outcomeBytes.byteLength
      )
        return refuse(`registry attempt ${directory} outcome metadata differs`)
    }
    let receiptFreeOutcome: unknown | undefined
    const transportEntry = bucket.files.get('transport-result.json')
    if (transportEntry !== undefined)
    {
      const retained = await readJsonV1<{
        readonly schemaVersion: 1
        readonly kind: 'retained-mcp-transport-result-v1'
        readonly namespaceSha256: string
        readonly requestSha256: string
        readonly invocationCorrelation: RetainedPendingAttemptV1['invocationCorrelation']
        readonly receiptFreeOutcome: unknown
        readonly receiptFreeOutcomeSha256: string
      }>(store, transportEntry.key, `registry attempt ${directory} transport`)
      exactFieldsV1(
        retained,
        [
          'invocationCorrelation',
          'kind',
          'namespaceSha256',
          'receiptFreeOutcome',
          'receiptFreeOutcomeSha256',
          'requestSha256',
          'schemaVersion',
        ],
        `registry attempt ${directory} transport`
      )
      if (
        retained.schemaVersion !== 1 ||
        retained.kind !== 'retained-mcp-transport-result-v1' ||
        retained.namespaceSha256 !== namespaceSha256 ||
        retained.requestSha256 !== requestSha256 ||
        editCanonicalSha256V1(retained.invocationCorrelation) !==
          editCanonicalSha256V1(attempt.invocationCorrelation) ||
        retained.receiptFreeOutcomeSha256 !==
          editCanonicalSha256V1(retained.receiptFreeOutcome)
      )
        return refuse(`registry attempt ${directory} transport differs`)
      receiptFreeOutcome = retained.receiptFreeOutcome
    }
    recovered.push(
      Object.freeze({
        schemaVersion: 1,
        sessionId:
          outcome.openingSession.state === 'present'
            ? outcome.openingSession.sessionId
            : null,
        sessionKey:
          outcome.openingSession.state === 'present'
            ? outcome.openingSession.sessionKey
            : null,
        session: structuredClone(outcome.openingSession),
        attemptId: outcome.attemptId,
        attemptSequence: outcome.attemptSequence,
        toolName: 'edit_begin',
        requestId: attempt.request.requestId,
        requestSha256,
        transportRequest: structuredClone(parsedRequest.value),
        namespaceSha256,
        beginNamespaceSha256,
        registryAttemptSha256: outcome.registryAttemptSha256,
        invocationCorrelation: structuredClone(attempt.invocationCorrelation),
        disposition: outcome.disposition,
        result: structuredClone(outcome.result),
        resultSha256: outcome.resultSha256,
        receiptFreeOutcome: receiptFreeOutcome ?? null,
        preHead: null,
        postHead: structuredClone(outcome.postHead),
        budget: structuredClone(outcome.budget),
        events: structuredClone(outcome.events),
        evidenceIds: structuredClone(outcome.evidenceIds),
        transportAuthority: Object.freeze({
          kind: 'registryBegin' as const,
          toolName: 'edit_begin' as const,
          disposition: outcome.disposition,
          attemptId: outcome.attemptId,
          attemptSequence: outcome.attemptSequence,
          requestId: attempt.request.requestId,
          requestSha256,
          sessionId:
            outcome.openingSession.state === 'present'
              ? outcome.openingSession.sessionId
              : null,
          namespaceSha256,
          invocationCorrelation: structuredClone(attempt.invocationCorrelation),
        }),
      })
    )
  }
  return Object.freeze(recovered)
}

export async function recoverRetainedEditSessionsV1(
  input: RecoverRetainedEditSessionsInputV1
): Promise<RecoverRetainedEditSessionsResultV1>
{
  const capability = await input.artifactStore.capability()
  if (!capability.writable || !capability.exclusiveWriter)
    return refuse('exclusive recovery requires one writable exclusive store')
  const sessionEntries = await input.artifactStore.listImmutable('sessions')
  await recoverPreManifestPrefixesV1(input, sessionEntries)
  const recoveredAttempts: RecoveredRetainedEditAttemptV1[] = []
  const manifests = sessionEntries.filter((entry) =>
    entry.key.endsWith('/session.json')
  )
  for (const manifest of manifests.sort((left, right) =>
    left.key.localeCompare(right.key)
  ))
  {
    const match = SESSION_MANIFEST_PATTERN.exec(manifest.key)
    if (match === null)
      return refuse(`noncanonical session manifest key ${manifest.key}`)
    const sessionKey = assertEditLogicalComponent(match[1]!)
    const layout = editSessionLayoutV1(sessionKey)
    await reconcileCommittedBeginV1(input, sessionKey)
    const contract = await readJsonV1<BoundChangeContractV1>(
      input.artifactStore,
      layout.boundChangeContract,
      `session ${sessionKey} bound contract`
    )
    const planKey = layout.recoveryTerminalPlan
    const planPresent = (
      await input.artifactStore.listImmutable(`${layout.prefix}/recovery`)
    ).some((entry) => entry.key === planKey)
    let plan: RetainedTerminalPlanV1 | null
    if (planPresent)
    {
      plan = await readJsonV1<RetainedTerminalPlanV1>(
        input.artifactStore,
        planKey,
        `session ${sessionKey} terminal recovery plan`
      )
      exactFieldsV1(
        plan,
        [
          'artifactByteLimit',
          'artifactBytesAfterRecovery',
          'evictions',
          'idempotencyPointerBytesHex',
          'idempotencyPointerExpectedSha256',
          'immutables',
          'kind',
          'preEventHeadSha256',
          'preReplayState',
          'preSemanticReportSha256',
          'quotaSettlements',
          'quotaReleases',
          'reportPointerBytesHex',
          'reportPointerExpectedSha256',
          'recoveryActualBytes',
          'recoveryReservationId',
          'recoveryReservedBytes',
          'recoveredAttempts',
          'schemaVersion',
          'sessionId',
          'sessionKey',
        ],
        `session ${sessionKey} terminal recovery plan`
      )
      if (
        plan.schemaVersion !== 1 ||
        plan.kind !== 'retained-edit-session-terminal-plan-v1' ||
        plan.sessionKey !== sessionKey
      )
        return refuse(`session ${sessionKey} terminal recovery plan differs`)
    }
    else
    {
      plan = await buildTerminalPlanV1(input, sessionKey, contract)
      if (plan !== null)
      {
        await input.artifactStore.reserveQuota(
          plan.recoveryReservationId,
          plan.recoveryReservedBytes
        )
        try
        {
          await input.artifactStore.createOrVerifyImmutable(
            planKey,
            canonicalJsonBytesV1(plan)
          )
        }
        catch (error)
        {
          await input.artifactStore
            .releaseQuota(plan.recoveryReservationId)
            .catch(() => undefined)
          throw error
        }
      }
    }
    if (plan !== null)
    {
      await installTerminalPlanV1(
        input,
        plan,
        contract.effectiveLimits.artifactBytesPerSessionLimit
      )
      recoveredAttempts.push(...plan.recoveredAttempts)
    }
    const replay = await verifyEditSessionReplayV1({
      artifactStore: input.artifactStore,
      sessionKey,
      boundChangeContract: contract,
      transactionExecutor: new ProductionTransactionExecutorV1(),
    })
    if (
      !replay.ok ||
      (replay.state !== 'closed-abandoned' &&
        replay.state !== 'closed-unexported' &&
        replay.state !== 'closed-exported')
    )
      return refuse(
        `session ${sessionKey} did not replay as terminal: ${replay.failures.join('; ')}`
      )
  }
  const inventory = await inventoryRetainedEditSessionsV1({
    artifactStore: input.artifactStore,
  })
  const retainedTransportOutcomes = await retainedTransportOutcomesV1(
    input.artifactStore,
    inventory
  )
  const retainedBeginOutcomes = await retainedBeginOutcomesV1(
    input.artifactStore,
    inventory
  )
  const byNamespace = new Map(
    recoveredAttempts.map((entry) => [entry.namespaceSha256, entry])
  )
  for (const retained of [
    ...retainedTransportOutcomes,
    ...retainedBeginOutcomes,
  ])
  {
    const previous = byNamespace.get(retained.namespaceSha256)
    if (
      previous !== undefined &&
      editCanonicalSha256V1(previous) !== editCanonicalSha256V1(retained)
    )
      return refuse('recovered attempts repeat one namespace with drift')
    byNamespace.set(retained.namespaceSha256, retained)
  }
  return Object.freeze({
    ...inventory,
    recoveredAttempts: Object.freeze(
      [...byNamespace.values()].sort((left, right) =>
        left.namespaceSha256.localeCompare(right.namespaceSha256)
      )
    ),
  })
}
