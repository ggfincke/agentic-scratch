// packages/edit/src/index.ts
// safe direct-host edit lifecycle & exact contract facade

import type {
  EditApplyRequestV1,
  EditBeginRequestV1,
  EditCheckpointRequestV1,
  EditCloseRequestV1,
  EditEvaluateRequestV1,
  EditExportRequestV1,
  EditPreviewRequestV1,
  EditRollbackRequestV1,
  EditToolRequestForV1,
  EditToolName,
  EditUndoRequestV1,
  ExactRevisionIdentityV1,
  HeadProjectionV1,
  OperationPlanningQueryV1,
  OperationResultSummaryV1,
  RefusalCode,
  StandaloneMediaRefV1,
} from '@scratch-agent/ir/edit'
import { parseEditToolInputV1 } from '@scratch-agent/ir/edit'

import type { BoundChangeContractV1 } from './contracts/change-contracts.js'
import type { EditExportabilityV1 } from './evaluation/evaluation-certificate.js'
import type { EditKernelPreviewV1 } from './contracts/kernel-types.js'
import type { EditArtifactStorePort } from './transaction/ports.js'
import { verifyEditSessionReplayV1 as verifyInternalEditSessionReplayV1 } from './replay/replay.js'
import {
  createEditSessionRegistryForExecutorV1 as createInternalEditSessionRegistryForExecutorV1,
  type EditApplyDomainResultV1,
  type EditAssetAdmitDomainRequestV1,
  type EditAssetAdmitDomainResultV1,
  type EditAssetAdmitDomainSourceV1,
  type EditBeginDomainResultV1,
  type EditBeginOpeningRefusalV1,
  type EditBeginSourceIdentityV1,
  type EditInspectDomainItemV1,
  type EditInspectDomainResultV1,
  type EditRetainedCapabilityFactsV1,
  type EditRetainedCollectionFactsV1,
  type EditRetainedCollectionKindV1,
  type EditRetainedInspectionFactsV1,
  type EditRetainedOperationPlanningFactsV1,
  type EditRetainedOutcomeFactsV1,
  type EditRetainedStatusFactsV1,
  type EditSessionTerminalEvidenceV1,
  type EditRestoreDomainResultV1,
  type EditSessionRegistryOptionsV1,
  type EditSessionV1,
  type EditEvaluateDomainResultV1,
  type EditExportDomainResultV1,
  type EditIdempotentOutcomeProjectionV1,
  type EditStatusDomainResultV1,
  type EditTransportOutcomeTargetV1,
  type RetainedEditBeginOutcomeAuthorityV1,
} from './session/session.js'
import type { EditSourceIntakeV1 } from './session/source-intake.js'
import type { HostInvocationContextV1 } from './transaction/ports.js'
import { ProductionTransactionExecutorV1 } from './transaction/production-transaction.js'

export {
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  semanticAuthorityManifestV1,
} from '@scratch-agent/ir/edit'
export type { RunnerAvailabilityV1 } from '@scratch-agent/ir/edit'

export * from './replay/replay-run.js'

export { editCanonicalSha256V1 } from './support/canonical.js'

export { editOperationOccurrenceIdV1 } from './lineage/cumulative-attribution.js'

export { exactTargetRef } from './dispatch/target-dispatchers.js'

export {
  mediaTargetProductionOperationDispatchersV1,
  productionMediaTargetAddCostumePlanningCompletionV1,
  productionMediaTargetSpritePlanningCompletionV1,
} from './dispatch/media-target-dispatchers.js'

export { emptyFutureBindingLedgerV1 } from './lineage/future-binding-ledger.js'

export { buildSourceLineageV1 } from './lineage/lineage.js'

export {
  advanceProductionFutureBindingLedgerV1,
  mergeProductionLineageHistoryV1,
  productionCanonicalValueSha256V1,
  productionComputeCorrespondedDeltaV1,
  productionContractScopeSha256V1,
  productionOperationChangeFingerprintV1,
  productionProjectCorrespondenceV1,
  productionTargetPlanningFactSetSha256V1,
} from './transaction/production-transaction.js'
export type {
  ProductionOperationContextV1,
  ProductionOperationDispatchResultV1,
} from './transaction/production-transaction.js'

