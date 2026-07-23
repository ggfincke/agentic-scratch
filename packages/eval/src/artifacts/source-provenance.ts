// packages/eval/src/artifacts/source-provenance.ts
// bounded source provenance & selected-project application policy

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RUNNER_OBSERVATION_SCHEMA_VERSION,
  sha256,
  type ObservationPlanV1,
  type Scenario,
} from '@scratch-agent/runner'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

export const MULTIMODAL_SELECTED_INPUT_MAX_BYTES = 50 * 1024 * 1024
export const MULTIMODAL_SELECTED_RUBRIC_MAX_BYTES = 1024 * 1024

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024
const MAX_SOURCE_LIST_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_ENTRIES = 4096
const MAX_SOURCE_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_SOURCE_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_EXECUTION_ARTIFACT_ENTRIES = 4096
const MAX_EXECUTION_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024
const MAX_EXECUTION_ARTIFACT_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_EXECUTION_ARTIFACT_MANIFEST_BYTES = 4 * 1024 * 1024
const REQUIRED_BROWSER_BUNDLES = [
  'packages/runner/dist/browser/official-page.js',
  'packages/runner/dist/browser/page.js',
] as const

interface SourceManifestEntryV1
{
  path: string
  kind: 'file' | 'symlink' | 'missing'
  mode: number | null
  byteLength: number | null
  sha256: string | null
  linkTarget: string | null
}

export interface SourceSnapshotV1
{
  schemaVersion: 1
  commit: string | null
  state: 'clean' | 'dirty' | 'unknown'
  treeSha256: string
  entries: SourceManifestEntryV1[]
  issue: string | null
}

interface ExecutionArtifactEntryV1
{
  path: string
  mode: number
  byteLength: number
  sha256: string
}

export interface ExecutionArtifactSnapshotV1
{
  schemaVersion: 1
  treeSha256: string
  entries: ExecutionArtifactEntryV1[]
  issue: string | null
}

export interface SourceManifestIdentityV1
{
  relativePath: string
  sha256: string
  byteLength: number
  entryCount: number
  treeSha256: string
}

export interface ExecutionArtifactManifestIdentityV1
{
  relativePath: string
  sha256: string
  byteLength: number
  entryCount: number
  treeSha256: string
}

interface MultimodalExecutionArtifactIdentityV1
{
  schemaVersion: 1
  startManifest: ExecutionArtifactManifestIdentityV1
  preAgentManifest: ExecutionArtifactManifestIdentityV1
  completionManifest: ExecutionArtifactManifestIdentityV1
  stableBeforeAgent: boolean
  stableAtCompletion: boolean
}

export interface MultimodalSourceIdentityV1
{
  revision: string
  commit: string | null
  state: SourceSnapshotV1['state']
  dirty: boolean | null
  startManifest: SourceManifestIdentityV1
  preAgentManifest: SourceManifestIdentityV1
  completionManifest: SourceManifestIdentityV1
  stableBeforeAgent: boolean
  stableAtCompletion: boolean
  executionArtifacts: MultimodalExecutionArtifactIdentityV1
}

