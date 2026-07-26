// tests/static/fragility-signatures.test.ts
// exercises fragility witnesses, traps, recursion, & determinism

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildClicker, targetKey } from '@scratch-agent/ir'
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
import {
  analyzeFragility,
  buildProcedureCallGraph,
  procedureExecution,
  type FragilityAnalysis,
} from '@scratch-agent/static'
import { buildIndex } from '@scratch-agent/validate'

import {
  advisoryPositiveProject,
  startupPositiveProject,
  warpPositiveProject,
} from './fragility-positive-fixtures.js'

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
    const prior = specs[position - 1]
    const next = specs[position + 1]
    put(target, spec.id, {
      opcode: spec.opcode,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: position === 0,
      ...(position === 0 ? { x: 0, y: 100 } : {}),
      ...spec.extra,
      next: next?.id ?? null,
      parent: prior?.id ?? null,
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

function analysisOf(json: ProjectJson): FragilityAnalysis
{
  return analyzeFragility(json, buildIndex(json))
}

function signaturesOf(analysis: FragilityAnalysis): Set<string>
{
  return new Set(
    [...analysis.findings, ...analysis.advisories].map(
      (finding) => `${finding.signature}:${finding.verdict}`
    )
  )
}

function findingForEvidence(analysis: FragilityAnalysis, blockId: string)
{
  return analysis.findings.find((finding) =>
    finding.evidence.some((entry) => entry.blockId === blockId)
  )
}

function startupBoundaryProject(boundary: StackSpec): ProjectJson
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'boundary-global', [
    'boundary value',
    0,
  ])
  stack(stage, [
    { id: 'boundary-stage-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'boundary-stage-write',
      opcode: 'data_setvariableto',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['boundary value', 'boundary-global']],
        ]),
      },
    },
  ])
  stack(sprite, [
    { id: 'boundary-sprite-hat', opcode: 'event_whenflagclicked' },
    boundary,
    {
      id: 'boundary-sprite-write',
      opcode: 'data_setvariableto',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['boundary value', 'boundary-global']],
        ]),
      },
    },
  ])
  stack(sprite, [
    { id: 'boundary-reader-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'boundary-reader',
      opcode: 'looks_say',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [12, 'boundary value', 'boundary-global']]],
        ]),
      },
    },
  ])
  return json
}

type ProbeRestoreVariant =
  | 'exact'
  | 'turn'
  | 'wrong-axis'
  | 'other-variable'
  | 'transformed-save'
  | 'transformed-restore'
  | 'intervening-write'
type ProbeClosureVariant =
  | 'none'
  | 'clean'
  | 'waiting'
  | 'unresolved'
  | 'recursive'
  | 'writes-saved'
  | 'conditionally-writes-saved'
  | 'nonreturning'
  | 'both-branches-waiting'
  | 'one-branch-waiting'
  | 'waiting-then-unresolved'
type ProbeReachabilityVariant =
  | 'none'
  | 'recursive-before-save'
  | 'both-arms-stop-before-save'
  | 'one-arm-stop-before-save'
  | 'both-arms-stop-before-restore'

