// packages/sb3/src/json/project-json.ts
// faithful Scratch 3 project.json types — no field dropped or coerced on round-trip
// authority: scratch-parser sb3 schema + scratch-vm src/serialization/sb3.js

// a scalar variable/list/input value; "5" (string) & 5 (number) are distinct & must not coerce
export type ScalarVal = string | number | boolean

// id -> [name, value]; cloud vars append the literal `true` as a 3rd element
export type VariableEntry = [string, ScalarVal] | [string, ScalarVal, true]

// id -> [name, items]
export type ListEntry = [string, ScalarVal[]]

// input primitive arrays (the 2nd/3rd slot of an input, or a bare top-level block)
// 4..8 = number kinds, 9 = colour, 10 = text
type NumPrimitive = [4 | 5 | 6 | 7 | 8, string | number]
type ColorPrimitive = [9, string]
type TextPrimitive = [10, string | number]
export type BroadcastPrimitive = [11, string, string]
// variable/list: [type, name, id] as an input; [type, name, id, x, y] as a top-level getter
export type VarPrimitive = [12, string, string, ...number[]]
type ListPrimitive = [13, string, string, ...number[]]
export type InputPrimitive =
  | NumPrimitive
  | ColorPrimitive
  | TextPrimitive
  | BroadcastPrimitive
  | VarPrimitive
  | ListPrimitive

// an input slot is a block id (string), null (no-shadow only), or an inlined primitive
export type InputSlot = string | null | InputPrimitive
// [shadowType, ...slots]; shadowType 1=unobscured shadow, 2=no shadow, 3=obscured shadow
export type BlockInput = [1 | 2 | 3, ...InputSlot[]]

// fields: [value] or [value, id]; id present only for VARIABLE/LIST/BROADCAST_OPTION
export type BlockField =
  [string | number | null] | [string | number | null, string | null]

// custom-block / control_stop mutation — opaque pass-through; never coerce or re-encode.
// argument* are JSON-ENCODED STRINGS; warp/hasnext are bool OR the strings "true"/"false"/"null"
export interface Mutation
{
  tagName: string
  children: unknown[]
  proccode?: string
  argumentids?: string
  argumentnames?: string
  argumentdefaults?: string
  warp?: boolean | string
  hasnext?: boolean | string
}

// a normal (object-form) block in the blocks map
export interface Block
{
  opcode: string
  next?: string | null
  parent?: string | null
  inputs?: Record<string, BlockInput>
  fields?: Record<string, BlockField>
  shadow?: boolean
  topLevel?: boolean
  // x,y serialized only when topLevel && !shadow (rounded ints)
  x?: number
  y?: number
  comment?: string
  mutation?: Mutation
}

// top-level variable/list reporters persist as bare arrays in the blocks map
export type TopLevelPrimitive = VarPrimitive | ListPrimitive
export type BlockEntry = Block | TopLevelPrimitive

export interface Costume
{
  assetId: string
  name: string
  dataFormat: string
  md5ext?: string
  bitmapResolution?: number
  rotationCenterX?: number
  rotationCenterY?: number
}

export interface Sound
{
  assetId: string
  name: string
  dataFormat: string
  md5ext?: string
  // scratch-vm always writes `format` (often "" or "adpcm"); NOT in schema, easy to drop
  format?: string
  rate?: number
  sampleCount?: number
}

export interface Comment
{
  blockId?: string | null
  text: string
  minimized?: boolean
  x?: number | null
  y?: number | null
  width?: number
  height?: number
}

// monitor value is scalar for value monitors, an array for list monitors
type MonitorValue = ScalarVal | ScalarVal[] | null
export interface Monitor
{
  id: string
  mode: string
  opcode: string
  params: Record<string, ScalarVal>
  spriteName: string | null
  value: MonitorValue
  width?: number
  height?: number
  x?: number | null
  y?: number | null
  visible?: boolean
  // present iff mode !== 'list'
  sliderMin?: number
  sliderMax?: number
  isDiscrete?: boolean
}

interface TargetBase
{
  isStage: boolean
  name: string
  variables: Record<string, VariableEntry>
  lists?: Record<string, ListEntry>
  broadcasts?: Record<string, string>
  blocks: Record<string, BlockEntry>
  comments?: Record<string, Comment>
  currentCostume?: number
  costumes: Costume[]
  sounds: Sound[]
  volume?: number
  layerOrder?: number
}

export interface StageTarget extends TargetBase
{
  isStage: true
  tempo?: number
  videoTransparency?: number
  videoState?: string
  textToSpeechLanguage?: string | null
}

export interface SpriteTarget extends TargetBase
{
  isStage: false
  visible?: boolean
  x?: number
  y?: number
  size?: number
  direction?: number
  draggable?: boolean
  rotationStyle?: string
}

export type Target = StageTarget | SpriteTarget

interface Meta
{
  semver: string
  vm?: string
  agent?: string
  origin?: string
}

// root project.json; scratch-vm emits keys in the order targets, monitors, extensions, meta
export interface ProjectJson
{
  targets: Target[]
  monitors?: Monitor[]
  extensions?: string[]
  meta: Meta
}
