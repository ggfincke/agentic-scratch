// packages/eval/src/multimodal/differential.ts
// pure behavioral lenses plus bounded official/TurboWarp differential runners

import { resolve } from 'node:path'

import {
  runBrowserScenario,
  runOfficialBrowserScenario,
  runScenario,
  validateObservationPlan,
  type BrowserScenarioOptions,
  type BrowserTrace,
  type CloneCountSampleV1,
  type MediaFrameRefV1,
  type ObservationPlanV1,
  type RunIssue,
  type Scenario,
  type VmSpriteState,
  type VmStateSnapshot,
  type VmTrace,
} from '@scratch-agent/runner'

import {
  aggregateLensResults,
  type BehavioralLensSpecV1,
  type DifferentialCapabilityAssessmentV1,
  type DifferentialCapabilityRequirementV1,
  type DifferentialReportV1,
  type DifferentialRunBindingV1,
  type LensDifference,
  type LensInconclusiveReason,
  type LensResultV1,
} from './lenses.js'
import {
  validateBehavioralLensSpecs,
  validateDifferentialReport,
} from './lens-validation.js'
import {
  assessSb3DifferentialCapabilities,
  bindDifferentialCapabilities,
  differentialCapabilityBindingMatches,
  unassessedDifferentialCapabilities,
} from './differential-capabilities.js'
import {
  hashMultimodalJson,
  MULTIMODAL_SCHEMA_VERSION,
  type MultimodalEvidenceLocator,
} from './multimodal-contracts.js'

export type BehavioralTrace = VmTrace | BrowserTrace

export interface DifferentialEvaluationInput
{
  comparisonKind: DifferentialReportV1['comparisonKind']
  left: BehavioralTrace
  right: BehavioralTrace
  specs: BehavioralLensSpecV1[]
  capabilityAssessment?: DifferentialCapabilityAssessmentV1
  seed?: number
  fixedDateMs?: number
}

interface CheapRuntimeDifferentialOptions
{
  browser: BrowserScenarioOptions
  observationPlan?: ObservationPlanV1
  specs: BehavioralLensSpecV1[]
}

interface CheapRuntimeDifferentialResult
{
  officialHeadless: VmTrace
  turboWarp: BrowserTrace
  report: Readonly<DifferentialReportV1>
}

interface RenderedRuntimeDifferentialOptions
{
  official: BrowserScenarioOptions
  turboWarp: BrowserScenarioOptions
  observationPlan: ObservationPlanV1
  specs: BehavioralLensSpecV1[]
}

interface RenderedRuntimeDifferentialResult
{
  official: BrowserTrace
  turboWarp: BrowserTrace
  report: Readonly<DifferentialReportV1>
}

const MAX_DIFFERENCES = 100

interface DifferenceCollector
{
  differences: LensDifference[]
  omitted: number
}

interface NumericTolerancePolicy
{
  defaultAbsolute: number
  byPath?: Record<string, number>
}

function requireOfflineBrowserOptions(
  label: string,
  options: BrowserScenarioOptions
): void
{
  if (options.allowNetwork || (options.allowedOrigins?.length ?? 0) > 0)
    throw new Error(`${label} runtime differential must remain network-denied`)
}

function requireOfflineScenario(scenario: Scenario): void
{
  if (scenario.allowNetwork || (scenario.allowedOrigins?.length ?? 0) > 0)
    throw new Error('runtime differential scenario must remain network-denied')
}

function capabilityRequirements(
  input: DifferentialEvaluationInput
): DifferentialCapabilityRequirementV1[]
{
  if (input.comparisonKind !== 'runtime-runtime') return []
  const rendererSupported =
    input.left.runtimeDescriptor.renderer !== 'none' &&
    input.right.runtimeDescriptor.renderer !== 'none'
  return input.specs
    .filter((spec) => spec.kind === 'visual-keyframes')
    .map((spec) => ({
      specId: spec.id,
      capability: 'renderer',
      support: rendererSupported ? 'supported' : 'unsupported',
      reason: rendererSupported
        ? null
        : 'a visual-keyframes lens requires a renderer in both lanes',
    }))
}

