// tests/mcp/tool-audit.test.ts
// audit completion fault windows, reconciliation, & idempotency authority

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  AUDIT_KEY_PURPOSE_V1,
  type AuditKeyMaterialV1,
  type AuditKeyProviderPort,
  type EditToolReceiptFreeResultV1,
} from '@scratch-agent/edit'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import type { DurableArtifactFaultContext } from '@scratch-agent/eval'
import {
  AUDIT_IDEMPOTENCY_PREFIX,
  AUDIT_TAIL_KEY,
  AuditInvariantErrorV1,
  DurableToolAuditJournalV1,
  editReceiptFreeOutcomeSha256V1,
  type AuditServerStoreIdentityV1,
} from '@scratch-agent/mcp'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const HASH_F = 'f'.repeat(64)

const AUDIT_KEY: AuditKeyMaterialV1 = Object.freeze({
  auditKeyId: 'audit_key_fault_windows_v1',
  algorithm: 'HMAC-SHA-256',
  algorithmVersion: 1,
  purpose: AUDIT_KEY_PURPOSE_V1,
  secret: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
})

const AUDIT_IDENTITY: AuditServerStoreIdentityV1 = Object.freeze({
  serverInstanceId: 'server_fault_window_0001',
  runId: 'run_fault_window_000001',
  realmSha256: HASH_A,
  profileSha256: HASH_B,
  boundaryPolicySha256: HASH_C,
  predecessor: Object.freeze({ state: 'absent' }),
})

const RECEIPT_FREE_OUTCOME: EditToolReceiptFreeResultV1 = Object.freeze({
  schemaVersion: 1,
  tool: 'edit_capabilities',
  ok: true,
  data: Object.freeze({
    capabilityProfileSha256: HASH_D,
    capabilitySnapshotSha256: HASH_E,
    collection: Object.freeze({
      collectionSha256: HASH_F,
      items: Object.freeze([]),
      totalCount: 0,
    }),
    evidenceIds: Object.freeze([]),
  }),
})

class SingleFaultController
{
  #match: ((context: DurableArtifactFaultContext) => boolean) | null = null
  #label = 'unarmed audit fault'

