// tests/sb3/media/asset-pipeline.test.ts
// protect media pixels, pivot identity, canonical samples & bounded preparation

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PNG } from 'pngjs'

import {
  admitSb3ForEdit,
  AssetPipelineJobV2,
  estimateAudioNormalizationV1,
  normalizeAudioV1,
} from '@scratch-agent/sb3'
import { blankProject } from '@scratch-agent/ir'
import {
  applyCostumePivotEditV2,
  buildAnimationPreviewHtmlV2,
  costumePivotIdentityV2,
  resolveAnimationClipsV2,
} from '@scratch-agent/ir/authoring'

function digest(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function wavFixture(
  bits: 8 | 16 | 24 | 32,
  samples: readonly number[],
  channels: 1 | 2 = 1,
  rate = 8000
)
{
  const width = bits / 8
  const bytes = Buffer.alloc(44 + width * samples.length)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * channels * width, 28)
  bytes.writeUInt16LE(channels * width, 32)
  bytes.writeUInt16LE(bits, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples.length * width, 40)
  samples.forEach((sample, index) =>
  {
    const at = 44 + index * width
    if (bits === 8) bytes.writeUInt8(sample, at)
    else bytes.writeIntLE(sample, at, width)
  })
  return bytes
}

function pngFixture()
{
  const rgba = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 0, 64, 0, 255, 255,
    255, 255, 0, 255, 128, 255, 255, 255, 0, 0, 0, 0, 64,
  ])
  const image = new PNG({ width: 4, height: 2 })
  image.data = rgba
  return PNG.sync.write(image, {
    colorType: 6,
    bitDepth: 8,
    inputHasAlpha: true,
  })
}

test('PNG slicing and transforms preserve independently expected pixels, alpha and pivots', async () =>
{
  const bytes = pngFixture()
  const originalSha = digest(bytes)
  const job = new AssetPipelineJobV2()
  const frame = await job.preparePngFrame({
    bytes,
    pivot: { x: 1.25, y: 1.5 },
    transforms: [
      { kind: 'crop', x: 1, y: 0, width: 2, height: 2 },
      { kind: 'flip', horizontal: true, vertical: false },
      { kind: 'resizeNearest', width: 4, height: 2 },
      { kind: 'flip', horizontal: false, vertical: true },
      {
        kind: 'paletteMap',
        mappings: [
          { from: [0, 255, 0], to: [255, 0, 255] },
          { from: [255, 0, 255], to: [0, 255, 0] },
        ],
      },
    ],
  })
  const decoded = PNG.sync.read(Buffer.from(frame.bytes))
  assert.deepEqual(
    [...decoded.data],
    [
      255, 255, 255, 0, 255, 255, 255, 0, 0, 255, 0, 128, 0, 255, 0, 128, 0, 0,
      255, 0, 0, 0, 255, 0, 255, 0, 255, 128, 255, 0, 255, 128,
    ]
  )
  assert.deepEqual(frame.pivot, { x: 3.5, y: 0.5 })
  assert.equal(frame.bytes[24], 8)
  assert.equal(frame.bytes[25], 6)
  assert.equal(frame.sourceSha256, originalSha)
  assert.equal(frame.outputSha256, digest(frame.bytes))
  assert.equal(digest(bytes), originalSha)
  const repeated = await new AssetPipelineJobV2().preparePngFrame({
    bytes,
    pivot: { x: 1.25, y: 1.5 },
    transforms: [
      { kind: 'crop', x: 1, y: 0, width: 2, height: 2 },
      { kind: 'flip', horizontal: true, vertical: false },
      { kind: 'resizeNearest', width: 4, height: 2 },
      { kind: 'flip', horizontal: false, vertical: true },
      {
        kind: 'paletteMap',
        mappings: [
          { from: [0, 255, 0], to: [255, 0, 255] },
          { from: [255, 0, 255], to: [0, 255, 0] },
        ],
      },
    ],
  })
  assert.deepEqual(repeated.bytes, frame.bytes)
  const sheet = await job.preparePngSheet({
    bytes,
    slicing: { kind: 'grid', cellWidth: 2, cellHeight: 2, columns: 2, rows: 1 },
  })
  assert.equal(sheet.length, 2)
  assert.deepEqual(sheet[0]?.pivot, { x: 1, y: 1 })
  assert.deepEqual(sheet[1]?.pivot, { x: 1, y: 1 })
  assert.deepEqual(
    [...PNG.sync.read(Buffer.from(sheet[0]!.bytes)).data],
    [255, 0, 0, 255, 0, 255, 0, 128, 0, 255, 255, 255, 255, 0, 255, 128]
  )
  assert.deepEqual(
    [...PNG.sync.read(Buffer.from(sheet[1]!.bytes)).data],
    [0, 0, 255, 0, 255, 255, 0, 64, 255, 255, 255, 0, 0, 0, 0, 64]
  )
  const preview = await job.renderPngPreview({
    frames: sheet,
    mode: 'origins',
    columns: 2,
    gridSize: 1,
  })
  assert.ok(preview.bytes.byteLength > 0)
  await assert.rejects(
    job.preparePngFrame({
      bytes,
      transforms: Array.from({ length: 17 }, () => ({
        kind: 'flip' as const,
        horizontal: true,
        vertical: false,
      })),
    })
  )
  await assert.rejects(
    job.preparePngFrame({
      bytes,
      transforms: [
        { kind: 'resizeNearest', width: 1000000000, height: 1000000000 },
      ],
    })
  )
  const corrupted = Buffer.from(bytes)
  corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1
  await assert.rejects(job.preparePngFrame({ bytes: corrupted }))
  assert.equal(job.usage().decodedBytesInUse, 0)
  for (const limits of [{ maxPixelVisits: 1 }, { maxDecodedWorkingBytes: 1 }])
  {
    const bounded = new AssetPipelineJobV2(limits)
    await assert.rejects(bounded.preparePngFrame({ bytes }))
    assert.equal(bounded.usage().peakDecodedBytes, 0)
    assert.equal(bounded.usage().decodedBytesInUse, 0)
  }
})

