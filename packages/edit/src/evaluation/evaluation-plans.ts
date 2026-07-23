// packages/edit/src/evaluation/evaluation-plans.ts
// activation of the immutable contract's named evaluation plans, lanes, lenses, & masks

import type {
  CloneProjectionMaskV1,
  EditEvaluationPlanV1,
  EditScenarioPolicyV1,
  EditSemanticChangeContractV1,
  LaneRequirementV1,
  PreservationLensV1,
  RetainedPolicyBindingV1,
  RuntimePredicateV1,
  StateProjectionMaskV1,
  VisualProjectionMaskV1,
} from '@scratch-agent/ir/edit'
import { PHASE_8_EDIT_LIMIT_AUTHORITY_V1 } from '@scratch-agent/ir/edit'

import { editCanonicalSha256V1 } from '../support/canonical.js'
import { EDIT_EVALUATION_RUNNER_LANES_V1 } from '../contracts/capabilities.js'

// canonical lane order; the contract guarantees exactly one requirement row per
// lane, so activation may index this order directly & never sorts by name
export const EVALUATION_LANE_ORDER_V1 = Object.freeze([
  ...EDIT_EVALUATION_RUNNER_LANES_V1,
] as const)

type EvaluationLaneV1 = (typeof EVALUATION_LANE_ORDER_V1)[number]

type EvaluationLaneDispositionV1 = LaneRequirementV1['disposition']

const EXECUTION_LANES_V1 = new Set<EvaluationLaneV1>([
  'officialHeadless',
  'officialBrowser',
  'turboWarpBrowser',
])

const STRUCTURAL_METADATA_OPERATION_KINDS_V1 = new Set<string>([
  'script.moveWorkspace',
  'comment.add',
  'comment.updateText',
  'comment.move',
  'comment.attach',
  'comment.detach',
  'comment.remove',
])

interface ActivatedEvaluationLaneV1
{
  readonly lane: EvaluationLaneV1
  readonly disposition: EvaluationLaneDispositionV1
  // only a required lane pins what an unavailable outcome must be reported as
  readonly requiredUnavailableResult: 'unavailable' | 'inconclusive' | null
}

export interface ActivatedObservationMasksV1
{
  readonly state: readonly StateProjectionMaskV1[]
  readonly clone: readonly CloneProjectionMaskV1[]
  readonly visual: readonly VisualProjectionMaskV1[]
}

export interface ActivatedEvaluationPlanV1
{
  readonly planId: string
  readonly planClass: EditEvaluationPlanV1['planClass']
  readonly requiredForExport: boolean
  readonly plan: EditEvaluationPlanV1
  readonly evaluationPlanSha256: string
  readonly lanes: readonly ActivatedEvaluationLaneV1[]
  readonly requiredLanes: readonly EvaluationLaneV1[]
  readonly forbiddenLanes: readonly EvaluationLaneV1[]
  readonly requiredRuntimeChanges: readonly RuntimePredicateV1[]
  readonly preservationLenses: readonly PreservationLensV1[]
  readonly scenarioPolicySha256s: readonly string[]
  readonly runtimePolicySha256: string
  readonly nativeEvidencePolicySha256: string | null
  readonly requiresExternalEvidence: boolean
  readonly masks: ActivatedObservationMasksV1
  readonly resourceLimitOverrides: Readonly<Record<string, number>>
  readonly scenarioSetSha256: string
  readonly lensPolicySetSha256: string
  readonly observationPlanSetSha256: string
  readonly rubricSetSha256: string
}

export interface ActivatedEvaluationPlanSetV1
{
  readonly plans: readonly ActivatedEvaluationPlanV1[]
  readonly exportRequiredPlanId: string
  readonly exportRequiredPlan: ActivatedEvaluationPlanV1
  readonly planSetSha256: string
  plan(planId: string): ActivatedEvaluationPlanV1
}

export class EditEvaluationPlanErrorV1 extends Error
{
  readonly reason: string

  constructor(reason: string, message: string)
  {
    super(message)
    this.name = 'EditEvaluationPlanErrorV1'
    this.reason = reason
  }
}