function probeRestoreProject(
  restoreVariant: ProbeRestoreVariant,
  closureVariant: ProbeClosureVariant = 'none',
  reachabilityVariant: ProbeReachabilityVariant = 'none'
): ProjectJson
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(sprite.variables, 'probe-saved-x', [
    'saved x',
    0,
  ])
  defineScratchRecordValue<VariableEntry>(sprite.variables, 'probe-other', [
    'other',
    0,
  ])

  const closure =
    closureVariant === 'none'
      ? []
      : closureVariant === 'waiting-then-unresolved'
        ? [
            {
              id: 'probe-direct-wait-before-unresolved',
              opcode: 'control_wait',
              extra: {
                inputs: createScratchRecord<BlockInput>([
                  ['DURATION', [1, [4, 0.1]]],
                ]),
              },
            },
            {
              id: 'probe-closure-call',
              opcode: 'procedures_call',
              extra: call('probe closure'),
            },
          ]
        : [
            {
              id: 'probe-closure-call',
              opcode: 'procedures_call',
              extra: call('probe closure'),
            },
          ]
  const beforeSave =
    reachabilityVariant === 'recursive-before-save'
      ? [
          {
            id: 'probe-prefix-recursive-call',
            opcode: 'procedures_call',
            extra: call('probe prefix recursive'),
          },
        ]
      : reachabilityVariant === 'both-arms-stop-before-save' ||
          reachabilityVariant === 'one-arm-stop-before-save'
        ? [
            {
              id: 'probe-prefix-stop-if-else',
              opcode: 'control_if_else',
              extra: {
                inputs: createScratchRecord<BlockInput>([
                  ['SUBSTACK', [2, 'probe-prefix-stop-left']],
                  ['SUBSTACK2', [2, 'probe-prefix-stop-right']],
                ]),
              },
            },
          ]
        : []
  const beforeRestore =
    reachabilityVariant === 'both-arms-stop-before-restore'
      ? [
          {
            id: 'probe-stop-if-else',
            opcode: 'control_if_else',
            extra: {
              inputs: createScratchRecord<BlockInput>([
                ['SUBSTACK', [2, 'probe-stop-left']],
                ['SUBSTACK2', [2, 'probe-stop-right']],
              ]),
            },
          },
        ]
      : []
  const interveningWrite: StackSpec[] =
    restoreVariant === 'intervening-write'
      ? [
          {
            id: 'probe-intervening-write',
            opcode: 'data_changevariableby',
            extra: {
              inputs: createScratchRecord<BlockInput>([['VALUE', [1, [4, 1]]]]),
              fields: createScratchRecord<BlockField>([
                ['VARIABLE', ['saved x', 'probe-saved-x']],
              ]),
            },
          },
        ]
      : []
  const restore: StackSpec =
    restoreVariant === 'turn'
      ? {
          id: 'probe-exact-restore',
          opcode: 'motion_turnright',
          extra: {
            inputs: createScratchRecord<BlockInput>([
              ['DEGREES', [1, [4, 15]]],
            ]),
          },
        }
      : restoreVariant === 'wrong-axis'
        ? {
            id: 'probe-exact-restore',
            opcode: 'motion_sety',
            extra: {
              inputs: createScratchRecord<BlockInput>([
                ['Y', [1, [12, 'saved x', 'probe-saved-x']]],
              ]),
            },
          }
        : restoreVariant === 'transformed-restore'
          ? {
              id: 'probe-exact-restore',
              opcode: 'motion_setx',
              extra: {
                inputs: createScratchRecord<BlockInput>([
                  ['X', [2, 'probe-restore-expression']],
                ]),
              },
            }
          : {
              id: 'probe-exact-restore',
              opcode: 'motion_setx',
              extra: {
                inputs: createScratchRecord<BlockInput>([
                  [
                    'X',
                    [
                      1,
                      [
                        12,
                        restoreVariant === 'other-variable'
                          ? 'other'
                          : 'saved x',
                        restoreVariant === 'other-variable'
                          ? 'probe-other'
                          : 'probe-saved-x',
                      ],
                    ],
                  ],
                ]),
              },
            }
  stack(sprite, [
    { id: 'probe-exact-hat', opcode: 'event_whenflagclicked' },
    ...beforeSave,
    {
      id: 'probe-exact-save',
      opcode: 'data_setvariableto',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          [
            'VALUE',
            [
              2,
              restoreVariant === 'transformed-save'
                ? 'probe-save-expression'
                : 'probe-exact-x-reporter',
            ],
          ],
        ]),
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['saved x', 'probe-saved-x']],
        ]),
      },
    },
    ...interveningWrite,
    { id: 'probe-exact-teleport', opcode: 'motion_changexby' },
    {
      id: 'probe-exact-carrier',
      opcode: 'control_if',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['CONDITION', [2, 'probe-exact-touching']],
        ]),
      },
    },
    ...closure,
    ...beforeRestore,
    restore,
  ])
  put(sprite, 'probe-exact-x-reporter', {
    opcode: 'motion_xposition',
    next: null,
    parent:
      restoreVariant === 'transformed-save'
        ? 'probe-save-expression'
        : 'probe-exact-save',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  if (restoreVariant === 'transformed-save')
  {
    put(sprite, 'probe-save-expression', {
      opcode: 'operator_add',
      next: null,
      parent: 'probe-exact-save',
      inputs: createScratchRecord<BlockInput>([
        ['NUM1', [2, 'probe-exact-x-reporter']],
        ['NUM2', [1, [4, 1]]],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    })
  }
  if (restoreVariant === 'transformed-restore')
  {
    put(sprite, 'probe-restore-expression', {
      opcode: 'operator_add',
      next: null,
      parent: 'probe-exact-restore',
      inputs: createScratchRecord<BlockInput>([
        ['NUM1', [2, 'probe-restore-variable']],
        ['NUM2', [1, [4, 1]]],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    })
    put(sprite, 'probe-restore-variable', {
      opcode: 'data_variable',
      next: null,
      parent: 'probe-restore-expression',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([
        ['VARIABLE', ['saved x', 'probe-saved-x']],
      ]),
      shadow: false,
      topLevel: false,
    })
  }
  put(sprite, 'probe-exact-touching', {
    opcode: 'sensing_touchingobject',
    next: null,
    parent: 'probe-exact-carrier',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })

  if (closureVariant === 'clean')
    procedure(sprite, 'probe-clean', 'probe closure', false, [
      { id: 'probe-clean-motion', opcode: 'motion_movesteps' },
    ])
  if (closureVariant === 'waiting')
    procedure(sprite, 'probe-waiting', 'probe closure', false, [
      {
        id: 'probe-closure-wait',
        opcode: 'control_wait',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['DURATION', [1, [4, 0.1]]],
          ]),
        },
      },
    ])
  if (closureVariant === 'recursive')
    procedure(sprite, 'probe-recursive', 'probe closure', false, [
      {
        id: 'probe-recursive-call',
        opcode: 'procedures_call',
        extra: call('probe closure'),
      },
    ])
  if (closureVariant === 'writes-saved')
    procedure(sprite, 'probe-writes-saved', 'probe closure', false, [
      {
        id: 'probe-closure-write',
        opcode: 'data_setvariableto',
        extra: {
          fields: createScratchRecord<BlockField>([
            ['VARIABLE', ['saved x', 'probe-saved-x']],
          ]),
        },
      },
    ])
  if (closureVariant === 'conditionally-writes-saved')
  {
    procedure(sprite, 'probe-conditional-write', 'probe closure', false, [
      {
        id: 'probe-conditional-write-branch',
        opcode: 'control_if',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, 'probe-conditional-write-body']],
          ]),
        },
      },
    ])
    put(sprite, 'probe-conditional-write-body', {
      opcode: 'data_setvariableto',
      next: null,
      parent: 'probe-conditional-write-branch',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([
        ['VARIABLE', ['saved x', 'probe-saved-x']],
      ]),
      shadow: false,
      topLevel: false,
    })
  }
  if (closureVariant === 'nonreturning')
    procedure(sprite, 'probe-nonreturning', 'probe closure', false, [
      {
        id: 'probe-nonreturning-forever',
        opcode: 'control_forever',
      },
    ])
  if (
    closureVariant === 'both-branches-waiting' ||
    closureVariant === 'one-branch-waiting'
  )
  {
    procedure(sprite, 'probe-branch-waits', 'probe closure', false, [
      {
        id: 'probe-branch-waits-if-else',
        opcode: 'control_if_else',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, 'probe-branch-waits-left']],
            ['SUBSTACK2', [2, 'probe-branch-waits-right']],
          ]),
        },
      },
    ])
    for (const [id, opcode] of [
      ['probe-branch-waits-left', 'control_wait'],
      [
        'probe-branch-waits-right',
        closureVariant === 'both-branches-waiting'
          ? 'control_wait'
          : 'motion_movesteps',
      ],
    ] as const)
    {
      put(sprite, id, {
        opcode,
        next: null,
        parent: 'probe-branch-waits-if-else',
        inputs:
          opcode === 'control_wait'
            ? createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]])
            : createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: false,
      })
    }
  }
  if (reachabilityVariant === 'recursive-before-save')
    procedure(
      sprite,
      'probe-prefix-recursive',
      'probe prefix recursive',
      false,
      [
        {
          id: 'probe-prefix-recursive-body-call',
          opcode: 'procedures_call',
          extra: call('probe prefix recursive'),
        },
      ]
    )
  if (
    reachabilityVariant === 'both-arms-stop-before-save' ||
    reachabilityVariant === 'one-arm-stop-before-save'
  )
  {
    for (const [id, opcode] of [
      ['probe-prefix-stop-left', 'control_stop'],
      [
        'probe-prefix-stop-right',
        reachabilityVariant === 'both-arms-stop-before-save'
          ? 'control_stop'
          : 'motion_movesteps',
      ],
    ] as const)
    {
      put(sprite, id, {
        opcode,
        next: null,
        parent: 'probe-prefix-stop-if-else',
        inputs: createScratchRecord<BlockInput>(),
        fields:
          opcode === 'control_stop'
            ? createScratchRecord<BlockField>([
                ['STOP_OPTION', ['this script']],
              ])
            : createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: false,
      })
    }
  }
  if (reachabilityVariant === 'both-arms-stop-before-restore')
  {
    for (const id of ['probe-stop-left', 'probe-stop-right'])
    {
      put(sprite, id, {
        opcode: 'control_stop',
        next: null,
        parent: 'probe-stop-if-else',
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>([
          ['STOP_OPTION', ['this script']],
        ]),
        shadow: false,
        topLevel: false,
      })
    }
  }
  return json
}

