// packages/eval/src/multimodal/differential-capabilities.ts
// conservative project dependency classification for bounded runtime comparisons

import type { RuntimeDescriptorV1, RuntimeKind } from '@scratch-agent/runner'
import {
  isBlockEntry,
  unpackSb3,
  type Block,
  type ProjectJson,
} from '@scratch-agent/sb3'

import {
  detachedFrozenMultimodalRecord,
  hashMultimodalContent,
  hashMultimodalJson,
  MULTIMODAL_SCHEMA_VERSION,
} from './multimodal-contracts.js'
import type {
  DifferentialCapabilityAssessmentV1,
  DifferentialCapabilityKind,
  DifferentialCapabilityUseV1,
  DifferentialRuntimePair,
} from './lenses.js'

const MAX_WITNESSES_PER_CAPABILITY = 256

const CORE_PREFIXES = new Set([
  'argument',
  'colour',
  'control',
  'data',
  'event',
  'looks',
  'math',
  'motion',
  'operator',
  'procedures',
  'sensing',
  'sound',
])

const RENDERER_OPCODES = new Set([
  'looks_changesizeby',
  'looks_goforwardbackwardlayers',
  'looks_gotofrontback',
  'looks_setsizeto',
  'motion_ifonedgebounce',
  'sensing_coloristouchingcolor',
  'sensing_touchingcolor',
  'sensing_touchingobject',
])

const EXTERNAL_INPUT_OPCODES = new Set([
  'sensing_loud',
  'sensing_loudness',
  'sensing_username',
])

const NORMALIZED_SOUND_OPCODES = new Set([
  'sound_changevolumeby',
  'sound_setvolumeto',
  'sound_volume',
])

const NETWORK_EXTENSION_PREFIXES = new Set([
  'speech2text',
  'text2speech',
  'translate',
])

const AUDIO_EXTENSION_PREFIXES = new Set([
  'music',
  'speech2text',
  'text2speech',
])

const VIDEO_EXTENSION_PREFIXES = new Set(['faceSensing', 'videoSensing'])

const HARDWARE_EXTENSION_PREFIXES = new Set([
  'boost',
  'ev3',
  'gdxfor',
  'makeymakey',
  'microbit',
  'wedo2',
])

interface MutableCapabilityUse
{
  opcodes: Set<string>
  details: Set<string>
}

function opcodePrefix(opcode: string): string | null
{
  const separator = opcode.indexOf('_')
  return separator > 0 ? opcode.slice(0, separator) : null
}

function executableOpcode(opcode: string): boolean
{
  return !opcode.includes('_menu_') && !opcode.endsWith('menu')
}

function addCapability(
  uses: Map<DifferentialCapabilityKind, MutableCapabilityUse>,
  kind: DifferentialCapabilityKind,
  opcode?: string,
  detail?: string
): void
{
  let use = uses.get(kind)
  if (!use)
  {
    use = { opcodes: new Set(), details: new Set() }
    uses.set(kind, use)
  }
  if (opcode) use.opcodes.add(opcode)
  if (detail) use.details.add(detail)
}

function classifyOpcode(
  uses: Map<DifferentialCapabilityKind, MutableCapabilityUse>,
  opcode: string
): void
{
  if (!executableOpcode(opcode)) return
  if (RENDERER_OPCODES.has(opcode)) addCapability(uses, 'renderer', opcode)
  if (opcode.startsWith('sound_') && !NORMALIZED_SOUND_OPCODES.has(opcode))
    addCapability(uses, 'audio', opcode)
  if (EXTERNAL_INPUT_OPCODES.has(opcode))
    addCapability(uses, 'external-input', opcode)
  if (opcode === 'sensing_loud' || opcode === 'sensing_loudness')
    addCapability(uses, 'audio', opcode)
  if (opcode === 'sensing_online') addCapability(uses, 'network', opcode)

  const prefix = opcodePrefix(opcode)
  if (!prefix || CORE_PREFIXES.has(prefix)) return
  addCapability(uses, 'extension', opcode, `extension:${prefix}`)
  if (prefix === 'pen') addCapability(uses, 'renderer', opcode)
  if (NETWORK_EXTENSION_PREFIXES.has(prefix))
    addCapability(uses, 'network', opcode)
  if (AUDIO_EXTENSION_PREFIXES.has(prefix)) addCapability(uses, 'audio', opcode)
  if (VIDEO_EXTENSION_PREFIXES.has(prefix))
  {
    addCapability(uses, 'video', opcode)
    addCapability(uses, 'external-input', opcode)
  }
  if (prefix === 'speech2text') addCapability(uses, 'external-input', opcode)
  if (HARDWARE_EXTENSION_PREFIXES.has(prefix))
  {
    addCapability(uses, 'hardware', opcode)
    addCapability(uses, 'external-input', opcode)
  }
}