export {
  buildEditCapabilitySnapshotV1,
  buildGroupGCapabilityProfileV1,
} from './contracts/capabilities.js'
export type {
  MediaTargetCapabilityProfileInputV1,
} from './contracts/capabilities.js'

export type { EditOperationPlanningChoiceSlotV1 } from './transaction/transaction.js'

export { inventoryRetainedEditSessionsV1 } from './session/retained-session-inventory.js'
export type {
  RetainedEditSessionEvidenceV1,
  RetainedEditSessionInventoryV1,
} from './session/retained-session-inventory.js'
export { recoverRetainedEditSessionsV1 } from './session/retained-session-recovery.js'
export type {
  RecoveredRetainedEditAttemptV1,
} from './session/retained-session-recovery.js'

export {
  CHANGE_CONTRACT_REGISTRATION_LIMITS_V1,
  ChangeContractRegistrationErrorV1,
  EditChangeContractRegistryV1,
  boundRetainedPolicyArtifactV1,
  retainedPolicyArtifactBytesV1,
} from './contracts/change-contracts.js'
export type {
  BoundChangeContractV1,
  ChangeContractSourceBindingV1,
  ExistingContractBindingResolutionV1,
  RegisteredChangeContractV1,
  RetainedPolicyRegistryLimitsV1,
} from './contracts/change-contracts.js'

export {
  activateEvaluationPlanSetV1,
  EditEvaluationPlanErrorV1,
  EVALUATION_LANE_ORDER_V1,
} from './evaluation/evaluation-plans.js'
export type {
  ActivatedEvaluationPlanSetV1,
  ActivatedEvaluationPlanV1,
  ActivatedObservationMasksV1,
} from './evaluation/evaluation-plans.js'

export {
  editExternalEvidenceRequiredGateSha256V1,
  editStagedExternalEvidenceResultSha256V1,
  evaluationProvenanceChainSha256V1,
  EXTERNAL_EVIDENCE_DEADLINE_DEFAULT_MS,
  EXTERNAL_EVIDENCE_DEADLINE_MAXIMUM_MS,
} from './evaluation/evaluation-ports.js'

export { ProductionEditDeterministicEvaluationPortV1 } from './evaluation/production-evaluation.js'
export type {
} from './evaluation/production-evaluation.js'
export { structuralObjectiveObservationsV1 } from './evaluation/evaluation-structural.js'
export type {
  EditDeterministicEvaluationPort,
  EditEvaluationEvidenceProvenanceV1,
  EditDeterministicEvaluationRequestV1,
  EditDeterministicEvaluationResultV1,
  EditEvaluationEvidenceEntryV1,
  EditEvaluationPortsV1,
  EditExternalEvidenceNotificationV1,
  EditExternalEvidenceRequestArtifactV1,
  EditRuntimeIdentityPinningV1,
  EditStagedExternalEvidenceRecordV1,
} from './evaluation/evaluation-ports.js'

export {
  buildEditDiagnosticLineageTablesV1,
  buildEditRuntimeBindingTableV1,
  buildEditRuntimeLineageAssignmentV1,
} from './evaluation/runtime-evaluation-context.js'

export {
  buildEditEvaluationCertificateV1,
  certificateSetProjectionV1,
  certificateStandingV1,
  evaluateExportabilityV1,
} from './evaluation/evaluation-certificate.js'
export type {
  EditExportabilityV1,
  EditRetainedCertificateV1,
} from './evaluation/evaluation-certificate.js'

export {
  resolvePlannedNextIntentV1,
} from './transaction/planning.js'
export type {
} from './transaction/planning.js'

