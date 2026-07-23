// tests/edit/assets/asset-admission.test.ts
// atomic asset admission & authored materialization accounting

import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import {
  deriveAuthoringMediaIdentity,
  resolveEditAdmissionLimits,
} from '@scratch-agent/sb3'

import { SessionAssetStoreV1, type AssetMaterializationLedgerV1 } from '../../../packages/edit/src/assets/asset-admission.js'
import { pngChunk } from '../../helpers/png.js'

function solidPng(red: number): Uint8Array
{
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, 4, false)
  view.setUint32(4, 3, false)
  header[8] = 8
  header[9] = 6
  const raw: number[] = []
  for (let row = 0; row < 3; row += 1)
  {
    raw.push(0)
    for (let column = 0; column < 4; column += 1)
      raw.push(red, 0x20, 0x40, 0xff)
  }
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', deflateSync(Uint8Array.from(raw))),
    ...pngChunk('IEND', new Uint8Array()),
  ])
}

function emptyAuthoredUsage(
  admittedEditAssets: number,
  admittedEditAssetBytes: number
): AssetMaterializationLedgerV1
{
  return {
    admittedEditAssets,
    admittedEditAssetBytes,
    authoredCostumeTextureMaterializations: 0,
    authoredCostumeReferencePixels: 0,
    authoredDecodedRgbaEstimateBytes: 0,
  }
}

test('refused distinct-payload admission leaves ledger, records, and sequence unchanged', async () =>
{
  const firstBytes = solidPng(0x11)
  const refusedBytes = solidPng(0x44)
  assert.equal(firstBytes.byteLength, refusedBytes.byteLength)
  const [firstIdentity, refusedIdentity] = await Promise.all([
    deriveAuthoringMediaIdentity(
      firstBytes,
      'costume',
      resolveEditAdmissionLimits()
    ),
    deriveAuthoringMediaIdentity(
      refusedBytes,
      'costume',
      resolveEditAdmissionLimits()
    ),
  ])
  const store = new SessionAssetStoreV1({
    sessionSalt: new Uint8Array(32).fill(0x21),
    policyOverrides: {
      admittedEditAssetBytes: firstBytes.byteLength,
    },
  })
  const first = await store.admitSourceMedia({
    bytes: firstBytes,
    mediaKind: 'costume',
    expectedPayloadSha256: firstIdentity.sha256,
  })
  const ledgerBefore = store.ledger()
  const recordsBefore = store.records()
  await assert.rejects(
    store.admitSourceMedia({
      bytes: refusedBytes,
      mediaKind: 'costume',
      expectedPayloadSha256: refusedIdentity.sha256,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.session_budget_exceeded'
  )
  assert.deepEqual(store.ledger(), ledgerBefore)
  assert.deepEqual(store.records(), recordsBefore)
  await assert.rejects(
    store.admitSourceMedia({
      bytes: refusedBytes,
      mediaKind: 'costume',
      expectedPayloadSha256: refusedIdentity.sha256,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.session_budget_exceeded'
  )
  const repeated = await store.admitSourceMedia({
    bytes: firstBytes,
    mediaKind: 'costume',
    expectedPayloadSha256: firstIdentity.sha256,
  })
  assert.equal(first.admittedSequence, 1)
  assert.equal(repeated.admittedSequence, 2)
  assert.deepEqual(store.ledger(), emptyAuthoredUsage(2, firstBytes.byteLength))
})

test('materialization usage validates atomically and counts every token occurrence', async () =>
{
  const bytes = solidPng(0x77)
  const identity = await deriveAuthoringMediaIdentity(
    bytes,
    'costume',
    resolveEditAdmissionLimits()
  )
  if (identity.mediaKind !== 'costume')
    throw new Error('costume admission derived a sound identity')
  const refusing = new SessionAssetStoreV1({
    sessionSalt: new Uint8Array(32).fill(0x32),
    policyOverrides: {
      authoredCostumeTextureMaterializations: 2,
      authoredCostumeReferencePixels: 0,
      authoredDecodedRgbaEstimateBytes: 0,
    },
  })
  const refusedRecord = await refusing.admitSourceMedia({
    bytes,
    mediaKind: 'costume',
    expectedPayloadSha256: identity.sha256,
  })
  const before = refusing.ledger()
  const recordsBefore = refusing.records()
  const refusedUsage = refusing.materializationUsage([refusedRecord.assetToken])
  assert.throws(
    () => refusing.commitMaterializationUsage(refusedUsage),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.session_budget_exceeded'
  )
  assert.deepEqual(refusing.ledger(), before)
  assert.deepEqual(refusing.records(), recordsBefore)
  const repeatedAdmission = await refusing.admitSourceMedia({
    bytes,
    mediaKind: 'costume',
    expectedPayloadSha256: identity.sha256,
  })
  assert.equal(repeatedAdmission.admittedSequence, 2)
  assert.deepEqual(refusing.ledger(), emptyAuthoredUsage(2, bytes.byteLength))

  const committing = new SessionAssetStoreV1({
    sessionSalt: new Uint8Array(32).fill(0x43),
  })
  const record = await committing.admitSourceMedia({
    bytes,
    mediaKind: 'costume',
    expectedPayloadSha256: identity.sha256,
  })
  assert.deepEqual(committing.ledger(), emptyAuthoredUsage(1, bytes.byteLength))
  const repeatedUsage = committing.materializationUsage([
    record.assetToken,
    record.assetToken,
  ])
  assert.deepEqual(repeatedUsage.authoredCostumeAssetTokens, [
    record.assetToken,
    record.assetToken,
  ])
  const prospective = committing.prospectiveMaterializationLedger(repeatedUsage)
  assert.equal(prospective.authoredCostumeTextureMaterializations, 2)
  assert.deepEqual(committing.ledger(), emptyAuthoredUsage(1, bytes.byteLength))
  committing.commitMaterializationUsage(repeatedUsage)
  assert.deepEqual(committing.ledger(), {
    admittedEditAssets: 1,
    admittedEditAssetBytes: bytes.byteLength,
    authoredCostumeTextureMaterializations: 2,
    authoredCostumeReferencePixels: identity.canvasPixels * 2,
    authoredDecodedRgbaEstimateBytes: identity.canvasPixels * 8,
  })
})