test('native audio canonicalizes integer PCM without changing samples, rate or original bytes', async () =>
{
  const fixtures = [
    wavFixture(8, [0, 128, 255, 64]),
    wavFixture(16, [-32768, 0, 32512, -16384]),
    wavFixture(24, [-8388608, 0, 8323072, -4194304]),
    wavFixture(32, [-2147483648, 0, 2130706432, -1073741824]),
  ]
  let canonical: Uint8Array | undefined
  for (const original of fixtures)
  {
    const before = digest(original)
    const result = await normalizeAudioV1(original, { format: 'wav' })
    const output = Buffer.from(result.bytes)
    assert.equal(output.readUInt16LE(20), 1)
    assert.equal(output.readUInt16LE(22), 1)
    assert.equal(output.readUInt32LE(24), 8000)
    assert.equal(output.readUInt16LE(34), 16)
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => output.readInt16LE(44 + i * 2)),
      [-32768, 0, 32512, -16384]
    )
    if (canonical) assert.deepEqual(result.bytes, canonical)
    canonical = result.bytes
    assert.equal(result.sourceSha256, before)
    assert.equal(result.outputSha256, digest(result.bytes))
    assert.equal(digest(original), before)
    assert.equal(result.decoder.kind, 'native-pcm-v1')
  }
  const invalid = wavFixture(16, [0, 1])
  invalid.writeUInt32LE(0xffffffff, 40)
  await assert.rejects(normalizeAudioV1(invalid, { format: 'wav' }))
  const stereo = await normalizeAudioV1(
    wavFixture(16, [1, -1, 2, -2], 2, 44100),
    { format: 'wav' }
  )
  assert.equal(stereo.identity.channels, 2)
  assert.equal(stereo.identity.rate, 44100)
  assert.equal(stereo.identity.sampleCount, 2)
  await assert.rejects(
    normalizeAudioV1(fixtures[0]!, {
      format: 'wav',
      limits: { maxOutputBytes: 44 },
    })
  )

  const shortInput = fixtures[0]!
  const workingBytes = shortInput.byteLength + 8 + 52
  const tightOptions = {
    format: 'wav' as const,
    limits: { maxWorkingBytes: workingBytes, maxOutputBytes: 52 },
  }
  const estimate = estimateAudioNormalizationV1(shortInput, tightOptions)
  assert.equal(estimate.native, true)
  assert.equal(estimate.frameBound, 4)
  assert.equal(estimate.pcmByteBound, 8)
  assert.equal(estimate.outputByteBound, 52)
  assert.equal(estimate.workingByteBound, workingBytes)
  const tight = await normalizeAudioV1(shortInput, tightOptions)
  const ordinary = await normalizeAudioV1(shortInput, { format: 'wav' })
  assert.deepEqual(tight.bytes, ordinary.bytes)
  assert.equal(tight.transformationSha256, ordinary.transformationSha256)
  await assert.rejects(
    normalizeAudioV1(shortInput, {
      ...tightOptions,
      limits: { ...tightOptions.limits, maxWorkingBytes: workingBytes - 1 },
    }),
    { code: 'AUDIO_RESOURCE_LIMIT' }
  )
  assert.throws(
    () =>
      estimateAudioNormalizationV1(shortInput, {
        ...tightOptions,
        limits: { ...tightOptions.limits, maxOutputBytes: 51 },
      }),
    { code: 'AUDIO_RESOURCE_LIMIT' }
  )
  const resampled = estimateAudioNormalizationV1(shortInput, {
    format: 'wav',
    sampleRate: 16000,
  })
  assert.equal(resampled.native, false)
  assert.equal(resampled.frameBound, 72)
  assert.equal(resampled.workingByteBound, shortInput.byteLength + 288 + 44)
})