function fail(reason: string, message: string): never
{
  throw new EditEvaluationPlanErrorV1(reason, message)
}

// the mask families are scenario-scoped; a plan only observes through the masks
// whose scenario is one the plan actually runs
function scenarioIdsForPlan(plan: EditEvaluationPlanV1): ReadonlySet<string>
{
  const ids = new Set<string>()
  for (const lens of plan.preservationLenses) ids.add(lens.scenarioId)
  for (const predicate of plan.requiredRuntimeChanges)
    ids.add(predicate.scenarioId)
  return ids
}

function activateLanes(
  plan: EditEvaluationPlanV1
): readonly ActivatedEvaluationLaneV1[]
{
  const byLane = new Map<string, LaneRequirementV1>()
  for (const row of plan.laneRequirements)
  {
    if (byLane.has(row.lane))
      fail('duplicate-lane', `plan ${plan.planId} repeats lane ${row.lane}`)
    byLane.set(row.lane, row)
  }
  return Object.freeze(
    EVALUATION_LANE_ORDER_V1.map((lane) =>
    {
      const row = byLane.get(lane)
      if (row === undefined)
        fail('missing-lane', `plan ${plan.planId} omits lane ${lane}`)
      return Object.freeze({
        lane,
        disposition: row.disposition,
        requiredUnavailableResult:
          row.disposition === 'required' ? row.requiredUnavailableResult : null,
      })
    })
  )
}

function predicateLaneCompatible(predicate: RuntimePredicateV1): boolean
{
  return predicate.kind === 'visualCriterion'
    ? predicate.lane === 'officialBrowser' ||
        predicate.lane === 'turboWarpBrowser' ||
        predicate.lane === 'renderedDifferential' ||
        predicate.lane === 'nativeVisual'
    : EXECUTION_LANES_V1.has(predicate.lane)
}

function lensLaneCompatible(lens: PreservationLensV1): boolean
{
  return lens.lensKind === 'visualKeyframes'
    ? lens.lane === 'renderedDifferential'
    : EXECUTION_LANES_V1.has(lens.lane)
}

// predicates & lenses are required objectives, so optional/forbidden lanes may
// retain matrix hardening evidence but never satisfy one
function assertLaneConsistency(
  plan: EditEvaluationPlanV1,
  lanes: readonly ActivatedEvaluationLaneV1[]
): void
{
  const dispositions = new Map(
    lanes.map((entry) => [entry.lane, entry.disposition] as const)
  )
  const referencedRequiredLanes = new Set<EvaluationLaneV1>()
  for (const lens of plan.preservationLenses)
  {
    if (!lensLaneCompatible(lens))
      fail(
        'lens-lane-incompatible',
        `plan ${plan.planId} ${lens.lensKind} lens is incompatible with lane ${lens.lane}`
      )
    const disposition = dispositions.get(lens.lane)
    if (disposition !== 'required')
    {
      fail(
        disposition === 'forbidden'
          ? 'lens-on-forbidden-lane'
          : 'lens-on-optional-lane',
        `plan ${plan.planId} requires a ${lens.lensKind} lens on ${disposition ?? 'unknown'} lane ${lens.lane}`
      )
    }
    referencedRequiredLanes.add(lens.lane)
  }
  for (const predicate of plan.requiredRuntimeChanges)
  {
    if (!predicateLaneCompatible(predicate))
      fail(
        'predicate-lane-incompatible',
        `plan ${plan.planId} ${predicate.kind} predicate is incompatible with lane ${predicate.lane}`
      )
    const disposition = dispositions.get(predicate.lane)
    if (disposition !== 'required')
    {
      fail(
        disposition === 'forbidden'
          ? 'predicate-on-forbidden-lane'
          : 'predicate-on-optional-lane',
        `plan ${plan.planId} requires a ${predicate.kind} predicate on ${disposition ?? 'unknown'} lane ${predicate.lane}`
      )
    }
    referencedRequiredLanes.add(predicate.lane)
  }
  if (plan.nativeEvidencePolicySha256 !== undefined)
  {
    const disposition = dispositions.get('nativeVisual')
    if (disposition !== 'required')
      fail(
        'native-evidence-lane-not-required',
        `plan ${plan.planId} native evidence policy requires nativeVisual, but that lane is ${disposition ?? 'unknown'}`
      )
    referencedRequiredLanes.add('nativeVisual')
  }
  for (const lane of lanes)
  {
    if (
      lane.lane === 'projectPreflight' ||
      lane.disposition !== 'required' ||
      referencedRequiredLanes.has(lane.lane)
    )
      continue
    fail(
      'required-lane-unreferenced',
      `plan ${plan.planId} required lane ${lane.lane} has no compatible predicate, preservation lens, or native policy`
    )
  }
}

