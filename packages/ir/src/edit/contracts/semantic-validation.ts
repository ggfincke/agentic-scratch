// packages/ir/src/edit/contracts/semantic-validation.ts
// deterministic cross-field validation for the semantic contract

import { canonicalJsonV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { jsonPointerPart } from '../../project/project-vocabulary.js'
import {
  OPERATION_REVIEW_ROWS,
  type OperationKind,
  type OperationReviewRow,
} from './contract-data.js'
import {
  VANILLA_CORE_DESCRIPTORS,
  type DescriptorInput,
  type VanillaCoreDescriptor,
} from './catalog.js'
import {
  contractDefinitionSchemaModel,
  operationSchemaModel,
} from './contract-model.js'
import { compareLexicalTextV1 as compareText } from '../support/lexical-order.js'
import {
  validateSchemaValue,
  type SchemaModel,
  type SchemaNode,
} from './schema-model.js'
import {
  PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1,
  type ProcedureParameterTypeV1,
} from './procedure-parameter-catalog.js'

const UTF8 = new TextEncoder()

export const SEMANTIC_VALIDATION_ISSUE_CODES = [
  'semantic.cycle',
  'semantic.depth_exceeded',
  'semantic.container_members_exceeded',
  'semantic.total_members_exceeded',
  'semantic.total_nodes_exceeded',
  'contract.binding_key_duplicate',
  'contract.binding_identity_duplicate',
  'contract.binding_reference_missing',
  'contract.binding_reference_mismatch',
  'contract.future_creator_operation_not_allowed',
  'contract.scope_operation_not_allowed',
  'contract.policy_binding_id_duplicate',
  'contract.policy_identity_duplicate',
  'contract.policy_reference_missing',
  'contract.policy_reference_ambiguous',
  'contract.policy_reference_kind',
  'contract.scenario_binding_unreferenced',
  'contract.operation_kind_duplicate',
  'contract.allowance_id_duplicate',
  'contract.mask_id_duplicate',
  'contract.plan_id_duplicate',
  'contract.limit_key_duplicate',
  'contract.delta_contains_missing',
  'contract.export_plan_count',
  'contract.export_plan_id_mismatch',
  'contract.lane_missing',
  'contract.lane_duplicate',
  'contract.lane_unknown',
  'contract.required_lane_unreferenced',
  'contract.nonrequired_lane_referenced',
  'contract.export_preflight_not_required',
  'contract.export_execution_lane_missing',
  'contract.runtime_objective_lane_duplicate',
  'contract.runtime_objective_mismatch',
  'contract.runtime_change_not_positive',
  'contract.lane_kind_mismatch',
  'contract.behavioral_runtime_change_missing',
  'contract.structural_metadata_operation_invalid',
  'contract.mask_reference_missing',
  'contract.mask_reference_kind',
  'contract.mask_reference_scenario',
  'contract.mask_unreferenced',
  'policy.fixed_date_not_safe_integer',
  'policy.tick_range_reversed',
  'policy.normalized_region_invalid',
  'batch.op_id_duplicate',
  'batch.operation_kind_unknown',
  'batch.created_ref_creator_missing',
  'batch.created_ref_not_backward',
  'batch.created_ref_creator_ambiguous',
  'batch.created_ref_slot_missing',
  'batch.created_ref_slot_key_missing',
  'batch.created_ref_entity_kind',
  'batch.occurrence_selection_not_allowed',
  'batch.occurrence_selection_cardinality',
  'batch.occurrence_selection_out_of_range',
  'batch.exactly_one_cardinality',
  'batch.dynamic_key_duplicate',
  'batch.dynamic_key_not_declared',
  'batch.local_reference_missing',
  'batch.procedure_local_reference_context',
  'batch.self_procedure_context',
  'batch.property_duplicate',
  'procedure.label_missing',
  'procedure.label_adjacent',
  'procedure.label_noncanonical',
  'procedure.parameter_key_duplicate',
  'procedure.parameter_name_duplicate',
  'procedure.parameter_type_invalid',
  'procedure.parameter_default_type',
  'procedure.fragment_byte_limit',
  'procedure.parameter_limit',
  'procedure.proccode_limit',
  'procedure.parameter_lineage_mismatch',
  'procedure.retained_parameter_duplicate',
  'procedure.mapping_parameter_unknown',
  'procedure.mapping_lineage_mismatch',
  'procedure.removed_parameter_retained',
  'procedure.call_source_lineage_mismatch',
  'procedure.call_argument_type',
  'procedure.call_mapping_mismatch',
  'block.node_limit',
  'block.tree_depth_exceeded',
  'block.node_kind_unknown',
  'block.ordinary_opcode_procedure_internal',
  'block.ordinary_opcode_unadvertised',
  'block.ordinary_opcode_not_authorable',
  'block.context_invalid',
  'block.cap_not_last',
  'block.field_name_duplicate',
  'block.field_missing',
  'block.field_unknown',
  'block.field_value_kind',
  'block.entity_subtype_mismatch',
  'block.input_name_duplicate',
  'block.input_missing',
  'block.input_unknown',
  'block.input_value_kind',
  'block.empty_required_input',
  'block.owner_target_invalid',
  'block.procedure_argument_duplicate',
  'block.self_call_argument_mismatch',
  'media.placement_coordinates_missing',
  'media.placement_coordinates_forbidden',
  'display.identity_length_mismatch',
  'display.identity_hash_mismatch',
  'display.kind_threshold',
  'display.inline_value_mismatch',
  'display.escaped_prefix_invalid',
  'procedure.mapping_key_duplicate',
] as const

type SemanticValidationIssueCode =
  (typeof SEMANTIC_VALIDATION_ISSUE_CODES)[number]

export interface SemanticValidationIssue
{
  code: SemanticValidationIssueCode
  path: string
  message: string
}

export interface SemanticValidationResult
{
  valid: boolean
  issues: readonly SemanticValidationIssue[]
}

interface SemanticBatchInspectionV1
{
  readonly validation: SemanticValidationResult
  readonly metrics: {
    readonly describedBlockNodes: number
  }
}

interface StructuredValidationLimits
{
  maximumDepth: number
  maximumContainerMembers: number
  maximumTotalMembers: number | null
  maximumTotalNodes: number | null
}

interface SemanticBatchValidationLimits extends StructuredValidationLimits
{
  maximumBlockNodes: number
  maximumBlockTreeDepth: number
  maximumProcedureParameters: number
  maximumProcedureProccodeBytes: number
}

const CONTRACT_VALIDATION_LIMITS = {
  maximumDepth: 64,
  maximumContainerMembers: 16_384,
  maximumTotalMembers: null,
  maximumTotalNodes: 100_000,
} as const satisfies StructuredValidationLimits

const POLICY_VALIDATION_LIMITS = {
  maximumDepth: 8,
  maximumContainerMembers: 512,
  maximumTotalMembers: 512,
  maximumTotalNodes: null,
} as const satisfies StructuredValidationLimits

const SEMANTIC_BATCH_VALIDATION_LIMITS = {
  maximumDepth: 24,
  maximumContainerMembers: 4_096,
  maximumTotalMembers: null,
  maximumTotalNodes: null,
  maximumBlockNodes: 512,
  maximumBlockTreeDepth: 24,
  maximumProcedureParameters: 64,
  maximumProcedureProccodeBytes: 1_024,
} as const satisfies SemanticBatchValidationLimits

type JsonObject = Record<string, unknown>
type BlockContext = 'any' | 'statement' | 'reporter' | 'boolean' | 'eventHat'

// %s, %n & %b respectively; number is a first-class authorable type because the
// corpus uses %n heavily & canonicalizing it to %s would rewrite the proccode
type ProcedureParameterType = ProcedureParameterTypeV1

interface ValidationState
{
  issues: SemanticValidationIssue[]
  blockNodes: number
  blockLimitReported: boolean
  limits: SemanticBatchValidationLimits
  procedureParameters: ReadonlyMap<string, ProcedureParameterType>
  ownerTargetKind: 'stage' | 'sprite' | null
}

interface DynamicDeclaration
{
  slotKind: 'blockAlias' | 'parameter' | 'cloneAlias'
  key: string
  path: string
}

interface OperationMetadata
{
  operation: JsonObject
  path: string
  row: OperationReviewRow | null
  declarations: readonly DynamicDeclaration[]
  declarationKeys: ReadonlyMap<string, DynamicDeclaration>
  procedureParameters: ReadonlyMap<string, ProcedureParameterType>
}

type PolicyBindingKind =
  | 'scenario'
  | 'runtime'
  | 'observation'
  | 'lens'
  | 'nativeEvidence'
  | 'visualCriterion'
  | 'confidence'

interface PolicyBindingIdentity
{
  kind: unknown
  path: string
}

const REQUIRED_LANES = [
  'projectPreflight',
  'officialHeadless',
  'turboWarpBrowser',
  'officialBrowser',
  'renderedDifferential',
  'nativeVisual',
] as const

const EXECUTION_LANES = new Set([
  'officialHeadless',
  'turboWarpBrowser',
  'officialBrowser',
])

const STRUCTURAL_METADATA_OPERATION_KINDS = new Set<OperationKind>([
  'script.moveWorkspace',
  'comment.add',
  'comment.updateText',
  'comment.move',
  'comment.attach',
  'comment.detach',
  'comment.remove',
])

const PROCEDURE_INTERNAL_OPCODES = new Set([
  'procedures_definition',
  'procedures_prototype',
  'procedures_call',
  'argument_reporter_string_number',
  'argument_reporter_boolean',
])

const FIXED_SLOT_ENTITY_KINDS: Readonly<Record<string, string>> = {
  target: 'target',
  declaration: 'declaration',
  script: 'script',
  rootBlock: 'block',
  destinationScript: 'script',
  sourceGapRootBlock: 'block',
  comment: 'comment',
  procedure: 'procedure',
  definitionScript: 'script',
  media: 'media',
}

const DYNAMIC_SLOT_ENTITY_KINDS: Readonly<Record<string, string>> = {
  blockAlias: 'block',
  parameter: 'parameter',
  cloneAlias: 'block',
}

const DESCRIPTOR_BY_OPCODE: ReadonlyMap<string, VanillaCoreDescriptor> =
  new Map(
    VANILLA_CORE_DESCRIPTORS.map(
      (descriptor) => [descriptor.opcode, descriptor] as const
    )
  )

type DescriptorField = VanillaCoreDescriptor['requiredFields'][number]

interface NamedMemberValidatorMetadata<TDescriptor>
{
  readonly requiredNames: readonly string[]
  readonly optionalNames: readonly string[]
  readonly allowedNames: ReadonlySet<string>
  readonly byName: ReadonlyMap<string, TDescriptor>
}

interface DescriptorValidatorMetadata
{
  readonly descriptor: VanillaCoreDescriptor
  readonly fields: NamedMemberValidatorMetadata<DescriptorField>
  readonly inputs: NamedMemberValidatorMetadata<DescriptorInput>
}

function namedMemberValidatorMetadata<TDescriptor extends { name: string }>(
  required: readonly TDescriptor[],
  optional: readonly TDescriptor[]
): NamedMemberValidatorMetadata<TDescriptor>
{
  const requiredNames = Object.freeze(required.map((entry) => entry.name))
  const optionalNames = Object.freeze(optional.map((entry) => entry.name))
  return Object.freeze({
    requiredNames,
    optionalNames,
    allowedNames: new Set([...requiredNames, ...optionalNames]),
    byName: new Map(
      [...required, ...optional].map((entry) => [entry.name, entry] as const)
    ),
  })
}

const DESCRIPTOR_VALIDATOR_METADATA_BY_OPCODE: ReadonlyMap<
  string,
  DescriptorValidatorMetadata
> = new Map(
  VANILLA_CORE_DESCRIPTORS.map((descriptor) => [
    descriptor.opcode,
    Object.freeze({
      descriptor,
      fields: namedMemberValidatorMetadata<DescriptorField>(
        descriptor.requiredFields,
        descriptor.optionalFields
      ),
      inputs: namedMemberValidatorMetadata<DescriptorInput>(
        descriptor.requiredInputs,
        descriptor.optionalInputs
      ),
    }),
  ])
)

const OPERATION_BY_KIND = new Map(
  OPERATION_REVIEW_ROWS.map((row) => [row.kind, row] as const)
)

if (
  VANILLA_CORE_DESCRIPTORS.length !== 13 ||
  DESCRIPTOR_BY_OPCODE.size !== VANILLA_CORE_DESCRIPTORS.length ||
  DESCRIPTOR_VALIDATOR_METADATA_BY_OPCODE.size !==
    VANILLA_CORE_DESCRIPTORS.length
)
{
  throw new Error(
    'the Phase 8 semantic validator requires 13 unique descriptors'
  )
}

function isObject(value: unknown): value is JsonObject
{
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointer(path: string, member: string | number): string
{
  return `${path}/${jsonPointerPart(member)}`
}

function addIssue(
  issues: SemanticValidationIssue[],
  code: SemanticValidationIssueCode,
  path: string,
  message: string
): void
{
  issues.push({ code, path: path || '/', message })
}

function finish(issues: SemanticValidationIssue[]): SemanticValidationResult
{
  const ordered = [...issues].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message)
  )
  return { valid: ordered.length === 0, issues: ordered }
}

function semanticKey(value: unknown): string | null
{
  try
  {
    return canonicalJsonV1(value)
  }
  catch
  {
    return null
  }
}

function entityReferenceIdentity(value: unknown): string | null
{
  if (!isObject(value)) return semanticKey(value)
  if (value.refKind === 'handle' && typeof value.token === 'string')
  {
    return semanticKey({
      refKind: 'handle',
      entityKind: value.entityKind,
      token: value.token,
    })
  }
  if (value.refKind === 'created' && typeof value.opId === 'string')
  {
    return semanticKey({
      refKind: 'created',
      entityKind: value.entityKind,
      opId: value.opId,
      slot: value.slot,
    })
  }
  if (
    value.refKind === 'structural' &&
    value.selectorKind === 'exactLocation'
  )
  {
    return semanticKey({
      refKind: 'structural',
      selectorKind: 'exactLocation',
      entityKind: value.entityKind,
      locationIdentity:
        value.expectedFullLocationSha256 ?? value.location ?? null,
    })
  }
  if (value.refKind === 'structural' && value.selectorKind === 'matchSet')
  {
    return semanticKey({
      refKind: 'structural',
      selectorKind: 'matchSet',
      entityKind: value.entityKind,
      selectedLocationIdentity:
        value.expectedSelectedFullLocationSha256 ?? value.selection ?? null,
    })
  }
  if (
    value.refKind === 'procedureLocalParameter' &&
    typeof value.localKey === 'string'
  )
  {
    return semanticKey({ refKind: value.refKind, localKey: value.localKey })
  }
  if (value.refKind === 'selfProcedure')
  {
    return semanticKey({ refKind: value.refKind })
  }
  return semanticKey(value)
}

function objectWithout(
  value: JsonObject,
  omittedKeys: ReadonlySet<string>
): JsonObject
{
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omittedKeys.has(key))
  )
}

interface ExactStringIdentityV1
{
  canonicalJsonStringByteLength: number
  valueSha256: string
}

interface StringIdentityGoldenVector
{
  id:
    'lone-high-surrogate' | 'lone-low-surrogate' | 'valid-pair' | 'replacement'
  sourceValue: string
  canonicalJsonString: string
  canonicalJsonStringByteLength: number
  valueSha256: string
  display: Readonly<JsonObject>
  identity: Readonly<ExactStringIdentityV1>
}

function exactStringIdentity(value: string): {
  identity: ExactStringIdentityV1
  canonical: string
}
{
  const canonical = canonicalJsonV1(value)
  const bytes = UTF8.encode(canonical)
  return {
    canonical,
    identity: {
      canonicalJsonStringByteLength: bytes.byteLength,
      valueSha256: sha256Hex(bytes),
    },
  }
}

export function expectedStringIdentityV1(value: string): ExactStringIdentityV1
{
  return exactStringIdentity(value).identity
}

export function boundedDisplayStringV1(value: string): Readonly<JsonObject>
{
  const { canonical, identity } = exactStringIdentity(value)
  if (identity.canonicalJsonStringByteLength <= 256)
  {
    return { displayKind: 'inline', value, ...identity }
  }
  let asciiPrefix = ''
  for (const character of canonical)
  {
    if (character.charCodeAt(0) > 0x7f || asciiPrefix.length >= 64) break
    asciiPrefix += character
  }
  return {
    displayKind: 'hashOnly',
    ...identity,
    ...(asciiPrefix.length > 0 ? { escapedPrefix: asciiPrefix } : {}),
  }
}

function validateExactStringIdentityInto(
  identity: JsonObject,
  sourceValue: string,
  path: string,
  issues: SemanticValidationIssue[]
): { canonical: string; byteLength: number }
{
  const expected = exactStringIdentity(sourceValue)
  if (
    identity.canonicalJsonStringByteLength !==
    expected.identity.canonicalJsonStringByteLength
  )
  {
    addIssue(
      issues,
      'display.identity_length_mismatch',
      pointer(path, 'canonicalJsonStringByteLength'),
      'canonical JSON string-literal byte length does not match the source value'
    )
  }
  if (identity.valueSha256 !== expected.identity.valueSha256)
  {
    addIssue(
      issues,
      'display.identity_hash_mismatch',
      pointer(path, 'valueSha256'),
      'canonical JSON string-literal SHA-256 does not match the source value'
    )
  }
  return {
    canonical: expected.canonical,
    byteLength: expected.identity.canonicalJsonStringByteLength,
  }
}

