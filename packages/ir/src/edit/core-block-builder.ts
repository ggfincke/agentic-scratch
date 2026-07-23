// packages/ir/src/edit/core-block-builder.ts
// lower curated semantic block trees through ProjectIR-owned deterministic IDs

import type {
  Block,
  BlockField,
  BlockInput,
  InputPrimitive,
} from '@scratch-agent/sb3'
import { isBlockEntry } from '@scratch-agent/sb3'

import type { ProjectIR } from '../project/project-ir.js'
import type { Uids, UidSnapshot } from '../core/uid.js'
import type {
  DeclarationRefV1,
  MediaRefV1,
  OrdinarySemanticBlockTreeV1,
  SemanticBlockTreeV1,
  SemanticExpressionBlockTreeV1,
  SemanticFieldValueV1,
  SemanticInputValueV1,
  SemanticReplacementV1,
  SemanticStatementSequenceV1,
  TargetRefV1,
  TopLevelScriptRootV1,
} from './contracts.generated.js'
import {
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
  curatedAuthorableDescriptorV1,
  type CuratedCoreBlockDescriptorV1,
} from './core-block-catalog.js'
import {
  validateSemanticBlockTree,
  validateSemanticStatementSequence,
} from './semantic-validation.js'

type CuratedSemanticEntityRefV1 =
  TargetRefV1 | DeclarationRefV1 | MediaRefV1

export interface CuratedEntityResolutionRequestV1
{
  readonly reference: CuratedSemanticEntityRefV1
  readonly expectedEntityKind: 'target' | 'declaration' | 'media'
  readonly expectedEntitySubtype: string
  readonly referenceDomain: string
  readonly ownerTargetIndex: number
  readonly semanticPath: string
}

export interface CuratedResolvedEntityV1
{
  readonly entityKind: 'target' | 'declaration' | 'media'
  readonly entitySubtype: string
  readonly displayName: string
  readonly serializedId: string
  readonly ownerTargetIndex: number | null
  readonly semanticLineageSha256: string
  readonly semanticFingerprintSha256: string
}

export type CuratedEntityResolverV1 = (
  request: CuratedEntityResolutionRequestV1
) => CuratedResolvedEntityV1

interface CuratedResolvedEntityReadEvidenceV1 extends CuratedResolvedEntityV1
{
  readonly referenceDomain: string
  readonly semanticPath: string
}

interface CuratedAllocatorEvidenceV1
{
  readonly before: UidSnapshot
  readonly after: UidSnapshot
  readonly allocatedIds: readonly string[]
}

interface CuratedLoweredGraphV1
{
  readonly rootId: string
  readonly tailId: string
  readonly blocks: Readonly<Record<string, Block>>
  readonly blockIds: readonly string[]
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
  readonly catalogEvidence: typeof CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
  readonly resolvedEntityReadEvidence: readonly CuratedResolvedEntityReadEvidenceV1[]
  readonly allocatorEvidence: CuratedAllocatorEvidenceV1
  readonly allocatorCandidate: Uids
}

interface CuratedLoweredFieldValueV1
{
  readonly field: BlockField
  readonly catalogEvidence: typeof CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
  readonly resolvedEntityReadEvidence: readonly CuratedResolvedEntityReadEvidenceV1[]
  readonly allocatorEvidence: CuratedAllocatorEvidenceV1
  readonly allocatorCandidate: Uids
}

export interface CuratedLoweredInputValueV1
{
  readonly input: BlockInput | null
  readonly rootId: string | null
  readonly tailId: string | null
  readonly blocks: Readonly<Record<string, Block>>
  readonly blockIds: readonly string[]
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
  readonly catalogEvidence: typeof CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
  readonly resolvedEntityReadEvidence: readonly CuratedResolvedEntityReadEvidenceV1[]
  readonly allocatorEvidence: CuratedAllocatorEvidenceV1
  readonly allocatorCandidate: Uids
}

export class CuratedCoreBlockBuilderError extends Error
{
  constructor(
    readonly code:
      | 'invalid-target'
      | 'invalid-shape'
      | 'unsupported-opcode'
      | 'unsupported-node-kind'
      | 'invalid-field'
      | 'invalid-input'
      | 'invalid-entity-resolution'
      | 'duplicate-alias'
      | 'invalid-workspace',
    message: string
  )
  {
    super(message)
    this.name = 'CuratedCoreBlockBuilderError'
  }
}

