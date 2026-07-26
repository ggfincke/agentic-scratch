// tests/edit/lineage/future-binding-ledger.test.ts
// durable hash-only future-binding realization, restore, & tamper authority

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  declarationCreationContentFingerprintV1,
  parseSemanticChangeContractV1,
  semanticHashV1,
  type EditSemanticChangeContractV1,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'

import { appendFutureBindingRealizationsV1, emptyFutureBindingLedgerV1, reconcileRestoreFutureBindingLedgerV1, resolveFutureBindingLineageV1, validateFutureBindingLedgerV1 } from '../../../packages/edit/src/lineage/future-binding-ledger.js'

const TARGET_LINEAGE_ID = '1'.repeat(64)
const PREDECESSOR_HISTORY_SHA256 = '2'.repeat(64)
const CREATOR_OPERATION_ID = 'create-bound-variable'
const CREATION_KEY = 'fixed:declaration'
const OCCURRENCE_ID = semanticHashV1('resolved-plan', {
  kind: 'edit-operation-occurrence',
  schemaVersion: 1,
  predecessorAcceptedHistorySha256: PREDECESSOR_HISTORY_SHA256,
  opId: CREATOR_OPERATION_ID,
})
const RESULT_LINEAGE_ID = semanticHashV1('lineage', {
  kind: 'created-semantic-lineage',
  schemaVersion: 1,
  predecessorAcceptedHistorySha256: PREDECESSOR_HISTORY_SHA256,
  operationId: CREATOR_OPERATION_ID,
  entityKind: 'declaration',
  creationKey: CREATION_KEY,
  collisionNonce: 0,
})
const OTHER_PREDECESSOR_HISTORY_SHA256 = '3'.repeat(64)
const OTHER_CREATOR_OPERATION_ID = 'create-replacement-variable'
const OTHER_OCCURRENCE_ID = semanticHashV1('resolved-plan', {
  kind: 'edit-operation-occurrence',
  schemaVersion: 1,
  predecessorAcceptedHistorySha256: OTHER_PREDECESSOR_HISTORY_SHA256,
  opId: OTHER_CREATOR_OPERATION_ID,
})
const OTHER_LINEAGE_ID = semanticHashV1('lineage', {
  kind: 'created-semantic-lineage',
  schemaVersion: 1,
  predecessorAcceptedHistorySha256: OTHER_PREDECESSOR_HISTORY_SHA256,
  operationId: OTHER_CREATOR_OPERATION_ID,
  entityKind: 'declaration',
  creationKey: CREATION_KEY,
  collisionNonce: 0,
})
const FUTURE_BINDING_KEY = 'future-variable'

function futureBindingContract(): EditSemanticChangeContractV1
{
  const parsedBase = parseSemanticChangeContractV1(
    SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
  )
  assert.equal(parsedBase.ok, true)
  if (!parsedBase.ok)
    throw new Error('base future-binding test contract is invalid')
  const base = parsedBase.value
  const target = {
    contractRefKind: 'existing',
    entityKind: 'target',
    entitySubtype: 'stage',
    bindingKey: 'stage',
  } as const
  const descriptor = {
    bindingKind: 'future',
    entityKind: 'declaration',
    entitySubtype: 'variable',
    expectedCreatorOperationKind: 'declaration.addVariable',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'declaration',
      entityKind: 'declaration',
      entitySubtype: 'variable',
    },
    expectedCreationScope: {
      scopeKind: 'targetAndOwnedDescendants',
      target,
    },
  } as const
  const expectedCreationContentFingerprintSha256 =
    declarationCreationContentFingerprintV1(
      {
        kind: 'declaration.addVariable',
        name: 'Bound',
        cloud: false,
        initialValue: 1,
      },
      descriptor
    )
  const contract = {
    ...base,
    entityBindings: [
      ...base.entityBindings,
      {
        bindingKey: FUTURE_BINDING_KEY,
        ...descriptor,
        expectedCreationContentFingerprintSha256,
      },
    ],
    allowedOperationKinds: [
      ...new Set([
        ...base.allowedOperationKinds,
        'declaration.addVariable' as const,
        'declaration.setVariableInitialValue' as const,
      ]),
    ],
    allowedSemanticScopes: [
      ...base.allowedSemanticScopes,
      {
        scopeSubjectKind: 'entity',
        operationKind: 'declaration.addVariable',
        entityKind: 'declaration',
        entitySubtype: 'variable',
        locationScope: {
          scopeKind: 'targetAndOwnedDescendants',
          target,
        },
        allowedPropertyPaths: [
          { surface: 'declaration', property: 'name' },
          { surface: 'declaration', property: 'initialValue' },
        ],
      },
      {
        scopeSubjectKind: 'entity',
        operationKind: 'declaration.setVariableInitialValue',
        entityKind: 'declaration',
        entitySubtype: 'variable',
        locationScope: {
          scopeKind: 'exactEntity',
          entity: {
            contractRefKind: 'future',
            entityKind: 'declaration',
            entitySubtype: 'variable',
            bindingKey: FUTURE_BINDING_KEY,
          },
        },
        allowedPropertyPaths: [
          { surface: 'declaration', property: 'initialValue' },
        ],
      },
    ],
  }
  const parsed = parseSemanticChangeContractV1(contract)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('future-binding test contract is invalid')
  return parsed.value
}