test('configured compressed audio yields canonical WAV and missing decoder refuses', async (t) =>
{
  const executablePath = process.env.SCRATCH_AGENT_TEST_FFMPEG
  const source = wavFixture(
    16,
    Array.from({ length: 800 }, (_, i) => (i % 8) * 1024)
  )
  if (!executablePath)
  {
    t.skip(
      'set SCRATCH_AGENT_TEST_FFMPEG to an operator-selected absolute executable'
    )
    return
  }
  for (const format of ['mp3', 'wav'] as const)
  {
    const directory = mkdtempSync(join(tmpdir(), 'scratch-audio-test-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const outputPath = join(directory, `fixture.${format}`)
    const encoded: SpawnSyncReturns<Buffer> = spawnSync(
      executablePath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'pipe,file',
        '-f',
        'wav',
        '-i',
        'pipe:0',
        '-map',
        '0:a:0',
        '-threads',
        '1',
        '-acodec',
        format === 'mp3' ? 'libmp3lame' : 'adpcm_ima_wav',
        '-f',
        format,
        '-n',
        outputPath,
      ],
      { input: source, maxBuffer: 1024 * 1024, timeout: 10000 }
    )
    assert.equal(encoded.status, 0, encoded.stderr.toString())
    const compressed = readFileSync(outputPath)
    const estimate = estimateAudioNormalizationV1(compressed, { format })
    assert.equal(estimate.native, false)
    assert.equal(
      estimate.sourceFormat,
      format === 'mp3' ? 'mp3' : 'ima-adpcm-wav'
    )
    assert.equal(
      estimate.workingByteBound,
      compressed.byteLength + 2 * estimate.pcmByteBound + 44
    )
    await assert.rejects(normalizeAudioV1(compressed, { format }))
    const result = await normalizeAudioV1(compressed, {
      format,
      ffmpeg: { executablePath },
    })
    const output = Buffer.from(result.bytes)
    assert.equal(output.readUInt16LE(20), 1)
    assert.equal(output.readUInt16LE(22), 1)
    assert.equal(output.readUInt32LE(24), 8000)
    assert.equal(output.readUInt16LE(34), 16)
    assert.equal(output.readUInt32LE(4), output.length - 8)
    assert.equal(result.decoder.kind, 'configured-ffmpeg-v1')
    assert.match(result.decoder.identitySha256, /^[0-9a-f]{64}$/u)
    assert.equal(result.outputSha256, digest(result.bytes))
    assert.ok(result.bytes.byteLength <= estimate.outputByteBound)
    const repeated = await normalizeAudioV1(compressed, {
      format,
      ffmpeg: { executablePath },
    })
    assert.deepEqual(repeated.bytes, result.bytes)
  }
})

test('clip tables follow exact frame order and pivot edits preserve every asset byte', async () =>
{
  const project = blankProject()
  const actor = project.addSprite('Actor')
  const job = new AssetPipelineJobV2()
  const frames = await job.preparePngSheet({
    bytes: pngFixture(),
    slicing: { kind: 'grid', cellWidth: 2, cellHeight: 2, rows: 1, columns: 2 },
  })
  frames.push(await job.preparePngFrame({ bytes: pngFixture() }))
  const names = ['one', 'two', 'three']
  for (const [index, name] of names.entries())
  {
    const frame = frames[index]!
    actor.addCostume(
      {
        name,
        assetId: frame.md5ext.slice(0, 32),
        md5ext: frame.md5ext,
        dataFormat: 'png',
        bitmapResolution: 1,
        rotationCenterX: frame.pivot.x,
        rotationCenterY: frame.pivot.y,
      },
      frame.bytes
    )
  }
  const otherActor = project.addSprite('Other actor')
  for (const [index, frame] of [...frames.entries()].reverse())
    otherActor.addCostume({ ...actor.raw.costumes[index]! }, frame.bytes)
  const audio = await normalizeAudioV1(wavFixture(8, [0, 128, 255, 64]), {
    format: 'wav',
  })
  actor.addSound(
    {
      name: 'beep',
      assetId: audio.identity.md5,
      md5ext: audio.identity.md5ext,
      dataFormat: 'wav',
      format: '',
      rate: audio.identity.rate,
      sampleCount: audio.identity.sampleCount,
    },
    audio.bytes
  )
  const beforeAssetHashes = project.assets.map((asset) => digest(asset.bytes))
  const identity = costumePivotIdentityV2(project, 1, 2)
  applyCostumePivotEditV2(project, {
    kind: 'costume.setPivot',
    targetIndex: 1,
    costumeIndexOneBased: 2,
    expectedIdentitySha256: identity,
    rotationCenterX: 0.25,
    rotationCenterY: 1.5,
  })
  assert.deepEqual(
    project.assets.map((asset) => digest(asset.bytes)),
    beforeAssetHashes
  )
  assert.equal(actor.raw.costumes[1]?.rotationCenterX, 0.25)
  assert.equal(actor.raw.costumes[1]?.rotationCenterY, 1.5)
  assert.throws(() =>
    applyCostumePivotEditV2(project, {
      kind: 'costume.setPivot',
      targetIndex: 1,
      costumeIndexOneBased: 2,
      expectedIdentitySha256: identity,
      rotationCenterX: 99,
      rotationCenterY: 99,
    })
  )
  const clips = [
    {
      id: 'run',
      name: 'Run <fast>',
      loop: true,
      frames: [
        { logicalAssetId: 'three', durationMs: 75 },
        { logicalAssetId: 'one', durationMs: 125 },
        { logicalAssetId: 'two', durationMs: 90 },
      ],
    },
  ]
  const resolved = resolveAnimationClipsV2(
    clips,
    project,
    1,
    names.map((name, index) => ({
      logicalAssetId: name,
      costumeName: name,
      outputSha256: frames[index]!.outputSha256,
    }))
  )
  assert.deepEqual(resolved[0]?.tables.costumeIndexesOneBased, [3, 1, 2])
  assert.deepEqual(resolved[0]?.tables.durationsMs, [75, 125, 90])
  assert.equal(resolved[0]?.frames[2]?.rotationCenterX, 0.25)
  const otherResolved = resolveAnimationClipsV2(
    clips,
    project,
    2,
    names.map((name, index) => ({
      logicalAssetId: name,
      costumeName: name,
      outputSha256: frames[index]!.outputSha256,
    }))
  )
  assert.deepEqual(otherResolved[0]?.tables.costumeIndexesOneBased, [1, 3, 2])
  assert.deepEqual(otherResolved[0]?.tables.durationsMs, [75, 125, 90])
  assert.equal(otherResolved[0]?.frames[2]?.rotationCenterX, frames[1]!.pivot.x)
  const previewClips = [...resolved, ...otherResolved]
  const previewAssets = names.map((logicalAssetId, index) => ({
    logicalAssetId,
    outputSha256: frames[index]!.outputSha256,
    pngBytes: frames[index]!.bytes,
    width: frames[index]!.width,
    height: frames[index]!.height,
  }))
  const html = buildAnimationPreviewHtmlV2({
    clips: previewClips,
    assets: previewAssets,
    title: '</script><img src=x onerror=alert(1)>',
  })
  assert.match(html, /data:image\/png;base64/u)
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  const embedded = html.match(
    /<script id="animation-data" type="application\/json">(.*?)<\/script>/su
  )
  assert.ok(embedded)
  assert.deepEqual(JSON.parse(embedded[1]!).clips, previewClips)
  assert.throws(
    () =>
      buildAnimationPreviewHtmlV2({
        clips: [...previewClips, resolved[0]!],
        assets: previewAssets,
      }),
    { code: 'authoring.invalid_animation' }
  )
  const reopened = await project.toSb3()
  assert.ok(reopened.byteLength > 0)
  const admitted = await admitSb3ForEdit(reopened)
  assert.equal(admitted.project.targets[1]?.costumes.length, 3)
  assert.equal(admitted.project.targets[1]?.costumes[1]?.rotationCenterX, 0.25)
  assert.equal(admitted.project.targets[1]?.sounds[0]?.rate, 8000)
})
