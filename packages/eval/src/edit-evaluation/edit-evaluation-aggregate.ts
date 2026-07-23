// packages/eval/src/edit-evaluation/edit-evaluation-aggregate.ts
// separable required-change, allowed-change, & preserved-behavior aggregation

import { semanticHashV1 } from '@scratch-agent/ir/edit'

import { compareEditDiagnosticsV1 } from './edit-diagnostics.js'

import type { EditDiagnosticEvidenceV1 } from './edit-diagnostics.js'
import type { EditEvaluationLaneV1 } from './edit-evaluation-matrix.js'
import type {
  PreservationLensV1,
  RuntimeExpectedV1,
  RuntimePredicateV1,
  ScratchScalarV1,
} from '@scratch-agent/ir/edit'

// a dimension is satisfied only by positive proof; every non-proof path is a
// distinct outcome so nothing collapses into a silent pass
export type EditEvaluationDimensionOutcomeV1 =
  'satisfied' | 'violated' | 'inconclusive' | 'unavailable' | 'notApplicable'

type EditEvaluationStatusV1 =
  'passed' | 'failed' | 'inconclusive' | 'unavailable'

// what the CANDIDATE was actually observed to be; the shape is chosen per
// predicate kind so aggregation never guesses at an untyped blob
export type EditCandidateObservedValueV1 =
  | {
      readonly kind: 'stateValue'
      readonly valueKind: 'scalar'
      readonly value: ScratchScalarV1
    }
  | {
      readonly kind: 'stateValue'
      readonly valueKind: 'scalarList'
      readonly value: readonly ScratchScalarV1[]
    }
  | {
      readonly kind: 'stateValue'
      readonly valueKind: 'canonicalJson'
      readonly valueSha256: string
    }
  | { readonly kind: 'cloneCount'; readonly count: number }
  | {
      readonly kind: 'runtimeOutcome'
      readonly ok: boolean
      readonly issueMultisetSha256: string
    }
  | {
      readonly kind: 'visualJudgment'
      readonly satisfied: boolean
      readonly judgmentSha256: string
    }

// one observation of the candidate for exactly one required-change objective;
// an unavailable or inconclusive observation carries no value at all
export type EditCandidateObservationV1 =
  | {
      readonly objectiveId: string
      readonly predicateSha256?: string
      readonly status: 'observed'
      readonly observed: EditCandidateObservedValueV1
    }
  | {
      readonly objectiveId: string
      readonly predicateSha256?: string
      readonly status: 'unavailable' | 'inconclusive'
      readonly reason: string
    }

type EditPreservationLensOutcomeV1 =
  'agreed' | 'diverged' | 'inconclusive' | 'unavailable'

export interface EditPreservationLensObservationV1
{
  readonly lensSha256: string
  readonly scenarioId: string
  readonly lane: EditEvaluationLaneV1
  readonly lensKind: PreservationLensV1['lensKind']
  readonly outcome: EditPreservationLensOutcomeV1
  readonly comparisonSha256: string | null
  readonly reason?: string
}

type EditLaneAvailabilityV1 =
  'available' | 'unavailable' | 'inconclusive'

export interface EditLaneStatusV1
{
  readonly lane: EditEvaluationLaneV1
  readonly disposition: 'required' | 'optional' | 'forbidden'
  readonly availability: EditLaneAvailabilityV1
  // only a required lane pins how an unavailable lane must be reported
  readonly requiredUnavailableResult: 'unavailable' | 'inconclusive' | null
  readonly reason?: string
}

// ---------------------------------------------------------------- required

export interface EditRequiredChangeResultV1
{
  readonly outcome: EditEvaluationDimensionOutcomeV1
  readonly evaluatedPostconditionCount: number
  readonly satisfiedObjectiveIds: readonly string[]
  readonly violatedObjectiveIds: readonly string[]
  readonly inconclusiveObjectiveIds: readonly string[]
  readonly unavailableObjectiveIds: readonly string[]
  readonly resultSha256: string
}

export interface EditStructuralObjectiveObservationV1
{
  readonly objectiveId: string
  readonly predicateSha256: string
  readonly status: 'satisfied' | 'pending' | 'violated'
}

export function editRuntimePredicateRowSha256V1(
  predicate: RuntimePredicateV1
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'runtime-predicate-row',
    predicate,
  })
}

