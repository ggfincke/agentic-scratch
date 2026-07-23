// packages/eval/src/artifacts/artifact-preflight.ts
// classify exact artifact baselines & candidate diagnostic regressions

import { createHash } from 'node:crypto'

import { ProjectIR } from '@scratch-agent/ir'
import {
  blockKey,
  buildSemanticReferenceIndex,
  nonAuthorableProcedureBlockKeysV1,
  parseKnownProcedureMutations,
  semanticHashV1,
  type BroadcastUse,
  type DeclarationUse,
  type EditSemanticSourceIdentityHashProjectionV1,
  type KnownProcedureMutationRecord,
  type ProcedureMutationAdmission,
  type SemanticReferenceIndex,
  type SpriteReference,
} from '@scratch-agent/ir/edit'
import type { RunIssue } from '@scratch-agent/runner'
import {
  EDIT_ADMISSION_STAGES,
  admitSb3ForEdit,
  isEditSb3Admission,
  isSb3AdmissionError,
  unpackSb3,
  validateAdmittedSb3,
  validateSb3,
  type EditAdmissionStage,
  type EditSb3Admission,
  type ProjectJson,
} from '@scratch-agent/sb3'
import { analyzeStatic } from '@scratch-agent/static'
import {
  validateProject,
  type Diagnostic,
  type Severity,
} from '@scratch-agent/validate'

import {
  normalizeDiagnosticFailure,
  stableFingerprint,
  type DiagnosticFailure,
  type NormalizedFailure,
  type SchemaFailure,
} from '../core/failures.js'
import type {
  DiagnosticRegressionOptions,
  DiagnosticThreshold,
} from '../core/options.js'
import { sha256 } from '../core/sha256.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

interface DiagnosticFingerprintCount
{
  fingerprint: string
  count: number
}

export interface DiagnosticBaseline
{
  graph: DiagnosticFingerprintCount[]
  static: DiagnosticFingerprintCount[]
}

export interface ArtifactPreflight
{
  ok: boolean
  project: ProjectIR | null
  schema: SchemaFailure[]
  graph: DiagnosticFailure[]
  static: DiagnosticFailure[]
  diagnosticBaseline: DiagnosticBaseline | null
  diagnosticChanges: DiagnosticChanges
  failures: NormalizedFailure[]
  issues: RunIssue[]
}

type SemanticEditPreflightStage =
  | Exclude<(typeof EDIT_ADMISSION_STAGES)[number], 'complete'>
  | 'procedure-mutations'
  | 'scratch-schema'
  | 'ir-construction'
  | 'reference-index'
  | 'graph-static'
  | 'complete'

interface SemanticEditPreflightStageEvent
{
  stage: SemanticEditPreflightStage
  status: 'started' | 'completed'
  sequence: number
}

interface SemanticEditArtifactRefusal
{
  stage: SemanticEditPreflightStage
  code: string
  message: string
}

export interface SemanticEditArtifactPreflight
{
  ok: boolean
  admission: EditSb3Admission | null
  procedureMutations: ProcedureMutationAdmission | null
  project: ProjectIR | null
  referenceIndex: SemanticReferenceIndex | null
  semanticSourceIdentity: EditSemanticSourceIdentityHashProjectionV1 | null
  semanticSourceSha256: string | null
  graph: DiagnosticFailure[]
  static: DiagnosticFailure[]
  refusal: SemanticEditArtifactRefusal | null
  completedStages: readonly SemanticEditPreflightStage[]
}

interface SemanticEditArtifactPreflightOptions
{
  onStage?: (event: SemanticEditPreflightStageEvent) => void
}

interface DiagnosticChanges
{
  newGraph: DiagnosticFailure[]
  newStatic: DiagnosticFailure[]
  allowedGraph: DiagnosticFailure[]
  allowedStatic: DiagnosticFailure[]
  rejectedGraph: DiagnosticFailure[]
  rejectedStatic: DiagnosticFailure[]
}

