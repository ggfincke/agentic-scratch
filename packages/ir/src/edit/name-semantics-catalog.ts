// packages/ir/src/edit/name-semantics-catalog.ts
// pin exact Scratch core name-bearing surfaces understood by the editor

import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  isBlockEntry,
  scratchRecordKeys,
  scratchRecordValue,
  type Block,
  type BlockField,
  type BlockInput,
  type InputPrimitive,
  type Monitor,
  type Mutation,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'

import { compareLexicalTextV1 as compareText } from './lexical-order.js'
import {
  parseStrictEditMutationArray,
  parseStrictEditProcedureMutation,
} from './procedure-mutation.js'

export const PINNED_NAME_SEMANTICS_CORE_OPCODES_V1 = Object.freeze([
  'argument_editor_boolean',
  'argument_editor_string_number',
  'argument_reporter_boolean',
  'argument_reporter_string_number',
  'colour_picker',
  'control_all_at_once',
  'control_clear_counter',
  'control_create_clone_of',
  'control_create_clone_of_menu',
  'control_delete_this_clone',
  'control_for_each',
  'control_forever',
  'control_get_counter',
  'control_if',
  'control_if_else',
  'control_incr_counter',
  'control_repeat',
  'control_repeat_until',
  'control_start_as_clone',
  'control_stop',
  'control_wait',
  'control_wait_until',
  'control_while',
  'data_addtolist',
  'data_changevariableby',
  'data_deletealloflist',
  'data_deleteoflist',
  'data_hidelist',
  'data_hidevariable',
  'data_insertatlist',
  'data_itemnumoflist',
  'data_itemoflist',
  'data_lengthoflist',
  'data_listcontainsitem',
  'data_listcontents',
  'data_listindexall',
  'data_listindexrandom',
  'data_replaceitemoflist',
  'data_setvariableto',
  'data_showlist',
  'data_showvariable',
  'data_variable',
  'event_broadcast',
  'event_broadcast_menu',
  'event_broadcastandwait',
  'event_touchingobjectmenu',
  'event_whenbackdropswitchesto',
  'event_whenbroadcastreceived',
  'event_whenflagclicked',
  'event_whengreaterthan',
  'event_whenkeypressed',
  'event_whenstageclicked',
  'event_whenthisspriteclicked',
  'event_whentouchingobject',
  'looks_backdropnumbername',
  'looks_backdrops',
  'looks_changeeffectby',
  'looks_changesizeby',
  'looks_changestretchby',
  'looks_cleargraphiceffects',
  'looks_costume',
  'looks_costumenumbername',
  'looks_goforwardbackwardlayers',
  'looks_gotofrontback',
  'looks_hide',
  'looks_hideallsprites',
  'looks_nextbackdrop',
  'looks_nextcostume',
  'looks_say',
  'looks_sayforsecs',
  'looks_seteffectto',
  'looks_setsizeto',
  'looks_setstretchto',
  'looks_show',
  'looks_size',
  'looks_switchbackdropto',
  'looks_switchbackdroptoandwait',
  'looks_switchcostumeto',
  'looks_think',
  'looks_thinkforsecs',
  'math_angle',
  'math_integer',
  'math_number',
  'math_positive_number',
  'math_whole_number',
  'matrix',
  'motion_align_scene',
  'motion_changexby',
  'motion_changeyby',
  'motion_direction',
  'motion_glidesecstoxy',
  'motion_glideto',
  'motion_glideto_menu',
  'motion_goto',
  'motion_goto_menu',
  'motion_gotoxy',
  'motion_ifonedgebounce',
  'motion_movesteps',
  'motion_pointindirection',
  'motion_pointtowards',
  'motion_pointtowards_menu',
  'motion_scroll_right',
  'motion_scroll_up',
  'motion_setrotationstyle',
  'motion_setx',
  'motion_sety',
  'motion_turnleft',
  'motion_turnright',
  'motion_xposition',
  'motion_xscroll',
  'motion_yposition',
  'motion_yscroll',
  'note',
  'operator_add',
  'operator_and',
  'operator_contains',
  'operator_divide',
  'operator_equals',
  'operator_gt',
  'operator_join',
  'operator_length',
  'operator_letter_of',
  'operator_lt',
  'operator_mathop',
  'operator_mod',
  'operator_multiply',
  'operator_not',
  'operator_or',
  'operator_random',
  'operator_round',
  'operator_subtract',
  'procedures_call',
  'procedures_declaration',
  'procedures_definition',
  'procedures_prototype',
  'sensing_answer',
  'sensing_askandwait',
  'sensing_coloristouchingcolor',
  'sensing_current',
  'sensing_dayssince2000',
  'sensing_distanceto',
  'sensing_distancetomenu',
  'sensing_keyoptions',
  'sensing_keypressed',
  'sensing_loud',
  'sensing_loudness',
  'sensing_mousedown',
  'sensing_mousex',
  'sensing_mousey',
  'sensing_of',
  'sensing_of_object_menu',
  'sensing_online',
  'sensing_resettimer',
  'sensing_setdragmode',
  'sensing_timer',
  'sensing_touchingcolor',
  'sensing_touchingobject',
  'sensing_touchingobjectmenu',
  'sensing_userid',
  'sensing_username',
  'sound_beats_menu',
  'sound_changeeffectby',
  'sound_changevolumeby',
  'sound_cleareffects',
  'sound_effects_menu',
  'sound_play',
  'sound_playuntildone',
  'sound_seteffectto',
  'sound_setvolumeto',
  'sound_sounds_menu',
  'sound_stopallsounds',
  'sound_volume',
  'text',
] as const)

