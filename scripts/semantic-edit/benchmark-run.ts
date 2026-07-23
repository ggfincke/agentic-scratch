// scripts/semantic-edit/benchmark-run.ts
// real MCP-only execution of the two generic semantic-edit benchmark workflows

import {
  appendFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import {
  editExportReopenSha256V1,
  productionOperationChangeFingerprintV1,
  type EditToolName,
  type EditToolResultV1,
  type HeadProjectionV1,
  type OperationPlanningFactsHeaderV1,
  type SemanticEditOperationGoalV1,
  type SemanticEditOperationV1,
} from '@scratch-agent/edit'
import { inspectSemanticEditArtifact } from '@scratch-agent/eval'
import type { ProjectDelta } from '@scratch-agent/ir'

import {
  SEMANTIC_EDIT_BENCHMARK_WORKFLOWS,
  canonicalSha256,
  readBoundedRegularFileV1,
  sha256,
  writeExclusive,
  type SemanticEditGeneratedInputsV1,
  type SemanticEditRunLayoutV1,
  type SemanticEditTraceRecordV1,
} from './harness.js'
import type { SemanticEditBenchmarkFixtureV1 } from './benchmark-fixtures.js'
import type { SemanticEditMcpDriverV1 } from './mcp-driver.js'

type SuccessfulEditResultV1<N extends EditToolName> = Extract<
  EditToolResultV1,
  { readonly tool: N; readonly ok: true }
>

type RenameTargetRefV1 = Extract<
  SemanticEditOperationGoalV1,
  { readonly kind: 'target.renameSprite' }
>['target']

interface PlannedOperationV1
{
  readonly operation: SemanticEditOperationV1
  readonly planningFactSetSha256: string
  readonly orderedFactCollectionSha256: string
  readonly inspectionTrace: SemanticEditTraceRecordV1
}

interface AppliedRevisionEvidenceV1
{
  readonly head: HeadProjectionV1
  readonly revisionSha256: string
  readonly deltaSha256: string
  readonly preservationSha256: string
  readonly lineageSha256: string
  readonly reportSha256: string
  readonly preparedEventSha256: string
  readonly committedEventSha256: string
  readonly idempotentRetryEvidenceSha256: string
  readonly previewTrace: SemanticEditTraceRecordV1
  readonly applyTrace: SemanticEditTraceRecordV1
}

interface SemanticEditWorkflowExecutionV1
{
  readonly id: 'behavior-preserving-rename' | 'greenfield-media-addition'
  readonly passed: true
  readonly sessionId: string
  readonly operationKinds: readonly string[]
  readonly planningFactSetSha256s: readonly string[]
  readonly revisionSha256: string
  readonly deltaSha256: string
  readonly preservationSha256: string
  readonly lineageSha256: string
  readonly certificateSha256: string
  readonly reportSha256: string
  readonly publishedSha256: string
  readonly publishedByteLength: number
  readonly reopenSha256: string
  readonly sourcePreservationSha256: string
  readonly terminalCloseRefusal: 'edit.session_closed'
  readonly retainedDeltaFingerprintEvidenceSha256: string
  readonly requiredToolSequenceSha256: string
  readonly publishedSourceEditRefusal: 'edit.source_not_editable'
}

function requiredToolSequenceSha256V1(
  workflowId: SemanticEditWorkflowExecutionV1['id'],
  traces: readonly SemanticEditTraceRecordV1[]
): string
{
  const workflow = SEMANTIC_EDIT_BENCHMARK_WORKFLOWS.find(
    (candidate) => candidate.id === workflowId
  )
  if (!workflow)
    throw new Error(`required tool authority is missing for ${workflowId}`)
  const observed = traces.map((trace) => trace.name)
  if (
    traces.some(
      (trace, index) =>
        trace.boundary !== 'tool' ||
        (index > 0 && traces[index - 1]!.sequence >= trace.sequence)
    ) ||
    JSON.stringify(observed) !== JSON.stringify(workflow.requiredTools)
  )
  {
    throw new Error(
      `${workflowId} required tool sequence differs: ${JSON.stringify(observed)}`
    )
  }
  return canonicalSha256({
    schemaVersion: 1,
    workflowId,
    requiredTools: traces.map((trace) => ({
      sequence: trace.sequence,
      name: trace.name,
      requestSha256: trace.requestSha256,
      outcomeSha256: trace.outcomeSha256,
    })),
  })
}

function exactPublicationDestinationV1(
  outputRootValue: string,
  basename: string
): string
{
  const outputRoot = realpathSync(outputRootValue)
  const entries = readdirSync(outputRoot, { withFileTypes: true })
  if (entries.length > 16)
    throw new Error('publication output root exceeds its benchmark scan bound')
  const publicationRoots: string[] = []
  for (const entry of entries)
  {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !entry.name.startsWith('edit-')
    )
      continue
    const publicationRoot = realpathSync(join(outputRoot, entry.name))
    if (dirname(publicationRoot) === outputRoot)
      publicationRoots.push(publicationRoot)
  }
  if (publicationRoots.length !== 1)
    throw new Error(
      `benchmark host has ${publicationRoots.length} exact publication roots`
    )
  return join(publicationRoots[0]!, basename)
}

function exactPublishedArtifactPathV1(input: {
  readonly outputRoot: string
  readonly basename: string
  readonly sha256: string
  readonly byteLength: number
}): string
{
  const candidate = exactPublicationDestinationV1(
    input.outputRoot,
    input.basename
  )
  const info = lstatSync(candidate)
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('published benchmark project is not a regular file')
  const bytes = readBoundedRegularFileV1(
    candidate,
    128 * 1024 * 1024,
    'published benchmark project'
  )
  if (bytes.byteLength !== input.byteLength || sha256(bytes) !== input.sha256)
    throw new Error('published benchmark project identity differs')
  return realpathSync(candidate)
}

export interface SemanticEditWorkflowExecutionSetV1
{
  readonly workflows: readonly SemanticEditWorkflowExecutionV1[]
  readonly probes: readonly SemanticEditProbeExecutionV1[]
  readonly revisionSha256s: readonly string[]
  readonly deltaSha256s: readonly string[]
  readonly preservationSha256s: readonly string[]
  readonly lineageSha256s: readonly string[]
  readonly certificateSha256s: readonly string[]
  readonly reportSha256s: readonly string[]
}

export interface SemanticEditProbeExecutionV1
{
  readonly id:
    | 'stale-authority'
    | 'ambiguous-selector'
    | 'source-drift'
    | 'root-denial'
    | 'symlink-denial'
    | 'output-path-policy-denial'
    | 'evaluation-unavailable'
    | 'evaluation-inconclusive'
    | 'audit-near-full'
    | 'response-loss-idempotent-retry'
    | 'predecessor-recovery'
  readonly passed: true
  readonly disposition: string
  readonly evidenceSha256: string
}

function record(value: unknown, label: string): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function projectDelta(value: unknown): ProjectDelta | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  const candidate = value as Record<string, unknown>
  return typeof candidate.complete === 'boolean' &&
    Array.isArray(candidate.targets) &&
    Array.isArray(candidate.assets) &&
    Array.isArray(candidate.projectChanges) &&
    Array.isArray(candidate.protectedChanges) &&
    candidate.summary !== null &&
    typeof candidate.summary === 'object'
    ? (candidate as unknown as ProjectDelta)
    : null
}

