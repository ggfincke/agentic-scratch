// packages/ir/src/repair/repair-ops.ts
// apply guarded semantic patches to isolated projects & enforce actual impact

import { createHash } from 'node:crypto'

import {
  defineScratchRecordValue,
  hasScratchRecordKey,
  isBlockEntry,
  scratchRecordEntries,
  scratchRecordValue,
  type Block,
  type BlockEntry,
  type BlockField,
  type BroadcastPrimitive,
  type Target,
  type VarPrimitive,
} from '@scratch-agent/sb3'

import { canInsertStatementsAfter, deleteStatement } from './edit-graph.js'
import {
  checkPreservation,
  createPreservationManifest,
  type PreservationResult,
} from '../project/preservation.js'
import {
  computeProjectDelta,
  type DeltaBlockAttribution,
  type DeltaOperationAttribution,
  type ProjectDelta,
} from '../project/project-delta.js'
import {
  jsonPointerPart,
  projectTargetIdentity,
} from '../project/project-vocabulary.js'
import { ProjectIR } from '../project/project-ir.js'
import {
  literalPrimitive,
  lowerRepairScript,
  lowerRepairStatements,
} from './repair-blocks.js'
import { parseSemanticPatch } from './repair-schema.js'
import { REPAIR_LITERAL_KINDS_BY_TAG } from './repair-literal-catalog.js'
import {
  DEFAULT_REPAIR_IMPACT_LIMITS,
  DEFAULT_REPAIR_INTENT_LIMITS,
  DEFAULT_REPAIR_PRESERVATION_POLICY,
  type BlockRef,
  type BroadcastRef,
  type DeclarationRef,
  type RepairImpactLimits,
  type RepairIntentLimits,
  type RepairLiteral,
  type RepairOp,
  type RepairPreservationPolicy,
  type RepairTransactionOptions,
  type RepairViolation,
  type SemanticPatch,
  type TargetRef,
  type VariableRef,
} from './repair-types.js'
import {
  isTargetPropertyValue,
  TARGET_PROPERTY_DESCRIPTORS,
  type TargetProperty,
} from '../project/target-properties.js'

interface AppliedCandidateArtifact
{
  patch: SemanticPatch
  baselineArtifactSha256: string
  candidateArtifactSha256: string
  candidateBytes: Uint8Array
  candidate: ProjectIR
  attribution: DeltaOperationAttribution[]
  appliedOpIds: string[]
}

interface AppliedRepairPatch extends AppliedCandidateArtifact
{
  delta: ProjectDelta
}

interface RepairPatchSuccess extends AppliedRepairPatch
{
  ok: true
  applied: true
  preservation: PreservationResult
}

interface RepairPatchRejectedCandidate extends AppliedCandidateArtifact
{
  ok: false
  applied: true
  violations: RepairViolation[]
  delta?: ProjectDelta
  preservation?: PreservationResult
}

interface RepairPatchFailure
{
  ok: false
  applied: false
  violations: RepairViolation[]
}

export type RepairPatchResult =
  RepairPatchSuccess | RepairPatchRejectedCandidate | RepairPatchFailure

interface AppliedOperation
{
  attribution: DeltaOperationAttribution
}

class OperationError extends Error
{
  constructor(readonly violation: RepairViolation)
  {
    super(violation.message)
  }
}

