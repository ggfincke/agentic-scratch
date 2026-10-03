// packages/ir/src/edit/standard-authoring/lowerer.ts
// lower standard semantic blocks through deterministic scoped graph construction

import type {
  Block,
  BlockField,
  BlockInput,
  InputPrimitive,
} from '@scratch-agent/sb3'
import type { ProjectIR } from '../../project/project-ir.js'
import type { Uids, UidSnapshot } from '../../core/uid.js'
import type {
  SemanticBlockTreeV1,
  SemanticFieldValueV1,
  SemanticInputValueV1,
  SemanticStatementSequenceV1,
  SemanticReplacementV1,
  TopLevelScriptRootV1,
  OrdinarySemanticBlockTreeV1,
  ProcedureCallBlockTreeV1,
  ProcedureCallArgumentV1,
} from '../contracts.generated.js'
import type {
  CuratedEntityResolverV1,
  CuratedResolvedEntityV1,
} from '../core-blocks/core-block-builder.js'
import type { GraphInputDescriptorV1 } from '../graph/block-operations.js'
import type { GraphInstalledClosureV1 } from '../graph/graph-primitives.js'
import {
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
  getStandardDescriptorV2,
  type StandardInputDescriptorV2,
  type StandardFieldDescriptorV2,
} from './catalog.js'
import {
  validateStandardSemanticTreeV2,
  validateStandardSemanticSequenceV2,
} from './semantic-validation.js'
import type {
  StandardAuthoringContextV2,
  StandardLoweringScopeV2,
  StandardProcedureScopeV2,
  StandardProcedureParameterV2,
} from './types.js'
import { procedurePlaceholderKinds } from '../semantic-index/procedure-mutation.js'
import { standardShapeFitsPlacementV2 } from './connection-policy.js'
import {
  standardNameReferenceIssueV2,
  standardSelectorValueV2,
} from './reference-policy.js'
import {
  sensingPropertyIsBuiltinV1,
  sensingPropertyLocalVariableIdsV1,
  sensingPropertyTargetCandidatesV1,
  selectedSensingPropertyTargetIndexV1,
} from '../semantic-index/sensing-property-policy.js'

export class StandardAuthoringErrorV2 extends Error
{
  constructor(
    readonly code: string,
    message: string
  )
  {
    super(message)
    this.name = 'StandardAuthoringErrorV2'
  }
}

interface State
{
  readonly project: ProjectIR
  readonly targetIndex: number
  readonly context: StandardAuthoringContextV2
  readonly scope: StandardProcedureScopeV2 | undefined
  readonly allocator: Uids
  readonly before: UidSnapshot
  readonly blocks: Record<string, Block>
  readonly blockIds: string[]
  readonly aliases: Record<string, string>
  readonly creationKeys: Record<string, string>
  readonly reads: (CuratedResolvedEntityV1 & {
    readonly referenceDomain: string
    readonly semanticPath: string
  })[]
}

export interface StandardLoweredGraphV2 extends GraphInstalledClosureV1
{
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
  readonly catalogEvidence: typeof STANDARD_AUTHORING_CATALOG_EVIDENCE_V2
  readonly resolvedEntityReadEvidence: State['reads']
  readonly allocatorEvidence: {
    readonly before: UidSnapshot
    readonly after: UidSnapshot
    readonly allocatedIds: readonly string[]
  }
  readonly allocatorCandidate: Uids
}

export interface StandardLoweredInputV2 extends Omit<
  StandardLoweredGraphV2,
  'rootId' | 'tailId'
>
{
  readonly rootId: string | null
  readonly tailId: string | null
  readonly input: BlockInput | null
}

function fail(code: string, message: string): never
{
  throw new StandardAuthoringErrorV2(code, message)
}

function record<T>(): Record<string, T>
{
  return Object.create(null) as Record<string, T>
}

function stateFor(
  project: ProjectIR,
  targetIndex: number,
  context: StandardAuthoringContextV2,
  scope: StandardLoweringScopeV2 = {}
): State
{
  if (project.json.targets[targetIndex] === undefined)
    fail('invalid-target', 'owner target is absent')
  const procedureScope = scope.procedureScope ?? context.procedureScope
  if (procedureScope !== undefined) assertScope(procedureScope)
  return {
    project,
    targetIndex,
    context,
    scope: procedureScope,
    allocator: project.uids.clone(),
    before: project.uids.snapshot(),
    blocks: record(),
    blockIds: [],
    aliases: record(),
    creationKeys: record(),
    reads: [],
  }
}

