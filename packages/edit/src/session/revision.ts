// packages/edit/src/session/revision.ts
// deterministic revision, history, delta, preservation, allocator, & report projections

import type { SemanticEditArtifactPreflight } from '@scratch-agent/eval'
import { Uids, type ProjectDelta, type UidSnapshot } from '@scratch-agent/ir'
import {
  type EditAllocatorHashProjectionV1,
  semanticHashV1,
  type AcceptedRevisionHistoryEntryV1,
  type EditDeltaHashProjectionV1,
  type EditHistoryHashProjectionV1,
  type EditPreservationHashProjectionV1,
  type EditRevisionHashProjectionV1,
  type EditRevisionV1,
  type EditSemanticReportHashProjectionV1,
  type HeadProjectionV1,
  type InvocationCorrelationV1,
  type RestoreHistoryEdgeV1,
  type RevisionTransitionAttributionV1,
} from '@scratch-agent/ir/edit'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { editCanonicalSha256V1, exactRevisionFromHeadV1 } from '../support/canonical.js'
import { projectDeltaOperationAttributionProjectionV1 } from '../lineage/cumulative-attribution.js'
import {
  emptyFutureBindingLedgerV1,
  type FutureBindingLedgerV1,
} from '../lineage/future-binding-ledger.js'
import type {
  EditKernelRevisionRecordV1,
  EditKernelTransactionResultV1,
} from '../contracts/kernel-types.js'
import {
  emptyEditRuntimeProjectionAuthorizationsV1,
  immutableEditRuntimeProjectionAuthorizationsV1,
} from '../evaluation/runtime-projection-authority.js'

function emptySetSha256(label: string): string
{
  return editCanonicalSha256V1({ schemaVersion: 1, label, entries: [] })
}

function emptyCompleteProjectDeltaV1(): ProjectDelta
{
  return {
    complete: true,
    targets: [],
    assets: [],
    projectChanges: [],
    protectedChanges: [],
    summary: {
      touchedTargets: 0,
      touchedScripts: 0,
      addedBlocks: 0,
      removedBlocks: 0,
      changedBlockRecords: 0,
      changedAuthoredBlocks: 0,
      graphLinkOnlyBlocks: 0,
      changedDeclarations: 0,
      changedGameplayProperties: 0,
      changedExistingEditorLayout: 0,
      changedAssets: 0,
      changedProjectMetadata: 0,
      changedUnknownFields: 0,
    },
  }
}

function retainedContractAuthorizationV1(value: unknown): unknown | undefined
{
  if (value === null || typeof value !== 'object') return undefined
  const contractAuthorization = (value as Record<string, unknown>)[
    'contractAuthorization'
  ]
  return contractAuthorization === undefined
    ? undefined
    : structuredClone(contractAuthorization)
}

function allocatorProjectionV1(
  value: unknown,
  priorAllocatorStateSha256?: string
): EditAllocatorHashProjectionV1
{
  const snapshot = structuredClone(value) as UidSnapshot
  Uids.fromSnapshot(snapshot)
  const generated = new Set(snapshot.generatedReservationIds)
  const sourceCollisionUniverse = snapshot.usedIds.filter(
    (id) => !generated.has(id)
  )
  return {
    schemaVersion: 1,
    allocationNonce: snapshot.counter,
    sourceCollisionUniverseSha256: editCanonicalSha256V1(
      sourceCollisionUniverse
    ),
    issuedScratchIdCount: snapshot.generatedReservationIds.length,
    issuedScratchIdSetSha256: editCanonicalSha256V1(
      snapshot.generatedReservationIds
    ),
    tombstoneSetSha256: editCanonicalSha256V1(snapshot.tombstonedIds),
    ...(priorAllocatorStateSha256 === undefined
      ? {}
      : { priorAllocatorStateSha256 }),
  }
}

export function allocatorStateSha256V1(
  value: unknown,
  priorAllocatorStateSha256?: string
): string
{
  return semanticHashV1(
    'allocator',
    allocatorProjectionV1(value, priorAllocatorStateSha256)
  )
}

export function lineageSnapshotSha256V1(value: unknown): string
{
  return editCanonicalSha256V1({ schemaVersion: 1, snapshot: value })
}