interface CuratedBuilderDescriptorCoverageV1
{
  readonly opcode: string
  readonly covered: boolean
  readonly loweringKind:
    'ordinary-block' | 'compressed-entity-menu' | 'unavailable'
  readonly reason: string | null
}

export function curatedBuilderDescriptorCoverageV1(
  descriptor: CuratedCoreBlockDescriptorV1
): CuratedBuilderDescriptorCoverageV1
{
  if (
    descriptor.availability === 'builderOnly' &&
    descriptor.safeBuilderKind === 'referenceMenuShadow' &&
    descriptor.shape === 'menuReporter' &&
    descriptor.requiredFields.length === 1 &&
    descriptor.requiredFields[0]?.requiredEntitySubtype !== null
  )
  {
    return {
      opcode: descriptor.opcode,
      covered: true,
      loweringKind: 'compressed-entity-menu',
      reason: null,
    }
  }
  if (
    descriptor.availability !== 'supported' ||
    descriptor.safeBuilderKind !== 'ordinaryBlock'
  )
  {
    return {
      opcode: descriptor.opcode,
      covered: false,
      loweringKind: 'unavailable',
      reason:
        descriptor.preservationOnlyReason ?? 'descriptor is not authorable',
    }
  }
  const fieldsCovered = [
    ...descriptor.requiredFields,
    ...descriptor.optionalFields,
  ].every(
    (field) =>
      field.requiredEntitySubtype !== null && field.referenceDomain !== null
  )
  const inputsCovered = [
    ...descriptor.requiredInputs,
    ...descriptor.optionalInputs,
  ].every((input) =>
  {
    if (input.connection === 'entityMenu')
    {
      return (
        input.requiredEntitySubtype !== null &&
        input.referenceDomain !== null &&
        input.canonicalShadow?.kind === 'entityMenu' &&
        input.canonicalShadow.sb3PrimitiveTag === 11
      )
    }
    if (input.connection === 'boolean' || input.connection === 'substack')
      return input.canonicalShadow === null
    return input.canonicalShadow?.kind === 'primitive'
  })
  const shapeCovered = [
    'stack',
    'reporter',
    'boolean',
    'hat',
    'cap',
    'cShape',
  ].includes(descriptor.shape)
  const covered = fieldsCovered && inputsCovered && shapeCovered
  return {
    opcode: descriptor.opcode,
    covered,
    loweringKind: covered ? 'ordinary-block' : 'unavailable',
    reason: covered
      ? null
      : 'descriptor uses a field, input, or shape outside the curated lowerer',
  }
}

interface BuildState
{
  readonly project: ProjectIR
  readonly targetIndex: number
  readonly ownerTargetKind: 'stage' | 'sprite'
  readonly allocator: Uids
  readonly allocatorBefore: UidSnapshot
  readonly blocks: Record<string, Block>
  readonly blockIds: string[]
  readonly aliases: Record<string, string>
  readonly creationKeys: Record<string, string>
  readonly reads: CuratedResolvedEntityReadEvidenceV1[]
}

interface BuiltChain
{
  readonly rootId: string
  readonly tailId: string
}

function emptyRecord<T>(): Record<string, T>
{
  return Object.create(null) as Record<string, T>
}

function fail(
  code: CuratedCoreBlockBuilderError['code'],
  message: string
): never
{
  throw new CuratedCoreBlockBuilderError(code, message)
}

function compareSnapshots(before: UidSnapshot, after: UidSnapshot): string[]
{
  const existing = new Set(before.usedIds)
  return after.usedIds.filter((id) => !existing.has(id))
}

function stateFor(project: ProjectIR, targetIndex: number): BuildState
{
  const target = project.json.targets[targetIndex]
  if (target === undefined)
    return fail('invalid-target', `target index ${targetIndex} is absent`)
  const allocator = project.uids.clone()
  return {
    project,
    targetIndex,
    ownerTargetKind: target.isStage ? 'stage' : 'sprite',
    allocator,
    allocatorBefore: project.uids.snapshot(),
    blocks: emptyRecord<Block>(),
    blockIds: [],
    aliases: emptyRecord<string>(),
    creationKeys: emptyRecord<string>(),
    reads: [],
  }
}