function warpPromiseBeforeProbeProject(): ProjectJson
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(sprite.variables, 'warp-saved-x', [
    'saved x',
    0,
  ])
  procedure(sprite, 'warp-probe', 'warp probe', true, [
    { id: 'warp-probe-promise', opcode: 'looks_sayforsecs' },
    {
      id: 'warp-probe-save',
      opcode: 'data_setvariableto',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['VALUE', [2, 'warp-probe-x-reporter']],
        ]),
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['saved x', 'warp-saved-x']],
        ]),
      },
    },
    { id: 'warp-probe-teleport', opcode: 'motion_changexby' },
    {
      id: 'warp-probe-carrier',
      opcode: 'control_if',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['CONDITION', [2, 'warp-probe-touching']],
        ]),
      },
    },
    {
      id: 'warp-probe-wait-zero',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0]]]]),
      },
    },
    {
      id: 'warp-probe-restore',
      opcode: 'motion_setx',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['X', [1, [12, 'saved x', 'warp-saved-x']]],
        ]),
      },
    },
  ])
  put(sprite, 'warp-probe-x-reporter', {
    opcode: 'motion_xposition',
    next: null,
    parent: 'warp-probe-save',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  put(sprite, 'warp-probe-touching', {
    opcode: 'sensing_touchingobject',
    next: null,
    parent: 'warp-probe-carrier',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  return json
}

type BarrierOrder =
  | 'wait-before-read'
  | 'read-before-wait'
  | 'branch-read'
  | 'forever-before-read'
  | 'nonreturning-call-before-read'
  | 'wait-until-false-before-read'
  | 'repeat-until-false-before-read'
  | 'both-arms-stop-before-read'

function timingBarrierProject(order: BarrierOrder): ProjectJson
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'ordered-global', [
    'ordered',
    0,
  ])
  stack(stage, [
    { id: 'ordered-writer-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'ordered-writer',
      opcode: 'data_setvariableto',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['ordered', 'ordered-global']],
        ]),
      },
    },
  ])

  const wait: StackSpec = {
    id: 'ordered-wait',
    opcode: 'control_wait',
    extra: {
      inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
    },
  }
  const reader: StackSpec = {
    id: 'ordered-reader',
    opcode: 'looks_say',
    extra: {
      inputs: createScratchRecord<BlockInput>([
        ['MESSAGE', [1, [12, 'ordered', 'ordered-global']]],
      ]),
    },
  }
  if (
    order === 'wait-until-false-before-read' ||
    order === 'repeat-until-false-before-read'
  )
  {
    const repeat = order === 'repeat-until-false-before-read'
    const blockingInputs: [string, BlockInput][] = [
      ['CONDITION', [1, [10, 'false']]],
    ]
    if (repeat) blockingInputs.push(['SUBSTACK', [2, 'ordered-repeat-body']])
    stack(sprite, [
      { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
      wait,
      {
        id: 'ordered-literal-nonreturning',
        opcode: repeat ? 'control_repeat_until' : 'control_wait_until',
        extra: {
          inputs: createScratchRecord<BlockInput>(blockingInputs),
        },
      },
      reader,
    ])
    if (repeat)
      put(sprite, 'ordered-repeat-body', {
        opcode: 'motion_movesteps',
        next: null,
        parent: 'ordered-literal-nonreturning',
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: false,
      })
    return json
  }
  if (order === 'forever-before-read')
  {
    stack(sprite, [
      { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
      wait,
      {
        id: 'ordered-forever',
        opcode: 'control_forever',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, 'ordered-forever-body']],
          ]),
        },
      },
      reader,
    ])
    put(sprite, 'ordered-forever-body', {
      opcode: 'motion_movesteps',
      next: null,
      parent: 'ordered-forever',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    })
    return json
  }
  if (order === 'nonreturning-call-before-read')
  {
    stack(sprite, [
      { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
      wait,
      {
        id: 'ordered-nonreturning-call',
        opcode: 'procedures_call',
        extra: call('ordered nonreturning'),
      },
      reader,
    ])
    procedure(sprite, 'ordered-nonreturning', 'ordered nonreturning', false, [
      {
        id: 'ordered-nonreturning-forever',
        opcode: 'control_forever',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, 'ordered-nonreturning-body']],
          ]),
        },
      },
    ])
    put(sprite, 'ordered-nonreturning-body', {
      opcode: 'motion_movesteps',
      next: null,
      parent: 'ordered-nonreturning-forever',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    })
    return json
  }
  if (order === 'both-arms-stop-before-read')
  {
    stack(sprite, [
      { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
      wait,
      {
        id: 'ordered-stop-if-else',
        opcode: 'control_if_else',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, 'ordered-stop-left']],
            ['SUBSTACK2', [2, 'ordered-stop-right']],
          ]),
        },
      },
      reader,
    ])
    for (const id of ['ordered-stop-left', 'ordered-stop-right'])
    {
      put(sprite, id, {
        opcode: 'control_stop',
        next: null,
        parent: 'ordered-stop-if-else',
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>([
          ['STOP_OPTION', ['this script']],
        ]),
        shadow: false,
        topLevel: false,
      })
    }
    return json
  }
  if (order === 'branch-read')
  {
    stack(sprite, [
      { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
      wait,
      {
        id: 'ordered-branch',
        opcode: 'control_if',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['SUBSTACK', [2, reader.id]],
          ]),
        },
      },
    ])
    put(sprite, reader.id, {
      opcode: reader.opcode,
      next: null,
      parent: 'ordered-branch',
      inputs: createScratchRecord<BlockInput>([
        ['MESSAGE', [1, [12, 'ordered', 'ordered-global']]],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    })
    return json
  }

  stack(
    sprite,
    order === 'wait-before-read'
      ? [
          { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
          wait,
          reader,
        ]
      : [
          { id: 'ordered-reader-hat', opcode: 'event_whenflagclicked' },
          reader,
          wait,
        ]
  )
  return json
}

function missingIfElseArmProject(): ProjectJson
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  procedure(sprite, 'missing-else', 'missing else', true, [
    {
      id: 'missing-else-branch',
      opcode: 'control_if_else',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['SUBSTACK', [2, 'missing-else-promise']],
        ]),
      },
    },
    { id: 'missing-else-after', opcode: 'motion_movesteps' },
  ])
  put(sprite, 'missing-else-promise', {
    opcode: 'looks_sayforsecs',
    next: null,
    parent: 'missing-else-branch',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  return json
}

function timingBarrierCapProject(declarationCount: number): ProjectJson
{
  const json = mutableProject()
  for (const target of json.targets)
  {
    target.blocks = createScratchRecord<BlockEntry>()
    target.variables = createScratchRecord<VariableEntry>()
    target.lists = createScratchRecord()
  }
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  const writers: StackSpec[] = [
    { id: 'capped-writer-hat', opcode: 'event_whenflagclicked' },
  ]
  const readers: StackSpec[] = [
    { id: 'capped-reader-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'capped-wait',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
      },
    },
  ]
  for (let index = 0; index < declarationCount; index++)
  {
    const id = `capped-global-${index}`
    const name = `capped ${index}`
    defineScratchRecordValue<VariableEntry>(stage.variables, id, [name, 0])
    writers.push({
      id: `capped-writer-${index}`,
      opcode: 'data_setvariableto',
      extra: {
        fields: createScratchRecord<BlockField>([['VARIABLE', [name, id]]]),
      },
    })
    readers.push({
      id: `capped-reader-${index}`,
      opcode: 'looks_say',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [12, name, id]]],
        ]),
      },
    })
  }
  stack(stage, writers)
  stack(sprite, readers)
  return json
}

