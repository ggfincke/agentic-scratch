// tests/eval/edit-evaluation/edit-evaluation.test.ts
// Group G pure evaluation matrix, aggregation, projection, & mask proofs

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { ProjectIR } from '@scratch-agent/ir'
import type {
  CloneProjectionMaskV1,
  EditEvaluationPlanV1,
  LaneRequirementV1,
  PreservationLensV1,
  RuntimePredicateV1,
  StateProjectionMaskV1,
  VisualProjectionMaskV1,
} from '@scratch-agent/ir/edit'
import { scenarioPolicyValueSemanticSha256V1 } from '@scratch-agent/ir/edit'
import type {
  IdentityBoundActionRecordV1,
  MediaFrameRefV1,
  ObservedRuntimeDeclarationListV1,
  ObservedRuntimeDeclarationValueV1,
  ObservedRuntimeExecutionObservationV1,
  ObservedRuntimeScalarV1,
  ObservedRuntimeTargetSnapshotV1,
  ObservedRuntimeValueV1,
  RuntimeObservationRecordV1,
  VmTrace,
} from '@scratch-agent/runner'
import {
  DEFAULT_RUNTIME_OBSERVATION_CAPS,
  defaultObservationPlan,
} from '@scratch-agent/runner'
import { buildFixtureSb3 } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import {
  aggregateAllowedChangeV1,
  aggregateEditEvaluationV1,
  aggregatePreservationV1,
  aggregateRequiredChangeV1,
  deriveEditProductionExternalRequestsV1,
  editCloneCountSeriesSha256V1,
  editCloneTickSetSha256V1,
  editDecodedRgbaSha256V1,
  editGeometryInstanceSetSha256V1,
  editPreservationLensRowSha256V1,
  editRuntimePredicateRowSha256V1,
  evaluateEditProductionV1,
  evaluateEditBehavioralDifferentialV1,
  inspectSemanticEditArtifact,
  projectEditRuntimeTracesV1,
  rederiveEditProductionDeterministicV1,
  rederiveEditProjectedDifferentialHashesV1,
  reserveEditEvaluationMatrixV1,
  type EditEvaluationDimensionOutcomeV1,
  type EditProductionExternalSelectionSourceV1,
  type EditProductionEvaluationRequestV1,
  type EditProductionDeterministicAuthorityV1,
  type EditProductionPolicyArtifactV1,
  type EditProjectionMaskPolicyV1,
  type EditProjectionNameTransitionV1,
  type EditRuntimeIdentityFacetV1,
  type EditRuntimeProjectionResultV1,
} from '@scratch-agent/eval'
import { buildSourceLineageV1 } from '@scratch-agent/edit'
import { buildEditRuntimeLineageAssignmentV1 } from '@scratch-agent/edit'
import { evaluateBehavioralDifferential } from '@scratch-agent/eval'
import type { BehavioralLensSpecV1 } from '@scratch-agent/eval'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const SCENARIO_ID = 'scenario'

function targetRef(bindingKey = 'sprite')
{
  return {
    contractRefKind: 'existing' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    bindingKey,
  }
}

function statePredicate(input: {
  objectiveId: string
  lane?: RuntimePredicateV1['lane']
  expected?: number
}): Extract<RuntimePredicateV1, { kind: 'stateAtLabel' }>
{
  return {
    objectiveId: input.objectiveId,
    kind: 'stateAtLabel',
    scenarioId: SCENARIO_ID,
    lane: (input.lane ?? 'officialHeadless') as Extract<
      RuntimePredicateV1,
      { kind: 'stateAtLabel' }
    >['lane'],
    label: 'after',
    path: {
      pathKind: 'targetProperty',
      target: targetRef(),
      property: 'x',
    },
    assertion: {
      comparator: 'equals',
      expected: { valueKind: 'scalar', value: input.expected ?? 10 },
    },
  }
}

function observed(predicate: RuntimePredicateV1, value: number)
{
  return {
    objectiveId: predicate.objectiveId,
    predicateSha256: editRuntimePredicateRowSha256V1(predicate),
    status: 'observed' as const,
    observed: {
      kind: 'stateValue' as const,
      valueKind: 'scalar' as const,
      value,
    },
  }
}

test('Group G required-change aggregation needs positive candidate postconditions and treats repeated objectives as all-of', () =>
{
  const official = statePredicate({
    objectiveId: 'move-objective',
    lane: 'officialHeadless',
  })
  const browser = statePredicate({
    objectiveId: 'move-objective',
    lane: 'officialBrowser',
  })

  const divergenceOnly = aggregateRequiredChangeV1({
    predicates: [official],
    observations: [observed(official, 99)],
    planClass: 'behavioralEdit',
  })
  assert.equal(divergenceOnly.outcome, 'violated')
  assert.deepEqual(divergenceOnly.satisfiedObjectiveIds, [])

  const noDivergenceNeeded = aggregateRequiredChangeV1({
    predicates: [official],
    observations: [observed(official, 10)],
    planClass: 'behavioralEdit',
  })
  assert.equal(noDivergenceNeeded.outcome, 'satisfied')
  assert.deepEqual(noDivergenceNeeded.satisfiedObjectiveIds, ['move-objective'])

  const allOf = aggregateRequiredChangeV1({
    predicates: [official, browser],
    observations: [observed(official, 10), observed(browser, 11)],
    planClass: 'behavioralEdit',
  })
  assert.equal(allOf.outcome, 'violated')
  assert.deepEqual(allOf.violatedObjectiveIds, ['move-objective'])
  assert.equal(allOf.evaluatedPostconditionCount, 2)
})

function aggregateForOutcome(outcome: EditEvaluationDimensionOutcomeV1)
{
  const required = aggregateRequiredChangeV1({
    predicates: [statePredicate({ objectiveId: 'required' })],
    observations:
      outcome === 'satisfied'
        ? [observed(statePredicate({ objectiveId: 'required' }), 10)]
        : [],
    planClass: 'behavioralEdit',
  })
  return { ...required, outcome }
}

test('Group G missing evidence is inconclusive and overall precedence is violated, unavailable, inconclusive, passed', () =>
{
  const missing = aggregateRequiredChangeV1({
    predicates: [statePredicate({ objectiveId: 'missing' })],
    observations: [],
    planClass: 'behavioralEdit',
  })
  assert.equal(missing.outcome, 'inconclusive')
  assert.deepEqual(missing.inconclusiveObjectiveIds, ['missing'])

  const allowed = aggregateAllowedChangeV1({
    baselineDiagnostics: [],
    candidateDiagnostics: [],
    allowedNewDiagnosticFingerprints: [],
    boundedResourceIssueCodes: [],
    laneStatuses: [],
  })
  const preservation = aggregatePreservationV1({
    lenses: [],
    observations: [],
  })
  const cases = [
    {
      required: 'violated' as const,
      lane: 'unavailable' as const,
      expected: 'failed',
    },
    {
      required: 'satisfied' as const,
      lane: 'unavailable' as const,
      expected: 'unavailable',
    },
    {
      required: 'satisfied' as const,
      lane: 'inconclusive' as const,
      expected: 'inconclusive',
    },
    {
      required: 'satisfied' as const,
      lane: 'available' as const,
      expected: 'passed',
    },
  ]
  for (const row of cases)
  {
    const aggregate = aggregateEditEvaluationV1({
      required: aggregateForOutcome(row.required),
      allowed,
      preservation,
      laneStatuses: [
        {
          lane: 'officialHeadless',
          disposition: 'required',
          availability: row.lane,
          requiredUnavailableResult: 'unavailable',
        },
      ],
    })
    assert.equal(aggregate.status, row.expected)
    assert.equal(aggregate.blocksExport, row.expected !== 'passed')
  }
})

test('Group G preservation aggregation binds mixed outcomes to complete lens identities', () =>
{
  const firstLens: PreservationLensV1 = {
    scenarioId: SCENARIO_ID,
    lane: 'officialHeadless',
    lensKind: 'finalState',
    lensPolicySha256: HASH_D,
    required: true,
    stateMaskIds: ['first-mask'],
  }
  const secondLens: PreservationLensV1 = {
    ...firstLens,
    stateMaskIds: ['second-mask'],
  }
  const observations = [
    {
      lensSha256: editPreservationLensRowSha256V1(firstLens),
      scenarioId: SCENARIO_ID,
      lane: 'officialHeadless' as const,
      lensKind: 'finalState' as const,
      outcome: 'diverged' as const,
      comparisonSha256: HASH_A,
    },
    {
      lensSha256: editPreservationLensRowSha256V1(secondLens),
      scenarioId: SCENARIO_ID,
      lane: 'officialHeadless' as const,
      lensKind: 'finalState' as const,
      outcome: 'agreed' as const,
      comparisonSha256: HASH_B,
    },
  ]

  assert.notEqual(observations[0]!.lensSha256, observations[1]!.lensSha256)
  const forward = aggregatePreservationV1({
    lenses: [firstLens, secondLens],
    observations,
  })
  const reversed = aggregatePreservationV1({
    lenses: [firstLens, secondLens],
    observations: [...observations].reverse(),
  })

  assert.equal(forward.outcome, 'violated')
  assert.equal(forward.divergedLensCount, 1)
  assert.equal(forward.agreedLensCount, 1)
  assert.equal(reversed.resultSha256, forward.resultSha256)
})

