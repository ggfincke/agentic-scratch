// packages/edit/src/replay/replay.ts
// verify head-reachable semantic history from retained source & authority only

import {
  aggregateAllowedChangeV1,
  aggregatePreservationV1,
  aggregateRequiredChangeV1,
  EDIT_IDENTITY_BOUND_ACTION_INCONCLUSIVE_CODE_V1,
  editObservationPlanSha256V1,
  editEvidenceContentCollectionV1,
  editRuntimeHashV1,
  bindEditRuntimeArtifactV1,
  deriveEditProductionExternalRequestsV1,
  lowerEditScenarioPolicyV1,
  rederiveEditProductionDeterministicV1,
  inspectSemanticEditArtifact,
  reserveEditEvaluationMatrixV1,
  wrapEditEvaluationEvidenceV1,
  type EditCandidateObservationV1,
  type EditEvaluationMatrixCellV1,
  type EditEvaluationMatrixReservationV1,
  type EditLaneStatusV1,
  type EditProductionDeterministicAuthorityV1,
  type EditProductionEvaluationRequestV1,
  type EditProductionExternalSelectionSourceV1,
  type EditProductionReplayMediaV1,
  type EditStructuralObjectiveObservationV1,
} from '@scratch-agent/eval'
import { ProjectIR } from '@scratch-agent/ir'
import {
  semanticHashV1,
  type EditExportRequestV1,
  type EditSemanticSourceIdentityHashProjectionV1,
  type ExactRevisionIdentityV1,
  type SemanticEditCapabilityProfileEnvelopeV1,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import {
  admittedEditAssetV1,
  editAssetAdmissionEvidenceIdV1,
  type AdmittedEditAssetResolverV1,
  type RetainedEditAssetRecordV1,
} from '../assets/asset-admission.js'
import type { BoundChangeContractV1 } from '../contracts/change-contracts.js'
import {
  buildEditEvaluationCertificateV1,
  certificateSetProjectionV1,
  type EditRetainedCertificateV1,
} from '../evaluation/evaluation-certificate.js'
import {
  activateEvaluationPlanSetV1,
  type ActivatedEvaluationPlanSetV1,
} from '../evaluation/evaluation-plans.js'
import { structuralObjectiveObservationsV1 } from '../evaluation/evaluation-structural.js'
import {
  editExternalEvidenceRequiredGateSha256V1,
  editExternalEvidenceRequestSemanticProjectionV1,
  editStagedExternalEvidenceResultSha256V1,
  evaluationProvenanceChainSha256V1,
  type EditEvaluationEvidenceEntryV1,
  type EditExternalEvidenceRequestArtifactV1,
  type EditStagedExternalEvidenceRecordV1,
} from '../evaluation/evaluation-ports.js'
import {
  deniedDestinationSetSha256V1,
  editExportGateSha256V1,
  editExportPreparedProofSha256V1,
  editExportReopenSha256V1,
  editExportSourcePreservationSha256V1,
  editExportProvenanceSha256V1,
  editPublicationProofSha256V1,
  editSemanticExportReceiptSha256V1,
  EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
  type EditExportProvenanceV1,
  type EditExportReopenEvidenceV1,
  type EditSemanticExportReceiptV1,
} from '../assets/publication.js'
import {
  auditEditReportCompletenessV1,
  type EditReportCompletenessResultV1,
} from '../session/report-audit.js'
import {
  editCanonicalBytesV1,
  editCanonicalSha256V1,
  exactRevisionFromHeadV1,
  sameHeadV1,
} from '../support/canonical.js'
import {
  editRestoreOccurrenceIdV1,
  singleOperationProjectDeltaAttributionV1,
} from '../lineage/cumulative-attribution.js'
import {
  existingBindingOwnerLineageResolverV1,
  reconcileRestoreFutureBindingLedgerV1,
  validateFutureBindingLedgerV1,
  type FutureBindingLedgerV1,
} from '../lineage/future-binding-ledger.js'
import type {
  EditKernelAttemptV1,
  EditKernelCheckpointV1,
  EditKernelReplayResultV1,
  EditKernelReportV1,
  EditKernelRevisionRecordV1,
  EditKernelSemanticEventV1,
  EditKernelSessionManifestV1,
} from '../contracts/kernel-types.js'
import { editSessionLayoutV1 } from '../session/layout.js'
import {
  buildSourceLineageV1,
  reconcileRestoreLineageHistoryV1,
} from '../lineage/lineage.js'
import { computeLineageProjectDeltaV1 } from '../lineage/lineage-delta.js'
import {
  buildEditDiagnosticLineageTablesV1,
  buildEditRuntimeBindingTableV1,
  buildEditRuntimeLineageAssignmentV1,
} from '../evaluation/runtime-evaluation-context.js'
import type {
  EditArtifactEntryV1,
  EditArtifactStorePort,
  EditPublicationDirectoryIdentityV1,
  EditPublicationNameInspectionV1,
} from '../transaction/ports.js'
import {
  retainedAssetDomainRecordFailureV1,
  retainedStatefulRequestBindingFailureV1,
} from '../session/retained-request-authority.js'
import {
  allocatorStateSha256V1,
  buildAppliedRevisionV1,
  buildRestoreRevisionV1,
  buildSourceRevisionV1,
  historyProjectionV1,
  lineageSnapshotSha256V1,
  semanticReportProjectionV1,
} from '../session/revision.js'
import type { EditTransactionExecutorV1 } from '../transaction/transaction.js'

interface VerifyEditSessionReplayOptionsV1
{
  artifactStore: EditArtifactStorePort
  sessionKey: string
  boundChangeContract: BoundChangeContractV1
  transactionExecutor: EditTransactionExecutorV1
}

interface HeadPointerV1
{
  schemaVersion: 1
  head: EditKernelRevisionRecordV1['head']
  revisionManifestSha256: string
}

function retainedFutureBindingLedgerV1(value: unknown): FutureBindingLedgerV1
{
  if (value === null || typeof value !== 'object')
    throw new Error('revision authorization is absent')
  const ledger = (value as Record<string, unknown>)['futureBindingLedger']
  if (ledger === null || typeof ledger !== 'object')
    throw new Error('revision future-binding ledger is absent')
  return ledger as FutureBindingLedgerV1
}

interface ReportPointerV1
{
  schemaVersion: 1
  reportJsonSha256: string
  reportManifestSha256: string
}

function decode<T>(bytes: Uint8Array): T
{
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  ) as T
}

function sameCanonical(left: unknown, right: unknown): boolean
{
  return editCanonicalSha256V1(left) === editCanonicalSha256V1(right)
}

function containsHandleReference(value: unknown): boolean
{
  const pending = [value]
  const seen = new Set<object>()
  while (pending.length > 0)
  {
    const current = pending.pop()
    if (current === null || typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)
    if (
      !Array.isArray(current) &&
      (current as Record<string, unknown>).refKind === 'handle'
    )
      return true
    pending.push(...Object.values(current))
  }
  return false
}

function revisionKey(revisionNumber: number, revisionId: string): string
{
  return `${revisionNumber}:${revisionId}`
}

async function readJson<T>(
  store: EditArtifactStorePort,
  key: string
): Promise<T>
{
  return decode<T>(await store.readImmutable(key))
}

async function verifyJsonArtifact(
  store: EditArtifactStorePort,
  key: string,
  expected: unknown,
  failures: string[],
  label: string
): Promise<void>
{
  try
  {
    const bytes = await store.readImmutable(key)
    if (!sameCanonical(decode<unknown>(bytes), expected))
      failures.push(`${label} differs from the authority replay rederived`)
    if (sha256Hex(bytes) !== (await store.hashImmutable(key)))
      failures.push(`${label} store hash differs from retained bytes`)
  }
  catch (error)
  {
    failures.push(
      `${label} is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function expectedSemanticSourceIdentity(
  manifest: EditKernelSessionManifestV1,
  preflightIdentity: EditKernelSessionManifestV1['semanticSourceIdentity']
): EditKernelSessionManifestV1['semanticSourceIdentity']
{
  if (manifest.provenance.kind !== 'registeredTemplate')
    return preflightIdentity
  return {
    ...preflightIdentity,
    sourceKind: 'registeredTemplate',
    templateArtifactSha256: manifest.provenance.templateArtifactSha256,
    templateId: manifest.provenance.templateId,
    templateVersion: manifest.provenance.templateVersion,
  }
}

async function headReachableRevisions(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  headPointer: HeadPointerV1,
  failures: string[]
): Promise<{
  revisions: EditKernelRevisionRecordV1[]
  entriesByRevision: ReadonlyMap<string, EditArtifactEntryV1>
}>
{
  const manifestEntries = (
    await store.listImmutable(`${layout.prefix}/revisions`)
  ).filter((entry) => entry.key.endsWith('/manifest.json'))
  const records = new Map<string, EditKernelRevisionRecordV1>()
  const entries = new Map<string, EditArtifactEntryV1>()
  for (const entry of manifestEntries)
  {
    const record = await readJson<EditKernelRevisionRecordV1>(store, entry.key)
    const key = revisionKey(record.head.revisionNumber, record.head.revisionId)
    if (records.has(key))
    {
      failures.push(`duplicate revision manifest authority ${key}`)
      continue
    }
    records.set(key, record)
    entries.set(key, entry)
  }
  const reversed: EditKernelRevisionRecordV1[] = []
  const seen = new Set<string>()
  let key = revisionKey(
    headPointer.head.revisionNumber,
    headPointer.head.revisionId
  )
  while (true)
  {
    if (seen.has(key))
    {
      failures.push(
        'head-reachable revision predecessor chain contains a cycle'
      )
      break
    }
    seen.add(key)
    const record = records.get(key)
    if (!record)
    {
      failures.push(`head-reachable revision manifest ${key} is absent`)
      break
    }
    reversed.push(record)
    const predecessor = record.revision.hashProjection.predecessor
    if (predecessor.state === 'absent') break
    key = revisionKey(predecessor.revisionNumber, predecessor.revisionId)
  }
  return { revisions: reversed.reverse(), entriesByRevision: entries }
}

// media add/replace resolves an admitted asset token during reconstruction, so
// replay rebuilds the exact resolver the session had purely from the retained
// record & payload artifacts; nothing is re-admitted & no session state is read
async function retainedAssetResolver(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  failures: string[]
): Promise<AdmittedEditAssetResolverV1>
{
  const admitted = new Map<string, ReturnType<typeof admittedEditAssetV1>>()
  const entries = await store.listImmutable(layout.assetRecords)
  for (const entry of entries)
  {
    if (!entry.key.endsWith('.json')) continue
    try
    {
      const retained = await readJson<RetainedEditAssetRecordV1>(
        store,
        entry.key
      )
      const record = retained.record
      if (layout.assetRecord(record.assetToken) !== entry.key)
      {
        failures.push(`asset record ${entry.key} has the wrong token locator`)
        continue
      }
      const bytes = await store.readImmutable(
        layout.assetPayload(record.payloadSha256)
      )
      admitted.set(record.assetToken, admittedEditAssetV1(record, bytes))
    }
    catch (error)
    {
      failures.push(
        `asset record ${entry.key} does not rehydrate: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return (assetToken) => admitted.get(assetToken) ?? null
}

async function verifyRevisionArtifacts(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  record: EditKernelRevisionRecordV1,
  failures: string[]
): Promise<void>
{
  const number = record.head.revisionNumber
  const id = record.head.revisionId
  const artifacts = [
    ['batch.json', record.transitionDescriptor],
    [
      'resolved-plan.json',
      {
        resolvedPlanSha256:
          record.transitionDescriptor.kind === 'apply'
            ? record.transitionDescriptor.resolvedPlanSha256
            : null,
      },
    ],
    ['operation-results.json', record.operationResults],
    ['previous-delta.json', record.parentDelta],
    ['cumulative-delta.json', record.cumulativeDelta],
    ['preservation.json', record.preservation],
    ['authorization.json', record.authorization],
    ['diagnostics.json', record.diagnostics],
    ['allocator.json', record.allocatorState],
    ['lineage.json', record.activeLineage],
    ['lineage-history.json', record.lineageHistory],
    ['capability-snapshot.json', record.capabilitySnapshot],
    ['manifest.json', record],
  ] as const
  for (const [name, value] of artifacts)
  {
    await verifyJsonArtifact(
      store,
      layout.revision(number, id, name),
      value,
      failures,
      `revision ${number} ${name}`
    )
  }
}

// one map of filename -> entry per immutable record directory, so a verifier can
// name exactly which ordinal records an interrupted operation left behind
function groupByDirectoryV1(
  entries: readonly EditArtifactEntryV1[]
): ReadonlyMap<string, ReadonlyMap<string, EditArtifactEntryV1>>
{
  const grouped = new Map<string, Map<string, EditArtifactEntryV1>>()
  for (const entry of entries)
  {
    const cut = entry.key.lastIndexOf('/')
    if (cut < 0) continue
    const directory = entry.key.slice(0, cut)
    const name = entry.key.slice(cut + 1)
    const bucket = grouped.get(directory) ?? new Map()
    bucket.set(name, entry)
    grouped.set(directory, bucket)
  }
  return grouped
}

// the leading zero-padded ordinal of an evaluation or export directory name
function directorySequenceV1(directory: string): number | null
{
  const name = directory.slice(directory.lastIndexOf('/') + 1)
  const ordinal = /^([0-9]{6})-[0-9a-f]{16}$/u.exec(name)
  return ordinal ? Number(ordinal[1]) : null
}

interface RetainedDeterministicResultV1
{
  identity: Parameters<typeof buildEditEvaluationCertificateV1>[0]['identity']
  laneStatuses: Parameters<
    typeof buildEditEvaluationCertificateV1
  >[0]['laneStatuses']
  candidateObservations: readonly EditCandidateObservationV1[]
  preservationObservations: Parameters<
    typeof aggregatePreservationV1
  >[0]['observations']
  baselineDiagnostics: Parameters<
    typeof aggregateAllowedChangeV1
  >[0]['baselineDiagnostics']
  candidateDiagnostics: Parameters<
    typeof aggregateAllowedChangeV1
  >[0]['candidateDiagnostics']
  allowedNewDiagnosticFingerprints: Parameters<
    typeof aggregateAllowedChangeV1
  >[0]['allowedNewDiagnosticFingerprints']
  boundedResourceIssueCodes: Parameters<
    typeof aggregateAllowedChangeV1
  >[0]['boundedResourceIssueCodes']
  evidence: Parameters<typeof buildEditEvaluationCertificateV1>[0]['evidence']
  evidenceArtifactIndex: readonly import('../evaluation/evaluation-ports.js').EditEvaluationEvidenceArtifactIndexEntryV1[]
  limitations: readonly string[]
  projectJsonSha256: string
  evaluatedCandidateByteLength: number
  fixedTimePolicySha256: string
  seedSetSha256: string
  externalRequests: readonly EditExternalEvidenceRequestArtifactV1[]
}

// the session's own attempt-hash rule, restated here so replay derives the
// attempt identity rather than reading the one the attempt claims
function replayEvaluationAttemptSha256V1(input: {
  evaluationPlanId: string
  evaluationPlanSha256: string
  evaluatedRevision: unknown
  semanticSourceSha256: string
  historySha256: string
  matrixSha256: string
  sequence: number
}): string
{
  return semanticHashV1('certificate', {
    kind: 'evaluation-attempt',
    schemaVersion: 1,
    evaluationPlanId: input.evaluationPlanId,
    evaluationPlanSha256: input.evaluationPlanSha256,
    evaluatedRevision: input.evaluatedRevision,
    semanticSourceSha256: input.semanticSourceSha256,
    historySha256: input.historySha256,
    matrixSha256: input.matrixSha256,
    sequence: input.sequence,
  })
}

function replayDeterministicResultSha256V1(
  deterministic: RetainedDeterministicResultV1
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'deterministic-evaluation-result',
    identity: deterministic.identity,
    laneStatuses: deterministic.laneStatuses,
    candidateObservations: deterministic.candidateObservations,
    preservationObservations: deterministic.preservationObservations,
    baselineDiagnostics: deterministic.baselineDiagnostics,
    candidateDiagnostics: deterministic.candidateDiagnostics,
    allowedNewDiagnosticFingerprints:
      deterministic.allowedNewDiagnosticFingerprints,
    boundedResourceIssueCodes: deterministic.boundedResourceIssueCodes,
    evidence: deterministic.evidence,
    evidenceArtifactIndex: deterministic.evidenceArtifactIndex,
    projectJsonSha256: deterministic.projectJsonSha256,
    evaluatedCandidateByteLength: deterministic.evaluatedCandidateByteLength,
    fixedTimePolicySha256: deterministic.fixedTimePolicySha256,
    seedSetSha256: deterministic.seedSetSha256,
    externalRequests: deterministic.externalRequests.map(
      editExternalEvidenceRequestSemanticProjectionV1
    ),
    limitations: deterministic.limitations,
  })
}

interface VerifiedEvaluationsV1
{
  certificates: readonly EditRetainedCertificateV1[]
  completedCount: number
  reconstructedExternalObservations: number
  recoveryRequired: boolean
}

interface RetainedEvaluationPreparationV1
{
  schemaVersion: 1
  sequence: number
  evaluationPlanId: string
  evaluationPlanSha256: string
  evaluatedRevision: ExactRevisionIdentityV1
  semanticSourceSha256: string
  historySha256: string
  matrixSha256: string
  attemptSha256: string
  startRequestSha256: string
  startAttemptNamespaceSha256: string
  reservationId: string
  reservedBytes: number
}

interface RetainedEvaluationAwaitingV1
{
  schemaVersion: 1
  evaluationId: string
  requestSetSha256: string
  deadlineEpochMs: number
  deadlineSha256: string
  notificationSha256: string
  eventSha256: string
}

interface ReplayedCellRuntimeAuthorityV1
{
  cell: EditEvaluationMatrixCellV1
  artifactSha256: string
  manifestSha256: string
  loweredScenarioSha256: string
  semanticPolicySha256: string
  runtimePolicySha256: string
  scenarioSteps: readonly { readonly do: string }[]
}

interface ReplayedProductionAuthorityContextV1
{
  cells: ReadonlyMap<string, ReplayedCellRuntimeAuthorityV1>
  request: EditProductionEvaluationRequestV1
}

interface ReplayedEvaluationEvidenceAuthorityV1
{
  deterministicAuthority: EditProductionDeterministicAuthorityV1 | null
  baselinePreflight: unknown | null
  candidatePreflight: unknown | null
  matrixProjection: Readonly<Record<string, unknown>> | null
  traceProjections: readonly unknown[]
  mediaByCell: ReadonlyMap<string, readonly EditProductionReplayMediaV1[]>
  externalSelectionSources: readonly EditProductionExternalSelectionSourceV1[]
}

async function replayCellRuntimeAuthoritiesV1(input: {
  store: EditArtifactStorePort
  layout: ReturnType<typeof editSessionLayoutV1>
  evaluated: EditKernelRevisionRecordV1
  revisions: readonly EditKernelRevisionRecordV1[]
  contract: BoundChangeContractV1
  plan: ActivatedEvaluationPlanSetV1['plans'][number]
  matrix: Extract<EditEvaluationMatrixReservationV1, { status: 'reserved' }>
  evaluationId: string
  semanticSourceIdentity: EditSemanticSourceIdentityHashProjectionV1
  semanticSourceSha256: string
  historySha256: string
}): Promise<ReplayedProductionAuthorityContextV1>
{
  const sourceBytes = await input.store.readImmutable(input.layout.sourceInput)
  const candidateBytes = await input.store.readImmutable(
    input.evaluated.candidateKey
  )
  const sourceProject = await ProjectIR.fromSb3(sourceBytes)
  const candidateProject = await ProjectIR.fromSb3(candidateBytes)
  const sourceRevision = input.revisions[0]!
  const sourceLineage = sourceRevision.activeLineage as SemanticLineageSnapshot
  const candidateLineage = input.evaluated
    .activeLineage as SemanticLineageSnapshot
  const sourceAssignment = buildEditRuntimeLineageAssignmentV1(
    sourceProject,
    sourceLineage
  )
  const candidateAssignment = buildEditRuntimeLineageAssignmentV1(
    candidateProject,
    candidateLineage
  )
  const [sourceArtifact, candidateArtifact] = await Promise.all([
    bindEditRuntimeArtifactV1(sourceBytes, sourceAssignment),
    bindEditRuntimeArtifactV1(candidateBytes, candidateAssignment),
  ])
  const sourceBindings = buildEditRuntimeBindingTableV1({
    source: sourceProject,
    sourceLineage,
    artifactLineage: sourceLineage,
    lineageHistory: sourceLineage,
    contract: input.contract.registration.semanticContract,
    ledger: retainedFutureBindingLedgerV1(sourceRevision.authorization),
    side: 'baseline',
  })
  const candidateBindings = buildEditRuntimeBindingTableV1({
    source: sourceProject,
    sourceLineage,
    artifactLineage: candidateLineage,
    lineageHistory: input.evaluated.lineageHistory as SemanticLineageSnapshot,
    contract: input.contract.registration.semanticContract,
    ledger: retainedFutureBindingLedgerV1(input.evaluated.authorization),
    side: 'candidate',
  })
  const scenarios = input.plan.scenarioPolicySha256s.map((semanticSha256) =>
  {
    const policy =
      input.contract.retainedPoliciesBySemanticSha256[semanticSha256]
        ?.scenarioPolicy
    if (policy === undefined)
      throw new Error('retained scenario policy is unavailable')
    return { semanticSha256, policy }
  })
  const authorities = new Map<string, ReplayedCellRuntimeAuthorityV1>()
  for (const cell of input.matrix.cells)
  {
    const scenario = scenarios.find(
      (candidate) => candidate.policy.scenarioId === cell.scenarioId
    )
    if (scenario === undefined)
      throw new Error(`reserved scenario ${cell.scenarioId} is unavailable`)
    const artifact =
      cell.side === 'baseline' ? sourceArtifact : candidateArtifact
    const lowering = lowerEditScenarioPolicyV1({
      policy: scenario.policy,
      semanticPolicySha256: scenario.semanticSha256,
      side: cell.side,
      bindings: cell.side === 'baseline' ? sourceBindings : candidateBindings,
      artifact,
    })
    if (lowering.status !== 'lowered') continue
    const lowered = lowering.lowered
    authorities.set(
      `${cell.lane}\u0000${cell.scenarioId}\u0000${cell.side}`,
      Object.freeze({
        cell,
        artifactSha256: lowered.artifactSha256,
        manifestSha256: lowered.manifestSha256,
        loweredScenarioSha256: lowered.loweredScenarioSha256,
        semanticPolicySha256: lowered.semanticPolicySha256,
        runtimePolicySha256: input.plan.runtimePolicySha256,
        scenarioSteps: Object.freeze(
          lowered.scenario.steps.map((step) => ({ do: step.do }))
        ),
      })
    )
  }
  return Object.freeze({
    cells: authorities,
    request: {
      evaluationId: input.evaluationId,
      plan: {
        plan: input.plan.plan,
        evaluationPlanSha256: input.plan.evaluationPlanSha256,
        masks: input.plan.masks,
        resourceLimitOverrides: input.plan.resourceLimitOverrides,
      },
      revision: exactRevisionFromHeadV1(input.evaluated.head),
      semanticSourceIdentity: input.semanticSourceIdentity,
      semanticSourceSha256: input.semanticSourceSha256,
      changeContractSha256: input.evaluated.head.changeContractSha256,
      historySha256: input.historySha256,
      matrixSha256: input.matrix.matrixSha256,
      candidateBytes,
      baselineBytes: sourceBytes,
      baselineRuntime: {
        assignment: sourceAssignment,
        bindings: sourceBindings,
        diagnosticLineage: buildEditDiagnosticLineageTablesV1(
          sourceProject,
          sourceLineage
        ),
      },
      candidateRuntime: {
        assignment: candidateAssignment,
        bindings: candidateBindings,
        diagnosticLineage: buildEditDiagnosticLineageTablesV1(
          candidateProject,
          candidateLineage
        ),
      },
      policies: Object.freeze(
        Object.values(input.contract.retainedPoliciesBySemanticSha256).map(
          (artifact) => structuredClone(artifact)
        )
      ),
      projectionAuthority: input.evaluated.runtimeProjectionAuthorizations,
    },
  })
}

function replayCompleteSemanticDriveV1(
  projection: Readonly<Record<string, unknown>>,
  authority: ReplayedCellRuntimeAuthorityV1
): boolean
{
  const drive = recordV1(projection['drive'])
  const reservation = recordV1(drive?.['reservation'])
  const actions = projection['actions']
  const issues = projection['issues']
  if (
    projection['traceOk'] !== true ||
    drive?.['status'] !== 'complete' ||
    reservation?.['status'] !== 'reserved' ||
    !Array.isArray(actions) ||
    !Array.isArray(issues) ||
    !sameCanonical(drive['actions'], actions) ||
    actions.length !== authority.scenarioSteps.length
  )
    return false
  if (
    issues.some(
      (issue) =>
        recordV1(issue)?.['code'] ===
        EDIT_IDENTITY_BOUND_ACTION_INCONCLUSIVE_CODE_V1
    )
  )
    return false
  return actions.every((action, index) =>
  {
    const record = recordV1(action)
    return (
      record?.['stepIndex'] === index &&
      record['do'] === authority.scenarioSteps[index]!.do
    )
  })
}