function ensureDirectory(path: string): void
{
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

function writeExclusive(path: string, value: string): void
{
  ensureDirectory(dirname(path))
  writeFileSync(path, value, { flag: 'wx', mode: 0o600 })
  chmodSync(path, 0o600)
}

function portable(base: string, path: string): string
{
  return relative(base, path).split(sep).join('/')
}

function retainedPath(root: string, relativePath: string): string
{
  if (isAbsolute(relativePath))
    throw new Error('retained artifact path must be relative')
  const resolvedRoot = resolve(root)
  const path = resolve(resolvedRoot, relativePath)
  if (path !== resolvedRoot && !path.startsWith(`${resolvedRoot}${sep}`))
    throw new Error('retained artifact path escapes the run root')
  return path
}

export function requireRunRootOutsideSourceInventory(runRoot: string): void
{
  const fromRoot = relative(ROOT, runRoot)
  if (
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    return
  if (fromRoot.length === 0)
    throw new Error('Multimodal run root cannot be the repository root')
  try
  {
    execFileSync(
      'git',
      ['check-ignore', '--quiet', '--no-index', '--', fromRoot],
      { cwd: ROOT, stdio: 'ignore' }
    )
  }
  catch
  {
    throw new Error(
      'Multimodal runs inside the repository must use a git-ignored runs root'
    )
  }
}

export function readMultimodalBoundedRegularFile(
  path: string,
  maximumBytes: number,
  label: string,
  expectedBytes?: number
): Buffer
{
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new Error(`${label} has an invalid byte bound`)
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const descriptor = openSync(path, fsConstants.O_RDONLY | noFollow)
  try
  {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`${label} is not a regular file`)
    if (stat.size > maximumBytes)
      throw new Error(`${label} exceeds ${maximumBytes} bytes`)
    if (expectedBytes !== undefined && stat.size !== expectedBytes)
      throw new Error(
        `${label} has ${stat.size} bytes; expected ${expectedBytes}`
      )
    const bytes = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < bytes.byteLength)
    {
      const read = readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      )
      if (read === 0) throw new Error(`${label} changed while being read`)
      offset += read
    }
    const extra = Buffer.allocUnsafe(1)
    if (readSync(descriptor, extra, 0, 1, offset) !== 0)
      throw new Error(`${label} grew while being read`)
    return bytes
  }
  finally
  {
    closeSync(descriptor)
  }
}