function display(value: unknown): string
{
  const json = JSON.stringify(value)
  if (json === undefined) return String(value)
  return json.length > 300 ? `${json.slice(0, 297)}...` : json
}

function addDifference(
  collector: DifferenceCollector,
  path: string,
  left: unknown,
  right: unknown,
  detail: string,
  evidence: MultimodalEvidenceLocator[] = []
): void
{
  if (collector.differences.length >= MAX_DIFFERENCES)
  {
    collector.omitted++
    return
  }
  collector.differences.push({
    path,
    left: display(left),
    right: display(right),
    detail,
    evidence,
  })
}

function numericToleranceAt(
  policy: NumericTolerancePolicy,
  path: string
): number
{
  let tolerance = policy.defaultAbsolute
  let matchedLength = -1
  for (const [prefix, value] of Object.entries(policy.byPath ?? {}))
  {
    const matches =
      path === prefix ||
      path.startsWith(`${prefix}.`) ||
      path.startsWith(`${prefix}[`)
    if (matches && prefix.length > matchedLength)
    {
      tolerance = value
      matchedLength = prefix.length
    }
  }
  return tolerance
}

function compareJson(
  left: unknown,
  right: unknown,
  path: string,
  numericTolerance: NumericTolerancePolicy,
  collector: DifferenceCollector
): void
{
  if (typeof left === 'number' && typeof right === 'number')
  {
    const tolerance = numericToleranceAt(numericTolerance, path)
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      Math.abs(left - right) > tolerance
    )
      addDifference(
        collector,
        path,
        left,
        right,
        `numeric delta exceeds ${tolerance}`
      )
    return
  }
  if (Object.is(left, right)) return
  if (Array.isArray(left) && Array.isArray(right))
  {
    if (left.length !== right.length)
      addDifference(
        collector,
        `${path}.length`,
        left.length,
        right.length,
        'array lengths differ'
      )
    const length = Math.min(left.length, right.length)
    for (let index = 0; index < length; index++)
      compareJson(
        left[index],
        right[index],
        `${path}[${index}]`,
        numericTolerance,
        collector
      )
    return
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  )
  {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const keys = [
      ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
    ].sort()
    for (const key of keys)
    {
      if (!Object.hasOwn(leftRecord, key))
      {
        addDifference(
          collector,
          `${path}.${key}`,
          undefined,
          rightRecord[key],
          'value is absent on the left'
        )
        continue
      }
      if (!Object.hasOwn(rightRecord, key))
      {
        addDifference(
          collector,
          `${path}.${key}`,
          leftRecord[key],
          undefined,
          'value is absent on the right'
        )
        continue
      }
      compareJson(
        leftRecord[key],
        rightRecord[key],
        `${path}.${key}`,
        numericTolerance,
        collector
      )
    }
    return
  }
  addDifference(collector, path, left, right, 'values differ')
}

function stateProjection(snapshot: VmStateSnapshot): unknown
{
  const targetsById: Record<string, unknown> = {}
  for (const id of snapshot.targetOrder)
  {
    const target = snapshot.targetsById[id]
    if (!target) continue
    const projection: Record<string, unknown> = {
      id: target.id,
      name: target.name,
      isStage: target.isStage,
      x: target.x,
      y: target.y,
      direction: target.direction,
      costume: target.costume,
      visible: target.visible,
      size: target.size,
      rotationStyle: target.rotationStyle,
      draggable: target.draggable,
      volume: target.volume,
      effects: target.effects,
      bubble: target.bubble,
      variables: target.variables,
      lists: target.lists,
    }
    if ('editBoundedCostumeIndex' in target)
      projection.costumeIndex = (
        target as VmSpriteState & { editBoundedCostumeIndex: unknown }
      ).editBoundedCostumeIndex
    targetsById[id] = projection
  }
  const projection: Record<string, unknown> = {
    targetOrder: snapshot.targetOrder,
    stageTargetId: snapshot.stageTargetId,
    targetsById,
    answer: snapshot.answer,
    timer: snapshot.timer,
    stage: snapshot.stage,
  }
  if ('editBoundedSupplemental' in snapshot)
    projection.supplemental = (
      snapshot as VmStateSnapshot & { editBoundedSupplemental: unknown }
    ).editBoundedSupplemental
  return projection
}