function deltaProjectionV1(
  sourceArtifactSha256: string,
  beforeCandidateSha256: string,
  afterCandidateSha256: string,
  delta: unknown,
  operationAttribution: unknown
): EditDeltaHashProjectionV1
{
  const deltaRecord =
    delta !== null && typeof delta === 'object'
      ? (delta as Record<string, unknown>)
      : {}
  const summary =
    deltaRecord.summary !== null && typeof deltaRecord.summary === 'object'
      ? (deltaRecord.summary as Record<string, unknown>)
      : {}
  const semanticLeafCount = Object.values(summary).reduce<number>(
    (total, value) =>
      total +
      (typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : 0),
    0
  )
  return {
    schemaVersion: 1,
    sourceArtifactSha256,
    beforeCandidateSha256,
    afterCandidateSha256,
    semanticLeafCount,
    semanticLeafSetSha256: editCanonicalSha256V1(delta),
    protectedLeafSetSha256: editCanonicalSha256V1(
      deltaRecord.protectedChanges ?? []
    ),
    assetDeltaSetSha256: editCanonicalSha256V1(deltaRecord.assets ?? []),
    operationAttributionSha256: editCanonicalSha256V1(operationAttribution),
  }
}

function preservationProjectionV1(
  sourceArtifactSha256: string,
  changeContractSha256: string,
  beforeCandidateSha256: string,
  afterCandidateSha256: string,
  preservation: unknown,
  authorization: unknown
): EditPreservationHashProjectionV1
{
  const preserved =
    preservation !== null &&
    typeof preservation === 'object' &&
    'preserved' in preservation &&
    preservation.preserved === true
  const authorized =
    authorization !== null &&
    typeof authorization === 'object' &&
    'authorized' in authorization &&
    authorization.authorized === true
  return {
    schemaVersion: 1,
    sourceArtifactSha256,
    beforeCandidateSha256,
    afterCandidateSha256,
    changeContractSha256,
    requiredChangeResultSha256: editCanonicalSha256V1({ satisfied: true }),
    allowedChangeResultSha256: editCanonicalSha256V1(authorization),
    protectedSurfaceResultSha256: editCanonicalSha256V1(preservation),
    preservationLensResultSha256: editCanonicalSha256V1({
      preserved,
      authorized,
    }),
    status: preserved && authorized ? 'passed' : 'failed',
  }
}

interface RevisionBuildCommon
{
  semanticSourceSha256: string
  sourceArtifactSha256: string
  changeContractSha256: string
  capabilityProfileSha256: string
  capabilitySnapshotSha256: string
  originatingRequestId: string
  invocationCorrelation: InvocationCorrelationV1
  hostTimestampEpochMs: number
}

