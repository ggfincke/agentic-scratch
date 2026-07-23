// packages/repair/src/policy/evidence.ts
// select bounded structured evidence & deterministic escalation levels

import type {
  BaselineEvaluation,
  CandidatePipelineEvaluation,
  DiagnosticFailure,
  EvaluatedTest,
  NormalizedFailure,
} from '@scratch-agent/eval'
import type { LocalizationReport } from '@scratch-agent/localize'
import type { VmStateSnapshot } from '@scratch-agent/runner'

import type {
  AttemptRecord,
  EvidenceBundle,
  EvidenceProgression,
  EvidenceScreenshot,
  EvidenceSnapshotDelta,
  EvidenceValueChange,
  PriorAttemptSummary,
} from './contracts.js'
import { compareText } from '../internal/compare-text.js'
import type { EvidenceLevel, RepairPolicy } from './policy.js'
import type { RepairCase } from '../benchmark/repair-case.js'

type Evaluation = BaselineEvaluation | CandidatePipelineEvaluation

const MAX_SNAPSHOT_DELTAS = 16
const MAX_CHANGES_PER_SNAPSHOT = 64
const MAX_SCALAR_CODE_POINTS = 160

function capScalar(value: unknown): unknown
{
  if (typeof value !== 'string') return value
  const points = [...value]
  return points.length > MAX_SCALAR_CODE_POINTS
    ? `${points.slice(0, MAX_SCALAR_CODE_POINTS).join('')}...`
    : value
}

function snapshotProjection(snapshot: VmStateSnapshot): object
{
  return {
    tick: snapshot.tick,
    variables: snapshot.variables,
    lists: snapshot.lists,
    answer: snapshot.answer,
    timer: snapshot.timer,
    stage: snapshot.stage,
    targets: Object.fromEntries(
      Object.entries(snapshot.targets)
        .sort(([a], [b]) => compareText(a, b))
        .map(([name, target]) => [
          name,
          {
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
          },
        ])
    ),
  }
}

