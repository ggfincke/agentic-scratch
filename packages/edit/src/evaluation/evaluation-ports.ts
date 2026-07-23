// packages/edit/src/evaluation/evaluation-ports.ts
// injected host ports for deterministic evaluation lanes & external native evidence

import { editCanonicalSha256V1 } from '../support/canonical.js'

import type { ActivatedEvaluationPlanV1 } from './evaluation-plans.js'
import type {
  EditCandidateObservationV1,
  EditDiagnosticEvidenceV1,
  EditDiagnosticLineageV1,
  EditEvaluationMatrixCellV1,
  EditLaneStatusV1,
  EditPreservationLensObservationV1,
  EditRuntimeBindingTableV1,
  EditRuntimeLineageAssignmentV1,
  EditRuntimeProjectionAuthorizationsV1,
} from '@scratch-agent/eval'
import type {
  EditScenarioPolicyV1,
  EditSemanticSourceIdentityHashProjectionV1,
  EvaluationEvidenceSemanticBindingV1,
  ExactRevisionIdentityV1,
  RetainedPolicyBindingV1,
  RuntimePredicateV1,
  RunnerAvailabilityV1,
} from '@scratch-agent/ir/edit'

// the kernel never imports a VM, a browser, or a version table; every runtime
// pinning fact arrives as an opaque digest the port is responsible for deriving
export interface EditRuntimeIdentityPinningV1
{
  readonly vmIdentitySha256: string
  readonly browserIdentitySha256: string
  readonly runtimeIdentitySha256: string
  readonly pinnedScratchIdentitySha256: string
  readonly buildIdentitySha256: string
  readonly executableIdentitySha256: string
}

export interface EditEvaluationEvidenceEntryV1
{
  readonly binding: EvaluationEvidenceSemanticBindingV1
  readonly contentSha256: string
}

export interface EditEvaluationEvidenceArtifactIndexEntryV1
{
  readonly payloadSha256: string
  readonly byteLength: number
  readonly mediaType: string
  readonly contentSha256: string | null
  readonly evidenceKind:
    'structuredState' | 'runtimeTrace' | 'screenshot' | 'video' | null
  readonly lane: EvaluationEvidenceSemanticBindingV1['lane'] | null
  readonly side?: 'baseline' | 'candidate'
  readonly scenarioId?: string
}

export interface EditEvaluationEvidencePayloadV1 extends EditEvaluationEvidenceArtifactIndexEntryV1
{
  readonly bytes: Uint8Array
}

export interface EditDeterministicEvaluationRequestV1
{
  readonly evaluationId: string
  readonly plan: ActivatedEvaluationPlanV1
  readonly revision: ExactRevisionIdentityV1
  readonly semanticSourceIdentity: EditSemanticSourceIdentityHashProjectionV1
  readonly semanticSourceSha256: string
  readonly changeContractSha256: string
  readonly historySha256: string
  readonly matrixSha256: string
  readonly candidateBytes: Uint8Array
  readonly baselineBytes: Uint8Array
  readonly baselineRuntime: EditDeterministicRuntimeContextV1
  readonly candidateRuntime: EditDeterministicRuntimeContextV1
  readonly runtimeProjectionAuthorizations: EditRuntimeProjectionAuthorizationsV1
  readonly policies: readonly EditDeterministicPolicyArtifactV1[]
}

interface EditDeterministicRuntimeContextV1
{
  readonly assignment: EditRuntimeLineageAssignmentV1
  readonly bindings: EditRuntimeBindingTableV1
  readonly diagnosticLineage?: Omit<EditDiagnosticLineageV1, 'revisionIdentity'>
}

interface EditDeterministicPolicyArtifactV1
{
  readonly binding: RetainedPolicyBindingV1
  readonly canonicalByteLength: number
  readonly canonicalJson: string
  readonly value: unknown
  readonly scenarioPolicy?: EditScenarioPolicyV1
}

