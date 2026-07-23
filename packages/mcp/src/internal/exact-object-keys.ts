// packages/mcp/src/internal/exact-object-keys.ts
// compare object keys without changing caller-specific validation

export function hasExactObjectKeysV1(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean
{
  const observed = Object.keys(value).sort()
  const exact = [...expected].sort()
  return (
    observed.length === exact.length &&
    observed.every((key, index) => key === exact[index])
  )
}
