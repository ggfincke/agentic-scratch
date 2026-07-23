// packages/eval/src/candidate/candidate.ts
// exact-artifact baseline classification & candidate acceptance pipeline

import type { ProjectIR } from '@scratch-agent/ir'
import {
  isImpureEffect,
  SUPPORTED_CHECKS,
  USER_INPUTS,
} from '@scratch-agent/model'
import {
  runIssueMessages,
  SCENARIO_STEP_KINDS,
  type RunIssue,
} from '@scratch-agent/runner'
import {
  matchFailureMultiset,
  matchesFailureExpectation,
  stableFingerprint,
  type AssertionFailure,
  type DiagnosticFailure,
  type FailureExpectation,
  type ModelFailureSignal,
  type NormalizedFailure,
  type VisualFailure,
} from '../core/failures.js'
import {
  caseIssue,
  issueDisposition,
  runIssueFailure,
  type EvaluationDisposition,
} from '../core/issues.js'
import {
  regressionTestIds,
  REPAIR_TEST_ID_PATTERN,
  targetedTestIds,
  type CandidateEvaluationOptions,
  type CandidatePipelineOptions,
  type DiagnosticThreshold,
  type RepairTestSpec,
} from '../core/options.js'
import {
  runTest,
  type RunOptions,
  type TestCase,
  type TestResult,
} from '../core/test.js'
import type { Assertion, Probe, Region } from '../core/assert.js'
import type { Matcher } from '../core/matchers.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'
import {
  NO_DIAGNOSTIC_CHANGES,
  inspectBaselineArtifact,
  preflightCandidateArtifact,
  type ArtifactPreflight,
  type DiagnosticBaseline,
} from '../artifacts/artifact-preflight.js'

const SCENARIO_STEP_KIND_SET = new Set<string>(SCENARIO_STEP_KINDS)

export interface EvaluatedTest
{
  id: string
  name: string
  role: RepairTestSpec['role']
  ok: boolean
  failures: NormalizedFailure[]
  evidenceFailures: NormalizedFailure[]
  issues: RunIssue[]
  result: TestResult
}

type EvaluationStatus =
  'passed' | 'preflight-failed' | EvaluationDisposition

export interface CandidatePhaseEvaluation
{
  status: EvaluationStatus
  ok: boolean
  phase: CandidateEvaluationOptions['phase']
  preflight: ArtifactPreflight
  tests: EvaluatedTest[]
  failures: NormalizedFailure[]
  issues: RunIssue[]
}

export interface CandidatePipelineEvaluation
{
  status:
    | 'passed'
    | 'preflight-failed'
    | 'targeted-failed'
    | 'regression-failed'
    | Exclude<EvaluationDisposition, 'project-failure'>
  ok: boolean
  preflight: ArtifactPreflight
  targeted: CandidatePhaseEvaluation | null
  regression: CandidatePhaseEvaluation | null
  failures: NormalizedFailure[]
  issues: RunIssue[]
}

interface BaselineExpectationMismatch
{
  testId: string
  missing: FailureExpectation[]
  unexpected: NormalizedFailure[]
}

export interface BaselineEvaluation
{
  status:
    | 'already-passing'
    | 'awaiting-proposal'
    | 'baseline-invalid'
    | 'case-invalid'
    | 'stopped-infrastructure'
    | 'stopped-unsupported'
  ok: boolean
  preflight: ArtifactPreflight
  tests: EvaluatedTest[]
  failingTestIds: string[]
  failures: NormalizedFailure[]
  issues: RunIssue[]
  mismatches: BaselineExpectationMismatch[]
}

export type TestExecutor = (
  test: TestCase,
  options?: RunOptions
) => Promise<TestResult>

