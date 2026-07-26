// packages/edit/src/session/session.ts
// immutable edit-session lifecycle, preview/apply, restore, idempotency, reports, & close

import {
  aggregateAllowedChangeV1,
  aggregatePreservationV1,
  aggregateRequiredChangeV1,
  editEvidenceContentCollectionV1,
  inspectSemanticEditArtifact,
  reserveEditEvaluationMatrixV1,
  validateEditProductionEvaluationExecutionV1,
  type EditCandidateObservationV1,
  type EditLaneStatusV1,
  type EditStructuralObjectiveObservationV1,
} from '@scratch-agent/eval'
import { ProjectIR, type ProjectDelta } from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  assessDeclarationCapabilitiesV1,
  assessMediaOperationCapabilitiesV1,
  assessProcedureCapabilitiesV1,
  assessTargetOperationCapabilitiesV1,
  blockBoundedLocationProjectionV1,
  blockEntityEvidenceSetV1,
  commentBoundedLocationProjectionV1,
  commentEntityEvidenceSetV1,
  declarationBoundedLocationProjectionV1,
  declarationEntityEvidenceSetV1,
  DEFAULT_PHASE_8_RESOURCE_POLICY,
  EntityResolutionError,
  inspectSemanticEditBatchV1,
  mediaBoundedLocationProjectionV1,
  mediaRecordEntityEvidenceSetV1,
  parameterEntityEvidenceSetV1,
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  procedureEntityEvidenceSetV1,
  unknownNameSemanticsEvidenceV1,
  REFUSAL_CODES,
  resolveMediaRefV1,
  VANILLA_CORE_DESCRIPTORS,
  semanticHashV1,
  scriptBoundedLocationProjectionV1,
  scriptEntityEvidenceSetV1,
  targetBoundedLocationProjectionV1,
  targetEntityEvidenceSetV1,
  validateSemanticLineageSnapshot,
  type BoundedBlockLocationProjectionV1,
  type BoundedCommentLocationProjectionV1,
  type BoundedDeclarationLocationProjectionV1,
  type BoundedDisplayStringV1,
  type BoundedMediaLocationProjectionV1,
  type BoundedParameterLocationProjectionV1,
  type BoundedProcedureLocationProjectionV1,
  type BoundedScriptLocationProjectionV1,
  type BoundedTargetLocationProjectionV1,
  type BoundedTopLevelPrimitiveLocationProjectionV1,
  type OperationPlanningBindingHeadV1,
  type OperationPlanningQueryV1,
  type OperationResultSummaryV1,
  type ProvisionalObligationSetV1,
  type ProvisionalObligationV1,
  type EditApplyRequestV1,
  type EditAssetAdmitRequestV1,
  type EditBeginRequestV1,
  type EditCheckpointRequestV1,
  type EditCloseRequestV1,
  type EditEvaluateRequestV1,
  type EditExportRequestV1,
  type EditLimitKeyV1,
  type EditPreviewRequestV1,
  type EditRollbackRequestV1,
  type EditSemanticChangeContractV1,
  type EditToolName,
  type EditUndoRequestV1,
  type EvidenceContentHashCollectionV1,
  type ExistingOptionalNumberV1,
  type ExactRevisionIdentityV1,
  type HeadProjectionV1,
  type InvocationCorrelationV1,
  type RefusalContextV1,
  type RunnerAvailabilityV1,
  type SemanticEditCapabilityProfileEnvelopeV1,
  type SemanticEditCapabilitySnapshotEnvelopeV1,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
  type StandaloneMediaRefV1,
} from '@scratch-agent/ir/edit'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import {
  EditAssetAdmissionErrorV1,
  EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1,
  editAssetAdmissionEvidenceIdV1,
  retainedEditAssetRecordV1,
  SessionAssetStoreV1,
  type AdmittedEditAssetResolverV1,
  type AssetMaterializationUsageDeltaV1,
  type AssetMaterializationLedgerV1,
  type PreparedSessionAssetAdmissionV1,
  type SessionAssetRecordV1,
} from '../assets/asset-admission.js'
import {
  buildEditCapabilitySnapshotV1,
  buildGroupGCapabilityProfileV1,
  EDIT_EVALUATION_RUNNER_LANES_V1,
  validatedRunnerAvailabilityV1,
  type MediaTargetCapabilityProfileInputV1,
} from '../contracts/capabilities.js'
import {
  type BoundChangeContractV1,
  type ChangeContractSourceBindingV1,
  type EditChangeContractRegistryV1,
  type ExistingContractBindingResolutionV1,
  type RegisteredChangeContractV1,
} from '../contracts/change-contracts.js'
import {
  editCanonicalBytesV1,
  editCanonicalSha256V1,
  editOpaqueIdV1,
  exactRevisionFromHeadV1,
  sameHeadV1,
} from '../support/canonical.js'
import {
  editRestoreOccurrenceIdV1,
  singleOperationProjectDeltaAttributionV1,
} from '../lineage/cumulative-attribution.js'
import {
  buildEditEvaluationCertificateV1,
  certificateSetProjectionV1,
  certificateStandingV1,
  evaluateExportabilityV1,
  type EditExportabilityV1,
  type EditRetainedCertificateV1,
} from '../evaluation/evaluation-certificate.js'
import {
  activateEvaluationPlanSetV1,
  EditEvaluationPlanErrorV1,
  type ActivatedEvaluationPlanSetV1,
  type ActivatedEvaluationPlanV1,
} from '../evaluation/evaluation-plans.js'
import {
  assertExternalEvidenceDeadlineV1,
  EXTERNAL_EVIDENCE_DEADLINE_DEFAULT_MS,
  editExternalEvidenceRequiredGateSha256V1,
  editExternalEvidenceRequestSemanticProjectionV1,
  editStagedExternalEvidenceResultSha256V1,
  evaluationProvenanceChainSha256V1,
  type EditDeterministicEvaluationResultV1,
  type EditEvaluationEvidenceEntryV1,
  type EditEvaluationEvidenceProvenanceV1,
  type EditEvaluationPortsV1,
  type EditStagedExternalEvidenceRecordV1,
} from '../evaluation/evaluation-ports.js'
import { structuralObjectiveObservationsV1 } from '../evaluation/evaluation-structural.js'
import {
  existingBindingOwnerLineageResolverV1,
  reconcileRestoreFutureBindingLedgerV1,
  type FutureBindingLedgerV1,
} from '../lineage/future-binding-ledger.js'
import {
  buildEditDiagnosticLineageTablesV1,
  buildEditRuntimeBindingTableV1,
  buildEditRuntimeLineageAssignmentV1,
} from '../evaluation/runtime-evaluation-context.js'
import { immutableEditRuntimeProjectionAuthorizationsV1 } from '../evaluation/runtime-projection-authority.js'
import {
  issueEditHandleV1,
  verifyEditHandleV1,
  type EditHandleBindingV1,
} from './handles.js'
import {
  DEFAULT_EDIT_KERNEL_POLICY_V1,
  type EditKernelAttemptV1,
  type EditEvaluationStateV1,
  type EditKernelBudgetV1,
  type EditKernelCheckpointV1,
  type EditKernelPolicyV1,
  type EditKernelPreviewV1,
  type EditKernelReportV1,
  type EditKernelRevisionRecordV1,
  type EditKernelSemanticEventV1,
  type EditKernelSessionManifestV1,
  type EditKernelStateV1,
  type EditKernelTransactionResultV1,
} from '../contracts/kernel-types.js'
import { editSessionLayoutV1, type EditSessionLayoutV1 } from './layout.js'
import {
  assertExportDestinationAllowedV1,
  assertOutputBasenameAllowedV1,
  deniedDestinationSetSha256V1,
  editExportGateSha256V1,
  editExportPreparedProofSha256V1,
  editExportProvenanceSha256V1,
  editExportReopenSha256V1,
  editExportSourcePreservationSha256V1,
  editPublicationProofSha256V1,
  editSemanticExportReceiptSha256V1,
  EditPublicationDenialError,
  EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
  isEditPublicationCapabilityReadyV1,
  isPreparedPublicationBoundV1,
  isPublicationCommitBoundV1,
  isPublicationDestinationBoundV1,
  isPublicationInspectionBoundV1,
  isPublicationReservationBoundV1,
  isPublicationVerificationBoundV1,
  samePublicationDirectoryIdentityV1,
  type EditExportProvenanceV1,
  type EditExportReopenEvidenceV1,
  type EditSemanticExportReceiptV1,
} from '../assets/publication.js'
import { resolvePlannedNextIntentV1 } from '../transaction/planning.js'
import {
  buildSourceLineageV1,
  reconcileRestoreLineageHistoryV1,
} from '../lineage/lineage.js'
import { computeLineageProjectDeltaV1 } from '../lineage/lineage-delta.js'
import { isEditPublicationErrorV1 } from '../transaction/ports.js'
import type {
  EditArtifactIdentityV1,
  EditArtifactStorePort,
  EditAssetInputReadV1,
  EditClockPort,
  EditEntropyPort,
  EditPublicationCapabilityV1,
  EditPublicationCommitV1,
  EditPublicationNameInspectionV1,
  EditPublicationPort,
  EditPublicationPreparedV1,
  EditPublicationReservationV1,
  EditPublicationVerificationV1,
  EditRetainedResourceCataloguePortV1,
  EditRetainedResourceMimeTypeV1,
  HostInvocationContextV1,
} from '../transaction/ports.js'
import { retainedStatefulRequestBindingFailureV1 } from './retained-request-authority.js'
import { assertFrozenRefusalResultV1 } from '../contracts/refusal-context.js'
import {
  buildAppliedRevisionV1,
  buildRestoreRevisionV1,
  buildSourceRevisionV1,
  historyProjectionV1,
  semanticReportProjectionV1,
} from './revision.js'
import {
  sourceProvenanceEvidenceSha256V1,
  validateEditSourceIntakeV1,
  type EditSourceIntakeRecheckV1,
  type EditSourceIntakeV1,
  type EditSourceProvenanceV1,
} from './source-intake.js'
import {
  ProductionTransactionErrorV1,
  type ProductionStaticRegressionEvidenceV1,
} from '../transaction/production-transaction.js'
import {
  UnavailableEditTransactionExecutorV1,
  type EditOperationPlanningChoiceSlotV1,
  type EditOperationPlanningResultV1,
  type EditTransactionExecutorV1,
  type EditTransactionExecutionPlanV1,
  type EditTransactionInputV1,
} from '../transaction/transaction.js'

function retainedFutureBindingLedgerV1(value: unknown): FutureBindingLedgerV1
{
  if (value === null || typeof value !== 'object')
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'revision authorization is absent'
    )
  const ledger = (value as Record<string, unknown>)['futureBindingLedger']
  if (ledger === null || typeof ledger !== 'object')
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'revision future-binding ledger is absent'
    )
  return ledger as FutureBindingLedgerV1
}

const ZERO_SHA256 = '0'.repeat(64)

function findLatestV1<T>(
  values: readonly T[],
  predicate: (value: T) => boolean
): T | undefined
{
  for (let index = values.length - 1; index >= 0; index -= 1)
  {
    const value = values[index]!
    if (predicate(value)) return value
  }
  return undefined
}

const EDIT_SESSION_ERROR_CODES = new Set<string>(REFUSAL_CODES)
const RETAINED_RESOURCE_MIME_TYPES = new Set<EditRetainedResourceMimeTypeV1>([
  'application/json',
  'application/x.scratch.sb3',
  'audio/wav',
  'image/png',
  'text/markdown; charset=utf-8',
  'video/webm',
])

function exactRetainedResourceMimeTypeV1(
  value: string
): EditRetainedResourceMimeTypeV1
{
  if (RETAINED_RESOURCE_MIME_TYPES.has(value as EditRetainedResourceMimeTypeV1))
    return value as EditRetainedResourceMimeTypeV1
  throw new EditSessionErrorV1(
    'edit.internal_invariant',
    'evaluation evidence declared an unsupported retained resource media type'
  )
}

type EditSessionErrorCodeV1 = (typeof REFUSAL_CODES)[number]

export class EditSessionErrorV1 extends Error
{
  constructor(
    readonly code: EditSessionErrorCodeV1,
    message: string,
    readonly committed = false,
    readonly context: RefusalContextV1 = {}
  )
  {
    super(message)
    this.name = 'EditSessionErrorV1'
  }
}

export interface EditSessionRegistryIdentityV1
{
  realmSha256: string
  profileSha256: string
  pinnedScratchRuntimeSourceSha256: string
  retentionPolicySha256: string
  policyConfigVersion: number
}

export interface EditSessionRegistryOptionsV1
{
  artifactStore: EditArtifactStorePort
  // production hosts inject this authority; absent keeps the edit kernel usable
  // in isolated domain tests without claiming MCP resource availability
  resourceCatalogue?: EditRetainedResourceCataloguePortV1
  changeContracts: EditChangeContractRegistryV1
  identity: EditSessionRegistryIdentityV1
  clock: EditClockPort
  entropy: EditEntropyPort
  handleSecret: Uint8Array
  policy?: Partial<EditKernelPolicyV1>
  // absent means evaluation reports unavailable; the kernel never constructs a
  // lane runner or an evidence producer itself
  evaluationPorts?: EditEvaluationPortsV1
  // absent means export reports publicationUnavailable; the kernel never opens a
  // filesystem path itself
  publicationPort?: EditPublicationPort
}

export interface EditBeginDomainResultV1
{
  sessionId: string
  state: 'active'
  head: HeadProjectionV1
  semanticSourceSha256: string
  changeContractSha256: string
  capabilityProfileSha256: string
  sourceProvenanceEvidenceSha256: string
  eventSha256: string
  reportSha256: string
}

export interface EditBeginSourceIdentityV1
{
  readonly provenance: EditSourceProvenanceV1
  readonly expectedArtifactSha256: string
}

export interface EditBeginOpeningRefusalV1
{
  readonly code: 'edit.source_identity_mismatch' | 'edit.source_not_editable'
  readonly safeMessage: string
  readonly context: RefusalContextV1
}

export type RetainedEditBeginOpeningSessionV1 =
  | { readonly state: 'absent' }
  | {
      readonly state: 'present'
      readonly sessionId: string
      readonly sessionKey: string
    }

export interface RetainedEditBeginAttemptAuthorityV1
{
  readonly schemaVersion: 1
  readonly kind: 'retained-edit-begin-attempt-authority-v1'
  readonly attemptId: string
  readonly attemptSequence: number
  readonly namespaceSha256: string
  readonly beginNamespaceSha256: string
  readonly requestSha256: string
  readonly request: EditBeginRequestV1
  readonly registryIdentity: {
    readonly realmSha256: string
    readonly profileSha256: string
    readonly principalSha256: string
  }
  readonly sourceIdentity: {
    readonly expectedArtifactSha256: string
    readonly provenance: EditSourceProvenanceV1
    readonly provenanceEvidenceSha256: string
    readonly sourceBinding: ChangeContractSourceBindingV1
  }
  readonly invocationCorrelation: InvocationCorrelationV1
}

export interface RetainedEditBeginOutcomeAuthorityV1
{
  readonly schemaVersion: 1
  readonly kind: 'retained-edit-begin-outcome-authority-v1'
  readonly attemptId: string
  readonly attemptSequence: number
  readonly registryAttemptSha256: string
  readonly namespaceSha256: string
  readonly beginNamespaceSha256: string
  readonly requestSha256: string
  readonly invocationCorrelation: InvocationCorrelationV1
  readonly disposition: 'completed' | 'refused'
  readonly result: unknown
  readonly resultSha256: string
  readonly openingSession: RetainedEditBeginOpeningSessionV1
  readonly preHead: null
  readonly postHead: HeadProjectionV1 | null
  readonly budget: EditKernelBudgetV1
  readonly events: readonly {
    readonly eventSha256: string
    readonly sequence: number
  }[]
  readonly evidenceIds: readonly string[]
}

export type EditTransportOutcomeTargetV1 =
  | {
      readonly kind: 'session'
      readonly sessionKey: string
      readonly toolName: EditToolName
      readonly disposition: 'completed' | 'refused'
      readonly attemptId: string
      readonly attemptSequence: number
      readonly requestId: string
      readonly requestSha256: string
      readonly sessionId: string
      readonly namespaceSha256: string
      readonly invocationCorrelation: InvocationCorrelationV1
    }
  | {
      readonly kind: 'registryBegin'
      readonly toolName: 'edit_begin'
      readonly disposition: 'completed' | 'refused'
      readonly attemptId: string
      readonly attemptSequence: number
      readonly requestId: string
      readonly requestSha256: string
      readonly sessionId: string | null
      readonly namespaceSha256: string
      readonly invocationCorrelation: InvocationCorrelationV1
    }

// the ref -> bytes step for the `sourceMedia` arm belongs to the caller; the
// session never resolves semantic refs itself, so both arms arrive as payloads
export type EditAssetAdmitDomainSourceV1 =
  | {
      readonly kind: 'inputFile'
      readonly mediaKind: 'costume' | 'sound'
      readonly read: EditAssetInputReadV1
      readonly expectedByteLength: number
      readonly expectedPayloadSha256: string
    }
  | {
      readonly kind: 'sourceMedia'
      readonly mediaKind: 'costume' | 'sound'
      readonly media?: StandaloneMediaRefV1
      readonly bytes: Uint8Array
      readonly expectedPayloadSha256: string
    }

export interface EditAssetAdmitDomainRequestV1
{
  requestId: string
  expectedHead: HeadProjectionV1
  source: EditAssetAdmitDomainSourceV1
  transportRequest?: EditAssetAdmitRequestV1
}

export interface EditAssetAdmitDomainResultV1
{
  assetToken: string
  admissionEvidenceId: string
  mediaKind: 'costume' | 'sound'
  payloadSha256: string
  metadataSha256: string
  byteLength: number
  dataFormat: 'png' | 'wav'
  payloadKey: string
  recordKey: string
  ledger: AssetMaterializationLedgerV1
  budget: EditKernelBudgetV1
  eventSha256: string
}

interface EditPreviewDomainRequestV1
{
  requestId: string
  expectedHead: HeadProjectionV1
  canonicalTransaction: unknown
  transportRequest?: EditPreviewRequestV1
}

interface EditPreviewDomainResultV1
{
  preview: EditKernelPreviewV1
  budget: EditKernelBudgetV1
  eventSha256: string
}

export interface EditApplyDomainResultV1
{
  head: HeadProjectionV1
  revisionId: string
  deltaSha256: string
  preservationSha256: string
  lineageSha256: string
  operationResultSetSha256: string
  preparedEventSha256: string
  committedEventSha256: string
  reportSha256: string
  operationResults: readonly unknown[]
  operationResultSummaries: readonly OperationResultSummaryV1[]
  budget: EditKernelBudgetV1
}

export interface EditRestoreDomainResultV1
{
  head: HeadProjectionV1
  restoreKind: 'undo' | 'rollback'
  fromRevision: HeadProjectionV1
  selectedRevision: HeadProjectionV1
  restoreDeltaSha256: string
  preparedEventSha256: string
  committedEventSha256: string
  reportSha256: string
  budget: EditKernelBudgetV1
}

type EditRestoreRequestV1 =
  | readonly [restoreKind: 'undo', request: EditUndoRequestV1]
  | readonly [restoreKind: 'rollback', request: EditRollbackRequestV1]

interface EditInspectDomainItemBaseV1
{
  semanticLocationSha256: string
  semanticFingerprintSha256: string
  contextFingerprintSha256: string
  handle?: string
}

interface EditInspectTargetDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'target'
  entitySubtype: 'stage' | 'sprite'
  location: BoundedTargetLocationProjectionV1
  serializedTargetOrdinal: number
  visualLayerOrdinal?: number
}

interface EditInspectDeclarationDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'declaration'
  entitySubtype: 'variable' | 'list' | 'broadcast'
  location: BoundedDeclarationLocationProjectionV1
  declarationKind: 'variable' | 'list' | 'broadcast'
  cloud?: boolean
}

interface EditInspectScriptDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'script'
  entitySubtype: 'unspecialized'
  location: BoundedScriptLocationProjectionV1
  rootRole: 'eventHat' | 'statement' | 'expression' | 'procedureDefinition'
  category: string | null
}

interface EditInspectBlockDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'block'
  entitySubtype: 'unspecialized'
  location: BoundedBlockLocationProjectionV1
  ownershipStatus: BoundedBlockLocationProjectionV1['ownershipStatus']
  category: string | null
}

interface EditInspectCommentDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'comment'
  entitySubtype: 'unspecialized'
  location: BoundedCommentLocationProjectionV1
  topologyStatus: 'consistent' | 'inconsistent'
  attachmentStatus: 'attached' | 'detached'
}

interface EditInspectTopLevelPrimitiveDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'topLevelPrimitive'
  entitySubtype: 'variableReporter' | 'listReporter'
  location: BoundedTopLevelPrimitiveLocationProjectionV1
}

interface EditInspectProcedureDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'procedure'
  entitySubtype: 'unspecialized'
  location: BoundedProcedureLocationProjectionV1
}

interface EditInspectParameterDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'parameter'
  entitySubtype: 'unspecialized'
  location: BoundedParameterLocationProjectionV1
}

interface EditInspectMediaDomainItemV1 extends EditInspectDomainItemBaseV1
{
  entityKind: 'media'
  entitySubtype: 'costume' | 'sound'
  location: BoundedMediaLocationProjectionV1
}

export type EditInspectDomainItemV1 =
  | EditInspectTargetDomainItemV1
  | EditInspectDeclarationDomainItemV1
  | EditInspectScriptDomainItemV1
  | EditInspectBlockDomainItemV1
  | EditInspectTopLevelPrimitiveDomainItemV1
  | EditInspectProcedureDomainItemV1
  | EditInspectParameterDomainItemV1
  | EditInspectCommentDomainItemV1
  | EditInspectMediaDomainItemV1

export interface EditInspectDomainResultV1
{
  revision: HeadProjectionV1
  items: readonly EditInspectDomainItemV1[]
  handlesIssued: boolean
  querySha256: string
}

type EditEvaluatePhaseV1 =
  | 'completed'
  | 'failed'
  | 'inconclusive'
  | 'unavailable'
  | 'awaitingExternalEvidence'

type EditEvaluateCertificateProjectionV1 =
  | { state: 'absent' }
  | {
      state: 'present'
      certificateSha256: string
      status: 'passed' | 'failed' | 'inconclusive' | 'unavailable'
    }

type EditEvaluateRequiredHostActionV1 =
  | { kind: 'none' }
  | {
      kind: 'configureEvidenceProducer'
      limitationCode:
        'edit.pending_external_evidence' | 'edit.evaluation_unavailable'
    }
  | {
      kind: 'stageExternalEvidence'
      evaluationId: string
      requestArtifactIds: readonly string[]
      requestSetSha256: string
      deadlineSha256: string
      notificationSha256: string
    }

export interface EditEvaluateDomainResultV1
{
  evaluationId: string
  phase: EditEvaluatePhaseV1
  evaluatedRevision: ExactRevisionIdentityV1
  evaluationAttemptSha256: string
  certificate: EditEvaluateCertificateProjectionV1
  evidenceContent: EvidenceContentHashCollectionV1
  requiredHostAction: EditEvaluateRequiredHostActionV1
  eventSha256: string
  reportSha256: string
}

interface EditAwaitingEvaluationStatusV1
{
  evaluationId: string
  evaluationAttemptSha256: string
  evaluatedRevision: ExactRevisionIdentityV1
  requestArtifactIds: readonly string[]
  requestSetSha256: string
  deadlineSha256: string
  notificationSha256: string
  requiredHostAction: Extract<
    EditEvaluateRequiredHostActionV1,
    { kind: 'stageExternalEvidence' }
  >
}

// mirrors the frozen EditExportSuccessDataV1 minus its transport `identity`,
// which the Group H adapter builds; the domain never mints a response identity
export interface EditExportDomainResultV1
{
  terminalState: 'closed-exported'
  exportedRevision: ExactRevisionIdentityV1
  certificateSha256: string
  outputReservationId: string
  outputReservationSha256: string
  publicationEvidenceId: string
  publicationProofSha256: string
  publishedByteLength: number
  publishedSha256: string
  reopenSha256: string
  sourcePreservationSha256: string
  eventSha256: string
  reportSha256: string
  // retained internally for terminal evidence; transports omit this field from
  // the frozen edit_export success projection
  receiptSha256: string
}

// what a read-only idempotency lookup may disclose: enough to re-find a lost
// outcome, never the retained payload itself
export interface EditIdempotentOutcomeProjectionV1
{
  readonly namespaceSha256: string
  readonly requestSha256: string
  readonly classification: 'pending' | 'completed' | 'refused' | 'abandoned'
  readonly attemptId: string
  readonly attemptSequence: number
  readonly toolName: string
  readonly requestId: string
  readonly sessionId: string | null
  readonly preHead: HeadProjectionV1 | null
  readonly postHead: HeadProjectionV1 | null
  readonly retainedOutcomeSha256: string | null
  readonly refusalCode: string | null
}

export interface EditStatusDomainResultV1
{
  sessionId: string
  state: EditKernelStateV1
  head: HeadProjectionV1
  busyKind: string | null
  evaluationState: EditEvaluationStateV1
  exportState: 'unavailable' | 'available' | 'exported'
  exportReady: boolean
  exportability: EditExportabilityV1
  budget: EditKernelBudgetV1
  eventHeadSha256: string
  reportSha256: string
  handleEpoch: number
  capabilityProfileSha256: string
  capabilitySnapshotSha256: string
  awaitingEvaluations: readonly EditAwaitingEvaluationStatusV1[]
}

export interface EditRetainedOutcomeFactsV1
{
  readonly outcome: EditIdempotentOutcomeProjectionV1
  readonly result: unknown
  readonly budget: EditKernelBudgetV1
  readonly event: {
    readonly eventSha256: string
    readonly sequence: number
    readonly invocationCorrelation: InvocationCorrelationV1
  } | null
  readonly evidenceIds: readonly string[]
}

export interface EditRetainedCapabilityFactsV1
{
  readonly profile: SemanticEditCapabilityProfileEnvelopeV1
  readonly snapshot: SemanticEditCapabilitySnapshotEnvelopeV1
  readonly head: HeadProjectionV1
  readonly effectiveLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly evidenceIds: readonly string[]
}

export type EditRetainedCollectionKindV1 =
  | 'history'
  | 'diff'
  | 'attempts'
  | 'previews'
  | 'checkpoints'
  | 'evaluations'
  | 'artifacts'
  | 'exports'
  | 'operationResults'

export interface EditRetainedCollectionFactsV1
{
  readonly kind: EditRetainedCollectionKindV1
  readonly collectionSha256: string
  readonly items: readonly unknown[]
}

export interface EditRetainedStatusFactsV1
{
  readonly latestReport: EditKernelReportV1
  readonly eventHead: EditKernelSemanticEventV1
  readonly exportability: EditExportabilityV1
  readonly evidenceIds: readonly string[]
}

export interface EditSessionTerminalEvidenceV1
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

export interface EditRetainedInspectionFactsV1 extends EditInspectDomainResultV1
{
  readonly collections: Readonly<
    Record<EditRetainedCollectionKindV1, EditRetainedCollectionFactsV1>
  >
}

export interface EditRetainedOperationPlanningFactsV1
{
  readonly binding: OperationPlanningBindingHeadV1
  readonly completion: EditOperationPlanningResultV1 | null
  readonly choiceSlots: readonly EditOperationPlanningChoiceSlotV1[]
}

function provisionalObligationSetV1(
  operations: readonly {
    readonly kind: string
    readonly opId: string
    readonly target?: unknown
  }[]
): ProvisionalObligationSetV1
{
  const ordered: ProvisionalObligationV1[] = []
  for (const operation of operations)
  {
    if (operation.kind === 'target.addSprite')
    {
      ordered.push({
        obligationKind: 'firstCostumeForCreatedTarget',
        creatorOpId: operation.opId,
        target: {
          entityKind: 'target',
          refKind: 'created',
          opId: operation.opId,
          slot: { slotKind: 'fixed', name: 'target' },
        },
      })
      continue
    }
    if (
      operation.kind === 'media.addCostume' &&
      operation.target !== null &&
      typeof operation.target === 'object' &&
      (operation.target as Record<string, unknown>)['refKind'] === 'created'
    )
    {
      const creatorOpId = (operation.target as Record<string, unknown>)['opId']
      const index = ordered.findIndex(
        (obligation) => obligation.creatorOpId === creatorOpId
      )
      if (index !== -1) ordered.splice(index, 1)
    }
  }
  const exact = Object.freeze(ordered.map((entry) => structuredClone(entry)))
  return Object.freeze({
    ordered: exact,
    orderedSetSha256: semanticHashV1('resolved-plan', {
      kind: 'provisional-obligation-set',
      schemaVersion: 1,
      ordered: exact,
    }),
  })
}

// one evaluation whose deterministic half is durable but whose native-agent
// judgment is still outstanding; it holds no transition lock
interface AwaitingEvaluationV1
{
  evaluationId: string
  sequence: number
  planId: string
  attemptSha256: string
  revision: ExactRevisionIdentityV1
  semanticSourceSha256: string
  historySha256: string
  deadlineEpochMs: number
  deadlineSha256: string
  notificationSha256: string
  requestSetSha256: string
  requestArtifactIds: readonly string[]
  deterministic: EditDeterministicEvaluationResultV1
  retention: EvaluationRetentionV1
}

interface EvaluationRetentionV1
{
  reservationId: string
  reservedBytes: number
  retainedBytes: number
  settled: boolean
}

interface AssetRetentionPlanV1
{
  payloadKey: string
  recordKey: string
  reservationId: string
  reservedBytes: number
  payloadAlreadyRetained: boolean
  recordAlreadyRetained: boolean
}

interface ReleasedEvaluationQuotaProofV1
{
  schemaVersion: 1
  evaluationSequence: number
  evaluationAttemptSha256: string
  reservationId: string
  reservedBytes: number
}

interface CompleteEvaluationInputV1
{
  attemptNamespaceSha256: string
  sequence: number
  attemptSha256: string
  evaluationId: string
  plan: ActivatedEvaluationPlanV1
  revision: ExactRevisionIdentityV1
  semanticSourceSha256: string
  historySha256: string
  deterministic: EditDeterministicEvaluationResultV1
  candidateObservations: readonly EditCandidateObservationV1[]
  additionalEvidence: readonly EditEvaluationEvidenceEntryV1[]
  externalObjectives: readonly EditStructuralObjectiveObservationV1[]
  laneStatuses: readonly EditLaneStatusV1[]
  externalRecords: readonly EditStagedExternalEvidenceRecordV1[]
  evidenceContent: EvidenceContentHashCollectionV1
  extraLimitations: readonly string[]
  retention: EvaluationRetentionV1
  invocation: HostInvocationContextV1
}

interface RetainedEvaluationCompletionAuthorityV1
{
  schemaVersion: 1
  kind: 'edit-evaluation-completion-authority-v1'
  attemptNamespaceSha256: string
  evaluationId: string
  sequence: number
  attemptSha256: string
  evaluatedRevision: ExactRevisionIdentityV1
  evidenceContent: EvidenceContentHashCollectionV1
  certificate: ReturnType<
    typeof buildEditEvaluationCertificateV1
  >['certificate']
  retainedCertificate: EditRetainedCertificateV1
  status: EditEvaluationStateV1
  completedRecord: {
    schemaVersion: 1
    status: EditEvaluationStateV1
    certificateSha256: string
    requiredChangeResultSha256: string
    allowedChangeResultSha256: string
    preservationResultSha256: string
    limitations: readonly string[]
    eventSha256: string
  }
  eventProjection: EditKernelSemanticEventV1['projection']
  eventSha256: string
  reportSha256: string
}

interface RetainedEvaluationAwaitingAuthorityV1
{
  schemaVersion: 1
  kind: 'edit-evaluation-awaiting-authority-v1'
  attemptNamespaceSha256: string
  evaluationId: string
  sequence: number
  attemptSha256: string
  evaluatedRevision: ExactRevisionIdentityV1
  evidenceContent: EvidenceContentHashCollectionV1
  requestArtifactIds: readonly string[]
  awaitingRecord: {
    schemaVersion: 1
    evaluationId: string
    requestSetSha256: string
    deadlineEpochMs: number
    deadlineSha256: string
    notificationSha256: string
    eventSha256: string
  }
  eventProjection: EditKernelSemanticEventV1['projection']
  eventSha256: string
  reportSha256: string
}

interface RetainedEvaluationCancellationAuthorityV1
{
  schemaVersion: 1
  kind: 'edit-evaluation-cancellation-authority-v1'
  evaluationId: string
  sequence: number
  attemptSha256: string
  reservationId: string
  cancellationRecord: {
    schemaVersion: 1
    evaluationId: string
    evaluatedRevision: ExactRevisionIdentityV1
    requestSetSha256: string
    deadlineEpochMs: number
    deadlineSha256: string
    notificationSha256: string
    reason: string
    eventSha256: string
  }
  eventProjection: EditKernelSemanticEventV1['projection']
  eventSha256: string
}

interface IdempotentOutcomeV1
{
  requestSha256: string
  transportRequestSha256: string
  attempt: EditKernelAttemptV1
  result?: unknown
  refusal?: {
    code: EditSessionErrorCodeV1
    message: string
    context: RefusalContextV1
  }
}

interface CommitOutcomeV1
{
  preparedEvent: EditKernelSemanticEventV1
  committedEvent: EditKernelSemanticEventV1
  report: EditKernelReportV1
}

// * everything publication steps 8 & 9 need, captured before the link syscall so
// * a later recovery call rolls the exact same publication forward instead of
// * reconstructing an approximation of it
interface EditPendingPublicationV1
{
  exportId: string
  sequence: number
  exportSha256: string
  attemptNamespaceSha256: string
  attemptRequestSha256: string
  certificateSha256: string
  head: HeadProjectionV1
  revision: ExactRevisionIdentityV1
  historySha256: string
  reservation: EditPublicationReservationV1
  capability: EditPublicationCapabilityV1
  // refreshed when recovery has to recreate the temp from the retained candidate
  prepared: EditPublicationPreparedV1
  preparedProofSha256: string
  preparedReopen: EditExportReopenEvidenceV1
  gateSha256: string
  preLinkRecheckOk: boolean
  revisionZeroCandidateSha256: string
  preparedAtEpochMs: number
  invocation: HostInvocationContextV1
  // captured once so a roll-forward retry rewrites byte-identical provenance
  committedAtEpochMs: number | null
  // the terminal event is appended once, never again by a roll-forward
  publishedEvent: EditKernelSemanticEventV1 | null
}

type EditPendingSameHeadTransitionV1 =
  | {
      readonly kind: 'asset-admit'
      readonly namespaceSha256: string
      readonly record: SessionAssetRecordV1
      readonly invocation: HostInvocationContextV1
      retention: {
        payloadKey: string
        recordKey: string
        retainedBytes: number
      } | null
      eventSha256: string | null
    }
  | {
      readonly kind: 'preview'
      readonly namespaceSha256: string
      readonly preview: EditKernelPreviewV1
      readonly invocation: HostInvocationContextV1
      eventSha256: string | null
    }
  | {
      readonly kind: 'checkpoint'
      readonly namespaceSha256: string
      readonly checkpointId: string
      readonly label: string
      readonly note?: string
      readonly revision: ExactRevisionIdentityV1
      readonly invocation: HostInvocationContextV1
      eventSha256: string | null
    }

function mergePolicy(
  overrides: Partial<EditKernelPolicyV1> | undefined
): EditKernelPolicyV1
{
  const policy = { ...DEFAULT_EDIT_KERNEL_POLICY_V1, ...overrides }
  const hardMaximums: EditKernelPolicyV1 = {
    activeSessionLimit: 8,
    acceptedRevisionLimit: 32,
    acceptedOperationLimit: 1_024,
    rejectedAttemptLimit: 256,
    retainedPreviewLimit: 16,
    checkpointLimit: 64,
    evaluationRunLimit: 32,
    artifactByteLimit: 2 * 1024 * 1024 * 1024,
    idleLeaseMs: 60 * 60 * 1000,
    absoluteLeaseMs: 4 * 60 * 60 * 1000,
    restoreEnvelopeCount: 1,
  }
  for (const key of Object.keys(policy) as Array<keyof EditKernelPolicyV1>)
  {
    const value = policy[key]
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > DEFAULT_EDIT_KERNEL_POLICY_V1[key] ||
      value > hardMaximums[key]
    )
      throw new TypeError(
        `edit kernel policy ${key} may only lower its default`
      )
  }
  return Object.freeze(policy)
}

// the A0-frozen correlation enum names the transport family, not the concrete
// host boundary, so every mcp* boundary narrows to 'mcp' here while
// HostInvocationContextV1 keeps the exact boundary the caller actually used
function correlationBoundaryKind(
  boundaryKind: HostInvocationContextV1['boundaryKind']
): InvocationCorrelationV1['boundaryKind']
{
  return boundaryKind === 'directHost' ? 'directHost' : 'mcp'
}

function asInvocationCorrelation(
  invocation: HostInvocationContextV1
): InvocationCorrelationV1
{
  return {
    boundaryKind: correlationBoundaryKind(invocation.boundaryKind),
    invocationSha256: invocation.invocationSha256,
  }
}

function errorCode(error: unknown): EditSessionErrorCodeV1
{
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    EDIT_SESSION_ERROR_CODES.has(error.code)
  )
    return error.code as EditSessionErrorCodeV1
  return 'edit.internal_invariant'
}

function retainedEvidenceIdsV1(value: unknown): readonly string[]
{
  const ids = new Set<string>()
  let visited = 0
  const visit = (entry: unknown, depth: number): void =>
  {
    if (
      depth > 8 ||
      visited >= 4096 ||
      entry === null ||
      typeof entry !== 'object'
    )
      return
    visited += 1
    if (Array.isArray(entry))
    {
      for (const item of entry.slice(0, 256)) visit(item, depth + 1)
      return
    }
    for (const [key, child] of Object.entries(entry))
    {
      if (
        (key === 'evidenceId' ||
          key === 'admissionEvidenceId' ||
          key === 'publicationEvidenceId' ||
          key === 'requestArtifactId') &&
        typeof child === 'string'
      )
        ids.add(child)
      else if (
        (key === 'evidenceIds' || key === 'requestArtifactIds') &&
        Array.isArray(child)
      )
        for (const id of child) if (typeof id === 'string') ids.add(id)
      visit(child, depth + 1)
      if (ids.size >= 256) return
    }
  }
  visit(value, 0)
  return Object.freeze([...ids].sort())
}

function containsRetainedHandleRef(value: unknown): boolean
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

// only the source identity decides the binding, so idempotency discovery can
// reuse this without the bytes an intake carries
function exactSourceBinding(
  request: EditBeginRequestV1,
  intake: {
    readonly provenance: EditSourceProvenanceV1
    readonly expectedArtifactSha256: string
  }
): ChangeContractSourceBindingV1
{
  if (request.baseline.kind === 'projectSession')
  {
    if (
      intake.provenance.kind !== 'projectSession' ||
      intake.provenance.projectSessionId !==
        request.baseline.projectSessionId ||
      request.baseline.expectedSourceArtifactSha256 !==
        intake.expectedArtifactSha256
    )
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        'project-session source identity does not match begin'
      )
    return {
      kind: 'exactArtifact',
      sourceArtifactSha256: intake.expectedArtifactSha256,
    }
  }
  if (
    intake.provenance.kind !== 'registeredTemplate' ||
    intake.provenance.templateId !== request.baseline.templateId ||
    String(intake.provenance.templateVersion) !==
      request.baseline.expectedVersion ||
    intake.provenance.templateArtifactSha256 !==
      request.baseline.expectedArtifactSha256 ||
    intake.expectedArtifactSha256 !== request.baseline.expectedArtifactSha256
  )
    throw new EditSessionErrorV1(
      'edit.source_identity_mismatch',
      'template source identity does not match begin'
    )
  return {
    kind: 'template',
    templateId: intake.provenance.templateId,
    version: String(intake.provenance.templateVersion),
    artifactSha256: intake.provenance.templateArtifactSha256,
  }
}

// opening refusal discovery binds the caller-declared artifact separately from
// the admitted provenance so an identity mismatch itself can be retained
function openingRefusalSourceBindingV1(
  request: EditBeginRequestV1,
  sourceIdentity: EditBeginSourceIdentityV1
): ChangeContractSourceBindingV1
{
  if (request.baseline.kind !== 'projectSession')
    return exactSourceBinding(request, sourceIdentity)
  if (
    sourceIdentity.provenance.kind !== 'projectSession' ||
    sourceIdentity.provenance.projectSessionId !==
      request.baseline.projectSessionId
  )
    throw new EditSessionErrorV1(
      'edit.source_identity_mismatch',
      'project-session source provenance does not match begin'
    )
  return {
    kind: 'exactArtifact',
    sourceArtifactSha256: request.baseline.expectedSourceArtifactSha256,
  }
}

function resolveTargetExistingBindings(
  registration: RegisteredChangeContractV1,
  project: ProjectIR
): readonly ExistingContractBindingResolutionV1[]
{
  let targetEvidence: ReturnType<typeof targetEntityEvidenceSetV1> | undefined
  let declarationEvidence:
    ReturnType<typeof declarationEntityEvidenceSetV1> | undefined
  let scriptEvidence: ReturnType<typeof scriptEntityEvidenceSetV1> | undefined
  let blockEvidence: ReturnType<typeof blockEntityEvidenceSetV1> | undefined
  let commentEvidence: ReturnType<typeof commentEntityEvidenceSetV1> | undefined
  let procedureEvidence:
    ReturnType<typeof procedureEntityEvidenceSetV1> | undefined
  let parameterEvidence:
    ReturnType<typeof parameterEntityEvidenceSetV1> | undefined
  let mediaEvidence:
    ReturnType<typeof mediaRecordEntityEvidenceSetV1> | undefined
  const targets = () =>
    (targetEvidence ??= targetEntityEvidenceSetV1(project.json))
  const declarations = () =>
    (declarationEvidence ??= declarationEntityEvidenceSetV1(project))
  const scripts = () => (scriptEvidence ??= scriptEntityEvidenceSetV1(project))
  const blocks = () =>
    (blockEvidence ??= blockEntityEvidenceSetV1(project, undefined, scripts()))
  const comments = () =>
    (commentEvidence ??= commentEntityEvidenceSetV1(
      project,
      undefined,
      blocks()
    ))
  const procedures = () =>
    (procedureEvidence ??= procedureEntityEvidenceSetV1(project))
  const parameters = () =>
    (parameterEvidence ??= parameterEntityEvidenceSetV1(project))
  const media = () =>
    (mediaEvidence ??= mediaRecordEntityEvidenceSetV1(project))
  const resolutions: ExistingContractBindingResolutionV1[] = []
  for (const binding of registration.registration.semanticContract
    .entityBindings)
    {
    if (binding.bindingKind !== 'existing') continue
    const matches = (() =>
    {
      if (binding.entityKind === 'target')
        return targets().filter(
          (evidence) => evidence.targetKind === binding.entitySubtype
        )
      if (binding.entityKind === 'declaration')
        return declarations().filter(
          (evidence) => evidence.declarationKind === binding.entitySubtype
        )
      if (binding.entityKind === 'script') return scripts()
      if (binding.entityKind === 'block') return blocks()
      if (binding.entityKind === 'comment')
        return comments().filter(
          (evidence) => evidence.topologyStatus === 'consistent'
        )
      if (binding.entityKind === 'procedure') return procedures()
      if (binding.entityKind === 'parameter') return parameters()
      if (binding.entityKind === 'media')
        return media().filter(
          (evidence) => evidence.mediaKind === binding.entitySubtype
        )
      throw new EditSessionErrorV1(
        'edit.unsupported_operation',
        `Group C cannot resolve ${binding.entityKind} contract bindings before its operation family opens`
      )
    })().filter(
      (evidence) =>
        evidence.semanticLocationSha256 === binding.sourceLocationSha256 &&
        evidence.semanticFingerprintSha256 ===
          binding.expectedSourceSemanticFingerprint &&
        evidence.contextFingerprintSha256 ===
          binding.expectedSourceContextFingerprint
    )
    if (matches.length !== binding.expectedMatchCount || matches.length !== 1)
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        `existing contract binding ${binding.bindingKey} did not resolve exactly once`
      )
    resolutions.push({
      bindingKey: binding.bindingKey,
      entityKind: binding.entityKind,
      sourceLocationSha256: matches[0]!.semanticLocationSha256,
    })
  }
  return resolutions
}

function inspectionLocationArtifactIdV1(
  entityKind: EditInspectDomainItemV1['entityKind'],
  semanticLocationSha256: string
): string
{
  return `${entityKind}-location-${semanticLocationSha256.slice(0, 32)}`
}

function inspectionTargetLineageV1(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  targetIndex: number
): SemanticLineageRecord
{
  const targets = activeOrderedSemanticLineages(lineage, 'target', null)
  const selected = targets[targetIndex]
  if (targets.length !== project.json.targets.length || !selected)
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'inspection target evidence does not have one active lineage'
    )
  return selected
}

function inspectionOwnedEntityLineageV1(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  kind: 'declaration' | 'script' | 'block' | 'comment',
  targetIndex: number,
  rawIdentity: string
): SemanticLineageRecord
{
  const owner = inspectionTargetLineageV1(project, lineage, targetIndex)
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === kind &&
      record.ownerLineageId === owner.lineageId &&
      record.rawIdentity === rawIdentity
  )
  if (matches.length !== 1)
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      `inspection ${kind} evidence does not have one active lineage`
    )
  return matches[0]!
}

function inspectionProcedureLineageV1(
  lineage: SemanticLineageSnapshot,
  targetLineageId: string,
  proccode: string
): SemanticLineageRecord
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === 'procedure' &&
      record.ownerLineageId === targetLineageId &&
      record.rawIdentity === `procedure:${proccode}`
  )
  if (matches.length !== 1)
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'inspection procedure evidence does not have one active lineage'
    )
  return matches[0]!
}

function inspectionParameterLineageV1(
  lineage: SemanticLineageSnapshot,
  procedureLineageId: string,
  argumentId: string
): SemanticLineageRecord
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === 'parameter' &&
      record.ownerLineageId === procedureLineageId &&
      record.rawIdentity === `parameter:${argumentId}`
  )
  if (matches.length !== 1)
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'inspection parameter evidence does not have one active lineage'
    )
  return matches[0]!
}

function inspectionMediaLineageV1(
  lineage: SemanticLineageSnapshot,
  targetLineageId: string,
  mediaKind: 'costume' | 'sound',
  assetId: string,
  dataFormat: string,
  ordinal: number
): SemanticLineageRecord
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === mediaKind &&
      record.ownerLineageId === targetLineageId &&
      record.rawIdentity === `${mediaKind}:${assetId}:${dataFormat}:${ordinal}`
  )
  if (matches.length !== 1)
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'inspection media evidence does not have one active lineage'
    )
  return matches[0]!
}

function boundedInspectionDisplayStringV1(
  value: string
): BoundedDisplayStringV1
{
  const bytes = editCanonicalBytesV1(value)
  const identity = {
    canonicalJsonStringByteLength: bytes.byteLength,
    valueSha256: sha256Hex(bytes),
  }
  return new TextEncoder().encode(value).byteLength <= 256
    ? { displayKind: 'inline', value, ...identity }
    : { displayKind: 'hashOnly', ...identity }
}

function primitiveOptionalNumberV1(
  value: readonly unknown[],
  index: number
): ExistingOptionalNumberV1
{
  if (index >= value.length) return { state: 'missing' }
  return typeof value[index] === 'number'
    ? { state: 'value', value: value[index] }
    : { state: 'missing' }
}

// hash large ordered collections through bounded member & chunk digests so
// admitted projects cannot exhaust CanonicalJsonV1 while deriving authority
function canonicalMemberCollectionSha256V1(values: readonly unknown[]): string
{
  const chunkSize = 4_096
  const memberSha256s = values.map((value) => editCanonicalSha256V1(value))
  const chunkSha256s: string[] = []
  for (let firstMemberIndex = 0; firstMemberIndex < values.length;)
  {
    chunkSha256s.push(
      editCanonicalSha256V1({
        firstMemberIndex,
        memberSha256s: memberSha256s.slice(
          firstMemberIndex,
          firstMemberIndex + chunkSize
        ),
      })
    )
    firstMemberIndex += chunkSize
  }
  return editCanonicalSha256V1({
    kind: 'canonical-member-collection-v1',
    memberCount: values.length,
    chunkSize,
    chunkSha256s,
  })
}

function capabilityAssessment(
  semanticSourceSha256: string,
  preflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>,
  pinnedScratchRuntimeSourceSha256: string
): MediaTargetCapabilityProfileInputV1
{
  const admission = preflight.admission!
  const index = preflight.referenceIndex!
  const targetCapability = assessTargetOperationCapabilitiesV1(
    preflight.project!
  )
  const declarationCapability = assessDeclarationCapabilitiesV1(
    preflight.project!
  )
  const procedureCapability = assessProcedureCapabilitiesV1(
    preflight.project!,
    index
  )
  const mediaCapability = assessMediaOperationCapabilitiesV1(
    preflight.project!,
    index
  )
  const commentAvailable =
    index.unresolvedBlockCommentReferences.length === 0 &&
    index.comments.every((comment) =>
      comment.attachmentStatus === 'detached'
        ? comment.reverseLinkStatus === 'none'
        : comment.attachmentStatus === 'resolved' &&
          comment.reverseLinkStatus === 'unique' &&
          comment.reverseLinkedBlocks[0]?.target.targetIndex ===
            comment.attachedBlock?.target.targetIndex &&
          comment.reverseLinkedBlocks[0]?.blockId ===
            comment.attachedBlock?.blockId
    )
  const authoredOpcodes = new Set<string>(
    VANILLA_CORE_DESCRIPTORS.filter(
      (descriptor) => descriptor.availability === 'supported'
    ).map((descriptor) => descriptor.opcode)
  )
  const scriptAvailable =
    preflight.project!.json.targets.some((target) =>
      VANILLA_CORE_DESCRIPTORS.some(
        (descriptor) =>
          descriptor.availability === 'supported' &&
          descriptor.context.ownerTargets.includes(
            target.isStage ? 'stage' : 'sprite'
          ) &&
          descriptor.context.allowedPlacements.some((placement) =>
            [
              'eventScriptHat',
              'topLevelStatement',
              'topLevelExpression',
            ].includes(placement)
          )
      )
    ) ||
    index.scripts.some((script) =>
    {
      const top = index.blocks.find(
        (block) =>
          block.ref.target.targetIndex === script.top.target.targetIndex &&
          block.ref.blockId === script.top.blockId
      )
      return top?.ownershipStatus === 'unique' && top.topLevel && !top.shadow
    })
  const blockAvailable = index.blocks.some(
    (block) =>
      block.ownershipStatus === 'unique' &&
      block.opcode !== null &&
      authoredOpcodes.has(block.opcode)
  )
  const scriptOwnershipSha256 = canonicalMemberCollectionSha256V1(
    index.blocks.map((block) => ({
      ref: block.ref,
      ownershipStatus: block.ownershipStatus,
      topLevel: block.topLevel,
      shadow: block.shadow,
    }))
  )
  const descriptorBackedBlocksSha256 = canonicalMemberCollectionSha256V1(
    index.blocks.map((block) => ({
      ref: block.ref,
      opcode: block.opcode,
      ownershipStatus: block.ownershipStatus,
      descriptorSupported:
        block.opcode !== null && authoredOpcodes.has(block.opcode),
    }))
  )
  return {
    semanticSourceSha256,
    pinnedScratchRuntimeSourceSha256,
    projectConstraintAssessmentSha256: editCanonicalSha256V1({
      projectCounts: admission.projectCounts,
      jsonMetrics: admission.jsonMetrics,
    }),
    unsupportedExtensionsSha256: editCanonicalSha256V1(
      admission.project.extensions ?? []
    ),
    unsupportedOpcodesSha256: editCanonicalSha256V1({
      malformedBlocks: index.blocks
        .filter((block) => block.opcode === null)
        .map((block) => block.ref),
      unsupportedBlocks: index.blocks
        .filter(
          (block) => block.opcode !== null && !authoredOpcodes.has(block.opcode)
        )
        .map((block) => ({ ref: block.ref, opcode: block.opcode })),
      unknownNameSemantics: unknownNameSemanticsEvidenceV1(admission.project),
    }),
    unsupportedMediaSha256: editCanonicalSha256V1(admission.media),
    unknownReferenceSurfacesSha256: editCanonicalSha256V1({
      declarationUses: index.unresolvedDeclarationUses,
      dynamicDeclarationNames: index.dynamicDeclarationNameReferences,
      broadcastUses: index.unresolvedBroadcastUses,
      dynamicBroadcasts: index.dynamicBroadcastSenders,
      blockComments: index.unresolvedBlockCommentReferences,
      dynamicSprites: index.dynamicSpriteReferences,
      monitors: index.monitors.map((monitor) => ({
        ref: monitor.ref,
        targetStatus: monitor.targetStatus,
        declarationStatus: monitor.declarationStatus,
      })),
    }),
    targetConstraintCollectionSha256: editCanonicalSha256V1(
      admission.project.targets.map((target, targetIndex) => ({
        targetIndex,
        isStage: target.isStage,
        name: target.name,
      }))
    ),
    admissionCompatibilitySha256: editCanonicalSha256V1({
      limits: admission.limits,
      stages: admission.completedStages,
    }),
    runtimeProfileCompatibilitySha256: editCanonicalSha256V1({
      group: 'F',
      runtimeExecution: 'unavailable',
      pinnedScratchRuntimeSourceSha256,
    }),
    operationCapabilityAssessmentSha256: semanticHashV1('capability-profile', {
      group: 'F',
      target: targetCapability,
      declaration: declarationCapability,
      procedure: procedureCapability,
      media: mediaCapability,
      comments: index.comments.map((comment) => ({
        ref: comment.ref,
        attachmentStatus: comment.attachmentStatus,
        reverseLinkStatus: comment.reverseLinkStatus,
      })),
      scriptOwnershipSha256,
      descriptorBackedBlocksSha256,
    }),
    familyAvailability: {
      target: targetCapability.items.some(
        (item) => item.availability === 'supported'
      ),
      declaration: declarationCapability.availability === 'supported',
      comment: commentAvailable,
      script: scriptAvailable,
      block: blockAvailable,
      procedure: procedureCapability.availability === 'supported',
      media: mediaCapability.availability === 'supported',
    },
  }
}

// capability discovery evaluates exact bytes without admitting a session; the
// provisional zero-contract head is discovery-only & cannot authorize mutation
export async function discoverEditCapabilityFactsV1(
  bytes: Uint8Array,
  identity: EditSessionRegistryIdentityV1
): Promise<EditRetainedCapabilityFactsV1>
{
  const preflight = await inspectSemanticEditArtifact(bytes)
  if (
    !preflight.ok ||
    !preflight.project ||
    !preflight.semanticSourceIdentity ||
    !preflight.semanticSourceSha256 ||
    !preflight.admission
  )
    throw new EditSessionErrorV1(
      'edit.source_identity_mismatch',
      `source is not editable: ${preflight.refusal?.code ?? 'preflight failed'}`
    )
  const semanticSourceSha256 = preflight.semanticSourceSha256
  const profile = buildGroupGCapabilityProfileV1(
    capabilityAssessment(
      semanticSourceSha256,
      preflight,
      identity.pinnedScratchRuntimeSourceSha256
    )
  )
  const sourceArtifactSha256 = sha256Hex(bytes)
  const changeContractSha256 = ZERO_SHA256
  const revisionId = semanticHashV1('revision', {
    kind: 'capability-discovery-head',
    schemaVersion: 1,
    semanticSourceSha256,
    sourceArtifactSha256,
    capabilityProfileSha256: profile.capabilityProfileSha256,
  })
  const exactHead: ExactRevisionIdentityV1 = {
    sourceArtifactSha256,
    revisionNumber: 0,
    revisionId,
    candidateSha256: sourceArtifactSha256,
    assetManifestSha256: preflight.semanticSourceIdentity.assetManifestSha256,
    changeContractSha256,
    capabilityProfileSha256: profile.capabilityProfileSha256,
  }
  const snapshot = buildEditCapabilitySnapshotV1({
    head: exactHead,
    admittedAssetCollectionVersion: 0,
    policyConfigVersion: identity.policyConfigVersion,
    runnerAvailabilityEpoch: 0,
    diskLowWaterState: 'unavailable',
    collectionEpoch: 0,
    resourceEpoch: 0,
    cursorEpoch: 0,
    diskCapacityClass: 'unavailable',
    remainingBudget: {
      artifactBytesUsed: 0,
      impactUsed: 0,
      intentUsed: 0,
      restoreReserveHeld: false,
    },
    freeByteTelemetryClass: 'unknown',
    retentionPolicyVersion: 1,
    retentionPolicySha256: identity.retentionPolicySha256,
  })
  return Object.freeze({
    profile,
    snapshot,
    head: Object.freeze({
      ...exactHead,
      capabilitySnapshotSha256: snapshot.capabilitySnapshotSha256,
    }),
    effectiveLimits: Object.freeze(
      Object.fromEntries(
        Object.values(PHASE_8_EDIT_LIMIT_AUTHORITY_V1).map((limit) => [
          limit.editLimitKey,
          limit.defaultValue,
        ])
      ) as Record<EditLimitKeyV1, number>
    ),
    evidenceIds: Object.freeze([
      sourceArtifactSha256,
      profile.capabilityProfileSha256,
      snapshot.capabilitySnapshotSha256,
    ]),
  })
}

function initialBudget(): EditKernelBudgetV1
{
  return {
    artifactBytesUsed: 0,
    impactUsed: 0,
    intentUsed: 0,
    restoreReserveHeld: true,
    acceptedOperations: 0,
    acceptedRevisions: 1,
    rejectedAttempts: 0,
    retainedPreviews: 0,
    checkpoints: 0,
  }
}

interface EditTransactionResourceUsageV1
{
  readonly impact: number
  readonly targets: number
  readonly scripts: number
  readonly declarations: number
  readonly comments: number
  readonly media: number
}

interface ExecutedEditTransactionV1 extends EditTransactionExecutionPlanV1
{
  readonly resourceUsage: EditTransactionResourceUsageV1
  readonly describedBlockNodes: number
}

export function projectDeltaResourceUsageV1(
  value: unknown
): EditTransactionResourceUsageV1
{
  if (value === null || typeof value !== 'object')
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'transaction parent delta is absent'
    )
  const delta = value as Partial<ProjectDelta>
  const summary = delta.summary
  const requiredSummaryKeys = [
    'touchedTargets',
    'touchedScripts',
    'changedBlockRecords',
  ] as const
  if (
    summary === undefined ||
    requiredSummaryKeys.some(
      (key) => !Number.isSafeInteger(summary[key]) || summary[key] < 0
    )
  )
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'transaction parent delta lacks complete resource accounting'
    )
  if (!Array.isArray(delta.targets))
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      'transaction parent delta lacks target accounting'
    )
  const identitiesForChanges = (
    category: string,
    changes: readonly {
      readonly path: string
      readonly entityLineageIds?: readonly string[]
      readonly before?: unknown
      readonly after?: unknown
    }[],
    pathPattern: RegExp,
    collectionPathPattern: RegExp
  ): Set<string> =>
  {
    const identities = new Set<string>()
    for (const change of changes)
    {
      if (collectionPathPattern.test(change.path))
      {
        for (const side of [change.before, change.after])
        {
          if (side === null || typeof side !== 'object') continue
          for (const key of Object.keys(side))
            identities.add(`${category}:path:${change.path}/${key}`)
        }
        continue
      }
      if (!pathPattern.test(change.path)) continue
      const lineageIds = change.entityLineageIds ?? []
      if (lineageIds.length > 0)
      {
        for (const lineageId of lineageIds)
          identities.add(`${category}:lineage:${lineageId}`)
        continue
      }
      const match = pathPattern.exec(change.path)
      if (match?.[1] !== undefined)
      {
        identities.add(`${category}:path:${match[0]}`)
        continue
      }
    }
    return identities
  }
  const declarations = new Set<string>()
  const comments = new Set<string>()
  const media = new Set<string>()
  for (const target of delta.targets)
  {
    for (const identity of identitiesForChanges(
      'declaration',
      target.declarationChanges,
      /^\/targets\/\d+\/(?:variables|lists|broadcasts)\/([^/]+)/u,
      /^\/targets\/\d+\/(?:variables|lists|broadcasts)$/u
    ))
      declarations.add(identity)
    for (const identity of identitiesForChanges(
      'comment',
      target.existingEditorLayoutChanges,
      /^\/targets\/\d+\/comments\/([^/]+)/u,
      /^\/targets\/\d+\/comments$/u
    ))
      comments.add(identity)
    for (const identity of identitiesForChanges(
      'media',
      target.assetMetadataChanges,
      /^\/targets\/\d+\/(?:costumes|sounds)\/([^/]+)/u,
      /^\/targets\/\d+\/(?:costumes|sounds)$/u
    ))
      media.add(identity)
  }
  const touchedCollectionEntities = (
    category: string,
    kinds: ReadonlySet<string>
  ): ReadonlySet<string> =>
  {
    const identities = new Set<string>()
    for (const change of delta.orderedCollectionChanges ?? [])
    {
      if (kinds.has(change.collectionKind))
        identities.add(`${category}:lineage:${change.lineageId}`)
    }
    for (const change of delta.correspondedEntityChanges ?? [])
    {
      if (kinds.has(change.collectionKind) && change.changes.length > 0)
        identities.add(`${category}:lineage:${change.entityLineageId}`)
    }
    return identities
  }
  for (const identity of touchedCollectionEntities(
    'comment',
    new Set(['comments'])
  ))
    comments.add(identity)
  for (const identity of touchedCollectionEntities(
    'media',
    new Set(['costumes', 'sounds'])
  ))
    media.add(identity)
  return Object.freeze({
    impact: summary.changedBlockRecords,
    targets: summary.touchedTargets,
    scripts: summary.touchedScripts,
    declarations: declarations.size,
    comments: comments.size,
    media: media.size,
  })
}

async function retainImmutable(
  store: EditArtifactStorePort,
  key: string,
  bytes: Uint8Array
): Promise<EditArtifactIdentityV1>
{
  return store.createOrVerifyImmutable(key, bytes)
}

function isMutableSessionPointerV1(
  layout: EditSessionLayoutV1,
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

function assertPreparedPublicationV1(input: {
  readonly prepared: EditPublicationPreparedV1
  readonly reservation: EditPublicationReservationV1
  readonly recoveryAuthority: string
  readonly candidateSha256: string
  readonly candidateByteLength: number
}): void
{
  if (!isPreparedPublicationBoundV1(input))
    throw new EditSessionErrorV1(
      'edit.export_proof_failed',
      'prepared publication response differs from the exact reservation and candidate authority'
    )
}

function assertPublicationCommitV1(
  prepared: EditPublicationPreparedV1,
  commit: EditPublicationCommitV1
): void
{
  if (!isPublicationCommitBoundV1(prepared, commit))
    throw new EditSessionErrorV1(
      'edit.recovery_required',
      'publication commit response differs from the exact prepared authority',
      true
    )
}

function assertPublicationInspectionV1(
  prepared: EditPublicationPreparedV1,
  inspection: EditPublicationNameInspectionV1
): void
{
  if (!isPublicationInspectionBoundV1(prepared, inspection))
    throw new EditSessionErrorV1(
      'edit.publication_interference',
      'publication name inspection differs from the exact prepared authority',
      true
    )
}

// payload installation is the commit point; a catalogue descriptor can expose
// only bytes the same durable store already accepted under their exact identity
async function retainPublicImmutable(
  store: EditArtifactStorePort,
  catalogue: EditRetainedResourceCataloguePortV1 | null | undefined,
  input: {
    readonly sessionId: string
    readonly sessionKey: string
    readonly logicalKey: string
    readonly bytes: Uint8Array
    readonly mimeType: EditRetainedResourceMimeTypeV1
  }
): Promise<EditArtifactIdentityV1>
{
  const identity = await retainImmutable(store, input.logicalKey, input.bytes)
  await catalogue?.retain({
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    logicalKey: input.logicalKey,
    identity,
    mimeType: input.mimeType,
  })
  return identity
}

// payload bytes never enter the idempotency namespace; the declared digest &
// host provenance identify the request exactly & stay canonically hashable
function assetAdmitRequestProjectionV1(
  source: EditAssetAdmitDomainSourceV1
): unknown
{
  if (source.kind === 'inputFile')
    return {
      kind: source.kind,
      mediaKind: source.mediaKind,
      expectedByteLength: source.expectedByteLength,
      expectedPayloadSha256: source.expectedPayloadSha256,
      provenance: source.read.provenance,
    }
  return {
    kind: source.kind,
    mediaKind: source.mediaKind,
    ...(source.media === undefined ? {} : { media: source.media }),
    byteLength: source.bytes.byteLength,
    expectedPayloadSha256: source.expectedPayloadSha256,
  }
}

// the asset-token salt is derived, not drawn fresh, so a session rebuilt during
// recovery mints & resolves the exact same tokens it issued before
function sessionAssetSaltV1(
  handleSecret: Uint8Array,
  sessionId: string
): Uint8Array
{
  return new TextEncoder().encode(
    sha256Hex(
      new Uint8Array([
        ...new TextEncoder().encode('edit-asset-salt\0'),
        ...handleSecret,
        ...new TextEncoder().encode(sessionId),
      ])
    )
  )
}

function editSessionKeyV1(sessionId: string): string
{
  return `session-${editCanonicalSha256V1({
    kind: 'edit-session-layout-key',
    schemaVersion: 1,
    sessionId,
  })}`
}

async function compareAndReconcilePointer(
  store: EditArtifactStorePort,
  key: string,
  expectedSha256: string | null,
  bytes: Uint8Array
): Promise<EditArtifactIdentityV1>
{
  try
  {
    return await store.compareAndSwapPointer(key, expectedSha256, bytes)
  }
  catch (error)
  {
    const reconciled = await store.reconcilePointer(key, expectedSha256, bytes)
    if (reconciled.status === 'new') return reconciled.proposed
    if (reconciled.status === 'interference')
      throw new EditSessionErrorV1(
        'edit.retention_failed',
        `pointer ${key} was changed by a different writer`
      )
    throw error
  }
}

// one limitations list for the begin-time seed report & for every later report,
// so the two can never disagree about what this build actually offers. Each
// entry names a capability that is absent here, never one that merely could be
function editSessionLimitationsV1(input: {
  evaluationPorts: EditEvaluationPortsV1 | null | undefined
  publicationPort: EditPublicationPort | null | undefined
}): readonly string[]
{
  const evaluation = input.evaluationPorts ?? null
  return Object.freeze([
    ...(evaluation === null
      ? [
          'evaluation is unavailable because no deterministic evaluation port is configured, so no certificate can authorize export',
        ]
      : evaluation.external === undefined && evaluation.inbox === undefined
        ? [
            'no external evidence notification port or inbox is configured, so a plan that requires external visual evidence certifies inconclusive rather than passing',
          ]
        : evaluation.external === undefined
          ? [
              'no external evidence notification port is configured, so a plan that requires external visual evidence certifies inconclusive rather than passing',
            ]
          : evaluation.inbox === undefined
            ? [
                'no external evidence inbox is configured, so a plan that requires external visual evidence certifies inconclusive rather than passing',
              ]
            : []),
    ...((input.publicationPort ?? null) === null
      ? ['export is unavailable because no publication port is configured']
      : [
          'publication is complete-or-absent under non-adversarial concurrency only; hostile same-user filesystem races are out of scope',
        ]),
    'hardKillTimeout is false',
  ])
}

type SemanticEvaluationPlanV1 =
  EditSemanticChangeContractV1['evaluationPlans'][number]

function evaluationPlanRequiresExternalJudgeV1(
  plan: SemanticEvaluationPlanV1
): boolean
{
  return (
    plan.nativeEvidencePolicySha256 !== undefined ||
    plan.requiredRuntimeChanges.some(
      (predicate) => predicate.kind === 'visualCriterion'
    )
  )
}

function externalEvidenceJudgeReadyV1(
  ports: EditEvaluationPortsV1 | null | undefined
): boolean
{
  return ports?.external !== undefined && ports.inbox !== undefined
}

function evaluationPlanExternalJudgeReadyV1(
  plan: SemanticEvaluationPlanV1,
  ports: EditEvaluationPortsV1 | null | undefined
): boolean
{
  return (
    !evaluationPlanRequiresExternalJudgeV1(plan) ||
    externalEvidenceJudgeReadyV1(ports)
  )
}

function evaluationRunnerAvailabilityV1(
  ports: EditEvaluationPortsV1 | null | undefined,
  contract: EditSemanticChangeContractV1
): readonly RunnerAvailabilityV1[]
{
  if (ports === null || ports === undefined)
    return Object.freeze(
      EDIT_EVALUATION_RUNNER_LANES_V1.map((lane) =>
        Object.freeze({
          lane,
          availability: 'unavailable' as const,
          availabilityEpoch: 0,
        })
      )
    )
  try
  {
    const rows = validatedRunnerAvailabilityV1(
      ports.deterministic.runnerAvailabilityV1()
    )
    const epoch = rows[0]!.availabilityEpoch
    const externalJudgeAvailable = externalEvidenceJudgeReadyV1(ports)
    const externallyJudgedLanes = new Set<string>(
      contract.evaluationPlans.flatMap((plan) =>
        plan.requiredRuntimeChanges
          .filter((predicate) => predicate.kind === 'visualCriterion')
          .map((predicate) => predicate.lane)
      )
    )
    return validatedRunnerAvailabilityV1(
      rows.map((row) =>
        row.lane === 'nativeVisual'
          ? {
              lane: row.lane,
              availability: externalJudgeAvailable
                ? ('available' as const)
                : ('unavailable' as const),
              availabilityEpoch: epoch,
            }
          : !externalJudgeAvailable &&
              externallyJudgedLanes.has(row.lane) &&
              row.availability !== 'poisoned'
            ? {
                lane: row.lane,
                availability: 'unavailable' as const,
                availabilityEpoch: epoch,
              }
            : row
      ),
      epoch
    )
  }
  catch (error)
  {
    throw new EditSessionErrorV1(
      'edit.internal_invariant',
      `deterministic evaluation availability is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function runnerAvailabilityEpochV1(
  rows: readonly RunnerAvailabilityV1[]
): number
{
  return rows[0]!.availabilityEpoch
}

function externallyFinalizedLaneStatusesV1(
  deterministic: EditDeterministicEvaluationResultV1
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
        availability: 'available' as const,
        reason: 'all issued external evidence requests are staged',
      })
    })
  )
}

function validExternalProvenanceV1(
  record: EditStagedExternalEvidenceRecordV1
): record is EditStagedExternalEvidenceRecordV1 & {
  provenance: EditEvaluationEvidenceProvenanceV1
}
{
  const provenance = record.provenance
  if (provenance === null || typeof provenance !== 'object') return false
  return (
    provenance.schemaVersion === 1 &&
    provenance.evaluationId === record.evaluationId &&
    provenance.hostRecordId === record.recordId &&
    provenance.contentSha256 === record.contentSha256 &&
    provenance.requestSha256 === record.requestSha256 &&
    provenance.resultSha256 === record.resultSha256 &&
    typeof provenance.absoluteLocator === 'string' &&
    provenance.absoluteLocator.length > 0 &&
    Number.isSafeInteger(provenance.capturedAtEpochMs) &&
    provenance.capturedAtEpochMs >= 0 &&
    (provenance.taskId === null || typeof provenance.taskId === 'string') &&
    /^[0-9a-f]{64}$/u.test(provenance.auditRecordSha256)
  )
}

export class EditSessionV1
{
  readonly #store: EditArtifactStorePort
  readonly #resourceCatalogue: EditRetainedResourceCataloguePortV1 | null
  readonly #layout: EditSessionLayoutV1
  readonly #clock: EditClockPort
  readonly #entropy: EditEntropyPort
  readonly #handleSecret: Uint8Array
  readonly #policy: EditKernelPolicyV1
  readonly #transactionExecutor: EditTransactionExecutorV1
  readonly #sourceBytes: Uint8Array
  readonly #contract: BoundChangeContractV1
  readonly #identity: EditSessionRegistryIdentityV1
  readonly #manifest: EditKernelSessionManifestV1
  readonly #revisions: EditKernelRevisionRecordV1[]
  readonly #previews = new Map<string, EditKernelPreviewV1>()
  readonly #checkpoints = new Map<string, EditKernelCheckpointV1>()
  readonly #attempts: EditKernelAttemptV1[] = []
  readonly #idempotency = new Map<string, IdempotentOutcomeV1>()
  readonly #events: EditKernelSemanticEventV1[]
  readonly #reports: EditKernelReportV1[]
  readonly #assets: SessionAssetStoreV1
  readonly #assetMaterializationRevisionIds = new Set<string>()
  readonly #retainedArtifactBytesByKey = new Map<string, number>()
  #budget: EditKernelBudgetV1
  #state: EditKernelStateV1 = 'active'
  #busyKind: string | null = null
  #handleEpoch = 0
  #evaluationState: EditEvaluationStateV1 = 'none'
  readonly #evaluationPorts: EditEvaluationPortsV1 | null
  readonly #certificates: EditRetainedCertificateV1[] = []
  readonly #awaitingEvaluations = new Map<string, AwaitingEvaluationV1>()
  #evaluationSequence = 0
  readonly #publicationPort: EditPublicationPort | null
  readonly #sourceRecheck: (() => Promise<EditSourceIntakeRecheckV1>) | null
  #exportSequence = 0
  #exportState: 'unavailable' | 'available' | 'exported' = 'unavailable'
  #pendingSameHeadTransition: EditPendingSameHeadTransitionV1 | null = null
  #pendingPublication: EditPendingPublicationV1 | null = null
  #publicationRecoverySequence = 0
  #activatedPlans: ActivatedEvaluationPlanSetV1 | null = null
  #headPointerSha256: string
  #reportPointerSha256: string | null
  #idempotencyPointerSha256: string | null = null
  #lastActivityEpochMs: number

  constructor(input: {
    store: EditArtifactStorePort
    resourceCatalogue?: EditRetainedResourceCataloguePortV1
    layout: EditSessionLayoutV1
    clock: EditClockPort
    entropy: EditEntropyPort
    handleSecret: Uint8Array
    policy: EditKernelPolicyV1
    transactionExecutor: EditTransactionExecutorV1
    sourceBytes: Uint8Array
    contract: BoundChangeContractV1
    identity: EditSessionRegistryIdentityV1
    manifest: EditKernelSessionManifestV1
    initialRevision: EditKernelRevisionRecordV1
    initialEvent: EditKernelSemanticEventV1
    initialReport: EditKernelReportV1
    budget: EditKernelBudgetV1
    retainedArtifactEntries?: readonly {
      readonly key: string
      readonly byteLength: number
    }[]
    headPointerSha256: string
    reportPointerSha256: string | null
    initialState?: EditKernelStateV1
    evaluationPorts?: EditEvaluationPortsV1
    publicationPort?: EditPublicationPort
    sourceRecheck?: () => Promise<EditSourceIntakeRecheckV1>
  })
  {
    assertExternalEvidenceDeadlineV1(input.evaluationPorts)
    this.#resourceCatalogue = input.resourceCatalogue ?? null
    this.#evaluationPorts = input.evaluationPorts ?? null
    this.#publicationPort = input.publicationPort ?? null
    this.#sourceRecheck = input.sourceRecheck ?? null
    this.#exportState =
      input.publicationPort === undefined ? 'unavailable' : 'available'
    this.#store = input.store
    this.#layout = input.layout
    this.#clock = input.clock
    this.#entropy = input.entropy
    this.#handleSecret = new Uint8Array(input.handleSecret)
    this.#policy = input.policy
    this.#transactionExecutor = input.transactionExecutor
    this.#sourceBytes = new Uint8Array(input.sourceBytes)
    this.#contract = input.contract
    this.#identity = input.identity
    this.#manifest = input.manifest
    this.#revisions = [input.initialRevision]
    this.#events = [input.initialEvent]
    this.#reports = [input.initialReport]
    for (const entry of input.retainedArtifactEntries ?? [])
      if (!isMutableSessionPointerV1(input.layout, entry.key))
        this.#retainedArtifactBytesByKey.set(entry.key, entry.byteLength)
    const inventoriedArtifactBytes = [
      ...this.#retainedArtifactBytesByKey.values(),
    ].reduce((total, byteLength) => total + byteLength, 0)
    this.#budget = {
      ...input.budget,
      artifactBytesUsed:
        input.retainedArtifactEntries === undefined
          ? input.budget.artifactBytesUsed
          : inventoriedArtifactBytes,
    }
    this.#headPointerSha256 = input.headPointerSha256
    this.#reportPointerSha256 = input.reportPointerSha256
    this.#state = input.initialState ?? 'active'
    this.#lastActivityEpochMs = input.manifest.openedAtEpochMs
    this.#assets = new SessionAssetStoreV1({
      sessionSalt: sessionAssetSaltV1(
        input.handleSecret,
        input.manifest.sessionId
      ),
    })
  }

  get sessionId(): string
  {
    return this.#manifest.sessionId
  }

  get state(): EditKernelStateV1
  {
    return this.#state
  }

  get head(): HeadProjectionV1
  {
    return this.#currentCapabilityHead()
  }

  get manifest(): EditKernelSessionManifestV1
  {
    return structuredClone(this.#manifest)
  }

  get semanticSourceSha256(): string
  {
    return this.#manifest.semanticSourceSha256
  }

  get revisions(): readonly EditKernelRevisionRecordV1[]
  {
    return structuredClone(this.#revisions)
  }

  get events(): readonly EditKernelSemanticEventV1[]
  {
    return structuredClone(this.#events)
  }

  get reports(): readonly EditKernelReportV1[]
  {
    return structuredClone(this.#reports)
  }

  #assertMutable(): void
  {
    if (this.#state === 'recovery-required')
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        'session requires durable evidence reconciliation'
      )
    if (this.#state === 'interrupted')
      throw new EditSessionErrorV1('edit.interrupted', 'session is interrupted')
    if (this.#state !== 'active')
      throw new EditSessionErrorV1('edit.session_closed', 'session is terminal')
  }

  async #abandonExpired(invocation: HostInvocationContextV1): Promise<never>
  {
    for (const awaiting of [...this.#awaitingEvaluations.values()].sort(
      (left, right) => left.sequence - right.sequence
    ))
      await this.#cancelAwaitingEvaluationV1(
        awaiting,
        'edit.session_abandoned',
        invocation
      )
    const head = this.head
    const event = await this.#appendEvent(
      'session-closed',
      head,
      head,
      {
        reason: 'lease-expired',
        terminalState: 'closed-abandoned',
      },
      invocation
    )
    // the close event is the semantic commit point. From here onward a failed
    // cleanup/report write must stop ordinary admission until recovery closes it.
    this.#state = 'recovery-required'
    const removed = new Set<string>()
    for (const preview of this.#previews.values())
    {
      if (preview.state !== 'unapplied') continue
      preview.state = 'invalidated'
      if (removed.has(preview.candidateCacheKey)) continue
      removed.add(preview.candidateCacheKey)
      await this.#removeEvictableSessionArtifact(
        preview.candidateCacheKey,
        preview.predictedCandidateSha256
      )
    }
    this.#budget = { ...this.#budget, retainedPreviews: 0 }
    await this.#retainReport(this.#buildReport('closed-abandoned'), true)
    this.#state = 'closed-abandoned'
    throw new EditSessionErrorV1(
      'edit.interrupted',
      `session lease expired and was durably abandoned at ${event.eventSha256}`
    )
  }

  async #withTransition<T>(
    kind: string,
    invocation: HostInvocationContextV1,
    work: () => Promise<T>,
    evaluationSweepExemption: string | null = null
  ): Promise<T>
  {
    this.#assertMutable()
    if (this.#busyKind !== null)
      throw new EditSessionErrorV1(
        'edit.session_busy',
        `session is busy with ${this.#busyKind}`
      )
    this.#busyKind = kind
    try
    {
      const now = this.#clock.nowEpochMs()
      if (
        now > this.#manifest.absoluteDeadlineEpochMs ||
        now - this.#lastActivityEpochMs > this.#policy.idleLeaseMs
      )
        return await this.#abandonExpired(invocation)
      await this.#sweepExpiredEvaluationsV1(
        invocation,
        evaluationSweepExemption
      )
      const result = await work()
      this.#lastActivityEpochMs = this.#clock.nowEpochMs()
      return result
    }
    finally
    {
      this.#busyKind = null
    }
  }

  async #cancelAwaitingEvaluationV1(
    awaiting: AwaitingEvaluationV1,
    reason: string,
    invocation: HostInvocationContextV1
  ): Promise<void>
  {
    if (!this.#awaitingEvaluations.has(awaiting.evaluationId)) return
    // terminalizing removes the live wait first, so a partial durable terminal
    // can only enter recovery instead of being swept into a second event
    this.#awaitingEvaluations.delete(awaiting.evaluationId)
    if (this.#evaluationPorts?.external !== undefined)
      await this.#evaluationPorts.external
        .cancel(awaiting.evaluationId, reason)
        .catch(() => undefined)
    try
    {
      const eventPayload = Object.freeze({
        state: 'cancelled',
        certificate: null,
        attemptSha256: awaiting.attemptSha256,
        evaluatedRevision: awaiting.revision,
        reason,
      })
      const eventProjection = Object.freeze({
        schemaVersion: 1 as const,
        sessionId: this.sessionId,
        sequence: this.#events.length,
        eventKind: 'evaluation-recorded' as const,
        previousEventSha256: this.#events.at(-1)?.eventSha256,
        preHead: Object.freeze({
          state: 'present' as const,
          head: exactRevisionFromHeadV1(this.head),
        }),
        postHead: exactRevisionFromHeadV1(this.head),
        semanticPayloadSha256: editCanonicalSha256V1(eventPayload),
        invocationCorrelation: asInvocationCorrelation(invocation),
      })
      const eventSha256 = semanticHashV1('semantic-event', eventProjection)
      const cancellationRecord = Object.freeze({
        schemaVersion: 1 as const,
        evaluationId: awaiting.evaluationId,
        evaluatedRevision: awaiting.revision,
        requestSetSha256: awaiting.requestSetSha256,
        deadlineEpochMs: awaiting.deadlineEpochMs,
        deadlineSha256: awaiting.deadlineSha256,
        notificationSha256: awaiting.notificationSha256,
        reason,
        eventSha256,
      })
      const cancellationAuthority: RetainedEvaluationCancellationAuthorityV1 = {
        schemaVersion: 1,
        kind: 'edit-evaluation-cancellation-authority-v1',
        evaluationId: awaiting.evaluationId,
        sequence: awaiting.sequence,
        attemptSha256: awaiting.attemptSha256,
        reservationId: awaiting.retention.reservationId,
        cancellationRecord,
        eventProjection,
        eventSha256,
      }
      await this.#retainEvaluationArtifact(
        awaiting.sequence,
        awaiting.attemptSha256,
        'cancellation-authority.json',
        cancellationAuthority,
        awaiting.retention
      )
      const event = await this.#appendEvent(
        'evaluation-recorded',
        this.head,
        this.head,
        eventPayload,
        invocation
      )
      if (event.eventSha256 !== eventSha256)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'evaluation cancellation event differs from its retained authority'
        )
      await this.#retainEvaluationArtifact(
        awaiting.sequence,
        awaiting.attemptSha256,
        '000002-cancelled.json',
        { ...cancellationRecord, eventSha256: event.eventSha256 },
        awaiting.retention
      )
      await this.#settleEvaluationRetention(awaiting.retention)
      this.#evaluationState = 'inconclusive'
      await this.#retainReport(this.#buildReport('active'), true)
    }
    catch (error)
    {
      return this.#requireEvaluationRecoveryV1(error)
    }
  }

  async #sweepExpiredEvaluationsV1(
    invocation: HostInvocationContextV1,
    exemption: string | null = null
  ): Promise<void>
  {
    const now = this.#clock.nowEpochMs()
    const expired = [...this.#awaitingEvaluations.values()]
      .filter(
        (awaiting) =>
          awaiting.evaluationId !== exemption && now > awaiting.deadlineEpochMs
      )
      .sort((left, right) => left.sequence - right.sequence)
    for (const awaiting of expired)
      await this.#cancelAwaitingEvaluationV1(
        awaiting,
        'edit.external_evidence_expired',
        invocation
      )
  }

  #assertExpectedHead(
    expected: HeadProjectionV1,
    transitionPreHead?: HeadProjectionV1 | null
  ): void
  {
    const head = transitionPreHead ?? this.#currentCapabilityHead()
    if (
      expected.revisionNumber !== head.revisionNumber ||
      expected.revisionId !== head.revisionId
    )
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'expected revision is not the current head',
        false,
        {
          expectedRevisionId: expected.revisionId,
          currentRevisionId: head.revisionId,
        }
      )
    if (expected.candidateSha256 !== head.candidateSha256)
      throw new EditSessionErrorV1(
        'edit.stale_candidate',
        'expected candidate is not the current head',
        false,
        {
          expectedCandidateSha256: expected.candidateSha256,
          currentCandidateSha256: head.candidateSha256,
        }
      )
    if (expected.changeContractSha256 !== head.changeContractSha256)
      throw new EditSessionErrorV1(
        'edit.stale_contract',
        'expected change contract is stale'
      )
    if (expected.capabilityProfileSha256 !== head.capabilityProfileSha256)
      throw new EditSessionErrorV1(
        'edit.stale_capability_profile',
        'expected capability profile is stale'
      )
    if (expected.capabilitySnapshotSha256 !== head.capabilitySnapshotSha256)
      throw new EditSessionErrorV1(
        'edit.stale_capability_snapshot',
        'expected capability snapshot is stale'
      )
    if (!sameHeadV1(expected, head))
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        'expected exact head identity differs'
      )
  }

  #namespaceSha256(
    toolName: string,
    requestId: string,
    principalSha256: string
  ): string
  {
    return editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256,
      toolName,
      sessionId: this.sessionId,
      requestId,
    })
  }

  async #recoverExactPendingRequest(
    toolName: string,
    requestId: string,
    requestProjection: unknown,
    invocation: HostInvocationContextV1,
    transportRequestProjection: unknown = requestProjection
  ): Promise<void>
  {
    if (this.#state !== 'recovery-required') return
    const namespaceSha256 = this.#namespaceSha256(
      toolName,
      requestId,
      invocation.principalSha256
    )
    const pending = this.#idempotency.get(namespaceSha256)
    if (
      !pending ||
      pending.attempt.state !== 'pending' ||
      pending.requestSha256 !== editCanonicalSha256V1(requestProjection) ||
      pending.transportRequestSha256 !==
        editCanonicalSha256V1(transportRequestProjection)
    )
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        'only the exact pending request may reconcile this committed transition'
      )
    await this.recover(invocation)
  }

  async #persistIdempotencyIndex(
    outcomes: ReadonlyMap<string, IdempotentOutcomeV1> = this.#idempotency
  ): Promise<void>
  {
    const projection = [...outcomes.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([namespaceSha256, outcome]) => ({
        namespaceSha256,
        requestSha256: outcome.requestSha256,
        attemptSequence: outcome.attempt.sequence,
        state: outcome.attempt.state,
        ...(outcome.attempt.resultSha256 === undefined
          ? {}
          : { resultSha256: outcome.attempt.resultSha256 }),
        ...(outcome.attempt.refusalCode === undefined
          ? {}
          : { refusalCode: outcome.attempt.refusalCode }),
      }))
    const retained = await compareAndReconcilePointer(
      this.#store,
      this.#layout.idempotencyIndex,
      this.#idempotencyPointerSha256,
      editCanonicalBytesV1({ schemaVersion: 1, entries: projection })
    )
    this.#idempotencyPointerSha256 = retained.sha256
  }

  async #beginAttempt(
    toolName: string,
    requestId: string,
    requestProjection: unknown,
    invocation: HostInvocationContextV1,
    transportRequestProjection: unknown = requestProjection
  ): Promise<{
    namespaceSha256: string
    requestSha256: string
    attempt: EditKernelAttemptV1
    retained?: unknown
  }>
  {
    const requestSha256 = editCanonicalSha256V1(requestProjection)
    const transportRequestSha256 = editCanonicalSha256V1(
      transportRequestProjection
    )
    const namespaceSha256 = this.#namespaceSha256(
      toolName,
      requestId,
      invocation.principalSha256
    )
    const existing = this.#idempotency.get(namespaceSha256)
    if (existing)
    {
      if (
        existing.requestSha256 !== requestSha256 ||
        existing.transportRequestSha256 !== transportRequestSha256
      )
        throw new EditSessionErrorV1(
          'edit.request_id_conflict',
          'request ID was already used with different exact input'
        )
      if (existing.attempt.state === 'refused' && existing.refusal)
        throw new EditSessionErrorV1(
          existing.refusal.code,
          existing.refusal.message,
          false,
          existing.refusal.context
        )
      if (
        existing.attempt.state === 'completed' &&
        existing.result !== undefined
      )
        return {
          namespaceSha256,
          requestSha256,
          attempt: existing.attempt,
          retained: structuredClone(existing.result),
        }
      throw new EditSessionErrorV1(
        this.#state === 'recovery-required'
          ? 'edit.recovery_required'
          : 'edit.session_busy',
        'matching request is still pending durable reconciliation'
      )
    }
    const bindingFailure = retainedStatefulRequestBindingFailureV1({
      toolName,
      requestId,
      sessionId: this.sessionId,
      boundaryKind: correlationBoundaryKind(invocation.boundaryKind),
      request: requestProjection,
      transportRequest: transportRequestProjection,
    })
    if (bindingFailure !== null)
      throw new EditSessionErrorV1('edit.internal_invariant', bindingFailure)
    if (this.#budget.rejectedAttempts >= this.#policy.rejectedAttemptLimit)
      throw new EditSessionErrorV1(
        'edit.session_budget_exceeded',
        'rejected-attempt evidence capacity is exhausted',
        false,
        {
          limit: this.#policy.rejectedAttemptLimit,
          observed: this.#budget.rejectedAttempts + 1,
        }
      )
    const sequence = this.#attempts.length
    const attempt: EditKernelAttemptV1 = {
      sequence,
      attemptId: editOpaqueIdV1('attempt', this.#entropy.randomBytes(16), {
        sessionId: this.sessionId,
        sequence,
        namespaceSha256,
      }),
      toolName,
      requestId,
      requestSha256,
      namespaceSha256,
      state: 'pending',
      preHead: this.head,
      postHead: null,
    }
    await this.#retainSessionImmutable(
      this.#layout.attempt(sequence, requestSha256, 'request.json'),
      editCanonicalBytesV1({
        schemaVersion: 1,
        attempt,
        request: requestProjection,
        transportRequest: transportRequestProjection,
        invocationCorrelation: asInvocationCorrelation(invocation),
      })
    )
    const prospective = new Map(this.#idempotency)
    prospective.set(namespaceSha256, {
      requestSha256,
      transportRequestSha256,
      attempt,
    })
    await this.#persistIdempotencyIndex(prospective)
    this.#attempts.push(attempt)
    this.#idempotency.set(namespaceSha256, {
      requestSha256,
      transportRequestSha256,
      attempt,
    })
    return { namespaceSha256, requestSha256, attempt }
  }

  async #finishAttempt(
    namespaceSha256: string,
    result: unknown,
    state: 'completed' | 'refused',
    refusalCode?: EditSessionErrorCodeV1
  ): Promise<void>
  {
    const outcome = this.#idempotency.get(namespaceSha256)
    if (!outcome) throw new Error('idempotency outcome disappeared')
    let retainedRefusal: IdempotentOutcomeV1['refusal']
    if (state === 'refused')
    {
      assertFrozenRefusalResultV1(refusalCode, result)
      retainedRefusal = {
        code: result.code,
        message: result.safeMessage,
        context: structuredClone(result.context),
      }
    }
    const terminalAttempt: EditKernelAttemptV1 = {
      ...outcome.attempt,
      state,
      postHead: this.head,
      resultSha256: editCanonicalSha256V1(result),
      ...(refusalCode === undefined ? {} : { refusalCode }),
    }
    const terminalOutcome: IdempotentOutcomeV1 = {
      requestSha256: outcome.requestSha256,
      transportRequestSha256: outcome.transportRequestSha256,
      attempt: terminalAttempt,
      result: structuredClone(result),
    }
    if (retainedRefusal !== undefined) terminalOutcome.refusal = retainedRefusal
    await this.#retainSessionImmutable(
      this.#layout.attempt(
        terminalAttempt.sequence,
        outcome.requestSha256,
        'result.json'
      ),
      editCanonicalBytesV1({ schemaVersion: 1, result })
    )
    const prospective = new Map(this.#idempotency)
    prospective.set(namespaceSha256, terminalOutcome)
    await this.#persistIdempotencyIndex(prospective)
    this.#attempts[terminalAttempt.sequence] = terminalAttempt
    this.#idempotency.set(namespaceSha256, terminalOutcome)
  }

  async #retainedAttemptResult(
    outcome: IdempotentOutcomeV1
  ): Promise<unknown | null>
  {
    const key = this.#layout.attempt(
      outcome.attempt.sequence,
      outcome.requestSha256,
      'result.json'
    )
    const entries = await this.#store.listImmutable(key)
    const entry = entries.find((candidate) => candidate.key === key)
    if (entry === undefined) return null
    let wrapper: unknown
    try
    {
      wrapper = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await this.#store.readImmutable(key)
        )
      )
    }
    catch (error)
    {
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        `retained attempt result is not exact JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    if (
      wrapper === null ||
      typeof wrapper !== 'object' ||
      Array.isArray(wrapper) ||
      Object.keys(wrapper).sort().join(',') !== 'result,schemaVersion' ||
      (wrapper as Record<string, unknown>)['schemaVersion'] !== 1 ||
      sha256Hex(editCanonicalBytesV1(wrapper)) !== entry.sha256 ||
      editCanonicalBytesV1(wrapper).byteLength !== entry.byteLength
    )
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'retained attempt result differs from its canonical authority'
      )
    return (wrapper as { readonly result: unknown }).result
  }

  async #refuseAttempt(
    namespaceSha256: string,
    error: unknown,
    releasedEvaluationQuota?: ReleasedEvaluationQuotaProofV1,
    recoveryOnPersistenceFailure = false
  ): Promise<never>
  {
    const code = errorCode(error)
    try
    {
      await this.#finishAttempt(
        namespaceSha256,
        {
          ok: false,
          code,
          safeMessage: error instanceof Error ? error.message : String(error),
          context:
            error instanceof EditSessionErrorV1
              ? structuredClone(error.context)
              : {},
          ...(releasedEvaluationQuota === undefined
            ? {}
            : { releasedEvaluationQuota }),
        },
        'refused',
        code
      )
    }
    catch (persistenceError)
    {
      if (recoveryOnPersistenceFailure)
        return this.#requireEvaluationRecoveryV1(persistenceError)
      throw persistenceError
    }
    this.#budget = {
      ...this.#budget,
      rejectedAttempts: this.#budget.rejectedAttempts + 1,
    }
    throw error instanceof EditSessionErrorV1
      ? error
      : new EditSessionErrorV1(
          code,
          error instanceof Error ? error.message : String(error)
        )
  }

  async #currentCandidateBytes(): Promise<Uint8Array>
  {
    return this.#store.readImmutable(this.#revisions.at(-1)!.candidateKey)
  }

  #capabilitySnapshot(
    nextHead: HeadProjectionV1
  ): ReturnType<typeof buildEditCapabilitySnapshotV1>
  {
    const runnerAvailability = evaluationRunnerAvailabilityV1(
      this.#evaluationPorts,
      this.#contract.registration.semanticContract
    )
    const snapshot = buildEditCapabilitySnapshotV1({
      head: exactRevisionFromHeadV1(nextHead),
      admittedAssetCollectionVersion: 0,
      policyConfigVersion: this.#identity.policyConfigVersion,
      runnerAvailabilityEpoch: runnerAvailabilityEpochV1(runnerAvailability),
      runnerAvailability,
      diskLowWaterState: 'normal',
      collectionEpoch: this.#handleEpoch,
      resourceEpoch: this.#handleEpoch,
      cursorEpoch: this.#handleEpoch,
      diskCapacityClass: 'normal',
      remainingBudget: this.#budget,
      freeByteTelemetryClass: 'bounded',
      retentionPolicyVersion: 1,
      retentionPolicySha256: this.#identity.retentionPolicySha256,
    })
    return snapshot
  }

  // the retained revision head stays immutable while this response-local head
  // carries the current ephemeral snapshot CAS identity
  #currentCapabilityHead(): HeadProjectionV1
  {
    const retainedHead = this.#revisions.at(-1)!.head
    const snapshot = this.#capabilitySnapshot(retainedHead)
    return {
      ...retainedHead,
      capabilitySnapshotSha256: snapshot.capabilitySnapshotSha256,
    }
  }

  async #transactionInput(
    canonicalTransaction: unknown
  ): Promise<EditTransactionInputV1>
  {
    const current = this.#revisions.at(-1)!
    const history = historyProjectionV1(
      this.semanticSourceSha256,
      this.#revisions
    )
    return {
      sessionId: this.sessionId,
      sourceBytes: this.#sourceBytes,
      currentBytes: await this.#currentCandidateBytes(),
      semanticSourceSha256: this.semanticSourceSha256,
      semanticSourceIdentity: this.#manifest.semanticSourceIdentity,
      sourceArtifactSha256: this.#manifest.sourceArtifactSha256,
      currentHead: current.head,
      currentRevision: current,
      acceptedHistorySha256: history.sha256,
      changeContractSha256: this.#manifest.changeContractSha256,
      changeContract: this.#contract.registration
        .semanticContract as EditSemanticChangeContractV1,
      resourceLimits: structuredClone(this.#manifest.transactionResourceLimits),
      canonicalTransaction,
      resolveAdmittedAsset: this.#assets.resolver(),
      verifyHandle: (request) =>
        verifyEditHandleV1(
          request.token,
          {
            sessionId: this.sessionId,
            revisionId: current.head.revisionId,
            revisionNumber: current.head.revisionNumber,
            entityKind: request.entityKind,
            entitySubtype: request.entitySubtype,
            lineageSha256: request.lineageSha256,
            semanticLocationSha256: request.semanticLocationSha256,
            semanticFingerprintSha256: request.semanticFingerprintSha256,
            handleEpoch: this.#handleEpoch,
          },
          this.#handleSecret
        ),
    }
  }

  #effectiveArtifactByteLimit(): number
  {
    return Math.min(
      this.#policy.artifactByteLimit,
      this.#contract.effectiveLimits.artifactBytesPerSessionLimit
    )
  }

  #effectiveEvaluationRunLimit(): number
  {
    return Math.min(
      this.#policy.evaluationRunLimit,
      this.#contract.effectiveLimits.evaluationAttemptsPerSessionLimit
    )
  }

  async #retainSessionImmutable(
    logicalKey: string,
    bytes: Uint8Array
  ): Promise<EditArtifactIdentityV1>
  {
    const existingBytes = this.#retainedArtifactBytesByKey.get(logicalKey)
    if (existingBytes === undefined)
    {
      const prospective = this.#budget.artifactBytesUsed + bytes.byteLength
      if (prospective > this.#effectiveArtifactByteLimit())
        throw new EditSessionErrorV1(
          'edit.artifact_quota_exceeded',
          'retaining immutable session evidence would exceed the artifact ceiling'
        )
    }
    const identity = await retainImmutable(this.#store, logicalKey, bytes)
    if (existingBytes === undefined)
    {
      this.#retainedArtifactBytesByKey.set(logicalKey, identity.byteLength)
      this.#budget = {
        ...this.#budget,
        artifactBytesUsed: this.#budget.artifactBytesUsed + identity.byteLength,
      }
    }
    else if (existingBytes !== identity.byteLength)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'retained artifact byte length changed for an immutable key'
      )
    return identity
  }

  async #removeEvictableSessionArtifact(
    logicalKey: string,
    expectedSha256: string
  ): Promise<void>
  {
    await this.#store.removeEvictable(logicalKey, expectedSha256)
    const byteLength = this.#retainedArtifactBytesByKey.get(logicalKey)
    if (byteLength === undefined) return
    this.#retainedArtifactBytesByKey.delete(logicalKey)
    this.#budget = {
      ...this.#budget,
      artifactBytesUsed: this.#budget.artifactBytesUsed - byteLength,
    }
  }

  #assertTransactionResourceLimits(
    transaction: EditKernelTransactionResultV1
  ): EditTransactionResourceUsageV1
  {
    const operationLimit = Math.min(
      this.#policy.acceptedOperationLimit,
      this.#contract.effectiveLimits.operationsPerBatchLimit
    )
    if (transaction.operationCount > operationLimit)
      throw new EditSessionErrorV1(
        'edit.session_budget_exceeded',
        'transaction exceeds the bound operations-per-batch limit',
        false,
        { limit: operationLimit, observed: transaction.operationCount }
      )
    if (
      this.#budget.acceptedOperations + transaction.operationCount >
      this.#policy.acceptedOperationLimit
    )
      throw new EditSessionErrorV1(
        'edit.session_budget_exceeded',
        'cumulative accepted-operation capacity would be exceeded',
        false,
        {
          limit: this.#policy.acceptedOperationLimit,
          observed:
            this.#budget.acceptedOperations + transaction.operationCount,
        }
      )
    const usage = projectDeltaResourceUsageV1(transaction.parentDelta)
    const limits = [
      {
        name: 'block records touched',
        observed: usage.impact,
        limit: this.#manifest.transactionResourceLimits.touchedBlockRecords,
      },
      {
        name: 'targets touched',
        observed: usage.targets,
        limit: this.#manifest.transactionResourceLimits.touchedTargets,
      },
      {
        name: 'scripts touched',
        observed: usage.scripts,
        limit: this.#manifest.transactionResourceLimits.touchedScripts,
      },
      {
        name: 'declarations touched',
        observed: usage.declarations,
        limit: this.#manifest.transactionResourceLimits.touchedDeclarations,
      },
      {
        name: 'comments touched',
        observed: usage.comments,
        limit: this.#manifest.transactionResourceLimits.touchedComments,
      },
      {
        name: 'media touched',
        observed: usage.media,
        limit: this.#manifest.transactionResourceLimits.touchedMedia,
      },
    ] as const
    const exceeded = limits.find((entry) => entry.observed > entry.limit)
    if (exceeded !== undefined)
      throw new EditSessionErrorV1(
        'edit.impact_budget_exceeded',
        `transaction exceeds the ${exceeded.name} limit`,
        false,
        { limit: exceeded.limit, observed: exceeded.observed }
      )
    return usage
  }

  async #executeTransaction(
    canonicalTransaction: unknown
  ): Promise<ExecutedEditTransactionV1>
  {
    const semanticInspection = inspectSemanticEditBatchV1(
      canonicalTransaction,
      {
        maximumBlockNodes:
          this.#manifest.transactionResourceLimits.describedBlockNodes,
      }
    )
    if (
      semanticInspection.metrics.describedBlockNodes >
      this.#manifest.transactionResourceLimits.describedBlockNodes
    )
      throw new EditSessionErrorV1(
        'edit.intent_budget_exceeded',
        'transaction exceeds the bound described-block-node limit',
        false,
        {
          limit: this.#manifest.transactionResourceLimits.describedBlockNodes,
          observed: semanticInspection.metrics.describedBlockNodes,
        }
      )
    const transaction = await this.#transactionExecutor
      .execute(await this.#transactionInput(canonicalTransaction))
      .catch(async (error: unknown) =>
      {
        const record =
          error !== null && typeof error === 'object'
            ? (error as Record<string, unknown>)
            : null
        const code = record?.['code']
        if (typeof code === 'string' && EDIT_SESSION_ERROR_CODES.has(code))
        {
          let context =
            record?.['context'] !== null &&
            typeof record?.['context'] === 'object'
              ? (structuredClone(record['context']) as RefusalContextV1)
              : {}
          if (code === 'edit.static_regression')
          {
            if (
              !(error instanceof ProductionTransactionErrorV1) ||
              error.evidence?.kind !== 'edit-static-regression-evidence-v1'
            )
              throw new EditSessionErrorV1(
                'edit.internal_invariant',
                'static-regression refusal has no production evidence payload'
              )
            context = {
              evidenceId: await this.#retainStaticRegressionEvidence(
                error.evidence
              ),
            }
          }
          throw new EditSessionErrorV1(
            code as EditSessionErrorCodeV1,
            error instanceof Error ? error.message : String(error),
            false,
            context
          )
        }
        throw error
      })
    if (containsRetainedHandleRef(transaction.canonicalTransaction))
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'transaction executor returned replay authority containing a live handle'
      )
    const assetMaterializationUsage =
      transaction.assetMaterializationUsage ??
      EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1
    this.#assets.prospectiveMaterializationLedger(assetMaterializationUsage)
    const resourceUsage = this.#assertTransactionResourceLimits(transaction)
    return Object.freeze({
      ...transaction,
      assetMaterializationUsage,
      resourceUsage,
      describedBlockNodes: semanticInspection.metrics.describedBlockNodes,
    })
  }

  #nextRevisionFromTransaction(
    transaction: EditKernelTransactionResultV1,
    requestId: string,
    invocation: HostInvocationContextV1
  ): EditKernelRevisionRecordV1
  {
    const current = this.#revisions.at(-1)!
    const record = buildAppliedRevisionV1(
      {
        semanticSourceSha256: this.semanticSourceSha256,
        sourceArtifactSha256: this.#manifest.sourceArtifactSha256,
        changeContractSha256: this.#manifest.changeContractSha256,
        capabilityProfileSha256: this.#manifest.capabilityProfileSha256,
        capabilitySnapshotSha256: ZERO_SHA256,
        originatingRequestId: requestId,
        invocationCorrelation: asInvocationCorrelation(invocation),
        hostTimestampEpochMs: this.#clock.nowEpochMs(),
      },
      current,
      transaction,
      '',
      '',
      transaction.candidateProjectJsonSha256,
      transaction.candidateAssetManifestSha256
    )
    record.candidateKey = this.#layout.revision(
      record.head.revisionNumber,
      record.head.revisionId,
      'candidate.sb3'
    )
    record.manifestKey = this.#layout.revision(
      record.head.revisionNumber,
      record.head.revisionId,
      'manifest.json'
    )
    const capabilitySnapshot = this.#capabilitySnapshot(record.head)
    record.head = {
      ...record.head,
      capabilitySnapshotSha256: capabilitySnapshot.capabilitySnapshotSha256,
    }
    record.capabilitySnapshot = capabilitySnapshot
    return record
  }

  async #retainPublicResource(
    logicalKey: string,
    bytes: Uint8Array,
    mimeType: EditRetainedResourceMimeTypeV1
  ): Promise<EditArtifactIdentityV1>
  {
    const identity = await this.#retainSessionImmutable(logicalKey, bytes)
    if (this.#resourceCatalogue === null) return identity
    try
    {
      await this.#resourceCatalogue.retain({
        sessionId: this.sessionId,
        sessionKey: this.#manifest.sessionKey,
        logicalKey,
        identity,
        mimeType,
      })
      return identity
    }
    catch (error)
    {
      this.#state = 'recovery-required'
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        `retained resource catalogue publication requires recovery: ${
          error instanceof Error ? error.message : String(error)
        }`,
        true
      )
    }
  }

  async #retainStaticRegressionEvidence(
    evidence: ProductionStaticRegressionEvidenceV1
  ): Promise<string>
  {
    const currentHead = this.#revisions.at(-1)!.head
    if (
      evidence.schemaVersion !== 1 ||
      evidence.kind !== 'edit-static-regression-evidence-v1' ||
      evidence.sessionId !== this.sessionId ||
      !sameHeadV1(evidence.currentHead, currentHead) ||
      !/^[0-9a-f]{64}$/u.test(evidence.rejectedCandidateSha256) ||
      !Number.isSafeInteger(evidence.rejectedCandidateByteLength) ||
      evidence.rejectedCandidateByteLength < 0 ||
      evidence.rejectedCandidateSha256 === currentHead.candidateSha256 ||
      !Array.isArray(evidence.newStatic) ||
      evidence.newStatic.length === 0 ||
      evidence.newStatic.some(
        (diagnostic) =>
          diagnostic.kind !== 'diagnostic' || diagnostic.source !== 'static'
      ) ||
      evidence.newStaticSha256 !== editCanonicalSha256V1(evidence.newStatic)
    )
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'static-regression evidence does not bind the rejected transaction'
      )
    const bytes = editCanonicalBytesV1(evidence)
    if (
      bytes.byteLength >
      DEFAULT_PHASE_8_RESOURCE_POLICY.readableArtifactResourceRawBytes
    )
      throw new EditSessionErrorV1(
        'edit.artifact_quota_exceeded',
        'static-regression evidence exceeds the public resource byte ceiling'
      )
    const evidenceId = sha256Hex(bytes)
    const retained = await this.#retainPublicResource(
      this.#layout.refusalEvidence(evidenceId),
      bytes,
      'application/json'
    )
    if (
      retained.sha256 !== evidenceId ||
      retained.byteLength !== bytes.byteLength
    )
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'retained static-regression evidence identity differs'
      )
    return evidenceId
  }

  async #writeRevision(
    record: EditKernelRevisionRecordV1,
    candidateBytes: Uint8Array
  ): Promise<number>
  {
    const number = record.head.revisionNumber
    const id = record.head.revisionId
    let retainedBytes = 0
    const writeBytes = async (
      name: string,
      bytes: Uint8Array,
      mimeType: EditRetainedResourceMimeTypeV1
    ): Promise<void> =>
    {
      const retained = await this.#retainPublicResource(
        this.#layout.revision(number, id, name),
        bytes,
        mimeType
      )
      retainedBytes += retained.byteLength
    }
    const write = async (name: string, value: unknown): Promise<void> =>
      writeBytes(name, editCanonicalBytesV1(value), 'application/json')
    await writeBytes(
      'candidate.sb3',
      candidateBytes,
      'application/x.scratch.sb3'
    )
    await write('batch.json', record.transitionDescriptor)
    await write('resolved-plan.json', {
      resolvedPlanSha256:
        record.revision.hashProjection.transition.transitionKind === 'apply'
          ? record.revision.hashProjection.transition.resolvedPlanSha256
          : null,
    })
    await write('operation-results.json', record.operationResults)
    await write('previous-delta.json', record.parentDelta)
    await write('cumulative-delta.json', record.cumulativeDelta)
    await write('preservation.json', record.preservation)
    await write('authorization.json', record.authorization)
    await write('diagnostics.json', record.diagnostics)
    await write('allocator.json', record.allocatorState)
    await write('lineage.json', record.activeLineage)
    await write('lineage-history.json', record.lineageHistory)
    await write('capability-snapshot.json', record.capabilitySnapshot)
    await write('manifest.json', record)
    return retainedBytes
  }

  async #appendEvent(
    eventKind:
      | 'asset-admitted'
      | 'preview-recorded'
      | 'checkpoint-recorded'
      | 'transition-prepared'
      | 'transition-committed'
      | 'transition-aborted'
      | 'evaluation-recorded'
      | 'session-closed',
    preHead: HeadProjectionV1,
    postHead: HeadProjectionV1,
    payload: unknown,
    invocation: HostInvocationContextV1
  ): Promise<EditKernelSemanticEventV1>
  {
    const projection = {
      schemaVersion: 1 as const,
      sessionId: this.sessionId,
      sequence: this.#events.length,
      eventKind,
      previousEventSha256: this.#events.at(-1)?.eventSha256,
      preHead: {
        state: 'present' as const,
        head: exactRevisionFromHeadV1(preHead),
      },
      postHead: exactRevisionFromHeadV1(postHead),
      semanticPayloadSha256: editCanonicalSha256V1(payload),
      invocationCorrelation: asInvocationCorrelation(invocation),
    }
    const eventSha256 = semanticHashV1('semantic-event', projection)
    const event: EditKernelSemanticEventV1 = {
      projection,
      eventSha256,
      hostTimestampEpochMs: this.#clock.nowEpochMs(),
    }
    await this.#appendExactEvent(event)
    return event
  }

  async #appendExactEvent(event: EditKernelSemanticEventV1): Promise<void>
  {
    if (
      event.projection.sequence !== this.#events.length ||
      event.projection.previousEventSha256 !==
        this.#events.at(-1)?.eventSha256 ||
      semanticHashV1('semantic-event', event.projection) !== event.eventSha256
    )
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'prepared semantic event differs from the current event chain'
      )
    await this.#retainPublicResource(
      this.#layout.event(event.projection.sequence, event.eventSha256),
      editCanonicalBytesV1(event),
      'application/json'
    )
    this.#events.push(event)
  }

  #limitations(): readonly string[]
  {
    return editSessionLimitationsV1({
      evaluationPorts: this.#evaluationPorts,
      publicationPort: this.#publicationPort,
    })
  }

  #currentReportEvidenceId(): string
  {
    return editCanonicalSha256V1(this.#reports.at(-1)!)
  }

  #buildReport(
    state: EditKernelStateV1,
    evaluation?: {
      certificates: readonly EditRetainedCertificateV1[]
      state: EditEvaluationStateV1
    }
  ): EditKernelReportV1
  {
    const certificates = evaluation?.certificates ?? this.#certificates
    const evaluationState = evaluation?.state ?? this.#evaluationState
    const semantic = semanticReportProjectionV1(
      this.semanticSourceSha256,
      this.#manifest.changeContractSha256,
      this.#manifest.capabilityProfileSha256,
      this.#revisions,
      certificateSetProjectionV1(certificates).sha256
    )
    return {
      semanticProjection: semantic.projection,
      semanticProjectionSha256: semantic.sha256,
      reportArtifactSha256: editCanonicalSha256V1(semantic.projection),
      reportSequence: this.#reports.length,
      state,
      budget: structuredClone(this.#budget),
      eventHeadSha256: this.#events.at(-1)!.eventSha256,
      revisionCount: this.#revisions.length,
      attemptCount: this.#attempts.length,
      checkpointCount: this.#checkpoints.size,
      previewCount: this.#previews.size,
      certificateCount: certificates.length,
      evaluationState,
      exportState: this.#exportState,
      limitations: this.#limitations(),
      generatedAtEpochMs: this.#clock.nowEpochMs(),
    }
  }

  async #retainReport(
    report: EditKernelReportV1,
    advancePointer: boolean
  ): Promise<{ report: EditKernelReportV1; identity: EditArtifactIdentityV1 }>
  {
    const currentArtifactBytes = this.#budget.artifactBytesUsed
    let projectedArtifactBytes = currentArtifactBytes
    let projectedReport = report
    let reportBytes: Uint8Array = new Uint8Array()
    let reportJsonSha256 = ''
    let markdownBytes: Uint8Array = new Uint8Array()
    let manifestBytes: Uint8Array = new Uint8Array()
    for (let iteration = 0; iteration < 16; iteration += 1)
    {
      projectedReport = {
        ...report,
        budget: {
          ...report.budget,
          artifactBytesUsed: projectedArtifactBytes,
        },
      }
      reportBytes = editCanonicalBytesV1(projectedReport)
      reportJsonSha256 = sha256Hex(reportBytes)
      markdownBytes = new TextEncoder().encode(
        [
          '# Phase 8 Edit Session Report',
          '',
          `- state: ${projectedReport.state}`,
          `- revision count: ${projectedReport.revisionCount}`,
          `- semantic report: ${projectedReport.semanticProjectionSha256}`,
          `- event head: ${projectedReport.eventHeadSha256}`,
          '',
        ].join('\n')
      )
      manifestBytes = editCanonicalBytesV1({
        schemaVersion: 1,
        reportJsonSha256,
        reportByteLength: reportBytes.byteLength,
        semanticProjectionSha256: projectedReport.semanticProjectionSha256,
      })
      const artifacts = [
        [this.#layout.report(reportJsonSha256, 'report.json'), reportBytes],
        [
          this.#layout.report(reportJsonSha256, 'semantic-projection.json'),
          editCanonicalBytesV1(projectedReport.semanticProjection),
        ],
        [this.#layout.report(reportJsonSha256, 'report.md'), markdownBytes],
        [this.#layout.report(reportJsonSha256, 'manifest.json'), manifestBytes],
      ] as const
      const nextArtifactBytes =
        currentArtifactBytes +
        artifacts.reduce(
          (total, [key, bytes]) =>
            total +
            (this.#retainedArtifactBytesByKey.has(key) ? 0 : bytes.byteLength),
          0
        )
      if (nextArtifactBytes === projectedArtifactBytes) break
      projectedArtifactBytes = nextArtifactBytes
      if (iteration === 15)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'report artifact budget did not reach a fixed point'
        )
    }
    report = projectedReport
    if (projectedArtifactBytes > this.#effectiveArtifactByteLimit())
      throw new EditSessionErrorV1(
        'edit.artifact_quota_exceeded',
        'retaining the report bundle would exceed the artifact ceiling'
      )
    await this.#retainPublicResource(
      this.#layout.report(reportJsonSha256, 'report.json'),
      reportBytes,
      'application/json'
    )
    await this.#retainPublicResource(
      this.#layout.report(reportJsonSha256, 'semantic-projection.json'),
      editCanonicalBytesV1(report.semanticProjection),
      'application/json'
    )
    await this.#retainPublicResource(
      this.#layout.report(reportJsonSha256, 'report.md'),
      markdownBytes,
      'text/markdown; charset=utf-8'
    )
    const manifest = await this.#retainPublicResource(
      this.#layout.report(reportJsonSha256, 'manifest.json'),
      manifestBytes,
      'application/json'
    )
    if (advancePointer)
    {
      const pointer = await compareAndReconcilePointer(
        this.#store,
        this.#layout.currentReport,
        this.#reportPointerSha256,
        editCanonicalBytesV1({
          schemaVersion: 1,
          reportJsonSha256,
          reportManifestSha256: manifest.sha256,
        })
      )
      this.#reportPointerSha256 = pointer.sha256
      this.#reports.push(report)
    }
    return {
      report,
      identity: {
        sha256: reportJsonSha256,
        byteLength: reportBytes.byteLength,
      },
    }
  }

  async #commitRevision(
    record: EditKernelRevisionRecordV1,
    candidateBytes: Uint8Array,
    invocation: HostInvocationContextV1,
    transactionMetrics: Pick<
      ExecutedEditTransactionV1,
      'resourceUsage' | 'describedBlockNodes'
    > | null,
    appliedPreviewId?: string,
    assetMaterializationUsage: AssetMaterializationUsageDeltaV1 = EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1
  ): Promise<CommitOutcomeV1>
  {
    const previous = this.#revisions.at(-1)!
    const reservationId = editCanonicalSha256V1({
      sessionId: this.sessionId,
      revisionId: record.head.revisionId,
      purpose: 'revision-commit',
    })
    const estimatedBytes =
      candidateBytes.byteLength + editCanonicalBytesV1(record).byteLength * 3
    const pendingAttempt = this.#attempts.find(
      (attempt) =>
        attempt.state === 'pending' &&
        attempt.requestId === record.revision.originatingRequestId
    )
    if (pendingAttempt === undefined)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'revision commit has no pending attempt recovery authority'
      )
    await this.#retainSessionImmutable(
      this.#layout.attempt(
        pendingAttempt.sequence,
        pendingAttempt.requestSha256,
        'revision-recovery-authority.json'
      ),
      editCanonicalBytesV1({
        schemaVersion: 1,
        kind: 'edit-revision-recovery-authority-v1',
        namespaceSha256: pendingAttempt.namespaceSha256,
        requestSha256: pendingAttempt.requestSha256,
        revisionId: record.head.revisionId,
        revisionNumber: record.head.revisionNumber,
        revisionManifestSha256: editCanonicalSha256V1(record),
        previousHead: exactRevisionFromHeadV1(previous.head),
        proposedHead: exactRevisionFromHeadV1(record.head),
        reservationId,
        reservedBytes: estimatedBytes,
        invocationCorrelation: asInvocationCorrelation(invocation),
      })
    )
    await this.#store.reserveQuota(reservationId, estimatedBytes)
    let headCommitted = false
    let retainedBytes = 0
    let preparedEvent: EditKernelSemanticEventV1 | null = null
    try
    {
      retainedBytes = await this.#writeRevision(record, candidateBytes)
      const acceptedOperationIncrement =
        record.transitionDescriptor.kind === 'apply'
          ? record.transitionDescriptor.operationCount
          : 0
      const resourceUsage =
        record.transitionDescriptor.kind === 'apply'
          ? transactionMetrics!.resourceUsage
          : { impact: 0 }
      const describedBlockNodeCount =
        record.transitionDescriptor.kind === 'apply'
          ? transactionMetrics!.describedBlockNodes
          : 0
      const postCommitBudget: EditKernelBudgetV1 = {
        ...this.#budget,
        artifactBytesUsed: this.#budget.artifactBytesUsed,
        acceptedRevisions: record.head.revisionNumber + 1,
        acceptedOperations:
          this.#budget.acceptedOperations + acceptedOperationIncrement,
        intentUsed: this.#budget.intentUsed + describedBlockNodeCount,
        impactUsed: this.#budget.impactUsed + resourceUsage.impact,
        retainedPreviews: 0,
        restoreReserveHeld:
          record.head.revisionNumber + 1 < this.#policy.acceptedRevisionLimit,
      }
      await this.#retainSessionImmutable(
        this.#layout.attempt(
          pendingAttempt.sequence,
          pendingAttempt.requestSha256,
          'revision-retained-authority.json'
        ),
        editCanonicalBytesV1({
          schemaVersion: 1,
          kind: 'edit-revision-retained-authority-v1',
          namespaceSha256: pendingAttempt.namespaceSha256,
          revisionId: record.head.revisionId,
          reservationId,
          retainedBytes,
          postCommitBudget,
        })
      )
      preparedEvent = await this.#appendEvent(
        'transition-prepared',
        previous.head,
        record.head,
        record.revision.hashProjection,
        invocation
      )
      const preparedReport = this.#buildReport('active')
      await this.#retainReport(preparedReport, false)
      const pointer = await compareAndReconcilePointer(
        this.#store,
        this.#layout.head,
        this.#headPointerSha256,
        editCanonicalBytesV1({
          schemaVersion: 1,
          head: record.head,
          revisionManifestSha256: await this.#store.hashImmutable(
            record.manifestKey
          ),
        })
      )
      headCommitted = true
      this.#headPointerSha256 = pointer.sha256
      this.#assets.commitMaterializationUsage(assetMaterializationUsage)
      this.#assetMaterializationRevisionIds.add(record.head.revisionId)
      this.#revisions.push(record)
      this.#budget = postCommitBudget
      this.#handleEpoch += 1
      const removedPreviewKeys = new Set<string>()
      for (const preview of this.#previews.values())
      {
        if (preview.state !== 'unapplied') continue
        if (!removedPreviewKeys.has(preview.candidateCacheKey))
        {
          await this.#removeEvictableSessionArtifact(
            preview.candidateCacheKey,
            preview.predictedCandidateSha256
          )
          removedPreviewKeys.add(preview.candidateCacheKey)
        }
        preview.state =
          preview.previewId === appliedPreviewId ? 'applied' : 'invalidated'
      }
      const committedEvent = await this.#appendEvent(
        'transition-committed',
        previous.head,
        record.head,
        {
          revisionId: record.head.revisionId,
          preparedEventSha256: preparedEvent.eventSha256,
        },
        invocation
      )
      const retainedReport = await this.#retainReport(
        this.#buildReport('active'),
        true
      )
      await this.#store.settleQuota(reservationId, retainedBytes)
      return {
        preparedEvent,
        committedEvent,
        report: retainedReport.report,
      }
    }
    catch (error)
    {
      if (!headCommitted)
      {
        await this.#store.releaseQuota(reservationId).catch(() => undefined)
        if (preparedEvent !== null)
        {
          await this.#appendEvent(
            'transition-aborted',
            previous.head,
            previous.head,
            {
              preparedEventSha256: preparedEvent.eventSha256,
              proposedRevisionId: record.head.revisionId,
              failureSha256: editCanonicalSha256V1({
                code: errorCode(error),
                message: error instanceof Error ? error.message : String(error),
              }),
            },
            invocation
          ).catch(() => undefined)
        }
        throw error
      }
      if (this.#revisions.at(-1)?.head.revisionId !== record.head.revisionId)
      {
        this.#revisions.push(record)
        this.#handleEpoch += 1
      }
      if (!this.#assetMaterializationRevisionIds.has(record.head.revisionId))
      {
        this.#assets.commitMaterializationUsage(assetMaterializationUsage)
        this.#assetMaterializationRevisionIds.add(record.head.revisionId)
      }
      if (this.#budget.acceptedRevisions < this.#revisions.length)
      {
        const acceptedOperations = this.#revisions.reduce(
          (total, entry) =>
            total +
            (entry.transitionDescriptor.kind === 'apply'
              ? entry.transitionDescriptor.operationCount
              : 0),
          0
        )
        const resourceUsage = this.#revisions.reduce(
          (total, entry) =>
          {
            if (entry.transitionDescriptor.kind !== 'apply') return total
            const usage = projectDeltaResourceUsageV1(entry.parentDelta)
            return {
              intent:
                total.intent +
                inspectSemanticEditBatchV1(
                  entry.transitionDescriptor.canonicalTransaction
                ).metrics.describedBlockNodes,
              impact: total.impact + usage.impact,
            }
          },
          { intent: 0, impact: 0 }
        )
        this.#budget = {
          ...this.#budget,
          acceptedRevisions: this.#revisions.length,
          acceptedOperations,
          intentUsed: resourceUsage.intent,
          impactUsed: resourceUsage.impact,
          restoreReserveHeld:
            this.#revisions.length < this.#policy.acceptedRevisionLimit,
        }
      }
      this.#state = 'recovery-required'
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        `head committed but completion evidence requires reconciliation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        true
      )
    }
  }

  async pollStatusV1(
    invocation: HostInvocationContextV1
  ): Promise<EditStatusDomainResultV1>
  {
    if (this.#state !== 'active' || this.#busyKind !== null)
      return this.#statusSnapshotV1()
    try
    {
      return await this.#withTransition('status', invocation, async () =>
        this.#statusSnapshotV1(null)
      )
    }
    catch (error)
    {
      const status = this.#statusSnapshotV1(null)
      if (
        error instanceof EditSessionErrorV1 &&
        error.code === 'edit.interrupted' &&
        status.state === 'closed-abandoned'
      )
        return status
      throw error
    }
  }

  status(): EditStatusDomainResultV1
  {
    return this.#statusSnapshotV1()
  }

  #statusSnapshotV1(
    busyKind: string | null = this.#busyKind
  ): EditStatusDomainResultV1
  {
    const exportability = this.exportability()
    const head = this.#currentCapabilityHead()
    const now = this.#clock.nowEpochMs()
    const expiredAwaiting = [...this.#awaitingEvaluations.values()].some(
      (awaiting) => now > awaiting.deadlineEpochMs
    )
    const currentHeadAwaiting = [...this.#awaitingEvaluations.values()].some(
      (awaiting) =>
        awaiting.revision.revisionId === head.revisionId &&
        awaiting.revision.revisionNumber === head.revisionNumber &&
        awaiting.revision.candidateSha256 === head.candidateSha256
    )
    const awaitingEvaluations = [...this.#awaitingEvaluations.values()]
      .filter((awaiting) => now <= awaiting.deadlineEpochMs)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, 16)
      .map((awaiting): EditAwaitingEvaluationStatusV1 =>
      {
        const requiredHostAction = Object.freeze({
          kind: 'stageExternalEvidence' as const,
          evaluationId: awaiting.evaluationId,
          requestArtifactIds: Object.freeze([...awaiting.requestArtifactIds]),
          requestSetSha256: awaiting.requestSetSha256,
          deadlineSha256: awaiting.deadlineSha256,
          notificationSha256: awaiting.notificationSha256,
        })
        return Object.freeze({
          evaluationId: awaiting.evaluationId,
          evaluationAttemptSha256: awaiting.attemptSha256,
          evaluatedRevision: structuredClone(awaiting.revision),
          requestArtifactIds: requiredHostAction.requestArtifactIds,
          requestSetSha256: awaiting.requestSetSha256,
          deadlineSha256: awaiting.deadlineSha256,
          notificationSha256: awaiting.notificationSha256,
          requiredHostAction,
        })
      })
    return {
      sessionId: this.sessionId,
      state: this.#state,
      head,
      busyKind,
      evaluationState: expiredAwaiting ? 'inconclusive' : this.#evaluationState,
      exportState: this.#exportState,
      exportReady:
        this.#state === 'active' &&
        this.#exportState === 'available' &&
        !currentHeadAwaiting &&
        exportability.exportable,
      exportability,
      budget: structuredClone(this.#budget),
      eventHeadSha256: this.#events.at(-1)!.eventSha256,
      reportSha256: this.#reports.at(-1)!.semanticProjectionSha256,
      handleEpoch: this.#handleEpoch,
      capabilityProfileSha256: this.#manifest.capabilityProfileSha256,
      capabilitySnapshotSha256: head.capabilitySnapshotSha256,
      awaitingEvaluations: Object.freeze(awaitingEvaluations),
    }
  }

  // * read-only discovery of an already-retained outcome. A lost response is
  // * re-found rather than re-executed, so this appends no attempt, event,
  // * revision, or report & never advances a counter
  lookupIdempotentOutcomeV1(input: {
    toolName: string
    requestId: string
    principalSha256: string
  }): EditIdempotentOutcomeProjectionV1 | null
  {
    const namespaceSha256 = this.#namespaceSha256(
      input.toolName,
      input.requestId,
      input.principalSha256
    )
    const outcome = this.#idempotency.get(namespaceSha256)
    if (!outcome) return null
    return Object.freeze({
      namespaceSha256,
      requestSha256: outcome.requestSha256,
      classification: outcome.attempt.state,
      attemptId: outcome.attempt.attemptId,
      attemptSequence: outcome.attempt.sequence,
      toolName: outcome.attempt.toolName,
      requestId: outcome.attempt.requestId,
      sessionId: this.sessionId,
      preHead: outcome.attempt.preHead,
      postHead: outcome.attempt.postHead,
      retainedOutcomeSha256: outcome.attempt.resultSha256 ?? null,
      refusalCode: outcome.attempt.refusalCode ?? null,
    })
  }

  // the transport identity carries an event sequence the domain results do not
  // return, so it is resolved from the retained event chain by hash
  eventIdentityV1(eventSha256: string): {
    eventSha256: string
    sequence: number
  } | null
  {
    const event = this.#events.find(
      (entry) => entry.eventSha256 === eventSha256
    )
    return event ? { eventSha256, sequence: event.projection.sequence } : null
  }

  async inspect(input: {
    revisionNumber?: number
    revisionId?: string
    issueHandles: boolean
    entityKinds?: readonly EditInspectDomainItemV1['entityKind'][]
  }): Promise<EditInspectDomainResultV1>
  {
    if (
      (input.revisionNumber === undefined) !==
      (input.revisionId === undefined)
    )
      throw new EditSessionErrorV1(
        'edit.invalid_payload',
        'historical inspection requires both revision number and revision ID'
      )
    const revision =
      input.revisionNumber === undefined
        ? this.#revisions.at(-1)!
        : this.#revisions.find(
            (entry) =>
              entry.head.revisionNumber === input.revisionNumber &&
              entry.head.revisionId === input.revisionId
          )
    if (!revision)
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'requested revision is not retained',
        false,
        {
          expectedRevisionId: input.revisionId!,
          currentRevisionId: this.head.revisionId,
        }
      )
    const historical = revision !== this.#revisions.at(-1)
    if (historical && input.issueHandles)
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'historical inspection cannot issue fresh handles',
        false,
        {
          expectedRevisionId: revision.head.revisionId,
          currentRevisionId: this.head.revisionId,
        }
      )
    const bytes = await this.#store.readImmutable(revision.candidateKey)
    const preflight = await inspectSemanticEditArtifact(bytes)
    if (!preflight.ok || !preflight.project)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'retained revision no longer passes semantic preflight'
      )
    const activeLineage = validateSemanticLineageSnapshot(
      revision.activeLineage as SemanticLineageSnapshot
    )
    const issueHandle = (
      entityKind: EditInspectDomainItemV1['entityKind'],
      entitySubtype: string,
      lineageSha256: string,
      semanticLocationSha256: string,
      semanticFingerprintSha256: string
    ): { readonly handle: string } | Record<string, never> =>
    {
      if (!input.issueHandles) return {}
      const binding: EditHandleBindingV1 = {
        sessionId: this.sessionId,
        revisionId: revision.head.revisionId,
        revisionNumber: revision.head.revisionNumber,
        entityKind,
        entitySubtype,
        lineageSha256,
        semanticLocationSha256,
        semanticFingerprintSha256,
        handleEpoch: this.#handleEpoch,
      }
      return { handle: issueEditHandleV1(binding, this.#handleSecret) }
    }
    const requestedEntityKinds =
      input.entityKinds === undefined ? null : new Set(input.entityKinds)
    const includesEntityKind = (
      entityKind: EditInspectDomainItemV1['entityKind']
    ): boolean =>
      requestedEntityKinds === null || requestedEntityKinds.has(entityKind)
    const targetEvidence = targetEntityEvidenceSetV1(preflight.project.json)
    const targetItems: readonly EditInspectTargetDomainItemV1[] =
      includesEntityKind('target')
        ? targetEvidence.map((evidence) =>
          {
            const location = targetBoundedLocationProjectionV1(
              evidence,
              inspectionLocationArtifactIdV1(
                'target',
                evidence.semanticLocationSha256
              )
            )
            return {
              entityKind: 'target',
              entitySubtype: evidence.targetKind,
              location,
              serializedTargetOrdinal: evidence.targetIndex,
              ...(evidence.visualLayerOrdinal === undefined
                ? {}
                : { visualLayerOrdinal: evidence.visualLayerOrdinal }),
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'target',
                evidence.targetKind,
                inspectionTargetLineageV1(
                  preflight.project!,
                  activeLineage,
                  evidence.targetIndex
                ).lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const declarationEvidence =
      includesEntityKind('declaration') ||
      includesEntityKind('topLevelPrimitive')
        ? declarationEntityEvidenceSetV1(preflight.project)
        : []
    const declarationItems: readonly EditInspectDeclarationDomainItemV1[] =
      includesEntityKind('declaration')
        ? declarationEvidence.map((evidence) =>
          {
            const location = declarationBoundedLocationProjectionV1(
              evidence,
              inspectionLocationArtifactIdV1(
                'declaration',
                evidence.semanticLocationSha256
              )
            )
            return {
              entityKind: 'declaration',
              entitySubtype: evidence.declarationKind,
              location,
              declarationKind: evidence.declarationKind,
              ...(evidence.declarationKind === 'variable'
                ? { cloud: evidence.cloud === true }
                : {}),
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'declaration',
                evidence.declarationKind,
                inspectionOwnedEntityLineageV1(
                  preflight.project!,
                  activeLineage,
                  'declaration',
                  evidence.targetIndex,
                  `${evidence.declarationKind}:${evidence.declarationId}`
                ).lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const procedureEvidence = includesEntityKind('procedure')
      ? procedureEntityEvidenceSetV1(preflight.project)
      : []
    const procedureItems: readonly EditInspectProcedureDomainItemV1[] =
      procedureEvidence.map((evidence) =>
      {
        const targetLineage = inspectionTargetLineageV1(
          preflight.project!,
          activeLineage,
          evidence.targetIndex
        )
        const location: BoundedProcedureLocationProjectionV1 = {
          kind: 'procedure',
          targetLocationSha256:
            targetEvidence[evidence.targetIndex]!.semanticLocationSha256,
          canonicalSignature: boundedInspectionDisplayStringV1(
            evidence.proccode
          ),
          semanticFingerprint: evidence.semanticFingerprintSha256,
          fullLocationSha256: evidence.semanticLocationSha256,
          retainedLocationArtifactId: inspectionLocationArtifactIdV1(
            'procedure',
            evidence.semanticLocationSha256
          ),
        }
        const procedureLineage = inspectionProcedureLineageV1(
          activeLineage,
          targetLineage.lineageId,
          evidence.proccode
        )
        return {
          entityKind: 'procedure',
          entitySubtype: 'unspecialized',
          location,
          semanticLocationSha256: evidence.semanticLocationSha256,
          semanticFingerprintSha256: evidence.semanticFingerprintSha256,
          contextFingerprintSha256: evidence.contextFingerprintSha256,
          ...issueHandle(
            'procedure',
            'unspecialized',
            procedureLineage.lineageId,
            evidence.semanticLocationSha256,
            evidence.semanticFingerprintSha256
          ),
        }
      })
    const parameterItems: readonly EditInspectParameterDomainItemV1[] =
      includesEntityKind('parameter')
        ? parameterEntityEvidenceSetV1(preflight.project).map((evidence) =>
          {
            const targetLineage = inspectionTargetLineageV1(
              preflight.project!,
              activeLineage,
              evidence.targetIndex
            )
            const procedureLineage = inspectionProcedureLineageV1(
              activeLineage,
              targetLineage.lineageId,
              evidence.proccode
            )
            const location: BoundedParameterLocationProjectionV1 = {
              kind: 'parameter',
              procedureLocationSha256: semanticHashV1(
                'semantic-location',
                evidence.location.procedure
              ),
              name: boundedInspectionDisplayStringV1(evidence.location.name),
              parameterType: evidence.parameterType,
              ordinal: evidence.ordinal,
              semanticFingerprint: evidence.semanticFingerprintSha256,
              fullLocationSha256: evidence.semanticLocationSha256,
              retainedLocationArtifactId: inspectionLocationArtifactIdV1(
                'parameter',
                evidence.semanticLocationSha256
              ),
            }
            const parameterLineage = inspectionParameterLineageV1(
              activeLineage,
              procedureLineage.lineageId,
              evidence.argumentId
            )
            return {
              entityKind: 'parameter',
              entitySubtype: 'unspecialized',
              location,
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'parameter',
                'unspecialized',
                parameterLineage.lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const scriptEvidence =
      includesEntityKind('script') ||
      includesEntityKind('block') ||
      includesEntityKind('comment')
        ? scriptEntityEvidenceSetV1(preflight.project)
        : []
    const scriptItems: readonly EditInspectScriptDomainItemV1[] =
      includesEntityKind('script')
        ? scriptEvidence.map((evidence) =>
          {
            const location = scriptBoundedLocationProjectionV1(
              evidence,
              inspectionLocationArtifactIdV1(
                'script',
                evidence.semanticLocationSha256
              )
            )
            return {
              entityKind: 'script',
              entitySubtype: 'unspecialized',
              location,
              rootRole: evidence.rootRole,
              category: evidence.category,
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'script',
                'unspecialized',
                inspectionOwnedEntityLineageV1(
                  preflight.project!,
                  activeLineage,
                  'script',
                  evidence.targetIndex,
                  `script:${evidence.topBlockId}`
                ).lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const blockEvidence =
      includesEntityKind('block') || includesEntityKind('comment')
        ? blockEntityEvidenceSetV1(preflight.project, undefined, scriptEvidence)
        : []
    const blockItems: readonly EditInspectBlockDomainItemV1[] =
      includesEntityKind('block')
        ? blockEvidence.map((evidence) =>
          {
            const location = blockBoundedLocationProjectionV1(
              evidence,
              inspectionLocationArtifactIdV1(
                'block',
                evidence.semanticLocationSha256
              )
            )
            return {
              entityKind: 'block',
              entitySubtype: 'unspecialized',
              location,
              ownershipStatus: evidence.location.ownershipStatus,
              category: evidence.category,
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'block',
                'unspecialized',
                inspectionOwnedEntityLineageV1(
                  preflight.project!,
                  activeLineage,
                  'block',
                  evidence.targetIndex,
                  `block:${evidence.blockId}`
                ).lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const primitiveCollections = includesEntityKind('topLevelPrimitive')
      ? preflight.project.json.targets.map((target, targetIndex) =>
          Object.entries(target.blocks).flatMap(([blockId, raw]) =>
            {
            if (!Array.isArray(raw) || (raw[0] !== 12 && raw[0] !== 13))
              return []
            const declarationKind = raw[0] === 12 ? 'variable' : 'list'
            const primitiveKind: 'variableReporter' | 'listReporter' =
              raw[0] === 12 ? 'variableReporter' : 'listReporter'
            const referencedName = String(raw[1])
            const referencedId = String(raw[2])
            const selectedDeclaration = declarationEvidence.find(
              (entry) =>
                entry.declarationKind === declarationKind &&
                entry.declarationId === referencedId &&
                (entry.targetIndex === targetIndex || entry.targetIndex === 0)
            )
            const rawReferenceSha256 = editCanonicalSha256V1({
              declarationKind,
              referencedId,
              referencedName,
            })
            const declaration = selectedDeclaration
              ? {
                  resolution: 'resolved' as const,
                  declarationLocationSha256:
                    selectedDeclaration.semanticLocationSha256,
                }
              : {
                  resolution: 'unresolved' as const,
                  referencedName,
                  rawReferenceSha256,
                  diagnosticFingerprint: semanticHashV1(
                    'semantic-fingerprint',
                    {
                      entityKind: 'top-level-primitive-unresolved-reference',
                      declarationKind,
                      referencedId,
                      referencedName,
                      targetIndex,
                    }
                  ),
                }
            const workspace = {
              x: primitiveOptionalNumberV1(raw, 3),
              y: primitiveOptionalNumberV1(raw, 4),
            }
            const semanticFingerprintSha256 = semanticHashV1(
              'semantic-fingerprint',
              {
                entityKind: 'topLevelPrimitive',
                primitiveKind,
                declaration,
                workspace,
              }
            )
            const fullLocation = {
              kind: 'topLevelPrimitive' as const,
              primitiveKind,
              targetLocationSha256:
                targetEvidence[targetIndex]!.semanticLocationSha256,
              declarationResolution: declaration.resolution,
              ...(declaration.resolution === 'resolved'
                ? {
                    declarationLocationSha256:
                      declaration.declarationLocationSha256,
                  }
                : {
                    referencedName: boundedInspectionDisplayStringV1(
                      declaration.referencedName
                    ),
                    rawReferenceSha256: declaration.rawReferenceSha256,
                    diagnosticFingerprint: declaration.diagnosticFingerprint,
                  }),
              workspace,
              semanticFingerprint: semanticFingerprintSha256,
            }
            const semanticLocationSha256 = semanticHashV1(
              'semantic-location',
              fullLocation
            )
            return [
              {
                targetIndex,
                blockId,
                primitiveKind,
                fullLocation,
                semanticLocationSha256,
                semanticFingerprintSha256,
              },
            ]
          })
        )
      : []
    const primitiveItems: readonly EditInspectTopLevelPrimitiveDomainItemV1[] =
      primitiveCollections.flatMap((collection) =>
      {
        const collectionProjection = collection.map((entry) => ({
          semanticLocationSha256: entry.semanticLocationSha256,
          semanticFingerprintSha256: entry.semanticFingerprintSha256,
        }))
        return collection.map((evidence, collectionOrdinal) =>
        {
          const contextFingerprintSha256 = semanticHashV1(
            'semantic-fingerprint',
            {
              entityKind: 'topLevelPrimitive-context',
              ordinal: collectionOrdinal,
              collection: collectionProjection,
            }
          )
          const location: BoundedTopLevelPrimitiveLocationProjectionV1 = {
            ...evidence.fullLocation,
            fullLocationSha256: evidence.semanticLocationSha256,
            retainedLocationArtifactId: inspectionLocationArtifactIdV1(
              'topLevelPrimitive',
              evidence.semanticLocationSha256
            ),
          }
          return {
            entityKind: 'topLevelPrimitive',
            entitySubtype: evidence.primitiveKind,
            location,
            semanticLocationSha256: evidence.semanticLocationSha256,
            semanticFingerprintSha256: evidence.semanticFingerprintSha256,
            contextFingerprintSha256,
            ...issueHandle(
              'topLevelPrimitive',
              evidence.primitiveKind,
              inspectionOwnedEntityLineageV1(
                preflight.project!,
                activeLineage,
                'block',
                evidence.targetIndex,
                `block:${evidence.blockId}`
              ).lineageId,
              evidence.semanticLocationSha256,
              evidence.semanticFingerprintSha256
            ),
          }
        })
      })
    const commentItems: readonly EditInspectCommentDomainItemV1[] =
      includesEntityKind('comment')
        ? commentEntityEvidenceSetV1(
            preflight.project,
            undefined,
            blockEvidence
          ).map((evidence) =>
            {
            const location = commentBoundedLocationProjectionV1(
              evidence,
              inspectionLocationArtifactIdV1(
                'comment',
                evidence.semanticLocationSha256
              )
            )
            return {
              entityKind: 'comment',
              entitySubtype: 'unspecialized',
              location,
              topologyStatus: evidence.topologyStatus,
              attachmentStatus: evidence.location.attachedBlock
                ? 'attached'
                : 'detached',
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'comment',
                'unspecialized',
                inspectionOwnedEntityLineageV1(
                  preflight.project!,
                  activeLineage,
                  'comment',
                  evidence.targetIndex,
                  `comment:${evidence.commentId}`
                ).lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const mediaItems: readonly EditInspectMediaDomainItemV1[] =
      includesEntityKind('media')
        ? mediaRecordEntityEvidenceSetV1(preflight.project).map((evidence) =>
          {
            const targetLineage = inspectionTargetLineageV1(
              preflight.project!,
              activeLineage,
              evidence.targetIndex
            )
            return {
              entityKind: 'media',
              entitySubtype: evidence.mediaKind,
              location: mediaBoundedLocationProjectionV1(
                evidence,
                inspectionLocationArtifactIdV1(
                  'media',
                  evidence.semanticLocationSha256
                )
              ),
              semanticLocationSha256: evidence.semanticLocationSha256,
              semanticFingerprintSha256: evidence.semanticFingerprintSha256,
              contextFingerprintSha256: evidence.contextFingerprintSha256,
              ...issueHandle(
                'media',
                evidence.mediaKind,
                inspectionMediaLineageV1(
                  activeLineage,
                  targetLineage.lineageId,
                  evidence.mediaKind,
                  evidence.assetId,
                  evidence.dataFormat,
                  evidence.ordinal
                ).lineageId,
                evidence.semanticLocationSha256,
                evidence.semanticFingerprintSha256
              ),
            }
          })
        : []
    const items: readonly EditInspectDomainItemV1[] = [
      ...targetItems,
      ...declarationItems,
      ...procedureItems,
      ...parameterItems,
      ...scriptItems,
      ...blockItems,
      ...primitiveItems,
      ...commentItems,
      ...mediaItems,
    ]
    const itemEvidence = items.map(({ handle: _handle, ...item }) => item)
    return {
      revision: structuredClone(revision.head),
      items,
      handlesIssued: input.issueHandles,
      querySha256: editCanonicalSha256V1({
        revision: revision.head,
        issueHandles: input.issueHandles,
        handleEpoch: input.issueHandles ? this.#handleEpoch : null,
        itemEvidence,
      }),
    }
  }

  // source-media admission resolves against retained current-revision bytes;
  // transports never unzip a candidate or recreate selector semantics
  async sourceMediaAssetSourceV1(input: {
    readonly media: StandaloneMediaRefV1
    readonly expectedPayloadSha256: string
  }): Promise<Extract<EditAssetAdmitDomainSourceV1, { kind: 'sourceMedia' }>>
  {
    const current = this.#revisions.at(-1)!
    const bytes = await this.#store.readImmutable(current.candidateKey)
    const preflight = await inspectSemanticEditArtifact(bytes)
    if (!preflight.ok || !preflight.project)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'retained revision no longer passes semantic preflight'
      )
    const inspection = await this.inspect({ issueHandles: true })
    const handleIndex = <T extends { readonly semanticLocationSha256: string }>(
      token: string,
      entityKind: EditInspectDomainItemV1['entityKind'],
      evidence: readonly T[]
    ): number | null =>
    {
      const item = inspection.items.find(
        (candidate) =>
          candidate.entityKind === entityKind && candidate.handle === token
      )
      if (!item) return null
      const index = evidence.findIndex(
        (candidate) =>
          candidate.semanticLocationSha256 === item.semanticLocationSha256
      )
      return index < 0 ? null : index
    }
    let selected
    try
    {
      selected = resolveMediaRefV1(preflight.project, input.media, {
        target: {
          resolveHandle: (reference, evidence) =>
            handleIndex(reference.token, 'target', evidence),
          resolveCreated: () => null,
        },
        resolveScriptHandle: (reference, evidence) =>
          handleIndex(reference.token, 'script', evidence),
        resolveScriptCreated: () => null,
        resolveMediaHandle: (reference, evidence) =>
          handleIndex(reference.token, 'media', evidence),
        resolveMediaCreated: () => null,
      })
    }
    catch (error)
    {
      if (error instanceof EntityResolutionError)
        throw new EditSessionErrorV1(
          'edit.unsupported_media',
          `source media reference could not be resolved: ${error.message}`
        )
      throw error
    }
    const assets = preflight.project.assets.filter(
      (asset) => asset.path === selected.archivePath
    )
    if (assets.length !== 1)
      throw new EditSessionErrorV1(
        'edit.unsupported_media',
        'source media does not name one retained archive payload'
      )
    const payload = assets[0]!.bytes
    const payloadSha256 = sha256Hex(payload)
    if (
      selected.payloadSha256 !== payloadSha256 ||
      input.expectedPayloadSha256 !== payloadSha256
    )
      throw new EditSessionErrorV1(
        'edit.asset_digest_mismatch',
        'source media payload does not match its expected digest'
      )
    return {
      kind: 'sourceMedia',
      mediaKind: selected.mediaKind,
      media: structuredClone(input.media),
      bytes: Uint8Array.from(payload),
      expectedPayloadSha256: input.expectedPayloadSha256,
    }
  }

  async retainedCapabilityFactsV1(): Promise<EditRetainedCapabilityFactsV1>
  {
    const profile = JSON.parse(
      new TextDecoder().decode(
        await this.#store.readImmutable(this.#layout.capabilityProfile)
      )
    ) as SemanticEditCapabilityProfileEnvelopeV1
    const revision = this.#revisions.at(-1)!
    const head = structuredClone(revision.head)
    const snapshot = structuredClone(
      revision.capabilitySnapshot
    ) as SemanticEditCapabilitySnapshotEnvelopeV1
    if (snapshot.capabilitySnapshotSha256 !== head.capabilitySnapshotSha256)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'retained capability snapshot differs from the selected revision head'
      )
    return Object.freeze({
      profile,
      snapshot,
      head,
      effectiveLimits: this.#contract.effectiveLimits,
      evidenceIds: Object.freeze([
        this.#manifest.capabilityProfileArtifactSha256,
        head.capabilitySnapshotSha256,
      ]),
    })
  }

  retainedOutcomeFactsV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
    readonly invocationSha256: string
    readonly transportRequest: unknown
  }): EditRetainedOutcomeFactsV1 | null
  {
    const outcome = this.#idempotency.get(
      this.#namespaceSha256(
        input.toolName,
        input.requestId,
        input.principalSha256
      )
    )
    if (
      !outcome ||
      outcome.result === undefined ||
      outcome.transportRequestSha256 !==
        editCanonicalSha256V1(input.transportRequest)
    )
      return null
    const event = findLatestV1(
      this.#events,
      (entry) =>
        entry.projection.invocationCorrelation.invocationSha256 ===
        input.invocationSha256
    )
    const result = structuredClone(outcome.result)
    const resultBudget =
      result !== null &&
      typeof result === 'object' &&
      'budget' in result &&
      result.budget !== null &&
      typeof result.budget === 'object'
        ? (result.budget as EditKernelBudgetV1)
        : null
    const report = event
      ? findLatestV1(
          this.#reports,
          (entry) => entry.eventHeadSha256 === event.eventSha256
        )
      : undefined
    return Object.freeze({
      outcome: {
        namespaceSha256: outcome.attempt.namespaceSha256,
        requestSha256: outcome.requestSha256,
        classification: outcome.attempt.state,
        attemptId: outcome.attempt.attemptId,
        attemptSequence: outcome.attempt.sequence,
        toolName: outcome.attempt.toolName,
        requestId: outcome.attempt.requestId,
        sessionId: this.sessionId,
        preHead: outcome.attempt.preHead,
        postHead: outcome.attempt.postHead,
        retainedOutcomeSha256: outcome.attempt.resultSha256 ?? null,
        refusalCode: outcome.attempt.refusalCode ?? null,
      },
      result,
      budget: structuredClone(resultBudget ?? report?.budget ?? this.#budget),
      event: event
        ? {
            eventSha256: event.eventSha256,
            sequence: event.projection.sequence,
            invocationCorrelation: structuredClone(
              event.projection.invocationCorrelation
            ),
          }
        : null,
      evidenceIds: retainedEvidenceIdsV1(result),
    })
  }

  async retainedTransportOutcomeTargetV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
    readonly invocationSha256: string
    readonly transportRequest: unknown
  }): Promise<EditTransportOutcomeTargetV1>
  {
    const outcome = this.#idempotency.get(
      this.#namespaceSha256(
        input.toolName,
        input.requestId,
        input.principalSha256
      )
    )
    if (
      outcome === undefined ||
      outcome.result === undefined ||
      outcome.transportRequestSha256 !==
        editCanonicalSha256V1(input.transportRequest) ||
      (outcome.attempt.state !== 'completed' &&
        outcome.attempt.state !== 'refused')
    )
      throw new EditSessionErrorV1(
        'edit.retention_failed',
        'transport outcome has no terminal semantic attempt authority'
      )
    const event = findLatestV1(
      this.#events,
      (entry) =>
        entry.projection.invocationCorrelation.invocationSha256 ===
        input.invocationSha256
    )
    const requestArtifact = JSON.parse(
      new TextDecoder().decode(
        await this.#store.readImmutable(
          this.#layout.attempt(
            outcome.attempt.sequence,
            outcome.requestSha256,
            'request.json'
          )
        )
      )
    ) as {
      readonly invocationCorrelation?: InvocationCorrelationV1
      readonly transportRequest?: unknown
    }
    const retainedInvocation =
      event?.projection.invocationCorrelation ??
      requestArtifact.invocationCorrelation
    if (
      retainedInvocation === undefined ||
      retainedInvocation.boundaryKind !== 'mcp' ||
      retainedInvocation.invocationSha256 !== input.invocationSha256 ||
      requestArtifact.invocationCorrelation?.boundaryKind !== 'mcp' ||
      requestArtifact.invocationCorrelation.invocationSha256 !==
        input.invocationSha256 ||
      editCanonicalSha256V1(requestArtifact.transportRequest) !==
        outcome.transportRequestSha256
    )
      throw new EditSessionErrorV1(
        'edit.retention_failed',
        'transport outcome invocation does not match retained semantic evidence'
      )
    return Object.freeze({
      kind: 'session',
      sessionKey: this.#manifest.sessionKey,
      toolName: outcome.attempt.toolName as EditToolName,
      disposition: outcome.attempt.state,
      attemptId: outcome.attempt.attemptId,
      attemptSequence: outcome.attempt.sequence,
      requestId: outcome.attempt.requestId,
      requestSha256: outcome.requestSha256,
      sessionId: this.sessionId,
      namespaceSha256: outcome.attempt.namespaceSha256,
      invocationCorrelation: structuredClone(retainedInvocation),
    })
  }

  retainedStatusFactsV1(): EditRetainedStatusFactsV1
  {
    const latestReport = this.#reports.at(-1)!
    const eventHead = this.#events.at(-1)!
    return Object.freeze({
      latestReport: structuredClone(latestReport),
      eventHead: structuredClone(eventHead),
      exportability: this.exportability(),
      evidenceIds: Object.freeze([
        latestReport.reportArtifactSha256,
        ...this.#certificates.map(
          (entry) => entry.certificate.certificateSha256
        ),
      ]),
    })
  }

  terminalEvidenceV1(): EditSessionTerminalEvidenceV1
  {
    const unique = (values: readonly string[]): readonly string[] =>
      Object.freeze([...new Set(values)].sort())
    const exportReceiptSha256s = [...this.#idempotency.values()].flatMap(
      (entry) =>
      {
        if (
          entry.attempt.toolName !== 'edit_export' ||
          entry.result === null ||
          typeof entry.result !== 'object'
        )
          return []
        const receiptSha256 = (entry.result as Record<string, unknown>)[
          'receiptSha256'
        ]
        return typeof receiptSha256 === 'string' ? [receiptSha256] : []
      }
    )
    return Object.freeze({
      revisionSha256s: unique(
        this.#revisions.map((entry) => entry.revision.revisionId)
      ),
      parentDeltaSha256s: unique(
        this.#revisions.map(
          (entry) => entry.revision.hashProjection.parentChildDeltaSha256
        )
      ),
      cumulativeDeltaSha256s: unique(
        this.#revisions.map(
          (entry) => entry.revision.hashProjection.sourceHeadDeltaSha256
        )
      ),
      preservationSha256s: unique(
        this.#revisions.map(
          (entry) => entry.revision.hashProjection.preservationSha256
        )
      ),
      lineageSha256s: unique(
        this.#revisions.flatMap((entry) => [
          entry.revision.hashProjection.activeLineageSnapshotSha256,
          entry.revision.hashProjection.lineageHistoryLedgerSha256,
        ])
      ),
      certificateSha256s: unique(
        this.#certificates.map((entry) => entry.certificate.certificateSha256)
      ),
      reportProjectionSha256s: unique(
        this.#reports.map((report) => report.semanticProjectionSha256)
      ),
      exportReceiptSha256s: unique(exportReceiptSha256s),
    })
  }

  async retainedCollectionFactsV1(
    kind: EditRetainedCollectionKindV1
  ): Promise<EditRetainedCollectionFactsV1>
  {
    let items: readonly unknown[]
    switch (kind)
    {
      case 'history':
        items = this.#revisions.map((entry) => ({
          head: entry.head,
          transitionDescriptor: entry.transitionDescriptor,
          revision: entry.revision,
          parentDelta: entry.parentDelta,
          cumulativeDelta: entry.cumulativeDelta,
          preservation: entry.preservation,
          activeLineage: entry.activeLineage,
          lineageHistory: entry.lineageHistory,
        }))
        break
      case 'diff':
        items = this.#revisions.slice(1).map((entry) => ({
          head: entry.head,
          parentDelta: entry.parentDelta,
          cumulativeDelta: entry.cumulativeDelta,
        }))
        break
      case 'attempts':
        items = [...this.#idempotency.values()].map((entry) => ({
          attempt: entry.attempt,
          result: entry.result,
          refusal: entry.refusal,
        }))
        break
      case 'previews':
        items = [...this.#previews.values()].map(
          ({
            candidateCacheKey: _cache,
            canonicalTransaction: _batch,
            ...entry
          }) => entry
        )
        break
      case 'checkpoints':
        items = [...this.#checkpoints.values()]
        break
      case 'evaluations':
        items = [...this.#certificates, ...this.#awaitingEvaluations.values()]
        break
      case 'artifacts':
        items = await this.#store.listImmutable(this.#layout.prefix)
        break
      case 'exports':
        items = [...this.#idempotency.values()]
          .filter((entry) => entry.attempt.toolName === 'edit_export')
          .map((entry) => ({ attempt: entry.attempt, result: entry.result }))
        break
      case 'operationResults':
        items = [
          ...this.#revisions.map((entry) => ({
            revisionId: entry.head.revisionId,
            operationResultSetSha256:
              entry.revision.hashProjection.operationResultSetSha256,
            summaries: entry.operationResultSummaries,
          })),
          ...[...this.#previews.values()].map((entry) => ({
            attemptId: this.#attempts.find(
              (attempt) =>
                attempt.toolName === 'edit_preview' &&
                attempt.requestId === entry.requestId
            )?.attemptId,
            previewId: entry.previewId,
            operationResultSetSha256: entry.operationResultSetSha256,
            summaries: entry.operationResultSummaries,
          })),
        ]
        break
    }
    const exact = structuredClone(items)
    return Object.freeze({
      kind,
      collectionSha256: editCanonicalSha256V1({ kind, items: exact }),
      items: Object.freeze(exact),
    })
  }

  async retainedInspectionFactsV1(input: {
    readonly revisionNumber?: number
    readonly revisionId?: string
    readonly issueHandles: boolean
    readonly entityKinds?: readonly EditInspectDomainItemV1['entityKind'][]
  }): Promise<EditRetainedInspectionFactsV1>
  {
    const inspection = await this.inspect(input)
    const kinds: readonly EditRetainedCollectionKindV1[] = [
      'history',
      'diff',
      'attempts',
      'previews',
      'checkpoints',
      'evaluations',
      'artifacts',
      'exports',
      'operationResults',
    ]
    const values = await Promise.all(
      kinds.map((kind) => this.retainedCollectionFactsV1(kind))
    )
    return Object.freeze({
      ...inspection,
      collections: Object.freeze(
        Object.fromEntries(
          values.map((value) => [value.kind, value])
        ) as unknown as Record<
          EditRetainedCollectionKindV1,
          EditRetainedCollectionFactsV1
        >
      ),
    })
  }

  async retainedOperationPlanningFactsV1(
    query: OperationPlanningQueryV1
  ): Promise<EditRetainedOperationPlanningFactsV1>
  {
    if (this.#state !== 'active')
      throw new EditSessionErrorV1(
        'edit.session_closed',
        'operation planning requires an active session'
      )
    const intent = resolvePlannedNextIntentV1(query.plannedPrefix, query.goal)
    const obligationsBefore = provisionalObligationSetV1(query.plannedPrefix)
    const obligationsAfter = provisionalObligationSetV1([
      ...query.plannedPrefix,
      query.goal,
    ])
    const head = this.head
    const binding: OperationPlanningBindingHeadV1 = {
      sessionId: this.sessionId,
      sourceArtifactSha256: head.sourceArtifactSha256,
      revisionNumber: head.revisionNumber,
      revisionId: head.revisionId,
      candidateSha256: head.candidateSha256,
      assetManifestSha256: head.assetManifestSha256,
      changeContractSha256: head.changeContractSha256,
      capabilityProfileSha256: head.capabilityProfileSha256,
      capabilitySnapshotSha256: head.capabilitySnapshotSha256,
      plannedPrefixSha256: intent.plannedPrefixSha256,
      goalSha256: intent.goalSha256,
      obligationsBefore,
      obligationsAfter,
    }
    if (this.#transactionExecutor.planOperation === undefined)
      throw new EditSessionErrorV1(
        'edit.planning_facts_unavailable',
        'the configured transaction authority has no planning completion',
        false,
        { opId: query.goal.opId }
      )
    try
    {
      const transactionInput = await this.#transactionInput({
        schemaVersion: 1,
        planningRequest: intent.goalSha256,
      })
      const enumeration = await this.#transactionExecutor.planOperation(
        transactionInput,
        {
          planningStage: 'enumerateChoices',
          plannedPrefix: query.plannedPrefix,
          goal: query.goal,
          choices: Object.freeze([]),
        }
      )
      const choiceSlots = Object.freeze([...(enumeration.choiceSlots ?? [])])
      if (query.planningStage === 'enumerateChoices')
        return Object.freeze({ binding, completion: null, choiceSlots })
      const completion = await this.#transactionExecutor.planOperation(
        transactionInput,
        {
          planningStage: 'completeChoices',
          plannedPrefix: query.plannedPrefix,
          goal: query.goal,
          choices: query.choices,
        }
      )
      return Object.freeze({ binding, completion, choiceSlots })
    }
    catch (error)
    {
      const record =
        error !== null && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : null
      const code = record?.['code']
      if (typeof code === 'string' && EDIT_SESSION_ERROR_CODES.has(code))
        throw new EditSessionErrorV1(
          code as EditSessionErrorCodeV1,
          error instanceof Error ? error.message : String(error),
          false,
          record?.['context'] !== null &&
            typeof record?.['context'] === 'object'
            ? (structuredClone(record['context']) as RefusalContextV1)
            : { opId: query.goal.opId }
        )
      throw error
    }
  }

  // admitted payloads outlive the session: the transaction resolver reads them
  // from memory, but replay rebuilds the same resolver from these artifacts
  async #planAdmittedAssetRetention(
    record: SessionAssetRecordV1,
    payloadBytes: Uint8Array
  ): Promise<AssetRetentionPlanV1>
  {
    const payloadKey = this.#layout.assetPayload(record.payloadSha256)
    const recordKey = this.#layout.assetRecord(record.assetToken)
    const recordBytes = editCanonicalBytesV1(retainedEditAssetRecordV1(record))
    const payloadAlreadyRetained = await this.#store
      .sizeImmutable(payloadKey)
      .then(() => true)
      .catch(() => false)
    const recordAlreadyRetained = await this.#store
      .sizeImmutable(recordKey)
      .then(() => true)
      .catch(() => false)
    return Object.freeze({
      payloadKey,
      recordKey,
      reservationId: editCanonicalSha256V1({
        sessionId: this.sessionId,
        assetToken: record.assetToken,
        purpose: 'asset-admit',
      }),
      reservedBytes:
        (payloadAlreadyRetained ? 0 : payloadBytes.byteLength) +
        (recordAlreadyRetained ? 0 : recordBytes.byteLength),
      payloadAlreadyRetained,
      recordAlreadyRetained,
    })
  }

  async #retainAdmittedAsset(
    record: SessionAssetRecordV1,
    plan: AssetRetentionPlanV1
  ): Promise<{
    payloadKey: string
    recordKey: string
    retainedBytes: number
  }>
  {
    const payloadKey = plan.payloadKey
    const recordKey = plan.recordKey
    const recordBytes = editCanonicalBytesV1(retainedEditAssetRecordV1(record))
    const payloadBytes = this.#assets.payload(record.payloadSha256)
    // the payload artifact is keyed by its own digest, so re-admitting identical
    // bytes retains nothing new. charging them again would bill the ceiling for
    // storage that was never taken
    await this.#store.reserveQuota(plan.reservationId, plan.reservedBytes)
    const payload = await this.#retainPublicResource(
      payloadKey,
      payloadBytes,
      record.identity.dataFormat === 'png' ? 'image/png' : 'audio/wav'
    )
    const retained = await this.#retainPublicResource(
      recordKey,
      recordBytes,
      'application/json'
    )
    const retainedBytes =
      (plan.payloadAlreadyRetained ? 0 : payload.byteLength) +
      (plan.recordAlreadyRetained ? 0 : retained.byteLength)
    await this.#store.settleQuota(plan.reservationId, retainedBytes)
    return { payloadKey, recordKey, retainedBytes }
  }

  // planning a media batch needs the same token->payload view the executor gets,
  // so the resolver is readable while the store itself stays owned by the session
  get admittedAssets(): AdmittedEditAssetResolverV1
  {
    return this.#assets.resolver()
  }

  async admitAsset(
    request: EditAssetAdmitDomainRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditAssetAdmitDomainResultV1>
  {
    return this.#withTransition('asset-admit', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_asset_admit',
        request.requestId,
        {
          requestId: request.requestId,
          expectedHead: request.expectedHead,
          source: assetAdmitRequestProjectionV1(request.source),
        },
        invocation,
        request.transportRequest
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditAssetAdmitDomainResultV1
      let retainedAsset = false
      try
      {
        this.#assertExpectedHead(request.expectedHead, attempt.attempt.preHead)
        const prepared = await this.#prepareAssetRecord(request.source)
        const record = prepared.record
        const retentionPlan = await this.#planAdmittedAssetRetention(
          record,
          prepared.bytes
        )
        const eventPayload = Object.freeze({
          assetToken: record.assetToken,
          mediaKind: record.mediaKind,
          payloadSha256: record.payloadSha256,
          metadataSha256: record.metadataSha256,
          byteLength: record.byteLength,
          dataFormat: record.identity.dataFormat,
          payloadKey: retentionPlan.payloadKey,
          recordKey: retentionPlan.recordKey,
        })
        const eventProjection = Object.freeze({
          schemaVersion: 1 as const,
          sessionId: this.sessionId,
          sequence: this.#events.length,
          eventKind: 'asset-admitted' as const,
          previousEventSha256: this.#events.at(-1)?.eventSha256,
          preHead: Object.freeze({
            state: 'present' as const,
            head: exactRevisionFromHeadV1(this.head),
          }),
          postHead: exactRevisionFromHeadV1(this.head),
          semanticPayloadSha256: editCanonicalSha256V1(eventPayload),
          invocationCorrelation: asInvocationCorrelation(invocation),
        })
        const eventSha256 = semanticHashV1('semantic-event', eventProjection)
        const event: EditKernelSemanticEventV1 = Object.freeze({
          projection: eventProjection,
          eventSha256,
          hostTimestampEpochMs: this.#clock.nowEpochMs(),
        })
        const assetAuthorityBytes = editCanonicalBytesV1({
          schemaVersion: 1,
          kind: 'asset-admit-retention-authority-v1',
          namespaceSha256: attempt.namespaceSha256,
          requestSha256: attempt.requestSha256,
          invocationCorrelation: asInvocationCorrelation(invocation),
          record,
          retainedRecord: retainedEditAssetRecordV1(record),
          retentionPlan,
          ledger: prepared.prospectiveLedger,
          preBudget: this.#budget,
          eventProjection,
          eventSha256,
        })
        const retention = Object.freeze({
          payloadKey: retentionPlan.payloadKey,
          recordKey: retentionPlan.recordKey,
          retainedBytes: retentionPlan.reservedBytes,
        })
        const budgetBeforeRecoveryAuthority = Object.freeze({
          ...this.#budget,
          artifactBytesUsed:
            this.#budget.artifactBytesUsed +
            assetAuthorityBytes.byteLength +
            retention.retainedBytes,
        })
        const recoveryAuthorityBytes = editCanonicalBytesV1({
          schemaVersion: 1,
          kind: 'asset-admit-recovery-authority-v1',
          namespaceSha256: attempt.namespaceSha256,
          requestSha256: attempt.requestSha256,
          invocationCorrelation: asInvocationCorrelation(invocation),
          record,
          retention,
          ledger: prepared.prospectiveLedger,
          budget: budgetBeforeRecoveryAuthority,
        })
        const eventBytes = editCanonicalBytesV1(event)
        const budgetBeforeResult = Object.freeze({
          ...budgetBeforeRecoveryAuthority,
          artifactBytesUsed:
            budgetBeforeRecoveryAuthority.artifactBytesUsed +
            recoveryAuthorityBytes.byteLength +
            eventBytes.byteLength,
        })
        const result: EditAssetAdmitDomainResultV1 = Object.freeze({
          assetToken: record.assetToken,
          admissionEvidenceId: editAssetAdmissionEvidenceIdV1({
            sessionId: this.sessionId,
            eventSha256: event.eventSha256,
            record,
          }),
          mediaKind: record.mediaKind,
          payloadSha256: record.payloadSha256,
          metadataSha256: record.metadataSha256,
          byteLength: record.byteLength,
          dataFormat: record.identity.dataFormat,
          payloadKey: retention.payloadKey,
          recordKey: retention.recordKey,
          ledger: prepared.prospectiveLedger,
          budget: budgetBeforeResult,
          eventSha256: event.eventSha256,
        })
        const resultBytes = editCanonicalBytesV1({
          schemaVersion: 1,
          result,
        })
        const exactCharge =
          assetAuthorityBytes.byteLength +
          retention.retainedBytes +
          recoveryAuthorityBytes.byteLength +
          eventBytes.byteLength +
          resultBytes.byteLength
        if (
          this.#budget.artifactBytesUsed + exactCharge >
          this.#effectiveArtifactByteLimit()
        )
          throw new EditSessionErrorV1(
            'edit.artifact_quota_exceeded',
            `retaining ${exactCharge} admitted asset evidence bytes would exceed the session artifact ceiling ${this.#effectiveArtifactByteLimit()}`
          )
        this.#assets.commitPreparedAdmission(prepared)
        retainedAsset = true
        const pending: Extract<
          EditPendingSameHeadTransitionV1,
          { readonly kind: 'asset-admit' }
        > = {
          kind: 'asset-admit',
          namespaceSha256: attempt.namespaceSha256,
          record,
          invocation,
          retention: null,
          eventSha256: null,
        }
        this.#pendingSameHeadTransition = pending
        await this.#retainSessionImmutable(
          this.#layout.attempt(
            attempt.attempt.sequence,
            attempt.requestSha256,
            'asset-retention-authority.json'
          ),
          assetAuthorityBytes
        )
        const retained = await this.#retainAdmittedAsset(record, retentionPlan)
        if (retained.retainedBytes !== retention.retainedBytes)
          throw new EditSessionErrorV1(
            'edit.internal_invariant',
            'retained admitted asset differs from its exact preflight charge'
          )
        pending.retention = retained
        await this.#retainSessionImmutable(
          this.#layout.attempt(
            attempt.attempt.sequence,
            attempt.requestSha256,
            'recovery-authority.json'
          ),
          recoveryAuthorityBytes
        )
        await this.#appendExactEvent(event)
        pending.eventSha256 = event.eventSha256
        await this.#finishAttempt(attempt.namespaceSha256, result, 'completed')
        this.#pendingSameHeadTransition = null
        return result
      }
      catch (error)
      {
        if (error instanceof EditSessionErrorV1 && error.committed) throw error
        if (retainedAsset)
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `asset admission retained authority but completion requires reconciliation: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true
          )
        }
        return this.#refuseAttempt(attempt.namespaceSha256, error)
      }
    })
  }

  async #prepareAssetRecord(
    source: EditAssetAdmitDomainSourceV1
  ): Promise<PreparedSessionAssetAdmissionV1>
  {
    try
    {
      return source.kind === 'inputFile'
        ? await this.#assets.prepareInputFile({
            read: source.read,
            mediaKind: source.mediaKind,
            expectedByteLength: source.expectedByteLength,
            expectedPayloadSha256: source.expectedPayloadSha256,
          })
        : await this.#assets.prepareSourceMedia({
            bytes: source.bytes,
            mediaKind: source.mediaKind,
            expectedPayloadSha256: source.expectedPayloadSha256,
          })
    }
    catch (error)
    {
      if (error instanceof EditAssetAdmissionErrorV1)
        throw new EditSessionErrorV1(error.code, error.message)
      throw error
    }
  }

  async preview(
    request: EditPreviewDomainRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditPreviewDomainResultV1>
  {
    return this.#withTransition('preview', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_preview',
        request.requestId,
        {
          requestId: request.requestId,
          expectedHead: request.expectedHead,
          canonicalTransaction: request.canonicalTransaction,
        },
        invocation,
        request.transportRequest
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditPreviewDomainResultV1
      let retainedPreview = false
      try
      {
        this.#assertExpectedHead(request.expectedHead, attempt.attempt.preHead)
        if (!this.#budget.restoreReserveHeld)
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'session cannot fund another reversible apply',
            false,
            {
              limit: this.#policy.acceptedRevisionLimit,
              observed: this.#revisions.length + 1,
            }
          )
        const transaction = await this.#executeTransaction(
          request.canonicalTransaction
        )
        const predicted = this.#nextRevisionFromTransaction(
          transaction,
          request.requestId,
          invocation
        )
        const requestSha256 = editCanonicalSha256V1(
          request.canonicalTransaction
        )
        const previewId = editOpaqueIdV1(
          'preview',
          this.#entropy.randomBytes(16),
          { sessionId: this.sessionId, requestSha256, head: this.head }
        )
        const candidateCacheKey = this.#layout.preview(
          predicted.head.candidateSha256
        )
        try
        {
          await this.#retainSessionImmutable(
            candidateCacheKey,
            transaction.candidateBytes
          )
        }
        catch
        {
          const retained = await this.#store.hashImmutable(candidateCacheKey)
          if (retained !== predicted.head.candidateSha256)
            throw new Error('preview cache conflict')
        }
        const preview: EditKernelPreviewV1 = {
          previewId,
          requestId: request.requestId,
          requestSha256,
          createdSequence: this.#previews.size,
          expectedHead: structuredClone(request.expectedHead),
          capabilitySnapshotSha256:
            request.expectedHead.capabilitySnapshotSha256,
          canonicalTransaction: structuredClone(request.canonicalTransaction),
          operationCount: transaction.operationCount,
          predictedCandidateSha256: predicted.head.candidateSha256,
          predictedCandidateByteLength: transaction.candidateBytes.byteLength,
          predictedProjectJsonSha256: predicted.projectJsonSha256,
          predictedAssetManifestSha256: predicted.head.assetManifestSha256,
          resolvedSemanticBatchSha256: transaction.resolvedSemanticBatchSha256,
          resolvedPlanSha256: transaction.resolvedPlanSha256,
          deltaSha256: predicted.revision.hashProjection.parentChildDeltaSha256,
          cumulativeDeltaSha256:
            predicted.revision.hashProjection.sourceHeadDeltaSha256,
          preservationSha256:
            predicted.revision.hashProjection.preservationSha256,
          authorizationSha256:
            predicted.revision.hashProjection.authorizationSha256,
          diagnosticsSha256: predicted.revision.hashProjection.diagnosticSha256,
          allocatorSha256:
            predicted.revision.hashProjection.allocatorReservationStateSha256,
          activeLineageSha256:
            predicted.revision.hashProjection.activeLineageSnapshotSha256,
          lineageHistorySha256:
            predicted.revision.hashProjection.lineageHistoryLedgerSha256,
          operationResultSetSha256:
            predicted.revision.hashProjection.operationResultSetSha256,
          operationResultLineageCorrespondenceSha256:
            predicted.revision.hashProjection
              .operationResultLineageCorrespondenceSha256,
          applyGuardSha256: editCanonicalSha256V1({
            requestSha256,
            expectedHead: request.expectedHead,
            predictedRevisionId: predicted.head.revisionId,
            predictedCandidateSha256: predicted.head.candidateSha256,
            resolvedPlanSha256: transaction.resolvedPlanSha256,
          }),
          operationResults: transaction.operationResults,
          operationResultSummaries: transaction.operationResultSummaries,
          candidateCacheKey,
          state: 'unapplied',
        }
        this.#previews.set(previewId, preview)
        retainedPreview = true
        const pending: Extract<
          EditPendingSameHeadTransitionV1,
          { readonly kind: 'preview' }
        > = {
          kind: 'preview',
          namespaceSha256: attempt.namespaceSha256,
          preview,
          invocation,
          eventSha256: null,
        }
        this.#pendingSameHeadTransition = pending
        const unapplied = [...this.#previews.values()]
          .filter((entry) => entry.state === 'unapplied')
          .sort((left, right) => left.createdSequence - right.createdSequence)
        while (unapplied.length > this.#policy.retainedPreviewLimit)
        {
          const evicted = unapplied.shift()!
          evicted.state = 'evicted'
          const shared = [...this.#previews.values()].some(
            (entry) =>
              entry !== evicted &&
              entry.candidateCacheKey === evicted.candidateCacheKey &&
              entry.state === 'unapplied'
          )
          if (!shared)
            await this.#removeEvictableSessionArtifact(
              evicted.candidateCacheKey,
              evicted.predictedCandidateSha256
            )
        }
        this.#budget = {
          ...this.#budget,
          retainedPreviews: [...this.#previews.values()].filter(
            (entry) => entry.state === 'unapplied'
          ).length,
        }
        await this.#retainSessionImmutable(
          this.#layout.attempt(
            attempt.attempt.sequence,
            attempt.requestSha256,
            'recovery-authority.json'
          ),
          editCanonicalBytesV1({
            schemaVersion: 1,
            kind: 'preview-recovery-authority-v1',
            namespaceSha256: attempt.namespaceSha256,
            requestSha256: attempt.requestSha256,
            invocationCorrelation: asInvocationCorrelation(invocation),
            preview,
            budget: this.#budget,
          })
        )
        const event = await this.#appendEvent(
          'preview-recorded',
          this.head,
          this.head,
          {
            previewId: preview.previewId,
            requestSha256: preview.requestSha256,
            predictedCandidateSha256: preview.predictedCandidateSha256,
            resolvedPlanSha256: preview.resolvedPlanSha256,
            operationResultSetSha256: preview.operationResultSetSha256,
            applyGuardSha256: preview.applyGuardSha256,
          },
          invocation
        )
        pending.eventSha256 = event.eventSha256
        const result = {
          preview,
          budget: structuredClone(this.#budget),
          eventSha256: event.eventSha256,
        }
        await this.#finishAttempt(attempt.namespaceSha256, result, 'completed')
        this.#pendingSameHeadTransition = null
        return result
      }
      catch (error)
      {
        if (retainedPreview)
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `preview retained authority but completion requires reconciliation: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true
          )
        }
        return this.#refuseAttempt(attempt.namespaceSha256, error)
      }
    })
  }

  async apply(
    request: EditApplyRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditApplyDomainResultV1>
  {
    await this.#recoverExactPendingRequest(
      'edit_apply',
      request.requestId,
      request,
      invocation
    )
    return this.#withTransition('apply', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_apply',
        request.requestId,
        request,
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditApplyDomainResultV1
      try
      {
        this.#assertExpectedHead(
          {
            sourceArtifactSha256: request.expectedSourceArtifactSha256,
            revisionNumber: request.expectedRevisionNumber,
            revisionId: request.expectedRevisionId,
            candidateSha256: request.expectedCandidateSha256,
            assetManifestSha256: request.expectedAssetManifestSha256,
            changeContractSha256: request.expectedChangeContractSha256,
            capabilityProfileSha256: request.expectedCapabilityProfileSha256,
            capabilitySnapshotSha256:
              attempt.attempt.preHead!.capabilitySnapshotSha256,
          },
          attempt.attempt.preHead
        )
        const preview = this.#previews.get(request.previewId)
        if (!preview || preview.state !== 'unapplied')
          throw new EditSessionErrorV1(
            'edit.stale_preview',
            'preview is absent, invalidated, evicted, or already applied'
          )
        if (
          request.applyGuardSha256 !== preview.applyGuardSha256 ||
          request.expectedResolvedPlanSha256 !== preview.resolvedPlanSha256
        )
          throw new EditSessionErrorV1(
            'edit.stale_preview',
            'apply guard or resolved plan does not match the preview'
          )
        if (
          this.#revisions.length + 1 >= this.#policy.acceptedRevisionLimit ||
          !this.#budget.restoreReserveHeld
        )
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'apply would consume the held restore envelope',
            false,
            {
              limit: this.#policy.acceptedRevisionLimit,
              observed: this.#revisions.length + 1,
            }
          )
        const transaction = await this.#executeTransaction(
          preview.canonicalTransaction
        )
        const record = this.#nextRevisionFromTransaction(
          transaction,
          request.requestId,
          invocation
        )
        const exact = {
          predictedCandidateSha256: record.head.candidateSha256,
          predictedProjectJsonSha256: record.projectJsonSha256,
          predictedAssetManifestSha256: record.head.assetManifestSha256,
          resolvedSemanticBatchSha256: transaction.resolvedSemanticBatchSha256,
          resolvedPlanSha256: transaction.resolvedPlanSha256,
          deltaSha256: record.revision.hashProjection.parentChildDeltaSha256,
          cumulativeDeltaSha256:
            record.revision.hashProjection.sourceHeadDeltaSha256,
          preservationSha256: record.revision.hashProjection.preservationSha256,
          authorizationSha256:
            record.revision.hashProjection.authorizationSha256,
          diagnosticsSha256: record.revision.hashProjection.diagnosticSha256,
          allocatorSha256:
            record.revision.hashProjection.allocatorReservationStateSha256,
          activeLineageSha256:
            record.revision.hashProjection.activeLineageSnapshotSha256,
          lineageHistorySha256:
            record.revision.hashProjection.lineageHistoryLedgerSha256,
          operationResultSetSha256:
            record.revision.hashProjection.operationResultSetSha256,
          operationResultLineageCorrespondenceSha256:
            record.revision.hashProjection
              .operationResultLineageCorrespondenceSha256,
        }
        const predicted = {
          predictedCandidateSha256: preview.predictedCandidateSha256,
          predictedProjectJsonSha256: preview.predictedProjectJsonSha256,
          predictedAssetManifestSha256: preview.predictedAssetManifestSha256,
          resolvedSemanticBatchSha256: preview.resolvedSemanticBatchSha256,
          resolvedPlanSha256: preview.resolvedPlanSha256,
          deltaSha256: preview.deltaSha256,
          cumulativeDeltaSha256: preview.cumulativeDeltaSha256,
          preservationSha256: preview.preservationSha256,
          authorizationSha256: preview.authorizationSha256,
          diagnosticsSha256: preview.diagnosticsSha256,
          allocatorSha256: preview.allocatorSha256,
          activeLineageSha256: preview.activeLineageSha256,
          lineageHistorySha256: preview.lineageHistorySha256,
          operationResultSetSha256: preview.operationResultSetSha256,
          operationResultLineageCorrespondenceSha256:
            preview.operationResultLineageCorrespondenceSha256,
        }
        if (editCanonicalSha256V1(exact) !== editCanonicalSha256V1(predicted))
          throw new EditSessionErrorV1(
            'edit.preview_apply_mismatch',
            'apply recomputation does not exactly match the retained preview',
            false,
            {
              expectedRevisionId: preview.expectedHead.revisionId,
              currentRevisionId: this.head.revisionId,
              expectedCandidateSha256: preview.predictedCandidateSha256,
              currentCandidateSha256: record.head.candidateSha256,
            }
          )
        const committed = await this.#commitRevision(
          record,
          transaction.candidateBytes,
          invocation,
          transaction,
          preview.previewId,
          transaction.assetMaterializationUsage
        )
        const result: EditApplyDomainResultV1 = {
          head: this.head,
          revisionId: record.head.revisionId,
          deltaSha256: record.revision.hashProjection.parentChildDeltaSha256,
          preservationSha256: record.revision.hashProjection.preservationSha256,
          lineageSha256:
            record.revision.hashProjection.activeLineageSnapshotSha256,
          operationResultSetSha256:
            record.revision.hashProjection.operationResultSetSha256,
          preparedEventSha256: committed.preparedEvent.eventSha256,
          committedEventSha256: committed.committedEvent.eventSha256,
          reportSha256: committed.report.semanticProjectionSha256,
          operationResults: transaction.operationResults,
          operationResultSummaries: transaction.operationResultSummaries,
          budget: structuredClone(this.#budget),
        }
        await this.#finishAttempt(attempt.namespaceSha256, result, 'completed')
        return result
      }
      catch (error)
      {
        if (error instanceof EditSessionErrorV1 && error.committed) throw error
        if (
          attempt.attempt.preHead !== null &&
          !sameHeadV1(attempt.attempt.preHead, this.head)
        )
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `head committed but apply result requires reconciliation: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true
          )
        }
        return this.#refuseAttempt(attempt.namespaceSha256, error)
      }
    })
  }

  async recover(invocation: HostInvocationContextV1): Promise<{
    head: HeadProjectionV1
    eventSha256: string
    reportSha256: string
  }>
  {
    if (this.#state !== 'recovery-required')
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'session has no recovery-required transition'
      )
    if (this.#busyKind !== null)
      throw new EditSessionErrorV1(
        'edit.session_busy',
        `session is busy with ${this.#busyKind}`
      )
    this.#busyKind = 'recovery'
    try
    {
      if (this.#pendingSameHeadTransition !== null)
        return await this.#recoverSameHeadTransitionV1()
      const record = this.#revisions.at(-1)!
      const predecessorState = record.revision.hashProjection.predecessor
      if (predecessorState.state !== 'present')
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'revision-zero recovery is not an interactive session transition'
        )
      const predecessor = this.#revisions.find(
        (entry) =>
          entry.head.revisionNumber === predecessorState.revisionNumber &&
          entry.head.revisionId === predecessorState.revisionId
      )
      if (!predecessor)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'committed revision predecessor is absent'
        )
      const expectedToolName =
        record.transitionDescriptor.kind === 'apply'
          ? 'edit_apply'
          : record.transitionDescriptor.kind === 'undo'
            ? 'edit_undo'
            : record.transitionDescriptor.kind === 'rollback'
              ? 'edit_rollback'
              : null
      const pending = this.#attempts.find(
        (attempt) =>
          attempt.state === 'pending' &&
          attempt.requestId === record.revision.originatingRequestId &&
          attempt.toolName === expectedToolName
      )
      if (!pending)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'committed revision has no exact pending attempt authority'
        )
      const prepared = findLatestV1(
        this.#events,
        (event) =>
          event.projection.eventKind === 'transition-prepared' &&
          event.projection.postHead.revisionId === record.head.revisionId
      )
      if (!prepared)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'committed revision has no prepared event authority'
        )
      const removedPreviewKeys = new Set<string>()
      for (const preview of this.#previews.values())
      {
        if (preview.state !== 'unapplied') continue
        if (!removedPreviewKeys.has(preview.candidateCacheKey))
        {
          await this.#removeEvictableSessionArtifact(
            preview.candidateCacheKey,
            preview.predictedCandidateSha256
          )
          removedPreviewKeys.add(preview.candidateCacheKey)
        }
        preview.state = 'invalidated'
      }
      this.#budget = { ...this.#budget, retainedPreviews: 0 }
      let committed = findLatestV1(
        this.#events,
        (event) =>
          event.projection.eventKind === 'transition-committed' &&
          event.projection.postHead.revisionId === record.head.revisionId
      )
      if (!committed)
      {
        committed = await this.#appendEvent(
          'transition-committed',
          predecessor.head,
          record.head,
          {
            revisionId: record.head.revisionId,
            preparedEventSha256: prepared.eventSha256,
          },
          invocation
        )
      }
      const retainedAttemptResult = await this.#retainedAttemptResult(
        this.#idempotency.get(pending.namespaceSha256)!
      )
      if (retainedAttemptResult !== null)
      {
        const result = retainedAttemptResult as Record<string, unknown>
        if (
          result === null ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          result['head'] === null ||
          typeof result['head'] !== 'object' ||
          !sameHeadV1(result['head'] as HeadProjectionV1, this.head) ||
          result['committedEventSha256'] !== committed.eventSha256 ||
          typeof result['reportSha256'] !== 'string' ||
          !/^[0-9a-f]{64}$/u.test(result['reportSha256'])
        )
          throw new EditSessionErrorV1(
            'edit.internal_invariant',
            'retained attempt result does not bind the committed recovery head'
          )
        await this.#finishAttempt(
          pending.namespaceSha256,
          retainedAttemptResult,
          'completed'
        )
        this.#state = 'active'
        return {
          head: this.head,
          eventSha256: committed.eventSha256,
          reportSha256: result['reportSha256'],
        }
      }
      const retained = await this.#retainReport(
        this.#buildReport('active'),
        true
      )
      const reservationId = editCanonicalSha256V1({
        sessionId: this.sessionId,
        revisionId: record.head.revisionId,
        purpose: 'revision-commit',
      })
      const revisionEntries = await this.#store.listImmutable(
        `${this.#layout.prefix}/revisions/${String(record.head.revisionNumber).padStart(6, '0')}-${record.head.revisionId}`
      )
      await this.#store.settleQuota(
        reservationId,
        revisionEntries.reduce((total, entry) => total + entry.byteLength, 0)
      )
      if (record.transitionDescriptor.kind === 'apply')
      {
        const result: EditApplyDomainResultV1 = {
          head: this.head,
          revisionId: record.head.revisionId,
          deltaSha256: record.revision.hashProjection.parentChildDeltaSha256,
          preservationSha256: record.revision.hashProjection.preservationSha256,
          lineageSha256:
            record.revision.hashProjection.activeLineageSnapshotSha256,
          operationResultSetSha256:
            record.revision.hashProjection.operationResultSetSha256,
          preparedEventSha256:
            this.#events.find(
              (event) =>
                event.projection.eventKind === 'transition-prepared' &&
                event.projection.postHead.revisionId === record.head.revisionId
            )?.eventSha256 ?? prepared.eventSha256,
          committedEventSha256: committed.eventSha256,
          reportSha256: retained.report.semanticProjectionSha256,
          operationResults: record.operationResults,
          operationResultSummaries: record.operationResultSummaries,
          budget: structuredClone(this.#budget),
        }
        await this.#finishAttempt(pending.namespaceSha256, result, 'completed')
      }
      else if (
        record.transitionDescriptor.kind === 'undo' ||
        record.transitionDescriptor.kind === 'rollback'
      )
      {
        const restoreDescriptor = record.transitionDescriptor
        const selected = this.#revisions.find(
          (entry) =>
            entry.head.revisionNumber ===
              restoreDescriptor.selectedRevision.revisionNumber &&
            entry.head.revisionId ===
              restoreDescriptor.selectedRevision.revisionId
        )
        if (!selected)
          throw new EditSessionErrorV1(
            'edit.internal_invariant',
            'restore recovery target is absent'
          )
        const result: EditRestoreDomainResultV1 = {
          head: this.head,
          restoreKind: restoreDescriptor.kind,
          fromRevision: predecessor.head,
          selectedRevision: selected.head,
          restoreDeltaSha256:
            record.revision.hashProjection.parentChildDeltaSha256,
          preparedEventSha256: prepared.eventSha256,
          committedEventSha256: committed.eventSha256,
          reportSha256: retained.report.semanticProjectionSha256,
          budget: structuredClone(this.#budget),
        }
        await this.#finishAttempt(pending.namespaceSha256, result, 'completed')
      }
      this.#state = 'active'
      return {
        head: this.head,
        eventSha256: committed.eventSha256,
        reportSha256: retained.report.semanticProjectionSha256,
      }
    }
    catch (error)
    {
      this.#state = 'interrupted'
      throw new EditSessionErrorV1(
        'edit.interrupted',
        `recovery failed closed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    finally
    {
      this.#busyKind = null
    }
  }

  async #recoverSameHeadTransitionV1(): Promise<{
    head: HeadProjectionV1
    eventSha256: string
    reportSha256: string
  }>
  {
    const pending = this.#pendingSameHeadTransition
    if (pending === null)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'same-head recovery authority is absent'
      )
    let eventSha256 = pending.eventSha256
    if (pending.kind === 'asset-admit')
    {
      if (pending.retention === null)
      {
        pending.retention = await this.#retainAdmittedAsset(
          pending.record,
          await this.#planAdmittedAssetRetention(
            pending.record,
            this.#assets.payload(pending.record.payloadSha256)
          )
        )
      }
      if (eventSha256 === null)
      {
        const retention = pending.retention
        const event = await this.#appendEvent(
          'asset-admitted',
          this.head,
          this.head,
          {
            assetToken: pending.record.assetToken,
            mediaKind: pending.record.mediaKind,
            payloadSha256: pending.record.payloadSha256,
            metadataSha256: pending.record.metadataSha256,
            byteLength: pending.record.byteLength,
            dataFormat: pending.record.identity.dataFormat,
            payloadKey: retention.payloadKey,
            recordKey: retention.recordKey,
          },
          pending.invocation
        )
        eventSha256 = event.eventSha256
        pending.eventSha256 = eventSha256
      }
      const retention = pending.retention
      await this.#finishAttempt(
        pending.namespaceSha256,
        {
          assetToken: pending.record.assetToken,
          admissionEvidenceId: editAssetAdmissionEvidenceIdV1({
            sessionId: this.sessionId,
            eventSha256,
            record: pending.record,
          }),
          mediaKind: pending.record.mediaKind,
          payloadSha256: pending.record.payloadSha256,
          metadataSha256: pending.record.metadataSha256,
          byteLength: pending.record.byteLength,
          dataFormat: pending.record.identity.dataFormat,
          payloadKey: retention.payloadKey,
          recordKey: retention.recordKey,
          ledger: this.#assets.ledger(),
          budget: structuredClone(this.#budget),
          eventSha256,
        } satisfies EditAssetAdmitDomainResultV1,
        'completed'
      )
    }
    else if (pending.kind === 'preview')
    {
      this.#budget = {
        ...this.#budget,
        retainedPreviews: [...this.#previews.values()].filter(
          (entry) => entry.state === 'unapplied'
        ).length,
      }
      if (eventSha256 === null)
      {
        const event = await this.#appendEvent(
          'preview-recorded',
          this.head,
          this.head,
          {
            previewId: pending.preview.previewId,
            requestSha256: pending.preview.requestSha256,
            predictedCandidateSha256: pending.preview.predictedCandidateSha256,
            resolvedPlanSha256: pending.preview.resolvedPlanSha256,
            operationResultSetSha256: pending.preview.operationResultSetSha256,
            applyGuardSha256: pending.preview.applyGuardSha256,
          },
          pending.invocation
        )
        eventSha256 = event.eventSha256
        pending.eventSha256 = eventSha256
      }
      await this.#finishAttempt(
        pending.namespaceSha256,
        {
          preview: pending.preview,
          budget: structuredClone(this.#budget),
          eventSha256,
        } satisfies EditPreviewDomainResultV1,
        'completed'
      )
    }
    else
    {
      if (eventSha256 === null)
      {
        const event = await this.#appendEvent(
          'checkpoint-recorded',
          this.head,
          this.head,
          {
            checkpointId: pending.checkpointId,
            label: pending.label,
            ...(pending.note === undefined ? {} : { note: pending.note }),
            revision: pending.revision,
          },
          pending.invocation
        )
        eventSha256 = event.eventSha256
        pending.eventSha256 = eventSha256
      }
      const projection = {
        schemaVersion: 1 as const,
        checkpointId: pending.checkpointId,
        label: pending.label,
        ...(pending.note === undefined ? {} : { note: pending.note }),
        revision: pending.revision,
        eventSha256,
      }
      const checkpoint: EditKernelCheckpointV1 = {
        ...projection,
        checkpointSha256: editCanonicalSha256V1(projection),
      }
      await this.#retainPublicResource(
        this.#layout.checkpoint(
          this.#checkpoints.size,
          checkpoint.checkpointSha256
        ),
        editCanonicalBytesV1(checkpoint),
        'application/json'
      )
      this.#checkpoints.set(checkpoint.checkpointId, checkpoint)
      this.#budget = {
        ...this.#budget,
        checkpoints: this.#checkpoints.size,
      }
      await this.#finishAttempt(
        pending.namespaceSha256,
        checkpoint,
        'completed'
      )
    }
    this.#pendingSameHeadTransition = null
    this.#state = 'active'
    return {
      head: this.head,
      eventSha256,
      reportSha256: this.#reports.at(-1)!.semanticProjectionSha256,
    }
  }

  async checkpoint(
    request: EditCheckpointRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditKernelCheckpointV1>
  {
    return this.#withTransition('checkpoint', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_checkpoint',
        request.requestId,
        request,
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditKernelCheckpointV1
      let eventCommitted = false
      try
      {
        this.#assertExpectedHead(
          {
            ...attempt.attempt.preHead!,
            sourceArtifactSha256: request.expectedSourceArtifactSha256,
            revisionNumber: request.expectedRevisionNumber,
            revisionId: request.expectedRevisionId,
            candidateSha256: request.expectedCandidateSha256,
            assetManifestSha256: request.expectedAssetManifestSha256,
            changeContractSha256: request.expectedChangeContractSha256,
            capabilityProfileSha256: request.expectedCapabilityProfileSha256,
          },
          attempt.attempt.preHead
        )
        if (this.#checkpoints.size >= this.#policy.checkpointLimit)
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'checkpoint limit is exhausted',
            false,
            {
              limit: this.#policy.checkpointLimit,
              observed: this.#checkpoints.size + 1,
            }
          )
        if (
          [...this.#checkpoints.values()].some(
            (entry) => entry.label === request.label
          )
        )
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'checkpoint label must be unique within the session',
            false,
            { limit: 1, observed: 2 }
          )
        const checkpointId = editOpaqueIdV1(
          'checkpoint',
          this.#entropy.randomBytes(16),
          { sessionId: this.sessionId, label: request.label, head: this.head }
        )
        const pending: Extract<
          EditPendingSameHeadTransitionV1,
          { readonly kind: 'checkpoint' }
        > = {
          kind: 'checkpoint',
          namespaceSha256: attempt.namespaceSha256,
          checkpointId,
          label: request.label,
          ...(request.note === undefined ? {} : { note: request.note }),
          revision: exactRevisionFromHeadV1(this.head),
          invocation,
          eventSha256: null,
        }
        this.#pendingSameHeadTransition = pending
        await this.#retainSessionImmutable(
          this.#layout.attempt(
            attempt.attempt.sequence,
            attempt.requestSha256,
            'recovery-authority.json'
          ),
          editCanonicalBytesV1({
            schemaVersion: 1,
            kind: 'checkpoint-recovery-authority-v1',
            namespaceSha256: attempt.namespaceSha256,
            requestSha256: attempt.requestSha256,
            invocationCorrelation: asInvocationCorrelation(invocation),
            checkpointId,
            label: request.label,
            ...(request.note === undefined ? {} : { note: request.note }),
            revision: exactRevisionFromHeadV1(this.head),
          })
        )
        const event = await this.#appendEvent(
          'checkpoint-recorded',
          this.head,
          this.head,
          {
            checkpointId,
            label: request.label,
            ...(request.note === undefined ? {} : { note: request.note }),
            revision: exactRevisionFromHeadV1(this.head),
          },
          invocation
        )
        eventCommitted = true
        pending.eventSha256 = event.eventSha256
        const projection = {
          schemaVersion: 1,
          checkpointId,
          label: request.label,
          ...(request.note === undefined ? {} : { note: request.note }),
          revision: exactRevisionFromHeadV1(this.head),
          eventSha256: event.eventSha256,
        }
        const checkpointSha256 = editCanonicalSha256V1(projection)
        const checkpoint: EditKernelCheckpointV1 = {
          ...projection,
          checkpointSha256,
        }
        await this.#retainPublicResource(
          this.#layout.checkpoint(this.#checkpoints.size, checkpointSha256),
          editCanonicalBytesV1(checkpoint),
          'application/json'
        )
        this.#checkpoints.set(checkpointId, checkpoint)
        this.#budget = {
          ...this.#budget,
          checkpoints: this.#checkpoints.size,
        }
        await this.#finishAttempt(
          attempt.namespaceSha256,
          checkpoint,
          'completed'
        )
        this.#pendingSameHeadTransition = null
        return checkpoint
      }
      catch (error)
      {
        if (
          eventCommitted ||
          this.#pendingSameHeadTransition?.kind === 'checkpoint'
        )
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `checkpoint authority was allocated but completion requires reconciliation: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true
          )
        }
        return this.#refuseAttempt(attempt.namespaceSha256, error)
      }
    })
  }

  async #restore(
    restore: EditRestoreRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  {
    const [restoreKind, request] = restore
    await this.#recoverExactPendingRequest(
      restoreKind === 'undo' ? 'edit_undo' : 'edit_rollback',
      request.requestId,
      request,
      invocation
    )
    return this.#withTransition(restoreKind, invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        restoreKind === 'undo' ? 'edit_undo' : 'edit_rollback',
        request.requestId,
        request,
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditRestoreDomainResultV1
      try
      {
        this.#assertExpectedHead(
          {
            ...attempt.attempt.preHead!,
            sourceArtifactSha256: request.expectedSourceArtifactSha256,
            revisionNumber: request.expectedRevisionNumber,
            revisionId: request.expectedRevisionId,
            candidateSha256: request.expectedCandidateSha256,
            assetManifestSha256: request.expectedAssetManifestSha256,
            changeContractSha256: request.expectedChangeContractSha256,
            capabilityProfileSha256: request.expectedCapabilityProfileSha256,
          },
          attempt.attempt.preHead
        )
        if (!this.#budget.restoreReserveHeld)
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'restore reserve is unavailable',
            false,
            {
              limit: this.#policy.acceptedRevisionLimit,
              observed: this.#revisions.length,
            }
          )
        const from = this.#revisions.at(-1)!
        let selected: EditKernelRevisionRecordV1 | undefined
        if (restoreKind === 'undo')
        {
          if (
            from.revision.hashProjection.transition.transitionKind !==
              'apply' ||
            from.head.revisionId !== request.expectedUndoableApplyRevisionId
          )
            throw new EditSessionErrorV1(
              'edit.stale_revision',
              'only the immediately preceding apply is undoable',
              false,
              {
                expectedRevisionId: request.expectedUndoableApplyRevisionId,
                currentRevisionId: from.head.revisionId,
              }
            )
          const predecessor = from.revision.hashProjection.predecessor
          selected =
            predecessor.state === 'present'
              ? this.#revisions.find(
                  (entry) =>
                    entry.head.revisionNumber === predecessor.revisionNumber &&
                    entry.head.revisionId === predecessor.revisionId
                )
              : undefined
        }
        else
        {
          const target = request.target
          if (target.kind === 'revision')
            selected = this.#revisions.find(
              (entry) =>
                entry.head.revisionNumber === target.revisionNumber &&
                entry.head.revisionId === target.revisionId
            )
          else
          {
            const checkpoint = this.#checkpoints.get(target.checkpointId)
            if (
              checkpoint &&
              checkpoint.checkpointSha256 === target.expectedCheckpointSha256
            )
              selected = this.#revisions.find(
                (entry) =>
                  entry.head.revisionId === checkpoint.revision.revisionId
              )
          }
        }
        if (!selected)
        {
          if (restoreKind === 'rollback')
          {
            if (request.target.kind === 'checkpoint')
              throw new EditSessionErrorV1(
                'edit.stale_certificate',
                'restore checkpoint authority is not retained'
              )
            throw new EditSessionErrorV1(
              'edit.stale_revision',
              'restore target is not retained',
              false,
              {
                expectedRevisionId: request.target.revisionId,
                currentRevisionId: from.head.revisionId,
              }
            )
          }
          throw new EditSessionErrorV1(
            'edit.stale_revision',
            'restore target is not retained',
            false,
            {
              expectedRevisionId: request.expectedUndoableApplyRevisionId,
              currentRevisionId: from.head.revisionId,
            }
          )
        }
        if (selected.head.revisionId === from.head.revisionId)
          throw new EditSessionErrorV1(
            'edit.semantic_noop',
            'restore target is already the current head'
          )
        const fromBytes = await this.#store.readImmutable(from.candidateKey)
        const selectedBytes = await this.#store.readImmutable(
          selected.candidateKey
        )
        const fromProject = await ProjectIR.fromSb3(fromBytes)
        const selectedProject = await ProjectIR.fromSb3(selectedBytes)
        const sourceProject = await ProjectIR.fromSb3(this.#sourceBytes)
        const sourceLineage = buildSourceLineageV1(
          sourceProject,
          this.semanticSourceSha256
        ).active
        const resolveOwnerLineageId = existingBindingOwnerLineageResolverV1(
          sourceProject,
          this.#contract.registration.semanticContract,
          sourceLineage
        )
        const restoreDeltaInput = {
          before: fromProject,
          after: selectedProject,
          beforeLineage: from.activeLineage as SemanticLineageSnapshot,
          afterLineage: selected.activeLineage as SemanticLineageSnapshot,
          beforeRevisionIdentity: from.head.revisionId,
          afterRevisionIdentity: selected.head.revisionId,
          semanticSourceSha256: this.semanticSourceSha256,
        }
        const unattributedRestoreDelta =
          computeLineageProjectDeltaV1(restoreDeltaInput)
        const restoreCommandSha256 = editCanonicalSha256V1(request)
        const predecessorAcceptedHistorySha256 = historyProjectionV1(
          this.semanticSourceSha256,
          this.#revisions
        ).sha256
        const restoreOccurrenceId = editRestoreOccurrenceIdV1(
          predecessorAcceptedHistorySha256,
          restoreKind,
          restoreCommandSha256
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
          from.lineageHistory as SemanticLineageSnapshot,
          selected.activeLineage as SemanticLineageSnapshot
        )
        const restoreFutureBindingLedger =
          reconcileRestoreFutureBindingLedgerV1(
            retainedFutureBindingLedgerV1(from.authorization),
            retainedFutureBindingLedgerV1(selected.authorization),
            this.#contract.registration.semanticContract,
            restoreLineageHistory,
            resolveOwnerLineageId
          )
        const record = buildRestoreRevisionV1(
          {
            semanticSourceSha256: this.semanticSourceSha256,
            sourceArtifactSha256: this.#manifest.sourceArtifactSha256,
            changeContractSha256: this.#manifest.changeContractSha256,
            capabilityProfileSha256: this.#manifest.capabilityProfileSha256,
            capabilitySnapshotSha256: ZERO_SHA256,
            originatingRequestId: request.requestId,
            invocationCorrelation: asInvocationCorrelation(invocation),
            hostTimestampEpochMs: this.#clock.nowEpochMs(),
          },
          from,
          selected,
          restoreKind,
          restoreCommandSha256,
          restoreDelta,
          from.allocatorState,
          restoreLineageHistory,
          restoreFutureBindingLedger,
          '',
          ''
        )
        record.candidateKey = this.#layout.revision(
          record.head.revisionNumber,
          record.head.revisionId,
          'candidate.sb3'
        )
        record.manifestKey = this.#layout.revision(
          record.head.revisionNumber,
          record.head.revisionId,
          'manifest.json'
        )
        const capabilitySnapshot = this.#capabilitySnapshot(record.head)
        record.head = {
          ...record.head,
          capabilitySnapshotSha256: capabilitySnapshot.capabilitySnapshotSha256,
        }
        record.capabilitySnapshot = capabilitySnapshot
        const committed = await this.#commitRevision(
          record,
          selectedBytes,
          invocation,
          null
        )
        const result: EditRestoreDomainResultV1 = {
          head: this.head,
          restoreKind,
          fromRevision: from.head,
          selectedRevision: selected.head,
          restoreDeltaSha256:
            record.revision.hashProjection.parentChildDeltaSha256,
          preparedEventSha256: committed.preparedEvent.eventSha256,
          committedEventSha256: committed.committedEvent.eventSha256,
          reportSha256: committed.report.semanticProjectionSha256,
          budget: structuredClone(this.#budget),
        }
        await this.#finishAttempt(attempt.namespaceSha256, result, 'completed')
        return result
      }
      catch (error)
      {
        if (error instanceof EditSessionErrorV1 && error.committed) throw error
        if (
          attempt.attempt.preHead !== null &&
          !sameHeadV1(attempt.attempt.preHead, this.head)
        )
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `head committed but restore result requires reconciliation: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true
          )
        }
        return this.#refuseAttempt(attempt.namespaceSha256, error)
      }
    })
  }

  undo(
    request: EditUndoRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  {
    return this.#restore(['undo', request], invocation)
  }

  rollback(
    request: EditRollbackRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  {
    return this.#restore(['rollback', request], invocation)
  }

  // the contract's named plans, activated once & memoized; activation refuses a
  // structurally unsatisfiable plan before any lane runs
  #plans(): ActivatedEvaluationPlanSetV1
  {
    if (this.#activatedPlans === null)
    {
      try
      {
        this.#activatedPlans = activateEvaluationPlanSetV1(
          this.#contract.registration.semanticContract,
          this.#contract.retainedPoliciesBySemanticSha256
        )
      }
      catch (error)
      {
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          error instanceof EditEvaluationPlanErrorV1
            ? `evaluation plan activation refused: ${error.reason}: ${error.message}`
            : `evaluation plan activation refused: ${String(error)}`
        )
      }
    }
    return this.#activatedPlans
  }

  get certificates(): readonly EditRetainedCertificateV1[]
  {
    return this.#certificates
  }

  exportability(): EditExportabilityV1
  {
    return evaluateExportabilityV1({
      retained: this.#certificates,
      head: this.head,
      exportRequiredPlanId: this.#plans().exportRequiredPlanId,
    })
  }

  #evaluationDeadlineMs(): number
  {
    return (
      this.#evaluationPorts?.externalEvidenceDeadlineMs ??
      EXTERNAL_EVIDENCE_DEADLINE_DEFAULT_MS
    )
  }

  #deterministicResultSha256(
    result: EditDeterministicEvaluationResultV1
  ): string
  {
    return editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'deterministic-evaluation-result',
      identity: result.identity,
      laneStatuses: result.laneStatuses,
      candidateObservations: result.candidateObservations,
      preservationObservations: result.preservationObservations,
      baselineDiagnostics: result.baselineDiagnostics,
      candidateDiagnostics: result.candidateDiagnostics,
      allowedNewDiagnosticFingerprints: result.allowedNewDiagnosticFingerprints,
      boundedResourceIssueCodes: result.boundedResourceIssueCodes,
      evidence: result.evidence,
      evidenceArtifactIndex: result.evidenceArtifactIndex,
      projectJsonSha256: result.projectJsonSha256,
      evaluatedCandidateByteLength: result.evaluatedCandidateByteLength,
      fixedTimePolicySha256: result.fixedTimePolicySha256,
      seedSetSha256: result.seedSetSha256,
      externalRequests: result.externalRequests.map(
        editExternalEvidenceRequestSemanticProjectionV1
      ),
      limitations: result.limitations,
    })
  }

  // * the attempt identity is frozen before dispatch from retained authority;
  // * runtime results enter later evidence, never the prepared locator
  #evaluationAttemptSha256(input: {
    plan: ActivatedEvaluationPlanV1
    revision: ExactRevisionIdentityV1
    semanticSourceSha256: string
    historySha256: string
    matrixSha256: string
    sequence: number
  }): string
  {
    return semanticHashV1('certificate', {
      kind: 'evaluation-attempt',
      schemaVersion: 1,
      evaluationPlanId: input.plan.planId,
      evaluationPlanSha256: input.plan.evaluationPlanSha256,
      evaluatedRevision: input.revision,
      semanticSourceSha256: input.semanticSourceSha256,
      historySha256: input.historySha256,
      matrixSha256: input.matrixSha256,
      sequence: input.sequence,
    })
  }

  // builds the certificate & its aggregate from one deterministic result plus
  // whatever external observations have been merged into it
  #certifyEvaluation(input: {
    plan: ActivatedEvaluationPlanV1
    revision: ExactRevisionIdentityV1
    semanticSourceSha256: string
    historySha256: string
    deterministic: EditDeterministicEvaluationResultV1
    candidateObservations: readonly EditCandidateObservationV1[]
    additionalEvidence: readonly EditEvaluationEvidenceEntryV1[]
    externalObjectives: readonly EditStructuralObjectiveObservationV1[]
    laneStatuses: readonly EditLaneStatusV1[]
    extraLimitations: readonly string[]
  }): ReturnType<typeof buildEditEvaluationCertificateV1>
  {
    const evaluatedRevision = this.#revisions.find(
      (revision) =>
        revision.head.revisionId === input.revision.revisionId &&
        revision.head.revisionNumber === input.revision.revisionNumber
    )
    if (evaluatedRevision === undefined)
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'evaluated revision is outside the retained revision chain',
        false,
        {
          expectedRevisionId: input.revision.revisionId,
          currentRevisionId: this.head.revisionId,
        }
      )
    if (
      input.deterministic.evidence.length + input.additionalEvidence.length >
      128
    )
      throw new EditSessionErrorV1(
        'edit.session_budget_exceeded',
        'certificate evidence exceeds the reserved V1 128-entry limit',
        false,
        {
          limit: 128,
          observed:
            input.deterministic.evidence.length +
            input.additionalEvidence.length,
        }
      )
    return buildEditEvaluationCertificateV1({
      plan: input.plan,
      revision: input.revision,
      semanticSourceSha256: input.semanticSourceSha256,
      historySha256: input.historySha256,
      projectJsonSha256: input.deterministic.projectJsonSha256,
      evaluatedCandidateByteLength:
        input.deterministic.evaluatedCandidateByteLength,
      identity: input.deterministic.identity,
      fixedTimePolicySha256: input.deterministic.fixedTimePolicySha256,
      seedSetSha256: input.deterministic.seedSetSha256,
      laneStatuses: input.laneStatuses,
      required: aggregateRequiredChangeV1({
        predicates: input.plan.requiredRuntimeChanges,
        observations: input.candidateObservations,
        structuralObjectives: [
          ...structuralObjectiveObservationsV1(
            this.#contract.registration.semanticContract,
            evaluatedRevision.authorization
          ),
          ...input.externalObjectives,
        ],
        planClass: input.plan.planClass,
      }),
      allowed: aggregateAllowedChangeV1({
        baselineDiagnostics: input.deterministic.baselineDiagnostics,
        candidateDiagnostics: input.deterministic.candidateDiagnostics,
        allowedNewDiagnosticFingerprints:
          input.deterministic.allowedNewDiagnosticFingerprints,
        boundedResourceIssueCodes:
          input.deterministic.boundedResourceIssueCodes,
        laneStatuses: input.laneStatuses,
      }),
      preservation: aggregatePreservationV1({
        lenses: input.plan.preservationLenses,
        observations: input.deterministic.preservationObservations,
      }),
      evidence: [...input.deterministic.evidence, ...input.additionalEvidence],
      extraLimitations: [
        ...input.deterministic.limitations,
        ...input.extraLimitations,
      ],
    })
  }

  #evidenceCollection(
    deterministic: EditDeterministicEvaluationResultV1
  ): EvidenceContentHashCollectionV1
  {
    return editEvidenceContentCollectionV1(
      deterministic.evidence.map((entry) => entry.contentSha256)
    )
  }

  async #retainEvaluationArtifact(
    sequence: number,
    attemptSha256: string,
    name: string,
    payload: unknown,
    retention?: EvaluationRetentionV1
  ): Promise<number>
  {
    const bytes = editCanonicalBytesV1(payload)
    if (
      retention !== undefined &&
      retention.retainedBytes + bytes.byteLength > retention.reservedBytes
    )
      throw new EditSessionErrorV1(
        'edit.artifact_quota_exceeded',
        'evaluation artifacts exceeded their pre-dispatch quota reservation'
      )
    await this.#retainSessionImmutable(
      this.#layout.evaluation(sequence, attemptSha256, name),
      bytes
    )
    if (retention !== undefined) retention.retainedBytes += bytes.byteLength
    return bytes.byteLength
  }

  async #retainEvaluationEvidencePayloads(
    payloads: readonly import('../evaluation/evaluation-ports.js').EditEvaluationEvidencePayloadV1[],
    retention: EvaluationRetentionV1
  ): Promise<void>
  {
    const existing = new Set(
      (
        await this.#store.listImmutable(
          `${this.#layout.prefix}/evaluation-evidence`
        )
      ).map((entry) => entry.key)
    )
    const written = new Set<string>()
    for (const payload of payloads)
    {
      if (
        payload.bytes.byteLength !== payload.byteLength ||
        sha256Hex(payload.bytes) !== payload.payloadSha256
      )
        throw new EditSessionErrorV1(
          'edit.fingerprint_mismatch',
          'deterministic evidence payload bytes do not match their index'
        )
      const key = this.#layout.evaluationEvidence(payload.payloadSha256)
      const charge =
        existing.has(key) || written.has(key) ? 0 : payload.byteLength
      if (retention.retainedBytes + charge > retention.reservedBytes)
        throw new EditSessionErrorV1(
          'edit.artifact_quota_exceeded',
          'evaluation evidence exceeded its pre-dispatch quota reservation'
        )
      await this.#retainPublicResource(
        key,
        payload.bytes,
        exactRetainedResourceMimeTypeV1(payload.mediaType)
      )
      retention.retainedBytes += charge
      written.add(key)
    }
  }

  async #settleEvaluationRetention(
    retention: EvaluationRetentionV1
  ): Promise<void>
  {
    if (retention.settled) return
    await this.#store.settleQuota(
      retention.reservationId,
      retention.retainedBytes
    )
    retention.settled = true
  }

  async #releaseEvaluationRetention(
    retention: EvaluationRetentionV1
  ): Promise<void>
  {
    if (retention.settled) return
    try
    {
      await this.#store.releaseQuota(retention.reservationId)
    }
    catch
    {
      // the first call may have failed after its durable commit
      await this.#store.releaseQuota(retention.reservationId)
    }
    retention.settled = true
  }

  async #requireEvaluationRecoveryV1(error: unknown): Promise<never>
  {
    this.#state = 'recovery-required'
    this.#evaluationState = 'inconclusive'
    let reconciliationFailure: unknown = null
    try
    {
      await this.#retainReport(this.#buildReport('recovery-required'), true)
    }
    catch (reportError)
    {
      reconciliationFailure ??= reportError
    }
    const detail = error instanceof Error ? error.message : String(error)
    const reconciliationDetail =
      reconciliationFailure === null
        ? ''
        : `; reconciliation also failed: ${
            reconciliationFailure instanceof Error
              ? reconciliationFailure.message
              : String(reconciliationFailure)
          }`
    throw new EditSessionErrorV1(
      'edit.recovery_required',
      `evaluation persistence requires reconciliation: ${detail}${reconciliationDetail}`,
      true
    )
  }

  async evaluate(
    request: EditEvaluateRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluateDomainResultV1>
  {
    return request.action === 'start'
      ? this.#evaluateStart(request, invocation)
      : this.#evaluateFinalize(request, invocation)
  }

  async #evaluateStart(
    request: Extract<EditEvaluateRequestV1, { action: 'start' }>,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluateDomainResultV1>
  {
    return this.#withTransition('evaluate', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_evaluate',
        request.requestId,
        request,
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditEvaluateDomainResultV1
      let evaluationRetention: EvaluationRetentionV1 | null = null
      let preparationRetained = false
      let preparationWriteAttempted = false
      let preparationKey: string | null = null
      let preparationBytes: Uint8Array | null = null
      let reservedEvaluationSequence: number | null = null
      let reservedEvaluationAttemptSha256: string | null = null
      try
      {
        if (this.#evaluationPorts === null)
        {
          throw new EditSessionErrorV1(
            'edit.evaluation_unavailable',
            'no deterministic evaluation port is configured',
            false,
            { evidenceId: this.#currentReportEvidenceId() }
          )
        }
        if (this.#evaluationSequence >= this.#effectiveEvaluationRunLimit())
        {
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'evaluation-run capacity is exhausted',
            false,
            {
              limit: this.#effectiveEvaluationRunLimit(),
              observed: this.#evaluationSequence + 1,
            }
          )
        }
        // the seven expected hashes bind the exact revision this evaluation is
        // about; a stale one refuses before any lane is reserved
        const head = this.head
        if (
          request.expectedRevisionId !== head.revisionId ||
          request.expectedRevisionNumber !== head.revisionNumber
        )
        {
          throw new EditSessionErrorV1(
            'edit.stale_revision',
            'expected revision is not the current head',
            false,
            {
              expectedRevisionId: request.expectedRevisionId,
              currentRevisionId: head.revisionId,
            }
          )
        }
        if (request.expectedCandidateSha256 !== head.candidateSha256)
          throw new EditSessionErrorV1(
            'edit.stale_candidate',
            'expected candidate is not the current head',
            false,
            {
              expectedCandidateSha256: request.expectedCandidateSha256,
              currentCandidateSha256: head.candidateSha256,
            }
          )
        if (request.expectedSourceArtifactSha256 !== head.sourceArtifactSha256)
          throw new EditSessionErrorV1(
            'edit.stale_revision',
            'expected source artifact differs from the exact revision identity',
            false,
            {
              expectedRevisionId: request.expectedRevisionId,
              currentRevisionId: head.revisionId,
            }
          )
        if (request.expectedAssetManifestSha256 !== head.assetManifestSha256)
          throw new EditSessionErrorV1(
            'edit.stale_revision',
            'expected asset manifest differs from the exact revision identity',
            false,
            {
              expectedRevisionId: request.expectedRevisionId,
              currentRevisionId: head.revisionId,
            }
          )
        if (request.expectedChangeContractSha256 !== head.changeContractSha256)
          throw new EditSessionErrorV1(
            'edit.stale_contract',
            'expected change contract is stale'
          )
        if (
          request.expectedCapabilityProfileSha256 !==
          head.capabilityProfileSha256
        )
          throw new EditSessionErrorV1(
            'edit.stale_capability_profile',
            'expected capability profile is stale'
          )
        const plan = this.#plans().plan(request.evaluationPlanId)
        if (
          !evaluationPlanExternalJudgeReadyV1(plan.plan, this.#evaluationPorts)
        )
          throw new EditSessionErrorV1(
            'edit.evaluation_unavailable',
            'the evaluation plan requires both an external evidence producer and inbox',
            false,
            { evidenceId: this.#currentReportEvidenceId() }
          )
        const revision = exactRevisionFromHeadV1(head)
        const semanticSourceSha256 = this.semanticSourceSha256
        const historySha256 = historyProjectionV1(
          semanticSourceSha256,
          this.#revisions
        ).sha256
        const sequence = this.#evaluationSequence
        const evaluationId = editOpaqueIdV1(
          'evaluation',
          this.#entropy.randomBytes(16),
          { sessionId: this.sessionId, sequence, planId: plan.planId }
        )
        const baselineBytes = this.#sourceBytes
        const candidateBytes = await this.#currentCandidateBytes()
        const baselineProject = await ProjectIR.fromSb3(baselineBytes)
        const candidateProject = await ProjectIR.fromSb3(candidateBytes)
        const baselineRevision = this.#revisions[0]!
        const candidateRevision = this.#revisions.at(-1)!
        const baselineLineage = validateSemanticLineageSnapshot(
          baselineRevision.activeLineage as SemanticLineageSnapshot
        )
        const candidateLineage = validateSemanticLineageSnapshot(
          candidateRevision.activeLineage as SemanticLineageSnapshot
        )
        const candidateLineageHistory = validateSemanticLineageSnapshot(
          candidateRevision.lineageHistory as SemanticLineageSnapshot
        )
        const contract = this.#contract.registration.semanticContract
        const matrix = reserveEditEvaluationMatrixV1({
          laneRequirements: plan.plan.laneRequirements,
          scenarios: plan.scenarioPolicySha256s.map((semanticSha256) =>
          {
            const scenario =
              this.#contract.retainedPoliciesBySemanticSha256[semanticSha256]
                ?.scenarioPolicy
            if (scenario === undefined)
              throw new EditSessionErrorV1(
                'edit.internal_invariant',
                'activated evaluation plan cannot reopen one scenario policy'
              )
            return {
              scenarioId: scenario.scenarioId,
              applicability: scenario.applicability,
              semanticPolicySha256: semanticSha256,
            }
          }),
          artifactSides: ['baseline', 'candidate'],
          limitOverrides: { ...plan.resourceLimitOverrides },
        })
        if (matrix.status === 'refused')
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            `evaluation matrix refused before dispatch: ${matrix.reason}: ${matrix.detail}`,
            false,
            { limit: matrix.limit, observed: matrix.requestedCellCount }
          )
        const attemptSha256 = this.#evaluationAttemptSha256({
          plan,
          revision,
          semanticSourceSha256,
          historySha256,
          matrixSha256: matrix.matrixSha256,
          sequence,
        })
        reservedEvaluationSequence = sequence
        reservedEvaluationAttemptSha256 = attemptSha256
        const availableArtifactBytes =
          this.#effectiveArtifactByteLimit() - this.#budget.artifactBytesUsed
        const prospectiveArtifactBytes = matrix.reservedArtifactBytesTotal
        if (prospectiveArtifactBytes > availableArtifactBytes)
          throw new EditSessionErrorV1(
            'edit.artifact_quota_exceeded',
            'the full prospective evaluation reservation exceeds remaining session artifact capacity'
          )
        const reservationId = editCanonicalSha256V1({
          sessionId: this.sessionId,
          attemptSha256,
          startAttemptNamespaceSha256: attempt.namespaceSha256,
          purpose: 'evaluation-retention',
        })
        let quota: Awaited<ReturnType<EditArtifactStorePort['reserveQuota']>>
        try
        {
          quota = await this.#store.reserveQuota(
            reservationId,
            prospectiveArtifactBytes
          )
        }
        catch (reserveError)
        {
          let outcome: Awaited<
            ReturnType<EditArtifactStorePort['quotaOutcome']>
          >
          try
          {
            outcome = await this.#store.quotaOutcome(reservationId)
          }
          catch (outcomeError)
          {
            return this.#requireEvaluationRecoveryV1(outcomeError)
          }
          if (outcome.state === 'absent') throw reserveError
          if (
            outcome.state !== 'active' ||
            outcome.reservedBytes !== prospectiveArtifactBytes
          )
            return this.#requireEvaluationRecoveryV1(reserveError)
          evaluationRetention = {
            reservationId,
            reservedBytes: prospectiveArtifactBytes,
            retainedBytes: 0,
            settled: false,
          }
          throw reserveError
        }
        if (
          quota.reservationId !== reservationId ||
          quota.reservedBytes !== prospectiveArtifactBytes
        )
        {
          let outcome: Awaited<
            ReturnType<EditArtifactStorePort['quotaOutcome']>
          >
          try
          {
            outcome = await this.#store.quotaOutcome(reservationId)
          }
          catch (outcomeError)
          {
            return this.#requireEvaluationRecoveryV1(outcomeError)
          }
          if (
            outcome.state !== 'active' ||
            outcome.reservedBytes !== prospectiveArtifactBytes
          )
            return this.#requireEvaluationRecoveryV1(
              new EditSessionErrorV1(
                'edit.internal_invariant',
                'evaluation quota reservation response differs from durable authority'
              )
            )
          evaluationRetention = {
            reservationId,
            reservedBytes: prospectiveArtifactBytes,
            retainedBytes: 0,
            settled: false,
          }
          throw new EditSessionErrorV1(
            'edit.internal_invariant',
            'evaluation quota reservation response differs from the exact request'
          )
        }
        evaluationRetention = {
          reservationId,
          reservedBytes: prospectiveArtifactBytes,
          retainedBytes: 0,
          settled: false,
        }
        const preparation = {
          schemaVersion: 1,
          sequence,
          evaluationPlanId: plan.planId,
          evaluationPlanSha256: plan.evaluationPlanSha256,
          evaluatedRevision: revision,
          semanticSourceSha256,
          historySha256,
          matrixSha256: matrix.matrixSha256,
          attemptSha256,
          startRequestSha256: attempt.requestSha256,
          startAttemptNamespaceSha256: attempt.namespaceSha256,
          reservationId,
          reservedBytes: prospectiveArtifactBytes,
        }
        preparationBytes = editCanonicalBytesV1(preparation)
        if (preparationBytes.byteLength > evaluationRetention.reservedBytes)
          throw new EditSessionErrorV1(
            'edit.artifact_quota_exceeded',
            'evaluation preparation exceeds remaining session artifact capacity'
          )
        preparationKey = this.#layout.evaluation(
          sequence,
          attemptSha256,
          '000000-prepared.json'
        )
        preparationWriteAttempted = true
        await this.#retainSessionImmutable(preparationKey, preparationBytes)
        evaluationRetention.retainedBytes += preparationBytes.byteLength
        preparationRetained = true
        this.#evaluationSequence = sequence + 1
        const deterministicRequest = {
          evaluationId,
          plan,
          revision,
          semanticSourceIdentity: this.#manifest.semanticSourceIdentity,
          semanticSourceSha256,
          changeContractSha256: this.#manifest.changeContractSha256,
          historySha256,
          matrixSha256: matrix.matrixSha256,
          candidateBytes,
          baselineBytes,
          baselineRuntime: {
            assignment: buildEditRuntimeLineageAssignmentV1(
              baselineProject,
              baselineLineage
            ),
            bindings: buildEditRuntimeBindingTableV1({
              source: baselineProject,
              sourceLineage: baselineLineage,
              artifactLineage: baselineLineage,
              lineageHistory: baselineLineage,
              contract,
              ledger: retainedFutureBindingLedgerV1(
                baselineRevision.authorization
              ),
              side: 'baseline',
            }),
            diagnosticLineage: buildEditDiagnosticLineageTablesV1(
              baselineProject,
              baselineLineage
            ),
          },
          candidateRuntime: {
            assignment: buildEditRuntimeLineageAssignmentV1(
              candidateProject,
              candidateLineage
            ),
            bindings: buildEditRuntimeBindingTableV1({
              source: baselineProject,
              sourceLineage: baselineLineage,
              artifactLineage: candidateLineage,
              lineageHistory: candidateLineageHistory,
              contract,
              ledger: retainedFutureBindingLedgerV1(
                candidateRevision.authorization
              ),
              side: 'candidate',
            }),
            diagnosticLineage: buildEditDiagnosticLineageTablesV1(
              candidateProject,
              candidateLineage
            ),
          },
          runtimeProjectionAuthorizations:
            immutableEditRuntimeProjectionAuthorizationsV1(
              candidateRevision.runtimeProjectionAuthorizations
            ),
          policies: Object.freeze(
            Object.values(this.#contract.retainedPoliciesBySemanticSha256).map(
              (artifact) => structuredClone(artifact)
            )
          ),
        }
        const execution =
          await this.#evaluationPorts.deterministic.evaluate(
            deterministicRequest
          )
        await validateEditProductionEvaluationExecutionV1({
          request: {
            ...deterministicRequest,
            projectionAuthority:
              deterministicRequest.runtimeProjectionAuthorizations,
          },
          result: execution.result,
          evidencePayloads: execution.evidencePayloads,
        })
        const deterministic = execution.result
        await this.#retainEvaluationEvidencePayloads(
          execution.evidencePayloads,
          evaluationRetention
        )
        await this.#retainEvaluationArtifact(
          sequence,
          attemptSha256,
          'deterministic-results.json',
          {
            schemaVersion: 1,
            deterministicResultSha256:
              this.#deterministicResultSha256(deterministic),
            deterministic,
          },
          evaluationRetention
        )
        const evidenceContent = this.#evidenceCollection(deterministic)
        await this.#retainEvaluationArtifact(
          sequence,
          attemptSha256,
          'deterministic-evidence-index.json',
          { schemaVersion: 1, evidenceContent },
          evaluationRetention
        )
        const needsExternal =
          plan.requiresExternalEvidence &&
          deterministic.externalRequests.length > 0
        if (needsExternal)
        {
          return await this.#awaitExternalEvidence({
            attemptNamespaceSha256: attempt.namespaceSha256,
            sequence,
            attemptSha256,
            evaluationId,
            plan,
            revision,
            semanticSourceSha256,
            historySha256,
            deterministic,
            evidenceContent,
            retention: evaluationRetention,
            invocation,
          })
        }
        return await this.#completeEvaluation({
          attemptNamespaceSha256: attempt.namespaceSha256,
          sequence,
          attemptSha256,
          evaluationId,
          plan,
          revision,
          semanticSourceSha256,
          historySha256,
          deterministic,
          candidateObservations: deterministic.candidateObservations,
          additionalEvidence: [],
          externalObjectives: [],
          laneStatuses: deterministic.laneStatuses,
          externalRecords: [],
          evidenceContent,
          extraLimitations: [],
          retention: evaluationRetention,
          invocation,
        })
      }
      catch (error)
      {
        if (this.#state === 'recovery-required') throw error
        if (
          !preparationRetained &&
          preparationWriteAttempted &&
          evaluationRetention !== null &&
          preparationKey !== null &&
          preparationBytes !== null &&
          reservedEvaluationSequence !== null
        )
        {
          let retainedPreparation: Uint8Array | null = null
          try
          {
            const directory = preparationKey.slice(
              0,
              preparationKey.lastIndexOf('/')
            )
            const entries = await this.#store.listImmutable(directory)
            if (entries.some((entry) => entry.key === preparationKey))
              retainedPreparation =
                await this.#store.readImmutable(preparationKey)
          }
          catch (reconciliationError)
          {
            return this.#requireEvaluationRecoveryV1(reconciliationError)
          }
          if (retainedPreparation !== null)
          {
            preparationRetained = true
            this.#evaluationSequence = reservedEvaluationSequence + 1
            if (
              retainedPreparation.byteLength === preparationBytes.byteLength &&
              sha256Hex(retainedPreparation) === sha256Hex(preparationBytes)
            )
              evaluationRetention.retainedBytes = retainedPreparation.byteLength
            return this.#requireEvaluationRecoveryV1(error)
          }
        }
        if (preparationRetained) return this.#requireEvaluationRecoveryV1(error)
        if (evaluationRetention !== null)
        {
          try
          {
            await this.#releaseEvaluationRetention(evaluationRetention)
          }
          catch (releaseError)
          {
            return this.#requireEvaluationRecoveryV1(releaseError)
          }
          let quota: Awaited<ReturnType<EditArtifactStorePort['quotaOutcome']>>
          try
          {
            quota = await this.#store.quotaOutcome(
              evaluationRetention.reservationId
            )
          }
          catch (outcomeError)
          {
            return this.#requireEvaluationRecoveryV1(outcomeError)
          }
          if (
            quota.state !== 'released' ||
            quota.reservedBytes !== evaluationRetention.reservedBytes ||
            quota.actualBytes !== 0
          )
            return this.#requireEvaluationRecoveryV1(
              new EditSessionErrorV1(
                'edit.internal_invariant',
                'released evaluation quota outcome does not reconcile'
              )
            )
        }
        return this.#refuseAttempt(
          attempt.namespaceSha256,
          error,
          evaluationRetention === null ||
            reservedEvaluationSequence === null ||
            reservedEvaluationAttemptSha256 === null
            ? undefined
            : {
                schemaVersion: 1,
                evaluationSequence: reservedEvaluationSequence,
                evaluationAttemptSha256: reservedEvaluationAttemptSha256,
                reservationId: evaluationRetention.reservationId,
                reservedBytes: evaluationRetention.reservedBytes,
              },
          true
        )
      }
    })
  }

  async #awaitExternalEvidence(input: {
    attemptNamespaceSha256: string
    sequence: number
    attemptSha256: string
    evaluationId: string
    plan: ActivatedEvaluationPlanV1
    revision: ExactRevisionIdentityV1
    semanticSourceSha256: string
    historySha256: string
    deterministic: EditDeterministicEvaluationResultV1
    evidenceContent: EvidenceContentHashCollectionV1
    retention: EvaluationRetentionV1
    invocation: HostInvocationContextV1
  }): Promise<EditEvaluateDomainResultV1>
  {
    const requestArtifactIds = Object.freeze(
      input.deterministic.externalRequests.map(
        (entry) => entry.requestArtifactId
      )
    )
    const requestSetSha256 = editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'external-evidence-request-set',
      entries: input.deterministic.externalRequests.map(
        editExternalEvidenceRequestSemanticProjectionV1
      ),
    })
    const deadlineEpochMs =
      this.#clock.nowEpochMs() + this.#evaluationDeadlineMs()
    const deadlineSha256 = editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'external-evidence-deadline',
      evaluationId: input.evaluationId,
      deadlineEpochMs,
    })
    const notificationSha256 = editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'external-evidence-notification',
      evaluationId: input.evaluationId,
      requestSetSha256,
      deadlineSha256,
    })
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'external-requests.json',
      {
        schemaVersion: 1,
        requestSetSha256,
        requests: input.deterministic.externalRequests,
      },
      input.retention
    )
    const eventPayload = Object.freeze({
      state: 'awaitingExternalEvidence',
      certificate: null,
      attemptSha256: input.attemptSha256,
      evaluatedRevision: input.revision,
      requestSetSha256,
    })
    const eventProjection = Object.freeze({
      schemaVersion: 1 as const,
      sessionId: this.sessionId,
      sequence: this.#events.length,
      eventKind: 'evaluation-recorded' as const,
      previousEventSha256: this.#events.at(-1)?.eventSha256,
      preHead: Object.freeze({
        state: 'present' as const,
        head: exactRevisionFromHeadV1(this.head),
      }),
      postHead: exactRevisionFromHeadV1(this.head),
      semanticPayloadSha256: editCanonicalSha256V1(eventPayload),
      invocationCorrelation: asInvocationCorrelation(input.invocation),
    })
    const eventSha256 = semanticHashV1('semantic-event', eventProjection)
    const awaitingRecord = Object.freeze({
      schemaVersion: 1 as const,
      evaluationId: input.evaluationId,
      requestSetSha256,
      deadlineEpochMs,
      deadlineSha256,
      notificationSha256,
      eventSha256,
    })
    const awaitingAuthority: RetainedEvaluationAwaitingAuthorityV1 = {
      schemaVersion: 1,
      kind: 'edit-evaluation-awaiting-authority-v1',
      attemptNamespaceSha256: input.attemptNamespaceSha256,
      evaluationId: input.evaluationId,
      sequence: input.sequence,
      attemptSha256: input.attemptSha256,
      evaluatedRevision: input.revision,
      evidenceContent: input.evidenceContent,
      requestArtifactIds,
      awaitingRecord,
      eventProjection,
      eventSha256,
      reportSha256: this.#buildReport('active').semanticProjectionSha256,
    }
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'awaiting-authority.json',
      awaitingAuthority,
      input.retention
    )
    const event = await this.#appendEvent(
      'evaluation-recorded',
      this.head,
      this.head,
      eventPayload,
      input.invocation
    )
    if (event.eventSha256 !== eventSha256)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'evaluation awaiting event differs from its retained authority'
      )
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      '000001-awaiting-external.json',
      { ...awaitingRecord, eventSha256: event.eventSha256 },
      input.retention
    )
    this.#awaitingEvaluations.set(input.evaluationId, {
      evaluationId: input.evaluationId,
      sequence: input.sequence,
      planId: input.plan.planId,
      attemptSha256: input.attemptSha256,
      revision: input.revision,
      semanticSourceSha256: input.semanticSourceSha256,
      historySha256: input.historySha256,
      deadlineEpochMs,
      deadlineSha256,
      notificationSha256,
      requestSetSha256,
      requestArtifactIds,
      deterministic: input.deterministic,
      retention: input.retention,
    })
    this.#evaluationState = 'awaitingExternalEvidence'
    const retained = await this.#retainReport(this.#buildReport('active'), true)
    // the port learns only the artifact IDs & the deadline, & the transition
    // lock is already being released by the enclosing #withTransition
    if (this.#evaluationPorts?.external !== undefined)
    {
      // notification is advisory after the durable awaiting transition; the
      // caller receives the same host action even if the host queue is down
      void this.#evaluationPorts.external
        .enqueue({
          evaluationId: input.evaluationId,
          requestArtifactIds,
          deadlineEpochMs,
          notificationSha256,
        })
        .catch(() => undefined)
    }
    const result: EditEvaluateDomainResultV1 = {
      evaluationId: input.evaluationId,
      phase: 'awaitingExternalEvidence',
      evaluatedRevision: input.revision,
      evaluationAttemptSha256: input.attemptSha256,
      certificate: { state: 'absent' },
      evidenceContent: input.evidenceContent,
      requiredHostAction: {
        kind: 'stageExternalEvidence',
        evaluationId: input.evaluationId,
        requestArtifactIds,
        requestSetSha256,
        deadlineSha256,
        notificationSha256,
      },
      eventSha256: event.eventSha256,
      reportSha256: retained.report.semanticProjectionSha256,
    }
    await this.#finishAttempt(input.attemptNamespaceSha256, result, 'completed')
    return result
  }

  async #completeEvaluation(
    input: CompleteEvaluationInputV1
  ): Promise<EditEvaluateDomainResultV1>
  {
    try
    {
      return await this.#completeEvaluationTransactionV1(input)
    }
    catch (error)
    {
      this.#awaitingEvaluations.delete(input.evaluationId)
      return this.#requireEvaluationRecoveryV1(error)
    }
  }

  async #completeEvaluationTransactionV1(
    input: CompleteEvaluationInputV1
  ): Promise<EditEvaluateDomainResultV1>
  {
    const externalProvenance = input.externalRecords.map(
      (record) => record.provenance
    )
    const externalProvenanceChainSha256 =
      evaluationProvenanceChainSha256V1(externalProvenance)
    const reconstructedEvidenceContent = editEvidenceContentCollectionV1([
      ...input.deterministic.evidence.map((entry) => entry.contentSha256),
      ...input.additionalEvidence.map((entry) => entry.contentSha256),
    ])
    if (
      reconstructedEvidenceContent.collectionSha256 !==
      input.evidenceContent.collectionSha256
    )
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'certified evidence collection does not match the supplied evidence rows'
      )
    const certified = this.#certifyEvaluation({
      plan: input.plan,
      revision: input.revision,
      semanticSourceSha256: input.semanticSourceSha256,
      historySha256: input.historySha256,
      deterministic: input.deterministic,
      candidateObservations: input.candidateObservations,
      additionalEvidence: input.additionalEvidence,
      externalObjectives: input.externalObjectives,
      laneStatuses: input.laneStatuses,
      extraLimitations: input.extraLimitations,
    })
    const status = certified.certificate.hashProjection.status
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'evidence-index.json',
      { schemaVersion: 1, evidenceContent: reconstructedEvidenceContent },
      input.retention
    )
    // * the merged observations & extra limitations are the only certificate
    // * inputs the deterministic result does not already carry; without them a
    // * fresh replay cannot rebuild an externally-evidenced certificate at all
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'certified-input.json',
      {
        schemaVersion: 1,
        candidateObservations: input.candidateObservations,
        additionalEvidence: input.additionalEvidence,
        externalObjectives: input.externalObjectives,
        laneStatuses: input.laneStatuses,
        externalRecords: input.externalRecords,
        externalProvenanceChainSha256,
        extraLimitations: input.extraLimitations,
      },
      input.retention
    )
    if (externalProvenance.length > 0)
      await this.#retainEvaluationArtifact(
        input.sequence,
        input.attemptSha256,
        'external-evidence-provenance.json',
        {
          schemaVersion: 1,
          chainSha256: externalProvenanceChainSha256,
          entries: externalProvenance,
        },
        input.retention
      )
    const eventPayload = Object.freeze({
      state: status,
      certificate: certified.certificate.certificateSha256,
      attemptSha256: input.attemptSha256,
      evaluatedRevision: input.revision,
    })
    const eventProjection = Object.freeze({
      schemaVersion: 1 as const,
      sessionId: this.sessionId,
      sequence: this.#events.length,
      eventKind: 'evaluation-recorded' as const,
      previousEventSha256: this.#events.at(-1)?.eventSha256,
      preHead: Object.freeze({
        state: 'present' as const,
        head: exactRevisionFromHeadV1(this.head),
      }),
      postHead: exactRevisionFromHeadV1(this.head),
      semanticPayloadSha256: editCanonicalSha256V1(eventPayload),
      invocationCorrelation: asInvocationCorrelation(input.invocation),
    })
    const eventSha256 = semanticHashV1('semantic-event', eventProjection)
    const retainedCertificate: EditRetainedCertificateV1 = {
      evaluationId: input.evaluationId,
      sequence: input.sequence,
      planId: input.plan.planId,
      certificate: certified.certificate,
      attemptSha256: input.attemptSha256,
      evidenceContentCollectionSha256: input.evidenceContent.collectionSha256,
    }
    const terminalCertificates = [...this.#certificates, retainedCertificate]
    const semanticReport = semanticReportProjectionV1(
      this.semanticSourceSha256,
      this.#manifest.changeContractSha256,
      this.#manifest.capabilityProfileSha256,
      this.#revisions,
      certificateSetProjectionV1(terminalCertificates).sha256
    )
    const completionAuthority: RetainedEvaluationCompletionAuthorityV1 = {
      schemaVersion: 1,
      kind: 'edit-evaluation-completion-authority-v1',
      attemptNamespaceSha256: input.attemptNamespaceSha256,
      evaluationId: input.evaluationId,
      sequence: input.sequence,
      attemptSha256: input.attemptSha256,
      evaluatedRevision: input.revision,
      evidenceContent: input.evidenceContent,
      certificate: certified.certificate,
      retainedCertificate,
      status,
      completedRecord: Object.freeze({
        schemaVersion: 1,
        status,
        certificateSha256: certified.certificate.certificateSha256,
        requiredChangeResultSha256: certified.aggregate.required.resultSha256,
        allowedChangeResultSha256: certified.aggregate.allowed.resultSha256,
        preservationResultSha256: certified.aggregate.preservation.resultSha256,
        limitations: certified.aggregate.limitations,
        eventSha256,
      }),
      eventProjection,
      eventSha256,
      reportSha256: semanticReport.sha256,
    }
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'completion-authority.json',
      completionAuthority,
      input.retention
    )
    const event = await this.#appendEvent(
      'evaluation-recorded',
      this.head,
      this.head,
      eventPayload,
      input.invocation
    )
    if (event.eventSha256 !== eventSha256)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'evaluation event differs from its retained completion authority'
      )
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'certificate.json',
      { schemaVersion: 1, certificate: certified.certificate },
      input.retention
    )
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      '000002-completed.json',
      {
        ...completionAuthority.completedRecord,
        eventSha256: event.eventSha256,
      },
      input.retention
    )
    // * the certificate set enters every later semantic report projection, so a
    // * fresh replay needs the whole retained record, not only the certificate
    await this.#retainEvaluationArtifact(
      input.sequence,
      input.attemptSha256,
      'retained-certificate.json',
      { schemaVersion: 1, retained: retainedCertificate },
      input.retention
    )
    await this.#settleEvaluationRetention(input.retention)
    const retained = await this.#retainReport(
      this.#buildReport('active', {
        certificates: terminalCertificates,
        state: status,
      }),
      true
    )
    const result: EditEvaluateDomainResultV1 = {
      evaluationId: input.evaluationId,
      phase: status === 'passed' ? 'completed' : status,
      evaluatedRevision: input.revision,
      evaluationAttemptSha256: input.attemptSha256,
      certificate: {
        state: 'present',
        certificateSha256: certified.certificate.certificateSha256,
        status,
      },
      evidenceContent: input.evidenceContent,
      requiredHostAction:
        status === 'unavailable'
          ? {
              kind: 'configureEvidenceProducer',
              limitationCode: 'edit.evaluation_unavailable',
            }
          : { kind: 'none' },
      eventSha256: event.eventSha256,
      reportSha256: retained.report.semanticProjectionSha256,
    }
    await this.#finishAttempt(input.attemptNamespaceSha256, result, 'completed')
    // no public getter or export path sees the certificate until its artifacts,
    // quota, current report, & idempotent result are all durable
    this.#certificates.push(retainedCertificate)
    this.#awaitingEvaluations.delete(input.evaluationId)
    this.#evaluationState = status
    return result
  }

  async #evaluateFinalize(
    request: Extract<EditEvaluateRequestV1, { action: 'finalize' }>,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluateDomainResultV1>
  {
    return this.#withTransition(
      'evaluate',
      invocation,
      async () =>
      {
        const attempt = await this.#beginAttempt(
          'edit_evaluate',
          request.requestId,
          request,
          invocation
        )
        if (attempt.retained !== undefined)
          return attempt.retained as EditEvaluateDomainResultV1
        try
        {
          const awaiting = this.#awaitingEvaluations.get(request.evaluationId)
          if (awaiting === undefined)
          {
            throw new EditSessionErrorV1(
              'edit.evaluation_inconclusive',
              'no awaiting evaluation carries that evaluation ID',
              false,
              { evidenceId: this.#currentReportEvidenceId() }
            )
          }
          if (
            request.expectedEvaluationAttemptSha256 !== awaiting.attemptSha256
          )
          {
            throw new EditSessionErrorV1(
              'edit.evaluation_inconclusive',
              'expected evaluation attempt hash does not match the retained awaiting attempt',
              false,
              { evidenceId: awaiting.evaluationId }
            )
          }
          // the two head facts are genuinely different: evaluatedRevision names
          // what was measured, expectedCurrentHead names what the caller believes
          // the session is on now, & both must hold independently
          if (
            editCanonicalSha256V1(request.evaluatedRevision) !==
            editCanonicalSha256V1(awaiting.revision)
          )
          {
            throw new EditSessionErrorV1(
              'edit.stale_revision',
              'finalize names a different evaluated revision than the awaiting attempt',
              false,
              {
                expectedRevisionId: request.evaluatedRevision.revisionId,
                currentRevisionId: awaiting.revision.revisionId,
              }
            )
          }
          const head = this.head
          if (
            request.expectedCurrentHead.revisionId !== head.revisionId ||
            request.expectedCurrentHead.revisionNumber !==
              head.revisionNumber ||
            request.expectedCurrentHead.candidateSha256 !== head.candidateSha256
          )
          {
            throw new EditSessionErrorV1(
              'edit.stale_revision',
              'finalize names a different current head than the session holds',
              false,
              {
                expectedRevisionId: request.expectedCurrentHead.revisionId,
                currentRevisionId: head.revisionId,
              }
            )
          }
          const plan = this.#plans().plan(awaiting.planId)
          let evidenceContent = this.#evidenceCollection(awaiting.deterministic)
          const expired = this.#clock.nowEpochMs() > awaiting.deadlineEpochMs
          if (expired)
          {
            await this.#cancelAwaitingEvaluationV1(
              awaiting,
              'edit.external_evidence_expired',
              invocation
            )
            throw new EditSessionErrorV1(
              'edit.external_evidence_expired',
              'external evidence deadline expired before finalization',
              false,
              { evidenceId: awaiting.evaluationId }
            )
          }
          const staged =
            (await this.#evaluationPorts?.inbox?.staged(
              request.evaluationId
            )) ?? []
          const issued = new Map(
            awaiting.deterministic.externalRequests.map((entry) => [
              entry.requestArtifactId,
              entry,
            ])
          )
          const merged = new Map<string, EditCandidateObservationV1>()
          const additionalEvidenceByRequest = new Map<
            string,
            EditEvaluationEvidenceEntryV1
          >()
          const externalObjectiveByRequest = new Map<
            string,
            EditStructuralObjectiveObservationV1
          >()
          const externalRecordByRequest = new Map<
            string,
            EditStagedExternalEvidenceRecordV1
          >()
          const recordIds = new Set<string>()
          for (const record of staged)
          {
            const issuedRequest = issued.get(record.requestArtifactId)
            // every binding is revalidated: the record must answer a request this
            // attempt issued, for the objective it was issued for, under its hash
            if (
              issuedRequest === undefined ||
              record.evaluationId !== request.evaluationId ||
              record.objectiveId !== issuedRequest.objectiveId ||
              record.requestSha256 !== issuedRequest.requestSha256 ||
              record.lane !== issuedRequest.lane ||
              recordIds.has(record.recordId) ||
              !/^[0-9a-f]{64}$/u.test(record.contentSha256) ||
              !/^[0-9a-f]{64}$/u.test(record.resultSha256) ||
              !/^[0-9a-f]{64}$/u.test(record.judgmentSha256) ||
              !validExternalProvenanceV1(record) ||
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
            {
              throw new EditSessionErrorV1(
                'edit.fingerprint_mismatch',
                'a staged external evidence record does not match its issued request',
                false,
                {
                  opId: issuedRequest?.objectiveId ?? 'external-evidence',
                }
              )
            }
            recordIds.add(record.recordId)
            if (merged.has(record.requestArtifactId))
              throw new EditSessionErrorV1(
                'edit.fingerprint_mismatch',
                'more than one staged record answers the same issued request',
                false,
                { opId: issuedRequest.objectiveId }
              )
            merged.set(record.requestArtifactId, {
              objectiveId: record.objectiveId,
              ...(issuedRequest.predicateSha256 === undefined
                ? {}
                : { predicateSha256: issuedRequest.predicateSha256 }),
              status: 'observed',
              observed: {
                kind: 'visualJudgment',
                satisfied: record.satisfied,
                judgmentSha256: record.judgmentSha256,
              },
            })
            additionalEvidenceByRequest.set(record.requestArtifactId, {
              binding: {
                evidenceKind: 'nativeAgent',
                lane: record.lane,
                requestSha256: record.requestSha256,
                resultSha256: record.resultSha256,
                contentSha256: record.contentSha256,
              },
              contentSha256: record.contentSha256,
            })
            externalObjectiveByRequest.set(record.requestArtifactId, {
              objectiveId: record.objectiveId,
              predicateSha256:
                editExternalEvidenceRequiredGateSha256V1(issuedRequest),
              status: record.satisfied ? 'satisfied' : 'violated',
            })
            externalRecordByRequest.set(record.requestArtifactId, record)
          }
          const missing = awaiting.deterministic.externalRequests.filter(
            (entry) => !merged.has(entry.requestArtifactId)
          )
          if (missing.length > 0)
          {
            throw new EditSessionErrorV1(
              'edit.pending_external_evidence',
              `${missing.length} external evidence record(s) are not staged yet`,
              false,
              { evidenceId: awaiting.evaluationId }
            )
          }
          const additionalEvidence =
            awaiting.deterministic.externalRequests.map((entry) =>
              additionalEvidenceByRequest.get(entry.requestArtifactId)!
            )
          const externalObjectives =
            awaiting.deterministic.externalRequests.map((entry) =>
              externalObjectiveByRequest.get(entry.requestArtifactId)!
            )
          const externalRecords = awaiting.deterministic.externalRequests.map(
            (entry) => externalRecordByRequest.get(entry.requestArtifactId)!
          )
          evidenceContent = editEvidenceContentCollectionV1([
            ...awaiting.deterministic.evidence.map(
              (entry) => entry.contentSha256
            ),
            ...additionalEvidence.map((entry) => entry.contentSha256),
          ])
          return await this.#completeEvaluation({
            attemptNamespaceSha256: attempt.namespaceSha256,
            sequence: awaiting.sequence,
            attemptSha256: awaiting.attemptSha256,
            evaluationId: request.evaluationId,
            plan,
            revision: awaiting.revision,
            semanticSourceSha256: awaiting.semanticSourceSha256,
            historySha256: awaiting.historySha256,
            deterministic: awaiting.deterministic,
            candidateObservations: [
              ...awaiting.deterministic.candidateObservations,
              ...awaiting.deterministic.externalRequests.map((entry) =>
                merged.get(entry.requestArtifactId)!
              ),
            ],
            additionalEvidence,
            externalObjectives,
            laneStatuses: externallyFinalizedLaneStatusesV1(
              awaiting.deterministic
            ),
            externalRecords,
            evidenceContent,
            extraLimitations: [],
            retention: awaiting.retention,
            invocation,
          })
        }
        catch (error)
        {
          if (this.#state === 'recovery-required') throw error
          return this.#refuseAttempt(attempt.namespaceSha256, error)
        }
      },
      request.evaluationId
    )
  }

  async #retainExportArtifact(
    sequence: number,
    exportSha256: string,
    name: string,
    payload: unknown
  ): Promise<string>
  {
    const bytes = editCanonicalBytesV1(payload)
    await this.#retainSessionImmutable(
      this.#layout.export(sequence, exportSha256, name),
      bytes
    )
    return sha256Hex(bytes)
  }

  // the exact revision-0 bytes the session admitted, re-read from the private
  // store rather than from any host path, so a moved or deleted original cannot
  // change the answer
  async #revisionZeroProofV1(): Promise<string>
  {
    const zero = this.#revisions[0]!
    const bytes = await this.#store.readImmutable(zero.candidateKey)
    const observed = sha256Hex(bytes)
    if (
      observed !== zero.head.candidateSha256 ||
      observed !== this.#manifest.sourceArtifactSha256
    )
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        'private revision-0 bytes no longer match the admitted source identity'
      )
    return observed
  }

  // the branch-specific check: a project session rechecks the selected path
  // identity, a registered template rechecks registry/artifact identity. Both
  // arms run through the intake recheck the registry captured at begin
  async #recheckSourceProvenanceV1(): Promise<boolean>
  {
    if (this.#sourceRecheck === null) return true
    const outcome = await this.#sourceRecheck()
    return (
      outcome.ok &&
      outcome.observedArtifactSha256 === this.#manifest.sourceArtifactSha256
    )
  }

  async #reopenEvidenceV1(
    stage: 'preparedTemp' | 'committedFinal',
    bytes: Uint8Array
  ): Promise<EditExportReopenEvidenceV1>
  {
    const preflight = await inspectSemanticEditArtifact(bytes)
    if (
      !preflight.ok ||
      !preflight.admission ||
      !preflight.semanticSourceIdentity
    )
      throw new EditSessionErrorV1(
        'edit.export_reopen_failed',
        `${stage} did not re-admit through SB3 admission, schema, graph & static checks`
      )
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

  // the nine-step publication transaction. Its one durable commit point is
  // successful final-link creation together w/ a successful directory fsync

  // before it a failed link cannot publish the candidate; after it the
  // operation never reports ordinary failure & never returns to active
  async export(
    request: EditExportRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditExportDomainResultV1>
  {
    return this.#withTransition('export', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_export',
        request.requestId,
        request,
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as EditExportDomainResultV1
      const port = this.#publicationPort
      let prepared: EditPublicationPreparedV1 | null = null
      let committed = false
      let sequence = this.#exportSequence
      let exportSha256: string | null = null
      try
      {
        if (port === null)
          throw new EditSessionErrorV1(
            'edit.publication_unavailable',
            'no publication port is configured'
          )
        // V1 permits one successful export per session, then closes it
        if (this.#exportState === 'exported')
          throw new EditSessionErrorV1(
            'edit.session_closed',
            'this session already published its single V1 export'
          )
        const capability = await port.capability()
        if (!isEditPublicationCapabilityReadyV1(capability))
          throw new EditSessionErrorV1(
            'edit.publication_unavailable',
            'the host could not prove no-replace hard-link publication'
          )
        // ---- step 1: revalidate identity & reservation, lock the head
        const head = this.head
        if (
          request.expectedRevisionId !== head.revisionId ||
          request.expectedRevisionNumber !== head.revisionNumber
        )
          throw new EditSessionErrorV1(
            'edit.stale_revision',
            'expected revision is not the current head',
            false,
            {
              expectedRevisionId: request.expectedRevisionId,
              currentRevisionId: head.revisionId,
            }
          )
        if (request.expectedCandidateSha256 !== head.candidateSha256)
          throw new EditSessionErrorV1(
            'edit.stale_candidate',
            'expected candidate is not the current head',
            false,
            {
              expectedCandidateSha256: request.expectedCandidateSha256,
              currentCandidateSha256: head.candidateSha256,
            }
          )
        if (request.expectedSourceArtifactSha256 !== head.sourceArtifactSha256)
          throw new EditSessionErrorV1(
            'edit.source_identity_mismatch',
            'expected source artifact differs from the session source'
          )
        if (request.expectedAssetManifestSha256 !== head.assetManifestSha256)
          throw new EditSessionErrorV1(
            'edit.source_identity_mismatch',
            'expected asset manifest is not the current head'
          )
        if (request.expectedChangeContractSha256 !== head.changeContractSha256)
          throw new EditSessionErrorV1(
            'edit.stale_contract',
            'expected change contract is stale'
          )
        if (
          request.expectedCapabilityProfileSha256 !==
          head.capabilityProfileSha256
        )
          throw new EditSessionErrorV1(
            'edit.stale_capability_profile',
            'expected capability profile is stale'
          )
        const awaiting = [...this.#awaitingEvaluations.values()].sort(
          (left, right) => left.sequence - right.sequence
        )
        for (const pending of awaiting)
        {
          const current =
            pending.revision.revisionId === head.revisionId &&
            pending.revision.revisionNumber === head.revisionNumber &&
            pending.revision.candidateSha256 === head.candidateSha256
          if (!current)
            await this.#cancelAwaitingEvaluationV1(
              pending,
              'edit.evaluation_superseded',
              invocation
            )
        }
        const currentAwaiting = [...this.#awaitingEvaluations.values()].find(
          (pending) =>
            pending.revision.revisionId === head.revisionId &&
            pending.revision.revisionNumber === head.revisionNumber &&
            pending.revision.candidateSha256 === head.candidateSha256
        )
        if (currentAwaiting !== undefined)
          throw new EditSessionErrorV1(
            'edit.pending_external_evidence',
            'the current head still has unresolved external evaluation evidence',
            false,
            { evidenceId: currentAwaiting.evaluationId }
          )
        const planId = this.#plans().exportRequiredPlanId
        const authorizing = this.#certificates
          .filter(
            (entry) =>
              entry.planId === planId &&
              certificateStandingV1(entry, head) === 'current'
          )
          .reduce<EditRetainedCertificateV1 | null>(
            (left, right) =>
              left === null || right.sequence > left.sequence ? right : left,
            null
          )
        const exportability = this.exportability()
        if (authorizing === null)
        {
          const code =
            exportability.refusalCode ?? 'edit.evaluation_unavailable'
          throw new EditSessionErrorV1(
            code,
            exportability.detail,
            false,
            code === 'edit.evaluation_unavailable'
              ? {
                  evidenceId: this.#currentReportEvidenceId(),
                }
              : {}
          )
        }
        if (
          authorizing.certificate.certificateSha256 !==
          request.certificateSha256
        )
          throw new EditSessionErrorV1(
            'edit.stale_certificate',
            'the named certificate is not the exact-head export authority'
          )
        // only a passed certificate for this exact head authorizes export
        if (!exportability.exportable)
          throw new EditSessionErrorV1(
            exportability.refusalCode ?? 'edit.evaluation_unavailable',
            exportability.detail,
            false,
            {
              evidenceId: authorizing.certificate.certificateSha256,
            }
          )
        const outputRequest =
          request.output.kind === 'basename'
            ? ({ kind: 'basename', basename: request.output.basename } as const)
            : ({
                kind: 'reservation',
                reservationId: request.output.reservationId,
              } as const)
        // * permanent source denial runs on the resolved destination BEFORE any
        // * existence check, so a denied path refuses as denied whether or not
        // * it exists right now

        // derived from the provenance captured at begin, never from a fresh
        // stat, so a moved or deleted original stays denied
        const destination = await port.resolveDestination(outputRequest)
        if (!isPublicationDestinationBoundV1(destination))
          throw new EditSessionErrorV1(
            'edit.output_invalid',
            'resolved publication destination is not bound to its directory identity'
          )
        assertOutputBasenameAllowedV1(
          this.#contract.registration.semanticContract.outputNamePolicy,
          destination.basename
        )
        assertExportDestinationAllowedV1(this.#manifest.provenance, {
          canonicalRealpath: destination.finalCanonicalPath,
          identity: destination.finalIdentity,
        })
        const reservation = await port.revalidateReservation(outputRequest)
        if (
          reservation.basename !== destination.basename ||
          reservation.finalCanonicalPath !== destination.finalCanonicalPath ||
          !samePublicationDirectoryIdentityV1(
            reservation.directory,
            destination.directory
          ) ||
          !isPublicationReservationBoundV1(reservation) ||
          (request.output.kind === 'reservation' &&
            reservation.reservationId !== request.output.reservationId)
        )
          throw new EditSessionErrorV1(
            'edit.output_invalid',
            'output destination changed while its reservation was validated'
          )
        assertOutputBasenameAllowedV1(
          this.#contract.registration.semanticContract.outputNamePolicy,
          reservation.basename
        )
        if (
          request.output.kind === 'reservation' &&
          request.output.expectedReservationSha256 !==
            reservation.reservationSha256
        )
          throw new EditSessionErrorV1(
            'edit.output_invalid',
            'expected output reservation identity is stale'
          )
        if (this.#exportSequence >= this.#policy.evaluationRunLimit)
          throw new EditSessionErrorV1(
            'edit.session_budget_exceeded',
            'export evidence capacity is exhausted',
            false,
            {
              limit: this.#policy.evaluationRunLimit,
              observed: this.#exportSequence + 1,
            }
          )
        const revision = exactRevisionFromHeadV1(head)
        const historySha256 = historyProjectionV1(
          this.semanticSourceSha256,
          this.#revisions
        ).sha256
        sequence = this.#exportSequence
        exportSha256 = semanticHashV1('certificate', {
          kind: 'export-intent',
          schemaVersion: 1,
          exportedRevision: revision,
          semanticSourceSha256: this.semanticSourceSha256,
          historySha256,
          certificateSha256: request.certificateSha256,
          basename: reservation.basename,
          publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
        })
        const exportId = editOpaqueIdV1(
          'export',
          this.#entropy.randomBytes(16),
          { sessionId: this.sessionId, sequence, exportSha256 }
        )
        const recoveryAuthority = `.edit-publication-tmp-${editCanonicalSha256V1(
          {
            kind: 'publication-recovery-authority-v1',
            exportId,
            exportSha256,
            outputReservationId: reservation.reservationId,
          }
        ).slice(0, 32)}`
        // ---- step 2: immutable export intent, bound to head, certificate,
        // source, reservation, invocation correlation & expected final name
        await this.#retainExportArtifact(
          sequence,
          exportSha256,
          '000000-intent.json',
          {
            schemaVersion: 1,
            exportId,
            exportSha256,
            exportedRevision: revision,
            semanticSourceSha256: this.semanticSourceSha256,
            historySha256,
            certificateSha256: request.certificateSha256,
            sourceArtifactSha256: this.#manifest.sourceArtifactSha256,
            sourceProvenanceEvidenceSha256:
              this.#manifest.sourceProvenanceEvidenceSha256,
            outputReservationId: reservation.reservationId,
            outputReservationSha256: reservation.reservationSha256,
            auditRecordSha256: attempt.requestSha256,
            expectedFinalName: reservation.basename,
            publicationRootId: capability.publicationRootId,
            publicationRootOwnershipSha256:
              capability.publicationRootOwnershipSha256,
            publicationDirectory: reservation.directory,
            recoveryAuthority,
            invocationCorrelation: asInvocationCorrelation(invocation),
            deniedDestinationSetSha256: deniedDestinationSetSha256V1(
              this.#manifest.provenance
            ),
          }
        )
        this.#exportSequence = sequence + 1
        const preparedAtEpochMs = this.#clock.nowEpochMs()
        // ---- steps 3 & 4: durable temp name, exact bytes, fsync, readback
        const candidateBytes = await this.#currentCandidateBytes()
        if (sha256Hex(candidateBytes) !== head.candidateSha256)
          throw new EditSessionErrorV1(
            'edit.stale_candidate',
            'retained candidate bytes do not match the current head',
            false,
            {
              expectedCandidateSha256: head.candidateSha256,
              currentCandidateSha256: sha256Hex(candidateBytes),
            }
          )
        if (candidateBytes.byteLength > capability.maximumOutputByteLength)
          throw new EditSessionErrorV1(
            'edit.artifact_quota_exceeded',
            'candidate exceeds the proven publication output byte ceiling'
          )
        prepared = await port.prepare(
          reservation.reservationId,
          candidateBytes,
          recoveryAuthority
        )
        assertPreparedPublicationV1({
          prepared,
          reservation,
          recoveryAuthority,
          candidateSha256: head.candidateSha256,
          candidateByteLength: candidateBytes.byteLength,
        })
        const preparedProofSha256 = editExportPreparedProofSha256V1({
          schemaVersion: 1,
          publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
          basename: reservation.basename,
          candidateSha256: prepared.sha256,
          candidateByteLength: prepared.byteLength,
          nameDurableBeforeWrite: prepared.nameDurableBeforeWrite,
          fileSynced: prepared.fileSynced,
          readbackVerified: prepared.readbackVerified,
        })
        await this.#retainExportArtifact(
          sequence,
          exportSha256,
          '000001-prepared.json',
          {
            schemaVersion: 1,
            exportId,
            preparedProofSha256,
            publicationRootId: capability.publicationRootId,
            publicationRootOwnershipSha256:
              capability.publicationRootOwnershipSha256,
            tempBasename: prepared.tempBasename,
            candidateSha256: prepared.sha256,
            candidateByteLength: prepared.byteLength,
            directoryCanonicalRealpath: prepared.directory.canonicalRealpath,
            tempDevice: prepared.device,
            tempInode: prepared.inode,
            tempMode: prepared.mode,
            directoryDevice: prepared.directory.device,
            directoryInode: prepared.directory.inode,
            preparedAtEpochMs,
          }
        )
        // ---- step 5: reopen the temp inode through the full admission path
        const preparedReopen = await this.#reopenEvidenceV1(
          'preparedTemp',
          await port.readPrepared(prepared.preparationId)
        )
        if (preparedReopen.artifactSha256 !== head.candidateSha256)
          throw new EditSessionErrorV1(
            'edit.export_reopen_failed',
            'the reopened temp inode is not the exact candidate'
          )
        // ---- step 6: branch identity, revision-0 bytes, head/certificate &
        // directory identity, immediately before publication
        const preLinkRecheckOk = await this.#recheckSourceProvenanceV1()
        if (!preLinkRecheckOk)
          throw new EditSessionErrorV1(
            'edit.source_identity_mismatch',
            'the selected source or template identity changed before publication'
          )
        const revisionZeroCandidateSha256 = await this.#revisionZeroProofV1()
        if (!sameHeadV1(this.head, head))
          throw new EditSessionErrorV1(
            'edit.stale_revision',
            'the head moved between preparation & publication',
            false,
            {
              expectedRevisionId: head.revisionId,
              currentRevisionId: this.head.revisionId,
            }
          )
        if (!this.exportability().exportable)
          throw new EditSessionErrorV1(
            'edit.stale_certificate',
            'export authority lapsed between preparation & publication'
          )
        const preLinkDirectory = await port.recheckDirectory(
          reservation.reservationId
        )
        if (
          !samePublicationDirectoryIdentityV1(
            preLinkDirectory,
            prepared.directory
          )
        )
          throw new EditSessionErrorV1(
            'edit.publication_interference',
            'the output directory identity changed before publication'
          )
        const gateSha256 = editExportGateSha256V1({
          schemaVersion: 1,
          exportRequiredPlanId: planId,
          certificateSha256: request.certificateSha256,
          certificateStatus: authorizing.certificate.hashProjection.status,
          exportable: true,
          cumulativePreservationSha256: editCanonicalSha256V1(
            this.#revisions.at(-1)!.preservation
          ),
          diagnosticsSha256: editCanonicalSha256V1(
            this.#revisions.at(-1)!.diagnostics
          ),
        })
        const pending: EditPendingPublicationV1 = {
          exportId,
          sequence,
          exportSha256,
          attemptNamespaceSha256: attempt.namespaceSha256,
          attemptRequestSha256: attempt.requestSha256,
          certificateSha256: request.certificateSha256,
          head,
          revision,
          historySha256,
          reservation,
          capability,
          prepared,
          preparedProofSha256,
          preparedReopen,
          gateSha256,
          preLinkRecheckOk,
          revisionZeroCandidateSha256,
          preparedAtEpochMs,
          invocation,
          committedAtEpochMs: null,
          publishedEvent: null,
        }
        // retained before the syscall so a crash in the link window still has an
        // exact roll-forward authority rather than a reconstructed guess
        this.#pendingPublication = pending
        // ---- step 7: same-directory no-replace link, then directory fsync.
        // Both together are the durable commit point
        const commit = await port.commit(prepared.preparationId)
        committed = commit.linkCreated
        assertPublicationCommitV1(prepared, commit)
        await this.#retainExportArtifact(
          sequence,
          exportSha256,
          '000002-link-observed.json',
          {
            schemaVersion: 1,
            exportId,
            linkCreated: commit.linkCreated,
            directorySynced: commit.directorySynced,
            finalDevice: commit.device,
            finalInode: commit.inode,
            byteLength: commit.byteLength,
          }
        )
        return await this.#completePublicationV1(pending, commit)
      }
      catch (error)
      {
        const publicationCommitted =
          committed || (isEditPublicationErrorV1(error) && error.committed)
        if (!publicationCommitted)
        {
          // ---- regime 1: the link did not publish this candidate. The final
          // name may still contain a pre-existing file, so observe both names
          // before & after cleanup instead of claiming absence from the error
          let finalObservation: EditPublicationNameInspectionV1 | null = null
          let finalObservationFailureSha256: string | null = null
          let cleanupObservation: EditPublicationNameInspectionV1 | null = null
          let cleanupObservationFailureSha256: string | null = null
          let cleanupCompleted = false
          let cleanupFailureSha256: string | null = null
          if (prepared !== null && port !== null)
          {
            try
            {
              finalObservation = await port.inspectPublicationNames(
                prepared.preparationId
              )
              assertPublicationInspectionV1(prepared, finalObservation)
            }
            catch (observationError)
            {
              finalObservationFailureSha256 = editCanonicalSha256V1({
                code: errorCode(observationError),
                message:
                  observationError instanceof Error
                    ? observationError.message
                    : String(observationError),
              })
            }
            try
            {
              await port.releasePrepared(prepared.preparationId)
              cleanupCompleted = true
            }
            catch (cleanupError)
            {
              cleanupFailureSha256 = editCanonicalSha256V1({
                code: errorCode(cleanupError),
                message:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
              })
            }
            try
            {
              cleanupObservation = await port.inspectPublicationNames(
                prepared.preparationId
              )
              assertPublicationInspectionV1(prepared, cleanupObservation)
            }
            catch (observationError)
            {
              cleanupObservationFailureSha256 = editCanonicalSha256V1({
                code: errorCode(observationError),
                message:
                  observationError instanceof Error
                    ? observationError.message
                    : String(observationError),
              })
            }
          }
          const recoveryRequired =
            prepared !== null &&
            (!cleanupCompleted ||
              finalObservation === null ||
              cleanupObservation === null ||
              finalObservation.finalMatchesProof ||
              cleanupObservation.finalMatchesProof ||
              (finalObservation.finalPresent &&
                errorCode(error) !== 'edit.output_exists') ||
              (cleanupObservation.finalPresent &&
                errorCode(error) !== 'edit.output_exists') ||
              cleanupObservation.tempPresent)
          if (exportSha256 !== null)
          {
            try
            {
              await this.#retainExportArtifact(
                sequence,
                exportSha256,
                '000002-failed-before-publish.json',
                {
                  schemaVersion: 1,
                  code: errorCode(error),
                  auditRecordSha256: attempt.requestSha256,
                  publicationCommitted: false,
                  preparationExisted: prepared !== null,
                  cleanupRequired: prepared !== null,
                  finalObservation,
                  finalObservationFailureSha256,
                  cleanupCompleted,
                  cleanupDirectorySynced: cleanupCompleted,
                  cleanupObservation,
                  cleanupObservationFailureSha256,
                  cleanupFailureSha256,
                  recoveryRequired,
                }
              )
            }
            catch
            {
              this.#pendingPublication = null
              this.#state = 'recovery-required'
              await this.#retainReport(
                this.#buildReport('recovery-required'),
                true
              ).catch(() => undefined)
              throw new EditSessionErrorV1(
                'edit.recovery_required',
                'pre-publication failure evidence could not be retained safely',
                true
              )
            }
          }
          // no publication may be rolled forward, so its authority is dropped;
          // an unproved observation or cleanup instead leaves explicit host
          // recovery evidence & never resumes an ordinary active session
          this.#pendingPublication = null
          if (recoveryRequired)
          {
            this.#state = 'recovery-required'
            await this.#retainReport(
              this.#buildReport('recovery-required'),
              true
            ).catch(() => undefined)
            throw new EditSessionErrorV1(
              'edit.recovery_required',
              'pre-publication cleanup or final-name observation could not be proven',
              true
            )
          }
          const refusal =
            error instanceof EditSessionErrorV1
              ? error
              : error instanceof EditPublicationDenialError
                ? new EditSessionErrorV1(error.code, error.message)
                : new EditSessionErrorV1(
                    errorCode(error),
                    'publication was refused before the durable commit point'
                  )
          try
          {
            return await this.#refuseAttempt(attempt.namespaceSha256, refusal)
          }
          catch (refusalError)
          {
            if (refusalError === refusal) throw refusalError
            this.#state = 'recovery-required'
            await this.#retainReport(
              this.#buildReport('recovery-required'),
              true
            ).catch(() => undefined)
            throw new EditSessionErrorV1(
              'edit.recovery_required',
              'pre-publication refusal evidence could not be retained safely',
              true
            )
          }
        }
        // ---- regimes 2 & 3: the link syscall may have succeeded. The operation
        // never reports ordinary failure & never returns to active
        if (
          this.#state === 'closed-abandoned' &&
          error instanceof EditSessionErrorV1 &&
          error.committed
        )
          throw error
        await this.#enterPublicationRecoveryV1(errorCode(error))
        throw new EditSessionErrorV1(
          errorCode(error) === 'edit.publication_interference'
            ? 'edit.publication_interference'
            : 'edit.recovery_required',
          'publication completion requires retained recovery reconciliation',
          true
        )
      }
    })
  }

  // the single entry into the post-link window. It records only that the link
  // MAY exist; a durable commit is never inferred from an earlier syscall having
  // returned, it is re-proven from the names themselves during recovery
  async #enterPublicationRecoveryV1(code: string): Promise<void>
  {
    this.#state = 'recovery-required'
    const pending = this.#pendingPublication
    if (pending !== null)
    {
      const ordinal = String(this.#publicationRecoverySequence).padStart(6, '0')
      this.#publicationRecoverySequence += 1
      await this.#retainExportArtifact(
        pending.sequence,
        pending.exportSha256,
        `recovery-${ordinal}.json`,
        {
          schemaVersion: 1,
          exportId: pending.exportId,
          code,
          linkMayExist: true,
          recoveryAuthority: pending.prepared.tempBasename,
        }
      ).catch(() => undefined)
    }
    // a fresh replay reads the retained report, so the interrupted window has to
    // be nameable there & not only in this process's memory
    await this.#retainReport(
      this.#buildReport('recovery-required'),
      true
    ).catch(() => undefined)
  }

  // a durable publication whose semantic authority cannot be completed is a
  // terminal external-interference outcome, never a retryable recovery loop
  async #terminalizePublicationInterferenceV1(
    pending: EditPendingPublicationV1,
    disposition: 'committedCandidateUnattested' | 'unexpectedFinalIdentity',
    interferenceEvidenceSha256: string,
    detail: string
  ): Promise<never>
  {
    await this.#finishAttempt(
      pending.attemptNamespaceSha256,
      {
        ok: false,
        code: 'edit.publication_interference',
        safeMessage: detail,
        context: {},
        disposition,
      },
      'refused',
      'edit.publication_interference'
    )
    this.#budget = {
      ...this.#budget,
      rejectedAttempts: this.#budget.rejectedAttempts + 1,
    }
    const event =
      pending.publishedEvent ??
      (await this.#appendEvent(
        'session-closed',
        pending.head,
        pending.head,
        {
          reason: 'post-publication-interference',
          terminalState: 'closed-abandoned',
          exportId: pending.exportId,
          disposition,
          interferenceEvidenceSha256,
          receiptIssued: false,
        },
        pending.invocation
      ))
    pending.publishedEvent = event
    this.#state = 'closed-abandoned'
    const retained = await this.#retainReport(
      this.#buildReport('closed-abandoned'),
      true
    )
    await this.#retainExportArtifact(
      pending.sequence,
      pending.exportSha256,
      '000003-external-interference.json',
      {
        schemaVersion: 1,
        exportId: pending.exportId,
        code: 'edit.publication_interference',
        disposition,
        interferenceEvidenceSha256,
        receiptIssued: false,
        recoveryAuthorityDisposition: 'cleared',
        auditRecordSha256: pending.attemptRequestSha256,
        eventSha256: event.eventSha256,
        reportSha256: retained.report.semanticProjectionSha256,
      }
    )
    this.#pendingPublication = null
    throw new EditSessionErrorV1('edit.publication_interference', detail, true)
  }

  // publication steps 8 & 9, shared by the first attempt & by roll-forward
  // recovery. It is re-entrant: the terminal event & the committed timestamp are
  // taken once so a second pass rewrites byte-identical evidence
  async #completePublicationV1(
    pending: EditPendingPublicationV1,
    commit: EditPublicationCommitV1
  ): Promise<EditExportDomainResultV1>
  {
    const port = this.#publicationPort
    if (port === null)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'publication completion requires the configured publication port',
        true
      )
    const {
      capability,
      certificateSha256,
      exportId,
      exportSha256,
      gateSha256,
      head,
      historySha256,
      preLinkRecheckOk,
      preparedProofSha256,
      preparedReopen,
      reservation,
      revision,
      revisionZeroCandidateSha256,
      sequence,
    } = pending
    const prepared = pending.prepared
    // ---- step 8: post-commit verification, then temp release
    const committedCandidateUnattestedSha256 = editCanonicalSha256V1({
      kind: 'committed-candidate-unattested',
      link: {
        linkCreated: commit.linkCreated,
        directorySynced: commit.directorySynced,
        finalDevice: commit.device,
        finalInode: commit.inode,
        byteLength: commit.byteLength,
      },
    })
    let verification: EditPublicationVerificationV1
    try
    {
      verification = await port.verifyCommitted(prepared.preparationId)
    }
    catch
    {
      return this.#terminalizePublicationInterferenceV1(
        pending,
        'committedCandidateUnattested',
        committedCandidateUnattestedSha256,
        'the committed output could not be attested as the exact prepared candidate'
      )
    }
    if (!isPublicationVerificationBoundV1(prepared, commit, verification))
      return this.#terminalizePublicationInterferenceV1(
        pending,
        'committedCandidateUnattested',
        committedCandidateUnattestedSha256,
        'the committed output is not the exact prepared candidate'
      )
    let committedReopen: EditExportReopenEvidenceV1
    try
    {
      committedReopen = await this.#reopenEvidenceV1(
        'committedFinal',
        verification.bytes
      )
      if (committedReopen.artifactSha256 !== head.candidateSha256)
        throw new EditSessionErrorV1(
          'edit.export_reopen_failed',
          'the committed output did not re-admit as the exact candidate',
          true
        )
    }
    catch
    {
      return this.#terminalizePublicationInterferenceV1(
        pending,
        'committedCandidateUnattested',
        committedCandidateUnattestedSha256,
        'the committed output could not re-admit as the exact candidate'
      )
    }
    let postLinkRecheckOk = false
    let postRevisionZeroSha256: string | null = null
    try
    {
      postLinkRecheckOk = await this.#recheckSourceProvenanceV1()
      postRevisionZeroSha256 = await this.#revisionZeroProofV1()
    }
    catch
    {
      // the final link is already durable, so an unavailable source
      // re-attestation terminalizes just like an observed mismatch
    }
    if (
      !postLinkRecheckOk ||
      postRevisionZeroSha256 !== revisionZeroCandidateSha256
    )
    {
      // the committed output stays untouched; the session terminalizes as
      // post-publication external interference & issues no passing receipt
      return this.#terminalizePublicationInterferenceV1(
        pending,
        'committedCandidateUnattested',
        committedCandidateUnattestedSha256,
        'the source identity changed after publication; the output is committed but unattested'
      )
    }
    await port.releasePrepared(prepared.preparationId)
    const reopenSha256 = editExportReopenSha256V1([
      preparedReopen,
      committedReopen,
    ])
    const sourcePreservationSha256 = editExportSourcePreservationSha256V1({
      schemaVersion: 1,
      provenanceKind: this.#manifest.provenance.kind,
      sourceArtifactSha256: this.#manifest.sourceArtifactSha256,
      revisionZeroCandidateSha256,
      preLinkRecheckOk,
      postLinkRecheckOk,
      deniedDestinationSetSha256: deniedDestinationSetSha256V1(
        this.#manifest.provenance
      ),
    })
    const publicationProofSha256 = editPublicationProofSha256V1({
      schemaVersion: 1,
      publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
      basename: reservation.basename,
      publishedSha256: verification.sha256,
      publishedByteLength: verification.byteLength,
      preparedProofSha256,
      reopenSha256,
      noReplaceLinkProven: capability.noReplaceLink,
      durableCommitPointReached: commit.linkCreated && commit.directorySynced,
      postCommitIdentityMatched: verification.matchesPreparedIdentity,
    })
    // ---- step 9: published & completed records, receipt, provenance,
    // domain-committed report/event, terminal closed-exported
    await this.#retainExportArtifact(
      sequence,
      exportSha256,
      '000003-published.json',
      {
        schemaVersion: 1,
        exportId,
        publicationProofSha256,
        reopenSha256,
        sourcePreservationSha256,
        gateSha256,
      }
    )
    const receipt: EditSemanticExportReceiptV1 = Object.freeze({
      schemaVersion: 1,
      publicationProtocolVersion: EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
      exportedRevision: revision,
      semanticSourceSha256: this.semanticSourceSha256,
      historySha256,
      changeContractSha256: head.changeContractSha256,
      capabilityProfileSha256: head.capabilityProfileSha256,
      certificateSha256,
      publishedByteLength: verification.byteLength,
      publishedSha256: verification.sha256,
      basename: reservation.basename,
      preparedProofSha256,
      reopenSha256,
      gateSha256,
      sourcePreservationSha256,
      terminalStatus: 'closed-exported',
    })
    const receiptSha256 = editSemanticExportReceiptSha256V1(receipt)
    await this.#retainExportArtifact(
      sequence,
      exportSha256,
      'semantic-receipt.json',
      { schemaVersion: 1, receipt, receiptSha256 }
    )
    const event =
      pending.publishedEvent ??
      (await this.#appendEvent(
        'session-closed',
        head,
        head,
        {
          reason: 'export-published',
          terminalState: 'closed-exported',
          receiptSha256,
          publicationProofSha256,
        },
        pending.invocation
      ))
    pending.publishedEvent = event
    const publicationEvidenceId = editOpaqueIdV1(
      'pubevid',
      new TextEncoder().encode(receiptSha256).subarray(0, 16),
      { exportId, receiptSha256 }
    )
    this.#exportState = 'exported'
    const retained = await this.#retainReport(
      this.#buildReport('closed-exported'),
      true
    )
    pending.committedAtEpochMs ??= this.#clock.nowEpochMs()
    const provenance: EditExportProvenanceV1 = Object.freeze({
      schemaVersion: 1,
      exportId,
      reservationId: reservation.reservationId,
      reservationSha256: reservation.reservationSha256,
      publicationRootId: capability.publicationRootId,
      publicationRootOwnershipSha256: capability.publicationRootOwnershipSha256,
      directoryCanonicalRealpath: prepared.directory.canonicalRealpath,
      directoryDevice: prepared.directory.device,
      directoryInode: prepared.directory.inode,
      directoryMode: prepared.directory.mode,
      tempCanonicalPath: prepared.tempCanonicalPath,
      tempDevice: prepared.device,
      tempInode: prepared.inode,
      tempMode: prepared.mode,
      finalCanonicalPath: verification.finalCanonicalPath,
      finalDevice: verification.device,
      finalInode: verification.inode,
      nameDurableBeforeWrite: prepared.nameDurableBeforeWrite,
      fileSynced: prepared.fileSynced,
      readbackVerified: prepared.readbackVerified,
      linkCreated: commit.linkCreated,
      directorySynced: commit.directorySynced,
      postCommitIdentityMatched: verification.matchesPreparedIdentity,
      tempReleased: true,
      deniedDestinationSetSha256: deniedDestinationSetSha256V1(
        this.#manifest.provenance
      ),
      originalSourceCheckSha256: sourcePreservationSha256,
      preparedAtEpochMs: pending.preparedAtEpochMs,
      committedAtEpochMs: pending.committedAtEpochMs,
      recoveryAuthority: prepared.tempBasename,
      auditRecordSha256: pending.attemptRequestSha256,
      reportSha256: retained.report.semanticProjectionSha256,
      eventSha256: event.eventSha256,
    })
    await this.#retainExportArtifact(
      sequence,
      exportSha256,
      'provenance.json',
      {
        schemaVersion: 1,
        provenance,
        provenanceSha256: editExportProvenanceSha256V1(provenance),
      }
    )
    const result: EditExportDomainResultV1 = {
      terminalState: 'closed-exported',
      exportedRevision: revision,
      certificateSha256,
      outputReservationId: reservation.reservationId,
      outputReservationSha256: reservation.reservationSha256,
      publicationEvidenceId,
      publicationProofSha256,
      publishedByteLength: verification.byteLength,
      publishedSha256: verification.sha256,
      reopenSha256,
      sourcePreservationSha256,
      eventSha256: event.eventSha256,
      reportSha256: retained.report.semanticProjectionSha256,
      receiptSha256,
    }
    await this.#retainExportArtifact(
      sequence,
      exportSha256,
      '000004-completed.json',
      { schemaVersion: 1, exportId, result }
    )
    await this.#finishAttempt(
      pending.attemptNamespaceSha256,
      result,
      'completed'
    )
    // a successful export is terminal & singular; it does not implicitly
    // rewrite the candidate head
    this.#pendingPublication = null
    this.#state = 'closed-exported'
    return result
  }

  // ---- regime 2 & 3 roll-forward. Recovery reads the exact proven names &
  // decides from what is there now, never from what a syscall once returned

  // final present & matching -> sync forward; final absent -> repeat the
  // no-replace link; an unexpected final entry is external interference
  async recoverExport(
    invocation: HostInvocationContextV1
  ): Promise<EditExportDomainResultV1>
  {
    if (this.#state !== 'recovery-required')
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'session has no recovery-required transition'
      )
    const pending = this.#pendingPublication
    const port = this.#publicationPort
    if (pending === null || port === null)
      throw new EditSessionErrorV1(
        'edit.internal_invariant',
        'session has no pending publication to roll forward'
      )
    if (this.#busyKind !== null)
      throw new EditSessionErrorV1(
        'edit.session_busy',
        `session is busy with ${this.#busyKind}`
      )
    if (
      invocation.principalSha256 !== pending.invocation.principalSha256 ||
      invocation.boundaryKind !== pending.invocation.boundaryKind
    )
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        'only the originating recovery authority may roll this publication forward'
      )
    this.#busyKind = 'export-recovery'
    try
    {
      const inspection = await port.inspectPublicationNames(
        pending.prepared.preparationId
      )
      assertPublicationInspectionV1(pending.prepared, inspection)
      const ordinal = String(this.#publicationRecoverySequence).padStart(6, '0')
      this.#publicationRecoverySequence += 1
      await this.#retainExportArtifact(
        pending.sequence,
        pending.exportSha256,
        `recovery-${ordinal}.json`,
        { schemaVersion: 1, exportId: pending.exportId, inspection }
      )
      let commit: EditPublicationCommitV1
      let temporaryRecreated = false
      if (inspection.finalPresent && inspection.finalMatchesProof)
      {
        // the link landed; recovery owes only the directory sync that makes it
        // durable, & only then is the commit point reached
        commit = await port.syncPublicationDirectory(
          pending.prepared.preparationId
        )
        assertPublicationCommitV1(pending.prepared, commit)
      }
      else if (inspection.finalPresent)
      {
        // ! outside the trusted-directory threat model: the unknown path is
        // ! never deleted & the session terminalizes for host action
        return this.#terminalizePublicationInterferenceV1(
          pending,
          'unexpectedFinalIdentity',
          editCanonicalSha256V1({
            kind: 'unexpected-final-identity',
            inspection,
          }),
          'an unexpected entry holds the final name; external publication interference requires host action'
        )
      }
      else
      {
        const relink = await port.relinkPrepared(
          pending.prepared.preparationId,
          await this.#currentCandidateBytes()
        )
        if (typeof relink.temporaryRecreated !== 'boolean')
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            'publication relink response lacks an exact recreation disposition',
            true
          )
        assertPreparedPublicationV1({
          prepared: relink.prepared,
          reservation: pending.reservation,
          recoveryAuthority: pending.prepared.tempBasename,
          candidateSha256: pending.head.candidateSha256,
          candidateByteLength: pending.prepared.byteLength,
        })
        pending.prepared = relink.prepared
        commit = relink.commit
        temporaryRecreated = relink.temporaryRecreated
        assertPublicationCommitV1(pending.prepared, commit)
      }
      await this.#retainExportArtifact(
        pending.sequence,
        pending.exportSha256,
        `recovery-${ordinal}-prepared.json`,
        {
          schemaVersion: 1,
          exportId: pending.exportId,
          recoverySequence: ordinal,
          temporaryRecreated,
          preparedProofSha256: pending.preparedProofSha256,
          tempDevice: pending.prepared.device,
          tempInode: pending.prepared.inode,
          tempMode: pending.prepared.mode,
          directoryDevice: pending.prepared.directory.device,
          directoryInode: pending.prepared.directory.inode,
        }
      )
      await this.#retainExportArtifact(
        pending.sequence,
        pending.exportSha256,
        '000002-link-observed.json',
        {
          schemaVersion: 1,
          exportId: pending.exportId,
          linkCreated: commit.linkCreated,
          directorySynced: commit.directorySynced,
          finalDevice: commit.device,
          finalInode: commit.inode,
          byteLength: commit.byteLength,
        }
      )
      return await this.#completePublicationV1(pending, commit)
    }
    catch (error)
    {
      if (
        this.#pendingPublication === null &&
        error instanceof EditSessionErrorV1 &&
        error.code === 'edit.publication_interference' &&
        error.committed
      )
        throw error
      await this.#enterPublicationRecoveryV1(errorCode(error))
      throw new EditSessionErrorV1(
        errorCode(error) === 'edit.publication_interference'
          ? 'edit.publication_interference'
          : 'edit.recovery_required',
        'publication recovery requires retained reconciliation',
        true
      )
    }
    finally
    {
      this.#busyKind = null
    }
  }

  async recordEvaluationUnavailable(
    requestId: string,
    invocation: HostInvocationContextV1
  ): Promise<{
    state: 'unavailable'
    eventSha256: string
    reportSha256: string
  }>
  {
    return this.#withTransition('evaluate', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_evaluate',
        requestId,
        { requestId, head: this.head, disposition: 'unavailable' },
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as {
          state: 'unavailable'
          eventSha256: string
          reportSha256: string
        }
      let event: EditKernelSemanticEventV1 | null = null
      try
      {
        event = await this.#appendEvent(
          'evaluation-recorded',
          this.head,
          this.head,
          { state: 'unavailable', certificate: null },
          invocation
        )
        this.#evaluationState = 'unavailable'
        const retained = await this.#retainReport(
          this.#buildReport('active'),
          true
        )
        const result = {
          state: 'unavailable' as const,
          eventSha256: event.eventSha256,
          reportSha256: retained.report.semanticProjectionSha256,
        }
        await this.#finishAttempt(attempt.namespaceSha256, result, 'completed')
        return result
      }
      catch (error)
      {
        if (event === null)
          return this.#refuseAttempt(attempt.namespaceSha256, error)
        try
        {
          this.#evaluationState = 'unavailable'
          const retained = await this.#retainReport(
            this.#buildReport('active'),
            true
          )
          const result = {
            state: 'unavailable' as const,
            eventSha256: event.eventSha256,
            reportSha256: retained.report.semanticProjectionSha256,
          }
          await this.#finishAttempt(
            attempt.namespaceSha256,
            result,
            'completed'
          )
          return result
        }
        catch (recoveryError)
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `evaluation event committed but completion requires reconciliation: ${
              recoveryError instanceof Error
                ? recoveryError.message
                : String(recoveryError)
            }`,
            true
          )
        }
      }
    })
  }

  async close(
    request: EditCloseRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<{
    terminalState: 'closed-unexported'
    head: HeadProjectionV1
    eventSha256: string
    reportSha256: string
    retentionProofSha256: string
  }>
  {
    if (this.#state === 'closed-unexported')
    {
      const namespace = this.#namespaceSha256(
        'edit_close',
        request.requestId,
        invocation.principalSha256
      )
      const existing = this.#idempotency.get(namespace)
      if (
        existing?.requestSha256 === editCanonicalSha256V1(request) &&
        existing.attempt.state === 'completed' &&
        existing.result
      )
        return structuredClone(existing.result) as {
          terminalState: 'closed-unexported'
          head: HeadProjectionV1
          eventSha256: string
          reportSha256: string
          retentionProofSha256: string
        }
    }
    if (this.#state !== 'active')
    {
      if (this.#busyKind !== null)
        throw new EditSessionErrorV1(
          'edit.session_busy',
          `session is busy with ${this.#busyKind}`
        )
      this.#busyKind = 'close'
      try
      {
        const attempt = await this.#beginAttempt(
          'edit_close',
          request.requestId,
          request,
          invocation
        )
        if (attempt.retained !== undefined)
          return attempt.retained as {
            terminalState: 'closed-unexported'
            head: HeadProjectionV1
            eventSha256: string
            reportSha256: string
            retentionProofSha256: string
          }
        const refusal =
          this.#state === 'recovery-required'
            ? new EditSessionErrorV1(
                'edit.recovery_required',
                'session requires durable evidence reconciliation'
              )
            : this.#state === 'interrupted'
              ? new EditSessionErrorV1(
                  'edit.interrupted',
                  'session is interrupted'
                )
              : new EditSessionErrorV1(
                  'edit.session_closed',
                  'session is terminal'
                )
        return this.#refuseAttempt(attempt.namespaceSha256, refusal)
      }
      finally
      {
        this.#busyKind = null
      }
    }
    return this.#withTransition('close', invocation, async () =>
    {
      const attempt = await this.#beginAttempt(
        'edit_close',
        request.requestId,
        request,
        invocation
      )
      if (attempt.retained !== undefined)
        return attempt.retained as {
          terminalState: 'closed-unexported'
          head: HeadProjectionV1
          eventSha256: string
          reportSha256: string
          retentionProofSha256: string
        }
      let event: EditKernelSemanticEventV1 | null = null
      const completeClose = async (): Promise<{
        terminalState: 'closed-unexported'
        head: HeadProjectionV1
        eventSha256: string
        reportSha256: string
        retentionProofSha256: string
      }> =>
      {
        if (event === null)
          throw new EditSessionErrorV1(
            'edit.internal_invariant',
            'close completion has no retained close event'
          )
        const removed = new Set<string>()
        for (const preview of this.#previews.values())
        {
          if (preview.state !== 'unapplied') continue
          if (!removed.has(preview.candidateCacheKey))
          {
            await this.#removeEvictableSessionArtifact(
              preview.candidateCacheKey,
              preview.predictedCandidateSha256
            )
            removed.add(preview.candidateCacheKey)
          }
          preview.state = 'invalidated'
        }
        this.#budget = { ...this.#budget, retainedPreviews: 0 }
        const retained = await this.#retainReport(
          this.#buildReport('closed-unexported'),
          true
        )
        const reportSha256 = retained.report.semanticProjectionSha256
        const result = {
          terminalState: 'closed-unexported' as const,
          head: this.head,
          eventSha256: event.eventSha256,
          reportSha256,
          retentionProofSha256: editCanonicalSha256V1({
            kind: 'edit-close-retention-proof',
            sessionId: this.sessionId,
            finalHead: this.head,
            eventSha256: event.eventSha256,
            reportSha256,
            retainedPreviewCount: this.#budget.retainedPreviews,
            awaitingEvaluationCount: this.#awaitingEvaluations.size,
          }),
        }
        await this.#finishAttempt(attempt.namespaceSha256, result, 'completed')
        this.#state = 'closed-unexported'
        return result
      }
      try
      {
        this.#assertExpectedHead(
          {
            ...attempt.attempt.preHead!,
            sourceArtifactSha256: request.expectedSourceArtifactSha256,
            revisionNumber: request.expectedRevisionNumber,
            revisionId: request.expectedRevisionId,
            candidateSha256: request.expectedCandidateSha256,
            assetManifestSha256: request.expectedAssetManifestSha256,
            changeContractSha256: request.expectedChangeContractSha256,
            capabilityProfileSha256: request.expectedCapabilityProfileSha256,
          },
          attempt.attempt.preHead
        )
        for (const awaiting of [...this.#awaitingEvaluations.values()].sort(
          (left, right) => left.sequence - right.sequence
        ))
          await this.#cancelAwaitingEvaluationV1(
            awaiting,
            'edit.session_closed',
            invocation
          )
        event = await this.#appendEvent(
          'session-closed',
          this.head,
          this.head,
          { reason: request.reason, terminalState: 'closed-unexported' },
          invocation
        )
        return await completeClose()
      }
      catch (error)
      {
        if (event === null)
          return this.#refuseAttempt(attempt.namespaceSha256, error)
        try
        {
          return await completeClose()
        }
        catch (recoveryError)
        {
          this.#state = 'recovery-required'
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            `close event committed but completion requires reconciliation: ${
              recoveryError instanceof Error
                ? recoveryError.message
                : String(recoveryError)
            }`,
            true
          )
        }
      }
    })
  }
}

export class EditSessionRegistryV1
{
  readonly #store: EditArtifactStorePort
  readonly #resourceCatalogue: EditRetainedResourceCataloguePortV1 | undefined
  readonly #contracts: EditChangeContractRegistryV1
  readonly #identity: EditSessionRegistryIdentityV1
  readonly #clock: EditClockPort
  readonly #entropy: EditEntropyPort
  readonly #handleSecret: Uint8Array
  readonly #policy: EditKernelPolicyV1
  readonly #transactionExecutor: EditTransactionExecutorV1
  readonly #evaluationPorts: EditEvaluationPortsV1 | undefined
  readonly #publicationPort: EditPublicationPort | undefined
  readonly #sessions = new Map<string, EditSessionV1>()
  readonly #beginIdempotency = new Map<
    string,
    { requestSha256: string; result: EditBeginDomainResultV1 }
  >()
  readonly #beginRefusals = new Map<
    string,
    {
      requestSha256: string
      code: EditSessionErrorCodeV1
      message: string
      context: RefusalContextV1
    }
  >()
  readonly #beginAttempts = new Map<
    string,
    {
      readonly prefix: string
      readonly authority: RetainedEditBeginAttemptAuthorityV1
    }
  >()
  readonly #beginOutcomes = new Map<
    string,
    RetainedEditBeginOutcomeAuthorityV1
  >()
  #sessionSequence = 0
  #registryAttemptSequence = 0
  #beginBusy = false

  constructor(
    options: EditSessionRegistryOptionsV1,
    transactionExecutor: EditTransactionExecutorV1 = new UnavailableEditTransactionExecutorV1()
  )
  {
    assertExternalEvidenceDeadlineV1(options.evaluationPorts)
    this.#store = options.artifactStore
    this.#resourceCatalogue = options.resourceCatalogue
    this.#contracts = options.changeContracts
    this.#identity = options.identity
    this.#clock = options.clock
    this.#entropy = options.entropy
    this.#handleSecret = new Uint8Array(options.handleSecret)
    if (this.#handleSecret.byteLength < 32)
      throw new TypeError('edit handle secret must contain at least 256 bits')
    this.#policy = mergePolicy(options.policy)
    this.#transactionExecutor = transactionExecutor
    this.#evaluationPorts = options.evaluationPorts
    this.#publicationPort = options.publicationPort
  }

  session(sessionId: string): EditSessionV1
  {
    const session = this.#sessions.get(sessionId)
    if (!session)
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        'edit session is unavailable'
      )
    return session
  }

  sessions(): readonly EditSessionV1[]
  {
    return [...this.#sessions.values()]
  }

  // begin has no session to look up yet, so its retained outcome is discovered
  // from the registry's own namespace. Only the source identity is needed, so
  // discovery never rereads or rehashes the source bytes
  lookupBeginOutcomeV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1
  ): EditIdempotentOutcomeProjectionV1 | null
  {
    const sourceBinding = openingRefusalSourceBindingV1(request, sourceIdentity)
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      sourceIdentity.provenance
    )
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256: invocation.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256: editCanonicalSha256V1({
        sourceBinding,
        registrationId: request.changeContractRegistrationId,
        expectedSemanticContractSha256: request.expectedSemanticContractSha256,
        provenanceEvidenceSha256,
      }),
      requestId: request.requestId,
    })
    const requestSha256 = editCanonicalSha256V1({
      request,
      sourceBinding,
      provenanceEvidenceSha256,
    })
    const completed = this.#beginIdempotency.get(namespaceSha256)
    const refused = completed
      ? undefined
      : this.#beginRefusals.get(namespaceSha256)
    const retainedOutcome = this.#beginOutcomes.get(namespaceSha256)
    const retainedRequestSha256 =
      retainedOutcome?.requestSha256 ??
      completed?.requestSha256 ??
      refused?.requestSha256
    if (retainedRequestSha256 === undefined) return null
    // the same request ID over different canonical input is a conflict, not a
    // discovery; reporting it as found would hand back another call's outcome
    if (retainedRequestSha256 !== requestSha256)
      throw new EditSessionErrorV1(
        'edit.request_id_conflict',
        'begin request ID was already used with different canonical input'
      )
    if (retainedOutcome !== undefined)
    {
      return Object.freeze({
        namespaceSha256,
        requestSha256,
        classification: retainedOutcome.disposition,
        attemptId: retainedOutcome.attemptId,
        attemptSequence: retainedOutcome.attemptSequence,
        toolName: 'edit_begin',
        requestId: request.requestId,
        sessionId:
          retainedOutcome.openingSession.state === 'present'
            ? retainedOutcome.openingSession.sessionId
            : null,
        preHead: null,
        postHead: retainedOutcome.postHead,
        retainedOutcomeSha256: retainedOutcome.resultSha256,
        refusalCode:
          retainedOutcome.disposition === 'refused' &&
          retainedOutcome.result !== null &&
          typeof retainedOutcome.result === 'object' &&
          typeof (retainedOutcome.result as Record<string, unknown>)['code'] ===
            'string'
            ? ((retainedOutcome.result as Record<string, unknown>)[
                'code'
              ] as string)
            : null,
      })
    }
    if (completed)
    {
      const attempt = this.#beginAttempts.get(namespaceSha256)?.authority
      return Object.freeze({
        namespaceSha256,
        requestSha256,
        classification: 'completed' as const,
        attemptId: attempt?.attemptId ?? completed.result.sessionId,
        attemptSequence: attempt?.attemptSequence ?? 0,
        toolName: 'edit_begin',
        requestId: request.requestId,
        sessionId: completed.result.sessionId,
        preHead: null,
        postHead: completed.result.head,
        retainedOutcomeSha256: editCanonicalSha256V1(completed.result),
        refusalCode: null,
      })
    }
    const attempt = this.#beginAttempts.get(namespaceSha256)?.authority
    return Object.freeze({
      namespaceSha256,
      requestSha256,
      classification: 'refused' as const,
      attemptId: attempt?.attemptId ?? namespaceSha256.slice(0, 32),
      attemptSequence: attempt?.attemptSequence ?? 0,
      toolName: 'edit_begin',
      requestId: request.requestId,
      sessionId: null,
      preHead: null,
      postHead: null,
      retainedOutcomeSha256: editCanonicalSha256V1({
        ok: false,
        code: refused!.code,
        safeMessage: refused!.message,
        context: refused!.context,
      }),
      refusalCode: refused!.code,
    })
  }

  retainedBeginOutcomeV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1
  ): RetainedEditBeginOutcomeAuthorityV1 | null
  {
    const sourceBinding = openingRefusalSourceBindingV1(request, sourceIdentity)
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      sourceIdentity.provenance
    )
    const beginNamespaceSha256 = editCanonicalSha256V1({
      sourceBinding,
      registrationId: request.changeContractRegistrationId,
      expectedSemanticContractSha256: request.expectedSemanticContractSha256,
      provenanceEvidenceSha256,
    })
    const requestSha256 = editCanonicalSha256V1({
      request,
      sourceBinding,
      provenanceEvidenceSha256,
    })
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256: invocation.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256,
      requestId: request.requestId,
    })
    const outcome = this.#beginOutcomes.get(namespaceSha256)
    if (outcome === undefined) return null
    if (
      outcome.requestSha256 !== requestSha256 ||
      outcome.beginNamespaceSha256 !== beginNamespaceSha256 ||
      editCanonicalSha256V1(outcome.invocationCorrelation) !==
        editCanonicalSha256V1(asInvocationCorrelation(invocation))
    )
      throw new EditSessionErrorV1(
        'edit.request_id_conflict',
        'begin retained outcome differs from the requested authority'
      )
    return structuredClone(outcome)
  }

  retainedBeginTransportOutcomeTargetV1(input: {
    readonly request: EditBeginRequestV1
    readonly sourceIdentity: EditBeginSourceIdentityV1
    readonly invocation: HostInvocationContextV1
  }): EditTransportOutcomeTargetV1
  {
    const sourceBinding = openingRefusalSourceBindingV1(
      input.request,
      input.sourceIdentity
    )
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      input.sourceIdentity.provenance
    )
    const beginNamespaceSha256 = editCanonicalSha256V1({
      sourceBinding,
      registrationId: input.request.changeContractRegistrationId,
      expectedSemanticContractSha256:
        input.request.expectedSemanticContractSha256,
      provenanceEvidenceSha256,
    })
    const requestSha256 = editCanonicalSha256V1({
      request: input.request,
      sourceBinding,
      provenanceEvidenceSha256,
    })
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256: input.invocation.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256,
      requestId: input.request.requestId,
    })
    const retained = this.#beginAttempts.get(namespaceSha256)
    if (
      retained === undefined ||
      retained.authority.requestSha256 !== requestSha256 ||
      retained.authority.beginNamespaceSha256 !== beginNamespaceSha256 ||
      editCanonicalSha256V1(retained.authority.invocationCorrelation) !==
        editCanonicalSha256V1(asInvocationCorrelation(input.invocation))
    )
      throw new EditSessionErrorV1(
        'edit.retention_failed',
        'begin transport outcome lacks its exact retained attempt authority'
      )
    const outcome = this.#beginOutcomes.get(namespaceSha256)
    if (
      outcome === undefined ||
      (outcome.disposition !== 'completed' &&
        outcome.disposition !== 'refused') ||
      outcome.attemptSequence !== retained.authority.attemptSequence ||
      outcome.requestSha256 !== requestSha256 ||
      outcome.namespaceSha256 !== namespaceSha256 ||
      outcome.beginNamespaceSha256 !== beginNamespaceSha256 ||
      editCanonicalSha256V1(outcome.invocationCorrelation) !==
        editCanonicalSha256V1(retained.authority.invocationCorrelation)
    )
      throw new EditSessionErrorV1(
        'edit.retention_failed',
        'begin transport target lacks a terminal semantic outcome'
      )
    return Object.freeze({
      kind: 'registryBegin',
      toolName: 'edit_begin',
      disposition: outcome.disposition,
      attemptId: outcome.attemptId,
      attemptSequence: retained.authority.attemptSequence,
      requestId: input.request.requestId,
      requestSha256,
      sessionId:
        outcome.openingSession.state === 'present'
          ? outcome.openingSession.sessionId
          : null,
      namespaceSha256,
      invocationCorrelation: structuredClone(
        retained.authority.invocationCorrelation
      ),
    })
  }

  async begin(
    request: EditBeginRequestV1,
    source: EditSourceIntakeV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  {
    if (this.#beginBusy)
      throw new EditSessionErrorV1(
        'edit.session_busy',
        'edit-session registry is admitting another source'
      )
    this.#beginBusy = true
    try
    {
      return await this.#beginSerialized(request, source, invocation)
    }
    finally
    {
      this.#beginBusy = false
    }
  }

  // hosts use this admission for opening refusals that require durable source
  // authority but must never receive source bytes or create revision zero
  async refuseBeginOpeningV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1,
    refusal: EditBeginOpeningRefusalV1
  ): Promise<never>
  {
    if (this.#beginBusy)
      throw new EditSessionErrorV1(
        'edit.session_busy',
        'edit-session registry is admitting another source'
      )
    this.#beginBusy = true
    try
    {
      return await this.#refuseBeginOpeningSerializedV1(
        request,
        sourceIdentity,
        invocation,
        refusal
      )
    }
    finally
    {
      this.#beginBusy = false
    }
  }

  async #refuseBeginOpeningSerializedV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1,
    refusal: EditBeginOpeningRefusalV1
  ): Promise<never>
  {
    const sourceBinding =
      refusal.code === 'edit.source_identity_mismatch'
        ? openingRefusalSourceBindingV1(request, sourceIdentity)
        : exactSourceBinding(request, sourceIdentity)
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      sourceIdentity.provenance
    )
    const beginNamespaceSha256 = editCanonicalSha256V1({
      sourceBinding,
      registrationId: request.changeContractRegistrationId,
      expectedSemanticContractSha256: request.expectedSemanticContractSha256,
      provenanceEvidenceSha256,
    })
    const requestSha256 = editCanonicalSha256V1({
      request,
      sourceBinding,
      provenanceEvidenceSha256,
    })
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256: invocation.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256,
      requestId: request.requestId,
    })
    const completed = this.#beginIdempotency.get(namespaceSha256)
    if (completed !== undefined)
    {
      if (completed.requestSha256 !== requestSha256)
        throw new EditSessionErrorV1(
          'edit.request_id_conflict',
          'begin request ID was already used with different canonical input'
        )
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        'opening refusal namespace already contains a completed begin',
        true
      )
    }
    const refused = this.#beginRefusals.get(namespaceSha256)
    if (refused !== undefined)
    {
      if (refused.requestSha256 !== requestSha256)
        throw new EditSessionErrorV1(
          'edit.request_id_conflict',
          'begin request ID was already used with different canonical input'
        )
      throw new EditSessionErrorV1(
        refused.code,
        refused.message,
        false,
        refused.context
      )
    }
    const sequence = this.#registryAttemptSequence
    this.#registryAttemptSequence += 1
    const prefix = `registry-attempts/${String(sequence).padStart(6, '0')}-${requestSha256.slice(
      0,
      16
    )}`
    const invocationCorrelation = asInvocationCorrelation(invocation)
    const attemptAuthority: RetainedEditBeginAttemptAuthorityV1 = Object.freeze(
      {
        schemaVersion: 1,
        kind: 'retained-edit-begin-attempt-authority-v1',
        attemptId: `edit-begin-attempt-${editCanonicalSha256V1({
          namespaceSha256,
          requestSha256,
          invocationCorrelation,
          sequence,
        })}`,
        attemptSequence: sequence,
        namespaceSha256,
        beginNamespaceSha256,
        requestSha256,
        request: structuredClone(request),
        registryIdentity: {
          realmSha256: this.#identity.realmSha256,
          profileSha256: this.#identity.profileSha256,
          principalSha256: invocation.principalSha256,
        },
        sourceIdentity: {
          expectedArtifactSha256: sourceIdentity.expectedArtifactSha256,
          provenance: structuredClone(sourceIdentity.provenance),
          provenanceEvidenceSha256,
          sourceBinding: structuredClone(sourceBinding),
        },
        invocationCorrelation,
      }
    )
    await retainImmutable(
      this.#store,
      `${prefix}/request.json`,
      editCanonicalBytesV1(attemptAuthority)
    )
    this.#beginAttempts.set(namespaceSha256, {
      prefix,
      authority: attemptAuthority,
    })
    const message = refusal.safeMessage
    const context = Object.freeze(structuredClone(refusal.context))
    const result = Object.freeze({
      code: refusal.code,
      safeMessage: message,
      context,
      recoveryRequired: false,
    })
    assertFrozenRefusalResultV1(refusal.code, result)
    const outcome: RetainedEditBeginOutcomeAuthorityV1 = Object.freeze({
      schemaVersion: 1,
      kind: 'retained-edit-begin-outcome-authority-v1',
      attemptId: attemptAuthority.attemptId,
      attemptSequence: attemptAuthority.attemptSequence,
      registryAttemptSha256: editCanonicalSha256V1(attemptAuthority),
      namespaceSha256,
      beginNamespaceSha256,
      requestSha256,
      invocationCorrelation,
      disposition: 'refused',
      result,
      resultSha256: editCanonicalSha256V1(result),
      openingSession: Object.freeze({ state: 'absent' as const }),
      preHead: null,
      postHead: null,
      budget: Object.freeze(initialBudget()),
      events: Object.freeze([]),
      evidenceIds: Object.freeze([]),
    })
    await retainImmutable(
      this.#store,
      `${prefix}/outcome.json`,
      editCanonicalBytesV1(outcome)
    )
    this.#beginOutcomes.set(namespaceSha256, outcome)
    this.#beginRefusals.set(namespaceSha256, {
      requestSha256,
      code: result.code,
      message,
      context,
    })
    throw new EditSessionErrorV1(result.code, message, false, result.context)
  }

  async #beginSerialized(
    request: EditBeginRequestV1,
    source: EditSourceIntakeV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  {
    const intake = validateEditSourceIntakeV1(source)
    const sourceBinding = exactSourceBinding(request, intake)
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      intake.provenance
    )
    const beginNamespaceSha256 = editCanonicalSha256V1({
      sourceBinding,
      registrationId: request.changeContractRegistrationId,
      expectedSemanticContractSha256: request.expectedSemanticContractSha256,
      provenanceEvidenceSha256,
    })
    const requestSha256 = editCanonicalSha256V1({
      request,
      sourceBinding,
      provenanceEvidenceSha256,
    })
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256: invocation.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256,
      requestId: request.requestId,
    })
    const completed = this.#beginIdempotency.get(namespaceSha256)
    if (completed)
    {
      if (completed.requestSha256 !== requestSha256)
        throw new EditSessionErrorV1(
          'edit.request_id_conflict',
          'begin request ID was already used with different canonical input'
        )
      return structuredClone(completed.result)
    }
    const refused = this.#beginRefusals.get(namespaceSha256)
    if (refused)
    {
      if (refused.requestSha256 !== requestSha256)
        throw new EditSessionErrorV1(
          'edit.request_id_conflict',
          'begin request ID was already used with different canonical input'
        )
      throw new EditSessionErrorV1(
        refused.code,
        refused.message,
        false,
        refused.context
      )
    }
    const sequence = this.#registryAttemptSequence
    this.#registryAttemptSequence += 1
    const prefix = `registry-attempts/${String(sequence).padStart(6, '0')}-${requestSha256.slice(
      0,
      16
    )}`
    const invocationCorrelation = asInvocationCorrelation(invocation)
    const attemptAuthority: RetainedEditBeginAttemptAuthorityV1 = Object.freeze(
      {
        schemaVersion: 1,
        kind: 'retained-edit-begin-attempt-authority-v1',
        attemptId: `edit-begin-attempt-${editCanonicalSha256V1({
          namespaceSha256,
          requestSha256,
          invocationCorrelation,
          sequence,
        })}`,
        attemptSequence: sequence,
        namespaceSha256,
        beginNamespaceSha256,
        requestSha256,
        request: structuredClone(request),
        registryIdentity: {
          realmSha256: this.#identity.realmSha256,
          profileSha256: this.#identity.profileSha256,
          principalSha256: invocation.principalSha256,
        },
        sourceIdentity: {
          expectedArtifactSha256: intake.expectedArtifactSha256,
          provenance: structuredClone(intake.provenance),
          provenanceEvidenceSha256,
          sourceBinding: structuredClone(sourceBinding),
        },
        invocationCorrelation,
      }
    )
    await retainImmutable(
      this.#store,
      `${prefix}/request.json`,
      editCanonicalBytesV1(attemptAuthority)
    )
    this.#beginAttempts.set(namespaceSha256, {
      prefix,
      authority: attemptAuthority,
    })
    let committedResult: EditBeginDomainResultV1 | null = null
    try
    {
      const result = await this.#beginInternal(request, source, invocation)
      committedResult = result
      const session = this.#sessions.get(result.sessionId)
      if (session === undefined)
        throw new EditSessionErrorV1(
          'edit.recovery_required',
          'committed begin result has no live session authority',
          true
        )
      const status = session.retainedStatusFactsV1()
      const event = session.events.find(
        (candidate) =>
          candidate.projection.eventKind === 'session-begun' &&
          candidate.projection.invocationCorrelation.invocationSha256 ===
            invocationCorrelation.invocationSha256 &&
          candidate.projection.invocationCorrelation.boundaryKind ===
            invocationCorrelation.boundaryKind
      )
      if (
        event === undefined ||
        event.eventSha256 !== result.eventSha256 ||
        editCanonicalSha256V1(event.projection.postHead) !==
          editCanonicalSha256V1(exactRevisionFromHeadV1(result.head))
      )
        throw new EditSessionErrorV1(
          'edit.recovery_required',
          'committed begin result differs from its session-begun authority',
          true
        )
      const outcome: RetainedEditBeginOutcomeAuthorityV1 = Object.freeze({
        schemaVersion: 1,
        kind: 'retained-edit-begin-outcome-authority-v1',
        attemptId: attemptAuthority.attemptId,
        attemptSequence: attemptAuthority.attemptSequence,
        registryAttemptSha256: editCanonicalSha256V1(attemptAuthority),
        namespaceSha256,
        beginNamespaceSha256,
        requestSha256,
        invocationCorrelation,
        disposition: 'completed',
        result: structuredClone(result),
        resultSha256: editCanonicalSha256V1(result),
        openingSession: {
          state: 'present' as const,
          sessionId: result.sessionId,
          sessionKey: editSessionKeyV1(result.sessionId),
        },
        preHead: null,
        postHead: structuredClone(result.head),
        budget: structuredClone(status.latestReport.budget),
        events: Object.freeze([
          Object.freeze({
            eventSha256: event.eventSha256,
            sequence: event.projection.sequence,
          }),
        ]),
        evidenceIds: Object.freeze(
          [result.sourceProvenanceEvidenceSha256, ...status.evidenceIds].sort()
        ),
      })
      await retainImmutable(
        this.#store,
        `${prefix}/outcome.json`,
        editCanonicalBytesV1(outcome)
      )
      this.#beginOutcomes.set(namespaceSha256, outcome)
      return result
    }
    catch (error)
    {
      if (committedResult !== null)
        throw new EditSessionErrorV1(
          'edit.recovery_required',
          error instanceof Error ? error.message : String(error),
          true
        )
      const code = errorCode(error)
      const message = error instanceof Error ? error.message : String(error)
      const matchingSessions = [...this.#sessions.values()].filter(
        (session) =>
        {
          const manifest = session.manifest
          return (
            manifest.invocationCorrelation.invocationSha256 ===
              invocationCorrelation.invocationSha256 &&
            manifest.invocationCorrelation.boundaryKind ===
              invocationCorrelation.boundaryKind &&
            manifest.sourceArtifactSha256 === intake.expectedArtifactSha256 &&
            manifest.sourceProvenanceEvidenceSha256 ===
              provenanceEvidenceSha256 &&
            manifest.changeContractRegistrationId ===
              request.changeContractRegistrationId &&
            manifest.changeContractSha256 ===
              request.expectedSemanticContractSha256
          )
        }
      )
      if (matchingSessions.length > 1)
        throw new EditSessionErrorV1(
          'edit.recovery_required',
          'begin refusal correlates with multiple retained sessions',
          true
        )
      const matchingSession = matchingSessions[0]
      const status = matchingSession?.retainedStatusFactsV1()
      const event = matchingSession?.events.find(
        (candidate) =>
          candidate.projection.eventKind === 'session-begun' &&
          candidate.projection.invocationCorrelation.invocationSha256 ===
            invocationCorrelation.invocationSha256 &&
          candidate.projection.invocationCorrelation.boundaryKind ===
            invocationCorrelation.boundaryKind
      )
      if (
        matchingSession !== undefined &&
        (status === undefined || event === undefined)
      )
        throw new EditSessionErrorV1(
          'edit.recovery_required',
          'committed begin refusal lacks exact opening event authority',
          true
        )
      const result = Object.freeze({
        code,
        safeMessage: message,
        context:
          error instanceof EditSessionErrorV1
            ? structuredClone(error.context)
            : {},
        recoveryRequired:
          error instanceof EditSessionErrorV1 && error.committed,
      })
      assertFrozenRefusalResultV1(code, result)
      const outcome: RetainedEditBeginOutcomeAuthorityV1 = Object.freeze({
        schemaVersion: 1,
        kind: 'retained-edit-begin-outcome-authority-v1',
        attemptId: attemptAuthority.attemptId,
        attemptSequence: attemptAuthority.attemptSequence,
        registryAttemptSha256: editCanonicalSha256V1(attemptAuthority),
        namespaceSha256,
        beginNamespaceSha256,
        requestSha256,
        invocationCorrelation,
        disposition: 'refused',
        result,
        resultSha256: editCanonicalSha256V1(result),
        openingSession:
          matchingSession === undefined
            ? { state: 'absent' as const }
            : {
                state: 'present' as const,
                sessionId: matchingSession.sessionId,
                sessionKey: editSessionKeyV1(matchingSession.sessionId),
              },
        preHead: null,
        postHead:
          matchingSession === undefined
            ? null
            : structuredClone(matchingSession.head),
        budget:
          status === undefined
            ? initialBudget()
            : structuredClone(status.latestReport.budget),
        events:
          event === undefined
            ? []
            : Object.freeze([
                Object.freeze({
                  eventSha256: event.eventSha256,
                  sequence: event.projection.sequence,
                }),
              ]),
        evidenceIds:
          status === undefined
            ? []
            : Object.freeze([...status.evidenceIds].sort()),
      })
      await retainImmutable(
        this.#store,
        `${prefix}/outcome.json`,
        editCanonicalBytesV1(outcome)
      )
      this.#beginOutcomes.set(namespaceSha256, outcome)
      if (!(error instanceof EditSessionErrorV1 && error.committed))
        this.#beginRefusals.set(namespaceSha256, {
          requestSha256,
          code,
          message,
          context:
            error instanceof EditSessionErrorV1
              ? structuredClone(error.context)
              : {},
        })
      throw error
    }
  }

  async #beginInternal(
    request: EditBeginRequestV1,
    source: EditSourceIntakeV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  {
    const intake = validateEditSourceIntakeV1(source)
    const sourceBinding = exactSourceBinding(request, intake)
    const provenanceEvidenceSha256 = sourceProvenanceEvidenceSha256V1(
      intake.provenance
    )
    const beginNamespaceSha256 = editCanonicalSha256V1({
      sourceBinding,
      registrationId: request.changeContractRegistrationId,
      expectedSemanticContractSha256: request.expectedSemanticContractSha256,
      provenanceEvidenceSha256,
    })
    const namespaceSha256 = editCanonicalSha256V1({
      realmSha256: this.#identity.realmSha256,
      profileSha256: this.#identity.profileSha256,
      principalSha256: invocation.principalSha256,
      toolName: 'edit_begin',
      beginNamespaceSha256,
      requestId: request.requestId,
    })
    const requestSha256 = editCanonicalSha256V1({
      request,
      sourceBinding,
      provenanceEvidenceSha256,
    })
    const previous = this.#beginIdempotency.get(namespaceSha256)
    if (previous)
    {
      if (previous.requestSha256 !== requestSha256)
        throw new EditSessionErrorV1(
          'edit.request_id_conflict',
          'begin request ID was already used with different canonical input'
        )
      return structuredClone(previous.result)
    }
    const active = [...this.#sessions.values()].filter(
      (session) =>
        session.state === 'active' || session.state === 'recovery-required'
    ).length
    if (active >= this.#policy.activeSessionLimit)
      throw new EditSessionErrorV1(
        'edit.capacity_exceeded',
        'active edit-session capacity is exhausted'
      )
    const capability = await this.#store.capability()
    if (
      !capability.writable ||
      !capability.exclusiveWriter ||
      !capability.durableFileSync ||
      !capability.durableDirectorySync ||
      !capability.noReplaceInstall ||
      !capability.expectedHashPointerCas
    )
      throw new EditSessionErrorV1(
        'edit.retention_failed',
        'artifact store lacks required durable atomic capabilities'
      )
    const recheck = await intake.recheck()
    if (
      !recheck.ok ||
      recheck.observedArtifactSha256 !== intake.expectedArtifactSha256
    )
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        'source provenance recheck did not reproduce exact bytes'
      )
    const preflight = await inspectSemanticEditArtifact(intake.bytes)
    if (
      !preflight.ok ||
      !preflight.project ||
      !preflight.semanticSourceIdentity ||
      !preflight.semanticSourceSha256 ||
      !preflight.admission
    )
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        `source is not editable: ${preflight.refusal?.code ?? 'preflight failed'}`
      )
    const semanticSourceIdentity =
      intake.provenance.kind === 'registeredTemplate'
        ? {
            ...preflight.semanticSourceIdentity,
            sourceKind: 'registeredTemplate' as const,
            templateArtifactSha256: intake.provenance.templateArtifactSha256,
            templateId: intake.provenance.templateId,
            templateVersion: intake.provenance.templateVersion,
          }
        : preflight.semanticSourceIdentity
    const semanticSourceSha256 = semanticHashV1(
      'semantic-source',
      semanticSourceIdentity
    )
    const registeredContract = this.#contracts.get(
      request.changeContractRegistrationId
    )
    const bound = this.#contracts.bind({
      registrationId: request.changeContractRegistrationId,
      expectedSemanticContractSha256: request.expectedSemanticContractSha256,
      source: sourceBinding,
      existingBindings: resolveTargetExistingBindings(
        registeredContract,
        preflight.project
      ),
    })
    const assessment = capabilityAssessment(
      semanticSourceSha256,
      preflight,
      this.#identity.pinnedScratchRuntimeSourceSha256
    )
    const runnerAvailability = evaluationRunnerAvailabilityV1(
      this.#evaluationPorts,
      bound.registration.semanticContract
    )
    const profile = buildGroupGCapabilityProfileV1(assessment)
    const openedAtEpochMs = this.#clock.nowEpochMs()
    const sessionId = editOpaqueIdV1(
      'edit-session',
      this.#entropy.randomBytes(16),
      {
        beginNamespaceSha256,
        sessionSequence: this.#sessionSequence,
      }
    )
    const sessionKey = editSessionKeyV1(sessionId)
    this.#sessionSequence += 1
    const layout = editSessionLayoutV1(sessionKey)
    const lineage = buildSourceLineageV1(
      preflight.project,
      semanticSourceSha256
    )
    const allocator = preflight.project.uids.snapshot()
    const provisionalSnapshotSha256 = semanticHashV1('capability-snapshot', {
      head: 'revision-zero-provisional',
      semanticSourceSha256,
      capabilityProfileSha256: profile.capabilityProfileSha256,
      changeContractSha256: bound.registration.semanticContractSha256,
    })
    const revision = buildSourceRevisionV1(
      {
        semanticSourceSha256,
        sourceArtifactSha256: intake.expectedArtifactSha256,
        changeContractSha256: bound.registration.semanticContractSha256,
        capabilityProfileSha256: profile.capabilityProfileSha256,
        capabilitySnapshotSha256: provisionalSnapshotSha256,
        originatingRequestId: request.requestId,
        invocationCorrelation: asInvocationCorrelation(invocation),
        hostTimestampEpochMs: openedAtEpochMs,
      },
      preflight,
      allocator,
      lineage.active,
      lineage.history,
      '',
      ''
    )
    const snapshot = buildEditCapabilitySnapshotV1({
      head: exactRevisionFromHeadV1(revision.head),
      admittedAssetCollectionVersion: 0,
      policyConfigVersion: this.#identity.policyConfigVersion,
      runnerAvailabilityEpoch: runnerAvailabilityEpochV1(runnerAvailability),
      runnerAvailability,
      diskLowWaterState: 'normal',
      collectionEpoch: 0,
      resourceEpoch: 0,
      cursorEpoch: 0,
      diskCapacityClass: 'normal',
      remainingBudget: initialBudget(),
      freeByteTelemetryClass: 'bounded',
      retentionPolicyVersion: 1,
      retentionPolicySha256: this.#identity.retentionPolicySha256,
    })
    revision.head = {
      ...revision.head,
      capabilitySnapshotSha256: snapshot.capabilitySnapshotSha256,
    }
    revision.capabilitySnapshot = snapshot
    revision.candidateKey = layout.revision(
      0,
      revision.head.revisionId,
      'candidate.sb3'
    )
    revision.manifestKey = layout.revision(
      0,
      revision.head.revisionId,
      'manifest.json'
    )
    const capabilityProfileBytes = editCanonicalBytesV1(profile)
    const contractRegistrationBytes = editCanonicalBytesV1(bound.registration)
    const boundChangeContractBytes = editCanonicalBytesV1(bound)
    const manifest: EditKernelSessionManifestV1 = {
      schemaVersion: 1,
      sessionId,
      sessionKey,
      state: 'active',
      semanticSourceIdentity,
      semanticSourceSha256,
      sourceArtifactSha256: intake.expectedArtifactSha256,
      sourceProvenanceEvidenceSha256: provenanceEvidenceSha256,
      provenance: intake.provenance,
      changeContractRegistrationId: request.changeContractRegistrationId,
      changeContractSha256: bound.registration.semanticContractSha256,
      capabilityProfileSha256: profile.capabilityProfileSha256,
      capabilityProfileArtifactSha256: sha256Hex(capabilityProfileBytes),
      changeContractRegistrationArtifactSha256: sha256Hex(
        contractRegistrationBytes
      ),
      boundChangeContractArtifactSha256: sha256Hex(boundChangeContractBytes),
      transactionResourceLimits: {
        activeMatchCandidates: bound.effectiveLimits.activeMatchCandidateLimit,
        describedBlockNodes: bound.effectiveLimits.intentBudgetLimit,
        touchedBlockRecords: bound.effectiveLimits.impactBudgetLimit,
        touchedTargets: DEFAULT_PHASE_8_RESOURCE_POLICY.targetsTouchedPerBatch,
        touchedScripts: DEFAULT_PHASE_8_RESOURCE_POLICY.scriptsTouchedPerBatch,
        touchedDeclarations:
          DEFAULT_PHASE_8_RESOURCE_POLICY.declarationsTouchedPerBatch,
        touchedComments:
          DEFAULT_PHASE_8_RESOURCE_POLICY.commentsTouchedPerBatch,
        touchedMedia: DEFAULT_PHASE_8_RESOURCE_POLICY.mediaTouchedPerBatch,
      },
      invocationCorrelation: asInvocationCorrelation(invocation),
      openedAtEpochMs,
      idleDeadlineEpochMs: openedAtEpochMs + this.#policy.idleLeaseMs,
      absoluteDeadlineEpochMs: openedAtEpochMs + this.#policy.absoluteLeaseMs,
    }
    const reservationId = editCanonicalSha256V1({
      beginNamespaceSha256,
      purpose: 'session-begin',
    })
    const reservedBytes = intake.bytes.byteLength * 3 + 4 * 1024 * 1024
    const beginRecoveryAuthorityBytes = editCanonicalBytesV1({
      schemaVersion: 1,
      kind: 'edit-session-begin-recovery-authority-v1',
      sessionId,
      sessionKey,
      beginNamespaceSha256,
      reservationId,
      reservedBytes,
      sourceArtifactSha256: intake.expectedArtifactSha256,
      semanticSourceSha256,
      changeContractSha256: bound.registration.semanticContractSha256,
      capabilityProfileSha256: profile.capabilityProfileSha256,
    })
    const effectiveArtifactByteLimit = Math.min(
      this.#policy.artifactByteLimit,
      bound.effectiveLimits.artifactBytesPerSessionLimit
    )
    const sourceArtifacts = [
      [layout.sourceInput, intake.bytes],
      [
        layout.sourceSemanticIdentity,
        editCanonicalBytesV1({
          projection: semanticSourceIdentity,
          semanticSourceSha256,
        }),
      ],
      [
        layout.sourceProvenance,
        editCanonicalBytesV1({
          evidenceSha256: provenanceEvidenceSha256,
          provenance: intake.provenance,
        }),
      ],
      [
        layout.sourceAdmission,
        editCanonicalBytesV1({
          stages: preflight.completedStages,
          projectCounts: preflight.admission.projectCounts,
          jsonMetrics: preflight.admission.jsonMetrics,
        }),
      ],
      [layout.changeContractRegistration, contractRegistrationBytes],
      [layout.boundChangeContract, boundChangeContractBytes],
      [layout.capabilityProfile, capabilityProfileBytes],
    ] as const
    const revisionArtifacts = [
      ['candidate.sb3', intake.bytes, 'application/x.scratch.sb3' as const],
      [
        'batch.json',
        editCanonicalBytesV1(revision.transitionDescriptor),
        'application/json' as const,
      ],
      [
        'resolved-plan.json',
        editCanonicalBytesV1({ resolvedPlanSha256: null }),
        'application/json' as const,
      ],
      [
        'operation-results.json',
        editCanonicalBytesV1(revision.operationResults),
        'application/json' as const,
      ],
      [
        'previous-delta.json',
        editCanonicalBytesV1(revision.parentDelta),
        'application/json' as const,
      ],
      [
        'cumulative-delta.json',
        editCanonicalBytesV1(revision.cumulativeDelta),
        'application/json' as const,
      ],
      [
        'preservation.json',
        editCanonicalBytesV1(revision.preservation),
        'application/json' as const,
      ],
      [
        'authorization.json',
        editCanonicalBytesV1(revision.authorization),
        'application/json' as const,
      ],
      [
        'diagnostics.json',
        editCanonicalBytesV1(revision.diagnostics),
        'application/json' as const,
      ],
      [
        'allocator.json',
        editCanonicalBytesV1(revision.allocatorState),
        'application/json' as const,
      ],
      [
        'lineage.json',
        editCanonicalBytesV1(revision.activeLineage),
        'application/json' as const,
      ],
      [
        'lineage-history.json',
        editCanonicalBytesV1(revision.lineageHistory),
        'application/json' as const,
      ],
      [
        'capability-snapshot.json',
        editCanonicalBytesV1(revision.capabilitySnapshot),
        'application/json' as const,
      ],
      [
        'manifest.json',
        editCanonicalBytesV1(revision),
        'application/json' as const,
      ],
    ] as const
    const eventProjection = {
      schemaVersion: 1 as const,
      sessionId,
      sequence: 0,
      eventKind: 'session-begun' as const,
      preHead: { state: 'absent' as const },
      postHead: exactRevisionFromHeadV1(revision.head),
      semanticPayloadSha256: editCanonicalSha256V1({
        semanticSourceSha256,
        changeContractSha256: bound.registration.semanticContractSha256,
      }),
      invocationCorrelation: asInvocationCorrelation(invocation),
    }
    const eventSha256 = semanticHashV1('semantic-event', eventProjection)
    const event: EditKernelSemanticEventV1 = {
      projection: eventProjection,
      eventSha256,
      hostTimestampEpochMs: openedAtEpochMs,
    }
    const eventBytes = editCanonicalBytesV1(event)
    const semanticReport = semanticReportProjectionV1(
      semanticSourceSha256,
      bound.registration.semanticContractSha256,
      profile.capabilityProfileSha256,
      [revision]
    )
    const preReportRetainedBytes = [
      beginRecoveryAuthorityBytes,
      ...sourceArtifacts.map(([, bytes]) => bytes),
      ...revisionArtifacts.map(([, bytes]) => bytes),
      eventBytes,
    ].reduce((total, bytes) => total + bytes.byteLength, 0)
    let report: EditKernelReportV1 = {
      semanticProjection: semanticReport.projection,
      semanticProjectionSha256: semanticReport.sha256,
      reportArtifactSha256: editCanonicalSha256V1(semanticReport.projection),
      reportSequence: 0,
      state: 'active',
      budget: {
        ...initialBudget(),
        artifactBytesUsed: preReportRetainedBytes,
      },
      eventHeadSha256: eventSha256,
      revisionCount: 1,
      attemptCount: 1,
      checkpointCount: 0,
      previewCount: 0,
      certificateCount: 0,
      evaluationState: 'none',
      exportState:
        this.#publicationPort === undefined ? 'unavailable' : 'available',
      limitations: editSessionLimitationsV1({
        evaluationPorts: this.#evaluationPorts,
        publicationPort: this.#publicationPort,
      }),
      generatedAtEpochMs: openedAtEpochMs,
    }
    const sessionManifestBytes = editCanonicalBytesV1(manifest)
    const semanticProjectionBytes = editCanonicalBytesV1(
      report.semanticProjection
    )
    let projectedArtifactBytes =
      preReportRetainedBytes + sessionManifestBytes.byteLength
    let reportBytes: Uint8Array = new Uint8Array()
    let reportJsonSha256 = ''
    let markdown: Uint8Array = new Uint8Array()
    let reportManifestBytes: Uint8Array = new Uint8Array()
    for (let iteration = 0; iteration < 16; iteration += 1)
    {
      report = {
        ...report,
        budget: {
          ...report.budget,
          artifactBytesUsed: projectedArtifactBytes,
        },
      }
      reportBytes = editCanonicalBytesV1(report)
      reportJsonSha256 = sha256Hex(reportBytes)
      markdown = new TextEncoder().encode(
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
      reportManifestBytes = editCanonicalBytesV1({
        schemaVersion: 1,
        reportJsonSha256,
        reportByteLength: reportBytes.byteLength,
        semanticProjectionSha256: report.semanticProjectionSha256,
      })
      const nextArtifactBytes =
        preReportRetainedBytes +
        sessionManifestBytes.byteLength +
        reportBytes.byteLength +
        semanticProjectionBytes.byteLength +
        markdown.byteLength +
        reportManifestBytes.byteLength
      if (nextArtifactBytes === projectedArtifactBytes) break
      projectedArtifactBytes = nextArtifactBytes
      if (iteration === 15)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'opening report artifact budget did not reach a fixed point'
        )
    }
    if (projectedArtifactBytes > effectiveArtifactByteLimit)
      throw new EditSessionErrorV1(
        'edit.artifact_quota_exceeded',
        'opening session artifacts exceed the bound artifact ceiling'
      )
    await this.#store.reserveQuota(reservationId, reservedBytes)
    let headCommitted = false
    let recoveryMaterial: {
      event: EditKernelSemanticEventV1
      report: EditKernelReportV1
      eventSha256: string
      semanticReportSha256: string
      reportPointerBytes: Uint8Array
      retainedBytes: number
      headPointerSha256: string | null
    } | null = null
    try
    {
      const beginRecoveryAuthority = await retainImmutable(
        this.#store,
        layout.recoveryBegin,
        beginRecoveryAuthorityBytes
      )
      let retainedBytes = beginRecoveryAuthority.byteLength
      for (const [key, bytes] of sourceArtifacts)
      {
        const retained = await retainImmutable(this.#store, key, bytes)
        retainedBytes += retained.byteLength
      }
      let revisionManifest: EditArtifactIdentityV1 | null = null
      for (const [name, bytes, mimeType] of revisionArtifacts)
      {
        const retained = await retainPublicImmutable(
          this.#store,
          this.#resourceCatalogue,
          {
            sessionId,
            sessionKey,
            logicalKey: layout.revision(0, revision.head.revisionId, name),
            bytes,
            mimeType,
          }
        )
        retainedBytes += retained.byteLength
        if (name === 'manifest.json') revisionManifest = retained
      }
      if (revisionManifest === null)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          'revision-zero manifest was not retained'
        )
      const initialEvent = await retainPublicImmutable(
        this.#store,
        this.#resourceCatalogue,
        {
          sessionId,
          sessionKey,
          logicalKey: layout.event(0, eventSha256),
          bytes: eventBytes,
          mimeType: 'application/json',
        }
      )
      retainedBytes += initialEvent.byteLength
      const reportJson = await retainPublicImmutable(
        this.#store,
        this.#resourceCatalogue,
        {
          sessionId,
          sessionKey,
          logicalKey: layout.report(reportJsonSha256, 'report.json'),
          bytes: reportBytes,
          mimeType: 'application/json',
        }
      )
      retainedBytes += reportJson.byteLength
      const semanticProjection = await retainPublicImmutable(
        this.#store,
        this.#resourceCatalogue,
        {
          sessionId,
          sessionKey,
          logicalKey: layout.report(
            reportJsonSha256,
            'semantic-projection.json'
          ),
          bytes: editCanonicalBytesV1(report.semanticProjection),
          mimeType: 'application/json',
        }
      )
      retainedBytes += semanticProjection.byteLength
      const reportMarkdown = await retainPublicImmutable(
        this.#store,
        this.#resourceCatalogue,
        {
          sessionId,
          sessionKey,
          logicalKey: layout.report(reportJsonSha256, 'report.md'),
          bytes: markdown,
          mimeType: 'text/markdown; charset=utf-8',
        }
      )
      retainedBytes += reportMarkdown.byteLength
      const reportManifest = await retainPublicImmutable(
        this.#store,
        this.#resourceCatalogue,
        {
          sessionId,
          sessionKey,
          logicalKey: layout.report(reportJsonSha256, 'manifest.json'),
          bytes: reportManifestBytes,
          mimeType: 'application/json',
        }
      )
      retainedBytes += reportManifest.byteLength
      const reportPointerBytes = editCanonicalBytesV1({
        schemaVersion: 1,
        reportJsonSha256,
        reportManifestSha256: reportManifest.sha256,
      })
      recoveryMaterial = {
        event,
        report,
        eventSha256,
        semanticReportSha256: semanticReport.sha256,
        reportPointerBytes,
        retainedBytes,
        headPointerSha256: null,
      }
      const headPointer = await compareAndReconcilePointer(
        this.#store,
        layout.head,
        null,
        editCanonicalBytesV1({
          schemaVersion: 1,
          head: revision.head,
          revisionManifestSha256: revisionManifest.sha256,
        })
      )
      const retainedSessionManifest = await retainImmutable(
        this.#store,
        layout.session,
        sessionManifestBytes
      )
      retainedBytes += retainedSessionManifest.byteLength
      headCommitted = true
      recoveryMaterial.headPointerSha256 = headPointer.sha256
      const reportPointer = await compareAndReconcilePointer(
        this.#store,
        layout.currentReport,
        null,
        reportPointerBytes
      )
      await this.#store.settleQuota(reservationId, retainedBytes)
      const retainedArtifactEntries = await this.#store.listImmutable(
        layout.prefix
      )
      const session = new EditSessionV1({
        store: this.#store,
        resourceCatalogue: this.#resourceCatalogue,
        layout,
        clock: this.#clock,
        entropy: this.#entropy,
        handleSecret: this.#handleSecret,
        policy: this.#policy,
        transactionExecutor: this.#transactionExecutor,
        sourceBytes: intake.bytes,
        contract: bound,
        identity: this.#identity,
        manifest,
        initialRevision: revision,
        initialEvent: event,
        initialReport: report,
        budget: report.budget,
        retainedArtifactEntries,
        headPointerSha256: headPointer.sha256,
        reportPointerSha256: reportPointer.sha256,
        evaluationPorts: this.#evaluationPorts,
        publicationPort: this.#publicationPort,
        sourceRecheck: () => intake.recheck(),
      })
      this.#sessions.set(sessionId, session)
      const result: EditBeginDomainResultV1 = {
        sessionId,
        state: 'active',
        head: session.head,
        semanticSourceSha256,
        changeContractSha256: bound.registration.semanticContractSha256,
        capabilityProfileSha256: profile.capabilityProfileSha256,
        sourceProvenanceEvidenceSha256: provenanceEvidenceSha256,
        eventSha256,
        reportSha256: semanticReport.sha256,
      }
      this.#beginIdempotency.set(namespaceSha256, { requestSha256, result })
      return result
    }
    catch (error)
    {
      if (!headCommitted)
      {
        await this.#store.releaseQuota(reservationId).catch(() => undefined)
        throw new EditSessionErrorV1(
          error instanceof EditSessionErrorV1
            ? error.code
            : 'edit.retention_failed',
          error instanceof Error ? error.message : String(error)
        )
      }
      if (recoveryMaterial?.headPointerSha256)
      {
        try
        {
          const reportPointer = await compareAndReconcilePointer(
            this.#store,
            layout.currentReport,
            null,
            recoveryMaterial.reportPointerBytes
          )
          await this.#store.settleQuota(
            reservationId,
            recoveryMaterial.retainedBytes
          )
          const retainedArtifactEntries = await this.#store.listImmutable(
            layout.prefix
          )
          const session = new EditSessionV1({
            store: this.#store,
            resourceCatalogue: this.#resourceCatalogue,
            layout,
            clock: this.#clock,
            entropy: this.#entropy,
            handleSecret: this.#handleSecret,
            policy: this.#policy,
            transactionExecutor: this.#transactionExecutor,
            sourceBytes: intake.bytes,
            contract: bound,
            identity: this.#identity,
            manifest,
            initialRevision: revision,
            initialEvent: recoveryMaterial.event,
            initialReport: recoveryMaterial.report,
            budget: recoveryMaterial.report.budget,
            retainedArtifactEntries,
            headPointerSha256: recoveryMaterial.headPointerSha256,
            reportPointerSha256: reportPointer.sha256,
            evaluationPorts: this.#evaluationPorts,
            publicationPort: this.#publicationPort,
            sourceRecheck: () => intake.recheck(),
          })
          this.#sessions.set(sessionId, session)
          const result: EditBeginDomainResultV1 = {
            sessionId,
            state: 'active',
            head: session.head,
            semanticSourceSha256,
            changeContractSha256: bound.registration.semanticContractSha256,
            capabilityProfileSha256: profile.capabilityProfileSha256,
            sourceProvenanceEvidenceSha256: provenanceEvidenceSha256,
            eventSha256: recoveryMaterial.eventSha256,
            reportSha256: recoveryMaterial.semanticReportSha256,
          }
          this.#beginIdempotency.set(namespaceSha256, {
            requestSha256,
            result,
          })
          return result
        }
        catch (recoveryError)
        {
          const retainedArtifactEntries = await this.#store.listImmutable(
            layout.prefix
          )
          const recoverySession = new EditSessionV1({
            store: this.#store,
            resourceCatalogue: this.#resourceCatalogue,
            layout,
            clock: this.#clock,
            entropy: this.#entropy,
            handleSecret: this.#handleSecret,
            policy: this.#policy,
            transactionExecutor: this.#transactionExecutor,
            sourceBytes: intake.bytes,
            contract: bound,
            identity: this.#identity,
            manifest,
            initialRevision: revision,
            initialEvent: recoveryMaterial.event,
            initialReport: recoveryMaterial.report,
            budget: recoveryMaterial.report.budget,
            retainedArtifactEntries,
            headPointerSha256: recoveryMaterial.headPointerSha256,
            reportPointerSha256: null,
            initialState: 'recovery-required',
          })
          this.#sessions.set(sessionId, recoverySession)
          throw new EditSessionErrorV1(
            'edit.recovery_required',
            recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError),
            true
          )
        }
      }
      throw new EditSessionErrorV1(
        'edit.recovery_required',
        error instanceof Error ? error.message : String(error),
        true
      )
    }
  }
}

export function createEditSessionRegistryV1(
  options: EditSessionRegistryOptionsV1
): EditSessionRegistryV1
{
  return new EditSessionRegistryV1(options)
}

export function createEditSessionRegistryForExecutorV1(
  options: EditSessionRegistryOptionsV1,
  transactionExecutor: EditTransactionExecutorV1
): EditSessionRegistryV1
{
  return new EditSessionRegistryV1(options, transactionExecutor)
}
