// tests/static/fragility-positive-fixtures.ts
// shared positive fixtures for fragility & containment analyzers

import { buildClicker } from '@scratch-agent/ir'
import {
  createScratchRecord,
  defineScratchRecordValue,
  type Block,
  type BlockEntry,
  type BlockField,
  type BlockInput,
  type ProjectJson,
  type Target,
  type VariableEntry,
} from '@scratch-agent/sb3'

interface StackSpec
{
  id: string
  opcode: string
  extra?: Partial<Block>
}

function mutableProject(): ProjectJson
{
  const json = buildClicker().toProjectJson()
  for (const target of json.targets)
  {
    target.blocks = createScratchRecord<BlockEntry>(
      Object.entries(target.blocks)
    )
    target.variables = createScratchRecord<VariableEntry>(
      Object.entries(target.variables)
    )
  }
  return json
}

function put(target: Target, id: string, block: Block): void
{
  defineScratchRecordValue<BlockEntry>(target.blocks, id, block)
}

function stack(target: Target, specs: readonly StackSpec[]): void
{
  for (let position = 0; position < specs.length; position++)
  {
    const spec = specs[position]!
    put(target, spec.id, {
      opcode: spec.opcode,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: position === 0,
      ...(position === 0 ? { x: 0, y: 100 } : {}),
      ...spec.extra,
      next: specs[position + 1]?.id ?? null,
      parent: specs[position - 1]?.id ?? null,
    })
  }
}

function mutation(proccode: string, warp?: boolean | string)
{
  return {
    tagName: 'mutation',
    children: [],
    proccode,
    argumentids: '[]',
    argumentnames: '[]',
    argumentdefaults: '[]',
    ...(warp === undefined ? {} : { warp }),
  }
}

function procedure(
  target: Target,
  prefix: string,
  proccode: string,
  warp: boolean | string | undefined,
  body: readonly StackSpec[]
): void
{
  const definitionId = `${prefix}-definition`
  const prototypeId = `${prefix}-prototype`
  put(target, definitionId, {
    opcode: 'procedures_definition',
    next: body[0]?.id ?? null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['custom_block', [1, prototypeId]],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 300,
    y: 100,
  })
  put(target, prototypeId, {
    opcode: 'procedures_prototype',
    next: null,
    parent: definitionId,
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: true,
    topLevel: false,
    mutation: mutation(proccode, warp),
  })
  for (let position = 0; position < body.length; position++)
  {
    const spec = body[position]!
    put(target, spec.id, {
      opcode: spec.opcode,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
      ...spec.extra,
      next: body[position + 1]?.id ?? null,
      parent: position === 0 ? definitionId : body[position - 1]!.id,
    })
  }
}

function call(proccode: string): Partial<Block>
{
  return { mutation: mutation(proccode) }
}

function addStaticInventoryWitnesses(stage: Target, sprite: Target): void
{
  stage.broadcasts = createScratchRecord([
    ['fragility-broadcast', 'go'],
    ['inventory-never-received', 'never received'],
    ['inventory-never-sent', 'never sent'],
  ])
  defineScratchRecordValue<VariableEntry>(
    stage.variables,
    'inventory-unused-variable',
    ['inventory unused', 0]
  )
  stack(stage, [
    { id: 'inventory-broadcast-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'inventory-never-received-send',
      opcode: 'event_broadcast',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          [
            'BROADCAST_INPUT',
            [1, [11, 'never received', 'inventory-never-received']],
          ],
        ]),
      },
    },
  ])
  stack(stage, [
    {
      id: 'inventory-never-sent-hat',
      opcode: 'event_whenbroadcastreceived',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['BROADCAST_OPTION', ['never sent', 'inventory-never-sent']],
        ]),
      },
    },
  ])
  put(sprite, 'inventory-dead-code', {
    opcode: 'motion_movesteps',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 0,
    y: 200,
  })
  stack(sprite, [
    { id: 'inventory-control-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'inventory-empty-control',
      opcode: 'control_if',
      extra: {
        inputs: createScratchRecord<BlockInput>([['SUBSTACK', [2, null]]]),
      },
    },
    { id: 'inventory-hide', opcode: 'looks_hide' },
    {
      id: 'inventory-missing-backdrop',
      opcode: 'looks_switchbackdropto',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['BACKDROP', [1, [10, 'inventory missing']]],
        ]),
      },
    },
  ])
  put(sprite, 'inventory-comparing-literals', {
    opcode: 'operator_equals',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['OPERAND1', [1, [10, 'left']]],
      ['OPERAND2', [1, [10, 'right']]],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 0,
    y: 300,
  })
  procedure(sprite, 'inventory-ambiguous-a', 'inventory ambiguous', false, [])
  procedure(sprite, 'inventory-ambiguous-b', 'inventory ambiguous', false, [])
}