function internalInvariantFailure(error: unknown): RepairPatchFailure
{
  return {
    ok: false,
    applied: false,
    violations: [
      {
        code: 'internal-invariant',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  }
}

const COMPATIBLE_OPCODE_GROUPS = [
  [
    'operator_add',
    'operator_subtract',
    'operator_multiply',
    'operator_divide',
    'operator_mod',
  ],
  ['operator_gt', 'operator_lt', 'operator_equals'],
  ['operator_and', 'operator_or'],
] as const

const VARIABLE_FIELD_SITES = new Set([
  'data_setvariableto\u0000VARIABLE',
  'data_changevariableby\u0000VARIABLE',
  'data_showvariable\u0000VARIABLE',
  'data_hidevariable\u0000VARIABLE',
])

const BROADCAST_FIELD_SITES = new Set([
  'event_whenbroadcastreceived\u0000BROADCAST_OPTION',
])

const BROADCAST_INPUT_SITES = new Set([
  'event_broadcast\u0000BROADCAST_INPUT',
  'event_broadcastandwait\u0000BROADCAST_INPUT',
])

function hashBytes(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function pointerPath(...segments: string[]): string
{
  return `/${segments.map(jsonPointerPart).join('/')}`
}

function attributedBlock(
  targetIndex: number,
  blockId: string,
  relativePaths?: readonly string[]
): DeltaBlockAttribution
{
  return {
    targetIndex,
    blockId,
    ...(relativePaths ? { relativePaths } : {}),
  }
}

export async function projectArtifactSha256(
  project: ProjectIR
): Promise<string>
{
  return hashBytes(await project.toSb3())
}

export function cloneProjectForRepair(project: ProjectIR): ProjectIR
{
  return ProjectIR.fromProjectJson(
    structuredClone(project.json),
    project.assets.map((asset) => ({
      path: asset.path,
      bytes: Uint8Array.from(asset.bytes),
    }))
  )
}

function operationError(
  code: RepairViolation['code'],
  message: string,
  op: RepairOp,
  location?: BlockRef | TargetRef
): never
{
  throw new OperationError({
    code,
    message,
    opId: op.opId,
    ...(location ? { location } : {}),
  })
}

function resolveTarget(
  project: ProjectIR,
  reference: TargetRef,
  op: RepairOp
): Target
{
  const target = project.json.targets[reference.targetIndex]
  if (!target)
  {
    operationError(
      'target-not-found',
      `target index ${reference.targetIndex} does not exist`,
      op,
      reference
    )
  }
  if (target.name !== reference.name || target.isStage !== reference.isStage)
  {
    operationError(
      'target-mismatch',
      `target ${reference.targetIndex} does not match ${reference.name}/${reference.isStage}`,
      op,
      reference
    )
  }
  return target
}

function resolveExistingBlock(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  reference: BlockRef,
  op: RepairOp
): { target: Target; block: Block }
{
  const scopedId = `${reference.target.targetIndex}\u0000${reference.blockId}`
  if (!baselineBlockIds.has(scopedId))
  {
    operationError(
      'block-not-found',
      `block "${reference.blockId}" is not in the immutable baseline`,
      op,
      reference
    )
  }
  const target = resolveTarget(project, reference.target, op)
  const block = scratchRecordValue(target.blocks, reference.blockId)
  if (!isBlockEntry(block))
  {
    operationError(
      'block-not-found',
      `block "${reference.blockId}" does not exist`,
      op,
      reference
    )
  }
  return { target, block }
}

function assertOpcode(
  block: Block,
  expected: string,
  op: RepairOp,
  reference: BlockRef
): void
{
  if (block.opcode !== expected)
  {
    operationError(
      'opcode-mismatch',
      `block "${reference.blockId}" is ${block.opcode}, expected ${expected}`,
      op,
      reference
    )
  }
}

function targetMatches(a: TargetRef, b: TargetRef): boolean
{
  return (
    a.targetIndex === b.targetIndex &&
    a.name === b.name &&
    a.isStage === b.isStage
  )
}

function declarationEntry(
  project: ProjectIR,
  reference: DeclarationRef,
  op: RepairOp
): string | undefined
{
  const target = resolveTarget(project, reference.declarationTarget, op)
  if (reference.kind === 'variable')
  {
    return scratchRecordValue(target.variables, reference.id)?.[0]
  }
  if (reference.kind === 'list')
    return scratchRecordValue(target.lists, reference.id)?.[0]
  return scratchRecordValue(target.broadcasts, reference.id)
}

function assertDeclaration(
  project: ProjectIR,
  reference: DeclarationRef,
  op: RepairOp
): void
{
  const name = declarationEntry(project, reference, op)
  if (name === undefined)
  {
    operationError(
      'declaration-not-found',
      `${reference.kind} "${reference.id}" does not exist`,
      op,
      reference.declarationTarget
    )
  }
  if (name !== reference.name)
  {
    operationError(
      'declaration-mismatch',
      `${reference.kind} "${reference.id}" is named "${name}", expected "${reference.name}"`,
      op,
      reference.declarationTarget
    )
  }
}

function literalAt(block: Block, inputName: string): RepairLiteral | undefined
{
  const input = scratchRecordValue(block.inputs, inputName)
  if (!input || input[0] !== 1 || !Array.isArray(input[1])) return undefined
  const kind = REPAIR_LITERAL_KINDS_BY_TAG[Number(input[1][0])]
  if (!kind) return undefined
  return { kind, value: input[1][1] } as RepairLiteral
}

function sameLiteral(a: RepairLiteral, b: RepairLiteral): boolean
{
  return a.kind === b.kind && Object.is(a.value, b.value)
}

function replaceLiteral(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  op: Extract<RepairOp, { kind: 'replaceLiteral' }>
): AppliedOperation
{
  const { block } = resolveExistingBlock(
    project,
    baselineBlockIds,
    op.block,
    op
  )
  assertOpcode(block, op.expectedOpcode, op, op.block)
  const current = literalAt(block, op.inputName)
  if (!current)
  {
    operationError(
      'invalid-literal-site',
      `${op.expectedOpcode}.${op.inputName} is not an active inline literal`,
      op,
      op.block
    )
  }
  if (!sameLiteral(current, op.from))
  {
    operationError(
      'literal-mismatch',
      `${op.expectedOpcode}.${op.inputName} does not match the supplied from literal`,
      op,
      op.block
    )
  }
  if (op.from.kind !== op.to.kind)
  {
    operationError(
      'invalid-literal-site',
      'literal replacement must preserve the primitive kind',
      op,
      op.block
    )
  }
  try
  {
    block.inputs![op.inputName]![1] = literalPrimitive(op.to)
  }
  catch (error)
  {
    operationError(
      'invalid-literal-site',
      error instanceof Error ? error.message : String(error),
      op,
      op.block
    )
  }
  return {
    attribution: {
      operationId: op.opId,
      blocks: [
        attributedBlock(op.block.target.targetIndex, op.block.blockId, [
          pointerPath('inputs', op.inputName, '1'),
        ]),
      ],
    },
  }
}

function compatibleOpcode(from: string, to: string): boolean
{
  if (from === to) return false
  return COMPATIBLE_OPCODE_GROUPS.some(
    (group) => group.includes(from as never) && group.includes(to as never)
  )
}

function replaceCompatibleOpcode(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  op: Extract<RepairOp, { kind: 'replaceCompatibleOpcode' }>
): AppliedOperation
{
  const { block } = resolveExistingBlock(
    project,
    baselineBlockIds,
    op.block,
    op
  )
  assertOpcode(block, op.fromOpcode, op, op.block)
  if (!compatibleOpcode(op.fromOpcode, op.toOpcode))
  {
    operationError(
      'incompatible-opcode',
      `${op.fromOpcode} cannot be replaced with ${op.toOpcode}`,
      op,
      op.block
    )
  }
  block.opcode = op.toOpcode
  return {
    attribution: {
      operationId: op.opId,
      blocks: [
        attributedBlock(op.block.target.targetIndex, op.block.blockId, [
          '/opcode',
        ]),
      ],
    },
  }
}

function sameDeclarationRef(
  primitive: readonly unknown[],
  reference: VariableRef | BroadcastRef,
  expectedTag: number
): boolean
{
  return (
    primitive[0] === expectedTag &&
    primitive[1] === reference.name &&
    primitive[2] === reference.id
  )
}

function replaceVariableReference(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  op: Extract<RepairOp, { kind: 'replaceVariableRef' }>
): AppliedOperation
{
  const { block } = resolveExistingBlock(
    project,
    baselineBlockIds,
    op.block,
    op
  )
  assertOpcode(block, op.expectedOpcode, op, op.block)
  assertDeclaration(project, op.from, op)
  assertDeclaration(project, op.to, op)
  for (const reference of [op.from, op.to])
  {
    if (
      !reference.declarationTarget.isStage &&
      !targetMatches(op.block.target, reference.declarationTarget)
    )
    {
      operationError(
        'invalid-reference-site',
        `variable "${reference.id}" is not visible from target ${op.block.target.name}`,
        op,
        op.block
      )
    }
  }
  if (op.site.container === 'field')
  {
    if (!VARIABLE_FIELD_SITES.has(`${block.opcode}\u0000${op.site.name}`))
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} is not a variable field`,
        op,
        op.block
      )
    }
    const field = scratchRecordValue(block.fields, op.site.name)
    if (!field || field[0] !== op.from.name || field[1] !== op.from.id)
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} does not match the source variable`,
        op,
        op.block
      )
    }
    defineScratchRecordValue<BlockField>(block.fields!, op.site.name, [
      op.to.name,
      op.to.id,
    ])
  }
  else
  {
    const input = scratchRecordValue(block.inputs, op.site.name)
    const primitive = input?.[1]
    if (
      !Array.isArray(primitive) ||
      !sameDeclarationRef(primitive, op.from, 12)
    )
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} is not the source variable input`,
        op,
        op.block
      )
    }
    input![1] = [12, op.to.name, op.to.id] as VarPrimitive
  }
  return {
    attribution: {
      operationId: op.opId,
      blocks: [
        attributedBlock(op.block.target.targetIndex, op.block.blockId, [
          pointerPath(
            op.site.container === 'field' ? 'fields' : 'inputs',
            op.site.name,
            ...(op.site.container === 'input' ? ['1'] : [])
          ),
        ]),
      ],
    },
  }
}

function replaceBroadcastReference(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  op: Extract<RepairOp, { kind: 'replaceBroadcastRef' }>
): AppliedOperation
{
  const { target, block } = resolveExistingBlock(
    project,
    baselineBlockIds,
    op.block,
    op
  )
  assertOpcode(block, op.expectedOpcode, op, op.block)
  assertDeclaration(project, op.from, op)
  assertDeclaration(project, op.to, op)
  const attributed: DeltaBlockAttribution[] = []
  if (op.site.container === 'field')
  {
    if (!BROADCAST_FIELD_SITES.has(`${block.opcode}\u0000${op.site.name}`))
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} is not a receiver broadcast field`,
        op,
        op.block
      )
    }
    const field = scratchRecordValue(block.fields, op.site.name)
    if (!field || field[0] !== op.from.name || field[1] !== op.from.id)
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} does not match the source broadcast`,
        op,
        op.block
      )
    }
    defineScratchRecordValue<BlockField>(block.fields!, op.site.name, [
      op.to.name,
      op.to.id,
    ])
    attributed.push(
      attributedBlock(op.block.target.targetIndex, op.block.blockId, [
        pointerPath('fields', op.site.name),
      ])
    )
  }
  else
  {
    if (!BROADCAST_INPUT_SITES.has(`${block.opcode}\u0000${op.site.name}`))
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} is not a sender broadcast input`,
        op,
        op.block
      )
    }
    const input = scratchRecordValue(block.inputs, op.site.name)
    const primary = input?.[1]
    if (Array.isArray(primary))
    {
      if (!sameDeclarationRef(primary, op.from, 11))
      {
        operationError(
          'invalid-reference-site',
          `${op.expectedOpcode}.${op.site.name} does not match the source broadcast`,
          op,
          op.block
        )
      }
      input![1] = [11, op.to.name, op.to.id] as BroadcastPrimitive
      attributed.push(
        attributedBlock(op.block.target.targetIndex, op.block.blockId, [
          pointerPath('inputs', op.site.name, '1'),
        ])
      )
    }
    else if (typeof primary === 'string')
    {
      const menu = scratchRecordValue(target.blocks, primary)
      const field = isBlockEntry(menu)
        ? scratchRecordValue(menu.fields, 'BROADCAST_OPTION')
        : undefined
      if (
        !isBlockEntry(menu) ||
        menu.shadow !== true ||
        menu.opcode !== 'event_broadcast_menu' ||
        !field ||
        field[0] !== op.from.name ||
        field[1] !== op.from.id
      )
      {
        operationError(
          'invalid-reference-site',
          `${op.expectedOpcode}.${op.site.name} is a dynamic or mismatched broadcast reporter`,
          op,
          op.block
        )
      }
      defineScratchRecordValue<BlockField>(menu.fields!, 'BROADCAST_OPTION', [
        op.to.name,
        op.to.id,
      ])
      attributed.push(
        attributedBlock(op.block.target.targetIndex, primary, [
          '/fields/BROADCAST_OPTION',
        ])
      )
    }
    else
    {
      operationError(
        'invalid-reference-site',
        `${op.expectedOpcode}.${op.site.name} has no broadcast reference`,
        op,
        op.block
      )
    }
  }
  return {
    attribution: { operationId: op.opId, blocks: attributed },
  }
}

