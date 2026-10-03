// packages/ir/src/edit/standard-authoring/semantic-validation.ts
// validate standard semantic trees without changing the frozen A0 validator

import type {
  OrdinarySemanticBlockTreeV1,
  SemanticBlockTreeV1,
  SemanticInputValueV1,
  SemanticStatementSequenceV1,
  ProcedureCallBlockTreeV1,
  ProcedureCallArgumentV1,
} from '../contracts.generated.js'
import type { ProcedureParameterTypeV1 } from '../contracts/procedure-parameter-catalog.js'
import {
  getStandardDescriptorV2,
  type StandardAuthoringDescriptorV2,
} from './catalog.js'
import type { StandardProcedureScopeV2 } from './types.js'
import { standardShapeFitsPlacementV2 as allowedShape } from './connection-policy.js'

export interface StandardSemanticIssueV2
{
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface StandardSemanticValidationOptionsV2
{
  readonly targetKind?: 'stage' | 'sprite'
  readonly procedureParameters?: ReadonlyMap<string, ProcedureParameterTypeV1>
  readonly placement?: 'any' | 'statement' | 'reporter' | 'boolean' | 'eventHat'
  readonly procedureScope?: StandardProcedureScopeV2
  readonly procedureCallParameterType?: (
    call: ProcedureCallBlockTreeV1,
    argument: ProcedureCallArgumentV1
  ) => ProcedureParameterTypeV1 | undefined
}

interface ValidationState
{
  readonly issues: StandardSemanticIssueV2[]
  readonly aliases: Set<string>
  readonly active: Set<object>
  readonly options: StandardSemanticValidationOptionsV2
  count: number
}

function issue(
  state: ValidationState,
  code: string,
  path: string,
  message: string
): void
{
  state.issues.push({ code, path, message })
}

function value(
  state: ValidationState,
  input: SemanticInputValueV1,
  path: string,
  depth: number,
  descriptor: StandardAuthoringDescriptorV2['requiredInputs'][number]
): void
{
  if (
    input === null ||
    typeof input !== 'object' ||
    ![
      'literal',
      'entity',
      'special',
      'block',
      'statementSequence',
      'empty',
    ].includes(input.valueKind)
  )
  {
    issue(state, 'input-shape', path, 'input must be a semantic input value')
    return
  }
  if (input.valueKind === 'empty')
  {
    if (
      descriptor.connection !== 'boolean' &&
      descriptor.connection !== 'substack'
    )
      issue(state, 'input-empty', path, 'required input cannot be empty')
    return
  }
  if (descriptor.connection === 'substack')
  {
    if (input.valueKind !== 'statementSequence')
      issue(
        state,
        'input-shape',
        path,
        'substack requires a statement sequence'
      )
    else sequence(state, input.value, path, depth + 1)
    return
  }
  if (input.valueKind === 'statementSequence')
  {
    issue(
      state,
      'input-shape',
      path,
      'expression input cannot contain a statement sequence'
    )
    return
  }
  if (input.valueKind === 'block')
  {
    tree(
      state,
      input.value,
      path,
      depth + 1,
      descriptor.connection === 'boolean' ? 'boolean' : 'reporter'
    )
    return
  }
  if (descriptor.connection === 'boolean')
  {
    issue(
      state,
      'input-shape',
      path,
      'boolean socket requires a boolean reporter or empty value'
    )
    return
  }
  if (input.valueKind === 'entity' && descriptor.referenceDomain === null)
    issue(
      state,
      'input-reference',
      path,
      'input does not admit an entity reference'
    )
  if (
    input.valueKind === 'special' &&
    (input.value === null ||
      typeof input.value !== 'object' ||
      !descriptor.specialTokens.includes(input.value.token))
  )
    issue(
      state,
      'input-special',
      path,
      'special selector is not valid at this input'
    )
  if (input.valueKind === 'literal')
  {
    if (!['string', 'number', 'boolean'].includes(typeof input.value))
      issue(state, 'input-literal', path, 'literal must be a Scratch scalar')
    if (typeof input.value === 'number' && !Number.isFinite(input.value))
      issue(state, 'input-literal', path, 'numeric literal must be finite')
    if (
      descriptor.semanticDomain === 'color' &&
      (typeof input.value !== 'string' || !/^#[\da-f]{6}$/i.test(input.value))
    )
      issue(
        state,
        'input-color',
        path,
        'color literal must be an exact six-digit hex color'
      )
  }
}

function tree(
  state: ValidationState,
  node: SemanticBlockTreeV1,
  path: string,
  depth: number,
  placement: StandardSemanticValidationOptionsV2['placement']
): void
{
  if (
    node === null ||
    typeof node !== 'object' ||
    !['ordinary', 'procedureCall', 'parameterReporter'].includes(node.nodeKind)
  )
  {
    issue(state, 'tree-shape', path, 'node must be a semantic block tree')
    return
  }
  if (depth > 64 || state.count >= 4096)
  {
    issue(
      state,
      'tree-budget',
      path,
      'semantic tree exceeds depth or block budget'
    )
    return
  }
  if (state.active.has(node))
  {
    issue(state, 'tree-cycle', path, 'semantic tree has a cycle')
    return
  }
  state.active.add(node)
  state.count++
  if (node.localAlias !== undefined)
  {
    if (
      typeof node.localAlias !== 'string' ||
      node.localAlias.length === 0 ||
      state.aliases.has(node.localAlias)
    )
      issue(
        state,
        'duplicate-alias',
        `${path}/localAlias`,
        'local alias must be nonempty and unique in the closure'
      )
    state.aliases.add(node.localAlias)
  }
  if (node.nodeKind === 'parameterReporter')
  {
    if (node.parameter === null || typeof node.parameter !== 'object')
    {
      issue(state, 'parameter-scope', path, 'parameter reference is absent')
      state.active.delete(node)
      return
    }
    const localKey =
      node.parameter.refKind === 'procedureLocalParameter'
        ? node.parameter.localKey
        : null
    const type =
      localKey === null
        ? null
        : (state.options.procedureParameters?.get(localKey) ??
          state.options.procedureScope?.parameters.find(
            (x) => x.localKey === localKey
          )?.parameterType)
    if (localKey !== null && type === undefined)
      issue(
        state,
        'parameter-scope',
        path,
        'local parameter is absent from the explicit procedure scope'
      )
    if (
      placement === 'statement' ||
      placement === 'eventHat' ||
      (type !== null &&
        type !== undefined &&
        !allowedShape(type === 'boolean' ? 'boolean' : 'reporter', placement))
    )
      issue(
        state,
        'node-placement',
        path,
        'parameter reporter has the wrong connection shape'
      )
  }
  else if (node.nodeKind === 'procedureCall')
  {
    if (
      node.procedure === null ||
      typeof node.procedure !== 'object' ||
      !Array.isArray(node.arguments) ||
      node.arguments.length > 256
    )
    {
      issue(
        state,
        'procedure-shape',
        path,
        'procedure call requires a reference and bounded arguments'
      )
      state.active.delete(node)
      return
    }
    if (!allowedShape('stack', placement))
      issue(
        state,
        'node-placement',
        path,
        'procedure call requires statement placement'
      )
    if (
      node.procedure.refKind === 'selfProcedure' &&
      state.options.procedureScope === undefined &&
      state.options.procedureParameters === undefined
    )
      issue(
        state,
        'procedure-scope',
        path,
        'self call requires an explicit procedure scope'
      )
    const keys = new Set<string>()
    for (const [i, argument] of node.arguments.entries())
    {
      if (
        argument === null ||
        typeof argument !== 'object' ||
        argument.parameter === null ||
        typeof argument.parameter !== 'object'
      )
      {
        issue(
          state,
          'procedure-argument',
          `${path}/arguments/${i}`,
          'argument requires a parameter reference'
        )
        continue
      }
      const localKey =
        argument.parameter.refKind === 'procedureLocalParameter'
          ? argument.parameter.localKey
          : null
      const key = localKey ?? JSON.stringify(argument.parameter)
      if (keys.has(key))
        issue(
          state,
          'duplicate-argument',
          `${path}/arguments/${i}`,
          'procedure argument appears more than once'
        )
      keys.add(key)
      const type =
        state.options.procedureCallParameterType !== undefined
          ? state.options.procedureCallParameterType(node, argument)
          : localKey === null
            ? 'stringOrNumber'
            : (state.options.procedureParameters?.get(localKey) ??
              state.options.procedureScope?.parameters.find(
                (x) => x.localKey === localKey
              )?.parameterType)
      if (type === undefined)
        issue(
          state,
          'parameter-scope',
          `${path}/arguments/${i}`,
          'local argument is absent from explicit scope'
        )
      value(state, argument.value, `${path}/arguments/${i}/value`, depth, {
        name: key,
        connection:
          type === 'boolean'
            ? 'boolean'
            : type === 'number'
              ? 'number'
              : 'stringOrNumber',
        semanticDomain: 'procedure-argument',
        canonicalShadow: null,
        choices: [],
        specialTokens: [],
        referenceDomain: null,
        requiredEntitySubtype: null,
      })
    }
  }
  else
  {
    if (
      typeof node.opcode !== 'string' ||
      !Array.isArray(node.fields) ||
      !Array.isArray(node.inputs) ||
      node.fields.length > 256 ||
      node.inputs.length > 256
    )
    {
      issue(
        state,
        'tree-shape',
        path,
        'ordinary node requires opcode and bounded named fields and inputs'
      )
      state.active.delete(node)
      return
    }
    const descriptor = getStandardDescriptorV2(node.opcode)
    if (
      descriptor === null ||
      descriptor.availability !== 'supported' ||
      descriptor.safeBuilderKind !== 'ordinaryBlock'
    )
      issue(
        state,
        'unsupported-opcode',
        `${path}/opcode`,
        'opcode is not public ordinary standard authoring'
      )
    else
    {
      if (!allowedShape(descriptor.shape, placement))
        issue(
          state,
          'node-placement',
          path,
          'block has the wrong connection shape'
        )
      if (
        state.options.targetKind !== undefined &&
        !descriptor.context.ownerTargets.includes(state.options.targetKind)
      )
        issue(
          state,
          'target-owner',
          path,
          'block cannot belong to this target kind'
        )
      const fieldNames = new Set<string>()
      for (const [i, entry] of node.fields.entries())
      {
        if (
          entry === null ||
          typeof entry !== 'object' ||
          typeof entry.name !== 'string' ||
          entry.value === null ||
          typeof entry.value !== 'object' ||
          !['text', 'number', 'boolean', 'enum', 'entity'].includes(
            entry.value.valueKind
          )
        )
        {
          issue(
            state,
            'field-value',
            `${path}/fields/${i}`,
            'field requires a typed named value'
          )
          continue
        }
        const exact = descriptor.requiredFields.find(
          (x) => x.name === entry.name
        )
        if (fieldNames.has(entry.name) || exact === undefined)
          issue(
            state,
            'field-name',
            `${path}/fields/${i}`,
            'field name is unknown or duplicated'
          )
        fieldNames.add(entry.name)
        if (exact === undefined) continue
        const v = entry.value
        if (exact.kind === 'declaration' || exact.kind === 'media')
        {
          if (v.valueKind !== 'entity')
            issue(
              state,
              'field-reference',
              `${path}/fields/${i}`,
              'field requires an exact entity reference'
            )
        }
        else if (exact.kind === 'sensingProperty' && v.valueKind === 'entity')
          continue
        else if (
          v.valueKind === 'entity' ||
          (exact.choices.length > 0 &&
            ((v.valueKind !== 'enum' && v.valueKind !== 'text') ||
              !exact.choices.includes(String(v.value))))
        )
          issue(
            state,
            'field-value',
            `${path}/fields/${i}`,
            'field requires an allowed scalar or enum value'
          )
      }
      for (const f of descriptor.requiredFields)
        if (!fieldNames.has(f.name))
          issue(
            state,
            'field-missing',
            `${path}/fields`,
            `required field ${f.name} is absent`
          )
      const inputNames = new Set<string>()
      for (const [i, entry] of node.inputs.entries())
      {
        if (
          entry === null ||
          typeof entry !== 'object' ||
          typeof entry.name !== 'string'
        )
        {
          issue(
            state,
            'input-name',
            `${path}/inputs/${i}`,
            'input requires a name'
          )
          continue
        }
        const exact = [
          ...descriptor.requiredInputs,
          ...descriptor.optionalInputs,
        ].find((x) => x.name === entry.name)
        if (inputNames.has(entry.name) || exact === undefined)
          issue(
            state,
            'input-name',
            `${path}/inputs/${i}`,
            'input name is unknown or duplicated'
          )
        inputNames.add(entry.name)
        if (exact !== undefined)
          value(state, entry.value, `${path}/inputs/${i}/value`, depth, exact)
      }
      for (const i of descriptor.requiredInputs)
        if (!inputNames.has(i.name))
          issue(
            state,
            'input-missing',
            `${path}/inputs`,
            `required input ${i.name} is absent`
          )
    }
  }
  state.active.delete(node)
}

function sequence(
  state: ValidationState,
  nodes: SemanticStatementSequenceV1,
  path: string,
  depth: number
): void
{
  if (
    nodes === null ||
    typeof nodes !== 'object' ||
    !Array.isArray(nodes.blocks)
  )
  {
    issue(state, 'sequence-shape', path, 'sequence requires a blocks array')
    return
  }
  if (nodes.blocks.length === 0 || nodes.blocks.length > 256)
    issue(
      state,
      'sequence-budget',
      path,
      'statement sequence requires between 1 and 256 blocks'
    )
  for (const [i, node] of nodes.blocks.slice(0, 256).entries())
  {
    tree(state, node, `${path}/blocks/${i}`, depth, 'statement')
    if (
      i === nodes.blocks.length - 1 ||
      node === null ||
      typeof node !== 'object' ||
      node.nodeKind !== 'ordinary' ||
      !Array.isArray(node.fields)
    )
      continue
    const descriptor = getStandardDescriptorV2(node.opcode)
    const continuingStop =
      node.opcode === 'control_stop' &&
      node.fields.some(
        (x: OrdinarySemanticBlockTreeV1['fields'][number]) =>
          x !== null &&
          typeof x === 'object' &&
          x.name === 'STOP_OPTION' &&
          x.value !== null &&
          typeof x.value === 'object' &&
          x.value.valueKind !== 'entity' &&
          x.value.value === 'other scripts in sprite'
      )
    if (descriptor?.context.mustTerminateSequence === true && !continuingStop)
      issue(
        state,
        'sequence-terminal',
        `${path}/blocks/${i}`,
        'terminal block must end its sequence'
      )
  }
}

function state(options: StandardSemanticValidationOptionsV2): ValidationState
{
  return {
    issues: [],
    aliases: new Set(),
    active: new Set(),
    options,
    count: 0,
  }
}

export function validateStandardSemanticTreeV2(
  node: SemanticBlockTreeV1,
  options: StandardSemanticValidationOptionsV2 = {}
)
{
  const s = state(options)
  tree(s, node, '', 0, options.placement)
  return { issues: s.issues, blockCount: s.count, count: s.count }
}

export function validateStandardSemanticSequenceV2(
  nodes: SemanticStatementSequenceV1,
  options: StandardSemanticValidationOptionsV2 = {}
)
{
  const s = state(options)
  sequence(s, nodes, '', 0)
  return { issues: s.issues, blockCount: s.count, count: s.count }
}