function issueProjection(issue: RunIssue): unknown
{
  return {
    code: issue.code,
    kind: issue.kind,
    responsibility: issue.responsibility,
    location: issue.location ?? null,
  }
}

function infrastructureReason(
  trace: BehavioralTrace
): LensInconclusiveReason | null
{
  if (trace.issues.some((issue) => issue.responsibility === 'infrastructure'))
    return 'infrastructure-failure'
  if (trace.issues.some((issue) => issue.responsibility === 'unsupported'))
    return 'unsupported-feature'
  return null
}

function inconclusiveResult(
  spec: BehavioralLensSpecV1,
  reason: LensInconclusiveReason
): LensResultV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    specId: spec.id,
    kind: spec.kind,
    required: spec.required,
    verdict: 'inconclusive',
    inconclusiveReason: reason,
    differences: [],
    omittedDifferenceCount: 0,
    evidence: [],
  }
}

function resultFromCollector(
  spec: BehavioralLensSpecV1,
  collector: DifferenceCollector,
  evidence: MultimodalEvidenceLocator[] = []
): LensResultV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    specId: spec.id,
    kind: spec.kind,
    required: spec.required,
    verdict: collector.differences.length > 0 ? 'diverge' : 'agree',
    inconclusiveReason: null,
    differences: collector.differences,
    omittedDifferenceCount: collector.omitted,
    evidence,
  }
}

function finalStateLens(
  spec: Extract<BehavioralLensSpecV1, { kind: 'final-state' }>,
  left: BehavioralTrace,
  right: BehavioralTrace
): LensResultV1
{
  const reason = infrastructureReason(left) ?? infrastructureReason(right)
  if (reason) return inconclusiveResult(spec, reason)
  if (!left.finalSnapshot || !right.finalSnapshot)
    return inconclusiveResult(
      spec,
      left.ok && right.ok ? 'observation-unavailable' : 'runtime-failure'
    )
  const collector: DifferenceCollector = { differences: [], omitted: 0 }
  compareJson(
    stateProjection(left.finalSnapshot),
    stateProjection(right.finalSnapshot),
    '$.finalState',
    {
      defaultAbsolute: spec.absoluteNumericTolerance,
      byPath: spec.numericToleranceByPath,
    },
    collector
  )
  return resultFromCollector(spec, collector)
}

function labeledTraceLens(
  spec: Extract<BehavioralLensSpecV1, { kind: 'labeled-trace' }>,
  left: BehavioralTrace,
  right: BehavioralTrace
): LensResultV1
{
  const reason = infrastructureReason(left) ?? infrastructureReason(right)
  if (reason) return inconclusiveResult(spec, reason)
  const leftByLabel = new Map(
    left.snapshots
      .filter((snapshot) => snapshot.label !== undefined)
      .map((snapshot) => [snapshot.label!, snapshot])
  )
  const rightByLabel = new Map(
    right.snapshots
      .filter((snapshot) => snapshot.label !== undefined)
      .map((snapshot) => [snapshot.label!, snapshot])
  )
  if (
    spec.labels.some(
      (label) => !leftByLabel.has(label) || !rightByLabel.has(label)
    )
  )
    return inconclusiveResult(spec, 'observation-unavailable')
  const collector: DifferenceCollector = { differences: [], omitted: 0 }
  for (const label of spec.labels)
    compareJson(
      stateProjection(leftByLabel.get(label)!),
      stateProjection(rightByLabel.get(label)!),
      `$.labels[${JSON.stringify(label)}]`,
      {
        defaultAbsolute: spec.absoluteNumericTolerance,
        byPath: spec.numericToleranceByPath,
      },
      collector
    )
  return resultFromCollector(spec, collector)
}

function frameLocator(
  side: 'left' | 'right',
  frame: MediaFrameRefV1
): MultimodalEvidenceLocator
{
  return {
    evidenceId: `${side}:${frame.id}`,
    frameId: frame.id,
    tick: frame.tick,
    region: null,
  }
}