function recordV1(value: unknown): Record<string, unknown> | null
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function evaluationStartAuthoritiesV1(
  attempts: VerifiedAttemptsV1,
  prepared: RetainedEvaluationPreparationV1
): readonly VerifiedAttemptAuthorityV1[]
{
  const authority = attempts.byRequestSha256.get(prepared.startRequestSha256)
  if (authority === undefined) return Object.freeze([])
  const request = recordV1(authority.request)
  if (
    authority.attempt.namespaceSha256 !==
      prepared.startAttemptNamespaceSha256 ||
    authority.attempt.toolName !== 'edit_evaluate' ||
    request?.['action'] !== 'start'
  )
    return Object.freeze([])
  return Object.freeze([authority])
}

interface ReplayedEvaluationPreparationAuthorityV1
{
  readonly preparation: RetainedEvaluationPreparationV1
  readonly startAuthority: VerifiedAttemptAuthorityV1
}

// refused starts that reached reservation but retained no prepared directory
// still have a durable quota terminal; every expected identity is rederived
// from request, revision, plan, matrix, sequence, & attempt namespace authority
async function verifyPrepreparedEvaluationQuotaOutcomesV1(input: {
  readonly store: EditArtifactStorePort
  readonly layout: ReturnType<typeof editSessionLayoutV1>
  readonly manifest: EditKernelSessionManifestV1
  readonly revisions: readonly EditKernelRevisionRecordV1[]
  readonly plans: ActivatedEvaluationPlanSetV1 | null
  readonly contract: BoundChangeContractV1
  readonly attempts: VerifiedAttemptsV1
  readonly evaluationKeys: ReadonlySet<string>
  readonly preparations: readonly ReplayedEvaluationPreparationAuthorityV1[]
  readonly failures: string[]
}): Promise<boolean>
{
  let recoveryRequired = false
  const authorities = [...input.attempts.byRequestSha256.values()].sort(
    (left, right) => left.attempt.sequence - right.attempt.sequence
  )
  for (const authority of authorities)
  {
    const request = recordV1(authority.request)
    if (
      authority.attempt.toolName !== 'edit_evaluate' ||
      request?.['action'] !== 'start' ||
      authority.attempt.preHead === null ||
      input.plans === null
    )
      continue
    const head = authority.attempt.preHead
    if (
      request['expectedRevisionId'] !== head.revisionId ||
      request['expectedRevisionNumber'] !== head.revisionNumber ||
      request['expectedCandidateSha256'] !== head.candidateSha256 ||
      request['expectedSourceArtifactSha256'] !== head.sourceArtifactSha256 ||
      request['expectedAssetManifestSha256'] !== head.assetManifestSha256 ||
      request['expectedChangeContractSha256'] !== head.changeContractSha256 ||
      request['expectedCapabilityProfileSha256'] !==
        head.capabilityProfileSha256
    )
      continue
    const revision = input.revisions.find(
      (candidate) =>
        candidate.head.revisionId === head.revisionId &&
        candidate.head.revisionNumber === head.revisionNumber
    )
    const plan = input.plans.plans.find(
      (candidate) => candidate.planId === request['evaluationPlanId']
    )
    if (revision === undefined || plan === undefined) continue
    const scenarios = plan.scenarioPolicySha256s.flatMap((semanticSha256) =>
    {
      const scenario =
        input.contract.retainedPoliciesBySemanticSha256[semanticSha256]
          ?.scenarioPolicy
      return scenario === undefined
        ? []
        : [
            {
              scenarioId: scenario.scenarioId,
              applicability: scenario.applicability,
              semanticPolicySha256: semanticSha256,
            },
          ]
    })
    if (scenarios.length !== plan.scenarioPolicySha256s.length) continue
    const matrix = reserveEditEvaluationMatrixV1({
      laneRequirements: plan.plan.laneRequirements,
      scenarios,
      artifactSides: ['baseline', 'candidate'],
      limitOverrides: { ...plan.resourceLimitOverrides },
    })
    if (matrix.status !== 'reserved') continue
    const evaluationSequence = input.preparations.filter(
      (entry) =>
        entry.startAuthority.attempt.sequence < authority.attempt.sequence
    ).length
    const evaluatedRevision = exactRevisionFromHeadV1(head)
    const historySha256 = historyProjectionV1(
      input.manifest.semanticSourceSha256,
      input.revisions.slice(0, revision.head.revisionNumber + 1)
    ).sha256
    const evaluationAttemptSha256 = replayEvaluationAttemptSha256V1({
      evaluationPlanId: plan.planId,
      evaluationPlanSha256: plan.evaluationPlanSha256,
      evaluatedRevision,
      semanticSourceSha256: input.manifest.semanticSourceSha256,
      historySha256,
      matrixSha256: matrix.matrixSha256,
      sequence: evaluationSequence,
    })
    const reservationId = editCanonicalSha256V1({
      sessionId: input.manifest.sessionId,
      attemptSha256: evaluationAttemptSha256,
      startAttemptNamespaceSha256: authority.attempt.namespaceSha256,
      purpose: 'evaluation-retention',
    })
    const preparationKey = input.layout.evaluation(
      evaluationSequence,
      evaluationAttemptSha256,
      '000000-prepared.json'
    )
    const marker = recordV1(
      recordV1(authority.result)?.['releasedEvaluationQuota']
    )
    if (input.evaluationKeys.has(preparationKey))
    {
      if (marker !== null)
      {
        input.failures.push(
          `evaluation start attempt ${authority.attempt.sequence} claims a released quota beside a prepared record`
        )
        recoveryRequired = true
      }
      continue
    }
    let quota: Awaited<ReturnType<EditArtifactStorePort['quotaOutcome']>>
    try
    {
      quota = await input.store.quotaOutcome(reservationId)
    }
    catch (error)
    {
      input.failures.push(
        `evaluation start attempt ${authority.attempt.sequence} quota outcome is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      recoveryRequired = true
      continue
    }
    if (quota.state === 'absent')
    {
      if (marker !== null)
      {
        input.failures.push(
          `evaluation start attempt ${authority.attempt.sequence} claims a release for an absent reservation`
        )
        recoveryRequired = true
      }
      continue
    }
    const markerMatches =
      marker?.['schemaVersion'] === 1 &&
      marker['evaluationSequence'] === evaluationSequence &&
      marker['evaluationAttemptSha256'] === evaluationAttemptSha256 &&
      marker['reservationId'] === reservationId &&
      marker['reservedBytes'] === matrix.reservedArtifactBytesTotal
    if (
      quota.state !== 'released' ||
      quota.reservedBytes !== matrix.reservedArtifactBytesTotal ||
      quota.actualBytes !== 0 ||
      authority.indexedState !== 'refused' ||
      !markerMatches
    )
    {
      input.failures.push(
        `evaluation start attempt ${authority.attempt.sequence} has a nonterminal or unauthoritative quota without a prepared record`
      )
      recoveryRequired = true
    }
  }
  return recoveryRequired
}

function replayExternalLaneStatusesV1(
  deterministic: RetainedDeterministicResultV1,
  availability: 'available' | 'inconclusive'
): readonly EditLaneStatusV1[]
{
  const externallyJudgedLanes = new Set<string>(
    deterministic.externalRequests.map((request) => request.lane)
  )
  return Object.freeze(
    deterministic.laneStatuses.map((status) =>
    {
      if (
        status.disposition === 'forbidden' ||
        !externallyJudgedLanes.has(status.lane)
      )
        return status
      if (availability === 'inconclusive')
        return status.availability === 'unavailable'
          ? status
          : Object.freeze({
              ...status,
              availability,
              reason: 'external evidence expired before complete staging',
            })
      if (
        status.lane === 'officialBrowser' ||
        status.lane === 'turboWarpBrowser'
      )
        return status
      if (status.lane === 'renderedDifferential')
      {
        const independent = deterministic.preservationObservations.filter(
          (observation) => observation.lane === 'renderedDifferential'
        )
        if (
          independent.some(
            (observation) =>
              observation.outcome === 'unavailable' ||
              observation.outcome === 'inconclusive'
          )
        )
          return status
      }
      return Object.freeze({
        ...status,
        availability,
        reason: 'all issued external evidence requests are staged',
      })
    })
  )
}

function replayExternalCertifiedInputsV1(input: {
  evaluationId: string
  deterministic: RetainedDeterministicResultV1
  records: readonly EditStagedExternalEvidenceRecordV1[]
}): {
  candidateObservations: readonly EditCandidateObservationV1[]
  additionalEvidence: readonly EditEvaluationEvidenceEntryV1[]
  externalObjectives: readonly EditStructuralObjectiveObservationV1[]
  laneStatuses: readonly EditLaneStatusV1[]
  extraLimitations: readonly string[]
}
{
  const requests = input.deterministic.externalRequests
  if (requests.length === 0)
  {
    if (input.records.length !== 0)
      throw new Error('external records exist without issued requests')
    return Object.freeze({
      candidateObservations: input.deterministic.candidateObservations,
      additionalEvidence: Object.freeze([]),
      externalObjectives: Object.freeze([]),
      laneStatuses: input.deterministic.laneStatuses,
      extraLimitations: Object.freeze([]),
    })
  }
  if (input.records.length === 0)
  {
    return Object.freeze({
      candidateObservations: Object.freeze([
        ...input.deterministic.candidateObservations,
        ...requests.map((request) => ({
          objectiveId: request.objectiveId,
          ...(request.predicateSha256 === undefined
            ? {}
            : { predicateSha256: request.predicateSha256 }),
          status: 'inconclusive' as const,
          reason: 'edit.external_evidence_expired',
        })),
      ]),
      additionalEvidence: Object.freeze([]),
      externalObjectives: Object.freeze(
        requests.map((request) => ({
          objectiveId: request.objectiveId,
          predicateSha256: editExternalEvidenceRequiredGateSha256V1(request),
          status: 'pending' as const,
        }))
      ),
      laneStatuses: replayExternalLaneStatusesV1(
        input.deterministic,
        'inconclusive'
      ),
      extraLimitations: Object.freeze([
        'external evidence deadline expired before staging',
      ]),
    })
  }
  if (input.records.length !== requests.length)
    throw new Error('external record count does not match issued requests')
  const recordIds = new Set<string>()
  const observations: EditCandidateObservationV1[] = []
  const evidence: EditEvaluationEvidenceEntryV1[] = []
  const objectives: EditStructuralObjectiveObservationV1[] = []
  for (let index = 0; index < requests.length; index++)
  {
    const request = requests[index]!
    const record = input.records[index]!
    const provenance = record.provenance
    if (
      record.evaluationId !== input.evaluationId ||
      record.requestArtifactId !== request.requestArtifactId ||
      record.objectiveId !== request.objectiveId ||
      record.lane !== request.lane ||
      record.requestSha256 !== request.requestSha256 ||
      recordIds.has(record.recordId) ||
      !/^[0-9a-f]{64}$/u.test(record.contentSha256) ||
      !/^[0-9a-f]{64}$/u.test(record.resultSha256) ||
      !/^[0-9a-f]{64}$/u.test(record.judgmentSha256) ||
      provenance === null ||
      typeof provenance !== 'object' ||
      provenance.schemaVersion !== 1 ||
      provenance.evaluationId !== record.evaluationId ||
      provenance.hostRecordId !== record.recordId ||
      provenance.contentSha256 !== record.contentSha256 ||
      provenance.requestSha256 !== record.requestSha256 ||
      provenance.resultSha256 !== record.resultSha256 ||
      provenance.absoluteLocator.length === 0 ||
      !Number.isSafeInteger(provenance.capturedAtEpochMs) ||
      provenance.capturedAtEpochMs < 0 ||
      !/^[0-9a-f]{64}$/u.test(provenance.auditRecordSha256) ||
      editStagedExternalEvidenceResultSha256V1({
        evaluationId: record.evaluationId,
        requestArtifactId: record.requestArtifactId,
        objectiveId: record.objectiveId,
        lane: record.lane,
        requestSha256: record.requestSha256,
        contentSha256: record.contentSha256,
        satisfied: record.satisfied,
        judgmentSha256: record.judgmentSha256,
      }) !== record.resultSha256
    )
      throw new Error(
        `external record ${index} does not match its issued request`
      )
    recordIds.add(record.recordId)
    observations.push({
      objectiveId: request.objectiveId,
      ...(request.predicateSha256 === undefined
        ? {}
        : { predicateSha256: request.predicateSha256 }),
      status: 'observed',
      observed: {
        kind: 'visualJudgment',
        satisfied: record.satisfied,
        judgmentSha256: record.judgmentSha256,
      },
    })
    evidence.push({
      binding: {
        evidenceKind: 'nativeAgent',
        lane: record.lane,
        requestSha256: record.requestSha256,
        resultSha256: record.resultSha256,
        contentSha256: record.contentSha256,
      },
      contentSha256: record.contentSha256,
    })
    objectives.push({
      objectiveId: request.objectiveId,
      predicateSha256: editExternalEvidenceRequiredGateSha256V1(request),
      status: record.satisfied ? 'satisfied' : 'violated',
    })
  }
  return Object.freeze({
    candidateObservations: Object.freeze([
      ...input.deterministic.candidateObservations,
      ...observations,
    ]),
    additionalEvidence: Object.freeze(evidence),
    externalObjectives: Object.freeze(objectives),
    laneStatuses: replayExternalLaneStatusesV1(
      input.deterministic,
      'available'
    ),
    extraLimitations: Object.freeze([]),
  })
}

async function verifyRetainedEvaluationEvidenceV1(input: {
  store: EditArtifactStorePort
  layout: ReturnType<typeof editSessionLayoutV1>
  manifest: EditKernelSessionManifestV1
  prepared: {
    evaluationPlanSha256: string
    evaluatedRevision: ExactRevisionIdentityV1
    historySha256: string
    matrixSha256: string
  }
  matrix: Extract<EditEvaluationMatrixReservationV1, { status: 'reserved' }>
  cellRuntimeAuthorities: ReadonlyMap<string, ReplayedCellRuntimeAuthorityV1>
  deterministic: RetainedDeterministicResultV1
  sequence: number
  failures: string[]
}): Promise<ReplayedEvaluationEvidenceAuthorityV1>
{
  interface CellEvidenceV1
  {
    requestSha256: string
    resultSha256: string
    traceContentSha256: string | null
    mediaContentSha256s: string[]
    completeSemanticDrive: boolean | null
  }

  const cellKey = (cell: EditEvaluationMatrixCellV1): string =>
    `${cell.lane}\u0000${cell.scenarioId}\u0000${cell.side}`
  const reservedCells = new Map(
    input.matrix.cells.map((cell) => [cellKey(cell), cell] as const)
  )
  const cellEvidence = new Map<string, CellEvidenceV1>()
  const seenPayloads = new Set<string>()
  const preflightSides = new Map<string, number>()
  const preflightProjections = new Map<'baseline' | 'candidate', unknown>()
  const traceProjections: unknown[] = []
  const traceProjectionByCell = new Map<
    string,
    Readonly<Record<string, unknown>>
  >()
  const replayMediaByCell = new Map<string, EditProductionReplayMediaV1[]>()
  let retainedMatrixProjection: Record<string, unknown> | null = null
  const evidenceByContent = new Map<
    string,
    RetainedDeterministicResultV1['evidence'][number][]
  >()
  for (const evidence of input.deterministic.evidence)
  {
    const bucket = evidenceByContent.get(evidence.contentSha256) ?? []
    bucket.push(evidence)
    evidenceByContent.set(evidence.contentSha256, bucket)
  }
  const indexedContent = new Map<string, number>()
  const rawPayloads = new Map<
    string,
    {
      byteLength: number
      mediaType: string
      bytes: Uint8Array
    }
  >()
  const mediaReferences = new Map<string, number>()
  for (const artifact of input.deterministic.evidenceArtifactIndex)
  {
    if (
      !/^[0-9a-f]{64}$/u.test(artifact.payloadSha256) ||
      !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength < 0
    )
    {
      input.failures.push(
        `evaluation ${input.sequence} evidence artifact index is malformed`
      )
      continue
    }
    if (seenPayloads.has(artifact.payloadSha256))
      input.failures.push(
        `evaluation ${input.sequence} evidence artifact index repeats payload ${artifact.payloadSha256}`
      )
    seenPayloads.add(artifact.payloadSha256)
    const key = input.layout.evaluationEvidence(artifact.payloadSha256)
    let bytes: Uint8Array
    try
    {
      bytes = await input.store.readImmutable(key)
    }
    catch
    {
      input.failures.push(
        `evaluation ${input.sequence} cannot reopen evidence payload ${artifact.payloadSha256}`
      )
      continue
    }
    if (
      bytes.byteLength !== artifact.byteLength ||
      sha256Hex(bytes) !== artifact.payloadSha256
    )
      input.failures.push(
        `evaluation ${input.sequence} evidence payload ${artifact.payloadSha256} does not match its index`
      )
    if (artifact.contentSha256 === null)
    {
      if (
        artifact.evidenceKind !== null ||
        artifact.lane !== null ||
        artifact.side !== undefined ||
        artifact.scenarioId !== undefined
      )
        input.failures.push(
          `evaluation ${input.sequence} raw media payload carries a false certificate binding`
        )
      rawPayloads.set(artifact.payloadSha256, {
        byteLength: artifact.byteLength,
        mediaType: artifact.mediaType,
        bytes,
      })
      continue
    }
    if (artifact.evidenceKind === null || artifact.lane === null)
    {
      input.failures.push(
        `evaluation ${input.sequence} certificate payload omits its wrapper fields`
      )
      continue
    }
    const wrapped = wrapEditEvaluationEvidenceV1({
      binding: {
        revision: input.prepared.evaluatedRevision,
        historySha256: input.prepared.historySha256,
        changeContractSha256: input.manifest.changeContractSha256,
        evaluationPlanSha256: input.prepared.evaluationPlanSha256,
      },
      evidenceKind: artifact.evidenceKind,
      mediaType: artifact.mediaType,
      payloadSha256: artifact.payloadSha256,
      byteLength: artifact.byteLength,
      lane: artifact.lane,
      ...(artifact.side === undefined ? {} : { side: artifact.side }),
      ...(artifact.scenarioId === undefined
        ? {}
        : { scenarioId: artifact.scenarioId }),
    })
    if (wrapped.contentSha256 !== artifact.contentSha256)
      input.failures.push(
        `evaluation ${input.sequence} evidence content wrapper does not reconstruct`
      )
    const matching = evidenceByContent.get(wrapped.contentSha256) ?? []
    if (matching.length !== 1)
      input.failures.push(
        `evaluation ${input.sequence} evidence content has ${matching.length} certificate bindings`
      )
    indexedContent.set(
      wrapped.contentSha256,
      (indexedContent.get(wrapped.contentSha256) ?? 0) + 1
    )
    if (artifact.mediaType !== 'application/json') continue
    let projection: Record<string, unknown>
    try
    {
      const decoded = decode<unknown>(bytes)
      if (
        decoded === null ||
        typeof decoded !== 'object' ||
        Array.isArray(decoded)
      )
        throw new Error('not an object')
      projection = decoded as Record<string, unknown>
    }
    catch
    {
      input.failures.push(
        `evaluation ${input.sequence} structured evidence is not canonical JSON data`
      )
      continue
    }
    const binding = matching[0]?.binding
    if (binding === undefined) continue
    const indexedCell =
      artifact.side === undefined || artifact.scenarioId === undefined
        ? null
        : (reservedCells.get(
            `${artifact.lane}\u0000${artifact.scenarioId}\u0000${artifact.side}`
          ) ?? null)
    let expectedResultSha256: string | null = null
    let expectedRequestSha256: string | null = null
    if (artifact.evidenceKind === 'runtimeTrace')
    {
      traceProjections.push(projection)
      if (indexedCell === null)
        input.failures.push(
          `evaluation ${input.sequence} runtime trace index does not name one reserved cell`
        )
      if (
        indexedCell !== null &&
        !sameCanonical(projection['matrix'], indexedCell)
      )
        input.failures.push(
          `evaluation ${input.sequence} runtime trace projection names a different reserved cell`
        )
      const requestProjection = projection['requestProjection']
      if (
        requestProjection === null ||
        typeof requestProjection !== 'object' ||
        Array.isArray(requestProjection) ||
        (requestProjection as Record<string, unknown>)['matrixSha256'] !==
          input.prepared.matrixSha256 ||
        indexedCell === null ||
        !sameCanonical(
          (requestProjection as Record<string, unknown>)['cell'],
          indexedCell
        )
      )
        input.failures.push(
          `evaluation ${input.sequence} runtime request projection does not join to its reserved cell`
        )
      expectedResultSha256 = editRuntimeHashV1(
        'edit-production-runtime-result',
        projection
      )
      expectedRequestSha256 = editRuntimeHashV1(
        'edit-production-runtime-request',
        projection['requestProjection']
      )
      if (indexedCell !== null)
      {
        const key = cellKey(indexedCell)
        traceProjectionByCell.set(key, projection)
        const authority = input.cellRuntimeAuthorities.get(key)
        const request = recordV1(requestProjection)
        const observationTrace = recordV1(projection['observationTrace'])
        if (authority === undefined)
          input.failures.push(
            `evaluation ${input.sequence} runtime trace has no replayed lowering authority`
          )
        else if (
          projection['artifactSha256'] !== authority.artifactSha256 ||
          projection['manifestSha256'] !== authority.manifestSha256 ||
          projection['loweredScenarioSha256'] !==
            authority.loweredScenarioSha256 ||
          projection['semanticPolicySha256'] !==
            authority.semanticPolicySha256 ||
          request?.['artifactSha256'] !== authority.artifactSha256 ||
          request['manifestSha256'] !== authority.manifestSha256 ||
          request['loweredScenarioSha256'] !==
            authority.loweredScenarioSha256 ||
          request['semanticPolicySha256'] !== authority.semanticPolicySha256 ||
          request['runtimePolicySha256'] !== authority.runtimePolicySha256 ||
          observationTrace?.['sourceSb3Sha256'] !== authority.artifactSha256 ||
          observationTrace['scenarioSha256'] !==
            authority.loweredScenarioSha256 ||
          observationTrace['planSha256'] !==
            editObservationPlanSha256V1(observationTrace['plan'] as never) ||
          !sameCanonical(request['observationPlan'], observationTrace['plan'])
        )
          input.failures.push(
            `evaluation ${input.sequence} runtime trace artifact, lowering, or policy authority differs`
          )
        const existing = cellEvidence.get(key)
        if (
          existing !== undefined &&
          (existing.requestSha256 !== binding.requestSha256 ||
            existing.resultSha256 !== binding.resultSha256)
        )
          input.failures.push(
            `evaluation ${input.sequence} runtime trace disagrees with its cell media hashes`
          )
        if (existing?.traceContentSha256 !== null && existing !== undefined)
          input.failures.push(
            `evaluation ${input.sequence} reserved cell has multiple runtime traces`
          )
        cellEvidence.set(key, {
          requestSha256: binding.requestSha256,
          resultSha256: binding.resultSha256,
          traceContentSha256: wrapped.contentSha256,
          mediaContentSha256s: existing?.mediaContentSha256s ?? [],
          completeSemanticDrive:
            authority === undefined
              ? false
              : replayCompleteSemanticDriveV1(projection, authority),
        })
      }
    }
    else if (artifact.evidenceKind === 'structuredState')
    {
      if ('cells' in projection && 'matrixSha256' in projection)
      {
        if (retainedMatrixProjection !== null)
          input.failures.push(
            `evaluation ${input.sequence} retains multiple matrix outcome payloads`
          )
        retainedMatrixProjection = projection
        expectedResultSha256 = editRuntimeHashV1(
          'edit-production-matrix-outcomes-result-v1',
          projection
        )
        expectedRequestSha256 = editRuntimeHashV1(
          'edit-production-matrix-outcomes-request-v1',
          { matrixSha256: input.prepared.matrixSha256 }
        )
        if (
          artifact.lane !== 'projectPreflight' ||
          artifact.side !== undefined ||
          artifact.scenarioId !== undefined ||
          projection['matrixSha256'] !== input.prepared.matrixSha256 ||
          projection['preflightArtifactCount'] !==
            input.matrix.preflightArtifactCount ||
          projection['reservedTraceBytesPerCell'] !==
            input.matrix.reservedTraceBytesPerCell ||
          projection['reservedTraceBytesTotal'] !==
            input.matrix.reservedTraceBytesTotal ||
          projection['reservedMediaBytesPerBrowserCell'] !==
            input.matrix.reservedMediaBytesPerBrowserCell ||
          projection['reservedMediaBytesTotal'] !==
            input.matrix.reservedMediaBytesTotal ||
          projection['reservedMetadataBytesTotal'] !==
            input.matrix.reservedMetadataBytesTotal ||
          projection['reservedArtifactBytesTotal'] !==
            input.matrix.reservedArtifactBytesTotal
        )
          input.failures.push(
            `evaluation ${input.sequence} matrix outcome payload names a different reservation or index binding`
          )
        const cells = projection['cells']
        if (
          !Array.isArray(cells) ||
          cells.length !== input.matrix.cells.length ||
          !cells.every(
            (row, index) =>
              row !== null &&
              typeof row === 'object' &&
              sameCanonical(
                (row as Record<string, unknown>)['cell'],
                input.matrix.cells[index]
              )
          )
        )
          input.failures.push(
            `evaluation ${input.sequence} matrix outcome payload does not cover every reserved cell in order`
          )
      }
      else
      {
        expectedResultSha256 = editRuntimeHashV1(
          'edit-production-preflight-result-v1',
          projection
        )
        const side = projection['side']
        if (side === 'baseline' || side === 'candidate')
        {
          preflightSides.set(side, (preflightSides.get(side) ?? 0) + 1)
          preflightProjections.set(side, projection)
        }
        if (
          artifact.lane !== 'projectPreflight' ||
          artifact.side !== side ||
          artifact.scenarioId !== undefined ||
          (side !== 'baseline' && side !== 'candidate')
        )
          input.failures.push(
            `evaluation ${input.sequence} preflight payload index does not match its side`
          )
        const artifactSha256 =
          side === 'baseline'
            ? input.prepared.evaluatedRevision.sourceArtifactSha256
            : side === 'candidate'
              ? input.prepared.evaluatedRevision.candidateSha256
              : null
        if (artifactSha256 !== null)
          expectedRequestSha256 = editRuntimeHashV1(
            'edit-production-preflight-request-v1',
            { side, artifactSha256 }
          )
      }
    }
    else if (
      artifact.evidenceKind === 'screenshot' ||
      artifact.evidenceKind === 'video'
    )
    {
      if (
        indexedCell === null ||
        !sameCanonical(projection['matrixCell'], indexedCell) ||
        projection['evidenceKind'] !== artifact.evidenceKind
      )
        input.failures.push(
          `evaluation ${input.sequence} media manifest does not join to its reserved cell`
        )
      if (indexedCell !== null)
      {
        const key = cellKey(indexedCell)
        const existing = cellEvidence.get(key)
        if (
          existing !== undefined &&
          (existing.requestSha256 !== binding.requestSha256 ||
            existing.resultSha256 !== binding.resultSha256)
        )
          input.failures.push(
            `evaluation ${input.sequence} media manifest disagrees with its cell trace hashes`
          )
        cellEvidence.set(key, {
          requestSha256: binding.requestSha256,
          resultSha256: binding.resultSha256,
          traceContentSha256: existing?.traceContentSha256 ?? null,
          mediaContentSha256s: [
            ...(existing?.mediaContentSha256s ?? []),
            wrapped.contentSha256,
          ],
          completeSemanticDrive: existing?.completeSemanticDrive ?? null,
        })
      }
      const entries = projection['entries']
      if (!Array.isArray(entries))
        input.failures.push(
          `evaluation ${input.sequence} media manifest has no bounded entries`
        )
      else
        for (const entry of entries)
        {
          if (
            entry !== null &&
            typeof entry === 'object' &&
            typeof (entry as Record<string, unknown>)['payloadSha256'] ===
              'string'
          )
          {
            const mediaEntry = entry as Record<string, unknown>
            const payloadSha256 = mediaEntry['payloadSha256'] as string
            const raw = rawPayloads.get(payloadSha256)
            if (
              raw === undefined ||
              mediaEntry['byteLength'] !== raw.byteLength ||
              mediaEntry['mediaType'] !== raw.mediaType ||
              (artifact.evidenceKind === 'screenshot' &&
                raw.mediaType !== 'image/png') ||
              (artifact.evidenceKind === 'video' &&
                raw.mediaType !== 'video/webm')
            )
              input.failures.push(
                `evaluation ${input.sequence} media manifest entry does not match its raw payload index`
              )
            else
            {
              const frameId = mediaEntry['frameId']
              const width = mediaEntry['width']
              const height = mediaEntry['height']
              if (
                (frameId !== null && typeof frameId !== 'string') ||
                (width !== null &&
                  (!Number.isSafeInteger(width) || Number(width) < 0)) ||
                (height !== null &&
                  (!Number.isSafeInteger(height) || Number(height) < 0))
              )
                input.failures.push(
                  `evaluation ${input.sequence} media manifest entry has malformed frame authority`
                )
              const key = cellKey(indexedCell!)
              const bucket = replayMediaByCell.get(key) ?? []
              bucket.push(
                Object.freeze({
                  evidenceKind: artifact.evidenceKind,
                  mediaType: raw.mediaType as 'image/png' | 'video/webm',
                  payloadSha256,
                  byteLength: raw.byteLength,
                  bytes: raw.bytes,
                  ...(typeof frameId === 'string' ? { frameId } : {}),
                  ...(typeof width === 'number' ? { width } : {}),
                  ...(typeof height === 'number' ? { height } : {}),
                })
              )
              replayMediaByCell.set(key, bucket)
            }
            mediaReferences.set(
              payloadSha256,
              (mediaReferences.get(payloadSha256) ?? 0) + 1
            )
          }
          else
            input.failures.push(
              `evaluation ${input.sequence} media manifest contains a malformed entry`
            )
        }
    }
    if (
      expectedResultSha256 !== null &&
      binding.resultSha256 !== expectedResultSha256
    )
      input.failures.push(
        `evaluation ${input.sequence} structured evidence result hash does not reconstruct`
      )
    if (
      expectedRequestSha256 !== null &&
      binding.requestSha256 !== expectedRequestSha256
    )
      input.failures.push(
        `evaluation ${input.sequence} structured evidence request hash does not reconstruct`
      )
  }
  if (retainedMatrixProjection === null)
    input.failures.push(
      `evaluation ${input.sequence} retains no matrix outcome payload`
    )
  else
  {
    const rows = retainedMatrixProjection['cells']
    if (Array.isArray(rows))
      for (let index = 0; index < input.matrix.cells.length; index++)
      {
        const cell = input.matrix.cells[index]!
        const row = rows[index]
        if (row === null || typeof row !== 'object' || Array.isArray(row))
          continue
        const projection = row as Record<string, unknown>
        const retained = cellEvidence.get(cellKey(cell))
        if (projection['status'] === 'executed')
        {
          if (retained?.traceContentSha256 === null || retained === undefined)
          {
            input.failures.push(
              `evaluation ${input.sequence} executed matrix cell has no exact retained trace`
            )
            continue
          }
          if (
            projection['requestSha256'] !== retained.requestSha256 ||
            projection['resultSha256'] !== retained.resultSha256 ||
            projection['completeSemanticDrive'] !==
              retained.completeSemanticDrive ||
            !sameCanonical(projection['evidenceContentSha256s'], [
              retained.traceContentSha256,
              ...retained.mediaContentSha256s,
            ])
          )
            input.failures.push(
              `evaluation ${input.sequence} executed matrix cell does not cross-link its retained trace and media`
            )
        }
        else if (projection['status'] === 'refused')
        {
          if (retained !== undefined)
            input.failures.push(
              `evaluation ${input.sequence} refused matrix cell retains execution evidence`
            )
        }
        else if (projection['status'] === 'pendingExternal')
        {
          const requestSha256s = input.deterministic.externalRequests
            .filter((request) =>
              request.matrixCells.some(
                (boundCell) => boundCell.ordinal === cell.ordinal
              )
            )
            .map((request) => request.requestSha256)
          if (
            retained !== undefined ||
            (cell.lane !== 'renderedDifferential' &&
              cell.lane !== 'nativeVisual') ||
            requestSha256s.length === 0 ||
            !sameCanonical(projection['requestSha256s'], requestSha256s)
          )
            input.failures.push(
              `evaluation ${input.sequence} pending external matrix cell does not bind its exact request authority`
            )
        }
        else
          input.failures.push(
            `evaluation ${input.sequence} matrix cell has an invalid terminal status`
          )
      }
  }
  if (
    input.matrix.preflightArtifactCount !== 2 ||
    preflightSides.get('baseline') !== 1 ||
    preflightSides.get('candidate') !== 1 ||
    preflightSides.size !== 2
  )
    input.failures.push(
      `evaluation ${input.sequence} does not retain exactly one preflight per artifact side`
    )
  for (const contentSha256 of evidenceByContent.keys())
    if (indexedContent.get(contentSha256) !== 1)
      input.failures.push(
        `evaluation ${input.sequence} deterministic evidence ${contentSha256} is not indexed exactly once`
      )
  for (const payloadSha256 of rawPayloads.keys())
    if ((mediaReferences.get(payloadSha256) ?? 0) < 1)
      input.failures.push(
        `evaluation ${input.sequence} raw media ${payloadSha256} is unreferenced`
      )
  for (const payloadSha256 of mediaReferences.keys())
    if (!rawPayloads.has(payloadSha256))
      input.failures.push(
        `evaluation ${input.sequence} media manifest references absent payload ${payloadSha256}`
      )
  const deterministicAuthority =
    retainedMatrixProjection === null
      ? null
      : (recordV1(
          retainedMatrixProjection['deterministicAuthority']
        ) as EditProductionDeterministicAuthorityV1 | null)
  if (deterministicAuthority === null)
    input.failures.push(
      `evaluation ${input.sequence} matrix outcome payload has no deterministic authority`
    )
  const externalSelectionSources: EditProductionExternalSelectionSourceV1[] = []
  for (const [key, media] of replayMediaByCell)
  {
    const cell = reservedCells.get(key)
    const contentSha256 = cellEvidence
      .get(key)
      ?.mediaContentSha256s.find(
        (candidate) =>
          evidenceByContent
            .get(candidate)
            ?.some((entry) => entry.binding.evidenceKind === 'screenshot') ===
          true
      )
    const traceProjection = traceProjectionByCell.get(key)
    const observationTrace = recordV1(traceProjection?.['observationTrace'])
    const mediaAuthority = recordV1(observationTrace?.['media'])
    const frameAuthorities = Array.isArray(mediaAuthority?.['frames'])
      ? mediaAuthority['frames']
      : []
    if (cell === undefined || contentSha256 === undefined) continue
    const frames = media.flatMap((entry) =>
    {
      if (entry.evidenceKind !== 'screenshot' || entry.frameId === undefined)
        return []
      const authority = frameAuthorities.find((candidate) =>
      {
        const record = recordV1(candidate)
        return (
          record?.['id'] === entry.frameId &&
          record?.['sha256'] === entry.payloadSha256
        )
      })
      const record = recordV1(authority)
      if (
        record === null ||
        !Number.isSafeInteger(record['tick']) ||
        (record['snapshotLabel'] !== null &&
          typeof record['snapshotLabel'] !== 'string')
      )
      {
        input.failures.push(
          `evaluation ${input.sequence} retained frame has no exact temporal authority`
        )
        return []
      }
      return [
        Object.freeze({
          payloadSha256: entry.payloadSha256,
          frameId: entry.frameId,
          tick: record['tick'] as number,
          snapshotLabel: record['snapshotLabel'] as string | null,
        }),
      ]
    })
    externalSelectionSources.push(
      Object.freeze({
        cell,
        evidenceContentSha256: contentSha256,
        frames: Object.freeze(frames),
      })
    )
  }
  return Object.freeze({
    deterministicAuthority,
    baselinePreflight: preflightProjections.get('baseline') ?? null,
    candidatePreflight: preflightProjections.get('candidate') ?? null,
    matrixProjection: retainedMatrixProjection,
    traceProjections: Object.freeze(traceProjections),
    mediaByCell: new Map(
      [...replayMediaByCell].map(([key, media]) => [key, Object.freeze(media)])
    ),
    externalSelectionSources: Object.freeze(externalSelectionSources),
  })
}

function replayIssuedExternalRequestsV1(input: {
  evaluationId: string
  plan: ActivatedEvaluationPlanSetV1['plans'][number]
  contract: BoundChangeContractV1
  matrix: Extract<EditEvaluationMatrixReservationV1, { status: 'reserved' }>
  sources: readonly EditProductionExternalSelectionSourceV1[]
}): readonly EditExternalEvidenceRequestArtifactV1[]
{
  return deriveEditProductionExternalRequestsV1({
    evaluationId: input.evaluationId,
    plan: input.plan.plan,
    policies: Object.values(
      input.contract.retainedPoliciesBySemanticSha256
    ).map((artifact) => structuredClone(artifact)),
    matrixCells: input.matrix.cells,
    sources: input.sources,
  })
}

async function verifyRetainedEvaluationLifecycleV1(input: {
  store: EditArtifactStorePort
  names: ReadonlyMap<string, EditArtifactEntryV1>
  manifest: EditKernelSessionManifestV1
  prepared: RetainedEvaluationPreparationV1
  revisions: readonly EditKernelRevisionRecordV1[]
  plans: ActivatedEvaluationPlanSetV1 | null
  contract: BoundChangeContractV1
  events: readonly EditKernelSemanticEventV1[]
  attempts: VerifiedAttemptsV1
  accountedEvaluationEvents: Set<string>
  chargedEvaluationPayloads: Set<string>
  referencedEvaluationPayloads: Set<string>
  sequence: number
  failures: string[]
}): Promise<number>
{
  const startAuthority = evaluationStartAuthoritiesV1(
    input.attempts,
    input.prepared
  )[0]
  const startResult = recordV1(startAuthority?.result)
  const directoryRetainedBytes = [...input.names.values()].reduce(
    (total, entry) => total + entry.byteLength,
    0
  )
  let expectedSettledBytes = directoryRetainedBytes
  if (directoryRetainedBytes > input.prepared.reservedBytes)
    input.failures.push(
      `evaluation ${input.sequence} directory bytes exceed the prepared reservation`
    )
  const evaluated = input.revisions.find(
    (candidate) =>
      candidate.head.revisionId ===
        input.prepared.evaluatedRevision.revisionId &&
      candidate.head.revisionNumber ===
        input.prepared.evaluatedRevision.revisionNumber
  )
  let matrix: Extract<
    EditEvaluationMatrixReservationV1,
    { status: 'reserved' }
  > | null = null
  let activatedPlan: ActivatedEvaluationPlanSetV1['plans'][number] | null = null
  if (evaluated === undefined)
    input.failures.push(
      `evaluation ${input.sequence} preparation names no head-reachable revision`
    )
  else
  {
    const historySha256 = historyProjectionV1(
      input.manifest.semanticSourceSha256,
      input.revisions.slice(0, evaluated.head.revisionNumber + 1)
    ).sha256
    if (
      !sameCanonical(
        input.prepared.evaluatedRevision,
        exactRevisionFromHeadV1(evaluated.head)
      ) ||
      input.prepared.semanticSourceSha256 !==
        input.manifest.semanticSourceSha256 ||
      input.prepared.historySha256 !== historySha256
    )
      input.failures.push(
        `evaluation ${input.sequence} preparation revision, source, or history does not reconstruct`
      )
    const attemptSha256 = replayEvaluationAttemptSha256V1({
      evaluationPlanId: input.prepared.evaluationPlanId,
      evaluationPlanSha256: input.prepared.evaluationPlanSha256,
      evaluatedRevision: input.prepared.evaluatedRevision,
      semanticSourceSha256: input.manifest.semanticSourceSha256,
      historySha256,
      matrixSha256: input.prepared.matrixSha256,
      sequence: input.sequence,
    })
    if (attemptSha256 !== input.prepared.attemptSha256)
      input.failures.push(
        `evaluation ${input.sequence} preparation attempt identity does not reconstruct`
      )
    if (input.plans === null)
      input.failures.push(
        `evaluation ${input.sequence} preparation has no activated plan authority`
      )
    else
    {
      const plan = input.plans.plan(input.prepared.evaluationPlanId)
      activatedPlan = plan
      if (plan.evaluationPlanSha256 !== input.prepared.evaluationPlanSha256)
        input.failures.push(
          `evaluation ${input.sequence} preparation plan identity differs`
        )
      const reservation = reserveEditEvaluationMatrixV1({
        laneRequirements: plan.plan.laneRequirements,
        scenarios: plan.scenarioPolicySha256s.map((semanticSha256) =>
        {
          const scenario =
            input.contract.retainedPoliciesBySemanticSha256[semanticSha256]
              ?.scenarioPolicy
          if (scenario === undefined)
            throw new Error('retained scenario policy is unavailable')
          return {
            scenarioId: scenario.scenarioId,
            applicability: scenario.applicability,
            semanticPolicySha256: semanticSha256,
          }
        }),
        artifactSides: ['baseline', 'candidate'],
        limitOverrides: { ...plan.resourceLimitOverrides },
      })
      if (
        reservation.status === 'refused' ||
        reservation.matrixSha256 !== input.prepared.matrixSha256
      )
        input.failures.push(
          `evaluation ${input.sequence} preparation matrix reservation does not reconstruct`
        )
      else matrix = reservation
    }
  }
  const deterministicEntry = input.names.get('deterministic-results.json')
  let deterministic: RetainedDeterministicResultV1 | null = null
  let replayedEvidenceAuthority: ReplayedEvaluationEvidenceAuthorityV1 | null =
    null
  if (deterministicEntry !== undefined)
  {
    const record = await readJson<{
      schemaVersion: 1
      deterministicResultSha256: string
      deterministic: RetainedDeterministicResultV1
    }>(input.store, deterministicEntry.key)
    deterministic = record.deterministic
    if (
      record.schemaVersion !== 1 ||
      record.deterministicResultSha256 !==
        replayDeterministicResultSha256V1(deterministic)
    )
      input.failures.push(
        `evaluation ${input.sequence} deterministic result identity does not reconstruct`
      )
    if (
      deterministic.evidence.length + deterministic.externalRequests.length >
      128
    )
      input.failures.push(
        `evaluation ${input.sequence} deterministic and external evidence exceed the V1 certificate bound`
      )
    if (evaluated !== undefined)
    {
      if (deterministic.projectJsonSha256 !== evaluated.projectJsonSha256)
        input.failures.push(
          `evaluation ${input.sequence} deterministic result names a different project payload`
        )
      const candidateByteLength = await input.store.sizeImmutable(
        evaluated.candidateKey
      )
      if (deterministic.evaluatedCandidateByteLength !== candidateByteLength)
        input.failures.push(
          `evaluation ${input.sequence} deterministic result names a different candidate length`
        )
    }
    if (matrix !== null)
    {
      const completionAuthorityEntry =
        input.names.get('completion-authority.json') ??
        input.names.get('awaiting-authority.json')
      const completionAuthority =
        completionAuthorityEntry === undefined
          ? null
          : await readJson<Record<string, unknown>>(
              input.store,
              completionAuthorityEntry.key
            )
      const recoveryEvaluationId = completionAuthority?.['evaluationId']
      if (
        completionAuthority !== null &&
        (completionAuthority['schemaVersion'] !== 1 ||
          (completionAuthority['kind'] !==
            'edit-evaluation-completion-authority-v1' &&
            completionAuthority['kind'] !==
              'edit-evaluation-awaiting-authority-v1') ||
          completionAuthority['attemptSha256'] !==
            input.prepared.attemptSha256 ||
          typeof recoveryEvaluationId !== 'string' ||
          recoveryEvaluationId.length === 0)
      )
        input.failures.push(
          `evaluation ${input.sequence} retained recovery authority does not identify its exact attempt`
        )
      const evaluationId = startResult?.['evaluationId'] ?? recoveryEvaluationId
      if (typeof evaluationId !== 'string' || evaluationId.length === 0)
        input.failures.push(
          `evaluation ${input.sequence} has no replayable evaluation identity`
        )
      const productionContext =
        evaluated === undefined || activatedPlan === null
          ? null
          : await replayCellRuntimeAuthoritiesV1({
              store: input.store,
              layout: editSessionLayoutV1(input.manifest.sessionKey),
              evaluated,
              revisions: input.revisions,
              contract: input.contract,
              plan: activatedPlan,
              matrix,
              evaluationId:
                typeof evaluationId === 'string'
                  ? evaluationId
                  : 'unavailable-evaluation-id',
              semanticSourceIdentity: input.manifest.semanticSourceIdentity,
              semanticSourceSha256: input.prepared.semanticSourceSha256,
              historySha256: input.prepared.historySha256,
            })
      const evidenceAuthority = await verifyRetainedEvaluationEvidenceV1({
        store: input.store,
        layout: editSessionLayoutV1(input.manifest.sessionKey),
        manifest: input.manifest,
        prepared: input.prepared,
        deterministic,
        matrix,
        cellRuntimeAuthorities:
          productionContext?.cells ??
          new Map<string, ReplayedCellRuntimeAuthorityV1>(),
        sequence: input.sequence,
        failures: input.failures,
      })
      replayedEvidenceAuthority = evidenceAuthority
      if (
        productionContext !== null &&
        evidenceAuthority.deterministicAuthority !== null &&
        evidenceAuthority.baselinePreflight !== null &&
        evidenceAuthority.candidatePreflight !== null &&
        evidenceAuthority.matrixProjection !== null
      )
        try
        {
          const rederived = await rederiveEditProductionDeterministicV1({
            request: productionContext.request,
            authority: evidenceAuthority.deterministicAuthority,
            baselinePreflight: evidenceAuthority.baselinePreflight,
            candidatePreflight: evidenceAuthority.candidatePreflight,
            matrixProjection: evidenceAuthority.matrixProjection,
            traceProjections: evidenceAuthority.traceProjections,
            mediaByCell: evidenceAuthority.mediaByCell,
            externalRequests: deterministic.externalRequests,
          })
          const mismatches = (
            [
              'identity',
              'laneStatuses',
              'candidateObservations',
              'preservationObservations',
              'baselineDiagnostics',
              'candidateDiagnostics',
              'allowedNewDiagnosticFingerprints',
              'boundedResourceIssueCodes',
              'fixedTimePolicySha256',
              'seedSetSha256',
              'limitations',
            ] as const
          ).filter(
            (field) => !sameCanonical(rederived[field], deterministic![field])
          )
          if (mismatches.length !== 0)
            input.failures.push(
              `evaluation ${input.sequence} deterministic summaries do not rederive from retained raw authority: ${mismatches.join(', ')}`
            )
        }
        catch (error)
        {
          input.failures.push(
            `evaluation ${input.sequence} raw deterministic authority does not replay: ${error instanceof Error ? error.message : String(error)}`
          )
        }
    }
    const evidenceContent = editEvidenceContentCollectionV1(
      deterministic.evidence.map((entry) => entry.contentSha256)
    )
    const deterministicIndex = input.names.get(
      'deterministic-evidence-index.json'
    )
    if (deterministicIndex === undefined)
      input.failures.push(
        `evaluation ${input.sequence} deterministic result has no deterministic evidence index`
      )
    else
      await verifyJsonArtifact(
        input.store,
        deterministicIndex.key,
        { schemaVersion: 1, evidenceContent },
        input.failures,
        `evaluation ${input.sequence} deterministic evidence index`
      )
    const retainedPayloadBytes = new Map<string, number>()
    for (const artifact of deterministic.evidenceArtifactIndex)
    {
      retainedPayloadBytes.set(artifact.payloadSha256, artifact.byteLength)
      input.referencedEvaluationPayloads.add(artifact.payloadSha256)
    }
    const newlyChargedPayloadBytes = [...retainedPayloadBytes].reduce(
      (total, [payloadSha256, byteLength]) =>
      {
        if (input.chargedEvaluationPayloads.has(payloadSha256)) return total
        input.chargedEvaluationPayloads.add(payloadSha256)
        return total + byteLength
      },
      0
    )
    const retainedBytes = directoryRetainedBytes + newlyChargedPayloadBytes
    expectedSettledBytes = retainedBytes
    if (retainedBytes > input.prepared.reservedBytes)
      input.failures.push(
        `evaluation ${input.sequence} replay-visible retained bytes exceed the prepared reservation`
      )
  }
  const awaitingEntry = input.names.get('000001-awaiting-external.json')
  const externalEntry = input.names.get('external-requests.json')
  const completedEntry = input.names.get('000002-completed.json')
  const completed =
    completedEntry === undefined
      ? null
      : await readJson<Record<string, unknown>>(input.store, completedEntry.key)
  if (awaitingEntry === undefined && externalEntry === undefined)
  {
    if (
      input.names.has('000002-completed.json') &&
      deterministic !== null &&
      deterministic.externalRequests.length !== 0
    )
      input.failures.push(
        `evaluation ${input.sequence} completed external requests without an awaiting chain`
      )
    if (completed !== null && deterministic !== null)
    {
      const status = completed['status']
      const expectedPhase = status === 'passed' ? 'completed' : status
      const retainedEntry = input.names.get('retained-certificate.json')
      const retainedRecord =
        retainedEntry === undefined
          ? null
          : await readJson<{ retained: EditRetainedCertificateV1 }>(
              input.store,
              retainedEntry.key
            )
      const evidenceContent = editEvidenceContentCollectionV1(
        deterministic.evidence.map((entry) => entry.contentSha256)
      )
      const expectedHostAction =
        status === 'unavailable'
          ? {
              kind: 'configureEvidenceProducer',
              limitationCode: 'edit.evaluation_unavailable',
            }
          : { kind: 'none' }
      if (
        (startAuthority?.indexedState !== 'completed' &&
          startAuthority?.indexedState !== 'pending') ||
        startResult?.['evaluationId'] !==
          retainedRecord?.retained.evaluationId ||
        startResult?.['phase'] !== expectedPhase ||
        startResult?.['evaluationAttemptSha256'] !==
          input.prepared.attemptSha256 ||
        startResult?.['eventSha256'] !== completed['eventSha256'] ||
        !sameCanonical(
          startResult?.['evaluatedRevision'],
          input.prepared.evaluatedRevision
        ) ||
        !sameCanonical(startResult?.['evidenceContent'], evidenceContent) ||
        !sameCanonical(startResult?.['certificate'], {
          state: 'present',
          certificateSha256: completed['certificateSha256'],
          status,
        }) ||
        !sameCanonical(startResult?.['requiredHostAction'], expectedHostAction)
      )
        input.failures.push(
          `evaluation ${input.sequence} direct completion has no exact start-result authority`
        )
    }
    return expectedSettledBytes
  }
  if (
    awaitingEntry === undefined ||
    externalEntry === undefined ||
    deterministic === null ||
    input.plans === null
  )
  {
    input.failures.push(
      `evaluation ${input.sequence} retains an incomplete external request chain`
    )
    return expectedSettledBytes
  }
  const awaiting = await readJson<RetainedEvaluationAwaitingV1>(
    input.store,
    awaitingEntry.key
  )
  const plan = input.plans.plan(input.prepared.evaluationPlanId)
  if (matrix === null || replayedEvidenceAuthority === null)
  {
    input.failures.push(
      `evaluation ${input.sequence} cannot reconstruct external requests without exact matrix evidence authority`
    )
    return expectedSettledBytes
  }
  const reconstructedRequests = replayIssuedExternalRequestsV1({
    evaluationId: awaiting.evaluationId,
    plan,
    contract: input.contract,
    matrix,
    sources: replayedEvidenceAuthority.externalSelectionSources,
  })
  if (!sameCanonical(reconstructedRequests, deterministic.externalRequests))
    input.failures.push(
      `evaluation ${input.sequence} issued external requests do not reconstruct from the activated plan`
    )
  const requestSetSha256 = editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'external-evidence-request-set',
    entries: reconstructedRequests.map(
      editExternalEvidenceRequestSemanticProjectionV1
    ),
  })
  await verifyJsonArtifact(
    input.store,
    externalEntry.key,
    {
      schemaVersion: 1,
      requestSetSha256,
      requests: reconstructedRequests,
    },
    input.failures,
    `evaluation ${input.sequence} external request set`
  )
  const deadlineSha256 = editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'external-evidence-deadline',
    evaluationId: awaiting.evaluationId,
    deadlineEpochMs: awaiting.deadlineEpochMs,
  })
  const notificationSha256 = editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'external-evidence-notification',
    evaluationId: awaiting.evaluationId,
    requestSetSha256,
    deadlineSha256,
  })
  if (
    awaiting.schemaVersion !== 1 ||
    !Number.isSafeInteger(awaiting.deadlineEpochMs) ||
    awaiting.deadlineEpochMs < 0 ||
    awaiting.requestSetSha256 !== requestSetSha256 ||
    awaiting.deadlineSha256 !== deadlineSha256 ||
    awaiting.notificationSha256 !== notificationSha256
  )
    input.failures.push(
      `evaluation ${input.sequence} awaiting deadline or notification does not reconstruct`
    )
  const awaitingEvents = input.events.filter(
    (event) => event.eventSha256 === awaiting.eventSha256
  )
  if (
    awaitingEvents.length !== 1 ||
    awaitingEvents[0]!.projection.eventKind !== 'evaluation-recorded' ||
    awaitingEvents[0]!.projection.semanticPayloadSha256 !==
      editCanonicalSha256V1({
        state: 'awaitingExternalEvidence',
        certificate: null,
        attemptSha256: input.prepared.attemptSha256,
        evaluatedRevision: input.prepared.evaluatedRevision,
        requestSetSha256,
      })
  )
    input.failures.push(
      `evaluation ${input.sequence} has no exact awaiting-external event`
    )
  if (awaitingEvents.length === 1)
  {
    if (input.accountedEvaluationEvents.has(awaiting.eventSha256))
      input.failures.push(
        `evaluation ${input.sequence} reuses its awaiting-external event`
      )
    else input.accountedEvaluationEvents.add(awaiting.eventSha256)
  }
  if (
    startResult?.['evaluationId'] !== awaiting.evaluationId ||
    startResult?.['phase'] !== 'awaitingExternalEvidence' ||
    startResult?.['evaluationAttemptSha256'] !== input.prepared.attemptSha256 ||
    startResult?.['eventSha256'] !== awaiting.eventSha256 ||
    !sameCanonical(
      startResult?.['evaluatedRevision'],
      input.prepared.evaluatedRevision
    ) ||
    !sameCanonical(startResult?.['certificate'], { state: 'absent' }) ||
    !sameCanonical(
      startResult?.['evidenceContent'],
      editEvidenceContentCollectionV1(
        deterministic.evidence.map((entry) => entry.contentSha256)
      )
    ) ||
    !sameCanonical(startResult?.['requiredHostAction'], {
      kind: 'stageExternalEvidence',
      evaluationId: awaiting.evaluationId,
      requestArtifactIds: reconstructedRequests.map(
        (request) => request.requestArtifactId
      ),
      requestSetSha256,
      deadlineSha256,
      notificationSha256,
    })
  )
    input.failures.push(
      `evaluation ${input.sequence} awaiting record has no exact start-result authority`
    )
  if (completed !== null)
  {
    const finalEvidenceIndexEntry = input.names.get('evidence-index.json')
    const finalEvidenceIndex =
      finalEvidenceIndexEntry === undefined
        ? null
        : await readJson<{ evidenceContent: unknown }>(
            input.store,
            finalEvidenceIndexEntry.key
          )
    const finalizeAuthorities = [
      ...input.attempts.byRequestSha256.values(),
    ].filter((authority) =>
    {
      const request = recordV1(authority.request)
      return (
        authority.attempt.toolName === 'edit_evaluate' &&
        (authority.indexedState === 'completed' ||
          authority.indexedState === 'pending') &&
        request?.['action'] === 'finalize' &&
        request['evaluationId'] === awaiting.evaluationId &&
        request['expectedEvaluationAttemptSha256'] ===
          input.prepared.attemptSha256 &&
        sameCanonical(
          request['evaluatedRevision'],
          input.prepared.evaluatedRevision
        )
      )
    })
    const finalizeResult = recordV1(finalizeAuthorities[0]?.result)
    const status = completed['status']
    const expectedPhase = status === 'passed' ? 'completed' : status
    const expectedHostAction =
      status === 'unavailable'
        ? {
            kind: 'configureEvidenceProducer',
            limitationCode: 'edit.evaluation_unavailable',
          }
        : { kind: 'none' }
    if (
      finalizeAuthorities.length !== 1 ||
      finalizeResult?.['evaluationId'] !== awaiting.evaluationId ||
      finalizeResult?.['phase'] !== expectedPhase ||
      finalizeResult?.['evaluationAttemptSha256'] !==
        input.prepared.attemptSha256 ||
      finalizeResult?.['eventSha256'] !== completed['eventSha256'] ||
      !sameCanonical(
        finalizeResult?.['evaluatedRevision'],
        input.prepared.evaluatedRevision
      ) ||
      !sameCanonical(finalizeResult?.['certificate'], {
        state: 'present',
        certificateSha256: completed['certificateSha256'],
        status,
      }) ||
      !sameCanonical(
        finalizeResult?.['evidenceContent'],
        finalEvidenceIndex?.evidenceContent
      ) ||
      !sameCanonical(finalizeResult?.['requiredHostAction'], expectedHostAction)
    )
      input.failures.push(
        `evaluation ${input.sequence} external completion has no exact finalize-result authority`
      )
  }
  const cancelledEntry = input.names.get('000002-cancelled.json')
  if (cancelledEntry !== undefined)
  {
    const cancelled = await readJson<Record<string, unknown>>(
      input.store,
      cancelledEntry.key
    )
    const reason = cancelled['reason']
    const eventSha256 = cancelled['eventSha256']
    const event = input.events.find(
      (candidate) => candidate.eventSha256 === eventSha256
    )
    if (
      cancelled['schemaVersion'] !== 1 ||
      cancelled['evaluationId'] !== awaiting.evaluationId ||
      !sameCanonical(
        cancelled['evaluatedRevision'],
        input.prepared.evaluatedRevision
      ) ||
      cancelled['requestSetSha256'] !== requestSetSha256 ||
      cancelled['deadlineEpochMs'] !== awaiting.deadlineEpochMs ||
      cancelled['deadlineSha256'] !== deadlineSha256 ||
      cancelled['notificationSha256'] !== notificationSha256 ||
      typeof reason !== 'string' ||
      event === undefined ||
      event.projection.eventKind !== 'evaluation-recorded' ||
      event.projection.semanticPayloadSha256 !==
        editCanonicalSha256V1({
          state: 'cancelled',
          certificate: null,
          attemptSha256: input.prepared.attemptSha256,
          evaluatedRevision: input.prepared.evaluatedRevision,
          reason,
        })
    )
      input.failures.push(
        `evaluation ${input.sequence} cancelled terminal does not reconstruct`
      )
    if (event !== undefined)
    {
      if (input.accountedEvaluationEvents.has(event.eventSha256))
        input.failures.push(
          `evaluation ${input.sequence} reuses its cancelled event`
        )
      else input.accountedEvaluationEvents.add(event.eventSha256)
    }
  }
  return expectedSettledBytes
}

// every certificate is rebuilt end to end from retained artifacts through the
// same builder the session used, so a replay proves the identity rather than
// re-reading it. Nothing here consults a live evaluation port
async function verifyEvaluations(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  manifest: EditKernelSessionManifestV1,
  revisions: readonly EditKernelRevisionRecordV1[],
  plans: ActivatedEvaluationPlanSetV1 | null,
  contract: BoundChangeContractV1,
  events: readonly EditKernelSemanticEventV1[],
  attempts: VerifiedAttemptsV1,
  failures: string[]
): Promise<VerifiedEvaluationsV1>
{
  const evaluationEntries = await store.listImmutable(
    `${layout.prefix}/evaluations`
  )
  const directories = groupByDirectoryV1(evaluationEntries)
  const evaluationKeys = new Set(evaluationEntries.map((entry) => entry.key))
  const retained: EditRetainedCertificateV1[] = []
  let completedCount = 0
  let reconstructedExternalObservations = 0
  let recoveryRequired = false
  const seenSequences = new Set<number>()
  const accountedEvaluationEvents = new Set<string>()
  const chargedEvaluationPayloads = new Set<string>()
  const referencedEvaluationPayloads = new Set<string>()
  const preparationAuthorities: ReplayedEvaluationPreparationAuthorityV1[] = []
  const allowedNames = new Set([
    '000000-prepared.json',
    'deterministic-results.json',
    'deterministic-evidence-index.json',
    'external-requests.json',
    '000001-awaiting-external.json',
    'awaiting-authority.json',
    'evidence-index.json',
    'certified-input.json',
    'external-evidence-provenance.json',
    'certificate.json',
    'cancellation-authority.json',
    'completion-authority.json',
    '000002-completed.json',
    '000002-cancelled.json',
    'recovery-abandoned.json',
    'retained-certificate.json',
  ])

  for (const authority of attempts.byRequestSha256.values())
  {
    const request = recordV1(authority.request)
    const result = recordV1(authority.result)
    if (
      authority.attempt.toolName !== 'edit_evaluate' ||
      (authority.indexedState !== 'completed' &&
        authority.indexedState !== 'pending') ||
      request?.['disposition'] !== 'unavailable'
    )
      continue
    const eventSha256 = result?.['eventSha256']
    const event = events.find(
      (candidate) => candidate.eventSha256 === eventSha256
    )
    if (
      result?.['state'] !== 'unavailable' ||
      typeof result['reportSha256'] !== 'string' ||
      event === undefined ||
      event.projection.eventKind !== 'evaluation-recorded' ||
      event.projection.semanticPayloadSha256 !==
        editCanonicalSha256V1({ state: 'unavailable', certificate: null })
    )
    {
      failures.push(
        'unavailable evaluation attempt has no exact lifecycle event'
      )
      recoveryRequired = true
      continue
    }
    if (accountedEvaluationEvents.has(event.eventSha256))
    {
      failures.push('unavailable evaluation attempt reuses a lifecycle event')
      recoveryRequired = true
    }
    else accountedEvaluationEvents.add(event.eventSha256)
  }

  for (const [directory, names] of [...directories].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  ))
  {
    const sequence = directorySequenceV1(directory)
    if (sequence === null)
    {
      failures.push(`evaluation directory ${directory} is not ordinal-named`)
      continue
    }
    if (seenSequences.has(sequence))
    {
      failures.push(`evaluation ordinal ${sequence} has multiple directories`)
      recoveryRequired = true
      continue
    }
    seenSequences.add(sequence)
    for (const name of names.keys())
      if (!allowedNames.has(name))
      {
        failures.push(
          `evaluation ${sequence} retains unexpected record ${name}`
        )
        recoveryRequired = true
      }
    const preparedEntry = names.get('000000-prepared.json')
    if (preparedEntry === undefined)
    {
      failures.push(`evaluation ${sequence} retains no 000000-prepared.json`)
      recoveryRequired = true
      continue
    }
    let retainedPreparation: RetainedEvaluationPreparationV1
    try
    {
      retainedPreparation = await readJson<RetainedEvaluationPreparationV1>(
        store,
        preparedEntry.key
      )
    }
    catch (error)
    {
      failures.push(
        `evaluation ${sequence} preparation does not rehydrate: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      recoveryRequired = true
      continue
    }
    const expectedReservationId = editCanonicalSha256V1({
      sessionId: manifest.sessionId,
      attemptSha256: retainedPreparation.attemptSha256,
      startAttemptNamespaceSha256:
        retainedPreparation.startAttemptNamespaceSha256,
      purpose: 'evaluation-retention',
    })
    if (
      retainedPreparation.schemaVersion !== 1 ||
      retainedPreparation.sequence !== sequence ||
      retainedPreparation.reservationId !== expectedReservationId ||
      !Number.isSafeInteger(retainedPreparation.reservedBytes) ||
      retainedPreparation.reservedBytes < 0 ||
      preparedEntry.key !==
        layout.evaluation(
          sequence,
          retainedPreparation.attemptSha256,
          '000000-prepared.json'
        )
    )
    {
      failures.push(
        `evaluation ${sequence} preparation locator or quota reservation authority differs`
      )
      recoveryRequired = true
    }
    const startAuthorities = evaluationStartAuthoritiesV1(
      attempts,
      retainedPreparation
    )
    const startAuthority = startAuthorities[0]
    const startRequest = recordV1(startAuthority?.request)
    if (
      startAuthorities.length !== 1 ||
      startRequest?.['evaluationPlanId'] !==
        retainedPreparation.evaluationPlanId ||
      startRequest?.['expectedRevisionId'] !==
        retainedPreparation.evaluatedRevision.revisionId ||
      startRequest?.['expectedRevisionNumber'] !==
        retainedPreparation.evaluatedRevision.revisionNumber ||
      startRequest?.['expectedCandidateSha256'] !==
        retainedPreparation.evaluatedRevision.candidateSha256 ||
      startRequest?.['expectedSourceArtifactSha256'] !==
        retainedPreparation.evaluatedRevision.sourceArtifactSha256 ||
      startRequest?.['expectedAssetManifestSha256'] !==
        retainedPreparation.evaluatedRevision.assetManifestSha256 ||
      startRequest?.['expectedChangeContractSha256'] !==
        retainedPreparation.evaluatedRevision.changeContractSha256 ||
      startRequest?.['expectedCapabilityProfileSha256'] !==
        retainedPreparation.evaluatedRevision.capabilityProfileSha256
    )
    {
      failures.push(
        `evaluation ${sequence} preparation has no exact semantic start-attempt authority`
      )
      recoveryRequired = true
    }
    if (startAuthority !== undefined)
      preparationAuthorities.push({
        preparation: retainedPreparation,
        startAuthority,
      })
    const completedPresent = names.has('000002-completed.json')
    const cancelledPresent = names.has('000002-cancelled.json')
    const awaitingPresent = names.has('000001-awaiting-external.json')
    const recoveryAbandonedPresent = names.has('recovery-abandoned.json')
    if (recoveryAbandonedPresent)
    {
      const abandoned = await readJson<{
        schemaVersion: 1
        kind: 'retained-evaluation-abandoned-v1'
        reservationId: string
        startAttemptNamespaceSha256: string
        retainedEntriesSha256: string
      }>(store, names.get('recovery-abandoned.json')!.key)
      const quota = await store.quotaOutcome(retainedPreparation.reservationId)
      const retainedProjection = [...names]
        .filter(([name]) => name !== 'recovery-abandoned.json')
        .map(([name, entry]) => ({
          name,
          sha256: entry.sha256,
          byteLength: entry.byteLength,
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
      const abandonedResult = recordV1(startAuthority?.result)
      if (
        abandoned.schemaVersion !== 1 ||
        abandoned.kind !== 'retained-evaluation-abandoned-v1' ||
        abandoned.reservationId !== retainedPreparation.reservationId ||
        abandoned.startAttemptNamespaceSha256 !==
          retainedPreparation.startAttemptNamespaceSha256 ||
        abandoned.retainedEntriesSha256 !==
          editCanonicalSha256V1(retainedProjection) ||
        completedPresent ||
        cancelledPresent ||
        awaitingPresent ||
        names.has('certificate.json') ||
        names.has('retained-certificate.json') ||
        quota.state !== 'released' ||
        startAuthority?.indexedState !== 'refused' ||
        abandonedResult?.['code'] !== 'edit.interrupted'
      )
      {
        failures.push(
          `evaluation ${sequence} recovery abandonment does not reconstruct`
        )
        recoveryRequired = true
      }
      continue
    }
    if (completedPresent && cancelledPresent)
    {
      failures.push(`evaluation ${sequence} retains conflicting terminals`)
      recoveryRequired = true
      continue
    }
    const prerequisites = [
      ['deterministic-evidence-index.json', 'deterministic-results.json'],
      ['external-requests.json', 'deterministic-evidence-index.json'],
      ['000001-awaiting-external.json', 'external-requests.json'],
      ['certified-input.json', 'evidence-index.json'],
      ['certificate.json', 'certified-input.json'],
      ['000002-completed.json', 'certificate.json'],
      ['retained-certificate.json', '000002-completed.json'],
      ['000002-cancelled.json', '000001-awaiting-external.json'],
    ] as const
    for (const [record, prerequisite] of prerequisites)
      if (names.has(record) && !names.has(prerequisite))
      {
        failures.push(
          `evaluation ${sequence} retains ${record} without ${prerequisite}`
        )
        recoveryRequired = true
      }
    if (
      cancelledPresent &&
      (names.has('evidence-index.json') ||
        names.has('certified-input.json') ||
        names.has('certificate.json') ||
        names.has('retained-certificate.json'))
    )
    {
      failures.push(
        `evaluation ${sequence} cancelled terminal retains a certificate path`
      )
      recoveryRequired = true
    }
    if (!completedPresent && !cancelledPresent && !awaitingPresent)
    {
      const result = recordV1(startAuthority?.result)
      if (startAuthority?.indexedState !== 'refused')
      {
        failures.push(
          `evaluation ${sequence} has an unmatched prepared quota reservation`
        )
        recoveryRequired = true
      }
      if (result?.['evaluationAttemptSha256'] !== undefined)
      {
        failures.push(
          `evaluation ${sequence} interrupted preparation has a contradictory successful result`
        )
        recoveryRequired = true
      }
    }
    const lifecycleFailureCount = failures.length
    let expectedSettledBytes: number | null = null
    try
    {
      expectedSettledBytes = await verifyRetainedEvaluationLifecycleV1({
        store,
        names,
        manifest,
        prepared: retainedPreparation,
        revisions,
        plans,
        contract,
        events,
        attempts,
        accountedEvaluationEvents,
        chargedEvaluationPayloads,
        referencedEvaluationPayloads,
        sequence,
        failures,
      })
    }
    catch (error)
    {
      failures.push(
        `evaluation ${sequence} lifecycle does not rehydrate: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    try
    {
      const quota = await store.quotaOutcome(retainedPreparation.reservationId)
      const terminal = completedPresent || cancelledPresent
      const quotaMatchesTerminal =
        terminal &&
        expectedSettledBytes !== null &&
        quota.state === 'settled' &&
        quota.reservedBytes === retainedPreparation.reservedBytes &&
        quota.actualBytes === expectedSettledBytes
      const quotaMatchesInterrupted =
        !terminal &&
        quota.state === 'active' &&
        quota.reservedBytes === retainedPreparation.reservedBytes
      if (!quotaMatchesTerminal && !quotaMatchesInterrupted)
      {
        failures.push(
          `evaluation ${sequence} quota outcome does not match its retained lifecycle`
        )
        recoveryRequired = true
      }
      if (quotaMatchesInterrupted) recoveryRequired = true
    }
    catch (error)
    {
      failures.push(
        `evaluation ${sequence} quota outcome is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      recoveryRequired = true
    }
    if (failures.length !== lifecycleFailureCount) recoveryRequired = true
    if (!completedPresent) continue
    completedCount += 1
    const required = [
      '000000-prepared.json',
      'deterministic-results.json',
      'evidence-index.json',
      'certified-input.json',
      'certificate.json',
      'retained-certificate.json',
    ]
    const missing = required.filter((name) => !names.has(name))
    if (missing.length > 0)
    {
      failures.push(
        `evaluation ${sequence} retains no ${missing.join(', ')}; the certificate cannot be rebuilt`
      )
      continue
    }
    try
    {
      const record = await readJson<{ retained: EditRetainedCertificateV1 }>(
        store,
        names.get('retained-certificate.json')!.key
      )
      const entry = record.retained
      retained.push(entry)
      if (
        layout.evaluation(
          entry.sequence,
          entry.attemptSha256,
          'retained-certificate.json'
        ) !== names.get('retained-certificate.json')!.key
      )
      {
        failures.push(
          `evaluation ${sequence} retains its certificate under a noncanonical locator`
        )
        continue
      }
      if (entry.sequence !== sequence)
      {
        failures.push(
          `evaluation ${sequence} claims issue sequence ${entry.sequence}`
        )
        continue
      }
      const prepared = await readJson<{
        sequence: number
        evaluationPlanId: string
        evaluationPlanSha256: string
        evaluatedRevision: ExactRevisionIdentityV1
        semanticSourceSha256: string
        historySha256: string
        matrixSha256: string
        attemptSha256: string
      }>(store, names.get('000000-prepared.json')!.key)
      if (prepared.sequence !== sequence)
      {
        failures.push(
          `evaluation ${sequence} prepared record claims ordinal ${prepared.sequence}`
        )
        continue
      }
      const deterministicRecord = await readJson<{
        deterministicResultSha256: string
        deterministic: RetainedDeterministicResultV1
      }>(store, names.get('deterministic-results.json')!.key)
      const deterministic = deterministicRecord.deterministic
      const reconstructedDeterministicResultSha256 = editCanonicalSha256V1({
        schemaVersion: 1,
        label: 'deterministic-evaluation-result',
        identity: deterministic.identity,
        laneStatuses: deterministic.laneStatuses,
        candidateObservations: deterministic.candidateObservations,
        preservationObservations: deterministic.preservationObservations,
        baselineDiagnostics: deterministic.baselineDiagnostics,
        candidateDiagnostics: deterministic.candidateDiagnostics,
        allowedNewDiagnosticFingerprints:
          deterministic.allowedNewDiagnosticFingerprints,
        boundedResourceIssueCodes: deterministic.boundedResourceIssueCodes,
        evidence: deterministic.evidence,
        evidenceArtifactIndex: deterministic.evidenceArtifactIndex,
        projectJsonSha256: deterministic.projectJsonSha256,
        evaluatedCandidateByteLength:
          deterministic.evaluatedCandidateByteLength,
        fixedTimePolicySha256: deterministic.fixedTimePolicySha256,
        seedSetSha256: deterministic.seedSetSha256,
        externalRequests: deterministic.externalRequests.map(
          editExternalEvidenceRequestSemanticProjectionV1
        ),
        limitations: deterministic.limitations,
      })
      if (
        deterministicRecord.deterministicResultSha256 !==
        reconstructedDeterministicResultSha256
      )
        failures.push(
          `evaluation ${sequence} deterministic result identity does not reconstruct`
        )
      const certified = await readJson<{
        candidateObservations: readonly EditCandidateObservationV1[]
        additionalEvidence: readonly EditEvaluationEvidenceEntryV1[]
        externalObjectives: readonly EditStructuralObjectiveObservationV1[]
        laneStatuses: readonly EditLaneStatusV1[]
        externalRecords: readonly EditStagedExternalEvidenceRecordV1[]
        externalProvenanceChainSha256: string
        extraLimitations: readonly string[]
      }>(store, names.get('certified-input.json')!.key)
      reconstructedExternalObservations += deterministic.externalRequests.length
      const evaluated = revisions.find(
        (candidate) =>
          candidate.head.revisionId === prepared.evaluatedRevision.revisionId &&
          candidate.head.revisionNumber ===
            prepared.evaluatedRevision.revisionNumber
      )
      if (!evaluated)
      {
        failures.push(
          `evaluation ${sequence} names a revision outside the head-reachable chain`
        )
        continue
      }
      if (
        !sameCanonical(
          prepared.evaluatedRevision,
          exactRevisionFromHeadV1(evaluated.head)
        )
      )
        failures.push(
          `evaluation ${sequence} evaluated-revision identity does not reconstruct`
        )
      if (prepared.semanticSourceSha256 !== manifest.semanticSourceSha256)
        failures.push(
          `evaluation ${sequence} names a different semantic source`
        )
      const historySha256 = historyProjectionV1(
        manifest.semanticSourceSha256,
        revisions.slice(0, evaluated.head.revisionNumber + 1)
      ).sha256
      if (prepared.historySha256 !== historySha256)
        failures.push(
          `evaluation ${sequence} history projection does not reconstruct`
        )
      const attemptSha256 = replayEvaluationAttemptSha256V1({
        evaluationPlanId: prepared.evaluationPlanId,
        evaluationPlanSha256: prepared.evaluationPlanSha256,
        evaluatedRevision: prepared.evaluatedRevision,
        semanticSourceSha256: manifest.semanticSourceSha256,
        historySha256,
        matrixSha256: prepared.matrixSha256,
        sequence,
      })
      if (
        attemptSha256 !== prepared.attemptSha256 ||
        attemptSha256 !== entry.attemptSha256
      )
        failures.push(
          `evaluation ${sequence} attempt identity does not reconstruct`
        )
      if (deterministic.projectJsonSha256 !== evaluated.projectJsonSha256)
        failures.push(
          `evaluation ${sequence} evaluated a different project payload than the revision retains`
        )
      const candidateByteLength = await store.sizeImmutable(
        evaluated.candidateKey
      )
      if (deterministic.evaluatedCandidateByteLength !== candidateByteLength)
        failures.push(
          `evaluation ${sequence} evaluated a different candidate length than the revision retains`
        )
      const reconstructedCertified = replayExternalCertifiedInputsV1({
        evaluationId: entry.evaluationId,
        deterministic,
        records: certified.externalRecords,
      })
      const externalProvenance = certified.externalRecords.map(
        (record) => record.provenance
      )
      const externalProvenanceChainSha256 =
        evaluationProvenanceChainSha256V1(externalProvenance)
      if (
        certified.externalProvenanceChainSha256 !==
        externalProvenanceChainSha256
      )
        failures.push(
          `evaluation ${sequence} external provenance chain does not reconstruct`
        )
      if (externalProvenance.length > 0)
      {
        const provenanceEntry = names.get('external-evidence-provenance.json')
        if (provenanceEntry === undefined)
          failures.push(
            `evaluation ${sequence} retains no external evidence provenance cross-link`
          )
        else
          await verifyJsonArtifact(
            store,
            provenanceEntry.key,
            {
              schemaVersion: 1,
              chainSha256: externalProvenanceChainSha256,
              entries: externalProvenance,
            },
            failures,
            `evaluation ${sequence} external evidence provenance`
          )
      }
      if (
        !sameCanonical(
          certified.candidateObservations,
          reconstructedCertified.candidateObservations
        ) ||
        !sameCanonical(
          certified.additionalEvidence,
          reconstructedCertified.additionalEvidence
        ) ||
        !sameCanonical(
          certified.externalObjectives,
          reconstructedCertified.externalObjectives
        ) ||
        !sameCanonical(
          certified.laneStatuses,
          reconstructedCertified.laneStatuses
        ) ||
        !sameCanonical(
          certified.extraLimitations,
          reconstructedCertified.extraLimitations
        )
      )
        failures.push(
          `evaluation ${sequence} certified external inputs do not reconstruct in issued-request order`
        )
      const evidence = [
        ...deterministic.evidence,
        ...reconstructedCertified.additionalEvidence,
      ]
      const evidenceContent = editEvidenceContentCollectionV1(
        evidence.map((item) => item.contentSha256)
      )
      if (
        evidenceContent.collectionSha256 !==
        entry.evidenceContentCollectionSha256
      )
        failures.push(
          `evaluation ${sequence} evidence collection does not reconstruct`
        )
      await verifyJsonArtifact(
        store,
        names.get('evidence-index.json')!.key,
        { schemaVersion: 1, evidenceContent },
        failures,
        `evaluation ${sequence} evidence index`
      )
      if (plans === null)
      {
        failures.push(
          `evaluation ${sequence} cannot be rebuilt because plan activation refused`
        )
        continue
      }
      const plan = plans.plan(prepared.evaluationPlanId)
      if (plan.evaluationPlanSha256 !== prepared.evaluationPlanSha256)
      {
        failures.push(
          `evaluation ${sequence} ran a plan that the retained contract does not activate`
        )
        continue
      }
      const matrix = reserveEditEvaluationMatrixV1({
        laneRequirements: plan.plan.laneRequirements,
        scenarios: plan.scenarioPolicySha256s.map((semanticSha256) =>
        {
          const scenario =
            contract.retainedPoliciesBySemanticSha256[semanticSha256]
              ?.scenarioPolicy
          if (scenario === undefined)
            throw new Error('retained scenario policy is unavailable')
          return {
            scenarioId: scenario.scenarioId,
            applicability: scenario.applicability,
            semanticPolicySha256: semanticSha256,
          }
        }),
        artifactSides: ['baseline', 'candidate'],
        limitOverrides: { ...plan.resourceLimitOverrides },
      })
      if (
        matrix.status === 'refused' ||
        matrix.matrixSha256 !== prepared.matrixSha256
      )
      {
        failures.push(
          `evaluation ${sequence} prepared matrix reservation does not reconstruct`
        )
        continue
      }
      const rebuilt = buildEditEvaluationCertificateV1({
        plan,
        revision: prepared.evaluatedRevision,
        semanticSourceSha256: manifest.semanticSourceSha256,
        historySha256,
        projectJsonSha256: deterministic.projectJsonSha256,
        evaluatedCandidateByteLength:
          deterministic.evaluatedCandidateByteLength,
        identity: deterministic.identity,
        fixedTimePolicySha256: deterministic.fixedTimePolicySha256,
        seedSetSha256: deterministic.seedSetSha256,
        laneStatuses: reconstructedCertified.laneStatuses,
        required: aggregateRequiredChangeV1({
          predicates: plan.requiredRuntimeChanges,
          observations: reconstructedCertified.candidateObservations,
          structuralObjectives: [
            ...structuralObjectiveObservationsV1(
              contract.registration.semanticContract,
              evaluated.authorization
            ),
            ...reconstructedCertified.externalObjectives,
          ],
          planClass: plan.planClass,
        }),
        allowed: aggregateAllowedChangeV1({
          baselineDiagnostics: deterministic.baselineDiagnostics,
          candidateDiagnostics: deterministic.candidateDiagnostics,
          allowedNewDiagnosticFingerprints:
            deterministic.allowedNewDiagnosticFingerprints,
          boundedResourceIssueCodes: deterministic.boundedResourceIssueCodes,
          laneStatuses: reconstructedCertified.laneStatuses,
        }),
        preservation: aggregatePreservationV1({
          lenses: plan.preservationLenses,
          observations: deterministic.preservationObservations,
        }),
        evidence,
        extraLimitations: [
          ...deterministic.limitations,
          ...reconstructedCertified.extraLimitations,
        ],
      })
      if (!sameCanonical(rebuilt.certificate, entry.certificate))
        failures.push(
          `evaluation ${sequence} certificate does not reconstruct from retained evidence`
        )
      await verifyJsonArtifact(
        store,
        names.get('certificate.json')!.key,
        { schemaVersion: 1, certificate: rebuilt.certificate },
        failures,
        `evaluation ${sequence} certificate record`
      )
      const status = rebuilt.certificate.hashProjection.status
      const completed = await readJson<{
        status: string
        certificateSha256: string
        requiredChangeResultSha256: string
        allowedChangeResultSha256: string
        preservationResultSha256: string
        limitations: readonly string[]
        eventSha256: string
      }>(store, names.get('000002-completed.json')!.key)
      if (
        completed.status !== status ||
        completed.certificateSha256 !== rebuilt.certificate.certificateSha256 ||
        completed.requiredChangeResultSha256 !==
          rebuilt.aggregate.required.resultSha256 ||
        completed.allowedChangeResultSha256 !==
          rebuilt.aggregate.allowed.resultSha256 ||
        completed.preservationResultSha256 !==
          rebuilt.aggregate.preservation.resultSha256 ||
        !sameCanonical(completed.limitations, rebuilt.aggregate.limitations)
      )
        failures.push(
          `evaluation ${sequence} completed record disagrees with the rebuilt certificate`
        )
      const recorded = events.find(
        (event) => event.eventSha256 === completed.eventSha256
      )
      if (
        !recorded ||
        recorded.projection.eventKind !== 'evaluation-recorded' ||
        recorded.projection.semanticPayloadSha256 !==
          editCanonicalSha256V1({
            state: status,
            certificate: rebuilt.certificate.certificateSha256,
            attemptSha256,
            evaluatedRevision: prepared.evaluatedRevision,
          })
      )
        failures.push(
          `evaluation ${sequence} has no matching evaluation-recorded event`
        )
      else if (accountedEvaluationEvents.has(recorded.eventSha256))
        failures.push(`evaluation ${sequence} reuses a lifecycle event`)
      else accountedEvaluationEvents.add(recorded.eventSha256)
    }
    catch (error)
    {
      failures.push(
        `evaluation ${sequence} does not rehydrate: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  if (
    await verifyPrepreparedEvaluationQuotaOutcomesV1({
      store,
      layout,
      manifest,
      revisions,
      plans,
      contract,
      attempts,
      evaluationKeys,
      preparations: preparationAuthorities,
      failures,
    })
  )
    recoveryRequired = true
  retained.sort((left, right) => left.sequence - right.sequence)
  const issuedSequences = [...seenSequences].sort((left, right) => left - right)
  for (const [index, sequence] of issuedSequences.entries())
    if (sequence !== index)
    {
      failures.push(
        `evaluation run ordinals are not contiguous at expected ${index}`
      )
      recoveryRequired = true
    }
  const retainedEvidencePayloads = await store.listImmutable(
    `${layout.prefix}/evaluation-evidence`
  )
  for (const entry of retainedEvidencePayloads)
  {
    const name = entry.key.slice(entry.key.lastIndexOf('/') + 1)
    const match = /^([0-9a-f]{64})\.bin$/u.exec(name)
    if (match === null || !referencedEvaluationPayloads.has(match[1]!))
    {
      failures.push(`evaluation evidence payload ${entry.key} is orphaned`)
      recoveryRequired = true
    }
  }
  for (const event of events)
    if (
      event.projection.eventKind === 'evaluation-recorded' &&
      !accountedEvaluationEvents.has(event.eventSha256)
    )
    {
      failures.push(
        `evaluation lifecycle leaves event ${event.eventSha256} orphaned`
      )
      recoveryRequired = true
    }
  for (const [index, record] of retained.entries())
  {
    if (
      !seenSequences.has(record.sequence) ||
      (index > 0 && record.sequence <= retained[index - 1]!.sequence)
    )
      failures.push(
        `retained certificate ${record.evaluationId} breaks the issue sequence`
      )
  }
  return {
    certificates: Object.freeze(retained),
    completedCount,
    reconstructedExternalObservations,
    recoveryRequired,
  }
}

// the reopen evidence the session recorded for one stage, recomputed by putting
// the retained candidate bytes back through the full admission path
async function replayReopenEvidenceV1(
  stage: EditExportReopenEvidenceV1['stage'],
  bytes: Uint8Array
): Promise<EditExportReopenEvidenceV1 | null>
{
  const preflight = await inspectSemanticEditArtifact(bytes)
  if (
    !preflight.ok ||
    !preflight.admission ||
    !preflight.semanticSourceIdentity
  )
    return null
  return Object.freeze({
    schemaVersion: 1 as const,
    stage,
    admitted: true,
    projectJsonSha256: preflight.semanticSourceIdentity.projectJsonSha256,
    assetManifestSha256: preflight.semanticSourceIdentity.assetManifestSha256,
    byteLength: bytes.byteLength,
    artifactSha256: sha256Hex(bytes),
    diagnosticsStatus: 'passed' as const,
  })
}

interface VerifiedExportsV1
{
  attemptCount: number
  publishedCount: number
  publishedSha256: string | null
  receiptSha256: string | null
}

interface VerifiedAttemptAuthorityV1
{
  readonly attempt: EditKernelAttemptV1
  readonly request: unknown
  readonly transportRequest: unknown
  readonly indexedState: EditKernelAttemptV1['state']
  readonly invocationCorrelation: {
    readonly boundaryKind: 'directHost' | 'mcp'
    readonly invocationSha256: string
  }
  readonly result?: unknown
}

interface VerifiedAttemptsV1
{
  readonly count: number
  readonly pendingCount: number
  readonly byRequestSha256: ReadonlyMap<string, VerifiedAttemptAuthorityV1>
}

function reportCoveredAttemptCountV1(
  report: EditKernelReportV1,
  attempts: VerifiedAttemptsV1,
  finalHead: EditKernelRevisionRecordV1['head']
): number
{
  if (
    attempts.count <= report.attemptCount ||
    (report.state !== 'closed-unexported' &&
      report.state !== 'closed-abandoned' &&
      report.state !== 'closed-exported')
  )
    return attempts.count
  const trailing = [...attempts.byRequestSha256.values()]
    .filter((authority) => authority.attempt.sequence >= report.attemptCount)
    .sort((left, right) => left.attempt.sequence - right.attempt.sequence)
  const exactTerminalRefusals =
    trailing.length === attempts.count - report.attemptCount &&
    trailing.every(
      (authority, index) =>
        authority.attempt.sequence === report.attemptCount + index &&
        authority.indexedState === 'refused' &&
        sameCanonical(authority.attempt.preHead, finalHead) &&
        sameCanonical(authority.result, {
          ok: false,
          code: 'edit.session_closed',
          safeMessage: 'session is terminal',
          context: {},
        })
    )
  return exactTerminalRefusals ? report.attemptCount : attempts.count
}

async function verifyRecordedStatefulEventsV1(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  events: readonly EditKernelSemanticEventV1[],
  attempts: VerifiedAttemptsV1,
  failures: string[]
): Promise<void>
{
  const bySha256 = new Map(events.map((event) => [event.eventSha256, event]))
  const matched = new Set<string>()
  const recoveryEntries = await store.listImmutable(`${layout.prefix}/recovery`)
  const previewCacheEntries = new Map(
    (await store.listImmutable(`${layout.prefix}/preview-cache`)).map(
      (entry) => [entry.key, entry]
    )
  )
  const abandonmentEntries = recoveryEntries.filter((entry) =>
    /\/attempt-[0-9]{6}-abandoned\.json$/u.test(entry.key)
  )
  const abandonments = await Promise.all(
    abandonmentEntries.map((entry) =>
      readJson<{
        schemaVersion: 1
        kind: 'retained-stateful-attempt-abandoned-v1'
        attemptSequence: number
        namespaceSha256: string
        requestSha256: string
        toolName: string
        eventSha256: string
        invocationCorrelation: {
          boundaryKind: 'directHost' | 'mcp'
          invocationSha256: string
        }
      }>(store, entry.key)
    )
  )
  const terminalPlanEntry = recoveryEntries.find(
    (entry) => entry.key === layout.recoveryTerminalPlan
  )
  const plannedPreviewEvictions = new Map<string, string>()
  if (terminalPlanEntry !== undefined)
  {
    const terminalPlan = await readJson<{
      readonly schemaVersion: 1
      readonly kind: 'retained-edit-session-terminal-plan-v1'
      readonly sessionKey: string
      readonly evictions: readonly {
        readonly key: string
        readonly expectedSha256: string
      }[]
    }>(store, terminalPlanEntry.key)
    if (
      terminalPlan.schemaVersion !== 1 ||
      terminalPlan.kind !== 'retained-edit-session-terminal-plan-v1' ||
      terminalPlan.sessionKey !== layout.prefix.slice('sessions/'.length) ||
      !Array.isArray(terminalPlan.evictions)
    )
      failures.push('terminal preview eviction plan differs')
    else
      for (const eviction of terminalPlan.evictions)
      {
        if (
          eviction.key !== layout.preview(eviction.expectedSha256) ||
          plannedPreviewEvictions.has(eviction.key)
        )
          failures.push('terminal preview eviction identity differs')
        else plannedPreviewEvictions.set(eviction.key, eviction.expectedSha256)
      }
  }
  const verify = (
    authority: VerifiedAttemptAuthorityV1,
    expectedKind: 'asset-admitted' | 'preview-recorded' | 'checkpoint-recorded',
    eventSha256: unknown,
    payload: unknown
  ): void =>
  {
    if (typeof eventSha256 !== 'string')
    {
      failures.push(
        `${authority.attempt.toolName} attempt ${authority.attempt.sequence} has no retained event identity`
      )
      return
    }
    const event = bySha256.get(eventSha256)
    if (!event || event.projection.eventKind !== expectedKind)
    {
      failures.push(
        `${authority.attempt.toolName} attempt ${authority.attempt.sequence} names no ${expectedKind} event`
      )
      return
    }
    if (
      event.projection.preHead.state !== 'present' ||
      !sameCanonical(event.projection.preHead.head, event.projection.postHead)
    )
      failures.push(`${expectedKind} event ${eventSha256} is not same-head`)
    if (
      event.projection.invocationCorrelation.boundaryKind !==
        authority.invocationCorrelation.boundaryKind ||
      event.projection.invocationCorrelation.invocationSha256 !==
        authority.invocationCorrelation.invocationSha256
    )
      failures.push(
        `${expectedKind} event ${eventSha256} invocation authority differs`
      )
    if (
      event.projection.semanticPayloadSha256 !== editCanonicalSha256V1(payload)
    )
      failures.push(`${expectedKind} event ${eventSha256} payload differs`)
    matched.add(eventSha256)
  }
  for (const authority of attempts.byRequestSha256.values())
  {
    if (
      (authority.indexedState !== 'completed' &&
        authority.indexedState !== 'pending') ||
      !authority.result
    )
      continue
    const result = authority.result as Record<string, unknown>
    if (authority.attempt.toolName === 'edit_asset_admit')
    {
      verify(authority, 'asset-admitted', result['eventSha256'], {
        assetToken: result['assetToken'],
        mediaKind: result['mediaKind'],
        payloadSha256: result['payloadSha256'],
        metadataSha256: result['metadataSha256'],
        byteLength: result['byteLength'],
        dataFormat: result['dataFormat'],
        payloadKey: result['payloadKey'],
        recordKey: result['recordKey'],
      })
      const recordKey = result['recordKey']
      const payloadKey = result['payloadKey']
      if (typeof recordKey !== 'string' || typeof payloadKey !== 'string')
        failures.push(
          `edit_asset_admit attempt ${authority.attempt.sequence} omits retained asset locators`
        )
      else
      {
        try
        {
          const retained = await readJson<RetainedEditAssetRecordV1>(
            store,
            recordKey
          )
          const record = retained.record
          const payload = await store.readImmutable(payloadKey)
          const requestRecordFailure = retainedAssetDomainRecordFailureV1(
            authority.request,
            record
          )
          const eventSha256 = result['eventSha256']
          const event =
            typeof eventSha256 === 'string'
              ? bySha256.get(eventSha256)
              : undefined
          const admissionEvidenceId =
            event === undefined
              ? null
              : editAssetAdmissionEvidenceIdV1({
                  sessionId: event.projection.sessionId,
                  eventSha256: event.eventSha256,
                  record,
                })
          if (
            recordKey !== layout.assetRecord(String(result['assetToken'])) ||
            payloadKey !==
              layout.assetPayload(String(result['payloadSha256'])) ||
            record.assetToken !== result['assetToken'] ||
            record.mediaKind !== result['mediaKind'] ||
            record.payloadSha256 !== result['payloadSha256'] ||
            record.metadataSha256 !== result['metadataSha256'] ||
            record.byteLength !== result['byteLength'] ||
            record.identity.dataFormat !== result['dataFormat'] ||
            admissionEvidenceId !== result['admissionEvidenceId'] ||
            payload.byteLength !== record.byteLength ||
            sha256Hex(payload) !== record.payloadSha256 ||
            requestRecordFailure !== null
          )
            failures.push(
              `edit_asset_admit attempt ${authority.attempt.sequence} differs from its retained asset record or payload`
            )
        }
        catch
        {
          failures.push(
            `edit_asset_admit attempt ${authority.attempt.sequence} cannot reopen its retained asset record or payload`
          )
        }
      }
    }
    if (authority.attempt.toolName === 'edit_preview')
    {
      const preview = result['preview'] as Record<string, unknown> | undefined
      verify(authority, 'preview-recorded', result['eventSha256'], {
        previewId: preview?.['previewId'],
        requestSha256: preview?.['requestSha256'],
        predictedCandidateSha256: preview?.['predictedCandidateSha256'],
        resolvedPlanSha256: preview?.['resolvedPlanSha256'],
        operationResultSetSha256: preview?.['operationResultSetSha256'],
        applyGuardSha256: preview?.['applyGuardSha256'],
      })
      const candidateCacheKey = preview?.['candidateCacheKey']
      const predictedCandidateSha256 = preview?.['predictedCandidateSha256']
      if (
        typeof candidateCacheKey !== 'string' ||
        typeof predictedCandidateSha256 !== 'string' ||
        candidateCacheKey !== layout.preview(predictedCandidateSha256)
      )
        failures.push(
          `edit_preview attempt ${authority.attempt.sequence} has a noncanonical candidate-cache locator`
        )
      else
      {
        const cacheEntry = previewCacheEntries.get(candidateCacheKey)
        if (cacheEntry !== undefined)
        {
          const candidate = await store.readImmutable(candidateCacheKey)
          if (
            cacheEntry.sha256 !== predictedCandidateSha256 ||
            cacheEntry.byteLength !==
              preview?.['predictedCandidateByteLength'] ||
            sha256Hex(candidate) !== predictedCandidateSha256 ||
            candidate.byteLength !== preview?.['predictedCandidateByteLength']
          )
            failures.push(
              `edit_preview attempt ${authority.attempt.sequence} differs from its retained candidate`
            )
        }
      }
    }
    if (authority.attempt.toolName === 'edit_checkpoint')
    {
      const projection = {
        checkpointId: result['checkpointId'],
        label: result['label'],
        ...(result['note'] === undefined ? {} : { note: result['note'] }),
        revision: result['revision'],
      }
      verify(
        authority,
        'checkpoint-recorded',
        result['eventSha256'],
        projection
      )
    }
  }
  for (const event of events)
    if (
      (event.projection.eventKind === 'asset-admitted' ||
        event.projection.eventKind === 'preview-recorded' ||
        event.projection.eventKind === 'checkpoint-recorded') &&
      !matched.has(event.eventSha256)
    )
    {
      const expectedTool =
        event.projection.eventKind === 'asset-admitted'
          ? 'edit_asset_admit'
          : event.projection.eventKind === 'preview-recorded'
            ? 'edit_preview'
            : 'edit_checkpoint'
      const recoverablePending = [...attempts.byRequestSha256.values()].filter(
        (authority) =>
          authority.indexedState === 'pending' &&
          authority.attempt.toolName === expectedTool
      )
      const abandonment = abandonments.filter((entry) =>
      {
        const authority = attempts.byRequestSha256.get(entry.requestSha256)
        return (
          entry.schemaVersion === 1 &&
          entry.kind === 'retained-stateful-attempt-abandoned-v1' &&
          entry.toolName === expectedTool &&
          entry.eventSha256 === event.eventSha256 &&
          event.projection.invocationCorrelation.invocationSha256 ===
            entry.invocationCorrelation.invocationSha256 &&
          event.projection.invocationCorrelation.boundaryKind ===
            entry.invocationCorrelation.boundaryKind &&
          authority?.indexedState === 'refused' &&
          authority.attempt.sequence === entry.attemptSequence &&
          authority.attempt.namespaceSha256 === entry.namespaceSha256
        )
      })
      if (recoverablePending.length !== 1 && abandonment.length !== 1)
        failures.push(
          `${event.projection.eventKind} event ${event.eventSha256} has no completed attempt authority`
        )
    }
}

// the published bytes are never read back from a host path: replay proves the
// receipt against the exact retained candidate of the revision it names, which
// is what "the exported bytes equal the evaluated head" actually means
async function verifyExports(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  manifest: EditKernelSessionManifestV1,
  revisions: readonly EditKernelRevisionRecordV1[],
  certificates: readonly EditRetainedCertificateV1[],
  plans: ActivatedEvaluationPlanSetV1 | null,
  events: readonly EditKernelSemanticEventV1[],
  attempts: VerifiedAttemptsV1,
  reports: readonly EditKernelReportV1[],
  failures: string[]
): Promise<VerifiedExportsV1>
{
  const directories = groupByDirectoryV1(
    await store.listImmutable(`${layout.prefix}/exports`)
  )
  const deniedSetSha256 = deniedDestinationSetSha256V1(manifest.provenance)
  let attemptCount = 0
  let publishedCount = 0
  let publishedSha256: string | null = null
  let receiptSha256: string | null = null
  const seenSequences = new Set<number>()
  for (const [directory, names] of [...directories].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  ))
  {
    const sequence = directorySequenceV1(directory)
    if (sequence === null)
    {
      failures.push(`export directory ${directory} is not ordinal-named`)
      continue
    }
    if (seenSequences.has(sequence))
      failures.push(`export sequence ${sequence} has duplicate directories`)
    seenSequences.add(sequence)
    if (!names.has('000000-intent.json'))
    {
      failures.push(`export ${sequence} retains no publication intent`)
      continue
    }
    attemptCount += 1
    try
    {
      const intent = await readJson<{
        schemaVersion: 1
        exportId: string
        exportSha256: string
        exportedRevision: ExactRevisionIdentityV1
        semanticSourceSha256: string
        historySha256: string
        certificateSha256: string
        sourceArtifactSha256: string
        sourceProvenanceEvidenceSha256: string
        outputReservationId: string
        outputReservationSha256: string
        auditRecordSha256: string
        expectedFinalName: string
        publicationRootId: string
        publicationRootOwnershipSha256: string
        publicationDirectory: EditPublicationDirectoryIdentityV1
        recoveryAuthority: string
        deniedDestinationSetSha256: string
      }>(store, names.get('000000-intent.json')!.key)
      if (
        layout.export(sequence, intent.exportSha256, '000000-intent.json') !==
        names.get('000000-intent.json')!.key
      )
      {
        failures.push(
          `export ${sequence} retains its intent under a noncanonical locator`
        )
        continue
      }
      const exported = revisions.find(
        (candidate) =>
          candidate.head.revisionId === intent.exportedRevision.revisionId &&
          candidate.head.revisionNumber ===
            intent.exportedRevision.revisionNumber
      )
      if (!exported)
      {
        failures.push(
          `export ${sequence} names a revision outside the head-reachable chain`
        )
        continue
      }
      const historySha256 = historyProjectionV1(
        manifest.semanticSourceSha256,
        revisions.slice(0, exported.head.revisionNumber + 1)
      ).sha256
      const exportSha256 = semanticHashV1('certificate', {
        kind: 'export-intent',
        schemaVersion: 1,
        exportedRevision: exactRevisionFromHeadV1(exported.head),
        semanticSourceSha256: manifest.semanticSourceSha256,
        historySha256,
        certificateSha256: intent.certificateSha256,
        basename: intent.expectedFinalName,
        publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
      })
      if (exportSha256 !== intent.exportSha256)
        failures.push(`export ${sequence} intent identity does not reconstruct`)
      if (
        intent.schemaVersion !== 1 ||
        intent.semanticSourceSha256 !== manifest.semanticSourceSha256 ||
        intent.sourceArtifactSha256 !== manifest.sourceArtifactSha256 ||
        intent.sourceProvenanceEvidenceSha256 !==
          manifest.sourceProvenanceEvidenceSha256 ||
        intent.historySha256 !== historySha256 ||
        intent.deniedDestinationSetSha256 !== deniedSetSha256 ||
        !/^[0-9a-f]{64}$/u.test(intent.auditRecordSha256) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(intent.publicationRootId) ||
        !/^[0-9a-f]{64}$/u.test(intent.publicationRootOwnershipSha256) ||
        !/^\.edit-publication-tmp-[0-9a-f]{32}$/u.test(
          intent.recoveryAuthority
        ) ||
        intent.publicationDirectory === null ||
        typeof intent.publicationDirectory !== 'object' ||
        intent.publicationDirectory.canonicalRealpath.length < 1
      )
        failures.push(
          `export ${sequence} intent is not bound to the retained source authority`
        )
      // a pre-link refusal records the names actually observed & whether temp
      // cleanup reached its directory-sync proof; it never infers absence
      if (names.has('000002-failed-before-publish.json'))
      {
        const failed = await readJson<{
          schemaVersion: 1
          code: string
          auditRecordSha256: string
          publicationCommitted: boolean
          preparationExisted: boolean
          cleanupRequired: boolean
          finalObservation: EditPublicationNameInspectionV1 | null
          finalObservationFailureSha256: string | null
          cleanupCompleted: boolean
          cleanupDirectorySynced: boolean
          cleanupObservation: EditPublicationNameInspectionV1 | null
          cleanupObservationFailureSha256: string | null
          cleanupFailureSha256: string | null
          recoveryRequired: boolean
        }>(store, names.get('000002-failed-before-publish.json')!.key)
        const finalObservationAuthority =
          failed.finalObservation !== null
            ? failed.finalObservationFailureSha256 === null
            : failed.finalObservationFailureSha256 !== null ||
              !failed.preparationExisted
        const cleanupObservationAuthority =
          failed.cleanupObservation !== null
            ? failed.cleanupObservationFailureSha256 === null
            : failed.cleanupObservationFailureSha256 !== null ||
              !failed.preparationExisted
        const expectedRecoveryRequired =
          failed.preparationExisted &&
          (!failed.cleanupCompleted ||
            failed.finalObservation === null ||
            failed.cleanupObservation === null ||
            failed.finalObservation.finalMatchesProof ||
            failed.cleanupObservation.finalMatchesProof ||
            (failed.finalObservation.finalPresent &&
              failed.code !== 'edit.output_exists') ||
            (failed.cleanupObservation.finalPresent &&
              failed.code !== 'edit.output_exists') ||
            failed.cleanupObservation.tempPresent)
        const auditAuthority = attempts.byRequestSha256.get(
          failed.auditRecordSha256
        )
        const request =
          auditAuthority?.request !== null &&
          typeof auditAuthority?.request === 'object'
            ? (auditAuthority.request as EditExportRequestV1)
            : null
        const outputAuthorityMatches =
          request?.output.kind === 'basename'
            ? request.output.basename === intent.expectedFinalName
            : request?.output.kind === 'reservation'
              ? request.output.reservationId === intent.outputReservationId &&
                request.output.expectedReservationSha256 ===
                  intent.outputReservationSha256
              : false
        const finalObservationCoherent =
          failed.finalObservation === null ||
          ((failed.finalObservation.tempMatchesProof === false ||
            failed.finalObservation.tempPresent) &&
            (failed.finalObservation.finalMatchesProof === false ||
              failed.finalObservation.finalPresent) &&
            (failed.finalObservation.finalPresent
              ? failed.finalObservation.finalDevice !== null &&
                failed.finalObservation.finalInode !== null &&
                failed.finalObservation.finalByteLength !== null
              : failed.finalObservation.finalDevice === null &&
                failed.finalObservation.finalInode === null &&
                failed.finalObservation.finalByteLength === null))
        const cleanupObservationCoherent =
          failed.cleanupObservation === null ||
          ((failed.cleanupObservation.tempMatchesProof === false ||
            failed.cleanupObservation.tempPresent) &&
            (failed.cleanupObservation.finalMatchesProof === false ||
              failed.cleanupObservation.finalPresent) &&
            (failed.cleanupObservation.finalPresent
              ? failed.cleanupObservation.finalDevice !== null &&
                failed.cleanupObservation.finalInode !== null &&
                failed.cleanupObservation.finalByteLength !== null
              : failed.cleanupObservation.finalDevice === null &&
                failed.cleanupObservation.finalInode === null &&
                failed.cleanupObservation.finalByteLength === null))
        const terminalAttemptResult = auditAuthority?.result
        const refusedResultMatches =
          terminalAttemptResult !== null &&
          typeof terminalAttemptResult === 'object' &&
          'ok' in terminalAttemptResult &&
          'code' in terminalAttemptResult &&
          (terminalAttemptResult as { ok?: unknown }).ok === false &&
          (terminalAttemptResult as { code?: unknown }).code === failed.code
        if (
          failed.schemaVersion !== 1 ||
          failed.publicationCommitted ||
          failed.cleanupRequired !== failed.preparationExisted ||
          failed.cleanupDirectorySynced !== failed.cleanupCompleted ||
          failed.recoveryRequired !== expectedRecoveryRequired ||
          !finalObservationAuthority ||
          !cleanupObservationAuthority ||
          !finalObservationCoherent ||
          !cleanupObservationCoherent ||
          auditAuthority === undefined ||
          auditAuthority.attempt.toolName !== 'edit_export' ||
          (failed.recoveryRequired
            ? auditAuthority.indexedState !== 'pending'
            : auditAuthority.indexedState !== 'refused' &&
              auditAuthority.indexedState !== 'pending') ||
          (failed.recoveryRequired
            ? auditAuthority.result !== undefined
            : !refusedResultMatches) ||
          request === null ||
          request.sessionId !== manifest.sessionId ||
          request.certificateSha256 !== intent.certificateSha256 ||
          request.expectedSourceArtifactSha256 !==
            intent.exportedRevision.sourceArtifactSha256 ||
          request.expectedRevisionId !== intent.exportedRevision.revisionId ||
          request.expectedRevisionNumber !==
            intent.exportedRevision.revisionNumber ||
          request.expectedCandidateSha256 !==
            intent.exportedRevision.candidateSha256 ||
          request.expectedAssetManifestSha256 !==
            intent.exportedRevision.assetManifestSha256 ||
          request.expectedChangeContractSha256 !==
            intent.exportedRevision.changeContractSha256 ||
          request.expectedCapabilityProfileSha256 !==
            intent.exportedRevision.capabilityProfileSha256 ||
          !outputAuthorityMatches ||
          (failed.cleanupRequired &&
            failed.cleanupCompleted &&
            failed.cleanupFailureSha256 !== null) ||
          (failed.cleanupRequired &&
            !failed.cleanupCompleted &&
            failed.cleanupFailureSha256 === null) ||
          (!failed.cleanupRequired && failed.cleanupFailureSha256 !== null) ||
          (failed.cleanupCompleted &&
            failed.cleanupObservation !== null &&
            failed.cleanupObservation.tempPresent) ||
          (!failed.preparationExisted &&
            (failed.finalObservation !== null ||
              failed.finalObservationFailureSha256 !== null ||
              failed.cleanupRequired ||
              failed.cleanupCompleted ||
              failed.cleanupDirectorySynced ||
              failed.cleanupObservation !== null ||
              failed.cleanupFailureSha256 !== null ||
              failed.recoveryRequired)) ||
          (failed.code === 'edit.output_exists' &&
            failed.finalObservation !== null &&
            !failed.finalObservation.finalPresent) ||
          (failed.finalObservation !== null &&
            failed.cleanupObservation !== null &&
            failed.finalObservation.preparationId !==
              failed.cleanupObservation.preparationId) ||
          names.has('000002-link-observed.json') ||
          names.has('000003-external-interference.json') ||
          names.has('000003-published.json') ||
          names.has('000004-completed.json') ||
          names.has('provenance.json')
        )
          failures.push(
            `export ${sequence} failed-before-publish evidence is internally inconsistent`
          )
        if (failed.preparationExisted)
        {
          if (!names.has('000001-prepared.json'))
            failures.push(
              `export ${sequence} failed after preparation without retaining its prepared proof`
            )
          else
          {
            const failedPrepared = await readJson<{
              schemaVersion: 1
              exportId: string
              preparedProofSha256: string
              publicationRootId: string
              publicationRootOwnershipSha256: string
              tempBasename: string
              candidateSha256: string
              candidateByteLength: number
              directoryCanonicalRealpath: string
              tempDevice: string
              tempInode: string
            }>(store, names.get('000001-prepared.json')!.key)
            const candidateBytes = await store.readImmutable(
              exported.candidateKey
            )
            const candidateByteLength = candidateBytes.byteLength
            const expectedPreparedProofSha256 = editExportPreparedProofSha256V1(
              {
                schemaVersion: 1,
                publicationProtocolVersion:
                  EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
                basename: intent.expectedFinalName,
                candidateSha256: sha256Hex(candidateBytes),
                candidateByteLength,
                nameDurableBeforeWrite: true,
                fileSynced: true,
                readbackVerified: true,
              }
            )
            if (
              failedPrepared.schemaVersion !== 1 ||
              failedPrepared.exportId !== intent.exportId ||
              failedPrepared.preparedProofSha256 !==
                expectedPreparedProofSha256 ||
              failedPrepared.publicationRootId !== intent.publicationRootId ||
              failedPrepared.publicationRootOwnershipSha256 !==
                intent.publicationRootOwnershipSha256 ||
              failedPrepared.tempBasename !== intent.recoveryAuthority ||
              failedPrepared.candidateSha256 !==
                intent.exportedRevision.candidateSha256 ||
              failedPrepared.candidateByteLength !== candidateByteLength ||
              failedPrepared.directoryCanonicalRealpath !==
                intent.publicationDirectory.canonicalRealpath ||
              (failed.finalObservation?.finalMatchesProof === true &&
                (failed.finalObservation.finalDevice !==
                  failedPrepared.tempDevice ||
                  failed.finalObservation.finalInode !==
                    failedPrepared.tempInode ||
                  failed.finalObservation.finalByteLength !==
                    candidateByteLength)) ||
              (failed.cleanupObservation?.finalMatchesProof === true &&
                (failed.cleanupObservation.finalDevice !==
                  failedPrepared.tempDevice ||
                  failed.cleanupObservation.finalInode !==
                    failedPrepared.tempInode ||
                  failed.cleanupObservation.finalByteLength !==
                    candidateByteLength))
            )
              failures.push(
                `export ${sequence} failed-before-publish observation differs from its prepared inode proof`
              )
          }
        }
        if (names.has('semantic-receipt.json'))
          failures.push(
            `export ${sequence} refused before publication yet retains a receipt`
          )
        continue
      }
      if (names.has('000003-external-interference.json'))
      {
        const terminal = await readJson<{
          schemaVersion: 1
          exportId: string
          code: string
          disposition:
            'committedCandidateUnattested' | 'unexpectedFinalIdentity'
          interferenceEvidenceSha256: string
          receiptIssued: boolean
          recoveryAuthorityDisposition: string
          auditRecordSha256: string
          eventSha256: string
          reportSha256: string
        }>(store, names.get('000003-external-interference.json')!.key)
        const auditAuthority = attempts.byRequestSha256.get(
          terminal.auditRecordSha256
        )
        const request =
          auditAuthority?.request !== null &&
          typeof auditAuthority?.request === 'object'
            ? (auditAuthority.request as EditExportRequestV1)
            : null
        const outputAuthorityMatches =
          request?.output.kind === 'basename'
            ? request.output.basename === intent.expectedFinalName
            : request?.output.kind === 'reservation'
              ? request.output.reservationId === intent.outputReservationId &&
                request.output.expectedReservationSha256 ===
                  intent.outputReservationSha256
              : false
        const closed = events.find(
          (event) => event.eventSha256 === terminal.eventSha256
        )
        const terminalAttemptResult =
          auditAuthority?.result !== null &&
          typeof auditAuthority?.result === 'object'
            ? (auditAuthority.result as {
                ok?: boolean
                code?: string
                disposition?: string
              })
            : null
        let interferenceEvidenceMatches = false
        if (terminal.disposition === 'unexpectedFinalIdentity')
        {
          const recoveryInspections = await Promise.all(
            [...names]
              .filter(([name]) => /^recovery-[0-9]{6}\.json$/u.test(name))
              .map(([, entry]) =>
                readJson<{
                  schemaVersion: 1
                  exportId: string
                  inspection: EditPublicationNameInspectionV1
                }>(store, entry.key)
              )
          )
          interferenceEvidenceMatches = recoveryInspections.some(
            (record) =>
              record.schemaVersion === 1 &&
              record.exportId === intent.exportId &&
              record.inspection.finalPresent &&
              !record.inspection.finalMatchesProof &&
              editCanonicalSha256V1({
                kind: 'unexpected-final-identity',
                inspection: record.inspection,
              }) === terminal.interferenceEvidenceSha256
          )
        }
        else if (
          names.has('000001-prepared.json') &&
          names.has('000002-link-observed.json')
        )
        {
          const prepared = await readJson<{
            schemaVersion: 1
            exportId: string
            preparedProofSha256: string
            tempDevice: string
            tempInode: string
          }>(store, names.get('000001-prepared.json')!.key)
          const link = await readJson<{
            schemaVersion: 1
            exportId: string
            linkCreated: boolean
            directorySynced: boolean
            finalDevice: string
            finalInode: string
            byteLength: number
          }>(store, names.get('000002-link-observed.json')!.key)
          const candidateBytes = await store.readImmutable(
            exported.candidateKey
          )
          const preparedProofSha256 = editExportPreparedProofSha256V1({
            schemaVersion: 1,
            publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
            basename: intent.expectedFinalName,
            candidateSha256: sha256Hex(candidateBytes),
            candidateByteLength: candidateBytes.byteLength,
            nameDurableBeforeWrite: true,
            fileSynced: true,
            readbackVerified: true,
          })
          const recoveredPrepared = await Promise.all(
            [...names]
              .filter(([name]) =>
                /^recovery-[0-9]{6}-prepared\.json$/u.test(name)
              )
              .map(([, entry]) =>
                readJson<{
                  schemaVersion: 1
                  exportId: string
                  preparedProofSha256: string
                  tempDevice: string
                  tempInode: string
                }>(store, entry.key)
              )
          )
          const preparedIdentityMatches = [prepared, ...recoveredPrepared].some(
            (record) =>
              record.schemaVersion === 1 &&
              record.exportId === intent.exportId &&
              record.preparedProofSha256 === preparedProofSha256 &&
              record.tempDevice === link.finalDevice &&
              record.tempInode === link.finalInode
          )
          interferenceEvidenceMatches =
            link.schemaVersion === 1 &&
            link.exportId === intent.exportId &&
            link.linkCreated &&
            link.directorySynced &&
            link.byteLength === candidateBytes.byteLength &&
            preparedIdentityMatches &&
            editCanonicalSha256V1({
              kind: 'committed-candidate-unattested',
              link: {
                linkCreated: link.linkCreated,
                directorySynced: link.directorySynced,
                finalDevice: link.finalDevice,
                finalInode: link.finalInode,
                byteLength: link.byteLength,
              },
            }) === terminal.interferenceEvidenceSha256
        }
        if (
          terminal.schemaVersion !== 1 ||
          terminal.exportId !== intent.exportId ||
          terminal.code !== 'edit.publication_interference' ||
          (terminal.disposition !== 'committedCandidateUnattested' &&
            terminal.disposition !== 'unexpectedFinalIdentity') ||
          terminal.receiptIssued ||
          terminal.recoveryAuthorityDisposition !== 'cleared' ||
          !names.has('000001-prepared.json') ||
          !interferenceEvidenceMatches ||
          auditAuthority === undefined ||
          auditAuthority.attempt.toolName !== 'edit_export' ||
          (auditAuthority.indexedState !== 'refused' &&
            auditAuthority.indexedState !== 'pending') ||
          terminalAttemptResult === null ||
          terminalAttemptResult.ok !== false ||
          terminalAttemptResult.code !== 'edit.publication_interference' ||
          terminalAttemptResult.disposition !== terminal.disposition ||
          request === null ||
          request.sessionId !== manifest.sessionId ||
          request.certificateSha256 !== intent.certificateSha256 ||
          request.expectedSourceArtifactSha256 !==
            intent.exportedRevision.sourceArtifactSha256 ||
          request.expectedRevisionId !== intent.exportedRevision.revisionId ||
          request.expectedRevisionNumber !==
            intent.exportedRevision.revisionNumber ||
          request.expectedCandidateSha256 !==
            intent.exportedRevision.candidateSha256 ||
          request.expectedAssetManifestSha256 !==
            intent.exportedRevision.assetManifestSha256 ||
          request.expectedChangeContractSha256 !==
            intent.exportedRevision.changeContractSha256 ||
          request.expectedCapabilityProfileSha256 !==
            intent.exportedRevision.capabilityProfileSha256 ||
          !outputAuthorityMatches ||
          !closed ||
          closed.projection.eventKind !== 'session-closed' ||
          closed.projection.semanticPayloadSha256 !==
            editCanonicalSha256V1({
              reason: 'post-publication-interference',
              terminalState: 'closed-abandoned',
              exportId: intent.exportId,
              disposition: terminal.disposition,
              interferenceEvidenceSha256: terminal.interferenceEvidenceSha256,
              receiptIssued: false,
            }) ||
          !reports.some(
            (report) =>
              report.semanticProjectionSha256 === terminal.reportSha256 &&
              report.state === 'closed-abandoned' &&
              report.eventHeadSha256 === terminal.eventSha256
          ) ||
          names.has('semantic-receipt.json') ||
          names.has('000003-published.json') ||
          names.has('000004-completed.json') ||
          names.has('provenance.json') ||
          names.has('000002-failed-before-publish.json')
        )
          failures.push(
            `export ${sequence} terminal publication-interference evidence does not reconstruct`
          )
        continue
      }
      if (!names.has('semantic-receipt.json'))
      {
        // a publication window that never reached its receipt is an interrupted
        // export, not a completed one; recovery is what closes it
        continue
      }
      const missing = [
        '000001-prepared.json',
        '000002-link-observed.json',
        '000003-published.json',
        '000004-completed.json',
        'provenance.json',
      ].filter((name) => !names.has(name))
      if (missing.length > 0)
      {
        failures.push(
          `export ${sequence} has a receipt but retains no ${missing.join(', ')}`
        )
        continue
      }
      if (
        names.has('000002-failed-before-publish.json') ||
        names.has('000003-external-interference.json')
      )
        failures.push(
          `export ${sequence} retains mutually exclusive terminal evidence`
        )
      publishedCount += 1
      const preparedRecord = await readJson<{
        schemaVersion: 1
        exportId: string
        preparedProofSha256: string
        publicationRootId: string
        publicationRootOwnershipSha256: string
        tempBasename: string
        candidateSha256: string
        candidateByteLength: number
        directoryCanonicalRealpath: string
        tempDevice: string
        tempInode: string
        tempMode: string
        directoryDevice: string
        directoryInode: string
        preparedAtEpochMs: number
      }>(store, names.get('000001-prepared.json')!.key)
      const linkObserved = await readJson<{
        schemaVersion: 1
        exportId: string
        linkCreated: boolean
        directorySynced: boolean
        finalDevice: string
        finalInode: string
        byteLength: number
      }>(store, names.get('000002-link-observed.json')!.key)
      const recoveryPreparedRecords = await Promise.all(
        [...names]
          .filter(([name]) => /^recovery-[0-9]{6}-prepared\.json$/u.test(name))
          .map(async ([name, entry]) => ({
            name,
            record: await readJson<{
              schemaVersion: 1
              exportId: string
              recoverySequence: string
              temporaryRecreated: boolean
              preparedProofSha256: string
              tempDevice: string
              tempInode: string
              tempMode: string
              directoryDevice: string
              directoryInode: string
            }>(store, entry.key),
          }))
      )
      const retainedReceipt = await readJson<{
        receipt: EditSemanticExportReceiptV1
        receiptSha256: string
      }>(store, names.get('semantic-receipt.json')!.key)
      const receipt = retainedReceipt.receipt
      const rebuiltReceiptSha256 = editSemanticExportReceiptSha256V1(receipt)
      if (rebuiltReceiptSha256 !== retainedReceipt.receiptSha256)
        failures.push(
          `export ${sequence} receipt identity does not reconstruct`
        )
      receiptSha256 = rebuiltReceiptSha256
      const candidateBytes = await store.readImmutable(exported.candidateKey)
      const candidateSha256 = sha256Hex(candidateBytes)
      // ---- the final export hash: the published bytes are the exact evaluated
      // head, proven against the retained candidate rather than the receipt
      if (
        receipt.publishedSha256 !== candidateSha256 ||
        receipt.publishedSha256 !== exported.head.candidateSha256 ||
        receipt.publishedByteLength !== candidateBytes.byteLength
      )
        failures.push(
          `export ${sequence} published identity is not the exact evaluated head`
        )
      publishedSha256 = receipt.publishedSha256
      if (
        receipt.schemaVersion !== 1 ||
        !sameCanonical(
          receipt.exportedRevision,
          exactRevisionFromHeadV1(exported.head)
        ) ||
        receipt.semanticSourceSha256 !== manifest.semanticSourceSha256 ||
        receipt.historySha256 !== historySha256 ||
        receipt.changeContractSha256 !== exported.head.changeContractSha256 ||
        receipt.capabilityProfileSha256 !==
          exported.head.capabilityProfileSha256 ||
        receipt.basename !== intent.expectedFinalName ||
        receipt.certificateSha256 !== intent.certificateSha256 ||
        receipt.publicationProtocolVersion !==
          EDIT_PUBLICATION_PROTOCOL_VERSION_V1 ||
        receipt.terminalStatus !== 'closed-exported'
      )
        failures.push(
          `export ${sequence} receipt is not bound to its intent & revision`
        )
      const authorizing = certificates.find(
        (entry) =>
          entry.certificate.certificateSha256 === receipt.certificateSha256
      )
      if (
        !authorizing ||
        authorizing.certificate.hashProjection.status !== 'passed' ||
        !sameCanonical(
          authorizing.certificate.hashProjection.evaluatedRevision,
          exactRevisionFromHeadV1(exported.head)
        )
      )
        failures.push(
          `export ${sequence} names no passed exact-head certificate among the retained set`
        )
      else if (
        plans !== null &&
        authorizing.planId !== plans.exportRequiredPlanId
      )
        failures.push(
          `export ${sequence} was authorized by plan ${authorizing.planId}, not the contract's export-required plan`
        )
      const preparedProofSha256 = editExportPreparedProofSha256V1({
        schemaVersion: 1,
        publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
        basename: receipt.basename,
        candidateSha256,
        candidateByteLength: candidateBytes.byteLength,
        nameDurableBeforeWrite: true,
        fileSynced: true,
        readbackVerified: true,
      })
      if (
        preparedRecord.schemaVersion !== 1 ||
        preparedRecord.exportId !== intent.exportId ||
        preparedRecord.preparedProofSha256 !== preparedProofSha256 ||
        preparedRecord.publicationRootId !== intent.publicationRootId ||
        preparedRecord.publicationRootOwnershipSha256 !==
          intent.publicationRootOwnershipSha256 ||
        preparedRecord.tempBasename !== intent.recoveryAuthority ||
        preparedRecord.candidateSha256 !== candidateSha256 ||
        preparedRecord.candidateByteLength !== candidateBytes.byteLength ||
        preparedRecord.directoryCanonicalRealpath !==
          intent.publicationDirectory.canonicalRealpath ||
        preparedProofSha256 !== receipt.preparedProofSha256
      )
        failures.push(
          `export ${sequence} prepared record or proof does not reconstruct from the retained candidate`
        )
      for (const { name, record } of recoveryPreparedRecords)
      {
        if (
          record.schemaVersion !== 1 ||
          record.exportId !== intent.exportId ||
          record.preparedProofSha256 !== preparedProofSha256 ||
          name !== `recovery-${record.recoverySequence}-prepared.json`
        )
          failures.push(
            `export ${sequence} recovered prepared proof does not reconstruct`
          )
      }
      const preparedReopen = await replayReopenEvidenceV1(
        'preparedTemp',
        candidateBytes
      )
      const committedReopen = await replayReopenEvidenceV1(
        'committedFinal',
        candidateBytes
      )
      if (!preparedReopen || !committedReopen)
        failures.push(
          `export ${sequence} published candidate no longer re-admits through the full admission path`
        )
      else if (
        editExportReopenSha256V1([preparedReopen, committedReopen]) !==
        receipt.reopenSha256
      )
        failures.push(`export ${sequence} reopen evidence does not reconstruct`)
      if (
        editExportSourcePreservationSha256V1({
          schemaVersion: 1,
          provenanceKind: manifest.provenance.kind,
          sourceArtifactSha256: manifest.sourceArtifactSha256,
          revisionZeroCandidateSha256: manifest.sourceArtifactSha256,
          preLinkRecheckOk: true,
          postLinkRecheckOk: true,
          deniedDestinationSetSha256: deniedSetSha256,
        }) !== receipt.sourcePreservationSha256
      )
        failures.push(
          `export ${sequence} source-preservation evidence does not reconstruct`
        )
      if (
        plans !== null &&
        authorizing &&
        editExportGateSha256V1({
          schemaVersion: 1,
          exportRequiredPlanId: plans.exportRequiredPlanId,
          certificateSha256: receipt.certificateSha256,
          certificateStatus: authorizing.certificate.hashProjection.status,
          exportable: true,
          cumulativePreservationSha256: editCanonicalSha256V1(
            exported.preservation
          ),
          diagnosticsSha256: editCanonicalSha256V1(exported.diagnostics),
        }) !== receipt.gateSha256
      )
        failures.push(`export ${sequence} gate evidence does not reconstruct`)
      const retainedProvenance = await readJson<{
        provenance: EditExportProvenanceV1
        provenanceSha256: string
      }>(store, names.get('provenance.json')!.key)
      const provenance = retainedProvenance.provenance
      const effectivePreparedMatches = [
        preparedRecord,
        ...recoveryPreparedRecords.map((entry) => entry.record),
      ].some(
        (record) =>
          record.tempDevice === provenance.tempDevice &&
          record.tempInode === provenance.tempInode &&
          record.tempMode === provenance.tempMode &&
          record.directoryDevice === provenance.directoryDevice &&
          record.directoryInode === provenance.directoryInode &&
          linkObserved.finalDevice === record.tempDevice &&
          linkObserved.finalInode === record.tempInode
      )
      if (
        editExportProvenanceSha256V1(provenance) !==
        retainedProvenance.provenanceSha256
      )
        failures.push(
          `export ${sequence} host provenance identity does not reconstruct`
        )
      if (
        provenance.schemaVersion !== 1 ||
        provenance.exportId !== intent.exportId ||
        provenance.reservationId !== intent.outputReservationId ||
        provenance.reservationSha256 !== intent.outputReservationSha256 ||
        !effectivePreparedMatches ||
        preparedRecord.preparedAtEpochMs !== provenance.preparedAtEpochMs ||
        linkObserved.schemaVersion !== 1 ||
        linkObserved.exportId !== intent.exportId ||
        linkObserved.finalDevice !== provenance.finalDevice ||
        linkObserved.finalInode !== provenance.finalInode ||
        linkObserved.byteLength !== receipt.publishedByteLength ||
        linkObserved.linkCreated !== provenance.linkCreated ||
        linkObserved.directorySynced !== provenance.directorySynced ||
        !provenance.nameDurableBeforeWrite ||
        !provenance.fileSynced ||
        !provenance.readbackVerified ||
        !provenance.linkCreated ||
        !provenance.directorySynced ||
        !provenance.postCommitIdentityMatched ||
        !provenance.tempReleased ||
        provenance.deniedDestinationSetSha256 !== deniedSetSha256 ||
        provenance.originalSourceCheckSha256 !==
          receipt.sourcePreservationSha256 ||
        !Number.isSafeInteger(provenance.preparedAtEpochMs) ||
        !Number.isSafeInteger(provenance.committedAtEpochMs) ||
        provenance.committedAtEpochMs < provenance.preparedAtEpochMs
      )
        failures.push(
          `export ${sequence} stage records & host provenance do not attest one durable publication`
        )
      const auditAuthority = attempts.byRequestSha256.get(
        provenance.auditRecordSha256
      )
      const exportRequest =
        auditAuthority?.request !== null &&
        typeof auditAuthority?.request === 'object'
          ? (auditAuthority.request as EditExportRequestV1)
          : null
      const outputAuthorityMatches =
        exportRequest?.output.kind === 'basename'
          ? exportRequest.output.basename === intent.expectedFinalName
          : exportRequest?.output.kind === 'reservation'
            ? exportRequest.output.reservationId ===
                intent.outputReservationId &&
              exportRequest.output.expectedReservationSha256 ===
                intent.outputReservationSha256
            : false
      if (
        auditAuthority === undefined ||
        auditAuthority.attempt.toolName !== 'edit_export' ||
        (auditAuthority.indexedState !== 'completed' &&
          auditAuthority.indexedState !== 'pending') ||
        exportRequest === null ||
        exportRequest.schemaVersion !== 1 ||
        exportRequest.sessionId !== manifest.sessionId ||
        exportRequest.certificateSha256 !== intent.certificateSha256 ||
        exportRequest.expectedSourceArtifactSha256 !==
          intent.exportedRevision.sourceArtifactSha256 ||
        exportRequest.expectedRevisionNumber !==
          intent.exportedRevision.revisionNumber ||
        exportRequest.expectedRevisionId !==
          intent.exportedRevision.revisionId ||
        exportRequest.expectedCandidateSha256 !==
          intent.exportedRevision.candidateSha256 ||
        exportRequest.expectedAssetManifestSha256 !==
          intent.exportedRevision.assetManifestSha256 ||
        exportRequest.expectedChangeContractSha256 !==
          intent.exportedRevision.changeContractSha256 ||
        exportRequest.expectedCapabilityProfileSha256 !==
          intent.exportedRevision.capabilityProfileSha256 ||
        !outputAuthorityMatches
      )
        failures.push(
          `export ${sequence} provenance does not bind the completed export attempt authority`
        )
      if (
        !reports.some(
          (report) =>
            report.semanticProjectionSha256 === provenance.reportSha256 &&
            report.state === 'closed-exported' &&
            report.exportState === 'exported' &&
            report.eventHeadSha256 === provenance.eventSha256
        )
      )
        failures.push(
          `export ${sequence} provenance names no matching retained terminal report`
        )
      // the proof is derived from the receipt & the attested booleans, then the
      // published & completed records are checked against the derived value
      const publicationProofSha256 = editPublicationProofSha256V1({
        schemaVersion: 1,
        publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
        basename: receipt.basename,
        publishedSha256: receipt.publishedSha256,
        publishedByteLength: receipt.publishedByteLength,
        preparedProofSha256: receipt.preparedProofSha256,
        reopenSha256: receipt.reopenSha256,
        noReplaceLinkProven: linkObserved.linkCreated,
        durableCommitPointReached:
          linkObserved.linkCreated && linkObserved.directorySynced,
        postCommitIdentityMatched: provenance.postCommitIdentityMatched,
      })
      await verifyJsonArtifact(
        store,
        names.get('000003-published.json')!.key,
        {
          schemaVersion: 1,
          exportId: intent.exportId,
          publicationProofSha256,
          reopenSha256: receipt.reopenSha256,
          sourcePreservationSha256: receipt.sourcePreservationSha256,
          gateSha256: receipt.gateSha256,
        },
        failures,
        `export ${sequence} published record`
      )
      const completed = await readJson<{
        exportId: string
        result: {
          terminalState: string
          exportedRevision: ExactRevisionIdentityV1
          certificateSha256: string
          outputReservationId: string
          outputReservationSha256: string
          publicationProofSha256: string
          publishedByteLength: number
          publishedSha256: string
          reopenSha256: string
          sourcePreservationSha256: string
          eventSha256: string
          reportSha256: string
        }
      }>(store, names.get('000004-completed.json')!.key)
      if (
        completed.exportId !== intent.exportId ||
        completed.result.terminalState !== 'closed-exported' ||
        !sameCanonical(
          completed.result.exportedRevision,
          receipt.exportedRevision
        ) ||
        completed.result.certificateSha256 !== receipt.certificateSha256 ||
        completed.result.outputReservationId !== intent.outputReservationId ||
        completed.result.outputReservationSha256 !==
          intent.outputReservationSha256 ||
        completed.result.publicationProofSha256 !== publicationProofSha256 ||
        completed.result.publishedSha256 !== receipt.publishedSha256 ||
        completed.result.publishedByteLength !== receipt.publishedByteLength ||
        completed.result.reopenSha256 !== receipt.reopenSha256 ||
        completed.result.sourcePreservationSha256 !==
          receipt.sourcePreservationSha256 ||
        completed.result.eventSha256 !== provenance.eventSha256 ||
        completed.result.reportSha256 !== provenance.reportSha256 ||
        auditAuthority?.result === undefined ||
        !sameCanonical(auditAuthority?.result, completed.result)
      )
        failures.push(
          `export ${sequence} completed record disagrees with the rebuilt receipt`
        )
      const closed = events.find(
        (event) => event.eventSha256 === provenance.eventSha256
      )
      if (
        !closed ||
        closed.projection.eventKind !== 'session-closed' ||
        closed.projection.semanticPayloadSha256 !==
          editCanonicalSha256V1({
            reason: 'export-published',
            terminalState: 'closed-exported',
            receiptSha256: rebuiltReceiptSha256,
            publicationProofSha256,
          })
      )
        failures.push(`export ${sequence} has no matching session-closed event`)
    }
    catch (error)
    {
      failures.push(
        `export ${sequence} does not rehydrate: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  const orderedSequences = [...seenSequences].sort(
    (left, right) => left - right
  )
  if (orderedSequences.some((sequence, index) => sequence !== index))
    failures.push('export directories do not form one contiguous ordinal chain')
  if (publishedCount > 1)
    failures.push('session retains more than its single permitted publication')
  return { attemptCount, publishedCount, publishedSha256, receiptSha256 }
}

async function verifyReports(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  manifest: EditKernelSessionManifestV1,
  revisions: readonly EditKernelRevisionRecordV1[],
  certificates: readonly EditRetainedCertificateV1[],
  failures: string[]
): Promise<{
  count: number
  current: EditKernelReportV1 | null
  reports: readonly EditKernelReportV1[]
}>
{
  const reportEntries = (
    await store.listImmutable(`${layout.prefix}/reports`)
  ).filter((entry) => entry.key.endsWith('/report.json'))
  const byHash = new Map<string, EditKernelReportV1>()
  const reports: EditKernelReportV1[] = []
  for (const entry of reportEntries)
  {
    const bytes = await store.readImmutable(entry.key)
    const report = decode<EditKernelReportV1>(bytes)
    const reportJsonSha256 = sha256Hex(bytes)
    byHash.set(reportJsonSha256, report)
    reports.push(report)
    if (!entry.key.includes(`/${reportJsonSha256}/report.json`))
      failures.push(`report ${entry.key} has the wrong exact byte locator`)
    if (report.revisionCount < 1 || report.revisionCount > revisions.length)
    {
      failures.push(`report ${entry.key} names an impossible revision count`)
      continue
    }
    if (
      !Number.isSafeInteger(report.certificateCount) ||
      report.certificateCount < 0 ||
      report.certificateCount > certificates.length
    )
    {
      failures.push(`report ${entry.key} names an impossible certificate count`)
      continue
    }
    const expected = semanticReportProjectionV1(
      manifest.semanticSourceSha256,
      manifest.changeContractSha256,
      manifest.capabilityProfileSha256,
      revisions.slice(0, report.revisionCount),
      report.certificateCount === 0
        ? undefined
        : certificateSetProjectionV1(
            certificates.slice(0, report.certificateCount)
          ).sha256
    )
    if (
      !sameCanonical(report.semanticProjection, expected.projection) ||
      report.semanticProjectionSha256 !== expected.sha256
    )
      failures.push(`report ${entry.key} has the wrong semantic projection`)
    await verifyJsonArtifact(
      store,
      layout.report(reportJsonSha256, 'semantic-projection.json'),
      report.semanticProjection,
      failures,
      `report ${reportJsonSha256} semantic projection`
    )
    await verifyJsonArtifact(
      store,
      layout.report(reportJsonSha256, 'manifest.json'),
      {
        schemaVersion: 1,
        reportJsonSha256,
        reportByteLength: bytes.byteLength,
        semanticProjectionSha256: report.semanticProjectionSha256,
      },
      failures,
      `report ${reportJsonSha256} manifest`
    )
    const expectedMarkdown = new TextEncoder().encode(
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
    try
    {
      const markdown = await store.readImmutable(
        layout.report(reportJsonSha256, 'report.md')
      )
      if (sha256Hex(markdown) !== sha256Hex(expectedMarkdown))
        failures.push(`report ${reportJsonSha256} markdown differs`)
    }
    catch (error)
    {
      failures.push(
        `report ${reportJsonSha256} markdown is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  let current: EditKernelReportV1 | null = null
  try
  {
    const pointer = await readJson<ReportPointerV1>(store, layout.currentReport)
    current = byHash.get(pointer.reportJsonSha256) ?? null
    if (!current)
      failures.push('current report pointer names no retained report')
    else
    {
      const manifestHash = await store.hashImmutable(
        layout.report(pointer.reportJsonSha256, 'manifest.json')
      )
      if (manifestHash !== pointer.reportManifestSha256)
        failures.push('current report pointer has the wrong manifest hash')
    }
  }
  catch (error)
  {
    failures.push(
      `current report pointer is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return { count: reportEntries.length, current, reports }
}

async function verifyCheckpoints(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  revisions: readonly EditKernelRevisionRecordV1[],
  events: readonly EditKernelSemanticEventV1[],
  failures: string[]
): Promise<number>
{
  const entries = await store.listImmutable(`${layout.prefix}/checkpoints`)
  const revisionIds = new Set(revisions.map((entry) => entry.head.revisionId))
  const eventIds = new Set(events.map((entry) => entry.eventSha256))
  for (const entry of entries)
  {
    const checkpoint = await readJson<EditKernelCheckpointV1>(store, entry.key)
    const { checkpointSha256, ...projection } = checkpoint
    if (editCanonicalSha256V1(projection) !== checkpointSha256)
      failures.push(`checkpoint ${entry.key} has the wrong hash`)
    if (!revisionIds.has(checkpoint.revision.revisionId))
      failures.push(`checkpoint ${entry.key} names an absent revision`)
    if (!eventIds.has(checkpoint.eventSha256))
      failures.push(`checkpoint ${entry.key} names an absent event`)
  }
  return entries.length
}

async function verifyAttempts(
  store: EditArtifactStorePort,
  layout: ReturnType<typeof editSessionLayoutV1>,
  sessionId: string,
  failures: string[]
): Promise<VerifiedAttemptsV1>
{
  const entries = await store.listImmutable(`${layout.prefix}/attempts`)
  const requests = entries.filter((entry) =>
    entry.key.endsWith('/request.json')
  )
  const byRequestSha256 = new Map<string, VerifiedAttemptAuthorityV1>()
  if (requests.length === 0)
    return { count: 0, pendingCount: 0, byRequestSha256 }
  let index: {
    schemaVersion: 1
    entries: readonly {
      namespaceSha256: string
      requestSha256: string
      attemptSequence: number
      state: EditKernelAttemptV1['state']
      resultSha256?: string
      refusalCode?: string
    }[]
  }
  try
  {
    index = await readJson(store, layout.idempotencyIndex)
  }
  catch (error)
  {
    failures.push(
      `idempotency index is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return { count: requests.length, pendingCount: 0, byRequestSha256 }
  }
  const entryKeys = new Set(entries.map((entry) => entry.key))
  const indexedEntries = Array.isArray(index.entries) ? index.entries : []
  const indexedNamespaces = new Set<string>()
  const indexedSequences = new Set<number>()
  if (index.schemaVersion !== 1 || indexedEntries.length !== requests.length)
    failures.push(
      'idempotency index schema or retained request artifact count differs'
    )
  for (const indexed of indexedEntries)
  {
    if (
      typeof indexed.namespaceSha256 !== 'string' ||
      typeof indexed.requestSha256 !== 'string' ||
      !Number.isSafeInteger(indexed.attemptSequence) ||
      indexed.attemptSequence < 0 ||
      !['pending', 'completed', 'refused'].includes(indexed.state)
    )
    {
      failures.push('idempotency index contains a malformed attempt entry')
      continue
    }
    if (
      indexedNamespaces.has(indexed.namespaceSha256) ||
      indexedSequences.has(indexed.attemptSequence)
    )
      failures.push('idempotency index contains duplicate attempt authority')
    indexedNamespaces.add(indexed.namespaceSha256)
    indexedSequences.add(indexed.attemptSequence)
    const requestKey = layout.attempt(
      indexed.attemptSequence,
      indexed.requestSha256,
      'request.json'
    )
    if (!entryKeys.has(requestKey))
      failures.push(
        `idempotency index attempt ${indexed.attemptSequence} names no exact request artifact`
      )
    const terminal =
      indexed.state === 'completed' || indexed.state === 'refused'
    if (
      terminal !== (indexed.resultSha256 !== undefined) ||
      (indexed.state === 'refused') !== (indexed.refusalCode !== undefined) ||
      (indexed.state !== 'pending' && !terminal)
    )
      failures.push(
        `idempotency index attempt ${indexed.attemptSequence} has an invalid terminal projection`
      )
  }
  for (const requestEntry of requests)
  {
    const retained = await readJson<{
      attempt: EditKernelAttemptV1
      request: unknown
      transportRequest: unknown
      invocationCorrelation: {
        boundaryKind: 'directHost' | 'mcp'
        invocationSha256: string
      }
      schemaVersion: 1
    }>(store, requestEntry.key)
    const attempt = retained.attempt
    const wrapperFields = Object.keys(retained).sort()
    if (
      wrapperFields.length !== 5 ||
      wrapperFields[0] !== 'attempt' ||
      wrapperFields[1] !== 'invocationCorrelation' ||
      wrapperFields[2] !== 'request' ||
      wrapperFields[3] !== 'schemaVersion' ||
      wrapperFields[4] !== 'transportRequest' ||
      retained.schemaVersion !== 1 ||
      (retained.invocationCorrelation.boundaryKind !== 'directHost' &&
        retained.invocationCorrelation.boundaryKind !== 'mcp') ||
      !/^[0-9a-f]{64}$/u.test(retained.invocationCorrelation.invocationSha256)
    )
      failures.push(
        `attempt ${attempt.sequence} request wrapper authority differs`
      )
    const rebuiltRequestSha256 = editCanonicalSha256V1(retained.request)
    const requestBindingFailure = retainedStatefulRequestBindingFailureV1({
      toolName: attempt.toolName,
      requestId: attempt.requestId,
      sessionId,
      boundaryKind: retained.invocationCorrelation.boundaryKind,
      request: retained.request,
      transportRequest: retained.transportRequest,
    })
    if (requestBindingFailure !== null)
      failures.push(
        `attempt ${attempt.sequence} transport authority differs: ${requestBindingFailure}`
      )
    if (
      rebuiltRequestSha256 !== attempt.requestSha256 ||
      requestEntry.key !==
        layout.attempt(attempt.sequence, attempt.requestSha256, 'request.json')
    )
      failures.push(
        `attempt ${attempt.sequence} request identity or locator differs`
      )
    if (
      attempt.state !== 'pending' ||
      attempt.postHead !== null ||
      attempt.resultSha256 !== undefined ||
      attempt.refusalCode !== undefined
    )
      failures.push(
        `attempt ${attempt.sequence} request artifact is not the initial pending authority`
      )
    const indexed = indexedEntries.find(
      (candidate) =>
        candidate.namespaceSha256 === attempt.namespaceSha256 &&
        candidate.attemptSequence === attempt.sequence
    )
    if (!indexed || indexed.requestSha256 !== attempt.requestSha256)
      failures.push(
        `attempt ${attempt.sequence} is absent from the durable index`
      )
    else if (
      rebuiltRequestSha256 === attempt.requestSha256 &&
      requestBindingFailure === null
    )
    {
      if (byRequestSha256.has(attempt.requestSha256))
        failures.push(
          `attempt request ${attempt.requestSha256} has duplicate authority`
        )
      else
        byRequestSha256.set(attempt.requestSha256, {
          attempt,
          request: retained.request,
          transportRequest: retained.transportRequest,
          indexedState: indexed.state,
          invocationCorrelation: retained.invocationCorrelation,
        })
    }
    if (indexed && indexed.state !== 'pending')
    {
      const resultKey = requestEntry.key.replace(
        '/request.json',
        '/result.json'
      )
      try
      {
        const result = await readJson<{
          schemaVersion: 1
          result: unknown
        }>(store, resultKey)
        if (
          result.schemaVersion !== 1 ||
          editCanonicalSha256V1(result.result) !== indexed.resultSha256
        )
          failures.push(`attempt ${attempt.sequence} result hash differs`)
        else
        {
          const refusal =
            result.result !== null &&
            typeof result.result === 'object' &&
            'code' in result.result
              ? (result.result as { code?: unknown }).code
              : undefined
          if (
            (indexed.state === 'refused' && refusal !== indexed.refusalCode) ||
            (indexed.state === 'completed' && indexed.refusalCode !== undefined)
          )
            failures.push(
              `attempt ${attempt.sequence} result disposition differs from the durable index`
            )
          const authority = byRequestSha256.get(attempt.requestSha256)
          if (authority !== undefined)
            byRequestSha256.set(attempt.requestSha256, {
              ...authority,
              result: result.result,
            })
        }
      }
      catch (error)
      {
        failures.push(
          `attempt ${attempt.sequence} result is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
    else if (
      indexed &&
      entryKeys.has(requestEntry.key.replace('/request.json', '/result.json'))
    )
    {
      // the immutable result is written before the index CAS. Its presence for
      // a pending entry is exact recovery authority, not structural damage.
      try
      {
        const retainedResult = await readJson<{
          schemaVersion: 1
          result: unknown
        }>(store, requestEntry.key.replace('/request.json', '/result.json'))
        if (retainedResult.schemaVersion !== 1)
          failures.push(
            `pending attempt ${attempt.sequence} result schema differs`
          )
        else
        {
          const authority = byRequestSha256.get(attempt.requestSha256)
          if (authority !== undefined)
            byRequestSha256.set(attempt.requestSha256, {
              ...authority,
              result: retainedResult.result,
            })
        }
      }
      catch (error)
      {
        failures.push(
          `pending attempt ${attempt.sequence} result is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
  }
  return {
    count: requests.length,
    pendingCount: indexedEntries.filter((entry) => entry.state === 'pending')
      .length,
    byRequestSha256,
  }
}

export async function verifyEditSessionReplayV1(
  options: VerifyEditSessionReplayOptionsV1
): Promise<EditKernelReplayResultV1>
{
  const failures: string[] = []
  const layout = editSessionLayoutV1(options.sessionKey)
  const manifest = await readJson<EditKernelSessionManifestV1>(
    options.artifactStore,
    layout.session
  )
  const headPointer = await readJson<HeadPointerV1>(
    options.artifactStore,
    layout.head
  )
  const { revisions, entriesByRevision } = await headReachableRevisions(
    options.artifactStore,
    layout,
    headPointer,
    failures
  )
  if (revisions.length === 0)
    throw new Error('session has no head-reachable revision authority')
  const finalRecord = revisions.at(-1)!
  const finalEntry = entriesByRevision.get(
    revisionKey(finalRecord.head.revisionNumber, finalRecord.head.revisionId)
  )
  if (!finalEntry || finalEntry.sha256 !== headPointer.revisionManifestSha256)
    failures.push('head pointer has the wrong revision manifest hash')
  if (!sameHeadV1(headPointer.head, finalRecord.head))
    failures.push('head pointer and final reachable revision differ')

  const sourceBytes = await options.artifactStore.readImmutable(
    layout.sourceInput
  )
  if (sha256Hex(sourceBytes) !== manifest.sourceArtifactSha256)
    failures.push('retained source bytes do not match the session identity')
  const preflight = await inspectSemanticEditArtifact(sourceBytes)
  if (
    !preflight.ok ||
    !preflight.project ||
    !preflight.semanticSourceIdentity ||
    !preflight.admission
  )
    failures.push('retained source no longer passes strict edit admission')
  else
  {
    const sourceIdentity = expectedSemanticSourceIdentity(
      manifest,
      preflight.semanticSourceIdentity
    )
    if (!sameCanonical(sourceIdentity, manifest.semanticSourceIdentity))
      failures.push('retained semantic source identity does not reconstruct')
    if (
      semanticHashV1('semantic-source', sourceIdentity) !==
      manifest.semanticSourceSha256
    )
      failures.push('retained semantic source hash does not reconstruct')
    await verifyJsonArtifact(
      options.artifactStore,
      layout.sourceSemanticIdentity,
      {
        projection: manifest.semanticSourceIdentity,
        semanticSourceSha256: manifest.semanticSourceSha256,
      },
      failures,
      'source semantic identity evidence'
    )
    const lineage = buildSourceLineageV1(
      preflight.project,
      manifest.semanticSourceSha256
    )
    const sourceRecord = revisions[0]!
    const rebuiltSource = buildSourceRevisionV1(
      {
        semanticSourceSha256: manifest.semanticSourceSha256,
        sourceArtifactSha256: manifest.sourceArtifactSha256,
        changeContractSha256: manifest.changeContractSha256,
        capabilityProfileSha256: manifest.capabilityProfileSha256,
        capabilitySnapshotSha256: sourceRecord.head.capabilitySnapshotSha256,
        originatingRequestId: sourceRecord.revision.originatingRequestId,
        invocationCorrelation: sourceRecord.revision.invocationCorrelation,
        hostTimestampEpochMs:
          sourceRecord.revision.hostEvidenceTimestampEpochMs,
      },
      preflight,
      preflight.project.uids.snapshot(),
      lineage.active,
      lineage.history,
      sourceRecord.candidateKey,
      sourceRecord.manifestKey
    )
    rebuiltSource.capabilitySnapshot = sourceRecord.capabilitySnapshot
    if (!sameCanonical(rebuiltSource, sourceRecord))
      failures.push('revision zero does not reconstruct from retained source')
  }

  const retainedBound = await readJson<BoundChangeContractV1>(
    options.artifactStore,
    layout.boundChangeContract
  )
  if (
    sha256Hex(editCanonicalBytesV1(retainedBound)) !==
    manifest.boundChangeContractArtifactSha256
  )
    failures.push('retained bound change contract has the wrong artifact hash')
  if (!sameCanonical(retainedBound, options.boundChangeContract))
    failures.push('caller contract authority differs from retained authority')
  if (
    semanticHashV1(
      'change-contract',
      retainedBound.registration.semanticContract
    ) !== manifest.changeContractSha256
  )
    failures.push('retained semantic change contract has the wrong hash')
  const resolveOwnerLineageId = preflight.project
    ? existingBindingOwnerLineageResolverV1(
        preflight.project,
        retainedBound.registration.semanticContract,
        buildSourceLineageV1(preflight.project, manifest.semanticSourceSha256)
          .active
      )
    : () => undefined
  await verifyJsonArtifact(
    options.artifactStore,
    layout.changeContractRegistration,
    retainedBound.registration,
    failures,
    'change contract registration authority'
  )
  const profile = await readJson<SemanticEditCapabilityProfileEnvelopeV1>(
    options.artifactStore,
    layout.capabilityProfile
  )
  if (
    profile.capabilityProfileSha256 !== manifest.capabilityProfileSha256 ||
    semanticHashV1('capability-profile', profile.profile) !==
      manifest.capabilityProfileSha256 ||
    sha256Hex(editCanonicalBytesV1(profile)) !==
      manifest.capabilityProfileArtifactSha256
  )
    failures.push('retained capability profile authority has the wrong hash')

  const resolveAdmittedAsset = await retainedAssetResolver(
    options.artifactStore,
    layout,
    failures
  )

  for (const [index, record] of revisions.entries())
  {
    if (record.head.revisionNumber !== index)
      failures.push(`revision ${index} has a nonmonotonic revision number`)
    if (
      semanticHashV1('revision', record.revision.hashProjection) !==
      record.revision.revisionId
    )
      failures.push(`revision ${index} has the wrong semantic revision ID`)
    if (record.head.revisionId !== record.revision.revisionId)
      failures.push(`revision ${index} head and revision IDs differ`)
    if (
      record.candidateKey !==
        layout.revision(index, record.head.revisionId, 'candidate.sb3') ||
      record.manifestKey !==
        layout.revision(index, record.head.revisionId, 'manifest.json')
    )
      failures.push(`revision ${index} uses a noncanonical artifact locator`)
    const candidate = await options.artifactStore.readImmutable(
      record.candidateKey
    )
    if (sha256Hex(candidate) !== record.head.candidateSha256)
      failures.push(`revision ${index} candidate bytes have the wrong hash`)
    const candidatePreflight = await inspectSemanticEditArtifact(candidate)
    if (!candidatePreflight.ok || !candidatePreflight.semanticSourceIdentity)
      failures.push(`revision ${index} candidate no longer passes preflight`)
    else if (
      candidatePreflight.semanticSourceIdentity.projectJsonSha256 !==
        record.projectJsonSha256 ||
      candidatePreflight.semanticSourceIdentity.assetManifestSha256 !==
        record.head.assetManifestSha256
    )
      failures.push(`revision ${index} project or asset identity differs`)
    const priorAllocator =
      index === 0
        ? undefined
        : revisions[index - 1]!.revision.hashProjection
            .allocatorReservationStateSha256
    if (
      allocatorStateSha256V1(record.allocatorState, priorAllocator) !==
      record.revision.hashProjection.allocatorReservationStateSha256
    )
      failures.push(`revision ${index} allocator projection differs`)
    if (
      lineageSnapshotSha256V1(record.activeLineage) !==
        record.revision.hashProjection.activeLineageSnapshotSha256 ||
      lineageSnapshotSha256V1(record.lineageHistory) !==
        record.revision.hashProjection.lineageHistoryLedgerSha256
    )
      failures.push(`revision ${index} lineage projection differs`)
    if (
      editCanonicalSha256V1(record.authorization) !==
      record.revision.hashProjection.authorizationSha256
    )
      failures.push(`revision ${index} authorization projection differs`)
    try
    {
      validateFutureBindingLedgerV1(
        retainedFutureBindingLedgerV1(record.authorization),
        retainedBound.registration.semanticContract,
        record.lineageHistory as SemanticLineageSnapshot,
        resolveOwnerLineageId
      )
    }
    catch (error)
    {
      failures.push(
        `revision ${index} future-binding ledger differs: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    const snapshot = record.capabilitySnapshot as {
      capabilitySnapshotSha256?: string
      snapshot?: { hashProjection?: unknown }
    }
    if (
      snapshot.capabilitySnapshotSha256 !==
        record.head.capabilitySnapshotSha256 ||
      semanticHashV1(
        'capability-snapshot',
        snapshot.snapshot?.hashProjection
      ) !== record.head.capabilitySnapshotSha256
    )
      failures.push(`revision ${index} capability snapshot differs`)
    await verifyRevisionArtifacts(
      options.artifactStore,
      layout,
      record,
      failures
    )
    if (index === 0)
    {
      if (record.transitionDescriptor.kind !== 'sourceAdmission')
        failures.push('revision zero is not source admission')
      if (sha256Hex(candidate) !== sha256Hex(sourceBytes))
        failures.push('revision zero is not exact source bytes')
      continue
    }
    const predecessor = revisions[index - 1]!
    const predecessorIdentity = record.revision.hashProjection.predecessor
    if (
      predecessorIdentity.state !== 'present' ||
      predecessorIdentity.revisionNumber !== predecessor.head.revisionNumber ||
      predecessorIdentity.revisionId !== predecessor.head.revisionId
    )
      failures.push(`revision ${index} has the wrong predecessor`)
    if (record.transitionDescriptor.kind === 'apply')
    {
      const canonicalTransaction =
        record.transitionDescriptor.canonicalTransaction
      if (containsHandleReference(canonicalTransaction))
        failures.push(
          `revision ${index} apply replay authority contains a live handle`
        )
      else
        try
        {
          const history = historyProjectionV1(
            manifest.semanticSourceSha256,
            revisions.slice(0, index)
          )
          const reconstructed = await options.transactionExecutor.execute({
            sessionId: manifest.sessionId,
            sourceBytes,
            currentBytes: await options.artifactStore.readImmutable(
              predecessor.candidateKey
            ),
            semanticSourceSha256: manifest.semanticSourceSha256,
            semanticSourceIdentity: manifest.semanticSourceIdentity,
            sourceArtifactSha256: manifest.sourceArtifactSha256,
            currentHead: predecessor.head,
            currentRevision: predecessor,
            acceptedHistorySha256: history.sha256,
            changeContractSha256: manifest.changeContractSha256,
            changeContract: retainedBound.registration.semanticContract,
            resourceLimits: manifest.transactionResourceLimits,
            canonicalTransaction,
            resolveAdmittedAsset,
          })
          const rebuilt = buildAppliedRevisionV1(
            {
              semanticSourceSha256: manifest.semanticSourceSha256,
              sourceArtifactSha256: manifest.sourceArtifactSha256,
              changeContractSha256: manifest.changeContractSha256,
              capabilityProfileSha256: manifest.capabilityProfileSha256,
              capabilitySnapshotSha256: record.head.capabilitySnapshotSha256,
              originatingRequestId: record.revision.originatingRequestId,
              invocationCorrelation: record.revision.invocationCorrelation,
              hostTimestampEpochMs:
                record.revision.hostEvidenceTimestampEpochMs,
            },
            predecessor,
            reconstructed,
            record.candidateKey,
            record.manifestKey,
            reconstructed.candidateProjectJsonSha256,
            reconstructed.candidateAssetManifestSha256
          )
          rebuilt.capabilitySnapshot = record.capabilitySnapshot
          if (!sameCanonical(rebuilt, record))
            failures.push(`revision ${index} apply reconstruction differs`)
        }
        catch (error)
        {
          failures.push(
            `revision ${index} apply reconstruction failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
    }
    else if (
      record.transitionDescriptor.kind === 'undo' ||
      record.transitionDescriptor.kind === 'rollback'
    )
    {
      const descriptor = record.transitionDescriptor
      const selected = revisions
        .slice(0, index)
        .find(
          (candidateRecord) =>
            candidateRecord.head.revisionNumber ===
              descriptor.selectedRevision.revisionNumber &&
            candidateRecord.head.revisionId ===
              descriptor.selectedRevision.revisionId
        )
      if (!selected) failures.push(`revision ${index} restore target is absent`)
      else
      {
        const fromProject = await ProjectIR.fromSb3(
          await options.artifactStore.readImmutable(predecessor.candidateKey)
        )
        const selectedProject = await ProjectIR.fromSb3(
          await options.artifactStore.readImmutable(selected.candidateKey)
        )
        const restoreDeltaInput = {
          before: fromProject,
          after: selectedProject,
          beforeLineage: predecessor.activeLineage as SemanticLineageSnapshot,
          afterLineage: selected.activeLineage as SemanticLineageSnapshot,
          beforeRevisionIdentity: predecessor.head.revisionId,
          afterRevisionIdentity: selected.head.revisionId,
          semanticSourceSha256: manifest.semanticSourceSha256,
        }
        const unattributedRestoreDelta =
          computeLineageProjectDeltaV1(restoreDeltaInput)
        const restoreOccurrenceId = editRestoreOccurrenceIdV1(
          historyProjectionV1(
            manifest.semanticSourceSha256,
            revisions.slice(0, index)
          ).sha256,
          descriptor.kind,
          descriptor.restoreCommandSha256
        )
        const restoreDelta = computeLineageProjectDeltaV1({
          ...restoreDeltaInput,
          attribution: [
            singleOperationProjectDeltaAttributionV1(
              unattributedRestoreDelta,
              restoreOccurrenceId
            ),
          ],
        })
        const restoreLineageHistory = reconcileRestoreLineageHistoryV1(
          predecessor.lineageHistory as SemanticLineageSnapshot,
          selected.activeLineage as SemanticLineageSnapshot
        )
        const restoreFutureBindingLedger =
          reconcileRestoreFutureBindingLedgerV1(
            retainedFutureBindingLedgerV1(predecessor.authorization),
            retainedFutureBindingLedgerV1(selected.authorization),
            retainedBound.registration.semanticContract,
            restoreLineageHistory,
            resolveOwnerLineageId
          )
        const rebuilt = buildRestoreRevisionV1(
          {
            semanticSourceSha256: manifest.semanticSourceSha256,
            sourceArtifactSha256: manifest.sourceArtifactSha256,
            changeContractSha256: manifest.changeContractSha256,
            capabilityProfileSha256: manifest.capabilityProfileSha256,
            capabilitySnapshotSha256: record.head.capabilitySnapshotSha256,
            originatingRequestId: record.revision.originatingRequestId,
            invocationCorrelation: record.revision.invocationCorrelation,
            hostTimestampEpochMs: record.revision.hostEvidenceTimestampEpochMs,
          },
          predecessor,
          selected,
          descriptor.kind,
          descriptor.restoreCommandSha256,
          restoreDelta,
          predecessor.allocatorState,
          restoreLineageHistory,
          restoreFutureBindingLedger,
          record.candidateKey,
          record.manifestKey
        )
        rebuilt.capabilitySnapshot = record.capabilitySnapshot
        if (!sameCanonical(rebuilt, record))
          failures.push(`revision ${index} restore reconstruction differs`)
      }
    }
  }

  const eventEntries = (
    await options.artifactStore.listImmutable(`${layout.prefix}/events`)
  ).filter((entry) => entry.key.endsWith('.json'))
  const events = await Promise.all(
    eventEntries.map((entry) =>
      readJson<EditKernelSemanticEventV1>(options.artifactStore, entry.key)
    )
  )
  events.sort(
    (left, right) => left.projection.sequence - right.projection.sequence
  )
  let previousEventSha256: string | undefined
  for (const [index, event] of events.entries())
  {
    if (event.projection.sequence !== index)
      failures.push(`event ${index} has a nonmonotonic sequence`)
    if (event.projection.previousEventSha256 !== previousEventSha256)
      failures.push(`event ${index} breaks the event hash chain`)
    if (
      semanticHashV1('semantic-event', event.projection) !== event.eventSha256
    )
      failures.push(`event ${index} has the wrong semantic hash`)
    previousEventSha256 = event.eventSha256
  }
  const firstEvent = events[0]
  const terminalEvents = events.filter(
    (event) => event.projection.eventKind === 'session-closed'
  )
  if (
    terminalEvents.length > 1 ||
    (terminalEvents.length === 1 && terminalEvents[0] !== events.at(-1))
  )
    failures.push('session retains multiple or nonfinal terminal close events')
  if (
    !firstEvent ||
    firstEvent.projection.eventKind !== 'session-begun' ||
    firstEvent.projection.preHead.state !== 'absent' ||
    !sameCanonical(
      firstEvent.projection.postHead,
      exactRevisionFromHeadV1(revisions[0]!.head)
    )
  )
    failures.push('event zero does not bind revision-zero admission')
  for (const record of revisions.slice(1))
  {
    const predecessor = revisions[record.head.revisionNumber - 1]!
    const prepared = events.filter(
      (event) =>
        event.projection.eventKind === 'transition-prepared' &&
        event.projection.postHead.revisionId === record.head.revisionId
    )
    const committed = events.filter(
      (event) =>
        event.projection.eventKind === 'transition-committed' &&
        event.projection.postHead.revisionId === record.head.revisionId
    )
    if (prepared.length !== 1 || committed.length !== 1)
    {
      failures.push(
        `revision ${record.head.revisionNumber} lacks one prepared/committed event pair`
      )
      continue
    }
    if (
      !sameCanonical(prepared[0]!.projection.preHead, {
        state: 'present',
        head: exactRevisionFromHeadV1(predecessor.head),
      }) ||
      !sameCanonical(
        prepared[0]!.projection.postHead,
        exactRevisionFromHeadV1(record.head)
      ) ||
      prepared[0]!.projection.semanticPayloadSha256 !==
        editCanonicalSha256V1(record.revision.hashProjection)
    )
      failures.push(
        `revision ${record.head.revisionNumber} prepared event differs`
      )
    if (
      committed[0]!.projection.semanticPayloadSha256 !==
      editCanonicalSha256V1({
        revisionId: record.head.revisionId,
        preparedEventSha256: prepared[0]!.eventSha256,
      })
    )
      failures.push(
        `revision ${record.head.revisionNumber} committed event differs`
      )
  }

  const checkpointCount = await verifyCheckpoints(
    options.artifactStore,
    layout,
    revisions,
    events,
    failures
  )
  const attempts = await verifyAttempts(
    options.artifactStore,
    layout,
    manifest.sessionId,
    failures
  )
  await verifyRecordedStatefulEventsV1(
    options.artifactStore,
    layout,
    events,
    attempts,
    failures
  )
  // plan activation is the retained contract's own authority; if it refuses,
  // every certificate rebuild refuses w/ it rather than falling back
  let plans: ActivatedEvaluationPlanSetV1 | null = null
  try
  {
    plans = activateEvaluationPlanSetV1(
      retainedBound.registration.semanticContract,
      retainedBound.retainedPoliciesBySemanticSha256
    )
  }
  catch (error)
  {
    plans = null
    failures.push(
      `retained change contract no longer activates its evaluation plans: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  const evaluations = await verifyEvaluations(
    options.artifactStore,
    layout,
    manifest,
    revisions,
    plans,
    retainedBound,
    events,
    attempts,
    failures
  )
  const certificates = evaluations.certificates
  const reportVerification = await verifyReports(
    options.artifactStore,
    layout,
    manifest,
    revisions,
    certificates,
    failures
  )
  const exports = await verifyExports(
    options.artifactStore,
    layout,
    manifest,
    revisions,
    certificates,
    plans,
    events,
    attempts,
    reportVerification.reports,
    failures
  )
  // a published session closes w/ a session-closed event; one interrupted inside
  // the publication window has no such event but does retain a
  // recovery-required report, & replay has to be able to name both
  const current = reportVerification.current
  const closed = events.at(-1)?.projection.eventKind === 'session-closed'
  const terminalState: EditKernelReplayResultV1['state'] =
    current?.state === 'recovery-required' || evaluations.recoveryRequired
      ? 'recovery-required'
      : closed &&
          (current?.state === 'closed-unexported' ||
            current?.state === 'closed-abandoned' ||
            current?.state === 'closed-exported')
        ? current.state
        : 'interrupted'
  const history = historyProjectionV1(manifest.semanticSourceSha256, revisions)
  const report = semanticReportProjectionV1(
    manifest.semanticSourceSha256,
    manifest.changeContractSha256,
    manifest.capabilityProfileSha256,
    revisions,
    certificates.length === 0
      ? undefined
      : certificateSetProjectionV1(certificates).sha256
  )
  // the completeness audit runs only against the report the pointer currently
  // names; without one there is nothing whose completeness could be claimed
  const completeness: EditReportCompletenessResultV1 = current
    ? auditEditReportCompletenessV1(current, {
        revisionCount: revisions.length,
        attemptCount: reportCoveredAttemptCountV1(
          current,
          attempts,
          finalRecord.head
        ),
        checkpointCount,
        certificateCount: certificates.length,
        completedEvaluationCount: evaluations.completedCount,
        evaluationRecordedEventCount: events.filter(
          (event) => event.projection.eventKind === 'evaluation-recorded'
        ).length,
        exportAttemptCount: exports.attemptCount,
        publishedExportCount: exports.publishedCount,
        eventHeadSha256: events.at(-1)?.eventSha256 ?? '',
      })
    : Object.freeze({
        complete: false,
        omissions: Object.freeze(['no current report is retained to audit']),
      })
  const recoverableLifecycleFailureV1 = (failure: string): boolean =>
    /^evaluation [0-9]+ has an unmatched prepared quota reservation$/u.test(
      failure
    ) ||
    /^evaluation [0-9]+ quota outcome does not match its retained lifecycle$/u.test(
      failure
    ) ||
    /^evaluation [0-9]+ direct completion has no exact start-result authority$/u.test(
      failure
    ) ||
    /^evaluation [0-9]+ external completion has no exact finalize-result authority$/u.test(
      failure
    ) ||
    /^evaluation [0-9]+ awaiting record has no exact start-result authority$/u.test(
      failure
    ) ||
    /^evaluation [0-9]+ retains an incomplete external request chain$/u.test(
      failure
    ) ||
    /^evaluation [0-9]+ retains no .+; the certificate cannot be rebuilt$/u.test(
      failure
    ) ||
    /^evaluation lifecycle leaves event [0-9a-f]{64} orphaned$/u.test(
      failure
    ) ||
    /^revision [0-9]+ lacks one prepared\/committed event pair$/u.test(
      failure
    ) ||
    /^asset-admitted event [0-9a-f]{64} has no completed attempt authority$/u.test(
      failure
    ) ||
    /^export [0-9]+ has a receipt but retains no /u.test(failure) ||
    /^export [0-9]+ completed record disagrees with the rebuilt receipt$/u.test(
      failure
    )
  const recoverySafe = failures.every(recoverableLifecycleFailureV1)
  for (const omission of completeness.omissions) failures.push(omission)
  const unique = (values: readonly string[]): readonly string[] =>
    Object.freeze([...new Set(values)].sort())
  const eventHeadSha256 = events.at(-1)?.eventSha256 ?? ''
  return {
    ok: failures.length === 0,
    recoverySafe,
    sessionId: manifest.sessionId,
    state: terminalState,
    verifiedRevisionCount: revisions.length,
    verifiedEventCount: events.length,
    verifiedReportCount: reportVerification.count,
    verifiedPendingAttemptCount: attempts.pendingCount,
    verifiedCertificateCount: certificates.length,
    verifiedExportCount: exports.attemptCount,
    publishedSha256: exports.publishedSha256,
    exportReceiptSha256: exports.receiptSha256,
    reconstructedExternalObservations:
      evaluations.reconstructedExternalObservations,
    reportComplete: completeness.complete,
    finalHead: finalRecord.head,
    eventHeadSha256,
    historySha256: history.sha256,
    semanticReportSha256: report.sha256,
    terminalEvidence: Object.freeze({
      revisionSha256s: unique(
        revisions.map((entry) => entry.revision.revisionId)
      ),
      parentDeltaSha256s: unique(
        revisions.map(
          (entry) => entry.revision.hashProjection.parentChildDeltaSha256
        )
      ),
      cumulativeDeltaSha256s: unique(
        revisions.map(
          (entry) => entry.revision.hashProjection.sourceHeadDeltaSha256
        )
      ),
      preservationSha256s: unique(
        revisions.map(
          (entry) => entry.revision.hashProjection.preservationSha256
        )
      ),
      lineageSha256s: unique(
        revisions.flatMap((entry) => [
          entry.revision.hashProjection.activeLineageSnapshotSha256,
          entry.revision.hashProjection.lineageHistoryLedgerSha256,
        ])
      ),
      certificateSha256s: unique(
        certificates.map((entry) => entry.certificate.certificateSha256)
      ),
      reportProjectionSha256s: unique(
        reportVerification.reports.map(
          (entry) => entry.semanticProjectionSha256
        )
      ),
      exportReceiptSha256s: unique(
        exports.receiptSha256 === null ? [] : [exports.receiptSha256]
      ),
    }),
    failures,
  }
}