const REQUIRED_LANES: readonly LaneRequirementV1[] = [
  {
    lane: 'officialHeadless',
    disposition: 'required',
    requiredUnavailableResult: 'unavailable',
  },
  {
    lane: 'officialBrowser',
    disposition: 'required',
    requiredUnavailableResult: 'unavailable',
  },
  { lane: 'turboWarpBrowser', disposition: 'optional' },
  { lane: 'nativeVisual', disposition: 'forbidden' },
]

test('Group G reserves the complete deterministic matrix before dispatch and never creates forbidden or candidate-only baseline cells', () =>
{
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: REQUIRED_LANES,
    scenarios: [
      {
        scenarioId: 'both',
        applicability: 'baselineAndCandidate',
        semanticPolicySha256: HASH_A,
      },
      {
        scenarioId: 'candidate',
        applicability: 'candidateOnly',
        semanticPolicySha256: HASH_B,
      },
    ],
    artifactSides: ['baseline', 'candidate'],
  })
  assert.equal(reservation.status, 'reserved', JSON.stringify(reservation))
  if (reservation.status !== 'reserved') return
  assert.deepEqual(
    reservation.cells.map(({ ordinal, lane, scenarioId, side }) => ({
      ordinal,
      lane,
      scenarioId,
      side,
    })),
    [
      {
        ordinal: 0,
        lane: 'officialHeadless',
        scenarioId: 'both',
        side: 'baseline',
      },
      {
        ordinal: 1,
        lane: 'officialHeadless',
        scenarioId: 'both',
        side: 'candidate',
      },
      {
        ordinal: 2,
        lane: 'officialBrowser',
        scenarioId: 'both',
        side: 'baseline',
      },
      {
        ordinal: 3,
        lane: 'officialBrowser',
        scenarioId: 'both',
        side: 'candidate',
      },
      {
        ordinal: 4,
        lane: 'turboWarpBrowser',
        scenarioId: 'both',
        side: 'baseline',
      },
      {
        ordinal: 5,
        lane: 'turboWarpBrowser',
        scenarioId: 'both',
        side: 'candidate',
      },
      {
        ordinal: 6,
        lane: 'officialHeadless',
        scenarioId: 'candidate',
        side: 'candidate',
      },
      {
        ordinal: 7,
        lane: 'officialBrowser',
        scenarioId: 'candidate',
        side: 'candidate',
      },
      {
        ordinal: 8,
        lane: 'turboWarpBrowser',
        scenarioId: 'candidate',
        side: 'candidate',
      },
    ]
  )
  assert.equal(
    reservation.cells.some((cell) => cell.lane === 'nativeVisual'),
    false
  )
  assert.equal(
    reservation.cells.some(
      (cell) => cell.scenarioId === 'candidate' && cell.side === 'baseline'
    ),
    false
  )

  const refused = reserveEditEvaluationMatrixV1({
    laneRequirements: REQUIRED_LANES,
    scenarios: [
      {
        scenarioId: 'both',
        applicability: 'baselineAndCandidate',
        semanticPolicySha256: HASH_A,
      },
    ],
    artifactSides: ['baseline', 'candidate'],
    limitOverrides: { laneSideScenarioCellsPerEvaluationAttempt: 5 },
  })
  assert.deepEqual(refused, {
    status: 'refused',
    reason: 'cell-limit-exceeded',
    detail: '6 lane/scenario/side cells exceed the 5 per-attempt limit',
    requestedCellCount: 6,
    limit: 5,
  })
})

function visualPredicate(
  lane: Extract<RuntimePredicateV1, { kind: 'visualCriterion' }>['lane']
): Extract<RuntimePredicateV1, { kind: 'visualCriterion' }>
{
  return {
    objectiveId: `visual-${lane}`,
    kind: 'visualCriterion',
    scenarioId: SCENARIO_ID,
    lane,
    evidenceWindow: { windowKind: 'label', label: 'after' },
    criterionPolicySha256: HASH_C,
    confidencePolicySha256: HASH_D,
  }
}

function externalPlan(): EditEvaluationPlanV1
{
  const visualLanes = [
    'officialBrowser',
    'turboWarpBrowser',
    'renderedDifferential',
    'nativeVisual',
  ] as const
  return {
    planId: 'external-plan',
    planClass: 'behavioralEdit',
    requiredForExport: true,
    runtimePolicySha256: HASH_A,
    scenarioPolicySha256s: [HASH_B],
    preservationLenses: [],
    laneRequirements: visualLanes.map((lane) => ({
      lane,
      disposition: 'required',
      requiredUnavailableResult: 'unavailable',
    })),
    requiredRuntimeChanges: visualLanes.map(visualPredicate),
  }
}

test('Group G every compatible visual lane derives one exact rubric-bound request from pre-reserved evidence', () =>
{
  const plan = externalPlan()
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: plan.laneRequirements,
    scenarios: [
      {
        scenarioId: SCENARIO_ID,
        applicability: 'baselineAndCandidate',
        semanticPolicySha256: HASH_B,
      },
    ],
    artifactSides: ['baseline', 'candidate'],
  })
  assert.equal(reservation.status, 'reserved')
  if (reservation.status !== 'reserved') return
  const sources: EditProductionExternalSelectionSourceV1[] = reservation.cells
    .filter(
      (cell) =>
        cell.side === 'candidate' &&
        (cell.lane === 'officialBrowser' || cell.lane === 'turboWarpBrowser')
    )
    .map((cell) => ({
      cell,
      evidenceContentSha256: cell.lane === 'officialBrowser' ? HASH_A : HASH_B,
      frames: [
        {
          payloadSha256: cell.lane === 'officialBrowser' ? HASH_C : HASH_D,
          frameId: `${cell.lane}-after`,
          tick: 2,
          snapshotLabel: 'after',
        },
      ],
    }))
  const requests = deriveEditProductionExternalRequestsV1({
    evaluationId: 'evaluation',
    plan,
    policies: [],
    matrixCells: reservation.cells,
    sources,
  })
  assert.deepEqual(
    requests.map((request) => request.lane),
    [
      'officialBrowser',
      'turboWarpBrowser',
      'renderedDifferential',
      'nativeVisual',
    ]
  )
  assert.equal(
    new Set(requests.map((request) => request.requestArtifactId)).size,
    requests.length
  )
  for (const request of requests)
  {
    assert.equal(request.predicateSha256?.length, 64)
    assert.match(request.requestArtifactId, /^[a-f0-9]{64}$/u)
    assert.ok(request.matrixCells.every((cell) => cell.lane === request.lane))
    assert.equal(request.evidenceWindow?.windowKind, 'label')
    const expectedProducers =
      request.lane === 'officialBrowser' || request.lane === 'turboWarpBrowser'
        ? 1
        : 2
    assert.equal(request.evidenceSelections.length, expectedProducers)
  }
})

function scalar(value: string | number | boolean): ObservedRuntimeScalarV1
{
  if (typeof value === 'string') return { scalarKind: 'string', value }
  if (typeof value === 'boolean') return { scalarKind: 'boolean', value }
  return {
    scalarKind: 'number',
    value: { numberKind: 'finite', value },
  }
}

function tagged(value: unknown): ObservedRuntimeValueV1
{
  if (value === null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return scalar(value)
  if (Array.isArray(value)) return value.map(tagged)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      tagged(entry),
    ])
  )
}

interface FixtureTarget
{
  readonly runtimeId: string
  readonly lineage: string
  readonly name: string
  readonly isStage: boolean
  readonly x?: number
  readonly declarations?: readonly FixtureDeclaration[]
  readonly media?: readonly FixtureMedia[]
}

interface FixtureDeclaration
{
  readonly runtimeId: string
  readonly lineage: string
  readonly name: string
  readonly collection: 'variables' | 'lists'
  readonly value: number | readonly number[]
}

interface FixtureMedia
{
  readonly lineage: string
  readonly name: string
  readonly index: number
}

interface FixtureOptions
{
  readonly targets?: readonly FixtureTarget[]
  readonly cloneCounts?: Readonly<Record<string, number>>
  readonly answer?: string
  readonly frame?: MediaFrameRefV1
  readonly rgba?: Uint8Array
}

const STAGE: FixtureTarget = {
  runtimeId: 'runtime-stage',
  lineage: 'stage-lineage',
  name: 'Stage',
  isStage: true,
  media: [{ lineage: 'stage-costume', name: 'backdrop', index: 0 }],
}

const SPRITE: FixtureTarget = {
  runtimeId: 'runtime-sprite',
  lineage: 'sprite-lineage',
  name: 'Sprite',
  isStage: false,
  x: 10,
  declarations: [
    {
      runtimeId: 'variable-id',
      lineage: 'variable-lineage',
      name: 'score',
      collection: 'variables',
      value: 1,
    },
    {
      runtimeId: 'list-id',
      lineage: 'list-lineage',
      name: 'items',
      collection: 'lists',
      value: [1],
    },
  ],
  media: [{ lineage: 'sprite-costume', name: 'costume', index: 0 }],
}

