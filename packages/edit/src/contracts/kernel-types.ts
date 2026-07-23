// packages/edit/src/contracts/kernel-types.ts
// immutable domain records for revision, preview, attempt, event, report, & replay authority

import type {
  BudgetProjectionV1,
  EditRevisionV1,
  EditSemanticEventHashProjectionV1,
  EditSemanticReportHashProjectionV1,
  EditSemanticSourceIdentityHashProjectionV1,
  ExactRevisionIdentityV1,
  HeadProjectionV1,
  InvocationCorrelationV1,
  OperationResultSummaryV1,
  RevisionTransitionAttributionV1,
} from '@scratch-agent/ir/edit'
import type { EditRuntimeProjectionAuthorizationsV1 } from '@scratch-agent/eval'

import type { EditSourceProvenanceV1 } from '../session/source-intake.js'

export type EditKernelStateV1 =
  | 'opening'
  | 'active'
  | 'recovery-required'
  | 'interrupted'
  | 'closed-abandoned'
  | 'closed-unexported'
  | 'closed-exported'
  | 'failed-infrastructure'

// the latest evaluation phase this session reached; distinct from the kernel
// state because an evaluation never moves the head
export type EditEvaluationStateV1 =
  | 'none'
  | 'unavailable'
  | 'awaitingExternalEvidence'
  | 'passed'
  | 'failed'
  | 'inconclusive'

export interface EditKernelPolicyV1
{
  activeSessionLimit: number
  acceptedRevisionLimit: number
  acceptedOperationLimit: number
  rejectedAttemptLimit: number
  retainedPreviewLimit: number
  checkpointLimit: number
  evaluationRunLimit: number
  artifactByteLimit: number
  idleLeaseMs: number
  absoluteLeaseMs: number
  restoreEnvelopeCount: 1
}

export interface EditTransactionResourceLimitsV1
{
  readonly activeMatchCandidates: number
  readonly describedBlockNodes: number
  readonly touchedBlockRecords: number
  readonly touchedTargets: number
  readonly touchedScripts: number
  readonly touchedDeclarations: number
  readonly touchedComments: number
  readonly touchedMedia: number
}

export const DEFAULT_EDIT_KERNEL_POLICY_V1: EditKernelPolicyV1 = Object.freeze({
  activeSessionLimit: 2,
  acceptedRevisionLimit: 16,
  acceptedOperationLimit: 256,
  rejectedAttemptLimit: 64,
  retainedPreviewLimit: 4,
  checkpointLimit: 16,
  evaluationRunLimit: 8,
  artifactByteLimit: 512 * 1024 * 1024,
  idleLeaseMs: 30 * 60 * 1000,
  absoluteLeaseMs: 2 * 60 * 60 * 1000,
  restoreEnvelopeCount: 1,
})

export interface EditKernelBudgetV1 extends BudgetProjectionV1
{
  acceptedOperations: number
  acceptedRevisions: number
  rejectedAttempts: number
  retainedPreviews: number
  checkpoints: number
}

export interface EditKernelRevisionRecordV1
{
  revision: EditRevisionV1
  head: HeadProjectionV1
  candidateKey: string
  manifestKey: string
  projectJsonSha256: string
  transitionDescriptor: EditKernelTransitionDescriptorV1
  allocatorState: unknown
  activeLineage: unknown
  lineageHistory: unknown
  parentDelta: unknown
  cumulativeDelta: unknown
  preservation: unknown
  authorization: unknown
  diagnostics: unknown
  operationResults: readonly unknown[]
  // in-memory contract projection of the same results; it is derived rather
  // than retained, so a cross-process replay rebuilds it from the transaction
  operationResultSummaries: readonly OperationResultSummaryV1[]
  runtimeProjectionAuthorizations: EditRuntimeProjectionAuthorizationsV1
  capabilitySnapshot: unknown
}

type EditKernelTransitionDescriptorV1 =
  | { kind: 'sourceAdmission'; semanticSourceSha256: string }
  | {
      kind: 'apply'
      canonicalTransaction: unknown
      resolvedPlanSha256: string
      resolvedSemanticBatchSha256: string
      operationCount: number
    }
  | {
      kind: 'undo' | 'rollback'
      fromRevision: ExactRevisionIdentityV1
      selectedRevision: ExactRevisionIdentityV1
      restoreCommandSha256: string
    }

export interface EditKernelPreviewV1
{
  previewId: string
  requestId: string
  requestSha256: string
  createdSequence: number
  expectedHead: HeadProjectionV1
  capabilitySnapshotSha256: string
  canonicalTransaction: unknown
  operationCount: number
  predictedCandidateSha256: string
  predictedCandidateByteLength: number
  predictedProjectJsonSha256: string
  predictedAssetManifestSha256: string
  resolvedSemanticBatchSha256: string
  resolvedPlanSha256: string
  deltaSha256: string
  cumulativeDeltaSha256: string
  preservationSha256: string
  authorizationSha256: string
  diagnosticsSha256: string
  allocatorSha256: string
  activeLineageSha256: string
  lineageHistorySha256: string
  operationResultSetSha256: string
  operationResultLineageCorrespondenceSha256: string
  applyGuardSha256: string
  operationResults: readonly unknown[]
  operationResultSummaries: readonly OperationResultSummaryV1[]
  candidateCacheKey: string
  state: 'unapplied' | 'applied' | 'invalidated' | 'evicted'
}

