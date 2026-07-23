// packages/ir/src/edit/procedure-operations.ts
// synthesize & apply exact custom-procedure definition, signature, call, & removal transactions

import {
  createScratchRecord,
  defineScratchRecordValue,
  deleteScratchRecordValue,
  scratchRecordValue,
  type Block,
  type BlockEntry,
  type BlockField,
  type BlockInput,
  type Mutation,
  type Target,
} from '@scratch-agent/sb3'

import type { ProjectIR } from '../project/project-ir.js'
import type { Uids } from '../core/uid.js'
import type {
  CommentRefV1,
  CommentRemovalDispositionV1,
  OwnedInputReplacementV1,
  ParameterRefV1,
  ProcedureSignatureV1,
  PrototypeReporterCommentDispositionV1,
  SemanticEditOperationProcedureAddV1,
  SemanticEditOperationProcedureRemoveV1,
  SemanticEditOperationProcedureSetCallArgumentV1,
  SemanticEditOperationProcedureUpdateSignatureV1,
  SemanticInputValueV1,
  SemanticStatementSequenceV1,
} from './contracts.generated.js'
import {
  blockInputFingerprintV1,
  commentSetSha256V1,
  commitGraphAllocatorV1,
  deleteExactCommentsV1,
  planGraphClosureV1,
  setTopLevelWorkspaceV1,
  type GraphInstalledClosureV1,
} from './graph-primitives.js'
import {
  parameterEntityEvidenceSetV1,
  procedureEntityEvidenceSetV1,
  resolveBlockRefV1,
  resolveCommentRefV1,
} from './group-c-entity-resolution.js'
import { semanticHashV1 } from './hash-domains.js'
import { unknownNameSemanticsEvidenceV1 } from './name-semantics-catalog.js'
import {
  parseMutationArray,
  procedurePlaceholderKinds,
} from './procedure-mutation.js'
import {
  PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1,
  procedureParameterEncodingForPlaceholderV1,
  type ProcedureParameterTypeV1,
} from './procedure-parameter-catalog.js'
import { buildSemanticReferenceIndex } from './reference-index.js'
import type { SemanticReferenceIndex } from './reference-index-types.js'

type ProcedureOperationV1 =
  | SemanticEditOperationProcedureAddV1
  | SemanticEditOperationProcedureUpdateSignatureV1
  | SemanticEditOperationProcedureSetCallArgumentV1
  | SemanticEditOperationProcedureRemoveV1

type ProcedureOperationErrorCodeV1 =
  | 'edit.cardinality_mismatch'
  | 'edit.fingerprint_mismatch'
  | 'edit.graph_failed'
  | 'edit.internal_invariant'
  | 'edit.invalid_owner'
  | 'edit.invalid_shape'
  | 'edit.planning_facts_mismatch'
  | 'edit.procedure_ambiguous'
  | 'edit.selector_no_match'
  | 'edit.unsupported_opcode'

class ProcedureOperationErrorV1 extends Error
{
  constructor(
    readonly code: ProcedureOperationErrorCodeV1,
    message: string,
    readonly matchCount: number | null = null
  )
  {
    super(message)
    this.name = 'ProcedureOperationErrorV1'
  }
}

function procedureError(
  code: ProcedureOperationErrorCodeV1,
  message: string,
  matchCount: number | null = null
): never
{
  throw new ProcedureOperationErrorV1(code, message, matchCount)
}

// a parameter reporter keys on its signature-local key, never on its ordinal:
// reordering a signature must move a parameter without changing its identity,
// which is exactly what the ordered-collection correspondence has to prove.
function parameterReporterCreationKey(localKey: string): string
{
  return `procedure/parameter/${localKey}/reporter`
}

interface ProcedureSignatureParameterV1
{
  readonly localKey: string
  readonly name: string
  readonly parameterType: ProcedureParameterTypeV1
  readonly defaultValue: string | number | boolean
}

export interface DecodedProcedureSignatureV1
{
  readonly proccode: string
  readonly warp: boolean
  readonly parameters: readonly ProcedureSignatureParameterV1[]
}

// V1 authors %s, %n & %b; the frozen AuthoringProcedureFragmentV1 pattern
// already excludes % & backslash, so a label contributes its text verbatim
export function canonicalProcedureSignatureV1(
  signature: ProcedureSignatureV1
): DecodedProcedureSignatureV1
{
  const components: string[] = []
  const parameters: ProcedureSignatureParameterV1[] = []
  const seenLocalKeys = new Set<string>()
  for (const part of signature.parts)
  {
    if (part.kind === 'label')
    {
      if (/[%\\]/u.test(part.text))
        procedureError(
          'edit.invalid_shape',
          'authored label fragments cannot contain percent or backslash'
        )
      components.push(part.text)
      continue
    }
    if (seenLocalKeys.has(part.localKey))
      procedureError(
        'edit.invalid_shape',
        `procedure parameter local key ${part.localKey} is duplicated`
      )
    seenLocalKeys.add(part.localKey)
    if (/[%\\]/u.test(part.name))
      procedureError(
        'edit.invalid_shape',
        'authored parameter names cannot contain percent or backslash'
      )
    components.push(
      PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[part.parameterType].placeholder
    )
    parameters.push({
      localKey: part.localKey,
      name: part.name,
      parameterType: part.parameterType,
      defaultValue: part.defaultValue,
    })
  }
  if (components.length === 0)
    procedureError(
      'edit.invalid_shape',
      'procedure signature requires at least one component'
    )
  return {
    proccode: components.join(' '),
    warp: signature.warp,
    parameters: Object.freeze(parameters),
  }
}

// a %b default serializes as a JSON boolean & a %n default as a JSON number; a
// %s default keeps a number verbatim & otherwise stringifies
function serializedDefault(
  parameter: ProcedureSignatureParameterV1
): string | number | boolean
{
  const mode =
    PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameter.parameterType]
      .defaultValueMode
  if (mode === 'coerceBoolean') return parameter.defaultValue === true
  if (mode === 'coerceNumber')
    return typeof parameter.defaultValue === 'number'
      ? parameter.defaultValue
      : Number(parameter.defaultValue)
  return typeof parameter.defaultValue === 'number'
    ? parameter.defaultValue
    : String(parameter.defaultValue)
}

interface ProcedureMutationPayloadV1
{
  readonly proccode: string
  readonly argumentIds: readonly string[]
  readonly argumentNames: readonly string[]
  readonly argumentDefaults: readonly (string | number | boolean)[]
  readonly warp: boolean
}

export function procedurePrototypeMutationV1(
  payload: ProcedureMutationPayloadV1
): Mutation
{
  return {
    tagName: 'mutation',
    children: [],
    proccode: payload.proccode,
    argumentids: JSON.stringify([...payload.argumentIds]),
    argumentnames: JSON.stringify([...payload.argumentNames]),
    argumentdefaults: JSON.stringify([...payload.argumentDefaults]),
    warp: payload.warp ? 'true' : 'false',
  }
}

function procedureCallMutationV1(
  payload: ProcedureMutationPayloadV1
): Mutation
{
  return {
    tagName: 'mutation',
    children: [],
    proccode: payload.proccode,
    argumentids: JSON.stringify([...payload.argumentIds]),
    warp: payload.warp ? 'true' : 'false',
  }
}

export interface ProcedureRecordV1
{
  readonly targetIndex: number
  readonly definitionBlockId: string
  readonly prototypeBlockId: string
  readonly proccode: string
  readonly warp: boolean
  readonly argumentIds: readonly string[]
  readonly argumentNames: readonly string[]
  readonly argumentDefaults: readonly string[]
}

function blockEntry(target: Target, blockId: string): Block
{
  const entry = scratchRecordValue(target.blocks, blockId)
  if (!entry || Array.isArray(entry))
    procedureError(
      'edit.selector_no_match',
      `block ${blockId} is absent or is a primitive tuple`
    )
  return entry as Block
}

// resolve the definition/prototype pair for a proccode inside one target; the
// frozen precedence is definition input -> prototype mutation, exact match only
export function resolveProcedureRecordV1(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): ProcedureRecordV1
{
  const target = project.json.targets[targetIndex]
  if (!target)
    procedureError('edit.invalid_owner', `target ${targetIndex} is absent`)
  const matches: ProcedureRecordV1[] = []
  for (const [definitionBlockId, entry] of Object.entries(target.blocks))
  {
    if (!entry || Array.isArray(entry)) continue
    const definition = entry as Block
    if (definition.opcode !== 'procedures_definition') continue
    const custom = scratchRecordValue(definition.inputs, 'custom_block')
    const prototypeBlockId = custom?.[1]
    if (typeof prototypeBlockId !== 'string') continue
    const prototype = scratchRecordValue(target.blocks, prototypeBlockId)
    if (!prototype || Array.isArray(prototype)) continue
    const mutation = (prototype as Block).mutation
    if (!mutation || mutation.proccode !== proccode) continue
    const argumentIds = parseMutationArray(mutation.argumentids) ?? []
    const argumentNames = parseMutationArray(mutation.argumentnames) ?? []
    const argumentDefaults = parseMutationArray(mutation.argumentdefaults) ?? []
    matches.push({
      targetIndex,
      definitionBlockId,
      prototypeBlockId,
      proccode,
      warp: mutation.warp === 'true' || mutation.warp === true,
      argumentIds: Object.freeze(argumentIds),
      argumentNames: Object.freeze(argumentNames),
      argumentDefaults: Object.freeze(argumentDefaults),
    })
  }
  if (matches.length === 0)
    procedureError(
      'edit.selector_no_match',
      `no procedure definition for proccode ${proccode}`
    )
  if (matches.length > 1)
    procedureError(
      'edit.procedure_ambiguous',
      `proccode ${proccode} resolves to ${matches.length} definitions`
    )
  return matches[0]!
}