function repeatedTimingBarrierReadersProject(
  includeSecondDeclaration: boolean
): ProjectJson
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'repeated-first', [
    'repeated first',
    0,
  ])
  if (includeSecondDeclaration)
    defineScratchRecordValue<VariableEntry>(
      stage.variables,
      'repeated-second',
      ['repeated second', 0]
    )

  stack(stage, [
    { id: 'repeated-writer-hat', opcode: 'event_whenflagclicked' },
    {
      id: 'repeated-first-writer',
      opcode: 'data_setvariableto',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['VARIABLE', ['repeated first', 'repeated-first']],
        ]),
      },
    },
    ...(includeSecondDeclaration
      ? [
          {
            id: 'repeated-second-writer',
            opcode: 'data_setvariableto',
            extra: {
              fields: createScratchRecord<BlockField>([
                ['VARIABLE', ['repeated second', 'repeated-second']],
              ]),
            },
          },
        ]
      : []),
  ])

  for (const ordinal of [1, 2])
  {
    stack(sprite, [
      {
        id: `repeated-reader-${ordinal}-hat`,
        opcode: 'event_whenflagclicked',
      },
      {
        id: `repeated-reader-${ordinal}-wait`,
        opcode: 'control_wait',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['DURATION', [1, [4, 0.1]]],
          ]),
        },
      },
      {
        id: `repeated-reader-${ordinal}-first`,
        opcode: 'looks_say',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['MESSAGE', [1, [12, 'repeated first', 'repeated-first']]],
          ]),
        },
      },
      ...(includeSecondDeclaration && ordinal === 1
        ? [
            {
              id: 'repeated-reader-1-second',
              opcode: 'looks_say',
              extra: {
                inputs: createScratchRecord<BlockInput>([
                  ['MESSAGE', [1, [12, 'repeated second', 'repeated-second']]],
                ]),
              },
            },
          ]
        : []),
    ])
  }
  return json
}

test('F1 witnesses direct, inherited, budget, & receiver warp breaks', () =>
{
  const analysis = analysisOf(warpPositiveProject())
  assert.ok(signaturesOf(analysis).has('fragility.warp-break:witnessed'))
  const evidenceIds = new Set(
    analysis.findings.flatMap((finding) =>
      finding.evidence.map((entry) => entry.blockId)
    )
  )
  for (const expected of [
    'direct-say',
    'direct-wait-half',
    'direct-broadcast',
    'inherited-ask',
  ])
    assert.ok(evidenceIds.has(expected), `missing evidence ${expected}`)
  assert.equal(evidenceIds.has('direct-wait-zero'), false)
  assert.equal(evidenceIds.has('direct-sound'), false)
})

test('F1 skips non-breaker siblings & broadcasts without receivers', () =>
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  stage.broadcasts = createScratchRecord([['no-receiver-id', 'nobody']])
  procedure(sprite, 'negative-warp', 'negative warp', true, [
    { id: 'negative-sound', opcode: 'sound_play' },
    {
      id: 'negative-broadcast',
      opcode: 'event_broadcastandwait',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['BROADCAST_INPUT', [1, [11, 'nobody', 'no-receiver-id']]],
        ]),
      },
    },
  ])
  assert.equal(
    analysisOf(json).findings.some(
      (finding) => finding.signature === 'fragility.warp-break'
    ),
    false
  )
})

