// packages/sb3/src/admission/limits.ts
// resource limits for explicitly selected .sb3 archives before parsing or execution

export interface Sb3Limits
{
  maxCompressedBytes: number
  maxEntries: number
  maxProjectJsonBytes: number
  maxAssetBytes: number
  maxTotalAssetBytes: number
}

export type Sb3LimitOptions = Partial<Sb3Limits>

export const DEFAULT_SB3_LIMITS: Readonly<Sb3Limits> = Object.freeze({
  maxCompressedBytes: 50 * 1024 * 1024,
  maxEntries: 4096,
  maxProjectJsonBytes: 10 * 1024 * 1024,
  maxAssetBytes: 25 * 1024 * 1024,
  maxTotalAssetBytes: 100 * 1024 * 1024,
})

// the most an edit admission or a workspace build may raise each limit to
export const HARD_SB3_LIMITS: Readonly<Sb3Limits> = Object.freeze({
  maxCompressedBytes: 512 * 1024 * 1024,
  maxEntries: 64_000,
  maxProjectJsonBytes: 128 * 1024 * 1024,
  maxAssetBytes: 25 * 1024 * 1024,
  maxTotalAssetBytes: 1024 * 1024 * 1024,
})

function assertLimit(
  name: keyof Sb3Limits,
  value: number,
  minimum: number
): void
{
  if (!Number.isSafeInteger(value) || value < minimum)
  {
    throw new RangeError(
      `${name} must be a finite safe integer greater than or equal to ${minimum}`
    )
  }
}

export function resolveSb3Limits(opts: Sb3LimitOptions = {}): Sb3Limits
{
  const limits = { ...DEFAULT_SB3_LIMITS, ...opts }
  assertLimit('maxCompressedBytes', limits.maxCompressedBytes, 0)
  assertLimit('maxEntries', limits.maxEntries, 1)
  assertLimit('maxProjectJsonBytes', limits.maxProjectJsonBytes, 0)
  assertLimit('maxAssetBytes', limits.maxAssetBytes, 0)
  assertLimit('maxTotalAssetBytes', limits.maxTotalAssetBytes, 0)
  return limits
}

export function resolveHardBoundedSb3Limits(
  opts: Sb3LimitOptions = {}
): Sb3Limits
{
  const limits = resolveSb3Limits(opts)
  for (const key of Object.keys(limits) as Array<keyof Sb3Limits>)
  {
    if (limits[key] > HARD_SB3_LIMITS[key])
    {
      throw new RangeError(`${key} cannot exceed ${HARD_SB3_LIMITS[key]}`)
    }
  }
  return limits
}

export function isValidSb3EntryPath(path: string): boolean
{
  return !(
    path.length === 0 ||
    path.includes('\0') ||
    path.includes('/') ||
    path.includes('\\') ||
    path === '.' ||
    path === '..'
  )
}