export function buildSourceRevisionV1(
  common: RevisionBuildCommon,
  preflight: SemanticEditArtifactPreflight,
  allocatorState: unknown,
  activeLineage: unknown,
  lineageHistory: unknown,
  candidateKey: string,
  manifestKey: string
): EditKernelRevisionRecordV1
{
  if (
    !preflight.ok ||
    !preflight.admission ||
    !preflight.semanticSourceIdentity ||
    !preflight.semanticSourceSha256
  )
    throw new Error('revision zero requires a successful semantic preflight')
  const candidateSha256 = common.sourceArtifactSha256
  const emptyDelta = emptyCompleteProjectDeltaV1()
  const emptyDeltaProjection = deltaProjectionV1(
    common.sourceArtifactSha256,
    candidateSha256,
    candidateSha256,
    emptyDelta,
    projectDeltaOperationAttributionProjectionV1(emptyDelta)
  )
  const transition: RevisionTransitionAttributionV1 = {
    transitionKind: 'sourceAdmission',
    semanticSourceSha256: common.semanticSourceSha256,
  }
  const authorization = {
    authorized: true,
    violations: [],
    futureBindingLedger: emptyFutureBindingLedgerV1(
      common.changeContractSha256
    ),
  }
  const hashProjection: EditRevisionHashProjectionV1 = {
    schemaVersion: 1,
    semanticSourceSha256: common.semanticSourceSha256,
    revisionNumber: 0,
    predecessor: { state: 'absent' },
    transition,
    candidateSha256,
    candidateByteLength: preflight.semanticSourceIdentity.archiveByteLength,
    projectJsonSha256: preflight.semanticSourceIdentity.projectJsonSha256,
    assetManifestSha256: preflight.semanticSourceIdentity.assetManifestSha256,
    changeContractSha256: common.changeContractSha256,
    capabilityProfileSha256: common.capabilityProfileSha256,
    allocatorReservationStateSha256: allocatorStateSha256V1(allocatorState),
    activeLineageSnapshotSha256: lineageSnapshotSha256V1(activeLineage),
    lineageHistoryLedgerSha256: lineageSnapshotSha256V1(lineageHistory),
    parentChildDeltaSha256: semanticHashV1('delta', emptyDeltaProjection),
    sourceHeadDeltaSha256: semanticHashV1('delta', emptyDeltaProjection),
    preservationSha256: semanticHashV1(
      'preservation',
      preservationProjectionV1(
        common.sourceArtifactSha256,
        common.changeContractSha256,
        candidateSha256,
        candidateSha256,
        { preserved: true, violations: [] },
        authorization
      )
    ),
    authorizationSha256: editCanonicalSha256V1(authorization),
    diagnosticSha256: semanticHashV1('diagnostic', {
      schemaVersion: 1,
      sourceArtifactSha256: common.sourceArtifactSha256,
      revisionNumber: 0,
      severity: 'info',
      diagnosticCode: 'edit.revision-zero-admitted',
      normalizedPayloadSha256: emptySetSha256('revision-zero-diagnostics'),
    }),
    cheapGateStatus: 'passed',
    operationResultSetSha256: emptySetSha256('operation-results'),
    operationResultLineageCorrespondenceSha256: emptySetSha256(
      'operation-result-lineage'
    ),
  }
  const revisionId = semanticHashV1('revision', hashProjection)
  const revision: EditRevisionV1 = {
    hashProjection,
    revisionId,
    originatingRequestId: common.originatingRequestId,
    invocationCorrelation: common.invocationCorrelation,
    hostEvidenceTimestampEpochMs: common.hostTimestampEpochMs,
  }
  const head: HeadProjectionV1 = {
    sourceArtifactSha256: common.sourceArtifactSha256,
    revisionNumber: 0,
    revisionId,
    candidateSha256,
    assetManifestSha256: hashProjection.assetManifestSha256,
    changeContractSha256: common.changeContractSha256,
    capabilityProfileSha256: common.capabilityProfileSha256,
    capabilitySnapshotSha256: common.capabilitySnapshotSha256,
  }
  return {
    revision,
    head,
    candidateKey,
    manifestKey,
    projectJsonSha256: hashProjection.projectJsonSha256,
    transitionDescriptor: {
      kind: 'sourceAdmission',
      semanticSourceSha256: common.semanticSourceSha256,
    },
    allocatorState,
    activeLineage,
    lineageHistory,
    parentDelta: emptyDelta,
    cumulativeDelta: emptyDelta,
    preservation: { preserved: true, violations: [] },
    authorization,
    diagnostics: { status: 'passed', graph: [], static: [] },
    operationResults: [],
    operationResultSummaries: [],
    runtimeProjectionAuthorizations:
      emptyEditRuntimeProjectionAuthorizationsV1(),
    capabilitySnapshot: null,
  }
}

