// packages/ir/src/edit/standard-authoring/types.ts
// bind procedure construction to explicit owner, signature & parameter scopes

import type {
  ParameterRefV1,
  ProcedureRefV1,
  ScratchScalarV1,
} from '../contracts.generated.js'
import type { CuratedEntityResolverV1 } from '../core-blocks/core-block-builder.js'
import type { ProcedureParameterTypeV1 } from '../contracts/procedure-parameter-catalog.js'

export interface StandardProcedureParameterV2
{
  readonly localKey: string
  readonly argumentId: string
  readonly name: string
  readonly parameterType: ProcedureParameterTypeV1
  readonly defaultValue: ScratchScalarV1
}

export interface StandardProcedureScopeV2
{
  readonly proccode: string
  readonly signatureSha256: string
  readonly warp: boolean
  readonly parameters: readonly StandardProcedureParameterV2[]
}

export interface StandardResolvedProcedureV2 extends StandardProcedureScopeV2
{
  readonly ownerTargetIndex: number
  readonly semanticLineageSha256: string
  readonly semanticFingerprintSha256: string
}

export interface StandardResolvedParameterV2 extends StandardProcedureParameterV2
{
  readonly proccode: string
  readonly ownerTargetIndex: number
  readonly signatureSha256: string
  readonly semanticLineageSha256: string
  readonly semanticFingerprintSha256: string
}

export interface StandardAuthoringContextV2
{
  readonly resolveEntity: CuratedEntityResolverV1
  readonly resolveProcedure?: (request: {
    readonly reference: ProcedureRefV1
    readonly ownerTargetIndex: number
    readonly semanticPath: string
  }) => StandardResolvedProcedureV2
  readonly resolveParameter?: (request: {
    readonly reference: ParameterRefV1
    readonly ownerTargetIndex: number
    readonly semanticPath: string
  }) => StandardResolvedParameterV2
  readonly procedureScope?: StandardProcedureScopeV2
}

export interface StandardLoweringScopeV2
{
  readonly procedureScope?: StandardProcedureScopeV2
}
