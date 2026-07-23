// packages/ir/src/edit/lexical-order.ts
// provide one deterministic lexical comparator for internal edit modules

export function compareLexicalTextV1(left: string, right: string): number
{
  return left < right ? -1 : left > right ? 1 : 0
}

export function sameStringSetV1(
  left: Iterable<string>,
  right: Iterable<string>
): boolean
{
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  )
}