function declarationResolver(
  project: ProjectIR,
  useTarget: TargetRef,
  op: RepairOp
): (ref: DeclarationRef) => void
{
  return (reference) =>
  {
    assertDeclaration(project, reference, op)
    if (
      (reference.kind === 'variable' || reference.kind === 'list') &&
      !reference.declarationTarget.isStage &&
      !targetMatches(useTarget, reference.declarationTarget)
    )
    {
      operationError(
        'invalid-reference-site',
        `${reference.kind} "${reference.id}" is not visible from target ${useTarget.name}`,
        op,
        useTarget
      )
    }
  }
}

function insertStatements(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  op: Extract<RepairOp, { kind: 'insertStatementsAfter' }>
): AppliedOperation
{
  const { target, block: anchor } = resolveExistingBlock(
    project,
    baselineBlockIds,
    op.anchor,
    op
  )
  assertOpcode(anchor, op.expectedOpcode, op, op.anchor)
  if (!canInsertStatementsAfter(target, op.anchor.blockId))
  {
    operationError(
      'invalid-statement',
      `block "${op.anchor.blockId}" is not a supported statement anchor`,
      op,
      op.anchor
    )
  }
  const oldSuccessorId = anchor.next ?? null
  if (oldSuccessorId !== null)
  {
    const oldSuccessor = scratchRecordValue(target.blocks, oldSuccessorId)
    if (
      !isBlockEntry(oldSuccessor) ||
      oldSuccessor.parent !== op.anchor.blockId
    )
    {
      operationError(
        'invalid-statement',
        'anchor successor ownership is malformed',
        op,
        op.anchor
      )
    }
  }
  let lowered
  try
  {
    lowered = lowerRepairStatements(
      op.statements,
      op.anchor.blockId,
      project.uids,
      declarationResolver(project, op.anchor.target, op)
    )
  }
  catch (error)
  {
    if (error instanceof OperationError) throw error
    operationError(
      'invalid-statement',
      error instanceof Error ? error.message : String(error),
      op,
      op.anchor
    )
  }
  for (const [blockId, block] of scratchRecordEntries(lowered.blocks))
    defineScratchRecordValue<BlockEntry>(target.blocks, blockId, block)
  anchor.next = lowered.topId
  if (oldSuccessorId !== null)
  {
    const tail = scratchRecordValue(target.blocks, lowered.tailId)
    const oldSuccessor = scratchRecordValue(target.blocks, oldSuccessorId)
    if (isBlockEntry(tail)) tail.next = oldSuccessorId
    if (isBlockEntry(oldSuccessor)) oldSuccessor.parent = lowered.tailId
  }
  const blocks = [
    attributedBlock(op.anchor.target.targetIndex, op.anchor.blockId, ['/next']),
    ...lowered.blockIds.map((blockId) =>
      attributedBlock(op.anchor.target.targetIndex, blockId)
    ),
  ]
  if (oldSuccessorId)
  {
    blocks.push(
      attributedBlock(op.anchor.target.targetIndex, oldSuccessorId, ['/parent'])
    )
  }
  return {
    attribution: {
      operationId: op.opId,
      blocks,
    },
  }
}