export interface ProcedureCallSiteV1
{
  readonly targetIndex: number
  readonly blockId: string
  readonly argumentIds: readonly string[]
}

// calls are target-local: a proccode only dispatches inside its owning target
export function procedureCallSitesV1(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): readonly ProcedureCallSiteV1[]
{
  const target = project.json.targets[targetIndex]
  if (!target) return Object.freeze([])
  const sites: ProcedureCallSiteV1[] = []
  for (const [blockId, entry] of Object.entries(target.blocks))
  {
    if (!entry || Array.isArray(entry)) continue
    const block = entry as Block
    if (block.opcode !== 'procedures_call') continue
    if (block.mutation?.proccode !== proccode) continue
    sites.push({
      targetIndex,
      blockId,
      argumentIds: Object.freeze(
        parseMutationArray(block.mutation.argumentids) ?? []
      ),
    })
  }
  sites.sort((left, right) => (left.blockId < right.blockId ? -1 : 1))
  return Object.freeze(sites)
}

// argument reporters that live outside the procedure's own definition closure
// would dangle after a signature change or removal, so they are counted exactly
export function externalArgumentReporterIdsV1(
  project: ProjectIR,
  targetIndex: number,
  ownedBlockIds: ReadonlySet<string>,
  argumentNames: ReadonlySet<string>
): readonly string[]
{
  const target = project.json.targets[targetIndex]
  if (!target) return Object.freeze([])
  const external: string[] = []
  for (const [blockId, entry] of Object.entries(target.blocks))
  {
    if (!entry || Array.isArray(entry)) continue
    const block = entry as Block
    if (
      block.opcode !== 'argument_reporter_string_number' &&
      block.opcode !== 'argument_reporter_boolean'
    )
      continue
    if (ownedBlockIds.has(blockId)) continue
    const field = scratchRecordValue(block.fields, 'VALUE')
    const name = field?.[0]
    if (typeof name === 'string' && argumentNames.has(name))
      external.push(blockId)
  }
  return Object.freeze(external.sort())
}

type ProspectiveProcedureRecordRoleV1 =
  'definition' | 'prototype' | 'call'

interface ProspectiveProcedureCollisionRecordV1
{
  readonly role: ProspectiveProcedureRecordRoleV1
  readonly blockId: string
  readonly proccode: string
  readonly argumentIds: readonly string[] | null
  readonly argumentNames: readonly string[] | null
  readonly warp: boolean | null
  readonly ownership: 'definitionOwned' | 'orphan'
}

interface ProspectiveProcedureCollisionSetV1
{
  readonly targetIndex: number
  readonly proccode: string
  readonly records: readonly ProspectiveProcedureCollisionRecordV1[]
}

// the prototype a definition claims through its custom_block input; a
// definition whose input is absent or dangling owns nothing
function claimedPrototypeId(target: Target, definition: Block): string | null
{
  const custom = scratchRecordValue(definition.inputs, 'custom_block')
  const prototypeBlockId = custom?.[1]
  if (typeof prototypeBlockId !== 'string') return null
  const prototype = scratchRecordValue(target.blocks, prototypeBlockId)
  if (!prototype || Array.isArray(prototype)) return null
  return prototypeBlockId
}

// every definition/prototype/call in one target whose proccode would equal the
// proposed one. a malformed mutation already makes the source not editable, so
// such a record is still reported rather than silently dropped.
export function prospectiveProcedureCollisionSetV1(
  project: ProjectIR,
  targetIndex: number,
  proccode: string,
  excludedBlockIds: ReadonlySet<string> = new Set<string>()
): ProspectiveProcedureCollisionSetV1
{
  const target = project.json.targets[targetIndex]
  if (!target)
    procedureError('edit.invalid_owner', `target ${targetIndex} is absent`)
  // a prototype is owned when some definition claims it; a call is owned when
  // a complete definition/prototype pair for the proccode exists
  const claimedPrototypeIds = new Set<string>()
  let hasOwningDefinition = false
  for (const entry of Object.values(target.blocks))
  {
    if (!entry || Array.isArray(entry)) continue
    const definition = entry as Block
    if (definition.opcode !== 'procedures_definition') continue
    const prototypeBlockId = claimedPrototypeId(target, definition)
    if (prototypeBlockId === null) continue
    claimedPrototypeIds.add(prototypeBlockId)
    const prototype = scratchRecordValue(target.blocks, prototypeBlockId)
    if (!prototype || Array.isArray(prototype)) continue
    if ((prototype as Block).mutation?.proccode === proccode)
      hasOwningDefinition = true
  }
  const records: ProspectiveProcedureCollisionRecordV1[] = []
  for (const [blockId, entry] of Object.entries(target.blocks))
  {
    if (!entry || Array.isArray(entry)) continue
    if (excludedBlockIds.has(blockId)) continue
    const block = entry as Block
    const role: ProspectiveProcedureRecordRoleV1 | null =
      block.opcode === 'procedures_definition'
        ? 'definition'
        : block.opcode === 'procedures_prototype'
          ? 'prototype'
          : block.opcode === 'procedures_call'
            ? 'call'
            : null
    if (role === null) continue
    // a definition carries no mutation of its own; it collides through the
    // prototype it claims, so resolve that before comparing proccodes
    const mutationSource =
      role === 'definition'
        ? (() =>
          {
            const prototypeBlockId = claimedPrototypeId(target, block)
            if (prototypeBlockId === null) return null
            const prototype = scratchRecordValue(
              target.blocks,
              prototypeBlockId
            )
            return !prototype || Array.isArray(prototype)
              ? null
              : ((prototype as Block).mutation ?? null)
          })()
        : (block.mutation ?? null)
    if (mutationSource?.proccode !== proccode) continue
    const ownership =
      role === 'prototype'
        ? claimedPrototypeIds.has(blockId)
          ? 'definitionOwned'
          : 'orphan'
        : role === 'definition'
          ? 'definitionOwned'
          : hasOwningDefinition
            ? 'definitionOwned'
            : 'orphan'
    records.push({
      role,
      blockId,
      proccode,
      argumentIds: parseMutationArray(mutationSource.argumentids),
      argumentNames: parseMutationArray(mutationSource.argumentnames),
      warp:
        mutationSource.warp === undefined
          ? null
          : mutationSource.warp === 'true' || mutationSource.warp === true,
      ownership,
    })
  }
  records.sort((left, right) =>
    left.role === right.role
      ? left.blockId < right.blockId
        ? -1
        : 1
      : left.role < right.role
        ? -1
        : 1
  )
  return {
    targetIndex,
    proccode,
    records: Object.freeze(records),
  }
}

export function prospectiveProcedureCollisionSetSha256V1(
  set: ProspectiveProcedureCollisionSetV1
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'prospective-procedure-collision-set',
    schemaVersion: 1,
    ...set,
  })
}

const PROCEDURE_OPERATION_KINDS_V1 = [
  'procedure.add',
  'procedure.remove',
  'procedure.setCallArgument',
  'procedure.updateSignature',
] as const

type ProcedureOperationKindV1 =
  (typeof PROCEDURE_OPERATION_KINDS_V1)[number]

// deliberately carries ONE availability over coveredOperationKinds rather than
// a per-operation row set; plan step E8 enables the family as a complete unit
interface ProcedureCapabilityAssessmentV1
{
  readonly family: 'procedure'
  readonly availability: 'supported' | 'unsupported'
  readonly coveredOperationKinds: readonly ProcedureOperationKindV1[]
  readonly indexedProcedureCount: number
  readonly admissibleProcedureCount: number
  readonly indexedParameterCount: number
  readonly admissibleParameterCount: number
  readonly restrictions: readonly string[]
  readonly assessmentSha256: string
}

// the single family-wide invariant: revision-0 lineage enumerates every indexed
// procedure & parameter, while the evidence sets admit only exactly-resolvable
// ones, so any shortfall leaves lineage rows w/ no matching evidence row
function procedureEvidenceAgreementV1(
  project: ProjectIR,
  index: SemanticReferenceIndex
): {
  indexedProcedureCount: number
  admissibleProcedureCount: number
  indexedParameterCount: number
  admissibleParameterCount: number
}
{
  return {
    indexedProcedureCount: index.procedures.length,
    admissibleProcedureCount: procedureEntityEvidenceSetV1(project, index)
      .length,
    indexedParameterCount: index.procedures.reduce(
      (total, procedure) => total + (procedure.parameters ?? []).length,
      0
    ),
    admissibleParameterCount: parameterEntityEvidenceSetV1(project, index)
      .length,
  }
}