function deltaOperationIds(value: unknown): readonly string[]
{
  const result = new Set<string>()
  const visit = (candidate: unknown): void =>
  {
    if (Array.isArray(candidate))
    {
      for (const item of candidate) visit(item)
      return
    }
    if (candidate === null || typeof candidate !== 'object') return
    for (const [key, item] of Object.entries(candidate))
    {
      if (key === 'operationIds' && Array.isArray(item))
      {
        for (const operationId of item)
          if (typeof operationId === 'string') result.add(operationId)
        continue
      }
      visit(item)
    }
  }
  visit(value)
  return Object.freeze([...result].sort())
}

async function assertRetainedDeltaFingerprints(input: {
  readonly driver: SemanticEditMcpDriverV1
  readonly expectedFingerprints: readonly string[]
}): Promise<string>
{
  const resources: Array<Record<string, unknown>> = []
  let cursor: string | undefined
  for (let page = 0; page < 64; page += 1)
  {
    const listed = record(
      await input.driver.listResources(cursor),
      'resource listing'
    )
    if (!Array.isArray(listed.resources))
      throw new Error('resource listing has no resources')
    resources.push(
      ...listed.resources.map((entry) => record(entry, 'resource entry'))
    )
    if (typeof listed.nextCursor !== 'string') break
    cursor = listed.nextCursor
    if (page === 63) throw new Error('resource listing exceeded 64 pages')
  }
  for (const resource of resources)
  {
    if (
      resource.mimeType !== 'application/json' ||
      typeof resource.uri !== 'string'
    )
      continue
    const read = record(
      await input.driver.readResource(resource.uri),
      'resource read'
    )
    if (!Array.isArray(read.contents) || read.contents.length !== 1) continue
    const content = record(read.contents[0], 'resource content')
    if (
      typeof content.text !== 'string' ||
      content.text.length > 16 * 1024 * 1024
    )
      continue
    let value: unknown
    try
    {
      value = JSON.parse(content.text)
    }
    catch
    {
      continue
    }
    const delta = projectDelta(value)
    if (!delta) continue
    const fingerprints = deltaOperationIds(delta).map((operationId) =>
      productionOperationChangeFingerprintV1('parent-child', delta, operationId)
    )
    if (
      input.expectedFingerprints.every((expected) =>
        fingerprints.includes(expected)
      )
    )
      return canonicalSha256({
        resourceUriSha256: sha256(resource.uri),
        contentSha256: sha256(content.text),
        expectedFingerprints: [...input.expectedFingerprints].sort(),
        observedFingerprints: [...fingerprints].sort(),
      })
  }
  throw new Error('retained parent delta did not prove contract fingerprints')
}

function projectData(value: unknown, tool: string): Record<string, unknown>
{
  const envelope = record(value, `${tool} result`)
  if (
    envelope.schemaVersion !== 1 ||
    envelope.tool !== tool ||
    !Object.hasOwn(envelope, 'data')
  )
  {
    const error = record(envelope.error, `${tool} error`)
    throw new Error(
      `${tool} failed: ${String(error.code)} ${String(error.message)}`
    )
  }
  return record(envelope.data, `${tool} data`)
}

function projectRefusal(value: unknown, tool: string): string
{
  const envelope = record(value, `${tool} result`)
  if (
    envelope.schemaVersion !== 1 ||
    envelope.tool !== tool ||
    Object.hasOwn(envelope, 'data')
  )
    throw new Error(`${tool} unexpectedly succeeded`)
  return String(record(envelope.error, `${tool} error`).code)
}

function editSuccess<N extends EditToolName>(
  result: Extract<EditToolResultV1, { readonly tool: N }>,
  tool: N
): SuccessfulEditResultV1<N>
{
  if (!result.ok)
    throw new Error(
      `${tool} failed: ${result.error.code} ${result.error.safeMessage}`
    )
  return result as unknown as SuccessfulEditResultV1<N>
}

function refusalCode<N extends EditToolName>(
  result: Extract<EditToolResultV1, { readonly tool: N }>,
  tool: N
): string
{
  if (result.ok) throw new Error(`${tool} unexpectedly succeeded`)
  return result.error.code
}

function requestId(scope: string, ordinal: number): string
{
  return `request_${canonicalSha256({ scope, ordinal }).slice(0, 48)}`
}

function headFromIdentity(value: unknown, label: string): HeadProjectionV1
{
  const identity = record(value, `${label} identity`)
  const head = record(identity.postHead, `${label} post head`)
  for (const field of [
    'sourceArtifactSha256',
    'revisionId',
    'candidateSha256',
    'assetManifestSha256',
    'changeContractSha256',
    'capabilityProfileSha256',
    'capabilitySnapshotSha256',
  ])
    if (typeof head[field] !== 'string')
      throw new Error(`${label} post head is missing ${field}`)
  if (!Number.isSafeInteger(head.revisionNumber))
    throw new Error(`${label} post head has no exact revision number`)
  return head as unknown as HeadProjectionV1
}

function expectedHead(
  sessionId: string,
  head: HeadProjectionV1
): {
  readonly sessionId: string
  readonly expectedSourceArtifactSha256: string
  readonly expectedRevisionNumber: number
  readonly expectedRevisionId: string
  readonly expectedCandidateSha256: string
  readonly expectedAssetManifestSha256: string
  readonly expectedChangeContractSha256: string
  readonly expectedCapabilityProfileSha256: string
}
{
  return {
    sessionId,
    expectedSourceArtifactSha256: head.sourceArtifactSha256,
    expectedRevisionNumber: head.revisionNumber,
    expectedRevisionId: head.revisionId,
    expectedCandidateSha256: head.candidateSha256,
    expectedAssetManifestSha256: head.assetManifestSha256,
    expectedChangeContractSha256: head.changeContractSha256,
    expectedCapabilityProfileSha256: head.capabilityProfileSha256,
  }
}

function planningHead(
  sessionId: string,
  head: HeadProjectionV1
): ReturnType<typeof expectedHead> & {
  readonly expectedCapabilitySnapshotSha256: string
}
{
  return {
    ...expectedHead(sessionId, head),
    expectedCapabilitySnapshotSha256: head.capabilitySnapshotSha256,
  }
}

function setPointer(
  target: Record<string, unknown>,
  pointer: string,
  value: unknown
): void
{
  if (!pointer.startsWith('/') || pointer.includes('*'))
    throw new Error(
      `benchmark planning returned an unsupported destination ${pointer}`
    )
  const parts = pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current = target
  for (const part of parts.slice(0, -1))
  {
    const existing = current[part]
    if (existing === undefined)
    {
      const nested: Record<string, unknown> = Object.create(null)
      current[part] = nested
      current = nested
    }
    else current = record(existing, `planning destination ${pointer}`)
  }
  const leaf = parts.at(-1)
  if (!leaf) throw new Error('planning destination has no leaf')
  current[leaf] = structuredClone(value)
}

function sameHeader(left: unknown, right: unknown): boolean
{
  return canonicalSha256(left) === canonicalSha256(right)
}