function runtimeTarget(target: FixtureTarget): ObservedRuntimeTargetSnapshotV1
{
  const variables: Record<string, ObservedRuntimeDeclarationValueV1> = {}
  const lists: Record<string, ObservedRuntimeDeclarationListV1> = {}
  for (const declaration of target.declarations ?? [])
  {
    if (declaration.collection === 'variables')
      variables[declaration.runtimeId] = {
        name: scalar(declaration.name),
        value: scalar(declaration.value as number),
      }
    else
      lists[declaration.runtimeId] = {
        name: scalar(declaration.name),
        items: (declaration.value as readonly number[]).map(scalar),
      }
  }
  const costume = target.media?.[0] ?? {
    lineage: 'unused',
    name: 'costume',
    index: 0,
  }
  return {
    id: target.runtimeId,
    name: scalar(target.name),
    isStage: scalar(target.isStage),
    x: scalar(target.x ?? 0),
    y: scalar(0),
    direction: scalar(90),
    costume: scalar(costume.name),
    costumeIndex: scalar(costume.index),
    visible: scalar(true),
    size: scalar(100),
    rotationStyle: scalar('all around'),
    draggable: scalar(false),
    volume: scalar(100),
    effects: {},
    bubble: null,
    variables,
    lists,
  }
}

function visualValue(frame: MediaFrameRefV1): ObservedRuntimeValueV1
{
  return tagged({
    identityIssues: [],
    geometry: frame.geometry,
  })
}

function fixture(side: 'baseline' | 'candidate', options: FixtureOptions = {})
{
  const targets = options.targets ?? [STAGE, SPRITE]
  const frame = options.frame
  const observation: ObservedRuntimeExecutionObservationV1 & {
    readonly visual?: ObservedRuntimeValueV1
  } = {
    state: {
      schemaVersion: 1,
      tick: 1,
      targetOrder: targets.map((target) => target.runtimeId),
      targetsById: Object.fromEntries(
        targets.map((target) => [target.runtimeId, runtimeTarget(target)])
      ),
      stageTargetId: STAGE.runtimeId,
      answer: scalar(options.answer ?? 'same'),
      timer: scalar(0),
      stage: {
        backdrop: scalar(STAGE.media![0]!.name),
        tempo: scalar(60),
        videoState: scalar('off'),
      },
    },
    cloneCounts: tagged({
      total: Object.values(options.cloneCounts ?? {}).reduce(
        (sum, count) => sum + count,
        0
      ),
      byOriginalTargetId: options.cloneCounts ?? {},
    }),
    supplemental: null,
    cloneIdentityIssues: [],
    ...(frame ? { visual: visualValue(frame) } : {}),
  }
  const records: RuntimeObservationRecordV1<ObservedRuntimeExecutionObservationV1>[] =
    [
      {
        tick: 1,
        scenarioStepIndex: 1,
        label: null,
        capture: {
          status: 'observed',
          value: observation,
          totals: {} as never,
        },
      },
    ]
  const artifactSha256 = side === 'baseline' ? HASH_A : HASH_B
  const trace: VmTrace = {
    ok: true,
    runtime: 'test-runtime',
    runtimeDescriptor: {
      schemaVersion: 1,
      id: 'test-runtime',
      kind: 'scratch-vm-node',
      configurationSha256: HASH_C,
      renderer: frame ? 'scratch-render' : 'none',
      compiler: 'disabled',
      network: 'denied',
      components: [],
      browser: null,
      bundle: null,
      workers: [],
      environment: { node: 'test', platform: 'test', arch: 'test' },
    },
    observations: {
      schemaVersion: 1,
      sourceSb3Sha256: artifactSha256,
      scenarioSha256: `${side}-scenario`,
      plan: { schemaVersion: 1, temporal: null, cloneCounts: 'every-tick' },
      planSha256: `${side}-plan`,
      cloneCounts: [],
      media: frame
        ? {
            schemaVersion: 1,
            observationPlanSha256: HASH_A,
            runtime: {} as never,
            frames: [structuredClone(frame)],
            derivedVideo: null,
            totalFrameBytes: frame.bytes,
            complete: true,
            incompleteReason: null,
          }
        : null,
    },
    snapshots: [],
    finalSnapshot: null,
    errors: [],
    issues: [],
    runtimeLog: {
      total: 0,
      categories: [],
      droppedEvents: 0,
      truncatedBytes: 0,
    },
  }
  const facet: EditRuntimeIdentityFacetV1 = {
    artifactSha256,
    manifestSha256: HASH_C,
    targets: targets.map((target) => ({
      runtimeTargetId: target.runtimeId,
      observationTargetId: target.runtimeId,
      cloneCountTargetId: target.runtimeId,
      geometryOriginalTargetId: target.runtimeId,
      runtimeTargetName: target.name,
      targetLineage: target.lineage,
      isStage: target.isStage,
    })),
    declarations: targets.flatMap((target) =>
      (target.declarations ?? []).map((declaration) => ({
        runtimeName: declaration.name,
        runtimeDeclarationId: declaration.runtimeId,
        declarationLineage: declaration.lineage,
        targetLineage: target.lineage,
        collection: declaration.collection,
      }))
    ),
    media: targets.flatMap((target) =>
      (target.media ?? []).map((media) => ({
        runtimeName: media.name,
        mediaLineage: media.lineage,
        targetLineage: target.lineage,
        mediaKind: 'costume' as const,
        mediaIndex: media.index,
      }))
    ),
    paneTargetLineageOrder: targets.map((target) => target.lineage),
    executableTargetLineageOrder: targets.map((target) => target.lineage),
    decodedPixelFrames:
      frame && options.rgba
        ? [
            {
              frameId: frame.id,
              sourceFrameSha256: frame.sha256,
              width: frame.width,
              height: frame.height,
              rgba: options.rgba,
              rgbaSha256: editDecodedRgbaSha256V1({
                width: frame.width,
                height: frame.height,
                rgba: options.rgba,
              }),
            },
          ]
        : [],
    runtimeObservations: records,
  }
  return { trace, facet, artifactSha256 }
}

function finalStateSpec(): BehavioralLensSpecV1
{
  return {
    schemaVersion: 1,
    id: 'final',
    required: true,
    appliesTo: 'baseline-candidate',
    kind: 'final-state',
    absoluteNumericTolerance: 0,
  }
}

function cloneSpec(): BehavioralLensSpecV1
{
  return {
    schemaVersion: 1,
    id: 'clones',
    required: true,
    appliesTo: 'baseline-candidate',
    kind: 'clone-count-trace',
    ticks: [1],
  }
}

function visualSpec(frameId = 'frame'): BehavioralLensSpecV1
{
  return {
    schemaVersion: 1,
    id: 'visual',
    required: true,
    appliesTo: 'baseline-candidate',
    kind: 'visual-keyframes',
    frameIds: [frameId],
    maxMeanRgbDelta: 0,
    maxNormalizedRectDelta: 0,
  }
}

function projection(input: {
  baseline: ReturnType<typeof fixture>
  candidate: ReturnType<typeof fixture>
  lens: PreservationLensV1
  masks?: {
    state?: readonly StateProjectionMaskV1[]
    clone?: readonly CloneProjectionMaskV1[]
    visual?: readonly VisualProjectionMaskV1[]
  }
  transitions?: readonly EditProjectionNameTransitionV1[]
  memberships?: EditProjectionMaskPolicyV1['targetMembershipAuthorizations']
  specs: readonly BehavioralLensSpecV1[]
}): EditRuntimeProjectionResultV1
{
  const policy: EditProjectionMaskPolicyV1 = {
    scenarioId: SCENARIO_ID,
    lens: input.lens,
    bindings: {
      targets: [
        { bindingKey: 'sprite', targetLineage: SPRITE.lineage },
        { bindingKey: 'added', targetLineage: 'added-lineage' },
      ],
      declarations: [
        {
          bindingKey: 'variable',
          declarationLineage: 'variable-lineage',
          targetLineage: SPRITE.lineage,
          collection: 'variables',
        },
        {
          bindingKey: 'added-variable',
          declarationLineage: 'added-variable-lineage',
          targetLineage: SPRITE.lineage,
          collection: 'variables',
        },
      ],
    },
    masks: {
      state: input.masks?.state ?? [],
      clone: input.masks?.clone ?? [],
      visual: input.masks?.visual ?? [],
    },
    nameTransitions: input.transitions ?? [],
    targetMembershipAuthorizations: input.memberships ?? [],
  }
  return projectEditRuntimeTracesV1({
    baselineTrace: input.baseline.trace,
    candidateTrace: input.candidate.trace,
    baselineArtifactSha256: input.baseline.artifactSha256,
    candidateArtifactSha256: input.candidate.artifactSha256,
    baselineManifestSha256: HASH_C,
    candidateManifestSha256: HASH_C,
    projection: {
      baseline: input.baseline.facet,
      candidate: input.candidate.facet,
      policy,
    },
    specs: input.specs,
  })
}