test('F1 evaluates conditional boundary twins with Scratch casts', () =>
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  sprite.sounds.push({
    assetId: '0'.repeat(32),
    name: 'beep',
    dataFormat: 'wav',
  })
  const addWarp = (
    prefix: string,
    opcode: string,
    extra: Partial<Block>
  ): void =>
  {
    procedure(sprite, prefix, prefix, true, [
      { id: `${prefix}-boundary`, opcode, extra },
    ])
  }

  addWarp('effect-pitch', 'sound_seteffectto', {
    fields: createScratchRecord<BlockField>([['EFFECT', ['PiTcH']]]),
  })
  addWarp('effect-echo', 'sound_seteffectto', {
    fields: createScratchRecord<BlockField>([['EFFECT', ['echo']]]),
  })
  addWarp('sound-valid', 'sound_playuntildone', {
    inputs: createScratchRecord<BlockInput>([
      ['SOUND_MENU', [1, [10, 'beep']]],
    ]),
  })
  addWarp('sound-invalid', 'sound_playuntildone', {
    inputs: createScratchRecord<BlockInput>([
      ['SOUND_MENU', [1, [10, 'missing']]],
    ]),
  })
  addWarp('wait-positive', 'control_wait', {
    inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, '0.1']]]]),
  })
  addWarp('wait-zero', 'control_wait', {
    inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 'abc']]]]),
  })
  addWarp('until-false', 'control_wait_until', {
    inputs: createScratchRecord<BlockInput>([
      ['CONDITION', [1, [10, 'false']]],
    ]),
  })
  addWarp('until-true', 'control_wait_until', {
    inputs: createScratchRecord<BlockInput>([
      ['CONDITION', [1, [10, 'False ']]],
    ]),
  })
  addWarp('glide-positive', 'motion_glidesecstoxy', {
    inputs: createScratchRecord<BlockInput>([['SECS', [1, [4, 0.2]]]]),
  })
  addWarp('glide-zero', 'motion_glidesecstoxy', {
    inputs: createScratchRecord<BlockInput>([['SECS', [1, [4, 0]]]]),
  })

  const analysis = analysisOf(json)
  for (const expected of [
    'effect-pitch-boundary',
    'wait-positive-boundary',
    'until-false-boundary',
    'glide-positive-boundary',
  ])
    assert.equal(findingForEvidence(analysis, expected)?.verdict, 'witnessed')
  for (const absent of [
    'effect-echo-boundary',
    'sound-invalid-boundary',
    'wait-zero-boundary',
    'until-true-boundary',
    'glide-zero-boundary',
  ])
    assert.equal(findingForEvidence(analysis, absent), undefined)
  assert.equal(
    findingForEvidence(analysis, 'sound-valid-boundary')?.verdict,
    'indeterminate'
  )
})

test('F1 receiver boundaries require a resolved receiver', () =>
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  stage.broadcasts = createScratchRecord([
    ['empty-id', 'empty'],
    ['blocking-id', 'blocking'],
  ])
  stack(stage, [
    {
      id: 'empty-receiver-hat',
      opcode: 'event_whenbroadcastreceived',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['BROADCAST_OPTION', ['empty', 'empty-id']],
        ]),
      },
    },
  ])
  stack(stage, [
    {
      id: 'blocking-receiver-hat',
      opcode: 'event_whenbroadcastreceived',
      extra: {
        fields: createScratchRecord<BlockField>([
          ['BROADCAST_OPTION', ['blocking', 'blocking-id']],
        ]),
      },
    },
    {
      id: 'blocking-receiver-wait',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
      },
    },
  ])
  procedure(sprite, 'empty-sender', 'empty sender', true, [
    {
      id: 'empty-broadcast',
      opcode: 'event_broadcastandwait',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['BROADCAST_INPUT', [1, [11, 'empty', 'empty-id']]],
        ]),
      },
    },
  ])
  procedure(sprite, 'blocking-sender', 'blocking sender', true, [
    {
      id: 'blocking-broadcast',
      opcode: 'event_broadcastandwait',
      extra: {
        inputs: createScratchRecord<BlockInput>([
          ['BROADCAST_INPUT', [1, [11, 'blocking', 'blocking-id']]],
        ]),
      },
    },
  ])

  const analysis = analysisOf(json)
  assert.equal(
    findingForEvidence(analysis, 'empty-broadcast')?.verdict,
    'witnessed'
  )
  assert.equal(
    findingForEvidence(analysis, 'blocking-broadcast')?.verdict,
    'witnessed'
  )
})

test('F1 backdrop receivers match the selected result', () =>
{
  const json = mutableProject()
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  stage.costumes = ['Blue', 'Red', 'Empty'].map((name, position) => ({
    assetId: String(position).repeat(32),
    name,
    dataFormat: 'svg',
  }))
  stack(stage, [
    {
      id: 'blue-hat',
      opcode: 'event_whenbackdropswitchesto',
      extra: {
        fields: createScratchRecord<BlockField>([['BACKDROP', ['blue']]]),
      },
    },
    {
      id: 'blue-wait',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
      },
    },
  ])
  stack(stage, [
    {
      id: 'empty-backdrop-hat',
      opcode: 'event_whenbackdropswitchesto',
      extra: {
        fields: createScratchRecord<BlockField>([['BACKDROP', ['EMPTY']]]),
      },
    },
  ])
  const switchBlock = (prefix: string, selected: BlockInput): void =>
  {
    procedure(sprite, prefix, prefix, true, [
      {
        id: `${prefix}-switch`,
        opcode: 'looks_switchbackdroptoandwait',
        extra: {
          inputs: createScratchRecord<BlockInput>([['BACKDROP', selected]]),
        },
      },
    ])
  }
  switchBlock('matching-backdrop', [1, [10, 'Blue']])
  switchBlock('mismatched-backdrop', [1, [10, 'Red']])
  switchBlock('empty-backdrop', [1, [10, 'Empty']])
  switchBlock('dynamic-backdrop', [2, 'dynamic-backdrop-value'])
  put(sprite, 'dynamic-backdrop-value', {
    opcode: 'data_variable',
    next: null,
    parent: 'dynamic-backdrop-switch',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })

  const analysis = analysisOf(json)
  assert.equal(
    findingForEvidence(analysis, 'matching-backdrop-switch')?.verdict,
    'witnessed'
  )
  assert.equal(
    findingForEvidence(analysis, 'mismatched-backdrop-switch'),
    undefined
  )
  assert.equal(
    findingForEvidence(analysis, 'empty-backdrop-switch')?.verdict,
    'witnessed'
  )
  assert.equal(
    findingForEvidence(analysis, 'dynamic-backdrop-switch')
      ?.indeterminateReason,
    'unresolved-receivers'
  )
})

test('F1 marks malformed warp metadata indeterminate', () =>
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  procedure(sprite, 'malformed', 'malformed warp', 'not json', [
    { id: 'malformed-say', opcode: 'looks_sayforsecs' },
  ])
  const finding = analysisOf(json).findings.find(
    (entry) => entry.signature === 'fragility.warp-break'
  )
  assert.equal(finding?.verdict, 'indeterminate')
  assert.equal(finding?.indeterminateReason, 'malformed-warp')
})

