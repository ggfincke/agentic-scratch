// packages/mutate/src/operators.ts
// mutation operators over the raw block graph: op-swap, constant, statement-delete & negate

import type {
  Block,
  BlockEntry,
  BlockInput,
  InputPrimitive,
  Target,
} from '@scratch-agent/sb3'
import { deletableStatementIds, deleteStatement } from '@scratch-agent/ir'

export type MutationOperator = 'op-swap' | 'const' | 'delete' | 'negate'

// one applicable mutation, deferred: apply() edits the target inside a fresh project clone
interface MutationSite
{
  operator: MutationOperator
  targetIndex: number
  targetName: string
  blockId: string
  opcode: string
  describe: string
  apply: (target: Target) => void
}

// commutative-looking opcode pairs whose swap changes behavior
const SWAP: Record<string, string> = {
  operator_add: 'operator_subtract',
  operator_subtract: 'operator_add',
  operator_multiply: 'operator_divide',
  operator_divide: 'operator_multiply',
  operator_gt: 'operator_lt',
  operator_lt: 'operator_gt',
  operator_and: 'operator_or',
  operator_or: 'operator_and',
}

function asBlock(entry: BlockEntry | undefined): Block | null
{
  if (!entry || Array.isArray(entry)) return null
  return entry
}

// scratch numeric input primitive tags (number/positive/positive-int/int/angle)
type NumericSlot = 4 | 5 | 6 | 7 | 8

// a plain inline numeric literal ([1, [4..8, value]]); reporters/obscured slots are not literals
function numericLiteral(
  input: BlockInput
): { slot: NumericSlot; value: string } | null
{
  if (input[0] !== 1) return null
  const prim = input[1]
  if (
    Array.isArray(prim) &&
    typeof prim[0] === 'number' &&
    prim[0] >= 4 &&
    prim[0] <= 8
  )
  {
    return { slot: prim[0] as NumericSlot, value: String(prim[1] ?? '') }
  }
  return null
}

function opSwapSite(
  targetIndex: number,
  targetName: string,
  id: string,
  opcode: string,
  swapped: string
): MutationSite
{
  return {
    operator: 'op-swap',
    targetIndex,
    targetName,
    blockId: id,
    opcode,
    describe: `swap ${opcode} -> ${swapped}`,
    apply: (target) =>
    {
      const b = asBlock(target.blocks[id])
      if (b) b.opcode = swapped
    },
  }
}

function constSite(
  targetIndex: number,
  targetName: string,
  id: string,
  opcode: string,
  inputName: string,
  lit: { slot: number; value: string }
): MutationSite
{
  const n = Number(lit.value)
  const next = n === 0 ? 1 : 0
  return {
    operator: 'const',
    targetIndex,
    targetName,
    blockId: id,
    opcode,
    describe: `${opcode}.${inputName}: ${lit.value} -> ${next}`,
    apply: (target) =>
    {
      const b = asBlock(target.blocks[id])
      const input = b?.inputs?.[inputName]
      if (input) input[1] = [lit.slot, String(next)] as InputPrimitive
    },
  }
}

function deleteSite(
  targetIndex: number,
  targetName: string,
  id: string,
  opcode: string
): MutationSite
{
  return {
    operator: 'delete',
    targetIndex,
    targetName,
    blockId: id,
    opcode,
    describe: `delete ${opcode}`,
    apply: (target) =>
    {
      deleteStatement(target, id)
    },
  }
}

function negateSite(
  targetIndex: number,
  targetName: string,
  id: string,
  opcode: string
): MutationSite
{
  return {
    operator: 'negate',
    targetIndex,
    targetName,
    blockId: id,
    opcode,
    describe: `negate CONDITION of ${opcode}`,
    apply: (target) =>
    {
      const b = asBlock(target.blocks[id])
      const cond = b?.inputs?.CONDITION
      if (!b || !cond) return
      const condSlot = cond[1]
      if (typeof condSlot !== 'string') return
      const notId = `${id}~not`
      target.blocks[notId] = {
        opcode: 'operator_not',
        next: null,
        parent: id,
        inputs: { OPERAND: [2, condSlot] },
        fields: {},
        shadow: false,
        topLevel: false,
      }
      const condBlock = asBlock(target.blocks[condSlot])
      if (condBlock) condBlock.parent = notId
      b.inputs!.CONDITION = [2, notId]
    },
  }
}

function hasStringCondition(block: Block): boolean
{
  const cond = block.inputs?.CONDITION
  return !!cond && typeof cond[1] === 'string'
}

// every applicable mutation site in one target, in a stable block-map order
function sitesForTarget(target: Target, targetIndex: number): MutationSite[]
{
  const deletionCandidates: string[] = []
  for (const entry of Object.values(target.blocks))
  {
    const block = asBlock(entry)
    if (block?.next && asBlock(target.blocks[block.next]))
    {
      deletionCandidates.push(block.next)
    }
  }
  const deletable = deletableStatementIds(target, deletionCandidates)
  const sites: MutationSite[] = []
  for (const [id, entry] of Object.entries(target.blocks))
  {
    const b = asBlock(entry)
    if (!b) continue

    const swapped = SWAP[b.opcode]
    if (swapped)
      sites.push(opSwapSite(targetIndex, target.name, id, b.opcode, swapped))

    for (const [name, input] of Object.entries(b.inputs ?? {}))
    {
      const lit = numericLiteral(input)
      if (lit)
        sites.push(constSite(targetIndex, target.name, id, b.opcode, name, lit))
    }

    if (hasStringCondition(b))
      sites.push(negateSite(targetIndex, target.name, id, b.opcode))

    if (b.next)
    {
      const nb = asBlock(target.blocks[b.next])
      if (nb && deletable.has(b.next))
        sites.push(deleteSite(targetIndex, target.name, b.next, nb.opcode))
    }
  }
  return sites
}

// enumerate every mutation site across the project (targets in file order)
export function enumerateSites(targets: Target[]): MutationSite[]
{
  return targets.flatMap((target, targetIndex) =>
    sitesForTarget(target, targetIndex)
  )
}
