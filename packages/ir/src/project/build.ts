// packages/ir/src/project/build.ts
// lower high-level block specs into the id-keyed Scratch block graph (for IR edits)

import type {
  Block,
  BlockField,
  BlockInput,
  Mutation,
} from '@scratch-agent/sb3'

import type { Uids } from '../core/uid.js'

// a high-level input value plugged into a block input
type InputValue =
  | number
  | string
  | { var: string; id: string }
  | { list: string; id: string }
  | { broadcast: string; id: string }
  | { reporter: BlockSpec }
  | { boolean: BlockSpec }
  | { substack: BlockSpec[] }

export interface BlockSpec
{
  opcode: string
  inputs?: Record<string, InputValue>
  fields?: Record<string, BlockField>
  mutation?: Mutation
}

interface LoweredScript
{
  topId: string
  blocks: Record<string, Block>
}

// default obscured-shadow filler for a value slot holding a reporter/variable
const TEXT_SHADOW: [10, string] = [10, '']

function lowerInput(
  value: InputValue,
  parentId: string,
  blocks: Record<string, Block>,
  uids: Uids
): BlockInput
{
  if (typeof value === 'number') return [1, [4, String(value)]]
  if (typeof value === 'string') return [1, [10, value]]
  if ('var' in value) return [3, [12, value.var, value.id], TEXT_SHADOW]
  if ('list' in value) return [3, [13, value.list, value.id], TEXT_SHADOW]
  if ('broadcast' in value) return [1, [11, value.broadcast, value.id]]
  if ('reporter' in value)
  {
    const id = uids.next()
    blocks[id] = lowerBlock(value.reporter, id, parentId, false, blocks, uids)
    return [3, id, TEXT_SHADOW]
  }
  if ('boolean' in value)
  {
    const id = uids.next()
    blocks[id] = lowerBlock(value.boolean, id, parentId, false, blocks, uids)
    return [2, id]
  }
  if ('substack' in value)
  {
    // a nested stack whose first block parents to this block
    const firstId = lowerStack(
      value.substack,
      parentId,
      false,
      blocks,
      uids,
      {}
    )
    return firstId ? [2, firstId] : [2, null]
  }
  throw new Error(
    `lowerInput: unsupported input value ${JSON.stringify(value)}`
  )
}

function lowerBlock(
  spec: BlockSpec,
  id: string,
  parentId: string | null,
  topLevel: boolean,
  blocks: Record<string, Block>,
  uids: Uids,
  pos: { x?: number; y?: number } = {}
): Block
{
  const block: Block = {
    opcode: spec.opcode,
    next: null,
    parent: parentId,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel,
  }
  if (topLevel)
  {
    block.x = pos.x ?? 0
    block.y = pos.y ?? 0
  }
  for (const [name, field] of Object.entries(spec.fields ?? {}))
  {
    block.fields![name] = field
  }
  for (const [name, value] of Object.entries(spec.inputs ?? {}))
  {
    block.inputs![name] = lowerInput(value, id, blocks, uids)
  }
  if (spec.mutation) block.mutation = spec.mutation
  return block
}

// build a stacked chain (wiring next/parent); returns the first block id (or null if empty)
function lowerStack(
  stack: BlockSpec[],
  parentId: string | null,
  topLevel: boolean,
  blocks: Record<string, Block>,
  uids: Uids,
  pos: { x?: number; y?: number }
): string | null
{
  let firstId: string | null = null
  let prevId: string | null = null
  for (const spec of stack)
  {
    const id = uids.next()
    const isFirst = prevId === null
    const block = lowerBlock(
      spec,
      id,
      isFirst ? parentId : prevId,
      isFirst && topLevel,
      blocks,
      uids,
      isFirst ? pos : {}
    )
    blocks[id] = block
    if (prevId) blocks[prevId]!.next = id
    if (isFirst) firstId = id
    prevId = id
  }
  return firstId
}

// lower a top-level script (the first block becomes topLevel w/ workspace coords)
export function buildScript(
  stack: BlockSpec[],
  uids: Uids,
  pos: { x?: number; y?: number } = {}
): LoweredScript
{
  const blocks: Record<string, Block> = {}
  const topId = lowerStack(stack, null, true, blocks, uids, pos)
  if (!topId) throw new Error('buildScript: empty stack')
  return { topId, blocks }
}