async function planningPage(
  driver: SemanticEditMcpDriverV1,
  sessionId: string,
  head: HeadProjectionV1,
  query: Readonly<Record<string, unknown>>
): Promise<{
  readonly header: Record<string, unknown>
  readonly items: readonly Record<string, unknown>[]
  readonly firstTrace: SemanticEditTraceRecordV1
}>
{
  const items: Record<string, unknown>[] = []
  let header: Record<string, unknown> | null = null
  let firstTrace: SemanticEditTraceRecordV1 | null = null
  let cursor: string | undefined
  do
  {
    const called = await driver.callEdit('edit_inspect', {
      schemaVersion: 1,
      revisionSelection: 'currentHead',
      ...expectedHead(sessionId, head),
      query: query as never,
      page: { pageSize: 50, ...(cursor ? { cursor } : {}) },
    })
    firstTrace ??= called.trace
    const result = editSuccess(called.result, 'edit_inspect')
    const data = result.data as Extract<
      typeof result.data,
      { readonly revisionSelection: 'currentHead' }
    >
    const candidateHeader = record(
      data.planningHeader,
      'operation planning header'
    )
    if (header === null) header = candidateHeader
    else if (!sameHeader(header, candidateHeader))
      throw new Error('operation planning header changed across pages')
    for (const item of data.collection.items)
      items.push(record(item, 'operation planning row'))
    cursor = data.collection.nextCursor
  } while (cursor)
  if (header === null) throw new Error('operation planning returned no header')
  if (firstTrace === null)
    throw new Error('operation planning returned no trace authority')
  return Object.freeze({
    header,
    items: Object.freeze(items),
    firstTrace,
  })
}

async function planOperation(
  driver: SemanticEditMcpDriverV1,
  sessionId: string,
  head: HeadProjectionV1,
  goal: SemanticEditOperationGoalV1,
  plannedPrefix: readonly SemanticEditOperationV1[]
): Promise<PlannedOperationV1>
{
  const choices = await planningPage(driver, sessionId, head, {
    kind: 'operationPlanningFacts',
    planningStage: 'enumerateChoices',
    plannedPrefix,
    goal,
  })
  if (
    typeof choices.header.choiceSetSha256 !== 'string' ||
    choices.header.totalChoiceCount !== 0 ||
    choices.items.length !== 0
  )
    throw new Error(
      `${goal.kind} benchmark intent must remain a zero-choice operation`
    )
  const facts = await planningPage(driver, sessionId, head, {
    kind: 'operationPlanningFacts',
    planningStage: 'completeChoices',
    plannedPrefix,
    goal,
    expectedChoiceSetSha256: choices.header.choiceSetSha256,
    choices: [],
  })
  const header = facts.header as unknown as OperationPlanningFactsHeaderV1
  if (
    typeof header.planningFactSetSha256 !== 'string' ||
    typeof header.orderedFactCollectionSha256 !== 'string' ||
    header.totalFactCount !== facts.items.length
  )
    throw new Error(`${goal.kind} planning fact header is incomplete`)
  const operation = structuredClone(goal) as unknown as Record<string, unknown>
  for (const row of facts.items)
  {
    if (row.itemKind !== 'planningFact')
      throw new Error(`${goal.kind} planning returned a non-fact row`)
    if (row.availability !== 'available')
      throw new Error(
        `${goal.kind} planning fact was ${String(row.availability)}: ${String(row.refusalCode)}`
      )
    if (typeof row.destination !== 'string')
      throw new Error(`${goal.kind} planning fact has no destination`)
    const factValue = record(row.value, `${goal.kind} planning fact value`)
    if (!('value' in factValue))
      throw new Error(`${goal.kind} planning fact has no projected value`)
    setPointer(operation, row.destination, factValue.value)
  }
  operation.expectedPlanningFactSetSha256 = header.planningFactSetSha256
  return Object.freeze({
    operation: operation as unknown as SemanticEditOperationV1,
    planningFactSetSha256: header.planningFactSetSha256,
    orderedFactCollectionSha256: header.orderedFactCollectionSha256,
    inspectionTrace: choices.firstTrace,
  })
}

async function ambiguousSelectorProbe(
  driver: SemanticEditMcpDriverV1,
  sessionId: string,
  head: HeadProjectionV1,
  goal: SemanticEditOperationGoalV1
): Promise<SemanticEditProbeExecutionV1>
{
  const enumerateCall = await driver.callEdit('edit_inspect', {
    schemaVersion: 1,
    revisionSelection: 'currentHead',
    ...expectedHead(sessionId, head),
    query: {
      kind: 'operationPlanningFacts',
      planningStage: 'enumerateChoices',
      plannedPrefix: [],
      goal,
    },
    page: { pageSize: 50 },
  })
  let disposition: string
  if (!enumerateCall.result.ok) disposition = enumerateCall.result.error.code
  else
  {
    const data = enumerateCall.result.data as Extract<
      typeof enumerateCall.result.data,
      { readonly revisionSelection: 'currentHead' }
    >
    const header = record(data.planningHeader, 'ambiguous planning header')
    if (
      header.totalChoiceCount !== 0 ||
      typeof header.choiceSetSha256 !== 'string'
    )
      throw new Error('ambiguous selector goal unexpectedly required choices')
    const completeCall = await driver.callEdit('edit_inspect', {
      schemaVersion: 1,
      revisionSelection: 'currentHead',
      ...expectedHead(sessionId, head),
      query: {
        kind: 'operationPlanningFacts',
        planningStage: 'completeChoices',
        plannedPrefix: [],
        goal,
        expectedChoiceSetSha256: header.choiceSetSha256,
        choices: [],
      },
      page: { pageSize: 50 },
    })
    disposition = refusalCode(completeCall.result, 'edit_inspect')
  }
  if (disposition !== 'edit.selector_ambiguous')
    throw new Error(`ambiguous selector probe returned ${disposition}`)
  const statusCall = await driver.callEdit('edit_status', {
    schemaVersion: 1,
    lookup: 'session',
    sessionId,
  })
  const status = editSuccess(statusCall.result, 'edit_status')
  if (
    status.data.lookup !== 'session' ||
    !('head' in status.data) ||
    canonicalSha256(status.data.head) !== canonicalSha256(head)
  )
    throw new Error('ambiguous selector probe changed the session head')
  return Object.freeze({
    id: 'ambiguous-selector',
    passed: true,
    disposition,
    evidenceSha256: canonicalSha256({ disposition, head }),
  })
}

async function inspectBehaviorTarget(
  driver: SemanticEditMcpDriverV1,
  sessionId: string,
  head: HeadProjectionV1,
  targetOrdinal: number
): Promise<{
  readonly handle: RenameTargetRefV1
  readonly trace: SemanticEditTraceRecordV1
}>
{
  const called = await driver.callEdit('edit_inspect', {
    schemaVersion: 1,
    revisionSelection: 'currentHead',
    ...expectedHead(sessionId, head),
    issueHandles: true,
    query: { kind: 'targets' },
    page: { pageSize: 50 },
  })
  const result = editSuccess(called.result, 'edit_inspect')
  const target = result.data.collection.items.find((candidate) =>
  {
    const item = candidate as Record<string, unknown>
    const location = item.location as Record<string, unknown> | undefined
    return (
      item.itemKind === 'entity' &&
      item.entityKind === 'target' &&
      location?.serializedTargetOrdinal === targetOrdinal
    )
  }) as Record<string, unknown> | undefined
  if (
    !target ||
    typeof target.handle !== 'string' ||
    typeof target.semanticFingerprint !== 'string'
  )
    throw new Error('behavior target inspection did not issue an exact handle')
  const handle: RenameTargetRefV1 = {
    entityKind: 'target',
    refKind: 'handle',
    token: target.handle,
    expectedSemanticFingerprint: target.semanticFingerprint,
  }
  return Object.freeze({ handle, trace: called.trace })
}

