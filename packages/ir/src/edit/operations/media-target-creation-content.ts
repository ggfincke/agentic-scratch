// packages/ir/src/edit/operations/media-target-creation-content.ts
// derive authoritative Group F media & sprite future-result semantic creation content

import type {
  ContractEntityBindingV1,
  ContractEntityRefV1,
  SemanticEditOperationMediaAddCostumeV1,
  SemanticEditOperationMediaAddSoundV1,
  SemanticEditOperationTargetAddSpriteV1,
} from '../contracts.generated.js'
import { assertSameCreationContentContractRefV1 as assertSameContractRef } from '../contracts/creation-content-contract-ref.js'
import type { SemanticCreationNormalizationContextV1 } from './script-block-creation-content.js'
import { semanticHashV1 } from '../contracts/hash-domains.js'

import type { Without } from '../support/internal-types.js'

type MediaTargetFutureContractBindingV1 = Extract<
  ContractEntityBindingV1,
  {
    bindingKind: 'future'
    entityKind: 'media' | 'target'
  }
>

export type MediaTargetCreationBindingDescriptorV1 = Without<
  MediaTargetFutureContractBindingV1,
  'bindingKey' | 'expectedCreationContentFingerprintSha256'
>

// Group F creates exactly three results & every one of them is fixed: a costume
// record, a sound record, & a sprite. there is no dynamic slot anywhere.
export interface MediaTargetCreationResultRoleV1
{
  readonly roleKind: 'fixed'
  readonly name: 'media' | 'target'
}

export type MediaTargetCreationOperationV1 =
  | SemanticEditOperationMediaAddCostumeV1
  | SemanticEditOperationMediaAddSoundV1
  | SemanticEditOperationTargetAddSpriteV1

interface MediaTargetCreationContentInputV1 extends SemanticCreationNormalizationContextV1
{
  readonly operation: MediaTargetCreationOperationV1
  readonly descriptor: MediaTargetCreationBindingDescriptorV1
  readonly resultRole: MediaTargetCreationResultRoleV1
}

function invalidCreationContent(message: string): never
{
  throw Object.assign(new Error(message), {
    code: 'edit.unauthorized_change',
  })
}

// the media subtype is fixed by the creating operation, never by the caller: a
// costume add can only ever produce a costume record
function expectedResultShape(operation: MediaTargetCreationOperationV1): {
  readonly entityKind: 'media' | 'target'
  readonly entitySubtype: 'costume' | 'sound' | 'sprite'
  readonly name: 'media' | 'target'
}
{
  if (operation.kind === 'media.addCostume')
    return { entityKind: 'media', entitySubtype: 'costume', name: 'media' }
  if (operation.kind === 'media.addSound')
    return { entityKind: 'media', entitySubtype: 'sound', name: 'media' }
  return { entityKind: 'target', entitySubtype: 'sprite', name: 'target' }
}

function assertOperationRole(input: MediaTargetCreationContentInputV1): void
{
  const { operation, descriptor, resultRole } = input
  const shape = expectedResultShape(operation)
  if (resultRole.roleKind !== 'fixed' || resultRole.name !== shape.name)
    invalidCreationContent(
      `${operation.kind} does not create a ${resultRole.name} result`
    )
  if (
    descriptor.entityKind !== shape.entityKind ||
    descriptor.entitySubtype !== shape.entitySubtype ||
    descriptor.expectedCreationRole.roleKind !== 'fixed' ||
    descriptor.expectedCreationRole.name !== shape.name
  )
    invalidCreationContent(
      `${resultRole.name} result does not match its binding descriptor role`
    )
  if (descriptor.expectedCreatorOperationKind !== operation.kind)
    invalidCreationContent(
      'binding descriptor names a different creator operation'
    )
}

// resolve the operation's own target reference rather than the raw target: the
// frozen media scope admits a future sprite binding, so an atomic addSprite +
// first costume batch can name a target that does not exist yet
function ownerTargetRef(
  input: MediaTargetCreationContentInputV1,
  expectedEntitySubtype: 'stage' | 'sprite',
  semanticPath: string
): ContractEntityRefV1
{
  const { operation } = input
  if (operation.kind === 'target.addSprite')
    return invalidCreationContent('a created sprite has no owning target')
  return input.resolveContractEntityRef({
    sourceKind: 'semanticReference',
    reference: operation.target,
    expectedEntityKind: 'target',
    expectedEntitySubtype,
    referenceDomain: 'targetOwnership',
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

// a media record is owned by its target; a created sprite is owned by the
// project itself, so it carries the project-wide scope instead
function assertCreationScope(input: MediaTargetCreationContentInputV1): void
{
  const { operation, descriptor } = input
  const scope = descriptor.expectedCreationScope
  if (operation.kind === 'target.addSprite')
  {
    if (
      scope.scopeKind !== 'projectEntityCollection' ||
      scope.collection !== 'targets'
    )
      invalidCreationContent('a created sprite requires project target scope')
    return
  }
  if (scope.scopeKind !== 'targetAndOwnedDescendants')
    return invalidCreationContent('media results require target scope')
  assertSameContractRef(
    ownerTargetRef(input, scope.target.entitySubtype, '/scope/target'),
    scope.target,
    'media creation scope target does not match the result'
  )
}

// the caller can never override parsed dimensions, data format, digest, md5ext,
// or bitmapResolution, so the creation content names the admitted asset by its
// declared digests & carries only the semantic fields the caller does author
function costumeContent(
  operation: SemanticEditOperationMediaAddCostumeV1
): unknown
{
  return {
    mediaKind: 'costume',
    name: operation.name,
    order: operation.order,
    placement: operation.placement,
    asset: {
      expectedPayloadSha256: operation.asset.expectedPayloadSha256,
      expectedMetadataSha256: operation.asset.expectedMetadataSha256,
    },
  }
}

function soundContent(
  operation: SemanticEditOperationMediaAddSoundV1
): unknown
{
  return {
    mediaKind: 'sound',
    name: operation.name,
    order: operation.order,
    asset: {
      expectedPayloadSha256: operation.asset.expectedPayloadSha256,
      expectedMetadataSha256: operation.asset.expectedMetadataSha256,
    },
  }
}

// a created sprite carries no costume of its own here: its first costume is a
// separate future-bound media result in the same batch
function spriteContent(
  operation: SemanticEditOperationTargetAddSpriteV1
): unknown
{
  return {
    targetKind: 'sprite',
    name: operation.name,
    visualLayerOrdinal: operation.visualLayerOrdinal,
    properties: operation.properties,
  }
}

function resultInitialContent(input: MediaTargetCreationContentInputV1): unknown
{
  const { operation } = input
  if (operation.kind === 'media.addCostume') return costumeContent(operation)
  if (operation.kind === 'media.addSound') return soundContent(operation)
  return spriteContent(operation)
}

function mediaTargetCreationContentProjectionForResultV1(
  input: MediaTargetCreationContentInputV1
): unknown
{
  assertOperationRole(input)
  assertCreationScope(input)
  return {
    kind: 'group-f-contract-creation-content',
    schemaVersion: 1,
    operationKind: input.operation.kind,
    entityKind: input.descriptor.entityKind,
    entitySubtype: input.descriptor.entitySubtype,
    role: input.descriptor.expectedCreationRole,
    scope: input.descriptor.expectedCreationScope,
    initialSemanticContent: resultInitialContent(input),
  }
}

export function mediaTargetCreationContentFingerprintForResultV1(
  input: MediaTargetCreationContentInputV1
): string
{
  return semanticHashV1(
    'semantic-fingerprint',
    mediaTargetCreationContentProjectionForResultV1(input)
  )
}
