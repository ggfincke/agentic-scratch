// packages/eval/src/multimodal/multimodal-escalation.ts
// pure deterministic-first evidence selection for bounded VLM escalation

import type {
  DeterministicCriterionResult,
  EvidenceSelectionDecisionV1,
  EvidenceSelectionResult,
} from './multimodal.js'
import { MULTIMODAL_SCHEMA_VERSION } from './multimodal-contracts.js'
import type { CriterionVerdict, RubricSpecV1 } from './rubric.js'

type MultimodalEvidenceReadiness =
  | 'ready'
  | 'missing'
  | 'stale'
  | 'invalid'
  | 'unsupported'
  | 'infrastructure-failure'

export interface MultimodalCriterionEvidenceV1
{
  status: MultimodalEvidenceReadiness
  frameIds: string[]
  clipIds: string[]
}

interface MultimodalEscalationInput
{
  rubric: RubricSpecV1
  mode: 'deterministic' | 'live' | 'replay'
  deterministic: DeterministicCriterionResult[]
  evidenceByCriterion: Record<string, MultimodalCriterionEvidenceV1>
  infrastructureIssues: string[]
}

function resolvedVerdict(
  results: readonly DeterministicCriterionResult[]
): CriterionVerdict | null
{
  if (results.some((result) => result.verdict === 'fail')) return 'fail'
  if (
    results.length > 0 &&
    results.every((result) => result.verdict === 'pass')
  )
    return 'pass'
  return results.length === 0 ? null : 'inconclusive'
}

function unique(values: readonly string[]): string[]
{
  return [...new Set(values)]
}

function readinessReason(status: MultimodalEvidenceReadiness): string
{
  if (status === 'missing') return 'required evidence is missing'
  if (status === 'stale') return 'required evidence is stale'
  if (status === 'invalid') return 'required evidence is invalid'
  if (status === 'unsupported') return 'required evidence is unsupported'
  if (status === 'infrastructure-failure')
    return 'required evidence has an infrastructure failure'
  return 'required deterministic evidence is unresolved'
}

function decision(
  criterionId: string,
  value: EvidenceSelectionDecisionV1['decision'],
  reason: string
): EvidenceSelectionDecisionV1
{
  return { criterionId, decision: value, reason }
}