// a procedure whose argument ids or names repeat cannot carry stable parameter
// identity: rawIdentity is parameter:<argumentId> & reporter migration keys on
// the name, so a duplicate collapses two distinct parameters into one
function duplicateParameterIdentityV1(index: SemanticReferenceIndex): boolean
{
  return index.procedures.some((procedure) =>
  {
    const parameters = procedure.parameters ?? []
    const argumentIds = new Set(
      parameters.map((parameter) => parameter.argumentId)
    )
    const names = new Set(parameters.map((parameter) => parameter.name))
    return (
      argumentIds.size !== parameters.length || names.size !== parameters.length
    )
  })
}

// one aggregate verdict over all four procedure operation kinds; the family is
// available as a complete unit or not at all, never per-operation
export function assessProcedureCapabilitiesV1(
  project: ProjectIR,
  suppliedIndex?: SemanticReferenceIndex
): ProcedureCapabilityAssessmentV1
{
  const index = suppliedIndex ?? buildSemanticReferenceIndex(project)
  const restrictions: string[] = []
  const unknownSemantics = unknownNameSemanticsEvidenceV1(project.json)
  const unknownSemanticsBlocked =
    unknownSemantics.declaredExtensions.length > 0 ||
    unknownSemantics.unknownOpcodes.length > 0 ||
    unknownSemantics.surfaceIssues.length > 0
  if (unknownSemanticsBlocked)
    restrictions.push(
      'unknown extension or opcode name semantics restrict structural procedure edits'
    )
  const agreement = procedureEvidenceAgreementV1(project, index)
  const procedureEvidenceComplete =
    agreement.admissibleProcedureCount === agreement.indexedProcedureCount &&
    agreement.admissibleParameterCount === agreement.indexedParameterCount
  if (!procedureEvidenceComplete)
    restrictions.push(
      'ambiguous or mutation-broken procedures leave lineage rows without exact evidence'
    )
  const duplicateParameterIdentity = duplicateParameterIdentityV1(index)
  if (duplicateParameterIdentity)
    restrictions.push(
      'repeated parameter argument ids or names cannot carry stable parameter identity'
    )
  const supported =
    !unknownSemanticsBlocked &&
    procedureEvidenceComplete &&
    !duplicateParameterIdentity
  const assessment = {
    family: 'procedure' as const,
    availability: supported ? ('supported' as const) : ('unsupported' as const),
    coveredOperationKinds: PROCEDURE_OPERATION_KINDS_V1,
    ...agreement,
    restrictions: Object.freeze(
      restrictions.sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      )
    ),
  }
  return Object.freeze({
    ...assessment,
    assessmentSha256: semanticHashV1('capability-profile', assessment),
  })
}

interface ProcedureOperationCatalogAdapterV1
{
  readonly lowerStatementSequence: (
    project: ProjectIR,
    targetIndex: number,
    sequence: SemanticStatementSequenceV1
  ) => GraphInstalledClosureV1
}

export interface AppliedProcedureOperationV1
{
  readonly opId: string
  readonly operationKind: ProcedureOperationV1['kind']
  readonly targetIndex: number
  readonly proccode: string
  readonly definitionBlockId: string | null
  readonly prototypeBlockId: string | null
  readonly createdBlockIds: readonly string[]
  readonly removedBlockIds: readonly string[]
  readonly removedCommentIds: readonly string[]
  readonly argumentIdByLocalKey: Readonly<Record<string, string>>
  readonly argumentOrdinalById: Readonly<Record<string, number>>
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
  readonly callSiteBlockIds: readonly string[]
  readonly exactPaths: readonly string[]
}

function targetAt(project: ProjectIR, targetIndex: number): Target
{
  const target = project.json.targets[targetIndex]
  if (!target)
    procedureError('edit.invalid_owner', `target ${targetIndex} is absent`)
  return target
}

function allocate(uids: Uids, prefix: string): string
{
  return uids.next(prefix)
}

// deterministic argument ids are derived from the allocator, never from the
// caller's local keys, so a caller alias can never influence serialized identity
function buildDefinitionClosure(
  decoded: DecodedProcedureSignatureV1,
  workspace: { readonly x: number; readonly y: number },
  uids: Uids
): {
  readonly definitionBlockId: string
  readonly prototypeBlockId: string
  readonly blocks: Record<string, Block>
  readonly argumentIdByLocalKey: Record<string, string>
  readonly reporterBlockIdByLocalKey: Record<string, string>
  readonly creationKeyByBlockId: Record<string, string>
}
{
  const definitionBlockId = allocate(uids, 'b')
  const prototypeBlockId = allocate(uids, 'b')
  const blocks: Record<string, Block> = Object.create(null) as Record<
    string,
    Block
  >
  const argumentIdByLocalKey: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  const reporterBlockIdByLocalKey: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  const creationKeyByBlockId: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  creationKeyByBlockId[definitionBlockId] = 'procedure/definition'
  creationKeyByBlockId[prototypeBlockId] = 'procedure/prototype'
  const prototypeInputs: [string, BlockInput][] = []
  for (const parameter of decoded.parameters)
  {
    const argumentId = allocate(uids, 'p')
    const reporterBlockId = allocate(uids, 'b')
    argumentIdByLocalKey[parameter.localKey] = argumentId
    reporterBlockIdByLocalKey[parameter.localKey] = reporterBlockId
    creationKeyByBlockId[reporterBlockId] = parameterReporterCreationKey(
      parameter.localKey
    )
    blocks[reporterBlockId] = Object.assign(Object.create(null) as Block, {
      opcode:
        PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameter.parameterType]
          .reporterOpcode,
      next: null,
      parent: prototypeBlockId,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<[string, string | null]>([
        ['VALUE', [parameter.name, null]],
      ]) as Block['fields'],
      shadow: true,
      topLevel: false,
    })
    prototypeInputs.push([argumentId, [1, reporterBlockId]])
  }
  const payload: ProcedureMutationPayloadV1 = {
    proccode: decoded.proccode,
    argumentIds: decoded.parameters.map(
      (parameter) => argumentIdByLocalKey[parameter.localKey]!
    ),
    argumentNames: decoded.parameters.map((parameter) => parameter.name),
    argumentDefaults: decoded.parameters.map(serializedDefault),
    warp: decoded.warp,
  }
  blocks[prototypeBlockId] = Object.assign(Object.create(null) as Block, {
    opcode: 'procedures_prototype',
    next: null,
    parent: definitionBlockId,
    inputs: createScratchRecord<BlockInput>(prototypeInputs),
    fields: createScratchRecord<[string, string | null]>() as Block['fields'],
    shadow: true,
    topLevel: false,
    mutation: procedurePrototypeMutationV1(payload),
  })
  blocks[definitionBlockId] = Object.assign(Object.create(null) as Block, {
    opcode: 'procedures_definition',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['custom_block', [1, prototypeBlockId]],
    ]),
    fields: createScratchRecord<[string, string | null]>() as Block['fields'],
    shadow: false,
    topLevel: true,
    x: workspace.x,
    y: workspace.y,
  })
  return {
    definitionBlockId,
    prototypeBlockId,
    blocks,
    argumentIdByLocalKey,
    reporterBlockIdByLocalKey,
    creationKeyByBlockId,
  }
}

// the definition closure is every block reachable from the definition: the
// prototype, its argument reporter shadows, & the attached body statements
export function procedureOwnedBlockIdsV1(
  target: Target,
  definitionBlockId: string
): readonly string[]
{
  const owned = new Set<string>()
  const queue: string[] = [definitionBlockId]
  while (queue.length > 0)
  {
    const blockId = queue.shift()!
    if (owned.has(blockId)) continue
    const entry = scratchRecordValue(target.blocks, blockId)
    if (!entry || Array.isArray(entry)) continue
    owned.add(blockId)
    const block = entry as Block
    if (typeof block.next === 'string') queue.push(block.next)
    for (const input of Object.values(block.inputs ?? {}))
      for (const slot of input as readonly unknown[])
        if (typeof slot === 'string') queue.push(slot)
  }
  return Object.freeze([...owned].sort())
}

export function applyProcedureOperationV1(
  project: ProjectIR,
  resolved: ResolvedProcedureOperationV1,
  adapters: ProcedureOperationCatalogAdapterV1
): AppliedProcedureOperationV1
{
  if (resolved.operation.kind === 'procedure.add')
    return applyProcedureAdd(
      project,
      resolved as Extract<
        ResolvedProcedureOperationV1,
        { operation: SemanticEditOperationProcedureAddV1 }
      >,
      adapters
    )
  if (resolved.operation.kind === 'procedure.remove')
    return applyProcedureRemove(
      project,
      resolved as Extract<
        ResolvedProcedureOperationV1,
        { operation: SemanticEditOperationProcedureRemoveV1 }
      >
    )
  if (resolved.operation.kind === 'procedure.setCallArgument')
    return applyProcedureSetCallArgument(
      project,
      resolved as Extract<
        ResolvedProcedureOperationV1,
        { operation: SemanticEditOperationProcedureSetCallArgumentV1 }
      >,
      adapters
    )
  return applyProcedureUpdateSignature(
    project,
    resolved as Extract<
      ResolvedProcedureOperationV1,
      { operation: SemanticEditOperationProcedureUpdateSignatureV1 }
    >,
    adapters
  )
}

