// packages/static/src/fragility/boundary-model.ts
// pinned scratch vm boundary semantics & deterministic lookups

import { createHash } from 'node:crypto'

export const PINNED_VM_VERSION = '14.1.0'
export const PINNED_SCRATCH_AUDIO_VERSION = '2.0.268'
export const WARP_TIME_MS = 500

export type WarpBreakerGroup =
  | 'unconditional'
  | 'argument-conditional'
  | 'state-conditional'
  | 'receiver-conditional'

export interface WarpBreakerEntry
{
  opcode: string
  group: WarpBreakerGroup
  mechanism: 'promise' | 'yield-tick-or-yield'
  condition: string | null
  citation: string
}

export const WARP_BREAKERS_V1: readonly WarpBreakerEntry[] = [
  {
    opcode: 'looks_sayforsecs',
    group: 'unconditional',
    mechanism: 'promise',
    condition: null,
    citation: 'scratch3_looks.js:335-347 new Promise at :339',
  },
  {
    opcode: 'looks_thinkforsecs',
    group: 'unconditional',
    mechanism: 'promise',
    condition: null,
    citation: 'scratch3_looks.js:355-367 new Promise at :359',
  },
  {
    opcode: 'sensing_askandwait',
    group: 'unconditional',
    mechanism: 'promise',
    condition: null,
    citation: 'scratch3_sensing.js:160-169 new Promise at :162',
  },
  {
    opcode: 'sound_setvolumeto',
    group: 'unconditional',
    mechanism: 'promise',
    condition: null,
    citation:
      'scratch3_sound.js:316-319 -> _updateVolume :326-333 Promise.resolve at :332',
  },
  {
    opcode: 'sound_changevolumeby',
    group: 'unconditional',
    mechanism: 'promise',
    condition: null,
    citation:
      'scratch3_sound.js:321-324 -> _updateVolume :326-333 Promise.resolve at :332',
  },
  {
    opcode: 'sound_seteffectto',
    group: 'argument-conditional',
    mechanism: 'promise',
    condition: 'EFFECT name is pitch or pan (lowercased)',
    citation:
      'scratch3_sound.js:259-261 -> _updateEffect :267-286 guard :272 promise :285',
  },
  {
    opcode: 'sound_changeeffectby',
    group: 'argument-conditional',
    mechanism: 'promise',
    condition: 'EFFECT name is pitch or pan (lowercased)',
    citation:
      'scratch3_sound.js:263-265 -> _updateEffect :267-286 guard :272 promise :285',
  },
  {
    opcode: 'sound_playuntildone',
    group: 'state-conditional',
    mechanism: 'promise',
    condition: 'sound index resolves and sprite.soundBank exists',
    citation:
      'scratch3_sound.js:162-164 -> _playSound :166-181 promise :178 via scratch-audio SoundPlayer.finished',
  },
  {
    opcode: 'event_broadcastandwait',
    group: 'receiver-conditional',
    mechanism: 'yield-tick-or-yield',
    condition:
      'no receivers -> runs straight through; all started receivers waiting -> yieldTick breaks warp; some receiver active -> plain yield busy-spins within budget',
    citation: 'scratch3_event.js:92-134 yieldTick :128 yield :130',
  },
  {
    opcode: 'looks_switchbackdroptoandwait',
    group: 'receiver-conditional',
    mechanism: 'yield-tick-or-yield',
    condition:
      'no receivers -> runs straight through; all started receivers waiting -> yieldTick breaks warp; some receiver active -> plain yield busy-spins within budget',
    citation: 'scratch3_looks.js:478-521 yieldTick :509 yield :511',
  },
]

export const BUDGET_BURNER_OPCODES_V1: ReadonlySet<string> = new Set([
  'control_wait',
  'control_wait_until',
  'motion_glidesecstoxy',
  'motion_glideto',
])

// pinned false-positive traps: these share helpers w/ breakers but discard the promise / never yield
export const NON_BREAKER_SIBLINGS_V1: ReadonlySet<string> = new Set([
  'sound_play',
  'looks_switchbackdropto',
])

export interface PinnedSourceFile
{
  path: string
  sha256: string
}