export function buildAppliedRevisionV1(
  common: RevisionBuildCommon,
  predecessor: EditKernelRevisionRecordV1,
  transaction: EditKernelTransactionResultV1,
  candidateKey: string,
  manifestKey: string,
  predictedProjectJsonSha256: string,
  predictedAssetManifestSha256: string
): EditKernelRevisionRecordV1
{
  const revisionNumber = predecessor.head.revisionNumber + 1
  const candidateSha256 = sha256Hex(transaction.candidateBytes)
  const parentDeltaProjection = deltaProjectionV1(
    common.sourceArtifactSha256,
    predecessor.head.candidateSha256,
    candidateSha256,
    transaction.parentDelta,
    projectDeltaOperationAttributionProjectionV1(
      transaction.parentDelta as ProjectDelta
    )
  )
  const cumulativeDeltaProjection = deltaProjectionV1(
    common.sourceArtifactSha256,
    common.sourceArtifactSha256,
    candidateSha256,
    transaction.cumulativeDelta,
    projectDeltaOperationAttributionProjectionV1(
      transaction.cumulativeDelta as ProjectDelta
    )
  )
  const preservation = preservationProjectionV1(
    common.sourceArtifactSha256,
    common.changeContractSha256,
    predecessor.head.candidateSha256,
    candidateSha256,
    transaction.preservation,
    transaction.authorization
  )
  const hashProjection: EditRevisionHashProjectionV1 = {
    schemaVersion: 1,
    semanticSourceSha256: common.semanticSourceSha256,
    revisionNumber,
    predecessor: {
      state: 'present',
      revisionNumber: predecessor.head.revisionNumber,
      revisionId: predecessor.head.revisionId,
    },
    transition: transaction.transition,
    candidateSha256,
    candidateByteLength: transaction.candidateBytes.byteLength,
    projectJsonSha256: predictedProjectJsonSha256,
    assetManifestSha256: predictedAssetManifestSha256,
    changeContractSha256: common.changeContractSha256,
    capabilityProfileSha256: common.capabilityProfileSha256,
    allocatorReservationStateSha256: allocatorStateSha256V1(
      transaction.allocatorState,
      predecessor.revision.hashProjection.allocatorReservationStateSha256
    ),
    activeLineageSnapshotSha256: lineageSnapshotSha256V1(
      transaction.activeLineage
    ),
    lineageHistoryLedgerSha256: lineageSnapshotSha256V1(
      transaction.lineageHistory
    ),
    parentChildDeltaSha256: semanticHashV1('delta', parentDeltaProjection),
    sourceHeadDeltaSha256: semanticHashV1('delta', cumulativeDeltaProjection),
    preservationSha256: semanticHashV1('preservation', preservation),
    authorizationSha256: editCanonicalSha256V1(transaction.authorization),
    diagnosticSha256: semanticHashV1('diagnostic', {
      schemaVersion: 1,
      sourceArtifactSha256: common.sourceArtifactSha256,
      revisionNumber,
      severity: 'info',
      diagnosticCode: 'edit.cheap-gates-passed',
      normalizedPayloadSha256: editCanonicalSha256V1(transaction.diagnostics),
    }),
    cheapGateStatus: 'passed',
    operationResultSetSha256: editCanonicalSha256V1(
      transaction.operationResults
    ),
    operationResultLineageCorrespondenceSha256:
      transaction.operationResultLineageCorrespondenceSha256,
  }
  const revisionId = semanticHashV1('revision', hashProjection)
  const revision: EditRevisionV1 = {
    hashProjection,
    revisionId,
    originatingRequestId: common.originatingRequestId,
    invocationCorrelation: common.invocationCorrelation,
    hostEvidenceTimestampEpochMs: common.hostTimestampEpochMs,
  }
  return {
    revision,
    head: {
      sourceArtifactSha256: common.sourceArtifactSha256,
      revisionNumber,
      revisionId,
      candidateSha256,
      assetManifestSha256: predictedAssetManifestSha256,
      changeContractSha256: common.changeContractSha256,
      capabilityProfileSha256: common.capabilityProfileSha256,
      capabilitySnapshotSha256: common.capabilitySnapshotSha256,
    },
    candidateKey,
    manifestKey,
    projectJsonSha256: predictedProjectJsonSha256,
    transitionDescriptor: {
      kind: 'apply',
      canonicalTransaction: transaction.canonicalTransaction,
      resolvedPlanSha256: transaction.resolvedPlanSha256,
      resolvedSemanticBatchSha256: transaction.resolvedSemanticBatchSha256,
      operationCount: transaction.operationCount,
    },
    allocatorState: transaction.allocatorState,
    activeLineage: transaction.activeLineage,
    lineageHistory: transaction.lineageHistory,
    parentDelta: transaction.parentDelta,
    cumulativeDelta: transaction.cumulativeDelta,
    preservation,
    authorization: transaction.authorization,
    diagnostics: transaction.diagnostics,
    operationResults: transaction.operationResults,
    operationResultSummaries: transaction.operationResultSummaries,
    runtimeProjectionAuthorizations:
      immutableEditRuntimeProjectionAuthorizationsV1(
        transaction.runtimeProjectionAuthorizations
      ),
    capabilitySnapshot: null,
  }
}

