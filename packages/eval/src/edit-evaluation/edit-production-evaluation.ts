// packages/eval/src/edit-evaluation/edit-production-evaluation.ts
// execute the exact-byte deterministic evaluation matrix

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  EditEvaluationPlanV1,
  EditSemanticSourceIdentityHashProjectionV1,
  EditScenarioPolicyV1,
  EvaluationEvidenceSemanticBindingV1,
  ExactRevisionIdentityV1,
  PreservationLensV1,
  RetainedPolicyBindingV1,
  RuntimePredicateV1,
} from '@scratch-agent/ir/edit'
import {
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
} from '@scratch-agent/ir/edit'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import {
  decodeRuntimePngRgbaV1,
  hashObservationPlan,
  MAX_RUNTIME_OBSERVATION_CAPS,
  RUN_ISSUE_CODES,
  runIdentityBoundBrowserScenario,
  runIdentityBoundScenario,
  validateObservationPlan,
  type BrowserTrace,
  type IdentityBoundActionRecordV1,
  type IdentityBoundDriveResultV1,
  type ObservationPlanV1,
  type ObservedRuntimeScalarV1,
  type ObservedRuntimeExecutionObservationV1,
  type RuntimeDescriptorV1,
  type RuntimeIdentityFacetV1,
  type RuntimeObservationCapsV1,
  type RuntimeObservationRecordV1,
  type VmTrace,
} from '@scratch-agent/runner'

import { inspectSemanticEditArtifact } from '../artifacts/artifact-preflight.js'
import { sha256 } from '../core/sha256.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'
import type { EditBoundedRuntimeObservationV1 } from './edit-bounded-observation.js'
import {
  bindEditDiagnosticFailureV1,
  editDiagnosticDeclarationKeyV1,
  type EditDiagnosticEvidenceV1,
  type EditDiagnosticLineageV1,
} from './edit-diagnostics.js'
import {
  editEvaluationEvidenceBindingV1,
  wrapEditEvaluationEvidenceV1,
  type EditEvaluationRevisionBindingV1,
} from './edit-evaluation-evidence.js'
import {
  reserveEditEvaluationMatrixV1,
  type EditEvaluationLaneV1,
  type EditEvaluationMatrixCellV1,
} from './edit-evaluation-matrix.js'
import type {
  EditCandidateObservationV1,
  EditCandidateObservedValueV1,
  EditLaneStatusV1,
  EditPreservationLensObservationV1,
} from './edit-evaluation-aggregate.js'
import {
  editPreservationLensRowSha256V1,
  editRuntimePredicateRowSha256V1,
} from './edit-evaluation-aggregate.js'
import { editDecodedRgbaSha256V1 } from './edit-projection-mask.js'
import type {
  EditProjectionNameTransitionV1,
  EditRuntimeProjectionInputV1,
  EditRuntimeIdentityFacetV1,
  EditTargetMembershipAuthorizationV1,
} from './edit-projection-mask.js'
import {
  bindEditRuntimeArtifactV1,
  editRuntimeHashV1,
  lowerEditScenarioPolicyV1,
  type EditLoweredScenarioV1,
  type EditRuntimeArtifactBindingV1,
  type EditRuntimeBindingTableV1,
  type EditRuntimeLineageAssignmentV1,
} from './edit-scenario-lowering.js'
import { evaluateEditBehavioralDifferentialV1 } from './edit-runtime-projection.js'
import { validateBehavioralLensSpecs } from '../multimodal/lens-validation.js'

export const EDIT_IDENTITY_BOUND_ACTION_INCONCLUSIVE_CODE_V1 =
  RUN_ISSUE_CODES.identityBoundActionInconclusive

export function editObservationPlanSha256V1(plan: ObservationPlanV1): string
{
  return hashObservationPlan(plan)
}
import type { BehavioralLensSpecV1 } from '../multimodal/lenses.js'

const MAX_CERTIFICATE_EVIDENCE_ENTRIES_V1 = 128

export interface EditProductionPolicyArtifactV1
{
  readonly binding: RetainedPolicyBindingV1
  readonly canonicalByteLength: number
  readonly canonicalJson: string
  readonly value: unknown
  readonly scenarioPolicy?: EditScenarioPolicyV1
}

interface EditProductionRuntimeContextV1
{
  readonly assignment: EditRuntimeLineageAssignmentV1
  readonly bindings: EditRuntimeBindingTableV1
  readonly diagnosticLineage?: Omit<EditDiagnosticLineageV1, 'revisionIdentity'>
}

interface EditProductionActivatedPlanV1
{
  readonly plan: EditEvaluationPlanV1
  readonly evaluationPlanSha256: string
  readonly resourceLimitOverrides: Readonly<Record<string, number>>
  readonly masks: {
    readonly state: readonly import('@scratch-agent/ir/edit').StateProjectionMaskV1[]
    readonly clone: readonly import('@scratch-agent/ir/edit').CloneProjectionMaskV1[]
    readonly visual: readonly import('@scratch-agent/ir/edit').VisualProjectionMaskV1[]
  }
}

export interface EditProductionEvaluationRequestV1
{
  readonly evaluationId: string
  readonly plan: EditProductionActivatedPlanV1
  readonly revision: ExactRevisionIdentityV1
  readonly semanticSourceIdentity?: EditSemanticSourceIdentityHashProjectionV1
  readonly semanticSourceSha256: string
  readonly changeContractSha256: string
  readonly historySha256: string
  readonly matrixSha256: string
  readonly candidateBytes: Uint8Array
  readonly baselineBytes: Uint8Array
  readonly baselineRuntime: EditProductionRuntimeContextV1
  readonly candidateRuntime: EditProductionRuntimeContextV1
  readonly policies: readonly EditProductionPolicyArtifactV1[]
  readonly projectionAuthority: EditProductionProjectionAuthorityV1
}

interface EditProductionProjectionAuthorityV1
{
  readonly nameTransitions: readonly EditProjectionNameTransitionV1[]
  readonly targetMembershipAuthorizations: readonly EditTargetMembershipAuthorizationV1[]
}

interface EditDecodedRuntimeCellPolicyV1
{
  readonly lane: 'officialHeadless' | 'officialBrowser' | 'turboWarpBrowser'
  readonly scenarioId: string
  readonly observationPlan: ObservationPlanV1
  readonly observationCaps: RuntimeObservationCapsV1
}

interface EditDecodedRuntimePolicyV1
{
  readonly cells: readonly EditDecodedRuntimeCellPolicyV1[]
  readonly allowedNewDiagnosticFingerprints: readonly string[]
}

export interface EditProductionPolicyDecoderV1
{
  decodeRuntimePolicy(
    artifact: EditProductionPolicyArtifactV1,
    artifacts: ReadonlyMap<string, EditProductionPolicyArtifactV1>
  ): EditDecodedRuntimePolicyV1
  decodeLensPolicy(
    artifact: EditProductionPolicyArtifactV1,
    lens: PreservationLensV1,
    artifacts: ReadonlyMap<string, EditProductionPolicyArtifactV1>
  ): BehavioralLensSpecV1
}

export class EditProductionEvaluationErrorV1 extends Error
{
  constructor(
    readonly reason: string,
    message: string
  )
  {
    super(message)
    this.name = 'EditProductionEvaluationErrorV1'
  }
}

function unsupportedPolicy(kind: string): never
{
  throw new EditProductionEvaluationErrorV1(
    'policy-decoder-unavailable',
    `no frozen decoder is configured for retained ${kind} policy artifacts`
  )
}

const STRICT_FROZEN_EDIT_EVALUATION_POLICY_DECODER_V1: EditProductionPolicyDecoderV1 =
  Object.freeze({
    decodeRuntimePolicy: () => unsupportedPolicy('runtime'),
    decodeLensPolicy: () => unsupportedPolicy('lens'),
  })

interface EditProductionRuntimeIdentityV1
{
  readonly vmIdentitySha256: string
  readonly browserIdentitySha256: string
  readonly runtimeIdentitySha256: string
  readonly pinnedScratchIdentitySha256: string
  readonly buildIdentitySha256: string
  readonly executableIdentitySha256: string
}

interface EditProductionEvidenceEntryV1
{
  readonly binding: EvaluationEvidenceSemanticBindingV1
  readonly contentSha256: string
}

interface EditProductionExternalRequestV1
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

interface EditProductionEvaluationResultV1
{
  readonly identity: EditProductionRuntimeIdentityV1
  readonly laneStatuses: readonly EditLaneStatusV1[]
  readonly candidateObservations: readonly EditCandidateObservationV1[]
  readonly preservationObservations: readonly EditPreservationLensObservationV1[]
  readonly baselineDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly candidateDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly allowedNewDiagnosticFingerprints: readonly string[]
  readonly boundedResourceIssueCodes: readonly string[]
  readonly evidence: readonly EditProductionEvidenceEntryV1[]
  readonly evidenceArtifactIndex: readonly EditProductionEvidenceArtifactIndexEntryV1[]
  readonly evidencePayloads: readonly EditProductionEvidencePayloadV1[]
  readonly projectJsonSha256: string
  readonly evaluatedCandidateByteLength: number
  readonly fixedTimePolicySha256: string
  readonly seedSetSha256: string
  readonly externalRequests: readonly EditProductionExternalRequestV1[]
  readonly limitations: readonly string[]
}

export interface EditProductionReplayMediaV1
{
  readonly evidenceKind: 'screenshot' | 'video'
  readonly mediaType: 'image/png' | 'video/webm'
  readonly payloadSha256: string
  readonly byteLength: number
  readonly bytes: Uint8Array
  readonly frameId?: string
  readonly width?: number
  readonly height?: number
}

export interface EditProductionExternalSelectionSourceV1
{
  readonly cell: EditEvaluationMatrixCellV1
  readonly evidenceContentSha256: string
  readonly frames: readonly {
    readonly payloadSha256: string
    readonly frameId: string
    readonly tick: number
    readonly snapshotLabel: string | null
  }[]
}

export interface EditProductionDeterministicAuthorityV1
{
  readonly schemaVersion: 1
  readonly runtimePolicy:
    | { readonly status: 'decoded'; readonly value: EditDecodedRuntimePolicyV1 }
    | { readonly status: 'refused'; readonly reason: string }
  readonly lensPolicies: readonly EditProductionLensPolicyAuthorityV1[]
  readonly projectedDifferentials: readonly {
    readonly lensIndex: number
    readonly evidence: unknown | null
  }[]
  readonly limitations: readonly string[]
}

interface EditProductionDeterministicRederivationV1
{
  readonly identity: EditProductionRuntimeIdentityV1
  readonly laneStatuses: readonly EditLaneStatusV1[]
  readonly candidateObservations: readonly EditCandidateObservationV1[]
  readonly preservationObservations: readonly EditPreservationLensObservationV1[]
  readonly baselineDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly candidateDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly allowedNewDiagnosticFingerprints: readonly string[]
  readonly boundedResourceIssueCodes: readonly string[]
  readonly fixedTimePolicySha256: string
  readonly seedSetSha256: string
  readonly limitations: readonly string[]
}

interface EditProductionEvidenceArtifactIndexEntryV1
{
  readonly payloadSha256: string
  readonly byteLength: number
  readonly mediaType: string
  readonly contentSha256: string | null
  readonly evidenceKind:
    'structuredState' | 'runtimeTrace' | 'screenshot' | 'video' | null
  readonly lane: EditEvaluationLaneV1 | null
  readonly side?: 'baseline' | 'candidate'
  readonly scenarioId?: string
}

interface EditProductionEvidencePayloadV1 extends EditProductionEvidenceArtifactIndexEntryV1
{
  readonly bytes: Uint8Array
}

function fail(reason: string, message: string): never
{
  throw new EditProductionEvaluationErrorV1(reason, message)
}

function sameValue(left: unknown, right: unknown): boolean
{
  return (
    editRuntimeHashV1('edit-production-policy-value', left) ===
    editRuntimeHashV1('edit-production-policy-value', right)
  )
}

function preflightProjection(
  side: 'baseline' | 'candidate',
  preflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>
): unknown
{
  return {
    side,
    ok: preflight.ok,
    semanticSourceSha256: preflight.semanticSourceSha256,
    semanticSourceIdentity: preflight.semanticSourceIdentity,
    graph: preflight.graph,
    static: preflight.static,
    refusal: preflight.refusal,
    completedStages: preflight.completedStages,
  }
}

function policyMap(
  policies: readonly EditProductionPolicyArtifactV1[]
): ReadonlyMap<string, EditProductionPolicyArtifactV1>
{
  const result = new Map<string, EditProductionPolicyArtifactV1>()
  for (const artifact of policies)
  {
    const bytes = new TextEncoder().encode(artifact.canonicalJson)
    if (
      bytes.byteLength !== artifact.canonicalByteLength ||
      sha256(bytes) !== artifact.binding.retainedArtifactSha256
    )
      fail(
        'policy-content-mismatch',
        `retained policy ${artifact.binding.bindingId} does not match its exact canonical bytes`
      )
    let parsed: unknown
    try
    {
      parsed = JSON.parse(artifact.canonicalJson)
    }
    catch
    {
      fail(
        'policy-content-invalid',
        `retained policy ${artifact.binding.bindingId} is not canonical JSON`
      )
    }
    if (!sameValue(parsed, artifact.value))
      fail(
        'policy-content-mismatch',
        `retained policy ${artifact.binding.bindingId} value differs from its canonical bytes`
      )
    if (
      artifact.binding.kind === 'scenario' &&
      (artifact.scenarioPolicy === undefined ||
        scenarioPolicyValueSemanticSha256V1(artifact.scenarioPolicy) !==
          artifact.binding.semanticSha256)
    )
      fail(
        'scenario-policy-mismatch',
        `retained scenario policy ${artifact.binding.bindingId} differs from its semantic identity`
      )
    if (result.has(artifact.binding.semanticSha256))
      fail(
        'policy-binding-duplicate',
        `semantic policy ${artifact.binding.semanticSha256} resolves more than once`
      )
    result.set(artifact.binding.semanticSha256, artifact)
  }
  return result
}

function requiredPolicy(
  policies: ReadonlyMap<string, EditProductionPolicyArtifactV1>,
  semanticSha256: string,
  kind: RetainedPolicyBindingV1['kind']
): EditProductionPolicyArtifactV1
{
  const artifact = policies.get(semanticSha256)
  if (artifact === undefined)
    fail(
      'policy-binding-missing',
      `referenced ${kind} policy ${semanticSha256} is unavailable`
    )
  if (
    artifact.binding.kind !== kind ||
    artifact.binding.semanticSha256 !== semanticSha256
  )
    fail(
      'policy-binding-kind',
      `policy ${semanticSha256} is ${artifact.binding.kind}, not ${kind}`
    )
  return artifact
}

function scenariosFromPolicies(
  plan: EditEvaluationPlanV1,
  policies: ReadonlyMap<string, EditProductionPolicyArtifactV1>
): readonly {
  readonly semanticSha256: string
  readonly policy: EditScenarioPolicyV1
}[]
{
  const ids = new Set<string>()
  return Object.freeze(
    plan.scenarioPolicySha256s.map((semanticSha256) =>
    {
      const artifact = requiredPolicy(policies, semanticSha256, 'scenario')
      if (artifact.scenarioPolicy === undefined)
        fail(
          'scenario-policy-undecoded',
          `scenario policy ${semanticSha256} has no frozen parsed scenario`
        )
      if (!sameValue(artifact.scenarioPolicy, artifact.value))
        fail(
          'scenario-policy-mismatch',
          `scenario policy ${semanticSha256} differs from its retained value`
        )
      if (ids.has(artifact.scenarioPolicy.scenarioId))
        fail(
          'scenario-id-duplicate',
          `scenario id ${artifact.scenarioPolicy.scenarioId} resolves more than once`
        )
      ids.add(artifact.scenarioPolicy.scenarioId)
      return Object.freeze({
        semanticSha256,
        policy: artifact.scenarioPolicy,
      })
    })
  )
}

