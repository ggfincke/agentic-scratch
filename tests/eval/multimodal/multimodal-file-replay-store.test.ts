// tests/eval/multimodal/multimodal-file-replay-store.test.ts
// crash-window replay capacity accounting rejects orphan reservations

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type {
  VlmReplayEntryV1,
  VlmRequestKey,
} from '@scratch-agent/eval'
import {
  FileVlmReplayStore,
  MAX_FILE_VLM_REPLAY_RECORDS,
} from '@scratch-agent/eval'

const SLOT_DIRECTORY = '.multimodal-vlm-replay-slots'

function requestKey(digit: string): VlmRequestKey
{
  return `multimodal-vlm-v1:${digit.repeat(64)}`
}

function replayEntry(key: VlmRequestKey): VlmReplayEntryV1
{
  return {
    record: { key },
    recordSha256: '0'.repeat(64),
  } as unknown as VlmReplayEntryV1
}

function createOrphanReservation(root: string, key: VlmRequestKey): void
{
  const slotRoot = join(root, SLOT_DIRECTORY)
  for (let index = 0; index < MAX_FILE_VLM_REPLAY_RECORDS; index++)
  {
    const slotPath = join(slotRoot, `${index.toString().padStart(3, '0')}.slot`)
    if (existsSync(slotPath)) continue
    writeFileSync(slotPath, `${key}\n`, { flag: 'wx', mode: 0o600 })
    return
  }
  assert.fail('expected an empty replay capacity slot')
}

test('file replay storage rejects a crash-orphan capacity reservation', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'multimodal-file-replay-store-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new FileVlmReplayStore(root)
  const retained = replayEntry(requestKey('a'))
  const orphanKey = requestKey('c')
  const rejected = replayEntry(requestKey('d'))

  await store.writeExclusive(retained)
  createOrphanReservation(root, orphanKey)
  const reopened = new FileVlmReplayStore(root)
  await assert.rejects(
    reopened.writeExclusive(rejected),
    new RegExp(`capacity reservation has no record: ${orphanKey}`)
  )
  assert.deepEqual(await reopened.read(retained.record.key), retained)
  assert.equal(await reopened.read(orphanKey), null)
  assert.equal(await reopened.read(rejected.record.key), null)
})