export function buildRestoreRevisionV1(
  common: RevisionBuildCommon,
  from: EditKernelRevisionRecordV1,
  selected: EditKernelRevisionRecordV1,
  restoreKind: 'undo' | 'rollback',
  restoreCommandSha256: string,
  restoreDelta: unknown,
  monotonicAllocator: unknown,
  monotonicLineageHistory: unknown,
  monotonicFutureBindingLedger: FutureBindingLedgerV1,
  candidateKey: string,
  manifestKey: string
): EditKernelRevisionRecordV1
{
  const revisionNumber = from.head.revisionNumber + 1
  const transition: RevisionTransitionAttributionV1 = {
    transitionKind: restoreKind,
    fromRevision: exactRevisionFromHeadV1(from.head),
    selectedRevision: exactRevisionFromHeadV1(selected.head),
    restoreCommandSha256,
    restoreDeltaAttributionSha256: editCanonicalSha256V1(restoreDelta),
  }
  const parentDeltaProjection = deltaProjectionV1(
    common.sourceArtifactSha256,
    from.head.candidateSha256,
    selected.head.candidateSha256,
    restoreDelta,
    projectDeltaOperationAttributionProjectionV1(restoreDelta as ProjectDelta)
  )
  const cumulativeDelta = selected.cumulativeDelta
  const contractAuthorization = retainedContractAuthorizationV1(
    selected.authorization
  )
  const authorization = {
    authorized: true,
    restoreKind,
    selectedRevisionId: selected.head.revisionId,
    futureBindingLedger: monotonicFutureBindingLedger,
    ...(contractAuthorization === undefined ? {} : { contractAuthorization }),
  }
  const hashProjection: EditRevisionHashProjectionV1 = {
    ...selected.revision.hashProjection,
    revisionNumber,
    predecessor: {
      state: 'present',
      revisionNumber: from.head.revisionNumber,
      revisionId: from.head.revisionId,
    },
    transition,
    allocatorReservationStateSha256: allocatorStateSha256V1(
      monotonicAllocator,
      from.revision.hashProjection.allocatorReservationStateSha256
    ),
    activeLineageSnapshotSha256: lineageSnapshotSha256V1(
      selected.activeLineage
    ),
    lineageHistoryLedgerSha256: lineageSnapshotSha256V1(
      monotonicLineageHistory
    ),
    parentChildDeltaSha256: semanticHashV1('delta', parentDeltaProjection),
    sourceHeadDeltaSha256:
      selected.revision.hashProjection.sourceHeadDeltaSha256,
    authorizationSha256: editCanonicalSha256V1(authorization),
    operationResultSetSha256: emptySetSha256('restore-operation-results'),
    operationResultLineageCorrespondenceSha256: emptySetSha256(
      'restore-lineage-correspondence'
    ),
  }
  const revisionId = semanticHashV1('revision', hashProjection)
  const revision: EditRevisionV1 = {
    hashProjection,
    revisionId,
    originatingRequestId: common.originatingRequestId,
    invocationCorrelation: common.invocationCorrelation,
    hostEvidenceTimestampEpochMs: common.hostTimestampEpochMs,
  }
  return {
    revision,
    head: {
      ...selected.head,
      revisionNumber,
      revisionId,
      capabilitySnapshotSha256: common.capabilitySnapshotSha256,
    },
    candidateKey,
    manifestKey,
    projectJsonSha256: selected.projectJsonSha256,
    transitionDescriptor: {
      kind: restoreKind,
      fromRevision: exactRevisionFromHeadV1(from.head),
      selectedRevision: exactRevisionFromHeadV1(selected.head),
      restoreCommandSha256,
    },
    allocatorState: monotonicAllocator,
    activeLineage: selected.activeLineage,
    lineageHistory: monotonicLineageHistory,
    parentDelta: restoreDelta,
    cumulativeDelta,
    preservation: selected.preservation,
    authorization,
    diagnostics: selected.diagnostics,
    operationResults: [],
    operationResultSummaries: [],
    runtimeProjectionAuthorizations:
      immutableEditRuntimeProjectionAuthorizationsV1(
        selected.runtimeProjectionAuthorizations
      ),
    capabilitySnapshot: null,
  }
}