export function validateExpectedStringIdentity(
  value: unknown,
  sourceValue: string
): SemanticValidationResult
{
  const issues: SemanticValidationIssue[] = []
  if (isObject(value))
  {
    validateExactStringIdentityInto(value, sourceValue, '', issues)
  }
  return finish(issues)
}

export function validateBoundedDisplayString(
  value: unknown,
  sourceValue?: string
): SemanticValidationResult
{
  const issues: SemanticValidationIssue[] = []
  if (!isObject(value)) return finish(issues)
  const effectiveSource =
    sourceValue ??
    (value.displayKind === 'inline' && typeof value.value === 'string'
      ? value.value
      : undefined)
  if (
    sourceValue !== undefined &&
    value.displayKind === 'inline' &&
    value.value !== sourceValue
  )
  {
    addIssue(
      issues,
      'display.inline_value_mismatch',
      '/value',
      'inline display value must preserve the exact UTF-16 code units'
    )
  }
  if (effectiveSource === undefined) return finish(issues)

  const identity = validateExactStringIdentityInto(
    value,
    effectiveSource,
    '',
    issues
  )
  const expectedKind = identity.byteLength <= 256 ? 'inline' : 'hashOnly'
  if (value.displayKind !== expectedKind)
  {
    addIssue(
      issues,
      'display.kind_threshold',
      '/displayKind',
      'inline is required through 256 canonical bytes and hashOnly above it'
    )
  }
  if (value.escapedPrefix !== undefined)
  {
    const prefix = value.escapedPrefix
    const valid =
      value.displayKind === 'hashOnly' &&
      typeof prefix === 'string' &&
      prefix.length <= 64 &&
      [...prefix].every((character) => character.charCodeAt(0) <= 0x7f) &&
      identity.canonical.startsWith(prefix)
    if (!valid)
    {
      addIssue(
        issues,
        'display.escaped_prefix_invalid',
        '/escapedPrefix',
        'escapedPrefix must be an inert ASCII prefix of the canonical string literal'
      )
    }
  }
  return finish(issues)
}

const STRING_IDENTITY_GOLDEN_EXPECTATIONS = [
  {
    id: 'lone-high-surrogate',
    sourceValue: '\ud800',
    canonicalJsonString: '"\\ud800"',
    canonicalJsonStringByteLength: 8,
    valueSha256:
      '8c0c59dd0d275aadcd462a5fe12eb352cbdfeaf961eae4f85a4660521df7d2f5',
  },
  {
    id: 'lone-low-surrogate',
    sourceValue: '\udc00',
    canonicalJsonString: '"\\udc00"',
    canonicalJsonStringByteLength: 8,
    valueSha256:
      '353c7370beca95e64c258c908edac60c2ab30d355ca1b5b7fc31c5bce4a4c65a',
  },
  {
    id: 'valid-pair',
    sourceValue: '\ud83d\ude00',
    canonicalJsonString: '"\ud83d\ude00"',
    canonicalJsonStringByteLength: 6,
    valueSha256:
      '7a0c50b92434b015545fe93ab723db2d4b2cdd14a441405624a9ce8be29f1d5a',
  },
  {
    id: 'replacement',
    sourceValue: '\ufffd',
    canonicalJsonString: '"\ufffd"',
    canonicalJsonStringByteLength: 5,
    valueSha256:
      '568601070314e0f4489c9944b3c151d5251d379330008293bb7e1a826a22a845',
  },
] as const

export const STRING_IDENTITY_GOLDEN_VECTORS =
  STRING_IDENTITY_GOLDEN_EXPECTATIONS.map((expected) =>
  {
    const exact = exactStringIdentity(expected.sourceValue)
    if (
      exact.canonical !== expected.canonicalJsonString ||
      exact.identity.canonicalJsonStringByteLength !==
        expected.canonicalJsonStringByteLength ||
      exact.identity.valueSha256 !== expected.valueSha256
    )
    {
      throw new Error(`exact string identity drifted for ${expected.id}`)
    }
    return {
      ...expected,
      display: boundedDisplayStringV1(expected.sourceValue),
      identity: exact.identity,
    }
  }) satisfies readonly StringIdentityGoldenVector[]

interface StringIdentityValidationVector
{
  id: string
  domain: 'expectedStringIdentity' | 'boundedDisplayString'
  sourceValue: string
  value: unknown
  expectedValid: boolean
  expectedIssueCodes: readonly SemanticValidationIssueCode[]
}

export const STRING_IDENTITY_VALIDATION_VECTORS = [
  {
    id: 'valid-lone-high-surrogate-identity',
    domain: 'expectedStringIdentity',
    sourceValue: '\ud800',
    value: STRING_IDENTITY_GOLDEN_VECTORS[0]?.identity,
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'replacement-identity-cannot-stand-for-lone-high-surrogate',
    domain: 'expectedStringIdentity',
    sourceValue: '\ud800',
    value: STRING_IDENTITY_GOLDEN_VECTORS[3]?.identity,
    expectedValid: false,
    expectedIssueCodes: [
      'display.identity_length_mismatch',
      'display.identity_hash_mismatch',
    ],
  },
  {
    id: 'valid-257-byte-canonical-display-transition',
    domain: 'boundedDisplayString',
    sourceValue: 'a'.repeat(255),
    value: boundedDisplayStringV1('a'.repeat(255)),
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'inline-display-cannot-cross-256-byte-canonical-threshold',
    domain: 'boundedDisplayString',
    sourceValue: 'a'.repeat(255),
    value: {
      displayKind: 'inline',
      value: 'a'.repeat(255),
      ...expectedStringIdentityV1('a'.repeat(255)),
    },
    expectedValid: false,
    expectedIssueCodes: ['display.kind_threshold'],
  },
] as const satisfies readonly StringIdentityValidationVector[]

export const BOUNDED_DISPLAY_TRANSITION_VECTORS = [
  {
    id: 'canonical-256-bytes-inline',
    sourceValue: 'a'.repeat(254),
    expectedDisplayKind: 'inline',
    display: boundedDisplayStringV1('a'.repeat(254)),
  },
  {
    id: 'canonical-257-bytes-hash-only',
    sourceValue: 'a'.repeat(255),
    expectedDisplayKind: 'hashOnly',
    display: boundedDisplayStringV1('a'.repeat(255)),
  },
] as const

function mergeLimits<T extends StructuredValidationLimits>(
  defaults: T,
  overrides: Partial<T> | undefined
): T
{
  return { ...defaults, ...overrides }
}

function validateStructuredBounds(
  value: unknown,
  limits: StructuredValidationLimits,
  issues: SemanticValidationIssue[]
): void
{
  let totalMembers = 0
  let totalNodes = 0
  let totalMemberReported = false
  let totalNodeReported = false
  const ancestors = new Set<object>()

  const visit = (current: unknown, path: string, depth: number): void =>
  {
    totalNodes += 1
    if (
      limits.maximumTotalNodes !== null &&
      totalNodes > limits.maximumTotalNodes &&
      !totalNodeReported
    )
    {
      totalNodeReported = true
      addIssue(
        issues,
        'semantic.total_nodes_exceeded',
        path,
        `total nodes exceed ${limits.maximumTotalNodes}`
      )
    }

    if (!Array.isArray(current) && !isObject(current)) return
    if (ancestors.has(current))
    {
      addIssue(
        issues,
        'semantic.cycle',
        path,
        'structured value contains a cycle'
      )
      return
    }
    if (depth > limits.maximumDepth)
    {
      addIssue(
        issues,
        'semantic.depth_exceeded',
        path,
        `nesting depth exceeds ${limits.maximumDepth}`
      )
      return
    }

    const keys = Array.isArray(current)
      ? current.map((_item, index) => String(index))
      : Object.keys(current).sort()
    if (keys.length > limits.maximumContainerMembers)
    {
      addIssue(
        issues,
        'semantic.container_members_exceeded',
        path,
        `container members exceed ${limits.maximumContainerMembers}`
      )
    }
    totalMembers += keys.length
    if (
      limits.maximumTotalMembers !== null &&
      totalMembers > limits.maximumTotalMembers &&
      !totalMemberReported
    )
    {
      totalMemberReported = true
      addIssue(
        issues,
        'semantic.total_members_exceeded',
        path,
        `total members exceed ${limits.maximumTotalMembers}`
      )
    }

    ancestors.add(current)
    for (const key of keys)
    {
      const child = Array.isArray(current) ? current[Number(key)] : current[key]
      visit(child, pointer(path, key), depth + 1)
    }
    ancestors.delete(current)
  }

  visit(value, '', 1)
}

function duplicateStringProperties(
  items: unknown,
  property: string,
  path: string,
  code: SemanticValidationIssueCode,
  issues: SemanticValidationIssue[]
): void
{
  if (!Array.isArray(items)) return
  const first = new Map<string, number>()
  for (let index = 0; index < items.length; index += 1)
  {
    const item = items[index]
    if (!isObject(item) || typeof item[property] !== 'string') continue
    const key = item[property]
    if (first.has(key))
    {
      addIssue(
        issues,
        code,
        pointer(pointer(path, index), property),
        `${property} duplicates ${pointer(path, first.get(key) ?? 0)}`
      )
    }
    else
    {
      first.set(key, index)
    }
  }
}

function walkObjects(
  value: unknown,
  visit: (object: JsonObject, path: string) => void,
  path = '',
  ancestors = new Set<object>()
): void
{
  if (Array.isArray(value))
  {
    if (ancestors.has(value)) return
    ancestors.add(value)
    for (let index = 0; index < value.length; index += 1)
    {
      walkObjects(value[index], visit, pointer(path, index), ancestors)
    }
    ancestors.delete(value)
    return
  }
  if (!isObject(value) || ancestors.has(value)) return
  visit(value, path)
  ancestors.add(value)
  for (const key of Object.keys(value).sort())
  {
    walkObjects(value[key], visit, pointer(path, key), ancestors)
  }
  ancestors.delete(value)
}

function validateCommonPolicyInvariants(
  value: unknown,
  issues: SemanticValidationIssue[]
): void
{
  walkObjects(value, (object, path) =>
  {
    if (object.displayKind === 'inline' && typeof object.value === 'string')
    {
      const displayResult = validateBoundedDisplayString(object)
      for (const issue of displayResult.issues)
      {
        addIssue(
          issues,
          issue.code,
          issue.path === '/' ? path : `${path}${issue.path}`,
          issue.message
        )
      }
    }
    if (
      Object.hasOwn(object, 'fixedDateMs') &&
      (!Number.isSafeInteger(object.fixedDateMs) ||
        Object.is(object.fixedDateMs, -0))
    )
    {
      addIssue(
        issues,
        'policy.fixed_date_not_safe_integer',
        pointer(path, 'fixedDateMs'),
        'fixedDateMs must be a non-negative-zero safe integer'
      )
    }

    if (
      object.windowKind === 'tickRange' &&
      typeof object.firstTick === 'number' &&
      typeof object.lastTick === 'number' &&
      object.firstTick > object.lastTick
    )
    {
      addIssue(
        issues,
        'policy.tick_range_reversed',
        path,
        'tick range firstTick must not exceed lastTick'
      )
    }

    if (isObject(object.normalizedRegion))
    {
      validateNormalizedRegion(
        object.normalizedRegion,
        pointer(path, 'normalizedRegion'),
        issues
      )
    }
    if (object.kind === 'visualCriterion' && isObject(object.region))
    {
      validateNormalizedRegion(object.region, pointer(path, 'region'), issues)
    }
  })
}

function validateNormalizedRegion(
  region: JsonObject,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  const { x, y, width, height } = region
  const valid =
    [x, y, width, height].every(
      (value) => typeof value === 'number' && Number.isFinite(value)
    ) &&
    (x as number) >= 0 &&
    (y as number) >= 0 &&
    (width as number) > 0 &&
    (height as number) > 0 &&
    (x as number) + (width as number) <= 1 &&
    (y as number) + (height as number) <= 1
  if (!valid)
  {
    addIssue(
      issues,
      'policy.normalized_region_invalid',
      path,
      'normalized region must be finite, positive, and wholly inside 0..1'
    )
  }
}

interface ContractBindingIdentity
{
  bindingKind: unknown
  entityKind: unknown
  entitySubtype: unknown
}

function validateContractBindingReferences(
  contract: JsonObject,
  issues: SemanticValidationIssue[]
): void
{
  const bindings = new Map<string, ContractBindingIdentity[]>()
  if (Array.isArray(contract.entityBindings))
  {
    for (const binding of contract.entityBindings)
    {
      if (!isObject(binding) || typeof binding.bindingKey !== 'string') continue
      const identities = bindings.get(binding.bindingKey) ?? []
      identities.push({
        bindingKind: binding.bindingKind,
        entityKind: binding.entityKind,
        entitySubtype: binding.entitySubtype,
      })
      bindings.set(binding.bindingKey, identities)
    }
  }

  walkObjects(contract, (object, path) =>
  {
    if (
      typeof object.contractRefKind !== 'string' ||
      typeof object.bindingKey !== 'string'
    )
    {
      return
    }
    const matches = bindings.get(object.bindingKey) ?? []
    if (matches.length === 0)
    {
      addIssue(
        issues,
        'contract.binding_reference_missing',
        pointer(path, 'bindingKey'),
        'contract reference does not name an entity binding'
      )
      return
    }
    const exact = matches.filter(
      (binding) =>
        binding.bindingKind === object.contractRefKind &&
        binding.entityKind === object.entityKind &&
        binding.entitySubtype === object.entitySubtype
    )
    if (exact.length !== 1)
    {
      addIssue(
        issues,
        'contract.binding_reference_mismatch',
        path,
        'reference discriminator, entity kind, and subtype must match one binding'
      )
    }
  })
}

function validateContractBindingIdentities(
  contract: JsonObject,
  allowedOperationKinds: ReadonlySet<string>,
  issues: SemanticValidationIssue[]
): void
{
  const bindings = Array.isArray(contract.entityBindings)
    ? contract.entityBindings
    : []
  const firstIdentity = new Map<string, string>()
  for (let index = 0; index < bindings.length; index += 1)
  {
    const binding = bindings[index]
    if (!isObject(binding)) continue
    const path = pointer('/entityBindings', index)
    const identity = semanticKey(
      binding.bindingKind === 'existing'
        ? {
            bindingKind: binding.bindingKind,
            entityKind: binding.entityKind,
            entitySubtype: binding.entitySubtype,
            sourceLocationSha256: binding.sourceLocationSha256,
          }
        : objectWithout(binding, new Set(['bindingKey']))
    )
    if (identity !== null)
    {
      const prior = firstIdentity.get(identity)
      if (prior !== undefined)
      {
        addIssue(
          issues,
          'contract.binding_identity_duplicate',
          path,
          `entity binding duplicates the semantic identity at ${prior}`
        )
      }
      else
      {
        firstIdentity.set(identity, path)
      }
    }
    if (
      binding.bindingKind === 'future' &&
      typeof binding.expectedCreatorOperationKind === 'string' &&
      !allowedOperationKinds.has(binding.expectedCreatorOperationKind)
    )
    {
      addIssue(
        issues,
        'contract.future_creator_operation_not_allowed',
        pointer(path, 'expectedCreatorOperationKind'),
        'future binding creator must be in allowedOperationKinds'
      )
    }
  }

  const scopes = Array.isArray(contract.allowedSemanticScopes)
    ? contract.allowedSemanticScopes
    : []
  for (let index = 0; index < scopes.length; index += 1)
  {
    const scope = scopes[index]
    if (
      isObject(scope) &&
      typeof scope.operationKind === 'string' &&
      !allowedOperationKinds.has(scope.operationKind)
    )
    {
      addIssue(
        issues,
        'contract.scope_operation_not_allowed',
        pointer(pointer('/allowedSemanticScopes', index), 'operationKind'),
        'semantic scope operation must be in allowedOperationKinds'
      )
    }
  }
}

function collectPolicyBindings(
  contract: JsonObject,
  issues: SemanticValidationIssue[]
): Map<string, PolicyBindingIdentity[]>
{
  const result = new Map<string, PolicyBindingIdentity[]>()
  const bindings = Array.isArray(contract.policyBindings)
    ? contract.policyBindings
    : []
  for (let index = 0; index < bindings.length; index += 1)
  {
    const binding = bindings[index]
    if (!isObject(binding) || typeof binding.semanticSha256 !== 'string')
      continue
    const path = pointer('/policyBindings', index)
    const identities = result.get(binding.semanticSha256) ?? []
    if (identities.length > 0)
    {
      addIssue(
        issues,
        'contract.policy_identity_duplicate',
        pointer(path, 'semanticSha256'),
        `policy semantic identity duplicates ${identities[0]?.path ?? '/'}`
      )
    }
    identities.push({ kind: binding.kind, path })
    result.set(binding.semanticSha256, identities)
  }
  return result
}