function normalizedGeometry(frame: MediaFrameRefV1): {
  metadata: Record<string, unknown>
  rects: Record<string, unknown>
}
{
  const width = frame.geometry.canvas.width
  const height = frame.geometry.canvas.height
  const metadata: Record<string, unknown> = {}
  const rects: Record<string, unknown> = {}
  for (const target of frame.geometry.targets)
  {
    const key = `${target.originalTargetId}|${target.instance}|${target.instanceIndex}`
    metadata[key] = {
      originalTargetId: target.originalTargetId,
      name: target.name,
      isStage: target.isStage,
      instance: target.instance,
      instanceIndex: target.instanceIndex,
      visible: target.visible,
      costumeIndex: target.costumeIndex,
      costumeName: target.costumeName,
    }
    rects[key] = target.rect
      ? {
          x: normalizedGeometryNumber(target.rect.x, width),
          y: normalizedGeometryNumber(target.rect.y, height),
          width: normalizedGeometryNumber(target.rect.width, width),
          height: normalizedGeometryNumber(target.rect.height, height),
        }
      : null
  }
  if ('editBoundedCanvas' in frame.geometry)
    metadata['$canvas'] = (
      frame.geometry as typeof frame.geometry & { editBoundedCanvas: unknown }
    ).editBoundedCanvas
  return { metadata, rects }
}

function normalizedGeometryNumber(value: unknown, dimension: number): unknown
{
  if (typeof value === 'number') return value / dimension
  if (
    value !== null &&
    typeof value === 'object' &&
    'scalarKind' in value &&
    value.scalarKind === 'number' &&
    'value' in value &&
    value.value !== null &&
    typeof value.value === 'object' &&
    'numberKind' in value.value
  )
  {
    if (
      value.value.numberKind === 'finite' &&
      'value' in value.value &&
      typeof value.value.value === 'number'
    )
      return {
        scalarKind: 'number',
        value: {
          numberKind: 'finite',
          value: value.value.value / dimension,
        },
      }
    return structuredClone(value)
  }
  return value
}

function visualLens(
  spec: Extract<BehavioralLensSpecV1, { kind: 'visual-keyframes' }>,
  left: BehavioralTrace,
  right: BehavioralTrace
): LensResultV1
{
  const reason = infrastructureReason(left) ?? infrastructureReason(right)
  if (reason) return inconclusiveResult(spec, reason)
  const leftManifest = left.observations.media
  const rightManifest = right.observations.media
  if (!leftManifest || !rightManifest)
    return inconclusiveResult(spec, 'observation-unavailable')
  if (!leftManifest.complete || !rightManifest.complete)
    return inconclusiveResult(spec, 'observation-incomplete')
  const leftFrames = new Map(
    leftManifest.frames.map((frame) => [frame.id, frame])
  )
  const rightFrames = new Map(
    rightManifest.frames.map((frame) => [frame.id, frame])
  )
  if (spec.frameIds.some((id) => !leftFrames.has(id) || !rightFrames.has(id)))
    return inconclusiveResult(spec, 'observation-unavailable')
  const collector: DifferenceCollector = { differences: [], omitted: 0 }
  const evidence: MultimodalEvidenceLocator[] = []
  for (const id of spec.frameIds)
  {
    const leftFrame = leftFrames.get(id)!
    const rightFrame = rightFrames.get(id)!
    const frameEvidence = [
      frameLocator('left', leftFrame),
      frameLocator('right', rightFrame),
    ]
    evidence.push(...frameEvidence)
    const before = collector.differences.length
    compareJson(
      leftFrame.meanRgb,
      rightFrame.meanRgb,
      `$.frames[${JSON.stringify(id)}].meanRgb`,
      { defaultAbsolute: spec.maxMeanRgbDelta },
      collector
    )
    compareJson(
      leftFrame.sampledMeanRgb,
      rightFrame.sampledMeanRgb,
      `$.frames[${JSON.stringify(id)}].sampledMeanRgb`,
      { defaultAbsolute: spec.maxMeanRgbDelta },
      collector
    )
    const leftGeometry = normalizedGeometry(leftFrame)
    const rightGeometry = normalizedGeometry(rightFrame)
    compareJson(
      leftGeometry.metadata,
      rightGeometry.metadata,
      `$.frames[${JSON.stringify(id)}].geometry.metadata`,
      { defaultAbsolute: 0 },
      collector
    )
    compareJson(
      leftGeometry.rects,
      rightGeometry.rects,
      `$.frames[${JSON.stringify(id)}].geometry.rects`,
      { defaultAbsolute: spec.maxNormalizedRectDelta },
      collector
    )
    for (const difference of collector.differences.slice(before))
      difference.evidence = frameEvidence
  }
  return resultFromCollector(spec, collector, evidence)
}