function finishAllocator(state: BuildState): CuratedAllocatorEvidenceV1
{
  const after = state.allocator.snapshot()
  const allocatedIdSet = new Set(compareSnapshots(state.allocatorBefore, after))
  if (
    allocatedIdSet.size !== state.blockIds.length ||
    state.blockIds.some((id) => !allocatedIdSet.has(id))
  )
  {
    return fail(
      'invalid-shape',
      'allocator reservations do not exactly match ordered lowered block ids'
    )
  }
  return { before: state.allocatorBefore, after, allocatedIds: state.blockIds }
}

function finishGraph(
  state: BuildState,
  chain: BuiltChain
): CuratedLoweredGraphV1
{
  return {
    ...chain,
    blocks: state.blocks,
    blockIds: state.blockIds,
    aliasBlockIds: state.aliases,
    creationKeyByBlockId: state.creationKeys,
    catalogEvidence: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
    resolvedEntityReadEvidence: state.reads,
    allocatorEvidence: finishAllocator(state),
    allocatorCandidate: state.allocator,
  }
}

function descriptorFor(
  tree: OrdinarySemanticBlockTreeV1,
  state: BuildState,
  placement:
    | 'eventScriptHat'
    | 'topLevelStatement'
    | 'statementSequence'
    | 'topLevelExpression'
    | 'reporterInput'
    | 'booleanInput'
): CuratedCoreBlockDescriptorV1
{
  const descriptor = curatedAuthorableDescriptorV1(tree.opcode)
  if (descriptor === null)
    return fail('unsupported-opcode', `${tree.opcode} is not authorable`)
  const coverage = curatedBuilderDescriptorCoverageV1(descriptor)
  if (!coverage.covered || coverage.loweringKind !== 'ordinary-block')
    return fail(
      'unsupported-opcode',
      coverage.reason ?? `${tree.opcode} lacks ordinary builder coverage`
    )
  if (!descriptor.context.allowedPlacements.includes(placement))
    return fail(
      'invalid-shape',
      `${tree.opcode} is not valid in ${placement} placement`
    )
  if (!descriptor.context.ownerTargets.includes(state.ownerTargetKind))
    return fail(
      'invalid-target',
      `${tree.opcode} cannot be owned by a ${state.ownerTargetKind} target`
    )
  return descriptor
}

function exactNamedMembers<T extends { readonly name: string }>(
  values: readonly T[],
  required: readonly string[],
  optional: readonly string[],
  family: 'field' | 'input',
  opcode: string
): Map<string, T>
{
  const members = new Map<string, T>()
  for (const value of values)
  {
    if (members.has(value.name))
      return fail(
        `invalid-${family}`,
        `${opcode} repeats ${family} ${value.name}`
      )
    members.set(value.name, value)
  }
  const allowed = new Set([...required, ...optional])
  if (
    required.some((name) => !members.has(name)) ||
    [...members.keys()].some((name) => !allowed.has(name))
  )
  {
    return fail(
      `invalid-${family}`,
      `${opcode} ${family} names do not exactly match its descriptor`
    )
  }
  return members
}

function recordAlias(
  state: BuildState,
  alias: string | undefined,
  blockId: string
): void
{
  if (alias === undefined) return
  if (Object.hasOwn(state.aliases, alias))
    return fail('duplicate-alias', `semantic tree repeats local alias ${alias}`)
  state.aliases[alias] = blockId
}

