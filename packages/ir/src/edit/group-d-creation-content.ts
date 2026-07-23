// packages/ir/src/edit/group-d-creation-content.ts
// derive authoritative Group D future-result semantic creation content

import {
  isBlockEntry,
  scratchRecordValue,
  type Block,
  type BlockField,
  type BlockInput,
  type InputPrimitive,
} from '@scratch-agent/sb3'

import type { ProjectIR } from '../project/project-ir.js'
import type {
  ContractEntityBindingV1,
  ContractEntityRefV1,
  DeclarationRefV1,
  MediaRefV1,
  OrdinarySemanticBlockTreeV1,
  SemanticBlockTreeV1,
  SemanticEditOperationBlockInsertAfterV1,
  SemanticEditOperationBlockInsertBeforeV1,
  SemanticEditOperationBlockInsertSubstackV1,
  SemanticEditOperationBlockMoveV1,
  SemanticEditOperationBlockRemoveV1,
  SemanticEditOperationBlockReplaceV1,
  SemanticEditOperationBlockSetInputV1,
  SemanticEditOperationScriptAddV1,
  SemanticEditOperationScriptDuplicateV1,
  SemanticExpressionBlockTreeV1,
  SemanticFieldValueV1,
  SemanticInputValueV1,
  SemanticReplacementV1,
  SemanticStatementSequenceV1,
  TargetRefV1,
  TopLevelScriptRootV1,
} from './contracts.generated.js'
import { assertSameCreationContentContractRefV1 as assertSameContractRef } from './creation-content-contract-ref.js'
import {
  curatedAuthorableDescriptorV1,
  validateCuratedClosureV1,
  validateExistingCuratedBlockV1,
  type CuratedCoreBlockDescriptorV1,
} from './core-block-catalog.js'
import { planGraphClosureV1 } from './graph-primitives.js'
import { semanticHashV1 } from './hash-domains.js'

import type { Without } from './internal-types.js'

type GroupDFutureContractBindingV1 = Extract<
  ContractEntityBindingV1,
  {
    bindingKind: 'future'
    entityKind: 'script' | 'block'
  }
>

export type GroupDCreationBindingDescriptorV1 = Without<
  GroupDFutureContractBindingV1,
  'bindingKey' | 'expectedCreationContentFingerprintSha256'
>

interface GroupDCreationResultRoleV1
{
  readonly roleKind: 'fixed' | 'dynamic'
  readonly name:
    | 'script'
    | 'destinationScript'
    | 'rootBlock'
    | 'sourceGapRootBlock'
    | 'blockAlias'
    | 'cloneAlias'
  readonly alias?: string
}

export type GroupDCreationOperationV1 =
  | SemanticEditOperationScriptAddV1
  | SemanticEditOperationScriptDuplicateV1
  | SemanticEditOperationBlockInsertBeforeV1
  | SemanticEditOperationBlockInsertAfterV1
  | SemanticEditOperationBlockInsertSubstackV1
  | SemanticEditOperationBlockReplaceV1
  | SemanticEditOperationBlockMoveV1
  | SemanticEditOperationBlockRemoveV1
  | SemanticEditOperationBlockSetInputV1

interface GroupDSelectedCreationSourceV1
{
  readonly scriptTopBlockId?: string
  readonly blockId?: string
}

type SemanticExternalReferenceV1 = TargetRefV1 | DeclarationRefV1 | MediaRefV1

interface GroupDContractReferenceExpectationV1
{
  readonly expectedEntityKind:
    'target' | 'declaration' | 'script' | 'media' | 'procedure'
  readonly expectedEntitySubtype:
    | 'stage'
    | 'sprite'
    | 'variable'
    | 'list'
    | 'broadcast'
    | 'unspecialized'
    | 'costume'
    | 'sound'
  readonly referenceDomain: string
  readonly ownerTargetIndex: number
  readonly semanticPath: string
}

export type GroupDContractEntityResolutionRequestV1 =
  | (GroupDContractReferenceExpectationV1 & {
      readonly sourceKind: 'semanticReference'
      readonly reference: SemanticExternalReferenceV1
    })
  | (GroupDContractReferenceExpectationV1 & {
      readonly sourceKind: 'rawDeclarationReference'
      readonly rawDeclarationId: string
      readonly rawDisplayName: string
    })
  | (GroupDContractReferenceExpectationV1 & {
      readonly sourceKind: 'rawTarget'
      readonly rawTargetIndex: number
      readonly rawDisplayName: string
    })
  | (GroupDContractReferenceExpectationV1 & {
      readonly sourceKind: 'rawScript'
      readonly rawScriptTopBlockId: string
    })
  // a procedure is addressed by its canonical proccode inside one target; the
  // definition/prototype block ids are raw & never part of its identity
  | (GroupDContractReferenceExpectationV1 & {
      readonly sourceKind: 'rawProcedure'
      readonly rawProccode: string
    })

export type GroupDContractEntityRefResolverV1 = (
  request: GroupDContractEntityResolutionRequestV1
) => ContractEntityRefV1

// authored-tree & raw-subtree normalization needs only the owning project, the
// target it is scoped to, & the contract-ref resolver. keeping it off the full
// Group D input lets the procedure family reuse the same canonical normalizers.
export interface SemanticCreationNormalizationContextV1
{
  readonly project: ProjectIR
  readonly targetIndex: number
  readonly resolveContractEntityRef: GroupDContractEntityRefResolverV1
}