function assertScope(scope: StandardProcedureScopeV2): void
{
  const placeholders = procedurePlaceholderKinds(scope.proccode)
  if (
    !/^[a-f\d]{64}$/.test(scope.signatureSha256) ||
    typeof scope.warp !== 'boolean' ||
    scope.parameters.length > 256 ||
    placeholders.length !== scope.parameters.length
  )
    fail(
      'procedure-scope',
      'procedure scope has invalid signature or parameter count'
    )
  for (const key of ['localKey', 'argumentId', 'name'] as const)
    if (
      new Set(scope.parameters.map((x) => x[key])).size !==
        scope.parameters.length ||
      scope.parameters.some(
        (x) => typeof x[key] !== 'string' || x[key].length === 0
      )
    )
      fail(
        'procedure-scope',
        'procedure scope contains invalid or ambiguous parameter identity'
      )
  for (const [i, parameter] of scope.parameters.entries())
  {
    const expected =
      parameter.parameterType === 'boolean'
        ? 'b'
        : parameter.parameterType === 'number'
          ? 'n'
          : parameter.parameterType === 'stringOrNumber'
            ? 's'
            : null
    if (
      expected !== placeholders[i] ||
      (expected === 'b' && typeof parameter.defaultValue !== 'boolean') ||
      (expected !== 'b' &&
        typeof parameter.defaultValue !== 'string' &&
        typeof parameter.defaultValue !== 'number') ||
      (typeof parameter.defaultValue === 'number' &&
        !Number.isFinite(parameter.defaultValue))
    )
      fail(
        'procedure-scope',
        'procedure scope parameter differs from signature'
      )
  }
}

function defaultShadowValue(
  state: State,
  descriptor: StandardInputDescriptorV2
): string
{
  if (
    descriptor.referenceDomain === 'costume' ||
    descriptor.referenceDomain === 'backdrop'
  )
    return (
      state.project.json.targets[
        descriptor.referenceDomain === 'backdrop'
          ? stageIndex(state)
          : state.targetIndex
      ]!.costumes[0]?.name ?? ''
    )
  if (descriptor.referenceDomain === 'sound')
    return state.project.json.targets[state.targetIndex]!.sounds[0]?.name ?? ''
  return descriptor.canonicalShadow?.value ?? ''
}

function allocate(
  state: State,
  opcode: string,
  parent: string | null,
  path: string,
  alias?: string,
  shadow = false
): string
{
  const id = state.allocator.next('b')
  state.blocks[id] = Object.assign(record(), {
    opcode,
    next: null,
    parent,
    inputs: record<BlockInput>(),
    fields: record<BlockField>(),
    shadow,
    topLevel: false,
  }) as Block
  state.blockIds.push(id)
  state.creationKeys[id] = path
  if (alias !== undefined)
  {
    if (Object.hasOwn(state.aliases, alias))
      fail('duplicate-alias', `duplicate local alias ${alias}`)
    state.aliases[alias] = id
  }
  return id
}

function evidence(state: State)
{
  return {
    blocks: state.blocks,
    blockIds: state.blockIds,
    aliasBlockIds: state.aliases,
    creationKeyByBlockId: state.creationKeys,
    catalogEvidence: STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
    resolvedEntityReadEvidence: state.reads,
    allocatorEvidence: {
      before: state.before,
      after: state.allocator.snapshot(),
      allocatedIds: state.blockIds,
    },
    allocatorCandidate: state.allocator,
  }
}

function top(
  state: State,
  id: string,
  workspace: { readonly x: number; readonly y: number }
): void
{
  if (!Number.isFinite(workspace.x) || !Number.isFinite(workspace.y))
    fail('invalid-workspace', 'workspace coordinates must be finite')
  Object.assign(state.blocks[id]!, {
    parent: null,
    topLevel: true,
    x: workspace.x,
    y: workspace.y,
  })
}

