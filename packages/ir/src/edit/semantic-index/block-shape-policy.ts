// packages/ir/src/edit/semantic-index/block-shape-policy.ts
// expose known public & procedure shapes without guessing unknown opcodes

import type { VanillaBlockShape } from '../contracts/catalog.js'
import { getStandardDescriptorV2 } from '../standard-authoring/catalog.js'

export function knownScratchBlockShapeV2(
  opcode: string
): VanillaBlockShape | null
{
  switch (opcode)
  {
    case 'procedures_definition':
      return 'hat'
    case 'procedures_prototype':
      return 'menuReporter'
    case 'procedures_call':
      return 'stack'
    case 'argument_reporter_boolean':
      return 'boolean'
    case 'argument_reporter_string_number':
      return 'reporter'
    default:
      return getStandardDescriptorV2(opcode)?.shape ?? null
  }
}
