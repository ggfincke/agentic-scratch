// packages/static/src/helpers.ts
// shared traversal & extraction helpers for the static checks

import type {
  Block,
  BlockInput,
  InputSlot,
  ProjectJson,
  Target,
} from '@scratch-agent/sb3'
import {
  primaryInputSlot,
  scratchRecordEntries,
  scratchRecordValue,
} from '@scratch-agent/sb3'
import { isBlock } from '@scratch-agent/validate'

// hat (script-starting) opcodes; the /when/ heuristic covers extension hats too,
// so we over-include rather than risk calling a real script "dead"
const HATS = new Set(['control_start_as_clone', 'procedures_definition'])

export function isHat(opcode: string): boolean
{
  return HATS.has(opcode) || /when/i.test(opcode)
}

// every object block in the project, paired w/ its owning target
export function eachBlock(
  json: ProjectJson,
  fn: (target: Target, id: string, block: Block) => void
): void
{
  for (const target of json.targets)
  {
    for (const [id, entry] of scratchRecordEntries(target.blocks))
    {
      if (isBlock(entry)) fn(target, id, entry)
    }
  }
}

export function primarySlot(input: BlockInput): InputSlot
{
  return primaryInputSlot(input)
}

// a literal value primitive (number / colour / text), not a var/list/broadcast ref
export function isLiteralPrimitive(slot: InputSlot): boolean
{
  return (
    Array.isArray(slot) &&
    typeof slot[0] === 'number' &&
    slot[0] >= 4 &&
    slot[0] <= 10
  )
}

export interface BroadcastRef
{
  name?: string
  // a reporter supplies the message at runtime; the name is not statically known
  dynamic: boolean
}

// the message a broadcast block sends, from its BROADCAST_INPUT (inlined or menu block)
export function broadcastSentName(
  block: Block,
  blocks: Record<string, Block | unknown>
): BroadcastRef
{
  const input = scratchRecordValue(block.inputs, 'BROADCAST_INPUT')
  if (!input) return { dynamic: false }
  const slot = primarySlot(input)
  if (Array.isArray(slot) && slot[0] === 11)
    return { name: String(slot[1]), dynamic: false }
  if (typeof slot === 'string')
  {
    const menu = scratchRecordValue(blocks, slot)
    if (isBlock(menu as never))
    {
      const opt = scratchRecordValue((menu as Block).fields, 'BROADCAST_OPTION')
      if (opt) return { name: String(opt[0] ?? ''), dynamic: false }
    }
    return { dynamic: true }
  }
  return { dynamic: false }
}

// the message a "when I receive" hat listens for
export function broadcastReceivedName(block: Block): string | null
{
  const opt = scratchRecordValue(block.fields, 'BROADCAST_OPTION')
  return opt ? String(opt[0] ?? '') : null
}
