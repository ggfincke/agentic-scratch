// packages/mcp/src/authoring/config.ts
// load operator-selected workbench permissions without source-controlled grants

import { open } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { scanStrictJson } from '@scratch-agent/sb3'
import type { AuthoringOperatorPermissionsV1 } from '@scratch-agent/edit'

export interface AuthoringHostConfigurationV1
{
  readonly schemaVersion: 1
  readonly permissions: AuthoringOperatorPermissionsV1
}

export async function readOperatorWorkbenchConfigurationV1(
  path: string,
  expectedSha256?: string
)
{
  const file = await open(resolve(path), 'r')
  let bytes: Buffer
  try
  {
    const buffer = Buffer.alloc(64 * 1024 + 1)
    let offset = 0
    while (offset < buffer.length)
    {
      const read = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      )
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    if (offset > 64 * 1024)
      throw new Error('operator workbench configuration exceeds 64 KiB')
    bytes = buffer.subarray(0, offset)
  }
  finally
  {
    await file.close()
  }
  const sha256 = sha256Hex(bytes)
  if (
    expectedSha256 !== undefined &&
    (!/^[0-9a-f]{64}$/u.test(expectedSha256) || expectedSha256 !== sha256)
  )
    throw new Error(
      'operator workbench configuration differs from its pinned SHA-256'
    )
  const value = scanStrictJson(bytes.toString('utf8'), {
    maxDepth: 16,
    maxMembersPerContainer: 128,
    maxNodes: 4096,
  }).value
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('operator workbench configuration must be an object')
  const raw = value as Record<string, unknown>
  return { value: raw, sha256, path: resolve(path) }
}

export async function readAuthoringHostConfigurationV1(
  path: string,
  expectedSha256?: string
)
{
  const { value: raw, sha256 } = await readOperatorWorkbenchConfigurationV1(
    path,
    expectedSha256
  )
  if (
    raw.schemaVersion !== 1 ||
    Object.keys(raw).some(
      (key) => !['schemaVersion', 'permissions'].includes(key)
    )
  )
    throw new Error(
      'operator workbench configuration requires schemaVersion 1 and permissions'
    )
  if (
    !raw.permissions ||
    typeof raw.permissions !== 'object' ||
    Array.isArray(raw.permissions)
  )
    throw new Error('operator permissions must be an object')
  const permissions = raw.permissions as Record<string, unknown>
  if (
    Object.keys(permissions).some(
      (key) =>
        ![
          'sourceRoots',
          'evidenceRoot',
          'outputRoots',
          'limits',
          'archiveLimits',
          'editLimits',
          'preprocessingLimits',
          'audioLimits',
          'ffmpeg',
        ].includes(key)
    )
  )
    throw new Error('operator permissions contain an unknown field')
  for (const key of ['sourceRoots', 'outputRoots'])
    if (
      !Array.isArray(permissions[key]) ||
      permissions[key].length === 0 ||
      permissions[key].length > 16 ||
      permissions[key].some(
        (root: unknown) =>
          typeof root !== 'string' || root.length > 4096 || !isAbsolute(root)
      )
    )
      throw new Error(
        `${key} requires 1..16 absolute operator-owned directories`
      )
  if (
    typeof permissions.evidenceRoot !== 'string' ||
    permissions.evidenceRoot.length > 4096 ||
    !isAbsolute(permissions.evidenceRoot)
  )
    throw new Error('evidenceRoot must be an absolute operator-owned directory')
  return {
    configuration: structuredClone(
      raw
    ) as unknown as AuthoringHostConfigurationV1,
    sha256,
    path: resolve(path),
  }
}