function allocateBlock(
  state: BuildState,
  tree: OrdinarySemanticBlockTreeV1,
  parentId: string | null,
  topLevel: boolean,
  creationKey: string,
  workspace?: { readonly x: number; readonly y: number }
): { readonly id: string; readonly block: Block }
{
  if (
    workspace !== undefined &&
    (!Number.isFinite(workspace.x) || !Number.isFinite(workspace.y))
  )
  {
    return fail('invalid-workspace', 'workspace coordinates must be finite')
  }
  const id = state.allocator.next('b')
  const block = Object.assign(Object.create(null) as Block, {
    opcode: tree.opcode,
    next: null,
    parent: parentId,
    inputs: emptyRecord<BlockInput>(),
    fields: emptyRecord<BlockField>(),
    shadow: false,
    topLevel,
    ...(workspace === undefined ? {} : { x: workspace.x, y: workspace.y }),
  })
  state.blocks[id] = block
  state.blockIds.push(id)
  state.creationKeys[id] = creationKey
  recordAlias(state, tree.localAlias, id)
  return { id, block }
}

function entityReference(
  value: SemanticFieldValueV1 | SemanticInputValueV1
): CuratedSemanticEntityRefV1 | null
{
  return value.valueKind === 'entity' ? value.value : null
}

function resolveEntity(
  resolver: CuratedEntityResolverV1,
  state: BuildState,
  reference: CuratedSemanticEntityRefV1,
  referenceDomain: string | null,
  expectedSubtype: string | null,
  semanticPath: string
): CuratedResolvedEntityV1
{
  if (referenceDomain === null || expectedSubtype === null)
    return fail(
      'invalid-entity-resolution',
      'descriptor lacks entity resolution policy'
    )
  const expectedEntityKind =
    expectedSubtype === 'stage' || expectedSubtype === 'sprite'
      ? 'target'
      : expectedSubtype === 'costume' || expectedSubtype === 'sound'
        ? 'media'
        : 'declaration'
  const resolved = resolver({
    reference,
    expectedEntityKind,
    expectedEntitySubtype: expectedSubtype,
    referenceDomain,
    ownerTargetIndex: state.targetIndex,
    semanticPath,
  })
  if (
    resolved.entityKind !== expectedEntityKind ||
    resolved.entitySubtype !== expectedSubtype ||
    typeof resolved.displayName !== 'string' ||
    resolved.displayName.length === 0 ||
    typeof resolved.serializedId !== 'string' ||
    resolved.serializedId.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(resolved.semanticLineageSha256) ||
    !/^[a-f0-9]{64}$/u.test(resolved.semanticFingerprintSha256)
  )
  {
    return fail(
      'invalid-entity-resolution',
      `${semanticPath} resolver returned incompatible or incomplete evidence`
    )
  }
  state.reads.push({ ...resolved, referenceDomain, semanticPath })
  return resolved
}

function lowerField(
  resolver: CuratedEntityResolverV1,
  state: BuildState,
  descriptor: CuratedCoreBlockDescriptorV1,
  descriptorField: CuratedCoreBlockDescriptorV1['requiredFields'][number],
  value: SemanticFieldValueV1,
  semanticPath: string
): BlockField
{
  const reference = entityReference(value)
  if (descriptorField.requiredEntitySubtype === null || reference === null)
  {
    return fail(
      'invalid-field',
      `${descriptor.opcode}.${descriptorField.name} has no approved scalar lowering`
    )
  }
  const resolved = resolveEntity(
    resolver,
    state,
    reference,
    descriptorField.referenceDomain,
    descriptorField.requiredEntitySubtype,
    semanticPath
  )
  return [resolved.displayName, resolved.serializedId]
}

function literalPrimitive(
  descriptor: CuratedCoreBlockDescriptorV1,
  inputDescriptor: CuratedCoreBlockDescriptorV1['requiredInputs'][number],
  value: SemanticInputValueV1,
  semanticPath: string
): InputPrimitive
{
  if (value.valueKind !== 'literal')
    return fail('invalid-input', `${semanticPath} requires a literal`)
  const shadow = inputDescriptor.canonicalShadow
  if (shadow?.kind !== 'primitive')
    return fail(
      'invalid-input',
      `${semanticPath} lacks a primitive shadow policy`
    )
  if (
    inputDescriptor.connection === 'number' &&
    typeof value.value !== 'number'
  )
    return fail('invalid-input', `${semanticPath} requires a number`)
  if (typeof value.value === 'number' && !Number.isFinite(value.value))
    return fail('invalid-input', `${semanticPath} number must be finite`)
  const serialized =
    typeof value.value === 'boolean' ? String(value.value) : value.value
  if (shadow.sb3PrimitiveTag === 10) return [10, serialized] as InputPrimitive
  if (typeof serialized !== 'number')
    return fail(
      'invalid-input',
      `${descriptor.opcode}.${inputDescriptor.name} numeric primitive requires a number`
    )
  return [shadow.sb3PrimitiveTag, serialized] as InputPrimitive
}

