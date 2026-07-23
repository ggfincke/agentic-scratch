// packages/ir/src/edit/catalog.ts
// hand-reviewed block, media, name, procedure, & planning catalogs

import { OPERATION_REVIEW_ROWS, type OperationKind } from './contract-data.js'
import { deepFreeze } from './immutable.js'

export type VanillaBlockShape =
  'stack' | 'reporter' | 'boolean' | 'hat' | 'cap' | 'cShape' | 'menuReporter'

interface DescriptorContext
{
  allowedPlacements: readonly (
    | 'eventScriptHat'
    | 'topLevelStatement'
    | 'statementSequence'
    | 'topLevelExpression'
    | 'reporterInput'
    | 'booleanInput'
    | 'menuShadow'
  )[]
  ownerTargets: readonly ('stage' | 'sprite')[]
  acceptsSuccessor: boolean
  mustTerminateSequence: boolean
}

interface DescriptorField
{
  name: string
  semanticDomain: string
  serialization: string
  canonicalDefault: string
  referenceDomain: string | null
  requiredEntitySubtype: string | null
}

export interface DescriptorInput
{
  name: string
  connection:
    'stringOrNumber' | 'number' | 'boolean' | 'substack' | 'entityMenu'
  semanticDomain: string
  canonicalShadow:
    | null
    | {
        kind: 'primitive'
        opcode: 'math_number' | 'math_whole_number' | 'text'
        sb3PrimitiveTag: 4 | 6 | 10
        value: string
      }
    | {
        kind: 'entityMenu'
        opcode: string
        field: string
        sb3PrimitiveTag: 11 | null
        fallbackDisplayValue: string
      }
  referenceDomain: string | null
  requiredEntitySubtype: string | null
}

export interface VanillaCoreDescriptor
{
  opcode: string
  category:
    'motion' | 'looks' | 'event' | 'control' | 'sensing' | 'operators' | 'data'
  shape: VanillaBlockShape
  context: DescriptorContext
  requiredFields: readonly DescriptorField[]
  optionalFields: readonly DescriptorField[]
  requiredInputs: readonly DescriptorInput[]
  optionalInputs: readonly DescriptorInput[]
  referenceDomains: readonly string[]
  orderDomains: readonly string[]
  safeBuilderKind: 'ordinaryBlock' | 'referenceMenuShadow'
  readSetDerivation: string
  writeSetDerivation: string
  deleteSetDerivation: string
  resultSlots: {
    fixed: readonly string[]
    dynamic: readonly string[]
    conditional: readonly string[]
  }
  availability: 'supported' | 'builderOnly' | 'preservationOnly'
  preservationOnlyReason: string | null
  evidence: readonly string[]
}

const STAGE_AND_SPRITE = ['stage', 'sprite'] as const
const SPRITE_ONLY = ['sprite'] as const
const STATEMENT_PLACEMENTS = ['topLevelStatement', 'statementSequence'] as const
const EXPRESSION_PLACEMENTS = ['topLevelExpression', 'reporterInput'] as const
const BOOLEAN_PLACEMENTS = ['topLevelExpression', 'booleanInput'] as const

const BLOCK_RESULT_SLOTS = {
  fixed: ['rootBlock'],
  dynamic: ['blockAlias'],
  conditional: [],
} as const

const NO_RESULT_SLOTS = {
  fixed: [],
  dynamic: [],
  conditional: [],
} as const

function context(
  allowedPlacements: DescriptorContext['allowedPlacements'],
  ownerTargets: DescriptorContext['ownerTargets'],
  acceptsSuccessor: boolean,
  mustTerminateSequence = false
): DescriptorContext
{
  return {
    allowedPlacements,
    ownerTargets,
    acceptsSuccessor,
    mustTerminateSequence,
  }
}

