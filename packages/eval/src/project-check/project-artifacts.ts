// packages/eval/src/project-check/project-artifacts.ts
// write project evidence atomically beneath one run root & catalog safe references

import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { isPathWithinRootV1 } from '../artifacts/path-containment.js'
import { sha256 } from '../core/sha256.js'

export interface ProjectArtifactReference
{
  id: string
  kind: string
  path: string
  mediaType: string
  byteLength: number
  sha256: string
}

interface ProjectArtifactStoreOptions
{
  maxBytes?: number
}

export class ProjectArtifactStoreLimitError extends Error
{
  readonly maxBytes: number

  constructor(maxBytes: number)
  {
    super(`project artifact store exceeds its ${maxBytes} byte limit`)
    this.name = 'ProjectArtifactStoreLimitError'
    this.maxBytes = maxBytes
  }
}

function posixPath(path: string): string
{
  return path.split(sep).join('/')
}

function artifactId(path: string): string
{
  return `artifact-${sha256(path).slice(0, 24)}`
}

export class ProjectArtifactStore
{
  readonly root: string
  private readonly catalog = new Map<string, ProjectArtifactReference>()
  private readonly maxBytes: number | null

  constructor(root: string, options: ProjectArtifactStoreOptions = {})
  {
    this.root = resolve(root)
    const maxBytes = options.maxBytes
    if (
      maxBytes !== undefined &&
      (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    )
    {
      throw new Error('project artifact maxBytes must be a positive integer')
    }
    this.maxBytes = maxBytes ?? null
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    if (!lstatSync(this.root).isDirectory())
    {
      throw new Error('project artifact root is not a directory')
    }
  }

  references(): ProjectArtifactReference[]
  {
    return [...this.catalog.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    )
  }

  absolutePath(relativePath: string): string
  {
    if (
      relativePath.length === 0 ||
      isAbsolute(relativePath) ||
      relativePath.includes('\0')
    )
    {
      throw new Error('artifact path must be a nonempty relative path')
    }
    const path = resolve(this.root, relativePath)
    if (!isPathWithinRootV1(this.root, path, { allowEqual: false }))
    {
      throw new Error('artifact path escapes the run root')
    }
    return path
  }

  writeJson(
    relativePath: string,
    kind: string,
    value: unknown
  ): ProjectArtifactReference
  {
    return this.writeText(
      relativePath,
      kind,
      'application/json',
      JSON.stringify(value, null, 2) + '\n'
    )
  }

  writeText(
    relativePath: string,
    kind: string,
    mediaType: string,
    value: string
  ): ProjectArtifactReference
  {
    return this.writeBytes(
      relativePath,
      kind,
      mediaType,
      Buffer.from(value, 'utf-8')
    )
  }

  writeBytes(
    relativePath: string,
    kind: string,
    mediaType: string,
    value: Uint8Array
  ): ProjectArtifactReference
  {
    const id = artifactId(posixPath(relativePath))
    if (this.maxBytes !== null)
    {
      const replacedBytes = this.catalog.get(id)?.byteLength ?? 0
      let catalogBytes = 0
      for (const artifact of this.catalog.values())
        catalogBytes += artifact.byteLength
      const projectedBytes =
        catalogBytes - replacedBytes + value.byteLength
      if (projectedBytes > this.maxBytes)
      {
        throw new ProjectArtifactStoreLimitError(this.maxBytes)
      }
    }
    const path = this.absolutePath(relativePath)
    this.ensureParent(path)
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
    try
    {
      writeFileSync(temp, value, { flag: 'wx', mode: 0o600 })
      renameSync(temp, path)
    }
    catch (error)
    {
      try
      {
        unlinkSync(temp)
      }
      catch
      {
        // cleanup is best-effort after the original write failure
      }
      throw error
    }
    const ref: ProjectArtifactReference = {
      id,
      kind,
      path: posixPath(relativePath),
      mediaType,
      byteLength: value.byteLength,
      sha256: sha256(value),
    }
    this.catalog.set(ref.id, ref)
    return ref
  }

  removeTree(relativePath: string): void
  {
    const path = this.absolutePath(relativePath)
    const prefix = posixPath(relative(this.root, path))
    rmSync(path, { recursive: true, force: true })
    for (const artifact of this.catalog.values())
    {
      if (artifact.path === prefix || artifact.path.startsWith(`${prefix}/`))
      {
        this.catalog.delete(artifact.id)
      }
    }
  }

  private ensureParent(path: string): void
  {
    const parent = dirname(path)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const rel = relative(this.root, parent)
    let current = this.root
    for (const part of rel === '' ? [] : rel.split(sep))
    {
      current = resolve(current, part)
      const stat = lstatSync(current)
      if (!stat.isDirectory() || stat.isSymbolicLink())
      {
        throw new Error('artifact parent must contain only real directories')
      }
    }
  }
}