function classifyBlock(
  uses: Map<DifferentialCapabilityKind, MutableCapabilityUse>,
  block: Block
): void
{
  classifyOpcode(uses, block.opcode)
  const greaterThanMenu = block.fields?.WHENGREATERTHANMENU?.[0]
  if (
    block.opcode !== 'event_whengreaterthan' ||
    String(greaterThanMenu).toLowerCase() !== 'loudness'
  )
    return
  addCapability(uses, 'audio', block.opcode)
  addCapability(uses, 'external-input', block.opcode)
}

function unsupportedReason(
  runtimePair: DifferentialRuntimePair,
  kind: DifferentialCapabilityKind
): string | null
{
  if (kind === 'renderer')
    return runtimePair === 'official-browser-vs-turbowarp-browser'
      ? null
      : 'one or more compared lanes lack a qualified renderer'
  if (kind === 'audio')
    return 'audio output and timing have no normalized differential observation'
  if (kind === 'network') return 'project networking is denied in Multimodal'
  if (kind === 'extension')
    return 'extension behavior has no qualified normalized differential'
  if (kind === 'video') return 'camera and video-provider input are unavailable'
  if (kind === 'hardware') return 'hardware providers are unavailable'
  return 'host sensor or identity input is not normalized'
}

function boundedSorted(values: Set<string>): {
  values: string[]
  omitted: number
}
{
  const sorted = [...values].sort()
  return {
    values: sorted.slice(0, MAX_WITNESSES_PER_CAPABILITY),
    omitted: Math.max(0, sorted.length - MAX_WITNESSES_PER_CAPABILITY),
  }
}

function capabilityUses(
  uses: Map<DifferentialCapabilityKind, MutableCapabilityUse>,
  runtimePair: DifferentialRuntimePair
): DifferentialCapabilityUseV1[]
{
  return [...uses.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, use]) =>
    {
      const opcodes = boundedSorted(use.opcodes)
      const details = boundedSorted(use.details)
      const reason = unsupportedReason(runtimePair, kind)
      return {
        kind,
        support: reason === null ? 'supported' : 'unsupported',
        reason,
        opcodes: opcodes.values,
        omittedOpcodeCount: opcodes.omitted,
        details: details.values,
        omittedDetailCount: details.omitted,
      }
    })
}

function assessProjectDifferentialCapabilities(
  project: ProjectJson,
  runtimePair: DifferentialRuntimePair,
  sourceSb3Sha256: string
): Readonly<DifferentialCapabilityAssessmentV1>
{
  const uses = new Map<DifferentialCapabilityKind, MutableCapabilityUse>()
  let costumeCount = 0
  let soundCount = 0
  let cloudVariableCount = 0
  for (const target of project.targets)
  {
    costumeCount += target.costumes.length
    soundCount += target.sounds.length
    for (const [id, variable] of Object.entries(target.variables))
    {
      if (variable[2] !== true) continue
      cloudVariableCount++
      addCapability(uses, 'network', undefined, `cloud-variable:${id}`)
    }
    for (const entry of Object.values(target.blocks))
    {
      if (isBlockEntry(entry)) classifyBlock(uses, entry)
    }
  }
  for (const monitor of project.monitors ?? [])
    classifyOpcode(uses, monitor.opcode)

  const declared = boundedSorted(new Set(project.extensions ?? []))
  const capabilities = capabilityUses(uses, runtimePair)
  return detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    status: 'classified',
    runtimePair,
    classification: capabilities.some(
      (capability) => capability.support === 'unsupported'
    )
      ? 'unsupported'
      : 'comparable',
    sourceSb3Sha256,
    leftRuntimeDescriptorSha256: null,
    rightRuntimeDescriptorSha256: null,
    declaredExtensions: declared.values,
    omittedDeclaredExtensionCount: declared.omitted,
    inventory: { costumeCount, soundCount, cloudVariableCount },
    capabilities,
  })
}