function runtimeOutcomeLens(
  spec: Extract<BehavioralLensSpecV1, { kind: 'runtime-outcome' }>,
  left: BehavioralTrace,
  right: BehavioralTrace
): LensResultV1
{
  const reason = infrastructureReason(left) ?? infrastructureReason(right)
  if (reason) return inconclusiveResult(spec, reason)
  const collector: DifferenceCollector = { differences: [], omitted: 0 }
  compareJson(
    { ok: left.ok, issues: left.issues.map(issueProjection) },
    { ok: right.ok, issues: right.issues.map(issueProjection) },
    '$.runtimeOutcome',
    { defaultAbsolute: 0 },
    collector
  )
  return resultFromCollector(spec, collector)
}

function samplesByTick(
  samples: readonly CloneCountSampleV1[]
): Map<number, CloneCountSampleV1>
{
  return new Map(samples.map((sample) => [sample.tick, sample]))
}

function cloneCountLens(
  spec: Extract<BehavioralLensSpecV1, { kind: 'clone-count-trace' }>,
  left: BehavioralTrace,
  right: BehavioralTrace
): LensResultV1
{
  const reason = infrastructureReason(left) ?? infrastructureReason(right)
  if (reason) return inconclusiveResult(spec, reason)
  const leftByTick = samplesByTick(left.observations.cloneCounts)
  const rightByTick = samplesByTick(right.observations.cloneCounts)
  if (
    spec.ticks.some((tick) => !leftByTick.has(tick) || !rightByTick.has(tick))
  )
    return inconclusiveResult(spec, 'observation-unavailable')
  const collector: DifferenceCollector = { differences: [], omitted: 0 }
  for (const tick of spec.ticks)
  {
    const leftSample = leftByTick.get(tick)!
    const rightSample = rightByTick.get(tick)!
    compareJson(
      {
        total: leftSample.total,
        byOriginalTargetId: leftSample.byOriginalTargetId,
      },
      {
        total: rightSample.total,
        byOriginalTargetId: rightSample.byOriginalTargetId,
      },
      `$.ticks[${tick}]`,
      { defaultAbsolute: 0 },
      collector
    )
  }
  return resultFromCollector(spec, collector)
}

function evaluateSpec(
  spec: BehavioralLensSpecV1,
  left: BehavioralTrace,
  right: BehavioralTrace
): LensResultV1
{
  switch (spec.kind)
  {
    case 'final-state':
      return finalStateLens(spec, left, right)
    case 'labeled-trace':
      return labeledTraceLens(spec, left, right)
    case 'visual-keyframes':
      return visualLens(spec, left, right)
    case 'runtime-outcome':
      return runtimeOutcomeLens(spec, left, right)
    case 'clone-count-trace':
      return cloneCountLens(spec, left, right)
  }
}

function binding(
  trace: BehavioralTrace,
  seed: number | undefined,
  fixedDateMs: number | undefined
): DifferentialRunBindingV1
{
  return {
    artifactSha256: trace.observations.sourceSb3Sha256,
    runtimeDescriptor: structuredClone(trace.runtimeDescriptor),
    runtimeDescriptorSha256: hashMultimodalJson(trace.runtimeDescriptor),
    scenarioSha256: trace.observations.scenarioSha256,
    seed: seed ?? null,
    fixedDateMs: fixedDateMs ?? null,
    labels: trace.snapshots.flatMap((snapshot) =>
      snapshot.label === undefined ? [] : [snapshot.label]
    ),
  }
}

