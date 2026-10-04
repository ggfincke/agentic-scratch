// packages/mcp/src/development/config.ts
// load operator-owned development roots & limits from a bounded pinned file

import { isAbsolute } from 'node:path'
import { readOperatorWorkbenchConfigurationV1 } from '../authoring/config.js'

export async function readDevelopmentHostConfigurationV1(
  path: string,
  expectedSha256?: string
)
{
  const loaded = await readOperatorWorkbenchConfigurationV1(
    path,
    expectedSha256
  )
  const raw = loaded.value
  if (
    raw.schemaVersion !== 1 ||
    Object.keys(raw).some(
      (key) => !['schemaVersion', 'permissions'].includes(key)
    ) ||
    !raw.permissions ||
    typeof raw.permissions !== 'object' ||
    Array.isArray(raw.permissions)
  )
    throw new Error(
      'development operator configuration requires schemaVersion 1 and permissions'
    )
  const permissions = raw.permissions as Record<string, unknown>
  if (
    Object.keys(permissions).some(
      (key) =>
        !['sourceRoots', 'evidenceRoot', 'limits', 'profiles'].includes(key)
    )
  )
    throw new Error('development operator permissions contain an unknown field')
  const roots = permissions.sourceRoots
  if (
    !Array.isArray(roots) ||
    roots.length < 1 ||
    roots.length > 16 ||
    roots.some(
      (root) =>
        typeof root !== 'string' || root.length > 4096 || !isAbsolute(root)
    )
  )
    throw new Error(
      'sourceRoots requires 1..16 absolute operator-owned directories'
    )
  if (
    typeof permissions.evidenceRoot !== 'string' ||
    permissions.evidenceRoot.length > 4096 ||
    !isAbsolute(permissions.evidenceRoot)
  )
    throw new Error(
      'evidenceRoot requires an absolute operator-owned directory'
    )
  return { ...loaded, permissions: structuredClone(permissions) }
}