export function historyProjectionV1(
  semanticSourceSha256: string,
  revisions: readonly EditKernelRevisionRecordV1[]
): {
  projection: EditHistoryHashProjectionV1
  sha256: string
}
{
  if (revisions.length === 0) throw new Error('edit history cannot be empty')
  const orderedRevisions: AcceptedRevisionHistoryEntryV1[] = revisions.map(
    (entry) => ({
      revisionNumber: entry.head.revisionNumber,
      revisionId: entry.head.revisionId,
      predecessor: entry.revision.hashProjection.predecessor,
      transition: entry.revision.hashProjection.transition,
    })
  )
  const restoreEdges: RestoreHistoryEdgeV1[] = revisions.flatMap((entry) =>
  {
    const transition = entry.revision.hashProjection.transition
    if (
      transition.transitionKind !== 'undo' &&
      transition.transitionKind !== 'rollback'
    )
      return []
    const from = revisions.find(
      (candidate) =>
        candidate.head.revisionNumber ===
          transition.fromRevision.revisionNumber &&
        candidate.head.revisionId === transition.fromRevision.revisionId
    )
    const selected = revisions.find(
      (candidate) =>
        candidate.head.revisionNumber ===
          transition.selectedRevision.revisionNumber &&
        candidate.head.revisionId === transition.selectedRevision.revisionId
    )
    if (!from || !selected)
      throw new Error('restore history edge references an absent revision')
    const restoreDelta = entry.parentDelta as ProjectDelta
    return [
      {
        transitionRevisionId: entry.head.revisionId,
        restoreKind: transition.transitionKind,
        fromRevisionId: transition.fromRevision.revisionId,
        selectedRevisionId: transition.selectedRevision.revisionId,
        restoreDelta: deltaProjectionV1(
          entry.head.sourceArtifactSha256,
          from.head.candidateSha256,
          selected.head.candidateSha256,
          restoreDelta,
          projectDeltaOperationAttributionProjectionV1(restoreDelta)
        ),
      },
    ]
  })
  const projection: EditHistoryHashProjectionV1 = {
    schemaVersion: 1,
    semanticSourceSha256,
    orderedRevisions,
    restoreEdges,
    head: exactRevisionFromHeadV1(revisions.at(-1)!.head),
  }
  return { projection, sha256: semanticHashV1('history', projection) }
}

export function semanticReportProjectionV1(
  semanticSourceSha256: string,
  changeContractSha256: string,
  capabilityProfileSha256: string,
  revisions: readonly EditKernelRevisionRecordV1[],
  certificateSetSha256?: string
): {
  projection: EditSemanticReportHashProjectionV1
  sha256: string
}
{
  const history = historyProjectionV1(semanticSourceSha256, revisions)
  const projection: EditSemanticReportHashProjectionV1 = {
    schemaVersion: 1,
    semanticSourceSha256,
    changeContractSha256,
    capabilityProfileSha256,
    finalHead: exactRevisionFromHeadV1(revisions.at(-1)!.head),
    revisionSetSha256: editCanonicalSha256V1(
      revisions.map((entry) => entry.revision.revisionId)
    ),
    deltaSetSha256: editCanonicalSha256V1(
      revisions.map((entry) => ({
        parent: entry.revision.hashProjection.parentChildDeltaSha256,
        cumulative: entry.revision.hashProjection.sourceHeadDeltaSha256,
      }))
    ),
    historySha256: history.sha256,
    // the ordered certificate set from evaluation-certificate.ts; a session
    // that issued none reproduces the canonical empty set byte for byte
    certificateSetSha256:
      certificateSetSha256 ?? emptySetSha256('evaluation-certificates'),
  }
  return {
    projection,
    sha256: semanticHashV1('semantic-report-projection', projection),
  }
}