interface GroupDCreationContentInputV1 extends SemanticCreationNormalizationContextV1
{
  readonly operation: GroupDCreationOperationV1
  readonly descriptor: GroupDCreationBindingDescriptorV1
  readonly resultRole: GroupDCreationResultRoleV1
  readonly selectedSource: GroupDSelectedCreationSourceV1
}

function invalidCreationContent(message: string): never
{
  throw Object.assign(new Error(message), {
    code: 'edit.unauthorized_change',
  })
}

function target(input: SemanticCreationNormalizationContextV1)
{
  const value = input.project.json.targets[input.targetIndex]
  if (value === undefined)
    return invalidCreationContent('Group D creation target is absent')
  return value
}

function resolveContractRef(
  input: SemanticCreationNormalizationContextV1,
  request: GroupDContractEntityResolutionRequestV1
): ContractEntityRefV1
{
  const resolved = input.resolveContractEntityRef(request)
  if (
    resolved.entityKind !== request.expectedEntityKind ||
    resolved.entitySubtype !== request.expectedEntitySubtype ||
    (resolved.contractRefKind !== 'existing' &&
      resolved.contractRefKind !== 'future') ||
    typeof resolved.bindingKey !== 'string' ||
    resolved.bindingKey.length === 0
  )
  {
    return invalidCreationContent(
      `${request.semanticPath} resolved to an incompatible contract entity reference`
    )
  }
  return {
    contractRefKind: resolved.contractRefKind,
    entityKind: resolved.entityKind,
    entitySubtype: resolved.entitySubtype,
    bindingKey: resolved.bindingKey,
  } as ContractEntityRefV1
}

function expectedEntityKind(
  subtype: string
): GroupDContractReferenceExpectationV1['expectedEntityKind']
{
  if (subtype === 'stage' || subtype === 'sprite') return 'target'
  if (subtype === 'costume' || subtype === 'sound') return 'media'
  return 'declaration'
}