export type ResolvedProcedureOperationV1 =
  | {
      readonly operation: SemanticEditOperationProcedureAddV1
      readonly targetIndex: number
    }
  | {
      readonly operation: SemanticEditOperationProcedureUpdateSignatureV1
      readonly targetIndex: number
      readonly record: ProcedureRecordV1
      readonly callSiteBlockIds: readonly string[]
    }
  | {
      readonly operation: SemanticEditOperationProcedureSetCallArgumentV1
      readonly targetIndex: number
      readonly record: ProcedureRecordV1
      readonly callBlockId: string
      readonly argumentId: string
    }
  | {
      readonly operation: SemanticEditOperationProcedureRemoveV1
      readonly targetIndex: number
      readonly record: ProcedureRecordV1
      readonly dispositionCommentIds: readonly string[]
    }

function applyProcedureAdd(
  project: ProjectIR,
  resolved: Extract<
    ResolvedProcedureOperationV1,
    { operation: SemanticEditOperationProcedureAddV1 }
  >,
  adapters: ProcedureOperationCatalogAdapterV1
): AppliedProcedureOperationV1
{
  const { operation, targetIndex } = resolved
  const target = targetAt(project, targetIndex)
  const decoded = canonicalProcedureSignatureV1(operation.signature)
  // a colliding proccode is unrepresentable per the frozen contract, so this is
  // an invariant check rather than a caller-reachable refusal path
  for (const entry of Object.values(target.blocks))
  {
    if (!entry || Array.isArray(entry)) continue
    const block = entry as Block
    if (
      block.opcode === 'procedures_prototype' &&
      block.mutation?.proccode === decoded.proccode
    )
      procedureError(
        'edit.cardinality_mismatch',
        `proccode ${decoded.proccode} already exists in target ${targetIndex}`
      )
  }
  const candidate = project.uids.clone()
  const closure = buildDefinitionClosure(
    decoded,
    operation.workspace,
    candidate
  )
  // commit the closure's own ids before lowering: the catalog adapter clones
  // project.uids independently, so an uncommitted candidate would let the body
  // & the definition closure both be handed the same block id
  project.uids.commit(candidate)
  const body = operation.body
    ? adapters.lowerStatementSequence(project, targetIndex, operation.body)
    : null
  if (body) commitGraphAllocatorV1(project.uids, body)
  const createdBlockIds = [...Object.keys(closure.blocks)]
  const creationKeyByBlockId: Record<string, string> = {
    ...closure.creationKeyByBlockId,
  }
  for (const [blockId, block] of Object.entries(closure.blocks))
    defineScratchRecordValue<BlockEntry>(target.blocks, blockId, block)
  if (body)
  {
    for (const [blockId, block] of Object.entries(body.blocks))
    {
      defineScratchRecordValue<BlockEntry>(target.blocks, blockId, block)
      createdBlockIds.push(blockId)
      const key = body.creationKeyByBlockId?.[blockId]
      creationKeyByBlockId[blockId] = key
        ? `procedure/body/${key}`
        : `procedure/body/${blockId}`
    }
    const definition = blockEntry(target, closure.definitionBlockId)
    Object.assign(definition, { next: body.rootId })
    const root = blockEntry(target, body.rootId)
    Object.assign(root, { parent: closure.definitionBlockId, topLevel: false })
    delete (root as { x?: number }).x
    delete (root as { y?: number }).y
  }
  setTopLevelWorkspaceV1(target, closure.definitionBlockId, operation.workspace)
  const argumentOrdinalById: Record<string, number> = Object.create(
    null
  ) as Record<string, number>
  for (const [ordinal, parameter] of decoded.parameters.entries())
    argumentOrdinalById[closure.argumentIdByLocalKey[parameter.localKey]!] =
      ordinal
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    proccode: decoded.proccode,
    definitionBlockId: closure.definitionBlockId,
    prototypeBlockId: closure.prototypeBlockId,
    createdBlockIds: Object.freeze([...createdBlockIds].sort()),
    removedBlockIds: Object.freeze([]),
    removedCommentIds: Object.freeze([]),
    argumentIdByLocalKey: Object.freeze({ ...closure.argumentIdByLocalKey }),
    argumentOrdinalById: Object.freeze(argumentOrdinalById),
    aliasBlockIds: Object.freeze({
      ...closure.reporterBlockIdByLocalKey,
      ...(body?.aliasBlockIds ?? {}),
    }),
    creationKeyByBlockId: Object.freeze(creationKeyByBlockId),
    callSiteBlockIds: Object.freeze([]),
    exactPaths: Object.freeze(
      [...createdBlockIds]
        .sort()
        .map((blockId) => `/targets/${targetIndex}/blocks/${blockId}`)
    ),
  }
}

function applyProcedureRemove(
  project: ProjectIR,
  resolved: Extract<
    ResolvedProcedureOperationV1,
    { operation: SemanticEditOperationProcedureRemoveV1 }
  >
): AppliedProcedureOperationV1
{
  const { operation, targetIndex, record } = resolved
  const target = targetAt(project, targetIndex)
  const calls = procedureCallSitesV1(project, targetIndex, record.proccode)
  if (calls.length !== operation.requireFinalCallCount)
    procedureError(
      'edit.cardinality_mismatch',
      `procedure ${record.proccode} still has ${calls.length} call sites`
    )
  const owned = new Set(
    procedureOwnedBlockIdsV1(target, record.definitionBlockId)
  )
  const external = externalArgumentReporterIdsV1(
    project,
    targetIndex,
    owned,
    new Set(record.argumentNames)
  )
  if (external.length !== operation.requireFinalExternalArgumentReporterCount)
    procedureError(
      'edit.cardinality_mismatch',
      `procedure ${record.proccode} has ${external.length} external argument reporters`
    )
  const plan = planGraphClosureV1(target, 'script', record.definitionBlockId)
  if (plan.orderedBlockIds.length !== operation.expectedOwnedBlockCount)
    procedureError(
      'edit.cardinality_mismatch',
      'procedure owned block count differs from the planned closure'
    )
  if (plan.closureSha256 !== operation.expectedOwnedClosureSha256)
    procedureError(
      'edit.fingerprint_mismatch',
      'procedure owned closure hash differs'
    )
  deleteExactCommentsV1(target, resolved.dispositionCommentIds)
  const removedCommentIds = resolved.dispositionCommentIds
  for (const blockId of plan.orderedBlockIds)
    deleteScratchRecordValue(target.blocks, blockId)
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    proccode: record.proccode,
    definitionBlockId: null,
    prototypeBlockId: null,
    createdBlockIds: Object.freeze([]),
    removedBlockIds: Object.freeze([...plan.orderedBlockIds].sort()),
    removedCommentIds: Object.freeze([...removedCommentIds].sort()),
    argumentIdByLocalKey: Object.freeze({}),
    argumentOrdinalById: Object.freeze({}),
    aliasBlockIds: Object.freeze({}),
    creationKeyByBlockId: Object.freeze({}),
    callSiteBlockIds: Object.freeze([]),
    exactPaths: Object.freeze(
      [...plan.orderedBlockIds]
        .sort()
        .map((blockId) => `/targets/${targetIndex}/blocks/${blockId}`)
    ),
  }
}