function validateObservationCaps(caps: RuntimeObservationCapsV1): void
{
  for (const key of Object.keys(
    MAX_RUNTIME_OBSERVATION_CAPS
  ) as (keyof RuntimeObservationCapsV1)[])
  {
    const value = caps[key]
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_RUNTIME_OBSERVATION_CAPS[key]
    )
      fail(
        'runtime-policy-invalid',
        `runtime observation cap ${key} is outside the frozen safe range`
      )
  }
}

function runtimeCellPolicies(
  decoded: EditDecodedRuntimePolicyV1,
  cells: readonly EditEvaluationMatrixCellV1[]
): ReadonlyMap<string, EditDecodedRuntimeCellPolicyV1>
{
  const result = new Map<string, EditDecodedRuntimeCellPolicyV1>()
  const reservedKeys = new Set(
    cells.flatMap((cell) =>
      cell.lane === 'officialHeadless' ||
      cell.lane === 'officialBrowser' ||
      cell.lane === 'turboWarpBrowser'
        ? [`${cell.lane}\u0000${cell.scenarioId}`]
        : []
    )
  )
  for (const policy of decoded.cells)
  {
    const key = `${policy.lane}\u0000${policy.scenarioId}`
    if (!reservedKeys.has(key))
      fail(
        'runtime-policy-extra-cell',
        `runtime policy contains unreserved cell ${policy.lane}/${policy.scenarioId}`
      )
    if (result.has(key))
      fail(
        'runtime-policy-duplicate-cell',
        `runtime policy repeats ${policy.lane}/${policy.scenarioId}`
      )
    const validated = validateObservationPlan(policy.observationPlan)
    if (!validated.ok)
      fail(
        'runtime-policy-invalid',
        `runtime policy ${policy.lane}/${policy.scenarioId} has an invalid observation plan`
      )
    validateObservationCaps(policy.observationCaps)
    result.set(
      key,
      Object.freeze({
        ...policy,
        observationPlan: validated.value,
      })
    )
  }
  for (const cell of cells)
  {
    if (
      cell.lane !== 'officialHeadless' &&
      cell.lane !== 'officialBrowser' &&
      cell.lane !== 'turboWarpBrowser'
    )
      continue
    const key = `${cell.lane}\u0000${cell.scenarioId}`
    if (!result.has(key))
      fail(
        'runtime-policy-cell-missing',
        `runtime policy omits reserved cell ${cell.lane}/${cell.scenarioId}`
      )
  }
  return result
}

function cellKey(input: {
  readonly lane: string
  readonly scenarioId: string
  readonly side: string
}): string
{
  return `${input.lane}\u0000${input.scenarioId}\u0000${input.side}`
}

interface LoweredSideV1
{
  readonly lowered: EditLoweredScenarioV1
  readonly artifact: EditRuntimeArtifactBindingV1
}

interface ExecutedCellV1
{
  readonly cell: EditEvaluationMatrixCellV1
  readonly lowered: EditLoweredScenarioV1
  readonly trace: VmTrace | BrowserTrace
  readonly drive: IdentityBoundDriveResultV1 | null
  readonly actions: readonly IdentityBoundActionRecordV1[]
  readonly lineage:
    import('@scratch-agent/runner').RuntimeLineageAdapterResultV1 | null
  readonly runtimeIdentityFacet: RuntimeIdentityFacetV1 | null
  readonly runtimeObservations: readonly RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>[]
  readonly requestSha256: string
  readonly requestProjection: unknown
  readonly resultSha256: string
  readonly media: readonly CapturedMediaV1[]
}

interface CapturedMediaV1
{
  readonly evidenceKind: 'screenshot' | 'video'
  readonly mediaType: 'image/png' | 'video/webm'
  readonly payloadSha256: string
  readonly byteLength: number
  readonly bytes: Uint8Array
  readonly frameId?: string
  readonly width?: number
  readonly height?: number
  readonly rgba?: Uint8Array
}

interface RefusedCellV1
{
  readonly cell: EditEvaluationMatrixCellV1
  readonly reason: string
  readonly availability: 'unavailable' | 'inconclusive'
}

type CellOutcomeV1 = ExecutedCellV1 | RefusedCellV1

function isExecuted(cell: CellOutcomeV1): cell is ExecutedCellV1
{
  return 'trace' in cell
}

function isBoundedResourceIssueCodeV1(code: string): boolean
{
  return (
    code === RUN_ISSUE_CODES.observationResourceExceeded ||
    code === RUN_ISSUE_CODES.observationNonScalar ||
    code === RUN_ISSUE_CODES.observationBudgetExceeded
  )
}

function optionalResourceIssueLimitationsV1(
  outcomes: ReadonlyMap<string, CellOutcomeV1>
): readonly string[]
{
  const limitations = new Set<string>()
  for (const outcome of outcomes.values())
    if (isExecuted(outcome) && outcome.cell.disposition === 'optional')
      for (const issue of outcome.trace.issues)
        if (isBoundedResourceIssueCodeV1(issue.code))
          limitations.add(
            `optional cell ${outcome.cell.lane}/${outcome.cell.scenarioId}/${outcome.cell.side} retained non-authorizing resource issue ${issue.code}`
          )
  return Object.freeze([...limitations].sort())
}

function executionTraceProjection(cell: {
  readonly matrix: EditEvaluationMatrixCellV1
  readonly lowered: EditLoweredScenarioV1
  readonly trace: VmTrace | BrowserTrace
  readonly drive: IdentityBoundDriveResultV1 | null
  readonly actions: readonly IdentityBoundActionRecordV1[]
  readonly lineage:
    import('@scratch-agent/runner').RuntimeLineageAdapterResultV1 | null
  readonly runtimeIdentityFacet: RuntimeIdentityFacetV1 | null
  readonly runtimeObservations: readonly RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>[]
  readonly requestProjection?: unknown
}): unknown
{
  return {
    matrix: cell.matrix,
    artifactSha256: cell.lowered.artifactSha256,
    manifestSha256: cell.lowered.manifestSha256,
    loweredScenarioSha256: cell.lowered.loweredScenarioSha256,
    semanticPolicySha256: cell.lowered.semanticPolicySha256,
    runtimeDescriptor: cell.trace.runtimeDescriptor,
    traceOk: cell.trace.ok,
    observationTrace: cell.trace.observations,
    snapshots: cell.trace.snapshots,
    finalSnapshot: cell.trace.finalSnapshot,
    drive: cell.drive,
    actions: cell.actions,
    lineage: cell.lineage,
    runtimeIdentityFacet: cell.runtimeIdentityFacet,
    runtimeObservations: cell.runtimeObservations,
    requestProjection: cell.requestProjection ?? null,
    issues: cell.trace.issues.map((issue) => ({
      code: issue.code,
      kind: issue.kind,
      responsibility: issue.responsibility,
      location: issue.location ?? null,
    })),
  }
}

function executionRequestProjection(input: {
  readonly matrixSha256: string
  readonly cell: EditEvaluationMatrixCellV1
  readonly lowered: EditLoweredScenarioV1
  readonly runtimePolicySha256: string
  readonly policy: EditDecodedRuntimeCellPolicyV1
}): unknown
{
  return {
    matrixSha256: input.matrixSha256,
    cell: input.cell,
    artifactSha256: input.lowered.artifactSha256,
    manifestSha256: input.lowered.manifestSha256,
    loweredScenarioSha256: input.lowered.loweredScenarioSha256,
    semanticPolicySha256: input.lowered.semanticPolicySha256,
    runtimePolicySha256: input.runtimePolicySha256,
    observationPlan: input.policy.observationPlan,
    observationCaps: input.policy.observationCaps,
  }
}