async function previewAndApply(
  driver: SemanticEditMcpDriverV1,
  scope: string,
  ordinal: number,
  sessionId: string,
  head: HeadProjectionV1,
  operations: readonly SemanticEditOperationV1[]
): Promise<AppliedRevisionEvidenceV1>
{
  const previewCall = await driver.callEdit('edit_preview', {
    schemaVersion: 1,
    sessionId,
    requestId: requestId(`${scope}-preview`, ordinal),
    batch: {
      schemaVersion: 1,
      expected: planningHead(sessionId, head),
      operations,
    },
  })
  const preview = editSuccess(previewCall.result, 'edit_preview')
  if (preview.data.operationCount !== operations.length)
    throw new Error(`${scope} preview did not retain every operation`)
  const applyCall = await driver.callEdit('edit_apply', {
    schemaVersion: 1,
    sessionId,
    requestId: requestId(`${scope}-apply`, ordinal),
    expectedSourceArtifactSha256: head.sourceArtifactSha256,
    expectedRevisionNumber: head.revisionNumber,
    expectedRevisionId: head.revisionId,
    expectedCandidateSha256: head.candidateSha256,
    expectedAssetManifestSha256: head.assetManifestSha256,
    expectedChangeContractSha256: head.changeContractSha256,
    expectedCapabilityProfileSha256: head.capabilityProfileSha256,
    previewId: preview.data.previewId,
    applyGuardSha256: preview.data.applyGuardSha256,
    expectedResolvedPlanSha256: preview.data.resolvedPlanSha256,
  })
  const applied = editSuccess(applyCall.result, 'edit_apply')
  const retryCall = await driver.callEdit('edit_apply', {
    schemaVersion: 1,
    sessionId,
    requestId: requestId(`${scope}-apply`, ordinal),
    expectedSourceArtifactSha256: head.sourceArtifactSha256,
    expectedRevisionNumber: head.revisionNumber,
    expectedRevisionId: head.revisionId,
    expectedCandidateSha256: head.candidateSha256,
    expectedAssetManifestSha256: head.assetManifestSha256,
    expectedChangeContractSha256: head.changeContractSha256,
    expectedCapabilityProfileSha256: head.capabilityProfileSha256,
    previewId: preview.data.previewId,
    applyGuardSha256: preview.data.applyGuardSha256,
    expectedResolvedPlanSha256: preview.data.resolvedPlanSha256,
  })
  const retried = editSuccess(retryCall.result, 'edit_apply')
  if (canonicalSha256(retried.data) !== canonicalSha256(applied.data))
    throw new Error(`${scope} idempotent apply retry changed its outcome`)
  return Object.freeze({
    head: headFromIdentity(applied.data.identity, `${scope} apply`),
    revisionSha256: applied.data.revisionSha256,
    deltaSha256: applied.data.deltaSha256,
    preservationSha256: applied.data.preservationSha256,
    lineageSha256: applied.data.lineageSha256,
    reportSha256: applied.data.reportSha256,
    preparedEventSha256: applied.data.preparedEventSha256,
    committedEventSha256: applied.data.committedEventSha256,
    idempotentRetryEvidenceSha256: canonicalSha256({
      requestId: requestId(`${scope}-apply`, ordinal),
      retainedData: retried.data,
    }),
    previewTrace: previewCall.trace,
    applyTrace: applyCall.trace,
  })
}

async function evaluateExportAndVerify(
  driver: SemanticEditMcpDriverV1,
  input: {
    readonly scope: string
    readonly ordinal: number
    readonly sessionId: string
    readonly head: HeadProjectionV1
    readonly evaluationPlanId: string
    readonly changeContractRegistrationId: string
    readonly expectedSemanticContractSha256: string
    readonly outputBasename: string
    readonly outputRoot: string
    readonly source?: {
      readonly path: string
      readonly sha256: string
    }
  }
): Promise<{
  readonly certificateSha256: string
  readonly reportSha256: string
  readonly publishedSha256: string
  readonly publishedByteLength: number
  readonly reopenSha256: string
  readonly sourcePreservationSha256: string
  readonly outputPolicyProbe: SemanticEditProbeExecutionV1 | null
  readonly evaluateTrace: SemanticEditTraceRecordV1
  readonly statusTrace: SemanticEditTraceRecordV1
  readonly exportTrace: SemanticEditTraceRecordV1
  readonly publishedOpenTrace: SemanticEditTraceRecordV1
  readonly closeTrace: SemanticEditTraceRecordV1
  readonly publishedSourceEditRefusal: 'edit.source_not_editable'
}>
{
  const evaluatedCall = await driver.callEdit('edit_evaluate', {
    schemaVersion: 1,
    action: 'start',
    requestId: requestId(`${input.scope}-evaluate`, input.ordinal),
    evaluationPlanId: input.evaluationPlanId,
    ...expectedHead(input.sessionId, input.head),
  })
  const evaluated = editSuccess(evaluatedCall.result, 'edit_evaluate')
  if (
    evaluated.data.phase !== 'completed' ||
    evaluated.data.certificate.state !== 'present' ||
    evaluated.data.certificate.status !== 'passed'
  )
    throw new Error(
      `${input.scope} evaluation did not produce a passing certificate`
    )
  const certificateSha256 = evaluated.data.certificate.certificateSha256
  const statusCall = await driver.callEdit('edit_status', {
    schemaVersion: 1,
    lookup: 'session',
    sessionId: input.sessionId,
  })
  editSuccess(statusCall.result, 'edit_status')
  let outputPolicyProbe: SemanticEditProbeExecutionV1 | null = null
  if (input.source)
  {
    const deniedBasename = `denied-${input.scope}.sb3`
    const deniedPath = exactPublicationDestinationV1(
      input.outputRoot,
      deniedBasename
    )
    const deniedCall = await driver.callEdit('edit_export', {
      schemaVersion: 1,
      requestId: requestId(`${input.scope}-denied-export`, input.ordinal),
      certificateSha256,
      output: { kind: 'basename', basename: deniedBasename },
      ...expectedHead(input.sessionId, input.head),
    })
    const deniedDisposition = refusalCode(deniedCall.result, 'edit_export')
    const sourceBytesAfterDenial = readBoundedRegularFileV1(
      input.source.path,
      128 * 1024 * 1024,
      `${input.scope} source after output-policy refusal`
    )
    if (
      deniedDisposition !== 'edit.output_invalid' ||
      existsSync(deniedPath) ||
      sha256(sourceBytesAfterDenial) !== input.source.sha256
    )
      throw new Error(
        `${input.scope} output-path policy denial did not preserve the source`
      )
    outputPolicyProbe = Object.freeze({
      id: 'output-path-policy-denial',
      passed: true,
      disposition: deniedDisposition,
      evidenceSha256: canonicalSha256({
        deniedBasename,
        sourceSha256: input.source.sha256,
        outputAbsent: true,
      }),
    })
  }
  const exportCall = await driver.callEdit('edit_export', {
    schemaVersion: 1,
    requestId: requestId(`${input.scope}-export`, input.ordinal),
    certificateSha256,
    output: { kind: 'basename', basename: input.outputBasename },
    ...expectedHead(input.sessionId, input.head),
  })
  const exported = editSuccess(exportCall.result, 'edit_export')
  if (exported.data.terminalState !== 'closed-exported')
    throw new Error(`${input.scope} export was not terminal`)
  const publishedPath = exactPublishedArtifactPathV1({
    outputRoot: input.outputRoot,
    basename: input.outputBasename,
    sha256: exported.data.publishedSha256,
    byteLength: exported.data.publishedByteLength,
  })
  const outputBytes = readBoundedRegularFileV1(
    publishedPath,
    128 * 1024 * 1024,
    `${input.scope} exported project`
  )
  if (
    outputBytes.byteLength !== exported.data.publishedByteLength ||
    sha256(outputBytes) !== exported.data.publishedSha256
  )
    throw new Error(`${input.scope} export/reopen identity did not reconcile`)
  const reopened = await inspectSemanticEditArtifact(outputBytes)
  if (!reopened.ok || !reopened.admission || !reopened.semanticSourceIdentity)
    throw new Error(`${input.scope} exported project did not re-admit`)
  const reopenEvidence = (stage: 'preparedTemp' | 'committedFinal') => ({
    schemaVersion: 1 as const,
    stage,
    admitted: true,
    projectJsonSha256: reopened.semanticSourceIdentity!.projectJsonSha256,
    assetManifestSha256: reopened.semanticSourceIdentity!.assetManifestSha256,
    byteLength: outputBytes.byteLength,
    artifactSha256: sha256(outputBytes),
    diagnosticsStatus: 'passed' as const,
  })
  if (
    exported.data.reopenSha256 !==
    editExportReopenSha256V1([
      reopenEvidence('preparedTemp'),
      reopenEvidence('committedFinal'),
    ])
  )
    throw new Error(`${input.scope} export reopen evidence did not reconcile`)
  const publishedOpenCall = await driver.callProject('project_open', {
    inputPath: publishedPath,
  })
  const publishedOpen = projectData(publishedOpenCall.result, 'project_open')
  const publishedInput = record(
    publishedOpen.input,
    `${input.scope} published project input`
  )
  if (
    typeof publishedOpen.sessionId !== 'string' ||
    publishedInput.sha256 !== exported.data.publishedSha256 ||
    publishedInput.byteLength !== exported.data.publishedByteLength
  )
    throw new Error(`${input.scope} published project_open identity differs`)
  const publishedBeginCall = await driver.callEdit('edit_begin', {
    schemaVersion: 1,
    requestId: requestId(
      `${input.scope}-published-source-begin`,
      input.ordinal
    ),
    baseline: {
      kind: 'projectSession',
      projectSessionId: publishedOpen.sessionId,
      expectedSourceArtifactSha256: exported.data.publishedSha256,
    },
    changeContractRegistrationId: input.changeContractRegistrationId,
    expectedSemanticContractSha256: input.expectedSemanticContractSha256,
  })
  const publishedSourceEditRefusal = refusalCode(
    publishedBeginCall.result,
    'edit_begin'
  )
  if (publishedSourceEditRefusal !== 'edit.source_not_editable')
    throw new Error(
      `${input.scope} published source edit refusal was ${publishedSourceEditRefusal}`
    )
  const closeCall = await driver.callEdit('edit_close', {
    schemaVersion: 1,
    requestId: requestId(`${input.scope}-post-export-close`, input.ordinal),
    reason: 'prove terminal export rejects a second close',
    ...expectedHead(input.sessionId, input.head),
  })
  const closeCode = refusalCode(closeCall.result, 'edit_close')
  if (closeCode !== 'edit.session_closed')
    throw new Error(`${input.scope} post-export close returned ${closeCode}`)
  return Object.freeze({
    certificateSha256,
    reportSha256: exported.data.reportSha256,
    publishedSha256: exported.data.publishedSha256,
    publishedByteLength: exported.data.publishedByteLength,
    reopenSha256: exported.data.reopenSha256,
    sourcePreservationSha256: exported.data.sourcePreservationSha256,
    outputPolicyProbe,
    evaluateTrace: evaluatedCall.trace,
    statusTrace: statusCall.trace,
    exportTrace: exportCall.trace,
    publishedOpenTrace: publishedOpenCall.trace,
    closeTrace: closeCall.trace,
    publishedSourceEditRefusal,
  })
}

