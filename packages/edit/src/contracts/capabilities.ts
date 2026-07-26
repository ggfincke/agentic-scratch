// packages/edit/src/contracts/capabilities.ts
// deterministic semantic capability profiles & current-head snapshots

import type {
  BoundedDisplayStringV1,
  BudgetProjectionV1,
  CapabilityFamilyAssessmentV1,
  ExactRevisionIdentityV1,
  RunnerAvailabilityV1,
  SemanticEditCapabilityProfileEnvelopeV1,
  SemanticEditCapabilityProfileV1,
  SemanticEditCapabilitySnapshotEnvelopeV1,
} from '@scratch-agent/ir/edit'
import {
  MEDIA_POLICY_TABLES,
  OPERATION_KINDS,
  OPERATION_PLANNING_ROWS,
  OPERATION_REVIEW_ROWS,
  PHASE_8_RESOURCE_POLICY_LIMITS,
  PNG_FEATURE_POLICIES,
  REFUSAL_CODES,
  VANILLA_CORE_DESCRIPTORS,
  assertApprovedA0SemanticAuthorityV1,
  boundedDisplayStringV1,
  parseContractDefinitionV1,
  semanticHashV1,
} from '@scratch-agent/ir/edit'

import { immutableCopyV1 as immutableCopy } from '../support/internal-values.js'

interface EditCapabilityProjectAssessmentV1
{
  readonly semanticSourceSha256: string
  readonly projectConstraintAssessmentSha256: string
  readonly unsupportedExtensionsSha256: string
  readonly unsupportedOpcodesSha256: string
  readonly unsupportedMediaSha256: string
  readonly unknownReferenceSurfacesSha256: string
  readonly targetConstraintCollectionSha256: string
  readonly admissionCompatibilitySha256: string
  readonly runtimeProfileCompatibilitySha256: string
}

interface EditCapabilityProfileInputV1 extends EditCapabilityProjectAssessmentV1
{
  readonly pinnedScratchRuntimeSourceSha256: string
}

interface TargetCapabilityProfileInputV1 extends EditCapabilityProfileInputV1
{
  readonly operationCapabilityAssessmentSha256: string
  readonly familyAvailability: Readonly<
    Record<'target' | 'declaration' | 'script' | 'comment', boolean>
  >
}

interface ScriptBlockCapabilityProfileInputV1 extends TargetCapabilityProfileInputV1
{
  readonly familyAvailability: Readonly<
    Record<'target' | 'declaration' | 'script' | 'block' | 'comment', boolean>
  >
}

// procedure carries a single aggregate boolean over all four operation kinds;
// plan step E8 forbids advertising the family one operation at a time
interface ProcedureCapabilityProfileInputV1 extends ScriptBlockCapabilityProfileInputV1
{
  readonly familyAvailability: Readonly<
    Record<
      'target' | 'declaration' | 'script' | 'block' | 'comment' | 'procedure',
      boolean
    >
  >
}

// media carries a single aggregate boolean over all eleven operation kinds;
// plan step F6 forbids advertising the family one operation at a time
export interface MediaTargetCapabilityProfileInputV1 extends ProcedureCapabilityProfileInputV1
{
  readonly familyAvailability: Readonly<
    Record<
      | 'target'
      | 'declaration'
      | 'script'
      | 'block'
      | 'comment'
      | 'procedure'
      | 'media',
      boolean
    >
  >
}

type GroupGCapabilityProfileInputV1 = MediaTargetCapabilityProfileInputV1

interface EditCapabilitySnapshotInputV1
{
  readonly head: ExactRevisionIdentityV1
  readonly admittedAssetCollectionVersion: number
  readonly policyConfigVersion: number
  readonly runnerAvailabilityEpoch: number
  readonly runnerAvailability?: readonly RunnerAvailabilityV1[]
  readonly diskLowWaterState: 'normal' | 'low' | 'critical' | 'unavailable'
  readonly collectionEpoch: number
  readonly resourceEpoch: number
  readonly cursorEpoch: number
  readonly diskCapacityClass: 'normal' | 'low' | 'critical' | 'unavailable'
  readonly remainingBudget: BudgetProjectionV1
  readonly freeByteTelemetryClass: 'ample' | 'bounded' | 'low' | 'unknown'
  readonly retentionPolicyVersion: number
  readonly retentionPolicySha256: string
}