function runtimeIssueMultisetSha256(trace: VmTrace | BrowserTrace): string
{
  const rows = trace.issues
    .map((issue) => ({
      code: issue.code,
      kind: issue.kind,
      responsibility: issue.responsibility,
      location: issue.location ?? null,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    )
  return editRuntimeHashV1('edit-runtime-issue-multiset-v1', rows)
}

function descriptorIdentity(descriptor: RuntimeDescriptorV1): string
{
  return editRuntimeHashV1('edit-runtime-descriptor-v1', descriptor)
}

function runtimeIdentity(
  cells: readonly ExecutedCellV1[]
): EditProductionRuntimeIdentityV1
{
  const descriptors = cells.map((cell) => cell.trace.runtimeDescriptor)
  const vm = descriptors.filter((entry) => entry.kind === 'scratch-vm-node')
  const browser = descriptors.filter(
    (entry) => entry.kind !== 'scratch-vm-node'
  )
  const componentRows = descriptors.flatMap((entry) => entry.components)
  const bundleRows = descriptors.flatMap((entry) => [
    ...(entry.bundle ? [entry.bundle] : []),
    ...entry.workers,
  ])
  return Object.freeze({
    vmIdentitySha256: editRuntimeHashV1(
      'edit-vm-identity-set-v1',
      vm.map(descriptorIdentity)
    ),
    browserIdentitySha256: editRuntimeHashV1(
      'edit-browser-identity-set-v1',
      browser.map(descriptorIdentity)
    ),
    runtimeIdentitySha256: editRuntimeHashV1(
      'edit-runtime-identity-set-v1',
      descriptors.map(descriptorIdentity)
    ),
    pinnedScratchIdentitySha256: editRuntimeHashV1(
      'edit-pinned-scratch-components-v1',
      componentRows.filter((entry) => entry.name.includes('scratch'))
    ),
    buildIdentitySha256: editRuntimeHashV1(
      'edit-runtime-build-artifacts-v1',
      bundleRows
    ),
    executableIdentitySha256: editRuntimeHashV1(
      'edit-runtime-executable-set-v1',
      descriptors.map((entry) => ({
        browser: entry.browser,
        environment: entry.environment,
        bundle: entry.bundle,
      }))
    ),
  })
}

interface EditProductionEvidenceSinkV1
{
  retain(input: {
    readonly evaluationId: string
    readonly lane: EditEvaluationLaneV1
    readonly scenarioId: string
    readonly side: 'baseline' | 'candidate'
    readonly evidenceKind: 'screenshot' | 'video'
    readonly mediaType: 'image/png' | 'video/webm'
    readonly payloadSha256: string
    readonly bytes: Uint8Array
  }): Promise<void>
}

export interface EditProductionEvaluationOptionsV1
{
  readonly decoder?: EditProductionPolicyDecoderV1
  readonly evidenceSink?: EditProductionEvidenceSinkV1
}

function boundedCellCaps(
  policy: EditDecodedRuntimeCellPolicyV1,
  cell: EditEvaluationMatrixCellV1
): RuntimeObservationCapsV1
{
  return Object.freeze({
    ...policy.observationCaps,
    traceBytesPerCell: Math.min(
      policy.observationCaps.traceBytesPerCell,
      cell.reservedTraceBytes
    ),
  })
}

async function retainMedia(
  request: EditProductionEvaluationRequestV1,
  cell: EditEvaluationMatrixCellV1,
  trace: BrowserTrace,
  sink: EditProductionEvidenceSinkV1 | undefined
): Promise<readonly CapturedMediaV1[]>
{
  const retained: CapturedMediaV1[] = []
  for (const screenshot of trace.screenshots)
  {
    const bytes = readFileSync(screenshot.path)
    const payloadSha256 = sha256(bytes)
    if (sink !== undefined)
      await sink.retain({
        evaluationId: request.evaluationId,
        lane: cell.lane,
        scenarioId: cell.scenarioId,
        side: cell.side,
        evidenceKind: 'screenshot',
        mediaType: 'image/png',
        payloadSha256,
        bytes,
      })
    retained.push({
      evidenceKind: 'screenshot',
      mediaType: 'image/png',
      payloadSha256,
      byteLength: bytes.byteLength,
      bytes,
    })
  }
  if (trace.video)
  {
    const bytes = readFileSync(trace.video)
    const payloadSha256 = sha256(bytes)
    if (sink !== undefined)
      await sink.retain({
        evaluationId: request.evaluationId,
        lane: cell.lane,
        scenarioId: cell.scenarioId,
        side: cell.side,
        evidenceKind: 'video',
        mediaType: 'video/webm',
        payloadSha256,
        bytes,
      })
    retained.push({
      evidenceKind: 'video',
      mediaType: 'video/webm',
      payloadSha256,
      byteLength: bytes.byteLength,
      bytes,
    })
  }
  for (const frame of trace.observations.media?.frames ?? [])
  {
    if (!trace.mediaRoot) continue
    const bytes = readFileSync(join(trace.mediaRoot, frame.relativePath))
    const payloadSha256 = sha256(bytes)
    if (payloadSha256 !== frame.sha256 || bytes.byteLength !== frame.bytes)
      fail(
        'rendered-frame-content-mismatch',
        `retained frame ${frame.id} differs from its runtime manifest`
      )
    const decoded = decodeRuntimePngRgbaV1(bytes)
    if (sink !== undefined)
      await sink.retain({
        evaluationId: request.evaluationId,
        lane: cell.lane,
        scenarioId: cell.scenarioId,
        side: cell.side,
        evidenceKind: 'screenshot',
        mediaType: 'image/png',
        payloadSha256,
        bytes,
      })
    retained.push({
      evidenceKind: 'screenshot',
      mediaType: 'image/png',
      payloadSha256,
      byteLength: bytes.byteLength,
      bytes,
      frameId: frame.id,
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
    })
  }
  return Object.freeze(retained)
}

async function executeCell(input: {
  readonly request: EditProductionEvaluationRequestV1
  readonly cell: EditEvaluationMatrixCellV1
  readonly lowered: EditLoweredScenarioV1
  readonly artifact: EditRuntimeArtifactBindingV1
  readonly runtimePolicySha256: string
  readonly policy: EditDecodedRuntimeCellPolicyV1
  readonly matrixSha256: string
  readonly carriedAttemptTraceBytes: number
  readonly evidenceSink?: EditProductionEvidenceSinkV1
}): Promise<ExecutedCellV1>
{
  const requestProjection = executionRequestProjection(input)
  const requestSha256 = editRuntimeHashV1(
    'edit-production-runtime-request',
    requestProjection
  )
  const runtimeObservation = {
    caps: boundedCellCaps(input.policy, input.cell),
    carriedAttemptTraceBytes: input.carriedAttemptTraceBytes,
  }
  let trace: VmTrace | BrowserTrace
  let drive: IdentityBoundDriveResultV1 | null
  let actions: readonly IdentityBoundActionRecordV1[]
  let lineage:
    import('@scratch-agent/runner').RuntimeLineageAdapterResultV1 | null
  let runtimeIdentityFacet: RuntimeIdentityFacetV1 | null
  let runtimeObservations: readonly RuntimeObservationRecordV1<EditBoundedRuntimeObservationV1>[]
  let media: readonly CapturedMediaV1[] = Object.freeze([])
  if (input.cell.lane === 'officialHeadless')
  {
    const run = await runIdentityBoundScenario(
      input.cell.side === 'baseline'
        ? input.request.baselineBytes
        : input.request.candidateBytes,
      input.lowered.scenario,
      input.artifact.manifest,
      {
        observationPlan: input.policy.observationPlan,
        runtimeObservation,
      }
    )
    trace = run.trace
    drive = run.drive
    actions = run.drive.actions
    lineage = run.lineage
    runtimeIdentityFacet = run.runtimeIdentityFacet
    runtimeObservations = run.runtimeObservations
  }
  else
  {
    const root = mkdtempSync(join(tmpdir(), 'agentic-scratch-edit-eval-'))
    try
    {
      const browserTrace = await runIdentityBoundBrowserScenario(
        input.cell.lane === 'officialBrowser'
          ? 'scratch-official'
          : 'turbowarp',
        input.cell.side === 'baseline'
          ? input.request.baselineBytes
          : input.request.candidateBytes,
        input.lowered.scenario,
        input.artifact.manifest,
        {
          screenshotDir: join(root, 'screenshots'),
          mediaDir: join(root, 'media'),
          observationPlan: input.policy.observationPlan,
          runtimeObservation,
        }
      )
      trace = browserTrace
      drive = browserTrace.identityBoundDrive ?? null
      actions = browserTrace.identityBoundDrive?.actions ?? []
      lineage = browserTrace.lineage ?? null
      runtimeIdentityFacet = browserTrace.runtimeIdentityFacet ?? null
      runtimeObservations = browserTrace.runtimeObservations ?? []
      media = await retainMedia(
        input.request,
        input.cell,
        browserTrace,
        input.evidenceSink
      )
    }
    finally
    {
      rmSync(root, { recursive: true, force: true })
    }
  }
  const projection = executionTraceProjection({
    matrix: input.cell,
    lowered: input.lowered,
    trace,
    drive,
    actions,
    lineage,
    runtimeIdentityFacet,
    runtimeObservations,
    requestProjection,
  })
  return Object.freeze({
    cell: input.cell,
    lowered: input.lowered,
    trace,
    drive,
    actions: Object.freeze([...actions]),
    lineage,
    runtimeIdentityFacet,
    runtimeObservations: Object.freeze([...runtimeObservations]),
    requestSha256,
    requestProjection,
    resultSha256: editRuntimeHashV1(
      'edit-production-runtime-result',
      projection
    ),
    media,
  })
}

function cellHasCompleteSemanticDrive(cell: ExecutedCellV1): boolean
{
  return (
    cell.trace.ok &&
    cell.drive?.status === 'complete' &&
    cell.drive.reservation.status === 'reserved' &&
    cell.actions.length === cell.lowered.scenario.steps.length &&
    cell.actions.every(
      (action, index) =>
        action.stepIndex === index &&
        action.do === cell.lowered.scenario.steps[index]!.do
    ) &&
    !cell.trace.issues.some(
      (issue) => issue.code === RUN_ISSUE_CODES.identityBoundActionInconclusive
    )
  )
}

function evidenceEntry(input: {
  readonly revisionBinding: EditEvaluationRevisionBindingV1
  readonly evidenceKind: EvaluationEvidenceSemanticBindingV1['evidenceKind']
  readonly contentEvidenceKind: import('@scratch-agent/ir/edit').EditEvidenceContentHashProjectionV1['evidenceKind']
  readonly lane: EvaluationEvidenceSemanticBindingV1['lane']
  readonly requestSha256: string
  readonly resultSha256: string
  readonly payloadSha256: string
  readonly byteLength: number
  readonly mediaType: string
  readonly side?: 'baseline' | 'candidate'
  readonly scenarioId?: string
}): EditProductionEvidenceEntryV1
{
  const wrapped = wrapEditEvaluationEvidenceV1({
    binding: input.revisionBinding,
    evidenceKind: input.contentEvidenceKind,
    mediaType: input.mediaType,
    payloadSha256: input.payloadSha256,
    byteLength: input.byteLength,
    lane: input.lane,
    ...(input.side === undefined ? {} : { side: input.side }),
    ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
  })
  return Object.freeze({
    binding: editEvaluationEvidenceBindingV1({
      evidenceKind: input.evidenceKind,
      lane: input.lane,
      requestSha256: input.requestSha256,
      resultSha256: input.resultSha256,
      contentSha256: wrapped.contentSha256,
    }),
    contentSha256: wrapped.contentSha256,
  })
}

function projectionEvidence(input: {
  readonly revisionBinding: EditEvaluationRevisionBindingV1
  readonly evidenceKind: EvaluationEvidenceSemanticBindingV1['evidenceKind']
  readonly contentEvidenceKind: Exclude<
    EditProductionEvidenceArtifactIndexEntryV1['evidenceKind'],
    null
  >
  readonly lane: EditEvaluationLaneV1
  readonly requestSha256: string
  readonly resultSha256: string
  readonly projection: unknown
  readonly side?: 'baseline' | 'candidate'
  readonly scenarioId?: string
}): {
  readonly evidence: EditProductionEvidenceEntryV1
  readonly payload: EditProductionEvidencePayloadV1
}
{
  const bytes = canonicalJsonBytesV1(input.projection)
  const payloadSha256 = sha256(bytes)
  const evidence = evidenceEntry({
    revisionBinding: input.revisionBinding,
    evidenceKind: input.evidenceKind,
    contentEvidenceKind: input.contentEvidenceKind,
    lane: input.lane,
    requestSha256: input.requestSha256,
    resultSha256: input.resultSha256,
    payloadSha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
    ...(input.side === undefined ? {} : { side: input.side }),
    ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
  })
  return Object.freeze({
    evidence,
    payload: Object.freeze({
      payloadSha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
      contentSha256: evidence.contentSha256,
      evidenceKind: input.contentEvidenceKind,
      lane: input.lane,
      ...(input.side === undefined ? {} : { side: input.side }),
      ...(input.scenarioId === undefined
        ? {}
        : { scenarioId: input.scenarioId }),
      bytes,
    }),
  })
}

function rawMediaPayload(
  media: CapturedMediaV1
): EditProductionEvidencePayloadV1
{
  return Object.freeze({
    payloadSha256: media.payloadSha256,
    byteLength: media.byteLength,
    mediaType: media.mediaType,
    contentSha256: null,
    evidenceKind: null,
    lane: null,
    bytes: media.bytes,
  })
}

function toEditRuntimeIdentityFacet(
  cell: ExecutedCellV1
): EditRuntimeIdentityFacetV1 | null
{
  const facet = cell.runtimeIdentityFacet
  const lineage = cell.lineage
  if (
    facet === null ||
    facet.status !== 'bound' ||
    lineage === null ||
    lineage.status !== 'bound' ||
    facet.manifestSha256 !== cell.lowered.manifestSha256 ||
    lineage.manifestSha256 !== cell.lowered.manifestSha256
  )
    return null
  return Object.freeze({
    artifactSha256: cell.lowered.artifactSha256,
    manifestSha256: cell.lowered.manifestSha256,
    targets: Object.freeze(
      facet.targets.map((target) =>
        Object.freeze({
          runtimeTargetId: target.runtimeTargetId,
          observationTargetId: target.observationTargetId,
          cloneCountTargetId: target.cloneCountTargetId,
          geometryOriginalTargetId: target.geometryOriginalTargetId,
          runtimeTargetName: target.runtimeTargetName,
          targetLineage: target.targetLineage,
          isStage: target.isStage,
        })
      )
    ),
    declarations: Object.freeze(
      facet.targets.flatMap((target) =>
        target.declarations.flatMap((declaration) =>
          declaration.collection === 'broadcasts'
            ? []
            : [
                Object.freeze({
                  runtimeName: declaration.runtimeName,
                  runtimeDeclarationId: declaration.runtimeDeclarationId,
                  declarationLineage: declaration.declarationLineage,
                  targetLineage: target.targetLineage,
                  collection: declaration.collection,
                }),
              ]
        )
      )
    ),
    media: Object.freeze(
      facet.targets.flatMap((target) =>
        target.media.map((media) =>
          Object.freeze({
            runtimeName: media.runtimeName,
            mediaLineage: media.mediaLineage,
            targetLineage: target.targetLineage,
            mediaKind: 'costume' as const,
            mediaIndex: media.mediaIndex,
          })
        )
      )
    ),
    paneTargetLineageOrder: lineage.paneLineageOrder,
    executableTargetLineageOrder: lineage.executableTargetLineageOrder,
    decodedPixelFrames: Object.freeze(
      cell.media.flatMap((media) =>
        media.frameId !== undefined &&
        media.width !== undefined &&
        media.height !== undefined &&
        media.rgba !== undefined
          ? [
              Object.freeze({
                frameId: media.frameId,
                sourceFrameSha256: media.payloadSha256,
                width: media.width,
                height: media.height,
                rgba: media.rgba,
                rgbaSha256: editDecodedRgbaSha256V1({
                  width: media.width,
                  height: media.height,
                  rgba: media.rgba,
                }),
              }),
            ]
          : []
      )
    ),
    runtimeObservations: cell.runtimeObservations,
  })
}

function observationRecord(
  cell: ExecutedCellV1,
  predicate: Extract<RuntimePredicateV1, { kind: 'stateAtLabel' }>
): RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1> | null
{
  const matches = cell.runtimeObservations.filter(
    (record) => record.label === predicate.label
  ) as readonly RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1>[]
  return matches.length === 1 ? matches[0]! : null
}

function rawScalar(
  value: ObservedRuntimeScalarV1
): string | number | boolean | null
{
  if (value.scalarKind === 'string' || value.scalarKind === 'boolean')
    return value.value
  if (value.value.numberKind === 'finite') return value.value.value
  return null
}

function isObservedScalar(value: unknown): value is ObservedRuntimeScalarV1
{
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { scalarKind?: unknown; value?: unknown }
  return (
    candidate.scalarKind === 'string' ||
    candidate.scalarKind === 'boolean' ||
    candidate.scalarKind === 'number'
  )
}

function candidateStateValue(
  value: unknown
): EditCandidateObservedValueV1 | null
{
  if (isObservedScalar(value))
  {
    const raw = rawScalar(value)
    if (raw === null) return null
    return { kind: 'stateValue', valueKind: 'scalar', value: raw }
  }
  if (Array.isArray(value) && value.every(isObservedScalar))
  {
    const values = value.map(rawScalar)
    if (values.some((entry) => entry === null)) return null
    return {
      kind: 'stateValue',
      valueKind: 'scalarList',
      value: values as (string | number | boolean)[],
    }
  }
  if (value === null || typeof value === 'object')
    return {
      kind: 'stateValue',
      valueKind: 'canonicalJson',
      valueSha256: semanticHashV1('evidence-content', value),
    }
  return null
}

function targetFacetByLineage(
  cell: ExecutedCellV1,
  targetLineage: string
):
  | Extract<RuntimeIdentityFacetV1, { status: 'bound' }>['targets'][number]
  | null
  {
  const facet = cell.runtimeIdentityFacet
  if (facet === null || facet.status !== 'bound') return null
  const matches = facet.targets.filter(
    (target) => target.targetLineage === targetLineage
  )
  return matches.length === 1 ? matches[0]! : null
}

function statePathValue(
  request: EditProductionEvaluationRequestV1,
  cell: ExecutedCellV1,
  predicate: Extract<RuntimePredicateV1, { kind: 'stateAtLabel' }>,
  observation: ObservedRuntimeExecutionObservationV1
): unknown
{
  const path = predicate.path
  if (path.pathKind === 'stageProperty')
  {
    if (path.property === 'answer' || path.property === 'timer')
      return observation.state[path.property]
    return observation.state.stage[path.property]
  }
  const context = request.candidateRuntime
  if (path.pathKind === 'targetProperty')
  {
    const binding = context.bindings.targets.filter(
      (entry) => entry.bindingKey === path.target.bindingKey
    )
    if (binding.length !== 1) return undefined
    const target = targetFacetByLineage(cell, binding[0]!.targetLineage)
    if (target === null) return undefined
    return observation.state.targetsById[target.observationTargetId]?.[
      path.property
    ]
  }
  const binding = context.bindings.declarations.filter(
    (entry) => entry.bindingKey === path.declaration.bindingKey
  )
  if (binding.length !== 1) return undefined
  const target = targetFacetByLineage(cell, binding[0]!.targetLineage)
  if (target === null) return undefined
  const declaration = target.declarations.filter(
    (entry) => entry.declarationLineage === binding[0]!.declarationLineage
  )
  if (declaration.length !== 1) return undefined
  const targetState = observation.state.targetsById[target.observationTargetId]
  if (targetState === undefined) return undefined
  return path.pathKind === 'declarationValue'
    ? targetState.variables[declaration[0]!.runtimeDeclarationId]?.value
    : targetState.lists[declaration[0]!.runtimeDeclarationId]?.items
}

function cloneCountValue(
  request: EditProductionEvaluationRequestV1,
  cell: ExecutedCellV1,
  predicate: Extract<RuntimePredicateV1, { kind: 'cloneCountAtTick' }>
): number | null
{
  const matches = cell.runtimeObservations.filter(
    (record) => record.tick === predicate.tick
  ) as readonly RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1>[]
  if (matches.length === 0) return null
  const binding = request.candidateRuntime.bindings.targets.filter(
    (entry) => entry.bindingKey === predicate.target.bindingKey
  )
  if (binding.length !== 1) return null
  const target = targetFacetByLineage(cell, binding[0]!.targetLineage)
  if (target === null) return null
  const values = matches.map((record): number | null =>
  {
    if (record.capture.status !== 'observed') return null
    const counts = record.capture.value.cloneCounts as {
      byOriginalTargetId?: Record<string, ObservedRuntimeScalarV1>
    }
    const observed = counts.byOriginalTargetId?.[target.cloneCountTargetId]
    if (
      !observed ||
      observed.scalarKind !== 'number' ||
      observed.value.numberKind !== 'finite'
    )
      return null
    return observed.value.value
  })
  if (values.some((value) => value === null) || new Set(values).size !== 1)
    return null
  return values[0]!
}

function candidateObservation(
  request: EditProductionEvaluationRequestV1,
  predicate: RuntimePredicateV1,
  outcomes: ReadonlyMap<string, CellOutcomeV1>
): EditCandidateObservationV1
{
  if (
    predicate.lane === 'renderedDifferential' ||
    predicate.lane === 'nativeVisual'
  )
    return {
      objectiveId: predicate.objectiveId,
      status: 'unavailable',
      reason: `${predicate.lane} requires external exact evidence`,
    }
  const outcome = outcomes.get(
    cellKey({
      lane: predicate.lane,
      scenarioId: predicate.scenarioId,
      side: 'candidate',
    })
  )
  if (outcome === undefined || !isExecuted(outcome))
    return {
      objectiveId: predicate.objectiveId,
      status: outcome?.availability ?? 'inconclusive',
      reason: outcome?.reason ?? 'candidate execution cell is absent',
    }
  if (!cellHasCompleteSemanticDrive(outcome))
    return {
      objectiveId: predicate.objectiveId,
      status: 'inconclusive',
      reason:
        'the candidate identity-bound action drive did not complete exactly',
    }
  if (predicate.kind === 'runtimeOutcome')
    return {
      objectiveId: predicate.objectiveId,
      status: 'observed',
      observed: {
        kind: 'runtimeOutcome',
        ok: outcome.trace.ok,
        issueMultisetSha256: runtimeIssueMultisetSha256(outcome.trace),
      },
    }
  if (predicate.kind === 'cloneCountAtTick')
  {
    const count = cloneCountValue(request, outcome, predicate)
    return count === null
      ? {
          objectiveId: predicate.objectiveId,
          status: 'inconclusive',
          reason: 'the exact clone-count observation is unavailable',
        }
      : {
          objectiveId: predicate.objectiveId,
          status: 'observed',
          observed: { kind: 'cloneCount', count },
        }
  }
  if (predicate.kind === 'visualCriterion')
    return {
      objectiveId: predicate.objectiveId,
      status: 'unavailable',
      reason: 'visual criteria require external exact rubric judgment',
    }
  const record = observationRecord(outcome, predicate)
  if (record === null || record.capture.status !== 'observed')
    return {
      objectiveId: predicate.objectiveId,
      status: 'inconclusive',
      reason: 'the exact labeled bounded observation is unavailable',
    }
  const observed = candidateStateValue(
    statePathValue(request, outcome, predicate, record.capture.value)
  )
  return observed === null
    ? {
        objectiveId: predicate.objectiveId,
        status: 'inconclusive',
        reason: 'the runtime returned a non-finite or non-scalar exact value',
      }
    : {
        objectiveId: predicate.objectiveId,
        status: 'observed',
        observed,
      }
}

function diagnosticLineage(
  request: EditProductionEvaluationRequestV1,
  side: 'baseline' | 'candidate'
): EditDiagnosticLineageV1
{
  const context =
    side === 'baseline' ? request.baselineRuntime : request.candidateRuntime
  return {
    revisionIdentity:
      side === 'baseline'
        ? request.revision.sourceArtifactSha256
        : `${request.revision.revisionId}:${request.revision.candidateSha256}`,
    ...context.diagnosticLineage,
    targetByIndex: new Map(
      context.assignment.targetLineagesBySerializedIndex.map(
        (lineage, index) => [index, lineage] as const
      )
    ),
    declarationByOwnerKindAndId: new Map(
      context.assignment.declarations.map((declaration) => [
        editDiagnosticDeclarationKeyV1(
          declaration.targetIndex,
          declaration.kind,
          declaration.rawDeclarationId
        ),
        declaration.declarationLineage,
      ])
    ),
  }
}

function diagnosticsFor(
  request: EditProductionEvaluationRequestV1,
  side: 'baseline' | 'candidate',
  preflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>
): readonly EditDiagnosticEvidenceV1[]
{
  const lineage = diagnosticLineage(request, side)
  return Object.freeze(
    [...preflight.graph, ...preflight.static].map((diagnostic) =>
      bindEditDiagnosticFailureV1(diagnostic, lineage)
    )
  )
}

function projectionBindings(
  request: EditProductionEvaluationRequestV1
): EditRuntimeProjectionInputV1['policy']['bindings']
{
  const targets = new Map<string, string>()
  const declarations = new Map<
    string,
    EditRuntimeProjectionInputV1['policy']['bindings']['declarations'][number]
  >()
  for (const context of [request.baselineRuntime, request.candidateRuntime])
  {
    for (const binding of context.bindings.targets)
    {
      const prior = targets.get(binding.bindingKey)
      if (prior !== undefined && prior !== binding.targetLineage)
        fail(
          'projection-binding-mismatch',
          `target binding ${binding.bindingKey} changes lineage by side`
        )
      targets.set(binding.bindingKey, binding.targetLineage)
    }
    for (const binding of context.bindings.declarations)
    {
      const prior = declarations.get(binding.bindingKey)
      if (
        prior !== undefined &&
        (prior.declarationLineage !== binding.declarationLineage ||
          prior.targetLineage !== binding.targetLineage ||
          prior.collection !== binding.collection)
      )
        fail(
          'projection-binding-mismatch',
          `declaration binding ${binding.bindingKey} changes identity by side`
        )
      declarations.set(binding.bindingKey, binding)
    }
  }
  return Object.freeze({
    targets: Object.freeze(
      [...targets].map(([bindingKey, targetLineage]) =>
        Object.freeze({ bindingKey, targetLineage })
      )
    ),
    declarations: Object.freeze([...declarations.values()]),
  })
}

function lensSpecKind(lens: PreservationLensV1): BehavioralLensSpecV1['kind']
{
  switch (lens.lensKind)
  {
    case 'finalState':
      return 'final-state'
    case 'labeledTrace':
      return 'labeled-trace'
    case 'runtimeOutcome':
      return 'runtime-outcome'
    case 'cloneCounts':
      return 'clone-count-trace'
    case 'visualKeyframes':
      return 'visual-keyframes'
  }
}

function preservedPair(
  outcomes: ReadonlyMap<string, CellOutcomeV1>,
  lane: 'officialHeadless' | 'officialBrowser' | 'turboWarpBrowser',
  scenarioId: string
): {
  readonly baseline: ExecutedCellV1
  readonly candidate: ExecutedCellV1
} | null
{
  const baseline = outcomes.get(cellKey({ lane, scenarioId, side: 'baseline' }))
  const candidate = outcomes.get(
    cellKey({ lane, scenarioId, side: 'candidate' })
  )
  return baseline &&
    candidate &&
    isExecuted(baseline) &&
    isExecuted(candidate) &&
    cellHasCompleteSemanticDrive(baseline) &&
    cellHasCompleteSemanticDrive(candidate)
    ? { baseline, candidate }
    : null
}

function pairHasBoundedObservationIssue(
  outcomes: ReadonlyMap<string, CellOutcomeV1>,
  lane: 'officialHeadless' | 'officialBrowser' | 'turboWarpBrowser',
  scenarioId: string
): boolean
{
  return (['baseline', 'candidate'] as const).some((side) =>
  {
    const outcome = outcomes.get(cellKey({ lane, scenarioId, side }))
    return (
      outcome !== undefined &&
      isExecuted(outcome) &&
      outcome.trace.issues.some((issue) =>
        isBoundedResourceIssueCodeV1(issue.code)
      )
    )
  })
}

function completeRenderedPair(
  request: EditProductionEvaluationRequestV1,
  outcomes: ReadonlyMap<string, CellOutcomeV1>,
  scenarioId: string,
  producerLane: 'officialBrowser' | 'turboWarpBrowser' | undefined
): {
  readonly baseline: ExecutedCellV1
  readonly candidate: ExecutedCellV1
} | null
{
  if (producerLane === undefined) return null
  const requirement = request.plan.plan.laneRequirements.find(
    (candidate) => candidate.lane === producerLane
  )
  if (requirement?.disposition !== 'required') return null
  const pair = preservedPair(outcomes, producerLane, scenarioId)
  if (pair === null) return null
  const complete = [pair.baseline, pair.candidate].every((cell) =>
  {
    const frameCount = cell.trace.observations.media?.frames.length ?? 0
    const retainedFrames = cell.media.filter(
      (media) => media.frameId !== undefined && media.rgba !== undefined
    ).length
    return frameCount > 0 && retainedFrames === frameCount
  })
  return complete ? pair : null
}

function unavailablePreservation(
  lens: PreservationLensV1,
  reason: string,
  outcome: 'unavailable' | 'inconclusive' = 'unavailable'
): EditPreservationLensObservationV1
{
  return {
    lensSha256: editPreservationLensRowSha256V1(lens),
    scenarioId: lens.scenarioId,
    lane: lens.lane,
    lensKind: lens.lensKind,
    outcome,
    comparisonSha256: null,
    reason,
  }
}

type EditProductionLensPolicyAuthorityV1 =
  | {
      readonly lensPolicySha256: string
      readonly status: 'decoded'
      readonly spec: BehavioralLensSpecV1
      readonly renderedProducerLane?: 'officialBrowser' | 'turboWarpBrowser'
    }
  | {
      readonly lensPolicySha256: string
      readonly status: 'refused'
      readonly reason: string
    }

interface PreservationEvaluationV1
{
  readonly observation: EditPreservationLensObservationV1
  readonly projectedEvidence: unknown | null
}

function noProjectedEvidence(
  observation: EditPreservationLensObservationV1
): PreservationEvaluationV1
{
  return Object.freeze({ observation, projectedEvidence: null })
}

function decodeLensPolicyAuthoritiesV1(input: {
  plan: EditEvaluationPlanV1
  policies: ReadonlyMap<string, EditProductionPolicyArtifactV1>
  decoder: EditProductionPolicyDecoderV1
}): readonly EditProductionLensPolicyAuthorityV1[]
{
  return Object.freeze(
    input.plan.preservationLenses.map((lens) =>
    {
      try
      {
        return Object.freeze({
          lensPolicySha256: lens.lensPolicySha256,
          status: 'decoded' as const,
          spec: input.decoder.decodeLensPolicy(
            requiredPolicy(input.policies, lens.lensPolicySha256, 'lens'),
            lens,
            input.policies
          ),
          ...(lens.lane === 'renderedDifferential'
            ? {
                renderedProducerLane: input.plan.laneRequirements.find(
                  (requirement) =>
                    requirement.disposition === 'required' &&
                    (requirement.lane === 'officialBrowser' ||
                      requirement.lane === 'turboWarpBrowser')
                )?.lane,
              }
            : {}),
        })
      }
      catch (error)
      {
        return Object.freeze({
          lensPolicySha256: lens.lensPolicySha256,
          status: 'refused' as const,
          reason: unknownErrorMessage(error),
        })
      }
    })
  )
}

function validateDecodedLensPolicyAuthoritiesV1(input: {
  plan: EditEvaluationPlanV1
  scenarios: readonly {
    readonly semanticSha256: string
    readonly policy: EditScenarioPolicyV1
  }[]
  authorities: readonly EditProductionLensPolicyAuthorityV1[]
  runtimePolicyDecoded: boolean
}): void
{
  for (let index = 0; index < input.plan.preservationLenses.length; index++)
  {
    const lens = input.plan.preservationLenses[index]!
    const authority = input.authorities[index]
    if (
      authority === undefined ||
      authority.lensPolicySha256 !== lens.lensPolicySha256
    )
      fail(
        'lens-policy-binding-mismatch',
        `lens policy authority ${index} does not match its activated lens`
      )
    if (authority.status === 'refused')
    {
      if (input.runtimePolicyDecoded)
        fail(
          'lens-policy-decoder-refused',
          `lens policy ${lens.lensPolicySha256} refused before dispatch: ${authority.reason}`
        )
      continue
    }
    const expectedRenderedProducerLane =
      lens.lane === 'renderedDifferential'
        ? input.plan.laneRequirements.find(
            (requirement) =>
              requirement.disposition === 'required' &&
              (requirement.lane === 'officialBrowser' ||
                requirement.lane === 'turboWarpBrowser')
          )?.lane
        : undefined
    if (
      lens.lane === 'renderedDifferential' &&
      (expectedRenderedProducerLane === undefined ||
        authority.renderedProducerLane !== expectedRenderedProducerLane)
    )
      fail(
        'rendered-lens-producer-missing',
        `rendered lens ${lens.lensPolicySha256} has no exact required browser producer`
      )
    const validated = validateBehavioralLensSpecs([authority.spec])
    if (
      !validated.ok ||
      authority.spec.kind !== lensSpecKind(lens) ||
      !authority.spec.required ||
      authority.spec.appliesTo === 'runtime-runtime'
    )
      fail(
        'lens-policy-incompatible',
        `lens policy ${lens.lensPolicySha256} is incompatible with its activated lens`
      )
    const scenario = input.scenarios.find(
      (entry) => entry.policy.scenarioId === lens.scenarioId
    )
    if (scenario === undefined)
      fail(
        'lens-policy-scenario-missing',
        `lens policy ${lens.lensPolicySha256} has no retained scenario`
      )
    if (authority.spec.kind === 'labeled-trace')
    {
      const labels = new Set(
        scenario.policy.steps.flatMap((step) =>
          step.do === 'snapshot' ? [step.label] : []
        )
      )
      if (authority.spec.labels.some((label) => !labels.has(label)))
        fail(
          'lens-policy-label-missing',
          `lens policy ${lens.lensPolicySha256} names an absent scenario snapshot label`
        )
    }
    if (
      authority.spec.kind === 'clone-count-trace' &&
      authority.spec.ticks.some(
        (tick) =>
          !Number.isSafeInteger(tick) ||
          tick < 0 ||
          tick > scenario.policy.maxTicks
      )
    )
      fail(
        'lens-policy-tick-out-of-range',
        `lens policy ${lens.lensPolicySha256} names a tick outside its retained scenario`
      )
  }
}

function preservationObservation(input: {
  readonly request: EditProductionEvaluationRequestV1
  readonly lens: PreservationLensV1
  readonly scenarios: readonly {
    readonly semanticSha256: string
    readonly policy: EditScenarioPolicyV1
  }[]
  readonly lensAuthority: EditProductionLensPolicyAuthorityV1
  readonly outcomes: ReadonlyMap<string, CellOutcomeV1>
}): PreservationEvaluationV1
{
  const { request, lens, scenarios, lensAuthority, outcomes } = input
  const scenario = scenarios.find(
    (entry) => entry.policy.scenarioId === lens.scenarioId
  )
  if (scenario === undefined)
    return noProjectedEvidence(
      unavailablePreservation(lens, 'the retained scenario is absent')
    )
  let pair: {
    readonly baseline: ExecutedCellV1
    readonly candidate: ExecutedCellV1
  } | null
  if (lens.lane === 'renderedDifferential')
    pair = completeRenderedPair(
      request,
      outcomes,
      lens.scenarioId,
      lensAuthority.status === 'decoded'
        ? lensAuthority.renderedProducerLane
        : undefined
    )
  else pair = preservedPair(outcomes, lens.lane, lens.scenarioId)
  if (pair === null)
  {
    const producerLane =
      lens.lane === 'renderedDifferential'
        ? lensAuthority.status === 'decoded'
          ? lensAuthority.renderedProducerLane
          : undefined
        : lens.lane
    const boundedObservation =
      producerLane !== undefined &&
      pairHasBoundedObservationIssue(outcomes, producerLane, lens.scenarioId)
    return noProjectedEvidence(
      unavailablePreservation(
        lens,
        boundedObservation
          ? 'a bounded runtime observation refused before retaining a complete comparison pair'
          : lens.lane === 'renderedDifferential'
            ? 'complete retained baseline/candidate browser frames are unavailable'
            : 'the exact baseline/candidate execution pair is unavailable',
        boundedObservation ? 'inconclusive' : 'unavailable'
      )
    )
  }
  const baselineFacet = toEditRuntimeIdentityFacet(pair.baseline)
  const candidateFacet = toEditRuntimeIdentityFacet(pair.candidate)
  if (baselineFacet === null || candidateFacet === null)
    return noProjectedEvidence(
      unavailablePreservation(
        lens,
        'one exact runtime identity facet is unavailable',
        'inconclusive'
      )
    )
  if (lensAuthority.status === 'refused')
    return noProjectedEvidence(
      unavailablePreservation(
        lens,
        `lens policy decoder refused: ${lensAuthority.reason}`
      )
    )
  const spec = lensAuthority.spec
  const validated = validateBehavioralLensSpecs([spec])
  if (
    !validated.ok ||
    spec.kind !== lensSpecKind(lens) ||
    !spec.required ||
    spec.appliesTo === 'runtime-runtime'
  )
    return noProjectedEvidence(
      unavailablePreservation(
        lens,
        'the retained lens policy does not match its activated lens'
      )
    )
  const result = evaluateEditBehavioralDifferentialV1({
    comparisonKind: 'baseline-candidate',
    left: {
      side: 'baseline',
      lane: pair.baseline.cell.lane,
      trace: pair.baseline.trace,
      lowered: pair.baseline.lowered,
      actions: pair.baseline.actions,
    },
    right: {
      side: 'candidate',
      lane: pair.candidate.cell.lane,
      trace: pair.candidate.trace,
      lowered: pair.candidate.lowered,
      actions: pair.candidate.actions,
    },
    semanticPolicySha256: scenario.semanticSha256,
    seed: scenario.policy.seed,
    fixedDateMs: scenario.policy.fixedDateMs,
    specs: [spec],
    runtimeProjection: {
      baseline: baselineFacet,
      candidate: candidateFacet,
      policy: {
        scenarioId: lens.scenarioId,
        lens,
        bindings: projectionBindings(request),
        masks: request.plan.masks,
        nameTransitions: request.projectionAuthority.nameTransitions,
        targetMembershipAuthorizations:
          request.projectionAuthority.targetMembershipAuthorizations,
      },
    },
  })
  if (result.status !== 'evaluated')
    return noProjectedEvidence(
      unavailablePreservation(
        lens,
        `${result.reason}: ${result.detail}`,
        result.status === 'inconclusive' ? 'inconclusive' : 'unavailable'
      )
    )
  const lensResult = result.evidence.report.results.find(
    (entry) => entry.specId === spec.id
  )
  if (lensResult === undefined)
    return noProjectedEvidence(
      unavailablePreservation(
        lens,
        'the unchanged comparator omitted the retained lens',
        'inconclusive'
      )
    )
  const outcome: EditPreservationLensObservationV1['outcome'] =
    lensResult.verdict === 'agree'
      ? 'agreed'
      : lensResult.verdict === 'diverge'
        ? 'diverged'
        : 'inconclusive'
  return Object.freeze({
    observation: {
      lensSha256: editPreservationLensRowSha256V1(lens),
      scenarioId: lens.scenarioId,
      lane: lens.lane,
      lensKind: lens.lensKind,
      outcome,
      comparisonSha256: editRuntimeHashV1(
        'edit-production-preservation-comparison-v1',
        result.evidence
      ),
      ...(lensResult.verdict === 'inconclusive'
        ? {
            reason: lensResult.inconclusiveReason ?? 'comparator inconclusive',
          }
        : {}),
    },
    projectedEvidence: result.evidence,
  })
}

function requiredUnavailableResult(
  requirement: EditEvaluationPlanV1['laneRequirements'][number]
): 'unavailable' | 'inconclusive' | null
{
  return requirement.disposition === 'required'
    ? requirement.requiredUnavailableResult
    : null
}

function laneStatuses(input: {
  readonly request: EditProductionEvaluationRequestV1
  readonly preflightAvailable: boolean
  readonly decoderAvailable: boolean
  readonly outcomes: ReadonlyMap<string, CellOutcomeV1>
  readonly preservation: readonly EditPreservationLensObservationV1[]
}): readonly EditLaneStatusV1[]
{
  return Object.freeze(
    input.request.plan.plan.laneRequirements.map((requirement) =>
    {
      let availability: EditLaneStatusV1['availability'] = 'unavailable'
      let reason: string | undefined
      if (requirement.disposition === 'forbidden')
        reason = 'the activated plan forbids this lane'
      else if (requirement.lane === 'projectPreflight')
      {
        availability = input.preflightAvailable ? 'available' : 'unavailable'
        if (!input.preflightAvailable)
          reason = 'one exact artifact failed semantic preflight'
      }
      else if (
        requirement.lane === 'officialHeadless' ||
        requirement.lane === 'officialBrowser' ||
        requirement.lane === 'turboWarpBrowser'
      )
      {
        const cells = [...input.outcomes.values()].filter(
          (outcome) => outcome.cell.lane === requirement.lane
        )
        const complete = cells.every(
          (outcome) =>
            isExecuted(outcome) &&
            cellHasCompleteSemanticDrive(outcome) &&
            outcome.lineage?.status === 'bound' &&
            outcome.runtimeIdentityFacet?.status === 'bound' &&
            outcome.runtimeObservations.length > 0 &&
            outcome.runtimeObservations.every(
              (record) => record.capture.status === 'observed'
            ) &&
            outcome.trace.issues.every(
              (issue) => issue.responsibility !== 'infrastructure'
            )
        )
        availability =
          input.decoderAvailable && cells.length > 0 && complete
            ? 'available'
            : input.decoderAvailable &&
                cells.length > 0 &&
                cells.every(isExecuted)
              ? 'inconclusive'
              : 'unavailable'
        if (availability !== 'available')
          reason = input.decoderAvailable
            ? 'one or more reserved execution cells were refused'
            : 'no frozen runtime policy decoder is configured'
      }
      else if (requirement.lane === 'renderedDifferential')
      {
        const observations = input.preservation.filter(
          (entry) => entry.lane === 'renderedDifferential'
        )
        availability =
          observations.length > 0 &&
          observations.every((entry) => entry.outcome !== 'unavailable')
            ? observations.some((entry) => entry.outcome === 'inconclusive')
              ? 'inconclusive'
              : 'available'
            : 'unavailable'
        if (availability !== 'available')
          reason =
            'rendered differential requires complete typed baseline/candidate browser evidence'
      }
      else reason = 'native visual judgment is staged asynchronously'
      return Object.freeze({
        lane: requirement.lane,
        disposition: requirement.disposition,
        availability,
        requiredUnavailableResult: requiredUnavailableResult(requirement),
        ...(reason === undefined ? {} : { reason }),
      })
    })
  )
}

function emptyRuntimeIdentity(): EditProductionRuntimeIdentityV1
{
  return runtimeIdentity([])
}

function authorityRecordV1(value: unknown): Readonly<Record<string, unknown>>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(
      'retained-authority-invalid',
      'retained evaluation authority is not an object'
    )
  return value as Readonly<Record<string, unknown>>
}

function hydratedCapturedMediaV1(
  media: readonly EditProductionReplayMediaV1[]
): readonly CapturedMediaV1[]
{
  return Object.freeze(
    media.map((entry) =>
    {
      if (
        entry.bytes.byteLength !== entry.byteLength ||
        sha256(entry.bytes) !== entry.payloadSha256
      )
        fail(
          'retained-media-invalid',
          `retained media ${entry.payloadSha256} differs from its exact bytes`
        )
      if (
        entry.evidenceKind === 'screenshot' &&
        entry.mediaType === 'image/png' &&
        entry.frameId !== undefined
      )
      {
        const decoded = decodeRuntimePngRgbaV1(entry.bytes)
        if (entry.width !== decoded.width || entry.height !== decoded.height)
          fail(
            'retained-media-invalid',
            `retained frame ${entry.frameId} differs from its decoded geometry`
          )
        return Object.freeze({
          ...entry,
          rgba: decoded.rgba,
        })
      }
      return Object.freeze({ ...entry })
    })
  )
}

export async function rederiveEditProductionDeterministicV1(input: {
  readonly request: EditProductionEvaluationRequestV1
  readonly authority: EditProductionDeterministicAuthorityV1
  readonly baselinePreflight: unknown
  readonly candidatePreflight: unknown
  readonly matrixProjection: unknown
  readonly traceProjections: readonly unknown[]
  readonly mediaByCell: ReadonlyMap<
    string,
    readonly EditProductionReplayMediaV1[]
  >
  readonly externalRequests: readonly EditProductionExternalRequestV1[]
}): Promise<EditProductionDeterministicRederivationV1>
{
  const request = input.request
  const policies = policyMap(request.policies)
  const scenarios = scenariosFromPolicies(request.plan.plan, policies)
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: request.plan.plan.laneRequirements,
    scenarios: scenarios.map((entry) => ({
      scenarioId: entry.policy.scenarioId,
      applicability: entry.policy.applicability,
      semanticPolicySha256: entry.semanticSha256,
    })),
    artifactSides: ['baseline', 'candidate'],
    limitOverrides: { ...request.plan.resourceLimitOverrides },
  })
  if (
    reservation.status === 'refused' ||
    reservation.matrixSha256 !== request.matrixSha256
  )
    fail(
      'retained-authority-invalid',
      'retained deterministic authority does not reopen its matrix'
    )
  const matrixProjection = authorityRecordV1(input.matrixProjection)
  const rows = matrixProjection['cells']
  if (!Array.isArray(rows) || rows.length !== reservation.cells.length)
    fail(
      'retained-authority-invalid',
      'retained deterministic authority has an incomplete matrix'
    )
  const [baselinePreflight, candidatePreflight] = await Promise.all([
    inspectSemanticEditArtifact(request.baselineBytes),
    inspectSemanticEditArtifact(request.candidateBytes),
  ])
  if (
    !sameValue(
      input.baselinePreflight,
      preflightProjection('baseline', baselinePreflight)
    ) ||
    !sameValue(
      input.candidatePreflight,
      preflightProjection('candidate', candidatePreflight)
    )
  )
    fail(
      'retained-authority-invalid',
      'retained preflight authority does not reconstruct from exact bytes'
    )
  let baselineArtifact: EditRuntimeArtifactBindingV1 | null = null
  let candidateArtifact: EditRuntimeArtifactBindingV1 | null = null
  let runtimeBindingFailure: string | null = null
  if (baselinePreflight.ok && candidatePreflight.ok)
    try
    {
      ;[baselineArtifact, candidateArtifact] = await Promise.all([
        bindEditRuntimeArtifactV1(
          request.baselineBytes,
          request.baselineRuntime.assignment
        ),
        bindEditRuntimeArtifactV1(
          request.candidateBytes,
          request.candidateRuntime.assignment
        ),
      ])
    }
    catch (error)
    {
      baselineArtifact = null
      candidateArtifact = null
      runtimeBindingFailure = `runtime binding refused: ${unknownErrorMessage(error)}`
    }
  const lowered = new Map<string, EditLoweredScenarioV1>()
  const loweringLimitations: string[] = []
  for (const scenario of scenarios)
    for (const side of ['baseline', 'candidate'] as const)
    {
      if (
        scenario.policy.applicability === 'candidateOnly' &&
        side === 'baseline'
      )
        continue
      if (baselineArtifact === null || candidateArtifact === null) continue
      const result = lowerEditScenarioPolicyV1({
        policy: scenario.policy,
        semanticPolicySha256: scenario.semanticSha256,
        side,
        bindings:
          side === 'baseline'
            ? request.baselineRuntime.bindings
            : request.candidateRuntime.bindings,
        artifact: side === 'baseline' ? baselineArtifact : candidateArtifact,
      })
      if (result.status === 'lowered')
        lowered.set(
          `${scenario.policy.scenarioId}\u0000${side}`,
          result.lowered
        )
      else
        loweringLimitations.push(
          `lowering ${scenario.policy.scenarioId}/${side}: ${result.failures.map((failure) => failure.reason).join(', ')}`
        )
    }
  const predispatchLimitations = Object.freeze([
    ...(input.authority.runtimePolicy.status === 'refused'
      ? [input.authority.runtimePolicy.reason]
      : []),
    ...(runtimeBindingFailure === null ? [] : [runtimeBindingFailure]),
    ...loweringLimitations,
  ])
  const traces = new Map<string, Readonly<Record<string, unknown>>>()
  for (const candidate of input.traceProjections)
  {
    const projection = authorityRecordV1(candidate)
    const cell = authorityRecordV1(projection['matrix'])
    const key = cellKey({
      lane: cell['lane'] as EditEvaluationLaneV1,
      scenarioId: String(cell['scenarioId']),
      side: cell['side'] as 'baseline' | 'candidate',
    })
    if (traces.has(key))
      fail('retained-authority-invalid', `retained trace repeats ${key}`)
    traces.set(key, projection)
  }
  if (input.authority.runtimePolicy.status === 'decoded')
    runtimeCellPolicies(input.authority.runtimePolicy.value, reservation.cells)
  if (
    input.authority.lensPolicies.length !==
      request.plan.plan.preservationLenses.length ||
    input.authority.projectedDifferentials.length !==
      request.plan.plan.preservationLenses.length
  )
    fail(
      'retained-authority-invalid',
      'retained lens authority does not cover every activated lens'
    )
  const outcomes = new Map<string, CellOutcomeV1>()
  for (let index = 0; index < reservation.cells.length; index++)
  {
    const cell = reservation.cells[index]!
    const key = cellKey(cell)
    const row = authorityRecordV1(rows[index])
    if (!sameValue(row['cell'], cell))
      fail(
        'retained-authority-invalid',
        `retained matrix row ${index} names a different cell`
      )
    if (row['status'] === 'refused')
    {
      const runtimeLane =
        cell.lane === 'officialHeadless' ||
        cell.lane === 'officialBrowser' ||
        cell.lane === 'turboWarpBrowser'
      const loweredScenario = lowered.get(
        `${cell.scenarioId}\u0000${cell.side}`
      )
      const expected = !runtimeLane
        ? {
            availability: 'unavailable' as const,
            reason:
              cell.lane === 'nativeVisual'
                ? 'native visual evidence is staged externally'
                : 'rendered differential is derived from retained browser pairs',
          }
        : input.authority.runtimePolicy.status === 'refused' ||
            loweredScenario === undefined
          ? {
              availability: 'unavailable' as const,
              reason:
                'the exact runtime policy or independently lowered side is unavailable',
            }
          : fail(
              'retained-authority-invalid',
              `retained runtime cell ${index} has no pre-dispatch refusal cause`
            )
      if (
        row['availability'] !== expected.availability ||
        row['reason'] !== expected.reason
      )
        fail(
          'retained-authority-invalid',
          `retained refused cell ${index} differs from its raw cause`
        )
      outcomes.set(key, { cell, ...expected })
      continue
    }
    if (row['status'] === 'pendingExternal')
    {
      if (cell.lane !== 'renderedDifferential' && cell.lane !== 'nativeVisual')
        fail(
          'retained-authority-invalid',
          `retained matrix cell ${index} cannot await external evidence`
        )
      const expectedRequestSha256s = input.externalRequests
        .filter((request) =>
          request.matrixCells.some(
            (boundCell) => boundCell.ordinal === cell.ordinal
          )
        )
        .map((request) => request.requestSha256)
      if (
        expectedRequestSha256s.length === 0 ||
        !sameValue(row['requestSha256s'], expectedRequestSha256s)
      )
        fail(
          'retained-authority-invalid',
          `retained pending cell ${index} does not bind its exact external requests`
        )
      outcomes.set(key, {
        cell,
        availability: 'unavailable',
        reason:
          cell.lane === 'nativeVisual'
            ? 'native visual evidence is staged externally'
            : 'rendered differential is derived from retained browser pairs',
      })
      continue
    }
    if (row['status'] !== 'executed')
      fail(
        'retained-authority-invalid',
        `retained matrix cell ${index} has no terminal outcome`
      )
    const projection = traces.get(key)
    const loweredScenario = lowered.get(`${cell.scenarioId}\u0000${cell.side}`)
    if (projection === undefined || loweredScenario === undefined)
      fail(
        'retained-authority-invalid',
        `retained executed cell ${index} has no exact trace or lowering`
      )
    const issues = projection['issues'] as VmTrace['issues']
    const trace = {
      ok: projection['traceOk'],
      runtime: 'retained-replay',
      runtimeDescriptor: projection['runtimeDescriptor'],
      observations: projection['observationTrace'],
      snapshots: projection['snapshots'],
      finalSnapshot: projection['finalSnapshot'],
      errors: [],
      issues,
      runtimeLog: {},
    } as unknown as VmTrace
    const actions = projection[
      'actions'
    ] as readonly IdentityBoundActionRecordV1[]
    const outcome: ExecutedCellV1 = {
      cell,
      lowered: loweredScenario,
      trace,
      drive: projection['drive'] as IdentityBoundDriveResultV1 | null,
      actions,
      lineage: projection['lineage'] as ExecutedCellV1['lineage'],
      runtimeIdentityFacet: projection[
        'runtimeIdentityFacet'
      ] as RuntimeIdentityFacetV1 | null,
      runtimeObservations: projection[
        'runtimeObservations'
      ] as ExecutedCellV1['runtimeObservations'],
      requestSha256: String(row['requestSha256']),
      requestProjection: projection['requestProjection'],
      resultSha256: String(row['resultSha256']),
      media: hydratedCapturedMediaV1(input.mediaByCell.get(key) ?? []),
    }
    outcomes.set(key, Object.freeze(outcome))
  }
  const preservationEvaluations = request.plan.plan.preservationLenses.map(
    (lens, index) =>
      preservationObservation({
        request,
        lens,
        scenarios,
        lensAuthority: input.authority.lensPolicies[index]!,
        outcomes,
      })
  )
  for (const [index, evaluation] of preservationEvaluations.entries())
  {
    const retained = input.authority.projectedDifferentials[index]
    if (
      retained?.lensIndex !== index ||
      !sameValue(retained.evidence, evaluation.projectedEvidence)
    )
      fail(
        'retained-authority-invalid',
        `retained projected differential ${index} does not reconstruct`
      )
  }
  const preservation = preservationEvaluations.map(
    (evaluation) => evaluation.observation
  )
  const executedCells = [...outcomes.values()].filter(isExecuted)
  const rederivedLimitations = Object.freeze([
    ...predispatchLimitations,
    ...optionalResourceIssueLimitationsV1(outcomes),
  ])
  if (!sameValue(input.authority.limitations, rederivedLimitations))
    fail(
      'retained-authority-invalid',
      'retained limitations do not reconstruct from raw failure authority'
    )
  const resourceCodes = new Set<string>()
  for (const cell of executedCells)
  {
    if (cell.cell.disposition !== 'required') continue
    for (const issue of cell.trace.issues)
      if (isBoundedResourceIssueCodeV1(issue.code))
        resourceCodes.add(issue.code)
  }
  return Object.freeze({
    identity:
      executedCells.length === 0
        ? emptyRuntimeIdentity()
        : runtimeIdentity(executedCells),
    laneStatuses: laneStatuses({
      request,
      preflightAvailable: baselinePreflight.ok && candidatePreflight.ok,
      decoderAvailable: input.authority.runtimePolicy.status === 'decoded',
      outcomes,
      preservation,
    }),
    candidateObservations: Object.freeze(
      request.plan.plan.requiredRuntimeChanges
        .filter((predicate) => predicate.kind !== 'visualCriterion')
        .map((predicate) => ({
          ...candidateObservation(request, predicate, outcomes),
          predicateSha256: editRuntimePredicateRowSha256V1(predicate),
        }))
    ),
    preservationObservations: Object.freeze(preservation),
    baselineDiagnostics: diagnosticsFor(request, 'baseline', baselinePreflight),
    candidateDiagnostics: diagnosticsFor(
      request,
      'candidate',
      candidatePreflight
    ),
    allowedNewDiagnosticFingerprints:
      input.authority.runtimePolicy.status === 'decoded'
        ? Object.freeze([
            ...input.authority.runtimePolicy.value
              .allowedNewDiagnosticFingerprints,
          ])
        : Object.freeze([]),
    boundedResourceIssueCodes: Object.freeze([...resourceCodes].sort()),
    fixedTimePolicySha256: editRuntimeHashV1(
      'edit-production-fixed-time-policy-v1',
      scenarios.map((entry) => ({
        scenarioId: entry.policy.scenarioId,
        fixedDateMs: entry.policy.fixedDateMs,
      }))
    ),
    seedSetSha256: editRuntimeHashV1(
      'edit-production-seed-set-v1',
      scenarios.map((entry) => ({
        scenarioId: entry.policy.scenarioId,
        seed: entry.policy.seed,
      }))
    ),
    limitations: rederivedLimitations,
  })
}