function compatiblePrimitiveShadow(
  value: BlockInput[2],
  expectedTag: number
): value is InputPrimitive
{
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value[0] !== expectedTag ||
    (typeof value[1] !== 'string' && typeof value[1] !== 'number')
  )
  {
    return false
  }
  return (
    expectedTag === 10 ||
    (typeof value[1] === 'number'
      ? Number.isFinite(value[1])
      : Number.isFinite(Number(value[1])))
  )
}

function lowerInput(
  resolver: CuratedEntityResolverV1,
  state: BuildState,
  descriptor: CuratedCoreBlockDescriptorV1,
  inputDescriptor: CuratedCoreBlockDescriptorV1['requiredInputs'][number],
  value: SemanticInputValueV1,
  ownerBlockId: string,
  semanticPath: string,
  currentInput?: BlockInput,
  preservedObscuredShadow?: BlockInput[2]
): { readonly input: BlockInput | null; readonly chain: BuiltChain | null }
{
  if (value.valueKind === 'empty') return { input: null, chain: null }
  if (inputDescriptor.connection === 'entityMenu')
  {
    const reference = entityReference(value)
    if (reference === null)
      return fail(
        'invalid-input',
        `${semanticPath} requires an entity reference`
      )
    const resolved = resolveEntity(
      resolver,
      state,
      reference,
      inputDescriptor.referenceDomain,
      inputDescriptor.requiredEntitySubtype,
      semanticPath
    )
    const shadow = inputDescriptor.canonicalShadow
    if (shadow?.kind !== 'entityMenu' || shadow.sb3PrimitiveTag !== 11)
      return fail(
        'invalid-input',
        `${semanticPath} has no compressed menu policy`
      )
    return {
      input: [1, [11, resolved.displayName, resolved.serializedId]],
      chain: null,
    }
  }
  if (inputDescriptor.connection === 'substack')
  {
    if (preservedObscuredShadow !== undefined)
      return fail(
        'invalid-input',
        `${semanticPath} cannot retain a substack shadow`
      )
    if (value.valueKind !== 'statementSequence')
      return fail(
        'invalid-input',
        `${semanticPath} requires a statement sequence`
      )
    const chain = buildStatementSequence(
      resolver,
      state,
      value.value,
      ownerBlockId,
      false,
      undefined,
      `${semanticPath}/value`
    )
    return { input: [2, chain.rootId], chain }
  }
  if (inputDescriptor.connection === 'boolean')
  {
    if (preservedObscuredShadow !== undefined)
      return fail(
        'invalid-input',
        `${semanticPath} cannot retain a Boolean shadow`
      )
    if (value.valueKind !== 'block')
      return fail('invalid-input', `${semanticPath} requires a Boolean block`)
    if (value.value.nodeKind !== 'ordinary')
      return fail(
        'unsupported-node-kind',
        `${value.value.nodeKind} construction belongs to the procedure phase`
      )
    const chain = buildExpression(
      resolver,
      state,
      value.value,
      ownerBlockId,
      false,
      'booleanInput',
      undefined,
      `${semanticPath}/value`
    )
    return { input: [2, chain.rootId], chain }
  }
  if (value.valueKind === 'block')
  {
    if (value.value.nodeKind !== 'ordinary')
      return fail(
        'unsupported-node-kind',
        `${value.value.nodeKind} construction belongs to the procedure phase`
      )
    const chain = buildExpression(
      resolver,
      state,
      value.value,
      ownerBlockId,
      false,
      'reporterInput',
      undefined,
      `${semanticPath}/value`
    )
    const shadow = inputDescriptor.canonicalShadow
    if (shadow?.kind !== 'primitive')
      return fail(
        'invalid-input',
        `${semanticPath} has no obscured shadow policy`
      )
    let loweredShadow: BlockInput[2] = [
      shadow.sb3PrimitiveTag,
      shadow.value,
    ] as InputPrimitive
    if (preservedObscuredShadow !== undefined)
    {
      const currentShadow =
        currentInput?.[0] === 1
          ? currentInput[1]
          : currentInput?.[0] === 3
            ? currentInput[2]
            : undefined
      if (
        currentShadow === undefined ||
        JSON.stringify(currentShadow) !==
          JSON.stringify(preservedObscuredShadow) ||
        !compatiblePrimitiveShadow(
          preservedObscuredShadow,
          shadow.sb3PrimitiveTag
        )
      )
      {
        return fail(
          'invalid-input',
          `${semanticPath} obscured shadow does not match the exact compatible current shadow`
        )
      }
      loweredShadow = structuredClone(preservedObscuredShadow)
    }
    return {
      input: [3, chain.rootId, loweredShadow],
      chain,
    }
  }
  return {
    input: [
      1,
      literalPrimitive(descriptor, inputDescriptor, value, semanticPath),
    ],
    chain: null,
  }
}

