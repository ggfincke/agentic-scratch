// packages/sb3/src/media/audio-pipeline.ts
// normalize bounded integer WAV & configured compressed audio to canonical PCM16

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, open, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { DEFAULT_SB3_LIMITS } from '../admission/limits.js'
import { DEFAULT_EDIT_ADMISSION_LIMITS } from '../edit-admission/edit-admission-limits.js'
import {
  deriveAuthoringMediaIdentity,
  type DerivedSoundAssetIdentity,
} from './media.js'

export interface AudioPipelineLimitsV1
{
  maxInputBytes: number
  maxOutputBytes: number
  maxDurationMs: number
  maxChunkCount: number
  maxDecoderWallTimeMs: number
  maxDecoderStderrBytes: number
  maxDecoderExecutableBytes: number
  maxWorkingBytes: number
}

export const AUDIO_PIPELINE_DEFAULT_LIMITS_V1: Readonly<AudioPipelineLimitsV1> =
  Object.freeze({
    maxInputBytes: DEFAULT_SB3_LIMITS.maxAssetBytes,
    maxOutputBytes: DEFAULT_SB3_LIMITS.maxAssetBytes,
    maxDurationMs: 300_000,
    maxChunkCount: 4_096,
    maxDecoderWallTimeMs: 30_000,
    maxDecoderStderrBytes: 64 * 1024,
    maxDecoderExecutableBytes: 128 * 1024 * 1024,
    maxWorkingBytes: 128 * 1024 * 1024,
  })

export interface ConfiguredAudioDecoderV1
{
  executablePath: string
  expectedExecutableSha256?: string
}

export interface AudioNormalizationOptionsV1
{
  format: 'wav' | 'mp3'
  sampleRate?: number
  channels?: 1 | 2
  ffmpeg?: ConfiguredAudioDecoderV1
  limits?: Partial<AudioPipelineLimitsV1>
}

export interface AudioDecoderIdentityV1
{
  kind: 'native-pcm-v1' | 'configured-ffmpeg-v1'
  identitySha256: string
  executablePath?: string
  executableSha256?: string
  version?: string
  versionSha256?: string
  arguments?: readonly string[]
}

export interface AudioNormalizationSettingsV1
{
  sourceFormat: 'pcm-wav' | 'ima-adpcm-wav' | 'mp3'
  sourceRate: number
  sourceChannels: 1 | 2
  sourceBitsPerSample?: number
  sampleRate: number
  channels: 1 | 2
  bitsPerSample: 16
  sampleCount: number
  durationMs: number
}

export interface NormalizedAudioV1
{
  bytes: Uint8Array
  identity: DerivedSoundAssetIdentity
  sourceSha256: string
  transformationSha256: string
  outputSha256: string
  decoder: AudioDecoderIdentityV1
  settings: AudioNormalizationSettingsV1
}

export interface AudioNormalizationEstimateV1
{
  readonly sourceFormat: AudioNormalizationSettingsV1['sourceFormat']
  readonly native: boolean
  readonly inputBytes: number
  readonly sourceSampleRate: number
  readonly sourceChannels: 1 | 2
  readonly sampleRate: number
  readonly channels: 1 | 2
  readonly frameBound: number
  readonly pcmByteBound: number
  readonly outputByteBound: number
  readonly workingByteBound: number
}

export type AudioPipelineErrorCodeV1 =
  | 'AUDIO_INPUT_MALFORMED'
  | 'AUDIO_FORMAT_UNSUPPORTED'
  | 'AUDIO_RESOURCE_LIMIT'
  | 'AUDIO_DECODER_REQUIRED'
  | 'AUDIO_DECODER_UNAVAILABLE'
  | 'AUDIO_DECODER_IDENTITY_MISMATCH'
  | 'AUDIO_DECODER_FAILED'
  | 'AUDIO_DECODER_TIMEOUT'
  | 'AUDIO_REQUEST_CANCELLED'

