// packages/sb3/src/media/assets.ts
// validate & deterministically normalize archive assets by exact path & bytes

import type { Asset } from '../admission/admission.js'
import { isValidSb3EntryPath } from '../admission/limits.js'

export class AssetPathInvalidError extends Error
{
  readonly path: string

  constructor(path: string, reason: 'invalid' | 'reserved')
  {
    super(
      reason === 'reserved'
        ? `asset path ${JSON.stringify(path)} is reserved for builder-owned project JSON`
        : `asset path ${JSON.stringify(path)} is not a valid flat SB3 entry path`
    )
    this.name = 'AssetPathInvalidError'
    this.path = path
  }
}

export class AssetPathConflictError extends Error
{
  readonly path: string

  constructor(path: string)
  {
    super(`asset path ${JSON.stringify(path)} has conflicting payload bytes`)
    this.name = 'AssetPathConflictError'
    this.path = path
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean
{
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index++)
  {
    if (left[index] !== right[index]) return false
  }
  return true
}

export function normalizeAssetsByPath(assets: readonly Asset[]): Asset[]
{
  const byPath = new Map<string, Asset>()
  for (const asset of assets)
  {
    if (asset.path === 'project.json')
      throw new AssetPathInvalidError(asset.path, 'reserved')
    if (!isValidSb3EntryPath(asset.path))
      throw new AssetPathInvalidError(asset.path, 'invalid')
    const current = byPath.get(asset.path)
    if (!current)
    {
      byPath.set(asset.path, asset)
      continue
    }
    if (!equalBytes(current.bytes, asset.bytes))
    {
      throw new AssetPathConflictError(asset.path)
    }
  }
  return [...byPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
}
