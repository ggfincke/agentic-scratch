// packages/ir/src/edit/standard-authoring/graph-validation.ts
// refuse opaque raw payloads & validate unique ownership of standard closures

import type { Block, BlockEntry, BlockInput } from '@scratch-agent/sb3'
import {
  parseStrictEditMutationArray,
  DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS,
  parseStrictEditProcedureMutation,
  decodeProcedureWarpV1,
  procedurePlaceholderKinds,
} from '../semantic-index/procedure-mutation.js'
import {
  getStandardDescriptorV2,
  standardDescriptorForBlockV2,
  type StandardAuthoringDescriptorV2,
  type StandardInputDescriptorV2,
} from './catalog.js'
import { standardShapeFitsPlacementV2 } from './connection-policy.js'
import { standardScalarFieldValueV2 } from '../semantic-index/sensing-property-policy.js'

export interface StandardRawIssueV2
{
  readonly code: string
  readonly path: string
  readonly message: string
}

const keys = new Set([
  'opcode',
  'next',
  'parent',
  'fields',
  'inputs',
  'shadow',
  'topLevel',
  'x',
  'y',
  'comment',
  'mutation',
])

function procedureDescriptor(
  block: Block
): StandardAuthoringDescriptorV2 | null
{
  const kind = block.opcode
  if (
    ![
      'procedures_definition',
      'procedures_prototype',
      'procedures_call',
      'argument_reporter_boolean',
      'argument_reporter_string_number',
    ].includes(kind)
  )
    return null
  const base = getStandardDescriptorV2(
    kind === 'procedures_definition'
      ? 'event_whenflagclicked'
      : kind === 'argument_reporter_boolean'
        ? 'sensing_mousedown'
        : kind === 'argument_reporter_string_number'
          ? 'sensing_answer'
          : 'looks_show'
  )!
  let argumentIds: readonly string[] = []
  let placeholders: readonly string[] = []
  if (kind === 'procedures_prototype' || kind === 'procedures_call')
  {
    argumentIds = parseStrictEditMutationArray(
      block.mutation?.argumentids,
      'argumentids',
      DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS
    ) as readonly string[]
    placeholders = procedurePlaceholderKinds(block.mutation?.proccode ?? '')
  }
  const input = (name: string, boolean = false): StandardInputDescriptorV2 => ({
    name,
    connection: boolean ? 'boolean' : 'stringOrNumber',
    semanticDomain: 'procedure',
    canonicalShadow: null,
    choices: [],
    specialTokens: [],
    referenceDomain: null,
    requiredEntitySubtype: null,
  })
  return {
    ...base,
    opcode: kind,
    category: 'procedures',
    shape: kind === 'procedures_prototype' ? 'menuReporter' : base.shape,
    requiredFields: kind.startsWith('argument_')
      ? [
          {
            name: 'VALUE',
            kind: 'text',
            semanticDomain: 'parameter-name',
            serialization: 'single-value-field',
            canonicalDefault: '',
            choices: [],
            referenceDomain: null,
            requiredEntitySubtype: null,
          },
        ]
      : [],
    optionalFields: [],
    requiredInputs:
      kind === 'procedures_definition'
        ? [input('custom_block')]
        : argumentIds.map((id, i) =>
            input(id, kind === 'procedures_call' && placeholders[i] === 'b')
          ),
    optionalInputs: [],
    safeBuilderKind: 'procedure',
    availability: 'builderOnly',
  }
}

function exactNames(
  value: unknown,
  names: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown>
{
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    names.every((x) => Object.hasOwn(value, x)) &&
    Reflect.ownKeys(value).every(
      (x) =>
        typeof x === 'string' &&
        (names.includes(x) || optional.includes(x)) &&
        'value' in Object.getOwnPropertyDescriptor(value, x)!
    )
  )
}

function primitive(value: unknown): boolean
{
  if (!Array.isArray(value)) return false
  if ([11, 12, 13].includes(value[0]))
    return (
      value.length === 3 &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
    )
  if (![4, 5, 6, 7, 8, 9, 10].includes(value[0]) || value.length !== 2)
    return false
  if (
    typeof value[1] !== 'string' &&
    (typeof value[1] !== 'number' || !Number.isFinite(value[1]))
  )
    return false
  return value[0] !== 9 || /^#[a-f\d]{6}$/i.test(String(value[1]))
}