type PinnedCoreMutationPolicyV1 =
  'none' | 'procedure-call' | 'procedure-prototype' | 'control-stop'

interface PinnedCoreBlockSurfaceDescriptorV1
{
  readonly opcode: string
  readonly fieldNames: readonly string[]
  readonly inputNames: readonly string[]
  readonly mutationPolicy: PinnedCoreMutationPolicyV1
}

const PINNED_NONEMPTY_SURFACE_ROWS = `
argument_editor_boolean|TEXT|
argument_editor_string_number|TEXT|
argument_reporter_boolean|VALUE|
argument_reporter_string_number|VALUE|
colour_picker|COLOUR|
control_all_at_once||SUBSTACK
control_create_clone_of||CLONE_OPTION
control_create_clone_of_menu|CLONE_OPTION|
control_for_each|VARIABLE|SUBSTACK,VALUE
control_forever||SUBSTACK
control_if||CONDITION,SUBSTACK
control_if_else||CONDITION,SUBSTACK,SUBSTACK2
control_repeat||SUBSTACK,TIMES
control_repeat_until||CONDITION,SUBSTACK
control_stop|STOP_OPTION|
control_wait||DURATION
control_wait_until||CONDITION
control_while||CONDITION,SUBSTACK
data_addtolist|LIST|ITEM
data_changevariableby|VARIABLE|VALUE
data_deletealloflist|LIST|
data_deleteoflist|LIST|INDEX
data_hidelist|LIST|
data_hidevariable|VARIABLE|
data_insertatlist|LIST|INDEX,ITEM
data_itemnumoflist|LIST|ITEM
data_itemoflist|LIST|INDEX
data_lengthoflist|LIST|
data_listcontainsitem|LIST|ITEM
data_listcontents|LIST|
data_listindexall|INDEX|
data_listindexrandom|INDEX|
data_replaceitemoflist|LIST|INDEX,ITEM
data_setvariableto|VARIABLE|VALUE
data_showlist|LIST|
data_showvariable|VARIABLE|
data_variable|VARIABLE|
event_broadcast||BROADCAST_INPUT
event_broadcast_menu|BROADCAST_OPTION|
event_broadcastandwait||BROADCAST_INPUT
event_touchingobjectmenu|TOUCHINGOBJECTMENU|
event_whenbackdropswitchesto|BACKDROP|
event_whenbroadcastreceived|BROADCAST_OPTION|
event_whengreaterthan|WHENGREATERTHANMENU|VALUE
event_whenkeypressed|KEY_OPTION|
event_whentouchingobject||TOUCHINGOBJECTMENU
looks_backdropnumbername|NUMBER_NAME|
looks_backdrops|BACKDROP|
looks_changeeffectby|EFFECT|CHANGE
looks_changesizeby||CHANGE
looks_changestretchby||CHANGE
looks_costume|COSTUME|
looks_costumenumbername|NUMBER_NAME|
looks_goforwardbackwardlayers|FORWARD_BACKWARD|NUM
looks_gotofrontback|FRONT_BACK|
looks_say||MESSAGE
looks_sayforsecs||MESSAGE,SECS
looks_seteffectto|EFFECT|VALUE
looks_setsizeto||SIZE
looks_setstretchto||STRETCH
looks_switchbackdropto||BACKDROP
looks_switchbackdroptoandwait||BACKDROP
looks_switchcostumeto||COSTUME
looks_think||MESSAGE
looks_thinkforsecs||MESSAGE,SECS
math_angle|NUM|
math_integer|NUM|
math_number|NUM|
math_positive_number|NUM|
math_whole_number|NUM|
matrix|MATRIX|
motion_align_scene|ALIGNMENT|
motion_changexby||DX
motion_changeyby||DY
motion_glidesecstoxy||SECS,X,Y
motion_glideto||SECS,TO
motion_glideto_menu|TO|
motion_goto||TO
motion_goto_menu|TO|
motion_gotoxy||X,Y
motion_movesteps||STEPS
motion_pointindirection||DIRECTION
motion_pointtowards||TOWARDS
motion_pointtowards_menu|TOWARDS|
motion_scroll_right||DISTANCE
motion_scroll_up||DISTANCE
motion_setrotationstyle|STYLE|
motion_setx||X
motion_sety||Y
motion_turnleft||DEGREES
motion_turnright||DEGREES
note|NOTE|
operator_add||NUM1,NUM2
operator_and||OPERAND1,OPERAND2
operator_contains||STRING1,STRING2
operator_divide||NUM1,NUM2
operator_equals||OPERAND1,OPERAND2
operator_gt||OPERAND1,OPERAND2
operator_join||STRING1,STRING2
operator_length||STRING
operator_letter_of||LETTER,STRING
operator_lt||OPERAND1,OPERAND2
operator_mathop|OPERATOR|NUM
operator_mod||NUM1,NUM2
operator_multiply||NUM1,NUM2
operator_not||OPERAND
operator_or||OPERAND1,OPERAND2
operator_random||FROM,TO
operator_round||NUM
operator_subtract||NUM1,NUM2
procedures_definition||custom_block
sensing_askandwait||QUESTION
sensing_coloristouchingcolor||COLOR,COLOR2
sensing_current|CURRENTMENU|
sensing_distanceto||DISTANCETOMENU
sensing_distancetomenu|DISTANCETOMENU|
sensing_keyoptions|KEY_OPTION|
sensing_keypressed||KEY_OPTION
sensing_of|PROPERTY|OBJECT
sensing_of_object_menu|OBJECT|
sensing_setdragmode|DRAG_MODE|
sensing_touchingcolor||COLOR
sensing_touchingobject||TOUCHINGOBJECTMENU
sensing_touchingobjectmenu|TOUCHINGOBJECTMENU|
sound_beats_menu|BEATS|
sound_changeeffectby|EFFECT|VALUE
sound_changevolumeby||VOLUME
sound_effects_menu|EFFECT|
sound_play||SOUND_MENU
sound_playuntildone||SOUND_MENU
sound_seteffectto|EFFECT|VALUE
sound_setvolumeto||VOLUME
sound_sounds_menu|SOUND_MENU|
text|TEXT|
`.trim()

