// packages/ir/src/edit/standard-authoring/catalog.ts
// describe the complete public Scratch palette & builder-owned shadows

import { semanticHashV1 } from '../contracts/hash-domains.js'
import type { VanillaBlockShape } from '../contracts/catalog.js'
import { deepFreeze } from '../support/immutable.js'
import {
  SENSING_PROPERTY_BUILTIN_POLICY_V1,
  STANDARD_SCALAR_FIELD_NORMALIZATION_V2,
} from '../semantic-index/sensing-property-policy.js'
import { STANDARD_CONNECTION_POLICY_V2 } from './connection-policy.js'
import { STANDARD_REFERENCE_REPRESENTABILITY_POLICY_V2 } from './reference-policy.js'
import {
  STANDARD_AUTHORING_PINNED_SOURCES_V2,
  STANDARD_AUTHORING_PINNED_PACKAGES_V2,
} from './sources.js'
import {
  STANDARD_AUTHORING_EXCLUSIONS_V2,
  STANDARD_PROCEDURE_OPCODES_V2,
} from './inventory.js'

export interface StandardFieldDescriptorV2
{
  readonly name: string
  readonly kind:
    'enum' | 'text' | 'number' | 'declaration' | 'media' | 'sensingProperty'
  readonly semanticDomain: string
  readonly serialization: string
  readonly canonicalDefault: string
  readonly choices: readonly string[]
  readonly referenceDomain: string | null
  readonly requiredEntitySubtype: string | null
}

export interface StandardInputDescriptorV2
{
  readonly name: string
  readonly connection:
    'stringOrNumber' | 'number' | 'boolean' | 'substack' | 'entityMenu'
  readonly semanticDomain: string
  readonly canonicalShadow: null | {
    readonly kind: 'primitive' | 'entityMenu' | 'menu'
    readonly opcode: string
    readonly field?: string
    readonly sb3PrimitiveTag: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | null
    readonly value: string
    readonly fallbackDisplayValue: string
  }
  readonly choices: readonly string[]
  readonly specialTokens: readonly string[]
  readonly referenceDomain: string | null
  readonly requiredEntitySubtype: string | null
}

export interface StandardAuthoringDescriptorV2
{
  readonly opcode: string
  readonly category: string
  readonly shape: VanillaBlockShape
  readonly context: {
    readonly allowedPlacements: readonly (
      | 'eventScriptHat'
      | 'topLevelStatement'
      | 'statementSequence'
      | 'topLevelExpression'
      | 'reporterInput'
      | 'booleanInput'
      | 'menuShadow'
    )[]
    readonly ownerTargets: readonly ('stage' | 'sprite')[]
    readonly acceptsSuccessor: boolean
    readonly mustTerminateSequence: boolean
  }
  readonly requiredFields: readonly StandardFieldDescriptorV2[]
  readonly optionalFields: readonly StandardFieldDescriptorV2[]
  readonly requiredInputs: readonly StandardInputDescriptorV2[]
  readonly optionalInputs: readonly StandardInputDescriptorV2[]
  readonly referenceDomains: readonly string[]
  readonly orderDomains: readonly string[]
  readonly safeBuilderKind:
    'ordinaryBlock' | 'referenceMenuShadow' | 'procedure'
  readonly readSetDerivation: string
  readonly writeSetDerivation: string
  readonly deleteSetDerivation: string
  readonly resultSlots: {
    readonly fixed: readonly string[]
    readonly dynamic: readonly string[]
    readonly conditional: readonly string[]
  }
  readonly availability: 'supported' | 'builderOnly' | 'preservationOnly'
  readonly preservationOnlyReason: string | null
  readonly evidence: readonly string[]
}

const BOTH = ['stage', 'sprite'] as const
const SPRITE = ['sprite'] as const
const rows: StandardAuthoringDescriptorV2[] = []

