// packages/eval/src/edit-evaluation/edit-evaluation-matrix.ts
// reserve the complete bounded lane/scenario/side evaluation matrix before any dispatch

import {
  resolvePhase8ResourcePolicy,
  type LaneRequirementV1,
} from '@scratch-agent/ir/edit'
import { MAX_TEMPORAL_BYTES } from '@scratch-agent/runner'

import {
  editRuntimeHashV1,
  type EditEvaluationSideV1,
} from './edit-scenario-lowering.js'

export type EditEvaluationLaneV1 = LaneRequirementV1['lane']

// projectPreflight runs once per artifact & is charged separately from the
// lane/scenario/side matrix, exactly as the quota table accounts for it
const PROJECT_PREFLIGHT_LANE: EditEvaluationLaneV1 = 'projectPreflight'

const MANDATORY_PREFLIGHT_ARTIFACT_COUNT_V1 = 2

interface EditEvaluationScenarioRequestV1
{
  readonly scenarioId: string
  readonly applicability: 'baselineAndCandidate' | 'candidateOnly'
  readonly semanticPolicySha256: string
}

export interface EditEvaluationMatrixCellV1
{
  readonly ordinal: number
  readonly lane: EditEvaluationLaneV1
  readonly scenarioId: string
  readonly side: EditEvaluationSideV1
  readonly disposition: 'required' | 'optional'
  readonly reservedTraceBytes: number
}

type EditEvaluationMatrixRefusalReasonV1 =
  | 'forbidden-lane-requested'
  | 'duplicate-scenario-id'
  | 'no-executable-lane'
  | 'no-scenario'
  | 'scenario-limit-exceeded'
  | 'cell-limit-exceeded'
  | 'attempt-trace-budget-exhausted'

export type EditEvaluationMatrixReservationV1 =
  | {
      readonly status: 'reserved'
      readonly cells: readonly EditEvaluationMatrixCellV1[]
      readonly preflightArtifactCount: number
      readonly reservedTraceBytesPerCell: number
      readonly reservedTraceBytesTotal: number
      readonly reservedMediaBytesPerBrowserCell: number
      readonly reservedMediaBytesTotal: number
      readonly reservedMetadataBytesTotal: number
      readonly reservedArtifactBytesTotal: number
      readonly matrixSha256: string
    }
  | {
      readonly status: 'refused'
      readonly reason: EditEvaluationMatrixRefusalReasonV1
      readonly detail: string
      readonly requestedCellCount: number
      readonly limit: number
    }

interface EditEvaluationMatrixRequestV1
{
  // declared lane order; forbidden lanes are a contract error here, not a skip
  readonly laneRequirements: readonly LaneRequirementV1[]
  readonly scenarios: readonly EditEvaluationScenarioRequestV1[]
  // baseline + candidate for a preservation-capable attempt; candidate alone
  // when no baseline artifact participates
  readonly artifactSides: readonly EditEvaluationSideV1[]
  readonly limitOverrides?: Record<string, number>
}

function sidesFor(
  applicability: EditEvaluationScenarioRequestV1['applicability'],
  artifactSides: readonly EditEvaluationSideV1[]
): readonly EditEvaluationSideV1[]
{
  if (applicability === 'candidateOnly')
    return artifactSides.filter((side) => side === 'candidate')
  return artifactSides
}

function refusal(
  reason: EditEvaluationMatrixRefusalReasonV1,
  detail: string,
  requestedCellCount: number,
  limit: number
): EditEvaluationMatrixReservationV1
{
  return Object.freeze({
    status: 'refused' as const,
    reason,
    detail,
    requestedCellCount,
    limit,
  })
}

