// packages/ir/src/repair/repair-literal-catalog.ts
// centralize repair literal kinds & Scratch primitive tags

import type { RepairLiteral } from './repair-types.js'

export type RepairLiteralTag = 4 | 5 | 6 | 7 | 8 | 9 | 10

export const REPAIR_LITERAL_TAGS: Readonly<
  Record<RepairLiteral['kind'], RepairLiteralTag>
> = Object.freeze({
  number: 4,
  'positive-number': 5,
  'positive-integer': 6,
  integer: 7,
  angle: 8,
  color: 9,
  text: 10,
})

export const REPAIR_LITERAL_KINDS_BY_TAG: Readonly<
  Partial<Record<number, RepairLiteral['kind']>>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(REPAIR_LITERAL_TAGS).map(([kind, tag]) => [tag, kind])
  ) as Partial<Record<number, RepairLiteral['kind']>>
)

const REPAIR_LITERAL_KINDS = new Set(Object.keys(REPAIR_LITERAL_TAGS))

export function isRepairLiteralKind(
  value: string
): value is RepairLiteral['kind']
{
  return REPAIR_LITERAL_KINDS.has(value)
}