export function evaluateBehavioralDifferential(
  input: DifferentialEvaluationInput
): Readonly<DifferentialReportV1>
{
  const validatedSpecs = validateBehavioralLensSpecs(input.specs)
  if (!validatedSpecs.ok)
    throw new Error(
      `invalid behavioral lens specification: ${validatedSpecs.issues[0]?.message ?? 'unknown error'}`
    )
  if (!input.specs.some((spec) => spec.required))
    throw new Error('at least one required behavioral lens is needed')
  if (!['baseline-candidate', 'runtime-runtime'].includes(input.comparisonKind))
    throw new Error('unknown differential comparison kind')
  if (
    input.left.observations.scenarioSha256 !==
    input.right.observations.scenarioSha256
  )
    throw new Error('differential scenarios must match')
  if (
    input.left.observations.planSha256 !== input.right.observations.planSha256
  )
    throw new Error('differential observation plans must match')
  if (
    input.comparisonKind === 'runtime-runtime' &&
    input.left.observations.sourceSb3Sha256 !==
      input.right.observations.sourceSb3Sha256
  )
    throw new Error('runtime differential artifacts must match')
  if (
    input.comparisonKind === 'runtime-runtime' &&
    input.capabilityAssessment?.status === 'assessed' &&
    !differentialCapabilityBindingMatches(
      input.capabilityAssessment,
      {
        sourceSb3Sha256: input.left.observations.sourceSb3Sha256,
        runtimeDescriptor: input.left.runtimeDescriptor,
      },
      {
        sourceSb3Sha256: input.right.observations.sourceSb3Sha256,
        runtimeDescriptor: input.right.runtimeDescriptor,
      }
    )
  )
    throw new Error('capability assessment binding does not match the runs')
  const capabilityAssessment =
    input.capabilityAssessment ?? unassessedDifferentialCapabilities()
  const requirements = capabilityRequirements(input)
  const requirementsBySpec = new Map(
    requirements.map((requirement) => [requirement.specId, requirement])
  )
  const results = input.specs.map((spec) =>
  {
    if (spec.appliesTo !== 'both' && spec.appliesTo !== input.comparisonKind)
      return inconclusiveResult(spec, 'not-applicable')
    if (
      input.comparisonKind === 'runtime-runtime' &&
      capabilityAssessment.status !== 'assessed'
    )
      return inconclusiveResult(spec, 'capability-not-assessed')
    if (
      input.comparisonKind === 'runtime-runtime' &&
      !differentialCapabilityBindingMatches(
        capabilityAssessment,
        {
          sourceSb3Sha256: input.left.observations.sourceSb3Sha256,
          runtimeDescriptor: input.left.runtimeDescriptor,
        },
        {
          sourceSb3Sha256: input.right.observations.sourceSb3Sha256,
          runtimeDescriptor: input.right.runtimeDescriptor,
        }
      )
    )
      return inconclusiveResult(spec, 'capability-binding-mismatch')
    if (requirementsBySpec.get(spec.id)?.support === 'unsupported')
      return inconclusiveResult(spec, 'unsupported-feature')
    if (
      input.comparisonKind === 'runtime-runtime' &&
      capabilityAssessment.classification === 'unsupported'
    )
      return inconclusiveResult(spec, 'unsupported-feature')
    return evaluateSpec(spec, input.left, input.right)
  })
  const report: DifferentialReportV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    comparisonKind: input.comparisonKind,
    left: binding(input.left, input.seed, input.fixedDateMs),
    right: binding(input.right, input.seed, input.fixedDateMs),
    capabilityAssessment,
    capabilityRequirements: requirements,
    specs: input.specs,
    results,
    verdict: aggregateLensResults(results),
    claimScope:
      'Finite evidence may support only: no regression was observed for the recorded scenarios, seeds, lenses, and runtimes.',
  }
  const validated = validateDifferentialReport(report)
  if (!validated.ok)
    throw new Error(
      `invalid differential report: ${validated.issues[0]?.message ?? 'unknown error'}`
    )
  return validated.value
}

