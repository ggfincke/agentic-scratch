// packages/ir/src/edit/operations/procedure-creation-content.ts
// derive authoritative Group E procedure future-result semantic creation content

import type {
  ContractEntityBindingV1,
  ContractEntityRefV1,
  SemanticEditOperationProcedureAddV1,
  SemanticEditOperationProcedureRemoveV1,
  SemanticEditOperationProcedureSetCallArgumentV1,
  SemanticEditOperationProcedureUpdateSignatureV1,
} from '../contracts.generated.js'
import { assertSameCreationContentContractRefV1 as assertSameContractRef } from '../contracts/creation-content-contract-ref.js'
import {
  normalizeAuthoredRootBlock,
  normalizeSemanticSequence,
  normalizedAlias,
  type SemanticCreationNormalizationContextV1,
} from './script-block-creation-content.js'
import { semanticHashV1 } from '../contracts/hash-domains.js'
import { canonicalProcedureSignatureV1 } from './procedure-operations.js'

import type { Without } from '../support/internal-types.js'

type ProcedureFutureContractBindingV1 = Extract<
  ContractEntityBindingV1,
  {
    bindingKind: 'future'
    entityKind: 'script' | 'block' | 'procedure' | 'parameter'
  }
>

export type ProcedureCreationBindingDescriptorV1 = Without<
  ProcedureFutureContractBindingV1,
  'bindingKey' | 'expectedCreationContentFingerprintSha256'
>

export interface ProcedureCreationResultRoleV1
{
  readonly roleKind: 'fixed' | 'dynamic'
  readonly name:
    'procedure' | 'definitionScript' | 'parameter' | 'rootBlock' | 'blockAlias'
  readonly alias?: string
}

export type ProcedureCreationOperationV1 =
  | SemanticEditOperationProcedureAddV1
  | SemanticEditOperationProcedureUpdateSignatureV1
  | SemanticEditOperationProcedureSetCallArgumentV1
  | SemanticEditOperationProcedureRemoveV1

interface ProcedureSelectedCreationSourceV1
{
  readonly proccode?: string
  readonly scriptTopBlockId?: string
}

interface ProcedureCreationContentInputV1 extends SemanticCreationNormalizationContextV1
{
  readonly operation: ProcedureCreationOperationV1
  readonly descriptor: ProcedureCreationBindingDescriptorV1
  readonly resultRole: ProcedureCreationResultRoleV1
  readonly selectedSource: ProcedureSelectedCreationSourceV1
}

function invalidCreationContent(message: string): never
{
  throw Object.assign(new Error(message), {
    code: 'edit.unauthorized_change',
  })
}

// contract-data's "dynamic slot" only means the slot may or may not be
// produced, so it disagrees w/ roleKind. the frozen binding descriptors are the
// roleKind authority; encode their view here, not the slot table's.
function expectedResultRoleShape(name: ProcedureCreationResultRoleV1['name']): {
  readonly entityKind: 'script' | 'block' | 'procedure' | 'parameter'
  readonly roleKind: 'fixed' | 'dynamic'
}
{
  if (name === 'procedure')
    return { entityKind: 'procedure', roleKind: 'fixed' }
  if (name === 'definitionScript')
    return { entityKind: 'script', roleKind: 'fixed' }
  if (name === 'parameter')
    return { entityKind: 'parameter', roleKind: 'dynamic' }
  if (name === 'blockAlias') return { entityKind: 'block', roleKind: 'dynamic' }
  return { entityKind: 'block', roleKind: 'fixed' }
}

function resultAlias(input: ProcedureCreationContentInputV1): string
{
  const alias = input.resultRole.alias
  if (
    input.resultRole.roleKind !== 'dynamic' ||
    typeof alias !== 'string' ||
    alias.length === 0
  )
  {
    return invalidCreationContent('dynamic Group E result requires one alias')
  }
  return alias
}

