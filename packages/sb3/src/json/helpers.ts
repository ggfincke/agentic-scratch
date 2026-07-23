// packages/sb3/src/json/helpers.ts
// pure raw project.json helpers shared by higher validation/analysis layers

import type {
  Block,
  BlockEntry,
  BlockInput,
  InputSlot,
} from './project-json.js'

export function isBlockEntry(entry: BlockEntry | undefined): entry is Block
{
  return !!entry && !Array.isArray(entry)
}

export function primaryInputSlot(input: BlockInput): InputSlot
{
  return input[1] ?? null
}
