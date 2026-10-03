// packages/edit/src/dispatch/standard-procedure-resolution.ts
// resolve standard procedure calls & parameters in their exact owning closure

import {
  parameterEntityEvidenceSetV1,
  procedureEntityEvidenceSetV1,
  procedureOwnedBlockIdsV1,
  standardProcedureScopeFromRecordV2,
  type ParameterRefV1,
  type ParameterEntityEvidenceV1,
  type ProcedureEntityEvidenceV1,
  type ContractEntityRefV1,
  type ScriptBlockContractEntityResolutionRequestV1,
  type ProcedureRefV1,
  type StandardProcedureScopeV2,
  type StandardResolvedParameterV2,
  type StandardResolvedProcedureV2,
} from '@scratch-agent/ir/edit'

import {
  parameterLineageInV1,
  procedureLineageInV1,
  resolveParameterSelectionV1,
  resolveProcedureSelectionV1,
} from './procedure-authority.js'
import { exactContractRefV1 } from './dispatcher-primitives.js'
import { realizedFutureBindingKeysForLineageV1 } from '../lineage/future-binding-ledger.js'
import type { ProductionOperationContextV1 } from '../transaction/production-transaction.js'

function fail(code: string, message: string): never
{
  throw Object.assign(new Error(message), { code })
}

export function standardProcedureScopeV2(
  context: ProductionOperationContextV1,
  targetIndex: number,
  proccode: string
): StandardProcedureScopeV2
{
  return standardProcedureScopeFromRecordV2(
    context.candidate,
    targetIndex,
    proccode
  )
}

export function standardProcedureScopeForBlockV2(
  context: ProductionOperationContextV1,
  targetIndex: number,
  blockId: string
): StandardProcedureScopeV2 | undefined
{
  const target = context.candidate.json.targets[targetIndex]
  if (!target) return fail('edit.invalid_owner', 'procedure owner is absent')
  const matches = procedureEntityEvidenceSetV1(context.candidate).filter(
    (procedure) =>
      procedure.targetIndex === targetIndex &&
      procedureOwnedBlockIdsV1(target, procedure.definitionBlockId).includes(
        blockId
      )
  )
  if (matches.length > 1)
    return fail('edit.invalid_owner', 'block belongs to multiple procedures')
  return matches.length === 0
    ? undefined
    : standardProcedureScopeV2(context, targetIndex, matches[0]!.proccode)
}

export function standardProcedureResolversV2(
  context: ProductionOperationContextV1,
  targetIndex?: number,
  ownerBlockId?: string
)
{
  return {
    resolveProcedure(request: {
      readonly reference: ProcedureRefV1
      readonly ownerTargetIndex: number
      readonly semanticPath: string
    }): StandardResolvedProcedureV2
    {
      const selected = resolveProcedureSelectionV1(context, request.reference)
      if (selected.current.targetIndex !== request.ownerTargetIndex)
        return fail(
          'edit.invalid_owner',
          `${request.semanticPath} procedure belongs to another target`
        )
      return {
        ...standardProcedureScopeV2(
          context,
          selected.current.targetIndex,
          selected.current.proccode
        ),
        ownerTargetIndex: selected.current.targetIndex,
        semanticLineageSha256: selected.lineageId,
        semanticFingerprintSha256: selected.current.semanticFingerprintSha256,
      }
    },
    resolveParameter(request: {
      readonly reference: ParameterRefV1
      readonly ownerTargetIndex: number
      readonly semanticPath: string
    }): StandardResolvedParameterV2
    {
      const procedures = procedureEntityEvidenceSetV1(context.candidate).filter(
        (procedure) => procedure.targetIndex === request.ownerTargetIndex
      )
      const matches = procedures.flatMap((procedure) =>
      {
        try
        {
          return [
            {
              procedure,
              parameter: resolveParameterSelectionV1(
                context,
                request.reference,
                procedure
              ),
            },
          ]
        }
        catch (error)
        {
          const code = (error as { code?: string }).code
          if (
            code === 'edit.selector_no_match' ||
            code === 'edit.created_result_invalid'
          )
            return []
          throw error
        }
      })
      if (matches.length !== 1)
        return fail(
          'edit.selector_ambiguous',
          `${request.semanticPath} parameter has no unique owning procedure`
        )
      const { procedure, parameter } = matches[0]!
      const scope = standardProcedureScopeV2(
        context,
        procedure.targetIndex,
        procedure.proccode
      )
      const slot = scope.parameters.find(
        (entry) => entry.argumentId === parameter.argumentId
      )
      if (!slot)
        return fail('edit.invalid_shape', 'parameter signature slot is absent')
      const procedureLineage = procedureLineageInV1(
        context.candidate,
        context.activeLineage,
        procedure.targetIndex,
        procedure.proccode
      )
      const lineage = parameterLineageInV1(
        context.activeLineage,
        procedureLineage.lineageId,
        parameter.argumentId
      )
      return {
        ...slot,
        proccode: procedure.proccode,
        ownerTargetIndex: procedure.targetIndex,
        signatureSha256: scope.signatureSha256,
        semanticLineageSha256: lineage.lineageId,
        semanticFingerprintSha256: parameter.semanticFingerprintSha256,
      }
    },
    ...(targetIndex === undefined || ownerBlockId === undefined
      ? {}
      : {
          procedureScope: standardProcedureScopeForBlockV2(
            context,
            targetIndex,
            ownerBlockId
          ),
        }),
  }
}