async function behaviorWorkflow(
  driver: SemanticEditMcpDriverV1,
  fixture: SemanticEditBenchmarkFixtureV1,
  inputs: SemanticEditGeneratedInputsV1,
  layout: SemanticEditRunLayoutV1,
  probes: SemanticEditProbeExecutionV1[]
): Promise<SemanticEditWorkflowExecutionV1>
{
  const openedCall = await driver.callProject('project_open', {
    inputPath: inputs.behaviorProject.path,
  })
  const opened = projectData(openedCall.result, 'project_open')
  if (
    typeof opened.sessionId !== 'string' ||
    record(opened.input, 'project input').sha256 !==
      inputs.behaviorProject.sha256
  )
    throw new Error('behavior project_open did not retain the exact input')
  const projectSessionId = opened.sessionId
  const capabilityCall = await driver.callEdit('edit_capabilities', {
    schemaVersion: 1,
    context: {
      kind: 'project',
      projectSessionId,
      expectedSourceArtifactSha256: inputs.behaviorProject.sha256,
    },
    query: { kind: 'operations', operationKinds: ['target.renameSprite'] },
    page: { pageSize: 50 },
  })
  editSuccess(capabilityCall.result, 'edit_capabilities')
  const beginCall = await driver.callEdit('edit_begin', {
    schemaVersion: 1,
    requestId: requestId('behavior-begin', 1),
    baseline: {
      kind: 'projectSession',
      projectSessionId,
      expectedSourceArtifactSha256: inputs.behaviorProject.sha256,
    },
    changeContractRegistrationId: fixture.behaviorContract.registrationId,
    expectedSemanticContractSha256:
      fixture.behaviorContract.semanticContractSha256,
  })
  const begun = editSuccess(beginCall.result, 'edit_begin')
  const sessionId = begun.data.identity.sessionId
  const beginHead = headFromIdentity(begun.data.identity, 'behavior begin')
  const target = await inspectBehaviorTarget(
    driver,
    sessionId,
    beginHead,
    fixture.behavior.targetOrdinal
  )
  probes.push(
    await ambiguousSelectorProbe(driver, sessionId, beginHead, {
      ...fixture.behavior.goal,
      target: fixture.behavior.ambiguousTarget,
    })
  )
  const planned = await planOperation(
    driver,
    sessionId,
    beginHead,
    { ...fixture.behavior.goal, target: target.handle },
    []
  )
  const applied = await previewAndApply(
    driver,
    'behavior',
    1,
    sessionId,
    beginHead,
    [planned.operation]
  )
  const staleCall = await driver.callEdit('edit_inspect', {
    schemaVersion: 1,
    revisionSelection: 'currentHead',
    ...expectedHead(sessionId, beginHead),
    query: { kind: 'summary' },
    page: { pageSize: 50 },
  })
  const staleDisposition = refusalCode(staleCall.result, 'edit_inspect')
  if (staleDisposition !== 'edit.stale_revision')
    throw new Error(`stale authority probe returned ${staleDisposition}`)
  const postStaleStatusCall = await driver.callEdit('edit_status', {
    schemaVersion: 1,
    lookup: 'session',
    sessionId,
  })
  const postStaleStatus = editSuccess(postStaleStatusCall.result, 'edit_status')
  if (
    postStaleStatus.data.lookup !== 'session' ||
    !('head' in postStaleStatus.data) ||
    canonicalSha256(postStaleStatus.data.head) !== canonicalSha256(applied.head)
  )
    throw new Error('stale authority probe changed the session head')
  probes.push(
    Object.freeze({
      id: 'stale-authority',
      passed: true,
      disposition: staleDisposition,
      evidenceSha256: canonicalSha256({
        staleHead: beginHead,
        retainedHead: applied.head,
      }),
    })
  )
  const retainedDeltaFingerprintEvidenceSha256 =
    await assertRetainedDeltaFingerprints({
      driver,
      expectedFingerprints: [fixture.behavior.semanticChangeFingerprint],
    })
  const checkpointCall = await driver.callEdit('edit_checkpoint', {
    schemaVersion: 1,
    requestId: requestId('behavior-checkpoint', 1),
    label: 'accepted-rename',
    note: 'post-apply benchmark checkpoint',
    ...expectedHead(sessionId, applied.head),
  })
  editSuccess(checkpointCall.result, 'edit_checkpoint')
  const terminal = await evaluateExportAndVerify(driver, {
    scope: 'behavior',
    ordinal: 1,
    sessionId,
    head: applied.head,
    evaluationPlanId: fixture.behaviorContract.evaluationPlanId,
    changeContractRegistrationId: fixture.behaviorContract.registrationId,
    expectedSemanticContractSha256:
      fixture.behaviorContract.semanticContractSha256,
    outputBasename: fixture.behavior.outputBasename,
    outputRoot: layout.outputRoot,
    source: {
      path: inputs.behaviorProject.path,
      sha256: inputs.behaviorProject.sha256,
    },
  })
  if (!terminal.outputPolicyProbe)
    throw new Error('behavior workflow omitted its output-policy probe')
  probes.push(terminal.outputPolicyProbe)
  const requiredToolSequenceSha256 = requiredToolSequenceSha256V1(
    'behavior-preserving-rename',
    [
      openedCall.trace,
      capabilityCall.trace,
      beginCall.trace,
      target.trace,
      applied.previewTrace,
      applied.applyTrace,
      checkpointCall.trace,
      terminal.evaluateTrace,
      terminal.statusTrace,
      terminal.exportTrace,
      terminal.publishedOpenTrace,
      terminal.closeTrace,
    ]
  )
  return Object.freeze({
    id: 'behavior-preserving-rename',
    passed: true,
    sessionId,
    operationKinds: Object.freeze([planned.operation.kind]),
    planningFactSetSha256s: Object.freeze([planned.planningFactSetSha256]),
    revisionSha256: applied.revisionSha256,
    deltaSha256: applied.deltaSha256,
    preservationSha256: applied.preservationSha256,
    lineageSha256: applied.lineageSha256,
    certificateSha256: terminal.certificateSha256,
    reportSha256: terminal.reportSha256,
    publishedSha256: terminal.publishedSha256,
    publishedByteLength: terminal.publishedByteLength,
    reopenSha256: terminal.reopenSha256,
    sourcePreservationSha256: terminal.sourcePreservationSha256,
    terminalCloseRefusal: 'edit.session_closed',
    retainedDeltaFingerprintEvidenceSha256,
    requiredToolSequenceSha256,
    publishedSourceEditRefusal: terminal.publishedSourceEditRefusal,
  })
}