// the result slots each operation may produce, read off the frozen contract
// rows. `procedure.remove` creates nothing at all.
function assertOperationRole(input: ProcedureCreationContentInputV1): void
{
  const { operation, descriptor, resultRole } = input
  const roles: Readonly<
    Record<ProcedureCreationOperationV1['kind'], readonly string[]>
  > = {
    'procedure.add': [
      'procedure',
      'definitionScript',
      'parameter',
      'blockAlias',
    ],
    'procedure.updateSignature': ['parameter', 'blockAlias'],
    'procedure.setCallArgument': ['rootBlock', 'blockAlias'],
    'procedure.remove': [],
  }
  if (!roles[operation.kind].includes(resultRole.name))
    invalidCreationContent(
      `${operation.kind} does not create a ${resultRole.name} result`
    )
  const shape = expectedResultRoleShape(resultRole.name)
  if (
    descriptor.entityKind !== shape.entityKind ||
    descriptor.expectedCreationRole.roleKind !== shape.roleKind ||
    descriptor.expectedCreationRole.name !== resultRole.name ||
    resultRole.roleKind !== shape.roleKind
  )
  {
    invalidCreationContent(
      `${resultRole.name} result does not match its binding descriptor role`
    )
  }
  if (descriptor.entitySubtype !== 'unspecialized')
    invalidCreationContent('Group E results are always unspecialized')
  if (descriptor.expectedCreatorOperationKind !== operation.kind)
    invalidCreationContent(
      'binding descriptor names a different creator operation'
    )
}