export {
  admittedEditAssetV1,
  EditAssetAdmissionErrorV1,
  retainedEditAssetRecordV1,
  SessionAssetStoreV1,
} from './assets/asset-admission.js'
export type {
  AdmittedEditAssetResolverV1,
  AdmittedEditAssetV1,
  AssetMaterializationLedgerV1,
  RetainedEditAssetRecordV1,
  SessionAssetRecordV1,
} from './assets/asset-admission.js'

export {
  assertPinnedGreenfieldTemplateIdentityV1,
  assertTemplateBackingFileIsNotAnOutputV1,
  buildGreenfieldTemplateArtifactV1,
  buildGreenfieldTemplateProjectJsonV1,
  greenfieldTemplateAssetsV1,
  greenfieldTemplateSourceIntakeV1,
  GREENFIELD_TEMPLATE_ID_V1,
  GREENFIELD_TEMPLATE_VERSION_V1,
  PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
  templateBackingIdentitiesV1,
} from './assets/greenfield-template.js'
export type {
} from './assets/greenfield-template.js'

export {
  isAuditKeyUnavailableErrorV1,
  isEditPublicationErrorV1,
  AUDIT_KEY_PURPOSE_V1,
  SYSTEM_EDIT_CLOCK,
} from './transaction/ports.js'
export type {
  AuditKeyMaterialV1,
  AuditKeyProviderPort,
  AuditKeyUnavailableErrorV1,
  EditArtifactEntryV1,
  EditArtifactIdentityV1,
  EditArtifactStorePort,
  EditRetainedResourceCatalogueInputV1,
  EditRetainedResourceCataloguePortV1,
  EditRetainedResourceMimeTypeV1,
  EditAssetHostProvenanceV1,
  EditAssetInputReadV1,
  EditClockPort,
  EditEntropyPort,
  EditPublicationCapabilityV1,
  EditPublicationCommitV1,
  EditPublicationDirectoryIdentityV1,
  EditPublicationPort,
  EditPublicationPreparedV1,
  EditPublicationRecoveryAuthorityV1,
  EditPublicationRecoveryPortV1,
  EditPublicationReservationV1,
  EditPublicationVerificationV1,
  HostInvocationContextV1,
} from './transaction/ports.js'

export {
  assertExportDestinationAllowedV1,
  deniedDestinationSetSha256V1,
  editExportGateSha256V1,
  editExportPreparedProofSha256V1,
  editExportProvenanceSha256V1,
  editExportReopenSha256V1,
  editExportSourcePreservationSha256V1,
  editPublicationProofSha256V1,
  editSemanticExportReceiptSha256V1,
  isEditPublicationCapabilityReadyV1,
  isPreparedPublicationBoundV1,
  isPublicationCommitBoundV1,
  isPublicationDestinationBoundV1,
  isPublicationInspectionBoundV1,
  isPublicationReservationBoundV1,
  isPublicationVerificationBoundV1,
  samePublicationDirectoryIdentityV1,
  EditPublicationDenialError,
  EDIT_PUBLICATION_PROTOCOL_VERSION_V1,
} from './assets/publication.js'
export type {
  EditExportProvenanceV1,
  EditExportReopenEvidenceV1,
  EditSemanticExportReceiptV1,
} from './assets/publication.js'

export { EditSessionErrorV1 } from './session/session.js'
export { discoverEditCapabilityFactsV1 } from './session/session.js'
export type {
  EditApplyDomainResultV1,
  EditAssetAdmitDomainRequestV1,
  EditAssetAdmitDomainResultV1,
  EditAssetAdmitDomainSourceV1,
  EditBeginDomainResultV1,
  EditBeginOpeningRefusalV1,
  EditBeginSourceIdentityV1,
  EditEvaluateDomainResultV1,
  EditExportDomainResultV1,
  EditIdempotentOutcomeProjectionV1,
  EditInspectDomainItemV1,
  EditInspectDomainResultV1,
  EditRetainedCapabilityFactsV1,
  EditRetainedCollectionFactsV1,
  EditRetainedCollectionKindV1,
  EditRetainedInspectionFactsV1,
  EditRetainedOperationPlanningFactsV1,
  EditRetainedOutcomeFactsV1,
  EditRetainedStatusFactsV1,
  EditSessionTerminalEvidenceV1,
  EditRestoreDomainResultV1,
  EditSessionRegistryIdentityV1,
  EditSessionRegistryOptionsV1,
  EditStatusDomainResultV1,
  EditTransportOutcomeTargetV1,
  RetainedEditBeginAttemptAuthorityV1,
  RetainedEditBeginOpeningSessionV1,
  RetainedEditBeginOutcomeAuthorityV1,
} from './session/session.js'