// one immutable bounded request artifact for a native-agent judgment; it carries
// evidence identities only, never a path, a prompt, or a provider handle
export interface EditExternalEvidenceRequestArtifactV1
{
  readonly requestArtifactId: string
  readonly objectiveId: string
  readonly lane:
    | 'officialBrowser'
    | 'turboWarpBrowser'
    | 'renderedDifferential'
    | 'nativeVisual'
  readonly requestSha256: string
  readonly semanticProjection: Readonly<Record<string, unknown>>
  readonly evidenceContentSha256s: readonly string[]
  readonly matrixCells: readonly EditEvaluationMatrixCellV1[]
  readonly producerLanes: readonly ('officialBrowser' | 'turboWarpBrowser')[]
  readonly evidenceSelections: readonly {
    readonly cell: EditEvaluationMatrixCellV1
    readonly evidenceContentSha256: string
    readonly selectedPayloadSha256s: readonly string[]
  }[]
  readonly evidenceWindow?: Extract<
    RuntimePredicateV1,
    { kind: 'visualCriterion' }
  >['evidenceWindow']
  readonly predicateSha256?: string
}

export function editExternalEvidenceRequestSemanticProjectionV1(
  input: EditExternalEvidenceRequestArtifactV1
): Omit<EditExternalEvidenceRequestArtifactV1, 'requestArtifactId'>
{
  return Object.freeze({
    objectiveId: input.objectiveId,
    lane: input.lane,
    requestSha256: input.requestSha256,
    semanticProjection: structuredClone(input.semanticProjection),
    evidenceContentSha256s: Object.freeze([...input.evidenceContentSha256s]),
    matrixCells: Object.freeze(input.matrixCells.map((cell) => ({ ...cell }))),
    producerLanes: Object.freeze([...input.producerLanes]),
    evidenceSelections: Object.freeze(
      input.evidenceSelections.map((selection) => ({
        cell: { ...selection.cell },
        evidenceContentSha256: selection.evidenceContentSha256,
        selectedPayloadSha256s: Object.freeze([
          ...selection.selectedPayloadSha256s,
        ]),
      }))
    ),
    ...(input.evidenceWindow === undefined
      ? {}
      : { evidenceWindow: { ...input.evidenceWindow } }),
    ...(input.predicateSha256 === undefined
      ? {}
      : { predicateSha256: input.predicateSha256 }),
  })
}

export function editExternalEvidenceRequiredGateSha256V1(input: {
  readonly requestSha256: string
}): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'external-evidence-required-gate',
    requestSha256: input.requestSha256,
  })
}

export interface EditDeterministicEvaluationResultV1
{
  readonly identity: EditRuntimeIdentityPinningV1
  readonly laneStatuses: readonly EditLaneStatusV1[]
  readonly candidateObservations: readonly EditCandidateObservationV1[]
  readonly preservationObservations: readonly EditPreservationLensObservationV1[]
  readonly baselineDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly candidateDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly allowedNewDiagnosticFingerprints: readonly string[]
  readonly boundedResourceIssueCodes: readonly string[]
  readonly evidence: readonly EditEvaluationEvidenceEntryV1[]
  readonly evidenceArtifactIndex: readonly EditEvaluationEvidenceArtifactIndexEntryV1[]
  readonly projectJsonSha256: string
  readonly evaluatedCandidateByteLength: number
  readonly fixedTimePolicySha256: string
  readonly seedSetSha256: string
  readonly externalRequests: readonly EditExternalEvidenceRequestArtifactV1[]
  readonly limitations: readonly string[]
}

export interface EditDeterministicEvaluationExecutionV1
{
  readonly result: EditDeterministicEvaluationResultV1
  readonly evidencePayloads: readonly EditEvaluationEvidencePayloadV1[]
}

// deterministic lanes only; this port is called inside the transition lock &
// must never wait on a human, a model, or a network judgment
export interface EditDeterministicEvaluationPort
{
  runnerAvailabilityV1(): readonly RunnerAvailabilityV1[]
  evaluate(
    request: EditDeterministicEvaluationRequestV1
  ): Promise<EditDeterministicEvaluationExecutionV1>
}

export interface EditExternalEvidenceNotificationV1
{
  readonly evaluationId: string
  readonly requestArtifactIds: readonly string[]
  readonly deadlineEpochMs: number
  readonly notificationSha256: string
}