// resolve the operation's own target reference rather than the raw target: the
// frozen procedure scope admits a future sprite binding, & a raw lookup could
// only ever produce an existing one
function ownerTargetRef(
  input: ProcedureCreationContentInputV1,
  expectedEntitySubtype: 'stage' | 'sprite',
  semanticPath: string
): ContractEntityRefV1
{
  if (input.operation.kind !== 'procedure.add')
    return invalidCreationContent('operation does not name an owning target')
  return input.resolveContractEntityRef({
    sourceKind: 'semanticReference',
    reference: input.operation.target,
    expectedEntityKind: 'target',
    expectedEntitySubtype,
    referenceDomain: 'targetOwnership',
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

function selectedProcedureRef(
  input: ProcedureCreationContentInputV1,
  semanticPath: string
): ContractEntityRefV1
{
  const proccode = input.selectedSource.proccode
  if (proccode === undefined)
    return invalidCreationContent('Group E creation source procedure is absent')
  return input.resolveContractEntityRef({
    sourceKind: 'rawProcedure',
    rawProccode: proccode,
    expectedEntityKind: 'procedure',
    expectedEntitySubtype: 'unspecialized',
    referenceDomain: 'procedureOwnership',
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

// a block authored into an existing script must prove that exact script owns
// it, so an unrelated script binding cannot stand in as the creation scope
function selectedScriptRef(
  input: ProcedureCreationContentInputV1,
  semanticPath: string
): ContractEntityRefV1
{
  const scriptTopBlockId = input.selectedSource.scriptTopBlockId
  if (scriptTopBlockId === undefined)
    return invalidCreationContent('Group E creation source script is absent')
  return input.resolveContractEntityRef({
    sourceKind: 'rawScript',
    rawScriptTopBlockId: scriptTopBlockId,
    expectedEntityKind: 'script',
    expectedEntitySubtype: 'unspecialized',
    referenceDomain: 'scriptOwnership',
    ownerTargetIndex: input.targetIndex,
    semanticPath,
  })
}

// procedures & their definition scripts are owned by a target; parameters are
// owned by the procedure closure; blocks are owned by a script closure.
function assertCreationScope(input: ProcedureCreationContentInputV1): void
{
  const { operation, descriptor } = input
  const scope = descriptor.expectedCreationScope
  if (
    descriptor.entityKind === 'procedure' ||
    descriptor.entityKind === 'script'
  )
  {
    if (scope.scopeKind !== 'targetAndOwnedDescendants')
      return invalidCreationContent(
        'procedure & definition script results require target scope'
      )
    assertSameContractRef(
      ownerTargetRef(input, scope.target.entitySubtype, '/scope/target'),
      scope.target,
      'procedure creation scope target does not match the result'
    )
    return
  }
  if (descriptor.entityKind === 'parameter')
  {
    if (scope.scopeKind !== 'procedureOwnedClosure')
      return invalidCreationContent(
        'parameter result requires procedure owned closure scope'
      )
    // a parameter created by the same operation that creates its procedure has
    // no prior procedure to name, so the scope must be the future binding
    if (operation.kind === 'procedure.add')
    {
      if (scope.procedure.contractRefKind !== 'future')
        invalidCreationContent(
          'new procedure parameter requires future procedure scope'
        )
      return
    }
    assertSameContractRef(
      selectedProcedureRef(input, '/scope/procedure'),
      scope.procedure,
      'parameter creation scope procedure does not match the selection'
    )
    return
  }
  if (scope.scopeKind !== 'scriptClosure')
    return invalidCreationContent('block result requires script closure scope')
  // a body block authored by procedure.add lands inside the definition script
  // that the same operation creates, so its scope is that future script
  if (operation.kind === 'procedure.add')
  {
    if (scope.script.contractRefKind !== 'future')
      invalidCreationContent(
        'new procedure body block requires future script scope'
      )
    return
  }
  assertSameContractRef(
    selectedScriptRef(input, '/scope/script'),
    scope.script,
    'block creation scope script does not match the selection'
  )
}

// the parameter a dynamic result names, addressed by its signature-local key
function parameterContent(
  input: ProcedureCreationContentInputV1,
  localKey: string
): unknown
{
  const { operation } = input
  if (
    operation.kind !== 'procedure.add' &&
    operation.kind !== 'procedure.updateSignature'
  )
    return invalidCreationContent('operation does not author a parameter')
  const decoded = canonicalProcedureSignatureV1(operation.signature)
  const parameter = decoded.parameters.find(
    (candidate) => candidate.localKey === localKey
  )
  if (parameter === undefined)
    return invalidCreationContent(
      `parameter ${localKey} is not declared by the authored signature`
    )
  return {
    localKey: parameter.localKey,
    name: parameter.name,
    parameterType: parameter.parameterType,
    defaultValue: parameter.defaultValue,
  }
}

function signatureContent(input: ProcedureCreationContentInputV1): unknown
{
  const { operation } = input
  if (operation.kind !== 'procedure.add')
    return invalidCreationContent('operation does not author a procedure')
  const decoded = canonicalProcedureSignatureV1(operation.signature)
  return {
    proccode: decoded.proccode,
    warp: decoded.warp,
    parameters: decoded.parameters.map((parameter) => ({
      localKey: parameter.localKey,
      name: parameter.name,
      parameterType: parameter.parameterType,
      defaultValue: parameter.defaultValue,
    })),
  }
}

// an authored block alias may live in the added body, in a replaced call
// argument, or in the single call-argument value, depending on the operation
function aliasContent(
  input: ProcedureCreationContentInputV1,
  alias: string
): unknown
{
  const { operation } = input
  if (operation.kind === 'procedure.add')
  {
    if (operation.body === undefined)
      return invalidCreationContent('procedure add has no authored body')
    return normalizedAlias(input, operation.body, alias)
  }
  if (operation.kind === 'procedure.setCallArgument')
    return normalizedAlias(input, operation.value, alias)
  if (operation.kind === 'procedure.updateSignature')
  {
    const authored: unknown[] = []
    for (const call of operation.callSites)
      for (const argument of call.arguments)
        if (
          argument.source.kind === 'replaceParameter' ||
          argument.source.kind === 'initializeNewParameter'
        )
          authored.push(argument.source.value)
    const matches = authored.flatMap((value) =>
    {
      try
      {
        return [normalizedAlias(input, value, alias)]
      }
      catch
      {
        return []
      }
    })
    if (matches.length !== 1)
      return invalidCreationContent(
        `block alias ${alias} is not authored exactly once by the signature update`
      )
    return matches[0]
  }
  return invalidCreationContent('operation authors no block alias')
}

function resultInitialContent(input: ProcedureCreationContentInputV1): unknown
{
  const { operation, resultRole } = input
  if (resultRole.name === 'procedure') return signatureContent(input)
  if (resultRole.name === 'definitionScript')
  {
    if (operation.kind !== 'procedure.add')
      return invalidCreationContent(
        'operation does not author a definition script'
      )
    return {
      signature: signatureContent(input),
      body:
        operation.body === undefined
          ? null
          : normalizeSemanticSequence(input, operation.body, '/procedure/body'),
    }
  }
  if (resultRole.name === 'parameter')
    return parameterContent(input, resultAlias(input))
  if (resultRole.name === 'rootBlock')
  {
    if (operation.kind !== 'procedure.setCallArgument')
      return invalidCreationContent('operation authors no root block result')
    return normalizeAuthoredRootBlock(input, operation.value)
  }
  return aliasContent(input, resultAlias(input))
}

function procedureCreationContentProjectionForResultV1(
  input: ProcedureCreationContentInputV1
): unknown
{
  assertOperationRole(input)
  assertCreationScope(input)
  return {
    kind: 'group-e-contract-creation-content',
    schemaVersion: 1,
    operationKind: input.operation.kind,
    entityKind: input.descriptor.entityKind,
    entitySubtype: input.descriptor.entitySubtype,
    role: input.descriptor.expectedCreationRole,
    scope: input.descriptor.expectedCreationScope,
    initialSemanticContent: resultInitialContent(input),
  }
}

export function procedureCreationContentFingerprintForResultV1(
  input: ProcedureCreationContentInputV1
): string
{
  return semanticHashV1(
    'semantic-fingerprint',
    procedureCreationContentProjectionForResultV1(input)
  )
}
