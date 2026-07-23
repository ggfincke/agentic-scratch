// packages/ir/src/edit/core-block-catalog.ts
// expose pinned curated block evidence & fail-closed raw graph validation

import {
  isBlockEntry,
  type Block,
  type BlockEntry,
  type BlockInput,
  type InputPrimitive,
} from '@scratch-agent/sb3'

import {
  VANILLA_CORE_DESCRIPTORS,
  type VanillaCoreDescriptor,
} from './catalog.js'
import { semanticHashV1 } from './hash-domains.js'
import { deepFreeze } from './immutable.js'
import { ownRecordKeys, ownRecordValue } from './own-record.js'

const CURATED_CORE_BLOCK_PROFILE_ID = 'scratch-core-curated-v1' as const
const CURATED_CORE_BLOCK_PROFILE_VERSION = 1 as const
export const APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256 =
  '89f387b05b05c7ee48824d339103ad09dac257634b89974ceb3c1c38905b732d' as const
export const APPROVED_CURATED_CORE_BUILDER_POLICY_SHA256 =
  'cae42b37b69e96614c05f64b2dc553c01aa902ac567e425a592f334d842a438f' as const

export type CuratedCoreBlockDescriptorV1 = VanillaCoreDescriptor

const DESCRIPTOR_BY_OPCODE = new Map<string, CuratedCoreBlockDescriptorV1>(
  VANILLA_CORE_DESCRIPTORS.map((descriptor) => [descriptor.opcode, descriptor])
)

const CURATED_CORE_BUILDER_POLICY = deepFreeze({
  idAuthority: 'ProjectIR.uids',
  recordPrototype: 'null',
  booleanScalarLiteral: 'canonical-text-true-or-false',
  optionalEmptyInput: 'omit-exact-input-key',
  topLevelWorkspace: 'finite-x-y-on-root-only',
  entityReferences: 'exact-injected-resolution-with-read-evidence',
})

export const CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1 = deepFreeze({
  schemaVersion: 1 as const,
  profileId: CURATED_CORE_BLOCK_PROFILE_ID,
  profileVersion: CURATED_CORE_BLOCK_PROFILE_VERSION,
  authority: 'approved-a0-reviewed-subset' as const,
  descriptorCount: VANILLA_CORE_DESCRIPTORS.length,
  authorableDescriptorCount: VANILLA_CORE_DESCRIPTORS.filter(
    (descriptor) => descriptor.availability === 'supported'
  ).length,
  builderOnlyDescriptorCount: VANILLA_CORE_DESCRIPTORS.filter(
    (descriptor) => descriptor.availability === 'builderOnly'
  ).length,
  descriptorProfileSha256: semanticHashV1('capability-profile', {
    component: 'block-descriptor-profile',
    schemaVersion: 1,
    value: VANILLA_CORE_DESCRIPTORS,
  }),
  builderPolicy: CURATED_CORE_BUILDER_POLICY,
  builderPolicySha256: semanticHashV1('capability-profile', {
    component: 'curated-core-block-builder-policy',
    schemaVersion: 1,
    value: CURATED_CORE_BUILDER_POLICY,
  }),
  approvedCatalogArtifact: {
    path: 'review/phase-8-a0/generated/catalogs/vanilla-core-descriptors-v1.json',
    sha256: '2046d25064b2b1b2858a73486d272ae868374ac319f23b116575609fcaac578e',
  },
  approvedReconciliationArtifact: {
    path: 'review/phase-8-a0/generated/inventory/reconciliation-v1.json',
    sha256: '1efbcb5bae0201843cd15e648ff17fa0263aef5b42b8b3e37c96d82feecacf45',
    reconciledOpcodeCount: 173,
    matchedDescriptorCount: 13,
    mismatchedDescriptorCount: 0,
  },
  pinnedSources: [
    {
      package: 'scratch-blocks',
      version: '2.1.19',
      entrySha256:
        '1f54f44fbef63884613041ece13787c27e003c2686485619eaf0832272fdafc9',
    },
    {
      package: '@scratch/scratch-vm',
      version: '14.1.0',
      entrySha256:
        '65df8f26399b1541530afe8e477bc31e8baeaff96caeea00960fde9515821734',
    },
  ],
  oraclePolicy:
    'pinned oracle metadata cross-checks the reviewed catalog but is never runtime authority',
})

