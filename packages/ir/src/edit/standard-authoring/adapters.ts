// packages/ir/src/edit/standard-authoring/adapters.ts
// bind standard compiler & graph validators to existing operation interfaces

import {
  isBlockEntry,
  scratchRecordValue,
  type Block,
  type BlockField,
  type BlockInput,
  type Mutation,
} from '@scratch-agent/sb3'
import type { CuratedEntityResolverV1 } from '../core-blocks/core-block-builder.js'
import type {
  BlockOperationCatalogAdapterV1,
  GraphBlockDescriptorV1,
  GraphInputDescriptorV1,
} from '../graph/block-operations.js'
import type { ScriptOperationCatalogAdapterV1 } from '../graph/script-operations.js'
import type { ProjectIR } from '../../project/project-ir.js'
import type {
  SemanticInputValueV1,
  SemanticReplacementV1,
  SemanticStatementSequenceV1,
} from '../contracts.generated.js'
import {
  StandardBlockLowererV2,
  StandardAuthoringErrorV2,
  type StandardLoweredGraphV2,
} from './lowerer.js'
import {
  validateExistingStandardBlockV2,
  validateStandardClosureV2,
} from './graph-validation.js'
import type {
  StandardAuthoringContextV2,
  StandardLoweringScopeV2,
} from './types.js'
import type { StandardAuthoringDescriptorV2 } from './catalog.js'
import { sensingPropertyPairIssueV1 } from '../semantic-index/sensing-property-policy.js'

function graphDescriptor(
  descriptor: StandardAuthoringDescriptorV2
): GraphBlockDescriptorV1
{
  return {
    opcode: descriptor.opcode,
    category: descriptor.category,
    shape: descriptor.shape,
    acceptsSuccessor: descriptor.context.acceptsSuccessor,
    mustTerminateSequence: descriptor.context.mustTerminateSequence,
    inputs: [
      ...descriptor.requiredInputs.map((x) => ({
        name: x.name,
        connection: x.connection,
        required: true,
      })),
      ...descriptor.optionalInputs.map((x) => ({
        name: x.name,
        connection: x.connection,
        required: false,
      })),
    ],
  }
}

export interface StandardBlockOperationAdapterV2 extends Omit<
  BlockOperationCatalogAdapterV1,
  'lowerStatementSequence' | 'lowerReplacement' | 'lowerInputValue'
>
{
  readonly fieldMutationConsequence: (
    block: Block,
    fieldName: string,
    value: BlockField
  ) => Mutation | undefined
  readonly lowerStatementSequence: (
    project: ProjectIR,
    targetIndex: number,
    sequence: SemanticStatementSequenceV1,
    scope?: StandardLoweringScopeV2
  ) => StandardLoweredGraphV2
  readonly lowerReplacement: (
    project: ProjectIR,
    targetIndex: number,
    replacement: SemanticReplacementV1,
    scope?: StandardLoweringScopeV2
  ) => StandardLoweredGraphV2
  readonly lowerInputValue: (
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    input: GraphInputDescriptorV1,
    value: SemanticInputValueV1,
    currentInput?: BlockInput,
    preservedObscuredShadow?: BlockInput[2],
    scope?: StandardLoweringScopeV2
  ) => ReturnType<typeof adaptInput>
}

function adaptInput(
  lowered: ReturnType<StandardBlockLowererV2['lowerInputValue']>
)
{
  const closure =
    lowered.rootId === null || lowered.tailId === null
      ? null
      : { ...lowered, rootId: lowered.rootId, tailId: lowered.tailId }
  return { ...lowered, closure }
}

function lowerStandardOperation<Value>(lower: () => Value): Value
{
  try
  {
    return lower()
  }
  catch (error)
  {
    if (error instanceof StandardAuthoringErrorV2)
      throw new StandardAuthoringErrorV2('edit.schema_failed', error.message)
    throw error
  }
}

export function createStandardAuthoringGraphAdaptersV2(
  context: StandardAuthoringContextV2 | CuratedEntityResolverV1
): {
  readonly script: ScriptOperationCatalogAdapterV1
  readonly block: StandardBlockOperationAdapterV2
}
{
  const compiler = new StandardBlockLowererV2(context)
  return {
    script: {
      lowerTopLevelRoot: (...args) =>
        lowerStandardOperation(() => compiler.lowerTopLevelRoot(...args)),
      validateExistingClosure: (target, rootId) =>
        validateStandardClosureV2(target.blocks, rootId),
    },
    block: {
      disposeObsoleteGeneratedInputShadows: true,
      validateEditedBlock: (project, targetIndex, blockId, stagedTarget) =>
      {
        const block = scratchRecordValue(stagedTarget.blocks, blockId)
        if (!isBlockEntry(block)) return
        const owner =
          block.opcode === 'sensing_of'
            ? block
            : block.opcode === 'sensing_of_object_menu' &&
                typeof block.parent === 'string'
              ? scratchRecordValue(stagedTarget.blocks, block.parent)
              : undefined
        if (!isBlockEntry(owner) || owner.opcode !== 'sensing_of') return
        const json = {
          ...project.json,
          targets: project.json.targets.map((target, index) =>
            index === targetIndex ? stagedTarget : target
          ),
        }
        const issue = sensingPropertyPairIssueV1(json, targetIndex, owner)
        if (issue)
          throw new StandardAuthoringErrorV2('edit.project_constraint', issue)
      },
      validateExistingBlock: (block) =>
      {
        const validation = validateExistingStandardBlockV2(block)
        return {
          ...validation,
          descriptor:
            validation.descriptor === null
              ? null
              : graphDescriptor(validation.descriptor),
        }
      },
      lowerStatementSequence: (...args) =>
        lowerStandardOperation(() => compiler.lowerStatementSequence(...args)),
      lowerReplacement: (...args) =>
        lowerStandardOperation(() => compiler.lowerReplacement(...args)),
      lowerInputValue: (...args) =>
        lowerStandardOperation(() =>
          adaptInput(compiler.lowerInputValue(...args))
        ),
      lowerFieldValue: (...args) =>
        lowerStandardOperation(() => compiler.lowerFieldValue(...args).field),
      fieldMutationConsequence: (block, fieldName, value) =>
        block.opcode === 'control_stop' && fieldName === 'STOP_OPTION'
          ? {
              tagName: 'mutation',
              children: [],
              hasnext: String(value[0] === 'other scripts in sprite'),
            }
          : undefined,
    },
  }
}

export const createStandardOperationAdaptersV2 =
  createStandardAuthoringGraphAdaptersV2