function isSerializable(value: unknown, seen = new Set<object>()): boolean
{
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
  {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isSerializable(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value as Record<string, unknown>).every((entry) =>
        isSerializable(entry, seen)
      )
  seen.delete(value)
  return valid
}

const VISUAL_PROBES = new Set<Probe['on']>([
  'spriteRect',
  'spriteInRegion',
  'notBlank',
  'regionInk',
  'regionChanged',
])

function finite(value: unknown): value is number
{
  return typeof value === 'number' && Number.isFinite(value)
}

function safeInteger(value: unknown): value is number
{
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function record(value: unknown): value is Record<string, unknown>
{
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function validRegion(region: unknown): region is Region
{
  if (!record(region)) return false
  return (
    finite(region.x) &&
    finite(region.y) &&
    finite(region.width) &&
    finite(region.height) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width >= 0 &&
    region.height >= 0 &&
    region.x + region.width <= 480 &&
    region.y + region.height <= 360
  )
}

const SPRITE_PROPS = new Set([
  'x',
  'y',
  'direction',
  'costume',
  'visible',
  'size',
  'rotationStyle',
  'volume',
  'draggable',
])

const RECT_FIELDS = new Set(['x', 'y', 'width', 'height', 'cx', 'cy'])

function nonemptyString(value: unknown): value is string
{
  return typeof value === 'string' && value.length > 0
}

function validProbe(value: unknown): value is Probe
{
  if (!record(value) || typeof value.on !== 'string') return false
  switch (value.on)
  {
    case 'prop':
      return (
        nonemptyString(value.sprite) && SPRITE_PROPS.has(String(value.prop))
      )
    case 'var':
    case 'list':
      return (
        nonemptyString(value.name) &&
        (value.sprite === undefined || nonemptyString(value.sprite))
      )
    case 'timer':
    case 'answer':
      return true
    case 'said':
      return nonemptyString(value.sprite)
    case 'spriteRect':
      return (
        nonemptyString(value.sprite) && RECT_FIELDS.has(String(value.field))
      )
    case 'spriteInRegion':
      return nonemptyString(value.sprite) && validRegion(value.region)
    case 'notBlank':
    case 'regionInk':
      return value.region === undefined || validRegion(value.region)
    case 'regionChanged':
      return (
        nonemptyString(value.from) &&
        (value.region === undefined || validRegion(value.region))
      )
    default:
      return false
  }
}

function probeRegion(probe: Probe): Region | undefined
{
  switch (probe.on)
  {
    case 'spriteInRegion':
      return probe.region
    case 'notBlank':
    case 'regionInk':
    case 'regionChanged':
      return probe.region
    default:
      return undefined
  }
}

function validMatcher(value: unknown): value is Matcher
{
  if (!record(value) || typeof value.kind !== 'string') return false
  switch (value.kind)
  {
    case 'equals':
    case 'contains':
      return (
        typeof value.value === 'string' ||
        typeof value.value === 'boolean' ||
        finite(value.value)
      )
    case 'closeTo':
      return (
        finite(value.value) &&
        (value.eps === undefined || (finite(value.eps) && value.eps >= 0))
      )
    case 'gt':
    case 'lt':
      return finite(value.value)
    default:
      return false
  }
}

function validateScenarioDefinition(test: RepairTestSpec): string[]
{
  const problems: string[] = []
  const scenario: unknown = test.scenario
  if (!record(scenario)) return ['scenario must be an object']
  for (const [field, value] of [
    ['seed', scenario.seed],
    ['fixedDateMs', scenario.fixedDateMs],
  ] as const)
  {
    if (value !== undefined && !safeInteger(value))
      problems.push(`${field} must be a finite safe integer`)
  }
  if (
    scenario.maxTicks !== undefined &&
    (!safeInteger(scenario.maxTicks) || scenario.maxTicks < 0)
  )
  {
    problems.push('maxTicks must be a nonnegative safe integer')
  }
  if (!Array.isArray(scenario.steps))
  {
    problems.push('steps must be an array')
    return problems
  }
  const labels = new Set<string>()
  const safeLabels = new Set<string>()
  if (
    scenario.allowNetwork !== undefined &&
    typeof scenario.allowNetwork !== 'boolean'
  )
  {
    problems.push('allowNetwork must be boolean')
  }
  if (
    scenario.allowedOrigins !== undefined &&
    (!Array.isArray(scenario.allowedOrigins) ||
      scenario.allowedOrigins.some((origin) => !nonemptyString(origin)))
  )
  {
    problems.push('allowedOrigins must contain nonempty strings')
  }
  for (const value of scenario.steps)
  {
    if (!record(value) || !SCENARIO_STEP_KIND_SET.has(String(value.do)))
    {
      problems.push('scenario contains an unknown or malformed step')
      continue
    }
    const step = value as RepairTestSpec['scenario']['steps'][number]
    if (step.do === 'wait' && (!safeInteger(step.ticks) || step.ticks < 0))
    {
      problems.push('wait ticks must be a nonnegative safe integer')
    }
    if (
      step.do === 'tapKey' &&
      step.ticks !== undefined &&
      (!safeInteger(step.ticks) || step.ticks < 0)
    )
    {
      problems.push('tapKey ticks must be a nonnegative safe integer')
    }
    if (
      step.do === 'broadcastAndWait' &&
      step.maxTicks !== undefined &&
      (!safeInteger(step.maxTicks) || step.maxTicks < 0)
    )
    {
      problems.push(
        'broadcastAndWait maxTicks must be a nonnegative safe integer'
      )
    }
    if (
      (step.do === 'moveMouse' ||
        step.do === 'mouseDown' ||
        step.do === 'mouseUp') &&
      (!finite(step.x) || !finite(step.y))
    )
    {
      problems.push(`${step.do} coordinates must be finite`)
    }
    if (
      ((step.do === 'keyDown' ||
        step.do === 'keyUp' ||
        step.do === 'tapKey' ||
        step.do === 'pressKey' ||
        step.do === 'releaseKey') &&
        !nonemptyString(step.key)) ||
      (step.do === 'clickSprite' && !nonemptyString(step.sprite)) ||
      ((step.do === 'broadcast' || step.do === 'broadcastAndWait') &&
        !nonemptyString(step.name)) ||
      (step.do === 'typeAnswer' && typeof step.text !== 'string')
    )
    {
      problems.push(`${step.do} has an invalid string argument`)
    }
    if (step.do === 'snapshot')
    {
      if (!nonemptyString(step.label))
      {
        problems.push('snapshot label must not be empty')
        continue
      }
      if (labels.has(step.label))
        problems.push(`duplicate snapshot label ${step.label}`)
      labels.add(step.label)
      const safeLabel = step.label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
      if (safeLabels.has(safeLabel))
        problems.push(`snapshot labels collide after sanitizing: ${step.label}`)
      safeLabels.add(safeLabel)
    }
  }
  return problems
}

function validateAssertions(
  assertions: unknown,
  scenario: unknown,
  lane: 'vm' | 'browser'
): string[]
{
  const problems: string[] = []
  if (!Array.isArray(assertions)) return [`${lane} assertions must be an array`]
  if (!record(scenario) || !Array.isArray(scenario.steps))
    return ['assertions require a valid scenario']
  const snapshotOrder = new Map<string, number>()
  for (let index = 0; index < scenario.steps.length; index++)
  {
    const step = scenario.steps[index]
    if (
      record(step) &&
      step.do === 'snapshot' &&
      typeof step.label === 'string' &&
      !snapshotOrder.has(step.label)
    )
    {
      snapshotOrder.set(step.label, index)
    }
  }
  for (const value of assertions)
  {
    if (!record(value) || !nonemptyString(value.at))
    {
      problems.push('assertion must have a nonempty snapshot label')
      continue
    }
    if (!validProbe(value.probe))
    {
      problems.push('assertion probe is invalid')
      continue
    }
    if (!validMatcher(value.match))
    {
      problems.push('matcher is invalid')
      continue
    }
    const assertion = value as unknown as Assertion
    const at = snapshotOrder.get(assertion.at)
    if (at === undefined)
      problems.push(`assertion references missing snapshot ${assertion.at}`)
    if (lane === 'vm' && VISUAL_PROBES.has(assertion.probe.on))
      problems.push(
        `visual probe ${assertion.probe.on} is invalid in VM asserts`
      )
    const region = probeRegion(assertion.probe)
    if (region && !validRegion(region))
      problems.push('probe region is out of bounds')
    if (assertion.probe.on === 'regionChanged')
    {
      const from = snapshotOrder.get(assertion.probe.from)
      if (from === undefined)
        problems.push(
          `regionChanged references missing snapshot ${assertion.probe.from}`
        )
      else if (at !== undefined && from >= at)
        problems.push('regionChanged reference must precede assertion snapshot')
    }
  }
  return problems
}

function validCheckArg(value: unknown): boolean
{
  return (
    typeof value === 'string' || typeof value === 'boolean' || finite(value)
  )
}

function validateModelChecks(
  value: unknown,
  kind: 'condition' | 'effect' | 'input',
  modelId: string,
  edgeId: string
): string[]
{
  if (!Array.isArray(value))
    return [`model edge ${edgeId} ${kind}s must be an array`]
  const problems: string[] = []
  for (const check of value)
  {
    const keys =
      kind === 'input' ? ['name', 'args'] : ['name', 'negated', 'args']
    if (!record(check) || !onlyKeys(check, keys))
    {
      problems.push(`model edge ${edgeId} has an invalid ${kind}`)
      continue
    }
    if (
      !nonemptyString(check.name) ||
      !Array.isArray(check.args) ||
      check.args.some((argument) => !validCheckArg(argument)) ||
      (kind !== 'input' && typeof check.negated !== 'boolean')
    )
    {
      problems.push(`model edge ${edgeId} has an invalid ${kind}`)
      continue
    }
    if (kind === 'input')
    {
      if (!USER_INPUTS.has(check.name))
        problems.push(`unsupported model input ${check.name}`)
      continue
    }
    if (
      !SUPPORTED_CHECKS.has(check.name) ||
      (kind === 'condition' && isImpureEffect(check.name))
    )
    {
      problems.push(`unsupported model ${kind} ${check.name}`)
    }
    if (check.name === 'SpriteTouching')
      problems.push('SpriteTouching requires a renderer-backed model lane')
  }
  return problems.map((problem) => `model ${modelId}: ${problem}`)
}

function validateModelEdge(
  value: unknown,
  modelId: string,
  usage: string
): string[]
{
  if (
    !record(value) ||
    !onlyKeys(value, [
      'id',
      'label',
      'from',
      'to',
      'forceTestAtTicks',
      'forceTestAfterTicks',
      'conditions',
      'effects',
      'inputs',
    ])
  )
  {
    return [`model ${modelId} has an invalid edge`]
  }
  const edgeId = nonemptyString(value.id) ? value.id : '(missing ID)'
  const problems: string[] = []
  if (
    !nonemptyString(value.id) ||
    typeof value.label !== 'string' ||
    !nonemptyString(value.from) ||
    !nonemptyString(value.to)
  )
  {
    problems.push(`model ${modelId} edge ${edgeId} has invalid identity fields`)
  }
  if (value.forceTestAtTicks !== -1 || value.forceTestAfterTicks !== -1)
  {
    problems.push(
      `model ${modelId} edge ${edgeId} uses unsupported forced timing`
    )
  }
  problems.push(
    ...validateModelChecks(value.conditions, 'condition', modelId, edgeId)
  )
  problems.push(
    ...validateModelChecks(value.effects, 'effect', modelId, edgeId)
  )
  problems.push(...validateModelChecks(value.inputs, 'input', modelId, edgeId))
  if (
    usage === 'user' &&
    (Array.isArray(value.effects) ? value.effects.length > 0 : true)
  )
  {
    problems.push(
      `model ${modelId} user edge ${edgeId} must not contain effects`
    )
  }
  if (
    usage !== 'user' &&
    (Array.isArray(value.inputs) ? value.inputs.length > 0 : true)
  )
  {
    problems.push(
      `model ${modelId} edge ${edgeId} must not contain user inputs`
    )
  }
  return problems
}

function validateLoadedModel(
  value: unknown,
  expectedUsage: 'program' | 'end' | 'user'
): string[]
{
  if (
    !record(value) ||
    !onlyKeys(value, [
      'id',
      'usage',
      'startNodeId',
      'stopAllNodeIds',
      'nodes',
      'edges',
      'initialStorage',
      'startTrigger',
      'maxDurationTicks',
    ])
  )
  {
    return ['model must contain the complete loaded model shape']
  }
  const modelId = nonemptyString(value.id) ? value.id : '(missing ID)'
  const problems: string[] = []
  if (!nonemptyString(value.id)) problems.push('model ID must not be empty')
  if (value.usage !== expectedUsage)
  {
    problems.push(
      `model ${modelId} usage must match its ${expectedUsage} model role`
    )
  }
  if (!nonemptyString(value.startNodeId))
    problems.push(`model ${modelId} startNodeId must not be empty`)
  if (!nonemptyString(value.startTrigger))
    problems.push(`model ${modelId} startTrigger must not be empty`)
  if (
    expectedUsage === 'user'
      ? value.maxDurationTicks !== null &&
        (!safeInteger(value.maxDurationTicks) || value.maxDurationTicks <= 0)
      : value.maxDurationTicks !== null
  )
  {
    problems.push(`model ${modelId} has an invalid maxDurationTicks`)
  }
  if (!(value.stopAllNodeIds instanceof Set))
  {
    problems.push(`model ${modelId} stopAllNodeIds must be a set`)
  }
  if (!(value.nodes instanceof Map))
  {
    problems.push(`model ${modelId} nodes must be a map`)
  }
  if (!Array.isArray(value.edges))
  {
    problems.push(`model ${modelId} edges must be an array`)
  }
  if (!record(value.initialStorage))
  {
    problems.push(`model ${modelId} initialStorage must be an object`)
  }
  else if (
    Object.values(value.initialStorage).some((entry) => !validCheckArg(entry))
  )
  {
    problems.push(`model ${modelId} initialStorage contains an invalid value`)
  }

  const edges = Array.isArray(value.edges) ? value.edges : []
  const edgeById = new Map<string, unknown>()
  for (const edge of edges)
  {
    problems.push(...validateModelEdge(edge, modelId, expectedUsage))
    if (!record(edge) || !nonemptyString(edge.id)) continue
    if (edgeById.has(edge.id))
      problems.push(`duplicate model edge ID ${edge.id}`)
    else edgeById.set(edge.id, edge)
  }

  const nodes = value.nodes instanceof Map ? value.nodes : new Map()
  if (nodes.size === 0) problems.push(`model ${modelId} has no nodes`)
  for (const [nodeId, node] of nodes)
  {
    if (
      typeof nodeId !== 'string' ||
      !nonemptyString(nodeId) ||
      !record(node) ||
      !onlyKeys(node, ['id', 'label', 'outgoing', 'isStop'])
    )
    {
      problems.push(`model ${modelId} has an invalid node`)
      continue
    }
    if (
      node.id !== nodeId ||
      typeof node.label !== 'string' ||
      typeof node.isStop !== 'boolean' ||
      !Array.isArray(node.outgoing)
    )
    {
      problems.push(`model ${modelId} node ${nodeId} has an invalid shape`)
      continue
    }
    const outgoingIds = new Set<string>()
    for (const outgoing of node.outgoing)
    {
      if (!record(outgoing) || !nonemptyString(outgoing.id))
      {
        problems.push(
          `model ${modelId} node ${nodeId} has an invalid outgoing edge`
        )
        continue
      }
      if (outgoingIds.has(outgoing.id))
        problems.push(
          `model ${modelId} node ${nodeId} repeats edge ${outgoing.id}`
        )
      outgoingIds.add(outgoing.id)
      if (edgeById.get(outgoing.id) !== outgoing)
      {
        problems.push(
          `model ${modelId} node ${nodeId} references a noncanonical edge ${outgoing.id}`
        )
      }
      if (outgoing.from !== nodeId)
      {
        problems.push(
          `model ${modelId} edge ${outgoing.id} is attached to the wrong node`
        )
      }
    }
    if (node.isStop !== (node.outgoing.length === 0))
      problems.push(`model ${modelId} node ${nodeId} has incoherent stop state`)
  }
  if (nodes instanceof Map && !nodes.has(value.startNodeId))
  {
    problems.push(
      `model ${modelId} startNodeId ${String(value.startNodeId)} is not declared`
    )
  }
  if (value.stopAllNodeIds instanceof Set)
  {
    for (const stopNodeId of value.stopAllNodeIds)
    {
      if (!nonemptyString(stopNodeId) || !nodes.has(stopNodeId))
      {
        problems.push(
          `model ${modelId} stop-all node ${String(stopNodeId)} is not declared`
        )
      }
    }
  }
  for (const edge of edges)
  {
    if (!record(edge) || !nonemptyString(edge.id)) continue
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
    {
      problems.push(
        `model ${modelId} edge ${edge.id} references an unknown node`
      )
      continue
    }
    const from = nodes.get(edge.from)
    if (
      !record(from) ||
      !Array.isArray(from.outgoing) ||
      !from.outgoing.includes(edge)
    )
    {
      problems.push(
        `model ${modelId} edge ${edge.id} is missing from its source node`
      )
    }
  }
  return problems
}

function validateModels(test: RepairTestSpec): string[]
{
  const loaded: unknown = test.model
  if (loaded === undefined) return []
  const problems: string[] = []
  if (!record(loaded)) return ['loaded models must be an object']
  if (
    !Array.isArray(loaded.programModels) ||
    !Array.isArray(loaded.endModels) ||
    !Array.isArray(loaded.userModels)
  )
  {
    return ['loaded model roles must be arrays']
  }
  if (loaded.userModels.length > 0)
    problems.push('user models are not executed by registered repair tests')
  const ids = new Set<string>()
  for (const [usage, models] of [
    ['program', loaded.programModels],
    ['end', loaded.endModels],
    ['user', loaded.userModels],
  ] as const)
  {
    for (const value of models)
    {
      problems.push(...validateLoadedModel(value, usage))
      if (record(value) && nonemptyString(value.id))
      {
        if (ids.has(value.id)) problems.push(`duplicate model ID ${value.id}`)
        ids.add(value.id)
      }
    }
  }
  return problems
}

function validateTestDefinition(test: RepairTestSpec): string[]
{
  const assertions: unknown = test.asserts
  const visual: unknown = test.visual ?? []
  const loaded: unknown = test.model
  const modelCount =
    record(loaded) &&
    Array.isArray(loaded.programModels) &&
    Array.isArray(loaded.endModels)
      ? loaded.programModels.length + loaded.endModels.length
      : 0
  const problems = [
    ...validateScenarioDefinition(test),
    ...validateAssertions(assertions, test.scenario, 'vm'),
    ...validateAssertions(visual, test.scenario, 'browser'),
    ...validateModels(test),
  ]
  if (!isSerializable(test.scenario))
    problems.push('scenario must be JSON-serializable')
  if (!isSerializable(assertions))
    problems.push('VM assertions must be JSON-serializable')
  if (!isSerializable(visual))
    problems.push('visual assertions must be JSON-serializable')
  const assertionCount = Array.isArray(assertions) ? assertions.length : 0
  const visualCount = Array.isArray(visual) ? visual.length : 0
  if (assertionCount + visualCount + modelCount === 0)
    problems.push('test must register at least one executable oracle')
  return problems
}

function validTargetLocation(value: unknown): boolean
{
  return (
    record(value) &&
    safeInteger(value.targetIndex) &&
    value.targetIndex >= 0 &&
    nonemptyString(value.name) &&
    typeof value.isStage === 'boolean'
  )
}

function validEvidenceLocation(value: unknown, allowMonitor: boolean): boolean
{
  if (!record(value) || typeof value.kind !== 'string') return false
  switch (value.kind)
  {
    case 'project':
      return true
    case 'target':
      return validTargetLocation(value.target)
    case 'block':
      return (
        record(value.block) &&
        validTargetLocation(value.block.target) &&
        nonemptyString(value.block.blockId)
      )
    case 'script':
      return (
        record(value.script) &&
        validTargetLocation(value.script.target) &&
        nonemptyString(value.script.topBlockId)
      )
    case 'declaration':
      return (
        record(value.declaration) &&
        ['variable', 'list', 'broadcast'].includes(
          String(value.declaration.kind)
        ) &&
        validTargetLocation(value.declaration.declarationTarget) &&
        nonemptyString(value.declaration.id) &&
        nonemptyString(value.declaration.name)
      )
    case 'asset':
      return nonemptyString(value.path)
    case 'unresolved-target':
      return nonemptyString(value.name)
    case 'monitor':
      return allowMonitor && nonemptyString(value.id)
    default:
      return false
  }
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean
{
  const keys = new Set(allowed)
  return Object.keys(value).every((key) => keys.has(key))
}

function validFailureExpectation(value: unknown): value is FailureExpectation
{
  if (!record(value) || typeof value.kind !== 'string') return false
  switch (value.kind)
  {
    case 'schema':
      return (
        onlyKeys(value, ['kind', 'category']) &&
        [
          'artifact-load-failed',
          'ir-construction-failed',
          'project-json-invalid',
          'scratch-parser-rejected',
          'unsupported-project-version',
        ].includes(String(value.category))
      )
    case 'diagnostic':
      return (
        onlyKeys(value, ['kind', 'source', 'code', 'locations']) &&
        (value.source === 'graph' || value.source === 'static') &&
        nonemptyString(value.code) &&
        (value.locations === undefined ||
          (Array.isArray(value.locations) &&
            value.locations.every((location) =>
              validEvidenceLocation(location, true)
            )))
      )
    case 'run':
      return (
        onlyKeys(value, ['kind', 'lane', 'issueKind', 'code', 'location']) &&
        ['vm', 'model', 'browser'].includes(String(value.lane)) &&
        nonemptyString(value.issueKind) &&
        nonemptyString(value.code) &&
        (value.location === undefined ||
          validEvidenceLocation(value.location, false))
      )
    case 'assertion':
    case 'visual':
      return (
        onlyKeys(value, ['kind', 'snapshot', 'probe', 'matcher']) &&
        nonemptyString(value.snapshot) &&
        validProbe(value.probe) &&
        validMatcher(value.matcher)
      )
    case 'model':
      return (
        onlyKeys(value, [
          'kind',
          'modelId',
          'edgeId',
          'checkName',
          'checkArgs',
          'checkNegated',
          'phase',
          'target',
        ]) &&
        nonemptyString(value.modelId) &&
        nonemptyString(value.edgeId) &&
        nonemptyString(value.checkName) &&
        Array.isArray(value.checkArgs) &&
        isSerializable(value.checkArgs) &&
        typeof value.checkNegated === 'boolean' &&
        (value.phase === 'condition' || value.phase === 'effect') &&
        (value.target === undefined ||
          value.target === null ||
          nonemptyString(value.target))
      )
    default:
      return false
  }
}

export function validateRepairTestSpecs(tests: RepairTestSpec[]): RunIssue[]
{
  const issues: RunIssue[] = []
  if (!Array.isArray(tests) || tests.length === 0)
  {
    issues.push(caseIssue('eval.case.no-tests', 'repair case has no tests'))
    return issues
  }
  const seen = new Set<string>()
  let targetCount = 0
  for (let index = 0; index < tests.length; index++)
  {
    const value: unknown = tests[index]
    if (!record(value))
    {
      issues.push(
        caseIssue(
          'eval.case.invalid-test-definition',
          `test at index ${index} must be an object`
        )
      )
      continue
    }
    const test = value as unknown as RepairTestSpec
    const id = nonemptyString(value.id) ? value.id : `index-${index}`
    if (test.role !== 'repair-target' && test.role !== 'regression')
    {
      issues.push(
        caseIssue('eval.case.invalid-role', `test ${id} has invalid role`)
      )
    }
    const baseline = record(value.baseline) ? value.baseline : null
    if (
      !baseline ||
      (baseline.outcome !== 'pass' && baseline.outcome !== 'fail')
    )
    {
      issues.push(
        caseIssue(
          'eval.case.invalid-baseline-outcome',
          `test ${id} has invalid baseline outcome`
        )
      )
    }
    if (!nonemptyString(value.id) || !REPAIR_TEST_ID_PATTERN.test(value.id))
    {
      issues.push(
        caseIssue(
          'eval.case.invalid-test-id',
          `test ID is not filesystem-safe: ${String(value.id)}`
        )
      )
    }
    if (seen.has(id))
    {
      issues.push(
        caseIssue('eval.case.duplicate-test-id', `duplicate test ID: ${id}`)
      )
    }
    seen.add(id)
    if (!nonemptyString(value.name) || value.name.trim().length === 0)
    {
      issues.push(
        caseIssue('eval.case.empty-test-name', `test ${id} has no name`)
      )
    }
    for (const problem of validateTestDefinition(test))
    {
      issues.push(
        caseIssue('eval.case.invalid-test-definition', `test ${id}: ${problem}`)
      )
    }
    if (test.role === 'repair-target') targetCount++
    if (test.role === 'regression' && baseline?.outcome !== 'pass')
    {
      issues.push(
        caseIssue(
          'eval.case.regression-must-pass',
          `regression test ${id} must pass at baseline`
        )
      )
    }
    if (test.role === 'repair-target' && baseline?.outcome !== 'fail')
    {
      issues.push(
        caseIssue(
          'eval.case.target-must-fail',
          `repair target ${id} must declare a failing baseline`
        )
      )
    }
    if (baseline?.outcome === 'fail')
    {
      if (baseline.allowAdditionalProjectFailures !== false)
      {
        issues.push(
          caseIssue(
            'eval.case.additional-failures-must-be-disabled',
            `test ${id} must reject additional project failures`
          )
        )
      }
      if (!Array.isArray(baseline.failures) || baseline.failures.length === 0)
      {
        issues.push(
          caseIssue(
            'eval.case.missing-failure-expectation',
            `repair target ${id} has no failure expectation`
          )
        )
      }
      if (!isSerializable(baseline.failures))
      {
        issues.push(
          caseIssue(
            'eval.case.nonserializable-expectation',
            `test ${id} has a nonserializable failure expectation`
          )
        )
      }
      if (
        Array.isArray(baseline.failures) &&
        baseline.failures.some(
          (expectation) => !validFailureExpectation(expectation)
        )
      )
      {
        issues.push(
          caseIssue(
            'eval.case.invalid-failure-expectation',
            `test ${id} has an invalid failure expectation`
          )
        )
      }
    }
  }
  if (targetCount === 0)
  {
    issues.push(
      caseIssue(
        'eval.case.no-repair-target',
        'repair case has no repair target'
      )
    )
  }
  return issues
}

function sameIds(actual: string[], expected: string[]): boolean
{
  if (actual.length !== expected.length) return false
  const actualSet = new Set(actual)
  return (
    actualSet.size === actual.length &&
    expected.every((id) => actualSet.has(id))
  )
}

function validateSelection(options: CandidateEvaluationOptions): RunIssue[]
{
  const issues = validateDiagnosticOptions(options.diagnostics)
  if (!['baseline', 'targeted', 'regression'].includes(options.phase))
  {
    issues.push(
      caseIssue('eval.case.invalid-phase', 'invalid evaluation phase')
    )
  }
  const expected =
    options.phase === 'targeted'
      ? targetedTestIds(options.tests)
      : regressionTestIds(options.tests)
  if (!sameIds(options.selectedTestIds, expected))
  {
    issues.push(
      caseIssue(
        'eval.case.invalid-test-selection',
        `${options.phase} selection must equal its registered test set`
      )
    )
  }
  return issues
}

function validateDiagnosticOptions(options: unknown): RunIssue[]
{
  if (!record(options))
  {
    return [
      caseIssue(
        'eval.case.invalid-diagnostic-options',
        'diagnostic options must be an object'
      ),
    ]
  }
  const issues: RunIssue[] = []
  const thresholds = new Set<DiagnosticThreshold>([
    'never',
    'info',
    'warning',
    'error',
  ])
  if (
    !thresholds.has(options.rejectNewGraphAtOrAbove as DiagnosticThreshold) ||
    !thresholds.has(options.rejectNewStaticAtOrAbove as DiagnosticThreshold)
  )
  {
    issues.push(
      caseIssue(
        'eval.case.invalid-diagnostic-threshold',
        'invalid diagnostic threshold'
      )
    )
  }
  for (const [source, codes] of [
    ['graph', options.allowedNewGraphCodes],
    ['static', options.allowedNewStaticCodes],
  ] as const)
  {
    if (
      !Array.isArray(codes) ||
      new Set(codes).size !== codes.length ||
      codes.some(
        (code) =>
          typeof code !== 'string' || code.length === 0 || code.trim() !== code
      )
    )
    {
      issues.push(
        caseIssue(
          'eval.case.invalid-diagnostic-allowlist',
          `${source} diagnostic allowlist is invalid`
        )
      )
    }
  }
  return issues
}

function assertionFailure(
  testId: string,
  result: TestResult['asserts'][number]
): AssertionFailure
{
  const fields = {
    testId,
    lane: 'vm' as const,
    snapshot: result.at,
    probe: result.probe,
    matcher: result.matcher,
  }
  return {
    kind: 'assertion',
    fingerprint: stableFingerprint('assertion', fields),
    ...fields,
    expected: result.expected,
    observed: result.observed,
  }
}

function visualFailure(
  testId: string,
  result: TestResult['visual'][number]
): VisualFailure
{
  const fields = {
    testId,
    lane: 'browser' as const,
    snapshot: result.at,
    probe: result.probe,
    matcher: result.matcher,
  }
  return {
    kind: 'visual',
    fingerprint: stableFingerprint('visual', fields),
    ...fields,
    expected: result.expected,
    observed: result.observed,
  }
}

function modelFailures(
  testId: string,
  result: TestResult
): ModelFailureSignal[]
{
  if (!result.model) return []
  return result.model.models.flatMap((model) =>
    model.failures.map((failure) =>
    {
      const fields = {
        testId,
        lane: 'model' as const,
        modelId: failure.modelId,
        edgeId: failure.edgeId,
        checkName: failure.checkName,
        checkArgs: [...failure.checkArgs],
        checkNegated: failure.checkNegated,
        phase: failure.phase,
        target: failure.sprite,
      }
      const fingerprintFields = {
        testId,
        modelId: failure.modelId,
        edgeId: failure.edgeId,
        checkName: failure.checkName,
        checkArgs: [...failure.checkArgs],
        checkNegated: failure.checkNegated,
        phase: failure.phase,
      }
      return {
        kind: 'model' as const,
        fingerprint: stableFingerprint('model', fingerprintFields),
        ...fields,
        tick: failure.tick,
        message: failure.message,
      }
    })
  )
}

function terminalDisposition(
  issues: RunIssue[]
): Exclude<EvaluationDisposition, 'project-failure'> | null
{
  const disposition = issueDisposition(issues)
  return disposition === 'project-failure' ? null : disposition
}

async function evaluateTests(
  project: ProjectIR,
  artifactBytes: Uint8Array,
  options: CandidateEvaluationOptions,
  execute: TestExecutor,
  diagnostics: DiagnosticFailure[],
  reusedTests: readonly EvaluatedTest[] = []
): Promise<{
  tests: EvaluatedTest[]
  failures: NormalizedFailure[]
  issues: RunIssue[]
  disposition: EvaluationDisposition | null
}>
{
  const selected = new Set(options.selectedTestIds)
  const reusedById = new Map(reusedTests.map((test) => [test.id, test]))
  const tests: EvaluatedTest[] = []
  const failures: NormalizedFailure[] = []
  const issues: RunIssue[] = []
  let disposition: EvaluationDisposition | null = null

  for (const spec of options.tests)
  {
    if (!selected.has(spec.id)) continue
    const reused = reusedById.get(spec.id)
    if (reused?.ok)
    {
      tests.push(reused)
      continue
    }
    const diagnosticExpectations =
      spec.baseline.outcome === 'fail'
        ? spec.baseline.failures.filter(
            (expectation) => expectation.kind === 'diagnostic'
          )
        : []
    const oracleDiagnostics = diagnostics.filter((diagnostic) =>
      diagnosticExpectations.some((expectation) =>
        matchesFailureExpectation(expectation, diagnostic)
      )
    )
    const runtimeName = `${spec.id}--${spec.name}`
    let result: TestResult
    try
    {
      result = await execute(
        { ...spec, name: runtimeName, project },
        { ...options.run, artifactBytes }
      )
    }
    catch (error)
    {
      const issue = {
        code: 'eval.test.executor-threw',
        kind: 'internal' as const,
        responsibility: 'infrastructure' as const,
        message: `test ${spec.id} executor failed: ${unknownErrorMessage(error)}`,
      }
      result = {
        name: runtimeName,
        ok: false,
        runtime: 'unavailable',
        snapshots: [],
        asserts: [],
        visual: [],
        screenshots: [],
        video: null,
        model: null,
        issues: [{ lane: 'vm', issue }],
        errors: runIssueMessages([issue]),
      }
    }
    const testIssues = result.issues.map((tagged) => tagged.issue)
    const projectRunFailures = result.issues
      .filter((tagged) => tagged.issue.responsibility === 'project')
      .map((tagged) => runIssueFailure(spec.id, tagged))
    const evidenceFailures: NormalizedFailure[] = [
      ...oracleDiagnostics,
      ...projectRunFailures,
      ...result.asserts
        .filter((entry) => !entry.ok)
        .map((entry) => assertionFailure(spec.id, entry)),
      ...modelFailures(spec.id, result),
      ...result.visual
        .filter((entry) => !entry.ok)
        .map((entry) => visualFailure(spec.id, entry)),
    ]
    if (
      !result.ok &&
      testIssues.length === 0 &&
      evidenceFailures.length === 0
    )
    {
      testIssues.push({
        code: 'eval.internal.unexplained-test-failure',
        kind: 'internal',
        responsibility: 'infrastructure',
        message: `test ${spec.id} failed without structured evidence`,
      })
    }
    const terminal = terminalDisposition(testIssues)
    const testFailures = terminal ? [] : evidenceFailures
    tests.push({
      id: spec.id,
      name: spec.name,
      role: spec.role,
      ok: result.ok && testFailures.length === 0 && testIssues.length === 0,
      failures: testFailures,
      evidenceFailures,
      issues: testIssues,
      result,
    })
    failures.push(...testFailures)
    issues.push(...testIssues)
    if (terminal)
    {
      disposition = terminal
      break
    }
  }
  if (!disposition && failures.length > 0) disposition = 'project-failure'
  return { tests, failures, issues, disposition }
}

function emptyPreflight(): ArtifactPreflight
{
  return {
    ok: false,
    project: null,
    schema: [],
    graph: [],
    static: [],
    diagnosticBaseline: null,
    diagnosticChanges: NO_DIAGNOSTIC_CHANGES,
    failures: [],
    issues: [],
  }
}

async function evaluateCandidateWithPreflight(
  artifactBytes: Uint8Array,
  preflight: ArtifactPreflight,
  options: CandidateEvaluationOptions,
  execute: TestExecutor,
  reusedTests: readonly EvaluatedTest[] = []
): Promise<CandidatePhaseEvaluation>
{
  const definitionIssues = validateRepairTestSpecs(options.tests)
  if (definitionIssues.length === 0)
    definitionIssues.push(...validateSelection(options))
  if (preflight.issues.length > 0)
  {
    return {
      status: 'stopped-infrastructure',
      ok: false,
      phase: options.phase,
      preflight,
      tests: [],
      failures: [],
      issues: preflight.issues,
    }
  }
  if (definitionIssues.length > 0)
  {
    return {
      status: 'case-invalid',
      ok: false,
      phase: options.phase,
      preflight,
      tests: [],
      failures: [],
      issues: definitionIssues,
    }
  }
  if (!preflight.ok || !preflight.project)
  {
    return {
      status: 'preflight-failed',
      ok: false,
      phase: options.phase,
      preflight,
      tests: [],
      failures: preflight.failures,
      issues: [],
    }
  }
  const evaluated = await evaluateTests(
    preflight.project,
    artifactBytes,
    options,
    execute,
    [...preflight.graph, ...preflight.static],
    reusedTests
  )
  return {
    status: evaluated.disposition ?? 'passed',
    ok: evaluated.disposition === null,
    phase: options.phase,
    preflight,
    tests: evaluated.tests,
    failures: evaluated.failures,
    issues: evaluated.issues,
  }
}

function pipelineStopStatus(
  phase: CandidatePhaseEvaluation,
  failed: 'targeted-failed' | 'regression-failed'
): CandidatePipelineEvaluation['status']
{
  if (phase.status === 'project-failure') return failed
  if (phase.status === 'passed') return failed
  return phase.status
}

export async function evaluateCandidate(
  artifactBytes: Uint8Array,
  baseline: DiagnosticBaseline,
  options: CandidatePipelineOptions,
  execute: TestExecutor = runTest
): Promise<CandidatePipelineEvaluation>
{
  const definitionIssues = [
    ...validateRepairTestSpecs(options.tests),
    ...validateDiagnosticOptions(options.diagnostics),
  ]
  if (definitionIssues.length > 0)
  {
    return {
      status: 'case-invalid',
      ok: false,
      preflight: emptyPreflight(),
      targeted: null,
      regression: null,
      failures: [],
      issues: definitionIssues,
    }
  }
  const preflight = await preflightCandidateArtifact(
    artifactBytes,
    baseline,
    options.diagnostics
  )
  if (!preflight.ok)
  {
    const stopped = preflight.issues.length > 0
    return {
      status: stopped ? 'stopped-infrastructure' : 'preflight-failed',
      ok: false,
      preflight,
      targeted: null,
      regression: null,
      failures: preflight.failures,
      issues: preflight.issues,
    }
  }
  const targeted = await evaluateCandidateWithPreflight(
    artifactBytes,
    preflight,
    {
      ...options,
      phase: 'targeted',
      selectedTestIds: targetedTestIds(options.tests),
    },
    execute
  )
  if (!targeted.ok)
  {
    return {
      status: pipelineStopStatus(targeted, 'targeted-failed'),
      ok: false,
      preflight,
      targeted,
      regression: null,
      failures: targeted.failures,
      issues: targeted.issues,
    }
  }
  const regression = await evaluateCandidateWithPreflight(
    artifactBytes,
    preflight,
    {
      ...options,
      phase: 'regression',
      selectedTestIds: regressionTestIds(options.tests),
    },
    execute,
    targeted.tests
  )
  return {
    status: regression.ok
      ? 'passed'
      : pipelineStopStatus(regression, 'regression-failed'),
    ok: regression.ok,
    preflight,
    targeted,
    regression,
    failures: [...targeted.failures, ...regression.failures],
    issues: [...targeted.issues, ...regression.issues],
  }
}

function baselineStatusFromIssues(
  issues: RunIssue[]
): BaselineEvaluation['status'] | null
{
  return terminalDisposition(issues)
}

export async function evaluateBaseline(
  artifactBytes: Uint8Array,
  tests: RepairTestSpec[],
  run: CandidateEvaluationOptions['run'] = {},
  execute: TestExecutor = runTest
): Promise<BaselineEvaluation>
{
  const preflight = await inspectBaselineArtifact(artifactBytes)
  return evaluateBaselineWithPreflight(
    artifactBytes,
    preflight,
    tests,
    run,
    execute
  )
}

export async function evaluateBaselineWithPreflight(
  artifactBytes: Uint8Array,
  preflight: ArtifactPreflight,
  tests: RepairTestSpec[],
  run: CandidateEvaluationOptions['run'] = {},
  execute: TestExecutor = runTest
): Promise<BaselineEvaluation>
{
  const definitionIssues = validateRepairTestSpecs(tests)
  if (preflight.issues.length > 0)
  {
    return {
      status: 'stopped-infrastructure',
      ok: false,
      preflight,
      tests: [],
      failingTestIds: [],
      failures: [],
      issues: preflight.issues,
      mismatches: [],
    }
  }
  if (!preflight.ok || !preflight.project)
  {
    return {
      status: 'baseline-invalid',
      ok: false,
      preflight,
      tests: [],
      failingTestIds: [],
      failures: preflight.failures,
      issues: definitionIssues,
      mismatches: [],
    }
  }
  if (definitionIssues.length > 0)
  {
    return {
      status: 'case-invalid',
      ok: false,
      preflight,
      tests: [],
      failingTestIds: [],
      failures: [],
      issues: definitionIssues,
      mismatches: [],
    }
  }
  const evaluated = await evaluateTests(
    preflight.project,
    artifactBytes,
    {
      tests,
      selectedTestIds: regressionTestIds(tests),
      phase: 'baseline',
      diagnostics: {
        rejectNewGraphAtOrAbove: 'never',
        rejectNewStaticAtOrAbove: 'never',
        allowedNewGraphCodes: [],
        allowedNewStaticCodes: [],
      },
      run,
    },
    execute,
    [...preflight.graph, ...preflight.static]
  )
  const issueStatus = baselineStatusFromIssues(evaluated.issues)
  if (issueStatus)
  {
    return {
      status: issueStatus,
      ok: false,
      preflight,
      tests: evaluated.tests,
      failingTestIds: [],
      failures: [],
      issues: evaluated.issues,
      mismatches: [],
    }
  }
  if (evaluated.failures.length === 0)
  {
    return {
      status: 'already-passing',
      ok: true,
      preflight,
      tests: evaluated.tests,
      failingTestIds: [],
      failures: [],
      issues: [],
      mismatches: [],
    }
  }

  const mismatches: BaselineExpectationMismatch[] = []
  for (const test of evaluated.tests)
  {
    const spec = tests.find((entry) => entry.id === test.id)!
    const expected =
      spec.baseline.outcome === 'fail' ? spec.baseline.failures : []
    const mismatch = matchFailureMultiset(expected, test.failures)
    if (mismatch.missing.length > 0 || mismatch.unexpected.length > 0)
    {
      mismatches.push({ testId: test.id, ...mismatch })
    }
  }
  const failingTestIds = evaluated.tests
    .filter((test) => test.failures.length > 0)
    .map((test) => test.id)
  const expectedFailingIds = targetedTestIds(tests)
  if (
    mismatches.length > 0 ||
    !sameIds(failingTestIds, expectedFailingIds) ||
    failingTestIds.length === 0
  )
  {
    return {
      status: 'case-invalid',
      ok: false,
      preflight,
      tests: evaluated.tests,
      failingTestIds,
      failures: evaluated.failures,
      issues: evaluated.issues,
      mismatches,
    }
  }
  return {
    status: 'awaiting-proposal',
    ok: true,
    preflight,
    tests: evaluated.tests,
    failingTestIds,
    failures: evaluated.failures,
    issues: evaluated.issues,
    mismatches: [],
  }
}

export function unavailablePreflight(): ArtifactPreflight
{
  return emptyPreflight()
}