function splitNames(value: string): readonly string[]
{
  return Object.freeze(value.length === 0 ? [] : value.split(',').sort())
}

const NONEMPTY_SURFACES = new Map(
  PINNED_NONEMPTY_SURFACE_ROWS.split('\n').map((row) =>
  {
    const [opcode, fields = '', inputs = ''] = row.split('|')
    return [
      opcode!,
      { fieldNames: splitNames(fields), inputNames: splitNames(inputs) },
    ] as const
  })
)

function mutationPolicy(opcode: string): PinnedCoreMutationPolicyV1
{
  if (opcode === 'procedures_call') return 'procedure-call'
  if (opcode === 'procedures_prototype') return 'procedure-prototype'
  if (opcode === 'control_stop') return 'control-stop'
  return 'none'
}

// this copied A0 projection is only a conservative name-mutation admission
// envelope; oracle metadata is not runtime, builder, lowering, or ref authority
export const PINNED_CORE_BLOCK_SURFACE_DESCRIPTORS_V1 = Object.freeze(
  PINNED_NAME_SEMANTICS_CORE_OPCODES_V1.map((opcode) =>
  {
    const surface = NONEMPTY_SURFACES.get(opcode)
    return Object.freeze({
      opcode,
      fieldNames: surface?.fieldNames ?? Object.freeze([]),
      inputNames: surface?.inputNames ?? Object.freeze([]),
      mutationPolicy: mutationPolicy(opcode),
    })
  })
)

