// packages/static/src/fragility/analyze-fragility.ts
// deterministic orchestration for isolated fragility results

import type { ProjectJson } from '@scratch-agent/sb3'
import type { ProjectIndex } from '@scratch-agent/validate'

import { PINNED_VM_VERSION, boundaryTableSha256 } from './boundary-model.js'
import {
  FragilityAnalysisBudgetV1,
  FragilityBudgetExceededV1,
} from './analysis-budget.js'
import type {
  FragilityAnalysis,
  FragilityFinding,
  FragilitySignatureId,
} from './fragility-types.js'
import {
  findDeclarationShadowing,
  findStartupWriteRaces,
  findTimingBarrierWaitsBounded,
  findWarpBreaks,
  findWarpProbeRestores,
} from './signatures.js'

export const FRAGILITY_SIGNATURE_IDS: readonly FragilitySignatureId[] = [
  'fragility.warp-break',
  'fragility.startup-write-race',
  'fragility.warp-probe-restore',
  'fragility.timing-barrier-wait',
  'fragility.declaration-shadowing',
]

function compareFindings(
  left: FragilityFinding,
  right: FragilityFinding,
  budget: FragilityAnalysisBudgetV1
): number
{
  budget.work(9)
  const leftKey = [
    left.signature,
    left.targetName,
    left.topBlockId ?? '',
    left.evidence[0]?.blockId ?? '',
  ]
  const rightKey = [
    right.signature,
    right.targetName,
    right.topBlockId ?? '',
    right.evidence[0]?.blockId ?? '',
  ]
  for (let index = 0; index < leftKey.length; index++)
  {
    budget.work()
    const leftPart = leftKey[index]!
    const rightPart = rightKey[index]!
    if (leftPart < rightPart) return -1
    if (leftPart > rightPart) return 1
  }
  return 0
}

export function analyzeFragility(
  json: ProjectJson,
  index: ProjectIndex
): FragilityAnalysis
{
  const budget = new FragilityAnalysisBudgetV1()
  const completed = new Set<FragilitySignatureId>()
  let completion: FragilityAnalysis['completion'] = 'complete'
  let results: FragilityFinding[] = []
  let timingOmitted = 0
  let findings: FragilityFinding[]
  let advisories: FragilityFinding[]
  try
  {
    budget.append(results, findWarpBreaks(json, index, budget))
    completed.add('fragility.warp-break')
    budget.append(results, findStartupWriteRaces(json, index, budget))
    completed.add('fragility.startup-write-race')
    budget.append(results, findWarpProbeRestores(json, index, budget))
    completed.add('fragility.warp-probe-restore')
    const timing = findTimingBarrierWaitsBounded(json, index, undefined, budget)
    budget.append(results, timing.findings)
    timingOmitted = timing.omittedCount
    completed.add('fragility.timing-barrier-wait')
    budget.append(results, findDeclarationShadowing(json, index, budget))
    completed.add('fragility.declaration-shadowing')
    budget.work(results.length)
    findings = results
      .filter((finding) =>
      {
        budget.work()
        return finding.class === 'flagged'
      })
      .sort((left, right) =>
      {
        budget.work()
        return compareFindings(left, right, budget)
      })
    advisories = results
      .filter((finding) =>
      {
        budget.work()
        return finding.class === 'advisory'
      })
      .sort((left, right) =>
      {
        budget.work()
        return compareFindings(left, right, budget)
      })
  }
  catch (error)
  {
    if (!(error instanceof FragilityBudgetExceededV1)) throw error
    completion = 'incomplete'
    budget.projectionWork(budget.partialFindings().length)
    results = [...budget.partialFindings()]
    findings = results.filter((finding) =>
    {
      budget.projectionWork()
      return finding.class === 'flagged'
    })
    advisories = results.filter((finding) =>
    {
      budget.projectionWork()
      return finding.class === 'advisory'
    })
  }
  const omitted =
    completion === 'incomplete'
      ? budget.partialOmitted()
      : { findings: 0, advisories: timingOmitted }
  budget.projectionWork(FRAGILITY_SIGNATURE_IDS.length)
  const coverage = FRAGILITY_SIGNATURE_IDS.map((signature) =>
  {
    budget.projectionWork()
    const counts = budget.signatureCounts(signature)
    return {
      signature,
      ran: completed.has(signature),
      findingCount: counts.count,
      indeterminateCount: counts.indeterminate,
    }
  })
  return {
    completion,
    budget: budget.evidence(),
    findings,
    advisories,
    omitted,
    coverage,
    boundaryModel: {
      pinnedVmVersion: PINNED_VM_VERSION,
      boundaryTableSha256: boundaryTableSha256(),
    },
  }
}