test('F1 preserves warp state across calls before & after a Promise', () =>
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  for (const child of ['before-child', 'after-child', 'mixed-child'])
  {
    procedure(sprite, child, child, false, [
      {
        id: `${child}-wait`,
        opcode: 'control_wait',
        extra: {
          inputs: createScratchRecord<BlockInput>([
            ['DURATION', [1, [4, 0.1]]],
          ]),
        },
      },
    ])
  }
  procedure(sprite, 'path-root', 'path root', true, [
    {
      id: 'call-before',
      opcode: 'procedures_call',
      extra: call('before-child'),
    },
    {
      id: 'call-mixed-before',
      opcode: 'procedures_call',
      extra: call('mixed-child'),
    },
    { id: 'path-promise', opcode: 'looks_sayforsecs' },
    {
      id: 'call-after',
      opcode: 'procedures_call',
      extra: call('after-child'),
    },
    {
      id: 'call-mixed-after',
      opcode: 'procedures_call',
      extra: call('mixed-child'),
    },
  ])

  const analysis = analysisOf(json)
  assert.equal(
    findingForEvidence(analysis, 'before-child-wait')?.verdict,
    'witnessed'
  )
  assert.equal(findingForEvidence(analysis, 'after-child-wait'), undefined)
  const mixed = findingForEvidence(analysis, 'mixed-child-wait')
  assert.equal(mixed?.verdict, 'indeterminate')
  assert.equal(mixed?.indeterminateReason, 'mixed-warp-callers')
})

test('F1 suppresses unbounded loops only for reachable checkpoints', () =>
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  procedure(sprite, 'loop-child', 'loop child', false, [
    {
      id: 'loop-child-wait',
      opcode: 'control_wait',
      extra: {
        inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
      },
    },
  ])
  const addLoop = (prefix: string, branch: StackSpec | null): void =>
  {
    procedure(sprite, prefix, prefix, true, [
      {
        id: `${prefix}-loop`,
        opcode: 'control_forever',
        extra: branch
          ? {
              inputs: createScratchRecord<BlockInput>([
                ['SUBSTACK', [2, branch.id]],
              ]),
            }
          : {},
      },
    ])
    if (!branch) return
    put(sprite, branch.id, {
      opcode: branch.opcode,
      next: null,
      parent: `${prefix}-loop`,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
      ...branch.extra,
    })
  }
  addLoop('bare', null)
  addLoop('direct-checkpoint', {
    id: 'direct-loop-wait',
    opcode: 'control_wait',
    extra: {
      inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0.1]]]]),
    },
  })
  addLoop('call-checkpoint', {
    id: 'loop-call',
    opcode: 'procedures_call',
    extra: call('loop child'),
  })
  addLoop('pseudo-checkpoint', {
    id: 'zero-loop-wait',
    opcode: 'control_wait',
    extra: {
      inputs: createScratchRecord<BlockInput>([['DURATION', [1, [4, 0]]]]),
    },
  })

  const analysis = analysisOf(json)
  assert.equal(findingForEvidence(analysis, 'bare-loop')?.verdict, 'witnessed')
  assert.equal(
    findingForEvidence(analysis, 'pseudo-checkpoint-loop')?.verdict,
    'witnessed'
  )
  assert.equal(
    findingForEvidence(analysis, 'direct-checkpoint-loop'),
    undefined
  )
  assert.equal(findingForEvidence(analysis, 'call-checkpoint-loop'), undefined)
})