interface UnknownNameSemanticsOpcodeV1
{
  readonly targetIndex: number
  readonly blockId: string
  readonly opcode: string
}

type UnknownNameSemanticsSurfaceV1 =
  | 'project-own-keys'
  | 'meta-own-keys'
  | 'target-own-keys'
  | 'block-own-keys'
  | 'block-fields'
  | 'block-inputs'
  | 'block-mutation'
  | 'comment-own-keys'
  | 'costume-own-keys'
  | 'sound-own-keys'
  | 'monitor-own-keys'
  | 'monitor-opcode'
  | 'monitor-params'

interface UnknownNameSemanticsSurfaceIssueV1
{
  readonly targetIndex: number | null
  readonly recordId: string
  readonly opcode: string | null
  readonly surface: UnknownNameSemanticsSurfaceV1
  readonly reason: string
}

interface UnknownNameSemanticsEvidenceV1
{
  readonly declaredExtensions: readonly string[]
  readonly unknownOpcodes: readonly UnknownNameSemanticsOpcodeV1[]
  readonly surfaceIssues: readonly UnknownNameSemanticsSurfaceIssueV1[]
}

const PINNED_OPCODE_SET = new Set<string>(PINNED_NAME_SEMANTICS_CORE_OPCODES_V1)
const PINNED_SURFACE_BY_OPCODE: ReadonlyMap<
  string,
  PinnedCoreBlockSurfaceDescriptorV1
> = new Map(
  PINNED_CORE_BLOCK_SURFACE_DESCRIPTORS_V1.map((row) => [row.opcode, row])
)