export async function assessSb3DifferentialCapabilities(
  sb3: Uint8Array,
  runtimePair: DifferentialRuntimePair
): Promise<Readonly<DifferentialCapabilityAssessmentV1>>
{
  const unpacked = await unpackSb3(sb3)
  const project = JSON.parse(unpacked.projectJsonText) as ProjectJson
  const sourceSb3Sha256 = hashMultimodalContent(sb3)
  return assessProjectDifferentialCapabilities(
    project,
    runtimePair,
    sourceSb3Sha256
  )
}

function expectedRuntimeKinds(
  runtimePair: DifferentialRuntimePair
): { left: RuntimeKind; right: RuntimeKind } | null
{
  if (runtimePair === 'official-headless-vs-turbowarp-browser')
    return { left: 'scratch-vm-node', right: 'turbowarp-browser' }
  if (runtimePair === 'official-browser-vs-turbowarp-browser')
    return { left: 'scratch-official-browser', right: 'turbowarp-browser' }
  return null
}

interface CapabilityTraceBinding
{
  sourceSb3Sha256: string
  runtimeDescriptor: RuntimeDescriptorV1
}

export function bindDifferentialCapabilities(
  assessment: DifferentialCapabilityAssessmentV1,
  left: CapabilityTraceBinding,
  right: CapabilityTraceBinding
): Readonly<DifferentialCapabilityAssessmentV1>
{
  if (
    assessment.sourceSb3Sha256 === null ||
    assessment.sourceSb3Sha256 !== left.sourceSb3Sha256 ||
    assessment.sourceSb3Sha256 !== right.sourceSb3Sha256
  )
    throw new Error('capability assessment artifact binding does not match')
  const expected = expectedRuntimeKinds(assessment.runtimePair)
  if (
    expected &&
    (left.runtimeDescriptor.kind !== expected.left ||
      right.runtimeDescriptor.kind !== expected.right)
  )
    throw new Error('capability assessment runtime pair does not match')
  return detachedFrozenMultimodalRecord({
    ...assessment,
    status: 'assessed',
    leftRuntimeDescriptorSha256: hashMultimodalJson(left.runtimeDescriptor),
    rightRuntimeDescriptorSha256: hashMultimodalJson(right.runtimeDescriptor),
  })
}

export function differentialCapabilityBindingMatches(
  assessment: DifferentialCapabilityAssessmentV1,
  left: CapabilityTraceBinding,
  right: CapabilityTraceBinding
): boolean
{
  if (
    assessment.status !== 'assessed' ||
    assessment.sourceSb3Sha256 !== left.sourceSb3Sha256 ||
    assessment.sourceSb3Sha256 !== right.sourceSb3Sha256 ||
    assessment.leftRuntimeDescriptorSha256 !==
      hashMultimodalJson(left.runtimeDescriptor) ||
    assessment.rightRuntimeDescriptorSha256 !==
      hashMultimodalJson(right.runtimeDescriptor)
  )
    return false
  const expected = expectedRuntimeKinds(assessment.runtimePair)
  return (
    expected === null ||
    (left.runtimeDescriptor.kind === expected.left &&
      right.runtimeDescriptor.kind === expected.right)
  )
}

export function unassessedDifferentialCapabilities(): Readonly<DifferentialCapabilityAssessmentV1>
{
  return detachedFrozenMultimodalRecord({
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    status: 'not-assessed',
    runtimePair: 'custom-runtime-pair',
    classification: 'unknown',
    sourceSb3Sha256: null,
    leftRuntimeDescriptorSha256: null,
    rightRuntimeDescriptorSha256: null,
    declaredExtensions: [],
    omittedDeclaredExtensionCount: 0,
    inventory: { costumeCount: 0, soundCount: 0, cloudVariableCount: 0 },
    capabilities: [],
  })
}