function normalizeSemanticEntityReference(
  input: SemanticCreationNormalizationContextV1,
  reference: SemanticExternalReferenceV1,
  subtype: string | null,
  referenceDomain: string | null,
  semanticPath: string
): ContractEntityRefV1
{
  if (subtype === null || referenceDomain === null)
    return invalidCreationContent(
      `${semanticPath} descriptor lacks an external reference policy`
    )
  return resolveContractRef(input, {
    sourceKind: 'semanticReference',
    reference,
    expectedEntityKind: expectedEntityKind(subtype),
    expectedEntitySubtype:
      subtype as GroupDContractReferenceExpectationV1['expectedEntitySubtype'],
    referenceDomain,
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

function assertDescriptorOwner(
  input: SemanticCreationNormalizationContextV1,
  descriptor: CuratedCoreBlockDescriptorV1,
  semanticPath: string
): void
{
  const ownerKind = target(input).isStage ? 'stage' : 'sprite'
  if (!descriptor.context.ownerTargets.includes(ownerKind))
    invalidCreationContent(
      `${semanticPath} opcode cannot be owned by the selected target`
    )
}

function exactNamedValues<T extends { readonly name: string }>(
  values: readonly T[],
  required: readonly string[],
  optional: readonly string[],
  semanticPath: string
): ReadonlyMap<string, T>
{
  const result = new Map<string, T>()
  for (const value of values)
  {
    if (result.has(value.name))
      invalidCreationContent(`${semanticPath} repeats ${value.name}`)
    result.set(value.name, value)
  }
  const allowed = new Set([...required, ...optional])
  if (
    required.some((name) => !result.has(name)) ||
    [...result.keys()].some((name) => !allowed.has(name))
  )
  {
    invalidCreationContent(`${semanticPath} does not match its descriptor`)
  }
  return result
}

function normalizeSemanticField(
  input: SemanticCreationNormalizationContextV1,
  value: SemanticFieldValueV1,
  descriptorField: CuratedCoreBlockDescriptorV1['requiredFields'][number],
  semanticPath: string
): unknown
{
  if (descriptorField.requiredEntitySubtype !== null)
  {
    if (value.valueKind !== 'entity')
      return invalidCreationContent(`${semanticPath} requires an entity value`)
    return {
      valueKind: 'entity',
      value: normalizeSemanticEntityReference(
        input,
        value.value,
        descriptorField.requiredEntitySubtype,
        descriptorField.referenceDomain,
        semanticPath
      ),
    }
  }
  if (value.valueKind === 'entity')
    return invalidCreationContent(`${semanticPath} forbids an entity value`)
  return value
}

function normalizeSemanticInput(
  input: SemanticCreationNormalizationContextV1,
  value: SemanticInputValueV1,
  descriptorInput: CuratedCoreBlockDescriptorV1['requiredInputs'][number],
  semanticPath: string
): unknown | null
{
  if (value.valueKind === 'empty') return null
  if (descriptorInput.connection === 'entityMenu')
  {
    if (value.valueKind !== 'entity')
      return invalidCreationContent(`${semanticPath} requires an entity value`)
    return {
      valueKind: 'entity',
      value: normalizeSemanticEntityReference(
        input,
        value.value,
        descriptorInput.requiredEntitySubtype,
        descriptorInput.referenceDomain,
        semanticPath
      ),
    }
  }
  if (descriptorInput.connection === 'substack')
  {
    if (value.valueKind !== 'statementSequence')
      return invalidCreationContent(
        `${semanticPath} requires a statement sequence`
      )
    return {
      valueKind: 'statementSequence',
      value: normalizeSemanticSequence(input, value.value, semanticPath),
    }
  }
  if (descriptorInput.connection === 'boolean')
  {
    if (value.valueKind !== 'block')
      return invalidCreationContent(`${semanticPath} requires a Boolean block`)
    return {
      valueKind: 'block',
      value: normalizeSemanticBlock(input, value.value, semanticPath),
    }
  }
  if (value.valueKind === 'block')
  {
    return {
      valueKind: 'block',
      value: normalizeSemanticBlock(input, value.value, semanticPath),
    }
  }
  if (value.valueKind !== 'literal')
    return invalidCreationContent(`${semanticPath} requires a literal or block`)
  if (
    descriptorInput.connection === 'number' &&
    (typeof value.value !== 'number' || !Number.isFinite(value.value))
  )
  {
    return invalidCreationContent(`${semanticPath} requires a finite number`)
  }
  return { valueKind: 'literal', value: value.value }
}

function normalizeSemanticBlock(
  input: SemanticCreationNormalizationContextV1,
  block: SemanticBlockTreeV1,
  semanticPath: string
): unknown
{
  if (block.nodeKind !== 'ordinary')
    return invalidCreationContent(
      `${semanticPath} procedure nodes are outside Group D creation content`
    )
  const descriptor = curatedAuthorableDescriptorV1(block.opcode)
  if (descriptor === null)
    return invalidCreationContent(
      `${semanticPath} opcode is outside the curated authoring catalog`
    )
  assertDescriptorOwner(input, descriptor, semanticPath)
  const fields = exactNamedValues(
    block.fields,
    descriptor.requiredFields.map((field) => field.name),
    descriptor.optionalFields.map((field) => field.name),
    `${semanticPath}/fields`
  )
  const inputs = exactNamedValues(
    block.inputs,
    descriptor.requiredInputs.map((entry) => entry.name),
    descriptor.optionalInputs.map((entry) => entry.name),
    `${semanticPath}/inputs`
  )
  const normalizedFields = [
    ...descriptor.requiredFields,
    ...descriptor.optionalFields,
  ].flatMap((field) =>
  {
    const value = fields.get(field.name)
    return value === undefined
      ? []
      : [
          {
            name: field.name,
            value: normalizeSemanticField(
              input,
              value.value,
              field,
              `${semanticPath}/fields/${field.name}`
            ),
          },
        ]
  })
  const normalizedInputs = [
    ...descriptor.requiredInputs,
    ...descriptor.optionalInputs,
  ].flatMap((descriptorInput) =>
  {
    const value = inputs.get(descriptorInput.name)
    if (value === undefined) return []
    const normalized = normalizeSemanticInput(
      input,
      value.value,
      descriptorInput,
      `${semanticPath}/inputs/${descriptorInput.name}`
    )
    if (normalized === null)
    {
      if (
        descriptor.requiredInputs.some(
          (entry) => entry.name === descriptorInput.name
        )
      )
      {
        invalidCreationContent(
          `${semanticPath}/inputs/${descriptorInput.name} is required`
        )
      }
      return []
    }
    return [{ name: descriptorInput.name, value: normalized }]
  })
  return {
    nodeKind: 'ordinary',
    opcode: descriptor.opcode,
    fields: normalizedFields,
    inputs: normalizedInputs,
  }
}

export function normalizeSemanticSequence(
  input: SemanticCreationNormalizationContextV1,
  sequence: SemanticStatementSequenceV1,
  semanticPath: string
): unknown
{
  if (sequence.blocks.length === 0)
    return invalidCreationContent(`${semanticPath} sequence is empty`)
  const blocks = sequence.blocks.map((block, index) =>
    normalizeSemanticBlock(input, block, `${semanticPath}/blocks/${index}`)
  )
  for (const [index, block] of sequence.blocks.entries())
  {
    if (block.nodeKind !== 'ordinary') continue
    const descriptor = curatedAuthorableDescriptorV1(block.opcode)
    if (
      descriptor?.context.mustTerminateSequence === true &&
      index !== sequence.blocks.length - 1
    )
    {
      invalidCreationContent(`${semanticPath} has a non-final cap block`)
    }
  }
  return { blocks }
}

function normalizeSemanticExpression(
  input: SemanticCreationNormalizationContextV1,
  expression: SemanticExpressionBlockTreeV1,
  semanticPath: string
): unknown
{
  return normalizeSemanticBlock(input, expression, semanticPath)
}

function normalizeSemanticTopLevelRoot(
  input: SemanticCreationNormalizationContextV1,
  root: TopLevelScriptRootV1,
  semanticPath: string
): unknown
{
  if (root.rootKind === 'statementSequence')
  {
    return {
      rootKind: 'statementSequence',
      value: normalizeSemanticSequence(
        input,
        root.value,
        `${semanticPath}/value`
      ),
    }
  }
  if (root.rootKind === 'expression')
  {
    return {
      rootKind: 'expression',
      value: normalizeSemanticExpression(
        input,
        root.value,
        `${semanticPath}/value`
      ),
    }
  }
  return {
    rootKind: 'eventScript',
    hat: normalizeSemanticBlock(input, root.hat, `${semanticPath}/hat`),
    ...(root.body === undefined
      ? {}
      : {
          body: normalizeSemanticSequence(
            input,
            root.body,
            `${semanticPath}/body`
          ),
        }),
  }
}

function visitSemanticAliases(
  block: SemanticBlockTreeV1,
  aliases: Map<string, OrdinarySemanticBlockTreeV1>
): void
{
  if (block.nodeKind !== 'ordinary')
    return invalidCreationContent('procedure aliases are outside Group D')
  if (block.localAlias !== undefined)
  {
    if (aliases.has(block.localAlias))
      invalidCreationContent(`duplicate semantic alias ${block.localAlias}`)
    aliases.set(block.localAlias, block)
  }
  for (const input of block.inputs)
  {
    if (input.value.valueKind === 'block')
      visitSemanticAliases(input.value.value, aliases)
    else if (input.value.valueKind === 'statementSequence')
      for (const child of input.value.value.blocks)
        visitSemanticAliases(child, aliases)
  }
}

function semanticAliases(
  value: unknown
): Map<string, OrdinarySemanticBlockTreeV1>
{
  const aliases = new Map<string, OrdinarySemanticBlockTreeV1>()
  const visitSequence = (sequence: SemanticStatementSequenceV1): void =>
  {
    for (const block of sequence.blocks) visitSemanticAliases(block, aliases)
  }
  const root = value as Partial<TopLevelScriptRootV1>
  if (root.rootKind === 'eventScript' && root.hat)
  {
    visitSemanticAliases(root.hat, aliases)
    if (root.body) visitSequence(root.body)
    return aliases
  }
  if (root.rootKind === 'statementSequence' && root.value)
  {
    visitSequence(root.value as SemanticStatementSequenceV1)
    return aliases
  }
  if (root.rootKind === 'expression' && root.value)
  {
    visitSemanticAliases(root.value as SemanticExpressionBlockTreeV1, aliases)
    return aliases
  }
  const sequence = value as Partial<SemanticStatementSequenceV1>
  if (Array.isArray(sequence.blocks))
  {
    visitSequence(sequence as SemanticStatementSequenceV1)
    return aliases
  }
  const replacement = value as Partial<SemanticReplacementV1>
  if (
    replacement.replacementKind === 'statementSequence' &&
    replacement.value
  )
  {
    visitSequence(replacement.value as SemanticStatementSequenceV1)
    return aliases
  }
  if (replacement.replacementKind === 'expression' && replacement.value)
  {
    visitSemanticAliases(
      replacement.value as SemanticExpressionBlockTreeV1,
      aliases
    )
    return aliases
  }
  const input = value as Partial<SemanticInputValueV1>
  if (input.valueKind === 'block' && input.value)
  {
    visitSemanticAliases(input.value as SemanticBlockTreeV1, aliases)
    return aliases
  }
  if (input.valueKind === 'statementSequence' && input.value)
  {
    visitSequence(input.value as SemanticStatementSequenceV1)
    return aliases
  }
  return aliases
}

export function normalizedAlias(
  input: SemanticCreationNormalizationContextV1,
  value: unknown,
  alias: string
): unknown
{
  const block = semanticAliases(value).get(alias)
  if (block === undefined)
    return invalidCreationContent(`semantic alias ${alias} is absent`)
  return normalizeSemanticBlock(input, block, `/alias/${alias}`)
}

function rawPrimitive(value: InputPrimitive): unknown
{
  return { primitiveTag: value[0], value: value[1] }
}

function normalizeRawDeclaration(
  input: SemanticCreationNormalizationContextV1,
  field: InputPrimitive,
  subtype: string | null,
  referenceDomain: string | null,
  semanticPath: string
): ContractEntityRefV1
{
  if (
    subtype === null ||
    referenceDomain === null ||
    typeof field[1] !== 'string' ||
    typeof field[2] !== 'string'
  )
  {
    return invalidCreationContent(
      `${semanticPath} raw declaration reference is malformed`
    )
  }
  return resolveContractRef(input, {
    sourceKind: 'rawDeclarationReference',
    rawDisplayName: field[1],
    rawDeclarationId: field[2],
    expectedEntityKind: 'declaration',
    expectedEntitySubtype:
      subtype as GroupDContractReferenceExpectationV1['expectedEntitySubtype'],
    referenceDomain,
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

interface RawNormalizationStateV1
{
  readonly input: SemanticCreationNormalizationContextV1
  readonly closure: ReadonlySet<string>
}

function rawBlock(state: RawNormalizationStateV1, blockId: string): Block
{
  if (!state.closure.has(blockId))
    return invalidCreationContent('raw child escapes the normalized closure')
  const value = scratchRecordValue(target(state.input).blocks, blockId)
  if (!value || !isBlockEntry(value))
    return invalidCreationContent('raw normalized block is absent')
  return value
}

function normalizeRawAttachedComment(
  state: RawNormalizationStateV1,
  block: Block,
  semanticPath: string
): { readonly text: string } | null
{
  if (typeof block.comment !== 'string') return null
  const comment = scratchRecordValue(
    target(state.input).comments,
    block.comment
  )
  if (
    comment === undefined ||
    typeof comment.blockId !== 'string' ||
    typeof comment.text !== 'string'
  )
  {
    return invalidCreationContent(
      `${semanticPath} attached comment is incomplete`
    )
  }
  return { text: comment.text }
}

function normalizeRawField(
  state: RawNormalizationStateV1,
  field: BlockField,
  descriptorField: CuratedCoreBlockDescriptorV1['requiredFields'][number],
  semanticPath: string
): unknown
{
  if (descriptorField.requiredEntitySubtype !== null)
  {
    if (typeof field[0] !== 'string' || typeof field[1] !== 'string')
      return invalidCreationContent(`${semanticPath} entity field is malformed`)
    return {
      valueKind: 'entity',
      value: resolveContractRef(state.input, {
        sourceKind: 'rawDeclarationReference',
        rawDisplayName: field[0],
        rawDeclarationId: field[1],
        expectedEntityKind: 'declaration',
        expectedEntitySubtype:
          descriptorField.requiredEntitySubtype as GroupDContractReferenceExpectationV1['expectedEntitySubtype'],
        referenceDomain: descriptorField.referenceDomain!,
        ownerTargetIndex: state.input.targetIndex,
        semanticPath,
      }),
    }
  }
  return { valueKind: 'scalar', value: field[0] }
}

function normalizeRawInput(
  state: RawNormalizationStateV1,
  raw: BlockInput,
  descriptorInput: CuratedCoreBlockDescriptorV1['requiredInputs'][number],
  semanticPath: string
): unknown
{
  if (descriptorInput.connection === 'entityMenu')
  {
    const primitive = raw[1]
    if (!Array.isArray(primitive) || primitive[0] !== 11)
      return invalidCreationContent(`${semanticPath} entity menu is malformed`)
    return {
      valueKind: 'entity',
      value: normalizeRawDeclaration(
        state.input,
        primitive,
        descriptorInput.requiredEntitySubtype,
        descriptorInput.referenceDomain,
        semanticPath
      ),
    }
  }
  if (descriptorInput.connection === 'boolean')
  {
    if (raw[0] !== 2 || typeof raw[1] !== 'string')
      return invalidCreationContent(
        `${semanticPath} Boolean input is malformed`
      )
    return {
      valueKind: 'block',
      value: normalizeRawBlockNode(state, raw[1], `${semanticPath}/block`),
    }
  }
  if (descriptorInput.connection === 'substack')
  {
    if (raw[0] !== 2 || typeof raw[1] !== 'string')
      return invalidCreationContent(`${semanticPath} substack is malformed`)
    return {
      valueKind: 'statementSequence',
      value: normalizeRawSequence(state, raw[1], `${semanticPath}/sequence`),
    }
  }
  if (raw[0] === 1 && Array.isArray(raw[1]))
    return { valueKind: 'literal', value: rawPrimitive(raw[1]) }
  if (raw[0] === 3 && typeof raw[1] === 'string' && Array.isArray(raw[2]))
  {
    return {
      valueKind: 'block',
      value: normalizeRawBlockNode(state, raw[1], `${semanticPath}/block`),
      obscuredShadow: rawPrimitive(raw[2]),
    }
  }
  return invalidCreationContent(`${semanticPath} raw input is malformed`)
}

function normalizeRawBlockNode(
  state: RawNormalizationStateV1,
  blockId: string,
  semanticPath: string
): unknown
{
  const block = rawBlock(state, blockId)
  const validation = validateExistingCuratedBlockV1(block)
  const descriptor = validation.descriptor
  if (!validation.ok || descriptor === null)
    return invalidCreationContent(`${semanticPath} is not a curated raw block`)
  assertDescriptorOwner(state.input, descriptor, semanticPath)
  const fields = block.fields ?? {}
  const inputs = block.inputs ?? {}
  const attachedComment = normalizeRawAttachedComment(
    state,
    block,
    `${semanticPath}/comment`
  )
  return {
    nodeKind: 'ordinary',
    opcode: descriptor.opcode,
    fields: [
      ...descriptor.requiredFields,
      ...descriptor.optionalFields,
    ].flatMap((descriptorField) =>
    {
      const field = scratchRecordValue(fields, descriptorField.name)
      return field === undefined
        ? []
        : [
            {
              name: descriptorField.name,
              value: normalizeRawField(
                state,
                field,
                descriptorField,
                `${semanticPath}/fields/${descriptorField.name}`
              ),
            },
          ]
    }),
    inputs: [
      ...descriptor.requiredInputs,
      ...descriptor.optionalInputs,
    ].flatMap((descriptorInput) =>
    {
      const raw = scratchRecordValue(inputs, descriptorInput.name)
      return raw === undefined
        ? []
        : [
            {
              name: descriptorInput.name,
              value: normalizeRawInput(
                state,
                raw,
                descriptorInput,
                `${semanticPath}/inputs/${descriptorInput.name}`
              ),
            },
          ]
    }),
    ...(attachedComment === null ? {} : { attachedComment }),
  }
}

function normalizeRawSequence(
  state: RawNormalizationStateV1,
  rootId: string,
  semanticPath: string
): unknown
{
  const blocks: unknown[] = []
  const visited = new Set<string>()
  let blockId: string | null = rootId
  while (blockId !== null)
  {
    if (visited.has(blockId))
      return invalidCreationContent(`${semanticPath} has a next cycle`)
    visited.add(blockId)
    const block = rawBlock(state, blockId)
    blocks.push(
      normalizeRawBlockNode(
        state,
        blockId,
        `${semanticPath}/blocks/${blocks.length}`
      )
    )
    blockId =
      typeof block.next === 'string' && state.closure.has(block.next)
        ? block.next
        : null
  }
  return { blocks }
}

function rawPlan(
  input: SemanticCreationNormalizationContextV1,
  kind: 'script' | 'ownedBlock',
  rootId: string
): RawNormalizationStateV1
{
  const owner = target(input)
  const plan = planGraphClosureV1(owner, kind, rootId)
  if (kind === 'script')
  {
    const closure = validateCuratedClosureV1(owner.blocks, rootId)
    if (!closure.ok)
      return invalidCreationContent('raw script is not a safe curated closure')
  }
  for (const blockId of plan.orderedBlockIds)
  {
    const value = scratchRecordValue(owner.blocks, blockId)
    if (!value || !isBlockEntry(value))
      return invalidCreationContent('raw closure contains a non-block entry')
    const validation = validateExistingCuratedBlockV1(value)
    if (!validation.ok || !validation.safeForStructuralEdit)
      return invalidCreationContent('raw closure contains an unsafe block')
  }
  return { input, closure: new Set(plan.orderedBlockIds) }
}

function normalizeRawTopLevelRoot(
  input: SemanticCreationNormalizationContextV1,
  kind: 'script' | 'ownedBlock',
  rootId: string
): unknown
{
  const state = rawPlan(input, kind, rootId)
  const root = rawBlock(state, rootId)
  const descriptor = curatedAuthorableDescriptorV1(root.opcode)!
  if (descriptor.shape === 'hat')
  {
    return {
      rootKind: 'eventScript',
      hat: normalizeRawBlockNode(state, rootId, '/raw/hat'),
      ...(typeof root.next === 'string' && state.closure.has(root.next)
        ? { body: normalizeRawSequence(state, root.next, '/raw/body') }
        : {}),
    }
  }
  if (descriptor.shape === 'reporter' || descriptor.shape === 'boolean')
  {
    return {
      rootKind: 'expression',
      value: normalizeRawBlockNode(state, rootId, '/raw/value'),
    }
  }
  return {
    rootKind: 'statementSequence',
    value: normalizeRawSequence(state, rootId, '/raw/value'),
  }
}

function normalizeRawSubtree(
  input: SemanticCreationNormalizationContextV1,
  scriptRootId: string,
  blockId: string
): unknown
{
  const state = rawPlan(input, 'script', scriptRootId)
  if (!state.closure.has(blockId))
    return invalidCreationContent('raw alias block is outside its script')
  return normalizeRawBlockNode(state, blockId, '/raw/alias')
}

function resultAlias(input: GroupDCreationContentInputV1): string
{
  const alias = input.resultRole.alias
  if (
    input.resultRole.roleKind !== 'dynamic' ||
    typeof alias !== 'string' ||
    alias.length === 0
  )
  {
    return invalidCreationContent('dynamic Group D result requires one alias')
  }
  return alias
}

function authoredRootValue(operation: GroupDCreationOperationV1): unknown
{
  if (operation.kind === 'script.add') return operation.root
  if (
    operation.kind === 'block.insertBefore' ||
    operation.kind === 'block.insertAfter' ||
    operation.kind === 'block.insertSubstack'
  )
  {
    return operation.tree
  }
  if (operation.kind === 'block.replace') return operation.replacement
  if (operation.kind === 'block.setInput') return operation.value
  if (
    (operation.kind === 'block.move' || operation.kind === 'block.remove') &&
    operation.sourceGap.kind === 'replaceInput'
  )
  {
    return operation.sourceGap.value
  }
  return invalidCreationContent('operation has no authored Group D result tree')
}

export function normalizeAuthoredRootBlock(
  input: SemanticCreationNormalizationContextV1,
  value: unknown
): unknown
{
  const root = value as Partial<TopLevelScriptRootV1>
  if (root.rootKind === 'eventScript')
  {
    return normalizeSemanticBlock(
      input,
      (value as Extract<TopLevelScriptRootV1, { rootKind: 'eventScript' }>).hat,
      '/authored/root'
    )
  }
  if (root.rootKind === 'statementSequence')
  {
    const block = (
      value as Extract<TopLevelScriptRootV1, { rootKind: 'statementSequence' }>
    ).value.blocks[0]
    if (block === undefined)
      return invalidCreationContent('authored root sequence is empty')
    return normalizeSemanticBlock(input, block, '/authored/root')
  }
  if (root.rootKind === 'expression')
  {
    return normalizeSemanticBlock(
      input,
      (value as Extract<TopLevelScriptRootV1, { rootKind: 'expression' }>)
        .value,
      '/authored/root'
    )
  }
  const replacement = value as Partial<SemanticReplacementV1>
  if (replacement.replacementKind === 'statementSequence')
  {
    const block = (replacement.value as SemanticStatementSequenceV1).blocks[0]
    if (block === undefined)
      return invalidCreationContent('authored replacement sequence is empty')
    return normalizeSemanticBlock(input, block, '/authored/replacement')
  }
  if (replacement.replacementKind === 'expression')
  {
    return normalizeSemanticBlock(
      input,
      replacement.value as SemanticExpressionBlockTreeV1,
      '/authored/replacement'
    )
  }
  const semanticInput = value as Partial<SemanticInputValueV1>
  if (semanticInput.valueKind === 'block')
  {
    return normalizeSemanticBlock(
      input,
      semanticInput.value as SemanticBlockTreeV1,
      '/authored/input'
    )
  }
  if (semanticInput.valueKind === 'statementSequence')
  {
    const block = (semanticInput.value as SemanticStatementSequenceV1).blocks[0]
    if (block === undefined)
      return invalidCreationContent('authored input sequence is empty')
    return normalizeSemanticBlock(input, block, '/authored/input')
  }
  const sequence = value as Partial<SemanticStatementSequenceV1>
  if (Array.isArray(sequence.blocks))
  {
    const block = sequence.blocks[0]
    if (block === undefined)
      return invalidCreationContent('authored result sequence is empty')
    return normalizeSemanticBlock(input, block, '/authored/sequence')
  }
  return invalidCreationContent(
    'authored value does not create a block closure'
  )
}

function expectedResultRoleShape(name: GroupDCreationResultRoleV1['name']): {
  readonly entityKind: 'script' | 'block'
  readonly roleKind: 'fixed' | 'dynamic'
}
{
  if (name === 'script' || name === 'destinationScript')
    return { entityKind: 'script', roleKind: 'fixed' }
  if (name === 'blockAlias' || name === 'cloneAlias')
    return { entityKind: 'block', roleKind: 'dynamic' }
  return { entityKind: 'block', roleKind: 'fixed' }
}

function assertOperationRole(input: GroupDCreationContentInputV1): void
{
  const { operation, descriptor, resultRole } = input
  const expectedShape = expectedResultRoleShape(resultRole.name)
  if (descriptor.expectedCreatorOperationKind !== operation.kind)
    invalidCreationContent('future Group D creator operation does not match')
  if (
    descriptor.entitySubtype !== 'unspecialized' ||
    descriptor.entityKind !== expectedShape.entityKind ||
    descriptor.expectedCreationRole.entityKind !== descriptor.entityKind ||
    descriptor.expectedCreationRole.entitySubtype !== 'unspecialized' ||
    descriptor.expectedCreationRole.roleKind !== expectedShape.roleKind ||
    descriptor.expectedCreationRole.roleKind !== resultRole.roleKind ||
    descriptor.expectedCreationRole.name !== resultRole.name
  )
  {
    invalidCreationContent('future Group D result role does not match')
  }
  if (resultRole.roleKind === 'fixed' && resultRole.alias !== undefined)
    invalidCreationContent('fixed Group D result cannot carry an alias')
  if (resultRole.roleKind === 'dynamic') resultAlias(input)
  const roles: Readonly<
    Record<GroupDCreationOperationV1['kind'], readonly string[]>
  > = {
    'script.add': ['script', 'rootBlock', 'blockAlias'],
    'script.duplicate': ['script', 'rootBlock', 'cloneAlias'],
    'block.insertBefore': ['rootBlock', 'blockAlias'],
    'block.insertAfter': ['rootBlock', 'blockAlias'],
    'block.insertSubstack': ['rootBlock', 'blockAlias'],
    'block.replace': ['rootBlock', 'blockAlias'],
    'block.move': ['destinationScript', 'sourceGapRootBlock', 'blockAlias'],
    'block.remove': ['sourceGapRootBlock', 'blockAlias'],
    'block.setInput': ['rootBlock', 'blockAlias'],
  }
  if (!roles[operation.kind].includes(resultRole.name))
    invalidCreationContent(
      'operation cannot produce the requested Group D role'
    )
  if (
    (descriptor.entityKind === 'script' &&
      descriptor.expectedCreationScope.scopeKind !==
        'targetAndOwnedDescendants') ||
    (descriptor.entityKind === 'block' &&
      descriptor.expectedCreationScope.scopeKind !== 'scriptClosure')
  )
  {
    invalidCreationContent('future Group D entity scope has the wrong shape')
  }
}

function rawTargetContractRef(
  input: GroupDCreationContentInputV1,
  semanticPath: string
): ContractEntityRefV1
{
  const owner = target(input)
  return resolveContractRef(input, {
    sourceKind: 'rawTarget',
    rawTargetIndex: input.targetIndex,
    rawDisplayName: owner.name,
    expectedEntityKind: 'target',
    expectedEntitySubtype: owner.isStage ? 'stage' : 'sprite',
    referenceDomain: 'targetOwnership',
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

function rawScriptContractRef(
  input: GroupDCreationContentInputV1,
  semanticPath: string
): ContractEntityRefV1
{
  const scriptTopBlockId = input.selectedSource.scriptTopBlockId
  if (scriptTopBlockId === undefined)
    return invalidCreationContent('selected source script is required')
  return resolveContractRef(input, {
    sourceKind: 'rawScript',
    rawScriptTopBlockId: scriptTopBlockId,
    expectedEntityKind: 'script',
    expectedEntitySubtype: 'unspecialized',
    referenceDomain: 'scriptOwnership',
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

function assertCreationScope(input: GroupDCreationContentInputV1): void
{
  const { operation, descriptor, resultRole } = input
  const scope = descriptor.expectedCreationScope
  if (descriptor.entityKind === 'script')
  {
    if (scope.scopeKind !== 'targetAndOwnedDescendants')
      return invalidCreationContent('script result requires target scope')
    let actual: ContractEntityRefV1
    if (operation.kind === 'script.add')
    {
      actual = resolveContractRef(input, {
        sourceKind: 'semanticReference',
        reference: operation.target,
        expectedEntityKind: 'target',
        expectedEntitySubtype: scope.target.entitySubtype,
        referenceDomain: 'targetOwnership',
        ownerTargetIndex: input.targetIndex,
        semanticPath: '/scope/target',
      })
    }
    else if (operation.kind === 'script.duplicate')
      actual = rawTargetContractRef(input, '/scope/target')
    else if (
      operation.kind === 'block.move' &&
      resultRole.name === 'destinationScript' &&
      (operation.destination.kind === 'topLevelStatement' ||
        operation.destination.kind === 'topLevelExpression')
    )
    {
      actual = resolveContractRef(input, {
        sourceKind: 'semanticReference',
        reference: operation.destination.workspace.target,
        expectedEntityKind: 'target',
        expectedEntitySubtype: scope.target.entitySubtype,
        referenceDomain: 'targetOwnership',
        ownerTargetIndex: input.targetIndex,
        semanticPath: '/scope/target',
      })
    }
    else
      return invalidCreationContent('script role is not produced in this state')
    assertSameContractRef(
      actual,
      scope.target,
      'script creation scope target does not match the result'
    )
    return
  }
  if (scope.scopeKind !== 'scriptClosure')
    return invalidCreationContent('block result requires script closure scope')
  if (
    operation.kind === 'script.add' ||
    operation.kind === 'script.duplicate'
  )
  {
    if (scope.script.contractRefKind !== 'future')
      invalidCreationContent(
        'new script block result requires future script scope'
      )
    return
  }
  assertSameContractRef(
    rawScriptContractRef(input, '/scope/script'),
    scope.script,
    'block creation scope script does not match the selected script'
  )
}

function resultInitialContent(input: GroupDCreationContentInputV1): unknown
{
  const { operation, resultRole, selectedSource } = input
  if (operation.kind === 'script.add')
  {
    if (resultRole.name === 'script')
      return normalizeSemanticTopLevelRoot(input, operation.root, '/script/add')
    if (resultRole.name === 'rootBlock')
      return normalizeAuthoredRootBlock(input, operation.root)
    return normalizedAlias(input, operation.root, resultAlias(input))
  }
  if (operation.kind === 'script.duplicate')
  {
    const scriptTopBlockId = selectedSource.scriptTopBlockId
    if (scriptTopBlockId === undefined)
      return invalidCreationContent('script duplicate source is absent')
    if (resultRole.name === 'script')
      return normalizeRawTopLevelRoot(input, 'script', scriptTopBlockId)
    if (resultRole.name === 'rootBlock')
      return normalizeRawSubtree(input, scriptTopBlockId, scriptTopBlockId)
    const alias = resultAlias(input)
    if (!operation.exposeClones.some((entry) => entry.alias === alias))
      return invalidCreationContent('clone alias is not requested by duplicate')
    if (selectedSource.blockId === undefined)
      return invalidCreationContent('clone alias source block is absent')
    return normalizeRawSubtree(input, scriptTopBlockId, selectedSource.blockId)
  }
  if (
    operation.kind === 'block.move' &&
    resultRole.name === 'destinationScript'
  )
  {
    if (
      operation.destination.kind !== 'topLevelStatement' &&
      operation.destination.kind !== 'topLevelExpression'
    )
    {
      return invalidCreationContent('move destination is not top level')
    }
    if (selectedSource.blockId === undefined)
      return invalidCreationContent('moved block source is absent')
    return normalizeRawTopLevelRoot(input, 'ownedBlock', selectedSource.blockId)
  }
  const authored = authoredRootValue(operation)
  if (
    resultRole.name === 'rootBlock' ||
    resultRole.name === 'sourceGapRootBlock'
  )
    return normalizeAuthoredRootBlock(input, authored)
  if (resultRole.name === 'blockAlias')
    return normalizedAlias(input, authored, resultAlias(input))
  return invalidCreationContent('result role has no Group D initial content')
}

function groupDCreationContentProjectionForResultV1(
  input: GroupDCreationContentInputV1
): unknown
{
  assertOperationRole(input)
  assertCreationScope(input)
  return {
    kind: 'group-d-contract-creation-content',
    schemaVersion: 1,
    operationKind: input.operation.kind,
    entityKind: input.descriptor.entityKind,
    entitySubtype: input.descriptor.entitySubtype,
    role: input.descriptor.expectedCreationRole,
    scope: input.descriptor.expectedCreationScope,
    initialSemanticContent: resultInitialContent(input),
  }
}

export function groupDCreationContentFingerprintForResultV1(
  input: GroupDCreationContentInputV1
): string
{
  return semanticHashV1(
    'semantic-fingerprint',
    groupDCreationContentProjectionForResultV1(input)
  )
}