const PROJECT_KEYS = new Set(['targets', 'monitors', 'extensions', 'meta'])
const META_KEYS = new Set(['semver', 'vm', 'agent', 'origin'])
const TARGET_BASE_KEYS = [
  'isStage',
  'name',
  'variables',
  'lists',
  'broadcasts',
  'blocks',
  'comments',
  'currentCostume',
  'costumes',
  'sounds',
  'volume',
  'layerOrder',
] as const
const STAGE_TARGET_KEYS = new Set([
  ...TARGET_BASE_KEYS,
  'tempo',
  'videoTransparency',
  'videoState',
  'textToSpeechLanguage',
])
const SPRITE_TARGET_KEYS = new Set([
  ...TARGET_BASE_KEYS,
  'visible',
  'x',
  'y',
  'size',
  'direction',
  'draggable',
  'rotationStyle',
])
const BLOCK_KEYS = new Set([
  'opcode',
  'next',
  'parent',
  'inputs',
  'fields',
  'shadow',
  'topLevel',
  'x',
  'y',
  'comment',
  'mutation',
])
const COMMENT_KEYS = new Set([
  'blockId',
  'text',
  'minimized',
  'x',
  'y',
  'width',
  'height',
])
const COSTUME_KEYS = new Set([
  'assetId',
  'name',
  'dataFormat',
  'md5ext',
  'bitmapResolution',
  'rotationCenterX',
  'rotationCenterY',
])
const SOUND_KEYS = new Set([
  'assetId',
  'name',
  'dataFormat',
  'md5ext',
  'format',
  'rate',
  'sampleCount',
])
const MONITOR_KEYS = new Set([
  'id',
  'mode',
  'opcode',
  'params',
  'spriteName',
  'value',
  'width',
  'height',
  'x',
  'y',
  'visible',
  'sliderMin',
  'sliderMax',
  'isDiscrete',
])
const MONITOR_PARAMS_BY_OPCODE = new Map<string, readonly string[]>([
  ['data_variable', Object.freeze(['VARIABLE'])],
  ['data_listcontents', Object.freeze(['LIST'])],
  ['motion_xposition', Object.freeze([])],
  ['motion_yposition', Object.freeze([])],
  ['motion_direction', Object.freeze([])],
  ['looks_size', Object.freeze([])],
  ['looks_costumenumbername', Object.freeze(['NUMBER_NAME'])],
  ['looks_backdropnumbername', Object.freeze(['NUMBER_NAME'])],
  ['sound_volume', Object.freeze([])],
  ['sensing_answer', Object.freeze([])],
  ['sensing_loudness', Object.freeze([])],
  ['sensing_online', Object.freeze([])],
  ['sensing_timer', Object.freeze([])],
  ['sensing_current', Object.freeze(['CURRENTMENU'])],
])
const MUTATION_COMMON_KEYS = ['tagName', 'children'] as const
const PROCEDURE_CALL_MUTATION_KEYS = new Set([
  ...MUTATION_COMMON_KEYS,
  'proccode',
  'argumentids',
  'warp',
])
const PROCEDURE_PROTOTYPE_MUTATION_KEYS = new Set([
  ...MUTATION_COMMON_KEYS,
  'proccode',
  'argumentids',
  'argumentnames',
  'argumentdefaults',
  'warp',
])
const CONTROL_STOP_MUTATION_KEYS = new Set([...MUTATION_COMMON_KEYS, 'hasnext'])
const PROCEDURE_LIMITS = Object.freeze({
  maximumArrayBytes:
    DEFAULT_EDIT_ADMISSION_LIMITS.maxProcedureMutationStringBytes,
  maximumItems:
    DEFAULT_EDIT_ADMISSION_LIMITS.maxProcedureParametersPerProcedure,
})

