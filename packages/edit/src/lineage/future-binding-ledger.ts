// packages/edit/src/lineage/future-binding-ledger.ts
// hash-only immutable future-binding realizations across revision history

import {
  procedureEntityEvidenceSetV1,
  scriptEntityEvidenceSetV1,
  targetEntityEvidenceSetV1,
  parseSemanticChangeContractV1,
  semanticHashV1,
  validateSemanticLineageSnapshot,
  type ContractEntityBindingV1,
  type ContractEntityRefV1,
  type EditSemanticChangeContractV1,
  type SemanticEditOperationV1,
  type SemanticLineageKind,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'
import type { ProjectIR } from '@scratch-agent/ir'

import { operationOccurrenceIdHashV1 } from './occurrence-hash.js'

export type FutureContractBindingV1 = Extract<
  ContractEntityBindingV1,
  { bindingKind: 'future' }
>

export interface FutureBindingRealizationV1
{
  readonly bindingKeySha256: string
  readonly bindingDescriptorSha256: string
  readonly creationProjectionSha256: string
  readonly creatorOperationOccurrenceId: string
  readonly resultLineageId: string
  readonly ownerLineageId: string | null
  readonly resultCorrespondenceSha256: string
}

export interface FutureBindingLedgerV1
{
  readonly schemaVersion: 1
  readonly changeContractSha256: string
  readonly realizations: readonly FutureBindingRealizationV1[]
}

interface FutureBindingRealizationInputV1
{
  readonly binding: FutureContractBindingV1
  readonly creatorOperationOccurrenceId: string
  readonly predecessorAcceptedHistorySha256: string
  readonly creatorOperationId: string
  readonly creatorOperationKind: SemanticEditOperationV1['kind']
  readonly createdEntityKind: FutureContractBindingV1['entityKind']
  readonly createdEntitySubtype: FutureContractBindingV1['entitySubtype']
  readonly collisionNonce: number
  readonly creationKey: string
  readonly resultLineageId: string
  readonly ownerLineageId: string | null
}

export type FutureBindingOwnerLineageResolverV1 = (
  reference: ContractEntityRefV1
) => string | undefined

export function existingBindingOwnerLineageResolverV1(
  source: ProjectIR,
  contract: EditSemanticChangeContractV1,
  sourceLineage: SemanticLineageSnapshot
): FutureBindingOwnerLineageResolverV1
{
  const exactContract = parsedContract(contract)
  const exactLineage = validateSemanticLineageSnapshot(sourceLineage)
  const records = exactLineage.records
  const targetEvidence = targetEntityEvidenceSetV1(source.json)
  const scriptEvidence = scriptEntityEvidenceSetV1(source)
  const procedureEvidence = procedureEntityEvidenceSetV1(source)
  return (reference): string | undefined =>
  {
    if (reference.contractRefKind !== 'existing') return undefined
    const bindings = exactContract.entityBindings.filter(
      (binding) =>
        binding.bindingKind === 'existing' &&
        binding.bindingKey === reference.bindingKey &&
        binding.entityKind === reference.entityKind &&
        binding.entitySubtype === reference.entitySubtype
    )
    if (bindings.length !== 1 || bindings[0]!.bindingKind !== 'existing')
      return undefined
    const binding = bindings[0]!
    const sourceIdentity = (() =>
    {
      if (binding.entityKind === 'target')
      {
        const matches = targetEvidence.filter(
          (evidence) =>
            evidence.targetKind === binding.entitySubtype &&
            evidence.semanticLocationSha256 === binding.sourceLocationSha256 &&
            evidence.semanticFingerprintSha256 ===
              binding.expectedSourceSemanticFingerprint &&
            evidence.contextFingerprintSha256 ===
              binding.expectedSourceContextFingerprint
        )
        return matches.length === 1
          ? {
              kind: 'target' as const,
              rawIdentity: `target:${matches[0]!.targetIndex}`,
              ownerLineageId: null,
            }
          : null
      }
      if (binding.entityKind === 'script')
      {
        const matches = scriptEvidence.filter(
          (evidence) =>
            binding.entitySubtype === 'unspecialized' &&
            evidence.semanticLocationSha256 === binding.sourceLocationSha256 &&
            evidence.semanticFingerprintSha256 ===
              binding.expectedSourceSemanticFingerprint &&
            evidence.contextFingerprintSha256 ===
              binding.expectedSourceContextFingerprint
        )
        if (matches.length !== 1) return null
        const owner = records.find(
          (record) =>
            record.kind === 'target' &&
            record.ownerLineageId === null &&
            record.rawIdentity === `target:${matches[0]!.targetIndex}`
        )
        return owner
          ? {
              kind: 'script' as const,
              rawIdentity: `script:${matches[0]!.topBlockId}`,
              ownerLineageId: owner.lineageId,
            }
          : null
      }
      // a procedure-owned closure scope names an existing procedure, whose own
      // owner is the target it is defined in
      if (binding.entityKind === 'procedure')
      {
        const matches = procedureEvidence.filter(
          (evidence) =>
            binding.entitySubtype === 'unspecialized' &&
            evidence.semanticLocationSha256 === binding.sourceLocationSha256 &&
            evidence.semanticFingerprintSha256 ===
              binding.expectedSourceSemanticFingerprint &&
            evidence.contextFingerprintSha256 ===
              binding.expectedSourceContextFingerprint
        )
        if (matches.length !== 1) return null
        const owner = records.find(
          (record) =>
            record.kind === 'target' &&
            record.ownerLineageId === null &&
            record.rawIdentity === `target:${matches[0]!.targetIndex}`
        )
        return owner
          ? {
              kind: 'procedure' as const,
              rawIdentity: `procedure:${matches[0]!.proccode}`,
              ownerLineageId: owner.lineageId,
            }
          : null
      }
      return null
    })()
    if (!sourceIdentity) return undefined
    const matches = records.filter(
      (record) =>
        record.kind === sourceIdentity.kind &&
        record.rawIdentity === sourceIdentity.rawIdentity &&
        record.ownerLineageId === sourceIdentity.ownerLineageId
    )
    return matches.length === 1 ? matches[0]!.lineageId : undefined
  }
}

type FutureBindingLedgerErrorCodeV1 =
  'edit.unauthorized_change' | 'edit.internal_invariant'

class FutureBindingLedgerErrorV1 extends Error
{
  constructor(
    readonly code: FutureBindingLedgerErrorCodeV1,
    message: string
  )
  {
    super(message)
    this.name = 'FutureBindingLedgerErrorV1'
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const ROW_KEYS = Object.freeze([
  'bindingDescriptorSha256',
  'bindingKeySha256',
  'creationProjectionSha256',
  'creatorOperationOccurrenceId',
  'ownerLineageId',
  'resultCorrespondenceSha256',
  'resultLineageId',
])
const LEDGER_KEYS = Object.freeze([
  'changeContractSha256',
  'realizations',
  'schemaVersion',
])

function fail(code: FutureBindingLedgerErrorCodeV1, message: string): never
{
  throw new FutureBindingLedgerErrorV1(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown>
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean
{
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function assertSha256(value: unknown, field: string): asserts value is string
{
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value))
    fail('edit.internal_invariant', `${field} must be a lowercase SHA-256`)
}

function compareRealizations(
  left: FutureBindingRealizationV1,
  right: FutureBindingRealizationV1
): number
{
  if (left.bindingKeySha256 !== right.bindingKeySha256)
    return left.bindingKeySha256 < right.bindingKeySha256 ? -1 : 1
  if (left.resultLineageId !== right.resultLineageId)
    return left.resultLineageId < right.resultLineageId ? -1 : 1
  return 0
}

function immutableRealization(
  value: FutureBindingRealizationV1
): FutureBindingRealizationV1
{
  return Object.freeze({ ...value })
}

function immutableLedger(
  changeContractSha256: string,
  realizations: readonly FutureBindingRealizationV1[]
): FutureBindingLedgerV1
{
  return Object.freeze({
    schemaVersion: 1,
    changeContractSha256,
    realizations: Object.freeze(realizations.map(immutableRealization)),
  })
}

export function emptyFutureBindingLedgerV1(
  changeContractSha256: string
): FutureBindingLedgerV1
{
  assertSha256(changeContractSha256, 'changeContractSha256')
  return immutableLedger(changeContractSha256, [])
}

export function futureBindingKeySha256V1(
  changeContractSha256: string,
  bindingKey: string
): string
{
  assertSha256(changeContractSha256, 'changeContractSha256')
  if (bindingKey.length === 0)
    fail('edit.unauthorized_change', 'future binding key must not be empty')
  return semanticHashV1('change-contract', {
    kind: 'future-binding-key',
    schemaVersion: 1,
    changeContractSha256,
    bindingKey,
  })
}

export function futureBindingDescriptorSha256V1(
  binding: FutureContractBindingV1
): string
{
  if (binding.bindingKind !== 'future')
    fail('edit.unauthorized_change', 'future binding descriptor is required')
  return semanticHashV1('change-contract', {
    kind: 'future-binding-descriptor',
    schemaVersion: 1,
    binding,
  })
}

function futureBindingCreationProjectionSha256V1(
  binding: FutureContractBindingV1
): string
{
  if (binding.bindingKind !== 'future')
    fail('edit.unauthorized_change', 'future binding descriptor is required')
  return semanticHashV1('resolved-plan', {
    kind: 'future-binding-creation-projection',
    schemaVersion: 1,
    expectedCreatorOperationKind: binding.expectedCreatorOperationKind,
    expectedCreationRole: binding.expectedCreationRole,
    expectedCreationScope: binding.expectedCreationScope,
    expectedCreationContentFingerprintSha256:
      binding.expectedCreationContentFingerprintSha256,
  })
}

function futureBindingResultCorrespondenceSha256V1(
  bindingKeySha256: string,
  creationProjectionSha256: string,
  creatorOperationOccurrenceId: string,
  resultLineageId: string,
  ownerLineageId: string | null
): string
{
  assertSha256(bindingKeySha256, 'bindingKeySha256')
  assertSha256(creationProjectionSha256, 'creationProjectionSha256')
  assertSha256(creatorOperationOccurrenceId, 'creatorOperationOccurrenceId')
  assertSha256(resultLineageId, 'resultLineageId')
  if (ownerLineageId !== null) assertSha256(ownerLineageId, 'ownerLineageId')
  return semanticHashV1('lineage', {
    kind: 'future-binding-result-correspondence',
    schemaVersion: 1,
    bindingKeySha256,
    creationProjectionSha256,
    creatorOperationOccurrenceId,
    resultLineageId,
    ownerLineageId,
  })
}

export function futureBindingLedgerSha256V1(
  ledger: FutureBindingLedgerV1
): string
{
  return semanticHashV1('history', {
    kind: 'future-binding-realization-ledger',
    ...ledger,
  })
}

function parsedContract(
  contract: EditSemanticChangeContractV1
): EditSemanticChangeContractV1
{
  const parsed = parseSemanticChangeContractV1(contract)
  if (!parsed.ok)
    fail(
      'edit.internal_invariant',
      `future binding ledger received an invalid contract with ${parsed.issues.length} issue(s)`
    )
  return parsed.value
}

function expectedLineageKind(
  binding: FutureContractBindingV1
): SemanticLineageKind
{
  return binding.entityKind === 'media'
    ? binding.entitySubtype
    : binding.entityKind
}

function lineageSubtypeMatches(
  binding: FutureContractBindingV1,
  record: SemanticLineageRecord
): boolean
{
  if (binding.entityKind === 'declaration')
    return record.rawIdentity.startsWith(`${binding.entitySubtype}:`)
  if (binding.entityKind === 'media')
    return record.kind === binding.entitySubtype
  return true
}

function referenceLineageKind(
  reference: ContractEntityRefV1
): SemanticLineageKind | null
{
  if (reference.entityKind === 'topLevelPrimitive') return null
  return reference.entityKind === 'media'
    ? reference.entitySubtype
    : reference.entityKind
}

function rowForBindingKey(
  rows: ReadonlyMap<string, FutureBindingRealizationV1>,
  changeContractSha256: string,
  bindingKey: string
): FutureBindingRealizationV1 | undefined
{
  return rows.get(futureBindingKeySha256V1(changeContractSha256, bindingKey))
}

function resolveScopeReference(
  reference: ContractEntityRefV1,
  rows: ReadonlyMap<string, FutureBindingRealizationV1>,
  records: ReadonlyMap<string, SemanticLineageRecord>,
  changeContractSha256: string,
  resolveOwnerLineageId?: FutureBindingOwnerLineageResolverV1
): string | undefined
{
  const futureRow =
    reference.contractRefKind === 'future'
      ? rowForBindingKey(rows, changeContractSha256, reference.bindingKey)
      : undefined
  if (reference.contractRefKind === 'future' && !futureRow)
    fail(
      'edit.internal_invariant',
      `future creation-scope owner is not realized: ${reference.entityKind}`
    )
  const lineageId =
    reference.contractRefKind === 'future'
      ? futureRow!.resultLineageId
      : resolveOwnerLineageId?.(reference)
  if (
    reference.contractRefKind === 'existing' &&
    resolveOwnerLineageId !== undefined &&
    lineageId === undefined
  )
    fail(
      'edit.internal_invariant',
      `existing creation-scope owner could not be resolved: ${reference.entityKind}`
    )
  if (lineageId === undefined) return undefined
  const record = records.get(lineageId)
  const kind = referenceLineageKind(reference)
  if (!record || kind === null || record.kind !== kind)
    fail(
      'edit.internal_invariant',
      `creation scope reference resolved to incompatible lineage ${lineageId}`
    )
  return lineageId
}

function expectedScopeOwner(
  binding: FutureContractBindingV1,
  rows: ReadonlyMap<string, FutureBindingRealizationV1>,
  records: ReadonlyMap<string, SemanticLineageRecord>,
  changeContractSha256: string,
  resolveOwnerLineageId?: FutureBindingOwnerLineageResolverV1
): { readonly known: boolean; readonly lineageId: string | null }
{
  const scope = binding.expectedCreationScope
  if (scope.scopeKind === 'projectEntityCollection')
  {
    if (scope.collection === 'targets') return { known: true, lineageId: null }
    const stageTargets = [...records.values()].filter(
      (record) =>
        record.kind === 'target' &&
        record.ownerLineageId === null &&
        record.rawIdentity === 'target:0'
    )
    if (stageTargets.length !== 1)
      fail(
        'edit.internal_invariant',
        'project broadcast scope requires one exact stage lineage'
      )
    return { known: true, lineageId: stageTargets[0]!.lineageId }
  }
  const reference =
    scope.scopeKind === 'targetAndOwnedDescendants'
      ? scope.target
      : scope.scopeKind === 'scriptClosure'
        ? scope.script
        : scope.procedure
  const referencedLineageId = resolveScopeReference(
    reference,
    rows,
    records,
    changeContractSha256,
    resolveOwnerLineageId
  )
  if (referencedLineageId === undefined)
    return { known: false, lineageId: null }
  if (scope.scopeKind !== 'scriptClosure')
    return { known: true, lineageId: referencedLineageId }
  const script = records.get(referencedLineageId)!
  if (script.ownerLineageId === null)
    fail('edit.internal_invariant', 'script-closure owner lineage is absent')
  return { known: true, lineageId: script.ownerLineageId }
}

function validateRowShape(
  input: unknown,
  index: number
): FutureBindingRealizationV1
{
  if (!isRecord(input) || !hasExactKeys(input, ROW_KEYS))
    fail(
      'edit.internal_invariant',
      `future binding realization ${index} has an invalid shape`
    )
  assertSha256(input.bindingKeySha256, 'bindingKeySha256')
  assertSha256(input.bindingDescriptorSha256, 'bindingDescriptorSha256')
  assertSha256(input.creationProjectionSha256, 'creationProjectionSha256')
  assertSha256(
    input.creatorOperationOccurrenceId,
    'creatorOperationOccurrenceId'
  )
  assertSha256(input.resultLineageId, 'resultLineageId')
  if (input.ownerLineageId !== null)
    assertSha256(input.ownerLineageId, 'ownerLineageId')
  assertSha256(input.resultCorrespondenceSha256, 'resultCorrespondenceSha256')
  return input as unknown as FutureBindingRealizationV1
}

export function validateFutureBindingLedgerV1(
  ledger: FutureBindingLedgerV1,
  contract: EditSemanticChangeContractV1,
  lineageHistory: SemanticLineageSnapshot,
  resolveOwnerLineageId?: FutureBindingOwnerLineageResolverV1
): FutureBindingLedgerV1
{
  if (!isRecord(ledger) || !hasExactKeys(ledger, LEDGER_KEYS))
    fail(
      'edit.internal_invariant',
      'future binding ledger has an invalid shape'
    )
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.realizations))
    fail(
      'edit.internal_invariant',
      'future binding ledger schema is unsupported'
    )
  assertSha256(ledger.changeContractSha256, 'changeContractSha256')
  const exactContract = parsedContract(contract)
  if (
    semanticHashV1('change-contract', exactContract) !==
    ledger.changeContractSha256
  )
    fail(
      'edit.internal_invariant',
      'future binding ledger contract identity does not match the exact contract'
    )
  let exactHistory: SemanticLineageSnapshot
  try
  {
    exactHistory = validateSemanticLineageSnapshot(lineageHistory)
  }
  catch (error)
  {
    fail(
      'edit.internal_invariant',
      `future binding lineage history is invalid: ${String(error)}`
    )
  }
  const records = new Map(
    exactHistory.records.map((record) => [record.lineageId, record])
  )
  const rows = ledger.realizations.map(validateRowShape)
  for (let index = 1; index < rows.length; index += 1)
  {
    if (compareRealizations(rows[index - 1]!, rows[index]!) >= 0)
      fail(
        'edit.internal_invariant',
        'future binding realizations are not in strict canonical order'
      )
  }
  const rowByBinding = new Map(rows.map((row) => [row.bindingKeySha256, row]))
  if (rowByBinding.size !== rows.length)
    fail(
      'edit.internal_invariant',
      'future binding realization contains a duplicate binding'
    )
  const resultLineages = new Set<string>()
  const futureBindings = exactContract.entityBindings.filter(
    (binding): binding is FutureContractBindingV1 =>
      binding.bindingKind === 'future'
  )
  const bindingByKeyHash = new Map(
    futureBindings.map((binding) => [
      futureBindingKeySha256V1(ledger.changeContractSha256, binding.bindingKey),
      binding,
    ])
  )
  for (const row of rows)
  {
    const binding = bindingByKeyHash.get(row.bindingKeySha256)
    if (!binding)
      fail(
        'edit.internal_invariant',
        'future binding realization is absent from the exact contract'
      )
    const creationProjectionSha256 =
      futureBindingCreationProjectionSha256V1(binding)
    if (
      row.bindingDescriptorSha256 !==
        futureBindingDescriptorSha256V1(binding) ||
      row.creationProjectionSha256 !== creationProjectionSha256
    )
      fail(
        'edit.internal_invariant',
        'future binding descriptor or creation projection hash differs'
      )
    if (
      row.resultCorrespondenceSha256 !==
      futureBindingResultCorrespondenceSha256V1(
        row.bindingKeySha256,
        creationProjectionSha256,
        row.creatorOperationOccurrenceId,
        row.resultLineageId,
        row.ownerLineageId
      )
    )
      fail(
        'edit.internal_invariant',
        'future binding result correspondence hash differs'
      )
    const result = records.get(row.resultLineageId)
    if (!result)
      fail(
        'edit.internal_invariant',
        `future binding result lineage is absent: ${row.resultLineageId}`
      )
    if (
      result.kind !== expectedLineageKind(binding) ||
      !lineageSubtypeMatches(binding, result)
    )
      fail(
        'edit.internal_invariant',
        `future binding result lineage kind or subtype differs: ${row.resultLineageId}`
      )
    if (result.ownerLineageId !== row.ownerLineageId)
      fail(
        'edit.internal_invariant',
        `future binding result owner differs: ${row.resultLineageId}`
      )
    if (row.ownerLineageId !== null && !records.has(row.ownerLineageId))
      fail(
        'edit.internal_invariant',
        `future binding owner lineage is absent: ${row.ownerLineageId}`
      )
    if (resultLineages.has(row.resultLineageId))
      fail(
        'edit.internal_invariant',
        `future binding result lineage is duplicated: ${row.resultLineageId}`
      )
    resultLineages.add(row.resultLineageId)
    const expectedOwner = expectedScopeOwner(
      binding,
      rowByBinding,
      records,
      ledger.changeContractSha256,
      resolveOwnerLineageId
    )
    if (expectedOwner.known && expectedOwner.lineageId !== row.ownerLineageId)
      fail(
        'edit.internal_invariant',
        `future binding creation scope owner differs: ${row.resultLineageId}`
      )
  }
  return ledger
}

// descriptor-owned creation-key forms admitted per created entity kind: authored
// trees key on canonical semantic path, duplicates on source lineage, so a public
// result slot is never the identity source. any prefix absent here is refused.
const CONTENT_DERIVED_CREATION_KEY_PREFIXES: Readonly<
  Partial<Record<FutureContractBindingV1['entityKind'], readonly string[]>>
> = Object.freeze({
  script: Object.freeze([
    'authored-script-root',
    'cloned-script',
    'promoted-script',
  ]),
  block: Object.freeze(['authored-block', 'cloned-block']),
  // a procedure's own role is fixed, so only its parameters need a content key:
  // owning procedure lineage plus the signature-local key, per the plan rule
  // that parameter reporters use fixed semantic roles & local keys
  parameter: Object.freeze(['procedure-parameter']),
})

// payloads that are a composite semantic key rather than one bare lineage digest
const COMPOSITE_CREATION_KEY_PREFIXES: ReadonlySet<string> = Object.freeze(
  new Set(['authored-block', 'procedure-parameter'])
)

// a fixed role may key on its own closed role name; every other admitted key is
// content-derived & must carry a nonempty payload under an admitted prefix.
function assertAdmittedCreationKey(
  creationKey: string,
  creationRole: FutureContractBindingV1['expectedCreationRole'],
  entityKind: FutureContractBindingV1['entityKind']
): void
{
  if (
    creationRole.roleKind === 'fixed' &&
    creationKey === `fixed:${creationRole.name}`
  )
    return
  const separator = creationKey.indexOf(':')
  const prefix = separator === -1 ? '' : creationKey.slice(0, separator)
  const payload = separator === -1 ? '' : creationKey.slice(separator + 1)
  const admitted = CONTENT_DERIVED_CREATION_KEY_PREFIXES[entityKind] ?? []
  if (!admitted.includes(prefix) || payload.length === 0)
    fail(
      'edit.unauthorized_change',
      'future binding creation key is not an admitted descriptor-owned form'
    )
  // a parameter key is <owning procedure lineage>:<signature-local key>, so the
  // owner half still has to be an exact digest & the local half nonempty
  if (prefix === 'procedure-parameter')
  {
    const boundary = payload.indexOf(':')
    const ownerLineageId = boundary === -1 ? '' : payload.slice(0, boundary)
    const localKey = boundary === -1 ? '' : payload.slice(boundary + 1)
    if (!SHA256_PATTERN.test(ownerLineageId) || localKey.length === 0)
      fail(
        'edit.unauthorized_change',
        'parameter creation key must name an exact procedure lineage & local key'
      )
    return
  }
  // lineage-derived keys name an existing lineage; composite keys carry a
  // semantic path, so everything else must be an exact lineage digest
  if (
    !COMPOSITE_CREATION_KEY_PREFIXES.has(prefix) &&
    !SHA256_PATTERN.test(payload)
  )
    fail(
      'edit.unauthorized_change',
      'future binding creation key must derive from an exact source lineage'
    )
}

function realizationForInput(
  changeContractSha256: string,
  input: FutureBindingRealizationInputV1
): FutureBindingRealizationV1
{
  if (input.creatorOperationKind !== input.binding.expectedCreatorOperationKind)
    fail(
      'edit.unauthorized_change',
      'future binding creator kind does not match its exact descriptor'
    )
  const creationRole = input.binding.expectedCreationRole
  if (
    creationRole.entityKind !== input.binding.entityKind ||
    creationRole.entitySubtype !== input.binding.entitySubtype
  )
    fail(
      'edit.unauthorized_change',
      'future binding creation role does not match its entity descriptor'
    )
  assertAdmittedCreationKey(
    input.creationKey,
    creationRole,
    input.binding.entityKind
  )
  if (
    input.createdEntityKind !== input.binding.entityKind ||
    input.createdEntitySubtype !== input.binding.entitySubtype
  )
    fail(
      'edit.unauthorized_change',
      'future binding created entity kind or subtype differs from its descriptor'
    )
  if (!SHA256_PATTERN.test(input.creatorOperationOccurrenceId))
    fail(
      'edit.unauthorized_change',
      'future binding creator occurrence must be a lowercase SHA-256'
    )
  if (!SHA256_PATTERN.test(input.resultLineageId))
    fail(
      'edit.unauthorized_change',
      'future binding result lineage must be a lowercase SHA-256'
    )
  if (
    input.ownerLineageId !== null &&
    !SHA256_PATTERN.test(input.ownerLineageId)
  )
    fail(
      'edit.unauthorized_change',
      'future binding owner lineage must be a lowercase SHA-256'
    )
  const expectedOccurrenceId = operationOccurrenceIdHashV1(
    input.predecessorAcceptedHistorySha256,
    input.creatorOperationId
  )
  if (expectedOccurrenceId !== input.creatorOperationOccurrenceId)
    fail(
      'edit.unauthorized_change',
      'future binding creator occurrence does not match its history domain'
    )
  if (!Number.isSafeInteger(input.collisionNonce) || input.collisionNonce < 0)
    fail(
      'edit.unauthorized_change',
      'future binding lineage collision nonce is invalid'
    )
  const expectedResultLineageId = semanticHashV1('lineage', {
    kind: 'created-semantic-lineage',
    schemaVersion: 1,
    predecessorAcceptedHistorySha256: input.predecessorAcceptedHistorySha256,
    operationId: input.creatorOperationId,
    entityKind: expectedLineageKind(input.binding),
    creationKey: input.creationKey,
    collisionNonce: input.collisionNonce,
  })
  if (expectedResultLineageId !== input.resultLineageId)
    fail(
      'edit.unauthorized_change',
      'future binding result lineage does not match creator provenance'
    )
  const bindingKeySha256 = futureBindingKeySha256V1(
    changeContractSha256,
    input.binding.bindingKey
  )
  const creationProjectionSha256 = futureBindingCreationProjectionSha256V1(
    input.binding
  )
  return {
    bindingKeySha256,
    bindingDescriptorSha256: futureBindingDescriptorSha256V1(input.binding),
    creationProjectionSha256,
    creatorOperationOccurrenceId: input.creatorOperationOccurrenceId,
    resultLineageId: input.resultLineageId,
    ownerLineageId: input.ownerLineageId,
    resultCorrespondenceSha256: futureBindingResultCorrespondenceSha256V1(
      bindingKeySha256,
      creationProjectionSha256,
      input.creatorOperationOccurrenceId,
      input.resultLineageId,
      input.ownerLineageId
    ),
  }
}

function sameRealization(
  left: FutureBindingRealizationV1,
  right: FutureBindingRealizationV1
): boolean
{
  return ROW_KEYS.every(
    (key) =>
      left[key as keyof FutureBindingRealizationV1] ===
      right[key as keyof FutureBindingRealizationV1]
  )
}

export function appendFutureBindingRealizationsV1(
  ledger: FutureBindingLedgerV1,
  contract: EditSemanticChangeContractV1,
  priorLineageHistory: SemanticLineageSnapshot,
  lineageHistory: SemanticLineageSnapshot,
  inputs: readonly FutureBindingRealizationInputV1[],
  resolveOwnerLineageId?: FutureBindingOwnerLineageResolverV1
): FutureBindingLedgerV1
{
  validateFutureBindingLedgerV1(
    ledger,
    contract,
    lineageHistory,
    resolveOwnerLineageId
  )
  const exactPriorHistory = validateSemanticLineageSnapshot(priorLineageHistory)
  const exactLineageHistory = validateSemanticLineageSnapshot(lineageHistory)
  const priorLineageIds = new Set(
    exactPriorHistory.records.map((record) => record.lineageId)
  )
  const lineageById = new Map(
    exactLineageHistory.records.map((record) => [record.lineageId, record])
  )
  const exactContract = parsedContract(contract)
  const contractBindings = new Map(
    exactContract.entityBindings
      .filter(
        (binding): binding is FutureContractBindingV1 =>
          binding.bindingKind === 'future'
      )
      .map((binding) => [binding.bindingKey, binding])
  )
  const byBinding = new Map(
    ledger.realizations.map((row) => [row.bindingKeySha256, row])
  )
  const byResult = new Map(
    ledger.realizations.map((row) => [row.resultLineageId, row])
  )
  for (const input of inputs)
  {
    const exactBinding = contractBindings.get(input.binding.bindingKey)
    if (
      !exactBinding ||
      futureBindingDescriptorSha256V1(exactBinding) !==
        futureBindingDescriptorSha256V1(input.binding)
    )
      fail(
        'edit.unauthorized_change',
        'future binding realization descriptor is not in the exact contract'
      )
    const row = realizationForInput(ledger.changeContractSha256, input)
    const existingBinding = byBinding.get(row.bindingKeySha256)
    const existingResult = byResult.get(row.resultLineageId)
    if (existingBinding && !sameRealization(existingBinding, row))
      fail(
        'edit.unauthorized_change',
        'future binding realization cannot change an existing mapping'
      )
    if (existingResult && !sameRealization(existingResult, row))
      fail(
        'edit.unauthorized_change',
        'future binding result lineage is already bound'
      )
    if (!existingBinding)
    {
      const result = lineageById.get(row.resultLineageId)
      const owner =
        row.ownerLineageId === null ? null : lineageById.get(row.ownerLineageId)
      if (
        priorLineageIds.has(row.resultLineageId) ||
        !result ||
        result.status !== 'active'
      )
        fail(
          'edit.unauthorized_change',
          'future binding result was not newly active in this operation'
        )
      if (row.ownerLineageId !== null && owner?.status !== 'active')
        fail(
          'edit.unauthorized_change',
          'future binding owner is not active at creation'
        )
      if (
        result.kind !== expectedLineageKind(exactBinding) ||
        !lineageSubtypeMatches(exactBinding, result)
      )
        fail(
          'edit.unauthorized_change',
          'future binding created lineage kind or subtype differs'
        )
      byBinding.set(row.bindingKeySha256, row)
      byResult.set(row.resultLineageId, row)
    }
  }
  const appended = immutableLedger(
    ledger.changeContractSha256,
    [...byBinding.values()].sort(compareRealizations)
  )
  return validateFutureBindingLedgerV1(
    appended,
    contract,
    lineageHistory,
    resolveOwnerLineageId
  )
}

export function reconcileRestoreFutureBindingLedgerV1(
  currentLedger: FutureBindingLedgerV1,
  selectedLedger: FutureBindingLedgerV1,
  contract: EditSemanticChangeContractV1,
  lineageHistory: SemanticLineageSnapshot,
  resolveOwnerLineageId?: FutureBindingOwnerLineageResolverV1
): FutureBindingLedgerV1
{
  validateFutureBindingLedgerV1(
    currentLedger,
    contract,
    lineageHistory,
    resolveOwnerLineageId
  )
  validateFutureBindingLedgerV1(
    selectedLedger,
    contract,
    lineageHistory,
    resolveOwnerLineageId
  )
  const currentRows = new Map(
    currentLedger.realizations.map((row) => [row.bindingKeySha256, row])
  )
  for (const selected of selectedLedger.realizations)
  {
    const current = currentRows.get(selected.bindingKeySha256)
    if (!current || !sameRealization(current, selected))
      fail(
        'edit.internal_invariant',
        'selected restore ledger is not an exact subset of monotonic history'
      )
  }
  return currentLedger
}

export function resolveFutureBindingLineageV1(
  ledger: FutureBindingLedgerV1,
  bindingKey: string,
  contract: EditSemanticChangeContractV1,
  lineageHistory: SemanticLineageSnapshot,
  resolveOwnerLineageId?: FutureBindingOwnerLineageResolverV1
): string
{
  validateFutureBindingLedgerV1(
    ledger,
    contract,
    lineageHistory,
    resolveOwnerLineageId
  )
  const binding = contract.entityBindings.find(
    (candidate): candidate is FutureContractBindingV1 =>
      candidate.bindingKind === 'future' && candidate.bindingKey === bindingKey
  )
  if (!binding)
    fail(
      'edit.unauthorized_change',
      'future binding key is absent from the exact contract'
    )
  const row = ledger.realizations.find(
    (candidate) =>
      candidate.bindingKeySha256 ===
      futureBindingKeySha256V1(ledger.changeContractSha256, bindingKey)
  )
  if (!row)
    fail('edit.unauthorized_change', 'future binding has not been realized')
  return row.resultLineageId
}