function evaluatedProjection(
  projected: Extract<EditRuntimeProjectionResultV1, { status: 'projected' }>,
  specs: readonly BehavioralLensSpecV1[]
)
{
  const left = structuredClone(projected.baseline)
  const right = structuredClone(projected.candidate)
  left.observations.scenarioSha256 = HASH_C
  right.observations.scenarioSha256 = HASH_C
  left.observations.planSha256 = HASH_D
  right.observations.planSha256 = HASH_D
  return evaluateBehavioralDifferential({
    comparisonKind: 'baseline-candidate',
    left,
    right,
    specs: [...specs],
  })
}

test('Group G legacy comparator keeps raw equality guards while the edit adapter projects immutable shared hashes', () =>
{
  const baseline = fixture('baseline')
  const candidate = fixture('candidate')
  assert.throws(
    () =>
      evaluateBehavioralDifferential({
        comparisonKind: 'baseline-candidate',
        left: baseline.trace,
        right: candidate.trace,
        specs: [finalStateSpec()],
      }),
    /differential scenarios must match/
  )
  const sameScenario = structuredClone(candidate.trace)
  sameScenario.observations.scenarioSha256 =
    baseline.trace.observations.scenarioSha256
  assert.throws(
    () =>
      evaluateBehavioralDifferential({
        comparisonKind: 'baseline-candidate',
        left: baseline.trace,
        right: sameScenario,
        specs: [finalStateSpec()],
      }),
    /observation plans must match/
  )

  const leftBefore = structuredClone(baseline.trace)
  const rightBefore = structuredClone(candidate.trace)
  const result = evaluateEditBehavioralDifferentialV1({
    comparisonKind: 'baseline-candidate',
    left: {
      side: 'baseline',
      lane: 'officialHeadless',
      trace: baseline.trace,
      lowered: {
        loweringVersion: 'test-v1',
        artifactSha256: HASH_A,
        manifestSha256: HASH_C,
        scenarioId: SCENARIO_ID,
        semanticPolicySha256: HASH_D,
        loweredScenarioSha256: 'baseline-scenario',
        loweredObservationPlanSha256: 'baseline-plan',
        scenario: { seed: 1, fixedDateMs: 2 },
      } as never,
      actions: [{ actionKind: 'greenFlag' }] as never,
    },
    right: {
      side: 'candidate',
      lane: 'officialHeadless',
      trace: candidate.trace,
      lowered: {
        loweringVersion: 'test-v1',
        artifactSha256: HASH_B,
        manifestSha256: HASH_C,
        scenarioId: SCENARIO_ID,
        semanticPolicySha256: HASH_D,
        loweredScenarioSha256: 'candidate-scenario',
        loweredObservationPlanSha256: 'candidate-plan',
        scenario: { seed: 1, fixedDateMs: 2 },
      } as never,
      actions: [{ actionKind: 'greenFlag' }] as never,
    },
    semanticPolicySha256: HASH_D,
    specs: [finalStateSpec()],
    seed: 1,
    fixedDateMs: 2,
  })
  assert.equal(result.status, 'evaluated')
  if (result.status !== 'evaluated') return
  assert.deepEqual(baseline.trace, leftBefore)
  assert.deepEqual(candidate.trace, rightBefore)
  assert.equal(result.evidence.left.originalScenarioSha256, 'baseline-scenario')
  assert.equal(
    result.evidence.right.originalScenarioSha256,
    'candidate-scenario'
  )
  assert.equal(result.evidence.left.originalPlanSha256, 'baseline-plan')
  assert.equal(result.evidence.right.originalPlanSha256, 'candidate-plan')
  assert.deepEqual(rederiveEditProjectedDifferentialHashesV1(result.evidence), {
    scenarioSha256: result.evidence.sharedProjectedScenarioSha256,
    planSha256: result.evidence.sharedProjectedPlanSha256,
  })
})

test('Group G an evidence-row-oversized but matrix-valid request refuses before artifact dispatch', async () =>
{
  const policies: EditProductionPolicyArtifactV1[] = Array.from(
    { length: 8 },
    (_, index) =>
    {
      const value = {
        scenarioId: `scenario-${index}`,
        applicability: 'baselineAndCandidate' as const,
        seed: index,
        fixedDateMs: 1_700_000_000_000,
        maxTicks: 1,
        steps: [{ do: 'greenFlag' as const }],
      }
      const bytes = canonicalJsonBytesV1(value)
      return {
        binding: {
          bindingId: `scenario-binding-${index}`,
          kind: 'scenario' as const,
          schemaVersion: 1,
          semanticSha256: scenarioPolicyValueSemanticSha256V1(value),
          retainedArtifactSha256: createHash('sha256')
            .update(bytes)
            .digest('hex'),
        },
        canonicalByteLength: bytes.byteLength,
        canonicalJson: new TextDecoder().decode(bytes),
        value,
        scenarioPolicy: value,
      }
    }
  )
  const runtimeValue = { policy: 'unavailable' }
  const runtimeBytes = canonicalJsonBytesV1(runtimeValue)
  policies.push({
    binding: {
      bindingId: 'runtime-binding',
      kind: 'runtime',
      schemaVersion: 1,
      semanticSha256: HASH_D,
      retainedArtifactSha256: createHash('sha256')
        .update(runtimeBytes)
        .digest('hex'),
    },
    canonicalByteLength: runtimeBytes.byteLength,
    canonicalJson: new TextDecoder().decode(runtimeBytes),
    value: runtimeValue,
  })
  const plan: EditEvaluationPlanV1 = {
    planId: 'oversized-evidence-plan',
    planClass: 'behavioralEdit',
    requiredForExport: true,
    runtimePolicySha256: HASH_D,
    scenarioPolicySha256s: policies
      .filter((artifact) => artifact.binding.kind === 'scenario')
      .map((artifact) => artifact.binding.semanticSha256),
    preservationLenses: [],
    requiredRuntimeChanges: Array.from({ length: 14 }, (_, index) => ({
      ...visualPredicate('officialBrowser'),
      objectiveId: `evidence-row-${index}`,
    })),
    laneRequirements: [
      {
        lane: 'officialHeadless',
        disposition: 'required',
        requiredUnavailableResult: 'unavailable',
      },
      {
        lane: 'officialBrowser',
        disposition: 'required',
        requiredUnavailableResult: 'unavailable',
      },
      {
        lane: 'turboWarpBrowser',
        disposition: 'required',
        requiredUnavailableResult: 'unavailable',
      },
    ],
  }
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: plan.laneRequirements,
    scenarios: policies
      .filter((artifact) => artifact.scenarioPolicy !== undefined)
      .map((artifact) => ({
        scenarioId: artifact.scenarioPolicy!.scenarioId,
        applicability: artifact.scenarioPolicy!.applicability,
        semanticPolicySha256: artifact.binding.semanticSha256,
      })),
    artifactSides: ['baseline', 'candidate'],
  })
  assert.equal(reservation.status, 'reserved', JSON.stringify(reservation))
  if (reservation.status !== 'reserved') return
  assert.equal(reservation.cells.length, 48)
  await assert.rejects(
    () =>
      evaluateEditProductionV1({
        evaluationId: 'oversized-evidence',
        plan: {
          plan,
          evaluationPlanSha256: HASH_A,
          resourceLimitOverrides: {},
          masks: { state: [], clone: [], visual: [] },
        },
        matrixSha256: reservation.matrixSha256,
        policies,
      } as never),
    (error: unknown) =>
      error instanceof Error &&
      'reason' in error &&
      error.reason === 'certificate-evidence-limit-exceeded'
  )
})