function lineage(status: 'active' | 'tombstoned'): SemanticLineageSnapshot
{
  return {
    version: 'semantic-lineage-v1',
    records: [
      {
        lineageId: TARGET_LINEAGE_ID,
        kind: 'target',
        ownerLineageId: null,
        status: 'active',
        rawIdentity: 'target:0',
        canonicalOrdinal: 0,
      },
      {
        lineageId: RESULT_LINEAGE_ID,
        kind: 'declaration',
        ownerLineageId: TARGET_LINEAGE_ID,
        status,
        rawIdentity: 'variable:generated',
        canonicalOrdinal: status === 'active' ? 0 : null,
      },
    ],
  }
}

function priorLineage(): SemanticLineageSnapshot
{
  return {
    version: 'semantic-lineage-v1',
    records: [lineage('active').records[0]!],
  }
}

test('future-binding ledger is immutable across tombstone, restore, remap, and field tamper', () =>
{
  const contract = futureBindingContract()
  const changeContractSha256 = semanticHashV1('change-contract', contract)
  const binding = contract.entityBindings.find(
    (candidate) =>
      candidate.bindingKind === 'future' &&
      candidate.bindingKey === FUTURE_BINDING_KEY
  )
  assert.ok(binding && binding.bindingKind === 'future')
  const resolveOwner = () => TARGET_LINEAGE_ID
  const empty = emptyFutureBindingLedgerV1(changeContractSha256)
  const realized = appendFutureBindingRealizationsV1(
    empty,
    contract,
    priorLineage(),
    lineage('active'),
    [
      {
        binding,
        creatorOperationOccurrenceId: OCCURRENCE_ID,
        predecessorAcceptedHistorySha256: PREDECESSOR_HISTORY_SHA256,
        creatorOperationId: CREATOR_OPERATION_ID,
        creatorOperationKind: 'declaration.addVariable',
        createdEntityKind: 'declaration',
        createdEntitySubtype: 'variable',
        collisionNonce: 0,
        creationKey: CREATION_KEY,
        resultLineageId: RESULT_LINEAGE_ID,
        ownerLineageId: TARGET_LINEAGE_ID,
      },
    ],
    resolveOwner
  )
  assert.equal(realized.realizations.length, 1)
  assert.equal(JSON.stringify(realized).includes(FUTURE_BINDING_KEY), false)
  assert.equal(
    resolveFutureBindingLineageV1(
      realized,
      FUTURE_BINDING_KEY,
      contract,
      lineage('tombstoned'),
      resolveOwner
    ),
    RESULT_LINEAGE_ID
  )
  assert.equal(
    reconcileRestoreFutureBindingLedgerV1(
      realized,
      empty,
      contract,
      lineage('tombstoned'),
      resolveOwner
    ),
    realized
  )
  const exactCreationInput = {
    binding,
    creatorOperationOccurrenceId: OCCURRENCE_ID,
    predecessorAcceptedHistorySha256: PREDECESSOR_HISTORY_SHA256,
    creatorOperationId: CREATOR_OPERATION_ID,
    creatorOperationKind: 'declaration.addVariable' as const,
    createdEntityKind: 'declaration' as const,
    createdEntitySubtype: 'variable' as const,
    collisionNonce: 0,
    creationKey: CREATION_KEY,
    resultLineageId: RESULT_LINEAGE_ID,
    ownerLineageId: TARGET_LINEAGE_ID,
  }
  assert.throws(
    () =>
      appendFutureBindingRealizationsV1(
        empty,
        contract,
        priorLineage(),
        lineage('active'),
        [
          {
            ...exactCreationInput,
            creatorOperationKind: 'declaration.addList',
          },
        ],
        resolveOwner
      ),
    /creator kind does not match/u
  )
  assert.throws(
    () =>
      appendFutureBindingRealizationsV1(
        empty,
        contract,
        priorLineage(),
        lineage('active'),
        [
          {
            ...exactCreationInput,
            createdEntityKind: 'comment',
            createdEntitySubtype: 'unspecialized',
          },
        ],
        resolveOwner
      ),
    /created entity kind or subtype differs/u
  )
  assert.throws(
    () =>
      appendFutureBindingRealizationsV1(
        empty,
        contract,
        priorLineage(),
        lineage('active'),
        [
          {
            ...exactCreationInput,
            createdEntitySubtype: 'list',
          },
        ],
        resolveOwner
      ),
    /created entity kind or subtype differs/u
  )
  const forgedCreationKeyLineageId = semanticHashV1('lineage', {
    kind: 'created-semantic-lineage',
    schemaVersion: 1,
    predecessorAcceptedHistorySha256: PREDECESSOR_HISTORY_SHA256,
    operationId: CREATOR_OPERATION_ID,
    entityKind: 'declaration',
    creationKey: 'fixed:attacker-controlled',
    collisionNonce: 0,
  })
  assert.throws(
    () =>
      appendFutureBindingRealizationsV1(
        empty,
        contract,
        priorLineage(),
        {
          version: 'semantic-lineage-v1',
          records: [
            priorLineage().records[0]!,
            {
              lineageId: forgedCreationKeyLineageId,
              kind: 'declaration',
              ownerLineageId: TARGET_LINEAGE_ID,
              status: 'active',
              rawIdentity: 'variable:forged',
              canonicalOrdinal: 0,
            },
          ],
        },
        [
          {
            ...exactCreationInput,
            resultLineageId: forgedCreationKeyLineageId,
          },
        ],
        resolveOwner
      ),
    /result lineage does not match creator provenance/u
  )
  assert.throws(() =>
    appendFutureBindingRealizationsV1(
      empty,
      contract,
      lineage('active'),
      lineage('active'),
      [exactCreationInput],
      resolveOwner
    )
  )
  assert.throws(() =>
    appendFutureBindingRealizationsV1(
      empty,
      contract,
      priorLineage(),
      lineage('tombstoned'),
      [exactCreationInput],
      resolveOwner
    )
  )
  assert.throws(() =>
    appendFutureBindingRealizationsV1(
      realized,
      contract,
      lineage('tombstoned'),
      {
        ...lineage('tombstoned'),
        records: [
          ...lineage('tombstoned').records,
          {
            lineageId: OTHER_LINEAGE_ID,
            kind: 'declaration',
            ownerLineageId: TARGET_LINEAGE_ID,
            status: 'active',
            rawIdentity: 'variable:replacement',
            canonicalOrdinal: 0,
          },
        ],
      },
      [
        {
          binding,
          creatorOperationOccurrenceId: OTHER_OCCURRENCE_ID,
          predecessorAcceptedHistorySha256: OTHER_PREDECESSOR_HISTORY_SHA256,
          creatorOperationId: OTHER_CREATOR_OPERATION_ID,
          creatorOperationKind: 'declaration.addVariable',
          createdEntityKind: 'declaration',
          createdEntitySubtype: 'variable',
          collisionNonce: 0,
          creationKey: CREATION_KEY,
          resultLineageId: OTHER_LINEAGE_ID,
          ownerLineageId: TARGET_LINEAGE_ID,
        },
      ],
      resolveOwner
    )
  )
  const row = realized.realizations[0]!
  for (const field of Object.keys(row) as (keyof typeof row)[])
  {
    const changed = {
      ...row,
      [field]: field === 'ownerLineageId' ? null : 'f'.repeat(64),
    }
    assert.throws(
      () =>
        validateFutureBindingLedgerV1(
          { ...realized, realizations: [changed] },
          contract,
          lineage('tombstoned'),
          resolveOwner
        ),
      field
    )
  }
})
