// packages/ir/src/repair/repair-blocks.ts
// lower allowlisted agent block specs into deterministic Scratch graph records

import type {
  Block,
  BlockField,
  BlockInput,
  InputPrimitive,
} from '@scratch-agent/sb3'

import type {
  DeclarationRef,
  RepairBlockSpec,
  RepairField,
  RepairInput,
  RepairLiteral,
} from './repair-types.js'
import {
  repairBlockShape,
  type RepairBlockCategory as BlockCategory,
  type RepairBlockShape as BlockShape,
  type RepairFieldShape as FieldShape,
  type RepairInputShape as InputShape,
} from './repair-block-catalog.js'
import { repairCoreCompatibleShapeV1 } from '../edit/repair-core-compatibility.js'
import type { Uids } from '../core/uid.js'
import {
  isRepairLiteralKind,
  REPAIR_LITERAL_TAGS,
} from './repair-literal-catalog.js'

class RepairBlockError extends Error
{
  constructor(
    message: string,
    readonly opcode?: string
  )
  {
    super(message)
    this.name = 'RepairBlockError'
  }
}

interface LoweredRepairStack
{
  topId: string
  tailId: string
  blocks: Record<string, Block>
  blockIds: string[]
}

type DeclarationResolver = (reference: DeclarationRef) => void

function numericValue(literal: RepairLiteral): number
{
  const number = Number(literal.value)
  if (!Number.isFinite(number))
  {
    throw new RepairBlockError(`${literal.kind} literal must be finite`)
  }
  return number
}

function validateRepairLiteral(literal: RepairLiteral): void
{
  if (literal.kind === 'text')
  {
    if (typeof literal.value === 'number' && !Number.isFinite(literal.value))
    {
      throw new RepairBlockError('text numeric literal must be finite')
    }
    return
  }
  if (literal.kind === 'color')
  {
    if (
      typeof literal.value !== 'string' ||
      !/^#[0-9a-fA-F]{6}$/.test(literal.value)
    )
    {
      throw new RepairBlockError('color literal must be #RRGGBB')
    }
    return
  }
  const number = numericValue(literal)
  if (literal.kind === 'positive-number' && number <= 0)
  {
    throw new RepairBlockError('positive-number literal must be greater than 0')
  }
  if (
    literal.kind === 'positive-integer' &&
    (!Number.isInteger(number) || number <= 0)
  )
  {
    throw new RepairBlockError(
      'positive-integer literal must be a positive integer'
    )
  }
  if (literal.kind === 'integer' && !Number.isInteger(number))
  {
    throw new RepairBlockError('integer literal must be an integer')
  }
}

export function literalPrimitive(literal: RepairLiteral): InputPrimitive
{
  validateRepairLiteral(literal)
  const tag = REPAIR_LITERAL_TAGS[literal.kind]
  return [tag, literal.value] as InputPrimitive
}

