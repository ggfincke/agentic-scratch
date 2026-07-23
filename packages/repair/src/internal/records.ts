// packages/repair/src/internal/records.ts
// recognize ordinary prototype-backed records

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown>
{
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}