export {
  sourceProvenanceEvidenceSha256V1,
  validateEditSourceIntakeV1,
} from './session/source-intake.js'
export type {
  EditSourceIntakeRecheckV1,
  EditSourceIntakeV1,
  EditSourceProvenanceV1,
} from './session/source-intake.js'

export * from './session/transport-contract.js'

type PublicEditKernelStateV1 =
  | 'opening'
  | 'active'
  | 'recovery-required'
  | 'interrupted'
  | 'closed-abandoned'
  | 'closed-unexported'
  | 'closed-exported'
  | 'failed-infrastructure'

interface EditBudgetProjectionV1
{
  readonly artifactBytesUsed: number
  readonly impactUsed: number
  readonly intentUsed: number
  readonly restoreReserveHeld: boolean
  readonly acceptedOperations: number
  readonly acceptedRevisions: number
  readonly rejectedAttempts: number
  readonly retainedPreviews: number
  readonly checkpoints: number
}

interface EditPreviewRecordV1
{
  readonly previewId: string
  readonly requestId: string
  readonly requestSha256: string
  readonly createdSequence: number
  readonly expectedHead: HeadProjectionV1
  readonly capabilitySnapshotSha256: string
  readonly operationCount: number
  readonly predictedCandidateSha256: string
  readonly predictedCandidateByteLength: number
  readonly predictedProjectJsonSha256: string
  readonly predictedAssetManifestSha256: string
  readonly resolvedSemanticBatchSha256: string
  readonly resolvedPlanSha256: string
  readonly deltaSha256: string
  readonly cumulativeDeltaSha256: string
  readonly preservationSha256: string
  readonly authorizationSha256: string
  readonly diagnosticsSha256: string
  readonly allocatorSha256: string
  readonly activeLineageSha256: string
  readonly lineageHistorySha256: string
  readonly operationResultSetSha256: string
  readonly operationResultLineageCorrespondenceSha256: string
  readonly applyGuardSha256: string
  readonly operationResults: readonly unknown[]
  // the contract projection a tool answers w/; the raw records above stay
  // the kernel's own hashed evidence
  readonly operationResultSummaries: readonly OperationResultSummaryV1[]
  readonly state: 'unapplied' | 'applied' | 'invalidated' | 'evicted'
}

export interface EditPreviewResultV1
{
  readonly preview: EditPreviewRecordV1
  readonly budget: EditBudgetProjectionV1
  readonly eventSha256: string
}

export interface EditCheckpointResultV1
{
  readonly checkpointId: string
  readonly label: string
  readonly note?: string
  readonly revision: ExactRevisionIdentityV1
  readonly eventSha256: string
  readonly checkpointSha256: string
}

export interface EditCloseDomainResultV1
{
  readonly terminalState: 'closed-unexported'
  readonly head: HeadProjectionV1
  readonly eventSha256: string
  readonly reportSha256: string
  readonly retentionProofSha256: string
}

interface EditEvaluationUnavailableResultV1
{
  readonly state: 'unavailable'
  readonly eventSha256: string
  readonly reportSha256: string
}