function retainedPreflightProjection(
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

function action(
  stepIndex: number,
  kind: IdentityBoundActionRecordV1['do']
): IdentityBoundActionRecordV1
{
  return {
    stepIndex,
    do: kind,
    tick: stepIndex,
    targetLineage: kind === 'clickTarget' ? 'unresolved-target' : null,
    broadcastLineage: kind === 'broadcast' ? 'unresolved-broadcast' : null,
    concreteName: kind === 'broadcast' ? 'message' : null,
    expectedReceiverTargetLineages: [],
    provenReceiverTargetLineages: [],
    startedReceiverTargetLineages: [],
    startedThreadCount: 0,
  }
}

async function incompleteDriveFixture()
{
  const built = await buildFixtureSb3()
  const project = await ProjectIR.fromSb3(built.sb3)
  const bytes = await project.toSb3()
  const artifactSha256 = sha256Hex(bytes)
  const preflight = await inspectSemanticEditArtifact(bytes)
  assert.ok(preflight.ok)
  assert.ok(preflight.semanticSourceSha256)
  assert.ok(preflight.semanticSourceIdentity)
  const scenario = {
    scenarioId: 'identity-drive',
    applicability: 'baselineAndCandidate' as const,
    seed: 7,
    fixedDateMs: 1_753_056_000_000,
    maxTicks: 5,
    steps: [
      { do: 'clickStage' as const },
      { do: 'snapshot' as const, label: 'done' },
    ],
  }
  const scenarioBytes = canonicalJsonBytesV1(scenario)
  const scenarioSha256 = scenarioPolicyValueSemanticSha256V1(scenario)
  const runtimeValue = { policyKind: 'runtime', schemaVersion: 1 }
  const runtimeBytes = canonicalJsonBytesV1(runtimeValue)
  const runtimeSha256 = HASH_D
  const policies: EditProductionPolicyArtifactV1[] = [
    {
      binding: {
        bindingId: 'identity-drive-scenario',
        kind: 'scenario',
        schemaVersion: 1,
        semanticSha256: scenarioSha256,
        retainedArtifactSha256: sha256Hex(scenarioBytes),
      },
      canonicalByteLength: scenarioBytes.byteLength,
      canonicalJson: new TextDecoder().decode(scenarioBytes),
      value: scenario,
      scenarioPolicy: scenario,
    },
    {
      binding: {
        bindingId: 'identity-drive-runtime',
        kind: 'runtime',
        schemaVersion: 1,
        semanticSha256: runtimeSha256,
        retainedArtifactSha256: sha256Hex(runtimeBytes),
      },
      canonicalByteLength: runtimeBytes.byteLength,
      canonicalJson: new TextDecoder().decode(runtimeBytes),
      value: runtimeValue,
    },
  ]
  const predicate: Extract<RuntimePredicateV1, { kind: 'stateAtLabel' }> = {
    objectiveId: 'must-not-use-default-answer',
    kind: 'stateAtLabel',
    scenarioId: scenario.scenarioId,
    lane: 'officialHeadless',
    label: 'done',
    path: { pathKind: 'stageProperty', property: 'answer' },
    assertion: {
      comparator: 'equals',
      expected: { valueKind: 'scalar', value: '' },
    },
  }
  const plan: EditEvaluationPlanV1 = {
    planId: 'identity-drive-plan',
    planClass: 'behavioralEdit',
    requiredForExport: true,
    runtimePolicySha256: runtimeSha256,
    scenarioPolicySha256s: [scenarioSha256],
    requiredRuntimeChanges: [predicate],
    preservationLenses: [],
    laneRequirements: [
      {
        lane: 'officialHeadless',
        disposition: 'required',
        requiredUnavailableResult: 'inconclusive',
      },
    ],
  }
  const reservation = reserveEditEvaluationMatrixV1({
    laneRequirements: plan.laneRequirements,
    scenarios: [
      {
        scenarioId: scenario.scenarioId,
        applicability: scenario.applicability,
        semanticPolicySha256: scenarioSha256,
      },
    ],
    artifactSides: ['baseline', 'candidate'],
  })
  assert.equal(reservation.status, 'reserved')
  if (reservation.status !== 'reserved')
    assert.fail('identity-drive matrix was refused')
  const sourceLineage = buildSourceLineageV1(
    project,
    preflight.semanticSourceSha256
  ).active
  const assignment = buildEditRuntimeLineageAssignmentV1(project, sourceLineage)
  const revision = {
    revisionNumber: 0,
    revisionId: HASH_A,
    sourceArtifactSha256: artifactSha256,
    candidateSha256: artifactSha256,
    assetManifestSha256: preflight.semanticSourceIdentity.assetManifestSha256,
    changeContractSha256: HASH_B,
    capabilityProfileSha256: HASH_C,
  }
  const request: EditProductionEvaluationRequestV1 = {
    evaluationId: 'identity-drive-evaluation',
    plan: {
      plan,
      evaluationPlanSha256: HASH_A,
      resourceLimitOverrides: {},
      masks: { state: [], clone: [], visual: [] },
    },
    revision,
    semanticSourceSha256: preflight.semanticSourceSha256,
    changeContractSha256: HASH_B,
    historySha256: HASH_C,
    matrixSha256: reservation.matrixSha256,
    candidateBytes: bytes,
    baselineBytes: bytes,
    baselineRuntime: {
      assignment,
      bindings: { targets: [], declarations: [], broadcasts: [] },
    },
    candidateRuntime: {
      assignment,
      bindings: { targets: [], declarations: [], broadcasts: [] },
    },
    policies,
    projectionAuthority: {
      nameTransitions: [],
      targetMembershipAuthorizations: [],
    },
  }
  const authority: EditProductionDeterministicAuthorityV1 = {
    schemaVersion: 1,
    runtimePolicy: {
      status: 'decoded',
      value: {
        cells: [
          {
            lane: 'officialHeadless',
            scenarioId: scenario.scenarioId,
            observationPlan: defaultObservationPlan(),
            observationCaps: DEFAULT_RUNTIME_OBSERVATION_CAPS,
          },
        ],
        allowedNewDiagnosticFingerprints: [],
      },
    },
    lensPolicies: [],
    projectedDifferentials: [],
    limitations: [],
  }
  const runtimeObservation = {
    tick: 1,
    scenarioStepIndex: 1,
    label: 'done',
    capture: {
      status: 'observed' as const,
      value: {
        state: {
          schemaVersion: 1 as const,
          tick: 1,
          label: 'done',
          targetOrder: [],
          targetsById: {},
          stageTargetId: 'stage',
          answer: scalar(''),
          timer: scalar(0),
          stage: {
            backdrop: scalar('backdrop'),
            tempo: scalar(60),
            videoState: scalar('off'),
          },
        },
        cloneCounts: tagged({ total: 0, byOriginalTargetId: {} }),
        supplemental: null,
        cloneIdentityIssues: [],
      },
      totals: {} as never,
    },
  }
  return {
    request,
    authority,
    preflight,
    reservation,
    runtimeObservation,
  }
}

test('Group G incomplete identity actions, failed traces, and incomplete drives cannot satisfy a predicate from default state', async () =>
{
  const fixture = await incompleteDriveFixture()
  const completeActions = [action(0, 'clickStage'), action(1, 'snapshot')]
  const cases = [
    {
      name: 'incomplete click action',
      traceOk: true,
      actions: [action(0, 'clickTarget'), action(1, 'snapshot')],
      driveStatus: 'complete' as const,
      expectedStatus: 'inconclusive',
    },
    {
      name: 'incomplete broadcast action',
      traceOk: true,
      actions: [action(0, 'broadcast'), action(1, 'snapshot')],
      driveStatus: 'complete' as const,
      expectedStatus: 'inconclusive',
    },
    {
      name: 'trace ok false',
      traceOk: false,
      actions: completeActions,
      driveStatus: 'complete' as const,
      expectedStatus: 'inconclusive',
    },
    {
      name: 'incomplete drive',
      traceOk: true,
      actions: completeActions,
      driveStatus: 'inconclusive' as const,
      expectedStatus: 'inconclusive',
    },
    {
      name: 'complete control',
      traceOk: true,
      actions: completeActions,
      driveStatus: 'complete' as const,
      expectedStatus: 'observed',
    },
  ]
  for (const row of cases)
  {
    const traceProjections = fixture.reservation.cells.map((cell) => ({
      matrix: cell,
      traceOk: row.traceOk,
      runtimeDescriptor: {
        schemaVersion: 1,
        id: 'identity-drive-runtime',
        kind: 'scratch-vm-node',
        configurationSha256: HASH_A,
        renderer: 'none',
        compiler: 'disabled',
        network: 'denied',
        components: [],
        browser: null,
        bundle: null,
        workers: [],
        environment: { node: 'test', platform: 'test', arch: 'test' },
      },
      observationTrace: {
        schemaVersion: 1,
        sourceSb3Sha256:
          cell.side === 'baseline'
            ? fixture.request.revision.sourceArtifactSha256
            : fixture.request.revision.candidateSha256,
        scenarioSha256: HASH_B,
        plan: defaultObservationPlan(),
        planSha256: HASH_C,
        cloneCounts: [],
        media: null,
      },
      snapshots: [],
      finalSnapshot: null,
      drive: {
        status: row.driveStatus,
        reservation: {
          status: 'reserved' as const,
          targets: [],
          broadcasts: [],
          failures: [],
        },
        actions: row.actions,
        inconclusive:
          row.driveStatus === 'inconclusive'
            ? {
                stepIndex: 0,
                do: 'clickTarget' as const,
                reason: 'lineage-not-bound' as const,
                detail: 'injected incomplete drive',
              }
            : null,
      },
      actions: row.actions,
      lineage: null,
      runtimeIdentityFacet: null,
      runtimeObservations: [fixture.runtimeObservation],
      requestProjection: null,
      issues: [],
    }))
    const matrixProjection = {
      cells: fixture.reservation.cells.map((cell, index) => ({
        cell,
        status: 'executed' as const,
        requestSha256: index === 0 ? HASH_A : HASH_B,
        resultSha256: index === 0 ? HASH_C : HASH_D,
        completeSemanticDrive: row.expectedStatus === 'observed',
        evidenceContentSha256s: [],
      })),
    }
    const result = await rederiveEditProductionDeterministicV1({
      request: fixture.request,
      authority: fixture.authority,
      baselinePreflight: retainedPreflightProjection(
        'baseline',
        fixture.preflight
      ),
      candidatePreflight: retainedPreflightProjection(
        'candidate',
        fixture.preflight
      ),
      matrixProjection,
      traceProjections,
      mediaByCell: new Map(),
      externalRequests: [],
    })
    const observation = result.candidateObservations[0]
    assert.ok(observation, row.name)
    assert.equal(observation.status, row.expectedStatus, row.name)
    if (row.expectedStatus === 'inconclusive')
      assert.equal(
        observation.status === 'inconclusive' ? observation.reason : null,
        'the candidate identity-bound action drive did not complete exactly',
        row.name
      )
  }
})

const ADDED: FixtureTarget = {
  runtimeId: 'runtime-added',
  lineage: 'added-lineage',
  name: 'Added',
  isStage: false,
  x: 25,
  media: [{ lineage: 'added-costume', name: 'added-costume', index: 0 }],
}

function finalLens(maskId: string): PreservationLensV1
{
  return {
    scenarioId: SCENARIO_ID,
    lane: 'officialHeadless',
    lensKind: 'finalState',
    lensPolicySha256: HASH_D,
    required: true,
    stateMaskIds: [maskId],
  }
}

function cloneLens(maskId: string): PreservationLensV1
{
  return {
    scenarioId: SCENARIO_ID,
    lane: 'officialHeadless',
    lensKind: 'cloneCounts',
    lensPolicySha256: HASH_D,
    required: true,
    cloneMaskIds: [maskId],
  }
}

function visualLens(maskId: string): PreservationLensV1
{
  return {
    scenarioId: SCENARIO_ID,
    lane: 'renderedDifferential',
    lensKind: 'visualKeyframes',
    lensPolicySha256: HASH_D,
    required: true,
    visualMaskIds: [maskId],
  }
}

function assertProjectedMask(
  result: EditRuntimeProjectionResultV1,
  expected: {
    maskId: string
    maskKind:
      | StateProjectionMaskV1['maskKind']
      | CloneProjectionMaskV1['maskKind']
      | VisualProjectionMaskV1['maskKind']
    exactMatchCount: number
  },
  specs: readonly BehavioralLensSpecV1[],
  expectedVerdict: 'passed' | 'failed' = 'passed'
): void
{
  assert.equal(result.status, 'projected')
  if (result.status !== 'projected') return
  assert.deepEqual(result.evidence.appliedMasks, [expected])
  const report = evaluatedProjection(result, specs)
  assert.equal(report.verdict, expectedVerdict, JSON.stringify(report.results))
}

function assertMaskMismatch(
  result: EditRuntimeProjectionResultV1,
  maskId: string
): void
{
  assert.deepEqual(
    result.status === 'inconclusive'
      ? { status: result.status, reason: result.reason, maskId: result.maskId }
      : { status: result.status },
    {
      status: 'inconclusive',
      reason: 'projection-mask-mismatch',
      maskId,
    }
  )
  assert.equal('baseline' in result, false)
  assert.equal('candidate' in result, false)
}

test('Group G state masks prove exact one-sided target/declaration sets and one selected path without hiding unrelated state', () =>
{
  const addedVariable: FixtureDeclaration = {
    runtimeId: 'added-variable-id',
    lineage: 'added-variable-lineage',
    name: 'new score',
    collection: 'variables',
    value: 2,
  }
  const candidateSprite = {
    ...SPRITE,
    declarations: [...(SPRITE.declarations ?? []), addedVariable],
  }
  const rows: readonly {
    readonly mask: StateProjectionMaskV1
    readonly baseline: ReturnType<typeof fixture>
    readonly candidate: ReturnType<typeof fixture>
    readonly exactMatchCount: number
    readonly memberships?: EditProjectionMaskPolicyV1['targetMembershipAuthorizations']
    readonly mismatch: StateProjectionMaskV1
  }[] = [
    {
      mask: {
        maskId: 'one-sided-target',
        maskKind: 'oneSidedTarget',
        scenarioId: SCENARIO_ID,
        side: 'candidate',
        labels: 'final',
        target: { ...targetRef('added'), contractRefKind: 'future' },
        expectedTargetMatchesPerObservation: 1,
        expectedTargetPaneOrderMatchesPerObservation: 1,
        expectedExecutableOrderMatchesPerObservation: 1,
      },
      baseline: fixture('baseline'),
      candidate: fixture('candidate', { targets: [STAGE, SPRITE, ADDED] }),
      exactMatchCount: 3,
      memberships: [
        {
          targetLineage: ADDED.lineage,
          presentSide: 'candidate',
          operationKind: 'target.addSprite',
        },
      ],
      mismatch: {
        maskId: 'one-sided-target',
        maskKind: 'oneSidedTarget',
        scenarioId: SCENARIO_ID,
        side: 'candidate',
        labels: 'final',
        target: { ...targetRef('added'), contractRefKind: 'future' },
        expectedTargetMatchesPerObservation: 2 as 1,
        expectedTargetPaneOrderMatchesPerObservation: 1,
        expectedExecutableOrderMatchesPerObservation: 1,
      },
    },
    {
      mask: {
        maskId: 'one-sided-declaration',
        maskKind: 'oneSidedDeclaration',
        scenarioId: SCENARIO_ID,
        side: 'candidate',
        labels: 'final',
        declaration: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'variable',
          bindingKey: 'added-variable',
        },
        expectedMatchesPerObservation: 1,
      },
      baseline: fixture('baseline'),
      candidate: fixture('candidate', {
        targets: [STAGE, candidateSprite],
      }),
      exactMatchCount: 1,
      mismatch: {
        maskId: 'one-sided-declaration',
        maskKind: 'oneSidedDeclaration',
        scenarioId: SCENARIO_ID,
        side: 'candidate',
        labels: 'final',
        declaration: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'variable',
          bindingKey: 'added-variable',
        },
        expectedMatchesPerObservation: 2 as 1,
      },
    },
    {
      mask: {
        maskId: 'state-path',
        maskKind: 'statePath',
        scenarioId: SCENARIO_ID,
        labels: 'final',
        path: {
          pathKind: 'targetProperty',
          target: targetRef(),
          property: 'x',
        },
        expectedMatchesPerObservation: 1,
      },
      baseline: fixture('baseline'),
      candidate: fixture('candidate', {
        targets: [STAGE, { ...SPRITE, x: 20 }],
      }),
      exactMatchCount: 2,
      mismatch: {
        maskId: 'state-path',
        maskKind: 'statePath',
        scenarioId: SCENARIO_ID,
        labels: 'final',
        path: {
          pathKind: 'targetProperty',
          target: targetRef(),
          property: 'x',
        },
        expectedMatchesPerObservation: 2 as 1,
      },
    },
  ]

  for (const row of rows)
  {
    const specs = [finalStateSpec()]
    const passing = projection({
      baseline: row.baseline,
      candidate: row.candidate,
      lens: finalLens(row.mask.maskId),
      masks: { state: [row.mask] },
      memberships: row.memberships,
      specs,
    })
    assertProjectedMask(
      passing,
      {
        maskId: row.mask.maskId,
        maskKind: row.mask.maskKind,
        exactMatchCount: row.exactMatchCount,
      },
      specs
    )

    const mismatch = projection({
      baseline: row.baseline,
      candidate: row.candidate,
      lens: finalLens(row.mask.maskId),
      masks: { state: [row.mismatch] },
      memberships: row.memberships,
      specs,
    })
    assertMaskMismatch(mismatch, row.mask.maskId)

    const unrelatedCandidate = fixture('candidate', {
      targets:
        row.mask.maskKind === 'oneSidedTarget'
          ? [STAGE, SPRITE, ADDED]
          : row.mask.maskKind === 'oneSidedDeclaration'
            ? [STAGE, candidateSprite]
            : [STAGE, { ...SPRITE, x: 20 }],
      answer: 'unmasked difference',
    })
    const unrelated = projection({
      baseline: row.baseline,
      candidate: unrelatedCandidate,
      lens: finalLens(row.mask.maskId),
      masks: { state: [row.mask] },
      memberships: row.memberships,
      specs,
    })
    assertProjectedMask(
      unrelated,
      {
        maskId: row.mask.maskId,
        maskKind: row.mask.maskKind,
        exactMatchCount: row.exactMatchCount,
      },
      specs,
      'failed'
    )
  }
})