function assertScenarioTick(
  plan: EditEvaluationPlanV1,
  scenario: EditScenarioPolicyV1,
  field: string,
  tick: number
): void
{
  if (!Number.isSafeInteger(tick) || tick < 0 || tick > scenario.maxTicks)
    fail(
      'scenario-tick-invalid',
      `plan ${plan.planId} ${field} tick ${tick} is outside scenario ${scenario.scenarioId} range 0..${scenario.maxTicks}`
    )
}

function scenarioSnapshotLabels(
  plan: EditEvaluationPlanV1,
  scenario: EditScenarioPolicyV1
): ReadonlySet<string>
{
  if (!Number.isSafeInteger(scenario.maxTicks) || scenario.maxTicks < 0)
    fail(
      'scenario-max-ticks-invalid',
      `plan ${plan.planId} scenario ${scenario.scenarioId} has invalid maxTicks`
    )
  const labels = new Set<string>()
  for (let index = 0; index < scenario.steps.length; index++)
  {
    const step = scenario.steps[index]!
    if (step.do === 'snapshot')
    {
      if (labels.has(step.label))
        fail(
          'scenario-snapshot-label-duplicate',
          `plan ${plan.planId} scenario ${scenario.scenarioId} repeats snapshot label ${step.label}`
        )
      labels.add(step.label)
    }
    else if (step.do === 'wait')
      assertScenarioTick(plan, scenario, `step ${index} wait`, step.ticks)
    else if (step.do === 'tapKey' && step.ticks !== undefined)
      assertScenarioTick(plan, scenario, `step ${index} tapKey`, step.ticks)
    else if (step.do === 'broadcastAndWait' && step.maxTicks !== undefined)
      assertScenarioTick(
        plan,
        scenario,
        `step ${index} broadcastAndWait`,
        step.maxTicks
      )
  }
  return labels
}

function assertStateMaskLabels(
  plan: EditEvaluationPlanV1,
  mask: StateProjectionMaskV1,
  labels: ReadonlySet<string>
): void
{
  if (mask.labels === 'final') return
  for (const label of mask.labels)
    if (!labels.has(label))
      fail(
        'mask-label-unbound',
        `plan ${plan.planId} mask ${mask.maskId} references absent snapshot label ${label}`
      )
}

