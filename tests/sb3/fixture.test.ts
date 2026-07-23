// tests/sb3/fixture.test.ts
// the fixture builder produces a deterministic, schema-valid .sb3

import assert from 'node:assert/strict'
import { test } from 'node:test'

import JSZip from 'jszip'

import {
  admitSb3,
  SB3_ADMISSION_CODES,
  Sb3AdmissionError,
} from '@scratch-agent/sb3'
import { buildFixtureSb3 } from '@scratch-agent/sb3'
import { DEFAULT_SB3_LIMITS } from '@scratch-agent/sb3'
import { unpackSb3 } from '@scratch-agent/sb3'
import { validateSb3 } from '@scratch-agent/sb3'

test('buildFixtureSb3 validates as a Scratch 3 project', async () =>
{
  const { sb3, assetCount } = await buildFixtureSb3()
  const result = await validateSb3(sb3)
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.projectVersion, 3)
  assert.equal(assetCount, 1)
})

test('buildFixtureSb3 is byte-for-byte deterministic', async () =>
{
  const a = await buildFixtureSb3()
  const b = await buildFixtureSb3()
  assert.deepEqual([...a.sb3], [...b.sb3])
})

async function zipOf(entries: Record<string, string | Uint8Array>)
{
  const zip = new JSZip()
  for (const [path, bytes] of Object.entries(entries))
  {
    zip.file(path, bytes, { createFolders: false })
  }
  return zip.generateAsync({ type: 'uint8array' })
}

async function deflatedZipOf(entries: Record<string, string | Uint8Array>)
{
  const zip = new JSZip()
  for (const [path, bytes] of Object.entries(entries))
  {
    zip.file(path, bytes, { createFolders: false })
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function zipWithAssetCount(assetCount: number): Promise<Uint8Array>
{
  const zip = new JSZip()
  zip.file('project.json', '{}')
  for (let index = 0; index < assetCount; index++)
  {
    zip.file(`${index.toString(16).padStart(32, '0')}.svg`, '')
  }
  return zip.generateAsync({ type: 'uint8array' })
}

function corruptFirstCentralCrc(bytes: Uint8Array): Uint8Array
{
  const result = bytes.slice()
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
  for (let offset = 0; offset + 46 <= result.byteLength; offset++)
  {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    view.setUint32(offset + 16, view.getUint32(offset + 16, true) ^ 1, true)
    return result
  }
  throw new Error('central directory not found')
}

function forgeFirstUncompressedSize(
  bytes: Uint8Array,
  advertised: number
): Uint8Array
{
  const result = bytes.slice()
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
  for (let offset = 0; offset + 46 <= result.byteLength; offset++)
  {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    const localOffset = view.getUint32(offset + 42, true)
    view.setUint32(offset + 24, advertised, true)
    view.setUint32(localOffset + 22, advertised, true)
    return result
  }
  throw new Error('central directory not found')
}

test('admitSb3 accepts real-world entry counts and retains the default cap', async () =>
{
  const acceptedEntries = DEFAULT_SB3_LIMITS.maxEntries
  const accepted = await admitSb3(await zipWithAssetCount(acceptedEntries - 1))
  assert.equal(accepted.metrics.entryCount, acceptedEntries)
  assert.equal(accepted.metrics.assetCount, acceptedEntries - 1)
  assert.equal(accepted.limits.maxEntries, DEFAULT_SB3_LIMITS.maxEntries)

  const rejected = await zipWithAssetCount(DEFAULT_SB3_LIMITS.maxEntries)
  await assert.rejects(
    () => admitSb3(rejected),
    (error: unknown) =>
    {
      assert.ok(error instanceof Sb3AdmissionError)
      assert.equal(error.code, SB3_ADMISSION_CODES.entryCountLimit)
      assert.equal(error.issue.observed, DEFAULT_SB3_LIMITS.maxEntries + 1)
      assert.equal(error.issue.limit, DEFAULT_SB3_LIMITS.maxEntries)
      assert.equal(error.limits.maxEntries, DEFAULT_SB3_LIMITS.maxEntries)
      return true
    }
  )
  const validation = await validateSb3(rejected)
  assert.equal(validation.ok, false)
  assert.equal(
    validation.admissionIssue?.code,
    SB3_ADMISSION_CODES.entryCountLimit
  )
})

test('unpackSb3 rejects oversized project.json before parsing', async () =>
{
  const sb3 = await zipOf({ 'project.json': '{"targets":[]}' })
  await assert.rejects(
    () => unpackSb3(sb3, { limits: { maxProjectJsonBytes: 4 } }),
    /project\.json exceeds 4 bytes/
  )
})

test('unpackSb3 rejects too many archive entries', async () =>
{
  const sb3 = await zipOf({
    'project.json': '{}',
    'a.svg': 'a',
    'b.svg': 'b',
  })
  await assert.rejects(
    () => unpackSb3(sb3, { limits: { maxEntries: 2 } }),
    /\.sb3 has 3 entries; max 2/
  )
})

test('unpackSb3 rejects oversized assets', async () =>
{
  const sb3 = await zipOf({ 'project.json': '{}', 'a.svg': 'xx' })
  await assert.rejects(
    () => unpackSb3(sb3, { limits: { maxAssetBytes: 1 } }),
    /asset a\.svg exceeds 1 bytes/
  )
})

test('unpackSb3 rejects excessive total asset bytes', async () =>
{
  const sb3 = await zipOf({
    'project.json': '{}',
    'a.svg': 'aa',
    'b.svg': 'bb',
  })
  await assert.rejects(
    () => unpackSb3(sb3, { limits: { maxTotalAssetBytes: 3 } }),
    /assets exceed 3 total bytes/
  )
})

test('unpackSb3 rejects invalid paths, limits, encoding, & entry integrity', async () =>
{
  const sb3 = await zipOf({ 'project.json': '{}', 'assets/a.svg': 'a' })
  await assert.rejects(
    () => unpackSb3(sb3),
    /invalid \.sb3 entry path "assets\/a\.svg"/
  )

  const minimal = await zipOf({ 'project.json': '{}' })
  await assert.rejects(
    () =>
      admitSb3(minimal, {
        limits: { maxEntries: Number.NaN },
      }),
    (error: unknown) =>
      error instanceof Sb3AdmissionError &&
      error.code === SB3_ADMISSION_CODES.limitsInvalid
  )

  const invalidEncoding = await zipOf({
    'project.json': Uint8Array.of(0xff),
  })
  await assert.rejects(
    () => admitSb3(invalidEncoding),
    (error: unknown) =>
      error instanceof Sb3AdmissionError &&
      error.code === SB3_ADMISSION_CODES.projectJsonEncodingInvalid
  )

  await assert.rejects(
    () => admitSb3(corruptFirstCentralCrc(minimal)),
    (error: unknown) =>
      error instanceof Sb3AdmissionError &&
      error.code === SB3_ADMISSION_CODES.entryCrcMismatch
  )

  const expanded = await deflatedZipOf({
    'project.json': `{"padding":"${'x'.repeat(1024 * 1024)}"}`,
  })
  await assert.rejects(
    () => admitSb3(forgeFirstUncompressedSize(expanded, 1)),
    (error: unknown) =>
      error instanceof Sb3AdmissionError &&
      error.code === SB3_ADMISSION_CODES.archiveInvalid
  )
})