function removeStatement(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  op: Extract<RepairOp, { kind: 'deleteStatement' }>
): AppliedOperation
{
  const { target, block } = resolveExistingBlock(
    project,
    baselineBlockIds,
    op.statement,
    op
  )
  assertOpcode(block, op.expectedOpcode, op, op.statement)
  try
  {
    const plan = deleteStatement(target, op.statement.blockId)
    const ownerPath =
      plan.owner.kind === 'next'
        ? '/next'
        : pointerPath(
            'inputs',
            plan.owner.inputName,
            String(plan.owner.slotIndex)
          )
    const blocks = [
      attributedBlock(op.statement.target.targetIndex, plan.owner.blockId, [
        ownerPath,
      ]),
      ...plan.deletedBlockIds.map((blockId) =>
        attributedBlock(op.statement.target.targetIndex, blockId)
      ),
    ]
    if (plan.successorBlockId)
    {
      blocks.push(
        attributedBlock(
          op.statement.target.targetIndex,
          plan.successorBlockId,
          ['/parent']
        )
      )
    }
    return {
      attribution: {
        operationId: op.opId,
        blocks,
      },
    }
  }
  catch (error)
  {
    operationError(
      'graph-edit',
      error instanceof Error ? error.message : String(error),
      op,
      op.statement
    )
  }
}