export class AudioPipelineErrorV1 extends Error
{
  readonly code: AudioPipelineErrorCodeV1

  constructor(code: AudioPipelineErrorCodeV1, message: string)
  {
    super(message)
    this.name = 'AudioPipelineErrorV1'
    this.code = code
  }
}

interface ParsedAudioV1
{
  kind: AudioNormalizationSettingsV1['sourceFormat']
  sampleRate: number
  channels: 1 | 2
  bitsPerSample?: number
  frameBound: number
  dataOffset?: number
  dataBytes?: number
}

const AUDIO_POLICY_V1 = Object.freeze({
  schemaVersion: 1,
  output: 'riff-wave-fmt16-data-pcm16-le',
  nativeInput: 'pcm-integer-8-16-24-32',
  nativeQuantization: 'signed-high-16-bits',
  defaultRateAndChannels: 'preserve',
  compressedInput: ['ima-adpcm-wav', 'mpeg-layer-iii'],
  decoderTransport: 'pipe-only-raw-pcm16',
  missingDecoder: 'refuse-without-installation',
})

function fail(code: AudioPipelineErrorCodeV1, message: string): never
{
  throw new AudioPipelineErrorV1(code, message)
}

function assertAudioActive(signal?: AbortSignal): void
{
  if (signal?.aborted)
    fail('AUDIO_REQUEST_CANCELLED', 'audio preparation was cancelled')
}

function sha256(bytes: Uint8Array | string): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function hashRecord(value: unknown): string
{
  return sha256(JSON.stringify(value))
}

function resolveLimits(
  options: Partial<AudioPipelineLimitsV1> = {}
): AudioPipelineLimitsV1
{
  const limits = { ...AUDIO_PIPELINE_DEFAULT_LIMITS_V1, ...options }
  for (const key of Object.keys(limits) as (keyof AudioPipelineLimitsV1)[])
  {
    if (
      !Object.hasOwn(AUDIO_PIPELINE_DEFAULT_LIMITS_V1, key) ||
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > AUDIO_PIPELINE_DEFAULT_LIMITS_V1[key]
    )
    {
      fail(
        'AUDIO_RESOURCE_LIMIT',
        `${key} must be a positive safe integer no greater than ${AUDIO_PIPELINE_DEFAULT_LIMITS_V1[key]}`
      )
    }
  }
  return limits
}

function ascii(bytes: Uint8Array, offset: number, length: number): string
{
  return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString(
    'ascii'
  )
}

function validateRateAndChannels(rate: number, channels: number): void
{
  if (
    !Number.isSafeInteger(rate) ||
    rate < 8_000 ||
    rate > 96_000 ||
    (channels !== 1 && channels !== 2)
  )
  {
    fail(
      'AUDIO_FORMAT_UNSUPPORTED',
      'audio requires an integer sample rate from 8000 to 96000 Hz and one or two channels'
    )
  }
}

function validateFrameBound(
  frameBound: number,
  sampleRate: number,
  limits: AudioPipelineLimitsV1
): void
{
  if (!Number.isSafeInteger(frameBound) || frameBound < 1)
  {
    fail(
      'AUDIO_INPUT_MALFORMED',
      'audio must contain complete nonempty samples'
    )
  }
  if ((frameBound * 1_000) / sampleRate > limits.maxDurationMs)
  {
    fail(
      'AUDIO_RESOURCE_LIMIT',
      `audio duration exceeds ${limits.maxDurationMs} milliseconds`
    )
  }
}

