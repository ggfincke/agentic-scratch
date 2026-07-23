// packages/eval/src/edit-evaluation/edit-runtime-projection.ts
// opt-in projected differential: satisfy the legacy equality guards w/ rederivable shared hashes

import type { IdentityBoundActionRecordV1 } from '@scratch-agent/runner'

import {
  evaluateBehavioralDifferential,
  type BehavioralTrace,
  type DifferentialEvaluationInput,
} from '../multimodal/differential.js'
import type {
  BehavioralLensSpecV1,
  DifferentialReportV1,
} from '../multimodal/lenses.js'
import type { DifferentialCapabilityAssessmentV1 } from '../multimodal/lenses.js'
import {
  editLoweredActionTraceSha256,
  editRuntimeHashV1,
  type EditEvaluationSideV1,
  type EditLoweredScenarioV1,
} from './edit-scenario-lowering.js'
import {
  projectEditRuntimeTracesV1,
  type EditRuntimeProjectionEvidenceV1,
  type EditRuntimeProjectionInputV1,
} from './edit-projection-mask.js'

const EDIT_DIFFERENTIAL_ADAPTER_VERSION =
  'edit-projected-differential-v1'

// one side's exact retained inputs. no projected hash is accepted here: the
// adapter computes both shared hashes itself, so no caller & no agent flag can
// supply one.
interface EditDifferentialSideInputV1
{
  readonly side: EditEvaluationSideV1
  readonly lane: string
  readonly trace: BehavioralTrace
  readonly lowered: EditLoweredScenarioV1
  readonly actions: readonly IdentityBoundActionRecordV1[]
}

interface EditDifferentialSideEvidenceV1
{
  readonly side: EditEvaluationSideV1
  readonly lane: string
  readonly artifactSha256: string
  readonly manifestSha256: string
  readonly originalScenarioSha256: string
  readonly originalPlanSha256: string
  readonly loweredScenarioSha256: string
  readonly concreteActionTraceSha256: string
  readonly actions: readonly IdentityBoundActionRecordV1[]
}

interface EditProjectedDifferentialEvidenceV1
{
  readonly adapterVersion: typeof EDIT_DIFFERENTIAL_ADAPTER_VERSION
  readonly loweringVersion: EditLoweredScenarioV1['loweringVersion']
  readonly semanticPolicySha256: string
  readonly seed: number
  readonly fixedDateMs: number
  readonly left: EditDifferentialSideEvidenceV1
  readonly right: EditDifferentialSideEvidenceV1
  readonly sharedProjectedScenarioSha256: string
  readonly sharedProjectedPlanSha256: string
  readonly planProjectionApplied: boolean
  readonly runtimeProjection: EditRuntimeProjectionEvidenceV1 | null
  readonly report: Readonly<DifferentialReportV1>
}

type EditProjectedDifferentialResultV1 =
  | {
      readonly status: 'evaluated'
      readonly evidence: EditProjectedDifferentialEvidenceV1
    }
  | {
      readonly status: 'refused'
      readonly reason: EditProjectedDifferentialRefusalReasonV1
      readonly detail: string
    }
  | {
      readonly status: 'inconclusive'
      readonly reason: EditProjectedDifferentialInconclusiveReasonV1
      readonly maskId: string | null
      readonly detail: string
    }

type EditProjectedDifferentialInconclusiveReasonV1 =
  | 'identity-facet-mismatch'
  | 'identity-transition-mismatch'
  | 'projection-mask-mismatch'
  | 'pixel-facet-mismatch'
  | 'bounded-observation-refused'
  | 'bounded-observation-incomplete'
  | 'bounded-observation-invalid'

type EditProjectedDifferentialRefusalReasonV1 =
  | 'artifact-binding-mismatch'
  | 'scenario-binding-mismatch'
  | 'semantic-policy-mismatch'
  | 'determinism-input-mismatch'
  | 'lowering-version-mismatch'
  | 'action-trace-empty'
  | 'side-binding-mismatch'
  | 'projection-scenario-mismatch'
  | 'projection-lens-mismatch'

interface EditBehavioralDifferentialInputV1
{
  readonly comparisonKind: DifferentialReportV1['comparisonKind']
  readonly left: EditDifferentialSideInputV1
  readonly right: EditDifferentialSideInputV1
  readonly semanticPolicySha256: string
  readonly seed: number
  readonly fixedDateMs: number
  readonly specs: BehavioralLensSpecV1[]
  readonly capabilityAssessment?: DifferentialCapabilityAssessmentV1
  readonly runtimeProjection?: EditRuntimeProjectionInputV1
}

function sideEvidence(
  input: EditDifferentialSideInputV1
): EditDifferentialSideEvidenceV1
{
  return Object.freeze({
    side: input.side,
    lane: input.lane,
    artifactSha256: input.lowered.artifactSha256,
    manifestSha256: input.lowered.manifestSha256,
    originalScenarioSha256: input.trace.observations.scenarioSha256,
    originalPlanSha256: input.trace.observations.planSha256,
    loweredScenarioSha256: input.lowered.loweredScenarioSha256,
    concreteActionTraceSha256: editLoweredActionTraceSha256(input.actions),
    actions: Object.freeze([...input.actions]),
  })
}