function validatePolicyReference(
  value: unknown,
  expectedKind: PolicyBindingKind,
  path: string,
  bindings: ReadonlyMap<string, readonly PolicyBindingIdentity[]>,
  issues: SemanticValidationIssue[]
): void
{
  if (typeof value !== 'string') return
  const matches = bindings.get(value) ?? []
  if (matches.length === 0)
  {
    addIssue(
      issues,
      'contract.policy_reference_missing',
      path,
      `policy hash does not resolve a retained ${expectedKind} binding`
    )
    return
  }
  if (matches.length !== 1)
  {
    addIssue(
      issues,
      'contract.policy_reference_ambiguous',
      path,
      'policy hash resolves more than one retained binding'
    )
    return
  }
  if (matches[0]?.kind !== expectedKind)
  {
    addIssue(
      issues,
      'contract.policy_reference_kind',
      path,
      `policy hash resolves ${String(matches[0]?.kind)}, not ${expectedKind}`
    )
  }
}

function validatePlanPolicies(
  plan: JsonObject,
  planPath: string,
  bindings: ReadonlyMap<string, readonly PolicyBindingIdentity[]>,
  referencedScenarios: Set<string>,
  issues: SemanticValidationIssue[]
): void
{
  if (Array.isArray(plan.scenarioPolicySha256s))
  {
    for (let index = 0; index < plan.scenarioPolicySha256s.length; index += 1)
    {
      const value = plan.scenarioPolicySha256s[index]
      if (typeof value === 'string') referencedScenarios.add(value)
      validatePolicyReference(
        value,
        'scenario',
        pointer(pointer(planPath, 'scenarioPolicySha256s'), index),
        bindings,
        issues
      )
    }
  }
  validatePolicyReference(
    plan.runtimePolicySha256,
    'runtime',
    pointer(planPath, 'runtimePolicySha256'),
    bindings,
    issues
  )
  if (plan.nativeEvidencePolicySha256 !== undefined)
  {
    validatePolicyReference(
      plan.nativeEvidencePolicySha256,
      'nativeEvidence',
      pointer(planPath, 'nativeEvidencePolicySha256'),
      bindings,
      issues
    )
  }

  const predicates = Array.isArray(plan.requiredRuntimeChanges)
    ? plan.requiredRuntimeChanges
    : []
  for (let index = 0; index < predicates.length; index += 1)
  {
    const predicate = predicates[index]
    if (!isObject(predicate)) continue
    const path = pointer(pointer(planPath, 'requiredRuntimeChanges'), index)
    if (predicate.kind === 'visualCriterion')
    {
      validatePolicyReference(
        predicate.criterionPolicySha256,
        'visualCriterion',
        pointer(path, 'criterionPolicySha256'),
        bindings,
        issues
      )
      validatePolicyReference(
        predicate.confidencePolicySha256,
        'confidence',
        pointer(path, 'confidencePolicySha256'),
        bindings,
        issues
      )
    }
  }

  const lenses = Array.isArray(plan.preservationLenses)
    ? plan.preservationLenses
    : []
  for (let index = 0; index < lenses.length; index += 1)
  {
    const lens = lenses[index]
    if (!isObject(lens)) continue
    validatePolicyReference(
      lens.lensPolicySha256,
      'lens',
      pointer(
        pointer(pointer(planPath, 'preservationLenses'), index),
        'lensPolicySha256'
      ),
      bindings,
      issues
    )
  }
}

interface MaskIdentity
{
  family: 'state' | 'clone' | 'visual'
  scenarioId: unknown
}

function collectMaskIdentities(
  contract: JsonObject,
  issues: SemanticValidationIssue[]
): Map<string, MaskIdentity>
{
  const result = new Map<string, MaskIdentity>()
  const families = [
    ['stateProjectionMasks', 'state'],
    ['cloneProjectionMasks', 'clone'],
    ['visualProjectionMasks', 'visual'],
  ] as const
  const firstPath = new Map<string, string>()

  for (const [property, family] of families)
  {
    const items = contract[property]
    if (!Array.isArray(items)) continue
    for (let index = 0; index < items.length; index += 1)
    {
      const item = items[index]
      if (!isObject(item) || typeof item.maskId !== 'string') continue
      const path = pointer(pointer('', property), index)
      if (result.has(item.maskId))
      {
        addIssue(
          issues,
          'contract.mask_id_duplicate',
          pointer(path, 'maskId'),
          `maskId duplicates ${firstPath.get(item.maskId) ?? '/'}`
        )
      }
      else
      {
        result.set(item.maskId, { family, scenarioId: item.scenarioId })
        firstPath.set(item.maskId, path)
      }
    }
  }
  return result
}

function validateMaskReferences(
  plan: JsonObject,
  planPath: string,
  masks: ReadonlyMap<string, MaskIdentity>,
  referencedMasks: Set<string>,
  issues: SemanticValidationIssue[]
): void
{
  if (!Array.isArray(plan.preservationLenses)) return
  const properties = [
    ['stateMaskIds', 'state'],
    ['cloneMaskIds', 'clone'],
    ['visualMaskIds', 'visual'],
  ] as const

  for (
    let lensIndex = 0;
    lensIndex < plan.preservationLenses.length;
    lensIndex += 1
  )
  {
    const lens = plan.preservationLenses[lensIndex]
    if (!isObject(lens)) continue
    const lensPath = pointer(pointer(planPath, 'preservationLenses'), lensIndex)
    for (const [property, expectedFamily] of properties)
    {
      const ids = lens[property]
      if (!Array.isArray(ids)) continue
      for (let index = 0; index < ids.length; index += 1)
      {
        const id = ids[index]
        if (typeof id !== 'string') continue
        referencedMasks.add(id)
        const path = pointer(pointer(lensPath, property), index)
        const mask = masks.get(id)
        if (mask === undefined)
        {
          addIssue(
            issues,
            'contract.mask_reference_missing',
            path,
            'preservation lens references an unknown maskId'
          )
          continue
        }
        if (mask.family !== expectedFamily)
        {
          addIssue(
            issues,
            'contract.mask_reference_kind',
            path,
            `mask belongs to ${mask.family}, not ${expectedFamily}`
          )
        }
        if (mask.scenarioId !== lens.scenarioId)
        {
          addIssue(
            issues,
            'contract.mask_reference_scenario',
            path,
            'mask and preservation lens must name the same scenarioId'
          )
        }
      }
    }
  }
}

function validatePlanLanes(
  plan: JsonObject,
  planPath: string,
  requiredForExport: boolean,
  issues: SemanticValidationIssue[]
): void
{
  const rows = Array.isArray(plan.laneRequirements) ? plan.laneRequirements : []
  const requirement = new Map<string, string>()
  const first = new Map<string, number>()
  for (let index = 0; index < rows.length; index += 1)
  {
    const row = rows[index]
    if (!isObject(row) || typeof row.lane !== 'string') continue
    const path = pointer(pointer(planPath, 'laneRequirements'), index)
    if (!REQUIRED_LANES.includes(row.lane as (typeof REQUIRED_LANES)[number]))
    {
      addIssue(
        issues,
        'contract.lane_unknown',
        pointer(path, 'lane'),
        'lane is not one of the six frozen Phase 8 lanes'
      )
      continue
    }
    if (requirement.has(row.lane))
    {
      addIssue(
        issues,
        'contract.lane_duplicate',
        pointer(path, 'lane'),
        `lane duplicates row ${first.get(row.lane) ?? 0}`
      )
    }
    else
    {
      requirement.set(
        row.lane,
        typeof row.disposition === 'string' ? row.disposition : ''
      )
      first.set(row.lane, index)
    }
  }
  for (const lane of REQUIRED_LANES)
  {
    if (!requirement.has(lane))
    {
      addIssue(
        issues,
        'contract.lane_missing',
        pointer(planPath, 'laneRequirements'),
        `laneRequirements omits ${lane}`
      )
    }
  }

  const referenced = new Set<string>()
  for (const property of [
    'requiredRuntimeChanges',
    'preservationLenses',
  ] as const)
  {
    const items = plan[property]
    if (!Array.isArray(items)) continue
    for (let index = 0; index < items.length; index += 1)
    {
      const item = items[index]
      if (!isObject(item) || typeof item.lane !== 'string') continue
      referenced.add(item.lane)
      if (requirement.get(item.lane) !== 'required')
      {
        addIssue(
          issues,
          'contract.nonrequired_lane_referenced',
          pointer(pointer(pointer(planPath, property), index), 'lane'),
          'required predicate or lens must use a required lane'
        )
      }
    }
  }
  for (const [lane, disposition] of requirement)
  {
    if (
      lane !== 'projectPreflight' &&
      disposition === 'required' &&
      !referenced.has(lane)
    )
    {
      addIssue(
        issues,
        'contract.required_lane_unreferenced',
        pointer(planPath, 'laneRequirements'),
        `required lane ${lane} has no predicate or preservation lens`
      )
    }
  }

  if (requiredForExport)
  {
    if (requirement.get('projectPreflight') !== 'required')
    {
      addIssue(
        issues,
        'contract.export_preflight_not_required',
        pointer(planPath, 'laneRequirements'),
        'export plan must require projectPreflight'
      )
    }
    if (
      ![...EXECUTION_LANES].some((lane) => requirement.get(lane) === 'required')
    )
    {
      addIssue(
        issues,
        'contract.export_execution_lane_missing',
        pointer(planPath, 'laneRequirements'),
        'export plan must require an official or TurboWarp execution lane'
      )
    }
  }
}

function validatePlanRuntimeSemantics(
  plan: JsonObject,
  planPath: string,
  issues: SemanticValidationIssue[]
): void
{
  const predicates = Array.isArray(plan.requiredRuntimeChanges)
    ? plan.requiredRuntimeChanges
    : []
  const objectiveRows = new Map<
    string,
    { lanes: Set<string>; projection: string | null }
  >()

  for (let index = 0; index < predicates.length; index += 1)
  {
    const predicate = predicates[index]
    if (!isObject(predicate)) continue
    const path = pointer(pointer(planPath, 'requiredRuntimeChanges'), index)
    const lane = typeof predicate.lane === 'string' ? predicate.lane : ''
    const executionCompatible = EXECUTION_LANES.has(lane)
    const visualCompatible =
      executionCompatible ||
      lane === 'renderedDifferential' ||
      lane === 'nativeVisual'
    if (
      ((predicate.kind === 'stateAtLabel' ||
        predicate.kind === 'cloneCountAtTick' ||
        predicate.kind === 'runtimeOutcome') &&
        !executionCompatible) ||
      (predicate.kind === 'visualCriterion' && !visualCompatible)
    )
    {
      addIssue(
        issues,
        'contract.lane_kind_mismatch',
        pointer(path, 'lane'),
        `${String(predicate.kind)} is incompatible with lane ${lane}`
      )
    }

    if (predicate.kind === 'runtimeOutcome' && predicate.ok !== true)
    {
      addIssue(
        issues,
        'contract.runtime_change_not_positive',
        pointer(path, 'ok'),
        'required runtimeOutcome must require a successful candidate outcome'
      )
    }

    if (typeof predicate.objectiveId !== 'string') continue
    const projection = semanticKey(objectWithout(predicate, new Set(['lane'])))
    const prior = objectiveRows.get(predicate.objectiveId)
    if (prior === undefined)
    {
      objectiveRows.set(predicate.objectiveId, {
        lanes: new Set(lane === '' ? [] : [lane]),
        projection,
      })
      continue
    }
    if (lane !== '' && prior.lanes.has(lane))
    {
      addIssue(
        issues,
        'contract.runtime_objective_lane_duplicate',
        pointer(path, 'lane'),
        'one semantic objective may appear at most once in an evidence lane'
      )
    }
    if (lane !== '') prior.lanes.add(lane)
    if (prior.projection !== projection)
    {
      addIssue(
        issues,
        'contract.runtime_objective_mismatch',
        path,
        'rows sharing an objectiveId must describe the same predicate outside lane'
      )
    }
  }

  const lenses = Array.isArray(plan.preservationLenses)
    ? plan.preservationLenses
    : []
  for (let index = 0; index < lenses.length; index += 1)
  {
    const lens = lenses[index]
    if (!isObject(lens) || typeof lens.lane !== 'string') continue
    const executionCompatible = EXECUTION_LANES.has(lens.lane)
    const valid =
      (lens.lensKind === 'visualKeyframes' &&
        lens.lane === 'renderedDifferential') ||
      (lens.lensKind !== 'visualKeyframes' && executionCompatible)
    if (!valid)
    {
      addIssue(
        issues,
        'contract.lane_kind_mismatch',
        pointer(
          pointer(pointer(planPath, 'preservationLenses'), index),
          'lane'
        ),
        `${String(lens.lensKind)} is incompatible with lane ${lens.lane}`
      )
    }
  }
}

export function validateSemanticChangeContract(
  value: unknown,
  limitOverrides?: Partial<StructuredValidationLimits>
): SemanticValidationResult
{
  const issues: SemanticValidationIssue[] = []
  const limits = mergeLimits(CONTRACT_VALIDATION_LIMITS, limitOverrides)
  validateStructuredBounds(value, limits, issues)
  validateCommonPolicyInvariants(value, issues)
  if (!isObject(value)) return finish(issues)

  duplicateStringProperties(
    value.entityBindings,
    'bindingKey',
    '/entityBindings',
    'contract.binding_key_duplicate',
    issues
  )
  duplicateStringProperties(
    value.policyBindings,
    'bindingId',
    '/policyBindings',
    'contract.policy_binding_id_duplicate',
    issues
  )
  duplicateStringProperties(
    value.allowedStructuralChanges,
    'allowanceId',
    '/allowedStructuralChanges',
    'contract.allowance_id_duplicate',
    issues
  )
  duplicateStringProperties(
    value.evaluationPlans,
    'planId',
    '/evaluationPlans',
    'contract.plan_id_duplicate',
    issues
  )
  duplicateStringProperties(
    value.limitOverrides,
    'key',
    '/limitOverrides',
    'contract.limit_key_duplicate',
    issues
  )

  if (Array.isArray(value.allowedOperationKinds))
  {
    const first = new Map<string, number>()
    for (
      let index = 0;
      index < value.allowedOperationKinds.length;
      index += 1
    )
    {
      const kind = value.allowedOperationKinds[index]
      if (typeof kind !== 'string') continue
      if (first.has(kind))
      {
        addIssue(
          issues,
          'contract.operation_kind_duplicate',
          pointer('/allowedOperationKinds', index),
          `operation kind duplicates index ${first.get(kind) ?? 0}`
        )
      }
      else
      {
        first.set(kind, index)
      }
    }
  }

  const allowedOperationKinds = new Set(
    Array.isArray(value.allowedOperationKinds)
      ? value.allowedOperationKinds.filter(
          (kind): kind is string => typeof kind === 'string'
        )
      : []
  )

  if (
    !Array.isArray(value.requiredStructuralChanges) ||
    !value.requiredStructuralChanges.some(
      (change) => isObject(change) && change.kind === 'deltaContains'
    )
  )
  {
    addIssue(
      issues,
      'contract.delta_contains_missing',
      '/requiredStructuralChanges',
      'at least one required deltaContains predicate is mandatory'
    )
  }

  validateContractBindingIdentities(value, allowedOperationKinds, issues)
  validateContractBindingReferences(value, issues)
  const policyBindings = collectPolicyBindings(value, issues)
  const masks = collectMaskIdentities(value, issues)
  const referencedMasks = new Set<string>()
  const referencedScenarios = new Set<string>()
  const plans = Array.isArray(value.evaluationPlans)
    ? value.evaluationPlans
    : []
  const exportPlans: { plan: JsonObject; index: number }[] = []
  for (let index = 0; index < plans.length; index += 1)
  {
    const plan = plans[index]
    if (!isObject(plan)) continue
    const path = pointer('/evaluationPlans', index)
    if (plan.requiredForExport === true) exportPlans.push({ plan, index })
    validatePlanLanes(plan, path, plan.requiredForExport === true, issues)
    validatePlanRuntimeSemantics(plan, path, issues)
    validatePlanPolicies(
      plan,
      path,
      policyBindings,
      referencedScenarios,
      issues
    )
    validateMaskReferences(plan, path, masks, referencedMasks, issues)
    if (
      plan.planClass === 'behavioralEdit' &&
      (!Array.isArray(plan.requiredRuntimeChanges) ||
        plan.requiredRuntimeChanges.length === 0)
    )
    {
      addIssue(
        issues,
        'contract.behavioral_runtime_change_missing',
        pointer(path, 'requiredRuntimeChanges'),
        'behavioralEdit plan requires a positive runtime predicate'
      )
    }
    if (
      plan.planClass === 'structuralMetadataOnly' &&
      Array.isArray(value.allowedOperationKinds)
    )
    {
      for (
        let operationIndex = 0;
        operationIndex < value.allowedOperationKinds.length;
        operationIndex += 1
      )
      {
        const kind = value.allowedOperationKinds[operationIndex]
        if (
          typeof kind === 'string' &&
          !STRUCTURAL_METADATA_OPERATION_KINDS.has(kind as OperationKind)
        )
        {
          addIssue(
            issues,
            'contract.structural_metadata_operation_invalid',
            pointer('/allowedOperationKinds', operationIndex),
            'structuralMetadataOnly permits comment operations and script.moveWorkspace only'
          )
        }
      }
    }
  }

  for (const [maskId] of masks)
  {
    if (!referencedMasks.has(maskId))
    {
      addIssue(
        issues,
        'contract.mask_unreferenced',
        '/evaluationPlans',
        `mask ${maskId} is not referenced by any preservation lens`
      )
    }
  }
  if (Array.isArray(value.policyBindings))
  {
    for (let index = 0; index < value.policyBindings.length; index += 1)
    {
      const binding = value.policyBindings[index]
      if (
        isObject(binding) &&
        binding.kind === 'scenario' &&
        typeof binding.semanticSha256 === 'string' &&
        !referencedScenarios.has(binding.semanticSha256)
      )
      {
        addIssue(
          issues,
          'contract.scenario_binding_unreferenced',
          pointer(pointer('/policyBindings', index), 'semanticSha256'),
          'scenario policy binding is not referenced by an evaluation plan'
        )
      }
    }
  }

  if (exportPlans.length !== 1)
  {
    addIssue(
      issues,
      'contract.export_plan_count',
      '/evaluationPlans',
      'exactly one evaluation plan must require export'
    )
  }
  if (
    exportPlans.length === 1 &&
    exportPlans[0]?.plan.planId !== value.exportRequiredPlanId
  )
  {
    addIssue(
      issues,
      'contract.export_plan_id_mismatch',
      '/exportRequiredPlanId',
      'exportRequiredPlanId must name the sole requiredForExport plan'
    )
  }

  return finish(issues)
}

