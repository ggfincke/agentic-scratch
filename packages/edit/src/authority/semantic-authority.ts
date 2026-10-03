// packages/edit/src/authority/semantic-authority.ts
// resolve finite authoring profiles & bind their exact catalogs to retained edits

import {
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
  STANDARD_AUTHORING_DESCRIPTORS_V2,
  VANILLA_CORE_DESCRIPTORS,
  createCuratedCoreOperationAdaptersV1,
  createStandardOperationAdaptersV2,
  semanticHashV1,
  standardAuthoringSchemaOverlaySha256V2,
  validateCuratedClosureV1,
  validateExistingCuratedBlockV1,
  validateExistingStandardBlockV2,
  validateStandardClosureV2,
  type SemanticEditCapabilityProfileEnvelopeV1,
  type SemanticAuthoringAuthorityIdV2,
  type CuratedEntityResolverV1,
  type StandardAuthoringContextV2,
  type StandardAuthoringDescriptorV2,
  type VanillaCoreDescriptor,
  type ScriptOperationCatalogAdapterV1,
  type BlockOperationCatalogAdapterV1,
} from '@scratch-agent/ir/edit'

import type { Block, BlockEntry } from '@scratch-agent/sb3'

import {
  buildGroupGCapabilityProfileV1,
  type MediaTargetCapabilityProfileInputV1,
} from '../contracts/capabilities.js'

export type EditSemanticAuthorityIdV1 = SemanticAuthoringAuthorityIdV2

export interface EditSemanticAuthorityBindingV1
{
  readonly semanticAuthorityId?: EditSemanticAuthorityIdV1
  readonly semanticAuthoritySha256?: string
}

export interface SelectedEditSemanticAuthorityV1
{
  readonly semanticAuthorityId: EditSemanticAuthorityIdV1
  readonly semanticAuthoritySha256: string
  readonly catalogEvidence:
    | typeof CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
    | typeof STANDARD_AUTHORING_CATALOG_EVIDENCE_V2
  readonly descriptors: readonly (
    VanillaCoreDescriptor | StandardAuthoringDescriptorV2
  )[]
  readonly validateExistingBlock: (block: Block) => {
    readonly ok: boolean
    readonly safeForStructuralEdit: boolean
    readonly descriptor:
      VanillaCoreDescriptor | StandardAuthoringDescriptorV2 | null
    readonly issues: readonly unknown[]
  }
  readonly validateClosure: (
    blocks: Readonly<Record<string, BlockEntry>>,
    rootId: string
  ) => unknown
  readonly createOperationAdapters: (
    resolver: CuratedEntityResolverV1 | StandardAuthoringContextV2
  ) => {
    readonly script: ScriptOperationCatalogAdapterV1
    readonly block: BlockOperationCatalogAdapterV1
  }
}

export class EditSemanticAuthorityErrorV1 extends Error
{
  readonly code = 'edit.stale_capability_profile' as const

  constructor(message: string)
  {
    super(message)
    this.name = 'EditSemanticAuthorityErrorV1'
  }
}

export function resolveEditSemanticAuthorityV1(
  semanticAuthorityId: EditSemanticAuthorityIdV1 = 'a0-v1',
  expectedSha256?: string
): SelectedEditSemanticAuthorityV1
{
  if (semanticAuthorityId !== 'a0-v1' && semanticAuthorityId !== 'standard-v2')
    throw new EditSemanticAuthorityErrorV1(
      'unknown semantic authoring authority'
    )
  const standard = semanticAuthorityId === 'standard-v2'
  const catalogEvidence = standard
    ? STANDARD_AUTHORING_CATALOG_EVIDENCE_V2
    : CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1
  const semanticAuthoritySha256 = semanticHashV1('capability-profile', {
    kind: 'edit-semantic-authority-v1',
    semanticAuthorityId,
    catalogEvidence,
    ...(standard
      ? {
          standardSchemaOverlaySha256: standardAuthoringSchemaOverlaySha256V2(),
        }
      : {}),
  })
  if (
    expectedSha256 !== undefined &&
    expectedSha256 !== semanticAuthoritySha256
  )
    throw new EditSemanticAuthorityErrorV1(
      'retained semantic authority differs from its installed catalog'
    )
  return Object.freeze({
    semanticAuthorityId,
    semanticAuthoritySha256,
    catalogEvidence,
    descriptors: standard
      ? STANDARD_AUTHORING_DESCRIPTORS_V2
      : VANILLA_CORE_DESCRIPTORS,
    validateExistingBlock: standard
      ? validateExistingStandardBlockV2
      : validateExistingCuratedBlockV1,
    validateClosure: standard
      ? validateStandardClosureV2
      : validateCuratedClosureV1,
    createOperationAdapters: (
      resolver: CuratedEntityResolverV1 | StandardAuthoringContextV2
    ) =>
      standard
        ? createStandardOperationAdaptersV2(resolver)
        : createCuratedCoreOperationAdaptersV1(
            typeof resolver === 'function' ? resolver : resolver.resolveEntity
          ),
  })
}