function applyProcedureSetCallArgument(
  project: ProjectIR,
  resolved: Extract<
    ResolvedProcedureOperationV1,
    { operation: SemanticEditOperationProcedureSetCallArgumentV1 }
  >,
  adapters: ProcedureOperationCatalogAdapterV1
): AppliedProcedureOperationV1
{
  const { operation, targetIndex, record, callBlockId, argumentId } = resolved
  const target = targetAt(project, targetIndex)
  const call = blockEntry(target, callBlockId)
  if (call.opcode !== 'procedures_call')
    procedureError(
      'edit.invalid_shape',
      `block ${callBlockId} is not a procedures_call`
    )
  if (call.mutation?.proccode !== record.proccode)
    procedureError(
      'edit.selector_no_match',
      'call site does not dispatch to the selected procedure'
    )
  if (!record.argumentIds.includes(argumentId))
    procedureError(
      'edit.selector_no_match',
      `argument ${argumentId} is not declared by the procedure signature`
    )
  const removedBlockIds: string[] = []
  const existing = scratchRecordValue(call.inputs, argumentId)
  if (operation.replacedInput.kind === 'requireNoOwnedBlock')
  {
    const owned = existing?.[1]
    if (typeof owned === 'string')
      procedureError(
        'edit.invalid_shape',
        'call argument already owns a block but replacement requires none'
      )
  }
  else
  {
    const owned = existing?.[1]
    if (typeof owned !== 'string')
      procedureError(
        'edit.selector_no_match',
        'call argument has no owned closure to delete'
      )
    const plan = planGraphClosureV1(target, 'ownedBlock', owned)
    if (plan.closureSha256 !== operation.replacedInput.expectedClosureSha256)
      procedureError(
        'edit.fingerprint_mismatch',
        'replaced call-argument closure hash differs'
      )
    if (
      plan.orderedBlockIds.length !==
      operation.replacedInput.expectedOwnedBlockCount
    )
      procedureError(
        'edit.cardinality_mismatch',
        'replaced call-argument owned block count differs'
      )
    for (const blockId of plan.orderedBlockIds)
    {
      deleteScratchRecordValue(target.blocks, blockId)
      removedBlockIds.push(blockId)
    }
  }
  const createdBlockIds: string[] = []
  const aliasBlockIds: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >
  const creationKeyByBlockId: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  // the slot's declared placeholder picks the shadow primitive: a %n slot takes
  // the math-number primitive, every other round slot takes text
  const placeholder = procedurePlaceholderKinds(record.proccode)[
    record.argumentIds.indexOf(argumentId)
  ]
  if (placeholder === undefined)
    procedureError(
      'edit.internal_invariant',
      'resolved call argument has no procedure placeholder'
    )
  const encoding = procedureParameterEncodingForPlaceholderV1(placeholder)
  let nextInput: BlockInput
  if (operation.value.valueKind === 'literal')
  {
    if (encoding.literalValueMode === 'unsupported')
      procedureError(
        'edit.invalid_shape',
        'a boolean call argument has no literal primitive'
      )
    const literal =
      encoding.literalValueMode === 'preserveNumber' &&
      typeof operation.value.value === 'number'
        ? operation.value.value
        : String(operation.value.value)
    nextInput = [1, [encoding.literalPrimitiveTag, literal]]
  }
  else if (operation.value.valueKind === 'block')
  {
    // lower the wrapped tree, not the SemanticInputValueV1 envelope: the
    // sequence validator keys on nodeKind, which the envelope does not carry
    const lowered = adapters.lowerStatementSequence(project, targetIndex, {
      blocks: [
        operation.value
          .value as unknown as SemanticStatementSequenceV1['blocks'][number],
      ],
    } as SemanticStatementSequenceV1)
    commitGraphAllocatorV1(project.uids, lowered)
    for (const [blockId, block] of Object.entries(lowered.blocks))
    {
      defineScratchRecordValue<BlockEntry>(target.blocks, blockId, block)
      createdBlockIds.push(blockId)
      const semanticPath = lowered.creationKeyByBlockId?.[blockId]
      if (semanticPath === undefined)
        procedureError(
          'edit.internal_invariant',
          `lowered call argument block ${blockId} lacks a creation key`
        )
      creationKeyByBlockId[blockId] = semanticPath
    }
    Object.assign(aliasBlockIds, lowered.aliasBlockIds)
    const root = blockEntry(target, lowered.rootId)
    Object.assign(root, { parent: callBlockId, topLevel: false })
    // a boolean slot carries the reporter alone; only a round slot keeps an
    // obscured shadow behind the block it holds
    nextInput =
      encoding.inputShape === 'boolean'
        ? [2, lowered.rootId]
        : [3, lowered.rootId, [encoding.literalPrimitiveTag, '']]
  }
  else
  {
    return procedureError(
      'edit.invalid_shape',
      `call argument value kind ${operation.value.valueKind} is not authorable`
    )
  }
  call.inputs ??= Object.create(null) as Record<string, BlockInput>
  defineScratchRecordValue<BlockInput>(call.inputs, argumentId, nextInput)
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    proccode: record.proccode,
    definitionBlockId: record.definitionBlockId,
    prototypeBlockId: record.prototypeBlockId,
    createdBlockIds: Object.freeze([...createdBlockIds].sort()),
    removedBlockIds: Object.freeze([...removedBlockIds].sort()),
    removedCommentIds: Object.freeze([]),
    argumentIdByLocalKey: Object.freeze({}),
    argumentOrdinalById: Object.freeze({}),
    aliasBlockIds: Object.freeze(aliasBlockIds),
    creationKeyByBlockId: Object.freeze(creationKeyByBlockId),
    callSiteBlockIds: Object.freeze([callBlockId]),
    exactPaths: Object.freeze([
      `/targets/${targetIndex}/blocks/${callBlockId}/inputs/${argumentId}`,
    ]),
  }
}

interface ExistingParameterSlotV1
{
  readonly ordinal: number
  readonly argumentId: string
  readonly name: string
}

// a parameter ref addresses its slot by ordinal in the CURRENT signature; the
// serialized argument id is derived here, never supplied by the caller
function existingParameterSlotV1(
  record: ProcedureRecordV1,
  reference: ParameterRefV1,
  role: string
): ExistingParameterSlotV1
{
  const ordinal =
    reference.refKind === 'structural' &&
    reference.selectorKind === 'exactLocation'
      ? reference.location.ordinal
      : undefined
  if (typeof ordinal !== 'number')
    procedureError(
      'edit.selector_no_match',
      `${role} has no exact parameter ordinal`
    )
  const argumentId = record.argumentIds[ordinal]
  const name = record.argumentNames[ordinal]
  if (typeof argumentId !== 'string' || typeof name !== 'string')
    procedureError(
      'edit.selector_no_match',
      `${role} ordinal ${ordinal} is outside the current signature`
    )
  return { ordinal, argumentId, name }
}

// a block carries at most one attached comment, so a reporter's comment set is
// either empty or exactly its own comment id
function attachedCommentIdsV1(block: Block): readonly string[]
{
  return typeof block.comment === 'string'
    ? Object.freeze([block.comment])
    : Object.freeze([])
}

function resolvedCommentIdsV1(
  project: ProjectIR,
  comments: readonly CommentRefV1[]
): readonly string[]
{
  return Object.freeze(
    comments.map(
      (reference) => resolveCommentRefV1(project, reference).commentId
    )
  )
}

// an explicit disposition names the exact attached set; anything else would
// dangle a comment or delete one the caller never saw
function assertExactCommentSetV1(
  actual: readonly string[],
  named: readonly string[],
  role: string
): void
{
  const namedSet = new Set(named)
  if (
    namedSet.size !== named.length ||
    namedSet.size !== actual.length ||
    actual.some((commentId) => !namedSet.has(commentId))
  )
    procedureError(
      'edit.cardinality_mismatch',
      `${role} does not name the exact attached comment set`
    )
}

function applyCommentRemovalV1(
  project: ProjectIR,
  target: Target,
  disposition: CommentRemovalDispositionV1,
  attached: readonly string[],
  role: string
): readonly string[]
{
  if (disposition.kind === 'rejectIfPresent')
  {
    if (attached.length > 0)
      procedureError(
        'edit.cardinality_mismatch',
        `${role} rejects the attached comments it found`
      )
    return Object.freeze([])
  }
  const commentIds = resolvedCommentIdsV1(project, disposition.comments)
  assertExactCommentSetV1(attached, commentIds, role)
  deleteExactCommentsV1(target, commentIds)
  return commentIds
}

// reattachment re-points the comment record at the replacement block & drops
// the outgoing link on the block it left, so neither side keeps a stale edge
function reattachExactCommentsV1(
  target: Target,
  commentIds: readonly string[],
  newBlockId: string,
  role: string
): string | null
{
  if (commentIds.length > 1)
    procedureError(
      'edit.cardinality_mismatch',
      `${role} reattaches more than one comment to a single block`
    )
  const commentId = commentIds[0]
  if (commentId === undefined) return null
  const comment = scratchRecordValue(target.comments, commentId)
  if (!comment)
    procedureError('edit.selector_no_match', `comment ${commentId} is absent`)
  if (typeof comment.blockId === 'string')
    delete (blockEntry(target, comment.blockId) as { comment?: string }).comment
  comment.blockId = newBlockId
  return commentId
}

interface PrototypeReporterCommentOutcomeV1
{
  readonly removedCommentIds: readonly string[]
  readonly reattachedCommentId: string | null
}

function applyPrototypeReporterCommentsV1(
  project: ProjectIR,
  target: Target,
  disposition: PrototypeReporterCommentDispositionV1,
  attached: readonly string[],
  newReporterBlockId: string,
  role: string
): PrototypeReporterCommentOutcomeV1
{
  if (disposition.kind !== 'reattachExactToParameterReporter')
    return {
      removedCommentIds: applyCommentRemovalV1(
        project,
        target,
        disposition,
        attached,
        role
      ),
      reattachedCommentId: null,
    }
  const commentIds = resolvedCommentIdsV1(project, disposition.comments)
  assertExactCommentSetV1(attached, commentIds, role)
  return {
    removedCommentIds: Object.freeze([]),
    reattachedCommentId: reattachExactCommentsV1(
      target,
      commentIds,
      newReporterBlockId,
      role
    ),
  }
}

interface OwnedCallInputDisposalV1
{
  readonly removedBlockIds: readonly string[]
  readonly removedCommentIds: readonly string[]
}