function sameKeys(
  actual: readonly string[],
  expected: readonly string[]
): boolean
{
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function firstUnexpectedKey(
  value: object | undefined,
  allowed: ReadonlySet<string>
): string | null
{
  return (
    scratchRecordKeys(value)
      .sort(compareText)
      .find((key) => !allowed.has(key)) ?? null
  )
}

function isFiniteNumber(value: unknown): value is number
{
  return typeof value === 'number' && Number.isFinite(value)
}

function isInputPrimitive(value: unknown): value is InputPrimitive
{
  if (!Array.isArray(value)) return false
  const kind = value[0]
  if (kind === 4 || kind === 5 || kind === 6 || kind === 7 || kind === 8)
    return (
      value.length === 2 &&
      (typeof value[1] === 'string' || isFiniteNumber(value[1]))
    )
  if (kind === 9) return value.length === 2 && typeof value[1] === 'string'
  if (kind === 10)
    return (
      value.length === 2 &&
      (typeof value[1] === 'string' || isFiniteNumber(value[1]))
    )
  if (kind === 11)
    return (
      value.length === 3 &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
    )
  if (kind !== 12 && kind !== 13) return false
  return (
    value.length >= 3 &&
    value.length <= 5 &&
    typeof value[1] === 'string' &&
    typeof value[2] === 'string' &&
    value.slice(3).every(isFiniteNumber)
  )
}

function isInputSlot(value: unknown): boolean
{
  return typeof value === 'string' || value === null || isInputPrimitive(value)
}

function isExactInput(value: unknown): value is BlockInput
{
  if (!Array.isArray(value)) return false
  const mode = value[0]
  if (mode === 1)
    return value.length === 2 && value[1] !== null && isInputSlot(value[1])
  if (mode === 2) return value.length === 2 && isInputSlot(value[1])
  if (mode === 3)
    return (
      value.length === 3 &&
      value[1] !== null &&
      value[2] !== null &&
      isInputSlot(value[1]) &&
      isInputSlot(value[2])
    )
  return false
}

function isExactField(name: string, value: unknown): value is BlockField
{
  if (!Array.isArray(value) || (value.length !== 1 && value.length !== 2))
    return false
  const fieldValue = value[0]
  if (
    fieldValue !== null &&
    typeof fieldValue !== 'string' &&
    !isFiniteNumber(fieldValue)
  )
    return false
  const identityBearing =
    name === 'VARIABLE' || name === 'LIST' || name === 'BROADCAST_OPTION'
  if (identityBearing) return value.length === 2 && typeof value[1] === 'string'
  return value.length === 1 || value[1] === null
}

function validBooleanEncoding(value: unknown): boolean
{
  return (
    typeof value === 'boolean' ||
    value === 'true' ||
    value === 'false' ||
    value === 'null'
  )
}

function validOptionalBooleanEncoding(value: unknown): boolean
{
  return value === undefined || validBooleanEncoding(value)
}

function validMutationCommon(mutation: Mutation): boolean
{
  return (
    mutation.tagName === 'mutation' &&
    Array.isArray(mutation.children) &&
    mutation.children.length === 0
  )
}

function procedureMutationArgumentIds(
  block: Block,
  policy: PinnedCoreMutationPolicyV1
): readonly string[] | null
{
  if (policy !== 'procedure-call' && policy !== 'procedure-prototype')
    return null
  const mutation = block.mutation
  if (mutation === undefined) return null
  try
  {
    return policy === 'procedure-prototype'
      ? parseStrictEditProcedureMutation(mutation, PROCEDURE_LIMITS).argumentIds
      : (parseStrictEditMutationArray(
          mutation.argumentids,
          'argumentids',
          PROCEDURE_LIMITS
        ) as readonly string[])
  }
  catch
  {
    return null
  }
}

function mutationIssue(
  block: Block,
  policy: PinnedCoreMutationPolicyV1,
  dynamicProcedureInputs: readonly string[] | null
): string | null
{
  const mutation = block.mutation
  if (policy === 'none')
    return mutation === undefined ? null : 'mutation is not admitted for opcode'
  if (policy === 'control-stop' && mutation === undefined) return null
  if (mutation === undefined) return 'required mutation is absent'
  if (!validMutationCommon(mutation)) return 'mutation envelope is malformed'
  const allowed =
    policy === 'procedure-call'
      ? PROCEDURE_CALL_MUTATION_KEYS
      : policy === 'procedure-prototype'
        ? PROCEDURE_PROTOTYPE_MUTATION_KEYS
        : CONTROL_STOP_MUTATION_KEYS
  const unexpected = firstUnexpectedKey(mutation, allowed)
  if (unexpected !== null) return `mutation key ${unexpected} is unmodeled`
  if (policy === 'control-stop')
    return validBooleanEncoding(mutation.hasnext)
      ? null
      : 'control-stop hasnext is malformed'
  if (
    typeof mutation.proccode !== 'string' ||
    !validOptionalBooleanEncoding(mutation.warp)
  )
    return 'procedure mutation scalar fields are malformed'
  const argumentIds = dynamicProcedureInputs
  if (argumentIds === null) return 'procedure mutation arrays are malformed'
  const inputKeys = scratchRecordKeys(block.inputs).sort(compareText)
  if (!sameKeys(inputKeys, [...argumentIds].sort(compareText)))
    return 'procedure mutation argument IDs do not match input keys'
  return null
}

function blockSurfaceIssue(
  block: Block,
  descriptor: PinnedCoreBlockSurfaceDescriptorV1
): { surface: UnknownNameSemanticsSurfaceV1; reason: string } | null
{
  const unexpectedBlockKey = firstUnexpectedKey(block, BLOCK_KEYS)
  if (unexpectedBlockKey !== null)
    return {
      surface: 'block-own-keys',
      reason: `block key ${unexpectedBlockKey} is unmodeled`,
    }
  const fieldKeys = scratchRecordKeys(block.fields).sort(compareText)
  const allowedFields = new Set(descriptor.fieldNames)
  const unexpectedField = fieldKeys.find((key) => !allowedFields.has(key))
  if (unexpectedField !== undefined)
    return {
      surface: 'block-fields',
      reason: `field key ${unexpectedField} is unmodeled`,
    }
  for (const fieldName of fieldKeys)
  {
    if (!isExactField(fieldName, scratchRecordValue(block.fields, fieldName)))
      return {
        surface: 'block-fields',
        reason: `field ${fieldName} tuple is malformed`,
      }
  }
  const inputKeys = scratchRecordKeys(block.inputs).sort(compareText)
  const dynamicProcedureInputs = procedureMutationArgumentIds(
    block,
    descriptor.mutationPolicy
  )
  const allowedInputs = new Set(dynamicProcedureInputs ?? descriptor.inputNames)
  const unexpectedInput = inputKeys.find((key) => !allowedInputs.has(key))
  if (unexpectedInput !== undefined)
    return {
      surface: 'block-inputs',
      reason: `input key ${unexpectedInput} is unmodeled`,
    }
  for (const inputName of inputKeys)
  {
    if (!isExactInput(scratchRecordValue(block.inputs, inputName)))
      return {
        surface: 'block-inputs',
        reason: `input ${inputName} tuple is malformed`,
      }
  }
  const mutationReason = mutationIssue(
    block,
    descriptor.mutationPolicy,
    dynamicProcedureInputs
  )
  return mutationReason === null
    ? null
    : { surface: 'block-mutation', reason: mutationReason }
}

function appendOwnKeyIssue(
  surfaceIssues: UnknownNameSemanticsSurfaceIssueV1[],
  value: object | undefined,
  allowed: ReadonlySet<string>,
  issue: Omit<UnknownNameSemanticsSurfaceIssueV1, 'reason'>
): void
{
  const unexpected = firstUnexpectedKey(value, allowed)
  if (unexpected === null) return
  surfaceIssues.push({ ...issue, reason: `key ${unexpected} is unmodeled` })
}

function appendTargetNestedIssues(
  surfaceIssues: UnknownNameSemanticsSurfaceIssueV1[],
  target: Target,
  targetIndex: number
): void
{
  for (const commentId of scratchRecordKeys(target.comments).sort(
    compareText
  ))
  {
    appendOwnKeyIssue(
      surfaceIssues,
      scratchRecordValue(target.comments, commentId),
      COMMENT_KEYS,
      {
        targetIndex,
        recordId: commentId,
        opcode: null,
        surface: 'comment-own-keys',
      }
    )
  }
  for (let mediaIndex = 0; mediaIndex < target.costumes.length; mediaIndex++)
  {
    appendOwnKeyIssue(
      surfaceIssues,
      target.costumes[mediaIndex],
      COSTUME_KEYS,
      {
        targetIndex,
        recordId: `costume:${mediaIndex}`,
        opcode: null,
        surface: 'costume-own-keys',
      }
    )
  }
  for (let mediaIndex = 0; mediaIndex < target.sounds.length; mediaIndex++)
  {
    appendOwnKeyIssue(surfaceIssues, target.sounds[mediaIndex], SOUND_KEYS, {
      targetIndex,
      recordId: `sound:${mediaIndex}`,
      opcode: null,
      surface: 'sound-own-keys',
    })
  }
}

function appendMonitorIssues(
  surfaceIssues: UnknownNameSemanticsSurfaceIssueV1[],
  monitor: Monitor,
  monitorIndex: number
): void
{
  appendOwnKeyIssue(surfaceIssues, monitor, MONITOR_KEYS, {
    targetIndex: null,
    recordId: `monitor:${monitorIndex}`,
    opcode: monitor.opcode,
    surface: 'monitor-own-keys',
  })
  const expectedParams = MONITOR_PARAMS_BY_OPCODE.get(monitor.opcode)
  if (expectedParams === undefined)
  {
    surfaceIssues.push({
      targetIndex: null,
      recordId: `monitor:${monitorIndex}`,
      opcode: monitor.opcode,
      surface: 'monitor-opcode',
      reason: 'monitor opcode semantics are unmodeled',
    })
    return
  }
  const params = scratchRecordKeys(monitor.params).sort(compareText)
  if (!sameKeys(params, [...expectedParams].sort(compareText)))
    surfaceIssues.push({
      targetIndex: null,
      recordId: `monitor:${monitorIndex}`,
      opcode: monitor.opcode,
      surface: 'monitor-params',
      reason: 'monitor parameter keys do not match the pinned envelope',
    })
}

export function unknownNameSemanticsEvidenceV1(
  project: ProjectJson
): UnknownNameSemanticsEvidenceV1
{
  const unknownOpcodes: UnknownNameSemanticsOpcodeV1[] = []
  const surfaceIssues: UnknownNameSemanticsSurfaceIssueV1[] = []
  appendOwnKeyIssue(surfaceIssues, project, PROJECT_KEYS, {
    targetIndex: null,
    recordId: 'project',
    opcode: null,
    surface: 'project-own-keys',
  })
  appendOwnKeyIssue(surfaceIssues, project.meta, META_KEYS, {
    targetIndex: null,
    recordId: 'meta',
    opcode: null,
    surface: 'meta-own-keys',
  })
  for (
    let targetIndex = 0;
    targetIndex < project.targets.length;
    targetIndex++
  )
  {
    const target = project.targets[targetIndex]!
    appendOwnKeyIssue(
      surfaceIssues,
      target,
      target.isStage ? STAGE_TARGET_KEYS : SPRITE_TARGET_KEYS,
      {
        targetIndex,
        recordId: `target:${targetIndex}`,
        opcode: null,
        surface: 'target-own-keys',
      }
    )
    appendTargetNestedIssues(surfaceIssues, target, targetIndex)
    for (const blockId of scratchRecordKeys(target.blocks).sort(compareText))
    {
      const block = scratchRecordValue(target.blocks, blockId)
      if (!isBlockEntry(block)) continue
      if (!PINNED_OPCODE_SET.has(block.opcode))
      {
        unknownOpcodes.push({ targetIndex, blockId, opcode: block.opcode })
        continue
      }
      const descriptor = PINNED_SURFACE_BY_OPCODE.get(block.opcode)!
      const issue = blockSurfaceIssue(block, descriptor)
      if (issue !== null)
        surfaceIssues.push({
          targetIndex,
          recordId: blockId,
          opcode: block.opcode,
          ...issue,
        })
    }
  }
  for (
    let monitorIndex = 0;
    monitorIndex < (project.monitors?.length ?? 0);
    monitorIndex++
  )
    appendMonitorIssues(
      surfaceIssues,
      project.monitors![monitorIndex]!,
      monitorIndex
    )
  return Object.freeze({
    declaredExtensions: Object.freeze(
      [...(project.extensions ?? [])].sort(compareText)
    ),
    unknownOpcodes: Object.freeze(unknownOpcodes),
    surfaceIssues: Object.freeze(surfaceIssues),
  })
}