function resolve(
  state: State,
  reference: Extract<SemanticInputValueV1, { valueKind: 'entity' }>['value'],
  domain: string,
  path: string,
  owner = state.targetIndex,
  specialNames: readonly string[] = []
): CuratedResolvedEntityV1
{
  const subtype =
    domain === 'target' ? 'sprite' : domain === 'backdrop' ? 'costume' : domain
  const kind =
    subtype === 'sprite'
      ? 'target'
      : ['costume', 'sound'].includes(subtype)
        ? 'media'
        : 'declaration'
  const entity = state.context.resolveEntity({
    reference,
    expectedEntityKind: kind,
    expectedEntitySubtype: subtype,
    referenceDomain: domain,
    ownerTargetIndex: owner,
    semanticPath: path,
  })
  if (
    entity.entityKind !== kind ||
    entity.entitySubtype !== subtype ||
    entity.displayName.length === 0 ||
    entity.serializedId.length === 0 ||
    !/^[a-f\d]{64}$/.test(entity.semanticLineageSha256) ||
    !/^[a-f\d]{64}$/.test(entity.semanticFingerprintSha256)
  )
    fail(
      'invalid-entity-resolution',
      'entity resolver returned incomplete or incompatible evidence'
    )
  if (kind === 'media' && entity.ownerTargetIndex !== owner)
    fail('invalid-entity-resolution', 'media belongs to another target')
  const representationIssue = standardNameReferenceIssueV2(
    state.project.json,
    owner,
    domain,
    entity.displayName,
    specialNames
  )
  if (representationIssue)
    fail('invalid-entity-resolution', `${path}: ${representationIssue}`)
  if (
    kind === 'declaration' &&
    domain !== 'broadcast' &&
    entity.ownerTargetIndex !== owner &&
    entity.ownerTargetIndex !==
      state.project.json.targets.findIndex((x) => x.isStage)
  )
    fail(
      'invalid-entity-resolution',
      'declaration is not visible to the selected target'
    )
  state.reads.push({ ...entity, referenceDomain: domain, semanticPath: path })
  return entity
}

function stageIndex(state: State): number
{
  const index = state.project.json.targets.findIndex((x) => x.isStage)
  if (index < 0) fail('invalid-target', 'project has no stage')
  return index
}

function scalar(value: string | number | boolean): string | number
{
  return typeof value === 'boolean' ? String(value) : value
}

function selectorToken(
  descriptor: StandardInputDescriptorV2,
  token: string
): string
{
  if (!descriptor.specialTokens.includes(token))
    fail(
      'invalid-input',
      `selector ${token} is not valid at ${descriptor.name}`
    )
  return standardSelectorValueV2(descriptor.referenceDomain, token)
}

function shadowInput(
  state: State,
  owner: string,
  descriptor: StandardInputDescriptorV2,
  value: string | number,
  path: string,
  entity?: CuratedResolvedEntityV1
): BlockInput
{
  const shadow = descriptor.canonicalShadow
  if (shadow === null)
    fail('invalid-input', 'input has no literal shadow policy')
  if (shadow.sb3PrimitiveTag !== null)
  {
    const primitive =
      shadow.sb3PrimitiveTag === 11
        ? [
            11,
            String(value),
            entity?.serializedId ??
              fail(
                'invalid-input',
                'broadcast literal requires an exact declaration'
              ),
          ]
        : [shadow.sb3PrimitiveTag, value]
    return [1, primitive as InputPrimitive]
  }
  const id = allocate(
    state,
    shadow.opcode,
    owner,
    `${path}/shadow`,
    undefined,
    true
  )
  state.blocks[id]!.fields![shadow.field!] = [value]
  return [1, id]
}