function buildOrdinary(
  resolver: CuratedEntityResolverV1,
  state: BuildState,
  tree: SemanticBlockTreeV1,
  parentId: string | null,
  topLevel: boolean,
  placement:
    | 'eventScriptHat'
    | 'topLevelStatement'
    | 'statementSequence'
    | 'topLevelExpression'
    | 'reporterInput'
    | 'booleanInput',
  workspace: { readonly x: number; readonly y: number } | undefined,
  semanticPath: string
): BuiltChain
{
  if (tree.nodeKind !== 'ordinary')
    return fail(
      'unsupported-node-kind',
      `${tree.nodeKind} construction belongs to the procedure phase`
    )
  const descriptor = descriptorFor(tree, state, placement)
  const fields = exactNamedMembers(
    tree.fields,
    descriptor.requiredFields.map((field) => field.name),
    descriptor.optionalFields.map((field) => field.name),
    'field',
    tree.opcode
  )
  const inputs = exactNamedMembers(
    tree.inputs,
    descriptor.requiredInputs.map((input) => input.name),
    descriptor.optionalInputs.map((input) => input.name),
    'input',
    tree.opcode
  )
  const allocated = allocateBlock(
    state,
    tree,
    parentId,
    topLevel,
    semanticPath,
    workspace
  )
  for (const descriptorField of [
    ...descriptor.requiredFields,
    ...descriptor.optionalFields,
  ])
  {
    const field = fields.get(descriptorField.name)
    if (field === undefined) continue
    allocated.block.fields![descriptorField.name] = lowerField(
      resolver,
      state,
      descriptor,
      descriptorField,
      field.value,
      `${semanticPath}/fields/${descriptorField.name}/value`
    )
  }
  for (const inputDescriptor of [
    ...descriptor.requiredInputs,
    ...descriptor.optionalInputs,
  ])
  {
    const input = inputs.get(inputDescriptor.name)
    if (input === undefined) continue
    const lowered = lowerInput(
      resolver,
      state,
      descriptor,
      inputDescriptor,
      input.value,
      allocated.id,
      `${semanticPath}/inputs/${inputDescriptor.name}/value`
    )
    if (lowered.input !== null)
      allocated.block.inputs![inputDescriptor.name] = lowered.input
    else if (
      descriptor.requiredInputs.some(
        (entry) => entry.name === inputDescriptor.name
      )
    )
      return fail(
        'invalid-input',
        `${tree.opcode}.${inputDescriptor.name} is required and cannot be empty`
      )
  }
  return { rootId: allocated.id, tailId: allocated.id }
}