// the one domain-separated comparison hash both projected copies carry. it binds
// the shared semantic policy plus BOTH ordered concrete action-trace hashes, so
// only evidence naming each side's exact lowered input can rederive it.
function sharedProjectedScenarioSha256V1(input: {
  readonly semanticPolicySha256: string
  readonly leftActionTraceSha256: string
  readonly rightActionTraceSha256: string
}): string
{
  return editRuntimeHashV1('edit-projected-scenario', [
    input.semanticPolicySha256,
    input.leftActionTraceSha256,
    input.rightActionTraceSha256,
  ])
}

function sharedProjectedPlanSha256V1(input: {
  readonly semanticPolicySha256: string
  readonly leftPlanSha256: string
  readonly rightPlanSha256: string
  readonly runtimeProjectionSha256?: string | null
}): string
{
  if (input.runtimeProjectionSha256)
    return editRuntimeHashV1('edit-projected-observation-plan-masked', [
      input.semanticPolicySha256,
      input.leftPlanSha256,
      input.rightPlanSha256,
      input.runtimeProjectionSha256,
    ])
  return editRuntimeHashV1('edit-projected-observation-plan', [
    input.semanticPolicySha256,
    input.leftPlanSha256,
    input.rightPlanSha256,
  ])
}

function inconclusive(
  reason: EditProjectedDifferentialInconclusiveReasonV1,
  maskId: string | null,
  detail: string
): EditProjectedDifferentialResultV1
{
  return Object.freeze({
    status: 'inconclusive' as const,
    reason,
    maskId,
    detail,
  })
}

// an immutable projected copy; the caller's trace is never mutated, so the
// original per-side hashes stay verifiable against their own artifacts
function projectTrace(
  trace: BehavioralTrace,
  scenarioSha256: string,
  planSha256: string
): BehavioralTrace
{
  const copy = structuredClone(trace) as BehavioralTrace
  copy.observations.scenarioSha256 = scenarioSha256
  copy.observations.planSha256 = planSha256
  return copy
}

function refuse(
  reason: EditProjectedDifferentialRefusalReasonV1,
  detail: string
): EditProjectedDifferentialResultV1
{
  return Object.freeze({ status: 'refused' as const, reason, detail })
}