// deletion is never inferred from signature shape: an owned call input goes
// away only when the disposition proves the exact closure it is deleting
function disposeOwnedCallInputV1(
  project: ProjectIR,
  target: Target,
  replacement: OwnedInputReplacementV1,
  current: BlockInput | undefined,
  aliasBlockIds: Readonly<Record<string, string>>,
  role: string
): OwnedCallInputDisposalV1
{
  const owned = current?.[1]
  if (replacement.kind === 'requireNoOwnedBlock')
  {
    if (typeof owned === 'string')
      procedureError(
        'edit.invalid_shape',
        `${role} owns a block but the disposition requires none`
      )
    return {
      removedBlockIds: Object.freeze([]),
      removedCommentIds: Object.freeze([]),
    }
  }
  if (typeof owned !== 'string')
    procedureError(
      'edit.selector_no_match',
      `${role} has no owned closure to delete`
    )
  const plan = planGraphClosureV1(target, 'ownedBlock', owned)
  if (plan.orderedBlockIds.length !== replacement.expectedOwnedBlockCount)
    procedureError(
      'edit.cardinality_mismatch',
      `${role} owned block count differs from the planned closure`
    )
  if (plan.closureSha256 !== replacement.expectedClosureSha256)
    procedureError(
      'edit.fingerprint_mismatch',
      `${role} owned closure hash differs`
    )
  const removedCommentIds =
    replacement.comments.kind === 'reattachExact'
      ? reattachClosureCommentsV1(
          project,
          target,
          replacement.comments.mappings,
          plan.attachedCommentIds,
          aliasBlockIds,
          role
        )
      : applyCommentRemovalV1(
          project,
          target,
          replacement.comments,
          plan.attachedCommentIds,
          role
        )
  for (const blockId of plan.orderedBlockIds)
    deleteScratchRecordValue(target.blocks, blockId)
  return {
    removedBlockIds: Object.freeze([...plan.orderedBlockIds]),
    removedCommentIds,
  }
}

// a reattachment target is named by a declared alias of the replacement value,
// never by a raw block id the caller invented
function reattachClosureCommentsV1(
  project: ProjectIR,
  target: Target,
  mappings: readonly {
    readonly comment: CommentRefV1
    readonly newBlockAlias: string
  }[],
  attached: readonly string[],
  aliasBlockIds: Readonly<Record<string, string>>,
  role: string
): readonly string[]
{
  const named = mappings.map(
    (mapping) => resolveCommentRefV1(project, mapping.comment).commentId
  )
  assertExactCommentSetV1(attached, named, role)
  for (const [index, mapping] of mappings.entries())
  {
    const newBlockId = aliasBlockIds[mapping.newBlockAlias]
    if (typeof newBlockId !== 'string')
      procedureError(
        'edit.selector_no_match',
        `${role} reattaches to undeclared block alias ${mapping.newBlockAlias}`
      )
    reattachExactCommentsV1(target, [named[index]!], newBlockId, role)
  }
  return Object.freeze([])
}

interface LoweredCallArgumentV1
{
  readonly input: BlockInput
  readonly createdBlockIds: readonly string[]
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
}

const EMPTY_LOWERED_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  {}
)

// a boolean call slot has no literal primitive in sb3, so an empty %b argument
// is left genuinely empty rather than filled w/ a text shadow
function lowerCallArgumentValueV1(
  project: ProjectIR,
  targetIndex: number,
  target: Target,
  callBlockId: string,
  parameter: ProcedureSignatureParameterV1,
  value: SemanticInputValueV1,
  adapters: ProcedureOperationCatalogAdapterV1
): LoweredCallArgumentV1
{
  const encoding =
    PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameter.parameterType]
  if (value.valueKind === 'empty')
    return {
      input:
        encoding.inputShape === 'boolean'
          ? [1]
          : [1, [encoding.literalPrimitiveTag, '']],
      createdBlockIds: Object.freeze([]),
      aliasBlockIds: EMPTY_LOWERED_ALIASES,
      creationKeyByBlockId: Object.freeze({}),
    }
  if (value.valueKind === 'literal')
  {
    if (encoding.literalValueMode === 'unsupported')
      procedureError(
        'edit.invalid_shape',
        'a boolean call argument has no literal primitive'
      )
    // a %n literal keeps a numeric value verbatim; anything else stringifies
    const literal =
      encoding.literalValueMode === 'preserveNumber' &&
      typeof value.value === 'number'
        ? value.value
        : String(value.value)
    return {
      input: [1, [encoding.literalPrimitiveTag, literal]],
      createdBlockIds: Object.freeze([]),
      aliasBlockIds: EMPTY_LOWERED_ALIASES,
      creationKeyByBlockId: Object.freeze({}),
    }
  }
  if (value.valueKind !== 'block')
    procedureError(
      'edit.invalid_shape',
      `call argument value kind ${value.valueKind} is not authorable here`
    )
  const lowered = adapters.lowerStatementSequence(project, targetIndex, {
    blocks: [
      value.value as unknown as SemanticStatementSequenceV1['blocks'][number],
    ],
  } as SemanticStatementSequenceV1)
  commitGraphAllocatorV1(project.uids, lowered)
  const createdBlockIds: string[] = []
  const creationKeyByBlockId: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  for (const [blockId, block] of Object.entries(lowered.blocks))
  {
    defineScratchRecordValue<BlockEntry>(target.blocks, blockId, block)
    createdBlockIds.push(blockId)
    creationKeyByBlockId[blockId] =
      `procedure/call-argument/${lowered.creationKeyByBlockId?.[blockId] ?? blockId}`
  }
  const root = blockEntry(target, lowered.rootId)
  Object.assign(root, { parent: callBlockId, topLevel: false })
  delete (root as { x?: number }).x
  delete (root as { y?: number }).y
  return {
    input:
      encoding.inputShape === 'boolean'
        ? [2, lowered.rootId]
        : [3, lowered.rootId, [encoding.literalPrimitiveTag, '']],
    createdBlockIds: Object.freeze(createdBlockIds),
    aliasBlockIds: Object.freeze({ ...lowered.aliasBlockIds }),
    creationKeyByBlockId: Object.freeze(creationKeyByBlockId),
  }
}

function assertCallInputFingerprintV1(
  targetIndex: number,
  callBlockId: string,
  argumentId: string,
  current: BlockInput | undefined,
  expected: string,
  role: string
): void
{
  if (
    blockInputFingerprintV1(targetIndex, callBlockId, argumentId, current) !==
    expected
  )
    procedureError(
      'edit.fingerprint_mismatch',
      `${role} input fingerprint differs`
    )
}

// the argument reporters that read a parameter inside the procedure body; the
// prototype's own shadow reporters are excluded because prototypeReporters
// disposes those separately
function bodyArgumentReporterIdsByNameV1(
  target: Target,
  bodyBlockIds: readonly string[]
): ReadonlyMap<string, readonly string[]>
{
  const byName = new Map<string, string[]>()
  for (const blockId of bodyBlockIds)
  {
    const entry = scratchRecordValue(target.blocks, blockId)
    if (!entry || Array.isArray(entry)) continue
    const block = entry as Block
    if (
      block.opcode !== 'argument_reporter_string_number' &&
      block.opcode !== 'argument_reporter_boolean'
    )
      continue
    const name = scratchRecordValue(block.fields, 'VALUE')?.[0]
    if (typeof name !== 'string') continue
    const bucket = byName.get(name)
    if (bucket) bucket.push(blockId)
    else byName.set(name, [blockId])
  }
  return byName
}