// expand the whole prospective matrix, charge it against the frozen quota table,
// & only then hand back an ordered reservation. nothing is chosen adaptively
// after results, & an over-budget attempt refuses cleanly instead of truncating.
export function reserveEditEvaluationMatrixV1(
  request: EditEvaluationMatrixRequestV1
): EditEvaluationMatrixReservationV1
{
  const policy = resolvePhase8ResourcePolicy(request.limitOverrides ?? {})
  const cellLimit = policy.laneSideScenarioCellsPerEvaluationAttempt
  const scenarioLimit = policy.scenarioPoliciesPerEvaluationPlan
  const attemptTraceBytes =
    policy.structuredRuntimeTraceBytesPerEvaluationAttempt
  const perCellTraceLimit =
    policy.structuredRuntimeTraceBytesPerLaneScenarioSide

  const forbidden = request.laneRequirements.filter(
    (requirement) => requirement.disposition === 'forbidden'
  )
  const executable = request.laneRequirements.filter(
    (requirement) =>
      requirement.lane !== PROJECT_PREFLIGHT_LANE &&
      requirement.disposition !== 'forbidden'
  )
  const scenarioIds = new Set<string>()
  for (const scenario of request.scenarios)
  {
    if (scenarioIds.has(scenario.scenarioId))
      return refusal(
        'duplicate-scenario-id',
        `scenario ${scenario.scenarioId} is declared more than once`,
        0,
        scenarioLimit
      )
    scenarioIds.add(scenario.scenarioId)
  }
  if (request.scenarios.length === 0)
    return refusal(
      'no-scenario',
      'the plan declares no scenario',
      0,
      scenarioLimit
    )
  if (request.scenarios.length > scenarioLimit)
    return refusal(
      'scenario-limit-exceeded',
      `${request.scenarios.length} scenarios exceed the ${scenarioLimit} per-plan limit`,
      0,
      scenarioLimit
    )
  if (executable.length === 0)
    return refusal(
      'no-executable-lane',
      'no execution, render, or native lane is enabled',
      0,
      cellLimit
    )

  // a forbidden lane that a scenario would still need is a contract error, so the
  // refusal names it rather than silently dropping the cell
  const forbiddenNames = forbidden.map((requirement) => requirement.lane)

  const pending: Omit<
    EditEvaluationMatrixCellV1,
    'ordinal' | 'reservedTraceBytes'
  >[] = []
  for (const scenario of request.scenarios)
    for (const requirement of executable)
      for (const side of sidesFor(
        scenario.applicability,
        request.artifactSides
      ))
        pending.push({
          lane: requirement.lane,
          scenarioId: scenario.scenarioId,
          side,
          disposition:
            requirement.disposition === 'required' ? 'required' : 'optional',
        })

  if (pending.length === 0)
    return refusal(
      forbiddenNames.length > 0
        ? 'forbidden-lane-requested'
        : 'no-executable-lane',
      forbiddenNames.length > 0
        ? `every remaining lane is forbidden: ${forbiddenNames.join(', ')}`
        : 'the matrix resolves to zero cells',
      0,
      cellLimit
    )
  if (pending.length > cellLimit)
    return refusal(
      'cell-limit-exceeded',
      `${pending.length} lane/scenario/side cells exceed the ${cellLimit} per-attempt limit`,
      pending.length,
      cellLimit
    )

  // every cell gets an equal, non-overcommitted share of the attempt trace budget
  const perCell = Math.min(
    perCellTraceLimit,
    Math.floor(attemptTraceBytes / pending.length)
  )
  if (perCell < 1)
    return refusal(
      'attempt-trace-budget-exhausted',
      `${pending.length} cells cannot each hold at least one retained byte of the ${attemptTraceBytes}-byte attempt trace budget`,
      pending.length,
      attemptTraceBytes
    )

  const cells = Object.freeze(
    pending.map((cell, ordinal) =>
      Object.freeze({ ...cell, ordinal, reservedTraceBytes: perCell })
    )
  )
  const reservedTraceBytesTotal = perCell * cells.length
  const browserCellCount = cells.filter(
    (cell) =>
      cell.lane === 'officialBrowser' || cell.lane === 'turboWarpBrowser'
  ).length
  // one browser cell may retain scenario screenshots, bounded temporal frames,
  // & one derived video. each class receives the runner's hard media-byte cap.
  const reservedMediaBytesPerBrowserCell = MAX_TEMPORAL_BYTES * 3
  const reservedMediaBytesTotal =
    browserCellCount * reservedMediaBytesPerBrowserCell
  // preflight, matrix, evidence indexes, external records, certificate, report,
  // & event metadata share one additional attempt-trace-sized bounded envelope.
  const reservedMetadataBytesTotal = attemptTraceBytes
  const reservedArtifactBytesTotal =
    reservedTraceBytesTotal +
    reservedMediaBytesTotal +
    reservedMetadataBytesTotal
  return Object.freeze({
    status: 'reserved' as const,
    cells,
    preflightArtifactCount: MANDATORY_PREFLIGHT_ARTIFACT_COUNT_V1,
    reservedTraceBytesPerCell: perCell,
    reservedTraceBytesTotal,
    reservedMediaBytesPerBrowserCell,
    reservedMediaBytesTotal,
    reservedMetadataBytesTotal,
    reservedArtifactBytesTotal,
    matrixSha256: editRuntimeHashV1('edit-evaluation-matrix', {
      cells,
      preflightArtifactCount: MANDATORY_PREFLIGHT_ARTIFACT_COUNT_V1,
      reservedTraceBytesPerCell: perCell,
      reservedTraceBytesTotal,
      reservedMediaBytesPerBrowserCell,
      reservedMediaBytesTotal,
      reservedMetadataBytesTotal,
      reservedArtifactBytesTotal,
      resourcePolicy: policy,
    }),
  })
}