export function validateEditScenarioPolicy(
  value: unknown,
  limitOverrides?: Partial<StructuredValidationLimits>
): SemanticValidationResult
{
  const issues: SemanticValidationIssue[] = []
  validateStructuredBounds(
    value,
    mergeLimits(POLICY_VALIDATION_LIMITS, limitOverrides),
    issues
  )
  validateCommonPolicyInvariants(value, issues)
  return finish(issues)
}

function procedureParts(operation: JsonObject): readonly JsonObject[]
{
  if (
    !isObject(operation.signature) ||
    !Array.isArray(operation.signature.parts)
  )
    return []
  return operation.signature.parts.filter(isObject)
}

function collectOperationMetadata(
  operation: JsonObject,
  path: string,
  issues: SemanticValidationIssue[],
  limits: SemanticBatchValidationLimits
): OperationMetadata
{
  const row =
    typeof operation.kind === 'string'
      ? (OPERATION_BY_KIND.get(operation.kind as OperationKind) ?? null)
      : null
  const declarations: DynamicDeclaration[] = []

  walkObjects(
    operation,
    (object, objectPath) =>
    {
      if (typeof object.localAlias === 'string')
      {
        declarations.push({
          slotKind: 'blockAlias',
          key: object.localAlias,
          path: pointer(objectPath, 'localAlias'),
        })
      }
    },
    path
  )

  if (Array.isArray(operation.exposeClones))
  {
    for (let index = 0; index < operation.exposeClones.length; index += 1)
    {
      const clone = operation.exposeClones[index]
      if (!isObject(clone) || typeof clone.alias !== 'string') continue
      declarations.push({
        slotKind: 'cloneAlias',
        key: clone.alias,
        path: pointer(pointer(pointer(path, 'exposeClones'), index), 'alias'),
      })
    }
  }

  const parameters = new Map<string, ProcedureParameterType>()
  const parameterNames = new Map<string, number>()
  const parameterKeys = new Map<string, number>()
  const parts = procedureParts(operation)
  let labelCount = 0
  let previousWasLabel = false
  let parameterCount = 0
  const proccodeParts: string[] = []

  for (let index = 0; index < parts.length; index += 1)
  {
    const part = parts[index]
    const partPath = pointer(
      pointer(pointer(path, 'signature'), 'parts'),
      index
    )
    if (part?.kind === 'label')
    {
      labelCount += 1
      if (previousWasLabel)
      {
        addIssue(
          issues,
          'procedure.label_adjacent',
          partPath,
          'procedure signature cannot contain adjacent labels'
        )
      }
      previousWasLabel = true
      if (typeof part.text === 'string')
      {
        proccodeParts.push(part.text)
        if (UTF8.encode(part.text).byteLength > 256)
        {
          addIssue(
            issues,
            'procedure.fragment_byte_limit',
            pointer(partPath, 'text'),
            'procedure label exceeds 256 UTF-8 bytes'
          )
        }
        if (!isCanonicalProcedureLabel(part.text))
        {
          addIssue(
            issues,
            'procedure.label_noncanonical',
            pointer(partPath, 'text'),
            'label must use single ASCII spaces with no edge whitespace, percent, or backslash'
          )
        }
      }
      continue
    }
    previousWasLabel = false
    if (part?.kind !== 'parameter') continue
    parameterCount += 1
    if (
      part.parameterType !== 'boolean' &&
      part.parameterType !== 'stringOrNumber' &&
      part.parameterType !== 'number'
    )
    {
      addIssue(
        issues,
        'procedure.parameter_type_invalid',
        pointer(partPath, 'parameterType'),
        'procedure parameter type must be stringOrNumber, number, or boolean'
      )
    }
    const parameterType =
      part.parameterType === 'boolean' ||
      part.parameterType === 'stringOrNumber' ||
      part.parameterType === 'number'
        ? part.parameterType
        : null
    if (parameterType && Object.hasOwn(part, 'defaultValue'))
    {
      // a %n default serializes as a JSON number on disk, so unlike %s it does
      // not accept a string
      const validDefault =
        parameterType === 'boolean'
          ? typeof part.defaultValue === 'boolean'
          : parameterType === 'number'
            ? validScratchNumber(part.defaultValue)
            : typeof part.defaultValue === 'string' ||
              validScratchNumber(part.defaultValue)
      if (!validDefault)
      {
        addIssue(
          issues,
          'procedure.parameter_default_type',
          pointer(partPath, 'defaultValue'),
          `procedure ${parameterType} parameter has an incompatible default`
        )
      }
    }
    if (parameterType)
    {
      proccodeParts.push(
        PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[parameterType].placeholder
      )
    }
    if (typeof part.localKey === 'string')
    {
      if (parameterKeys.has(part.localKey))
      {
        addIssue(
          issues,
          'procedure.parameter_key_duplicate',
          pointer(partPath, 'localKey'),
          `parameter localKey duplicates part ${parameterKeys.get(part.localKey) ?? 0}`
        )
      }
      else
      {
        parameterKeys.set(part.localKey, index)
        if (parameterType) parameters.set(part.localKey, parameterType)
        declarations.push({
          slotKind: 'parameter',
          key: part.localKey,
          path: pointer(partPath, 'localKey'),
        })
      }
    }
    if (typeof part.name === 'string')
    {
      if (UTF8.encode(part.name).byteLength > 256)
      {
        addIssue(
          issues,
          'procedure.fragment_byte_limit',
          pointer(partPath, 'name'),
          'procedure parameter name exceeds 256 UTF-8 bytes'
        )
      }
      if (parameterNames.has(part.name))
      {
        addIssue(
          issues,
          'procedure.parameter_name_duplicate',
          pointer(partPath, 'name'),
          `parameter name duplicates part ${parameterNames.get(part.name) ?? 0}`
        )
      }
      else
      {
        parameterNames.set(part.name, index)
      }
    }
  }

  if (isObject(operation.signature))
  {
    if (labelCount === 0)
    {
      addIssue(
        issues,
        'procedure.label_missing',
        pointer(pointer(path, 'signature'), 'parts'),
        'procedure signature requires at least one label'
      )
    }
    if (parameterCount > limits.maximumProcedureParameters)
    {
      addIssue(
        issues,
        'procedure.parameter_limit',
        pointer(pointer(path, 'signature'), 'parts'),
        `procedure parameter count exceeds ${limits.maximumProcedureParameters}`
      )
    }
    const byteLength = UTF8.encode(proccodeParts.join(' ')).byteLength
    if (byteLength > limits.maximumProcedureProccodeBytes)
    {
      addIssue(
        issues,
        'procedure.proccode_limit',
        pointer(pointer(path, 'signature'), 'parts'),
        `canonical proccode exceeds ${limits.maximumProcedureProccodeBytes} UTF-8 bytes`
      )
    }
  }

  const firstDeclaration = new Map<string, DynamicDeclaration>()
  for (const declaration of declarations)
  {
    const prior = firstDeclaration.get(declaration.key)
    if (prior !== undefined)
    {
      addIssue(
        issues,
        'batch.dynamic_key_duplicate',
        declaration.path,
        `dynamic key duplicates ${prior.path}`
      )
    }
    else
    {
      firstDeclaration.set(declaration.key, declaration)
    }
    if (
      row !== null &&
      !row.dynamicResultSlots.includes(declaration.slotKind)
    )
    {
      addIssue(
        issues,
        'batch.dynamic_key_not_declared',
        declaration.path,
        `${row.kind} does not declare ${declaration.slotKind} results`
      )
    }
  }

  validateProcedureMappings(operation, path, parameters, issues)

  return {
    operation,
    path,
    row,
    declarations,
    declarationKeys: firstDeclaration,
    procedureParameters: parameters,
  }
}

function validScratchNumber(value: unknown): value is number
{
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    !Object.is(value, -0) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
}

function isCanonicalProcedureLabel(value: string): boolean
{
  if (value.length === 0 || value.includes('%') || value.includes('\\'))
    return false
  if (value.trim() !== value) return false
  const runs = value.split(' ')
  return runs.every((run) => run.length > 0 && !/\s/u.test(run))
}

