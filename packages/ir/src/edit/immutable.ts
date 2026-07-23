// packages/ir/src/edit/immutable.ts
// deep runtime freezing for exported semantic authority values

export function deepFreeze<T>(value: T): T
{
  if (value === null || typeof value !== 'object') return value
  const pending: object[] = [value]
  const visited = new WeakSet<object>()
  while (pending.length > 0)
  {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const key of Reflect.ownKeys(current))
    {
      const property = Object.getOwnPropertyDescriptor(current, key)
      if (!property || !('value' in property)) continue
      const child = property.value
      if (child !== null && typeof child === 'object') pending.push(child)
    }
    Object.freeze(current)
  }
  return value
}