if (
  VANILLA_CORE_DESCRIPTORS.length !== 13 ||
  DESCRIPTOR_BY_OPCODE.size !== VANILLA_CORE_DESCRIPTORS.length ||
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.authorableDescriptorCount !== 12 ||
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.builderOnlyDescriptorCount !== 1 ||
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.descriptorProfileSha256 !==
    APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256 ||
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.builderPolicySha256 !==
    APPROVED_CURATED_CORE_BUILDER_POLICY_SHA256
)
{
  throw new Error('curated core block catalog no longer matches approved A0')
}

function curatedCoreDescriptorV1(
  opcode: string
): CuratedCoreBlockDescriptorV1 | null
{
  return DESCRIPTOR_BY_OPCODE.get(opcode) ?? null
}

export function curatedAuthorableDescriptorV1(
  opcode: string
): CuratedCoreBlockDescriptorV1 | null
{
  const descriptor = curatedCoreDescriptorV1(opcode)
  return descriptor?.availability === 'supported' &&
    descriptor.safeBuilderKind === 'ordinaryBlock'
    ? descriptor
    : null
}

interface CuratedRawBlockIssueV1
{
  readonly code:
    | 'block-not-object'
    | 'unknown-opcode'
    | 'not-authorable'
    | 'unknown-own-key'
    | 'invalid-link'
    | 'invalid-scalar-property'
    | 'field-name-set'
    | 'field-shape'
    | 'input-name-set'
    | 'input-shape'
  readonly path: string
  readonly message: string
}

interface CuratedRawBlockValidationV1
{
  readonly ok: boolean
  readonly descriptor: CuratedCoreBlockDescriptorV1 | null
  readonly issues: readonly CuratedRawBlockIssueV1[]
  readonly safeForStructuralEdit: boolean
}

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
])

function addIssue(
  issues: CuratedRawBlockIssueV1[],
  code: CuratedRawBlockIssueV1['code'],
  path: string,
  message: string
): void
{
  issues.push({ code, path, message })
}

function ownValue(value: object, key: string): unknown
{
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor?.enumerable === true && 'value' in descriptor
    ? descriptor.value
    : undefined
}

function exactMemberSet(
  record: unknown,
  required: readonly string[],
  optional: readonly string[]
): boolean
{
  if (record === null || typeof record !== 'object' || Array.isArray(record))
    return false
  const actual = ownRecordKeys(record as Readonly<Record<string, unknown>>)
  const allowed = new Set([...required, ...optional])
  return (
    required.every((name) => actual.includes(name)) &&
    actual.every((name) => allowed.has(name))
  )
}

function isPrimitive(
  value: unknown,
  expectedTag: number
): value is InputPrimitive
{
  if (!Array.isArray(value) || value[0] !== expectedTag) return false
  if (expectedTag === 11)
  {
    return (
      value.length === 3 &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
    )
  }
  return (
    value.length === 2 &&
    (typeof value[1] === 'string' || typeof value[1] === 'number') &&
    (expectedTag === 10 ||
      (typeof value[1] === 'number'
        ? Number.isFinite(value[1])
        : Number.isFinite(Number(value[1]))))
  )
}

function inputMatchesDescriptor(
  input: unknown,
  descriptorInput: CuratedCoreBlockDescriptorV1['requiredInputs'][number]
): input is BlockInput
{
  if (!Array.isArray(input)) return false
  if (descriptorInput.connection === 'entityMenu')
    return input.length === 2 && input[0] === 1 && isPrimitive(input[1], 11)
  if (
    descriptorInput.connection === 'boolean' ||
    descriptorInput.connection === 'substack'
  )
  {
    return input.length === 2 && input[0] === 2 && typeof input[1] === 'string'
  }
  const shadow = descriptorInput.canonicalShadow
  if (shadow?.kind !== 'primitive') return false
  return (
    (input.length === 2 &&
      input[0] === 1 &&
      isPrimitive(input[1], shadow.sb3PrimitiveTag)) ||
    (input.length === 3 &&
      input[0] === 3 &&
      typeof input[1] === 'string' &&
      isPrimitive(input[2], shadow.sb3PrimitiveTag))
  )
}