function buildStatementSequence(
  resolver: CuratedEntityResolverV1,
  state: BuildState,
  sequence: SemanticStatementSequenceV1,
  parentId: string | null,
  topLevel: boolean,
  workspace: { readonly x: number; readonly y: number } | undefined,
  semanticPath: string
): BuiltChain
{
  const validation = validateSemanticStatementSequence(sequence)
  if (!validation.valid)
    return fail(
      'invalid-shape',
      'statement sequence failed semantic validation'
    )
  if (sequence.blocks.length === 0)
    return fail('invalid-shape', 'statement sequence cannot be empty')
  let rootId = ''
  let tailId = ''
  for (const [index, tree] of sequence.blocks.entries())
  {
    const first = index === 0
    const chain = buildOrdinary(
      resolver,
      state,
      tree,
      first ? parentId : tailId,
      first && topLevel,
      first && topLevel ? 'topLevelStatement' : 'statementSequence',
      first && topLevel ? workspace : undefined,
      `${semanticPath}/blocks/${index}`
    )
    if (first) rootId = chain.rootId
    else state.blocks[tailId]!.next = chain.rootId
    tailId = chain.tailId
    const builtOpcode = state.blocks[chain.rootId]!.opcode
    const descriptor = curatedAuthorableDescriptorV1(builtOpcode)!
    if (
      descriptor.context.mustTerminateSequence &&
      index !== sequence.blocks.length - 1
    )
      return fail('invalid-shape', `${builtOpcode} must terminate its sequence`)
  }
  return { rootId, tailId }
}

function buildExpression(
  resolver: CuratedEntityResolverV1,
  state: BuildState,
  tree: SemanticExpressionBlockTreeV1,
  parentId: string | null,
  topLevel: boolean,
  placement: 'topLevelExpression' | 'reporterInput' | 'booleanInput',
  workspace: { readonly x: number; readonly y: number } | undefined,
  semanticPath: string
): BuiltChain
{
  const context = placement === 'booleanInput' ? 'boolean' : 'reporter'
  const validation = validateSemanticBlockTree(tree, context)
  if (!validation.valid)
    return fail(
      'invalid-shape',
      `expression failed ${context} semantic validation`
    )
  return buildOrdinary(
    resolver,
    state,
    tree,
    parentId,
    topLevel,
    placement,
    workspace,
    semanticPath
  )
}

export class CuratedCoreBlockLowererV1
{
  constructor(readonly resolveEntity: CuratedEntityResolverV1)
  {}

  lowerTopLevelRoot(
    project: ProjectIR,
    targetIndex: number,
    root: TopLevelScriptRootV1,
    workspace: { readonly x: number; readonly y: number }
  ): CuratedLoweredGraphV1
  {
    const state = stateFor(project, targetIndex)
    if (root.rootKind === 'statementSequence')
    {
      return finishGraph(
        state,
        buildStatementSequence(
          this.resolveEntity,
          state,
          root.value,
          null,
          true,
          workspace,
          '/root/value'
        )
      )
    }
    if (root.rootKind === 'expression')
    {
      return finishGraph(
        state,
        buildExpression(
          this.resolveEntity,
          state,
          root.value,
          null,
          true,
          'topLevelExpression',
          workspace,
          '/root/value'
        )
      )
    }
    const hatValidation = validateSemanticBlockTree(root.hat, 'eventHat')
    if (!hatValidation.valid)
      return fail('invalid-shape', 'event hat failed semantic validation')
    const hat = buildOrdinary(
      this.resolveEntity,
      state,
      root.hat,
      null,
      true,
      'eventScriptHat',
      workspace,
      '/root/hat'
    )
    let tailId = hat.tailId
    if (root.body !== undefined)
    {
      const body = buildStatementSequence(
        this.resolveEntity,
        state,
        root.body,
        hat.rootId,
        false,
        undefined,
        '/root/body'
      )
      state.blocks[hat.rootId]!.next = body.rootId
      tailId = body.tailId
    }
    return finishGraph(state, { rootId: hat.rootId, tailId })
  }

  lowerStatementSequence(
    project: ProjectIR,
    targetIndex: number,
    tree: SemanticStatementSequenceV1
  ): CuratedLoweredGraphV1
  {
    const state = stateFor(project, targetIndex)
    return finishGraph(
      state,
      buildStatementSequence(
        this.resolveEntity,
        state,
        tree,
        null,
        false,
        undefined,
        '/tree'
      )
    )
  }