test('Group G clone masks prove exact one-sided and transition series at one complete tick set', () =>
{
  const tickHash = editCloneTickSetSha256V1([1])
  const oneSided: CloneProjectionMaskV1 = {
    maskId: 'one-sided-clones',
    maskKind: 'oneSidedTargetCloneSeries',
    scenarioId: SCENARIO_ID,
    side: 'candidate',
    target: { ...targetRef('added'), contractRefKind: 'future' },
    expectedTickSetSha256: tickHash,
    expectedCloneCountSeriesSha256: editCloneCountSeriesSha256V1([
      { tick: 1, count: 2 },
    ]),
  }
  const transition: CloneProjectionMaskV1 = {
    maskId: 'clone-transition',
    maskKind: 'targetCloneCountTransition',
    scenarioId: SCENARIO_ID,
    target: targetRef(),
    expectedTickSetSha256: tickHash,
    expectedBaselineCloneCountSeriesSha256: editCloneCountSeriesSha256V1([
      { tick: 1, count: 1 },
    ]),
    expectedCandidateCloneCountSeriesSha256: editCloneCountSeriesSha256V1([
      { tick: 1, count: 2 },
    ]),
  }
  const rows = [
    {
      mask: oneSided,
      baseline: fixture('baseline', { cloneCounts: {} }),
      candidate: fixture('candidate', {
        targets: [STAGE, SPRITE, ADDED],
        cloneCounts: { [ADDED.runtimeId]: 2 },
      }),
      exactMatchCount: 1,
      memberships: [
        {
          targetLineage: ADDED.lineage,
          presentSide: 'candidate' as const,
          operationKind: 'target.addSprite' as const,
        },
      ],
    },
    {
      mask: transition,
      baseline: fixture('baseline', {
        cloneCounts: { [SPRITE.runtimeId]: 1 },
      }),
      candidate: fixture('candidate', {
        cloneCounts: { [SPRITE.runtimeId]: 2 },
      }),
      exactMatchCount: 2,
      memberships: [],
    },
  ] as const

  for (const row of rows)
  {
    const specs = [cloneSpec()]
    const passing = projection({
      baseline: row.baseline,
      candidate: row.candidate,
      lens: cloneLens(row.mask.maskId),
      masks: { clone: [row.mask] },
      memberships: row.memberships,
      specs,
    })
    assertProjectedMask(
      passing,
      {
        maskId: row.mask.maskId,
        maskKind: row.mask.maskKind,
        exactMatchCount: row.exactMatchCount,
      },
      specs
    )

    const wrongHash = {
      ...row.mask,
      expectedTickSetSha256: HASH_D,
    } as CloneProjectionMaskV1
    assertMaskMismatch(
      projection({
        baseline: row.baseline,
        candidate: row.candidate,
        lens: cloneLens(row.mask.maskId),
        masks: { clone: [wrongHash] },
        memberships: row.memberships,
        specs,
      }),
      row.mask.maskId
    )

    const unrelatedCandidate = fixture('candidate', {
      targets:
        row.mask.maskKind === 'oneSidedTargetCloneSeries'
          ? [STAGE, SPRITE, ADDED]
          : [STAGE, SPRITE],
      cloneCounts:
        row.mask.maskKind === 'oneSidedTargetCloneSeries'
          ? { [ADDED.runtimeId]: 2, [SPRITE.runtimeId]: 1 }
          : { [SPRITE.runtimeId]: 2, [STAGE.runtimeId]: 1 },
    })
    const unrelatedBaseline = fixture('baseline', {
      cloneCounts:
        row.mask.maskKind === 'oneSidedTargetCloneSeries'
          ? { [SPRITE.runtimeId]: 0 }
          : { [SPRITE.runtimeId]: 1, [STAGE.runtimeId]: 0 },
    })
    assertProjectedMask(
      projection({
        baseline: unrelatedBaseline,
        candidate: unrelatedCandidate,
        lens: cloneLens(row.mask.maskId),
        masks: { clone: [row.mask] },
        memberships: row.memberships,
        specs,
      }),
      {
        maskId: row.mask.maskId,
        maskKind: row.mask.maskKind,
        exactMatchCount: row.exactMatchCount,
      },
      specs,
      'failed'
    )
  }
})