function nextScriptPosition(target: Target): { x: number; y: number }
{
  const occupied = new Set<string>()
  for (const [, entry] of scratchRecordEntries(target.blocks))
  {
    if (Array.isArray(entry))
    {
      if (entry.length >= 5) occupied.add(`${entry[3]},${entry[4]}`)
      continue
    }
    if (entry.topLevel === true && entry.shadow !== true)
    {
      occupied.add(`${entry.x ?? 0},${entry.y ?? 0}`)
    }
  }
  for (let row = 0; ; row++)
  {
    const position = { x: 0, y: row * 160 }
    if (!occupied.has(`${position.x},${position.y}`)) return position
  }
}

function addScript(
  project: ProjectIR,
  op: Extract<RepairOp, { kind: 'addScript' }>
): AppliedOperation
{
  const target = resolveTarget(project, op.target, op)
  let lowered
  try
  {
    lowered = lowerRepairScript(
      op.statements,
      nextScriptPosition(target),
      project.uids,
      declarationResolver(project, op.target, op)
    )
  }
  catch (error)
  {
    if (error instanceof OperationError) throw error
    operationError(
      'invalid-script',
      error instanceof Error ? error.message : String(error),
      op,
      op.target
    )
  }
  for (const [blockId, block] of scratchRecordEntries(lowered.blocks))
    defineScratchRecordValue<BlockEntry>(target.blocks, blockId, block)
  return {
    attribution: {
      operationId: op.opId,
      blocks: lowered.blockIds.map((blockId) =>
        attributedBlock(op.target.targetIndex, blockId)
      ),
    },
  }
}

