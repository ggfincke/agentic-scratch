// packages/ir/src/edit/semantic-index/standard-name-policy.ts
// retain conservative name checks while recognizing validated standard extensions

import { scratchRecordValue, type ProjectJson } from '@scratch-agent/sb3'
import type { SemanticAuthoringAuthorityIdV2 } from '../contracts/authority-selection.js'
import { unknownNameSemanticsEvidenceV1 } from './name-semantics-catalog.js'
import { validateExistingStandardBlockV2 } from '../standard-authoring/index.js'

const STANDARD_EXTENSIONS = new Set(['pen', 'music', 'videoSensing'])

export function unknownNameSemanticsForAuthorityV2(
  project: ProjectJson,
  authorityId: SemanticAuthoringAuthorityIdV2 = 'a0-v1'
): ReturnType<typeof unknownNameSemanticsEvidenceV1>
{
  const evidence = unknownNameSemanticsEvidenceV1(project)
  if (authorityId === 'a0-v1') return evidence
  if (authorityId !== 'standard-v2')
    throw new TypeError('unknown authoring authority')
  return Object.freeze({
    declaredExtensions: Object.freeze(
      evidence.declaredExtensions.filter((id) => !STANDARD_EXTENSIONS.has(id))
    ),
    unknownOpcodes: Object.freeze(
      evidence.unknownOpcodes.filter((row) =>
      {
        const target = project.targets[row.targetIndex]
        const block = target && scratchRecordValue(target.blocks, row.blockId)
        if (!target || !block || Array.isArray(block)) return true
        const extension = block.opcode.split('_')[0]!
        return (
          !STANDARD_EXTENSIONS.has(extension) ||
          !validateExistingStandardBlockV2(block).ok
        )
      })
    ),
    surfaceIssues: evidence.surfaceIssues,
  })
}
