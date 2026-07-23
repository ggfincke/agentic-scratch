// packages/ir/src/project/scripts.ts
// derive readable script trees from a target's block map (read-only view for inspect)

import type {
  Block,
  BlockEntry,
  InputSlot,
  Mutation,
  Target,
} from '@scratch-agent/sb3'
import { isBlockEntry, primaryInputSlot } from '@scratch-agent/sb3'

export type ResolvedArg =
  | { kind: 'literal'; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'list'; name: string }
  | { kind: 'broadcast'; name: string }
  | { kind: 'reporter'; block: RenderedBlock }
  | { kind: 'empty' }

export interface RenderedBlock
{
  id: string
  opcode: string
  // non-substack inputs, resolved to literals/variables/reporters
  inputs: Record<string, ResolvedArg>
  fields: Record<string, string>
  mutation?: Mutation
  // ordered nested substacks (SUBSTACK, then SUBSTACK2, ...)
  substacks: RenderedBlock[][]
}

export interface Script
{
  topId: string
  // the hat/top block plus the stacked chain under it
  blocks: RenderedBlock[]
}

// onPath tracks ancestors on the current resolution path so cyclic reporter/substack
// graphs terminate instead of overflowing the stack
function resolveSlot(
  slot: InputSlot,
  blocks: Record<string, BlockEntry>,
  onPath: Set<string>
): ResolvedArg
{
  if (slot === null || slot === undefined) return { kind: 'empty' }
  if (Array.isArray(slot))
  {
    const type = slot[0]
    if (type === 11) return { kind: 'broadcast', name: String(slot[1]) }
    if (type === 12) return { kind: 'variable', name: String(slot[1]) }
    if (type === 13) return { kind: 'list', name: String(slot[1]) }
    return { kind: 'literal', value: String(slot[1] ?? '') }
  }
  // a block id -> a reporter plugged into this input
  const block = blocks[slot]
  if (!isBlockEntry(block) || onPath.has(slot)) return { kind: 'empty' }
  return { kind: 'reporter', block: renderBlock(slot, block, blocks, onPath) }
}

function isSubstack(name: string): boolean
{
  return /^SUBSTACK\d*$/u.test(name)
}

// walk a `next` chain starting at firstId into a flat list of rendered blocks
function renderStack(
  firstId: string | null | undefined,
  blocks: Record<string, BlockEntry>,
  onPath: Set<string>
): RenderedBlock[]
{
  const out: RenderedBlock[] = []
  const seen = new Set<string>()
  let cur = firstId ?? null
  while (cur)
  {
    if (seen.has(cur)) break
    seen.add(cur)
    const block = blocks[cur]
    if (!isBlockEntry(block)) break
    out.push(renderBlock(cur, block, blocks, onPath))
    cur = block.next ?? null
  }
  return out
}

function renderBlock(
  id: string,
  block: Block,
  blocks: Record<string, BlockEntry>,
  onPath: Set<string>
): RenderedBlock
{
  onPath.add(id)
  const inputs: Record<string, ResolvedArg> = {}
  const substacks: RenderedBlock[][] = []

  for (const [name, input] of Object.entries(block.inputs ?? {}))
  {
    if (isSubstack(name))
    {
      const slot = primaryInputSlot(input)
      const childId = typeof slot === 'string' ? slot : null
      substacks.push(renderStack(childId, blocks, onPath))
      continue
    }
    inputs[name] = resolveSlot(primaryInputSlot(input), blocks, onPath)
  }

  const fields: Record<string, string> = {}
  for (const [name, field] of Object.entries(block.fields ?? {}))
  {
    fields[name] = String(field[0] ?? '')
  }

  onPath.delete(id)
  return {
    id,
    opcode: block.opcode,
    inputs,
    fields,
    substacks,
    ...(block.mutation ? { mutation: block.mutation } : {}),
  }
}

// every top-level script (hat or loose stack) in the target, as a rendered tree
export function scriptsOf(target: Target): Script[]
{
  const blocks = target.blocks
  const scripts: Script[] = []
  for (const [id, entry] of Object.entries(blocks))
  {
    if (
      !isBlockEntry(entry) ||
      entry.topLevel !== true ||
      entry.shadow === true
    )
      continue
    scripts.push({ topId: id, blocks: renderStack(id, blocks, new Set()) })
  }
  return scripts
}