function fieldMatchesDescriptor(
  field: unknown,
  descriptorField: CuratedCoreBlockDescriptorV1['requiredFields'][number]
): boolean
{
  if (!Array.isArray(field)) return false
  if (descriptorField.requiredEntitySubtype !== null)
  {
    return (
      field.length === 2 &&
      typeof field[0] === 'string' &&
      typeof field[1] === 'string'
    )
  }
  return (
    field.length === 1 &&
    (field[0] === null ||
      typeof field[0] === 'string' ||
      (typeof field[0] === 'number' && Number.isFinite(field[0])))
  )
}

export function validateExistingCuratedBlockV1(
  block: BlockEntry
): CuratedRawBlockValidationV1
{
  const issues: CuratedRawBlockIssueV1[] = []
  if (!isBlockEntry(block))
  {
    addIssue(
      issues,
      'block-not-object',
      '/',
      'top-level primitives are not curated object-form blocks'
    )
    return { ok: false, descriptor: null, issues, safeForStructuralEdit: false }
  }
  const descriptor = curatedCoreDescriptorV1(block.opcode)
  if (descriptor === null)
    addIssue(
      issues,
      'unknown-opcode',
      '/opcode',
      'opcode is outside the curated profile'
    )
  else if (
    descriptor.availability !== 'supported' ||
    descriptor.safeBuilderKind !== 'ordinaryBlock'
  )
  {
    addIssue(
      issues,
      'not-authorable',
      '/opcode',
      'descriptor is not an ordinary authorable block'
    )
  }
  for (const key of ownRecordKeys(
    block as unknown as Readonly<Record<string, unknown>>
  ))
  {
    if (!BLOCK_KEYS.has(key))
      addIssue(
        issues,
        'unknown-own-key',
        `/${key}`,
        'block carries opaque payload'
      )
  }
  for (const key of ['next', 'parent'] as const)
  {
    const value = ownValue(block, key)
    if (value !== undefined && value !== null && typeof value !== 'string')
      addIssue(
        issues,
        'invalid-link',
        `/${key}`,
        `${key} must be a string or null`
      )
  }
  for (const key of ['shadow', 'topLevel'] as const)
  {
    const value = ownValue(block, key)
    if (value !== undefined && typeof value !== 'boolean')
      addIssue(
        issues,
        'invalid-scalar-property',
        `/${key}`,
        `${key} must be boolean when present`
      )
  }
  for (const key of ['x', 'y'] as const)
  {
    const value = ownValue(block, key)
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      addIssue(
        issues,
        'invalid-scalar-property',
        `/${key}`,
        `${key} must be finite when present`
      )
  }
  const comment = ownValue(block, 'comment')
  if (comment !== undefined && typeof comment !== 'string')
    addIssue(
      issues,
      'invalid-scalar-property',
      '/comment',
      'comment must be an id string when present'
    )
  if (descriptor !== null)
  {
    const fields = ownValue(block, 'fields') ?? {}
    const requiredFields = descriptor.requiredFields.map((field) => field.name)
    const optionalFields = descriptor.optionalFields.map((field) => field.name)
    if (!exactMemberSet(fields, requiredFields, optionalFields))
      addIssue(
        issues,
        'field-name-set',
        '/fields',
        'field names do not match descriptor'
      )
    else
    {
      for (const fieldDescriptor of [
        ...descriptor.requiredFields,
        ...descriptor.optionalFields,
      ])
      {
        const field = ownRecordValue(
          fields as Readonly<Record<string, unknown>>,
          fieldDescriptor.name
        )
        if (
          field !== undefined &&
          !fieldMatchesDescriptor(field, fieldDescriptor)
        )
          addIssue(
            issues,
            'field-shape',
            `/fields/${fieldDescriptor.name}`,
            'field tuple does not match descriptor serialization'
          )
      }
    }
    const inputs = ownValue(block, 'inputs') ?? {}
    const requiredInputs = descriptor.requiredInputs.map((input) => input.name)
    const optionalInputs = descriptor.optionalInputs.map((input) => input.name)
    if (!exactMemberSet(inputs, requiredInputs, optionalInputs))
      addIssue(
        issues,
        'input-name-set',
        '/inputs',
        'input names do not match descriptor'
      )
    else
    {
      for (const inputDescriptor of [
        ...descriptor.requiredInputs,
        ...descriptor.optionalInputs,
      ])
      {
        const input = ownRecordValue(
          inputs as Readonly<Record<string, unknown>>,
          inputDescriptor.name
        )
        if (
          input !== undefined &&
          !inputMatchesDescriptor(input, inputDescriptor)
        )
          addIssue(
            issues,
            'input-shape',
            `/inputs/${inputDescriptor.name}`,
            'input tuple does not match descriptor connection and shadow rules'
          )
      }
    }
  }
  return {
    ok: issues.length === 0,
    descriptor,
    issues,
    safeForStructuralEdit: issues.length === 0,
  }
}