export const EDIT_EVALUATION_RUNNER_LANES_V1 = Object.freeze([
  'projectPreflight',
  'officialHeadless',
  'officialBrowser',
  'turboWarpBrowser',
  'renderedDifferential',
  'nativeVisual',
] as const)

function componentHash(name: string, value: unknown): string
{
  return semanticHashV1('capability-profile', {
    component: name,
    schemaVersion: 1,
    value,
  })
}

function explanation(value: string): BoundedDisplayStringV1
{
  return boundedDisplayStringV1(value) as BoundedDisplayStringV1
}

type OperationCapabilityFamilyV1 = Exclude<
  CapabilityFamilyAssessmentV1['family'],
  'evaluation' | 'export' | 'replay'
>

function supportedFamilyAssessmentFactoryV1<
  Family extends OperationCapabilityFamilyV1,
>(input: {
  readonly familyAvailability: Readonly<Record<Family, boolean>>
  readonly operationCapabilityAssessmentSha256: string
})
{
  return (family: Family, boundedExplanation: string) =>
    Object.freeze({
      family,
      availability: input.familyAvailability[family]
        ? ('supported' as const)
        : ('unsupported' as const),
      refusalCodes: Object.freeze([
        'edit.unsupported_operation' as const,
        'edit.planning_facts_mismatch' as const,
        'edit.reference_propagation_incomplete' as const,
      ]),
      affectedSemanticScopeSha256: input.operationCapabilityAssessmentSha256,
      boundedExplanation: explanation(boundedExplanation),
    })
}

// Group F is the last operation-family group, so this profile carries no
// `unsupported` helper at all: every remaining unavailable family is a
// hand-written literal that names the group which opens it
function mediaTargetPhaseFamilyAssessments(
  input: MediaTargetCapabilityProfileInputV1
): readonly CapabilityFamilyAssessmentV1[]
{
  const supported = supportedFamilyAssessmentFactoryV1<
    | 'target'
    | 'declaration'
    | 'script'
    | 'block'
    | 'comment'
    | 'procedure'
    | 'media'
  >(input)
  return Object.freeze([
    supported(
      'target',
      'Target edits are supported where project-specific reference checks pass; sprite creation is atomic and requires a first costume in the same batch.'
    ),
    supported(
      'declaration',
      'Variable, list, and broadcast operations are supported where exact reference and collision checks pass.'
    ),
    supported(
      'script',
      'Workspace and descriptor-backed structural script operations are supported for exact uniquely owned vanilla-core closures.'
    ),
    supported(
      'block',
      'Descriptor-backed structural block operations are supported for exact uniquely owned vanilla-core blocks and closures.'
    ),
    supported(
      'comment',
      'Comment text, attachment, removal, and workspace layout are supported for exact reciprocal topology.'
    ),
    supported(
      'procedure',
      'Custom procedure definition, signature update, call argument, and removal operations are advertised only as one complete family.'
    ),
    supported(
      'media',
      'Costume and sound add, rename, reorder, replace, removal, and current-costume selection are advertised only as one complete family over admitted PNG and PCM-WAV payloads.'
    ),
    Object.freeze({
      family: 'evaluation' as const,
      availability: 'unsupported' as const,
      refusalCodes: Object.freeze(['edit.evaluation_unavailable'] as const),
      boundedExplanation: explanation(
        'Runtime evaluation remains unavailable until Group G.'
      ),
    }),
    Object.freeze({
      family: 'export' as const,
      availability: 'unsupported' as const,
      refusalCodes: Object.freeze(['edit.publication_unavailable'] as const),
      boundedExplanation: explanation(
        'Verified publication remains unavailable until Group G.'
      ),
    }),
    Object.freeze({
      family: 'replay' as const,
      availability: 'supported' as const,
      refusalCodes: Object.freeze([]),
      boundedExplanation: explanation(
        'Exact token-free semantic transition replay is supported.'
      ),
    }),
  ])
}