  lowerReplacement(
    project: ProjectIR,
    targetIndex: number,
    replacement: SemanticReplacementV1
  ): CuratedLoweredGraphV1
  {
    const state = stateFor(project, targetIndex)
    return finishGraph(
      state,
      replacement.replacementKind === 'statementSequence'
        ? buildStatementSequence(
            this.resolveEntity,
            state,
            replacement.value,
            null,
            false,
            undefined,
            '/replacement/value'
          )
        : buildExpression(
            this.resolveEntity,
            state,
            replacement.value,
            null,
            false,
            replacement.value.nodeKind === 'ordinary' &&
              curatedAuthorableDescriptorV1(replacement.value.opcode)?.shape ===
                'boolean'
              ? 'booleanInput'
              : 'reporterInput',
            undefined,
            '/replacement/value'
          )
    )
  }

  lowerInputValue(
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    inputDescriptor: {
      readonly name: string
      readonly connection: CuratedCoreBlockDescriptorV1['requiredInputs'][number]['connection']
    },
    value: SemanticInputValueV1,
    currentInput?: BlockInput,
    preservedObscuredShadow?: BlockInput[2]
  ): CuratedLoweredInputValueV1
  {
    const state = stateFor(project, targetIndex)
    const owner = project.json.targets[targetIndex]?.blocks[ownerBlockId]
    if (owner === undefined || !isBlockEntry(owner))
      return fail('invalid-input', `owner block ${ownerBlockId} is absent`)
    const ownerDescriptor = curatedAuthorableDescriptorV1(owner.opcode)
    if (ownerDescriptor === null)
      return fail('unsupported-opcode', `${owner.opcode} is not authorable`)
    const required = ownerDescriptor.requiredInputs.find(
      (input) => input.name === inputDescriptor.name
    )
    const optional = ownerDescriptor.optionalInputs.find(
      (input) => input.name === inputDescriptor.name
    )
    const exactInputDescriptor = required ?? optional
    if (
      exactInputDescriptor === undefined ||
      exactInputDescriptor.connection !== inputDescriptor.connection
    )
    {
      return fail(
        'invalid-input',
        `${owner.opcode}.${inputDescriptor.name} does not match the catalog`
      )
    }
    if (value.valueKind === 'empty' && optional === undefined)
      return fail(
        'invalid-input',
        `${owner.opcode}.${inputDescriptor.name} is required and cannot be empty`
      )
    const lowered = lowerInput(
      this.resolveEntity,
      state,
      ownerDescriptor,
      exactInputDescriptor,
      value,
      ownerBlockId,
      '/value',
      currentInput,
      preservedObscuredShadow
    )
    return {
      input: lowered.input,
      rootId: lowered.chain?.rootId ?? null,
      tailId: lowered.chain?.tailId ?? null,
      blocks: state.blocks,
      blockIds: state.blockIds,
      aliasBlockIds: state.aliases,
      creationKeyByBlockId: state.creationKeys,
      catalogEvidence: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
      resolvedEntityReadEvidence: state.reads,
      allocatorEvidence: finishAllocator(state),
      allocatorCandidate: state.allocator,
    }
  }

  lowerFieldValue(
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    fieldName: string,
    value: SemanticFieldValueV1
  ): CuratedLoweredFieldValueV1
  {
    const state = stateFor(project, targetIndex)
    const owner = project.json.targets[targetIndex]?.blocks[ownerBlockId]
    if (owner === undefined || !isBlockEntry(owner))
      return fail('invalid-field', `owner block ${ownerBlockId} is absent`)
    const descriptor = curatedAuthorableDescriptorV1(owner.opcode)
    if (descriptor === null)
      return fail('unsupported-opcode', `${owner.opcode} is not authorable`)
    const fieldDescriptor = [
      ...descriptor.requiredFields,
      ...descriptor.optionalFields,
    ].find((field) => field.name === fieldName)
    if (fieldDescriptor === undefined)
      return fail(
        'invalid-field',
        `${owner.opcode}.${fieldName} does not match the catalog`
      )
    return {
      field: lowerField(
        this.resolveEntity,
        state,
        descriptor,
        fieldDescriptor,
        value,
        '/value'
      ),
      catalogEvidence: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
      resolvedEntityReadEvidence: state.reads,
      allocatorEvidence: finishAllocator(state),
      allocatorCandidate: state.allocator,
    }
  }
}