function primitiveInput(
  name: string,
  connection: 'stringOrNumber' | 'number',
  opcode: 'math_number' | 'math_whole_number' | 'text',
  sb3PrimitiveTag: 4 | 6 | 10,
  value: string
): DescriptorInput
{
  return {
    name,
    connection,
    semanticDomain:
      connection === 'number' ? 'ScratchNumberV1' : 'ScratchScalarV1',
    canonicalShadow: {
      kind: 'primitive',
      opcode,
      sb3PrimitiveTag,
      value,
    },
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

function entityMenuInput(
  name: string,
  opcode: string,
  field: string,
  semanticDomain: string,
  requiredEntitySubtype: string,
  referenceDomain: string,
  fallbackDisplayValue: string,
  sb3PrimitiveTag: 11 | null = null
): DescriptorInput
{
  return {
    name,
    connection: 'entityMenu',
    semanticDomain,
    canonicalShadow: {
      kind: 'entityMenu',
      opcode,
      field,
      sb3PrimitiveTag,
      fallbackDisplayValue,
    },
    referenceDomain,
    requiredEntitySubtype,
  }
}

const BLOCK_EVIDENCE = {
  motion: [
    'scratch-blocks/src/blocks/motion.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_motion.js',
  ],
  looks: [
    'scratch-blocks/src/blocks/looks.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_looks.js',
  ],
  event: [
    'scratch-blocks/src/blocks/event.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_event.js',
    '@scratch/scratch-vm/src/engine/runtime.js',
  ],
  control: [
    'scratch-blocks/src/blocks/control.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_control.js',
  ],
  sensing: [
    'scratch-blocks/src/blocks/sensing.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_sensing.js',
  ],
  operators: [
    'scratch-blocks/src/blocks/operators.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_operators.js',
  ],
  data: [
    'scratch-blocks/src/blocks/data.ts',
    'scratch-blocks/src/data_category.ts',
    '@scratch/scratch-vm/src/blocks/scratch3_data.js',
  ],
} as const

export const VANILLA_CORE_DESCRIPTORS = [
  {
    opcode: 'event_whenflagclicked',
    category: 'event',
    shape: 'hat',
    context: context(['eventScriptHat'], STAGE_AND_SPRITE, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'owning target and event-script root role',
    writeSetDerivation: 'new event-hat block and optional successor edge',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.event,
  },
  {
    opcode: 'event_whenbroadcastreceived',
    category: 'event',
    shape: 'hat',
    context: context(['eventScriptHat'], STAGE_AND_SPRITE, true),
    requiredFields: [
      {
        name: 'BROADCAST_OPTION',
        semanticDomain: "EntityRefV1<'declaration'>",
        serialization: 'field tuple [exact name, exact declaration id]',
        canonicalDefault: 'explicit broadcast entity; UI fallback message1',
        referenceDomain: 'broadcast',
        requiredEntitySubtype: 'broadcast',
      },
    ],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [],
    referenceDomains: ['broadcast'],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation:
      'broadcast declaration plus lower-case lookup and upper-case hat collision sets',
    writeSetDerivation:
      'new event-hat block and exact BROADCAST_OPTION field tuple',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.event,
  },
  {
    opcode: 'event_broadcast',
    category: 'event',
    shape: 'stack',
    context: context(STATEMENT_PLACEMENTS, STAGE_AND_SPRITE, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [
      entityMenuInput(
        'BROADCAST_INPUT',
        'event_broadcast_menu',
        'BROADCAST_OPTION',
        "EntityRefV1<'declaration'>",
        'broadcast',
        'broadcast',
        'message1',
        11
      ),
    ],
    optionalInputs: [],
    referenceDomains: ['broadcast'],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation:
      'broadcast declaration plus lower-case lookup and upper-case receiver collision sets',
    writeSetDerivation:
      'new statement block, BROADCAST_INPUT primitive, and adjacency edges',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.event,
  },
  {
    opcode: 'event_broadcast_menu',
    category: 'event',
    shape: 'menuReporter',
    context: context(['menuShadow'], STAGE_AND_SPRITE, false),
    requiredFields: [
      {
        name: 'BROADCAST_OPTION',
        semanticDomain: "EntityRefV1<'declaration'>",
        serialization:
          'compressed input primitive [11, exact name, exact declaration id]',
        canonicalDefault: 'explicit broadcast entity; UI fallback message1',
        referenceDomain: 'broadcast',
        requiredEntitySubtype: 'broadcast',
      },
    ],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [],
    referenceDomains: ['broadcast'],
    orderDomains: [],
    safeBuilderKind: 'referenceMenuShadow',
    readSetDerivation: 'exact project broadcast declaration',
    writeSetDerivation:
      'builder-owned compressed menu primitive inside its parent input',
    deleteSetDerivation: 'owned by and deleted with the parent input value',
    resultSlots: NO_RESULT_SLOTS,
    availability: 'builderOnly',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.event,
  },
  {
    opcode: 'motion_gotoxy',
    category: 'motion',
    shape: 'stack',
    context: context(STATEMENT_PLACEMENTS, SPRITE_ONLY, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [
      primitiveInput('X', 'number', 'math_number', 4, '0'),
      primitiveInput('Y', 'number', 'math_number', 4, '0'),
    ],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'owning sprite and exact X/Y input slots',
    writeSetDerivation:
      'new motion statement, canonical X/Y shadows, and adjacency edges',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.motion,
  },
  {
    opcode: 'motion_xposition',
    category: 'motion',
    shape: 'reporter',
    context: context(EXPRESSION_PLACEMENTS, SPRITE_ONLY, false),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'owning sprite x property',
    writeSetDerivation:
      'new number reporter and one owner input edge if nested',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.motion,
  },
  {
    opcode: 'looks_show',
    category: 'looks',
    shape: 'stack',
    context: context(STATEMENT_PLACEMENTS, SPRITE_ONLY, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'owning sprite visibility capability',
    writeSetDerivation: 'new looks statement and adjacency edges',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.looks,
  },
  {
    opcode: 'looks_say',
    category: 'looks',
    shape: 'stack',
    context: context(STATEMENT_PLACEMENTS, SPRITE_ONLY, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [
      primitiveInput('MESSAGE', 'stringOrNumber', 'text', 10, 'Hello!'),
    ],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'owning sprite and exact MESSAGE input slot',
    writeSetDerivation:
      'new looks statement, canonical text shadow, and adjacency edges',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.looks,
  },
  {
    opcode: 'data_setvariableto',
    category: 'data',
    shape: 'stack',
    context: context(STATEMENT_PLACEMENTS, STAGE_AND_SPRITE, true),
    requiredFields: [
      {
        name: 'VARIABLE',
        semanticDomain: "EntityRefV1<'declaration'>",
        serialization: 'field tuple [exact name, exact declaration id]',
        canonicalDefault: 'explicit visible variable entity required',
        referenceDomain: 'variable',
        requiredEntitySubtype: 'variable',
      },
    ],
    optionalFields: [],
    requiredInputs: [
      primitiveInput('VALUE', 'stringOrNumber', 'text', 10, '0'),
    ],
    optionalInputs: [],
    referenceDomains: ['variable'],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation:
      'exact local-or-stage variable declaration and current VALUE slot',
    writeSetDerivation:
      'new statement, exact VARIABLE tuple, VALUE shadow, and adjacency edges',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.data,
  },
  {
    opcode: 'control_if',
    category: 'control',
    shape: 'cShape',
    context: context(STATEMENT_PLACEMENTS, STAGE_AND_SPRITE, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [
      {
        name: 'CONDITION',
        connection: 'boolean',
        semanticDomain: 'SemanticExpressionBlockTreeV1<boolean>',
        canonicalShadow: null,
        referenceDomain: null,
        requiredEntitySubtype: null,
      },
      {
        name: 'SUBSTACK',
        connection: 'substack',
        semanticDomain: 'SemanticStatementSequenceV1',
        canonicalShadow: null,
        referenceDomain: null,
        requiredEntitySubtype: null,
      },
    ],
    referenceDomains: [],
    orderDomains: ['orderedSubstack'],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation:
      'condition owner edge, ordered SUBSTACK closure, and outer adjacency',
    writeSetDerivation:
      'new C-block plus optional condition/substack ownership and adjacency edges',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.control,
  },
  {
    opcode: 'control_repeat',
    category: 'control',
    shape: 'cShape',
    context: context(STATEMENT_PLACEMENTS, STAGE_AND_SPRITE, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [
      primitiveInput('TIMES', 'number', 'math_whole_number', 6, '10'),
    ],
    optionalInputs: [
      {
        name: 'SUBSTACK',
        connection: 'substack',
        semanticDomain: 'SemanticStatementSequenceV1',
        canonicalShadow: null,
        referenceDomain: null,
        requiredEntitySubtype: null,
      },
    ],
    referenceDomains: [],
    orderDomains: ['orderedSubstack'],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation:
      'TIMES value, ordered SUBSTACK closure, and outer adjacency',
    writeSetDerivation:
      'new C-block, TIMES shadow, optional substack ownership, and adjacency',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.control,
  },
  {
    opcode: 'control_delete_this_clone',
    category: 'control',
    shape: 'cap',
    context: context(STATEMENT_PLACEMENTS, SPRITE_ONLY, false, true),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'owning sprite clone context and sequence tail role',
    writeSetDerivation: 'new terminal control block and predecessor edge only',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.control,
  },
  {
    opcode: 'operator_equals',
    category: 'operators',
    shape: 'boolean',
    context: context(BOOLEAN_PLACEMENTS, STAGE_AND_SPRITE, false),
    requiredFields: [],
    optionalFields: [],
    requiredInputs: [
      primitiveInput('OPERAND1', 'stringOrNumber', 'text', 10, ''),
      primitiveInput('OPERAND2', 'stringOrNumber', 'text', 10, '50'),
    ],
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind: 'ordinaryBlock',
    readSetDerivation: 'exact ordered OPERAND1 and OPERAND2 input closures',
    writeSetDerivation:
      'new Boolean reporter and one owner input edge if nested',
    deleteSetDerivation: 'none during construction',
    resultSlots: BLOCK_RESULT_SLOTS,
    availability: 'supported',
    preservationOnlyReason: null,
    evidence: BLOCK_EVIDENCE.operators,
  },
] as const satisfies readonly VanillaCoreDescriptor[]

interface PngFeaturePolicy
{
  colorType: 0 | 2 | 3 | 4 | 6
  preservationBitDepths: readonly number[]
  authoringBitDepths: readonly number[]
  palette: 'forbidden' | 'optional' | 'required'
}

export const PNG_FEATURE_POLICIES = [
  {
    colorType: 0,
    preservationBitDepths: [1, 2, 4, 8, 16],
    authoringBitDepths: [8],
    palette: 'forbidden',
  },
  {
    colorType: 2,
    preservationBitDepths: [8, 16],
    authoringBitDepths: [8],
    palette: 'optional',
  },
  {
    colorType: 3,
    preservationBitDepths: [1, 2, 4, 8],
    authoringBitDepths: [8],
    palette: 'required',
  },
  {
    colorType: 4,
    preservationBitDepths: [8, 16],
    authoringBitDepths: [8],
    palette: 'forbidden',
  },
  {
    colorType: 6,
    preservationBitDepths: [8, 16],
    authoringBitDepths: [8],
    palette: 'optional',
  },
] as const satisfies readonly PngFeaturePolicy[]

const MAXIMUM_MEDIA_ASSET_BYTES = 25 * 1024 * 1024
const MAXIMUM_PNG_WIDTH = 4096
const MAXIMUM_PNG_HEIGHT = 4096
const MAXIMUM_PNG_PIXELS = 16_777_216
const MAXIMUM_PNG_INFLATED_SAMPLE_BYTES = 64 * 1024 * 1024

export const MEDIA_POLICY_TABLES = {
  preservationClassification: {
    png: {
      outcome: 'metadataClassified',
      signature: '89504e470d0a1a0a',
      maximumAssetBytes: MAXIMUM_MEDIA_ASSET_BYTES,
      maximumWidth: MAXIMUM_PNG_WIDTH,
      maximumHeight: MAXIMUM_PNG_HEIGHT,
      maximumCanvasPixels: MAXIMUM_PNG_PIXELS,
      maximumInflatedSampleBytes: MAXIMUM_PNG_INFLATED_SAMPLE_BYTES,
      filterByteAllowance:
        'exactly one additional filter byte per encoded static or Adam7 pass row',
      compressionMethod: 0,
      filterMethod: 0,
      allowedInterlaceMethods: [0, 1],
      recognizedApngChunks: ['acTL', 'fcTL', 'fdAT'],
      apng: {
        maximumFrames: 4096,
        maximumCumulativeFramePixels: 134_217_728,
        maximumCumulativeInflatedSampleBytes: 512 * 1024 * 1024,
        frameRectangleRule:
          'positive width/height, nonnegative offsets, and rectangle wholly inside IHDR canvas',
        sequenceRule:
          'one acTL before IDAT; fcTL/fdAT sequence numbers are consecutive from zero; exactly one fcTL per declared frame; fdAT is forbidden before its fcTL',
        defaultImageRule:
          'fcTL before IDAT includes the default image as frame zero; fcTL after IDAT leaves the default image outside the animation',
        frameCountRule:
          'acTL num_frames is 1..4096 and equals the exact fcTL count',
        operationDomains: {
          disposeOp: [0, 1, 2],
          blendOp: [0, 1],
        },
      },
      requiredChecks: [
        'bounded chunk framing and lengths',
        'CRC for every chunk',
        'exactly one IHDR first and one IEND last',
        'IHDR compression and filter methods are both zero',
        'legal color-type and bit-depth pair',
        'PLTE length is a nonzero multiple of three with at most 256 entries and no more entries than the indexed bit depth permits',
        'PLTE presence, absence, and ordering match the color-type policy',
        'consecutive IDAT ordering',
        'positive bounded width, height, and pixel product',
        'exact static or Adam7 inflated scanline lengths',
        'filter byte in the inclusive range 0..4 for every scanline',
        'exact APNG chunk ordering, sequence, frame rectangle, operation, count, cumulative pixel, and cumulative inflate rules',
      ],
      unknownAncillaryChunk: 'preserve after CRC and bounded-length checks',
      unknownCriticalChunk: 'source-not-editable',
      malformedOrUnbounded: 'source-not-editable',
      wellFormedButNonauthoring:
        'preserve exact bytes, retain feature flags, and charge every reference',
    },
    wav: {
      outcome: 'opaquePreserved',
      trustedMetadata: false,
      wellFormedButNonauthoring:
        'preserve exact bytes and source metadata but deny add, replace, and sourceMedia reuse',
      malformedExistingPayload:
        'retain only as already-admitted opaque archive data; trust no parsed metadata',
      authoringTransition:
        'sourceMedia reuse must independently pass the complete PCM-WAV authoring parser below',
    },
  },
  authoringEligibility: {
    costume: {
      mediaType: 'png',
      interlaceMethod: 0,
      apngAllowed: false,
      unknownCriticalChunksAllowed: false,
      compressionMethod: 0,
      filterMethod: 0,
      maximumAssetBytes: MAXIMUM_MEDIA_ASSET_BYTES,
      maximumWidth: MAXIMUM_PNG_WIDTH,
      maximumHeight: MAXIMUM_PNG_HEIGHT,
      maximumPixels: MAXIMUM_PNG_PIXELS,
      maximumInflatedSampleBytes: MAXIMUM_PNG_INFLATED_SAMPLE_BYTES,
      filterByteAllowance:
        'exactly one additional filter byte per encoded non-interlaced row',
      chunkRules: [
        'IHDR is first and unique; IEND is last and unique',
        'PLTE obeys the exact color-type policy and entry bounds',
        'all IDAT chunks are consecutive',
        'every chunk CRC and bounded length is valid',
        'unknown critical and APNG chunks reject; bounded ancillary chunks are preserved without parser-side decompression',
      ],
      emittedMetadata: {
        dataFormat: 'png',
        bitmapResolution: 1,
      },
      semanticPlacement:
        'derivedImageCenter or explicitCenter is supplied separately and is never parsed from PNG bytes',
    },
    sound: {
      mediaType: 'riff-wave-pcm-integer',
      audioFormat: 1,
      riffChunkId: 'RIFF',
      waveFormType: 'WAVE',
      allowedChunkOrder: ['fmt ', 'data'],
      fmtChunkBytes: 16,
      extraChunksAllowed: false,
      channels: [1, 2],
      bitsPerSample: [8, 16],
      minimumSampleRate: 8000,
      maximumSampleRate: 96000,
      usableFmtChunkCount: 1,
      usableDataChunkCount: 1,
      maximumAssetBytes: MAXIMUM_MEDIA_ASSET_BYTES,
      minimumSampleFrames: 1,
      maximumSampleFrames:
        'floor(dataChunkBytes / blockAlign), bounded by the 25 MiB whole-file cap',
      requiredIntegrity: [
        'RIFF declared size equals file byte length minus eight with no trailing bytes',
        'fmt precedes data and no other or duplicate chunk is present',
        'fmt payload is exactly 16 bytes and audioFormat is exactly one',
        'every odd chunk length has exactly one in-file padding byte excluded from its declared length',
        'blockAlign equals channels times bytes-per-sample',
        'byteRate equals sampleRate times blockAlign',
        'nonempty data byte length is divisible by blockAlign',
      ],
      emittedMetadata: {
        dataFormat: 'wav',
        format: '',
        rate: 'header sampleRate',
        sampleCount: 'dataBytes / blockAlign',
      },
    },
  },
  reuseRule:
    'sourceMedia reuse independently passes the narrow authoring table',
  archiveRule:
    'remove and replace never garbage-collect formerly referenced payload bytes',
} as const

interface NameResolutionDomain
{
  domain: string
  scope: string
  directLookup: string
  lookupPrecedence: readonly string[]
  collisionKeys: readonly string[]
  reservedTokens: readonly string[]
  orderSensitive: boolean
  addRenameRule: string
  evidence: readonly string[]
}

const SENSING_PROPERTY_TOKENS = [
  'background #',
  'backdrop #',
  'backdrop name',
  'volume',
  'x position',
  'y position',
  'direction',
  'costume #',
  'costume name',
  'size',
] as const

export const NAME_RESOLUTION_DOMAINS = [
  {
    domain: 'spriteIdentity',
    scope: 'original non-stage runtime targets in target-array order',
    directLookup: 'first exact sprite display-name match',
    lookupPrecedence: ['first exact non-stage original sprite name'],
    collisionKeys: ['exact name'],
    reservedTokens: ['_mouse_', '_stage_', '_edge_', '_myself_', '_random_'],
    orderSensitive: true,
    addRenameRule:
      'require exact uniqueness, reject all five VM-reserved names, and prove zero prospective selector activation',
    evidence: [
      '@scratch/scratch-vm/src/virtual-machine.js',
      '@scratch/scratch-vm/src/engine/runtime.js',
    ],
  },
  {
    domain: 'motionTarget',
    scope: 'motion_goto and motion_pointtowards on the executing sprite',
    directLookup: 'special selector before first exact original-sprite name',
    lookupPrecedence: [
      'exact _mouse_ selector',
      'exact _random_ selector',
      'first exact original-sprite name',
    ],
    collisionKeys: ['exact sprite name', 'exact special selector token'],
    reservedTokens: ['_mouse_', '_random_'],
    orderSensitive: true,
    addRenameRule:
      'spriteIdentity naming rules apply and prospective motion selectors must remain unactivated',
    evidence: ['@scratch/scratch-vm/src/blocks/scratch3_motion.js'],
  },
  {
    domain: 'cloneTarget',
    scope: 'control_create_clone_of on the executing sprite',
    directLookup: 'special selector before first exact original-sprite name',
    lookupPrecedence: [
      'exact _myself_ selector',
      'first exact original-sprite name',
    ],
    collisionKeys: ['exact sprite name', 'exact special selector token'],
    reservedTokens: ['_myself_'],
    orderSensitive: true,
    addRenameRule:
      'spriteIdentity naming rules apply and prospective clone selectors must remain unactivated',
    evidence: ['@scratch/scratch-vm/src/blocks/scratch3_control.js'],
  },
  {
    domain: 'touchingObjectTarget',
    scope: 'sensing_touchingobject on the executing sprite',
    directLookup: 'special selector before exact sprite-name touching query',
    lookupPrecedence: [
      'exact _mouse_ selector',
      'exact _edge_ selector',
      'exact sprite name',
    ],
    collisionKeys: ['exact sprite name', 'exact special selector token'],
    reservedTokens: ['_mouse_', '_edge_'],
    orderSensitive: true,
    addRenameRule:
      'spriteIdentity naming rules apply and prospective touching selectors must remain unactivated',
    evidence: [
      '@scratch/scratch-vm/src/blocks/scratch3_sensing.js',
      '@scratch/scratch-vm/src/sprites/rendered-target.js',
    ],
  },
  {
    domain: 'distanceTarget',
    scope: 'sensing_distanceto on the executing sprite',
    directLookup: 'special selector before first exact original-sprite name',
    lookupPrecedence: [
      'exact _mouse_ selector',
      'first exact original-sprite name',
    ],
    collisionKeys: ['exact sprite name', 'exact special selector token'],
    reservedTokens: ['_mouse_'],
    orderSensitive: true,
    addRenameRule:
      'spriteIdentity naming rules apply and prospective distance selectors must remain unactivated',
    evidence: ['@scratch/scratch-vm/src/blocks/scratch3_sensing.js'],
  },
  {
    domain: 'sensingObjectTarget',
    scope: 'sensing_of object selector',
    directLookup: 'stage sentinel before first exact original-sprite name',
    lookupPrecedence: [
      'exact _stage_ selector',
      'first exact original-sprite name',
    ],
    collisionKeys: ['exact sprite name', 'exact _stage_ selector'],
    reservedTokens: ['_stage_'],
    orderSensitive: true,
    addRenameRule:
      'spriteIdentity naming rules apply and prospective sensing_of object selectors must remain unactivated',
    evidence: ['@scratch/scratch-vm/src/blocks/scratch3_sensing.js'],
  },
  {
    domain: 'sensingObjectProperty',
    scope: 'selected sensing_of target and its exact target kind',
    directLookup:
      'target-kind built-in property switch before exact target-local scalar-variable lookup',
    lookupPrecedence: [
      'stage built-in property token when target is stage',
      'sprite built-in property token when target is sprite',
      'first exact target-local scalar-variable name',
    ],
    collisionKeys: [
      'exact target-kind property token',
      'exact target-local scalar-variable name',
    ],
    reservedTokens: [...SENSING_PROPERTY_TOKENS],
    orderSensitive: true,
    addRenameRule:
      'reject a variable or list name colliding with a target-kind built-in property token in any affected sensing_of scope',
    evidence: ['@scratch/scratch-vm/src/blocks/scratch3_sensing.js'],
  },
  {
    domain: 'variable',
    scope: 'owning target locals followed by stage globals',
    directLookup:
      'exact id first; otherwise exact scalar name with local-before-stage fallback',
    lookupPrecedence: [
      'local exact id',
      'stage exact id',
      'first local exact scalar name',
      'first stage exact scalar name',
    ],
    collisionKeys: [
      'exact scalar name within scope',
      'affected sensing_of built-in property token',
    ],
    reservedTokens: [...SENSING_PROPERTY_TOKENS],
    orderSensitive: true,
    addRenameRule:
      'require exact same-kind scope uniqueness, reject affected sensing_of property collisions, and prove zero prospective activation',
    evidence: [
      '@scratch/scratch-vm/src/engine/target.js',
      '@scratch/scratch-vm/src/blocks/scratch3_sensing.js',
    ],
  },
  {
    domain: 'list',
    scope: 'owning target locals followed by stage globals',
    directLookup:
      'exact id first; otherwise exact list name with local-before-stage fallback',
    lookupPrecedence: [
      'local exact id',
      'stage exact id',
      'first local exact list name',
      'first stage exact list name',
    ],
    collisionKeys: [
      'exact list name within scope',
      'affected sensing_of built-in property token',
    ],
    reservedTokens: [...SENSING_PROPERTY_TOKENS],
    orderSensitive: true,
    addRenameRule:
      'require exact same-kind scope uniqueness, reject affected sensing_of property collisions, and prove zero prospective activation',
    evidence: [
      '@scratch/scratch-vm/src/engine/target.js',
      '@scratch/scratch-vm/src/blocks/scratch3_sensing.js',
    ],
  },
  {
    domain: 'broadcast',
    scope: 'project-global stage broadcast declarations in own-key order',
    directLookup: 'id first; otherwise first ECMAScript toLowerCase name match',
    lookupPrecedence: [
      'exact declaration id with lower-case name consistency check',
      'first lower-case-equivalent broadcast declaration',
      'Runtime.startHats upper-case field equality',
    ],
    collisionKeys: [
      'exact name',
      'ECMAScript toLowerCase name',
      'ECMAScript toUpperCase hat field',
    ],
    reservedTokens: [],
    orderSensitive: true,
    addRenameRule:
      'require all three collision sets unique and zero prospective activation',
    evidence: [
      '@scratch/scratch-vm/src/engine/target.js',
      '@scratch/scratch-vm/src/engine/runtime.js',
      '@scratch/scratch-vm/src/engine/blocks-runtime-cache.js',
    ],
  },
  {
    domain: 'costume',
    scope: 'costumes of the exact owning sprite',
    directLookup: 'exact string name before special token or numeric coercion',
    lookupPrecedence: [
      'first exact costume string name',
      'exact next costume or previous costume token',
      'non-whitespace JavaScript Number coercion as one-based ordinal',
    ],
    collisionKeys: [
      'exact string name',
      'special-token classification',
      'numeric-string classification',
    ],
    reservedTokens: ['next costume', 'previous costume'],
    orderSensitive: true,
    addRenameRule:
      'reject exact duplicates and string names classified as a special or ordinal token',
    evidence: [
      '@scratch/scratch-vm/src/blocks/scratch3_looks.js',
      '@scratch/scratch-vm/src/sprites/rendered-target.js',
    ],
  },
  {
    domain: 'backdrop',
    scope: 'stage costumes',
    directLookup: 'exact string name before special token or numeric coercion',
    lookupPrecedence: [
      'first exact backdrop string name',
      'exact next, previous, or random backdrop token',
      'non-whitespace JavaScript Number coercion as one-based ordinal',
      'upper-case event_whenbackdropswitchesto hat equality after selection',
    ],
    collisionKeys: [
      'exact string name',
      'ECMAScript toUpperCase hat field',
      'special-token classification',
      'numeric-string classification',
    ],
    reservedTokens: ['next backdrop', 'previous backdrop', 'random backdrop'],
    orderSensitive: true,
    addRenameRule:
      'reject every collision class and prove the complete upper-case hat set',
    evidence: [
      '@scratch/scratch-vm/src/blocks/scratch3_looks.js',
      '@scratch/scratch-vm/src/engine/runtime.js',
    ],
  },
  {
    domain: 'sound',
    scope: 'sounds of the exact owning target',
    directLookup: 'strict exact string name equality',
    lookupPrecedence: [
      'first exact sound name',
      'base-10 parseInt prefix',
      'wrapped one-based ordinal',
    ],
    collisionKeys: ['exact name', 'base-10 parseInt ordinal classification'],
    reservedTokens: [
      'any string for which parseInt(value, 10) is not NaN when no exact name exists',
    ],
    orderSensitive: true,
    addRenameRule:
      'reject exact duplicates and every parseInt-classified ordinal token',
    evidence: ['@scratch/scratch-vm/src/blocks/scratch3_sound.js'],
  },
  {
    domain: 'procedure',
    scope: 'exact owning target',
    directLookup: 'exact canonical proccode',
    lookupPrecedence: [
      'definition input to exact prototype mutation',
      'first exact canonical proccode lookup',
      'aligned argument-name, argument-id, and default arrays',
      'calls and otherwise well-formed orphan records in block-map order',
    ],
    collisionKeys: ['exact canonical proccode'],
    reservedTokens: ['%s', '%n', '%b'],
    orderSensitive: true,
    addRenameRule:
      'require zero external definition, prototype, call, or orphan collision',
    evidence: [
      'scratch-blocks/src/blocks/procedures.ts',
      '@scratch/scratch-vm/src/blocks/scratch3_procedures.js',
    ],
  },
] as const satisfies readonly NameResolutionDomain[]

export const SOUND_NAME_PRECEDENCE_VECTORS = [
  {
    input: '1foo',
    soundNames: ['1foo', 'other', 'third'],
    outcome: 'exact-name-index-0',
  },
  {
    input: '1foo',
    soundNames: ['first', 'second', 'third'],
    outcome: 'parseInt-1-wrapped-index-0',
  },
  {
    input: '  +2tail',
    soundNames: ['first', 'second', 'third'],
    outcome: 'parseInt-2-wrapped-index-1',
  },
  {
    input: '0x10',
    soundNames: ['first', 'second', 'third'],
    outcome: 'base-10-parseInt-0-wrapped-index-2',
  },
  {
    input: '-1',
    soundNames: ['first', 'second', 'third'],
    outcome: 'parseInt-negative-1-wrapped-index-1',
  },
  {
    input: 'Infinity',
    soundNames: ['first', 'second', 'third'],
    outcome: 'no-match',
  },
  {
    input: '   ',
    soundNames: ['first', 'second', 'third'],
    outcome: 'whitespace-parseInt-NaN-no-match',
  },
  {
    input: '2.9tail',
    soundNames: ['first', 'second', 'third'],
    outcome: 'parseInt-truncates-at-decimal-to-2-index-1',
  },
  {
    input: '9007199254740993',
    soundNames: ['first', 'second', 'third'],
    outcome: 'parseInt-rounds-to-9007199254740992-wrapped-index-1',
  },
  {
    input: '-0',
    soundNames: ['first', 'second', 'third'],
    outcome: 'parseInt-negative-zero-wrapped-index-2',
  },
] as const

interface ProcedureSplitDisplayVector
{
  id: string
  proccode: string
  splitComponents: readonly string[]
  displayParts: readonly (
    | { kind: 'label'; text: string }
    | { kind: 'argument'; argumentType: 's' | 'b' | 'n'; trailingLabel: string }
  )[]
  oracleOutcome: 'displayed' | 'invalidArgumentType'
  signatureEditing: 'authorable' | 'preservationOnly'
  reason: string
}

export const PROCEDURE_SPLIT_DISPLAY_VECTORS = [
  {
    id: 'string-marker',
    proccode: 'say %s',
    splitComponents: ['say', '%s'],
    displayParts: [
      { kind: 'label', text: 'say' },
      { kind: 'argument', argumentType: 's', trailingLabel: '' },
    ],
    oracleOutcome: 'displayed',
    signatureEditing: 'authorable',
    reason: 'new string-or-number parameter marker',
  },
  {
    id: 'boolean-marker',
    proccode: 'if %b then',
    splitComponents: ['if', '%b then'],
    displayParts: [
      { kind: 'label', text: 'if' },
      { kind: 'argument', argumentType: 'b', trailingLabel: 'then' },
    ],
    oracleOutcome: 'displayed',
    signatureEditing: 'authorable',
    reason: 'new Boolean parameter marker',
  },
  {
    id: 'legacy-number-marker',
    proccode: 'legacy %n',
    splitComponents: ['legacy', '%n'],
    displayParts: [
      { kind: 'label', text: 'legacy' },
      { kind: 'argument', argumentType: 'n', trailingLabel: '' },
    ],
    oracleOutcome: 'displayed',
    signatureEditing: 'authorable',
    reason: 'legacy in origin but authorable: %n is the number parameter type',
  },
  {
    id: 'literal-percent',
    proccode: 'literal % sign',
    splitComponents: ['literal % sign'],
    displayParts: [{ kind: 'label', text: 'literal % sign' }],
    oracleOutcome: 'displayed',
    signatureEditing: 'preservationOnly',
    reason: 'V1 rejects literal percent in new label fragments',
  },
  {
    id: 'backslash-escaped-marker',
    proccode: 'escaped \\%s marker',
    splitComponents: ['escaped \\%s marker'],
    displayParts: [{ kind: 'label', text: 'escaped %s marker' }],
    oracleOutcome: 'displayed',
    signatureEditing: 'preservationOnly',
    reason: 'Scratch Blocks unescapes one backslash-percent pair for display',
  },
  {
    id: 'repeated-markers',
    proccode: 'repeat %s %b %s',
    splitComponents: ['repeat', '%s', '%b', '%s'],
    displayParts: [
      { kind: 'label', text: 'repeat' },
      { kind: 'argument', argumentType: 's', trailingLabel: '' },
      { kind: 'argument', argumentType: 'b', trailingLabel: '' },
      { kind: 'argument', argumentType: 's', trailingLabel: '' },
    ],
    oracleOutcome: 'displayed',
    signatureEditing: 'authorable',
    reason: 'ordered repeated markers remain distinct parameters',
  },
  {
    id: 'double-percent-is-not-an-escape',
    proccode: '%%s',
    splitComponents: ['%%s'],
    displayParts: [],
    oracleOutcome: 'invalidArgumentType',
    signatureEditing: 'preservationOnly',
    reason: 'component starts with percent but its argument type is percent',
  },
  {
    id: 'double-backslash-before-marker',
    proccode: 'value \\\\%s',
    splitComponents: ['value \\\\%s'],
    displayParts: [{ kind: 'label', text: 'value \\%s' }],
    oracleOutcome: 'displayed',
    signatureEditing: 'preservationOnly',
    reason: 'the marker remains escaped and one backslash is retained',
  },
] as const satisfies readonly ProcedureSplitDisplayVector[]

interface ProcedureOrphanCollisionVector
{
  id: string
  proposedTarget: string
  proposedProccode: string
  existing: readonly {
    target: string
    recordKind: 'definition' | 'prototype' | 'call'
    proccode: string
    ownership: 'coherent' | 'orphan'
  }[]
  expectedCollisionIndexes: readonly number[]
  outcome: 'refuse' | 'noCollision'
}

export const PROCEDURE_ORPHAN_COLLISION_VECTORS = [
  {
    id: 'orphan-call-collides',
    proposedTarget: 'Sprite1',
    proposedProccode: 'act %s',
    existing: [
      {
        target: 'Sprite1',
        recordKind: 'call',
        proccode: 'act %s',
        ownership: 'orphan',
      },
    ],
    expectedCollisionIndexes: [0],
    outcome: 'refuse',
  },
  {
    id: 'orphan-definition-and-prototype-collide',
    proposedTarget: 'Sprite1',
    proposedProccode: 'act %s',
    existing: [
      {
        target: 'Sprite1',
        recordKind: 'definition',
        proccode: 'act %s',
        ownership: 'orphan',
      },
      {
        target: 'Sprite1',
        recordKind: 'prototype',
        proccode: 'act %s',
        ownership: 'orphan',
      },
    ],
    expectedCollisionIndexes: [0, 1],
    outcome: 'refuse',
  },
  {
    id: 'coherent-existing-procedure-collides',
    proposedTarget: 'Sprite1',
    proposedProccode: 'act %s',
    existing: [
      {
        target: 'Sprite1',
        recordKind: 'definition',
        proccode: 'act %s',
        ownership: 'coherent',
      },
      {
        target: 'Sprite1',
        recordKind: 'prototype',
        proccode: 'act %s',
        ownership: 'coherent',
      },
      {
        target: 'Sprite1',
        recordKind: 'call',
        proccode: 'act %s',
        ownership: 'coherent',
      },
    ],
    expectedCollisionIndexes: [0, 1, 2],
    outcome: 'refuse',
  },
  {
    id: 'same-proccode-other-target-does-not-collide',
    proposedTarget: 'Sprite1',
    proposedProccode: 'act %s',
    existing: [
      {
        target: 'Sprite2',
        recordKind: 'call',
        proccode: 'act %s',
        ownership: 'orphan',
      },
    ],
    expectedCollisionIndexes: [],
    outcome: 'noCollision',
  },
  {
    id: 'different-proccode-does-not-collide',
    proposedTarget: 'Sprite1',
    proposedProccode: 'act %s',
    existing: [
      {
        target: 'Sprite1',
        recordKind: 'definition',
        proccode: 'act %b',
        ownership: 'orphan',
      },
    ],
    expectedCollisionIndexes: [],
    outcome: 'noCollision',
  },
] as const satisfies readonly ProcedureOrphanCollisionVector[]

export interface OperationPlanningRow
{
  operationKind: OperationKind
  requiredOperationFields: readonly string[]
  optionalOperationFields: readonly string[]
  fullOperationFields: readonly string[]
  destinationNotation: 'json-pointer-pattern'
  goalFields: readonly string[]
  choiceFields: readonly string[]
  completedFactFields: readonly string[]
  choiceMappings: readonly OperationPlanningChoiceMapping[]
  completedFactMappings: readonly OperationPlanningFactMapping[]
  zeroChoice: boolean
  emptyChoiceSetHashRequired: boolean
  choiceCardinality: 'alwaysZero' | 'dataDependent'
  recursiveCompletionRule: string
}

export type OperationPlanningChoiceValueKind =
  | 'bodyParameterReporterKind'
  | 'callArgumentKind'
  | 'commentRemoval'
  | 'commentReplacement'
  | 'localKey'
  | 'movedCommentLayout'
  | 'obscuredShadowKind'
  | 'ownedInputReplacementKind'
  | 'parameterLineageKind'
  | 'parameterRef'
  | 'prototypeReporterComment'
  | 'prototypeReporterKind'
  | 'scriptCopyComments'
  | 'semanticInput'
  | 'sourceGapKind'

export interface OperationPlanningChoiceMapping
{
  destination: string
  valueKind: OperationPlanningChoiceValueKind
  allowedAlternativeKinds: readonly string[]
}

export type OperationPlanningFactValueKind =
  | 'blockRef'
  | 'boolean'
  | 'commentLayoutExpected'
  | 'containerState'
  | 'costumeSelection'
  | 'existingOptionalNumber'
  | 'integer'
  | 'localKey'
  | 'movedCommentKind'
  | 'nameActivation'
  | 'parameterRef'
  | 'sha256'
  | 'spritePropertyExpected'
  | 'stagePropertyExpected'
  | 'stringIdentity'
  | 'workspaceExpected'

export interface OperationPlanningFactMapping
{
  destination: string
  valueKind: OperationPlanningFactValueKind
}

interface DestinationPartition
{
  goal: readonly string[]
  choice: readonly string[]
  completedFact: readonly string[]
}

const PURE_CHOICE_FIELDS: Partial<Record<OperationKind, readonly string[]>> = {
  'script.duplicate': ['comments'],
  'script.remove': ['comments'],
  'block.replace': ['comments'],
  'block.remove': ['comments'],
  'procedure.remove': ['comments'],
}

const PROPERTY_EDIT_PARTITION = {
  goal: ['/edits/*/property', '/edits/*/value'],
  choice: [],
  completedFact: ['/edits/*/expected'],
} as const satisfies DestinationPartition

const SOURCE_GAP_PARTITION = {
  goal: [],
  choice: [
    '/sourceGap/kind',
    '/sourceGap/obscuredShadow/kind',
    '/sourceGap/value',
  ],
  completedFact: [
    '/sourceGap/expectedCurrentInputFingerprint',
    '/sourceGap/expectedShadowFingerprint',
    '/sourceGap/obscuredShadow/expectedShadowFingerprint',
    '/sourceGap/expectedScriptClosureSha256',
  ],
} as const satisfies DestinationPartition

const OWNED_INPUT_PARTITION = {
  goal: [],
  choice: ['/replacedInput/kind', '/replacedInput/comments'],
  completedFact: [
    '/replacedInput/expectedClosureSha256',
    '/replacedInput/expectedOwnedBlockCount',
  ],
} as const satisfies DestinationPartition

const MOVED_COMMENT_PARTITION = {
  goal: [],
  choice: ['/comments/layout'],
  completedFact: ['/comments/kind', '/comments/expectedCommentSetSha256'],
} as const satisfies DestinationPartition

const BLOCK_MOVE_DESTINATION_PARTITION = {
  goal: [
    '/destination/kind',
    '/destination/anchor',
    '/destination/owner',
    '/destination/inputName',
    '/destination/workspace',
    '/destination/call',
    '/destination/procedure',
    '/destination/parameter',
  ],
  choice: [],
  completedFact: [
    '/destination/expectedCurrentInputFingerprint',
    '/destination/expectedEmpty',
    '/destination/expectedNoOwnedBlock',
    '/destination/expectedSignatureSha256',
  ],
} as const satisfies DestinationPartition

const PARAMETER_LINEAGE_PARTITION = {
  goal: [],
  choice: [
    '/parameterLineage/*/lineage/kind',
    '/parameterLineage/*/lineage/existingParameter',
  ],
  completedFact: ['/parameterLineage/*/parameterLocalKey'],
} as const satisfies DestinationPartition

const PROTOTYPE_REPORTER_PARTITION = {
  goal: [],
  choice: [
    '/prototypeReporters/*/disposition/kind',
    '/prototypeReporters/*/disposition/parameterLocalKey',
    '/prototypeReporters/*/disposition/comments',
  ],
  completedFact: [
    '/prototypeReporters/*/existingParameter',
    '/prototypeReporters/*/expectedReporterBlockFingerprint',
    '/prototypeReporters/*/disposition/expectedCommentSetSha256',
  ],
} as const satisfies DestinationPartition

const BODY_PARAMETER_REPORTER_PARTITION = {
  goal: [],
  choice: [
    '/bodyParameterReporters/*/disposition/kind',
    '/bodyParameterReporters/*/disposition/parameterLocalKey',
  ],
  completedFact: [
    '/bodyParameterReporters/*/existingParameter',
    '/bodyParameterReporters/*/expectedReporterSetSha256',
    '/bodyParameterReporters/*/disposition/requireFinalReporterCount',
  ],
} as const satisfies DestinationPartition

const CALL_SITE_PARTITION = {
  goal: [],
  choice: [
    '/callSites/*/arguments/*/source/kind',
    '/callSites/*/arguments/*/source/existingParameter',
    '/callSites/*/arguments/*/source/replacedInput/kind',
    '/callSites/*/arguments/*/source/replacedInput/comments',
    '/callSites/*/arguments/*/source/value',
    '/callSites/*/removedArguments/*/removedInput/kind',
    '/callSites/*/removedArguments/*/removedInput/comments',
  ],
  completedFact: [
    '/callSites/*/call',
    '/callSites/*/expectedArgumentSetSha256',
    '/callSites/*/arguments/*/parameterLocalKey',
    '/callSites/*/arguments/*/source/expectedInputFingerprint',
    '/callSites/*/arguments/*/source/replacedInput/expectedClosureSha256',
    '/callSites/*/arguments/*/source/replacedInput/expectedOwnedBlockCount',
    '/callSites/*/removedArguments/*/existingParameter',
    '/callSites/*/removedArguments/*/expectedInputFingerprint',
    '/callSites/*/removedArguments/*/removedInput/expectedClosureSha256',
    '/callSites/*/removedArguments/*/removedInput/expectedOwnedBlockCount',
  ],
} as const satisfies DestinationPartition

const MIXED_FIELD_PARTITIONS: Partial<
  Record<OperationKind, Readonly<Record<string, DestinationPartition>>>
> = {
  'target.setSpriteProperties': { edits: PROPERTY_EDIT_PARTITION },
  'target.setStageProperties': { edits: PROPERTY_EDIT_PARTITION },
  'comment.move': { edits: PROPERTY_EDIT_PARTITION },
  'block.move': {
    destination: BLOCK_MOVE_DESTINATION_PARTITION,
    sourceGap: SOURCE_GAP_PARTITION,
    comments: MOVED_COMMENT_PARTITION,
  },
  'block.remove': { sourceGap: SOURCE_GAP_PARTITION },
  'block.setInput': { replacedInput: OWNED_INPUT_PARTITION },
  'procedure.updateSignature': {
    parameterLineage: PARAMETER_LINEAGE_PARTITION,
    prototypeReporters: PROTOTYPE_REPORTER_PARTITION,
    bodyParameterReporters: BODY_PARAMETER_REPORTER_PARTITION,
    callSites: CALL_SITE_PARTITION,
  },
  'procedure.setCallArgument': { replacedInput: OWNED_INPUT_PARTITION },
}

const SERVER_FACT_FIELDS = new Set([
  'expectedPlanningFactSetSha256',
  'nameActivation',
  'newNameActivation',
  'currentSelection',
])

function serverFactField(field: string): boolean
{
  return (
    SERVER_FACT_FIELDS.has(field) ||
    field.startsWith('expected') ||
    field.startsWith('require')
  )
}

const CHOICE_ALTERNATIVES = {
  bodyParameterReporterKind: ['retainMapped', 'requireFinalZero'],
  callArgumentKind: [
    'preserveParameter',
    'replaceParameter',
    'initializeNewParameter',
  ],
  commentRemoval: ['rejectIfPresent', 'deleteExact'],
  commentReplacement: ['rejectIfPresent', 'deleteExact', 'reattachExact'],
  localKey: ['localKey'],
  movedCommentLayout: ['preserveAbsolute', 'translateWithRoot'],
  obscuredShadowKind: ['requireNone', 'preserveExact'],
  ownedInputReplacementKind: ['requireNoOwnedBlock', 'deleteExactOwnedClosure'],
  parameterLineageKind: ['retain', 'create'],
  parameterRef: ['parameterRef'],
  prototypeReporterComment: [
    'rejectIfPresent',
    'deleteExact',
    'reattachExactToParameterReporter',
  ],
  prototypeReporterKind: [
    'preserveExisting',
    'replaceForMappedParameter',
    'remove',
  ],
  scriptCopyComments: ['rejectIfPresent', 'duplicateAll'],
  semanticInput: [
    'literal',
    'entity',
    'special',
    'block',
    'statementSequence',
    'empty',
  ],
  sourceGapKind: [
    'spliceStatements',
    'revealExistingShadow',
    'replaceInput',
    'removeTopLevelScript',
  ],
} as const satisfies Readonly<
  Record<OperationPlanningChoiceValueKind, readonly string[]>
>

function choiceValueKind(
  operationKind: OperationKind,
  destination: string
): OperationPlanningChoiceValueKind
{
  if (destination === '/comments')
  {
    if (operationKind === 'script.duplicate') return 'scriptCopyComments'
    if (operationKind === 'block.replace') return 'commentReplacement'
    return 'commentRemoval'
  }
  if (destination === '/comments/layout') return 'movedCommentLayout'
  if (destination === '/sourceGap/kind') return 'sourceGapKind'
  if (destination === '/sourceGap/obscuredShadow/kind')
    return 'obscuredShadowKind'
  if (destination === '/sourceGap/value') return 'semanticInput'
  if (
    destination.endsWith('/replacedInput/kind') ||
    destination.endsWith('/removedInput/kind')
  )
    return 'ownedInputReplacementKind'
  if (
    destination.endsWith('/replacedInput/comments') ||
    destination.endsWith('/removedInput/comments')
  )
    return 'commentReplacement'
  if (destination === '/parameterLineage/*/lineage/kind')
    return 'parameterLineageKind'
  if (destination.endsWith('/existingParameter')) return 'parameterRef'
  if (destination === '/prototypeReporters/*/disposition/kind')
    return 'prototypeReporterKind'
  if (destination === '/prototypeReporters/*/disposition/comments')
    return 'prototypeReporterComment'
  if (destination === '/bodyParameterReporters/*/disposition/kind')
    return 'bodyParameterReporterKind'
  if (destination.endsWith('/parameterLocalKey')) return 'localKey'
  if (destination === '/callSites/*/arguments/*/source/kind')
    return 'callArgumentKind'
  if (destination === '/callSites/*/arguments/*/source/value')
    return 'semanticInput'
  throw new Error(
    `unclassified planning choice ${operationKind} ${destination}`
  )
}

function factValueKind(
  operationKind: OperationKind,
  destination: string
): OperationPlanningFactValueKind
{
  if (destination === '/edits/*/expected')
  {
    if (operationKind === 'target.setSpriteProperties')
      return 'spritePropertyExpected'
    if (operationKind === 'target.setStageProperties')
      return 'stagePropertyExpected'
    if (operationKind === 'comment.move') return 'commentLayoutExpected'
  }
  if (operationKind === 'script.moveWorkspace' && destination === '/expected')
    return 'workspaceExpected'
  const leaf = destination.split('/').at(-1)!
  if (leaf.endsWith('Sha256') || leaf.includes('Fingerprint')) return 'sha256'
  if (leaf === 'expectedName') return 'stringIdentity'
  if (leaf === 'nameActivation' || leaf === 'newNameActivation')
    return 'nameActivation'
  if (
    leaf === 'expectedListMapState' ||
    leaf === 'expectedStageBroadcastMapState' ||
    leaf === 'expectedCommentMapState'
  )
    return 'containerState'
  if (leaf === 'currentSelection') return 'costumeSelection'
  if (leaf === 'expectedFinalCurrentCostumeState')
    return 'existingOptionalNumber'
  if (
    leaf === 'expectedCurrentCostume' ||
    leaf === 'expectedDetached' ||
    leaf === 'expectedEmpty' ||
    leaf === 'expectedNoOwnedBlock'
  )
    return 'boolean'
  if (leaf === 'expectedBlock' || leaf === 'call') return 'blockRef'
  if (leaf === 'existingParameter') return 'parameterRef'
  if (leaf === 'parameterLocalKey') return 'localKey'
  if (destination === '/comments/kind') return 'movedCommentKind'
  if (
    leaf.startsWith('require') ||
    leaf.endsWith('Count') ||
    leaf.endsWith('Index') ||
    leaf.endsWith('Ordinal')
  )
    return 'integer'
  throw new Error(`unclassified planning fact ${operationKind} ${destination}`)
}

function fullOperationFields(
  operationKind: OperationKind,
  requiredFields: readonly string[],
  optionalFields: readonly string[]
): string[]
{
  const fields = [...requiredFields]
  for (const optionalField of optionalFields)
  {
    if (operationKind === 'procedure.add' && optionalField === 'body')
    {
      fields.splice(fields.indexOf('signature') + 1, 0, optionalField)
    }
    else
    {
      fields.push(optionalField)
    }
  }
  return fields
}

function fieldPartition(
  operationKind: OperationKind,
  field: string
): DestinationPartition
{
  const mixed = MIXED_FIELD_PARTITIONS[operationKind]?.[field]
  if (mixed !== undefined) return mixed

  const destination = `/${field}`
  if (PURE_CHOICE_FIELDS[operationKind]?.includes(field))
  {
    return { goal: [], choice: [destination], completedFact: [] }
  }
  if (serverFactField(field))
  {
    return { goal: [], choice: [], completedFact: [destination] }
  }
  return { goal: [destination], choice: [], completedFact: [] }
}

export const OPERATION_PLANNING_ROWS: readonly OperationPlanningRow[] =
  OPERATION_REVIEW_ROWS.map((operation) =>
  {
    const optionalOperationFields = operation.optionalFields
    const allFields = fullOperationFields(
      operation.kind,
      operation.requiredFields,
      optionalOperationFields
    )
    const partitions = allFields.map((field) =>
      fieldPartition(operation.kind, field)
    )
    const goalFields = partitions.flatMap((partition) => partition.goal)
    const choiceFields = partitions.flatMap((partition) => partition.choice)
    const completedFactFields = partitions.flatMap(
      (partition) => partition.completedFact
    )
    const choiceMappings = choiceFields.map((destination) =>
    {
      const valueKind = choiceValueKind(operation.kind, destination)
      return {
        destination,
        valueKind,
        allowedAlternativeKinds: CHOICE_ALTERNATIVES[valueKind],
      }
    })
    const completedFactMappings = completedFactFields.map((destination) => ({
      destination,
      valueKind: factValueKind(operation.kind, destination),
    }))

    return {
      operationKind: operation.kind,
      requiredOperationFields: operation.requiredFields,
      optionalOperationFields,
      fullOperationFields: allFields,
      destinationNotation: 'json-pointer-pattern',
      goalFields,
      choiceFields,
      completedFactFields,
      choiceMappings,
      completedFactMappings,
      zeroChoice: choiceFields.length === 0,
      emptyChoiceSetHashRequired: true,
      choiceCardinality:
        choiceFields.length === 0 ? 'alwaysZero' : 'dataDependent',
      recursiveCompletionRule:
        'every listed JSON-pointer pattern is a final-operation destination; wildcard segments enumerate bounded array members, source-derived expected/require/association leaves are completed facts, and destructive disposition or mapping alternatives remain caller choices',
    }
  })

const OPERATION_KIND_SET = new Set(
  OPERATION_PLANNING_ROWS.map((row) => row.operationKind)
)

const INVALID_OPERATION_PARTITION = OPERATION_PLANNING_ROWS.find((row) =>
{
  const partitionDestinations = [
    ...row.goalFields,
    ...row.choiceFields,
    ...row.completedFactFields,
  ]
  const destinationSet = new Set(partitionDestinations)
  const roots = partitionDestinations.map(
    (destination) => destination.split('/')[1]
  )

  return (
    destinationSet.size !== partitionDestinations.length ||
    roots.some(
      (root) => root === undefined || !row.fullOperationFields.includes(root)
    ) ||
    row.fullOperationFields.some((field) => !roots.includes(field)) ||
    row.optionalOperationFields.some(
      (field) =>
        row.requiredOperationFields.includes(field) ||
        !row.fullOperationFields.includes(field)
    ) ||
    row.choiceMappings.length !== row.choiceFields.length ||
    row.completedFactMappings.length !== row.completedFactFields.length ||
    row.choiceMappings.some(
      (mapping, index) =>
        mapping.destination !== row.choiceFields[index] ||
        mapping.allowedAlternativeKinds.length === 0
    ) ||
    row.completedFactMappings.some(
      (mapping, index) => mapping.destination !== row.completedFactFields[index]
    ) ||
    row.zeroChoice !== (row.choiceFields.length === 0) ||
    !row.emptyChoiceSetHashRequired
  )
})

if (
  OPERATION_PLANNING_ROWS.length !== OPERATION_REVIEW_ROWS.length ||
  OPERATION_KIND_SET.size !== OPERATION_REVIEW_ROWS.length ||
  INVALID_OPERATION_PARTITION !== undefined
)
{
  throw new Error(
    'operation planning rows do not cover and partition every operation exactly'
  )
}

for (const authority of [
  VANILLA_CORE_DESCRIPTORS,
  PNG_FEATURE_POLICIES,
  MEDIA_POLICY_TABLES,
  NAME_RESOLUTION_DOMAINS,
  SOUND_NAME_PRECEDENCE_VECTORS,
  PROCEDURE_SPLIT_DISPLAY_VECTORS,
  PROCEDURE_ORPHAN_COLLISION_VECTORS,
  OPERATION_PLANNING_ROWS,
])
{
  deepFreeze(authority)
}
