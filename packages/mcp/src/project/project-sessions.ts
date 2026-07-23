// packages/mcp/src/project/project-sessions.ts
// retain bounded read-only project sessions, pagination, runs, & opaque evidence

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

import {
  DEFAULT_PROJECT_SCENARIO_LIMITS,
  ProjectArtifactStore,
  ProjectArtifactStoreLimitError,
  ProjectScenarioError,
  inspectSemanticEditArtifact,
  inspectSelectedProject,
  parseProjectScenario,
  runProjectCheckScenario,
  type ParsedProjectScenario,
  type ProjectArtifactReference,
  type ProjectInspectionCatalog,
  type SemanticEditArtifactPreflight,
  type SelectedProjectInspection,
} from '@scratch-agent/eval'
import type { BrowserTrace, RunIssue, VmTrace } from '@scratch-agent/runner'

import { McpBoundaryError } from '../transport/errors.js'
import {
  MAX_INPUT_BYTES,
  configureRepairMcpPaths,
  readPublishedProjectInputV1,
  readSelectedInput,
  recheckSelectedInputLeaseEvidenceV1,
  recheckSelectedInputProvenanceV1,
  selectedInputHostProvenanceSha256V1,
  selectedInputLeaseEvidenceV1,
  type PublishedProjectInputAuthorityV1,
  type RepairMcpPathConfig,
  type RepairMcpPaths,
  type SelectedInputHostProvenanceV1,
  type SelectedInputProvenanceRecheckV1,
} from '../transport/paths.js'

export const DEFAULT_MAX_PROJECT_SESSIONS = 4
export const HARD_MAX_PROJECT_SESSIONS = 64
export const DEFAULT_MAX_PROJECT_RUNS = 8
export const HARD_MAX_PROJECT_RUNS = 32
export const DEFAULT_PROJECT_ARTIFACT_BYTES = 256 * 1024 * 1024
export const MAX_PROJECT_PAGE_SIZE = 50
export const DEFAULT_PROJECT_PAGE_SIZE = 20
export const MAX_PROJECT_PAGE_ITEM_BYTES = 16 * 1024
export const MAX_PROJECT_TOOL_DATA_BYTES = 60 * 1024
export const MAX_PROJECT_RESOURCE_BYTES = 5 * 1024 * 1024
export const MAX_PROJECT_RESOURCE_PAGE_SIZE = 50

interface ProjectRunRecord
{
  runId: string
  createdAt: string
  completedAt: string
  status: 'passed' | 'failed'
  lanes: Array<'vm' | 'browser'>
  scenario: ParsedProjectScenario['summary']
  vm: ProjectLaneSummary | null
  browser: ProjectLaneSummary | null
  vmTracePath: string | null
  browserTracePath: string | null
  artifactIds: string[]
}

interface ProjectSessionRecord
{
  sessionId: string
  state: 'ready' | 'failed' | 'running'
  displayName: string
  sha256: string
  byteLength: number
  sourceProvenance: SelectedInputHostProvenanceV1
  editSourceHostEvidenceSha256: string
  editSourceAssessment: ProjectEditSourceAssessment
  editSourceEligible: boolean
  store: ProjectArtifactStore
  retainedInputPath: string
  inspection: SelectedProjectInspection
  catalog: ProjectInspectionCatalog
  runs: ProjectRunRecord[]
  createdAt: string
  updatedAt: string
  lastAccessedAt: number
  collectionVersion: number
  busy: boolean
}

interface ProjectEditSourceAssessment
{
  editable: boolean
  semanticSourceIdentity: SemanticEditArtifactPreflight['semanticSourceIdentity']
  semanticSourceSha256: string | null
  refusal: { stage: string; code: string; message: string } | null
}

interface ProjectLaneSummary
{
  ok: boolean
  runtime: string
  snapshotCount: number
  snapshots: Array<{ label: string | null; tick: number }>
  issues: {
    count: number
    samples: RunIssue[]
    omitted: number
  }
  logSummary: unknown
  screenshotCount: number
  screenshots: ProjectArtifactView[]
}

export interface ProjectArtifactView
{
  id: string
  kind: string
  mediaType: string
  byteLength: number
  sha256: string
  uri: string | null
}

export interface ProjectSessionRegistryOptions
{
  maxSessions?: number
  maxRunsPerSession?: number
  artifactByteLimit?: number
}

export interface ProjectOpenResult
{
  sessionId: string
  state: 'ready' | 'failed'
  input: { displayName: string; sha256: string; byteLength: number }
  stages: SelectedProjectInspection['stages']
  metrics: SelectedProjectInspection['metrics']
  summary: SelectedProjectInspection['summary']
  issues: SelectedProjectInspection['issues']
  canRun: boolean
  limits: ReturnType<ProjectSessionRegistry['limits']>
  artifacts: ProjectArtifactView[]
  createdAt: string
  untrustedProjectData: true
}

export interface ProjectInspectResult
{
  sessionId: string
  queryKind: string
  collectionVersion: string
  items: unknown[]
  page: {
    requested: number
    returned: number
    total: number
    nextCursor: string | null
  }
  budget: {
    maxBytes: number
    returnedBytes: number
    truncatedItemCount: number
  }
  untrustedProjectData: true
}

export interface ProjectRunResult
{
  sessionId: string
  runId: string
  status: 'passed' | 'failed'
  lanes: Array<'vm' | 'browser'>
  scenario: ParsedProjectScenario['summary']
  vm: ProjectLaneSummary | null
  browser: ProjectLaneSummary | null
  artifacts: ProjectArtifactView[]
  completedAt: string
  untrustedProjectData: true
}

export interface ProjectStatusResult
{
  sessionId: string
  state: ProjectSessionRecord['state']
  input: { displayName: string; sha256: string; byteLength: number }
  stages: SelectedProjectInspection['stages']
  canRun: boolean
  runCount: number
  latestRun: ProjectRunRecord | null
  issues: SelectedProjectInspection['issues']
  artifacts: ProjectArtifactView[]
  retention: {
    activeSessionLimit: number
    activeSessionCount: number
    runLimit: number
    runsUsed: number
    artifactByteLimit: number
    artifactBytes: number
    policy: 'idle-lru-eviction'
  }
  createdAt: string
  updatedAt: string
  untrustedProjectData: true
}

export interface ProjectResourceListResult
{
  resources: Array<{
    uri: string
    name: string
    mimeType: string
    size: number
  }>
  nextCursor: string | null
}