function targetPropertySupported(
  target: Target,
  property: TargetProperty
): boolean
{
  const descriptor = TARGET_PROPERTY_DESCRIPTORS[property]
  return descriptor.target === 'all' || !target.isStage
}

function setTargetProperty(
  project: ProjectIR,
  op: Extract<RepairOp, { kind: 'setTargetProperty' }>
): AppliedOperation
{
  if (
    !isTargetPropertyValue(op.property, op.from) ||
    !isTargetPropertyValue(op.property, op.to)
  )
  {
    operationError(
      'internal-invariant',
      `property ${op.property} has invalid parsed values`,
      op,
      op.target
    )
  }
  const target = resolveTarget(project, op.target, op)
  if (!targetPropertySupported(target, op.property))
  {
    operationError(
      'unsupported-operation',
      `property ${op.property} is not supported by this target`,
      op,
      op.target
    )
  }
  const record = target as unknown as Record<string, unknown>
  if (!Object.is(record[op.property], op.from))
  {
    operationError(
      'target-mismatch',
      `property ${op.property} does not match the supplied from value`,
      op,
      op.target
    )
  }
  record[op.property] = op.to
  return {
    attribution: {
      operationId: op.opId,
      targetProperties: [
        { targetIndex: op.target.targetIndex, property: op.property },
      ],
    },
  }
}

function applyOperation(
  project: ProjectIR,
  baselineBlockIds: ReadonlySet<string>,
  operation: RepairOp
): AppliedOperation
{
  switch (operation.kind)
  {
    case 'replaceLiteral':
      return replaceLiteral(project, baselineBlockIds, operation)
    case 'replaceCompatibleOpcode':
      return replaceCompatibleOpcode(project, baselineBlockIds, operation)
    case 'replaceVariableRef':
      return replaceVariableReference(project, baselineBlockIds, operation)
    case 'replaceBroadcastRef':
      return replaceBroadcastReference(project, baselineBlockIds, operation)
    case 'insertStatementsAfter':
      return insertStatements(project, baselineBlockIds, operation)
    case 'deleteStatement':
      return removeStatement(project, baselineBlockIds, operation)
    case 'addScript':
      return addScript(project, operation)
    case 'setTargetProperty':
      return setTargetProperty(project, operation)
  }
}

function nonnegativeLimits(
  values: Record<string, number>,
  code: 'intent-budget' | 'impact-budget'
): RepairViolation[]
{
  const invalid = Object.entries(values).filter(
    ([, value]) => !Number.isSafeInteger(value) || value < 0
  )
  return invalid.map(([name]) => ({
    code,
    message: `${name} must be a nonnegative safe integer`,
  }))
}

function validateIntent(
  patch: SemanticPatch,
  newBlockCount: number,
  limits: RepairIntentLimits
): RepairViolation[]
{
  const violations = nonnegativeLimits(
    {
      maxOpsPerProposal: limits.maxOpsPerProposal,
      maxNewBlocksPerProposal: limits.maxNewBlocksPerProposal,
    },
    'intent-budget'
  )
  if (patch.operations.length === 0)
  {
    violations.push({
      code: 'intent-budget',
      message: 'semantic patch must contain at least one operation',
    })
  }
  if (patch.operations.length > limits.maxOpsPerProposal)
  {
    violations.push({
      code: 'intent-budget',
      message: `proposal has ${patch.operations.length} operations; max ${limits.maxOpsPerProposal}`,
    })
  }
  if (newBlockCount > limits.maxNewBlocksPerProposal)
  {
    violations.push({
      code: 'intent-budget',
      message: `proposal creates ${newBlockCount} blocks; max ${limits.maxNewBlocksPerProposal}`,
    })
  }
  const allowed = new Set(limits.allowedOpKinds)
  for (const operation of patch.operations)
  {
    if (!allowed.has(operation.kind))
    {
      violations.push({
        code: 'unsupported-operation',
        message: `operation ${operation.kind} is not allowed`,
        opId: operation.opId,
      })
    }
  }
  return violations
}