  readonly hook = (context: DurableArtifactFaultContext): void =>
  {
    if (!this.#match?.(context)) return
    const label = this.#label
    this.#match = null
    throw new Error(label)
  }

  arm(
    label: string,
    match: (context: DurableArtifactFaultContext) => boolean
  ): void
  {
    this.#label = label
    this.#match = match
  }
}

interface AuditHarness
{
  readonly root: string
  readonly storeKey: string
  readonly keys: AuditKeyProviderPort
  readonly controller: SingleFaultController
  readonly journal: DurableToolAuditJournalV1
}

async function openAuditHarness(
  t: test.TestContext,
  label: string
): Promise<AuditHarness>
{
  const root = mkdtempSync(join(tmpdir(), `agentic-scratch-audit-${label}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const controller = new SingleFaultController()
  const keys: AuditKeyProviderPort = Object.freeze({
    activeKey: async () => AUDIT_KEY,
    verificationKey: async (auditKeyId: string) =>
    {
      assert.equal(auditKeyId, AUDIT_KEY.auditKeyId)
      return AUDIT_KEY
    },
  })
  const storeKey = `fault-${label}`
  const journal = await DurableToolAuditJournalV1.create({
    serverRoot: root,
    storeKey,
    identity: AUDIT_IDENTITY,
    keys,
    faultHook: controller.hook,
  })
  return { root, storeKey, keys, controller, journal }
}

function beginIdempotentCall(journal: DurableToolAuditJournalV1)
{
  return journal.beginCall({
    boundary: { boundaryKind: 'tool', tool: 'edit_capabilities' },
    schemaProfileSha256: HASH_B,
    policySha256: HASH_C,
    fullInputSha256: HASH_D,
    inputByteLength: 64,
    principal: { state: 'authenticated', principalSha256: HASH_E },
    idempotency: {
      state: 'present',
      namespaceSha256: HASH_F,
      requestIdSha256: HASH_A,
    },
  })
}

function completeIdempotentCall(
  journal: DurableToolAuditJournalV1,
  callId: string
)
{
  return journal.completeCall({
    callId,
    disposition: 'completed',
    resultSha256: editReceiptFreeOutcomeSha256V1(RECEIPT_FREE_OUTCOME),
    receiptFreeOutcome: RECEIPT_FREE_OUTCOME,
  })
}

async function reopenHarness(
  harness: AuditHarness
): Promise<DurableToolAuditJournalV1>
{
  return DurableToolAuditJournalV1.reopen({
    serverRoot: harness.root,
    storeKey: harness.storeKey,
    identity: AUDIT_IDENTITY,
    keys: harness.keys,
    faultHook: harness.controller.hook,
  })
}

function assertExactlyOneCompletedAuthority(
  journal: DurableToolAuditJournalV1
): void
{
  const reconciliation = journal.verify()
  const records = [...reconciliation.records.values()]
  assert.equal(reconciliation.authenticated, true)
  assert.equal(reconciliation.tail.recordCount, 2)
  assert.equal(reconciliation.tail.expectedNextSequence, 2)
  assert.equal(records.length, 2)
  assert.equal(
    records.filter((record) => record.record.record.phase === 'call-begin')
      .length,
    1
  )
  assert.equal(
    records.filter((record) => record.record.record.phase === 'call-complete')
      .length,
    1
  )
  assert.deepEqual(journal.unmatchedBegins(), [])
  const lookup = journal.lookupIdempotencyV1({
    namespaceSha256: HASH_F,
    requestIdSha256: HASH_A,
    fullInputSha256: HASH_D,
    boundary: { boundaryKind: 'tool', tool: 'edit_capabilities' },
  })
  assert.equal(lookup.state, 'matched')
  if (lookup.state !== 'matched') return
  assert.deepEqual(lookup.outcome.receiptFreeOutcome, RECEIPT_FREE_OUTCOME)
  assert.equal(
    lookup.outcome.receiptFreeOutcomeByteLength,
    canonicalJsonBytesV1(RECEIPT_FREE_OUTCOME).byteLength
  )
  assert.equal(
    lookup.outcome.resultSha256,
    editReceiptFreeOutcomeSha256V1(RECEIPT_FREE_OUTCOME)
  )
}

test('idempotency-only completion authority recovers exactly once', async (t) =>
{
  const harness = await openAuditHarness(t, 'idempotency-after-install')
  const begun = beginIdempotentCall(harness.journal)
  let idempotencyInstalled = false
  harness.controller.arm('completion record before install', (context) =>
  {
    if (
      context.point === 'immutable.afterInstall' &&
      context.key?.startsWith(`${AUDIT_IDEMPOTENCY_PREFIX}/`) === true
    )
    {
      idempotencyInstalled = true
      return false
    }
    return (
      idempotencyInstalled &&
      context.point === 'immutable.beforeInstall' &&
      context.key?.includes('-call-complete-') === true
    )
  })

  assert.throws(
    () => completeIdempotentCall(harness.journal, begun.callId),
    (error: unknown) =>
      error instanceof AuditInvariantErrorV1 &&
      error.invariant === 'audit.append-failed'
  )
  assert.equal(idempotencyInstalled, true)

  const reopened = await reopenHarness(harness)
  assert.equal(reopened.reconciliation.rolledForward, false)
  const unmatched = reopened.unmatchedBegins()
  assert.equal(unmatched.length, 1)
  assert.equal(unmatched[0]?.callId, begun.callId)
  const retained = unmatched[0]?.retainedOutcome
  assert.ok(retained)
  assert.deepEqual(retained.receiptFreeOutcome, RECEIPT_FREE_OUTCOME)
  const receipt = reopened.completeRecoveredCallV1({
    callId: begun.callId,
    disposition: retained.disposition,
    resultSha256: retained.resultSha256,
    preHead: retained.preHead,
    postHead: retained.postHead,
    semanticEvent: retained.semanticEvent,
    evidenceIds: retained.evidenceIds,
    receiptFreeOutcome: retained.receiptFreeOutcome,
  })
  assert.equal(receipt.beginSequence, begun.sequence)
  assert.equal(receipt.completeSequence, begun.sequence + 1)
  assertExactlyOneCompletedAuthority(reopened)
  assert.throws(
    () =>
      reopened.completeRecoveredCallV1({
        callId: begun.callId,
        disposition: retained.disposition,
        resultSha256: retained.resultSha256,
        receiptFreeOutcome: retained.receiptFreeOutcome,
      }),
    (error: unknown) =>
      error instanceof AuditInvariantErrorV1 &&
      error.invariant === 'audit.unknown-call'
  )
  assertExactlyOneCompletedAuthority(reopened)
})

for (const fault of [
  {
    label: 'record-after-install',
    point: 'immutable.afterInstall',
    matchesKey: (key: string | null): boolean =>
      key?.includes('-call-complete-') === true,
    rolledForward: true,
  },
  {
    label: 'tail-after-install',
    point: 'pointer.afterInstall',
    matchesKey: (key: string | null): boolean => key === AUDIT_TAIL_KEY,
    rolledForward: false,
  },
] as const)
{
  test(`${fault.label} fault reconciles to one completed audit authority`, async (t) =>
  {
    const harness = await openAuditHarness(t, fault.label)
    const begun = beginIdempotentCall(harness.journal)
    harness.controller.arm(
      fault.label,
      (context) =>
        context.point === fault.point && fault.matchesKey(context.key)
    )

    assert.throws(
      () => completeIdempotentCall(harness.journal, begun.callId),
      (error: unknown) =>
        error instanceof AuditInvariantErrorV1 &&
        error.invariant === 'audit.append-failed'
    )

    const reopened = await reopenHarness(harness)
    assert.equal(reopened.reconciliation.rolledForward, fault.rolledForward)
    assertExactlyOneCompletedAuthority(reopened)
    assert.throws(
      () =>
        reopened.completeRecoveredCallV1({
          callId: begun.callId,
          disposition: 'completed',
          resultSha256: editReceiptFreeOutcomeSha256V1(RECEIPT_FREE_OUTCOME),
          receiptFreeOutcome: RECEIPT_FREE_OUTCOME,
        }),
      (error: unknown) =>
        error instanceof AuditInvariantErrorV1 &&
        error.invariant === 'audit.unknown-call'
    )
    assertExactlyOneCompletedAuthority(reopened)
  })
}