async function mediaWorkflow(
  driver: SemanticEditMcpDriverV1,
  fixture: SemanticEditBenchmarkFixtureV1,
  inputs: SemanticEditGeneratedInputsV1,
  layout: SemanticEditRunLayoutV1
): Promise<SemanticEditWorkflowExecutionV1>
{
  const capabilityCall = await driver.callEdit('edit_capabilities', {
    schemaVersion: 1,
    query: {
      kind: 'operations',
      operationKinds: ['target.addSprite', 'media.addCostume'],
    },
    page: { pageSize: 50 },
  })
  editSuccess(capabilityCall.result, 'edit_capabilities')
  const beginCall = await driver.callEdit('edit_begin', {
    schemaVersion: 1,
    requestId: requestId('media-begin', 1),
    baseline: {
      kind: 'template',
      templateId: fixture.mediaContract.templateId,
      expectedVersion: fixture.mediaContract.templateVersion,
      expectedArtifactSha256: fixture.mediaContract.templateArtifactSha256,
    },
    changeContractRegistrationId: fixture.mediaContract.registrationId,
    expectedSemanticContractSha256:
      fixture.mediaContract.semanticContractSha256,
  })
  const begun = editSuccess(beginCall.result, 'edit_begin')
  const sessionId = begun.data.identity.sessionId
  let head = headFromIdentity(begun.data.identity, 'media begin')
  const admitCall = await driver.callEdit('edit_asset_admit', {
    schemaVersion: 1,
    requestId: requestId('media-asset-admit', 1),
    ...planningHead(sessionId, head),
    source: {
      kind: 'inputFile',
      absolutePath: inputs.mediaAsset.path,
      expectedPayloadSha256: inputs.mediaAsset.sha256,
      expectedByteLength: inputs.mediaAsset.byteLength,
      mediaKind: 'costume',
    },
  })
  const admitted = editSuccess(admitCall.result, 'edit_asset_admit')
  if (
    admitted.data.payloadSha256 !== fixture.media.expectedPayloadSha256 ||
    admitted.data.mediaMetadataSha256 !== fixture.media.expectedMetadataSha256
  )
    throw new Error('media admission identity differs from fixture authority')
  head = headFromIdentity(admitted.data.identity, 'media asset admission')
  const plannedSprite = await planOperation(
    driver,
    sessionId,
    head,
    fixture.media.addSpriteGoal,
    []
  )
  const asset = {
    assetToken: admitted.data.assetHandle,
    expectedPayloadSha256: admitted.data.payloadSha256,
    expectedMetadataSha256: admitted.data.mediaMetadataSha256,
  }
  const plannedCostume = await planOperation(
    driver,
    sessionId,
    head,
    fixture.media.addCostumeGoal(asset),
    [plannedSprite.operation]
  )
  const applied = await previewAndApply(driver, 'media', 1, sessionId, head, [
    plannedSprite.operation,
    plannedCostume.operation,
  ])
  const retainedDeltaFingerprintEvidenceSha256 =
    await assertRetainedDeltaFingerprints({
      driver,
      expectedFingerprints: [
        fixture.media.spriteChangeFingerprint,
        fixture.media.costumeChangeFingerprint,
      ],
    })
  const terminal = await evaluateExportAndVerify(driver, {
    scope: 'media',
    ordinal: 1,
    sessionId,
    head: applied.head,
    evaluationPlanId: fixture.mediaContract.evaluationPlanId,
    changeContractRegistrationId: fixture.mediaContract.registrationId,
    expectedSemanticContractSha256:
      fixture.mediaContract.semanticContractSha256,
    outputBasename: fixture.media.outputBasename,
    outputRoot: layout.outputRoot,
  })
  const requiredToolSequenceSha256 = requiredToolSequenceSha256V1(
    'greenfield-media-addition',
    [
      capabilityCall.trace,
      beginCall.trace,
      admitCall.trace,
      plannedSprite.inspectionTrace,
      applied.previewTrace,
      applied.applyTrace,
      terminal.evaluateTrace,
      terminal.statusTrace,
      terminal.exportTrace,
      terminal.publishedOpenTrace,
      terminal.closeTrace,
    ]
  )
  return Object.freeze({
    id: 'greenfield-media-addition',
    passed: true,
    sessionId,
    operationKinds: Object.freeze([
      plannedSprite.operation.kind,
      plannedCostume.operation.kind,
    ]),
    planningFactSetSha256s: Object.freeze([
      plannedSprite.planningFactSetSha256,
      plannedCostume.planningFactSetSha256,
    ]),
    revisionSha256: applied.revisionSha256,
    deltaSha256: applied.deltaSha256,
    preservationSha256: applied.preservationSha256,
    lineageSha256: applied.lineageSha256,
    certificateSha256: terminal.certificateSha256,
    reportSha256: terminal.reportSha256,
    publishedSha256: terminal.publishedSha256,
    publishedByteLength: terminal.publishedByteLength,
    reopenSha256: terminal.reopenSha256,
    sourcePreservationSha256: terminal.sourcePreservationSha256,
    terminalCloseRefusal: 'edit.session_closed',
    retainedDeltaFingerprintEvidenceSha256,
    requiredToolSequenceSha256,
    publishedSourceEditRefusal: terminal.publishedSourceEditRefusal,
  })
}