function parseWav(
  bytes: Uint8Array,
  limits: AudioPipelineLimitsV1
): ParsedAudioV1
{
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WAVE'
  )
  {
    fail('AUDIO_INPUT_MALFORMED', 'WAV input requires a RIFF/WAVE header')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) !== bytes.byteLength - 8)
  {
    fail(
      'AUDIO_INPUT_MALFORMED',
      'RIFF size must exactly match the input bytes'
    )
  }
  let format: { offset: number; length: number } | undefined
  let data: { offset: number; length: number } | undefined
  let fact: number | undefined
  let offset = 12
  let chunkCount = 0
  while (offset < bytes.byteLength)
  {
    if (++chunkCount > limits.maxChunkCount)
    {
      fail('AUDIO_RESOURCE_LIMIT', 'WAV chunk count exceeds the audio limit')
    }
    if (offset + 8 > bytes.byteLength)
    {
      fail('AUDIO_INPUT_MALFORMED', 'WAV chunk header is truncated')
    }
    const id = ascii(bytes, offset, 4)
    const length = view.getUint32(offset + 4, true)
    const payload = offset + 8
    const end = payload + length + (length & 1)
    if (end > bytes.byteLength)
    {
      fail('AUDIO_INPUT_MALFORMED', 'WAV chunk payload or padding is truncated')
    }
    if (id === 'fmt ')
    {
      if (format || length < 16)
      {
        fail('AUDIO_INPUT_MALFORMED', 'WAV requires one complete format chunk')
      }
      format = { offset: payload, length }
    }
    else if (id === 'data')
    {
      if (data || length === 0)
      {
        fail('AUDIO_INPUT_MALFORMED', 'WAV requires one nonempty data chunk')
      }
      data = { offset: payload, length }
    }
    else if (id === 'fact')
    {
      if (fact !== undefined || length < 4)
      {
        fail(
          'AUDIO_INPUT_MALFORMED',
          'WAV fact chunk is duplicated or truncated'
        )
      }
      fact = view.getUint32(payload, true)
    }
    offset = end
  }
  if (!format || !data)
  {
    fail('AUDIO_INPUT_MALFORMED', 'WAV requires format and data chunks')
  }
  const at = format.offset
  let tag = view.getUint16(at, true)
  const channels = view.getUint16(at + 2, true)
  const sampleRate = view.getUint32(at + 4, true)
  const byteRate = view.getUint32(at + 8, true)
  const blockAlign = view.getUint16(at + 12, true)
  const bits = view.getUint16(at + 14, true)
  validateRateAndChannels(sampleRate, channels)
  if (format.length !== 16)
  {
    if (
      format.length < 18 ||
      view.getUint16(at + 16, true) !== format.length - 18
    )
    {
      fail('AUDIO_INPUT_MALFORMED', 'WAV format extension size is inconsistent')
    }
  }
  if (tag === 65_534)
  {
    if (
      format.length !== 40 ||
      view.getUint16(at + 18, true) !== bits ||
      Buffer.from(bytes.subarray(at + 24, at + 40)).toString('hex') !==
        '0100000000001000800000aa00389b71'
    )
    {
      fail(
        'AUDIO_FORMAT_UNSUPPORTED',
        'extensible WAV requires integer PCM with matching valid and container bits'
      )
    }
    const channelMask = view.getUint32(at + 20, true)
    if (channelMask !== 0 && channelMask !== (channels === 1 ? 4 : 3))
    {
      fail(
        'AUDIO_FORMAT_UNSUPPORTED',
        'extensible WAV requires a mono or stereo speaker layout'
      )
    }
    tag = 1
  }
  let frameBound: number
  let kind: ParsedAudioV1['kind']
  if (tag === 1)
  {
    if (
      ![8, 16, 24, 32].includes(bits) ||
      blockAlign !== channels * (bits / 8) ||
      byteRate !== sampleRate * blockAlign ||
      data.length % blockAlign !== 0
    )
    {
      fail(
        'AUDIO_INPUT_MALFORMED',
        'integer PCM metadata or sample alignment is invalid'
      )
    }
    kind = 'pcm-wav'
    frameBound = data.length / blockAlign
  }
  else if (tag === 17)
  {
    if (
      format.length < 20 ||
      bits !== 4 ||
      blockAlign < 4 * channels ||
      (blockAlign - 4 * channels) % (4 * channels) !== 0 ||
      data.length % blockAlign !== 0
    )
    {
      fail(
        'AUDIO_INPUT_MALFORMED',
        'IMA-ADPCM block format or sample alignment is invalid'
      )
    }
    const samplesPerBlock = view.getUint16(at + 18, true)
    const expectedSamples = ((blockAlign - 4 * channels) * 2) / channels + 1
    if (
      samplesPerBlock !== expectedSamples ||
      byteRate < 1 ||
      byteRate > sampleRate * blockAlign
    )
    {
      fail(
        'AUDIO_INPUT_MALFORMED',
        'IMA-ADPCM samples per block are inconsistent'
      )
    }
    frameBound = (data.length / blockAlign) * samplesPerBlock
    if (fact !== undefined && (fact < 1 || fact > frameBound))
    {
      fail(
        'AUDIO_INPUT_MALFORMED',
        'IMA-ADPCM fact count exceeds its encoded blocks'
      )
    }
    kind = 'ima-adpcm-wav'
  }
  else
  {
    fail(
      'AUDIO_FORMAT_UNSUPPORTED',
      'WAV supports integer PCM or IMA-ADPCM format tag 17'
    )
  }
  validateFrameBound(frameBound, sampleRate, limits)
  return {
    kind,
    sampleRate,
    channels: channels as 1 | 2,
    bitsPerSample: bits,
    frameBound,
    dataOffset: data.offset,
    dataBytes: data.length,
  }
}

