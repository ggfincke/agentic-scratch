// packages/eval/src/project-check/project-inspection.ts
// build immutable, transport-neutral indexes for bounded project inspection

import { ProjectIR } from '@scratch-agent/ir'
import {
  admitSb3,
  isSb3AdmissionError,
  scratchRecordEntries,
  scratchRecordValue,
  validateAdmittedSb3,
  type Sb3AdmissionMetrics,
  type Sb3Limits,
  type ProjectJson,
} from '@scratch-agent/sb3'
import type {
  Block,
  BlockEntry,
  BlockInput,
  ScalarVal,
  Target,
} from '@scratch-agent/sb3'
import { analyzeStatic, type StaticMetrics } from '@scratch-agent/static'
import {
  countBySeverity,
  validateProject,
  type Diagnostic,
  type DiagnosticCounts,
  type Severity,
} from '@scratch-agent/validate'

import {
  PROJECT_CHECK_ISSUE_CODES,
  type ProjectCheckIssue,
  type ProjectCheckStageStatus,
} from './project-check-contract.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

interface ProjectTargetInspection
{
  targetIndex: number
  name: string
  isStage: boolean
  blockCount: number
  scriptCount: number
  costumeCount: number
  soundCount: number
  variableCount: number
  listCount: number
  broadcastCount: number
  commentCount: number
}

interface ProjectScriptInspection
{
  targetIndex: number
  scriptIndex: number
  rootBlockId: string
  opcode: string
  x: number | null
  y: number | null
  blockCount: number
}

interface ProjectBlockInspection
{
  targetIndex: number
  scriptIndex: number | null
  orderInScript: number | null
  blockId: string
  opcode: string | null
  next: string | null
  parent: string | null
  topLevel: boolean
  shadow: boolean
  fields: Record<string, unknown>
  inputs: Record<string, unknown>
  mutation: Record<string, unknown> | null
  primitive: unknown[] | null
}

interface ProjectDeclarationInspection
{
  targetIndex: number
  kind: 'variable' | 'list' | 'broadcast'
  id: string
  name: string
  value: ScalarVal | null
  itemCount: number | null
  itemSample: ScalarVal[] | null
  cloud: boolean
}

interface ProjectDiagnosticInspection
{
  source: 'schema' | 'graph' | 'static'
  severity: Severity
  code: string
  message: string
  location: Diagnostic['location']
}

export interface ProjectInspectionCatalog
{
  targets: ProjectTargetInspection[]
  scripts: ProjectScriptInspection[]
  blocks: ProjectBlockInspection[]
  declarations: ProjectDeclarationInspection[]
  diagnostics: ProjectDiagnosticInspection[]
}

export interface SelectedProjectInspection
{
  input: {
    sha256: string | null
    byteLength: number
  }
  stages: {
    admission: ProjectCheckStageStatus
    schema: ProjectCheckStageStatus
    graph: ProjectCheckStageStatus
    static: ProjectCheckStageStatus
  }
  admission: {
    metrics: Sb3AdmissionMetrics | Partial<Sb3AdmissionMetrics>
    limits: Sb3Limits
  } | null
  schema: {
    projectVersion: number
    errors: string[]
  } | null
  graph: {
    counts: DiagnosticCounts
    diagnostics: Diagnostic[]
  } | null
  static: {
    counts: DiagnosticCounts
    diagnostics: Diagnostic[]
  } | null
  metrics: StaticMetrics | null
  catalog: ProjectInspectionCatalog
  canRun: boolean
  issues: ProjectCheckIssue[]
  summary: {
    text: string
    truncated: boolean
    untrustedProjectData: true
  }
}

function emptyCatalog(): ProjectInspectionCatalog
{
  return {
    targets: [],
    scripts: [],
    blocks: [],
    declarations: [],
    diagnostics: [],
  }
}

function inspectionIssue(
  code: ProjectCheckIssue['code'],
  message: string,
  producerCode?: string
): ProjectCheckIssue
{
  return {
    code,
    message: boundedText(message, 1000).text,
    ...(producerCode ? { producerCode } : {}),
  }
}

