// packages/ir/src/edit/standard-authoring/inventory.ts
// classify palette exclusions & specialized nodes without ordinary construction

import { deepFreeze } from '../support/immutable.js'

export const STANDARD_PROCEDURE_OPCODES_V2 = deepFreeze([
  'argument_reporter_boolean',
  'argument_reporter_string_number',
  'procedures_call',
  'procedures_definition',
  'procedures_prototype',
] as const)

export const STANDARD_AUTHORING_EXCLUSIONS_V2 = deepFreeze([
  ...[
    'control_all_at_once',
    'control_clear_counter',
    'control_for_each',
    'control_get_counter',
    'control_incr_counter',
    'control_while',
    'event_whentouchingobject',
    'event_touchingobjectmenu',
    'looks_changestretchby',
    'looks_hideallsprites',
    'looks_setstretchto',
    'motion_align_scene',
    'motion_scroll_right',
    'motion_scroll_up',
    'motion_xscroll',
    'motion_yscroll',
    'sensing_loud',
    'sensing_online',
    'sensing_userid',
    'sound_beats_menu',
    'sound_effects_menu',
  ].map((opcode) => ({
    opcode,
    classification: 'legacy' as const,
    availability: 'preservationOnly' as const,
    reason: 'obsolete or non-public vanilla block',
  })),
  ...[
    'argument_editor_boolean',
    'argument_editor_string_number',
    'procedures_declaration',
  ].map((opcode) => ({
    opcode,
    classification: 'editorOnly' as const,
    availability: 'preservationOnly' as const,
    reason: 'editor-owned procedure authoring widget',
  })),
  ...['data_listindexall', 'data_listindexrandom', 'matrix'].map((opcode) => ({
    opcode,
    classification: 'internalHelper' as const,
    availability: 'preservationOnly' as const,
    reason:
      'unused or unsupported-extension shadow; public list indices use math_integer',
  })),
  ...[
    'pen_changePenHueBy',
    'pen_changePenShadeBy',
    'pen_setPenHueToNumber',
    'pen_setPenShadeToNumber',
    'music_midiPlayDrumForBeats',
    'music_midiSetInstrument',
  ].map((opcode) => ({
    opcode,
    classification: 'hiddenExtension' as const,
    availability: 'preservationOnly' as const,
    reason: 'hidden compatibility extension block',
  })),
])