function applyProcedureUpdateSignature(
  project: ProjectIR,
  resolved: Extract<
    ResolvedProcedureOperationV1,
    { operation: SemanticEditOperationProcedureUpdateSignatureV1 }
  >,
  adapters: ProcedureOperationCatalogAdapterV1
): AppliedProcedureOperationV1
{
  const { operation, targetIndex, record } = resolved
  const target = targetAt(project, targetIndex)
  const decoded = canonicalProcedureSignatureV1(operation.signature)
  const candidate = project.uids.clone()
  const parameterByLocalKey = new Map(
    decoded.parameters.map((parameter) => [parameter.localKey, parameter])
  )
  const mappedParameter = (
    localKey: string,
    role: string
  ): ProcedureSignatureParameterV1 =>
  {
    const parameter = parameterByLocalKey.get(localKey)
    if (!parameter)
      procedureError(
        'edit.selector_no_match',
        `${role} names unknown new-signature parameter ${localKey}`
      )
    return parameter
  }
  // retained parameters keep their existing argument id so every call input key
  // & every argument reporter stays bound; created parameters allocate fresh
  const argumentIdByLocalKey: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  for (const entry of operation.parameterLineage)
  {
    if (entry.lineage.kind !== 'retain') continue
    argumentIdByLocalKey[entry.parameterLocalKey] = existingParameterSlotV1(
      record,
      entry.lineage.existingParameter,
      `retained parameter ${entry.parameterLocalKey}`
    ).argumentId
  }
  for (const parameter of decoded.parameters)
  {
    if (argumentIdByLocalKey[parameter.localKey]) continue
    argumentIdByLocalKey[parameter.localKey] = allocate(candidate, 'p')
  }
  const createdBlockIds: string[] = []
  const removedBlockIds: string[] = []
  const removedCommentIds: string[] = []
  const exactPaths: string[] = [
    `/targets/${targetIndex}/blocks/${record.prototypeBlockId}/mutation`,
  ]
  const creationKeyByBlockId: Record<string, string> = Object.create(
    null
  ) as Record<string, string>
  const aliasBlockIds: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >
  // the pre-mutation prototype inventory: every old argument id & the exact
  // shadow reporter it owns, read before anything is rewritten
  const prototype = blockEntry(target, record.prototypeBlockId)
  const oldReporterIdByArgumentId = new Map<string, string>()
  for (const [argumentId, input] of Object.entries(prototype.inputs ?? {}))
  {
    const reporterId = (input as BlockInput)[1]
    if (typeof reporterId === 'string')
      oldReporterIdByArgumentId.set(argumentId, reporterId)
  }
  const prototypeOwnedBlockIds = new Set<string>([
    record.definitionBlockId,
    record.prototypeBlockId,
    ...oldReporterIdByArgumentId.values(),
  ])
  const bodyBlockIds = procedureOwnedBlockIdsV1(
    target,
    record.definitionBlockId
  ).filter((blockId) => !prototypeOwnedBlockIds.has(blockId))
  const bodyReportersByName = bodyArgumentReporterIdsByNameV1(
    target,
    bodyBlockIds
  )
  // every mapped call is addressed by its own reference, never by position, &
  // must be one of the exact call sites the transaction already bound
  const boundCallSiteBlockIds = new Set(resolved.callSiteBlockIds)
  const mappedCalls = operation.callSites.map((mapping) =>
  {
    const blockId = resolveBlockRefV1(project, mapping.call).blockId
    if (!boundCallSiteBlockIds.has(blockId))
      procedureError(
        'edit.selector_no_match',
        `mapped call ${blockId} is not one of the bound call sites`
      )
    return { mapping, blockId }
  })
  if (
    new Set(mappedCalls.map((call) => call.blockId)).size !==
    boundCallSiteBlockIds.size
  )
    procedureError(
      'edit.cardinality_mismatch',
      'call mappings do not cover the exact bound call set once each'
    )
  // bodyParameterReporters is applied against the pre-rewrite names, so a
  // removed parameter's final count is exactly what remains of its own
  // reporters after the caller's earlier block removals
  const bodyRenameByOldName = new Map<string, string>()
  for (const mapping of operation.bodyParameterReporters)
  {
    const slot = existingParameterSlotV1(
      record,
      mapping.existingParameter,
      'body reporter mapping'
    )
    const reporters = bodyReportersByName.get(slot.name) ?? []
    if (mapping.disposition.kind === 'requireFinalZero')
    {
      if (reporters.length !== mapping.disposition.requireFinalReporterCount)
        procedureError(
          'edit.cardinality_mismatch',
          `removed parameter ${slot.name} still has ${reporters.length} body reporters`
        )
      continue
    }
    const parameter = mappedParameter(
      mapping.disposition.parameterLocalKey,
      'body reporter disposition'
    )
    // the gate is the reporter opcode, so it only refuses across the boolean
    // boundary; a %s <-> %n flip keeps its reporters because they are the block
    const expectedOpcode =
      PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameter.parameterType]
        .reporterOpcode
    for (const reporterId of reporters)
      if (blockEntry(target, reporterId).opcode !== expectedOpcode)
        procedureError(
          'edit.invalid_shape',
          `body reporter ${reporterId} cannot survive the parameter type change`
        )
    const prior = bodyRenameByOldName.get(slot.name)
    if (prior !== undefined && prior !== parameter.name)
      procedureError(
        'edit.invalid_shape',
        `body reporters named ${slot.name} map to two different new names`
      )
    bodyRenameByOldName.set(slot.name, parameter.name)
  }
  // the rewrite reads the pre-computed buckets, so a name swap between two
  // retained parameters can never rewrite the same reporter twice
  for (const [oldName, newName] of bodyRenameByOldName)
  {
    if (oldName === newName) continue
    for (const reporterId of bodyReportersByName.get(oldName) ?? [])
    {
      const reporter = blockEntry(target, reporterId)
      reporter.fields ??= Object.create(null) as Record<string, BlockField>
      defineScratchRecordValue<BlockField>(reporter.fields, 'VALUE', [
        newName,
        null,
      ])
      exactPaths.push(
        `/targets/${targetIndex}/blocks/${reporterId}/fields/VALUE`
      )
    }
  }
  // prototypeReporters is the only authority for keeping, swapping, or deleting
  // an existing prototype reporter & its comments
  const preservedReporterIdByLocalKey = new Map<string, string>()
  const replacementReporterIdByLocalKey = new Map<string, string>()
  const reattachedCommentIdByLocalKey = new Map<string, string>()
  const disposedReporterIds: string[] = []
  const mappedOldArgumentIds = new Set<string>()
  for (const mapping of operation.prototypeReporters)
  {
    const slot = existingParameterSlotV1(
      record,
      mapping.existingParameter,
      'prototype reporter mapping'
    )
    if (mappedOldArgumentIds.has(slot.argumentId))
      procedureError(
        'edit.cardinality_mismatch',
        `prototype reporter for ordinal ${slot.ordinal} is mapped more than once`
      )
    mappedOldArgumentIds.add(slot.argumentId)
    const reporterId = oldReporterIdByArgumentId.get(slot.argumentId)
    if (reporterId === undefined)
      procedureError(
        'edit.selector_no_match',
        `prototype owns no reporter for parameter ordinal ${slot.ordinal}`
      )
    const reporter = blockEntry(target, reporterId)
    const attached = attachedCommentIdsV1(reporter)
    const role = `prototype reporter ${reporterId} disposition`
    if (mapping.disposition.kind === 'preserveExisting')
    {
      const parameter = mappedParameter(
        mapping.disposition.parameterLocalKey,
        role
      )
      // type-incompatible preservation refuses: a round slot never keeps a %b
      // reporter & vice versa; %s <-> %n shares one opcode & so survives
      if (
        reporter.opcode !==
        PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameter.parameterType]
          .reporterOpcode
      )
        procedureError(
          'edit.invalid_shape',
          `parameter ${parameter.localKey} changed type & cannot preserve its reporter`
        )
      if (
        commentSetSha256V1(target, attached) !==
        mapping.disposition.expectedCommentSetSha256
      )
        procedureError(
          'edit.fingerprint_mismatch',
          `${role} comment set differs`
        )
      if (preservedReporterIdByLocalKey.has(parameter.localKey))
        procedureError(
          'edit.cardinality_mismatch',
          `parameter ${parameter.localKey} is preserved by more than one reporter`
        )
      preservedReporterIdByLocalKey.set(parameter.localKey, reporterId)
      continue
    }
    if (mapping.disposition.kind === 'remove')
    {
      removedCommentIds.push(
        ...applyCommentRemovalV1(
          project,
          target,
          mapping.disposition.comments,
          attached,
          role
        )
      )
      disposedReporterIds.push(reporterId)
      continue
    }
    const parameter = mappedParameter(
      mapping.disposition.parameterLocalKey,
      role
    )
    if (replacementReporterIdByLocalKey.has(parameter.localKey))
      procedureError(
        'edit.cardinality_mismatch',
        `parameter ${parameter.localKey} is replaced by more than one reporter`
      )
    // the replacement is a builder-owned fixed result slot keyed by local key,
    // so a reattachment target is never a raw id the caller invented
    const replacementReporterId = allocate(candidate, 'b')
    replacementReporterIdByLocalKey.set(
      parameter.localKey,
      replacementReporterId
    )
    const outcome = applyPrototypeReporterCommentsV1(
      project,
      target,
      mapping.disposition.comments,
      attached,
      replacementReporterId,
      role
    )
    removedCommentIds.push(...outcome.removedCommentIds)
    if (outcome.reattachedCommentId !== null)
      reattachedCommentIdByLocalKey.set(
        parameter.localKey,
        outcome.reattachedCommentId
      )
    disposedReporterIds.push(reporterId)
  }
  for (const argumentId of oldReporterIdByArgumentId.keys())
    if (!mappedOldArgumentIds.has(argumentId))
      procedureError(
        'edit.cardinality_mismatch',
        'prototypeReporters does not cover every existing prototype reporter'
      )
  // rebuild the prototype input map so parameter order is the signature order
  const nextInputs: [string, BlockInput][] = []
  for (const parameter of decoded.parameters)
  {
    const argumentId = argumentIdByLocalKey[parameter.localKey]!
    const preservedReporterId = preservedReporterIdByLocalKey.get(
      parameter.localKey
    )
    if (preservedReporterId !== undefined)
    {
      if (replacementReporterIdByLocalKey.has(parameter.localKey))
        procedureError(
          'edit.cardinality_mismatch',
          `parameter ${parameter.localKey} is both preserved & replaced`
        )
      const reporter = blockEntry(target, preservedReporterId)
      reporter.fields ??= Object.create(null) as Record<string, BlockField>
      defineScratchRecordValue<BlockField>(reporter.fields, 'VALUE', [
        parameter.name,
        null,
      ])
      nextInputs.push([argumentId, [1, preservedReporterId]])
      aliasBlockIds[parameter.localKey] = preservedReporterId
      continue
    }
    const reporterBlockId =
      replacementReporterIdByLocalKey.get(parameter.localKey) ??
      allocate(candidate, 'b')
    createdBlockIds.push(reporterBlockId)
    creationKeyByBlockId[reporterBlockId] = parameterReporterCreationKey(
      parameter.localKey
    )
    aliasBlockIds[parameter.localKey] = reporterBlockId
    const reporter = Object.assign(Object.create(null) as Block, {
      opcode:
        PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameter.parameterType]
          .reporterOpcode,
      next: null,
      parent: record.prototypeBlockId,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<[string, string | null]>([
        ['VALUE', [parameter.name, null]],
      ]) as Block['fields'],
      shadow: true,
      topLevel: false,
    })
    const reattachedCommentId = reattachedCommentIdByLocalKey.get(
      parameter.localKey
    )
    if (reattachedCommentId !== undefined)
      reporter.comment = reattachedCommentId
    defineScratchRecordValue<BlockEntry>(
      target.blocks,
      reporterBlockId,
      reporter
    )
    nextInputs.push([argumentId, [1, reporterBlockId]])
  }
  for (const localKey of replacementReporterIdByLocalKey.keys())
    if (!Object.hasOwn(aliasBlockIds, localKey))
      procedureError(
        'edit.internal_invariant',
        `replacement reporter for ${localKey} was never installed`
      )
  for (const reporterId of disposedReporterIds)
  {
    deleteScratchRecordValue(target.blocks, reporterId)
    removedBlockIds.push(reporterId)
  }
  Object.assign(prototype, {
    inputs: createScratchRecord<BlockInput>(nextInputs),
    mutation: procedurePrototypeMutationV1({
      proccode: decoded.proccode,
      argumentIds: decoded.parameters.map(
        (parameter) => argumentIdByLocalKey[parameter.localKey]!
      ),
      argumentNames: decoded.parameters.map((parameter) => parameter.name),
      argumentDefaults: decoded.parameters.map(serializedDefault),
      warp: decoded.warp,
    }),
  })
  // own allocations are committed before any lowering so the catalog adapter's
  // own clone of the allocator cannot hand back an id this pass already used
  project.uids.commit(candidate)
  // every call site migrates by its explicit per-argument disposition; nothing
  // is inferred from the shape of the old & new signatures
  const callSiteBlockIds: string[] = []
  for (const mapped of mappedCalls)
  {
    const callBlockId = mapped.blockId
    const call = blockEntry(target, callBlockId)
    if (call.opcode !== 'procedures_call')
      procedureError(
        'edit.invalid_shape',
        `block ${callBlockId} is not a procedures_call`
      )
    if (call.mutation?.proccode !== record.proccode)
      procedureError(
        'edit.selector_no_match',
        `call ${callBlockId} does not dispatch to the selected procedure`
      )
    const priorArgumentIds = Object.keys(call.inputs ?? {})
    const sourceByLocalKey = new Map(
      mapped.mapping.arguments.map((entry) => [
        entry.parameterLocalKey,
        entry.source,
      ])
    )
    const consumedArgumentIds = new Set<string>()
    const nextCallInputs: [string, BlockInput][] = []
    for (const parameter of decoded.parameters)
    {
      const newArgumentId = argumentIdByLocalKey[parameter.localKey]!
      const source = sourceByLocalKey.get(parameter.localKey)
      if (!source)
        procedureError(
          'edit.cardinality_mismatch',
          `call ${callBlockId} has no argument mapping for ${parameter.localKey}`
        )
      if (source.kind === 'initializeNewParameter')
      {
        const lowered = lowerCallArgumentValueV1(
          project,
          targetIndex,
          target,
          callBlockId,
          parameter,
          source.value,
          adapters
        )
        createdBlockIds.push(...lowered.createdBlockIds)
        Object.assign(creationKeyByBlockId, lowered.creationKeyByBlockId)
        Object.assign(aliasBlockIds, lowered.aliasBlockIds)
        nextCallInputs.push([newArgumentId, lowered.input])
        continue
      }
      const slot = existingParameterSlotV1(
        record,
        source.existingParameter,
        `call ${callBlockId} argument ${parameter.localKey}`
      )
      const role = `call ${callBlockId} argument ${slot.name}`
      const current = scratchRecordValue(call.inputs, slot.argumentId)
      assertCallInputFingerprintV1(
        targetIndex,
        callBlockId,
        slot.argumentId,
        current,
        source.expectedInputFingerprint,
        role
      )
      consumedArgumentIds.add(slot.argumentId)
      if (source.kind === 'preserveParameter')
      {
        // a preserved argument binds the exact prior input, including a slot
        // the source genuinely left empty
        if (current !== undefined) nextCallInputs.push([newArgumentId, current])
        continue
      }
      const lowered = lowerCallArgumentValueV1(
        project,
        targetIndex,
        target,
        callBlockId,
        parameter,
        source.value,
        adapters
      )
      createdBlockIds.push(...lowered.createdBlockIds)
      Object.assign(creationKeyByBlockId, lowered.creationKeyByBlockId)
      Object.assign(aliasBlockIds, lowered.aliasBlockIds)
      const disposal = disposeOwnedCallInputV1(
        project,
        target,
        source.replacedInput,
        current,
        lowered.aliasBlockIds,
        role
      )
      removedBlockIds.push(...disposal.removedBlockIds)
      removedCommentIds.push(...disposal.removedCommentIds)
      nextCallInputs.push([newArgumentId, lowered.input])
    }
    for (const removed of mapped.mapping.removedArguments)
    {
      const slot = existingParameterSlotV1(
        record,
        removed.existingParameter,
        `call ${callBlockId} removed argument`
      )
      const role = `call ${callBlockId} removed argument ${slot.name}`
      const current = scratchRecordValue(call.inputs, slot.argumentId)
      assertCallInputFingerprintV1(
        targetIndex,
        callBlockId,
        slot.argumentId,
        current,
        removed.expectedInputFingerprint,
        role
      )
      consumedArgumentIds.add(slot.argumentId)
      const disposal = disposeOwnedCallInputV1(
        project,
        target,
        removed.removedInput,
        current,
        EMPTY_LOWERED_ALIASES,
        role
      )
      removedBlockIds.push(...disposal.removedBlockIds)
      removedCommentIds.push(...disposal.removedCommentIds)
    }
    // an unexplained prior slot is refused rather than dropped, so no owned
    // block ever leaves this transaction without a disposition that named it
    for (const argumentId of priorArgumentIds)
      if (!consumedArgumentIds.has(argumentId))
        procedureError(
          'edit.cardinality_mismatch',
          `call ${callBlockId} input ${argumentId} has no disposition`
        )
    Object.assign(call, {
      inputs: createScratchRecord<BlockInput>(nextCallInputs),
      mutation: procedureCallMutationV1({
        proccode: decoded.proccode,
        argumentIds: decoded.parameters.map(
          (parameter) => argumentIdByLocalKey[parameter.localKey]!
        ),
        argumentNames: [],
        argumentDefaults: [],
        warp: decoded.warp,
      }),
    })
    callSiteBlockIds.push(callBlockId)
    exactPaths.push(
      `/targets/${targetIndex}/blocks/${callBlockId}/mutation`,
      `/targets/${targetIndex}/blocks/${callBlockId}/inputs`
    )
  }
  // the rewrite also moves the prototype input map & every reporter block it
  // creates or disposes, so those paths are part of what it authorizes
  exactPaths.push(
    `/targets/${targetIndex}/blocks/${record.prototypeBlockId}/inputs`
  )
  for (const blockId of [...createdBlockIds, ...removedBlockIds])
    exactPaths.push(`/targets/${targetIndex}/blocks/${blockId}`)
  const argumentOrdinalById: Record<string, number> = Object.create(
    null
  ) as Record<string, number>
  for (const [ordinal, parameter] of decoded.parameters.entries())
    argumentOrdinalById[argumentIdByLocalKey[parameter.localKey]!] = ordinal
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    proccode: decoded.proccode,
    definitionBlockId: record.definitionBlockId,
    prototypeBlockId: record.prototypeBlockId,
    createdBlockIds: Object.freeze([...new Set(createdBlockIds)].sort()),
    removedBlockIds: Object.freeze([...new Set(removedBlockIds)].sort()),
    removedCommentIds: Object.freeze([...new Set(removedCommentIds)].sort()),
    argumentIdByLocalKey: Object.freeze(argumentIdByLocalKey),
    argumentOrdinalById: Object.freeze(argumentOrdinalById),
    aliasBlockIds: Object.freeze(aliasBlockIds),
    creationKeyByBlockId: Object.freeze(creationKeyByBlockId),
    callSiteBlockIds: Object.freeze([...callSiteBlockIds].sort()),
    exactPaths: Object.freeze([...new Set(exactPaths)].sort()),
  }
}