async function boundaryAndSourceProbes(
  driver: SemanticEditMcpDriverV1,
  fixture: SemanticEditBenchmarkFixtureV1,
  inputs: SemanticEditGeneratedInputsV1,
  layout: SemanticEditRunLayoutV1
): Promise<readonly SemanticEditProbeExecutionV1[]>
{
  const sourceBytes = readBoundedRegularFileV1(
    inputs.behaviorProject.path,
    128 * 1024 * 1024,
    'benchmark boundary probe source'
  )
  const outsidePath = join(layout.workspaceRoot, 'outside-project.sb3')
  writeExclusive(outsidePath, sourceBytes)
  const rootCall = await driver.callProject('project_open', {
    inputPath: outsidePath,
  })
  const rootDisposition = projectRefusal(rootCall.result, 'project_open')
  if (rootDisposition !== 'mcp.input-outside-root')
    throw new Error(`root denial probe returned ${rootDisposition}`)
  const symlinkPath = join(layout.inputRoot, 'symlink-project.sb3')
  symlinkSync(outsidePath, symlinkPath)
  const symlinkCall = await driver
    .callProject('project_open', { inputPath: symlinkPath })
    .finally(() => unlinkSync(symlinkPath))
  const symlinkDisposition = projectRefusal(symlinkCall.result, 'project_open')
  if (symlinkDisposition !== 'mcp.input-symlink')
    throw new Error(`symlink denial probe returned ${symlinkDisposition}`)
  const driftPath = join(layout.inputRoot, 'source-drift-project.sb3')
  writeExclusive(driftPath, sourceBytes)
  const openedCall = await driver.callProject('project_open', {
    inputPath: driftPath,
  })
  const opened = projectData(openedCall.result, 'project_open')
  if (typeof opened.sessionId !== 'string')
    throw new Error('source drift probe did not open a project session')
  appendFileSync(driftPath, Uint8Array.of(0))
  const beginCall = await driver.callEdit('edit_begin', {
    schemaVersion: 1,
    requestId: requestId('source-drift-begin', 1),
    baseline: {
      kind: 'projectSession',
      projectSessionId: opened.sessionId,
      expectedSourceArtifactSha256: inputs.behaviorProject.sha256,
    },
    changeContractRegistrationId: fixture.behaviorContract.registrationId,
    expectedSemanticContractSha256:
      fixture.behaviorContract.semanticContractSha256,
  })
  const driftDisposition = refusalCode(beginCall.result, 'edit_begin')
  if (driftDisposition !== 'edit.source_identity_mismatch')
    throw new Error(`source drift probe returned ${driftDisposition}`)
  const statusCall = await driver.callProject('project_status', {
    sessionId: opened.sessionId,
  })
  const status = projectData(statusCall.result, 'project_status')
  const statusInput = record(status.input, 'source drift project status input')
  const statusRetention = record(
    status.retention,
    'source drift project status retention'
  )
  if (
    status.sessionId !== opened.sessionId ||
    status.state === 'running' ||
    statusInput.sha256 !== inputs.behaviorProject.sha256 ||
    statusInput.byteLength !== sourceBytes.byteLength ||
    !Number.isSafeInteger(statusRetention.activeSessionCount) ||
    Number(statusRetention.activeSessionCount) < 1
  )
    throw new Error('source drift status did not retain idle session authority')
  const reacquisitionRequestId = requestId('source-drift-reacquire-begin', 1)
  const reacquiredCall = await driver.callEdit('edit_begin', {
    schemaVersion: 1,
    requestId: reacquisitionRequestId,
    baseline: {
      kind: 'projectSession',
      projectSessionId: opened.sessionId,
      expectedSourceArtifactSha256: inputs.behaviorProject.sha256,
    },
    changeContractRegistrationId: fixture.behaviorContract.registrationId,
    expectedSemanticContractSha256:
      fixture.behaviorContract.semanticContractSha256,
  })
  const reacquiredDisposition = refusalCode(reacquiredCall.result, 'edit_begin')
  if (reacquiredDisposition !== 'edit.source_identity_mismatch')
    throw new Error(
      `source drift lease reacquisition returned ${reacquiredDisposition}`
    )
  return Object.freeze([
    Object.freeze({
      id: 'root-denial',
      passed: true,
      disposition: rootDisposition,
      evidenceSha256: canonicalSha256({
        outsidePathSha256: sha256(sourceBytes),
        outsideRoot: true,
      }),
    }),
    Object.freeze({
      id: 'symlink-denial',
      passed: true,
      disposition: symlinkDisposition,
      evidenceSha256: canonicalSha256({
        symlinkTargetSha256: sha256(sourceBytes),
        noFollow: true,
      }),
    }),
    Object.freeze({
      id: 'source-drift',
      passed: true,
      disposition: driftDisposition,
      evidenceSha256: canonicalSha256({
        admittedSha256: inputs.behaviorProject.sha256,
        changedSha256: sha256(
          readBoundedRegularFileV1(
            driftPath,
            128 * 1024 * 1024,
            'changed source drift probe input'
          )
        ),
        statusAuthoritySha256: canonicalSha256(status),
        reacquisitionRequestId,
        reacquiredDisposition,
      }),
    }),
  ])
}