function validateImpact(
  delta: ProjectDelta,
  limits: RepairImpactLimits
): RepairViolation[]
{
  const violations = nonnegativeLimits(
    {
      maxTouchedTargets: limits.maxTouchedTargets,
      maxTouchedScripts: limits.maxTouchedScripts,
      maxChangedAuthoredBlocks: limits.maxChangedAuthoredBlocks,
      maxChangedBlockRecords: limits.maxChangedBlockRecords,
    },
    'impact-budget'
  )
  const comparisons: Array<[number, number, string]> = [
    [delta.summary.touchedTargets, limits.maxTouchedTargets, 'touched targets'],
    [delta.summary.touchedScripts, limits.maxTouchedScripts, 'touched scripts'],
    [
      delta.summary.changedAuthoredBlocks,
      limits.maxChangedAuthoredBlocks,
      'changed authored blocks',
    ],
    [
      delta.summary.changedBlockRecords,
      limits.maxChangedBlockRecords,
      'changed block records',
    ],
  ]
  for (const [actual, limit, label] of comparisons)
  {
    if (actual > limit)
    {
      violations.push({
        code: 'impact-budget',
        message: `${label}: ${actual}; max ${limit}`,
      })
    }
  }
  return violations
}

function baselineBlockIds(project: ProjectIR): Set<string>
{
  const ids = new Set<string>()
  project.json.targets.forEach((target, targetIndex) =>
  {
    for (const blockId of Object.keys(target.blocks))
    {
      ids.add(`${targetIndex}\u0000${blockId}`)
    }
  })
  return ids
}

function preservationAllowances(
  patch: SemanticPatch,
  policy: RepairPreservationPolicy
): {
  allowAssetChanges: boolean
  allowExistingEditorLayoutChanges: boolean
  allowMetadataChanges: boolean
  allowTargetStructureChanges: boolean
  allowedTargetProperties: Array<{ targetIndex: number; property: string }>
}
{
  const allowed = new Set(policy.allowedTargetProperties)
  return {
    allowAssetChanges: policy.allowAssetChanges,
    allowExistingEditorLayoutChanges: policy.allowExistingEditorLayoutChanges,
    allowMetadataChanges: policy.allowMetadataChanges,
    allowTargetStructureChanges: policy.allowTargetStructureChanges,
    allowedTargetProperties: patch.operations.flatMap((operation) =>
      operation.kind === 'setTargetProperty' && allowed.has(operation.property)
        ? [
            {
              targetIndex: operation.target.targetIndex,
              property: operation.property,
            },
          ]
        : []
    ),
  }
}