export interface EditKernelCheckpointV1
{
  checkpointId: string
  label: string
  note?: string
  revision: ExactRevisionIdentityV1
  eventSha256: string
  checkpointSha256: string
}

export interface EditKernelAttemptV1
{
  sequence: number
  attemptId: string
  toolName: string
  requestId: string
  requestSha256: string
  namespaceSha256: string
  state: 'pending' | 'completed' | 'refused' | 'abandoned'
  preHead: HeadProjectionV1 | null
  postHead: HeadProjectionV1 | null
  resultSha256?: string
  refusalCode?: string
}

export interface EditKernelSemanticEventV1
{
  projection: EditSemanticEventHashProjectionV1
  eventSha256: string
  hostTimestampEpochMs: number
}

export interface EditKernelReportV1
{
  semanticProjection: EditSemanticReportHashProjectionV1
  semanticProjectionSha256: string
  reportArtifactSha256: string
  reportSequence: number
  state: EditKernelStateV1
  budget: EditKernelBudgetV1
  eventHeadSha256: string
  revisionCount: number
  attemptCount: number
  checkpointCount: number
  previewCount: number
  // how many issued certificates entered this report's semantic projection; a
  // replay cannot rebuild that projection without it
  certificateCount: number
  evaluationState: EditEvaluationStateV1
  exportState: 'unavailable' | 'available' | 'exported'
  limitations: readonly string[]
  generatedAtEpochMs: number
}

export interface EditKernelSessionManifestV1
{
  schemaVersion: 1
  sessionId: string
  sessionKey: string
  state: EditKernelStateV1
  semanticSourceIdentity: EditSemanticSourceIdentityHashProjectionV1
  semanticSourceSha256: string
  sourceArtifactSha256: string
  sourceProvenanceEvidenceSha256: string
  provenance: EditSourceProvenanceV1
  changeContractRegistrationId: string
  changeContractSha256: string
  capabilityProfileSha256: string
  capabilityProfileArtifactSha256: string
  changeContractRegistrationArtifactSha256: string
  boundChangeContractArtifactSha256: string
  transactionResourceLimits: EditTransactionResourceLimitsV1
  invocationCorrelation: InvocationCorrelationV1
  openedAtEpochMs: number
  idleDeadlineEpochMs: number
  absoluteDeadlineEpochMs: number
}

export interface EditKernelReplayResultV1
{
  ok: boolean
  // structural/hash authority can be sound even when a crash left only the
  // current report pointer stale; exclusive recovery may repair only that case
  recoverySafe: boolean
  sessionId: string
  // * widened w/ the publication states: a replay that cannot name
  // * closed-exported or recovery-required cannot prove an export at all
  state:
    | 'interrupted'
    | 'recovery-required'
    | 'closed-abandoned'
    | 'closed-unexported'
    | 'closed-exported'
  verifiedRevisionCount: number
  verifiedEventCount: number
  verifiedReportCount: number
  verifiedPendingAttemptCount: number
  // certificates & publications rebuilt from retained artifacts alone
  verifiedCertificateCount: number
  verifiedExportCount: number
  publishedSha256: string | null
  exportReceiptSha256: string | null
  // how many agent-produced external observations replay reproduced without
  // running an agent; the zero-agent claim is empty if this is never counted
  reconstructedExternalObservations: number
  reportComplete: boolean
  finalHead: HeadProjectionV1
  eventHeadSha256: string
  historySha256: string
  semanticReportSha256: string
  terminalEvidence: {
    readonly revisionSha256s: readonly string[]
    readonly parentDeltaSha256s: readonly string[]
    readonly cumulativeDeltaSha256s: readonly string[]
    readonly preservationSha256s: readonly string[]
    readonly lineageSha256s: readonly string[]
    readonly certificateSha256s: readonly string[]
    readonly reportProjectionSha256s: readonly string[]
    readonly exportReceiptSha256s: readonly string[]
  }
  failures: readonly string[]
}

export interface EditKernelTransactionResultV1
{
  candidateBytes: Uint8Array
  candidateProjectJsonSha256: string
  candidateAssetManifestSha256: string
  canonicalTransaction: unknown
  operationCount: number
  transition: Extract<
    RevisionTransitionAttributionV1,
    { transitionKind: 'apply' }
  >
  resolvedSemanticBatchSha256: string
  resolvedPlanSha256: string
  parentDelta: unknown
  cumulativeDelta: unknown
  preservation: unknown
  authorization: unknown
  diagnostics: unknown
  allocatorState: unknown
  activeLineage: unknown
  lineageHistory: unknown
  operationResults: readonly unknown[]
  // the contract-shaped projection of the same results, which is what a tool
  // answers w/; the raw records above stay the hashed kernel evidence
  operationResultSummaries: readonly OperationResultSummaryV1[]
  runtimeProjectionAuthorizations: EditRuntimeProjectionAuthorizationsV1
  operationResultLineageCorrespondenceSha256: string
}