function assertReferencedMasks(
  contract: EditSemanticChangeContractV1,
  plan: EditEvaluationPlanV1,
  scenarios: ReadonlyMap<
    string,
    {
      readonly policy: EditScenarioPolicyV1
      readonly labels: ReadonlySet<string>
    }
  >
): void
{
  const state = new Map(
    contract.stateProjectionMasks.map((mask) => [mask.maskId, mask])
  )
  const clone = new Map(
    contract.cloneProjectionMasks.map((mask) => [mask.maskId, mask])
  )
  const visual = new Map(
    contract.visualProjectionMasks.map((mask) => [mask.maskId, mask])
  )
  const allIds = [
    ...contract.stateProjectionMasks.map((mask) => mask.maskId),
    ...contract.cloneProjectionMasks.map((mask) => mask.maskId),
    ...contract.visualProjectionMasks.map((mask) => mask.maskId),
  ]
  if (new Set(allIds).size !== allIds.length)
    fail(
      'mask-id-ambiguous',
      `plan ${plan.planId} cannot activate duplicate contract mask IDs`
    )

  const check = (
    maskId: string,
    family: 'state' | 'clone' | 'visual',
    lens: PreservationLensV1
  ): void =>
  {
    const mask =
      family === 'state'
        ? state.get(maskId)
        : family === 'clone'
          ? clone.get(maskId)
          : visual.get(maskId)
    if (mask === undefined)
      fail(
        'mask-reference-unresolved',
        `plan ${plan.planId} ${family} mask ${maskId} does not resolve exactly`
      )
    if (mask.scenarioId !== lens.scenarioId)
      fail(
        'mask-scenario-mismatch',
        `plan ${plan.planId} mask ${maskId} and its lens name different scenarios`
      )
    const scenario = scenarios.get(mask.scenarioId)
    if (scenario === undefined)
      fail(
        'mask-scenario-unbound',
        `plan ${plan.planId} mask ${maskId} references an unbound scenario`
      )
    if (scenario.policy.applicability !== 'baselineAndCandidate')
      fail(
        'candidate-only-projection-mask',
        `plan ${plan.planId} mask ${maskId} requires both artifact sides`
      )
    if (family === 'state')
      assertStateMaskLabels(
        plan,
        mask as StateProjectionMaskV1,
        scenario.labels
      )
  }

  for (const lens of plan.preservationLenses)
  {
    if (lens.lensKind === 'visualKeyframes')
    {
      for (const maskId of lens.visualMaskIds ?? [])
        check(maskId, 'visual', lens)
      continue
    }
    if (
      lens.lensKind === 'runtimeOutcome' &&
      ((lens.stateMaskIds?.length ?? 0) > 0 ||
        (lens.cloneMaskIds?.length ?? 0) > 0)
    )
      fail(
        'lens-mask-incompatible',
        `plan ${plan.planId} runtimeOutcome lens cannot select projection masks`
      )
    for (const maskId of lens.stateMaskIds ?? []) check(maskId, 'state', lens)
    for (const maskId of lens.cloneMaskIds ?? []) check(maskId, 'clone', lens)
  }
}

function assertScenarioConsistency(
  contract: EditSemanticChangeContractV1,
  plan: EditEvaluationPlanV1,
  retainedPolicies: Readonly<
    Record<string, { readonly scenarioPolicy?: EditScenarioPolicyV1 }>
  >
): void
{
  const byScenarioId = new Map<
    string,
    {
      readonly policy: EditScenarioPolicyV1
      readonly labels: ReadonlySet<string>
    }
  >()
  for (const semanticSha256 of plan.scenarioPolicySha256s)
  {
    const scenario = retainedPolicies[semanticSha256]?.scenarioPolicy
    if (scenario === undefined)
      fail(
        'scenario-policy-unavailable',
        `plan ${plan.planId} cannot reopen one retained scenario policy`
      )
    if (byScenarioId.has(scenario.scenarioId))
      fail(
        'duplicate-scenario-id',
        `plan ${plan.planId} repeats scenario ${scenario.scenarioId}`
      )
    byScenarioId.set(scenario.scenarioId, {
      policy: scenario,
      labels: scenarioSnapshotLabels(plan, scenario),
    })
  }
  const referencedScenarioIds = new Set<string>()
  for (const predicate of plan.requiredRuntimeChanges)
  {
    const scenario = byScenarioId.get(predicate.scenarioId)
    if (scenario === undefined)
      fail(
        'predicate-scenario-unbound',
        `plan ${plan.planId} predicate ${predicate.objectiveId} references an unbound scenario`
      )
    if (
      predicate.kind === 'stateAtLabel' &&
      !scenario.labels.has(predicate.label)
    )
      fail(
        'predicate-label-unbound',
        `plan ${plan.planId} predicate ${predicate.objectiveId} references absent snapshot label ${predicate.label}`
      )
    if (predicate.kind === 'cloneCountAtTick')
      assertScenarioTick(
        plan,
        scenario.policy,
        `predicate ${predicate.objectiveId}`,
        predicate.tick
      )
    if (predicate.kind === 'visualCriterion')
    {
      const window = predicate.evidenceWindow
      if (window.windowKind === 'label' && !scenario.labels.has(window.label))
        fail(
          'evidence-window-label-unbound',
          `plan ${plan.planId} predicate ${predicate.objectiveId} references absent snapshot label ${window.label}`
        )
      if (window.windowKind === 'tickRange')
      {
        assertScenarioTick(
          plan,
          scenario.policy,
          `predicate ${predicate.objectiveId} firstTick`,
          window.firstTick
        )
        assertScenarioTick(
          plan,
          scenario.policy,
          `predicate ${predicate.objectiveId} lastTick`,
          window.lastTick
        )
        if (window.firstTick > window.lastTick)
          fail(
            'evidence-window-range-reversed',
            `plan ${plan.planId} predicate ${predicate.objectiveId} has a reversed tick range`
          )
      }
    }
    referencedScenarioIds.add(predicate.scenarioId)
  }
  for (const lens of plan.preservationLenses)
  {
    const scenario = byScenarioId.get(lens.scenarioId)
    if (scenario === undefined)
      fail(
        'lens-scenario-unbound',
        `plan ${plan.planId} lens ${lens.lensKind} references an unbound scenario`
      )
    if (scenario.policy.applicability === 'candidateOnly')
      fail(
        'candidate-only-preservation-scenario',
        `plan ${plan.planId} preservation lens ${lens.lensKind} requires a baseline for candidate-only scenario ${lens.scenarioId}`
      )
    referencedScenarioIds.add(lens.scenarioId)
  }
  for (const [scenarioId] of byScenarioId)
  {
    if (referencedScenarioIds.has(scenarioId)) continue
    fail(
      'scenario-policy-unreferenced',
      `plan ${plan.planId} scenario ${scenarioId} has no predicate or preservation lens`
    )
  }
  assertReferencedMasks(contract, plan, byScenarioId)
}