export const PINNED_VM_SOURCE_FILES_V1: readonly PinnedSourceFile[] = [
  {
    path: '@scratch/scratch-vm/src/engine/sequencer.js',
    sha256: 'ac159bd18ee3836d446fcf62c62ce21f0b0951b90778f31c65458fb6b0700434',
  },
  {
    path: '@scratch/scratch-vm/src/engine/thread.js',
    sha256: 'a6b7d6742705abdbf5bd4672035bafa996624f6cc26b5382e53c56c264521621',
  },
  {
    path: '@scratch/scratch-vm/src/engine/execute.js',
    sha256: '70ca1fbae772408701ed4810effeeb8303e2b151f86db7d23e50b953cb2a12f1',
  },
  {
    path: '@scratch/scratch-vm/src/engine/block-utility.js',
    sha256: '7463f19912f27de83c4d7a84d21a00cc4a8f5600d472c899ed06625010704563',
  },
  {
    path: '@scratch/scratch-vm/src/engine/runtime.js',
    sha256: '2f7eef51ebcc187ef3e63d0a218bdd4dbaec36f2137bcfb543022a30215d5abe',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_control.js',
    sha256: '37882581bde32b1d98ccc11095d5fa1b9453cb7f6012a47bc8cbf6f6581f272b',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_core_example.js',
    sha256: '8359cd8bb039162e586aca8c1915fe6ede1d1089f820a99ae5ad7b7cc9f43cc1',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_data.js',
    sha256: 'a965be129f6727a92fcce707f000018243d3566eace4074aa73d4ca3ed4d2cb2',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_event.js',
    sha256: '035eaf8ef6e21bc516e0baa9f27ceaf25cec34c7f91d7ae2390b9ab162431577',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_looks.js',
    sha256: 'e083b47eded8bedc8f0c157f418611800a9301b5861146f7a1d7853ca4f4f83e',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_motion.js',
    sha256: '70c26b5b98062b7f760bffadd543f7e490e59a6f09b2f598119b59b79480a31e',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_operators.js',
    sha256: 'ed930199c8234962bea5233726b699b808c0e0bbeb5264df9c7ac8ee02d3cec8',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_procedures.js',
    sha256: '7f81a93f91a43ab528141c1da37cf6b64f42922d9c73de108b73d0a7c35df591',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_sensing.js',
    sha256: '442709abe8c14c8cf005b312d9655d09b62e794ca3615c97b5715d82cdc50e21',
  },
  {
    path: '@scratch/scratch-vm/src/blocks/scratch3_sound.js',
    sha256: '8f73f7f1055e3888f5d02c59fe27169116726e13654dd29052e3919fd4830b86',
  },
  {
    path: 'scratch-audio/src/SoundBank.js',
    sha256: 'a7e3204155df8455b41b63c4149ae1be3979122cf2ea7182bdae33df30303a70',
  },
  {
    path: 'scratch-audio/src/SoundPlayer.js',
    sha256: '50f46e7aa9eb5a4d115fb861c6bb91cb1fc02edea15c077f50a1537860a1b5f6',
  },
]

export const BOUNDARY_SEARCH_COMMANDS_V1: readonly string[] = [
  'grep -rn "yieldTick" blocks/ engine/execute.js engine/block-utility.js',
  'grep -rn "new Promise" blocks/',
  'grep -rn "Promise.resolve|Promise.reject|Promise.all" blocks/',
  'grep -rn "return this._" blocks/',
  'grep -rn "async " blocks/',
  'grep -rn "then(" blocks/ engine/execute.js',
]

let boundaryTableHash: string | undefined

export function warpBreakerFor(opcode: string): WarpBreakerEntry | undefined
{
  return WARP_BREAKERS_V1.find((entry) => entry.opcode === opcode)
}

export function isBudgetBurner(opcode: string): boolean
{
  return BUDGET_BURNER_OPCODES_V1.has(opcode)
}

export function boundaryTableSha256(): string
{
  boundaryTableHash ??= createHash('sha256')
    .update(
      JSON.stringify({
        PINNED_VM_VERSION,
        PINNED_SCRATCH_AUDIO_VERSION,
        WARP_TIME_MS,
        breakers: WARP_BREAKERS_V1,
        budgetBurners: [...BUDGET_BURNER_OPCODES_V1].sort(),
        pinnedFiles: PINNED_VM_SOURCE_FILES_V1,
      })
    )
    .digest('hex')
  return boundaryTableHash
}