// one reserved view of an admitted source: exact bytes, the identity the open
// recorded, & the provenance revision zero must carry. It is valid only inside
// the lease callback, because only the lease holds off LRU eviction
export interface EditSourceLeaseV1
{
  readonly leaseId: string
  readonly projectSessionId: string
  readonly displayName: string
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly byteLength: number
  readonly provenance: SelectedInputHostProvenanceV1
  readonly semanticSourceSha256: string
  readonly hostEvidenceSha256: string
  recheck(): SelectedInputProvenanceRecheckV1
}

// refusal admission can use this recorded identity but receives no source bytes,
// callback, or lease capable of becoming revision zero
export interface EditSourceOpeningRefusalAuthorityV1
{
  readonly projectSessionId: string
  readonly displayName: string
  readonly sha256: string
  readonly byteLength: number
  readonly provenance: SelectedInputHostProvenanceV1
  readonly provenanceSha256: string
  readonly reason: 'publishedOutputInspectOnly'
}

// eligible project sessions expose this admitted identity without source bytes
// or a lease, so retained opening outcomes remain discoverable after drift
export interface EditSourceAdmittedIdentityV1
{
  readonly projectSessionId: string
  readonly displayName: string
  readonly sha256: string
  readonly byteLength: number
  readonly provenance: SelectedInputHostProvenanceV1
  readonly provenanceSha256: string
  readonly hostEvidenceSha256: string
}

type ProjectQuery = Record<string, unknown> & { kind: string }

function positiveLimit(
  value: number | undefined,
  fallback: number,
  hard: number,
  name: string
): number
{
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > hard)
  {
    throw new McpBoundaryError(
      'mcp.project-session-capacity-invalid',
      `${name} must be a positive safe integer at most ${hard}`
    )
  }
  return result
}

function byteLimit(value: number | undefined): number
{
  const result = value ?? DEFAULT_PROJECT_ARTIFACT_BYTES
  if (!Number.isSafeInteger(result) || result < 1)
  {
    throw new McpBoundaryError(
      'mcp.project-session-artifact-limit',
      'artifactByteLimit must be a positive safe integer'
    )
  }
  return result
}

function portableJson(value: unknown): string
{
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(portableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${portableJson(record[key])}`)
    .join(',')}}`
}

function sha256(value: Uint8Array | string): string
{
  return createHash('sha256').update(value).digest('hex')
}

function jsonBytes(value: unknown): number
{
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}

function boundedString(value: string, maxBytes: number): string
{
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value
  let result = ''
  let bytes = 0
  for (const character of value)
  {
    const size = Buffer.byteLength(character, 'utf-8')
    if (bytes + size + 3 > maxBytes) break
    result += character
    bytes += size
  }
  return `${result}...`
}

function boundedItem(value: unknown): { value: unknown; truncated: boolean }
{
  const serialized = JSON.stringify(value)
  const bytes = Buffer.byteLength(serialized, 'utf-8')
  if (bytes <= MAX_PROJECT_PAGE_ITEM_BYTES)
  {
    return { value: structuredClone(value), truncated: false }
  }
  return {
    value: {
      truncated: true,
      originalBytes: bytes,
      originalSha256: sha256(serialized),
      preview: boundedString(serialized, 8 * 1024),
    },
    truncated: true,
  }
}

function issueSummary(issues: RunIssue[]): ProjectLaneSummary['issues']
{
  return {
    count: issues.length,
    samples: issues.slice(0, 10).map((issue) => ({
      ...structuredClone(issue),
      message: boundedString(issue.message, 500),
    })),
    omitted: Math.max(0, issues.length - 10),
  }
}

function vmSummary(trace: VmTrace): ProjectLaneSummary
{
  return {
    ok: trace.ok,
    runtime: trace.runtime,
    snapshotCount: trace.snapshots.length,
    snapshots: trace.snapshots.map((snapshot) => ({
      label: snapshot.label ?? null,
      tick: snapshot.tick,
    })),
    issues: issueSummary(trace.issues),
    logSummary: trace.runtimeLog,
    screenshotCount: 0,
    screenshots: [],
  }
}

function browserSummary(
  trace: BrowserTrace,
  screenshots: ProjectArtifactView[]
): ProjectLaneSummary
{
  return {
    ok: trace.ok,
    runtime: trace.runtime,
    snapshotCount: trace.snapshots.length,
    snapshots: trace.snapshots.map((snapshot) => ({
      label: snapshot.label ?? null,
      tick: snapshot.tick,
    })),
    issues: issueSummary(trace.issues),
    logSummary: trace.consoleSummary,
    screenshotCount: trace.screenshots.length,
    screenshots,
  }
}

function safeLanes(value: unknown): Array<'vm' | 'browser'>
{
  if (value === undefined) return ['vm', 'browser']
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 2 ||
    value.some((lane) => lane !== 'vm' && lane !== 'browser') ||
    new Set(value).size !== value.length
  )
  {
    throw new McpBoundaryError(
      'mcp.arguments-invalid',
      'lanes must contain unique vm and/or browser values'
    )
  }
  return value as Array<'vm' | 'browser'>
}

function traceForLane(
  record: ProjectSessionRecord,
  runId: string,
  lane: unknown
): VmTrace | BrowserTrace
{
  const run = record.runs.find((entry) => entry.runId === runId)
  if (!run)
  {
    throw new McpBoundaryError(
      'mcp.project-query-invalid',
      'runId was not found in this project session'
    )
  }
  const path = lane === 'vm' ? run.vmTracePath : run.browserTracePath
  if ((lane !== 'vm' && lane !== 'browser') || !path)
  {
    throw new McpBoundaryError(
      'mcp.project-query-invalid',
      'requested lane was not retained for this run'
    )
  }
  return JSON.parse(readFileSync(record.store.absolutePath(path), 'utf-8')) as
    VmTrace | BrowserTrace
}

function publicRun(record: ProjectRunRecord): ProjectRunRecord
{
  return {
    ...structuredClone(record),
    vmTracePath: null,
    browserTracePath: null,
    artifactIds: [],
  }
}

export class ProjectSessionRegistry
{
  readonly paths: RepairMcpPaths