interface CuratedClosureIssueV1
{
  readonly code:
    | 'missing-root'
    | 'unsafe-block'
    | 'cycle-or-multiple-owner'
    | 'parent-mismatch'
    | 'top-level-mismatch'
    | 'successor-forbidden'
    | 'missing-child'
    | 'external-inbound'
  readonly blockId: string
  readonly path: string
  readonly message: string
}

interface CuratedClosureValidationV1
{
  readonly ok: boolean
  readonly rootId: string
  readonly blockIds: readonly string[]
  readonly attachedCommentIds: readonly string[]
  readonly issues: readonly CuratedClosureIssueV1[]
  readonly hasOpaquePayload: boolean
  readonly safeForStructuralEdit: boolean
  readonly safeForDuplication: boolean
}

interface CuratedClosureBoundaryV1
{
  readonly expectedRootParent: string | null
  readonly expectedRootTopLevel: boolean
  readonly allowedExternalOwnerId: string | null
}

const TOP_LEVEL_CURATED_CLOSURE_BOUNDARY_V1 = deepFreeze({
  expectedRootParent: null,
  expectedRootTopLevel: true,
  allowedExternalOwnerId: null,
}) satisfies CuratedClosureBoundaryV1

function ownedInputIds(
  block: Block,
  descriptor: CuratedCoreBlockDescriptorV1
): readonly { readonly id: string; readonly path: string }[]
{
  const inputs = block.inputs ?? {}
  const ids: { id: string; path: string }[] = []
  for (const inputDescriptor of [
    ...descriptor.requiredInputs,
    ...descriptor.optionalInputs,
  ])
  {
    const input = ownRecordValue(inputs, inputDescriptor.name)
    if (!input) continue
    if (
      (inputDescriptor.connection === 'boolean' ||
        inputDescriptor.connection === 'substack') &&
      typeof input[1] === 'string'
    )
    {
      ids.push({ id: input[1], path: `/inputs/${inputDescriptor.name}/1` })
    }
    else if (
      inputDescriptor.connection !== 'entityMenu' &&
      input[0] === 3 &&
      typeof input[1] === 'string'
    )
    {
      ids.push({ id: input[1], path: `/inputs/${inputDescriptor.name}/1` })
    }
  }
  return ids
}

function genericInboundIds(block: Block): readonly string[]
{
  const ids: string[] = []
  if (typeof block.next === 'string') ids.push(block.next)
  if (block.inputs !== undefined)
  {
    for (const name of ownRecordKeys(block.inputs))
    {
      const input = ownRecordValue(block.inputs, name)
      if (!input) continue
      if (typeof input[1] === 'string') ids.push(input[1])
      if (typeof input[2] === 'string') ids.push(input[2])
    }
  }
  return ids
}

