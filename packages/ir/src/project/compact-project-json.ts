// packages/ir/src/project/compact-project-json.ts
// shrink a project.json's new blocks in place w/o changing what scratch-vm or turbowarp run from them

import {
  scratchRecordEntries,
  scratchRecordKeys,
  scratchRecordValue,
  type Block,
  type BlockEntry,
  type InputSlot,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'

// the reporter records scratch's editor saves inline in the input holding them: primitive tag & the one field
const REPORTER_PRIMITIVES = new Map<string, readonly [12 | 13, string]>([
  ['data_variable', [12, 'VARIABLE']],
  ['data_listcontents', [13, 'LIST']],
])
const RECORD_KEYS = new Set([
  'opcode',
  'next',
  'parent',
  'inputs',
  'fields',
  'shadow',
  'topLevel',
])

// * both vms (sb3.js deserializeBlocks) rebuild an inlined [12, name, id] / [13, name, id] as the record it replaces
// under a fresh id, load a missing empty inputs or fields as {} & a missing topLevel as undefined, which every read
// tests by truthiness & toJSON writes back as false

// * blocks whose ids are in carried (the baseline's) keep their exact serialized form, so a build that installs nothing
// reproduces its baseline's bytes & the delta shows no change the build didn't make
export function compactProjectJson(
  json: ProjectJson,
  carried: ReadonlySet<string>
): void
{
  for (const target of json.targets)
  {
    inlineReporters(target, carried)
    for (const [id, block] of scratchRecordEntries(target.blocks))
      if (!carried.has(id) && !Array.isArray(block)) dropDefaults(block)
  }
}

// replace each new variable & list reporter record w/ its primitive in the one new input slot that names it
function inlineReporters(target: Target, carried: ReadonlySet<string>): void
{
  const blocks = target.blocks
  // an inlined record loses its id, so only one named once in the whole target (by the slot holding it) may go
  const mentions = new Map<string, number>()
  const mention = (id: unknown): void =>
  {
    if (typeof id === 'string') mentions.set(id, (mentions.get(id) ?? 0) + 1)
  }
  for (const [, block] of scratchRecordEntries(blocks))
  {
    if (Array.isArray(block)) continue
    mention(block.next)
    mention(block.parent)
    for (const [, input] of scratchRecordEntries(block.inputs))
      input.slice(1).forEach(mention)
  }
  for (const [, comment] of scratchRecordEntries(target.comments))
    mention(comment.blockId)

  for (const [holderId, holder] of scratchRecordEntries(blocks))
  {
    if (carried.has(holderId) || Array.isArray(holder)) continue
    for (const [, input] of scratchRecordEntries(holder.inputs))
    {
      // the vms read slot 1 of every input (a shadow when the input is 1) & slot 2 only of an obscured one, as its
      // shadow
      const slots: Array<[number, boolean]> = [[1, input[0] === 1]]
      if (input[0] !== 1 && input[0] !== 2) slots.push([2, true])
      for (const [slot, shadow] of slots)
      {
        const id = input[slot]
        if (typeof id !== 'string' || carried.has(id) || mentions.get(id) !== 1)
          continue
        const primitive = reporterPrimitive(
          scratchRecordValue(blocks, id),
          holderId,
          shadow
        )
        if (primitive === undefined) continue
        input[slot] = primitive
        delete blocks[id]
      }
    }
  }
}

// the primitive a reporter record loads identically as, or undefined when the record carries anything the vm
// wouldn't rebuild from it
function reporterPrimitive(
  entry: BlockEntry | undefined,
  parent: string,
  shadow: boolean
): InputSlot | undefined
{
  if (entry === undefined || Array.isArray(entry)) return undefined
  const kind = REPORTER_PRIMITIVES.get(entry.opcode)
  if (kind === undefined) return undefined
  if (Object.keys(entry).some((key) => !RECORD_KEYS.has(key))) return undefined
  if (
    entry.next !== null ||
    entry.parent !== parent ||
    entry.shadow !== shadow ||
    (entry.topLevel !== undefined && entry.topLevel !== false) ||
    scratchRecordKeys(entry.inputs).length > 0
  )
    return undefined
  const [tag, fieldName] = kind
  const field = scratchRecordValue(entry.fields, fieldName)
  if (scratchRecordKeys(entry.fields).length !== 1 || field?.length !== 2)
    return undefined
  const [name, id] = field
  if (typeof name !== 'string' || typeof id !== 'string') return undefined
  return [tag, name, id]
}

// drop the keys both vms load the same w/o
function dropDefaults(block: Block): void
{
  if (isEmptyRecord(block.inputs)) delete block.inputs
  if (isEmptyRecord(block.fields)) delete block.fields
  if (block.topLevel === false) delete block.topLevel
}

function isEmptyRecord(value: object | undefined): boolean
{
  return value !== undefined && Object.keys(value).length === 0
}