export function standardProcedureContractRefV2(
  context: ProductionOperationContextV1,
  request: ScriptBlockContractEntityResolutionRequestV1
): ContractEntityRefV1 | undefined
{
  const semantic =
    request.sourceKind === 'semanticReference' ? request.reference : undefined
  if (
    request.sourceKind !== 'rawProcedure' &&
    request.sourceKind !== 'rawParameterReference' &&
    semantic?.entityKind !== 'procedure' &&
    semantic?.entityKind !== 'parameter'
  )
    return undefined
  const isParameter =
    request.sourceKind === 'rawParameterReference' ||
    semantic?.entityKind === 'parameter'
  const kind = isParameter ? 'parameter' : 'procedure'
  const procedures = procedureEntityEvidenceSetV1(context.candidate)
  const parameters = parameterEntityEvidenceSetV1(context.candidate)
  let procedure: ProcedureEntityEvidenceV1 | undefined
  let parameter: ParameterEntityEvidenceV1 | undefined
  if (semantic?.entityKind === 'procedure')
    procedure = resolveProcedureSelectionV1(context, semantic).current
  else if (semantic?.entityKind === 'parameter')
  {
    const resolved = standardProcedureResolversV2(context).resolveParameter({
      reference: semantic,
      ownerTargetIndex: request.ownerTargetIndex,
      semanticPath: request.semanticPath,
    })
    parameter = parameters.find(
      (entry) =>
        entry.targetIndex === resolved.ownerTargetIndex &&
        entry.proccode === resolved.proccode &&
        entry.argumentId === resolved.argumentId
    )
    procedure = procedures.find(
      (entry) =>
        entry.targetIndex === resolved.ownerTargetIndex &&
        entry.proccode === resolved.proccode
    )
  }
  else if (
    request.sourceKind === 'rawProcedure' ||
    request.sourceKind === 'rawParameterReference'
  )
  {
    procedure = procedures.find(
      (entry) =>
        entry.targetIndex === request.ownerTargetIndex &&
        entry.proccode === request.rawProccode
    )
    if (request.sourceKind === 'rawParameterReference')
      parameter = parameters.find(
        (entry) =>
          entry.targetIndex === request.ownerTargetIndex &&
          entry.proccode === request.rawProccode &&
          entry.argumentId === request.rawArgumentId &&
          entry.location.name === request.rawDisplayName
      )
  }
  if (!procedure || (isParameter && !parameter))
    return fail(
      'edit.selector_no_match',
      `${request.semanticPath} procedure entity is absent`
    )
  if (procedure.targetIndex !== request.ownerTargetIndex)
    return fail(
      'edit.invalid_owner',
      `${request.semanticPath} procedure entity belongs to another target`
    )
  const procedureLineage = procedureLineageInV1(
    context.candidate,
    context.activeLineage,
    procedure.targetIndex,
    procedure.proccode
  )
  const lineageId = parameter
    ? parameterLineageInV1(
        context.activeLineage,
        procedureLineage.lineageId,
        parameter.argumentId
      ).lineageId
    : procedureLineage.lineageId
  const selectedProcedure = procedure
  const selectedParameter = parameter
  const source = selectedParameter
    ? parameterEntityEvidenceSetV1(context.source).find(
        (entry) =>
          entry.targetIndex === selectedParameter.targetIndex &&
          entry.proccode === selectedParameter.proccode &&
          entry.argumentId === selectedParameter.argumentId
      )
    : procedureEntityEvidenceSetV1(context.source).find(
        (entry) =>
          entry.targetIndex === selectedProcedure.targetIndex &&
          entry.proccode === selectedProcedure.proccode
      )
  const existing = source
    ? context.contract.entityBindings.flatMap((binding) =>
        binding.bindingKind === 'existing' &&
        binding.entityKind === kind &&
        binding.entitySubtype === 'unspecialized' &&
        binding.expectedMatchCount === 1 &&
        binding.sourceLocationSha256 === source.semanticLocationSha256 &&
        binding.expectedSourceSemanticFingerprint ===
          source.semanticFingerprintSha256 &&
        binding.expectedSourceContextFingerprint ===
          source.contextFingerprintSha256
          ? [binding.bindingKey]
          : []
      )
    : []
  const keys = [
    ...existing,
    ...realizedFutureBindingKeysForLineageV1(
      context.input.changeContractSha256,
      context.contract.entityBindings,
      context.futureBindingLedger,
      lineageId
    ),
  ]
  return exactContractRefV1(
    context,
    keys,
    kind,
    'unspecialized',
    request.semanticPath
  )
}
