// scripts/gates/check-package-boundaries.ts
// verify workspace dependency direction across manifests, references, & imports

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

interface PackageJson
{
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface TsConfig
{
  references?: Array<{ path: string }>
}

interface PackageFacts
{
  directory: string
  name: string
  shortName: string
  manifestEdges: Set<string>
  referenceEdges: Set<string>
  importEdges: Set<string>
}

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const PACKAGES_ROOT = join(REPOSITORY_ROOT, 'packages')
const WORKSPACE_PREFIX = '@scratch-agent/'

const ALLOWED_EDGES: Readonly<Record<string, readonly string[]>> = {
  sb3: [],
  ir: ['sb3'],
  validate: ['ir', 'sb3'],
  static: ['ir', 'sb3', 'validate'],
  runner: ['sb3'],
  model: ['runner', 'sb3'],
  mutate: ['ir', 'sb3'],
  eval: ['ir', 'model', 'mutate', 'runner', 'sb3', 'static', 'validate'],
  localize: ['eval', 'ir', 'runner', 'sb3'],
  edit: ['eval', 'ir', 'localize', 'sb3'],
  repair: ['eval', 'ir', 'localize', 'runner'],
  mcp: ['edit', 'eval', 'repair', 'runner', 'sb3'],
}

function json<T>(path: string): T
{
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function sourceFiles(directory: string): string[]
{
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }))
  {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
  }
  return files.sort()
}

function workspaceTarget(specifier: string): string | null
{
  if (!specifier.startsWith(WORKSPACE_PREFIX)) return null
  return specifier.slice(WORKSPACE_PREFIX.length).split('/')[0] ?? null
}

function importedWorkspacePackages(source: string): Set<string>
{
  const imports = new Set<string>()
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)['"](@scratch-agent\/[a-z0-9-]+(?:\/[^'"]*)?)['"]/g
  for (const match of source.matchAll(pattern))
  {
    const target = workspaceTarget(match[1]!)
    if (target) imports.add(target)
  }
  return imports
}

function facts(): PackageFacts[]
{
  const directories = readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_ROOT, entry.name))
    .sort()
  return directories.map((directory) =>
  {
    const manifest = json<PackageJson>(join(directory, 'package.json'))
    const config = json<TsConfig>(join(directory, 'tsconfig.json'))
    const shortName = manifest.name.slice(WORKSPACE_PREFIX.length)
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }
    const manifestEdges = new Set(
      Object.keys(dependencies)
        .map(workspaceTarget)
        .filter((entry): entry is string => entry !== null)
    )
    const referenceEdges = new Set(
      (config.references ?? []).map((entry) =>
        basename(resolve(directory, entry.path))
      )
    )
    const importEdges = new Set<string>()
    const sourceRoot = join(directory, 'src')
    for (const path of sourceFiles(sourceRoot))
    {
      const source = readFileSync(path, 'utf8')
      for (const target of importedWorkspacePackages(source))
      {
        if (target !== shortName) importEdges.add(target)
      }
      if (
        source.includes('scripts/review-annex') ||
        source.includes('/review/phase-8-a0') ||
        /(?:from\s*|import\s*\()\s*['"]scratch-blocks['"]/.test(source)
      )
      {
        throw new Error(
          `${relative(REPOSITORY_ROOT, path)} imports review-only authority`
        )
      }
    }
    return {
      directory,
      name: manifest.name,
      shortName,
      manifestEdges,
      referenceEdges,
      importEdges,
    }
  })
}

function sorted(values: Iterable<string>): string[]
{
  return [...values].sort()
}

function verifyEdges(packages: PackageFacts[]): string[]
{
  const problems: string[] = []
  const known = new Set(packages.map((entry) => entry.shortName))
  for (const entry of packages)
  {
    const allowed = new Set(ALLOWED_EDGES[entry.shortName] ?? [])
    if (!(entry.shortName in ALLOWED_EDGES))
    {
      problems.push(`unapproved workspace package: ${entry.shortName}`)
      continue
    }
    for (const [kind, edges] of [
      ['manifest', entry.manifestEdges],
      ['reference', entry.referenceEdges],
      ['import', entry.importEdges],
    ] as const)
    {
      for (const target of edges)
      {
        if (!known.has(target))
        {
          problems.push(`${entry.shortName} ${kind} names unknown ${target}`)
        }
        else if (!allowed.has(target))
        {
          problems.push(
            `${entry.shortName} ${kind} edge to ${target} is forbidden`
          )
        }
      }
    }
    for (const target of entry.importEdges)
    {
      if (!entry.manifestEdges.has(target))
      {
        problems.push(
          `${entry.shortName} imports ${target} without a manifest dependency`
        )
      }
      if (!entry.referenceEdges.has(target))
      {
        problems.push(
          `${entry.shortName} imports ${target} without a TypeScript reference`
        )
      }
    }
    for (const target of entry.manifestEdges)
    {
      if (!entry.referenceEdges.has(target))
      {
        problems.push(
          `${entry.shortName} declares ${target} without a TypeScript reference`
        )
      }
    }
  }
  return problems
}

function verifyScriptsAvoidPackageInternals(): string[]
{
  const scriptsRoot = join(REPOSITORY_ROOT, 'scripts')
  const problems: string[] = []
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\()\s*['"][^'"]*packages\/[a-z0-9-]+\/src\//
  for (const path of sourceFiles(scriptsRoot))
  {
    const source = readFileSync(path, 'utf8')
    if (pattern.test(source))
    {
      problems.push(
        `${relative(REPOSITORY_ROOT, path)} deep-imports packages/*/src`
      )
    }
  }
  return problems
}

function verifyAcyclic(packages: PackageFacts[]): string[]
{
  const edges = new Map(
    packages.map((entry) => [entry.shortName, sorted(entry.manifestEdges)])
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const problems = new Set<string>()

  function visit(node: string, path: string[]): void
  {
    if (visiting.has(node))
    {
      const start = path.indexOf(node)
      problems.add(
        `dependency cycle: ${[...path.slice(start), node].join(' -> ')}`
      )
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    for (const target of edges.get(node) ?? []) visit(target, [...path, node])
    visiting.delete(node)
    visited.add(node)
  }

  for (const node of sorted(edges.keys())) visit(node, [])
  return sorted(problems)
}

function main(): void
{
  const packages = facts()
  const problems = [
    ...verifyEdges(packages),
    ...verifyAcyclic(packages),
    ...verifyScriptsAvoidPackageInternals(),
  ]
  if (problems.length > 0)
  {
    for (const problem of problems) process.stderr.write(`${problem}\n`)
    process.exitCode = 1
    return
  }
  const manifestEdgeCount = packages.reduce(
    (count, entry) => count + entry.manifestEdges.size,
    0
  )
  const importEdgeCount = packages.reduce(
    (count, entry) => count + entry.importEdges.size,
    0
  )
  process.stdout.write(
    `package boundaries ok: ${packages.length} packages, ` +
      `${manifestEdgeCount} manifest edges, ${importEdgeCount} import edges, ` +
      '0 cycles, 0 violations\n'
  )
}

main()