function boundedText(
  value: string,
  maxBytes: number
): { text: string; truncated: boolean }
{
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes)
  {
    return { text: value, truncated: false }
  }
  let text = ''
  let bytes = 0
  for (const character of value)
  {
    const size = Buffer.byteLength(character, 'utf-8')
    if (bytes + size + 3 > maxBytes) break
    text += character
    bytes += size
  }
  return { text: `${text}...`, truncated: true }
}

function inspectionSummary(
  metrics: StaticMetrics | null,
  catalog: ProjectInspectionCatalog
): SelectedProjectInspection['summary']
{
  if (!metrics)
  {
    return {
      text: 'Project structure is unavailable because intake did not complete.',
      truncated: false,
      untrustedProjectData: true,
    }
  }
  let namesTruncated = false
  const names = catalog.targets.slice(0, 12).map((target) =>
  {
    const projected = boundedText(target.name, 256)
    namesTruncated ||= projected.truncated
    return JSON.stringify(projected.text)
  })
  const omitted = catalog.targets.length - names.length
  const projected = boundedText(
    [
      `${metrics.targets} targets (${metrics.sprites} sprites), ${metrics.blocks} blocks in ${metrics.scripts} scripts.`,
      `${metrics.costumes} costumes, ${metrics.sounds} sounds, ${metrics.variables} variables, ${metrics.lists} lists, ${metrics.broadcasts} broadcasts.`,
      `Target names are untrusted project data: ${names.join(', ')}${omitted > 0 ? `, plus ${omitted} more` : ''}`,
    ].join('\n'),
    4 * 1024
  )
  return {
    text: projected.text,
    truncated: namesTruncated || omitted > 0 || projected.truncated,
    untrustedProjectData: true,
  }
}

export async function inspectSelectedProject(
  bytes: Uint8Array
): Promise<SelectedProjectInspection>
{
  const result: SelectedProjectInspection = {
    input: { sha256: null, byteLength: bytes.byteLength },
    stages: {
      admission: 'not-run',
      schema: 'not-run',
      graph: 'not-run',
      static: 'not-run',
    },
    admission: null,
    schema: null,
    graph: null,
    static: null,
    metrics: null,
    catalog: emptyCatalog(),
    canRun: false,
    issues: [],
    summary: inspectionSummary(null, emptyCatalog()),
  }
  let admission
  try
  {
    admission = await admitSb3(bytes)
    result.input.sha256 = admission.metrics.sha256
    result.admission = {
      metrics: structuredClone(admission.metrics),
      limits: { ...admission.limits },
    }
    result.stages.admission = 'passed'
  }
  catch (error)
  {
    result.stages.admission = 'failed'
    result.issues.push(
      inspectionIssue(
        PROJECT_CHECK_ISSUE_CODES.admissionFailed,
        unknownErrorMessage(error),
        isSb3AdmissionError(error) ? error.code : undefined
      )
    )
    if (isSb3AdmissionError(error))
    {
      result.input.sha256 = error.metrics.sha256 ?? null
      result.admission = {
        metrics: structuredClone(error.metrics),
        limits: { ...error.limits },
      }
    }
    return result
  }

  let json: ProjectJson
  try
  {
    json = JSON.parse(admission.projectJsonText) as ProjectJson
  }
  catch (error)
  {
    result.stages.schema = 'failed'
    result.issues.push(
      inspectionIssue(
        PROJECT_CHECK_ISSUE_CODES.projectJsonInvalid,
        unknownErrorMessage(error)
      )
    )
    return result
  }

  const schema = await validateAdmittedSb3(bytes)
  result.schema = {
    projectVersion: schema.projectVersion,
    errors: schema.errors.map((message) => message.slice(0, 1000)),
  }
  result.stages.schema = schema.ok ? 'passed' : 'failed'
  if (!schema.ok)
  {
    result.issues.push(
      inspectionIssue(
        PROJECT_CHECK_ISSUE_CODES.schemaFailed,
        schema.errors[0] ?? 'Scratch schema validation failed'
      )
    )
    return result
  }

  const project = ProjectIR.fromProjectJson(json, admission.assets)
  const graph = validateProject(project)
  result.graph = {
    counts: structuredClone(graph.counts),
    diagnostics: structuredClone(graph.diagnostics),
  }
  result.stages.graph = graph.counts.error === 0 ? 'passed' : 'failed'
  if (graph.counts.error > 0)
  {
    result.issues.push(
      inspectionIssue(
        PROJECT_CHECK_ISSUE_CODES.graphFailed,
        `graph validation found ${graph.counts.error} errors`
      )
    )
  }

  const statics = analyzeStatic(project.toProjectJson(), graph.index)
  const staticCounts = countBySeverity(statics.diagnostics)
  result.static = {
    counts: staticCounts,
    diagnostics: structuredClone(statics.diagnostics),
  }
  result.stages.static = 'passed'
  result.metrics = structuredClone(statics.metrics)
  result.catalog = buildProjectInspectionCatalog(project.toProjectJson(), {
    schema: schema.errors,
    graph: graph.diagnostics,
    static: statics.diagnostics,
  })
  result.canRun = schema.ok && graph.counts.error === 0
  result.summary = inspectionSummary(result.metrics, result.catalog)
  return result
}