// ! the port receives immutable artifact IDs & a deadline, nothing else: no
// ! credentials, no raw judgment submission, & no synchronous result path
interface EditExternalEvidencePort
{
  enqueue(notification: EditExternalEvidenceNotificationV1): Promise<void>
  cancel(evaluationId: string, reason: string): Promise<void>
}

export interface EditStagedExternalEvidenceRecordV1
{
  readonly recordId: string
  readonly evaluationId: string
  readonly requestArtifactId: string
  readonly objectiveId: string
  readonly lane: EditExternalEvidenceRequestArtifactV1['lane']
  readonly requestSha256: string
  readonly resultSha256: string
  readonly contentSha256: string
  readonly satisfied: boolean
  readonly judgmentSha256: string
  readonly provenance: EditEvaluationEvidenceProvenanceV1
}

export function editStagedExternalEvidenceResultSha256V1(
  input: Pick<
    EditStagedExternalEvidenceRecordV1,
    | 'evaluationId'
    | 'requestArtifactId'
    | 'objectiveId'
    | 'lane'
    | 'requestSha256'
    | 'contentSha256'
    | 'satisfied'
    | 'judgmentSha256'
  >
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'staged-external-evidence-result',
    objectiveId: input.objectiveId,
    lane: input.lane,
    requestSha256: input.requestSha256,
    contentSha256: input.contentSha256,
    satisfied: input.satisfied,
    judgmentSha256: input.judgmentSha256,
  })
}

// host-only inbox; records reaching it are already validated & bound by the
// native-agent audit boundary, so finalize revalidates bindings, not content
interface EditExternalEvidenceInboxPort
{
  staged(
    evaluationId: string
  ): Promise<readonly EditStagedExternalEvidenceRecordV1[]>
}

export interface EditEvaluationPortsV1
{
  readonly deterministic: EditDeterministicEvaluationPort
  readonly external?: EditExternalEvidencePort
  readonly inbox?: EditExternalEvidenceInboxPort
  readonly externalEvidenceDeadlineMs?: number
}

// V1 default 20 minutes, hard maximum 60, exactly as the host retention policy
// pins it; a plan may not widen the maximum
export const EXTERNAL_EVIDENCE_DEADLINE_DEFAULT_MS = 20 * 60 * 1000
export const EXTERNAL_EVIDENCE_DEADLINE_MAXIMUM_MS = 60 * 60 * 1000

export function assertExternalEvidenceDeadlineV1(
  ports: EditEvaluationPortsV1 | null | undefined
): void
{
  const deadline = ports?.externalEvidenceDeadlineMs
  if (deadline === undefined) return
  if (
    !Number.isSafeInteger(deadline) ||
    deadline < 1 ||
    deadline > EXTERNAL_EVIDENCE_DEADLINE_MAXIMUM_MS
  )
    throw new TypeError(
      'external evidence deadline must be a positive safe integer within the Phase 8 maximum'
    )
}

// host-side cross-link from one semantic evidence hash to the host facts that
// produced it: absolute locators, capture times, host record & task IDs

// * deliberately an edit-internal record, not an A0-annex contract type: every
// * field here is one the frozen surface excludes on purpose, & the certificate
// * hash must reproduce w/o any of it

// follows the EditAssetHostProvenanceV1 & EditSourceProvenanceV1 precedent -
// host records verified at replay while staying outside the contract
export interface EditEvaluationEvidenceProvenanceV1
{
  readonly schemaVersion: 1
  readonly evaluationId: string
  readonly hostRecordId: string
  readonly taskId: string | null
  readonly contentSha256: string
  readonly requestSha256: string
  readonly resultSha256: string
  readonly absoluteLocator: string
  readonly capturedAtEpochMs: number
  readonly auditRecordSha256: string
}

// the provenance chain is verified separately from the certificate: a replay
// under a fresh run directory rebuilds this chain w/ new IDs & locators while
// the certificate hash stays byte-identical
export function evaluationProvenanceChainSha256V1(
  entries: readonly EditEvaluationEvidenceProvenanceV1[]
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'evaluation-evidence-provenance-chain',
    entries: [...entries].sort((left, right) =>
      left.contentSha256 < right.contentSha256 ? -1 : 1
    ),
  })
}