function input(
  name: string,
  tag: 4 | 5 | 6 | 7 | 8 | 9 | 10 = 4,
  value = '0'
): StandardInputDescriptorV2
{
  const opcode = {
    4: 'math_number',
    5: 'math_positive_number',
    6: 'math_whole_number',
    7: 'math_integer',
    8: 'math_angle',
    9: 'colour_picker',
    10: 'text',
  }[tag]
  return {
    name,
    connection: tag === 9 || tag === 10 ? 'stringOrNumber' : 'number',
    semanticDomain:
      tag === 9 ? 'color' : tag === 10 ? 'ScratchScalarV1' : 'ScratchNumberV1',
    canonicalShadow: {
      kind: 'primitive',
      opcode,
      sb3PrimitiveTag: tag,
      value,
      fallbackDisplayValue: value,
    },
    choices: [],
    specialTokens: [],
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

function optional(
  name: string,
  connection: 'boolean' | 'substack'
): StandardInputDescriptorV2
{
  return {
    name,
    connection,
    semanticDomain: connection,
    canonicalShadow: null,
    choices: [],
    specialTokens: [],
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

function menu(
  name: string,
  opcode: string,
  field: string,
  value: string,
  referenceDomain: string | null = null,
  specialTokens: readonly string[] = [],
  choices: readonly string[] = []
): StandardInputDescriptorV2
{
  return {
    name,
    connection:
      referenceDomain === 'broadcast' ? 'entityMenu' : 'stringOrNumber',
    semanticDomain: referenceDomain ?? 'menu',
    canonicalShadow: {
      kind: referenceDomain === 'broadcast' ? 'entityMenu' : 'menu',
      opcode,
      field,
      sb3PrimitiveTag: referenceDomain === 'broadcast' ? 11 : null,
      value,
      fallbackDisplayValue: value,
    },
    choices,
    specialTokens,
    referenceDomain,
    requiredEntitySubtype: referenceDomain,
  }
}

function field(
  name: string,
  choices: readonly string[]
): StandardFieldDescriptorV2
{
  return {
    name,
    kind: 'enum',
    semanticDomain: 'enum',
    serialization: 'single-value-field',
    canonicalDefault: choices[0] ?? '',
    choices,
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

function reference(
  name: string,
  domain: 'variable' | 'list' | 'broadcast' | 'backdrop'
): StandardFieldDescriptorV2
{
  return {
    name,
    kind: domain === 'backdrop' ? 'media' : 'declaration',
    semanticDomain: domain,
    serialization:
      domain === 'backdrop' ? 'display-name-field' : 'name-and-id-field',
    canonicalDefault: '',
    choices: [],
    referenceDomain: domain,
    requiredEntitySubtype: domain,
  }
}

function add(
  opcode: string,
  shape: VanillaBlockShape = 'stack',
  inputs: readonly StandardInputDescriptorV2[] = [],
  fields: readonly StandardFieldDescriptorV2[] = [],
  owners: readonly ('stage' | 'sprite')[] = BOTH,
  terminal = shape === 'cap' || opcode === 'control_forever'
): void
{
  const category = opcode.startsWith('operator_')
    ? 'operators'
    : opcode.split('_')[0]!
  const expression = shape === 'reporter' || shape === 'boolean'
  rows.push({
    opcode,
    category,
    shape,
    context: {
      allowedPlacements:
        shape === 'hat'
          ? ['eventScriptHat']
          : shape === 'menuReporter'
            ? ['menuShadow']
            : expression
              ? [
                  'topLevelExpression',
                  shape === 'boolean' ? 'booleanInput' : 'reporterInput',
                ]
              : ['topLevelStatement', 'statementSequence'],
      ownerTargets: owners,
      acceptsSuccessor: !expression && shape !== 'menuReporter' && !terminal,
      mustTerminateSequence: terminal,
    },
    requiredFields: fields,
    optionalFields: [],
    requiredInputs: inputs.filter(
      (x) => x.connection !== 'boolean' && x.connection !== 'substack'
    ),
    optionalInputs: inputs.filter(
      (x) => x.connection === 'boolean' || x.connection === 'substack'
    ),
    referenceDomains: [
      ...new Set(
        [...fields, ...inputs].flatMap((x) =>
          x.referenceDomain === null ? [] : [x.referenceDomain]
        )
      ),
    ],
    orderDomains: [],
    safeBuilderKind:
      shape === 'menuReporter' ? 'referenceMenuShadow' : 'ordinaryBlock',
    readSetDerivation:
      'exact descriptor fields and inputs plus resolved reference evidence',
    writeSetDerivation: 'owned block closure',
    deleteSetDerivation: 'owned block closure',
    resultSlots: {
      fixed: ['rootBlock'],
      dynamic: ['blockAlias'],
      conditional: [],
    },
    availability: shape === 'menuReporter' ? 'builderOnly' : 'supported',
    preservationOnlyReason: null,
    evidence: ['pinned-scratch-blocks-2.1.19', 'pinned-scratch-vm-15.1.0'],
  })
}

const keyChoices = [
  'space',
  'up arrow',
  'down arrow',
  'right arrow',
  'left arrow',
  'any',
  ...'abcdefghijklmnopqrstuvwxyz0123456789',
]
const effects = [
  'COLOR',
  'FISHEYE',
  'WHIRL',
  'PIXELATE',
  'MOSAIC',
  'BRIGHTNESS',
  'GHOST',
]
const targetMenu = (
  name: string,
  opcode: string,
  specials: readonly string[]
) =>
  menu(
    name,
    opcode,
    name,
    {
      mouse: '_mouse_',
      random: '_random_',
      myself: '_myself_',
      edge: '_edge_',
      stage: '_stage_',
    }[specials[0] as 'mouse' | 'random' | 'myself' | 'edge' | 'stage'] ?? '',
    'target',
    specials
  )
const costume = menu('COSTUME', 'looks_costume', 'COSTUME', '', 'costume', [
  'next',
  'previous',
])
const backdrop = menu(
  'BACKDROP',
  'looks_backdrops',
  'BACKDROP',
  '',
  'backdrop',
  ['next', 'previous', 'random']
)
const broadcast = menu(
  'BROADCAST_INPUT',
  'event_broadcast_menu',
  'BROADCAST_OPTION',
  '',
  'broadcast'
)

for (const [opcode, name, tag, value] of [
  ['movesteps', 'STEPS', 4, '10'],
  ['turnright', 'DEGREES', 4, '15'],
  ['turnleft', 'DEGREES', 4, '15'],
  ['pointindirection', 'DIRECTION', 8, '90'],
  ['changexby', 'DX', 4, '10'],
  ['setx', 'X', 4, '0'],
  ['changeyby', 'DY', 4, '10'],
  ['sety', 'Y', 4, '0'],
] as const)
  add(`motion_${opcode}`, 'stack', [input(name, tag, value)], [], SPRITE)
add(
  'motion_pointtowards',
  'stack',
  [targetMenu('TOWARDS', 'motion_pointtowards_menu', ['mouse'])],
  [],
  SPRITE
)
add(
  'motion_goto',
  'stack',
  [targetMenu('TO', 'motion_goto_menu', ['mouse', 'random'])],
  [],
  SPRITE
)
add('motion_gotoxy', 'stack', [input('X'), input('Y')], [], SPRITE)
add(
  'motion_glidesecstoxy',
  'stack',
  [input('SECS', 4, '1'), input('X'), input('Y')],
  [],
  SPRITE
)
add(
  'motion_glideto',
  'stack',
  [
    input('SECS', 4, '1'),
    targetMenu('TO', 'motion_glideto_menu', ['mouse', 'random']),
  ],
  [],
  SPRITE
)
add('motion_ifonedgebounce', 'stack', [], [], SPRITE)
add(
  'motion_setrotationstyle',
  'stack',
  [],
  [field('STYLE', ['left-right', "don't rotate", 'all around'])],
  SPRITE
)
for (const opcode of ['xposition', 'yposition', 'direction'])
  add(`motion_${opcode}`, 'reporter', [], [], SPRITE)

for (const opcode of ['say', 'think'])
{
  add(`looks_${opcode}`, 'stack', [input('MESSAGE', 10, 'Hello!')], [], SPRITE)
  add(
    `looks_${opcode}forsecs`,
    'stack',
    [input('MESSAGE', 10, 'Hello!'), input('SECS', 4, '2')],
    [],
    SPRITE
  )
}
for (const opcode of ['show', 'hide', 'nextcostume'])
  add(`looks_${opcode}`, 'stack', [], [], SPRITE)
for (const opcode of ['cleargraphiceffects', 'nextbackdrop'])
  add(`looks_${opcode}`)
add(
  'looks_changeeffectby',
  'stack',
  [input('CHANGE', 4, '25')],
  [field('EFFECT', effects)]
)
add('looks_seteffectto', 'stack', [input('VALUE')], [field('EFFECT', effects)])
add('looks_changesizeby', 'stack', [input('CHANGE', 4, '10')], [], SPRITE)
add('looks_setsizeto', 'stack', [input('SIZE', 4, '100')], [], SPRITE)
add('looks_size', 'reporter', [], [], SPRITE)
add('looks_switchcostumeto', 'stack', [costume], [], SPRITE)
for (const opcode of ['switchbackdropto', 'switchbackdroptoandwait'])
  add(`looks_${opcode}`, 'stack', [backdrop])
add(
  'looks_gotofrontback',
  'stack',
  [],
  [field('FRONT_BACK', ['front', 'back'])],
  SPRITE
)
add(
  'looks_goforwardbackwardlayers',
  'stack',
  [input('NUM', 7, '1')],
  [field('FORWARD_BACKWARD', ['forward', 'backward'])],
  SPRITE
)
add(
  'looks_costumenumbername',
  'reporter',
  [],
  [field('NUMBER_NAME', ['number', 'name'])],
  SPRITE
)
add(
  'looks_backdropnumbername',
  'reporter',
  [],
  [field('NUMBER_NAME', ['number', 'name'])]
)

for (const opcode of ['play', 'playuntildone'])
  add(`sound_${opcode}`, 'stack', [
    menu('SOUND_MENU', 'sound_sounds_menu', 'SOUND_MENU', '', 'sound'),
  ])
for (const opcode of ['stopallsounds', 'cleareffects']) add(`sound_${opcode}`)
add(
  'sound_seteffectto',
  'stack',
  [input('VALUE')],
  [field('EFFECT', ['PITCH', 'PAN'])]
)
add(
  'sound_changeeffectby',
  'stack',
  [input('VALUE', 4, '10')],
  [field('EFFECT', ['PITCH', 'PAN'])]
)
add('sound_changevolumeby', 'stack', [input('VOLUME', 4, '-10')])
add('sound_setvolumeto', 'stack', [input('VOLUME', 4, '100')])
add('sound_volume', 'reporter')

add('event_whenflagclicked', 'hat')
add('event_whenthisspriteclicked', 'hat', [], [], SPRITE)
add('event_whenstageclicked', 'hat', [], [], ['stage'])
add('event_whenkeypressed', 'hat', [], [field('KEY_OPTION', keyChoices)])
add(
  'event_whenbroadcastreceived',
  'hat',
  [],
  [reference('BROADCAST_OPTION', 'broadcast')]
)
add(
  'event_whenbackdropswitchesto',
  'hat',
  [],
  [reference('BACKDROP', 'backdrop')]
)
add(
  'event_whengreaterthan',
  'hat',
  [input('VALUE', 4, '10')],
  [field('WHENGREATERTHANMENU', ['LOUDNESS', 'TIMER'])]
)
add('event_broadcast', 'stack', [broadcast])
add('event_broadcastandwait', 'stack', [broadcast])

add('control_wait', 'stack', [input('DURATION', 5, '1')])
add('control_repeat', 'cShape', [
  input('TIMES', 6, '10'),
  optional('SUBSTACK', 'substack'),
])
add('control_forever', 'cShape', [optional('SUBSTACK', 'substack')])
add('control_if', 'cShape', [
  optional('CONDITION', 'boolean'),
  optional('SUBSTACK', 'substack'),
])
add('control_if_else', 'cShape', [
  optional('CONDITION', 'boolean'),
  optional('SUBSTACK', 'substack'),
  optional('SUBSTACK2', 'substack'),
])
add('control_wait_until', 'stack', [optional('CONDITION', 'boolean')])
add('control_repeat_until', 'cShape', [
  optional('CONDITION', 'boolean'),
  optional('SUBSTACK', 'substack'),
])
add(
  'control_stop',
  'cap',
  [],
  [field('STOP_OPTION', ['all', 'this script', 'other scripts in sprite'])]
)
add('control_start_as_clone', 'hat', [], [], SPRITE)
add('control_create_clone_of', 'stack', [
  targetMenu('CLONE_OPTION', 'control_create_clone_of_menu', ['myself']),
])
add('control_delete_this_clone', 'cap', [], [], SPRITE)

add(
  'sensing_touchingobject',
  'boolean',
  [
    targetMenu('TOUCHINGOBJECTMENU', 'sensing_touchingobjectmenu', [
      'mouse',
      'edge',
    ]),
  ],
  [],
  SPRITE
)
add(
  'sensing_touchingcolor',
  'boolean',
  [input('COLOR', 9, '#43066f')],
  [],
  SPRITE
)
add(
  'sensing_coloristouchingcolor',
  'boolean',
  [input('COLOR', 9, '#43066f'), input('COLOR2', 9, '#43066f')],
  [],
  SPRITE
)
add(
  'sensing_distanceto',
  'reporter',
  [targetMenu('DISTANCETOMENU', 'sensing_distancetomenu', ['mouse'])],
  [],
  SPRITE
)
add('sensing_askandwait', 'stack', [input('QUESTION', 10, "What's your name?")])
add('sensing_keypressed', 'boolean', [
  menu(
    'KEY_OPTION',
    'sensing_keyoptions',
    'KEY_OPTION',
    'space',
    null,
    [],
    keyChoices
  ),
])
add('sensing_mousedown', 'boolean')
for (const opcode of [
  'answer',
  'mousex',
  'mousey',
  'loudness',
  'timer',
  'dayssince2000',
  'username',
])
  add(`sensing_${opcode}`, 'reporter')
add('sensing_resettimer')
add(
  'sensing_setdragmode',
  'stack',
  [],
  [field('DRAG_MODE', ['draggable', 'not draggable'])],
  SPRITE
)
add(
  'sensing_current',
  'reporter',
  [],
  [
    field('CURRENTMENU', [
      'YEAR',
      'MONTH',
      'DATE',
      'DAYOFWEEK',
      'HOUR',
      'MINUTE',
      'SECOND',
    ]),
  ]
)
add(
  'sensing_of',
  'reporter',
  [targetMenu('OBJECT', 'sensing_of_object_menu', ['stage'])],
  [
    {
      ...field('PROPERTY', [
        'x position',
        'y position',
        'direction',
        'costume #',
        'costume name',
        'size',
        'volume',
        'backdrop #',
        'backdrop name',
      ]),
      kind: 'sensingProperty',
      referenceDomain: 'variable',
      requiredEntitySubtype: 'variable',
    },
  ]
)

for (const opcode of ['add', 'subtract', 'multiply', 'divide', 'mod'])
  add(`operator_${opcode}`, 'reporter', [input('NUM1'), input('NUM2')])
add('operator_random', 'reporter', [
  input('FROM', 4, '1'),
  input('TO', 4, '10'),
])
for (const opcode of ['lt', 'equals', 'gt'])
  add(`operator_${opcode}`, 'boolean', [
    input('OPERAND1', 10),
    input('OPERAND2', 10, '50'),
  ])
for (const opcode of ['and', 'or'])
  add(`operator_${opcode}`, 'boolean', [
    optional('OPERAND1', 'boolean'),
    optional('OPERAND2', 'boolean'),
  ])
add('operator_not', 'boolean', [optional('OPERAND', 'boolean')])
add('operator_join', 'reporter', [
  input('STRING1', 10, 'apple '),
  input('STRING2', 10, 'banana'),
])
add('operator_letter_of', 'reporter', [
  input('LETTER', 6, '1'),
  input('STRING', 10, 'apple'),
])
add('operator_length', 'reporter', [input('STRING', 10, 'apple')])
add('operator_contains', 'boolean', [
  input('STRING1', 10, 'apple'),
  input('STRING2', 10, 'a'),
])
add('operator_round', 'reporter', [input('NUM')])
add(
  'operator_mathop',
  'reporter',
  [input('NUM')],
  [
    field('OPERATOR', [
      'abs',
      'floor',
      'ceiling',
      'sqrt',
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'ln',
      'log',
      'e ^',
      '10 ^',
    ]),
  ]
)

const variable = reference('VARIABLE', 'variable')
const list = reference('LIST', 'list')
add('data_variable', 'reporter', [], [variable])
add('data_setvariableto', 'stack', [input('VALUE', 10)], [variable])
add('data_changevariableby', 'stack', [input('VALUE', 4, '1')], [variable])
for (const opcode of ['showvariable', 'hidevariable'])
  add(`data_${opcode}`, 'stack', [], [variable])
add('data_listcontents', 'reporter', [], [list])
add('data_addtolist', 'stack', [input('ITEM', 10, 'thing')], [list])
add('data_deleteoflist', 'stack', [input('INDEX', 7, '1')], [list])
add('data_deletealloflist', 'stack', [], [list])
add(
  'data_insertatlist',
  'stack',
  [input('ITEM', 10, 'thing'), input('INDEX', 7, '1')],
  [list]
)
add(
  'data_replaceitemoflist',
  'stack',
  [input('INDEX', 7, '1'), input('ITEM', 10, 'thing')],
  [list]
)
add('data_itemoflist', 'reporter', [input('INDEX', 7, '1')], [list])
add('data_itemnumoflist', 'reporter', [input('ITEM', 10, 'thing')], [list])
add('data_lengthoflist', 'reporter', [], [list])
add('data_listcontainsitem', 'boolean', [input('ITEM', 10, 'thing')], [list])
for (const opcode of ['showlist', 'hidelist'])
  add(`data_${opcode}`, 'stack', [], [list])

const coreCount = rows.length
if (coreCount !== 121)
  throw new Error(`standard core inventory has ${coreCount} entries`)
add('pen_clear')
for (const opcode of ['stamp', 'penDown', 'penUp'])
  add(`pen_${opcode}`, 'stack', [], [], SPRITE)
add(
  'pen_setPenColorToColor',
  'stack',
  [input('COLOR', 9, '#43066f')],
  [],
  SPRITE
)
const colorParam = menu(
  'COLOR_PARAM',
  'pen_menu_colorParam',
  'colorParam',
  'color',
  null,
  [],
  ['color', 'saturation', 'brightness', 'transparency']
)
add(
  'pen_changePenColorParamBy',
  'stack',
  [colorParam, input('VALUE', 4, '10')],
  [],
  SPRITE
)
add(
  'pen_setPenColorParamTo',
  'stack',
  [colorParam, input('VALUE', 4, '50')],
  [],
  SPRITE
)
add('pen_changePenSizeBy', 'stack', [input('SIZE', 4, '1')], [], SPRITE)
add('pen_setPenSizeTo', 'stack', [input('SIZE', 4, '1')], [], SPRITE)
add('music_playDrumForBeats', 'stack', [
  menu(
    'DRUM',
    'music_menu_DRUM',
    'DRUM',
    '1',
    null,
    [],
    Array.from({ length: 18 }, (_, i) => String(i + 1))
  ),
  input('BEATS', 4, '0.25'),
])
add('music_restForBeats', 'stack', [input('BEATS', 4, '0.25')])
add('music_playNoteForBeats', 'stack', [
  { ...menu('NOTE', 'note', 'NOTE', '60'), connection: 'number' },
  input('BEATS', 4, '0.25'),
])
add('music_setInstrument', 'stack', [
  menu(
    'INSTRUMENT',
    'music_menu_INSTRUMENT',
    'INSTRUMENT',
    '1',
    null,
    [],
    Array.from({ length: 21 }, (_, i) => String(i + 1))
  ),
])
add('music_setTempo', 'stack', [input('TEMPO', 4, '60')])
add('music_changeTempo', 'stack', [input('TEMPO', 4, '20')])
add('music_getTempo', 'reporter')
add('videoSensing_whenMotionGreaterThan', 'hat', [input('REFERENCE', 4, '10')])
add('videoSensing_videoOn', 'reporter', [
  menu(
    'ATTRIBUTE',
    'videoSensing_menu_ATTRIBUTE',
    'ATTRIBUTE',
    'motion',
    null,
    [],
    ['motion', 'direction']
  ),
  menu(
    'SUBJECT',
    'videoSensing_menu_SUBJECT',
    'SUBJECT',
    'this sprite',
    null,
    [],
    ['this sprite', 'Stage']
  ),
])
add('videoSensing_videoToggle', 'stack', [
  menu(
    'VIDEO_STATE',
    'videoSensing_menu_VIDEO_STATE',
    'VIDEO_STATE',
    'on',
    null,
    [],
    ['off', 'on', 'on-flipped']
  ),
])
add('videoSensing_setVideoTransparency', 'stack', [
  input('TRANSPARENCY', 4, '50'),
])

const publicRows = [...rows]
const shadowRows = new Map<string, StandardAuthoringDescriptorV2>()
for (const descriptor of publicRows)
{
  for (const entry of descriptor.requiredInputs)
  {
    const shadow = entry.canonicalShadow
    if (shadow === null || shadowRows.has(shadow.opcode)) continue
    const shadowField =
      shadow.kind === 'primitive'
        ? shadow.sb3PrimitiveTag === 9
          ? 'COLOUR'
          : shadow.sb3PrimitiveTag === 10
            ? 'TEXT'
            : 'NUM'
        : shadow.field!
    add(
      shadow.opcode,
      'menuReporter',
      [],
      [
        {
          name: shadowField,
          kind:
            entry.referenceDomain === 'broadcast'
              ? 'declaration'
              : entry.referenceDomain === null && entry.choices.length > 0
                ? 'enum'
                : 'text',
          semanticDomain: entry.semanticDomain,
          serialization:
            entry.referenceDomain === 'broadcast'
              ? 'name-and-id-field'
              : 'single-value-field',
          canonicalDefault: shadow.value,
          choices: entry.choices,
          referenceDomain: entry.referenceDomain,
          requiredEntitySubtype: entry.requiredEntitySubtype,
        },
      ]
    )
    shadowRows.set(shadow.opcode, rows.at(-1)!)
  }
}

export const STANDARD_PUBLIC_CORE_OPCODES_V2 = deepFreeze(
  publicRows
    .slice(0, coreCount)
    .map((x) => x.opcode)
    .sort()
)
export const STANDARD_PUBLIC_EXTENSION_OPCODES_V2 = deepFreeze(
  publicRows
    .slice(coreCount)
    .map((x) => x.opcode)
    .sort()
)
export const STANDARD_AUTHORING_DESCRIPTORS_V2 = deepFreeze(
  rows.sort((a, b) => (a.opcode < b.opcode ? -1 : a.opcode > b.opcode ? 1 : 0))
)
const byOpcode = new Map(
  STANDARD_AUTHORING_DESCRIPTORS_V2.map((x) => [x.opcode, x])
)
if (byOpcode.size !== rows.length)
  throw new Error('duplicate standard descriptor')

export function getStandardDescriptorV2(
  opcode: string
): StandardAuthoringDescriptorV2 | null
{
  return byOpcode.get(opcode) ?? null
}

export const standardAuthoringDescriptorV2 = getStandardDescriptorV2

export function standardDescriptorForBlockV2(
  opcode: string,
  fields: Readonly<Record<string, readonly unknown[]>> = {}
): StandardAuthoringDescriptorV2 | null
{
  const descriptor = getStandardDescriptorV2(opcode)
  if (descriptor === null || opcode !== 'control_stop') return descriptor
  const continuing = fields.STOP_OPTION?.[0] === 'other scripts in sprite'
  return {
    ...descriptor,
    shape: continuing ? 'stack' : 'cap',
    context: {
      ...descriptor.context,
      acceptsSuccessor: continuing,
      mustTerminateSequence: !continuing,
    },
  }
}

export const STANDARD_AUTHORING_BUILDER_POLICY_V2 = deepFreeze({
  schemaVersion: 2,
  idAuthority: 'ProjectIR.uids',
  recordPrototype: 'null',
  optionalEmptyInput: 'omit-exact-input-key',
  scalarLiteral: 'Scratch coercion preserved by literal input kind',
  booleanScalarLiteral: 'canonical-text-true-or-false',
  topLevelWorkspace: 'finite-x-y-on-root-only',
  entityReferences: 'exact-injected-resolution-with-read-evidence',
  nameRepresentability: STANDARD_REFERENCE_REPRESENTABILITY_POLICY_V2,
  procedures: 'explicit-owner-and-signature-scoped-resolution',
  socketCompatibility: STANDARD_CONNECTION_POLICY_V2,
  procedureCallValidation:
    'check-new-or-changed-call-signatures-and-argument-root-shapes',
  stopContinuation: 'exact STOP_OPTION and hasnext mutation',
  sensingProperty: {
    interpretation: SENSING_PROPERTY_BUILTIN_POLICY_V1,
    scalarBuiltin: 'selected-target-kind-applicability',
    exactVariable:
      'unique-selected-owner-name-and-no-selected-kind-builtin-collision',
    stagedEditPair:
      'selected-kind-builtin-or-unique-selected-owner-variable-after-graph-mutation',
    dynamicTarget: 'scalar-builtin-only-with-unverified-target-kind',
    rawField: 'name-only-structural-validation-with-contextual-pair-ownership',
    rawScalarNormalization: STANDARD_SCALAR_FIELD_NORMALIZATION_V2,
  },
  generatedInputShadows:
    'dispose-only-obsolete-unreferenced-owned-leaf-shadows',
  generatedInputMenuCreationContent: 'owner-descriptor-and-semantic-value-v1',
  operationRefusal: 'authored-schema-failed-and-staged-pair-project-constraint',
  unknownPayload: 'refuse structural edits',
  extensionAuthority: ['pen', 'music', 'videoSensing'],
})

export const STANDARD_AUTHORING_CATALOG_EVIDENCE_V2 = deepFreeze({
  schemaVersion: 2 as const,
  profileId: 'scratch-standard-authoring-v2' as const,
  profileVersion: 2 as const,
  authority: 'standard-v2' as const,
  descriptorCount: rows.length,
  authorableDescriptorCount: publicRows.length,
  builderOnlyDescriptorCount: rows.length - publicRows.length,
  publicCoreOpcodeCount: coreCount,
  publicExtensionOpcodeCount: publicRows.length - coreCount,
  specializedProcedureOpcodeCount: STANDARD_PROCEDURE_OPCODES_V2.length,
  preservationOnlyOpcodeCount: STANDARD_AUTHORING_EXCLUSIONS_V2.length,
  descriptorProfileSha256: semanticHashV1('capability-profile', {
    component: 'standard-block-descriptor-profile',
    schemaVersion: 2,
    value: STANDARD_AUTHORING_DESCRIPTORS_V2,
  }),
  builderPolicy: STANDARD_AUTHORING_BUILDER_POLICY_V2,
  builderPolicySha256: semanticHashV1('capability-profile', {
    component: 'standard-block-builder-policy',
    schemaVersion: 2,
    value: STANDARD_AUTHORING_BUILDER_POLICY_V2,
  }),
  pinnedSources: STANDARD_AUTHORING_PINNED_SOURCES_V2,
  pinnedPackages: STANDARD_AUTHORING_PINNED_PACKAGES_V2,
  authoritySha256: semanticHashV1('capability-profile', {
    component: 'standard-authoring-authority',
    schemaVersion: 2,
    descriptors: STANDARD_AUTHORING_DESCRIPTORS_V2,
    policy: STANDARD_AUTHORING_BUILDER_POLICY_V2,
    sources: STANDARD_AUTHORING_PINNED_SOURCES_V2,
    packages: STANDARD_AUTHORING_PINNED_PACKAGES_V2,
    procedures: STANDARD_PROCEDURE_OPCODES_V2,
    exclusions: STANDARD_AUTHORING_EXCLUSIONS_V2,
  }),
})

export const STANDARD_AUTHORING_AUTHORITY_V2 =
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2

export const PINNED_STANDARD_AUTHORING_AUTHORITY_SHA256_V2 =
  '0e484c02e0827adeec5916ebcbac6e0ba809c985a08555744832232cb264ea35' as const

export function getStandardAuthoritySha256V2(): string
{
  return STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.authoritySha256
}

export function assertStandardAuthoringAuthorityV2(): void
{
  const evidence = STANDARD_AUTHORING_CATALOG_EVIDENCE_V2
  if (
    evidence.publicCoreOpcodeCount !== 121 ||
    evidence.publicExtensionOpcodeCount !== 20 ||
    evidence.specializedProcedureOpcodeCount !== 5 ||
    evidence.preservationOnlyOpcodeCount !== 33 ||
    byOpcode.size !== rows.length ||
    evidence.authorableDescriptorCount !== 141 ||
    evidence.authoritySha256 !== PINNED_STANDARD_AUTHORING_AUTHORITY_SHA256_V2
  )
    throw new Error(
      'standard authoring authority inventory differs from version 2'
    )
}

export function standardExtensionIdsV2(
  opcodes: Iterable<string>
): readonly string[]
{
  return [
    ...new Set(
      [...opcodes].flatMap((opcode) =>
        STANDARD_PUBLIC_EXTENSION_OPCODES_V2.includes(opcode) ||
        getStandardDescriptorV2(opcode)?.availability === 'builderOnly'
          ? ['pen', 'music', 'videoSensing'].filter((id) =>
              opcode.startsWith(`${id}_`)
            )
          : []
      )
    ),
  ].sort()
}
