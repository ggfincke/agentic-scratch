// packages/ir/src/edit/standard-authoring/connection-policy.ts
// share standard expression socket compatibility without changing A0 rules

import type { ProcedureParameterTypeV1 } from '../contracts/procedure-parameter-catalog.js'
import { deepFreeze } from '../support/immutable.js'

export const STANDARD_CONNECTION_POLICY_V2 = deepFreeze({
  schemaVersion: 1,
  boolean: ['boolean'],
  reporter: ['reporter', 'boolean'],
  statement: ['stack', 'cShape', 'cap'],
  eventHat: ['hat'],
})

export function standardShapeFitsPlacementV2(
  shape: string | null | undefined,
  placement?: 'any' | 'statement' | 'reporter' | 'boolean' | 'eventHat'
): boolean
{
  if (shape === undefined || shape === null) return false
  if (placement === undefined || placement === 'any') return true
  return (STANDARD_CONNECTION_POLICY_V2[placement] as readonly string[]).includes(
    shape
  )
}

export function standardProcedureArgumentShapeFitsV2(
  parameterType: ProcedureParameterTypeV1,
  shape: string | null | undefined
): boolean
{
  return standardShapeFitsPlacementV2(
    shape,
    parameterType === 'boolean' ? 'boolean' : 'reporter'
  )
}
