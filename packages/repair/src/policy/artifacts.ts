// packages/repair/src/policy/artifacts.ts
// write portable incremental repair artifacts & exact accepted bytes

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  isPathWithinRootV1,
  type BaselineEvaluation,
  type CandidatePipelineEvaluation,
} from '@scratch-agent/eval'
import type { ProjectDelta, SemanticPatch } from '@scratch-agent/ir'

import { atomicWrite } from '../internal/atomic-write.js'
import type {
  ArtifactIdentity,
  RepairProposal,
  RepairRequest,
} from './contracts.js'
import { hashJson } from './contracts.js'
import {
  artifactSafeProjection,
  durableProposalProjection,
} from './redaction.js'
import {
  baselineEvaluationProjection,
  candidateEvaluationProjection,
  repairReportJson,
  repairReportMarkdown,
  repairRequestProjection,
  type RepairReport,
} from './report.js'

interface RepairArtifactStoreOptions
{
  sessionId: string
  runsRoot?: string
}

interface ReportArtifactPaths
{
  json: string
  markdown: string
}

export interface AttemptArtifactLayout
{
  request: string
  proposal: string
  candidate: string
  delta: string
  evaluation: string
  preservation: string
  screenshots: string
}

export class RepairArtifactStoreError extends Error
{
  constructor(
    readonly code: 'artifact-root-exists' | 'artifact-path-unsafe',
    message: string
  )
  {
    super(message)
  }
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function validSegment(value: string): boolean
{
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
}

function attemptSegment(number: number): string
{
  if (!Number.isSafeInteger(number) || number < 1 || number > 999)
  {
    throw new RangeError('attempt number must be an integer from 1 to 999')
  }
  return String(number).padStart(3, '0')
}

function serializeJson(value: unknown): string
{
  const serialized = JSON.stringify(
    artifactSafeProjection(value).value,
    null,
    2
  )
  if (serialized === undefined)
  {
    throw new TypeError('artifact value is not serializable JSON')
  }
  return `${serialized}\n`
}

export class RepairArtifactStore
{
  readonly runId: string
  readonly root: string
  private readonly realRoot: string

  constructor(options: RepairArtifactStoreOptions)
  {
    if (!validSegment(options.sessionId))
    {
      throw new Error('sessionId must be a filesystem-safe segment')
    }
    this.runId = `repair-${options.sessionId}`
    const runsRoot = resolve(options.runsRoot ?? 'runs')
    this.root = resolve(runsRoot, this.runId)
    mkdirSync(runsRoot, { recursive: true, mode: 0o700 })
    if (existsSync(this.root))
    {
      throw new RepairArtifactStoreError(
        'artifact-root-exists',
        'repair session artifact root already exists'
      )
    }
    mkdirSync(this.root, { mode: 0o700 })
    this.realRoot = realpathSync(this.root)
    for (const path of ['baseline', 'attempts', 'accepted', 'diffs'])
      this.ensureDirectory(path)
  }

  portablePath(path: string): string
  {
    const candidate = isAbsolute(path)
      ? resolve(path)
      : resolve(this.root, path)
    const result = relative(this.root, candidate)
    if (
      result.length === 0 ||
      result === '..' ||
      result.startsWith(`..${sep}`) ||
      isAbsolute(result)
    )
    {
      throw new Error('artifact path escapes the repair run root')
    }
    return result.split(sep).join('/')
  }

  attemptScreenshotsDirectory(number: number): string
  {
    return this.ensureDirectory(
      join('attempts', attemptSegment(number), 'screenshots')
    )
  }

  baselineScreenshotsDirectory(): string
  {
    return this.ensureDirectory(join('baseline', 'screenshots'))
  }

  attemptArtifactPaths(number: number): AttemptArtifactLayout
  {
    const base = `attempts/${attemptSegment(number)}`
    return {
      request: `${base}/request.json`,
      proposal: `${base}/proposal.json`,
      candidate: `${base}/candidate.sb3`,
      delta: `${base}/delta.json`,
      evaluation: `${base}/evaluation.json`,
      preservation: `${base}/preservation.json`,
      screenshots: `${base}/screenshots`,
    }
  }

  writeInput(bytes: Uint8Array): ArtifactIdentity
  {
    return this.writeBytes('input.sb3', bytes)
  }

  writeBaselineEvaluation(evaluation: BaselineEvaluation): string
  {
    const path = 'baseline/evaluation.json'
    this.writeJson(
      path,
      baselineEvaluationProjection(evaluation, (entry) =>
        this.portablePath(entry)
      )
    )
    return path
  }

  writeAttemptRequest(number: number, request: RepairRequest): string
  {
    this.attemptScreenshotsDirectory(number)
    const path = this.attemptArtifactPaths(number).request
    this.writeJson(
      path,
      repairRequestProjection(request, (entry) => this.portablePath(entry))
    )
    return path
  }

