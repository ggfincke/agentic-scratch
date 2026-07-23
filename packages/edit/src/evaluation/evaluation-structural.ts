// packages/edit/src/evaluation/evaluation-structural.ts
// rederive required structural objective rows from exact revision authorization

import type { EditStructuralObjectiveObservationV1 } from '@scratch-agent/eval'
import type { EditSemanticChangeContractV1 } from '@scratch-agent/ir/edit'

import { editCanonicalSha256V1 } from '../support/canonical.js'

interface RetainedStructuralObjectiveV1
{
  readonly objectiveId: string
  readonly predicateSha256: string
  readonly status: 'satisfied' | 'pending'
}

function retainedRows(
  value: unknown
): readonly RetainedStructuralObjectiveV1[]
{
  if (value === null || typeof value !== 'object') return []
  const authorization = (value as Record<string, unknown>)[
    'contractAuthorization'
  ]
  if (authorization === null || typeof authorization !== 'object') return []
  const evidence = (authorization as Record<string, unknown>)[
    'requiredObjectiveEvidence'
  ]
  if (!Array.isArray(evidence)) return []
  return evidence.flatMap((entry) =>
  {
    if (entry === null || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return typeof row['objectiveId'] === 'string' &&
      typeof row['predicateSha256'] === 'string' &&
      (row['status'] === 'satisfied' || row['status'] === 'pending')
      ? [
          {
            objectiveId: row['objectiveId'],
            predicateSha256: row['predicateSha256'],
            status: row['status'],
          },
        ]
      : []
  })
}

export function structuralObjectiveObservationsV1(
  contract: EditSemanticChangeContractV1,
  revisionAuthorization: unknown
): readonly EditStructuralObjectiveObservationV1[]
{
  const retained = retainedRows(revisionAuthorization)
  return Object.freeze(
    contract.requiredStructuralChanges.map((predicate) =>
    {
      const predicateSha256 = editCanonicalSha256V1(predicate)
      const matches = retained.filter(
        (entry) =>
          entry.objectiveId === predicate.objectiveId &&
          entry.predicateSha256 === predicateSha256
      )
      return Object.freeze({
        objectiveId: predicate.objectiveId,
        predicateSha256,
        status:
          matches.length === 1 && matches[0]!.status === 'satisfied'
            ? ('satisfied' as const)
            : ('pending' as const),
      })
    })
  )
}