function asBlock(entry: BlockEntry | undefined): Block | null
{
  return entry && !Array.isArray(entry) ? entry : null
}

function rootsOf(target: Target): Array<[string, Block]>
{
  return scratchRecordEntries(target.blocks)
    .flatMap(([id, entry]) =>
    {
      const block = asBlock(entry)
      return block?.topLevel === true && block.shadow !== true
        ? ([[id, block]] as Array<[string, Block]>)
        : []
    })
    .sort((a, b) =>
    {
      const ay = a[1].y ?? Number.MAX_SAFE_INTEGER
      const by = b[1].y ?? Number.MAX_SAFE_INTEGER
      const ax = a[1].x ?? Number.MAX_SAFE_INTEGER
      const bx = b[1].x ?? Number.MAX_SAFE_INTEGER
      return ay - by || ax - bx || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    })
}

function inputBlockIds(input: BlockInput): string[]
{
  return input
    .slice(1)
    .filter((slot): slot is string => typeof slot === 'string')
}

function scriptBlockIds(target: Target, rootId: string): string[]
{
  const result: string[] = []
  const visited = new Set<string>()
  const pending: Array<string | null | undefined> = [rootId]
  while (pending.length)
  {
    const id = pending.pop()
    if (!id || visited.has(id)) continue
    const block = asBlock(scratchRecordValue(target.blocks, id))
    if (!block) continue
    visited.add(id)
    result.push(id)
    pending.push(block.next)
    const inputIds = scratchRecordEntries(block.inputs).flatMap(([, input]) =>
      inputBlockIds(input)
    )
    for (let index = inputIds.length - 1; index >= 0; index--)
    {
      pending.push(inputIds[index])
    }
  }
  return result
}

function blockInspection(
  targetIndex: number,
  blockId: string,
  entry: BlockEntry,
  scriptIndex: number | null,
  orderInScript: number | null
): ProjectBlockInspection
{
  if (Array.isArray(entry))
  {
    return {
      targetIndex,
      scriptIndex,
      orderInScript,
      blockId,
      opcode: null,
      next: null,
      parent: null,
      topLevel: true,
      shadow: false,
      fields: {},
      inputs: {},
      mutation: null,
      primitive: structuredClone(entry),
    }
  }
  return {
    targetIndex,
    scriptIndex,
    orderInScript,
    blockId,
    opcode: entry.opcode,
    next: entry.next ?? null,
    parent: entry.parent ?? null,
    topLevel: entry.topLevel === true,
    shadow: entry.shadow === true,
    fields: structuredClone(entry.fields ?? {}),
    inputs: structuredClone(entry.inputs ?? {}),
    mutation: entry.mutation
      ? (structuredClone(entry.mutation) as unknown as Record<string, unknown>)
      : null,
    primitive: null,
  }
}

