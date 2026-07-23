// packages/runner/src/report/package-manifest.ts
// locate dependency package manifests for runtime assets & version identity

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const requirePkg = createRequire(import.meta.url)
const MAX_PACKAGE_MANIFEST_DEPTH = 10

interface ResolvedPackageManifest
{
  root: string
  entryPath: string
  version: unknown
}

export function resolvePackageManifest(name: string): ResolvedPackageManifest
{
  const entryPath = requirePkg.resolve(name)
  let directory = dirname(entryPath)
  for (let depth = 0; depth < MAX_PACKAGE_MANIFEST_DEPTH; depth++)
  {
    const path = join(directory, 'package.json')
    if (existsSync(path))
    {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        name?: unknown
        version?: unknown
      }
      if (manifest.name === name)
        return { root: directory, entryPath, version: manifest.version }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`cannot resolve package root for ${name}`)
}