function groupGFamilyAssessments(
  input: GroupGCapabilityProfileInputV1
): readonly CapabilityFamilyAssessmentV1[]
{
  return Object.freeze(
    mediaTargetPhaseFamilyAssessments(input).map((assessment) =>
    {
      if (assessment.family === 'evaluation')
      {
        return Object.freeze({
          family: 'evaluation' as const,
          availability: 'supported' as const,
          refusalCodes: Object.freeze([
            'edit.evaluation_unavailable' as const,
            'edit.evaluation_inconclusive' as const,
            'edit.evaluation_failed' as const,
          ]),
          boundedExplanation: explanation(
            'Trusted exact-byte evaluation is implemented; the response-local capability snapshot and each immutable plan still enforce current lane readiness.'
          ),
        })
      }
      if (assessment.family === 'export')
      {
        return Object.freeze({
          family: 'export' as const,
          availability: 'supported' as const,
          refusalCodes: Object.freeze([
            'edit.publication_unavailable' as const,
            'edit.evaluation_unavailable' as const,
            'edit.evaluation_inconclusive' as const,
            'edit.stale_certificate' as const,
          ]),
          boundedExplanation: explanation(
            'Complete-or-absent under non-adversarial concurrency no-replace publication is implemented and remains gated by response-local host readiness plus a current passing export-required certificate.'
          ),
        })
      }
      return assessment
    })
  )
}

function parseExact<T>(definitionName: string, value: unknown): T
{
  const parsed = parseContractDefinitionV1<T>(definitionName, value)
  if (!parsed.ok)
  {
    throw new TypeError(
      `${definitionName} construction failed ${parsed.issues.length} exact contract issue(s)`
    )
  }
  return parsed.value
}

export function buildGroupGCapabilityProfileV1(
  input: GroupGCapabilityProfileInputV1
): SemanticEditCapabilityProfileEnvelopeV1
{
  return buildCapabilityProfile(
    input,
    'G',
    groupGFamilyAssessments(input),
    true,
    true
  )
}