function scalarEquals(left: ScratchScalarV1, right: ScratchScalarV1): boolean
{
  return (
    semanticHashV1('evidence-content', { v: left }) ===
    semanticHashV1('evidence-content', { v: right })
  )
}

function expectedMatches(
  expected: RuntimeExpectedV1,
  observed: EditCandidateObservedValueV1
): boolean
{
  if (observed.kind !== 'stateValue') return false
  if (expected.valueKind !== observed.valueKind) return false
  if (expected.valueKind === 'scalar' && observed.valueKind === 'scalar')
    return scalarEquals(expected.value, observed.value)
  if (
    expected.valueKind === 'scalarList' &&
    observed.valueKind === 'scalarList'
  )
  {
    return (
      expected.value.length === observed.value.length &&
      expected.value.every((entry, index) =>
        scalarEquals(entry, observed.value[index]!)
      )
    )
  }
  if (
    expected.valueKind === 'canonicalJson' &&
    observed.valueKind === 'canonicalJson'
  )
    return expected.valueSha256 === observed.valueSha256
  return false
}

function withinTolerance(
  expected: number,
  tolerance: number,
  observed: EditCandidateObservedValueV1
): boolean
{
  if (observed.kind !== 'stateValue' || observed.valueKind !== 'scalar')
    return false
  const value =
    typeof observed.value === 'number' ? observed.value : Number(observed.value)
  if (!Number.isFinite(value)) return false
  return Math.abs(value - expected) <= tolerance
}

// * the entire required dimension reads only candidate observations; no
// * baseline value is in scope here, so divergence can never satisfy it
function predicateSatisfied(
  predicate: RuntimePredicateV1,
  observed: EditCandidateObservedValueV1
): boolean
{
  if (predicate.kind === 'stateAtLabel')
  {
    return predicate.assertion.comparator === 'equals'
      ? expectedMatches(predicate.assertion.expected, observed)
      : withinTolerance(
          predicate.assertion.expected,
          predicate.assertion.tolerance,
          observed
        )
  }
  if (predicate.kind === 'cloneCountAtTick')
  {
    return (
      observed.kind === 'cloneCount' && observed.count === predicate.exactCount
    )
  }
  if (predicate.kind === 'runtimeOutcome')
  {
    return (
      observed.kind === 'runtimeOutcome' &&
      observed.ok === predicate.ok &&
      observed.issueMultisetSha256 === predicate.exactIssueMultisetSha256
    )
  }
  return observed.kind === 'visualJudgment' && observed.satisfied
}