export function warpPositiveProject(): ProjectJson
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  stage.broadcasts = createScratchRecord([['fragility-broadcast', 'go']])

  stack(stage, [
    {
      id: 'receiver-hat',
      opcode: 'event_whenbroadcastreceived',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['BROADCAST_OPTION', ['go', 'fragility-broadcast']],
        ]),
      },
    },
    {
      id: 'receiver-wait',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
      },
    },
  ])
  procedure(sprite, 'direct', 'direct warp', 'true', [
    {
      id: 'direct-wait-half',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.5]]]]),
      },
    },
    {
      id: 'direct-broadcast',
      opcode: 'event_broadcastandwait',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['BROADCAST_INPUT', [1, [11, 'go', 'fragility-broadcast']]],
        ]),
      },
    },
    { id: 'direct-say', opcode: 'looks_sayforsecs' },
    {
      id: 'direct-wait-zero',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0]]]]),
      },
    },
    { id: 'direct-sound', opcode: 'sound_play' },
  ])
  procedure(sprite, 'inherited-root', 'inherited root', true, [
    {
      id: 'inherited-call',
      opcode: 'procedures_call',
      extra: call('inherited child'),
    },
  ])
  procedure(sprite, 'inherited-child', 'inherited child', false, [
    { id: 'inherited-ask', opcode: 'sensing_askandwait' },
  ])
  procedure(sprite, 'recursive-a', 'recursive a', true, [
    {
      id: 'recursive-call-b',
      opcode: 'procedures_call',
      extra: call('recursive b'),
    },
  ])
  procedure(sprite, 'recursive-b', 'recursive b', false, [
    {
      id: 'recursive-call-a',
      opcode: 'procedures_call',
      extra: call('recursive a'),
    },
    { id: 'recursive-think', opcode: 'looks_thinkforsecs' },
  ])
  addStaticInventoryWitnesses(stage, sprite)
  return json
}

export function startupPositiveProject(looped: boolean): ProjectJson
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'startup-global', [
    'startup value',
    0,
  ])

  const writer = (target: Target, prefix: string, loop: boolean): void =>
  {
    if (!loop)
    {
      stack(target, [
        { id: `${prefix}-hat`, opcode: 'event_whenflagclicked' },
        {
          id: `${prefix}-write`,
          opcode: 'data_setvariableto',
          extra: {
            fields: createScratchRecord<BlockField>([
              ['VARIABLE', ['startup value', 'startup-global']],
            ]),
          },
        },
      ])
      return
    }
    stack(target, [
      { id: `${prefix}-hat`, opcode: 'event_whenflagclicked' },
      {
        id: `${prefix}-forever`,
        opcode: 'control_forever',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, `${prefix}-write`]],
          ]),
        },
      },
    ])
    put(target, `${prefix}-write`, {
      opcode: 'data_setvariableto',
      next: null,
      parent: `${prefix}-forever`,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([
        ['VARIABLE', ['startup value', 'startup-global']],
      ]),
      shadow: false,
      topLevel: false,
    })
  }

  writer(stage, 'stage-startup', looped)
  writer(sprite, 'sprite-startup', looped)
  stack(sprite, [
    { id: 'startup-reader-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'startup-reader',
      opcode: 'looks_say',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [12, 'startup value', 'startup-global']]],
        ]),
      },
    },
  ])
  return json
}

export function advisoryPositiveProject(includeProbe: boolean): ProjectJson
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'shared-global', [
    'shared',
    0,
  ])
  defineScratchRecordValue<VariableEntry>(stage.variables, 'shadow-global', [
    'shadowed',
    0,
  ])
  defineScratchRecordValue<VariableEntry>(sprite.variables, 'shadow-local', [
    'shadowed',
    0,
  ])
  defineScratchRecordValue<VariableEntry>(sprite.variables, 'saved-x', [
    'saved x',
    0,
  ])

  stack(stage, [
    { id: 'shared-writer-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'shared-writer',
      opcode: 'data_setvariableto',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['shared', 'shared-global']],
        ]),
      },
    },
  ])
  stack(sprite, [
    { id: 'probe-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'probe-save',
      opcode: 'data_setvariableto',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['VALUE', [2, 'probe-x-reporter']],
        ]),
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['saved x', 'saved-x']],
        ]),
      },
    },
    { id: 'probe-teleport', opcode: 'motion_changexby' },
    {
      id: 'probe-carrier',
      opcode: 'control_if',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['CONDITION', [2, 'probe-reporter']],
        ]),
      },
    },
    {
      id: 'probe-restore',
      opcode: 'motion_setx',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['X', [1, [12, 'saved x', 'saved-x']]],
        ]),
      },
    },
  ])
  put(sprite, 'probe-x-reporter', {
    opcode: 'motion_xposition',
    next: null,
    parent: 'probe-save',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  put(sprite, 'probe-reporter', {
    opcode: includeProbe ? 'sensing_touchingobject' : 'operator_equals',
    next: null,
    parent: 'probe-carrier',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  stack(sprite, [
    { id: 'barrier-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'barrier-wait',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
      },
    },
    {
      id: 'barrier-reader',
      opcode: 'looks_say',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [12, 'shared', 'shared-global']]],
        ]),
      },
    },
  ])
  return json
}
