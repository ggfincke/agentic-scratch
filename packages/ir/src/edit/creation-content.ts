// packages/ir/src/edit/creation-content.ts
// canonical future-entity creation content & fingerprint authority

import type {
  ContractEntityBindingV1,
  ContractEntityRefV1,
  SemanticEditOperationCommentAddV1,
  SemanticEditOperationDeclarationAddBroadcastV1,
  SemanticEditOperationDeclarationAddListV1,
  SemanticEditOperationDeclarationAddVariableV1,
} from './contracts.generated.js'
import { semanticHashV1 } from './hash-domains.js'
import type { Without } from './internal-types.js'

type GroupCFutureContractBindingV1 = Extract<
  ContractEntityBindingV1,
  {
    bindingKind: 'future'
    entityKind: 'declaration' | 'comment'
  }
>

type GroupCCreationBindingDescriptorV1 = Without<
  GroupCFutureContractBindingV1,
  'bindingKey' | 'expectedCreationContentFingerprintSha256'
>

type GroupCDeclarationCreationOperationV1 =
  | Pick<
      SemanticEditOperationDeclarationAddVariableV1,
      'kind' | 'name' | 'cloud' | 'initialValue'
    >
  | Pick<
      SemanticEditOperationDeclarationAddListV1,
      'kind' | 'name' | 'initialItems'
    >
  | Pick<SemanticEditOperationDeclarationAddBroadcastV1, 'kind' | 'name'>

type GroupCCommentCreationOperationV1 = Pick<
  SemanticEditOperationCommentAddV1,
  'kind' | 'text' | 'layout' | 'attachment'
>

type GroupCCommentAttachmentBindingV1 =
  | { readonly kind: 'detached' }
  | {
      readonly kind: 'attached'
      readonly block: Extract<
        ContractEntityRefV1,
        { entityKind: 'block'; entitySubtype: 'unspecialized' }
      >
    }

function invalidCreationDescriptor(message: string): never
{
  throw Object.assign(new Error(message), {
    code: 'edit.unauthorized_change',
  })
}

function assertDescriptorOperation(
  operationKind:
    | GroupCDeclarationCreationOperationV1['kind']
    | GroupCCommentCreationOperationV1['kind'],
  descriptor: GroupCCreationBindingDescriptorV1
): void
{
  if (descriptor.expectedCreatorOperationKind !== operationKind)
    invalidCreationDescriptor(
      'future binding creator does not match the creation operation'
    )
}

function groupCDeclarationCreationContentProjectionV1(
  operation: GroupCDeclarationCreationOperationV1,
  descriptor: Extract<
    GroupCCreationBindingDescriptorV1,
    { entityKind: 'declaration' }
  >
): unknown
{
  assertDescriptorOperation(operation.kind, descriptor)
  const expectedSubtype =
    operation.kind === 'declaration.addVariable'
      ? 'variable'
      : operation.kind === 'declaration.addList'
        ? 'list'
        : 'broadcast'
  if (
    descriptor.entitySubtype !== expectedSubtype ||
    descriptor.expectedCreationRole.roleKind !== 'fixed' ||
    descriptor.expectedCreationRole.name !== 'declaration' ||
    descriptor.expectedCreationRole.entityKind !== 'declaration' ||
    descriptor.expectedCreationRole.entitySubtype !== expectedSubtype
  )
    return invalidCreationDescriptor(
      'future declaration binding role does not match the creation operation'
    )
  const scope = descriptor.expectedCreationScope
  if (
    (operation.kind === 'declaration.addBroadcast' &&
      (scope.scopeKind !== 'projectEntityCollection' ||
        scope.collection !== 'broadcasts')) ||
    (operation.kind !== 'declaration.addBroadcast' &&
      scope.scopeKind !== 'targetAndOwnedDescendants')
  )
    return invalidCreationDescriptor(
      'future declaration binding scope does not match the creation operation'
    )
  const base = {
    kind: 'group-c-contract-creation-content',
    schemaVersion: 1,
    operationKind: operation.kind,
    role: descriptor.expectedCreationRole,
    scope,
    entityKind: 'declaration',
  }
  if (operation.kind === 'declaration.addVariable')
    return {
      ...base,
      entitySubtype: 'variable',
      name: operation.name,
      cloud: operation.cloud,
      initialValue: operation.initialValue,
    }
  if (operation.kind === 'declaration.addList')
    return {
      ...base,
      entitySubtype: 'list',
      name: operation.name,
      initialItems: operation.initialItems,
    }
  return {
    ...base,
    entitySubtype: 'broadcast',
    name: operation.name,
  }
}

export function groupCDeclarationCreationContentFingerprintV1(
  operation: GroupCDeclarationCreationOperationV1,
  descriptor: Extract<
    GroupCCreationBindingDescriptorV1,
    { entityKind: 'declaration' }
  >
): string
{
  return semanticHashV1(
    'semantic-fingerprint',
    groupCDeclarationCreationContentProjectionV1(operation, descriptor)
  )
}

function groupCCommentCreationContentProjectionV1(
  operation: GroupCCommentCreationOperationV1,
  descriptor: Extract<
    GroupCCreationBindingDescriptorV1,
    { entityKind: 'comment' }
  >,
  attachmentBinding: GroupCCommentAttachmentBindingV1
): unknown
{
  assertDescriptorOperation(operation.kind, descriptor)
  if (
    descriptor.entitySubtype !== 'unspecialized' ||
    descriptor.expectedCreationRole.roleKind !== 'fixed' ||
    descriptor.expectedCreationRole.name !== 'comment' ||
    descriptor.expectedCreationRole.entityKind !== 'comment' ||
    descriptor.expectedCreationRole.entitySubtype !== 'unspecialized' ||
    descriptor.expectedCreationScope.scopeKind !== 'targetAndOwnedDescendants'
  )
    return invalidCreationDescriptor(
      'future comment binding role or scope does not match comment creation'
    )
  if (operation.attachment.kind !== attachmentBinding.kind)
    return invalidCreationDescriptor(
      'resolved comment attachment does not match the creation operation'
    )
  return {
    kind: 'group-c-contract-creation-content',
    schemaVersion: 1,
    operationKind: operation.kind,
    role: descriptor.expectedCreationRole,
    scope: descriptor.expectedCreationScope,
    entityKind: 'comment',
    entitySubtype: 'unspecialized',
    text: operation.text,
    layout: operation.layout,
    attachment: attachmentBinding,
  }
}

export function groupCCommentCreationContentFingerprintV1(
  operation: GroupCCommentCreationOperationV1,
  descriptor: Extract<
    GroupCCreationBindingDescriptorV1,
    { entityKind: 'comment' }
  >,
  attachmentBinding: GroupCCommentAttachmentBindingV1
): string
{
  return semanticHashV1(
    'semantic-fingerprint',
    groupCCommentCreationContentProjectionV1(
      operation,
      descriptor,
      attachmentBinding
    )
  )
}