  private readonly records = new Map<string, ProjectSessionRecord>()
  private readonly publicationClaims = new Map<
    string,
    PublishedProjectInputAuthorityV1
  >()
  private editPublicationRoot: string | null = null
  private editPublicationLexicalRoot: string | null = null
  private readonly cursorSecret = randomBytes(32)
  private readonly maxSessions: number
  private readonly maxRunsPerSession: number
  private readonly artifactByteLimit: number
  private resourceCollectionVersion = 1
  private startingCount = 0

  constructor(
    config: RepairMcpPathConfig,
    options: ProjectSessionRegistryOptions = {}
  )
  {
    this.paths = configureRepairMcpPaths(config)
    this.maxSessions = positiveLimit(
      options.maxSessions,
      DEFAULT_MAX_PROJECT_SESSIONS,
      HARD_MAX_PROJECT_SESSIONS,
      'maxSessions'
    )
    this.maxRunsPerSession = positiveLimit(
      options.maxRunsPerSession,
      DEFAULT_MAX_PROJECT_RUNS,
      HARD_MAX_PROJECT_RUNS,
      'maxRunsPerSession'
    )
    this.artifactByteLimit = byteLimit(options.artifactByteLimit)
  }

  limits()
  {
    return {
      sessions: this.maxSessions,
      runsPerSession: this.maxRunsPerSession,
      artifactBytesPerSession: this.artifactByteLimit,
      pageSizeDefault: DEFAULT_PROJECT_PAGE_SIZE,
      pageSizeMaximum: MAX_PROJECT_PAGE_SIZE,
      pageItemBytes: MAX_PROJECT_PAGE_ITEM_BYTES,
      toolDataBytes: MAX_PROJECT_TOOL_DATA_BYTES,
      readableArtifactBytes: MAX_PROJECT_RESOURCE_BYTES,
      scenario: DEFAULT_PROJECT_SCENARIO_LIMITS,
      network: 'denied' as const,
      video: false,
      runtimeContainment: 'in-process-tick-bounded' as const,
      hardKillTimeout: false as const,
    }
  }

  async open(inputPath: unknown): Promise<ProjectOpenResult>
  {
    this.reserveOpen()
    let pendingArtifactRoot: string | null = null
    try
    {
      const selectedPath =
        typeof inputPath === 'string' ? resolve(inputPath) : null
      const publicationClaim =
        selectedPath === null
          ? undefined
          : this.publicationClaims.get(selectedPath)
      const selected = publicationClaim
        ? readPublishedProjectInputV1(
            this.paths,
            publicationClaim.canonicalPath,
            publicationClaim
          )
        : readSelectedInput(this.paths, inputPath)
      const inspection = await inspectSelectedProject(selected.bytes)
      const editSourceAssessment = await inspectSemanticEditArtifact(
        selected.bytes
      )
      if (
        inspection.input.sha256 !== null &&
        inspection.input.sha256 !== selected.sha256
      )
      {
        throw new McpBoundaryError(
          'mcp.project-open-failed',
          'admission identity disagrees with the selected input'
        )
      }
      const sessionId = `project-${randomUUID()}`
      const store = new ProjectArtifactStore(
        join(this.paths.artifactRoot, sessionId),
        { maxBytes: this.artifactByteLimit }
      )
      pendingArtifactRoot = store.root
      const inputRef = store.writeBytes(
        'input.sb3',
        'retained-input',
        'application/x.scratch.sb3',
        selected.bytes
      )
      const editSourceHostEvidenceSha256 = selectedInputLeaseEvidenceV1(
        selected.provenance,
        selected.bytes
      ).hostEvidenceSha256
      const createdAt = new Date().toISOString()
      const record: ProjectSessionRecord = {
        sessionId,
        state: inspection.canRun ? 'ready' : 'failed',
        displayName: selected.displayName,
        sha256: selected.sha256,
        byteLength: selected.byteLength,
        sourceProvenance: selected.provenance,
        editSourceHostEvidenceSha256,
        editSourceAssessment: {
          editable: editSourceAssessment.ok,
          semanticSourceIdentity: editSourceAssessment.semanticSourceIdentity,
          semanticSourceSha256: editSourceAssessment.semanticSourceSha256,
          refusal: editSourceAssessment.refusal,
        },
        editSourceEligible: publicationClaim === undefined,
        store,
        retainedInputPath: inputRef.path,
        inspection,
        catalog: inspection.catalog,
        runs: [],
        createdAt,
        updatedAt: createdAt,
        lastAccessedAt: Date.now(),
        collectionVersion: 1,
        busy: false,
      }
      store.writeJson(
        'diagnostics.json',
        'project-diagnostics',
        inspection.catalog.diagnostics
      )
      store.writeJson(
        'inspection-catalog.json',
        'inspection-catalog',
        inspection.catalog
      )
      store.writeJson(
        'project-open.json',
        'project-open-report',
        this.openProjection(record)
      )
      this.requireArtifactBudget(record)
      const projection = this.openProjection(record)
      this.commitOpen(record)
      pendingArtifactRoot = null
      this.resourceCollectionVersion++
      return projection
    }
    catch (error)
    {
      if (pendingArtifactRoot)
      {
        rmSync(pendingArtifactRoot, { recursive: true, force: true })
      }
      if (error instanceof McpBoundaryError) throw error
      if (error instanceof ProjectArtifactStoreLimitError)
      {
        throw new McpBoundaryError(
          'mcp.project-session-artifact-limit',
          error.message
        )
      }
      throw new McpBoundaryError(
        'mcp.project-open-failed',
        'project open failed'
      )
    }
    finally
    {
      this.startingCount--
    }
  }