function diffValues(
  before: unknown,
  after: unknown,
  path: string,
  changes: EvidenceValueChange[],
  omitted: { count: number }
): void
{
  if (Object.is(before, after)) return
  if (changes.length >= MAX_CHANGES_PER_SNAPSHOT)
  {
    omitted.count++
    return
  }
  if (
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    Array.isArray(before) === Array.isArray(after)
  )
  {
    if (Array.isArray(before) && Array.isArray(after))
    {
      const length = Math.max(before.length, after.length)
      for (let index = 0; index < length; index++)
      {
        diffValues(
          before[index],
          after[index],
          `${path}/${index}`,
          changes,
          omitted
        )
      }
      return
    }
    const oldRecord = before as Record<string, unknown>
    const newRecord = after as Record<string, unknown>
    const keys = [
      ...new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]),
    ].sort(compareText)
    for (const key of keys)
    {
      diffValues(
        oldRecord[key],
        newRecord[key],
        `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        changes,
        omitted
      )
    }
    return
  }
  changes.push({
    path,
    before: capScalar(before),
    after: capScalar(after),
  })
}

function evaluatedTests(evaluation: Evaluation): Map<string, EvaluatedTest>
{
  const tests =
    'tests' in evaluation
      ? evaluation.tests
      : [
          ...(evaluation.targeted?.tests ?? []),
          ...(evaluation.regression?.tests ?? []),
        ]
  return new Map(tests.map((test) => [test.id, test]))
}

function failureLabels(
  failures: readonly NormalizedFailure[]
): Map<string, Set<string>>
{
  const labels = new Map<string, Set<string>>()
  for (const failure of failures)
  {
    if (failure.kind !== 'assertion' && failure.kind !== 'visual') continue
    const set = labels.get(failure.testId) ?? new Set<string>()
    set.add(failure.snapshot)
    if (failure.probe.on === 'regionChanged') set.add(failure.probe.from)
    labels.set(failure.testId, set)
  }
  return labels
}

function labeledSnapshot(
  test: EvaluatedTest | undefined,
  label: string
): VmStateSnapshot | null
{
  return (
    test?.result.snapshots.find((snapshot) => snapshot.label === label) ?? null
  )
}

function buildSnapshotDeltas(
  previous: Evaluation,
  current: Evaluation,
  failures: readonly NormalizedFailure[]
): EvidenceSnapshotDelta[]
{
  const priorTests = evaluatedTests(previous)
  const currentTests = evaluatedTests(current)
  const deltas: EvidenceSnapshotDelta[] = []
  for (const [testId, labels] of [...failureLabels(failures).entries()].sort(
    ([a], [b]) => compareText(a, b)
  ))
  {
    for (const label of [...labels].sort(compareText))
    {
      if (deltas.length >= MAX_SNAPSHOT_DELTAS) return deltas
      const before = labeledSnapshot(priorTests.get(testId), label)
      const after = labeledSnapshot(currentTests.get(testId), label)
      if (!after) continue
      const changes: EvidenceValueChange[] = []
      const omitted = { count: 0 }
      diffValues(
        before ? snapshotProjection(before) : null,
        snapshotProjection(after),
        '',
        changes,
        omitted
      )
      deltas.push({
        testId,
        snapshot: label,
        previousTick: before?.tick ?? null,
        currentTick: after.tick,
        changes,
        omittedChangeCount: omitted.count,
      })
    }
  }
  return deltas
}

function screenshots(
  evaluation: Evaluation,
  failures: readonly NormalizedFailure[],
  portablePath: (path: string) => string
): EvidenceScreenshot[]
{
  const labels = failureLabels(failures)
  const found: EvidenceScreenshot[] = []
  for (const [testId, test] of evaluatedTests(evaluation))
  {
    const selected = labels.get(testId)
    for (const screenshot of test.result.screenshots)
    {
      if (selected && !selected.has(screenshot.label)) continue
      found.push({
        testId,
        label: screenshot.label,
        tick: screenshot.tick,
        path: portablePath(screenshot.path),
      })
    }
  }
  return found.sort(
    (a, b) =>
      compareText(a.testId, b.testId) ||
      compareText(a.label, b.label) ||
      a.tick - b.tick
  )
}

function uniqueFingerprints(
  failures: readonly NormalizedFailure[]
): Set<string>
{
  return new Set(failures.map((failure) => failure.fingerprint))
}

export function progressEvidence(
  policy: RepairPolicy,
  currentLevel: EvidenceLevel,
  previousFailures: readonly NormalizedFailure[],
  nextFailures: readonly NormalizedFailure[],
  eligibleRuntimeFailure: boolean
): EvidenceProgression
{
  if (!eligibleRuntimeFailure)
  {
    return { level: currentLevel, relocalize: false, reason: 'ineligible' }
  }
  const previous = uniqueFingerprints(previousFailures)
  const next = uniqueFingerprints(nextFailures)
  const introduced = [...next].some((fingerprint) => !previous.has(fingerprint))
  const persisted = [...previous].some((fingerprint) => next.has(fingerprint))
  if (introduced)
  {
    return {
      level: currentLevel,
      relocalize: true,
      reason: persisted ? 'introduced' : 'changed',
    }
  }
  if (persisted && policy.evidence.escalateAfterRepeatedFailure)
  {
    return {
      level: Math.min(
        policy.evidence.maxLevel,
        currentLevel + 1
      ) as EvidenceLevel,
      relocalize: previous.size !== next.size,
      reason: previous.size === next.size ? 'unchanged' : 'persistent',
    }
  }
  return { level: currentLevel, relocalize: false, reason: 'persistent' }
}

export function initialEvidenceLevel(repairCase: RepairCase): EvidenceLevel
{
  const required = repairCase.tests.some(
    (test) => (test.visual?.length ?? 0) > 0
  )
    ? 3
    : repairCase.policy.evidence.initialAgentRequestLevel
  return Math.min(
    repairCase.policy.evidence.maxLevel,
    Math.max(repairCase.policy.evidence.initialAgentRequestLevel, required)
  ) as EvidenceLevel
}

export function buildEvidenceBundle(input: {
  level: EvidenceLevel
  reasons: string[]
  failures: NormalizedFailure[]
  diagnostics: DiagnosticFailure[]
  localization: LocalizationReport
  currentEvaluation: Evaluation
  previousEvaluation: Evaluation | null
  previousAttempt: AttemptRecord | null
  previousAttemptSummary: PriorAttemptSummary | null
  portablePath: (path: string) => string
}): EvidenceBundle
{
  return {
    schemaVersion: 1,
    level: input.level,
    selectedReasons: [...input.reasons],
    level0: {
      failures: structuredClone(input.failures),
      diagnostics: structuredClone(input.diagnostics),
    },
    level1:
      input.level >= 1
        ? { localization: structuredClone(input.localization) }
        : null,
    level2:
      input.level >= 2
        ? {
            snapshotDeltas: input.previousEvaluation
              ? buildSnapshotDeltas(
                  input.previousEvaluation,
                  input.currentEvaluation,
                  input.failures
                )
              : [],
            previousProposal: input.previousAttempt?.proposal
              ? structuredClone(input.previousAttempt.proposal)
              : null,
            previousOutcome: input.previousAttemptSummary
              ? structuredClone(input.previousAttemptSummary)
              : null,
          }
        : null,
    level3:
      input.level >= 3
        ? {
            screenshots: screenshots(
              input.currentEvaluation,
              input.failures,
              input.portablePath
            ),
          }
        : null,
  }
}
