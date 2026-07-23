// packages/ir/src/edit/repair-core-compatibility.ts
// prove the exact legacy repair overlap w/ the neutral curated block catalog

import {
  REPAIR_BLOCK_SHAPES,
  type RepairBlockCategory,
  type RepairBlockShape,
  type RepairFieldShape,
  type RepairInputShape,
} from '../repair/repair-block-catalog.js'
import {
  VANILLA_CORE_DESCRIPTORS,
  type VanillaBlockShape,
  type VanillaCoreDescriptor,
} from './catalog.js'
import { CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1 } from './core-block-catalog.js'
import { semanticHashV1 } from './hash-domains.js'
import { deepFreeze } from './immutable.js'
import { compareLexicalTextV1 as compareText } from './lexical-order.js'

const REPAIR_CORE_COMPATIBILITY_PROFILE_ID =
  'legacy-repair-to-curated-core-v1' as const
const REPAIR_CORE_COMPATIBILITY_PROFILE_VERSION = 1 as const
export const APPROVED_REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256 =
  '7bdb6c4d35f906ac5a93ab45882d296868af0ec1dcfbd8d1d9ce7f9ef344d739' as const

interface RepairCoreCompatibilityChecksV1
{
  readonly categoryAndShape: boolean
  readonly requiredFieldNames: boolean
  readonly requiredInputNames: boolean
  readonly fieldReferenceSerialization: boolean
  readonly inputReferenceAndShadowSerialization: boolean
}

interface RepairCoreCompatibilityRowV1
{
  readonly opcode: string
  readonly disposition: 'compatible' | 'excluded'
  readonly reason: string
  readonly repairShape: RepairBlockShape | null
  readonly repairRequiredFieldNames: readonly string[]
  readonly repairRequiredInputNames: readonly string[]
  readonly curatedCategory: VanillaCoreDescriptor['category']
  readonly curatedShape: VanillaBlockShape
  readonly curatedAvailability: VanillaCoreDescriptor['availability']
  readonly curatedRequiredFields: VanillaCoreDescriptor['requiredFields']
  readonly curatedOptionalFields: VanillaCoreDescriptor['optionalFields']
  readonly curatedRequiredInputs: VanillaCoreDescriptor['requiredInputs']
  readonly curatedOptionalInputs: VanillaCoreDescriptor['optionalInputs']
  readonly checks: RepairCoreCompatibilityChecksV1
}

function keys(value: Readonly<Record<string, unknown>> | undefined): string[]
{
  return Object.keys(value ?? {}).sort(compareText)
}