function validateProcedureMappings(
  operation: JsonObject,
  path: string,
  parameters: ReadonlyMap<string, ProcedureParameterType>,
  issues: SemanticValidationIssue[]
): void
{
  if (operation.kind !== 'procedure.updateSignature') return
  const lineage = Array.isArray(operation.parameterLineage)
    ? operation.parameterLineage
    : []
  const prototypeReporters = Array.isArray(operation.prototypeReporters)
    ? operation.prototypeReporters
    : []
  const bodyParameterReporters = Array.isArray(operation.bodyParameterReporters)
    ? operation.bodyParameterReporters
    : []
  const callSites = Array.isArray(operation.callSites)
    ? operation.callSites
    : []
  validateMappingKeys(
    lineage,
    'parameterLocalKey',
    pointer(path, 'parameterLineage'),
    issues
  )
  validateMappingKeys(
    prototypeReporters,
    'existingParameter',
    pointer(path, 'prototypeReporters'),
    issues
  )
  validateMappingKeys(
    bodyParameterReporters,
    'existingParameter',
    pointer(path, 'bodyParameterReporters'),
    issues
  )
  validateMappingKeys(callSites, 'call', pointer(path, 'callSites'), issues)
  const counts = new Map<string, number>()
  const lineageByKey = new Map<
    string,
    { kind: 'create' | 'retain'; existingIdentity: string | null }
  >()
  const retainedIdentityToKey = new Map<string, string>()
  for (let index = 0; index < lineage.length; index += 1)
  {
    const item = lineage[index]
    if (!isObject(item) || typeof item.parameterLocalKey !== 'string') continue
    counts.set(
      item.parameterLocalKey,
      (counts.get(item.parameterLocalKey) ?? 0) + 1
    )
    if (!isObject(item.lineage)) continue
    const kind = item.lineage.kind === 'retain' ? 'retain' : 'create'
    const existingIdentity =
      kind === 'retain'
        ? entityReferenceIdentity(item.lineage.existingParameter)
        : null
    if (!lineageByKey.has(item.parameterLocalKey))
    {
      lineageByKey.set(item.parameterLocalKey, { kind, existingIdentity })
    }
    if (existingIdentity !== null)
    {
      const priorKey = retainedIdentityToKey.get(existingIdentity)
      if (priorKey !== undefined && priorKey !== item.parameterLocalKey)
      {
        addIssue(
          issues,
          'procedure.retained_parameter_duplicate',
          pointer(pointer(pointer(path, 'parameterLineage'), index), 'lineage'),
          `existing parameter is retained by both ${priorKey} and ${item.parameterLocalKey}`
        )
      }
      else
      {
        retainedIdentityToKey.set(existingIdentity, item.parameterLocalKey)
      }
    }
  }
  for (const key of parameters.keys())
  {
    if (counts.get(key) !== 1)
    {
      addIssue(
        issues,
        'procedure.parameter_lineage_mismatch',
        pointer(path, 'parameterLineage'),
        `parameterLineage must cover ${key} exactly once`
      )
    }
  }
  for (const key of counts.keys())
  {
    if (!parameters.has(key))
    {
      addIssue(
        issues,
        'procedure.parameter_lineage_mismatch',
        pointer(path, 'parameterLineage'),
        `parameterLineage contains unknown key ${key}`
      )
    }
  }

  const prototypeParameterSet = validateProcedureReporterMappings(
    prototypeReporters,
    'prototypeReporters',
    path,
    lineageByKey,
    issues
  )
  const bodyParameterSet = validateProcedureReporterMappings(
    bodyParameterReporters,
    'bodyParameterReporters',
    path,
    lineageByKey,
    issues
  )
  if (!sameStringSet(prototypeParameterSet, bodyParameterSet))
  {
    addIssue(
      issues,
      'procedure.mapping_lineage_mismatch',
      pointer(path, 'bodyParameterReporters'),
      'prototype and body reporter mappings must cover the same old parameter identities'
    )
  }

  const knownOldParameters = new Set([
    ...prototypeParameterSet,
    ...bodyParameterSet,
    ...retainedIdentityToKey.keys(),
  ])
  const removedParameters = new Set(
    [...knownOldParameters].filter(
      (identity) => !retainedIdentityToKey.has(identity)
    )
  )

  for (let callIndex = 0; callIndex < callSites.length; callIndex += 1)
  {
    const call = callSites[callIndex]
    if (!isObject(call) || !Array.isArray(call.arguments)) continue
    validateMappingKeys(
      call.arguments,
      'parameterLocalKey',
      pointer(pointer(pointer(path, 'callSites'), callIndex), 'arguments'),
      issues
    )
    validateMappingKeys(
      call.removedArguments,
      'existingParameter',
      pointer(
        pointer(pointer(path, 'callSites'), callIndex),
        'removedArguments'
      ),
      issues
    )
    const argumentCounts = new Map<string, number>()
    const retainedSources = new Set<string>()
    for (
      let argumentIndex = 0;
      argumentIndex < call.arguments.length;
      argumentIndex += 1
    )
    {
      const argument = call.arguments[argumentIndex]
      if (!isObject(argument) || typeof argument.parameterLocalKey !== 'string')
        continue
      argumentCounts.set(
        argument.parameterLocalKey,
        (argumentCounts.get(argument.parameterLocalKey) ?? 0) + 1
      )
      const argumentPath = pointer(
        pointer(pointer(pointer(path, 'callSites'), callIndex), 'arguments'),
        argumentIndex
      )
      const expectedLineage = lineageByKey.get(argument.parameterLocalKey)
      if (expectedLineage === undefined)
      {
        addIssue(
          issues,
          'procedure.mapping_parameter_unknown',
          pointer(argumentPath, 'parameterLocalKey'),
          'call argument names an unknown new-signature parameter'
        )
        continue
      }
      if (!isObject(argument.source)) continue
      const source = argument.source
      if (
        source.kind === 'preserveParameter' ||
        source.kind === 'replaceParameter'
      )
      {
        const sourceIdentity = entityReferenceIdentity(source.existingParameter)
        if (
          expectedLineage.kind !== 'retain' ||
          sourceIdentity === null ||
          sourceIdentity !== expectedLineage.existingIdentity
        )
        {
          addIssue(
            issues,
            'procedure.call_source_lineage_mismatch',
            pointer(argumentPath, 'source'),
            'preserved or replaced call input must name the retained parameter for this local key'
          )
        }
        else
        {
          retainedSources.add(sourceIdentity)
        }
      }
      else if (
        source.kind === 'initializeNewParameter' &&
        expectedLineage.kind !== 'create'
      )
      {
        addIssue(
          issues,
          'procedure.call_source_lineage_mismatch',
          pointer(argumentPath, 'source'),
          'initializeNewParameter is legal only for a newly created parameter'
        )
      }
      const authoredValue =
        source.kind === 'replaceParameter' ||
        source.kind === 'initializeNewParameter'
          ? source.value
          : undefined
      if (
        authoredValue !== undefined &&
        !procedureArgumentValueMatches(
          authoredValue,
          parameters.get(argument.parameterLocalKey),
          parameters
        )
      )
      {
        addIssue(
          issues,
          'procedure.call_argument_type',
          pointer(pointer(argumentPath, 'source'), 'value'),
          'authored call argument block shape does not match the new parameter type'
        )
      }
    }
    const exact =
      argumentCounts.size === parameters.size &&
      [...parameters.keys()].every((key) => argumentCounts.get(key) === 1)
    if (!exact)
    {
      addIssue(
        issues,
        'procedure.call_mapping_mismatch',
        pointer(pointer(pointer(path, 'callSites'), callIndex), 'arguments'),
        'call mapping must cover every new-signature parameter exactly once'
      )
    }

    const removedSet = new Set<string>()
    const removedArguments = Array.isArray(call.removedArguments)
      ? call.removedArguments
      : []
    for (let index = 0; index < removedArguments.length; index += 1)
    {
      const removed = removedArguments[index]
      if (!isObject(removed)) continue
      const identity = entityReferenceIdentity(removed.existingParameter)
      if (identity === null) continue
      removedSet.add(identity)
      if (retainedIdentityToKey.has(identity))
      {
        addIssue(
          issues,
          'procedure.removed_parameter_retained',
          pointer(
            pointer(
              pointer(
                pointer(pointer(path, 'callSites'), callIndex),
                'removedArguments'
              ),
              index
            ),
            'existingParameter'
          ),
          'removedArguments cannot remove a retained parameter'
        )
      }
    }
    if (
      !sameStringSet(retainedSources, new Set(retainedIdentityToKey.keys())) ||
      !sameStringSet(removedSet, removedParameters)
    )
    {
      addIssue(
        issues,
        'procedure.call_mapping_mismatch',
        pointer(pointer(path, 'callSites'), callIndex),
        'call mapping must preserve every retained old parameter and remove every removed old parameter exactly once'
      )
    }
  }
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean
{
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

function validateProcedureReporterMappings(
  mappings: readonly unknown[],
  property: 'prototypeReporters' | 'bodyParameterReporters',
  operationPath: string,
  lineageByKey: ReadonlyMap<
    string,
    { kind: 'create' | 'retain'; existingIdentity: string | null }
  >,
  issues: SemanticValidationIssue[]
): Set<string>
{
  const identities = new Set<string>()
  for (let index = 0; index < mappings.length; index += 1)
  {
    const mapping = mappings[index]
    if (!isObject(mapping)) continue
    const path = pointer(pointer(operationPath, property), index)
    const existingIdentity = entityReferenceIdentity(mapping.existingParameter)
    if (existingIdentity !== null) identities.add(existingIdentity)
    if (!isObject(mapping.disposition)) continue
    const disposition = mapping.disposition
    const localKey = disposition.parameterLocalKey
    if (typeof localKey !== 'string') continue
    const mappedLineage = lineageByKey.get(localKey)
    if (mappedLineage === undefined)
    {
      addIssue(
        issues,
        'procedure.mapping_parameter_unknown',
        pointer(pointer(path, 'disposition'), 'parameterLocalKey'),
        'reporter disposition names an unknown new-signature parameter'
      )
      continue
    }
    const mustRetainSameParameter =
      disposition.kind === 'preserveExisting' ||
      disposition.kind === 'retainMapped'
    if (
      mustRetainSameParameter &&
      (mappedLineage.kind !== 'retain' ||
        existingIdentity === null ||
        mappedLineage.existingIdentity !== existingIdentity)
    )
    {
      addIssue(
        issues,
        'procedure.mapping_lineage_mismatch',
        pointer(path, 'disposition'),
        'preserved reporter must map to the same retained parameter identity'
      )
    }
  }
  return identities
}

// %s & %n share argument_reporter_string_number, so either reporter physically
// fits either slot; only the hexagonal boolean reporter is discriminating
function parameterTypesInterchangeable(
  left: ProcedureParameterType | undefined,
  right: ProcedureParameterType | undefined
): boolean
{
  if (left === undefined || right === undefined) return false
  return left === 'boolean' || right === 'boolean' ? left === right : true
}

function procedureArgumentValueMatches(
  value: unknown,
  parameterType: ProcedureParameterType | undefined,
  localParameters: ReadonlyMap<string, ProcedureParameterType>
): boolean
{
  if (parameterType === undefined || !isObject(value)) return true
  if (value.valueKind !== 'block' || !isObject(value.value)) return true
  const block = value.value
  if (block.nodeKind === 'ordinary' && typeof block.opcode === 'string')
  {
    const shape = DESCRIPTOR_BY_OPCODE.get(block.opcode)?.shape
    return parameterType === 'boolean'
      ? shape === 'boolean'
      : shape === 'reporter'
  }
  if (
    block.nodeKind === 'parameterReporter' &&
    isObject(block.parameter) &&
    block.parameter.refKind === 'procedureLocalParameter' &&
    typeof block.parameter.localKey === 'string'
  )
  {
    return parameterTypesInterchangeable(
      localParameters.get(block.parameter.localKey),
      parameterType
    )
  }
  return block.nodeKind === 'parameterReporter'
}

function validateMappingKeys(
  value: unknown,
  property: string,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  if (!Array.isArray(value)) return
  const first = new Map<string, number>()
  for (let index = 0; index < value.length; index += 1)
  {
    const item = value[index]
    if (!isObject(item) || !Object.hasOwn(item, property)) continue
    let key: string
    try
    {
      if (property === 'existingParameter' || property === 'call')
      {
        const identity = entityReferenceIdentity(item[property])
        if (identity === null) continue
        key = identity
      }
      else
      {
        key = canonicalJsonV1(item[property])
      }
    }
    catch
    {
      continue
    }
    if (first.has(key))
    {
      addIssue(
        issues,
        'procedure.mapping_key_duplicate',
        pointer(pointer(path, index), property),
        `${property} duplicates mapping ${first.get(key) ?? 0}`
      )
    }
    else
    {
      first.set(key, index)
    }
  }
}

interface CreatedReference
{
  readonly reference: JsonObject
  readonly path: string
}

function collectCreatedReference(
  object: JsonObject,
  path: string,
  references: CreatedReference[]
): void
{
  if (object.refKind === 'created') references.push({ reference: object, path })
}

function validateOccurrenceSelection(
  metadata: OperationMetadata,
  object: JsonObject,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  if (
    object.refKind !== 'structural' ||
    object.selectorKind !== 'matchSet' ||
    !isObject(object.selection)
  )
  {
    return
  }
  if (object.selection.kind === 'exactlyOne')
  {
    if (object.expectedMatchCount !== 1)
    {
      addIssue(
        issues,
        'batch.exactly_one_cardinality',
        pointer(path, 'expectedMatchCount'),
        'exactlyOne requires expectedMatchCount 1'
      )
    }
    return
  }
  if (object.selection.kind !== 'occurrence') return

  const relative = path
    .slice(metadata.path.length + 1)
    .split('/')
    .filter((part) => part.length > 0 && !/^\d+$/u.test(part))
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.')
  const permitted =
    metadata.row !== null &&
    metadata.row.selectionFields.some(
      (field) => relative === field || relative.startsWith(`${field}.`)
    )
  if (!permitted)
  {
    addIssue(
      issues,
      'batch.occurrence_selection_not_allowed',
      pointer(pointer(path, 'selection'), 'kind'),
      'operation field does not advertise bounded occurrence selection'
    )
  }
  if (
    typeof object.expectedMatchCount === 'number' &&
    object.expectedMatchCount <= 1
  )
  {
    addIssue(
      issues,
      'batch.occurrence_selection_cardinality',
      pointer(path, 'expectedMatchCount'),
      'occurrence selection requires a match set larger than one; singleton sets use exactlyOne'
    )
  }
  const zeroBasedIndex = object.selection.zeroBasedIndex
  if (
    typeof zeroBasedIndex === 'number' &&
    Number.isSafeInteger(zeroBasedIndex) &&
    typeof object.expectedMatchCount === 'number' &&
    (zeroBasedIndex < 0 || zeroBasedIndex >= object.expectedMatchCount)
  )
  {
    addIssue(
      issues,
      'batch.occurrence_selection_out_of_range',
      pointer(pointer(path, 'selection'), 'zeroBasedIndex'),
      'occurrence index must be inside the expected ordered match set'
    )
  }
}

function validateCreatedReference(
  reference: JsonObject,
  path: string,
  consumerIndex: number,
  positions: ReadonlyMap<string, readonly number[]>,
  metadata: readonly OperationMetadata[],
  issues: SemanticValidationIssue[]
): void
{
  if (typeof reference.opId !== 'string') return
  const creatorPositions = positions.get(reference.opId) ?? []
  if (creatorPositions.length === 0)
  {
    addIssue(
      issues,
      'batch.created_ref_creator_missing',
      pointer(path, 'opId'),
      'created result references an unknown opId'
    )
    return
  }
  if (creatorPositions.length !== 1)
  {
    addIssue(
      issues,
      'batch.created_ref_creator_ambiguous',
      pointer(path, 'opId'),
      'created result opId is ambiguous because the batch duplicates it'
    )
    return
  }
  const creatorIndex = creatorPositions[0] as number
  if (creatorIndex >= consumerIndex)
  {
    addIssue(
      issues,
      'batch.created_ref_not_backward',
      pointer(path, 'opId'),
      'created result dependencies must point to an earlier operation'
    )
    return
  }
  const creator = metadata[creatorIndex]
  if (creator?.row === null || creator === undefined) return
  const slot = reference.slot
  if (!isObject(slot) || typeof slot.slotKind !== 'string') return

  let expectedEntityKind: string | undefined
  let exists = false
  if (slot.slotKind === 'fixed' && typeof slot.name === 'string')
  {
    expectedEntityKind = FIXED_SLOT_ENTITY_KINDS[slot.name]
    exists = fixedResultSlotExists(creator, slot.name)
  }
  else if (
    slot.slotKind === 'blockAlias' ||
    slot.slotKind === 'parameter' ||
    slot.slotKind === 'cloneAlias'
  )
  {
    expectedEntityKind = DYNAMIC_SLOT_ENTITY_KINDS[slot.slotKind]
    const keyProperty = slot.slotKind === 'parameter' ? 'localKey' : 'alias'
    const key = slot[keyProperty]
    exists =
      creator.row.dynamicResultSlots.includes(slot.slotKind) &&
      typeof key === 'string' &&
      creator.declarations.some(
        (declaration) =>
          declaration.slotKind === slot.slotKind && declaration.key === key
      )
    if (
      exists &&
      slot.slotKind === 'parameter' &&
      creator.operation.kind === 'procedure.updateSignature' &&
      typeof key === 'string'
    )
    {
      exists =
        Array.isArray(creator.operation.parameterLineage) &&
        creator.operation.parameterLineage.some(
          (entry) =>
            isObject(entry) &&
            entry.parameterLocalKey === key &&
            isObject(entry.lineage) &&
            entry.lineage.kind === 'create'
        )
    }
    if (typeof key === 'string' && !exists)
    {
      addIssue(
        issues,
        'batch.created_ref_slot_key_missing',
        pointer(pointer(path, 'slot'), keyProperty),
        'creator does not declare the named dynamic result key'
      )
    }
  }

  if (!exists)
  {
    addIssue(
      issues,
      'batch.created_ref_slot_missing',
      pointer(path, 'slot'),
      `${creator.row.kind} does not declare this result slot`
    )
  }
  if (
    expectedEntityKind !== undefined &&
    reference.entityKind !== expectedEntityKind
  )
  {
    addIssue(
      issues,
      'batch.created_ref_entity_kind',
      pointer(path, 'entityKind'),
      `result slot requires entityKind ${expectedEntityKind}`
    )
  }
}

function semanticValueCreatesRoot(value: unknown): boolean
{
  return (
    isObject(value) &&
    (value.valueKind === 'block' || value.valueKind === 'statementSequence')
  )
}

function fixedResultSlotExists(
  creator: OperationMetadata,
  slotName: string
): boolean
{
  if (creator.row === null) return false
  if (creator.row.fixedResultSlots.includes(slotName)) return true
  if (!creator.row.dynamicResultSlots.includes(slotName)) return false
  if (slotName === 'destinationScript')
  {
    return (
      isObject(creator.operation.destination) &&
      (creator.operation.destination.kind === 'topLevelStatement' ||
        creator.operation.destination.kind === 'topLevelExpression')
    )
  }
  if (slotName === 'sourceGapRootBlock')
  {
    return (
      isObject(creator.operation.sourceGap) &&
      creator.operation.sourceGap.kind === 'replaceInput' &&
      semanticValueCreatesRoot(creator.operation.sourceGap.value)
    )
  }
  if (slotName === 'rootBlock')
  {
    return semanticValueCreatesRoot(creator.operation.value)
  }
  return false
}

function pathWithin(path: string, parent: string): boolean
{
  return path === parent || path.startsWith(`${parent}/`)
}

function validateLocalReference(
  metadata: OperationMetadata,
  blockAliases: ReadonlySet<string>,
  object: JsonObject,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  if (
    typeof object.newBlockAlias === 'string' &&
    !blockAliases.has(object.newBlockAlias)
  )
  {
    addIssue(
      issues,
      'batch.local_reference_missing',
      pointer(path, 'newBlockAlias'),
      'newBlockAlias does not name a recursively declared localAlias'
    )
  }
  if (object.refKind === 'procedureLocalParameter')
  {
    const bodyPath = pointer(metadata.path, 'body')
    if (
      metadata.operation.kind !== 'procedure.add' ||
      !pathWithin(path, bodyPath)
    )
    {
      addIssue(
        issues,
        'batch.procedure_local_reference_context',
        path,
        'procedureLocalParameter is legal only in procedure.add body content'
      )
    }
    if (
      typeof object.localKey === 'string' &&
      !metadata.procedureParameters.has(object.localKey)
    )
    {
      addIssue(
        issues,
        'batch.local_reference_missing',
        pointer(path, 'localKey'),
        'procedure local reference does not name a signature parameter'
      )
    }
  }
  if (
    object.refKind === 'selfProcedure' &&
    (metadata.operation.kind !== 'procedure.add' ||
      !pathWithin(path, pointer(metadata.path, 'body')))
  )
  {
    addIssue(
      issues,
      'batch.self_procedure_context',
      path,
      'selfProcedure is legal only in procedure.add body content'
    )
  }
  if (
    typeof object.parameterLocalKey === 'string' &&
    !metadata.procedureParameters.has(object.parameterLocalKey)
  )
  {
    addIssue(
      issues,
      'batch.local_reference_missing',
      pointer(path, 'parameterLocalKey'),
      'parameterLocalKey does not name a signature parameter'
    )
  }
}

function validateOperationObjects(
  metadata: OperationMetadata,
  issues: SemanticValidationIssue[]
): CreatedReference[]
{
  const references: CreatedReference[] = []
  const blockAliases = new Set(
    metadata.declarations
      .filter((declaration) => declaration.slotKind === 'blockAlias')
      .map((declaration) => declaration.key)
  )
  walkObjects(
    metadata.operation,
    (object, path) =>
    {
      validateLocalReference(metadata, blockAliases, object, path, issues)
      validateOccurrenceSelection(metadata, object, path, issues)
      collectCreatedReference(object, path, references)
    },
    metadata.path
  )
  return references
}

function validatePropertyEdits(
  operation: JsonObject,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  if (
    operation.kind !== 'target.setSpriteProperties' &&
    operation.kind !== 'target.setStageProperties' &&
    operation.kind !== 'comment.move'
  )
  {
    return
  }
  duplicateStringProperties(
    operation.edits,
    'property',
    pointer(path, 'edits'),
    'batch.property_duplicate',
    issues
  )
}

function validateNamedMembers(
  values: unknown,
  metadata: NamedMemberValidatorMetadata<unknown>,
  path: string,
  family: 'field' | 'input',
  issues: SemanticValidationIssue[]
): Map<string, { value: unknown; path: string }>
{
  const result = new Map<string, { value: unknown; path: string }>()
  const duplicateCode =
    family === 'field'
      ? 'block.field_name_duplicate'
      : 'block.input_name_duplicate'
  const missingCode =
    family === 'field' ? 'block.field_missing' : 'block.input_missing'
  const unknownCode =
    family === 'field' ? 'block.field_unknown' : 'block.input_unknown'
  const items = Array.isArray(values) ? values : []

  for (let index = 0; index < items.length; index += 1)
  {
    const item = items[index]
    if (!isObject(item) || typeof item.name !== 'string') continue
    const itemPath = pointer(path, index)
    if (result.has(item.name))
    {
      addIssue(
        issues,
        duplicateCode,
        pointer(itemPath, 'name'),
        `${family} name ${item.name} is duplicated`
      )
    }
    else
    {
      result.set(item.name, {
        value: item.value,
        path: pointer(itemPath, 'value'),
      })
    }
    if (!metadata.allowedNames.has(item.name))
    {
      addIssue(
        issues,
        unknownCode,
        pointer(itemPath, 'name'),
        `${family} ${item.name} is not declared by the opcode descriptor`
      )
    }
  }
  for (const name of metadata.requiredNames)
  {
    if (!result.has(name))
    {
      addIssue(
        issues,
        missingCode,
        path,
        `required ${family} ${name} is missing`
      )
    }
  }
  return result
}

function validateDescriptorContext(
  descriptor: VanillaCoreDescriptor,
  context: BlockContext,
  ownerTargetKind: 'stage' | 'sprite' | null,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  const placements = descriptor.context.allowedPlacements
  const valid =
    context === 'any' ||
    (context === 'statement' &&
      (placements.includes('statementSequence') ||
        placements.includes('topLevelStatement'))) ||
    (context === 'reporter' &&
      descriptor.shape === 'reporter' &&
      (placements.includes('reporterInput') ||
        placements.includes('topLevelExpression'))) ||
    (context === 'boolean' &&
      descriptor.shape === 'boolean' &&
      (placements.includes('booleanInput') ||
        placements.includes('topLevelExpression'))) ||
    (context === 'eventHat' &&
      descriptor.shape === 'hat' &&
      placements.includes('eventScriptHat'))
  if (!valid)
  {
    addIssue(
      issues,
      'block.context_invalid',
      path,
      `${descriptor.opcode} is not valid in ${context} context`
    )
  }
  if (
    ownerTargetKind !== null &&
    !descriptor.context.ownerTargets.includes(ownerTargetKind)
  )
  {
    addIssue(
      issues,
      'block.owner_target_invalid',
      path,
      `${descriptor.opcode} cannot be owned by a ${ownerTargetKind} target`
    )
  }
}

function inferredEntitySubtype(reference: JsonObject): string | null
{
  if (
    reference.refKind !== 'structural' ||
    reference.selectorKind !== 'exactLocation' ||
    !isObject(reference.location)
  )
  {
    return null
  }
  if (reference.entityKind === 'declaration')
  {
    return typeof reference.location.declarationKind === 'string'
      ? reference.location.declarationKind
      : null
  }
  if (reference.entityKind === 'target')
  {
    return typeof reference.location.targetKind === 'string'
      ? reference.location.targetKind
      : null
  }
  if (reference.entityKind === 'media')
  {
    return typeof reference.location.mediaKind === 'string'
      ? reference.location.mediaKind
      : null
  }
  return null
}

function inferredTargetKind(reference: unknown): 'stage' | 'sprite' | null
{
  if (!isObject(reference)) return null
  const subtype = inferredEntitySubtype(reference)
  return subtype === 'stage' || subtype === 'sprite' ? subtype : null
}

function validateDescriptorFieldValue(
  metadata: NamedMemberValidatorMetadata<DescriptorField>,
  fieldName: string,
  value: unknown,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  const field = metadata.byName.get(fieldName)
  if (field === undefined || !isObject(value)) return
  if (field.requiredEntitySubtype !== null && value.valueKind !== 'entity')
  {
    addIssue(
      issues,
      'block.field_value_kind',
      path,
      `${fieldName} requires the semantic entity branch`
    )
  }
  if (
    field.requiredEntitySubtype !== null &&
    value.valueKind === 'entity' &&
    isObject(value.value) &&
    value.value.entityKind !== 'declaration'
  )
  {
    addIssue(
      issues,
      'block.field_value_kind',
      pointer(path, 'value'),
      `${fieldName} requires a declaration entity reference`
    )
  }
  if (
    field.requiredEntitySubtype !== null &&
    value.valueKind === 'entity' &&
    isObject(value.value)
  )
  {
    const subtype = inferredEntitySubtype(value.value)
    if (subtype !== null && subtype !== field.requiredEntitySubtype)
    {
      addIssue(
        issues,
        'block.entity_subtype_mismatch',
        pointer(path, 'value'),
        `${fieldName} requires ${field.requiredEntitySubtype}, not ${subtype}`
      )
    }
  }
}

function validateDescriptorInputValue(
  descriptorInput: DescriptorInput,
  value: unknown,
  optional: boolean,
  path: string,
  state: ValidationState,
  depth: number
): void
{
  if (!isObject(value)) return
  if (value.valueKind === 'empty')
  {
    if (!optional)
    {
      addIssue(
        state.issues,
        'block.empty_required_input',
        path,
        `${descriptorInput.name} is required and cannot be empty`
      )
    }
    return
  }
  if (descriptorInput.connection === 'entityMenu')
  {
    if (value.valueKind !== 'entity')
    {
      addIssue(
        state.issues,
        'block.input_value_kind',
        path,
        `${descriptorInput.name} requires the semantic entity branch`
      )
    }
    else if (
      isObject(value.value) &&
      descriptorInput.requiredEntitySubtype !== null &&
      value.value.entityKind !== 'declaration'
    )
    {
      addIssue(
        state.issues,
        'block.input_value_kind',
        pointer(path, 'value'),
        `${descriptorInput.name} requires a declaration entity reference`
      )
    }
    if (
      value.valueKind === 'entity' &&
      isObject(value.value) &&
      descriptorInput.requiredEntitySubtype !== null
    )
    {
      const subtype = inferredEntitySubtype(value.value)
      if (
        subtype !== null &&
        subtype !== descriptorInput.requiredEntitySubtype
      )
      {
        addIssue(
          state.issues,
          'block.entity_subtype_mismatch',
          pointer(path, 'value'),
          `${descriptorInput.name} requires ${descriptorInput.requiredEntitySubtype}, not ${subtype}`
        )
      }
    }
    return
  }
  if (descriptorInput.connection === 'substack')
  {
    if (value.valueKind !== 'statementSequence')
    {
      addIssue(
        state.issues,
        'block.input_value_kind',
        path,
        `${descriptorInput.name} requires a statementSequence`
      )
      return
    }
    validateStatementSequence(
      value.value,
      pointer(path, 'value'),
      state,
      depth + 1
    )
    return
  }
  if (descriptorInput.connection === 'boolean')
  {
    if (value.valueKind !== 'block')
    {
      addIssue(
        state.issues,
        'block.input_value_kind',
        path,
        `${descriptorInput.name} requires a Boolean block`
      )
      return
    }
    validateBlockTree(
      value.value,
      pointer(path, 'value'),
      'boolean',
      state,
      depth + 1
    )
    return
  }
  if (value.valueKind === 'block')
  {
    validateBlockTree(
      value.value,
      pointer(path, 'value'),
      'reporter',
      state,
      depth + 1
    )
    return
  }
  if (value.valueKind !== 'literal')
  {
    addIssue(
      state.issues,
      'block.input_value_kind',
      path,
      `${descriptorInput.name} requires a literal or reporter block`
    )
    return
  }
  if (
    descriptorInput.connection === 'number' &&
    typeof value.value !== 'number'
  )
  {
    addIssue(
      state.issues,
      'block.input_value_kind',
      pointer(path, 'value'),
      `${descriptorInput.name} requires a numeric literal`
    )
  }
}

function validateBlockTree(
  value: unknown,
  path: string,
  context: BlockContext,
  state: ValidationState,
  depth: number
): void
{
  if (!isObject(value)) return
  state.blockNodes += 1
  if (
    state.blockNodes > state.limits.maximumBlockNodes &&
    !state.blockLimitReported
  )
  {
    state.blockLimitReported = true
    addIssue(
      state.issues,
      'block.node_limit',
      path,
      `described block nodes exceed ${state.limits.maximumBlockNodes}`
    )
  }
  if (depth > state.limits.maximumBlockTreeDepth)
  {
    addIssue(
      state.issues,
      'block.tree_depth_exceeded',
      path,
      `semantic block tree depth exceeds ${state.limits.maximumBlockTreeDepth}`
    )
    return
  }

  if (value.nodeKind === 'ordinary')
  {
    if (typeof value.opcode !== 'string') return
    if (PROCEDURE_INTERNAL_OPCODES.has(value.opcode))
    {
      addIssue(
        state.issues,
        'block.ordinary_opcode_procedure_internal',
        pointer(path, 'opcode'),
        'procedure internals cannot use the ordinary semantic branch'
      )
      return
    }
    const validatorMetadata = DESCRIPTOR_VALIDATOR_METADATA_BY_OPCODE.get(
      value.opcode
    )
    if (validatorMetadata === undefined)
    {
      addIssue(
        state.issues,
        'block.ordinary_opcode_unadvertised',
        pointer(path, 'opcode'),
        'ordinary opcode is absent from the frozen descriptor profile'
      )
      return
    }
    const descriptor = validatorMetadata.descriptor
    if (
      descriptor.availability !== 'supported' ||
      descriptor.safeBuilderKind !== 'ordinaryBlock'
    )
    {
      addIssue(
        state.issues,
        'block.ordinary_opcode_not_authorable',
        pointer(path, 'opcode'),
        'descriptor is builder-only or preservation-only'
      )
    }
    validateDescriptorContext(
      descriptor,
      context,
      state.ownerTargetKind,
      path,
      state.issues
    )
    const fields = validateNamedMembers(
      value.fields,
      validatorMetadata.fields,
      pointer(path, 'fields'),
      'field',
      state.issues
    )
    for (const [name, entry] of fields)
    {
      validateDescriptorFieldValue(
        validatorMetadata.fields,
        name,
        entry.value,
        entry.path,
        state.issues
      )
    }
    const inputs = validateNamedMembers(
      value.inputs,
      validatorMetadata.inputs,
      pointer(path, 'inputs'),
      'input',
      state.issues
    )
    for (const name of validatorMetadata.inputs.requiredNames)
    {
      const entry = inputs.get(name)
      if (entry !== undefined)
      {
        validateDescriptorInputValue(
          validatorMetadata.inputs.byName.get(name)!,
          entry.value,
          false,
          entry.path,
          state,
          depth
        )
      }
    }
    for (const name of validatorMetadata.inputs.optionalNames)
    {
      const entry = inputs.get(name)
      if (entry !== undefined)
      {
        validateDescriptorInputValue(
          validatorMetadata.inputs.byName.get(name)!,
          entry.value,
          true,
          entry.path,
          state,
          depth
        )
      }
    }
    return
  }

  if (value.nodeKind === 'procedureCall')
  {
    if (context !== 'any' && context !== 'statement')
    {
      addIssue(
        state.issues,
        'block.context_invalid',
        path,
        'procedure call is a statement block'
      )
    }
    const argumentsValue = Array.isArray(value.arguments) ? value.arguments : []
    const seen = new Set<string>()
    const isSelfCall =
      isObject(value.procedure) && value.procedure.refKind === 'selfProcedure'
    for (let index = 0; index < argumentsValue.length; index += 1)
    {
      const argument = argumentsValue[index]
      if (!isObject(argument)) continue
      const argumentPath = pointer(pointer(path, 'arguments'), index)
      const parameter = argument.parameter
      if (isObject(parameter))
      {
        const identity = entityReferenceIdentity(parameter)
        if (identity !== null && seen.has(identity))
        {
          addIssue(
            state.issues,
            'block.procedure_argument_duplicate',
            pointer(argumentPath, 'parameter'),
            'procedure call parameter is duplicated'
          )
        }
        if (identity !== null) seen.add(identity)
      }
      if (
        isSelfCall &&
        isObject(parameter) &&
        parameter.refKind === 'procedureLocalParameter' &&
        typeof parameter.localKey === 'string' &&
        !procedureArgumentValueMatches(
          argument.value,
          state.procedureParameters.get(parameter.localKey),
          state.procedureParameters
        )
      )
      {
        addIssue(
          state.issues,
          'procedure.call_argument_type',
          pointer(argumentPath, 'value'),
          'self-call argument block shape does not match the local parameter type'
        )
      }
      validateSemanticInputValue(
        argument.value,
        pointer(argumentPath, 'value'),
        'any',
        state,
        depth + 1
      )
    }
    if (isSelfCall)
    {
      const keys = argumentsValue
        .map((argument) =>
          isObject(argument) &&
          isObject(argument.parameter) &&
          argument.parameter.refKind === 'procedureLocalParameter'
            ? argument.parameter.localKey
            : null
        )
        .filter((key): key is string => typeof key === 'string')
      const exact =
        keys.length === state.procedureParameters.size &&
        new Set(keys).size === keys.length &&
        keys.every((key) => state.procedureParameters.has(key))
      if (!exact)
      {
        addIssue(
          state.issues,
          'block.self_call_argument_mismatch',
          pointer(path, 'arguments'),
          'self call must cover every local procedure parameter exactly once'
        )
      }
    }
    return
  }

  if (value.nodeKind === 'parameterReporter')
  {
    if (context === 'statement' || context === 'eventHat')
    {
      addIssue(
        state.issues,
        'block.context_invalid',
        path,
        'parameter reporter is an expression block'
      )
    }
    if (
      isObject(value.parameter) &&
      value.parameter.refKind === 'procedureLocalParameter' &&
      typeof value.parameter.localKey === 'string'
    )
    {
      const parameterType = state.procedureParameters.get(
        value.parameter.localKey
      )
      if (
        (context === 'boolean' &&
          (parameterType === 'stringOrNumber' || parameterType === 'number')) ||
        (context === 'reporter' && parameterType === 'boolean')
      )
      {
        addIssue(
          state.issues,
          'block.context_invalid',
          pointer(path, 'parameter'),
          'local parameter reporter type is incompatible with its input context'
        )
      }
    }
    return
  }

  addIssue(
    state.issues,
    'block.node_kind_unknown',
    pointer(path, 'nodeKind'),
    'semantic block nodeKind is not recognized'
  )
}

function validateStatementSequence(
  value: unknown,
  path: string,
  state: ValidationState,
  depth: number
): void
{
  if (!isObject(value) || !Array.isArray(value.blocks)) return
  for (let index = 0; index < value.blocks.length; index += 1)
  {
    const block = value.blocks[index]
    const blockPath = pointer(pointer(path, 'blocks'), index)
    validateBlockTree(block, blockPath, 'statement', state, depth)
    if (
      isObject(block) &&
      block.nodeKind === 'ordinary' &&
      typeof block.opcode === 'string'
    )
    {
      const descriptor = DESCRIPTOR_BY_OPCODE.get(block.opcode)
      if (
        descriptor !== undefined &&
        (descriptor.shape === 'cap' ||
          descriptor.context.mustTerminateSequence) &&
        index !== value.blocks.length - 1
      )
      {
        addIssue(
          state.issues,
          'block.cap_not_last',
          blockPath,
          'cap block must be the final statement in its sequence'
        )
      }
    }
  }
}

function validateExpressionRoot(
  value: unknown,
  path: string,
  state: ValidationState,
  depth: number
): void
{
  if (
    isObject(value) &&
    value.nodeKind === 'ordinary' &&
    typeof value.opcode === 'string'
  )
  {
    const descriptor = DESCRIPTOR_BY_OPCODE.get(value.opcode)
    validateBlockTree(
      value,
      path,
      descriptor?.shape === 'boolean' ? 'boolean' : 'reporter',
      state,
      depth
    )
    return
  }
  if (isObject(value) && value.nodeKind === 'parameterReporter')
  {
    validateBlockTree(value, path, 'any', state, depth)
    return
  }
  validateBlockTree(value, path, 'reporter', state, depth)
}

function validateSemanticInputValue(
  value: unknown,
  path: string,
  context: BlockContext,
  state: ValidationState,
  depth: number
): void
{
  if (!isObject(value)) return
  if (value.valueKind === 'block')
  {
    validateBlockTree(
      value.value,
      pointer(path, 'value'),
      context,
      state,
      depth
    )
  }
  else if (value.valueKind === 'statementSequence')
  {
    validateStatementSequence(value.value, pointer(path, 'value'), state, depth)
  }
}

function scanSemanticSurfaces(
  value: unknown,
  path: string,
  state: ValidationState,
  ancestors = new Set<object>()
): void
{
  if (Array.isArray(value))
  {
    if (ancestors.has(value)) return
    ancestors.add(value)
    for (let index = 0; index < value.length; index += 1)
    {
      scanSemanticSurfaces(value[index], pointer(path, index), state, ancestors)
    }
    ancestors.delete(value)
    return
  }
  if (!isObject(value) || ancestors.has(value)) return

  if (typeof value.rootKind === 'string')
  {
    if (value.rootKind === 'eventScript')
    {
      validateBlockTree(value.hat, pointer(path, 'hat'), 'eventHat', state, 1)
      if (value.body !== undefined)
        validateStatementSequence(value.body, pointer(path, 'body'), state, 1)
    }
    else if (value.rootKind === 'statementSequence')
    {
      validateStatementSequence(value.value, pointer(path, 'value'), state, 1)
    }
    else if (value.rootKind === 'expression')
    {
      validateExpressionRoot(value.value, pointer(path, 'value'), state, 1)
    }
    return
  }
  if (typeof value.replacementKind === 'string')
  {
    if (value.replacementKind === 'statementSequence')
      validateStatementSequence(value.value, pointer(path, 'value'), state, 1)
    else if (value.replacementKind === 'expression')
      validateExpressionRoot(value.value, pointer(path, 'value'), state, 1)
    return
  }
  if (typeof value.nodeKind === 'string')
  {
    validateBlockTree(value, path, 'any', state, 1)
    return
  }
  if (Array.isArray(value.blocks))
  {
    validateStatementSequence(value, path, state, 1)
    return
  }
  if (
    typeof value.valueKind === 'string' &&
    [
      'literal',
      'entity',
      'special',
      'block',
      'statementSequence',
      'empty',
    ].includes(value.valueKind)
  )
  {
    validateSemanticInputValue(value, path, 'any', state, 1)
    return
  }

  ancestors.add(value)
  for (const key of Object.keys(value).sort())
  {
    scanSemanticSurfaces(value[key], pointer(path, key), state, ancestors)
  }
  ancestors.delete(value)
}

function validateMediaPlacement(
  operation: JsonObject,
  path: string,
  issues: SemanticValidationIssue[]
): void
{
  if (
    operation.kind !== 'media.addCostume' &&
    operation.kind !== 'media.replaceCostume'
  )
  {
    return
  }
  const placement = operation.placement
  if (!isObject(placement)) return
  const hasX = Object.hasOwn(placement, 'x')
  const hasY = Object.hasOwn(placement, 'y')
  if (placement.kind === 'explicitCenter' && (!hasX || !hasY))
  {
    addIssue(
      issues,
      'media.placement_coordinates_missing',
      pointer(path, 'placement'),
      'explicitCenter requires both x and y'
    )
  }
  if (placement.kind !== 'explicitCenter' && (hasX || hasY))
  {
    addIssue(
      issues,
      'media.placement_coordinates_forbidden',
      pointer(path, 'placement'),
      'non-explicit costume placement cannot carry x or y'
    )
  }
}

export function inspectSemanticEditBatchV1(
  value: unknown,
  limitOverrides?: Partial<SemanticBatchValidationLimits>
): SemanticBatchInspectionV1
{
  const issues: SemanticValidationIssue[] = []
  const limits = mergeLimits(SEMANTIC_BATCH_VALIDATION_LIMITS, limitOverrides)
  validateStructuredBounds(value, limits, issues)
  if (!isObject(value) || !Array.isArray(value.operations))
    return {
      validation: finish(issues),
      metrics: { describedBlockNodes: 0 },
    }

  const operations = value.operations
  const positions = new Map<string, number[]>()
  for (let index = 0; index < operations.length; index += 1)
  {
    const operation = operations[index]
    if (!isObject(operation) || typeof operation.opId !== 'string') continue
    const matches = positions.get(operation.opId) ?? []
    matches.push(index)
    positions.set(operation.opId, matches)
    if (matches.length > 1)
    {
      addIssue(
        issues,
        'batch.op_id_duplicate',
        pointer(pointer('/operations', index), 'opId'),
        `opId duplicates operation ${matches[0] ?? 0}`
      )
    }
  }

  const metadata: OperationMetadata[] = []
  const createdReferences: CreatedReference[][] = []
  let batchBlockNodes = 0
  let batchBlockLimitReported = false
  for (let index = 0; index < operations.length; index += 1)
  {
    const operation = operations[index]
    const path = pointer('/operations', index)
    if (!isObject(operation))
    {
      metadata.push({
        operation: {},
        path,
        row: null,
        declarations: [],
        declarationKeys: new Map(),
        procedureParameters: new Map(),
      })
      createdReferences.push([])
      continue
    }
    const item = collectOperationMetadata(operation, path, issues, limits)
    metadata.push(item)
    if (item.row === null && typeof operation.kind === 'string')
    {
      addIssue(
        issues,
        'batch.operation_kind_unknown',
        pointer(path, 'kind'),
        'operation kind is absent from OPERATION_REVIEW_ROWS'
      )
    }
    validatePropertyEdits(operation, path, issues)
    createdReferences.push(validateOperationObjects(item, issues))
    validateMediaPlacement(operation, path, issues)

    const state: ValidationState = {
      issues,
      blockNodes: batchBlockNodes,
      blockLimitReported: batchBlockLimitReported,
      limits,
      procedureParameters: item.procedureParameters,
      ownerTargetKind: inferredTargetKind(operation.target),
    }
    scanSemanticSurfaces(operation, path, state)
    batchBlockNodes = state.blockNodes
    batchBlockLimitReported = state.blockLimitReported
  }

  for (let index = 0; index < metadata.length; index += 1)
  {
    const item = metadata[index]
    if (item === undefined) continue
    for (const created of createdReferences[index] ?? [])
    {
      validateCreatedReference(
        created.reference,
        created.path,
        index,
        positions,
        metadata,
        issues
      )
    }
  }

  return {
    validation: finish(issues),
    metrics: { describedBlockNodes: batchBlockNodes },
  }
}

export function validateSemanticEditBatch(
  value: unknown,
  limitOverrides?: Partial<SemanticBatchValidationLimits>
): SemanticValidationResult
{
  return inspectSemanticEditBatchV1(value, limitOverrides).validation
}

export function validateSemanticBlockTree(
  value: unknown,
  context: BlockContext = 'any',
  limitOverrides?: Partial<SemanticBatchValidationLimits>
): SemanticValidationResult
{
  const issues: SemanticValidationIssue[] = []
  const limits = mergeLimits(SEMANTIC_BATCH_VALIDATION_LIMITS, limitOverrides)
  validateStructuredBounds(value, limits, issues)
  const state: ValidationState = {
    issues,
    blockNodes: 0,
    blockLimitReported: false,
    limits,
    procedureParameters: new Map(),
    ownerTargetKind: null,
  }
  validateBlockTree(value, '', context, state, 1)
  return finish(issues)
}

export function validateSemanticStatementSequence(
  value: unknown,
  limitOverrides?: Partial<SemanticBatchValidationLimits>
): SemanticValidationResult
{
  const issues: SemanticValidationIssue[] = []
  const limits = mergeLimits(SEMANTIC_BATCH_VALIDATION_LIMITS, limitOverrides)
  validateStructuredBounds(value, limits, issues)
  const state: ValidationState = {
    issues,
    blockNodes: 0,
    blockLimitReported: false,
    limits,
    procedureParameters: new Map(),
    ownerTargetKind: null,
  }
  validateStatementSequence(value, '', state, 1)
  return finish(issues)
}

interface SemanticValidationVector
{
  id: string
  domain:
    | 'changeContract'
    | 'editBatch'
    | 'blockTree'
    | 'statementSequence'
    | 'scenarioPolicy'
  value: unknown
  expectedValid: boolean
  expectedIssueCodes: readonly SemanticValidationIssueCode[]
}

const REVIEW_LANES = REQUIRED_LANES.map((lane) => ({
  lane,
  disposition:
    lane === 'projectPreflight' || lane === 'officialHeadless'
      ? 'required'
      : 'optional',
  ...(lane === 'projectPreflight' || lane === 'officialHeadless'
    ? { requiredUnavailableResult: 'unavailable' }
    : {}),
}))

const REVIEW_CONTRACT = {
  entityBindings: [],
  allowedOperationKinds: ['comment.move'],
  allowedSemanticScopes: [],
  requiredStructuralChanges: [
    {
      objectiveId: 'delta',
      kind: 'deltaContains',
    },
  ],
  allowedStructuralChanges: [],
  stateProjectionMasks: [],
  cloneProjectionMasks: [],
  visualProjectionMasks: [],
  policyBindings: [],
  evaluationPlans: [
    {
      planId: 'export',
      planClass: 'behavioralEdit',
      requiredForExport: true,
      requiredRuntimeChanges: [
        {
          objectiveId: 'changed',
          kind: 'runtimeOutcome',
          scenarioId: 'scenario',
          lane: 'officialHeadless',
          ok: true,
        },
      ],
      preservationLenses: [
        {
          lensKind: 'finalState',
          scenarioId: 'scenario',
          lane: 'officialHeadless',
          required: true,
        },
      ],
      laneRequirements: REVIEW_LANES,
    },
  ],
  exportRequiredPlanId: 'export',
  limitOverrides: [],
}

const REVIEW_BATCH_HEAD = {
  schemaVersion: 1,
  expected: {},
}

export const SEMANTIC_VALIDATION_VECTORS = [
  {
    id: 'valid-minimum-review-contract',
    domain: 'changeContract',
    value: REVIEW_CONTRACT,
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'duplicate-contract-ids-and-missing-delta',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      entityBindings: [
        { bindingKey: 'entity', bindingKind: 'existing' },
        { bindingKey: 'entity', bindingKind: 'future' },
      ],
      requiredStructuralChanges: [],
      limitOverrides: [
        { key: 'impactBudgetLimit' },
        { key: 'impactBudgetLimit' },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'contract.binding_key_duplicate',
      'contract.limit_key_duplicate',
      'contract.delta_contains_missing',
    ],
  },
  {
    id: 'duplicate-contract-binding-semantic-identity',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      entityBindings: [
        {
          bindingKey: 'first',
          bindingKind: 'existing',
          entityKind: 'target',
          entitySubtype: 'sprite',
          sourceLocationSha256: 'location',
        },
        {
          bindingKey: 'second',
          bindingKind: 'existing',
          entityKind: 'target',
          entitySubtype: 'sprite',
          sourceLocationSha256: 'location',
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['contract.binding_identity_duplicate'],
  },
  {
    id: 'future-creator-and-scope-operation-must-be-allowed',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      entityBindings: [
        {
          bindingKey: 'future',
          bindingKind: 'future',
          entityKind: 'target',
          entitySubtype: 'sprite',
          expectedCreatorOperationKind: 'target.addSprite',
        },
      ],
      allowedSemanticScopes: [
        {
          scopeSubjectKind: 'entity',
          operationKind: 'target.addSprite',
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'contract.scope_operation_not_allowed',
      'contract.future_creator_operation_not_allowed',
    ],
  },
  {
    id: 'policy-reference-kind-is-exact',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      policyBindings: [
        { bindingId: 'scenario', kind: 'runtime', semanticSha256: 'scenario' },
        { bindingId: 'runtime', kind: 'runtime', semanticSha256: 'runtime' },
        { bindingId: 'lens', kind: 'lens', semanticSha256: 'lens' },
      ],
      evaluationPlans: [
        {
          ...REVIEW_CONTRACT.evaluationPlans[0],
          scenarioPolicySha256s: ['scenario'],
          runtimePolicySha256: 'runtime',
          preservationLenses: [
            {
              ...REVIEW_CONTRACT.evaluationPlans[0]?.preservationLenses[0],
              lensPolicySha256: 'lens',
            },
          ],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['contract.policy_reference_kind'],
  },
  {
    id: 'runtime-objective-must-be-identical-across-distinct-lanes',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      evaluationPlans: [
        {
          ...REVIEW_CONTRACT.evaluationPlans[0],
          requiredRuntimeChanges: [
            {
              objectiveId: 'same',
              kind: 'runtimeOutcome',
              scenarioId: 'first',
              lane: 'officialHeadless',
              ok: true,
            },
            {
              objectiveId: 'same',
              kind: 'runtimeOutcome',
              scenarioId: 'second',
              lane: 'officialHeadless',
              ok: true,
            },
          ],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'contract.runtime_objective_mismatch',
      'contract.runtime_objective_lane_duplicate',
    ],
  },
  {
    id: 'required-runtime-outcome-must-be-positive',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      evaluationPlans: [
        {
          ...REVIEW_CONTRACT.evaluationPlans[0],
          requiredRuntimeChanges: [
            {
              objectiveId: 'failure',
              kind: 'runtimeOutcome',
              scenarioId: 'scenario',
              lane: 'officialHeadless',
              ok: false,
            },
          ],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['contract.runtime_change_not_positive'],
  },
  {
    id: 'reversed-ticks-and-overflowing-region',
    domain: 'changeContract',
    value: {
      ...REVIEW_CONTRACT,
      evaluationPlans: [
        {
          ...REVIEW_CONTRACT.evaluationPlans[0],
          requiredRuntimeChanges: [
            {
              objectiveId: 'visual',
              kind: 'visualCriterion',
              scenarioId: 'scenario',
              lane: 'officialHeadless',
              evidenceWindow: {
                windowKind: 'tickRange',
                firstTick: 4,
                lastTick: 3,
              },
              region: { x: 0.8, y: 0, width: 0.3, height: 1 },
            },
          ],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'policy.tick_range_reversed',
      'policy.normalized_region_invalid',
    ],
  },
  {
    id: 'valid-backward-created-target',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        { opId: 'creator', kind: 'target.addSprite' },
        {
          opId: 'consumer',
          kind: 'media.addCostume',
          target: {
            refKind: 'created',
            entityKind: 'target',
            opId: 'creator',
            slot: { slotKind: 'fixed', name: 'target' },
          },
        },
      ],
    },
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'forward-created-result-and-kind-mismatch',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'consumer',
          kind: 'media.addCostume',
          target: {
            refKind: 'created',
            entityKind: 'media',
            opId: 'creator',
            slot: { slotKind: 'fixed', name: 'target' },
          },
        },
        { opId: 'creator', kind: 'target.addSprite' },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.created_ref_not_backward'],
  },
  {
    id: 'backward-created-result-kind-mismatch',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        { opId: 'creator', kind: 'target.addSprite' },
        {
          opId: 'consumer',
          kind: 'media.addCostume',
          target: {
            refKind: 'created',
            entityKind: 'media',
            opId: 'creator',
            slot: { slotKind: 'fixed', name: 'target' },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.created_ref_entity_kind'],
  },
  {
    id: 'undeclared-dynamic-created-result',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'creator',
          kind: 'script.add',
          root: {
            rootKind: 'statementSequence',
            value: {
              blocks: [
                {
                  nodeKind: 'ordinary',
                  localAlias: 'known',
                  opcode: 'looks_show',
                  fields: [],
                  inputs: [],
                },
              ],
            },
          },
        },
        {
          opId: 'consumer',
          kind: 'block.remove',
          block: {
            refKind: 'created',
            entityKind: 'block',
            opId: 'creator',
            slot: { slotKind: 'blockAlias', alias: 'unknown' },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'batch.created_ref_slot_missing',
      'batch.created_ref_slot_key_missing',
    ],
  },
  {
    id: 'valid-backward-created-block-alias',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'creator',
          kind: 'script.add',
          root: {
            rootKind: 'statementSequence',
            value: {
              blocks: [
                {
                  nodeKind: 'ordinary',
                  localAlias: 'shown',
                  opcode: 'looks_show',
                  fields: [],
                  inputs: [],
                },
              ],
            },
          },
        },
        {
          opId: 'consumer',
          kind: 'block.remove',
          block: {
            refKind: 'created',
            entityKind: 'block',
            opId: 'creator',
            slot: { slotKind: 'blockAlias', alias: 'shown' },
          },
        },
      ],
    },
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'retained-procedure-parameter-is-not-a-created-result',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'creator',
          kind: 'procedure.updateSignature',
          signature: {
            parts: [
              { kind: 'label', text: 'use' },
              {
                kind: 'parameter',
                localKey: 'value',
                name: 'value',
                parameterType: 'stringOrNumber',
              },
            ],
          },
          parameterLineage: [
            {
              parameterLocalKey: 'value',
              lineage: {
                kind: 'retain',
                existingParameter: {
                  refKind: 'handle',
                  entityKind: 'parameter',
                  token: 'old',
                },
              },
            },
          ],
          prototypeReporters: [
            {
              existingParameter: {
                refKind: 'handle',
                entityKind: 'parameter',
                token: 'old',
              },
              disposition: {
                kind: 'preserveExisting',
                parameterLocalKey: 'value',
              },
            },
          ],
          bodyParameterReporters: [
            {
              existingParameter: {
                refKind: 'handle',
                entityKind: 'parameter',
                token: 'old',
              },
              disposition: {
                kind: 'retainMapped',
                parameterLocalKey: 'value',
              },
            },
          ],
          callSites: [],
        },
        {
          opId: 'consumer',
          kind: 'procedure.setCallArgument',
          parameter: {
            refKind: 'created',
            entityKind: 'parameter',
            opId: 'creator',
            slot: { slotKind: 'parameter', localKey: 'value' },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'batch.created_ref_slot_missing',
      'batch.created_ref_slot_key_missing',
    ],
  },
  {
    id: 'unproduced-conditional-root-result',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'creator',
          kind: 'block.setInput',
          value: { valueKind: 'literal', value: 1 },
        },
        {
          opId: 'consumer',
          kind: 'block.remove',
          block: {
            refKind: 'created',
            entityKind: 'block',
            opId: 'creator',
            slot: { slotKind: 'fixed', name: 'rootBlock' },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.created_ref_slot_missing'],
  },
  {
    id: 'occurrence-selection-not-advertised-for-authored-root',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'script',
          kind: 'script.add',
          root: {
            rootKind: 'statementSequence',
            value: {
              blocks: [
                {
                  nodeKind: 'ordinary',
                  opcode: 'event_broadcast',
                  fields: [],
                  inputs: [
                    {
                      name: 'BROADCAST_INPUT',
                      value: {
                        valueKind: 'entity',
                        value: {
                          refKind: 'structural',
                          selectorKind: 'matchSet',
                          entityKind: 'declaration',
                          expectedMatchCount: 2,
                          selection: { kind: 'occurrence', zeroBasedIndex: 1 },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.occurrence_selection_not_allowed'],
  },
  {
    id: 'occurrence-index-outside-advertised-selection',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'rename',
          kind: 'target.renameSprite',
          target: {
            refKind: 'structural',
            selectorKind: 'matchSet',
            entityKind: 'target',
            expectedMatchCount: 2,
            selection: { kind: 'occurrence', zeroBasedIndex: 2 },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.occurrence_selection_out_of_range'],
  },
  {
    id: 'valid-advertised-occurrence-selection',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'rename',
          kind: 'target.renameSprite',
          target: {
            refKind: 'structural',
            selectorKind: 'matchSet',
            entityKind: 'target',
            expectedMatchCount: 2,
            selection: { kind: 'occurrence', zeroBasedIndex: 1 },
          },
        },
      ],
    },
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'occurrence-cannot-select-a-singleton',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'rename',
          kind: 'target.renameSprite',
          target: {
            refKind: 'structural',
            selectorKind: 'matchSet',
            entityKind: 'target',
            expectedMatchCount: 1,
            selection: { kind: 'occurrence', zeroBasedIndex: 0 },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.occurrence_selection_cardinality'],
  },
  {
    id: 'duplicate-property-edit',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'properties',
          kind: 'target.setSpriteProperties',
          edits: [{ property: 'x' }, { property: 'x' }],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.property_duplicate'],
  },
  {
    id: 'noncanonical-procedure-signature',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'procedure',
          kind: 'procedure.add',
          signature: {
            parts: [
              { kind: 'label', text: 'do' },
              { kind: 'label', text: ' now' },
              {
                kind: 'parameter',
                localKey: 'value',
                name: 'value',
                parameterType: 'stringOrNumber',
              },
            ],
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'procedure.label_adjacent',
      'procedure.label_noncanonical',
    ],
  },
  {
    id: 'procedure-parameter-type-and-default-must-agree',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'procedure',
          kind: 'procedure.add',
          signature: {
            parts: [
              { kind: 'label', text: 'check' },
              {
                kind: 'parameter',
                localKey: 'booleanValue',
                name: 'boolean value',
                parameterType: 'boolean',
                defaultValue: 'false',
              },
              {
                kind: 'parameter',
                localKey: 'unknownValue',
                name: 'unknown value',
                parameterType: 'unknown',
                defaultValue: false,
              },
            ],
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'procedure.parameter_default_type',
      'procedure.parameter_type_invalid',
    ],
  },
  {
    id: 'duplicate-procedure-mapping-key',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'procedure',
          kind: 'procedure.updateSignature',
          signature: {
            parts: [
              { kind: 'label', text: 'do' },
              {
                kind: 'parameter',
                localKey: 'value',
                name: 'value',
                parameterType: 'stringOrNumber',
              },
            ],
          },
          parameterLineage: [
            { parameterLocalKey: 'value', lineage: { kind: 'create' } },
            {
              parameterLocalKey: 'value',
              lineage: { kind: 'retain', existingParameter: {} },
            },
          ],
          callSites: [],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: [
      'procedure.parameter_lineage_mismatch',
      'procedure.mapping_key_duplicate',
    ],
  },
  {
    id: 'created-procedure-parameter-cannot-preserve-old-call-input',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'procedure',
          kind: 'procedure.updateSignature',
          signature: {
            parts: [
              { kind: 'label', text: 'do' },
              {
                kind: 'parameter',
                localKey: 'newValue',
                name: 'value',
                parameterType: 'stringOrNumber',
              },
            ],
          },
          parameterLineage: [
            { parameterLocalKey: 'newValue', lineage: { kind: 'create' } },
          ],
          prototypeReporters: [],
          bodyParameterReporters: [],
          callSites: [
            {
              call: { refKind: 'handle', token: 'call' },
              arguments: [
                {
                  parameterLocalKey: 'newValue',
                  source: {
                    kind: 'preserveParameter',
                    existingParameter: {
                      refKind: 'handle',
                      token: 'old',
                    },
                  },
                },
              ],
              removedArguments: [],
            },
          ],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['procedure.call_source_lineage_mismatch'],
  },
  {
    id: 'self-procedure-reference-is-body-local',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'script',
          kind: 'script.add',
          root: {
            rootKind: 'statementSequence',
            value: {
              blocks: [
                {
                  nodeKind: 'procedureCall',
                  procedure: { refKind: 'selfProcedure' },
                  arguments: [],
                },
              ],
            },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['batch.self_procedure_context'],
  },
  {
    id: 'valid-procedure-local-parameter-and-self-call',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'procedure',
          kind: 'procedure.add',
          signature: {
            parts: [
              { kind: 'label', text: 'repeat' },
              {
                kind: 'parameter',
                localKey: 'value',
                name: 'value',
                parameterType: 'stringOrNumber',
              },
            ],
          },
          body: {
            blocks: [
              {
                nodeKind: 'procedureCall',
                procedure: { refKind: 'selfProcedure' },
                arguments: [
                  {
                    parameter: {
                      refKind: 'procedureLocalParameter',
                      localKey: 'value',
                    },
                    value: {
                      valueKind: 'block',
                      value: {
                        nodeKind: 'parameterReporter',
                        parameter: {
                          refKind: 'procedureLocalParameter',
                          localKey: 'value',
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'cap-before-successor',
    domain: 'statementSequence',
    value: {
      blocks: [
        {
          nodeKind: 'ordinary',
          opcode: 'control_delete_this_clone',
          fields: [],
          inputs: [],
        },
        {
          nodeKind: 'ordinary',
          opcode: 'looks_show',
          fields: [],
          inputs: [],
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['block.cap_not_last'],
  },
  {
    id: 'descriptor-name-set-mismatch',
    domain: 'blockTree',
    value: {
      nodeKind: 'ordinary',
      opcode: 'motion_gotoxy',
      fields: [{ name: 'RAW', value: { valueKind: 'text', value: 'x' } }],
      inputs: [{ name: 'X', value: { valueKind: 'literal', value: 0 } }],
    },
    expectedValid: false,
    expectedIssueCodes: ['block.field_unknown', 'block.input_missing'],
  },
  {
    id: 'valid-descriptor-field-input-and-context',
    domain: 'statementSequence',
    value: {
      blocks: [
        {
          nodeKind: 'ordinary',
          opcode: 'motion_gotoxy',
          fields: [],
          inputs: [
            { name: 'X', value: { valueKind: 'literal', value: 0 } },
            { name: 'Y', value: { valueKind: 'literal', value: 1 } },
          ],
        },
      ],
    },
    expectedValid: true,
    expectedIssueCodes: [],
  },
  {
    id: 'descriptor-entity-subtype-is-not-display-inference',
    domain: 'blockTree',
    value: {
      nodeKind: 'ordinary',
      opcode: 'event_whenbroadcastreceived',
      fields: [
        {
          name: 'BROADCAST_OPTION',
          value: {
            valueKind: 'entity',
            value: {
              refKind: 'structural',
              selectorKind: 'exactLocation',
              entityKind: 'declaration',
              location: { declarationKind: 'variable' },
            },
          },
        },
      ],
      inputs: [],
    },
    expectedValid: false,
    expectedIssueCodes: ['block.entity_subtype_mismatch'],
  },
  {
    id: 'sprite-only-descriptor-rejects-known-stage-owner',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'stage-script',
          kind: 'script.add',
          target: {
            refKind: 'structural',
            selectorKind: 'exactLocation',
            entityKind: 'target',
            location: { targetKind: 'stage' },
          },
          root: {
            rootKind: 'statementSequence',
            value: {
              blocks: [
                {
                  nodeKind: 'ordinary',
                  opcode: 'looks_show',
                  fields: [],
                  inputs: [],
                },
              ],
            },
          },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['block.owner_target_invalid'],
  },
  {
    id: 'conditional-media-placement',
    domain: 'editBatch',
    value: {
      ...REVIEW_BATCH_HEAD,
      operations: [
        {
          opId: 'costume',
          kind: 'media.addCostume',
          placement: { kind: 'explicitCenter', x: 0 },
        },
      ],
    },
    expectedValid: false,
    expectedIssueCodes: ['media.placement_coordinates_missing'],
  },
  {
    id: 'unsafe-fixed-date',
    domain: 'scenarioPolicy',
    value: { fixedDateMs: Number.MAX_SAFE_INTEGER + 1 },
    expectedValid: false,
    expectedIssueCodes: ['policy.fixed_date_not_safe_integer'],
  },
  {
    id: 'valid-normalized-region-on-inclusive-bounds',
    domain: 'scenarioPolicy',
    value: {
      normalizedRegion: { x: 0.25, y: 0, width: 0.75, height: 1 },
    },
    expectedValid: true,
    expectedIssueCodes: [],
  },
] as const satisfies readonly SemanticValidationVector[]

function resolveReviewSchemaNode(
  model: SchemaModel,
  node: SchemaNode
): SchemaNode
{
  let current = node
  const visited = new Set<string>()
  while (current.kind === 'ref')
  {
    if (visited.has(current.name))
      throw new Error(`unproductive review sample ref ${current.name}`)
    visited.add(current.name)
    const resolved = model.definitions[current.name]
    if (resolved === undefined)
      throw new Error(`missing review sample ref ${current.name}`)
    current = resolved
  }
  return current
}

function minimumReviewSchemaValue(
  model: SchemaModel,
  node: SchemaNode = model.root,
  depth = 0,
  ordinal = 0
): unknown
{
  if (depth > 128) throw new Error('review sample schema depth exceeded')
  const resolved = resolveReviewSchemaNode(model, node)
  switch (resolved.kind)
  {
    case 'string':
    {
      const minimum = resolved.minLength ?? resolved.utf8MinBytes ?? 0
      if (resolved.pattern === '^[0-9a-f]{64}$') return '0'.repeat(64)
      if (resolved.pattern === '^[A-Za-z0-9_-]{87}$') return 'a'.repeat(87)
      if (resolved.pattern === '^[A-Za-z0-9_-]{108}$') return 'a'.repeat(108)
      if (resolved.pattern?.startsWith('^scratch-edit://artifact/'))
        return `scratch-edit://artifact/${'a'.repeat(108)}`
      return 'a'.repeat(Math.max(1, minimum))
    }
    case 'literalString':
      return resolved.value
    case 'enumString':
      return resolved.values[ordinal % resolved.values.length]
    case 'literalBoolean':
    case 'literalInteger':
      return resolved.value
    case 'number':
    case 'integer':
      return resolved.minimum ?? 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array':
      return Array.from({ length: resolved.minItems ?? 0 }, (_item, index) =>
        minimumReviewSchemaValue(
          model,
          resolved.items,
          depth + 1,
          resolved.uniqueItems ? index : ordinal
        )
      )
    case 'object':
      return Object.fromEntries(
        Object.entries(resolved.fields)
          .filter(([, field]) => field.required)
          .map(([name, field]) => [
            name,
            minimumReviewSchemaValue(model, field.schema, depth + 1, ordinal),
          ])
      )
    case 'anyOf':
      return minimumReviewSchemaValue(
        model,
        resolved.variants[ordinal % resolved.variants.length] as SchemaNode,
        depth + 1,
        ordinal
      )
    case 'ref':
      throw new Error('review sample ref was not resolved')
  }
}

function hashDigit(digit: string): string
{
  return digit.repeat(64)
}

function buildSemanticallyValidChangeContractSample(): JsonObject
{
  const model = contractDefinitionSchemaModel('EditSemanticChangeContractV1')
  const value = minimumReviewSchemaValue(model) as JsonObject
  const scenarioHash = hashDigit('1')
  const runtimeHash = hashDigit('2')
  const lensHash = hashDigit('3')
  const stageRef = {
    contractRefKind: 'existing',
    entityKind: 'target',
    entitySubtype: 'stage',
    bindingKey: 'stage',
  }
  value.entityBindings = [
    {
      bindingKind: 'existing',
      bindingKey: 'stage',
      entityKind: 'target',
      entitySubtype: 'stage',
      sourceLocationSha256: hashDigit('a'),
      expectedSourceSemanticFingerprint: hashDigit('b'),
      expectedSourceContextFingerprint: hashDigit('c'),
      expectedMatchCount: 1,
    },
  ]
  value.allowedOperationKinds = ['target.setStageProperties']
  value.allowedSemanticScopes = [
    {
      scopeSubjectKind: 'entity',
      operationKind: 'target.setStageProperties',
      entityKind: 'target',
      entitySubtype: 'stage',
      locationScope: { scopeKind: 'exactEntity', entity: stageRef },
      allowedPropertyPaths: [{ surface: 'target', property: 'volume' }],
    },
  ]
  value.requiredStructuralChanges = [
    {
      objectiveId: 'requiredDelta',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'target.setStageProperties',
      semanticScopeSha256: hashDigit('4'),
      semanticChangeFingerprint: hashDigit('5'),
    },
  ]
  value.allowedStructuralChanges = [
    {
      allowanceId: 'stageVolumeTransition',
      kind: 'propertyTransition',
      entity: stageRef,
      property: { surface: 'target', property: 'volume' },
      beforeValueSha256: hashDigit('d'),
      afterValueSha256: hashDigit('e'),
    },
  ]
  value.policyBindings = [
    {
      bindingId: 'scenarioPolicy',
      kind: 'scenario',
      schemaVersion: 1,
      semanticSha256: scenarioHash,
      retainedArtifactSha256: hashDigit('6'),
    },
    {
      bindingId: 'runtimePolicy',
      kind: 'runtime',
      schemaVersion: 1,
      semanticSha256: runtimeHash,
      retainedArtifactSha256: hashDigit('7'),
    },
    {
      bindingId: 'lensPolicy',
      kind: 'lens',
      schemaVersion: 1,
      semanticSha256: lensHash,
      retainedArtifactSha256: hashDigit('8'),
    },
  ]
  value.evaluationPlans = [
    {
      planId: 'exportPlan',
      planClass: 'behavioralEdit',
      requiredForExport: true,
      scenarioPolicySha256s: [scenarioHash],
      runtimePolicySha256: runtimeHash,
      requiredRuntimeChanges: [
        {
          objectiveId: 'runtimeChange',
          kind: 'runtimeOutcome',
          scenarioId: 'scenario',
          lane: 'officialHeadless',
          ok: true,
          exactIssueMultisetSha256: hashDigit('9'),
        },
      ],
      preservationLenses: [
        {
          lensKind: 'finalState',
          scenarioId: 'scenario',
          lane: 'officialHeadless',
          lensPolicySha256: lensHash,
          required: true,
        },
      ],
      laneRequirements: REQUIRED_LANES.map((lane) =>
        lane === 'projectPreflight' || lane === 'officialHeadless'
          ? {
              lane,
              disposition: 'required',
              requiredUnavailableResult: 'unavailable',
            }
          : { lane, disposition: 'optional' }
      ),
    },
  ]
  value.exportRequiredPlanId = 'exportPlan'
  value.outputNamePolicy = {
    kind: 'exact',
    basename: 'phase-8-review.sb3',
  }

  const schemaResult = validateSchemaValue(model, value)
  if (!schemaResult.ok)
  {
    throw new Error(
      `semantically valid change-contract sample failed schema: ${JSON.stringify(schemaResult.issues)}`
    )
  }
  const semanticResult = validateSemanticChangeContract(value)
  if (!semanticResult.valid)
  {
    throw new Error(
      `semantically valid change-contract sample failed semantics: ${JSON.stringify(semanticResult.issues)}`
    )
  }
  return value
}

function buildSemanticallyValidEditBatchSample(): JsonObject
{
  const model = contractDefinitionSchemaModel('SemanticEditBatchV1')
  const value = minimumReviewSchemaValue(model) as JsonObject
  const operationModel = operationSchemaModel('target.setStageProperties')
  const operation = minimumReviewSchemaValue(
    operationModel,
    operationModel.root,
    0,
    1
  ) as JsonObject
  if (
    isObject(operation.target) &&
    isObject(operation.target.location) &&
    Object.hasOwn(operation.target.location, 'targetKind')
  )
  {
    operation.target.location.targetKind = 'stage'
  }
  value.operations = [operation]
  const schemaResult = validateSchemaValue(model, value)
  if (!schemaResult.ok)
  {
    throw new Error(
      `semantically valid edit-batch sample failed schema: ${JSON.stringify(schemaResult.issues)}`
    )
  }
  const semanticResult = validateSemanticEditBatch(value)
  if (!semanticResult.valid)
  {
    throw new Error(
      `semantically valid edit-batch sample failed semantics: ${JSON.stringify(semanticResult.issues)}`
    )
  }
  return value
}

export const SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE =
  buildSemanticallyValidChangeContractSample()

export const SEMANTICALLY_VALID_EDIT_BATCH_SAMPLE =
  buildSemanticallyValidEditBatchSample()

export const SEMANTIC_VALIDATION_RESIDUALS = [
  'standard advertised JSON Schema is a necessary-condition superset; the strict parser must enforce exact UTF-8, NFC, NUL, surrogate, finite-number, negative-zero, and safe-integer rules before dispatch',
  'existing handle and structural selector resolution still needs the retained semantic index',
  'descriptor owner target kind and existing procedure parameter types need resolved lineage',
  'future contract binding creation matching needs resolved creation projections and fingerprints',
  'scenario hash to policy artifact and scenarioId resolution needs the host policy registry',
  'conditional fixed result production needs the resolved builder plan before a result can be consumed',
  'name activation, collision, read/write/delete sets, and preservation attribution need runtime indexes',
] as const