export function selectMultimodalEvidence(
  input: MultimodalEscalationInput
): EvidenceSelectionResult
{
  const rubricById = new Map(
    input.rubric.criteria.map((criterion) => [criterion.id, criterion])
  )
  for (const criterionId of Object.keys(input.evidenceByCriterion))
  {
    if (!rubricById.has(criterionId))
      throw new Error(`unknown evidence criterion ${criterionId}`)
    const evidence = input.evidenceByCriterion[criterionId]!
    if (
      ![
        'ready',
        'missing',
        'stale',
        'invalid',
        'unsupported',
        'infrastructure-failure',
      ].includes(evidence.status)
    )
      throw new Error(`unknown evidence readiness for ${criterionId}`)
    if (
      new Set(evidence.frameIds).size !== evidence.frameIds.length ||
      new Set(evidence.clipIds).size !== evidence.clipIds.length
    )
      throw new Error(`duplicate evidence identity for ${criterionId}`)
    if (
      evidence.frameIds.some((frameId) => frameId.length === 0) ||
      evidence.clipIds.some((clipId) => clipId.length === 0)
    )
      throw new Error(`empty evidence identity for ${criterionId}`)
    if (evidence.status === 'ready' && evidence.frameIds.length === 0)
      throw new Error(`ready evidence has no frames for ${criterionId}`)
    if (
      evidence.status !== 'ready' &&
      (evidence.frameIds.length > 0 || evidence.clipIds.length > 0)
    )
      throw new Error(`unready evidence retains artifacts for ${criterionId}`)
  }
  const deterministicById = new Map<string, DeterministicCriterionResult[]>()
  for (const result of input.deterministic)
  {
    const criterion = rubricById.get(result.criterionId)
    if (!criterion)
      throw new Error(`unknown deterministic criterion ${result.criterionId}`)
    if (result.required !== (criterion.requirement === 'required'))
      throw new Error(
        `deterministic requirement mismatch for ${result.criterionId}`
      )
    const current = deterministicById.get(result.criterionId) ?? []
    current.push(result)
    deterministicById.set(result.criterionId, current)
  }

  const requiredFailure = input.rubric.criteria.some(
    (criterion) =>
      criterion.requirement === 'required' &&
      resolvedVerdict(deterministicById.get(criterion.id) ?? []) === 'fail'
  )
  const infrastructureStop = input.infrastructureIssues.length > 0
  const decisions: EvidenceSelectionDecisionV1[] = []
  const vlmCriterionIds: string[] = []
  const selectedFrameIds: string[] = []
  const selectedClipIds: string[] = []
  const keyframeFrameIds: string[] = []
  const vlmFrameIds: string[] = []
  const vlmClipIds: string[] = []
  const vlmEvidenceByCriterion: EvidenceSelectionResult['vlmEvidenceByCriterion'] =
    []
  let firstStopReason: string | null = null

  for (const criterion of input.rubric.criteria)
  {
    const current = deterministicById.get(criterion.id) ?? []
    const verdict = resolvedVerdict(current)
    if (verdict === 'fail')
    {
      decisions.push(
        decision(
          criterion.id,
          'deterministic-fail',
          'host-owned deterministic evidence failed the criterion'
        )
      )
      continue
    }
    if (verdict === 'pass')
    {
      decisions.push(
        decision(
          criterion.id,
          'deterministic-pass',
          'host-owned deterministic evidence passed the criterion'
        )
      )
      continue
    }
    if (infrastructureStop || requiredFailure)
    {
      const reason = infrastructureStop
        ? 'evaluation infrastructure failed before escalation'
        : 'a required deterministic criterion failed'
      decisions.push(decision(criterion.id, 'stop-inconclusive', reason))
      firstStopReason ??= reason
      continue
    }

    if (criterion.evidenceKind === 'keyframe')
    {
      const evidence = input.evidenceByCriterion[criterion.id]
      if (evidence?.status === 'ready')
      {
        decisions.push(
          decision(
            criterion.id,
            'use-keyframe',
            'keyframe criteria require host-owned rendered evaluation'
          )
        )
        selectedFrameIds.push(...evidence.frameIds)
        keyframeFrameIds.push(...evidence.frameIds)
        firstStopReason ??= 'deterministic keyframe evaluation is unresolved'
      }
      else
      {
        const reason = readinessReason(evidence?.status ?? 'missing')
        decisions.push(decision(criterion.id, 'stop-inconclusive', reason))
        firstStopReason ??= reason
      }
      continue
    }

    const evidence = input.evidenceByCriterion[criterion.id]
    if (!evidence || evidence.status !== 'ready')
    {
      const reason = readinessReason(evidence?.status ?? 'missing')
      decisions.push(decision(criterion.id, 'stop-inconclusive', reason))
      firstStopReason ??= reason
      continue
    }
    if (criterion.requirement !== 'required')
    {
      const reason = 'advisory-only uncertainty does not justify a VLM call'
      decisions.push(decision(criterion.id, 'stop-inconclusive', reason))
      firstStopReason ??= reason
      continue
    }
    if (input.mode === 'deterministic')
    {
      const reason = 'deterministic mode does not permit VLM escalation'
      decisions.push(decision(criterion.id, 'stop-inconclusive', reason))
      firstStopReason ??= reason
      continue
    }
    decisions.push(
      decision(
        criterion.id,
        'use-vlm',
        'qualitative criterion remains unresolved with admitted evidence'
      )
    )
    vlmCriterionIds.push(criterion.id)
    vlmEvidenceByCriterion.push({
      criterionId: criterion.id,
      frameIds: [...evidence.frameIds],
      clipIds: [...evidence.clipIds],
    })
    selectedFrameIds.push(...evidence.frameIds)
    selectedClipIds.push(...evidence.clipIds)
    vlmFrameIds.push(...evidence.frameIds)
    vlmClipIds.push(...evidence.clipIds)
  }

  const blockingRequiredDecision = decisions.find((current) =>
  {
    const criterion = rubricById.get(current.criterionId)!
    return (
      criterion.requirement === 'required' &&
      (current.decision === 'stop-inconclusive' ||
        current.decision === 'use-keyframe')
    )
  })
  const escalationCannotChangeVerdict =
    blockingRequiredDecision !== undefined && vlmCriterionIds.length > 0
  const blockingReason =
    blockingRequiredDecision?.decision === 'use-keyframe'
      ? 'required deterministic keyframe evaluation is unresolved'
      : (blockingRequiredDecision?.reason ?? null)
  const finalDecisions = escalationCannotChangeVerdict
    ? decisions.map((current) =>
        current.decision === 'use-vlm'
          ? decision(
              current.criterionId,
              'stop-inconclusive',
              `VLM escalation cannot change the final verdict: ${blockingReason}`
            )
          : current
      )
    : decisions

  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    decisions: finalDecisions,
    selectedFrameIds: escalationCannotChangeVerdict
      ? unique(keyframeFrameIds)
      : unique(selectedFrameIds),
    selectedClipIds: escalationCannotChangeVerdict
      ? []
      : unique(selectedClipIds),
    vlmFrameIds: escalationCannotChangeVerdict ? [] : unique(vlmFrameIds),
    vlmClipIds: escalationCannotChangeVerdict ? [] : unique(vlmClipIds),
    vlmEvidenceByCriterion: escalationCannotChangeVerdict
      ? []
      : vlmEvidenceByCriterion,
    vlmCriterionIds: escalationCannotChangeVerdict ? [] : vlmCriterionIds,
    stopReason: escalationCannotChangeVerdict
      ? blockingReason
      : vlmCriterionIds.length > 0
        ? null
        : infrastructureStop
          ? input.infrastructureIssues.join('; ')
          : requiredFailure
            ? 'a required deterministic criterion failed'
            : firstStopReason,
  }
}