function mean(values: Uint8Array, channel: number): number
{
  let sum = 0
  for (let index = channel; index < values.length; index += 4)
    sum += values[index]!
  return sum / (values.length / 4)
}

function frame(
  targets: MediaFrameRefV1['geometry']['targets'],
  rgba: Uint8Array,
  sha256: string
): MediaFrameRefV1
{
  return {
    id: 'frame',
    index: 0,
    tick: 1,
    scenarioStepIndex: 1,
    snapshotLabel: null,
    relativePath: 'frames/frame.png',
    mimeType: 'image/png',
    width: 2,
    height: 2,
    meanRgb: [mean(rgba, 0), mean(rgba, 1), mean(rgba, 2)],
    sampledMeanRgb: {
      columns: 1,
      rows: 1,
      values: [
        Math.round(mean(rgba, 0)),
        Math.round(mean(rgba, 1)),
        Math.round(mean(rgba, 2)),
      ],
    },
    geometry: { canvas: { width: 2, height: 2 }, targets },
    bytes: rgba.byteLength,
    sha256,
  }
}

function geometryTarget(
  target: FixtureTarget,
  instance: 'original' | 'clone' = 'original',
  instanceIndex = 0,
  rect = { x: 0, y: 0, width: 1, height: 1 }
): MediaFrameRefV1['geometry']['targets'][number]
{
  return {
    originalTargetId: target.runtimeId,
    name: target.name,
    isStage: target.isStage,
    instance,
    instanceIndex,
    visible: true,
    costumeIndex: target.media![0]!.index,
    costumeName: target.media![0]!.name,
    rect,
  }
}

const WHITE = new Uint8Array([
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255,
])

test('Group G visual masks prove exact geometry sets/properties and a bounded nonempty pixel complement', () =>
{
  const baselineGeometry = [geometryTarget(STAGE), geometryTarget(SPRITE)]
  const candidateAddedGeometry = [
    ...baselineGeometry,
    geometryTarget(ADDED),
    geometryTarget(ADDED, 'clone', 1),
  ]
  const baselineFrame = frame(baselineGeometry, WHITE, HASH_A)
  const candidateAddedFrame = frame(candidateAddedGeometry, WHITE, HASH_B)
  const geometrySet = editGeometryInstanceSetSha256V1([
    {
      targetLineage: ADDED.lineage,
      instance: 'original',
      instanceIndex: 0,
    },
    { targetLineage: ADDED.lineage, instance: 'clone', instanceIndex: 1 },
  ])
  const oneSided: VisualProjectionMaskV1 = {
    maskId: 'one-sided-geometry',
    maskKind: 'oneSidedTargetGeometrySet',
    scenarioId: SCENARIO_ID,
    side: 'candidate',
    frames: [
      {
        frameId: 'frame',
        expectedOriginalMatches: 1,
        expectedCloneCount: 1,
        expectedInstanceSetSha256: geometrySet,
      },
    ],
    target: { ...targetRef('added'), contractRefKind: 'future' },
  }
  const propertySet = editGeometryInstanceSetSha256V1([
    {
      targetLineage: SPRITE.lineage,
      instance: 'original',
      instanceIndex: 0,
    },
  ])
  const property: VisualProjectionMaskV1 = {
    maskId: 'geometry-property',
    maskKind: 'targetGeometryProperty',
    scenarioId: SCENARIO_ID,
    frames: [
      {
        frameId: 'frame',
        expectedInstanceSetSha256: propertySet,
        expectedMatchCount: 1,
      },
    ],
    target: targetRef(),
    property: 'rect',
  }
  const candidatePropertyGeometry = [
    geometryTarget(STAGE),
    geometryTarget(SPRITE, 'original', 0, {
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    }),
  ]
  const candidatePixels = new Uint8Array(WHITE)
  candidatePixels[0] = 0
  candidatePixels[1] = 0
  candidatePixels[2] = 0
  const pixel: VisualProjectionMaskV1 = {
    maskId: 'pixel-region',
    maskKind: 'pixelRegion',
    scenarioId: SCENARIO_ID,
    frameIds: ['frame'],
    normalizedRegion: { x: 0, y: 0, width: 0.5, height: 0.5 },
    maxMaskedAreaFraction: 0.25,
  }
  const rows = [
    {
      mask: oneSided,
      baseline: fixture('baseline', {
        frame: baselineFrame,
        rgba: WHITE,
      }),
      candidate: fixture('candidate', {
        targets: [STAGE, SPRITE, ADDED],
        frame: candidateAddedFrame,
        rgba: WHITE,
      }),
      exactMatchCount: 2,
      memberships: [
        {
          targetLineage: ADDED.lineage,
          presentSide: 'candidate' as const,
          operationKind: 'target.addSprite' as const,
        },
      ],
    },
    {
      mask: property,
      baseline: fixture('baseline', {
        frame: baselineFrame,
        rgba: WHITE,
      }),
      candidate: fixture('candidate', {
        frame: frame(candidatePropertyGeometry, WHITE, HASH_B),
        rgba: WHITE,
      }),
      exactMatchCount: 2,
      memberships: [],
    },
    {
      mask: pixel,
      baseline: fixture('baseline', {
        frame: baselineFrame,
        rgba: WHITE,
      }),
      candidate: fixture('candidate', {
        frame: frame(baselineGeometry, candidatePixels, HASH_B),
        rgba: candidatePixels,
      }),
      exactMatchCount: 2,
      memberships: [],
    },
  ] as const

  for (const row of rows)
  {
    const specs = [visualSpec()]
    const passing = projection({
      baseline: row.baseline,
      candidate: row.candidate,
      lens: visualLens(row.mask.maskId),
      masks: { visual: [row.mask] },
      memberships: row.memberships,
      specs,
    })
    assertProjectedMask(
      passing,
      {
        maskId: row.mask.maskId,
        maskKind: row.mask.maskKind,
        exactMatchCount: row.exactMatchCount,
      },
      specs
    )
    if (passing.status === 'projected')
    {
      if (row.mask.maskKind === 'pixelRegion')
      {
        assert.equal(passing.evidence.pixelComplements.length, 2)
        assert.ok(
          passing.evidence.pixelComplements.every(
            (entry) =>
              entry.maskedPixelCount === 1 && entry.unmaskedPixelCount === 3
          )
        )
      }
    }

    const mismatchMask =
      row.mask.maskKind === 'oneSidedTargetGeometrySet'
        ? {
            ...row.mask,
            frames: [
              {
                ...row.mask.frames[0]!,
                expectedCloneCount: 2,
              },
            ],
          }
        : row.mask.maskKind === 'targetGeometryProperty'
          ? {
              ...row.mask,
              frames: [
                {
                  ...row.mask.frames[0]!,
                  expectedMatchCount: 2,
                },
              ],
            }
          : {
              ...row.mask,
              normalizedRegion: { x: 0, y: 0, width: 1, height: 1 },
            }
    assertMaskMismatch(
      projection({
        baseline: row.baseline,
        candidate: row.candidate,
        lens: visualLens(row.mask.maskId),
        masks: { visual: [mismatchMask as VisualProjectionMaskV1] },
        memberships: row.memberships,
        specs,
      }),
      row.mask.maskId
    )

    const unrelatedPixels = new Uint8Array(
      row.mask.maskKind === 'pixelRegion' ? candidatePixels : WHITE
    )
    unrelatedPixels[12] = 0
    unrelatedPixels[13] = 0
    unrelatedPixels[14] = 0
    const unrelatedTargets =
      row.mask.maskKind === 'oneSidedTargetGeometrySet'
        ? [STAGE, SPRITE, ADDED]
        : [STAGE, SPRITE]
    const unrelatedGeometry =
      row.mask.maskKind === 'oneSidedTargetGeometrySet'
        ? candidateAddedGeometry
        : row.mask.maskKind === 'targetGeometryProperty'
          ? candidatePropertyGeometry
          : baselineGeometry
    const unrelated = projection({
      baseline: row.baseline,
      candidate: fixture('candidate', {
        targets: unrelatedTargets,
        frame: frame(unrelatedGeometry, unrelatedPixels, HASH_B),
        rgba: unrelatedPixels,
      }),
      lens: visualLens(row.mask.maskId),
      masks: { visual: [row.mask] },
      memberships: row.memberships,
      specs,
    })
    assertProjectedMask(
      unrelated,
      {
        maskId: row.mask.maskId,
        maskKind: row.mask.maskKind,
        exactMatchCount: row.exactMatchCount,
      },
      specs,
      'failed'
    )
  }
})

