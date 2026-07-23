// packages/ir/src/edit/core-block-operation-adapters.ts
// bind one curated catalog/lowerer to script & block graph operation adapters

import type { Block, BlockField, BlockInput } from '@scratch-agent/sb3'

import type { ProjectIR } from '../project/project-ir.js'
import type {
  BlockOperationCatalogAdapterV1,
  ExistingGraphBlockEvidenceV1,
  GraphBlockDescriptorV1,
  GraphInputDescriptorV1,
  LoweredSemanticInputV1,
} from './block-operations.js'
import {
  CuratedCoreBlockBuilderError,
  CuratedCoreBlockLowererV1,
  type CuratedEntityResolverV1,
  type CuratedLoweredInputValueV1,
} from './core-block-builder.js'
import {
  curatedAuthorableDescriptorV1,
  validateCuratedClosureV1,
  validateExistingCuratedBlockV1,
} from './core-block-catalog.js'
import type {
  SemanticFieldValueV1,
  SemanticInputValueV1,
  SemanticReplacementV1,
  SemanticStatementSequenceV1,
  TopLevelScriptRootV1,
} from './contracts.generated.js'
import type { GraphInstalledClosureV1 } from './graph-primitives.js'
import type {
  CuratedExistingClosureEvidenceV1,
  ScriptOperationCatalogAdapterV1,
} from './script-operations.js'

interface CuratedLoweredSemanticInputAdapterV1 extends LoweredSemanticInputV1
{
  readonly catalogEvidence: CuratedLoweredInputValueV1['catalogEvidence']
  readonly resolvedEntityReadEvidence: CuratedLoweredInputValueV1['resolvedEntityReadEvidence']
  readonly allocatorEvidence: CuratedLoweredInputValueV1['allocatorEvidence']
}

interface CuratedBlockOperationCatalogAdapterV1 extends Omit<
  BlockOperationCatalogAdapterV1,
  'lowerInputValue'
>
{
  readonly lowerInputValue: (
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    input: GraphInputDescriptorV1,
    value: SemanticInputValueV1,
    currentInput: BlockInput | undefined,
    preservedObscuredShadow: BlockInput[2] | undefined
  ) => CuratedLoweredSemanticInputAdapterV1
}

interface CuratedCoreOperationAdaptersV1
{
  readonly script: ScriptOperationCatalogAdapterV1
  readonly block: CuratedBlockOperationCatalogAdapterV1
}

function graphDescriptor(
  descriptor: NonNullable<ReturnType<typeof curatedAuthorableDescriptorV1>>
): GraphBlockDescriptorV1
{
  return {
    opcode: descriptor.opcode,
    shape: descriptor.shape,
    category: descriptor.category,
    acceptsSuccessor: descriptor.context.acceptsSuccessor,
    mustTerminateSequence: descriptor.context.mustTerminateSequence,
    inputs: [
      ...descriptor.requiredInputs.map((input) => ({
        name: input.name,
        required: true,
        connection: input.connection,
      })),
      ...descriptor.optionalInputs.map((input) => ({
        name: input.name,
        required: false,
        connection: input.connection,
      })),
    ],
  }
}

function validateBlock(block: Block): ExistingGraphBlockEvidenceV1
{
  const validation = validateExistingCuratedBlockV1(block)
  const descriptor =
    validation.descriptor === null
      ? null
      : curatedAuthorableDescriptorV1(validation.descriptor.opcode)
  return {
    ok: validation.ok && descriptor !== null,
    safeForStructuralEdit:
      validation.safeForStructuralEdit && descriptor !== null,
    descriptor: descriptor === null ? null : graphDescriptor(descriptor),
    issues: validation.issues,
  }
}

