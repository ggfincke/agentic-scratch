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

export interface ProjectArtifactTextBatchEntry
{
  relativePath: string
  kind: string
  mediaType: string
  value: string
}

interface ProjectArtifactStoreOptions
{
  maxBytes?: number
  requireNewRoot?: boolean
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
    if (options.requireNewRoot)
    {
      mkdirSync(dirname(this.root), { recursive: true, mode: 0o700 })
      mkdirSync(this.root, { mode: 0o700 })
    }
    else mkdirSync(this.root, { recursive: true, mode: 0o700 })
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

  writeTextBatch(
    entries: readonly ProjectArtifactTextBatchEntry[]
  ): ProjectArtifactReference[]
  {
    if (entries.length === 0) return []
    const transactionId = `${process.pid}-${randomUUID()}`
    const prepared = entries.map((entry) =>
    {
      const path = this.absolutePath(entry.relativePath)
      this.ensureParent(path)
      const bytes = Buffer.from(entry.value, 'utf-8')
      return {
        ...entry,
        bytes,
        id: artifactId(posixPath(entry.relativePath)),
        path,
        temp: `${path}.tmp-${transactionId}`,
        backup: `${path}.bak-${transactionId}`,
      }
    })
    if (new Set(prepared.map((entry) => entry.id)).size !== prepared.length)
      throw new Error('artifact batch paths must be unique')

    if (this.maxBytes !== null)
    {
      const projected = new Map(
        [...this.catalog.values()].map((artifact) => [
          artifact.id,
          artifact.byteLength,
        ])
      )
      for (const entry of prepared)
        projected.set(entry.id, entry.bytes.byteLength)
      let projectedBytes = 0
      for (const byteLength of projected.values()) projectedBytes += byteLength
      if (projectedBytes > this.maxBytes)
        throw new ProjectArtifactStoreLimitError(this.maxBytes)
    }

    const backedUp: typeof prepared = []
    const installed: typeof prepared = []
    try
    {
      for (const entry of prepared)
        writeFileSync(entry.temp, entry.bytes, { flag: 'wx', mode: 0o600 })
      for (const entry of prepared)
      {
        try
        {
          lstatSync(entry.path)
          renameSync(entry.path, entry.backup)
          backedUp.push(entry)
        }
        catch (error)
        {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ))
            throw error
        }
      }
      for (const entry of prepared)
      {
        this.installPreparedArtifact(entry.temp, entry.path)
        installed.push(entry)
      }
      for (const entry of backedUp)
      {
        try
        {
          unlinkSync(entry.backup)
        }
        catch
        {
          // committed artifacts remain authoritative if backup cleanup fails
        }
      }
    }
    catch (error)
    {
      for (const entry of [...installed].reverse())
      {
        try
        {
          unlinkSync(entry.path)
        }
        catch
        {
          // rollback is best-effort after the original batch failure
        }
      }
      for (const entry of [...backedUp].reverse())
      {
        try
        {
          renameSync(entry.backup, entry.path)
        }
        catch
        {
          // rollback is best-effort after the original batch failure
        }
      }
      for (const entry of prepared)
      {
        for (const path of [entry.temp, entry.backup])
        {
          try
          {
            unlinkSync(path)
          }
          catch
          {
            // cleanup is best-effort after the original batch failure
          }
        }
      }
      throw error
    }

    const references = prepared.map((entry): ProjectArtifactReference => ({
      id: entry.id,
      kind: entry.kind,
      path: posixPath(entry.relativePath),
      mediaType: entry.mediaType,
      byteLength: entry.bytes.byteLength,
      sha256: sha256(entry.bytes),
    }))
    for (const reference of references)
      this.catalog.set(reference.id, reference)
    return references
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
      const projectedBytes = catalogBytes - replacedBytes + value.byteLength
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

  protected installPreparedArtifact(
    temporaryPath: string,
    finalPath: string
  ): void
  {
    renameSync(temporaryPath, finalPath)
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