test('F1 follows only the VM-effective body & exposes malformed closure', () =>
{
  const json = mutableProject()
  const sprite = json.targets.find((target) => !target.isStage)!
  procedure(sprite, 'runtime-body', 'duplicate body', true, [
    { id: 'runtime-motion', opcode: 'motion_movesteps' },
  ])
  procedure(sprite, 'unreachable-body', 'duplicate body', true, [
    { id: 'unreachable-promise', opcode: 'looks_sayforsecs' },
  ])
  put(sprite, 'orphan-definition', {
    opcode: 'procedures_definition',
    next: 'orphan-promise',
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['custom_block', [1, 'missing-prototype']],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  put(sprite, 'orphan-promise', {
    opcode: 'looks_thinkforsecs',
    next: null,
    parent: 'orphan-definition',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  procedure(sprite, 'malformed-root', 'malformed root', true, [
    { id: 'malformed-call', opcode: 'procedures_call' },
  ])

  const analysis = analysisOf(json)
  assert.equal(findingForEvidence(analysis, 'unreachable-promise'), undefined)
  assert.equal(findingForEvidence(analysis, 'orphan-promise'), undefined)
  const malformed = findingForEvidence(analysis, 'malformed-call')
  assert.equal(malformed?.verdict, 'indeterminate')
  assert.equal(malformed?.indeterminateReason, 'unresolved-closure')
})

test('T3 recursive procedure closure terminates without duplicate pairs', () =>
{
  const findings = analysisOf(warpPositiveProject()).findings.filter(
    (finding) => finding.signature === 'fragility.warp-break'
  )
  const pairs = findings.map(
    (finding) =>
      `${finding.topBlockId ?? ''}:${finding.evidence[0]?.blockId ?? ''}`
  )
  assert.equal(new Set(pairs).size, pairs.length)
})

test('T3 preserves mixed warp after a Promise in one if-else arm', () =>
{
  const json = missingIfElseArmProject()
  const index = buildIndex(json)
  const graph = buildProcedureCallGraph(json, index)
  const missingElse = index.semantic.procedures.find(
    (entry) => entry.proccode === 'missing else'
  )
  assert.ok(missingElse)
  const execution = procedureExecution(
    json,
    index,
    missingElse,
    graph,
    'non-warp'
  )
  const after = execution.blocks.find(
    (entry) => entry.ref.blockId === 'missing-else-after'
  )
  assert.equal(after?.warpState, 'mixed')
  assert.equal(after?.uncertaintyReason, 'mixed-warp-callers')
})

test('F2 witnesses startup prefix writes but ignores steady-state loops', () =>
{
  const positive = analysisOf(startupPositiveProject(false))
  assert.ok(
    signaturesOf(positive).has('fragility.startup-write-race:witnessed')
  )
  const negative = analysisOf(startupPositiveProject(true))
  assert.equal(
    negative.findings.some(
      (finding) => finding.signature === 'fragility.startup-write-race'
    ),
    false
  )
})

test('F2 distinguishes non-triggering & computed prefix boundaries', () =>
{
  const invalidSound = startupBoundaryProject({
    id: 'invalid-sound-prefix',
    opcode: 'sound_playuntildone',
    extra: {
      inputs: createScratchRecord<BlockInput>([
        ['SOUND_MENU', [1, [10, 'missing']]],
      ]),
    },
  })
  assert.equal(
    analysisOf(invalidSound).findings.find(
      (finding) => finding.signature === 'fragility.startup-write-race'
    )?.verdict,
    'witnessed'
  )

  const noReceiver = startupBoundaryProject({
    id: 'empty-broadcast-prefix',
    opcode: 'event_broadcastandwait',
    extra: {
      inputs: createScratchRecord<BlockInput>([
        ['BROADCAST_INPUT', [1, [11, 'nobody', 'nobody-id']]],
      ]),
    },
  })
  noReceiver.targets.find((target) => target.isStage)!.broadcasts =
    createScratchRecord([['nobody-id', 'nobody']])
  assert.equal(
    analysisOf(noReceiver).findings.find(
      (finding) => finding.signature === 'fragility.startup-write-race'
    )?.verdict,
    'witnessed'
  )

  const computedWait = startupBoundaryProject({
    id: 'computed-wait-prefix',
    opcode: 'control_wait',
    extra: {
      inputs: createScratchRecord<BlockInput>([
        ['DURATION', [2, 'computed-duration']],
      ]),
    },
  })
  const sprite = computedWait.targets.find((target) => !target.isStage)!
  put(sprite, 'computed-duration', {
    opcode: 'operator_join',
    next: null,
    parent: 'computed-wait-prefix',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: false,
  })
  const uncertain = analysisOf(computedWait).findings.find(
    (finding) => finding.signature === 'fragility.startup-write-race'
  )
  assert.equal(uncertain, undefined)
})

test('A1 requires a touching probe in the save/restore window', () =>
{
  const positive = analysisOf(advisoryPositiveProject(true))
  assert.ok(
    signaturesOf(positive).has('fragility.warp-probe-restore:witnessed')
  )
  const negative = analysisOf(advisoryPositiveProject(false))
  assert.equal(
    negative.advisories.some(
      (finding) => finding.signature === 'fragility.warp-probe-restore'
    ),
    false
  )
})

test('A1 requires a same-axis restore from the exact saved variable', () =>
{
  const exact = analysisOf(probeRestoreProject('exact')).advisories.filter(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(exact.length, 1)
  assert.equal(exact[0]!.verdict, 'witnessed')
  assert.deepEqual(
    exact[0]!.evidence.map((entry) => entry.blockId),
    [
      'probe-exact-save',
      'probe-exact-teleport',
      'probe-exact-carrier',
      'probe-exact-restore',
    ]
  )

  for (const variant of ['turn', 'wrong-axis', 'other-variable'] as const)
  {
    assert.equal(
      analysisOf(probeRestoreProject(variant)).advisories.some(
        (finding) => finding.signature === 'fragility.warp-probe-restore'
      ),
      false,
      `${variant} must not count as an exact x restoration`
    )
  }
})

test('A1 rejects transformed values & intervening saved-variable writes', () =>
{
  for (const variant of [
    'transformed-save',
    'transformed-restore',
    'intervening-write',
  ] as const)
  {
    assert.equal(
      analysisOf(probeRestoreProject(variant)).advisories.some(
        (finding) => finding.signature === 'fragility.warp-probe-restore'
      ),
      false,
      `${variant} must not count as an exact saved-position restoration`
    )
  }
})

test('A1 evaluates clean, waiting, & unresolved procedure closures', () =>
{
  const clean = analysisOf(
    probeRestoreProject('exact', 'clean')
  ).advisories.find(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(clean?.verdict, 'witnessed')
  assert.match(clean?.message ?? '', /atomic anyway/)

  const waiting = analysisOf(
    probeRestoreProject('exact', 'waiting')
  ).advisories.find(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(waiting?.verdict, 'witnessed')
  assert.match(waiting?.message ?? '', /non-atomic probe window/)

  const unresolved = analysisOf(
    probeRestoreProject('exact', 'unresolved')
  ).advisories.find(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(unresolved?.verdict, 'indeterminate')
  assert.equal(unresolved?.indeterminateReason, 'unresolved-closure')
})

test('A1 treats a recursive procedure in the probe window as unresolved', () =>
{
  const recursive = analysisOf(
    probeRestoreProject('exact', 'recursive')
  ).advisories.find(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(recursive?.verdict, 'indeterminate')
})

test('A1 keeps unresolved closure indeterminate after an earlier wait', () =>
{
  const finding = analysisOf(
    probeRestoreProject('exact', 'waiting-then-unresolved')
  ).advisories.find(
    (entry) => entry.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(finding?.verdict, 'indeterminate')
  assert.equal(finding?.indeterminateReason, 'unresolved-closure')
})

test('A1 follows saved-variable writes through called procedures', () =>
{
  const definite = analysisOf(
    probeRestoreProject('exact', 'writes-saved')
  ).advisories.filter(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(definite.length, 0)

  const conditional = analysisOf(
    probeRestoreProject('exact', 'conditionally-writes-saved')
  ).advisories.filter(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(conditional.length, 1)
  assert.equal(conditional[0]!.verdict, 'indeterminate')
})

test('A1 excludes restores after definitely nonreturning calls', () =>
{
  const findings = analysisOf(
    probeRestoreProject('exact', 'nonreturning')
  ).advisories.filter(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(findings.length, 0)
})

test('A1 uses the save-site warp state after an earlier Promise', () =>
{
  const finding = analysisOf(warpPromiseBeforeProbeProject()).advisories.find(
    (entry) => entry.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(finding?.verdict, 'witnessed')
  assert.match(finding?.message ?? '', /non-atomic probe window/)
  assert.doesNotMatch(
    finding?.message ?? '',
    /atomicity preserved within the 500 ms budget/
  )
})

test('A1 joins both if-else branch outcomes', () =>
{
  const bothWaiting = analysisOf(
    probeRestoreProject('exact', 'both-branches-waiting')
  ).advisories.find(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(bothWaiting?.verdict, 'witnessed')
  assert.match(bothWaiting?.message ?? '', /non-atomic probe window/)

  const oneWaiting = analysisOf(
    probeRestoreProject('exact', 'one-branch-waiting')
  ).advisories.find(
    (finding) => finding.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(oneWaiting?.verdict, 'indeterminate')
})

test('A1 marks saves after a direct recursive call indeterminate', () =>
{
  const finding = analysisOf(
    probeRestoreProject('exact', 'none', 'recursive-before-save')
  ).advisories.find(
    (entry) => entry.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(finding?.verdict, 'indeterminate')
})

test('A1 joins direct-prefix if-else completion before the save', () =>
{
  const stopped = analysisOf(
    probeRestoreProject('exact', 'none', 'both-arms-stop-before-save')
  ).advisories.filter(
    (entry) => entry.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(stopped.length, 0)

  const maybeReached = analysisOf(
    probeRestoreProject('exact', 'none', 'one-arm-stop-before-save')
  ).advisories.find(
    (entry) => entry.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(maybeReached?.verdict, 'indeterminate')
})

test('A1 excludes restores after two stopping if-else arms', () =>
{
  const findings = analysisOf(
    probeRestoreProject('exact', 'none', 'both-arms-stop-before-restore')
  ).advisories.filter(
    (entry) => entry.signature === 'fragility.warp-probe-restore'
  )
  assert.equal(findings.length, 0)
})

test('A2 requires a reachable wait before the shared reader', () =>
{
  const positive = analysisOf(
    timingBarrierProject('wait-before-read')
  ).advisories.filter(
    (finding) => finding.signature === 'fragility.timing-barrier-wait'
  )
  assert.equal(positive.length, 1)
  assert.deepEqual(
    positive[0]!.evidence.map((entry) => entry.blockId),
    ['ordered-wait', 'ordered-reader']
  )

  for (const order of [
    'read-before-wait',
    'branch-read',
    'forever-before-read',
    'nonreturning-call-before-read',
    'wait-until-false-before-read',
    'repeat-until-false-before-read',
    'both-arms-stop-before-read',
  ] as const)
  {
    assert.equal(
      analysisOf(timingBarrierProject(order)).advisories.some(
        (finding) => finding.signature === 'fragility.timing-barrier-wait'
      ),
      false,
      `${order} must not establish a reachable wait-before-read path`
    )
  }
})

test('A2 emits at most one advisory for each declaration', () =>
{
  const repeated = analysisOf(
    repeatedTimingBarrierReadersProject(false)
  ).advisories.filter(
    (finding) => finding.signature === 'fragility.timing-barrier-wait'
  )
  assert.equal(repeated.length, 1)
  assert.match(repeated[0]!.message, /"repeated first"/)

  const twoDeclarations = analysisOf(
    repeatedTimingBarrierReadersProject(true)
  ).advisories.filter(
    (finding) => finding.signature === 'fragility.timing-barrier-wait'
  )
  assert.equal(twoDeclarations.length, 2)
  assert.deepEqual(
    new Set(twoDeclarations.map((finding) => finding.message)),
    new Set([
      'small wait precedes access to shared variable "repeated first"',
      'small wait precedes access to shared variable "repeated second"',
    ])
  )
})

test(
  'A2 caps timing advisories with exact omitted & coverage counts',
  { timeout: 10_000 },
  () =>
  {
    const analysis = analysisOf(timingBarrierCapProject(1_005))
    const timingAdvisories = analysis.advisories.filter(
      (finding) => finding.signature === 'fragility.timing-barrier-wait'
    )
    assert.equal(timingAdvisories.length, 1_000)
    assert.equal(analysis.advisories.length, 1_000)
    assert.deepEqual(analysis.omitted, {
      findings: 0,
      advisories: 5,
    })
    assert.deepEqual(
      analysis.coverage.find(
        (entry) => entry.signature === 'fragility.timing-barrier-wait'
      ),
      {
        signature: 'fragility.timing-barrier-wait',
        ran: true,
        findingCount: 1_005,
        indeterminateCount: 0,
      }
    )
  }
)

test('A2 and A3 witness timing barriers & declaration shadowing', () =>
{
  const analysis = analysisOf(advisoryPositiveProject(true))
  const signatures = signaturesOf(analysis)
  assert.ok(signatures.has('fragility.timing-barrier-wait:witnessed'))
  assert.ok(signatures.has('fragility.declaration-shadowing:witnessed'))

  const negative = mutableProject()
  const stage = negative.targets.find((target) => target.isStage)!
  const sprite = negative.targets.find((target) => !target.isStage)!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'global-name', [
    'global only',
    0,
  ])
  defineScratchRecordValue<VariableEntry>(sprite.variables, 'local-name', [
    'local only',
    0,
  ])
  assert.equal(
    analysisOf(negative).advisories.some(
      (finding) => finding.signature === 'fragility.declaration-shadowing'
    ),
    false
  )
})

test('A3 groups thousands of declarations with one stable collision', () =>
{
  const json = mutableProject()
  for (const target of json.targets)
  {
    target.variables = createScratchRecord<VariableEntry>()
    target.lists = createScratchRecord()
  }
  const stage = json.targets.find((target) => target.isStage)!
  const sprite = json.targets.find((target) => !target.isStage)!
  for (let index = 0; index < 2_500; index++)
  {
    defineScratchRecordValue<VariableEntry>(
      stage.variables,
      `global-unique-${index}`,
      [`global unique ${index}`, 0]
    )
    defineScratchRecordValue<VariableEntry>(
      sprite.variables,
      `local-unique-${index}`,
      [`local unique ${index}`, 0]
    )
  }
  defineScratchRecordValue<VariableEntry>(
    stage.variables,
    'stable-collision-global',
    ['stable collision', 0]
  )
  defineScratchRecordValue<VariableEntry>(
    sprite.variables,
    'stable-collision-local',
    ['stable collision', 0]
  )

  const collisions = analysisOf(json).advisories.filter(
    (finding) => finding.signature === 'fragility.declaration-shadowing'
  )
  assert.equal(collisions.length, 1)
  assert.equal(
    collisions[0]!.message,
    'variable "stable collision" is declared globally and locally'
  )
  assert.deepEqual(
    collisions[0]!.evidence.map((entry) => entry.blockId),
    ['stable-collision-global', 'stable-collision-local']
  )
})

test('T8 fragility analysis is deterministic', () =>
{
  const json = warpPositiveProject()
  assert.deepEqual(analysisOf(json), analysisOf(json))
})

test(
  'project identity keys and fragility analysis bound repeated target names',
  {
    timeout: 5_000,
  },
  () =>
  {
    const json = mutableProject()
    const sprite = json.targets.find((target) => !target.isStage)!
    sprite.name = 'repeated-target-name'.repeat(16_384)
    sprite.blocks = createScratchRecord<BlockEntry>()
    for (let index = 0; index < 600; index++)
    {
      put(sprite, `bounded-${index}`, {
        opcode: 'looks_say',
        next: null,
        parent: null,
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: true,
        x: index,
        y: 0,
      })
    }

    const startedAt = performance.now()
    assert.doesNotThrow(() => analysisOf(json))
    assert.ok(performance.now() - startedAt < 5_000)
    assert.equal(
      targetKey({
        targetIndex: 1,
        name: sprite.name,
        isStage: false,
      }),
      '[1]'
    )
  }
)