function exactInputDescriptor(
  project: ProjectIR,
  targetIndex: number,
  ownerBlockId: string,
  input: GraphInputDescriptorV1
): void
{
  const owner = project.json.targets[targetIndex]?.blocks[ownerBlockId]
  if (owner === undefined || Array.isArray(owner))
    throw new CuratedCoreBlockBuilderError(
      'invalid-input',
      `owner block ${ownerBlockId} is absent`
    )
  const descriptor = curatedAuthorableDescriptorV1(owner.opcode)
  if (descriptor === null)
    throw new CuratedCoreBlockBuilderError(
      'unsupported-opcode',
      `${owner.opcode} is not authorable`
    )
  const required = descriptor.requiredInputs.find(
    (entry) => entry.name === input.name
  )
  const optional = descriptor.optionalInputs.find(
    (entry) => entry.name === input.name
  )
  const exact = required ?? optional
  if (
    exact === undefined ||
    exact.connection !== input.connection ||
    input.required !== (required !== undefined)
  )
  {
    throw new CuratedCoreBlockBuilderError(
      'invalid-input',
      `${owner.opcode}.${input.name} adapter descriptor differs from the catalog`
    )
  }
}

export function createCuratedCoreOperationAdaptersV1(
  resolveEntity: CuratedEntityResolverV1
): CuratedCoreOperationAdaptersV1
{
  const lowerer = new CuratedCoreBlockLowererV1(resolveEntity)
  const script: ScriptOperationCatalogAdapterV1 = {
    lowerTopLevelRoot: (
      project: ProjectIR,
      targetIndex: number,
      root: TopLevelScriptRootV1,
      workspace: { readonly x: number; readonly y: number }
    ): GraphInstalledClosureV1 =>
      lowerer.lowerTopLevelRoot(project, targetIndex, root, workspace),
    validateExistingClosure: (
      target,
      rootBlockId
    ): CuratedExistingClosureEvidenceV1 =>
      validateCuratedClosureV1(target.blocks, rootBlockId),
  }
  const block: CuratedBlockOperationCatalogAdapterV1 = {
    validateExistingBlock: validateBlock,
    lowerStatementSequence: (
      project: ProjectIR,
      targetIndex: number,
      sequence: SemanticStatementSequenceV1
    ): GraphInstalledClosureV1 =>
      lowerer.lowerStatementSequence(project, targetIndex, sequence),
    lowerReplacement: (
      project: ProjectIR,
      targetIndex: number,
      replacement: SemanticReplacementV1
    ): GraphInstalledClosureV1 =>
      lowerer.lowerReplacement(project, targetIndex, replacement),
    lowerInputValue: (
      project: ProjectIR,
      targetIndex: number,
      ownerBlockId: string,
      input: GraphInputDescriptorV1,
      value: SemanticInputValueV1,
      currentInput: BlockInput | undefined,
      preservedObscuredShadow: BlockInput[2] | undefined
    ): CuratedLoweredSemanticInputAdapterV1 =>
    {
      exactInputDescriptor(project, targetIndex, ownerBlockId, input)
      const lowered = lowerer.lowerInputValue(
        project,
        targetIndex,
        ownerBlockId,
        input,
        value,
        currentInput,
        preservedObscuredShadow
      )
      if ((lowered.rootId === null) !== (lowered.tailId === null))
        throw new CuratedCoreBlockBuilderError(
          'invalid-shape',
          'lowered input root and tail presence disagree'
        )
      const closure: GraphInstalledClosureV1 | null =
        lowered.rootId === null || lowered.tailId === null
          ? null
          : {
              rootId: lowered.rootId,
              tailId: lowered.tailId,
              blocks: lowered.blocks,
              blockIds: lowered.blockIds,
              aliasBlockIds: lowered.aliasBlockIds,
              creationKeyByBlockId: lowered.creationKeyByBlockId,
              allocatorEvidence: lowered.allocatorEvidence,
              allocatorCandidate: lowered.allocatorCandidate,
            }
      return {
        input: lowered.input,
        closure,
        catalogEvidence: lowered.catalogEvidence,
        resolvedEntityReadEvidence: lowered.resolvedEntityReadEvidence,
        allocatorEvidence: lowered.allocatorEvidence,
      }
    },
    lowerFieldValue: (
      project: ProjectIR,
      targetIndex: number,
      ownerBlockId: string,
      fieldName: string,
      value: SemanticFieldValueV1
    ): BlockField =>
      lowerer.lowerFieldValue(
        project,
        targetIndex,
        ownerBlockId,
        fieldName,
        value
      ).field,
  }
  return { script, block }
}