export function retainedEditSemanticAuthorityV1(
  binding: EditSemanticAuthorityBindingV1
): SelectedEditSemanticAuthorityV1
{
  if (
    (binding.semanticAuthorityId === undefined) !==
    (binding.semanticAuthoritySha256 === undefined)
  )
    throw new EditSemanticAuthorityErrorV1(
      'retained semantic authority must bind both its identity & catalog hash'
    )
  return resolveEditSemanticAuthorityV1(
    binding.semanticAuthorityId,
    binding.semanticAuthoritySha256
  )
}

// old a0 records retain their exact historical shape
export function editSemanticAuthorityBindingV1(
  semanticAuthorityId: EditSemanticAuthorityIdV1
): EditSemanticAuthorityBindingV1
{
  if (semanticAuthorityId === 'a0-v1') return Object.freeze({})
  const authority = resolveEditSemanticAuthorityV1(semanticAuthorityId)
  return Object.freeze({
    semanticAuthorityId,
    semanticAuthoritySha256: authority.semanticAuthoritySha256,
  })
}

export function buildSemanticAuthorityCapabilityProfileV1(
  input: MediaTargetCapabilityProfileInputV1,
  semanticAuthorityId: EditSemanticAuthorityIdV1 = 'a0-v1'
): SemanticEditCapabilityProfileEnvelopeV1
{
  const baseline = buildGroupGCapabilityProfileV1(input)
  if (semanticAuthorityId === 'a0-v1') return baseline
  const authority = resolveEditSemanticAuthorityV1(semanticAuthorityId)
  const component = (name: string, value: unknown): string =>
    semanticHashV1('capability-profile', {
      component: name,
      schemaVersion: 1,
      semanticAuthorityId,
      semanticAuthoritySha256: authority.semanticAuthoritySha256,
      value,
    })
  const profile = {
    ...baseline.profile,
    versions: { ...baseline.profile.versions, descriptor: 2 },
    blockDescriptorProfileSha256: component(
      'block-descriptor-profile',
      authority.descriptors
    ),
    semanticFieldDomainsSha256: component(
      'semantic-field-domains',
      authority.descriptors.map((descriptor) => ({
        opcode: descriptor.opcode,
        requiredFields: descriptor.requiredFields,
        optionalFields: descriptor.optionalFields,
      }))
    ),
    semanticInputDomainsSha256: component(
      'semantic-input-domains',
      authority.descriptors.map((descriptor) => ({
        opcode: descriptor.opcode,
        requiredInputs: descriptor.requiredInputs,
        optionalInputs: descriptor.optionalInputs,
      }))
    ),
    safeMutationBuildersSha256: component('safe-mutation-builders', {
      operationBuildersSha256: baseline.profile.safeMutationBuildersSha256,
      catalogEvidence: authority.catalogEvidence,
    }),
  }
  return Object.freeze({
    profile: Object.freeze(profile),
    capabilityProfileSha256: semanticHashV1('capability-profile', profile),
  })
}

export function editCapabilityAuthorityMatchesV1(
  profile: SemanticEditCapabilityProfileEnvelopeV1,
  binding: EditSemanticAuthorityBindingV1
): boolean
{
  const authority = retainedEditSemanticAuthorityV1(binding)
  if (authority.semanticAuthorityId === 'a0-v1')
    return (
      profile.profile.versions.descriptor === 1 &&
      profile.profile.blockDescriptorProfileSha256 ===
        CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.descriptorProfileSha256
    )
  const expected = semanticHashV1('capability-profile', {
    component: 'block-descriptor-profile',
    schemaVersion: 1,
    semanticAuthorityId: authority.semanticAuthorityId,
    semanticAuthoritySha256: authority.semanticAuthoritySha256,
    value: authority.descriptors,
  })
  return (
    profile.profile.versions.descriptor === 2 &&
    profile.profile.blockDescriptorProfileSha256 === expected
  )
}