function assertPlanClassConsistency(
  contract: EditSemanticChangeContractV1,
  plan: EditEvaluationPlanV1
): void
{
  if (plan.planClass === 'behavioralEdit')
  {
    if (plan.requiredRuntimeChanges.length === 0)
      fail(
        'behavioral-runtime-predicate-missing',
        `behavioral plan ${plan.planId} has no positive runtime predicate`
      )
    for (const predicate of plan.requiredRuntimeChanges)
      if (predicate.kind === 'runtimeOutcome' && predicate.ok !== true)
        fail(
          'runtime-predicate-not-positive',
          `behavioral plan ${plan.planId} requires an unsuccessful runtime outcome`
        )
    return
  }
  for (const operationKind of contract.allowedOperationKinds)
  {
    if (STRUCTURAL_METADATA_OPERATION_KINDS_V1.has(operationKind)) continue
    fail(
      'structural-metadata-operation-invalid',
      `structuralMetadataOnly plan ${plan.planId} cannot authorize ${operationKind}`
    )
  }
}

function assertExportPlanConsistency(
  plan: EditEvaluationPlanV1,
  lanes: readonly ActivatedEvaluationLaneV1[],
  retainedPolicies: Readonly<
    Record<string, { readonly scenarioPolicy?: EditScenarioPolicyV1 }>
  >
): void
{
  if (!plan.requiredForExport) return
  const required = new Set(
    lanes
      .filter((lane) => lane.disposition === 'required')
      .map((lane) => lane.lane)
  )
  if (!required.has('projectPreflight'))
    fail(
      'export-preflight-not-required',
      `export plan ${plan.planId} does not require projectPreflight`
    )
  if (![...EXECUTION_LANES_V1].some((lane) => required.has(lane)))
    fail(
      'export-execution-lane-missing',
      `export plan ${plan.planId} requires no official or TurboWarp execution lane`
    )
  const hasPreservation = plan.preservationLenses.some((lens) =>
  {
    const scenario = plan.scenarioPolicySha256s
      .map((semanticSha256) => retainedPolicies[semanticSha256]?.scenarioPolicy)
      .find((policy) => policy?.scenarioId === lens.scenarioId)
    return (
      scenario?.applicability === 'baselineAndCandidate' &&
      required.has(lens.lane) &&
      lensLaneCompatible(lens)
    )
  })
  if (!hasPreservation)
    fail(
      'export-preservation-lens-missing',
      `export plan ${plan.planId} has no compatible required baseline-and-candidate preservation lens`
    )
}

