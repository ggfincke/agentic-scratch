// packages/ir/src/internal/compare-text.ts
// compare strings by ordinal code-unit order

export function compareText(a: string, b: string): number
{
  return a < b ? -1 : a > b ? 1 : 0
}
