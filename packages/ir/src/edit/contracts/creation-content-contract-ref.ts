// packages/ir/src/edit/contracts/creation-content-contract-ref.ts
// assert exact internal creation-content contract reference identity

import type { ContractEntityRefV1 } from '../contracts.generated.js'

export function assertSameCreationContentContractRefV1(
  actual: ContractEntityRefV1,
  expected: ContractEntityRefV1,
  message: string
): void
{
  if (
    actual.contractRefKind !== expected.contractRefKind ||
    actual.entityKind !== expected.entityKind ||
    actual.entitySubtype !== expected.entitySubtype ||
    actual.bindingKey !== expected.bindingKey
  )
  {
    throw Object.assign(new Error(message), {
      code: 'edit.unauthorized_change',
    })
  }
}