export function aggregateRequiredChangeV1(input: {
  readonly predicates: readonly RuntimePredicateV1[]
  readonly observations: readonly EditCandidateObservationV1[]
  readonly structuralObjectives?: readonly EditStructuralObjectiveObservationV1[]
  readonly planClass: 'behavioralEdit' | 'structuralMetadataOnly'
}): EditRequiredChangeResultV1
{
  const byObjective = new Map<string, EditCandidateObservationV1[]>()
  for (const observation of input.observations)
  {
    const bucket = byObjective.get(observation.objectiveId) ?? []
    bucket.push(observation)
    byObjective.set(observation.objectiveId, bucket)
  }
  const predicateCounts = new Map<string, number>()
  for (const predicate of input.predicates)
    predicateCounts.set(
      predicate.objectiveId,
      (predicateCounts.get(predicate.objectiveId) ?? 0) + 1
    )
  const rows: unknown[] = []
  const rowOutcomes = new Map<
    string,
    ('satisfied' | 'violated' | 'inconclusive' | 'unavailable')[]
  >()
  let evaluatedPostconditionCount = 0
  const retainOutcome = (
    objectiveId: string,
    outcome: 'satisfied' | 'violated' | 'inconclusive' | 'unavailable'
  ): void =>
  {
    const bucket = rowOutcomes.get(objectiveId) ?? []
    bucket.push(outcome)
    rowOutcomes.set(objectiveId, bucket)
    if (outcome === 'satisfied' || outcome === 'violated')
      evaluatedPostconditionCount++
  }
  for (const predicate of input.predicates)
  {
    const predicateSha256 = editRuntimePredicateRowSha256V1(predicate)
    const candidates = byObjective.get(predicate.objectiveId) ?? []
    const exact = candidates.filter(
      (observation) => observation.predicateSha256 === predicateSha256
    )
    const observation =
      exact.length === 1
        ? exact[0]
        : exact.length === 0 &&
            predicateCounts.get(predicate.objectiveId) === 1 &&
            candidates.length === 1 &&
            candidates[0]!.predicateSha256 === undefined
          ? candidates[0]
          : undefined
    // a predicate w/ no observation at all is not a pass; it is missing proof
    if (observation === undefined)
    {
      retainOutcome(predicate.objectiveId, 'inconclusive')
      rows.push({
        objectiveId: predicate.objectiveId,
        predicateSha256,
        kind: predicate.kind,
        lane: predicate.lane,
        scenarioId: predicate.scenarioId,
        outcome: 'inconclusive',
        reason: 'no-candidate-observation',
      })
      continue
    }
    if (observation.status !== 'observed')
    {
      retainOutcome(predicate.objectiveId, observation.status)
      rows.push({
        objectiveId: predicate.objectiveId,
        predicateSha256,
        kind: predicate.kind,
        lane: predicate.lane,
        scenarioId: predicate.scenarioId,
        outcome: observation.status,
        reason: observation.reason,
      })
      continue
    }
    const ok = predicateSatisfied(predicate, observation.observed)
    retainOutcome(predicate.objectiveId, ok ? 'satisfied' : 'violated')
    rows.push({
      objectiveId: predicate.objectiveId,
      predicateSha256,
      kind: predicate.kind,
      lane: predicate.lane,
      scenarioId: predicate.scenarioId,
      outcome: ok ? 'satisfied' : 'violated',
      observed: observation.observed,
    })
  }
  for (const structural of input.structuralObjectives ?? [])
  {
    const outcome =
      structural.status === 'satisfied'
        ? 'satisfied'
        : structural.status === 'violated'
          ? 'violated'
          : 'inconclusive'
    retainOutcome(structural.objectiveId, outcome)
    rows.push({
      objectiveId: structural.objectiveId,
      predicateSha256: structural.predicateSha256,
      kind: 'structural',
      outcome,
      status: structural.status,
    })
  }
  const satisfied: string[] = []
  const violated: string[] = []
  const inconclusive: string[] = []
  const unavailable: string[] = []
  for (const [objectiveId, outcomes] of rowOutcomes)
  {
    if (outcomes.some((outcome) => outcome === 'violated'))
      violated.push(objectiveId)
    else if (outcomes.some((outcome) => outcome === 'unavailable'))
      unavailable.push(objectiveId)
    else if (outcomes.some((outcome) => outcome === 'inconclusive'))
      inconclusive.push(objectiveId)
    else satisfied.push(objectiveId)
  }
  for (const bucket of [satisfied, violated, inconclusive, unavailable])
    bucket.sort()
  const rowCount =
    input.predicates.length + (input.structuralObjectives?.length ?? 0)
  const outcome: EditEvaluationDimensionOutcomeV1 =
    rowCount === 0
      ? 'notApplicable'
      : violated.length > 0
        ? 'violated'
        : unavailable.length > 0
          ? 'unavailable'
          : inconclusive.length > 0
            ? 'inconclusive'
            : 'satisfied'
  return Object.freeze({
    outcome,
    evaluatedPostconditionCount,
    satisfiedObjectiveIds: Object.freeze(satisfied),
    violatedObjectiveIds: Object.freeze(violated),
    inconclusiveObjectiveIds: Object.freeze(inconclusive),
    unavailableObjectiveIds: Object.freeze(unavailable),
    resultSha256: semanticHashV1('certificate', {
      kind: 'required-change-result',
      schemaVersion: 1,
      planClass: input.planClass,
      outcome,
      rows,
    }),
  })
}

// ----------------------------------------------------------------- allowed

export interface EditAllowedChangeResultV1
{
  readonly outcome: EditEvaluationDimensionOutcomeV1
  readonly addedDiagnosticCount: number
  readonly removedDiagnosticCount: number
  readonly retainedDiagnosticCount: number
  readonly rejectedDiagnosticFingerprints: readonly string[]
  readonly boundedResourceIssueCodes: readonly string[]
  readonly resultSha256: string
}

interface EditAllowedChangeInputV1
{
  readonly baselineDiagnostics: readonly EditDiagnosticEvidenceV1[]
  readonly candidateDiagnostics: readonly EditDiagnosticEvidenceV1[]
  // fingerprints the contract's allowed-change policy admits as new
  readonly allowedNewDiagnosticFingerprints: readonly string[]
  readonly boundedResourceIssueCodes: readonly string[]
  readonly laneStatuses: readonly EditLaneStatusV1[]
}