function requiredBrowserProducerLanesV1(
  plan: EditEvaluationPlanV1
): readonly ('officialBrowser' | 'turboWarpBrowser')[]
{
  return Object.freeze(
    plan.laneRequirements.flatMap((requirement) =>
      requirement.disposition === 'required' &&
      (requirement.lane === 'officialBrowser' ||
        requirement.lane === 'turboWarpBrowser')
        ? [requirement.lane]
        : []
    )
  )
}

export function deriveEditProductionExternalRequestsV1(input: {
  readonly evaluationId: string
  readonly plan: EditEvaluationPlanV1
  readonly policies: readonly EditProductionPolicyArtifactV1[]
  readonly matrixCells: readonly EditEvaluationMatrixCellV1[]
  readonly sources: readonly EditProductionExternalSelectionSourceV1[]
}): readonly EditProductionExternalRequestV1[]
{
  const policies = policyMap(input.policies)
  const requiredBrowserLanes = requiredBrowserProducerLanesV1(input.plan)
  const requests: EditProductionExternalRequestV1[] = []
  const claimedRequiredExternalOrdinals = new Set<number>()
  const producerLanesFor = (
    lane: Extract<RuntimePredicateV1, { kind: 'visualCriterion' }>['lane']
  ): readonly ('officialBrowser' | 'turboWarpBrowser')[] =>
  {
    if (lane === 'officialBrowser' || lane === 'turboWarpBrowser')
    {
      if (!requiredBrowserLanes.includes(lane))
        fail(
          'external-producer-lane-not-required',
          `visual predicate producer lane ${lane} is not required by the activated plan`
        )
      return Object.freeze([lane])
    }
    if (requiredBrowserLanes.length === 0)
      fail(
        'external-producer-lane-missing',
        `visual predicate lane ${lane} has no required browser evidence producer`
      )
    return requiredBrowserLanes
  }
  input.plan.requiredRuntimeChanges.forEach((predicate, predicateIndex) =>
  {
    if (predicate.kind !== 'visualCriterion') return
    const producerLanes = producerLanesFor(predicate.lane)
    const matrixCells = input.matrixCells.filter(
      (cell) =>
        cell.lane === predicate.lane && cell.scenarioId === predicate.scenarioId
    )
    if (matrixCells.length === 0)
      fail(
        'external-matrix-cell-missing',
        `visual predicate ${predicate.objectiveId} has no pre-reserved matrix cell`
      )
    const candidateCells = matrixCells.filter(
      (cell) => cell.side === 'candidate'
    )
    if (candidateCells.length !== 1)
      fail(
        'external-matrix-cell-ambiguous',
        `visual predicate ${predicate.objectiveId} does not resolve one candidate matrix cell`
      )
    const evidenceSelections = input.sources.flatMap((source) =>
    {
      if (
        source.cell.side !== 'candidate' ||
        source.cell.scenarioId !== predicate.scenarioId ||
        !producerLanes.includes(
          source.cell.lane as 'officialBrowser' | 'turboWarpBrowser'
        )
      )
        return []
      const selectedPayloadSha256s = source.frames
        .filter((frame) =>
          predicate.evidenceWindow.windowKind === 'label'
            ? frame.snapshotLabel === predicate.evidenceWindow.label
            : frame.tick >= predicate.evidenceWindow.firstTick &&
              frame.tick <= predicate.evidenceWindow.lastTick
        )
        .map((frame) => frame.payloadSha256)
      return selectedPayloadSha256s.length === 0
        ? []
        : [
            Object.freeze({
              cell: source.cell,
              evidenceContentSha256: source.evidenceContentSha256,
              selectedPayloadSha256s: Object.freeze(selectedPayloadSha256s),
            }),
          ]
    })
    if (evidenceSelections.length !== producerLanes.length)
      fail(
        'external-evidence-window-unavailable',
        `visual predicate ${predicate.objectiveId} has no exact candidate frame window for every required producer lane`
      )
    const evidenceContentSha256s = Object.freeze(
      evidenceSelections.map((selection) => selection.evidenceContentSha256)
    )
    const requestAuthority = {
      objectiveId: predicate.objectiveId,
      predicate,
      matrixCells,
      producerLanes,
      evidenceSelections,
      evidenceContentSha256s,
    }
    const requestSha256 = editRuntimeHashV1(
      'edit-production-native-visual-request-v1',
      requestAuthority
    )
    for (const cell of matrixCells)
      if (cell.disposition === 'required')
        claimedRequiredExternalOrdinals.add(cell.ordinal)
    requests.push(
      Object.freeze({
        requestArtifactId: editRuntimeHashV1(
          'edit-production-native-visual-request-artifact-v1',
          {
            evaluationId: input.evaluationId,
            predicateIndex,
            requestSha256,
          }
        ),
        objectiveId: predicate.objectiveId,
        lane: predicate.lane,
        requestSha256,
        semanticProjection: Object.freeze(requestAuthority),
        evidenceContentSha256s,
        matrixCells: Object.freeze(matrixCells),
        producerLanes,
        evidenceSelections: Object.freeze(evidenceSelections),
        evidenceWindow: Object.freeze({ ...predicate.evidenceWindow }),
        predicateSha256: editRuntimePredicateRowSha256V1(predicate),
      })
    )
  })
  const nativePolicySha256 = input.plan.nativeEvidencePolicySha256
  if (nativePolicySha256 !== undefined)
  {
    const nativePolicy = requiredPolicy(
      policies,
      nativePolicySha256,
      'nativeEvidence'
    )
    if (requiredBrowserLanes.length === 0)
      fail(
        'external-producer-lane-missing',
        'native evidence policy has no required browser evidence producer'
      )
    const matrixCells = input.matrixCells.filter(
      (cell) => cell.lane === 'nativeVisual'
    )
    if (matrixCells.length === 0)
      fail(
        'external-matrix-cell-missing',
        'native evidence policy has no pre-reserved nativeVisual matrix cells'
      )
    const evidenceSelections = input.sources.flatMap((source) =>
      requiredBrowserLanes.includes(
        source.cell.lane as 'officialBrowser' | 'turboWarpBrowser'
      ) && source.frames.length > 0
        ? [
            Object.freeze({
              cell: source.cell,
              evidenceContentSha256: source.evidenceContentSha256,
              selectedPayloadSha256s: Object.freeze(
                source.frames.map((frame) => frame.payloadSha256)
              ),
            }),
          ]
        : []
    )
    const expectedSourceCount =
      requiredBrowserLanes.length *
      new Set(matrixCells.map((cell) => `${cell.scenarioId}\u0000${cell.side}`))
        .size
    if (evidenceSelections.length !== expectedSourceCount)
      fail(
        'external-evidence-window-unavailable',
        'native evidence policy does not have exact retained media for every bound matrix side'
      )
    const evidenceContentSha256s = Object.freeze(
      evidenceSelections.map((selection) => selection.evidenceContentSha256)
    )
    const objectiveId = `native-policy:${nativePolicy.binding.bindingId}`
    const requestAuthority = {
      objectiveId,
      policyBinding: nativePolicy.binding,
      policyCanonicalByteLength: nativePolicy.canonicalByteLength,
      matrixCells,
      producerLanes: requiredBrowserLanes,
      evidenceSelections,
      evidenceContentSha256s,
    }
    const requestSha256 = editRuntimeHashV1(
      'edit-production-native-evidence-policy-request-v1',
      requestAuthority
    )
    for (const cell of matrixCells)
      if (cell.disposition === 'required')
        claimedRequiredExternalOrdinals.add(cell.ordinal)
    requests.push(
      Object.freeze({
        requestArtifactId: editRuntimeHashV1(
          'edit-production-native-policy-request-artifact-v1',
          { evaluationId: input.evaluationId, requestSha256 }
        ),
        objectiveId,
        lane: 'nativeVisual',
        requestSha256,
        semanticProjection: Object.freeze(requestAuthority),
        evidenceContentSha256s,
        matrixCells: Object.freeze(matrixCells),
        producerLanes: requiredBrowserLanes,
        evidenceSelections: Object.freeze(evidenceSelections),
      })
    )
  }
  const unclaimed = input.matrixCells.filter(
    (cell) =>
      cell.disposition === 'required' &&
      (cell.lane === 'renderedDifferential' || cell.lane === 'nativeVisual') &&
      !claimedRequiredExternalOrdinals.has(cell.ordinal)
  )
  if (unclaimed.length !== 0)
    fail(
      'external-matrix-cell-unclaimed',
      `required external matrix cells are not bound to requests: ${unclaimed.map((cell) => cell.ordinal).join(', ')}`
    )
  return Object.freeze(requests)
}