export async function runSemanticEditEvaluationDispositionProbeV1(input: {
  readonly driver: SemanticEditMcpDriverV1
  readonly fixture: SemanticEditBenchmarkFixtureV1
  readonly inputs: SemanticEditGeneratedInputsV1
  readonly outputRoot: string
  readonly disposition:
    'required-lane-unavailable' | 'required-lane-inconclusive'
}): Promise<SemanticEditProbeExecutionV1>
{
  const openedCall = await input.driver.callProject('project_open', {
    inputPath: input.inputs.behaviorProject.path,
  })
  const opened = projectData(openedCall.result, 'project_open')
  if (typeof opened.sessionId !== 'string')
    throw new Error('evaluation disposition probe did not open its source')
  const beginCall = await input.driver.callEdit('edit_begin', {
    schemaVersion: 1,
    requestId: requestId(`${input.disposition}-begin`, 1),
    baseline: {
      kind: 'projectSession',
      projectSessionId: opened.sessionId,
      expectedSourceArtifactSha256: input.inputs.behaviorProject.sha256,
    },
    changeContractRegistrationId: input.fixture.behaviorContract.registrationId,
    expectedSemanticContractSha256:
      input.fixture.behaviorContract.semanticContractSha256,
  })
  const begun = editSuccess(beginCall.result, 'edit_begin')
  const sessionId = begun.data.identity.sessionId
  const head = headFromIdentity(begun.data.identity, 'evaluation probe begin')
  const target = await inspectBehaviorTarget(
    input.driver,
    sessionId,
    head,
    input.fixture.behavior.targetOrdinal
  )
  const planned = await planOperation(
    input.driver,
    sessionId,
    head,
    { ...input.fixture.behavior.goal, target: target.handle },
    []
  )
  const applied = await previewAndApply(
    input.driver,
    input.disposition,
    1,
    sessionId,
    head,
    [planned.operation]
  )
  const evaluatedCall = await input.driver.callEdit('edit_evaluate', {
    schemaVersion: 1,
    action: 'start',
    requestId: requestId(`${input.disposition}-evaluate`, 1),
    evaluationPlanId: input.fixture.behaviorContract.evaluationPlanId,
    ...expectedHead(sessionId, applied.head),
  })
  const evaluated = editSuccess(evaluatedCall.result, 'edit_evaluate')
  const expectedPhase =
    input.disposition === 'required-lane-unavailable'
      ? 'unavailable'
      : 'inconclusive'
  if (evaluated.data.phase !== expectedPhase)
    throw new Error(
      `${input.disposition} produced ${evaluated.data.phase}, not ${expectedPhase}`
    )
  if (
    evaluated.data.certificate.state !== 'present' ||
    evaluated.data.certificate.status !== expectedPhase
  )
    throw new Error(
      `${expectedPhase} evaluation lacks its retained certificate`
    )
  const requiredHostAction = evaluated.data.requiredHostAction
  if (
    expectedPhase === 'unavailable'
      ? requiredHostAction.kind !== 'configureEvidenceProducer' ||
        requiredHostAction.limitationCode !== 'edit.evaluation_unavailable'
      : requiredHostAction.kind !== 'none'
  )
    throw new Error(
      `${expectedPhase} evaluation returned the wrong host action`
    )
  const deniedBasename = `${expectedPhase}-denied.sb3`
  const deniedOutputPath = exactPublicationDestinationV1(
    input.outputRoot,
    deniedBasename
  )
  const exportCall = await input.driver.callEdit('edit_export', {
    schemaVersion: 1,
    requestId: requestId(`${input.disposition}-export`, 1),
    certificateSha256: evaluated.data.certificate.certificateSha256,
    output: { kind: 'basename', basename: deniedBasename },
    ...expectedHead(sessionId, applied.head),
  })
  const exportDisposition = refusalCode(exportCall.result, 'edit_export')
  if (exportCall.result.ok)
    throw new Error(`${expectedPhase} export probe unexpectedly succeeded`)
  if (!('identity' in exportCall.result))
    throw new Error(`${expectedPhase} export refusal lacks session identity`)
  const expectedExportDisposition =
    expectedPhase === 'unavailable'
      ? 'edit.evaluation_unavailable'
      : 'edit.evaluation_inconclusive'
  if (exportDisposition !== expectedExportDisposition)
    throw new Error(
      `${expectedPhase} export probe returned ${exportDisposition}`
    )
  const exportHead = headFromIdentity(
    exportCall.result.identity,
    `${expectedPhase} export refusal`
  )
  if (canonicalSha256(exportHead) !== canonicalSha256(applied.head))
    throw new Error(`${expectedPhase} export refusal changed the head`)
  if (existsSync(deniedOutputPath))
    throw new Error(
      `${expectedPhase} export probe created a denied output path`
    )
  const closeCall = await input.driver.callEdit('edit_close', {
    schemaVersion: 1,
    requestId: requestId(`${input.disposition}-close`, 1),
    reason: 'evaluation disposition probe is complete',
    ...expectedHead(sessionId, applied.head),
  })
  editSuccess(closeCall.result, 'edit_close')
  return Object.freeze({
    id:
      input.disposition === 'required-lane-unavailable'
        ? 'evaluation-unavailable'
        : 'evaluation-inconclusive',
    passed: true,
    disposition:
      input.disposition === 'required-lane-unavailable'
        ? 'edit.evaluation_unavailable'
        : 'edit.evaluation_inconclusive',
    evidenceSha256: canonicalSha256({
      evaluationId: evaluated.data.evaluationId,
      phase: evaluated.data.phase,
      evaluationAttemptSha256: evaluated.data.evaluationAttemptSha256,
      certificate: evaluated.data.certificate,
      requiredHostAction,
      exportDisposition,
      unchangedHead: canonicalSha256(exportHead),
      outputAbsent: true,
    }),
  })
}

export async function runSemanticEditAuditNearFullProbeV1(input: {
  readonly driver: SemanticEditMcpDriverV1
  readonly maximumCalls: number
}): Promise<SemanticEditProbeExecutionV1>
{
  if (
    !Number.isSafeInteger(input.maximumCalls) ||
    input.maximumCalls < 1 ||
    input.maximumCalls > 64
  )
    throw new Error('audit near-full probe call bound is invalid')
  for (let ordinal = 1; ordinal <= input.maximumCalls; ordinal++)
  {
    const outcome = await input.driver.callEditBoundaryProbe(
      'edit_capabilities',
      {
        schemaVersion: 1,
        query: { kind: 'summary' },
        page: { pageSize: 1 },
      }
    )
    if (outcome.state === 'returned') continue
    if (outcome.code !== 'audit.capacity-exhausted')
      throw new Error(`audit near-full probe returned ${outcome.code}`)
    return Object.freeze({
      id: 'audit-near-full',
      passed: true,
      disposition: 'audit-admission-refusal',
      evidenceSha256: canonicalSha256({
        protocolCode: outcome.code,
        callsBeforeRefusal: ordinal - 1,
        boundedCallLimit: input.maximumCalls,
        completionReservePreserved: true,
      }),
    })
  }
  throw new Error('audit near-full probe did not reach its bounded refusal')
}

export async function runSemanticEditBenchmarkWorkflowsV1(input: {
  readonly driver: SemanticEditMcpDriverV1
  readonly fixture: SemanticEditBenchmarkFixtureV1
  readonly inputs: SemanticEditGeneratedInputsV1
  readonly layout: SemanticEditRunLayoutV1
}): Promise<SemanticEditWorkflowExecutionSetV1>
{
  const probes: SemanticEditProbeExecutionV1[] = []
  const behavior = await behaviorWorkflow(
    input.driver,
    input.fixture,
    input.inputs,
    input.layout,
    probes
  )
  const media = await mediaWorkflow(
    input.driver,
    input.fixture,
    input.inputs,
    input.layout
  )
  probes.push(
    ...(await boundaryAndSourceProbes(
      input.driver,
      input.fixture,
      input.inputs,
      input.layout
    ))
  )
  const workflows = Object.freeze([behavior, media])
  return Object.freeze({
    workflows,
    probes: Object.freeze(probes),
    revisionSha256s: Object.freeze(
      workflows.map((workflow) => workflow.revisionSha256)
    ),
    deltaSha256s: Object.freeze(
      workflows.map((workflow) => workflow.deltaSha256)
    ),
    preservationSha256s: Object.freeze(
      workflows.map((workflow) => workflow.preservationSha256)
    ),
    lineageSha256s: Object.freeze(
      workflows.map((workflow) => workflow.lineageSha256)
    ),
    certificateSha256s: Object.freeze(
      workflows.map((workflow) => workflow.certificateSha256)
    ),
    reportSha256s: Object.freeze(
      workflows.map((workflow) => workflow.reportSha256)
    ),
  })
}
