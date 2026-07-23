// packages/repair/src/internal/compare-text.ts
// compare text w/ deterministic lexical ordering

export function compareText(a: string, b: string): number
{
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