function parseMp3(
  bytes: Uint8Array,
  limits: AudioPipelineLimitsV1
): ParsedAudioV1
{
  let offset = 0
  let end = bytes.byteLength
  if (end >= 10 && ascii(bytes, 0, 3) === 'ID3')
  {
    const version = bytes[3]!
    const flags = bytes[5]!
    const sizeBytes = [bytes[6]!, bytes[7]!, bytes[8]!, bytes[9]!]
    if (
      ![2, 3, 4].includes(version) ||
      bytes[4] === 255 ||
      sizeBytes.some((value) => value > 127) ||
      (flags & (version === 2 ? 0x3f : version === 3 ? 0x1f : 0x0f)) !== 0
    )
    {
      fail('AUDIO_INPUT_MALFORMED', 'MP3 ID3 header is invalid')
    }
    const tagBytes = sizeBytes.reduce((sum, value) => sum * 128 + value, 0)
    offset = 10 + tagBytes + (version === 4 && (flags & 0x10) !== 0 ? 10 : 0)
    if (offset > end)
    {
      fail('AUDIO_INPUT_MALFORMED', 'MP3 ID3 tag exceeds the input bytes')
    }
  }
  if (end - offset >= 128 && ascii(bytes, end - 128, 3) === 'TAG') end -= 128
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sampleRate: number | undefined
  let channels: 1 | 2 | undefined
  let frameBound = 0
  const mpeg1Rates = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
  ]
  const otherRates = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
  ]
  while (offset < end)
  {
    if (offset + 4 > end)
    {
      fail('AUDIO_INPUT_MALFORMED', 'MP3 frame header is truncated')
    }
    const header = view.getUint32(offset, false)
    const version = (header >>> 19) & 3
    const layer = (header >>> 17) & 3
    const rateIndex = (header >>> 10) & 3
    const bitRateIndex = (header >>> 12) & 15
    if (
      header >>> 21 !== 0x7ff ||
      version === 1 ||
      layer !== 1 ||
      rateIndex === 3 ||
      bitRateIndex === 0 ||
      bitRateIndex === 15
    )
    {
      fail(
        'AUDIO_INPUT_MALFORMED',
        'MP3 requires complete MPEG Layer III frames'
      )
    }
    const rate =
      [44_100, 48_000, 32_000][rateIndex]! /
      (version === 3 ? 1 : version === 2 ? 2 : 4)
    const frameChannels = ((header >>> 6) & 3) === 3 ? 1 : 2
    const bitRate = (version === 3 ? mpeg1Rates : otherRates)[bitRateIndex]!
    const frameBytes =
      Math.floor(((version === 3 ? 144 : 72) * bitRate * 1_000) / rate) +
      ((header >>> 9) & 1)
    if (offset + frameBytes > end)
    {
      fail('AUDIO_INPUT_MALFORMED', 'MP3 frame payload is truncated')
    }
    if (
      sampleRate !== undefined &&
      (sampleRate !== rate || channels !== frameChannels)
    )
    {
      fail(
        'AUDIO_FORMAT_UNSUPPORTED',
        'MP3 rate and channel layout must remain constant'
      )
    }
    sampleRate = rate
    channels = frameChannels
    frameBound += version === 3 ? 1_152 : 576
    validateFrameBound(frameBound, rate, limits)
    offset += frameBytes
  }
  if (sampleRate === undefined || channels === undefined)
  {
    fail('AUDIO_INPUT_MALFORMED', 'MP3 contains no complete audio frames')
  }
  validateRateAndChannels(sampleRate, channels)
  return { kind: 'mp3', sampleRate, channels, frameBound }
}