// validate & retain each side's originals, then build projected copies that the
// UNCHANGED comparator accepts. evaluateBehavioralDifferential itself is
// untouched: calling it directly w/ unequal raw hashes still fails as today.
export function evaluateEditBehavioralDifferentialV1(
  input: EditBehavioralDifferentialInputV1
): EditProjectedDifferentialResultV1
{
  for (const side of [input.left, input.right])
  {
    if (side.trace.observations.sourceSb3Sha256 !== side.lowered.artifactSha256)
      return refuse(
        'artifact-binding-mismatch',
        `${side.side} ran ${side.trace.observations.sourceSb3Sha256} but its lowering binds ${side.lowered.artifactSha256}`
      )
    if (
      side.trace.observations.scenarioSha256 !==
      side.lowered.loweredScenarioSha256
    )
      return refuse(
        'scenario-binding-mismatch',
        `${side.side} observed scenario ${side.trace.observations.scenarioSha256} but its lowering hashes to ${side.lowered.loweredScenarioSha256}`
      )
    if (side.lowered.semanticPolicySha256 !== input.semanticPolicySha256)
      return refuse(
        'semantic-policy-mismatch',
        `${side.side} lowers policy ${side.lowered.semanticPolicySha256}, not the shared ${input.semanticPolicySha256}`
      )
    if (
      side.lowered.scenario.seed !== input.seed ||
      side.lowered.scenario.fixedDateMs !== input.fixedDateMs
    )
      return refuse(
        'determinism-input-mismatch',
        `${side.side} lowers seed ${side.lowered.scenario.seed}/fixedDateMs ${side.lowered.scenario.fixedDateMs} against the declared ${input.seed}/${input.fixedDateMs}`
      )
    if (side.actions.length === 0)
      return refuse(
        'action-trace-empty',
        `${side.side} retained no concrete action trace to bind`
      )
  }
  if (
    input.left.lowered.loweringVersion !== input.right.lowered.loweringVersion
  )
    return refuse(
      'lowering-version-mismatch',
      'both sides must be lowered by the same adapter version'
    )

  const left = sideEvidence(input.left)
  const right = sideEvidence(input.right)
  const sharedScenario = sharedProjectedScenarioSha256V1({
    semanticPolicySha256: input.semanticPolicySha256,
    leftActionTraceSha256: left.concreteActionTraceSha256,
    rightActionTraceSha256: right.concreteActionTraceSha256,
  })
  let leftTrace = input.left.trace
  let rightTrace = input.right.trace
  let runtimeProjection: EditRuntimeProjectionEvidenceV1 | null = null
  if (input.runtimeProjection)
  {
    if (
      input.left.side === input.right.side ||
      ![input.left.side, input.right.side].includes('baseline') ||
      ![input.left.side, input.right.side].includes('candidate')
    )
      return refuse(
        'side-binding-mismatch',
        'runtime projection requires exactly one baseline and one candidate side'
      )
    if (
      input.runtimeProjection.policy.scenarioId !==
        input.left.lowered.scenarioId ||
      input.runtimeProjection.policy.scenarioId !==
        input.right.lowered.scenarioId
    )
      return refuse(
        'projection-scenario-mismatch',
        'runtime projection scenario must match both lowered side scenarios'
      )
    const projectedLensKind =
      input.runtimeProjection.policy.lens.lensKind === 'finalState'
        ? 'final-state'
        : input.runtimeProjection.policy.lens.lensKind === 'labeledTrace'
          ? 'labeled-trace'
          : input.runtimeProjection.policy.lens.lensKind === 'runtimeOutcome'
            ? 'runtime-outcome'
            : input.runtimeProjection.policy.lens.lensKind === 'cloneCounts'
              ? 'clone-count-trace'
              : 'visual-keyframes'
    if (
      input.specs.length === 0 ||
      input.specs.some((spec) => spec.kind !== projectedLensKind)
    )
      return refuse(
        'projection-lens-mismatch',
        `runtime projection lens ${input.runtimeProjection.policy.lens.lensKind} cannot project the supplied Phase 7 specifications`
      )
    const baselineInput =
      input.left.side === 'baseline' ? input.left : input.right
    const candidateInput =
      input.left.side === 'candidate' ? input.left : input.right
    const projection = projectEditRuntimeTracesV1({
      baselineTrace: baselineInput.trace,
      candidateTrace: candidateInput.trace,
      baselineArtifactSha256: baselineInput.lowered.artifactSha256,
      candidateArtifactSha256: candidateInput.lowered.artifactSha256,
      baselineManifestSha256: baselineInput.lowered.manifestSha256,
      candidateManifestSha256: candidateInput.lowered.manifestSha256,
      projection: input.runtimeProjection,
      specs: input.specs,
    })
    if (projection.status === 'inconclusive')
      return inconclusive(
        projection.reason,
        projection.maskId,
        projection.detail
      )
    runtimeProjection = projection.evidence
    if (input.left.side === 'baseline')
    {
      leftTrace = projection.baseline
      rightTrace = projection.candidate
    }
    else
    {
      leftTrace = projection.candidate
      rightTrace = projection.baseline
    }
  }
  const planProjectionApplied =
    left.originalPlanSha256 !== right.originalPlanSha256 ||
    runtimeProjection !== null
  const sharedPlan = planProjectionApplied
    ? sharedProjectedPlanSha256V1({
        semanticPolicySha256: input.semanticPolicySha256,
        leftPlanSha256: left.originalPlanSha256,
        rightPlanSha256: right.originalPlanSha256,
        runtimeProjectionSha256: runtimeProjection?.projectionSha256,
      })
    : left.originalPlanSha256

  const projected: DifferentialEvaluationInput = {
    comparisonKind: input.comparisonKind,
    left: projectTrace(leftTrace, sharedScenario, sharedPlan),
    right: projectTrace(rightTrace, sharedScenario, sharedPlan),
    specs: input.specs,
    seed: input.seed,
    fixedDateMs: input.fixedDateMs,
  }
  if (input.capabilityAssessment)
    projected.capabilityAssessment = input.capabilityAssessment
  const report = evaluateBehavioralDifferential(projected)
  return {
    status: 'evaluated',
    evidence: Object.freeze({
      adapterVersion: EDIT_DIFFERENTIAL_ADAPTER_VERSION,
      loweringVersion: input.left.lowered.loweringVersion,
      semanticPolicySha256: input.semanticPolicySha256,
      seed: input.seed,
      fixedDateMs: input.fixedDateMs,
      left,
      right,
      sharedProjectedScenarioSha256: sharedScenario,
      sharedProjectedPlanSha256: sharedPlan,
      planProjectionApplied,
      runtimeProjection,
      report,
    }),
  }
}

// replay rederives both shared hashes from the retained per-side evidence alone
export function rederiveEditProjectedDifferentialHashesV1(
  evidence: EditProjectedDifferentialEvidenceV1
): { readonly scenarioSha256: string; readonly planSha256: string }
{
  return {
    scenarioSha256: sharedProjectedScenarioSha256V1({
      semanticPolicySha256: evidence.semanticPolicySha256,
      leftActionTraceSha256: evidence.left.concreteActionTraceSha256,
      rightActionTraceSha256: evidence.right.concreteActionTraceSha256,
    }),
    planSha256: evidence.planProjectionApplied
      ? sharedProjectedPlanSha256V1({
          semanticPolicySha256: evidence.semanticPolicySha256,
          leftPlanSha256: evidence.left.originalPlanSha256,
          rightPlanSha256: evidence.right.originalPlanSha256,
          runtimeProjectionSha256: evidence.runtimeProjection?.projectionSha256,
        })
      : evidence.left.originalPlanSha256,
  }
}