export interface EditSessionLifecycleV1
{
  readonly sessionId: string
  readonly state: PublicEditKernelStateV1
  readonly head: HeadProjectionV1
  readonly semanticSourceSha256: string
  status(invocation: HostInvocationContextV1): Promise<EditStatusDomainResultV1>
  admitAsset(
    request: EditAssetAdmitDomainRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditAssetAdmitDomainResultV1>
  lookupIdempotentOutcomeV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
  }): EditIdempotentOutcomeProjectionV1 | null
  eventIdentityV1(
    eventSha256: string
  ): { readonly eventSha256: string; readonly sequence: number } | null
  retainedCapabilityFactsV1(): Promise<EditRetainedCapabilityFactsV1>
  retainedOutcomeFactsV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
    readonly invocationSha256: string
    readonly transportRequest: unknown
  }): EditRetainedOutcomeFactsV1 | null
  retainedTransportOutcomeTargetV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
    readonly invocationSha256: string
    readonly transportRequest: unknown
  }): Promise<EditTransportOutcomeTargetV1>
  retainedStatusFactsV1(): EditRetainedStatusFactsV1
  terminalEvidenceV1(): EditSessionTerminalEvidenceV1
  retainedCollectionFactsV1(
    kind: EditRetainedCollectionKindV1
  ): Promise<EditRetainedCollectionFactsV1>
  retainedInspectionFactsV1(input: {
    readonly revisionNumber?: number
    readonly revisionId?: string
    readonly issueHandles: boolean
    readonly entityKinds?: readonly EditInspectDomainItemV1['entityKind'][]
  }): Promise<EditRetainedInspectionFactsV1>
  retainedOperationPlanningFactsV1(
    query: OperationPlanningQueryV1
  ): Promise<EditRetainedOperationPlanningFactsV1>
  inspect(input: {
    readonly revisionNumber?: number
    readonly revisionId?: string
    readonly issueHandles: boolean
    readonly entityKinds?: readonly EditInspectDomainItemV1['entityKind'][]
  }): Promise<EditInspectDomainResultV1>
  sourceMediaAssetSourceV1(input: {
    readonly media: StandaloneMediaRefV1
    readonly expectedPayloadSha256: string
  }): Promise<Extract<EditAssetAdmitDomainSourceV1, { kind: 'sourceMedia' }>>
  preview(
    request: EditPreviewRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditPreviewResultV1>
  apply(
    request: EditApplyRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditApplyDomainResultV1>
  checkpoint(
    request: EditCheckpointRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditCheckpointResultV1>
  undo(
    request: EditUndoRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  rollback(
    request: EditRollbackRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  evaluate(
    request: EditEvaluateRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluateDomainResultV1>
  exportability(): EditExportabilityV1
  export(
    request: EditExportRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditExportDomainResultV1>
  recordEvaluationUnavailable(
    requestId: string,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluationUnavailableResultV1>
  close(
    request: EditCloseRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditCloseDomainResultV1>
}

export interface EditSessionRegistryLifecycleV1
{
  begin(
    request: EditBeginRequestV1,
    source: EditSourceIntakeV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  refuseBeginOpeningV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1,
    refusal: EditBeginOpeningRefusalV1
  ): Promise<never>
  lookupBeginOutcomeV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1
  ): EditIdempotentOutcomeProjectionV1 | null
  retainedBeginOutcomeV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1
  ): RetainedEditBeginOutcomeAuthorityV1 | null
  retainedBeginTransportOutcomeTargetV1(input: {
    readonly request: EditBeginRequestV1
    readonly sourceIdentity: EditBeginSourceIdentityV1
    readonly invocation: HostInvocationContextV1
  }): EditTransportOutcomeTargetV1
  session(sessionId: string): EditSessionLifecycleV1
  sessions(): readonly EditSessionLifecycleV1[]
}

// a transport must map a refusal to a stable code rather than let a bare
// TypeError escape, so this stays a TypeError for the direct-host callers that
// already catch one while carrying the refusal code a boundary can project
class EditRequestRefusalErrorV1 extends TypeError
{
  constructor(
    readonly code: RefusalCode,
    readonly tool: EditToolName,
    readonly issueCount: number,
    message: string
  )
  {
    super(message)
    this.name = 'EditRequestRefusalErrorV1'
  }
}

function exactToolRequest<Name extends EditToolName>(
  tool: Name,
  request: EditToolRequestForV1<Name>
): EditToolRequestForV1<Name>
{
  const parsed = parseEditToolInputV1(tool, request)
  if (!parsed.ok)
  {
    throw new EditRequestRefusalErrorV1(
      'edit.schema_failed',
      tool,
      parsed.issues.length,
      `${tool} request refused ${parsed.issues.length} exact contract issue(s)`
    )
  }
  return parsed.value
}

function previewHead(request: EditPreviewRequestV1): HeadProjectionV1
{
  const expected = request.batch.expected
  return {
    sourceArtifactSha256: expected.expectedSourceArtifactSha256,
    revisionNumber: expected.expectedRevisionNumber,
    revisionId: expected.expectedRevisionId,
    candidateSha256: expected.expectedCandidateSha256,
    assetManifestSha256: expected.expectedAssetManifestSha256,
    changeContractSha256: expected.expectedChangeContractSha256,
    capabilityProfileSha256: expected.expectedCapabilityProfileSha256,
    capabilitySnapshotSha256: expected.expectedCapabilitySnapshotSha256,
  }
}

function publicPreview(preview: EditKernelPreviewV1): EditPreviewRecordV1
{
  const { candidateCacheKey, canonicalTransaction, ...value } = preview
  void candidateCacheKey
  void canonicalTransaction
  return value
}

class EditSessionLifecycleFacadeV1 implements EditSessionLifecycleV1
{
  readonly #session: EditSessionV1

  constructor(session: EditSessionV1)
  {
    this.#session = session
  }

  get sessionId(): string
  {
    return this.#session.sessionId
  }

  get state(): PublicEditKernelStateV1
  {
    return this.#session.state
  }

  get head(): HeadProjectionV1
  {
    return this.#session.head
  }

  get semanticSourceSha256(): string
  {
    return this.#session.semanticSourceSha256
  }

  status(
    invocation: HostInvocationContextV1
  ): Promise<EditStatusDomainResultV1>
  {
    return this.#session.pollStatusV1(invocation)
  }

  admitAsset(
    request: EditAssetAdmitDomainRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditAssetAdmitDomainResultV1>
  {
    return this.#session.admitAsset(request, invocation)
  }

  lookupIdempotentOutcomeV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
  }): EditIdempotentOutcomeProjectionV1 | null
  {
    return this.#session.lookupIdempotentOutcomeV1(input)
  }

  eventIdentityV1(
    eventSha256: string
  ): { readonly eventSha256: string; readonly sequence: number } | null
  {
    return this.#session.eventIdentityV1(eventSha256)
  }

  retainedCapabilityFactsV1(): Promise<EditRetainedCapabilityFactsV1>
  {
    return this.#session.retainedCapabilityFactsV1()
  }

  retainedOutcomeFactsV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
    readonly invocationSha256: string
    readonly transportRequest: unknown
  }): EditRetainedOutcomeFactsV1 | null
  {
    return this.#session.retainedOutcomeFactsV1(input)
  }

  retainedTransportOutcomeTargetV1(input: {
    readonly toolName: string
    readonly requestId: string
    readonly principalSha256: string
    readonly invocationSha256: string
    readonly transportRequest: unknown
  }): Promise<EditTransportOutcomeTargetV1>
  {
    return this.#session.retainedTransportOutcomeTargetV1(input)
  }

  retainedStatusFactsV1(): EditRetainedStatusFactsV1
  {
    return this.#session.retainedStatusFactsV1()
  }

  terminalEvidenceV1(): EditSessionTerminalEvidenceV1
  {
    return this.#session.terminalEvidenceV1()
  }

  retainedCollectionFactsV1(
    kind: EditRetainedCollectionKindV1
  ): Promise<EditRetainedCollectionFactsV1>
  {
    return this.#session.retainedCollectionFactsV1(kind)
  }

  retainedInspectionFactsV1(input: {
    readonly revisionNumber?: number
    readonly revisionId?: string
    readonly issueHandles: boolean
    readonly entityKinds?: readonly EditInspectDomainItemV1['entityKind'][]
  }): Promise<EditRetainedInspectionFactsV1>
  {
    return this.#session.retainedInspectionFactsV1(input)
  }

  retainedOperationPlanningFactsV1(
    query: OperationPlanningQueryV1
  ): Promise<EditRetainedOperationPlanningFactsV1>
  {
    return this.#session.retainedOperationPlanningFactsV1(query)
  }

  inspect(input: {
    readonly revisionNumber?: number
    readonly revisionId?: string
    readonly issueHandles: boolean
  }): Promise<EditInspectDomainResultV1>
  {
    return this.#session.inspect(input)
  }

  sourceMediaAssetSourceV1(input: {
    readonly media: StandaloneMediaRefV1
    readonly expectedPayloadSha256: string
  }): Promise<Extract<EditAssetAdmitDomainSourceV1, { kind: 'sourceMedia' }>>
  {
    return this.#session.sourceMediaAssetSourceV1(input)
  }

  async preview(
    request: EditPreviewRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditPreviewResultV1>
  {
    const exact = exactToolRequest('edit_preview', request)
    this.#assertSession(exact.sessionId, 'edit_preview')
    const result = await this.#session.preview(
      {
        requestId: exact.requestId,
        expectedHead: previewHead(exact),
        canonicalTransaction: exact.batch,
        transportRequest: exact,
      },
      invocation
    )
    return {
      preview: publicPreview(result.preview),
      budget: result.budget,
      eventSha256: result.eventSha256,
    }
  }

  async apply(
    request: EditApplyRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditApplyDomainResultV1>
  {
    const exact = exactToolRequest('edit_apply', request)
    this.#assertSession(exact.sessionId, 'edit_apply')
    return this.#session.apply(exact, invocation)
  }

  async checkpoint(
    request: EditCheckpointRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditCheckpointResultV1>
  {
    const exact = exactToolRequest('edit_checkpoint', request)
    this.#assertSession(exact.sessionId, 'edit_checkpoint')
    return this.#session.checkpoint(exact, invocation)
  }

  async undo(
    request: EditUndoRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  {
    const exact = exactToolRequest('edit_undo', request)
    this.#assertSession(exact.sessionId, 'edit_undo')
    return this.#session.undo(exact, invocation)
  }

  async rollback(
    request: EditRollbackRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditRestoreDomainResultV1>
  {
    const exact = exactToolRequest('edit_rollback', request)
    this.#assertSession(exact.sessionId, 'edit_rollback')
    return this.#session.rollback(exact, invocation)
  }

  async evaluate(
    request: EditEvaluateRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluateDomainResultV1>
  {
    const exact = exactToolRequest('edit_evaluate', request)
    this.#assertSession(exact.sessionId, 'edit_evaluate')
    return this.#session.evaluate(exact, invocation)
  }

  exportability(): EditExportabilityV1
  {
    return this.#session.exportability()
  }

  async export(
    request: EditExportRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditExportDomainResultV1>
  {
    const exact = exactToolRequest('edit_export', request)
    this.#assertSession(exact.sessionId, 'edit_export')
    return this.#session.export(exact, invocation)
  }

  recordEvaluationUnavailable(
    requestId: string,
    invocation: HostInvocationContextV1
  ): Promise<EditEvaluationUnavailableResultV1>
  {
    return this.#session.recordEvaluationUnavailable(requestId, invocation)
  }

  async close(
    request: EditCloseRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditCloseDomainResultV1>
  {
    const exact = exactToolRequest('edit_close', request)
    this.#assertSession(exact.sessionId, 'edit_close')
    return this.#session.close(exact, invocation)
  }

  #assertSession(sessionId: string, tool: EditToolName): void
  {
    if (sessionId !== this.sessionId)
      throw new EditRequestRefusalErrorV1(
        'edit.session_not_found',
        tool,
        1,
        `${tool} request names a different session`
      )
  }
}

class EditSessionRegistryLifecycleFacadeV1 implements EditSessionRegistryLifecycleV1
{
  readonly #registry: ReturnType<
    typeof createInternalEditSessionRegistryForExecutorV1
  >

  constructor(options: EditSessionRegistryOptionsV1)
  {
    this.#registry = createInternalEditSessionRegistryForExecutorV1(
      options,
      new ProductionTransactionExecutorV1()
    )
  }

  begin(
    request: EditBeginRequestV1,
    source: EditSourceIntakeV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  {
    return this.#registry.begin(
      exactToolRequest('edit_begin', request),
      source,
      invocation
    )
  }

  refuseBeginOpeningV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1,
    refusal: EditBeginOpeningRefusalV1
  ): Promise<never>
  {
    return this.#registry.refuseBeginOpeningV1(
      exactToolRequest('edit_begin', request),
      sourceIdentity,
      invocation,
      refusal
    )
  }

  lookupBeginOutcomeV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1
  ): EditIdempotentOutcomeProjectionV1 | null
  {
    return this.#registry.lookupBeginOutcomeV1(
      exactToolRequest('edit_begin', request),
      sourceIdentity,
      invocation
    )
  }

  retainedBeginOutcomeV1(
    request: EditBeginRequestV1,
    sourceIdentity: EditBeginSourceIdentityV1,
    invocation: HostInvocationContextV1
  ): RetainedEditBeginOutcomeAuthorityV1 | null
  {
    return this.#registry.retainedBeginOutcomeV1(
      exactToolRequest('edit_begin', request),
      sourceIdentity,
      invocation
    )
  }

  retainedBeginTransportOutcomeTargetV1(input: {
    readonly request: EditBeginRequestV1
    readonly sourceIdentity: EditBeginSourceIdentityV1
    readonly invocation: HostInvocationContextV1
  }): EditTransportOutcomeTargetV1
  {
    return this.#registry.retainedBeginTransportOutcomeTargetV1({
      request: exactToolRequest('edit_begin', input.request),
      sourceIdentity: input.sourceIdentity,
      invocation: input.invocation,
    })
  }

  session(sessionId: string): EditSessionLifecycleV1
  {
    return new EditSessionLifecycleFacadeV1(this.#registry.session(sessionId))
  }

  sessions(): readonly EditSessionLifecycleV1[]
  {
    return this.#registry
      .sessions()
      .map((session) => new EditSessionLifecycleFacadeV1(session))
  }
}

export function createEditSessionRegistryV1(
  options: EditSessionRegistryOptionsV1
): EditSessionRegistryLifecycleV1
{
  return new EditSessionRegistryLifecycleFacadeV1(options)
}

interface ReplayEditSessionOptionsV1
{
  readonly artifactStore: EditArtifactStorePort
  readonly sessionKey: string
  readonly boundChangeContract: BoundChangeContractV1
}

export interface ReplayEditSessionResultV1
{
  readonly ok: boolean
  readonly sessionId: string
  readonly state:
    | 'interrupted'
    | 'recovery-required'
    | 'closed-abandoned'
    | 'closed-unexported'
    | 'closed-exported'
  readonly verifiedRevisionCount: number
  readonly verifiedEventCount: number
  readonly verifiedReportCount: number
  readonly verifiedCertificateCount: number
  readonly verifiedExportCount: number
  readonly publishedSha256: string | null
  readonly exportReceiptSha256: string | null
  readonly reconstructedExternalObservations: number
  readonly reportComplete: boolean
  readonly finalHead: HeadProjectionV1
  readonly eventHeadSha256: string
  readonly historySha256: string
  readonly semanticReportSha256: string
  readonly terminalEvidence: EditSessionTerminalEvidenceV1
  readonly failures: readonly string[]
}

export function replayEditSessionV1(
  options: ReplayEditSessionOptionsV1
): Promise<ReplayEditSessionResultV1>
{
  return verifyInternalEditSessionReplayV1({
    ...options,
    transactionExecutor: new ProductionTransactionExecutorV1(),
  })
}