// diagnostics are compared through the stable lineage fingerprint already used
// by edit-diagnostics, so a moved-but-unchanged block is never a new diagnostic
export function aggregateAllowedChangeV1(
  input: EditAllowedChangeInputV1
): EditAllowedChangeResultV1
{
  const comparison = compareEditDiagnosticsV1(
    input.baselineDiagnostics,
    input.candidateDiagnostics
  )
  const allowed = new Set(input.allowedNewDiagnosticFingerprints)
  const rejected = comparison.added
    .filter((entry) => !allowed.has(entry.fingerprint))
    .map((entry) => entry.fingerprint)
  const inconclusiveLanes = input.laneStatuses.filter(
    (lane) =>
      lane.disposition === 'required' && lane.availability === 'inconclusive'
  )
  const outcome: EditEvaluationDimensionOutcomeV1 =
    rejected.length > 0
      ? 'violated'
      : input.boundedResourceIssueCodes.length > 0 ||
          inconclusiveLanes.length > 0
        ? 'inconclusive'
        : 'satisfied'
  return Object.freeze({
    outcome,
    addedDiagnosticCount: comparison.added.length,
    removedDiagnosticCount: comparison.removed.length,
    retainedDiagnosticCount: comparison.retained.length,
    rejectedDiagnosticFingerprints: Object.freeze(rejected),
    boundedResourceIssueCodes: Object.freeze([
      ...input.boundedResourceIssueCodes,
    ]),
    resultSha256: semanticHashV1('certificate', {
      kind: 'allowed-change-result',
      schemaVersion: 1,
      outcome,
      added: comparison.added.map((entry) => entry.fingerprint),
      removed: comparison.removed.map((entry) => entry.fingerprint),
      retained: comparison.retained.map((entry) => entry.fingerprint),
      rejected,
      boundedResourceIssueCodes: input.boundedResourceIssueCodes,
    }),
  })
}

// --------------------------------------------------------------- preserved

export interface EditPreservationResultV1
{
  readonly outcome: EditEvaluationDimensionOutcomeV1
  readonly agreedLensCount: number
  readonly divergedLensCount: number
  readonly inconclusiveLensCount: number
  readonly unavailableLensCount: number
  readonly resultSha256: string
}

export function editPreservationLensRowSha256V1(
  lens: PreservationLensV1
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'preservation-lens-row',
    lens,
  })
}

// every declared preservation lens is required (the contract has no optional
// arm), so a missing observation is missing proof, never an implicit agreement
export function aggregatePreservationV1(input: {
  readonly lenses: readonly PreservationLensV1[]
  readonly observations: readonly EditPreservationLensObservationV1[]
}): EditPreservationResultV1
{
  const byLens = new Map<string, EditPreservationLensObservationV1[]>()
  for (const observation of input.observations)
  {
    const bucket = byLens.get(observation.lensSha256) ?? []
    bucket.push(observation)
    byLens.set(observation.lensSha256, bucket)
  }
  let agreed = 0
  let diverged = 0
  let inconclusive = 0
  let unavailable = 0
  const rows: unknown[] = []
  for (const lens of input.lenses)
  {
    const lensSha256 = editPreservationLensRowSha256V1(lens)
    const bucket = byLens.get(lensSha256)
    const candidate = bucket?.shift()
    const observation =
      candidate?.scenarioId === lens.scenarioId &&
      candidate.lane === lens.lane &&
      candidate.lensKind === lens.lensKind
        ? candidate
        : undefined
    const outcome: EditPreservationLensOutcomeV1 =
      observation?.outcome ?? 'inconclusive'
    if (outcome === 'agreed') agreed += 1
    else if (outcome === 'diverged') diverged += 1
    else if (outcome === 'unavailable') unavailable += 1
    else inconclusive += 1
    rows.push({
      scenarioId: lens.scenarioId,
      lane: lens.lane,
      lensKind: lens.lensKind,
      lensSha256,
      lensPolicySha256: lens.lensPolicySha256,
      outcome,
      comparisonSha256: observation?.comparisonSha256 ?? null,
      reason: observation?.reason ?? 'no-lens-observation',
    })
  }
  const outcome: EditEvaluationDimensionOutcomeV1 =
    diverged > 0
      ? 'violated'
      : unavailable > 0
        ? 'unavailable'
        : inconclusive > 0
          ? 'inconclusive'
          : 'satisfied'
  return Object.freeze({
    outcome,
    agreedLensCount: agreed,
    divergedLensCount: diverged,
    inconclusiveLensCount: inconclusive,
    unavailableLensCount: unavailable,
    resultSha256: semanticHashV1('certificate', {
      kind: 'preservation-result',
      schemaVersion: 1,
      outcome,
      rows,
    }),
  })
}