export async function validateEditProductionEvaluationExecutionV1(input: {
  readonly request: EditProductionEvaluationRequestV1
  readonly result: Omit<EditProductionEvaluationResultV1, 'evidencePayloads'>
  readonly evidencePayloads: readonly EditProductionEvidencePayloadV1[]
}): Promise<void>
{
  const { request, result } = input
  if (
    result.evidenceArtifactIndex.length !== input.evidencePayloads.length ||
    result.evidence.length > MAX_CERTIFICATE_EVIDENCE_ENTRIES_V1
  )
    fail(
      'evaluation-evidence-bijection-invalid',
      'evaluation result payload and evidence indexes are not bijective'
    )
  const evidenceByContent = new Map(
    result.evidence.map((entry) => [entry.contentSha256, entry] as const)
  )
  if (evidenceByContent.size !== result.evidence.length)
    fail(
      'evaluation-evidence-bijection-invalid',
      'evaluation result repeats a certificate evidence content identity'
    )
  const revisionBinding: EditEvaluationRevisionBindingV1 = {
    revision: request.revision,
    historySha256: request.historySha256,
    changeContractSha256: request.changeContractSha256,
    evaluationPlanSha256: request.plan.evaluationPlanSha256,
  }
  const rawPayloads = new Map<string, EditProductionEvidencePayloadV1>()
  const structured: {
    index: EditProductionEvidenceArtifactIndexEntryV1
    projection: Readonly<Record<string, unknown>>
    evidence: EditProductionEvidenceEntryV1
  }[] = []
  const indexedContents = new Set<string>()
  for (let index = 0; index < input.evidencePayloads.length; index++)
  {
    const payload = input.evidencePayloads[index]!
    const retainedIndex = result.evidenceArtifactIndex[index]!
    const { bytes: _bytes, ...payloadIndex } = payload
    if (
      !sameValue(payloadIndex, retainedIndex) ||
      payload.bytes.byteLength !== payload.byteLength ||
      sha256(payload.bytes) !== payload.payloadSha256
    )
      fail(
        'evaluation-evidence-index-invalid',
        `evaluation evidence payload ${index} differs from its exact index`
      )
    if (payload.contentSha256 === null)
    {
      if (
        payload.evidenceKind !== null ||
        payload.lane !== null ||
        payload.side !== undefined ||
        payload.scenarioId !== undefined ||
        rawPayloads.has(payload.payloadSha256)
      )
        fail(
          'evaluation-evidence-index-invalid',
          `raw evaluation payload ${index} has false or duplicate authority`
        )
      rawPayloads.set(payload.payloadSha256, payload)
      continue
    }
    if (
      payload.evidenceKind === null ||
      payload.lane === null ||
      indexedContents.has(payload.contentSha256)
    )
      fail(
        'evaluation-evidence-index-invalid',
        `certificate evidence payload ${index} has incomplete or duplicate authority`
      )
    indexedContents.add(payload.contentSha256)
    const wrapped = wrapEditEvaluationEvidenceV1({
      binding: revisionBinding,
      evidenceKind: payload.evidenceKind,
      mediaType: payload.mediaType,
      payloadSha256: payload.payloadSha256,
      byteLength: payload.byteLength,
      lane: payload.lane,
      ...(payload.side === undefined ? {} : { side: payload.side }),
      ...(payload.scenarioId === undefined
        ? {}
        : { scenarioId: payload.scenarioId }),
    })
    const evidence = evidenceByContent.get(payload.contentSha256)
    if (
      wrapped.contentSha256 !== payload.contentSha256 ||
      evidence === undefined
    )
      fail(
        'evaluation-evidence-wrapper-invalid',
        `certificate evidence payload ${index} does not reconstruct its wrapper`
      )
    let projection: unknown
    try
    {
      projection = JSON.parse(new TextDecoder().decode(payload.bytes))
    }
    catch
    {
      fail(
        'evaluation-evidence-payload-invalid',
        `structured evaluation payload ${index} is not JSON`
      )
    }
    if (
      projection === null ||
      typeof projection !== 'object' ||
      Array.isArray(projection) ||
      sha256(canonicalJsonBytesV1(projection)) !== payload.payloadSha256
    )
      fail(
        'evaluation-evidence-payload-invalid',
        `structured evaluation payload ${index} is not exact canonical JSON`
      )
    structured.push({
      index: retainedIndex,
      projection: projection as Readonly<Record<string, unknown>>,
      evidence,
    })
  }
  if (
    indexedContents.size !== result.evidence.length ||
    [...evidenceByContent.keys()].some(
      (contentSha256) => !indexedContents.has(contentSha256)
    )
  )
    fail(
      'evaluation-evidence-bijection-invalid',
      'certificate evidence and payload indexes are not bijective'
    )
  let matrixProjection: Readonly<Record<string, unknown>> | null = null
  let baselinePreflight: unknown | null = null
  let candidatePreflight: unknown | null = null
  const traces: unknown[] = []
  const traceByCell = new Map<string, Readonly<Record<string, unknown>>>()
  const mediaByCell = new Map<string, EditProductionReplayMediaV1[]>()
  const sources: EditProductionExternalSelectionSourceV1[] = []
  const referencedRawPayloads = new Set<string>()
  for (const retained of structured)
  {
    const { index, projection, evidence } = retained
    if (index.evidenceKind === 'runtimeTrace')
    {
      const cell = authorityRecordV1(projection['matrix'])
      const key = cellKey({
        lane: cell['lane'] as EditEvaluationLaneV1,
        scenarioId: String(cell['scenarioId']),
        side: cell['side'] as 'baseline' | 'candidate',
      })
      if (
        traceByCell.has(key) ||
        evidence.binding.requestSha256 !==
          editRuntimeHashV1(
            'edit-production-runtime-request',
            projection['requestProjection']
          ) ||
        evidence.binding.resultSha256 !==
          editRuntimeHashV1('edit-production-runtime-result', projection)
      )
        fail(
          'evaluation-runtime-evidence-invalid',
          `runtime trace ${key} does not reconstruct its exact request/result authority`
        )
      traceByCell.set(key, projection)
      traces.push(projection)
      continue
    }
    if (index.evidenceKind === 'structuredState')
    {
      if ('cells' in projection && 'matrixSha256' in projection)
      {
        if (matrixProjection !== null)
          fail(
            'evaluation-matrix-evidence-invalid',
            'evaluation retains more than one matrix projection'
          )
        matrixProjection = projection
      }
      else if (projection['side'] === 'baseline')
        baselinePreflight = projection
      else if (projection['side'] === 'candidate')
        candidatePreflight = projection
      continue
    }
  }
  for (const retained of structured)
  {
    const { index, projection, evidence } = retained
    if (index.evidenceKind !== 'screenshot' && index.evidenceKind !== 'video')
      continue
    const cell = authorityRecordV1(projection['matrixCell'])
    const typedCell = cell as unknown as EditEvaluationMatrixCellV1
    const key = cellKey(typedCell)
    const entries = projection['entries']
    if (!Array.isArray(entries))
      fail(
        'evaluation-media-evidence-invalid',
        `media projection ${key} has no bounded entries`
      )
    const media: EditProductionReplayMediaV1[] = []
    for (const candidate of entries)
    {
      const entry = authorityRecordV1(candidate)
      const payloadSha256 = String(entry['payloadSha256'])
      const raw = rawPayloads.get(payloadSha256)
      if (
        raw === undefined ||
        entry['byteLength'] !== raw.byteLength ||
        entry['mediaType'] !== raw.mediaType
      )
        fail(
          'evaluation-media-evidence-invalid',
          `media projection ${key} does not join one exact raw payload`
        )
      referencedRawPayloads.add(payloadSha256)
      media.push(
        Object.freeze({
          evidenceKind: index.evidenceKind,
          mediaType: raw.mediaType as 'image/png' | 'video/webm',
          payloadSha256,
          byteLength: raw.byteLength,
          bytes: raw.bytes,
          ...(typeof entry['frameId'] === 'string'
            ? { frameId: entry['frameId'] }
            : {}),
          ...(typeof entry['width'] === 'number'
            ? { width: entry['width'] }
            : {}),
          ...(typeof entry['height'] === 'number'
            ? { height: entry['height'] }
            : {}),
        })
      )
    }
    const bucket = mediaByCell.get(key) ?? []
    bucket.push(...media)
    mediaByCell.set(key, bucket)
    if (index.evidenceKind === 'screenshot')
    {
      const observationTrace = authorityRecordV1(
        traceByCell.get(key)?.['observationTrace']
      )
      const observedMedia = authorityRecordV1(observationTrace['media'])
      const observedFrames = Array.isArray(observedMedia['frames'])
        ? observedMedia['frames']
        : []
      sources.push(
        Object.freeze({
          cell: typedCell,
          evidenceContentSha256: evidence.contentSha256,
          frames: Object.freeze(
            media.flatMap((entry) =>
            {
              if (entry.frameId === undefined) return []
              const observed = observedFrames
                .map(authorityRecordV1)
                .find(
                  (frame) =>
                    frame['id'] === entry.frameId &&
                    frame['sha256'] === entry.payloadSha256
                )
              if (
                observed === undefined ||
                !Number.isSafeInteger(observed['tick']) ||
                (observed['snapshotLabel'] !== null &&
                  typeof observed['snapshotLabel'] !== 'string')
              )
                fail(
                  'evaluation-media-evidence-invalid',
                  `frame ${entry.frameId} has no exact temporal authority`
                )
              return [
                Object.freeze({
                  payloadSha256: entry.payloadSha256,
                  frameId: entry.frameId,
                  tick: observed['tick'] as number,
                  snapshotLabel: observed['snapshotLabel'] as string | null,
                }),
              ]
            })
          ),
        })
      )
    }
  }
  if (
    referencedRawPayloads.size !== rawPayloads.size ||
    matrixProjection === null ||
    baselinePreflight === null ||
    candidatePreflight === null
  )
    fail(
      'evaluation-evidence-bijection-invalid',
      'evaluation evidence omits raw media, matrix, or exact preflight authority'
    )
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: request.plan.plan.laneRequirements,
    scenarios: scenariosFromPolicies(
      request.plan.plan,
      policyMap(request.policies)
    ).map((entry) => ({
      scenarioId: entry.policy.scenarioId,
      applicability: entry.policy.applicability,
      semanticPolicySha256: entry.semanticSha256,
    })),
    artifactSides: ['baseline', 'candidate'],
    limitOverrides: { ...request.plan.resourceLimitOverrides },
  })
  if (reservation.status === 'refused')
    fail(
      'evaluation-matrix-evidence-invalid',
      'evaluation result no longer reconstructs its matrix reservation'
    )
  const externalRequests = deriveEditProductionExternalRequestsV1({
    evaluationId: request.evaluationId,
    plan: request.plan.plan,
    policies: request.policies,
    matrixCells: reservation.cells,
    sources,
  })
  if (!sameValue(externalRequests, result.externalRequests))
    fail(
      'evaluation-external-request-invalid',
      'evaluation external requests do not reconstruct from raw evidence'
    )
  const authority = authorityRecordV1(
    matrixProjection['deterministicAuthority']
  ) as unknown as EditProductionDeterministicAuthorityV1
  const rederived = await rederiveEditProductionDeterministicV1({
    request,
    authority,
    baselinePreflight,
    candidatePreflight,
    matrixProjection,
    traceProjections: traces,
    mediaByCell,
    externalRequests,
  })
  const summaryFields = [
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
  const mismatches = summaryFields.filter(
    (field) => !sameValue(rederived[field], result[field])
  )
  if (
    mismatches.length !== 0 ||
    result.evaluatedCandidateByteLength !== request.candidateBytes.byteLength
  )
    fail(
      'evaluation-deterministic-result-invalid',
      `evaluation result does not reconstruct from raw evidence: ${mismatches.join(', ')}`
    )
}