export const NO_DIAGNOSTIC_CHANGES: DiagnosticChanges = {
  newGraph: [],
  newStatic: [],
  allowedGraph: [],
  allowedStatic: [],
  rejectedGraph: [],
  rejectedStatic: [],
}

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
}

function schemaFailure(
  category: SchemaFailure['category'],
  message: string,
  producerCode?: string
): SchemaFailure
{
  return {
    kind: 'schema',
    fingerprint: stableFingerprint('schema', { category, producerCode }),
    category,
    message,
    ...(producerCode ? { producerCode } : {}),
  }
}

function preflightInfrastructureIssue(error: unknown): RunIssue
{
  return {
    code: 'eval.preflight.internal-failed',
    kind: 'internal',
    responsibility: 'infrastructure',
    message: unknownErrorMessage(error),
  }
}

function countFingerprints(
  failures: DiagnosticFailure[]
): DiagnosticFingerprintCount[]
{
  const counts = new Map<string, number>()
  for (const failure of failures)
  {
    counts.set(failure.fingerprint, (counts.get(failure.fingerprint) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([fingerprint, count]) => ({ fingerprint, count }))
    .sort((a, b) =>
      a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0
    )
}

function captureDiagnostics(
  project: ProjectIR,
  graph: Diagnostic[],
  statics: Diagnostic[]
): {
  graph: DiagnosticFailure[]
  static: DiagnosticFailure[]
  baseline: DiagnosticBaseline
}
{
  const normalizedGraph = graph.map((diagnostic) =>
    normalizeDiagnosticFailure(project, 'graph', diagnostic)
  )
  const normalizedStatic = statics.map((diagnostic) =>
    normalizeDiagnosticFailure(project, 'static', diagnostic)
  )
  return {
    graph: normalizedGraph,
    static: normalizedStatic,
    baseline: {
      graph: countFingerprints(normalizedGraph),
      static: countFingerprints(normalizedStatic),
    },
  }
}

function sha256Parts(parts: readonly Uint8Array[]): string
{
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

function utf8(value: string): Uint8Array
{
  return new TextEncoder().encode(value)
}

function uint64(value: number): Uint8Array
{
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false)
  return bytes
}

function assetManifestSha256(admission: EditSb3Admission): string
{
  const parts: Uint8Array[] = [utf8('scratch-edit-asset-manifest-v1\0')]
  for (const asset of [...admission.assets].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ))
  {
    const path = utf8(asset.path)
    parts.push(uint64(path.byteLength), path, uint64(asset.bytes.byteLength))
    parts.push(utf8(sha256(asset.bytes)))
  }
  return sha256Parts(parts)
}

function semanticSourceIdentity(
  artifactBytes: Uint8Array,
  admission: EditSb3Admission
): {
  projection: EditSemanticSourceIdentityHashProjectionV1
  sha256: string
}
{
  const serializedTargets = JSON.stringify(admission.project.targets)
  const admissionProfile = JSON.stringify({
    schemaVersion: 1,
    archiveLimits: admission.archive.limits,
    editLimits: admission.limits,
  })
  const projection: EditSemanticSourceIdentityHashProjectionV1 = {
    schemaVersion: 1,
    admissionSchemaVersion: 1,
    semanticSourceSchemaVersion: 1,
    sourceKind: 'admittedProjectBytes',
    sourceArtifactSha256: admission.archive.metrics.sha256,
    archiveByteLength: artifactBytes.byteLength,
    projectJsonSha256: admission.archive.metrics.projectJsonSha256,
    assetManifestSha256: assetManifestSha256(admission),
    serializedTargetCollectionSha256: sha256Parts([utf8(serializedTargets)]),
    // the conservative V1 projection binds every raw JSON field, including all
    // unknown content, without normalizing legacy source strings.
    protectedUnknownContentSha256: admission.archive.metrics.projectJsonSha256,
    admissionProfileSha256: sha256Parts([utf8(admissionProfile)]),
  }
  return { projection, sha256: semanticHashV1('semantic-source', projection) }
}

function refusalCode(error: unknown): string
{
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  )
  {
    return error.code
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'detailCode' in error &&
    typeof error.detailCode === 'string'
  )
  {
    return error.detailCode
  }
  return 'edit.preflight-refused'
}