// ------------------------------------------------------------ overall status

export interface EditEvaluationAggregateV1
{
  readonly status: EditEvaluationStatusV1
  readonly required: EditRequiredChangeResultV1
  readonly allowed: EditAllowedChangeResultV1
  readonly preservation: EditPreservationResultV1
  readonly limitations: readonly string[]
  readonly blocksExport: boolean
}

// required-lane unavailability is reported exactly as the contract's lane row
// pins it, so a plan can decide whether a missing lane is fatal or merely unknown
function laneLimitations(lanes: readonly EditLaneStatusV1[]): {
  limitations: readonly string[]
  worst: EditEvaluationDimensionOutcomeV1
}
{
  const limitations: string[] = []
  let worst: EditEvaluationDimensionOutcomeV1 = 'satisfied'
  for (const lane of lanes)
  {
    if (lane.disposition === 'forbidden') continue
    if (lane.availability === 'available') continue
    if (lane.disposition === 'optional')
    {
      limitations.push(
        `optional lane ${lane.lane} reported ${lane.availability}${
          lane.reason === undefined ? '' : `: ${lane.reason}`
        }`
      )
      continue
    }
    const reported =
      lane.availability === 'unavailable'
        ? (lane.requiredUnavailableResult ?? 'unavailable')
        : 'inconclusive'
    limitations.push(
      `required lane ${lane.lane} reported ${reported}${
        lane.reason === undefined ? '' : `: ${lane.reason}`
      }`
    )
    if (reported === 'unavailable') worst = 'unavailable'
    else if (worst !== 'unavailable') worst = 'inconclusive'
  }
  return { limitations: Object.freeze(limitations), worst }
}

export function aggregateEditEvaluationV1(input: {
  readonly required: EditRequiredChangeResultV1
  readonly allowed: EditAllowedChangeResultV1
  readonly preservation: EditPreservationResultV1
  readonly laneStatuses: readonly EditLaneStatusV1[]
  readonly extraLimitations?: readonly string[]
}): EditEvaluationAggregateV1
{
  const lanes = laneLimitations(input.laneStatuses)
  const dimensions: readonly EditEvaluationDimensionOutcomeV1[] = [
    input.required.outcome,
    input.allowed.outcome,
    input.preservation.outcome,
    lanes.worst,
  ]
  // a proven violation is determinate & outranks any missing lane; only after
  // that does missing proof decide between unavailable & inconclusive
  const status: EditEvaluationStatusV1 = dimensions.includes('violated')
    ? 'failed'
    : dimensions.includes('unavailable')
      ? 'unavailable'
      : dimensions.includes('inconclusive')
        ? 'inconclusive'
        : 'passed'
  const limitations = Object.freeze([
    ...lanes.limitations,
    ...(input.extraLimitations ?? []),
    ...input.allowed.boundedResourceIssueCodes.map(
      (code) => `bounded observation resource issue ${code}`
    ),
  ])
  return Object.freeze({
    status,
    required: input.required,
    allowed: input.allowed,
    preservation: input.preservation,
    limitations,
    // only a passed evaluation can authorize export; a required-dimension
    // inconclusive is explicitly non-exportable
    blocksExport: status !== 'passed',
  })
}

export function editEvaluationLimitationSetSha256V1(
  limitations: readonly string[]
): string
{
  return semanticHashV1('certificate', {
    kind: 'evaluation-limitation-set',
    schemaVersion: 1,
    entries: [...limitations],
  })
}

export function editEvaluationGateDispositionSetSha256V1(
  lanes: readonly EditLaneStatusV1[]
): string
{
  return semanticHashV1('certificate', {
    kind: 'evaluation-gate-disposition-set',
    schemaVersion: 1,
    entries: lanes.map((lane) => ({
      lane: lane.lane,
      disposition: lane.disposition,
      availability: lane.availability,
      requiredUnavailableResult: lane.requiredUnavailableResult,
    })),
  })
}