  writeAttemptProposal(
    number: number,
    proposal: RepairProposal | null,
    rawResponse: unknown,
    originalSha256: string | null
  ): string
  {
    const path = this.attemptArtifactPaths(number).proposal
    this.writeJson(
      path,
      proposalArtifactValue(proposal, rawResponse, originalSha256)
    )
    return path
  }

  writeAttemptCandidate(number: number, bytes: Uint8Array): ArtifactIdentity
  {
    return this.writeBytes(this.attemptArtifactPaths(number).candidate, bytes)
  }

  writeAttemptDelta(number: number, delta: ProjectDelta): string
  {
    const path = this.attemptArtifactPaths(number).delta
    this.writeJson(path, delta)
    return path
  }

  writeAttemptEvaluation(
    number: number,
    evaluation: CandidatePipelineEvaluation
  ): string
  {
    const path = this.attemptArtifactPaths(number).evaluation
    this.writeJson(
      path,
      candidateEvaluationProjection(evaluation, (entry) =>
        this.portablePath(entry)
      )
    )
    return path
  }

  writeAttemptPreservation(number: number, preservation: unknown): string
  {
    const path = this.attemptArtifactPaths(number).preservation
    this.writeJson(path, preservation)
    return path
  }

  promoteAttemptCandidate(
    number: number,
    expected: Pick<ArtifactIdentity, 'sha256' | 'byteLength'>
  ): ArtifactIdentity
  {
    const source = this.checkedPath(
      this.attemptArtifactPaths(number).candidate,
      false
    )
    return this.copyAccepted(source, expected)
  }

  promoteInput(
    expected: Pick<ArtifactIdentity, 'sha256' | 'byteLength'>
  ): ArtifactIdentity
  {
    return this.copyAccepted(this.checkedPath('input.sb3', false), expected)
  }

  writeAcceptedDiffs(
    patch: SemanticPatch,
    delta: ProjectDelta
  ): {
    semanticPatch: string
    projectDelta: string
  }
  {
    const semanticPatch = 'diffs/semantic-patch.json'
    const projectDelta = 'diffs/project-delta.json'
    this.writeJson(semanticPatch, patch)
    this.writeJson(projectDelta, delta)
    return { semanticPatch, projectDelta }
  }

  writeReports(report: RepairReport): ReportArtifactPaths
  {
    this.assertPortableReportPaths(report)
    const portable = artifactSafeProjection(report).value
    const json = repairReportJson(portable)
    const markdown = repairReportMarkdown(portable)
    if (json.includes(this.root) || markdown.includes(this.root))
    {
      throw new Error('repair report contains an absolute run-root path')
    }
    this.writeText('report.md', markdown)
    this.writeText('report.json', json)
    return { json: 'report.json', markdown: 'report.md' }
  }

  revokeAcceptance(): boolean
  {
    try
    {
      for (const path of [
        'accepted/candidate.sb3',
        'diffs/semantic-patch.json',
        'diffs/project-delta.json',
      ])
      {
        const absolute = this.checkedPath(path, false, true)
        if (existsSync(absolute)) unlinkSync(absolute)
      }
      return true
    }
    catch
    {
      return false
    }
  }

  discardRun(): void
  {
    rmSync(this.root, { recursive: true, force: true })
  }

  private assertPortableReportPaths(report: RepairReport): void
  {
    const paths = [
      report.input.artifact.path,
      ...report.input.assetManifest.map((asset) => asset.path),
      report.accepted?.artifact.path,
      report.artifacts.input,
      report.artifacts.baselineEvaluation,
      report.artifacts.acceptedCandidate,
      report.artifacts.semanticPatch,
      report.artifacts.projectDelta,
      report.artifacts.reportJson,
      report.artifacts.reportMarkdown,
      ...report.attempts.flatMap((attempt) => [
        attempt.record.candidate?.path,
        attempt.artifacts.request,
        attempt.artifacts.proposal,
        attempt.artifacts.candidate,
        attempt.artifacts.delta,
        attempt.artifacts.evaluation,
        attempt.artifacts.preservation,
        attempt.artifacts.screenshots,
      ]),
    ].filter((path): path is string => path !== null && path !== undefined)
    for (const path of paths)
    {
      if (this.portablePath(path) !== path.split('\\').join('/'))
      {
        throw new Error('repair report path is not run-root-relative')
      }
    }
    if (
      (report.versions.browserExecutable &&
        isAbsolute(report.versions.browserExecutable)) ||
      (report.execution.browser.executable &&
        isAbsolute(report.execution.browser.executable))
    )
    {
      throw new Error('repair report browser identity must not be a host path')
    }
  }

  private isInsideRealRoot(path: string): boolean
  {
    return isPathWithinRootV1(this.realRoot, path)
  }