function canonicalWav(
  pcm: Uint8Array,
  sampleRate: number,
  channels: 1 | 2
): Uint8Array
{
  const bytes = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(bytes.buffer)
  bytes.set(Buffer.from('RIFF'), 0)
  view.setUint32(4, bytes.byteLength - 8, true)
  bytes.set(Buffer.from('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  bytes.set(Buffer.from('data'), 36)
  view.setUint32(40, pcm.byteLength, true)
  bytes.set(pcm, 44)
  return bytes
}

function convertNativePcm(
  bytes: Uint8Array,
  metadata: ParsedAudioV1
): Uint8Array
{
  const bits = metadata.bitsPerSample!
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values = metadata.frameBound * metadata.channels
  const pcm = new Uint8Array(values * 2)
  const output = new DataView(pcm.buffer)
  let offset = metadata.dataOffset!
  for (let index = 0; index < values; index++, offset += bits / 8)
  {
    let value: number
    if (bits === 8) value = (input.getUint8(offset) - 128) << 8
    else if (bits === 16) value = input.getInt16(offset, true)
    else if (bits === 24)
    {
      const sample =
        input.getUint8(offset) |
        (input.getUint8(offset + 1) << 8) |
        (input.getInt8(offset + 2) << 16)
      value = sample >> 8
    }
    else value = input.getInt32(offset, true) >> 16
    output.setInt16(index * 2, value, true)
  }
  return pcm
}

async function decoderExecutableIdentity(
  config: ConfiguredAudioDecoderV1,
  limits: AudioPipelineLimitsV1,
  signal?: AbortSignal
): Promise<{ path: string; sha256: string }>
{
  assertAudioActive(signal)
  if (
    typeof config.executablePath !== 'string' ||
    !isAbsolute(config.executablePath)
  )
  {
    fail(
      'AUDIO_DECODER_UNAVAILABLE',
      'configure FFmpeg with an absolute executable path'
    )
  }
  if (
    config.expectedExecutableSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(config.expectedExecutableSha256)
  )
  {
    fail(
      'AUDIO_DECODER_IDENTITY_MISMATCH',
      'expected FFmpeg SHA-256 must be 64 lowercase hexadecimal characters'
    )
  }
  try
  {
    const path = await realpath(config.executablePath)
    await access(path, constants.X_OK)
    const file = await open(path, 'r')
    try
    {
      const stat = await file.stat()
      if (
        !stat.isFile() ||
        stat.size < 1 ||
        stat.size > limits.maxDecoderExecutableBytes
      )
      {
        fail(
          'AUDIO_RESOURCE_LIMIT',
          'configured FFmpeg executable size is outside the decoder limit'
        )
      }
      const hash = createHash('sha256')
      let total = 0
      for await (const chunk of file.createReadStream({ autoClose: false }))
      {
        assertAudioActive(signal)
        total += chunk.byteLength
        if (total > limits.maxDecoderExecutableBytes)
        {
          fail(
            'AUDIO_RESOURCE_LIMIT',
            'configured FFmpeg executable changed beyond its size limit'
          )
        }
        hash.update(chunk)
      }
      const executableSha256 = hash.digest('hex')
      assertAudioActive(signal)
      if (
        config.expectedExecutableSha256 !== undefined &&
        executableSha256 !== config.expectedExecutableSha256
      )
      {
        fail(
          'AUDIO_DECODER_IDENTITY_MISMATCH',
          'configured FFmpeg executable does not match its expected SHA-256'
        )
      }
      return { path, sha256: executableSha256 }
    }
    finally
    {
      await file.close()
    }
  }
  catch (error)
  {
    if (error instanceof AudioPipelineErrorV1) throw error
    fail(
      'AUDIO_DECODER_UNAVAILABLE',
      'configured FFmpeg is unavailable; select an existing executable path without installing a decoder'
    )
  }
}

function runDecoder(
  executablePath: string,
  args: readonly string[],
  input: Uint8Array | undefined,
  outputLimit: number,
  limits: AudioPipelineLimitsV1,
  versionProbe = false,
  signal?: AbortSignal
): Promise<Uint8Array>
{
  return new Promise((resolve, reject) =>
  {
    assertAudioActive(signal)
    const output = new Uint8Array(outputLimit)
    const child = spawn(executablePath, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let outputBytes = 0
    let stderrBytes = 0
    const errors: Buffer[] = []
    let failure: AudioPipelineErrorV1 | undefined
    const stop = (error: AudioPipelineErrorV1): void =>
    {
      if (failure) return
      failure = error
      clearTimeout(timer)
      child.kill('SIGKILL')
      child.stdin.destroy()
    }
    const timer = setTimeout(
      () =>
        stop(
          new AudioPipelineErrorV1(
            'AUDIO_DECODER_TIMEOUT',
            'configured FFmpeg exceeded its bounded wall time'
          )
        ),
      versionProbe
        ? Math.min(5_000, limits.maxDecoderWallTimeMs)
        : limits.maxDecoderWallTimeMs
    )
    child.on('error', () =>
      stop(
        new AudioPipelineErrorV1(
          'AUDIO_DECODER_UNAVAILABLE',
          'configured FFmpeg could not be started; select an existing executable'
        )
      )
    )
    child.stdout.on('data', (chunk: Buffer) =>
    {
      if (failure) return
      if (outputBytes + chunk.byteLength > outputLimit)
      {
        stop(
          new AudioPipelineErrorV1(
            'AUDIO_RESOURCE_LIMIT',
            'configured FFmpeg output exceeded its preflight byte bound'
          )
        )
        return
      }
      output.set(chunk, outputBytes)
      outputBytes += chunk.byteLength
    })
    child.stderr.on('data', (chunk: Buffer) =>
    {
      if (failure) return
      stderrBytes += chunk.byteLength
      if (stderrBytes > limits.maxDecoderStderrBytes)
      {
        stop(
          new AudioPipelineErrorV1(
            'AUDIO_RESOURCE_LIMIT',
            'configured FFmpeg stderr exceeded its byte limit'
          )
        )
        return
      }
      errors.push(Buffer.from(chunk))
    })
    child.stdin.on('error', () =>
    {})
    child.stdout.on('error', () =>
      stop(
        new AudioPipelineErrorV1(
          'AUDIO_DECODER_FAILED',
          'configured FFmpeg output pipe failed'
        )
      )
    )
    child.stderr.on('error', () =>
      stop(
        new AudioPipelineErrorV1(
          'AUDIO_DECODER_FAILED',
          'configured FFmpeg error pipe failed'
        )
      )
    )
    // retain process ownership until exit and pipe closure confirm disposal
    child.on('close', (code) =>
    {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (failure) reject(failure)
      else if (code !== 0)
      {
        const detail = Buffer.concat(errors)
          .toString('utf8')
          .trim()
          .slice(0, 2_000)
        reject(
          new AudioPipelineErrorV1(
            'AUDIO_DECODER_FAILED',
            `configured FFmpeg refused the audio input${detail ? `: ${detail}` : ''}`
          )
        )
      }
      else resolve(output.subarray(0, outputBytes))
    })
    const cancel = () =>
      stop(
        new AudioPipelineErrorV1(
          'AUDIO_REQUEST_CANCELLED',
          'audio preparation was cancelled'
        )
      )
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    else child.stdin.end(input)
  })
}

function prepareAudioNormalizationV1(
  bytes: Uint8Array,
  options: AudioNormalizationOptionsV1
): {
  limits: AudioPipelineLimitsV1
  metadata: ParsedAudioV1
  estimate: Readonly<AudioNormalizationEstimateV1>
}
{
  if (!options || typeof options !== 'object')
  {
    fail(
      'AUDIO_FORMAT_UNSUPPORTED',
      'audio normalization requires source format options'
    )
  }
  const limits = resolveLimits(options.limits)
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > limits.maxInputBytes
  )
  {
    fail(
      'AUDIO_RESOURCE_LIMIT',
      `audio input must contain at most ${limits.maxInputBytes} bytes`
    )
  }
  if (options.format !== 'wav' && options.format !== 'mp3')
  {
    fail('AUDIO_FORMAT_UNSUPPORTED', 'audio source format must be wav or mp3')
  }
  if (bytes.byteLength > limits.maxWorkingBytes)
  {
    fail(
      'AUDIO_RESOURCE_LIMIT',
      'audio input snapshot exceeds the live buffer limit'
    )
  }
  const metadata =
    options.format === 'wav' ? parseWav(bytes, limits) : parseMp3(bytes, limits)
  const sampleRate = options.sampleRate ?? metadata.sampleRate
  const channels = options.channels ?? metadata.channels
  validateRateAndChannels(sampleRate, channels)
  const native =
    metadata.kind === 'pcm-wav' &&
    sampleRate === metadata.sampleRate &&
    channels === metadata.channels
  const frameBound =
    Math.ceil((metadata.frameBound * sampleRate) / metadata.sampleRate) +
    (sampleRate !== metadata.sampleRate ? 64 : 0)
  const pcmByteBound = frameBound * channels * 2
  const outputByteBound = pcmByteBound + 44
  const workingByteBound = bytes.byteLength + pcmByteBound * 2 + 44
  if (
    !Number.isSafeInteger(outputByteBound) ||
    !Number.isSafeInteger(workingByteBound) ||
    outputByteBound > limits.maxOutputBytes ||
    workingByteBound > limits.maxWorkingBytes
  )
  {
    fail(
      'AUDIO_RESOURCE_LIMIT',
      'canonical audio exceeds its preflight output or live buffer limit'
    )
  }
  return {
    limits,
    metadata,
    estimate: Object.freeze({
      sourceFormat: metadata.kind,
      native,
      inputBytes: bytes.byteLength,
      sourceSampleRate: metadata.sampleRate,
      sourceChannels: metadata.channels,
      sampleRate,
      channels,
      frameBound,
      pcmByteBound,
      outputByteBound,
      workingByteBound,
    }),
  }
}

export function estimateAudioNormalizationV1(
  bytes: Uint8Array,
  options: AudioNormalizationOptionsV1
): Readonly<AudioNormalizationEstimateV1>
{
  return prepareAudioNormalizationV1(bytes, options).estimate
}

export async function normalizeAudioV1(
  bytes: Uint8Array,
  options: AudioNormalizationOptionsV1,
  execution?: { readonly signal?: AbortSignal }
): Promise<NormalizedAudioV1>
{
  const signal = execution?.signal
  assertAudioActive(signal)
  const { limits, metadata, estimate } = prepareAudioNormalizationV1(
    bytes,
    options
  )
  const { sampleRate, channels, native, pcmByteBound } = estimate
  const source = new Uint8Array(bytes)
  const sourceSha256 = sha256(source)
  let pcm: Uint8Array
  let decoder: AudioDecoderIdentityV1
  if (native)
  {
    pcm = convertNativePcm(source, metadata)
    decoder = {
      kind: 'native-pcm-v1',
      identitySha256: hashRecord({
        kind: 'native-pcm-v1',
        policy: AUDIO_POLICY_V1,
      }),
    }
  }
  else
  {
    if (!options.ffmpeg)
    {
      fail(
        'AUDIO_DECODER_REQUIRED',
        'IMA-ADPCM, MP3, or sample-rate/channel conversion requires an operator-configured existing FFmpeg executable; provide ffmpeg.executablePath'
      )
    }
    const executable = await decoderExecutableIdentity(
      options.ffmpeg,
      limits,
      signal
    )
    const versionBytes = await runDecoder(
      executable.path,
      ['-version'],
      undefined,
      64 * 1024,
      limits,
      true,
      signal
    )
    const versionText = Buffer.from(versionBytes).toString('utf8').trim()
    const version = versionText.split('\n')[0] ?? ''
    if (!/^ffmpeg version /u.test(version))
    {
      fail(
        'AUDIO_DECODER_UNAVAILABLE',
        'configured executable does not identify itself as FFmpeg'
      )
    }
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-protocol_whitelist',
      'pipe',
      '-threads',
      '1',
      '-f',
      options.format,
      '-i',
      'pipe:0',
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-threads',
      '1',
      '-ac',
      String(channels),
      '-ar',
      String(sampleRate),
      '-acodec',
      'pcm_s16le',
      '-f',
      's16le',
      'pipe:1',
    ]
    const identityContent = {
      kind: 'configured-ffmpeg-v1' as const,
      executablePath: executable.path,
      executableSha256: executable.sha256,
      version,
      versionSha256: sha256(versionBytes),
      arguments: Object.freeze(args),
    }
    decoder = {
      ...identityContent,
      identitySha256: hashRecord({
        ...identityContent,
        policy: AUDIO_POLICY_V1,
      }),
    }
    pcm = await runDecoder(
      executable.path,
      args,
      source,
      pcmByteBound,
      limits,
      false,
      signal
    )
    const after = await decoderExecutableIdentity(
      options.ffmpeg,
      limits,
      signal
    )
    if (after.path !== executable.path || after.sha256 !== executable.sha256)
    {
      fail(
        'AUDIO_DECODER_IDENTITY_MISMATCH',
        'configured FFmpeg executable changed during audio preparation'
      )
    }
  }
  assertAudioActive(signal)
  if (pcm.byteLength === 0 || pcm.byteLength % (channels * 2) !== 0)
  {
    fail(
      'AUDIO_DECODER_FAILED',
      'decoder output does not contain complete nonempty PCM16 frames'
    )
  }
  const output = canonicalWav(pcm, sampleRate, channels)
  const identity = (await deriveAuthoringMediaIdentity(
    output,
    'sound',
    DEFAULT_EDIT_ADMISSION_LIMITS
  )) as DerivedSoundAssetIdentity
  assertAudioActive(signal)
  const sampleCount = pcm.byteLength / (channels * 2)
  const settings: AudioNormalizationSettingsV1 = {
    sourceFormat: metadata.kind,
    sourceRate: metadata.sampleRate,
    sourceChannels: metadata.channels,
    ...(metadata.bitsPerSample === undefined
      ? {}
      : { sourceBitsPerSample: metadata.bitsPerSample }),
    sampleRate,
    channels,
    bitsPerSample: 16,
    sampleCount,
    durationMs: (sampleCount * 1_000) / sampleRate,
  }
  return {
    bytes: output,
    identity,
    sourceSha256,
    transformationSha256: hashRecord({
      schemaVersion: 1,
      sourceSha256,
      decoder,
      settings,
      policy: AUDIO_POLICY_V1,
    }),
    outputSha256: identity.sha256,
    decoder,
    settings,
  }
}
