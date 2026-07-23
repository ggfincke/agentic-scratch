// packages/sb3/src/json/scratch-record.ts
// prototype-safe own-property access for untrusted Scratch record maps

export type ScratchRecord<T = unknown> = Record<string, T>

export function isScratchRecord(value: unknown): value is ScratchRecord
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function hasScratchRecordKey(
  record: object | undefined,
  key: string
): boolean
{
  if (record === undefined) return false
  const property = Object.getOwnPropertyDescriptor(record, key)
  return (
    property !== undefined &&
    property.enumerable === true &&
    'value' in property
  )
}

export function scratchRecordValue<T>(
  record: ScratchRecord<T> | undefined,
  key: string
): T | undefined
{
  if (record === undefined) return undefined
  const property = Object.getOwnPropertyDescriptor(record, key)
  return property !== undefined &&
    property.enumerable === true &&
    'value' in property
    ? (property.value as T)
    : undefined
}

export function scratchRecordKeys(record: object | undefined): string[]
{
  if (record === undefined) return []
  return Object.keys(record).filter((key) =>
  {
    const property = Object.getOwnPropertyDescriptor(record, key)
    return (
      property !== undefined &&
      property.enumerable === true &&
      'value' in property
    )
  })
}

export function scratchRecordEntries<T>(
  record: ScratchRecord<T> | undefined
): Array<[string, T]>
{
  if (record === undefined) return []
  const entries: Array<[string, T]> = []
  for (const key of Object.keys(record))
  {
    const property = Object.getOwnPropertyDescriptor(record, key)
    if (
      property !== undefined &&
      property.enumerable === true &&
      'value' in property
    )
    {
      entries.push([key, property.value as T])
    }
  }
  return entries
}

export function defineScratchRecordValue<T>(
  record: ScratchRecord<T>,
  key: string,
  value: T
): void
{
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

export function deleteScratchRecordValue(
  record: ScratchRecord,
  key: string
): boolean
{
  if (!Object.hasOwn(record, key)) return false
  return Reflect.deleteProperty(record, key)
}

export function createScratchRecord<T>(
  entries: Iterable<readonly [string, T]> = []
): ScratchRecord<T>
{
  const record = Object.create(null) as ScratchRecord<T>
  for (const [key, value] of entries)
  {
    defineScratchRecordValue(record, key, value)
  }
  return record
}
