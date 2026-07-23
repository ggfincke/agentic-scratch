// packages/edit/src/lineage/occurrence-hash.ts
// internal operation-occurrence hash projection

import { semanticHashV1 } from '@scratch-agent/ir/edit'

export function operationOccurrenceIdHashV1(
  predecessorAcceptedHistorySha256: string,
  opId: string
): string
{
  return semanticHashV1('resolved-plan', {
    kind: 'edit-operation-occurrence',
    schemaVersion: 1,
    predecessorAcceptedHistorySha256,
    opId,
  })
}
