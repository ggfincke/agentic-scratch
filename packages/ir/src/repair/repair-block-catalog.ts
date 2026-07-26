// packages/ir/src/repair/repair-block-catalog.ts
// preserve the complete legacy R1-R5 repair block registry as neutral data

import { deepFreeze } from '../edit/support/immutable.js'

export type RepairBlockCategory = 'hat' | 'statement' | 'reporter' | 'boolean'
export type RepairInputShape =
  'value' | 'number' | 'boolean' | 'substack' | 'broadcast'
export type RepairFieldShape = 'plain' | 'variable' | 'list' | 'broadcast'

export interface RepairBlockShape
{
  readonly category: RepairBlockCategory
  readonly inputs?: Readonly<Record<string, RepairInputShape>>
  readonly fields?: Readonly<Record<string, RepairFieldShape>>
}

export const REPAIR_BLOCK_SHAPES = deepFreeze({
  event_whenflagclicked: { category: 'hat' },
  event_whenkeypressed: {
    category: 'hat',
    fields: { KEY_OPTION: 'plain' },
  },
  event_whenthisspriteclicked: { category: 'hat' },
  event_whenbroadcastreceived: {
    category: 'hat',
    fields: { BROADCAST_OPTION: 'broadcast' },
  },
  event_broadcast: {
    category: 'statement',
    inputs: { BROADCAST_INPUT: 'broadcast' },
  },
  data_setvariableto: {
    category: 'statement',
    inputs: { VALUE: 'value' },
    fields: { VARIABLE: 'variable' },
  },
  data_changevariableby: {
    category: 'statement',
    inputs: { VALUE: 'number' },
    fields: { VARIABLE: 'variable' },
  },
  control_wait: {
    category: 'statement',
    inputs: { DURATION: 'number' },
  },
  control_forever: {
    category: 'statement',
    inputs: { SUBSTACK: 'substack' },
  },
  control_if: {
    category: 'statement',
    inputs: { CONDITION: 'boolean', SUBSTACK: 'substack' },
  },
  motion_movesteps: {
    category: 'statement',
    inputs: { STEPS: 'number' },
  },
  motion_changexby: {
    category: 'statement',
    inputs: { DX: 'number' },
  },
  motion_changeyby: {
    category: 'statement',
    inputs: { DY: 'number' },
  },
  motion_gotoxy: {
    category: 'statement',
    inputs: { X: 'number', Y: 'number' },
  },
  motion_glidesecstoxy: {
    category: 'statement',
    inputs: { SECS: 'number', X: 'number', Y: 'number' },
  },
  motion_ifonedgebounce: { category: 'statement' },
  looks_say: {
    category: 'statement',
    inputs: { MESSAGE: 'value' },
  },
  sensing_askandwait: {
    category: 'statement',
    inputs: { QUESTION: 'value' },
  },
  motion_yposition: { category: 'reporter' },
  sensing_keypressed: {
    category: 'boolean',
    inputs: { KEY_OPTION: 'value' },
  },
  sensing_touchingobject: {
    category: 'boolean',
    inputs: { TOUCHINGOBJECTMENU: 'value' },
  },
  sensing_touchingobjectmenu: {
    category: 'reporter',
    fields: { TOUCHINGOBJECTMENU: 'plain' },
  },
  sensing_current: {
    category: 'reporter',
    fields: { CURRENTMENU: 'plain' },
  },
  operator_add: {
    category: 'reporter',
    inputs: { NUM1: 'number', NUM2: 'number' },
  },
  operator_subtract: {
    category: 'reporter',
    inputs: { NUM1: 'number', NUM2: 'number' },
  },
  operator_multiply: {
    category: 'reporter',
    inputs: { NUM1: 'number', NUM2: 'number' },
  },
  operator_divide: {
    category: 'reporter',
    inputs: { NUM1: 'number', NUM2: 'number' },
  },
  operator_mod: {
    category: 'reporter',
    inputs: { NUM1: 'number', NUM2: 'number' },
  },
  operator_random: {
    category: 'reporter',
    inputs: { FROM: 'number', TO: 'number' },
  },
  operator_gt: {
    category: 'boolean',
    inputs: { OPERAND1: 'value', OPERAND2: 'value' },
  },
  operator_lt: {
    category: 'boolean',
    inputs: { OPERAND1: 'value', OPERAND2: 'value' },
  },
  operator_equals: {
    category: 'boolean',
    inputs: { OPERAND1: 'value', OPERAND2: 'value' },
  },
  operator_and: {
    category: 'boolean',
    inputs: { OPERAND1: 'boolean', OPERAND2: 'boolean' },
  },
  operator_or: {
    category: 'boolean',
    inputs: { OPERAND1: 'boolean', OPERAND2: 'boolean' },
  },
  operator_not: {
    category: 'boolean',
    inputs: { OPERAND: 'boolean' },
  },
} as const satisfies Readonly<Record<string, RepairBlockShape>>)

export function repairBlockShape(opcode: string): RepairBlockShape | undefined
{
  return REPAIR_BLOCK_SHAPES[opcode as keyof typeof REPAIR_BLOCK_SHAPES]
}