  // * reserves the record against LRU eviction for the whole callback, &
  // * rehashes both its private copy & its original provenance first, so begin
  // * fails rather than racing eviction or source drift
  async withEditSourceLeaseV1<T>(
    sessionId: unknown,
    use: (lease: EditSourceLeaseV1) => Promise<T>
  ): Promise<T>
  {
    const record = this.requireRecord(sessionId)
    if (!record.editSourceEligible)
    {
      throw new McpBoundaryError(
        'mcp.edit-source-not-editable',
        'published output sessions are inspect-only and cannot become edit sources'
      )
    }
    if (record.busy)
    {
      throw new McpBoundaryError(
        'mcp.project-session-busy',
        'project session is already reserved by another operation'
      )
    }
    const assessment = record.editSourceAssessment
    if (!assessment.editable || assessment.semanticSourceSha256 === null)
    {
      throw new McpBoundaryError(
        'mcp.edit-source-not-editable',
        'selected project source was refused for semantic editing at open'
      )
    }
    // reserving the slot is what holds off eviction; commitOpen only evicts
    // records that are not busy
    record.busy = true
    try
    {
      const recheck = recheckSelectedInputProvenanceV1(
        this.paths,
        record.sourceProvenance
      )
      if (!recheck.ok)
      {
        throw new McpBoundaryError(
          recheck.reason === 'missing'
            ? 'mcp.edit-source-missing'
            : 'mcp.edit-source-changed',
          'selected source no longer matches the identity this session admitted'
        )
      }
      const bytes = this.readRetainedInput(record)
      const leaseEvidence = recheckSelectedInputLeaseEvidenceV1(
        this.paths,
        record.sourceProvenance,
        bytes
      )
      const lease: EditSourceLeaseV1 = Object.freeze({
        leaseId: `edit-source-lease-${randomUUID()}`,
        projectSessionId: record.sessionId,
        displayName: record.displayName,
        bytes,
        sha256: record.sha256,
        byteLength: record.byteLength,
        provenance: record.sourceProvenance,
        semanticSourceSha256: assessment.semanticSourceSha256,
        hostEvidenceSha256: leaseEvidence.hostEvidenceSha256,
        recheck: () =>
          recheckSelectedInputProvenanceV1(this.paths, record.sourceProvenance),
      })
      return await use(lease)
    }
    finally
    {
      record.busy = false
      this.touch(record)
    }
  }

  // published outputs remain inspectable project sessions, but this projection
  // exposes only their recorded identity for a durable opening refusal
  editSourceOpeningRefusalAuthorityV1(
    sessionId: string
  ): EditSourceOpeningRefusalAuthorityV1 | null
  {
    const record = this.requireRecord(sessionId)
    if (record.editSourceEligible) return null
    this.touch(record)
    return Object.freeze({
      projectSessionId: record.sessionId,
      displayName: record.displayName,
      sha256: record.sha256,
      byteLength: record.byteLength,
      provenance: structuredClone(record.sourceProvenance),
      provenanceSha256: selectedInputHostProvenanceSha256V1(
        record.sourceProvenance
      ),
      reason: 'publishedOutputInspectOnly' as const,
    })
  }

  // this is opening identity authority only; it cannot admit revision zero
  editSourceAdmittedIdentityV1(
    sessionId: string
  ): EditSourceAdmittedIdentityV1
  {
    const record = this.requireRecord(sessionId)
    if (!record.editSourceEligible)
      throw new McpBoundaryError(
        'mcp.edit-source-not-editable',
        'published output sessions have separate opening refusal authority'
      )
    this.touch(record)
    return Object.freeze({
      projectSessionId: record.sessionId,
      displayName: record.displayName,
      sha256: record.sha256,
      byteLength: record.byteLength,
      provenance: structuredClone(record.sourceProvenance),
      provenanceSha256: selectedInputHostProvenanceSha256V1(
        record.sourceProvenance
      ),
      hostEvidenceSha256: record.editSourceHostEvidenceSha256,
    })
  }