function activateMasks(
  contract: EditSemanticChangeContractV1,
  scenarios: ReadonlySet<string>
): ActivatedObservationMasksV1
{
  return Object.freeze({
    state: Object.freeze(
      contract.stateProjectionMasks.filter((mask) =>
        scenarios.has(mask.scenarioId)
      )
    ),
    clone: Object.freeze(
      contract.cloneProjectionMasks.filter((mask) =>
        scenarios.has(mask.scenarioId)
      )
    ),
    visual: Object.freeze(
      contract.visualProjectionMasks.filter((mask) =>
        scenarios.has(mask.scenarioId)
      )
    ),
  })
}

// the rubric set is every host-retained judgment policy the plan leans on: the
// optional native-evidence policy plus each visual criterion's criterion &
// confidence policies, in plan order
function rubricBindings(
  plan: EditEvaluationPlanV1,
  policies: ReadonlyMap<string, RetainedPolicyBindingV1>
): readonly unknown[]
{
  const entries: unknown[] = []
  const push = (kind: string, semanticSha256: string): void =>
  {
    const binding = policies.get(semanticSha256)
    if (binding === undefined)
    {
      fail(
        'policy-binding-missing',
        `plan ${plan.planId} references an unbound ${kind} policy`
      )
    }
    if (binding.kind !== kind)
    {
      fail(
        'policy-binding-kind',
        `plan ${plan.planId} references ${binding.kind} where ${kind} is required`
      )
    }
    entries.push({
      kind,
      bindingId: binding.bindingId,
      schemaVersion: binding.schemaVersion,
      semanticSha256: binding.semanticSha256,
      retainedArtifactSha256: binding.retainedArtifactSha256,
    })
  }
  if (plan.nativeEvidencePolicySha256 !== undefined)
    push('nativeEvidence', plan.nativeEvidencePolicySha256)
  for (const predicate of plan.requiredRuntimeChanges)
  {
    if (predicate.kind !== 'visualCriterion') continue
    push('visualCriterion', predicate.criterionPolicySha256)
    push('confidence', predicate.confidencePolicySha256)
  }
  return entries
}