function renamedTarget(
  target: FixtureTarget,
  changes: Partial<Pick<FixtureTarget, 'name' | 'declarations' | 'media'>>
): FixtureTarget
{
  return { ...target, ...changes }
}

test('Group G target, declaration, and costume renames canonicalize only through exact lineage transitions', () =>
{
  const renamedDeclaration = {
    ...SPRITE.declarations![0]!,
    name: 'points',
  }
  const renamedMedia = { ...SPRITE.media![0]!, name: 'walking' }
  const rows: readonly {
    baseline: FixtureTarget
    candidate: FixtureTarget
    transition: EditProjectionNameTransitionV1
  }[] = [
    {
      baseline: SPRITE,
      candidate: renamedTarget(SPRITE, { name: 'Hero' }),
      transition: {
        transitionKind: 'targetName',
        operationKind: 'target.renameSprite',
        targetLineage: SPRITE.lineage,
        baselineName: SPRITE.name,
        candidateName: 'Hero',
      },
    },
    {
      baseline: SPRITE,
      candidate: renamedTarget(SPRITE, {
        declarations: [renamedDeclaration, SPRITE.declarations![1]!],
      }),
      transition: {
        transitionKind: 'declarationName',
        operationKind: 'declaration.rename',
        declarationLineage: renamedDeclaration.lineage,
        baselineName: SPRITE.declarations![0]!.name,
        candidateName: renamedDeclaration.name,
      },
    },
    {
      baseline: SPRITE,
      candidate: renamedTarget(SPRITE, { media: [renamedMedia] }),
      transition: {
        transitionKind: 'mediaName',
        operationKind: 'media.renameCostume',
        mediaLineage: renamedMedia.lineage,
        baselineName: SPRITE.media![0]!.name,
        candidateName: renamedMedia.name,
      },
    },
  ]
  const lens: PreservationLensV1 = {
    scenarioId: SCENARIO_ID,
    lane: 'officialHeadless',
    lensKind: 'finalState',
    lensPolicySha256: HASH_D,
    required: true,
  }
  const specs = [finalStateSpec()]
  for (const row of rows)
  {
    const baseline = fixture('baseline', { targets: [STAGE, row.baseline] })
    const candidate = fixture('candidate', { targets: [STAGE, row.candidate] })
    const passing = projection({
      baseline,
      candidate,
      lens,
      transitions: [row.transition],
      specs,
    })
    assert.equal(passing.status, 'projected')
    if (passing.status === 'projected')
      assert.equal(evaluatedProjection(passing, specs).verdict, 'passed')

    for (const invalidTransitions of [
      [],
      [
        {
          ...row.transition,
          baselineName: 'wrong old name',
        } as EditProjectionNameTransitionV1,
      ],
      [
        {
          ...row.transition,
          candidateName: 'wrong new name',
        } as EditProjectionNameTransitionV1,
      ],
      [
        {
          ...row.transition,
          ...(row.transition.transitionKind === 'targetName'
            ? { targetLineage: 'wrong-lineage' }
            : row.transition.transitionKind === 'declarationName'
              ? { declarationLineage: 'wrong-lineage' }
              : { mediaLineage: 'wrong-lineage' }),
        } as EditProjectionNameTransitionV1,
      ],
    ])
    {
      const refused = projection({
        baseline,
        candidate,
        lens,
        transitions: invalidTransitions,
        specs,
      })
      assert.equal(refused.status, 'inconclusive')
      if (refused.status === 'inconclusive')
        assert.equal(refused.reason, 'identity-transition-mismatch')
    }
  }
})

test('Group G duplicate declaration and costume display names stay valid only through exact IDs, indexes, and lineages', () =>
{
  const duplicateDeclarations: FixtureDeclaration[] = [
    {
      runtimeId: 'variable-a',
      lineage: 'variable-a-lineage',
      name: 'same',
      collection: 'variables',
      value: 1,
    },
    {
      runtimeId: 'variable-b',
      lineage: 'variable-b-lineage',
      name: 'same',
      collection: 'variables',
      value: 2,
    },
  ]
  const duplicateMedia: FixtureMedia[] = [
    { lineage: 'media-a-lineage', name: 'same', index: 0 },
    { lineage: 'media-b-lineage', name: 'same', index: 1 },
  ]
  const baselineSprite = renamedTarget(SPRITE, {
    declarations: duplicateDeclarations,
    media: duplicateMedia,
  })
  const candidateSprite = renamedTarget(baselineSprite, {
    declarations: [
      { ...duplicateDeclarations[0]!, name: 'renamed declaration' },
      duplicateDeclarations[1]!,
    ],
    media: [
      { ...duplicateMedia[0]!, name: 'renamed costume' },
      duplicateMedia[1]!,
    ],
  })
  const result = projection({
    baseline: fixture('baseline', { targets: [STAGE, baselineSprite] }),
    candidate: fixture('candidate', { targets: [STAGE, candidateSprite] }),
    lens: {
      scenarioId: SCENARIO_ID,
      lane: 'officialHeadless',
      lensKind: 'finalState',
      lensPolicySha256: HASH_D,
      required: true,
    },
    transitions: [
      {
        transitionKind: 'declarationName',
        operationKind: 'declaration.rename',
        declarationLineage: duplicateDeclarations[0]!.lineage,
        baselineName: 'same',
        candidateName: 'renamed declaration',
      },
      {
        transitionKind: 'mediaName',
        operationKind: 'media.renameCostume',
        mediaLineage: duplicateMedia[0]!.lineage,
        baselineName: 'same',
        candidateName: 'renamed costume',
      },
    ],
    specs: [finalStateSpec()],
  })
  assert.equal(result.status, 'projected')
  if (result.status === 'projected')
    assert.equal(
      evaluatedProjection(result, [finalStateSpec()]).verdict,
      'passed'
    )
})

test('Group G a duplicated runtime target witness is inconclusive instead of rebound by display name or ordinal', () =>
{
  const baseline = fixture('baseline')
  const candidate = fixture('candidate')
  const original = candidate.facet.targets.find(
    (target) => target.targetLineage === SPRITE.lineage
  )!
  const ambiguousCandidate = {
    ...candidate,
    facet: {
      ...candidate.facet,
      targets: [
        ...candidate.facet.targets,
        {
          ...original,
          runtimeTargetId: 'other-runtime-object',
          targetLineage: 'other-lineage',
          runtimeTargetName: original.runtimeTargetName,
        },
      ],
    },
  }
  const result = projection({
    baseline,
    candidate: ambiguousCandidate,
    lens: {
      scenarioId: SCENARIO_ID,
      lane: 'officialHeadless',
      lensKind: 'finalState',
      lensPolicySha256: HASH_D,
      required: true,
    },
    specs: [finalStateSpec()],
  })
  assert.equal(result.status, 'inconclusive')
  if (result.status === 'inconclusive')
  {
    assert.equal(result.reason, 'bounded-observation-invalid')
    assert.equal(result.maskId, null)
  }
})
