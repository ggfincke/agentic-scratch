// packages/edit/src/support/internal-values.ts
// shared internal immutable projections, handle traversal & JSON pointer encoding

export function containsRetainedHandleReferenceV1(value: unknown): boolean
{
  const pending = [value]
  const seen = new Set<object>()
  while (pending.length > 0)
  {
    const current = pending.pop()
    if (current === null || typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)
    if (
      !Array.isArray(current) &&
      (current as Record<string, unknown>).refKind === 'handle'
    )
      return true
    pending.push(...Object.values(current))
  }
  return false
}

export function immutableCopyV1<T>(value: T): T
{
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value))
  {
    return Object.freeze(value.map((entry) => immutableCopyV1(entry))) as T
  }
  const copy = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort())
  {
    copy[key] = immutableCopyV1((value as Record<string, unknown>)[key])
  }
  return Object.freeze(copy) as T
}

export function editJsonPointerPartV1(value: string): string
{
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