function buildCapabilityProfile(
  input: EditCapabilityProfileInputV1,
  group: 'C' | 'D' | 'E' | 'F' | 'G',
  assessments: readonly CapabilityFamilyAssessmentV1[],
  runtimeImplemented = false,
  exportImplemented = false
): SemanticEditCapabilityProfileEnvelopeV1
{
  const authority = assertApprovedA0SemanticAuthorityV1()
  const profile = parseExact<SemanticEditCapabilityProfileV1>(
    'SemanticEditCapabilityProfileV1',
    {
      schemaVersion: 1,
      versions: {
        schema: 1,
        selector: 1,
        fingerprint: 1,
        lineage: 1,
        allocator: 1,
        descriptor: 1,
        delta: 1,
        preservation: 1,
        changeContract: 1,
        evaluationCertificate: 1,
        manifest: 1,
      },
      operationKinds: OPERATION_KINDS,
      resultSlotCatalogSha256: componentHash('result-slot-catalog', {
        authority,
        rows: OPERATION_REVIEW_ROWS.map((row) => ({
          kind: row.kind,
          fixedResultSlots: row.fixedResultSlots,
          dynamicResultSlots: row.dynamicResultSlots,
        })),
      }),
      blockDescriptorProfileSha256: componentHash(
        'block-descriptor-profile',
        VANILLA_CORE_DESCRIPTORS
      ),
      pinnedScratchRuntimeSourceSha256: input.pinnedScratchRuntimeSourceSha256,
      semanticFieldDomainsSha256: componentHash(
        'semantic-field-domains',
        VANILLA_CORE_DESCRIPTORS.map((descriptor) => ({
          opcode: descriptor.opcode,
          requiredFields: descriptor.requiredFields,
          optionalFields: descriptor.optionalFields,
        }))
      ),
      semanticInputDomainsSha256: componentHash(
        'semantic-input-domains',
        VANILLA_CORE_DESCRIPTORS.map((descriptor) => ({
          opcode: descriptor.opcode,
          requiredInputs: descriptor.requiredInputs,
          optionalInputs: descriptor.optionalInputs,
        }))
      ),
      referenceDomainsSha256: componentHash(
        'reference-domains',
        OPERATION_REVIEW_ROWS.map((row) => ({
          kind: row.kind,
          selectionFields: row.selectionFields,
        }))
      ),
      safeMutationBuildersSha256: componentHash(
        'safe-mutation-builders',
        OPERATION_REVIEW_ROWS.map((row) => ({
          kind: row.kind,
          builderKind: row.builderKind,
          executableGroup: row.executableGroup,
        }))
      ),
      mediaCapabilityProfileSha256: componentHash('media-capability-profile', {
        mediaPolicyTables: MEDIA_POLICY_TABLES,
        pngFeaturePolicies: PNG_FEATURE_POLICIES,
      }),
      selectorKinds: ['handle', 'exactLocation', 'matchSet'],
      selectorCardinalityPolicySha256: componentHash(
        'selector-cardinality-policy',
        {
          allowed: ['exactlyOne', 'occurrence'],
          planningRows: OPERATION_PLANNING_ROWS,
        }
      ),
      refusalCodes: REFUSAL_CODES,
      limits: PHASE_8_RESOURCE_POLICY_LIMITS.map((limit) => ({
        key: limit.key,
        defaultValue: limit.defaultValue,
        hardMaximum: limit.hardMaximum,
      })),
      runtimeCapabilitySha256: componentHash('runtime-capability', {
        availability: runtimeImplemented ? 'implemented' : 'unavailable',
        group,
      }),
      networkPolicy: 'denied',
      containmentLimitationsSha256: componentHash('containment-limitations', {
        hardKillTimeout: false,
        runtimeExecution: runtimeImplemented
          ? 'bounded-in-process'
          : 'unavailable',
      }),
      exportCapabilitySha256: componentHash('export-capability', {
        availability: exportImplemented ? 'implemented' : 'unavailable',
        group,
      }),
      replayCapabilitySha256: componentHash('replay-capability', {
        exactSemanticReplay: true,
        group,
      }),
      semanticSourceSha256: input.semanticSourceSha256,
      projectConstraintAssessmentSha256:
        input.projectConstraintAssessmentSha256,
      unsupportedExtensionsSha256: input.unsupportedExtensionsSha256,
      unsupportedOpcodesSha256: input.unsupportedOpcodesSha256,
      unsupportedMediaSha256: input.unsupportedMediaSha256,
      unknownReferenceSurfacesSha256: input.unknownReferenceSurfacesSha256,
      familyAssessments: assessments,
      targetConstraintCollectionSha256: input.targetConstraintCollectionSha256,
      admissionCompatibilitySha256: input.admissionCompatibilitySha256,
      runtimeProfileCompatibilitySha256:
        input.runtimeProfileCompatibilitySha256,
    }
  )
  const capabilityProfileSha256 = semanticHashV1('capability-profile', profile)
  return immutableCopy({ profile, capabilityProfileSha256 })
}

function unavailableRunners(epoch: number): readonly RunnerAvailabilityV1[]
{
  return Object.freeze(
    EDIT_EVALUATION_RUNNER_LANES_V1.map((lane) =>
      Object.freeze({
        lane,
        availability: 'unavailable' as const,
        availabilityEpoch: epoch,
      })
    ) as RunnerAvailabilityV1[]
  )
}