export async function applySemanticPatch(
  baseline: ProjectIR,
  rawPatch: unknown,
  options: RepairTransactionOptions = {}
): Promise<RepairPatchResult>
{
  const parsed = parseSemanticPatch(rawPatch, options.resourceLimits)
  if (!parsed.ok) return { ...parsed, applied: false }

  const intent = {
    ...DEFAULT_REPAIR_INTENT_LIMITS,
    ...options.intentLimits,
  }
  const intentViolations = validateIntent(
    parsed.patch,
    parsed.newBlockCount,
    intent
  )
  if (intentViolations.length > 0)
  {
    return { ok: false, applied: false, violations: intentViolations }
  }

  let baselineBytes: Uint8Array
  try
  {
    baselineBytes = options.baselineArtifactBytes
      ? Uint8Array.from(options.baselineArtifactBytes)
      : await baseline.toSb3()
  }
  catch (error)
  {
    return internalInvariantFailure(error)
  }
  const baselineArtifactSha256 = hashBytes(baselineBytes)
  if (parsed.patch.baseArtifactSha256 !== baselineArtifactSha256)
  {
    return {
      ok: false,
      applied: false,
      violations: [
        {
          code: 'stale-base',
          message: 'patch artifact hash does not match the immutable baseline',
        },
      ],
    }
  }

  let candidate: ProjectIR
  const baselineIds = baselineBlockIds(baseline)
  const attribution: DeltaOperationAttribution[] = []
  try
  {
    candidate = cloneProjectForRepair(baseline)
    for (const operation of parsed.patch.operations)
    {
      attribution.push(
        applyOperation(candidate, baselineIds, operation).attribution
      )
    }
  }
  catch (error)
  {
    if (error instanceof OperationError)
    {
      return { ok: false, applied: false, violations: [error.violation] }
    }
    return internalInvariantFailure(error)
  }

  let candidateBytes: Uint8Array
  try
  {
    candidateBytes = await candidate.toSb3()
  }
  catch (error)
  {
    return internalInvariantFailure(error)
  }
  const candidateArtifact: AppliedCandidateArtifact = {
    patch: parsed.patch,
    baselineArtifactSha256,
    candidateArtifactSha256: hashBytes(candidateBytes),
    candidateBytes,
    candidate,
    attribution,
    appliedOpIds: parsed.patch.operations.map((operation) => operation.opId),
  }

  let delta: ProjectDelta
  try
  {
    delta = computeProjectDelta(baseline, candidate, attribution)
  }
  catch (error)
  {
    return {
      ...candidateArtifact,
      ok: false,
      applied: true,
      violations: internalInvariantFailure(error).violations,
    }
  }
  const appliedCandidate: AppliedRepairPatch = {
    ...candidateArtifact,
    delta,
  }
  const mandatoryDelta = delta.protectedChanges.filter(
    (change) => change.mandatory
  )
  if (!delta.complete || mandatoryDelta.length > 0)
  {
    return {
      ...appliedCandidate,
      ok: false,
      applied: true,
      violations: [
        ...(!delta.complete
          ? [
              {
                code: 'internal-invariant' as const,
                message: 'project delta is incomplete',
              },
            ]
          : []),
        ...mandatoryDelta.map((change) => ({
          code:
            change.class === 'unattributed'
              ? ('unattributed-change' as const)
              : ('preservation' as const),
          message: `${change.path}: ${change.detail}`,
        })),
      ],
    }
  }

  const impact = {
    ...DEFAULT_REPAIR_IMPACT_LIMITS,
    ...options.impactLimits,
  }
  const impactViolations = validateImpact(delta, impact)
  if (impactViolations.length > 0)
  {
    return {
      ...appliedCandidate,
      ok: false,
      applied: true,
      violations: impactViolations,
    }
  }

  const preservationPolicy = {
    ...DEFAULT_REPAIR_PRESERVATION_POLICY,
    ...options.preservation,
  }
  let preservation: PreservationResult
  try
  {
    preservation = checkPreservation(
      createPreservationManifest(baseline),
      candidate,
      preservationAllowances(parsed.patch, preservationPolicy)
    )
  }
  catch (error)
  {
    return {
      ...appliedCandidate,
      ok: false,
      applied: true,
      violations: internalInvariantFailure(error).violations,
    }
  }
  if (!preservation.preserved)
  {
    return {
      ...appliedCandidate,
      ok: false,
      applied: true,
      violations: preservation.violations.map((violation) => ({
        code: 'preservation',
        message: `${violation.path}: ${violation.detail}`,
      })),
      preservation,
    }
  }

  return {
    ...appliedCandidate,
    ok: true,
    applied: true,
    preservation,
  }
}

export function targetRef(project: ProjectIR, targetIndex: number): TargetRef
{
  const target = project.json.targets[targetIndex]
  if (!target) throw new Error(`target index ${targetIndex} does not exist`)
  return projectTargetIdentity(target, targetIndex)
}

export function blockRef(
  project: ProjectIR,
  targetIndex: number,
  blockId: string
): BlockRef
{
  const target = targetRef(project, targetIndex)
  if (
    !hasScratchRecordKey(project.json.targets[targetIndex]!.blocks, blockId)
  )
  {
    throw new Error(
      `block "${blockId}" does not exist in target ${targetIndex}`
    )
  }
  return { target, blockId }
}

export function variableRef(
  project: ProjectIR,
  declarationTargetIndex: number,
  id: string
): VariableRef
{
  const declarationTarget = targetRef(project, declarationTargetIndex)
  const name = scratchRecordValue(
    project.json.targets[declarationTargetIndex]!.variables,
    id
  )?.[0]
  if (name === undefined) throw new Error(`variable "${id}" does not exist`)
  return { kind: 'variable', declarationTarget, id, name }
}

export function broadcastRef(
  project: ProjectIR,
  declarationTargetIndex: number,
  id: string
): BroadcastRef
{
  const declarationTarget = targetRef(project, declarationTargetIndex)
  const name = scratchRecordValue(
    project.json.targets[declarationTargetIndex]!.broadcasts,
    id
  )
  if (name === undefined) throw new Error(`broadcast "${id}" does not exist`)
  return { kind: 'broadcast', declarationTarget, id, name }
}