export async function evaluateEditProductionV1(
  request: EditProductionEvaluationRequestV1,
  options: EditProductionEvaluationOptionsV1 = {}
): Promise<EditProductionEvaluationResultV1>
{
  const revisionBinding: EditEvaluationRevisionBindingV1 = {
    revision: request.revision,
    historySha256: request.historySha256,
    changeContractSha256: request.changeContractSha256,
    evaluationPlanSha256: request.plan.evaluationPlanSha256,
  }
  const policies = policyMap(request.policies)
  const scenarios = scenariosFromPolicies(request.plan.plan, policies)
  let decoded: EditDecodedRuntimePolicyV1 | null = null
  let decoderFailure: string | null = null
  const decoder =
    options.decoder ?? STRICT_FROZEN_EDIT_EVALUATION_POLICY_DECODER_V1
  try
  {
    decoded = decoder.decodeRuntimePolicy(
      requiredPolicy(
        policies,
        request.plan.plan.runtimePolicySha256,
        'runtime'
      ),
      policies
    )
  }
  catch (error)
  {
    decoderFailure = unknownErrorMessage(error)
  }
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: request.plan.plan.laneRequirements,
    scenarios: scenarios.map((entry) => ({
      scenarioId: entry.policy.scenarioId,
      applicability: entry.policy.applicability,
      semanticPolicySha256: entry.semanticSha256,
    })),
    artifactSides: ['baseline', 'candidate'],
    limitOverrides: { ...request.plan.resourceLimitOverrides },
  })
  if (reservation.status === 'refused')
    fail(
      `matrix-${reservation.reason}`,
      `evaluation matrix refused before dispatch: ${reservation.detail}`
    )
  if (reservation.matrixSha256 !== request.matrixSha256)
    fail(
      'matrix-reservation-mismatch',
      'the evaluator matrix differs from the pre-dispatch prepared reservation'
    )
  const runtimeCells = reservation.cells.filter(
    (cell) =>
      cell.lane === 'officialHeadless' ||
      cell.lane === 'officialBrowser' ||
      cell.lane === 'turboWarpBrowser'
  )
  const browserCells = runtimeCells.filter(
    (cell) =>
      cell.lane === 'officialBrowser' || cell.lane === 'turboWarpBrowser'
  )
  const externalRequestMaximum =
    request.plan.plan.requiredRuntimeChanges.filter(
      (predicate) => predicate.kind === 'visualCriterion'
    ).length +
    (request.plan.plan.nativeEvidencePolicySha256 === undefined ? 0 : 1)
  const reservedEvidenceEntries =
    1 +
    reservation.preflightArtifactCount +
    runtimeCells.length +
    browserCells.length * 2 +
    externalRequestMaximum
  if (reservedEvidenceEntries > MAX_CERTIFICATE_EVIDENCE_ENTRIES_V1)
    fail(
      'certificate-evidence-limit-exceeded',
      `the complete matrix reserves ${reservedEvidenceEntries} certificate evidence rows but the V1 limit is ${MAX_CERTIFICATE_EVIDENCE_ENTRIES_V1}`
    )
  const baselinePreflight = await inspectSemanticEditArtifact(
    request.baselineBytes
  )
  const candidatePreflight = await inspectSemanticEditArtifact(
    request.candidateBytes
  )
  const requestedSemanticSourceIdentity =
    request.semanticSourceIdentity ?? baselinePreflight.semanticSourceIdentity
  const baselineSemanticSourceIdentity =
    requestedSemanticSourceIdentity?.sourceKind === 'registeredTemplate' &&
    baselinePreflight.semanticSourceIdentity
      ? {
          ...baselinePreflight.semanticSourceIdentity,
          sourceKind: 'registeredTemplate' as const,
          templateArtifactSha256:
            requestedSemanticSourceIdentity.templateArtifactSha256,
          templateId: requestedSemanticSourceIdentity.templateId,
          templateVersion: requestedSemanticSourceIdentity.templateVersion,
        }
      : baselinePreflight.semanticSourceIdentity
  if (
    sha256(request.baselineBytes) !== request.revision.sourceArtifactSha256 ||
    baselineSemanticSourceIdentity === null ||
    !sameValue(
      baselineSemanticSourceIdentity,
      requestedSemanticSourceIdentity
    ) ||
    semanticHashV1('semantic-source', baselineSemanticSourceIdentity) !==
      request.semanticSourceSha256 ||
    sha256(request.candidateBytes) !== request.revision.candidateSha256 ||
    candidatePreflight.semanticSourceIdentity?.assetManifestSha256 !==
      request.revision.assetManifestSha256 ||
    request.revision.changeContractSha256 !== request.changeContractSha256
  )
    fail(
      'evaluation-revision-binding-mismatch',
      'exact baseline, candidate, asset manifest, source, or contract binding differs from the requested revision'
    )
  const outcomes = new Map<string, CellOutcomeV1>()
  const limitations: string[] = []
  if (decoderFailure !== null) limitations.push(decoderFailure)
  let cellPolicies: ReadonlyMap<string, EditDecodedRuntimeCellPolicyV1> =
    new Map()
  if (decoded !== null)
    cellPolicies = runtimeCellPolicies(decoded, reservation.cells)
  const preflightAvailable = baselinePreflight.ok && candidatePreflight.ok
  let baselineArtifact: EditRuntimeArtifactBindingV1 | null = null
  let candidateArtifact: EditRuntimeArtifactBindingV1 | null = null
  if (preflightAvailable)
  {
    try
    {
      ;[baselineArtifact, candidateArtifact] = await Promise.all([
        bindEditRuntimeArtifactV1(
          request.baselineBytes,
          request.baselineRuntime.assignment
        ),
        bindEditRuntimeArtifactV1(
          request.candidateBytes,
          request.candidateRuntime.assignment
        ),
      ])
    }
    catch (error)
    {
      limitations.push(
        `runtime binding refused: ${unknownErrorMessage(error)}`
      )
    }
  }
  const lowered = new Map<string, LoweredSideV1>()
  if (baselineArtifact !== null && candidateArtifact !== null)
    for (const scenario of scenarios)
      for (const side of ['baseline', 'candidate'] as const)
      {
        if (
          scenario.policy.applicability === 'candidateOnly' &&
          side === 'baseline'
        )
          continue
        const artifact =
          side === 'baseline' ? baselineArtifact : candidateArtifact
        const context =
          side === 'baseline'
            ? request.baselineRuntime
            : request.candidateRuntime
        const result = lowerEditScenarioPolicyV1({
          policy: scenario.policy,
          semanticPolicySha256: scenario.semanticSha256,
          side,
          bindings: context.bindings,
          artifact,
        })
        if (result.status === 'lowered')
          lowered.set(`${scenario.policy.scenarioId}\u0000${side}`, {
            lowered: result.lowered,
            artifact,
          })
        else
          limitations.push(
            `lowering ${scenario.policy.scenarioId}/${side}: ${result.failures.map((failure) => failure.reason).join(', ')}`
          )
      }
  const lensAuthorities = decodeLensPolicyAuthoritiesV1({
    plan: request.plan.plan,
    policies,
    decoder,
  })
  validateDecodedLensPolicyAuthoritiesV1({
    plan: request.plan.plan,
    scenarios,
    authorities: lensAuthorities,
    runtimePolicyDecoded: decoded !== null,
  })
  if (
    decoded !== null &&
    baselineArtifact !== null &&
    candidateArtifact !== null
  )
    for (const cell of runtimeCells)
      if (!lowered.has(`${cell.scenarioId}\u0000${cell.side}`))
        fail(
          'scenario-lowering-incomplete',
          `reserved cell ${cell.lane}/${cell.scenarioId}/${cell.side} has no exact lowering before dispatch`
        )
  let carriedAttemptTraceBytes = 0
  for (const cell of reservation.cells)
  {
    const key = cellKey(cell)
    if (
      cell.lane !== 'officialHeadless' &&
      cell.lane !== 'officialBrowser' &&
      cell.lane !== 'turboWarpBrowser'
    )
    {
      outcomes.set(key, {
        cell,
        reason:
          cell.lane === 'nativeVisual'
            ? 'native visual evidence is staged externally'
            : 'rendered differential is derived from retained browser pairs',
        availability: 'unavailable',
      })
      continue
    }
    const side = lowered.get(`${cell.scenarioId}\u0000${cell.side}`)
    const policy = cellPolicies.get(`${cell.lane}\u0000${cell.scenarioId}`)
    if (decoded === null || side === undefined || policy === undefined)
    {
      outcomes.set(key, {
        cell,
        reason:
          'the exact runtime policy or independently lowered side is unavailable',
        availability: 'unavailable',
      })
      continue
    }
    const executed = await executeCell({
      request,
      cell,
      lowered: side.lowered,
      artifact: side.artifact,
      runtimePolicySha256: request.plan.plan.runtimePolicySha256,
      policy,
      matrixSha256: reservation.matrixSha256,
      carriedAttemptTraceBytes,
      evidenceSink: options.evidenceSink,
    })
    outcomes.set(key, executed)
    const last = executed.runtimeObservations.at(-1)
    if (last !== undefined)
      carriedAttemptTraceBytes = last.capture.totals.attemptTraceBytes
  }
  limitations.push(...optionalResourceIssueLimitationsV1(outcomes))
  const preservationEvaluations = request.plan.plan.preservationLenses.map(
    (lens, index) =>
      preservationObservation({
        request,
        lens,
        scenarios,
        lensAuthority: lensAuthorities[index]!,
        outcomes,
      })
  )
  const preservation = preservationEvaluations.map(
    (evaluation) => evaluation.observation
  )
  const candidateObservations = request.plan.plan.requiredRuntimeChanges
    .filter((predicate) => predicate.kind !== 'visualCriterion')
    .map((predicate) => ({
      ...candidateObservation(request, predicate, outcomes),
      predicateSha256: editRuntimePredicateRowSha256V1(predicate),
    }))
  const statuses = laneStatuses({
    request,
    preflightAvailable,
    decoderAvailable: decoded !== null,
    outcomes,
    preservation,
  })
  const deterministicAuthority: EditProductionDeterministicAuthorityV1 =
    Object.freeze({
      schemaVersion: 1,
      runtimePolicy:
        decoded === null
          ? {
              status: 'refused' as const,
              reason: decoderFailure ?? 'runtime policy decoder unavailable',
            }
          : { status: 'decoded' as const, value: decoded },
      lensPolicies: lensAuthorities,
      projectedDifferentials: Object.freeze(
        preservationEvaluations.map((evaluation, index) => ({
          lensIndex: index,
          evidence: evaluation.projectedEvidence,
        }))
      ),
      limitations: Object.freeze([...limitations]),
    })
  const evidence: EditProductionEvidenceEntryV1[] = []
  const evidencePayloads: EditProductionEvidencePayloadV1[] = []
  const retainedRawPayloadSha256s = new Set<string>()
  const cellEvidenceContent = new Map<string, string[]>()
  const cellScreenshotEvidenceContent = new Map<string, string>()
  const preflightProjections = new Map<'baseline' | 'candidate', unknown>()
  for (const [side, preflight] of [
    ['baseline', baselinePreflight],
    ['candidate', candidatePreflight],
  ] as const)
  {
    const projection = preflightProjection(side, preflight)
    preflightProjections.set(side, projection)
    const requestSha256 = editRuntimeHashV1(
      'edit-production-preflight-request-v1',
      {
        side,
        artifactSha256: sha256(
          side === 'baseline' ? request.baselineBytes : request.candidateBytes
        ),
      }
    )
    const resultSha256 = editRuntimeHashV1(
      'edit-production-preflight-result-v1',
      projection
    )
    const retained = projectionEvidence({
      revisionBinding,
      evidenceKind: 'projectPreflight',
      contentEvidenceKind: 'structuredState',
      lane: 'projectPreflight',
      requestSha256,
      resultSha256,
      projection,
      side,
    })
    evidence.push(retained.evidence)
    evidencePayloads.push(retained.payload)
  }
  const executedCells = [...outcomes.values()].filter(isExecuted)
  const retainedTraceProjections: unknown[] = []
  const replayMediaByCell = new Map<
    string,
    readonly EditProductionReplayMediaV1[]
  >()
  for (const cell of executedCells)
  {
    const projection = executionTraceProjection({
      matrix: cell.cell,
      lowered: cell.lowered,
      trace: cell.trace,
      drive: cell.drive,
      actions: cell.actions,
      lineage: cell.lineage,
      runtimeIdentityFacet: cell.runtimeIdentityFacet,
      runtimeObservations: cell.runtimeObservations,
      requestProjection: cell.requestProjection,
    })
    retainedTraceProjections.push(projection)
    replayMediaByCell.set(
      cellKey(cell.cell),
      Object.freeze(
        cell.media.map(({ rgba: _rgba, ...media }) => Object.freeze(media))
      )
    )
    const retainedTrace = projectionEvidence({
      revisionBinding,
      evidenceKind: 'runtimeTrace',
      contentEvidenceKind: 'runtimeTrace',
      lane: cell.cell.lane,
      requestSha256: cell.requestSha256,
      resultSha256: cell.resultSha256,
      projection,
      side: cell.cell.side,
      scenarioId: cell.cell.scenarioId,
    })
    evidence.push(retainedTrace.evidence)
    evidencePayloads.push(retainedTrace.payload)
    const retainedForCell = [retainedTrace.evidence.contentSha256]
    for (const evidenceKind of ['screenshot', 'video'] as const)
    {
      const media = cell.media.filter(
        (entry) => entry.evidenceKind === evidenceKind
      )
      if (media.length === 0) continue
      for (const entry of media)
      {
        if (retainedRawPayloadSha256s.has(entry.payloadSha256)) continue
        retainedRawPayloadSha256s.add(entry.payloadSha256)
        evidencePayloads.push(rawMediaPayload(entry))
      }
      const mediaProjection = {
        matrixCell: cell.cell,
        evidenceKind,
        entries: media.map((entry) => ({
          payloadSha256: entry.payloadSha256,
          byteLength: entry.byteLength,
          mediaType: entry.mediaType,
          frameId: entry.frameId ?? null,
          width: entry.width ?? null,
          height: entry.height ?? null,
          rgbaSha256: entry.rgba === undefined ? null : sha256(entry.rgba),
        })),
      }
      const retainedMedia = projectionEvidence({
        revisionBinding,
        evidenceKind,
        contentEvidenceKind: evidenceKind,
        lane: cell.cell.lane,
        requestSha256: cell.requestSha256,
        resultSha256: cell.resultSha256,
        projection: mediaProjection,
        side: cell.cell.side,
        scenarioId: cell.cell.scenarioId,
      })
      evidence.push(retainedMedia.evidence)
      evidencePayloads.push(retainedMedia.payload)
      retainedForCell.push(retainedMedia.evidence.contentSha256)
      if (evidenceKind === 'screenshot')
        cellScreenshotEvidenceContent.set(
          cellKey(cell.cell),
          retainedMedia.evidence.contentSha256
        )
    }
    cellEvidenceContent.set(cellKey(cell.cell), retainedForCell)
  }
  const externalSelectionSources: EditProductionExternalSelectionSourceV1[] =
    executedCells.flatMap((cell) =>
    {
      const evidenceContentSha256 = cellScreenshotEvidenceContent.get(
        cellKey(cell.cell)
      )
      if (evidenceContentSha256 === undefined) return []
      const frames = cell.media.flatMap((media) =>
      {
        if (media.evidenceKind !== 'screenshot' || media.frameId === undefined)
          return []
        const authority = cell.trace.observations.media?.frames.find(
          (frame) =>
            frame.id === media.frameId && frame.sha256 === media.payloadSha256
        )
        if (authority === undefined)
          fail(
            'external-frame-authority-missing',
            `retained frame ${media.frameId} has no exact observation authority`
          )
        return [
          Object.freeze({
            payloadSha256: media.payloadSha256,
            frameId: media.frameId,
            tick: authority.tick,
            snapshotLabel: authority.snapshotLabel,
          }),
        ]
      })
      return [
        Object.freeze({
          cell: cell.cell,
          evidenceContentSha256,
          frames: Object.freeze(frames),
        }),
      ]
    })
  const externalRequests = deriveEditProductionExternalRequestsV1({
    evaluationId: request.evaluationId,
    plan: request.plan.plan,
    policies: request.policies,
    matrixCells: reservation.cells,
    sources: externalSelectionSources,
  })
  const matrixProjection = {
    matrixSha256: reservation.matrixSha256,
    preflightArtifactCount: reservation.preflightArtifactCount,
    reservedTraceBytesPerCell: reservation.reservedTraceBytesPerCell,
    reservedTraceBytesTotal: reservation.reservedTraceBytesTotal,
    reservedMediaBytesPerBrowserCell:
      reservation.reservedMediaBytesPerBrowserCell,
    reservedMediaBytesTotal: reservation.reservedMediaBytesTotal,
    reservedMetadataBytesTotal: reservation.reservedMetadataBytesTotal,
    reservedArtifactBytesTotal: reservation.reservedArtifactBytesTotal,
    deterministicAuthority,
    cells: reservation.cells.map((cell) =>
    {
      const outcome = outcomes.get(cellKey(cell))!
      const pendingRequestSha256s = externalRequests
        .filter((externalRequest) =>
          externalRequest.matrixCells.some(
            (boundCell) => boundCell.ordinal === cell.ordinal
          )
        )
        .map((externalRequest) => externalRequest.requestSha256)
      if (
        !isExecuted(outcome) &&
        pendingRequestSha256s.length !== 0 &&
        (cell.lane === 'renderedDifferential' || cell.lane === 'nativeVisual')
      )
        return {
          cell,
          status: 'pendingExternal' as const,
          requestSha256s: pendingRequestSha256s,
        }
      return isExecuted(outcome)
        ? {
            cell,
            status: 'executed' as const,
            requestSha256: outcome.requestSha256,
            resultSha256: outcome.resultSha256,
            completeSemanticDrive: cellHasCompleteSemanticDrive(outcome),
            evidenceContentSha256s:
              cellEvidenceContent.get(cellKey(cell)) ?? [],
          }
        : {
            cell,
            status: 'refused' as const,
            availability: outcome.availability,
            reason: outcome.reason,
          }
    }),
  }
  const matrixRequestSha256 = editRuntimeHashV1(
    'edit-production-matrix-outcomes-request-v1',
    { matrixSha256: reservation.matrixSha256 }
  )
  const matrixResultSha256 = editRuntimeHashV1(
    'edit-production-matrix-outcomes-result-v1',
    matrixProjection
  )
  const retainedMatrix = projectionEvidence({
    revisionBinding,
    evidenceKind: 'projectPreflight',
    contentEvidenceKind: 'structuredState',
    lane: 'projectPreflight',
    requestSha256: matrixRequestSha256,
    resultSha256: matrixResultSha256,
    projection: matrixProjection,
  })
  evidence.unshift(retainedMatrix.evidence)
  evidencePayloads.unshift(retainedMatrix.payload)
  const rederived = await rederiveEditProductionDeterministicV1({
    request,
    authority: deterministicAuthority,
    baselinePreflight: preflightProjections.get('baseline'),
    candidatePreflight: preflightProjections.get('candidate'),
    matrixProjection,
    traceProjections: retainedTraceProjections,
    mediaByCell: replayMediaByCell,
    externalRequests,
  })
  if (
    !sameValue(rederived.identity, runtimeIdentity(executedCells)) ||
    !sameValue(rederived.laneStatuses, statuses) ||
    !sameValue(rederived.candidateObservations, candidateObservations) ||
    !sameValue(rederived.preservationObservations, preservation) ||
    !sameValue(
      rederived.baselineDiagnostics,
      diagnosticsFor(request, 'baseline', baselinePreflight)
    ) ||
    !sameValue(
      rederived.candidateDiagnostics,
      diagnosticsFor(request, 'candidate', candidatePreflight)
    )
  )
    fail(
      'deterministic-rederivation-mismatch',
      'retained raw authority does not reproduce the deterministic summaries'
    )
  if (
    evidence.length + externalRequests.length >
    MAX_CERTIFICATE_EVIDENCE_ENTRIES_V1
  )
    fail(
      'certificate-evidence-limit-exceeded',
      'actual deterministic and external evidence rows exceed the reserved V1 certificate limit'
    )
  return Object.freeze({
    identity: rederived.identity,
    laneStatuses: rederived.laneStatuses,
    candidateObservations: rederived.candidateObservations,
    preservationObservations: rederived.preservationObservations,
    baselineDiagnostics: rederived.baselineDiagnostics,
    candidateDiagnostics: rederived.candidateDiagnostics,
    allowedNewDiagnosticFingerprints:
      rederived.allowedNewDiagnosticFingerprints,
    boundedResourceIssueCodes: rederived.boundedResourceIssueCodes,
    evidence: Object.freeze(evidence),
    evidenceArtifactIndex: Object.freeze(
      evidencePayloads.map(({ bytes: _bytes, ...entry }) =>
        Object.freeze(entry)
      )
    ),
    evidencePayloads: Object.freeze(evidencePayloads),
    projectJsonSha256:
      candidatePreflight.semanticSourceIdentity?.projectJsonSha256 ??
      sha256(request.candidateBytes),
    evaluatedCandidateByteLength: request.candidateBytes.byteLength,
    fixedTimePolicySha256: rederived.fixedTimePolicySha256,
    seedSetSha256: rederived.seedSetSha256,
    externalRequests: Object.freeze(externalRequests),
    limitations: rederived.limitations,
  })
}