function declarationsOf(
  target: Target,
  targetIndex: number
): ProjectDeclarationInspection[]
{
  const declarations: ProjectDeclarationInspection[] = []
  for (const [id, entry] of scratchRecordEntries(target.variables))
  {
    declarations.push({
      targetIndex,
      kind: 'variable',
      id,
      name: entry[0],
      value: entry[1],
      itemCount: null,
      itemSample: null,
      cloud: entry[2] === true,
    })
  }
  for (const [id, entry] of scratchRecordEntries(target.lists))
  {
    declarations.push({
      targetIndex,
      kind: 'list',
      id,
      name: entry[0],
      value: null,
      itemCount: entry[1].length,
      itemSample: structuredClone(entry[1].slice(0, 20)),
      cloud: false,
    })
  }
  for (const [id, name] of scratchRecordEntries(target.broadcasts))
  {
    declarations.push({
      targetIndex,
      kind: 'broadcast',
      id,
      name,
      value: null,
      itemCount: null,
      itemSample: null,
      cloud: false,
    })
  }
  return declarations.sort(
    (a, b) =>
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export function buildProjectInspectionCatalog(
  project: ProjectJson,
  diagnostics: {
    schema: string[]
    graph: Diagnostic[]
    static: Diagnostic[]
  }
): ProjectInspectionCatalog
{
  const targets: ProjectTargetInspection[] = []
  const scripts: ProjectScriptInspection[] = []
  const blocks: ProjectBlockInspection[] = []
  const declarations: ProjectDeclarationInspection[] = []

  for (const [targetIndex, target] of project.targets.entries())
  {
    const roots = rootsOf(target)
    const scriptMembership = new Map<
      string,
      { scriptIndex: number; order: number }
    >()
    for (const [scriptIndex, [rootBlockId, root]] of roots.entries())
    {
      const blockIds = scriptBlockIds(target, rootBlockId)
      scripts.push({
        targetIndex,
        scriptIndex,
        rootBlockId,
        opcode: root.opcode,
        x: root.x ?? null,
        y: root.y ?? null,
        blockCount: blockIds.length,
      })
      for (const [order, blockId] of blockIds.entries())
      {
        if (!scriptMembership.has(blockId))
        {
          scriptMembership.set(blockId, { scriptIndex, order })
        }
      }
    }
    for (const [blockId, entry] of scratchRecordEntries(target.blocks))
    {
      const membership = scriptMembership.get(blockId)
      blocks.push(
        blockInspection(
          targetIndex,
          blockId,
          entry,
          membership?.scriptIndex ?? null,
          membership?.order ?? null
        )
      )
    }
    declarations.push(...declarationsOf(target, targetIndex))
    targets.push({
      targetIndex,
      name: target.name,
      isStage: target.isStage,
      blockCount: Object.keys(target.blocks).length,
      scriptCount: roots.length,
      costumeCount: target.costumes.length,
      soundCount: target.sounds.length,
      variableCount: Object.keys(target.variables).length,
      listCount: Object.keys(target.lists ?? {}).length,
      broadcastCount: Object.keys(target.broadcasts ?? {}).length,
      commentCount: Object.keys(target.comments ?? {}).length,
    })
  }

  const diagnosticCatalog: ProjectDiagnosticInspection[] = [
    ...diagnostics.schema.map((message) => ({
      source: 'schema' as const,
      severity: 'error' as const,
      code: 'schema',
      message,
      location: {},
    })),
    ...diagnostics.graph.map((diagnostic) => ({
      source: 'graph' as const,
      ...structuredClone(diagnostic),
    })),
    ...diagnostics.static.map((diagnostic) => ({
      source: 'static' as const,
      ...structuredClone(diagnostic),
    })),
  ]

  return {
    targets,
    scripts,
    blocks,
    declarations,
    diagnostics: diagnosticCatalog,
  }
}