// runner state is one epoch-coherent exact lane set; malformed trusted-port
// output is never normalized into a capability claim
export function validatedRunnerAvailabilityV1(
  rows: readonly RunnerAvailabilityV1[],
  expectedEpoch?: number
): readonly RunnerAvailabilityV1[]
{
  if (!Array.isArray(rows))
    throw new TypeError('runner availability must be an array')
  const parsed = rows.map((row) =>
    parseExact<RunnerAvailabilityV1>('RunnerAvailabilityV1', row)
  )
  const byLane = new Map(parsed.map((row) => [row.lane, row]))
  if (
    parsed.length !== EDIT_EVALUATION_RUNNER_LANES_V1.length ||
    byLane.size !== EDIT_EVALUATION_RUNNER_LANES_V1.length ||
    EDIT_EVALUATION_RUNNER_LANES_V1.some((lane) => !byLane.has(lane))
  )
    throw new TypeError(
      'runner availability must contain all six exact lanes once'
    )
  const epoch = parsed[0]!.availabilityEpoch
  if (!Number.isSafeInteger(epoch) || epoch < 0)
    throw new TypeError('runner availability epoch must be a count')
  if (
    expectedEpoch !== undefined &&
    (!Number.isSafeInteger(expectedEpoch) ||
      expectedEpoch < 0 ||
      expectedEpoch !== epoch)
  )
    throw new TypeError(
      'runner availability rows must match the snapshot availability epoch'
    )
  let poisonSha256: string | null = null
  for (const row of parsed)
  {
    if (row.availabilityEpoch !== epoch)
      throw new TypeError('runner availability rows must share one epoch')
    if (row.availability === 'poisoned')
    {
      if (row.poisonSha256 === undefined)
        throw new TypeError('poisoned runner availability requires a digest')
      if (poisonSha256 !== null && poisonSha256 !== row.poisonSha256)
        throw new TypeError(
          'runner availability rows must share one poison state'
        )
      poisonSha256 = row.poisonSha256
    }
    else if (row.poisonSha256 !== undefined)
      throw new TypeError(
        'non-poisoned runner availability cannot carry a poison digest'
      )
  }
  return Object.freeze(
    EDIT_EVALUATION_RUNNER_LANES_V1.map((lane) =>
      Object.freeze({ ...byLane.get(lane)! })
    )
  )
}

function budgetProjection(budget: BudgetProjectionV1): BudgetProjectionV1
{
  return {
    artifactBytesUsed: budget.artifactBytesUsed,
    impactUsed: budget.impactUsed,
    intentUsed: budget.intentUsed,
    restoreReserveHeld: budget.restoreReserveHeld,
  }
}

export function buildEditCapabilitySnapshotV1(
  input: EditCapabilitySnapshotInputV1
): SemanticEditCapabilitySnapshotEnvelopeV1
{
  const runnerAvailability = validatedRunnerAvailabilityV1(
    input.runnerAvailability ??
      unavailableRunners(input.runnerAvailabilityEpoch),
    input.runnerAvailabilityEpoch
  )
  const hashProjection = {
    head: input.head,
    capabilityProfileSha256: input.head.capabilityProfileSha256,
    changeContractSha256: input.head.changeContractSha256,
    admittedAssetCollectionVersion: input.admittedAssetCollectionVersion,
    policyConfigVersion: input.policyConfigVersion,
    runnerAvailabilityEpoch: input.runnerAvailabilityEpoch,
    diskLowWaterState: input.diskLowWaterState,
  }
  const snapshot = parseExact<
    SemanticEditCapabilitySnapshotEnvelopeV1['snapshot']
  >('SemanticEditCapabilitySnapshotV1', {
    schemaVersion: 1,
    hashProjection,
    collectionEpoch: input.collectionEpoch,
    resourceEpoch: input.resourceEpoch,
    cursorEpoch: input.cursorEpoch,
    casPreconditionSha256: semanticHashV1('capability-snapshot', {
      kind: 'edit-cas-precondition',
      hashProjection,
      collectionEpoch: input.collectionEpoch,
      resourceEpoch: input.resourceEpoch,
      cursorEpoch: input.cursorEpoch,
      retentionPolicyVersion: input.retentionPolicyVersion,
      retentionPolicySha256: input.retentionPolicySha256,
    }),
    runnerAvailability,
    diskCapacityClass: input.diskCapacityClass,
    remainingBudget: budgetProjection(input.remainingBudget),
    freeByteTelemetryClass: input.freeByteTelemetryClass,
    retentionPolicyVersion: input.retentionPolicyVersion,
    retentionPolicySha256: input.retentionPolicySha256,
  })
  const capabilitySnapshotSha256 = semanticHashV1(
    'capability-snapshot',
    snapshot.hashProjection
  )
  return immutableCopy({ snapshot, capabilitySnapshotSha256 })
}