function sameText(left: readonly string[], right: readonly string[]): boolean
{
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function repairCategoryForShape(shape: VanillaBlockShape): RepairBlockCategory
{
  if (shape === 'hat') return 'hat'
  if (shape === 'reporter' || shape === 'menuReporter') return 'reporter'
  if (shape === 'boolean') return 'boolean'
  return 'statement'
}

function categoryAndShapeParity(
  repair: RepairBlockShape,
  curated: VanillaCoreDescriptor
): boolean
{
  if (repair.category !== repairCategoryForShape(curated.shape)) return false
  if (curated.shape === 'cShape')
  {
    const inputs = repair.inputs ?? {}
    return Object.values(inputs).includes('substack')
  }
  if (curated.shape === 'cap') return false
  if (curated.shape === 'menuReporter') return false
  return true
}

function fieldSerializationParity(
  repairShape: RepairFieldShape,
  descriptor: VanillaCoreDescriptor['requiredFields'][number] | undefined
): boolean
{
  if (descriptor === undefined) return false
  if (repairShape === 'plain')
    return (
      descriptor.referenceDomain === null &&
      descriptor.requiredEntitySubtype === null
    )
  return (
    descriptor.referenceDomain === repairShape &&
    descriptor.requiredEntitySubtype === repairShape &&
    descriptor.serialization ===
      'field tuple [exact name, exact declaration id]'
  )
}

function allFieldSerializationsMatch(
  repair: RepairBlockShape,
  curated: VanillaCoreDescriptor
): boolean
{
  return Object.entries(repair.fields ?? {}).every(([name, shape]) =>
    fieldSerializationParity(
      shape,
      curated.requiredFields.find((field) => field.name === name)
    )
  )
}

function inputSerializationParity(
  repairShape: RepairInputShape,
  descriptor: VanillaCoreDescriptor['requiredInputs'][number] | undefined
): boolean
{
  if (descriptor === undefined) return false
  if (repairShape !== 'broadcast') return false
  const shadow = descriptor.canonicalShadow
  return (
    descriptor.connection === 'entityMenu' &&
    descriptor.referenceDomain === 'broadcast' &&
    descriptor.requiredEntitySubtype === 'broadcast' &&
    shadow?.kind === 'entityMenu' &&
    shadow.sb3PrimitiveTag === 11
  )
}

function allInputSerializationsMatch(
  repair: RepairBlockShape,
  curated: VanillaCoreDescriptor
): boolean
{
  return Object.entries(repair.inputs ?? {}).every(([name, shape]) =>
    inputSerializationParity(
      shape,
      curated.requiredInputs.find((input) => input.name === name)
    )
  )
}

function exclusionReason(
  repair: RepairBlockShape | undefined,
  curated: VanillaCoreDescriptor,
  checks: RepairCoreCompatibilityChecksV1
): string
{
  if (
    curated.availability !== 'supported' ||
    curated.safeBuilderKind !== 'ordinaryBlock'
  )
    return 'curated descriptor is not an independently authorable block'
  if (repair === undefined)
    return 'opcode is absent from the unchanged legacy repair registry'
  if (!checks.categoryAndShape)
    return 'legacy category or graph shape is not exactly equivalent'
  if (!checks.requiredFieldNames)
    return 'required or optional field presence semantics differ'
  if (!checks.requiredInputNames)
    return 'required or optional input presence semantics differ'
  if (!checks.fieldReferenceSerialization)
    return 'field reference serialization is not exactly equivalent'
  return 'legacy literal, reporter, or shadow input serialization is broader than the curated policy'
}

function buildRow(
  curated: VanillaCoreDescriptor
): RepairCoreCompatibilityRowV1
{
  const repair: RepairBlockShape | undefined =
    REPAIR_BLOCK_SHAPES[curated.opcode as keyof typeof REPAIR_BLOCK_SHAPES]
  const checks = {
    categoryAndShape:
      repair !== undefined && categoryAndShapeParity(repair, curated),
    requiredFieldNames:
      repair !== undefined &&
      curated.optionalFields.length === 0 &&
      sameText(
        keys(repair.fields),
        curated.requiredFields.map((field) => field.name).sort(compareText)
      ),
    requiredInputNames:
      repair !== undefined &&
      curated.optionalInputs.length === 0 &&
      sameText(
        keys(repair.inputs),
        curated.requiredInputs.map((input) => input.name).sort(compareText)
      ),
    fieldReferenceSerialization:
      repair !== undefined && allFieldSerializationsMatch(repair, curated),
    inputReferenceAndShadowSerialization:
      repair !== undefined && allInputSerializationsMatch(repair, curated),
  }
  const compatible =
    curated.availability === 'supported' &&
    curated.safeBuilderKind === 'ordinaryBlock' &&
    Object.values(checks).every(Boolean)
  return {
    opcode: curated.opcode,
    disposition: compatible ? 'compatible' : 'excluded',
    reason: compatible
      ? 'category, shape, exact member sets, and reference serialization are mechanically identical'
      : exclusionReason(repair, curated, checks),
    repairShape: repair ?? null,
    repairRequiredFieldNames: keys(repair?.fields),
    repairRequiredInputNames: keys(repair?.inputs),
    curatedCategory: curated.category,
    curatedShape: curated.shape,
    curatedAvailability: curated.availability,
    curatedRequiredFields: curated.requiredFields,
    curatedOptionalFields: curated.optionalFields,
    curatedRequiredInputs: curated.requiredInputs,
    curatedOptionalInputs: curated.optionalInputs,
    checks,
  }
}

const ROWS = VANILLA_CORE_DESCRIPTORS.map(buildRow)
const LEGACY_REPAIR_BLOCK_REGISTRY_SHA256 = semanticHashV1(
  'capability-profile',
  {
    component: 'legacy-repair-block-registry',
    schemaVersion: 1,
    value: REPAIR_BLOCK_SHAPES,
  }
)
const PROFILE_PROJECTION = {
  schemaVersion: 1 as const,
  profileId: REPAIR_CORE_COMPATIBILITY_PROFILE_ID,
  profileVersion: REPAIR_CORE_COMPATIBILITY_PROFILE_VERSION,
  authority: 'mechanical-comparison-of-frozen-runtime-catalogs' as const,
  comparisonDimensions: [
    'opcode',
    'category-and-graph-shape',
    'required-and-optional-field-names',
    'required-and-optional-input-names',
    'field-reference-serialization',
    'input-reference-and-shadow-serialization',
  ] as const,
  legacyRepairOpcodeCount: Object.keys(REPAIR_BLOCK_SHAPES).length,
  legacyRepairRegistrySha256: LEGACY_REPAIR_BLOCK_REGISTRY_SHA256,
  curatedOpcodeCount: VANILLA_CORE_DESCRIPTORS.length,
  curatedDescriptorProfileSha256:
    CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.descriptorProfileSha256,
  compatibleOpcodeCount: ROWS.filter((row) => row.disposition === 'compatible')
    .length,
  excludedOpcodeCount: ROWS.filter((row) => row.disposition === 'excluded')
    .length,
  rows: ROWS,
}

const REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256 = semanticHashV1(
  'capability-profile',
  PROFILE_PROJECTION
)

export const REPAIR_CORE_COMPATIBILITY_PROFILE_V1 = deepFreeze({
  ...PROFILE_PROJECTION,
  profileSha256: REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256,
})

const ROW_BY_OPCODE = new Map(
  REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows.map((row) => [row.opcode, row])
)

function repairCoreCompatibilityRowV1(
  opcode: string
): RepairCoreCompatibilityRowV1 | null
{
  return ROW_BY_OPCODE.get(opcode) ?? null
}

export function repairCoreCompatibleShapeV1(
  opcode: string
): RepairBlockShape | undefined
{
  const row = repairCoreCompatibilityRowV1(opcode)
  return row?.disposition === 'compatible' && row.repairShape !== null
    ? row.repairShape
    : undefined
}

export function assertRepairCoreCompatibilityProfileV1(): void
{
  if (
    REPAIR_CORE_COMPATIBILITY_PROFILE_V1.curatedOpcodeCount !== 13 ||
    REPAIR_CORE_COMPATIBILITY_PROFILE_V1.compatibleOpcodeCount !== 3 ||
    REPAIR_CORE_COMPATIBILITY_PROFILE_V1.excludedOpcodeCount !== 10
  )
    throw new Error('repair/core compatibility profile cardinality drifted')
  const compatible = REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows
    .filter((row) => row.disposition === 'compatible')
    .map((row) => row.opcode)
  if (
    !sameText(compatible.sort(compareText), [
      'event_broadcast',
      'event_whenbroadcastreceived',
      'event_whenflagclicked',
    ])
  )
    throw new Error('repair/core compatible opcode set drifted')
  for (const row of REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows)
  {
    if (row.disposition === 'compatible')
    {
      if (!Object.values(row.checks).every(Boolean))
        throw new Error(`${row.opcode} has incomplete compatibility proof`)
    }
    else if (row.reason.length === 0)
      throw new Error(`${row.opcode} has no compatibility exclusion reason`)
  }
  const recalculated = semanticHashV1('capability-profile', {
    schemaVersion: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.schemaVersion,
    profileId: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.profileId,
    profileVersion: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.profileVersion,
    authority: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.authority,
    comparisonDimensions:
      REPAIR_CORE_COMPATIBILITY_PROFILE_V1.comparisonDimensions,
    legacyRepairOpcodeCount:
      REPAIR_CORE_COMPATIBILITY_PROFILE_V1.legacyRepairOpcodeCount,
    legacyRepairRegistrySha256:
      REPAIR_CORE_COMPATIBILITY_PROFILE_V1.legacyRepairRegistrySha256,
    curatedOpcodeCount: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.curatedOpcodeCount,
    curatedDescriptorProfileSha256:
      REPAIR_CORE_COMPATIBILITY_PROFILE_V1.curatedDescriptorProfileSha256,
    compatibleOpcodeCount:
      REPAIR_CORE_COMPATIBILITY_PROFILE_V1.compatibleOpcodeCount,
    excludedOpcodeCount:
      REPAIR_CORE_COMPATIBILITY_PROFILE_V1.excludedOpcodeCount,
    rows: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows,
  })
  if (recalculated !== REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256)
    throw new Error('repair/core compatibility profile hash drifted')
  if (
    REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256 !==
    APPROVED_REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256
  )
    throw new Error('repair/core compatibility profile is not approved')
}

assertRepairCoreCompatibilityProfileV1()