function lowerInput(
  state: State,
  owner: string,
  descriptor: StandardInputDescriptorV2,
  value: SemanticInputValueV1,
  path: string,
  preserved?: BlockInput[2]
): BlockInput | null
{
  if (value.valueKind === 'empty')
  {
    if (
      descriptor.connection !== 'boolean' &&
      descriptor.connection !== 'substack'
    )
      fail('invalid-input', 'required input cannot be empty')
    return null
  }
  if (descriptor.connection === 'substack')
  {
    if (value.valueKind !== 'statementSequence')
      fail('invalid-input', 'substack requires a sequence')
    return [
      2,
      lowerSequence(state, value.value, owner, `${path}/sequence`).rootId,
    ]
  }
  if (value.valueKind === 'statementSequence')
    fail('invalid-input', 'expression input cannot contain statements')
  if (value.valueKind === 'block')
  {
    const child = lowerTree(
      state,
      value.value,
      owner,
      `${path}/block`,
      descriptor.connection === 'boolean' ? 'boolean' : 'reporter'
    )
    if (descriptor.connection === 'boolean') return [2, child]
    if (descriptor.referenceDomain === 'broadcast' && preserved === undefined)
      return [2, child]
    if (
      state.blocks[owner] === undefined &&
      descriptor.canonicalShadow?.sb3PrimitiveTag === null &&
      preserved === undefined
    )
      return [2, child]
    const fallback =
      preserved === undefined
        ? shadowInput(
            state,
            owner,
            descriptor,
            defaultShadowValue(state, descriptor),
            `${path}/fallback`
          )[1]
        : preserved
    return [
      3,
      child,
      fallback ?? fail('invalid-input', 'required fallback shadow is absent'),
    ]
  }
  if (descriptor.connection === 'boolean')
    fail('invalid-input', 'boolean socket requires a reporter or empty input')
  if (value.valueKind === 'entity')
  {
    if (descriptor.referenceDomain === null)
      fail('invalid-input', 'input cannot contain an entity reference')
    const entity = resolve(
      state,
      value.value,
      descriptor.referenceDomain,
      path,
      descriptor.referenceDomain === 'backdrop'
        ? stageIndex(state)
        : state.targetIndex,
      descriptor.specialTokens.map((token) =>
        standardSelectorValueV2(descriptor.referenceDomain, token)
      )
    )
    return shadowInput(
      state,
      owner,
      descriptor,
      entity.displayName,
      path,
      entity
    )
  }
  if (value.valueKind === 'special')
  {
    const expectedDomain =
      descriptor.referenceDomain === 'target'
        ? 'targetSelector'
        : descriptor.referenceDomain === 'backdrop'
          ? 'backdropSelector'
          : descriptor.referenceDomain === 'costume'
            ? 'costumeSelector'
            : null
    if (value.value.domain !== expectedDomain)
      fail('invalid-input', 'special selector domain differs from input policy')
    const token = selectorToken(descriptor, value.value.token)
    const representationIssue = standardNameReferenceIssueV2(
      state.project.json,
      state.targetIndex,
      descriptor.referenceDomain,
      token,
      [],
      true
    )
    if (representationIssue)
      fail('invalid-input', `${path}: ${representationIssue}`)
    return shadowInput(state, owner, descriptor, token, path)
  }
  if (descriptor.referenceDomain === 'broadcast')
    fail(
      'invalid-input',
      'broadcast input requires an exact declaration or reporter'
    )
  const literal = scalar(value.value)
  if (typeof literal === 'number' && !Number.isFinite(literal))
    fail('invalid-input', 'numeric literal must be finite')
  if (
    descriptor.semanticDomain === 'color' &&
    (typeof literal !== 'string' || !/^#[a-f\d]{6}$/i.test(literal))
  )
    fail('invalid-input', 'color literal must be a six-digit hex string')
  return shadowInput(state, owner, descriptor, literal, path)
}

function selectedSensingTarget(
  state: State,
  node: OrdinarySemanticBlockTreeV1,
  path: string
): number | null
{
  const input = node.inputs.find((x) => x.name === 'OBJECT')?.value
  if (input?.valueKind === 'special' && input.value.token === 'stage')
    return stageIndex(state)
  if (input?.valueKind === 'entity')
  {
    const entity = resolve(state, input.value, 'target', `${path}/OBJECT`)
    const serializedIndex = /^target:(\d+)$/.exec(entity.serializedId)?.[1]
    const index =
      serializedIndex === undefined
        ? entity.ownerTargetIndex
        : Number(serializedIndex)
    if (
      index !== null &&
      !state.project.json.targets[index]?.isStage &&
      state.project.json.targets[index]?.name === entity.displayName
    )
      return index
    const matches = state.project.json.targets.flatMap((target, i) =>
      !target.isStage && target.name === entity.displayName ? [i] : []
    )
    return matches.length === 1 ? matches[0]! : null
  }
  if (input?.valueKind === 'literal')
  {
    const matches = sensingPropertyTargetCandidatesV1(
      state.project.json.targets,
      String(input.value)
    )
    return matches.length === 1
      ? state.project.json.targets.indexOf(matches[0]!)
      : null
  }
  return null
}

function lowerField(
  state: State,
  descriptor: StandardFieldDescriptorV2,
  value: SemanticFieldValueV1,
  path: string,
  selectedOwner: number | null = null
): BlockField
{
  if (value.valueKind === 'entity')
  {
    if (descriptor.referenceDomain === null)
      fail('invalid-field', 'field does not admit an entity reference')
    const owner =
      descriptor.kind === 'sensingProperty'
        ? (selectedOwner ??
          fail(
            'invalid-field',
            'variable property requires an exact selected sensing target'
          ))
        : descriptor.referenceDomain === 'backdrop'
          ? stageIndex(state)
          : state.targetIndex
    const entity = resolve(
      state,
      value.value,
      descriptor.referenceDomain,
      path,
      owner
    )
    if (
      descriptor.kind === 'sensingProperty' &&
      entity.ownerTargetIndex !== owner
    )
      fail('invalid-field', 'sensing property belongs to another target')
    if (
      descriptor.kind === 'sensingProperty' &&
      sensingPropertyIsBuiltinV1(
        state.project.json.targets[owner]!,
        entity.displayName
      )
    )
      fail(
        'invalid-field',
        'exact variable property name resolves to a selected-target builtin'
      )
    if (
      descriptor.kind === 'sensingProperty' &&
      sensingPropertyLocalVariableIdsV1(
        state.project.json.targets[owner]!,
        entity.displayName
      ).length !== 1
    )
      fail(
        'invalid-field',
        'exact variable property name is absent or ambiguous on the selected target'
      )
    return descriptor.kind === 'sensingProperty' || descriptor.kind === 'media'
      ? [entity.displayName]
      : [entity.displayName, entity.serializedId]
  }
  if (descriptor.kind === 'declaration' || descriptor.kind === 'media')
    fail('invalid-field', 'reference field requires an exact entity')
  const v = scalar(value.value)
  if (descriptor.choices.length > 0 && !descriptor.choices.includes(String(v)))
    fail('invalid-field', 'field value is absent from the exact enum')
  if (descriptor.kind === 'sensingProperty' && selectedOwner !== null)
  {
    if (
      !sensingPropertyIsBuiltinV1(
        state.project.json.targets[selectedOwner]!,
        String(v)
      )
    )
      fail(
        'invalid-field',
        'builtin property does not belong to selected target kind'
      )
  }
  return [v]
}

function parameter(
  state: State,
  reference: Extract<
    SemanticBlockTreeV1,
    { nodeKind: 'parameterReporter' }
  >['parameter'],
  path: string
): StandardProcedureParameterV2
{
  if (reference.refKind === 'procedureLocalParameter')
  {
    return (
      state.scope?.parameters.find((x) => x.localKey === reference.localKey) ??
      fail(
        'parameter-scope',
        'local parameter is outside explicit procedure scope'
      )
    )
  }
  const resolved =
    state.context.resolveParameter?.({
      reference,
      ownerTargetIndex: state.targetIndex,
      semanticPath: path,
    }) ?? fail('parameter-scope', 'parameter resolver is unavailable')
  if (
    state.scope === undefined ||
    resolved.ownerTargetIndex !== state.targetIndex ||
    resolved.proccode !== state.scope.proccode ||
    resolved.signatureSha256 !== state.scope.signatureSha256 ||
    !state.scope.parameters.some((x) => x.argumentId === resolved.argumentId)
  )
    fail(
      'parameter-scope',
      'parameter reporter does not belong to enclosing procedure'
    )
  return resolved
}

function procedureArgumentDescriptor(
  param: StandardProcedureParameterV2
): StandardInputDescriptorV2
{
  const tag = param.parameterType === 'number' ? 4 : 10
  return {
    name: param.argumentId,
    connection:
      param.parameterType === 'boolean'
        ? 'boolean'
        : param.parameterType === 'number'
          ? 'number'
          : 'stringOrNumber',
    semanticDomain: 'procedure-argument',
    canonicalShadow:
      param.parameterType === 'boolean'
        ? null
        : {
            kind: 'primitive',
            opcode: tag === 4 ? 'math_number' : 'text',
            sb3PrimitiveTag: tag,
            value: String(param.defaultValue),
            fallbackDisplayValue: String(param.defaultValue),
          },
    choices: [],
    specialTokens: [],
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

function lowerTree(
  state: State,
  node: SemanticBlockTreeV1,
  parent: string | null,
  path: string,
  placement: 'statement' | 'reporter' | 'boolean' | 'eventHat'
): string
{
  if (node.nodeKind === 'parameterReporter')
  {
    const param = parameter(state, node.parameter, path)
    if (
      !standardShapeFitsPlacementV2(
        param.parameterType === 'boolean' ? 'boolean' : 'reporter',
        placement
      )
    )
      fail('invalid-shape', 'parameter reporter has incompatible placement')
    const id = allocate(
      state,
      param.parameterType === 'boolean'
        ? 'argument_reporter_boolean'
        : 'argument_reporter_string_number',
      parent,
      path,
      node.localAlias
    )
    state.blocks[id]!.fields!.VALUE = [param.name]
    return id
  }
  if (node.nodeKind === 'procedureCall')
  {
    if (placement !== 'statement')
      fail('invalid-shape', 'procedure call requires statement placement')
    const scope =
      node.procedure.refKind === 'selfProcedure'
        ? (state.scope ??
          fail('procedure-scope', 'self call requires an explicit scope'))
        : (state.context.resolveProcedure?.({
            reference: node.procedure,
            ownerTargetIndex: state.targetIndex,
            semanticPath: path,
          }) ?? fail('procedure-scope', 'procedure resolver is unavailable'))
    assertScope(scope)
    if (
      'ownerTargetIndex' in scope &&
      scope.ownerTargetIndex !== state.targetIndex
    )
      fail('procedure-scope', 'procedure belongs to another target')
    if (node.expectedSignatureSha256 !== scope.signatureSha256)
      fail('procedure-signature', 'procedure signature precondition differs')
    const id = allocate(state, 'procedures_call', parent, path, node.localAlias)
    state.blocks[id]!.mutation = {
      tagName: 'mutation',
      children: [],
      proccode: scope.proccode,
      argumentids: JSON.stringify(scope.parameters.map((x) => x.argumentId)),
      warp: String(scope.warp),
    }
    const seen = new Set<string>()
    for (const [i, argument] of node.arguments.entries())
    {
      const reference = argument.parameter
      const param =
        reference.refKind === 'procedureLocalParameter'
          ? scope.parameters.find((x) => x.localKey === reference.localKey)
          : state.context.resolveParameter?.({
              reference,
              ownerTargetIndex: state.targetIndex,
              semanticPath: `${path}/arguments/${i}`,
            })
      if (
        param === undefined ||
        !scope.parameters.some(
          (x) =>
            x.argumentId === param.argumentId &&
            x.name === param.name &&
            x.parameterType === param.parameterType
        ) ||
        ('ownerTargetIndex' in param &&
          (param.ownerTargetIndex !== state.targetIndex ||
            !('proccode' in param) ||
            param.proccode !== scope.proccode ||
            !('signatureSha256' in param) ||
            param.signatureSha256 !== scope.signatureSha256)) ||
        seen.has(param.argumentId)
      )
        fail(
          'procedure-argument',
          'argument is absent, duplicated or belongs to another procedure'
        )
      seen.add(param.argumentId)
      const lowered = lowerInput(
        state,
        id,
        procedureArgumentDescriptor(param),
        argument.value,
        `${path}/arguments/${i}`
      )
      state.blocks[id]!.inputs![param.argumentId] = lowered ?? [2, null]
    }
    if (seen.size !== scope.parameters.length)
      fail('procedure-argument', 'call must explicitly supply every parameter')
    return id
  }
  const descriptor = getStandardDescriptorV2(node.opcode)
  if (descriptor === null || descriptor.availability !== 'supported')
    fail('unsupported-opcode', 'opcode is not public ordinary authoring')
  if (!standardShapeFitsPlacementV2(descriptor.shape, placement))
    fail('invalid-shape', 'ordinary block has incompatible placement')
  if (
    !descriptor.context.ownerTargets.includes(
      state.project.json.targets[state.targetIndex]!.isStage
        ? 'stage'
        : 'sprite'
    )
  )
    fail('invalid-target', 'block owner kind is incompatible')
  const id = allocate(state, node.opcode, parent, path, node.localAlias)
  const selectedOwner =
    node.opcode === 'sensing_of'
      ? selectedSensingTarget(state, node, path)
      : null
  for (const entry of descriptor.requiredFields)
  {
    const value =
      node.fields.find((x) => x.name === entry.name)?.value ??
      fail('invalid-field', `required field ${entry.name} is absent`)
    state.blocks[id]!.fields![entry.name] = lowerField(
      state,
      entry,
      value,
      `${path}/fields/${entry.name}`,
      selectedOwner
    )
  }
  if (node.opcode === 'control_stop')
    state.blocks[id]!.mutation = {
      tagName: 'mutation',
      children: [],
      hasnext: String(
        state.blocks[id]!.fields!.STOP_OPTION![0] === 'other scripts in sprite'
      ),
    }
  for (const entry of [
    ...descriptor.requiredInputs,
    ...descriptor.optionalInputs,
  ])
  {
    const value = node.inputs.find((x) => x.name === entry.name)?.value
    if (value === undefined) continue
    const lowered = lowerInput(
      state,
      id,
      entry,
      value,
      `${path}/inputs/${entry.name}`
    )
    if (lowered !== null) state.blocks[id]!.inputs![entry.name] = lowered
  }
  return id
}

function lowerSequence(
  state: State,
  sequence: SemanticStatementSequenceV1,
  parent: string | null,
  path: string
): { rootId: string; tailId: string }
{
  let rootId: string | null = null
  let previous: string | null = null
  for (const [i, node] of sequence.blocks.entries())
  {
    const id = lowerTree(
      state,
      node,
      previous ?? parent,
      `${path}/blocks/${i}`,
      'statement'
    )
    if (previous !== null) state.blocks[previous]!.next = id
    rootId ??= id
    previous = id
  }
  return {
    rootId: rootId ?? fail('invalid-shape', 'sequence is empty'),
    tailId: previous!,
  }
}

function validate(
  state: State,
  tree: SemanticBlockTreeV1 | SemanticStatementSequenceV1,
  placement: 'statement' | 'reporter' | 'boolean' | 'eventHat' | 'any' = 'any'
): void
{
  const options = {
    targetKind: state.project.json.targets[state.targetIndex]!.isStage
      ? ('stage' as const)
      : ('sprite' as const),
    procedureScope: state.scope,
    placement,
    procedureCallParameterType: (
      call: ProcedureCallBlockTreeV1,
      argument: ProcedureCallArgumentV1
    ) =>
    {
      const scope =
        call.procedure.refKind === 'selfProcedure'
          ? state.scope
          : state.context.resolveProcedure?.({
              reference: call.procedure,
              ownerTargetIndex: state.targetIndex,
              semanticPath: 'validation/procedureCall',
            })
      const reference = argument.parameter
      const parameter =
        reference.refKind === 'procedureLocalParameter'
          ? scope?.parameters.find(
              (parameter) => parameter.localKey === reference.localKey
            )
          : state.context.resolveParameter?.({
              reference,
              ownerTargetIndex: state.targetIndex,
              semanticPath: 'validation/procedureCall/argument',
            })
      return scope?.parameters.some(
        (candidate) =>
          candidate.argumentId === parameter?.argumentId &&
          candidate.parameterType === parameter.parameterType
      )
        ? parameter?.parameterType
        : undefined
    },
  }
  const result =
    'blocks' in tree
      ? validateStandardSemanticSequenceV2(tree, options)
      : validateStandardSemanticTreeV2(tree, options)
  if (result.issues.length > 0)
    fail(
      result.issues[0]!.code,
      `${result.issues[0]!.path}: ${result.issues[0]!.message}`
    )
}

export class StandardBlockLowererV2
{
  private readonly context: StandardAuthoringContextV2

  constructor(context: StandardAuthoringContextV2 | CuratedEntityResolverV1)
  {
    this.context =
      typeof context === 'function' ? { resolveEntity: context } : context
  }

  lowerStatementSequence(
    project: ProjectIR,
    targetIndex: number,
    sequence: SemanticStatementSequenceV1,
    scope: StandardLoweringScopeV2 = {}
  ): StandardLoweredGraphV2
  {
    const s = stateFor(project, targetIndex, this.context, scope)
    validate(s, sequence)
    return { ...lowerSequence(s, sequence, null, 'sequence'), ...evidence(s) }
  }

  lowerTopLevelRoot(
    project: ProjectIR,
    targetIndex: number,
    root: TopLevelScriptRootV1,
    workspace: { readonly x: number; readonly y: number },
    scope: StandardLoweringScopeV2 = {}
  ): StandardLoweredGraphV2
  {
    const s = stateFor(project, targetIndex, this.context, scope)
    let chain: { rootId: string; tailId: string }
    if (root.rootKind === 'statementSequence')
    {
      validate(s, root.value)
      chain = lowerSequence(s, root.value, null, 'root/value')
    }
    else if (root.rootKind === 'expression')
    {
      validate(s, root.value)
      const shape =
        root.value.nodeKind === 'ordinary'
          ? getStandardDescriptorV2(root.value.opcode)?.shape
          : parameter(s, root.value.parameter, 'root/value').parameterType ===
              'boolean'
            ? 'boolean'
            : 'reporter'
      const id = lowerTree(
        s,
        root.value,
        null,
        'root/value',
        shape === 'boolean' ? 'boolean' : 'reporter'
      )
      chain = { rootId: id, tailId: id }
    }
    else
    {
      validate(s, root.hat, 'eventHat')
      const id = lowerTree(s, root.hat, null, 'root/hat', 'eventHat')
      chain = { rootId: id, tailId: id }
      if (root.body !== undefined)
      {
        validate(s, root.body)
        const body = lowerSequence(s, root.body, id, 'root/body')
        s.blocks[id]!.next = body.rootId
        chain.tailId = body.tailId
      }
    }
    top(s, chain.rootId, workspace)
    return { ...chain, ...evidence(s) }
  }

  lowerReplacement(
    project: ProjectIR,
    targetIndex: number,
    replacement: SemanticReplacementV1,
    scope: StandardLoweringScopeV2 = {}
  ): StandardLoweredGraphV2
  {
    if (replacement.replacementKind === 'statementSequence')
      return this.lowerStatementSequence(
        project,
        targetIndex,
        replacement.value,
        scope
      )
    const s = stateFor(project, targetIndex, this.context, scope)
    validate(s, replacement.value)
    const shape =
      replacement.value.nodeKind === 'ordinary'
        ? getStandardDescriptorV2(replacement.value.opcode)?.shape
        : parameter(s, replacement.value.parameter, 'replacement')
              .parameterType === 'boolean'
          ? 'boolean'
          : 'reporter'
    const id = lowerTree(
      s,
      replacement.value,
      null,
      'replacement',
      shape === 'boolean' ? 'boolean' : 'reporter'
    )
    return { rootId: id, tailId: id, ...evidence(s) }
  }

  lowerInputValue(
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    input: GraphInputDescriptorV1,
    value: SemanticInputValueV1,
    _currentInput?: BlockInput,
    preservedObscuredShadow?: BlockInput[2],
    scope: StandardLoweringScopeV2 = {}
  ): StandardLoweredInputV2
  {
    const s = stateFor(project, targetIndex, this.context, scope)
    const owner = project.json.targets[targetIndex]!.blocks[ownerBlockId]
    if (owner === undefined || Array.isArray(owner))
      fail('invalid-input', 'input owner is absent')
    let descriptor = [
      ...(getStandardDescriptorV2(owner.opcode)?.requiredInputs ?? []),
      ...(getStandardDescriptorV2(owner.opcode)?.optionalInputs ?? []),
    ].find((x) => x.name === input.name)
    if (owner.opcode === 'procedures_call' && s.scope !== undefined)
      descriptor =
        s.scope.parameters.find((x) => x.argumentId === input.name) ===
        undefined
          ? undefined
          : procedureArgumentDescriptor(
              s.scope.parameters.find((x) => x.argumentId === input.name)!
            )
    if (descriptor === undefined || descriptor.connection !== input.connection)
      fail('invalid-input', 'input descriptor differs from authority')
    if (preservedObscuredShadow !== undefined)
    {
      const currentShadow =
        _currentInput?.[0] === 1
          ? _currentInput[1]
          : _currentInput?.[0] === 3
            ? _currentInput[2]
            : undefined
      if (
        currentShadow === undefined ||
        JSON.stringify(currentShadow) !==
          JSON.stringify(preservedObscuredShadow) ||
        descriptor.connection === 'boolean' ||
        descriptor.connection === 'substack'
      )
        fail(
          'invalid-input',
          'preserved shadow differs from exact compatible current shadow'
        )
    }
    if (value.valueKind === 'block')
      validate(
        s,
        value.value,
        descriptor.connection === 'boolean' ? 'boolean' : 'reporter'
      )
    if (value.valueKind === 'statementSequence') validate(s, value.value)
    const lowered = lowerInput(
      s,
      ownerBlockId,
      descriptor,
      value,
      'input',
      preservedObscuredShadow
    )
    const root = lowered?.[1]
    const rootId =
      typeof root === 'string' && Object.hasOwn(s.blocks, root)
        ? root
        : (s.blockIds[0] ?? null)
    let tailId = rootId
    while (tailId !== null && typeof s.blocks[tailId]?.next === 'string')
      tailId = s.blocks[tailId]!.next!
    return { input: lowered, rootId, tailId, ...evidence(s) }
  }

  lowerFieldValue(
    project: ProjectIR,
    targetIndex: number,
    ownerBlockId: string,
    fieldName: string,
    value: SemanticFieldValueV1
  )
  {
    const s = stateFor(project, targetIndex, this.context)
    const owner = project.json.targets[targetIndex]!.blocks[ownerBlockId]
    if (owner === undefined || Array.isArray(owner))
      fail('invalid-field', 'field owner is absent')
    const descriptor = getStandardDescriptorV2(
      owner.opcode
    )?.requiredFields.find((x) => x.name === fieldName)
    if (descriptor === undefined)
      fail('invalid-field', 'field is absent from authority')
    let selectedOwner: number | null = null
    if (owner.opcode === 'sensing_of')
      selectedOwner = selectedSensingPropertyTargetIndexV1(
        project.json,
        targetIndex,
        owner
      )
    return {
      field: lowerField(s, descriptor, value, 'field', selectedOwner),
      ...evidence(s),
    }
  }
}