function rawInput(
  value: unknown,
  descriptor: StandardInputDescriptorV2
): value is BlockInput
{
  if (
    !Array.isArray(value) ||
    ![1, 2, 3].includes(value[0]) ||
    value.length !== (value[0] === 3 ? 3 : 2)
  )
    return false
  const validSlot = (slot: unknown) =>
    typeof slot === 'string' || primitive(slot)
  if (
    descriptor.connection === 'boolean' ||
    descriptor.connection === 'substack'
  )
    return value[0] === 2 && (value[1] === null || typeof value[1] === 'string')
  return validSlot(value[1]) && (value[0] !== 3 || validSlot(value[2]))
}

export function validateExistingStandardBlockV2(
  block: Block,
  context: { readonly ownerTargetKind?: 'stage' | 'sprite' } = {}
)
{
  const issues: StandardRawIssueV2[] = []
  const issue = (code: string, path: string, message: string) =>
    issues.push({ code, path, message })
  let descriptor: StandardAuthoringDescriptorV2 | null = null
  if (block === null || typeof block !== 'object' || Array.isArray(block))
    issue('block-not-object', '', 'block must be an object')
  else
  {
    try
    {
      descriptor =
        standardDescriptorForBlockV2(block.opcode, block.fields) ??
        procedureDescriptor(block)
    }
    catch (error)
    {
      issue(
        'procedure-mutation',
        '/mutation',
        error instanceof Error ? error.message : String(error)
      )
    }
    if (descriptor === null)
      issue('unknown-opcode', '/opcode', 'opcode is outside standard authority')
    if (
      descriptor?.safeBuilderKind === 'referenceMenuShadow' &&
      (block.shadow !== true ||
        block.topLevel === true ||
        typeof block.parent !== 'string')
    )
      issue(
        'shadow-placement',
        '',
        'builder-owned helper must be an owned shadow'
      )
    if (
      descriptor !== null &&
      context.ownerTargetKind !== undefined &&
      !descriptor.context.ownerTargets.includes(context.ownerTargetKind)
    )
      issue('target-owner', '', 'block owner differs from descriptor')
    for (const key of Reflect.ownKeys(block))
    {
      const own = Object.getOwnPropertyDescriptor(block, key)!
      if (typeof key !== 'string' || !keys.has(key) || !('value' in own))
        issue(
          'unknown-own-key',
          `/${String(key)}`,
          'block carries opaque payload'
        )
    }
    for (const key of ['next', 'parent'] as const)
      if (
        block[key] !== undefined &&
        block[key] !== null &&
        typeof block[key] !== 'string'
      )
        issue('invalid-link', `/${key}`, 'link must be string or null')
    for (const key of ['shadow', 'topLevel'] as const)
      if (block[key] !== undefined && typeof block[key] !== 'boolean')
        issue('invalid-property', `/${key}`, 'property must be boolean')
    for (const key of ['x', 'y'] as const)
      if (
        block[key] !== undefined &&
        (typeof block[key] !== 'number' || !Number.isFinite(block[key]))
      )
        issue('invalid-property', `/${key}`, 'coordinate must be finite')
    if (block.comment !== undefined && typeof block.comment !== 'string')
      issue('invalid-property', '/comment', 'comment must be an ID')
    if (descriptor !== null)
    {
      if (
        !exactNames(
          block.fields ?? {},
          descriptor.requiredFields.map((x) => x.name),
          descriptor.optionalFields.map((x) => x.name)
        )
      )
        issue('field-name-set', '/fields', 'field names differ from descriptor')
      else
        for (const f of descriptor.requiredFields)
        {
          const tuple = block.fields?.[f.name]
          const reference = f.serialization === 'name-and-id-field'
          if (
            !Array.isArray(tuple) ||
            (reference
              ? tuple.length !== 2
              : standardScalarFieldValueV2(tuple) === undefined) ||
            (typeof tuple[0] !== 'string' && typeof tuple[0] !== 'number') ||
            (typeof tuple[0] === 'number' && !Number.isFinite(tuple[0])) ||
            (reference && typeof tuple[1] !== 'string') ||
            (f.kind !== 'sensingProperty' &&
              f.choices.length > 0 &&
              !f.choices.includes(String(tuple[0])))
          )
            issue(
              'field-shape',
              `/fields/${f.name}`,
              'field tuple differs from policy'
            )
        }
      if (
        !exactNames(
          block.inputs ?? {},
          descriptor.requiredInputs.map((x) => x.name),
          descriptor.optionalInputs.map((x) => x.name)
        )
      )
        issue('input-name-set', '/inputs', 'input names differ from descriptor')
      else
        for (const input of [
          ...descriptor.requiredInputs,
          ...descriptor.optionalInputs,
        ])
          if (
            block.inputs?.[input.name] !== undefined &&
            !rawInput(block.inputs[input.name], input)
          )
            issue(
              'input-shape',
              `/inputs/${input.name}`,
              'input tuple differs from connection policy'
            )
    }
    if (block.opcode === 'control_stop')
    {
      const continuing =
        block.fields?.STOP_OPTION?.[0] === 'other scripts in sprite'
      const mutation = block.mutation
      if (
        mutation !== undefined &&
        (!exactNames(mutation, ['tagName', 'children', 'hasnext']) ||
          mutation.tagName !== 'mutation' ||
          !Array.isArray(mutation.children) ||
          mutation.children.length !== 0 ||
          (mutation.hasnext !== continuing &&
            mutation.hasnext !== String(continuing)))
      )
        issue(
          'stop-mutation',
          '/mutation',
          'stop mutation differs from continuation policy'
        )
      if (continuing && mutation === undefined)
        issue(
          'stop-mutation',
          '/mutation',
          'continuing stop requires hasnext mutation'
        )
    }
    else if (
      block.opcode === 'procedures_prototype' ||
      block.opcode === 'procedures_call'
    )
    {
      try
      {
        const m = block.mutation
        const required =
          block.opcode === 'procedures_prototype'
            ? [
                'tagName',
                'children',
                'proccode',
                'argumentids',
                'argumentnames',
                'argumentdefaults',
                'warp',
              ]
            : ['tagName', 'children', 'proccode', 'argumentids', 'warp']
        if (
          m === undefined ||
          !exactNames(m, required) ||
          m.tagName !== 'mutation' ||
          !Array.isArray(m.children) ||
          m.children.length !== 0 ||
          typeof m.proccode !== 'string' ||
          decodeProcedureWarpV1(m.warp).warp === null
        )
          throw new Error('procedure mutation has opaque or invalid fields')
        const ids = parseStrictEditMutationArray(
          m.argumentids,
          'argumentids',
          DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS
        )
        if (
          new Set(ids).size !== ids.length ||
          procedurePlaceholderKinds(m.proccode).length !== ids.length
        )
          throw new Error(
            'procedure argument IDs do not align with placeholders'
          )
        if (block.opcode === 'procedures_prototype')
          parseStrictEditProcedureMutation(
            m,
            DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS
          )
      }
      catch (error)
      {
        issue(
          'procedure-mutation',
          '/mutation',
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    else if (block.mutation !== undefined)
      issue(
        'opaque-mutation',
        '/mutation',
        'ordinary block cannot carry mutation'
      )
  }
  return {
    ok: issues.length === 0,
    descriptor,
    issues,
    safeForStructuralEdit: issues.length === 0,
  }
}

export function validateStandardClosureV2(
  blocks: Readonly<Record<string, BlockEntry>>,
  rootId: string,
  boundary = {
    expectedRootParent: null as string | null,
    expectedRootTopLevel: true,
    allowedExternalOwnerId: null as string | null,
  }
)
{
  const issues: (StandardRawIssueV2 & { readonly blockId: string })[] = []
  const ordered: string[] = []
  const comments = new Set<string>()
  const visited = new Set<string>()
  const pending = [{ id: rootId, parent: boundary.expectedRootParent }]
  while (pending.length > 0)
  {
    const { id, parent } = pending.pop()!
    const issue = (code: string, path: string, message: string) =>
      issues.push({ code, path, message, blockId: id })
    if (visited.has(id))
    {
      issue(
        'cycle-or-multiple-owner',
        '',
        'closure block has multiple owner edges'
      )
      continue
    }
    visited.add(id)
    const entry = blocks[id]
    if (entry === undefined)
    {
      issue('missing-child', '', 'owned block is absent')
      continue
    }
    ordered.push(id)
    if (Array.isArray(entry))
    {
      if (
        id !== rootId ||
        !boundary.expectedRootTopLevel ||
        entry.length !== 5 ||
        ![12, 13].includes(entry[0]) ||
        typeof entry[1] !== 'string' ||
        typeof entry[2] !== 'string' ||
        typeof entry[3] !== 'number' ||
        typeof entry[4] !== 'number' ||
        !Number.isFinite(entry[3]) ||
        !Number.isFinite(entry[4])
      )
        issue(
          'unsafe-block',
          '',
          'invalid standalone variable or list primitive'
        )
      continue
    }
    const validation = validateExistingStandardBlockV2(entry)
    if (!validation.ok || validation.descriptor === null)
    {
      issue(
        'unsafe-block',
        '',
        validation.issues.map((x) => x.message).join('; ')
      )
      continue
    }
    if ((entry.parent ?? null) !== parent)
      issue('parent-mismatch', '/parent', 'parent differs from unique owner')
    if (
      (entry.topLevel === true) !==
      (id === rootId && boundary.expectedRootTopLevel)
    )
      issue(
        'top-level-mismatch',
        '/topLevel',
        'top level differs from closure boundary'
      )
    if (entry.comment !== undefined) comments.add(entry.comment)
    if (typeof entry.next === 'string')
    {
      if (!validation.descriptor.context.acceptsSuccessor)
        issue('successor-forbidden', '/next', 'block cannot own a successor')
      pending.push({ id: entry.next, parent: id })
    }
    for (const [name, input] of Object.entries(entry.inputs ?? {}))
    {
      const descriptor = [
        ...validation.descriptor.requiredInputs,
        ...validation.descriptor.optionalInputs,
      ].find((x) => x.name === name)!
      for (const [i, slot] of input.slice(1).entries())
      {
        if (typeof slot !== 'string') continue
        const child = blocks[slot]
        if (child !== undefined && !Array.isArray(child))
        {
          if (i === 1 || input[0] === 1)
          {
            if (
              child.shadow !== true ||
              (child.opcode !== descriptor.canonicalShadow?.opcode &&
                ![
                  'procedures_definition',
                  'procedures_prototype',
                  'procedures_call',
                ].includes(entry.opcode))
            )
              issue(
                'shadow-policy',
                `/inputs/${name}/${i + 1}`,
                'shadow opcode differs from input policy'
              )
          }
          else if (
            descriptor.connection === 'boolean' &&
            !standardShapeFitsPlacementV2(
              validateExistingStandardBlockV2(child).descriptor?.shape,
              'boolean'
            )
          )
            issue(
              'connection-shape',
              `/inputs/${name}`,
              'boolean socket owns incompatible expression'
            )
          else if (
            descriptor.connection === 'substack' &&
            !standardShapeFitsPlacementV2(
              validateExistingStandardBlockV2(child).descriptor?.shape,
              'statement'
            )
          )
            issue(
              'connection-shape',
              `/inputs/${name}`,
              'substack owns incompatible block'
            )
          else if (
            descriptor.connection !== 'boolean' &&
            descriptor.connection !== 'substack' &&
            !standardShapeFitsPlacementV2(
              validateExistingStandardBlockV2(child).descriptor?.shape,
              'reporter'
            )
          )
            issue(
              'connection-shape',
              `/inputs/${name}`,
              'round input owns incompatible block'
            )
        }
        pending.push({ id: slot, parent: id })
      }
    }
  }
  let externalAllowed = false
  for (const [owner, entry] of Object.entries(blocks))
  {
    if (visited.has(owner) || Array.isArray(entry)) continue
    const outgoing = [
      entry.next,
      ...Object.values(entry.inputs ?? {}).flatMap((x) => x.slice(1)),
    ].filter((x): x is string => typeof x === 'string')
    for (const target of outgoing)
    {
      if (!visited.has(target)) continue
      if (
        !externalAllowed &&
        target === rootId &&
        owner === boundary.allowedExternalOwnerId &&
        owner === boundary.expectedRootParent
      )
      {
        externalAllowed = true
        continue
      }
      issues.push({
        code: 'external-inbound',
        blockId: target,
        path: `/blocks/${owner}`,
        message: 'closure has an external owner edge',
      })
    }
  }
  return {
    ok: issues.length === 0,
    rootId,
    blockIds: ordered,
    attachedCommentIds: [...comments].sort(),
    issues,
    hasOpaquePayload: issues.some((x) => x.code === 'unsafe-block'),
    safeForStructuralEdit: issues.length === 0,
    safeForDuplication: issues.length === 0,
  }
}