export async function runCheapRuntimeDifferential(
  sb3: Uint8Array,
  scenario: Scenario,
  options: CheapRuntimeDifferentialOptions
): Promise<CheapRuntimeDifferentialResult>
{
  requireOfflineScenario(scenario)
  requireOfflineBrowserOptions('cheap', options.browser)
  const capabilityAssessment = await assessSb3DifferentialCapabilities(
    sb3,
    'official-headless-vs-turbowarp-browser'
  )
  const observationPlan = options.observationPlan ?? {
    schemaVersion: 1,
    temporal: null,
    cloneCounts: 'sampled',
  }
  const officialHeadless = await runScenario(sb3, scenario, {
    observationPlan,
  })
  const turboWarp = await runBrowserScenario(sb3, scenario, {
    ...options.browser,
    observationPlan,
  })
  const boundCapabilities = bindDifferentialCapabilities(
    capabilityAssessment,
    {
      sourceSb3Sha256: officialHeadless.observations.sourceSb3Sha256,
      runtimeDescriptor: officialHeadless.runtimeDescriptor,
    },
    {
      sourceSb3Sha256: turboWarp.observations.sourceSb3Sha256,
      runtimeDescriptor: turboWarp.runtimeDescriptor,
    }
  )
  const report = evaluateBehavioralDifferential({
    comparisonKind: 'runtime-runtime',
    left: officialHeadless,
    right: turboWarp,
    specs: options.specs,
    capabilityAssessment: boundCapabilities,
    seed: scenario.seed,
    fixedDateMs: scenario.fixedDateMs,
  })
  return { officialHeadless, turboWarp, report }
}

export async function runRenderedRuntimeDifferential(
  sb3: Uint8Array,
  scenario: Scenario,
  options: RenderedRuntimeDifferentialOptions
): Promise<RenderedRuntimeDifferentialResult>
{
  requireOfflineScenario(scenario)
  requireOfflineBrowserOptions('official', options.official)
  requireOfflineBrowserOptions('TurboWarp', options.turboWarp)
  const capabilityAssessment = await assessSb3DifferentialCapabilities(
    sb3,
    'official-browser-vs-turbowarp-browser'
  )
  const planValidation = validateObservationPlan(options.observationPlan)
  if (!planValidation.ok)
    throw new Error(
      `invalid rendered differential observation plan: ${planValidation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`
    )
  if (
    planValidation.value.temporal &&
    (!options.official.mediaDir || !options.turboWarp.mediaDir)
  )
    throw new Error(
      'a temporal rendered differential requires both media directories'
    )
  if (
    resolve(options.official.screenshotDir) ===
    resolve(options.turboWarp.screenshotDir)
  )
    throw new Error('rendered runtime screenshot directories must be distinct')
  if (
    planValidation.value.temporal &&
    options.official.mediaDir &&
    options.turboWarp.mediaDir &&
    resolve(options.official.mediaDir) === resolve(options.turboWarp.mediaDir)
  )
    throw new Error('rendered runtime media directories must be distinct')
  const official = await runOfficialBrowserScenario(sb3, scenario, {
    ...options.official,
    observationPlan: options.observationPlan,
  })
  const turboWarp = await runBrowserScenario(sb3, scenario, {
    ...options.turboWarp,
    observationPlan: options.observationPlan,
  })
  const boundCapabilities = bindDifferentialCapabilities(
    capabilityAssessment,
    {
      sourceSb3Sha256: official.observations.sourceSb3Sha256,
      runtimeDescriptor: official.runtimeDescriptor,
    },
    {
      sourceSb3Sha256: turboWarp.observations.sourceSb3Sha256,
      runtimeDescriptor: turboWarp.runtimeDescriptor,
    }
  )
  const report = evaluateBehavioralDifferential({
    comparisonKind: 'runtime-runtime',
    left: official,
    right: turboWarp,
    specs: options.specs,
    capabilityAssessment: boundCapabilities,
    seed: scenario.seed,
    fixedDateMs: scenario.fixedDateMs,
  })
  return { official, turboWarp, report }
}