  private checkedPath(
    portable: string,
    createParents: boolean,
    allowFinalSymlink = false
  ): string
  {
    const normalized = this.portablePath(portable)
    const segments = normalized.split('/')
    let current = this.root
    for (const segment of segments.slice(0, -1))
    {
      current = join(current, segment)
      if (!existsSync(current))
      {
        if (!createParents)
          throw new RepairArtifactStoreError(
            'artifact-path-unsafe',
            'artifact parent directory does not exist'
          )
        mkdirSync(current, { mode: 0o700 })
      }
      const info = lstatSync(current)
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new RepairArtifactStoreError(
          'artifact-path-unsafe',
          'artifact parent must be a real directory'
        )
      if (!this.isInsideRealRoot(realpathSync(current)))
        throw new RepairArtifactStoreError(
          'artifact-path-unsafe',
          'artifact parent escapes the repair run root'
        )
    }
    const result = join(this.root, ...segments)
    if (
      existsSync(result) &&
      lstatSync(result).isSymbolicLink() &&
      !allowFinalSymlink
    )
    {
      throw new RepairArtifactStoreError(
        'artifact-path-unsafe',
        'artifact path must not be a symbolic link'
      )
    }
    return result
  }

  private ensureDirectory(portable: string): string
  {
    const path = this.checkedPath(portable, true)
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new RepairArtifactStoreError(
        'artifact-path-unsafe',
        'artifact directory must be a real directory'
      )
    if (!this.isInsideRealRoot(realpathSync(path)))
      throw new RepairArtifactStoreError(
        'artifact-path-unsafe',
        'artifact directory escapes the repair run root'
      )
    return path
  }

  private writeBytes(
    portable: string,
    bytes: Uint8Array,
    overwrite = true
  ): ArtifactIdentity
  {
    const path = this.checkedPath(portable, true)
    if (!overwrite && existsSync(path))
      throw new Error('artifact destination already exists')
    const copy = Uint8Array.from(bytes)
    atomicWrite(
      path,
      (descriptor) => writeFileSync(descriptor, copy),
      () =>
      {
        this.checkedPath(portable, false)
        if (!overwrite && existsSync(path))
          throw new Error('artifact destination already exists')
      }
    )
    return {
      path: this.portablePath(path),
      sha256: sha256(copy),
      byteLength: copy.byteLength,
    }
  }

  private writeJson(portable: string, value: unknown): void
  {
    this.writeText(portable, serializeJson(value))
  }

  private writeText(portable: string, value: string): void
  {
    const path = this.checkedPath(portable, true)
    atomicWrite(
      path,
      (descriptor) => writeFileSync(descriptor, value, 'utf8'),
      () => this.checkedPath(portable, false)
    )
  }

  private copyAccepted(
    source: string,
    expected: Pick<ArtifactIdentity, 'sha256' | 'byteLength'>
  ): ArtifactIdentity
  {
    const bytes = readFileSync(source)
    const actual = { sha256: sha256(bytes), byteLength: bytes.byteLength }
    if (
      actual.sha256 !== expected.sha256 ||
      actual.byteLength !== expected.byteLength
    )
    {
      throw new Error('accepted source bytes do not match evaluated identity')
    }
    const identity = this.writeBytes('accepted/candidate.sb3', bytes, false)
    const target = this.checkedPath(identity.path, false)
    const accepted = readFileSync(target)
    if (
      sha256(accepted) !== expected.sha256 ||
      accepted.byteLength !== expected.byteLength
    )
    {
      throw new Error(
        'accepted artifact copy does not match evaluated identity'
      )
    }
    return identity
  }
}

export function createRepairArtifactStore(
  options: RepairArtifactStoreOptions
): RepairArtifactStore
{
  return new RepairArtifactStore(options)
}

function proposalArtifactValue(
  proposal: RepairProposal | null,
  rawResponse: unknown,
  originalSha256: string | null
): unknown
{
  if (proposal !== null)
  {
    const projected = durableProposalProjection(proposal)
    return {
      schemaVersion: 1,
      originalSha256,
      projectionSha256: hashJson(projected.value),
      redacted: projected.redacted,
      proposal: projected.value,
      rawResponse: null,
    }
  }
  try
  {
    const serialized = JSON.stringify(rawResponse)
    const bytes =
      serialized === undefined ? null : new TextEncoder().encode(serialized)
    return {
      schemaVersion: 1,
      originalSha256,
      projectionSha256: null,
      redacted: true,
      proposal: null,
      rawResponse: {
        retained: false,
        serializedSha256: bytes ? sha256(bytes) : null,
        serializedByteLength: bytes?.byteLength ?? null,
        reason: 'malformed response content omitted',
      },
    }
  }
  catch
  {
    return {
      schemaVersion: 1,
      originalSha256,
      projectionSha256: null,
      redacted: true,
      proposal: null,
      rawResponse: {
        retained: false,
        serializedSha256: null,
        serializedByteLength: null,
        reason: 'unserializable response content omitted',
      },
    }
  }
}
