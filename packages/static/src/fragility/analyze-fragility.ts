// packages/static/src/fragility/analyze-fragility.ts
// deterministic orchestration for isolated fragility results

import type { ProjectJson } from '@scratch-agent/sb3'
import type { ProjectIndex } from '@scratch-agent/validate'

import { PINNED_VM_VERSION, boundaryTableSha256 } from './boundary-model.js'
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
  right: FragilityFinding
): number
{
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
  const timingBarriers = findTimingBarrierWaitsBounded(json, index)
  const results = [
    ...findWarpBreaks(json, index),
    ...findStartupWriteRaces(json, index),
    ...findWarpProbeRestores(json, index),
    ...timingBarriers.findings,
    ...findDeclarationShadowing(json, index),
  ]
  const findings = results
    .filter((finding) => finding.class === 'flagged')
    .sort(compareFindings)
  const advisories = results
    .filter((finding) => finding.class === 'advisory')
    .sort(compareFindings)

  return {
    findings,
    advisories,
    omitted: {
      findings: 0,
      advisories: timingBarriers.omittedCount,
    },
    coverage: FRAGILITY_SIGNATURE_IDS.map((signature) =>
    {
      const matching = results.filter(
        (finding) => finding.signature === signature
      )
      return {
        signature,
        ran: true,
        findingCount:
          matching.length +
          (signature === 'fragility.timing-barrier-wait'
            ? timingBarriers.omittedCount
            : 0),
        indeterminateCount: matching.filter(
          (finding) => finding.verdict === 'indeterminate'
        ).length,
      }
    }),
    boundaryModel: {
      pinnedVmVersion: PINNED_VM_VERSION,
      boundaryTableSha256: boundaryTableSha256(),
    },
  }
}