class SemanticEditSourceIntegrityError extends Error
{
  readonly code = 'EDIT_SOURCE_INTEGRITY_INVALID'

  constructor(message: string)
  {
    super(message)
    this.name = 'SemanticEditSourceIntegrityError'
  }
}

function procedureKey(record: KnownProcedureMutationRecord): string
{
  return JSON.stringify([record.targetIndex, record.proccode])
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean
{
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function assertProcedureMutationCorrespondence(
  admission: ProcedureMutationAdmission
): void
{
  const prototypes = new Map<string, KnownProcedureMutationRecord>()
  for (const record of admission.records)
  {
    if (record.role !== 'prototype') continue
    const key = procedureKey(record)
    const existing = prototypes.get(key)
    if (existing && !sameStrings(existing.argumentIds, record.argumentIds))
    {
      throw new SemanticEditSourceIntegrityError(
        `procedure ${JSON.stringify(record.proccode)} has conflicting prototype argument IDs in target ${record.targetIndex}`
      )
    }
    prototypes.set(key, existing ?? record)
  }
  for (const record of admission.records)
  {
    if (record.role !== 'call') continue
    const prototype = prototypes.get(procedureKey(record))
    if (!prototype)
    {
      throw new SemanticEditSourceIntegrityError(
        `procedure call ${JSON.stringify(record.proccode)} has no prototype in target ${record.targetIndex}`
      )
    }
    if (!sameStrings(prototype.argumentIds, record.argumentIds))
    {
      throw new SemanticEditSourceIntegrityError(
        `procedure call ${JSON.stringify(record.proccode)} argument IDs do not match its prototype in target ${record.targetIndex}`
      )
    }
  }
}

function declarationUsePath(use: DeclarationUse): string
{
  return `/targets/${use.block.target.targetIndex}/blocks/${use.block.blockId}`
}

function broadcastUsePath(use: BroadcastUse): string
{
  return `/targets/${use.block.target.targetIndex}/blocks/${use.block.blockId}`
}

const SPRITE_REFERENCE_PARENT_OPCODES = {
  'attribute-of': ['sensing_of'],
  clone: ['control_create_clone_of'],
  'distance-to': ['sensing_distanceto'],
  'go-to': ['motion_goto', 'motion_glideto'],
  'point-towards': ['motion_pointtowards'],
  touching: ['sensing_touchingobject', 'event_whentouchingobject'],
} as const satisfies Record<SpriteReference['kind'], readonly string[]>

function invalidSpriteReference(
  reference: SpriteReference,
  index: SemanticReferenceIndex
): boolean
{
  if (
    reference.sourceStatus !== 'verified-parent' ||
    reference.sourceBlock === null
  )
  {
    return true
  }
  const parent = index.blockByKey.get(blockKey(reference.sourceBlock))
  if (
    !parent ||
    !SPRITE_REFERENCE_PARENT_OPCODES[reference.kind].some(
      (opcode) => opcode === parent.opcode
    )
  )
  {
    return true
  }
  const inputChildren = parent.inputChildren.filter(
    (child) => child.inputName === reference.fieldName
  )
  const menuLinks = inputChildren.filter(
    (child) => blockKey(child.block) === blockKey(reference.block)
  )
  if (menuLinks.length === 0) return true
  const hasOtherPrimary = inputChildren.some(
    (child) =>
      child.slot === 'primary' &&
      blockKey(child.block) !== blockKey(reference.block)
  )
  const activeStaticReference =
    menuLinks.some((child) => child.slot === 'primary') || !hasOtherPrimary
  return (
    activeStaticReference &&
    !reference.special &&
    reference.targetStatus !== 'unique'
  )
}

function assertReferenceIndexIntegrity(index: SemanticReferenceIndex): void
{
  const indexedUses = [...index.variables, ...index.lists].flatMap(
    (declaration) => declaration.references
  )
  const uses = [...index.unresolvedDeclarationUses, ...indexedUses]
  const invalidUse = uses.find(
    (use) =>
      use.declaration === null ||
      use.resolutionStatus !== 'resolved-id' ||
      use.displayNameMismatch
  )
  if (invalidUse)
  {
    throw new SemanticEditSourceIntegrityError(
      `${invalidUse.referencedKind} reference ${JSON.stringify(invalidUse.referencedId)} at ${declarationUsePath(invalidUse)} is not an exact ID and display-name match`
    )
  }
  const indexedBroadcastUses = index.broadcasts.flatMap((broadcast) => [
    ...broadcast.senders,
    ...broadcast.receivers,
  ])
  const broadcastUses = [
    ...index.unresolvedBroadcastUses,
    ...indexedBroadcastUses,
  ]
  const invalidBroadcastUse = broadcastUses.find(
    (use) =>
      !use.dynamic &&
      (use.declaration === null ||
        use.resolutionStatus !== 'resolved' ||
        use.resolutionSource !== 'id' ||
        use.idNameMismatch ||
        use.normalizedName !== null ||
        use.referencedName !== use.declaration.name)
  )
  if (invalidBroadcastUse)
  {
    throw new SemanticEditSourceIntegrityError(
      `broadcast reference ${JSON.stringify(invalidBroadcastUse.referencedId)} at ${broadcastUsePath(invalidBroadcastUse)} is not an exact ID and display-name match`
    )
  }
  const invalidTargetReference = index.spriteReferences.find((reference) =>
    invalidSpriteReference(reference, index)
  )
  if (invalidTargetReference)
  {
    throw new SemanticEditSourceIntegrityError(
      `target reference ${JSON.stringify(invalidTargetReference.name)} at /targets/${invalidTargetReference.block.target.targetIndex}/blocks/${invalidTargetReference.block.blockId} is not an exact static target binding`
    )
  }
  const nonAuthorableProcedureBlockKeys =
    nonAuthorableProcedureBlockKeysV1(index)
  const ambiguousOwnership = index.blocks.find(
    (block) =>
      block.ownershipStatus === 'ambiguous' &&
      !nonAuthorableProcedureBlockKeys.has(blockKey(block.ref))
  )
  if (ambiguousOwnership)
  {
    throw new SemanticEditSourceIntegrityError(
      `block ${JSON.stringify(ambiguousOwnership.ref.blockId)} in target ${ambiguousOwnership.ref.target.targetIndex} is reachable from multiple top-level scripts`
    )
  }
  for (const monitor of index.monitors)
  {
    if (monitor.targetStatus !== 'unique' || monitor.target === null)
    {
      throw new SemanticEditSourceIntegrityError(
        `monitor ${JSON.stringify(monitor.ref.monitorId)} does not have one exact target`
      )
    }
    if (monitor.declarationKind === null)
    {
      if (
        monitor.parameterKeys.includes('VARIABLE') ||
        monitor.parameterKeys.includes('LIST')
      )
      {
        throw new SemanticEditSourceIntegrityError(
          `monitor ${JSON.stringify(monitor.ref.monitorId)} has declaration params for a non-declaration opcode`
        )
      }
      continue
    }
    const expectedParameter =
      monitor.declarationKind === 'variable' ? 'VARIABLE' : 'LIST'
    if (
      monitor.parameterKeys.length !== 1 ||
      monitor.parameterKeys[0] !== expectedParameter ||
      monitor.declarationStatus !== 'unique' ||
      monitor.declaration === null ||
      monitor.declaration.kind !== monitor.declarationKind ||
      (monitor.resolutionSource !== 'local-id' &&
        monitor.resolutionSource !== 'stage-id') ||
      monitor.displayNameMismatch ||
      monitor.referencedName !== monitor.declaration.name
    )
    {
      throw new SemanticEditSourceIntegrityError(
        `monitor ${JSON.stringify(monitor.ref.monitorId)} is not an exact ${monitor.declarationKind} ID, name, opcode, and params binding`
      )
    }
  }
  if (index.unresolvedProcedureBlocks.length > 0)
  {
    const block = index.unresolvedProcedureBlocks[0]!
    throw new SemanticEditSourceIntegrityError(
      `procedure block ${JSON.stringify(block.blockId)} in target ${block.target.targetIndex} does not resolve`
    )
  }
  const procedureIssue = index.procedures.find(
    (procedure) => procedure.mutationIssues.length > 0
  )?.mutationIssues[0]
  if (procedureIssue)
  {
    throw new SemanticEditSourceIntegrityError(
      `procedure block ${JSON.stringify(procedureIssue.block.blockId)}: ${procedureIssue.message}`
    )
  }
  // legacy procedure topologies remain admissible but opaque; only unresolved
  // procedure families are rejected before semantic handles are exposed
  for (const procedure of index.procedures)
  {
    if (
      procedure.definitions.length === 0 ||
      procedure.prototypes.length === 0
    )
    {
      throw new SemanticEditSourceIntegrityError(
        `procedure ${JSON.stringify(procedure.proccode)} in target ${procedure.target.targetIndex} requires a definition and prototype`
      )
    }
  }
}

const EDIT_LOADER_RECONCILIATION_DIAGNOSTIC_CODES = new Set([
  'broadcast-name-mismatch',
  'current-costume-range',
  'missing-broadcast',
  'missing-list',
  'missing-variable',
])

const EDIT_BLOCKING_GRAPH_DIAGNOSTIC_CODES = new Set([
  'monitor-missing-data',
  'monitor-missing-sprite',
  'multiple-block-owners',
])

export async function inspectSemanticEditArtifact(
  artifactBytes: Uint8Array,
  options: SemanticEditArtifactPreflightOptions = {}
): Promise<SemanticEditArtifactPreflight>
{
  const completed: SemanticEditPreflightStage[] = []
  let sequence = 0
  const emit = (
    stage: SemanticEditPreflightStage,
    status: 'started' | 'completed'
  ): void => options.onStage?.({ stage, status, sequence: sequence++ })
  const run = async <T>(
    stage: SemanticEditPreflightStage,
    operation: () => T | Promise<T>
  ): Promise<T> =>
  {
    emit(stage, 'started')
    const value = await operation()
    completed.push(stage)
    emit(stage, 'completed')
    return value
  }
  const refused = (
    stage: SemanticEditPreflightStage,
    error: unknown,
    state: {
      admission?: EditSb3Admission
      procedureMutations?: ProcedureMutationAdmission
      project?: ProjectIR
      referenceIndex?: SemanticReferenceIndex
      semanticSource?: ReturnType<typeof semanticSourceIdentity>
      graph?: DiagnosticFailure[]
      static?: DiagnosticFailure[]
    } = {}
  ): SemanticEditArtifactPreflight => ({
    ok: false,
    admission: state.admission ?? null,
    procedureMutations: state.procedureMutations ?? null,
    project: state.project ?? null,
    referenceIndex: state.referenceIndex ?? null,
    semanticSourceIdentity: state.semanticSource?.projection ?? null,
    semanticSourceSha256: state.semanticSource?.sha256 ?? null,
    graph: state.graph ?? [],
    static: state.static ?? [],
    refusal: {
      stage,
      code: refusalCode(error),
      message: unknownErrorMessage(error),
    },
    completedStages: [...completed],
  })

  let admission: EditSb3Admission
  let activeAdmissionStage: EditAdmissionStage = 'archive'
  try
  {
    admission = await admitSb3ForEdit(artifactBytes, {
      onStage: (event) =>
      {
        if (event.stage === 'complete') return
        activeAdmissionStage = event.stage
        emit(event.stage, event.status)
        if (event.status === 'completed') completed.push(event.stage)
      },
    })
  }
  catch (error)
  {
    return refused(activeAdmissionStage, error)
  }
  if (!isEditSb3Admission(admission))
  {
    return refused('archive', new Error('edit admission brand is missing'))
  }
  const sourceIdentity = semanticSourceIdentity(artifactBytes, admission)

  let procedureMutations: ProcedureMutationAdmission
  try
  {
    procedureMutations = await run('procedure-mutations', () =>
    {
      const parsed = parseKnownProcedureMutations(
        admission.project,
        admission.limits
      )
      assertProcedureMutationCorrespondence(parsed)
      return parsed
    })
  }
  catch (error)
  {
    return refused('procedure-mutations', error, {
      admission,
      semanticSource: sourceIdentity,
    })
  }

  let schema: Awaited<ReturnType<typeof validateAdmittedSb3>>
  try
  {
    schema = await run('scratch-schema', () =>
      validateAdmittedSb3(artifactBytes)
    )
  }
  catch (error)
  {
    return refused('scratch-schema', error, {
      admission,
      procedureMutations,
      semanticSource: sourceIdentity,
    })
  }
  if (!schema.ok)
  {
    return refused('scratch-schema', new Error(schema.errors.join('; ')), {
      admission,
      procedureMutations,
      semanticSource: sourceIdentity,
    })
  }

  let project: ProjectIR
  try
  {
    project = await run('ir-construction', () =>
      ProjectIR.fromProjectJson(admission.project, admission.assets)
    )
  }
  catch (error)
  {
    return refused('ir-construction', error, {
      admission,
      procedureMutations,
      semanticSource: sourceIdentity,
    })
  }

  let referenceIndex: SemanticReferenceIndex
  try
  {
    referenceIndex = await run('reference-index', () =>
    {
      const index = buildSemanticReferenceIndex(project)
      assertReferenceIndexIntegrity(index)
      return index
    })
  }
  catch (error)
  {
    return refused('reference-index', error, {
      admission,
      procedureMutations,
      project,
      semanticSource: sourceIdentity,
    })
  }

  let diagnostics: ReturnType<typeof captureDiagnostics>
  try
  {
    diagnostics = await run('graph-static', () =>
    {
      const graphResult = validateProject(project)
      const staticResult = analyzeStatic(
        project.toProjectJson(),
        graphResult.index
      )
      return captureDiagnostics(
        project,
        graphResult.diagnostics,
        staticResult.diagnostics
      )
    })
  }
  catch (error)
  {
    return refused('graph-static', error, {
      admission,
      procedureMutations,
      project,
      referenceIndex,
      semanticSource: sourceIdentity,
    })
  }
  const graphErrors = diagnostics.graph.filter(
    (failure) => failure.severity === 'error'
  )
  const loaderReconciliation = diagnostics.graph.find((failure) =>
    EDIT_LOADER_RECONCILIATION_DIAGNOSTIC_CODES.has(failure.code)
  )
  if (loaderReconciliation)
  {
    return refused(
      'graph-static',
      new SemanticEditSourceIntegrityError(
        `graph diagnostic ${loaderReconciliation.code} requires loader reconciliation`
      ),
      {
        admission,
        procedureMutations,
        project,
        referenceIndex,
        semanticSource: sourceIdentity,
        graph: diagnostics.graph,
        static: diagnostics.static,
      }
    )
  }
  const editBlockingGraphDiagnostic = diagnostics.graph.find((failure) =>
    EDIT_BLOCKING_GRAPH_DIAGNOSTIC_CODES.has(failure.code)
  )
  if (editBlockingGraphDiagnostic)
  {
    return refused(
      'graph-static',
      new SemanticEditSourceIntegrityError(
        `graph diagnostic ${editBlockingGraphDiagnostic.code} is edit-blocking`
      ),
      {
        admission,
        procedureMutations,
        project,
        referenceIndex,
        semanticSource: sourceIdentity,
        graph: diagnostics.graph,
        static: diagnostics.static,
      }
    )
  }
  if (graphErrors.length > 0)
  {
    return refused(
      'graph-static',
      new Error('graph validation produced edit-blocking diagnostics'),
      {
        admission,
        procedureMutations,
        project,
        referenceIndex,
        semanticSource: sourceIdentity,
        graph: diagnostics.graph,
        static: diagnostics.static,
      }
    )
  }
  await run('complete', () => undefined)
  return {
    ok: true,
    admission,
    procedureMutations,
    project,
    referenceIndex,
    semanticSourceIdentity: sourceIdentity.projection,
    semanticSourceSha256: sourceIdentity.sha256,
    graph: diagnostics.graph,
    static: diagnostics.static,
    refusal: null,
    completedStages: [...completed],
  }
}

export async function inspectBaselineArtifact(
  artifactBytes: Uint8Array
): Promise<ArtifactPreflight>
{
  let project: ProjectIR
  try
  {
    const unpacked = await unpackSb3(artifactBytes)
    let json: ProjectJson
    try
    {
      json = JSON.parse(unpacked.projectJsonText) as ProjectJson
    }
    catch (error)
    {
      const failure = schemaFailure(
        'project-json-invalid',
        unknownErrorMessage(error)
      )
      return failedPreflight(failure)
    }
    try
    {
      project = ProjectIR.fromProjectJson(json, unpacked.assets)
    }
    catch (error)
    {
      const failure = schemaFailure(
        'ir-construction-failed',
        unknownErrorMessage(error)
      )
      return failedPreflight(failure)
    }
  }
  catch (error)
  {
    const failure = schemaFailure(
      'artifact-load-failed',
      unknownErrorMessage(error),
      isSb3AdmissionError(error) ? error.code : undefined
    )
    return failedPreflight(failure)
  }

  let schema: Awaited<ReturnType<typeof validateSb3>>
  try
  {
    schema = await validateSb3(artifactBytes)
  }
  catch (error)
  {
    return {
      ok: false,
      project,
      schema: [],
      graph: [],
      static: [],
      diagnosticBaseline: null,
      diagnosticChanges: NO_DIAGNOSTIC_CHANGES,
      failures: [],
      issues: [preflightInfrastructureIssue(error)],
    }
  }
  if (!schema.ok)
  {
    const category =
      schema.projectVersion === 0
        ? 'scratch-parser-rejected'
        : 'unsupported-project-version'
    const failures = schema.errors.map((error) =>
      schemaFailure(category, error)
    )
    return {
      ok: false,
      project: null,
      schema: failures,
      graph: [],
      static: [],
      diagnosticBaseline: null,
      diagnosticChanges: NO_DIAGNOSTIC_CHANGES,
      failures,
      issues: [],
    }
  }

  let graphResult: ReturnType<typeof validateProject>
  let staticResult: ReturnType<typeof analyzeStatic>
  try
  {
    graphResult = validateProject(project)
    staticResult = analyzeStatic(project.toProjectJson(), graphResult.index)
  }
  catch (error)
  {
    return {
      ok: false,
      project,
      schema: [],
      graph: [],
      static: [],
      diagnosticBaseline: null,
      diagnosticChanges: NO_DIAGNOSTIC_CHANGES,
      failures: [],
      issues: [preflightInfrastructureIssue(error)],
    }
  }
  const diagnostics = captureDiagnostics(
    project,
    graphResult.diagnostics,
    staticResult.diagnostics
  )
  const graphErrors = diagnostics.graph.filter(
    (failure) => failure.severity === 'error'
  )
  return {
    ok: graphErrors.length === 0,
    project,
    schema: [],
    graph: diagnostics.graph,
    static: diagnostics.static,
    diagnosticBaseline: diagnostics.baseline,
    diagnosticChanges: NO_DIAGNOSTIC_CHANGES,
    failures: graphErrors,
    issues: [],
  }
}

function failedPreflight(failure: SchemaFailure): ArtifactPreflight
{
  return {
    ok: false,
    project: null,
    schema: [failure],
    graph: [],
    static: [],
    diagnosticBaseline: null,
    diagnosticChanges: NO_DIAGNOSTIC_CHANGES,
    failures: [failure],
    issues: [],
  }
}

function baselineCounts(
  entries: DiagnosticFingerprintCount[]
): Map<string, number>
{
  return new Map(entries.map((entry) => [entry.fingerprint, entry.count]))
}

function atOrAbove(
  severity: Severity,
  threshold: DiagnosticThreshold
): boolean
{
  return (
    threshold !== 'never' && SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold]
  )
}

function diagnosticAdditions(
  candidates: DiagnosticFailure[],
  baseline: DiagnosticFingerprintCount[]
): DiagnosticFailure[]
{
  const counts = baselineCounts(baseline)
  const grouped = new Map<string, DiagnosticFailure[]>()
  for (const failure of candidates)
  {
    const bucket = grouped.get(failure.fingerprint) ?? []
    bucket.push(failure)
    grouped.set(failure.fingerprint, bucket)
  }
  const rejected: DiagnosticFailure[] = []
  for (const fingerprint of [...grouped.keys()].sort())
  {
    const bucket = grouped.get(fingerprint)!
    const ordered = bucket.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
    )
    const addedCount = Math.max(
      0,
      bucket.length - (counts.get(fingerprint) ?? 0)
    )
    rejected.push(...ordered.slice(0, addedCount))
  }
  return rejected
}