function gitText(args: string[]): string
{
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_SOURCE_LIST_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

export function multimodalSourceSnapshot(): SourceSnapshotV1
{
  try
  {
    const commitBefore = gitText(['rev-parse', 'HEAD'])
    const listed = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: ROOT,
        maxBuffer: MAX_SOURCE_LIST_BYTES,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
    if (listed.byteLength > MAX_SOURCE_LIST_BYTES)
      throw new Error('source manifest path list exceeds its byte bound')
    const paths = listed
      .toString('utf8')
      .split('\0')
      .filter((path) => path.length > 0)
      .sort()
    if (paths.length > MAX_SOURCE_ENTRIES)
      throw new Error(`source manifest exceeds ${MAX_SOURCE_ENTRIES} entries`)
    let cumulativeBytes = 0
    const entries: SourceManifestEntryV1[] = paths.map((path) =>
    {
      const absolute = resolve(ROOT, path)
      if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${sep}`))
        throw new Error(`source manifest path escapes repository: ${path}`)
      if (!existsSync(absolute))
        return {
          path,
          kind: 'missing',
          mode: null,
          byteLength: null,
          sha256: null,
          linkTarget: null,
        }
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink())
      {
        const linkTarget = readlinkSync(absolute)
        const bytes = Buffer.from(linkTarget, 'utf8')
        cumulativeBytes += bytes.byteLength
        if (cumulativeBytes > MAX_SOURCE_TOTAL_BYTES)
          throw new Error('source manifest exceeds its cumulative byte bound')
        return {
          path,
          kind: 'symlink',
          mode: stat.mode & 0o777,
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
          linkTarget,
        }
      }
      if (!stat.isFile())
        throw new Error(`source manifest path is not a file: ${path}`)
      const bytes = readMultimodalBoundedRegularFile(
        absolute,
        MAX_SOURCE_FILE_BYTES,
        `source manifest file ${path}`,
        stat.size
      )
      cumulativeBytes += bytes.byteLength
      if (cumulativeBytes > MAX_SOURCE_TOTAL_BYTES)
        throw new Error('source manifest exceeds its cumulative byte bound')
      return {
        path,
        kind: 'file',
        mode: stat.mode & 0o777,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        linkTarget: null,
      }
    })
    const status = gitText([
      'status',
      '--porcelain',
      '--untracked-files=normal',
    ])
    const commitAfter = gitText(['rev-parse', 'HEAD'])
    const stableCommit = commitBefore === commitAfter
    return {
      schemaVersion: 1,
      commit: stableCommit ? commitBefore : null,
      state: stableCommit ? (status.length > 0 ? 'dirty' : 'clean') : 'unknown',
      treeSha256: sha256(Buffer.from(JSON.stringify(entries), 'utf8')),
      entries,
      issue: stableCommit ? null : 'HEAD changed while source was inventoried',
    }
  }
  catch (error)
  {
    const issue = unknownErrorMessage(error)
    return {
      schemaVersion: 1,
      commit: null,
      state: 'unknown',
      treeSha256: sha256(Buffer.from(`source-unavailable\0${issue}`, 'utf8')),
      entries: [],
      issue,
    }
  }
}

export function multimodalExecutionArtifactSnapshot(): ExecutionArtifactSnapshotV1
{
  try
  {
    const entries: ExecutionArtifactEntryV1[] = []
    let totalBytes = 0
    const visit = (directory: string, relativeDirectory: string): void =>
    {
      const directoryStat = lstatSync(directory)
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
        throw new Error(
          `execution artifact directory is not a real directory: ${relativeDirectory}`
        )
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name)
      ))
      {
        const absolute = join(directory, entry.name)
        const path = `${relativeDirectory}/${entry.name}`
        if (entry.isSymbolicLink())
          throw new Error(`execution artifact path is a symlink: ${path}`)
        if (entry.isDirectory())
        {
          visit(absolute, path)
          continue
        }
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue
        const stat = lstatSync(absolute)
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error(`execution artifact is not a regular file: ${path}`)
        const bytes = readMultimodalBoundedRegularFile(
          absolute,
          MAX_EXECUTION_ARTIFACT_FILE_BYTES,
          `execution artifact ${path}`,
          stat.size
        )
        totalBytes += bytes.byteLength
        if (totalBytes > MAX_EXECUTION_ARTIFACT_TOTAL_BYTES)
          throw new Error(
            'execution artifacts exceed their cumulative byte bound'
          )
        entries.push({
          path,
          mode: stat.mode & 0o777,
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        })
        if (entries.length > MAX_EXECUTION_ARTIFACT_ENTRIES)
          throw new Error(
            `execution artifacts exceed ${MAX_EXECUTION_ARTIFACT_ENTRIES} entries`
          )
      }
    }
    const packagesRoot = join(ROOT, 'packages')
    const packageEntries = readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of packageEntries)
    {
      const dist = join(packagesRoot, entry.name, 'dist')
      if (!existsSync(dist))
        throw new Error(
          `workspace execution artifacts are missing: ${entry.name}`
        )
      visit(dist, `packages/${entry.name}/dist`)
    }
    entries.sort((left, right) => left.path.localeCompare(right.path))
    const paths = new Set(entries.map((entry) => entry.path))
    for (const required of REQUIRED_BROWSER_BUNDLES)
      if (!paths.has(required))
        throw new Error(
          `required browser execution artifact is missing: ${required}`
        )
    if (entries.length === 0)
      throw new Error('workspace execution artifact inventory is empty')
    return {
      schemaVersion: 1,
      treeSha256: sha256(Buffer.from(JSON.stringify(entries), 'utf8')),
      entries,
      issue: null,
    }
  }
  catch (error)
  {
    const issue = unknownErrorMessage(error)
    return {
      schemaVersion: 1,
      treeSha256: sha256(
        Buffer.from(`execution-artifacts-unavailable\0${issue}`, 'utf8')
      ),
      entries: [],
      issue,
    }
  }
}

export function executionArtifactSnapshotIsAuthoritative(
  snapshot: ExecutionArtifactSnapshotV1
): boolean
{
  return snapshot.issue === null && snapshot.entries.length > 0
}

export function executionArtifactSnapshotsMatch(
  left: ExecutionArtifactSnapshotV1,
  right: ExecutionArtifactSnapshotV1
): boolean
{
  return (
    executionArtifactSnapshotIsAuthoritative(left) &&
    executionArtifactSnapshotIsAuthoritative(right) &&
    left.treeSha256 === right.treeSha256
  )
}

export function retainSourceSnapshot(
  runRoot: string,
  name: 'start' | 'pre-agent' | 'completion',
  snapshot: SourceSnapshotV1
): SourceManifestIdentityV1
{
  return retainSnapshot(runRoot, `source-manifest-${name}.json`, snapshot)
}

export function retainExecutionArtifactSnapshot(
  runRoot: string,
  name: 'start' | 'pre-agent' | 'completion',
  snapshot: ExecutionArtifactSnapshotV1
): ExecutionArtifactManifestIdentityV1
{
  return retainSnapshot(
    runRoot,
    `execution-artifacts-${name}.json`,
    snapshot
  )
}

function retainSnapshot(
  runRoot: string,
  filename: string,
  snapshot: {
    entries: readonly unknown[]
    treeSha256: string
  }
): SourceManifestIdentityV1
{
  const path = join(runRoot, filename)
  const text = JSON.stringify(snapshot, null, 2) + '\n'
  writeExclusive(path, text)
  return {
    relativePath: portable(runRoot, path),
    sha256: sha256(Buffer.from(text, 'utf8')),
    byteLength: Buffer.byteLength(text, 'utf8'),
    entryCount: snapshot.entries.length,
    treeSha256: snapshot.treeSha256,
  }
}

export function multimodalSourceIdentity(
  start: SourceSnapshotV1,
  startManifest: SourceManifestIdentityV1,
  preAgent: SourceSnapshotV1,
  preAgentManifest: SourceManifestIdentityV1,
  completion: SourceSnapshotV1,
  completionManifest: SourceManifestIdentityV1,
  executionStart: ExecutionArtifactSnapshotV1,
  executionStartManifest: ExecutionArtifactManifestIdentityV1,
  executionPreAgent: ExecutionArtifactSnapshotV1,
  executionPreAgentManifest: ExecutionArtifactManifestIdentityV1,
  executionCompletion: ExecutionArtifactSnapshotV1,
  executionCompletionManifest: ExecutionArtifactManifestIdentityV1
): MultimodalSourceIdentityV1
{
  const executionStableBeforeAgent = executionArtifactSnapshotsMatch(
    executionStart,
    executionPreAgent
  )
  const executionStableAtCompletion =
    executionStableBeforeAgent &&
    executionArtifactSnapshotsMatch(executionStart, executionCompletion)
  const stableBeforeAgent =
    sourceSnapshotsMatch(start, preAgent) && executionStableBeforeAgent
  const stableAtCompletion =
    stableBeforeAgent &&
    sourceSnapshotsMatch(start, completion) &&
    executionStableAtCompletion
  return {
    revision: `${start.commit ?? 'unknown'}${
      start.state === 'dirty'
        ? '+dirty'
        : start.state === 'unknown'
          ? '+unknown'
          : ''
    }@${start.treeSha256}`,
    commit: start.commit,
    state: start.state,
    dirty: start.state === 'unknown' ? null : start.state === 'dirty',
    startManifest,
    preAgentManifest,
    completionManifest,
    stableBeforeAgent,
    stableAtCompletion,
    executionArtifacts: {
      schemaVersion: 1,
      startManifest: executionStartManifest,
      preAgentManifest: executionPreAgentManifest,
      completionManifest: executionCompletionManifest,
      stableBeforeAgent: executionStableBeforeAgent,
      stableAtCompletion: executionStableAtCompletion,
    },
  }
}

export function sourceSnapshotIsAuthoritative(
  snapshot: SourceSnapshotV1
): boolean
{
  return (
    snapshot.issue === null &&
    snapshot.commit !== null &&
    snapshot.state !== 'unknown'
  )
}

export function sourceSnapshotsMatch(
  left: SourceSnapshotV1,
  right: SourceSnapshotV1
): boolean
{
  return (
    sourceSnapshotIsAuthoritative(left) &&
    sourceSnapshotIsAuthoritative(right) &&
    left.commit === right.commit &&
    left.state === right.state &&
    left.treeSha256 === right.treeSha256
  )
}

export function multimodalCurrentSourceIdentity(): {
  commit: string | null
  state: SourceSnapshotV1['state']
  treeSha256: string
  issue: string | null
  executionArtifactsTreeSha256: string
  executionArtifactsIssue: string | null
}
{
  const snapshot = multimodalSourceSnapshot()
  const executionArtifacts = multimodalExecutionArtifactSnapshot()
  return {
    commit: snapshot.commit,
    state: snapshot.state,
    treeSha256: snapshot.treeSha256,
    issue: snapshot.issue,
    executionArtifactsTreeSha256: executionArtifacts.treeSha256,
    executionArtifactsIssue: executionArtifacts.issue,
  }
}

export function verifyMultimodalRetainedSourceIdentity(
  runRoot: string,
  source: MultimodalSourceIdentityV1
): boolean
{
  try
  {
    const load = (identity: SourceManifestIdentityV1): SourceSnapshotV1 =>
    {
      const bytes = readMultimodalBoundedRegularFile(
        retainedPath(runRoot, identity.relativePath),
        MAX_SOURCE_MANIFEST_BYTES,
        `retained source manifest ${identity.relativePath}`,
        identity.byteLength
      )
      if (sha256(bytes) !== identity.sha256)
        throw new Error('retained source manifest hash does not match')
      const parsed = JSON.parse(bytes.toString('utf8')) as SourceSnapshotV1
      if (
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.entries) ||
        parsed.entries.length !== identity.entryCount ||
        parsed.treeSha256 !== identity.treeSha256 ||
        sha256(Buffer.from(JSON.stringify(parsed.entries), 'utf8')) !==
          parsed.treeSha256
      )
        throw new Error('retained source manifest identity is invalid')
      return parsed
    }
    const loadExecutionArtifacts = (
      identity: ExecutionArtifactManifestIdentityV1
    ): ExecutionArtifactSnapshotV1 =>
    {
      const bytes = readMultimodalBoundedRegularFile(
        retainedPath(runRoot, identity.relativePath),
        MAX_EXECUTION_ARTIFACT_MANIFEST_BYTES,
        `retained execution artifact manifest ${identity.relativePath}`,
        identity.byteLength
      )
      if (sha256(bytes) !== identity.sha256)
        throw new Error(
          'retained execution artifact manifest hash does not match'
        )
      const parsed = JSON.parse(
        bytes.toString('utf8')
      ) as ExecutionArtifactSnapshotV1
      const paths = new Set<string>()
      let totalBytes = 0
      if (
        parsed.schemaVersion !== 1 ||
        parsed.issue !== null ||
        !Array.isArray(parsed.entries) ||
        parsed.entries.length === 0 ||
        parsed.entries.length !== identity.entryCount ||
        parsed.entries.length > MAX_EXECUTION_ARTIFACT_ENTRIES ||
        parsed.treeSha256 !== identity.treeSha256 ||
        sha256(Buffer.from(JSON.stringify(parsed.entries), 'utf8')) !==
          parsed.treeSha256
      )
        throw new Error(
          'retained execution artifact manifest identity is invalid'
        )
      for (const entry of parsed.entries)
      {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          Object.keys(entry).sort().join('\0') !==
            ['byteLength', 'mode', 'path', 'sha256'].join('\0') ||
          typeof entry.path !== 'string' ||
          !entry.path.endsWith('.js') ||
          !entry.path.startsWith('packages/') ||
          !entry.path.includes('/dist/') ||
          portable(ROOT, retainedPath(ROOT, entry.path)) !== entry.path ||
          paths.has(entry.path) ||
          !Number.isSafeInteger(entry.mode) ||
          entry.mode < 0 ||
          entry.mode > 0o777 ||
          !Number.isSafeInteger(entry.byteLength) ||
          entry.byteLength < 0 ||
          entry.byteLength > MAX_EXECUTION_ARTIFACT_FILE_BYTES ||
          !/^[0-9a-f]{64}$/.test(entry.sha256)
        )
          throw new Error(
            'retained execution artifact manifest entry is invalid'
          )
        paths.add(entry.path)
        totalBytes += entry.byteLength
      }
      if (totalBytes > MAX_EXECUTION_ARTIFACT_TOTAL_BYTES)
        throw new Error('retained execution artifacts exceed their byte bound')
      for (const required of REQUIRED_BROWSER_BUNDLES)
        if (!paths.has(required))
          throw new Error(
            `retained execution artifact manifest omitted ${required}`
          )
      return parsed
    }
    const start = load(source.startManifest)
    const preAgent = load(source.preAgentManifest)
    const completion = load(source.completionManifest)
    const execution = source.executionArtifacts
    if (
      typeof execution !== 'object' ||
      execution === null ||
      execution.schemaVersion !== 1
    )
      throw new Error('retained execution artifact identity is invalid')
    const executionStart = loadExecutionArtifacts(execution.startManifest)
    const executionPreAgent = loadExecutionArtifacts(execution.preAgentManifest)
    const executionCompletion = loadExecutionArtifacts(
      execution.completionManifest
    )
    const expectedRevision = `${start.commit ?? 'unknown'}${
      start.state === 'dirty'
        ? '+dirty'
        : start.state === 'unknown'
          ? '+unknown'
          : ''
    }@${start.treeSha256}`
    const expectedDirty =
      start.state === 'unknown' ? null : start.state === 'dirty'
    return (
      source.startManifest.relativePath === 'source-manifest-start.json' &&
      source.preAgentManifest.relativePath ===
        'source-manifest-pre-agent.json' &&
      source.completionManifest.relativePath ===
        'source-manifest-completion.json' &&
      execution.startManifest.relativePath ===
        'execution-artifacts-start.json' &&
      execution.preAgentManifest.relativePath ===
        'execution-artifacts-pre-agent.json' &&
      execution.completionManifest.relativePath ===
        'execution-artifacts-completion.json' &&
      execution.stableBeforeAgent &&
      execution.stableAtCompletion &&
      executionStart.treeSha256 === executionPreAgent.treeSha256 &&
      executionStart.treeSha256 === executionCompletion.treeSha256 &&
      source.revision === expectedRevision &&
      source.dirty === expectedDirty &&
      source.stableBeforeAgent &&
      source.stableAtCompletion &&
      start.issue === null &&
      preAgent.issue === null &&
      completion.issue === null &&
      source.commit !== null &&
      start.commit === source.commit &&
      preAgent.commit === source.commit &&
      completion.commit === source.commit &&
      start.state === source.state &&
      preAgent.state === source.state &&
      completion.state === source.state &&
      start.treeSha256 === preAgent.treeSha256 &&
      start.treeSha256 === completion.treeSha256
    )
  }
  catch
  {
    return false
  }
}

export function multimodalSourceRevision(): string
{
  try
  {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim()
    return dirty ? `${head}+dirty` : head
  }
  catch
  {
    return 'unknown'
  }
}

export function multimodalSelectedCriteriaPath(): string
{
  return join(
    ROOT,
    'multimodal',
    'criteria',
    'selected-project-startup-v1.json'
  )
}

export function multimodalSelectedProjectScenario(): Scenario
{
  return {
    seed: 79,
    fixedDateMs: 1_700_000_000_000,
    maxTicks: 30,
    steps: [
      { do: 'snapshot', label: 'before-green-flag' },
      { do: 'greenFlag' },
      { do: 'snapshot', label: 'after-green-flag' },
      { do: 'wait', ticks: 30 },
      { do: 'snapshot', label: 'settled' },
    ],
  }
}

export function multimodalSelectedProjectObservationPlan(): ObservationPlanV1
{
  return {
    schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
    temporal: {
      firstTick: 0,
      lastTick: 30,
      everyTicks: 15,
      playbackFps: 10,
      maxFrames: 3,
      maxBytes: 10 * 1024 * 1024,
      derivedVideo: false,
    },
    cloneCounts: 'sampled',
  }
}