function activatePlan(
  contract: EditSemanticChangeContractV1,
  plan: EditEvaluationPlanV1,
  policies: ReadonlyMap<string, RetainedPolicyBindingV1>,
  retainedPolicies: Readonly<
    Record<string, { readonly scenarioPolicy?: EditScenarioPolicyV1 }>
  >
): ActivatedEvaluationPlanV1
{
  const lanes = activateLanes(plan)
  assertPlanClassConsistency(contract, plan)
  assertLaneConsistency(plan, lanes)
  assertScenarioConsistency(contract, plan, retainedPolicies)
  assertExportPlanConsistency(plan, lanes, retainedPolicies)
  for (const scenarioSha256 of plan.scenarioPolicySha256s)
  {
    const binding = policies.get(scenarioSha256)
    if (binding === undefined || binding.kind !== 'scenario')
    {
      fail(
        'scenario-policy-unbound',
        `plan ${plan.planId} references a scenario policy with no retained binding`
      )
    }
  }
  const runtimeBinding = policies.get(plan.runtimePolicySha256)
  if (runtimeBinding === undefined || runtimeBinding.kind !== 'runtime')
  {
    fail(
      'runtime-policy-unbound',
      `plan ${plan.planId} references a runtime policy with no retained binding`
    )
  }
  const scenarios = scenarioIdsForPlan(plan)
  const masks = activateMasks(contract, scenarios)
  const rubrics = rubricBindings(plan, policies)
  return Object.freeze({
    planId: plan.planId,
    planClass: plan.planClass,
    requiredForExport: plan.requiredForExport,
    plan,
    evaluationPlanSha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-plan',
      plan,
    }),
    lanes,
    requiredLanes: Object.freeze(
      lanes
        .filter((entry) => entry.disposition === 'required')
        .map((entry) => entry.lane)
    ),
    forbiddenLanes: Object.freeze(
      lanes
        .filter((entry) => entry.disposition === 'forbidden')
        .map((entry) => entry.lane)
    ),
    requiredRuntimeChanges: Object.freeze([...plan.requiredRuntimeChanges]),
    preservationLenses: Object.freeze([...plan.preservationLenses]),
    scenarioPolicySha256s: Object.freeze([...plan.scenarioPolicySha256s]),
    runtimePolicySha256: plan.runtimePolicySha256,
    nativeEvidencePolicySha256: plan.nativeEvidencePolicySha256 ?? null,
    // native evidence is the only phase that cannot be produced in-process, so
    // its policy presence is exactly the external-evidence trigger
    requiresExternalEvidence:
      plan.nativeEvidencePolicySha256 !== undefined ||
      plan.requiredRuntimeChanges.some(
        (predicate) => predicate.kind === 'visualCriterion'
      ),
    masks,
    resourceLimitOverrides: Object.freeze(
      Object.fromEntries(
        contract.limitOverrides.map((override) => [
          PHASE_8_EDIT_LIMIT_AUTHORITY_V1[override.key].resourcePolicyKey,
          override.value,
        ])
      )
    ),
    scenarioSetSha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-scenario-set',
      entries: plan.scenarioPolicySha256s,
    }),
    lensPolicySetSha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-lens-policy-set',
      entries: plan.preservationLenses,
    }),
    observationPlanSetSha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-observation-plan-set',
      state: masks.state,
      clone: masks.clone,
      visual: masks.visual,
    }),
    rubricSetSha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-rubric-set',
      entries: rubrics,
    }),
  })
}

export function activateEvaluationPlanSetV1(
  contract: EditSemanticChangeContractV1,
  retainedPolicies: Readonly<
    Record<string, { readonly scenarioPolicy?: EditScenarioPolicyV1 }>
  >
): ActivatedEvaluationPlanSetV1
{
  const policies = new Map<string, RetainedPolicyBindingV1>()
  for (const binding of contract.policyBindings)
  {
    if (policies.has(binding.semanticSha256))
    {
      fail(
        'policy-binding-ambiguous',
        'one policy hash resolves more than one retained binding'
      )
    }
    policies.set(binding.semanticSha256, binding)
  }
  const activated: ActivatedEvaluationPlanV1[] = []
  const byId = new Map<string, ActivatedEvaluationPlanV1>()
  for (const plan of contract.evaluationPlans)
  {
    if (byId.has(plan.planId))
      fail(
        'duplicate-plan-id',
        `contract repeats evaluation plan ${plan.planId}`
      )
    const entry = activatePlan(contract, plan, policies, retainedPolicies)
    activated.push(entry)
    byId.set(entry.planId, entry)
  }
  const exportPlans = activated.filter((plan) => plan.requiredForExport)
  if (exportPlans.length !== 1)
    fail(
      'export-plan-count',
      `contract has ${exportPlans.length} requiredForExport plans; exactly one is required`
    )
  const exportRequired = exportPlans[0]!
  if (exportRequired.planId !== contract.exportRequiredPlanId)
    fail(
      'export-plan-id-mismatch',
      `exportRequiredPlanId ${contract.exportRequiredPlanId} does not name sole required plan ${exportRequired.planId}`
    )
  const plans = Object.freeze(activated)
  return Object.freeze({
    plans,
    exportRequiredPlanId: exportRequired.planId,
    exportRequiredPlan: exportRequired,
    planSetSha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-plan-set',
      entries: plans.map((entry) => ({
        planId: entry.planId,
        evaluationPlanSha256: entry.evaluationPlanSha256,
      })),
      exportRequiredPlanId: exportRequired.planId,
    }),
    plan: (planId: string) =>
    {
      const entry = byId.get(planId)
      if (entry === undefined)
        fail('unknown-plan-id', `no evaluation plan named ${planId}`)
      return entry
    },
  })
}