export async function preflightCandidateArtifact(
  artifactBytes: Uint8Array,
  baseline: DiagnosticBaseline,
  options: DiagnosticRegressionOptions
): Promise<ArtifactPreflight>
{
  const inspected = await inspectBaselineArtifact(artifactBytes)
  if (
    !inspected.project ||
    inspected.schema.length > 0 ||
    inspected.issues.length > 0
  )
  {
    return inspected
  }

  const graphErrors = inspected.graph.filter(
    (failure) => failure.severity === 'error'
  )
  const newGraph = diagnosticAdditions(inspected.graph, baseline.graph)
  const newStatic = diagnosticAdditions(inspected.static, baseline.static)
  const graphEligible = newGraph.filter(
    (failure) =>
      failure.severity !== 'error' &&
      atOrAbove(failure.severity, options.rejectNewGraphAtOrAbove)
  )
  const staticEligible = newStatic.filter((failure) =>
    atOrAbove(failure.severity, options.rejectNewStaticAtOrAbove)
  )
  const graphRegressions = graphEligible.filter(
    (failure) => !options.allowedNewGraphCodes.includes(failure.code)
  )
  const staticRegressions = staticEligible.filter(
    (failure) => !options.allowedNewStaticCodes.includes(failure.code)
  )
  const allowedGraph = newGraph.filter(
    (failure) =>
      !graphErrors.includes(failure) && !graphRegressions.includes(failure)
  )
  const allowedStatic = newStatic.filter(
    (failure) => !staticRegressions.includes(failure)
  )
  const failures = [...graphErrors, ...graphRegressions, ...staticRegressions]
  return {
    ...inspected,
    ok: failures.length === 0,
    diagnosticChanges: {
      newGraph,
      newStatic,
      allowedGraph,
      allowedStatic,
      rejectedGraph: [...graphErrors, ...graphRegressions],
      rejectedStatic: staticRegressions,
    },
    failures,
  }
}