  // an authenticated successful export registers one immutable inspection path
  registerEditPublicationRootV1(rawRoot: string): void
  {
    let canonicalRoot: string
    let lexicalRoot: string
    try
    {
      lexicalRoot = resolve(rawRoot)
      const info = lstatSync(lexicalRoot, { bigint: true })
      canonicalRoot = realpathSync(lexicalRoot)
      if (
        dirname(canonicalRoot) !== this.paths.outputRoot ||
        (dirname(lexicalRoot) !== this.paths.outputRoot &&
          dirname(lexicalRoot) !== this.paths.outputLexicalRoot) ||
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077n) !== 0n ||
        (typeof process.getuid === 'function' &&
          info.uid !== BigInt(process.getuid()))
      )
        throw new Error('invalid publication root identity')
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.project-publication-claim-invalid',
        'trusted edit publication root is invalid'
      )
    }
    if (
      this.editPublicationRoot !== null &&
      this.editPublicationRoot !== canonicalRoot
    )
    {
      throw new McpBoundaryError(
        'mcp.project-publication-claim-invalid',
        'project registry is already bound to another publication root'
      )
    }
    this.editPublicationRoot = canonicalRoot
    this.editPublicationLexicalRoot = lexicalRoot
  }

  // an authenticated successful export registers one immutable inspection path
  registerPublishedEditArtifactV1(input: {
    readonly basename: string
    readonly sha256: string
    readonly byteLength: number
  }): string
  {
    if (
      typeof input.basename !== 'string' ||
      basename(input.basename) !== input.basename ||
      extname(input.basename).toLowerCase() !== '.sb3' ||
      !LOWERCASE_SHA256_PATTERN.test(input.sha256) ||
      !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 1 ||
      input.byteLength > MAX_INPUT_BYTES
    )
    {
      throw new McpBoundaryError(
        'mcp.project-publication-claim-invalid',
        'successful edit publication claim is invalid'
      )
    }
    if (
      this.editPublicationRoot === null ||
      this.editPublicationLexicalRoot === null
    )
    {
      throw new McpBoundaryError(
        'mcp.project-publication-claim-invalid',
        'project registry has no trusted edit publication root'
      )
    }
    const canonicalPath = join(this.editPublicationRoot, input.basename)
    const lexicalPath = join(this.editPublicationLexicalRoot, input.basename)
    const claim = Object.freeze({
      canonicalPath,
      sha256: input.sha256,
      byteLength: input.byteLength,
    })
    const current = this.publicationClaims.get(canonicalPath)
    if (
      current &&
      (current.sha256 !== claim.sha256 ||
        current.byteLength !== claim.byteLength)
    )
    {
      throw new McpBoundaryError(
        'mcp.project-publication-claim-invalid',
        'publication path is already bound to a different exact identity'
      )
    }
    this.publicationClaims.set(canonicalPath, claim)
    this.publicationClaims.set(lexicalPath, claim)
    return canonicalPath
  }

  // the private copy is the authority for revision zero, so it is reopened
  // no-follow & rehashed rather than trusted from the open-time record
  private readRetainedInput(record: ProjectSessionRecord): Uint8Array
  {
    const path = record.store.absolutePath(record.retainedInputPath)
    let descriptor: number | null = null
    try
    {
      descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      const info = fstatSync(descriptor, { bigint: true })
      if (!info.isFile() || info.size !== BigInt(record.byteLength))
      {
        throw new McpBoundaryError(
          'mcp.edit-source-drift',
          'retained project source copy no longer matches its admitted size'
        )
      }
      const bytes = Uint8Array.from(readFileSync(descriptor))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== record.sha256)
      {
        throw new McpBoundaryError(
          'mcp.edit-source-drift',
          'retained project source copy no longer matches its admitted digest'
        )
      }
      return bytes
    }
    catch (error)
    {
      if (error instanceof McpBoundaryError) throw error
      throw new McpBoundaryError(
        'mcp.edit-source-drift',
        'retained project source copy could not be reopened'
      )
    }
    finally
    {
      if (descriptor !== null) closeSync(descriptor)
    }
  }

  inspect(
    sessionId: unknown,
    query: ProjectQuery,
    cursor: unknown,
    pageSize: unknown
  ): ProjectInspectResult
  {
    const record = this.requireRecord(sessionId)
    const requested = this.pageSize(pageSize)
    const queryHash = sha256(portableJson(query))
    const offset = this.cursorOffset(record, queryHash, cursor)
    const items = this.queryItems(record, query)
    if (offset > items.length)
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-stale',
        'cursor offset exceeds the current collection'
      )
    }
    const projected: unknown[] = []
    let truncatedItemCount = 0
    let nextOffset = offset
    for (const item of items.slice(offset, offset + requested))
    {
      const bounded = boundedItem(item)
      const candidate = [...projected, bounded.value]
      const probe = {
        sessionId: record.sessionId,
        queryKind: query.kind,
        collectionVersion: String(record.collectionVersion),
        items: candidate,
      }
      if (jsonBytes(probe) > MAX_PROJECT_TOOL_DATA_BYTES && projected.length)
      {
        break
      }
      projected.push(bounded.value)
      if (bounded.truncated) truncatedItemCount++
      nextOffset++
    }
    const nextCursor =
      nextOffset < items.length
        ? this.encodeCursor(record, queryHash, nextOffset)
        : null
    const result: ProjectInspectResult = {
      sessionId: record.sessionId,
      queryKind: query.kind,
      collectionVersion: String(record.collectionVersion),
      items: projected,
      page: {
        requested,
        returned: projected.length,
        total: items.length,
        nextCursor,
      },
      budget: {
        maxBytes: MAX_PROJECT_TOOL_DATA_BYTES,
        returnedBytes: 0,
        truncatedItemCount,
      },
      untrustedProjectData: true,
    }
    result.budget.returnedBytes = jsonBytes(result)
    if (result.budget.returnedBytes > MAX_PROJECT_TOOL_DATA_BYTES)
    {
      throw new McpBoundaryError(
        'mcp.project-response-limit',
        'project inspection response exceeds its byte budget'
      )
    }
    this.touch(record)
    return result
  }

  async run(
    sessionId: unknown,
    lanesValue: unknown,
    scenarioValue: unknown
  ): Promise<ProjectRunResult>
  {
    const record = this.requireRecord(sessionId)
    if (!record.inspection.canRun)
    {
      throw new McpBoundaryError(
        'mcp.project-session-not-runnable',
        'project schema and graph gates must pass before runtime execution'
      )
    }
    if (record.busy)
    {
      throw new McpBoundaryError(
        'mcp.project-session-busy',
        'project session already has a run in progress'
      )
    }
    if (record.runs.length >= this.maxRunsPerSession)
    {
      throw new McpBoundaryError(
        'mcp.project-session-run-limit',
        'project session run limit is exhausted'
      )
    }
    const lanes = safeLanes(lanesValue)
    let scenario: ParsedProjectScenario
    try
    {
      scenario = parseProjectScenario(scenarioValue)
    }
    catch (error)
    {
      if (error instanceof ProjectScenarioError)
      {
        throw new McpBoundaryError(error.code, error.message)
      }
      throw error
    }
    record.busy = true
    record.state = 'running'
    this.touch(record)
    const collectionVersionBefore = record.collectionVersion
    const artifactsBefore = sha256(portableJson(record.store.references()))
    const readableArtifactsBefore = sha256(
      portableJson(this.readableArtifacts(record))
    )
    const runId = `run-${String(record.runs.length + 1).padStart(3, '0')}`
    const runBase = `runs/${runId}`
    try
    {
      const bytes = readFileSync(
        record.store.absolutePath(record.retainedInputPath)
      )
      if (
        bytes.byteLength !== record.byteLength ||
        sha256(bytes) !== record.sha256
      )
      {
        throw new McpBoundaryError(
          'mcp.input-changed',
          'retained project input changed after project_open'
        )
      }
      const createdAt = new Date().toISOString()
      const executed = await runProjectCheckScenario(bytes, scenario.scenario, {
        lanes,
        screenshotDir: record.store.absolutePath(
          `${runBase}/browser/screenshots`
        ),
      })
      let vm: ProjectLaneSummary | null = null
      let browser: ProjectLaneSummary | null = null
      let vmTracePath: string | null = null
      let browserTracePath: string | null = null
      const beforeArtifacts = new Set(
        record.store.references().map((artifact) => artifact.id)
      )
      if (executed.vm)
      {
        vm = vmSummary(executed.vm)
        vmTracePath = `${runBase}/vm/trace.json`
        record.store.writeJson(vmTracePath, 'vm-trace', executed.vm)
        record.store.writeJson(
          `${runBase}/vm/runtime-log.json`,
          'vm-runtime-log',
          executed.vm.runtimeLog
        )
      }
      if (executed.browser)
      {
        const screenshotViews: ProjectArtifactView[] = []
        const screenshotPaths: string[] = []
        for (const screenshot of executed.browser.screenshots)
        {
          const path = `${runBase}/browser/screenshots/${basename(screenshot.path)}`
          const ref = record.store.writeBytes(
            path,
            'browser-screenshot',
            'image/png',
            readFileSync(screenshot.path)
          )
          screenshotPaths.push(path)
          screenshotViews.push(this.artifactView(record, ref))
        }
        browser = browserSummary(executed.browser, screenshotViews)
        browserTracePath = `${runBase}/browser/trace.json`
        record.store.writeJson(browserTracePath, 'browser-trace', {
          ...executed.browser,
          screenshots: executed.browser.screenshots.map(
            (screenshot, index) => ({
              ...screenshot,
              path: screenshotPaths[index],
            })
          ),
          video: null,
        })
        record.store.writeText(
          `${runBase}/browser/console.log`,
          'browser-console',
          'text/plain; charset=utf-8',
          executed.browser.consoleLog.join('\n') +
            (executed.browser.consoleLog.length ? '\n' : '')
        )
        record.store.writeJson(
          `${runBase}/browser/console-summary.json`,
          'browser-console-summary',
          executed.browser.consoleSummary
        )
      }
      const expectedSnapshots = scenario.summary.snapshotCount
      const status =
        (vm === null || (vm.ok && vm.snapshotCount === expectedSnapshots)) &&
        (browser === null ||
          (browser.ok &&
            browser.snapshotCount === expectedSnapshots &&
            browser.screenshotCount === expectedSnapshots))
          ? 'passed'
          : 'failed'
      const completedAt = new Date().toISOString()
      const artifactIds = record.store
        .references()
        .filter((artifact) => !beforeArtifacts.has(artifact.id))
        .map((artifact) => artifact.id)
      const runRecord: ProjectRunRecord = {
        runId,
        createdAt,
        completedAt,
        status,
        lanes,
        scenario: scenario.summary,
        vm,
        browser,
        vmTracePath,
        browserTracePath,
        artifactIds,
      }
      const runArtifact = record.store.writeJson(
        `${runBase}/run.json`,
        'project-run',
        {
          ...publicRun(runRecord),
          sessionId: record.sessionId,
          input: { sha256: record.sha256, byteLength: record.byteLength },
          artifacts: this.artifactViews(
            record,
            new Set(runRecord.artifactIds)
          ),
        }
      )
      runRecord.artifactIds.push(runArtifact.id)
      this.requireArtifactBudget(record)
      const projection = this.runProjection(record, runRecord)
      record.runs.push(runRecord)
      record.collectionVersion++
      record.updatedAt = completedAt
      return projection
    }
    catch (error)
    {
      try
      {
        record.store.removeTree(runBase)
      }
      catch
      {
        throw new McpBoundaryError(
          'mcp.project-run-cleanup-failed',
          'failed project run evidence could not be removed safely'
        )
      }
      if (error instanceof McpBoundaryError) throw error
      if (error instanceof ProjectArtifactStoreLimitError)
      {
        throw new McpBoundaryError(
          'mcp.project-session-artifact-limit',
          error.message
        )
      }
      throw new McpBoundaryError(
        'mcp.project-run-failed',
        'project runtime operation failed'
      )
    }
    finally
    {
      const artifactsChanged =
        sha256(portableJson(record.store.references())) !== artifactsBefore
      const readableArtifactsChanged =
        sha256(portableJson(this.readableArtifacts(record))) !==
        readableArtifactsBefore
      if (readableArtifactsChanged)
      {
        this.resourceCollectionVersion++
      }
      if (
        artifactsChanged &&
        record.collectionVersion === collectionVersionBefore
      )
      {
        record.collectionVersion++
        record.updatedAt = new Date().toISOString()
      }
      record.busy = false
      record.state = 'ready'
      this.touch(record)
    }
  }

  status(sessionId: unknown): ProjectStatusResult
  {
    const record = this.requireRecord(sessionId)
    this.touch(record)
    const latest = record.runs.at(-1)
    return {
      sessionId: record.sessionId,
      state: record.state,
      input: {
        displayName: record.displayName,
        sha256: record.sha256,
        byteLength: record.byteLength,
      },
      stages: structuredClone(record.inspection.stages),
      canRun: record.inspection.canRun,
      runCount: record.runs.length,
      latestRun: latest ? publicRun(latest) : null,
      issues: structuredClone(record.inspection.issues),
      artifacts: this.artifactViews(record),
      retention: {
        activeSessionLimit: this.maxSessions,
        activeSessionCount: this.records.size,
        runLimit: this.maxRunsPerSession,
        runsUsed: record.runs.length,
        artifactByteLimit: this.artifactByteLimit,
        artifactBytes: this.artifactBytes(record),
        policy: 'idle-lru-eviction',
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      untrustedProjectData: true,
    }
  }

  listResources(cursor?: unknown): ProjectResourceListResult
  {
    const all = this.listAllResources()
    const offset = this.resourceCursorOffset(cursor)
    if (offset > all.length)
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-stale',
        'resource cursor offset exceeds the current collection'
      )
    }
    const resources = all.slice(offset, offset + MAX_PROJECT_RESOURCE_PAGE_SIZE)
    const nextOffset = offset + resources.length
    return {
      resources,
      nextCursor:
        nextOffset < all.length ? this.encodeResourceCursor(nextOffset) : null,
    }
  }

  listAllResources(): ProjectResourceListResult['resources']
  {
    return [...this.records.values()]
      .flatMap((record) =>
        this.readableArtifacts(record).map((artifact) => ({
          uri: this.artifactUri(record, artifact),
          name: `${record.sessionId}-${artifact.kind}-${artifact.id}`,
          mimeType: artifact.mediaType,
          size: artifact.byteLength,
        }))
      )
      .sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))
  }

  readResource(uri: string): {
    uri: string
    mimeType: string
    text?: string
    blob?: string
  }
  {
    let parsed: URL
    try
    {
      parsed = new URL(uri)
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.project-artifact-id-invalid',
        'artifact URI is invalid'
      )
    }
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (
      parsed.protocol !== 'scratch-agent:' ||
      parsed.hostname !== 'project' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parts.length !== 3 ||
      parts[1] !== 'artifacts'
    )
    {
      throw new McpBoundaryError(
        'mcp.project-artifact-id-invalid',
        'artifact URI is invalid'
      )
    }
    const record = this.requireRecord(parts[0])
    const artifact = this.readableArtifacts(record).find(
      (entry) => entry.id === parts[2]
    )
    if (!artifact)
    {
      throw new McpBoundaryError(
        'mcp.project-artifact-unknown',
        'artifact is not available as an MCP resource'
      )
    }
    let descriptor: number | null = null
    let bytes: Buffer
    try
    {
      descriptor = openSync(
        record.store.absolutePath(artifact.path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      const info = fstatSync(descriptor)
      if (!info.isFile())
      {
        throw new McpBoundaryError(
          'mcp.project-artifact-read-failed',
          'artifact is no longer a regular file'
        )
      }
      if (info.size > MAX_PROJECT_RESOURCE_BYTES)
      {
        throw new McpBoundaryError(
          'mcp.project-artifact-too-large',
          'artifact exceeds the MCP resource byte limit'
        )
      }
      if (info.size !== artifact.byteLength)
      {
        throw new McpBoundaryError(
          'mcp.project-artifact-read-failed',
          'artifact identity changed after it was cataloged'
        )
      }
      bytes = readFileSync(descriptor)
      if (
        bytes.byteLength !== artifact.byteLength ||
        sha256(bytes) !== artifact.sha256
      )
      {
        throw new McpBoundaryError(
          'mcp.project-artifact-read-failed',
          'artifact identity changed after it was cataloged'
        )
      }
    }
    catch (error)
    {
      if (error instanceof McpBoundaryError) throw error
      throw new McpBoundaryError(
        'mcp.project-artifact-read-failed',
        'artifact could not be read safely'
      )
    }
    finally
    {
      if (descriptor !== null) closeSync(descriptor)
    }
    const base = { uri, mimeType: artifact.mediaType }
    return artifact.mediaType.startsWith('text/') ||
      artifact.mediaType === 'application/json'
      ? { ...base, text: bytes.toString('utf-8') }
      : { ...base, blob: bytes.toString('base64') }
  }

  private reserveOpen(): void
  {
    if (this.records.size + this.startingCount < this.maxSessions)
    {
      this.startingCount++
      return
    }
    if (
      this.startingCount > 0 ||
      ![...this.records.values()].some((record) => !record.busy)
    )
    {
      throw new McpBoundaryError(
        'mcp.project-session-capacity-exhausted',
        'project session capacity is reserved or all slots are busy'
      )
    }
    this.startingCount++
  }

  private commitOpen(record: ProjectSessionRecord): void
  {
    if (this.records.size >= this.maxSessions)
    {
      const idle = [...this.records.values()]
        .filter((entry) => !entry.busy)
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)[0]
      if (!idle)
      {
        throw new McpBoundaryError(
          'mcp.project-session-capacity-exhausted',
          'all project session slots became busy before open completed'
        )
      }
      try
      {
        rmSync(idle.store.root, { recursive: true, force: false })
      }
      catch
      {
        throw new McpBoundaryError(
          'mcp.project-session-eviction-failed',
          'an idle project session could not be evicted safely'
        )
      }
      this.records.delete(idle.sessionId)
      this.resourceCollectionVersion++
    }
    this.records.set(record.sessionId, record)
  }

  private requireRecord(sessionId: unknown): ProjectSessionRecord
  {
    if (
      typeof sessionId !== 'string' ||
      !/^project-[0-9a-f-]{36}$/.test(sessionId)
    )
    {
      throw new McpBoundaryError(
        'mcp.project-session-id-invalid',
        'project session ID is invalid'
      )
    }
    const record = this.records.get(sessionId)
    if (!record)
    {
      throw new McpBoundaryError(
        'mcp.project-session-unknown',
        'project session was not found or was evicted'
      )
    }
    return record
  }

  private touch(record: ProjectSessionRecord): void
  {
    record.lastAccessedAt = Date.now()
  }

  private openProjection(record: ProjectSessionRecord): ProjectOpenResult
  {
    return {
      sessionId: record.sessionId,
      state: record.inspection.canRun ? 'ready' : 'failed',
      input: {
        displayName: record.displayName,
        sha256: record.sha256,
        byteLength: record.byteLength,
      },
      stages: structuredClone(record.inspection.stages),
      metrics: structuredClone(record.inspection.metrics),
      summary: structuredClone(record.inspection.summary),
      issues: structuredClone(record.inspection.issues),
      canRun: record.inspection.canRun,
      limits: this.limits(),
      artifacts: this.artifactViews(record),
      createdAt: record.createdAt,
      untrustedProjectData: true,
    }
  }

  private runProjection(
    record: ProjectSessionRecord,
    run: ProjectRunRecord
  ): ProjectRunResult
  {
    const ids = new Set(run.artifactIds)
    return {
      sessionId: record.sessionId,
      runId: run.runId,
      status: run.status,
      lanes: [...run.lanes],
      scenario: structuredClone(run.scenario),
      vm: structuredClone(run.vm),
      browser: structuredClone(run.browser),
      artifacts: this.artifactViews(record, ids),
      completedAt: run.completedAt,
      untrustedProjectData: true,
    }
  }

  private artifactBytes(record: ProjectSessionRecord): number
  {
    return record.store
      .references()
      .reduce((total, artifact) => total + artifact.byteLength, 0)
  }

  private requireArtifactBudget(record: ProjectSessionRecord): void
  {
    if (this.artifactBytes(record) > this.artifactByteLimit)
    {
      throw new McpBoundaryError(
        'mcp.project-session-artifact-limit',
        'project session artifact byte limit was exceeded'
      )
    }
  }

  private readableArtifacts(
    record: ProjectSessionRecord
  ): ProjectArtifactReference[]
  {
    const hiddenKinds = new Set(['retained-input', 'inspection-catalog'])
    return record.store
      .references()
      .filter(
        (artifact) =>
          !hiddenKinds.has(artifact.kind) &&
          artifact.byteLength <= MAX_PROJECT_RESOURCE_BYTES
      )
  }

  private artifactUri(
    record: ProjectSessionRecord,
    artifact: ProjectArtifactReference
  ): string
  {
    return `scratch-agent://project/${record.sessionId}/artifacts/${artifact.id}`
  }

  private artifactView(
    record: ProjectSessionRecord,
    artifact: ProjectArtifactReference,
    readableIds = new Set(
      this.readableArtifacts(record).map((entry) => entry.id)
    )
  ): ProjectArtifactView
  {
    return {
      id: artifact.id,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      uri: readableIds.has(artifact.id)
        ? this.artifactUri(record, artifact)
        : null,
    }
  }

  private artifactViews(
    record: ProjectSessionRecord,
    selectedIds?: ReadonlySet<string>,
    artifacts?: readonly ProjectArtifactReference[]
  ): ProjectArtifactView[]
  {
    const readable = this.readableArtifacts(record)
    const readableIds = new Set(readable.map((artifact) => artifact.id))
    return (artifacts ?? readable)
      .filter((artifact) => !selectedIds || selectedIds.has(artifact.id))
      .map((artifact) => this.artifactView(record, artifact, readableIds))
  }

  private pageSize(value: unknown): number
  {
    if (value === undefined) return DEFAULT_PROJECT_PAGE_SIZE
    if (
      !Number.isSafeInteger(value) ||
      Number(value) < 1 ||
      Number(value) > MAX_PROJECT_PAGE_SIZE
    )
    {
      throw new McpBoundaryError(
        'mcp.project-query-invalid',
        `pageSize must be an integer from 1 to ${MAX_PROJECT_PAGE_SIZE}`
      )
    }
    return Number(value)
  }

  private cursorMac(body: string): Buffer
  {
    return createHmac('sha256', this.cursorSecret).update(body).digest()
  }

  private encodeCursor(
    record: ProjectSessionRecord,
    queryHash: string,
    offset: number
  ): string
  {
    const body = Buffer.from(
      JSON.stringify({
        sessionId: record.sessionId,
        queryHash,
        version: record.collectionVersion,
        offset,
      })
    ).toString('base64url')
    const signature = this.cursorMac(body).toString('base64url')
    return `${body}.${signature}`
  }

  private cursorOffset(
    record: ProjectSessionRecord,
    queryHash: string,
    value: unknown
  ): number
  {
    if (value === undefined) return 0
    if (typeof value !== 'string' || value.length > 2048)
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor is invalid'
      )
    }
    const [body, signature, extra] = value.split('.')
    if (!body || !signature || extra)
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor is invalid'
      )
    }
    const expected = this.cursorMac(body)
    let actual: Buffer
    try
    {
      actual = Buffer.from(signature, 'base64url')
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor is invalid'
      )
    }
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor signature is invalid'
      )
    }
    let payload: unknown
    try
    {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor payload is invalid'
      )
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor payload is invalid'
      )
    }
    const cursor = payload as Record<string, unknown>
    if (
      cursor.sessionId !== record.sessionId ||
      cursor.queryHash !== queryHash
    )
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-mismatch',
        'cursor belongs to another session or query'
      )
    }
    if (cursor.version !== record.collectionVersion)
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-stale',
        'cursor collection version is stale'
      )
    }
    if (!Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0)
    {
      throw new McpBoundaryError(
        'mcp.project-cursor-invalid',
        'cursor offset is invalid'
      )
    }
    return Number(cursor.offset)
  }

  private encodeResourceCursor(offset: number): string
  {
    const body = Buffer.from(
      JSON.stringify({
        kind: 'resources',
        version: this.resourceCollectionVersion,
        offset,
      })
    ).toString('base64url')
    const signature = this.cursorMac(body).toString('base64url')
    return `${body}.${signature}`
  }

  private resourceCursorOffset(value: unknown): number
  {
    if (value === undefined) return 0
    if (typeof value !== 'string' || value.length > 2048)
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor is invalid'
      )
    }
    const [body, signature, extra] = value.split('.')
    if (!body || !signature || extra)
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor is invalid'
      )
    }
    const expected = this.cursorMac(body)
    let actual: Buffer
    try
    {
      actual = Buffer.from(signature, 'base64url')
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor is invalid'
      )
    }
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor signature is invalid'
      )
    }
    let payload: unknown
    try
    {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor payload is invalid'
      )
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor payload is invalid'
      )
    }
    const cursor = payload as Record<string, unknown>
    if (
      cursor.kind !== 'resources' ||
      cursor.version !== this.resourceCollectionVersion
    )
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-stale',
        'resource cursor collection version is stale'
      )
    }
    if (!Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0)
    {
      throw new McpBoundaryError(
        'mcp.project-resource-cursor-invalid',
        'resource cursor offset is invalid'
      )
    }
    return Number(cursor.offset)
  }

  private queryItems(
    record: ProjectSessionRecord,
    query: ProjectQuery
  ): unknown[]
  {
    switch (query.kind)
    {
      case 'targets':
        return record.catalog.targets
      case 'scripts':
        return record.catalog.scripts.filter(
          (script) =>
            query.targetIndex === undefined ||
            script.targetIndex === query.targetIndex
        )
      case 'script-blocks':
        return record.catalog.blocks
          .filter(
            (block) =>
              block.targetIndex === query.targetIndex &&
              block.scriptIndex === query.scriptIndex
          )
          .sort(
            (a, b) =>
              (a.orderInScript ?? Number.MAX_SAFE_INTEGER) -
              (b.orderInScript ?? Number.MAX_SAFE_INTEGER)
          )
      case 'declarations':
        return record.catalog.declarations.filter(
          (declaration) =>
            (query.targetIndex === undefined ||
              declaration.targetIndex === query.targetIndex) &&
            (query.declarationKind === undefined ||
              declaration.kind === query.declarationKind)
        )
      case 'diagnostics':
        return record.catalog.diagnostics.filter(
          (diagnostic) =>
            (query.source === undefined ||
              diagnostic.source === query.source) &&
            (query.severity === undefined ||
              diagnostic.severity === query.severity)
        )
      case 'runs':
        return record.runs.map(publicRun)
      case 'snapshots':
      {
        const trace = traceForLane(record, String(query.runId), query.lane)
        return trace.snapshots.map((snapshot, snapshotIndex) => ({
          snapshotIndex,
          label: snapshot.label ?? null,
          tick: snapshot.tick,
          targetCount: snapshot.targetOrder.length,
          variableCount: Object.keys(snapshot.variables).length,
          listCount: Object.keys(snapshot.lists).length,
          hasVisual: snapshot.visual !== undefined,
        }))
      }
      case 'snapshot-state':
      {
        const trace = traceForLane(record, String(query.runId), query.lane)
        const index = Number(query.snapshotIndex)
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          !trace.snapshots[index]
        )
        {
          throw new McpBoundaryError(
            'mcp.project-query-invalid',
            'snapshotIndex is invalid'
          )
        }
        return [trace.snapshots[index]]
      }
      case 'artifacts':
      {
        const run =
          query.runId === undefined
            ? null
            : record.runs.find((entry) => entry.runId === query.runId)
        if (query.runId !== undefined && !run)
        {
          throw new McpBoundaryError(
            'mcp.project-query-invalid',
            'runId was not found in this project session'
          )
        }
        const ids = run ? new Set(run.artifactIds) : null
        return this.artifactViews(
          record,
          ids ?? undefined,
          record.store
            .references()
            .filter((artifact) => artifact.kind !== 'retained-input')
        )
      }
      default:
        throw new McpBoundaryError(
          'mcp.project-query-invalid',
          'project inspection query is invalid'
        )
    }
  }
}