export function validateCuratedClosureV1(
  blocks: Readonly<Record<string, BlockEntry>>,
  rootId: string,
  boundary: CuratedClosureBoundaryV1 = TOP_LEVEL_CURATED_CLOSURE_BOUNDARY_V1
): CuratedClosureValidationV1
{
  const issues: CuratedClosureIssueV1[] = []
  const ordered: string[] = []
  const comments: string[] = []
  const visited = new Set<string>()
  let allowedExternalInboundCount = 0
  const expectedParents = new Map<string, string | null>([
    [rootId, boundary.expectedRootParent],
  ])

  const visit = (blockId: string): void =>
  {
    if (visited.has(blockId))
    {
      issues.push({
        code: 'cycle-or-multiple-owner',
        blockId,
        path: '/',
        message: 'block is reached more than once by curated ownership edges',
      })
      return
    }
    visited.add(blockId)
    const entry = ownRecordValue(blocks, blockId)
    if (!entry || !isBlockEntry(entry))
    {
      issues.push({
        code: blockId === rootId ? 'missing-root' : 'missing-child',
        blockId,
        path: '/',
        message: 'owned block id does not resolve to an object-form block',
      })
      return
    }
    ordered.push(blockId)
    const validation = validateExistingCuratedBlockV1(entry)
    if (!validation.ok || validation.descriptor === null)
    {
      issues.push({
        code: 'unsafe-block',
        blockId,
        path: '/',
        message: validation.issues.map((issue) => issue.message).join('; '),
      })
      return
    }
    const expectedParent = expectedParents.get(blockId) ?? null
    if ((entry.parent ?? null) !== expectedParent)
    {
      issues.push({
        code: 'parent-mismatch',
        blockId,
        path: '/parent',
        message: 'raw parent does not match the unique curated owner edge',
      })
    }
    const expectedTopLevel =
      blockId === rootId ? boundary.expectedRootTopLevel : false
    if ((entry.topLevel === true) !== expectedTopLevel)
    {
      issues.push({
        code: 'top-level-mismatch',
        blockId,
        path: '/topLevel',
        message: 'only the closure root may be top level',
      })
    }
    if (entry.comment !== undefined) comments.push(entry.comment)
    const descriptor = validation.descriptor
    if (typeof entry.next === 'string')
    {
      if (
        !descriptor.context.acceptsSuccessor ||
        descriptor.context.mustTerminateSequence
      )
      {
        issues.push({
          code: 'successor-forbidden',
          blockId,
          path: '/next',
          message: 'descriptor shape cannot own a successor',
        })
      }
      expectedParents.set(entry.next, blockId)
      visit(entry.next)
    }
    for (const child of ownedInputIds(entry, descriptor))
    {
      expectedParents.set(child.id, blockId)
      visit(child.id)
    }
  }

  visit(rootId)
  for (const ownerId of ownRecordKeys(blocks))
  {
    if (visited.has(ownerId)) continue
    const entry = ownRecordValue(blocks, ownerId)
    if (!entry || !isBlockEntry(entry)) continue
    for (const targetId of genericInboundIds(entry))
    {
      if (!visited.has(targetId)) continue
      if (
        targetId === rootId &&
        ownerId === boundary.allowedExternalOwnerId &&
        boundary.expectedRootParent === ownerId
      )
      {
        allowedExternalInboundCount += 1
        if (allowedExternalInboundCount === 1) continue
      }
      issues.push({
        code: 'external-inbound',
        blockId: targetId,
        path: `/blocks/${ownerId}`,
        message: 'closure has an inbound graph edge from outside the closure',
      })
    }
  }
  const hasOpaquePayload = issues.some((issue) => issue.code === 'unsafe-block')
  return {
    ok: issues.length === 0,
    rootId,
    blockIds: ordered,
    attachedCommentIds: [...new Set(comments)].sort(),
    issues,
    hasOpaquePayload,
    safeForStructuralEdit: issues.length === 0,
    safeForDuplication: issues.length === 0,
  }
}