function sameKeys(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean
{
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function declarationKind(value: RepairField): DeclarationRef['kind'] | null
{
  if (value === null || typeof value !== 'object') return null
  return value.kind
}

function validateShape(
  spec: RepairBlockSpec,
  expected: BlockCategory
): BlockShape
{
  const shape =
    repairCoreCompatibleShapeV1(spec.opcode) ?? repairBlockShape(spec.opcode)
  if (!shape)
  {
    throw new RepairBlockError(
      `opcode "${spec.opcode}" is not allowlisted`,
      spec.opcode
    )
  }
  if (shape.category !== expected)
  {
    throw new RepairBlockError(
      `opcode "${spec.opcode}" is ${shape.category}, expected ${expected}`,
      spec.opcode
    )
  }
  if (!sameKeys(spec.inputs ?? {}, shape.inputs ?? {}))
  {
    throw new RepairBlockError(
      `opcode "${spec.opcode}" input shape mismatch`,
      spec.opcode
    )
  }
  if (!sameKeys(spec.fields ?? {}, shape.fields ?? {}))
  {
    throw new RepairBlockError(
      `opcode "${spec.opcode}" field shape mismatch`,
      spec.opcode
    )
  }
  return shape
}

function validateInputShape(value: RepairInput, shape: InputShape): void
{
  if (shape === 'substack')
  {
    if (value.kind !== 'substack' || value.blocks.length === 0)
    {
      throw new RepairBlockError(
        'substack input requires nonempty statement blocks'
      )
    }
    return
  }
  if (shape === 'boolean')
  {
    if (value.kind !== 'boolean')
    {
      throw new RepairBlockError('boolean input requires a boolean reporter')
    }
    return
  }
  if (shape === 'broadcast')
  {
    if (value.kind !== 'broadcast')
    {
      throw new RepairBlockError(
        'broadcast input requires a broadcast reference'
      )
    }
    return
  }
  if (shape === 'number')
  {
    if (
      value.kind === 'color' ||
      value.kind === 'text' ||
      value.kind === 'broadcast' ||
      value.kind === 'boolean' ||
      value.kind === 'substack'
    )
    {
      throw new RepairBlockError('number input has an incompatible value')
    }
    return
  }
  if (
    value.kind === 'boolean' ||
    value.kind === 'substack' ||
    value.kind === 'broadcast'
  )
  {
    throw new RepairBlockError('value input has an incompatible value')
  }
}

function lowerField(
  value: RepairField,
  expected: FieldShape,
  resolveDeclaration: DeclarationResolver
): BlockField
{
  const kind = declarationKind(value)
  if (expected === 'plain')
  {
    if (kind !== null)
    {
      throw new RepairBlockError(
        'plain field cannot contain a declaration reference'
      )
    }
    return [value as string | number | null]
  }
  if (kind !== expected)
  {
    throw new RepairBlockError(
      `${expected} field requires a matching declaration reference`
    )
  }
  const reference = value as DeclarationRef
  resolveDeclaration(reference)
  return [reference.name, reference.id]
}

function lowerInput(
  value: RepairInput,
  expected: InputShape,
  parentId: string,
  blocks: Record<string, Block>,
  blockIds: string[],
  uids: Uids,
  resolveDeclaration: DeclarationResolver
): BlockInput
{
  validateInputShape(value, expected)
  if (isRepairLiteralKind(value.kind))
  {
    return [1, literalPrimitive(value as RepairLiteral)]
  }
  if (value.kind === 'variable' || value.kind === 'list')
  {
    resolveDeclaration(value)
    const tag = value.kind === 'variable' ? 12 : 13
    return [3, [tag, value.name, value.id], [10, '']] as BlockInput
  }
  if (value.kind === 'broadcast')
  {
    resolveDeclaration(value)
    return [1, [11, value.name, value.id]]
  }
  if (value.kind === 'reporter' || value.kind === 'boolean')
  {
    const childId = uids.next()
    blocks[childId] = lowerBlock(
      value.block,
      childId,
      parentId,
      blocks,
      blockIds,
      uids,
      resolveDeclaration,
      value.kind
    )
    return value.kind === 'boolean' ? [2, childId] : [3, childId, [10, '']]
  }
  if (value.kind !== 'substack')
  {
    throw new RepairBlockError('unsupported repair input')
  }
  const nested = lowerStack(
    value.blocks,
    parentId,
    false,
    blocks,
    blockIds,
    uids,
    resolveDeclaration
  )
  return [2, nested.topId]
}

function lowerBlock(
  spec: RepairBlockSpec,
  id: string,
  parentId: string | null,
  blocks: Record<string, Block>,
  blockIds: string[],
  uids: Uids,
  resolveDeclaration: DeclarationResolver,
  expectedCategory: BlockCategory,
  position?: { x: number; y: number }
): Block
{
  const shape = validateShape(spec, expectedCategory)
  const block: Block = {
    opcode: spec.opcode,
    next: null,
    parent: parentId,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: position !== undefined,
    ...(position ? { x: position.x, y: position.y } : {}),
  }
  blockIds.push(id)
  for (const [name, fieldShape] of Object.entries(shape.fields ?? {}))
  {
    block.fields![name] = lowerField(
      spec.fields![name]!,
      fieldShape,
      resolveDeclaration
    )
  }
  for (const [name, inputShape] of Object.entries(shape.inputs ?? {}))
  {
    block.inputs![name] = lowerInput(
      spec.inputs![name]!,
      inputShape,
      id,
      blocks,
      blockIds,
      uids,
      resolveDeclaration
    )
  }
  return block
}

function lowerStack(
  specs: readonly RepairBlockSpec[],
  parentId: string | null,
  topLevel: boolean,
  blocks: Record<string, Block>,
  blockIds: string[],
  uids: Uids,
  resolveDeclaration: DeclarationResolver,
  position?: { x: number; y: number }
): LoweredRepairStack
{
  if (specs.length === 0)
    throw new RepairBlockError('repair stack cannot be empty')
  let topId = ''
  let tailId = ''
  for (const [index, spec] of specs.entries())
  {
    const id = uids.next()
    const first = index === 0
    const category: BlockCategory = first && topLevel ? 'hat' : 'statement'
    blocks[id] = lowerBlock(
      spec,
      id,
      first ? parentId : tailId,
      blocks,
      blockIds,
      uids,
      resolveDeclaration,
      category,
      first && topLevel ? position : undefined
    )
    if (first) topId = id
    else blocks[tailId]!.next = id
    tailId = id
  }
  return { topId, tailId, blocks, blockIds }
}

export function lowerRepairStatements(
  specs: readonly RepairBlockSpec[],
  parentId: string,
  uids: Uids,
  resolveDeclaration: DeclarationResolver
): LoweredRepairStack
{
  return lowerStack(specs, parentId, false, {}, [], uids, resolveDeclaration)
}

export function lowerRepairScript(
  specs: readonly RepairBlockSpec[],
  position: { x: number; y: number },
  uids: Uids,
  resolveDeclaration: DeclarationResolver
): LoweredRepairStack
{
  return lowerStack(
    specs,
    null,
    true,
    {},
    [],
    uids,
    resolveDeclaration,
    position
  )
}
